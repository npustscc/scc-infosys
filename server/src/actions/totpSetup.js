// server/src/actions/totpSetup.js — TOTP 註冊／輪替三個 action：totpSetupStart／totpSetupConfirm／
// totpStatus。走 dispatch 一般授權閘（需已登入 session），本模組只處理「本人為自己設定 TOTP」的
// 商業邏輯——userEmail 一律來自已驗證的 session token（dispatch.js 解出），不是 params，
// 沒有代他人設定的例外，杜絕越權改別人 2FA 設定的攻擊面。
//
// 輪替：已註冊（totp_enrolled=1）者重跑 totpSetupStart，新 secret 只落 totp_pending_secret
// （暫存），不動現行 totp_secret；confirm 通過才原地取代生效，取代前舊密鑰持續有效，
// 使用者若中途放棄輪替（不 confirm）不影響既有登入能力。
'use strict';

const local = require('../auth/local');
const totp = require('../auth/totp');

// 產生新 secret（暫存於 totp_pending_secret，尚未生效）。回應只在此一次性附上 otpauthUri／
// manualKey——機密紀律：secret 不落 log、不寫入 vdrive，且不會再出現在其他任何 API 回應中
// （totpStatus 只回 enrolled 布林值）。
function totpSetupStart(db, userEmail) {
  const user = local.getUser(db, userEmail);
  if (!user) return { error: 'user_not_found' };
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_pending_secret = ?, updated_at = ? WHERE email = ?')
    .run(secret, new Date().toISOString(), userEmail);
  return {
    otpauthUri: totp.buildOtpauthUri(userEmail, secret),
    manualKey: totp.manualKeyGroups(secret),
  };
}

// 驗證暫存 secret 的 6 位數碼；通過才正式生效（搬進 totp_secret，清空暫存欄）。
function totpSetupConfirm(db, userEmail, code) {
  const user = local.getUser(db, userEmail);
  if (!user || !user.totp_pending_secret) return { error: 'no_pending_totp_setup' };
  const ok = totp.verifyTotp(user.totp_pending_secret, code);
  if (!ok) return { error: 'invalid_totp' };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users
     SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
         totp_enrolled = 1, totp_enrolled_at = ?, updated_at = ?
     WHERE email = ?`
  ).run(now, now, userEmail);
  return { ok: true };
}

function totpStatus(db, userEmail) {
  const user = local.getUser(db, userEmail);
  return { enrolled: !!(user && user.totp_enrolled) };
}

module.exports = { totpSetupStart, totpSetupConfirm, totpStatus };
