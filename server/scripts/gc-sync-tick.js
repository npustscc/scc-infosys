#!/usr/bin/env node
// server/scripts/gc-sync-tick.js — GC 日曆同步 tick（CLI 進入點，供 systemd timer 每 5 分鐘觸發，
// 亦可手動執行）。對映 dev/Code.gs runGcSyncTick（L4078）＋_gcSyncShouldRun 時段閘（L4066）；
// 核心同步邏輯見 src/sync/gcSync.js（與 dispatch 的日曆 action 共用同一組協調函式，不重複實作）。
//
// 時段閘（對映 GAS：timer 固定每 5 分鐘打進來，這裡決定要不要真的跑）：
//   週一/四 08-21、週二/三/五 08-18 → 每次都跑；其餘時段只在整點附近（minute<5）跑一次。
//   手動測試用 --force 跳過此閘。
//
// exit code 語意（比照 scripts/pull-mental-leaves.js）：
//   0＝正常（含「時段閘判定本次不跑」與「同步過程個別項目失敗」——gcSyncCore 對映 GAS trigger
//     語意，內部全 try/catch 不拋出）；非零＝憑證缺失/DB 開啟失敗等環境層級錯誤。
//
// 用法：
//   CALENDAR_SYNC_CREDS=/path/to/creds.json GC_CALENDAR_NAME='[DEV] SCC 空間預約' node scripts/gc-sync-tick.js [--force]
// （憑證 JSON 格式：{ client_id, client_secret, refresh_token }，refresh_token 的 scope 需含
//  https://www.googleapis.com/auth/calendar，npust.scc 帳號；儲存路徑 chmod 600。）
'use strict';

const config = require('../src/config');
const { openDb } = require('../src/db');
const gcSync = require('../src/sync/gcSync');
const { taipeiParts } = require('../src/util/taipeiTime');

async function main() {
  const force = process.argv.includes('--force');

  if (!config.CALENDAR_SYNC_CREDS) {
    console.error('[gc-sync-tick] 缺少環境變數 CALENDAR_SYNC_CREDS（請於 server/.env 設定，指向 calendar scope 的 OAuth 憑證 JSON 檔路徑）');
    process.exit(1);
    return;
  }

  const p = taipeiParts(Date.now());
  if (!force && !gcSync.gcSyncShouldRun(p.weekday, p.hour, p.minute)) {
    console.log(`[gc-sync-tick] 時段閘：非同步時段（台北 週${p.weekday} ${p.hour}:${String(p.minute).padStart(2, '0')}），本次跳過（--force 可強制執行）`);
    return;
  }

  let calendarClient;
  try {
    calendarClient = gcSync.calendarClientFromConfig(config);
  } catch (e) {
    console.error('[gc-sync-tick] 憑證載入失敗：' + e.message);
    process.exit(1);
    return;
  }

  let db;
  try {
    db = openDb(config.DB_PATH);
  } catch (e) {
    console.error('[gc-sync-tick] DB 開啟失敗：' + e.message);
    process.exit(1);
    return;
  }

  const ctx = { root: config.ROOT_FOLDER_ID };
  const t0 = Date.now();
  // gcSyncCore 對映 GAS trigger 語意：內部全 try/catch、失敗 console.error 後不拋出，
  // 故這裡不需要再包一層——真的拋出來代表程式 bug，讓它非零 exit 進 journal。
  await gcSync.gcSyncCore(db, ctx, calendarClient);
  console.log(`[gc-sync-tick] 完成（${Date.now() - t0}ms，日曆「${calendarClient.calendarName}」）`);
}

main();
