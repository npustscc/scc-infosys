// server/test/totp.test.js — TOTP（RFC 6238）／HOTP（RFC 4226）手刻實作單元測試。
// SHA1 測試向量取自 RFC 6238 附錄 B（Seed = ASCII "12345678901234567890"，20 bytes，8 位數輸出）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const totp = require('../src/auth/totp');

// RFC 6238 附錄 B 的 SHA1 seed：20 bytes ASCII "12345678901234567890"，以本模組自己的
// base32Encode 轉為 secret（不手動謄寫 base32 字串，避免謄寫錯誤——只要 base32Encode/Decode
// 互為正確反函式，用它自己編碼再解碼驗證的測試才有意義）。
const RFC_SEED_B32 = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));

// [Unix 時間（秒）, 預期 8 位數 TOTP（SHA1）]
const RFC_VECTORS_SHA1 = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('base32Encode/base32Decode 互為反函式（RFC 6238 seed roundtrip）', () => {
  const seed = Buffer.from('12345678901234567890', 'ascii');
  const decoded = totp.base32Decode(RFC_SEED_B32);
  assert.deepEqual(decoded, seed);
});

test('RFC 6238 附錄 B：SHA1 測試向量（8 位數）逐筆核對', () => {
  for (const [t, expected] of RFC_VECTORS_SHA1) {
    const got = totp.totp(RFC_SEED_B32, { digits: 8, forTimeSec: t });
    assert.equal(got, expected, `t=${t}`);
  }
});

test('hotp() 與 totp() 一致：totp 等同 hotp(secret, floor(t/30))', () => {
  const t = 1111111109;
  const counter = Math.floor(t / 30);
  assert.equal(totp.totp(RFC_SEED_B32, { digits: 8, forTimeSec: t }), totp.hotp(RFC_SEED_B32, counter, 8));
});

test('verifyTotp：6 位數預設，用官方向量的 mod-10^6（=8 位數向量的末 6 碼）驗證通過', () => {
  for (const [t, expected8] of RFC_VECTORS_SHA1) {
    const expected6 = expected8.slice(-6); // 10^6 整除 10^8，mod 10^6 恰為末 6 碼（含前導零）
    const ok = totp.verifyTotp(RFC_SEED_B32, expected6, { forTimeSec: t });
    assert.equal(ok, true, `t=${t}`);
  }
});

test('verifyTotp：驗證窗 ±1 步（30 秒）容忍時鐘漂移，超出範圍則拒絕', () => {
  const now = 1700000000;
  const code = totp.totp(RFC_SEED_B32, { forTimeSec: now });
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now }), true, '當下時間應通過');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now + 29 }), true, '+29 秒（同一步內）應通過');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now - 29 }), true, '-29 秒（前一步邊界內）應通過');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now + 31 }), true, '+31 秒（下一步，窗內）應通過');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now + 91 }), false, '+91 秒（超出 ±1 步窗）應拒絕');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, code, { forTimeSec: now - 91 }), false, '-91 秒（超出 ±1 步窗）應拒絕');
});

test('verifyTotp：錯誤碼／空值／非數字／secret 缺失一律拒絕（不拋例外）', () => {
  const now = 1700000000;
  const code = totp.totp(RFC_SEED_B32, { forTimeSec: now });
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal(totp.verifyTotp(RFC_SEED_B32, wrong, { forTimeSec: now }), false);
  assert.equal(totp.verifyTotp(RFC_SEED_B32, '', { forTimeSec: now }), false);
  assert.equal(totp.verifyTotp(RFC_SEED_B32, null, { forTimeSec: now }), false);
  assert.equal(totp.verifyTotp(RFC_SEED_B32, 'abcdef', { forTimeSec: now }), false);
  assert.equal(totp.verifyTotp(RFC_SEED_B32, '12', { forTimeSec: now }), false, '長度不符應拒絕');
  assert.equal(totp.verifyTotp('', code, { forTimeSec: now }), false, 'secret 缺失應拒絕');
  assert.equal(totp.verifyTotp(null, code, { forTimeSec: now }), false);
});

test('generateSecret：預設 20 bytes → 32 字元 base32（無 padding），且每次不同', () => {
  const s1 = totp.generateSecret();
  const s2 = totp.generateSecret();
  assert.equal(s1.length, 32);
  assert.match(s1, /^[A-Z2-7]+$/);
  assert.notEqual(s1, s2);
  assert.equal(totp.base32Decode(s1).length, 20);
});

test('generateSecret → totp → verifyTotp：端到端 roundtrip 通過', () => {
  const secret = totp.generateSecret();
  const code = totp.totp(secret);
  assert.equal(totp.verifyTotp(secret, code), true);
});

test('buildOtpauthUri：格式正確，含 issuer/label/secret/algorithm/digits/period', () => {
  const uri = totp.buildOtpauthUri('a@x.com', 'JBSWY3DPEHPK3PXP', '測試發行者');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
  assert.match(uri, new RegExp(encodeURIComponent('測試發行者')));
  assert.match(uri, new RegExp(encodeURIComponent('a@x.com')));
});

test('buildOtpauthUri：預設 issuer 為「SCC 資訊系統」', () => {
  const uri = totp.buildOtpauthUri('a@x.com', 'JBSWY3DPEHPK3PXP');
  assert.match(uri, new RegExp(encodeURIComponent('SCC 資訊系統')));
});

test('manualKeyGroups：4 碼一組以空白分隔', () => {
  assert.equal(totp.manualKeyGroups('JBSWY3DPEHPK3PXP'), 'JBSW Y3DP EHPK 3PXP');
  assert.equal(totp.manualKeyGroups('JBSWY3DP'), 'JBSW Y3DP');
});

// ── 與既有 otplib 依賴（Phase 1 骨架用於 local.js／測試）交叉驗證：同一 secret 在同一時刻
//    算出的碼必須一致，證明本模組與 otplib 默認參數（SHA1／30 秒／6 位數／window=1）相容，
//    現有資料（既有 users.totp_secret）與既有測試不會因改用手刻實作而失效。──
test('與 otplib 交叉驗證：同一 secret／同一時刻算出相同 6 位數碼', () => {
  const { authenticator } = require('otplib');
  const secret = totp.generateSecret();
  const otplibCode = authenticator.generate(secret);
  const ourCode = totp.totp(secret);
  assert.equal(ourCode, otplibCode);
  assert.equal(totp.verifyTotp(secret, otplibCode), true);
});
