// server/src/sse.js — v237：SSE（Server-Sent Events）即時推播基礎建設。
//
// 用途：後端資料異動（空間預約／通知／許願池等）時，主動推一個「哪個檔案變了」的訊號給所有已連線
// 的前端分頁，讓前端立即觸發既有的重讀函式，取代乾等輪詢週期（見 dispatch.js 對 bookingsCommit／
// notifCommit／listCommit／updateJson／createJson 成功後呼叫 broadcast 的收尾段落）。
//
// Payload 只含檔名（如 { path: 'bookings.json' }），絕不含任何資料內容——事件本身沒有個資外洩面，
// 因此可以廣播給「全體已通過授權的連線」而不需要逐一判斷這個人是否有權看到這筆異動的內容（實際內容
// 仍然要走既有 readJson/listCommit 等 action 的授權閘，SSE 只是「叫你去讀」的信號）。
//
// 授權模型：與一般 POST /exec 請求同一套閘門（CLAUDE.md 資安原則 1，預設 deny）——
//   sessionToken 驗簽（sessionAuth.verifySessionToken）→ 未撤銷（getRevokedBefore 比對 iat）→
//   authzDecision（email 須在 config.json 的 users 且未停用）。任一步不過一律 401，且不透露
//   是哪一步失敗（避免資訊洩漏帳號是否存在/是否停用）。
//
// Fallback 策略：前端既有輪詢（通知 5 分、許願池 10 分、空間預約進頁/背景重讀）全數保留不動。
// SSE 只是「更快」的補充管道；連不上、斷線、被 401 拒絕，前端都會照舊靠輪詢運作，使用者體感只是
// 「多等一下」而非功能失效。
'use strict';

const sessionAuth = require('./auth/session');
const gate = require('./authz/gate');
const vdrive = require('./storage/vdrive');

// email → Set(res)：同一使用者可能開多個分頁/裝置，故用 Set 而非單一 res。
const clients = new Map();
const MAX_CONNECTIONS_PER_EMAIL = 6;
const HEARTBEAT_MS = 30 * 1000;

let _heartbeatTimer = null;

function _totalConnections() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// 供測試使用：目前總連線數。
function _clientCount() {
  return _totalConnections();
}

function _startHeartbeatIfNeeded() {
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    for (const [email, set] of clients) {
      for (const res of Array.from(set)) {
        try {
          res.write(':hb\n\n');
        } catch (_e) {
          _removeClient(email, res);
        }
      }
    }
  }, HEARTBEAT_MS);
  // Node 若無其他計時器/handle 亦不應阻止進程退出（測試 require 本模組時尤其重要）。
  if (_heartbeatTimer.unref) _heartbeatTimer.unref();
}

function _stopHeartbeatIfIdle() {
  if (_heartbeatTimer && _totalConnections() === 0) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function _removeClient(email, res) {
  const set = clients.get(email);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(email);
  _stopHeartbeatIfIdle();
}

function _addClient(email, res) {
  let set = clients.get(email);
  if (!set) {
    set = new Set();
    clients.set(email, set);
  }
  // 同一 email 連線數上限：超過時先關掉最舊的一條（防分頁反覆開關殘留連線洩漏，非資安邊界問題，
  // 純粹資源保護）。
  if (set.size >= MAX_CONNECTIONS_PER_EMAIL) {
    const oldest = set.values().next().value;
    if (oldest) {
      set.delete(oldest);
      try { oldest.end(); } catch (_e) { /* 已斷線忽略 */ }
    }
  }
  set.add(res);
  _startHeartbeatIfNeeded();
}

function getConfigUsersSafe(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || null;
  } catch (_e) {
    return null;
  }
}

// GET /events?token=<sessionToken>：驗證通過後升級為 SSE 長連線。
function handleEventsRequest(db, config, req, res) {
  let token = null;
  try {
    const u = new URL(req.url, 'http://x');
    token = u.searchParams.get('token');
  } catch (_e) {
    token = null;
  }

  const unauthorized = () => {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
  };

  if (!token) { unauthorized(); return; }

  const decoded = sessionAuth.verifySessionToken(token, config.SESSION_SECRET);
  if (!decoded) { unauthorized(); return; }

  const revokedBefore = sessionAuth.getRevokedBefore(db, decoded.e);
  if (revokedBefore && Number(decoded.iat) < Number(revokedBefore)) { unauthorized(); return; }

  const ctx = { root: config.ROOT_FOLDER_ID };
  const users = getConfigUsersSafe(db, ctx);
  if (!gate.authzDecision(users, decoded.e)) { unauthorized(); return; }

  const userEmail = decoded.e;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':connected\n\n');

  _addClient(userEmail, res);

  req.on('close', () => {
    _removeClient(userEmail, res);
  });
}

// broadcast：對所有已連線（全體已授權使用者）廣播一則事件。payload 只應含檔名等無個資欄位
// （見檔頭註解）。絕不 throw——呼叫端（dispatch.js）在資料異動成功後呼叫，失敗不可影響原本回應。
function broadcast(eventName, dataObj) {
  try {
    const chunk = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
    for (const [email, set] of clients) {
      for (const res of Array.from(set)) {
        try {
          res.write(chunk);
        } catch (_e) {
          _removeClient(email, res);
        }
      }
    }
  } catch (_e) {
    // 絕不 throw：SSE 廣播是盡力而為的即時性補強，不可讓任何例外冒出去影響呼叫端主流程。
  }
}

// sendTo：只推給指定 email 的所有連線。本版（v237）尚未使用——先建好給 v238 信箱未讀推播使用
// （個人化事件，不宜全體廣播）。同樣絕不 throw。
function sendTo(email, eventName, dataObj) {
  try {
    const set = clients.get(email);
    if (!set) return;
    const chunk = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
    for (const res of Array.from(set)) {
      try {
        res.write(chunk);
      } catch (_e) {
        _removeClient(email, res);
      }
    }
  } catch (_e) {
    // 絕不 throw，理由同 broadcast。
  }
}

module.exports = {
  handleEventsRequest,
  broadcast,
  sendTo,
  _clientCount,
};
