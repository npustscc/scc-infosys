// dev/grad-eval.js — 畢業/離校生評估模組（拆 index.html 絞殺者第九刀，v255）。
// 內容為從 index.html 逐字搬出的函式：畢業轉銜篩選（_gradFilterSearchDebounce／_gradFilterChange／
// _gradFilterClear）、校級轉銜決議設定（setGradTransferDecision／_saveGradTransferDecision／
// _showGradReasonPanel／setGradTransferMeetingDate）、畢業名單勾選批次（_gradCbChange／
// _gradToggleAll／_gradToggleHistory／_applyGradBatch）、校級評估結果匯入（parseTaiwanDate／
// _importMatchCase／handleImportGradTransferExcel／handleImportHistoryTransferCSV／
// showGradTransferImportPreview）、未歸屬轉銜紀錄管理（_renderUnassignedTab／
// _deleteUnassignedRecord／_linkUnassignedRecord／_confirmLinkRecord）、範本下載
// （downloadGradTransferExcelTemplate）、轉銜總頁與離校生評估頁籤（renderTransferPage／
// _renderWithdrawTab）、離校生名單維護（_openWithdrawManualAdd／_confirmWithdrawManualAdd／
// _deleteWithdrawRecord／_clearWithdrawList）、離校生決議設定（setWithdrawDecision／
// setWithdrawMeetingDate）、離校生勾選批次（_withdrawRefreshInPlace／_withdrawToggleAll／
// _withdrawCbChange／_applyWithdrawBatch）。
// 頂層無任何執行副作用（只有 function/async function 宣告，無頂層 let/const；區塊本身相關的兩組
// debounce 計時器 _gradFilterSearchTimer／_gradSearchComposing 與 _withdrawFilterSearchTimer／
// _wdSearchComposing 皆宣告在切點外側、留在 index.html，經確認全專案僅各一處宣告、本檔未重複宣告；
// 本檔函式在呼叫時才會引用它們，屬 call-time 解析，載入順序沒有問題）。函式內部在呼叫時會引用主檔
// 全域可變狀態（casesData／configData／currentUser／transferData／todosData 等，定義仍留在
// index.html），以及主檔與其他拆檔模組內的共用函式（escHtml／setAlert／showLoading／hideLoading／
// auditLog／showToast／bgJobAdd 系列／saveCasesChunks／saveTransfer／_getGradTransferDecision／
// _getLinkedCaseForWithdraw／_getWdDecision／_computeGradStatus／_hasCaseTransferEval／
// _buildCaseSemMap／_buildHistBadgesHtml／_buildSourceChip／_counselorStatusBadge／
// buildCounselorFilterOpts／_buildGradFilterCounselorOpts／_renderGradTransferTab／generateCaseId／
// currentSemesterPrefix／semesterLabel／_ckgRangeIndices／_xlsxReadUnlocked／_ensureUnknownPrefixes／
// downloadTransferImportTemplate／openTransferAssessmentModal／handleImportTransferExcel／
// COUNSELOR_ROLE_ORDER／BK_COUNSELING_ROLES 等），屬 call-time 解析，與其他拆檔模組
// （utils.js／ft-core.js／case-detail.js／case-import.js／initial-interview.js／psych-import.js）
// 使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="grad-eval.js"></script> 載入（放在
// psych-import.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

function _gradFilterSearchDebounce() {
  clearTimeout(_gradFilterSearchTimer);
  _gradFilterSearchTimer = setTimeout(_gradFilterChange, 220);
}

function _gradFilterChange() {
  if (!window._gradTransferFilters) window._gradTransferFilters = {};
  const F = window._gradTransferFilters;
  const g = id => document.getElementById(id);
  if (g('grad-filter-semester'))    F.semester    = g('grad-filter-semester').value;
  if (g('grad-filter-counselor'))   F.counselor   = g('grad-filter-counselor').value;
  if (g('grad-filter-decision'))    F.decision    = g('grad-filter-decision').value;
  if (g('grad-filter-filled'))      F.filled      = g('grad-filter-filled').value;
  if (g('grad-filter-gradstatus'))  F.gradStatus  = g('grad-filter-gradstatus').value;
  if (g('grad-filter-showresolved')) F.showResolved = g('grad-filter-showresolved').checked;
  if (g('grad-filter-search'))      F.search      = g('grad-filter-search').value;
  if (F.decision === 'resolved') { F.showResolved = true; const cb = g('grad-filter-showresolved'); if (cb) cb.checked = true; }
  try { localStorage.setItem('scc_gtf_' + DRIVE_FOLDER_ID, JSON.stringify(F)); } catch(_) {}
  const _gr = document.getElementById('grad-results-body');
  if (_gr) {
    const _t = document.createElement('div');
    _t.innerHTML = _renderGradTransferTab();
    const _rb = _t.querySelector('#grad-results-body');
    _gr.innerHTML = _rb ? _rb.innerHTML : _t.innerHTML;
  } else {
    document.getElementById('transfer-body').innerHTML = _renderGradTransferTab();
  }
}

function _gradFilterClear() {
  window._gradTransferFilters = { counselor: currentUser?.email || '', decision: 'pending', filled: 'all', gradStatus: 'all', showResolved: false, semester: 'all', search: '' };
  try { localStorage.removeItem('scc_gtf_' + DRIVE_FOLDER_ID); } catch(_) {}
  document.getElementById('transfer-body').innerHTML = _renderGradTransferTab();
}

function setGradTransferDecision(caseId, sem, status) {
  if (!status) return;
  if (status === 'noTransfer_self_reason') {
    const sel = document.getElementById('gd-sel-' + caseId);
    const curReason = _getGradTransferDecision(caseId, sem)?.noTransferReason || '';
    _showGradReasonPanel(sel, curReason, reason => {
      if (reason === null) { if (sel) sel.value = _getGradTransferDecision(caseId, sem)?.status || ''; return; }
      _saveGradTransferDecision(caseId, sem, status, reason);
    });
    return;
  }
  _saveGradTransferDecision(caseId, sem, status, null);
}

function _saveGradTransferDecision(caseId, sem, status, noTransferReason) {
  const now = new Date().toISOString();
  const ex = _getGradTransferDecision(caseId, sem);
  if (ex) { ex.status = status; if (noTransferReason !== null) ex.noTransferReason = noTransferReason; ex.updatedAt = now; ex.updatedBy = currentUser?.email; }
  else { transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, type:'graduation', caseId, semester:sem, status, noTransferReason, createdAt:now, createdBy:currentUser?.email }); }
  const dateInp = document.getElementById('gd-date-' + caseId);
  if (dateInp && !dateInp.value) { const today = new Date().toISOString().slice(0, 10); dateInp.value = today; setGradTransferMeetingDate(caseId, sem, today); }
  _checkTransferGradTodos();
  if (window._transferTab === 'graduation') { document.getElementById('transfer-body').innerHTML = _renderGradTransferTab(); }
  const jobId = bgJobAdd('儲存校級轉銜決議');
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('設定校級轉銜決議', caseId, null, status); } catch (e) { bgJobFail(jobId, e.message); } })();
}

function _showGradReasonPanel(anchorEl, currentReason, cb) {
  const old = document.getElementById('grad-reason-panel'); if (old) old.remove();
  const rect = anchorEl ? anchorEl.getBoundingClientRect() : {left:200, bottom:300};
  const PW = 280;
  const px = Math.min(Math.max(rect.left, 8), window.innerWidth - PW - 8);
  const py = Math.min(rect.bottom + 8, window.innerHeight - 180);
  const p = document.createElement('div');
  p.id = 'grad-reason-panel';
  p.style.cssText = `position:fixed;left:${px}px;top:${py}px;background:#fff;border:1.5px solid #d97706;border-radius:10px;padding:14px 16px;z-index:100002;box-shadow:0 6px 24px rgba(0,0,0,0.18);min-width:${PW}px;`;
  const safeReason = (currentReason||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  p.innerHTML = '<div style="font-size:.83rem;font-weight:700;color:#92400e;margin-bottom:10px;">✏️ 主責評估不轉銜原因</div>'
    + `<input id="grad-reason-inp" type="text" placeholder="請填寫不轉銜原因…" maxlength="100" value="${safeReason}" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e0;border-radius:6px;padding:6px 10px;font-size:.88rem;outline:none;margin-bottom:10px;transition:border .2s;" onfocus="this.style.borderColor='#d97706'" onblur="this.style.borderColor='#cbd5e0'">`
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button id="grad-reason-cancel" style="font-size:.82rem;padding:5px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;color:#4a5568;">取消</button>'
    + '<button id="grad-reason-ok" style="font-size:.82rem;padding:5px 14px;border:none;border-radius:6px;background:#d97706;color:#fff;cursor:pointer;font-weight:700;">確認</button>'
    + '</div>';
  document.body.appendChild(p);
  const inp = document.getElementById('grad-reason-inp');
  inp.focus(); inp.select();
  const confirm = () => { const v = inp.value.trim(); if (!v) { inp.style.borderColor='#e53e3e'; return; } p.remove(); cb(v); };
  const cancel = () => { p.remove(); cb(null); };
  document.getElementById('grad-reason-cancel').onclick = cancel;
  document.getElementById('grad-reason-ok').onclick = confirm;
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') confirm(); if (ev.key === 'Escape') cancel(); ev.stopPropagation(); });
}

function setGradTransferMeetingDate(caseId, sem, date) {
  const now = new Date().toISOString();
  const ex = _getGradTransferDecision(caseId, sem);
  if (!ex) return;
  ex.schoolMeetingDate = date; ex.updatedAt = now; ex.updatedBy = currentUser?.email;
  const jobId = bgJobAdd('儲存校級評估會議日期');
  (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function _gradCbChange() {
  const cbs = document.querySelectorAll('.grad-cb');
  const checked = document.querySelectorAll('.grad-cb:checked').length;
  const allCb = document.getElementById('grad-select-all');
  if (allCb) { allCb.checked = checked === cbs.length && cbs.length > 0; allCb.indeterminate = checked > 0 && checked < cbs.length; }
  const info = document.getElementById('grad-batch-info');
  if (info) info.textContent = checked > 0 ? `已選 ${checked} 位` : '';
}

function _gradToggleAll(checked) {
  document.querySelectorAll('.grad-cb').forEach(cb => { cb.checked = checked; });
  _gradCbChange();
}

function _gradToggleHistory(caseId) {
  if (!window._gradCardExpanded) window._gradCardExpanded = new Set();
  const isExp = window._gradCardExpanded.has(caseId);
  if (isExp) window._gradCardExpanded.delete(caseId); else window._gradCardExpanded.add(caseId);
  const nowExp = !isExp;
  const extraEl = document.querySelector(`[data-hist-extra="${CSS.escape(caseId)}"]`);
  const moreEl  = document.querySelector(`[data-hist-more="${CSS.escape(caseId)}"]`);
  const chevEl  = document.querySelector(`[data-hist-chev="${CSS.escape(caseId)}"]`);
  if (extraEl) extraEl.style.display = nowExp ? 'contents' : 'none';
  if (moreEl)  moreEl.style.display  = nowExp ? 'none' : 'inline-block';
  if (chevEl)  chevEl.textContent     = nowExp ? '▲' : '▼';
}

function _applyGradBatch(sem) {
  const status = document.getElementById('grad-batch-status')?.value;
  const date   = document.getElementById('grad-batch-date')?.value;
  if (!status && !date) { alert('請選擇決議或填入校級評估會議日期'); return; }
  const checkedCids = [...document.querySelectorAll('.grad-cb:checked')].map(cb => cb.dataset.cid);
  if (!checkedCids.length) { alert('請先勾選要套用的學生'); return; }
  const now = new Date().toISOString();
  checkedCids.forEach(cid => {
    const ex = _getGradTransferDecision(cid, sem);
    if (ex) {
      if (status) ex.status = status;
      if (date) ex.schoolMeetingDate = date;
      ex.updatedAt = now; ex.updatedBy = currentUser?.email;
    } else if (status) {
      transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        type:'graduation', caseId:cid, semester:sem, status,
        schoolMeetingDate: date||'', createdAt:now, createdBy:currentUser?.email });
    }
  });
  _checkTransferGradTodos();
  document.getElementById('transfer-body').innerHTML = _renderGradTransferTab();
  const jobId = bgJobAdd(`批次套用轉銜決議（${checkedCids.length}筆）`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('批次設定校級轉銜決議', null, null, `${checkedCids.length}筆`); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function parseTaiwanDate(str) {
  if (!str) return '';
  const s = str.trim();
  if (!s) return '';
  if (s.includes('-') || s.includes('/')) {
    // 已含分隔符號（可能是西元年或民國年帶斜線），直接保留
    return s;
  }
  const match = s.replace(/\D/g, '').match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (match) return `${parseInt(match[1], 10) + 1911}-${match[2]}-${match[3]}`;
  return s; // 無法識別則原樣保留
}

// ── 共用：姓名/學號雙向比對個案（供各匯入 Modal 共用） ──
function _importMatchCase(name, sid) {
  let mc = null, matchType = 'none';
  if (sid && name) {
    mc = casesData.find(c => !c.deleted && c.studentId === sid && c.name === name);
    if (mc) matchType = 'full';
    else {
      const bySid = casesData.find(c => !c.deleted && c.studentId === sid);
      const byNm  = casesData.find(c => !c.deleted && c.name === name);
      if (bySid) { mc = bySid; matchType = 'sid_only'; }
      else if (byNm) { mc = byNm; matchType = 'name_only'; }
    }
  } else if (sid) {
    mc = casesData.find(c => !c.deleted && c.studentId === sid);
    matchType = mc ? 'sid_only' : 'none';
  } else if (name) {
    mc = casesData.find(c => !c.deleted && c.name === name);
    matchType = mc ? 'name_only' : 'none';
  }
  return { mc, matchType };
}

async function handleImportGradTransferExcel(input) {
  if (!input.files?.length) return;
  const file = input.files[0]; input.value = '';
  const curSem = currentSemesterPrefix();
  document.getElementById('transfer-body').innerHTML = '<div style="padding:20px;color:#718096;">解析中…</div>';
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array', cellDates: true }, { fileName: file.name });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
    const rows = raw.map(r => Array.isArray(r) ? r.map(c => (c == null ? '' : String(c).trim())) : []);
    if (rows.length < 2) { alert('找不到資料列'); renderTransferPage(); return; }
    const _sidList = rows.slice(1).map(r => r[1] || '').filter(Boolean);
    const _prefixOk = await _ensureUnknownPrefixes(_sidList);
    if (!_prefixOk) { renderTransferPage(); return; }
    await showGradTransferImportPreview(rows, curSem);
  } catch (e) {
    if (e.xlsxCancelled) { alert(e.message); renderTransferPage(); return; }
    alert('解析失敗：' + e.message); renderTransferPage();
  }
}

async function handleImportHistoryTransferCSV(input) {
  if (!input.files?.length) return;
  const file = input.files[0]; input.value = '';
  document.getElementById('transfer-body').innerHTML = '<div style="padding:20px;color:#718096;">解析中…</div>';
  try {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map(r => r.split(',').map(c => c.replace(/^"|"$/g,'').trim()));
    const headers = rows[0].map(h => h.trim());
    const nameIdx = headers.findIndex(h => /姓名/.test(h));
    const sidIdx = headers.findIndex(h => /學號/.test(h));
    if (nameIdx < 0 && sidIdx < 0) { alert('找不到「姓名」或「學號」欄位'); renderTransferPage(); return; }
    const curSem = currentSemesterPrefix();
    const now = new Date().toISOString();
    let count = 0;
    rows.slice(1).filter(r => r.some(v => v)).forEach(r => {
      const name = nameIdx >= 0 ? (r[nameIdx]||'') : '';
      const sid  = sidIdx  >= 0 ? (r[sidIdx] ||'') : '';
      const mc = casesData.find(x => !x.deleted && ((sid && x.studentId===sid)||(name && x.name===name)));
      if (!mc || _getGradTransferDecision(mc.id, curSem)) return;
      transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        type:'graduation', caseId:mc.id, semester:curSem, status:'noTransfer_self',
        isHistorical:true, createdAt:now, createdBy:currentUser?.email }); count++;
    });
    renderTransferPage();
    if (count > 0) {
      const jobId = bgJobAdd(`匯入歷史轉銜名單（${count}筆）`);
      (async () => { try { await saveTransfer(); _checkTransferGradTodos(); bgJobDone(jobId); auditLog('匯入歷史轉銜名單', null, null, `${count}筆`); } catch (e) { bgJobFail(jobId, e.message); } })();
    } else { alert('未匯入任何記錄（已有決議或找不到對應個案）。'); }
  } catch (e) { alert('解析失敗：' + e.message); renderTransferPage(); }
}

async function showGradTransferImportPreview(rows, curSem) {
  const headers = rows[0].map(h => h.trim());
  // 嚴格固定欄位：[0]姓名 [1]學號 [2]校級評估會議日期 [3]校級會議轉銜評估結果 [4]結案會議日期 [5]結案會議評估結果
  if (!/姓名/.test(headers[0]) || !/學號/.test(headers[1])) {
    alert('格式不符：第1欄應為「姓名」、第2欄應為「學號」，請使用下載的範本。');
    renderTransferPage(); return;
  }

  // ── 比對個案（使用共用函式）──
  const _gtMatch = (name, sid) => _importMatchCase(name, sid);

  const decLblMap = { pending:'未決議', noTransfer_school:'校級不轉銜', transfer_school:'校級建議轉銜' };
  const entries = rows.slice(1).filter(r => r.some(v => v)).map((r, i) => {
    const originalName       = r[0] || '';
    const originalSid        = r[1] || '';
    const schoolMeetingDate  = parseTaiwanDate(r[2] || '');
    const result             = r[3] || '';
    const closureMeetingDate = parseTaiwanDate(r[4] || '');
    const closureRaw         = r[5] || '';
    const { mc, matchType } = _gtMatch(originalName, originalSid);
    let decision = 'pending';
    if (result) {
      if (/年久不可考|不可考|歷史久遠/i.test(result)) decision = 'untraceable';
      else if (/直升碩士|直升博士|直升碩|直升博|直升/i.test(result)) decision = 'direct_admission';
      else if (/B案|B類型/i.test(result)) decision = 'b_case';
      else if (/一次性諮詢|一次性/i.test(result)) decision = 'one_time_consult';
      else if (result.includes('不')) decision = 'noTransfer_school';
      else decision = 'transfer_school';
    } else if (schoolMeetingDate) decision = 'pending';
    let closureDecision = '';
    if (closureRaw) closureDecision = closureRaw.includes('不') ? 'notClose' : 'close';
    const isDuplicate = !!(mc && _getGradTransferDecision(mc.id, curSem));
    return { i, name: originalName, sid: originalSid, originalName, originalSid,
             schoolMeetingDate, result, closureMeetingDate, closureRaw, closureDecision,
             mc, matchType, decision, isDuplicate, _sel: (matchType === 'full' || matchType === 'none') && !isDuplicate };
  });
  if (!entries.length) { alert('未找到有效資料列。'); renderTransferPage(); return; }

  // 初始勾選：正常資料（full match, 非重複）預設全選
  let sel = new Set(entries.reduce((acc, e, i) => { if (e._sel) acc.push(i); return acc; }, []));
  window._gtRow = entries;

  // ── 頁籤定義：4 分流 ──
  // 'normal'   : matchType==='full' && !isDuplicate
  // 'dup'      : isDuplicate===true
  // 'mismatch' : (sid_only | name_only) && !isDuplicate
  // 'notfound' : matchType==='none' && !isDuplicate
  let previewTab = 'normal';
  function _gtGetTabEntries(tab) {
    switch (tab) {
      case 'normal':   return entries.filter(e => e.matchType === 'full' && !e.isDuplicate);
      case 'dup':      return entries.filter(e => e.isDuplicate);
      case 'mismatch': return entries.filter(e => (e.matchType === 'sid_only' || e.matchType === 'name_only') && !e.isDuplicate);
      case 'notfound': return entries.filter(e => e.matchType === 'none' && !e.isDuplicate);
      default: return [];
    }
  }
  let _gtLastClick = -1; // Shift 範圍選取：上次點擊的 entries 索引（見全站批次勾選共用 helper）
  window._gtPreviewTab = (t) => { previewTab = t; _gtLastClick = -1; _gtRender(); };

  // ── 勾選操作（Shift 範圍計算呼叫共用純函式 _ckgRangeIndices）──
  window._gtSel = (i, c, evt) => {
    const tabIdxs = _gtGetTabEntries(previewTab).map(e => entries.indexOf(e));
    const range = (evt?.shiftKey && _gtLastClick >= 0 && tabIdxs.includes(_gtLastClick)) ? _ckgRangeIndices(tabIdxs, _gtLastClick, i) : [i];
    range.forEach(idx => c ? sel.add(idx) : sel.delete(idx));
    _gtLastClick = i;
    _gtRender();
  };
  // 全選/取消全選：依當前頁籤判斷是否全選，智慧切換
  window._gtToggleAll = () => {
    const tabEntries = _gtGetTabEntries(previewTab);
    const tabIdxs = tabEntries.map(e => entries.indexOf(e));
    const tabSelCount = tabIdxs.filter(i => sel.has(i)).length;
    const doSelect = tabSelCount < tabEntries.length;
    tabIdxs.forEach(i => doSelect ? sel.add(i) : sel.delete(i));
    _gtLastClick = -1;
    _gtRender();
  };

  // ── 欄位排序 ──
  let sortKey = null, sortDir = 1;
  window._gtSort = (key) => {
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    const selEntries = new Set([...sel].map(i => entries[i]));
    entries.sort((a, b) => (a[key]||'').localeCompare(b[key]||'', 'zh-TW') * sortDir);
    sel = new Set(entries.map((e, i) => selEntries.has(e) ? i : -1).filter(i => i >= 0));
    _gtRender();
  };

  // ── 行內編輯後重新驗證（blur 觸發）──
  window._gtRevalidate = (i) => {
    const e = window._gtRow[i];
    const { mc, matchType } = _gtMatch(e.name, e.sid);
    const isDuplicate = !!(mc && _getGradTransferDecision(mc?.id, curSem));
    e.mc = mc; e.matchType = matchType; e.isDuplicate = isDuplicate;
    e.forceType = null; e._relinking = false;
    // 修正成功 → 自動加入選取；仍有問題 → 移出選取
    if (matchType === 'full' && !isDuplicate) sel.add(i); else sel.delete(i);
    _gtRender();
    // 若仍未匹配，對該列施加 shake 動畫（重繪後查找）
    if (matchType !== 'full') {
      const tr = document.querySelector(`tr[data-row-idx="${i}"]`);
      if (tr) { tr.classList.remove('gt-shake'); void tr.offsetWidth; tr.classList.add('gt-shake'); setTimeout(() => tr.classList.remove('gt-shake'), 600); }
    }
  };

  window._gtForceAccept  = (i) => { entries[i].forceType = 'old_eval';  sel.add(i); _gtRender(); };
  window._gtForceLink    = (i) => { entries[i].forceType = 'direct';    sel.add(i); _gtRender(); };
  window._gtUpdateSid    = (i) => { entries[i].forceType = 'update_sid'; sel.add(i); _gtRender(); };
  window._gtStartRelink  = (i) => { window._gtRow[i]._relinking = true; _gtRender(); };
  window._gtRelinkPick   = (i, cid) => {
    const mc = casesData.find(c => c.id === cid);
    if (!mc) return;
    const e = window._gtRow[i];
    e.mc = mc; e.forceType = 'relink'; e._relinking = false;
    sel.add(i); _gtRender();
  };
  window._gtCancelRelink = (i) => { window._gtRow[i]._relinking = false; _gtRender(); };
  window._gtCancelForce  = (i) => {
    const e = entries[i];
    const { mc, matchType } = _gtMatch(e.name, e.sid);
    e.mc = mc; e.matchType = matchType; e.isDuplicate = !!(mc && _getGradTransferDecision(mc?.id, curSem));
    e.forceType = null; e._relinking = false;
    sel.delete(i);
    _gtRender();
  };

  // ── 列渲染 ──
  function _gtMakeRow(e, i) {
    const forceAccepted = !!e.forceType;
    const isEditable = e.matchType !== 'full' && !forceAccepted && !e._relinking;
    const manuallyFixed = (e.name !== e.originalName || e.sid !== e.originalSid) && e.matchType === 'full' && !e.isDuplicate;
    const warnMsg = e.matchType==='none' ? '❌ 找不到個案'
      : e.matchType==='sid_only' ? `⚠ 學號符合姓名不符（系統：${escHtml(e.mc?.name||'—')}）`
      : e.matchType==='name_only' ? `⚠ 姓名符合學號不符（系統：${escHtml(e.mc?.studentId||'—')}）` : '';
    const dupBadge = e.isDuplicate
      ? `<span style="font-size:.72rem;background:#fed7aa;color:#9c4221;border-radius:4px;padding:1px 5px;border:1px solid #fb923c;">已有決議：${escHtml(decLblMap[_getGradTransferDecision(e.mc?.id,curSem)?.status]||'—')}</span>`
      : '';
    let rowBg = e.isDuplicate ? '#fff7ed' : (forceAccepted ? '#ecfdf5' : e._relinking ? '#f0fdf4' : (isEditable ? '#fff8e1' : (i%2===0?'#fff':'#f7fafc')));
    if (manuallyFixed) rowBg = '#ecfdf5';
    const auditHtml = [
      (e.name !== e.originalName) ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">(原姓名：${escHtml(e.originalName)})</div>` : '',
      (e.sid  !== e.originalSid)  ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">(原學號：${escHtml(e.originalSid)})</div>`  : '',
    ].join('');
    const _btn = (onclick, label, color, bg) =>
      `<button onclick="${onclick}" style="margin-top:3px;font-size:.72rem;padding:2px 7px;border:1px solid ${color};background:${bg};color:${color};border-radius:4px;cursor:pointer;white-space:nowrap;">${label}</button>`;
    let actionBtns = '';
    if (!forceAccepted && !e._relinking) {
      if (e.matchType === 'name_only') {
        actionBtns =
          _btn(`window._gtForceAccept(${i})`, '納入（舊評估）', '#059669', '#ecfdf5') +
          _btn(`window._gtUpdateSid(${i})`,   '更新學號',       '#2b6cb0', '#ebf8ff') +
          _btn(`window._gtStartRelink(${i})`, '重新連結',       '#718096', '#f7fafc');
      } else if (e.matchType === 'sid_only') {
        actionBtns =
          _btn(`window._gtForceLink(${i})`,   '直接連結',       '#059669', '#ecfdf5') +
          _btn(`window._gtStartRelink(${i})`, '重新連結',       '#718096', '#f7fafc');
      } else if (e.matchType === 'none') {
        actionBtns = _btn(`window._gtStartRelink(${i})`, '手動連結個案', '#718096', '#f7fafc');
      }
    }
    const relinkUI = e._relinking
      ? `<div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
           <select onchange="if(this.value)window._gtRelinkPick(${i},this.value)" style="font-size:.75rem;padding:2px;max-width:160px;border:1px solid #a0aec0;border-radius:4px;">
             <option value="">— 選擇個案 —</option>
             ${casesData.filter(c=>!c.deleted).sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-TW')).map(c=>`<option value="${c.id}">${escHtml(c.name)}（${escHtml(c.studentId||'—')}）</option>`).join('')}
           </select>
           <button onclick="window._gtCancelRelink(${i})" style="font-size:.72rem;padding:1px 6px;border:1px solid #cbd5e0;background:#fff;color:#718096;border-radius:4px;cursor:pointer;width:fit-content;">取消</button>
         </div>`
      : '';
    const forceLabelMap = { old_eval:'納入（舊評估）', direct:'直接連結', update_sid:'更新學號並連結', relink:'重新連結至' };
    const statusContent = e._relinking
      ? relinkUI
      : forceAccepted
        ? `<span style="font-size:.78rem;color:#059669;">✅ ${forceLabelMap[e.forceType]||''}</span><div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">對應：${escHtml(e.mc?.name||'—')}（${escHtml(e.mc?.studentId||'—')}）</div><button onclick="window._gtCancelForce(${i})" style="margin-top:4px;font-size:.7rem;padding:1px 6px;border:1px solid #fc8181;background:#fff5f5;color:#c53030;border-radius:4px;cursor:pointer;">↩ 取消</button>`
        : manuallyFixed
          ? `<span style="font-size:.78rem;color:#059669;">✅ 已手動修正對應</span>${auditHtml}`
          : `${dupBadge}${warnMsg ? (dupBadge?'<br>':'') + warnMsg : ''}<div style="display:flex;flex-direction:column;">${actionBtns}</div>${auditHtml}`;
    const decSel = `<select style="font-size:.8rem;padding:2px 4px;" onchange="window._gtRow[${i}].decision=this.value">
      <option value="pending"${e.decision==='pending'?' selected':''}>未決議</option>
      <option value="noTransfer_school"${e.decision==='noTransfer_school'?' selected':''}>校級不轉銜</option>
      <option value="transfer_school"${e.decision==='transfer_school'?' selected':''}>校級建議轉銜</option>
      <option value="b_case"${e.decision==='b_case'?' selected':''}>B案（無須評估）</option>
      <option value="one_time_consult"${e.decision==='one_time_consult'?' selected':''}>一次性諮詢不予討論</option>
      <option value="direct_admission"${e.decision==='direct_admission'?' selected':''}>直升碩/博士（免評估）</option>
      <option value="untraceable"${e.decision==='untraceable'?' selected':''}>年久不可考</option>
    </select>`;
    const closureSel = `<select style="font-size:.8rem;padding:2px 4px;" onchange="window._gtRow[${i}].closureDecision=this.value">
      <option value=""${!e.closureDecision?' selected':''}>（無）</option>
      <option value="pending_closure"${e.closureDecision==='pending_closure'?' selected':''}>未決議</option>
      <option value="notClose"${e.closureDecision==='notClose'?' selected':''}>不結案</option>
      <option value="close"${e.closureDecision==='close'?' selected':''}>結案</option>
    </select>`;
    return `<tr data-row-idx="${i}" style="background:${rowBg};transition:background 0.3s;">
      <td style="text-align:center;"><input type="checkbox" id="gt-cb-${i}" ${sel.has(i)?'checked':''} onchange="window._gtSel(${i},this.checked,event)"></td>
      <td style="min-width:60px;padding:4px 6px;"><div contenteditable="${isEditable}" style="outline:none;" oninput="window._gtRow[${i}].name=this.textContent.trim()" onblur="window._gtRevalidate(${i})">${escHtml(e.name)}</div></td>
      <td style="min-width:80px;padding:4px 6px;"><div contenteditable="${isEditable}" style="outline:none;" oninput="window._gtRow[${i}].sid=this.textContent.trim()" onblur="window._gtRevalidate(${i})">${escHtml(e.sid)}</div></td>
      <td style="font-size:.8rem;">${escHtml(e.schoolMeetingDate||'—')}</td>
      <td style="font-size:.8rem;">${escHtml(e.closureMeetingDate||'—')}</td>
      <td>${decSel}</td>
      <td>${closureSel}</td>
      <td data-status-cell="${i}" style="font-size:.78rem;color:${forceAccepted?'#059669':(isEditable&&!manuallyFixed?'#d97706':'#718096')};min-width:100px;">${statusContent}</td>
    </tr>`;
  }

  // ── 主渲染函式 ──
  function _gtRender() {
    const el = document.getElementById('gt-import-list');
    if (!el) return;

    const normalCount   = entries.filter(e => e.matchType === 'full' && !e.isDuplicate).length;
    const dupCount      = entries.filter(e => e.isDuplicate).length;
    const mismatchCount = entries.filter(e => (e.matchType === 'sid_only' || e.matchType === 'name_only') && !e.isDuplicate).length;
    const notfoundCount = entries.filter(e => e.matchType === 'none' && !e.isDuplicate).length;

    const _sth = (label, key, colNum) => {
      const arrow = sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ' ⇅';
      return `<th data-col="${colNum}" onclick="window._gtSort('${key}')" style="cursor:pointer;user-select:none;white-space:nowrap;">${label}<span style="font-size:.7rem;color:#a0aec0;">${arrow}</span></th>`;
    };
    const _tabBtn = (id, label, count, color, warn) => {
      const active = previewTab === id;
      const badge = warn && count > 0 ? `<span style="font-size:.68rem;background:${color}25;color:${color};border-radius:8px;padding:0 5px;margin-left:3px;border:1px solid ${color}60;">!</span>` : '';
      return `<button onclick="window._gtPreviewTab('${id}')" style="padding:6px 14px;border:none;cursor:pointer;font-size:.82rem;font-weight:${active?'700':'400'};background:none;border-bottom:${active?`2px solid ${color}`:'2px solid transparent'};color:${active?color:'#718096'};margin-bottom:-2px;white-space:nowrap;">${label}（${count}）${badge}</button>`;
    };

    const tabBtns = `<div class="gt-tabs-bar" style="position:sticky;top:0;z-index:20;background:#fff;display:flex;gap:2px;border-bottom:2px solid #e2e8f0;padding-bottom:2px;flex-wrap:wrap;padding-top:2px;">
      ${_tabBtn('normal',   '正常資料',      normalCount,   '#2b6cb0', false)}
      ${_tabBtn('dup',      '重複資料',      dupCount,      '#c05621', true)}
      ${_tabBtn('mismatch', '姓名/學號不符', mismatchCount, '#d97706', true)}
      ${_tabBtn('notfound', '找不到個案',    notfoundCount, '#e53e3e', true)}
    </div>`;

    const hintMap = {
      normal:   `<div style="font-size:.82rem;color:#4a5568;margin-bottom:8px;">✅ 姓名與學號完全符合，預設全選。</div>`,
      dup:      `<div style="font-size:.82rem;color:#9c4221;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-bottom:8px;">🔁 系統中已有校級評估決議。勾選後匯入將覆蓋現有資料，請謹慎確認。</div>`,
      mismatch: `<div style="font-size:.82rem;color:#d97706;background:#fffaf0;border:1px solid #f6ad55;border-radius:6px;padding:8px 12px;margin-bottom:8px;">⚠ 學號或姓名其中一項符合，另一項不符。可直接點選格子修改，離開欄位後即時重新比對。</div>`,
      notfound: `<div style="font-size:.82rem;color:#e53e3e;background:#fff5f5;border:1px solid #fc8181;border-radius:6px;padding:8px 12px;margin-bottom:8px;">❌ 找不到對應個案。可嘗試修改姓名/學號後重新比對；勾選後匯入將納入「未歸屬校級評估」頁籤，供手動連結。</div>`,
    };
    const emptyMap = {
      normal: '無正常資料', dup: '無重複資料', mismatch: '無姓名/學號不符資料', notfound: '無找不到個案的資料',
    };

    const tabEntries = _gtGetTabEntries(previewTab);
    const tabIdxs = tabEntries.map(e => entries.indexOf(e));
    const tabSelCount = tabIdxs.filter(i => sel.has(i)).length;
    const tbody = tabEntries.map(e => _gtMakeRow(e, entries.indexOf(e))).join('');

    const tableHtml = tabEntries.length
      ? `<table id="gt-import-table" class="grad-import-table" style="width:100%;border-collapse:collapse;font-size:.85rem;">
          <colgroup>
            <col id="gt-col-1" style="width:30px;">
            <col id="gt-col-2" style="min-width:80px;">
            <col id="gt-col-3" style="min-width:80px;">
            <col id="gt-col-4" style="min-width:90px;">
            <col id="gt-col-5" style="min-width:90px;">
            <col id="gt-col-6" style="min-width:90px;">
            <col id="gt-col-7" style="min-width:90px;">
            <col id="gt-col-8" style="min-width:90px;">
          </colgroup>
          <thead><tr id="gt-thead-row" style="background:#f7fafc;font-size:.8rem;position:sticky;top:0;">
            <th data-col="1" style="width:30px;"><input type="checkbox" id="gt-sel-all-cb" title="全選/取消全選" onclick="window._gtToggleAll()"></th>
            ${_sth('姓名','name',2)}${_sth('學號','sid',3)}<th data-col="4">校級會議日期</th><th data-col="5">結案會議日期</th>${_sth('校級評估結果','decision',6)}${_sth('結案評估結果','closureDecision',7)}<th data-col="8">狀態</th>
          </tr></thead><tbody>${tbody}</tbody></table>`
      : `<div style="padding:20px;text-align:center;color:#a0aec0;">${emptyMap[previewTab]}</div>`;

    el.innerHTML = tabBtns + hintMap[previewTab] + tableHtml;
    if (tabEntries.length) {
      _makeTableResizable({ table: document.getElementById('gt-import-table'), colPrefix: 'gt-col-', colNums: [1,2,3,4,5,6,7,8], prefKey: 'gtColWidths', skipCols: new Set([1]) });
    }

    // 量測 sticky 頁籤列高度，設定 thead 的 top offset 使兩者無縫接合
    const tabsBarEl = el.querySelector('.gt-tabs-bar');
    const theadRowEl = document.getElementById('gt-thead-row');
    if (tabsBarEl && theadRowEl) theadRowEl.style.top = tabsBarEl.offsetHeight + 'px';

    // ── 重繪後用 JS 精確設定表頭 checkbox 狀態 ──
    const headerCb = document.getElementById('gt-sel-all-cb');
    if (headerCb && tabEntries.length > 0) {
      if (tabSelCount === tabEntries.length) {
        headerCb.checked = true;  headerCb.indeterminate = false;
      } else if (tabSelCount > 0) {
        headerCb.checked = false; headerCb.indeterminate = true;
      } else {
        headerCb.checked = false; headerCb.indeterminate = false;
      }
    }

    // ── 更新底部按鈕文字 ──
    const btn = document.getElementById('gt-confirm-btn');
    if (btn) btn.textContent = `匯入 / 更新 ${sel.size} 筆`;
    const selDupCount = [...sel].filter(i => entries[i]?.isDuplicate).length;
    const info = document.getElementById('gt-sel-info');
    if (info) info.textContent = selDupCount > 0 ? `（含 ${selDupCount} 筆將覆蓋現有決議）` : '';
  }

  document.getElementById('transfer-body').innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:1rem;">校級轉銜評估結果匯入（共 ${entries.length} 筆）</h3>
        <button onclick="renderTransferPage()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <div id="gt-import-list" style="max-height:60vh;overflow-y:auto;"></div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
        <button id="gt-confirm-btn" class="btn btn-primary" onclick="window._gtConfirm()">匯入</button>
        <button class="btn btn-secondary" onclick="renderTransferPage()">取消</button>
        <span id="gt-sel-info" style="font-size:.82rem;color:#d97706;"></span>
      </div>
    </div>`;
  _gtRender();

  window._gtConfirm = async () => {
    const toImport = entries.filter((_, i) => sel.has(i));
    if (!toImport.length) { alert('未選取任何列'); return; }
    const now = new Date().toISOString(); let matched = 0, unassigned = 0;
    const sidUpdateCaseIds = [];
    toImport.forEach(e => {
      const mc = e.mc || casesData.find(c => !c.deleted && (c.studentId===e.sid || c.name===e.name));
      if (mc) {
        if (e.forceType === 'update_sid' && e.sid && e.sid !== mc.studentId) {
          mc.studentId = e.sid;
          sidUpdateCaseIds.push(mc.id);
        }
        const ex = _getGradTransferDecision(mc.id, curSem);
        if (ex) {
          ex.status = e.decision; ex.schoolMeetingDate = e.schoolMeetingDate||''; ex.updatedAt = now;
          if (e.closureDecision) ex.closureDecision = e.closureDecision;
          if (e.closureMeetingDate) ex.closureMeetingDate = e.closureMeetingDate;
        } else {
          transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            type:'graduation', caseId:mc.id, semester:curSem,
            status:e.decision, schoolMeetingDate:e.schoolMeetingDate||'',
            closureDecision:e.closureDecision||'', closureMeetingDate:e.closureMeetingDate||'',
            createdAt:now, createdBy:currentUser?.email });
        }
        matched++;
      } else {
        transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          type:'graduation', caseId: null, semester:curSem,
          unassignedName: e.name, unassignedStudentId: e.sid,
          status:e.decision, schoolMeetingDate:e.schoolMeetingDate||'',
          closureDecision:e.closureDecision||'', closureMeetingDate:e.closureMeetingDate||'',
          createdAt:now, createdBy:currentUser?.email });
        unassigned++;
      }
    });
    renderTransferPage();
    const total = matched + unassigned;
    if (total > 0) {
      const jobId = bgJobAdd(`匯入校級評估結果（${total}筆）`);
      (async () => { try {
        await saveTransfer();
        if (sidUpdateCaseIds.length) await saveCasesChunks(...sidUpdateCaseIds);
        _checkTransferGradTodos();
        bgJobDone(jobId);
        auditLog('匯入校級轉銜評估結果', null, null, `${total}筆${sidUpdateCaseIds.length?`（含 ${sidUpdateCaseIds.length} 筆學號更新）`:''}`);
      } catch (e) { bgJobFail(jobId, e.message); } })();
    }
    if (unassigned > 0) {
      alert(`已匯入 ${matched} 筆，另有 ${unassigned} 筆因找不到對應個案而納入「未歸屬校級評估」，請至該頁籤手動連結。`);
    }
  };
}

function _renderUnassignedTab() {
  const unassigned = transferData.filter(r => r.type === 'graduation' && !r.caseId);
  if (!unassigned.length) {
    return `<div class="empty-state"><div class="icon">✅</div><p>目前無未歸屬的校級評估資料</p></div>`;
  }
  const decLabelMap = { pending:'待決議', noTransfer_self:'主責評估綠燈不轉銜', noTransfer_self_reason:'主責評估不轉銜（原因自填）', transfer_school:'校級建議轉銜', noTransfer_school:'校級建議不需轉銜', stay:'本學期不離校', b_case:'B案（無須評估）', one_time_consult:'一次性諮詢不予討論', direct_admission:'直升碩/博士（免評估）', untraceable:'年久不可考' };
  const rows = unassigned.map(r => {
    const createdAt = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-TW') : '—';
    return `<div class="record-card" style="margin-bottom:8px;border-left:3px solid #f6ad55;">
      <div class="record-card-header" style="flex-wrap:wrap;gap:6px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1;">
          <strong>${escHtml(r.unassignedName||'—')}</strong>
          <span style="color:#718096;font-size:.82rem;">${escHtml(r.unassignedStudentId||'—')}</span>
          <span style="font-size:.73rem;background:#fef3c7;color:#92400e;border-radius:8px;padding:1px 7px;border:1px solid #fcd34d;">未歸屬</span>
          <span style="font-size:.73rem;background:#f0f4f8;color:#718096;border-radius:8px;padding:1px 7px;">${escHtml(decLabelMap[r.status]||r.status||'待決議')}</span>
          ${r.schoolMeetingDate ? `<span style="font-size:.75rem;color:#718096;">校級會議：${escHtml(r.schoolMeetingDate)}</span>` : ''}
          ${r.closureMeetingDate ? `<span style="font-size:.75rem;color:#718096;">結案會議：${escHtml(r.closureMeetingDate)}</span>` : ''}
          <span style="font-size:.75rem;color:#a0aec0;">匯入：${createdAt}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button class="btn btn-primary btn-sm" onclick="_linkUnassignedRecord('${escHtml(r.id)}')">連結個案</button>
          <button class="btn btn-sm" style="background:#fff5f5;border-color:#fc8181;color:#c53030;" onclick="_deleteUnassignedRecord('${escHtml(r.id)}')">刪除</button>
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-bottom:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:.85rem;color:#92400e;">
    共 <strong>${unassigned.length}</strong> 筆 CSV 匯入資料未能對應到系統個案，請逐筆「連結個案」後即可納入轉銜流程。
  </div>` + rows;
}

function _deleteUnassignedRecord(recId) {
  if (!confirm('確定要刪除這筆未歸屬資料？此操作無法復原。')) return;
  const idx = transferData.findIndex(r => r.id === recId);
  if (idx >= 0) transferData.splice(idx, 1);
  renderTransferPage();
  const jobId = bgJobAdd('刪除未歸屬轉銜紀錄');
  (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function _linkUnassignedRecord(recId) {
  const rec = transferData.find(r => r.id === recId);
  if (!rec) return;
  window._linkRecId = recId;
  window._linkMode = 'search';
  window._linkSelectedCaseId = null;
  window._linkCases = [...casesData].filter(c => !c.deleted)
    .sort((a, b) => (a.name||'').localeCompare(b.name||'', 'zh-TW'));
  const autoId = generateCaseId();
  const _decLabelMap = { pending:'待決議', noTransfer_self:'主責評估不需轉銜', transfer_school:'校級建議轉銜', noTransfer_school:'校級建議不需轉銜', stay:'本學期不離校', b_case:'B案（無須評估）', one_time_consult:'一次性諮詢不予討論', direct_admission:'直升碩/博士（免評估）', untraceable:'年久不可考' };
  const decOptions = Object.entries(_decLabelMap).map(([v,l]) =>
    `<option value="${v}"${rec.status===v?' selected':''}>${escHtml(l)}</option>`).join('');
  const _buildAllCounselorOpts = () => {
    const _us = Object.entries(configData?.users || {});
    const _ro = r => COUNSELOR_ROLE_ORDER[r] ?? 99;
    const _en = _us.filter(([, i]) => !i.disabled && BK_COUNSELING_ROLES.has(i.role))
      .sort(([, a], [, b]) => (_ro(a.role) - _ro(b.role)) || (a.name||'').localeCompare(b.name||'', 'zh-TW'));
    const _di = _us.filter(([, i]) => i.disabled)
      .sort(([, a], [, b]) => (_ro(a.role) - _ro(b.role)) || (a.name||'').localeCompare(b.name||'', 'zh-TW'));
    let _h = `<option value="">— 請選擇主責輔導人員 —</option><option value="custom_new" style="color:#2b6cb0;font-style:italic;">[ ＋ 自填新增輔導人員 ]</option>`;
    if (_en.length) { _h += `<optgroup label="啟用中人員">${_en.map(([e, i]) => `<option value="${escHtml(e)}">${escHtml(i.name||e)}${i.role ? ` — ${escHtml(i.role)}` : ''}</option>`).join('')}</optgroup>`; }
    if (_di.length) { _h += `<optgroup label="已停用人員">${_di.map(([e, i]) => `<option value="${escHtml(e)}" style="color:#a0aec0;">(已停用) ${escHtml(i.name||e)}${i.role ? ` — ${escHtml(i.role)}` : ''}</option>`).join('')}</optgroup>`; }
    return _h;
  };
  const modalHtml = `
    <div id="link-case-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:95%;max-height:88vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="font-size:1rem;margin:0;font-weight:700;">連結個案</h3>
          <button onclick="document.getElementById('link-case-modal').remove()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:#718096;">&times;</button>
        </div>
        <div style="font-size:.85rem;color:#4a5568;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;">
          未歸屬：<strong>${escHtml(rec.unassignedName||'—')}</strong>（${escHtml(rec.unassignedStudentId||'—')}）
          ${rec.schoolMeetingDate ? `&ensp;<span style="color:#718096;">校級：${escHtml(rec.schoolMeetingDate)}</span>` : ''}
          &ensp;<span style="color:#718096;">${escHtml(_decLabelMap[rec.status]||rec.status||'待決議')}</span>
        </div>
        <div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;">
          <button id="link-tab-search" onclick="_linkSetMode('search')"
            style="padding:6px 18px;border:none;border-bottom:2px solid #3498db;margin-bottom:-2px;cursor:pointer;font-size:.88rem;font-weight:700;background:transparent;color:#3498db;">
            搜尋現有個案
          </button>
          <button id="link-tab-create" onclick="_linkSetMode('create')"
            style="padding:6px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;font-size:.88rem;font-weight:400;background:transparent;color:#718096;">
            建立新個案並連結
          </button>
        </div>
        <div id="link-panel-search" style="display:flex;flex-direction:column;gap:10px;overflow:hidden;">
          <input type="text" id="link-search" placeholder="搜尋姓名、學號或案號…" oninput="_linkFilter()"
            style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:.9rem;outline:none;flex-shrink:0;">
          <div id="link-case-list" style="overflow-y:auto;max-height:240px;border:1px solid #e2e8f0;border-radius:6px;flex-shrink:0;"></div>
        </div>
        <div id="link-panel-create" style="display:none;flex-direction:column;gap:10px;overflow-y:auto;max-height:340px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">案號 <span class="req">*</span></label>
              <input id="link-new-cid" type="text" value="${escHtml(autoId)}" maxlength="7"
                style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">開案日期 <span class="req">*</span></label>
              <input id="link-new-open-date" type="date" value="${new Date().toISOString().slice(0,10)}"
                style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">姓名</label>
              <input type="text" value="${escHtml(rec.unassignedName||'')}" readonly
                style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;background:#f8fafc;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">學號</label>
              <input type="text" value="${escHtml(rec.unassignedStudentId||'')}" readonly
                style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;background:#f8fafc;box-sizing:border-box;">
            </div>
          </div>
          <div>
            <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">主責輔導人員 <span class="req">*</span></label>
            <select id="link-new-counselor" onchange="_linkCounselorChange()"
              style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
              ${_buildAllCounselorOpts()}
            </select>
          </div>
          <div id="link-new-user-fields" style="display:none;flex-direction:column;gap:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;">
            <div style="font-size:.82rem;color:#1e40af;font-weight:600;">➕ 新增人員資料（儲存後自動建立帳號）</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div>
                <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">姓名 <span class="req">*</span></label>
                <input id="link-new-user-name" type="text" placeholder="請輸入人員姓名"
                  style="width:100%;padding:7px 10px;border:1px solid #bfdbfe;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
              </div>
              <div>
                <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">身分 <span class="req">*</span></label>
                <select id="link-new-user-role" style="width:100%;padding:7px 10px;border:1px solid #bfdbfe;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
                  <option value="">— 選擇身分 —</option>
                  <option value="專任諮商心理師">專任諮商心理師</option>
                  <option value="專任臨床心理師">專任臨床心理師</option>
                  <option value="專任社會工作師">專任社會工作師</option>
                  <option value="兼任諮商心理師">兼任諮商心理師</option>
                  <option value="兼任臨床心理師">兼任臨床心理師</option>
                  <option value="實習諮商心理師">實習諮商心理師</option>
                  <option value="義務輔導老師">義務輔導老師</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">評估人員</label>
            <select id="link-new-assessor"
              style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
              ${buildCounselorOptgroups(null, '— 請選擇評估人員 —')}
            </select>
          </div>
          <div>
            <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">校級評估結果</label>
            <select id="link-new-decision"
              style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
              <option value="">— 沿用匯入結果 —</option>
              ${decOptions}
            </select>
          </div>
          <div>
            <label style="font-size:.82rem;color:#4a5568;display:block;margin-bottom:3px;">退學／離校原因備註</label>
            <input id="link-new-withdraw-reason" type="text" placeholder=""
              style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;box-sizing:border-box;">
          </div>
          <div id="link-create-alert" style="display:none;font-size:.83rem;color:#c53030;background:#fff5f5;border:1px solid #fc8181;border-radius:6px;padding:7px 12px;"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #f0f4f8;padding-top:12px;flex-shrink:0;">
          <button class="btn btn-secondary" onclick="document.getElementById('link-case-modal').remove()">取消</button>
          <button id="link-confirm-btn" class="btn btn-primary" disabled onclick="_confirmLinkRecord('${escHtml(recId)}')">確認連結</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  window._linkFilter = () => {
    const q = (document.getElementById('link-search')?.value || '').trim().toLowerCase();
    const filtered = q
      ? window._linkCases.filter(c =>
          (c.name||'').toLowerCase().includes(q) ||
          (c.studentId||'').toLowerCase().includes(q) ||
          (c.id||'').toLowerCase().includes(q))
      : window._linkCases;
    const list = document.getElementById('link-case-list');
    if (!list) return;
    if (!filtered.length) { list.innerHTML = `<div style="padding:12px;color:#a0aec0;font-size:.85rem;text-align:center;">無符合條件的個案</div>`; return; }
    list.innerHTML = filtered.slice(0, 100).map(c => {
      const isSel = c.id === window._linkSelectedCaseId;
      const closedBadge = c.status === 'closed' ? `<span style="font-size:.72rem;background:#f0f4f8;color:#718096;border-radius:4px;padding:1px 5px;flex-shrink:0;">已結案</span>` : '';
      return `<div onclick="_linkSelectCase('${escHtml(c.id)}')" style="padding:10px 14px;cursor:pointer;font-size:.85rem;background:${isSel?'#ebf8ff':'#fff'};border-bottom:1px solid #f0f4f8;display:flex;gap:8px;align-items:center;user-select:none;">
        <span style="width:14px;color:#3182ce;flex-shrink:0;">${isSel?'✓':''}</span>
        <span style="font-weight:${isSel?'700':'400'};">${escHtml(c.name||'—')}</span>
        <span style="color:#718096;font-size:.8rem;">${escHtml(c.studentId||'—')}</span>
        <span style="color:#a0aec0;font-size:.78rem;">${escHtml(c.id||'')}</span>
        ${closedBadge}
        <span style="color:#a0aec0;font-size:.75rem;margin-left:auto;">${escHtml(c.counselorName||c.counselorEmail||'')}</span>
      </div>`;
    }).join('');
  };
  window._linkSelectCase = (cid) => {
    window._linkSelectedCaseId = cid;
    const btn = document.getElementById('link-confirm-btn');
    if (btn) btn.disabled = false;
    window._linkFilter();
  };
  window._linkSetMode = (mode) => {
    window._linkMode = mode;
    const tabSearch = document.getElementById('link-tab-search');
    const tabCreate = document.getElementById('link-tab-create');
    const panelSearch = document.getElementById('link-panel-search');
    const panelCreate = document.getElementById('link-panel-create');
    const btn = document.getElementById('link-confirm-btn');
    if (!tabSearch) return;
    if (mode === 'search') {
      tabSearch.style.borderBottomColor = '#3498db'; tabSearch.style.color = '#3498db'; tabSearch.style.fontWeight = '700';
      tabCreate.style.borderBottomColor = 'transparent'; tabCreate.style.color = '#718096'; tabCreate.style.fontWeight = '400';
      panelSearch.style.display = 'flex'; panelCreate.style.display = 'none';
      btn.disabled = !window._linkSelectedCaseId; btn.textContent = '確認連結';
    } else {
      tabCreate.style.borderBottomColor = '#3498db'; tabCreate.style.color = '#3498db'; tabCreate.style.fontWeight = '700';
      tabSearch.style.borderBottomColor = 'transparent'; tabSearch.style.color = '#718096'; tabSearch.style.fontWeight = '400';
      panelSearch.style.display = 'none'; panelCreate.style.display = 'flex';
      btn.disabled = false; btn.textContent = '建立並連結';
    }
  };
  window._linkCounselorChange = () => {
    const sel = document.getElementById('link-new-counselor');
    const fieldsEl = document.getElementById('link-new-user-fields');
    if (!sel || !fieldsEl) return;
    fieldsEl.style.display = sel.value === 'custom_new' ? 'flex' : 'none';
  };
  window._linkFilter();
}

async function _confirmLinkRecord(recId) {
  const mode = window._linkMode || 'search';
  const rec = transferData.find(r => r.id === recId);
  if (!rec) return;
  const now = new Date().toISOString();
  if (mode === 'search') {
    const cid = window._linkSelectedCaseId;
    if (!cid) return;
    rec.caseId = cid; rec.linkedAt = now; rec.linkedBy = currentUser?.email;
    document.getElementById('link-case-modal')?.remove();
    _checkTransferGradTodos(); renderTransferPage();
    const jobId = bgJobAdd('連結未歸屬轉銜紀錄');
    (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('連結未歸屬轉銜紀錄', cid, null, `recId:${recId}`); } catch(e) { bgJobFail(jobId, e.message); } })();
  } else {
    const newId = (document.getElementById('link-new-cid')?.value || '').trim();
    const openDate = document.getElementById('link-new-open-date')?.value || now.slice(0,10);
    let counselorEmail = document.getElementById('link-new-counselor')?.value || '';
    const assessorEmail = document.getElementById('link-new-assessor')?.value || '';
    const newDecision = document.getElementById('link-new-decision')?.value || '';
    const withdrawNote = (document.getElementById('link-new-withdraw-reason')?.value || '').trim();
    const alertEl = document.getElementById('link-create-alert');
    const showErr = (msg) => { if (alertEl) { alertEl.textContent = msg; alertEl.style.display = 'block'; } };
    if (!newId || newId.length !== 7) { showErr('案號須為 7 碼'); return; }
    if (parseInt(newId.slice(4), 10) === 0) { showErr('案號序號不可為 000'); return; }
    if (casesData.find(c => c.id === newId)) { showErr('案號已被使用，請修改'); return; }
    if (!counselorEmail) { showErr('請選擇主責輔導人員'); return; }
    // Handle custom_new: create a new user entry in configData
    let counselorDisplayName = '';
    let _newUserKey = null;
    if (counselorEmail === 'custom_new') {
      const newUserName = (document.getElementById('link-new-user-name')?.value || '').trim();
      const newUserRole = document.getElementById('link-new-user-role')?.value || '';
      if (!newUserName || !newUserRole) { showErr('使用者不存在，請填寫使用者姓名並選擇身分'); return; }
      _newUserKey = `nomail_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
      configData.users[_newUserKey] = { name: newUserName, role: newUserRole, disabled: false };
      counselorEmail = _newUserKey;
      counselorDisplayName = newUserName;
      // 通知所有管理員確認新建使用者
      Object.entries(configData.users).forEach(([email, info]) => {
        if ((info.isAdmin || info.extraRole === '管理者' || info.role === '主任') && email !== currentUser?.email) {
          addNotificationToUser(email, 'admin_verify_new_user', _newUserKey, newUserName,
            `使用者管理：請確認／補齊新建立的使用者資料 — ${newUserName}（${newUserRole}）`);
        }
      });
      // 若目前使用者本身是管理員，也加入自己的待辦事項
      if (currentRole === '主任' || extraRole === '管理者') {
        todosData.push({ id: `adm_nu_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
          type: 'admin_verify_new_user',
          label: `使用者管理：請確認／補齊新建立的使用者資料 — ${newUserName}`,
          caseLabel: `${newUserName}（${newUserRole}）`, newUserKey: _newUserKey,
          createdAt: now, updatedAt: now, done: false });
      }
    } else {
      counselorDisplayName = formatCounselorLabel(counselorEmail) || counselorEmail;
    }
    const newCase = {
      id: newId, openDate, name: rec.unassignedName||'', studentId: rec.unassignedStudentId||'',
      counselorEmail, counselorName: counselorDisplayName,
      abType: 'a_case', status: 'active', caseType: 'university',
      birthday: '', idNumber: '', legalGender: '', genderIdentity: '',
      nationality: '本國籍', ethnicity: '', ethnicityNote: '', foreignCountry: '',
      program: '', disability: '', department: '', grade: '', classNo: '',
      phone: '', email: '', residence: '', address: '',
      emergencyName: '', emergencyPhone: '', emergencyRelation: '',
      source: 'transfer_import', pastRecords: [], topics: [],
      counselorText: '', bsrs: [], bsrs6: null, bsrsTotal: null,
      isTransferCase: true, withdrawalNote: withdrawNote,
      createdAt: now, updatedAt: now,
    };
    rec.caseId = newId; rec.linkedAt = now; rec.linkedBy = currentUser?.email;
    if (assessorEmail) rec.assessorEmail = assessorEmail;
    if (newDecision) rec.status = newDecision;
    if (withdrawNote) rec.withdrawalNote = withdrawNote;
    document.getElementById('link-case-modal')?.remove();
    casesData.push(newCase);
    _assignChunkForNewCase(newId); // Slice 3：已重新分塊時分配 active chunk，否則不動作（legacy fallback）
    _checkTransferGradTodos(); renderTransferPage();
    const jobId = bgJobAdd('建立新個案並連結轉銜紀錄');
    (async () => {
      try {
        await saveCasesChunks(newId);
        await saveTransfer();
        // 轉銜窗口自填新增輔導人員：nomail_ 佔位帳號（無 Gmail，僅作主責標記）改走 configCasesPatch
        // 的 nomailAdd op（後端 _nomailAddOk_ 把關，不接受夾帶特權欄位），取代整檔覆寫 config.json——
        // 此路徑呼叫者未必是管理者（轉銜窗口聯絡人即可觸發），非管理者整檔寫 config 已被後端 deny。
        if (_newUserKey) await _configCasesPatch([{ type: 'nomailAdd', email: _newUserKey, entry: { ...configData.users[_newUserKey] } }]);
        await _flushNotifOps();
        renderNotifBell();
        bgJobDone(jobId);
        auditLog('建立個案並連結轉銜紀錄', newId, null, `recId:${recId}${_newUserKey?` (新建使用者${_newUserKey})`:''}` );
      } catch(e) {
        bgJobFail(jobId, e.message);
        const idx = casesData.findIndex(c => c.id === newId);
        if (idx >= 0) casesData.splice(idx, 1);
        rec.caseId = undefined; rec.linkedAt = undefined; rec.linkedBy = undefined;
        if (_newUserKey) delete configData.users[_newUserKey];
      }
    })();
  }
}

async function downloadGradTransferExcelTemplate() {
  await _xlsxEnsureLib();
  const headers = ['姓名', '學號', '校級評估會議日期', '校級會議轉銜評估結果', '結案會議日期', '結案會議評估結果'];
  const examples = [
    ['王小明', 'B11202001', '2025-03-15', '建議轉銜', '2025-09-10', '建議結案'],
    ['李大華', 'M11230002', '2025-03-15', '不建議轉銜', '', ''],
    ['陳小花', 'B11002003', '2025-03-15', '', '2025-09-10', '不建議結案'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = [10, 12, 18, 22, 14, 20].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '校級評估結果');
  XLSX.writeFile(wb, '校級轉銜評估結果匯入範本.xlsx');
}

// ══════════════════════════════════════════════
function renderTransferPage() {
  if (window._transferTab === 'outgoing') window._transferTab = 'incoming';
  if (!window._transferTab) { try { window._transferTab = localStorage.getItem('scc_trTab_' + DRIVE_FOLDER_ID) || 'graduation'; } catch(_) { window._transferTab = 'graduation'; } }
  const tab = window._transferTab;
  const tsf = window._transferStatusFilter || 'all';
  const incoming = transferData.filter(r => r.type === 'incoming');
  const curSem = currentSemesterPrefix();
  const gradCount = casesData.filter(c => {
    if (c.deleted || c.archived) return false;
    const gs = _computeGradStatus(c, curSem);
    return gs && gs.isRelevant;
  }).length;
  const unassignedCount = transferData.filter(r => r.type === 'graduation' && !r.caseId).length;
  const withdrawList = transferData.filter(r => r.type === 'withdraw' && r.semester === curSem);
  const withdrawAll  = transferData.filter(r => r.type === 'withdraw');
  const tabBtn = (id, label, count, warn) =>
    `<button onclick="window._transferTab='${id}';try{localStorage.setItem('scc_trTab_'+DRIVE_FOLDER_ID,'${id}');}catch(_){}window._transferStatusFilter='all';renderTransferPage()" style="padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-size:.9rem;font-weight:${tab===id?'700':'400'};background:${tab===id?'#3498db':(warn&&count>0?'#fff7ed':'#f0f4f8')};color:${tab===id?'#fff':(warn&&count>0?'#9c4221':'#4a5568')};${warn&&count>0?'border:1px solid #fb923c;':''}">${label}（${count}）</button>`;
  const importInBtn  = `<label style="cursor:pointer;"><input type="file" accept=".xlsx,.xlsm,.xls" style="display:none" onchange="handleImportTransferExcel(this,'incoming')"><span class="btn btn-secondary btn-sm">📥 匯入轉入名單</span></label>`;
  const dlTemplateBtn = `<button class="btn btn-secondary btn-sm" onclick="downloadTransferImportTemplate()" data-tip="下載轉入名單 Excel 範例檔，填寫後即可批次匯入。">📄 下載範例</button>`;
  const addInBtn  = `<button class="btn btn-primary btn-sm" onclick="openTransferAssessmentModal(null,'incoming')">＋ 手動新增</button>`;

  // ── 轉入個案的開案狀態篩選 ──
  const sfBtn = (f, label) =>
    `<button onclick="window._transferStatusFilter='${f}';renderTransferPage()" style="padding:5px 14px;border:1px solid ${tsf===f?'#3498db':'#cbd5e0'};border-radius:6px;cursor:pointer;font-size:.82rem;font-weight:${tsf===f?'700':'400'};background:${tsf===f?'#ebf8ff':'#f7fafc'};color:${tsf===f?'#2b6cb0':'#4a5568'};">${label}</button>`;
  const statusFilterBar = tab === 'incoming'
    ? `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">${sfBtn('all','全部')}${sfBtn('active','開案中')}${sfBtn('closed','已結案')}</div>`
    : '';

  let list = incoming;
  if (tsf !== 'all') {
    list = list.filter(r => {
      const lc = r.caseId ? casesData.find(c => c.id === r.caseId) : null;
      if (!lc) return tsf === 'active';
      const semStatuses = Object.values(lc.semesterStatus || {});
      const hasActive = semStatuses.length === 0 ? lc.status !== 'closed' : semStatuses.some(s => s !== 'closed');
      return tsf === 'active' ? hasActive : !hasActive;
    });
  }

  const listHtml = list.length === 0
    ? `<div class="empty-state"><div class="icon">🔄</div><p>尚無轉入學生</p></div>`
    : list.map(_renderTransferRow).join('');
  const actionBar = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">${importInBtn}${dlTemplateBtn}${addInBtn}</div>`;
  const gradContent = tab === 'graduation' ? _renderGradTransferTab() : '';
  const unassignedContent = tab === 'unassigned' ? _renderUnassignedTab() : '';
  const withdrawContent = tab === 'withdraw' ? _renderWithdrawTab(withdrawAll) : '';
  document.getElementById('transfer-body').innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;">
      ${tabBtn('withdraw','教務處轉/退學名單',withdrawList.length)}
      ${tabBtn('graduation','本學期預作畢業',gradCount)}
      ${tabBtn('incoming','轉入學生',incoming.length)}
      ${tabBtn('unassigned','未歸屬校級評估',unassignedCount,true)}
    </div>
    ${tab === 'withdraw'
      ? withdrawContent
      : tab === 'graduation'
        ? gradContent
        : tab === 'unassigned'
          ? unassignedContent
          : actionBar + statusFilterBar + `<div>${listHtml}</div>`}`;
}

// ── 教務處轉/退學名單分頁（全功能，對齊預作畢業）──
function _renderWithdrawTab(allWithdraw) {
  const curSem = currentSemesterPrefix();
  if (!window._withdrawFilters) {
    const _def = () => ({ semester: curSem, counselor: currentUser?.email || '', decision: 'all', filled: 'all', showResolved: false, search: '' });
    try {
      const saved = localStorage.getItem('scc_wdf_' + DRIVE_FOLDER_ID);
      window._withdrawFilters = saved ? { ..._def(), ...JSON.parse(saved) } : _def();
    } catch(_) { window._withdrawFilters = _def(); }
  }
  if (window._withdrawFilters.semester === undefined) window._withdrawFilters.semester = curSem;
  const F = window._withdrawFilters;
  const semToUse = (F.semester && F.semester !== 'all') ? F.semester : curSem;

  const semOpts = [...new Set(allWithdraw.filter(r => r.semester).map(r => r.semester))].sort().reverse();

  const getLinkedCase = r => _getLinkedCaseForWithdraw(r);
  const getWdDecStatus = r => _getWdDecision(r, semToUse);

  let records = allWithdraw.filter(r => r.semester === semToUse && !r.deleted);
  const deletedCount = allWithdraw.filter(r => r.semester === semToUse && r.deleted).length;
  const total = records.length;
  const withEval = records.filter(r => { const lc = getLinkedCase(r); return lc && _hasCaseTransferEval(lc.id, semToUse); }).length;
  const withDec  = records.filter(r => getWdDecStatus(r) !== 'pending').length;

  if (F.decision === 'resolved') {
    records = records.filter(r => getWdDecStatus(r) !== 'pending');
  } else {
    if (!F.showResolved) records = records.filter(r => getWdDecStatus(r) === 'pending');
    if (F.decision !== 'all') records = records.filter(r => getWdDecStatus(r) === F.decision);
  }
  if (F.counselor) records = records.filter(r => { const lc = getLinkedCase(r); return lc && (lc.counselorEmail === F.counselor || lc.counselorName === F.counselor); });
  if (F.filled !== 'all') records = records.filter(r => { const lc = getLinkedCase(r); const has = lc ? _hasCaseTransferEval(lc.id, semToUse) : false; return F.filled === 'yes' ? has : !has; });
  if (F.search) { const q = F.search.toLowerCase(); records = records.filter(r => (r.name||'').toLowerCase().includes(q) || (r.studentId||'').toLowerCase().includes(q) || (getLinkedCase(r)?.id||'').toLowerCase().includes(q)); }

  const today = new Date().toISOString().slice(0, 10);

  const statsBar = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
    <span style="background:#f0f4f8;border-radius:8px;padding:6px 14px;font-size:.85rem;">共 <strong>${total}</strong> 位</span>
    <span style="background:#f0fff4;border-radius:8px;padding:6px 14px;font-size:.85rem;">已填評估：<strong>${withEval}</strong></span>
    <span style="background:#faf5ff;border-radius:8px;padding:6px 14px;font-size:.85rem;">已有決議：<strong>${withDec}</strong></span>
    ${deletedCount > 0 ? `<span style="background:#fff5f5;border-radius:8px;padding:6px 14px;font-size:.85rem;color:#c53030;">已刪除：<strong>${deletedCount}</strong></span>` : ''}
    <span style="background:#ebf8ff;border-radius:8px;padding:6px 14px;font-size:.85rem;">篩選顯示：<strong>${records.length}</strong></span>
  </div>`;

  const filterBar = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:.82rem;color:#718096;font-weight:600;flex-shrink:0;">篩選：</span>
    <select id="wd-filter-semester" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_withdrawFilterChange()">
      <option value="all"${F.semester==='all'?' selected':''}>全部學期</option>
      ${semOpts.map(s => `<option value="${escHtml(s)}"${F.semester===s?' selected':''}>${escHtml(semesterLabel(s))}</option>`).join('')}
    </select>
    <select id="wd-filter-counselor" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_withdrawFilterChange()">
      ${buildCounselorFilterOpts(F.counselor, true, '全部主責')}
    </select>
    <select id="wd-filter-decision" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_withdrawFilterChange()">
      <option value="all"${F.decision==='all'?' selected':''}>全部決議</option>
      <option value="pending"${F.decision==='pending'?' selected':''}>待決議</option>
      <option value="resolved"${F.decision==='resolved'?' selected':''}>已決議（全部）</option>
      <option value="noTransfer_self"${F.decision==='noTransfer_self'?' selected':''}>主責不需轉銜</option>
      <option value="noTransfer_self_reason"${F.decision==='noTransfer_self_reason'?' selected':''}>主責不轉銜（原因）</option>
      <option value="transfer_school"${F.decision==='transfer_school'?' selected':''}>校級建議轉銜</option>
      <option value="noTransfer_school"${F.decision==='noTransfer_school'?' selected':''}>校級不需轉銜</option>
      <option value="stay"${F.decision==='stay'?' selected':''}>本學期不離校</option>
      <option value="b_case"${F.decision==='b_case'?' selected':''}>B案</option>
      <option value="one_time_consult"${F.decision==='one_time_consult'?' selected':''}>一次性諮詢</option>
      <option value="untraceable"${F.decision==='untraceable'?' selected':''}>年久不可考</option>
    </select>
    <select id="wd-filter-filled" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_withdrawFilterChange()">
      <option value="all"${F.filled==='all'?' selected':''}>全部評估表</option>
      <option value="yes"${F.filled==='yes'?' selected':''}>已填寫</option>
      <option value="no"${F.filled==='no'?' selected':''}>未填寫</option>
    </select>
    <label style="display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer;flex-shrink:0;white-space:nowrap;margin-left:4px;">
      <input type="checkbox" id="wd-filter-showresolved" ${F.showResolved?'checked':''} onchange="_withdrawFilterChange()">
      顯示已決議
    </label>
    <input id="wd-filter-search" type="text" placeholder="搜尋學號／姓名／案號…" value="${escHtml(F.search||'')}"
      style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;min-width:160px;"
      oninput="if(!_wdSearchComposing)_withdrawFilterSearchDebounce()"
      oncompositionstart="_wdSearchComposing=true"
      oncompositionend="_wdSearchComposing=false;_withdrawFilterChange()">
    <button onclick="_withdrawFilterClear()" style="padding:4px 10px;font-size:.82rem;border:1px solid #cbd5e0;border-radius:4px;background:#fff;color:#4a5568;cursor:pointer;white-space:nowrap;flex-shrink:0;">清除篩選</button>
  </div>`;

  const actionBar = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
    <label style="cursor:pointer;"><input type="file" accept=".xlsx,.xlsm,.xls" style="display:none" onchange="handleImportWithdrawExcel(this)"><span class="btn btn-secondary btn-sm">📥 匯入名單 (Excel)</span></label>
    <button class="btn btn-secondary btn-sm" onclick="downloadWithdrawTemplate()">📄 下載範本</button>
    <button class="btn btn-primary btn-sm" onclick="_openWithdrawManualAdd()">＋ 手動新增</button>
    ${allWithdraw.filter(r => r.semester === semToUse).length > 0 ? `<button class="btn btn-danger btn-sm" onclick="_clearWithdrawList('${escHtml(semToUse)}')" data-tip="清空本學期名單（測試用）">🗑 清空名單</button>` : ''}
  </div>`;

  const batchBar = `<div style="background:#f0f8ff;border:1px solid #bee3f8;border-radius:8px;padding:9px 14px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input type="checkbox" id="wd-select-all" onchange="_withdrawToggleAll(this.checked)" title="全選/取消全選" style="flex-shrink:0;">
    <span style="font-size:.82rem;color:#2b6cb0;font-weight:600;">批次套用：</span>
    <select id="wd-batch-status" style="padding:4px 8px;font-size:.82rem;border:1px solid #bee3f8;border-radius:4px;background:#fff;">
      <option value="">選擇決議</option>
      <option value="noTransfer_self">主責評估綠燈不轉銜</option>
      <option value="noTransfer_self_reason">主責評估不轉銜（原因自填）</option>
      <option value="transfer_school">校級建議轉銜</option>
      <option value="noTransfer_school">校級建議不需轉銜</option>
      <option value="stay">本學期不離校</option>
      <option value="b_case">B案（無須評估）</option>
      <option value="one_time_consult">一次性諮詢不予討論</option>
      <option value="untraceable">年久不可考</option>
    </select>
    <input type="date" id="wd-batch-date" value="${today}" title="校級評估會議日期" style="padding:4px 8px;font-size:.82rem;border:1px solid #bee3f8;border-radius:4px;">
    <button class="btn btn-primary btn-sm" onclick="_applyWithdrawBatch('${semToUse}')">套用至已勾選</button>
    <span id="wd-batch-info" style="font-size:.82rem;color:#2b6cb0;"></span>
  </div>`;

  if (total === 0) {
    const emptySemSelect = semOpts.length ? `<div style="margin-top:16px;"><select style="padding:5px 10px;font-size:.85rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="window._withdrawFilters.semester=this.value;document.getElementById('transfer-body').innerHTML=_renderWithdrawTab(transferData.filter(r=>r.type==='withdraw'))"><option value="all"${F.semester==='all'?' selected':''}>全部學期</option>${semOpts.map(s=>`<option value="${escHtml(s)}"${F.semester===s?' selected':''}>${escHtml(semesterLabel(s))}</option>`).join('')}</select></div>` : '';
    return actionBar + `<div class="empty-state"><div class="icon">📋</div><p>本學期尚無教務處轉/退學名單</p>${emptySemSelect}</div>`;
  }

  const rows = records.map(r => {
    const lc = getLinkedCase(r);
    const gradDec = lc ? _getGradTransferDecision(lc.id, semToUse) : null;
    const decStatus = gradDec?.status || r.decision || 'pending';
    const meetingDate = gradDec?.schoolMeetingDate || r.schoolMeetingDate || '';
    const noTransferReason = gradDec?.noTransferReason || r.noTransferReason || '';
    const isResolved = decStatus !== 'pending';
    const hasTE = lc ? _hasCaseTransferEval(lc.id, semToUse) : false;

    const linkedBadge = lc
      ? `<span style="font-size:.73rem;background:#ebf8ff;color:#2b6cb0;border-radius:8px;padding:1px 7px;border:1px solid #bee3f8;">已連結個案</span>`
      : `<span style="font-size:.73rem;background:#faf5ff;color:#553c9a;border-radius:8px;padding:1px 7px;border:1px solid #d6bcfa;">無個案</span>`;
    const _wdGs = lc ? _computeGradStatus(lc, semToUse) : null;
    const gradBadge = _wdGs?.isRelevant
      ? (_wdGs.isOverdue
          ? `<span class="grad-badge grad-overdue" style="font-size:.7rem;">${escHtml(_wdGs.degreeName)}${_wdGs.yearsAttended}年，延畢中</span>`
          : `<span class="grad-badge grad-near" style="font-size:.7rem;">預作畢業</span>`)
      : '';
    const resolvedBadge = isResolved ? `<span style="font-size:.72rem;background:#d5f5e3;color:#1d6a3a;border-radius:8px;padding:1px 7px;border:1px solid #9ae6b4;font-weight:600;">已決議</span>` : '';
    const teBadge = lc
      ? (hasTE
        ? `<span style="font-size:.73rem;background:#d5f5e3;color:#1d6a3a;border-radius:8px;padding:1px 7px;border:1px solid #9ae6b4;">已填評估</span>`
        : `<span style="font-size:.73rem;background:#fde8e8;color:#c0392b;border-radius:8px;padding:1px 7px;border:1px solid #fc8181;">未填評估</span>`)
      : '';
    const decStyle = `font-size:.73rem;padding:2px 8px;border-radius:10px;background:${_TRANSFER_DEC_BG[decStatus]||'#f0f4f8'};color:${_TRANSFER_DEC_COLOR[decStatus]||'#718096'};border:1px solid ${_TRANSFER_DEC_COLOR[decStatus]||'#cbd5e0'};`;
    const schoolDateDisplay = meetingDate ? `<span style="font-size:.75rem;color:#718096;">校級會議：${escHtml(meetingDate)}</span>` : '';
    const reasonDisplay = decStatus === 'noTransfer_self_reason' && noTransferReason ? `<span style="font-size:.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;border-radius:6px;padding:1px 6px;">原因：${escHtml(noTransferReason)}</span>` : '';
    const counselorInfo = lc && (lc.counselorName || lc.counselorEmail) ? `<span style="font-size:.78rem;color:#718096;">主責：${escHtml(lc.counselorName || configData?.users?.[lc.counselorEmail]?.name || lc.counselorEmail)}${_counselorStatusBadge(lc.counselorEmail)}</span>` : '';

    const drChip = r.departureReason ? `<span style="font-size:.76rem;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fbbf24;">${escHtml(r.departureReason)}</span>` : '';
    const isExpanded = window._withdrawCardExpanded?.has(r.id) || false;
    const semMap = _buildCaseSemMap(r.studentId);
    const sourceChip = _buildSourceChip(r.studentId);
    const histBadgesHtml = _buildHistBadgesHtml(semMap, curSem, isExpanded, r.id, '_withdraw');
    // 決議/日期 onchange：有連結個案時寫入共用畢業轉銜記錄，否則寫入 withdraw 記錄
    const lcId = lc ? escHtml(lc.id) : '';
    const decOnchange = lc
      ? `setWithdrawDecision('${escHtml(r.id)}',this.value,'${lcId}','${semToUse}')`
      : `setWithdrawDecision('${escHtml(r.id)}',this.value)`;
    const dateOnchange = lc
      ? `setWithdrawMeetingDate('${escHtml(r.id)}',this.value,'${lcId}','${semToUse}')`
      : `setWithdrawMeetingDate('${escHtml(r.id)}',this.value)`;

    return `<div class="record-card" style="margin-bottom:8px;${isResolved?'border-left:3px solid '+(_TRANSFER_DEC_COLOR[decStatus]||'#718096')+';opacity:.88;':''}">
      <div class="record-card-header" style="flex-wrap:wrap;gap:6px;">
        <input type="checkbox" class="wd-cb" data-rid="${escHtml(r.id)}" onchange="_withdrawCbChange()" style="margin-top:3px;flex-shrink:0;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1;">
          <strong>${escHtml(r.name||'—')}</strong>
          <span style="color:#718096;font-size:.82rem;">${escHtml(r.studentId||'—')}</span>
          ${linkedBadge}${gradBadge}${resolvedBadge}${teBadge}
          <span style="${decStyle}">${_TRANSFER_DEC_LABEL[decStatus]||'待決議'}</span>
          ${reasonDisplay}${drChip}${counselorInfo}${schoolDateDisplay}${sourceChip}
        </div>
        <div style="display:flex;flex-direction:row;align-items:flex-start;gap:8px;">
          <div style="display:flex;flex-direction:column;align-items:flex-start;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              ${lc ? `<button class="btn btn-secondary btn-sm" onclick="showCaseDetail('${escHtml(lc.id)}')">查看個案</button>` : ''}
              ${lc ? (hasTE
                ? `<button class="btn btn-secondary btn-sm" onclick="showCaseDetail('${escHtml(lc.id)}');setTimeout(()=>openTransferEvalForm('${escHtml(lc.id)}',_getLatestTeId('${escHtml(lc.id)}','${semToUse}')),500)">編輯評估</button>`
                : `<button class="btn btn-primary btn-sm" onclick="showCaseDetail('${escHtml(lc.id)}');setTimeout(()=>openTransferEvalForm('${escHtml(lc.id)}',null),500)">填寫評估</button>`) : ''}
            </div>
            ${hasTE && lc ? _teSummaryHtml(lc.id, semToUse) : ''}
          </div>
          <div style="display:flex;flex-direction:row;align-items:center;gap:4px;flex-wrap:wrap;">
            <select class="field-input" id="wd-sel-${escHtml(r.id)}" style="padding:4px 8px;font-size:.82rem;width:auto;max-width:170px;" onchange="${decOnchange}">
              <option value="">設定決議▼</option>
              <option value="noTransfer_self"${decStatus==='noTransfer_self'?' selected':''}>主責評估綠燈不轉銜</option>
              <option value="noTransfer_self_reason"${decStatus==='noTransfer_self_reason'?' selected':''}>主責評估不轉銜（原因自填）</option>
              <option value="transfer_school"${decStatus==='transfer_school'?' selected':''}>校級建議轉銜</option>
              <option value="noTransfer_school"${decStatus==='noTransfer_school'?' selected':''}>校級建議不需轉銜</option>
              <option value="stay"${decStatus==='stay'?' selected':''}>本學期不離校</option>
              <option value="b_case"${decStatus==='b_case'?' selected':''}>B案（無須評估）</option>
              <option value="one_time_consult"${decStatus==='one_time_consult'?' selected':''}>一次性諮詢不予討論</option>
              <option value="untraceable"${decStatus==='untraceable'?' selected':''}>年久不可考</option>
            </select>
            <input type="date" id="wd-date-${escHtml(r.id)}" value="${escHtml(meetingDate)}" title="校級評估會議日期" style="padding:4px;font-size:.8rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="${dateOnchange}">
            <div style="position:relative;display:inline-block;" class="assessor-change-wrap">
              <button class="btn btn-sm" style="padding:3px 8px;font-size:.78rem;" data-tip="改變評估者（目前：${escHtml(lc ? (lc.counselorName||lc.counselorEmail||'未指定') : '未指定')}）" onclick="_toggleAssessorPopover(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><polyline points="20 8 23 11 20 14"/></svg></button>
              <div class="assessor-popover" style="display:none;position:absolute;z-index:500;background:#fff;border:1px solid #cbd5e0;border-radius:8px;padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.15);min-width:200px;top:calc(100% + 4px);right:0;">
                <div style="font-size:.8rem;color:#4a5568;font-weight:600;margin-bottom:6px;">改變評估者</div>
                <select class="field-input" style="padding:4px 8px;font-size:.82rem;width:100%;" onchange="if(this.value)window._showAssessorChangeConfirm('withdraw','${escHtml(r.id)}','${lcId}',this.value,this)">
                  <option value="">請選擇…</option>
                  ${buildCounselorOptgroups()}
                </select>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="_deleteWithdrawRecord('${escHtml(r.id)}')">刪除</button>
          </div>
        </div>
      </div>
      ${histBadgesHtml}
      ${_buildSchoolMeetingHistHtml(r)}
    </div>`;
  }).join('');

  const emptyMsg = !records.length
    ? `<div style="text-align:center;padding:24px;color:#a0aec0;font-size:.9rem;">無符合條件的記錄${!F.showResolved && withDec > 0 ? `（${withDec} 位已決議已隱藏，可勾選「顯示已決議」）` : ''}</div>`
    : '';

  const deletedRecs = allWithdraw.filter(r => r.semester === semToUse && r.deleted);
  const myEmail = currentUser?.email;
  const isAdmin = currentUser && (configData?.users?.[myEmail]?.isAdmin || configData?.users?.[myEmail]?.extraRole === '管理者' || configData?.users?.[myEmail]?.role === '主任');
  // 管理者看全部；一般使用者只看自己主責個案被刪的
  const visibleDeleted = isAdmin ? deletedRecs : deletedRecs.filter(r => { const lc = getLinkedCase(r); return lc && lc.counselorEmail === myEmail; });
  const deletedSection = visibleDeleted.length > 0 ? (() => {
    const noteText = isAdmin ? '管理者可見全部・30天後自動清除' : '顯示您的主責個案・30天後自動清除';
    const dRows = visibleDeleted.map(r => {
      const lc = getLinkedCase(r);
      const dDays = r.deletedAt ? Math.ceil((Date.now() - new Date(r.deletedAt).getTime()) / 86400000) : 0;
      const remainDays = Math.max(0, 30 - dDays);
      return `<tr>
        <td style="padding:7px 10px;">${escHtml(r.name||'—')}</td>
        <td style="padding:7px 10px;color:#718096;">${escHtml(r.studentId||'—')}</td>
        <td style="padding:7px 10px;color:#718096;">${lc ? `<a href="#" onclick="showCaseDetail('${escHtml(lc.id)}');return false;" style="color:#3182ce;">${escHtml(lc.id)}</a>` : '—'}</td>
        <td style="padding:7px 10px;color:#718096;">${escHtml(r.deletedByName||r.deletedBy||'—')}</td>
        <td style="padding:7px 10px;color:#718096;">${r.deletedAt ? r.deletedAt.slice(0,10) : '—'}</td>
        <td style="padding:7px 10px;color:${remainDays<=7?'#c53030':'#718096'};">${remainDays} 天</td>
        <td style="padding:7px 10px;">
          <button class="btn btn-secondary btn-sm" onclick="rbRestoreTransfer('${escHtml(r.id)}')">復原</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="rbPurgeTransfer('${escHtml(r.id)}')">永久刪除${adminOnlyChip(false, true)}</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    return `<details style="margin-bottom:14px;border:1px solid #fed7d7;border-radius:8px;overflow:hidden;">
      <summary style="padding:10px 14px;background:#fff5f5;color:#c53030;font-weight:600;cursor:pointer;font-size:.88rem;list-style:none;display:flex;align-items:center;gap:6px;">
        ▶ 已刪除記錄（${visibleDeleted.length}）<span style="font-size:.78rem;font-weight:400;color:#a0aec0;">— ${noteText}</span>
      </summary>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          <thead><tr style="background:#fff5f5;color:#c53030;">
            <th style="padding:7px 10px;text-align:left;font-weight:600;">姓名</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">學號</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">個案</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">刪除者</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">刪除日期</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">剩餘天數</th>
            <th style="padding:7px 10px;text-align:left;font-weight:600;">操作</th>
          </tr></thead>
          <tbody>${dRows}</tbody>
        </table>
      </div>
    </details>`;
  })() : '';

  return filterBar + actionBar + `<div id="wd-results-body">${statsBar}${batchBar}${deletedSection}${rows || emptyMsg}</div>`;
}

function _openWithdrawManualAdd() {
  const el = document.getElementById('wd-manual-add-area') || (() => {
    const d = document.createElement('div'); d.id = 'wd-manual-add-area';
    document.getElementById('wd-results-body')?.prepend(d) || document.getElementById('transfer-body')?.prepend(d);
    return d;
  })();
  el.innerHTML = `<div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <input id="wd-add-name" type="text" placeholder="姓名" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;width:120px;">
    <input id="wd-add-sid"  type="text" placeholder="學號" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.88rem;width:140px;">
    <button class="btn btn-primary btn-sm" onclick="_confirmWithdrawManualAdd()">新增</button>
    <button class="btn btn-secondary btn-sm" onclick="document.getElementById('wd-manual-add-area').innerHTML=''">取消</button>
  </div>`;
  document.getElementById('wd-add-name').focus();
}

function _confirmWithdrawManualAdd() {
  const name = (document.getElementById('wd-add-name')?.value || '').trim();
  const studentId = (document.getElementById('wd-add-sid')?.value || '').trim();
  if (!name && !studentId) { alert('請至少填寫姓名或學號'); return; }
  const curSem = currentSemesterPrefix();
  const now = new Date().toISOString();
  transferData.push({ id: 'wd_' + Date.now() + '_' + Math.random().toString(36).slice(2), type: 'withdraw', name, studentId, semester: curSem, createdAt: now, createdBy: currentUser?.email, createdByName: currentUser?.name });
  renderTransferPage();
  const jobId = bgJobAdd(`新增教務處轉/退學名單：${name || studentId}`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('新增教務處轉/退學名單', null, null, `${name} ${studentId}`); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function _deleteWithdrawRecord(id) {
  const r = transferData.find(t => t.id === id);
  if (!r || !confirm(`確定刪除「${r.name || r.studentId}」？\n\n刪除後仍可由管理者還原。`)) return;
  r.deleted = true;
  r.deletedAt = new Date().toISOString();
  r.deletedBy = currentUser?.email;
  r.deletedByName = configData?.users?.[currentUser?.email]?.name || currentUser?.name;
  renderTransferPage();
  const jobId = bgJobAdd(`刪除教務處轉/退學名單：${r.name || r.studentId}`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('刪除教務處轉/退學名單', null, null, `${r.name} ${r.studentId}`); } catch(e) {
    delete r.deleted; delete r.deletedAt; delete r.deletedBy; delete r.deletedByName;
    bgJobFail(jobId, e.message);
  } })();
}

function _clearWithdrawList(sem) {
  const s = sem || currentSemesterPrefix();
  const count = transferData.filter(t => t.type === 'withdraw' && t.semester === s).length;
  if (!confirm(`確定清空本學期教務處轉/退學名單（共 ${count} 筆）？`)) return;
  transferData = transferData.filter(t => !(t.type === 'withdraw' && t.semester === s));
  renderTransferPage();
  const jobId = bgJobAdd(`清空教務處轉/退學名單（${count}筆）`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('清空教務處轉/退學名單', null, null, `${count}筆`); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function setWithdrawDecision(recordId, status, lcId, sem) {
  if (!status) return;
  const r = transferData.find(t => t.id === recordId);
  if (!r) return;
  if (lcId) {
    const sel = document.getElementById('wd-sel-' + recordId);
    const _autoFillGradDate = () => {
      const gradEx = _getGradTransferDecision(lcId, sem);
      if (gradEx && !gradEx.schoolMeetingDate) gradEx.schoolMeetingDate = new Date().toISOString().slice(0, 10);
    };
    if (status === 'noTransfer_self_reason') {
      const curReason = _getGradTransferDecision(lcId, sem)?.noTransferReason || '';
      _showGradReasonPanel(sel, curReason, reason => {
        if (reason === null) { if (sel) sel.value = _getGradTransferDecision(lcId, sem)?.status || r.decision || ''; return; }
        _saveGradTransferDecision(lcId, sem, status, reason);
        _autoFillGradDate();
        _withdrawRefreshInPlace();
      });
      return;
    }
    _saveGradTransferDecision(lcId, sem, status, null);
    _autoFillGradDate();
    _withdrawRefreshInPlace();
    return;
  }
  if (status === 'noTransfer_self_reason') {
    const sel = document.getElementById('wd-sel-' + recordId);
    const curReason = r.noTransferReason || '';
    _showGradReasonPanel(sel, curReason, reason => {
      if (reason === null) { if (sel) sel.value = r.decision || ''; return; }
      r.decision = status; r.noTransferReason = reason; r.updatedAt = new Date().toISOString();
      if (!r.schoolMeetingDate) r.schoolMeetingDate = new Date().toISOString().slice(0, 10);
      _withdrawRefreshInPlace();
      const jobId = bgJobAdd(`設定轉/退學決議：${r.name}`);
      (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
    });
    return;
  }
  r.decision = status; r.updatedAt = new Date().toISOString();
  if (!r.schoolMeetingDate) r.schoolMeetingDate = new Date().toISOString().slice(0, 10);
  if (r.noTransferReason && status !== 'noTransfer_self_reason') delete r.noTransferReason;
  _withdrawRefreshInPlace();
  const jobId = bgJobAdd(`設定轉/退學決議：${r.name}`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function setWithdrawMeetingDate(recordId, date, lcId, sem) {
  const r = transferData.find(t => t.id === recordId);
  if (!r) return;
  if (lcId) {
    const ex = _getGradTransferDecision(lcId, sem);
    if (ex) {
      ex.schoolMeetingDate = date; ex.updatedAt = new Date().toISOString(); ex.updatedBy = currentUser?.email;
      const jobId = bgJobAdd(`更新轉/退學會議日期：${r.name}`);
      (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
      return;
    }
  }
  r.schoolMeetingDate = date; r.updatedAt = new Date().toISOString();
  const jobId = bgJobAdd(`更新轉/退學會議日期：${r.name}`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); } })();
}

function _withdrawRefreshInPlace() {
  const _gr = document.getElementById('wd-results-body');
  const all = transferData.filter(r => r.type === 'withdraw');
  if (_gr) {
    const _t = document.createElement('div');
    _t.innerHTML = _renderWithdrawTab(all);
    const _rb = _t.querySelector('#wd-results-body');
    _gr.innerHTML = _rb ? _rb.innerHTML : _t.innerHTML;
  } else {
    document.getElementById('transfer-body').innerHTML = _renderWithdrawTab(all);
  }
}

function _withdrawToggleAll(checked) {
  document.querySelectorAll('.wd-cb').forEach(cb => { cb.checked = checked; });
  _withdrawCbChange();
}

function _withdrawCbChange() {
  const cbs = document.querySelectorAll('.wd-cb');
  const checked = document.querySelectorAll('.wd-cb:checked').length;
  const allCb = document.getElementById('wd-select-all');
  if (allCb) { allCb.checked = checked === cbs.length && cbs.length > 0; allCb.indeterminate = checked > 0 && checked < cbs.length; }
  const info = document.getElementById('wd-batch-info');
  if (info) info.textContent = checked > 0 ? `已選 ${checked} 位` : '';
}

function _applyWithdrawBatch(sem) {
  const status = document.getElementById('wd-batch-status')?.value;
  const date   = document.getElementById('wd-batch-date')?.value;
  if (!status && !date) { alert('請選擇決議或填入校級評估會議日期'); return; }
  const checkedRids = [...document.querySelectorAll('.wd-cb:checked')].map(cb => cb.dataset.rid);
  if (!checkedRids.length) { alert('請先勾選要套用的學生'); return; }
  const now = new Date().toISOString();
  checkedRids.forEach(rid => {
    const r = transferData.find(t => t.id === rid);
    if (!r) return;
    const lc = sem ? casesData.filter(c => c.studentId === r.studentId && !c.deleted).sort((a,b) => (b.openDate||'').localeCompare(a.openDate||''))[0] : null;
    if (lc) {
      const ex = _getGradTransferDecision(lc.id, sem);
      if (ex) {
        if (status) ex.status = status;
        if (date) ex.schoolMeetingDate = date;
        ex.updatedAt = now; ex.updatedBy = currentUser?.email;
      } else if (status) {
        transferData.push({ id:`gr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          type:'graduation', caseId:lc.id, semester:sem, status,
          schoolMeetingDate:date||'', createdAt:now, createdBy:currentUser?.email });
      }
    } else {
      if (status) r.decision = status;
      if (date) r.schoolMeetingDate = date;
      r.updatedAt = now;
    }
  });
  _withdrawRefreshInPlace();
  const jobId = bgJobAdd(`批次套用轉/退學決議（${checkedRids.length}筆）`);
  (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('批次設定轉/退學決議', null, null, `${checkedRids.length}筆`); } catch(e) { bgJobFail(jobId, e.message); } })();
}
