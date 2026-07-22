// dev/closure-eval.js — 結案評估模組（拆 index.html 絞殺者第十刀，v256）。
// 內容為從 index.html 逐字搬出的函式：結案／學期評估表單草稿備援與離開防護（_closureFormSnapshot／
// _closureDraftKey／_startClosureDraftAutosave／_stopClosureDraftAutosave／_restoreClosureDraft）、
// 評估紀錄查詢與卡片（_genEvalId／_getActiveEvals／_getLatestActiveEval／toggleEvalCard）、開啟評估表
// （showEvalTypeModal／showEvalExistingModal／openClosureEvalPage）、結案原因 chips（_clReasonAllOpts／
// _clReasonRender／_clReasonSelect／_clReasonAddCustom／_clReasonDeleteCustom／_clReasonGet／
// _clReasonSet）、燈號說明 chips（_clLightDescRender／_clLightDescSelect／_onLightChange／
// _clLightDescGet／_clLightDescSet／_clLightDescAddCustom／_clLightDescDeleteCustom）、結案日期
// （_clDateModeChange／_clDateGet／_clDateSet）、後續安排（_clFollowupChange／_clFollowupGet／
// _clFollowupSet）、切換評估類型與既有評估參考卡（_switchEvalType／_buildRefEvalHtml）、離開與草稿
// （_exitClosureEvalSilent／cancelClosureEval／_draftClosureEval）、列印與儲存（_buildEvalPrintHtml／
// printClosureEval／saveClosureEval）、返回個案列表/新增個案動線（backToCaseList／
// _detailBackToNewCase／_renderDetailBackBtn）、結案確認與學期管理（closeCaseConfirm／
// nextSemesterPrefix／prevSemesterPrefix／_semPrefixToApproxDate／_semPrefixToEndDate／
// showNewSemModal／addCaseSemester／deleteCaseSemData／_recomputeCaseStatus／_semLightStyle）、
// 評估復原與軟刪除（restoreDeletedEval／softDeleteEval）、未結案提醒（_isSemesterUnclosed／
// _hasPastUnclosed／_pastUnclosedSems／_dismissUnclosedReminder／_toggleUnclosedSummary／
// goCasesPastUnclosed）、取消結案（reopenCase）。
// 頂層無任何執行副作用（只有 function/async function 與純初始值 let/const 宣告）；本檔頂層宣告
// 的 8 個 let（_closureCaseId／_closureEvalDraft／_closureEvalType／_closureEvalSem／
// _closureEditingEvalId／_closureDraftTodoId／_clReasonSelected／_clLightDescSelected）與 2 個
// const（_CL_REASON_FIXED／_CL_LIGHT_DESC_PRESETS）一併搬移，經逐一確認全專案僅本檔各一處宣告、
// 無跨檔重複宣告（比照 v253 initial-interview.js 的作法）。函式內部在呼叫時才會引用主檔全域可變
// 狀態（casesData／configData／currentUser／todosData／CLOSURE_DIMS／DIM_LEVEL_EXPLANATIONS／
// window._dimExpUpdate，定義仍留在 index.html；_caseDetailActiveSem 定義在 initial-interview.js；
// _detailReturnToNewCase 定義在 index.html），以及主檔與其他拆檔模組內的共用函式（escHtml／
// showCaseDetail／currentSemesterPrefix／semesterLabel／openDateToSemPrefix／semesterMonths（皆
// utils.js）、_semKeyBase／_applySemKeyRenumber／_renumberSemKeys（case-detail.js）、
// getRichTextValue／setRichTextValue／setAlert／showLoading／hideLoading／showPage／showToast／
// auditLog／bgJobAdd 系列／saveCasesChunks／buildCounselorOptgroups／_gdStartAutosave／
// _gdStopAutosave／_gdSetBaseline／_gdIsDirty／_showExitDialog／_getDimExp／_counselorStatusSuffix／
// _printViaIframe／_armSaveFailSnapshot／_clearSaveFailSnapshot／_showSaveFailModal／
// openNewCasePage／renderCases／renderMaybeHtml／driveUpdateJsonFile／_configCasesPatch／
// saveUserTodos／_genTodoId／_putTodoItem／renderTodosPage／_syncTodoBadge／addNotificationToUser／
// _flushNotifOps／_userPref_／syncUserPref_ 等，皆定義於 index.html），屬 call-time 解析，與其他
// 拆檔模組（utils.js／ft-core.js／case-detail.js／case-import.js／initial-interview.js／
// psych-import.js／grad-eval.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="closure-eval.js"></script> 載入（放在
// grad-eval.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ══════════════════════════════════════════════
//  結案評估
// ══════════════════════════════════════════════
let _closureCaseId = null;
let _closureEvalDraft = null;
let _closureEvalType = 'closure'; // 'closure' | 'semester'
let _closureEvalSem  = null;     // active semester when eval was opened
let _closureEditingEvalId = null; // null=新增, string=編輯中的 evalId
let _closureDraftTodoId = null; // v185：從草稿待辦「繼續編輯」重開時記錄對應 todoId

// ── v185：結案評估／學期評估表單草稿備援與離開防護 ──────────────────────────
// 快照涵蓋 cancelClosureEval() 原本靜默寫入草稿的所有欄位（沿用同一組欄位，僅改儲存路徑與時機）。
function _closureFormSnapshot() {
  return {
    dims: CLOSURE_DIMS.map((_, i) => document.querySelector(`input[name="dim-${i}"]:checked`)?.value || '不清楚'),
    light: document.querySelector('input[name="cl-light"]:checked')?.value || '',
    description: getRichTextValue('cl-description'),
    chiefComplaint: getRichTextValue('cl-chief-complaint'),
    assessment: getRichTextValue('cl-assessment'),
    treatmentProvided: getRichTextValue('cl-treatment'),
    reason: _clReasonGet(),
    lightDescription: _clLightDescGet(),
    closureDate: _clDateGet(),
    followup: _clFollowupGet(),
  };
}
function _closureDraftKey() {
  return `scc_draft_closure_${currentUser?.email || ''}_${_closureCaseId || ''}_${_closureEvalType}`;
}
function _startClosureDraftAutosave() {
  _gdStartAutosave('closure', _closureDraftKey(), _closureFormSnapshot, '_closure-draft-status');
}
function _stopClosureDraftAutosave() { _gdStopAutosave('closure'); }

function _restoreClosureDraft(snap) {
  if (!snap) return;
  (snap.dims || []).forEach((level, i) => {
    if (!level) return;
    const r = document.querySelector(`input[name="dim-${i}"][value="${level}"]`);
    if (r) r.checked = true;
  });
  if (snap.light) { const r = document.querySelector(`input[name="cl-light"][value="${snap.light}"]`); if (r) r.checked = true; }
  if (snap.description != null)       setRichTextValue('cl-description', snap.description);
  if (snap.chiefComplaint != null)    setRichTextValue('cl-chief-complaint', snap.chiefComplaint);
  if (snap.assessment != null)        setRichTextValue('cl-assessment', snap.assessment);
  if (snap.treatmentProvided != null) setRichTextValue('cl-treatment', snap.treatmentProvided);
  if (snap.reason) _clReasonSet(snap.reason);
  if (snap.lightDescription) _clLightDescSet(snap.lightDescription, snap.light);
  if (snap.closureDate) _clDateSet(snap.closureDate, _closureEvalSem, casesData.find(c => c.id === _closureCaseId)?.records || []);
  if (snap.followup) _clFollowupSet(snap.followup);
  _gdSetBaseline('closure', _closureFormSnapshot());
}

function _genEvalId() {
  return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
function _getActiveEvals(c, sem, type) {
  return (c.semesterEvaluations || []).filter(e =>
    e.type === type && (!sem || e.semester === sem) && !e.deletedAt && !e.replacedBy
  ).sort((a, b) => (a.evaluatedAt || '').localeCompare(b.evaluatedAt || ''));
}
function _getLatestActiveEval(c, sem, type) {
  const arr = _getActiveEvals(c, sem, type);
  return arr.length ? arr[arr.length - 1] : null;
}
function toggleEvalCard(safeId) {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  const bodyEl = document.getElementById('evalcard-body-' + safeId);
  const iconEl = document.getElementById('evalcard-icon-' + safeId);
  if (!bodyEl) return;
  const isOpen = bodyEl.style.display !== 'none';
  bodyEl.style.display = isOpen ? 'none' : '';
  if (iconEl) iconEl.textContent = isOpen ? '▶' : '▲';
}

function showEvalTypeModal(caseId, evalSem) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const sem = evalSem || _caseDetailActiveSem || currentSemesterPrefix();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px;text-align:center;">
      <div class="modal-header"><h3 style="margin:0;">請選擇評估類型</h3></div>
      <div class="modal-body" style="padding:20px 16px;">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:4px;">個案：<strong>${escHtml(c.name)}（${escHtml(c.id)}）</strong></p>
        <p style="font-size:.88rem;color:#3182ce;font-weight:600;margin-bottom:14px;">學期：${escHtml(semesterLabel(sem))}</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-warning" style="flex:1;min-width:120px;padding:14px 10px;font-size:.95rem;"
            onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','semester')">
            📋 學期評估表<br><span style="font-size:.78rem;opacity:.85;font-weight:400;">填寫後該學期結案</span>
          </button>
          <button class="btn btn-danger" style="flex:1;min-width:120px;padding:14px 10px;font-size:.95rem;"
            onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','closure')">
            🔒 結案評估表<br><span style="font-size:.78rem;opacity:.8;font-weight:400;">填寫後將結案</span>
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function showEvalExistingModal(caseId, evalSem, existingClosure, existingSemester) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  // 確保 legacy eval 有 evalId（舊資料可能沒有），避免編輯時找不到
  if (existingClosure && !existingClosure.evalId) existingClosure.evalId = _genEvalId();
  if (existingSemester && !existingSemester.evalId) existingSemester.evalId = _genEvalId();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  let editBtns = '';
  if (existingClosure) {
    const eDate = existingClosure.evaluatedAt ? existingClosure.evaluatedAt.slice(0,10) : '—';
    editBtns += `<button class="btn btn-secondary" style="flex:1;min-width:150px;padding:12px 10px;text-align:left;"
      onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','closure','${escHtml(existingClosure.evalId)}')">
      ✏️ <strong>編輯既有結案評估</strong><br>
      <span style="font-size:.78rem;opacity:.75;">${escHtml(existingClosure.evaluatorName||'—')}・${eDate}</span>
    </button>`;
  }
  if (existingSemester) {
    const eDate = existingSemester.evaluatedAt ? existingSemester.evaluatedAt.slice(0,10) : '—';
    editBtns += `<button class="btn btn-secondary" style="flex:1;min-width:150px;padding:12px 10px;text-align:left;"
      onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','semester','${escHtml(existingSemester.evalId)}')">
      ✏️ <strong>編輯既有學期評估</strong><br>
      <span style="font-size:.78rem;opacity:.75;">${escHtml(existingSemester.evaluatorName||'—')}・${eDate}</span>
    </button>`;
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:500px;">
      <div class="modal-header"><h3 style="margin:0;">此學期已有評估表</h3></div>
      <div class="modal-body" style="padding:16px;">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:16px;">
          個案：<strong>${escHtml(c.name)}（${escHtml(c.id)}）</strong>　學期：${escHtml(semesterLabel(evalSem))}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">${editBtns}</div>
        <div style="border-top:1px solid #e2e8f0;padding-top:12px;">
          <div style="font-size:.82rem;color:#718096;margin-bottom:8px;">或新增一份（並列保留）：</div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-warning" style="flex:1;padding:10px;"
              onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','semester',null)">
              📋 新增學期評估</button>
            <button class="btn btn-danger" style="flex:1;padding:10px;"
              onclick="this.closest('.modal-overlay').remove();openClosureEvalPage('${escHtml(caseId)}','closure',null)">
              🔒 新增結案評估</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openClosureEvalPage(caseId, evalType, editingEvalId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  _closureCaseId = caseId;
  _closureEvalType = evalType || 'closure';
  _closureEvalSem  = _caseDetailActiveSem || currentSemesterPrefix();
  _closureEditingEvalId = editingEvalId || null;

  const isClosure = _closureEvalType === 'closure';
  const pageTitle = isClosure ? '結案評估表' : '學期評估表';
  document.getElementById('closure-eval-page-title').textContent = pageTitle;
  document.getElementById('closure-section-title').textContent = isClosure ? '質性描述與結案資訊' : '質性描述';
  document.getElementById('btn-print-eval').textContent = isClosure ? '列印結案評估' : '列印學期評估';
  document.getElementById('btn-confirm-closure').textContent = isClosure ? '確認結案' : '儲存學期評估';
  document.getElementById('btn-confirm-closure').className = isClosure ? 'btn btn-danger' : 'btn btn-primary';
  document.getElementById('cl-qualitative-closure').style.display = isClosure ? '' : 'none';
  document.getElementById('cl-qualitative-semester').style.display = isClosure ? 'none' : '';

  document.getElementById('closure-case-info').textContent =
    `個案：${c.name}（${c.id}）　學期：${semesterLabel(_closureEvalSem)}　主責：${c.counselorName || configData?.users?.[c.counselorEmail]?.name || c.counselorEmail || '—'}${_counselorStatusSuffix(c.counselorEmail)}`;

  const evalSem = _closureEvalSem;

  // 編輯模式：從既有 eval 預填；新增模式：從 draft 還原
  let prefill = null;
  let _prefillFromDeleted = false;
  if (_closureEditingEvalId) {
    prefill = (c.semesterEvaluations || []).find(e => e.evalId === _closureEditingEvalId) || null;
  }
  if (!prefill) {
    const _lsDraftKey = 'scc_closure_draft_' + caseId;
    const rawDraft = (_closureEvalDraft?.caseId === caseId)
      ? _closureEvalDraft
      : (() => { try { return JSON.parse(localStorage.getItem(_lsDraftKey) || 'null'); } catch { return null; } })();
    const draft = (rawDraft?.evalType === _closureEvalType || (!rawDraft?.evalType && _closureEvalType === 'closure'))
      ? rawDraft : null;
    if (draft) prefill = {
      light: draft.light, closureReason: draft.reason,
      lightDescription: draft.lightDescription,
      closureDate: draft.closureDate,
      followup: draft.followup,
      chiefComplaint: draft.chiefComplaint, assessment: draft.assessment,
      treatmentProvided: draft.treatmentProvided, description: draft.description,
      dimensions: (draft.dims || []).map((level, i) => ({ label: CLOSURE_DIMS[i], level })),
    };
  }
  // 4-7: 若無草稿與編輯目標，從最近一次被刪除的評估帶入（同類型優先，其次跨類型）
  if (!prefill && !_closureEditingEvalId) {
    const deletedEvals = (c.semesterEvaluations || []).filter(e =>
      e.deletedAt && !e.replacedBy && e.semester === evalSem
    );
    if (deletedEvals.length) {
      const sameType = deletedEvals.filter(e => (e.type||'closure') === _closureEvalType);
      const source = (sameType.length ? sameType : deletedEvals)
        .reduce((a, b) => (a.deletedAt||'') > (b.deletedAt||'') ? a : b);
      prefill = { ...source };
      _prefillFromDeleted = true;
      // 跨類型轉換欄位
      if ((source.type||'closure') !== _closureEvalType) {
        if (_closureEvalType === 'semester') {
          const parts = [
            source.chiefComplaint ? `主訴問題：\n${source.chiefComplaint}` : '',
            source.assessment ? `評估：\n${source.assessment}` : '',
            source.treatmentProvided ? `已提供輔導處遇：\n${source.treatmentProvided}` : '',
          ].filter(Boolean);
          prefill.description = parts.join('\n\n');
        } else {
          prefill.chiefComplaint = source.description || '';
        }
      }
    }
  }

  // 標題提示
  const editNotice = document.getElementById('closure-edit-notice');
  if (editNotice) {
    if (_closureEditingEvalId) {
      editNotice.style.display = ''; editNotice.className = 'alert alert-warn';
      editNotice.textContent = '⚠ 編輯模式：儲存後原評估將標記為「已取代」，並新增一筆紀錄。';
    } else if (_prefillFromDeleted) {
      editNotice.style.display = ''; editNotice.className = 'alert alert-info';
      editNotice.textContent = '📋 已從上次刪除的評估帶入資料，請確認後儲存。';
    } else {
      editNotice.style.display = 'none'; editNotice.textContent = '';
    }
  }

  // 切換類型按鈕（編輯模式才顯示）
  const switchWrap = document.getElementById('closure-switch-type-wrap');
  if (switchWrap) switchWrap.style.display = _closureEditingEvalId ? '' : 'none';

  // 4-18: 顯示既有評估供參考（新增模式且此學期已有評估）
  const existingActiveEvals = (c.semesterEvaluations || []).filter(e =>
    !e.deletedAt && !e.replacedBy && e.semester === evalSem
  );
  const refEl = document.getElementById('closure-ref-eval');
  if (refEl) {
    if (!_closureEditingEvalId && existingActiveEvals.length > 0) {
      refEl.style.display = ''; refEl.innerHTML = _buildRefEvalHtml(existingActiveEvals);
    } else {
      refEl.style.display = 'none'; refEl.innerHTML = '';
    }
  }

  // 產生八向度（量化尺度 無/1-5/不清楚；舊值低→2 中→4 高→5）
  document.getElementById('closure-dims').innerHTML = CLOSURE_DIMS.map((dim, i) => {
    const raw = prefill?.dimensions?.[i]?.level;
    const legacyMap = { '低': '2', '中': '4', '高': '5' };
    const savedLevel = raw ? (legacyMap[raw] || raw) : '不清楚';
    const ck = v => savedLevel === v ? 'checked' : '';
    return `<div class="dim-row">
      <div class="dim-label"><strong>${i+1}.</strong> ${escHtml(dim)}</div>
      <div style="display:inline-grid;grid-template-columns:repeat(7,auto);gap:1px 6px;align-items:center;margin-top:3px;">
        <div></div>
        <div style="text-align:center;color:#276749;font-weight:600;font-size:.71rem;border-top:2px solid #276749;border-left:2px solid #276749;border-right:2px solid #276749;border-radius:4px 4px 0 0;padding:1px 6px;">低</div>
        <div style="grid-column:span 2;text-align:center;color:#dd6b20;font-weight:600;font-size:.71rem;border-top:2px solid #dd6b20;border-left:2px solid #dd6b20;border-right:2px solid #dd6b20;border-radius:4px 4px 0 0;padding:1px 6px;">中</div>
        <div style="grid-column:span 2;text-align:center;color:#c53030;font-weight:600;font-size:.71rem;border-top:2px solid #c53030;border-left:2px solid #c53030;border-right:2px solid #c53030;border-radius:4px 4px 0 0;padding:1px 6px;">高</div>
        <div></div>
        <label data-tip="此向度對個案無明顯影響"><input type="radio" name="dim-${i}" value="無" ${ck('無')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> 無</label>
        <label data-tip="${escHtml(DIM_LEVEL_EXPLANATIONS[i].low)}"><input type="radio" name="dim-${i}" value="1" ${ck('1')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> <span class="badge badge-green">1</span></label>
        <label data-tip="${escHtml(DIM_LEVEL_EXPLANATIONS[i].mid)}"><input type="radio" name="dim-${i}" value="2" ${ck('2')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> <span class="badge badge-orange">2</span></label>
        <label data-tip="${escHtml(DIM_LEVEL_EXPLANATIONS[i].mid)}"><input type="radio" name="dim-${i}" value="3" ${ck('3')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> <span class="badge badge-orange">3</span></label>
        <label data-tip="${escHtml(DIM_LEVEL_EXPLANATIONS[i].high)}"><input type="radio" name="dim-${i}" value="4" ${ck('4')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> <span class="badge" style="background:#fde8e8;color:#c0392b;">4</span></label>
        <label data-tip="${escHtml(DIM_LEVEL_EXPLANATIONS[i].high)}"><input type="radio" name="dim-${i}" value="5" ${ck('5')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> <span class="badge" style="background:#fde8e8;color:#c0392b;">5</span></label>
        <label data-tip="目前資訊不足以評估此向度"><input type="radio" name="dim-${i}" value="不清楚" ${ck('不清楚')} onchange="window._dimExpUpdate('dim',${i},this.value)"/> 不清楚</label>
      </div>
      <div id="dim-exp-${i}" style="font-size:.78rem;color:#718096;font-style:italic;margin-top:4px;padding:3px 6px;border-left:3px solid #e2e8f0;min-height:1em;">${escHtml(_getDimExp(i, savedLevel))}</div>
    </div>`;
  }).join('');

  const lightVal = prefill?.light || prefill?.statusLight || '';
  if (lightVal) {
    const r = document.querySelector(`input[name="cl-light"][value="${lightVal}"]`);
    if (r) r.checked = true;
  } else {
    document.querySelectorAll('input[name="cl-light"]').forEach(r => r.checked = false);
  }
  // 4-2/4-3: 燈號說明 chips
  _clLightDescSet(prefill?.lightDescription || '', lightVal);

  if (isClosure) {
    setRichTextValue('cl-chief-complaint', prefill?.chiefComplaint || '');
    setRichTextValue('cl-assessment',      prefill?.assessment || '');
    setRichTextValue('cl-treatment',       prefill?.treatmentProvided || '');
  } else {
    setRichTextValue('cl-description', prefill?.description || '');
  }
  _clReasonSet(prefill?.closureReason || '');

  // 4-4: 結案日期
  const dateSec = document.getElementById('cl-closure-date-section');
  if (dateSec) dateSec.style.display = '';
  const dateLabelEl = document.getElementById('cl-date-field-label');
  if (dateLabelEl) dateLabelEl.innerHTML = `${isClosure ? '結案日期' : '評估日期'}<span class="req">*</span>`;
  _clDateSet(prefill?.closureDate || '', evalSem, c.records || []);
  const _clEvalSel = document.getElementById('cl-eval-counselor');
  if (_clEvalSel) { _clEvalSel.innerHTML = buildCounselorOptgroups(); _clEvalSel.value = prefill?.evaluatorEmail || currentUser.email || ''; }

  // 4-12/4-13: 後續安排
  _clFollowupSet(prefill?.followup || '');

  setAlert('closure-alert', '', '');
  document.getElementById('btn-confirm-closure').disabled = false;
  showPage('page-closure-eval', null);
  // v185：欄位（含既有評估/草稿回填）皆已就緒後才取基準快照，避免把回填資料誤判為使用者輸入
  _gdSetBaseline('closure', _closureFormSnapshot());
  _startClosureDraftAutosave();
  const _clds0 = document.getElementById('_closure-draft-status'); if (_clds0) _clds0.textContent = '';
}

// ── 結案原因 chips ──────────────────────────────────────────────────────
const _CL_REASON_FIXED = ['個案主述問題已緩解','個案無意願會談','退學','返家休養'];
let _clReasonSelected = [];
function _clReasonAllOpts() {
  return [..._CL_REASON_FIXED, ...(configData?.closureReasonCustomOpts || [])];
}

function _clReasonRender() {
  const wrap = document.getElementById('cl-reason-chips');
  if (!wrap) return;
  const allOpts = _clReasonAllOpts();
  const chipHtml = allOpts.map(opt => {
    const active = _clReasonSelected.includes(opt);
    const isCustom = !_CL_REASON_FIXED.includes(opt);
    const delBtn = isCustom
      ? `<span onclick="event.stopPropagation();_clReasonDeleteCustom('${escHtml(opt).replace(/'/g,"\\'")}')
" style="margin-left:5px;opacity:.6;font-size:.8rem;" title="刪除此選項">×</span>`
      : '';
    return `<span onclick="_clReasonSelect('${escHtml(opt).replace(/'/g,"\\'")}')
" style="cursor:pointer;padding:6px 14px;border-radius:20px;font-size:.88rem;border:1.5px solid ${active?'#3182ce':'#cbd5e0'};background:${active?'#ebf8ff':'#fff'};color:${active?'#2b6cb0':'#4a5568'};user-select:none;transition:all .15s;display:inline-flex;align-items:center;">${escHtml(opt)}${delBtn}</span>`;
  }).join('');
  wrap.innerHTML = chipHtml +
    `<span onclick="_clReasonAddCustom()" style="cursor:pointer;padding:6px 12px;border-radius:20px;font-size:.88rem;border:1.5px dashed #cbd5e0;background:#f7fafc;color:#718096;user-select:none;">＋ 新增</span>`;
}

function _clReasonSelect(opt) {
  const idx = _clReasonSelected.indexOf(opt);
  if (idx >= 0) _clReasonSelected.splice(idx, 1);
  else _clReasonSelected.push(opt);
  _clReasonRender();
}

async function _clReasonAddCustom() {
  const val = prompt('請輸入新的結案原因：');
  if (!val || !val.trim()) return;
  const trimmed = val.trim();
  if (_clReasonAllOpts().includes(trimmed)) { alert('此選項已存在。'); return; }
  if (!configData.closureReasonCustomOpts) configData.closureReasonCustomOpts = [];
  configData.closureReasonCustomOpts.push(trimmed);
  _clReasonSelected.push(trimmed);
  _clReasonRender();
  driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});
}

async function _clReasonDeleteCustom(opt) {
  if (!confirm(`確定要刪除結案原因「${opt}」？此為全系統共享選項。`)) return;
  const idx = (configData.closureReasonCustomOpts || []).indexOf(opt);
  if (idx >= 0) configData.closureReasonCustomOpts.splice(idx, 1);
  const ri = _clReasonSelected.indexOf(opt);
  if (ri >= 0) _clReasonSelected.splice(ri, 1);
  _clReasonRender();
  driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});
}

function _clReasonGet() {
  return _clReasonSelected.join('、');
}

function _clReasonSet(val) {
  if (!val) { _clReasonSelected = []; _clReasonRender(); return; }
  // 支援舊格式（單一字串）與新格式（"原因A、原因B"）
  _clReasonSelected = val.split('、').map(s => s.trim()).filter(Boolean);
  _clReasonRender();
}

// ── 燈號說明 chips（4-2/4-3）────────────────────────────────────────────────
const _CL_LIGHT_DESC_PRESETS = [
  { text: '個案仍有高度自殺/自傷或傷人之危機', light: '紅燈' },
  { text: '個案有嚴重情緒/精神困擾',           light: '橙燈' },
  { text: '個案危機狀況已解除',                 light: '黃燈' },
  { text: '個案狀況穩定',                       light: '綠燈' },
];
let _clLightDescSelected = [];

function _clLightDescRender() {
  const wrap = document.getElementById('cl-light-desc-wrap');
  const chipDiv = document.getElementById('cl-light-desc-chips');
  if (!wrap || !chipDiv) return;
  wrap.style.display = '';
  const presetTexts = _CL_LIGHT_DESC_PRESETS.map(p => p.text);
  const allOpts = [...presetTexts, ...(configData?.closureLightDescCustomOpts || [])];
  const chipHtml = allOpts.map(opt => {
    const active = _clLightDescSelected.includes(opt);
    const isCustom = !presetTexts.includes(opt);
    const delBtn = isCustom
      ? `<span onclick="event.stopPropagation();_clLightDescDeleteCustom('${escHtml(opt).replace(/'/g,"\\'")}')
" style="margin-left:5px;opacity:.6;font-size:.8rem;" title="刪除">×</span>` : '';
    return `<span onclick="_clLightDescSelect('${escHtml(opt).replace(/'/g,"\\'")}')
" style="cursor:pointer;padding:6px 14px;border-radius:20px;font-size:.88rem;border:1.5px solid ${active?'#3182ce':'#cbd5e0'};background:${active?'#ebf8ff':'#fff'};color:${active?'#2b6cb0':'#4a5568'};user-select:none;transition:all .15s;display:inline-flex;align-items:center;">${escHtml(opt)}${delBtn}</span>`;
  }).join('');
  chipDiv.innerHTML = chipHtml +
    `<span onclick="_clLightDescAddCustom()" style="cursor:pointer;padding:6px 12px;border-radius:20px;font-size:.88rem;border:1.5px dashed #cbd5e0;background:#f7fafc;color:#718096;user-select:none;">＋ 新增</span>`;
}

function _clLightDescSelect(opt) {
  const idx = _clLightDescSelected.indexOf(opt);
  if (idx >= 0) _clLightDescSelected.splice(idx, 1);
  else _clLightDescSelected.push(opt);
  _clLightDescRender();
}

function _onLightChange(light) {
  const preset = _CL_LIGHT_DESC_PRESETS.find(p => p.light === light);
  _clLightDescSelected = preset ? [preset.text] : [];
  _clLightDescRender();
}

function _clLightDescGet() { return _clLightDescSelected.join('、'); }

function _clLightDescSet(val, light) {
  if (val) {
    _clLightDescSelected = val.split('、').filter(Boolean);
  } else {
    const preset = _CL_LIGHT_DESC_PRESETS.find(p => p.light === light);
    _clLightDescSelected = preset ? [preset.text] : [];
  }
  _clLightDescRender();
}

async function _clLightDescAddCustom() {
  const v = prompt('請輸入新的狀態說明：');
  if (!v || !v.trim()) return;
  const trimmed = v.trim();
  const all = [..._CL_LIGHT_DESC_PRESETS.map(p => p.text), ...(configData?.closureLightDescCustomOpts || [])];
  if (all.includes(trimmed)) { alert('此選項已存在。'); return; }
  if (!configData.closureLightDescCustomOpts) configData.closureLightDescCustomOpts = [];
  configData.closureLightDescCustomOpts.push(trimmed);
  _clLightDescSelected.push(trimmed);
  _clLightDescRender();
  driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});
}

async function _clLightDescDeleteCustom(opt) {
  if (!confirm(`確定要刪除「${opt}」？此為全系統共享選項。`)) return;
  const idx = (configData.closureLightDescCustomOpts || []).indexOf(opt);
  if (idx >= 0) configData.closureLightDescCustomOpts.splice(idx, 1);
  const ri = _clLightDescSelected.indexOf(opt);
  if (ri >= 0) _clLightDescSelected.splice(ri, 1);
  _clLightDescRender();
  driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});
}

// ── 結案日期（4-4）──────────────────────────────────────────────────────────
function _clDateModeChange(mode) {
  const sel = document.getElementById('cl-date-session-select');
  const custom = document.getElementById('cl-date-custom');
  const todayEl = document.getElementById('cl-date-today-display');
  if (sel) sel.style.display = mode === 'session' ? '' : 'none';
  if (custom) custom.style.display = mode === 'custom' ? '' : 'none';
  if (todayEl) {
    if (mode === 'today') { todayEl.textContent = new Date().toISOString().slice(0, 10); todayEl.style.display = ''; }
    else todayEl.style.display = 'none';
  }
}

function _clDateGet() {
  const mode = document.querySelector('input[name="cl-date-mode"]:checked')?.value || 'session';
  if (mode === 'session') return document.getElementById('cl-date-session-select')?.value || '';
  if (mode === 'custom') return document.getElementById('cl-date-custom')?.value || '';
  return new Date().toISOString().slice(0, 10);
}

function _clDateSet(val, evalSem, caseRecords) {
  const dates = (caseRecords || [])
    .filter(r => r.date && !r.deleted && openDateToSemPrefix(r.date) === _semKeyBase(evalSem))
    .map(r => r.date)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort().reverse();
  const sel = document.getElementById('cl-date-session-select');
  if (sel) {
    sel.innerHTML = dates.length
      ? dates.map(d => `<option value="${escHtml(d)}">${d}</option>`).join('')
      : `<option value="">（本學期無晤談紀錄）</option>`;
  }
  if (!val) {
    const r = document.querySelector('input[name="cl-date-mode"][value="session"]');
    if (r) { r.checked = true; _clDateModeChange('session'); }
    if (sel && dates.length) sel.value = dates[0];
    return;
  }
  if (dates.includes(val)) {
    const r = document.querySelector('input[name="cl-date-mode"][value="session"]');
    if (r) { r.checked = true; _clDateModeChange('session'); }
    if (sel) sel.value = val;
  } else if (val === new Date().toISOString().slice(0, 10)) {
    const r = document.querySelector('input[name="cl-date-mode"][value="today"]');
    if (r) { r.checked = true; _clDateModeChange('today'); }
  } else {
    const r = document.querySelector('input[name="cl-date-mode"][value="custom"]');
    if (r) { r.checked = true; _clDateModeChange('custom'); }
    const ci = document.getElementById('cl-date-custom');
    if (ci) ci.value = val;
  }
}

// ── 後續安排（4-12/4-13）────────────────────────────────────────────────────


function _clFollowupChange(type, checked) {
  const wrap = document.getElementById('cl-transfer-counselor-wrap');
  const sel  = document.getElementById('cl-transfer-counselor');
  if (checked) {
    if (type === 'self') {
      document.getElementById('cl-cb-internal-transfer').checked = false;
      if (wrap) wrap.style.display = 'none';
    } else {
      document.getElementById('cl-cb-followup-self').checked = false;
      if (wrap) wrap.style.display = '';
      if (sel) sel.innerHTML = buildCounselorOptgroups();
    }
    const msg = type === 'self' ? '✔ 已標記為原主責續接' : '✔ 已標記為內部轉案，請選擇轉案輔導人員';
    const n = document.getElementById('cl-followup-notice');
    if (n) { n.textContent = msg; n.style.display = ''; }
  } else {
    if (type === 'transfer' && wrap) wrap.style.display = 'none';
    const selfOn = document.getElementById('cl-cb-followup-self')?.checked;
    const transOn = document.getElementById('cl-cb-internal-transfer')?.checked;
    if (!selfOn && !transOn) {
      const n = document.getElementById('cl-followup-notice');
      if (n) n.style.display = 'none';
    }
  }
}

function _clFollowupGet() {
  if (document.getElementById('cl-cb-followup-self')?.checked) return 'self';
  if (document.getElementById('cl-cb-internal-transfer')?.checked) {
    const counselorEmail = document.getElementById('cl-transfer-counselor')?.value || '';
    return counselorEmail ? `transfer:${counselorEmail}` : 'transfer';
  }
  return '';
}

function _clFollowupSet(val) {
  const s = document.getElementById('cl-cb-followup-self');
  const t = document.getElementById('cl-cb-internal-transfer');
  const wrap = document.getElementById('cl-transfer-counselor-wrap');
  const sel  = document.getElementById('cl-transfer-counselor');
  const n = document.getElementById('cl-followup-notice');
  if (s) s.checked = val === 'self';
  const isTransfer = val === 'transfer' || val?.startsWith('transfer:');
  if (t) t.checked = isTransfer;
  if (wrap) wrap.style.display = isTransfer ? '' : 'none';
  if (isTransfer && sel) {
    sel.innerHTML = buildCounselorOptgroups(); sel.value = val?.startsWith('transfer:') ? val.slice(9) : '';
  }
  if (n) {
    if (val === 'self') { n.textContent = '✔ 已標記為原主責續接'; n.style.display = ''; }
    else if (isTransfer) { n.textContent = '✔ 已標記為內部轉案，請選擇轉案輔導人員'; n.style.display = ''; }
    else n.style.display = 'none';
  }
}

// ── 切換評估類型（4-6）──────────────────────────────────────────────────────
function _switchEvalType() {
  _closureEvalType = _closureEvalType === 'closure' ? 'semester' : 'closure';
  const isClosure = _closureEvalType === 'closure';
  document.getElementById('closure-section-title').textContent = isClosure ? '質性描述與結案資訊' : '質性描述';
  document.getElementById('btn-print-eval').textContent = isClosure ? '列印結案評估' : '列印學期評估';
  const confirmBtn = document.getElementById('btn-confirm-closure');
  if (confirmBtn) { confirmBtn.textContent = isClosure ? '確認結案' : '儲存學期評估'; confirmBtn.className = isClosure ? 'btn btn-danger' : 'btn btn-primary'; }
  document.getElementById('cl-qualitative-closure').style.display = isClosure ? '' : 'none';
  document.getElementById('cl-qualitative-semester').style.display = isClosure ? 'none' : '';
  const dateSec = document.getElementById('cl-closure-date-section');
  if (dateSec) dateSec.style.display = '';
  const dateLabelEl = document.getElementById('cl-date-field-label');
  if (dateLabelEl) dateLabelEl.innerHTML = `${isClosure ? '結案日期' : '評估日期'}<span class="req">*</span>`;
}

// ── 既有評估參考卡（4-18）────────────────────────────────────────────────────
function _buildRefEvalHtml(evals) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lightMap = { '紅燈':'light-red','橙燈':'light-orange','黃燈':'light-yellow','綠燈':'light-green' };
  const id = 'closure-ref-eval-body';
  const items = evals.map(ev => {
    const typeLabel = (ev.type||'closure') === 'closure' ? '結案評估' : '學期評估';
    return `<div style="padding:6px 0;border-bottom:1px solid #f0f4f8;font-size:.84rem;">
      <span style="background:#ebf8ff;color:#2b6cb0;border-radius:3px;padding:1px 5px;font-size:.72rem;">${typeLabel}</span>
      <span style="margin-left:6px;color:#4a5568;">${esc(ev.evaluatorName||'—')}</span>
      <span style="margin-left:6px;color:#a0aec0;">${(ev.evaluatedAt||'').slice(0,10)}</span>
      ${ev.light ? `<span class="badge ${lightMap[ev.light]||'badge-gray'}" style="margin-left:6px;font-size:.74rem;">${esc(ev.light)}</span>` : ''}
      ${ev.closureReason ? `<div style="color:#718096;margin-top:2px;">結案原因：${esc(ev.closureReason)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div style="border:1px solid #bee3f8;border-radius:6px;background:#ebf8ff;">
    <div style="padding:8px 12px;cursor:pointer;font-weight:600;font-size:.86rem;display:flex;justify-content:space-between;" onclick="const b=document.getElementById('${id}');b.style.display=b.style.display===''?'none':'';this.querySelector('span').textContent=b.style.display===''?'▲':'▶'">
      📋 參考既有評估（${evals.length} 份）<span>▶</span>
    </div>
    <div id="${id}" style="display:none;padding:8px 12px;">${items}</div>
  </div>`;
}

// v185：原本按「取消」會靜默把草稿寫入 localStorage（scc_closure_draft_<caseId>，無離開詢問）。
// 改為：無實際輸入直接離開；有輸入則跳 _showExitDialog 讓使用者選擇儲存/暫存草稿至待辦/捨棄離開。
function _exitClosureEvalSilent() {
  _stopClosureDraftAutosave();
  try { localStorage.removeItem(_closureDraftKey()); } catch(_) {}
  try { localStorage.removeItem('scc_closure_draft_' + _closureCaseId); } catch(_) {} // 舊版（v185 前）殘留 key 一併清
  _closureEvalDraft = null;
  _closureDraftTodoId = null;
  if (_closureCaseId) showCaseDetail(_closureCaseId);
  else backToCaseList();
}

function cancelClosureEval() {
  if (!_gdIsDirty('closure', _closureFormSnapshot())) { _exitClosureEvalSilent(); return; }
  _showExitDialog(_closureEvalType === 'closure' ? '離開結案評估表' : '離開學期評估表',
    () => saveClosureEval(),
    () => _draftClosureEval(),
    () => _exitClosureEvalSilent()
  );
}

function _draftClosureEval() {
  const snap = _closureFormSnapshot();
  const c = casesData.find(x => x.id === _closureCaseId);
  const label = _closureEvalType === 'closure' ? '結案評估草稿' : '學期評估草稿';
  const existingTodo = _closureDraftTodoId ? todosData.find(t => t.id === _closureDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'closure_draft', label,
    caseId: _closureCaseId, caseLabel: c ? `${c.name}（${_closureCaseId}）` : (_closureCaseId || ''),
    draftData: { caseId: _closureCaseId, evalType: _closureEvalType, snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopClosureDraftAutosave();
  try { localStorage.removeItem(_closureDraftKey()); } catch(_) {}
  try { localStorage.removeItem('scc_closure_draft_' + _closureCaseId); } catch(_) {}
  _closureEvalDraft = null;
  _closureDraftTodoId = null;
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function _buildEvalPrintHtml(c, ev, formTitle) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const rocDate = d => { if(!d) return ''; const p=(d||'').slice(0,10).split('-'); return p.length===3?`${parseInt(p[0])-1911}/${parseInt(p[1])}/${parseInt(p[2])}`:d; };
  const lightColor = { '紅燈':'#c53030','橙燈':'#dd6b20','黃燈':'#b7791f','綠燈':'#276749' };
  const _pDimColor = lvl => ['1','低'].includes(lvl)?'#276749':['2','3','中'].includes(lvl)?'#dd6b20':['4','5','高'].includes(lvl)?'#c53030':'#718096';
  const _dimLevelLabel = v => ({'1':'1低','2':'2中','3':'3中','4':'4高','5':'5高','無':'無','不清楚':'不清楚'}[v] || v || '—');
  const dimRows = (ev.dimensions||[]).map((d,i) => {
    const expText = _getDimExp(i, d.level);
    return `<tr><td style="padding:5px 8px;font-size:12pt;">${i+1}. ${esc(d.label)}${expText ? `<div style="font-size:10pt;color:#555;margin-top:3px;">${esc(expText)}</div>` : ''}</td>
     <td style="padding:5px 8px;text-align:center;font-size:12pt;font-weight:700;color:${_pDimColor(d.level)};vertical-align:top;">${esc(_dimLevelLabel(d.level))}</td></tr>`;
  }).join('');
  const qualSection = (ev.chiefComplaint || ev.assessment || ev.treatmentProvided)
    ? `<div class="section">
         <div class="label" style="font-weight:700;margin-bottom:6px;">個案主訴問題</div>
         <div class="desc">${renderMaybeHtml(ev.chiefComplaint||'')}</div>
       </div>
       <div class="section">
         <div class="label" style="font-weight:700;margin-bottom:6px;">評估（可依認知、情緒、行為、內在需要等面向）</div>
         <div class="desc">${renderMaybeHtml(ev.assessment||'')}</div>
       </div>
       <div class="section">
         <div class="label" style="font-weight:700;margin-bottom:6px;">已提供之輔導處遇</div>
         <div class="desc">${renderMaybeHtml(ev.treatmentProvided||'')}</div>
       </div>`
    : `<div class="section">
         <div class="label">質性描述（主訴問題與評估）</div>
         <div class="desc">${renderMaybeHtml(ev.description||'')}</div>
       </div>`;
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
  <title>${esc(formTitle)} - ${esc(c.name)}</title>
  <style>
    body { font-family:'微軟正黑體','Microsoft JhengHei',sans-serif; font-size:12pt; margin:20mm 18mm; color:#1a1a1a; }
    h2 { text-align:center; font-size:15pt; margin-bottom:4px; }
    .meta { text-align:center; font-size:10pt; color:#555; margin-bottom:18px; }
    table { width:100%; border-collapse:collapse; margin-bottom:14px; }
    th { background:#f0f4f8; padding:6px 8px; font-size:10.5pt; text-align:left; border:1px solid #ccc; }
    td { border:1px solid #ccc; vertical-align:top; }
    .label { font-size:9.5pt; color:#666; margin-bottom:2px; }
    .section { margin-bottom:14px; }
    .desc { font-size:10.5pt; border:1px solid #ccc; padding:8px; min-height:50px; }
    @media print { body { margin:15mm 14mm; } }
  </style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div>
  <h2>國立屏東科技大學學生諮商中心 ${esc(formTitle)}</h2>
  <div class="meta">個案姓名：${esc(c.name)} &ensp;|&ensp; 案號：${esc(c.id)} &ensp;|&ensp; 主責：${esc(c.counselorName||configData?.users?.[c.counselorEmail]?.name||c.counselorEmail||'—')}${ev.closureDate?` &ensp;|&ensp; ${(ev.type||'closure')==='closure'?'結案日期':'評估日期'}：${rocDate(ev.closureDate)}`:''} &ensp;|&ensp; 填表日期：${rocDate(ev.evaluatedAt)}</div>
  <div class="section">
    <table>
      <thead><tr><th style="width:80%;">向度</th><th style="width:20%;text-align:center;">風險等級</th></tr></thead>
      <tbody>${dimRows}</tbody>
    </table>
  </div>
  <div class="section">
    <table>
      <tr><th style="width:25%;">狀態燈號</th><th style="width:35%;">狀態說明</th><th style="width:40%;">結案原因</th></tr>
      <tr>
        <td style="padding:8px;font-weight:700;font-size:12pt;color:${lightColor[ev.statusLight]||'#333'};">${esc(ev.statusLight||'—')}</td>
        <td style="padding:8px;">${esc(ev.lightDescription||'—')}</td>
        <td style="padding:8px;">${esc(ev.closureReason||'—')}</td>
      </tr>
    </table>
  </div>
  ${qualSection}
  <div style="margin-top:30px;display:flex;justify-content:flex-end;gap:60px;font-size:10.5pt;">
    <span>填表人：${esc(ev.evaluatorName||ev.evaluatorEmail||'—')}</span>
    <span>主責：${esc(c.counselorName||'—')}</span>
  </div>
  <script>window.onload=()=>{ window.print(); }<\/script>
  </body></html>`;
}

function printClosureEval(caseId, semIdx, semPrefix, evalId, mode = 'print') {
  const cid = caseId || _closureCaseId;
  const c = casesData.find(x => x.id === cid);
  if (!c) return;
  let ev, formTitle;
  if (evalId) {
    ev = (c.semesterEvaluations || []).find(e => e.evalId === evalId);
    formTitle = ev?.type === 'closure' ? '結案評估表' : '學期評估表';
  } else if (semIdx != null) {
    ev = (c.semesterEvaluations || [])[semIdx];
    formTitle = ev?.type === 'closure' ? '結案評估表' : '學期評估表';
  } else if (semPrefix) {
    ev = _getLatestActiveEval(c, semPrefix, 'closure');
    formTitle = '結案評估表';
    if (!ev && !(c.semesterEvaluations || []).some(e => e.type === 'closure' && !e.deletedAt && !e.replacedBy)) {
      ev = c.closureEvaluation;
    }
  } else {
    ev = c.closureEvaluation;
    formTitle = '結案評估表';
  }
  if (!ev) {
    alert(caseId == null && semIdx == null && semPrefix == null && evalId == null
      ? '請先儲存評估後再點選列印。'
      : '此學期尚無評估資料。');
    return;
  }
  const html = _buildEvalPrintHtml(c, ev, formTitle);
  _printViaIframe(html);
}

async function saveClosureEval() {
  const isClosure = _closureEvalType === 'closure';
  const light  = document.querySelector('input[name="cl-light"]:checked')?.value || '';
  const reason = _clReasonGet();

  const _closAlert = (msg) => {
    setAlert('closure-alert', 'error', msg);
    document.getElementById('closure-alert').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const lightDescription = _clLightDescGet();
  if (!light)            { _closAlert('請選擇狀態評估燈號。'); return; }
  if (!lightDescription) { _closAlert('請選擇狀態說明。'); return; }
  if (!reason)           { _closAlert('請選擇至少一個結案原因。'); return; }

  let evalPayload;
  if (isClosure) {
    const chiefComplaint    = getRichTextValue('cl-chief-complaint');
    const assessment        = getRichTextValue('cl-assessment');
    const treatmentProvided = getRichTextValue('cl-treatment');
    if (!chiefComplaint.replace(/<[^>]*>/g,'').trim())    { _closAlert('請填寫個案主訴問題。'); return; }
    if (!assessment.replace(/<[^>]*>/g,'').trim())        { _closAlert('請填寫評估內容。'); return; }
    if (!treatmentProvided.replace(/<[^>]*>/g,'').trim()) { _closAlert('請填寫已提供之輔導處遇。'); return; }
    const closureDate = _clDateGet();
    if (!closureDate) { _closAlert('請選擇結案日期。'); return; }
    evalPayload = { chiefComplaint, assessment, treatmentProvided, closureDate };
  } else {
    const description = getRichTextValue('cl-description');
    if (!description.replace(/<[^>]*>/g,'').trim()) { _closAlert('請填寫質性描述。'); return; }
    evalPayload = { description, closureDate: _clDateGet() };
  }
  const followup = _clFollowupGet();

  const dimensions = CLOSURE_DIMS.map((dim, i) => ({
    label: dim,
    level: document.querySelector(`input[name="dim-${i}"]:checked`)?.value || '不清楚',
  }));

  document.getElementById('btn-confirm-closure').disabled = true;

  const idx = casesData.findIndex(c => c.id === _closureCaseId);
  if (idx === -1) return;
  const caseId = _closureCaseId;
  const caseName = casesData[idx].name;

  const _evEmail = document.getElementById('cl-eval-counselor')?.value || currentUser.email;
  const evalData = {
    dimensions, statusLight: light, light, lightDescription,
    closureReason: reason, followup, ...evalPayload,
    evaluatorEmail: _evEmail,
    evaluatorName: configData?.users?.[_evEmail]?.name || currentUser.name,
    evaluatedAt: new Date().toISOString(),
  };
  const prev = {
    status: casesData[idx].status,
    semesterStatus: casesData[idx].semesterStatus ? { ...casesData[idx].semesterStatus } : undefined,
    closureEvaluation: casesData[idx].closureEvaluation,
    semesterEvaluations: casesData[idx].semesterEvaluations
      ? casesData[idx].semesterEvaluations.map(e => ({ ...e })) : undefined,
  };

  const evalSem = _closureEvalSem || currentSemesterPrefix();
  const evalType = isClosure ? 'closure' : 'semester';
  const newEvalId = _genEvalId();
  const editingId = _closureEditingEvalId;
  _closureEditingEvalId = null; // reset

  casesData[idx].updatedAt = new Date().toISOString();
  if (!casesData[idx].semesterStatus) casesData[idx].semesterStatus = {};
  casesData[idx].semesterStatus[evalSem] = 'closed';
  casesData[idx].status = _recomputeCaseStatus(casesData[idx]);
  if (!casesData[idx].semesterEvaluations) casesData[idx].semesterEvaluations = [];

  // 若是編輯模式：將舊 eval 標記為已取代
  if (editingId) {
    const oldEvalIdx = casesData[idx].semesterEvaluations.findIndex(e => e.evalId === editingId);
    if (oldEvalIdx >= 0) {
      casesData[idx].semesterEvaluations[oldEvalIdx].replacedBy = newEvalId;
      casesData[idx].semesterEvaluations[oldEvalIdx].replacedAt = new Date().toISOString();
    }
  }

  // 加入新 eval（不移除舊的）
  casesData[idx].semesterEvaluations.push({
    ...evalData, evalId: newEvalId, semester: evalSem, type: evalType,
    replacedFrom: editingId || null,
  });
  if (isClosure) casesData[idx].closureEvaluation = { ...evalData, evalId: newEvalId, semester: evalSem };

  // 樂觀更新：立即導回個案詳細
  _closureEvalDraft = null;
  _stopClosureDraftAutosave();
  try { localStorage.removeItem('scc_closure_draft_' + caseId); } catch {}
  try { localStorage.removeItem(_closureDraftKey()); } catch(_) {}
  if (_closureDraftTodoId) {
    const _cldt = todosData.find(t => t.id === _closureDraftTodoId);
    if (_cldt) { _cldt.done = true; _cldt.doneAt = new Date().toISOString(); }
    _closureDraftTodoId = null;
    saveUserTodos().catch(() => {});
  }
  renderCases();
  showCaseDetail(caseId);

  // 4-13: 內部轉案 → 建立派案 todo（不立即轉移，等待待辦確認）
  if (followup === 'transfer' || followup?.startsWith('transfer:')) {
    const transferEmail = followup?.startsWith('transfer:') ? followup.slice(9) : '';
    const transferName  = configData?.users?.[transferEmail]?.name || transferEmail || '';
    _putTodoItem({
      id: _genTodoId(), type: 'internal_transfer',
      label: `內部轉案派案：${caseName}（${caseId}）`,
      caseId, caseLabel: `${caseName}（${caseId}）`,
      assignedCounselor: transferEmail,
      assignedCounselorName: transferName,
      fromCounselor: currentUser.email,
      fromCounselorName: configData?.users?.[currentUser.email]?.name || currentUser.name,
      semester: _closureEvalSem,
      evalType,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      done: false, notifRead: false,
    });
    saveUserTodos().catch(() => {});
  }

  // 4-9: 紅橘燈評估通知主任
  if (light === '紅燈' || light === '橙燈') {
    const evalTypeLabel = isClosure ? '結案評估' : '學期評估';
    const directors = Object.entries(configData?.users || {})
      .filter(([, u]) => u.role === '主任').map(([email]) => email);
    directors.forEach(email => {
      addNotificationToUser(email, 'closure_high_risk', caseId, caseName,
        `個案「${caseName}（${caseId}）」${evalTypeLabel}為${light}，請注意後續關懷`);
    });
    _flushNotifOps().catch(() => {});
  }

  // 背景儲存
  const jobId = bgJobAdd(isClosure ? '儲存結案評估' : '儲存學期評估', caseName);
  _armSaveFailSnapshot(isClosure ? '結案評估表' : '學期評估表', 'page-closure-eval',
    () => openClosureEvalPage(caseId, evalType, editingId), saveClosureEval, jobId);
  (async () => {
    try {
      await saveCasesChunks(caseId);
      bgJobDone(jobId);
      _clearSaveFailSnapshot(jobId);
      auditLog(isClosure ? '執行結案' : '儲存學期評估', caseId, null, semesterLabel(evalSem) + '學期');
      // 4-12: 原主責續接 → 同案號新增下學期
      if (followup === 'self') {
        const _srcCase = casesData.find(x => x.id === caseId);
        if (_srcCase) {
          const _nextSem = nextSemesterPrefix(evalSem);
          if (!_srcCase.semesters) _srcCase.semesters = [openDateToSemPrefix(_srcCase.openDate)].filter(Boolean);
          const _selfJobId = bgJobAdd('原主責續接 – 新增學期', _srcCase.name);
          (async () => {
            try {
              if (!_srcCase.semesters.includes(_nextSem)) {
                _srcCase.semesters.push(_nextSem); _srcCase.semesters.sort();
                if (!_srcCase.basicInfoSnapshots) _srcCase.basicInfoSnapshots = {};
                if (!_srcCase.basicInfoSnapshots[_nextSem]) {
                  const _snap = [..._srcCase.semesters].slice(0,-1).reverse().find(s => _srcCase.basicInfoSnapshots?.[s]);
                  if (_snap) _srcCase.basicInfoSnapshots[_nextSem] = { ..._srcCase.basicInfoSnapshots[_snap] };
                }
                _srcCase.updatedAt = new Date().toISOString();
                const _selfCfgOps = [];
                Object.entries(configData?.users||{}).forEach(([email, info]) => {
                  if (!(info.allowedCases||[]).includes(caseId)) return;
                  const _ms = info.allowedCasesSems?.[caseId];
                  if (_ms && !_ms.includes(_nextSem)) {
                    _ms.push(_nextSem);
                    _selfCfgOps.push({ type: 'caseAccessSemsSet', email, caseId, sems: [..._ms] });
                  }
                });
                bgJobProgress(_selfJobId, 50);
                await saveCasesChunks(caseId);
                if (_selfCfgOps.length) await _configCasesPatch(_selfCfgOps);
                auditLog('原主責續接', caseId, null, `新增 ${semesterLabel(_nextSem)} 學期`);
                bgJobDone(_selfJobId, `${semesterLabel(_nextSem)} 學期已加入 ${caseId}`);
                renderCases();
                showCaseDetail(caseId);
              } else {
                bgJobDone(_selfJobId, `${semesterLabel(_nextSem)} 學期已存在（${caseId}），略過`);
              }
            } catch(e) {
              bgJobFail(_selfJobId, e.message);
              if (_srcCase.semesters) _srcCase.semesters = _srcCase.semesters.filter(s => s !== _nextSem);
              if (_srcCase.basicInfoSnapshots) delete _srcCase.basicInfoSnapshots[_nextSem];
            }
          })();
        }
      }
    } catch (err) {
      bgJobFail(jobId, err.message);
      const ri = casesData.findIndex(x => x.id === caseId);
      if (ri !== -1) {
        casesData[ri].status = prev.status;
        casesData[ri].semesterStatus = prev.semesterStatus;
        casesData[ri].closureEvaluation = prev.closureEvaluation;
        casesData[ri].semesterEvaluations = prev.semesterEvaluations;
      }
      _showSaveFailModal(err.message, jobId);
    }
  })();
}

function backToCaseList() {
  _detailReturnToNewCase = false; // 一般返回列表：離開詳細頁，清掉「返回繼續新增個案」旗標
  showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
}

// #7：從「新增個案」頁按「查看現有案號」進入詳細頁時，返回動線改回新增個案頁，且不得重置表單內容
// （page-new-case 是獨立 page div，內容仍在 DOM，這裡只切換顯示的 page，不呼叫 openNewCasePage()）
function _detailBackToNewCase() {
  _detailReturnToNewCase = false;
  showPage('page-new-case', null);
}
// 個案詳細頁的「返回」按鈕：依 _detailReturnToNewCase 旗標切換文字與行為
function _renderDetailBackBtn() {
  const btn = document.getElementById('btn-detail-back');
  if (!btn) return;
  if (_detailReturnToNewCase) {
    btn.textContent = '← 返回繼續新增個案';
    btn.onclick = _detailBackToNewCase;
  } else {
    btn.textContent = '← 返回列表';
    btn.onclick = backToCaseList;
  }
}

function closeCaseConfirm(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const evalSem = _caseDetailActiveSem || currentSemesterPrefix();
  const existingClosure  = _getLatestActiveEval(c, evalSem, 'closure');
  const existingSemester = _getLatestActiveEval(c, evalSem, 'semester');
  if (existingClosure || existingSemester) {
    showEvalExistingModal(caseId, evalSem, existingClosure, existingSemester);
  } else {
    showEvalTypeModal(caseId, evalSem);
  }
}

function nextSemesterPrefix(prefix) {
  if (!prefix) return prefix;
  const hashIdx = prefix.indexOf('#');
  const base = hashIdx === -1 ? prefix : prefix.slice(0, hashIdx);
  if (base.length < 4) return prefix;
  const semType = base.slice(-1);
  const rocYear = parseInt(base.slice(0, -1));
  return semType === '1' ? `${rocYear}2` : `${rocYear + 1}1`;
}
function prevSemesterPrefix(prefix) {
  if (!prefix) return prefix;
  const hashIdx = prefix.indexOf('#');
  const base = hashIdx === -1 ? prefix : prefix.slice(0, hashIdx);
  if (base.length < 4) return prefix;
  const semType = base.slice(-1);
  const rocYear = parseInt(base.slice(0, -1));
  return semType === '1' ? `${rocYear - 1}2` : `${rocYear}1`;
}

function _semPrefixToApproxDate(prefix) {
  const hashIdx = prefix ? prefix.indexOf('#') : -1;
  const base = !prefix ? '' : (hashIdx === -1 ? prefix : prefix.slice(0, hashIdx));
  if (!base || base.length < 4) return new Date().toISOString().slice(0, 10);
  const rocYear = parseInt(base.slice(0, -1));
  const adYear  = rocYear + 1911;
  return base.slice(-1) === '1' ? `${adYear}-09-01` : `${adYear + 1}-02-01`;
}
function _semPrefixToEndDate(prefix) {
  const hashIdx = prefix ? prefix.indexOf('#') : -1;
  const base = !prefix ? '' : (hashIdx === -1 ? prefix : prefix.slice(0, hashIdx));
  if (!base || base.length < 4) return new Date().toISOString().slice(0, 10);
  const rocYear = parseInt(base.slice(0, -1));
  const adYear  = rocYear + 1911;
  return base.slice(-1) === '1' ? `${adYear + 1}-01-31` : `${adYear + 1}-07-31`;
}

function showNewSemModal(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const curSem = currentSemesterPrefix();
  // #35 需求1：以「當前學期」為中心，固定提供 前2學期、前1學期、當前學期、後1學期 共 4 個選項，預設選中當前學期
  const candidates = [
    prevSemesterPrefix(prevSemesterPrefix(curSem)),
    prevSemesterPrefix(curSem),
    curSem,
    nextSemesterPrefix(curSem),
  ];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:360px;">
      <div class="modal-header"><h3>新學期開案</h3></div>
      <div class="modal-body" style="padding:12px 0;">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:12px;">個案：<strong>${escHtml(c.name)}（${escHtml(c.id)}）</strong></p>
        <label class="field-label">選擇開案學期</label>
        <select class="field-input" id="new-sem-select">
          ${candidates.map(sem => `<option value="${escHtml(sem)}"${sem===curSem?' selected':''}>${escHtml(semesterLabel(sem))}</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" onclick="addCaseSemester('${escHtml(caseId)}')">確認開案</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function addCaseSemester(caseId) {
  const semEl = document.getElementById('new-sem-select');
  if (!semEl) return;
  const sem = semEl.value;
  const c = casesData.find(x => x.id === caseId);
  if (!c || !sem) return;
  document.querySelector('.modal-overlay')?.remove();
  if (!c.semesters) c.semesters = [openDateToSemPrefix(c.openDate)].filter(Boolean);
  if (!c.semesters.includes(sem)) c.semesters.push(sem);
  c.semesters.sort();
  // Copy latest available basicInfoSnapshot as starting point
  if (!c.basicInfoSnapshots) c.basicInfoSnapshots = {};
  if (!c.basicInfoSnapshots[sem]) {
    const sortedSnaps = c.semesters.slice(0, -1).filter(s => c.basicInfoSnapshots[s]).pop();
    if (sortedSnaps) c.basicInfoSnapshots[sem] = { ...c.basicInfoSnapshots[sortedSnaps] };
  }
  c.updatedAt = new Date().toISOString();
  // 個案管理員繼承：若管理員有學期限制，自動將新學期加入可閱覽範圍
  // caseAccessSemsSet 一個 op 對應一位使用者（同批送出，後端鎖內逐一套用）；沒有學期限制的
  // 管理員（sems 為 undefined，不限學期）不受影響，不需送 op。
  const _acsOps = [];
  Object.entries(configData?.users || {}).forEach(([email, info]) => {
    if (!(info.allowedCases || []).includes(caseId)) return;
    const sems = info.allowedCasesSems?.[caseId];
    if (sems && !sems.includes(sem)) {
      sems.push(sem);
      _acsOps.push({ type: 'caseAccessSemsSet', email, caseId, sems: [...sems] });
    }
  });
  showLoading(`新學期開案中（${semesterLabel(sem)}）…`);
  const jobId = bgJobAdd('新學期開案', c.name);
  (async () => {
    try {
      bgJobProgress(jobId, 40);
      await saveCasesChunks(caseId);
      bgJobProgress(jobId, 80);
      if (_acsOps.length) await _configCasesPatch(_acsOps);
      auditLog('新學期開案', caseId, null, semesterLabel(sem) + '學期');
      bgJobDone(jobId);
      _caseDetailActiveSem = sem;
      hideLoading();
      renderCases();
      showCaseDetail(caseId);
    } catch(e) {
      hideLoading();
      bgJobFail(jobId, e.message);
      showToast('個案管理員學期範圍繼承儲存失敗：' + e.message + '，請重新整理頁面確認狀態。', 'error', 6000);
    }
  })();
}

function deleteCaseSemData(caseId, sem) {
  const c = casesData.find(x => x.id === caseId);
  if (!c || !sem) return;
  const semMonths_ = semesterMonths(sem);
  // #35：若刪的是 #N 分身、且同 base 學期還有其他開案 key 存在，紀錄仍歸屬存活的開案，此處不擋刪除；
  // 只有刪除該 base 學期「最後一筆開案」時才需保護（該學期有紀錄則不可刪）
  const _semBaseChk = _semKeyBase(sem);
  const _isLastOpenForBase = !(c.semesters || []).some(k => k !== sem && _semKeyBase(k) === _semBaseChk);
  const hasRec = _isLastOpenForBase && (c.records||[]).some(r => !r.deleted && semMonths_.includes((r.date||'').slice(0,7)));
  if (hasRec) { alert('此學期已有個案紀錄，無法刪除此學期基本資料。'); return; }
  if (!confirm(`確定要刪除「${semesterLabel(sem)}」的基本資料快照嗎？\n此操作無法復原。`)) return;

  if (c.basicInfoSnapshots) delete c.basicInfoSnapshots[sem];
  if (c.semesters) {
    c.semesters = c.semesters.filter(s => s !== sem);
    if (!c.semesters.length) c.semesters = [openDateToSemPrefix(c.openDate)].filter(Boolean);
  }
  if (c.semesterEvaluations) c.semesterEvaluations = c.semesterEvaluations.filter(e => e.semester !== sem);
  if (c.semesterStatus) delete c.semesterStatus[sem];
  // 同學期再次開案對稱重編（#35）：刪除其中一筆後，同 base 學期剩下的 key 要遞補／恢復無後綴
  // （只剩 1 筆時一律無後綴；3 筆以上刪中間那筆時後面依序遞補，不留號碼空缺）
  {
    const _semBase35 = _semKeyBase(sem);
    _applySemKeyRenumber(c, _renumberSemKeys(_semBase35, (c.semesters || []).filter(k => _semKeyBase(k) === _semBase35)));
  }
  c.status = _recomputeCaseStatus(c);
  c.updatedAt = new Date().toISOString();
  // Switch active sem to remaining latest before navigating
  const remaining = (c.semesters||[]).slice().sort();
  _caseDetailActiveSem = remaining[remaining.length - 1] || null;
  renderCases();
  showCaseDetail(caseId);
  const jobId = bgJobAdd('刪除學期基本資料', c.name);
  (async () => {
    try {
      await saveCasesChunks(caseId);
      auditLog('刪除學期基本資料', caseId);
      bgJobDone(jobId);
    } catch(e) { bgJobFail(jobId, e.message); }
  })();
}

// 計算個案的整體 status（由最新學期的 semesterStatus 推導）
function _recomputeCaseStatus(c) {
  const sems = (c.semesters || [openDateToSemPrefix(c.openDate)]).filter(Boolean).sort();
  const latestSem = sems[sems.length - 1];
  if (!latestSem) return c.status || 'active';
  return (c.semesterStatus || {})[latestSem] || 'active';
}

function _semLightStyle(c, sem) {
  const status = c.semesterStatus?.[sem] ?? (c.status === 'closed' ? 'closed' : 'active');
  const hasTypedClosures = (c.semesterEvaluations || []).some(e => e.type === 'closure' && !e.deletedAt && !e.replacedBy);
  const ev = _getLatestActiveEval(c, sem, 'closure')
    || (!hasTypedClosures ? (c.closureEvaluation || null) : null);
  const lightVal = ev?.light || ev?.statusLight || '';
  const styles = {
    '紅燈': { bg:'#fde8e8', border:'#fc8181', color:'#c0392b' },
    '橙燈': { bg:'#fdebd0', border:'#f6ad55', color:'#9c4a00' },
    '黃燈': { bg:'#fef9e7', border:'#ecc94b', color:'#7d6608' },
    '綠燈': { bg:'#d5f5e3', border:'#68d391', color:'#1d6a3a' },
  };
  if (styles[lightVal]) return styles[lightVal];
  if (status !== 'closed') {
    const curSem = currentSemesterPrefix();
    if (sem && sem < curSem) return { bg:'#f3e8ff', border:'#a855f7', color:'#6b21a8' };
    return { bg:'#ebf8ff', border:'#63b3ed', color:'#2b6cb0' };
  }
  return { bg:'#f0f4f8', border:'#cbd5e0', color:'#718096' };
}
async function restoreDeletedEval(caseId, evalId) {
  const idx = casesData.findIndex(c => c.id === caseId);
  if (idx === -1) return;
  const eIdx = (casesData[idx].semesterEvaluations || []).findIndex(e => e.evalId === evalId);
  if (eIdx < 0) return;
  const prevEval = { ...casesData[idx].semesterEvaluations[eIdx] };
  casesData[idx].semesterEvaluations[eIdx].deletedAt = null;
  showCaseDetail(caseId);
  const jobId = bgJobAdd('還原評估表', casesData[idx].name);
  (async () => {
    try {
      await saveCasesChunks(caseId);
      bgJobDone(jobId);
      auditLog('還原評估表', caseId, null, evalId);
    } catch (err) {
      bgJobFail(jobId, err.message);
      const ri = casesData.findIndex(x => x.id === caseId);
      if (ri !== -1 && casesData[ri].semesterEvaluations?.[eIdx]) {
        casesData[ri].semesterEvaluations[eIdx] = prevEval;
        showCaseDetail(caseId);
      }
    }
  })();
}
async function softDeleteEval(caseId, evalId) {
  if (!confirm('確定要刪除此評估表嗎？資料將保留 30 日。')) return;
  const idx = casesData.findIndex(c => c.id === caseId);
  if (idx === -1) return;
  const eIdx = (casesData[idx].semesterEvaluations || []).findIndex(e => e.evalId === evalId);
  if (eIdx < 0) return;
  const prevEval = { ...casesData[idx].semesterEvaluations[eIdx] };
  casesData[idx].semesterEvaluations[eIdx].deletedAt = new Date().toISOString();
  // 更新 backward compat closureEvaluation
  const deletedSem = casesData[idx].semesterEvaluations[eIdx].semester;
  const latestClosure = _getLatestActiveEval(casesData[idx], deletedSem, 'closure');
  if (latestClosure) casesData[idx].closureEvaluation = latestClosure;
  showCaseDetail(caseId);
  const jobId = bgJobAdd('刪除評估表', casesData[idx].name);
  (async () => {
    try {
      await saveCasesChunks(caseId);
      bgJobDone(jobId);
      auditLog('刪除評估表', caseId, null, evalId);
    } catch (err) {
      bgJobFail(jobId, err.message);
      const ri = casesData.findIndex(x => x.id === caseId);
      if (ri !== -1 && casesData[ri].semesterEvaluations?.[eIdx]) {
        casesData[ri].semesterEvaluations[eIdx] = prevEval;
        showCaseDetail(caseId);
      }
    }
  })();
}
// 判斷某學期是否「未結案」——不再單靠 semesterStatus 的預設 'active'，改為多重證據判斷
// Bug 背景：舊資料 c.semesterStatus 缺該學期的 key 時，舊邏輯 || 'active' 會誤判為未結案，
// 即便 c.semesterEvaluations 已有該學期的 closure、c.status 已經 'closed'，或整案已被視為 archived。
function _isSemesterUnclosed(c, sem) {
  const semSt = c.semesterStatus?.[sem];
  if (semSt === 'closed') return false;               // 明確結案
  if (semSt === 'active') return true;                // 明確進行中（就算 c.status=closed 也優先顯示為活動）
  // ── semesterStatus 該學期為 undefined（舊資料）→ 其他線索 ──
  const evals = Array.isArray(c.semesterEvaluations) ? c.semesterEvaluations : [];
  const hasClosureEvalForSem = evals.some(e =>
    e && e.type === 'closure' && !e.deletedAt && !e.replacedBy && e.semester === sem
  );
  if (hasClosureEvalForSem) return false;             // 有明確該學期的結案評估
  // 舊格式 closureEvaluation（不帶學期）+ 案僅一個學期 → 視為該學期已結案
  const semList = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)].filter(Boolean);
  if (c.closureEvaluation && !evals.length && semList.length === 1) return false;
  const latestSem = [...semList].sort().pop();
  // 最新學期 + c.status='closed' → 該學期已結案
  if (sem === latestSem && c.status === 'closed') return false;
  // 積極規則：整案 c.status='closed' 且該學期無任何 semesterStatus 記錄
  //   通常代表資料為舊資料（老案在系統升級前結案，未逐學期回填 semesterStatus）
  //   為避免持續無意義提醒，一律視為結案。若確實有未結案需求，可透過重開案／建立 closure eval 明確覆寫。
  if (c.status === 'closed' && semSt === undefined) return false;
  // 個案被封存（archived）通常表示不再服務 → 也不再提醒未結案
  if (c.archived) return false;
  return true; // 無任何結案證據 → 仍需提醒
}
function _hasPastUnclosed(c) {
  const curSem = currentSemesterPrefix();
  const sems = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)];
  return sems.some(s => s && s < curSem && _isSemesterUnclosed(c, s));
}
function _pastUnclosedSems(c) {
  const curSem = currentSemesterPrefix();
  const sems = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)];
  return sems.filter(s => s && s < curSem && _isSemesterUnclosed(c, s));
}
function _dismissUnclosedReminder() {
  const reminders = todosData.filter(t => t.type === 'unclosed_reminder' && !t.done);
  reminders.forEach(t => { t.notifRead = true; });
  if (reminders.length) saveUserTodos().catch(() => {});
  _syncTodoBadge();
  renderTodosPage();
}
function _toggleUnclosedSummary() {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  const cur = _userPref_('todosUnclosedCollapsed', false);
  syncUserPref_({ todosUnclosedCollapsed: !cur });
  renderTodosPage();
}

function goCasesPastUnclosed() {
  caseFilters.groups.status = new Set(['past_unclosed']);
  caseFilters.semester = '';
  const cfSemEl = document.getElementById('cf-semester');
  if (cfSemEl) cfSemEl.value = '';
  showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
  renderCases();
}

async function reopenCase(caseId, sem) {
  if (!confirm('確定要取消此學期的結案嗎？')) return;
  const idx = casesData.findIndex(c => c.id === caseId);
  if (idx === -1) return;
  // 若未指定學期，取該案最新學期（from case list 直接點重開案）
  const targetSem = sem || (() => {
    const sems = (casesData[idx].semesters || [openDateToSemPrefix(casesData[idx].openDate)]).filter(Boolean).sort();
    return sems[sems.length - 1] || currentSemesterPrefix();
  })();

  if (!casesData[idx].semesterStatus) casesData[idx].semesterStatus = {};
  const prevSemStatus = { ...casesData[idx].semesterStatus };
  const prevStatus = casesData[idx].status;

  casesData[idx].semesterStatus[targetSem] = 'active';
  casesData[idx].status = _recomputeCaseStatus(casesData[idx]);
  casesData[idx].updatedAt = new Date().toISOString();

  showCaseDetail(caseId);
  renderCases();
  const jobId = bgJobAdd('取消結案', casesData[idx]?.name || caseId);
  (async () => {
    try {
      bgJobProgress(jobId, 40);
      await saveCasesChunks(caseId);
      bgJobProgress(jobId, 90);
      auditLog('取消結案', caseId, null, semesterLabel(targetSem) + '學期');
      bgJobDone(jobId);
    } catch (err) {
      const ri = casesData.findIndex(x => x.id === caseId);
      if (ri !== -1) {
        casesData[ri].semesterStatus = prevSemStatus;
        casesData[ri].status = prevStatus;
        casesData[ri].updatedAt = new Date().toISOString();
      }
      bgJobFail(jobId, err.message);
      showCaseDetail(caseId);
      renderCases();
    }
  })();
}
