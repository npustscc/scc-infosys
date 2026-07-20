// server/src/openmail/credStore.js — v202 校內 openmail 收發信：使用者 openmail 帳密的記憶體暫存。
//
// 最高資安要求（見任務指示與 CLAUDE.md 資安原則）：openmail 密碼只存於本 process 記憶體，
//   - 永不落地（不進 sqlite、不進 audit_log、不進任何 log 檔）
//   - 永不回傳前端（omStatus 只回 mailUser，不回 mailPass）
//   - session 顯式登出（sessionLogout）時由 dispatch.js 同步呼叫 clear(email)，立即清除，
//     不需等到效期到。
//
// v224 效期策略改為「每週日 00:00（台北時間）統一過期」（原 v220 為 7 天滑動視窗）：
//   - 理由：openmail 帳密只是打開一個已通過 session 驗證使用者的信箱，真正的存取邊界仍是 session
//     本身（sessionToken 過期/撤銷時 dispatch.js 授權閘已擋下所有 om*/omsv* action，快取密碼與否
//     不多開攻擊面）。改為固定週界，讓「多久要重連一次」有可預期節奏（每週日凌晨全體重連一次），
//     且不因平日頻繁使用而無限續期。
//   - set()：效期設為「下一個週日 00:00（台北）」。get()：固定週界、取用不再滑動續期，過期即刪。
//   - 安全性不變：純記憶體 Map、不吃 db、不做 I/O，**重啟 server process 即全部清空**——密碼永不
//     落地（sqlite/log 皆不落地），process 重啟仍強制所有人重新輸入密碼。
'use strict';

const TAIPEI_OFFSET_SEC = 8 * 3600; // 台北 UTC+8，無日光節約

// 下一個「週日 00:00（台北）」的 epoch 秒。當下已是某個週日的 00:00 之後，回傳的是「再下一個」週日。
function nextSundayMidnightSec(nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const tSec = nowSec + TAIPEI_OFFSET_SEC;        // 位移成「台北牆上時間」秒數
  const day = Math.floor(tSec / 86400);            // 台北日序
  const dow = (day + 4) % 7;                        // 0=週日（1970-01-01 為週四）
  const daysUntil = dow === 0 ? 7 : (7 - dow);      // 週日當天也推到下一個週日
  const nextMidnightTaipeiSec = (day + daysUntil) * 86400;
  return nextMidnightTaipeiSec - TAIPEI_OFFSET_SEC; // 位移回真實 epoch
}

// sessionEmail → { mailUser, mailPass, expSec }
const store = new Map();

function set(email, mailUser, mailPass, nowMs = Date.now()) {
  if (!email) return;
  store.set(email, { mailUser, mailPass, expSec: nextSundayMidnightSec(nowMs) });
}

// 過期即刪並回 null（fail-closed）。效期為固定週界（週日 00:00 台北），取用不再滑動續期。
// 回傳的物件是內部參照，呼叫端不應保存超過單次操作的生命週期。
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

module.exports = { set, get, clear, sweep, _size, nextSundayMidnightSec };
