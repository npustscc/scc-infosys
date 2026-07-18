// server/src/openmail/credStore.js — v202 校內 openmail 收發信：使用者 openmail 帳密的記憶體暫存。
//
// 最高資安要求（見任務指示與 CLAUDE.md 資安原則）：openmail 密碼只存於本 process 記憶體，
//   - 永不落地（不進 sqlite、不進 audit_log、不進任何 log 檔）
//   - 永不回傳前端（omStatus 只回 mailUser，不回 mailPass）
//   - 與登入 session 同壽命：expSec 沿用 auth/session.js 的 nextTaipeiMidnightEpochSec（下一個台北
//     午夜），與 sessionToken 的 exp 算法完全相同——session 過期時，即使呼叫端忘了顯式登出，
//     get() 也會在下一次呼叫時因 expSec 已過而自動視為未連線（fail-closed）。
//   - session 顯式登出（sessionLogout）時由 dispatch.js 同步呼叫 clear(email)，立即清除，
//     不等到午夜。
// 本模組是純記憶體 Map，不吃 db 參數、不做任何 I/O——重啟 server process 即全部清空（可接受：
// 使用者重新輸入帳密即可，比照「密碼永不落地」的設計目標，本就不該有任何形式的持久化）。
'use strict';

const sessionAuth = require('../auth/session');

// sessionEmail → { mailUser, mailPass, expSec }
const store = new Map();

function set(email, mailUser, mailPass, nowMs = Date.now()) {
  if (!email) return;
  const expSec = sessionAuth.nextTaipeiMidnightEpochSec(nowMs);
  store.set(email, { mailUser, mailPass, expSec });
}

// 過期即刪並回 null（fail-closed）；回傳的物件是內部參照，呼叫端不應保存超過單次操作的生命週期。
function get(email, nowMs = Date.now()) {
  if (!email) return null;
  const entry = store.get(email);
  if (!entry) return null;
  if (entry.expSec <= Math.floor(nowMs / 1000)) {
    store.delete(email);
    return null;
  }
  return entry;
}

function clear(email) {
  if (!email) return;
  store.delete(email);
}

// 掃除所有已過期項目（供未來排程呼叫；目前 get() 本身已 lazy 清除，sweep 非必要路徑，但保留
// 供長時間無人呼叫 get() 的帳號也能被回收，避免 Map 無限增長）。
function sweep(nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  for (const [email, entry] of store) {
    if (entry.expSec <= nowSec) store.delete(email);
  }
}

// 測試/診斷專用：目前暫存的帳號數（不洩漏內容）。
function _size() {
  return store.size;
}

module.exports = { set, get, clear, sweep, _size };
