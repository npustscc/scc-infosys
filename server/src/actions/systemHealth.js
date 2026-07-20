// server/src/actions/systemHealth.js — v221 磁碟健康度：adminGetDiskHealth（管理者專屬，見
// authz/gate.js ADMIN_ONLY_ACTIONS）。
//
// 資料來源是 root systemd timer（scripts/smart-poll.js，本檔不動）定期寫出的唯讀 JSON
// （SMART_STATUS_PATH，見 config.js），本 action 只做「讀檔、JSON.parse、原樣回傳」——不做欄位
// 轉換或裁切，前端需要的人性化格式（GB/TB、年、警示色）全部在前端渲染時計算，避免後端與前端各自
// 維護一份格式化邏輯。
'use strict';

const fs = require('fs');

// config 為 dispatch.js handleRequest 已持有的整包設定物件（含 SMART_STATUS_PATH），不重新
// require('../config')——比照本檔案所在目錄其餘 action 一律吃呼叫端傳入的值，方便測試灌自訂設定。
function adminGetDiskHealth(config) {
  const statusPath = (config && config.SMART_STATUS_PATH) || '';
  if (!statusPath) return { error: 'smart_not_configured' };
  let raw;
  try {
    raw = fs.readFileSync(statusPath, 'utf8');
  } catch (e) {
    return { error: 'smart_not_available' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { error: 'smart_not_available' };
  }
  return Object.assign({ statusPath: true }, data);
}

module.exports = { adminGetDiskHealth };
