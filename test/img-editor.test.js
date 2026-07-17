// v197 圖片編輯器：純函式單元測試（另存新附件檔名後綴、匯出格式決策）。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ── _imgEdEditedFileName：另存新附件的檔名後綴，重複編輯不疊加 ──────────────
test('_imgEdEditedFileName：一般檔名加上 -編輯 後綴（保留副檔名）', () => {
  const S = load(['_imgEdEditedFileName']);
  assert.equal(S._imgEdEditedFileName('照片.png'), '照片-編輯.png');
  assert.equal(S._imgEdEditedFileName('掃描件.jpg'), '掃描件-編輯.jpg');
});
test('_imgEdEditedFileName：已是 -編輯 結尾時不疊加（避免 -編輯-編輯-編輯…）', () => {
  const S = load(['_imgEdEditedFileName']);
  assert.equal(S._imgEdEditedFileName('照片-編輯.png'), '照片-編輯.png');
  assert.equal(S._imgEdEditedFileName(S._imgEdEditedFileName('照片.png')), '照片-編輯.png');
});
test('_imgEdEditedFileName：無副檔名時仍正確加後綴', () => {
  const S = load(['_imgEdEditedFileName']);
  assert.equal(S._imgEdEditedFileName('照片'), '照片-編輯');
});
test('_imgEdEditedFileName：空值/未命名時退回預設檔名再加後綴', () => {
  const S = load(['_imgEdEditedFileName']);
  assert.equal(S._imgEdEditedFileName(''), '附件-編輯');
  assert.equal(S._imgEdEditedFileName(null), '附件-編輯');
  assert.equal(S._imgEdEditedFileName(undefined), '附件-編輯');
});
test('_imgEdEditedFileName：檔名中間含多個點只切最後一個副檔名', () => {
  const S = load(['_imgEdEditedFileName']);
  assert.equal(S._imgEdEditedFileName('2026.06.15掃描.png'), '2026.06.15掃描-編輯.png');
});

// ── _imgEdExportFormat：位元組數 > 2MB 改用 JPEG，否則 PNG ──────────────────
test('_imgEdExportFormat：2MB 以下維持 PNG', () => {
  const S = load(['_imgEdExportFormat']);
  assert.equal(S._imgEdExportFormat(0), 'png');
  assert.equal(S._imgEdExportFormat(1024 * 1024), 'png');
  assert.equal(S._imgEdExportFormat(2 * 1024 * 1024), 'png'); // 邊界：剛好 2MB 不算超過
});
test('_imgEdExportFormat：超過 2MB 改用 JPEG', () => {
  const S = load(['_imgEdExportFormat']);
  assert.equal(S._imgEdExportFormat(2 * 1024 * 1024 + 1), 'jpeg');
  assert.equal(S._imgEdExportFormat(10 * 1024 * 1024), 'jpeg');
});

// ── _imgEdDataUrlByteLength：base64 data URL 還原位元組數估算 ────────────────
test('_imgEdDataUrlByteLength：已知內容的 data URL 估算出正確位元組數', () => {
  const S = load(['_imgEdDataUrlByteLength']);
  // 'PNG測試' 的 base64（Buffer 現算，避免測試檔內建錯誤基準）
  const raw = Buffer.from('hello world', 'utf8'); // 11 bytes
  const b64 = raw.toString('base64'); // 'aGVsbG8gd29ybGQ=' (含 1 個 '=' padding)
  assert.equal(S._imgEdDataUrlByteLength('data:text/plain;base64,' + b64), 11);
});
test('_imgEdDataUrlByteLength：無逗號（純 base64，無 data: 前綴）也能估算', () => {
  const S = load(['_imgEdDataUrlByteLength']);
  const raw = Buffer.from('a', 'utf8'); // 1 byte
  const b64 = raw.toString('base64'); // 'YQ==' (2 個 '=' padding)
  assert.equal(S._imgEdDataUrlByteLength(b64), 1);
});
test('_imgEdDataUrlByteLength：空值回 0，不炸', () => {
  const S = load(['_imgEdDataUrlByteLength']);
  assert.equal(S._imgEdDataUrlByteLength(''), 0);
  assert.equal(S._imgEdDataUrlByteLength(null), 0);
  assert.equal(S._imgEdDataUrlByteLength(undefined), 0);
});
