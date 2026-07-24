// dev/record-form.js — 晤談紀錄表單模組（拆 index.html 絞殺者第十三刀，v259）。
// 內容為從 index.html 逐字搬出的函式，依原始順序分為六組：紀錄清單操作（isEditable／
// _switchDetailSemTo／_flashRecordCard／editRecord／deleteRecord／purgeRecord／restoreRecord，
// 含伴侶紀錄同步刪除/復原/徹底移除）、下次預約前綴 UI（_recFillNextBkUi／
// _updateIntervieweeMultiHint）、開啟晤談紀錄表單與伴侶諮商連動（openNewRecordPage／
// renderRecCounselorChips／syncRecCounselorHidden／addRecCounselor／initRecCounselorsForNew／
// initRecCounselorsForEdit／_coupleId／_syncCoupleRecord／openCoupleCaseSearch／
// clearCoupleTarget／searchCoupleCases／selectCoupleCase／_showCoupleSelected／
// _updateCaseInfoWithCouple／quickOpenCoupleCase／_addCoupleTodos）、角色權限與角色色
// （isRecordCreator／canReadRecord／isAdmin／adminOnlyChip／_roleColorCat／roleColorDotHtml／
// roleColorChipClass／roleColorOptionStyle／roleColorFg）、下次預約欄位與草稿自存
// （toggleNextBookingFields／_checkRecNextBkRealtime／toggleRecNextBkPeriod／
// snapshotRecordDraft／restoreRecordDraft／startRecordDraftAutosave／stopRecordDraftAutosave／
// clearRecordDraft／cancelRecordForm）、服務項目/主題選項與其輔助（toggleServiceSubpanel／
// _showSvcHint／_clearSvcHint／_clearAllSvcHints／_validateSvcGroup／_validateSvcTag／
// _validateTransferCounselor／toggleDapHelp／toggleRecTimeOther／toggleIITimeOther／
// formatTimeInput／toggleRecTopicOther／toggleReportOther／_validateReportOther／
// toggleSocialReport／_validateSvcSocialReport／toggleSocialReportOther／
// _validateSocialReportOther／toggleTransferCounselor／_loadCustomServiceOptions／
// _isSimilar／_restoreTopics／_splitOutsideParens／_restoreServiceItems／_checkMainSvc／
// _checkOrAddSubCb／_addTagDirectly／_appendCustomCheckbox／addCustomServiceOption／
// removeCustomOption／addDynamicTag／_collectServiceItems）、系列預約自動帶入詢問
// （_recNextBkChoiceResolve／_recAskNextBkChoice／_recResolveNextBkPrefill）、以及紀錄本身的
// 即時重複檢核與儲存（_checkRecDuplicate／saveRecord），共 80 個函式。
// 頂層無任何執行副作用（只有 function/async function 與純初始值 const/let 宣告）；本檔頂層
// 宣告的 4 個 const（_ROLE_COLOR_DOT_HEX／_ROLE_COLOR_FG_HEX／_TOPIC_ALIASES／_REFERRAL_FIXED）
// 與 18 個 let（_recordCaseId／_editingRecordId／_recordKind／_recSortDesc／_recPageSize／
// _recPage／_detailCaseId／_detailSemFilter／_detailReturnToNewCase／_recNextBkPrefill／
// _draftKey／_draftTimer／_recCounselors／_recFromBkRoom／_recFromBkId／_coupleTargetCaseId／
// _coupleTargetHistoryCaseId／_recNextBkChoiceResolver）一併搬移，經逐一確認全專案僅本檔各一處
// 宣告、無跨檔重複宣告（比照 v253/v256/v257/v258 的作法）。column-0 複核：本區塊全數為
// function/async function/const/let/收尾大括號/註解/空行，未發現 addEventListener／IIFE／
// window.X=／裸呼叫。
// 例外（narrow the boundary，中段跳過一段共用區塊）：偵察範圍中段（原 index.html 第
// 12471–12528 行）夾著一段「同時段重複紀錄檢核（#9）」共用基礎設施（const _dupStates／
// function _dupFindSameSlot／_dupFormatWhen／_dupRenderAlert／_dupChoose／_dupResolveAtSave），
// 其標頭已明載「晤談紀錄／初次晤談紀錄表／精神科醫師評估／事件處理紀錄共用」，且確認
// event-records.js、initial-interview.js 皆有呼叫這批函式（並非本模組獨有）。故依規則narrow：
// 這段共用基礎設施原樣留在 index.html 原處不動，本檔改為「跳過中段」的兩段式搬移——
// 第一段（openNewRecordPage 等，至 _recResolveNextBkPrefill 結尾）與第二段
// （_checkRecDuplicate／saveRecord，本檔具體使用共用 dup 基礎設施的呼叫端）中間留一道缺口；
// index.html 該處保留兩行「拆到 dev/record-form.js」marker 註解，中間仍夾著原本的共用
// dup 區塊未動。call-time 呼叫在瀏覽器中不受檔案物理位置影響，行為與搬移前完全一致。
// 函式內部在呼叫時才會引用主檔全域可變狀態（casesData／configData／currentUser／
// bookingsData／todosData／DRIVE_FOLDER_ID 等，定義仍留在 index.html），以及主檔與其他拆檔
// 模組內的共用函式／變數（escHtml／semesterLabel／openDateToSemPrefix／currentSemesterPrefix
// （utils.js）、showCaseDetail／_caseHasSem／_semKeyBase（case-detail.js）、
// _caseDetailActiveSem（initial-interview.js）、exitRecordForm／_armSaveFailSnapshot／
// _clearSaveFailSnapshot／_showSaveFailModal（draft-engine.js）、_dupFindSameSlot／
// _dupRenderAlert／_dupResolveAtSave（本檔中段留在 index.html 的共用區塊）、_bkDaysBetween／
// _bkSeriesTargets／_bkAddDays／_bkNextInSeries（utils.js）、_bkCommitOne／_bkGcParamsOf／
// _bkGcFlush／_bkFindConflict／_bkHasCounselor／_bkNextInSeries／_bkNextSerial／bkCommit／
// saveBookings／_checkRecBkConflict／_populateRecNextBkRoomChips（皆定義於 index.html）、
// auditLog／bgJobAdd 系列／showLoading／hideLoading／showToast／showPage／setAlert／
// saveCasesChunks／saveUserTodos／driveUpdateJsonFile／_assignChunkForNewCase／
// generateCaseId／recordCounselorUsage／buildCounselorOptgroups／_genTodoId／_putTodoItem／
// _syncTodoBadge／formatCounselorLabel／getRichTextValue／setRichTextValue／_validateTopicOther／
// attachInit／attachFlush（皆定義於 index.html）等，屬 call-time 解析，與其他拆檔模組
// （utils.js／ft-core.js／case-detail.js／case-import.js／initial-interview.js／psych-import.js／
// grad-eval.js／closure-eval.js／event-records.js／draft-engine.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="record-form.js"></script> 載入（放在
// draft-engine.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ══════════════════════════════════════════════
//  晤談紀錄（全頁面）
// ══════════════════════════════════════════════
let _recordCaseId   = null;
let _editingRecordId = null;
let _recordKind = '晤談記錄';
let _recSortDesc = true; // 晤談紀錄排序：true=新→舊，false=舊→新
let _recPageSize = parseInt(localStorage.getItem('scc_rec_pagesize') || '5');
let _recPage = 1;
let _detailCaseId = null; // tracks which case is open; resets page when case changes
let _detailSemFilter = 'current'; // 'current' | 'all'
// #7：新增個案表單「查看現有案號」進入個案詳細頁時設此旗標，讓返回動線改回「新增個案」頁且不重置表單內容
let _detailReturnToNewCase = false;

function isEditable(createdAt) {
  return true;
}

// ── 紀錄儲存後返回個案詳細頁：定位＋醒目提示（#22） ──────────
// 跨學期個案：若剛儲存的紀錄所屬學期不是目前分頁，先切過去，避免捲動時找不到該卡片
function _switchDetailSemTo(c, sem) {
  if (!c || !sem) return;
  if (!(Array.isArray(c.semesters) && c.semesters.length > 1)) return;
  // sem 可能是精確的 #N key（呼叫端已知確切開案），也可能是由日期推算出的 base（不含 #N）；
  // 精確符合優先；否則以 base 相符尋找，若目前分頁已符合該 base 則維持不跳頁（避免 #1/#2 間跳動）
  let target = c.semesters.includes(sem) ? sem : null;
  if (!target) {
    const base = _semKeyBase(sem);
    target = (_caseDetailActiveSem && _semKeyBase(_caseDetailActiveSem) === base)
      ? _caseDetailActiveSem
      : c.semesters.find(k => _semKeyBase(k) === base);
  }
  if (target) {
    _caseDetailActiveSem = target;
    _detailSemFilter = 'current';
  }
}
// 捲動至指定紀錄卡片並背景閃爍 2 秒；於 showCaseDetail 完成渲染後呼叫
function _flashRecordCard(domId, scroll = true) {
  if (!domId) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(domId);
    if (!el) return;
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('rec-just-saved');
    setTimeout(() => el.classList.remove('rec-just-saved'), 2000);
  });
}

function editRecord(caseId, recordId) {
  const c = casesData.find(x => x.id === caseId);
  const rec = (c?.records || []).find(r => r.id === recordId);
  openNewRecordPage(caseId, recordId, rec?.recordKind || '晤談記錄');
}

async function deleteRecord(caseId, recordId) {
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const ridx = (casesData[cidx].records || []).findIndex(r => r.id === recordId);
  if (ridx === -1) return;
  const rec = casesData[cidx].records[ridx];

  if (!isAdmin() && !isRecordCreator(rec)) {
    alert('您無權刪除此晤談紀錄。');
    return;
  }
  const confirmed = confirm(
    '確定要刪除這筆晤談紀錄？\n\n' +
    '刪除後仍會在建立者與管理者介面留下「痕跡」，可顯示誰、何時刪除。\n' +
    '若需徹底清除痕跡，請聯絡管理者執行「徹底移除」。'
  );
  if (!confirmed) return;
  rec.deleted     = true;
  rec.deletedAt   = new Date().toISOString();
  rec.deletedBy   = currentUser.email;
  rec.deletedByName = configData?.users?.[currentUser.email]?.name || currentUser.name;
  casesData[cidx].updatedAt = new Date().toISOString();
  // 若為伴侶記錄，同步刪除夥伴方
  let _delPCaseIdx = -1, _delPRecIdx = -1;
  if (rec.coupleId && rec.coupleCaseId) {
    _delPCaseIdx = casesData.findIndex(c => c.id === rec.coupleCaseId);
    if (_delPCaseIdx >= 0) {
      _delPRecIdx = (casesData[_delPCaseIdx].records || []).findIndex(r => r.coupleId === rec.coupleId);
      if (_delPRecIdx >= 0) {
        const pRec = casesData[_delPCaseIdx].records[_delPRecIdx];
        if (!pRec.deleted) {
          pRec.deleted = true;
          pRec.deletedAt = rec.deletedAt;
          pRec.deletedBy = rec.deletedBy;
          pRec.deletedByName = rec.deletedByName;
          casesData[_delPCaseIdx].updatedAt = new Date().toISOString();
        }
      }
    }
  }

  const _cName = casesData[cidx].name || caseId;
  const _recJobId = bgJobAdd(rec.status === 'pending' ? '刪除草稿記錄' : '刪除晤談記錄', _cName);
  showCaseDetail(caseId);
  const _delSaveIds = [caseId, ...(rec.coupleId && rec.coupleCaseId ? [rec.coupleCaseId] : [])];
  saveCasesChunks(..._delSaveIds).then(() => {
    bgJobDone(_recJobId);
    auditLog('刪除晤談紀錄', caseId, recordId, rec.date ? `${rec.date}（${semesterLabel(openDateToSemPrefix(rec.date))}）` : '');
    showToast('晤談紀錄已刪除');
  }).catch(err => {
    delete rec.deleted; delete rec.deletedAt; delete rec.deletedBy; delete rec.deletedByName;
    if (_delPCaseIdx >= 0 && _delPRecIdx >= 0) {
      const pRec = casesData[_delPCaseIdx].records[_delPRecIdx];
      delete pRec.deleted; delete pRec.deletedAt; delete pRec.deletedBy; delete pRec.deletedByName;
    }
    showCaseDetail(caseId);
    bgJobFail(_recJobId, err.message);
    showToast('刪除失敗：' + err.message, 'error');
  });
}

// 徹底移除已刪除紀錄（僅管理者）
async function purgeRecord(caseId, recordId) {
  if (!isAdmin()) { alert('僅管理者可徹底移除紀錄。'); return; }
  if (!confirm('確定要徹底移除此紀錄？此動作不可復原，將清除「已刪除」痕跡。')) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const ridx = (casesData[cidx].records || []).findIndex(r => r.id === recordId);
  if (ridx === -1) return;
  const removed = casesData[cidx].records.splice(ridx, 1)[0];
  casesData[cidx].updatedAt = new Date().toISOString();
  // 若為伴侶記錄，同步徹底移除夥伴方
  let _purgePCaseIdx = -1, _purgePRecIdx = -1, _purgePartnerRec = null;
  if (removed.coupleId && removed.coupleCaseId) {
    _purgePCaseIdx = casesData.findIndex(c => c.id === removed.coupleCaseId);
    if (_purgePCaseIdx >= 0) {
      _purgePRecIdx = (casesData[_purgePCaseIdx].records || []).findIndex(r => r.coupleId === removed.coupleId);
      if (_purgePRecIdx >= 0) {
        [_purgePartnerRec] = casesData[_purgePCaseIdx].records.splice(_purgePRecIdx, 1);
        casesData[_purgePCaseIdx].updatedAt = new Date().toISOString();
      }
    }
  }
  showLoading('徹底移除…');
  const jobId = bgJobAdd('徹底移除晤談紀錄');
  try {
    const _purgeIds = [caseId, ...(removed.coupleId && removed.coupleCaseId ? [removed.coupleCaseId] : [])];
    await saveCasesChunks(..._purgeIds);
    bgJobDone(jobId);
    auditLog('徹底移除晤談紀錄', caseId, recordId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    bgJobFail(jobId, err.message);
    casesData[cidx].records.splice(ridx, 0, removed);
    if (_purgePartnerRec && _purgePCaseIdx >= 0 && _purgePRecIdx >= 0) {
      casesData[_purgePCaseIdx].records.splice(_purgePRecIdx, 0, _purgePartnerRec);
    }
    hideLoading();
    alert('操作失敗：' + err.message);
  }
}

async function restoreRecord(caseId, recordId) {
  if (!confirm('確定要復原這筆晤談紀錄？')) return;

  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const rec = (casesData[cidx].records || []).find(r => r.id === recordId);
  if (!rec) return;

  const prev = { deleted: rec.deleted, deletedAt: rec.deletedAt, deletedBy: rec.deletedBy, deletedByName: rec.deletedByName };
  delete rec.deleted; delete rec.deletedAt; delete rec.deletedBy; delete rec.deletedByName;
  casesData[cidx].updatedAt = new Date().toISOString();

  showLoading('復原紀錄…');
  const jobId = bgJobAdd('復原晤談紀錄');
  try {
    await saveCasesChunks(caseId);
    bgJobDone(jobId);
    auditLog('復原晤談紀錄', caseId, recordId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    bgJobFail(jobId, err.message);
    Object.assign(rec, prev);
    hideLoading();
    alert('操作失敗：' + err.message);
  }
}

// 從系列預約自動帶入下次會談時：使用者是否已改動 UI 供後續 saveRecord 判斷（見 _recNextBkPrefill）。
let _recNextBkPrefill = null; // { bkId, room, date, start, end } | null

// 把一筆 booking 的空間/日期/時間套用到「預約下次諮商空間」UI 區塊（含節次比對）。
// 供編輯既有紀錄還原 nextBkId、以及從系列預約寫紀錄自動帶入下次會談共用。
function _recFillNextBkUi(_linkedBk) {
  if (!_linkedBk) return;
  const _nbTgl = document.getElementById('rec-next-bk-toggle');
  if (_nbTgl) { _nbTgl.checked = true; toggleNextBookingFields(); }
  const _nbDt = document.getElementById('rec-next-bk-date');
  if (_nbDt) _nbDt.value = _linkedBk.date || '';
  _recNextBkRoom = _linkedBk.room === '其他' ? (_linkedBk.customRoom || '其他') : (_linkedBk.room || '');
  _populateRecNextBkRoomChips(_recNextBkRoom);
  const _pSel = document.getElementById('rec-next-bk-period');
  const _tRow = document.getElementById('rec-next-bk-time-row');
  const _sH = (_linkedBk.startTime || '').slice(0, 5);
  const _eH = (_linkedBk.endTime   || '').slice(0, 5);
  let _matched = false;
  if (_pSel) {
    for (const opt of _pSel.options) {
      const m = opt.value.match(/(\d{2}:\d{2})[-–](\d{2}:\d{2})/);
      if (m && m[1] === _sH && m[2] === _eH) { _pSel.value = opt.value; _matched = true; break; }
    }
  }
  document.getElementById('rec-next-bk-start').value = _sH;
  document.getElementById('rec-next-bk-end').value   = _eH;
  if (_tRow) _tRow.style.display = _matched ? 'none' : (_sH && _eH ? 'block' : 'none');
  if (!_matched && _pSel && _sH && _eH) _pSel.value = '其他';
}

// #8：晤談對象勾選 2 位（含）以上時顯示提示（代表同場次聯合晤談，統計僅計 1 筆；分別晤談應各自建立紀錄）
function _updateIntervieweeMultiHint(name, hintId) {
  const hint = document.getElementById(hintId);
  if (!hint) return;
  const n = document.querySelectorAll(`input[name="${name}"]:checked`).length;
  hint.style.display = n >= 2 ? '' : 'none';
}

function openNewRecordPage(caseId, recordId = null, recordKind = '晤談記錄', prefill = null) {
  _recordCaseId    = caseId;
  _editingRecordId = recordId || null;
  _recordKind      = recordKind;
  // 重置同時段重複紀錄檢核（#9）的殘留狀態/警示區塊，避免帶到上一筆的選擇
  delete _dupStates.rec;
  const _recDupEl0 = document.getElementById('rec-dup-alert');
  if (_recDupEl0) { _recDupEl0.style.display = 'none'; _recDupEl0.innerHTML = ''; }
  const c = casesData.find(x => x.id === caseId);
  const existingRec = recordId ? (c?.records || []).find(r => r.id === recordId) : null;
  _draftKey = `scc_draft_record_${currentUser?.email || ''}_${caseId}_${recordId || 'new'}`;

  document.getElementById('new-record-page-title').textContent =
    recordId ? `編輯${existingRec?.recordKind||'晤談紀錄'}` : `新增${_recordKind}`;
  // 重設伴侶諮商狀態
  _coupleTargetCaseId = null;
  _coupleTargetHistoryCaseId = null;
  const _couplePanel = document.getElementById('couple-case-panel');
  if (_couplePanel) _couplePanel.style.display = 'none';
  const _csb = document.getElementById('couple-search-box'); if (_csb) _csb.style.display = '';
  const _csi = document.getElementById('couple-search-input'); if (_csi) _csi.value = '';
  const _csr = document.getElementById('couple-search-results'); if (_csr) _csr.innerHTML = '';
  const _cmi = document.getElementById('couple-manual-input'); if (_cmi) _cmi.style.display = 'none';
  const _ccs = document.getElementById('couple-case-selected'); if (_ccs) _ccs.style.display = 'none';
  const _cqb = document.getElementById('couple-quick-open-bar'); if (_cqb) _cqb.style.display = 'none';
  const _optCouple = document.getElementById('opt-couple-counseling'); if (_optCouple) _optCouple.style.display = 'none';
  // case-info 顯示
  const _caseInfoEl = document.getElementById('new-record-case-info');
  if (existingRec?.coupleId) {
    _caseInfoEl.innerHTML =
      `個案：${escHtml(c?.name || '—')}（${escHtml(caseId)}）` +
      ` ｜ 共用對象：<strong>${escHtml(existingRec.couplePartnerName || existingRec.coupleCaseId || '—')}</strong>`;
    if (_optCouple) _optCouple.style.display = '';
  } else {
    // 新增紀錄、或編輯尚未設定伴侶諮商的既有紀錄，皆可加選晤談對象（#19：編輯模式先前漏了這顆按鈕，導致無法補設伴侶諮商）
    _caseInfoEl.innerHTML =
      `個案：${escHtml(c?.name || '—')}（${escHtml(caseId)}）` +
      ` <button class="btn btn-secondary btn-sm" type="button" onclick="openCoupleCaseSearch()" style="margin-left:10px;">＋ 增加晤談對象</button>`;
  }

  // ── 先全部清空 ──
  document.getElementById('rec-time-other').style.display = 'none';
  document.getElementById('rec-time-other').value = '';
  const _nbPeriodEl = document.getElementById('rec-next-bk-period');
  if (_nbPeriodEl) _nbPeriodEl.value = '';
  const _nbTimeRow = document.getElementById('rec-next-bk-time-row');
  if (_nbTimeRow) _nbTimeRow.style.display = 'none';
  const _nbStart = document.getElementById('rec-next-bk-start');
  if (_nbStart) _nbStart.value = '';
  const _nbEnd = document.getElementById('rec-next-bk-end');
  if (_nbEnd) _nbEnd.value = '';
  document.querySelectorAll('input[name="rec-topic"]').forEach(cb => cb.checked = false);
  const _rtoWrap = document.getElementById('rec-topic-other-wrap'); if (_rtoWrap) _rtoWrap.style.display = 'none';
  document.getElementById('rec-topic-other').value = '';

  document.querySelectorAll('input[name="rec-service-main"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.service-subpanel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('input[name="rec-psychtest"], input[name="rec-referral"], input[name="rec-report"], input[name="rec-genderequal"], input[name="rec-social-report"]')
    .forEach(cb => cb.checked = false);
  document.getElementById('sp-social-report').style.display = 'none';
  document.getElementById('sp-social-report-other').value = '';
  document.getElementById('sp-social-report-other').style.display = 'none';
  document.querySelectorAll('input[name="rec-transfer-type"]').forEach(r => r.checked = false);
  const defTransfer = document.querySelector('input[name="rec-transfer-type"][value="分案會議"]');
  if (defTransfer) defTransfer.checked = true;
  document.getElementById('sp-transfer-counselor').style.display = 'none';
  document.getElementById('sp-report-other').value = '';
  document.getElementById('sp-report-other').style.display = 'none';

  ['sp-accompany-tags','sp-other-tags'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
  ['sp-psychtest-input','sp-referral-input','sp-accompany-input','sp-other-input'].forEach(id => {
    document.getElementById(id).value = '';
  });

  _loadCustomServiceOptions();

  // 填充內部轉案輔導人員下拉（僅顯示具輔導職稱者）
  const _COUNSELING_ROLES = new Set([
    '主任','專任社會工作師','專任諮商心理師','專任臨床心理師',
    '兼任諮商心理師','兼任臨床心理師','實習諮商心理師','駐校精神科醫師',
  ]);
  /* COUNSELOR_SELECT_GROUP:rec-transfer-counselor */
  document.getElementById('rec-transfer-counselor').innerHTML =
    buildCounselorOptgroups(([email, info]) => _COUNSELING_ROLES.has(info.role) && email !== currentUser.email);

  document.getElementById('dap-help-panel').classList.remove('active');
  setAlert('new-record-alert', '', '');
  _clearAllSvcHints();
  document.getElementById('btn-save-record').disabled = false;
  _recFromBkRoom = '';
  _recFromBkId   = '';
  _recNextBkPrefill = null;
  let _seriesNextBk = null; // 若從系列預約「寫紀錄」進入，這裡存下次會談那一筆（供下方自動帶入使用）

  if (existingRec) {
    // ── 編輯模式：填入現有資料 ──
    document.getElementById('rec-date').value = existingRec.date || '';
    const storedTime = existingRec.time || '';
    const isCustomTime = storedTime.startsWith('其他：') || /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(storedTime);
    if (isCustomTime) {
      document.getElementById('rec-time').value = '其他';
      document.getElementById('rec-time-other').style.display = '';
      document.getElementById('rec-time-other').value = storedTime.startsWith('其他：') ? storedTime.slice(3) : storedTime;
    } else {
      document.getElementById('rec-time').value = storedTime;
      document.getElementById('rec-time-other').style.display = 'none';
      document.getElementById('rec-time-other').value = '';
    }
    initRecCounselorsForEdit(existingRec);
    setRichTextValue('rec-summary',    existingRec.summary    || '');
    setRichTextValue('rec-assessment', existingRec.assessment || '');
    setRichTextValue('rec-next-plan',  existingRec.nextPlan   || '');
    setRichTextValue('rec-notes',      existingRec.notes      || '');
    attachInit('rec', existingRec.attachments || [], { dropTargets: ['rec-summary','rec-assessment','rec-next-plan','rec-notes'] });
    attachInit('recimg', existingRec.summaryImages || [], { imagesOnly: true, imgMaxPx: 1024, imgQuality: 0.7 });
    _restoreTopics(existingRec.topics || []);
    _restoreServiceItems(existingRec.serviceItems || []);
    document.getElementById('rec-intervention-mode').value = existingRec.interventionMode || '';
    document.querySelectorAll('input[name="rec-interviewee"]').forEach(cb => { cb.checked = (existingRec.interviewees || []).includes(cb.value); });
    const _rin = document.getElementById('rec-interviewee-note'); if (_rin) _rin.value = existingRec.intervieweeNote || '';
    _updateIntervieweeMultiHint('rec-interviewee', 'rec-interviewee-multi-hint');
  } else {
    // ── 新增模式 ──
    document.getElementById('rec-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('rec-time').value = '';
    document.getElementById('rec-time-other').style.display = 'none';
    document.getElementById('rec-time-other').value = '';
    initRecCounselorsForNew();
    setRichTextValue('rec-summary',    '');
    setRichTextValue('rec-assessment', '');
    setRichTextValue('rec-next-plan',  '');
    setRichTextValue('rec-notes',      '');
    attachInit('rec', [], { dropTargets: ['rec-summary','rec-assessment','rec-next-plan','rec-notes'] });
    attachInit('recimg', [], { imagesOnly: true, imgMaxPx: 1024, imgQuality: 0.7 });
    document.getElementById('rec-intervention-mode').value = '';
    document.querySelectorAll('input[name="rec-interviewee"]').forEach(cb => cb.checked = false);
    const _rinNew = document.getElementById('rec-interviewee-note'); if (_rinNew) _rinNew.value = '';
    _updateIntervieweeMultiHint('rec-interviewee', 'rec-interviewee-multi-hint');
  }
  // 來自空間預約：覆蓋日期/時間/晤談者，並跳過草稿還原
  if (prefill && !existingRec) {
    _draftKey = null;
    if (prefill.date) document.getElementById('rec-date').value = prefill.date;
    const _pfPidx = BK_PERIODS.findIndex(p => p.start === (prefill.startTime||'') && p.end === (prefill.endTime||''));
    const _pfTimeEl = document.getElementById('rec-time');
    if (_pfPidx >= 0) {
      _pfTimeEl.selectedIndex = _pfPidx + 2;
      document.getElementById('rec-time-other').style.display = 'none';
    } else if (prefill.startTime && prefill.endTime) {
      _pfTimeEl.value = '其他';
      document.getElementById('rec-time-other').style.display = '';
      document.getElementById('rec-time-other').value = `${prefill.startTime}-${prefill.endTime}`;
    }
    if (prefill.counselorEmail && configData?.users?.[prefill.counselorEmail] && prefill.counselorEmail !== currentUser?.email) {
      const _pfLbl = formatCounselorLabel(prefill.counselorEmail);
      if (!_recCounselors.find(c => c.email === prefill.counselorEmail)) {
        _recCounselors.push({ email: prefill.counselorEmail, label: _pfLbl });
        renderRecCounselorChips();
      }
    }
    _recFromBkRoom = prefill.room || '';
    _recFromBkId   = prefill.bookingId || '';
    // 從系列預約的某一筆「寫紀錄」：找同系列下次會談（日期較晚的最早一筆），供下方自動帶入
    if (prefill.bookingId) {
      const _srcBk = bookingsData.find(b => b.id === prefill.bookingId);
      if (_srcBk) _seriesNextBk = _bkNextInSeries(bookingsData, _srcBk);
    }
  }
  // 重置預約下次欄位
  const nbToggle = document.getElementById('rec-next-bk-toggle');
  if (nbToggle) { nbToggle.checked = false; toggleNextBookingFields(); }
  // 預填下次預約日期（今天+7天）
  const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 7);
  const nbDateEl = document.getElementById('rec-next-bk-date');
  if (nbDateEl) nbDateEl.value = nextDate.toISOString().slice(0, 10);
  _recNextBkRoom = '';
  _populateRecNextBkRoomChips('');

  // 編輯模式：若記錄有 nextBkId，還原「預約下次諮商空間」區塊
  if (existingRec?.nextBkId) {
    const _linkedBk = bookingsData.find(b => b.id === existingRec.nextBkId);
    if (_linkedBk) _recFillNextBkUi(_linkedBk);
  } else if (_seriesNextBk) {
    // 從系列預約「寫紀錄」：自動帶入下次會談時段，記錄 prefill 供 saveRecord 判斷使用者是否已更動內容
    _recFillNextBkUi(_seriesNextBk);
    _recNextBkPrefill = {
      bkId: _seriesNextBk.id, room: _recNextBkRoom, date: _seriesNextBk.date,
      start: (_seriesNextBk.startTime || '').slice(0, 5), end: (_seriesNextBk.endTime || '').slice(0, 5),
    };
  }

  showPage('page-new-record', null);
  _checkRecBkConflict();
  _checkRecNextBkRealtime();

  // v265：清空上一份表單殘留的草稿備援時間顯示（兩處小字都清）
  _setRecordDraftStatusText('');

  // 啟動自動儲存（crash recovery；草稿還原改由登入時 _migrateLocalStorageDrafts 處理）
  startRecordDraftAutosave();
}

let _draftKey = null;
let _draftTimer = null;
let _recCounselors = []; // [{email, label}]
let _recFromBkRoom = '';
let _recFromBkId   = '';
let _coupleTargetCaseId = null;        // 已選入的伴侶本學期 caseId
let _coupleTargetHistoryCaseId = null; // 伴侶的歷史個案 id（取姓名/學號及主責諮商師用）

// 渲染晤談者 chips 與下拉
function renderRecCounselorChips() {
  const box = document.getElementById('rec-counselor-chips');
  if (!box) return;
  box.innerHTML = '';
  _recCounselors.forEach((cc, idx) => {
    const isCreator = idx === 0;
    const role = configData?.users?.[cc.email]?.role || '';
    const cat = _roleColorCat(role);
    const chip = document.createElement('span');
    chip.className = cat ? cat.chipClass : '';
    chip.style.cssText = `display:inline-flex;align-items:center;gap:5px;border-radius:14px;padding:4px 10px;font-size:.85rem;${cat ? '' : `background:${isCreator?'#bee3f8':'#edf2f7'};color:#2d3748;`}${isCreator ? 'box-shadow:0 0 0 1.5px #1a5276 inset;' : ''}`;
    chip.innerHTML = `${roleColorDotHtml(role)}${escHtml(cc.label)}${isCreator ? ' <span style="font-size:.7rem;color:#1a5276;font-weight:700;">建立者</span>' : ''}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.style.cssText = 'background:none;border:none;cursor:pointer;color:#718096;font-weight:700;padding:0 2px;';
    x.innerHTML = '×';
    x.onclick = () => { _recCounselors.splice(idx, 1); renderRecCounselorChips(); syncRecCounselorHidden(); _checkRecBkConflict(); _checkRecDuplicate(); };
    chip.appendChild(x);
    box.appendChild(chip);
  });
  // 重建下拉選項，排除已加入者 /* COUNSELOR_SELECT_GROUP:rec-counselor-add-sel */
  const sel = document.getElementById('rec-counselor-add-sel');
  if (sel) {
    const exist = new Set(_recCounselors.map(c => c.email));
    sel.innerHTML = buildCounselorOptgroups(
      ([email, info]) => BK_COUNSELING_ROLES.has(info.role || '') && !exist.has(email),
      '— 新增晤談者 —'
    );
  }
  syncRecCounselorHidden();
}

function syncRecCounselorHidden() {
  const hidden = document.getElementById('rec-counselor');
  if (hidden) hidden.value = _recCounselors.map(c => c.label).join('、');
}

function addRecCounselor() {
  const sel = document.getElementById('rec-counselor-add-sel');
  if (!sel || !sel.value) return;
  const email = sel.value;
  const label = formatCounselorLabel(email);
  if (_recCounselors.find(c => c.email === email)) return;
  _recCounselors.push({ email, label });
  recordCounselorUsage(email);
  sel.value = '';
  renderRecCounselorChips();
  _checkRecBkConflict();
  _checkRecDuplicate();
}

function initRecCounselorsForNew() {
  _recCounselors = [];
  const me = currentUser?.email;
  if (me) {
    _recCounselors.push({ email: me, label: formatCounselorLabel(me) });
  }
  renderRecCounselorChips();
}

function initRecCounselorsForEdit(rec) {
  _recCounselors = [];
  if (Array.isArray(rec?.counselors) && rec.counselors.length) {
    rec.counselors.forEach(cc => {
      _recCounselors.push({ email: cc.email || '', label: cc.label || (cc.email ? formatCounselorLabel(cc.email) : '') });
    });
  } else {
    // 舊資料：只有 counselorEmail + counselorName
    const email = rec?.counselorEmail || '';
    const label = rec?.counselorName || (email ? formatCounselorLabel(email) : '');
    if (email || label) _recCounselors.push({ email, label });
  }
  renderRecCounselorChips();
}

// ── 伴侶諮商 ──────────────────────────────────────────
function _coupleId() {
  return 'CPID-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function _syncCoupleRecord(masterRec) {
  if (!masterRec.coupleId || !masterRec.coupleCaseId) return;
  const pCaseIdx = casesData.findIndex(c => c.id === masterRec.coupleCaseId);
  if (pCaseIdx === -1) return;
  const pRec = (casesData[pCaseIdx].records || []).find(r => r.coupleId === masterRec.coupleId);
  if (!pRec) return;
  const SKIP = new Set([
    'id', 'coupleId', 'coupleCaseId', 'couplePartnerName',
    'createdAt', 'creatorEmail', 'counselorEmail', 'counselorName', 'counselors',
    'recordKind', 'nextBkId',
    'deleted', 'deletedAt', 'deletedBy', 'deletedByName',
    'status', 'draftSavedAt',
  ]);
  for (const k of Object.keys(masterRec)) {
    if (!SKIP.has(k)) pRec[k] = masterRec[k];
  }
  casesData[pCaseIdx].updatedAt = new Date().toISOString();
}

function openCoupleCaseSearch() {
  const panel = document.getElementById('couple-case-panel');
  if (panel) panel.style.display = '';
  const inp = document.getElementById('couple-search-input');
  if (inp) { inp.value = ''; inp.focus(); }
  document.getElementById('couple-search-results').innerHTML = '';
  document.getElementById('couple-manual-input').style.display = 'none';
}

function clearCoupleTarget() {
  _coupleTargetCaseId = null;
  _coupleTargetHistoryCaseId = null;
  document.getElementById('couple-case-selected').style.display = 'none';
  document.getElementById('couple-quick-open-bar').style.display = 'none';
  document.getElementById('couple-search-box').style.display = '';
  const _csi = document.getElementById('couple-search-input'); if (_csi) _csi.value = '';
  document.getElementById('couple-search-results').innerHTML = '';
  document.getElementById('couple-manual-input').style.display = 'none';
  const opt = document.getElementById('opt-couple-counseling'); if (opt) opt.style.display = 'none';
  const modeEl = document.getElementById('rec-intervention-mode');
  if (modeEl && modeEl.value === '伴侶諮商') modeEl.value = '';
  const c = casesData.find(x => x.id === _recordCaseId);
  const caseInfoEl = document.getElementById('new-record-case-info');
  if (caseInfoEl && c) {
    caseInfoEl.innerHTML =
      `個案：${escHtml(c.name || '—')}（${escHtml(_recordCaseId)}）` +
      ` <button class="btn btn-secondary btn-sm" type="button" onclick="openCoupleCaseSearch()" style="margin-left:10px;">＋ 增加晤談對象</button>`;
  }
}

function searchCoupleCases(q) {
  const res = document.getElementById('couple-search-results');
  const manualDiv = document.getElementById('couple-manual-input');
  if (!res) return;
  q = (q || '').trim();
  if (!q) { res.innerHTML = ''; if (manualDiv) manualDiv.style.display = 'none'; return; }
  const thisSem = currentSemesterPrefix();
  const hasCaseThisSem = c =>
    !c.deleted &&
    (Array.isArray(c.semesters) ? _caseHasSem(c, thisSem) : openDateToSemPrefix(c.openDate) === thisSem);
  const qLow = q.toLowerCase();
  const hits = casesData.filter(c =>
    c.id !== _recordCaseId && !c.deleted &&
    ((c.name || '').toLowerCase().includes(qLow) || (c.studentId || '').includes(qLow))
  );
  if (!hits.length) {
    res.innerHTML = '<div style="font-size:.85rem;color:#718096;padding:6px 4px;">找不到符合的個案。</div>';
    if (manualDiv) manualDiv.style.display = '';
    return;
  }
  // 按 studentId 分組
  const byStudent = new Map();
  for (const c of hits) {
    const key = c.studentId || c.id;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(c);
  }
  if (manualDiv) manualDiv.style.display = 'none';
  res.innerHTML = '';
  for (const [, cases] of byStudent) {
    const thisSemCase = cases.find(hasCaseThisSem);
    const repCase = thisSemCase || cases.sort((a, b) => (b.openDate || '').localeCompare(a.openDate || ''))[0];
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;font-size:.88rem;border:1px solid #e2e8f0;margin-bottom:4px;background:#fff;';
    item.onmouseenter = () => { item.style.background = '#f7fafc'; };
    item.onmouseleave = () => { item.style.background = '#fff'; };
    const status = thisSemCase
      ? '<span style="font-size:.75rem;padding:1px 6px;background:#c6f6d5;color:#276749;border-radius:10px;flex-shrink:0;">本學期已開案</span>'
      : '<span style="font-size:.75rem;padding:1px 6px;background:#fefcbf;color:#744210;border-radius:10px;flex-shrink:0;">本學期未開案</span>';
    item.innerHTML = `<span style="flex:1;"><strong>${escHtml(repCase.name || '—')}</strong>（${escHtml(repCase.studentId || '—')}）</span>${status}`;
    item.onclick = () => selectCoupleCase(thisSemCase ? thisSemCase.id : null, repCase);
    res.appendChild(item);
  }
}

function selectCoupleCase(caseId, repCase) {
  document.getElementById('couple-search-results').innerHTML = '';
  document.getElementById('couple-manual-input').style.display = 'none';
  _coupleTargetHistoryCaseId = repCase?.id || null;
  if (caseId) {
    _coupleTargetCaseId = caseId;
    document.getElementById('couple-quick-open-bar').style.display = 'none';
    _showCoupleSelected(repCase, false);
  } else {
    _coupleTargetCaseId = null;
    const bar = document.getElementById('couple-quick-open-bar');
    document.getElementById('couple-quick-open-msg').textContent =
      `${escHtml(repCase?.name || '此個案')}本學期尚未開案，需先快速開案才能共用記錄。`;
    bar.style.display = '';
    _showCoupleSelected(repCase, true);
  }
  document.getElementById('couple-search-box').style.display = 'none';
}

function _showCoupleSelected(repCase, isPending) {
  const label = `${repCase?.name || '—'}（${repCase?.studentId || '—'}）`;
  document.getElementById('couple-selected-label').textContent = label;
  document.getElementById('couple-case-selected').style.display = 'flex';
  if (!isPending) _updateCaseInfoWithCouple(label);
}

function _updateCaseInfoWithCouple(coupleLabel) {
  const c = casesData.find(x => x.id === _recordCaseId);
  const caseInfoEl = document.getElementById('new-record-case-info');
  if (!caseInfoEl) return;
  caseInfoEl.innerHTML =
    `個案：${escHtml(c?.name || '—')}（${escHtml(_recordCaseId)}）` +
    ` ｜ 共用對象：<strong>${escHtml(coupleLabel)}</strong>`;
  const opt = document.getElementById('opt-couple-counseling');
  if (opt) opt.style.display = '';
  const modeEl = document.getElementById('rec-intervention-mode');
  if (modeEl) modeEl.value = '伴侶諮商';
}

async function quickOpenCoupleCase() {
  let name, studentId, existingCounselorEmail;
  const historicCase = _coupleTargetHistoryCaseId
    ? casesData.find(c => c.id === _coupleTargetHistoryCaseId) : null;
  if (historicCase) {
    name = historicCase.name || '';
    studentId = historicCase.studentId || '';
    existingCounselorEmail = historicCase.counselorEmail || '';
  } else {
    name = (document.getElementById('couple-manual-name')?.value || '').trim();
    studentId = (document.getElementById('couple-manual-sid')?.value || '').trim();
    existingCounselorEmail = '';
  }
  if (!name || !studentId) { alert('請輸入姓名與學號。'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const thisSem = currentSemesterPrefix();
  const newCaseId = generateCaseId();
  const now = new Date().toISOString();
  const newCase = {
    id: newCaseId, openDate: today, name, studentId, semesters: [thisSem],
    counselorEmail: existingCounselorEmail || currentUser.email,
    createdAt: now, updatedAt: now, records: [],
  };
  casesData.push(newCase);
  _assignChunkForNewCase(newCaseId); // Slice 3：已重新分塊時分配 active chunk，否則不動作（legacy fallback）

  const jobId = bgJobAdd('快速開案（伴侶諮商）', name);
  try {
    await _unTombstoneNewCases([newCaseId]); // 重用曾永久刪除的案號時先清墓碑（2026-07-24 事故修補）
    await saveCasesChunks(newCaseId);
    bgJobDone(jobId);
    _addCoupleTodos(newCaseId, name, existingCounselorEmail);
    saveUserTodos().catch(() => {});
  } catch (err) {
    bgJobFail(jobId, err.message);
    const idx = casesData.findIndex(c => c.id === newCaseId);
    if (idx >= 0) casesData.splice(idx, 1);
    alert('快速開案失敗：' + err.message);
    return;
  }

  _coupleTargetCaseId = newCaseId;
  _coupleTargetHistoryCaseId = newCaseId;
  const label = `${name}（${studentId}）`;
  document.getElementById('couple-quick-open-bar').style.display = 'none';
  document.getElementById('couple-selected-label').textContent = label;
  document.getElementById('couple-case-selected').style.display = 'flex';
  _updateCaseInfoWithCouple(label);
  showToast(`已快速開案：${name}`);
}

function _addCoupleTodos(caseId, caseName, counselorEmail) {
  const label = `個案資料尚未填寫完整，請補充「${caseName}」的詳細資料`;
  const now = new Date().toISOString();
  const recipients = new Set([currentUser.email]);
  if (counselorEmail && counselorEmail !== currentUser.email) recipients.add(counselorEmail);
  for (const email of recipients) {
    _putTodoItem({
      id: _genTodoId(), type: 'couple_incomplete', label,
      caseId, caseLabel: `${caseName}（${caseId}）`,
      assignedTo: email,
      createdAt: now, updatedAt: now, done: false, notifRead: false,
    });
  }
}
// ─────────────────────────────────────────────────────

// 權限判定：是否為建立者（可編輯）
function isRecordCreator(rec) {
  if (!rec || !currentUser?.email) return false;
  const creator = rec.creatorEmail || rec.counselorEmail;
  return creator === currentUser.email;
}
// 是否可閱讀：建立者、共同晤談者、管理者、主責、個案管理員
function canReadRecord(rec, c) {
  if (!rec || !currentUser?.email) return false;
  if (isAdmin()) return true;
  if (isRecordCreator(rec)) return true;
  if ((rec.counselors || []).some(cc => cc.email === currentUser.email)) return true;
  if (c && (c.counselorEmail === currentUser.email)) return true;
  if (c && Array.isArray(c.managers) && c.managers.includes(currentUser.email)) return true;
  return false;
}
function isAdmin() {
  return currentRole === '主任' || extraRole === '管理者';
}

// ── #1：管理者/主任限定功能的視覺註記（共用 chip helper，僅視覺標記，不影響任何權限判斷）──
// strict=true → 用於「僅主任本人」的極少數情境；預設（false）用於「主任或系統管理者（extraRole 管理者）」
// compact=true：狹窄空間（如窄欄位）只顯示鎖頭圖示，靠 data-tip 說明，不顯示文字
function adminOnlyChip(strict, compact) {
  const label = strict ? '主任' : '管理';
  const tip = strict ? '此功能僅主任本人可見' : '此功能僅系統管理者（/主任）可見';
  return `<span class="chip-admin-only" data-tip="${tip}">🔒${compact ? '' : ' ' + label}</span>`;
}

// ── #10：輔導人員身分分類色（固定分類色，與使用者可自訂的「我的顏色」偏好機制無關）──
// 依 configData.users[email].role 字串判斷：主任(紫)／專任*(藍)／兼任*(綠)／實習*(橙)／
// 駐校精神科醫師(桃紅)／義務輔導老師(青)。
function _roleColorCat(role) {
  if (!role || typeof role !== 'string') return null;
  if (role === '主任')        return { key: 'director', chipClass: 'role-chip-director', dotClass: 'role-dot-director' };
  if (role.startsWith('專任')) return { key: 'fulltime', chipClass: 'role-chip-fulltime', dotClass: 'role-dot-fulltime' };
  if (role.startsWith('兼任')) return { key: 'parttime', chipClass: 'role-chip-parttime', dotClass: 'role-dot-parttime' };
  if (role.startsWith('實習')) return { key: 'intern',   chipClass: 'role-chip-intern',   dotClass: 'role-dot-intern' };
  if (role === '駐校精神科醫師') return { key: 'psychiatrist', chipClass: 'role-chip-psychiatrist', dotClass: 'role-dot-psychiatrist' };
  if (role === '義務輔導老師') return { key: 'volunteer', chipClass: 'role-chip-volunteer', dotClass: 'role-dot-volunteer' };
  return null;
}
// 回傳一個小圓點 <span>（無分類則回傳空字串）
function roleColorDotHtml(role) {
  const cat = _roleColorCat(role);
  return cat ? `<span class="role-dot ${cat.dotClass}" style="margin-right:5px;" data-tip="身分分類：${escHtml(role)}"></span>` : '';
}
// 回傳 chip 用 class（無分類則回傳空字串，維持原本樣式）
function roleColorChipClass(role) {
  const cat = _roleColorCat(role);
  return cat ? cat.chipClass : '';
}
// 供原生 <option> 使用（無法完整上底色，僅能上文字顏色，瀏覽器支援有限）
function roleColorOptionStyle(role) {
  const cat = _roleColorCat(role);
  if (!cat) return '';
  return `color:${_ROLE_COLOR_DOT_HEX[cat.key]};font-weight:600;`;
}
const _ROLE_COLOR_DOT_HEX = { director: '#805ad5', fulltime: '#3182ce', parttime: '#38a169', intern: '#dd6b20', psychiatrist: '#b83280', volunteer: '#319795' };
const _ROLE_COLOR_FG_HEX  = { director: '#553c9a', fulltime: '#2c5282', parttime: '#276749', intern: '#9c4221', psychiatrist: '#97266d', volunteer: '#285e61' };
// 該分類的深色文字色（用於 chip 內按鈕等需要與 chip 前景色一致的元素）
function roleColorFg(role) {
  const cat = _roleColorCat(role);
  return cat ? _ROLE_COLOR_FG_HEX[cat.key] : '';
}

function toggleNextBookingFields() {
  const show = document.getElementById('rec-next-bk-toggle')?.checked;
  const fields = document.getElementById('rec-next-bk-fields');
  if (fields) fields.style.display = show ? '' : 'none';
  if (!show) {
    const c = document.getElementById('rec-next-bk-conflict');
    if (c) c.style.display = 'none';
  } else {
    _checkRecNextBkRealtime();
  }
}

// 下次預約欄位即時衝突檢查
function _checkRecNextBkRealtime() {
  const cEl = document.getElementById('rec-next-bk-conflict');
  if (!cEl) return;
  if (!document.getElementById('rec-next-bk-toggle')?.checked) { cEl.style.display = 'none'; return; }
  const room  = _recNextBkRoom;
  const date  = document.getElementById('rec-next-bk-date')?.value || '';
  const start = document.getElementById('rec-next-bk-start')?.value || '';
  const end   = document.getElementById('rec-next-bk-end')?.value || '';
  if (!room || !date || !start || !end) { cEl.style.display = 'none'; return; }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) { cEl.style.display = 'none'; return; }
  const oldBkId = _editingRecordId
    ? (casesData.find(c => c.id === _recordCaseId)?.records?.find(r => r.id === _editingRecordId)?.nextBkId || '')
    : '';
  const _pfBkId = _recNextBkPrefill?.bkId || '';
  const conflict = bookingsData.find(b =>
    b.id !== oldBkId && b.id !== _pfBkId && b.room === room && b.date === date &&
    b.startTime < end && b.endTime > start
  );
  if (conflict) {
    cEl.className = 'alert alert-warn';
    cEl.style.display = '';
    cEl.textContent = `衝突：${room} 在 ${(conflict.startTime||'').slice(0,5)}–${(conflict.endTime||'').slice(0,5)} 已有預約（${conflict.counselorName || '—'}）。`;
    return;
  }
  const ccConflict = bookingsData.find(b =>
    b.id !== oldBkId && b.id !== _pfBkId && b.date === date && _bkHasCounselor(b, currentUser?.email) &&
    b.startTime < end && b.endTime > start
  );
  if (ccConflict) {
    cEl.className = 'alert alert-warn';
    cEl.style.display = '';
    cEl.textContent = `您在 ${(ccConflict.startTime||'').slice(0,5)}–${(ccConflict.endTime||'').slice(0,5)} 已有另一預約（${ccConflict.room || '—'}${ccConflict.caseName ? '，' + ccConflict.caseName : ''}）。`;
    return;
  }
  // 無衝突：若目前值與系列自動帶入的 prefill 完全一致，顯示「已自動帶入」提示（非警示樣式）；
  // 使用者已更動（與 prefill 不一致）或本來就無 prefill → 隱藏
  if (_recNextBkPrefill && room === _recNextBkPrefill.room && date === _recNextBkPrefill.date &&
      start === _recNextBkPrefill.start && end === _recNextBkPrefill.end) {
    cEl.className = 'alert alert-info';
    cEl.style.display = '';
    cEl.textContent = '✓ 已自動帶入系列預約的下次會談（儲存時直接沿用該筆，不會重複建立預約）。';
    return;
  }
  cEl.style.display = 'none';
}

function toggleRecNextBkPeriod(sel) {
  const val = sel.value;
  const timeRow = document.getElementById('rec-next-bk-time-row');
  if (val === '其他') {
    document.getElementById('rec-next-bk-start').value = '';
    document.getElementById('rec-next-bk-end').value   = '';
    if (timeRow) timeRow.style.display = 'block';
  } else if (val) {
    const m = val.match(/(\d{2}:\d{2})[-–](\d{2}:\d{2})/);
    document.getElementById('rec-next-bk-start').value = m ? m[1] : '';
    document.getElementById('rec-next-bk-end').value   = m ? m[2] : '';
    if (timeRow) timeRow.style.display = 'none';
  } else {
    document.getElementById('rec-next-bk-start').value = '';
    document.getElementById('rec-next-bk-end').value   = '';
    if (timeRow) timeRow.style.display = 'none';
  }
  _checkRecNextBkRealtime();
}

function snapshotRecordDraft() {
  const draft = {
    _savedAt: new Date().toISOString(),
    date: document.getElementById('rec-date')?.value || '',
    time: document.getElementById('rec-time')?.value || '',
    timeOther: document.getElementById('rec-time-other')?.value || '',
    counselor: document.getElementById('rec-counselor')?.value || '',
    summary: getRichTextValue('rec-summary'),
    assessment: getRichTextValue('rec-assessment'),
    nextPlan: getRichTextValue('rec-next-plan'),
    notes: getRichTextValue('rec-notes'),
    topics: [...document.querySelectorAll('input[name="rec-topic"]:checked')].map(cb => cb.value),
    topicOther: document.getElementById('rec-topic-other')?.value || '',
    services: [...document.querySelectorAll('input[name="rec-service-main"]:checked')].map(cb => cb.value),
    attachments: (_attachState.get('rec')?.existing || []),
  };
  return draft;
}

function restoreRecordDraft(d) {
  if (!d) return;
  if (Array.isArray(d.attachments) && d.attachments.length) attachInit('rec', d.attachments, { dropTargets: ['rec-summary','rec-assessment','rec-next-plan','rec-notes'] });
  attachInit('recimg', Array.isArray(d.summaryImages) ? d.summaryImages : [], { imagesOnly: true, imgMaxPx: 1024, imgQuality: 0.7 });
  if (d.date != null) document.getElementById('rec-date').value = d.date;
  if (d.time != null) {
    document.getElementById('rec-time').value = d.time;
    if (d.time === '其他') {
      document.getElementById('rec-time-other').style.display = '';
      document.getElementById('rec-time-other').value = d.timeOther || '';
    }
  }
  if (d.counselor != null) document.getElementById('rec-counselor').value = d.counselor;
  if (d.summary    != null) setRichTextValue('rec-summary',    d.summary);
  if (d.assessment != null) setRichTextValue('rec-assessment', d.assessment);
  if (d.nextPlan   != null) setRichTextValue('rec-next-plan',  d.nextPlan);
  if (d.notes      != null) setRichTextValue('rec-notes',      d.notes);
  if (Array.isArray(d.topics)) {
    document.querySelectorAll('input[name="rec-topic"]').forEach(cb => {
      cb.checked = d.topics.includes(cb.value);
      if (cb.value === '其他' && cb.checked) {
        const _dtoWrap = document.getElementById('rec-topic-other-wrap'); if (_dtoWrap) _dtoWrap.style.display = 'flex';
        document.getElementById('rec-topic-other').value = d.topicOther || '';
      }
    });
  }
  if (Array.isArray(d.services)) {
    document.querySelectorAll('input[name="rec-service-main"]').forEach(cb => {
      cb.checked = d.services.includes(cb.value);
      if (cb.checked && cb.getAttribute('onchange')) {
        try { cb.dispatchEvent(new Event('change')); } catch(_) {}
      }
    });
  }
}

// 純函式：草稿快照是否有使用者實際輸入內容（v265）——供 autosave 判斷是否寫入、以及
// 側選單/banner 切頁守門判斷 dirty 共用，避免雙實作。
function _recordDraftHasContent(draft) {
  return !!(draft.summary || draft.assessment || draft.nextPlan || draft.notes ||
    draft.topics.length || draft.services.length || (draft.attachments||[]).length);
}

// v265：底部按鈕列（_draft-autosave-status）與標題列旁（_draft-autosave-status-top）兩處
// 「草稿備援 HH:MM」小字同步更新／清空的共用 helper（原本只有底部一處，標題列不顯眼常被忽略）。
function _setRecordDraftStatusText(text) {
  ['_draft-autosave-status', '_draft-autosave-status-top'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

function startRecordDraftAutosave() {
  stopRecordDraftAutosave();
  if (!_draftKey) return;
  _draftTimer = setInterval(() => {
    try {
      const page = document.getElementById('page-new-record');
      if (!page?.classList.contains('active')) return;
      const draft = snapshotRecordDraft();
      // 只在使用者有實際輸入時儲存
      if (_recordDraftHasContent(draft)) {
        localStorage.setItem(_draftKey, JSON.stringify(draft));
        const t = new Date();
        _setRecordDraftStatusText(`草稿備援 ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`);
      }
    } catch (e) { console.warn('draft autosave failed', e); }
  }, 5000);
}

function stopRecordDraftAutosave() {
  if (_draftTimer) { clearInterval(_draftTimer); _draftTimer = null; }
}

function clearRecordDraft() {
  stopRecordDraftAutosave();
  if (_draftKey) {
    try { localStorage.removeItem(_draftKey); } catch(_) {}
  }
  _draftKey = null;
}

function cancelRecordForm() { exitRecordForm(); }

function toggleServiceSubpanel(checkbox, panelId) {
  document.getElementById(panelId).classList.toggle('active', checkbox.checked);
}

function _showSvcHint(id) {
  document.getElementById(id)?.classList.add('visible');
}
function _clearSvcHint(id) {
  document.getElementById(id)?.classList.remove('visible');
}
function _clearAllSvcHints() {
  document.querySelectorAll('.svc-hint').forEach(el => el.classList.remove('visible'));
}

// Real-time per-item validation (called on sub-option change or tag add/remove)
function _validateSvcGroup(mainVal, cbName, hintId) {
  const mainCb = document.querySelector(`input[name="rec-service-main"][value="${mainVal}"]`);
  if (!mainCb?.checked) { _clearSvcHint(hintId); return; }
  if (document.querySelectorAll(`input[name="${cbName}"]:checked`).length)
    _clearSvcHint(hintId);
  else
    _showSvcHint(hintId);
}
function _validateSvcTag(type) {
  const cfg = {
    accompany: { mainVal:'陪同服務', tagsId:'sp-accompany-tags', hintId:'hint-accompany' },
    other:     { mainVal:'其他',     tagsId:'sp-other-tags',     hintId:'hint-rec-other' },
  }[type];
  if (!cfg) return;
  const mainCb = document.querySelector(`input[name="rec-service-main"][value="${cfg.mainVal}"]`);
  if (!mainCb?.checked) { _clearSvcHint(cfg.hintId); return; }
  if (document.querySelectorAll(`#${cfg.tagsId} .dynamic-tag`).length)
    _clearSvcHint(cfg.hintId);
  else
    _showSvcHint(cfg.hintId);
}
function _validateTransferCounselor() {
  const mainCb = document.querySelector('input[name="rec-service-main"][value="內部轉案"]');
  if (!mainCb?.checked) { _clearSvcHint('hint-transfer'); return; }
  const typeVal = document.querySelector('input[name="rec-transfer-type"]:checked')?.value;
  if (typeVal !== '指定輔導人員') { _clearSvcHint('hint-transfer'); return; }
  if (document.getElementById('rec-transfer-counselor').value)
    _clearSvcHint('hint-transfer');
  else
    _showSvcHint('hint-transfer');
}

function toggleDapHelp() {
  document.getElementById('dap-help-panel').classList.toggle('active');
}

function toggleRecTimeOther(sel) {
  const show = sel.value === '其他';
  document.getElementById('rec-time-other').style.display = show ? '' : 'none';
  if (!show) document.getElementById('rec-time-other').value = '';
}
function toggleIITimeOther(sel) {
  const other = document.getElementById('ii-interview-time-other');
  if (!other) return;
  other.style.display = sel.value === '其他' ? '' : 'none';
  if (sel.value !== '其他') other.value = '';
}

function formatTimeInput(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 8);
  let s = d.slice(0, 2);
  if (d.length > 2) s += ':' + d.slice(2, 4);
  if (d.length > 4) s += '-' + d.slice(4, 6);
  if (d.length > 6) s += ':' + d.slice(6, 8);
  el.value = s;
}

function toggleRecTopicOther(cb) {
  const wrap = document.getElementById('rec-topic-other-wrap');
  if (wrap) wrap.style.display = cb.checked ? 'flex' : 'none';
  const el = document.getElementById('rec-topic-other');
  const hint = document.getElementById('rec-topic-other-hint');
  if (!cb.checked) {
    if (el) { el.value = ''; el.style.borderColor = ''; }
    if (hint) hint.style.display = 'none';
  } else if (hint && el) {
    hint.style.display = el.value.trim() ? 'none' : '';
  }
}

function toggleReportOther(cb) {
  const el = document.getElementById('sp-report-other');
  el.style.display = cb.checked ? 'inline-block' : 'none';
  if (!cb.checked) { el.value = ''; _clearSvcHint('hint-report-other'); }
  else _validateReportOther();
}

function _validateReportOther() {
  const cb = document.querySelector('input[name="rec-report"][value="其他通報"]');
  if (!cb?.checked) { _clearSvcHint('hint-report-other'); return; }
  if (document.getElementById('sp-report-other').value.trim())
    _clearSvcHint('hint-report-other');
  else
    _showSvcHint('hint-report-other');
}

function toggleSocialReport(cb) {
  const panel = document.getElementById('sp-social-report');
  panel.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) {
    document.querySelectorAll('input[name="rec-social-report"]').forEach(c => c.checked = false);
    document.getElementById('sp-social-report-other').style.display = 'none';
    document.getElementById('sp-social-report-other').value = '';
    _clearSvcHint('hint-social-report');
    _clearSvcHint('hint-social-report-other');
  }
}

function _validateSvcSocialReport() {
  const mainCb = document.querySelector('input[name="rec-report"][value="社政通報"]');
  if (!mainCb?.checked) { _clearSvcHint('hint-social-report'); return; }
  if (document.querySelectorAll('input[name="rec-social-report"]:checked').length)
    _clearSvcHint('hint-social-report');
  else
    _showSvcHint('hint-social-report');
}

function toggleSocialReportOther(cb) {
  const el = document.getElementById('sp-social-report-other');
  el.style.display = cb.checked ? 'inline-block' : 'none';
  if (!cb.checked) { el.value = ''; _clearSvcHint('hint-social-report-other'); }
  else _validateSocialReportOther();
}

function _validateSocialReportOther() {
  const cb = document.querySelector('input[name="rec-social-report"][value="其他"]');
  if (!cb?.checked) { _clearSvcHint('hint-social-report-other'); return; }
  if (document.getElementById('sp-social-report-other').value.trim())
    _clearSvcHint('hint-social-report-other');
  else
    _showSvcHint('hint-social-report-other');
}

function toggleTransferCounselor() {
  const type = document.querySelector('input[name="rec-transfer-type"]:checked')?.value;
  document.getElementById('sp-transfer-counselor').style.display =
    type === '指定輔導人員' ? '' : 'none';
}

function _loadCustomServiceOptions() {
  const custom = configData?.customOptions || {};

  // 清除上次的動態 checkboxes（保留靜態的）
  ['sp-psychtest-list','sp-referral-list'].forEach(listId => {
    const el = document.getElementById(listId);
    [...el.querySelectorAll('.custom-cb-label')].forEach(l => l.remove());
  });

  (custom.psychTests || []).forEach(name => _appendCustomCheckbox('sp-psychtest-list', 'rec-psychtest', name));
  (custom.referralOptions || []).forEach(name => _appendCustomCheckbox('sp-referral-list', 'rec-referral', name));
}

function _isSimilar(a, b) {
  const norm = s => s.toLowerCase().replace(/[\s（）()【】\-_、。，,]/g, '');
  const na = norm(a), nb = norm(b);
  if (na === nb) return false; // exact match handled separately
  return na.includes(nb) || nb.includes(na);
}

const _TOPIC_ALIASES = {'家庭問題':'家庭關係','人際互動':'人際關係','學業與學習':'學習與課業','生涯發展與規劃':'生涯探索','網路沉迷':'網路成癮'};

function _restoreTopics(topics) {
  topics.forEach(t => {
    if (t.startsWith('其他：')) {
      const cb = document.querySelector('input[name="rec-topic"][value="其他"]');
      if (cb) cb.checked = true;
      const _rtoW = document.getElementById('rec-topic-other-wrap'); if (_rtoW) _rtoW.style.display = 'flex';
      document.getElementById('rec-topic-other').value = t.slice(3);
    } else {
      const norm = _TOPIC_ALIASES[t] || t;
      const cb = document.querySelector(`input[name="rec-topic"][value="${norm}"]`);
      if (cb) cb.checked = true;
    }
  });
}

const _REFERRAL_FIXED = [
  '轉介外部資源（持續諮商或治療）','轉介外部資源（資源連結）','轉介校內精神科醫師',
  '生活輔導組','課外指導組','衛生保健組','原住民資源中心','校內申訴窗口',
  '性別平等委員會窗口','霸凌委員會窗口','教務處','國際事務處',
  '屏安醫院','社會局','自殺防治中心','屏東地方法院','勵馨基金會','食物銀行',
];

function _splitOutsideParens(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth--;
    else if (ch === '、' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function _restoreServiceItems(serviceItems) {
  for (const item of serviceItems) {
    if (['諮商輔導／諮詢','與個案相關資源或關係人聯繫','一次性服務'].includes(item)) {
      _checkMainSvc(item);

    } else if (item.startsWith('心理測驗')) {
      _checkMainSvc('心理測驗');
      document.getElementById('sp-psychtest').classList.add('active');
      if (item.includes('：')) {
        item.slice(item.indexOf('：')+1).split('、').forEach(sub =>
          _checkOrAddSubCb('rec-psychtest', sub.trim(), 'sp-psychtest-list'));
      }

    } else if (item.startsWith('性平行為人')) {
      _checkMainSvc('性平行為人');
      document.getElementById('sp-genderequal')?.classList.add('active');
      if (item.includes('：')) {
        item.slice(item.indexOf('：')+1).split('、').forEach(sub => {
          const cb = document.querySelector(`input[name="rec-genderequal"][value="${sub.trim()}"]`);
          if (cb) cb.checked = true;
        });
      } else {
        if (item.includes('性平教育課程')) { const cb = document.querySelector('input[name="rec-genderequal"][value="性平教育課程"]'); if (cb) cb.checked = true; }
        if (item.includes('心理諮商'))   { const cb = document.querySelector('input[name="rec-genderequal"][value="心理諮商"]');   if (cb) cb.checked = true; }
      }

    } else if (_REFERRAL_FIXED.includes(item)) {
      _checkMainSvc('轉介相關資源');
      document.getElementById('sp-referral').classList.add('active');
      _checkOrAddSubCb('rec-referral', item, 'sp-referral-list');

    } else if (item.startsWith('轉介')) {
      _checkMainSvc('轉介相關資源');
      document.getElementById('sp-referral').classList.add('active');
      _checkOrAddSubCb('rec-referral', item, 'sp-referral-list');

    } else if (item.startsWith('責任通報')) {
      _checkMainSvc('責任通報');
      document.getElementById('sp-report').classList.add('active');
      if (item.includes('：')) {
        _splitOutsideParens(item.slice(item.indexOf('：')+1)).forEach(sub => {
          sub = sub.trim();
          if (sub.startsWith('社政通報')) {
            const cb = document.querySelector('input[name="rec-report"][value="社政通報"]');
            if (cb) cb.checked = true;
            document.getElementById('sp-social-report').style.display = '';
            const inner = sub.match(/[（(](.+)[）)]/);
            if (inner) {
              inner[1].split('、').forEach(s => {
                s = s.trim();
                if (s.startsWith('其他：')) {
                  const scb = document.querySelector('input[name="rec-social-report"][value="其他"]');
                  if (scb) scb.checked = true;
                  document.getElementById('sp-social-report-other').value = s.slice(3);
                  document.getElementById('sp-social-report-other').style.display = 'inline-block';
                } else {
                  const scb = document.querySelector(`input[name="rec-social-report"][value="${s}"]`);
                  if (scb) scb.checked = true;
                }
              });
            }
          } else if (sub.startsWith('其他通報：')) {
            const cb = document.querySelector('input[name="rec-report"][value="其他通報"]');
            if (cb) cb.checked = true;
            document.getElementById('sp-report-other').value = sub.slice(5);
            document.getElementById('sp-report-other').style.display = 'inline-block';
          } else {
            const cb = document.querySelector(`input[name="rec-report"][value="${sub}"]`);
            if (cb) cb.checked = true;
          }
        });
      }

    } else if (item.startsWith('陪同服務')) {
      _checkMainSvc('陪同服務');
      document.getElementById('sp-accompany').classList.add('active');
      if (item.includes('：')) {
        item.slice(item.indexOf('：')+1).split('、').forEach(t => _addTagDirectly('sp-accompany-tags', t.trim()));
      }

    } else if (item.startsWith('內部轉案')) {
      _checkMainSvc('內部轉案');
      document.getElementById('sp-transfer').classList.add('active');
      if (item.includes('分案會議') || !item.includes('：')) {
        const r = document.querySelector('input[name="rec-transfer-type"][value="分案會議"]');
        if (r) r.checked = true;
      } else {
        const r = document.querySelector('input[name="rec-transfer-type"][value="指定輔導人員"]');
        if (r) r.checked = true;
        document.getElementById('sp-transfer-counselor').style.display = '';
        const targetName = item.slice(item.indexOf('：')+1).trim();
        const sel = document.getElementById('rec-transfer-counselor');
        [...sel.options].forEach(opt => { if (opt.text.startsWith(targetName)) opt.selected = true; });
      }

    } else if (item.startsWith('其他')) {
      _checkMainSvc('其他');
      document.getElementById('sp-rec-other').classList.add('active');
      if (item.includes('：')) {
        item.slice(item.indexOf('：')+1).split('、').forEach(t => _addTagDirectly('sp-other-tags', t.trim()));
      }
    }
  }
}

function _checkMainSvc(value) {
  const cb = document.querySelector(`input[name="rec-service-main"][value="${value}"]`);
  if (cb) cb.checked = true;
}

function _checkOrAddSubCb(cbName, value, listId) {
  let cb = document.querySelector(`input[name="${cbName}"][value="${CSS.escape(value)}"]`);
  if (!cb) {
    _appendCustomCheckbox(listId, cbName, value);
    cb = [...document.querySelectorAll(`input[name="${cbName}"]`)].find(el => el.value === value);
  }
  if (cb) cb.checked = true;
}

function _addTagDirectly(tagsId, value) {
  if (!value) return;
  const el = document.getElementById(tagsId);
  if (!el) return;
  if ([...el.querySelectorAll('.dynamic-tag')].some(t => t.dataset.name === value)) return;
  const tagType = tagsId === 'sp-accompany-tags' ? 'accompany' : 'other';
  const tag = document.createElement('div');
  tag.className = 'dynamic-tag';
  tag.dataset.name = value;
  tag.innerHTML = `${escHtml(value)} <button onclick="this.parentElement.remove();_validateSvcTag('${tagType}')" type="button">×</button>`;
  el.appendChild(tag);
}

function _appendCustomCheckbox(listId, cbName, value, checked = false) {
  const el = document.getElementById(listId);
  const type = listId === 'sp-psychtest-list' ? 'psychtest' : 'referral';
  const row = document.createElement('div');
  row.className = 'custom-opt-row';
  row.dataset.name = value;

  const lbl = document.createElement('label');
  const cb  = document.createElement('input');
  cb.type = 'checkbox'; cb.name = cbName; cb.value = value;
  if (checked) cb.checked = true;
  lbl.appendChild(cb);
  lbl.appendChild(document.createTextNode(' ' + value));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del-custom';
  delBtn.type = 'button';
  delBtn.title = '從清單永久刪除';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => removeCustomOption(type, value, delBtn));

  row.appendChild(lbl);
  row.appendChild(delBtn);
  el.appendChild(row);
}

function addCustomServiceOption(type) {
  const inputId = type === 'psychtest' ? 'sp-psychtest-input' : 'sp-referral-input';
  const listId  = type === 'psychtest' ? 'sp-psychtest-list' : 'sp-referral-list';
  const cbName  = type === 'psychtest' ? 'rec-psychtest' : 'rec-referral';
  const cfgKey  = type === 'psychtest' ? 'psychTests' : 'referralOptions';

  const inputEl = document.getElementById(inputId);
  const val = inputEl.value.trim();
  if (!val) return;

  const existing = [...document.querySelectorAll(`#${listId} input[type="checkbox"]`)].map(cb => cb.value);

  // 完全重複
  if (existing.includes(val)) { alert(`「${val}」已在清單中。`); return; }

  // 疑似重複
  const similar = existing.find(n => _isSimilar(n, val));
  if (similar && !confirm(`已有類似的選項「${similar}」，是否仍要新增「${val}」？`)) return;

  _appendCustomCheckbox(listId, cbName, val, true);
  inputEl.value = '';

  if (!configData.customOptions) configData.customOptions = {};
  if (!configData.customOptions[cfgKey]) configData.customOptions[cfgKey] = [];
  if (!configData.customOptions[cfgKey].includes(val)) {
    configData.customOptions[cfgKey].push(val);
    driveUpdateJsonFile(CONFIG_FILE, configData).catch(e => console.warn('儲存自訂選項失敗：', e));
  }
}

async function removeCustomOption(type, name, btn) {
  if (!confirm(`確定要從清單永久刪除「${name}」？\n已勾選本次紀錄的此項目不受影響。`)) return;

  const cfgKey = type === 'psychtest' ? 'psychTests' : 'referralOptions';
  btn.closest('.custom-opt-row').remove();

  if (configData.customOptions?.[cfgKey]) {
    configData.customOptions[cfgKey] = configData.customOptions[cfgKey].filter(n => n !== name);
    driveUpdateJsonFile(CONFIG_FILE, configData).catch(e => console.warn('刪除自訂選項失敗：', e));
  }
}

function addDynamicTag(type) {
  const cfg = {
    accompany: { inputId: 'sp-accompany-input', tagsId: 'sp-accompany-tags' },
    other:     { inputId: 'sp-other-input',     tagsId: 'sp-other-tags' },
  }[type];
  if (!cfg) return;

  const inputEl = document.getElementById(cfg.inputId);
  const val = inputEl.value.trim();
  if (!val) return;

  const tagsEl = document.getElementById(cfg.tagsId);
  const existing = [...tagsEl.querySelectorAll('.dynamic-tag')].map(t => t.dataset.name);
  if (existing.includes(val)) { alert(`「${val}」已在列表中。`); return; }

  const tag = document.createElement('div');
  tag.className = 'dynamic-tag';
  tag.dataset.name = val;
  tag.innerHTML = `${escHtml(val)} <button onclick="this.parentElement.remove();_validateSvcTag('${type}')" type="button">×</button>`;
  tagsEl.appendChild(tag);
  inputEl.value = '';
  _validateSvcTag(type);
}

function _collectServiceItems() {
  const items = [];
  document.querySelectorAll('input[name="rec-service-main"]:checked').forEach(cb => {
    const val = cb.value;
    if (val === '心理測驗') {
      const subs = [...document.querySelectorAll('input[name="rec-psychtest"]:checked')].map(c => c.value);
      items.push(subs.length ? `心理測驗：${subs.join('、')}` : '心理測驗');
    } else if (val === '性平行為人') {
      const subs = [...document.querySelectorAll('input[name="rec-genderequal"]:checked')].map(c => c.value);
      items.push(subs.length ? `性平行為人：${subs.join('、')}` : '性平行為人');
    } else if (val === '轉介相關資源') {
      const subs = [...document.querySelectorAll('input[name="rec-referral"]:checked')].map(c => c.value);
      if (subs.length) subs.forEach(s => items.push(s));
      else items.push('轉介相關資源');
    } else if (val === '責任通報') {
      const subs = [...document.querySelectorAll('input[name="rec-report"]:checked')].map(c => {
        if (c.value === '社政通報') {
          const socialSubs = [...document.querySelectorAll('input[name="rec-social-report"]:checked')].map(s => {
            if (s.value === '其他') {
              const txt = document.getElementById('sp-social-report-other').value.trim();
              return txt ? `其他：${txt}` : '其他';
            }
            return s.value;
          });
          return socialSubs.length ? `社政通報（${socialSubs.join('、')}）` : '社政通報';
        }
        if (c.value === '其他通報') {
          const txt = document.getElementById('sp-report-other').value.trim();
          return txt ? `其他通報：${txt}` : '其他通報';
        }
        return c.value;
      });
      items.push(subs.length ? `責任通報：${subs.join('、')}` : '責任通報');
    } else if (val === '陪同服務') {
      const tags = [...document.querySelectorAll('#sp-accompany-tags .dynamic-tag')].map(t => t.dataset.name);
      items.push(tags.length ? `陪同服務：${tags.join('、')}` : '陪同服務');
    } else if (val === '內部轉案') {
      const type = document.querySelector('input[name="rec-transfer-type"]:checked')?.value;
      if (type === '指定輔導人員') {
        const email = document.getElementById('rec-transfer-counselor').value;
        const name  = configData?.users?.[email]?.name || email;
        items.push(`內部轉案：${name}`);
      } else {
        items.push('內部轉案：分案會議');
      }
    } else if (val === '其他') {
      const tags = [...document.querySelectorAll('#sp-other-tags .dynamic-tag')].map(t => t.dataset.name);
      items.push(tags.length ? `其他：${tags.join('、')}` : '其他');
    } else {
      items.push(val);
    }
  });
  return items;
}

// ── 系列預約自動帶入下次會談，使用者更動後的三選一詢問 ────────────────
let _recNextBkChoiceResolver = null;
function _recNextBkChoiceResolve(choice) {
  document.getElementById('rec-next-bk-choice-modal').style.display = 'none';
  const resolve = _recNextBkChoiceResolver; _recNextBkChoiceResolver = null;
  if (resolve) resolve(choice);
}
function _recAskNextBkChoice() {
  document.getElementById('rec-next-bk-choice-modal').style.display = 'flex';
  return new Promise(resolve => { _recNextBkChoiceResolver = resolve; });
}

// 從系列預約自動帶入的下次會談值（_recNextBkPrefill）若被使用者更動，決定如何處理：
// 回傳 { proceed:false } → 使用者取消，saveRecord 應中止整個儲存；
// 回傳 { proceed:true, skipDefaultBk:false } → 沿用現行「（有需要就）另外新建一筆獨立預約」邏輯
//   （本來就無 prefill，或使用者選擇「額外新增」）；
// 回傳 { proceed:true, skipDefaultBk:true, nextBkId } → 已就地處理完畢（沿用不變/單筆修正/此筆之後修正），
//   saveRecord 後續不應再另外建立或更新預約，直接把 nextBkId（可能是空字串＝該部分處理失敗）寫入紀錄。
async function _recResolveNextBkPrefill(wantNextBooking, nextBkRoom, nextBkDate, nextBkStart, nextBkEnd) {
  if (!_recNextBkPrefill || !wantNextBooking) return { proceed: true, skipDefaultBk: false };
  const pf = _recNextBkPrefill;
  const unchanged = nextBkRoom === pf.room && nextBkDate === pf.date &&
    nextBkStart === pf.start && nextBkEnd === pf.end;
  if (unchanged) return { proceed: true, skipDefaultBk: true, nextBkId: pf.bkId };

  const choice = await _recAskNextBkChoice();
  if (choice === 'cancel') return { proceed: false };
  if (choice === 'extra') return { proceed: true, skipDefaultBk: false };

  const srcBk = bookingsData.find(b => b.id === pf.bkId);
  if (!srcBk) return { proceed: true, skipDefaultBk: false }; // 系列那筆已不存在（例如剛好被刪），退回額外新增

  const myName = configData?.users?.[currentUser.email]?.name || currentUser.email || '';
  const nbNow = new Date().toISOString();

  if (choice === 'single') {
    const snap = { ...srcBk };
    srcBk.room = nextBkRoom; srcBk.customRoom = ''; srcBk.date = nextBkDate;
    srcBk.startTime = nextBkStart; srcBk.endTime = nextBkEnd; srcBk.updatedAt = nbNow;
    if (!srcBk.counselorEmail) { srcBk.counselorEmail = currentUser.email; srcBk.counselorName = myName; }
    const gcMode = srcBk.calendarEventId ? 'update' : 'create';
    const label = `修正下次預約（單筆）：${myName} ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
    const committed = await _bkCommitOne(srcBk, gcMode, _bkGcParamsOf(srcBk, !!srcBk.calendarEventId), label);
    if (!committed) {
      Object.assign(srcBk, snap);
      setAlert('new-record-alert', 'warn', '下次預約單筆修正未套用（與其他預約衝突或儲存失敗）；紀錄本身仍會照常儲存，請之後自行調整下次預約。');
      return { proceed: true, skipDefaultBk: true, nextBkId: '' };
    }
    return { proceed: true, skipDefaultBk: true, nextBkId: srcBk.id };
  }

  if (choice === 'afterthis') {
    const dateDelta = _bkDaysBetween(srcBk.date, nextBkDate);
    const targets = _bkSeriesTargets(bookingsData, srcBk, 'future');
    const snapshot = targets.map(t => ({ ...t }));
    targets.forEach(t => {
      t.room = nextBkRoom; t.customRoom = '';
      t.startTime = nextBkStart; t.endTime = nextBkEnd;
      if (dateDelta) t.date = _bkAddDays(t.date, dateDelta);
      t.updatedAt = nbNow;
      if (!t.counselorEmail) { t.counselorEmail = currentUser.email; t.counselorName = myName; }
    });
    const jobId = bgJobAdd('修正下次預約（此筆之後）', `共 ${targets.length} 筆`);
    try {
      const ops = targets.map(t => ({
        op: 'upsert', booking: { ...t },
        gc: { mode: t.calendarEventId ? 'update' : 'create', params: _bkGcParamsOf(t, true) },
      }));
      const result = await bkCommit(ops, { checkConflicts: true });
      if (result.error === 'conflict') {
        snapshot.forEach(s => {
          const t = bookingsData.find(x => x.id === s.id);
          if (t) Object.assign(t, s);
        });
        const kind = result.conflictType === 'person' ? '人員' : '空間';
        bgJobFail(jobId, `修正下次預約${kind}衝突`);
        setAlert('new-record-alert', 'warn', `下次預約修正未套用：系列中有一筆與其他預約發生${kind}衝突，已還原；紀錄本身仍會照常儲存，請之後自行調整下次預約。`);
        return { proceed: true, skipDefaultBk: true, nextBkId: '' };
      }
      if (result.fallback) {
        await saveBookings();
        targets.forEach(t => { if (t.calendarEventId) { _bkGcQueue.set(t.id, { ...t }); _bkGcFlush(); } });
      } else {
        (result.bookings || []).forEach(fb => {
          const idx = bookingsData.findIndex(x => x.id === fb.id);
          if (idx >= 0) bookingsData[idx] = fb;
        });
      }
      bgJobDone(jobId);
      return { proceed: true, skipDefaultBk: true, nextBkId: srcBk.id };
    } catch (e) {
      snapshot.forEach(s => {
        const t = bookingsData.find(x => x.id === s.id);
        if (t) Object.assign(t, s);
      });
      bgJobFail(jobId, e.message);
      setAlert('new-record-alert', 'warn', '下次預約修正失敗：' + e.message + '；紀錄本身仍會照常儲存。');
      return { proceed: true, skipDefaultBk: true, nextBkId: '' };
    }
  }
  return { proceed: true, skipDefaultBk: false };
}

// ── 中段跳過：原 index.html 第 12471–12528 行「同時段重複紀錄檢核」共用基礎設施（_dupFindSameSlot／_dupRenderAlert／_dupResolveAtSave 等）原樣留在 index.html，因該段為晤談紀錄／初次晤談紀錄表／精神科醫師評估／事件處理紀錄四種表單共用，非本模組獨有 ──

// 晤談紀錄：即時檢查同個案＋同晤談者＋同時段是否已有既存的（一般）晤談紀錄
function _checkRecDuplicate() {
  if (!_recordCaseId) return;
  const date = document.getElementById('rec-date')?.value || '';
  const rawTime = document.getElementById('rec-time')?.value || '';
  const time = rawTime === '其他' ? (document.getElementById('rec-time-other')?.value || '').trim() : rawTime;
  const c = casesData.find(x => x.id === _recordCaseId);
  const records = ((c?.records) || [])
    .filter(r => !r.deleted && !r.isEventRecord)
    .map(r => ({ id: r.id, date: r.date, time: r.time, counselorEmails: (r.counselors || []).map(x => x.email).filter(Boolean), createdAt: r.createdAt }));
  const counselorEmails = _recCounselors.map(cc => cc.email).filter(Boolean);
  const match = _dupFindSameSlot(records, { date, time, counselorEmails, excludeId: _editingRecordId || null });
  _dupRenderAlert('rec-dup-alert', 'rec', match);
}

async function saveRecord() {
  const date    = document.getElementById('rec-date').value;
  const rawTime = document.getElementById('rec-time').value;
  const summary = getRichTextValue('rec-summary').trim();

  const _recAlert = (msg) => {
    setAlert('new-record-alert', 'error', msg);
    document.getElementById('new-record-alert').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const _markSec = (sel) => {
    const el = sel[0]==='#' ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
    el?.closest('.form-section,.card')?.classList.add('form-section-error');
  };
  document.querySelectorAll('.form-section-error').forEach(el => el.classList.remove('form-section-error'));

  if (!date)    { _markSec('#rec-date'); _recAlert('請填寫晤談日期。'); return; }
  if (!rawTime) { _markSec('#rec-time'); _recAlert('請選擇晤談時間。'); return; }
  let time = rawTime;
  if (rawTime === '其他') {
    const custom = document.getElementById('rec-time-other').value.trim();
    if (!custom) { _markSec('#rec-time-other'); _recAlert('請填寫自訂晤談時間（格式：xx:xx-xx:xx）。'); return; }
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(custom)) { _markSec('#rec-time-other'); _recAlert('時間格式不正確，請填寫 xx:xx-xx:xx（例：13:30-14:20）。'); return; }
    time = custom;
  }
  if (!summary) { _markSec('#rec-summary'); _recAlert('請填寫晤談摘要。'); return; }

  const topicOtherText = document.getElementById('rec-topic-other').value.trim();
  const topics = [...document.querySelectorAll('input[name="rec-topic"]:checked')].map(cb =>
    cb.value === '其他' && topicOtherText ? `其他：${topicOtherText}` : cb.value
  );
  if (!topics.length) { _markSec('input[name="rec-topic"]'); _recAlert('請至少選擇一個會談主題。'); return; }
  if (document.querySelector('input[name="rec-topic"][value="其他"]')?.checked && !topicOtherText) {
    _validateTopicOther('rec');
    _markSec('#rec-topic-other'); _recAlert('請填寫會談主題「其他」的說明。'); return;
  }

  // ── 此次服務項目驗證（一次顯示所有錯誤） ──
  _clearAllSvcHints();
  const _mainChecked = [...document.querySelectorAll('input[name="rec-service-main"]:checked')].map(cb => cb.value);
  if (!_mainChecked.length) { _markSec('input[name="rec-service-main"]'); _recAlert('請至少勾選一項此次服務項目。'); return; }
  const _svcErrors = [];
  if (_mainChecked.includes('心理測驗') &&
      ![...document.querySelectorAll('input[name="rec-psychtest"]:checked')].length) {
    _showSvcHint('hint-psychtest'); _svcErrors.push('心理測驗');
  }
  if (_mainChecked.includes('性平行為人') &&
      ![...document.querySelectorAll('input[name="rec-genderequal"]:checked')].length) {
    _showSvcHint('hint-genderequal'); _svcErrors.push('性平行為人');
  }
  if (_mainChecked.includes('轉介相關資源') &&
      ![...document.querySelectorAll('input[name="rec-referral"]:checked')].length) {
    _showSvcHint('hint-referral'); _svcErrors.push('轉介相關資源');
  }
  if (_mainChecked.includes('責任通報') &&
      ![...document.querySelectorAll('input[name="rec-report"]:checked')].length) {
    _showSvcHint('hint-report'); _svcErrors.push('責任通報');
  }
  if (document.querySelector('input[name="rec-report"][value="社政通報"]')?.checked &&
      ![...document.querySelectorAll('input[name="rec-social-report"]:checked')].length) {
    _showSvcHint('hint-social-report'); _svcErrors.push('社政通報細項');
  }
  if (document.querySelector('input[name="rec-social-report"][value="其他"]')?.checked &&
      !document.getElementById('sp-social-report-other').value.trim()) {
    _showSvcHint('hint-social-report-other'); _svcErrors.push('社政通報其他說明');
  }
  if (document.querySelector('input[name="rec-report"][value="其他通報"]')?.checked &&
      !document.getElementById('sp-report-other').value.trim()) {
    _showSvcHint('hint-report-other'); _svcErrors.push('責任通報其他說明');
  }
  if (_mainChecked.includes('陪同服務') &&
      ![...document.querySelectorAll('#sp-accompany-tags .dynamic-tag')].length) {
    _showSvcHint('hint-accompany'); _svcErrors.push('陪同服務');
  }
  if (_mainChecked.includes('其他') &&
      ![...document.querySelectorAll('#sp-other-tags .dynamic-tag')].length) {
    _showSvcHint('hint-rec-other'); _svcErrors.push('其他');
  }
  if (_mainChecked.includes('內部轉案') &&
      document.querySelector('input[name="rec-transfer-type"]:checked')?.value === '指定輔導人員' &&
      !document.getElementById('rec-transfer-counselor').value) {
    _showSvcHint('hint-transfer'); _svcErrors.push('內部轉案（未選輔導人員）');
  }
  if (_svcErrors.length) {
    _markSec('input[name="rec-service-main"]');
    _recAlert('服務項目「' + _svcErrors.join('、') + '」已勾選，請補充必要內容後再儲存。'); return;
  }

  const interventionMode = document.getElementById('rec-intervention-mode').value;
  if (!interventionMode) { _markSec('#rec-intervention-mode'); _recAlert('請選擇介入方式。'); return; }
  const interviewees = [...document.querySelectorAll('input[name="rec-interviewee"]:checked')].map(cb => cb.value);
  if (!interviewees.length) { _markSec('input[name="rec-interviewee"]'); _recAlert('請至少選擇一項晤談對象。'); return; }
  const intervieweeNote = (document.getElementById('rec-interviewee-note')?.value || '').trim();
  const serviceItems  = _collectServiceItems();
  const assessment    = getRichTextValue('rec-assessment');
  const nextPlan      = getRichTextValue('rec-next-plan');
  const notes         = getRichTextValue('rec-notes');
  const _rtText = id => (document.getElementById(id)?.innerText || '').trim();
  if (!_rtText('rec-assessment')) { _markSec('#rec-assessment'); _recAlert('請填寫問題評估。'); return; }
  if (!_rtText('rec-next-plan'))  { _markSec('#rec-next-plan'); _recAlert('請填寫後續處遇計畫。'); return; }
  if (!_recCounselors.length) { _markSec('#rec-counselors-wrap'); _recAlert('請至少新增一位晤談者。'); return; }

  const cidx = casesData.findIndex(c => c.id === _recordCaseId);
  if (cidx === -1) return;

  // ── 同時段重複紀錄檢核（#9）：儲存前最後把關 ──
  // 選「覆蓋」時把 _editingRecordId 改指向既存那筆，讓後面既有的「編輯現有紀錄」分支
  // 直接把本次表單內容覆寫進去，等同覆蓋取代（若原本就在編輯另一筆，原筆維持原樣不動，
  // 屬於刻意縮小範圍的簡化：避免同時處理「刪除原筆」牽動的下游分支）。
  let _recDidMerge = false;
  {
    const _recDupList = (casesData[cidx].records || [])
      .filter(r => !r.deleted && !r.isEventRecord)
      .map(r => ({ id: r.id, date: r.date, time: r.time, counselorEmails: (r.counselors || []).map(x => x.email).filter(Boolean), createdAt: r.createdAt }));
    const _recDupMatch = _dupFindSameSlot(_recDupList, {
      date, time, counselorEmails: _recCounselors.map(cc => cc.email).filter(Boolean), excludeId: _editingRecordId || null,
    });
    if (_recDupMatch && _dupResolveAtSave('rec', _recDupMatch) === 'merge') {
      _editingRecordId = _recDupMatch.id;
      _recDidMerge = true;
    }
  }

  // 預約下次：衝突檢查
  const nbToggle = document.getElementById('rec-next-bk-toggle');
  const wantNextBooking = nbToggle?.checked;
  let nextBkRoom = '', nextBkDate = '', nextBkStart = '', nextBkEnd = '';
  if (wantNextBooking) {
    nextBkRoom  = _recNextBkRoom;
    nextBkDate  = document.getElementById('rec-next-bk-date')?.value  || '';
    // toggleRecNextBkPeriod 選節次時已將 start/end 寫入隱藏欄位
    nextBkStart = document.getElementById('rec-next-bk-start')?.value || '';
    nextBkEnd   = document.getElementById('rec-next-bk-end')?.value   || '';
    if (!nextBkRoom || !nextBkDate || !nextBkStart || !nextBkEnd) {
      const _nbMissing = [
        !nextBkRoom  && '空間（請點選一個空間名稱）',
        !nextBkDate  && '日期',
        !nextBkStart && '開始時間',
        !nextBkEnd   && '結束時間',
      ].filter(Boolean).join('、');
      if (!nextBkRoom) _markSec('#rec-next-bk-room-wrap');
      _recAlert(`已勾選「預約下次諮商空間」，尚缺：${_nbMissing}。`); return;
    }
    const _nbTRx = /^\d{2}:\d{2}$/;
    if (!_nbTRx.test(nextBkStart) || !_nbTRx.test(nextBkEnd)) {
      _recAlert('預約下次：時間格式錯誤，請輸入 HH:MM（如 09:10）。'); return;
    }
    if (nextBkStart >= nextBkEnd) {
      _recAlert('預約下次：結束時間必須晚於開始時間。'); return;
    }
    const _editOldBkId = _editingRecordId
      ? (casesData[cidx]?.records?.find(r => r.id === _editingRecordId)?.nextBkId || '')
      : '';
    // 從系列預約自動帶入時，該筆本尊也要排除在衝突比對之外（使用者可能只是微調同一筆，而非新增另一筆）
    const _pfIgnoreId = _recNextBkPrefill?.bkId || '';
    const _nbConflict = _bkFindConflict(bookingsData,
      { id: _editOldBkId || null, date: nextBkDate, room: nextBkRoom, customRoom: '',
        startTime: nextBkStart, endTime: nextBkEnd, counselors: [{ value: currentUser.email }] },
      { ignoreIds: [_editOldBkId, _pfIgnoreId].filter(Boolean) });
    if (_nbConflict) {
      const w = _nbConflict.with;
      const wRoom = w.room === '其他' ? (w.customRoom || '其他') : w.room;
      const cEl = document.getElementById('rec-next-bk-conflict');
      if (_nbConflict.type === 'room') {
        if (cEl) { cEl.className = 'alert alert-warn'; cEl.style.display = ''; cEl.textContent = `衝突：${wRoom} 在 ${(w.startTime||'').slice(0,5)}–${(w.endTime||'').slice(0,5)} 已有預約（${w.counselorName || '—'}）。`; }
        _recAlert('預約下次的時間與既有預約衝突，請修改。'); return;
      } else {
        if (cEl) { cEl.className = 'alert alert-warn'; cEl.style.display = ''; cEl.textContent = `您在 ${(w.startTime||'').slice(0,5)}–${(w.endTime||'').slice(0,5)} 已有另一預約（${wRoom || '—'}${w.caseName ? '，' + w.caseName : ''}）。`; }
        _recAlert('您在此時段已有其他預約，請修改下次預約時間。'); return;
      }
    }
  }

  // 從系列預約自動帶入下次會談時，若使用者已更動時段/空間：詢問額外新增／單筆修正／此筆之後修正（取消則中止儲存）
  const _pfRes = await _recResolveNextBkPrefill(wantNextBooking, nextBkRoom, nextBkDate, nextBkStart, nextBkEnd);
  if (!_pfRes.proceed) return;

  const counselorList = [..._recCounselors];
  const counselorName = counselorList.map(c => c.label).join('、');
  if (!casesData[cidx].records) casesData[cidx].records = [];
  const _caseLabel = casesData[cidx]?.name || _recordCaseId;

  let _recAttachments;
  try { _recAttachments = await attachFlush('rec'); }
  catch(e) { _recAlert('附件上傳失敗：' + e.message); return; }

  let _recSummaryImages;
  try { _recSummaryImages = await attachFlush('recimg'); }
  catch(e) { _recAlert('附圖上傳失敗：' + e.message); return; }

  if (_editingRecordId) {
    // ── 編輯現有紀錄 ──
    const ridx = casesData[cidx].records.findIndex(r => r.id === _editingRecordId);
    if (ridx === -1) return;
    const _rec = casesData[cidx].records[ridx];
    if (!isAdmin() && !isRecordCreator(_rec)) {
      _recAlert('您無權編輯此晤談紀錄（僅建立者可編輯）。');
      return;
    }
    const prev = { ...casesData[cidx].records[ridx] };
    const editedId = _editingRecordId;
    // 決定 nextBkId：有填預約則沿用舊 ID 或新建；未勾選則清空
    // （從系列預約帶入且已被 _recResolveNextBkPrefill 就地處理完畢時，直接沿用其結果，不再另外新建/更新）
    let _editNextBkId = '';
    let _editBkAction = 'none'; // 'create' | 'update' | 'none'
    if (_pfRes.skipDefaultBk) {
      _editNextBkId = _pfRes.nextBkId || '';
    } else if (wantNextBooking && nextBkRoom && nextBkDate && nextBkStart && nextBkEnd) {
      const oldBkId = prev.nextBkId || '';
      const oldBkStillExists = oldBkId && bookingsData.find(b => b.id === oldBkId);
      if (oldBkStillExists) {
        _editNextBkId = oldBkId;
        _editBkAction = 'update';
      } else {
        _editNextBkId = `bk_${Date.now()}`;
        _editBkAction = 'create';
      }
    }
    // 捕捉舊預約快照，供 bgJob 與稽核日誌記錄「從哪改到哪」
    const _prevBkSnap = (_editBkAction === 'update')
      ? { ...(bookingsData.find(b => b.id === _editNextBkId) || {}) }
      : null;
    Object.assign(casesData[cidx].records[ridx], {
      date, time, topics, serviceItems, summary, assessment, nextPlan, notes,
      counselorName, counselors: counselorList, interventionMode, interviewees, intervieweeNote,
      nextBkId: _editNextBkId, attachments: _recAttachments,
      summaryImages: _recSummaryImages.length ? _recSummaryImages : undefined,
      updatedAt: new Date().toISOString(), updatedBy: currentUser.email,
    });
    delete casesData[cidx].records[ridx].status;
    delete casesData[cidx].records[ridx].draftSavedAt;
    // 伴侶記錄同步／編輯既有（非伴侶）紀錄時新增伴侶諮商（#19：編輯模式先前完全無法掛上伴侶諮商）
    const _editedRec = casesData[cidx].records[ridx];
    let _prevPartnerRec = null, _partnerCaseIdx = -1, _partnerRecIdx = -1;
    let _newPartnerRecOnEdit = null; // 編輯時才新掛上伴侶諮商，需新建夥伴方紀錄
    if (!_editedRec.coupleId && _coupleTargetCaseId) {
      _partnerCaseIdx = casesData.findIndex(c => c.id === _coupleTargetCaseId);
      if (_partnerCaseIdx >= 0) {
        const _editCoupleId = _coupleId();
        _editedRec.coupleId = _editCoupleId;
        _editedRec.coupleCaseId = _coupleTargetCaseId;
        _editedRec.couplePartnerName = casesData[_partnerCaseIdx].name || _coupleTargetCaseId;
        _newPartnerRecOnEdit = {
          ..._editedRec,
          id: 'REC-' + (Date.now() + 1),
          creatorEmail: currentUser.email,
          counselorEmail: currentUser.email,
          coupleCaseId: _recordCaseId,
          couplePartnerName: casesData[cidx]?.name || _recordCaseId,
          coupleId: _editCoupleId,
          nextBkId: '',
          createdAt: new Date().toISOString(),
        };
        delete _newPartnerRecOnEdit.updatedAt;
        delete _newPartnerRecOnEdit.updatedBy;
        if (!casesData[_partnerCaseIdx].records) casesData[_partnerCaseIdx].records = [];
        casesData[_partnerCaseIdx].records.push(_newPartnerRecOnEdit);
        casesData[_partnerCaseIdx].updatedAt = new Date().toISOString();
      }
    } else if (_editedRec.coupleId && _editedRec.coupleCaseId) {
      _partnerCaseIdx = casesData.findIndex(c => c.id === _editedRec.coupleCaseId);
      if (_partnerCaseIdx >= 0) {
        _partnerRecIdx = (casesData[_partnerCaseIdx].records || []).findIndex(r => r.coupleId === _editedRec.coupleId);
        if (_partnerRecIdx >= 0) {
          _prevPartnerRec = { ...casesData[_partnerCaseIdx].records[_partnerRecIdx] };
          _syncCoupleRecord(_editedRec);
        }
      }
    }
    // mark corresponding todo as done
    const _draftTodo = todosData.find(t => t.recordId === _editingRecordId && t.type === 'record' && !t.done);
    if (_draftTodo) { _draftTodo.done = true; _draftTodo.doneAt = new Date().toISOString(); saveUserTodos().catch(()=>{}); _syncTodoBadge(); }
    casesData[cidx].updatedAt = new Date().toISOString();
    clearRecordDraft();
    _switchDetailSemTo(casesData[cidx], openDateToSemPrefix(date));
    showCaseDetail(_recordCaseId);
    _flashRecordCard('rec-card-' + editedId);
    const jobId = bgJobAdd('更新晤談紀錄', _caseLabel);
    _armSaveFailSnapshot('晤談紀錄', 'page-new-record', () => openNewRecordPage(_recordCaseId, editedId, _recordKind), saveRecord, jobId);
    (async () => {
      try {
        bgJobProgress(jobId, 40);
        {
          const _saveIds = [_recordCaseId];
          if (_editedRec?.coupleId && _editedRec?.coupleCaseId) _saveIds.push(_editedRec.coupleCaseId);
          await saveCasesChunks(..._saveIds);
        }
        bgJobProgress(jobId, 75);
        if (_editBkAction !== 'none') {
          const myName = configData?.users?.[currentUser.email]?.name || currentUser.email || '';
          const _nbNow = new Date().toISOString();
          if (_editBkAction === 'create') {
            const newBk = { id: _editNextBkId, bkSerial: _bkNextSerial(), room: nextBkRoom,
              date: nextBkDate, startTime: nextBkStart, endTime: nextBkEnd,
              counselorEmail: currentUser.email, counselorName: myName,
              caseId: _recordCaseId, caseName: casesData[cidx]?.name || '',
              notes: '', createdAt: _nbNow, updatedAt: _nbNow };
            bookingsData.push(newBk);
            const calParamsNb = { room: nextBkRoom, date: nextBkDate, startTime: nextBkStart, endTime: nextBkEnd,
              counselorName: myName, notes: '', creatorName: configData?.users?.[currentUser.email]?.name || myName,
              createdAt: _nbNow, updatedAt: _nbNow, isEdit: false, bkSerial: newBk.bkSerial };
            const _calLabel2 = `新增行事曆事件：${myName} ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
            const _committed = await _bkCommitOne(newBk, 'create', calParamsNb, _calLabel2);
            if (!_committed) {
              const _i = bookingsData.findIndex(x => x.id === newBk.id);
              if (_i >= 0) bookingsData.splice(_i, 1);
            }
          } else {
            const bkIdx = bookingsData.findIndex(b => b.id === _editNextBkId);
            if (bkIdx >= 0) {
              const _updLabel = `更新行事曆預約：${myName} `
                + `${_prevBkSnap?.date||''} ${(_prevBkSnap?.startTime||'').slice(0,5)}–${(_prevBkSnap?.endTime||'').slice(0,5)} ${_prevBkSnap?.room||''}`
                + ` → ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
              Object.assign(bookingsData[bkIdx], { room: nextBkRoom, date: nextBkDate,
                startTime: nextBkStart, endTime: nextBkEnd, updatedAt: _nbNow });
              const calParamsNb2 = { room: nextBkRoom, date: nextBkDate, startTime: nextBkStart, endTime: nextBkEnd,
                counselorName: bookingsData[bkIdx].counselorName || myName, notes: bookingsData[bkIdx].notes || '',
                creatorName: bookingsData[bkIdx].creatorName || myName,
                createdAt: bookingsData[bkIdx].createdAt || _nbNow, updatedAt: _nbNow, isEdit: true,
                bkSerial: bookingsData[bkIdx].bkSerial };
              const gcMode = bookingsData[bkIdx].calendarEventId ? 'update' : 'create';
              await _bkCommitOne(bookingsData[bkIdx], gcMode, calParamsNb2, _updLabel);
            }
          }
        }
        bgJobProgress(jobId, 90);
        let _auditBkNote = '';
        if (_editBkAction === 'update' && _prevBkSnap) {
          _auditBkNote = `；預約 ${_prevBkSnap.date||''} ${(_prevBkSnap.startTime||'').slice(0,5)}–${(_prevBkSnap.endTime||'').slice(0,5)} ${_prevBkSnap.room||''}`
            + ` → ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
        } else if (_editBkAction === 'create') {
          _auditBkNote = `；新增預約 ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
        }
        const _coupleEditNote = _newPartnerRecOnEdit ? `；新增共用對象：${_editedRec.couplePartnerName || ''}` : '';
        auditLog('編輯晤談紀錄', _recordCaseId, editedId,
          (date ? `${date}（${semesterLabel(openDateToSemPrefix(date))}）` : '') + _auditBkNote + _coupleEditNote +
          (_recDidMerge ? '；覆蓋同時段紀錄' : ''));
        bgJobDone(jobId);
        _clearSaveFailSnapshot(jobId);
      } catch(err) {
        casesData[cidx].records[ridx] = prev;
        if (_prevPartnerRec && _partnerCaseIdx >= 0 && _partnerRecIdx >= 0) {
          casesData[_partnerCaseIdx].records[_partnerRecIdx] = _prevPartnerRec;
        }
        if (_newPartnerRecOnEdit && _partnerCaseIdx >= 0) {
          const _npIdx = casesData[_partnerCaseIdx].records.findIndex(r => r.id === _newPartnerRecOnEdit.id);
          if (_npIdx >= 0) casesData[_partnerCaseIdx].records.splice(_npIdx, 1);
        }
        bgJobFail(jobId, err.message);
        _showSaveFailModal(err.message, jobId);
      }
    })();
  } else {
    // ── 新增紀錄 ──
    // 從系列預約帶入且已被 _recResolveNextBkPrefill 就地處理完畢時，直接沿用其結果，不再另外新建預約
    const _newBkId = _pfRes.skipDefaultBk
      ? (_pfRes.nextBkId || '')
      : ((wantNextBooking && nextBkRoom && nextBkDate && nextBkStart && nextBkEnd) ? `bk_${Date.now()}` : '');
    const newRecord = {
      id: `REC-${Date.now()}`,
      date, time, creatorEmail: currentUser.email, counselorEmail: currentUser.email,
      counselorName, counselors: counselorList, interventionMode, interviewees, intervieweeNote,
      topics, serviceItems, summary, assessment, nextPlan, notes,
      recordKind: _recordKind,
      nextBkId: _newBkId, attachments: _recAttachments,
      summaryImages: _recSummaryImages.length ? _recSummaryImages : undefined,
      createdAt: new Date().toISOString(),
    };
    casesData[cidx].records.push(newRecord);
    casesData[cidx].updatedAt = new Date().toISOString();
    // 伴侶諮商：建立夥伴方記錄
    let _partnerNewCaseIdx = -1, _partnerNewRecord = null;
    const _savedCoupleCaseId = _coupleTargetCaseId;
    if (_savedCoupleCaseId) {
      _partnerNewCaseIdx = casesData.findIndex(c => c.id === _savedCoupleCaseId);
      if (_partnerNewCaseIdx >= 0) {
        const coupleId = _coupleId();
        newRecord.coupleId = coupleId;
        newRecord.coupleCaseId = _savedCoupleCaseId;
        newRecord.couplePartnerName = casesData[_partnerNewCaseIdx].name || _savedCoupleCaseId;
        _partnerNewRecord = {
          ...newRecord,
          id: 'REC-' + (Date.now() + 1),
          creatorEmail: currentUser.email,
          counselorEmail: currentUser.email,
          counselorName, counselors: counselorList,
          recordKind: _recordKind,
          coupleCaseId: _recordCaseId,
          couplePartnerName: casesData[cidx]?.name || _recordCaseId,
          coupleId,
          nextBkId: '',
          createdAt: new Date().toISOString(),
        };
        if (!casesData[_partnerNewCaseIdx].records) casesData[_partnerNewCaseIdx].records = [];
        casesData[_partnerNewCaseIdx].records.push(_partnerNewRecord);
        casesData[_partnerNewCaseIdx].updatedAt = new Date().toISOString();
      }
    }

    // 立刻把預約推入記憶體（讓同 session 的衝突檢查可立即偵測）
    let _newBkObj = null;
    if (_newBkId && !_pfRes.skipDefaultBk) {
      const myName = configData?.users?.[currentUser.email]?.name || currentUser.email || '';
      const _nbNow = new Date().toISOString();
      _newBkObj = { id: _newBkId, bkSerial: _bkNextSerial(), room: nextBkRoom,
        date: nextBkDate, startTime: nextBkStart, endTime: nextBkEnd,
        counselorEmail: currentUser.email, counselorName: myName,
        caseId: _recordCaseId, caseName: casesData[cidx]?.name || '',
        notes: '', createdAt: _nbNow, updatedAt: _nbNow };
      bookingsData.push(_newBkObj);
    }

    clearRecordDraft();
    _switchDetailSemTo(casesData[cidx], openDateToSemPrefix(date));
    showCaseDetail(_recordCaseId);
    _flashRecordCard('rec-card-' + newRecord.id);
    const jobId = bgJobAdd('新增晤談紀錄', _caseLabel);
    _armSaveFailSnapshot('晤談紀錄', 'page-new-record', () => openNewRecordPage(_recordCaseId, null, _recordKind), saveRecord, jobId);
    (async () => {
      try {
        bgJobProgress(jobId, 40);
        {
          const _saveIds = [_recordCaseId, ...(_savedCoupleCaseId ? [_savedCoupleCaseId] : [])];
          await saveCasesChunks(..._saveIds);
        }
        bgJobProgress(jobId, 75);
        if (_newBkObj) {
          const calParamsNb = { room: nextBkRoom, date: nextBkDate, startTime: nextBkStart, endTime: nextBkEnd,
            counselorName: _newBkObj.counselorName, notes: '',
            creatorName: configData?.users?.[currentUser.email]?.name || _newBkObj.counselorName,
            createdAt: _newBkObj.createdAt, updatedAt: _newBkObj.updatedAt, isEdit: false, bkSerial: _newBkObj.bkSerial };
          const _calLabel = `新增行事曆事件：${_newBkObj.counselorName} ${nextBkDate} ${nextBkStart}–${nextBkEnd} ${nextBkRoom}`;
          const _committed = await _bkCommitOne(_newBkObj, 'create', calParamsNb, _calLabel);
          if (!_committed) {
            const _bi = bookingsData.findIndex(x => x.id === _newBkObj.id);
            if (_bi >= 0) bookingsData.splice(_bi, 1);
          }
        }
        bgJobProgress(jobId, 90);
        const _coupleNote = _savedCoupleCaseId ? `；共用對象：${newRecord.couplePartnerName || _savedCoupleCaseId}` : '';
        auditLog('新增晤談紀錄', _recordCaseId, newRecord.id,
          (newRecord.date ? `${newRecord.date}（${semesterLabel(openDateToSemPrefix(newRecord.date))}）` : '') + _coupleNote);
        bgJobDone(jobId);
        _clearSaveFailSnapshot(jobId);
      } catch(err) {
        const failIdx = casesData[cidx]?.records.findIndex(r => r.id === newRecord.id);
        if (failIdx >= 0) casesData[cidx].records.splice(failIdx, 1);
        // 回滾伴侶記錄
        if (_partnerNewRecord && _partnerNewCaseIdx >= 0) {
          const pIdx = casesData[_partnerNewCaseIdx]?.records.findIndex(r => r.id === _partnerNewRecord.id);
          if (pIdx >= 0) casesData[_partnerNewCaseIdx].records.splice(pIdx, 1);
        }
        // 若預約已推入記憶體，回滾
        if (_newBkObj) {
          const _bkIdx = bookingsData.findIndex(b => b.id === _newBkId);
          if (_bkIdx >= 0) bookingsData.splice(_bkIdx, 1);
        }
        bgJobFail(jobId, err.message);
        _showSaveFailModal(err.message, jobId);
      }
    })();
  }
}
