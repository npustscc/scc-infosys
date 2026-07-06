// 結案狀態函式群測試（重構 Slice 0）。執行：node --test test/*.test.js
// 對象：_recomputeCaseStatus / _isSemesterUnclosed / _hasPastUnclosed
// _isSemesterUnclosed 分支最多、也最容易在重構時被簡化壞掉，每個判斷分支都要鎖住。
const { test } = require('node:test');
const assert = require('node:assert');
const { load, makeFixedDate } = require('./harness');

// ── _recomputeCaseStatus：取最新學期的 semesterStatus，無學期則 fallback c.status ──────
test('_recomputeCaseStatus：以最新學期的 semesterStatus 為準', () => {
  const S = load(['_recomputeCaseStatus', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'], semesterStatus: { 1141: 'closed', 1142: 'active' } };
  assert.equal(S._recomputeCaseStatus(c), 'active');
});

test('_recomputeCaseStatus：最新學期在 semesterStatus 缺 key 時預設 active', () => {
  const S = load(['_recomputeCaseStatus', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'], semesterStatus: { 1141: 'closed' } };
  assert.equal(S._recomputeCaseStatus(c), 'active');
});

test('_recomputeCaseStatus：無 semesters 時用 openDate 換算學期', () => {
  const S = load(['_recomputeCaseStatus', 'openDateToSemPrefix']);
  const c = { openDate: '2026-06-15', semesterStatus: { 1142: 'closed' } }; // -> 1142
  assert.equal(S._recomputeCaseStatus(c), 'closed');
});

test('_recomputeCaseStatus：無任何學期資訊時 fallback c.status（有值/無值）', () => {
  const S = load(['_recomputeCaseStatus', 'openDateToSemPrefix']);
  assert.equal(S._recomputeCaseStatus({ status: 'closed' }), 'closed');
  assert.equal(S._recomputeCaseStatus({}), 'active');
});

// ── _isSemesterUnclosed：多重證據判斷，逐分支鎖住 ─────────────────────────────────
test('_isSemesterUnclosed：semesterStatus 明確為 closed → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesterStatus: { 1141: 'closed' } };
  assert.equal(S._isSemesterUnclosed(c, '1141'), false);
});

test('_isSemesterUnclosed：semesterStatus 明確為 active → true（即便 c.status=closed 也優先）', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesterStatus: { 1141: 'active' }, status: 'closed' };
  assert.equal(S._isSemesterUnclosed(c, '1141'), true);
});

test('_isSemesterUnclosed：semesterStatus undefined + 該學期有效 closure 評估 → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    semesterEvaluations: [{ type: 'closure', semester: '1141' }],
  };
  assert.equal(S._isSemesterUnclosed(c, '1141'), false);
});

test('_isSemesterUnclosed：closure 評估已被軟刪除（deletedAt）→ 不算數，視同無證據', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'], // 1141 非最新，其餘條件都不成立 → 應回 true
    semesterEvaluations: [{ type: 'closure', semester: '1141', deletedAt: '2026-01-01T00:00:00Z' }],
  };
  assert.equal(S._isSemesterUnclosed(c, '1141'), true);
});

test('_isSemesterUnclosed：closure 評估已被取代（replacedBy）→ 不算數，視同無證據', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    semesterEvaluations: [{ type: 'closure', semester: '1141', replacedBy: 'ev2' }],
  };
  assert.equal(S._isSemesterUnclosed(c, '1141'), true);
});

test('_isSemesterUnclosed：舊格式 closureEvaluation + 案僅一學期 + 無 semesterEvaluations → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesters: ['1141'], closureEvaluation: { light: '綠燈' } };
  assert.equal(S._isSemesterUnclosed(c, '1141'), false);
});

test('_isSemesterUnclosed：舊格式 closureEvaluation 但案有多個學期 → 該規則不適用', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  // 多學期時舊格式規則不成立，且無其他結案證據 → 應視為未結案
  const c = { semesters: ['1141', '1142'], closureEvaluation: { light: '綠燈' } };
  assert.equal(S._isSemesterUnclosed(c, '1141'), true);
});

test('_isSemesterUnclosed：最新學期 + c.status=closed → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'], status: 'closed' };
  assert.equal(S._isSemesterUnclosed(c, '1142'), false); // 1142 為最新學期
});

test('_isSemesterUnclosed：非最新學期 + c.status=closed + 該學期 semesterStatus undefined → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'], status: 'closed' };
  assert.equal(S._isSemesterUnclosed(c, '1141'), false); // 非最新學期也適用「整案已結案」規則
});

test('_isSemesterUnclosed：c.archived → false', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesters: ['1141'], archived: true };
  assert.equal(S._isSemesterUnclosed(c, '1141'), false);
});

test('_isSemesterUnclosed：無任何結案證據 → true（仍需提醒）', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'] };
  assert.equal(S._isSemesterUnclosed(c, '1141'), true);
  assert.equal(S._isSemesterUnclosed(c, '1142'), true);
});

test('_isSemesterUnclosed：空物件／缺欄位不炸（使用 ?. 的邊界情況）', () => {
  const S = load(['_isSemesterUnclosed', 'openDateToSemPrefix']);
  assert.doesNotThrow(() => S._isSemesterUnclosed({}, '1141'));
  assert.equal(S._isSemesterUnclosed({}, '1141'), true); // 無任何證據 → 預設未結案
});

// ── _hasPastUnclosed：任一「早於本學期」的學期未結案即為 true ────────────────────
test('_hasPastUnclosed：存在早於本學期且未結案的學期 → true', () => {
  const S = load(['_hasPastUnclosed', '_isSemesterUnclosed', 'openDateToSemPrefix', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), // currentSemesterPrefix -> 1142
  });
  const c = { semesters: ['1141', '1142'] }; // 1141 早於本學期、無結案證據 → 未結案
  assert.equal(S._hasPastUnclosed(c), true);
});

test('_hasPastUnclosed：早於本學期的學期已結案 → false', () => {
  const S = load(['_hasPastUnclosed', '_isSemesterUnclosed', 'openDateToSemPrefix', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
  });
  const c = { semesters: ['1141', '1142'], semesterStatus: { 1141: 'closed' } };
  assert.equal(S._hasPastUnclosed(c), false);
});

test('_hasPastUnclosed：所有學期都不早於本學期 → false', () => {
  const S = load(['_hasPastUnclosed', '_isSemesterUnclosed', 'openDateToSemPrefix', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), // 本學期 1142
  });
  const c = { semesters: ['1142'] }; // 僅本學期，沒有「早於本學期」的學期
  assert.equal(S._hasPastUnclosed(c), false);
});

test('_hasPastUnclosed：無 semesters 時用 openDate fallback（單一學期陣列）', () => {
  const S = load(['_hasPastUnclosed', '_isSemesterUnclosed', 'openDateToSemPrefix', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
  });
  const c = { openDate: '2025-09-01' }; // -> 1141，早於本學期 1142，且無結案證據
  assert.equal(S._hasPastUnclosed(c), true);
});

test('_hasPastUnclosed：空物件（無 semesters 無 openDate）不炸、回 false', () => {
  const S = load(['_hasPastUnclosed', '_isSemesterUnclosed', 'openDateToSemPrefix', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
  });
  assert.doesNotThrow(() => S._hasPastUnclosed({}));
  assert.equal(S._hasPastUnclosed({}), false); // openDateToSemPrefix('') === '' → 該項被 s && 濾掉
});
