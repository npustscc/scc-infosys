// 一學生一案號（個案架構重構 Slice 1）：同學期重複開案 sem key（'#N' 後綴）相關純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ── _semKeyBase：去除 '#N' 後綴取原始學期前綴 ────────────────────────────────
test('_semKeyBase：無 # 原樣回傳；有 # 取前段；空值回空字串', () => {
  const S = load(['_semKeyBase']);
  assert.equal(S._semKeyBase('1142'), '1142');
  assert.equal(S._semKeyBase('1142#2'), '1142');
  assert.equal(S._semKeyBase('1142#3'), '1142');
  assert.equal(S._semKeyBase(''), '');
  assert.equal(S._semKeyBase(null), '');
  assert.equal(S._semKeyBase(undefined), '');
});

// ── _caseSems：個案的學期 key 陣列（含 #N），無 semesters[] 時退回 openDate 推算 ──
test('_caseSems：有 semesters[] 時原樣回傳（含 #N key）', () => {
  const S = load(['_caseSems', 'openDateToSemPrefix']);
  assert.deepEqual(S._caseSems({ semesters: ['1141', '1142', '1142#2'] }), ['1141', '1142', '1142#2']);
});
test('_caseSems：無 semesters[] 時以 openDate 推算單一學期', () => {
  const S = load(['_caseSems', 'openDateToSemPrefix']);
  assert.deepEqual(S._caseSems({ openDate: '2026-06-15' }), ['1142']);
  assert.deepEqual(S._caseSems({}), []);
});

// ── _caseHasSem：base 比對，含 #N 重複開案的學期 ────────────────────────────
test('_caseHasSem：base 相符即算已開過（不論是否帶 #N）', () => {
  const S = load(['_caseHasSem', '_caseSems', '_semKeyBase', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142', '1142#2'] };
  assert.equal(S._caseHasSem(c, '1141'), true);
  assert.equal(S._caseHasSem(c, '1142'), true); // 1142 或 1142#2 皆算已開過 1142
  assert.equal(S._caseHasSem(c, '1151'), false);
});

// ── _nextSemOpenKey：該學期未開過→原樣；已開過 N 次→回 'sem#(N+1)' ──────────
test('_nextSemOpenKey：該學期尚未開過 → 回傳原樣 sem', () => {
  const S = load(['_nextSemOpenKey', '_caseSems', '_semKeyBase', 'openDateToSemPrefix']);
  const c = { semesters: ['1141'] };
  assert.equal(S._nextSemOpenKey(c, '1142'), '1142');
});
test('_nextSemOpenKey：已開過一次（僅 base key）→ 回傳 sem#2', () => {
  const S = load(['_nextSemOpenKey', '_caseSems', '_semKeyBase', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142'] };
  assert.equal(S._nextSemOpenKey(c, '1142'), '1142#2');
});
test('_nextSemOpenKey：已開過兩次（base + #2）→ 回傳 sem#3', () => {
  const S = load(['_nextSemOpenKey', '_caseSems', '_semKeyBase', 'openDateToSemPrefix']);
  const c = { semesters: ['1141', '1142', '1142#2'] };
  assert.equal(S._nextSemOpenKey(c, '1142'), '1142#3');
});

// ── semesterLabel：'#N' 後綴轉可讀標籤（'1142#2' → '114-2_2'）────────────────
test('semesterLabel：帶 #N 後綴時附加 _N；不影響既有無 # 輸入行為', () => {
  const S = load(['semesterLabel']);
  assert.equal(S.semesterLabel('1142#2'), '114-2_2');
  assert.equal(S.semesterLabel('1142#3'), '114-2_3');
  assert.equal(S.semesterLabel('1142'), '114-2'); // 既有行為不變
  assert.equal(S.semesterLabel(''), '—');
  assert.equal(S.semesterLabel('11'), '11');
});

// ── semesterMonths：'#N' 後綴等同 base ──────────────────────────────────────
test('semesterMonths：帶 #N 後綴時等同 base 的月份', () => {
  const S = load(['semesterMonths']);
  assert.deepEqual(S.semesterMonths('1142#2'), S.semesterMonths('1142'));
  assert.deepEqual(S.semesterMonths('1141#3'), S.semesterMonths('1141'));
});

// ── nextSemesterPrefix：'#N' 後綴等同 base ──────────────────────────────────
test('nextSemesterPrefix：帶 #N 後綴時等同 base 的下一學期', () => {
  const S = load(['nextSemesterPrefix']);
  assert.equal(S.nextSemesterPrefix('1142#2'), S.nextSemesterPrefix('1142'));
  assert.equal(S.nextSemesterPrefix('1142#2'), '1151');
});

// ── _semPrefixToApproxDate / _semPrefixToEndDate：'#N' 後綴等同 base ────────
test('_semPrefixToApproxDate：帶 #N 後綴時等同 base', () => {
  const S = load(['_semPrefixToApproxDate']);
  assert.equal(S._semPrefixToApproxDate('1142#2'), S._semPrefixToApproxDate('1142'));
});
test('_semPrefixToEndDate：帶 #N 後綴時等同 base', () => {
  const S = load(['_semPrefixToEndDate']);
  assert.equal(S._semPrefixToEndDate('1142#2'), S._semPrefixToEndDate('1142'));
});
