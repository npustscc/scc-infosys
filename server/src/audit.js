// server/src/audit.js — 稽核紀錄（append-only）。CLAUDE.md 資安原則：content 類參數只記長度，
// 不記內容；本模組刻意不接受任意 params 物件寫入 detail，呼叫端須自行摘要成短字串再傳入，
// 避免不小心把個資內容（如 content: JSON.stringify(整份個案）帶進 audit_log。
'use strict';

function appendAuditLog(db, { email, action, target, outcome, latencyMs, detail }) {
  db.prepare(
    `INSERT INTO audit_log (email, action, target, outcome, latency_ms, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(email || null, action, target || null, outcome, latencyMs == null ? null : Math.round(latencyMs), detail || null);
}

// v202：機密欄位黑名單——連長度都不記（不只是「不記內容」）。openmail 使用者自己輸入的 openmail
// 密碼（mailPass，見 openmail/credStore.js 檔頭「密碼永不落地」的最高資安要求）是新增本黑名單的
// 直接原因；同時發現既有的 changeMyPassword（currentPassword/newPassword）、totpSetupConfirm（code）、
// sessionStart（otp）等密碼/驗證碼類欄位此前完全沒有這層保護——這些欄位過去雖然只會被記錄長度
// （不記內容本身，仍符合 CLAUDE.md「content 類參數只記長度」的最低要求），但密碼長度本身也是
// 不必要的側洩漏（有助攻擊者縮小暴力破解範圍），故一併補上，不只是為 mailPass 開特例。
const CONFIDENTIAL_KEYS = new Set(['mailPass', 'password', 'currentPassword', 'newPassword', 'otp', 'code']);

// 常見用法：把 params 內容摘要為「只記長度」的字串，不記內容本身。CONFIDENTIAL_KEYS 內的欄位整個
// 跳過（連 key 名帶長度都不記）。action 為選填第二參數：om*（openmail，v202）走專用摘要（見
// summarizeOpenmailParams），folder 名／uid／收件人 domain／subject 長度可讀但仍不含信件內容本身。
function summarizeParams(params, action) {
  if (!params || typeof params !== 'object') return '';
  if (action && /^om[A-Z]/.test(action)) return summarizeOpenmailParams(params);
  if (action && /^sms[A-Z]/.test(action)) return summarizeSmsParams(params);
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

// 把收件人字串（可能逗號分隔多個地址）摘要成只留網域的字串，不落地完整信箱（機密紀律）。
// 對映 mail/mailer.js 的 toDomainSummary（此處獨立複製一份小函式，避免 audit.js ↔ mail/mailer.js
// 互相 require 造成循環依賴——mailer.js 本身已 require('../audit')）。
function domainOnlySummary(addr) {
  return String(addr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((a) => {
      const at = a.indexOf('@');
      return at >= 0 ? a.slice(at) : '(no-domain)';
    })
    .join(',');
}

// openmail（om*）action 專用摘要：folder 名／uid／收件人 domain 可讀但不含帳密/信件內容本身；
// 其餘欄位（html/text/attachments/query/mailUser...）仍走長度摘要；CONFIDENTIAL_KEYS（mailPass 等）
// 一律跳過。folder 名截短至 80 字避免使用者自訂資料夾名稱異常長時把 detail 撐爆。
function summarizeOpenmailParams(params) {
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    if (k === 'folder' || k === 'toFolder') return `${k}=${String(v).slice(0, 80)}`;
    if (k === 'uid') return `uid=${v}`;
    if (k === 'uids' && Array.isArray(v)) return `uids=${v.length}`;
    if (k === 'to' || k === 'cc' || k === 'bcc') return `${k}_domains=${domainOnlySummary(v)}`;
    if (k === 'subject') return `subject_len=${String(v == null ? '' : v).length}`;
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

// v203：簡訊發送（sms*）action 專用摘要——收件人（phone/name/caseId）與簡訊內文一律不落地
// （比照 CLAUDE.md 資安原則 3 去識別化：個資/內文不進稽核，只留「筆數」與可讀的非機密欄位），
// smsSend/smsCancel「記 logId 與筆數即可」的實際 logId 補記見 dispatch.js finally 區塊（logId 是
// 回傳值，這裡拿不到，只能處理輸入參數）。
function summarizeSmsParams(params) {
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    if (k === 'recipients' && Array.isArray(v)) return `recipients=${v.length}`;
    if (k === 'message') return `message_len=${String(v == null ? '' : v).length}`;
    if (k === 'provider') return `provider=${v}`;
    if (k === 'scheduledAt') return `scheduledAt=${v ? String(v).slice(0, 14) : ''}`;
    if (k === 'logId' || k === 'limit' || k === 'offset') return `${k}=${v}`;
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

module.exports = { appendAuditLog, summarizeParams };
