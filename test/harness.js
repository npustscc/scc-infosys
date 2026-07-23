// 測試載入器：從 dev/ 底下的原始碼檔案（見 SRC_FILES）就地抽出指定的純函式，在隔離的
// vm context 中執行。完全不修改來源檔 —— 測試檔讀的是同一份正式碼，改壞邏輯測試就會紅燈。
//
// 用法：
//   const { load } = require('./harness');
//   const S = load(['openDateToSemPrefix', 'semesterLabel'], { casesData: [] });
//   S.openDateToSemPrefix('2026-06-15');  // 呼叫抽出的函式
//
// 限制：以「跳過字串/註解的括號配對」抽出函式主體，適用本專案這類無 DOM 依賴的純函式；
// 若函式字串字面量內含不成對的大括號（本專案目前沒有），需改用更完整的解析器。
//
// v249：純函式工具區絞殺者拆檔起，部分純函式（如 escHtml／semesterLabel／_bkSeriesReplan 等）
// 已搬到 dev/utils.js。
// v250：新生心理測驗純函式層（_ft* 系列）再拆到 dev/ft-core.js。SRC_FILES 改為可維護的陣列，
// 依實際 <script> 載入順序串接（utils.js → ft-core.js → index.html），讓既有測試不論函式
// 目前落在哪個檔案都抽得到，呼叫端無需改動；未來再拆檔只需在陣列中新增一筆。
// v251：個案詳細頁區塊＋合併/遷移引擎（_buildMergePlan／_mergeCaseGroup 等）再拆到
// dev/case-detail.js，插入 ft-core.js 與 index.html 之間（符合實際 <script> 載入順序）。
// v252：個案資料表單匯入區塊（confirmClearAllCases／batchImportServiceTables／
// importCasesFromExcel／showImportReviewModal／finalizeImport 等）再拆到 dev/case-import.js，
// 插入 case-detail.js 與 index.html 之間（符合實際 <script> 載入順序）。
// v253：初次晤談模組（_iiChipData 系列／openInitialInterviewPage／saveInitialInterview／
// printInitialInterview 等）再拆到 dev/initial-interview.js，插入 case-import.js 與 index.html
// 之間（符合實際 <script> 載入順序）。
// v254：心理測驗匯入與批次清理模組（handleImportPsychCSV／importPsychTestFromExcel／
// renderRecycleBin／searchTransferRefill 等）再拆到 dev/psych-import.js，插入
// initial-interview.js 與 index.html 之間（符合實際 <script> 載入順序）。
// v255：畢業/離校生評估模組（_gradFilterChange／setGradTransferDecision／renderTransferPage／
// _renderWithdrawTab 等）再拆到 dev/grad-eval.js，插入 psych-import.js 與 index.html 之間
// （符合實際 <script> 載入順序）。
// v256：結案評估模組（openClosureEvalPage／saveClosureEval／_clReasonRender／reopenCase 等）
// 再拆到 dev/closure-eval.js，插入 grad-eval.js 與 index.html 之間（符合實際 <script> 載入順序）。
// v257：待辦分類純函式＋事件處理記錄表模組（_todoCategoryOf／_todoCategoryCounts／
// renderEventRecordsPage／saveEventRecords 等）再拆到 dev/event-records.js，插入 closure-eval.js
// 與 index.html 之間（符合實際 <script> 載入順序）。
// v258：草稿引擎＋雲端備援＋待派案 todo 模組（_parseDraftKeyType／_isDraftSnapshotDirty／
// _cloudDraftDiff／_renderAssignmentTodos 等）再拆到 dev/draft-engine.js，插入 event-records.js
// 與 index.html 之間（符合實際 <script> 載入順序）。
// v259：晤談紀錄表單模組（openNewRecordPage／saveRecord／snapshotRecordDraft／
// restoreRecordDraft／_collectServiceItems 等）再拆到 dev/record-form.js，插入 draft-engine.js
// 與 index.html 之間（符合實際 <script> 載入順序）。
// v260：身心調適假渲染段（_mlaRenderPageBody／openMlAssessmentModal／saveMlAssessment／
// printMlAssessment／_mlRenderRecordsTab 等）再拆到 dev/mental-leave.js，插入 record-form.js
// 與 index.html 之間（符合實際 <script> 載入順序）。
// v261：信箱（openmail）模組（openOmCompose／omSendSubmit／_omsvRenderFolderTree 等）改用
// 「inline script 區塊原地外部化」拆到 dev/openmail.js——原本就是 index.html 尾端一段獨立
// <script>，位置排在 index.html 之後、其他尾端區塊（sms 等）之前；此處加進 SRC_FILES 只是
// 為了讓 harness 抽得到函式，前後順序不影響測試結果（純函式抽取無關實際載入序）。
// v262：新生心理測驗 UI 模組（_ftEnterEdit／_ftSaveEdit／_ftLoadStatsView 等）同樣改用
// 「inline script 區塊原地外部化」拆到 dev/ft-ui.js——原本是 index.html 尾端另一段獨立
// <script>，位置排在 openmail.js 之後；同上理由插入 SRC_FILES 只為讓 harness 抽得到函式。
// v263：簡訊發送模組（_smsIsGsmMessage／_smsSegmentInfo／_smsValidatePhone 等）與問題回報/
// 許願池模組（_issueDraftKey／submitIssue／_parseIssueMentions 等）同樣改用「inline script
// 區塊原地外部化」，一版拆兩塊：分別拆到 dev/sms.js（原本排在 openmail.js 之後、ft-ui.js 之前）
// 與 dev/issues-ui.js（原本排在 ft-ui.js 之後）；同上理由插入 SRC_FILES 只為讓 harness 抽得到
// 函式，前後順序不影響測試結果。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_FILES = [
  path.join(__dirname, '..', 'dev', 'utils.js'),
  path.join(__dirname, '..', 'dev', 'ft-core.js'),
  path.join(__dirname, '..', 'dev', 'case-detail.js'),
  path.join(__dirname, '..', 'dev', 'case-import.js'),
  path.join(__dirname, '..', 'dev', 'initial-interview.js'),
  path.join(__dirname, '..', 'dev', 'psych-import.js'),
  path.join(__dirname, '..', 'dev', 'grad-eval.js'),
  path.join(__dirname, '..', 'dev', 'closure-eval.js'),
  path.join(__dirname, '..', 'dev', 'event-records.js'),
  path.join(__dirname, '..', 'dev', 'draft-engine.js'),
  path.join(__dirname, '..', 'dev', 'record-form.js'),
  path.join(__dirname, '..', 'dev', 'mental-leave.js'),
  // v266/v267：家系圖模組與空間預約模組再拆到 dev/genogram.js、dev/booking.js（刀法①，
  // 排在主 inline script 之前載入）；插入 SRC_FILES 讓 harness 抽得到函式。
  path.join(__dirname, '..', 'dev', 'genogram.js'),
  path.join(__dirname, '..', 'dev', 'booking.js'),
  path.join(__dirname, '..', 'dev', 'attendance.js'),
  path.join(__dirname, '..', 'dev', 'transfer.js'),
  path.join(__dirname, '..', 'dev', 'psychiatrist-eval.js'),
  path.join(__dirname, '..', 'dev', 'attachments.js'),
  path.join(__dirname, '..', 'dev', 'ml-mgmt.js'),
  path.join(__dirname, '..', 'dev', 'notifications.js'),
  path.join(__dirname, '..', 'dev', 'admin-users.js'),
  path.join(__dirname, '..', 'dev', 'case-mgmt.js'),
  path.join(__dirname, '..', 'dev', 'pin-lock.js'),
  path.join(__dirname, '..', 'dev', 'import-export.js'),
  path.join(__dirname, '..', 'dev', 'ui-helpers.js'),
  path.join(__dirname, '..', 'dev', 'filter-panel.js'),
  path.join(__dirname, '..', 'dev', 'todos.js'),
  path.join(__dirname, '..', 'dev', 'index.html'),
  path.join(__dirname, '..', 'dev', 'openmail.js'),
  path.join(__dirname, '..', 'dev', 'sms.js'),
  path.join(__dirname, '..', 'dev', 'ft-ui.js'),
  path.join(__dirname, '..', 'dev', 'issues-ui.js'),
  path.join(__dirname, '..', 'dev', 'tooltip.js'),
  path.join(__dirname, '..', 'dev', 'qrcode-lib.js'),
];

function readHtml() {
  return SRC_FILES.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}

// 從 src 中，以 openBraceIdx（指向 '{'）為起點，做「字串/註解感知」的括號配對，回傳結束 '}' 的索引。
function matchBrace(src, openBraceIdx) {
  let depth = 0;
  let i = openBraceIdx;
  let str = null;      // 目前所在的字串引號字元（' " `），null = 不在字串內
  let lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (str) {
      if (c === '\\') { i++; continue; }         // 跳過跳脫字元
      if (c === str) str = null;                 // 字串結束（含反引號整段跳過，含其 ${} 內大括號）
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('matchBrace: 找不到對應的結束大括號');
}

// 抽出名為 name 的頂層函式宣告原始碼字串。
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函式：' + name);
  const braceIdx = src.indexOf('{', m.index);
  if (braceIdx === -1) throw new Error('函式無主體：' + name);
  const endIdx = matchBrace(src, braceIdx);
  return src.slice(m.index, endIdx + 1);
}

// 載入一組函式到共用 sandbox。extraGlobals 提供被依賴的全域（常數、資料、被 stub 的 helper 等）。
// 回傳 sandbox 物件：抽出的函式與 extraGlobals 都掛在上面，測試中可讀寫（例如覆寫 casesData）。
function load(names, extraGlobals = {}) {
  const src = readHtml();
  const sandbox = Object.assign({
    Date, Math, Number, String, Boolean, parseInt, parseFloat, isNaN,
    RegExp, Array, Object, JSON, Set, Map, console,
  }, extraGlobals);
  vm.createContext(sandbox);
  const code = names.map((n) => extractFunction(src, n)).join('\n\n');
  vm.runInContext(code, sandbox);
  return sandbox;
}

// 產生「無參數 new Date() 固定為 isoOrMs」的 Date 子類，供測試日期相依函式（如 currentSemesterPrefix）。
function makeFixedDate(fixed) {
  const RealDate = Date;
  const FixedDate = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return new RealDate(fixed).getTime(); }
  };
  return FixedDate;
}

module.exports = { load, extractFunction, matchBrace, makeFixedDate, readHtml, HTML_PATH: SRC_FILES[SRC_FILES.length - 1] };
