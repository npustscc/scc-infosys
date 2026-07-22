// dev/ft-ui.js — 新生心理測驗 UI 模組（拆 index.html 絞殺者第十六刀，v262）。
// 沿用上一刀（v261 openmail.js）刀法「inline script 區塊原地外部化」：原 index.html 內這一整段
// 獨立的 <script>…</script>（無 src、無 document.currentScript 依賴，已逐行複核確認）被整段
// 原樣搬出，原位置換成 <script src="ft-ui.js"></script>，標籤所在順序完全不變，因此載入與
// 執行時機與搬移前逐位元組一致——本檔頂層狀態與副作用一律照搬：
//   const FT_TAB_SHEET／FT_ROW_H／FT_VWIN_BUFFER／FT_DELETE_COL_W／FT_UNDO_STACK_LIMIT／
//   FT_LAMP_TEXT／FT_SCALE_LABELS／FT_SCALE_DETAIL_ROWS／FT_REPORT_FOOTNOTE／
//   FT_REPORT_PRINT_CSS／FT_REPORT_TABLE_CSS
//   let _ft（新生心理測驗主狀態物件：學期/tab/schema/rows/編輯狀態等）
//   document.addEventListener('paste', …)／document.addEventListener('keydown', _ftHandleUndoRedoKeydown)
//     ——兩處模組級事件委派（貼上鋪列、復原/重做快捷鍵），原本就掛在 document 上、一次註冊，
//     搬到外部檔後仍在同一執行時機（<script src> 標籤位置不變）內註冊一次，行為不變。
// 純函式層（schema/驗證/diff 等）已在 v250 拆到 ft-core.js 並在文件前端以 <script src> 載入；
// 本檔是尾端剩餘的 UI/狀態區塊（grid 渲染、tab/學期切換、匯入匯出、統計報表列印等）。
// 本區塊在 index.html 中的原始位置緊接在簡訊（sms）模組之後、錯誤回報/許願池模組之前，
// 拆出後仍以同一位置的 <script src> 載入，執行順序不受影響。
// ══════════════════════════════════════════════
//  新生心理測驗（v207 Slice 1 學生基本資料 → v208 Slice 2 擴充測驗資料／Google表單＋檢核標紅）
//  ══════════════════════════════════════════════
//  三個「資料 tab」（學生基本資料／測驗資料／Google表單）共用同一份 grid 與工具列程式碼——切換 tab
//  只是把 _ftCurrentSheet() 指向不同的後端 sheet 名稱重新載入（見 FT_TAB_SHEET）。colId 機制：
//  schema.cols 的 id 是穩定 key（前端顯示用 name 可隨意改），列資料 cells 一律以 colId 存值——刪欄
//  只是 schema 拿掉一筆，rows.json 完全不受影響（後端 schema/rows 分檔存放，見
//  server/src/freshmanTest/actions.js 檔頭）。
//  dirty 管理：本頁自管 window._ftDirty（不掛全域 _gd 草稿引擎），showPage／beforeunload／
//  _ftSwitchTab／_ftSwitchSemester 四處攔截，離開前若有未儲存變更一律 confirm() 二次確認
//  （比照既有圖片編輯器 requestClose 的 confirm() 慣例）。
//  v208 效能：測驗資料 146 欄 × ~2000 列，全量 DOM render 不可行——grid 改為「列虛擬化」（只
//  render 可視窗口＋緩衝列，見 _ftComputeVirtualWindow／_ftRenderGrid／_ftRenderGridWindowOnly），
//  欄位用 CSS Grid（grid-template-columns）取代 <table>，讓「只重繪可視窗口」不需要處理
//  <tbody> 的 transform 相容性問題。學號／姓名兩欄用 position:sticky 固定在捲動容器左側
//  （成本可控，見任務規格）。
// v209：導師名冊（tutors）併入資料 tab（可編輯，比照 students/tests/gform）；整合（merged）
// 不在此表——它沒有對應的後端 sheet（唯讀衍生視圖，見 _ftLoadMergedView 另一條載入路徑）。
const FT_TAB_SHEET = { students: 'students', tests: 'tests', gform: 'gforms', tutors: 'tutors' };
const FT_ROW_H = 30;        // px，虛擬化列高（固定值，簡化窗口計算）
const FT_VWIN_BUFFER = 8;   // 可視窗口上下緩衝列數
// v215：凍結欄依分頁而定——導師名冊的主鍵是 class_abbr（無學號/姓名欄），其餘分頁凍結學號/中文
// 姓名。原本三者共用一個全域集合，導致學生基本資料等分頁的「班級簡稱」（第 11 欄）也被凍結，
// 水平捲動時以 1000px 級的 sticky offset 蓋在其他欄位上（看起來像被擠到最後一欄）。
function _ftStickyColIds() {
  return _ft.tab === 'tutors' ? new Set(['class_abbr']) : new Set(['stu_id', 'name_zh']);
}
const FT_DELETE_COL_W = 46; // v213：每列軟刪除鈕欄寬（編輯模式才出現，見 _ftBuildRenderCtx／_ftDeleteCellHtml）
const FT_UNDO_STACK_LIMIT = 100; // v213：交易式復原/重做堆疊上限（見任務規格「不要整表快照」）

let _ft = {
  semesters: [],      // [{id,label,createdAt,createdBy}]
  semester: null,     // 目前選取學期 id
  tab: 'students',    // 'students' | 'tests' | 'gform' | 'tutors' | 'merged' | 'stats' | 'reports'
  schema: null,       // { version, cols:[{id,name,required,locked?,width?}] }
  rows: [],           // 目前畫面上的列（含未儲存編輯），[{_id,_uid,_createdAt,_updatedAt,cells:{colId:value},excluded?,_pendingDelete?}]
  editing: false,
  _focus: null,       // { rowIdx, colIdx, colId, oldValue } 目前聚焦儲存格（貼上起點錨點／v213 也用於偵測儲存格是否有未提交輸入）
  _colmgrDraft: null, // 欄位管理 modal 編輯中的 cols 草稿
  importPreview: null, // 匯入預覽狀態 { detect }
  pendingColWidths: null,
  _vwin: null,        // 目前虛擬化窗口 { startIdx, endIdx, totalHeight, offsetY }
  _renderCtx: null,   // 上次 _ftRenderGrid 算好的渲染上下文（供 _ftRenderGridWindowOnly／欄寬拖曳共用）
  _studentsCache: null,        // 跨 tab 檢核用：學生基本資料 rows 快取（見 _ftLoadStudentsForChecks）
  _studentsCacheSemester: null,
  _gformDupGroupRows: null,   // 「選主條目」modal 開啟時暫存的該組列參照
  _tutorSync: null,   // v209：同步預覽狀態 { diff, incomingRows }，見 _ftTutorSyncStart／_ftConfirmTutorSync
  _mergedUnmatched: [], // v209：整合 tab 上次計算出的「未對應清單」，供彙總列渲染
  // v213：交易式復原/重做（見 _ftPushUndo／_ftUndo／_ftRedo）與列身分（_uid，供交易前後 diff 比對
  // 用——新列存檔前 _id 為 null，不能拿來當身分鍵，見 _ftDiffRowsForTransaction 檔頭說明）。
  _undoStack: [],
  _redoStack: [],
  _uidSeq: 1,
  _importMapping: null, // v213：欄位對照 modal 暫存狀態 { aoa, header, mapping }，見 _ftRenderColumnMappingModal
  _newSemLabelAuto: true, // v213：新增學期 modal 的顯示名稱是否仍為「代碼自動帶入」狀態，見 _ftShowCreateSemesterModal
  // v222：關鍵字篩選／問題列置頂（僅非編輯模式生效，見 _ftComputeDisplayOrder 檔頭風險評估）；
  // 切 tab／切學期／進編輯模式一律清空（見 _ftSwitchTab／_ftSwitchSemester／_ftEnterEdit）。
  filterText: '',
  pinIssuesTop: false,
  // v222：per-(semester,tab) grid 資料快取 { [`${semester}::${tab}`]: {schema, rows} }，見
  // _ftLoadActiveSheet／_ftGetSheetCached。
  _sheetCache: {},
  // v223：目前分頁的評判記憶（tests／gforms 專用，見 _ftBuildJudgedEntries 檔頭說明），隨
  // _ftApplySheetResponseToState／tab 快取一起載入。
  judged: [],
};

// v250：新生心理測驗純函式層拆到 dev/ft-core.js（build 原樣複製）

// ══════════════ v210 Slice 4：統計 tab — 渲染層（DOM，不在 harness 測試範圍）══════════════
// 五個子表共用一個容器 #ft-stats-content；子分頁切換只換渲染函式，資料（_ft._statsMergedRows／
// _ft._statsTutorRows）只在進「統計」tab 時（_ftLoadStatsView）重新計算一次，比照任務規格
// 「進 tab 時計算、資料變更後切回自動反映」——不落地儲存。

function _ftPct(rate) {
  if (rate == null || isNaN(rate)) return '-';
  return (rate * 100).toFixed(1) + '%';
}

// v211：五個統計子表＋報告 tab 共用的 Excel 匯出；匯出資料一律從純函式重新取得，不 scrape
// DOM——DOM 只是顯示層，可能因排版而與原始資料有落差。（v212：改呼叫共用的 _xlsxEnsureLib，
// 保留函式名稱與既有呼叫點相容。）
async function _ftLoadXlsxLib() {
  await _xlsxEnsureLib();
}

async function _ftExportAoaToXlsx(filename, sheetName, aoa) {
  try {
    await _ftLoadXlsxLib();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  } catch (e) {
    showToast('匯出失敗：' + e.message, 'error');
  }
}

async function _ftLoadStatsView() {
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = `<div style="padding:20px;text-align:center;color:#a0aec0;">⏳ 讀取中…</div>`;
  try {
    const [studentsR, testsR, gformsR, tutorsR] = await Promise.all([
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'students' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'tests' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'gforms' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'tutors' }),
    ]);
    const { rows } = _ftComputeMergedRows(_ftFilterDeleted(studentsR.rows), _ftFilterDeleted(testsR.rows), _ftFilterDeleted(gformsR.rows));
    _ft._statsMergedRows = rows;
    _ft._statsTutorRows = _ftFilterDeleted(tutorsR.rows);
    if (!_ft._statsSub) _ft._statsSub = 'highconcern';
    _ftRenderStatsSubTabs();
    _ftRenderStatsSub();
  } catch (e) {
    if (el) el.innerHTML = `<div style="padding:20px;text-align:center;color:#c53030;">讀取失敗：${escHtml(e.message)}</div>`;
  }
}

function _ftRenderStatsSubTabs() {
  const bar = document.getElementById('ft-stats-subtabs');
  if (!bar) return;
  const subs = [
    ['highconcern', '高關懷清冊'], ['invalid', '無效名單'], ['dept', '院系統計'],
    ['edu', '學制統計'], ['topn', '高關懷班級前N'],
  ];
  const cur = _ft._statsSub || 'highconcern';
  bar.innerHTML = subs.map(([id, label]) => `<button type="button" class="bk-page-tabbtn" data-active="${cur === id ? '1' : '0'}" onclick="_ftSwitchStatsSub('${id}')">${escHtml(label)}</button>`).join('');
}

function _ftSwitchStatsSub(sub) {
  _ft._statsSub = sub;
  _ftRenderStatsSubTabs();
  _ftRenderStatsSub();
}

function _ftRenderStatsSub() {
  const sub = _ft._statsSub || 'highconcern';
  if (sub === 'highconcern') _ftRenderStatsHighConcern();
  else if (sub === 'invalid') _ftRenderStatsInvalid();
  else if (sub === 'dept') _ftRenderStatsDept();
  else if (sub === 'edu') _ftRenderStatsEdu();
  else if (sub === 'topn') _ftRenderStatsTopN();
}

function _ftSetHcView(v) {
  _ft._statsHcView = v;
  _ftRenderStatsHighConcern();
}

// v222：可信度分析／綜合分析每列預設收合，只顯示摘要（見 _ftTruncateForCollapse），點「展開」
// 看全文；記錄哪些列（用 stuId 當 key）目前展開，重新渲染沿用。「全部展開/全部收合」直接整組覆寫。
function _ftToggleHcRowExpand(stuId) {
  _ft._statsHcExpandedRows = _ft._statsHcExpandedRows || new Set();
  if (_ft._statsHcExpandedRows.has(stuId)) _ft._statsHcExpandedRows.delete(stuId);
  else _ft._statsHcExpandedRows.add(stuId);
  _ftRenderStatsHighConcern();
}

function _ftSetHcExpandAll(expand) {
  const view = _ft._statsHcView || 'all';
  const rows = _ftHighConcernListRows(_ft._statsMergedRows || [], view);
  _ft._statsHcExpandedRows = expand ? new Set(rows.map(r => r.stuId)) : new Set();
  _ftRenderStatsHighConcern();
}

// 可信度分析／綜合分析欄位的儲存格 HTML：文字不長就原樣顯示；夠長才顯示摘要＋展開/收合鈕。
function _ftHcLongTextCellHtml(text, stuId, expanded) {
  const { isLong, preview } = _ftTruncateForCollapse(text, 40);
  if (!isLong) return escHtml(String(text || ''));
  if (expanded) {
    return `<div>${escHtml(String(text || ''))}</div><button type="button" class="btn btn-secondary btn-sm" style="padding:0 6px;margin-top:2px;" onclick="_ftToggleHcRowExpand('${escHtml(stuId)}')">收合</button>`;
  }
  return `<span style="color:#718096;">${escHtml(preview)}</span> <button type="button" class="btn btn-secondary btn-sm" style="padding:0 6px;" onclick="_ftToggleHcRowExpand('${escHtml(stuId)}')">展開</button>`;
}

function _ftRenderStatsHighConcern() {
  const view = _ft._statsHcView || 'all';
  const rows = _ftHighConcernListRows(_ft._statsMergedRows || [], view);
  const dotHeaders = FT_MERGED_PR_IDS.map(id => id.replace(/pr$/, '').toUpperCase());
  const expandedRows = _ft._statsHcExpandedRows || new Set();
  const viewBtns = [['all', '全部'], ['consent', '同意導師知情（S=v）'], ['noconsent', '不同意（S=x／未填寫）']]
    .map(([v, label]) => `<button type="button" class="btn btn-sm ${view === v ? 'btn-primary' : 'btn-secondary'}" onclick="_ftSetHcView('${v}')">${escHtml(label)}</button>`).join(' ');
  // v222：欄位編號給 _makeTableResizable 用（data-col／colPrefix+n），順序需與下面 <th>／<td> 完全一致。
  const fixedColLabels = ['學號', '姓名', '學院', '系所全名', '班級簡稱', '性別', '測驗結果可信度', '高自殺風險', '高關懷', '是否同意導師知情'];
  const tailColLabels = ['可信度分析', '綜合分析'];
  const totalCols = fixedColLabels.length + dotHeaders.length + tailColLabels.length;
  const colNums = Array.from({ length: totalCols }, (_, i) => i + 1);
  const bodyRows = rows.map(r => {
    const expanded = expandedRows.has(r.stuId);
    return `<tr>
      <td>${escHtml(r.stuId)}</td><td>${escHtml(r.nameZh)}</td><td>${escHtml(r.college)}</td><td>${escHtml(r.deptName)}</td>
      <td>${escHtml(r.classAbbr)}</td><td>${escHtml(r.gender)}</td><td>${escHtml(r.validity)}</td>
      <td>${r.highSuicide === 'v' ? '是' : ''}</td><td>${r.highConcern === 'v' ? '是' : ''}</td>
      <td>${escHtml(r.consentDisplay)}</td>
      ${r.dots.map(d => `<td style="text-align:center;">${escHtml(d.dot)}</td>`).join('')}
      <td>${_ftHcLongTextCellHtml(r.validityAnalysis, r.stuId, expanded)}</td><td>${_ftHcLongTextCellHtml(r.comprehensiveAnalysis, r.stuId, expanded)}</td>
    </tr>`;
  }).join('');
  const colCount = totalCols;
  // v222：表頭改用 <th data-col="n"> 搭配 colgroup 給定初始寬度＋table-layout:fixed，讓標題文字在
  // 欄位不夠寬時自動換行（見全域 CSS th 預設 white-space 就是 normal，只是原本 auto layout 讓欄位
  // 直接撐寬不會真的換行；改 fixed layout 後欄寬受 colgroup 限制，超出即自動換行）；欄寬另外可用
  // _makeTableResizable 拖曳調整（比照案號查詢 cn-col-/危機事件 crisis-col- 既有慣例）。
  const colWidths = [...fixedColLabels.map(() => 90), ...dotHeaders.map(() => 52), 220, 220];
  const colgroupHtml = colNums.map((n, i) => `<col id="ft-hc-col-${n}" style="width:${colWidths[i]}px;">`).join('');
  const html = `
    <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      ${viewBtns}
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftExportStatsHighConcern()">⬇ 匯出 Excel</button>
      <span style="width:1px;height:20px;background:#e2e8f0;"></span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftSetHcExpandAll(true)">全部展開</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftSetHcExpandAll(false)">全部收合</button>
      <span style="margin-left:auto;color:#718096;font-size:.84rem;">共 <strong>${rows.length}</strong> 人</span>
    </div>
    <div id="ft-hc-topscroll" style="overflow-x:auto;overflow-y:hidden;height:14px;border:1px solid #e2e8f0;border-bottom:none;border-radius:8px 8px 0 0;background:#f7fafc;"><div id="ft-hc-topscroll-spacer" style="height:1px;"></div></div>
    <div id="ft-hc-table-wrap" style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
      <table id="ft-hc-table" style="min-width:1600px;table-layout:fixed;">
        <colgroup>${colgroupHtml}</colgroup>
        <thead><tr>
          ${fixedColLabels.map((h, i) => `<th data-col="${i + 1}" style="white-space:normal;word-break:break-word;">${escHtml(h)}</th>`).join('')}
          ${dotHeaders.map((h, i) => `<th data-col="${fixedColLabels.length + i + 1}" style="text-align:center;white-space:normal;">${escHtml(h)}</th>`).join('')}
          ${tailColLabels.map((h, i) => `<th data-col="${fixedColLabels.length + dotHeaders.length + i + 1}" style="white-space:normal;word-break:break-word;">${escHtml(h)}</th>`).join('')}
        </tr></thead>
        <tbody>${bodyRows || `<tr><td colspan="${colCount}" style="text-align:center;color:#a0aec0;">無資料</td></tr>`}</tbody>
      </table>
    </div>`;
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = html;
  _makeTableResizable({ table: document.getElementById('ft-hc-table'), colPrefix: 'ft-hc-col-', colNums, prefKey: 'ftHcColWidths' });
  const table = document.getElementById('ft-hc-table');
  const tableWidth = table ? Math.max(table.offsetWidth, 1600) : 1600;
  _ftInitTopScrollbar(document.getElementById('ft-hc-topscroll'), document.getElementById('ft-hc-topscroll-spacer'), document.getElementById('ft-hc-table-wrap'), tableWidth);
}

function _ftExportStatsHighConcern() {
  const view = _ft._statsHcView || 'all';
  const rows = _ftHighConcernListRows(_ft._statsMergedRows || [], view);
  const dotHeaders = FT_MERGED_PR_IDS.map(id => id.replace(/pr$/, '').toUpperCase());
  const header = ['學號', '姓名', '學院', '系所全名', '班級簡稱', '性別', '測驗結果可信度', '高自殺風險', '高關懷', '是否同意導師知情', ...dotHeaders, '可信度分析', '綜合分析'];
  const aoa = [header, ...rows.map(r => [
    r.stuId, r.nameZh, r.college, r.deptName, r.classAbbr, r.gender, r.validity,
    r.highSuicide === 'v' ? '是' : '', r.highConcern === 'v' ? '是' : '', r.consentDisplay,
    ...r.dots.map(d => d.dot), r.validityAnalysis, r.comprehensiveAnalysis,
  ])];
  _ftExportAoaToXlsx(`新生心理測驗_高關懷清冊_${_ft.semester}.xlsx`, '高關懷清冊', aoa);
}

function _ftRenderStatsInvalid() {
  const rows = _ftInvalidListRows(_ft._statsMergedRows || []);
  const bodyRows = rows.map(r => `<tr>
      <td>${escHtml(r.stuId)}</td><td>${escHtml(r.nameZh)}</td><td>${escHtml(r.college)}</td>
      <td>${escHtml(r.deptName)}</td><td>${escHtml(r.classAbbr)}</td><td>${escHtml(r.gender)}</td>
      <td>${escHtml(r.category)}</td>
    </tr>`).join('');
  const html = `
    <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:#718096;font-size:.84rem;">
      <span>共 <strong>${rows.length}</strong> 筆（含「未接受測驗」與「測驗結果可信度低」兩類，比照 ef 慣例合併列出）</span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftExportStatsInvalid()">⬇ 匯出 Excel</button>
    </div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
      <table><thead><tr><th>學號</th><th>姓名</th><th>學院</th><th>系所全名</th><th>班級簡稱</th><th>性別</th><th>無效類別</th></tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="7" style="text-align:center;color:#a0aec0;">無資料</td></tr>`}</tbody></table>
    </div>`;
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = html;
}

function _ftExportStatsInvalid() {
  const rows = _ftInvalidListRows(_ft._statsMergedRows || []);
  const aoa = [
    ['學號', '姓名', '學院', '系所全名', '班級簡稱', '性別', '無效類別'],
    ...rows.map(r => [r.stuId, r.nameZh, r.college, r.deptName, r.classAbbr, r.gender, r.category]),
  ];
  _ftExportAoaToXlsx(`新生心理測驗_無效名單_${_ft.semester}.xlsx`, '無效名單', aoa);
}

function _ftRenderStatsDept() {
  const tree = _ftBuildCollegeDeptClassStats(_ft._statsMergedRows || []);
  const flat = _ftFlattenCollegeDeptStats(tree);
  const rowHtml = (r) => {
    const m = r.metrics;
    const label = r.kind === 'class' ? escHtml(r.classAbbr)
      : r.kind === 'deptSubtotal' ? `【${escHtml(r.dept)} 系所小計】`
      : `【${escHtml(r.college)} 學院小計】`;
    const bold = r.kind !== 'class';
    return `<tr style="${bold ? 'font-weight:700;background:#f7fafc;' : ''}">
      <td>${r.kind === 'class' ? escHtml(r.college) : ''}</td>
      <td>${r.kind === 'class' ? escHtml(r.dept) : ''}</td>
      <td>${label}</td>
      <td>${m.total}</td><td>${m.tested}</td><td>${m.untested}</td>
      <td>${_ftPct(m.testRate)}</td>
      <td>${m.highConcern}</td><td>${m.highConcernConsentOnly}</td><td>${m.invalid}</td>
    </tr>`;
  };
  const html = `
    <div style="margin-bottom:10px;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftExportStatsDept()">⬇ 匯出 Excel</button>
    </div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
      <table><thead><tr>
        <th>學院</th><th>系所</th><th>班級/小計</th><th>應測</th><th>已測</th><th>未測</th>
        <th>受測率</th><th>高關懷</th><th>高關懷(扣除不同意)</th><th>無效人數</th>
      </tr></thead><tbody>${flat.map(rowHtml).join('') || `<tr><td colspan="10" style="text-align:center;color:#a0aec0;">無資料</td></tr>`}</tbody></table>
    </div>`;
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = html;
}

function _ftExportStatsDept() {
  const tree = _ftBuildCollegeDeptClassStats(_ft._statsMergedRows || []);
  const flat = _ftFlattenCollegeDeptStats(tree);
  const rowAoa = (r) => {
    const m = r.metrics;
    const label = r.kind === 'class' ? r.classAbbr
      : r.kind === 'deptSubtotal' ? `【${r.dept} 系所小計】`
      : `【${r.college} 學院小計】`;
    return [r.kind === 'class' ? r.college : '', r.kind === 'class' ? r.dept : '', label, m.total, m.tested, m.untested, _ftPct(m.testRate), m.highConcern, m.highConcernConsentOnly, m.invalid];
  };
  const aoa = [
    ['學院', '系所', '班級/小計', '應測', '已測', '未測', '受測率', '高關懷', '高關懷(扣除不同意)', '無效人數'],
    ...flat.map(rowAoa),
  ];
  _ftExportAoaToXlsx(`新生心理測驗_院系統計_${_ft.semester}.xlsx`, '院系統計', aoa);
}

function _ftRenderStatsEdu() {
  const classStats = _ftBuildEduLevelClassStats(_ft._statsMergedRows || [], _ft._statsTutorRows || []);
  const ranked = _ftRankFreshmanClasses(classStats);
  const top20Set = new Set(ranked.filter(e => e.rank <= 20).map(e => e.classAbbr));
  const schoolTop5 = _ftTop5IssuesForRows(_ft._statsMergedRows || []);

  const rowHtml = (e) => {
    const m = e.metrics;
    const highlighted = e.level === '大一新生' && top20Set.has(e.classAbbr);
    const tutorCell = e.tutorFound ? escHtml(e.tutorName || '（無資料）') : `<span style="color:#c53030;font-weight:600;">未找到</span>`;
    const issuesCell = e.top5Issues ? e.top5Issues.map(x => `${escHtml(x.label)}(${x.count})`).join('、') : '';
    return `<tr style="${highlighted ? 'color:#c53030;font-weight:600;' : ''}">
      <td>${escHtml(e.classAbbr)}</td><td>${escHtml(e.level)}</td><td>${tutorCell}</td>
      <td>${m.total}</td><td>${m.tested}</td><td>${m.untested}</td><td>${_ftPct(m.testRate)}</td>
      <td>${m.highConcern}</td><td>${m.highConcernConsentOnly}</td><td>${m.invalid}</td>
      <td>${_ftPct(m.highConcernRate)}</td>
      <td>${e.level === '大一新生' ? issuesCell : ''}</td>
    </tr>`;
  };

  const html = `
    <div style="margin-bottom:10px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;font-size:.84rem;">
      全校前 5 高議題：${schoolTop5.length ? schoolTop5.map(x => `${escHtml(x.label)}(${x.count})`).join('、') : '（無資料）'}
    </div>
    <div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <span style="color:#718096;font-size:.8rem;">紅字列＝大一新生班級前20高關懷排名（同關懷人數同名次，0 人不排入）</span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftExportStatsEdu()">⬇ 匯出 Excel</button>
    </div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
      <table><thead><tr>
        <th>班級簡稱</th><th>學制</th><th>導師</th><th>應測</th><th>已測</th><th>未測</th><th>受測比例</th>
        <th>高關懷(總數)</th><th>高關懷(扣除不同意)</th><th>無效人數</th><th>高關懷比例</th><th>前5高議題（大一新生）</th>
      </tr></thead><tbody>${classStats.map(rowHtml).join('') || `<tr><td colspan="12" style="text-align:center;color:#a0aec0;">無資料</td></tr>`}</tbody></table>
    </div>`;
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = html;
}

function _ftExportStatsEdu() {
  const classStats = _ftBuildEduLevelClassStats(_ft._statsMergedRows || [], _ft._statsTutorRows || []);
  const rowAoa = (e) => {
    const m = e.metrics;
    const issuesCell = e.top5Issues ? e.top5Issues.map(x => `${x.label}(${x.count})`).join('、') : '';
    return [e.classAbbr, e.level, e.tutorFound ? (e.tutorName || '（無資料）') : '未找到', m.total, m.tested, m.untested, _ftPct(m.testRate), m.highConcern, m.highConcernConsentOnly, m.invalid, _ftPct(m.highConcernRate), issuesCell];
  };
  const aoa = [
    ['班級簡稱', '學制', '導師', '應測', '已測', '未測', '受測比例', '高關懷(總數)', '高關懷(扣除不同意)', '無效人數', '高關懷比例', '前5高議題（大一新生）'],
    ...classStats.map(rowAoa),
  ];
  _ftExportAoaToXlsx(`新生心理測驗_學制統計_${_ft.semester}.xlsx`, '學制統計', aoa);
}

function _ftRenderStatsTopN() {
  const classStats = _ftBuildEduLevelClassStats(_ft._statsMergedRows || [], _ft._statsTutorRows || []);
  const report = _ftTopNFreshmanClassesReport(classStats);
  const rowHtml = (r) => `<tr>
      <td>前 ${r.n} 高</td><td>${r.classCount}</td><td>${r.highConcern}</td><td>${r.tested}</td><td>${_ftPct(r.rate)}</td>
    </tr>`;
  const html = `
    <div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <span style="color:#718096;font-size:.82rem;">大一新生班級依高關懷人數降冪排序，取前 N 班彙總（若實際班級數不足 N，則以現有班級數為準）——此為乾淨詮釋版本（ef 原隱藏表語意不明），請眼驗是否符合期待。</span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="_ftExportStatsTopN()">⬇ 匯出 Excel</button>
    </div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
      <table><thead><tr><th>檔次</th><th>納入班級數</th><th>合計高關懷人數</th><th>合計已測人數</th><th>高關懷比例</th></tr></thead>
      <tbody>${report.map(rowHtml).join('')}</tbody></table>
    </div>`;
  const el = document.getElementById('ft-stats-content');
  if (el) el.innerHTML = html;
}

function _ftExportStatsTopN() {
  const classStats = _ftBuildEduLevelClassStats(_ft._statsMergedRows || [], _ft._statsTutorRows || []);
  const report = _ftTopNFreshmanClassesReport(classStats);
  const aoa = [
    ['檔次', '納入班級數', '合計高關懷人數', '合計已測人數', '高關懷比例'],
    ...report.map(r => [`前 ${r.n} 高`, r.classCount, r.highConcern, r.tested, _ftPct(r.rate)]),
  ];
  _ftExportAoaToXlsx(`新生心理測驗_高關懷班級前N_${_ft.semester}.xlsx`, '高關懷班級前N', aoa);
}

// ══════════════ v211 Slice 5：報告 tab — 純函式（個人報告／班級/系所/學院彙整報告）══════════════
// 全部從整合計算衍生（比照 v210 統計 tab 的原則），不重寫任何 high_concern／validity／consent 判定。

// 燈號中文對應（個人報告複刻 ef「個人計分結果」模板用）：●紅／◎橙／○黃／☆綠；空值＝沒有資料
// （測驗未受測或該量尺沒有結果，見 _ftComputeMergedCells 的 skip 規則）。
const FT_LAMP_TEXT = { '☆': '綠燈☆', '○': '黃燈○', '◎': '橙燈◎', '●': '紅燈●' };
function _ftLampText(dot) {
  return FT_LAMP_TEXT[dot] || '沒有資料';
}

// 量尺標籤：整體(AL)／向度(D1/D2)／因子(F1~F4)。S01~S12 沿用既有 FT_ISSUE_LABELS（不重複定義）。
// 注意 F1＝關係保護/危險因子——ef 原模板此格誤植為「情緒保護/危險因子」（那其實是 F3 的標籤，
// ef 複製貼上時貼錯格，是 ef 本身的 bug），本系統依 ef 量尺設計文件用正確版本。
const FT_SCALE_LABELS = {
  alpr: '整體量表結果',
  d1pr: '外部情境向度',
  d2pr: '內在個人向度',
  f1pr: '關係保護/危險因子',
  f2pr: '生活調控警訊因子',
  f3pr: '情緒保護/危險因子',
  f4pr: '憂鬱自殺警訊因子',
};

// 量表向度詳細說明（個人報告第2頁固定內容，19 列＝7 個 AL/D/F 項＋12 個 S 議題項，順序照
// FT_SCALE_LABELS 後接 FT_ISSUE_S_IDS，任務規格逐字給定文案，不得自行改寫）。
const FT_SCALE_DETAIL_ROWS = [
  { id: 'alpr', name: '整體量表結果', desc: '綜合外在環境、個人內在對心理健康的影響。' },
  { id: 'd1pr', name: '外部情境向度', desc: '反映受試者受外在環境的影響。' },
  { id: 'd2pr', name: '內在個人向度', desc: '反映受試者內心影響自己的程度。' },
  { id: 'f1pr', name: '關係保護/危險因子', desc: '各種關係（如朋友、伴侶、家庭、學校等）對你的影響。' },
  { id: 'f2pr', name: '生活調控警訊因子', desc: '目前生活（如學校、網路、睡眠等）對你的影響。' },
  { id: 'f3pr', name: '情緒保護/危險因子', desc: '調節壓力與情緒的能力（會隨環境而變化）。' },
  { id: 'f4pr', name: '憂鬱自殺警訊因子', desc: '目前憂鬱程度、自殺想法的情形。' },
  { id: 's01pr', name: '同儕與人際互動', desc: '顯示與同學或朋友的互動關係、與同儕建立適當關係的能力，以及能不能從與他人的互動中獲得支持。' },
  { id: 's02pr', name: '家庭功能影響', desc: '顯示家庭功能是否良好、家庭期許是否為壓力來源，也反映最近是否受家庭衝突的影響。' },
  { id: 's03pr', name: '知心好友與親密關係', desc: '顯示最近的親近或親密關係(朋友 或 伴侶關係)品質對生活的影響。' },
  { id: 's04pr', name: '課業與作息變化', desc: '顯示學業與作息調適的能力，是否能應付學業壓力與維持正常生活作息，不致日夜顛倒、熬夜、翹課等。' },
  { id: 's05pr', name: '網路經驗與霸凌', desc: '顯示是否曾經遭受霸凌或在網路上被他人批評攻擊而受傷害，可能導致無法相信他人或朋友。' },
  { id: 's06pr', name: '性別認同壓力', desc: '性別認同是否為壓力來源。例如：擔心父母或他人是否能接納自己的性取向。' },
  { id: 's07pr', name: '情境誘發情緒', desc: '情緒受內在或外在原因而有情緒起伏的情形。例如：天氣陰雨、假日過長、獨自一人胡思亂想。' },
  { id: 's08pr', name: '生氣與衝動控制', desc: '顯示對於憤怒情緒的控制與調整能力。（會隨著環境、個人狀態而變化）。' },
  { id: 's09pr', name: '憤怒表達與攻擊', desc: '顯示是否傾向以行動表達自己的憤怒與情緒，例如：騷擾他人、破壞門窗、網路訊息等傳達憤怒或威脅。' },
  { id: 's10pr', name: '負向認知', desc: '顯示目前生活是否有重心，對未來懷有希望感、價值感或是容易自我懷疑、對生命的意義感到迷惘。' },
  { id: 's11pr', name: '憂鬱相關症狀', desc: '顯示最近心情狀況是否容易低落、浮躁不安、無力空虛或易怒失控等。' },
  { id: 's12pr', name: '自殺意圖', desc: '顯示最近是否有自傷或自殺傾向或意圖。' },
];

// 個人報告資料組裝：吃單一整合列 cells，回傳渲染所需的完整資料物件（不含 DOM）。
function _ftPersonalReportData(cells) {
  const c = cells || {};
  const lamp = (id) => _ftLampText(c[id + '_dot']);
  const scaleEntry = (id) => ({ id, label: FT_SCALE_LABELS[id] || FT_ISSUE_LABELS[id] || id, lamp: lamp(id) });
  return {
    stuId: c.stu_id || '',
    nameZh: c.name_zh || '',
    testDate: c.test_date || '',
    college: c.college || '',
    deptName: c.dept_name || '',
    classAbbr: c.class_abbr || '',
    gender: c.gender || '',
    highSuicide: c.high_suicide === 'v',
    overall: scaleEntry('alpr'),
    dimensions: ['d1pr', 'd2pr'].map(scaleEntry),
    factors: ['f1pr', 'f2pr', 'f3pr', 'f4pr'].map(scaleEntry),
    scales: FT_ISSUE_S_IDS.map(scaleEntry),
    comprehensiveAnalysis: _ftComprehensiveAnalysisText(c),
    validityAnalysis: _ftValidityAnalysisText(c.validity),
  };
}

// 班級報告（導師版）資料組裝：classAbbr 精確比對（trim 後相等，不套用 _ftGroupKey 的「（未分類）」
// 分組語意——那是統計 tab 的分組顯示需求，這裡是「查某一個確切班級」的報告，語意不同）。
function _ftClassReportData(classAbbr, mergedRows, tutorsRows) {
  const norm = (v) => String(v == null ? '' : v).trim();
  const target = norm(classAbbr);
  const rowsForClass = (mergedRows || []).filter(r => norm(r && r.cells && r.cells.class_abbr) === target);
  const tutorName = _ftFindTutorForClass(classAbbr, tutorsRows);
  const highConcernConsented = rowsForClass
    .filter(r => r && r.cells && r.cells.high_concern === 'v' && r.cells.consent === 'v')
    .map(r => {
      const c = r.cells;
      const redIssues = FT_ISSUE_S_IDS.filter(id => c[id + '_dot'] === '●').map(id => FT_ISSUE_LABELS[id]);
      return { stuId: c.stu_id || '', nameZh: c.name_zh || '', gender: c.gender || '', highSuicide: c.high_suicide || '', redIssues };
    });
  return {
    classAbbr: target,
    tutorName,
    metrics: _ftGroupMetrics(rowsForClass),
    top5Issues: _ftTop5IssuesForRows(rowsForClass),
    highConcernConsented,
  };
}

// 系主任版資料組裝：學院→系所兩層分組，每系附前3高議題（_ftTop5IssuesForRows 取前3，不重寫排序）。
function _ftDeptReportData(mergedRows) {
  const collegeMap = new Map();
  (mergedRows || []).forEach(r => {
    const c = (r && r.cells) || {};
    const college = _ftGroupKey(c.college);
    const dept = _ftGroupKey(c.dept_name);
    if (!collegeMap.has(college)) collegeMap.set(college, new Map());
    const deptMap = collegeMap.get(college);
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept).push(r);
  });
  const out = [];
  Array.from(collegeMap.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant')).forEach(college => {
    const deptMap = collegeMap.get(college);
    Array.from(deptMap.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant')).forEach(dept => {
      const rows = deptMap.get(dept);
      out.push({
        college,
        dept,
        metrics: _ftGroupMetrics(rows),
        top3Issues: _ftTop5IssuesForRows(rows).slice(0, 3),
      });
    });
  });
  return out;
}

// 院長版資料組裝：學院分組，只需 metrics（含 highConcernConsentOnly 供受測率/高關懷率顯示）。
function _ftCollegeReportData(mergedRows) {
  const collegeMap = new Map();
  (mergedRows || []).forEach(r => {
    const college = _ftGroupKey(r && r.cells && r.cells.college);
    if (!collegeMap.has(college)) collegeMap.set(college, []);
    collegeMap.get(college).push(r);
  });
  return Array.from(collegeMap.keys())
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map(college => ({ college, metrics: _ftGroupMetrics(collegeMap.get(college)) }));
}

// ══════════════ v211 Slice 5：報告 tab — 渲染層／列印（DOM，不在 harness 測試範圍）══════════════

const FT_REPORT_FOOTNOTE = '＊不同意（含未填寫同意書）導師知情之高關懷學生不列入本報告名單與人數。議題統計為全班彙總，不涉及個別學生。';

async function _ftLoadReportsView() {
  const el = document.getElementById('ft-reports-content');
  if (el) el.innerHTML = `<div style="padding:20px;text-align:center;color:#a0aec0;">⏳ 讀取中…</div>`;
  try {
    const [studentsR, testsR, gformsR, tutorsR] = await Promise.all([
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'students' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'tests' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'gforms' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'tutors' }),
    ]);
    const { rows } = _ftComputeMergedRows(_ftFilterDeleted(studentsR.rows), _ftFilterDeleted(testsR.rows), _ftFilterDeleted(gformsR.rows));
    _ft._statsMergedRows = rows;
    _ft._statsTutorRows = _ftFilterDeleted(tutorsR.rows);
    if (!_ft._reportsSub) _ft._reportsSub = 'personal';
    _ftRenderReportsSubTabs();
    _ftRenderReportsSub();
  } catch (e) {
    if (el) el.innerHTML = `<div style="padding:20px;text-align:center;color:#c53030;">讀取失敗：${escHtml(e.message)}</div>`;
  }
}

function _ftRenderReportsSubTabs() {
  const bar = document.getElementById('ft-reports-subtabs');
  if (!bar) return;
  const subs = [
    ['personal', '個人報告'], ['classreport', '班級報告（導師版）'],
    ['depthead', '系主任版'], ['dean', '院長版'],
  ];
  const cur = _ft._reportsSub || 'personal';
  bar.innerHTML = subs.map(([id, label]) => `<button type="button" class="bk-page-tabbtn" data-active="${cur === id ? '1' : '0'}" onclick="_ftSwitchReportsSub('${id}')">${escHtml(label)}</button>`).join('');
}

function _ftSwitchReportsSub(sub) {
  _ft._reportsSub = sub;
  _ftRenderReportsSubTabs();
  _ftRenderReportsSub();
}

function _ftRenderReportsSub() {
  const sub = _ft._reportsSub || 'personal';
  if (sub === 'personal') _ftRenderReportsPersonal();
  else if (sub === 'classreport') _ftRenderReportsClass();
  else if (sub === 'depthead') _ftRenderReportsDept();
  else if (sub === 'dean') _ftRenderReportsCollege();
}

// 有效測驗結果的整合列（個人報告只納入這些人——_hasTest 且 alpr_dot 非空，見任務規格）。
function _ftReportsValidRows() {
  return (_ft._statsMergedRows || []).filter(r => r && r._hasTest && r.cells && r.cells.alpr_dot);
}

function _ftReportsClassOptions() {
  const set = new Set();
  (_ft._statsMergedRows || []).forEach(r => {
    const cls = r && r.cells && r.cells.class_abbr;
    if (cls) set.add(String(cls).trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function _ftReportsDeptOptions() {
  const map = new Map(); // dept -> college
  (_ft._statsMergedRows || []).forEach(r => {
    const c = (r && r.cells) || {};
    const dept = c.dept_name && String(c.dept_name).trim();
    if (dept && !map.has(dept)) map.set(dept, c.college || '');
  });
  return Array.from(map.entries()).map(([dept, college]) => ({ dept, college })).sort((a, b) => a.dept.localeCompare(b.dept, 'zh-Hant'));
}

function _ftReportsCollegeOptions() {
  const set = new Set();
  (_ft._statsMergedRows || []).forEach(r => {
    const college = r && r.cells && r.cells.college;
    if (college) set.add(String(college).trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

// ── 個人報告 ──

function _ftRenderReportsPersonal() {
  const f = _ft._reportsPersonalFilter || (_ft._reportsPersonalFilter = { classAbbr: '', keyword: '', onlyHighConcern: false, markHighSuicide: false });
  const classOptions = _ftReportsClassOptions();
  const validRows = _ftReportsValidRows().filter(r => {
    const c = r.cells;
    if (f.classAbbr && String(c.class_abbr || '').trim() !== f.classAbbr) return false;
    if (f.onlyHighConcern && c.high_concern !== 'v') return false;
    if (f.keyword) {
      const kw = f.keyword.trim();
      if (kw && !String(c.stu_id || '').includes(kw) && !String(c.name_zh || '').includes(kw)) return false;
    }
    return true;
  });
  const html = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <select class="field-select" style="max-width:160px;" onchange="_ftReportsPersonalSetFilter('classAbbr', this.value)">
        <option value="">全部班級</option>
        ${classOptions.map(c => `<option value="${escHtml(c)}" ${f.classAbbr === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
      </select>
      <input type="text" class="field-input" style="max-width:160px;" placeholder="學號/姓名關鍵字" value="${escHtml(f.keyword)}" oninput="_ftReportsPersonalSetFilter('keyword', this.value)">
      <label style="display:flex;align-items:center;gap:4px;font-size:.84rem;">
        <input type="checkbox" ${f.onlyHighConcern ? 'checked' : ''} onchange="_ftReportsPersonalSetFilter('onlyHighConcern', this.checked)"> 僅高關懷
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:.84rem;" data-tip="列印時在標題左右加隱性符號記號，僅供內部辨識用">
        <input type="checkbox" ${f.markHighSuicide ? 'checked' : ''} onchange="_ftReportsPersonalSetFilter('markHighSuicide', this.checked)"> 高自殺風險隱性記號
      </label>
      <button type="button" class="btn btn-primary btn-sm" onclick="_ftPrintPersonalReports()">🖨 列印</button>
      <span style="margin-left:auto;color:#718096;font-size:.84rem;">符合 <strong>${validRows.length}</strong> 人（僅列出有有效測驗結果者）</span>
    </div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
      <table><thead><tr><th>學號</th><th>姓名</th><th>學院</th><th>系所全名</th><th>班級簡稱</th><th>測驗結果可信度</th></tr></thead>
      <tbody>${validRows.map(r => `<tr><td>${escHtml(r.cells.stu_id)}</td><td>${escHtml(r.cells.name_zh)}</td><td>${escHtml(r.cells.college)}</td><td>${escHtml(r.cells.dept_name)}</td><td>${escHtml(r.cells.class_abbr)}</td><td>${escHtml(r.cells.validity)}</td></tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:#a0aec0;">無資料</td></tr>`}</tbody></table>
    </div>`;
  const el = document.getElementById('ft-reports-content');
  if (el) el.innerHTML = html;
}

function _ftReportsPersonalSetFilter(key, value) {
  if (!_ft._reportsPersonalFilter) _ft._reportsPersonalFilter = { classAbbr: '', keyword: '', onlyHighConcern: false, markHighSuicide: false };
  _ft._reportsPersonalFilter[key] = value;
  _ftRenderReportsPersonal();
}

// 單生 2 頁 HTML（第1頁計分結果、第2頁量表向度詳細說明），複刻 ef「個人計分結果」模板。
function _ftBuildPersonalReportPages(cells, markHighSuicide) {
  const d = _ftPersonalReportData(cells);
  const showMark = !!markHighSuicide && d.highSuicide;
  const markL = showMark ? '。&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' : '';
  const markR = showMark ? '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;。' : '';
  const page1 = `
    <div class="ft-rpt-page">
      <div class="ft-rpt-title">${markL}大專院校學生心理健康關懷量表結果報告${markR}</div>
      <table class="ft-rpt-info">
        <tr><th>學院</th><td>${escHtml(d.college)}</td><th>系所</th><td>${escHtml(d.deptName)}</td><th>年級班級</th><td>${escHtml(d.classAbbr)}</td><th>性別</th><td>${escHtml(d.gender)}</td></tr>
        <tr><th>學號</th><td>${escHtml(d.stuId)}</td><th>姓名</th><td>${escHtml(d.nameZh)}</td><th>施測日期</th><td colspan="3">${escHtml(d.testDate)}</td></tr>
      </table>
      <div class="ft-rpt-sec-title">測驗介紹</div>
      <div class="ft-rpt-sec-body">「綠燈☆」表示您在該項目並沒有太大的困擾；「黃燈○」表示該項目有點讓您困擾；「橙燈◎」表示該項目讓你困擾；「紅燈●」表示該項目讓您很困擾。</div>
      <table class="ft-rpt-result">
        <tr><th>整體情形</th><td>${escHtml(d.overall.label)}：${escHtml(d.overall.lamp)}</td></tr>
        <tr><th>心理健康關懷向度</th><td>${d.dimensions.map(x => `${escHtml(x.label)}：${escHtml(x.lamp)}`).join('<br>')}</td></tr>
        <tr><th>心理健康關懷因子</th><td>${d.factors.map(x => `${escHtml(x.label)}：${escHtml(x.lamp)}`).join('<br>')}</td></tr>
        <tr><th>心理健康關懷量尺</th><td>${d.scales.map(x => `${escHtml(x.label)}：${escHtml(x.lamp)}`).join('<br>')}</td></tr>
      </table>
      <div class="ft-rpt-sec-title">綜合分析</div>
      <div class="ft-rpt-sec-body">${escHtml(d.comprehensiveAnalysis)}</div>
      <div class="ft-rpt-sec-title">測驗可信度分析：</div>
      <div class="ft-rpt-sec-body">${escHtml(d.validityAnalysis)}</div>
      <div class="ft-rpt-sec-title">學生諮商中心相關資訊</div>
      <div class="ft-rpt-sec-body">上班時間：週一至週五 08:00 - 17:30／週一、週四 08:00 - 21:00<br>地點：綜合大樓1樓電梯旁<br>聯絡電話：(08)770-3202 轉 7701、7868、7613、7862、7965</div>
    </div>`;
  const page2 = `
    <div class="ft-rpt-page">
      <div class="ft-rpt-title" style="font-size:16pt;">量表向度詳細說明</div>
      <table class="ft-rpt-detail">
        <thead><tr><th>名稱</th><th>說明</th></tr></thead>
        <tbody>${FT_SCALE_DETAIL_ROWS.map(x => `<tr><td>${escHtml(x.name)}</td><td>${escHtml(x.desc)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  return page1 + page2;
}

const FT_REPORT_PRINT_CSS = `
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"DFKai-SB","BiauKai","Kaiti TC","KaiTi",serif;font-size:12pt;color:#000}
.ft-rpt-page{padding:14mm 15mm;page-break-after:always}
.ft-rpt-page:last-child{page-break-after:auto}
.ft-rpt-title{text-align:center;font-size:18pt;font-weight:bold;margin-bottom:10pt}
.ft-rpt-info{width:100%;border-collapse:collapse;margin-bottom:10pt;font-size:10.5pt}
.ft-rpt-info th{background:#A6A6A6;border:1px solid #000;padding:4pt 6pt;font-weight:bold}
.ft-rpt-info td{border:1px solid #000;padding:4pt 6pt;text-align:center}
.ft-rpt-sec-title{font-weight:bold;font-size:11pt;margin:8pt 0 3pt}
.ft-rpt-sec-body{font-size:10.5pt;line-height:1.6;margin-bottom:8pt}
.ft-rpt-result{width:100%;border-collapse:collapse;margin-bottom:10pt;font-size:10pt}
.ft-rpt-result th{background:#A6A6A6;border:1px solid #000;padding:5pt;text-align:center;width:20%}
.ft-rpt-result td{border:1px solid #000;padding:5pt;line-height:1.7}
.ft-rpt-detail{width:100%;border-collapse:collapse;font-size:9.5pt}
.ft-rpt-detail th{background:#A6A6A6;border:1px solid #000;padding:4pt 6pt}
.ft-rpt-detail td{border:1px solid #000;padding:4pt 6pt;line-height:1.5}
.ft-rpt-detail td:first-child{width:22%;font-weight:bold;white-space:nowrap;}
`;

async function _ftPrintPersonalReports() {
  const f = _ft._reportsPersonalFilter || {};
  const rows = _ftReportsValidRows().filter(r => {
    const c = r.cells;
    if (f.classAbbr && String(c.class_abbr || '').trim() !== f.classAbbr) return false;
    if (f.onlyHighConcern && c.high_concern !== 'v') return false;
    if (f.keyword) {
      const kw = f.keyword.trim();
      if (kw && !String(c.stu_id || '').includes(kw) && !String(c.name_zh || '').includes(kw)) return false;
    }
    return true;
  });
  if (!rows.length) { showToast('沒有符合條件的學生', 'warn'); return; }
  if (rows.length > 300 && !confirm(`即將列印 ${rows.length} 人份個人報告（每人 2 頁），可能需要較長時間，確定要繼續嗎？`)) return;
  const body = rows.map(r => _ftBuildPersonalReportPages(r.cells, f.markHighSuicide)).join('');
  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>新生心理測驗個人報告</title><style>${FT_REPORT_PRINT_CSS}</style></head><body>${body}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`;
  _printViaIframe(html);
}

// ── 班級報告（導師版） ──

function _ftRenderReportsClass() {
  const sel = _ft._reportsClassSel || '';
  const classOptions = _ftReportsClassOptions();
  const html = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <select class="field-select" style="max-width:180px;" onchange="_ftReportsClassSetSel(this.value)">
        <option value="">（全部班級批次列印）</option>
        ${classOptions.map(c => `<option value="${escHtml(c)}" ${sel === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-primary btn-sm" onclick="_ftPrintClassReports()">🖨 列印</button>
    </div>
    <div style="color:#718096;font-size:.84rem;">選擇單一班級預覽並列印一頁，或選「全部班級批次列印」逐班各一頁連續列印。</div>`;
  const el = document.getElementById('ft-reports-content');
  if (el) el.innerHTML = html;
}

function _ftReportsClassSetSel(v) {
  _ft._reportsClassSel = v;
  _ftRenderReportsClass();
}

const FT_REPORT_TABLE_CSS = `
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'微軟正黑體','Microsoft JhengHei','Noto Sans TC',sans-serif;font-size:11pt;color:#000}
.ft-rpt-page{padding:14mm 15mm;page-break-after:always}
.ft-rpt-page:last-child{page-break-after:auto}
.ft-rpt-title{text-align:center;font-size:16pt;font-weight:bold;margin-bottom:4pt}
.ft-rpt-sub{text-align:center;font-size:10.5pt;color:#333;margin-bottom:10pt}
table.ft-rpt-metrics{width:100%;border-collapse:collapse;margin-bottom:10pt;font-size:10pt}
table.ft-rpt-metrics th, table.ft-rpt-metrics td{border:1px solid #000;padding:4pt 6pt;text-align:center}
table.ft-rpt-metrics th{background:#e6e6e6}
.ft-rpt-sec-title{font-weight:bold;font-size:11pt;margin:8pt 0 3pt}
table.ft-rpt-list{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:8pt}
table.ft-rpt-list th, table.ft-rpt-list td{border:1px solid #000;padding:3pt 5pt}
table.ft-rpt-list th{background:#e6e6e6}
.ft-rpt-footnote{font-size:8.5pt;color:#555;margin-top:8pt}
`;

function _ftBuildClassReportPage(classAbbr) {
  const d = _ftClassReportData(classAbbr, _ft._statsMergedRows || [], _ft._statsTutorRows || []);
  const m = d.metrics;
  const tutorLine = d.tutorName == null ? '<span style="color:#c53030;">未找到</span>' : escHtml(d.tutorName || '（無資料）');
  const top5 = d.top5Issues.length ? d.top5Issues.map(x => `${escHtml(x.label)}(${x.count})`).join('、') : '（無）';
  const listRows = d.highConcernConsented.map(s => `<tr><td>${escHtml(s.stuId)}</td><td>${escHtml(s.nameZh)}</td><td>${escHtml(s.gender)}</td><td>${s.highSuicide === 'v' ? '是' : ''}</td><td>${escHtml(s.redIssues.join('、'))}</td></tr>`).join('');
  return `
    <div class="ft-rpt-page">
      <div class="ft-rpt-title">${escHtml(d.classAbbr)} 班級心理測驗結果報告（導師版）</div>
      <div class="ft-rpt-sub">學期：${escHtml(_ft.semester || '')}　導師：${tutorLine}</div>
      <table class="ft-rpt-metrics">
        <tr><th>應測</th><th>已測</th><th>未測</th><th>受測率</th><th>無效人數</th><th>高關懷（同意知情）人數</th></tr>
        <tr><td>${m.total}</td><td>${m.tested}</td><td>${m.untested}</td><td>${_ftPct(m.testRate)}</td><td>${m.invalid}</td><td>${m.highConcernConsentOnly}</td></tr>
      </table>
      <div class="ft-rpt-sec-title">班級前 5 高議題</div>
      <div style="font-size:10pt;margin-bottom:8pt;">${top5}</div>
      <div class="ft-rpt-sec-title">高關懷學生名單</div>
      <table class="ft-rpt-list">
        <thead><tr><th>學號</th><th>姓名</th><th>性別</th><th>高自殺風險</th><th>紅燈議題</th></tr></thead>
        <tbody>${listRows || `<tr><td colspan="5" style="text-align:center;color:#999;">無</td></tr>`}</tbody>
      </table>
      <div class="ft-rpt-footnote">${FT_REPORT_FOOTNOTE}</div>
    </div>`;
}

async function _ftPrintClassReports() {
  const sel = _ft._reportsClassSel || '';
  const classes = sel ? [sel] : _ftReportsClassOptions();
  if (!classes.length) { showToast('沒有班級資料', 'warn'); return; }
  const body = classes.map(_ftBuildClassReportPage).join('');
  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>班級心理測驗結果報告（導師版）</title><style>${FT_REPORT_TABLE_CSS}</style></head><body>${body}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`;
  _printViaIframe(html);
}

// ── 系主任版 ──

function _ftRenderReportsDept() {
  const sel = _ft._reportsDeptSel || '';
  const deptOptions = _ftReportsDeptOptions();
  const html = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <select class="field-select" style="max-width:220px;" onchange="_ftReportsDeptSetSel(this.value)">
        <option value="">（全部系所批次列印）</option>
        ${deptOptions.map(x => `<option value="${escHtml(x.dept)}" ${sel === x.dept ? 'selected' : ''}>${escHtml(x.dept)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-primary btn-sm" onclick="_ftPrintDeptReports()">🖨 列印</button>
    </div>
    <div style="color:#718096;font-size:.84rem;">選擇單一系所列印一頁，或選「全部系所批次列印」逐系各一頁連續列印。</div>`;
  const el = document.getElementById('ft-reports-content');
  if (el) el.innerHTML = html;
}

function _ftReportsDeptSetSel(v) {
  _ft._reportsDeptSel = v;
  _ftRenderReportsDept();
}

function _ftBuildDeptReportPage(entry) {
  const m = entry.metrics;
  const top3 = entry.top3Issues.length ? entry.top3Issues.map(x => `${escHtml(x.label)}(${x.count})`).join('、') : '（無）';
  return `
    <div class="ft-rpt-page">
      <div class="ft-rpt-title">${escHtml(entry.dept)} 系（所）新生心理測驗結果摘要（系主任版）</div>
      <div class="ft-rpt-sub">學期：${escHtml(_ft.semester || '')}</div>
      <table class="ft-rpt-metrics">
        <tr><th>受測率</th><th>高關懷（同意知情）</th><th>比率（占已測）</th></tr>
        <tr><td>${_ftPct(m.testRate)}（${m.tested}/${m.total}）</td><td>${m.highConcernConsentOnly} 人</td><td>${_ftPct(m.tested > 0 ? m.highConcernConsentOnly / m.tested : 0)}（${m.highConcernConsentOnly}/${m.tested}）</td></tr>
      </table>
      <div class="ft-rpt-sec-title">前 3 高議題</div>
      <div style="font-size:10pt;margin-bottom:8pt;">${top3}</div>
      <div class="ft-rpt-footnote">${FT_REPORT_FOOTNOTE}</div>
    </div>`;
}

async function _ftPrintDeptReports() {
  const sel = _ft._reportsDeptSel || '';
  const all = _ftDeptReportData(_ft._statsMergedRows || []);
  const entries = sel ? all.filter(x => x.dept === sel) : all;
  if (!entries.length) { showToast('沒有系所資料', 'warn'); return; }
  const bodyHtml = entries.map(_ftBuildDeptReportPage).join('');
  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>系所新生心理測驗結果摘要（系主任版）</title><style>${FT_REPORT_TABLE_CSS}</style></head><body>${bodyHtml}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`;
  _printViaIframe(html);
}

// ── 院長版 ──

function _ftRenderReportsCollege() {
  const sel = _ft._reportsCollegeSel || '';
  const collegeOptions = _ftReportsCollegeOptions();
  const html = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <select class="field-select" style="max-width:220px;" onchange="_ftReportsCollegeSetSel(this.value)">
        <option value="">（全部學院批次列印）</option>
        ${collegeOptions.map(c => `<option value="${escHtml(c)}" ${sel === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-primary btn-sm" onclick="_ftPrintCollegeReports()">🖨 列印</button>
    </div>
    <div style="color:#718096;font-size:.84rem;">選擇單一學院列印一頁，或選「全部學院批次列印」逐院各一頁連續列印。</div>`;
  const el = document.getElementById('ft-reports-content');
  if (el) el.innerHTML = html;
}

function _ftReportsCollegeSetSel(v) {
  _ft._reportsCollegeSel = v;
  _ftRenderReportsCollege();
}

function _ftBuildCollegeReportPage(entry) {
  const m = entry.metrics;
  return `
    <div class="ft-rpt-page">
      <div class="ft-rpt-title">${escHtml(entry.college)} 學院新生心理測驗結果摘要（院長版）</div>
      <div class="ft-rpt-sub">學期：${escHtml(_ft.semester || '')}</div>
      <table class="ft-rpt-metrics">
        <tr><th>受測率</th><th>高關懷（同意知情）率</th></tr>
        <tr><td>${_ftPct(m.testRate)}（${m.tested}/${m.total}）</td><td>${_ftPct(m.tested > 0 ? m.highConcernConsentOnly / m.tested : 0)}（${m.highConcernConsentOnly}/${m.tested}）</td></tr>
      </table>
      <div class="ft-rpt-footnote">${FT_REPORT_FOOTNOTE}</div>
    </div>`;
}

async function _ftPrintCollegeReports() {
  const sel = _ft._reportsCollegeSel || '';
  const all = _ftCollegeReportData(_ft._statsMergedRows || []);
  const entries = sel ? all.filter(x => x.college === sel) : all;
  if (!entries.length) { showToast('沒有學院資料', 'warn'); return; }
  const bodyHtml = entries.map(_ftBuildCollegeReportPage).join('');
  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>學院新生心理測驗結果摘要（院長版）</title><style>${FT_REPORT_TABLE_CSS}</style></head><body>${bodyHtml}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`;
  _printViaIframe(html);
}

// ══════════════ 學期資料集 ══════════════

async function _ftLoadSemesters() {
  const r = await proxyCall('ftListSemesters', {});
  _ft.semesters = Array.isArray(r?.semesters) ? [...r.semesters].sort((a, b) => (a.id || '').localeCompare(b.id || '')) : [];
}

// v213 規格⑨：下拉每項顯示「顯示名稱(代碼)」，即使顯示名稱恰等於自動值造成重複贅字也照顯示
// （從簡，見任務規格）。
function _ftPopulateSemesterSelect() {
  const sel = document.getElementById('ft-semester-select');
  if (!sel) return;
  sel.innerHTML = _ft.semesters.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.label || s.id)}(${escHtml(s.id)})</option>`).join('');
  if (_ft.semester) sel.value = _ft.semester;
}

async function renderFreshmanTestPage() {
  await _ftLoadSemesters();
  _ftPopulateSemesterSelect();
  const alertEl = document.getElementById('ft-no-semester-alert');
  const bodyEl = document.getElementById('ft-body');
  if (!_ft.semesters.length) {
    if (alertEl) alertEl.style.display = '';
    if (bodyEl) bodyEl.style.display = 'none';
    return;
  }
  if (alertEl) alertEl.style.display = 'none';
  if (bodyEl) bodyEl.style.display = '';
  if (!_ft.semester || !_ft.semesters.some(s => s.id === _ft.semester)) {
    _ft.semester = _ft.semesters[_ft.semesters.length - 1].id; // 預設最新學期
  }
  const sel = document.getElementById('ft-semester-select');
  if (sel) sel.value = _ft.semester;
  await _ftSwitchTab(_ft.tab || 'students', true);
}

// v213 規格⑦⑧：代碼欄預設帶入目前學期（見 _ftDefaultSemesterCode），顯示名稱欄同步預帶其對應
// 顯示名稱（見 _ftSemesterDisplayFromCode）；代碼變更時，只要顯示名稱仍是「自動值」狀態（用
// _ft._newSemLabelAuto 旗標追蹤，不是比對字串——比字串在使用者手動改回與自動值恰好相同時會誤判）
// 就同步刷新，使用者一旦手動編輯過顯示名稱即永久脫鉤（見 _ftOnNewSemLabelInput）。
function _ftShowCreateSemesterModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-create-sem-modal';
  const defaultCode = _ftDefaultSemesterCode(new Date());
  const defaultLabel = _ftSemesterDisplayFromCode(defaultCode);
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h3>新增學期資料集</h3></div>
      <div class="modal-body">
        <div class="form-row">
          <label>學期代碼<span class="req">*</span></label>
          <input type="text" id="ft-new-sem-id" class="field-input" placeholder="例：114-1" value="${escHtml(defaultCode)}" oninput="_ftOnNewSemIdInput(this.value)">
          <div style="font-size:.78rem;color:#718096;margin-top:3px;">格式為「學年-學期」，如 114-1（114 學年度第 1 學期）；已預帶目前學期，如非新增當學期請自行修改。</div>
        </div>
        <div class="form-row">
          <label>顯示名稱</label>
          <input type="text" id="ft-new-sem-label" class="field-input" placeholder="例：114 學年度第 1 學期" value="${escHtml(defaultLabel)}" oninput="_ftOnNewSemLabelInput()">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-create-sem-modal').remove();">取消</button>
        <button class="btn btn-primary" onclick="_ftCreateSemesterSubmit()">建立</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  _ft._newSemLabelAuto = true;
}

function _ftOnNewSemIdInput(value) {
  if (!_ft._newSemLabelAuto) return;
  const labelInput = document.getElementById('ft-new-sem-label');
  if (labelInput) labelInput.value = _ftSemesterDisplayFromCode(value);
}

// 顯示名稱一旦被使用者手動輸入即與代碼脫鉤；改顯示名稱絕不反向改代碼（規格⑧）。
function _ftOnNewSemLabelInput() {
  _ft._newSemLabelAuto = false;
}

async function _ftCreateSemesterSubmit() {
  const id = (document.getElementById('ft-new-sem-id')?.value || '').trim();
  const label = (document.getElementById('ft-new-sem-label')?.value || '').trim();
  if (!/^\d{3}-[12]$/.test(id)) { showToast('學期代碼格式錯誤，須為 114-1 格式', 'warn'); return; }
  try {
    await proxyCall('ftCreateSemester', { id, label });
    document.getElementById('ft-create-sem-modal')?.remove();
    _ft.semester = id;
    await renderFreshmanTestPage();
    showToast(`已建立學期 ${id}`, 'success');
  } catch (e) {
    showToast('建立失敗：' + e.message, 'error');
  }
}

// 切換學期／切換 tab／離開頁面前，若有未儲存變更一律先確認（見檔頭 dirty 管理說明）。
// v223：原生 confirm() 改為系統內建 modal（見 _ftConfirmLeaveModal），多一個「儲存變更後切換」
// 選項——因此把「真正切學期」的邏輯抽成 _ftSwitchSemesterContinue，供三個分支共用。
async function _ftSwitchSemester(id) {
  if (id === _ft.semester) return;
  if (window._ftDirty) {
    _ftConfirmLeaveModal(
      () => { const sel = document.getElementById('ft-semester-select'); if (sel) sel.value = _ft.semester; },
      () => { _ftClearDirty(); _ft.editing = false; _ftSwitchSemesterContinue(id); },
      async () => {
        const ok = await _ftSaveEdit();
        if (ok) await _ftSwitchSemesterContinue(id);
        return ok;
      }
    );
    return;
  }
  await _ftSwitchSemesterContinue(id);
}

async function _ftSwitchSemesterContinue(id) {
  _ft.semester = id;
  _ft._studentsCache = null; // 換學期，跨 tab 檢核快取失效
  _ft._sheetCache = {}; // v222：切學期，per-(semester,tab) grid 快取全部清空（見 _ftLoadActiveSheet）
  await _ftSwitchTab(_ft.tab || 'students', true);
}

// v223：同上，切 tab 的「真正切換」邏輯抽成 _ftSwitchTabContinue，供 modal 三個分支共用。
async function _ftSwitchTab(tab, force) {
  if (!force && tab !== _ft.tab && window._ftDirty) {
    _ftConfirmLeaveModal(
      null,
      () => { _ftClearDirty(); _ft.editing = false; _ftSwitchTabContinue(tab, true); },
      async () => {
        const ok = await _ftSaveEdit();
        if (ok) await _ftSwitchTabContinue(tab, true);
        return ok;
      }
    );
    return;
  }
  await _ftSwitchTabContinue(tab, force);
}

async function _ftSwitchTabContinue(tab, force) {
  // v222：篩選／問題列置頂是單一 tab 內的顯示狀態，切 tab 就清空，避免帶著舊篩選字串跑到新 tab
  // 卻誤以為「這個 tab 資料變少了」。
  _ft.filterText = '';
  _ft.pinIssuesTop = false;
  if (typeof _ftHideImportSummaryBar === 'function') _ftHideImportSummaryBar(); // v223 C：切 tab 收掉匯入摘要條
  _ft.tab = tab;
  ['students', 'tests', 'gform', 'tutors', 'merged', 'stats', 'reports'].forEach(t => {
    document.getElementById(`ft-tabbtn-${t}`)?.setAttribute('data-active', t === tab ? '1' : '0');
  });
  const sheet = _ftCurrentSheet();
  const isMerged = tab === 'merged';
  const isStats = tab === 'stats';
  const isReports = tab === 'reports';
  const sheetTabEl = document.getElementById('ft-sheet-tab');
  const placeholderEl = document.getElementById('ft-tab-placeholder');
  const statsTabEl = document.getElementById('ft-stats-tab');
  const reportsTabEl = document.getElementById('ft-reports-tab');
  const dupBarEl = document.getElementById('ft-gform-dup-bar');
  if (statsTabEl) statsTabEl.style.display = isStats ? '' : 'none';
  if (reportsTabEl) reportsTabEl.style.display = isReports ? '' : 'none';
  // v209：整合（merged）沒有對應的後端 sheet（唯讀衍生視圖），但仍走 #ft-sheet-tab 這個 grid 容器
  // （見 _ftLoadMergedView），只是隱藏工具列（不可編輯）、改顯示彙總列/未對應清單。
  if (sheet || isMerged) {
    if (sheetTabEl) sheetTabEl.style.display = '';
    if (placeholderEl) placeholderEl.style.display = 'none';
    if (dupBarEl && tab !== 'gform') { dupBarEl.style.display = 'none'; dupBarEl.innerHTML = ''; }
    const toolbarRowEl = document.getElementById('ft-toolbar-row');
    if (toolbarRowEl) toolbarRowEl.style.display = isMerged ? 'none' : '';
    const tutorSyncBtnEl = document.getElementById('ft-tutorsync-btn');
    if (tutorSyncBtnEl) tutorSyncBtnEl.style.display = (tab === 'tutors') ? '' : 'none';
    if (!isMerged) {
      const summaryBarEl = document.getElementById('ft-merged-summary-bar');
      const unmatchedBarEl = document.getElementById('ft-merged-unmatched-bar');
      if (summaryBarEl) { summaryBarEl.style.display = 'none'; summaryBarEl.innerHTML = ''; }
      if (unmatchedBarEl) { unmatchedBarEl.style.display = 'none'; unmatchedBarEl.innerHTML = ''; }
    }
    if (isMerged) await _ftLoadMergedView(); else await _ftLoadActiveSheet();
  } else if (isStats) {
    if (sheetTabEl) sheetTabEl.style.display = 'none';
    if (placeholderEl) placeholderEl.style.display = 'none';
    await _ftLoadStatsView();
  } else if (isReports) {
    if (sheetTabEl) sheetTabEl.style.display = 'none';
    if (placeholderEl) placeholderEl.style.display = 'none';
    await _ftLoadReportsView();
  } else {
    if (sheetTabEl) sheetTabEl.style.display = 'none';
    if (placeholderEl) { placeholderEl.style.display = ''; _ftRenderPlaceholder(tab); }
  }
}

function _ftRenderPlaceholder(tab) {
  const labels = {}; // v210：students/tests/gform/tutors/merged/stats 六個 tab 皆已實作，目前無佔位項
  const el = document.getElementById('ft-tab-placeholder');
  if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:#a0aec0;">🚧 ${escHtml(labels[tab] || tab)}開發中，敬請期待後續版本。</div>`;
}

// ══════════════ 資料 tab（學生基本資料／測驗資料／Google表單／導師名冊）：讀取／grid 渲染 ══════════════

// 跨 tab 檢核用：讀取「學生基本資料」rows（唯讀，用於測驗資料／Google表單 tab 的姓名比對），
// 依目前學期快取，換學期或該 sheet 存檔後才重新讀取（見 _ftSwitchSemester／_ftSaveEdit）。
async function _ftLoadStudentsForChecks() {
  if (_ft._studentsCache && _ft._studentsCacheSemester === _ft.semester) return;
  try {
    const r = await proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'students' });
    _ft._studentsCache = _ftFilterDeleted(r.rows || []); // v213：軟刪除列不參與跨 tab 檢核
  } catch (_e) {
    _ft._studentsCache = [];
  }
  _ft._studentsCacheSemester = _ft.semester;
}

// v222：per-(semester,tab) grid 快取 key（純函式，供測試）。
function _ftSheetCacheKey(semester, sheet) {
  return `${semester}::${sheet}`;
}

// 把 ftGetSheet 回應套用到目前畫面狀態（軟刪除列排除、補 _uid），回傳套用後的 rows（供呼叫端存快取用）。
function _ftApplySheetResponseToState(r) {
  _ft.schema = r.schema;
  // v213：軟刪除列一律排除（不進畫面／不進任何衍生視圖，見 _ftFilterDeleted 檔頭說明）；
  // 每列補 _uid（交易 diff 用的穩定身分鍵）；uid 計數器隨每次重新載入歸零即可（同一畫面內
  // 唯一就夠用，不需要跨頁面持久）。
  _ft._uidSeq = 1;
  _ft.rows = _ftFilterDeleted(r.rows || []).map(row => ({ ...row, cells: { ...((row && row.cells) || {}) } }));
  _ftEnsureRowUids(_ft.rows);
  // v223：評判記憶（僅 tests／gforms 兩個 sheet 實際使用，其餘 sheet 一律空陣列，見
  // _ftSaveEdit／_ftFilterImportRowsAgainstJudged 檔頭說明）。
  _ft.judged = Array.isArray(r.judged) ? r.judged : [];
  return _ft.rows;
}

// v222：切 tab 每次都重新 ftGetSheet 要等 0.5~1 秒——改成先用 _ft._sheetCache 裡的舊資料立即渲染
// （如果有），同時背景重新抓最新資料，回來後若內容有變且使用者「沒有在編輯」就無聲更新重繪。
// 沒有快取（第一次載入這個 semester+tab）才顯示讀取中、走原本同步等待的路徑。
async function _ftLoadActiveSheet() {
  const sheet = _ftCurrentSheet();
  if (!sheet) return;
  const semester = _ft.semester;
  const cacheKey = _ftSheetCacheKey(semester, sheet);
  const wrap = document.getElementById('ft-grid-wrap');
  const cached = _ft._sheetCache[cacheKey];
  if (cached) {
    _ft.schema = cached.schema;
    _ft._uidSeq = 1;
    _ft.rows = cached.rows.map(row => ({ ...row, cells: { ...((row && row.cells) || {}) } }));
    _ftEnsureRowUids(_ft.rows);
    _ft.judged = cached.judged || []; // v223：評判記憶隨 tab 快取一起帶（見 _ftApplySheetResponseToState）
    _ft.editing = false;
    _ft._vwin = null;
    _ft._renderCtx = null;
    if (sheet === 'tests' || sheet === 'gforms') await _ftLoadStudentsForChecks();
    _ftSyncEditButtons();
    _ftClearDirty();
    _ftRenderGrid();
    _ftRefreshActiveSheetInBackground(sheet, semester, cacheKey);
    return;
  }
  if (wrap) wrap.innerHTML = `<div style="padding:20px;text-align:center;color:#a0aec0;">⏳ 讀取中…</div>`;
  try {
    const r = await proxyCall('ftGetSheet', { semester, sheet });
    const rows = _ftApplySheetResponseToState(r);
    _ft._sheetCache[cacheKey] = { schema: r.schema, rows: rows.map(row => ({ ...row, cells: { ...row.cells } })), judged: _ft.judged };
    _ft.editing = false;
    _ft._vwin = null;
    _ft._renderCtx = null;
    // v209：導師名冊（tutors）沒有學號欄，跨 tab 姓名/學號檢核與它無關，不需要載入 students 快取。
    if (sheet === 'tests' || sheet === 'gforms') await _ftLoadStudentsForChecks();
    _ftSyncEditButtons();
    _ftClearDirty();
    _ftRenderGrid();
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div style="padding:20px;text-align:center;color:#c53030;">讀取失敗：${escHtml(e.message)}</div>`;
  }
}

// 背景重新抓最新資料：抓回來後一律更新快取（下次切回本 tab 就是最新的），但只有在「使用者目前仍
// 停留在同一個 semester+tab、且不在編輯模式」時才無聲重繪畫面（見任務規格：已進編輯就不覆蓋，避免
// 蓋掉輸入）。失敗不打擾使用者，保留目前畫面/快取內容（背景刷新本就是錦上添花，不是關鍵路徑）。
async function _ftRefreshActiveSheetInBackground(sheet, semester, cacheKey) {
  let r;
  try {
    r = await proxyCall('ftGetSheet', { semester, sheet });
  } catch (_e) {
    return;
  }
  const freshRows = _ftFilterDeleted(r.rows || []);
  const cached = _ft._sheetCache[cacheKey];
  const changed = !cached || _ftSheetDataChanged(cached.schema, cached.rows, r.schema, freshRows);
  _ft._sheetCache[cacheKey] = { schema: r.schema, rows: freshRows.map(row => ({ ...row, cells: { ...((row && row.cells) || {}) } })), judged: Array.isArray(r.judged) ? r.judged : [] };
  const stillRelevant = _ft.semester === semester && _ftCurrentSheet() === sheet;
  if (!changed || !stillRelevant || _ft.editing) return;
  _ftApplySheetResponseToState(r);
  if (sheet === 'tests' || sheet === 'gforms') await _ftLoadStudentsForChecks();
  _ftRenderGrid();
}

// ══════════════ v209：整合 tab（唯讀衍生視圖）：載入／彙總列渲染 ══════════════
// 沒有對應的後端 sheet，切到本 tab 時即時載入 students/tests/gforms 三個 sheet 並在前端算出
// 60 欄整合列（見 _ftComputeMergedRows），重用既有虛擬化 grid（_ftRenderGrid）唯讀渲染——
// _ft.editing 固定 false、工具列在 _ftSwitchTab 已整排隱藏，不需要另外攔截編輯操作。
async function _ftLoadMergedView() {
  const wrap = document.getElementById('ft-grid-wrap');
  if (wrap) wrap.innerHTML = `<div style="padding:20px;text-align:center;color:#a0aec0;">⏳ 讀取中…</div>`;
  try {
    const [studentsR, testsR, gformsR] = await Promise.all([
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'students' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'tests' }),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'gforms' }),
    ]);
    const sStudents = _ftFilterDeleted(studentsR.rows);
    const { rows, unmatched } = _ftComputeMergedRows(sStudents, _ftFilterDeleted(testsR.rows), _ftFilterDeleted(gformsR.rows));
    _ft.schema = { version: 1, cols: _ftMergedSchemaCols() };
    _ft.rows = rows;
    _ft.editing = false;
    _ft._vwin = null;
    _ft._renderCtx = null;
    _ft._mergedUnmatched = unmatched;
    _ft._mergedStudents = sStudents; // v223 一.12：供未對應清單「以姓名比對」用
    _ftRenderMergedSummary(rows, unmatched);
    _ftRenderGrid();
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div style="padding:20px;text-align:center;color:#c53030;">讀取失敗：${escHtml(e.message)}</div>`;
  }
}

function _ftRenderMergedSummary(rows, unmatched) {
  const stats = _ftMergedSummaryStats(rows);
  const summaryEl = document.getElementById('ft-merged-summary-bar');
  if (summaryEl) {
    summaryEl.style.display = '';
    summaryEl.innerHTML = `總人數 <strong>${stats.total}</strong>　有測驗紀錄 <strong>${stats.withTest}</strong>　未受測 <strong>${stats.untested}</strong>　高關懷 <strong style="color:#c53030;">${stats.highConcern}</strong>`;
  }
  const unmatchedEl = document.getElementById('ft-merged-unmatched-bar');
  if (!unmatchedEl) return;
  if (!unmatched || !unmatched.length) { unmatchedEl.style.display = 'none'; unmatchedEl.innerHTML = ''; return; }
  unmatchedEl.style.display = '';
  // v223 一.12：可切換「自動比對學號」（預設，列出學號查無者）／「自動比對姓名」（改以姓名去學生
  // 基本資料找同名者，協助主責辨識此筆是否為某學生的學號登打錯誤——以學生基本資料為評判主體）。
  const mode = _ft._mergedMatchMode || 'stuId';
  const annotated = mode === 'name' ? _ftUnmatchedNameCandidates(unmatched, _ft._mergedStudents || []) : unmatched;
  const toggle = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
    <span style="color:#744210;">⚠ 未對應清單（學號在學生基本資料查無，可能是登打錯誤，共 ${unmatched.length} 筆）</span>
    <span style="flex:1 1 auto;"></span>
    <span style="color:#718096;font-size:.78rem;">辨識方式：</span>
    <button class="btn btn-sm ${mode === 'stuId' ? 'btn-primary' : 'btn-secondary'}" onclick="_ftSetMergedMatchMode('stuId')" data-tip="依學號比對（預設）：列出學號在學生基本資料查無的紀錄">自動比對學號</button>
    <button class="btn btn-sm ${mode === 'name' ? 'btn-primary' : 'btn-secondary'}" onclick="_ftSetMergedMatchMode('name')" data-tip="改以姓名為主，去學生基本資料找同名的人，協助判斷此筆是否為某學生的學號登打錯誤">自動比對姓名</button>
  </div>`;
  const list = annotated.map(u => {
    let extra = '';
    if (mode === 'name') {
      if (u.candidates && u.candidates.length) {
        extra = `　<span style="color:#2b6cb0;">→ 學生基本資料同名學號：${u.candidates.map(c => escHtml(c.stuId || '（無學號）')).join('、')}（可能為學號登打錯誤）</span>`;
      } else {
        extra = `　<span style="color:#c53030;">→ 學生基本資料查無同名</span>`;
      }
    }
    return `<li>${escHtml(u.stuId)}　${escHtml(u.name || '（無姓名）')}　<span style="color:#a0aec0;">來源：${escHtml(u.source)}</span>${extra}</li>`;
  }).join('');
  unmatchedEl.innerHTML = `${toggle}<ul style="margin:0;padding-left:20px;">${list}</ul>`;
}

function _ftSetMergedMatchMode(mode) {
  _ft._mergedMatchMode = mode;
  _ftRenderMergedSummary(_ft.rows, _ft._mergedUnmatched);
}

function _ftSyncEditButtons() {
  const editBtn = document.getElementById('ft-edit-btn');
  const saveBtn = document.getElementById('ft-save-btn');
  const discardBtn = document.getElementById('ft-discard-btn');
  if (editBtn) editBtn.style.display = _ft.editing ? 'none' : '';
  if (saveBtn) saveBtn.style.display = _ft.editing ? '' : 'none';
  if (discardBtn) discardBtn.style.display = _ft.editing ? '' : 'none';
}

// v222：關鍵字篩選輸入框（即打即濾，重繪整版 grid——虛擬化窗口本就會依 rowCount 重算，重繪成本
// 與捲動時相近，不需要額外 debounce）。
function _ftOnFilterInput(v) {
  _ft.filterText = v;
  _ftRenderGrid();
}

function _ftTogglePinIssues() {
  _ft.pinIssuesTop = !_ft.pinIssuesTop;
  _ftRenderGrid();
}

// 依目前 tab／編輯狀態同步篩選工具列的顯示/停用；每次 _ftRenderGrid 都呼叫，故欄位切換、進出
// 編輯模式、存檔/放棄後都會自動反映最新狀態，不需要在各觸發點各自補呼叫。
function _ftSyncFilterToolbarUi() {
  const bar = document.getElementById('ft-filter-toolbar');
  const input = document.getElementById('ft-filter-input');
  const pinBtn = document.getElementById('ft-pin-issues-btn');
  if (!bar || !input || !pinBtn) return;
  const applicable = _ft.tab === 'students' || _ft.tab === 'tests' || _ft.tab === 'gform';
  bar.style.display = applicable ? 'inline-flex' : 'none';
  if (!applicable) return;
  input.disabled = _ft.editing;
  pinBtn.disabled = _ft.editing;
  if (input.value !== (_ft.filterText || '')) input.value = _ft.filterText || '';
  pinBtn.style.opacity = _ft.editing ? '.55' : '1';
  pinBtn.setAttribute('data-active', _ft.pinIssuesTop ? '1' : '0');
  pinBtn.classList.toggle('btn-primary', !!_ft.pinIssuesTop && !_ft.editing);
  pinBtn.classList.toggle('btn-secondary', !(_ft.pinIssuesTop && !_ft.editing));
}

function _ftMarkDirty() {
  window._ftDirty = true;
  const el = document.getElementById('ft-dirty-indicator');
  if (el) el.style.display = '';
}
// v213：清 dirty 的四個既有觸發點（存檔成功／放棄編輯／切 tab／重新載入）恰好也是任務規格要求
// 復原/重做堆疊全部清空的四個時機，故直接併入同一函式（見 _ftLoadActiveSheet 每次重新載入都會
// 呼叫本函式，天然涵蓋「重新載入」）。
function _ftClearDirty() {
  window._ftDirty = false;
  const el = document.getElementById('ft-dirty-indicator');
  if (el) el.style.display = 'none';
  _ftClearUndoRedo();
}

// ══════════════ v213：交易式復原/重做（狀態操作部分，純函式見上方 _ftApplyTransaction／
// _ftDiffRowsForTransaction）══════════════

function _ftNextUid() {
  const n = _ft._uidSeq || 1;
  _ft._uidSeq = n + 1;
  return 'u' + n;
}

// 確保 rows 內每一列都有 _uid（供交易 diff 用的穩定身分鍵，涵蓋尚未存檔、_id 為 null 的新列）；
// 已有 _uid 的列不動（保留原身分）。直接 mutate 傳入的列物件（呼叫端傳入的是已經要採用的新
// 陣列，不是使用者仍在編輯中的舊陣列，故就地補 _uid 沒有「動到不該動的資料」疑慮）。
function _ftEnsureRowUids(rows) {
  (rows || []).forEach(r => { if (r && r._uid == null) r._uid = _ftNextUid(); });
  return rows;
}

function _ftSyncUndoButtons() {
  const u = document.getElementById('ft-undo-btn');
  const r = document.getElementById('ft-redo-btn');
  if (u) u.disabled = !(_ft._undoStack && _ft._undoStack.length);
  if (r) r.disabled = !(_ft._redoStack && _ft._redoStack.length);
}

function _ftClearUndoRedo() {
  _ft._undoStack = [];
  _ft._redoStack = [];
  _ftSyncUndoButtons();
}

// 推入一筆交易：redo 堆疊清空（比照一般編輯器慣例——有新操作後舊的「重做」路徑失效）；
// undo 堆疊上限 FT_UNDO_STACK_LIMIT（超過從最舊的一端捨棄，不做整表快照，見任務規格）。
// 空交易（前後無任何差異，例如貼上的內容與原值完全相同）不推入。
function _ftPushUndo(tx) {
  if (!tx || (!tx.fieldChanges.length && !tx.insertions.length && !(tx.removals || []).length)) return;
  _ft._undoStack = _ft._undoStack || [];
  _ft._redoStack = [];
  _ft._undoStack.push(tx);
  if (_ft._undoStack.length > FT_UNDO_STACK_LIMIT) _ft._undoStack.shift();
  _ftSyncUndoButtons();
}

function _ftUndo() {
  const tx = (_ft._undoStack || []).pop();
  if (!tx) return;
  _ft.rows = _ftApplyTransaction(_ft.rows, tx, 'undo');
  _ft._redoStack = _ft._redoStack || [];
  _ft._redoStack.push(tx);
  if (_ft._redoStack.length > FT_UNDO_STACK_LIMIT) _ft._redoStack.shift();
  _ftMarkDirty(); // 從簡：即使一路復原回起點仍算 dirty（見任務規格）
  _ftSyncUndoButtons();
  _ftRenderGrid();
}

function _ftRedo() {
  const tx = (_ft._redoStack || []).pop();
  if (!tx) return;
  _ft.rows = _ftApplyTransaction(_ft.rows, tx, 'redo');
  _ft._undoStack = _ft._undoStack || [];
  _ft._undoStack.push(tx);
  _ftMarkDirty();
  _ftSyncUndoButtons();
  _ftRenderGrid();
}

// Ctrl+Z／Ctrl+Y／Ctrl+Shift+Z 鍵盤監聽：焦點若在儲存格 input 且該格「有未提交的輸入」（目前
// input 顯示值 ≠ 聚焦當下的原值），一律不攔截——讓瀏覽器原生的輸入框 undo 處理該格（見任務
// 規格）；其餘情況（未聚焦儲存格，或該格值已提交/未變更）才由本函式接手復原/重做堆疊。
// v216：改掛在 document 上（見下方註冊處說明）——本函式一開始就用「新生心測頁是否為目前顯示
// 中的頁面」守門，避免非新生心測頁面也被攔截；並比照站內既有慣例，主動避開圖片編輯器
// （_imgEdActive）、家系圖編輯器（geno-overlay）、富文字編輯器（contenteditable/.rt-editor）
// 這幾個各自有自己 undo 處理的場景，讓它們的鍵盤事件正常往下走原生流程或各自的處理函式。
function _ftHandleUndoRedoKeydown(ev) {
  const key = ev.key ? ev.key.toLowerCase() : '';
  const mod = ev.ctrlKey || ev.metaKey;
  const isUndo = mod && !ev.shiftKey && key === 'z';
  const isRedo = mod && (key === 'y' || (ev.shiftKey && key === 'z'));
  if (!isUndo && !isRedo) return;
  if (!document.getElementById('page-freshman-test')?.classList.contains('active')) return;
  if (window._imgEdActive) return;
  if (document.getElementById('geno-overlay')) return;
  const active = document.activeElement;
  if (active && (active.isContentEditable || (active.classList && active.classList.contains('rt-editor')))) return;
  if (active && active.classList && active.classList.contains('ft-cell-input')) {
    const focus = _ft._focus;
    const hasUncommitted = focus && String(active.value ?? '') !== String(focus.oldValue ?? '');
    if (hasUncommitted) return; // 讓瀏覽器原生 undo 處理這一格
  }
  ev.preventDefault();
  if (isUndo) _ftUndo(); else _ftRedo();
}

function _ftEnterEdit() {
  // v222：篩選／問題列置頂只在非編輯模式可用（見 _ftComputeDisplayOrder 檔頭風險評估），進編輯
  // 一律清空並提示，避免使用者以為篩選仍在生效、誤判「怎麼列變少了」。
  const hadFilter = !!(_ft.filterText || _ft.pinIssuesTop);
  _ft.filterText = '';
  _ft.pinIssuesTop = false;
  _ft.editing = true;
  _ftSyncEditButtons();
  _ftRenderGrid();
  if (hadFilter) showToast('已進入編輯模式，關鍵字篩選／問題列置頂已停用並清空', 'info');
}

async function _ftDiscardEdit() {
  if (window._ftDirty && !confirm('確定要放棄本次編輯的變更嗎？離開後變更不會保留。')) return;
  _ft.editing = false;
  _ftClearDirty();
  _ftSyncEditButtons();
  // v222：放棄編輯要拿到真正的伺服器現況，不能沿用快取（快取可能是進編輯前、甚至更早背景刷新
  // 留下的舊內容）——刪掉這個 sheet 的快取項目強制 _ftLoadActiveSheet 重新抓。
  const sheet = _ftCurrentSheet();
  if (sheet) delete _ft._sheetCache[_ftSheetCacheKey(_ft.semester, sheet)];
  await _ftLoadActiveSheet();
}

// rowsToSave 建構規則——
//  - 待刪除（_pendingDelete）且尚未存檔過（_id 為 null）的新列：直接不送（等於沒新增過）。
//  - 待刪除且是既有列（有 _id）：一律送出並標 deleted:true。v216：後端 ftSaveRows 收到
//    deleted:true 的列，本次存檔即從資料檔物理移除（見 server/src/freshmanTest/actions.js），
//    即使該列 cells 全空也要送（否則刪除動作不會落地）——這是「完全空白列不送」規則的唯一例外。
//  - 其餘列沿用既有規則：完全空白（無任何欄位有值）不送。
//  - 存檔前整批對每一欄值跑 _ftTrimCell（規格③「存檔前整批保險」，救回貼上/舊資料殘留的頭尾空白）。
// v223：回傳 true／false（儲存成功／失敗），供 _ftConfirmLeaveModal 的「儲存變更後切換」分支判斷
// 是否要繼續執行原本待做的切換（呼叫端不能只看有沒有拋例外——本函式向來自己 catch 並顯示 toast，
// 不會讓例外往外傳）。
async function _ftSaveEdit() {
  const sheet = _ftCurrentSheet();
  if (!sheet) return false;
  const btn = document.getElementById('ft-save-btn');
  if (btn) btn.disabled = true;
  try {
    const rowsBeforeSave = _ft.rows;
    const rowsToSave = rowsBeforeSave
      .filter(r => !(r && r._pendingDelete === true && !r._id))
      .filter(r => (r && r._pendingDelete === true && r._id) || Object.values((r && r.cells) || {}).some(v => String(v ?? '').trim() !== ''))
      .map(r => {
        const cells = {};
        Object.keys((r && r.cells) || {}).forEach(k => { cells[k] = _ftTrimCell(r.cells[k]); });
        const out = { _id: r._id, cells, excluded: !!(r && r.excluded) };
        if (r && r._pendingDelete === true) out.deleted = true;
        return out;
      });
    const totalMissing = rowsToSave.filter(r => !r.deleted).reduce((sum, r) => sum + _ftRowMissingRequired(r, _ft.schema).length, 0);
    const params = { semester: _ft.semester, sheet, rows: rowsToSave };
    // v223 D2：測驗資料／Google表單 tab 記住「使用者刪除既有列並儲存」的內容指紋（評判記憶），
    // 供匯入時靜默略過重複匯入同一筆已評判刪除的資料（見 _ftBuildJudgedEntries／
    // _ftFilterImportRowsAgainstJudged 檔頭說明）；「全部刪除」並儲存＝重來，整批清空記憶
    // （見 _ftIsFullClearSave），單筆刪除則持續累積。students／tutors 不記錄（見任務規格 12
    // 明定範圍僅 tests／gform，不送 judged 參數，後端維持原樣不動）。
    if (sheet === 'tests' || sheet === 'gforms') {
      if (_ftIsFullClearSave(rowsBeforeSave)) {
        params.judged = [];
      } else {
        const deletedRows = rowsBeforeSave.filter(r => r && r._pendingDelete === true && r._id);
        if (deletedRows.length) {
          params.judged = _ftBuildJudgedEntries(_ft.judged || [], deletedRows, 'stu_id', new Date().toISOString());
        }
      }
    }
    const r = await proxyCall('ftSaveRows', params);
    showToast(`已儲存 ${r.count} 筆${totalMissing ? `（其中 ${totalMissing} 個必填欄位仍為空，已標記醒目提示，請盡快補齊）` : ''}`, totalMissing ? 'warn' : 'success');
    _ft.editing = false;
    _ftClearDirty();
    _ftSyncEditButtons();
    if (sheet === 'students') _ft._studentsCache = null; // 供測驗資料／Google表單 tab 下次重新讀取最新姓名
    // v222：儲存成功＝伺服器現況已改變，這個 sheet 的快取跟著失效（下一次 _ftLoadActiveSheet 會是
    // cache miss，直接向伺服器重新抓，用「剛存進去的結果」重建快取，符合任務規格「儲存成功後以
    // 儲存結果更新快取」）。
    delete _ft._sheetCache[_ftSheetCacheKey(_ft.semester, sheet)];
    await _ftLoadActiveSheet();
    return true;
  } catch (e) {
    showToast('儲存失敗：' + e.message, 'error');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════ v223 B：可重用的「離開頁面前有未儲存變更」提醒 modal ══════════════
// 取代原本三處（切換分頁／切換學期／站內導頁離開）各自的原生 confirm()，改為系統內建 modal（比照
// 既有 .modal-overlay/.modal-box 樣式），多一個「儲存變更後切換」選項——呼叫端傳入三顆按鈕各自要
// 執行的 callback：
//   onStay      － 使用者選「留在此頁」（可為 null，代表不需要額外復原動作，例如切分頁按鈕本身
//                  沒有畫面狀態要復原；切學期下拉選單則需要把 <select> 值改回目前學期）。
//   onDiscard   － 使用者選「放棄變更並切換」，同步 callback，呼叫端自行負責清 dirty／繼續切換。
//   onSaveThen  － 使用者選「儲存變更後切換」，async function，須回傳 _ftSaveEdit() 的結果
//                  （true／false）：本函式只負責防連點與顯示「儲存中…」，儲存失敗時 _ftSaveEdit
//                  本身已經 showToast 顯示錯誤，這裡只需要讓 modal 維持開啟、按鈕解除防連點，不
//                  重複顯示錯誤訊息。
function _ftConfirmLeaveModal(onStay, onDiscard, onSaveThen) {
  document.getElementById('ft-leave-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-leave-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><h3>有未儲存的變更</h3></div>
      <div class="modal-body">
        <p style="font-size:.88rem;color:#4a5568;margin:0;">目前編輯的內容尚未儲存，離開後未儲存的變更將會遺失，要怎麼處理？</p>
      </div>
      <div class="modal-footer" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary" id="ft-leave-stay-btn">留在此頁</button>
        <button type="button" class="btn btn-danger" id="ft-leave-discard-btn">放棄變更並切換</button>
        <button type="button" class="btn btn-primary" id="ft-leave-save-btn">儲存變更後切換</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  const stayBtn = document.getElementById('ft-leave-stay-btn');
  const discardBtn = document.getElementById('ft-leave-discard-btn');
  const saveBtn = document.getElementById('ft-leave-save-btn');
  stayBtn.onclick = () => { close(); if (onStay) onStay(); };
  discardBtn.onclick = () => { close(); if (onDiscard) onDiscard(); };
  saveBtn.onclick = async () => {
    if (saveBtn.disabled) return; // 防連點（存檔為非同步，見檔頭說明）
    stayBtn.disabled = true; discardBtn.disabled = true; saveBtn.disabled = true;
    saveBtn.textContent = '儲存中…';
    let ok = false;
    try {
      ok = await onSaveThen();
    } catch (e) {
      showToast('儲存失敗：' + (e && e.message), 'error');
      ok = false;
    }
    if (ok) { close(); return; }
    // 儲存失敗：modal 維持開啟，解除防連點，讓使用者可以重試或改選其他選項。
    stayBtn.disabled = false; discardBtn.disabled = false; saveBtn.disabled = false;
    saveBtn.textContent = '儲存變更後切換';
  };
}

function _ftAddRows() {
  if (!_ft.editing) _ftEnterEdit();
  const n = Math.max(1, Math.min(500, Number(document.getElementById('ft-add-rows-count')?.value) || 1));
  const at = _ft.rows.length;
  const newRows = [];
  for (let i = 0; i < n; i++) newRows.push({ _id: null, _uid: _ftNextUid(), cells: {} });
  _ft.rows = _ft.rows.concat(newRows);
  _ftPushUndo({ removals: [], fieldChanges: [], insertions: [{ at, rows: newRows }] });
  _ftMarkDirty();
  _ftRenderGrid();
}

// v213：每列軟刪除／還原共用同一個切換函式（見 _ftDeleteCellHtml 的鈕）——單一 fieldChange
// 交易（flag：_pendingDelete），符合任務規格「軟刪除列／還原列」各自一筆 undo 交易。
function _ftToggleRowDelete(rowIdx) {
  const row = _ft.rows[rowIdx];
  if (!row) return;
  if (!_ft.editing) _ftEnterEdit();
  const oldValue = !!row._pendingDelete;
  const newValue = !oldValue;
  row._pendingDelete = newValue;
  _ftPushUndo({ removals: [], insertions: [], fieldChanges: [{ rowIdx, kind: 'flag', name: '_pendingDelete', oldValue, newValue }] });
  _ftMarkDirty();
  _ftRenderGrid();
}

// v215：全部刪除——把目前分頁所有尚未標記的列一次標記軟刪除（單一 undo 交易，Ctrl+Z 可整批
// 復原；逐列仍可按「↺ 還原」取消）。實際刪除與 v213 每列軟刪除共用同一條管線：按「儲存」才發生。
function _ftDeleteAllRows() {
  if (!_ft.rows.length) { showToast('目前沒有資料列', 'info'); return; }
  const targets = _ft.rows.map((r, i) => ({ r, i })).filter(x => x.r._pendingDelete !== true);
  if (!targets.length) { showToast('所有列都已標記為刪除，按「儲存」即會實際刪除', 'info'); return; }
  if (!confirm(`確定要把全部 ${_ft.rows.length} 列標記為刪除嗎？\n\n標記後可按 Ctrl+Z 整批復原、或逐列按「↺ 還原」；要按「儲存」才會實際從伺服器刪除。`)) return;
  if (!_ft.editing) _ftEnterEdit();
  const fieldChanges = targets.map(x => ({ rowIdx: x.i, kind: 'flag', name: '_pendingDelete', oldValue: !!x.r._pendingDelete, newValue: true }));
  targets.forEach(x => { x.r._pendingDelete = true; });
  _ftPushUndo({ removals: [], insertions: [], fieldChanges });
  _ftMarkDirty();
  _ftRenderGrid();
  showToast(`已標記全部 ${targets.length} 列為刪除，按「儲存」後才會實際寫入`, 'warn');
}

function _ftOnCellInput(rowIdx, colId, value) {
  const row = _ft.rows[rowIdx];
  if (!row) return;
  row.cells = row.cells || {};
  row.cells[colId] = value;
  _ftMarkDirty();
}

// 儲存格失焦時：若值相對聚焦當下有變（見 _ftSetFocusCell 記的 oldValue），視為「提交」——去頭尾
// 空白（規格③）＋推入一筆 undo 交易（規格①，逐鍵輸入不算，只有離開欄位且值真的變了才算）。
// 同時（不論是否提交）沿用既有行為：tests/gform tab 才需要重新整理檢核標紅（不逐鍵重繪）。
function _ftOnCellBlur(rowIdx, colId) {
  let committed = false;
  if (rowIdx != null && colId != null) {
    const focus = _ft._focus;
    const row = _ft.rows[rowIdx];
    if (focus && focus.rowIdx === rowIdx && focus.colId === colId && row) {
      row.cells = row.cells || {};
      const trimmed = _ftTrimCell(row.cells[colId]);
      if (trimmed !== row.cells[colId]) row.cells[colId] = trimmed;
      if (String(trimmed ?? '') !== String(focus.oldValue ?? '')) {
        _ftPushUndo({ removals: [], insertions: [], fieldChanges: [{ rowIdx, kind: 'cell', colId, oldValue: focus.oldValue, newValue: trimmed }] });
        committed = true;
      }
    }
  }
  if (committed || _ft.tab === 'tests' || _ft.tab === 'gform') _ftRenderGrid();
}

function _ftSetFocusCell(rowIdx, colIdx, colId) {
  const row = _ft.rows[rowIdx];
  const oldValue = row && row.cells ? row.cells[colId] : undefined;
  _ft._focus = { rowIdx, colIdx, colId, oldValue };
}

// ══════════════ v208：grid 渲染（CSS Grid＋列虛擬化＋sticky 欄＋檢核標紅）══════════════

// 算一次會在整個渲染過程重複用到的版面/檢核資訊（欄寬、grid-template、sticky offset、檢核結果、
// Google表單重複集合），供 _ftRenderGrid（整版重繪）與 _ftRenderGridWindowOnly（捲動時只重繪可視
// 窗口）共用，避免捲動時重新計算一次 O(n) 檢核。
function _ftBuildRenderCtx() {
  const cols = _ft.schema.cols;
  const colWidths = cols.map(c => c.width || 100);
  // v213：編輯模式才出現「刪除」欄（固定寬度、非資料欄，不進 gridTemplate 的資料欄計算，見
  // _ftRowHtml／_ftRenderGrid 表頭處理）。
  const showDeleteCol = !!_ft.editing;
  if (showDeleteCol) colWidths.push(FT_DELETE_COL_W);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const gridTemplate = colWidths.map(w => w + 'px').join(' ');
  let acc = 0;
  const stickyOffset = {};
  const stickySet = _ftStickyColIds();
  cols.forEach((c, i) => {
    if (stickySet.has(c.id)) stickyOffset[c.id] = acc;
    acc += colWidths[i];
  });
  const needChecks = _ft.tab === 'tests' || _ft.tab === 'gform';
  const checks = needChecks ? _ftComputeCellChecks(_ft.rows, {
    keyColId: 'stu_id',
    nameColId: 'name_zh',
    deptColId: cols.some(c => c.id === 'dept') ? 'dept' : null,
    flagDuplicates: _ft.tab === 'tests', // Google表單的重複已用列底色/刪除線處理，避免雙重視覺
    studentsRows: _ft._studentsCache || [],
    studentsKeyColId: 'stu_id',
    studentsNameColId: 'name_zh',
  }) : null;
  const gformDupKeys = _ft.tab === 'gform' ? _ftFindDuplicateStuIds(_ft.rows, 'stu_id') : new Set();
  // v222：篩選／問題列置頂僅在非編輯模式生效（見上方 _ftComputeDisplayOrder 檔頭風險評估）；
  // 編輯模式或其餘 tab（merged/tutors）一律用原始順序（identity），行為與改版前完全相同。
  const filterActive = !_ft.editing && (_ft.tab === 'students' || _ft.tab === 'tests' || _ft.tab === 'gform');
  const displayOrder = filterActive
    ? _ftComputeDisplayOrder(_ft.rows, _ft.schema, checks, _ft.filterText, _ft.pinIssuesTop)
    : _ft.rows.map((_, i) => i);
  return { cols, colWidths, totalWidth, gridTemplate, stickyOffset, stickySet, checks, gformDupKeys, editing: _ft.editing, showDeleteCol, displayOrder };
}

function _ftHeaderCellHtml(c, ctx) {
  const stickyCss = ctx.stickySet.has(c.id) ? `position:sticky;left:${ctx.stickyOffset[c.id]}px;z-index:6;background:#f7fafc;` : '';
  const longName = c.name && c.name.length > 24;
  const dispName = longName ? escHtml(c.name.slice(0, 22)) + '…' : escHtml(c.name);
  const tip = longName ? ` data-tip="${escHtml(c.name)}"` : '';
  // v215：凍結欄不可再補 position:relative——同屬性後者覆蓋前者，會把 position:sticky 蓋掉，造成
  // 表頭凍結失效、水平捲動時標題列與資料列錯位（sticky 本身即為定位元素，欄寬把手照常運作）。
  return `<div data-col-id="${escHtml(c.id)}" style="${stickyCss || 'position:relative;'}padding:6px 8px;border:1px solid #e2e8f0;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;"${tip}>${dispName}${c.required ? '<span class="req">*</span>' : ''}</div>`;
}

function _ftRowHtml(ri, ctx) {
  const row = _ft.rows[ri];
  if (!row) return '';
  const missing = new Set(_ftRowMissingRequired(row, _ft.schema));
  const rowChecks = ctx.checks ? ctx.checks[ri] : null;
  const stuIdVal = String((row.cells && row.cells.stu_id) ?? '').trim();
  const isGformDup = _ft.tab === 'gform' && !!stuIdVal && ctx.gformDupKeys.has(stuIdVal);
  const isExcluded = row.excluded === true;
  const isPendingDelete = row._pendingDelete === true; // v213：每列軟刪除，存檔前可按「還原」復原
  let rowBg = '';
  if (isGformDup) rowBg = isExcluded ? 'background:#f2f2f2;' : 'background:#fffbea;';
  const rowStyle = `display:grid;grid-template-columns:${ctx.gridTemplate};height:${FT_ROW_H}px;box-sizing:border-box;${rowBg}${(isExcluded || isPendingDelete) ? 'opacity:.55;text-decoration:line-through;' : ''}`;
  const tds = ctx.cols.map((c, ci) => {
    let val = (row.cells && row.cells[c.id]) ?? '';
    // v222：gform ts 欄若仍是 Excel 日期序號的歷史髒資料（例如舊學期匯入未經 v222 轉換），僅在顯示
    // 層轉成可讀日期，不改 row.cells 底層資料（見 _ftExcelSerialToDateString）。
    if (c.id === 'ts' && _ft.tab === 'gform') {
      const disp = _ftExcelSerialToDateString(val);
      if (disp) val = disp;
    }
    const isMissing = missing.has(c.id);
    let cellBg = isMissing ? '#fff5f5' : '';
    let tip = '';
    if (rowChecks) {
      if (c.id === 'stu_id' && (rowChecks.stuIdBad || rowChecks.stuIdDup)) {
        cellBg = '#fed7d7';
        const reasons = [rowChecks.stuIdBad ? rowChecks.stuIdBadReason : null, rowChecks.stuIdDup ? '學號重複' : null].filter(Boolean).join('；');
        tip = ` data-tip="${escHtml(reasons)}"`;
      }
      if (c.id === 'name_zh' && rowChecks.nameMismatch) {
        cellBg = '#fed7d7';
        tip = ` data-tip="與學生基本資料姓名不一致"`;
      }
    }
    const isSticky = ctx.stickySet.has(c.id);
    const stickyCss = isSticky ? `position:sticky;left:${ctx.stickyOffset[c.id]}px;z-index:2;` : '';
    // sticky 欄需要不透明底色才能遮住捲動經過的內容；非 sticky 欄沒有這個顧慮，透明即可。
    const bg = cellBg || (isSticky ? (isGformDup ? (isExcluded ? '#f2f2f2' : '#fffbea') : '#fff') : '');
    const cellStyle = `border:1px solid #e2e8f0;padding:0;box-sizing:border-box;overflow:hidden;${stickyCss}${bg ? `background:${bg};` : ''}`;
    if (ctx.editing && !isExcluded) {
      return `<div style="${cellStyle}"${tip}><input type="text" class="ft-cell-input" data-row="${ri}" data-col="${escHtml(c.id)}" value="${escHtml(String(val))}"
        style="width:100%;height:100%;border:none;padding:5px 8px;font-size:.82rem;background:transparent;box-sizing:border-box;"
        oninput="_ftOnCellInput(${ri},'${c.id}',this.value)"
        onblur="_ftOnCellBlur(${ri},'${c.id}')"
        onfocus="_ftSetFocusCell(${ri},${ci},'${c.id}')"></div>`;
    }
    // v209：整合 tab 唯讀渲染——燈號/高關懷欄位加顏色，方便肉眼快速掃視（純顯示層，不影響資料）。
    const mergedColor = (_ft.tab === 'merged') ? _ftMergedCellColor(c.id, val) : null;
    const textStyle = mergedColor ? ` style="color:${mergedColor};font-weight:600;"` : '';
    return `<div style="${cellStyle}padding:5px 8px;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"${tip}><span${textStyle}>${escHtml(String(val))}</span></div>`;
  }).join('');
  const delCell = ctx.showDeleteCol ? _ftDeleteCellHtml(ri, isPendingDelete) : '';
  return `<div style="${rowStyle}" data-row-idx="${ri}">${tds}${delCell}</div>`;
}

// v213：每列軟刪除鈕（🗑️／↺ 還原）。編輯模式才出現，見 _ftBuildRenderCtx.showDeleteCol；虛擬化
// 窗口重繪（_ftRenderGridWindowOnly）與整版重繪（_ftRenderGrid）都是呼叫同一個 _ftRowHtml，故
// 兩條渲染路徑自動一致，不需要分別處理。
function _ftDeleteCellHtml(ri, isPendingDelete) {
  const label = isPendingDelete ? '↺ 還原' : '🗑️';
  const tip = isPendingDelete ? '還原此列（存檔前變更皆可復原）' : '刪除此列（存檔前可按還原取消）';
  const btnClass = isPendingDelete ? 'btn-secondary' : 'btn-danger';
  return `<div style="border:1px solid #e2e8f0;padding:2px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;">
    <button type="button" class="btn btn-sm ${btnClass}" style="padding:1px 5px;font-size:.76rem;line-height:1.5;" data-tip="${escHtml(tip)}" onclick="_ftToggleRowDelete(${ri})">${label}</button>
  </div>`;
}

// 整合 tab 燈號/高關懷欄位顯示色（純顯示層，不影響底層資料值）。
function _ftMergedCellColor(colId, val) {
  if (colId === 'high_concern') return val === 'v' ? '#c53030' : null;
  if (!colId.endsWith('_dot')) return null;
  if (val === '●') return '#c53030';
  if (val === '◎') return '#dd6b20';
  if (val === '○') return '#b7791f';
  if (val === '☆') return '#2f855a';
  if (val === '數值錯誤') return '#c53030';
  return null;
}

// 整版重繪：資料變更（載入/新增列/貼上/匯入/切換編輯模式/存檔後）呼叫。重新計算渲染上下文＋
// 虛擬化窗口，捲動位置盡量保留（見 savedScrollTop/Left）。
function _ftRenderGrid() {
  const wrap = document.getElementById('ft-grid-wrap');
  if (!wrap || !_ft.schema) return;
  const savedScrollTop = wrap.scrollTop;
  const savedScrollLeft = wrap.scrollLeft;
  const ctx = _ftBuildRenderCtx();
  _ft._renderCtx = ctx;
  const rowCount = ctx.displayOrder.length;
  const viewportHeight = wrap.clientHeight || 400;
  const vwin = _ftComputeVirtualWindow(savedScrollTop, viewportHeight, rowCount, FT_ROW_H, FT_VWIN_BUFFER);
  _ft._vwin = vwin;

  const headerCellsHtml = ctx.cols.map(c => _ftHeaderCellHtml(c, ctx)).join('')
    + (ctx.showDeleteCol ? `<div style="position:sticky;top:0;padding:6px 4px;border:1px solid #e2e8f0;font-size:.8rem;text-align:center;box-sizing:border-box;background:#f7fafc;">刪除</div>` : '');
  const rowsHtml = [];
  for (let di = vwin.startIdx; di < vwin.endIdx; di++) rowsHtml.push(_ftRowHtml(ctx.displayOrder[di], ctx));
  // v222：區分「真的沒有資料」與「篩選條件下沒有符合的列」兩種空狀態提示。
  const emptyMsg = (_ft.rows.length && !ctx.displayOrder.length)
    ? `<div style="padding:20px;text-align:center;color:#a0aec0;">篩選條件下沒有符合的資料列</div>`
    : `<div style="padding:20px;text-align:center;color:#a0aec0;">尚無資料，可點「＋新增列」或匯入 Excel/CSV</div>`;

  wrap.innerHTML = `
    <div id="ft-grid-header" style="display:grid;grid-template-columns:${ctx.gridTemplate};position:sticky;top:0;z-index:5;background:#f7fafc;width:${ctx.totalWidth}px;">${headerCellsHtml}</div>
    <div id="ft-grid-canvas" style="position:relative;width:${ctx.totalWidth}px;height:${vwin.totalHeight}px;">
      <div id="ft-grid-window" style="position:absolute;left:0;top:${vwin.offsetY}px;width:100%;">
        ${rowsHtml.join('') || emptyMsg}
      </div>
    </div>`;
  wrap.scrollTop = savedScrollTop;
  wrap.scrollLeft = savedScrollLeft;
  wrap.querySelectorAll('[data-col-id]').forEach(el => _ftInitColResize(el, el.dataset.colId));
  _ftBindGridScroll(wrap);
  _ftInitTopScrollbar(document.getElementById('ft-grid-topscroll'), document.getElementById('ft-grid-topscroll-spacer'), wrap, ctx.totalWidth);
  if (_ft.tab === 'gform') _ftRenderGformDupBar();
  _ftSyncFilterToolbarUi();
}

// 捲動時的輕量重繪：沿用上次的渲染上下文，只重新產生可視窗口內的列（不重繪表頭、不重算檢核），
// 且窗口範圍未變時直接跳過（避免同一窗口內小幅捲動也重繪）。
function _ftRenderGridWindowOnly(wrap) {
  if (!_ft.schema || !_ft._renderCtx) return;
  const ctx = _ft._renderCtx;
  const rowCount = ctx.displayOrder.length;
  const viewportHeight = wrap.clientHeight || 400;
  const vwin = _ftComputeVirtualWindow(wrap.scrollTop, viewportHeight, rowCount, FT_ROW_H, FT_VWIN_BUFFER);
  if (_ft._vwin && _ft._vwin.startIdx === vwin.startIdx && _ft._vwin.endIdx === vwin.endIdx) return;
  _ft._vwin = vwin;
  const win = document.getElementById('ft-grid-window');
  if (!win) return;
  win.style.top = vwin.offsetY + 'px';
  const rowsHtml = [];
  for (let di = vwin.startIdx; di < vwin.endIdx; di++) rowsHtml.push(_ftRowHtml(ctx.displayOrder[di], ctx));
  win.innerHTML = rowsHtml.join('') || `<div style="padding:20px;text-align:center;color:#a0aec0;">尚無資料，可點「＋新增列」或匯入 Excel/CSV</div>`;
}

// 捲動監聽只綁一次（用 wrap 節點上的旗標判斷，因為 wrap.innerHTML 每次整版重繪都會換掉內部節點，
// 但 wrap 本身不會被替換）；用 requestAnimationFrame 節流，避免同一畫面更新週期內重複計算。
function _ftBindGridScroll(wrap) {
  if (wrap._ftScrollBound) return;
  wrap._ftScrollBound = true;
  let raf = null;
  wrap.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      _ftRenderGridWindowOnly(wrap);
    });
  });
}

// v222：頂部同步水平捲軸（通用工具，非 _ft 命名空間專屬——見 _ftRenderGrid／_ftRenderStatsSub 呼叫
// 端，供資料 grid 與統計 tab 表格共用）。topEl 內放一個等寬 spacer div 撐出可捲動寬度，topEl／mainEl
// 互相同步 scrollLeft；用 syncing 旗標防止「A 觸發 B、B 又觸發 A」的事件迴圈。topEl／mainEl 兩者本身
// 皆為持久節點（innerHTML 局部重繪不會把它們整個換掉），故綁定旗標放在節點上、只需綁一次。
function _ftInitTopScrollbar(topEl, spacerEl, mainEl, totalWidth) {
  if (!topEl || !spacerEl || !mainEl) return;
  spacerEl.style.width = totalWidth + 'px';
  if (mainEl._ftTopScrollBound) return;
  mainEl._ftTopScrollBound = true;
  let syncing = false;
  topEl.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    mainEl.scrollLeft = topEl.scrollLeft;
    syncing = false;
  });
  mainEl.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    topEl.scrollLeft = mainEl.scrollLeft;
    syncing = false;
  });
}

// 欄寬拖曳調整（僅寬度，不含拖曳排序——排序在「欄位管理」modal 內用 _scdInitDrag，見下方）。
// 因欄位版面改用 CSS Grid（grid-template-columns），拖曳過程直接即時更新表頭/canvas/可視列的
// grid-template-columns 字串，放開後才呼叫 ftSaveSchema 落地寬度設定。
function _ftInitColResize(el, colId) {
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:col-resize;z-index:7;';
  el.appendChild(handle);
  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const startX = ev.clientX;
    const ctx = _ft._renderCtx;
    if (!ctx) return;
    const idx = ctx.cols.findIndex(c => c.id === colId);
    if (idx === -1) return;
    const startW = ctx.colWidths[idx];
    const onMove = (e2) => {
      const w = Math.max(50, startW + (e2.clientX - startX));
      ctx.colWidths[idx] = w;
      ctx.gridTemplate = ctx.colWidths.map(x => x + 'px').join(' ');
      ctx.totalWidth = ctx.colWidths.reduce((a, b) => a + b, 0);
      const header = document.getElementById('ft-grid-header');
      const canvas = document.getElementById('ft-grid-canvas');
      if (header) { header.style.gridTemplateColumns = ctx.gridTemplate; header.style.width = ctx.totalWidth + 'px'; }
      if (canvas) canvas.style.width = ctx.totalWidth + 'px';
      document.querySelectorAll('#ft-grid-window > [data-row-idx]').forEach(r => { r.style.gridTemplateColumns = ctx.gridTemplate; });
      // v222：欄寬拖曳過程中頂部同步捲軸的 spacer 寬度也要跟著調整，否則兩條捲軸可捲動範圍不一致。
      const topSpacer = document.getElementById('ft-grid-topscroll-spacer');
      if (topSpacer) topSpacer.style.width = ctx.totalWidth + 'px';
      _ft.pendingColWidths = _ft.pendingColWidths || {};
      _ft.pendingColWidths[colId] = w;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      _ftPersistColWidths();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

async function _ftPersistColWidths() {
  if (!_ft.pendingColWidths || !_ft.schema) return;
  const widths = _ft.pendingColWidths;
  _ft.pendingColWidths = null;
  const sheet = _ftCurrentSheet();
  const cols = _ft.schema.cols.map(c => (widths[c.id] ? { ...c, width: widths[c.id] } : c));
  try {
    const r = await proxyCall('ftSaveSchema', { semester: _ft.semester, sheet, cols });
    _ft.schema = r.schema;
    _ftRenderGrid();
  } catch (e) {
    showToast('欄寬儲存失敗：' + e.message, 'error');
  }
}

// 貼上（Excel 複製多列多欄）：僅編輯模式下、焦點在試算表儲存格內時生效，從目前焦點格開始鋪，
// 超出現有列數自動增列（見 _ftApplyPasteToRows）。掛在 document 上（比照 _ckg／tooltip 既有的
// module-level 事件委派慣例），一次註冊即可涵蓋 grid 重繪後的新 DOM 節點。
// v213：貼上前先算欄數是否超出容納範圍（規格⑤，超出則 confirm）；貼上內容逐格 trim（規格③）；
// 套用後與套用前的 rows 做 diff，推入一筆 undo 交易（規格①）。
document.addEventListener('paste', (ev) => {
  const active = document.activeElement;
  if (!_ft.editing || !active || !active.classList || !active.classList.contains('ft-cell-input')) return;
  const text = (ev.clipboardData || window.clipboardData)?.getData('text');
  if (text == null) return;
  const grid = _ftParsePasteText(text);
  if (!grid.length) return;
  ev.preventDefault();
  const rowIdx = Number(active.dataset.row);
  const colId = active.dataset.col;
  const colIds = _ft.schema.cols.map(c => c.id);
  const colIdx = colIds.indexOf(colId);
  if (colIdx === -1) return;
  const pasteColCount = grid.reduce((m, line) => Math.max(m, line.length), 0);
  const overflowInfo = _ftPasteOverflowInfo(colIds.length, colIdx, pasteColCount);
  if (overflowInfo.overflow > 0) {
    if (!confirm(`貼上資料有 ${overflowInfo.needed} 欄，目前位置起僅能容納 ${overflowInfo.available} 欄，超出部分將被捨棄。是否繼續？`)) return;
  }
  const trimmedGrid = grid.map(line => line.map(v => _ftTrimCell(v)));
  const before = _ft.rows;
  const after = _ftApplyPasteToRows(before, colIds, rowIdx, colIdx, trimmedGrid);
  _ftEnsureRowUids(after);
  const tx = _ftDiffRowsForTransaction(before, after);
  _ft.rows = after;
  _ftPushUndo(tx);
  _ftMarkDirty();
  _ftRenderGrid();
});

// v216：改掛在 document 上，而非 #page-freshman-test 容器上。原本掛在容器節點上是靠事件冒泡
// 接收 keydown，但 _ftUndo() 會呼叫 _ftRenderGrid() 整版重繪，把原本聚焦的 .ft-cell-input 從
// DOM 移除，瀏覽器此時會把 focus 退回 document.body——下一次 keydown 的 event.target 就是
// body（在 #page-freshman-test 之外），DOM 事件只會往上冒泡到祖先、不會往下傳給子孫節點的
// 監聽器，掛在 #page-freshman-test（body 的子孫）上的監聽器因此永遠收不到，導致連按第二下
// 開始沒反應。改掛在 document 上可涵蓋任何 focus 落點；頁面範圍與其他編輯器互斥改由
// _ftHandleUndoRedoKeydown 函式內部的守門條件負責（見上方函式註解），一次註冊即可（頁面本身
// 是靜態 HTML、不會被整個替換掉，不需要每次 render 重新綁定）。
document.addEventListener('keydown', _ftHandleUndoRedoKeydown);

// ══════════════ 匯入（Excel/CSV）══════════════

// v213：讀出 aoa 後先做欄位自動對應（規格④）——全部精確命中才照舊直接進暫存流程；只要有一欄
// 「有內容但對不上」就跳「欄位對照」modal，交使用者手動決定每欄的對應方式，見
// _ftRenderColumnMappingModal／_ftConfirmColumnMapping。
async function _ftHandleImportFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!aoa.length) { showToast('檔案內容為空', 'warn'); return; }
    const header = (aoa[0] || []).map(h => (h == null ? '' : h));
    const mapping = _ftAutoMapImportHeaders(header, _ft.schema.cols);
    if (!_ftImportNeedsMapping(mapping)) {
      _ftProceedImport(aoa);
    } else {
      _ft._importMapping = { aoa, header, mapping, sortMode: 'file', userChoices: {} }; // v223 A：排序切換狀態
      _ftRenderColumnMappingModal();
    }
  } catch (e) {
    if (e.xlsxCancelled) { showToast(e.message, 'warning'); return; }
    showToast('匯入失敗：' + e.message, 'error');
  }
}

// 欄位對照（若有）確認完成，或原本就全部精確對映時，走既有匯入流程（gform tab 不走衝突勾選
// modal，其餘 tab 走 _ftPreviewImport 衝突預覽 modal，皆為 Slice 2 既有邏輯，本次未變）。
function _ftProceedImport(aoa) {
  if (_ft.tab === 'gform') _ftGformImportFromAoa(aoa);
  else _ftPreviewImport(aoa);
}

// Google表單 tab 專用匯入：不走衝突勾選 modal，完全相同列靜默跳過、其餘一律新增（見
// _ftGformMergeImport 檔頭說明——同學號多筆是常態，不是需要人工判斷取代/保留的欄位衝突）。
// v213：套用結果與套用前 diff 出一筆 undo 交易（規格①「匯入暫存進 grid」）。
function _ftGformImportFromAoa(aoa) {
  const importRows = _ftAoaToImportRows(aoa, _ft.schema.cols);
  const keyColId = 'stu_id';
  const missingKey = importRows.filter(r => !r.cells[keyColId]);
  const usable = importRows.filter(r => r.cells[keyColId]);
  if (!usable.length) {
    showToast(`未偵測到有效資料列（共 ${missingKey.length} 列缺少學號或欄名不符），請確認標題列與現有欄位名稱一致`, 'warn');
    return;
  }
  const before = _ft.rows;
  const merged = _ftGformMergeImport(before, usable);
  const after = merged.rows;
  _ftEnsureRowUids(after);
  const tx = _ftDiffRowsForTransaction(before, after);
  _ft.rows = after;
  if (!_ft.editing) _ftEnterEdit();
  _ftPushUndo(tx);
  _ftMarkDirty();
  _ftRenderGrid();
  showToast(`已新增 ${merged.addedCount} 筆、略過 ${merged.skippedCount} 筆完全重複${missingKey.length ? `，另有 ${missingKey.length} 列缺少學號已略過` : ''}。同學號但內容不同的列會標記為重複狀態，請於上方「選主條目」處理。`, 'info');
}

function _ftPreviewImport(aoa) {
  const importRows = _ftAoaToImportRows(aoa, _ft.schema.cols);
  const keyColId = 'stu_id';
  const missingKey = importRows.filter(r => !r.cells[keyColId]);
  const usable = importRows.filter(r => r.cells[keyColId]);
  if (!usable.length) {
    showToast(`未偵測到有效資料列（共 ${missingKey.length} 列缺少學號或欄名不符），請確認標題列與現有欄位名稱一致`, 'warn');
    return;
  }
  const detect = _ftDetectImportConflicts(_ft.rows, usable, keyColId);
  _ft.importPreview = { detect, missingKeyCount: missingKey.length };
  _ftShowImportSummaryBar(detect, missingKey.length);
}

// ══════════════ v223 C：匯入衝突摘要條 + 統一處理視窗（UI）══════════════
// 取代舊版 _ftRenderImportModal 的「逐列勾選取代」modal（需求一.6/6-1/6-2）：
//   一.6   衝突很多會擋畫面 → 平時只在工具列下方顯示一條「摘要條」（可收合），不強制跳窗。
//   一.6-1 不用逐列處理 → 摘要條上一顆批次「🔧 處理衝突」按鈕，按了才進統一處理視窗。
//   一.6-2 統一視窗＝試算表式：每筆同學號衝突並排「現有 / 匯入」，可決定採用哪一版（誰留），
//          留下的最終值一格一格可再編輯；大量衝突分頁（見 _ftImportResolvePageSlice）。
// 無衝突時摘要條直接給「確認匯入」鈕（走 _ftApplyImportDirect），不必開視窗。

function _ftHideImportSummaryBar() {
  const bar = document.getElementById('ft-import-summary-bar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  _ft.importPreview = null;
}

function _ftShowImportSummaryBar(detect, missingKeyCount) {
  const bar = document.getElementById('ft-import-summary-bar');
  if (!bar) return;
  const nNew = detect.newRows.length, nSame = detect.unchanged.length, nConf = detect.conflicts.length;
  const missNote = missingKeyCount ? `，另有 ${missingKeyCount} 列缺少學號已略過` : '';
  const actionBtn = nConf
    ? `<button class="btn btn-primary btn-sm" onclick="_ftOpenImportResolveModal()">🔧 處理衝突（${nConf}）</button>`
    : `<button class="btn btn-primary btn-sm" onclick="_ftApplyImportDirect()">✅ 確認匯入（新增 ${nNew} 筆）</button>`;
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-weight:600;">📥 匯入解析完成</span>
      <span style="color:#2b6cb0;">新增 <strong>${nNew}</strong></span>
      <span style="color:#718096;">無異動 <strong>${nSame}</strong></span>
      <span style="color:${nConf ? '#c05621' : '#718096'};">衝突 <strong>${nConf}</strong></span>
      <span style="color:#a0aec0;font-size:.8rem;">${escHtml(missNote)}</span>
      <span style="flex:1 1 auto;"></span>
      ${actionBtn}
      <button class="btn btn-secondary btn-sm" onclick="_ftHideImportSummaryBar()">取消</button>
    </div>
    ${nConf ? `<div style="margin-top:6px;font-size:.78rem;color:#718096;">同一學號在現有資料與匯入檔都有、但欄位內容不同的筆數；按「處理衝突」逐筆決定保留哪一版、可就地編輯。</div>` : ''}`;
  bar.style.display = 'block';
}

// 無衝突：直接把新增列套進試算表（走與統一視窗相同的純函式，resolvedGroups 傳空陣列）。
function _ftApplyImportDirect() {
  const detect = _ft.importPreview && _ft.importPreview.detect;
  if (!detect) return;
  const before = _ft.rows;
  const after = _ftBuildImportFinalRowsFromGroups(before, detect.newRows, []);
  _ftEnsureRowUids(after);
  const tx = _ftDiffRowsForTransaction(before, after);
  _ft.rows = after;
  if (!_ft.editing) _ftEnterEdit();
  _ftPushUndo(tx);
  _ftMarkDirty();
  _ftRenderGrid();
  _ftHideImportSummaryBar();
  showToast('匯入內容已套用到試算表，請確認後按「儲存」才會寫入伺服器', 'info');
}

// 統一處理視窗狀態：choices[i]＝該衝突要採用哪一版（'incoming' 匯入／'existing' 現有）；
// edits[i]＝{colId:值} 使用者就地改過的最終值（覆蓋 choices 的預設）。
function _ftOpenImportResolveModal() {
  const detect = _ft.importPreview && _ft.importPreview.detect;
  if (!detect || !detect.conflicts.length) return;
  _ft._importResolve = { page: 0, pageSize: 50, choices: {}, edits: {} };
  detect.conflicts.forEach((_, i) => { _ft._importResolve.choices[i] = 'incoming'; _ft._importResolve.edits[i] = {}; });
  _ftRenderImportResolveModal();
}

// 取某衝突組某欄位的「最終值」：使用者改過用改過的，否則依 choices 取匯入/現有值。
function _ftImportResolveFinalVal(i, colId) {
  const st = _ft._importResolve;
  const c = _ft.importPreview.detect.conflicts[i];
  if (st.edits[i] && Object.prototype.hasOwnProperty.call(st.edits[i], colId)) return st.edits[i][colId];
  const src = st.choices[i] === 'existing' ? c.existing : c.incoming;
  return (src.cells || {})[colId] ?? '';
}

function _ftRenderImportResolveModal() {
  const detect = _ft.importPreview && _ft.importPreview.detect;
  const st = _ft._importResolve;
  if (!detect || !st) return;
  document.getElementById('ft-import-resolve-modal')?.remove();
  const total = detect.conflicts.length;
  const totalPages = _ftImportResolveTotalPages(total, st.pageSize);
  if (st.page >= totalPages) st.page = totalPages - 1;
  const pageGroups = _ftImportResolvePageSlice(detect.conflicts, st.page, st.pageSize);
  const startIdx = st.page * st.pageSize;
  const colName = (id) => { const col = _ft.schema.cols.find(x => x.id === id); return col ? col.name : id; };
  const blocks = pageGroups.map((c, k) => {
    const i = startIdx + k;
    const chosenIncoming = st.choices[i] === 'incoming';
    const diffRows = c.diffCols.map(colId => {
      const ev = String((c.existing.cells || {})[colId] ?? '');
      const iv = String((c.incoming.cells || {})[colId] ?? '');
      const fv = String(_ftImportResolveFinalVal(i, colId));
      return `<tr>
        <td style="padding:3px 6px;font-weight:600;white-space:nowrap;">${escHtml(colName(colId))}</td>
        <td style="padding:3px 6px;color:#a0aec0;">${escHtml(ev)}</td>
        <td style="padding:3px 6px;color:#2b6cb0;">${escHtml(iv)}</td>
        <td style="padding:3px 6px;"><input type="text" value="${escHtml(fv)}" style="width:100%;box-sizing:border-box;padding:2px 5px;border:1px solid #cbd5e0;border-radius:4px;font-size:.82rem;" oninput="_ftImportResolveEditCell(${i}, '${escHtml(colId)}', this.value)"></td>
      </tr>`;
    }).join('');
    return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
        <strong style="font-size:.86rem;">學號 ${escHtml(c.key)}</strong>
        <span style="flex:1 1 auto;"></span>
        <button class="btn btn-sm ${chosenIncoming ? 'btn-primary' : 'btn-secondary'}" onclick="_ftImportResolveSetChoice(${i}, 'incoming')" data-tip="採用匯入檔的值取代現有資料（留下匯入版）">採用匯入</button>
        <button class="btn btn-sm ${!chosenIncoming ? 'btn-primary' : 'btn-secondary'}" onclick="_ftImportResolveSetChoice(${i}, 'existing')" data-tip="保留現有資料、忽略此筆匯入（留下現有版）">保留現有</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
        <thead><tr style="color:#718096;text-align:left;">
          <th style="padding:2px 6px;">欄位</th><th style="padding:2px 6px;">現有值</th><th style="padding:2px 6px;">匯入值</th><th style="padding:2px 6px;width:34%;">最終值（可編輯）</th>
        </tr></thead>
        <tbody>${diffRows}</tbody>
      </table>
    </div>`;
  }).join('');
  const pager = totalPages > 1 ? `
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px;font-size:.84rem;">
      <button class="btn btn-secondary btn-sm" ${st.page <= 0 ? 'disabled' : ''} onclick="_ftImportResolveGoPage(${st.page - 1})">‹ 上一頁</button>
      <span>第 ${st.page + 1} / ${totalPages} 頁（共 ${total} 筆）</span>
      <button class="btn btn-secondary btn-sm" ${st.page >= totalPages - 1 ? 'disabled' : ''} onclick="_ftImportResolveGoPage(${st.page + 1})">下一頁 ›</button>
    </div>` : '';
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-import-resolve-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:820px;">
      <div class="modal-header"><h3>處理匯入衝突（${total} 筆）</h3></div>
      <div class="modal-body" style="max-height:64vh;overflow:auto;">
        <p style="font-size:.82rem;color:#718096;margin-bottom:10px;">每筆同學號在現有與匯入檔內容不同。預設採用匯入值，可切換「保留現有」，或直接在「最終值」就地編輯。確認後套進試算表（尚未寫入伺服器，需按「儲存」）。</p>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" onclick="_ftImportResolveSetAll('incoming')">全部採用匯入</button>
          <button class="btn btn-secondary btn-sm" onclick="_ftImportResolveSetAll('existing')">全部保留現有</button>
        </div>
        ${blocks}
        ${pager}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-import-resolve-modal').remove();">取消</button>
        <button class="btn btn-primary" onclick="_ftConfirmImportResolve()">確認匯入</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _ftImportResolveSetChoice(i, choice) {
  const st = _ft._importResolve;
  if (!st) return;
  st.choices[i] = choice;
  st.edits[i] = {}; // 切換版本時，清掉該組先前的就地編輯，回到所選版本的原值
  _ftRenderImportResolveModal();
}

function _ftImportResolveSetAll(choice) {
  const st = _ft._importResolve, detect = _ft.importPreview && _ft.importPreview.detect;
  if (!st || !detect) return;
  detect.conflicts.forEach((_, i) => { st.choices[i] = choice; st.edits[i] = {}; });
  _ftRenderImportResolveModal();
}

function _ftImportResolveEditCell(i, colId, val) {
  const st = _ft._importResolve;
  if (!st) return;
  if (!st.edits[i]) st.edits[i] = {};
  st.edits[i][colId] = val;
}

function _ftImportResolveGoPage(p) {
  const st = _ft._importResolve;
  if (!st) return;
  st.page = p;
  _ftRenderImportResolveModal();
}

function _ftConfirmImportResolve() {
  const detect = _ft.importPreview && _ft.importPreview.detect;
  const st = _ft._importResolve;
  document.getElementById('ft-import-resolve-modal')?.remove();
  if (!detect || !st) return;
  const resolvedGroups = detect.conflicts.map((c, i) => {
    const workingCells = { ...(c.existing.cells || {}) };
    c.diffCols.forEach(colId => { workingCells[colId] = _ftImportResolveFinalVal(i, colId); });
    return { existing: c.existing, workingCells };
  });
  const before = _ft.rows;
  const after = _ftBuildImportFinalRowsFromGroups(before, detect.newRows, resolvedGroups);
  _ftEnsureRowUids(after);
  const tx = _ftDiffRowsForTransaction(before, after);
  _ft.rows = after;
  if (!_ft.editing) _ftEnterEdit();
  _ftPushUndo(tx);
  _ftMarkDirty();
  _ftRenderGrid();
  _ftHideImportSummaryBar();
  _ft._importResolve = null;
  showToast('匯入內容已套用到試算表，請確認後按「儲存」才會寫入伺服器', 'info');
}

// ══════════════ v213：匯入欄位對照（規格④）══════════════
// 觸發時機：_ftHandleImportFile 偵測到匯入表頭有欄位「有內容但對不上」現有欄位時（見
// _ftAutoMapImportHeaders／_ftImportNeedsMapping）。使用者確認對照結果後，本模組把匯入檔案的
// 表頭「改寫」成對應到的現有欄位名稱（未對應→空字串），再走既有 _ftAoaToImportRows（依欄名
// 精確比對）與既有匯入流程（_ftProceedImport）——不需要另外重寫一套依 colId 匯入的路徑。
// 「新增為新欄位」會先呼叫 ftSaveSchema 落地新欄位（比照欄位管理「新增」機制，colId 用同一個
// _ftGenColId 產生器），成功後才繼續匯入資料本身。
function _ftRenderColumnMappingModal() {
  const state = _ft._importMapping;
  if (!state) return;
  const cols = _ft.schema.cols;
  const mappedColIds = new Set(state.mapping.filter(m => m.colId).map(m => m.colId));
  const unmatchedExisting = cols.filter(c => !mappedColIds.has(c.id));
  const sortMode = state.sortMode || 'file';
  const userChoices = state.userChoices || {};
  // v223 A：排序切換——「需要處理的欄位置頂」模式下，把還沒被解決（原本對不上、使用者也還沒
  // 明確選過）的欄位排到最前面，方便欄位很多時第一眼就能鎖定要處理的項目（見
  // _ftColumnMappingDisplayOrder／_ftColMapEntryResolved 純函式）。
  const needsWorkFlags = state.header.map((_, idx) => !_ftColMapEntryResolved(state.mapping[idx], userChoices[idx] != null ? userChoices[idx] : null));
  const order = _ftColumnMappingDisplayOrder(needsWorkFlags, sortMode);
  const rowsHtml = order.map((idx) => {
    const h = state.header[idx];
    const m = state.mapping[idx];
    const previewVals = [1, 2]
      .map(r => (state.aoa[r] ? state.aoa[r][idx] : ''))
      .map(v => (v == null ? '' : String(v)))
      .filter(v => v !== '');
    const preview = previewVals.length ? escHtml(previewVals.join('、')) : '<span style="color:#a0aec0;">（無資料）</span>';
    const chosen = userChoices[idx] != null ? userChoices[idx] : (m.colId || '__ignore__');
    const options = [
      `<option value="__ignore__" ${chosen === '__ignore__' ? 'selected' : ''}>❌ 忽略此欄</option>`,
      `<option value="__new__" ${chosen === '__new__' ? 'selected' : ''}>➕ 新增為新欄位</option>`,
    ].concat(cols.map(c => `<option value="${escHtml(c.id)}" ${chosen === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`));
    return `<tr${needsWorkFlags[idx] ? ' style="background:#fffaf0;"' : ''}>
      <td>${escHtml(h || '（無標題）')}</td>
      <td style="color:#718096;font-size:.8rem;">${preview}</td>
      <td><select class="field-select ft-colmap-select" data-idx="${idx}" style="max-width:220px;" onchange="_ftOnColMapSelectChange(this)">${options.join('')}</select></td>
    </tr>`;
  }).join('');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-colmap-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header"><h3>欄位對照</h3></div>
      <div class="modal-body" style="max-height:65vh;overflow:auto;">
        <p style="font-size:.86rem;color:#4a5568;">匯入檔案的欄位名稱與現有欄位不完全相符，請確認每一欄的對應方式後再匯入。</p>
        <div style="margin-bottom:10px;display:flex;align-items:center;gap:6px;font-size:.82rem;flex-wrap:wrap;">
          <span style="color:#718096;">排序：</span>
          <button type="button" class="btn btn-sm ${sortMode !== 'issues' ? 'btn-primary' : 'btn-secondary'}" onclick="_ftSetColMapSortMode('file')">照檔案欄位順序</button>
          <button type="button" class="btn btn-sm ${sortMode === 'issues' ? 'btn-primary' : 'btn-secondary'}" onclick="_ftSetColMapSortMode('issues')">需要處理的欄位置頂</button>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          <thead><tr><th>匯入欄名</th><th>預覽值（前 2 筆）</th><th>對應到</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${unmatchedExisting.length ? `<p style="margin-top:10px;font-size:.8rem;color:#c05621;">未對應的現有欄位（不強制處理）：${unmatchedExisting.map(c => escHtml(c.name)).join('、')}</p>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-colmap-modal').remove();_ft._importMapping=null;">取消</button>
        <button class="btn btn-primary" onclick="_ftConfirmColumnMapping()">確認</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// 記錄使用者對某欄的明確選擇（不立即重繪——避免每次選完跳動位置；下次排序切換或確認時讀取）。
function _ftOnColMapSelectChange(sel) {
  const state = _ft._importMapping;
  if (!state) return;
  const idx = Number(sel.dataset.idx);
  state.userChoices = state.userChoices || {};
  state.userChoices[idx] = sel.value;
}

// 切換「欄位對照」modal 的排序模式（見 _ftColumnMappingDisplayOrder），重繪整個 modal。
function _ftSetColMapSortMode(mode) {
  const state = _ft._importMapping;
  if (!state) return;
  state.sortMode = mode;
  _ftRenderColumnMappingModal();
}

async function _ftConfirmColumnMapping() {
  const state = _ft._importMapping;
  if (!state) return;
  const selects = Array.from(document.querySelectorAll('.ft-colmap-select'));
  const chosen = selects.map(sel => ({ idx: Number(sel.dataset.idx), value: sel.value }));
  // 同一個現有欄位被選兩次要擋（規格④）。
  const usedExisting = new Set();
  for (const c of chosen) {
    if (c.value !== '__ignore__' && c.value !== '__new__') {
      if (usedExisting.has(c.value)) { showToast('有現有欄位被對應了兩次，請修正後再確認', 'warn'); return; }
      usedExisting.add(c.value);
    }
  }
  let cols = _ft.schema.cols;
  let schemaChanged = false;
  const finalColIdByIdx = {};
  chosen.forEach((c) => {
    if (c.value === '__ignore__') {
      finalColIdByIdx[c.idx] = null;
    } else if (c.value === '__new__') {
      const name = _ftTrimCell(state.header[c.idx]) || `匯入欄位${c.idx + 1}`;
      const id = _ftGenColId(cols.map(x => x.id));
      cols = cols.concat([{ id, name, required: false }]);
      finalColIdByIdx[c.idx] = id;
      schemaChanged = true;
    } else {
      finalColIdByIdx[c.idx] = c.value;
    }
  });
  if (schemaChanged) {
    try {
      const sheet = _ftCurrentSheet();
      const r = await proxyCall('ftSaveSchema', { semester: _ft.semester, sheet, cols });
      _ft.schema = r.schema;
    } catch (e) {
      showToast('新增欄位失敗：' + e.message, 'error');
      return;
    }
  }
  const colNameById = new Map(_ft.schema.cols.map(c => [c.id, c.name]));
  const newHeader = state.header.map((h, idx) => {
    const colId = finalColIdByIdx[idx];
    return colId ? (colNameById.get(colId) || '') : '';
  });
  const newAoa = [newHeader, ...state.aoa.slice(1)];
  document.getElementById('ft-colmap-modal')?.remove();
  _ft._importMapping = null;
  _ftProceedImport(newAoa);
}

// ══════════════ v208：Google表單同學號多筆填寫——選主條目 ══════════════

// 上方橫幅列出所有「重複狀態」學號（groupRows.length>1），每個學號一個按鈕開啟選主條目 modal；
// 已解決（僅一筆非 excluded）仍保留列出（淡化＋打勾），方便事後回頭調整。
function _ftRenderGformDupBar() {
  const bar = document.getElementById('ft-gform-dup-bar');
  if (!bar) return;
  const dupKeys = _ftFindDuplicateStuIds(_ft.rows, 'stu_id');
  if (!dupKeys.size) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = '';
  const chips = Array.from(dupKeys).map(key => {
    const groupRows = _ft.rows.filter(r => String((r.cells || {}).stu_id || '').trim() === key);
    const resolved = groupRows.filter(r => r.excluded !== true).length === 1;
    return `<button type="button" class="btn btn-secondary btn-sm" style="margin:2px 6px 2px 0;${resolved ? 'opacity:.65;' : ''}" onclick="_ftShowGformDupModal('${escHtml(key)}')">${resolved ? '✓' : '⚠'} 學號 ${escHtml(key)}（${groupRows.length} 筆）選主條目</button>`;
  }).join('');
  bar.innerHTML = `<div style="font-size:.82rem;color:#744210;margin-bottom:4px;">偵測到下列學號有多筆填寫紀錄（重複狀態，已於表格中標色），請選擇主條目：</div>${chips}`;
}

function _ftShowGformDupModal(key) {
  const groupRows = _ft.rows.filter(r => String((r.cells || {}).stu_id || '').trim() === key);
  if (!groupRows.length) return;
  _ft._gformDupGroupRows = groupRows;
  const diffCols = _ftGroupDiffCols(groupRows);
  const cols = _ft.schema.cols;
  let primaryIdx = groupRows.findIndex(r => r.excluded !== true);
  if (primaryIdx === -1) primaryIdx = 0;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-gform-dup-modal';
  const rowsHtml = groupRows.map((r, i) => {
    const cells = r.cells || {};
    const diffHtml = diffCols.map(colId => {
      const col = cols.find(c => c.id === colId);
      const name = col ? col.name : colId;
      return `<div><strong>${escHtml(name)}</strong>：${escHtml(String(cells[colId] ?? ''))}</div>`;
    }).join('') || '<span style="color:#a0aec0;">（各欄皆相同）</span>';
    return `<tr>
      <td style="text-align:center;"><input type="radio" name="ft-gform-dup-radio" value="${i}" ${i === primaryIdx ? 'checked' : ''}></td>
      <td>${escHtml(String(cells.ts ?? ''))}</td>
      <td>${diffHtml}</td>
    </tr>`;
  }).join('');
  modal.innerHTML = `
    <div class="modal-box" style="max-width:720px;">
      <div class="modal-header"><h3>選主條目（學號 ${escHtml(key)}）</h3></div>
      <div class="modal-body" style="max-height:60vh;overflow:auto;">
        <p style="font-size:.86rem;color:#4a5568;">此學號共有 ${groupRows.length} 筆填寫紀錄，請選擇一筆為主條目。其餘列不會被刪除，僅標記為非主條目（表格中以淡化＋刪除線顯示），日後整合僅取主條目。</p>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          <thead><tr><th style="text-align:center;">主條目</th><th>時間戳記</th><th>差異欄位</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-gform-dup-modal').remove();">取消</button>
        <button class="btn btn-primary" onclick="_ftConfirmGformPrimary()">確認</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _ftConfirmGformPrimary() {
  const radio = document.querySelector('input[name="ft-gform-dup-radio"]:checked');
  if (!radio) { showToast('請選擇一筆為主條目', 'warn'); return; }
  const idx = Number(radio.value);
  const groupRows = _ft._gformDupGroupRows || [];
  const primaryRow = groupRows[idx];
  if (!primaryRow) return;
  _ft.rows = _ftApplyPrimarySelection(_ft.rows, groupRows, primaryRow);
  document.getElementById('ft-gform-dup-modal')?.remove();
  if (!_ft.editing) _ftEnterEdit();
  _ftMarkDirty();
  _ftRenderGrid();
  showToast('已設定主條目，請記得按「儲存」寫入伺服器', 'success');
}

// ══════════════ 欄位管理 ══════════════

function _ftShowColumnManager() {
  if (!_ft.schema) return;
  _ft._colmgrDraft = _ft.schema.cols.map(c => ({ ...c }));
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-colmgr-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:560px;">
      <div class="modal-header"><h3>欄位管理</h3></div>
      <div class="modal-body">
        <p style="font-size:.8rem;color:#718096;margin-bottom:8px;">拖曳 ⠿ 調整順序；刪除欄位不會刪除既有列的資料，只是不再顯示（見學號固定不可刪）。</p>
        <div id="ft-colmgr-list" style="max-height:50vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:6px;"></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <input type="text" id="ft-colmgr-new-name" class="field-input" placeholder="新欄位名稱">
          <button class="btn btn-secondary btn-sm" onclick="_ftColmgrAddCol()">＋新增欄位</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-colmgr-modal').remove();">取消</button>
        <button class="btn btn-primary" onclick="_ftColmgrSave()">儲存欄位設定</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  _ftRenderColmgrList();
}

function _ftRenderColmgrList() {
  const el = document.getElementById('ft-colmgr-list');
  if (!el) return;
  el.innerHTML = _ft._colmgrDraft.map(c => `
    <div class="scd-drag-item" data-drag-key="${escHtml(c.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f0f0f0;cursor:grab;">
      <span>⠿</span>
      <input type="text" value="${escHtml(c.name)}" class="field-input" style="flex:1;" onchange="_ftColmgrRename('${c.id}',this.value)">
      <label style="font-size:.8rem;white-space:nowrap;"><input type="checkbox" ${c.required ? 'checked' : ''} onchange="_ftColmgrSetRequired('${c.id}',this.checked)"> 必填</label>
      <button class="btn btn-danger btn-sm" ${c.locked ? 'disabled title="固定欄位不可刪除"' : ''} onclick="_ftColmgrRemove('${c.id}')">刪除</button>
    </div>`).join('');
  _scdInitDrag(el, {
    axis: 'y',
    itemSelector: '.scd-drag-item',
    longPressTouch: true,
    getOrder: () => _ft._colmgrDraft.map(c => c.id),
    onReorder: (order) => {
      _ft._colmgrDraft = order.map(id => _ft._colmgrDraft.find(c => c.id === id));
      _ftRenderColmgrList();
    },
  });
}

function _ftColmgrRename(id, name) {
  const c = _ft._colmgrDraft.find(x => x.id === id);
  if (c) c.name = name;
}
function _ftColmgrSetRequired(id, val) {
  const c = _ft._colmgrDraft.find(x => x.id === id);
  if (c) c.required = !!val;
}
function _ftColmgrRemove(id) {
  const c = _ft._colmgrDraft.find(x => x.id === id);
  if (!c || c.locked) return;
  if (!confirm('確定要刪除此欄位？（歷史資料仍保留在資料庫中，只是不再顯示這一欄）')) return;
  _ft._colmgrDraft = _ft._colmgrDraft.filter(x => x.id !== id);
  _ftRenderColmgrList();
}
function _ftColmgrAddCol() {
  const inp = document.getElementById('ft-colmgr-new-name');
  const name = (inp?.value || '').trim();
  if (!name) { showToast('請輸入欄位名稱', 'warn'); return; }
  const id = _ftGenColId(_ft._colmgrDraft.map(c => c.id));
  _ft._colmgrDraft.push({ id, name, required: false });
  if (inp) inp.value = '';
  _ftRenderColmgrList();
}
async function _ftColmgrSave() {
  if (!_ft._colmgrDraft.length) { showToast('至少須保留一個欄位', 'warn'); return; }
  try {
    const sheet = _ftCurrentSheet();
    const r = await proxyCall('ftSaveSchema', { semester: _ft.semester, sheet, cols: _ft._colmgrDraft });
    _ft.schema = r.schema;
    document.getElementById('ft-colmgr-modal')?.remove();
    _ftRenderGrid();
    showToast('欄位設定已儲存', 'success');
  } catch (e) {
    showToast('儲存失敗：' + e.message, 'error');
  }
}

// ══════════════ v209：導師名冊「與導師系統同步」══════════════
// 後端 ftTutorSyncFetch 只唯讀讀取 tutorsys 快照（見 server/src/freshmanTest/tutorsysSync.js），
// 組裝／差異比對／使用者確認全在前端純函式完成（見上方 _ftAssembleTutorSyncRows／
// _ftTutorSyncDiff／_ftApplyTutorSyncResult），確認後套用到 _ft.rows、仍要按「儲存」才真正呼叫
// 既有 ftSaveRows 落地（比照既有匯入流程的 UX，不引入新的後端寫入 action）。
async function _ftTutorSyncStart() {
  const hasExisting = (_ft.rows || []).some(r => Object.values((r && r.cells) || {}).some(v => String(v ?? '').trim() !== ''));
  if (hasExisting && !confirm('將以導師系統為主，本地修改可能被取代，確定要繼續同步嗎？')) return;
  const btn = document.getElementById('ft-tutorsync-btn');
  if (btn) btn.disabled = true;
  try {
    const [snap, studentsR] = await Promise.all([
      proxyCall('ftTutorSyncFetch', {}),
      proxyCall('ftGetSheet', { semester: _ft.semester, sheet: 'students' }),
    ]);
    const incomingRows = _ftAssembleTutorSyncRows({
      classes: snap.classes || [],
      departments: snap.departments || [],
      studentsRows: _ftFilterDeleted(studentsR.rows),
      deptToCollege: _getDeptToCollege(),
    });
    const diff = _ftTutorSyncDiff(_ft.rows, incomingRows, 'class_abbr');
    _ft._tutorSync = { diff };
    if (!diff.conflicts.length && !diff.removed.length && !diff.newRows.length) {
      showToast('已是最新，沒有需要同步的差異', 'info');
      return;
    }
    _ftRenderTutorSyncModal(diff);
  } catch (e) {
    showToast('同步失敗：' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _ftRenderTutorSyncModal(diff) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ft-tutorsync-modal';
  const colName = (colId) => {
    const col = (_ft.schema && _ft.schema.cols || []).find(x => x.id === colId);
    return col ? col.name : colId;
  };
  const conflictRows = diff.conflicts.map((c, i) => {
    const diffHtml = c.diffCols.map(colId => {
      const ev = (c.existing.cells || {})[colId] ?? '';
      const iv = (c.incoming.cells || {})[colId] ?? '';
      return `<div style="margin-bottom:2px;"><strong>${escHtml(colName(colId))}</strong>：<span style="color:#a0aec0;">${escHtml(String(ev))}</span> → <span style="color:#2b6cb0;">${escHtml(String(iv))}</span></div>`;
    }).join('');
    return `<tr>
      <td style="text-align:center;"><input type="checkbox" class="ft-tutorsync-chk" data-idx="${i}"></td>
      <td>${escHtml(c.key)}</td>
      <td>${diffHtml}</td>
    </tr>`;
  }).join('');
  const removedRows = diff.removed.map((r, i) => `<tr>
      <td style="text-align:center;"><input type="checkbox" class="ft-tutorsync-del-chk" data-idx="${i}"></td>
      <td>${escHtml(r.cells.class_abbr || '')}</td>
      <td>${escHtml(r.cells.tutor_name || '')}</td>
    </tr>`).join('');
  modal.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header"><h3>與導師系統同步——差異預覽</h3></div>
      <div class="modal-body" style="max-height:65vh;overflow:auto;">
        <p style="font-size:.86rem;color:#4a5568;">
          新增 <strong>${diff.newRows.length}</strong> 筆、<strong>${diff.unchanged.length}</strong> 筆無異動、
          <strong>${diff.conflicts.length}</strong> 筆有差異（勾選「取代」套用導師系統的值，未勾選則維持本地資料）。
        </p>
        ${diff.conflicts.length ? `
        <h4 style="margin:10px 0 4px;">差異班級</h4>
        <div style="margin-bottom:8px;">${_ckgToolbarHtml('ft-tutorsync-chk', { labels: ['全選取代', '全不取代'] })}</div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          <thead><tr><th style="text-align:center;">取代</th><th>班級簡稱</th><th>差異欄位（本地 → 導師系統）</th></tr></thead>
          <tbody>${conflictRows}</tbody>
        </table>` : ''}
        ${diff.removed.length ? `
        <h4 style="margin:14px 0 4px;">導師系統已無的本地班級（勾選要一併刪除的列）</h4>
        <div style="margin-bottom:8px;">${_ckgToolbarHtml('ft-tutorsync-del-chk', { labels: ['全選刪除', '全不刪除'] })}</div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          <thead><tr><th style="text-align:center;">刪除</th><th>班級簡稱</th><th>導師</th></tr></thead>
          <tbody>${removedRows}</tbody>
        </table>` : ''}
        ${(!diff.conflicts.length && !diff.removed.length) ? '<p style="color:#718096;">沒有差異需要確認，直接按「套用」即可完成同步。</p>' : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('ft-tutorsync-modal').remove();">取消</button>
        <button class="btn btn-primary" onclick="_ftConfirmTutorSync()">套用</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _ftConfirmTutorSync() {
  const diff = _ft._tutorSync && _ft._tutorSync.diff;
  document.getElementById('ft-tutorsync-modal')?.remove();
  if (!diff) return;
  const acceptedKeys = new Set();
  document.querySelectorAll('.ft-tutorsync-chk').forEach(cb => {
    if (cb.checked) acceptedKeys.add(diff.conflicts[Number(cb.dataset.idx)].key);
  });
  const deleteKeys = new Set();
  document.querySelectorAll('.ft-tutorsync-del-chk').forEach(cb => {
    if (cb.checked) deleteKeys.add(diff.removed[Number(cb.dataset.idx)].cells.class_abbr);
  });
  const before = _ft.rows;
  const after = _ftApplyTutorSyncResult(before, diff, acceptedKeys, deleteKeys);
  _ftEnsureRowUids(after);
  const tx = _ftDiffRowsForTransaction(before, after);
  _ft.rows = after;
  if (!_ft.editing) _ftEnterEdit();
  _ftPushUndo(tx);
  _ftMarkDirty();
  _ftRenderGrid();
  showToast('同步結果已套用到試算表，請確認後按「儲存」才會寫入伺服器', 'info');
}
