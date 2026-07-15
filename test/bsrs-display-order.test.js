// BSRS-5 顯示序 v181（回應 #037：全站改紙本順序，儲存索引語意不變）純函式測試。
// 執行：node --test test/*.test.js
//
// 對象：BSRS_DISPLAY_ORDER（顯示序→儲存索引映射常數）、_bsrsOrderedLabels（依顯示序排列
// {label,storageIdx}）、_bsrsValueAtDisplay（依顯示序取值）。
//
// BSRS_DISPLAY_ORDER 為 dev/index.html 內的頂層 const，harness 只能就地抽出具名函式、
// 抽不到頂層 const，故在此複製一份等價內容注入 extraGlobals（與 README 所述 CHUNK_SIZE
// 等常數注入模式一致）。若未來紙本順序調整，需同步更新這裡的複本。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// 紙本序：1.緊張 2.苦惱 3.憂鬱 4.比不上 5.睡眠；儲存序 [0]=睡眠 [1]=緊張 [2]=苦惱 [3]=憂鬱 [4]=比不上
const BSRS_DISPLAY_ORDER = [1, 2, 3, 4, 0];

function loadBsrs(names) {
  return load(names, { BSRS_DISPLAY_ORDER });
}

// 儲存序原始題目（與 dev/index.html 的 ML_ASSESS_BSRS_LABELS 語意相同順序，用簡短代稱方便斷言）
const STORAGE_LABELS = ['睡眠', '緊張', '苦惱', '憂鬱', '比不上'];

test('BSRS_DISPLAY_ORDER：是 0-4 的排列（雙向一致，不遺漏不重複儲存索引）', () => {
  const sorted = [...BSRS_DISPLAY_ORDER].sort((a, b) => a - b);
  assert.deepEqual(sorted, [0, 1, 2, 3, 4]);
});

test('_bsrsOrderedLabels：顯示序排列的題目文字＝紙本序（1.緊張 2.苦惱 3.憂鬱 4.比不上 5.睡眠）', () => {
  const S = loadBsrs(['_bsrsOrderedLabels']);
  const ordered = S._bsrsOrderedLabels(STORAGE_LABELS);
  assert.deepEqual(ordered.map(o => o.label), ['緊張', '苦惱', '憂鬱', '比不上', '睡眠']);
});

test('_bsrsOrderedLabels：每一項的 storageIdx 對回原本的儲存索引（語意不變）', () => {
  const S = loadBsrs(['_bsrsOrderedLabels']);
  const ordered = S._bsrsOrderedLabels(STORAGE_LABELS);
  assert.deepEqual(ordered.map(o => o.storageIdx), [1, 2, 3, 4, 0]);
  // 用 storageIdx 讀回，應與顯示序題目文字一一對應（不會讀錯題）
  ordered.forEach(({ label, storageIdx }) => {
    assert.equal(STORAGE_LABELS[storageIdx], label);
  });
});

test('_bsrsValueAtDisplay：依儲存序 bsrs 陣列，依顯示序位置取值——第 1 題（緊張）＝儲存索引 1 的值', () => {
  const S = loadBsrs(['_bsrsValueAtDisplay']);
  const bsrs = [10, 20, 30, 40, 50]; // [0]睡眠=10 [1]緊張=20 [2]苦惱=30 [3]憂鬱=40 [4]比不上=50
  assert.equal(S._bsrsValueAtDisplay(bsrs, 0), 20); // 顯示序第1題＝緊張＝儲存[1]
  assert.equal(S._bsrsValueAtDisplay(bsrs, 1), 30); // 第2題＝苦惱＝儲存[2]
  assert.equal(S._bsrsValueAtDisplay(bsrs, 2), 40); // 第3題＝憂鬱＝儲存[3]
  assert.equal(S._bsrsValueAtDisplay(bsrs, 3), 50); // 第4題＝比不上＝儲存[4]
  assert.equal(S._bsrsValueAtDisplay(bsrs, 4), 10); // 第5題＝睡眠＝儲存[0]
});

test('_bsrsValueAtDisplay：bsrsArr 為 null/undefined 不炸，回傳 undefined', () => {
  const S = loadBsrs(['_bsrsValueAtDisplay']);
  assert.equal(S._bsrsValueAtDisplay(null, 0), undefined);
  assert.equal(S._bsrsValueAtDisplay(undefined, 2), undefined);
});

test('雙向一致：依顯示序寫入後重建的儲存陣列，與原始儲存陣列完全相同（寫入語意不變）', () => {
  const S = loadBsrs(['_bsrsOrderedLabels']);
  const original = [1, 2, 3, 4, 5]; // 儲存序 [睡眠,緊張,苦惱,憂鬱,比不上] = [1,2,3,4,5]
  const ordered = S._bsrsOrderedLabels(STORAGE_LABELS); // 取得顯示序→儲存索引對照
  // 模擬「使用者依顯示序填答」：displayValues[displayIdx] 為使用者在畫面上第 displayIdx+1 題填的值，
  // 這裡直接借用 original 依顯示序排列後的值，模擬使用者照畫面順序填入
  const displayValues = ordered.map(({ storageIdx }) => original[storageIdx]);
  // 寫回儲存陣列：依 storageIdx 寫回對應位置
  const rebuilt = new Array(5);
  ordered.forEach(({ storageIdx }, displayIdx) => { rebuilt[storageIdx] = displayValues[displayIdx]; });
  assert.deepEqual(rebuilt, original);
});
