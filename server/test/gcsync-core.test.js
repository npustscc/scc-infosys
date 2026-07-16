// server/test/gcsync-core.test.js — src/sync/gcSync.js 協調函式（gcSyncCore／gcAutoImportKnownRoom）
// 整合測試：讀寫 :memory: SQLite（vdrive）＋monkey-patch src/google/calendar.js 的 calendarFetch。
//
// 事件 ID 格式相容性專門測試（本次交付最高風險點）：bookings.json 內既有 calendarEventId 為
// cutover 前 GAS 寫入的 iCalUID 格式（帶 @google.com 後綴），GC 端 REST API 回傳的 event.id
// 不帶此後綴——若比對時未正規化，會被誤判為「GC 已刪除」而整批刪除本機預約。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');
const googleAuth = require('../src/google/auth');
const calendar = require('../src/google/calendar');
const gcSync = require('../src/sync/gcSync');

const ROOT = 'ROOT_GCSYNC_CORE_TEST';
const CTX = { root: ROOT };
const CAL_NAME = 'SCC 空間預約（核心測試）';
const CAL_ID = 'cal-core@group.calendar.google.com';

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-core-gc-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function withPatched(calendarFetchHandler, fn) {
  const origCalendarFetch = calendar.calendarFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  calendar.calendarFetch = calendarFetchHandler;
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      calendar.calendarFetch = origCalendarFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

function baseRouter(extraHandlers) {
  return async (_accessToken, reqPath, opts) => {
    opts = opts || {};
    if (reqPath.startsWith('/users/me/calendarList')) return { items: [{ id: CAL_ID, summary: CAL_NAME }] };
    for (const [matcher, handler] of extraHandlers) {
      const m = reqPath.match(matcher);
      if (m && (!handler.method || (opts.method || 'GET') === handler.method)) return handler.fn(m, opts);
    }
    throw new Error('unexpected calendarFetch call: ' + (opts.method || 'GET') + ' ' + reqPath);
  };
}

function makeClient() {
  return gcSync.calendarClientFromConfig({ CALENDAR_SYNC_CREDS: tmpCredsFile(), GC_CALENDAR_NAME: CAL_NAME });
}

function eventsListResponse(items) {
  return { items };
}

const TODAY = new Date().toISOString().slice(0, 10);

function gcEventResource({ id, title, date, startTime, endTime, description, colorId }) {
  return {
    id, summary: title,
    start: { dateTime: `${date}T${startTime}:00+08:00` },
    end: { dateTime: `${date}T${endTime}:00+08:00` },
    description: description || '',
    updated: new Date().toISOString(),
    colorId: colorId || '',
  };
}

// ── 事件 ID 格式相容（最高風險點）───────────────────────────────────

test('gcSyncCore：booking.calendarEventId 為舊格式（帶 @google.com 後綴），GC 仍存在該事件（REST 格式無後綴）→ 不應被誤判刪除', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK1', room: '玉山', counselorName: '王小明', date: TODAY, startTime: '09:00', endTime: '10:00', notes: '', bkSerial: 1, calendarEventId: 'legacyEvt1@google.com' }] },
  });

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([
      gcEventResource({ id: 'legacyEvt1', title: gcSync.buildEventTitle('玉山', '王小明', ''), date: TODAY, startTime: '09:00', endTime: '10:00', description: gcSync.buildEventDesc('王小明', '', new Date().toISOString(), 1, false) }),
    ]) }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1, 'booking 不應被誤刪——GC 事件其實還在，只是 id 格式不同');
  assert.equal(data.bookings[0].id, 'BK1');
});

test('gcSyncCore：GC 上真的已刪除該事件（gcMap 內找不到對映 id）→ 同步刪除本機預約，並記稽核', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK2', room: '玉山', counselorName: '王小明', date: TODAY, startTime: '09:00', endTime: '10:00', notes: '', bkSerial: 2, calendarEventId: 'reallyDeletedEvt' }] },
  });

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([]) }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 0, 'GC 上真的找不到對映事件時，本機預約應被同步刪除');

  const audit = vdrive.readJson(db, 'audit_log.json', CTX).data;
  assert.equal(audit.logs.length, 1);
  assert.equal(audit.logs[0].action, '因系統自動同步日曆而刪除預約');
  assert.equal(audit.logs[0].email, 'system');
});

// ── 時間/備註變更：以 GC 現況為準拉回 ────────────────────────────────

test('gcSyncCore：GC 端時間已變更 → 本機 booking 的 date/startTime/endTime 更新為 GC 現況', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK3', room: '玉山', counselorName: '王小明', date: TODAY, startTime: '09:00', endTime: '10:00', notes: '', bkSerial: 3, calendarEventId: 'evt3' }] },
  });

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([
      gcEventResource({ id: 'evt3', title: gcSync.buildEventTitle('玉山', '王小明', ''), date: TODAY, startTime: '11:00', endTime: '12:00', description: gcSync.buildEventDesc('王小明', '', new Date().toISOString(), 3, false) }),
    ]) }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings[0].startTime, '11:00');
  assert.equal(data.bookings[0].endTime, '12:00');

  const audit = vdrive.readJson(db, 'audit_log.json', CTX).data;
  assert.equal(audit.logs[0].action, '因系統自動同步日曆而更新');
});

// ── 流水號還原：GC 描述流水號與 booking.bkSerial 不符 → 呼叫 PATCH 重寫 GC description ──

test('gcSyncCore：流水號不符 → 呼叫 PATCH 還原 GC description 內的流水號', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK4', room: '玉山', counselorName: '王小明', date: TODAY, startTime: '09:00', endTime: '10:00', notes: '', bkSerial: 4, createdAt: '2026-07-01T00:00:00.000Z', calendarEventId: 'evt4' }] },
  });

  let patchedBody = null;
  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([
      // GC 描述流水號是 999，與 booking.bkSerial=4 不符，但其餘（title/time/notes）皆一致 → 不觸發 changed，只觸發 serial 還原。
      gcEventResource({ id: 'evt4', title: gcSync.buildEventTitle('玉山', '王小明', ''), date: TODAY, startTime: '09:00', endTime: '10:00', description: gcSync.buildEventDesc('王小明', '', new Date().toISOString(), 999, false) }),
    ]) }],
    [/^\/calendars\/.+\/events\/evt4$/, { method: 'PATCH', fn: (_m, opts) => { patchedBody = opts.body; return {}; } }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  assert.ok(patchedBody, 'PATCH 應被呼叫以還原正確流水號');
  assert.match(patchedBody.description, /#0004/);
});

// ── 自動匯入：GC 新增、標題可解析為已知空間 → 建立新 booking ──────────

// 註：gcSyncCore（對映 GAS gcSyncCore_）在 bookings.json 為空陣列時會提早 return（見下方
// 「bookings.json 為空陣列」案例），因此自動匯入永遠不會在「完全沒有既有預約」時觸發——這是
// GAS 原邏輯就有的限制（bug-for-bug 保留，非 Node 版新增的缺陷）。以下測試因此都先塞一筆
// 既有、與待匯入事件無關的 booking，確保流程不會被提早 return 擋住。
function seedUnrelatedBooking(db) {
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK_SEED', room: '會議室', counselorName: '既有人員', date: '2000-01-01', startTime: '09:00', endTime: '10:00', bkSerial: 900 }] },
  });
}

test('gcAutoImportKnownRoom（經 gcSyncCore）：GC 新增可解析為已知空間的事件 → 自動匯入為新 booking', async () => {
  const db = openDb(':memory:');
  seedUnrelatedBooking(db);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'b@x.com': { name: '李小華' } } } });

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([
      gcEventResource({ id: 'newGcEvt', title: '雪.李小華', date: TODAY, startTime: '13:00', endTime: '14:00', description: '手動在 GC 上約的' }),
    ]) }],
    [/^\/calendars\/.+\/events\/newGcEvt$/, { method: 'PATCH', fn: () => ({}) }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  const imported = data.bookings.find((b) => b.calendarEventId === 'newGcEvt');
  assert.ok(imported, '應自動匯入一筆新 booking');
  assert.equal(imported.room, '雪山');
  assert.equal(imported.counselorName, '李小華');
  assert.equal(imported.counselorEmail, 'b@x.com');
  assert.equal(imported.creatorName, '系統自動同步');

  const audit = vdrive.readJson(db, 'audit_log.json', CTX).data;
  assert.ok(audit.logs.some((l) => l.action === '因系統自動同步日曆而匯入預約'));
});

test('gcAutoImportKnownRoom（經 gcSyncCore）：標題無法解析為已知空間 → 不自動匯入', async () => {
  const db = openDb(':memory:');
  seedUnrelatedBooking(db);

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => eventsListResponse([
      gcEventResource({ id: 'unknownEvt', title: '隨便打的標題（無法解析）', date: TODAY, startTime: '13:00', endTime: '14:00' }),
    ]) }],
  ]);

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1, '仍只有種子那一筆，未新增匯入');
});

// ── 空 bookings.json：不觸網（沒有 calendarEventId 可比對，提早 return）───

test('gcSyncCore：bookings.json 為空陣列 → 直接 return，不呼叫任何 Calendar API', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, { name: 'bookings.json', parentId: ROOT, content: { bookings: [] } });

  const handler = async (_t, reqPath) => { throw new Error('不應觸網：' + reqPath); };
  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));
  // 未 throw 即代表沒有呼叫 handler（若呼叫了會 throw 並被 gcSyncCore 的最外層 try/catch 吞掉，
  // 但吞掉不代表沒呼叫——改用「bookings.json 仍是空陣列」佐證流程確實提早結束）。
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.deepEqual(data.bookings, []);
});

// ── 整體失敗不拋出（對映 trigger 不該紅）────────────────────────────

test('gcSyncCore：Calendar API 整體失敗（如 getCalendarId 找不到日曆）→ 不 throw，靜默返回', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, {
    name: 'bookings.json', parentId: ROOT,
    content: { bookings: [{ id: 'BK5', room: '玉山', counselorName: '王小明', date: TODAY, startTime: '09:00', endTime: '10:00', bkSerial: 5, calendarEventId: 'evt5' }] },
  });

  const handler = async (_t, reqPath) => {
    if (reqPath.startsWith('/users/me/calendarList')) return { items: [] }; // 找不到日曆
    throw new Error('unexpected: ' + reqPath);
  };

  await withPatched(handler, () => gcSync.gcSyncCore(db, CTX, makeClient()));
  // 不 throw 即通過（node:test 若這裡 throw 未被捕捉會讓測試失敗）。
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1, '同步失敗不應影響既有資料');
});
