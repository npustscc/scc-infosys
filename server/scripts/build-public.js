#!/usr/bin/env node
// server/scripts/build-public.js — 把前端 index.html 複製到 server/public/index.html，
// 置換環境常數。比對模式沿用 scripts/check-env-constants.mjs 的 regex 手法，只鎖定目標行避免誤改。
//
// 用法：
//   node scripts/build-public.js [目標 URL]              （來源 dev/index.html，只換 APPS_SCRIPT_URL）
//   node scripts/build-public.js --prod [目標 URL]        （來源 repo 根 index.html，只換 APPS_SCRIPT_URL）
//   node scripts/build-public.js --prod-from-dev [目標 URL]（來源 dev/index.html，換 APPS_SCRIPT_URL
//                                                          ＋DRIVE_FOLDER_ID dev→prod，共 2 行）
// 目標 URL 預設 http://localhost:<PORT>/exec（取自 .env）。
//
// --prod-from-dev 的動機（cutover 起的常態模式）：切換後 GitHub Pages 的根 index.html 改為遷移
// 公告頁，不再是可用的前端來源；prod 前端必須從 dev/index.html 建置（那裡才有本地登入等新程式碼），
// 但 dev 的 DRIVE_FOLDER_ID 必須換成 prod 值，否則對打 Node 後端會全面 Unauthorized rootFolderId
// （2026-07-03 事故同型）。兩個資料夾 ID 為固定基礎設施常數（同 CLAUDE.md 環境表），寫死於此，
// 若未來變動需同步修改。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

const DEV_DRIVE_FOLDER_ID = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';
const PROD_DRIVE_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';

const mode = process.argv[2] === '--prod' ? 'prod'
  : process.argv[2] === '--prod-from-dev' ? 'prod-from-dev'
  : 'dev';
const urlArg = mode === 'dev' ? process.argv[2] : process.argv[3];

const SRC_HTML = mode === 'prod'
  ? path.join(__dirname, '..', '..', 'index.html')
  : path.join(__dirname, '..', '..', 'dev', 'index.html');
const OUT_DIR = path.join(__dirname, '..', 'public');
const OUT_HTML = path.join(OUT_DIR, 'index.html');

function main() {
  const targetUrl = urlArg || `http://localhost:${config.PORT}/exec`;
  if (!fs.existsSync(SRC_HTML)) {
    console.error(`找不到 ${SRC_HTML}`);
    process.exit(1);
  }
  const html = fs.readFileSync(SRC_HTML, 'utf8');

  const RE_URL = /^const APPS_SCRIPT_URL = '([^']*)';$/m;
  const mUrl = RE_URL.exec(html);
  if (!mUrl) {
    console.error(`找不到 APPS_SCRIPT_URL 常數，${path.basename(SRC_HTML)} 結構可能已改變——請確認後手動調整本腳本的 regex。`);
    process.exit(1);
  }
  let patched = html.replace(RE_URL, `const APPS_SCRIPT_URL = '${targetUrl}';`);

  let expectedDiff = 1;
  let folderMsg = 'DRIVE_FOLDER_ID 未變動';
  if (mode === 'prod-from-dev') {
    // 注意：dev/index.html 該行帶行尾註解（// 測試版資料夾），regex 不可用 ;$ 錨定行尾；
    // 置換時連註解一併改掉，避免 prod 建置產物裡殘留「測試版」字樣誤導。
    const RE_FOLDER = /^const DRIVE_FOLDER_ID = '([^']*)';[^\n]*$/m;
    const mFolder = RE_FOLDER.exec(patched);
    if (!mFolder) {
      console.error('找不到 DRIVE_FOLDER_ID 常數——請確認後手動調整本腳本的 regex。');
      process.exit(1);
    }
    if (mFolder[1] !== DEV_DRIVE_FOLDER_ID) {
      console.error(`來源 DRIVE_FOLDER_ID（${mFolder[1]}）不是預期的 dev 值——來源檔可能已被改動，已中止。`);
      process.exit(1);
    }
    patched = patched.replace(RE_FOLDER, `const DRIVE_FOLDER_ID = '${PROD_DRIVE_FOLDER_ID}'; // 正式版資料夾（build-public --prod-from-dev 置換）`);
    expectedDiff = 2;
    folderMsg = `DRIVE_FOLDER_ID：${DEV_DRIVE_FOLDER_ID} → ${PROD_DRIVE_FOLDER_ID}`;
  }

  // 機械驗證：變動行數必須恰為預期（1 或 2），其餘逐字元相同（避免 regex 誤傷其他內容）。
  const before = html.split('\n');
  const after = patched.split('\n');
  const diffLines = before.map((l, i) => (l !== after[i] ? i : -1)).filter((i) => i !== -1);
  if (diffLines.length !== expectedDiff) {
    console.error(`預期只有 ${expectedDiff} 行變動，實際變動 ${diffLines.length} 行——已中止寫入，請檢查。`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, patched, 'utf8');

  console.log(`已產生 ${OUT_HTML}（模式：${mode}）`);
  console.log(`APPS_SCRIPT_URL：${mUrl[1]} → ${targetUrl}`);
  console.log(folderMsg + '。');
}

main();
