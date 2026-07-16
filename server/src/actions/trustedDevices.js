// server/src/actions/trustedDevices.js — 信任裝置清單／逐台撤銷（Phase 3b）：listMyDevices／
// revokeDevice 兩個 action。走 dispatch 一般授權閘（需已登入 session），userEmail 一律來自已驗證
// 的 session token（dispatch.js 解出），不吃 params 裡的 email，杜絕越權操作他人裝置清單
// （比照 actions/totpSetup.js 的既有原則）。
'use strict';

const deviceTrust = require('../auth/deviceTrust');

// currentDeviceToken：由 index.js 從 Cookie header 注入 params.deviceToken（每個 action 皆有，
// 非 sessionStart 專屬），用於在清單中標記「目前這台」。
function listMyDevices(db, userEmail, currentDeviceToken) {
  return { devices: deviceTrust.listDevices(db, userEmail, currentDeviceToken) };
}

function revokeDevice(db, userEmail, params) {
  const ok = deviceTrust.revokeDevice(db, userEmail, params && params.deviceId);
  return { ok };
}

module.exports = { listMyDevices, revokeDevice };
