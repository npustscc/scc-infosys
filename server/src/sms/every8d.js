// server/src/sms/every8d.js — Every8D 簡訊 API21 v2.1 薄封裝層。全域 fetch（Node >=18 內建），
// 跟 sms/mitake.js 同慣例：`opts.fetchImpl` 可注入假 fetch 供測試使用，不需真的打網路。
//
// 帳密（UID/PWD）一律由呼叫端（sms/actions.js）從 server .env 讀入後以 cfg 物件傳入，本模組不讀
// process.env、不快取任何機密。
//
// Every8D 是「整批一次呼叫」（DEST 逗號分隔多門號），與三竹「逐一呼叫」不同——本模組的 send() 因此
// 一次呼叫即涵蓋整批收件人，回應也只有整批層級的 CREDIT/SENDED/COST/UNSEND/BATCHID，沒有逐人的
// msgid（逐人送達狀態要靠 getDeliveryStatus 用 BATCHID 查）。
'use strict';

function buildUrl(cfg, name) {
  return `https://${cfg.host}/API21/HTTP/${name}.ashx`;
}

// 所有成功回應皆非 `-` 開頭；失敗回應固定格式 `-代碼,訊息`（HTTP 狀態碼恆為 200，一律要看 body
// 開頭字元才能判斷成敗，比照 sendSMS/getCredit/eraseBooking 共用同一套判斷）。
function parseFailure(text) {
  const body = text.slice(1); // 去掉開頭的 '-'
  const comma = body.indexOf(',');
  if (comma === -1) return { code: '-' + body, message: null };
  return { code: '-' + body.slice(0, comma), message: body.slice(comma + 1) || null };
}

// 發送：DEST 多門號以半形逗號分隔一次送出；ST 為預約時間（14 碼 YYYYMMDDHHMMSS 台北時間字串），
// 即發時帶空字串（由呼叫端 sms/actions.js 決定，本模組不重複判斷）。SB（主旨）固定帶空字串——
// 官方文件標註僅供記錄用途，不影響簡訊實際內容。
async function send(cfg, params, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const body = new URLSearchParams();
  body.set('UID', cfg.uid);
  body.set('PWD', cfg.pwd);
  body.set('SB', '');
  body.set('MSG', params.message);
  body.set('DEST', (params.phones || []).join(','));
  body.set('ST', params.scheduledAt || '');

  const res = await fetchImpl(buildUrl(cfg, 'sendSMS'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = (await res.text()).trim();
  if (text.startsWith('-')) {
    const fail = parseFailure(text);
    return { ok: false, code: fail.code, message: fail.message, raw: text };
  }
  const [credit, sended, cost, unsend, batchId] = text.split(',');
  return {
    ok: true,
    credit: credit != null && credit !== '' ? Number(credit) : null,
    sended: sended != null && sended !== '' ? Number(sended) : null,
    cost: cost != null && cost !== '' ? Number(cost) : null,
    unsend: unsend != null && unsend !== '' ? Number(unsend) : null,
    batchId: batchId || null,
    raw: text,
  };
}

// 查餘額：回應純文字餘額（如 "1000.00"），失敗同樣以 `-` 開頭。
async function getCredit(cfg, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const body = new URLSearchParams({ UID: cfg.uid, PWD: cfg.pwd });
  const res = await fetchImpl(buildUrl(cfg, 'getCredit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = (await res.text()).trim();
  if (text.startsWith('-')) {
    const fail = parseFailure(text);
    return { ok: false, code: fail.code, message: fail.message, raw: text };
  }
  return { ok: true, balance: Number(text), raw: text };
}

// 查送達狀態：帶批次 GUID（BID）、PNO=1（第一頁）、RESPFORMAT=1（JSON），回應
// { SMS_COUNT, BID, DATA: [{ NAME, MOBILE, SEND_TIME, COST, STATUS, RECEIVED_TIME, ... }] }。
async function getDeliveryStatus(cfg, batchId, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const body = new URLSearchParams({ UID: cfg.uid, PWD: cfg.pwd, BID: batchId, PNO: '1', RESPFORMAT: '1' });
  const res = await fetchImpl(buildUrl(cfg, 'getDeliveryStatus'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = (await res.text()).trim();
  if (text.startsWith('-')) {
    const fail = parseFailure(text);
    return { ok: false, code: fail.code, message: fail.message, raw: text };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    return { ok: false, code: 'parse_error', message: '回應非合法 JSON', raw: text };
  }
  return { ok: true, smsCount: json.SMS_COUNT, batchId: json.BID, items: Array.isArray(json.DATA) ? json.DATA : [], raw: text };
}

// 取消預約：成功回應 `刪除筆數,回補點數`；失敗同樣以 `-` 開頭。
async function eraseBooking(cfg, batchId, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const body = new URLSearchParams({ UID: cfg.uid, PWD: cfg.pwd, BID: batchId });
  const res = await fetchImpl(buildUrl(cfg, 'eraseBooking'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = (await res.text()).trim();
  if (text.startsWith('-')) {
    const fail = parseFailure(text);
    return { ok: false, code: fail.code, message: fail.message, raw: text };
  }
  const [deleted, refunded] = text.split(',');
  return {
    ok: true,
    deleted: deleted != null && deleted !== '' ? Number(deleted) : null,
    refunded: refunded != null && refunded !== '' ? Number(refunded) : null,
    raw: text,
  };
}

// DR（送達回報）狀態碼對照表（官方 API21 v2.1 文件）：0/100 為成功送達路徑，101~106 為已知失敗
// 原因，300/301/303/700 為批次層級狀態（非單一門號送達結果），負數為呼叫層級錯誤代碼。
const DR_STATUS_TEXT = {
  0: '已送達電信端',
  100: '已送達手機',
  101: '手機關機或訊號不良',
  102: '電信端異常',
  103: '空號',
  104: '黑名單門號',
  105: '內容含關鍵字阻擋',
  106: '內容含關鍵字阻擋',
  300: '預約中',
  301: '額度不足',
  303: '已取消',
  700: '已送出（等待送達回報）',
};

function drStatusText(code) {
  if (code == null) return null;
  const n = Number(code);
  if (DR_STATUS_TEXT[n] != null) return DR_STATUS_TEXT[n];
  if (n < 0) return `呼叫層級錯誤（代碼 ${code}）`;
  return `未知狀態代碼：${code}（請對照 Every8D 官方 API21 文件更新對照表）`;
}

module.exports = {
  send,
  getCredit,
  getDeliveryStatus,
  eraseBooking,
  drStatusText,
  DR_STATUS_TEXT,
  parseFailure,
};
