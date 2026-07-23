// dev/case-mgmt.js — 案號管理＋個案新增模組（拆 index.html 絞殺者第二十八刀，v275）。
// 內容為從 index.html 逐字搬出的連續區段（案號管理頁/主號對調、個案新增表單/案號
// 建議/重複檢核/BSRS 按鈕組/saveCase）。
// 載入期副作用（column-0 複核）：數個 let x = new Set()（內建）與一個 document click
// 委派（.bsrs-opt 按鈕組，共用於個案新增與身心狀態評估表）——無 stopPropagation
// 依賴、與其他 click 委派選擇器互斥，註冊順序前移無行為差異。可安全前移到主
// inline script 之前載入（刀法①）。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  案號管理
// ══════════════════════════════════════════════
let _cnSavePrefTimer = null;
function _saveCnPrefs() {
  clearTimeout(_cnSavePrefTimer);
  _cnSavePrefTimer = setTimeout(() => saveUserTodos(), 1200);
}
// v173：_cnArchived/_cnClosureStatus 存檔格式相容轉換——舊資料是單一字串（''=全部／值=該選項），
// 新版改 Set 可複選；空字串→空 Set（不篩，語意不變）、非空字串→包該值的單元素 Set（語意不變）。
function _cnPrefToSet(v) {
  return new Set(Array.isArray(v) ? v : (v ? [v] : []));
}
function _cnClearFilters() {
  _cnArchived = new Set(['unarchived']);
  _cnClosureStatus = new Set();
  _cnCounselor = '';
  _cnAbType = new Set();
  _cnPage = 1;
  _cnSelected.clear();
  const searchEl = document.getElementById('cn-search');
  if (searchEl) searchEl.value = '';
  renderCaseNums();
  _saveCnPrefs();
}
// v173：封存／狀態／案別改收合式勾選面板，_cnArchived/_cnClosureStatus/_cnAbType 型別由字串改為 Set
// （同群組可複選＝OR）；_cnArchived 預設勾「未封存」沿用改版前預設行為。
let _cnPage = 1;
let _cnPageSize = 30;
let _cnComposing = false;
let _cnArchived = new Set(['unarchived']);
let _cnClosureStatus = new Set();
let _cnCounselor = '';
let _cnAbType = new Set(); // A案/B案篩選（空集合 = 全部）
let _cnSelected = new Set();
let _casesSelected = new Set();

// v226：工具列常駐「📦 含已封存」捷徑——鏡射篩選面板「封存」群組（勾=不限封存、取消=回到預設
// 「未封存」），封存篩選不再只藏在漏斗面板裡。若使用者在面板單勾「已封存」，此勾選框也視為
// 「含已封存」＝勾選狀態（語意：目前列表可能出現已封存個案）。
function _cnIncludesArchived() { return _cnArchived.size === 0 || _cnArchived.has('archived'); }
function _cnToggleIncludeArchived(on) {
  _cnArchived = on ? new Set() : new Set(['unarchived']);
  _cnPage = 1;
  _cnSelected.clear();
  renderCaseNums();
  _saveCnPrefs();
}
// 案號查詢頁「封存／狀態／案別」勾選面板的群組定義（供首次渲染與 surgical update 共用，避免兩處重複維護）
function _cnFilterPanelGroups() {
  return [
    { key: 'archived', title: '封存', options: [
      { value: 'unarchived', label: '未封存' },
      { value: 'archived', label: '已封存' },
    ] },
    { key: 'closure', title: '狀態', options: [
      { value: 'active', label: '未結案' },
      { value: 'closed', label: '已結案' },
    ] },
    { key: 'abType', title: '案別', options: [
      { value: 'A案', label: 'A案' },
      { value: 'B案', label: 'B案' },
    ] },
  ];
}
function renderCaseNums(resetPage) {
  if (resetPage) _cnPage = 1;
  const isAdminUser = currentRole === '主任' || extraRole === '管理者';
  let visible = casesData; // 所有使用者可檢視全部個案

  // 完全無個案（篩選前）→ 直接顯示空狀態
  const body = document.getElementById('casenums-body');
  if (!visible.length && !document.getElementById('cn-search')) {
    body.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>無可檢視的個案</p></div>`;
    return;
  }

  // v173：封存／狀態／案別改收合式勾選面板，同群組 OR、跨群組 AND（見 _filterPanelMatch）；
  // closure 標籤沿用改版前 if/else if 的互斥判定（僅二態，OR 語意等價）
  // v226：搜尋時略過「封存」篩選——預設「未封存」會讓已封存個案怎麼搜都搜不到（看起來像個案
  // 消失）；有搜尋字串即視為全域查找，封存與否都要能命中（狀態/案別/主責篩選照舊生效）。
  // 已封存列在案號旁以 📦 徽章標示（見下方 rows）。q 的讀取因此從分頁計算處提前到這裡。
  const q = document.getElementById('cn-search')?.value?.trim().toLowerCase() || '';
  const _cnActiveGroups = { archived: q ? [] : [..._cnArchived], closure: [..._cnClosureStatus], abType: [..._cnAbType] };
  visible = visible.filter(c => _filterPanelMatch({
    archived: c.archived ? ['archived'] : ['unarchived'],
    closure: (c.status === 'closed' && !_hasPastUnclosed(c)) ? ['closed'] : ['active'],
    abType: [_caseLatestAbType(c)].filter(Boolean),
  }, _cnActiveGroups));

  const counselorMap = new Map();
  visible.forEach(c => {
    const key = c.counselorEmail || c.counselorName || c.counselorText || '';
    if (!key) return;
    const label = c.counselorEmail
      ? (formatCounselorLabel(c.counselorEmail) || c.counselorName || c.counselorEmail)
      : (c.counselorText || c.counselorName || key);
    if (!counselorMap.has(key)) counselorMap.set(key, label);
  });
  if (_cnCounselor) visible = visible.filter(c => {
    const key = c.counselorEmail || c.counselorName || c.counselorText || '';
    return key === _cnCounselor;
  });

  // 篩選後為空 → 繼續渲染 filter bar，表格顯示「無符合結果」（讓使用者能清除篩選）

  const studentSems = {};
  const studentSemCounselors = {};
  const studentSemStatus = {};
  const studentSemLight = {};
  const studentSemCaseId = {};
  casesData.forEach(c => {
    if (!c.studentId) return;
    const caseSems = (Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)]).filter(Boolean);
    caseSems.forEach(sem => {
      if (!studentSems[c.studentId]) studentSems[c.studentId] = new Set();
      studentSems[c.studentId].add(sem);
      if (!studentSemCounselors[c.studentId]) studentSemCounselors[c.studentId] = {};
      if (!studentSemStatus[c.studentId]) studentSemStatus[c.studentId] = {};
      if (!studentSemLight[c.studentId]) studentSemLight[c.studentId] = {};
      if (!studentSemCaseId[c.studentId]) studentSemCaseId[c.studentId] = {};
      studentSemCounselors[c.studentId][sem] = configData?.users?.[c.counselorEmail]?.name || c.counselorName || c.counselorText || '';
      studentSemStatus[c.studentId][sem] = (c.semesterStatus?.[sem] || c.status || 'active');
      if (!studentSemCaseId[c.studentId][sem]) studentSemCaseId[c.studentId][sem] = [];
      studentSemCaseId[c.studentId][sem].push(c.id);
      const evals = c.semesterEvaluations || [];
      const hasTypedClosures = evals.some(e => e.type === 'closure');
      const ev = evals.find(e => e.type === 'closure' && e.semester === sem) || (!hasTypedClosures ? (c.closureEvaluation || null) : null);
      studentSemLight[c.studentId][sem] = ev?.light || ev?.statusLight || '';
    });
  });

  const filtered = q
    ? visible.filter(c => (c.id||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q) || (c.studentId||'').toLowerCase().includes(q) ||
        (c.formerIds || []).some(f => (f.id||'').toLowerCase().includes(q))) // 曾用案號也要能被搜尋命中
    : visible;

  const total = filtered.length;
  const pageSize = _cnPageSize === 0 ? total : _cnPageSize;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  if (_cnPage > totalPages) _cnPage = totalPages;
  const start = (_cnPage - 1) * pageSize;
  const paged = pageSize > 0 ? filtered.slice(start, start + pageSize) : filtered;

  const allPageIds = paged.filter(c => !c.deleted).map(c => c.id);
  const allChecked = allPageIds.length > 0 && allPageIds.every(id => _cnSelected.has(id));
  const someChecked = allPageIds.some(id => _cnSelected.has(id));

  const rows = paged.map(c => {
    const sems = c.studentId ? [...(studentSems[c.studentId] || [])].sort() : [];
    const semChips = sems.map(s => {
      const lightKey = studentSemLight[c.studentId]?.[s] || '';
      const semStatus = studentSemStatus[c.studentId]?.[s] || 'active';
      const lightStyles = {
        '紅燈': { bg:'#fde8e8', border:'#fc8181', color:'#c0392b' },
        '橙燈': { bg:'#fdebd0', border:'#f6ad55', color:'#9c4a00' },
        '黃燈': { bg:'#fef9e7', border:'#ecc94b', color:'#7d6608' },
        '綠燈': { bg:'#d5f5e3', border:'#68d391', color:'#1d6a3a' },
      };
      const _curSem = currentSemesterPrefix();
      const { bg, border, color } = lightStyles[lightKey]
        || (semStatus !== 'closed'
          ? (s < _curSem ? { bg:'#f3e8ff', border:'#a855f7', color:'#6b21a8' } : { bg:'#ebf8ff', border:'#63b3ed', color:'#2b6cb0' })
          : { bg:'#f0f4f8', border:'#cbd5e0', color:'#718096' });
      const caseIds = studentSemCaseId[c.studentId]?.[s] || [c.id];
      if (caseIds.length > 1) {
        return caseIds.map((cid, _idx) => {
          const _c2 = casesData.find(x => x.id === cid) || {};
          const _cn2 = configData?.users?.[_c2.counselorEmail]?.name || _c2.counselorName || _c2.counselorText || '';
          const _ev2 = (_c2.semesterEvaluations||[]).find(e=>e.type==='closure'&&e.semester===s) || (!(_c2.semesterEvaluations||[]).some(e=>e.type==='closure') ? _c2.closureEvaluation : null);
          const _lk2 = _ev2?.light || _ev2?.statusLight || '';
          const _st2 = _c2.semesterStatus?.[s] || _c2.status || 'active';
          const {bg:bg2,border:border2,color:color2} = lightStyles[_lk2] || (_st2!=='closed'?(s<_curSem?{bg:'#f3e8ff',border:'#a855f7',color:'#6b21a8'}:{bg:'#ebf8ff',border:'#63b3ed',color:'#2b6cb0'}):{bg:'#f0f4f8',border:'#cbd5e0',color:'#718096'});
          return `<span onclick="event.stopPropagation();showCaseDetailAtSem('${escHtml(cid)}','${escHtml(s)}')" style="display:inline-block;background:${bg2};border:1px solid ${border2};color:${color2};border-radius:10px;padding:1px 8px;font-size:.78rem;margin:1px 2px;white-space:nowrap;cursor:pointer;" data-tip="此學期有${caseIds.length}筆開案">${escHtml(semesterLabel(s))}_${_idx+1}${_cn2?`<span style="font-size:.7rem;opacity:.75;margin-left:3px;">${escHtml(_cn2)}</span>`:''}</span>`;
        }).join('');
      }
      const cName = studentSemCounselors[c.studentId]?.[s] || '';
      const chipCaseId = caseIds[0];
      return `<span onclick="event.stopPropagation();showCaseDetailAtSem('${escHtml(chipCaseId)}','${escHtml(s)}')" style="display:inline-block;background:${bg};border:1px solid ${border};color:${color};border-radius:10px;padding:1px 8px;font-size:.78rem;margin:1px 2px;white-space:nowrap;cursor:pointer;" data-tip="點選跳至該學期詳細資料">${escHtml(semesterLabel(s))}${cName ? `<span style="font-size:.7rem;opacity:.75;margin-left:3px;">${escHtml(cName)}</span>` : ''}</span>`;
    }).join('') || '<span style="color:#a0aec0;">—</span>';
    const editBtn = !c.deleted
      ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();editCaseNum('${escHtml(c.id)}')">修改案號</button>`
      : '—';
    const canCheck = !c.deleted;
    const chk = canCheck
      ? `<input type="checkbox" class="cn-row-chk" data-id="${escHtml(c.id)}" ${_cnSelected.has(c.id) ? 'checked' : ''} onchange="event.stopPropagation();_cnChkChange(this)">`
      : '';
    const _cnRowClass = c.deleted ? 'case-deleted-row'
                      : c.archived ? 'case-archived-row'
                      : c.status === 'closed' ? 'case-closed-row'
                      : '';
    // 曾用案號徽章（一學生一案號合併遷移後，被併掉的舊案號改列於此，供查閱歷史）
    const formerIdsBadge = (c.formerIds || []).length
      ? `<div style="font-size:.7rem;color:#a0aec0;margin-top:2px;" data-tip="曾用於：${escHtml(c.formerIds.map(f => `${f.id}（${(f.semesters||[]).map(semesterLabel).join('、')}）`).join('、'))}">曾用：${escHtml(c.formerIds.map(f => f.id).join('、'))}</div>`
      : '';
    return `
    <tr class="${_cnRowClass}" style="cursor:${c.deleted?'default':'pointer'};" ${c.deleted?'':` onclick="showCaseDetail('${escHtml(c.id)}')"`}>
      <td style="width:36px;text-align:center;" onclick="event.stopPropagation()">${chk}</td>
      <td><strong style="color:#1a5276;">${escHtml(c.id || '—')}</strong>${c.archived ? ' <span data-tip="此個案已封存" style="font-size:.8rem;">📦</span>' : ''}${formerIdsBadge}</td>
      <td>${escHtml(c.name || '—')} ${_semStatusBadgeHtml(c)}</td>
      <td>${escHtml(c.studentId || '—')}</td>
      <td>${semChips}</td>
      <td>${editBtn}</td>
    </tr>`;
  }).join('');

  const pageSizeOptions = [30, 50, 100, 0].map(n =>
    `<option value="${n}" ${_cnPageSize === n ? 'selected' : ''}>${n === 0 ? '全部' : n}</option>`
  ).join('');
  const paginationHtml = totalPages > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;justify-content:center;padding:10px 0;">
      <button class="btn btn-secondary btn-sm" onclick="_cnPage=1;renderCaseNums()" ${_cnPage===1?'disabled':''}>«</button>
      <button class="btn btn-secondary btn-sm" onclick="_cnPage--;renderCaseNums()" ${_cnPage===1?'disabled':''}>‹</button>
      <span style="font-size:.85rem;color:#4a5568;">第 ${_cnPage} / ${totalPages} 頁（共 ${total} 筆）</span>
      <button class="btn btn-secondary btn-sm" onclick="_cnPage++;renderCaseNums()" ${_cnPage===totalPages?'disabled':''}>›</button>
      <button class="btn btn-secondary btn-sm" onclick="_cnPage=${totalPages};renderCaseNums()" ${_cnPage===totalPages?'disabled':''}>»</button>
    </div>` : '';

  const emptyRow = '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:20px;">無符合結果</td></tr>';

  // 若 #cn-search 已存在，只更新動態部分（不銷毀 input，保留 IME session）
  if (document.getElementById('cn-search')) {
    const titleEl = document.getElementById('cn-title');
    if (titleEl) titleEl.textContent = `案號查詢（共 ${total} 筆${q ? '，符合搜尋' : ''})`;
    const tbodyEl = document.getElementById('cn-tbody');
    if (tbodyEl) tbodyEl.innerHTML = rows || emptyRow;
    const pTop = document.getElementById('cn-pagination-top');
    if (pTop) pTop.innerHTML = paginationHtml;
    const pBot = document.getElementById('cn-pagination-bot');
    if (pBot) pBot.innerHTML = paginationHtml;
    const sel = document.getElementById('cn-pagesize');
    if (sel) sel.value = String(_cnPageSize);
    _fpSyncPanel('cn', _cnFilterPanelGroups(), { archived: _cnArchived, closure: _cnClosureStatus, abType: _cnAbType }, '_cnPage=1;_cnSelected.clear();renderCaseNums();_saveCnPrefs()');
    const incA = document.getElementById('cn-include-archived');
    if (incA) incA.checked = _cnIncludesArchived();
    const _cnIsDefaultArchived = _cnArchived.size === 1 && _cnArchived.has('unarchived');
    const clearBtn = document.getElementById('cn-clear-btn');
    if (clearBtn) clearBtn.disabled = (_cnIsDefaultArchived && !_cnClosureStatus.size && !_cnCounselor && !_cnAbType.size && !(document.getElementById('cn-search')?.value?.trim()));
    const cnslSel = document.getElementById('cn-counselor');
    if (cnslSel) {
      cnslSel.innerHTML = buildCounselorFilterOpts(_cnCounselor, true, '全部人員');
    }
    const saEl = document.getElementById('cn-select-all');
    if (saEl) { saEl.checked = allChecked; saEl.indeterminate = !allChecked && someChecked; }
    _syncCnBatchBar();
    return;
  }

  // 第一次渲染：建立完整結構（含穩定 ID 供後續 surgical update 用）
  body.innerHTML = `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:8px;">
        <h3 id="cn-title">案號查詢（共 ${total} 筆${q ? '，符合搜尋' : ''}）</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="search" id="cn-search" class="field-input" placeholder="搜尋案號／姓名／學號…"
            style="max-width:220px;padding:5px 10px;font-size:.87rem;"
            oninput="if(!_cnComposing){_cnPage=1;renderCaseNums()}"
            oncompositionstart="_cnComposing=true"
            oncompositionend="_cnComposing=false;_cnPage=1;renderCaseNums()" />
          <select id="cn-counselor" class="field-input" style="padding:4px 6px;font-size:.85rem;"
            onchange="_cnCounselor=this.value;_cnPage=1;renderCaseNums()">
            ${buildCounselorFilterOpts(_cnCounselor, true, '全部人員')}
          </select>
          ${_fpButtonHtml('cn')}
          <label style="font-size:.85rem;color:#718096;white-space:nowrap;display:flex;align-items:center;gap:4px;">每頁
            <select id="cn-pagesize" class="field-input" style="padding:4px 6px;font-size:.85rem;"
              onchange="_cnPageSize=parseInt(this.value);_cnPage=1;renderCaseNums()">${pageSizeOptions}</select>筆
          </label>
          <button id="cn-clear-btn" class="btn btn-secondary btn-sm" onclick="_cnClearFilters()" style="flex-shrink:0;"
            ${(_cnArchived.size===1 && _cnArchived.has('unarchived') && !_cnClosureStatus.size && !_cnCounselor && !_cnAbType.size)?'disabled':''}>清除篩選</button>
          <button class="btn btn-secondary btn-sm" onclick="_resetCnColWidths()" style="flex-shrink:0;" data-tip="清除已儲存的欄寬設定，恢復預設比例">重設欄寬</button>
          ${_fpPanelHtml('cn')}
        </div>
      </div>
      <div id="cn-batch-bar" style="display:none;padding:8px 16px;background:#ebf8ff;border-bottom:1px solid #bee3f8;display:flex;align-items:center;gap:10px;">
        <span id="cn-batch-count" style="font-size:.87rem;color:#2b6cb0;font-weight:600;"></span>
        <button class="btn btn-secondary btn-sm"
          data-tip="將所有勾選個案封存。封存後可透過篩選「已封存」查閱，統計分析仍計入。"
          onclick="batchArchiveCases([..._cnSelected])">📦 批次封存</button>
        <button class="btn btn-secondary btn-sm"
          data-tip="將所有勾選個案解除封存，使其重新出現在未封存列表中。"
          onclick="batchUnarchiveCases([..._cnSelected])">♻️ 批次解封</button>
        <button class="btn btn-secondary btn-sm" onclick="_cnSelected.clear();renderCaseNums()">取消選取</button>
      </div>
      <div id="cn-pagination-top">${paginationHtml}</div>
      <div style="overflow-x:auto;">
        <table>
          <colgroup>
            <col style="width:36px;">
            <col id="cn-col-1"><col id="cn-col-2"><col id="cn-col-3"><col id="cn-col-4"><col id="cn-col-5">
          </colgroup>
          <thead>
            <tr>
              <th style="width:36px;text-align:center;">
                <input type="checkbox" id="cn-select-all" title="全選當頁"
                  ${allChecked ? 'checked' : ''}
                  onchange="_cnSelectAll(this.checked)">
              </th>
              <th data-col="1">案號</th><th data-col="2">姓名</th><th data-col="3">學號</th><th data-col="4">開案學期歷史</th><th data-col="5">操作</th>
            </tr>
          </thead>
          <tbody id="cn-tbody">${rows || emptyRow}</tbody>
        </table>
      </div>
      <div id="cn-pagination-bot">${paginationHtml}</div>
    </div>` + (isAdminUser ? _migCardHtml() + _rechunkCardHtml() : '');
  document.getElementById('cn-select-all').indeterminate = !allChecked && someChecked;
  _fpSyncPanel('cn', _cnFilterPanelGroups(), { archived: _cnArchived, closure: _cnClosureStatus, abType: _cnAbType }, '_cnPage=1;_cnSelected.clear();renderCaseNums();_saveCnPrefs()');
  _syncCnBatchBar();
  _makeCnTableResizable();
  if (isAdminUser) _migRefreshUI();
}

// ══════════════════════════════════════════════
// ── 個案架構重構 Slice 2：一學生一案號遷移引擎（UI／執行；僅系統管理者可見）──
// ══════════════════════════════════════════════
let _migPlan = null;          // dry-run 結果，供②執行合併使用
let _migBackupPrefix = '';    // 本次備份檔名前綴（cases/{prefix}-partN.json / -meta.json）

function _migCardHtml() {
  return `
    <div class="card" id="mig-card" style="margin-top:16px;">
      <div class="card-header"><h3>🧬 一學生一案號遷移（Slice 2）</h3></div>
      <div style="padding:16px;">
        <div style="font-size:.85rem;color:#718096;margin-bottom:10px;">
          一次性遷移工具：偵測同一學生名下的多筆歷史案號，合併為單一主案號（曾用案號可查、可對調）。僅系統管理者可見與操作，執行前會先全量備份。
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-secondary" id="mig-btn-dryrun" onclick="_migRunDryRun()">① 備份＋Dry-run 分析</button>
          <button class="btn btn-danger" id="mig-btn-exec" onclick="_migExecute()" disabled>② 執行合併</button>
        </div>
        <div id="mig-status" style="font-size:.85rem;color:#4a5568;margin-bottom:10px;"></div>
        <div id="mig-report"></div>
      </div>
    </div>`;
}

function _migRefreshUI() {
  const btnExec = document.getElementById('mig-btn-exec');
  if (btnExec) btnExec.disabled = !(_migPlan && _migPlan.groups.length);
  const reportEl = document.getElementById('mig-report');
  if (reportEl && _migPlan) reportEl.innerHTML = _migRenderReport(_migPlan);
}

// 全量備份：casesData 切片（每 part ≤200 筆）寫入 cases/migration-backup-{ISO}-partN.json，
// 另存 -meta.json（parts 數、總筆數、manifest、users allowedCases(Sems) 快照、transferData）
async function _migBackup() {
  const nonDeleted = casesData.filter(c => c?.id && !c.deleted);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  _migBackupPrefix = `migration-backup-${ts}`;
  const PART_SIZE = 200;
  const parts = [];
  for (let i = 0; i < nonDeleted.length; i += PART_SIZE) parts.push(nonDeleted.slice(i, i + PART_SIZE));
  for (let i = 0; i < parts.length; i++) {
    await driveSaveJsonInCases(`${_migBackupPrefix}-part${i + 1}.json`, { cases: parts[i] });
  }
  const usersSnapshot = {};
  Object.entries(configData?.users || {}).forEach(([email, info]) => {
    usersSnapshot[email] = { allowedCases: info?.allowedCases || [], allowedCasesSems: info?.allowedCasesSems || {} };
  });
  await driveSaveJsonInCases(`${_migBackupPrefix}-meta.json`, {
    createdAt: new Date().toISOString(),
    parts: parts.length,
    totalCases: nonDeleted.length,
    casesManifest: JSON.parse(JSON.stringify(casesManifest)),
    usersSnapshot,
    transferData: JSON.parse(JSON.stringify(transferData || [])),
  });
}

async function _migRunDryRun() {
  const statusEl = document.getElementById('mig-status');
  const reportEl = document.getElementById('mig-report');
  const btnExec  = document.getElementById('mig-btn-exec');
  _migPlan = null;
  if (btnExec) btnExec.disabled = true;
  if (reportEl) reportEl.innerHTML = '';
  try {
    if (statusEl) statusEl.textContent = '載入全量個案完整資料中…';
    await _ensureAllFullyLoaded('一學生一案號遷移');
    if (!_loadedFullDataset) {
      if (statusEl) statusEl.textContent = '⚠ 尚未持有全體個案完整資料，無法執行遷移（僅系統管理者可執行；請重新整理頁面後再試）。';
      return;
    }
    if (statusEl) statusEl.textContent = '全量備份中…';
    await _migBackup();
    if (statusEl) statusEl.textContent = '分析中…';
    const plan = _buildMergePlan(casesData);
    _migPlan = plan;
    if (reportEl) reportEl.innerHTML = _migRenderReport(plan);
    if (statusEl) {
      const parts = [];
      if (plan.groups.length) parts.push(`發現 ${plan.groups.length} 組待合併`);
      const conflictGroups = plan.groups.filter(g => g.identityConflict).length;
      if (conflictGroups) parts.push(`其中 ${conflictGroups} 組因識別衝突已預設取消勾選`);
      if (plan.internalMismatches.length) parts.push(`另發現 ${plan.internalMismatches.length} 筆案內識別不一致（疑似混人，見報告🚨區塊，人工處理）`);
      const summary = parts.length ? parts.join('；') : '無需遷移（找不到同一學生多案號的紀錄，亦無案內識別不一致）';
      statusEl.textContent = `分析完成：${summary}。已備份於 cases/${_migBackupPrefix}-*.json` +
        (plan.groups.length ? '。可逐組取消勾選、改選主號或自訂全新案號，確認後再按「② 執行合併」。' : '（可略過）。');
    }
    if (btnExec) btnExec.disabled = !plan.groups.length;
  } catch (e) {
    if (statusEl) statusEl.textContent = '❌ 分析失敗：' + e.message;
  }
}

// v156：報告新增三塊——① 每組成員旁的識別欄位（學號／遮罩身分證）與識別衝突標示（預設取消勾選）、
// ② 頂部「🚨 案內識別不一致」（不限合併組，全量掃描每筆 record）、③ 尾端「同名同姓（未合併）」資訊區。
function _migRenderReport(plan) {
  const hasGroups = !!(plan && plan.groups && plan.groups.length);
  const mismatches = (plan && plan.internalMismatches) || [];
  const sameNameSets = (plan && plan.sameNameDiffIdSets) || [];
  if (!hasGroups && !mismatches.length && !sameNameSets.length) {
    return '<div style="color:#718096;font-size:.85rem;">目前資料無需遷移。</div>';
  }
  const mismatchBlock = mismatches.length ? _migRenderMismatchBlock(mismatches) : '';
  const groupsHtml = hasGroups
    ? plan.groups.map((g, i) => _migRenderGroup(g, i)).join('')
    : '<div style="color:#718096;font-size:.85rem;margin-bottom:10px;">找不到同一學生多案號的合併候選組。</div>';
  const sameNameBlock = sameNameSets.length ? _migRenderSameNameBlock(sameNameSets) : '';
  return mismatchBlock + groupsHtml + sameNameBlock;
}

// 🚨 案內識別不一致：同一案號內（root 欄位或不同學期快照）學號／身分證不一致，疑似混入不同人資料。
function _migRenderMismatchBlock(mismatches) {
  const rows = mismatches.map(m => {
    const entriesHtml = m.entries.map(e => {
      const label = e.source === 'root' ? '（root 欄位）' : escHtml(semesterLabel(_semKeyBase(e.source)));
      const sid = e.studentId ? escHtml(e.studentId) : '（無）';
      const idn = e.idNumber ? escHtml(_maskIdNumber(e.idNumber)) : '（無）';
      return `<div style="font-size:.8rem;color:#4a5568;padding-left:8px;">${label}：學號 ${sid}／身分證 ${idn}</div>`;
    }).join('');
    return `<div style="border:1px solid #feb2b2;background:#fff5f5;border-radius:6px;padding:8px 12px;margin-bottom:6px;">
      <div style="font-weight:600;color:#c53030;">${escHtml(m.id)}${m.name ? `　${escHtml(m.name)}` : ''}</div>
      ${entriesHtml}
    </div>`;
  }).join('');
  return `<div style="margin-bottom:14px;">
    <div style="font-weight:700;color:#c53030;margin-bottom:6px;">🚨 案內識別不一致（疑似不同人混在同一案號）</div>
    <div style="font-size:.8rem;color:#718096;margin-bottom:6px;">以下案號內部（root 欄位或不同學期快照）出現學號／身分證不一致，可能是舊系統把不同人的資料混進同一案號，請人工核對後個別處理，不建議直接以本工具合併。</div>
    ${rows}
  </div>`;
}

// 同名同姓（識別欄位不同，未合併）：純資訊，供人工確認系統沒有漏合併／錯合併。
function _migRenderSameNameBlock(sets) {
  const rows = sets.map(s => {
    const clustersHtml = s.clusters.map((cluster, idx) => {
      const members = cluster.map(m => `${escHtml(m.id)}（學號：${m.studentId ? escHtml(m.studentId) : '（無）'}）`).join('、');
      return `<div style="font-size:.8rem;color:#4a5568;padding-left:8px;">第 ${idx + 1} 人：${members}</div>`;
    }).join('');
    return `<div style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:6px;">
      <div style="font-weight:600;color:#2d3748;">${escHtml(s.name)}</div>
      ${clustersHtml}
    </div>`;
  }).join('');
  return `<div style="margin-top:14px;">
    <div style="font-weight:700;color:#2d3748;margin-bottom:6px;">同名同姓（識別欄位不同，未合併）</div>
    <div style="font-size:.8rem;color:#718096;margin-bottom:6px;">以下姓名相同，但學號／身分證不同，判定為不同人、系統未自動合併；請確認沒有漏合併或誤合併。</div>
    ${rows}
  </div>`;
}

function _migRenderGroup(g, i) {
  const target = casesData.find(x => x.id === g.targetId);
  const conflictHtml = g.semConflicts.length
    ? `<div style="color:#c53030;font-size:.82rem;margin-top:4px;">⚠ 同學期衝突：` +
      g.semConflicts.map(c => `${escHtml(semesterLabel(c.semBase))}（${escHtml(c.ids.join('、'))}，將以 #N 折入）`).join('；') + `</div>`
    : '';
  const nameHtml = g.nameMismatch
    ? `<div style="color:#c53030;font-size:.82rem;margin-top:4px;">⚠ 姓名不一致：${escHtml(g.names.join('、'))}</div>`
    : '';
  const semsOf = id => {
    const c = casesData.find(x => x.id === id);
    return c ? _caseSems(c).map(semesterLabel).join('、') : '';
  };
  // 每個成員案號旁顯示學號／遮罩身分證（缺漏顯示「（無）」），供人工核對是否真為同一人
  const membersHtml = (g.members || []).map(m => {
    const sid = m.studentId ? escHtml(m.studentId) : '（無）';
    const idn = m.idNumber ? escHtml(_maskIdNumber(m.idNumber)) : '（無）';
    return `<span style="display:inline-flex;gap:4px;align-items:center;font-size:.78rem;color:#4a5568;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;margin:2px 4px 2px 0;">
      <strong style="color:#2d3748;">${escHtml(m.id)}</strong>　學號：${sid}　身分證：${idn}
    </span>`;
  }).join('');
  // 識別衝突（studentId／idNumber 不一致，或組內含案內混人案號）→ 醒目標示＋預設取消勾選
  const identityConflictHtml = g.identityConflict
    ? `<div style="color:#c53030;font-size:.82rem;margin-top:4px;font-weight:600;">⚠ 識別衝突：` +
      (g.identityConflictDetails || []).map(cf => {
        const fieldLabel = cf.field === 'idNumber' ? '身分證字號' : '學號';
        const vals = cf.entries.map(e => `${escHtml(e.id)}＝${escHtml(cf.field === 'idNumber' ? _maskIdNumber(e.value) : e.value)}`).join('、');
        return `${fieldLabel}不同（${vals}）`;
      }).join('；') +
      (g.identityInternalMismatchMember ? (g.identityConflictDetails?.length ? '；' : '') + '組內含案內識別不一致案號（見上方 🚨 區塊）' : '') +
      `　同名不代表同一人，本組已預設取消勾選，請人工確認後再勾選納入。</div>`
    : (g.identityIncomplete ? `<div style="color:#dd6b20;font-size:.8rem;margin-top:4px;">⚠ 識別資料不全（部分案號缺學號或身分證，請人工確認後再納入合併）</div>` : '');
  // 主案號 radio 候選：本組所有案號（演算法暫定主號預設選中）＋最後一個「自訂案號」選項
  const candidates = [g.targetId, ...g.sourceIds];
  const radioRows = candidates.map(id => {
    const isDefault = id === g.targetId;
    const sems = semsOf(id);
    return `<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;color:#2d3748;cursor:pointer;flex-wrap:wrap;">
      <input type="radio" name="mig-g${i}-main" value="${escHtml(id)}" ${isDefault ? 'checked' : ''} onchange="_migMainRadioChanged(${i})">
      <strong style="color:#1a5276;">${escHtml(id)}</strong>${sems ? `<span style="color:#718096;">（${escHtml(sems)}）</span>` : ''}
      ${isDefault ? '<span style="font-size:.72rem;color:#2b6cb0;background:#ebf8ff;border:1px solid #bee3f8;border-radius:4px;padding:0 5px;">暫定主號（開案最早）</span>' : ''}
    </label>`;
  }).join('');
  const customRow = `<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;color:#2d3748;cursor:pointer;flex-wrap:wrap;">
      <input type="radio" name="mig-g${i}-main" value="__custom__" onchange="_migMainRadioChanged(${i})">
      自訂案號（處理匯入異常等，合併後主號改用全新案號）
      <input type="text" id="mig-g${i}-custom" class="field-input" maxlength="7" placeholder="7 位數字" disabled
        style="width:110px;padding:2px 8px;font-size:.85rem;" oninput="_migCustomInputChanged(${i})">
      <span id="mig-g${i}-custom-err" style="font-size:.78rem;color:#c53030;"></span>
    </label>`;
  const includeAttr = g.identityConflict ? '' : 'checked';
  const bodyStyle = g.identityConflict ? 'margin-top:6px;opacity:.45;' : 'margin-top:6px;';
  const cardBorder = g.identityConflict ? '#feb2b2' : '#e2e8f0';
  const cardBg = g.identityConflict ? 'background:#fff5f5;' : '';
  return `<div style="border:1px solid ${cardBorder};border-radius:8px;padding:10px 14px;margin-bottom:8px;${cardBg}" id="mig-group-${i}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:5px;font-size:.85rem;cursor:pointer;white-space:nowrap;font-weight:600;">
        <input type="checkbox" id="mig-g${i}-include" ${includeAttr} onchange="_migGroupIncludeChanged(${i})"> 納入本次合併
      </label>
      <span style="font-weight:600;">第 ${i + 1} 組${target?.name ? `　${escHtml(target.name)}` : ''}</span>
      ${g.identityConflict ? '<span style="font-size:.72rem;color:#fff;background:#e53e3e;border-radius:4px;padding:1px 6px;">⚠ 識別衝突</span>' : ''}
    </div>
    <div id="mig-g${i}-body" style="${bodyStyle}">
      <div style="margin-bottom:4px;">${membersHtml}</div>
      <div style="font-size:.82rem;color:#718096;margin-bottom:4px;">合併後主案號（可改選其他案號，或自訂全新案號）：</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${radioRows}${customRow}</div>
      ${conflictHtml}${nameHtml}${identityConflictHtml}
    </div>
  </div>`;
}

// 讀取第 i 組目前的 UI 選擇：{ include, choice（案號或 '__custom__'）, customId }；報告未渲染時回 null
function _migReadGroupSelection(i) {
  const includeEl = document.getElementById(`mig-g${i}-include`);
  if (!includeEl) return null;
  const choice = document.querySelector(`input[name="mig-g${i}-main"]:checked`)?.value || '';
  const customId = (document.getElementById(`mig-g${i}-custom`)?.value || '').trim();
  return { include: includeEl.checked, choice, customId };
}

// 自訂案號檢核：回傳錯誤訊息字串（'' = 通過）。等於本組成員視為改選該號（通過，執行時自動轉為 radio 選擇）。
function _migValidateCustomId(customId, group, groupIdx) {
  if (!customId) return '請輸入自訂案號';
  if (!/^\d{7}$/.test(customId)) return '案號須為 7 位數字';
  const members = group ? [group.targetId, ...group.sourceIds] : [];
  if (members.includes(customId)) return ''; // 等同直接選該案號
  if (casesData.some(c => c.id === customId)) return `案號 ${customId} 已被其他個案使用`;
  if (casesData.some(c => (c.formerIds || []).some(f => f.id === customId))) return `案號 ${customId} 是其他個案的曾用案號`;
  if ((casesManifest?.deletedIds || []).includes(customId)) return `案號 ${customId} 曾被永久刪除，不可再使用`;
  for (let j = 0; j < (_migPlan?.groups?.length || 0); j++) {
    if (j === groupIdx) continue;
    const other = _migReadGroupSelection(j);
    if (other && other.include && other.choice === '__custom__' && other.customId === customId) {
      return `與第 ${j + 1} 組的自訂案號重複`;
    }
  }
  return '';
}

function _migMainRadioChanged(i) {
  const isCustom = document.querySelector(`input[name="mig-g${i}-main"]:checked`)?.value === '__custom__';
  const inp = document.getElementById(`mig-g${i}-custom`);
  if (inp) {
    inp.disabled = !isCustom;
    if (isCustom) inp.focus();
  }
  _migCustomInputChanged(i);
}

function _migCustomInputChanged(i) {
  const errEl = document.getElementById(`mig-g${i}-custom-err`);
  if (!errEl) return;
  const sel = _migReadGroupSelection(i);
  if (!sel || !sel.include || sel.choice !== '__custom__') { errEl.textContent = ''; return; }
  errEl.textContent = _migValidateCustomId(sel.customId, _migPlan?.groups?.[i], i);
}

function _migGroupIncludeChanged(i) {
  const body = document.getElementById(`mig-g${i}-body`);
  const inc = document.getElementById(`mig-g${i}-include`)?.checked;
  if (body) body.style.opacity = inc ? '' : '.45';
  _migCustomInputChanged(i);
}

async function _migExecute() {
  if (!_migPlan || !_migPlan.groups.length) { showToast('請先執行①備份＋Dry-run 分析', 'warn'); return; }
  // 讀取每組 UI 選擇：是否納入、主號 radio（組內案號或自訂）
  const selections = _migPlan.groups.map((g, i) => {
    const sel = _migReadGroupSelection(i) || { include: !g.identityConflict, choice: g.targetId, customId: '' };
    const members = [g.targetId, ...g.sourceIds];
    let mainId = members.includes(sel.choice) ? sel.choice : g.targetId;
    let customId = '';
    if (sel.choice === '__custom__') {
      if (members.includes(sel.customId)) mainId = sel.customId; // 自訂號等於組內成員 → 視為直接改選該號
      else customId = sel.customId;
    }
    return { group: g, index: i, include: !!sel.include, isCustomRaw: sel.choice === '__custom__', rawCustom: sel.customId, mainId, customId };
  });
  const included = selections.filter(s => s.include);
  if (!included.length) { showToast('所有組皆未勾選「納入本次合併」，未執行任何合併', 'warn'); return; }
  // 自訂案號逐組檢核，任一失敗即中止並指出哪一組（留空也要擋，不可靜默改用暫定主號）
  for (const s of included) {
    if (!s.isCustomRaw) continue;
    if ([s.group.targetId, ...s.group.sourceIds].includes(s.rawCustom)) continue; // 等同改選組內該號，無需檢核
    const err = _migValidateCustomId(s.rawCustom, s.group, s.index);
    if (err) {
      alert(`第 ${s.index + 1} 組的自訂案號有誤：${err}\n請修正後再執行合併。`);
      _migCustomInputChanged(s.index);
      return;
    }
  }
  const skipped = selections.length - included.length;
  const customList = included.filter(s => s.customId).map(s => `${s.mainId}→${s.customId}`);
  if (!confirm(
    `即將合併 ${included.length} 組同學生案號${skipped ? `（略過 ${skipped} 組）` : ''}，此操作不可逆（已備份於 cases/${_migBackupPrefix}-*.json）。` +
    (customList.length ? `\n採自訂新主號：${customList.join('、')}` : '') +
    `\n確定繼續？`
  )) return;
  if (!confirm('請再次確認：合併後被併掉的案號將改列為「曾用案號」，仍可查閱與對調回主號。確定執行合併？')) return;
  const statusEl = document.getElementById('mig-status');
  const btnExec  = document.getElementById('mig-btn-exec');
  const btnRun   = document.getElementById('mig-btn-dryrun');
  if (btnExec) btnExec.disabled = true;
  if (btnRun) btnRun.disabled = true;
  showLoading('執行合併中…');
  const summaries = [];
  try {
    let done = 0;
    for (const s of included) {
      const g = s.group;
      const members = [g.targetId, ...g.sourceIds];
      // 主號可由使用者改選為組內任一案號；_mergeCaseGroup 與哪筆當 target 無關（root 欄位補缺不受影響）
      const target  = casesData.find(x => x.id === s.mainId);
      const sources = members.filter(id => id !== s.mainId).map(id => casesData.find(x => x.id === id)).filter(Boolean);
      if (!target || !sources.length) continue;
      const sourceIds = sources.map(x => x.id);
      const { sourceRemaps } = _mergeCaseGroup(target, sources);
      // 自訂新主號：須在 migrateToChunks() 全量重建之前改 id（重建按當下 id 放 chunk）
      let origMainId = null;
      if (s.customId) {
        origMainId = _migApplyCustomId(target, s.customId);
        // target 原 id 也要 remap 到最終自訂號（allowedCases／allowedCasesSems／transferData）
        Object.values(configData?.users || {}).forEach(info => {
          if (!info) return;
          if (Array.isArray(info.allowedCases) && info.allowedCases.includes(origMainId)) {
            info.allowedCases = [...new Set(info.allowedCases.map(x => x === origMainId ? target.id : x))];
          }
          if (info.allowedCasesSems?.[origMainId]) {
            const sems = info.allowedCasesSems[origMainId];
            delete info.allowedCasesSems[origMainId];
            info.allowedCasesSems[target.id] = [...new Set([...(info.allowedCasesSems[target.id] || []), ...sems])];
          }
        });
        (transferData || []).forEach(t => { if (t.caseId === origMainId) t.caseId = target.id; });
      }
      sourceRemaps.forEach(({ id: srcId, semKeyMap }) => {
        Object.values(configData?.users || {}).forEach(info => {
          if (!info) return;
          if (Array.isArray(info.allowedCases) && info.allowedCases.includes(srcId)) {
            info.allowedCases = info.allowedCases.filter(x => x !== srcId);
            if (!info.allowedCases.includes(target.id)) info.allowedCases.push(target.id);
          }
          if (info.allowedCasesSems?.[srcId]) {
            const remapped = info.allowedCasesSems[srcId].map(k => semKeyMap[k] || k);
            info.allowedCasesSems[target.id] = [...new Set([...(info.allowedCasesSems[target.id] || []), ...remapped])];
            delete info.allowedCasesSems[srcId];
          }
        });
        (transferData || []).forEach(t => { if (t.caseId === srcId) t.caseId = target.id; });
        // 從 casesData 移除來源 record（不加入 deletedIds 墓碑，供日後主號↔曾用號對調回來）
        const idx = casesData.findIndex(x => x.id === srcId);
        if (idx !== -1) casesData.splice(idx, 1);
      });
      const detail = `合併 ${sources.length} 筆：` +
        sourceRemaps.map(r => `${r.id}（${(sources.find(x => x.id === r.id)?.semesters || []).map(semesterLabel).join('、')}）`).join('、') +
        (origMainId ? `；主號採自訂新號 ${target.id}（原 ${origMainId}）` : '');
      auditLog('個案合併遷移', target.id, null, detail);
      summaries.push({ targetId: target.id, mergedIds: origMainId ? [...sourceIds, origMainId] : sourceIds });
      done++;
      if (statusEl) statusEl.textContent = `合併中…（${done}/${included.length}）`;
    }
    // 全量重建 index/hot/chunks（🔴 僅在 _loadedFullDataset 為 true 時才可執行，已於 dry-run 階段確認過）
    await migrateToChunks();
    await _saveCasesIndex();
    await _saveCasesHot();
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    await saveTransfer();
    // 發「確認主案號」待辦給現任主責＋所有系統管理者
    const myTodos = [];
    summaries.forEach(({ targetId, mergedIds }) => {
      const c = casesData.find(x => x.id === targetId);
      if (!c) return;
      const recipients = new Set();
      const latestEmail = _getLatestCounselorEmail(c);
      if (latestEmail) recipients.add(latestEmail);
      Object.entries(configData?.users || {}).forEach(([email, info]) => {
        if (info?.isAdmin === true || info?.extraRole === '管理者') recipients.add(email);
      });
      const label = `確認主案號：${c.name || ''}（${targetId}）`;
      const todo = { id: _genTodoId(), type: 'case_mainid_confirm', caseId: targetId, caseName: c.name || '',
        label, caseLabel: `曾用案號：${mergedIds.join('、')}`,
        createdAt: new Date().toISOString(), done: false, notifRead: false };
      recipients.forEach(email => {
        if (email === currentUser?.email) myTodos.push({ ...todo, id: _genTodoId() });
        else _appendTodoToUser(email, { ...todo, id: _genTodoId() }).catch(() => {});
      });
    });
    if (myTodos.length) { todosData.push(...myTodos); await saveUserTodos().catch(() => {}); }
    hideLoading();
    _migPlan = null;
    if (btnRun) btnRun.disabled = false;
    const reportEl = document.getElementById('mig-report');
    if (reportEl) reportEl.innerHTML = `<div style="color:#276749;font-weight:600;">✓ 合併完成，共 ${summaries.length} 組。</div>`;
    if (statusEl) statusEl.textContent = '合併完成；如需再次分析請重新執行①。';
    renderCaseNums();
    renderCases();
    showToast(`一學生一案號合併完成：${summaries.length} 組`, 'success');
  } catch (e) {
    hideLoading();
    if (btnRun) btnRun.disabled = false;
    showToast('合併失敗：' + e.message, 'error');
    if (statusEl) statusEl.textContent = '❌ 合併失敗：' + e.message;
  }
}

// ══════════════════════════════════════════════
// ── 個案架構重構 Slice 3：chunk 與案號脫鉤（重新分塊 UI／執行；僅系統管理者可見）──
// ══════════════════════════════════════════════
let _rechunkRunning = false;

function _rechunkCardHtml() {
  const done = _rechunkHasRun();
  return `
    <div class="card" id="rechunk-card" style="margin-top:16px;">
      <div class="card-header"><h3>🗂️ 個案重新分塊（Slice 3）</h3></div>
      <div style="padding:16px;">
        <div style="font-size:.85rem;color:#718096;margin-bottom:10px;">
          chunk 檔目前依案號（首次開案學期，永久不變）分組，活躍個案會散落在各學年 chunk，啟動時要下載的
          「使用中」chunk 壓不下來。本操作把 chunk 歸屬與案號脫鉤：本學期開案中（活躍）個案集中到少數
          <code>active-NN</code> chunk，其餘依「最後活動學年」歸檔為 <code>cold-{學年}-N</code>，兩者每塊 ≤20 案。
          舊 chunk 檔會留在 Drive（不刪除，manifest 不再列出即不會被讀取），資料安全；結案／封存不會即時搬 chunk，
          <strong>建議每學期初執行一次</strong>讓分塊重新貼合當下的使用狀況。執行前建議先完成上方「①
          備份＋Dry-run 分析」做一次全量備份。
        </div>
        <div style="font-size:.85rem;color:${done ? '#276749' : '#a0aec0'};margin-bottom:10px;">
          目前狀態：${done ? '✓ 已執行過重新分塊（新開案將自動分配到 active chunk）' : '尚未執行過（目前仍是案號推導的舊式分塊，新開案沿用舊式命名）'}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-danger" id="rechunk-btn" onclick="_manualRechunk()">執行重新分塊</button>
        </div>
        <div id="rechunk-status" style="font-size:.85rem;color:#4a5568;"></div>
      </div>
    </div>`;
}

// 管理者手動觸發「重新分塊」：前置條件與①一學生一案號遷移相同（需全量載入完整資料）；
// 與合併遷移引擎尾端全量重建共用同一套核心（_rebuildChunksCore／migrateToChunks），
// 差別只在強制 scheme='active-cold'。fail-closed：任一 chunk 寫入失敗即中止，
// 中止當下 manifest／index 尚未變動，系統仍使用原本的分塊。
async function _manualRechunk() {
  if (_rechunkRunning) return;
  if (!_loadedFullDataset) {
    alert('尚未持有全體個案完整資料，無法重新分塊（僅系統管理者可執行；請重新整理頁面後再試）。');
    return;
  }
  const statusEl = document.getElementById('rechunk-status');
  const btn = document.getElementById('rechunk-btn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = '載入全量個案完整資料中…';
  try {
    await _ensureAllFullyLoaded('個案重新分塊');
  } catch (e) {
    if (statusEl) statusEl.textContent = '❌ 全量載入失敗：' + e.message;
    if (btn) btn.disabled = false;
    return;
  }
  if (!confirm(
    '即將重新分塊：本學期開案中的活躍個案集中到少數 active chunk，其餘依最後活動學年歸檔為 cold chunk。\n\n' +
    '這是全量重建操作；舊 chunk 檔會留在 Drive 不會刪除，但建議先完成「① 備份＋Dry-run 分析」做一次全量備份再繼續。\n\n' +
    '確定要開始重新分塊嗎？'
  )) { if (btn) btn.disabled = false; if (statusEl) statusEl.textContent = ''; return; }
  const beforeChunks = (casesManifest?.chunks || []).length;
  _rechunkRunning = true;
  if (statusEl) statusEl.textContent = '重新分塊中…';
  try {
    await migrateToChunks({ scheme: 'active-cold' });
    await _saveCasesIndex();
    await _saveCasesHot();
    const afterChunks = (casesManifest?.chunks || []).length;
    auditLog('個案重新分塊', null, null, `chunk 數：${beforeChunks} → ${afterChunks}`, { major: true });
    if (statusEl) statusEl.textContent =
      `✓ 重新分塊完成：chunk 數 ${beforeChunks} → ${afterChunks}。舊 chunk 檔仍保留在 Drive（未刪除，僅 manifest 不再列出，不影響資料安全）。`;
    renderCaseNums();
    renderCases();
    showToast('重新分塊完成', 'success');
  } catch (e) {
    if (statusEl) statusEl.textContent = '❌ 重新分塊失敗：' + e.message + '（manifest／index 尚未變動，系統仍使用原本的分塊）';
    showToast('重新分塊失敗：' + e.message, 'error');
  } finally {
    _rechunkRunning = false;
    if (btn) btn.disabled = false;
  }
}

async function _swapMainCaseIdConfirm(caseId, formerId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  if (!confirm(`確定要將曾用案號「${formerId}」設為主案號？\n（僅代表號互換，資料不動；原主號 ${caseId} 將改列為曾用案號）`)) return;
  showLoading('對調主案號中…');
  try {
    await _swapMainCaseId(caseId, formerId);
    hideLoading();
    showToast(`已將主案號改為 ${formerId}`, 'success');
    renderCaseNums();
    renderCases();
    showCaseDetail(formerId);
  } catch (e) {
    hideLoading();
    alert('對調失敗：' + e.message);
  }
}

// ── 共用：可拖曳欄寬 helper（含邊界限制）────────────────────────────────
function _makeTableResizable({ table, colPrefix, colNums, prefKey, skipCols = new Set() }) {
  if (!table) return;
  const savedWidths = _userPref_(prefKey, {});
  if (Object.keys(savedWidths).length) {
    table.style.tableLayout = 'fixed';
    colNums.forEach(n => {
      const col = document.getElementById(colPrefix + n);
      if (col && savedWidths[n]) col.style.width = savedWidths[n] + 'px';
    });
  }
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    const n = parseInt(th.dataset.col);
    if (!n || skipCols.has(n) || th.querySelector('.col-resize-handle')) return;
    th.style.position = 'relative';
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.title = '拖曳調整欄寬';
    handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:10px;cursor:col-resize;z-index:2;background:transparent;';
    let startX, startW, startTableW;
    handle.addEventListener('mousedown', e => {
      const col = document.getElementById(colPrefix + n);
      startX = e.pageX;
      // Capture natural widths BEFORE switching to fixed layout (fixed layout redistributes cols if no explicit width)
      table.querySelectorAll('thead th[data-col]').forEach(hd => {
        const i = parseInt(hd.dataset.col);
        if (skipCols.has(i)) return;
        const c = document.getElementById(colPrefix + i);
        if (c && !c.style.width) c.style.width = hd.offsetWidth + 'px';
      });
      table.style.tableLayout = 'fixed';
      startTableW = table.offsetWidth;
      table.style.width = startTableW + 'px';
      startW = (col && parseInt(col.style.width)) || th.offsetWidth;
      const onMove = ev => {
        const delta = ev.pageX - startX;
        const minTableW = colNums.length * 30;
        const newTableW = Math.max(minTableW, startTableW + delta);
        const w = Math.max(30, startW + (newTableW - startTableW));
        if (col) col.style.width = w + 'px';
        table.style.width = newTableW + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const widths = {};
        colNums.forEach(i => {
          const c = document.getElementById(colPrefix + i);
          if (c && c.style.width) widths[i] = parseInt(c.style.width);
        });
        syncUserPref_({ [prefKey]: widths });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault(); e.stopPropagation();
    });
    th.appendChild(handle);
  });
}
function _resetTableColWidths({ table, colPrefix, colNums, prefKey }) {
  syncUserPref_({ [prefKey]: {} });
  if (!table) return;
  table.style.tableLayout = '';
  table.style.width = '';
  colNums.forEach(n => {
    const col = document.getElementById(colPrefix + n);
    if (col) col.style.width = '';
  });
}
// ── 案號查詢 ──────────────────────────────────────────────────────────────
function _makeCnTableResizable() {
  _makeTableResizable({ table: document.querySelector('#cn-tbody')?.closest('table'), colPrefix: 'cn-col-', colNums: [1,2,3,4,5], prefKey: 'cnColWidths' });
}
function _resetCnColWidths() {
  _resetTableColWidths({ table: document.querySelector('#cn-tbody')?.closest('table'), colPrefix: 'cn-col-', colNums: [1,2,3,4,5], prefKey: 'cnColWidths' });
}

function _cnChkChange(el) {
  if (el.checked) _cnSelected.add(el.dataset.id);
  else _cnSelected.delete(el.dataset.id);
  const allIds = [...document.querySelectorAll('.cn-row-chk')].map(x => x.dataset.id);
  const allChecked = allIds.length > 0 && allIds.every(id => _cnSelected.has(id));
  const someChecked = allIds.some(id => _cnSelected.has(id));
  const sa = document.getElementById('cn-select-all');
  if (sa) { sa.checked = allChecked; sa.indeterminate = !allChecked && someChecked; }
  _syncCnBatchBar();
}
function _cnSelectAll(checked) {
  document.querySelectorAll('.cn-row-chk').forEach(el => {
    el.checked = checked;
    if (checked) _cnSelected.add(el.dataset.id);
    else _cnSelected.delete(el.dataset.id);
  });
  _syncCnBatchBar();
}
function _syncCnBatchBar() {
  const bar = document.getElementById('cn-batch-bar');
  const cnt = document.getElementById('cn-batch-count');
  if (!bar) return;
  if (_cnSelected.size > 0) {
    bar.style.display = 'flex';
    if (cnt) cnt.textContent = `已選 ${_cnSelected.size} 筆`;
  } else {
    bar.style.display = 'none';
  }
}

async function editCaseNum(oldId) {
  const c = casesData.find(x => x.id === oldId);
  if (!c) return;
  const input = prompt(`請輸入「${c.name}」的新案號：`, oldId);
  if (!input || input.trim() === oldId) return;
  const trimmed = input.trim();
  const conflict = casesData.find(x => x.id === trimmed && x.id !== oldId);
  if (conflict) { alert(`案號「${trimmed}」已被「${conflict.name}」使用，請重新輸入。`); return; }
  // 一學生一案號：曾用案號也視為已占用，避免改成撞到別案的曾用號
  const formerConflict = casesData.find(x => x.id !== oldId && (x.formerIds || []).some(f => f.id === trimmed));
  if (formerConflict) { alert(`案號「${trimmed}」是個案「${formerConflict.name}」（${formerConflict.id}）的曾用案號，請重新輸入。`); return; }
  showLoading('更新案號…');
  try {
    // 共用 _renameCaseId：一併 remap allowedCases/allowedCasesSems/transferData，並正確清除舊 chunk 殘留
    await _renameCaseId(oldId, trimmed);
    auditLog('修改案號', trimmed);
    hideLoading();
    renderCaseNums();
    renderCases();
    setAlert('cases-alert', 'info', `案號已從「${escHtml(oldId)}」更新為「${escHtml(trimmed)}」。`);
  } catch (err) {
    const idx = casesData.findIndex(x => x.id === trimmed);
    if (idx !== -1) casesData[idx].id = oldId;
    hideLoading();
    alert('更新失敗：' + err.message);
  }
}

// ══════════════════════════════════════════════
//  個案新增
// ══════════════════════════════════════════════
let _editingCaseId = null;
let _caseDraftTodoId = null; // 從「繼續編輯」草稿待辦重開表單時記錄對應 todoId，儲存成功後標記完成

// ── v185：個案資料表單草稿備援與離開防護 ──────────────────────────────────
// 快照涵蓋 saveCase() 會讀取的主要欄位；用來跟開表單當下的基準快照比對，
// 判斷「使用者是否有實際輸入」——而不是欄位是否為空，避免編輯模式回填既有資料被誤判為使用者輸入。
function _caseFormSnapshot() {
  const gv = id => document.getElementById(id)?.value ?? '';
  const gr = name => document.querySelector(`input[name="${name}"]:checked`)?.value || '';
  const gchk = id => !!document.getElementById(id)?.checked;
  return {
    id: gv('nc-id'), openDate: gv('nc-open-date'), name: gv('nc-name'), studentId: gv('nc-student-id'),
    idNumber: gv('nc-id-number'),
    birthY: gv('nc-birth-year'), birthM: gv('nc-birth-month'), birthD: gv('nc-birth-day'),
    gender: gr('nc-gender'), genderId: gr('nc-gender-id'), caseType: gr('nc-type'), gradLevel: gr('nc-grad-level'),
    nationality: gr('nc-nationality'), ethnicity: gr('nc-ethnicity'),
    ethnicityNote: Object.values(ETH_NOTE_IDS).map(gv).join('|'),
    program: gv('nc-program'), disability: gv('nc-disability'), dept: gv('nc-dept'),
    grade: gv('nc-grade'), classNo: gv('nc-class'), phone: gv('nc-phone'), email: gv('nc-email'),
    residence: gr('nc-residence'), address: gv('nc-address'),
    emgName: gv('nc-emg-name'), emgPhone: gv('nc-emg-phone'), emgRelation: gv('nc-emg-relation'),
    source: gr('nc-source'), status: gr('nc-status'), abType: gr('nc-ab-type'),
    bReasons: [..._ncBReasonsSelected].sort().join('|'),
    counselorEmail: gv('nc-counselor'), foreignCountry: gv('nc-foreign-country'),
    bsrs: ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5','nc-bsrs6'].map(gv).join('|'),
    bsrsUnfilled: gchk('nc-bsrs-unfilled'), isTransferCase: gchk('nc-is-transfer-case'),
    pastRecords: ['nc-past-psych','nc-past-med','nc-past-counsel'].filter(gchk).join('|'),
    topics: [...document.querySelectorAll('input[name="nc-topic"]:checked')].map(cb => cb.value).sort().join('|'),
    topicOther: gv('nc-topic-other'),
  };
}
function _caseDraftKey() {
  return `scc_draft_case_${currentUser?.email || ''}_${_editingCaseId || 'new'}`;
}
function _startCaseDraftAutosave() {
  _gdStartAutosave('case', _caseDraftKey(), _caseFormSnapshot, '_case-draft-status');
}
function _stopCaseDraftAutosave() { _gdStopAutosave('case'); }

function cancelCaseForm() {
  const _exit = () => {
    _stopCaseDraftAutosave();
    try { localStorage.removeItem(_caseDraftKey()); } catch(_) {}
    if (_editingCaseId) showCaseDetail(_editingCaseId);
    else showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
  };
  if (!document.getElementById('page-new-case')?.classList.contains('active') || !_gdIsDirty('case', _caseFormSnapshot())) {
    _exit(); return;
  }
  _showExitDialog('離開個案資料表單',
    () => saveCase(),
    () => _draftCaseForm(),
    () => _exit()
  );
}

function _draftCaseForm() {
  const snap = _caseFormSnapshot();
  const label = _editingCaseId ? '個案資料編輯草稿' : '新增個案草稿';
  const caseLabel = _editingCaseId ? `${casesData.find(c => c.id === _editingCaseId)?.name || ''}（${_editingCaseId}）` : (snap.name ? `${snap.name}（草稿）` : '（未命名新個案）');
  const existingTodo = _caseDraftTodoId ? todosData.find(t => t.id === _caseDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'case_draft', label,
    caseId: _editingCaseId || '', caseLabel,
    draftData: { editingCaseId: _editingCaseId, snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopCaseDraftAutosave();
  try { localStorage.removeItem(_caseDraftKey()); } catch(_) {}
  _caseDraftTodoId = null;
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

// 依快照還原表單欄位（供「繼續編輯」草稿使用）；欄位對照同 _caseFormSnapshot()。
function _restoreCaseFormSnapshot(snap) {
  if (!snap) return;
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const sr = (name, v) => { if (!v) return; const el = document.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
  const sck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  sv('nc-id', snap.id); sv('nc-open-date', snap.openDate); sv('nc-name', snap.name); sv('nc-student-id', snap.studentId);
  sv('nc-id-number', snap.idNumber);
  sv('nc-birth-year', snap.birthY); sv('nc-birth-month', snap.birthM); sv('nc-birth-day', snap.birthD);
  sr('nc-gender', snap.gender); sr('nc-gender-id', snap.genderId); sr('nc-type', snap.caseType);
  sr('nc-grad-level', snap.gradLevel); _ncToggleGradLevel();
  sr('nc-nationality', snap.nationality);
  if (snap.ethnicity) { sr('nc-ethnicity', snap.ethnicity); toggleEthnicityNote({ value: snap.ethnicity }); }
  sv('nc-program', snap.program); sv('nc-disability', snap.disability); sv('nc-dept', snap.dept);
  sv('nc-grade', snap.grade); sv('nc-class', snap.classNo); sv('nc-phone', snap.phone); sv('nc-email', snap.email);
  sr('nc-residence', snap.residence); sv('nc-address', snap.address);
  sv('nc-emg-name', snap.emgName); sv('nc-emg-phone', snap.emgPhone); sv('nc-emg-relation', snap.emgRelation);
  sr('nc-source', snap.source); sr('nc-status', snap.status); sr('nc-ab-type', snap.abType);
  if (snap.bReasons) { _ncBReasonsSelected = new Set(snap.bReasons.split('|').filter(Boolean)); _ncOnAbTypeChange(); }
  sv('nc-counselor', snap.counselorEmail); sv('nc-foreign-country', snap.foreignCountry);
  (snap.bsrs || '').split('|').forEach((v, i) => {
    const id = ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5','nc-bsrs6'][i];
    if (id && v) setBsrsBtn(id, v);
  });
  sck('nc-bsrs-unfilled', snap.bsrsUnfilled); sck('nc-is-transfer-case', snap.isTransferCase);
  (snap.pastRecords || '').split('|').filter(Boolean).forEach(id => sck(id, true));
  const topicSet = new Set((snap.topics || '').split('|').filter(Boolean));
  document.querySelectorAll('input[name="nc-topic"]').forEach(cb => { cb.checked = topicSet.has(cb.value); });
  if (topicSet.has('其他')) {
    const wrap = document.getElementById('nc-topic-other-wrap'); if (wrap) wrap.style.display = 'flex';
    sv('nc-topic-other', snap.topicOther);
  }
  calcBsrsTotal();
}

function openEditCasePage(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  openNewCasePage();       // resets form (including _editingCaseId = null)
  _editingCaseId = caseId; // set AFTER openNewCasePage so it isn't wiped

  document.getElementById('nc-id').value       = c.id;
  document.getElementById('nc-open-date').value = c.openDate || '';
  document.getElementById('nc-name').value      = c.name || '';
  document.getElementById('nc-student-id').value = c.studentId || '';
  document.getElementById('nc-id-number').value  = c.idNumber || '';

  if (c.birthday) {
    const [y, m, d] = c.birthday.split('-');
    document.getElementById('nc-birth-year').value  = y || '';
    document.getElementById('nc-birth-month').value = m || '';
    document.getElementById('nc-birth-day').value   = d || '';
  }

  const setRadio = (name, val) => {
    const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  };
  setRadio('nc-gender',    c.legalGender || '');
  setRadio('nc-gender-id', c.genderIdentity || '');
  setRadio('nc-type',      c.caseType || '');
  setRadio('nc-grad-level', c.gradLevel || '');
  _ncToggleGradLevel();
  setRadio('nc-residence', c.residence || '');
  setRadio('nc-source',    c.source || '');
  setRadio('nc-status',    c.status === 'closed' ? 'active' : (c.status || 'active'));

  setRadio('nc-nationality', c.nationality || '');
  toggleEthnicity();
  document.getElementById('nc-foreign-country').value = c.foreignCountry || '';
  if (c.ethnicity) {
    setRadio('nc-ethnicity', c.ethnicity);
    toggleEthnicityNote({ value: c.ethnicity });
    const noteId = ETH_NOTE_IDS[c.ethnicity];
    if (noteId && c.ethnicityNote) document.getElementById(noteId).value = c.ethnicityNote;
  }

  document.getElementById('nc-program').value    = c.program || '';
  document.getElementById('nc-disability').value = c.disability || '';
  document.getElementById('nc-dept').value       = c.department || '';
  _updateNcCollege();
  document.getElementById('nc-grade').value      = c.grade || '';
  document.getElementById('nc-class').value      = c.classNo || '';
  document.getElementById('nc-phone').value      = c.phone || '';
  document.getElementById('nc-email').value      = c.email || '';
  document.getElementById('nc-address').value    = c.address || '';
  document.getElementById('nc-emg-name').value   = c.emergencyName || '';
  document.getElementById('nc-emg-phone').value  = c.emergencyPhone || '';
  document.getElementById('nc-emg-relation').value = c.emergencyRelation || '';

  document.getElementById('nc-past-psych').checked   = (c.pastRecords||[]).includes('精神科就診');
  document.getElementById('nc-past-med').checked     = (c.pastRecords||[]).includes('服用精神藥物');
  document.getElementById('nc-past-counsel').checked = (c.pastRecords||[]).includes('心理諮商');

  document.querySelectorAll('input[name="nc-topic"]').forEach(cb => {
    const match = (c.topics||[]).find(t =>
      (_TOPIC_ALIASES[t] || t) === cb.value || (cb.value === '其他' && t.startsWith('其他：'))
    );
    cb.checked = !!match;
    if (cb.value === '其他' && match && match.startsWith('其他：')) {
      const _ncWrap = document.getElementById('nc-topic-other-wrap'); if (_ncWrap) _ncWrap.style.display = 'flex';
      document.getElementById('nc-topic-other').value = match.slice(3);
    }
  });

  {
    const _eSem = _caseDetailActiveSem || openDateToSemPrefix(c.openDate);
    const _eSnap = (_eSem && c.basicInfoSnapshots?.[_eSem]) || null;
    document.getElementById('nc-counselor').value =
      (_eSnap !== null && _eSnap.counselorEmail !== undefined) ? _eSnap.counselorEmail : (c.counselorEmail || '');
  }

  const mgrSectionEdit = document.getElementById('nc-managers-section');
  if (currentRole === '主任' || extraRole === '管理者') {
    mgrSectionEdit.style.display = '';
    const currentManagers = Object.entries(configData.users || {})
      .filter(([, info]) => (info.allowedCases || []).includes(caseId))
      .map(([email]) => email);
    renderNcManagersCheckboxes(currentManagers);
  } else {
    mgrSectionEdit.style.display = 'none';
  }

  // BSRS
  ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5'].forEach((id, i) => {
    const val = (c.bsrs && c.bsrs[i] !== null && c.bsrs[i] !== undefined) ? String(c.bsrs[i]) : '';
    setBsrsBtn(id, val);
  });
  setBsrsBtn('nc-bsrs6', (c.bsrs6 !== null && c.bsrs6 !== undefined) ? String(c.bsrs6) : '');
  const _ncBsrsUnfilledCb = document.getElementById('nc-bsrs-unfilled');
  if (_ncBsrsUnfilledCb) _ncBsrsUnfilledCb.checked = !!c.bsrsUnfilled;
  calcBsrsTotal();
  updateOpenDateRoc();
  updateBirthRoc();

  const _ncTransferEditEl = document.getElementById('nc-is-transfer-case');
  if (_ncTransferEditEl) _ncTransferEditEl.checked = !!c.isTransferCase;

  document.getElementById('nc-refill-section').style.display = 'none';
  document.getElementById('new-case-page-title').textContent = '編輯個案';
  document.getElementById('btn-save-case').textContent = '更新個案';

  // 刪除此學期基本資料按鈕（僅多學期案件顯示）
  const _btnDelSemEdit = document.getElementById('btn-delete-sem-data');
  if (_btnDelSemEdit) {
    const editSem = _caseDetailActiveSem || openDateToSemPrefix(c.openDate);
    const canDelSem = (c.semesters || []).length > 1;
    if (canDelSem) {
      _btnDelSemEdit.style.display = '';
      _btnDelSemEdit.disabled = false;
      _btnDelSemEdit.title = '';
      _btnDelSemEdit.onclick = () => deleteCaseSemData(caseId, editSem);
    } else {
      _btnDelSemEdit.style.display = 'none';
    }
  }
  // v185：欄位回填完成後才取基準快照，避免把「載入既有資料」誤判為使用者輸入
  _gdSetBaseline('case', _caseFormSnapshot());
  _startCaseDraftAutosave();
}

// 一學生一案號：合併遷移後的曾用案號（formerIds）也視為已占用，避免新案號誤撞
function _usedFormerIdSeqs(prefix) {
  return new Set(
    casesData
      .flatMap(c => (c.formerIds || []).map(f => f.id))
      .filter(id => id && id.startsWith(prefix))
      .map(id => parseInt(id.slice(prefix.length), 10))
      .filter(n => !isNaN(n))
  );
}

function generateCaseId() {
  const prefix = currentSemesterPrefix();
  const maxSeq = casesData.reduce((max, c) => {
    if (c.id && c.id.startsWith(prefix)) {
      const n = parseInt(c.id.slice(prefix.length), 10);
      if (!isNaN(n)) return Math.max(max, n);
    }
    return max;
  }, 0);
  const usedFormerIds = _usedFormerIdSeqs(prefix);
  let seq = maxSeq + 1;
  while (usedFormerIds.has(seq)) seq++;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function renderCaseIdSuggestions() {
  const prefix = currentSemesterPrefix();

  const used = new Set(
    casesData
      .filter(c => c.id && c.id.startsWith(prefix))
      .map(c => parseInt(c.id.slice(prefix.length), 10))
      .filter(n => !isNaN(n))
  );
  const usedFormerIds = _usedFormerIdSeqs(prefix);

  const suggestions = [];
  for (let seq = 1; suggestions.length < 5; seq++) {
    if (!used.has(seq) && !usedFormerIds.has(seq)) suggestions.push(`${prefix}${String(seq).padStart(3, '0')}`);
  }

  const wrap = document.getElementById('nc-id-suggestions');
  if (!wrap) return;
  wrap.innerHTML = `<span style="margin-right:4px;">本學期未使用案號（點選填入）：</span>` +
    suggestions.map(id =>
      `<span onclick="document.getElementById('nc-id').value='${id}';checkCaseIdDuplicate();"
        style="display:inline-block;margin:2px 4px 2px 0;padding:2px 10px;
          background:#ebf5fb;border:1px solid #aed6f1;border-radius:12px;
          color:#1a5276;font-weight:600;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='#d6eaf8'" onmouseout="this.style.background='#ebf5fb'"
      >${id}</span>`
    ).join('');
}

function openNewCasePage() {
  // 產生案號
  document.getElementById('nc-id').value = generateCaseId();
  renderCaseIdSuggestions();

  // 預設今天
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('nc-open-date').value = today;

  // 清空所有欄位
  ['nc-name','nc-student-id','nc-id-number','nc-disability',
   'nc-dept','nc-class','nc-phone','nc-email','nc-address','nc-emg-name','nc-emg-phone','nc-emg-relation',
   'nc-foreign-country','nc-topic-other',
   'nc-birth-year','nc-birth-month','nc-birth-day'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('nc-id-message').style.display = 'none';
  document.getElementById('nc-program').value = '';
  document.getElementById('nc-grade').value = '';
  document.querySelectorAll('input[name^="nc-"]').forEach(el => {
    if (el.type === 'radio') el.checked = false;
    if (el.type === 'checkbox') el.checked = false;
  });
  document.querySelector('input[name="nc-status"][value="active"]').checked = true;
  _ncBReasonsSelected.clear();
  _ncOnAbTypeChange();
  document.getElementById('nc-ethnicity-row').style.display = 'none';
  document.getElementById('nc-foreign-row').style.display   = 'none';
  const _ncGradLevelReset = document.getElementById('nc-gradlevel-row'); if (_ncGradLevelReset) _ncGradLevelReset.style.display = 'none';
  Object.values(ETH_NOTE_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('visible'); }
  });
  document.getElementById('dept-dropdown').style.display    = 'none';
  document.getElementById('dept-message').style.display     = 'none';
  const _ncClearWrap = document.getElementById('nc-topic-other-wrap'); if (_ncClearWrap) _ncClearWrap.style.display = 'none';
  const _ncClearHint = document.getElementById('nc-topic-other-hint'); if (_ncClearHint) _ncClearHint.style.display = 'none';
  const _ncClearOtherEl = document.getElementById('nc-topic-other'); if (_ncClearOtherEl) { _ncClearOtherEl.style.borderColor = ''; }
  ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5','nc-bsrs6'].forEach(id => setBsrsBtn(id, ''));
  const _ncBsrsUnfilledReset = document.getElementById('nc-bsrs-unfilled');
  if (_ncBsrsUnfilledReset) _ncBsrsUnfilledReset.checked = false;
  calcBsrsTotal();
  _ncEthSel = '';
  setAlert('new-case-alert', '', '');
  document.getElementById('nc-id-format-hint').style.display = 'none';
  const _ncSemDupWarn = document.getElementById('nc-semester-dup-warn'); if (_ncSemDupWarn) _ncSemDupWarn.style.display = 'none';
  const _ncColEl = document.getElementById('nc-college-display'); if (_ncColEl) _ncColEl.style.display = 'none';
  const _ncTransferEl = document.getElementById('nc-is-transfer-case'); if (_ncTransferEl) _ncTransferEl.checked = false;

  // 填充主責人員選單
  const sel = document.getElementById('nc-counselor');
  /* COUNSELOR_SELECT_GROUP:nc-counselor */
  sel.innerHTML = buildCounselorOptgroups(([, info]) => info.role && info.role !== '系統管理者', '未選擇');
  if (currentUser?.email && sel.querySelector(`option[value="${CSS.escape(currentUser.email)}"]`)) {
    sel.value = currentUser.email;
  }

  const mgrSection = document.getElementById('nc-managers-section');
  if (currentRole === '主任' || extraRole === '管理者') {
    mgrSection.style.display = '';
    renderNcManagersCheckboxes([]);
  } else {
    mgrSection.style.display = 'none';
  }

  clearRefill();
  document.getElementById('nc-refill-section').style.display = '';
  _editingCaseId = null;
  document.getElementById('new-case-page-title').textContent = '新增個案';
  document.getElementById('btn-save-case').textContent = '儲存個案';
  document.getElementById('btn-save-case').disabled = false;
  const _btnDelSem = document.getElementById('btn-delete-sem-data');
  if (_btnDelSem) { _btnDelSem.style.display = 'none'; _btnDelSem.onclick = null; }
  showPage('page-new-case', null);
  // v185：草稿備援基準快照（新增模式；編輯模式由 openEditCasePage 在欄位填完後覆蓋一次）
  _gdSetBaseline('case', _caseFormSnapshot());
  _startCaseDraftAutosave();
  const _cds0 = document.getElementById('_case-draft-status'); if (_cds0) _cds0.textContent = '';
}

// ── 系所列表
const DEPARTMENTS = [
  '食品科學系','農園生產系','水產養殖系','動物科學與畜產系','生物科技系',
  '森林系','植物醫學系','木材科學與設計系','科技農業學士學位學程食品科學系科技農業組',
  '食品安全管理研究所','食品生技碩士學位學程在職專班','生物資源博士班',
  '生物機電工程系','材料工程系','材料工程研究所','機械工程系','土木工程系',
  '車輛工程系','水土保持系','環境工程與科學系','環境資源與防災學位學程',
  '先進材料學士學位學程','農企業管理系','資訊管理系','工業管理系','企業管理系',
  '餐旅管理系','時尚設計與管理系','財務金融國際學士學位學程','財務金融研究所',
  '景觀暨遊憩管理研究所','科技管理研究所','高階經營管理碩士在職專班',
  '社會工作系','應用外語系','休閒運動健康系','幼兒保育系',
  '技術及職業教育研究所','客家文化產業研究所','獸醫學系','野生動物保育研究所',
  '動物疫苗科技研究所','熱帶農業暨國際合作系','食品科學國際碩士學位學程',
  '土壤與水工程國際碩士學位學程','農企業管理國際碩士學位學程',
  '觀賞魚科技及水生動物健康國際學位專班','動物用疫苗國際學位專班',
  '智慧機電學士學位學程',
];

const DEPT_TO_COLLEGE = {
  // 農學院
  '食品科學系':'農學院','農園生產系':'農學院','水產養殖系':'農學院',
  '動物科學與畜產系':'農學院','生物科技系':'農學院','森林系':'農學院',
  '植物醫學系':'農學院','木材科學與設計系':'農學院',
  '科技農業學士學位學程食品科學系科技農業組':'農學院',
  '食品安全管理研究所':'農學院','食品生技碩士學位學程在職專班':'農學院',
  '生物資源博士班':'農學院',
  // 工學院
  '生物機電工程系':'工學院','材料工程系':'工學院','材料工程研究所':'工學院',
  '機械工程系':'工學院','土木工程系':'工學院','車輛工程系':'工學院',
  '水土保持系':'工學院','環境工程與科學系':'工學院',
  '環境資源與防災學位學程':'工學院','先進材料學士學位學程':'工學院',
  '智慧機電學士學位學程':'工學院',
  // 管理學院
  '農企業管理系':'管理學院','資訊管理系':'管理學院','工業管理系':'管理學院',
  '企業管理系':'管理學院','餐旅管理系':'管理學院','時尚設計與管理系':'管理學院',
  '財務金融研究所':'管理學院','景觀暨遊憩管理研究所':'管理學院',
  '科技管理研究所':'管理學院','高階經營管理碩士在職專班':'管理學院',
  // 人文暨科學學院
  '社會工作系':'人文暨科學學院','應用外語系':'人文暨科學學院',
  '休閒運動健康系':'人文暨科學學院','幼兒保育系':'人文暨科學學院',
  '技術及職業教育研究所':'人文暨科學學院','客家文化產業研究所':'人文暨科學學院',
  // 獸醫學院
  '獸醫學系':'獸醫學院','野生動物保育研究所':'獸醫學院','動物疫苗科技研究所':'獸醫學院',
  // 國際學院（含「國際」字樣者）
  '財務金融國際學士學位學程':'國際學院','農企業管理國際碩士學位學程':'國際學院',
  '食品科學國際碩士學位學程':'國際學院','土壤與水工程國際碩士學位學程':'國際學院',
  '觀賞魚科技及水生動物健康國際學位專班':'國際學院',
  '動物用疫苗國際學位專班':'國際學院','熱帶農業暨國際合作系':'國際學院',
};
const COLLEGE_ORDER = ['農學院','工學院','管理學院','人文暨科學學院','獸醫學院','國際學院'];
function _getDeptToCollege() {
  const c = configData?.deptToCollege;
  return (c && Object.keys(c).length > 0) ? c : DEPT_TO_COLLEGE;
}
function getCollegeFromDept(dept) { return _getDeptToCollege()[dept] || ''; }

// ── v188：列印用系所縮寫（B3）──────────────────────────────
// 用途：晤談紀錄列印「班級」欄位組字（如「四休運四A」）。與下方 deptAbbrevMap（信件簡寫→正式系所名，
// 用於歸類）方向相反、互不相干，勿混用。每系所推定 2 字縮寫，全部不得重複；查無對應時 fallback 系所全名。
const DEPT_PRINT_ABBREV_DEFAULT = {
  // v206：與教務班級簡稱／tutorsys 對齊（2026-07-18 使用者逐條裁決，詳 memory project_freshman_test）
  '食品科學系':'食品', '農園生產系':'農園', '水產養殖系':'養殖', '動物科學與畜產系':'動畜', '生物科技系':'生技',
  '森林系':'森林', '植物醫學系':'植醫', '木材科學與設計系':'木設',
  '科技農業學士學位學程食品科學系科技農業組':'科農',
  '科技農業進修學士學位學程':'科農',
  '食品安全管理研究所':'食安', '食品生技碩士學位學程在職專班':'食生', '生物資源博士班':'生資',
  '農學院生物資源博士班':'生資',
  '生物機電工程系':'生機', '材料工程系':'材料', '材料工程研究所':'材研', '機械工程系':'機械', '土木工程系':'土木',
  '車輛工程系':'車輛', '水土保持系':'水保', '環境工程與科學系':'環工', '環境資源與防災學位學程':'環資',
  '先進材料學士學位學程':'先進', '農企業管理系':'農企', '資訊管理系':'資管', '工業管理系':'工管', '企業管理系':'企管',
  '餐旅管理系':'餐旅', '時尚設計與管理系':'時尚', '財務金融國際學士學位學程':'財金', '財務金融研究所':'財金',
  '景觀暨遊憩管理研究所':'景憩', '科技管理研究所':'科管', '高階經營管理碩士在職專班':'EMBA',
  '社會工作系':'社工', '應用外語系':'應外', '休閒運動健康系':'休運', '幼兒保育系':'幼保',
  '技術及職業教育研究所':'技職', '客家文化產業研究所':'客家', '獸醫學系':'獸醫', '野生動物保育研究所':'野保',
  '動物疫苗科技研究所':'動疫科技', '熱帶農業暨國際合作系':'熱農', '食品科學國際碩士學位學程':'食國',
  '土壤與水工程國際碩士學位學程':'土水', '農企業管理國際碩士學位學程':'農國',
  '觀賞魚科技及水生動物健康國際學位專班':'國際觀賞魚', '動物用疫苗國際學位專班':'國際動物疫苗',
  '智慧機電學士學位學程':'智慧機電',
};
// configData 自訂覆蓋優先 → 內建預設 → 查無回傳 ''（呼叫端自行 fallback 系所全名，見 _caseClassDisp）
function _deptPrintAbbrev(deptName) {
  if (!deptName) return '';
  const custom = configData?.deptPrintAbbrev?.[deptName];
  if (custom) return custom;
  return DEPT_PRINT_ABBREV_DEFAULT[deptName] || '';
}
// v188：晤談紀錄列印「班級」欄位（B1）——取代舊版系級（department+grade+classNo 空白相接）。
// 格式：<學制><系所縮寫><年級><班級>，例：日間部休閒運動健康系四年級A班 → 四休運四A；進修部 → 進四休運四A。
// 研究所學制依 c.gradLevel（碩/博）決定前綴；畢休生／教職員／家屬或研究所無 gradLevel（舊資料）時學制留空。
function _caseClassDisp(c) {
  if (!c) return '';
  const gradeCn = (() => {
    const s = String(c.grade || '').trim().replace(/年級$/, '');
    if (!s) return '';
    const map = { '1':'一', '2':'二', '3':'三', '4':'四', '5':'五', '6':'六', '7':'七', '7+':'七' };
    return map[s] || s;
  })();
  const deptAbbr = _deptPrintAbbrev(c.department) || c.department || '';
  const classNo = c.classNo || '';
  let prefix = '';
  if (c.caseType === '日間部') prefix = '四';
  else if (c.caseType === '進修部') prefix = '進四';
  else if (c.caseType === '研究所') prefix = c.gradLevel === '博' ? '博' : (c.gradLevel === '碩' ? '碩' : '');
  return `${prefix}${deptAbbr}${gradeCn}${classNo}`;
}

// ── 系所簡寫對照與全員協助歸類 ──────────────────────────────
// configData.deptAbbrevMap：{ 原始文字（如信件中的系所簡寫）: 正式系所名 }；值為 '' 表示已確認無法對應（不再請大家協助）
function _getDeptAbbrevMap() { return configData?.deptAbbrevMap || {}; }
// 從班級/簡寫原文抽出「系所核心簡寫」：去除數字/空白、尾端班別（甲乙丙丁/ABC）與年級（一~五），
// 再去學制前綴（四技/二技/五專/碩專…或單字 四二五碩博技）。例：四應外一A / 四應外二A → 應外（視為同一系所）
function _deptRawCore(s) {
  let t = (s || '').trim().replace(/[0-9０-９\s]/g, '');
  if (!t) return '';
  t = t.replace(/[甲乙丙丁ABCabcＡＢＣａｂｃ]$/, '').replace(/[一二三四五]$/, '');
  t = t.replace(/^(四技|二技|五專|二專|碩專|進修|夜間|日間)/, '');
  if (t.length > 2) t = t.replace(/^[四二五碩博技]/, '');
  return t || (s || '').trim();
}
// 將原始系所文字解析為正式系所名：正式名稱原樣回傳 → 對照表原文比對 → 對照表核心簡寫比對；查無回 ''
function resolveDeptName(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  const dc = _getDeptToCollege(), map = _getDeptAbbrevMap();
  if (dc[s] !== undefined) return s;
  if (map[s]) return map[s];
  const core = _deptRawCore(s);
  if (core && core !== s) {
    if (dc[core] !== undefined) return core;
    if (map[core]) return map[core];
  }
  return '';
}
// 唯一符合建議：正式系所名稱中依序包含核心簡寫的每個字、且只有一個候選時回傳之
function _deptSuggest(core) {
  if (!core) return '';
  const hits = Object.keys(_getDeptToCollege()).filter(d => {
    let i = 0;
    for (const ch of core) { i = d.indexOf(ch, i); if (i < 0) return false; i++; }
    return true;
  });
  return hits.length === 1 ? hits[0] : '';
}
// 收集身心調適假紀錄中無法對應正式系所的原文，依核心簡寫歸組（四應外一A/四應外二A 算同一題）
function _collectUnmappedDepts() {
  const map = _getDeptAbbrevMap();
  const groups = {};
  (mentalLeavesData || []).forEach(l => {
    if (l.deleted) return;
    const s = (l.department || '').trim();
    if (!s || resolveDeptName(s)) return;
    const core = _deptRawCore(s);
    if (map[s] === '' || map[core] === '') return; // 已確認無法判別
    const g = groups[core] || (groups[core] = { count: 0, variants: {} });
    g.count++;
    g.variants[s] = (g.variants[s] || 0) + 1;
  });
  return Object.entries(groups)
    .map(([raw, g]) => ({ raw, count: g.count, variants: Object.keys(g.variants) }))
    .sort((a, b) => b.count - a.count);
}
async function _saveDeptAbbrev(raw, dept, btn) {
  if (!configData.deptAbbrevMap) configData.deptAbbrevMap = {};
  const prev = configData.deptAbbrevMap[raw];
  configData.deptAbbrevMap[raw] = dept;
  if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('系所簡寫歸類', null, null, `「${raw}」→ ${dept || '（標記為無法判別）'}`);
    showToast(dept ? `已歸類：「${raw}」→ ${dept}，謝謝協助！` : `已標記「${raw}」為無法判別`, 'success');
    _renderClassifyHelpSection();
    if (typeof renderAdminDeptCollege === 'function') renderAdminDeptCollege();
  } catch (e) {
    if (prev === undefined) delete configData.deptAbbrevMap[raw]; else configData.deptAbbrevMap[raw] = prev;
    if (btn) { btn.disabled = false; btn.textContent = '確認'; }
    showToast('儲存失敗：' + e.message, 'error');
  }
}
function _classifyConfirm(btn) {
  const raw = decodeURIComponent(btn.getAttribute('data-raw') || '');
  const sel = btn.parentElement.querySelector('select');
  const dept = sel?.value || '';
  if (!dept) { alert('請先選擇要對應的正式系所。'); return; }
  _saveDeptAbbrev(raw, dept, btn);
}
function _classifyIgnore(btn) {
  const raw = decodeURIComponent(btn.getAttribute('data-raw') || '');
  if (!confirm(`確定將「${raw}」標記為無法判別的系所？\n之後不會再出現在協助歸類清單。`)) return;
  _saveDeptAbbrev(raw, '', btn);
}
function _toggleClassifyHelp() {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  window._classifyHelpCollapsed = !window._classifyHelpCollapsed;
  _renderClassifyHelpSection();
}
// 待辦頁「協助系統歸類」區塊：全員可見的小遊戲區——目前收錄「身心調適假系所簡寫 → 正式系所」
function _renderClassifyHelpSection() {
  const section = document.getElementById('todos-classify-help-section');
  if (!section) return;
  const items = _collectUnmappedDepts();
  if (!items.length) { section.innerHTML = ''; return; }
  const collapsed = !!window._classifyHelpCollapsed;
  const deptNames = Object.keys(_getDeptToCollege()).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const rows = collapsed ? '' : items.map(({ raw, count, variants }) => {
    const sug = _deptSuggest(raw); // 唯一符合時預選＋標示系統建議
    const opts = deptNames.map(d => `<option value="${escHtml(d)}"${d === sug ? ' selected' : ''}>${escHtml(d)}</option>`).join('');
    const varNote = (variants && (variants.length > 1 || variants[0] !== raw))
      ? `<div style="flex-basis:100%;font-size:.75rem;color:#a0aec0;padding-left:2px;">來自：${variants.map(v => escHtml(v)).join('、')}</div>` : '';
    return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;">
      <span style="font-weight:700;font-size:.9rem;color:#2d3748;">「${escHtml(raw)}」</span>
      <span style="font-size:.75rem;color:#a0aec0;">出現 ${count} 筆</span>
      ${sug ? '<span style="font-size:.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:1px 7px;">系統建議已預選，確認無誤即可送出</span>' : ''}
      <span style="font-size:.82rem;color:#718096;margin-left:auto;">應該是：</span>
      <select class="field-select" style="max-width:200px;font-size:.83rem;">
        <option value=""${sug ? '' : ' selected'}>—請選擇正式系所—</option>${opts}
      </select>
      <button class="btn btn-primary btn-sm" data-raw="${encodeURIComponent(raw)}" onclick="_classifyConfirm(this)">確認</button>
      <button class="btn btn-secondary btn-sm" data-raw="${encodeURIComponent(raw)}" onclick="_classifyIgnore(this)" data-tip="確定不是任何系所（如亂碼、班級代號）才點選">無法判別</button>
      ${varNote}
    </div>`;
  }).join('');
  section.innerHTML = `
    <div style="background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
      <div onclick="_toggleClassifyHelp()" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;margin-bottom:${collapsed ? '0' : '8px'};" data-tip="點選整列可收起/展開">
        <span style="font-weight:600;font-size:.9rem;color:#975a16;">
          <span style="display:inline-block;width:14px;">${collapsed ? '▶' : '▼'}</span>
          🧩 協助系統歸類（${items.length} 項待協助）
        </span>
        <span style="font-size:.78rem;color:#b7791f;">有空的話，幫系統認一下這些對不起來的系所簡寫吧！</span>
      </div>
      ${collapsed ? '' : `<div style="font-size:.78rem;color:#975a16;margin-bottom:8px;">以下是身心調適假信件中擷取到、但系統無法自動對應到正式系所的文字。您的歸類會讓學院/系所統計立即變準確，全中心共用、只需做一次。</div>${rows}`}
    </div>`;
}

const ETH_NOTE_IDS = {
  '漢民族': 'nc-eth-note-han',
  '原住民族': 'nc-eth-note-indigenous',
  '新住民二代': 'nc-eth-note-new2nd',
  '其他': 'nc-eth-note-other',
};

// v188：對象類別選「研究所」時要求補選碩/博（B2）；切走時隱藏並清空，避免殘留舊選項誤存
function _ncToggleGradLevel() {
  const val = document.querySelector('input[name="nc-type"]:checked')?.value || '';
  const row = document.getElementById('nc-gradlevel-row');
  if (!row) return;
  if (val === '研究所') {
    row.style.display = '';
  } else {
    row.style.display = 'none';
    document.querySelectorAll('input[name="nc-grad-level"]').forEach(r => { r.checked = false; });
  }
}

function toggleEthnicity() {
  const val = document.querySelector('input[name="nc-nationality"]:checked')?.value;
  document.getElementById('nc-ethnicity-row').style.display = val === '本國籍' ? '' : 'none';
  document.getElementById('nc-foreign-row').style.display   = val === '外國籍' ? '' : 'none';
  if (val !== '本國籍') {
    document.querySelectorAll('input[name="nc-ethnicity"]').forEach(r => r.checked = false);
    Object.values(ETH_NOTE_IDS).forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.classList.remove('visible'); }
    });
  }
}

let _ncEthSel = '';
function _ethToggle(el) {
  if (_ncEthSel === el.value) {
    el.checked = false;
    _ncEthSel = '';
    toggleEthnicityNote({ value: '' });
  } else {
    _ncEthSel = el.value;
  }
}
function toggleEthnicityNote(radioEl) {
  _ncEthSel = radioEl.value || '';
  Object.values(ETH_NOTE_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  });
  const noteId = ETH_NOTE_IDS[radioEl.value];
  if (noteId) document.getElementById(noteId)?.classList.add('visible');
}

function autoJumpBirth(el, nextId, maxLen) {
  if (el.value.replace(/\D/g, '').length >= maxLen) {
    document.getElementById(nextId)?.focus();
  }
}


function adToRocDisplay(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return s;
  return `民國 ${d.getFullYear() - 1911} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
}

function updateOpenDateRoc() {
  const val = document.getElementById('nc-open-date')?.value;
  const el  = document.getElementById('nc-open-date-roc');
  if (!el) return;
  if (val) {
    const d = new Date(val + 'T00:00:00');
    el.textContent = `民國 ${d.getFullYear() - 1911} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
  } else { el.textContent = ''; }
}

function updateBirthRoc() {
  const y  = parseInt(document.getElementById('nc-birth-year')?.value || '');
  const m  = document.getElementById('nc-birth-month')?.value || '';
  const d  = document.getElementById('nc-birth-day')?.value || '';
  const el = document.getElementById('nc-birth-roc');
  if (!el) return;
  if (y >= 1912) {
    el.textContent = `民國 ${y - 1911} 年${m ? ' ' + parseInt(m) + ' 月' : ''}${d ? ' ' + parseInt(d) + ' 日' : ''}`;
  } else { el.textContent = ''; }
}

function bsrsLevelInfo(score) {
  if (score <= 5)  return { color:'#276749', bg:'#f0fff4', border:'#9ae6b4', msg:`【正常（${score} 分）】個案情緒狀態在正常範圍，建議定期關注。` };
  if (score <= 9)  return { color:'#744210', bg:'#fffbeb', border:'#fbd38d', msg:`【輕度困擾（${score} 分）】建議鼓勵個案向家人或朋友傾訴，提供情緒支持，持續追蹤。` };
  if (score <= 14) return { color:'#7b341e', bg:'#fff5f0', border:'#feb2b2', msg:`【中度困擾（${score} 分）】建議安排心理諮商，進行專業評估；視情況評估是否轉介精神科。` };
  return { color:'#742a2a', bg:'#fff5f5', border:'#fc8181', msg:`【重度困擾（${score} 分）】建議優先安排深度評估，積極考慮轉介精神科，必要時啟動危機介入。` };
}

function bsrs6AlertInfo(score) {
  if (score === 1) return { color:'#744210', bg:'#fffbeb', border:'#fbd38d', msg:'第6題有輕微自殺想法，建議深入評估自殺風險，保持密切關注。' };
  return { color:'#742a2a', bg:'#fff5f5', border:'#fc8181', msg:'第6題有明顯自殺風險，建議立即進行自殺風險評估，必要時啟動危機介入程序並轉介精神科。' };
}

function _bsrsAlertHtml(info) {
  return `<div style="padding:7px 10px;border-left:3px solid ${info.border};background:${info.bg};color:${info.color};font-size:.84rem;border-radius:0 4px 4px 0;">${info.msg}</div>`;
}

function setBsrsBtn(id, val) {
  const group = document.querySelector(`.bsrs-btn-group[data-id="${id}"]`);
  if (!group) return;
  group.querySelectorAll('.bsrs-opt').forEach(b => b.classList.toggle('active', b.dataset.val === val));
  document.getElementById(id).value = val;
}

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.bsrs-opt');
  if (!btn || btn.disabled) return;
  const group = btn.closest('.bsrs-btn-group');
  if (!group) return;
  group.querySelectorAll('.bsrs-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(group.dataset.id).value = btn.dataset.val;
  // v179：身心狀態評估表的 BSRS 按鈕組沿用同一套 .bsrs-btn-group/.bsrs-opt 樣式，id 前綴 mla- 走專屬總分計算，避免與新增個案的 nc- 互相干擾
  if (group.dataset.id.startsWith('mla-')) { if (typeof _mlaCalcBsrsTotal === 'function') _mlaCalcBsrsTotal(); }
  else calcBsrsTotal();
});

function calcBsrsTotal() {
  const ids = ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5'];
  let total = 0, allFilled = true, hasSome = false;
  for (const id of ids) {
    const v = document.getElementById(id)?.value;
    if (v !== '' && v !== undefined) { total += parseInt(v)||0; hasSome = true; }
    else { allFilled = false; }
  }
  const el = document.getElementById('nc-bsrs-total');
  if (el) el.textContent = hasSome ? total : '—';

  const alertEl = document.getElementById('nc-bsrs-total-alert');
  if (alertEl) {
    if (allFilled) { alertEl.innerHTML = _bsrsAlertHtml(bsrsLevelInfo(total)); alertEl.style.display = ''; }
    else { alertEl.style.display = 'none'; }
  }

  const q6v = document.getElementById('nc-bsrs6')?.value;
  const q6score = q6v !== '' && q6v !== undefined ? parseInt(q6v) : null;
  const q6AlertEl = document.getElementById('nc-bsrs6-alert');
  if (q6AlertEl) {
    if (q6score !== null && q6score > 0) { q6AlertEl.innerHTML = _bsrsAlertHtml(bsrs6AlertInfo(q6score)); q6AlertEl.style.display = ''; }
    else { q6AlertEl.style.display = 'none'; }
  }

  // #34：6 題（含第6題）皆未填時才顯示「個案未填寫 BSRS」勾選框；只要任一題有填值即隱藏並清除勾選狀態
  const _bsrsAllUnfilled = !hasSome && q6score === null;
  const _unfilledWrap = document.getElementById('nc-bsrs-unfilled-wrap');
  if (_unfilledWrap) {
    _unfilledWrap.style.display = _bsrsAllUnfilled ? '' : 'none';
    if (!_bsrsAllUnfilled) {
      const _cb = document.getElementById('nc-bsrs-unfilled');
      if (_cb) _cb.checked = false;
    }
  }
}

// v252：個案資料表單匯入區塊拆到 dev/case-import.js（build 原樣複製）

// v253：初次晤談模組拆到 dev/initial-interview.js（build 原樣複製）

function renderCounselorLinkTool() {
  const out = document.getElementById('counselor-link-result');
  if (!out) return;
  // 找所有 counselorEmail 為空但有 counselorText/counselorName 的個案
  const unlinked = new Map(); // displayName → { count, caseIds }
  casesData.forEach(c => {
    if (c.deleted) return;
    if (c.counselorEmail) return;
    const name = (c.counselorText || c.counselorName || '').trim();
    if (!name) return;
    if (!unlinked.has(name)) unlinked.set(name, { count: 0 });
    unlinked.get(name).count++;
  });
  if (!unlinked.size) {
    out.innerHTML = '<span style="color:#276749;">✓ 目前所有個案的主責人員均已連結帳號。</span>';
    return;
  }
  const users = configData?.users || {};
  const userOpts = Object.entries(users)
    .filter(([, u]) => u.role && u.name)
    .map(([email, u]) => `<option value="${escHtml(email)}">${escHtml(u.name)} (${escHtml(email)})</option>`)
    .join('');
  let html = `<div style="font-size:.88rem;color:#744210;background:#fffbeb;border:1px solid #fbd38d;border-radius:6px;padding:10px 14px;margin-bottom:12px;">
    找到 <strong>${unlinked.size}</strong> 個未連結的主責人員名稱，共影響 <strong>${[...unlinked.values()].reduce((s,v)=>s+v.count,0)}</strong> 筆個案。
  </div>`;
  let idx = 0;
  for (const [name, info] of unlinked) {
    html += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #e2e8f0;">
      <div style="min-width:180px;font-weight:600;color:#2d3748;font-size:.875rem;">${escHtml(name)}<span style="font-weight:400;color:#718096;margin-left:6px;">(${info.count} 筆)</span></div>
      <select id="cl-sel-${idx}" class="field-input" style="flex:1;min-width:200px;max-width:320px;padding:5px 8px;">
        <option value="">— 選擇要連結的帳號 —</option>
        ${userOpts}
      </select>
      <button class="btn btn-primary btn-sm" onclick="applyCounselorLink('${escHtml(name)}','cl-sel-${idx}')">連結</button>
    </div>`;
    idx++;
  }
  out.innerHTML = html;
}

async function applyCounselorLink(counselorText, selId) {
  const email = document.getElementById(selId)?.value;
  if (!email) { alert('請選擇要連結的帳號。'); return; }
  const userName = configData?.users?.[email]?.name || email;
  if (!confirm(`將所有主責為「${counselorText}」的個案連結至「${userName}（${email}）」？`)) return;
  let touched = 0;
  casesData.forEach(c => {
    if (c.counselorEmail) return;
    const name = (c.counselorText || c.counselorName || '').trim();
    if (name !== counselorText) return;
    c.counselorEmail = email;
    c.counselorName  = userName;
    c.counselorText  = counselorText;
    c.updatedAt = new Date().toISOString();
    touched++;
  });
  if (!touched) { alert('沒有找到符合的個案。'); return; }
  renderCounselorLinkTool(); renderCases(); // 立即更新 UI
  const jobId = bgJobAdd(`連結主責人員：${counselorText} → ${userName}`, `${touched} 筆個案`);
  (async () => {
    try {
      casesManifest = { chunks: [] };
      await migrateToChunks();
      auditLog('連結主責人員帳號', null, `${counselorText} → ${email}，${touched} 筆`);
      bgJobDone(jobId);
      showToast(`✓ 已連結 ${touched} 筆個案`, 'success');
    } catch (err) {
      bgJobFail(jobId, err.message);
      showToast('連結失敗：' + err.message, 'error', 6000);
    }
  })();
}

function filterImportClosureRows() {
  const q = (document.getElementById('imp-search')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#imp-closure-list label').forEach(lbl => {
    if (!q) { lbl.style.display = ''; return; }
    const text = lbl.textContent.toLowerCase();
    lbl.style.display = text.includes(q) ? '' : 'none';
  });
}

function validateCaseIdFormat(el) {
  const val  = el.value.trim();
  const hint = document.getElementById('nc-id-format-hint');
  if (!val) { hint.style.display = 'none'; return; }
  if (val.length !== 7) {
    hint.textContent = `⚠ 案號須為 7 碼（目前輸入 ${val.length} 碼）`;
    hint.style.display = '';
  } else if (parseInt(val.slice(4), 10) === 0) {
    hint.textContent = '⚠ 案號序號不可為 000，須從 001 起';
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }
}

function checkCaseIdDuplicate() {
  const val   = document.getElementById('nc-id').value.trim();
  const msgEl = document.getElementById('nc-id-message');
  if (!val) { msgEl.style.display = 'none'; return; }
  const dup = casesData.find(c => c.id === val && c.id !== _editingCaseId);
  if (!dup) {
    // 一學生一案號：輸入值若為某案的曾用案號（合併遷移後被併掉的舊案號），提示現在的主案號
    const former = casesData.find(c => c.id !== _editingCaseId && (c.formerIds || []).some(f => f.id === val));
    if (former) {
      msgEl.innerHTML = `<div style="margin-top:6px;padding:10px 14px;background:#fffbeb;border:2px solid #f6ad55;border-radius:6px;font-size:.875rem;">
        ⚠️ 「${escHtml(val)}」是個案「${escHtml(former.name)}」的曾用案號，目前主案號為 <strong>${escHtml(former.id)}</strong>。
        <div style="margin-top:8px;"><span class="dept-msg-option dept-create" onclick="event.stopPropagation();showCaseDetail('${escHtml(former.id)}')">查看該個案</span></div>
      </div>`;
      msgEl.style.display = '';
    } else {
      msgEl.style.display = 'none';
    }
    return;
  }
  const curSid  = (document.getElementById('nc-student-id')?.value || '').trim();
  const curIdn  = (document.getElementById('nc-id-number')?.value || '').trim();
  const curName = (document.getElementById('nc-name')?.value || '').trim();
  const sidMatch  = curSid  && curSid  === dup.studentId;
  const idnMatch  = curIdn  && curIdn  === dup.idNumber;
  const nameMatch = curName && curName === dup.name;
  const anyMatch  = sidMatch || idnMatch || nameMatch;
  let html = '';
  if (anyMatch) {
    // 同一學生（不論本學期或舊學期既有案號）：一學生一案號，資訊提示儲存時將自動沿用既有案號新增本學期開案
    html = `<div style="margin-top:6px;padding:10px 14px;background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;font-size:.875rem;">
      ℹ️ 此學生已有案號 <strong>${escHtml(dup.id)}</strong>，儲存時將自動採用該案號新增本學期開案。
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();_ncViewExistingCase('${escHtml(dup.id)}')" data-tip="若此個案非你主責/個管，點選後你在該個案詳細頁的所有操作都會被記錄並通知全體專任，主責與個管會被加強通知。">察看個案資料與過去紀錄</button>
      </div>
    </div>`;
  } else {
    // 不同學生：案號衝突，詢問是否同一學生（判斷流程在儲存時執行）
    html = `<div style="margin-top:6px;padding:10px 14px;background:#fffbeb;border:2px solid #f6ad55;border-radius:6px;font-size:.875rem;">
      ⚠️ 案號「${escHtml(val)}」已被個案「${escHtml(dup.name)}」（學號：${escHtml(dup.studentId)}）使用。<br>
      <span style="font-size:.82rem;color:#7d4a00;">若為不同學生請修改案號；若為同一學生但資料有異動，修改案號後儲存，系統將協助確認更新。</span>
      <div style="margin-top:8px;"><span class="dept-msg-option dept-create" onclick="quickEditCaseId('${escHtml(dup.id)}','${escHtml(dup.name)}')">修改「${escHtml(dup.name)}」的案號</span></div>
    </div>`;
  }
  msgEl.innerHTML = html;
  msgEl.style.display = '';
}

// 一學生一案號：帶入既有案號（取代舊版「另外開案產生新案號」）
function _useExistingCaseId(dupId) {
  const el = document.getElementById('nc-id');
  el.value = dupId;
  el.classList.remove('_nc-id-flash'); void el.offsetWidth; el.classList.add('_nc-id-flash');
  document.getElementById('nc-id-message').style.display = 'none';
  renderCaseIdSuggestions(); checkCaseIdDuplicate(); checkCurrentSemesterDuplicate();
}

// ── #9：察看個案資料與過去紀錄（自新增個案頁的既有案號提示進入）──
// 主責/個管/初談/未派案，或今日已授權 → 直接檢視；否則走警語流程（是=危機閱讀／否=填理由）。
function _ncViewExistingCase(caseId) {
  const c = (casesData || []).find(x => x.id === caseId) || _casesIndexCache?.cases?.find(x => x.id === caseId);
  if (!c) { alert('找不到個案'); return; }
  const allowedSet = new Set(configData?.users?.[currentUser?.email]?.allowedCases || []);
  const isOwner = _caseVisibleToUser(c, currentUser?.email, allowedSet); // 主責/同學期主責/個管/初談/未派案/督導窗口
  if (isOwner || _hasCrisisGrant(caseId)) {
    _crisisEnsureCaseStub(caseId);
    _detailReturnToNewCase = true;
    showCaseDetail(caseId);
    return;
  }
  _showViewCaseWarnModal(c);
}

// 步驟 b：警語 window——提醒「全體專任＋主責/個管會知悉」，詢問是否以危機個案閱讀進行（是/否/取消）
function _showViewCaseWarnModal(c) {
  document.getElementById('view-case-warn-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'view-case-warn-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:500px;">
      <div class="modal-header"><h3>⚠ 查閱他人個案</h3></div>
      <div class="modal-body" style="padding:12px 2px 8px;font-size:.9rem;color:#4a5568;line-height:1.75;">
        <p>你即將查閱<strong>非你主責／個管</strong>的個案　<strong>${escHtml(c.name || '')}</strong>（${escHtml(c.id)}）的完整資料與過去紀錄。</p>
        <p style="color:#c53030;">⚠ 進入後，你在此個案詳細頁的<strong>所有操作都會被記錄</strong>，並通知<strong>全體專任</strong>；<strong>主責與個管會被加強通知</strong>。</p>
        <p>是否以「<strong>危機個案閱讀</strong>」進行？（危機閱讀會取得該案當日唯讀權限並留下正式紀錄）</p>
      </div>
      <div class="modal-footer" style="gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" onclick="document.getElementById('view-case-warn-modal').remove()">取消</button>
        <button class="btn btn-secondary" onclick="_viewCaseWarnChoose('${escHtml(c.id)}', false)">否，填理由後閱讀</button>
        <button class="btn btn-danger" onclick="_viewCaseWarnChoose('${escHtml(c.id)}', true)">是，危機個案閱讀</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _viewCaseWarnChoose(caseId, isCrisis) {
  document.getElementById('view-case-warn-modal')?.remove();
  if (isCrisis) _grantViewCaseAccess(caseId, '危機個案閱讀', true);
  else _showViewCaseReasonModal(caseId); // 步驟 c
}

// 步驟 c：填寫閱讀理由（必填）→ 送出後授權閱讀
function _showViewCaseReasonModal(caseId) {
  document.getElementById('view-case-reason-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'view-case-reason-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:480px;">
      <div class="modal-header"><h3>填寫閱讀理由</h3></div>
      <div class="modal-body" style="padding:12px 2px 8px;">
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">閱讀個案資料的理由（必填，將公開於全體監督區並通知主責／個管）</label>
        <textarea id="view-case-reason" class="field-input" rows="3" style="width:100%;" placeholder="例：原主責離職，個案前來預約，想確認是否是同一個案。"></textarea>
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn btn-secondary" onclick="document.getElementById('view-case-reason-modal').remove()">取消</button>
        <button class="btn btn-primary" onclick="_viewCaseReasonSubmit('${escHtml(caseId)}')">送出並閱讀</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('view-case-reason')?.focus(), 50);
}
function _viewCaseReasonSubmit(caseId) {
  const reason = (document.getElementById('view-case-reason')?.value || '').trim();
  if (!reason) { alert('請填寫閱讀理由'); return; }
  document.getElementById('view-case-reason-modal')?.remove();
  _grantViewCaseAccess(caseId, reason, false);
}

// 授權閱讀 + 記錄 + 加強通知主責/個管 + 開啟詳細頁（返回動線回新增個案頁）
async function _grantViewCaseAccess(caseId, reason, isCrisis) {
  const c = (casesData || []).find(x => x.id === caseId) || _casesIndexCache?.cases?.find(x => x.id === caseId);
  if (!c) { alert('找不到個案'); return; }
  // B4：點擊（是/送出）當下同步立即顯示置中提示，不等 _appendAccessLog 等 await 跑完才出現（原本會晚約 2 秒）
  showLoading(`「${c.name || caseId}」個案資料載入中…`);
  const entry = {
    id: 'acg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), type: 'grant',
    email: currentUser.email, name: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
    caseId, caseName: c.name || '', caseStudentId: c.studentId || '', reason,
    viaViewButton: true, isCrisis: !!isCrisis, t: new Date().toISOString(),
  };
  try {
    await _appendAccessLog(entry);
    auditLog(isCrisis ? '危機案件閱讀申請' : '查閱他人個案資料', caseId, null, reason, { major: true });
    _notifyCaseOwnersOfView(c, reason, isCrisis);
    _crisisEnsureCaseStub(caseId);
    renderCases();
    _detailReturnToNewCase = true;
    showToast('✅ 已記錄並取得當日閱讀權限，開啟中…', 'success');
    await showCaseDetail(caseId);
  } catch (e) {
    alert('記錄失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

// 加強通知：主責 + 個管 + 初談者（排除本人）鈴鐺通知
function _notifyCaseOwnersOfView(c, reason, isCrisis) {
  const owners = new Set();
  const lat = _getLatestCounselorEmail(c); if (lat) owners.add(lat);
  _getManagersForCase(c.id).forEach(e => owners.add(e));
  _getInitialInterviewersForCase(c).forEach(e => owners.add(e));
  owners.delete(currentUser?.email);
  if (!owners.size) return;
  const actorName = configData?.users?.[currentUser.email]?.name || currentUser.name || currentUser.email;
  const msg = `⚠ ${actorName} 查閱了個案「${c.name || c.id}」（${isCrisis ? '危機個案閱讀' : '一般閱讀'}）的完整資料。理由：${reason}`;
  const nowIso = new Date().toISOString();
  owners.forEach(email => {
    if (!configData?.users?.[email]) return;
    _queueNotifPush(email, {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'case_viewed_by_other', message: msg, caseId: c.id,
      actorEmail: currentUser.email, createdAt: nowIso, read: false,
    });
  });
  _flushNotifOps().catch(() => {});
}

function _showEmgRelChips() { _filterEmgRelChips(document.getElementById('nc-emg-relation')?.value || ''); }
function _hideEmgRelChips() {
  const w = document.getElementById('nc-emg-relation-chips');
  if (w) w.style.display = 'none';
}
function _filterEmgRelChips(q) {
  const w = document.getElementById('nc-emg-relation-chips');
  if (!w) return;
  const presets = configData?.emgRelationPresets || ['父','母','兄','姊','弟','妹','配偶','祖父','祖母','外祖父','外祖母','友人'];
  const fromData = [...new Set((casesData || []).map(c => (c.emergencyRelation || '').trim()).filter(Boolean))];
  const all = [...new Set([...presets, ...fromData])].sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const hits = q.trim() ? all.filter(r => r.includes(q)) : all;
  if (!hits.length) { w.style.display = 'none'; return; }
  w.innerHTML = hits.map(r =>
    `<span onclick="document.getElementById('nc-emg-relation').value='${escHtml(r)}';_hideEmgRelChips();"
      style="cursor:pointer;background:#ebf8ff;color:#2b6cb0;border:1px solid #90cdf4;border-radius:12px;padding:3px 10px;font-size:.82rem;"
      onmouseover="this.style.background='#bee3f8'" onmouseout="this.style.background='#ebf8ff'">${escHtml(r)}</span>`
  ).join('');
  w.style.display = 'flex';
}

function toggleTopicOther(cb) {
  const wrap = document.getElementById('nc-topic-other-wrap');
  if (wrap) wrap.style.display = cb.checked ? 'flex' : 'none';
  const el = document.getElementById('nc-topic-other');
  const hint = document.getElementById('nc-topic-other-hint');
  if (!cb.checked) {
    if (el) { el.value = ''; el.style.borderColor = ''; }
    if (hint) hint.style.display = 'none';
  } else if (hint && el) {
    hint.style.display = el.value.trim() ? 'none' : '';
  }
}

function _validateTopicOther(pfx) {
  const el   = document.getElementById(`${pfx}-topic-other`);
  const hint = document.getElementById(`${pfx}-topic-other-hint`);
  if (!el || !hint) return;
  const empty = !el.value.trim();
  hint.style.display  = empty ? '' : 'none';
  el.style.borderColor = empty ? '#e53e3e' : '';
}
function _validateEvrTopicOther(idx) {
  const el   = document.getElementById(`evr${idx}-topic-other`);
  const hint = document.getElementById(`evr${idx}-topic-other-hint`);
  if (!el || !hint) return;
  const empty = !el.value.trim();
  hint.style.display  = empty ? '' : 'none';
  el.style.borderColor = empty ? '#e53e3e' : '';
}

// ── 系所自動完成
let _deptBlurTimer = null;

function deptFuzzyMatch(val) {
  // 1. 完整字串 substring 優先
  let exact = DEPARTMENTS.filter(d => d.includes(val));
  if (exact.length) return exact;
  // 2. 逐字縮短（從末尾刪字），找到為止
  for (let len = val.length - 1; len >= 1; len--) {
    const sub = val.slice(0, len);
    const found = DEPARTMENTS.filter(d => d.includes(sub));
    if (found.length) return found;
  }
  return [];
}

function filterDepts() {
  _updateNcCollege();
  const val = document.getElementById('nc-dept').value.trim();
  const dropdown = document.getElementById('dept-dropdown');
  document.getElementById('dept-message').style.display = 'none';
  if (!val) { dropdown.style.display = 'none'; return; }
  const matches = deptFuzzyMatch(val);
  if (!matches.length) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(d =>
    `<div class="dept-option" onmousedown="selectDept(event,'${escHtml(d)}')">${escHtml(d)}</div>`
  ).join('');
  dropdown.style.display = '';
}

function _updateNcCollege() {
  const dept = (document.getElementById('nc-dept')?.value || '').trim();
  const college = getCollegeFromDept(dept);
  const el = document.getElementById('nc-college-display');
  const txt = document.getElementById('nc-college-text');
  if (!el || !txt) return;
  if (college) { txt.textContent = college; el.style.display = ''; }
  else { el.style.display = 'none'; }
}
function selectDept(e, name) {
  e.preventDefault();
  document.getElementById('nc-dept').value = name;
  document.getElementById('dept-dropdown').style.display = 'none';
  document.getElementById('dept-message').style.display = 'none';
  _updateNcCollege();
}

function handleDeptBlur() {
  clearTimeout(_deptBlurTimer);
  _deptBlurTimer = setTimeout(() => {
    document.getElementById('dept-dropdown').style.display = 'none';
    const val = document.getElementById('nc-dept').value.trim();
    if (!val || DEPARTMENTS.includes(val)) return;
    showDeptMessage(val);
  }, 200);
}

function showDeptMessage(val) {
  const matches = deptFuzzyMatch(val);
  const list = matches.length ? matches : DEPARTMENTS;
  const opts = list.map(d =>
    `<span class="dept-msg-option" onclick="pickDept('${escHtml(d)}')">${escHtml(d)}</span>`
  ).join(' ');
  const msgEl = document.getElementById('dept-message');
  msgEl.innerHTML = `<div class="alert alert-warn" style="margin-top:6px;">
    「${escHtml(val)}」不在既有系所列表中，請選擇：
    <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">${opts}</div>
    <div style="margin-top:10px;">
      <span class="dept-msg-option dept-create" onclick="confirmCreateDept('${escHtml(val)}')">
        ＋ 建立「${escHtml(val)}」
      </span>
    </div>
  </div>`;
  msgEl.style.display = '';
}

function pickDept(name) {
  document.getElementById('nc-dept').value = name;
  document.getElementById('dept-message').style.display = 'none';
  _updateNcCollege();
}

async function quickEditCaseId(oldId, caseName) {
  const newId = prompt(`請輸入「${caseName}」的新案號：`, oldId);
  if (!newId || !newId.trim() || newId.trim() === oldId) return;
  const trimmed = newId.trim();
  const conflict = casesData.find(c => c.id === trimmed);
  if (conflict) {
    alert(`案號「${trimmed}」也已被「${conflict.name}」使用，請重新輸入。`);
    return;
  }
  showLoading('更新案號…');
  const idx = casesData.findIndex(c => c.id === oldId);
  if (idx === -1) { hideLoading(); return; }
  const prev = casesData[idx].id;
  casesData[idx].id = trimmed;
  casesData[idx].updatedAt = new Date().toISOString();
  try {
    await saveCasesChunks(oldId, trimmed);
    hideLoading();
    setAlert('new-case-alert', 'info',
      `「${escHtml(caseName)}」的案號已更新為「${escHtml(trimmed)}」，現在可以繼續儲存新個案。`);
  } catch (err) {
    casesData[idx].id = prev;
    hideLoading();
    alert('更新失敗：' + err.message);
  }
}

function confirmCreateDept(name) {
  if (confirm(`這個系所不在既有列表中，確認要建立「${name}」？`)) {
    DEPARTMENTS.push(name);
    document.getElementById('dept-message').style.display = 'none';
  } else {
    showDeptMessage(name);
  }
}

async function saveCase() {
  // 收集欄位
  const id         = document.getElementById('nc-id').value.trim();
  const openDate   = document.getElementById('nc-open-date').value;
  const name       = document.getElementById('nc-name').value.trim();
  const studentId  = document.getElementById('nc-student-id').value.trim();
  const by = document.getElementById('nc-birth-year').value.trim();
  const bm = document.getElementById('nc-birth-month').value.trim().padStart(2,'0');
  const bd = document.getElementById('nc-birth-day').value.trim().padStart(2,'0');
  const birthday = (by && bm && bd) ? `${by}-${bm}-${bd}` : '';
  const idNumber   = document.getElementById('nc-id-number').value.trim();
  const gender     = document.querySelector('input[name="nc-gender"]:checked')?.value || '';
  const genderId   = document.querySelector('input[name="nc-gender-id"]:checked')?.value || '';
  const caseType   = document.querySelector('input[name="nc-type"]:checked')?.value || '';
  const gradLevel  = caseType === '研究所' ? (document.querySelector('input[name="nc-grad-level"]:checked')?.value || '') : '';
  const nationality= document.querySelector('input[name="nc-nationality"]:checked')?.value || '';
  const ethnicity  = document.querySelector('input[name="nc-ethnicity"]:checked')?.value || '';
  const ethnicityNote = (ethnicity && ETH_NOTE_IDS[ethnicity])
    ? (document.getElementById(ETH_NOTE_IDS[ethnicity])?.value.trim() || '') : '';
  const program    = document.getElementById('nc-program').value;
  const disability = document.getElementById('nc-disability').value.trim();
  const dept       = document.getElementById('nc-dept').value.trim();
  const grade      = document.getElementById('nc-grade').value;
  const classNo    = document.getElementById('nc-class').value.trim();
  const phone      = document.getElementById('nc-phone').value.trim();
  const email      = document.getElementById('nc-email').value.trim();
  const residence  = document.querySelector('input[name="nc-residence"]:checked')?.value || '';
  const address    = document.getElementById('nc-address').value.trim();
  const emgName    = document.getElementById('nc-emg-name').value.trim();
  const emgPhone   = document.getElementById('nc-emg-phone').value.trim();
  const emgRelation= document.getElementById('nc-emg-relation').value.trim();
  const source     = document.querySelector('input[name="nc-source"]:checked')?.value || '';
  const status     = document.querySelector('input[name="nc-status"]:checked')?.value || 'active';
  const abType     = document.querySelector('input[name="nc-ab-type"]:checked')?.value || '';
  const counselorEmail = document.getElementById('nc-counselor').value;
  const foreignCountry = document.getElementById('nc-foreign-country').value.trim();
  const bsrsIds = ['nc-bsrs1','nc-bsrs2','nc-bsrs3','nc-bsrs4','nc-bsrs5'];
  const bsrs = bsrsIds.map(id => { const v = document.getElementById(id)?.value; return v !== '' ? parseInt(v) : null; });
  const bsrs6v = document.getElementById('nc-bsrs6')?.value;
  const bsrs6 = bsrs6v !== '' ? parseInt(bsrs6v) : null;
  const bsrsTotal = bsrs.some(v => v !== null) ? bsrs.filter(v=>v!==null).reduce((a,b)=>a+b,0) : null;
  // #34：6 題皆未填時，須勾選「個案未填寫 BSRS」才能儲存；只要任一題有填值就不需要這個勾選
  const _bsrsAllUnfilled = bsrs.every(v => v === null) && bsrs6 === null;
  const bsrsUnfilled = _bsrsAllUnfilled && !!document.getElementById('nc-bsrs-unfilled')?.checked;
  const isTransferCase = !!(document.getElementById('nc-is-transfer-case')?.checked);

  const pastRecords = [];
  if (document.getElementById('nc-past-psych').checked)   pastRecords.push('精神科就診');
  if (document.getElementById('nc-past-med').checked)     pastRecords.push('服用精神藥物');
  if (document.getElementById('nc-past-counsel').checked) pastRecords.push('心理諮商');

  const topicOtherText = document.getElementById('nc-topic-other').value.trim();
  const topics = [...document.querySelectorAll('input[name="nc-topic"]:checked')].map(el =>
    el.value === '其他' && topicOtherText ? `其他：${topicOtherText}` : el.value
  );

  // 驗證必填
  const missing = [];
  if (!id)             missing.push('案號');
  if (!name)           missing.push('姓名');
  if (!studentId)      missing.push('學號');
  if (!idNumber)       missing.push('身分證字號');
  if (!gender)         missing.push('法定性別');
  if (!openDate)       missing.push('開案日期');
  if (!caseType)       missing.push('對象類別');
  if (caseType === '研究所' && !gradLevel) missing.push('研究所碩/博');
  if (!nationality)    missing.push('國籍');
  if (!program)        missing.push('學制');
  if (!dept)           missing.push('系所');
  if (!phone)          missing.push('聯絡電話');
  if (!residence)      missing.push('住所類型');
  if (!emgName)        missing.push('緊急聯絡人姓名');
  if (!emgPhone)       missing.push('緊急聯絡人電話');
  if (!emgRelation)    missing.push('緊急聯絡人關係');
  if (!abType)         missing.push('案別（A案／B案）');
  const bCaseReasons = abType === 'B案' ? [..._ncBReasonsSelected] : [];
  if (abType === 'B案' && !bCaseReasons.length) missing.push('B 案原由（至少勾選一項）');
  if (!source)         missing.push('來源');
  if (!topics.length)  missing.push('主訴問題分類');
  if (document.querySelector('input[name="nc-topic"][value="其他"]')?.checked && !topicOtherText) {
    _validateTopicOther('nc');
    missing.push('主訴問題分類「其他」說明');
  }
  const BSRS_UNFILLED_LABEL = 'BSRS-5 量表（6 題皆未填時，請勾選「個案未填寫 BSRS」）';
  if (_bsrsAllUnfilled && !bsrsUnfilled) missing.push(BSRS_UNFILLED_LABEL);
  const _caseAlert = (msg) => {
    setAlert('new-case-alert', 'error', msg);
    document.getElementById('new-case-alert').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (missing.length) {
    _caseAlert('請填寫必填欄位：' + missing.join('、'));
    document.querySelectorAll('.form-section-error').forEach(el => el.classList.remove('form-section-error'));
    const _fmap = {'案號':'nc-id','姓名':'nc-name','學號':'nc-student-id','身分證字號':'nc-id-number','法定性別':'nc-gender','開案日期':'nc-open-date','對象類別':'nc-type','研究所碩/博':'nc-grad-level','國籍':'nc-nationality','學制':'nc-program','系所':'nc-dept','聯絡電話':'nc-phone','住所類型':'nc-residence','緊急聯絡人姓名':'nc-emg-name','緊急聯絡人電話':'nc-emg-phone','緊急聯絡人關係':'nc-emg-relation','案別（A案／B案）':'nc-ab-type','來源':'nc-source','主訴問題分類':'nc-topic','主訴問題分類「其他」說明':'nc-topic-other',[BSRS_UNFILLED_LABEL]:'nc-bsrs-unfilled'};
    missing.forEach(label => {
      const fid = _fmap[label]; if (!fid) return;
      const el = document.getElementById(fid) || document.querySelector(`input[name="${fid}"]`);
      if (el) el.closest('.form-section')?.classList.add('form-section-error');
    });
    // BSRS 未填勾選框：額外醒目標示該勾選列本身（紅框＋閃爍），而不只是整個 BSRS 區塊
    if (missing.includes(BSRS_UNFILLED_LABEL)) {
      document.getElementById('nc-bsrs-unfilled-wrap')?.classList.add('form-section-error');
    }
    const _firstErr = document.querySelector('.form-section-error');
    if (_firstErr) _firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (id.length !== 7) {
    _caseAlert(`案號格式不正確，須為 7 碼（目前輸入 ${id.length} 碼）。`);
    document.getElementById('nc-id').focus();
    return;
  }
  if (parseInt(id.slice(4), 10) === 0) {
    _caseAlert('案號序號不可為 000，須從 001 起。');
    document.getElementById('nc-id').focus();
    return;
  }

  // ── 一學生一案號：既有學生比對＋案號收斂（僅新增路徑；_editingCaseId 編輯路徑維持原樣）──
  let _reopenTarget = null;      // 收斂目標既有個案 record；null = 全新學生
  let _reopenSemKey = null;      // 本次要開的 sem key（base 或 '#N'）
  let _reopenFieldUpdates = {};  // 使用者逐項確認後要寫回 target root 的欄位
  let _reopenFailsafe = null;    // 同學期未結案強制轉移時的轉移資訊

  if (_editingCaseId) {
    // 編輯模式：手動把案號改成撞到別的既有個案時單純擋下，不觸發下方新增流程
    const _editDup = casesData.find(c => c.id === id && c.id !== _editingCaseId);
    if (_editDup) {
      _caseAlert(`案號「${id}」已被個案「${_editDup.name}」使用，請修改案號。`);
      document.getElementById('nc-id').focus();
      return;
    }
  } else {
    // 1. 找既有學生：學號或身分證相符即視為同一學生
    let _existingMatches = casesData.filter(c => !c.deleted && c.id !== _editingCaseId &&
      ((studentId && c.studentId === studentId) || (idNumber && c.idNumber === idNumber)));
    // 學號/身分證皆不同或空，僅姓名相同 → 詢問是否同一學生
    if (!_existingMatches.length && name) {
      const _nameOnlyMatches = casesData.filter(c => !c.deleted && c.id !== _editingCaseId && c.name === name);
      if (_nameOnlyMatches.length &&
          confirm(`找到姓名相同的既有個案「${name}」（案號：${_nameOnlyMatches.map(c => c.id).join('、')}），但學號/身分證字號不同或未填。\n\n是否為同一學生？`)) {
        _existingMatches = _nameOnlyMatches;
      }
    }

    if (!_existingMatches.length) {
      // 2. 全新學生：案號若與任何既有案號相同（不同學生）→ 擋下
      const _idConflict = casesData.find(c => c.id === id && c.id !== _editingCaseId);
      if (_idConflict) {
        _caseAlert('案號已被使用，請用系統建議案號。');
        document.getElementById('nc-id').focus();
        checkCaseIdDuplicate();
        return;
      }
    } else {
      // 3. 有既有學生：收斂到同一案號（取 _caseLatestSem base 最大者）
      const _target = _existingMatches.reduce((best, c) =>
        (!best || _semKeyBase(_caseLatestSem(c)) > _semKeyBase(_caseLatestSem(best))) ? c : best, null);
      const _firstSemKey = _caseSems(_target).slice().sort()[0] || '';
      if (!confirm(
        `此學生已有案號 ${_target.id}（${semesterLabel(_firstSemKey)}首次開案）。\n系統將以同一案號新增本學期開案紀錄，不再產生新案號。是否繼續？`
      )) return;

      // 學號/姓名/身分證與 target root 不同的欄位 → 逐項確認是否更新
      const _rootChecks = [
        { key: 'studentId', label: '學號',       cur: studentId, old: _target.studentId },
        { key: 'name',      label: '姓名',       cur: name,      old: _target.name },
        { key: 'idNumber',  label: '身分證字號', cur: idNumber,  old: _target.idNumber },
      ].filter(f => f.cur && f.old && f.old !== f.cur);
      let _rootChecksOk = true;
      for (const f of _rootChecks) {
        if (!confirm(`${f.label}：「${f.old}」→「${f.cur}」\n是否於本學期起更新此項目？`)) {
          _caseAlert(`「${f.label}」更新未確認，儲存中止。如不需更新請恢復原值。`);
          _rootChecksOk = false;
          break;
        }
        _reopenFieldUpdates[f.key] = f.cur;
      }
      if (!_rootChecksOk) return;

      const _semBase = currentSemesterPrefix();
      _reopenSemKey = _nextSemOpenKey(_target, _semBase);

      if (_reopenSemKey !== _semBase) {
        // 同學期重複開案：檢查是否需要 failsafe（原學期未結案 + 主責轉移）
        const _priorKey = _caseSems(_target).filter(k => _semKeyBase(k) === _semBase).sort().pop();
        const _oldEmail = _target.basicInfoSnapshots?.[_priorKey]?.counselorEmail || _getLatestCounselorEmail(_target);
        const _oldName  = _target.basicInfoSnapshots?.[_priorKey]?.counselorName || _target.counselorName || _oldEmail;
        const _needsFailsafe = _priorKey && _isSemesterUnclosed(_target, _priorKey) &&
          _oldEmail && counselorEmail && _oldEmail !== counselorEmail;
        if (_needsFailsafe) {
          const _newCounselorName = counselorEmail ? (formatCounselorLabel(counselorEmail) || counselorEmail) : '未選擇';
          if (!confirm(
            `「${_oldName}」尚未結案，繼續將於同學期重複開案並使主責轉移至「${_newCounselorName}」，` +
            `「${_oldName}」將自動成為此案個案管理員，並通知中心同仁與督導/主任。是否繼續？`
          )) return;
          _reopenFailsafe = { oldEmail: _oldEmail, oldName: _oldName, newEmail: counselorEmail, newName: _newCounselorName, semKey: _reopenSemKey };
        } else if (!confirm(`此學生本學期已有開案紀錄（${semesterLabel(_priorKey || _semBase)}），確定同學期再次開案？`)) {
          return;
        }
      }
      _reopenTarget = _target;
    }
  }

  // 系所需在列表或已確認建立
  if (!DEPARTMENTS.includes(dept)) {
    showDeptMessage(dept);
    _caseAlert('系所「' + escHtml(dept) + '」不在列表中，請選擇或確認建立。');
    return;
  }

  // 學號前綴未知時攔截，讓使用者定義學制
  if (studentId) {
    const _prefixOk = await _ensureUnknownPrefixes([studentId]);
    if (!_prefixOk) return;
  }

  document.getElementById('btn-save-case').disabled = true;
  showLoading('儲存個案…');

  const counselorName = counselorEmail ? (formatCounselorLabel(counselorEmail) || counselorEmail) : '未選擇';
  const now = new Date().toISOString();

  const newCase = {
    id, openDate, name, studentId, birthday, idNumber,
    legalGender: gender, genderIdentity: genderId,
    caseType, gradLevel, nationality, ethnicity, ethnicityNote,
    foreignCountry: nationality === '外國籍' ? foreignCountry : '',
    program, disability,
    department: dept, college: getCollegeFromDept(dept), grade, classNo,
    phone, email, residence, address,
    emergencyName: emgName, emergencyPhone: emgPhone, emergencyRelation: emgRelation,
    source, pastRecords, topics,
    counselorEmail, counselorName, counselorText: '',
    bsrs, bsrs6, bsrsTotal, bsrsUnfilled,
    abType, bCaseReasons, status, isTransferCase, createdAt: now, updatedAt: now,
  };

  // v185：確定會儲存（驗證皆已通過）——停止草稿備援、清掉草稿 key；若是從草稿待辦繼續編輯，標記該待辦完成
  _stopCaseDraftAutosave();
  try { localStorage.removeItem(_caseDraftKey()); } catch(_) {}
  if (_caseDraftTodoId) {
    const _cdt = todosData.find(t => t.id === _caseDraftTodoId);
    if (_cdt) { _cdt.done = true; _cdt.doneAt = now; }
    _caseDraftTodoId = null;
    saveUserTodos().catch(() => {});
  }
  // 儲存前記憶體快照：此表單失敗時不會離開頁面（欄位仍在），故不需重開頁面（reopenFn 給 null）
  _armSaveFailSnapshot('個案基本資料', 'page-new-case', null, saveCase);
  try {
    if (_editingCaseId) {
      const idx = casesData.findIndex(x => x.id === _editingCaseId);
      const prev = casesData[idx];
      const oldCounselorEmail = prev.counselorEmail;
      const _oldAbTypeForHistory = _caseLatestAbType(prev); // C：A/B 案設定時間戳記——編輯前的有效案別
      // Save per-semester snapshot when editing
      const _editSem = _caseDetailActiveSem || openDateToSemPrefix(openDate);
      const _prevSnaps = prev.basicInfoSnapshots || {};
      const _editSnap = {};
      BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (newCase[f] !== undefined) _editSnap[f] = newCase[f]; });
      const _alertUpdate = (counselorEmail && counselorEmail !== oldCounselorEmail)
        ? { newCounselorAlert: { date: new Date().toISOString().slice(0,10), toEmail: counselorEmail } }
        : {};
      casesData[idx] = { ...prev, ...newCase, ..._alertUpdate,
        // v181：透過完整表單（本頁必填欄位皆已驗證通過）編輯儲存，視為已補齊快速開案時留下的缺項
        profileIncomplete: false,
        basicInfoSnapshots: _editSem ? { ..._prevSnaps, [_editSem]: _editSnap } : _prevSnaps };
      // C：A/B 案設定時間戳記——newCase 不含 abTypeHistory 鍵，故上面 spread 已自動保留 prev.abTypeHistory；
      // 案別實際變更時才另外 push 一筆 change 紀錄（沿用 prev 的既有歷史陣列，不覆蓋/清空）。
      if (abType !== _oldAbTypeForHistory) {
        casesData[idx].abTypeHistory = [...(prev.abTypeHistory || []), {
          kind: 'change', from: _oldAbTypeForHistory, to: abType, at: now,
          by: currentUser.email, byName: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
          sem: _editSem,
        }];
      }
      // syncManagersFromForm 必須在案號改名前跑：它用「舊案號」判斷現有管理員名單（wasManager），
      // 若先改名，allowedCases 已被 remap 成新案號，會讓既有管理員全部誤判為「非既有管理員」，
      // 使用者在此表單取消勾選的管理員將不會被正確移除。
      let cfgChanged = syncManagersFromForm(newCase.id, _editingCaseId);
      if (newCase.id !== _editingCaseId) {
        // 案號有改變（inline 改號）：走共用安全改名 helper（remap allowedCases/allowedCasesSems/
        // transferData、正確清除舊 chunk 殘留），取代原本把新舊案號當成兩個獨立個案存的作法——
        // 舊作法在新舊案號分屬不同資料分塊（跨學年改號）時，舊分塊的舊紀錄不會被清除，
        // 舊紀錄會在下次載入時復活（同類 bug 見 Slice 2 changelog／個案架構重構待辦）。
        // 呼叫前 casesData[idx].id 已是新號，符合 _renameCaseId 支援的第二種呼叫時機；
        // _renameCaseId 內部已含 configCasesPatch（caseIdRemap），此處不會重複寫 config。
        await _renameCaseId(_editingCaseId, newCase.id);
      } else {
        await saveCasesChunks(_editingCaseId, newCase.id);
      }
      if (counselorEmail && counselorEmail !== currentUser.email && counselorEmail !== oldCounselorEmail)
        addNotificationToUser(counselorEmail, 'assigned_counselor', newCase.id, name);
      // cfgChanged 僅可能在管理者（nc-managers-section 僅管理者可見）操作時為 true，
      // 管理者整檔寫入不受 v164 非管理者 deny 影響，維持原路徑。
      if (cfgChanged) await driveUpdateJsonFile(CONFIG_FILE, configData);
      await _flushNotifOps();
      renderNotifBell();
      auditLog('編輯個案', newCase.id, null, semesterLabel(_editSem) + '學期基本資料');
      document.getElementById('btn-save-case').disabled = false;
      hideLoading();
      renderCases();
      showCaseDetail(newCase.id);
      _clearSaveFailSnapshot();
    } else if (_reopenTarget) {
      // ── 再次開案：一學生一案號，同案號新增本學期開案紀錄（回應 2026-07-06 個案架構重構 Slice 1）──
      const target = _reopenTarget;
      const semKey = _reopenSemKey;
      const _oldAbTypeForHistory = _caseLatestAbType(target); // C：A/B 案設定時間戳記——本次新學期快照寫入前的有效案別
      Object.entries(_reopenFieldUpdates).forEach(([k, v]) => { target[k] = v; });
      if (!Array.isArray(target.semesters)) target.semesters = _caseSems(target);
      if (!target.semesters.includes(semKey)) target.semesters.push(semKey);
      target.semesters.sort();
      if (!target.basicInfoSnapshots) target.basicInfoSnapshots = {};
      const _snap = {};
      BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (newCase[f] !== undefined) _snap[f] = newCase[f]; });
      target.basicInfoSnapshots[semKey] = _snap;
      if (!target.semesterStatus) target.semesterStatus = {};
      target.semesterStatus[semKey] = 'active';
      // 同學期再次開案對稱重編（#35）：一有分身，同 base 學期的既有 key 也要同步補上序號
      // （如 '1142' → '1142#1'），並同步更新 basicInfoSnapshots／semesterStatus／
      // initialInterviews／semesterEvaluations 等所有以 sem key 為鍵的引用處
      {
        const _semBase35 = _semKeyBase(semKey);
        _applySemKeyRenumber(target, _renumberSemKeys(_semBase35, target.semesters.filter(k => _semKeyBase(k) === _semBase35)));
      }
      // root 個資欄位更新為表單現值（識別欄位學號/姓名/身分證僅在使用者確認後才更新，見 _reopenFieldUpdates）
      ['birthday','legalGender','genderIdentity','caseType','gradLevel','nationality','ethnicity','ethnicityNote','foreignCountry',
       'program','disability','department','college','grade','classNo','phone','email','residence','address',
       'emergencyName','emergencyPhone','emergencyRelation','source','pastRecords','topics',
       'abType','bCaseReasons','isTransferCase'].forEach(f => { if (newCase[f] !== undefined) target[f] = newCase[f]; });
      // C：A/B 案設定時間戳記——案別實際變更時 push 一筆 change 紀錄（sem 用本次新開的學期 key）
      if (abType !== _oldAbTypeForHistory) {
        target.abTypeHistory = [...(target.abTypeHistory || []), {
          kind: 'change', from: _oldAbTypeForHistory, to: abType, at: now,
          by: currentUser.email, byName: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
          sem: semKey,
        }];
      }
      target.openDate = target.openDate || openDate; // 保留最早開案日期，不覆寫
      target.bsrs = bsrs; target.bsrs6 = bsrs6; target.bsrsTotal = bsrsTotal; target.bsrsUnfilled = bsrsUnfilled;
      const oldCounselorEmail = _getLatestCounselorEmail(target);
      // 未選主責時不覆寫既有主責（否則空值會蓋掉原主責的全案層級與最新學期快照）；
      // 僅定格既有快照，新學期快照留空 → 顯示 fallback 到全案層級（原主責不變）
      if (counselorEmail) _applyCounselorChange(target, semKey, counselorEmail, counselorName);
      else _stampSemCounselorSnapshots(target);
      target.status = _recomputeCaseStatus(target);
      target.updatedAt = now;
      // psychTestDB 自動帶入沿用
      if (studentId && Array.isArray(psychTestDB[studentId]) && psychTestDB[studentId].length) {
        const existing = target.psychTestResults || [];
        const existSems = new Set(existing.map(t => t.testSemester));
        const toAdd = psychTestDB[studentId].filter(t => !existSems.has(t.testSemester));
        if (toAdd.length) target.psychTestResults = [...existing, ...toAdd];
      }
      // 個案管理員繼承：若管理員有學期限制，自動將新學期加入可閱覽範圍（同 addCaseSemester）
      const _reopenCfgOps = [];
      Object.entries(configData?.users || {}).forEach(([email, info]) => {
        if (!(info.allowedCases || []).includes(target.id)) return;
        const sems = info.allowedCasesSems?.[target.id];
        if (sems && !sems.includes(semKey)) {
          sems.push(semKey);
          _reopenCfgOps.push({ type: 'caseAccessSemsSet', email, caseId: target.id, sems: [...sems] });
        }
      });
      if (_reopenFailsafe) {
        // 同學期強制再開案 failsafe：保護原主責甲成為個管員 + 通知中心同仁與督導/主任
        const fs = _reopenFailsafe;
        const mgrInfo = configData?.users?.[fs.oldEmail];
        if (mgrInfo) {
          if (!mgrInfo.allowedCases) mgrInfo.allowedCases = [];
          if (!mgrInfo.allowedCases.includes(target.id)) mgrInfo.allowedCases.push(target.id);
          if (!mgrInfo.extraRole) mgrInfo.extraRole = '個案管理員'; // 對齊 caseAccessUpsert 後端語義與確認訊息的承諾
          _reopenCfgOps.push({ type: 'caseAccessUpsert', email: fs.oldEmail, caseId: target.id });
          if (mgrInfo.allowedCasesSems?.[target.id] && !mgrInfo.allowedCasesSems[target.id].includes(fs.semKey)) {
            mgrInfo.allowedCasesSems[target.id].push(fs.semKey);
            _reopenCfgOps.push({ type: 'caseAccessSemsSet', email: fs.oldEmail, caseId: target.id, sems: [...mgrInfo.allowedCasesSems[target.id]] });
          }
        }
        const _msg = `${fs.newName} 在 ${fs.oldName} 尚未結案的情況下，對個案 ${target.id}（${target.name}）執行本學期再次開案，主責已轉移，請確認是否符合規定。`;
        const _recipients = new Set();
        Object.entries(configData?.users || {}).forEach(([email, info]) => {
          if (!info || info.disabled) return;
          const eligible = ML_FULL_TIME_ROLES.includes(info.role) || info.role === '主任' ||
            info.extraRole === '管理者' || info.extraRole === '實習生行政督導' || info.extraRole === '實習生專業督導' ||
            info.isAdmin === true;
          if (eligible) _recipients.add(email);
        });
        if (fs.oldEmail) _recipients.add(fs.oldEmail);
        if (fs.newEmail) _recipients.add(fs.newEmail);
        _recipients.forEach(email => addNotificationToUser(email, 'same_sem_reopen', target.id, target.name, _msg));
      } else if (counselorEmail && counselorEmail !== currentUser.email && counselorEmail !== oldCounselorEmail) {
        addNotificationToUser(counselorEmail, 'assigned_counselor', target.id, target.name);
      }
      await saveCasesChunks(target.id);
      await Promise.all([_reopenCfgOps.length ? _configCasesPatch(_reopenCfgOps) : Promise.resolve(), _flushNotifOps()]);
      renderNotifBell();
      if (window._transferPendingLink) {
        const _tIdx = transferData.findIndex(t => t.id === window._transferPendingLink);
        if (_tIdx >= 0) {
          transferData[_tIdx].caseId = target.id;
          await saveTransfer();
        }
        window._transferPendingLink = null;
      }
      auditLog('再次開案', target.id, null, semesterLabel(semKey) + '學期');
      if (_reopenFailsafe) {
        const fs = _reopenFailsafe;
        auditLog('同學期強制再開案', target.id, null, `原主責：${fs.oldEmail}→新主責：${fs.newEmail}；${semesterLabel(semKey)}`);
      }
      document.getElementById('btn-save-case').disabled = false;
      hideLoading();
      renderCases();
      showToast(`已以案號 ${target.id} 新增 ${semesterLabel(semKey)} 學期開案紀錄`, 'success');
      showCaseDetailAtSem(target.id, semKey);
      _clearSaveFailSnapshot();
    } else {
      // Auto-attach psych test results from psychTestDB
      if (studentId && Array.isArray(psychTestDB[studentId]) && psychTestDB[studentId].length) {
        const existing = newCase.psychTestResults || [];
        const existSems = new Set(existing.map(t => t.testSemester));
        const toAdd = psychTestDB[studentId].filter(t => !existSems.has(t.testSemester));
        if (toAdd.length) {
          newCase.psychTestResults = [...existing, ...toAdd];
          showToast(`已自動帶入 ${toAdd.length} 筆心理測驗資料`, 'info');
        }
      }
      // C：A/B 案設定時間戳記——新案建立時記錄開案設定
      newCase.abTypeHistory = [{
        kind: 'open', to: abType, at: now,
        by: currentUser.email, byName: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
      }];
      casesData.push(newCase);
      _assignChunkForNewCase(newCase.id); // Slice 3：已重新分塊時分配 active chunk，否則不動作（legacy fallback）
      await saveCasesChunks(newCase.id);
      let cfgChanged = syncManagersFromForm(newCase.id, null);
      if (counselorEmail && counselorEmail !== currentUser.email)
        addNotificationToUser(counselorEmail, 'assigned_counselor', newCase.id, name);
      if (cfgChanged) await driveUpdateJsonFile(CONFIG_FILE, configData);
      await _flushNotifOps();
      renderNotifBell();
      // 若從轉銜管理「建立個案」進入，自動連結轉銜紀錄
      if (window._transferPendingLink) {
        const _tIdx = transferData.findIndex(t => t.id === window._transferPendingLink);
        if (_tIdx >= 0) {
          transferData[_tIdx].caseId = newCase.id;
          await saveTransfer();
        }
        window._transferPendingLink = null;
      }
      auditLog('新增個案', newCase.id);
      hideLoading();
      showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
      renderCases();
      setAlert('cases-alert', 'info', `個案「${escHtml(name)}」（${escHtml(id)}）已建立。`);
      _clearSaveFailSnapshot();
    }
  } catch (err) {
    if (_reopenTarget) {
      const target = _reopenTarget;
      if (target.semesters) target.semesters = target.semesters.filter(s => s !== _reopenSemKey);
      if (target.basicInfoSnapshots) delete target.basicInfoSnapshots[_reopenSemKey];
      if (target.semesterStatus) delete target.semesterStatus[_reopenSemKey];
    } else if (!_editingCaseId) {
      casesData.pop();
    }
    hideLoading();
    document.getElementById('btn-save-case').disabled = false;
    _caseAlert('儲存失敗：' + err.message);
    _showSaveFailModal(err.message);
  }
}

function searchRefillCases() {
  const q = (document.getElementById('nc-refill-q').value || '').trim().toLowerCase();
  const wrap = document.getElementById('nc-refill-results');
  if (q.length < 2) { wrap.innerHTML = ''; return; }
  const matches = casesData.filter(c => !c.deleted && (
    (c.name      || '').toLowerCase().includes(q) ||
    (c.studentId || '').toLowerCase().includes(q) ||
    (c.idNumber  || '').toLowerCase().includes(q)
  )).slice(0, 8);
  if (!matches.length) {
    wrap.innerHTML = '<div style="color:#718096;font-size:.875rem;">找不到符合的歷史個案</div>';
    return;
  }
  wrap.innerHTML = matches.map(c => `
    <div onclick="fillFromCase('${escHtml(c.id)}')"
      style="padding:8px 12px;border:1px solid #bee3f8;border-radius:6px;margin-bottom:4px;cursor:pointer;background:#fff;
             display:flex;gap:16px;align-items:center;font-size:.875rem;"
      onmouseover="this.style.background='#ebf8ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;color:#1a5276;min-width:80px;">${escHtml(c.name || '—')}</span>
      <span style="color:#718096;">${escHtml(c.studentId || '—')}</span>
      <span style="color:#718096;">${escHtml(c.id || '—')}</span>
      <span style="color:#a0aec0;font-size:.8rem;">${escHtml(c.openDate || '—')}</span>
    </div>`).join('');
}

function fillFromCase(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  document.getElementById('nc-name').value       = c.name || '';
  document.getElementById('nc-student-id').value = c.studentId || '';
  document.getElementById('nc-id-number').value  = c.idNumber || '';
  if (c.birthday) {
    const [y, m, d] = c.birthday.split('-');
    document.getElementById('nc-birth-year').value  = y || '';
    document.getElementById('nc-birth-month').value = m || '';
    document.getElementById('nc-birth-day').value   = d || '';
  }
  const setR = (name, val) => {
    if (!val) return;
    const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  };
  setR('nc-gender',    c.legalGender);
  setR('nc-gender-id', c.genderIdentity);
  setR('nc-ab-type',   c.abType);
  _ncBReasonsSelected = new Set(Array.isArray(c.bCaseReasons) ? c.bCaseReasons : []);
  _ncOnAbTypeChange();
  setR('nc-type',      c.caseType);
  setR('nc-grad-level', c.gradLevel);
  _ncToggleGradLevel();
  setR('nc-residence', c.residence);
  setR('nc-nationality', c.nationality || '');
  toggleEthnicity();
  document.getElementById('nc-foreign-country').value = c.foreignCountry || '';
  if (c.ethnicity) {
    setR('nc-ethnicity', c.ethnicity);
    toggleEthnicityNote({ value: c.ethnicity });
    const noteId = ETH_NOTE_IDS[c.ethnicity];
    if (noteId && c.ethnicityNote) document.getElementById(noteId).value = c.ethnicityNote;
  }
  document.getElementById('nc-program').value       = c.program || '';
  document.getElementById('nc-disability').value    = c.disability || '';
  document.getElementById('nc-dept').value          = c.department || '';
  _updateNcCollege();
  document.getElementById('nc-grade').value         = c.grade || '';
  document.getElementById('nc-class').value         = c.classNo || '';
  document.getElementById('nc-phone').value         = c.phone || '';
  document.getElementById('nc-email').value         = c.email || '';
  document.getElementById('nc-address').value       = c.address || '';
  document.getElementById('nc-emg-name').value      = c.emergencyName || '';
  document.getElementById('nc-emg-phone').value     = c.emergencyPhone || '';
  document.getElementById('nc-emg-relation').value  = c.emergencyRelation || '';
  document.getElementById('nc-past-psych').checked   = (c.pastRecords||[]).includes('精神科就診');
  document.getElementById('nc-past-med').checked     = (c.pastRecords||[]).includes('服用精神藥物');
  document.getElementById('nc-past-counsel').checked = (c.pastRecords||[]).includes('心理諮商');
  // 一學生一案號：帶入既有案號本身（不再產生新案號），儲存時將自動以此案號新增本學期開案
  const _ncIdFill = document.getElementById('nc-id');
  _ncIdFill.value = c.id;
  _ncIdFill.classList.remove('_nc-id-flash');
  void _ncIdFill.offsetWidth;
  _ncIdFill.classList.add('_nc-id-flash');
  renderCaseIdSuggestions();
  checkCaseIdDuplicate();
  checkCurrentSemesterDuplicate();
  const _dupWarn = document.getElementById('nc-semester-dup-warn');
  if (_dupWarn && _dupWarn.style.display !== 'none') _dupWarn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('nc-refill-q').value = '';
  document.getElementById('nc-refill-results').innerHTML =
    `<div style="color:#276749;background:#f0fff4;border:1px solid #9ae6b4;padding:8px 12px;border-radius:6px;font-size:.875rem;">
      ✓ 已帶入「${escHtml(c.name || '—')}」的歷史資料，案號沿用既有案號「${escHtml(c.id)}」，儲存時將自動新增本學期開案紀錄，開案日期與主責人員請確認填寫
    </div>`;
}

function clearRefill() {
  document.getElementById('nc-refill-q').value = '';
  document.getElementById('nc-refill-results').innerHTML = '';
}

function renderNcManagersCheckboxes(selectedManagers) {
  const body = document.getElementById('nc-managers-body');
  if (!body || !configData || !configData.users) return;
  const counselorEmail = document.getElementById('nc-counselor').value;
  if (selectedManagers === undefined) {
    selectedManagers = [...document.querySelectorAll('input[name="nc-manager"]:checked')].map(el => el.value);
  }
  const users = Object.entries(configData.users)
    .filter(([email, info]) =>
      !info.disabled && info.role && info.role !== '系統管理者' && email !== counselorEmail
    )
    .sort(([, ia], [, ib]) => {
      const oa = COUNSELOR_ROLE_ORDER[ia.role] ?? 99;
      const ob = COUNSELOR_ROLE_ORDER[ib.role] ?? 99;
      return oa !== ob ? oa - ob : (ia.name || '').localeCompare(ib.name || '', 'zh');
    });
  if (!users.length) {
    body.innerHTML = '<span style="color:#718096;font-size:.85rem;">無可指派人員</span>';
    return;
  }
  body.innerHTML = users.map(([email, info]) =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 16px 4px 0;font-size:.875rem;cursor:pointer;">
      <input type="checkbox" name="nc-manager" value="${escHtml(email)}" ${selectedManagers.includes(email) ? 'checked' : ''}>
      ${escHtml(formatCounselorLabel(email))}
    </label>`
  ).join('');
}

function syncManagersFromForm(newCaseId, oldCaseId) {
  const section = document.getElementById('nc-managers-section');
  if (!section || section.style.display === 'none') return false;
  const selectedEmails = new Set([...document.querySelectorAll('input[name="nc-manager"]:checked')].map(el => el.value));
  const lookupId = oldCaseId || newCaseId;
  const caseName = casesData.find(c => c.id === newCaseId)?.name || newCaseId;
  let changed = false;
  Object.entries(configData.users || {}).forEach(([email, info]) => {
    const wasManager = (info.allowedCases || []).includes(lookupId);
    const willBeManager = selectedEmails.has(email);
    if (wasManager && !willBeManager) {
      info.allowedCases = (info.allowedCases || []).filter(id => id !== lookupId && id !== newCaseId);
      if (!info.allowedCases.length) { delete info.allowedCases; delete info.extraRole; }
      addNotificationToUser(email, 'removed_manager', newCaseId, caseName);
      changed = true;
    } else if (!wasManager && willBeManager) {
      info.allowedCases = info.allowedCases || [];
      if (!info.allowedCases.includes(newCaseId)) {
        info.allowedCases.push(newCaseId);
        if (!info.extraRole) info.extraRole = '個案管理員';
        addNotificationToUser(email, 'assigned_manager', newCaseId, caseName);
        changed = true;
      }
    }
  });
  return changed;
}

