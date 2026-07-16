// server/src/google/auth.js — 通用 Google OAuth refresh-token helper（憑證檔讀取＋access token 換取＋
// 記憶體快取），供 scripts/pull-attendance.js（Drive 唯讀）與 scripts/pull-mental-leaves.js／
// src/actions/mail.js（Gmail 讀寫）共用。行為對映 dev/Code.gs npust5GetAccessToken_（L2519）：
// access token 快取至到期前 5 分鐘（避免每次呼叫都打 token endpoint），過期才用 refresh_token 換新。
//
// 測試友善設計：本模組內部一律透過 `exports.xxx(...)`／`module.exports.xxx(...)` 呼叫自身其他函式
// （而非直接呼叫同檔案內的區域函式綁定），使測試可用 `require('./auth').tokenFromRefresh = fake`
// monkey-patch 掉網路呼叫，且此替換對 createTokenCache 內部呼叫同樣生效（不會因為 JS 的區域綁定
// 在模組載入當下就「鎖死」函式參照而失效）。
'use strict';

const fs = require('node:fs');

const TOKEN_URI = 'https://oauth2.googleapis.com/token';

// 讀取憑證檔：{ client_id, client_secret, refresh_token }（皆為必要字串欄位）。
function loadCreds(credsPath) {
  let raw;
  try {
    raw = fs.readFileSync(credsPath, 'utf8');
  } catch (e) {
    throw new Error('讀取憑證檔失敗：' + credsPath + '（' + e.code + '）');
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (_e) {
    throw new Error('憑證檔內容不是合法 JSON：' + credsPath);
  }
  if (!j || typeof j.client_id !== 'string' || typeof j.client_secret !== 'string' || typeof j.refresh_token !== 'string') {
    throw new Error('憑證檔格式不符，需含 client_id/client_secret/refresh_token（字串）：' + credsPath);
  }
  return j;
}

// refresh_token 換 access_token（headless，無需互動授權）。回傳 { accessToken, expiresIn }。
async function tokenFromRefresh(creds, refreshToken) {
  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    // 不印出回應內容——refresh 失敗訊息可能夾帶敏感細節，且我們無法保證裡面沒有憑證片段。
    throw new Error('refresh token 交換失敗（HTTP ' + res.status + '）');
  }
  const json = await res.json();
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('refresh token 交換回應格式異常（缺 access_token）');
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in || 3600 };
}

// createTokenCache：包一層記憶體快取（單一 process 生命週期，重啟即清空）——CLI script（單次執行
// 即結束）等同「不快取」，長駐 server process（dispatch 手動觸發 fetchMentalLeaves/clearMentalLeaves）
// 則能避免高頻觸發時每次都重新打 token endpoint。緩衝值（提前 5 分鐘視為過期）對映 GAS 版
// npust5GetAccessToken_ 的 `Date.now() < exp - 300000` 判斷。
function createTokenCache(creds) {
  let cached = null; // { accessToken, expiresAt }
  return {
    async getAccessToken() {
      if (cached && Date.now() < cached.expiresAt - 300000) return cached.accessToken;
      const { accessToken, expiresIn } = await exports.tokenFromRefresh(creds, creds.refresh_token);
      cached = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
      return cached.accessToken;
    },
  };
}

exports.loadCreds = loadCreds;
exports.tokenFromRefresh = tokenFromRefresh;
exports.createTokenCache = createTokenCache;
exports.TOKEN_URI = TOKEN_URI;
