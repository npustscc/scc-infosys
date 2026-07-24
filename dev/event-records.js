// dev/event-records.js — 待辦分類＋事件處理記錄表模組（拆 index.html 絞殺者第十一刀，v257）。
// 內容為從 index.html 逐字搬出的函式：待辦分類 tab 純函式（_todoTabMeta／_todoCategoryOf／
// _normalizeTodoTabOrder／_orderTodosByCategory／_todoCategoryCounts／_todoCategoryOrder／
// _setTodoCategoryOrder／_todoViewMode／_setTodoViewMode／_renderTodoTabBar／
// _renderTodoTilesHtml／_setTodoTab／_todoRescueSections／renderTodosPage）、待辦操作
// （_resetTodosFilter／_updateTodoBatchBtn／_toggleTodosSelectAll／_batchArchiveTodos／
// _batchDeleteTodos／_archiveTodo／_unarchiveTodo／_toggleTodosArchived／_deleteDraftTodo／
// _deleteTodo／_ackTodo／_unackTodo／_markTodoDone／_markTodoUndone／_continueTodo）、事件
// 處理記錄表（evr）搜尋與開啟（renderEventRecordsPage／_evrNorm／_evrSearch／_evrPick／
// openEventRecordForm／_evrEmptyRecord）、標準晤談時間節次（stdPeriodOptionsHtml／
// _initStdPeriodSelects）、evr 表單渲染與卡片（_renderEvrForm／_renderEvrCards／
// _buildEvrServiceItemsHtml／_buildEvrCardHtml／_evrRestoreCard／_evrPopulateCounselorSelect／
// _evrRenderCounselorChips／_evrAddCounselor／_evrRemoveCounselor／_checkEvrDuplicate／
// _evrToggleNextBk）、evr 服務項目輔助（_evrToggleTimeOther／_evrToggleTopicOther／
// _evrToggleSocialRpt／_evrToggleSocialRptOther／_evrToggleReportOther／_evrToggleTransfer／
// _evrPopulateTransferSel／_evrAddCustomSvcOpt／_evrAddDynTag／_evrRemoveDynTag／
// _evrRenderDynTags／_evrCollectServiceItems）、evr 記錄增刪（_evrSyncFromDom／
// _evrGetNextBk／_evrAddRecord／_evrRemoveRecord）、evr 退出/暫存/儲存（exitEventRecordForm／
// discardEventRecords／draftEventRecords／saveEventRecords）與 evr 自動備援
// （_startEvrAutosave／_stopEvrAutosave），共 70 個函式。
// 頂層無任何執行副作用（只有 function/async function 與純初始值 let/const 宣告）；本檔頂層
// 宣告的 11 個 const（TODO_CATEGORIES／TODO_CATEGORY_ORDER_DEFAULT／TODO_CLASSIFY_TAB_META／
// TODO_TAB_ORDER_DEFAULT／TODO_ACK_COMPLETES／EVR_TOPICS／EVR_MODES／EVR_INTERVIEWEES／
// STD_PERIODS／EVR_PERIODS／_EVR_TOOLBAR_HTML）與 8 個 let（_evrCaseId／_evrCounselors／
// _evrRecords／_evrDynTags／_evrDraftKey／_evrDraftTimer／_evrTodoId／_evrOrigin）一併搬移，
// 經逐一確認全專案僅本檔各一處宣告、無跨檔重複宣告（比照 v253/v255/v256 的作法）。
// 例外（narrow the boundary）：切出範圍中段原本夾著一段頂層 side-effect——
// 「if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',
// _initStdPeriodSelects); else _initStdPeriodSelects();」（三個標準晤談時間/節次下拉的初次
// 就地重填觸發），column-0 複核判定這屬於「裸呼叫」而非純宣告，故依規則內縮邊界：定義本身
// （function _initStdPeriodSelects）隨本檔搬移，但這段觸發呼叫刻意留在 index.html 原處不動——
// 因本檔以 <script src> 先於主 inline script 載入，call-time 呼叫到時 _initStdPeriodSelects
// 已定義完成，行為與搬移前完全一致。
// 函式內部在呼叫時才會引用主檔全域可變狀態（casesData／configData／currentUser／todosData／
// transferData／DRIVE_FOLDER_ID 等，定義仍留在 index.html），以及主檔與其他拆檔模組內的共用
// 函式（escHtml／currentSemesterPrefix／semesterLabel／openDateToSemPrefix（皆 utils.js）、
// showCaseDetail（case-detail.js）、openClosureEvalPage／_restoreClosureDraft
// （closure-eval.js）、showLoading／hideLoading／showToast／showPage／auditLog／bgJobAdd 系列／
// saveCasesChunks／buildCounselorOptgroups／saveUserTodos／_genTodoId／_putTodoItem／
// _syncTodoBadge／_userPref_／syncUserPref_／getRichTextValue／setRichTextValue／
// toggleRtToolbar／_scdInitDrag／_collectUnmappedDepts／_showExitDialog／openNewCasePage／
// renderCases／attachInit／attachFlush／roleColorOptionStyle／_roleColorCat／roleColorDotHtml／
// roleColorFg／_removeTodoItem／_updateIntervieweeMultiHint／_validateEvrTopicOther／
// _dupFindSameSlot／_dupRenderAlert／_dupResolveAtSave／toggleServiceSubpanel／
// openNewRecordPage／restoreRecordDraft／_flashRecordCard／_switchDetailSemTo／
// _ensureFullCases／_syncBellBadge／openPsychiatristModal／openMlAssessmentModal／
// openEditCasePage／_restoreCaseFormSnapshot／showCaseDetailAtSem／openTransferEvalForm／
// _restoreTransferEvalDraft／_restoreMlAssessDraft／openBookingModal／_restoreBookingDraft／
// openIssueModal／_restoreIssueDraft／markIssuesSeen／renderIssuesPage／renderMentalLeavePage／
// renderAttendanceMgr／renderAdminUsers／renderAdminDegreeMapping／_resolveWithdrawMismatch／
// _markTransferClosureDone／_executeAssessorReassign／_mlAssessCountdownChip／
// _renderAssignmentTodos／_renderCaseAccessAuditSection／_renderOffHoursSection／
// _renderGcErrorsSection／_renderMlNotifSection／_renderMajorEventNotifs／
// _renderClassifyHelpSection 等，皆定義於 index.html 或各自拆檔模組），屬 call-time 解析，與
// 其他拆檔模組（utils.js／ft-core.js／case-detail.js／case-import.js／initial-interview.js／
// psych-import.js／grad-eval.js／closure-eval.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="event-records.js"></script> 載入（放在
// closure-eval.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ══════════════════════════════════════════════
//  待辦事項 v180：六分類（全部＋六個 tab＋「協助系統歸類」獨立 tab）
// ══════════════════════════════════════════════
// 分類對照表（唯一真相）：emoji／標題／涵蓋的 todo type。「協助系統歸類」不在此表——
// 它不是 todosData 項目（是系所簡寫協助歸類的獨立小工具），故獨立成另一個 tab。
const TODO_CATEGORIES = {
  draft:    { emoji: '📝', label: '草稿備援',   types: ['record', 'initial_interview', 'psychiatrist', 'event_records', 'autosave', 'manual', 'case_draft', 'closure_draft', 'transfer_draft', 'ml_assess_draft', 'booking_draft', 'issue_draft'] },
  case:     { emoji: '📁', label: '個案',       types: ['case_assignment', 'internal_transfer', 'couple_incomplete', 'case_profile_incomplete', 'case_mainid_confirm', 'unclosed_reminder'] },
  ml:       { emoji: '💙', label: '身心調適假', types: ['ml_cumul3', 'ml_reminder', 'ml_assessment_due', 'ml_new_leave'] },
  transfer: { emoji: '🎓', label: '轉銜',       types: ['transfer_grad_counselor', 'transfer_grad_coord', 'transfer_closure_reminder', 'transfer_withdraw_coord', 'transfer_withdraw_mismatch', 'transfer_reassign_assessor', 'transfer_reassign_assessor_notify'] },
  leave:    { emoji: '🕐', label: '差勤',       types: ['leave_pending_review', 'leave_approved_notify'] },
  admin:    { emoji: '⚙️', label: '管理',       types: ['issue_pending_verification', 'admin_verify_new_user'] },
};
const TODO_CATEGORY_ORDER_DEFAULT = ['draft', 'case', 'ml', 'transfer', 'leave', 'admin'];
// 「系所歸類」（🧩）非待辦分類（不是 todosData 項目），但 v187 起併入同一份拖曳排序偏好
// （navOrder_todoTabs），故需要一份獨立於 TODO_CATEGORIES 的 meta 供 tab bar／偏好順序卡取用。
const TODO_CLASSIFY_TAB_META = { emoji: '🧩', label: '系所歸類' };
// tab 排序範圍＝六分類＋系所歸類；_normalizeTodoTabOrder 本身是泛用函式（不關心 key 語意），
// 直接餵這份含 'classify' 的預設順序即可讓它一併正規化，不需另外改寫該函式。
const TODO_TAB_ORDER_DEFAULT = [...TODO_CATEGORY_ORDER_DEFAULT, 'classify'];
// 純函式：tab key →｛emoji, label｝，涵蓋六分類與「系所歸類」，供 tab bar／偏好順序卡共用。
function _todoTabMeta(key) {
  return TODO_CATEGORIES[key] || (key === 'classify' ? TODO_CLASSIFY_TAB_META : { emoji: '', label: key });
}
// 純函式：type → 分類 key。找不到對照的 type（未來新增卻忘了收錄）一律 fallback 到「管理」，
// 確保一定會出現在某個分類 tab 中，不會憑空消失於畫面。
function _todoCategoryOf(type) {
  const keys = Object.keys(TODO_CATEGORIES);
  for (let i = 0; i < keys.length; i++) {
    if (TODO_CATEGORIES[keys[i]].types.includes(type)) return keys[i];
  }
  return 'admin';
}
// 純函式：把已儲存的順序（可能含使用者尚未看過的新分類、或已移除的舊分類）正規化成合法的
// 完整順序陣列——先照已儲存順序中「仍存在」的 key，其餘（新分類）依預設順序補在最後。
function _normalizeTodoTabOrder(saved, defaultOrder) {
  if (!Array.isArray(saved) || !saved.length) return [...defaultOrder];
  const valid = saved.filter(k => defaultOrder.includes(k));
  const missing = defaultOrder.filter(k => !valid.includes(k));
  return [...valid, ...missing];
}
// v182（B）：純函式，依分類順序把清單重新分組——每個分類內部維持原陣列相對順序（filter 穩定排序），
// 只調整「跨分類」的先後。修「全部」頁卡片檢視主清單（todos-body）長期是攤平清單、完全不吃 tab 拖曳順序的 bug：
// 舊寫法只對「危機稽核／待派案／身心調適假通知」等額外摘要區塊套 CSS order，個別待辦卡片本身（占畫面大宗）
// 從未依分類分組，故重新排序 tab 對主清單觀感上等於沒作用。方塊檢視（_renderTodoTilesHtml）本來就是分類分組
// 渲染，不受影響；這裡讓卡片檢視也採同一分組邏輯。
function _orderTodosByCategory(list, order) {
  if (!Array.isArray(list) || !list.length) return list || [];
  return order.flatMap(key => list.filter(t => _todoCategoryOf(t.type) === key));
}
// 純函式：依目前分類順序，統計每個分類「未處理」（未完成且未封存）筆數，供 tab 徽章／方塊摘要共用。
function _todoCategoryCounts(list) {
  const counts = {};
  TODO_CATEGORY_ORDER_DEFAULT.forEach(k => { counts[k] = 0; });
  (list || []).forEach(t => {
    if (t.done || t.archivedAt) return;
    const key = _todoCategoryOf(t.type);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}
// tab 順序偏好：沿用既有「navOrder_<id>」白名單前綴（原為側邊欄自訂排序設計，但後端
// selfPatchKeyAllowed_ 對此前綴本就是開放式比對、不限定側邊欄語意），跟隨帳號同步、
// 偏好設定頁與待辦頁共用同一份。
function _todoCategoryOrder() {
  return _normalizeTodoTabOrder(_userPref_('navOrder_todoTabs'), TODO_TAB_ORDER_DEFAULT);
}
function _setTodoCategoryOrder(order) {
  syncUserPref_({ navOrder_todoTabs: order });
}
// 「全部」頁卡片／方塊檢視偏好：非後端白名單欄位（僅 UI 顯示模式，非跨裝置關鍵設定），
// 比照既有「scc_todoTab_」（目前分頁記憶）同一模式存 localStorage，本裝置記住即可。
function _todoViewMode() {
  try { return localStorage.getItem('scc_todoViewMode_' + DRIVE_FOLDER_ID.slice(-8)) || 'card'; } catch (_) { return 'card'; }
}
function _setTodoViewMode(mode) {
  try { localStorage.setItem('scc_todoViewMode_' + DRIVE_FOLDER_ID.slice(-8), mode); } catch (_) {}
  renderTodosPage();
}

// v187：待辦 tab bar 拖曳排序改走 _scdInitDrag（見上方共用 helper），取代舊版 HTML5
// dragdrop（_todoTabDragStart/End/Over/Drop，已移除）。「全部」固定第一、不參與排序（沒有
// data-drag-key，天然不可被拖曳、也不可能被插到它前面）；「系所歸類」併入 order 一起可拖曳。
function _renderTodoTabBar() {
  const bar = document.getElementById('todos-tab-bar');
  if (!bar) return;
  const _tab = window._todoActiveTab || 'all';
  const order = _todoCategoryOrder();
  const counts = _todoCategoryCounts(todosData);
  const classifyCount = (typeof _collectUnmappedDepts === 'function' ? _collectUnmappedDepts() : []).length;
  const tabStyle = active => `border-radius:6px 6px 0 0;border-bottom:none;background:${active ? '#4a5568' : '#f7fafc'};color:${active ? '#fff' : '#4a5568'};margin-right:2px;padding:5px 12px;`;
  const badge = n => n > 0 ? `<span style="background:#e53e3e;color:#fff;border-radius:9px;padding:0 6px;font-size:.7rem;margin-left:5px;">${n > 99 ? '99+' : n}</span>` : '';
  let html = `<button id="todos-tab-all" class="btn btn-sm" onclick="_setTodoTab('all')" style="${tabStyle(_tab === 'all')}">全部</button>`;
  order.forEach(key => {
    const meta = _todoTabMeta(key);
    const n = key === 'classify' ? classifyCount : (counts[key] || 0);
    const tip = key === 'classify' ? '獨立項目：系所簡寫協助歸類，非六分類 todo；可拖曳調整順序' : '可拖曳調整分類順序（同時影響「全部」頁排序）';
    html += `<button id="todos-tab-${key}" class="btn btn-sm scd-drag-item" data-drag-key="${key}"
      onclick="_setTodoTab('${key}')" style="${tabStyle(_tab === key)}" data-tip="${escHtml(tip)}">${meta.emoji} ${escHtml(meta.label)}${badge(n)}</button>`;
  });
  bar.innerHTML = html;
  _scdInitDrag(bar, {
    axis: 'x',
    itemSelector: '.scd-drag-item',
    longPressTouch: true,
    getOrder: _todoCategoryOrder,
    onReorder: (newOrder) => { _setTodoCategoryOrder(newOrder); renderTodosPage(); },
  });
}

// 「全部」頁「方塊」檢視：依分類順序，每塊顯示 emoji／名稱／未處理數／最近 2-3 筆摘要，點擊跳到該分類 tab。
// v189：order 現在含 'classify'（系所歸類，非 todosData 項目、TODO_CATEGORIES 沒有這個 key），
// 用 _todoTabMeta 取代直接查 TODO_CATEGORIES 以涵蓋它；未處理數改用 _collectUnmappedDepts().length。
function _renderTodoTilesHtml(list, order) {
  const tiles = order.map(key => {
    const isClassify = key === 'classify';
    const cat = _todoTabMeta(key);
    const items = isClassify ? [] : list.filter(t => _todoCategoryOf(t.type) === key);
    const pendingCount = isClassify
      ? (typeof _collectUnmappedDepts === 'function' ? _collectUnmappedDepts() : []).length
      : items.filter(t => !t.done).length;
    const preview = isClassify ? [] : [...items]
      .sort((a, b) => (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1)
      .slice(0, 3);
    const previewHtml = isClassify
      ? `<div style="font-size:.78rem;color:#4a5568;padding:2px 0;">協助系統歸類系所簡寫</div>`
      : (preview.length
        ? preview.map(t => `<div style="font-size:.78rem;color:#4a5568;padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">・${escHtml(t.label || '')}${t.done ? '（已完成）' : ''}</div>`).join('')
        : `<div style="font-size:.78rem;color:#a0aec0;">目前沒有項目</div>`);
    return `<div class="todo-tile" onclick="_setTodoTab('${key}')" style="cursor:pointer;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;transition:box-shadow .15s;" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:1.15rem;">${cat.emoji}</span>
        <span style="font-weight:700;font-size:.92rem;color:#2d3748;">${escHtml(cat.label)}</span>
        <span style="margin-left:auto;background:${pendingCount ? '#e53e3e' : '#e2e8f0'};color:${pendingCount ? '#fff' : '#718096'};border-radius:10px;padding:1px 8px;font-size:.76rem;font-weight:600;">${pendingCount}</span>
      </div>
      ${previewHtml}
    </div>`;
  }).join('');
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">${tiles}</div>`;
}

function _setTodoTab(tab) {
  window._todoActiveTab = tab;
  localStorage.setItem('scc_todoTab_' + DRIVE_FOLDER_ID.slice(-8), tab);
  renderTodosPage();
}

// v189：三個摘要區塊（todos-section-case／ml／admin）＋系所歸類區塊（todos-classify-help-section）
// 是跨渲染週期持久存在的 DOM 節點（各自的 render 函式用 getElementById 找內層容器塞內容，節點
// 本身搬家不影響）。「全部」頁卡片檢視會把它們錨進對應的 todo-cat-group（見 renderTodosPage 卡片
// 分組段），但 todos-body 每次 render 都會整個 innerHTML 覆寫——若上次它們被搬進 body 裡、這次
// render 忘記先搬離，會被覆寫整個銷毀、內容永久消失。因此每次 renderTodosPage 一開始（任何
// body.innerHTML 賦值之前）一律先呼叫這個 helper，把四個節點救援回絕不會被覆寫的安全容器
// （todos-sections-wrap），render 邏輯再依當下 tab／檢視模式決定要不要把它們搬去別處。
function _todoRescueSections() {
  const wrap = document.getElementById('todos-sections-wrap');
  if (!wrap) return;
  ['todos-section-case', 'todos-section-ml', 'todos-section-admin', 'todos-classify-help-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== wrap) wrap.appendChild(el);
  });
}

function renderTodosPage() {
  _todoRescueSections();
  if (!window._todoActiveTab) {
    window._todoActiveTab = localStorage.getItem('scc_todoTab_' + DRIVE_FOLDER_ID.slice(-8)) || 'all';
  }
  const _tab = window._todoActiveTab;
  _renderTodoTabBar();
  // Hide type filter when tab is not 'all'
  const typeFilterEl = document.getElementById('todos-filter-type');
  if (typeFilterEl) typeFilterEl.style.display = (_tab === 'all' ? '' : 'none');
  // 「卡片／方塊」檢視切換：只在「全部」tab 顯示
  const viewToggleEl = document.getElementById('todos-view-toggle');
  if (viewToggleEl) viewToggleEl.style.display = (_tab === 'all' ? 'flex' : 'none');
  const _curViewMode = _todoViewMode();
  const cardBtn = document.getElementById('todos-view-card');
  const gridBtn = document.getElementById('todos-view-grid');
  if (cardBtn) { cardBtn.style.background = _curViewMode === 'card' ? '#4a5568' : '#f7fafc'; cardBtn.style.color = _curViewMode === 'card' ? '#fff' : '#4a5568'; }
  if (gridBtn) { gridBtn.style.background = _curViewMode === 'grid' ? '#4a5568' : '#f7fafc'; gridBtn.style.color = _curViewMode === 'grid' ? '#fff' : '#4a5568'; }

  _renderCaseAccessAuditSection();
  _renderOffHoursSection();
  _renderGcErrorsSection();
  _renderAssignmentTodos();
  _renderMlNotifSection();
  _renderMajorEventNotifs();
  _renderClassifyHelpSection();

  // v189：待辦「全部」頁單一排序流。三個摘要區塊＋系所歸類依當下情境決定「顯不顯示」與
  // 「放在哪裡」：
  //   - 全部頁／卡片檢視／非封存檢視：顯示，且稍後會被搬進對應 todo-cat-group（見下方
  //     body.innerHTML 卡片分組段），與該分類的待辦卡片排在一起，讓拖曳 tab 順序＝整頁排序。
  //   - 全部頁／方塊檢視：全部隱藏（方塊本身已呈現摘要數字，點方塊可切到單一 tab 看完整區塊）。
  //   - 全部頁／封存檢視：顯示，但維持現狀留在 wrap（封存是查閱情境，不吃分類排序）。
  //   - 單一分類 tab／系所歸類 tab：只顯示對應那一個，留在 wrap。
  // 原本用 CSS order 排 wrap 內三個區塊的做法（實際位置改用 DOM 搬移決定）已無作用，移除。
  const _catOrder = _todoCategoryOrder().filter(k => k !== 'classify');
  const _fullTabOrder = _todoCategoryOrder(); // 含 'classify'，供卡片分組／方塊檢視輸出順序使用
  const _groupIntoBody = _tab === 'all' && _curViewMode === 'card' && !_todosShowArchived;
  const _showSectionsInAll = _tab === 'all' && (_todosShowArchived || _curViewMode === 'card');
  const _showCat = key => _tab === key || _showSectionsInAll;
  const _showClassify = _tab === 'classify' || _showSectionsInAll;
  const _caseClusterEl  = document.getElementById('todos-section-case');
  const _mlClusterEl    = document.getElementById('todos-section-ml');
  const _adminClusterEl = document.getElementById('todos-section-admin');
  const _classifyEl     = document.getElementById('todos-classify-help-section');
  if (_caseClusterEl)  _caseClusterEl.style.display  = _showCat('case')  ? '' : 'none';
  if (_mlClusterEl)    _mlClusterEl.style.display    = _showCat('ml')    ? '' : 'none';
  if (_adminClusterEl) _adminClusterEl.style.display = _showCat('admin') ? '' : 'none';
  if (_classifyEl)      _classifyEl.style.display     = _showClassify   ? '' : 'none';

  const isAdminUser = currentRole === '主任' || extraRole === '管理者';

  // ── 管理者：初始化人員篩選下拉 ──
  const userSel = document.getElementById('todos-filter-user');
  if (userSel) {
    if (isAdminUser && configData?.users) {
      userSel.style.display = '';
      if (!userSel.getAttribute('data-populated')) {
        // 依 COUNSELOR_ROLE_GROUPS 分組排序＋身分色（比照 buildCounselorFilterOpts 原則）：啟用者在前、停用者在後
        const allUsers = Object.entries(configData.users).filter(([e]) => e !== currentUser?.email);
        let opts = '';
        COUNSELOR_ROLE_GROUPS.forEach(group => {
          const entries = allUsers
            .filter(([, info]) => group.roles.includes(info.role || '') && !info.disabled)
            .sort(([, ia], [, ib]) => {
              const oa = group.roles.indexOf(ia.role || ''), ob = group.roles.indexOf(ib.role || '');
              if (oa !== ob) return oa - ob;
              return (ia.name || '').localeCompare(ib.name || '', 'zh');
            });
          if (!entries.length) return;
          opts += `<optgroup label="${escHtml(group.label)}">`;
          entries.forEach(([e, info]) => {
            opts += `<option value="${escHtml(e)}" style="${roleColorOptionStyle(info.role)}">${escHtml(info.name || e)}</option>`;
          });
          opts += '</optgroup>';
        });
        COUNSELOR_ROLE_GROUPS.forEach(group => {
          const entries = allUsers
            .filter(([, info]) => group.roles.includes(info.role || '') && info.disabled)
            .sort(([, ia], [, ib]) => {
              const oa = group.roles.indexOf(ia.role || ''), ob = group.roles.indexOf(ib.role || '');
              if (oa !== ob) return oa - ob;
              return (ia.name || '').localeCompare(ib.name || '', 'zh');
            });
          if (!entries.length) return;
          opts += `<optgroup label="${escHtml(group.label + '（已停用）')}">`;
          entries.forEach(([e, info]) => {
            opts += `<option value="${escHtml(e)}" style="color:gray">${escHtml(info.name || e)}（已停用）</option>`;
          });
          opts += '</optgroup>';
        });
        userSel.innerHTML =
          `<option value="">我的待辦事項</option>` +
          `<option value="__all__">── 全部人員</option>` +
          opts;
        userSel.setAttribute('data-populated', '1');
      }
      if (_todosViewUser && _todosViewUser !== currentUser?.email) userSel.value = _todosViewUser;
      else if (!_todosViewUser) userSel.value = '';
    } else {
      userSel.style.display = 'none';
    }
  }

  // ── 決定資料來源與唯讀模式 ──
  const viewingOwn = !_todosViewUser || _todosViewUser === currentUser?.email;
  let viewData, readOnly;
  if (!isAdminUser || viewingOwn) {
    viewData = todosData;
    readOnly = false;
  } else if (_todosViewUser === '__all__') {
    viewData = Object.entries(_adminTodosCache).flatMap(([email, todos]) =>
      todos.map(t => ({ ...t, _ownerEmail: email, _ownerName: configData?.users?.[email]?.name || email }))
    );
    readOnly = true;
  } else {
    viewData = (_adminTodosCache[_todosViewUser] || []).map(t => ({
      ...t, _ownerEmail: _todosViewUser, _ownerName: configData?.users?.[_todosViewUser]?.name || _todosViewUser
    }));
    readOnly = true;
  }

  // ── 篩選 ──
  const search     = (document.getElementById('todos-search')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('todos-filter-type')?.value || '';
  const statusF    = document.getElementById('todos-filter-status')?.value;
  const statusFilter = statusF === undefined || statusF === null ? '' : statusF;

  const body = document.getElementById('todos-body');
  if (!body) return;

  // classify tab：「協助系統歸類」為獨立區塊（非 todosData 項目），body 顯示為空
  if (_tab === 'classify') { body.innerHTML = ''; }

  const filtered = _tab === 'classify' ? [] : viewData.filter(t => {
    if (_todosShowArchived) { if (!t.archivedAt) return false; }
    else { if (t.archivedAt) return false; }
    if (statusFilter === 'pending' && t.done) return false;
    if (statusFilter === 'done' && !t.done) return false;
    if (_tab !== 'all' && _todoCategoryOf(t.type) !== _tab) return false;
    if (typeFilter && t.type !== typeFilter) return false;
    if (search) {
      const hay = `${t.caseLabel||''} ${t.caseId||''} ${t.label||''} ${t._ownerName||''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1;
  });
  // v182（B）：「全部」tab 的卡片／方塊兩種檢視都依使用者 tab 順序排列各分類內容（分類內部沿用上面
  // done／時間排序不變，見 _orderTodosByCategory）；其他單一分類 tab 本就只含一種分類，排序不受影響。
  const _todosForBody = _tab === 'all' ? _orderTodosByCategory(filtered, _catOrder) : filtered;

  // 「全部」tab＋方塊檢視：跳過逐筆清單，改渲染分類方塊 grid（封存檢視一律用卡片清單）。
  // 三個摘要區塊＋系所歸類此時已被上方 _showCat／_showClassify 隱藏，不在畫面上；方塊本身
  // 呈現各分類摘要數字，點方塊切到單一 tab 才看得到完整區塊。order 改傳含 'classify' 的完整
  // 順序，讓「系所歸類」方塊也依使用者拖曳的位置出現（_renderTodoTilesHtml 內對 classify 特殊處理）。
  if (_tab === 'all' && !_todosShowArchived && _todoViewMode() === 'grid') {
    body.innerHTML = _renderTodoTilesHtml(_todosForBody, _fullTabOrder);
    const batchBtn0 = document.getElementById('todos-batch-delete-btn');
    const selectAll0 = document.getElementById('todos-select-all');
    const selectAllLabel0 = document.getElementById('todos-select-all-label');
    if (selectAll0) selectAll0.checked = false;
    if (selectAllLabel0) selectAllLabel0.style.display = 'none';
    if (batchBtn0) batchBtn0.style.display = 'none';
    return;
  }

  // ── 過去學期未結案提醒 ──
  const summaryEl = document.getElementById('todos-unclosed-summary');
  if (summaryEl) {
    let summaryHtml = '';
    if (viewingOwn && Array.isArray(casesData)) {
      const bySem = {};
      casesData.filter(c => !c.deleted).forEach(c => {
        _pastUnclosedSems(c).forEach(s => { bySem[s] = (bySem[s] || 0) + 1; });
      });
      const sems = Object.keys(bySem).sort();
      const isReminderRead = todosData.find(t => t.type === 'unclosed_reminder' && !t.done && t.notifRead);
      if (sems.length && !isReminderRead) {
        // 建立個案明細列表
        const caseRows = [];
        casesData.filter(c => !c.deleted).forEach(c => {
          _pastUnclosedSems(c).forEach(sem => {
            const counselor = _semCounselorDisplay(c, sem);
            caseRows.push({ c, sem, counselor });
          });
        });
        caseRows.sort((a, b) => a.sem.localeCompare(b.sem) || a.c.name.localeCompare(b.c.name, 'zh'));
        const collapsed = _userPref_('todosUnclosedCollapsed', false);
        summaryHtml = `<div style="background:#fffbeb;border:1px solid #f6ad55;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
          <div onclick="_toggleUnclosedSummary()" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${collapsed?'0':'10px'};gap:8px;flex-wrap:wrap;cursor:pointer;" data-tip="點選整列可收起/展開明細">
            <span style="font-weight:600;font-size:.9rem;color:#9c4221;">
              <span style="display:inline-block;width:14px;">${collapsed?'▶':'▼'}</span>
              ⚠ 過去學期未結案（${caseRows.length} 筆）
            </span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm" style="font-size:.78rem;padding:2px 10px;background:#fff;border-color:#ed8936;color:#c05621;" onclick="event.stopPropagation();goCasesPastUnclosed()">前往個案列表</button>
              <button class="btn btn-sm" style="font-size:.78rem;padding:2px 10px;" onclick="event.stopPropagation();_dismissUnclosedReminder()">已讀，不再提醒</button>
            </div>
          </div>
          ${collapsed ? '' : `<div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.83rem;">
              <thead><tr style="background:#fef3c7;">
                <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #f6ad55;white-space:nowrap;">案名</th>
                <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #f6ad55;white-space:nowrap;">案號</th>
                <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #f6ad55;white-space:nowrap;">未結案學期</th>
                <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #f6ad55;white-space:nowrap;">學期主責</th>
              </tr></thead>
              <tbody>
                ${caseRows.map(r => `<tr onclick="showCaseDetailAtSem('${escHtml(r.c.id)}','${escHtml(r.sem)}')" style="cursor:pointer;border-bottom:1px solid #fde68a;" class="hover-row">
                  <td style="padding:5px 8px;">${escHtml(r.c.name)}</td>
                  <td style="padding:5px 8px;font-family:monospace;">${escHtml(r.c.id)}</td>
                  <td style="padding:5px 8px;">${escHtml(semesterLabel(r.sem))}</td>
                  <td style="padding:5px 8px;">${escHtml(r.counselor)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>`;
      }
    }
    summaryEl.innerHTML = summaryHtml;
  }

  // 批次操作列：唯讀時隱藏
  const batchBtn  = document.getElementById('todos-batch-delete-btn');
  const selectAll = document.getElementById('todos-select-all');
  const selectAllLabel = document.getElementById('todos-select-all-label');
  if (readOnly) {
    if (selectAll) selectAll.checked = false;
    if (selectAllLabel) selectAllLabel.style.display = 'none';
    if (batchBtn) batchBtn.style.display = 'none';
  } else {
    if (selectAll) selectAll.checked = false;
    if (selectAllLabel) selectAllLabel.style.display = '';
    if (batchBtn) batchBtn.style.display = 'none';
  }

  // v189：全部頁／卡片檢視／非封存（_groupIntoBody）就算 filtered 是空的，也不能提早在這裡
  // return——三個摘要區塊等等要錨進 todo-cat-group，群組容器（含空群組）仍必須照常輸出。
  if (!filtered.length && !_groupIntoBody) {
    if (_tab === 'admin') { return; }
    let who = '';
    if (_todosViewUser === '__all__') who = '全員的';
    else if (readOnly) who = `${configData?.users?.[_todosViewUser]?.name || _todosViewUser} 的`;
    else who = statusFilter === 'pending' ? '未完成的' : statusFilter === 'done' ? '已完成的' : '';
    body.innerHTML = `<div style="padding:32px;text-align:center;color:#718096;font-size:.9rem;">目前沒有${who}待辦事項。</div>`;
    return;
  }

  const typeLabels = { record: '晤談記錄', initial_interview: '初談表', psychiatrist: '精神科評估', event_records: '事件處理記錄', autosave: '自動備援', manual: '手動', case_assignment: '待派案', internal_transfer: '內部轉案派案', couple_incomplete: '個案資料待補齊', case_profile_incomplete: '個案開案資料待補齊', case_mainid_confirm: '主案號確認', unclosed_reminder: '未結案提醒', transfer_grad_counselor: '轉銜：主責轉出學生', transfer_grad_coord: '轉銜管理（轉銜窗口）', transfer_closure_reminder: '轉銜結案追蹤', admin_verify_new_user: '使用者管理（待確認）', transfer_withdraw_coord: '教務處名單（轉銜窗口）', transfer_withdraw_mismatch: '教務處名單（姓名/學號不符）', transfer_reassign_assessor: '轉派評估者', transfer_reassign_assessor_notify: '轉銜評估者通知', leave_pending_review: '差勤申請（待審核）', leave_approved_notify: '差勤申請結果', issue_pending_verification: '問題回報（待您驗證）', ml_cumul3: '身心調適假累計提醒', ml_reminder: '身心調適假再次提醒', ml_assessment_due: '身心狀態評估表（待填寫）', ml_new_leave: '身心調適假（主責新請假）', case_draft: '個案資料草稿', closure_draft: '結案評估草稿', transfer_draft: '轉銜評估草稿', ml_assess_draft: '身心狀態評估表草稿', booking_draft: '空間預約草稿', issue_draft: '問題回報草稿' };

  // v189：抽成具名函式（原為 body.innerHTML = _todosForBody.map(t => {...}) 的匿名 callback），
  // 供下方「全部頁／卡片檢視」分組輸出（每分類一個 todo-cat-group）與其餘情境的攤平清單共用。
  const _todoItemHtml = (t) => {
    // 問題回報「待您驗證」待辦：若對應 issue 已不是 pending_verification（他人已代驗或管理者已改狀態），自動收掉此待辦
    if (!readOnly && t.type === 'issue_pending_verification' && !t.done) {
      const relIssue = issuesData.find(x => x.id === t.issueId);
      if (relIssue && relIssue.status !== 'pending_verification') {
        t.done = true; t.doneAt = new Date().toISOString();
        saveUserTodos().catch(() => {});
        _syncTodoBadge();
        return '';
      }
    }
    const tLabel = typeLabels[t.type] || t.type;
    const createdAt = t.createdAt ? new Date(t.createdAt).toLocaleString('zh-TW', { dateStyle:'short', timeStyle:'short' }) : '';
    const doneAt = t.doneAt ? new Date(t.doneAt).toLocaleString('zh-TW', { dateStyle:'short', timeStyle:'short' }) : '';
    const bgColor = t.done ? '#f7fafc' : (t.isLocked ? '#fff5f5' : (t.origin === 'autosave' ? '#fffaf0' : '#fff'));
    const borderColor = t.done ? '#e2e8f0' : (t.isLocked ? '#fc8181' : (t.origin === 'autosave' ? '#fbd38d' : '#e2e8f0'));
    const ownerBadge = t._ownerName ? `<span class="badge" style="background:#e9d8fd;color:#553c9a;font-size:.72rem;border:1px solid #d6bcfa;">${escHtml(t._ownerName)}</span>` : '';

    const _isLocked = !readOnly && !!t.isLocked && !t.done;
    // v288：初談表選「暫不指派」建立的待派案提醒——不可封存/勾選/標記完成，指派主責後自動消除
    const _isDeferAssign = !readOnly && !!t.deferAssign && !t.done;
    const checkBoxHtml = readOnly
      ? `<div style="width:16px;flex-shrink:0;"></div>`
      : (_isDeferAssign
        ? `<input type="checkbox" class="todo-select-cb" data-id="${t.id}" disabled data-tip="此提醒需指派主責後才會自動消除，無法封存或批次操作" style="margin-top:3px;flex-shrink:0;">`
        : `<input type="checkbox" class="todo-select-cb" data-id="${t.id}" onchange="_updateTodoBatchBtn()" style="margin-top:3px;flex-shrink:0;">`);
    const _isTransferTodo = ['transfer_grad_counselor','transfer_grad_coord','transfer_closure_reminder','transfer_withdraw_coord'].includes(t.type);
    const _isMismatchTodo = t.type === 'transfer_withdraw_mismatch';
    const _isAdminUserTodo = t.type === 'admin_verify_new_user';
    const _isReassignInitiatorTodo = t.type === 'transfer_reassign_assessor';
    const _isReassignNotifyTodo = t.type === 'transfer_reassign_assessor_notify';
    const _isLeaveTodo = t.type === 'leave_pending_review' || t.type === 'leave_approved_notify';
    const _isIssueVerifyTodo = t.type === 'issue_pending_verification';
    const _isMlCumulTodo = t.type === 'ml_cumul3' || t.type === 'ml_reminder' || t.type === 'ml_assessment_due' || t.type === 'ml_new_leave';
    // v187：以下四型原本沒有對應分支／標籤判斷，「繼續編輯」預設值誤植於此四型，點擊沒反應
    // （見 _continueTodo 通盤檢討）；補上專屬標籤，並在 _continueTodo 補上對應導向。
    const _isCaseAssignTodo = t.type === 'case_assignment' || t.type === 'internal_transfer';
    const _isProfileIncompleteTodo = t.type === 'case_profile_incomplete';
    const _isUnclosedReminderTodo = t.type === 'unclosed_reminder';
    const _isCaseMainIdTodo = t.type === 'case_mainid_confirm';
    const _mlAssessDueChip = (t.type === 'ml_assessment_due' && !t.done) ? _mlAssessCountdownChip(t.dueDate, '') : '';
    const _continueBtnLabel = (_isTransferTodo || _isReassignNotifyTodo) ? '前往轉銜管理'
      : _isAdminUserTodo ? '前往設定'
      : _isLeaveTodo ? '前往差勤管理'
      : _isIssueVerifyTodo ? '前往驗證'
      : _isMlCumulTodo ? '前往身心調適假'
      : _isProfileIncompleteTodo ? '繼續完成開案'
      : _isCaseAssignTodo ? '前往指派主責'
      : _isUnclosedReminderTodo ? '前往個案列表'
      : _isCaseMainIdTodo ? '前往確認主案號'
      : '繼續編輯';
    const continueBtn = !readOnly && !t.done && !_isMismatchTodo && !_isReassignInitiatorTodo && !(_isLeaveTodo && t.type === 'leave_approved_notify') ? `<button class="btn btn-primary btn-sm" style="font-size:.78rem;" onclick="_continueTodo('${t.id}')">${_continueBtnLabel}</button>` : '';
    const doneBtn = !readOnly
      ? (!t.done
        ? (t.type === 'transfer_closure_reminder'
          ? `<button class="btn btn-primary btn-sm" style="font-size:.78rem;" onclick="_markTransferClosureDone('${t.id}','${t.transferRecId||''}')">已完成結案會議</button>`
          : _isMismatchTodo ? '' // mismatch uses special confirm/ignore buttons
          : _isReassignInitiatorTodo ? '' // handled by reassignDetailHtml below
          : _isDeferAssign ? '' // 待派案提醒：需指派主責才會自動消除，不提供手動完成
          : `<button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="_markTodoDone('${t.id}')">完成</button>`)
        : `<button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="_markTodoUndone('${t.id}')">恢復</button>`)
      : '';
    const ackBtn = !readOnly && !t.done
      ? (t.ackAt
        ? `<button class="btn btn-sm" style="font-size:.78rem;background:#c6f6d5;border-color:#9ae6b4;color:#276749;" onclick="_unackTodo('${t.id}')" data-tip="取消收到標記">✅ 已收到</button>`
        : `<button class="btn btn-sm" style="font-size:.78rem;" onclick="_ackTodo('${t.id}')" data-tip="標記為已看到，但尚未完成處理">📩 收到</button>`)
      : '';
    const _isDraftTodo = !!(t.label && t.label.includes('草稿'));
    const deleteBtn = (!readOnly && !_isLocked)
      ? (_todosShowArchived
        ? `<button class="btn btn-sm" style="font-size:.78rem;" onclick="_unarchiveTodo('${t.id}')" data-tip="取消封存，重新顯示於待辦列表">♻️ 取消封存</button>`
        : (_isDraftTodo
          ? `<button class="btn btn-sm" style="font-size:.78rem;" onclick="_deleteDraftTodo('${t.id}')" data-tip="放棄此草稿並直接刪除（不可復原）">放棄草稿</button>`
          : `<button class="btn btn-sm" style="font-size:.78rem;" onclick="_archiveTodo('${t.id}')" data-tip="封存＝消除此待辦事項，可在「封存紀錄」中查閱">📦 封存</button>`))
      : '';
    const mismatchDetailHtml = _isMismatchTodo && !t.done ? `
      <div style="margin-top:8px;background:#fff8e1;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;font-size:.82rem;">
        <div style="color:#92400e;margin-bottom:4px;">⚠ 請確認以下匯入資料是否正確連結至系統個案：</div>
        <div style="color:#4a5568;">${escHtml(t.detail||'')}</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" style="font-size:.78rem;" onclick="_resolveWithdrawMismatch('${escHtml(t.mismatchId||'')}','confirm')">✅ 確認連結（以學號覆寫）</button>
          <button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="_resolveWithdrawMismatch('${escHtml(t.mismatchId||'')}','ignore')">略過（保持現狀）</button>
          ${t.caseId ? `<button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="showCaseDetail('${escHtml(t.caseId)}')">查閱個案</button>` : ''}
        </div>
      </div>` : '';
    const reassignDetailHtml = _isReassignInitiatorTodo && !t.done && !readOnly ? `
      <div style="margin-top:8px;background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;padding:8px 12px;font-size:.82rem;">
        <div style="color:#2b6cb0;margin-bottom:6px;">轉派評估者目標（可在此修改）：</div>
        <select id="reassign-sel-${t.id}" class="field-input" style="padding:4px 8px;font-size:.82rem;max-width:220px;margin-bottom:8px;">
          <option value="">（保持目前目標：${escHtml(t.targetName || t.targetEmail || '—')}）</option>
          ${buildCounselorOptgroups()}
        </select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" data-reassign-id="${t.id}" style="font-size:.78rem;" onclick="_executeAssessorReassign('${t.id}')">轉派評估者</button>
          <button class="btn btn-secondary btn-sm" data-reassign-cancel-id="${t.id}" style="font-size:.78rem;" onclick="_archiveTodo('${t.id}')" data-tip="封存此任務（不進行轉派）">取消不轉派</button>
        </div>
      </div>` : '';

    return `<div class="todo-item" data-id="${t.id}" style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:flex-start;gap:10px;">
      ${checkBoxHtml}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
          <span style="font-weight:600;font-size:.9rem;${t.done?'text-decoration:line-through;color:#a0aec0;':''}">${escHtml(t.label)}</span>
          <span class="badge" style="background:#e2e8f0;color:#4a5568;font-size:.72rem;">${escHtml(tLabel)}</span>
          ${t.origin === 'autosave' ? '<span class="badge badge-orange" style="font-size:.72rem;">自動備援</span>' : ''}
          ${t.done ? '<span class="badge badge-green" style="font-size:.72rem;">已完成</span>' : ''}
          ${!t.done && t.notifRead ? '<span class="badge" style="background:#e2e8f0;color:#4a5568;font-size:.72rem;">已讀</span>' : ''}
          ${_mlAssessDueChip}
          ${ownerBadge}
        </div>
        ${t.caseLabel ? `<div style="font-size:.82rem;color:#718096;margin-bottom:4px;">個案：${escHtml(t.caseLabel)}</div>` : ''}
        ${_isDeferAssign ? `<div style="font-size:.78rem;color:#c53030;">⚠ 此提醒無法封存——指派主責後將自動消除</div>` : ''}
        ${t.done && t.type === 'case_assignment' && t.assignedCounselorName ? `<div style="font-size:.82rem;color:#276749;margin-bottom:4px;">已派案給：${escHtml(t.assignedCounselorName)}</div>` : ''}
        ${_isReassignNotifyTodo && t.fromName ? `<div style="font-size:.82rem;color:#276749;margin-bottom:4px;">由 ${escHtml(t.fromName)} 指派</div>` : ''}
        <div style="font-size:.78rem;color:#a0aec0;">${createdAt}${t.done && doneAt ? `　完成：${doneAt}` : ''}${!t.done && t.ackAt ? `　收到：${new Date(t.ackAt).toLocaleString('zh-TW', { dateStyle:'short', timeStyle:'short' })}` : ''}</div>
        ${mismatchDetailHtml}
        ${reassignDetailHtml}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center;">
        ${ackBtn}${continueBtn}${doneBtn}${deleteBtn}
      </div>
    </div>`;
  };

  if (_groupIntoBody) {
    // 「全部」頁／卡片檢視／非封存：每個分類（含系所歸類的空佔位群組）輸出一個
    // todo-cat-group 容器，依使用者拖曳的 tab 順序排列——沒有卡片的分類也要輸出空容器，
    // 因為稍後要把對應的摘要區塊錨進去（單一排序流的關鍵）。
    body.innerHTML = _fullTabOrder.map(key => {
      const itemsHtml = key === 'classify' ? '' : _todosForBody.filter(t => _todoCategoryOf(t.type) === key).map(_todoItemHtml).join('');
      return `<div class="todo-cat-group" data-cat="${key}">${itemsHtml}</div>`;
    }).join('');
    const _groupEl = key => body.querySelector(`.todo-cat-group[data-cat="${key}"]`);
    if (_caseClusterEl)  { const g = _groupEl('case');     if (g) g.prepend(_caseClusterEl); }
    if (_mlClusterEl)    { const g = _groupEl('ml');       if (g) g.prepend(_mlClusterEl); }
    if (_adminClusterEl) { const g = _groupEl('admin');    if (g) g.prepend(_adminClusterEl); }
    if (_classifyEl)     { const g = _groupEl('classify'); if (g) g.appendChild(_classifyEl); }
  } else {
    body.innerHTML = _todosForBody.map(_todoItemHtml).join('');
  }
}

function _resetTodosFilter() {
  const s = document.getElementById('todos-search'); if (s) s.value = '';
  const t = document.getElementById('todos-filter-type'); if (t) t.value = '';
  const st = document.getElementById('todos-filter-status'); if (st) st.value = '';
  renderTodosPage();
}

function _updateTodoBatchBtn() {
  const checked = document.querySelectorAll('.todo-select-cb:checked').length;
  const btn = document.getElementById('todos-batch-delete-btn');
  if (btn) btn.style.display = checked > 0 ? 'inline-flex' : 'none';
}

function _toggleTodosSelectAll(el) {
  document.querySelectorAll('.todo-select-cb').forEach(cb => { cb.checked = el.checked; });
  _updateTodoBatchBtn();
}

// v288：待派案提醒（初談表選「暫不指派」建立，deferAssign:true）無法封存/批次操作，
// 需指派主責（或初談表改選一次性服務）才會自動消除——批次操作 silently 濾掉這類項目。
const _isDeferAssignLocked = (id) => { const t = todosData.find(x => x.id === id); return !!(t?.deferAssign && !t.done); };

function _batchArchiveTodos() {
  let ids = [...document.querySelectorAll('.todo-select-cb:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const _blockedCount = ids.filter(_isDeferAssignLocked).length;
  ids = ids.filter(id => !_isDeferAssignLocked(id));
  if (!ids.length) { showToast('此提醒需指派主責後才會自動消除，無法封存', 'error', 3000); return; }
  ids.forEach(id => {
    const t = todosData.find(x => x.id === id);
    if (t) t.archivedAt = new Date().toISOString();
  });
  _syncTodoBadge();
  const _batchJobId = bgJobAdd(`批次封存 ${ids.length} 個待辦`);
  saveUserTodos()
    .then(() => { bgJobDone(_batchJobId); auditLog('批次封存待辦事項', null, null, `${ids.length} 個`); })
    .catch(err => bgJobFail(_batchJobId, err?.message || '儲存失敗'));
  showToast(`已封存 ${ids.length} 個待辦事項${_blockedCount ? `（${_blockedCount} 個待派案提醒無法封存，已略過）` : ''}`, 'success', 2500);
  renderTodosPage();
}

function _batchDeleteTodos() {
  let ids = [...document.querySelectorAll('.todo-select-cb:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  const _blockedCount = ids.filter(_isDeferAssignLocked).length;
  ids = ids.filter(id => !_isDeferAssignLocked(id));
  if (!ids.length) { showToast('此提醒需指派主責後才會自動消除，無法刪除', 'error', 3000); return; }
  const incomplete = ids.filter(id => !todosData.find(t => t.id === id)?.done);
  const msg = incomplete.length
    ? `選取了 ${ids.length} 個待辦事項（其中 ${incomplete.length} 個未完成）。\n確定要全部刪除？`
    : `確定要刪除 ${ids.length} 個已完成的待辦事項？`;
  if (!confirm(msg)) return;
  ids.forEach(id => {
    const t = todosData.find(x => x.id === id);
    if (t?.draftKey) localStorage.removeItem(t.draftKey);
    if (t?.recordId) _suppressedTodoRecordIds.add(t.recordId);
    _removeTodoItem(id);
  });
  const _batchDelJobId = bgJobAdd(`批次刪除 ${ids.length} 個草稿 / 待辦`);
  saveUserTodos()
    .then(() => { bgJobDone(_batchDelJobId); auditLog('批次刪除待辦事項', null, null, `${ids.length} 個`); })
    .catch(err => bgJobFail(_batchDelJobId, err?.message || '儲存失敗'));
  showToast(`已刪除 ${ids.length} 個待辦事項${_blockedCount ? `（${_blockedCount} 個待派案提醒無法刪除，已略過）` : ''}`, 'success', 2500);
  renderTodosPage();
}

function _archiveTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  if (t.deferAssign && !t.done) { showToast('此提醒需指派主責後才會自動消除', 'error', 3000); return; }
  t.archivedAt = new Date().toISOString();
  _syncTodoBadge();
  const _jobLabel = t.caseLabel ? `封存「${t.label}」（${t.caseLabel}）` : `封存「${t.label}」`;
  const _jobId = bgJobAdd(_jobLabel);
  saveUserTodos()
    .then(() => { bgJobDone(_jobId); auditLog('封存待辦事項', null, null, t.label); })
    .catch(err => bgJobFail(_jobId, err?.message || '儲存失敗'));
  showToast('待辦事項已封存', 'success', 2500);
  renderTodosPage();
}

function _unarchiveTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  delete t.archivedAt;
  _syncTodoBadge();
  const _jobId = bgJobAdd(`取消封存「${t.label}」`);
  saveUserTodos()
    .then(() => { bgJobDone(_jobId); auditLog('取消封存待辦事項', null, null, t.label); })
    .catch(err => bgJobFail(_jobId, err?.message || '儲存失敗'));
  showToast('已取消封存', 'success', 2500);
  renderTodosPage();
}

function _toggleTodosArchived() {
  _todosShowArchived = !_todosShowArchived;
  const btn = document.getElementById('todos-show-archived-btn');
  if (btn) btn.style.background = _todosShowArchived ? '#ebf8ff' : '#f7fafc';
  if (btn) btn.style.borderColor = _todosShowArchived ? '#90cdf4' : '#cbd5e0';
  if (btn) btn.style.color = _todosShowArchived ? '#2b6cb0' : '#4a5568';
  renderTodosPage();
}

function _deleteDraftTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  if (t.draftKey) localStorage.removeItem(t.draftKey);
  if (t.recordId) _suppressedTodoRecordIds.add(t.recordId);
  _removeTodoItem(id);
  const _dJobLabel = `放棄草稿：${t.label}${t.caseLabel ? `（${t.caseLabel}）` : ''}`;
  const _dJobId = bgJobAdd(_dJobLabel);
  saveUserTodos()
    .then(() => { bgJobDone(_dJobId); auditLog('放棄草稿', null, null, t.label); })
    .catch(err => bgJobFail(_dJobId, err?.message || '儲存失敗'));
  showToast('草稿已放棄', 'success', 2500);
  renderTodosPage();
}

function _deleteTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  if (!t.done && !confirm(`確定要刪除此草稿待辦事項？\n「${t.label}」${t.caseLabel ? `（${t.caseLabel}）` : ''}`)) return;
  if (t.draftKey) localStorage.removeItem(t.draftKey);
  if (t.recordId) _suppressedTodoRecordIds.add(t.recordId);
  _removeTodoItem(id);
  const _delJobLabel = t.caseLabel ? `刪除「${t.label}」（${t.caseLabel}）` : `刪除「${t.label}」`;
  const _delJobId = bgJobAdd(_delJobLabel);
  saveUserTodos()
    .then(() => { bgJobDone(_delJobId); auditLog('刪除待辦事項', null, null, t.label); })
    .catch(err => bgJobFail(_delJobId, err?.message || '儲存失敗'));
  showToast('待辦事項已刪除', 'success', 2500);
  renderTodosPage();
}

// 「收到」＝我看到了但還沒完成：不動 done/notifRead 既有語意（除了下面這幾種純通知類）。
// 純通知類（沒有「完成」動作、本質上就是一則 FYI）：收到即等同處理完，直接一併標記完成。
const TODO_ACK_COMPLETES = new Set(['leave_approved_notify']);
function _ackTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  const now = new Date().toISOString();
  t.ackAt = now;
  t.notifRead = true; // 收到時順便讓鈴鐺紅點消掉，合理
  if (TODO_ACK_COMPLETES.has(t.type) && !t.done) { t.done = true; t.doneAt = now; }
  _syncTodoBadge();
  saveUserTodos().catch(() => {});
  showToast('已標記收到', 'success', 2000);
  renderTodosPage();
}
function _unackTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  const prevAckAt = t.ackAt;
  delete t.ackAt;
  // 只有「因收到而自動完成」的純通知類才連帶恢復未完成；使用者之後手動另外按完成則不受影響
  if (TODO_ACK_COMPLETES.has(t.type) && t.done && t.doneAt === prevAckAt) { t.done = false; t.doneAt = null; }
  _syncTodoBadge();
  saveUserTodos().catch(() => {});
  showToast('已取消收到標記', 'success', 2000);
  renderTodosPage();
}

function _markTodoDone(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  if (t.deferAssign && !t.done) { showToast('此提醒需指派主責後才會自動消除', 'error', 3000); return; }
  t.done = true;
  t.doneAt = new Date().toISOString();
  _syncTodoBadge();
  saveUserTodos().catch(() => {});
  showToast('已標記完成', 'success', 2000);
  renderTodosPage();
}

function _markTodoUndone(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  t.done = false;
  t.doneAt = null;
  _syncTodoBadge();
  saveUserTodos().catch(() => {});
  showToast('已取消完成', 'success', 2000);
  renderTodosPage();
}

function _continueTodo(id) {
  const t = todosData.find(x => x.id === id);
  if (!t) return;
  // 若從鈴鐺通知下拉選單觸發，先收合面板，避免導頁後畫面被面板遮住、看似「無反應」
  const _notifPanelEl = document.getElementById('notif-panel');
  if (_notifPanelEl && _notifPanelEl.style.display === 'block') _notifPanelEl.style.display = 'none';
  // mark autosave as read when user acts on it
  if (t.origin === 'autosave') { t.notifRead = true; saveUserTodos().catch(() => {}); _syncBellBadge(); }
  if (t.type === 'record') {
    if (t.recordId && t.caseId) {
      // edit mode with existing pending record
      const c = casesData.find(x => x.id === t.caseId);
      const rec = c?.records?.find(r => r.id === t.recordId);
      if (rec) { openNewRecordPage(t.caseId, t.recordId, rec.recordKind || '晤談記錄'); return; }
    }
    if (t.draftData && t.caseId) {
      // crash recovery: open new form and restore from draftData
      openNewRecordPage(t.caseId);
      setTimeout(() => { try { restoreRecordDraft(t.draftData); } catch(_) {} }, 300);
      return;
    }
    if (t.caseId) openNewRecordPage(t.caseId);
  } else if (t.type === 'initial_interview') {
    if (t.caseId) openInitialInterviewPage(t.caseId);
  } else if (t.type === 'psychiatrist') {
    if (t.recordId && t.caseId) { openPsychiatristModal(t.caseId, t.recordId); return; }
    if (t.caseId) openPsychiatristModal(t.caseId);
  } else if (t.type === 'event_records') {
    if (t.draftData?.caseId) {
      openEventRecordForm(t.draftData.caseId, { ...t.draftData, todoId: t.id });
    }
  } else if (['transfer_grad_counselor','transfer_grad_coord','transfer_closure_reminder'].includes(t.type)) {
    window._transferTab = 'graduation';
    const navEl = document.querySelector('[data-nav-id="page-transfer"]');
    showPage('page-transfer', navEl);
    renderTransferPage();
  } else if (t.type === 'transfer_withdraw_coord') {
    window._transferTab = 'withdraw';
    const navEl = document.querySelector('[data-nav-id="page-transfer"]');
    showPage('page-transfer', navEl);
    renderTransferPage();
  } else if (t.type === 'leave_pending_review') {
    _attMgrTab = 'review';
    const navEl = document.querySelector('[data-nav-id="page-attendance"]');
    showPage('page-attendance', navEl);
    renderAttendanceMgr();
  } else if (t.type === 'admin_verify_new_user') {
    const navEl = document.querySelector('[data-nav-id="page-admin"]');
    showPage('page-admin', navEl);
    if (t.newUserKey) window._adminHighlightUser = t.newUserKey;
    renderAdminUsers();
    renderAdminDegreeMapping();
  } else if (t.type === 'transfer_reassign_assessor_notify') {
    window._transferTab = t.transferType === 'withdraw' ? 'withdraw' : 'graduation';
    const navEl = document.querySelector('[data-nav-id="page-transfer"]');
    showPage('page-transfer', navEl);
    renderTransferPage();
  } else if (t.type === 'issue_pending_verification') {
    const relIssue = issuesData.find(x => x.id === t.issueId);
    if (relIssue && relIssue.status !== 'pending_verification') {
      // 他人已代驗或管理者已改狀態：自動收掉待辦，不導頁
      t.done = true; t.doneAt = new Date().toISOString();
      saveUserTodos().catch(() => {});
      _syncTodoBadge();
      return;
    }
    const navEl = document.querySelector('[data-nav-id="page-issues"]');
    showPage('page-issues', navEl);
    markIssuesSeen();
    renderIssuesPage();
  } else if (t.type === 'ml_cumul3' || t.type === 'ml_reminder' || t.type === 'ml_assessment_due' || t.type === 'ml_new_leave') {
    const navEl = document.querySelector('[data-nav-id="page-mental-leave"]');
    showPage('page-mental-leave', navEl);
    renderMentalLeavePage();
    // 評估表待辦：導頁後直接開啟該筆評估表
    if (t.type === 'ml_assessment_due' && t.leaveId && mentalLeavesData.some(l => l.id === t.leaveId)) {
      setTimeout(() => openMlAssessmentModal(t.leaveId), 150);
    }
  } else if (t.type === 'case_mainid_confirm') {
    // 一學生一案號合併遷移後的「確認主案號」待辦：導到個案詳情頁，可在該頁對調主號↔曾用號
    // 主號若已被對調，t.caseId 會變成曾用號 → 以 formerIds 反查現行主號
    if (t.caseId) {
      const _live = casesData.some(x => x.id === t.caseId) ? t.caseId
        : (casesData.find(x => (x.formerIds || []).some(f => f.id === t.caseId))?.id || t.caseId);
      showCaseDetail(_live);
    }
  } else if (t.type === 'case_profile_incomplete' || t.type === 'couple_incomplete') {
    // v187 修正：這兩型原本完全沒有分支，回報「快速開案的『繼續編輯』沒效」的根因——
    // 皆為個案資料尚未填完整（快速開案／伴侶快速開案），導到編輯個案頁繼續補資料
    if (t.caseId) openEditCasePage(t.caseId);
  } else if (t.type === 'case_assignment' || t.type === 'internal_transfer') {
    // v187 修正：待派案／內部轉案原本也沒有分支——這兩型的主要互動 UI 其實是待辦頁上方
    // 「待派案」摘要卡（_renderAssignmentTodos 渲染的 todo-card-{id}，含指派主責下拉＋確認鈕），
    // 生成的卡片本身在同一頁另有一份（分類/全部清單），故改為捲動並反白該摘要卡片，
    // 找不到卡片（理論上不會發生，防禦性 fallback）才退回個案詳情頁
    const _assignCard = document.getElementById('todo-card-' + t.id);
    if (_assignCard) {
      _assignCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      _assignCard.style.transition = 'box-shadow .3s';
      _assignCard.style.boxShadow = '0 0 0 3px #f6ad55';
      setTimeout(() => { _assignCard.style.boxShadow = ''; }, 1500);
    } else if (t.caseId) {
      showCaseDetail(t.caseId);
    }
  } else if (t.type === 'unclosed_reminder') {
    // v187 修正：原本沒有分支；比照過去學期未結案摘要區塊的「前往個案列表」按鈕同一導向
    goCasesPastUnclosed();
  } else if (t.type === 'case_draft') {
    // v185：個案資料表單草稿——重開表單（編輯既有個案或全新表單）後回填快照
    const d = t.draftData || {};
    _caseDraftTodoId = t.id;
    if (d.editingCaseId && casesData.some(c => c.id === d.editingCaseId)) {
      openEditCasePage(d.editingCaseId);
    } else {
      openNewCasePage();
    }
    setTimeout(() => { try { _restoreCaseFormSnapshot(d.snapshot); } catch (_) {} }, 300);
  } else if (t.type === 'closure_draft') {
    // v185：結案評估／學期評估草稿
    const d = t.draftData || {};
    if (d.caseId) {
      _closureDraftTodoId = t.id;
      openClosureEvalPage(d.caseId, d.evalType, null);
      setTimeout(() => { try { _restoreClosureDraft(d.snapshot); } catch (_) {} }, 300);
    }
  } else if (t.type === 'transfer_draft') {
    // v185：轉銜評估草稿
    const d = t.draftData || {};
    if (d.caseId) {
      _teDraftTodoId = t.id;
      openTransferEvalForm(d.caseId, d.teId || null);
      setTimeout(() => { try { _restoreTransferEvalDraft(d.snapshot); } catch (_) {} }, 300);
    }
  } else if (t.type === 'ml_assess_draft') {
    // v185：身心狀態評估表草稿
    const d = t.draftData || {};
    if (d.leaveId && mentalLeavesData.some(l => l.id === d.leaveId)) {
      openMlAssessmentModal(d.leaveId);
      _mlaDraftTodoId = t.id; // 須在 openMlAssessmentModal 呼叫「之後」設定，該函式開頭會重置此變數
      setTimeout(() => { try { _restoreMlAssessDraft(d.snapshot); } catch (_) {} }, 300);
    }
  } else if (t.type === 'booking_draft') {
    // v185：空間預約草稿
    const d = t.draftData || {};
    openBookingModal(d.snapshot?.caseId || '', null);
    _bkDraftTodoId = t.id; // 須在 openBookingModal 呼叫「之後」設定，該函式開頭會重置此變數
    setTimeout(() => { try { _restoreBookingDraft(d.snapshot); } catch (_) {} }, 300);
  } else if (t.type === 'issue_draft') {
    // v185：問題回報草稿
    const d = t.draftData || {};
    openIssueModal();
    _issueDraftTodoId = t.id; // 須在 openIssueModal 呼叫「之後」設定，該函式開頭會重置此變數
    setTimeout(() => { try { _restoreIssueDraft(d.snapshot); } catch (_) {} }, 300);
  } else if (t.draftData) {
    // generic autosave with draftData — best-effort restore
    if (t.caseId) openNewRecordPage(t.caseId);
  } else {
    // v187：fallback——完全未收錄分支的 type 不再沉默吞掉（原本點了沒反應）。至少導回待辦頁、
    // 切到該 type 所屬分類 tab，並用 toast 明確告知，而非讓使用者以為按鈕壞了。
    const _navEl = document.querySelector('[data-nav-id="page-todos"]');
    if (_navEl) showPage('page-todos', _navEl);
    _setTodoTab(_todoCategoryOf(t.type));
    showToast('此類型待辦事項尚未提供自動導向，已切換至對應分類頁籤，請於清單中查看。', 'info', 4500);
  }
}

// ══════════════════════════════════════════════
// ── 事件處理記錄表 ──────────────────────────────────────────────────────────

const EVR_TOPICS = ['自我探索','情感困擾','家庭關係','心理疾患或傾向','情緒困擾','人際關係','學習與課業','生涯探索','生活適應','網路成癮','生理健康','性別議題','其他'];
const EVR_MODES = ['面談','視訊','團體','電話關懷','E-mail/簡訊','外展訪視','其他'];
const EVR_INTERVIEWEES = ['學生本人','家屬','朋友','伴侶','教職員工生','資源網絡人員'];
// #039：晤談時間／節次下拉的「單一標準來源」（以「新增晤談紀錄」為準）。全系統的晤談時間/節次選單
// 一律由 STD_PERIODS 產生，日後只要改這裡即可一併調整（晤談紀錄 #rec-time、初次晤談 #ii-interview-time、
// 事件處理記錄 #pfx-time，及各自的「下次預約」節次）。含「午 12:10-13:00」——先前 EVR_PERIODS 漏掉此項，
// 導致事件處理記錄的晤談時間下拉與新增晤談紀錄不一致，本次統一補上。
// 註：空間預約另有 BK_PERIODS（含 start/end 供時段格線、且刻意不設「午」時段，午休非可預約時段），非本清單。
const STD_PERIODS = [
  '第1節 08:10-09:00', '第2節 09:10-10:00', '第3節 10:15-11:05', '第4節 11:10-12:00',
  '午 12:10-13:00',
  '第5節 13:30-14:20', '第6節 14:30-15:20', '第7節 15:30-16:20', '第8節 16:30-17:20',
  '第9節 18:00-18:50', '第10節 18:55-19:45', '第11節 19:50-20:40',
];
const EVR_PERIODS = STD_PERIODS; // 向後相容既有引用（事件處理記錄）

// 產生標準晤談時間／節次的 <option> 字串。selected＝目前值（非標準值時自動選「其他」）；
// withOther＝是否含「其他（自填時間）」，置於「請選擇」之後、各節次之前，比照新增晤談紀錄的排列。
function stdPeriodOptionsHtml(selected, opts) {
  opts = opts || {};
  const withOther = opts.withOther !== false;
  const placeholder = opts.placeholder || '— 請選擇 —';
  const sel = selected == null ? '' : String(selected);
  const isStd = STD_PERIODS.includes(sel);
  let html = `<option value="">${escHtml(placeholder)}</option>`;
  if (withOther) html += `<option value="其他"${(!isStd && sel) ? ' selected' : ''}>其他（自填時間）</option>`;
  html += STD_PERIODS.map(v => `<option value="${escHtml(v)}"${v === sel ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
  return html;
}

// #039：三個靜態晤談時間/節次選單（新增晤談紀錄晤談時間、初次晤談初談時間、下次預約節次）改由
// STD_PERIODS 就地重填，達成單一來源。選項文字與原本一致，故既有讀值／草稿還原邏輯（設 select.value）
// 不受影響。延到 DOMContentLoaded 才執行——確保 escHtml 等後續 <script> 區塊的函式都已定義、DOM 也齊全。
function _initStdPeriodSelects() {
  ['rec-time', 'ii-interview-time', 'rec-next-bk-period'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = stdPeriodOptionsHtml('', { withOther: true });
  });
}

let _evrCaseId     = null;
let _evrCounselors = [];
let _evrRecords    = [];
let _evrDynTags    = [];   // _evrDynTags[idx] = {accompany:[], other:[]}
let _evrDraftKey   = null;
let _evrDraftTimer = null;
let _evrTodoId     = null;
let _evrOrigin     = null;   // 'case-detail' | 'search' | 'todo'

// ── 搜尋頁 ──

function renderEventRecordsPage() {
  const el = document.getElementById('event-records-content');
  if (!el) return;
  if (_evrCaseId) { _renderEvrForm(); return; }
  el.innerHTML = `
    <div style="max-width:560px;">
      <div style="font-size:.95rem;color:#4a5568;margin-bottom:14px;">請輸入學號、姓名或案號搜尋已開案個案：</div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="evr-search-inp" class="field-input" placeholder="學號 / 姓名 / 案號…" oninput="_evrSearch(this.value)" style="flex:1;">
      </div>
      <div id="evr-search-results" style="margin-top:14px;"></div>
    </div>`;
  setTimeout(() => document.getElementById('evr-search-inp')?.focus(), 50);
}

// 比對正規化：移除所有空白（含全形）並轉小寫，避免資料或輸入含空白造成查無
function _evrNorm(s) { return String(s || '').replace(/[\s　]+/g, '').toLowerCase(); }

function _evrSearch(q) {
  const res = document.getElementById('evr-search-results');
  if (!res) return;
  q = _evrNorm(q);
  if (!q) { res.innerHTML = ''; return; }
  const hit = c => _evrNorm(c.name).includes(q) || _evrNorm(c.studentId).includes(q) || _evrNorm(c.id).includes(q);
  let matched = casesData.filter(c => !c.deleted && hit(c)).slice(0, 20);
  // Fallback：casesData 查無時改搜輕量索引（涵蓋尚未載入 chunk 的個案）
  if (!matched.length && _casesIndexCache?.cases?.length) {
    matched = _casesIndexCache.cases.filter(c => c?.id && !c.deleted && hit(c)).slice(0, 20);
  }
  if (!matched.length) { res.innerHTML = '<div style="color:#718096;font-size:.88rem;padding:8px;">查無符合的開案個案。若確定該生已開案，請確認輸入的姓名／學號／案號是否正確。</div>'; return; }
  res.innerHTML = matched.map(c => `
    <div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;">
      <div>
        <div style="font-weight:600;">${escHtml(c.name)}
          ${c.status === 'closed' ? '<span style="font-size:.72rem;background:#f0f4f8;color:#718096;border-radius:4px;padding:1px 5px;margin-left:6px;">已結案</span>' : ''}
          ${c.archived ? '<span style="font-size:.72rem;background:#fefcbf;color:#744210;border-radius:4px;padding:1px 5px;margin-left:6px;">📦 已封存</span>' : ''}
        </div>
        <div style="font-size:.82rem;color:#718096;">${escHtml(c.id)}${c.studentId ? ' ‧ ' + escHtml(c.studentId) : ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="_evrPick('${escHtml(c.id)}')">新增事件處理記錄</button>
    </div>`).join('');
}

// 選取後先確保完整資料已載入（scoped/cold 個案可能僅為索引 stub），再開表單
async function _evrPick(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (c && c._indexOnly && !c._fullLoaded) {
    showLoading('載入個案資料…');
    try { await _ensureFullCases([caseId]); }
    catch (e) { hideLoading(); alert('載入個案資料失敗：' + e.message); return; }
    hideLoading();
  }
  openEventRecordForm(caseId);
}

// ── 開啟表單 ──

function openEventRecordForm(caseId, fromDraftData, origin) {
  _evrCaseId   = caseId;
  _evrDraftKey = `evr_draft_${caseId}_${currentUser?.email || 'anon'}`;
  // 重置同時段重複紀錄檢核（#9）的殘留狀態（各卡片 key 為 'evr-<idx>'）
  Object.keys(_dupStates).filter(k => k.startsWith('evr-')).forEach(k => delete _dupStates[k]);
  _evrOrigin   = origin || (fromDraftData ? 'todo' : 'search');
  if (fromDraftData) {
    _evrRecords    = fromDraftData.records || [_evrEmptyRecord()];
    _evrCounselors = _evrRecords.map(r => r.counselors || []);
    _evrDynTags    = _evrRecords.map(r => r.dynTags || { accompany:[], other:[] });
    _evrTodoId     = fromDraftData.todoId  || null;
  } else {
    _evrRecords    = [_evrEmptyRecord()];
    _evrCounselors = [[]];
    const _curEmail = currentUser?.email;
    if (_curEmail && configData?.users?.[_curEmail]) {
      const _cu = configData.users[_curEmail];
      if (BK_COUNSELING_ROLES.has(_cu.role || '')) {
        _evrCounselors = [[{ email: _curEmail, label: _cu.name || _curEmail, role: _cu.role || '' }]];
      }
    }
    _evrDynTags    = [{ accompany:[], other:[] }];
    _evrTodoId     = null;
  }
  showPage('page-event-records', document.querySelector('[data-nav-id="page-event-records"]'));
  _renderEvrForm();
  _startEvrAutosave();
}

function _evrEmptyRecord() {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return { date, time:'', room:'', counselors:[], interviewees:[], intervieweeNote:'', interventionMode:'', topics:[], serviceItems:[], summary:'', nextBk:null };
}

// ── 表單渲染 ──

const _EVR_TOOLBAR_HTML = '<div class="rt-toolbar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;padding:4px 8px;"><button type="button" class="rt-btn rt-toolbar-toggle" onclick="toggleRtToolbar(this)" title="格式工具列" style="min-width:28px;font-size:.8rem;">A</button><span class="rt-toolbar-btns" style="display:none;gap:4px;flex-wrap:wrap;align-items:center;"><button type="button" class="rt-btn" data-cmd="bold" title="粗體 (Ctrl+B)" style="font-weight:bold;min-width:32px;">B</button><button type="button" class="rt-btn" data-cmd="italic" title="斜體 (Ctrl+I)" style="font-style:italic;min-width:32px;">I</button><button type="button" class="rt-btn" data-cmd="underline" title="底線 (Ctrl+U)" style="text-decoration:underline;min-width:32px;">U</button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="justifyLeft" title="靠左" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="1" y1="6.17" x2="10" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="10" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyCenter" title="置中" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="3" y1="6.17" x2="13" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="3" y1="13.5" x2="13" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyRight" title="靠右" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="6" y1="13.5" x2="15" y2="13.5"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtCycleUL" title="項目符號" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="2" cy="3" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none"/><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><button type="button" class="rt-btn" data-cmd="rtCycleOL" title="編號列表" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><text x="0" y="4.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1.</text><text x="0" y="9.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2.</text><text x="0" y="14.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3.</text><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtIndent" title="縮排" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="6" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/><polygon points="1,5.3 1,10.7 4.6,8" fill="currentColor" stroke="none"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="removeFormat" title="清除格式" style="min-width:32px;font-size:.78rem;">清</button></span></div>';

function _renderEvrForm() {
  const el = document.getElementById('event-records-content');
  if (!el || !_evrCaseId) return;
  const c = casesData.find(x => x.id === _evrCaseId);
  const cLabel = c ? `${escHtml(c.name)}（${escHtml(_evrCaseId)}）` : escHtml(_evrCaseId);
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm" onclick="exitEventRecordForm()">← 返回</button>
      <div style="font-weight:600;font-size:1rem;">事件處理記錄 — ${cLabel}</div>
    </div>
    <div style="font-size:.78rem;color:#718096;margin-bottom:12px;"><span class="req">*</span> 為必填欄位</div>
    <div id="evr-alert" style="display:none;" class="alert"></div>
    <div id="evr-cards-wrap"></div>
    <div style="margin:12px 0;">
      <button class="btn btn-secondary" onclick="_evrAddRecord()">＋ 新增事件處理記錄</button>
    </div>
    <div id="evr-draft-status" style="font-size:.8rem;color:#718096;margin-bottom:10px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="saveEventRecords()">儲存記錄</button>
      <button class="btn btn-secondary" onclick="draftEventRecords()">暫存草稿</button>
      <button class="btn btn-secondary" style="color:#c53030;border-color:#fc8181;" onclick="exitEventRecordForm()">捨棄離開</button>
    </div>`;
  _renderEvrCards();
}

function _renderEvrCards() {
  const wrap = document.getElementById('evr-cards-wrap');
  if (!wrap) return;
  wrap.innerHTML = _evrRecords.map((r, idx) => _buildEvrCardHtml(r, idx)).join('');
  _evrRecords.forEach((r, idx) => {
    _evrRestoreCard(r, idx);
    _evrPopulateCounselorSelect(idx);
    _evrRenderCounselorChips(idx);
    _evrPopulateTransferSel(idx);
    _evrRenderDynTags(idx, 'accompany');
    _evrRenderDynTags(idx, 'other');
  });
}

function _buildEvrServiceItemsHtml(r, idx) {
  const pfx = `evr${idx}`;
  const sis = r.serviceItems || [];
  const mck = (v) => sis.some(s => s === v || s.startsWith(v+'：') || s.startsWith(v+':')) ? ' checked' : '';
  const act = (v) => sis.some(s => s === v || s.startsWith(v+'：') || s.startsWith(v+':')) ? ' active' : '';
  return `
    <div class="service-item-row">
      <label class="service-item-label"><input type="checkbox" name="${pfx}-service-main" value="諮商輔導／諮詢"${mck('諮商輔導／諮詢')}/> 諮商輔導／諮詢</label>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="心理測驗"${mck('心理測驗')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-psychtest')"/> 心理測驗
      </label>
      <div class="service-subpanel${act('心理測驗')}" id="${pfx}-sp-psychtest">
        <div class="subpanel-check-list" id="${pfx}-sp-psychtest-list">
          <label><input type="checkbox" name="${pfx}-psychtest" value="BDI-II（貝氏憂鬱量表）"/> BDI-II（貝氏憂鬱量表）</label>
          <label><input type="checkbox" name="${pfx}-psychtest" value="BAI（貝氏焦慮量表）"/> BAI（貝氏焦慮量表）</label>
          <label><input type="checkbox" name="${pfx}-psychtest" value="董氏憂鬱量表"/> 董氏憂鬱量表</label>
        </div>
        <div style="font-size:.78rem;color:#718096;margin:6px 0 4px;">自訂測驗（新增後可勾選）：</div>
        <div class="add-item-row">
          <input type="text" id="${pfx}-sp-psychtest-input" placeholder="輸入測驗名稱後按新增…"/>
          <button class="btn-add" onclick="_evrAddCustomSvcOpt(${idx},'psychtest')" type="button">＋ 新增</button>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label"><input type="checkbox" name="${pfx}-service-main" value="與個案相關資源或關係人聯繫"${mck('與個案相關資源或關係人聯繫')}/> 與個案相關資源或關係人聯繫</label>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="性平行為人"${mck('性平行為人')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-genderequal')"/> 性平行為人
      </label>
      <div class="service-subpanel${act('性平行為人')}" id="${pfx}-sp-genderequal">
        <div class="subpanel-check-list">
          <label><input type="checkbox" name="${pfx}-genderequal" value="性平教育課程"/> 性平教育課程</label>
          <label><input type="checkbox" name="${pfx}-genderequal" value="心理諮商"/> 心理諮商</label>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="轉介相關資源"${mck('轉介相關資源')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-referral')"/> 轉介相關資源
      </label>
      <div class="service-subpanel${act('轉介相關資源')}" id="${pfx}-sp-referral">
        <div class="subpanel-check-list" id="${pfx}-sp-referral-list">
          <label><input type="checkbox" name="${pfx}-referral" value="轉介外部資源（持續諮商或治療）"/> 轉介外部資源（持續諮商或治療）</label>
          <label><input type="checkbox" name="${pfx}-referral" value="轉介外部資源（資源連結）"/> 轉介外部資源（資源連結）</label>
          <label><input type="checkbox" name="${pfx}-referral" value="轉介校內精神科醫師"/> 轉介校內精神科醫師</label>
          <label><input type="checkbox" name="${pfx}-referral" value="生活輔導組"/> 生活輔導組</label>
          <label><input type="checkbox" name="${pfx}-referral" value="課外指導組"/> 課外指導組</label>
          <label><input type="checkbox" name="${pfx}-referral" value="衛生保健組"/> 衛生保健組</label>
          <label><input type="checkbox" name="${pfx}-referral" value="原住民資源中心"/> 原住民資源中心</label>
          <label><input type="checkbox" name="${pfx}-referral" value="校內申訴窗口"/> 校內申訴窗口</label>
          <label><input type="checkbox" name="${pfx}-referral" value="性別平等委員會窗口"/> 性別平等委員會窗口</label>
          <label><input type="checkbox" name="${pfx}-referral" value="霸凌委員會窗口"/> 霸凌委員會窗口</label>
          <label><input type="checkbox" name="${pfx}-referral" value="教務處"/> 教務處</label>
          <label><input type="checkbox" name="${pfx}-referral" value="國際事務處"/> 國際事務處</label>
          <label><input type="checkbox" name="${pfx}-referral" value="屏安醫院"/> 屏安醫院</label>
          <label><input type="checkbox" name="${pfx}-referral" value="社會局"/> 社會局</label>
          <label><input type="checkbox" name="${pfx}-referral" value="自殺防治中心"/> 自殺防治中心</label>
          <label><input type="checkbox" name="${pfx}-referral" value="屏東地方法院"/> 屏東地方法院</label>
          <label><input type="checkbox" name="${pfx}-referral" value="勵馨基金會"/> 勵馨基金會</label>
          <label><input type="checkbox" name="${pfx}-referral" value="食物銀行"/> 食物銀行</label>
        </div>
        <div style="font-size:.78rem;color:#718096;margin:6px 0 4px;">自訂轉介資源（新增後可勾選）：</div>
        <div class="add-item-row">
          <input type="text" id="${pfx}-sp-referral-input" placeholder="輸入名稱後按新增…"/>
          <button class="btn-add" onclick="_evrAddCustomSvcOpt(${idx},'referral')" type="button">＋ 新增</button>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="責任通報"${mck('責任通報')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-report')"/> 責任通報
      </label>
      <div class="service-subpanel${act('責任通報')}" id="${pfx}-sp-report">
        <div class="subpanel-check-list" style="flex-direction:column;gap:6px;">
          <label><input type="checkbox" name="${pfx}-report" value="校園安全通報"/> 校園安全通報</label>
          <label><input type="checkbox" name="${pfx}-report" value="自殺防治通報"/> 自殺防治通報</label>
          <label><input type="checkbox" name="${pfx}-report" value="性平會通報"/> 性平會通報</label>
          <label><input type="checkbox" name="${pfx}-report" value="霸凌通報"/> 霸凌通報</label>
          <div>
            <label><input type="checkbox" name="${pfx}-report" value="社政通報" onchange="_evrToggleSocialRpt(this,${idx})"/> 社政通報</label>
            <div id="${pfx}-sp-social-report" style="display:none;margin-top:5px;padding-left:18px;border-left:2px solid #e2e8f0;">
              <div class="subpanel-check-list" style="flex-direction:column;gap:4px;">
                <label><input type="checkbox" name="${pfx}-social-report" value="性騷擾"/> 性騷擾</label>
                <label><input type="checkbox" name="${pfx}-social-report" value="性侵害"/> 性侵害</label>
                <label><input type="checkbox" name="${pfx}-social-report" value="家庭暴力"/> 家庭暴力</label>
                <label><input type="checkbox" name="${pfx}-social-report" value="親密關係暴力"/> 親密關係暴力</label>
                <label style="display:flex;align-items:center;gap:6px;">
                  <input type="checkbox" name="${pfx}-social-report" value="其他" onchange="_evrToggleSocialRptOther(this,${idx})"/> 其他：
                  <input type="text" id="${pfx}-sp-social-report-other" class="field-input" style="width:140px;display:none;padding:4px 8px;" placeholder="請說明"/>
                </label>
              </div>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" name="${pfx}-report" value="其他通報" onchange="_evrToggleReportOther(this,${idx})"/> 其他：
            <input type="text" id="${pfx}-sp-report-other" class="field-input" style="width:160px;display:none;padding:4px 8px;" placeholder="請說明"/>
          </label>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="陪同服務"${mck('陪同服務')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-accompany')"/> 陪同服務
      </label>
      <div class="service-subpanel${act('陪同服務')}" id="${pfx}-sp-accompany">
        <div class="dynamic-tags" id="${pfx}-sp-accompany-tags"></div>
        <div class="add-item-row">
          <input type="text" id="${pfx}-sp-accompany-input" placeholder="服務內容（如：陪同就醫、陪同報案）…"/>
          <button class="btn-add" onclick="_evrAddDynTag(${idx},'accompany')" type="button">＋ 新增</button>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="內部轉案"${mck('內部轉案')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-transfer')"/> 內部轉案
      </label>
      <div class="service-subpanel${act('內部轉案')}" id="${pfx}-sp-transfer">
        <div class="radio-group" style="margin-bottom:8px;">
          <label><input type="radio" name="${pfx}-transfer-type" value="分案會議" checked/> 分案會議</label>
          <label><input type="radio" name="${pfx}-transfer-type" value="指定輔導人員" onchange="_evrToggleTransfer(${idx})"/> 指定輔導人員</label>
        </div>
        <div id="${pfx}-sp-transfer-counselor" style="display:none;">
          <select class="field-select" id="${pfx}-sp-transfer-sel" style="max-width:300px;"><option value="">— 請選擇輔導人員 —</option></select>
        </div>
      </div>
    </div>
    <div class="service-item-row">
      <label class="service-item-label"><input type="checkbox" name="${pfx}-service-main" value="一次性服務"${mck('一次性服務')}/> 一次性服務</label>
    </div>
    <div class="service-item-row">
      <label class="service-item-label">
        <input type="checkbox" name="${pfx}-service-main" value="其他"${mck('其他')} onchange="toggleServiceSubpanel(this,'${pfx}-sp-rec-other')"/> 其他
      </label>
      <div class="service-subpanel${act('其他')}" id="${pfx}-sp-rec-other">
        <div class="dynamic-tags" id="${pfx}-sp-other-tags"></div>
        <div class="add-item-row">
          <input type="text" id="${pfx}-sp-other-input" placeholder="請說明…"/>
          <button class="btn-add" onclick="_evrAddDynTag(${idx},'other')" type="button">＋ 新增</button>
        </div>
      </div>
    </div>`;
}

function _buildEvrCardHtml(r, idx) {
  const pfx = `evr${idx}`;
  const removeBtn = idx > 0
    ? `<button class="btn btn-secondary btn-sm" style="color:#c53030;border-color:#fc8181;font-size:.78rem;" onclick="_evrRemoveRecord(${idx})">移除此記錄</button>`
    : '';
  const mkOpts = (arr, cur) => arr.map(v => `<option value="${escHtml(v)}"${v===cur?' selected':''}>${escHtml(v)}</option>`).join('');
  const roomOpts = `<option value="">— 請選擇 —</option>` + mkOpts(ROOMS, r.room);
  const modeOpts = `<option value="">— 請選擇 —</option>` + mkOpts(EVR_MODES, r.interventionMode);
  // Time: check if stored time is a standard period or custom（#039：改用 STD_PERIODS 單一來源）
  const isStdTime = STD_PERIODS.includes(r.time);
  const periodOpts = stdPeriodOptionsHtml(r.time);

  const topicOtherVal     = (r.topics||[]).find(s => s.startsWith('其他：'))?.slice(3) || '';
  const topicOtherChecked = (r.topics||[]).some(s => s === '其他' || s.startsWith('其他：'));
  const topicHtml = EVR_TOPICS.map((t, ti) => {
    if (t === '其他') {
      return `<label><input type="checkbox" name="${pfx}-topic" value="其他"${topicOtherChecked?' checked':''} onchange="_evrToggleTopicOther(this,${idx})"/> ${ti+1}. 其他</label>`;
    }
    return `<label><input type="checkbox" name="${pfx}-topic" value="${escHtml(t)}"${(r.topics||[]).includes(t)?' checked':''}/> ${ti+1}. ${escHtml(t)}</label>`;
  }).join('');

  const itvHtml = EVR_INTERVIEWEES.map(v =>
    `<label style="display:inline-flex;align-items:center;gap:5px;font-size:.88rem;cursor:pointer;"><input type="checkbox" name="${pfx}-interviewee" value="${escHtml(v)}"${(r.interviewees||[]).includes(v)?' checked':''}/> ${escHtml(v)}</label>`
  ).join('');

  const nextBkHtml = idx !== 0 ? '' : `
    <div class="form-section" style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:14px;margin-bottom:14px;">
      <div class="form-section-title" style="margin-top:0;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="${pfx}-next-bk-toggle" onchange="_evrToggleNextBk()" style="width:16px;height:16px;"${r.nextBk?' checked':''}>
          同時預約下次諮商空間
        </label>
      </div>
      <div id="${pfx}-next-bk-fields" style="display:${r.nextBk?'block':'none'};margin-top:10px;">
        <div class="form-grid">
          <div><label class="field-label">空間</label><select class="field-select" id="${pfx}-next-bk-room">${roomOpts}</select></div>
          <div><label class="field-label">日期</label><input type="date" class="field-input" id="${pfx}-next-bk-date" value="${escHtml(r.nextBk?.date||'')}"></div>
          <div><label class="field-label">節次</label><select class="field-select" id="${pfx}-next-bk-period"><option value="">— 請選擇 —</option>${mkOpts(EVR_PERIODS, r.nextBk?.period||'')}</select></div>
        </div>
      </div>
    </div>`;

  const _cardBorder = idx % 2 === 0 ? '2px solid #bee3f8' : '2px solid #9ae6b4';
  const _cardBg     = idx % 2 === 0 ? '' : 'background:#f0fff4;';
  const _titleColor = idx % 2 === 0 ? '#2b6cb0' : '#276749';
  return `
    <div class="form-section" id="evr-card-${idx}" style="margin-bottom:18px;border:${_cardBorder};border-radius:10px;padding:16px;${_cardBg}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:1rem;font-weight:700;color:${_titleColor};">事件處理記錄${idx + 1}</div>
        ${removeBtn}
      </div>
      <div id="${pfx}-alert" class="alert alert-error" style="display:none;margin-bottom:10px;"></div>
      ${nextBkHtml}
      <div class="form-section">
        <div class="form-section-title">晤談基本資訊</div>
        <div class="form-grid">
          <div>
            <label class="field-label">晤談日期<span class="req">*</span></label>
            <input type="date" class="field-input" id="${pfx}-date" onchange="_checkEvrDuplicate(${idx})">
          </div>
          <div>
            <label class="field-label">晤談時間<span class="req">*</span></label>
            <select class="field-select" id="${pfx}-time" onchange="_evrToggleTimeOther(${idx});_checkEvrDuplicate(${idx})">${periodOpts}</select>
            <input type="text" class="field-input" id="${pfx}-time-other" style="display:${(!isStdTime && r.time)?'':'none'};margin-top:6px;max-width:160px;" placeholder="xx:xx-xx:xx" maxlength="11" value="${escHtml(!isStdTime ? r.time : '')}" oninput="_checkEvrDuplicate(${idx})">
            <div id="${pfx}-dup-alert" style="display:none;"></div>
          </div>
          <div>
            <label class="field-label">晤談空間</label>
            <select class="field-select" id="${pfx}-room">${roomOpts}</select>
          </div>
          <div>
            <label class="field-label">介入方式<span class="req">*</span></label>
            <select class="field-select" id="${pfx}-mode">${modeOpts}</select>
          </div>
          <div class="full">
            <label class="field-label">晤談者</label>
            <div id="${pfx}-counselor-chips" style="min-height:36px;padding:6px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;"></div>
            <div style="display:flex;gap:6px;align-items:center;">
              <select id="${pfx}-counselor-add" class="field-select" style="flex:1;max-width:220px;"><option value="">— 新增晤談者 —</option></select>
              <button class="btn btn-secondary btn-sm" type="button" onclick="_evrAddCounselor(${idx})">＋ 加入</button>
            </div>
          </div>
          <div class="full">
            <label class="field-label">晤談對象<span class="req">*</span></label>
            <div style="display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;" onchange="_updateIntervieweeMultiHint('${pfx}-interviewee','${pfx}-interviewee-multi-hint')">${itvHtml}</div>
            <div id="${pfx}-interviewee-multi-hint" style="display:none;font-size:.78rem;color:#718096;margin-top:6px;line-height:1.5;">已勾選多位晤談對象：代表同一場次一起晤談（如伴侶/家庭聯合晤談），統計時整場僅計 1 筆；若為分別晤談，請各自建立一筆紀錄。</div>
            <input type="text" id="${pfx}-interviewee-note" class="field-input" style="margin-top:8px;font-size:.87rem;" placeholder="備註：如高中朋友、爸爸、○○導師…" value="${escHtml(r.intervieweeNote||'')}">
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">會談主題<span class="req">*</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 12px;">${topicHtml}</div>
        <div id="${pfx}-topic-other-wrap" style="display:${topicOtherChecked?'flex':'none'};align-items:center;gap:6px;margin-top:6px;font-size:.88rem;flex-wrap:wrap;">其他說明：<input type="text" id="${pfx}-topic-other" class="field-input" style="width:210px;padding:3px 8px;font-size:.88rem;" placeholder="請說明（必填）" value="${escHtml(topicOtherVal)}" oninput="_validateEvrTopicOther(${idx})"><span id="${pfx}-topic-other-hint" style="color:#e53e3e;font-size:.8rem;display:none;">請填寫其他說明</span></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">此次服務項目<span class="req">*</span></div>
        ${_buildEvrServiceItemsHtml(r, idx)}
      </div>
      <div class="form-section">
        <div class="form-section-title">主述與會談資料<span class="req">*</span></div>
        ${_EVR_TOOLBAR_HTML}
        <div class="rt-editor field-input" id="${pfx}-summary" contenteditable="true" style="min-height:150px;resize:vertical;overflow:auto;white-space:pre-wrap;line-height:1.6;"></div>
        <div id="attachPicker_evr_${idx}" class="attach-picker-wrap"></div>
      </div>
    </div>`;
}

function _evrRestoreCard(r, idx) {
  const pfx = `evr${idx}`;
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  sv(`${pfx}-date`, r.date);
  sv(`${pfx}-room`, r.room);
  sv(`${pfx}-mode`, r.interventionMode);
  sv(`${pfx}-interviewee-note`, r.intervieweeNote || '');
  _updateIntervieweeMultiHint(`${pfx}-interviewee`, `${pfx}-interviewee-multi-hint`); // 回填既有勾選後同步顯示多選提示
  if (r.summary) setRichTextValue(`${pfx}-summary`, r.summary);
  attachInit('evr_' + idx, r.attachments || [], { dropTargets: [`evr${idx}-summary`] });
  if (idx === 0 && r.nextBk) {
    sv(`${pfx}-next-bk-room`,   r.nextBk.room);
    sv(`${pfx}-next-bk-period`, r.nextBk.period);
  }
}

function _evrPopulateCounselorSelect(idx) {
  const sel = document.getElementById(`evr${idx}-counselor-add`);
  if (!sel || !configData?.users) return;
  const existing = (_evrCounselors[idx] || []).map(u => u.email);
  const opts = Object.entries(configData.users)
    .filter(([email, info]) => !info.disabled && !existing.includes(email) && BK_COUNSELING_ROLES.has(info.role || ''))
    .sort(([, a], [, b]) => {
      const oa = COUNSELOR_ROLE_ORDER[a.role || ''] ?? 99, ob = COUNSELOR_ROLE_ORDER[b.role || ''] ?? 99;
      if (oa !== ob) return oa - ob;
      return (a.name || '').localeCompare(b.name || '', 'zh');
    })
    .map(([email, u]) => `<option value="${escHtml(email)}" style="${roleColorOptionStyle(u.role)}">${escHtml(u.name || email)}（${escHtml(u.role||'')}）</option>`)
    .join('');
  sel.innerHTML = '<option value="">— 新增晤談者 —</option>' + opts;
}

function _evrRenderCounselorChips(idx) {
  const wrap = document.getElementById(`evr${idx}-counselor-chips`);
  if (!wrap) return;
  const chips = _evrCounselors[idx] || [];
  if (!chips.length) { wrap.innerHTML = '<span style="color:#a0aec0;font-size:.82rem;">（尚未選擇）</span>'; return; }
  wrap.innerHTML = chips.map(u => {
    const cat = _roleColorCat(u.role);
    return `<span class="${cat ? cat.chipClass : ''}" style="display:inline-flex;align-items:center;gap:4px;border-radius:16px;padding:3px 10px;font-size:.83rem;${cat ? '' : 'background:#bee3f8;'}">
      ${roleColorDotHtml(u.role)}${escHtml(u.label)}${u.role ? `<span style="font-size:.77rem;${cat ? '' : 'color:#2b6cb0;'}">（${escHtml(u.role)}）</span>` : ''}
      <button type="button" onclick="_evrRemoveCounselor(${idx},'${escHtml(u.email)}')" style="background:none;border:none;cursor:pointer;color:${cat ? roleColorFg(u.role) : '#2b6cb0'};padding:0;font-size:1rem;line-height:1;">✕</button>
    </span>`;
  }).join('');
}

function _evrAddCounselor(idx) {
  const sel = document.getElementById(`evr${idx}-counselor-add`);
  const email = sel?.value;
  if (!email) return;
  if (!_evrCounselors[idx]) _evrCounselors[idx] = [];
  if (_evrCounselors[idx].some(u => u.email === email)) return;
  const name = configData?.users?.[email]?.name || email;
  const role = configData?.users?.[email]?.role || '';
  _evrCounselors[idx].push({ email, label: name, role });
  _evrRenderCounselorChips(idx);
  _evrPopulateCounselorSelect(idx);
  _checkEvrDuplicate(idx);
}

function _evrRemoveCounselor(idx, email) {
  if (!_evrCounselors[idx]) return;
  _evrCounselors[idx] = _evrCounselors[idx].filter(u => u.email !== email);
  _evrRenderCounselorChips(idx);
  _evrPopulateCounselorSelect(idx);
  _checkEvrDuplicate(idx);
}

// 事件處理紀錄：即時檢查同個案＋同晤談者＋同時段是否已有既存的事件處理紀錄
function _checkEvrDuplicate(idx) {
  if (!_evrCaseId) return;
  const pfx = `evr${idx}`;
  const date = document.getElementById(`${pfx}-date`)?.value || '';
  const rawTime = document.getElementById(`${pfx}-time`)?.value || '';
  const time = rawTime === '其他' ? (document.getElementById(`${pfx}-time-other`)?.value || '').trim() : rawTime;
  const c = casesData.find(x => x.id === _evrCaseId);
  const records = ((c?.records) || [])
    .filter(r => !r.deleted && r.isEventRecord)
    .map(r => ({ id: r.id, date: r.date, time: r.time, counselorEmails: (r.counselors || []).map(x => x.email).filter(Boolean), createdAt: r.createdAt }));
  const counselorEmails = (_evrCounselors[idx] || []).map(u => u.email).filter(Boolean);
  const match = _dupFindSameSlot(records, { date, time, counselorEmails });
  _dupRenderAlert(`${pfx}-dup-alert`, `evr-${idx}`, match);
}

function _evrToggleNextBk() {
  const tog    = document.getElementById('evr0-next-bk-toggle');
  const fields = document.getElementById('evr0-next-bk-fields');
  if (fields) fields.style.display = tog?.checked ? 'block' : 'none';
}

// ── 服務項目輔助函式 ──

function _evrToggleTimeOther(idx) {
  const sel   = document.getElementById(`evr${idx}-time`);
  const other = document.getElementById(`evr${idx}-time-other`);
  if (other) other.style.display = sel?.value === '其他' ? '' : 'none';
}

function _evrToggleTopicOther(el, idx) {
  const wrap = document.getElementById(`evr${idx}-topic-other-wrap`);
  if (wrap) wrap.style.display = el.checked ? 'flex' : 'none';
  const other = document.getElementById(`evr${idx}-topic-other`);
  const hint  = document.getElementById(`evr${idx}-topic-other-hint`);
  if (!el.checked) {
    if (other) { other.value = ''; other.style.borderColor = ''; }
    if (hint) hint.style.display = 'none';
  } else if (hint && other) {
    hint.style.display = other.value.trim() ? 'none' : '';
  }
}

function _evrToggleSocialRpt(el, idx) {
  const pfx   = `evr${idx}`;
  const panel = document.getElementById(`${pfx}-sp-social-report`);
  if (!panel) return;
  panel.style.display = el.checked ? '' : 'none';
  if (!el.checked) {
    document.querySelectorAll(`input[name="${pfx}-social-report"]`).forEach(c => c.checked = false);
    const oth = document.getElementById(`${pfx}-sp-social-report-other`);
    if (oth) { oth.style.display = 'none'; oth.value = ''; }
  }
}

function _evrToggleSocialRptOther(el, idx) {
  const other = document.getElementById(`evr${idx}-sp-social-report-other`);
  if (other) { other.style.display = el.checked ? 'inline-block' : 'none'; if (!el.checked) other.value = ''; }
}

function _evrToggleReportOther(el, idx) {
  const other = document.getElementById(`evr${idx}-sp-report-other`);
  if (other) { other.style.display = el.checked ? 'inline-block' : 'none'; if (!el.checked) other.value = ''; }
}

function _evrToggleTransfer(idx) {
  const pfx  = `evr${idx}`;
  const type = document.querySelector(`input[name="${pfx}-transfer-type"]:checked`)?.value;
  const div  = document.getElementById(`${pfx}-sp-transfer-counselor`);
  if (div) div.style.display = type === '指定輔導人員' ? '' : 'none';
}

function _evrPopulateTransferSel(idx) {
  const sel = document.getElementById(`evr${idx}-sp-transfer-sel`);
  if (!sel || !configData?.users) return;
  sel.innerHTML = buildCounselorOptgroups();
}

function _evrAddCustomSvcOpt(idx, type) {
  const pfx     = `evr${idx}`;
  const inputId = `${pfx}-sp-${type}-input`;
  const listId  = `${pfx}-sp-${type}-list`;
  const cbName  = `${pfx}-${type}`;
  const inputEl = document.getElementById(inputId);
  const val = (inputEl?.value || '').trim();
  if (!val) return;
  inputEl.value = '';
  const list = document.getElementById(listId);
  if (!list || list.querySelector(`input[value="${val}"]`)) return;
  const lbl = document.createElement('label');
  lbl.innerHTML = `<input type="checkbox" name="${cbName}" value="${escHtml(val)}" checked/> ${escHtml(val)}`;
  list.appendChild(lbl);
}

function _evrAddDynTag(idx, type) {
  const pfx     = `evr${idx}`;
  const inputId = type === 'accompany' ? `${pfx}-sp-accompany-input` : `${pfx}-sp-other-input`;
  const inputEl = document.getElementById(inputId);
  const val = (inputEl?.value || '').trim();
  if (!val) return;
  inputEl.value = '';
  if (!_evrDynTags[idx]) _evrDynTags[idx] = { accompany:[], other:[] };
  if (!_evrDynTags[idx][type].includes(val)) _evrDynTags[idx][type].push(val);
  _evrRenderDynTags(idx, type);
}

function _evrRemoveDynTag(idx, type, name) {
  if (!_evrDynTags[idx]) return;
  _evrDynTags[idx][type] = (_evrDynTags[idx][type] || []).filter(v => v !== name);
  _evrRenderDynTags(idx, type);
}

function _evrRenderDynTags(idx, type) {
  const pfx   = `evr${idx}`;
  const tagsId = type === 'accompany' ? `${pfx}-sp-accompany-tags` : `${pfx}-sp-other-tags`;
  const el    = document.getElementById(tagsId);
  if (!el) return;
  const tags = _evrDynTags[idx]?.[type] || [];
  el.innerHTML = tags.map(name =>
    `<span class="dynamic-tag" data-name="${escHtml(name)}">${escHtml(name)}<button onclick="_evrRemoveDynTag(${idx},'${type}','${escHtml(name)}')" type="button">×</button></span>`
  ).join('');
}

function _evrCollectServiceItems(idx) {
  const pfx   = `evr${idx}`;
  const items = [];
  document.querySelectorAll(`input[name="${pfx}-service-main"]:checked`).forEach(cb => {
    const val = cb.value;
    if (val === '心理測驗') {
      const subs = [...document.querySelectorAll(`input[name="${pfx}-psychtest"]:checked`)].map(c => c.value);
      items.push(subs.length ? `心理測驗：${subs.join('、')}` : '心理測驗');
    } else if (val === '性平行為人') {
      const subs = [...document.querySelectorAll(`input[name="${pfx}-genderequal"]:checked`)].map(c => c.value);
      items.push(subs.length ? `性平行為人：${subs.join('、')}` : '性平行為人');
    } else if (val === '轉介相關資源') {
      const subs = [...document.querySelectorAll(`input[name="${pfx}-referral"]:checked`)].map(c => c.value);
      if (subs.length) subs.forEach(s => items.push(s));
      else items.push('轉介相關資源');
    } else if (val === '責任通報') {
      const subs = [...document.querySelectorAll(`input[name="${pfx}-report"]:checked`)].map(c => {
        if (c.value === '社政通報') {
          const ss = [...document.querySelectorAll(`input[name="${pfx}-social-report"]:checked`)].map(s => {
            if (s.value === '其他') return (document.getElementById(`${pfx}-sp-social-report-other`)?.value || '').trim() || '其他';
            return s.value;
          });
          return ss.length ? `社政通報（${ss.join('、')}）` : '社政通報';
        }
        if (c.value === '其他通報') return (document.getElementById(`${pfx}-sp-report-other`)?.value || '').trim() || '其他通報';
        return c.value;
      });
      items.push(subs.length ? `責任通報：${subs.join('、')}` : '責任通報');
    } else if (val === '陪同服務') {
      const tags = _evrDynTags[idx]?.accompany || [];
      items.push(tags.length ? `陪同服務：${tags.join('、')}` : '陪同服務');
    } else if (val === '內部轉案') {
      const type = document.querySelector(`input[name="${pfx}-transfer-type"]:checked`)?.value;
      if (type === '指定輔導人員') {
        const email = document.getElementById(`${pfx}-sp-transfer-sel`)?.value;
        const name  = configData?.users?.[email]?.name || email;
        items.push(`內部轉案：${name}`);
      } else {
        items.push('內部轉案：分案會議');
      }
    } else if (val === '其他') {
      const tags = _evrDynTags[idx]?.other || [];
      items.push(tags.length ? `其他：${tags.join('、')}` : '其他');
    } else {
      items.push(val);
    }
  });
  return items;
}

// ── 記錄增刪 ──

function _evrSyncFromDom() {
  _evrRecords = _evrRecords.map((_, idx) => {
    const pfx = `evr${idx}`;
    const gv  = id => document.getElementById(id)?.value || '';
    const rawTime = gv(`${pfx}-time`);
    const time = rawTime === '其他' ? (gv(`${pfx}-time-other`) || rawTime) : rawTime;
    return {
      date:             gv(`${pfx}-date`),
      time,
      room:             gv(`${pfx}-room`),
      interventionMode: gv(`${pfx}-mode`),
      counselors:       [...(_evrCounselors[idx] || [])],
      interviewees:     [...document.querySelectorAll(`input[name="${pfx}-interviewee"]:checked`)].map(c => c.value),
      intervieweeNote:  document.getElementById(`${pfx}-interviewee-note`)?.value || '',
      topics:           [...document.querySelectorAll(`input[name="${pfx}-topic"]:checked`)].map(c => {
                          if (c.value === '其他') { const txt = (document.getElementById(`${pfx}-topic-other`)?.value||'').trim(); return txt ? `其他：${txt}` : '其他'; }
                          return c.value;
                        }),
      serviceItems:     _evrCollectServiceItems(idx),
      dynTags:          { accompany: [...(_evrDynTags[idx]?.accompany||[])], other: [...(_evrDynTags[idx]?.other||[])] },
      summary:          getRichTextValue(`${pfx}-summary`),
      nextBk:           idx === 0 ? _evrGetNextBk() : null,
    };
  });
}

function _evrGetNextBk() {
  const tog = document.getElementById('evr0-next-bk-toggle');
  if (!tog?.checked) return null;
  return {
    room:   document.getElementById('evr0-next-bk-room')?.value   || '',
    date:   document.getElementById('evr0-next-bk-date')?.value   || '',
    period: document.getElementById('evr0-next-bk-period')?.value || '',
  };
}

function _evrAddRecord() {
  _evrSyncFromDom();
  const prev  = _evrRecords[_evrRecords.length - 1] || _evrEmptyRecord();
  const newRec = {
    date: prev.date, time: prev.time, room: prev.room,
    counselors: [...prev.counselors], interviewees: [...prev.interviewees], intervieweeNote: '',
    interventionMode: prev.interventionMode,
    topics: [], serviceItems: [], dynTags: { accompany:[], other:[] }, summary: '', nextBk: null,
  };
  _evrRecords.push(newRec);
  _evrCounselors.push([...(prev.counselors || [])]);
  _evrDynTags.push({ accompany:[], other:[] });
  _renderEvrCards();
  attachInit('evr_' + (_evrRecords.length - 1), [], { dropTargets: [`evr${_evrRecords.length - 1}-summary`] });
  document.getElementById(`evr-card-${_evrRecords.length - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _evrRemoveRecord(idx) {
  if (idx === 0 || idx >= _evrRecords.length) return;
  _evrSyncFromDom();
  _evrRecords.splice(idx, 1);
  _evrCounselors.splice(idx, 1);
  _evrDynTags.splice(idx, 1);
  _renderEvrCards();
}

// ── 退出 / 暫存 / 儲存 ──

// 純函式：一組事件處理記錄快照是否「全部空白」（v265 抽出，原本內嵌於 exitEventRecordForm）——
// 供離開表單判斷捨棄 vs 詢問、以及側選單/banner 切頁守門判斷 dirty 共用，避免雙實作。
function _evrRecordsAllEmpty(records) {
  return (records || []).every(r => {
    const _rtE = v => !(v||'').replace(/<[^>]*>/g,'').trim();
    return !r.date && !r.time && !r.room && !r.counselors.length && !r.interviewees.length &&
           !r.topics.length && !r.serviceItems.length && _rtE(r.summary);
  });
}

// v265：目前 evr 表單是否有未儲存輸入（供側選單/banner 切頁守門用）——先把 DOM 同步進 _evrRecords
// 再比對，與 exitEventRecordForm 的判斷邏輯一致。未開表單（_evrCaseId 為 null）一律視為不 dirty。
function _evrHasUnsavedInput() {
  if (!_evrCaseId) return false;
  _evrSyncFromDom();
  return !_evrRecordsAllEmpty(_evrRecords);
}

function exitEventRecordForm() {
  if (!_evrCaseId) { renderEventRecordsPage(); return; }
  _evrSyncFromDom();
  if (_evrRecordsAllEmpty(_evrRecords)) { discardEventRecords(); return; }
  _showExitDialog('離開事件處理記錄表',
    () => saveEventRecords(),
    () => draftEventRecords(),
    () => discardEventRecords()
  );
}

function discardEventRecords() {
  _stopEvrAutosave();
  if (_evrDraftKey) localStorage.removeItem(_evrDraftKey);
  const origin = _evrOrigin;
  const caseId = _evrCaseId;
  _evrCaseId = null; _evrRecords = []; _evrCounselors = []; _evrDynTags = [];
  _evrDraftKey = null; _evrTodoId = null; _evrOrigin = null;
  if (origin === 'case-detail' && caseId) { showCaseDetail(caseId); return; }
  renderEventRecordsPage();
}

function draftEventRecords() {
  _evrSyncFromDom();
  const caseObj = casesData.find(c => c.id === _evrCaseId);
  if (!caseObj) { showToast('無法暫存：個案不存在', 'error'); return; }
  const draftData = { caseId: _evrCaseId, records: _evrRecords };
  const existingTodo = _evrTodoId ? todosData.find(t => t.id === _evrTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  _evrTodoId = todoId;
  _putTodoItem({
    id: todoId, type: 'event_records', label: '事件處理記錄草稿',
    caseId: _evrCaseId, caseLabel: `${caseObj.name}（${_evrCaseId}）`,
    draftData: { ...draftData, todoId }, origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  _stopEvrAutosave();
  if (_evrDraftKey) localStorage.removeItem(_evrDraftKey);
  _evrCaseId = null; _evrRecords = []; _evrCounselors = [];
  _evrDraftKey = null;
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

async function saveEventRecords() {
  _evrSyncFromDom();
  let firstErrIdx = -1;
  _evrRecords.forEach((r, idx) => {
    const cardErrs = [];
    if (!r.date)             cardErrs.push('請填寫晤談日期');
    if (!r.time)             cardErrs.push('請選擇晤談時間');
    if (!r.interventionMode) cardErrs.push('請選擇介入方式');
    if (!r.interviewees.length) cardErrs.push('請選擇晤談對象');
    if (!r.topics.length)    cardErrs.push('請至少勾選一項會談主題');
    else if (r.topics.includes('其他')) {
      cardErrs.push('請填寫會談主題「其他」的說明');
      const _hint = document.getElementById(`evr${idx}-topic-other-hint`);
      if (_hint) _hint.style.display = '';
      const _el = document.getElementById(`evr${idx}-topic-other`);
      if (_el) _el.style.borderColor = '#e53e3e';
    }
    if (!r.serviceItems.length) cardErrs.push('請至少勾選一項服務項目');
    if (!(r.summary||'').replace(/<[^>]*>/g,'').trim()) cardErrs.push('請填寫主述與會談資料');
    const alertEl = document.getElementById(`evr${idx}-alert`);
    if (alertEl) {
      if (cardErrs.length) {
        alertEl.textContent = cardErrs.join('；');
        alertEl.style.display = '';
        if (firstErrIdx === -1) firstErrIdx = idx;
      } else {
        alertEl.style.display = 'none';
      }
    }
  });
  if (firstErrIdx >= 0) {
    document.getElementById(`evr-card-${firstErrIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const cidx = casesData.findIndex(c => c.id === _evrCaseId);
  if (cidx === -1) { showToast('個案不存在', 'error'); return; }
  if (!casesData[cidx].records) casesData[cidx].records = [];
  const now = new Date().toISOString();
  const rand = () => Math.random().toString(36).slice(2, 6);
  const _evrAttachMap = {};
  for (let idx = 0; idx < _evrRecords.length; idx++) {
    try { _evrAttachMap[idx] = await attachFlush('evr_' + idx); }
    catch(e) { showToast('第' + (idx+1) + '筆附件上傳失敗：' + e.message, 'error'); return; }
  }
  const _evrNewIds = [];
  const _evrPushedNewIds = []; // 僅記錄本次真正新增（非同時段合併覆蓋）的紀錄 id，供儲存失敗回滾用
  const _evrMergedCount = { n: 0 }; // 供稽核日誌統計整合筆數用（forEach 內為區塊作用域，故用物件承接）
  const _evrFirstDate = _evrRecords[0]?.date || '';
  // 儲存前記憶體快照：待會 _evrRecords 會被清空並跳轉離開表單，先深拷貝供還原用
  const _evrSnapForRestore = { records: JSON.parse(JSON.stringify(_evrRecords)), todoId: _evrTodoId, origin: _evrOrigin };
  _evrRecords.forEach((r, idx) => {
    const _evrRecObj = {
      isEventRecord: true, recordKind: '晤談記錄',
      date: r.date, time: r.time, room: r.room,
      counselors: r.counselors,
      counselorName: (r.counselors || []).map(u => u.label).join('、'),
      interviewees: r.interviewees, interventionMode: r.interventionMode,
      topics: r.topics, serviceItems: r.serviceItems,
      summary: r.summary, status: 'done',
      attachments: _evrAttachMap[idx] || [],
      updatedAt: now,
    };
    // ── 同時段重複紀錄檢核（#9）：儲存前最後把關 ──
    const _evrDupList = (casesData[cidx].records || [])
      .filter(x => !x.deleted && x.isEventRecord)
      .map(x => ({ id: x.id, date: x.date, time: x.time, counselorEmails: (x.counselors || []).map(u => u.email).filter(Boolean), createdAt: x.createdAt }));
    const _evrDupMatch = _dupFindSameSlot(_evrDupList, {
      date: r.date, time: r.time, counselorEmails: (r.counselors || []).map(u => u.email).filter(Boolean),
    });
    if (_evrDupMatch && _dupResolveAtSave(`evr-${idx}`, _evrDupMatch) === 'merge') {
      const _tgtIdx = casesData[cidx].records.findIndex(x => x.id === _evrDupMatch.id);
      if (_tgtIdx >= 0) {
        Object.assign(casesData[cidx].records[_tgtIdx], _evrRecObj);
        _evrNewIds.push(_evrDupMatch.id);
        _evrMergedCount.n++;
        return;
      }
    }
    const _evrNewId = `REC_${Date.now()}_E${idx}_${rand()}`;
    _evrNewIds.push(_evrNewId);
    _evrPushedNewIds.push(_evrNewId);
    casesData[cidx].records.push({ id: _evrNewId, creatorEmail: currentUser?.email, createdAt: now, ..._evrRecObj });
  });
  if (_evrTodoId) {
    const todo = todosData.find(t => t.id === _evrTodoId);
    if (todo) { todo.done = true; todo.doneAt = now; }
  }
  _stopEvrAutosave();
  if (_evrDraftKey) localStorage.removeItem(_evrDraftKey);
  const savedCaseId = _evrCaseId;
  const savedTodoId = _evrTodoId;
  _evrCaseId = null; _evrRecords = []; _evrCounselors = [];
  _evrDraftKey = null; _evrTodoId = null;
  _switchDetailSemTo(casesData[cidx], openDateToSemPrefix(_evrFirstDate));
  showCaseDetail(savedCaseId);
  _evrNewIds.forEach((id, i) => _flashRecordCard('rec-card-' + id, i === 0));
  showToast('事件處理記錄已儲存', 'success');
  const jobId = bgJobAdd('儲存事件處理記錄…');
  _armSaveFailSnapshot('事件處理記錄', 'page-event-records',
    () => openEventRecordForm(savedCaseId, { records: _evrSnapForRestore.records, todoId: _evrSnapForRestore.todoId }, _evrSnapForRestore.origin),
    saveEventRecords, jobId);
  try {
    await saveCasesChunks(savedCaseId);
    bgJobDone(jobId, '已儲存');
    _clearSaveFailSnapshot(jobId);
    auditLog('新增事件處理記錄', savedCaseId, null, _evrMergedCount.n ? `覆蓋 ${_evrMergedCount.n} 筆同時段紀錄` : '');
    if (savedTodoId) saveUserTodos().catch(() => {});
  } catch (e) {
    // 尚未持久化成功，回滾本次真正新增的紀錄（同時段合併覆蓋的既有紀錄不動），避免「重新儲存」造成重複資料
    const _ci = casesData.findIndex(x => x.id === savedCaseId);
    if (_ci >= 0) {
      _evrPushedNewIds.forEach(id => {
        const _ri = casesData[_ci].records.findIndex(r => r.id === id);
        if (_ri >= 0) casesData[_ci].records.splice(_ri, 1);
      });
    }
    bgJobFail(jobId, e.message);
    _showSaveFailModal(e.message, jobId);
  }
}

// ── 自動備援 ──

function _startEvrAutosave() {
  _stopEvrAutosave();
  _evrDraftTimer = setInterval(() => {
    if (!_evrCaseId || !_evrDraftKey) return;
    _evrSyncFromDom();
    try {
      localStorage.setItem(_evrDraftKey, JSON.stringify({ records: _evrRecords, caseId: _evrCaseId, savedAt: new Date().toISOString() }));
      const el = document.getElementById('evr-draft-status');
      if (el) el.textContent = `草稿備援 ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`;
    } catch (_) {}
  }, 60000);
}

function _stopEvrAutosave() {
  if (_evrDraftTimer) { clearInterval(_evrDraftTimer); _evrDraftTimer = null; }
}
