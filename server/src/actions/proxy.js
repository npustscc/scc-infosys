// server/src/actions/proxy.js — Phase 2 GAS 瘦身橋接掛點。
//
// 日曆同步 7 個 action（createCalendarEvent／updateCalendarEvent／deleteCalendarEvent／
// listCalendarEvents／shareCalendarWriters／gcAnnotateEvent／getCalendarMeta）已於 Phase 2b
// 改走本機 Calendar REST 直連（src/google/calendar.js＋src/sync/gcSync.js，OAuth 用伺服器端
// 憑證檔 CALENDAR_SYNC_CREDS，見 src/config.js），不再落在本檔的 proxy stub——直接在 dispatch.js
// 分派到對應實作。CALENDAR_ACTIONS 保留為空集合（而非整段刪除概念），理由同 MAIL_ACTIONS：
// isProxyAction 呼叫端在誤用這些名稱時，仍會被 dispatch.js default 分支的「一般 not-implemented」
// 接住，不會被誤判為「仍要走 GAS 代理」。
//
// npust5 信件解析／身心調適假窗口相關 4 個 action 同樣已改走本機直連（見 dispatch.js 對應 case／
// 頂層特例），MAIL_ACTIONS 理由同上。
const CALENDAR_ACTIONS = new Set([]);
const MAIL_ACTIONS = new Set([]);

const PROXY_ACTIONS = new Set([...CALENDAR_ACTIONS, ...MAIL_ACTIONS]);

function isProxyAction(action) {
  return PROXY_ACTIONS.has(action);
}

// TODO：若未來仍有其他 action 需要 Phase 2 GAS 瘦身橋接（GAS_PROXY_URL 轉發），可比照本檔案曾經
// 的 CALENDAR_ACTIONS/proxyToGas 寫法擴充。目前兩批 action（日曆／npust5 信件）皆已直連，
// 本階段無使用中的轉發需求，proxyToGas 暫留空殼供未來沿用，一律回 not-implemented。
async function proxyToGas(_action, _params, _gasProxyUrl) {
  return { implemented: false };
}

module.exports = { CALENDAR_ACTIONS, MAIL_ACTIONS, PROXY_ACTIONS, isProxyAction, proxyToGas };
