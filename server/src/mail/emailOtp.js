// server/src/mail/emailOtp.js — Email 驗證碼（第二因素後備，migration 004）純函式：只負責組信
// 主旨/內文，不觸網、不寫檔，方便單元測試；實際寄送由 src/mail/mailer.js 負責，比照
// mail/loginNotify.js 的既有分工（決策/組信與實際 I/O 分離）。環境前綴（測試版/正式版判斷）直接
// 沿用 loginNotify.mailEnvPrefix，不重複實作一份判斷邏輯。
'use strict';

const { taipeiYmdHms } = require('../util/taipeiTime');

// code：明文 6 位數驗證碼——唯一允許明文出現的地方是寄出的信件內文（機密紀律，見 CLAUDE.md／
// auth/local.js 檔頭註解），本函式純字串組裝、呼叫端負責實際寄送與確保不落 log。
function buildEmailOtpMail({ code, nowMs, envPrefix }) {
  const sentTime = taipeiYmdHms(nowMs == null ? Date.now() : nowMs);
  const subject = (envPrefix || '') + '【屏科大學諮資訊系統】登入驗證碼';
  const lines = [
    '您的登入驗證碼為：' + code,
    '',
    '此驗證碼將於 10 分鐘後失效，且僅能使用一次。',
    '產生時間：' + sentTime + '（台北時間）',
    '',
    '若非本人操作，請忽略此信；如有疑慮請聯繫系統管理者。',
  ];
  return { subject, textBody: lines.join('\n') };
}

module.exports = { buildEmailOtpMail };
