// 待辦事項 v180「六分類」純函式測試。執行：node --test test/*.test.js
// 對象：_todoCategoryOf（type → 分類 key，含未知 type fallback）、
//       _normalizeTodoTabOrder（已存偏好順序正規化：過濾失效 key／補齊新分類）、
//       _todoCategoryCounts（各分類未處理筆數統計，供 tab 徽章／方塊摘要共用）。
//
// TODO_CATEGORIES／TODO_CATEGORY_ORDER_DEFAULT 為 dev/index.html 內的頂層 const（單一
// 真相來源，供 UI 與這三個純函式共用），harness 只能就地抽出具名函式、抽不到頂層 const，
// 故在此複製一份等價內容注入 extraGlobals（與 README 所述 CHUNK_SIZE 等常數注入模式一致）。
// 若未來六分類的 type 對照調整，需同步更新這裡的複本，否則測試會對不上真正的分類邏輯。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const TODO_CATEGORIES = {
  draft:    { emoji: '📝', label: '草稿備援',   types: ['record', 'initial_interview', 'psychiatrist', 'event_records', 'autosave', 'manual'] },
  case:     { emoji: '📁', label: '個案',       types: ['case_assignment', 'internal_transfer', 'couple_incomplete', 'case_profile_incomplete', 'case_mainid_confirm', 'unclosed_reminder'] },
  ml:       { emoji: '💙', label: '身心調適假', types: ['ml_cumul3', 'ml_reminder', 'ml_assessment_due', 'ml_new_leave'] },
  transfer: { emoji: '🎓', label: '轉銜',       types: ['transfer_grad_counselor', 'transfer_grad_coord', 'transfer_closure_reminder', 'transfer_withdraw_coord', 'transfer_withdraw_mismatch', 'transfer_reassign_assessor', 'transfer_reassign_assessor_notify'] },
  leave:    { emoji: '🕐', label: '差勤',       types: ['leave_pending_review', 'leave_approved_notify'] },
  admin:    { emoji: '⚙️', label: '管理',       types: ['issue_pending_verification', 'admin_verify_new_user'] },
};
const TODO_CATEGORY_ORDER_DEFAULT = ['draft', 'case', 'ml', 'transfer', 'leave', 'admin'];

function loadTodoCat(names) {
  return load(names, { TODO_CATEGORIES, TODO_CATEGORY_ORDER_DEFAULT });
}

// ── _todoCategoryOf ──────────────────────────────────────────────────────────
test('_todoCategoryOf：草稿備援四型 record/initial_interview/psychiatrist/event_records → draft', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('record'), 'draft');
  assert.equal(S._todoCategoryOf('initial_interview'), 'draft');
  assert.equal(S._todoCategoryOf('psychiatrist'), 'draft');
  assert.equal(S._todoCategoryOf('event_records'), 'draft');
});

test('_todoCategoryOf：舊格式 autosave/manual 字面型別（localStorage 草稿搬遷殘留）仍歸 draft', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('autosave'), 'draft');
  assert.equal(S._todoCategoryOf('manual'), 'draft');
});

test('_todoCategoryOf：個案類（待派案／內部轉案／伴侶資料待補／快速開案資料待補／主案號確認／未結案提醒）→ case', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('case_assignment'), 'case');
  assert.equal(S._todoCategoryOf('internal_transfer'), 'case');
  assert.equal(S._todoCategoryOf('couple_incomplete'), 'case');
  assert.equal(S._todoCategoryOf('case_profile_incomplete'), 'case'); // v181：快速開案儲存後提醒「列為待辦」
  assert.equal(S._todoCategoryOf('case_mainid_confirm'), 'case');
  assert.equal(S._todoCategoryOf('unclosed_reminder'), 'case');
});

test('_todoCategoryOf：身心調適假四型（含 v178 新增 ml_new_leave）→ ml', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('ml_cumul3'), 'ml');
  assert.equal(S._todoCategoryOf('ml_reminder'), 'ml');
  assert.equal(S._todoCategoryOf('ml_assessment_due'), 'ml');
  assert.equal(S._todoCategoryOf('ml_new_leave'), 'ml');
});

test('_todoCategoryOf：轉銜七型 → transfer', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  ['transfer_grad_counselor', 'transfer_grad_coord', 'transfer_closure_reminder', 'transfer_withdraw_coord',
   'transfer_withdraw_mismatch', 'transfer_reassign_assessor', 'transfer_reassign_assessor_notify'].forEach(t => {
    assert.equal(S._todoCategoryOf(t), 'transfer');
  });
});

test('_todoCategoryOf：差勤兩型 → leave', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('leave_pending_review'), 'leave');
  assert.equal(S._todoCategoryOf('leave_approved_notify'), 'leave');
});

test('_todoCategoryOf：管理兩型 → admin', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('issue_pending_verification'), 'admin');
  assert.equal(S._todoCategoryOf('admin_verify_new_user'), 'admin');
});

test('_todoCategoryOf：未知/未來新增卻忘了收錄的 type → fallback 到 admin（不會憑空消失於畫面）', () => {
  const S = loadTodoCat(['_todoCategoryOf']);
  assert.equal(S._todoCategoryOf('some_brand_new_type_nobody_registered'), 'admin');
  assert.equal(S._todoCategoryOf(undefined), 'admin');
  assert.equal(S._todoCategoryOf(''), 'admin');
});

// ── _normalizeTodoTabOrder ───────────────────────────────────────────────────
test('_normalizeTodoTabOrder：未儲存過（undefined/空陣列）→ 回傳預設順序', () => {
  const S = loadTodoCat(['_normalizeTodoTabOrder']);
  assert.deepEqual(S._normalizeTodoTabOrder(undefined, TODO_CATEGORY_ORDER_DEFAULT), TODO_CATEGORY_ORDER_DEFAULT);
  assert.deepEqual(S._normalizeTodoTabOrder([], TODO_CATEGORY_ORDER_DEFAULT), TODO_CATEGORY_ORDER_DEFAULT);
  assert.deepEqual(S._normalizeTodoTabOrder(null, TODO_CATEGORY_ORDER_DEFAULT), TODO_CATEGORY_ORDER_DEFAULT);
});

test('_normalizeTodoTabOrder：完整自訂順序 → 原樣保留', () => {
  const S = loadTodoCat(['_normalizeTodoTabOrder']);
  const saved = ['admin', 'leave', 'transfer', 'ml', 'case', 'draft'];
  assert.deepEqual(S._normalizeTodoTabOrder(saved, TODO_CATEGORY_ORDER_DEFAULT), saved);
});

test('_normalizeTodoTabOrder：儲存的順序缺新分類（版本升級後新增）→ 新分類依預設順序補在最後', () => {
  const S = loadTodoCat(['_normalizeTodoTabOrder']);
  const saved = ['leave', 'draft', 'case']; // 缺 ml/transfer/admin
  const result = S._normalizeTodoTabOrder(saved, TODO_CATEGORY_ORDER_DEFAULT);
  assert.deepEqual(result, ['leave', 'draft', 'case', 'ml', 'transfer', 'admin']);
});

test('_normalizeTodoTabOrder：儲存的順序含已移除的失效 key → 過濾掉，不出現在結果中', () => {
  const S = loadTodoCat(['_normalizeTodoTabOrder']);
  const saved = ['stale_removed_category', 'case', 'admin'];
  const result = S._normalizeTodoTabOrder(saved, TODO_CATEGORY_ORDER_DEFAULT);
  assert.deepEqual(result, ['case', 'admin', 'draft', 'ml', 'transfer', 'leave']);
});

// ── _todoCategoryCounts ──────────────────────────────────────────────────────
test('_todoCategoryCounts：依分類統計未完成且未封存的筆數', () => {
  const S = loadTodoCat(['_todoCategoryCounts', '_todoCategoryOf']);
  const list = [
    { type: 'record', done: false },
    { type: 'record', done: false },
    { type: 'case_assignment', done: false },
    { type: 'leave_pending_review', done: true },  // 已完成，不計入
    { type: 'admin_verify_new_user', done: false, archivedAt: '2026-01-01' }, // 已封存，不計入
  ];
  const counts = S._todoCategoryCounts(list);
  assert.equal(counts.draft, 2);
  assert.equal(counts.case, 1);
  assert.equal(counts.leave, 0);
  assert.equal(counts.admin, 0);
  assert.equal(counts.ml, 0);
  assert.equal(counts.transfer, 0);
});

test('_todoCategoryCounts：空陣列／null 不炸，全部分類為 0', () => {
  const S = loadTodoCat(['_todoCategoryCounts', '_todoCategoryOf']);
  const counts = S._todoCategoryCounts([]);
  TODO_CATEGORY_ORDER_DEFAULT.forEach(k => assert.equal(counts[k], 0));
  const counts2 = S._todoCategoryCounts(null);
  TODO_CATEGORY_ORDER_DEFAULT.forEach(k => assert.equal(counts2[k], 0));
});
