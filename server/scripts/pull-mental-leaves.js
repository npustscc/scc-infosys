#!/usr/bin/env node
// server/scripts/pull-mental-leaves.js — 身心調適假信箱解析拉取器（CLI 進入點，供 systemd timer
// 每 10 分鐘觸發，亦可手動執行）。對映 dev/Code.gs runFetchMentalLeaves/fetchMentalLeaves_
// （L2035-2057）；核心解析/合併邏輯見 src/mail/mentalLeaves.js（本檔與 dispatch 的 fetchMentalLeaves
// action 共用同一支 fetchAndMergeMentalLeaves，不重複實作）。
//
// 設計原則（比照 scripts/pull-attendance.js）：
//   1. 冪等、add-only：以 emailId 去重，只新增本地沒有的信件解析結果，絕不覆寫既有紀錄（含使用者
//      手動編輯過的 handlingStatus/acknowledgedBy/deleted 等欄位，見 mentalLeaves.mergeMentalLeaves）。
//   2. 憑證/token 絕不可外洩：不印到 stdout/stderr、不寫入本地檔案以外的任何地方。
//   3. Gmail 查無新信、單封信解析/貼標失敗都視為正常情況的一部分（記錄筆數、exit 0）；只有
//      「憑證/token/DB 開啟失敗」才視為錯誤（非零 exit，讓 systemd journal 可判定失敗）。
//
// 用法：
//   GMAIL_SYNC_CREDS=/path/to/creds.json ML_GMAIL_LABEL=ml-processed-dev node scripts/pull-mental-leaves.js
// （憑證 JSON 格式：{ client_id, client_secret, refresh_token }，refresh_token 的 scope 需含
//  https://www.googleapis.com/auth/gmail.modify——比 pull-attendance.js 用的 drive.readonly 權限更大，
//  務必是專屬於此用途的憑證，儲存路徑 chmod 600。）
'use strict';

const config = require('../src/config');
const { openDb } = require('../src/db');
const audit = require('../src/audit');
const googleAuth = require('../src/google/auth');
const gmail = require('../src/google/gmail');
const mentalLeaves = require('../src/mail/mentalLeaves');

async function main() {
  const credsPath = config.GMAIL_SYNC_CREDS;
  if (!credsPath) {
    console.error('[pull-mental-leaves] 缺少環境變數 GMAIL_SYNC_CREDS（請於 server/.env 設定，指向 gmail.modify scope 的 OAuth 憑證 JSON 檔路徑）');
    process.exit(1);
    return;
  }

  let creds;
  try {
    creds = googleAuth.loadCreds(credsPath);
  } catch (e) {
    console.error('[pull-mental-leaves] ' + e.message);
    process.exit(1);
    return;
  }

  let accessToken;
  try {
    accessToken = (await googleAuth.tokenFromRefresh(creds, creds.refresh_token)).accessToken;
  } catch (e) {
    console.error('[pull-mental-leaves] 換取 access token 失敗：' + e.message);
    process.exit(1);
    return;
  }

  let db;
  try {
    db = openDb(config.DB_PATH);
  } catch (e) {
    console.error('[pull-mental-leaves] 開啟本地資料庫失敗：' + e.message);
    process.exit(1);
    return;
  }

  const ctx = { root: config.ROOT_FOLDER_ID };
  const labelName = config.ML_GMAIL_LABEL;

  let result;
  try {
    result = await mentalLeaves.fetchAndMergeMentalLeaves(db, ctx, {
      accessToken,
      labelName,
      gmailClient: gmail,
    });
  } catch (e) {
    console.error('[pull-mental-leaves] 擷取/合併失敗：' + e.message);
    process.exit(1);
    return;
  }

  try {
    audit.appendAuditLog(db, {
      email: null,
      action: 'fetchMentalLeaves.cliPull',
      target: labelName,
      outcome: 'ok',
      latencyMs: null,
      detail: `newCount=${result.newCount},totalCount=${result.totalCount},batchCount=${result.batchCount},parseErrors=${result.errors.length},labelErrors=${result.labelErrors.length}`,
    });
  } catch (_e) { /* 稽核寫入失敗不可讓拉取流程失敗 */ }

  console.log(
    `[pull-mental-leaves] 完成。批次 ${result.batchCount} 封／新增 ${result.newCount} 筆／本地共 ${result.totalCount} 筆／`
    + `解析失敗 ${result.errors.length} 筆／貼標失敗 ${result.labelErrors.length} 筆`
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[pull-mental-leaves] 未預期錯誤：' + e.message);
    process.exit(1);
  });
}
