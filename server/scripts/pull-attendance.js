#!/usr/bin/env node
// server/scripts/pull-attendance.js — 打卡紀錄 Drive 拉取器。
//
// 背景：打卡永久留在 GAS＋Google Drive（attendance.json 存於 Drive root folder 直下，
// 由既有 GAS 後端的 attendanceCommit_ 併發安全寫入，見 dev/Code.gs 附近 L2938）。
// 區網 Node server（SQLite vdrive）需要定時「單向」把新增的打卡紀錄拉回本地，供本地報表/查詢使用。
//
// 設計原則（務必維持）：
//   1. 單向、add-only：只把「Drive 有、本地沒有」的紀錄（依 record.id）併入本地，絕不修改／刪除
//      本地既有紀錄——本地可能有管理者手動補登/修正，而 GAS 端打卡本質是 append-only 流水帳，
//      故「本地優先、只補新增」才是正確語意，不能做雙向同步或以 Drive 內容覆蓋本地。
//   2. 憑證/token 絕不可外洩：不印到 stdout/stderr、不寫入本地檔案以外的任何地方。
//   3. 找不到 Drive 檔案／Drive 尚無新紀錄都視為正常情況（exit 0），只有「讀取/驗證/寫入失敗」
//      才視為錯誤（非零 exit，讓 systemd journal 可以判定失敗並觸發下一輪 timer）。
//
// 用法：
//   DRIVE_SYNC_CREDS=/path/to/creds.json node scripts/pull-attendance.js
// （憑證 JSON 格式：{ client_id, client_secret, refresh_token }，refresh_token 的 scope 需含
//  https://www.googleapis.com/auth/drive.readonly；建議由 scripts/pull-bugreports.mjs 相同帳號
//  走一次互動式授權取得後，另存一份唯讀 scope 的 refresh_token 到此檔，chmod 600。）
'use strict';

const fs = require('node:fs');
const config = require('../src/config');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');

const ATTENDANCE_PATH = 'attendance.json';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

// ── 純函式：合併邏輯（單元測試對象，不觸網）──────────────────────────
// localData：本地 vdrive 現有的 attendance.json 內容，可能為 null（尚無此檔）。
// driveRecords：從 Drive 版 attendance.json 讀出的 records 陣列。
// 回傳 { merged, added, skippedNoId }：
//   - merged：合併後應寫回本地的完整內容物件（保留 localData 除 records 外的其他頂層欄位）。
//   - added：本次新增的筆數。
//   - skippedNoId：Drive 端因缺少非空字串 id 而被跳過（不納入合併）的筆數。
// 語意：以 id 為鍵，只新增本地沒有的 id；本地既有紀錄一律原樣保留，不因 Drive 同 id 紀錄而覆寫
// ——本地可能有手動補登/管理者修正，而 GAS 端本就是唯一權威的打卡來源，add-only 才不會互相打架。
function mergeAttendance(localData, driveRecords) {
  const base = localData && typeof localData === 'object' ? localData : {};
  const localRecords = Array.isArray(base.records) ? base.records : [];

  const seen = new Set();
  for (const r of localRecords) {
    if (r && typeof r.id === 'string' && r.id) seen.add(r.id);
  }

  const merged = localRecords.slice();
  let added = 0;
  let skippedNoId = 0;
  for (const r of driveRecords || []) {
    if (!r || typeof r.id !== 'string' || !r.id) { skippedNoId++; continue; }
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
    added++;
  }

  return {
    merged: Object.assign({}, base, { records: merged }),
    added,
    skippedNoId,
  };
}

// ── OAuth：refresh_token 換 access_token（headless，無需互動授權）───────
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
  return json.access_token;
}

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

// ── Drive API（唯讀）──────────────────────────────────────────────────
async function driveFetch(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) {
    // 同樣不印 body——避免意外把授權相關的錯誤細節（可能含 token 片段）外洩到 log。
    throw new Error('Drive API 呼叫失敗（HTTP ' + res.status + '）：' + url.split('?')[0]);
  }
  return res;
}

async function findAttendanceFile(rootFolderId, accessToken) {
  const q = `'${rootFolderId}' in parents and name='attendance.json' and trashed=false`;
  const url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(q)
    + '&fields=' + encodeURIComponent('files(id,modifiedTime)')
    + '&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives';
  const res = await driveFetch(url, accessToken);
  const json = await res.json();
  const files = Array.isArray(json.files) ? json.files : [];
  if (!files.length) return null;
  // 取 modifiedTime 最新一筆（理論上 root 下不該有同名多檔，但比照 vdrive resolvePathToId 的
  // 「同名取最新」慣例以防萬一）。
  files.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  return files[0];
}

async function downloadJson(fileId, accessToken) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true';
  const res = await driveFetch(url, accessToken);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    throw new Error('Drive 版 attendance.json 內容不是合法 JSON');
  }
  return data;
}

// ── 主流程 ───────────────────────────────────────────────────────────
async function main() {
  const credsPath = config.DRIVE_SYNC_CREDS;
  if (!credsPath) {
    console.error('[pull-attendance] 缺少環境變數 DRIVE_SYNC_CREDS（請於 server/.env 設定，指向唯讀 OAuth 憑證 JSON 檔路徑）');
    process.exit(1);
    return;
  }

  let creds;
  try {
    creds = loadCreds(credsPath);
  } catch (e) {
    console.error('[pull-attendance] ' + e.message);
    process.exit(1);
    return;
  }

  let accessToken;
  try {
    accessToken = await tokenFromRefresh(creds, creds.refresh_token);
  } catch (e) {
    console.error('[pull-attendance] 換取 access token 失敗：' + e.message);
    process.exit(1);
    return;
  }

  let file;
  try {
    file = await findAttendanceFile(config.ROOT_FOLDER_ID, accessToken);
  } catch (e) {
    console.error('[pull-attendance] 查詢 Drive 檔案失敗：' + e.message);
    process.exit(1);
    return;
  }

  if (!file) {
    console.log('[pull-attendance] Drive 尚無 attendance.json，略過本次拉取。');
    process.exit(0);
    return;
  }

  let driveData;
  try {
    driveData = await downloadJson(file.id, accessToken);
  } catch (e) {
    console.error('[pull-attendance] 下載 Drive 版 attendance.json 失敗：' + e.message);
    process.exit(1);
    return;
  }

  if (!driveData || typeof driveData !== 'object' || !Array.isArray(driveData.records)) {
    console.error('[pull-attendance] Drive 版 attendance.json 內容異常（records 非陣列），已中止、不寫入。');
    process.exit(1);
    return;
  }
  const driveRecords = driveData.records;

  let db;
  try {
    db = openDb(config.DB_PATH);
  } catch (e) {
    console.error('[pull-attendance] 開啟本地資料庫失敗：' + e.message);
    process.exit(1);
    return;
  }

  const ctx = { root: config.ROOT_FOLDER_ID };
  let added = 0;
  let skippedNoId = 0;
  let localTotal = 0;

  try {
    const run = db.transaction(() => {
      let localData = null;
      try {
        localData = vdrive.readJson(db, ATTENDANCE_PATH, ctx).data;
      } catch (_notFound) {
        localData = null; // 本地尚無此檔，視為空紀錄集
      }

      const result = mergeAttendance(localData, driveRecords);
      added = result.added;
      skippedNoId = result.skippedNoId;
      localTotal = result.merged.records.length;

      if (added > 0) {
        vdrive.updateJson(db, ATTENDANCE_PATH, result.merged, ctx);
      }
    });
    run();
  } catch (e) {
    console.error('[pull-attendance] 合併/寫入本地資料庫失敗：' + e.message);
    process.exit(1);
    return;
  }

  if (added === 0) {
    console.log(`[pull-attendance] 無新紀錄。Drive ${driveRecords.length} 筆／新增 0 筆／跳過(無id) ${skippedNoId} 筆／本地共 ${localTotal} 筆`);
  } else {
    console.log(`[pull-attendance] 拉取完成。Drive ${driveRecords.length} 筆／新增 ${added} 筆／跳過(無id) ${skippedNoId} 筆／本地共 ${localTotal} 筆`);
  }
  process.exit(0);
}

module.exports = { mergeAttendance };

if (require.main === module) {
  main().catch((e) => {
    console.error('[pull-attendance] 未預期錯誤：' + e.message);
    process.exit(1);
  });
}
