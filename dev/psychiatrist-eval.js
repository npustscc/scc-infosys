// dev/psychiatrist-eval.js — 精神科醫師評估模組（拆 index.html 絞殺者第二十三刀，v270）。
// 內容為從 index.html 逐字搬出的連續區段（評估表單開啟/儲存/列印/刪除與列表渲染）。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告；dev-banner
// HTML 為 template literal 內容。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  精神科醫師評估
// ══════════════════════════════════════════════
let _psyDraftKey  = null;
let _psyDraftTimer = null;

function snapshotPsyDraft() {
  const gV = id => document.getElementById(id)?.value?.trim() || '';
  const gR = n  => document.querySelector(`[name="${n}"]:checked`)?.value || '';
  return {
    _savedAt: new Date().toISOString(),
    name:gV('pr-name'), gender:gV('pr-gender'), dept:gV('pr-dept'), sid:gV('pr-sid'),
    date:gV('pr-date'), period:gV('pr-period'), start:gV('pr-start'), end:gV('pr-end'),
    main:getRichTextValue('pr-main'), core:getRichTextValue('pr-core'),
    interv:getRichTextValue('pr-interv'), rec:getRichTextValue('pr-rec'),
    diagType:gR('pr_diag'), diagName:gV('pr-diag-name'),
    med:gR('pr_med'), hosp:gR('pr_hosp'), notes:getRichTextValue('pr-notes'),
  };
}

function psyRestoreDraft(d) {
  const sV = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const sR = (n, v) => { if (!v) return; const el = document.querySelector(`[name="${n}"][value="${CSS.escape(v)}"]`); if (el) el.checked = true; };
  sV('pr-name',d.name); sV('pr-gender',d.gender); sV('pr-dept',d.dept); sV('pr-sid',d.sid);
  sV('pr-date',d.date); sV('pr-period',d.period); sV('pr-start',d.start); sV('pr-end',d.end);
  if (d.main != null) setRichTextValue('pr-main', d.main);
  if (d.core != null) setRichTextValue('pr-core', d.core);
  if (d.interv != null) setRichTextValue('pr-interv', d.interv);
  if (d.rec != null) setRichTextValue('pr-rec', d.rec);
  sV('pr-diag-name',d.diagName); if (d.notes != null) setRichTextValue('pr-notes', d.notes);
  if (d.diagType) { sR('pr_diag', d.diagType); const row = document.getElementById('pr-diag-row'); if (row) row.style.display = d.diagType === 'specific' ? '' : 'none'; }
  if (d.med)  sR('pr_med',  d.med);
  if (d.hosp) sR('pr_hosp', d.hosp);
  if (d.period && typeof prFillPeriod === 'function') prFillPeriod();
}

function startPsyDraftAutosave() {
  stopPsyDraftAutosave();
  if (!_psyDraftKey) return;
  _psyDraftTimer = setInterval(() => {
    try {
      if (!document.getElementById('psychiatrist-modal')) { stopPsyDraftAutosave(); return; }
      const snap = snapshotPsyDraft();
      if (snap.main || snap.core || snap.interv || snap.rec)
        localStorage.setItem(_psyDraftKey, JSON.stringify(snap));
    } catch(e) { console.warn('psy draft autosave failed', e); }
  }, 5000);
}

function stopPsyDraftAutosave() {
  if (_psyDraftTimer) { clearInterval(_psyDraftTimer); _psyDraftTimer = null; }
}

function clearPsyDraft() {
  stopPsyDraftAutosave();
  if (_psyDraftKey) { try { localStorage.removeItem(_psyDraftKey); } catch(_) {} }
  _psyDraftKey = null;
}

async function renderPsychiatryPage() {
  const isAdminUser = currentRole === '主任' || extraRole === '管理者';
  const isPsychiatrist = currentRole === '駐校精神科醫師';
  const _me = currentUser?.email || '';
  const _allowedSet = new Set(configData?.users?.[_me]?.allowedCases || []);
  // 載入策略依角色分流（資料最小化）：
  //  主任/管理者 → 全量補載；精神科醫師 → 只補載「有精神科評估」的個案；其他 → 只補載自己可見的個案
  if (isAdminUser) {
    await _ensureAllFullyLoaded('精神科紀錄');
  } else if (isPsychiatrist) {
    const _idxHasFlag = (_casesIndexCache?.cases || []).some(c => 'hasPsyEval' in c);
    const _psyIds = casesData
      .filter(c => c?.id && c._indexOnly && !c._fullLoaded && (_idxHasFlag ? c.hasPsyEval : true))
      .map(c => c.id);
    if (_psyIds.length) {
      showLoading(`載入精神科評估資料（${_psyIds.length} 筆個案）…`);
      try { await _ensureFullCases(_psyIds); } finally { hideLoading(); }
    }
  } else {
    const _myIds = casesData
      .filter(c => c?.id && c._indexOnly && !c._fullLoaded && _caseVisibleToUser(c, _me, _allowedSet))
      .map(c => c.id);
    if (_myIds.length) { try { await _ensureFullCases(_myIds); } catch (_) {} }
  }
  const q    = (document.getElementById('psychiatry-q')?.value    || '').trim().toLowerCase();
  const diag = (document.getElementById('psychiatry-diag')?.value || '');
  const tag  = (document.getElementById('psychiatry-tag')?.value  || '');
  const from = (document.getElementById('psychiatry-from')?.value || '');
  const to   = (document.getElementById('psychiatry-to')?.value   || '');

  const archivedFilter = document.getElementById('psychiatry-archived')?.value ?? 'unarchived';
  const rows = [];
  for (const c of casesData) {
    if (c.deleted) continue;
    if (archivedFilter === 'unarchived' && c.archived) continue;
    if (archivedFilter === 'archived' && !c.archived) continue;
    // 可見性收斂：主任/管理者與精神科醫師可看全部評估；其他人僅能看自己主責/個管/初談個案的評估
    if (!isAdminUser && !isPsychiatrist && !_caseVisibleToUser(c, _me, _allowedSet)) continue;
    for (const pr of (c.psychiatristRecords || [])) {
      const isCreator = pr.createdBy === currentUser?.email;
      const isPrimary = c.counselorEmail === currentUser?.email;
      const canSeeDeleted = isAdminUser || isCreator || isPrimary;
      if (pr.deleted && !canSeeDeleted) continue;
      if (q && !c.name.toLowerCase().includes(q) && !(c.studentId||'').includes(q) &&
          !c.id.includes(q) && !(pr.diagnosisName||'').toLowerCase().includes(q) &&
          !(pr.recommendations||'').toLowerCase().includes(q)) continue;
      if (diag && pr.diagnosisType !== diag) continue;
      if (tag === 'medication'     && pr.medicationAdvice      !== 'yes') continue;
      if (tag === 'hospitalization' && pr.hospitalizationAdvice !== 'yes') continue;
      if (from && (pr.date||'') < from) continue;
      if (to   && (pr.date||'') > to)   continue;
      rows.push({ c, pr });
    }
  }
  rows.sort((a, b) => {
    if (a.pr.deleted !== b.pr.deleted) return a.pr.deleted ? 1 : -1;
    return (a.pr.date||'') < (b.pr.date||'') ? 1 : -1;
  });

  const body  = document.getElementById('psychiatry-body');
  const count = document.getElementById('psychiatry-count');
  if (!body) return;

  const hasFilter = q || diag || tag || from || to;
  if (count) {
    count.style.display = hasFilter ? '' : 'none';
    count.textContent = `篩選結果：${rows.length} 筆`;
  }

  if (rows.length === 0) {
    body.innerHTML = `<div style="padding:24px;text-align:center;color:#718096;">尚無精神科評估紀錄${hasFilter ? '（無符合結果）' : ''}</div>`;
    return;
  }

  body.innerHTML = rows.map(({ c, pr }) => {
    const diagLabel = pr.diagnosisType === 'specific' ? `符合：${escHtml(pr.diagnosisName||'—')}` : '不符合任一精神疾患診斷';
    const tags = [pr.medicationAdvice==='yes'?'建議藥物':'', pr.hospitalizationAdvice==='yes'?'建議住院':''].filter(Boolean);
    const isCreator  = pr.createdBy === currentUser?.email;
    const psyEditable = !pr.createdAt || isEditable(pr.createdAt);
    const isPending = pr.status === 'pending';
    // 精神科醫師檢視他人個案的評估：僅列表閱覽+列印，不提供編輯/刪除（自己建立的評估不在此限）
    const _psyReadOnlyRow = isPsychiatrist && !isAdminUser && !isCreator && !_caseVisibleToUser(c, _me, _allowedSet);

    let actionBtns = '';
    if (pr.deleted) {
      if (isAdminUser) {
        actionBtns = `<button class="btn btn-secondary btn-sm" onclick="restorePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}',renderPsychiatryPage)" style="font-size:.78rem;">復原</button>
        <button class="btn btn-danger btn-sm" onclick="purgePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}',renderPsychiatryPage)" style="font-size:.78rem;" title="徹底移除">徹底移除</button>`;
      }
    } else {
      if (!_psyReadOnlyRow)
        actionBtns = `<button class="btn btn-secondary btn-sm" onclick="openPsychiatristModal('${escHtml(c.id)}','${escHtml(pr.id)}')" style="font-size:.78rem;">編輯</button>`;
      if (!isPending)
        actionBtns += `<button class="btn btn-secondary btn-sm" onclick="printPsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')" style="font-size:.78rem;">列印</button>`;
      if (isAdminUser || (isCreator && psyEditable))
        actionBtns += `<button class="btn btn-danger btn-sm" onclick="deletePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}',renderPsychiatryPage)" style="font-size:.78rem;">刪除</button>`;
    }
    const deletedBadge = pr.deleted
      ? `<span style="background:#fed7d7;color:#c53030;padding:2px 8px;border-radius:10px;font-size:.75rem;white-space:nowrap;">已刪除 by ${escHtml(pr.deletedByName||pr.deletedBy||'—')}</span>`
      : isPending ? `<span style="background:#fefcbf;color:#744210;padding:2px 8px;border-radius:10px;font-size:.75rem;white-space:nowrap;">草稿</span>` : '';
    const rowOpacity = pr.deleted ? 'opacity:.45;' : '';
    const rowBg = isPending ? 'background:#fffff0;' : '';

    const _pf = _psyFillerInfo(pr);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;${rowOpacity}${rowBg}">
      <div style="min-width:90px;font-weight:600;color:#2d3748;font-size:.88rem;">${escHtml(pr.date||'草稿')}</div>
      <div style="flex:1;min-width:120px;">
        <div style="font-size:.9rem;color:#2d3748;font-weight:600;">${escHtml(c.name||'—')} <span style="color:#718096;font-weight:400;font-size:.78rem;">${escHtml(c.id)}</span></div>
        <div style="font-size:.82rem;color:#4a5568;">${isPending ? '（草稿未儲存）' : diagLabel}</div>
        <div style="font-size:.78rem;color:#718096;">${escHtml(_pf.label)}：${escHtml(_pf.display)}</div>
      </div>
      ${tags.length ? `<div style="display:flex;gap:4px;">${tags.map(t=>`<span style="background:#fed7d7;color:#c53030;padding:2px 8px;border-radius:10px;font-size:.75rem;">${t}</span>`).join('')}</div>` : ''}
      ${deletedBadge}
      <div style="display:flex;gap:6px;">${actionBtns}</div>
    </div>`;
  }).join('');
}

function resetPsychiatryFilters() {
  ['psychiatry-q','psychiatry-from','psychiatry-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['psychiatry-diag','psychiatry-tag'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const archEl = document.getElementById('psychiatry-archived');
  if (archEl) archEl.value = 'unarchived';
  renderPsychiatryPage();
}

function openPsychiatrySearch() {
  const el = document.getElementById('psych-nav-search-modal');
  if (el) el.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="psych-nav-search-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="font-size:1rem;">選擇個案以新增精神科評估</h3>
          <button onclick="document.getElementById('psych-nav-search-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#718096;">&times;</button>
        </div>
        <input type="text" id="psych-nav-q" class="field-input" placeholder="輸入姓名、學號或案號…" oninput="_renderPsychNavResults()">
        <div id="psych-nav-results" style="margin-top:10px;max-height:300px;overflow-y:auto;"></div>
      </div>
    </div>`);
  document.getElementById('psych-nav-q')?.focus();
  _renderPsychNavResults();
}

function _renderPsychNavResults() {
  const q = (document.getElementById('psych-nav-q')?.value || '').trim().toLowerCase();
  const el = document.getElementById('psych-nav-results');
  if (!el) return;
  if (!q) { el.innerHTML = `<div style="color:#718096;font-size:.85rem;text-align:center;padding:12px;">請輸入關鍵字</div>`; return; }
  const matches = casesData.filter(c => !c.deleted &&
    (c.name.toLowerCase().includes(q) || (c.studentId||'').includes(q) || c.id.includes(q))
  ).slice(0, 20);
  if (!matches.length) { el.innerHTML = `<div style="color:#718096;font-size:.85rem;text-align:center;padding:12px;">找不到符合的個案</div>`; return; }
  el.innerHTML = matches.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:6px;cursor:pointer;"
      onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background=''"
      onclick="_psychNavOpenCase('${escHtml(c.id)}')">
      <div>
        <div style="font-weight:600;font-size:.88rem;">${escHtml(c.name)}</div>
        <div style="color:#718096;font-size:.78rem;">${escHtml(c.id)} | ${escHtml(c.studentId||'—')}</div>
      </div>
      <span style="color:#3182ce;font-size:.82rem;">選擇</span>
    </div>`).join('');
}

// 從全域搜尋開啟精神科評估表單前，先確保 cold case 完整資料已載入
// （否則新增紀錄後 showCaseDetail 的 cold-load 分支會用舊資料覆蓋剛新增的紀錄）
async function _psychNavOpenCase(id) {
  document.getElementById('psych-nav-search-modal')?.remove();
  const c = casesData.find(x => x.id === id);
  if (c?._indexOnly && !c._fullLoaded) {
    showLoading('讀取個案資料…');
    try { await _ensureFullCases([id]); } finally { hideLoading(); }
  }
  openPsychiatristModal(id);
}

function openPsychiatristModal(caseId, recordId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  // 重置同時段重複紀錄檢核（#9）的殘留狀態
  delete _dupStates.pr;
  const existing = recordId ? (c.psychiatristRecords||[]).find(r => r.id === recordId) : null;
  const pr = existing || {
    date: new Date().toISOString().slice(0,10), timeStart:'', timeEnd:'',
    sessionPeriod:'',
    intervieweeName: c.name||'', legalGender: c.legalGender||'',
    department: c.department||'', studentId: c.studentId||'',
    mainIssue:'', coreAssessment:'', intervention:'', recommendations:'',
    diagnosisType:'none', diagnosisName:'',
    medicationAdvice:'no', hospitalizationAdvice:'no',
    otherNotes:'', doctorSignature:'',
  };
  const dO = (n,v,l,cur) => `<label style="margin-right:12px;"><input type="radio" name="${n}" value="${v}" ${cur===v?'checked':''}> ${l}</label>`;
  const _prRt = '<div class="rt-toolbar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;padding:4px 8px;"><button type="button" class="rt-btn rt-toolbar-toggle" onclick="toggleRtToolbar(this)" title="格式工具列" style="min-width:28px;font-size:.8rem;">A</button><span class="rt-toolbar-btns" style="display:none;gap:4px;flex-wrap:wrap;align-items:center;"><button type="button" class="rt-btn" data-cmd="bold" title="粗體" style="font-weight:bold;min-width:32px;">B</button><button type="button" class="rt-btn" data-cmd="italic" title="斜體" style="font-style:italic;min-width:32px;">I</button><button type="button" class="rt-btn" data-cmd="underline" title="底線" style="text-decoration:underline;min-width:32px;">U</button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="justifyLeft" title="靠左" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="1" y1="6.17" x2="10" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="10" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyCenter" title="置中" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="3" y1="6.17" x2="13" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="3" y1="13.5" x2="13" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyRight" title="靠右" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="6" y1="13.5" x2="15" y2="13.5"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtCycleUL" title="項目符號" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="2" cy="3" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none"/><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><button type="button" class="rt-btn" data-cmd="rtCycleOL" title="編號列表" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><text x="0" y="4.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1.</text><text x="0" y="9.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2.</text><text x="0" y="14.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3.</text><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtIndent" title="縮排" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="6" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/><polygon points="1,5.3 1,10.7 4.6,8" fill="currentColor" stroke="none"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="removeFormat" title="清除格式" style="min-width:32px;font-size:.78rem;">清</button></span></div>';
  document.body.insertAdjacentHTML('beforeend', `
    <div id="psychiatrist-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;">
      <div style="background:#fff;border-radius:12px;padding:28px;width:95%;max-width:700px;margin:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="font-size:1.1rem;">${existing?'編輯':'新增'}精神科醫師會談評估</h3>
          <button onclick="exitPsyForm('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#a0aec0;">&times;</button>
        </div>
        <div style="font-size:.78rem;color:#718096;margin-bottom:12px;"><span class="req">*</span> 為必填欄位</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div><label class="field-label">與談者姓名</label><input type="text" class="field-input" id="pr-name" value="${escHtml(pr.intervieweeName)}"></div>
          <div><label class="field-label">法定性別</label><select class="field-input" id="pr-gender">
            <option value="">請選擇</option>
            <option value="男" ${pr.legalGender==='男'?'selected':''}>男</option>
            <option value="女" ${pr.legalGender==='女'?'selected':''}>女</option>
          </select></div>
          <div><label class="field-label">系級</label><input type="text" class="field-input" id="pr-dept" value="${escHtml(pr.department)}"></div>
          <div><label class="field-label">學號</label><input type="text" class="field-input" id="pr-sid" value="${escHtml(pr.studentId)}"></div>
          <div><label class="field-label">會談日期</label><input type="date" class="field-input" id="pr-date" value="${pr.date}" onchange="_checkPRDuplicate('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')"></div>
          <div>
            <label class="field-label">節次</label>
            <select class="field-input" id="pr-period" onchange="prFillPeriod();_checkPRDuplicate('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')">
              <option value="">— 自填時間 —</option>
              ${BK_PERIODS.map(p => `<option value="${escHtml(p.label)}" ${pr.sessionPeriod===p.label?'selected':''}>${escHtml(p.label)}</option>`).join('')}
              <option value="其他" ${pr.sessionPeriod==='其他'?'selected':''}>其他（自填時間）</option>
            </select>
          </div>
        </div>
        <div id="pr-time-row" style="display:${(pr.sessionPeriod && pr.sessionPeriod !== '其他') ? 'none' : 'flex'};gap:12px;margin-bottom:16px;">
          <div style="flex:1;"><label class="field-label">開始時間</label><input type="text" class="field-input" id="pr-start" maxlength="5" placeholder="HH:MM" value="${escHtml(pr.timeStart)}" onblur="_bkTimeBlur(this);_checkPRDuplicate('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')"></div>
          <div style="flex:1;"><label class="field-label">結束時間</label><input type="text" class="field-input" id="pr-end" maxlength="5" placeholder="HH:MM" value="${escHtml(pr.timeEnd)}" onblur="_bkTimeBlur(this);_checkPRDuplicate('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')"></div>
        </div>
        <div id="pr-dup-alert" style="display:none;margin-bottom:12px;"></div>
        <div style="margin-bottom:12px;"><label class="field-label">主述與會談資料<span class="req">*</span></label>${_prRt}<div class="field-input rt-editor" id="pr-main" contenteditable="true" style="min-height:120px;overflow:auto;line-height:1.6;"></div><div style="margin-top:5px;"><button type="button" class="geno-open-btn" data-case="${escHtml(caseId)}" data-store="pr_main_${escHtml(pr.id||caseId)}" onclick="openGenogramEditor('pr-main',this.dataset.case,this.dataset.store)">＋ 家族圖</button></div></div>
        <div style="margin-bottom:12px;"><label class="field-label">核心問題之評估與判斷<span class="req">*</span></label>${_prRt}<div class="field-input rt-editor" id="pr-core" contenteditable="true" style="min-height:120px;overflow:auto;line-height:1.6;"></div></div>
        <div style="margin-bottom:12px;"><label class="field-label">介入處遇<span class="req">*</span></label>${_prRt}<div class="field-input rt-editor" id="pr-interv" contenteditable="true" style="min-height:90px;overflow:auto;line-height:1.6;"></div></div>
        <div style="margin-bottom:16px;"><label class="field-label">給學生諮商中心的建議<span class="req">*</span></label>${_prRt}<div class="field-input rt-editor" id="pr-rec" contenteditable="true" style="min-height:90px;overflow:auto;line-height:1.6;"></div></div>
        <div style="padding:14px;background:#f8fafc;border-radius:8px;margin-bottom:16px;">
          <div style="margin-bottom:10px;">
            <div style="font-weight:600;margin-bottom:6px;">是否符合精神疾患診斷標準？</div>
            ${dO('pr_diag','none','不符合任一精神疾患之診斷',pr.diagnosisType)}
            ${dO('pr_diag','specific','符合',pr.diagnosisType)}
            <div id="pr-diag-row" style="${pr.diagnosisType!=='specific'?'display:none;':''}margin-top:6px;">
              <input type="text" class="field-input" id="pr-diag-name" placeholder="請填寫診斷名稱" value="${escHtml(pr.diagnosisName||'')}">
            </div>
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-weight:600;margin-bottom:6px;">是否建議藥物治療？</div>
            ${dO('pr_med','no','否',pr.medicationAdvice)}
            ${dO('pr_med','yes','是，應定期回診並考慮藥物治療',pr.medicationAdvice)}
          </div>
          <div>
            <div style="font-weight:600;margin-bottom:6px;">是否建議住院治療？</div>
            ${dO('pr_hosp','no','否',pr.hospitalizationAdvice)}
            ${dO('pr_hosp','yes','是，建議住院療養',pr.hospitalizationAdvice)}
          </div>
        </div>
        <div style="margin-bottom:12px;"><label class="field-label">其他注意事項</label><div class="rt-toolbar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;padding:4px 8px;"><button type="button" class="rt-btn rt-toolbar-toggle" onclick="toggleRtToolbar(this)" title="格式工具列" style="min-width:28px;font-size:.8rem;">A</button><span class="rt-toolbar-btns" style="display:none;gap:4px;flex-wrap:wrap;align-items:center;"><button type="button" class="rt-btn" data-cmd="bold" title="粗體" style="font-weight:bold;min-width:32px;">B</button><button type="button" class="rt-btn" data-cmd="italic" title="斜體" style="font-style:italic;min-width:32px;">I</button><button type="button" class="rt-btn" data-cmd="underline" title="底線" style="text-decoration:underline;min-width:32px;">U</button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="justifyLeft" title="靠左" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="1" y1="6.17" x2="10" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="10" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyCenter" title="置中" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="3" y1="6.17" x2="13" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="3" y1="13.5" x2="13" y2="13.5"/></svg></button><button type="button" class="rt-btn" data-cmd="justifyRight" title="靠右" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="6" y1="13.5" x2="15" y2="13.5"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtCycleUL" title="項目符號（重複點擊循環切換類型）" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="2" cy="3" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none"/><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><button type="button" class="rt-btn" data-cmd="rtCycleOL" title="編號列表（重複點擊循環切換類型）" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><text x="0" y="4.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1.</text><text x="0" y="9.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2.</text><text x="0" y="14.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3.</text><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="rtIndent" title="縮排（最多5段，第6次重置）" style="min-width:32px;"><svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="6" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/><polygon points="1,5.3 1,10.7 4.6,8" fill="currentColor" stroke="none"/></svg></button><span style="border-left:1px solid #cbd5e0;margin:0 3px;"></span><button type="button" class="rt-btn" data-cmd="removeFormat" title="清除格式" style="min-width:32px;font-size:.78rem;">清</button></span></div><div class="field-input rt-editor" id="pr-notes" contenteditable="true" style="min-height:70px;overflow:auto;line-height:1.6;"></div></div>
        <div id="attachPicker_psy" class="attach-picker-wrap" style="margin-bottom:12px;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="savePsychiatristRecord('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')">儲存紀錄</button>
          <button class="btn btn-secondary" onclick="draftPsychiatristRecord('${escHtml(caseId)}','${existing?escHtml(recordId):'__new__'}')">暫存草稿</button>
          ${existing ? `<button class="btn btn-secondary" onclick="printPsychiatristRecord('${escHtml(caseId)}','${escHtml(recordId)}')">列印</button>` : ''}
          <button class="btn btn-secondary" style="color:#c53030;border-color:#fc8181;" onclick="discardPsychiatristRecord('${escHtml(caseId)}')">捨棄離開</button>
        </div>
      </div>
    </div>`);
  document.querySelectorAll('[name="pr_diag"]').forEach(el => el.addEventListener('change', () => {
    document.getElementById('pr-diag-row').style.display = el.value==='specific' ? '' : 'none';
  }));
  // 富文字欄位在 DOM 插入後設值（避免反引號截斷 template literal）
  setTimeout(() => {
    setRichTextValue('pr-main',  pr.mainIssue      || '');
    setRichTextValue('pr-core',  pr.coreAssessment || '');
    setRichTextValue('pr-interv',pr.intervention   || '');
    setRichTextValue('pr-rec',   pr.recommendations|| '');
    setRichTextValue('pr-notes', pr.otherNotes     || '');
  }, 0);
  attachInit('psy', existing?.attachments || [], { dropTargets: ['ta-issue','ta-interv','ta-ta'] });
  stopPsyDraftAutosave();
  if (!existing) {
    _psyDraftKey = `scc_draft_psy_${currentUser?.email||''}_${caseId}`;
    startPsyDraftAutosave();
  } else {
    _psyDraftKey = null;
  }
}

// 精神科醫師評估的「時段」正規化：有節次就用節次標籤，否則用自填的開始-結束時間
function _prTimeOf(r) {
  return (r?.sessionPeriod && r.sessionPeriod !== '其他') ? r.sessionPeriod : `${r?.timeStart || ''}-${r?.timeEnd || ''}`;
}

// 即時檢查同個案＋同填寫人＋同時段是否已有既存的精神科評估紀錄
// 註：表單無獨立的「評估醫師」選擇欄位，以目前登入者（填表人）作為比對用的人員身分
function _checkPRDuplicate(caseId, recordId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const date = document.getElementById('pr-date')?.value || '';
  const time = _prTimeOf({
    sessionPeriod: document.getElementById('pr-period')?.value || '',
    timeStart: document.getElementById('pr-start')?.value || '',
    timeEnd: document.getElementById('pr-end')?.value || '',
  });
  const records = (c.psychiatristRecords || [])
    .filter(r => !r.deleted)
    .map(r => ({ id: r.id, date: r.date, time: _prTimeOf(r), counselorEmails: [r.createdBy].filter(Boolean), createdAt: r.createdAt }));
  const match = _dupFindSameSlot(records, {
    date, time, counselorEmails: [currentUser?.email].filter(Boolean),
    excludeId: recordId && recordId !== '__new__' ? recordId : null,
  });
  _dupRenderAlert('pr-dup-alert', 'pr', match);
}

async function savePsychiatristRecord(caseId, recordId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const _origRecordId = recordId; // 供儲存失敗還原時重開同一筆（避免與 dup-merge 改指向的 recordId 混淆）
  const gV = id => document.getElementById(id)?.value?.trim()||'';
  const gR = n => { const el=document.querySelector(`[name="${n}"]:checked`); return el?el.value:''; };
  const required = [
    ['pr-main',  '主述與會談資料'],
    ['pr-core',  '核心問題之評估與判斷'],
    ['pr-interv','介入處遇'],
    ['pr-rec',   '給學生諮商中心的建議'],
  ];
  for (const [id, label] of required) {
    const txt = (document.getElementById(id)?.textContent || document.getElementById(id)?.value || '').trim();
    if (!txt) {
      alert(`「${label}」為必填欄位`);
      document.getElementById(id)?.focus();
      return;
    }
  }
  let _psyAttachments;
  try { _psyAttachments = await attachFlush('psy'); }
  catch(e) { alert('附件上傳失敗：' + e.message); return; }
  const data = {
    intervieweeName:gV('pr-name'), legalGender:gV('pr-gender'),
    department:gV('pr-dept'), studentId:gV('pr-sid'),
    date:gV('pr-date'), timeStart:gV('pr-start'), timeEnd:gV('pr-end'),
    sessionPeriod:gV('pr-period'),
    mainIssue:getRichTextValue('pr-main'), coreAssessment:getRichTextValue('pr-core'),
    intervention:getRichTextValue('pr-interv'), recommendations:getRichTextValue('pr-rec'),
    diagnosisType:gR('pr_diag'), diagnosisName:gV('pr-diag-name'),
    medicationAdvice:gR('pr_med'), hospitalizationAdvice:gR('pr_hosp'),
    otherNotes:getRichTextValue('pr-notes'), attachments:_psyAttachments,
    updatedAt:new Date().toISOString(), updatedBy:currentUser?.email, updatedByName:currentUser?.name,
  };
  delete data.status; delete data.draftSavedAt;
  if (!c.psychiatristRecords) c.psychiatristRecords = [];
  const now = new Date().toISOString();

  // ── 同時段重複紀錄檢核（#9）：儲存前最後把關 ──
  // 選「覆蓋」時把 recordId 改指向既存那筆，讓下面既有的「編輯」分支覆寫進去
  let _psyDidMerge = false;
  {
    const _psyDupList = (c.psychiatristRecords || [])
      .filter(r => !r.deleted)
      .map(r => ({ id: r.id, date: r.date, time: _prTimeOf(r), counselorEmails: [r.createdBy].filter(Boolean), createdAt: r.createdAt }));
    const _psyDupMatch = _dupFindSameSlot(_psyDupList, {
      date: data.date, time: _prTimeOf(data), counselorEmails: [currentUser?.email].filter(Boolean),
      excludeId: recordId !== '__new__' ? recordId : null,
    });
    if (_psyDupMatch && _dupResolveAtSave('pr', _psyDupMatch) === 'merge') {
      recordId = _psyDupMatch.id;
      _psyDidMerge = true;
    }
  }

  // #3：填寫人姓名優先取 configData 對應姓名（與其他表單一致），找不到才退回 currentUser.name/email
  const _psyCreatorName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.email || '';
  if (recordId === '__new__') {
    // check if this started as a draft (opening form from a draft record)
    data.id = 'psy_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    data.createdAt = now; data.createdBy = currentUser?.email; data.createdByName = _psyCreatorName;
    c.psychiatristRecords.push(data);
  } else {
    const idx = c.psychiatristRecords.findIndex(r => r.id === recordId);
    if (idx >= 0) {
      // 舊資料若尚未存填寫人（createdBy 缺漏，多為遷移舊資料），趁此次儲存補上；createdAt 若已有則不動
      if (!c.psychiatristRecords[idx].createdBy) {
        data.createdBy = currentUser?.email; data.createdByName = _psyCreatorName;
        if (!c.psychiatristRecords[idx].createdAt) data.createdAt = now;
      }
      c.psychiatristRecords[idx] = { ...c.psychiatristRecords[idx], ...data };
      delete c.psychiatristRecords[idx].status;
      delete c.psychiatristRecords[idx].draftSavedAt;
    } else c.psychiatristRecords.push({ ...data, id:recordId, createdAt:now, createdBy: currentUser?.email, createdByName: _psyCreatorName });
  }
  // mark corresponding todo as done
  const _savedRecId = recordId !== '__new__' ? recordId : data.id;
  const _psyTodo = todosData.find(t => t.recordId === _savedRecId && t.type === 'psychiatrist' && !t.done);
  if (_psyTodo) { _psyTodo.done = true; _psyTodo.doneAt = now; saveUserTodos().catch(()=>{}); _syncTodoBadge(); }
  // 儲存前記憶體快照：modal 即將被移除，須在移除前擷取欄位內容（jobId 稍後才產生，先擷取欄位備用）
  const _psySnapFields = _snapshotFormFields('psychiatrist-modal');
  clearPsyDraft();
  document.getElementById('psychiatrist-modal')?.remove();
  // 避免 showCaseDetail 的 cold-load 分支用舊資料覆蓋剛寫入的紀錄
  c._fullLoaded = true; c._indexOnly = false;
  // 跨學期個案：若新/編輯紀錄的日期落在其他學期分頁，自動切換過去，避免存檔後在目前分頁看不到
  if (data.date) _switchDetailSemTo(c, openDateToSemPrefix(data.date));
  showCaseDetail(caseId);
  _flashRecordCard('rec-card-' + _savedRecId);
  const _psyJobLabel = recordId === '__new__' ? '新增精神科評估' : '更新精神科評估';
  const jobId = bgJobAdd(_psyJobLabel, `${c.name} ${data.date}`);
  _armSaveFailSnapshot('精神科醫師紀錄', 'psychiatrist-modal',
    () => openPsychiatristModal(caseId, _origRecordId === '__new__' ? null : _origRecordId),
    () => savePsychiatristRecord(caseId, _origRecordId), jobId, _psySnapFields);
  (async () => {
    try {
      bgJobProgress(jobId, 40);
      await saveCasesChunks(caseId);
      bgJobProgress(jobId, 90);
      auditLog('儲存精神科評估', `${c.name} ${data.date}` + (_psyDidMerge ? '；覆蓋同時段紀錄' : ''));
      bgJobDone(jobId);
      _clearSaveFailSnapshot(jobId);
    } catch(e) {
      if (recordId === '__new__') {
        const failIdx = c.psychiatristRecords.findIndex(r => r.id === data.id);
        if (failIdx >= 0) c.psychiatristRecords.splice(failIdx, 1);
      }
      bgJobFail(jobId, e.message);
      _showSaveFailModal(e.message, jobId);
    }
  })();
}

async function deletePsychiatristRecord(caseId, recordId, onSuccess) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const pr = (c.psychiatristRecords||[]).find(r => r.id === recordId);
  if (!pr) return;
  if (!isAdmin() && pr.createdBy !== currentUser?.email) { alert('僅建立者或管理者可刪除此紀錄'); return; }
  if (!confirm('確定刪除此精神科評估紀錄？\n\n刪除後仍會在建立者與管理者介面留下「痕跡」，管理者可執行「徹底移除」。')) return;
  const prev = { deleted: pr.deleted, deletedAt: pr.deletedAt, deletedBy: pr.deletedBy, deletedByName: pr.deletedByName };
  pr.deleted = true;
  pr.deletedAt = new Date().toISOString();
  pr.deletedBy = currentUser?.email;
  pr.deletedByName = configData?.users?.[currentUser?.email]?.name || currentUser?.name;
  c._fullLoaded = true; c._indexOnly = false;
  if (typeof onSuccess === 'function') onSuccess();
  else showCaseDetail(caseId);
  const jobId = bgJobAdd('刪除精神科評估');
  saveCasesChunks(caseId).then(() => {
    bgJobDone(jobId);
    auditLog('刪除精神科評估', caseId, recordId);
    showToast('精神科評估已刪除');
  }).catch(e => {
    bgJobFail(jobId, e.message);
    Object.assign(pr, prev);
    if (typeof onSuccess === 'function') onSuccess();
    else showCaseDetail(caseId);
    showToast('刪除失敗：' + e.message, 'error');
  });
}

async function purgePsychiatristRecord(caseId, recordId, onSuccess) {
  if (!isAdmin()) { alert('僅管理者可徹底移除紀錄。'); return; }
  if (!confirm('確定要徹底移除此精神科評估紀錄？此動作不可復原，將清除「已刪除」痕跡。')) return;
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const idx = (c.psychiatristRecords||[]).findIndex(r => r.id === recordId);
  if (idx < 0) return;
  const removed = c.psychiatristRecords.splice(idx, 1)[0];
  showLoading('徹底移除…');
  try {
    await saveCasesChunks(caseId);
    auditLog('徹底移除精神科評估', caseId, recordId);
    hideLoading();
    if (typeof onSuccess === 'function') onSuccess(); else showCaseDetail(caseId);
  } catch(e) {
    c.psychiatristRecords.splice(idx, 0, removed);
    hideLoading(); alert('操作失敗：'+e.message);
  }
}

async function restorePsychiatristRecord(caseId, recordId, onSuccess) {
  if (!confirm('確定要復原這筆精神科評估紀錄？')) return;
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const pr = (c.psychiatristRecords||[]).find(r => r.id === recordId);
  if (!pr) return;
  const prev = { deleted: pr.deleted, deletedAt: pr.deletedAt, deletedBy: pr.deletedBy, deletedByName: pr.deletedByName };
  delete pr.deleted; delete pr.deletedAt; delete pr.deletedBy; delete pr.deletedByName;
  showLoading('復原中…');
  try {
    await saveCasesChunks(caseId);
    auditLog('復原精神科評估', caseId, recordId);
    hideLoading();
    if (typeof onSuccess === 'function') onSuccess(); else showCaseDetail(caseId);
  } catch(e) {
    Object.assign(pr, prev);
    hideLoading(); alert('操作失敗：'+e.message);
  }
}

// 精神科評估「填表人／評估人」：若填寫者本身即為駐校精神科醫師則標示為「評估人」，否則為「填表人」；一律顯示姓名+職稱
function _psyFillerInfo(pr) {
  const u = configData?.users?.[pr?.createdBy];
  const role = u?.role || '';
  const label = role === '駐校精神科醫師' ? '評估人' : '填表人';
  const name = u?.name || pr?.createdByName || pr?.createdBy || '—';
  const display = (u && role && role !== '系統管理者') ? name + role : name;
  return { label, display };
}

function printPsychiatristRecord(caseId, recordId, mode = 'print') {
  const c = casesData.find(x => x.id === caseId);
  const pr = (c?.psychiatristRecords||[]).find(r => r.id === recordId);
  if (!pr) return;
  const rocDate = d => { if(!d) return '　年　月　日'; const p=d.split('-'); return p.length===3?`${parseInt(p[0])-1911}年${parseInt(p[1])}月${parseInt(p[2])}日`:d; };
  const timeRange = pr.timeStart||pr.timeEnd ? `${pr.timeStart||'　　'}～${pr.timeEnd||'　　'}` : '　　～　　';
  const _pk = s => s.replace(/[□■]/g, c => `<span style="font-size:1.2em;line-height:1;vertical-align:-0.05em;">${c}</span>`);
  const diagHtml = _pk(pr.diagnosisType==='specific' ? `□ 不符合任一精神疾患之診斷<br>■ 符合 ${escHtml(pr.diagnosisName||'')} 診斷標準` : '■ 不符合任一精神疾患之診斷<br>□ 符合　　　　診斷標準');
  const medHtml = _pk(pr.medicationAdvice==='yes' ? '□ 否<br>■ 是，應定期回診並考慮藥物治療' : '■ 否<br>□ 是，應定期回診並考慮藥物治療');
  const hospHtml = _pk(pr.hospitalizationAdvice==='yes' ? '□ 否<br>■ 是，建議住院療養' : '■ 否<br>□ 是，建議住院療養');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>精神科醫師會談評估表</title>
    <style>body{font-family:'標楷體',serif;font-size:12pt;line-height:1.8;margin:15mm;}
    h2{text-align:center;font-size:15pt;margin-bottom:16px;}
    table{width:100%;border-collapse:collapse;}
    td,th{border:1px solid #888;padding:8px 12px;vertical-align:top;}
    th{background:#f5f5f5;font-weight:bold;width:22%;}
    .no-print{margin-bottom:12px;} @media print{.no-print{display:none;}}</style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div>
    <div class="no-print"><button onclick="window.print()">列印</button></div>
    <h2>精神科醫師會談評估表</h2>
    <table>
      <tr><th>與談者姓名</th><td>${escHtml(pr.intervieweeName||'')}</td><th>法定性別</th><td>${pr.legalGender||'　'}</td></tr>
      <tr><th>系級</th><td>${escHtml(pr.department||'')}</td><th>學號</th><td>${pr.studentId||'　'}</td></tr>
      <tr><th>會談時段</th><td colspan="3">${rocDate(pr.date)}（${timeRange}）</td></tr>
      <tr><th>主述與會談資料</th><td colspan="3" style="min-height:80px;">${renderMaybeHtml(pr.mainIssue||'')}</td></tr>
      <tr><th>核心問題之評估與判斷</th><td colspan="3" style="min-height:80px;">${renderMaybeHtml(pr.coreAssessment||'')}</td></tr>
      <tr><th>介入處遇</th><td colspan="3" style="min-height:80px;">${renderMaybeHtml(pr.intervention||'')}</td></tr>
      <tr><th>給學生諮商中心的建議</th><td colspan="3" style="min-height:80px;">${renderMaybeHtml(pr.recommendations||'')}</td></tr>
      <tr><th>是否符合精神疾患診斷標準</th><td colspan="3">${diagHtml}</td></tr>
      <tr><th>是否建議藥物治療</th><td colspan="3">${medHtml}</td></tr>
      <tr><th>是否建議住院治療</th><td colspan="3">${hospHtml}</td></tr>
      <tr><th>其他注意事項</th><td colspan="3" style="min-height:50px;">${renderMaybeHtml(pr.otherNotes||'')}</td></tr>
      <tr><th>${_psyFillerInfo(pr).label}</th><td colspan="3">${escHtml(_psyFillerInfo(pr).display)}</td></tr>
    </table>
    <div style="margin-top:14px;text-align:right;font-size:10pt;color:#555;">${escHtml(configData?.users?.[currentUser?.email]?.name || currentUser?.name || '')} 於 ${escHtml(new Date().toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))} 列印　國立屏東科技大學學生諮商中心資訊系統</div>
    </body></html>`;
  _printViaIframe(html);
}

