// v185：全站表單草稿備援共用引擎的純函式測試。執行：node --test test/
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ── _parseDraftKeyType：draft key 前綴 → 表單類型解析路由 ──────────────────────
test('_parseDraftKeyType：辨識 6 種 v185 新表單的 scc_draft_ 前綴', () => {
  const S = load(['_parseDraftKeyType']);
  assert.deepEqual(S._parseDraftKeyType('scc_draft_case_a@b.com_new'), { type: 'case_draft', label: '個案資料草稿' });
  assert.deepEqual(S._parseDraftKeyType('scc_draft_closure_a@b.com_1140912B001_closure'), { type: 'closure_draft', label: '結案評估草稿' });
  assert.deepEqual(S._parseDraftKeyType('scc_draft_transfer_a@b.com_1140912B001_new'), { type: 'transfer_draft', label: '轉銜評估草稿' });
  assert.deepEqual(S._parseDraftKeyType('scc_draft_mlassess_a@b.com_ml_123'), { type: 'ml_assess_draft', label: '身心狀態評估表草稿' });
  assert.deepEqual(S._parseDraftKeyType('scc_draft_booking_a@b.com_new'), { type: 'booking_draft', label: '空間預約草稿' });
  assert.deepEqual(S._parseDraftKeyType('scc_draft_issue_a@b.com'), { type: 'issue_draft', label: '問題回報草稿' });
});

test('_parseDraftKeyType：既有前綴（record/psy/ii）與未知前綴一律回傳 null（呼叫端 fallback 為既有 autosave 類型，不影響既有行為）', () => {
  const S = load(['_parseDraftKeyType']);
  assert.equal(S._parseDraftKeyType('scc_draft_record_a@b.com_1140912B001_new'), null);
  assert.equal(S._parseDraftKeyType('scc_draft_psy_a@b.com_1140912B001_new'), null);
  assert.equal(S._parseDraftKeyType('scc_draft_ii_a@b.com_1140912B001'), null);
  assert.equal(S._parseDraftKeyType('scc_geno_draft_1140912B001_field1_a@b.com'), null); // 家系圖獨立機制，刻意不用 scc_draft_ 前綴
  assert.equal(S._parseDraftKeyType(''), null);
  assert.equal(S._parseDraftKeyType(undefined), null);
});

// ── _isDraftSnapshotDirty：快照 vs 基準快照比對（判斷「使用者是否有實際輸入」）─────
test('_isDraftSnapshotDirty：與基準快照相同 → 不算 dirty', () => {
  const S = load(['_isDraftSnapshotDirty']);
  const baseline = JSON.stringify({ name: '王小明', notes: '' });
  assert.equal(S._isDraftSnapshotDirty({ name: '王小明', notes: '' }, baseline), false);
});

test('_isDraftSnapshotDirty：欄位值改變 → 算 dirty', () => {
  const S = load(['_isDraftSnapshotDirty']);
  const baseline = JSON.stringify({ name: '王小明', notes: '' });
  assert.equal(S._isDraftSnapshotDirty({ name: '王小明', notes: '使用者輸入的內容' }, baseline), true);
});

test('_isDraftSnapshotDirty：編輯模式回填既有資料當下（快照＝基準）不應被誤判為 dirty', () => {
  const S = load(['_isDraftSnapshotDirty']);
  // 模擬編輯個案：openEditCasePage 回填既有資料完成後立刻取的基準快照，此時尚未有使用者輸入
  const editedCaseSnapshot = { id: '1140912B001', name: '王小明', studentId: 'A123456789', phone: '0912345678' };
  const baseline = JSON.stringify(editedCaseSnapshot);
  assert.equal(S._isDraftSnapshotDirty(editedCaseSnapshot, baseline), false);
  // 使用者接著改了一個欄位 → 應變成 dirty
  assert.equal(S._isDraftSnapshotDirty({ ...editedCaseSnapshot, phone: '0987654321' }, baseline), true);
});

test('_isDraftSnapshotDirty：尚未設定基準快照（null/undefined）時，任何非 undefined 快照都視為 dirty', () => {
  const S = load(['_isDraftSnapshotDirty']);
  assert.equal(S._isDraftSnapshotDirty({ a: 1 }, null), true);
  assert.equal(S._isDraftSnapshotDirty({ a: 1 }, undefined), true);
  assert.equal(S._isDraftSnapshotDirty(undefined, null), false);
});
