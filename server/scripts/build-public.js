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

const mode = process.argv[2] === '--prod' ? 'prod'
  : process.argv[2] === '--prod-from-dev' ? 'prod-from-dev'
  : 'dev';
const urlArg = mode === 'dev' ? process.argv[2] : process.argv[3];

const SRC_HTML = mode === 'prod'
  ? path.join(__dirname, '..', '..', 'index.html')
  : path.join(__dirname, '..', '..', 'dev', 'index.html');
// v243：更新紀錄資料拆到獨立檔案，唯一來源固定為 dev/changelog.js（三種模式共用，
// 因為只有 dev/index.html 已改成讀 window.CHANGELOG_ENTRIES；root index.html 仍是舊版
// legacy Pages 公告頁建置來源，多複製這檔不影響它）。
const SRC_CHANGELOG = path.join(__dirname, '..', '..', 'dev', 'changelog.js');
// v244：主樣式表拆到獨立檔案，同 SRC_CHANGELOG 理由——唯一來源固定為 dev/styles.css，
// 三種建置模式共用（root index.html 是舊版 legacy Pages 公告頁來源，不受影響）。
const SRC_STYLES = path.join(__dirname, '..', '..', 'dev', 'styles.css');
// v245：小技巧輪播模組拆到獨立檔案，同上理由——唯一來源固定為 dev/hints.js。
const SRC_HINTS = path.join(__dirname, '..', '..', 'dev', 'hints.js');
// v249：純函式工具區拆到獨立檔案，同上理由——唯一來源固定為 dev/utils.js。
const SRC_UTILS = path.join(__dirname, '..', '..', 'dev', 'utils.js');
// v250：新生心理測驗純函式層拆到獨立檔案，同上理由——唯一來源固定為 dev/ft-core.js。
const SRC_FT_CORE = path.join(__dirname, '..', '..', 'dev', 'ft-core.js');
// v251：個案詳細頁區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/case-detail.js。
const SRC_CASE_DETAIL = path.join(__dirname, '..', '..', 'dev', 'case-detail.js');
// v252：個案資料表單匯入區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/case-import.js。
const SRC_CASE_IMPORT = path.join(__dirname, '..', '..', 'dev', 'case-import.js');
// v253：初次晤談模組拆到獨立檔案，同上理由——唯一來源固定為 dev/initial-interview.js。
const SRC_INITIAL_INTERVIEW = path.join(__dirname, '..', '..', 'dev', 'initial-interview.js');
// v254：心理測驗匯入區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/psych-import.js。
const SRC_PSYCH_IMPORT = path.join(__dirname, '..', '..', 'dev', 'psych-import.js');
// v255：畢業/離校生評估區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/grad-eval.js。
const SRC_GRAD_EVAL = path.join(__dirname, '..', '..', 'dev', 'grad-eval.js');
// v256：結案評估區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/closure-eval.js。
const SRC_CLOSURE_EVAL = path.join(__dirname, '..', '..', 'dev', 'closure-eval.js');
// v257：待辦分類＋事件處理記錄表區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/event-records.js。
const SRC_EVENT_RECORDS = path.join(__dirname, '..', '..', 'dev', 'event-records.js');
// v258：草稿引擎＋雲端備援＋待派案 todo 區塊拆到獨立檔案，同上理由——唯一來源固定為 dev/draft-engine.js。
const SRC_DRAFT_ENGINE = path.join(__dirname, '..', '..', 'dev', 'draft-engine.js');
// v259：晤談紀錄表單模組拆到獨立檔案，同上理由——唯一來源固定為 dev/record-form.js。
const SRC_RECORD_FORM = path.join(__dirname, '..', '..', 'dev', 'record-form.js');
// v260：身心調適假渲染段拆到獨立檔案，同上理由——唯一來源固定為 dev/mental-leave.js。
const SRC_MENTAL_LEAVE = path.join(__dirname, '..', '..', 'dev', 'mental-leave.js');
// v261：openmail 信箱模組（原地外部化，inline script 區塊原樣搬出）拆到獨立檔案，
// 同上理由——唯一來源固定為 dev/openmail.js。
const SRC_OPENMAIL = path.join(__dirname, '..', '..', 'dev', 'openmail.js');
// v262：新生心理測驗 UI 模組（原地外部化，inline script 區塊原樣搬出）拆到獨立檔案，
// 同上理由——唯一來源固定為 dev/ft-ui.js。
const SRC_FT_UI = path.join(__dirname, '..', '..', 'dev', 'ft-ui.js');
const OUT_DIR = path.join(__dirname, '..', 'public');
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const OUT_CHANGELOG = path.join(OUT_DIR, 'changelog.js');
const OUT_STYLES = path.join(OUT_DIR, 'styles.css');
const OUT_HINTS = path.join(OUT_DIR, 'hints.js');
const OUT_UTILS = path.join(OUT_DIR, 'utils.js');
const OUT_FT_CORE = path.join(OUT_DIR, 'ft-core.js');
const OUT_CASE_DETAIL = path.join(OUT_DIR, 'case-detail.js');
const OUT_CASE_IMPORT = path.join(OUT_DIR, 'case-import.js');
const OUT_INITIAL_INTERVIEW = path.join(OUT_DIR, 'initial-interview.js');
const OUT_PSYCH_IMPORT = path.join(OUT_DIR, 'psych-import.js');
const OUT_GRAD_EVAL = path.join(OUT_DIR, 'grad-eval.js');
const OUT_CLOSURE_EVAL = path.join(OUT_DIR, 'closure-eval.js');
const OUT_EVENT_RECORDS = path.join(OUT_DIR, 'event-records.js');
const OUT_DRAFT_ENGINE = path.join(OUT_DIR, 'draft-engine.js');
const OUT_RECORD_FORM = path.join(OUT_DIR, 'record-form.js');
const OUT_MENTAL_LEAVE = path.join(OUT_DIR, 'mental-leave.js');
const OUT_OPENMAIL = path.join(OUT_DIR, 'openmail.js');
const OUT_FT_UI = path.join(OUT_DIR, 'ft-ui.js');

function main() {
  const targetUrl = urlArg || `http://localhost:${config.PORT}/exec`;
  if (!fs.existsSync(SRC_HTML)) {
    console.error(`找不到 ${SRC_HTML}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_CHANGELOG)) {
    console.error(`找不到 ${SRC_CHANGELOG}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_STYLES)) {
    console.error(`找不到 ${SRC_STYLES}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_HINTS)) {
    console.error(`找不到 ${SRC_HINTS}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_UTILS)) {
    console.error(`找不到 ${SRC_UTILS}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_FT_CORE)) {
    console.error(`找不到 ${SRC_FT_CORE}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_CASE_DETAIL)) {
    console.error(`找不到 ${SRC_CASE_DETAIL}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_CASE_IMPORT)) {
    console.error(`找不到 ${SRC_CASE_IMPORT}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_INITIAL_INTERVIEW)) {
    console.error(`找不到 ${SRC_INITIAL_INTERVIEW}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_PSYCH_IMPORT)) {
    console.error(`找不到 ${SRC_PSYCH_IMPORT}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_GRAD_EVAL)) {
    console.error(`找不到 ${SRC_GRAD_EVAL}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_CLOSURE_EVAL)) {
    console.error(`找不到 ${SRC_CLOSURE_EVAL}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_EVENT_RECORDS)) {
    console.error(`找不到 ${SRC_EVENT_RECORDS}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_DRAFT_ENGINE)) {
    console.error(`找不到 ${SRC_DRAFT_ENGINE}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_RECORD_FORM)) {
    console.error(`找不到 ${SRC_RECORD_FORM}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_MENTAL_LEAVE)) {
    console.error(`找不到 ${SRC_MENTAL_LEAVE}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_OPENMAIL)) {
    console.error(`找不到 ${SRC_OPENMAIL}`);
    process.exit(1);
  }
  if (!fs.existsSync(SRC_FT_UI)) {
    console.error(`找不到 ${SRC_FT_UI}`);
    process.exit(1);
  }
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const changelogJs = fs.readFileSync(SRC_CHANGELOG, 'utf8');
  const stylesCss = fs.readFileSync(SRC_STYLES, 'utf8');
  const hintsJs = fs.readFileSync(SRC_HINTS, 'utf8');
  const utilsJs = fs.readFileSync(SRC_UTILS, 'utf8');
  const ftCoreJs = fs.readFileSync(SRC_FT_CORE, 'utf8');
  const caseDetailJs = fs.readFileSync(SRC_CASE_DETAIL, 'utf8');
  const caseImportJs = fs.readFileSync(SRC_CASE_IMPORT, 'utf8');
  const initialInterviewJs = fs.readFileSync(SRC_INITIAL_INTERVIEW, 'utf8');
  const psychImportJs = fs.readFileSync(SRC_PSYCH_IMPORT, 'utf8');
  const gradEvalJs = fs.readFileSync(SRC_GRAD_EVAL, 'utf8');
  const closureEvalJs = fs.readFileSync(SRC_CLOSURE_EVAL, 'utf8');
  const eventRecordsJs = fs.readFileSync(SRC_EVENT_RECORDS, 'utf8');
  const draftEngineJs = fs.readFileSync(SRC_DRAFT_ENGINE, 'utf8');
  const recordFormJs = fs.readFileSync(SRC_RECORD_FORM, 'utf8');
  const mentalLeaveJs = fs.readFileSync(SRC_MENTAL_LEAVE, 'utf8');
  const openmailJs = fs.readFileSync(SRC_OPENMAIL, 'utf8');
  const ftUiJs = fs.readFileSync(SRC_FT_UI, 'utf8');

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
  fs.writeFileSync(OUT_CHANGELOG, changelogJs, 'utf8'); // v243：原樣複製，changelog.js 無需置換常數
  fs.writeFileSync(OUT_STYLES, stylesCss, 'utf8'); // v244：原樣複製，styles.css 無需置換常數
  fs.writeFileSync(OUT_HINTS, hintsJs, 'utf8'); // v245：原樣複製，hints.js 無需置換常數
  fs.writeFileSync(OUT_UTILS, utilsJs, 'utf8'); // v249：原樣複製，utils.js 無需置換常數
  fs.writeFileSync(OUT_FT_CORE, ftCoreJs, 'utf8'); // v250：原樣複製，ft-core.js 無需置換常數
  fs.writeFileSync(OUT_CASE_DETAIL, caseDetailJs, 'utf8'); // v251：原樣複製，case-detail.js 無需置換常數
  fs.writeFileSync(OUT_CASE_IMPORT, caseImportJs, 'utf8'); // v252：原樣複製，case-import.js 無需置換常數
  fs.writeFileSync(OUT_INITIAL_INTERVIEW, initialInterviewJs, 'utf8'); // v253：原樣複製，initial-interview.js 無需置換常數
  fs.writeFileSync(OUT_PSYCH_IMPORT, psychImportJs, 'utf8'); // v254：原樣複製，psych-import.js 無需置換常數
  fs.writeFileSync(OUT_GRAD_EVAL, gradEvalJs, 'utf8'); // v255：原樣複製，grad-eval.js 無需置換常數
  fs.writeFileSync(OUT_CLOSURE_EVAL, closureEvalJs, 'utf8'); // v256：原樣複製，closure-eval.js 無需置換常數
  fs.writeFileSync(OUT_EVENT_RECORDS, eventRecordsJs, 'utf8'); // v257：原樣複製，event-records.js 無需置換常數
  fs.writeFileSync(OUT_DRAFT_ENGINE, draftEngineJs, 'utf8'); // v258：原樣複製，draft-engine.js 無需置換常數
  fs.writeFileSync(OUT_RECORD_FORM, recordFormJs, 'utf8'); // v259：原樣複製，record-form.js 無需置換常數
  fs.writeFileSync(OUT_MENTAL_LEAVE, mentalLeaveJs, 'utf8'); // v260：原樣複製，mental-leave.js 無需置換常數
  fs.writeFileSync(OUT_OPENMAIL, openmailJs, 'utf8'); // v261：原樣複製，openmail.js 無需置換常數
  fs.writeFileSync(OUT_FT_UI, ftUiJs, 'utf8'); // v262：原樣複製，ft-ui.js 無需置換常數

  // v242：強制重新整理機制——寫出 version.json 供前端 checkForUpdate() 輪詢比對。buildId 用
  // patched 後 html 內容的 sha256 前 16 碼（內容雜湊，不用時間戳／build 序號）：這樣「只改
  // server/ 沒改前端」的 deploy（例如純後端 bug 修復）雜湊不變，不會逼所有正在使用的分頁
  // 平白無故被強制重整；只有 dev/index.html 真的變動時 buildId 才會跟著變，觸發前端偵測到
  // 新版並倒數重整（見 dev/index.html checkForUpdate/_forceUpdateReload）。
  // v243：buildId 改納入 changelog.js 內容一併雜湊——拆檔後前端由兩個檔案組成，任一檔變動
  // （例如只改 changelog.js 新增版本條目、沒動 index.html）都要能觸發強制重整，否則使用中
  // 分頁會繼續看到舊的更新紀錄內容而不自知。
  // v244：同理再納入 styles.css——拆檔後前端變成三個檔案，只改樣式表（沒動 index.html／
  // changelog.js）一樣要能觸發強制重整，否則使用中分頁會看到版面跟正式版對不上而不自知。
  // v245：再納入 hints.js——同理，只改小技巧模組也要能觸發強制重整。
  // v249：再納入 utils.js——同理，只改純函式工具區也要能觸發強制重整。
  // v250：再納入 ft-core.js——同理，只改新生心理測驗純函式層也要能觸發強制重整。
  // v251：再納入 case-detail.js——同理，只改個案詳細頁區塊也要能觸發強制重整。
  // v252：再納入 case-import.js——同理，只改個案資料表單匯入區塊也要能觸發強制重整。
  // v253：再納入 initial-interview.js——同理，只改初次晤談模組也要能觸發強制重整。
  // v254：再納入 psych-import.js——同理，只改心理測驗匯入區塊也要能觸發強制重整。
  // v255：再納入 grad-eval.js——同理，只改畢業/離校生評估區塊也要能觸發強制重整。
  // v256：再納入 closure-eval.js——同理，只改結案評估區塊也要能觸發強制重整。
  // v257：再納入 event-records.js——同理，只改待辦分類／事件處理記錄表區塊也要能觸發強制重整。
  // v258：再納入 draft-engine.js——同理，只改草稿引擎／雲端備援／待派案 todo 區塊也要能觸發強制重整。
  // v259：再納入 record-form.js——同理，只改晤談紀錄表單模組也要能觸發強制重整。
  // v260：再納入 mental-leave.js——同理，只改身心調適假渲染段也要能觸發強制重整。
  // v261：再納入 openmail.js——同理，只改信箱模組也要能觸發強制重整。
  // v262：再納入 ft-ui.js——同理，只改新生心理測驗 UI 模組也要能觸發強制重整。
  const buildId = crypto.createHash('sha256').update(patched, 'utf8').update(changelogJs, 'utf8').update(stylesCss, 'utf8').update(hintsJs, 'utf8').update(utilsJs, 'utf8').update(ftCoreJs, 'utf8').update(caseDetailJs, 'utf8').update(caseImportJs, 'utf8').update(initialInterviewJs, 'utf8').update(psychImportJs, 'utf8').update(gradEvalJs, 'utf8').update(closureEvalJs, 'utf8').update(eventRecordsJs, 'utf8').update(draftEngineJs, 'utf8').update(recordFormJs, 'utf8').update(mentalLeaveJs, 'utf8').update(openmailJs, 'utf8').update(ftUiJs, 'utf8').digest('hex').slice(0, 16);
  const versionJson = { buildId, mode, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT_DIR, 'version.json'), JSON.stringify(versionJson, null, 2), 'utf8');

  console.log(`已產生 ${OUT_HTML}（模式：${mode}）`);
  console.log(`已複製 ${OUT_CHANGELOG}`);
  console.log(`已複製 ${OUT_STYLES}`);
  console.log(`已複製 ${OUT_HINTS}`);
  console.log(`已複製 ${OUT_UTILS}`);
  console.log(`已複製 ${OUT_FT_CORE}`);
  console.log(`已複製 ${OUT_CASE_DETAIL}`);
  console.log(`已複製 ${OUT_CASE_IMPORT}`);
  console.log(`已複製 ${OUT_INITIAL_INTERVIEW}`);
  console.log(`已複製 ${OUT_PSYCH_IMPORT}`);
  console.log(`已複製 ${OUT_GRAD_EVAL}`);
  console.log(`已複製 ${OUT_CLOSURE_EVAL}`);
  console.log(`已複製 ${OUT_EVENT_RECORDS}`);
  console.log(`已複製 ${OUT_DRAFT_ENGINE}`);
  console.log(`已複製 ${OUT_RECORD_FORM}`);
  console.log(`已複製 ${OUT_MENTAL_LEAVE}`);
  console.log(`已複製 ${OUT_OPENMAIL}`);
  console.log(`已複製 ${OUT_FT_UI}`);
  console.log(`APPS_SCRIPT_URL：${mUrl[1]} → ${targetUrl}`);
  console.log(folderMsg + '。');
  console.log(`version.json buildId：${buildId}`);
}

main();
