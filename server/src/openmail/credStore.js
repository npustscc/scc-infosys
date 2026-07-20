// server/src/openmail/credStore.js — v202 校內 openmail 收發信：使用者 openmail 帳密的記憶體暫存。
//
// 最高資安要求（見任務指示與 CLAUDE.md 資安原則）：openmail 密碼只存於本 process 記憶體，
//   - 永不落地（不進 sqlite、不進 audit_log、不進任何 log 檔）
//   - 永不回傳前端（omStatus 只回 mailUser，不回 mailPass）
//   - session 顯式登出（sessionLogout）時由 dispatch.js 同步呼叫 clear(email)，立即清除，
//     不需等到效期到。
//
// v220 效期策略改為「7 天滑動視窗」（原本是與登入 session 同壽命的台北午夜過期）：
//   - 理由：openmail 帳密只是打開一個已經通過 session 驗證使用者的信箱，不是額外的敏感度層級——
//     真正的存取邊界仍是 session 本身（sessionToken 過期或被撤銷，dispatch.js 的授權閘就已擋下
//     所有 om*/omsv* action，credStore 是否還留著快取的信箱密碼並不會多開任何攻擊面）。原「每日
//     必須重登信箱」對日常使用（尤其週末不開機、隔一兩天才回來看信）造成不必要的摩擦，重連時
//     又得手動重新輸入密碼。
//   - set()：每次成功 omConnect 都把效期重設為 now + 7 天。
//   - get()：只要仍未過期，每次成功取用就「滑動續期」再往後推 7 天（不是固定 7 天後就強制過期，
//     而是「7 天沒被使用才過期」）——比照瀏覽器 session cookie 滑動視窗的常見設計。
//   - 安全性沒有降低：本模組仍是純記憶體 Map、不吃 db 參數、不做任何 I/O，**重啟 server process
//     即全部清空**——這是刻意保留的安全設計，理由不變：使用者重新輸入帳密即可，比照「密碼永不
//     落地」的目標，本就不該有任何形式的持久化（sqlite/log 檔皆不落地）。換句話說，7 天滑動效期
//     只影響「同一次 process 存活期間內，多久沒用就得重連」，process 重啟（部署/當機）仍強制
//     所有人重新輸入密碼。
'use strict';

const SLIDING_WINDOW_SEC = 7 * 24 * 3600;

// sessionEmail → { mailUser, mailPass, expSec }
const store = new Map();

function slidingExpSec(nowMs) {
  return Math.floor(nowMs / 1000) + SLIDING_WINDOW_SEC;
}

function set(email, mailUser, mailPass, nowMs = Date.now()) {
  if (!email) return;
  store.set(email, { mailUser, mailPass, expSec: slidingExpSec(nowMs) });
}

// 過期即刪並回 null（fail-closed）；成功取用（未過期）時就地「滑動續期」，效期重推 7 天。
// 回傳的物件是內部參照，呼叫端不應保存超過單次操作的生命週期。
function get(email, nowMs = Date.now()) {
  if (!email) return null;
  const entry = store.get(email);
  if (!entry) return null;
  if (entry.expSec <= Math.floor(nowMs / 1000)) {
    store.delete(email);
    return null;
  }
  entry.expSec = slidingExpSec(nowMs); // 滑動續期
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
