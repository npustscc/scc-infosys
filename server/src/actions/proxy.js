// server/src/actions/proxy.js — Phase 2 GAS 瘦身橋接掛點（日曆同步 7 個 + npust5 信件解析 4 個 action）。
// Phase 1 骨架範圍不含轉發本體實作（見計畫「關鍵實作提醒」：GAS_PROXY_URL 設定時才轉發，
// 本階段不實作轉發本體，留清楚的 TODO 掛點）——一律回傳 not-implemented 業務錯誤，即使
// GAS_PROXY_URL 已設定也一樣（避免半成品轉發邏輯在骨架階段被誤用於生產）。
'use strict';

// 日曆同步（Phase 2 仍留在 GAS，見 CLAUDE.md 定案：日曆同步與信件解析留在瘦身 GAS）。
const CALENDAR_ACTIONS = new Set([
  'createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'listCalendarEvents',
  'shareCalendarWriters', 'gcAnnotateEvent', 'getCalendarMeta',
]);

// npust5 信件解析／身心調適假窗口相關（同樣留在瘦身 GAS，依賴 Gmail API／OAuth2 code exchange）。
// 註（偏差記錄）：計畫文字只寫「信件 4 個 action」未逐一列名；此處依「依賴 npust5 Gmail
// OAuth／信件解析」的實質判準選出 4 個。countMentalLeavesUnprocessed_ 不在此列——它只是對
// mental_leaves.json（已在 vdrive 內的一般 JSON 檔）計數，不涉及外部信件擷取，歸入一般
// not-implemented（可用既有 readJson 邏輯之後補上，不需 GAS 代理）。
const MAIL_ACTIONS = new Set([
  'getNpust5AuthUrl', 'exchangeNpust5OAuthCode', 'fetchMentalLeaves', 'clearMentalLeaves',
]);

const PROXY_ACTIONS = new Set([...CALENDAR_ACTIONS, ...MAIL_ACTIONS]);

function isProxyAction(action) {
  return PROXY_ACTIONS.has(action);
}

// TODO（Phase 2）：GAS_PROXY_URL 設定時，這裡應該把 { action, ...params } 轉發到既有 GAS
// doPost（沿用同一份 wire contract：urlencoded payload 單欄位），並把回應的 data 原樣回傳。
// 本階段刻意不實作轉發本體（見檔頭註解），一律回 not-implemented，即使 GAS_PROXY_URL 已設定。
async function proxyToGas(_action, _params, _gasProxyUrl) {
  return { implemented: false };
}

module.exports = { CALENDAR_ACTIONS, MAIL_ACTIONS, PROXY_ACTIONS, isProxyAction, proxyToGas };
