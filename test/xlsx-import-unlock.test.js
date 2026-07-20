// test/xlsx-import-unlock.test.js — v212 Excel 匯入密碼解鎖／附件加密偵測 純函式測試。
// 涵蓋：CFB（舊版 OLE 容器）檔頭 magic number 判斷、SheetJS 加密錯誤訊息分類、Office 家族副檔名
// 分類（ooxml／legacy）、decryptOfficeFile 後端錯誤碼中文化。抽出對象皆為 dev/index.html 內無 DOM
// 依賴的純函式（見 test/harness.js）。這些函式是 _xlsxReadUnlocked／_attachMaybeUnlockOfficeFile
// 判斷「是否為加密檔」的核心邏輯，值得獨立單元測試覆蓋。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ══════════════ _xlsxHasCfbMagic：CFB（舊版 OLE 容器）檔頭 magic number ══════════════

test('_xlsxHasCfbMagic：完整 8 byte CFB magic → true', () => {
  const S = load(['_xlsxHasCfbMagic']);
  const bytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00]);
  assert.equal(S._xlsxHasCfbMagic(bytes), true);
});

test('_xlsxHasCfbMagic：ZIP／OOXML 檔頭（PK\\x03\\x04）→ false（非加密）', () => {
  const S = load(['_xlsxHasCfbMagic']);
  const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert.equal(S._xlsxHasCfbMagic(bytes), false);
});

test('_xlsxHasCfbMagic：不足 8 byte → false（不誤判）', () => {
  const S = load(['_xlsxHasCfbMagic']);
  assert.equal(S._xlsxHasCfbMagic(new Uint8Array([0xD0, 0xCF, 0x11])), false);
});

test('_xlsxHasCfbMagic：空／undefined → false', () => {
  const S = load(['_xlsxHasCfbMagic']);
  assert.equal(S._xlsxHasCfbMagic(new Uint8Array([])), false);
  assert.equal(S._xlsxHasCfbMagic(undefined), false);
});

test('_xlsxHasCfbMagic：前綴相符但中途岔開 → false', () => {
  const S = load(['_xlsxHasCfbMagic']);
  const bytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0xB1, 0x1A, 0xE1]);
  assert.equal(S._xlsxHasCfbMagic(bytes), false);
});

// ══════════════ _xlsxIsEncryptedError：SheetJS 拋錯訊息分類 ══════════════

test('_xlsxIsEncryptedError：新版 OOXML 加密的拋錯字樣 → true', () => {
  const S = load(['_xlsxIsEncryptedError']);
  assert.equal(S._xlsxIsEncryptedError('File is password-protected'), true);
});

test('_xlsxIsEncryptedError：新版 Excel 存出的舊版 .xls 加密拋錯字樣 → true', () => {
  const S = load(['_xlsxIsEncryptedError']);
  assert.equal(S._xlsxIsEncryptedError('Encryption Flags/AlgID mismatch'), true);
});

test('_xlsxIsEncryptedError：一般解析錯誤（非加密）→ false', () => {
  const S = load(['_xlsxIsEncryptedError']);
  assert.equal(S._xlsxIsEncryptedError('Unsupported file format'), false);
});

test('_xlsxIsEncryptedError：空字串／undefined → false', () => {
  const S = load(['_xlsxIsEncryptedError']);
  assert.equal(S._xlsxIsEncryptedError(''), false);
  assert.equal(S._xlsxIsEncryptedError(undefined), false);
});

// ══════════════ _officeExtFamily：Office 家族副檔名分類 ══════════════

test('_officeExtFamily：新版 OOXML 副檔名（xlsx/xlsm/docx/docm/pptx）→ ooxml', () => {
  const S = load(['_officeExtFamily']);
  assert.equal(S._officeExtFamily('a.xlsx'), 'ooxml');
  assert.equal(S._officeExtFamily('a.xlsm'), 'ooxml');
  assert.equal(S._officeExtFamily('a.docx'), 'ooxml');
  assert.equal(S._officeExtFamily('a.docm'), 'ooxml');
  assert.equal(S._officeExtFamily('a.pptx'), 'ooxml');
});

test('_officeExtFamily：舊版 BIFF/CFB 副檔名（xls/doc/ppt）→ legacy', () => {
  const S = load(['_officeExtFamily']);
  assert.equal(S._officeExtFamily('a.xls'), 'legacy');
  assert.equal(S._officeExtFamily('a.doc'), 'legacy');
  assert.equal(S._officeExtFamily('a.ppt'), 'legacy');
});

test('_officeExtFamily：非 Office 副檔名（pdf/jpg/csv）→ null（完全不攔）', () => {
  const S = load(['_officeExtFamily']);
  assert.equal(S._officeExtFamily('a.pdf'), null);
  assert.equal(S._officeExtFamily('a.jpg'), null);
  assert.equal(S._officeExtFamily('a.csv'), null);
});

test('_officeExtFamily：無副檔名／空字串 → null', () => {
  const S = load(['_officeExtFamily']);
  assert.equal(S._officeExtFamily('noext'), null);
  assert.equal(S._officeExtFamily(''), null);
  assert.equal(S._officeExtFamily(undefined), null);
});

test('_officeExtFamily：副檔名大小寫不分（.XLSX）', () => {
  const S = load(['_officeExtFamily']);
  assert.equal(S._officeExtFamily('報告.XLSX'), 'ooxml');
  assert.equal(S._officeExtFamily('舊檔.XLS'), 'legacy');
});

// ══════════════ _xlsxDecryptErrLabel：decryptOfficeFile 後端錯誤碼中文化 ══════════════

test('_xlsxDecryptErrLabel：已知錯誤碼轉中文提示', () => {
  const S = load(['_xlsxDecryptErrLabel']);
  assert.equal(S._xlsxDecryptErrLabel('wrong_password'), '密碼錯誤');
  assert.equal(S._xlsxDecryptErrLabel('decrypt_failed'), '解密失敗，檔案可能已毀損');
  assert.equal(S._xlsxDecryptErrLabel('file_too_large'), '檔案超過 20MB 上限，無法自動解密');
});

test('_xlsxDecryptErrLabel：未知代碼原樣回傳（讓上層仍可顯示原始訊息）', () => {
  const S = load(['_xlsxDecryptErrLabel']);
  assert.equal(S._xlsxDecryptErrLabel('Apps Script 呼叫失敗 (500)'), 'Apps Script 呼叫失敗 (500)');
});
