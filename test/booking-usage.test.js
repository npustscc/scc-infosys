// 預約表重構 Slice D2：空間預約使用率統計（_bkUsageStats）純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
// _bkUsageStats 依賴全域 BK_PERIODS（各節次 label/start/end），此處以 extraGlobals 注入一組
// 精簡的兩節次替身，聚焦測試函式本身的篩選／彙整邏輯，不糾結於實際節次表內容。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const BK_PERIODS = [
  { label: '第1節 08:10–09:00', start: '08:10', end: '09:00' },
  { label: '第2節 09:10–10:00', start: '09:10', end: '10:00' },
];

function load_() {
  return load(['_bkUsageStats'], { BK_PERIODS });
}

// ── 空 ───────────────────────────────────────────────────────────────
test('空陣列 → byRoom/byPerson 皆空，byPeriod 依 BK_PERIODS 各節次 count=0', () => {
  const S = load_();
  const r = S._bkUsageStats([], '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byRoom, []);
  assert.deepEqual(r.byPerson, []);
  assert.deepEqual(r.byPeriod, [
    { label: '第1節 08:10–09:00', count: 0 },
    { label: '第2節 09:10–10:00', count: 0 },
  ]);
});

// ── 單日 ─────────────────────────────────────────────────────────────
test('單筆預約：正確計入所在空間／節次／人員各一次', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '08:10', endTime: '09:00',
      counselorName: '王小明', counselors: [{ value: 'wang@example.com', name: '王小明' }] },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-10', '2026-07-10');
  assert.deepEqual(r.byRoom, [{ room: '玉山', count: 1 }]);
  assert.deepEqual(r.byPeriod, [
    { label: '第1節 08:10–09:00', count: 1 },
    { label: '第2節 09:10–10:00', count: 0 },
  ]);
  assert.deepEqual(r.byPerson, [{ name: '王小明', count: 1 }]);
});

test('一筆預約橫跨兩節次時，byPeriod 兩節次都各累計一次', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '08:10', endTime: '10:00',
      counselorName: '王小明' },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-10', '2026-07-10');
  assert.deepEqual(r.byPeriod, [
    { label: '第1節 08:10–09:00', count: 1 },
    { label: '第2節 09:10–10:00', count: 1 },
  ]);
});

// ── 跨區間篩選 ────────────────────────────────────────────────────────
test('日期落在區間外的預約不計入（起訖皆含端點）', () => {
  const S = load_();
  const bookings = [
    { id: 'bk-before', date: '2026-06-30', room: '玉山', startTime: '08:10', endTime: '09:00', counselorName: 'A' },
    { id: 'bk-in-1',   date: '2026-07-01', room: '玉山', startTime: '08:10', endTime: '09:00', counselorName: 'B' },
    { id: 'bk-in-2',   date: '2026-07-31', room: '玉山', startTime: '08:10', endTime: '09:00', counselorName: 'C' },
    { id: 'bk-after',  date: '2026-08-01', room: '玉山', startTime: '08:10', endTime: '09:00', counselorName: 'D' },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byRoom, [{ room: '玉山', count: 2 }]);
  assert.equal(r.byPerson.length, 2);
  assert.deepEqual(new Set(r.byPerson.map(p => p.name)), new Set(['B', 'C']));
});

// ── byRoom/byPeriod/byPerson 計數正確且由多到少排序 ─────────────────────
test('byRoom／byPerson 依 count 由多到少排序', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '08:10', endTime: '09:00', counselorName: '王小明' },
    { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '08:10', endTime: '09:00', counselorName: '王小明' },
    { id: 'bk3', date: '2026-07-11', room: '雪山', startTime: '09:10', endTime: '10:00', counselorName: '李小華' },
    { id: 'bk4', date: '2026-07-11', room: '雪山', startTime: '09:10', endTime: '10:00', counselorName: '李小華' },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byRoom, [{ room: '雪山', count: 3 }, { room: '玉山', count: 1 }]);
  // 王小明與李小華同為 count=2（同分不強行斷言順序，只驗證總數與每筆計數正確）
  assert.equal(r.byPerson.reduce((n, p) => n + p.count, 0), 4);
  assert.equal(r.byPerson.every(p => p.count === 2), true);
  assert.deepEqual(new Set(r.byPerson.map(p => p.name)), new Set(['王小明', '李小華']));
});

// ── customRoom 歸類 ──────────────────────────────────────────────────
test('room="其他" 附 customRoom 時，byRoom 以 customRoom 名稱個別歸類，不籠統併入「其他」', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '其他', customRoom: '接待室', startTime: '08:10', endTime: '09:00', counselorName: 'A' },
    { id: 'bk2', date: '2026-07-10', room: '其他', customRoom: '會客室', startTime: '08:10', endTime: '09:00', counselorName: 'B' },
    { id: 'bk3', date: '2026-07-10', room: '其他', customRoom: '',       startTime: '08:10', endTime: '09:00', counselorName: 'C' },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-01', '2026-07-31');
  const byRoomMap = Object.fromEntries(r.byRoom.map(x => [x.room, x.count]));
  assert.equal(byRoomMap['接待室'], 1);
  assert.equal(byRoomMap['會客室'], 1);
  assert.equal(byRoomMap['其他'], 1); // customRoom 為空字串時退回「其他」
  assert.equal(byRoomMap['接待室'] !== undefined && byRoomMap['會客室'] !== undefined, true);
});

test('新資料直接把自訂空間名稱存進 room（非 "其他" 附 customRoom）時，byRoom 照樣以該名稱歸類', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '交誼廳', startTime: '08:10', endTime: '09:00', counselorName: 'A' },
    { id: 'bk2', date: '2026-07-10', room: '交誼廳', startTime: '09:10', endTime: '10:00', counselorName: 'A' },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byRoom, [{ room: '交誼廳', count: 2 }]);
});

// ── byPerson：counselorName 缺值時退回 counselors[0] ─────────────────────
test('counselorName 缺值時，byPerson 退回 counselors[0] 的 name／label', () => {
  const S = load_();
  const bookings = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '08:10', endTime: '09:00',
      counselors: [{ value: 'x', label: '外聘督導' }] },
  ];
  const r = S._bkUsageStats(bookings, '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byPerson, [{ name: '外聘督導', count: 1 }]);
});
