// server/test/qrcode.test.js — 手刻 QR code 編碼器（src/util/qrcode.js）單元測試。
// 沒有 QR 解碼器可用，無法做「掃出來的內容等於輸入」這種端對端驗證（見任務回報的自我驗證說明）；
// 本檔改為驗證幾個「錯了一定掃不出來」的結構性不變量：版本↔尺寸公式、三個定位點（finder pattern）
// 的位置與圖案、輸出 deterministic、遞增長度輸入不因版本升級而拋錯。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const qrcode = require('../src/util/qrcode');

// 標準 7x7 定位點圖案（見 ISO/IEC 18004）：外圈實心方框、內圈留白、正中央 3x3 實心。
// true=深色, false=淺色。
const FINDER_PATTERN = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
].map((row) => row.map(Boolean));

function assertFinderAt(matrix, topRow, leftCol, label) {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      assert.equal(
        matrix[topRow + r][leftCol + c],
        FINDER_PATTERN[r][c],
        `${label} 定位點 (${r},${c}) 應為 ${FINDER_PATTERN[r][c]}`
      );
    }
  }
}

test('moduleCount 尺寸公式：4*version+17，且與資料長度對應的版本一致遞增', () => {
  const shortResult = qrcode.generate('a', 'M');
  const version = (shortResult.moduleCount - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 40, '版本須為 1~40 整數');
  assert.equal(shortResult.moduleCount, 4 * version + 17);
  assert.equal(shortResult.matrix.length, shortResult.moduleCount);
  assert.equal(shortResult.matrix[0].length, shortResult.moduleCount);

  // 內容變長 → 版本不會變小（自動選版是單調的：裝不下才升版）。
  const longer = 'x'.repeat(200);
  const longResult = qrcode.generate(longer, 'M');
  const longVersion = (longResult.moduleCount - 17) / 4;
  assert.ok(longVersion >= version, '較長內容所需版本不應小於較短內容');
});

test('三個定位點（finder pattern）分別位於左上／右上／左下，圖案正確', () => {
  const otpauthUri = 'otpauth://totp/SCC-InfoSys:a%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=SCC-InfoSys&algorithm=SHA1&digits=6&period=30';
  const { matrix, moduleCount } = qrcode.generate(otpauthUri, 'M');
  assertFinderAt(matrix, 0, 0, '左上');
  assertFinderAt(matrix, 0, moduleCount - 7, '右上');
  assertFinderAt(matrix, moduleCount - 7, 0, '左下');
});

test('同樣輸入多次呼叫 → 輸出 deterministic（矩陣逐格相同）', () => {
  const text = 'otpauth://totp/SCC-InfoSys:b@x.com?secret=ABCDEFGHIJKLMNOP&issuer=SCC-InfoSys';
  const r1 = qrcode.generate(text, 'M');
  const r2 = qrcode.generate(text, 'M');
  assert.equal(r1.moduleCount, r2.moduleCount);
  assert.deepStrictEqual(r1.matrix, r2.matrix);
});

test('不同長度輸入（很短到接近版本上限）自動升版，全程不拋錯', () => {
  // 每次遞增一段長度，涵蓋多次版本跳級（M 等級 byte mode，版本 1~約 20 的容量範圍）。
  for (let len = 1; len <= 700; len += 17) {
    const text = 'Q'.repeat(len);
    let result;
    assert.doesNotThrow(() => { result = qrcode.generate(text, 'M'); }, `長度 ${len} 不應拋錯`);
    const version = (result.moduleCount - 17) / 4;
    assert.ok(Number.isInteger(version) && version >= 1 && version <= 40);
  }
});

test('不同糾錯等級（L/M/Q/H）皆可正常產生矩陣', () => {
  const text = 'otpauth://totp/test?secret=ABCDEFGH';
  for (const level of ['L', 'M', 'Q', 'H']) {
    const result = qrcode.generate(text, level);
    assert.ok(result.moduleCount > 0);
  }
});

test('toAsciiArt：純粹外觀輔助函式，回傳字串且行數等於 moduleCount', () => {
  const result = qrcode.generate('abc', 'M');
  const art = qrcode.toAsciiArt(result);
  assert.equal(typeof art, 'string');
  assert.equal(art.split('\n').length, result.moduleCount);
});
