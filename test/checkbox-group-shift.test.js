// v205：全站勾選操作通用化——Shift 範圍選取共用純函式 _ckgRangeIndices。
// 全站所有「列級批次勾選」清單（個案列表、案號查詢與管理、待辦事項、身心調適假、psychTest／
// 服務總表／校級轉銜／教務處名單匯入預覽、PDF 頁面選擇器等）共用同一份範圍計算邏輯，見
// dev/index.html 內 SHIFT_RANGE_SELECT_CLASSES 事件委派機制，以及各 pt/ir/gt/wd/pdf 的
// xxSel／_pdfToggle 呼叫點。本檔只測純函式本身；DOM 事件委派、.click() 模擬等 DOM 相依邏輯
// 不在 harness 範圍內，需在 dev URL 端到端驗證。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_ckgRangeIndices']);
}

test('_ckgRangeIndices：正常升序範圍（from 在 to 之前）', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c', 'd', 'e'], 'b', 'd'), ['b', 'c', 'd']);
});

test('_ckgRangeIndices：反向點擊（先點後面那筆，再往前 shift+點）仍回傳同一段範圍', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c', 'd', 'e'], 'd', 'b'), ['b', 'c', 'd']);
});

test('_ckgRangeIndices：fromKey 與 toKey 相同 → 只回傳自己', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], 'b', 'b'), ['b']);
});

test('_ckgRangeIndices：fromKey 不在清單中（例如上次點擊的項目已被篩選掉）→ 退化為只回傳 toKey', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], 'zzz', 'b'), ['b']);
});

test('_ckgRangeIndices：toKey 不在清單中 → 退化為只回傳 toKey（呼叫端仍會處理該筆本身）', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], 'a', 'zzz'), ['zzz']);
});

test('_ckgRangeIndices：toKey 為 null/undefined（無有效點擊目標）→ 回傳空陣列', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], 'a', null), []);
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], 'a', undefined), []);
});

test('_ckgRangeIndices：數字型 key（DOM 順序索引／origIdx 等業務 id 皆可）', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices([0, 1, 2, 3, 4], 1, 3), [1, 2, 3]);
  assert.deepEqual(S._ckgRangeIndices([0, 1, 2, 3, 4], 3, 1), [1, 2, 3]);
});

test('_ckgRangeIndices：涵蓋整個清單頭尾', () => {
  const S = load_();
  const ids = ['x1', 'x2', 'x3', 'x4'];
  assert.deepEqual(S._ckgRangeIndices(ids, 'x1', 'x4'), ids);
});

test('_ckgRangeIndices：單一元素清單', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['only'], 'only', 'only'), ['only']);
});

test('_ckgRangeIndices：無上次點擊時（fromKey 為 -1 等哨兵值找不到）呼叫端應自行判斷不套用範圍——'
  + '本函式僅在被呼叫時退化回傳 [toKey]，符合各畫面「shift 但無上次點擊」時只處理本次點擊的慣例', () => {
  const S = load_();
  assert.deepEqual(S._ckgRangeIndices(['a', 'b', 'c'], -1, 'b'), ['b']);
});
