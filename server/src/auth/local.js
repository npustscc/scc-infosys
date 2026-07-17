// server/src/auth/local.js — 本地帳密＋TOTP／Email 驗證碼認證 provider（取代 Google ID token 登入）。
// 設計為可插拔（未來若要接校內 SSO，換掉這支即可，dispatcher/gate 不需改動）。
// 失敗一律回 null（精簡版 verifyLocalCredentials），不透露原因（帳號不存在／密碼錯／OTP 錯／
// 已鎖定，外部觀察者看到的都一樣，呼叫端一律回應 {error:'invalid_credentials'}）——避免帳號
// 枚舉與鎖定狀態外洩。
//
// TOTP 驗證邏輯 Phase 3a 起改用本專案手刻的 auth/totp.js（RFC 6238，零新 npm 依賴），取代 Phase 1
// 骨架暫時借用的 otplib——base32 secret 格式與預設參數（SHA1／30 秒／6 位數／window=1）相容，
// 既有資料（users.totp_secret）與既有測試（本檔／auth-local.test.js 用 otplib 交叉產碼）不受影響。
//
// Email 驗證碼（第二因素後備，migration 004）：本檔只負責「決定要不要寄／寄什麼碼／驗證碼是否
// 正確」這些純 DB 操作，不觸網——實際寄信（需要 config/mailer）由 actions/session.js 負責，比照
// v166 登入通知信既有的分工（本檔決策、actions 層執行 I/O）。
'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');
const totp = require('./totp');
const audit = require('../audit');

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 }; // m=64MiB, t=3
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_SEC = 15 * 60;

// ── 帳號發放與管理（migration 005）：登入帳號別名層＋首登強制改密碼 ──
// 三種身分發放皆用同一組初始密碼，首登（must_change_password=1）強制改掉，見
// verifyLocalCredentialsDetailed 的 kind:'password_change_required'／'weak_new_password' 分支。
const DEFAULT_INITIAL_PASSWORD = '123456789';
const NEW_PASSWORD_MIN_LEN = 8;

// Email 驗證碼參數：10 分鐘效期、60 秒防重寄冷卻、單一碼最多試 5 次（碼本身的用盡上限，
// 與下方共用的帳號級 failed_attempts/locked_until 是兩層不同的節流——見 migration 004 檔頭註解）。
const EMAIL_OTP_TTL_MIN = 10;
const EMAIL_OTP_RESEND_COOLDOWN_SEC = 60;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

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

// 以「登入帳號」查（大小寫不敏感——存小寫、查小寫，見 migration 005）。查無一律回 null，
// **不** fallback 以 email 欄位再查一次——backfill 已保證舊帳號 login_name=lower(email)，
// 不需要也不該有第二條查詢路徑（見任務決策：內部 email 與登入帳號徹底脫鉤）。
function getUserByLogin(db, loginName) {
  const norm = String(loginName == null ? '' : loginName).trim().toLowerCase();
  if (!norm) return null;
  return db.prepare('SELECT * FROM users WHERE login_name = ?').get(norm) || null;
}

// 新密碼政策（首登強制改密碼／管理者重設密碼後生效）：≥8 碼、不得等於初始密碼、不得與目前密碼
// 相同（比對目前 hash，故為 async）。回傳 {ok:true} 或 {ok:false, reason}，reason 對映
// verifyLocalCredentialsDetailed 的 kind:'weak_new_password' 附帶值，供 dispatch.js 組成
// 'weak_new_password:<reason>' bizError、login.html 對映成中文訊息。
async function validateNewPassword(newPassword, user) {
  const pw = String(newPassword == null ? '' : newPassword);
  if (pw.length < NEW_PASSWORD_MIN_LEN) return { ok: false, reason: 'too_short' };
  if (pw === DEFAULT_INITIAL_PASSWORD) return { ok: false, reason: 'same_as_default' };
  let sameAsOld = false;
  try { sameAsOld = await argon2.verify(user.password_hash, pw); } catch (_e) { sameAsOld = false; }
  if (sameAsOld) return { ok: false, reason: 'same_as_old' };
  return { ok: true };
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

// ── Email 驗證碼（第二因素後備，migration 004）──

function hashEmailOtp(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

// 決定該帳號登入時要用哪種第二因素：'totp' | 'email' | null（未設定，照舊放行）。
// twofa_method 為 NULL 但已註冊 TOTP → 視為選了 'totp'：本欄位是本次新增（migration 004），既有
// 已註冊 TOTP 的帳號在欄位補上之前的預設值就是 NULL，不能因為欄位新增就讓這些帳號突然「未設定
// 第二因素」而失去既有保護，故以 totp_enrolled 補位判斷。
function resolveTwofaMethod(user) {
  if (user.twofa_method === 'totp' || user.twofa_method === 'email') return user.twofa_method;
  if (user.totp_enrolled) return 'totp';
  return null;
}

// 60 秒防重寄：email_otp_sent_at 為 NULL（從未寄過／已清空）視為可寄。
function canResendEmailOtp(user, nowMs = Date.now()) {
  if (!user.email_otp_sent_at) return true;
  const lastMs = Date.parse(user.email_otp_sent_at);
  if (!Number.isFinite(lastMs)) return true;
  return (nowMs - lastMs) >= EMAIL_OTP_RESEND_COOLDOWN_SEC * 1000;
}

// 產生新碼＋存雜湊＋重置本輪嘗試次數＋更新寄送時間戳，回傳明文碼（唯一會出現明文的地方——
// 呼叫端(actions/session.js) 只能把它放進要寄出的信件內文，不可落地／log，見任務機密紀律）。
function issueEmailOtp(db, email, nowMs = Date.now()) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + EMAIL_OTP_TTL_MIN * 60 * 1000).toISOString();
  db.prepare(
    `UPDATE users SET email_otp_hash = ?, email_otp_expires_at = ?, email_otp_attempts = 0,
       email_otp_sent_at = ?, updated_at = ? WHERE email = ?`
  ).run(hashEmailOtp(code), expiresAt, now, now, email);
  return code;
}

// 驗證：未過期、本輪嘗試次數未達上限、雜湊比對相符（常數時間比對，比照 auth/deviceTrust.js
// 對 token 雜湊的比對手法）。任何一項不符一律回 false，不細分原因（呼叫端統一回 invalid_email_otp）。
function checkEmailOtp(user, code, nowMs = Date.now()) {
  if (!user.email_otp_hash || !user.email_otp_expires_at) return false;
  const expiresMs = Date.parse(user.email_otp_expires_at);
  if (!Number.isFinite(expiresMs) || nowMs > expiresMs) return false;
  if ((user.email_otp_attempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS) return false;
  const expected = Buffer.from(user.email_otp_hash, 'hex');
  const actual = Buffer.from(hashEmailOtp(code), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function bumpEmailOtpAttempts(db, email) {
  db.prepare('UPDATE users SET email_otp_attempts = email_otp_attempts + 1 WHERE email = ?').run(email);
}

// ── 收驗證碼用的 Email 清單（1~3 個，migration 004 otp_emails 欄）──

const OTP_EMAIL_MAX = 3;
const OTP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 驗證＋正規化：trim → 去空字串 → 小寫＋去重 → 數量須 1~3 → 逐一格式檢查（含 @ 與 .）。
// 回傳 { emails } 或 { error }（error 為業務錯誤代碼，供 actions/twofa.js／sessionStart 直接
// 當 kind／bizError 用，風格比照既有的 'totp_not_enrolled'）：
//   'otp_emails_required'  — 正規化後 0 個（未附 emails，或全部是空字串）
//   'too_many_otp_emails'  — 正規化後（去重）仍超過 3 個
//   'invalid_otp_email'    — 有任一項不符基本 email 格式
function normalizeOtpEmails(rawList) {
  if (!Array.isArray(rawList)) return { error: 'otp_emails_required' };
  const trimmed = rawList.map((e) => String(e == null ? '' : e).trim()).filter(Boolean);
  if (trimmed.length === 0) return { error: 'otp_emails_required' };
  const deduped = Array.from(new Set(trimmed.map((e) => e.toLowerCase())));
  if (deduped.length > OTP_EMAIL_MAX) return { error: 'too_many_otp_emails' };
  for (const e of deduped) {
    if (!OTP_EMAIL_RE.test(e)) return { error: 'invalid_otp_email' };
  }
  return { emails: deduped };
}

// 讀出目前設定的收件清單（JSON 解析失敗／欄位為 NULL 一律視為空陣列，不拋錯）。
function parseOtpEmails(user) {
  if (!user || !user.otp_emails) return [];
  try {
    const arr = JSON.parse(user.otp_emails);
    return Array.isArray(arr) ? arr.filter((e) => typeof e === 'string' && e) : [];
  } catch (_e) {
    return [];
  }
}

// 實際寄送目標：otp_emails 有值就用它，空（理論上不會發生，twofaSetMethod 已擋 0 個的情境）則
// 防禦性 fallback 回帳號本身 email——帳號名本身就是 email，永遠有值，確保「寄不出去」不會發生在
// 這一層（真正寄不出去只會是 mailer/Gmail API 的問題，見 actions/session.js 的 email_otp_unavailable）。
function emailOtpRecipients(user) {
  const list = parseOtpEmails(user);
  return list.length > 0 ? list : [user.email];
}

// 單次有效：驗證通過後清空，同一碼不能重放；也讓下次「需要第二因素」時的 60 秒防重寄冷卻歸零
// （不留上一輪的 sent_at 卡住下一輪首次寄送）。
function clearEmailOtp(db, email) {
  db.prepare(
    `UPDATE users SET email_otp_hash = NULL, email_otp_expires_at = NULL,
       email_otp_attempts = 0, email_otp_sent_at = NULL WHERE email = ?`
  ).run(email);
}

// 詳細版：回傳 {kind, email?, totpEnrolled?, ...}，供 sessionStart 分辨各種「還差一步」的狀態——
// 但僅在密碼已驗證正確的前提下才進一步分辨；帳號不存在/停用/鎖定/密碼錯一律回同一種
// kind:'invalid_credentials'（不透露原因，避免帳號枚舉與鎖定狀態外洩，維持本檔頭註解的既有原則）。
//   kind: 'invalid_credentials'    — 密碼／帳號本身有問題
//   kind: 'password_change_required' — 密碼正確、must_change_password=1（或密碼字串本身就是初始
//                                     密碼，見下方補洞保險），但本次未附 newPassword（首登強制改
//                                     密碼，見 DEFAULT_INITIAL_PASSWORD 檔頭註解）。
//   kind: 'weak_new_password'      — 密碼正確、附了 newPassword，但未通過 validateNewPassword 政策
//                                     檢查——附帶 reason（'too_short'|'same_as_default'|'same_as_old'）。
//   kind: 'totp_required'          — 密碼正確、該帳號選用 TOTP，但本次未附 otp
//   kind: 'invalid_totp'           — 密碼正確、選用 TOTP，但 otp 錯誤
//   kind: 'email_otp_required'     — 密碼正確、該帳號選用 Email 驗證碼，但本次未附 emailOtp——
//                                     附帶 emailOtpCode（null 表示 60 秒防重寄冷卻中，不寄新碼）、
//                                     resent（是否本次真的產生了新碼）、emailOtpRecipients（要寄去
//                                     的 1~3 個地址，見 emailOtpRecipients），供 actions/session.js
//                                     決定是否觸網寄信、寄給誰（本函式不觸網，見檔頭註解）。
//   kind: 'invalid_email_otp'      — 密碼正確、選用 Email 驗證碼，但 emailOtp 錯誤／過期／已用盡次數
//   kind: 'otp_emails_required'    — switchToEmailOtp 生效時，otpEmails 正規化後 0 個
//   kind: 'too_many_otp_emails'    — switchToEmailOtp 生效時，otpEmails 正規化後仍超過 3 個
//   kind: 'invalid_otp_email'      — switchToEmailOtp 生效時，otpEmails 內有格式不正確的項目
//   kind: 'ok'                     — 通過（未設定第二因素，或 TOTP／Email 驗證碼其中一種驗證通過）
//
// loginName：使用者輸入的「登入帳號」（migration 005 起與內部身分 email 脫鉤，見 getUserByLogin
// 檔頭註解）——一經 getUserByLogin 解析出 user 之後，本函式其餘邏輯與回傳值（含 kind:'ok' 的
// email 欄位）一律使用 user.email（內部身分），不再理會 loginName 本身，呼叫端（actions/session.js）
// 據此讓授權閘／session token／裝置憑證／寄信全部沿用內部 email。
//
// 強制改密碼：擺在密碼驗證通過之後、switchToEmailOtp／第二因素判斷之前——must_change_password=1
// 時，其餘登入路徑（切換 Email 驗證碼、TOTP、Email OTP）一律先擋下，逼首登必須先把密碼改掉才能
// 繼續，即使帶有效信任裝置也不例外（裝置信任只免第二因素，不免強制改密碼，見 actions/session.js
// 的 deviceValid 短路只作用於 totp_required/email_otp_required 兩種 kind）。
//
// switchToEmailOtp：密碼已驗證正確後才會生效（見任務回報「email OTP 狀態機的邊界情況決策」）——
// 使用者登入到一半（已知密碼正確、尚未通過第二因素）想從 TOTP 改用 Email 驗證碼時，讓本次呼叫
// 順便把 twofa_method 切成 'email' 並立刻進入寄送流程，不需要另開一個「已登入」的中繼狀態，
// 也杜絕越權竄改他人 2FA 設定（密碼必須正確，等同本人在操作自己的帳號）。otpEmails 在此情境下
// 必附（比照 twofaSetMethod('email', emails) 的規則，用同一支 normalizeOtpEmails 驗證）——驗證
// 失敗時直接回對應 kind，不切換 twofa_method、不動任何欄位（避免帳號被切到一個「選了 email 但
// 收件清單是垃圾」的半殘狀態）。
async function verifyLocalCredentialsDetailed(db, loginName, password, otp, emailOtp, switchToEmailOtp, otpEmails, newPassword, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  if (!loginName || !password) return { kind: 'invalid_credentials' };
  let user = getUserByLogin(db, loginName);
  if (!user) return { kind: 'invalid_credentials' };
  if (user.disabled) return { kind: 'invalid_credentials' };
  if (isLocked(user, nowSec)) return { kind: 'invalid_credentials' };

  let passwordOk = false;
  try { passwordOk = await argon2.verify(user.password_hash, password); } catch (_e) { passwordOk = false; }
  if (!passwordOk) { registerFailure(db, user, nowSec); return { kind: 'invalid_credentials' }; }

  // 補洞保險：must_change_password 旗標未設（例如早期 create-user.js CLI 批次建帳沒有帶
  // mustChangePassword: true）但這次密碼驗證通過的密碼字串本身就是固定初始密碼時，仍視同首登，
  // 逼強制改密碼——不能只信旗標，因為驗證新密碼政策（validateNewPassword）本身已保證合法使用者
  // 永遠不可能把密碼「改成」初始密碼（same_as_default 會擋下），故「密碼＝初始密碼」在任何情境
  // 下都等同「這帳號還沒真的改過密碼」，用這個不變量補齊旗標可能遺漏的情況。
  if (user.must_change_password || password === DEFAULT_INITIAL_PASSWORD) {
    if (newPassword === undefined || newPassword === null || newPassword === '') {
      return { kind: 'password_change_required' };
    }
    const check = await validateNewPassword(newPassword, user);
    if (!check.ok) return { kind: 'weak_new_password', reason: check.reason };
    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE email = ?')
      .run(newHash, new Date(nowMs).toISOString(), user.email);
    audit.appendAuditLog(db, {
      email: user.email, action: 'passwordChanged', target: user.email, outcome: 'ok',
      detail: 'self_change_at_forced_login',
    });
    user = getUser(db, user.email); // 重讀，password_hash/must_change_password 已更新
  }

  if (switchToEmailOtp === true) {
    const normalized = normalizeOtpEmails(otpEmails);
    if (normalized.error) return { kind: normalized.error };
    db.prepare('UPDATE users SET twofa_method = ?, otp_emails = ?, updated_at = ? WHERE email = ?')
      .run('email', JSON.stringify(normalized.emails), new Date(nowMs).toISOString(), user.email);
    user = getUser(db, user.email); // 重讀最新 twofa_method/otp_emails，下面才看得到
  }

  const method = resolveTwofaMethod(user);

  if (method === 'totp') {
    const otpStr = String(otp == null ? '' : otp).trim();
    if (!otpStr) return { kind: 'totp_required' };
    let otpOk = false;
    try { otpOk = totp.verifyTotp(user.totp_secret, otpStr); } catch (_e) { otpOk = false; }
    if (!otpOk) { registerFailure(db, user, nowSec); return { kind: 'invalid_totp' }; }
    registerSuccess(db, user);
    return { kind: 'ok', email: user.email, totpEnrolled: !!user.totp_enrolled };
  }

  if (method === 'email') {
    const codeStr = String(emailOtp == null ? '' : emailOtp).trim();
    if (!codeStr) {
      const resent = canResendEmailOtp(user, nowMs);
      const emailOtpCode = resent ? issueEmailOtp(db, user.email, nowMs) : null;
      return {
        kind: 'email_otp_required', email: user.email, totpEnrolled: !!user.totp_enrolled,
        emailOtpCode, resent, emailOtpRecipients: emailOtpRecipients(user),
      };
    }
    const ok = checkEmailOtp(user, codeStr, nowMs);
    if (!ok) {
      registerFailure(db, user, nowSec);
      bumpEmailOtpAttempts(db, user.email);
      return { kind: 'invalid_email_otp' };
    }
    clearEmailOtp(db, user.email);
    registerSuccess(db, user);
    return { kind: 'ok', email: user.email, totpEnrolled: !!user.totp_enrolled };
  }

  registerSuccess(db, user);
  return { kind: 'ok', email: user.email, totpEnrolled: !!user.totp_enrolled };
}

// 精簡版（既有呼叫端／測試相容）：驗證通過回 email；任何失敗（帳號不存在/停用/鎖定/密碼錯/
// TOTP 或 Email 驗證碼錯／還差一步/待改密碼)一律回 null，語意等同 verifyLocalCredentialsDetailed 的
// kind !== 'ok'。不支援 emailOtp／switchToEmailOtp／newPassword（既有呼叫端只用帳密＋TOTP，見
// auth-local.test.js）。第一參數 loginName：既有呼叫端一律傳既有 email 字串，migration 005 backfill
// 已保證 login_name=lower(email)，行為不變。
async function verifyLocalCredentials(db, loginName, password, otp, nowMs = Date.now()) {
  const result = await verifyLocalCredentialsDetailed(db, loginName, password, otp, undefined, false, undefined, undefined, nowMs);
  return result.kind === 'ok' ? result.email : null;
}

// Phase 3b：信任裝置憑證放行（免 TOTP）比照一般登入成功——重置鎖定計數。供
// actions/session.js 的裝置信任分支呼叫，該分支只走到 verifyLocalCredentialsDetailed 回
// 'totp_required' 就中止（未附 otp），不會自動觸發內部的 registerSuccess(user)。
function registerLoginSuccess(db, email) {
  const user = getUser(db, email);
  if (user) registerSuccess(db, user);
}

// scripts/create-user.js 用：新建或更新帳號（upsert）。totpSecret 若提供，視為直接以「已註冊」
// 狀態灌入（管理者代為設定的情境）；不提供則不動 totp_enrolled/totp_pending_secret 既有值，
// 只在該欄位當前為 NULL/0 的新建情境下維持未註冊——**注意**：此函式為整欄覆寫工具，
// 對既有帳號重跑且不傳 totpSecret 會把 totp_secret/totp_enrolled 重置為未註冊，此為 Phase 1
// 骨架即有的既有行為（僅供管理者手動操作腳本使用），非本次新增。
// loginName／mustChangePassword（migration 005）：不傳 loginName 時預設 email 小寫化——維持
// 「既有測試／既有呼叫端不用改」的相容性（backfill 語意：既有帳號 login_name=lower(email)）；
// 管理者發放帳號的正式路徑走 actions/adminUsers.js（各身分登入帳號規則不同，見該檔），本函式
// 只是測試／CLI 腳本共用的簡化建帳工具，不是本次帳號發放功能本身的實作位置。
async function upsertUser(db, email, password, { totpSecret = null, disabled = false, loginName = null, mustChangePassword = false } = {}) {
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  const enrolled = totpSecret ? 1 : 0;
  const enrolledAt = totpSecret ? now : null;
  const login = String(loginName || email).trim().toLowerCase();
  db.prepare(
    `INSERT INTO users (email, password_hash, totp_secret, totp_enrolled, totp_enrolled_at, disabled, failed_attempts, locked_until, login_name, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       totp_secret   = excluded.totp_secret,
       totp_enrolled = excluded.totp_enrolled,
       totp_enrolled_at = excluded.totp_enrolled_at,
       disabled      = excluded.disabled,
       failed_attempts = 0,
       locked_until    = NULL,
       login_name    = excluded.login_name,
       must_change_password = excluded.must_change_password,
       updated_at    = excluded.updated_at`
  ).run(email, hash, totpSecret, enrolled, enrolledAt, disabled ? 1 : 0, login, mustChangePassword ? 1 : 0, now, now);
}

module.exports = {
  hashPassword,
  generateTotpSecret,
  totpKeyUri,
  getUser,
  getUserByLogin,
  isLocked,
  verifyLocalCredentials,
  verifyLocalCredentialsDetailed,
  validateNewPassword,
  registerFailure,
  registerLoginSuccess,
  upsertUser,
  resolveTwofaMethod,
  normalizeOtpEmails,
  parseOtpEmails,
  emailOtpRecipients,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_SEC,
  EMAIL_OTP_TTL_MIN,
  EMAIL_OTP_RESEND_COOLDOWN_SEC,
  EMAIL_OTP_MAX_ATTEMPTS,
  OTP_EMAIL_MAX,
  DEFAULT_INITIAL_PASSWORD,
  NEW_PASSWORD_MIN_LEN,
};
