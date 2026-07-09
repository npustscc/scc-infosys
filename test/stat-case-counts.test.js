// 個案架構重構 Slice 4：統計雙指標——服務學生數 vs 開案人次相關純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const DEPS = ['_statCaseCounts', '_caseSems', '_semKeyBase', 'openDateToSemPrefix'];

// ── 單學期單開案 ──────────────────────────────────────────────────────────
test('_statCaseCounts：單學期單開案，未篩選學期 → students=1、openings=1', () => {
  const S = load(DEPS);
  const cases = [{ semesters: ['1142'] }];
  assert.deepEqual(S._statCaseCounts(cases, null), { students: 1, openings: 1 });
});

// ── 多學期 ────────────────────────────────────────────────────────────────
test('_statCaseCounts：單一學生跨 3 學期，未篩選學期 → students=1、openings=3', () => {
  const S = load(DEPS);
  const cases = [{ semesters: ['1141', '1142', '1151'] }];
  assert.deepEqual(S._statCaseCounts(cases, null), { students: 1, openings: 3 });
});

test('_statCaseCounts：多名學生分別跨學期，未篩選學期 → students/openings 各自加總', () => {
  const S = load(DEPS);
  const cases = [
    { semesters: ['1141', '1142'] }, // 2 次開案
    { semesters: ['1142'] },         // 1 次開案
    { semesters: [] },               // 無學期資料：仍算 1 位學生、0 人次
  ];
  assert.deepEqual(S._statCaseCounts(cases, null), { students: 3, openings: 3 });
});

// ── 同學期 #2 重複開案 ───────────────────────────────────────────────────
test('_statCaseCounts：同學期重複開案（#2）未篩選學期 → 該學生 openings 含 #N 各算 1 人次', () => {
  const S = load(DEPS);
  const cases = [{ semesters: ['1142', '1142#2'] }];
  assert.deepEqual(S._statCaseCounts(cases, null), { students: 1, openings: 2 });
});

// ── 學期篩選 ──────────────────────────────────────────────────────────────
test('_statCaseCounts：篩選某學期 → 只算該學期有開案的學生，openings 為該學期人次（含 #N）', () => {
  const S = load(DEPS);
  const cases = [
    { semesters: ['1141', '1142', '1142#2'] }, // 1142 開了 2 次
    { semesters: ['1141'] },                    // 未在 1142 開案
    { semesters: ['1142'] },                    // 1142 開了 1 次
  ];
  assert.deepEqual(S._statCaseCounts(cases, '1142'), { students: 2, openings: 3 });
});

test('_statCaseCounts：篩選學期時，該學期完全無開案的個案不計入 students/openings', () => {
  const S = load(DEPS);
  const cases = [{ semesters: ['1141'] }, { semesters: ['1151'] }];
  assert.deepEqual(S._statCaseCounts(cases, '1142'), { students: 0, openings: 0 });
});

test('_statCaseCounts：無 semesters[] 時退回 openDate 推算的學期參與篩選判斷', () => {
  const S = load(DEPS);
  const cases = [{ openDate: '2026-06-15' }]; // 推算為 1142
  assert.deepEqual(S._statCaseCounts(cases, '1142'), { students: 1, openings: 1 });
  assert.deepEqual(S._statCaseCounts(cases, '1141'), { students: 0, openings: 0 });
});

// ── 空資料 ────────────────────────────────────────────────────────────────
test('_statCaseCounts：空陣列 → students=0、openings=0（不論是否篩選學期）', () => {
  const S = load(DEPS);
  assert.deepEqual(S._statCaseCounts([], null), { students: 0, openings: 0 });
  assert.deepEqual(S._statCaseCounts([], '1142'), { students: 0, openings: 0 });
});

test('_statCaseCounts：cases 為 null/undefined 不炸，視同空陣列', () => {
  const S = load(DEPS);
  assert.deepEqual(S._statCaseCounts(null, null), { students: 0, openings: 0 });
  assert.deepEqual(S._statCaseCounts(undefined, '1142'), { students: 0, openings: 0 });
});
