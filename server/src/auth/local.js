// server/src/auth/local.js — 本地帳密＋TOTP 認證 provider（取代 Google ID token 登入）。
// 設計為可插拔（未來若要接校內 SSO，換掉這支即可，dispatcher/gate 不需改動）。
// 失敗一律回 null，不透露原因（帳號不存在／密碼錯／OTP 錯／已鎖定，外部觀察者看到的都一樣，
// 呼叫端一律回應 {error:'invalid_credentials'}）——避免帳號枚舉與鎖定狀態外洩。
'use strict';

const argon2 = require('argon2');
const { authenticator } = require('otplib');

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 }; // m=64MiB, t=3
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_SEC = 15 * 60;

async function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTS);
}

function generateTotpSecret() {
  return authenticator.generateSecret();
}

function totpKeyUri(email, secret, issuer = 'SCC-InfoSys') {
  return authenticator.keyuri(email, issuer, secret);
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

// 驗證通過回 email；任何失敗（帳號不存在/停用/鎖定/密碼錯/OTP 錯）一律回 null。
async function verifyLocalCredentials(db, email, password, otp, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  if (!email || !password) return null;
  const user = getUser(db, email);
  if (!user) return null;
  if (user.disabled) return null;
  if (isLocked(user, nowSec)) return null;

  let passwordOk = false;
  try { passwordOk = await argon2.verify(user.password_hash, password); } catch (_e) { passwordOk = false; }
  if (!passwordOk) { registerFailure(db, user, nowSec); return null; }

  if (user.totp_secret) {
    let otpOk = false;
    try { otpOk = authenticator.check(String(otp || ''), user.totp_secret); } catch (_e) { otpOk = false; }
    if (!otpOk) { registerFailure(db, user, nowSec); return null; }
  }

  registerSuccess(db, user);
  return user.email;
}

// scripts/create-user.js 用：新建或更新帳號（upsert）。
async function upsertUser(db, email, password, { totpSecret = null, disabled = false } = {}) {
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (email, password_hash, totp_secret, disabled, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       totp_secret   = excluded.totp_secret,
       disabled      = excluded.disabled,
       failed_attempts = 0,
       locked_until    = NULL,
       updated_at    = excluded.updated_at`
  ).run(email, hash, totpSecret, disabled ? 1 : 0, now, now);
}

module.exports = {
  hashPassword,
  generateTotpSecret,
  totpKeyUri,
  getUser,
  isLocked,
  verifyLocalCredentials,
  upsertUser,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_SEC,
};
