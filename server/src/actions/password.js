// server/src/actions/password.js — 自助改密碼（changeMyPassword）：已登入使用者改自己的密碼，
// 走 dispatch 一般授權閘（非管理者專屬，見 authz/gate.js，本 action 不在 ADMIN_ONLY_ACTIONS）。
// userEmail 一律來自已驗證 session（dispatch.js 解出），不吃 params 裡的 email，杜絕越權改別人
// 密碼（比照 actions/twofa.js 既有原則）。
//
// 與 auth/local.js 首登強制改密碼流程（verifyLocalCredentialsDetailed 的
// password_change_required／weak_new_password 分支）是兩條不同路徑——那條發生在「尚未核發 session」
// 之前（登入中途），本檔則是已登入使用者主動從偏好設定頁改密碼；但密碼政策共用同一支
// validateNewPassword，行為一致（≥8 碼、不得等於初始密碼、不得與目前密碼相同）。
//
// 目前密碼驗證錯誤沿用 auth/local.js 既有的鎖定計數（registerFailure/registerSuccess，
// MAX_FAILED_ATTEMPTS/LOCK_DURATION_SEC），防止本 action 被當成密碼爆破的側門——已鎖定帳號
// 直接回同一種 invalid_current_password（不細分「鎖定中」或「密碼錯」，避免鎖定狀態外洩，比照
// verifyLocalCredentialsDetailed 對外一律回 invalid_credentials 的既有原則）。
'use strict';

const argon2 = require('argon2');
const local = require('../auth/local');
const audit = require('../audit');

// params: { currentPassword, newPassword }
async function changeMyPassword(db, userEmail, { currentPassword, newPassword } = {}) {
  const user = local.getUser(db, userEmail);
  if (!user) return { error: 'account_not_found' };

  const nowSec = Math.floor(Date.now() / 1000);
  // 已鎖定：不重覆驗證密碼、不再計一次失敗（沿用 verifyLocalCredentialsDetailed 對鎖定帳號的既有
  // 處理方式，isLocked 分支不會呼叫 registerFailure，避免鎖定時間被無謂延長）。
  if (local.isLocked(user, nowSec)) return { error: 'invalid_current_password' };

  let currentOk = false;
  try {
    currentOk = await argon2.verify(user.password_hash, String(currentPassword == null ? '' : currentPassword));
  } catch (_e) { currentOk = false; }
  if (!currentOk) {
    local.registerFailure(db, user, nowSec);
    return { error: 'invalid_current_password' };
  }

  const check = await local.validateNewPassword(newPassword, user);
  if (!check.ok) return { error: 'weak_new_password:' + check.reason };

  const newHash = await local.hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE email = ?')
    .run(newHash, now, userEmail);
  local.registerLoginSuccess(db, userEmail); // 歸零鎖定計數（同一般登入成功的既有行為）

  audit.appendAuditLog(db, {
    email: userEmail, action: 'passwordChanged', target: userEmail, outcome: 'ok',
    detail: 'self_change_via_prefs',
  });

  return { ok: true };
}

module.exports = { changeMyPassword };
