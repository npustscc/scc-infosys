// server/src/sms/mitake.js — 三竹簡訊（Mitake）HTTP API v2.14 薄封裝層。全域 fetch（Node >=18
// 內建，零新 npm 依賴），跟 google/gmail.js／google/calendar.js 同慣例；差別是本模組額外支援
// `opts.fetchImpl` 注入（測試用假 fetch，不需要真的打網路也不需要 monkey-patch 全域 fetch）。
//
// 帳密（username/password）一律由呼叫端（sms/actions.js）從 server .env 讀入後以 cfg 物件傳入，
// 本模組不讀 process.env、不快取任何機密——與 openmail/client.js「密碼永不落地」同一資安紀律。
//
// 多收件人＝逐一呼叫 SmSend（sms/actions.js 逐筆呼叫 sendSingle），本模組本身只管單次 HTTP 呼叫。
'use strict';

const crypto = require('node:crypto');

function buildUrl(cfg, name) {
  const basePath = cfg.basePath || '/api/mtk';
  return `https://${cfg.host}${basePath}/${name}`;
}

// smbody 換行須以 ASCII 6（非 LF/CR）表示（三竹官方 v2.14 文件 SmSend 參數說明）。
function encodeSmBody(message) {
  return String(message == null ? '' : message).replace(/\r\n|\r|\n/g, String.fromCharCode(6));
}

// SmSend／SmCancel 回應為「[clientid]\n key=value\n ...」的區段格式；SmQuery 查餘額同樣格式
// （只是沒有真的區段標頭時 header 為 null，仍可正常解析 key=value 那幾行）。
function parseKeyValueBlock(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  let header = null;
  const fields = {};
  for (const line of lines) {
    const headerMatch = /^\[(.*)\]$/.exec(line);
    if (headerMatch) { header = headerMatch[1]; continue; }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    fields[k] = v;
  }
  return { header, fields };
}

// statuscode 對照表（三竹官方 v2.14 文件）。0~4 為呼叫成功（已受理／已送達不同階段）；
// 5~9 為訊息已受理但最終未送達成功的原因碼（仍會取得 msgid，供 SmQuery 後續追蹤狀態用）；
// 其餘英數符號代碼＝呼叫本身失敗（帳密/IP/參數等錯誤，不會取得 msgid）。
const STATUS_TEXT = {
  '0': '預約成功，等待送出',
  '1': '已送達簡訊中心',
  '2': '已送達業者',
  '3': '已送達業者（等待送達手機）',
  '4': '已送達手機',
  '5': '內容有錯誤',
  '6': '門號有錯誤',
  '7': '簡訊已停用',
  '8': '逾時無送達',
  '9': '預約已取消',
  a: '發送功能暫停服務',
  b: '發送功能暫停服務',
  c: '請輸入帳號',
  d: '請輸入密碼',
  e: '帳號或密碼錯誤',
  f: '帳號已過期',
  h: '帳號已停用',
  k: '來源 IP 未被授權（IP 白名單）',
  l: '同時連線數超過上限',
  m: '必須變更密碼（請至三竹網頁介面變更）',
  n: '密碼已逾期',
  p: '沒有權限使用外部 HTTP 程式',
  r: '系統暫停服務',
  s: '帳務處理失敗',
  t: '簡訊已過期',
  u: '簡訊內容不得為空白',
  v: '無效的手機號碼',
  w: '查詢筆數超過上限',
  x: '發送檔案過大',
  y: '參數錯誤',
  z: '查無資料',
  '*': '系統發生錯誤（請聯絡三竹）',
};

function statusText(code) {
  if (code == null) return null;
  return STATUS_TEXT[String(code)] || `未知狀態代碼：${code}（請對照三竹官方 API 文件更新對照表）`;
}

// 呼叫層級是否成功（是否應該取得 msgid）：statuscode 為單一數字（0~9）視為呼叫成功；
// 英數符號代碼視為呼叫失敗（帳密/IP/參數等錯誤），不會有 msgid。
function isCallAccepted(statuscode) {
  return typeof statuscode === 'string' && /^[0-9]$/.test(statuscode);
}

// 單一收件人發送。dlvtime（預約時間，14 碼 YYYYMMDDHHMMSS 台北時間字串）由呼叫端
// （sms/actions.js validateScheduledAt）驗證過「須晚於現在至少 11 分鐘」才會傳進來；本模組不重複驗證。
// clientid：呼叫端可自訂（用於冪等重試場景），未提供則以 crypto.randomUUID() 產生，統一截斷 36 字
// （三竹文件規定上限）。
async function sendSingle(cfg, params, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const clientId = String((params && params.clientId) || crypto.randomUUID()).slice(0, 36);

  const body = new URLSearchParams();
  body.set('username', cfg.username);
  body.set('password', cfg.password);
  body.set('dstaddr', params.phone);
  body.set('smbody', encodeSmBody(params.message));
  if (params.scheduledAt) body.set('dlvtime', params.scheduledAt);
  body.set('clientid', clientId);

  const res = await fetchImpl(buildUrl(cfg, 'SmSend') + '?CharsetURL=UTF8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  const { fields } = parseKeyValueBlock(text);
  const statuscode = fields.statuscode != null ? fields.statuscode : null;
  const msgid = fields.msgid || null;
  const accountPoint = fields.AccountPoint != null && fields.AccountPoint !== '' ? Number(fields.AccountPoint) : null;
  // 官方文件 Duplicate 欄位值為 'Y'（12 小時內同 clientid 重複發送）；寬鬆同時接受 'true'。
  const duplicate = /^(Y|true)$/i.test(fields.Duplicate || '');

  return {
    ok: !!msgid && isCallAccepted(statuscode),
    clientId,
    msgid,
    statuscode,
    statusText: statusText(statuscode),
    accountPoint,
    duplicate,
    raw: text,
  };
}

// 查餘額：只帶 username/password，回應 AccountPoint=剩餘點數；帳密錯誤等情形回應可能沒有
// AccountPoint（改帶 statuscode=e 等），此時 ok:false。
async function queryBalance(cfg, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password });
  const res = await fetchImpl(buildUrl(cfg, 'SmQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  const { fields } = parseKeyValueBlock(text);
  if (fields.AccountPoint == null || fields.AccountPoint === '') {
    return { ok: false, statuscode: fields.statuscode || null, raw: text };
  }
  return { ok: true, balance: Number(fields.AccountPoint), raw: text };
}

// 查狀態：msgid 逗號分隔（呼叫端須自行確保 ≤100 筆，本模組僅做防呆截斷）；回應每行 Tab 分隔
// `msgid\tstatuscode\tstatustime`（無 [clientid] 區段標頭）。
async function queryStatus(cfg, msgids, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const list = (Array.isArray(msgids) ? msgids : String(msgids || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 100);
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password, msgid: list.join(',') });
  const res = await fetchImpl(buildUrl(cfg, 'SmQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.map((line) => {
    const parts = line.split('\t');
    return { msgid: parts[0] || '', statuscode: parts[1] || '', statustime: parts[2] || '' };
  }).filter((it) => it.msgid);
  return { ok: true, items, raw: text };
}

// 取消預約：msgid 逗號分隔；回應每行 `msgid=狀態`，狀態為 9 表示取消成功。
async function cancel(cfg, msgids, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const list = (Array.isArray(msgids) ? msgids : String(msgids || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 100);
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password, msgid: list.join(',') });
  const res = await fetchImpl(buildUrl(cfg, 'SmCancel'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return { msgid: line, statuscode: null, canceled: false };
    const msgid = line.slice(0, eq).trim();
    const statuscode = line.slice(eq + 1).trim();
    return { msgid, statuscode, canceled: statuscode === '9' };
  }).filter((it) => it.msgid);
  return { ok: true, items, raw: text };
}

module.exports = {
  sendSingle,
  queryBalance,
  queryStatus,
  cancel,
  statusText,
  isCallAccepted,
  parseKeyValueBlock,
  encodeSmBody,
  STATUS_TEXT,
};
