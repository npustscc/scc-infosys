// server/src/auth/local.js — 本地帳密＋TOTP 認證 provider（取代 Google ID token 登入）。
// 設計為可插拔（未來若要接校內 SSO，換掉這支即可，dispatcher/gate 不需改動）。
// 失敗一律回 null，不透露原因（帳號不存在／密碼錯／OTP 錯／已鎖定，外部觀察者看到的都一樣，
// 呼叫端一律回應 {error:'invalid_credentials'}）——避免帳號枚舉與鎖定狀態外洩。
//
// TOTP 驗證邏輯 Phase 3a 起改用本專案手刻的 auth/totp.js（RFC 6238，零新 npm 依賴），取代 Phase 1
// 骨架暫時借用的 otplib——base32 secret 格式與預設參數（SHA1／30 秒／6 位數／window=1）相容，
// 既有資料（users.totp_secret）與既有測試（本檔／auth-local.test.js 用 otplib 交叉產碼）不受影響。
'use strict';

const argon2 = require('argon2');
const totp = require('./totp');

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 }; // m=64MiB, t=3
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_SEC = 15 * 60;

async function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTS);
}

function generateTotpSecret() {
  return totp.generateSecret();
}

function totpKeyUri(email, secret, issuer = 'SCC-InfoSys') {
  return totp.buildOtpauthUri(email, secret, issuer);
}

function getUser(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

function isLocked(user, nowSec) {
  return !!(user.locked_until && Number(user.locked_until) > nowSec);
}

function registerFailure(db, user, nowSec) {
  const attempts = (user.failed_attempts || 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? nowSec + LOCK_DURATION_SEC : user.locked_until;
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE email = ?')
    .run(attempts, lockedUntil || null, new Date().toISOString(), user.email);
}

function registerSuccess(db, user) {
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?')
    .run(new Date().toISOString(), user.email);
}

// 詳細版：回傳 {kind, email?, totpEnrolled?}，供 sessionStart 分辨「未輸入 TOTP」與「TOTP 錯誤」——
// 但僅在密碼已驗證正確的前提下才進一步分辨；帳號不存在/停用/鎖定/密碼錯一律回同一種
// kind:'invalid_credentials'（不透露原因，避免帳號枚舉與鎖定狀態外洩，維持本檔頭註解的既有原則）。
//   kind: 'invalid_credentials' — 密碼／帳號本身有問題
//   kind: 'totp_required'       — 密碼正確、該帳號已註冊 TOTP，但本次未附 otp
//   kind: 'invalid_totp'        — 密碼正確、已註冊 TOTP，但 otp 錯誤
//   kind: 'ok'                  — 通過（未註冊 TOTP，或已註冊且 otp 正確）
async function verifyLocalCredentialsDetailed(db, email, password, otp, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  if (!email || !password) return { kind: 'invalid_credentials' };
  const user = getUser(db, email);
  if (!user) return { kind: 'invalid_credentials' };
  if (user.disabled) return { kind: 'invalid_credentials' };
  if (isLocked(user, nowSec)) return { kind: 'invalid_credentials' };

  let passwordOk = false;
  try { passwordOk = await argon2.verify(user.password_hash, password); } catch (_e) { passwordOk = false; }
  if (!passwordOk) { registerFailure(db, user, nowSec); return { kind: 'invalid_credentials' }; }

  if (user.totp_enrolled && user.totp_secret) {
    const otpStr = String(otp == null ? '' : otp).trim();
    if (!otpStr) return { kind: 'totp_required' };
    let otpOk = false;
    try { otpOk = totp.verifyTotp(user.totp_secret, otpStr); } catch (_e) { otpOk = false; }
    if (!otpOk) { registerFailure(db, user, nowSec); return { kind: 'invalid_totp' }; }
  }

  registerSuccess(db, user);
  return { kind: 'ok', email: user.email, totpEnrolled: !!user.totp_enrolled };
}

// 精簡版（既有呼叫端／測試相容）：驗證通過回 email；任何失敗（帳號不存在/停用/鎖定/密碼錯/OTP 錯）
// 一律回 null，語意等同 verifyLocalCredentialsDetailed 的 kind !== 'ok'。
async function verifyLocalCredentials(db, email, password, otp, nowMs = Date.now()) {
  const result = await verifyLocalCredentialsDetailed(db, email, password, otp, nowMs);
  return result.kind === 'ok' ? result.email : null;
}

// scripts/create-user.js 用：新建或更新帳號（upsert）。totpSecret 若提供，視為直接以「已註冊」
// 狀態灌入（管理者代為設定的情境）；不提供則不動 totp_enrolled/totp_pending_secret 既有值，
// 只在該欄位當前為 NULL/0 的新建情境下維持未註冊——**注意**：此函式為整欄覆寫工具，
// 對既有帳號重跑且不傳 totpSecret 會把 totp_secret/totp_enrolled 重置為未註冊，此為 Phase 1
// 骨架即有的既有行為（僅供管理者手動操作腳本使用），非本次新增。
async function upsertUser(db, email, password, { totpSecret = null, disabled = false } = {}) {
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  const enrolled = totpSecret ? 1 : 0;
  const enrolledAt = totpSecret ? now : null;
  db.prepare(
    `INSERT INTO users (email, password_hash, totp_secret, totp_enrolled, totp_enrolled_at, disabled, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       totp_secret   = excluded.totp_secret,
       totp_enrolled = excluded.totp_enrolled,
       totp_enrolled_at = excluded.totp_enrolled_at,
       disabled      = excluded.disabled,
       failed_attempts = 0,
       locked_until    = NULL,
       updated_at    = excluded.updated_at`
  ).run(email, hash, totpSecret, enrolled, enrolledAt, disabled ? 1 : 0, now, now);
}

module.exports = {
  hashPassword,
  generateTotpSecret,
  totpKeyUri,
  getUser,
  isLocked,
  verifyLocalCredentials,
  verifyLocalCredentialsDetailed,
  upsertUser,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_SEC,
};
