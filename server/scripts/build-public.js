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
const crypto = require('node:crypto');
const config = require('../src/config');

const DEV_DRIVE_FOLDER_ID = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';
const PROD_DRIVE_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';

// 絞殺者拆檔系列（v243~）自 dev/ 原樣複製到 public/ 的檔案清單，順序即 buildId 雜湊順序
// （index.html patched 內容永遠排第一）。任一檔變動都要能觸發前端強制重整（v242 機制），
// 所以新增拆出檔時在此加一行即可——雜湊、存在性檢查、複製、輸出訊息都會自動涵蓋。
// 各檔的拆出沿革見 git log（v243 changelog / v244 styles / v245 hints / v249~v264 十六連刀 /
// v266 genogram / v267 booking / …）。
const EXTRA_FILES = [
  'changelog.js',
  'styles.css',
  'hints.js',
  'utils.js',
  'ft-core.js',
  'case-detail.js',
  'case-import.js',
  'initial-interview.js',
  'psych-import.js',
  'grad-eval.js',
  'closure-eval.js',
  'event-records.js',
  'draft-engine.js',
  'record-form.js',
  'mental-leave.js',
  'genogram.js',
  'booking.js',
  'openmail.js',
  'ft-ui.js',
  'sms.js',
  'issues-ui.js',
  'tooltip.js',
  'qrcode-lib.js',
];

const mode = process.argv[2] === '--prod' ? 'prod'
  : process.argv[2] === '--prod-from-dev' ? 'prod-from-dev'
  : 'dev';
const urlArg = mode === 'dev' ? process.argv[2] : process.argv[3];

const SRC_HTML = mode === 'prod'
  ? path.join(__dirname, '..', '..', 'index.html')
  : path.join(__dirname, '..', '..', 'dev', 'index.html');
const DEV_DIR = path.join(__dirname, '..', '..', 'dev');
const OUT_DIR = path.join(__dirname, '..', 'public');
const OUT_HTML = path.join(OUT_DIR, 'index.html');

function main() {
  const targetUrl = urlArg || `http://localhost:${config.PORT}/exec`;
  if (!fs.existsSync(SRC_HTML)) {
    console.error(`找不到 ${SRC_HTML}`);
    process.exit(1);
  }
  for (const f of EXTRA_FILES) {
    if (!fs.existsSync(path.join(DEV_DIR, f))) {
      console.error(`找不到 ${path.join(DEV_DIR, f)}`);
      process.exit(1);
    }
  }
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const extras = EXTRA_FILES.map((f) => ({ name: f, content: fs.readFileSync(path.join(DEV_DIR, f), 'utf8') }));

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
  for (const e of extras) fs.writeFileSync(path.join(OUT_DIR, e.name), e.content, 'utf8'); // 原樣複製，無需置換常數

  // v242：強制重新整理機制——寫出 version.json 供前端 checkForUpdate() 輪詢比對。buildId 用
  // patched 後 html＋所有拆出檔內容的 sha256 前 16 碼（內容雜湊，不用時間戳／build 序號）：
  // 「只改 server/ 沒改前端」的 deploy 雜湊不變，不會逼使用中分頁平白被強制重整；任一前端
  // 檔案真的變動時 buildId 才會變，觸發前端偵測到新版並倒數重整（見 dev/index.html
  // checkForUpdate/_forceUpdateReload）。
  const hash = crypto.createHash('sha256').update(patched, 'utf8');
  for (const e of extras) hash.update(e.content, 'utf8');
  const buildId = hash.digest('hex').slice(0, 16);
  const versionJson = { buildId, mode, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT_DIR, 'version.json'), JSON.stringify(versionJson, null, 2), 'utf8');

  console.log(`已產生 ${OUT_HTML}（模式：${mode}）`);
  for (const e of extras) console.log(`已複製 ${path.join(OUT_DIR, e.name)}`);
  console.log(`APPS_SCRIPT_URL：${mUrl[1]} → ${targetUrl}`);
  console.log(folderMsg + '。');
  console.log(`version.json buildId：${buildId}`);
}

main();
