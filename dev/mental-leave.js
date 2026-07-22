// dev/mental-leave.js — 身心調適假渲染段（拆 index.html 絞殺者第十四刀，v260，本批最後一刀）。
// 內容為從 index.html 逐字搬出的函式，依原始順序分為六組：BSRS 總分計算（_mlaCalcBsrsTotal）、
// 身心狀態評估表本文渲染（_mlaRenderPageBody）、開啟評估表 modal（openMlAssessmentModal）、
// 儲存評估表（saveMlAssessment）、列印評估表（printMlAssessment，含內嵌 <style> 版型 HTML 字串），
// 以及身心調適假管理列表主渲染（_mlRenderRecordsTab，含篩選/分頁/圖示列/展開列/欄寬），共 6 個函式。
// 頂層無任何執行副作用（只有 function 宣告），本區塊亦無頂層 let/const 宣告需要一併搬移
// （column-0 複核：全數為 function/收尾大括號/註解/空行，未發現 addEventListener／IIFE／
// window.X=／裸呼叫）。
// 函式內部在呼叫時才會引用主檔全域可變狀態（mentalLeavesData／casesData／configData／
// currentUser／currentRole／extraRole／todosData／DRIVE_FOLDER_ID／_detailCaseId／
// _mlaCurrentAnchorId／_mlaCurrentReadOnly／_mlaDraftContacts／_mlaDraftTodoId／_mlShowArchived／
// _mlQFilter／_mlRiskFilter／_mlSemFilter／_mlHandlingFilter／_mlAbFilter／_mlConsec3Filter／
// _mlPageSize／_mlPage／_mlCheckedIds／_mlTab／_mlMyOnly 等，定義仍留在 index.html），以及主檔與
// 其他拆檔模組內的共用函式（_mlAssessCanView／_mlAssessCanEdit／_mlAssessAnchor／
// _mlAssessDefault／_mlAssessBsrsTotal／_mlAssessFillable／_mlAssessCountdownChip／
// _mlAddWorkdays／_mlaFormSnapshot／_mlaRenderContacts／_mlaDraftKey／_startMlaDraftAutosave／
// _stopMlaDraftAutosave／_mlGroupAndSort／_mlEffectiveRisk／_mlConsecutive3DayIds／
// _mlMatchKeywords／_mlParseDateRange／_mlCourseCount／_mlPeriodsSummary／_mlRowExpandHtml／
// _mlRiskOverrideSelect／_mlBuildAssessAnchors／_mlIsFullTimeStaff／_hasCaseInSem／
// _caseLatestAbType／_filterPanelMatch／_fpButtonHtml／_fpPanelHtml／_fpSyncPanel／
// _makeTableResizable／_printViaIframe／buildCounselorOptgroups／formatCounselorLabel／
// showPage／showCaseDetail（case-detail.js）／handlePrevPage／exitMlAssessment／
// renderMentalLeavePage／saveMentalLeaves／saveUserTodos／bgJobAdd／bgJobDone／bgJobFail／
// auditLog／showToast／_mlReconcileAssessmentTodos／_qocMaybeShowIncompleteReminder／
// adminOnlyChip（record-form.js）／_gdSetBaseline（draft-engine.js）／ML_ASSESS_BSRS_LABELS／
// ML_HANDLING_OPTS／ML_HANDLING_STYLE 等，皆定義於 index.html），以及 escHtml／semesterLabel／
// _bsrsOrderedLabels 定義於 utils.js，屬 call-time 解析，與其他拆檔模組（utils.js／ft-core.js／
// case-detail.js／case-import.js／initial-interview.js／psych-import.js／grad-eval.js／
// closure-eval.js／event-records.js／draft-engine.js／record-form.js）使用方式一致；經逐一
// 確認本檔內以上識別字全專案僅一處定義、無跨檔重複宣告。
// 單一來源固定本檔；index.html 以 <script src="mental-leave.js"></script> 載入（放在
// record-form.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// BSRS 按鈕組總分計算（仿新增個案 calcBsrsTotal，id 前綴 mla-，與 nc- 分開避免互相干擾）
function _mlaCalcBsrsTotal() {
  const ids = ['mla-bsrs-0','mla-bsrs-1','mla-bsrs-2','mla-bsrs-3','mla-bsrs-4'];
  let total = 0, hasSome = false;
  ids.forEach(id => { const v = document.getElementById(id)?.value; if (v !== '' && v !== undefined) { total += parseInt(v)||0; hasSome = true; } });
  const totalEl = document.getElementById('mla-total-score');
  if (totalEl) totalEl.textContent = hasSome ? total : '—';
  const suicideEl = document.getElementById('mla-suicide');
  const suicideScoreEl = document.getElementById('mla-suicide-score');
  if (suicideScoreEl) suicideScoreEl.textContent = (suicideEl && suicideEl.value !== '') ? suicideEl.value : '—';

  // v186：仿新增個案 calcBsrsTotal——五題＋自殺想法題皆未答時才顯示「個案皆未回答」勾選框；
  // 只要任一題有答即隱藏並清除勾選狀態
  const suicideHasVal = !!(suicideEl && suicideEl.value !== '');
  const _mlaBsrsAllUnanswered = !hasSome && !suicideHasVal;
  const _wrap = document.getElementById('mla-bsrs-unfilled-wrap');
  if (_wrap) {
    _wrap.style.display = _mlaBsrsAllUnanswered ? '' : 'none';
    if (!_mlaBsrsAllUnanswered) {
      const _cb = document.getElementById('mla-bsrs-unfilled');
      if (_cb) _cb.checked = false;
    }
  }
}
function _mlaRenderPageBody(anchor, mc, a, ro) {
  const dis = ro ? 'disabled' : '';
  const rd = (n, v, lbl, cur) => `<label style="margin-right:14px;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><input type="radio" name="${n}" value="${v}" ${cur===v?'checked':''} ${dis}> ${escHtml(lbl)}</label>`;
  const ck = (n, v, lbl, arr) => `<label style="margin-right:14px;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><input type="checkbox" name="${n}" value="${v}" ${(arr||[]).includes(v)?'checked':''} ${dis}> ${escHtml(lbl)}</label>`;
  const req = '<span class="req">*</span>'; // v183：.req 樣式已改為全域套用（不需 .field-label 祖先），故非 field-label 容器內可直接用 class="req"
  const _mlaGroupInfo = _mlGroupAndSort(mentalLeavesData.filter(x => !x.deleted && x.studentId === anchor.studentId)).find(g => g.records.some(r => r.id === anchor.id));
  const _mlaRangeLbl = _mlaGroupInfo?.isConsec3 ? '身心調適假連請三日以上期間' : '身心調適假日期（紅燈紀錄）';
  // v179：BSRS 改仿「＋新增個案」的點選按鈕組（.bsrs-btn-group/.bsrs-opt），題目沿用 ML_ASSESS_BSRS_LABELS
  // v186：評估表由輔導人員訪談填寫（非學生自填），首顆按鈕文字改「未答」以對齊語意（新增個案表單維持「未填」不動）
  const bsrsBtnGroup = (id, cur) => `<div class="bsrs-btn-group" data-id="${id}"><button type="button" class="bsrs-opt${(cur===null||cur===undefined)?' active':''}" data-val="" ${ro?'disabled':''}>未答</button>${[0,1,2,3,4].map(v=>`<button type="button" class="bsrs-opt${cur===v?' active':''}" data-val="${v}" ${ro?'disabled':''}>${v}</button>`).join('')}<input type="hidden" id="${id}" value="${(cur===null||cur===undefined)?'':cur}"></div>`;
  // v179：就醫史三列改整齊 grid（項目名 + 三個對齊選項欄）；v182：全欄必填，項目名附紅星
  const medGrid = (n, cur, rowLabel) => `<div style="display:grid;grid-template-columns:170px repeat(3,1fr);gap:6px 10px;align-items:center;padding:5px 0;border-bottom:1px solid #f7fafc;">
    <div style="font-size:.85rem;color:#2d3748;">${escHtml(rowLabel)}${req}</div>
    ${rd(n,'none','無',cur)}${rd(n,'paused','曾經，已中斷',cur)}${rd(n,'current','持續中',cur)}
  </div>`;
  // v182：主責輔導人員改下拉（A4）——重用 buildCounselorOptgroups（新增個案／派案表單既有的「啟用中輔導人員清單」helper），
  // 含空白選項（傳入 placeholder=''）；初始選取值於 openMlAssessmentModal 的 setTimeout 內設定（含「已連結個案→自動帶入目前主責」邏輯）
  const counselorSelectHtml = buildCounselorOptgroups(null, '');

  return `
    <div id="mla-validation-alert" style="display:none;background:#fff5f5;border:1.5px solid #fc8181;color:#822727;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.86rem;line-height:1.6;"></div>
    ${ro ? `<div style="background:#f7fafc;border:1px solid #cbd5e0;color:#4a5568;border-radius:6px;padding:8px 12px;margin-bottom:14px;font-size:.85rem;">此表單為唯讀檢視（僅身心調適假窗口、主任、系統管理者可編輯）。</div>` : ''}
    <div style="font-size:.8rem;color:#a0aec0;margin-bottom:10px;">${escHtml(_mlaRangeLbl)}：${escHtml(_mlaGroupInfo?.dateRange || '—')}</div>
    ${ro ? '' : `<div style="font-size:.78rem;color:#718096;margin-bottom:12px;"><span class="req">*</span> 為必填欄位</div>`}

    <div class="mla-vsec" id="mla-sec-top">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:10px;">
        <div><label class="field-label">姓名<span class="req">*</span></label><input type="text" class="field-input" id="mla-name" value="${escHtml(a.name)}" ${dis}></div>
        <div><label class="field-label">學號<span class="req">*</span></label><input type="text" class="field-input" id="mla-sid" value="${escHtml(a.studentId)}" ${dis}></div>
        <div>
          <label class="field-label">案號</label>
          <div id="mla-caseid-box" style="display:flex;align-items:center;gap:6px;">
            <div class="field-input" style="background:#f7fafc;color:#718096;flex:1;">${escHtml(mc?.id || '（尚未開案）')}</div>
            ${!mc ? `<button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" onclick="window._mlaQuickOpenCase('${escHtml(anchor.id)}')">快速開案</button>` : ''}
          </div>
        </div>
        <div><label class="field-label">收案日期<span class="req">*</span></label><input type="date" class="field-input" id="mla-collect-date" value="${escHtml(a.collectionDate)}" ${dis}></div>
        <div><label class="field-label">評估日期<span class="req">*</span></label><input type="date" class="field-input" id="mla-eval-date" value="${escHtml(a.evalDate)}" ${dis}></div>
      </div>
      <div style="margin-bottom:14px;">
        <label class="field-label">請假事由<span style="font-weight:400;font-size:.78rem;color:#a0aec0;margin-left:4px;">（資料來自信件擷取，唯讀）</span></label>
        <input type="text" class="field-input" id="mla-reason" value="${escHtml(anchor.reason || a.reason || '')}" readonly style="background:#f7fafc;color:#718096;">
      </div>
      <div style="margin-bottom:14px;">
        <label class="field-label">評估者備註（選填）</label>
        <textarea class="field-input" id="mla-assessor-note" rows="2" style="resize:vertical;" ${dis}>${escHtml(a.assessorNote||'')}</textarea>
      </div>
    </div>

    <div class="mla-vsec" id="mla-sec-contacts" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:6px;">聯繫時間<span style="font-weight:400;font-size:.8rem;color:#718096;">（可新增多筆，供日後統計聯繫次數；新增後除備註外皆為必填）</span></div>
      ${a.contactTime ? `<div style="font-size:.8rem;color:#a0aec0;margin-bottom:8px;">舊格式聯繫時間（唯讀）：${escHtml(a.contactTime)}</div>` : ''}
      <div id="mla-contacts-list"></div>
      ${ro ? '' : `<button type="button" class="btn btn-primary" style="margin-top:6px;font-size:.95rem;padding:8px 20px;" onclick="window._mlaContactAdd()">＋ 增加聯繫時間</button>`}
    </div>

    <div class="mla-vsec" id="mla-sec-bsrs" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:6px;">一、簡式健康量表（BSRS-5）${req}<span style="font-weight:400;font-size:.8rem;color:#718096;">請圈選最近一個星期（含今天）造成困擾的嚴重程度：0 不會／1 輕微／2 中等程度／3 嚴重／4 非常嚴重</span></div>
      ${_bsrsOrderedLabels(ML_ASSESS_BSRS_LABELS).map(({label,storageIdx},displayIdx)=>`<div style="margin-bottom:8px;"><label class="field-label">(${displayIdx+1}) ${escHtml(label)}<span class="req">*</span></label>${bsrsBtnGroup(`mla-bsrs-${storageIdx}`, a.bsrs?.[storageIdx] ?? null)}</div>`).join('')}
      <div style="margin-bottom:4px;"><label class="field-label" style="color:#c53030;">★有自殺的想法<span class="req">*</span></label>${bsrsBtnGroup('mla-suicide', a.suicide ?? null)}</div>
      <div style="margin-top:8px;font-size:.85rem;color:#4a5568;">(1) - (5) 題總分：<b id="mla-total-score">${_mlAssessBsrsTotal(a)}</b> 分　★自殺想法：<b id="mla-suicide-score">${a.suicide ?? '—'}</b> 分</div>
      <!-- v186：仿新增個案 nc-bsrs-unfilled-wrap——五題＋自殺想法題全部未答時才顯示，需勾選才能儲存；只要任一題有答即隱藏且不再要求 -->
      <div id="mla-bsrs-unfilled-wrap" style="display:none;margin-top:8px;padding:9px 12px;border:1.5px solid #f6ad55;background:#fffaf0;border-radius:6px;">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;color:#7b341e;cursor:pointer;font-size:.9rem;">
          <input type="checkbox" id="mla-bsrs-unfilled" ${a.bsrsUnanswered ? 'checked' : ''} ${dis} onchange="document.getElementById('mla-bsrs-unfilled-wrap').classList.remove('form-section-error')" style="width:18px;height:18px;" />
          個案皆未回答
        </label>
        <div style="font-size:.78rem;color:#975a16;margin-top:3px;margin-left:26px;">BSRS-5 五題與自殺想法題皆未回答時，請勾選確認為個案皆未回答（而非系統漏填），才能儲存評估表。</div>
      </div>
    </div>

    <div class="mla-vsec" id="mla-sec-med" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:6px;">二、就醫史${req}</div>
      ${medGrid('mla-med-psy', a.medPsychiatry, '1、精神科就醫經驗')}
      ${medGrid('mla-med-drug', a.medMedication, '2、服用精神藥物經驗')}
      ${medGrid('mla-med-counsel', a.medCounseling, '3、諮商輔導經驗')}
    </div>

    <div class="mla-vsec" id="mla-sec-support" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:8px;">三、支持系統${req}</div>
      <div class="mla-field-block">
        <div class="mla-field-lbl">1、與家人關係${req}</div>
        <div class="mla-field-opts">${rd('mla-family','close','緊密',a.familyRel)}${rd('mla-family','normal','一般',a.familyRel)}${rd('mla-family','distant','疏離',a.familyRel)}${rd('mla-family','conflict','衝突',a.familyRel)}${rd('mla-family','other','其他',a.familyRel)}<textarea rows="1" class="field-input mla-other-input" style="resize:vertical;" id="mla-family-other" placeholder="其他說明" ${dis}>${escHtml(a.familyRelOther)}</textarea></div>
      </div>
      <div class="mla-field-block">
        <div class="mla-field-lbl">2、伴侶${req}</div>
        <div class="mla-field-opts">${rd('mla-partner-has','yes','有',a.partnerHas)}${rd('mla-partner-has','no','無',a.partnerHas)}</div>
        <div id="mla-partner-type-box" class="mla-field-opts" style="margin-left:16px;margin-top:4px;">${rd('mla-partner-type','close','緊密',a.partnerType)}${rd('mla-partner-type','normal','一般',a.partnerType)}${rd('mla-partner-type','distant','疏離',a.partnerType)}${rd('mla-partner-type','conflict','衝突',a.partnerType)}${rd('mla-partner-type','other','其他',a.partnerType)}<textarea rows="1" class="field-input mla-other-input" style="resize:vertical;" id="mla-partner-other" placeholder="其他說明" ${dis}>${escHtml(a.partnerOther)}</textarea></div>
      </div>
      <div class="mla-field-block">
        <div class="mla-field-lbl">3、朋友${req}</div>
        <div class="mla-field-opts">${rd('mla-friend','withPeople','有朋友且願意讓他們陪伴',a.friendType)}${rd('mla-friend','notBother','有朋友，但不願意麻煩他們',a.friendType)}${rd('mla-friend','none','無朋友陪伴',a.friendType)}${rd('mla-friend','other','其他',a.friendType)}<textarea rows="1" class="field-input mla-other-input" style="resize:vertical;" id="mla-friend-other" placeholder="其他說明" ${dis}>${escHtml(a.friendOther)}</textarea></div>
      </div>
      <div class="mla-field-block">
        <div class="mla-field-lbl">4、師長${req}</div>
        <div class="mla-field-opts" style="flex-direction:column;align-items:flex-start;gap:5px;">
          ${rd('mla-teacher','know','___老師知道我的情形',a.teacherType)}
          ${rd('mla-teacher','dontWantKnow','我不願意讓___老師知道我的情形',a.teacherType)}
          ${rd('mla-teacher','dontKnow','___老師不知道我的情形',a.teacherType)}
          <div>${rd('mla-teacher','other','其他',a.teacherType)}<textarea rows="1" class="field-input mla-other-input" style="resize:vertical;" id="mla-teacher-other" placeholder="其他說明" ${dis}>${escHtml(a.teacherOther)}</textarea></div>
        </div>
        <div style="margin-top:6px;"><label class="field-label" style="display:inline;">老師稱謂（填入上方空格）</label> <input type="text" class="field-input" id="mla-teacher-name" style="max-width:160px;display:inline-block;" value="${escHtml(a.teacherName)}" ${dis}></div>
      </div>
    </div>

    <div class="mla-vsec" id="mla-sec-housing" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:14px;">
      <div style="font-weight:600;margin-bottom:8px;">四、住宿情形${req}</div>
      <div class="mla-field-block">
        <div class="mla-field-opts">${rd('mla-housing','alone','獨居',a.housing)}${rd('mla-housing','roommate','有室友',a.housing)}${rd('mla-housing','family','與家人同住',a.housing)}${rd('mla-housing','other','其他',a.housing)}<textarea rows="1" class="field-input mla-other-input" style="resize:vertical;" id="mla-housing-other" placeholder="其他說明" ${dis}>${escHtml(a.housingOther)}</textarea></div>
      </div>
    </div>

    <div class="mla-vsec" id="mla-sec-outcome" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-bottom:16px;">
      <div style="font-weight:600;margin-bottom:8px;">五、評估結果${req}</div>
      <label class="field-label">自由文字描述（選填）</label>
      <textarea class="field-input" id="mla-result-text" rows="2" style="resize:vertical;margin-bottom:10px;" placeholder="自由文字描述評估結果" ${dis}>${escHtml(a.resultText)}</textarea>
      <div class="mla-field-block">
        <div class="mla-field-opts">${rd('mla-outcome','counseling','進入諮商輔導流程',a.resultOutcome)}</div>
        <div id="mla-outcome-counseling-box" style="margin:4px 0 8px 16px;">
          <label class="field-label" style="display:inline;">主責輔導人員</label>
          <select class="field-select" id="mla-outcome-counselor" style="max-width:220px;display:inline-block;" ${dis}>${counselorSelectHtml}</select>
        </div>
        <div class="mla-field-opts">${rd('mla-outcome','noCase','不開案',a.resultOutcome)}</div>
        <div id="mla-outcome-nocase-box" style="margin:4px 0 0 16px;">
          <div style="font-size:.78rem;color:#718096;margin-bottom:3px;">（至少勾選一項）</div>
          ${ck('mla-nocase-reason','noRisk','暫無曝險之虞',a.resultNoCaseReasons)}<br>
          ${ck('mla-nocase-reason','riskNoWill','有風險但無意願，轉知主任或導師協助關懷',a.resultNoCaseReasons)}<br>
          ${ck('mla-nocase-reason','noContact','聯繫未果，轉知主任或導師協助關懷',a.resultNoCaseReasons)}
        </div>
      </div>
    </div>

    ${a.filledAt ? `<div style="font-size:.78rem;color:#a0aec0;margin-bottom:10px;">填表人：${escHtml(configData?.users?.[a.filledBy]?.name || a.filledByName || a.filledBy || '—')}　填表時間：${escHtml((a.filledAt||'').replace('T',' ').slice(0,16))}${a.updatedAt && a.updatedAt !== a.filledAt ? `　最後更新：${escHtml((a.updatedAt||'').replace('T',' ').slice(0,16))}` : ''}</div>` : ''}

    ${ro ? '' : `<div id="_mla-draft-status" style="font-size:.8rem;color:#718096;margin-bottom:6px;"></div>`}
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${ro ? '' : `<button class="btn btn-primary" onclick="saveMlAssessment('${escHtml(anchor.id)}')">儲存</button>`}
      ${anchor.assessment ? `<button class="btn btn-secondary" onclick="printMlAssessment('${escHtml(anchor.id)}')">列印</button>` : ''}
      <button class="btn btn-secondary" onclick="${ro ? 'handlePrevPage()' : 'exitMlAssessment()'}">${ro?'關閉':'取消'}</button>
    </div>
  `;
}
function openMlAssessmentModal(recordId, readOnly) {
  const l = mentalLeavesData.find(x => x.id === recordId);
  if (!l) return;
  if (!_mlAssessCanView(l.studentId)) { alert('您沒有權限使用此功能'); return; }
  const anchor = _mlAssessAnchor(l) || l;
  const mc = (casesData || []).find(c => !c.deleted && c.studentId === anchor.studentId);
  const a = { ..._mlAssessDefault(anchor, mc), ...(anchor.assessment || {}) };
  const ro = !!readOnly || !_mlAssessCanEdit(); // 非窗口/主任/管理者一律唯讀；危機閱讀等情境由呼叫端帶 readOnly
  _mlaCurrentAnchorId = anchor.id;
  _mlaCurrentReadOnly = ro;
  _mlaDraftContacts = JSON.parse(JSON.stringify(a.contacts || []));
  _mlaDraftTodoId = null; // v185：重置——若由「繼續編輯」草稿待辦重開，呼叫端會在本函式呼叫後另外設回對應 todoId
  const titleEl = document.getElementById('mla-page-title');
  if (titleEl) titleEl.textContent = `${ro ? '檢視' : (anchor.assessment ? '編輯' : '填寫')}身心狀態評估表${ro ? '（唯讀）' : ''}`;
  document.getElementById('mla-page-body').innerHTML = _mlaRenderPageBody(anchor, mc, a, ro);
  _mlaRenderContacts();
  showPage('page-ml-assess', null);
  setTimeout(() => {
    _mlaCalcBsrsTotal();
    const togglePartner = () => { const v = document.querySelector('[name="mla-partner-has"]:checked')?.value; const box = document.getElementById('mla-partner-type-box'); if (box) box.style.display = v==='yes' ? '' : 'none'; };
    document.querySelectorAll('[name="mla-partner-has"]').forEach(el => el.addEventListener('change', togglePartner));
    togglePartner();
    const toggleOutcome = () => {
      const v = document.querySelector('[name="mla-outcome"]:checked')?.value;
      const cBox = document.getElementById('mla-outcome-counseling-box');
      const nBox = document.getElementById('mla-outcome-nocase-box');
      if (cBox) cBox.style.display = v==='counseling' ? '' : 'none';
      if (nBox) nBox.style.display = v==='noCase' ? '' : 'none';
    };
    document.querySelectorAll('[name="mla-outcome"]').forEach(el => el.addEventListener('change', toggleOutcome));
    toggleOutcome();
    // v182 A4：主責輔導人員下拉初始值——已存值優先；未存過且該筆已連結個案 → 自動帶入該案目前主責；
    // 該案本來就無主責 → 留空白（見 dropdown 的空白選項）
    const counselorSel = document.getElementById('mla-outcome-counselor');
    if (counselorSel) {
      let initEmail = a.resultCounselorEmail || '';
      if (!initEmail && mc?.counselorEmail) initEmail = mc.counselorEmail;
      counselorSel.value = initEmail;
    }
    // v182 A7：驗證失敗後標示的 .form-section-error 高亮，使用者在該區塊內任何輸入/勾選/點擊都應解除標示；
    // 用「整頁委派監聽」取代逐欄位加 handler，涵蓋 BSRS 按鈕組、radio/checkbox、文字輸入等所有互動方式。
    // 用 dataset 旗標防止同一個常駐的 #mla-page-body 節點在多次開啟表單時重複綁定監聽。
    const pageBodyEl = document.getElementById('mla-page-body');
    if (pageBodyEl && !pageBodyEl.dataset.mlaErrClearBound) {
      pageBodyEl.dataset.mlaErrClearBound = '1';
      ['input', 'change', 'click'].forEach(evt => pageBodyEl.addEventListener(evt, (e) => {
        e.target.closest?.('.mla-vsec')?.classList.remove('form-section-error');
      }));
    }
    // v185：欄位（含下拉初始值）皆已就緒後才取基準快照；檢視唯讀模式不需要草稿備援
    if (!ro) {
      _gdSetBaseline('mlassess', _mlaFormSnapshot());
      _startMlaDraftAutosave();
    }
  }, 0);
}

async function saveMlAssessment(recordId) {
  const l = mentalLeavesData.find(x => x.id === recordId);
  if (!l) return;
  if (!_mlAssessCanEdit()) { alert('僅身心調適假窗口、主任、系統管理者可填寫/編輯此表單'); return; }
  const gV = id => document.getElementById(id)?.value?.trim() || '';
  const gR = n => { const el = document.querySelector(`[name="${n}"]:checked`); return el ? el.value : ''; };
  const gChk = n => [...document.querySelectorAll(`[name="${n}"]:checked`)].map(el => el.value);
  const gBsrs = id => { const v = document.getElementById(id)?.value; return (v === '' || v === undefined) ? null : parseInt(v, 10); };

  const name = gV('mla-name'), studentId = gV('mla-sid');
  const collectionDate = gV('mla-collect-date'), evalDate = gV('mla-eval-date');
  const bsrsVals = [0,1,2,3,4].map(i => gBsrs(`mla-bsrs-${i}`));
  const suicideVal = gBsrs('mla-suicide');
  const medPsychiatry = gR('mla-med-psy'), medMedication = gR('mla-med-drug'), medCounseling = gR('mla-med-counsel');
  const familyRel = gR('mla-family'), familyRelOther = gV('mla-family-other');
  const partnerHas = gR('mla-partner-has'), partnerType = gR('mla-partner-type'), partnerOther = gV('mla-partner-other');
  const friendType = gR('mla-friend'), friendOther = gV('mla-friend-other');
  const teacherType = gR('mla-teacher'), teacherOther = gV('mla-teacher-other');
  const housing = gR('mla-housing'), housingOther = gV('mla-housing-other');
  const resultOutcome = gR('mla-outcome');
  const resultNoCaseReasons = gChk('mla-nocase-reason');

  // ── v182 A2/A5/A6/A7：儲存前驗證必填欄位。檢視模式（ro）沒有儲存按鈕，不會呼叫到此處；
  // 舊資料開啟編輯只在按下「儲存」時才驗證，符合「不先跳錯」的相容性要求 ──
  const missing = []; // { label, secId }：secId 供整段區塊 highlight／scroll 用
  if (!name) missing.push({ label: '姓名', secId: 'mla-sec-top' });
  if (!studentId) missing.push({ label: '學號', secId: 'mla-sec-top' });
  if (!collectionDate) missing.push({ label: '收案日期', secId: 'mla-sec-top' });
  if (!evalDate) missing.push({ label: '評估日期', secId: 'mla-sec-top' });

  _mlaDraftContacts.forEach((ct, idx) => {
    const n = idx + 1;
    if (!ct.date) missing.push({ label: `聯繫 #${n} 日期`, secId: 'mla-sec-contacts' });
    if (!ct.period && !(ct.timeStart && ct.timeEnd)) missing.push({ label: `聯繫 #${n} 會談時間`, secId: 'mla-sec-contacts' });
    if (!ct.method) missing.push({ label: `聯繫 #${n} 聯繫方式`, secId: 'mla-sec-contacts' });
    else if (ct.method === 'E-mail/簡訊' && !(ct.methodContent || '').trim()) missing.push({ label: `聯繫 #${n} E-mail／簡訊內容`, secId: 'mla-sec-contacts' });
    if (!ct.target) missing.push({ label: `聯繫 #${n} 聯繫對象`, secId: 'mla-sec-contacts' });
    if (!(ct.description || '').trim()) missing.push({ label: `聯繫 #${n} 經過描述`, secId: 'mla-sec-contacts' });
  });

  // v186：仿新增個案 BSRS 未填邏輯——五題＋自殺想法題皆未答時，須勾選「個案皆未回答」才能儲存；
  // 只要任一題（含自殺想法題）有答，即視為放行，其餘未答題不再逐題擋存
  const _mlaBsrsAllUnanswered = bsrsVals.every(v => v === null) && suicideVal === null;
  const mlaBsrsUnanswered = _mlaBsrsAllUnanswered && !!document.getElementById('mla-bsrs-unfilled')?.checked;
  const MLA_BSRS_UNANSWERED_LABEL = 'BSRS-5（皆未答需勾選「個案皆未回答」）';
  if (_mlaBsrsAllUnanswered && !mlaBsrsUnanswered) missing.push({ label: MLA_BSRS_UNANSWERED_LABEL, secId: 'mla-sec-bsrs' });

  if (!medPsychiatry) missing.push({ label: '就醫史：精神科就醫經驗', secId: 'mla-sec-med' });
  if (!medMedication) missing.push({ label: '就醫史：服用精神藥物經驗', secId: 'mla-sec-med' });
  if (!medCounseling) missing.push({ label: '就醫史：諮商輔導經驗', secId: 'mla-sec-med' });

  if (!familyRel) missing.push({ label: '支持系統：與家人關係', secId: 'mla-sec-support' });
  else if (familyRel === 'other' && !familyRelOther) missing.push({ label: '與家人關係「其他」說明', secId: 'mla-sec-support' });
  if (!partnerHas) missing.push({ label: '支持系統：伴侶', secId: 'mla-sec-support' });
  else if (partnerHas === 'yes') {
    if (!partnerType) missing.push({ label: '伴侶關係類型', secId: 'mla-sec-support' });
    else if (partnerType === 'other' && !partnerOther) missing.push({ label: '伴侶關係「其他」說明', secId: 'mla-sec-support' });
  }
  if (!friendType) missing.push({ label: '支持系統：朋友', secId: 'mla-sec-support' });
  else if (friendType === 'other' && !friendOther) missing.push({ label: '朋友「其他」說明', secId: 'mla-sec-support' });
  if (!teacherType) missing.push({ label: '支持系統：師長', secId: 'mla-sec-support' });
  else if (teacherType === 'other' && !teacherOther) missing.push({ label: '師長「其他」說明', secId: 'mla-sec-support' });

  if (!housing) missing.push({ label: '住宿情形', secId: 'mla-sec-housing' });
  else if (housing === 'other' && !housingOther) missing.push({ label: '住宿情形「其他」說明', secId: 'mla-sec-housing' });

  if (!resultOutcome) missing.push({ label: '評估結果', secId: 'mla-sec-outcome' });
  else if (resultOutcome === 'noCase' && !resultNoCaseReasons.length) missing.push({ label: '不開案原因（至少勾選一項）', secId: 'mla-sec-outcome' });

  document.querySelectorAll('#mla-page-body .mla-vsec.form-section-error').forEach(el => el.classList.remove('form-section-error'));
  document.getElementById('mla-bsrs-unfilled-wrap')?.classList.remove('form-section-error');
  const alertEl = document.getElementById('mla-validation-alert');
  if (missing.length) {
    if (alertEl) {
      alertEl.style.display = '';
      alertEl.innerHTML = `請填寫必填欄位：${missing.map(m => escHtml(m.label)).join('、')}`;
      alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const secIds = [...new Set(missing.map(m => m.secId))];
    secIds.forEach(id => document.getElementById(id)?.classList.add('form-section-error'));
    // v186：BSRS 皆未答勾選框：額外醒目標示該勾選列本身，而不只是整個 BSRS 區塊
    if (missing.some(m => m.label === MLA_BSRS_UNANSWERED_LABEL)) {
      document.getElementById('mla-bsrs-unfilled-wrap')?.classList.add('form-section-error');
    }
    const firstErrEl = secIds.length ? document.getElementById(secIds[0]) : null;
    if (firstErrEl) firstErrEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (alertEl) { alertEl.style.display = 'none'; alertEl.innerHTML = ''; }

  // v182 A4：主責輔導人員下拉存 email，換算對應姓名寫回 resultCounselorName（相容既有列印/顯示均讀名稱字串）
  const counselorEmail = gV('mla-outcome-counselor');
  const counselorName = counselorEmail ? (configData?.users?.[counselorEmail]?.name || formatCounselorLabel(counselorEmail) || '') : '';

  const isNew = !l.assessment;
  const prev = l.assessment ? JSON.parse(JSON.stringify(l.assessment)) : null;
  const now = new Date().toISOString();
  const updaterName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.email || '';
  const a = {
    ...(l.assessment || {}),
    name, studentId,
    collectionDate, evalDate,
    reason: gV('mla-reason'),
    assessorNote: gV('mla-assessor-note'), // v182 A1：評估者備註（選填）
    // v179：contactTime 舊字串欄位維持唯讀顯示、不因本次儲存被清空；聯繫時間改存結構化 contacts 陣列（供日後統計聯繫次數）
    contacts: _mlaDraftContacts.map(ct => ({ ...ct })),
    bsrs: bsrsVals, suicide: suicideVal, bsrsUnanswered: mlaBsrsUnanswered, // v186：個案皆未回答 BSRS
    medPsychiatry, medMedication, medCounseling,
    familyRel, familyRelOther,
    partnerHas, partnerType, partnerOther,
    friendType, friendOther,
    teacherType, teacherName: gV('mla-teacher-name'), teacherOther,
    housing, housingOther,
    resultText: gV('mla-result-text'),
    resultOutcome, resultCounselorName: counselorName, resultCounselorEmail: counselorEmail,
    resultNoCaseReasons,
    updatedAt: now, updatedBy: currentUser?.email, updatedByName: updaterName,
  };
  if (isNew) { a.filledBy = currentUser?.email; a.filledByName = updaterName; a.filledAt = now; }

  l.assessment = a;
  // v185：確定會儲存——停止草稿備援、清掉草稿 key；若是從草稿待辦繼續編輯，標記該待辦完成
  _stopMlaDraftAutosave();
  try { localStorage.removeItem(_mlaDraftKey()); } catch(_) {}
  if (_mlaDraftTodoId) {
    const _mladt = todosData.find(t => t.id === _mlaDraftTodoId);
    if (_mladt) { _mladt.done = true; _mladt.doneAt = now; }
    _mlaDraftTodoId = null;
    saveUserTodos().catch(() => {});
  }
  const _mlaCase = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
  const _mlaOnCaseDetail = _mlaCase && _detailCaseId === _mlaCase.id && document.getElementById('page-case-detail')?.classList.contains('active');
  handlePrevPage(); // 回到來時頁（身心調適假管理列表 或 個案詳細頁）
  if (typeof renderMentalLeavePage === 'function') renderMentalLeavePage();
  if (_mlaOnCaseDetail) showCaseDetail(_mlaCase.id);

  const jobId = bgJobAdd(`${isNew?'新增':'更新'}身心狀態評估表`);
  try {
    await saveMentalLeaves();
    bgJobDone(jobId);
    auditLog(`${isNew?'新增':'更新'}身心狀態評估表`, _mlaCase ? _mlaCase.id : null, l.id, _mlaCase ? null : `學號 ${l.studentId || '—'}`);
    _mlReconcileAssessmentTodos(); // 評估表已填 → 自己的「評估表待填寫」待辦自動完成
    showToast('已儲存身心狀態評估表', 'success');
    _qocMaybeShowIncompleteReminder(); // v181：儲存成功後，若本次工作階段有透過快速開案建立且尚未補齊資料的個案，提醒使用者
  } catch(e) {
    l.assessment = prev;
    bgJobFail(jobId, e.message);
    if (typeof renderMentalLeavePage === 'function') renderMentalLeavePage();
    if (_mlaOnCaseDetail) showCaseDetail(_mlaCase.id);
    showToast('儲存失敗：' + e.message, 'error');
  }
}

function printMlAssessment(recordId) {
  const l = mentalLeavesData.find(x => x.id === recordId);
  if (!l || !l.assessment) { alert('尚未填寫評估表'); return; }
  if (!_mlAssessCanView(l.studentId)) { alert('您沒有權限列印此表單'); return; }
  const a = l.assessment;
  const mc = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
  const rocDate = d => { if (!d) return '　年　月　日'; const p = d.split('-'); return p.length === 3 ? `${parseInt(p[0])-1911}年${parseInt(p[1])}月${parseInt(p[2])}日` : d; };
  const box = (checked, lbl) => `<span style="white-space:nowrap;"><span style="font-size:1.15em;">${checked?'■':'□'}</span> ${escHtml(lbl)}</span>`;
  const circleCell = (val, col) => val === col
    ? `<span style="display:inline-block;width:20px;height:20px;line-height:17px;border:2px solid #000;border-radius:50%;text-align:center;font-weight:700;">${col}</span>`
    : `${col}`;
  const bsrsRow = (lbl, val, highlight) => `<tr${highlight?' style="background:#fafafa;"':''}><td style="text-align:left;padding:4px 8px;">${escHtml(lbl)}</td>${[0,1,2,3,4].map(c=>`<td style="text-align:center;padding:3px;">${circleCell(val,c)}</td>`).join('')}</tr>`;
  const total = _mlAssessBsrsTotal(a);
  const medRow = (val, opts) => box(val==='none', opts[0]) + '　' + box(val==='paused', opts[1]) + '　' + box(val==='current', opts[2]);
  const familyLine = [['close','緊密'],['normal','一般'],['distant','疏離'],['conflict','衝突']].map(([v,l2])=>box(a.familyRel===v,l2)).join('　') + '　' + box(a.familyRel==='other', '其他：' + (a.familyRelOther||''));
  const partnerTypeLine = a.partnerHas === 'yes'
    ? '（' + [['close','緊密'],['normal','一般'],['distant','疏離'],['conflict','衝突']].map(([v,l2])=>box(a.partnerType===v,l2)).join('　') + '　' + box(a.partnerType==='other', '其他：' + (a.partnerOther||'')) + '）'
    : '';
  const partnerLine = box(a.partnerHas==='yes','有') + partnerTypeLine + '　' + box(a.partnerHas==='no','無');
  const friendLine = [['withPeople','有朋友且願意讓他們陪伴'],['notBother','有朋友，但不願意麻煩他們'],['none','無朋友陪伴']].map(([v,l2])=>box(a.friendType===v,l2)).join('　') + '　' + box(a.friendType==='other', '其他：' + (a.friendOther||''));
  const teacherName = a.teacherName || '　　';
  const teacherLine = box(a.teacherType==='know', teacherName + ' 老師知道我的情形') + '<br>' +
    box(a.teacherType==='dontWantKnow', '我不願意讓 ' + teacherName + ' 老師知道我的情形') + '<br>' +
    box(a.teacherType==='dontKnow', teacherName + ' 老師不知道我的情形') + '<br>' +
    box(a.teacherType==='other', '其他：' + (a.teacherOther||''));
  const housingLine = [['alone','獨居'],['roommate','有室友'],['family','與家人同住']].map(([v,l2])=>box(a.housing===v,l2)).join('　') + '　' + box(a.housing==='other', '其他：' + (a.housingOther||''));
  const noCaseReasonLbls = { noRisk:'暫無曝險之虞', riskNoWill:'有風險但無意願，轉知主任或導師協助關懷', noContact:'聯繫未果，轉知主任或導師協助關懷' };
  const outcomeHtml = box(a.resultOutcome==='counseling', '進入諮商輔導流程，主責輔導人員：' + (a.resultCounselorName||'　　')) + '<br>' +
    box(a.resultOutcome==='noCase', '不開案（' + ['noRisk','riskNoWill','noContact'].map(v => box((a.resultNoCaseReasons||[]).includes(v), noCaseReasonLbls[v])).join('　') + '）');
  const printerName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  const printTime = new Date().toLocaleString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>身心狀態評估表</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 18mm; }
    * { box-sizing: border-box; }
    body { font-family:'Microsoft JhengHei','標楷體',serif; font-size:11.5pt; line-height:1.7; margin:0; padding:0; color:#111; }
    h1 { text-align:center; font-size:15pt; margin:0 0 4px; }
    h2 { text-align:center; font-size:12.5pt; font-weight:700; margin:0 0 14px; }
    .hdr-note { text-align:right; font-size:9.5pt; color:#555; margin-bottom:4px; }
    table.info td { padding:3px 4px; vertical-align:top; }
    table.bsrs { width:100%; border-collapse:collapse; margin:6px 0 4px; }
    table.bsrs th, table.bsrs td { border:1px solid #666; padding:4px; }
    table.bsrs th { background:#f2f2f2; font-size:10pt; text-align:center; }
    .sec-title { font-weight:700; margin:12px 0 4px; font-size:11.5pt; }
    .sec-body { margin-left:4px; }
    .line { margin-bottom:5px; }
    .foot { margin-top:16px; text-align:right; font-size:9.5pt; color:#555; }
    .no-print { margin-bottom:12px; } @media print { .no-print { display:none; } }
  </style></head><body>
  <div class="no-print"><button onclick="window.print()">列印</button></div>
  <div class="hdr-note">113 年 4 月 17 日中心會議通過</div>
  <h1>國立屏東科技大學學生事務處學生諮商中心</h1>
  <h2>身心狀態評估表_身心調適假連續三日者適用</h2>
  <table class="info" style="width:100%;">
    <tr><td style="width:33%;">姓名：${escHtml(a.name||'')}</td><td style="width:33%;">學號：${escHtml(a.studentId||'')}</td><td>案號：${escHtml(mc?.id||'')}</td></tr>
    <tr><td>收案日期：${rocDate(a.collectionDate)}</td><td colspan="2">評估日期：${rocDate(a.evalDate)}</td></tr>
    <tr><td colspan="3">請假事由：${escHtml(a.reason||'')}</td></tr>
    ${a.assessorNote ? `<tr><td colspan="3">評估者備註：${escHtml(a.assessorNote)}</td></tr>` : ''}
    ${a.contactTime ? `<tr><td colspan="3">舊格式聯繫時間：${escHtml(a.contactTime)}</td></tr>` : ''}
  </table>
  <div class="sec-title">一、簡式健康量表（BSRS-5）</div>
  <div class="sec-body">請圈選最近一個星期（含今天），同學對下列各項造成困擾的嚴重程度</div>
  ${a.bsrsUnanswered ? `<div class="sec-body" style="font-weight:700;">（個案皆未回答）</div>` : ''}
  <table class="bsrs">
    <tr><th style="text-align:left;">題目</th><th>不會</th><th>輕微</th><th>中等程度</th><th>嚴重</th><th>非常嚴重</th></tr>
    ${_bsrsOrderedLabels(ML_ASSESS_BSRS_LABELS).map(({label,storageIdx},displayIdx)=>bsrsRow(`(${displayIdx+1}) ${label}`, a.bsrs?.[storageIdx] ?? null)).join('')}
    ${bsrsRow('★有自殺的想法', a.suicide ?? null, true)}
  </table>
  <div class="sec-body">請填寫檢測結果：(1) - (5) 題總分：<b>${a.bsrsUnanswered ? '—' : total}</b> 分，★自殺想法：<b>${a.bsrsUnanswered ? '—' : (a.suicide ?? '—')}</b> 分</div>

  <div class="sec-title">二、就醫史</div>
  <div class="sec-body">
    <div class="line">1、精神科就醫經驗　${medRow(a.medPsychiatry, ['無','有，曾經就醫但目前已中斷','有，持續就醫中'])}</div>
    <div class="line">2、服用精神藥物經驗　${medRow(a.medMedication, ['無','有，曾經服用但目前已中斷','有，持續服用中'])}</div>
    <div class="line">3、諮商輔導經驗　${medRow(a.medCounseling, ['無','有，曾經使用但目前已中斷','有，且持續中'])}</div>
  </div>

  <div class="sec-title">三、支持系統</div>
  <div class="sec-body">
    <div class="line">1、與家人關係　${familyLine}</div>
    <div class="line">2、伴侶　${partnerLine}</div>
    <div class="line">3、朋友　${friendLine}</div>
    <div class="line">4、師長<br>${teacherLine}</div>
  </div>

  <div class="sec-title">四、住宿情形</div>
  <div class="sec-body"><div class="line">${housingLine}</div></div>

  <div class="sec-title">五、評估結果：${escHtml(a.resultText||'')}</div>
  <div class="sec-body"><div class="line">${outcomeHtml}</div></div>

  ${(a.contacts && a.contacts.length) ? `
  <div class="sec-title">聯繫歷程</div>
  <table class="bsrs">
    <tr><th>日期</th><th>時間</th><th>方式</th><th>對象</th><th style="text-align:left;">經過</th></tr>
    ${a.contacts.map(ct => {
      const timeLbl = ct.period || ((ct.timeStart || ct.timeEnd) ? `${ct.timeStart||''}–${ct.timeEnd||''}` : '—');
      const targetLbl = (ct.target || '—') + (ct.targetNote ? `（${ct.targetNote}）` : '');
      return `<tr><td>${escHtml(ct.date||'—')}</td><td>${escHtml(timeLbl)}</td><td>${escHtml(ct.method||'—')}</td><td>${escHtml(targetLbl)}</td><td style="text-align:left;">${escHtml(ct.description||'')}</td></tr>`;
    }).join('')}
  </table>` : ''}

  <div class="foot">${escHtml(printerName)} 於 ${escHtml(printTime)} 列印　國立屏東科技大學學生諮商中心資訊系統</div>
  </body></html>`;
  _printViaIframe(html);
}

function _mlRenderRecordsTab(el, studentIdFilter = null) {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canFullAccess = isAdmin || isMentalLeaveContact;
  // A-3：預設濾掉已封存；切到「顯示已封存」時改為只顯示已封存（比照個案列表 unarchived/archived 篩選）
  const records = mentalLeavesData.filter(l => !l.deleted && (_mlShowArchived ? !!l.archived : !l.archived));
  const q      = (_mlQFilter       || '').trim().toLowerCase();
  const riskF  =  _mlRiskFilter;
  const semF   =  _mlSemFilter;
  const hF     =  _mlHandlingFilter;
  const abF    =  _mlAbFilter;
  const consec3Ids = _mlConsec3Filter ? _mlConsecutive3DayIds(records) : null;

  // v173：風險／受理情況／案別三維度合併一次判定（同群組 OR、跨群組 AND，見 _filterPanelMatch）
  const _mlActiveGroups = { risk: [...riskF], handling: [...hF], abType: [...abF] };
  let filtered = records.filter(l => {
    if (studentIdFilter && !studentIdFilter.has(l.studentId)) return false;
    if (q && !((l.name||'').toLowerCase().includes(q) || (l.studentId||'').toLowerCase().includes(q) || (l.reason||'').toLowerCase().includes(q))) return false;
    if (semF && l.semester !== semF) return false;
    if (consec3Ids && !consec3Ids.has(l.studentId)) return false;
    const { level: maxLevel } = _mlEffectiveRisk(l);
    const effHandling = l.handlingStatus || (maxLevel >= 3 ? '待處理' : '非危機');
    // 依「連結個案」的有效 abType 篩選（最新學期快照優先，fallback 頂層）；找不到連結個案者一併排除
    const _mc = casesData.find(c => !c.deleted && c.studentId === l.studentId);
    if (!_filterPanelMatch({
      risk: String(maxLevel),
      handling: effHandling,
      abType: _mc ? [_caseLatestAbType(_mc)].filter(Boolean) : [],
    }, _mlActiveGroups)) return false;
    return true;
  });
  const _mlGroups = _mlGroupAndSort(filtered);
  const allSorted = _mlGroups.flatMap(g => g.records);
  const _runInfoMap = {};
  _mlGroups.forEach(g => g.records.forEach((r, idx) => {
    _runInfoMap[r.id] = { isConsec3: g.isConsec3, isRun: g.isRun, dateRange: g.dateRange, isFirst: idx === 0, isLast: idx === g.records.length - 1 };
  }));
  // 身心狀態評估表（#030-⑤）：僅窗口/主任/系統管理者可見入口與未填 chip
  const _mlaCanEdit = _mlAssessCanEdit();
  const _mlaAnchorMap = _mlaCanEdit ? _mlBuildAssessAnchors() : null;

  const totalFiltered = allSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / _mlPageSize));
  if (_mlPage > totalPages) _mlPage = totalPages;
  const pageStart = (_mlPage - 1) * _mlPageSize;
  const pageRecords = allSorted.slice(pageStart, pageStart + _mlPageSize);

  const sems = [...new Set(records.map(l => l.semester).filter(Boolean))].sort().reverse();
  const semOpts = sems.map(s => `<option value="${escHtml(s)}"${semF===s?' selected':''}>${escHtml(semesterLabel(s)||s)}</option>`).join('');
  const allChecked = pageRecords.length > 0 && pageRecords.every(l => _mlCheckedIds.has(l.id));

  const _mlFT = _mlIsFullTimeStaff();
  // ④c：🔔再次提醒按鈕收縮至窗口／主任／系統管理者可見（A/B案badge、主責姓名、已讀/未讀標示仍維持專任可見 _mlFT，不受此收縮影響）
  const _mlBellVisible = isMentalLeaveContact || currentRole === '主任' || currentRole === '系統管理者' || extraRole === '管理者';
  // v174：姓名下方圖示列——取代原 A-2「⋯ 更多」溢位選單；hover 說明比照全站 data-tip 慣例。
  // v176：圖示放大（原 .92rem/1px 2px 過小），未讀/已讀/封存圖示同步更換
  const _mlIconBtn = (icon, tip, onclickBody) => `<button type="button" onclick="event.stopPropagation();${onclickBody}" data-tip="${escHtml(tip)}" style="border:none;background:none;cursor:pointer;font-size:1.02rem;padding:2px 3px;line-height:1;">${icon}</button>`;
  const rowsHtml = pageRecords.length ? pageRecords.map(l => {
    const { matchedKeywords } = _mlMatchKeywords(l.reason);
    const { level: maxLevel, isOverride: _mlIsOverride } = _mlEffectiveRisk(l);
    const kwChips = matchedKeywords.slice(0, 4).map(k =>
      `<span style="font-size:.7rem;background:${maxLevel===3?'#fed7d7':maxLevel===2?'#fef9c3':'#dbeafe'};color:${maxLevel===3?'#9b2c2c':maxLevel===2?'#854d0e':'#1e40af'};border-radius:4px;padding:0 5px;margin-right:2px;">${escHtml(k.kw)}</span>`
    ).join('') + (matchedKeywords.length > 4 ? `<span style="font-size:.7rem;color:#718096;">+${matchedKeywords.length-4}</span>` : '');
    const mc = casesData.find(c => !c.deleted && c.studentId === l.studentId);
    const _mlRecSem = l.semester || '';
    const _mlHasCase = _mlRecSem ? _hasCaseInSem(l.studentId, _mlRecSem) : null;
    // ④a：🔔再次提醒移至學生姓名下方；④c：僅窗口／主任／系統管理者可見（見 _mlBellVisible）
    const _mlCounselorEmailForBell = (_mlFT && mc && _mlHasCase) ? (mc.counselorEmail || '') : '';
    const _mlIsAckedForBell = _mlCounselorEmailForBell && (l.acknowledgedBy||[]).includes(_mlCounselorEmailForBell);
    // v174：🔔再次提醒改與收到／填寫評估表／封存並列於姓名下方圖示列（見下方 _mlIconRow）；是否顯示入口的權限判斷不變
    const _mlBellIcon = (_mlBellVisible && _mlCounselorEmailForBell && !_mlIsAckedForBell)
      ? _mlIconBtn('🔔', '再次提醒主責', `window._mlRemind('${escHtml(l.id)}')`)
      : '';
    const nameLink = mc
      ? `<button onclick="event.stopPropagation();showCaseDetail('${escHtml(mc.id)}')" style="border:none;background:none;cursor:pointer;color:#2b6cb0;font-weight:600;padding:0;font-size:inherit;">${escHtml(l.name||'—')}</button>`
      : `<span>${escHtml(l.name||'—')}</span>`;
    const runInfo = _runInfoMap[l.id] || {};
    const isRunChild = runInfo.isRun;
    const rowBg = isRunChild
      ? (maxLevel===3?'#fff5f5':maxLevel===2?'#fffdf0':'#f0f7ff')
      : (maxLevel===3?'#fff5f5':maxLevel===2?'#fffdf0':'');
    const leftBorder = isRunChild ? 'border-left:4px solid #3182ce;' : '';
    const bottomBorder = (isRunChild && runInfo.isLast) ? 'border-bottom:2px solid #3182ce;' : '';
    const _cbPad = isRunChild ? 'padding:5px 6px;' : 'padding:5px 6px 5px 10px;';
    const groupHeader = (runInfo.isRun && runInfo.isFirst)
      ? `<tr style="background:#eff6ff;border-left:4px solid #3182ce;"><td colspan="99" style="padding:2px 12px 2px 36px;font-size:.78rem;color:#1e40af;border-top:2px solid #3182ce;font-weight:600;">📅 ${escHtml(l.name||l.studentId||'—')}&ensp;${escHtml(runInfo.dateRange)}${runInfo.isConsec3?`&ensp;<span style="background:#fed7d7;color:#9b2c2c;border-radius:4px;padding:0 6px;font-size:.72rem;">連請三天</span>`:''}</td></tr>`
      : '';
    const dateBadge = runInfo.isRun
      ? `<div style="margin-top:2px;"><span style="background:#e8f4fd;color:#1e40af;border-radius:4px;padding:0 5px;font-size:.7rem;">連假</span></div>`
      : '';
    const _mlCaseBadge = (_mlRecSem && !_mlHasCase)
      ? `<span style="display:inline-block;background:#fed7d7;color:#9b2c2c;border-radius:4px;padding:0 5px;font-size:.68rem;margin-top:2px;">未開案</span>`
      : '';
    // ③④：僅專任人員可見「A/B案＋主責」與「主責已讀」標示（不得向兼任/義務輔導老師/實習生等揭露該生為個案）；🔔再次提醒見 _mlBellIcon/_mlBellVisible
    const _mlCaseInfoBadge = (_mlFT && mc && _mlHasCase) ? (() => {
      const abT = mc.basicInfoSnapshots?.[_mlRecSem]?.abType || mc.abType || '';
      const abBadge = abT === 'A案'
        ? '<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:4px;padding:0 5px;font-size:.68rem;font-weight:600;">A案</span>'
        : abT === 'B案'
        ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:4px;padding:0 5px;font-size:.68rem;font-weight:600;">B案</span>'
        : '';
      // 主責顯示僅姓名、不含職稱（避免與職稱過長排版擠壓）
      const counselorLbl = configData?.users?.[mc.counselorEmail]?.name || mc.counselorName || mc.counselorText || '—';
      const counselorEmail = mc.counselorEmail || '';
      const isAcked = counselorEmail && (l.acknowledgedBy||[]).includes(counselorEmail);
      const ackBadge = counselorEmail
        ? (isAcked
            ? '<span style="display:inline-block;background:#c6f6d5;color:#276749;border-radius:4px;padding:0 5px;font-size:.68rem;">主責已讀 ✓</span>'
            : '<span style="display:inline-block;background:#fed7d7;color:#9b2c2c;border-radius:4px;padding:0 5px;font-size:.68rem;">主責未讀</span>')
        : '';
      return `<div style="margin-top:3px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${abBadge}<span style="font-size:.72rem;color:#4a5568;">主責：${escHtml(counselorLbl)}</span>${ackBadge}</div>`;
    })() : '';
    const studentIdCell = mc
      ? `<div style="font-family:monospace;">${escHtml(l.studentId||'—')}</div><div style="margin-top:2px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;"><span style="font-size:.75rem;color:#2b6cb0;font-family:monospace;">${escHtml(mc.id)}</span><button onclick="event.stopPropagation();showCaseDetail('${escHtml(mc.id)}')" style="border:none;background:#ebf8ff;color:#2b6cb0;cursor:pointer;border-radius:3px;padding:0 5px;font-size:.7rem;line-height:1.6;">前往個案</button>${_mlCaseBadge}</div>${_mlCaseInfoBadge}`
      : `<span style="font-family:monospace;">${escHtml(l.studentId||'—')}</span>${_mlCaseBadge ? `<div>${_mlCaseBadge}</div>` : ''}`;
    const cCount = _mlCourseCount(l);
    const periodsSummary = _mlPeriodsSummary(l);
    // v179：課程徽章改為開啟列展開區（見 window._mlToggleRowExpand），課程明細移入展開區內的收合 section（預設收合）
    const courseBtn = cCount
      ? `<button onclick="event.stopPropagation();window._mlToggleRowExpand('${escHtml(l.id)}','course')" style="border:1px solid #c6f6d5;background:#f0fff4;color:#276749;border-radius:12px;padding:1px 8px;font-size:.75rem;cursor:pointer;white-space:nowrap;">▶ ${cCount} 節課</button>${periodsSummary ? `<div style="margin-top:3px;font-size:.72rem;color:#276749;">${escHtml(periodsSummary)}</div>` : ''}`
      : `<span style="color:#cbd5e0;font-size:.75rem;">—</span>`;
    const hVal = l.handlingStatus || (maxLevel >= 3 ? '待處理' : '非危機');
    const hs = ML_HANDLING_STYLE[hVal] || { bg: '#f7fafc', color: '#718096', border: '#e2e8f0' };
    const handlingSel = `<select onclick="event.stopPropagation()" onchange="window._mlSetHandling('${escHtml(l.id)}',this.value)" style="font-size:.78rem;border:1px solid ${escHtml(hs.border)};border-radius:4px;padding:2px 4px;background:${escHtml(hs.bg)};color:${escHtml(hs.color)};cursor:pointer;max-width:90px;">
      ${ML_HANDLING_OPTS.map(o=>`<option value="${o}"${hVal===o?' selected':''}>${o}</option>`).join('')}
    </select>`;
    const isChecked = _mlCheckedIds.has(l.id);
    const { from: _mlFrom, to: _mlTo } = _mlParseDateRange(l);
    const mlDateStr = _mlFrom ? (_mlFrom !== _mlTo ? `${_mlFrom.slice(5).replace('-','/')} – ${_mlTo.slice(5).replace('-','/')}` : _mlFrom.slice(5).replace('-','/')) : (l.leaveDate || '—');
    // 身心狀態評估表入口（#030-⑤）：非受輔生且（紅燈或連請三日）的掛載紀錄（anchor）本列顯示；
    // v174：狀態 chip（未填倒數）仍留在列上供一眼辨識，實際填寫/檢視改姓名下方圖示（見 _mlIconRow）
    let _mlaChip = '';
    let _mlaIcon = '';
    if (_mlaAnchorMap && _mlaAnchorMap[l.id]?.id === l.id && _mlAssessFillable(l)) {
      const _mlaFilled = !!l.assessment;
      _mlaIcon = _mlaFilled
        ? _mlIconBtn('📝✓', '評估表已填，點此檢視/編輯/列印（此評估表為身心調適假窗口於進案前對學生進行的評估與介入紀錄，非諮商晤談紀錄）', `openMlAssessmentModal('${escHtml(l.id)}')`)
        : _mlIconBtn('📝', '填寫評估表：此評估表為身心調適假窗口於進案前對學生進行的評估與介入紀錄（非諮商晤談紀錄）；身心調適假連請三日/紅燈之非受輔生，需於 3 個工作日內完成填寫', `openMlAssessmentModal('${escHtml(l.id)}')`);
      _mlaChip = !_mlaFilled
        ? (l.assessmentNotifiedAt
            ? _mlAssessCountdownChip(_mlAddWorkdays(l.assessmentNotifiedAt.slice(0, 10), 3), '評估表未填：')
            : `<span style="border-radius:4px;padding:0 6px;font-size:.72rem;background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0;white-space:nowrap;">評估表未填</span>`)
        : '';
    }
    // v174：封存／解除封存改圖示——依目前檢視（_mlShowArchived）顯示對應動作
    const _mlArchiveIcon = l.archived
      ? _mlIconBtn('♻️', '解除封存', `window._mlUnarchiveOne('${escHtml(l.id)}')`)
      : _mlIconBtn('📦', '封存：封存後此紀錄在列表中預設隱藏，可透過「顯示已封存」找回並解除封存', `window._mlArchiveOne('${escHtml(l.id)}')`);
    // v174：「收到」也併入圖示列（已收到者顯示文字狀態、非按鈕）；三動作＋🔔提醒橫排於姓名下方，取代原「⋯ 更多」選單
    const _mlAckedByMe = !!(currentUser?.email && (l.acknowledgedBy || []).includes(currentUser.email));
    const _mlAckIcon = _mlAckedByMe
      ? `<span data-tip="已收到" style="color:#276749;font-size:1.02rem;padding:2px 3px;line-height:1;display:inline-block;">✅</span>`
      : _mlIconBtn('🟨', '收到（未讀）：確認已知悉此筆身心調適假', `window._mlAcknowledge('${escHtml(l.id)}')`);
    const _mlIconRow = `<div style="display:flex;gap:3px;align-items:center;margin-top:2px;flex-wrap:wrap;">${_mlAckIcon}${_mlaIcon}${_mlArchiveIcon}${_mlBellIcon}</div>`;
    // v179：點列（除既有連結/勾選框/select 外）可展開該筆——展開顯示評估表摘要＋聯繫歷程＋課程收合 section（見 _mlRowExpandHtml）
    return `${groupHeader}<tr style="background:${rowBg};${leftBorder}${bottomBorder}cursor:pointer;" onclick="window._mlToggleRowExpand('${escHtml(l.id)}')" data-tip="點列展開評估表摘要／聯繫歷程／課程明細">
      <td style="${_cbPad}text-align:center;width:28px;"><input type="checkbox" class="ml-row-chk" data-id="${escHtml(l.id)}" ${isChecked?'checked':''} onclick="event.stopPropagation()" onchange="window._mlToggleCheck('${escHtml(l.id)}',this.checked)"></td>
      <td style="padding:7px 10px;">${nameLink}${_mlIconRow}</td>
      <td style="padding:7px 10px;">${studentIdCell}</td>
      <td style="padding:7px 10px;">${escHtml(mlDateStr)}${dateBadge}${_mlaChip ? `<div style="margin-top:3px;">${_mlaChip}</div>` : ''}</td>
      <td style="padding:7px 10px;font-size:.8rem;">${escHtml(l.reason||'—')}</td>
      <td style="padding:7px 10px;">${_mlRiskOverrideSelect(l)}${_mlIsOverride ? ' <span style="font-size:.68rem;color:#805ad5;font-weight:600;">手動</span>' : ''}${kwChips ? `<div style="margin-top:3px;">${kwChips}</div>` : ''}</td>
      <td style="padding:7px 8px;">${handlingSel}</td>
      <td style="padding:7px 10px;">${courseBtn}</td>
      <td style="padding:7px 10px;font-size:.8rem;color:#718096;">${escHtml(l.semester||'—')}</td>
      ${isAdmin ? `<td style="padding:7px 10px;"><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();window._mlDeleteRecord('${escHtml(l.id)}')">刪除${adminOnlyChip(false, true)}</button></td>` : ''}
    </tr>
    <tr id="ml-expand-${escHtml(l.id)}" style="display:none;background:#f7fffe;">
      <td colspan="${isAdmin ? 10 : 9}" style="padding:0 !important;margin:0;border:none;max-width:0;overflow:hidden;">
        <div style="box-sizing:border-box;width:100%;padding:10px 12px;overflow-x:auto;${leftBorder}" onclick="event.stopPropagation()">${_mlRowExpandHtml(l)}</div>
      </td>
    </tr>`;
  }).join('')
    : `<tr><td colspan="99" style="text-align:center;padding:24px;color:#a0aec0;">尚無紀錄</td></tr>`;

  // info cards 統計以 studentIdFilter 為基準（不受搜尋/風險等額外篩選影響）
  const baseRecords = studentIdFilter ? records.filter(l => studentIdFilter.has(l.studentId)) : records;
  const riskCount = (lv) => baseRecords.filter(l => _mlEffectiveRisk(l).level === lv).length;
  const pendingCount = baseRecords.filter(l => {
    const { level: maxLevel } = _mlEffectiveRisk(l);
    return (l.handlingStatus || (maxLevel >= 3 ? '待處理' : '非危機')) === '待處理';
  }).length;

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <div class="info-card" style="min-width:110px;"><div class="num">${baseRecords.length}</div><div class="lbl">請假總筆數</div></div>
      <div class="info-card" style="min-width:110px;background:#fff5f5;"><div class="num" style="color:#c53030;">${riskCount(3)}</div><div class="lbl">紅燈（危機）</div></div>
      <div class="info-card" style="min-width:110px;background:#fffbeb;"><div class="num" style="color:#d97706;">${riskCount(2)}</div><div class="lbl">黃燈（醫療）</div></div>
      <div class="info-card" style="min-width:110px;background:#eff6ff;"><div class="num" style="color:#2b6cb0;">${riskCount(1)}</div><div class="lbl">藍燈（關注）</div></div>
      <div class="info-card" style="min-width:110px;background:#fff5f5;"><div class="num" style="color:#e53e3e;">${pendingCount}</div><div class="lbl">待處理</div></div>
    </div>
    ${_mlTab === 'my' && canFullAccess ? `
    <div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:6px;padding:8px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <label style="font-size:.88rem;color:#2b6cb0;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" ${_mlMyOnly ? 'checked' : ''} onchange="_mlMyOnly=this.checked;_mlPage=1;renderMentalLeavePage();" style="margin:0;">
        <strong>僅看到自己主責個案</strong>
      </label>
      <span style="font-size:.8rem;color:#718096;">${_mlMyOnly ? '目前顯示：您的主責個案' : '目前顯示：所有在案受輔生'}</span>
    </div>
    ` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
      <input type="text" id="ml-q" class="field-input" placeholder="搜尋姓名、學號、緣由…" value="${escHtml(q)}" oninput="window._mlFilterChange()" oncompositionstart="_mlQComposing=true" oncompositionend="_mlQComposing=false;window._mlFilterChange()" style="max-width:200px;">
      ${_fpButtonHtml('ml')}
      <select id="ml-sem" class="field-input" onchange="_mlSemFilter=this.value;localStorage.setItem('ml_sem_pref',this.value);_mlPage=1;renderMentalLeavePage();" style="width:auto;">
        <option value="">所有學期</option>${semOpts}
      </select>
      <label style="font-size:.85rem;color:#718096;white-space:nowrap;display:flex;align-items:center;gap:4px;">
        <input type="checkbox" ${_mlConsec3Filter?'checked':''} onchange="_mlConsec3Filter=this.checked;_mlPage=1;renderMentalLeavePage();" style="margin:0;">
        連請三天
      </label>
      <label style="font-size:.85rem;color:#718096;white-space:nowrap;display:flex;align-items:center;gap:4px;" data-tip="切換後只顯示已封存的紀錄，可於此找回並解除封存">
        <input type="checkbox" ${_mlShowArchived?'checked':''} onchange="_mlShowArchived=this.checked;_mlPage=1;renderMentalLeavePage();" style="margin:0;">
        📦 顯示已封存
      </label>
      <label style="font-size:.85rem;color:#718096;white-space:nowrap;display:flex;align-items:center;gap:4px;">每頁
        <select id="ml-pagesize" class="field-input" style="padding:4px 6px;font-size:.85rem;" onchange="_mlPageSize=parseInt(this.value);_mlPage=1;renderMentalLeavePage();">
          ${[100,200,300].map(n=>`<option value="${n}"${_mlPageSize===n?' selected':''}>${n}</option>`).join('')}
        </select>筆
      </label>
      <button class="btn btn-secondary btn-sm" onclick="window._resetMlColWidths()" data-tip="清除已儲存的欄寬設定，恢復預設比例" style="white-space:nowrap;">重設欄寬</button>
      ${_fpPanelHtml('ml')}
      ${isAdmin ? `<button class="btn btn-secondary btn-sm" onclick="window._mlDeduplicateRecords()" data-tip="比對姓名、學號、請假日期、緣由、學期等欄位，清除重複內容的紀錄（保留受理情況最進階者，其次保留最早收到的）" style="white-space:nowrap;">清除重複${adminOnlyChip()}</button>` : ''}
      ${canFullAccess && DRIVE_FOLDER_ID === '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx' ? `
        <button class="btn btn-danger" onclick="window._mlClearAll()" style="white-space:nowrap;margin-left:auto;">🗑️ 清空測試資料</button>
      ` : ''}
    </div>
    <div id="ml-batch-bar" style="display:${_mlCheckedIds.size>0?'flex':'none'};background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;padding:8px 12px;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
      <span id="ml-batch-cnt" style="font-size:.85rem;font-weight:600;color:#2b6cb0;">已選 ${_mlCheckedIds.size} 筆</span>
      <select id="ml-batch-status" class="field-input" style="width:auto;">
        <option value="">選擇受理情況…</option>
        ${ML_HANDLING_OPTS.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="window._mlBatchHandling()">套用</button>
      <button class="btn btn-sm" style="background:#276749;color:#fff;border-color:#276749;white-space:nowrap;" onclick="window._mlBatchAck()" data-tip="將勾選的紀錄標記為已讀。主責在此標記自己的個案後，管理頁「主責已讀」會同步顯示為已讀。與下方「封存」是不同動作：封存才會讓紀錄從預設列表隱藏。">✅ 批次標記已讀</button>
      ${_mlShowArchived
        ? `<button class="btn btn-sm" style="background:#4a5568;color:#fff;border-color:#4a5568;white-space:nowrap;" onclick="window._mlBatchUnarchive()" data-tip="將勾選的紀錄解除封存，重新出現在預設列表中。">♻️ 批次解封</button>`
        : `<button class="btn btn-sm" style="background:#805ad5;color:#fff;border-color:#805ad5;white-space:nowrap;" onclick="window._mlBatchArchive()" data-tip="將勾選的紀錄封存，預設列表隱藏，可用「顯示已封存」找回。若所選紀錄的主責尚未收到，會先跳出確認。">📦 批次封存</button>`}
      <button class="btn btn-secondary btn-sm" onclick="_mlCheckedIds.clear();renderMentalLeavePage()">取消全選</button>
      <button class="btn btn-secondary btn-sm" onclick="mlPrintNotices()" style="white-space:nowrap;margin-left:auto;">🖨️ 列印通知單</button>
    </div>
    ${totalPages > 1 ? `
    <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin-bottom:6px;font-size:.85rem;">
      <span style="color:#718096;">共 ${totalFiltered} 筆，第 ${_mlPage} / ${totalPages} 頁</span>
      <button class="btn btn-secondary btn-sm" ${_mlPage<=1?'disabled':''} onclick="_mlPage=1;renderMentalLeavePage()">«</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage<=1?'disabled':''} onclick="_mlPage--;renderMentalLeavePage()">‹</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage>=totalPages?'disabled':''} onclick="_mlPage++;renderMentalLeavePage()">›</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage>=totalPages?'disabled':''} onclick="_mlPage=${totalPages};renderMentalLeavePage()">»</button>
    </div>` : ''}
    <div style="overflow-x:auto;">
      <table id="ml-records-table" style="width:100%;border-collapse:collapse;font-size:.875rem;">
        <colgroup>
          <col style="width:28px;">
          <col id="ml-col-1" style="min-width:70px;">
          <col id="ml-col-2" style="min-width:90px;">
          <col id="ml-col-3" style="min-width:80px;">
          <col id="ml-col-4" style="min-width:120px;">
          <col id="ml-col-5" style="min-width:80px;">
          <col id="ml-col-6" style="min-width:90px;">
          <col id="ml-col-7" style="min-width:60px;">
          <col id="ml-col-8" style="min-width:60px;">
          ${isAdmin ? '<col id="ml-col-10" style="min-width:50px;">' : ''}
        </colgroup>
        <thead><tr style="background:#f7fafc;text-align:left;">
          <th style="padding:8px 6px;text-align:center;width:28px;"><input type="checkbox" ${allChecked?'checked':''} onchange="window._mlCheckAll(this.checked)" title="全選/取消"></th>
          <th style="padding:8px 10px;" data-col="1">姓名</th>
          <th style="padding:8px 10px;" data-col="2">學號</th>
          <th style="padding:8px 10px;" data-col="3">請假日期</th>
          <th style="padding:8px 10px;min-width:120px;" data-col="4">請假緣由</th>
          <th style="padding:8px 10px;" data-col="5">風險 / 關鍵字</th>
          <th style="padding:8px 10px;" data-col="6">受理情況</th>
          <th style="padding:8px 10px;" data-col="7">課程</th>
          <th style="padding:8px 10px;" data-col="8">學期</th>
          ${isAdmin ? '<th style="padding:8px 10px;" data-col="10"></th>' : ''}
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${totalPages > 1 ? `
    <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin-top:10px;font-size:.85rem;">
      <span style="color:#718096;">共 ${totalFiltered} 筆，第 ${_mlPage} / ${totalPages} 頁</span>
      <button class="btn btn-secondary btn-sm" ${_mlPage<=1?'disabled':''} onclick="_mlPage=1;renderMentalLeavePage()">«</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage<=1?'disabled':''} onclick="_mlPage--;renderMentalLeavePage()">‹</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage>=totalPages?'disabled':''} onclick="_mlPage++;renderMentalLeavePage()">›</button>
      <button class="btn btn-secondary btn-sm" ${_mlPage>=totalPages?'disabled':''} onclick="_mlPage=${totalPages};renderMentalLeavePage()">»</button>
    </div>` : (totalFiltered > 0 ? `<div style="text-align:right;font-size:.82rem;color:#a0aec0;margin-top:6px;">共 ${totalFiltered} 筆</div>` : '')}`;
  // v174：移除「動作」欄（col9，動作改到姓名下方圖示列），col10（admin 刪除欄）欄號維持不變
  _makeTableResizable({ table: document.getElementById('ml-records-table'), colPrefix: 'ml-col-', colNums: isAdmin ? [1,2,3,4,5,6,7,8,10] : [1,2,3,4,5,6,7,8], prefKey: 'mlColWidths2', skipCols: isAdmin ? new Set([10]) : new Set() });
  // v173：風險／受理情況／案別收合式勾選面板（取代原本並排的風險 checkbox 列＋受理情況/案別 select）
  _fpSyncPanel('ml', [
    { key: 'risk', title: '風險', options: [
      { value: '3', label: '🔴 紅燈' }, { value: '2', label: '🟡 黃燈' },
      { value: '1', label: '🔵 關注' }, { value: '0', label: '無燈號' },
    ] },
    { key: 'handling', title: '受理情況', options: ML_HANDLING_OPTS.map(o => ({ value: o, label: o })) },
    { key: 'abType', title: '案別', options: [{ value: 'A案', label: 'A案' }, { value: 'B案', label: 'B案' }] },
  ], { risk: _mlRiskFilter, handling: _mlHandlingFilter, abType: _mlAbFilter }, 'window._mlFilterChange()');
}
