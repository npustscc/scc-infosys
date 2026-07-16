// server/src/auth/totp.js — RFC 6238（TOTP）＋ RFC 4226（HOTP）手刻實作，零新 npm 依賴
// （只用 node:crypto）。取代 Phase 1 骨架暫時借用的 otplib：secret 格式（RFC 4648 base32、
// 無 padding）與預設參數（SHA1／30 秒步長／6 位數／驗證窗 ±1 步）均與 otplib 相容，
// 舊資料（既有 users.totp_secret）與既有測試（auth-local.test.js 用 otplib 產生驗證碼交叉驗證）
// 不受影響。
//
// 驗證窗 ±1 步＝允許使用者裝置時鐘漂移最多 30 秒（RFC 6238 §5.2 建議值），同時也是最小化
// 「允許的有效碼視窗」以降低被截碼重放的風險（不做更大範圍是刻意的）。
'use strict';

const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── base32（RFC 4648 §6）編解碼：secret 對外一律以 base32 文字表示（otpauth URI 與手動輸入用）──

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out; // 刻意不補 '=' padding（otpauth URI／手動輸入慣例皆不帶 padding）
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ── 高熵 secret 產生：160 bits（20 bytes）＝ RFC 6238 附錄 B 測試向量與多數驗證器 App 的慣用長度 ──

function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

// ── HOTP（RFC 4226）：HMAC-SHA1(secret, counter 8-byte big-endian) → 動態截斷 → mod 10^digits ──

function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  // counter 是非負整數（時間/30 秒，實務上遠小於 2^53），用 BigInt 寫入避免 32 位元溢位疑慮。
  counterBuf.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(counter))));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, '0');
}

// ── TOTP（RFC 6238）：counter = floor(unixSec / step），T0=0 ──

function totp(secretBase32, { step = 30, digits = 6, forTimeSec = Math.floor(Date.now() / 1000) } = {}) {
  const counter = Math.floor(forTimeSec / step);
  return hotp(secretBase32, counter, digits);
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// 驗證：允許 ±window 步（預設 ±1＝最多 30 秒時鐘漂移）；token 需為純數字字串（含前導零）。
function verifyTotp(secretBase32, token, { step = 30, digits = 6, window = 1, forTimeSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secretBase32) return false;
  const t = String(token == null ? '' : token).trim();
  if (!t || !/^\d+$/.test(t) || t.length !== digits) return false;
  const counter = Math.floor(forTimeSec / step);
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(secretBase32, counter + w, digits);
    if (timingSafeEqualStr(candidate, t)) return true;
  }
  return false;
}

// otpauth:// URI（RFC：https://github.com/google/google-authenticator/wiki/Key-Uri-Format）。
// label＝issuer:email（雙重帶 issuer 是慣例：一次在 label 一次在 query，相容各家驗證器 App）。
function buildOtpauthUri(email, secret, issuer = 'SCC 資訊系統') {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email || '')}`;
  const qs = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${qs.toString()}`;
}

// 手動輸入用分組顯示（4 碼一組，驗證器 App 手動輸入頁常見排版）。
function manualKeyGroups(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  buildOtpauthUri,
  manualKeyGroups,
};
