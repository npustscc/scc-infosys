// server/src/mail/mailer.js — 統一寄信入口。所有實際觸網寄信（登入通知信／打卡彙整信…）皆須經此
// 函式，不得各自直接呼叫 google/gmailSend.js——理由：
//   1. 憑證/token 快取集中一處（比照 actions/mail.js 的 tokenCaches 模式），避免各呼叫點各自管理。
//   2. 缺 MAIL_SEND_CREDS（尚未部署寄信憑證，如本機開發環境）時統一降級為 Phase 1 假寄信行為
//      （只記 audit、回傳 mailSent:false），不拋錯、不阻斷呼叫端的主流程。
//   3. 寄信失敗只記 audit、絕不 throw——對映查證結論：dev/Code.gs 全部 6 處 MailApp.sendEmail
//      呼叫，逐一皆包在各自的 try/catch 內（sessionsAppendRecordWithMailDecision_ L825-827、
//      _sendGeoLockMail_ L989/994、_sendGeoEmptyMail_ L1016/1024、_sendPunchSummaryMail_
//      L2966-2968），失敗只 Logger.log，從不讓例外往上冒——GAS 版寄信本質上就是 best-effort，
//      本檔的「永不拋出」設計是逐字對齊，不是新增行為。
//   4. 稽核紀錄集中一處：CLAUDE.md 資安原則——信件內容含個資（姓名等），audit 只記收件人 domain
//      與主旨長度之類的摘要，絕不記內容本身（比照 audit.summarizeParams 的「只記長度」精神）。
'use strict';

const googleAuth = require('../google/auth');
const gmailSend = require('../google/gmailSend');
const audit = require('../audit');

// credsPath → tokenCache 的記憶體快取（單一 server process 生命週期）。比照 actions/mail.js。
const tokenCaches = new Map();

function getTokenCache(credsPath) {
  let cache = tokenCaches.get(credsPath);
  if (!cache) {
    const creds = googleAuth.loadCreds(credsPath);
    cache = googleAuth.createTokenCache(creds);
    tokenCaches.set(credsPath, cache);
  }
  return cache;
}

// 把收件人字串（可能逗號分隔多個地址）摘要成只留網域的字串，不落地完整信箱（機密紀律）。
function toDomainSummary(to) {
  return String(to || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((addr) => {
      const at = addr.indexOf('@');
      return at >= 0 ? addr.slice(at) : '(no-domain)';
    })
    .join(',');
}

function logAttempt(db, auditMeta, { to, subject, outcome, reason, mailSent }) {
  if (!db) return; // 供不需要稽核的純測試呼叫使用（正式路徑一律會帶 db）
  try {
    const detail = `mailSent=${!!mailSent};subject_len=${String(subject || '').length}` + (reason ? `;reason=${reason}` : '');
    audit.appendAuditLog(db, {
      email: (auditMeta && auditMeta.email) || null,
      action: (auditMeta && auditMeta.action) || 'mail.send',
      target: toDomainSummary(to),
      outcome,
      latencyMs: null,
      detail,
    });
  } catch (_e) { /* 稽核寫入失敗不可影響寄信/呼叫端主流程 */ }
}

// 統一寄信入口。config 需含 MAIL_SEND_CREDS 才會真的觸網寄信；db 供稽核（可省略，見 logAttempt）；
// auditMeta：{ email, action } 供稽核紀錄歸戶與分類（action 建議沿用既有慣例，如
// 'sessionStart.loginMail'／'attendanceCommit.punchMail'）。
// 回傳 { mailSent: boolean, reason?: string }，永不 throw。
async function sendMail(config, db, { to, subject, textBody, htmlBody, cc }, auditMeta) {
  if (!config || !config.MAIL_SEND_CREDS) {
    logAttempt(db, auditMeta, { to, subject, outcome: 'skipped', reason: 'no_creds', mailSent: false });
    return { mailSent: false, reason: 'no_creds' };
  }
  try {
    const accessToken = await getTokenCache(config.MAIL_SEND_CREDS).getAccessToken();
    await gmailSend.sendMail(accessToken, { to, subject, textBody, htmlBody, cc });
    logAttempt(db, auditMeta, { to, subject, outcome: 'sent', mailSent: true });
    return { mailSent: true };
  } catch (_e) {
    // 憑證/token 取得失敗或 Gmail API 呼叫失敗：對映 GAS 版 MailApp.sendEmail 失敗時的
    // try/catch 吞錯語意——不記錄例外訊息內容（可能夾帶敏感細節），只記 reason 代碼。
    logAttempt(db, auditMeta, { to, subject, outcome: 'failed', reason: 'send_failed', mailSent: false });
    return { mailSent: false, reason: 'send_failed' };
  }
}

module.exports = { sendMail, getTokenCache, toDomainSummary };
