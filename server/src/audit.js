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
  if (action && /^omsv[A-Z]/.test(action)) return summarizeOmsvParams(params);
  if (action && /^om[A-Z]/.test(action)) return summarizeOpenmailParams(params);
  if (action && /^sms[A-Z]/.test(action)) return summarizeSmsParams(params);
  if (action && /^ft[A-Z]/.test(action)) return summarizeFtParams(params);
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
// v235：rememberMe（omConnect 的「記住密碼」opt-in 勾選狀態）比照 omsv 摘要函式的 deleteFromMail
// 寫法記布林值——這是使用者的選擇本身（是否要求伺服器落地密碼），不是密碼內容，可讀記錄供事後
// 稽核「這次連結有沒有勾記住密碼」，不落地的仍是密碼本身（mailPass 已在 CONFIDENTIAL_KEYS）。
function summarizeOpenmailParams(params) {
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    if (k === 'folder' || k === 'toFolder') return `${k}=${String(v).slice(0, 80)}`;
    if (k === 'uid') return `uid=${v}`;
    if (k === 'uids' && Array.isArray(v)) return `uids=${v.length}`;
    if (k === 'to' || k === 'cc' || k === 'bcc') return `${k}_domains=${domainOnlySummary(v)}`;
    if (k === 'subject') return `subject_len=${String(v == null ? '' : v).length}`;
    if (k === 'rememberMe') return `rememberMe=${!!v}`;
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

// v207：新生心理測驗（ft*）action 專用摘要——學生個資明細（cells 內容）一律不落地，只記筆數／
// 欄位名稱／學期代碼（CLAUDE.md 資安原則 3 去識別化）。cols 只記 id/name（欄位定義本身不是個資），
// rows 只記筆數（實際學生資料在 cells 內，完全跳過）。
// v213：rows 內若有列標 deleted:true（每列軟刪除），額外記 deletedCount 與 deletedIds（僅 _id，
// 系統配發的隨機 id，非學號/姓名等個資，供事後追查「哪些列被刪」用；cells 內容仍完全不落地）。
function summarizeFtParams(params) {
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    if (k === 'semester' || k === 'sheet') return `${k}=${String(v).slice(0, 20)}`;
    if (k === 'id' || k === 'label') return `${k}=${String(v).slice(0, 40)}`;
    if (k === 'rows' && Array.isArray(v)) {
      const deletedRows = v.filter((r) => r && r.deleted === true);
      if (!deletedRows.length) return `rows=${v.length}`;
      const ids = deletedRows.map((r) => (r && typeof r._id === 'string' ? r._id : '')).filter(Boolean).join('|').slice(0, 500);
      return `rows=${v.length};deletedCount=${deletedRows.length};deletedIds=${ids}`;
    }
    if (k === 'cols' && Array.isArray(v)) {
      return `cols=${v.map((c) => (c && c.id) || '').join('|').slice(0, 300)}`;
    }
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

// v220：學諮伺服器資料夾（omsv*，見 openmail/archive.js）專用摘要——資料夾名稱本身只是使用者
// 自訂的組織標籤（不是信件個資），可讀記錄；folder（IMAP 路徑）／uid／folderId／id／index 等
// 定位用欄位皆可讀記錄。信件主旨/寄件人/收件人/內文一律不會出現在這些 action 的 params 裡
// （server 端自行從封存的 source 解析取得，不經前端傳入），故不需要額外黑名單即已符合「只記
// 筆數/資料夾名/大小，不落信件主旨與內容」（CLAUDE.md 資安原則 3）。
function summarizeOmsvParams(params) {
  return Object.keys(params).filter((k) => !CONFIDENTIAL_KEYS.has(k)).map((k) => {
    const v = params[k];
    if (k === 'name') return `name=${String(v == null ? '' : v).slice(0, 80)}`;
    if (k === 'folder') return `folder=${String(v).slice(0, 80)}`;
    // v234：omsvFolderMove/Create 的 parentId 純粹是資料夾階層定位用（哪個資料夾的 id），同
    // folderId 一樣不是個資，可讀記錄。
    if (k === 'folderId' || k === 'targetFolderId' || k === 'parentId' || k === 'id' || k === 'index' || k === 'uid') return `${k}=${v}`;
    if (k === 'deleteFromMail') return `deleteFromMail=${!!v}`;
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

module.exports = { appendAuditLog, summarizeParams };
