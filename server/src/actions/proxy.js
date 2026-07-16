// server/src/actions/proxy.js — Phase 2 GAS 瘦身橋接掛點（日曆同步 7 個 action）。
// Phase 1 骨架範圍不含轉發本體實作（見計畫「關鍵實作提醒」：GAS_PROXY_URL 設定時才轉發，
// 本階段不實作轉發本體，留清楚的 TODO 掛點）——一律回傳 not-implemented 業務錯誤，即使
// GAS_PROXY_URL 已設定也一樣（避免半成品轉發邏輯在骨架階段被誤用於生產）。
'use strict';

// 日曆同步（Phase 2 仍留在 GAS，見 CLAUDE.md 定案：日曆同步留在瘦身 GAS）。
const CALENDAR_ACTIONS = new Set([
  'createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'listCalendarEvents',
  'shareCalendarWriters', 'gcAnnotateEvent', 'getCalendarMeta',
]);

// npust5 信件解析／身心調適假窗口相關 4 個 action（getNpust5AuthUrl／exchangeNpust5OAuthCode／
// fetchMentalLeaves／clearMentalLeaves）已改走本機 Gmail REST 直連（src/google/gmail.js＋
// src/mail/mentalLeaves.js＋src/actions/mail.js，OAuth 用伺服器端憑證檔 GMAIL_SYNC_CREDS，
// 不再需要網頁授權流程），故不再落在 proxy stub——直接在 dispatch.js 分派到對應實作／固定業務錯誤。
// 保留空集合（而非整段刪除 MAIL_ACTIONS 概念）是為了 isProxyAction 呼叫端在誤用這 4 個名稱時，
// 仍會被下方 CALENDAR_ACTIONS 之外的「一般 not-implemented」分支接住（見 dispatch.js default 分支），
// 不會意外變成走到本檔的日曆代理邏輯。
const MAIL_ACTIONS = new Set([]);

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
