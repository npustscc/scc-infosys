// server/test/gcsync-pure.test.js — src/sync/gcSync.js 純函式單元測試（不觸網、不碰 DB）。
// 對映 dev/Code.gs 日曆同步相關純函式（buildEventTitle_/buildEventDesc_/_gcSyncParseTitle_/
// _gcKnownRoomOfTitleGs_/_gcSyncShouldRun/gcSyncCore_ 的 diff 決策段/gcAnnotateEvent_ 的補註計算段）。
//
// 事件 ID 格式相容性是本次交付的最高風險點（見 CLAUDE.md 交付說明）：GAS CalendarApp 的
// event.getId() 回傳 iCalUID 格式（`{id}@google.com`），Calendar REST API 的 event.id 不帶此後綴。
// cutover 後既有 bookings.json 內的 calendarEventId 全是舊格式，若比對時沒有正規化，會被誤判為
// 「GC 已刪除」而遭同步刪除整批預約——本檔用專門的測試段落覆蓋這個情境。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const gcSync = require('../src/sync/gcSync');

// ── normalizeEventId：事件 ID 格式相容（最高風險點）───────────────────

test('normalizeEventId：帶 @google.com 後綴（GAS iCalUID 格式）→ 去除後綴', () => {
  assert.equal(gcSync.normalizeEventId('abc123@google.com'), 'abc123');
});

test('normalizeEventId：不帶後綴（REST 格式，Node 版新建事件）→ 恆等（idempotent）', () => {
  assert.equal(gcSync.normalizeEventId('abc123'), 'abc123');
});

test('normalizeEventId：大小寫不敏感、空值安全', () => {
  assert.equal(gcSync.normalizeEventId('abc123@GOOGLE.COM'), 'abc123');
  assert.equal(gcSync.normalizeEventId(''), '');
  assert.equal(gcSync.normalizeEventId(null), '');
  assert.equal(gcSync.normalizeEventId(undefined), '');
});

test('normalizeEventId：diff 比對情境——舊格式 booking.calendarEventId 與新格式 GC 回傳 id 正規化後應相等', () => {
  const bookingSideId = 'xyz789@google.com'; // cutover 前 GAS 寫入
  const gcSideId = 'xyz789'; // Node 版 REST 抓回的同一顆事件
  assert.equal(gcSync.normalizeEventId(bookingSideId), gcSync.normalizeEventId(gcSideId));
});

// ── buildEventTitle ───────────────────────────────────────────────

test('buildEventTitle：一般空間取首字＋人員姓名', () => {
  assert.equal(gcSync.buildEventTitle('玉山', '王小明', ''), '玉.王小明');
});

test('buildEventTitle：「其他」空間用 customRoom', () => {
  assert.equal(gcSync.buildEventTitle('其他', '王小明', '諮詢室B'), '諮詢室B.王小明');
});

test('buildEventTitle：「其他」空間無 customRoom → fallback 為「其他」', () => {
  assert.equal(gcSync.buildEventTitle('其他', '王小明', ''), '其他.王小明');
});

test('buildEventTitle：無 counselorName → 只有空間部分，不含句點', () => {
  assert.equal(gcSync.buildEventTitle('玉山', '', ''), '玉');
});

// ── buildEventDesc（含台北時區安全格式化，不依賴 process TZ）─────────

test('buildEventDesc：組出 備註/actor/流水號 三段', () => {
  // 2026-07-15T09:00:00+08:00 = UTC 2026-07-15T01:00:00Z
  const iso = '2026-07-15T01:00:00.000Z';
  const desc = gcSync.buildEventDesc('王小明', '個別諮商', iso, 12, false);
  assert.equal(desc, '個別諮商\n---\n王小明 建立 2026/07/15 09:00\n#0012');
});

test('buildEventDesc：isEdit=true → 動詞為「編輯」（notes 為空時 GAS 原邏輯仍會留一段「---\\n」前綴，bug-for-bug 保留）', () => {
  const iso = '2026-07-15T01:00:00.000Z';
  const desc = gcSync.buildEventDesc('王小明', '', iso, 1, true);
  assert.equal(desc, '---\n王小明 編輯 2026/07/15 09:00\n#0001');
});

test('buildEventDesc：無 notes/無 bkSerial → 只有 actor 段（含 GAS 原邏輯的「---\\n」前綴）', () => {
  const iso = '2026-07-15T01:00:00.000Z';
  const desc = gcSync.buildEventDesc('王小明', '', iso, 0, false);
  assert.equal(desc, '---\n王小明 建立 2026/07/15 09:00');
});

test('buildEventDesc：時區安全——輸入為不同時間但同一 UTC 瞬間的字串，結果應一致（不受 process.env.TZ 影響）', () => {
  const origTz = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York'; // 刻意設一個與台北差很多的時區，驗證函式不依賴 process TZ
    const iso = '2026-07-15T01:00:00.000Z';
    const desc = gcSync.buildEventDesc('X', '', iso, 0, false);
    assert.match(desc, /2026\/07\/15 09:00/, '仍應以台北時區（+8）顯示，不受 process.env.TZ 影響');
  } finally {
    process.env.TZ = origTz;
  }
});

// ── parseEventDescription ─────────────────────────────────────────

test('parseEventDescription：含 actor 行與流水號 → 抽出 notes（不含 actor 行）與 serial', () => {
  const r = gcSync.parseEventDescription('個別諮商\n---\n王小明 建立 2026/07/15 09:00\n#0012');
  assert.equal(r.notes, '個別諮商');
  assert.equal(r.serial, 12);
});

test('parseEventDescription：無流水號 → serial=null，notes 取分隔線前段', () => {
  const r = gcSync.parseEventDescription('個別諮商\n---\n王小明 建立 2026/07/15 09:00');
  assert.equal(r.notes, '個別諮商');
  assert.equal(r.serial, null);
});

test('parseEventDescription：無分隔線、無流水號（使用者直接手打的 GC 描述）→ 整段視為 notes', () => {
  const r = gcSync.parseEventDescription('使用者自己在 GC 打的備註');
  assert.equal(r.notes, '使用者自己在 GC 打的備註');
  assert.equal(r.serial, null);
});

test('parseEventDescription：空字串/undefined → notes="", serial=null', () => {
  assert.deepEqual(gcSync.parseEventDescription(''), { notes: '', serial: null });
  assert.deepEqual(gcSync.parseEventDescription(undefined), { notes: '', serial: null });
});

// ── gcSyncParseTitle ───────────────────────────────────────────────

test('gcSyncParseTitle：已知空間字首＋已知使用者姓名 → 還原 email', () => {
  const users = { 'a@x.com': { name: '王小明' } };
  const r = gcSync.gcSyncParseTitle('玉.王小明', users);
  assert.equal(r.room, '玉山');
  assert.equal(r.counselorName, '王小明');
  assert.equal(r.counselorEmail, 'a@x.com');
  assert.deepEqual(r.counselors, [{ value: 'a@x.com', label: '王小明', isCustom: false }]);
});

test('gcSyncParseTitle：多人（逗號分隔）＋其中一人非已知使用者 → 該人 isCustom:true', () => {
  const users = { 'a@x.com': { name: '王小明' } };
  const r = gcSync.gcSyncParseTitle('玉.王小明,訪客甲', users);
  assert.equal(r.counselors.length, 2);
  assert.equal(r.counselors[1].isCustom, true);
  assert.equal(r.counselorEmail, 'a@x.com'); // 只有第一位非 custom 時才取其 email
});

test('gcSyncParseTitle：未知空間字首 → 原樣當 customRoom 字串保留', () => {
  const r = gcSync.gcSyncParseTitle('未知空間.王小明', {});
  assert.equal(r.room, '未知空間');
});

test('gcSyncParseTitle：空字串/falsy title → null', () => {
  assert.equal(gcSync.gcSyncParseTitle('', {}), null);
  assert.equal(gcSync.gcSyncParseTitle(null, {}), null);
});

// ── gcKnownRoomOfTitle ─────────────────────────────────────────────

test('gcKnownRoomOfTitle：已知空間字首＋有人員 → 回傳空間全名', () => {
  assert.equal(gcSync.gcKnownRoomOfTitle('玉.王小明'), '玉山');
});

test('gcKnownRoomOfTitle：無句點（格式不符）→ null', () => {
  assert.equal(gcSync.gcKnownRoomOfTitle('隨便打的標題'), null);
});

test('gcKnownRoomOfTitle：有句點但無人員 → null', () => {
  assert.equal(gcSync.gcKnownRoomOfTitle('玉.'), null);
});

test('gcKnownRoomOfTitle：未知字首 → null（留給前端待確認清單）', () => {
  assert.equal(gcSync.gcKnownRoomOfTitle('未知.王小明'), null);
});

// ── gcSyncShouldRun ────────────────────────────────────────────────

test('gcSyncShouldRun：週一 08:00-21:00 內 → true（每次 trigger 都跑）；下班後離整點較遠的分鐘 → false', () => {
  assert.equal(gcSync.gcSyncShouldRun(1, 8, 0), true);
  assert.equal(gcSync.gcSyncShouldRun(1, 20, 59), true);
  // 21:00 剛下班，同時也是整點（minute<5 的 fallback 規則仍成立）→ 兩條規則都指向 true。
  assert.equal(gcSync.gcSyncShouldRun(1, 21, 0), true);
  // 離整點較遠（21:10）才會落在「非上班時段且非整點附近」的 false 區間。
  assert.equal(gcSync.gcSyncShouldRun(1, 21, 10), false);
});

test('gcSyncShouldRun：週二/三/五 08:00-18:00 內 → true，其餘僅整點附近（分鐘<5）', () => {
  assert.equal(gcSync.gcSyncShouldRun(2, 17, 59), true);
  // 18:00 剛下班但同時是整點 → fallback 規則仍成立，true。
  assert.equal(gcSync.gcSyncShouldRun(2, 18, 0), true);
  assert.equal(gcSync.gcSyncShouldRun(2, 18, 4), true);
  assert.equal(gcSync.gcSyncShouldRun(2, 18, 5), false);
});

test('gcSyncShouldRun：週末（六=6/日=7）全天僅整點附近 → true 僅當 minute<5', () => {
  assert.equal(gcSync.gcSyncShouldRun(6, 14, 0), true);
  assert.equal(gcSync.gcSyncShouldRun(6, 14, 5), false);
  assert.equal(gcSync.gcSyncShouldRun(7, 3, 2), true);
});

// ── computeAnnotatedDescription ───────────────────────────────────

test('computeAnnotatedDescription：無流水號 → 直接附加在末端', () => {
  const r = gcSync.computeAnnotatedDescription('原本的備註', '補充說明', undefined);
  assert.equal(r.skipped, false);
  assert.equal(r.newDesc, '原本的備註\n---\n補充說明');
});

test('computeAnnotatedDescription：有流水號 → 插入點在流水號之前，不破壞流水號解析', () => {
  const r = gcSync.computeAnnotatedDescription('備註\n---\n王小明 建立 2026/07/15 09:00\n#0012', '補充', undefined);
  assert.equal(r.newDesc, '備註\n---\n王小明 建立 2026/07/15 09:00\n---\n補充\n#0012');
  // 附加後仍可被 parseEventDescription 正確解析出流水號
  const parsed = gcSync.parseEventDescription(r.newDesc);
  assert.equal(parsed.serial, 12);
});

test('computeAnnotatedDescription：已含 marker → skipped:true，內容不變（防重複）', () => {
  const desc = '備註\n---\n[系統補註] 已經補過了';
  const r = gcSync.computeAnnotatedDescription(desc, '再補一次', undefined);
  assert.equal(r.skipped, true);
  assert.equal(r.newDesc, desc);
});

test('computeAnnotatedDescription：noteText 為空字串且未命中 marker → throw', () => {
  assert.throws(() => gcSync.computeAnnotatedDescription('備註', '', undefined), /noteText required/);
});

test('computeAnnotatedDescription：自訂 marker', () => {
  const r = gcSync.computeAnnotatedDescription('備註\n---\n[custom] 舊補註', '新補註', '[custom]');
  assert.equal(r.skipped, true);
});

// ── mapEventToNormalized ───────────────────────────────────────────

test('mapEventToNormalized：REST event resource → GAS listCalendarEvents_ 回傳形狀', () => {
  const ev = {
    id: 'evt123',
    summary: '玉.王小明',
    description: '備註\n---\n王小明 建立 2026/07/15 09:00\n#0001',
    start: { dateTime: '2026-07-15T09:00:00+08:00', timeZone: 'Asia/Taipei' },
    end: { dateTime: '2026-07-15T10:00:00+08:00', timeZone: 'Asia/Taipei' },
    updated: '2026-07-14T10:00:00.000Z',
    creator: { email: 'npust.scc@heartnpust.tw' },
    colorId: '5',
  };
  const r = gcSync.mapEventToNormalized(ev);
  assert.equal(r.id, 'evt123');
  assert.equal(r.title, '玉.王小明');
  assert.equal(r.date, '2026-07-15');
  assert.equal(r.startTime, '09:00');
  assert.equal(r.endTime, '10:00');
  assert.equal(r.colorId, '5');
  assert.deepEqual(r.creators, ['npust.scc@heartnpust.tw']);
});

test('mapEventToNormalized：無 creator/colorId → creators=[]、colorId=""', () => {
  const ev = { id: 'e1', summary: 'x', start: { dateTime: '2026-07-15T09:00:00+08:00' }, end: { dateTime: '2026-07-15T10:00:00+08:00' } };
  const r = gcSync.mapEventToNormalized(ev);
  assert.deepEqual(r.creators, []);
  assert.equal(r.colorId, '');
});

// ── diffBookingAgainstGcEvent ──────────────────────────────────────

function baseBooking(overrides) {
  return Object.assign({
    id: 'BK1', room: '玉山', customRoom: '', counselorName: '王小明',
    date: '2026-07-15', startTime: '09:00', endTime: '10:00', notes: '個別諮商',
    bkSerial: 12, calendarEventId: 'evt1',
  }, overrides || {});
}

function gcEventFor(booking, overrides) {
  return Object.assign({
    id: booking.calendarEventId,
    title: gcSync.buildEventTitle(booking.room, booking.counselorName, booking.customRoom),
    date: booking.date, startTime: booking.startTime, endTime: booking.endTime,
    description: gcSync.buildEventDesc('王小明', booking.notes, '2026-07-15T01:00:00.000Z', booking.bkSerial, false),
  }, overrides || {});
}

test('diffBookingAgainstGcEvent：GC 事件不存在（undefined）→ kind=deleted', () => {
  const b = baseBooking();
  const r = gcSync.diffBookingAgainstGcEvent(b, undefined, {});
  assert.equal(r.kind, 'deleted');
});

test('diffBookingAgainstGcEvent：title/time/notes 皆相符、流水號相符 → kind=unchanged, serialMismatch=false', () => {
  const b = baseBooking();
  const gcE = gcEventFor(b);
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, {});
  assert.equal(r.kind, 'unchanged');
  assert.equal(r.serialMismatch, false);
});

test('diffBookingAgainstGcEvent：GC 時間變更 → kind=changed，update 含新 date/startTime/endTime', () => {
  const b = baseBooking();
  const gcE = gcEventFor(b, { startTime: '11:00', endTime: '12:00' });
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, {});
  assert.equal(r.kind, 'changed');
  assert.equal(r.update.startTime, '11:00');
  assert.equal(r.update.endTime, '12:00');
  assert.ok(r.diffs.some((d) => d.includes('09:00')));
});

test('diffBookingAgainstGcEvent：GC 備註變更 → kind=changed，update.notes 為 GC 現況（以 GC 為準拉回）', () => {
  const b = baseBooking();
  const gcE = gcEventFor(b, { description: gcSync.buildEventDesc('王小明', 'GC 上改過的備註', '2026-07-15T01:00:00.000Z', 12, true) });
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, {});
  assert.equal(r.kind, 'changed');
  assert.equal(r.update.notes, 'GC 上改過的備註');
});

test('diffBookingAgainstGcEvent：GC 標題變更為已知空間＋已知人員 → update 含新 room/counselorName/counselorEmail', () => {
  const users = { 'b@x.com': { name: '李小華' } };
  const b = baseBooking();
  const gcE = gcEventFor(b, { title: '雪.李小華' });
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, users);
  assert.equal(r.kind, 'changed');
  assert.equal(r.update.room, '雪山');
  assert.equal(r.update.counselorName, '李小華');
  assert.equal(r.update.counselorEmail, 'b@x.com');
});

test('diffBookingAgainstGcEvent：流水號不符 → serialMismatch=true（即使其餘欄位皆相符）', () => {
  const b = baseBooking({ bkSerial: 12 });
  const gcE = gcEventFor(b, { description: gcSync.buildEventDesc('王小明', b.notes, '2026-07-15T01:00:00.000Z', 999, false) });
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, {});
  assert.equal(r.serialMismatch, true);
  assert.equal(r.kind, 'unchanged'); // 流水號不符本身不算 title/time/notes 變更
});

test('diffBookingAgainstGcEvent：booking 無 bkSerial → 即使 GC 流水號不同也不算 serialMismatch', () => {
  const b = baseBooking({ bkSerial: 0 });
  const gcE = gcEventFor(b, { description: gcSync.buildEventDesc('王小明', b.notes, '2026-07-15T01:00:00.000Z', 999, false) });
  const r = gcSync.diffBookingAgainstGcEvent(b, gcE, {});
  assert.equal(r.serialMismatch, false);
});
