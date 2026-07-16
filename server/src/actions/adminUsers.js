// server/src/actions/adminUsers.js — 帳號發放與管理（migration 005）：管理者專屬五個 action：
// adminUserAuthGet／adminCreateLocalAccount／adminUpdateLocalAccount／adminResetPassword／
// adminResetTwofa。全部走 dispatch 的 gate.ADMIN_ONLY_ACTIONS 閘門（見 authz/gate.js／
// dispatch.js 步驟 4a），非管理者一律 Forbidden，本檔不重複判斷授權——actorEmail 一律來自已驗證
// session（dispatch.js 解出），只用於稽核（audit_log.email 記操作者，target 記被操作帳號的內部
// email，兩者分開存，比照既有 audit.js「target 為目標摘要」的欄位語意）。
//
// 內部身分 email 與登入帳號（login_name）脫鉤：本檔操作對象一律用「內部 email」（config.json
// users 的鍵、session token 的 e），login_name 只是這裡新增/修改的一個欄位，不是查找鍵——查找／
// 建立帳號時傳入的 params.email 一律是內部 email（前端從 config.users 名冊選取），不是登入帳號。
//
// 三種身分發放規則不同（見任務背景，本檔不對此做強制檢查，由前端/管理者自行決定填什麼）：
//   專任＝校內帳號（可用 帳號@mail.npust.edu.tw 當預設收碼信箱）
//   實習生＝自設帳號＋必填 email
//   兼任＝管理者指定帳號＋必填 email
// 初始密碼固定 DEFAULT_INITIAL_PASSWORD、must_change_password=1，首登強制改密碼（見 auth/local.js）。
'use strict';

const local = require('../auth/local');
const deviceTrust = require('../auth/deviceTrust');
const audit = require('../audit');
const sessionActions = require('./session');

function readConfigUsers(db, ctx) {
  return sessionActions.readConfigUsers(db, ctx);
}

// email 為操作者（actor），target 為被操作帳號的內部 email——兩者刻意分開存入 audit_log 既有的
// email/target 欄位，不塞進 detail（detail 仍維持「短摘要、不含個資內容」的既有原則）。
function auditAdmin(db, actorEmail, action, targetEmail, detail) {
  audit.appendAuditLog(db, {
    email: actorEmail, action, target: targetEmail, outcome: 'ok', detail: detail || '',
  });
}

// 查詢某內部 email 目前的本地帳號認證狀態；無本地帳號（尚未發放）回 hasLocalAccount:false，
// 其餘欄位皆不附（避免呼叫端誤讀 undefined 當有效值）。
function adminUserAuthGet(db, params) {
  const email = String((params && params.email) || '').trim();
  if (!email) return { error: 'email_required' };
  const user = local.getUser(db, email);
  if (!user) return { hasLocalAccount: false };
  return {
    hasLocalAccount: true,
    loginName: user.login_name || null,
    totpEnrolled: !!user.totp_enrolled,
    twofaMethod: (user.twofa_method === 'totp' || user.twofa_method === 'email') ? user.twofa_method : null,
    otpEmails: local.parseOtpEmails(user),
    mustChangePassword: !!user.must_change_password,
  };
}

// 建立本地帳號：email 必須已存在於 config.json 的 users（防止替不存在的人建帳——config.users
// 是既有的人員名冊，本地帳號只是給名冊裡的人多一種登入方式，不是另開一套人員管理）；login_name
// 須全站唯一（大小寫不敏感，見 local.getUserByLogin）。初始密碼固定 DEFAULT_INITIAL_PASSWORD，
// must_change_password=1 逼首登強制改密碼。otpEmails 選填（1~3 個，沿用 normalizeOtpEmails）——
// 未附時 otp_emails 留空，之後使用者自行用 twofaSetEmails／twofaSetMethod 補設定。
async function adminCreateLocalAccount(db, ctx, params, actorEmail) {
  const email = String((params && params.email) || '').trim();
  const loginNameRaw = String((params && params.loginName) || '').trim();
  if (!email) return { error: 'email_required' };
  if (!loginNameRaw) return { error: 'login_name_required' };

  const configUsers = readConfigUsers(db, ctx);
  if (!configUsers || !configUsers[email]) return { error: 'email_not_in_config' };

  if (local.getUser(db, email)) return { error: 'account_already_exists' };

  const loginName = loginNameRaw.toLowerCase();
  const loginTaken = local.getUserByLogin(db, loginName);
  if (loginTaken) return { error: 'login_name_taken' };

  let otpEmailsList = null;
  if (params && params.otpEmails !== undefined) {
    const normalized = local.normalizeOtpEmails(params.otpEmails);
    if (normalized.error) return { error: normalized.error };
    otpEmailsList = normalized.emails;
  }

  const hash = await local.hashPassword(local.DEFAULT_INITIAL_PASSWORD);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users
       (email, password_hash, login_name, must_change_password, otp_emails, disabled, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, 0, 0, NULL, ?, ?)`
  ).run(email, hash, loginName, otpEmailsList ? JSON.stringify(otpEmailsList) : null, now, now);

  auditAdmin(db, actorEmail, 'adminCreateLocalAccount', email, `loginName_len=${loginName.length}`);
  return { ok: true, email, loginName };
}

// 逐欄選改：只處理有附的欄位，其餘不動（params 內未定義的欄位視為「不改」，區別於「改成空」）。
//   loginName  — 全站唯一（大小寫不敏感），與其他帳號衝突（自己不算衝突）→ login_name_taken
//   otpEmails  — 同 normalizeOtpEmails 驗證規則
//   twofaMethod — 'totp'：目標帳號須已完成 TOTP 註冊（totp_enrolled），否則會把人鎖在登入門外
//                         → totp_not_enrolled
//                 'email'：改完之後 otp_emails 不得為空（優先看本次 otpEmails，未附則看目前值）
//                         → otp_emails_required
async function adminUpdateLocalAccount(db, params, actorEmail) {
  const email = String((params && params.email) || '').trim();
  if (!email) return { error: 'email_required' };
  const user = local.getUser(db, email);
  if (!user) return { error: 'account_not_found' };

  const updates = {};
  let otpEmailsList; // 本次若有附 otpEmails，記住正規化後的值，供 twofaMethod==='email' 檢查用

  if (params && params.loginName !== undefined) {
    const loginName = String(params.loginName || '').trim().toLowerCase();
    if (!loginName) return { error: 'login_name_required' };
    const existing = local.getUserByLogin(db, loginName);
    if (existing && existing.email !== email) return { error: 'login_name_taken' };
    updates.login_name = loginName;
  }

  if (params && params.otpEmails !== undefined) {
    const normalized = local.normalizeOtpEmails(params.otpEmails);
    if (normalized.error) return { error: normalized.error };
    otpEmailsList = normalized.emails;
    updates.otp_emails = JSON.stringify(otpEmailsList);
  }

  if (params && params.twofaMethod !== undefined) {
    const method = params.twofaMethod;
    if (method !== 'totp' && method !== 'email') return { error: 'invalid_method' };
    if (method === 'totp') {
      if (!user.totp_enrolled) return { error: 'totp_not_enrolled' };
    } else {
      const effectiveEmails = otpEmailsList !== undefined ? otpEmailsList : local.parseOtpEmails(user);
      if (!effectiveEmails || effectiveEmails.length === 0) return { error: 'otp_emails_required' };
    }
    updates.twofa_method = method;
  }

  if (Object.keys(updates).length === 0) return { error: 'no_fields_to_update' };

  const now = new Date().toISOString();
  const cols = Object.keys(updates);
  const setSql = cols.map((c) => `${c} = ?`).concat('updated_at = ?').join(', ');
  const values = cols.map((c) => updates[c]).concat(now, email);
  db.prepare(`UPDATE users SET ${setSql} WHERE email = ?`).run(...values);

  auditAdmin(db, actorEmail, 'adminUpdateLocalAccount', email, cols.join('+'));
  return { ok: true, updated: cols };
}

// 重設密碼為固定初始密碼，must_change_password=1（下次登入強制改密碼）；順手解除鎖定
// （failed_attempts/locked_until 歸零）——管理者重設密碼的情境本來就常是「使用者忘記密碼被鎖定」，
// 重設後仍卡在鎖定狀態沒有意義。
async function adminResetPassword(db, params, actorEmail) {
  const email = String((params && params.email) || '').trim();
  if (!email) return { error: 'email_required' };
  const user = local.getUser(db, email);
  if (!user) return { error: 'account_not_found' };

  const hash = await local.hashPassword(local.DEFAULT_INITIAL_PASSWORD);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 1,
       failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?`
  ).run(hash, now, email);

  auditAdmin(db, actorEmail, 'adminResetPassword', email, '');
  return { ok: true };
}

// 清空該帳號所有第二因素相關欄位（TOTP 密鑰／已註冊狀態／選用方法／Email 驗證碼收件清單與
// 進行中的碼），使用者下次登入時需重新選擇＋設定。**連同撤銷該帳號全部裝置信任憑證**——重設
// 2FA 卻留著既有裝置免第二因素放行，等同白重設（見 deviceTrust.revokeAllForUser 檔頭註解）。
function adminResetTwofa(db, params, actorEmail) {
  const email = String((params && params.email) || '').trim();
  if (!email) return { error: 'email_required' };
  const user = local.getUser(db, email);
  if (!user) return { error: 'account_not_found' };

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET
       totp_secret = NULL, totp_enrolled = 0, totp_enrolled_at = NULL, totp_pending_secret = NULL,
       twofa_method = NULL, otp_emails = NULL,
       email_otp_hash = NULL, email_otp_expires_at = NULL, email_otp_attempts = 0, email_otp_sent_at = NULL,
       updated_at = ?
     WHERE email = ?`
  ).run(now, email);
  deviceTrust.revokeAllForUser(db, email);

  auditAdmin(db, actorEmail, 'adminResetTwofa', email, '');
  return { ok: true };
}

module.exports = {
  adminUserAuthGet,
  adminCreateLocalAccount,
  adminUpdateLocalAccount,
  adminResetPassword,
  adminResetTwofa,
};
