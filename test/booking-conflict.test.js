// 預約表重構 Slice A：撞房／撞人統一衝突檢查（_bkFindConflict）純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
// 後端 Code.gs 的 _bkFindConflictGs_ 是同一套規則的獨立實作（GAS 環境無法用此 harness 載入），
// 兩處邏輯需人工保持一致；本測試至少確保前端這一份純函式行為正確。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkFindConflict', '_bkNormalizeCounselors']);
}

// ── 撞房 ─────────────────────────────────────────────────────────────
test('撞房：同日同空間時間重疊 → type room', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '玉山', startTime: '09:30', endTime: '10:30', counselors: [] };
  const conflict = S._bkFindConflict(existing, candidate);
  assert.ok(conflict);
  assert.equal(conflict.type, 'room');
  assert.equal(conflict.with.id, 'bk1');
});

test('撞房：不同空間不衝突', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

test('撞房：room="其他" 時以 customRoom 比對，customRoom 不同不衝突', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '其他', customRoom: '接待室', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const sameCustom = { id: 'bk2', date: '2026-07-10', room: '其他', customRoom: '接待室', startTime: '09:30', endTime: '10:30', counselors: [] };
  const diffCustom = { id: 'bk3', date: '2026-07-10', room: '其他', customRoom: '會客室', startTime: '09:30', endTime: '10:30', counselors: [] };
  const conflict = S._bkFindConflict(existing, sameCustom);
  assert.ok(conflict);
  assert.equal(conflict.type, 'room');
  assert.equal(S._bkFindConflict(existing, diffCustom), null);
});

test('撞房：customRoom 為空字串不比對（不誤判衝突）', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '其他', customRoom: '', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '其他', customRoom: '', startTime: '09:30', endTime: '10:30', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

// ── 撞人 ─────────────────────────────────────────────────────────────
test('撞人：同一 email 不同空間同時段重疊 → type person', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselorName: '王小明', counselors: [{ value: 'wang@example.com', label: '王小明' }] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: 'wang@example.com', label: '王小明' }] };
  const conflict = S._bkFindConflict(existing, candidate);
  assert.ok(conflict);
  assert.equal(conflict.type, 'person');
  assert.equal(conflict.with.id, 'bk1');
});

test('撞人：自訂人員（無 email，以名字字串當 value）同時比對', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselors: [{ value: '外聘督導', label: '外聘督導', isCustom: true }] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: '外聘督導', isCustom: true }] };
  const conflict = S._bkFindConflict(existing, candidate);
  assert.ok(conflict);
  assert.equal(conflict.type, 'person');
});

test('撞人：舊資料相容（僅純量 counselorEmail，無 counselors 陣列）仍能比對', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselorEmail: 'wang@example.com', counselorName: '王小明' },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: 'wang@example.com' }] };
  const conflict = S._bkFindConflict(existing, candidate);
  assert.ok(conflict);
  assert.equal(conflict.type, 'person');
});

test('撞人：「中心會議」不計入人員衝突比對', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselors: [{ value: '中心會議' }] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: '中心會議' }] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

test('撞人：同空間時只回報撞房（不會同時因同人再誤判為撞人）', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselors: [{ value: 'wang@example.com' }] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '玉山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: 'wang@example.com' }] };
  const conflict = S._bkFindConflict(existing, candidate);
  assert.ok(conflict);
  assert.equal(conflict.type, 'room');
});

// ── 時間邊界 ─────────────────────────────────────────────────────────
test('時間邊界：相鄰時段（10:00–11:00 與 11:00–12:00）不算重疊', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '10:00', endTime: '11:00', counselors: [] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-10', room: '玉山', startTime: '11:00', endTime: '12:00', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

test('時間邊界：秒數/長格式時間（HH:MM:SS）正規化後仍正確判斷重疊', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '10:00:00', endTime: '11:00:00', counselors: [] },
  ];
  const overlap = { id: 'bk2', date: '2026-07-10', room: '玉山', startTime: '10:30:00', endTime: '11:30:00', counselors: [] };
  const adjacent = { id: 'bk3', date: '2026-07-10', room: '玉山', startTime: '11:00:00', endTime: '12:00:00', counselors: [] };
  assert.ok(S._bkFindConflict(existing, overlap));
  assert.equal(S._bkFindConflict(existing, adjacent), null);
});

test('日期不同不衝突', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk2', date: '2026-07-11', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

// ── ignoreIds / candidate.id 排除自身 ──────────────────────────────────
test('candidate.id 與既有預約 id 相同（編輯自己）→ 排除不算衝突', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:30', endTime: '10:30', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate), null);
});

test('ignoreIds：排除指定 id（例如編輯記錄關聯的舊預約）', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00', counselors: [] },
  ];
  const candidate = { id: 'bk-new', date: '2026-07-10', room: '玉山', startTime: '09:30', endTime: '10:30', counselors: [] };
  assert.equal(S._bkFindConflict(existing, candidate, { ignoreIds: ['bk1'] }), null);
  assert.equal(S._bkFindConflict(existing, candidate, { ignoreIds: new Set(['bk1']) }), null);
});

// ── skipPerson ───────────────────────────────────────────────────────
test('skipPerson: true 時略過人員衝突檢查，但仍檢查撞房', () => {
  const S = load_();
  const existing = [
    { id: 'bk1', date: '2026-07-10', room: '玉山', startTime: '09:00', endTime: '10:00',
      counselors: [{ value: 'wang@example.com' }] },
  ];
  const personCandidate = { id: 'bk2', date: '2026-07-10', room: '雪山', startTime: '09:30', endTime: '10:30',
    counselors: [{ value: 'wang@example.com' }] };
  assert.equal(S._bkFindConflict(existing, personCandidate, { skipPerson: true }), null);

  const roomCandidate = { id: 'bk3', date: '2026-07-10', room: '玉山', startTime: '09:30', endTime: '10:30', counselors: [] };
  const conflict = S._bkFindConflict(existing, roomCandidate, { skipPerson: true });
  assert.ok(conflict);
  assert.equal(conflict.type, 'room');
});
