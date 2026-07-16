// server/src/actions/twofa.js — 第二因素「選用哪種方法」的帳號層級設定：twofaSetMethod／
// twofaStatus。獨立於 actions/totpSetup.js（那支是「TOTP 本身怎麼註冊」，本檔是「這個帳號的第二
// 因素要用 TOTP 還是 Email 驗證碼」，兩者關注點不同——一個是設定值，一個是設定值背後的機制）。
// 走 dispatch 一般授權閘（需已登入 session），userEmail 一律來自已驗證的 session token
// （dispatch.js 解出），不吃 params 裡的 email，杜絕越權改別人 2FA 設定（比照 actions/totpSetup.js
// 的既有原則）。
//
// 例外：sessionStart 內部也會在「密碼已驗證正確、尚未通過第二因素」的中繼狀態直接改
// twofa_method（見 auth/local.js 的 switchToEmailOtp 參數與其檔頭註解）——那是登入流程中途
// 「順便切換」的特例，走的是另一條路徑（尚無 session），不經過本檔的 twofaSetMethod。
'use strict';

const local = require('../auth/local');

// 選 'totp' 時要求該帳號已完成 TOTP 註冊（totp_enrolled===true）——否則允許的話，使用者會被切到
// 一個「選了 TOTP 但登入時永遠過不了」的死路（resolveTwofaMethod 只有在 totp_secret 有值時才能
// 驗證 TOTP 碼）；不需要 emails 參數。選 'email' 必須同時附 emails（1~3 個，見
// local.normalizeOtpEmails——與 sessionStart 的 switchToEmailOtp+otpEmails 走同一套驗證規則，
// 避免兩處各寫一份、行為分岔）：正規化失敗直接回對應 error 代碼，不動任何欄位。
function twofaSetMethod(db, userEmail, method, emails) {
  const user = local.getUser(db, userEmail);
  if (!user) return { error: 'user_not_found' };
  if (method !== 'totp' && method !== 'email') return { error: 'invalid_method' };

  if (method === 'totp') {
    if (!user.totp_enrolled) return { error: 'totp_not_enrolled' };
    db.prepare('UPDATE users SET twofa_method = ?, updated_at = ? WHERE email = ?')
      .run('totp', new Date().toISOString(), userEmail);
    return { ok: true, method: 'totp' };
  }

  const normalized = local.normalizeOtpEmails(emails);
  if (normalized.error) return { error: normalized.error };
  db.prepare('UPDATE users SET twofa_method = ?, otp_emails = ?, updated_at = ? WHERE email = ?')
    .run('email', JSON.stringify(normalized.emails), new Date().toISOString(), userEmail);
  return { ok: true, method: 'email', otpEmails: normalized.emails };
}

function twofaStatus(db, userEmail) {
  const user = local.getUser(db, userEmail);
  return {
    method: (user && (user.twofa_method === 'totp' || user.twofa_method === 'email')) ? user.twofa_method : null,
    totpEnrolled: !!(user && user.totp_enrolled),
    otpEmails: local.parseOtpEmails(user),
  };
}

module.exports = { twofaSetMethod, twofaStatus };
