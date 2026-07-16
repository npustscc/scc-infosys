// server/src/actions/clockBridge.js — 打卡權杖管理三 action（clockTokenIssue/Revoke/List）橋接轉發。
//
// 打卡系統永久留在 GAS＋Drive（2026-07-16 定案）：免登入打卡頁（scc-clock）與權杖驗證、登記檔
// clock_tokens.json 都在 GAS 側，權杖用 GAS 的 SESSION_SECRET 簽——簽發/停用只能由 GAS 執行。
// 本模組把「已通過本地登入與授權閘」的使用者請求，以共享密鑰（GAS_BRIDGE_KEY）轉發到 GAS doPost
// 的 bridgeKey 分支（見 dev/Code.gs doPost 身分解析段）；GAS 側仍會對 actorEmail 過
// isAuthorizedUser_ 與 _clockTokenAdminGate_ 兩道硬閘（縱深防禦），本地不重複實作角色閘，
// 權限判定以 GAS 為權威——本地與 GAS 的 config.users 在平行運行期可能短暫不一致，雙邊各自
// enforcing 只會讓行為更難推理，單一權威（GAS，登記檔所在地）最直觀。
//
// 打卡「資料」則反向流動：GAS 寫 Drive attendance.json，scripts/pull-attendance.js 每 10 分鐘
// add-only 併入本地——本模組只管「簽發/停用網址」這條控制面，不碰打卡資料面。
'use strict';

// 底層轉發（獨立函式以便測試 monkey-patch，比照 google/gmail.js 的 gmailFetch 慣例）。
// GAS doPost 讀 e.parameter.payload（urlencoded form 欄位），回應為 {success, data} envelope；
// script.google.com 對 POST 回 302 轉址到 googleusercontent.com，全域 fetch 依規範對 302 自動
// 改用 GET 跟隨（curl 需拿掉 -X POST 的同一件事，fetch 內建行為正確、不需特別處理）。
async function bridgeFetch(url, payloadObj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payload: JSON.stringify(payloadObj) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`打卡橋接：GAS 回應 HTTP ${res.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    // GAS 部署失效/權限頁等情況會回 HTML——不可把整頁 HTML 帶進錯誤訊息（journal 汙染）。
    throw new Error('打卡橋接：GAS 回應非 JSON（部署或權限異常）');
  }
  return parsed;
}

// 轉發單一 clock 管理 action。回傳值直接作為 dispatch 的 result（GAS data 內的 {error:'Forbidden'}
// 等業務錯誤原樣透傳，前端行為與直打 GAS 完全一致）。
async function forwardClockAction(config, action, actorEmail, params) {
  if (!config.GAS_BRIDGE_URL || !config.GAS_BRIDGE_KEY) {
    return { error: '伺服器尚未設定打卡橋接（GAS_BRIDGE_URL／GAS_BRIDGE_KEY），請聯絡系統管理者' };
  }
  const payload = {
    bridgeKey: config.GAS_BRIDGE_KEY,
    action,
    actorEmail,
    // GAS 側以 rootFolderId 決定 ctx（登記檔所在 Drive root）；本地 ROOT_FOLDER_ID 與 GAS
    // ALLOWED_ROOTS 的同環境 id 一致（dev 對 dev、prod 對 prod），帶錯環境會被 GAS 拒絕。
    rootFolderId: config.ROOT_FOLDER_ID,
  };
  if (params && params.email) payload.email = params.email;

  const parsed = await module.exports.bridgeFetch(config.GAS_BRIDGE_URL, payload);
  if (!parsed || parsed.success !== true) {
    throw new Error('打卡橋接：GAS envelope 異常（' + ((parsed && parsed.error) || 'unknown') + '）');
  }
  return parsed.data;
}

module.exports = { bridgeFetch, forwardClockAction };
