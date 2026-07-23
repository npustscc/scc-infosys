// dev/ui-helpers.js — 全站 UI 工具模組（載入進度/Loading/Toast＋歷史、富文字編輯器
// 全套（DOMPurify 淨化/工具列/顏色字級縮排/清單）、批次勾選 _ckg 機制、浮動返回鍵等）
// （拆 index.html 絞殺者第三十一刀，v278）。內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：①DOMPurify.addHook（有 _rtStyleHookInstalled 旗標防重複；
// DOMPurify 為 head 內嵌 vendored，先於本檔）②_rtHydrateToolbars(document)＋MutationObserver
// observe(document.body)——本檔 <script> 位於 body 尾端，全部靜態 .rt-toolbar 與 body 已解析，
// 行為與拆前一致 ③九個 document 監聽（八個 bubble 互不依賴；_ckg 為全檔唯一 capture click，
// 無 stopImmediatePropagation 順序問題）。前移後仍在既有拆出檔之後、主 inline script 之前，
// 監聽相對註冊順序與拆前完全相同（主 script 於本區之前的部分無任何監聽/DOM 操作）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  UI helpers
// ══════════════════════════════════════════════
function setLoadingProgress(pct) {
  const p = Math.min(100, Math.max(0, Math.round(pct)));
  const fill = document.getElementById('loading-bar-fill');
  const txt  = document.getElementById('loading-bar-pct');
  if (fill) fill.style.width = p + '%';
  if (txt)  txt.textContent  = p + '%';
}
let _casesLoadingMsg = '';
function _setCasesLoadingProgress(pct, msg) {
  if (msg !== undefined) _casesLoadingMsg = msg;
  const bar  = document.getElementById('cases-loading-bar');
  if (!bar) return;
  if (pct < 0) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const msgEl  = document.getElementById('cases-loading-msg-text');
  const fillEl = document.getElementById('cases-loading-fill');
  const pctEl  = document.getElementById('cases-loading-pct-text');
  if (msgEl)  msgEl.textContent    = _casesLoadingMsg || '載入個案資料…';
  if (fillEl) fillEl.style.width   = Math.max(pct, 0) + '%';
  if (pctEl)  pctEl.textContent    = Math.max(pct, 0) + '%';
}

function showLoading(msg = '載入中…', pct = 0) {
  document.getElementById('loading-msg').textContent = msg;
  document.getElementById('loading-overlay').style.display = 'flex';
  setLoadingProgress(pct);
}
function hideLoading() {
  setLoadingProgress(100);
  setTimeout(() => {
    document.getElementById('loading-overlay').style.display = 'none';
    setLoadingProgress(0);
  }, 150);
}

// v239：提示訊息歷史——純記憶體（不落地，重新整理即清空），供 📜 面板顯示最近 20 則
const _toastHistory = [];
function _pushToastHistory(type, msg) {
  _toastHistory.unshift({ time: new Date(), type, msg });
  if (_toastHistory.length > 20) _toastHistory.pop();
  if (document.getElementById('toast-history-panel')?.style.display === 'block') _renderToastHistory();
}

function showToast(msg, type = 'success', duration = 3500) {
  try {
    _pushToastHistory(type, msg);
    // v239：warn/error 保底拉長顯示時間（呼叫端明確給更長值時尊重之），錯誤/警告訊息不能一閃即逝
    const eff = type === 'error' ? Math.max(duration, 8000) : type === 'warn' ? Math.max(duration, 6000) : duration;
    if (type === 'warn' || type === 'error') {
      _showTopBanner(msg, type, eff);
      if (type === 'error') _flashErrorBorder();
      return;
    }
    // info / success（含未知 type fallback）── 右下角，加大字級＋倒數條
    let box = document.getElementById('_toast_box');
    if (!box) {
      box = document.createElement('div');
      box.id = '_toast_box';
      box.style.cssText = 'position:fixed;bottom:28px;right:24px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    const bg = type === 'info' ? '#63b3ed' : '#68d391';
    t.style.cssText = `background:${bg};color:#1a202c;padding:12px 20px 14px;border-radius:8px;font-size:.95rem;font-weight:500;box-shadow:0 2px 10px rgba(0,0,0,.18);opacity:0;transition:opacity .25s;max-width:400px;line-height:1.4;pointer-events:auto;position:relative;overflow:hidden;`;
    const msgEl = document.createElement('div');
    msgEl.textContent = msg;
    t.appendChild(msgEl);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:0;bottom:0;height:3px;width:100%;background:rgba(0,0,0,.25);';
    t.appendChild(bar);
    box.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      bar.style.transition = `width ${eff}ms linear`;
      requestAnimationFrame(() => { bar.style.width = '0'; });
    });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, eff);
  } catch (_) { /* 提示函式絕不可炸掉呼叫端流程 */ }
}

// v239：warn/error 頂部置中橫幅（與 _showRetryNotice 各自獨立容器，可並存）
function _showTopBanner(msg, type, duration) {
  let box = document.getElementById('_toast_top_box');
  if (!box) {
    box = document.createElement('div');
    box.id = '_toast_top_box';
    box.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:center;';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  const isError = type === 'error';
  const bg = isError ? '#fc8181' : '#f6ad55';
  const fg = isError ? '#742a2a' : '#7b341e';
  const border = isError ? 'border:2px solid #c53030;' : '';
  t.style.cssText = `background:${bg};color:${fg};min-width:280px;max-width:min(680px,92vw);padding:12px 40px 14px 18px;border-radius:8px;font-size:.95rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);position:relative;opacity:0;transition:opacity .25s;line-height:1.4;${border}`;
  const msgEl = document.createElement('div');
  msgEl.textContent = msg;
  t.appendChild(msgEl);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = '關閉';
  closeBtn.style.cssText = `position:absolute;top:6px;right:8px;border:none;background:none;color:${fg};font-size:1rem;cursor:pointer;line-height:1;padding:2px 4px;`;
  const remove = () => { clearTimeout(timer); t.style.opacity = '0'; setTimeout(() => t.remove(), 300); };
  closeBtn.onclick = remove;
  t.appendChild(closeBtn);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;bottom:0;height:3px;width:100%;background:rgba(0,0,0,.2);border-radius:0 0 8px 8px;';
  t.appendChild(bar);
  box.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    bar.style.transition = `width ${duration}ms linear`;
    requestAnimationFrame(() => { bar.style.width = '0'; });
  });
  const timer = setTimeout(remove, duration);
}

// v239：error 時全視窗紅框閃爍 3 次提醒（約 1.2 秒），lazy 建立
function _flashErrorBorder() {
  let el = document.getElementById('_toast_flash');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast_flash';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;box-shadow:inset 0 0 0 4px rgba(229,62,62,.85);opacity:0;';
    document.body.appendChild(el);
  }
  el.style.animation = 'none';
  void el.offsetWidth; // 強制 reflow 讓重複觸發能重新播放
  el.style.animation = '_toastFlash .4s ease 3';
  el.onanimationend = () => { el.style.animation = ''; el.style.opacity = '0'; };
}

// ── 重試提示橫幅（登入頁與載入過程皆可見，z-index 高於 dev banner 與 loading overlay）──
let _retryNoticeTimer = null;
function _showRetryNotice(text) {
  let el = document.getElementById('retry-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'retry-notice';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100001;background:#fefcbf;color:#744210;border:1px solid #ecc94b;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:600;box-shadow:0 2px 12px rgba(0,0,0,.22);max-width:90vw;text-align:center;display:none;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = '';
  clearTimeout(_retryNoticeTimer);
  _retryNoticeTimer = setTimeout(_hideRetryNotice, 8000);
}
function _hideRetryNotice() {
  clearTimeout(_retryNoticeTimer);
  const el = document.getElementById('retry-notice');
  if (el) el.style.display = 'none';
}

let _prevNavState = null;
function _navPageLabel(pid) {
  const m={'page-cases':'個案列表','page-case-detail':'個案詳細','page-pending':'不開案個案','page-bookings':'空間預約','page-psychiatry':'精神科評估','page-casenums':'案號管理','page-stats':'統計分析','page-event-records':'事件處理記錄','page-psych-test-db':'心理測驗庫','page-transfer':'轉銜管理','page-admin':'系統管理','page-recycle':'資源回收桶','page-unassigned-records':'未歸屬記錄','page-issues':'錯誤回報/許願池','page-pdf-tool':'PDF工具','page-img-editor':'圖片編輯','page-audit':'稽核紀錄','page-prefs':'偏好設定','page-todos':'待辦事項','page-new-record':'晤談紀錄','page-new-case':'新增個案','page-closure-eval':'結案評估','page-transfer-eval':'轉銜評估','page-initial-interview':'初談紀錄','page-mental-leave':'身心調適假管理','page-ml-assess':'身心狀態評估表','page-user-edit':'編輯使用者','page-freshman-test':'新生心理測驗'};
  return m[pid]||pid;
}
function _buildNavState(pid) {
  if(!pid)return null;
  let label=_navPageLabel(pid),restore;
  if(pid==='page-case-detail'&&typeof _detailCaseId!=='undefined'&&_detailCaseId){
    const c=(casesData||[]).find(x=>x.id===_detailCaseId);
    if(c)label=`個案詳細：${c.name}`;
    const cid=_detailCaseId;restore=()=>showCaseDetail(cid);
  }else{
    const ne=document.querySelector(`[data-nav-id="${pid}"]`);
    const renderMap={'page-cases':()=>{try{renderCases();}catch(_){}},'page-transfer':()=>{try{renderTransferPage();}catch(_){}},'page-todos':()=>{try{renderTodosPage();}catch(_){}},'page-pending':()=>{try{renderPendingList();}catch(_){}},'page-psychiatry':()=>{try{renderPsychiatryPage();}catch(_){}},'page-mental-leave':()=>{try{renderMentalLeavePage();}catch(_){}},'page-freshman-test':()=>{try{renderFreshmanTestPage();}catch(_){}}};
    restore=()=>{showPage(pid,ne);if(renderMap[pid])renderMap[pid]();};
  }
  return{label,restore};
}
function _updatePrevBtn(){
  const btn=document.getElementById('header-prev-btn'),lbl=document.getElementById('header-prev-label');
  if(!btn)return;
  if(_prevNavState){btn.style.display='';if(lbl)lbl.textContent=_prevNavState.label;}
  else btn.style.display='none';
}
function handlePrevPage(){
  const s=_prevNavState;_prevNavState=null;_updatePrevBtn();
  if(s?.restore)s.restore();
}
// 打卡模式（?page=clock）啟動時跳過的重載入，於使用者切離打卡頁時補齊
function _upgradeFromClockMode() {
  if (!_clockOnlyMode) return;
  _clockOnlyMode = false;
  _syslog('info', '離開 clock 模式，補齊完整 INFOSYS 載入');
  loadMentalLeaves().then(() => { _mlAutoFetchOnLogin(); _mlReconcileAssessmentTodos(); }).catch(() => {});
  loadCases().then(() => {
    loadPsychTestDB().catch(() => {});
    scanUnassignedRecords().catch(() => {});
    _restoreCloudDraftsThenMigrate().catch(() => {}); // v248：雲端拉回＋既有本機還原，fire-and-forget 不擋登入流程
    _syncPendingRecordsToTodos();
    _checkMlCumulativeTodos();
    _checkMlNewLeaveTodos().catch(() => {});
    _checkPastSemUnclosedForDirectors();
    _cleanupDeletedEvals();
    _checkTransferGradTodos();
    _checkWithdrawMismatchTodos();
  }).catch(() => {});
  loadPendingUsers().catch(() => {});
}

// v265：表單頁離開守門——晤談記錄/初談表/事件處理記錄在有未儲存輸入時，攔下側選單切頁改走各自的離開對話框
// （原本只有 banner 返回鈕接了各表單自己的離開防護，側選單完全沒守門，繞過草稿備援與離開詢問）。
// dirty 判定＝該表單 autosave timer 還在跑＋快照有實際內容；各離開/儲存流程都會先 stop autosave
// （timer 歸 null，見 stopRecordDraftAutosave／stopIIDraftAutosave／_stopEvrAutosave 各自呼叫點的
// stop-before-navigate 追查），所以完成儲存/捨棄後的程式化導頁天然放行，不需額外的 bypass 旗標。
const EXIT_GUARDS = {
  'page-new-record':        { dirty: () => _draftTimer   !== null && _recordDraftHasContent(snapshotRecordDraft()), exit: () => exitRecordForm() },
  'page-initial-interview': { dirty: () => _iiDraftTimer  !== null && _iiDraftHasContent(snapshotInitialInterview()), exit: () => exitIIForm() },
  'page-event-records':     { dirty: () => _evrDraftTimer !== null && _evrHasUnsavedInput(), exit: () => exitEventRecordForm() },
};

function showPage(pageId, navEl) {
  // v265：離開表單頁守門優先於下方 v207 新生測驗守門（兩者針對的頁面互斥，順序無影響）。
  const _curPageId = document.querySelector('.page.active')?.id;
  const _exitGuard = _curPageId && _curPageId !== pageId ? EXIT_GUARDS[_curPageId] : null;
  if (_exitGuard && _exitGuard.dirty()) { _exitGuard.exit(); return; }
  // v207：新生心理測驗頁的試算表編輯中有未儲存變更時，離開頁面（含側邊欄導航）先確認——此頁自管
  // dirty（window._ftDirty），不掛全域 _gd 草稿引擎（見 _ftEnterEdit／_ftSaveEdit 檔頭說明）。
  // beforeunload（整頁關閉/重整）另外在下方事件監聽處理，本處只管站內導頁。
  // v223：原生 confirm() 改為系統內建 modal（比照 _ftSwitchTab／_ftSwitchSemester，見
  // _ftConfirmLeaveModal），多一個「儲存變更後切換」選項——因此本函式其餘導頁邏輯抽成
  // _showPageContinue，三個分支（留在此頁／放棄變更並切換／儲存變更後切換）各自決定是否呼叫它。
  if (window._ftDirty && document.getElementById('page-freshman-test')?.classList.contains('active') && pageId !== 'page-freshman-test') {
    _ftConfirmLeaveModal(
      null,
      () => { window._ftDirty = false; _showPageContinue(pageId, navEl); },
      async () => {
        const ok = await _ftSaveEdit();
        if (ok) _showPageContinue(pageId, navEl);
        return ok;
      }
    );
    return;
  }
  _showPageContinue(pageId, navEl);
}

function _showPageContinue(pageId, navEl) {
  // 打卡模式下切到其他頁 → 觸發完整 INFOSYS 載入
  if (_clockOnlyMode && pageId !== 'page-clock') _upgradeFromClockMode();
  // 離開待辦頁時標記待派案 todo 為已讀
  const prevPage = document.querySelector('.page.active')?.id;
  if (prevPage === 'page-todos' && pageId !== 'page-todos') {
    let changed = false;
    todosData.forEach(t => { if (t.type === 'case_assignment' && !t.done && !t.notifRead) { t.notifRead = true; changed = true; } });
    if (changed) saveUserTodos().catch(() => {});
  }
  // #7：離開個案詳細頁時，若目的地不是「新增個案」頁（自己專屬的返回動線），清掉「查看現有案號」旗標，
  // 避免之後從一般列表進入詳細頁也被誤套用改過的返回動線
  if (prevPage === 'page-case-detail' && pageId !== 'page-case-detail' && pageId !== 'page-new-case') {
    _detailReturnToNewCase = false;
  }
  // v202：離開信箱頁停止未讀輪詢（規格＝信箱頁開著時才每 2 分鐘刷新，不在信箱頁不輪詢）
  if (prevPage === 'page-om' && pageId !== 'page-om' && typeof _omStopPoll === 'function') { _omStopPoll(); if (typeof _omStopReachPoll === 'function') _omStopReachPoll(); }
  const alreadyActive = document.getElementById(pageId)?.classList.contains('active');
  if (prevPage && prevPage !== pageId) { _prevNavState = _buildNavState(prevPage); }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  if (navEl) navEl.classList.add('active');
  if (!alreadyActive) { window.scrollTo(0, 0); _syslog('info', `USER 導航：${pageId}`); }
  updateFloatingBackBtn(pageId);
  _updatePrevBtn();
}

// 返回按鈕：banner 左上方 title 右邊
function updateFloatingBackBtn(pageId) {
  const btn = document.getElementById('header-back-btn');
  if (!btn) return;
  const showOn = ['page-new-case','page-case-detail','page-new-record','page-closure-eval','page-transfer-eval','page-casenums','page-stats','page-admin','page-audit','page-prefs','page-changelog','page-pending','page-initial-interview','page-bookings','page-recycle','page-transfer','page-psychiatry','page-unassigned-records','page-issues','page-event-records','page-pdf-tool','page-img-editor','page-psych-test-db','page-mental-leave','page-om','page-sms','page-freshman-test'];
  btn.style.display = showOn.includes(pageId) ? 'inline-block' : 'none';
  btn.dataset.fromPage = pageId;
}

// 富文字編輯器：取值/設值（存 HTML，但 strip 不安全標籤）
// 主力為 DOMPurify（白名單式，防 mXSS、變形 javascript: 等黑名單漏網攻擊）。
// 預設設定即涵蓋編輯器全部產出：b/i/u、s/strike、sub/sup、ul/ol/li、blockquote、style 屬性、
// data-*（清單樣式 data-rt-ls、家系圖 data-geno-*）、img 的 data: URI（皆為 DOMPurify 預設白名單內建標籤/屬性，
// 已用 vendored DOMPurify 3.2.7 原始碼核對過，非本次新增）。
// FORBID_TAGS 補禁 <style>（DOMPurify 預設放行，但本編輯器不產生、且可作 CSS 外洩管道）。
// v184：新增 uponSanitizeAttribute hook，把 style 屬性值再過濾一層，只留下工具列會用到的必要 CSS 屬性
// （對齊、顏色、螢光筆底色、字級、清單縮排／樣式），作為新增格式功能的縱深防禦（防經 API 直呼塞入其他 CSS）；
// 家族圖片（img，版面樣式如尺寸/框線/游標）不受此屬性白名單限制，其餘危險 CSS 建構仍由 DOMPurify 內建規則擋下。
const RT_ALLOWED_STYLE_PROPS = ['text-align', 'color', 'background-color', 'font-size', 'margin-left', 'padding-left', 'list-style-type'];
if (window.DOMPurify && !window._rtStyleHookInstalled) {
  window._rtStyleHookInstalled = true;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style' || !data.attrValue) return;
    if (node.tagName === 'IMG') return; // 家族圖片版面樣式不受此白名單限制
    const kept = data.attrValue.split(';').map(s => s.trim()).filter(Boolean).filter(decl => {
      const prop = decl.split(':')[0].trim().toLowerCase();
      return RT_ALLOWED_STYLE_PROPS.includes(prop);
    });
    data.attrValue = kept.join('; ');
  });
}
function sanitizeRichHtml(html) {
  if (!html) return '';
  if (window.DOMPurify && DOMPurify.isSupported) {
    return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'] });
  }
  // 退路：DOMPurify 意外不可用時退回原黑名單邏輯（較弱但不中斷存檔/顯示）
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // 移除危險元素
  tmp.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
  // 移除所有 on* 屬性與 javascript: 連結
  tmp.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      const v = (a.value || '').toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && v.startsWith('javascript:')) el.removeAttribute(a.name);
    });
  });
  return tmp.innerHTML;
}
// 富文字內容 → 去標籤純文字（供摘要/截斷/@提及解析等場景使用，避免截斷切壞 HTML 或誤判提及）
function _stripHtmlToText(html) {
  const s = String(html || '');
  if (!s) return '';
  if (!/<\/?[a-z][\s\S]*?>/i.test(s)) return s;
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeRichHtml(s);
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}
function getRichTextValue(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    return sanitizeRichHtml(el.innerHTML);
  }
  return el.value || '';
}
function setRichTextValue(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    const v = html || '';
    el.innerHTML = /<[a-z][\s\S]*>/i.test(v) ? sanitizeRichHtml(v) : escHtml(v).replace(/\n/g, '<br>');
  } else {
    el.value = html || '';
  }
}
function toggleRtToolbar(btn) {
  const btns = btn.nextElementSibling;
  if (!btns?.classList.contains('rt-toolbar-btns')) return;
  const shown = btns.style.display !== 'none';
  btns.style.display = shown ? 'none' : 'flex';
  btn.classList.toggle('active', !shown);
}
// 富文字工具列
const RT_OL_TYPES  = ['decimal', 'paren', 'upper-alpha', 'lower-alpha'];
const RT_UL_TYPES  = ['disc', 'circle', 'square', 'dash'];
const RT_OL_LABELS = { decimal:'1.', paren:'(1)', 'upper-alpha':'A.', 'lower-alpha':'a.' };
const RT_UL_LABELS = { disc:'•', circle:'○', square:'▪', dash:'–' };

// ══════════════════════════════════════════════
// v184：全站富文字工具列仿 Word 兩排式改版
// 全站 20+ 處 .rt-toolbar（靜態表單欄位＋問題回報等動態渲染）不逐一手動改寫按鈕 HTML，
// 改為共用 RT_TOOLBAR_BTNS_HTML 常數＋ MutationObserver 自動 hydrate：
// 只要 DOM 出現 .rt-toolbar > .rt-toolbar-btns（無論靜態頁面既有或日後任何動態渲染新增），
// 一律自動套用同一份按鈕組，確保「全站一起換」且不會漏掉任何一處。
// ══════════════════════════════════════════════
const RT_FONT_SIZES = [10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]; // pt 階梯，比照 Word 常用字級
const RT_COLOR_SWATCHES  = ['#000000','#5a5a5a','#c0392b','#e67e22','#f1c40f','#27ae60','#16a085','#2980b9','#8e44ad','#ffffff'];
const RT_HILITE_SWATCHES = ['#fff59d','#a7f3d0','#bae6fd','#fecaca','#fbcfe8','#e2e8f0'];

// v188：對齊／縮排五顆按鈕改仿 Word inline SVG 圖示（原 Unicode 字元 ≡◁/≡=/▷≡/⇤/⇥ 太細看不清楚）
const RT_ICON_ALIGN_LEFT    = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="1" y1="6.17" x2="10" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="10" y2="13.5"/></svg>';
const RT_ICON_ALIGN_CENTER  = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="3" y1="6.17" x2="13" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="3" y1="13.5" x2="13" y2="13.5"/></svg>';
const RT_ICON_ALIGN_RIGHT   = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="6" y1="13.5" x2="15" y2="13.5"/></svg>';
const RT_ICON_ALIGN_JUSTIFY = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="1" y1="6.17" x2="15" y2="6.17"/><line x1="1" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/></svg>';
const RT_ICON_INDENT        = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="6" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/><polygon points="1,5.3 1,10.7 4.6,8" fill="currentColor" stroke="none"/></svg>';
const RT_ICON_OUTDENT       = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="2.5" x2="15" y2="2.5"/><line x1="6" y1="6.17" x2="15" y2="6.17"/><line x1="6" y1="9.83" x2="15" y2="9.83"/><line x1="1" y1="13.5" x2="15" y2="13.5"/><polygon points="4.6,5.3 4.6,10.7 1,8" fill="currentColor" stroke="none"/></svg>';
// v189：項目符號／編號清單兩顆按鈕仿 Word 樣式（原純文字 •／1. 太陽春），比照上面五顆 inline SVG 做法。
const RT_ICON_LIST_BULLET   = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="2" cy="3" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none"/><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg>';
const RT_ICON_LIST_NUMBER   = '<svg viewBox="0 0 16 16" width="15" height="15" style="vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><text x="0" y="4.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1.</text><text x="0" y="9.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2.</text><text x="0" y="14.3" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3.</text><line x1="6" y1="3" x2="15" y2="3"/><line x1="6" y1="8" x2="15" y2="8"/><line x1="6" y1="13" x2="15" y2="13"/></svg>';

function _rtBtn(cmd, title, inner, extraStyle) {
  return `<button type="button" class="rt-btn" data-cmd="${cmd}" title="${title}" data-tip="${title}" style="min-width:26px;${extraStyle||''}">${inner}</button>`;
}
function _rtSep() { return '<span class="rt-toolbar-sep"></span>'; }
function _rtColorDropdownHtml(kind, label, underlineColor) {
  const swatches = kind === 'fore' ? RT_COLOR_SWATCHES : RT_HILITE_SWATCHES;
  const cols = Math.min(swatches.length, 6);
  const clearBtn = kind === 'hilite'
    ? `<div style="margin-top:5px;"><button type="button" class="rt-btn" style="font-size:.7rem;padding:2px 6px;width:100%;" onclick="_rtApplyColor('hilite','transparent')">清除螢光底色</button></div>` : '';
  return `<span class="rt-color-btn-wrap" style="position:relative;display:inline-block;">
    <button type="button" class="rt-btn" title="${label}" data-tip="${label}" style="min-width:26px;" onclick="_rtToggleColorPanel(this)">
      <span>${kind === 'fore' ? 'A' : '✎'}</span><span style="display:block;height:3px;margin-top:1px;border-radius:1px;background:${underlineColor};"></span>
    </button>
    <div class="rt-color-panel" data-kind="${kind}" style="display:none;position:absolute;z-index:60;top:100%;left:0;margin-top:3px;background:#fff;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.16);padding:6px;">
      <div style="display:grid;grid-template-columns:repeat(${cols},18px);gap:4px;">
        ${swatches.map(c => `<span class="rt-color-swatch" onclick="_rtApplyColor('${kind}','${c}')" title="${c}" style="width:18px;height:18px;border:1px solid #cbd5e0;border-radius:3px;cursor:pointer;background:${c};display:inline-block;transition:transform .1s;"></span>`).join('')}
      </div>
      ${clearBtn}
    </div>
  </span>`;
}
const RT_TOOLBAR_BTNS_HTML =
  '<div class="rt-toolbar-row">' +
    _rtBtn('rtShrinkFont', '縮小字型', 'A<span style="font-size:.62em;vertical-align:sub;">－</span>') +
    _rtBtn('rtGrowFont',   '放大字型', 'A<span style="font-size:.62em;vertical-align:super;">＋</span>') +
    _rtSep() +
    _rtBtn('rtCycleUL', '項目符號清單（重複點擊切換符號樣式）', RT_ICON_LIST_BULLET) +
    _rtBtn('rtCycleOL', '編號清單（重複點擊切換編號樣式）', RT_ICON_LIST_NUMBER) +
    _rtSep() +
    _rtBtn('rtOutdent', '減少縮排', RT_ICON_OUTDENT) +
    _rtBtn('rtIndent',  '增加縮排', RT_ICON_INDENT) +
  '</div>' +
  '<div class="rt-toolbar-row">' +
    _rtBtn('bold',      '粗體 (Ctrl+B)', 'B', 'font-weight:bold;') +
    _rtBtn('italic',    '斜體 (Ctrl+I)', 'I', 'font-style:italic;') +
    _rtBtn('underline', '底線 (Ctrl+U)', 'U', 'text-decoration:underline;') +
    _rtSep() +
    _rtBtn('strikeThrough', '刪除線', 'S', 'text-decoration:line-through;') +
    _rtBtn('subscript',     '下標',   'x<span style="font-size:.7em;vertical-align:sub;">2</span>') +
    _rtBtn('superscript',   '上標',   'x<span style="font-size:.7em;vertical-align:super;">2</span>') +
    _rtSep() +
    _rtColorDropdownHtml('fore',   '字型顏色', '#e53e3e') +
    _rtColorDropdownHtml('hilite', '螢光筆（反白底色）', '#f1c40f') +
    _rtSep() +
    _rtBtn('justifyLeft',   '靠左對齊',   RT_ICON_ALIGN_LEFT) +
    _rtBtn('justifyCenter', '置中對齊',   RT_ICON_ALIGN_CENTER) +
    _rtBtn('justifyRight',  '靠右對齊',   RT_ICON_ALIGN_RIGHT) +
    _rtBtn('justifyFull',   '左右對齊',   RT_ICON_ALIGN_JUSTIFY) +
    _rtSep() +
    _rtBtn('removeFormat', '清除格式', '清') +
  '</div>';
// 供動態渲染（問題回報等）插入 rt-editor 時共用的工具列外殼；內容由下方 hydrate 自動填入
function _rtToolbarStaticHtml() {
  return '<div class="rt-toolbar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:6px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;padding:4px 8px;">'
    + '<button type="button" class="rt-btn rt-toolbar-toggle" onclick="toggleRtToolbar(this)" title="格式工具列">A</button>'
    + '<span class="rt-toolbar-btns" style="display:none;"></span>'
    + '</div>';
}
function _rtHydrateToolbar(tb) {
  if (!tb || tb.dataset.rtBuilt) return;
  const btns = tb.querySelector('.rt-toolbar-btns');
  if (btns) btns.innerHTML = RT_TOOLBAR_BTNS_HTML;
  tb.dataset.rtBuilt = '1';
}
function _rtHydrateToolbars(root) {
  const scope = root || document;
  if (scope.matches?.('.rt-toolbar')) _rtHydrateToolbar(scope);
  scope.querySelectorAll?.('.rt-toolbar:not([data-rt-built])').forEach(_rtHydrateToolbar);
}
_rtHydrateToolbars(document);
new MutationObserver(muts => {
  muts.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      _rtHydrateToolbars(node);
    });
  });
}).observe(document.body, { childList: true, subtree: true });

// 字型顏色／螢光筆下拉：開關與套用
function _rtToggleColorPanel(btn) {
  const wrap = btn.closest('.rt-color-btn-wrap');
  const panel = wrap?.querySelector('.rt-color-panel');
  if (!panel) return;
  const willOpen = panel.style.display === 'none';
  document.querySelectorAll('.rt-color-panel').forEach(p => { p.style.display = 'none'; });
  panel.style.display = willOpen ? 'block' : 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.rt-color-btn-wrap')) {
    document.querySelectorAll('.rt-color-panel').forEach(p => { p.style.display = 'none'; });
  }
});
function _rtApplyColor(kind, color) {
  document.querySelectorAll('.rt-color-panel').forEach(p => { p.style.display = 'none'; });
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = node?.closest?.('.rt-editor');
  if (!editor) return;
  editor.focus();
  if (kind === 'fore') {
    document.execCommand('foreColor', false, color);
  } else {
    // hiliteColor 在部分引擎可能拋例外而非回傳 false，try/catch 確保能落到 backColor 備援
    let ok = false;
    try { ok = document.execCommand('hiliteColor', false, color); } catch (e) {}
    if (!ok) { try { document.execCommand('backColor', false, color); } catch (e) {} }
  }
  const toolbar = editor.previousElementSibling;
  if (toolbar?.classList.contains('rt-toolbar')) _updateRtBtnStates(toolbar);
}

// 字級調整（無原生「放大/縮小字型」execCommand，比照 fontSize=7 佔位轉 style 的通用手法）
function _rtCurrentFontSizePt(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 12;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node || !editor.contains(node)) return 12;
  const px = parseFloat(getComputedStyle(node).fontSize) || 16;
  return Math.round(px * 0.75 * 10) / 10; // px → pt（96dpi：1px＝0.75pt）
}
function _rtStepFontSize(delta) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    if (typeof showToast === 'function') showToast('請先選取要調整大小的文字', 'warn', 1800);
    return;
  }
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = node?.closest?.('.rt-editor');
  if (!editor) return;
  const cur = _rtCurrentFontSizePt(editor);
  let idx = 0, bestDiff = Infinity;
  RT_FONT_SIZES.forEach((v, i) => { const d = Math.abs(v - cur); if (d < bestDiff) { bestDiff = d; idx = i; } });
  idx = Math.max(0, Math.min(RT_FONT_SIZES.length - 1, idx + delta));
  const target = RT_FONT_SIZES[idx];
  document.execCommand('fontSize', false, '7');
  editor.querySelectorAll('font[size="7"]').forEach(f => {
    f.removeAttribute('size');
    f.style.fontSize = target + 'pt';
  });
}

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Tab') return;
  const editor = e.target.closest?.('.rt-editor');
  if (!editor) return;
  e.preventDefault();
  if (e.shiftKey) _rtOutdent(); else _rtCycleIndent();
});

document.addEventListener('dblclick', function(e) {
  const img = e.target.closest('img[data-geno-key]');
  if (!img) return;
  const fieldId = img.getAttribute('data-geno-field');
  const caseId = img.getAttribute('data-geno-cid') || null;
  const storeKey = img.getAttribute('data-geno-key');
  if (fieldId && storeKey) openGenogramEditor(fieldId, caseId, storeKey);
});

// v199：入口 C——rt-editor 內嵌一般圖片（非家系圖，上面那個委派已處理家系圖）雙擊開圖片編輯器
document.addEventListener('dblclick', function(e) {
  const img = e.target.closest('.rt-editor img');
  if (!img || img.hasAttribute('data-geno-key')) return;
  _rtImgEditorOpen(img);
});

document.addEventListener('click', function (e) {
  const btn = e.target.closest('.rt-btn');
  if (!btn) return;
  e.preventDefault();
  const cmd = btn.dataset.cmd;
  if (!cmd) return;
  const toolbar = btn.closest('.rt-toolbar');
  const editor = toolbar?.nextElementSibling;
  if (editor?.classList.contains('rt-editor')) editor.focus();
  if      (cmd === 'rtCycleOL')    _rtCycleList('OL');
  else if (cmd === 'rtCycleUL')    _rtCycleList('UL');
  else if (cmd === 'rtIndent')     _rtCycleIndent();
  else if (cmd === 'rtOutdent')    _rtOutdent();
  else if (cmd === 'rtGrowFont')   _rtStepFontSize(1);
  else if (cmd === 'rtShrinkFont') _rtStepFontSize(-1);
  else document.execCommand(cmd, false, null);
  if (toolbar) _updateRtBtnStates(toolbar);
});

document.addEventListener('selectionchange', function () {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = node?.closest?.('.rt-editor');
  if (!editor) return;
  const toolbar = editor.previousElementSibling;
  if (toolbar?.classList.contains('rt-toolbar')) _updateRtBtnStates(toolbar);
});

document.addEventListener('keyup', function (e) {
  const editor = e.target.closest?.('.rt-editor');
  if (!editor) return;
  const toolbar = editor.previousElementSibling;
  if (toolbar?.classList.contains('rt-toolbar')) _updateRtBtnStates(toolbar);
});

// ── 通用：批次勾選清單的全選／全不選／Shift 範圍選取（v205 起，全站共用同一套機制，見下方登記表）──
// 適用全站所有「列級批次勾選」清單（個案列表、案號查詢與管理、待辦事項、身心調適假等，見下方清單），
// 不含單一設定用途的 checkbox（如「僅看自己」這類非清單多選）。新增涉及批次勾選的功能時，一律將
// row checkbox 加上共同 class 並登記進 SHIFT_RANGE_SELECT_CLASSES，即自動取得 Shift 範圍選取；
// 全選/全不選則呼叫 _ckgSetAll(class, checked) 或直接輸出 _ckgToolbarHtml(class) 兩顆按鈕。
// 用事件委派掛在 document 上（依 class 判斷群組），不受清單 re-render（innerHTML 重建）影響；
// 記錄每個群組「上次點擊」的 checkbox，shift+click 時把兩者之間（依目前 DOM 順序）的同群組 checkbox
// 全部設成本次點擊 checkbox 的勾選狀態，並對每個被改動的 checkbox 觸發 change 事件，讓既有 onchange
// （如 _casesSelected 等狀態同步）照常執行。checkbox 的 click 事件觸發時 checked 已是切換後的新值。
// 範圍計算（_ckgRangeIndices）為純函式、獨立於 DOM，供本機制與 pt/ir/gt/wd 等狀態陣列型匯入預覽
// 清單共用（見各自的 xxSel／xxSelAll），避免重複實作同一段「Shift 範圍」邏輯。
const SHIFT_RANGE_SELECT_CLASSES = [
  'case-row-chk',   // 個案列表
  'cn-row-chk',     // 案號查詢與管理
  'todo-select-cb', // 待辦事項列表
  'ml-row-chk',     // 身心調適假資料庫
  'ml-notif-cb',    // 待辦頁「身心調適假通知」區塊
  'bp-cb',          // 晤談記錄批次列印
  'sem-chk',        // 學期批次刪除
  'ecd-chk',        // 釋放空個案案號
  'rb-chk',         // 資源回收桶
  'grad-cb',        // 畢業生列管
  'wd-cb',          // 休退學列管
  'mspv-cb',        // 督導設定的受督者picker
  'imp-unclosed',   // 匯入服務總表：勾選仍未結案個案
  'bic-oor-chk',    // 批次匯入服務總表：排除超出學期範圍記錄
  'om-msg-cb',      // 校內信箱：訊息列表
  'pref-session-chk', // 偏好設定：登入紀錄封存勾選
  'admin-sess-chk', // v214：使用者管理「登入紀錄」tab 管理端封存勾選
  'ft-conflict-chk', // v207：新生心理測驗匯入衝突預覽勾選
  'ft-tutorsync-chk', // v209：導師名冊與 tutorsys 同步——差異「取代」勾選
  'ft-tutorsync-del-chk', // v209：導師名冊與 tutorsys 同步——已刪除班級「一併刪除」勾選
];

// 純函式：從 orderedKeys（依畫面目前順序排列的識別值陣列，可以是 DOM 順序索引，也可以是狀態
// 陣列的業務 id）中，算出 fromKey～toKey（含頭尾）之間的所有識別值。用於「Shift+點擊批次勾選」
// 的範圍計算，全站共用同一份邏輯（不論背後是純 DOM checkbox，或狀態陣列＋重繪的匯入預覽清單）。
// 找不到 fromKey 或 toKey 時，退化為只回傳 [toKey]（找不到範圍就至少處理本次點擊的項目）；
// toKey 為 null/undefined（無點擊目標）時回傳空陣列。
function _ckgRangeIndices(orderedKeys, fromKey, toKey) {
  if (toKey === undefined || toKey === null) return [];
  const from = orderedKeys.indexOf(fromKey);
  const to = orderedKeys.indexOf(toKey);
  if (from === -1 || to === -1) return [toKey];
  const lo = Math.min(from, to), hi = Math.max(from, to);
  return orderedKeys.slice(lo, hi + 1);
}

// 對某 class 的所有 checkbox（未 disabled 者）設定同一勾選狀態；用 .click() 模擬真實點擊
// （而非直接改 .checked 再派發 change），確保不論該畫面把狀態更新邏輯掛在 onchange 或 onclick
// 上都能正確觸發，行為等同使用者一顆顆真的點過一遍。
function _ckgSetAll(cls, checked) {
  document.querySelectorAll('.' + cls).forEach(cb => {
    if (cb.disabled) return;
    if (cb.checked !== checked) cb.click();
  });
}

// 標準「全選／全不選」工具列（兩顆小按鈕），一行接入既有畫面：_ckgToolbarHtml('xxx-chk')。
function _ckgToolbarHtml(cls, opts) {
  opts = opts || {};
  const size = opts.size || 'sm';
  const labels = opts.labels || ['全選', '全不選'];
  return `<button type="button" class="btn btn-secondary btn-${size}" onclick="_ckgSetAll('${cls}',true)">${escHtml(labels[0])}</button>` +
    `<button type="button" class="btn btn-secondary btn-${size}" onclick="_ckgSetAll('${cls}',false)">${escHtml(labels[1])}</button>`;
}

const _shiftRangeLastClicked = {}; // class 名稱 → 該群組最後點擊的 checkbox 元素
// 用 capture phase：部分清單（如個案列表）的 row checkbox 外層有 onclick="event.stopPropagation()"
// 阻擋事件冒泡到 document，capture phase 由上而下先於那些 bubble-phase 攔截執行，才能穩定收到事件。
document.addEventListener('click', function (e) {
  const cb = e.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const cls = SHIFT_RANGE_SELECT_CLASSES.find(c => cb.classList.contains(c));
  if (!cls) return;
  if (e.shiftKey && _shiftRangeLastClicked[cls] && document.contains(_shiftRangeLastClicked[cls]) && _shiftRangeLastClicked[cls] !== cb) {
    const group = [...document.querySelectorAll('.' + cls)];
    const idxKeys = group.map((_, i) => i);
    const from = group.indexOf(_shiftRangeLastClicked[cls]);
    const to = group.indexOf(cb);
    const range = (from !== -1 && to !== -1) ? _ckgRangeIndices(idxKeys, from, to) : [];
    const target = cb.checked;
    range.forEach(i => {
      const item = group[i];
      if (item.checked !== target) {
        item.checked = target;
        item.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  _shiftRangeLastClicked[cls] = cb;
}, true);

function _updateRtBtnStates(toolbar) {
  toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd;
    try {
      if (['bold','italic','underline','strikeThrough','subscript','superscript','justifyLeft','justifyCenter','justifyRight','justifyFull'].includes(cmd)) {
        btn.classList.toggle('rt-active', document.queryCommandState(cmd));
      } else if (cmd === 'rtCycleOL') {
        const ol = _rtFindList('OL');
        btn.classList.toggle('rt-active', !!ol);
        btn.textContent = ol ? (RT_OL_LABELS[ol.dataset.rtLs] || '1.') : '1.';
      } else if (cmd === 'rtCycleUL') {
        const ul = _rtFindList('UL');
        btn.classList.toggle('rt-active', !!ul);
        btn.textContent = ul ? (RT_UL_LABELS[ul.dataset.rtLs] || '•') : '•';
      }
    } catch(e) {}
  });
}

function _rtFindList(tag) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  while (node && node.nodeName !== 'BODY') {
    if (node.nodeName === tag) return node;
    node = node.parentNode;
  }
  return null;
}

function _rtCycleList(tag) {
  const types = tag === 'OL' ? RT_OL_TYPES : RT_UL_TYPES;
  const existing = _rtFindList(tag);
  if (!existing) {
    document.execCommand(tag === 'OL' ? 'insertOrderedList' : 'insertUnorderedList', false, null);
    const newList = _rtFindList(tag);
    if (newList) _rtApplyListType(newList, tag, types[0]);
    return;
  }
  const curType = existing.dataset.rtLs || types[0];
  const idx = types.indexOf(curType);
  if (idx + 1 >= types.length) {
    existing.removeAttribute('data-rt-ls');
    document.execCommand(tag === 'OL' ? 'insertOrderedList' : 'insertUnorderedList', false, null);
  } else {
    _rtApplyListType(existing, tag, types[idx + 1]);
  }
}

function _rtApplyListType(el, tag, type) {
  el.dataset.rtLs = type;
  el.style.listStyleType = (type === 'paren' || type === 'dash') ? 'none' : type;
}

function _rtCycleIndent() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = node?.closest?.('.rt-editor');
  // 若在列點/編號內，對整個 ul/ol 做 margin-left（帶動符號一起移動）
  let listEl = null, cur = node;
  while (cur && cur !== editor) {
    if (cur.nodeName === 'OL' || cur.nodeName === 'UL') { listEl = cur; break; }
    cur = cur.parentElement;
  }
  if (listEl) {
    const curMl = parseFloat(listEl.style.marginLeft) || 0;
    const nextMl = Math.min(10, Math.round(curMl + 2)); // v184：改為累加後於上限鎖住，不再自動歸零（歸零改由減少縮排按鈕負責）
    listEl.style.marginLeft = nextMl > 0 ? nextMl + 'em' : '';
    return;
  }
  // 一般段落：對 block 元素做 padding-left
  let block = null; cur = node;
  while (cur && cur !== editor) {
    if (/^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(cur.nodeName)) { block = cur; break; }
    cur = cur.parentElement;
  }
  if (!block) return;
  const curPl = parseFloat(block.style.paddingLeft) || 0;
  const nextPl = Math.min(10, Math.round(curPl + 2));
  block.style.paddingLeft = nextPl > 0 ? nextPl + 'em' : '';
}

function _rtOutdent() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = node?.closest?.('.rt-editor');
  let listEl = null, cur = node;
  while (cur && cur !== editor) {
    if (cur.nodeName === 'OL' || cur.nodeName === 'UL') { listEl = cur; break; }
    cur = cur.parentElement;
  }
  if (listEl) {
    const curMl = parseFloat(listEl.style.marginLeft) || 0;
    const nextMl = Math.max(0, curMl - 2);
    listEl.style.marginLeft = nextMl > 0 ? nextMl + 'em' : '';
    return;
  }
  let block = null; cur = node;
  while (cur && cur !== editor) {
    if (/^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(cur.nodeName)) { block = cur; break; }
    cur = cur.parentElement;
  }
  if (!block) return;
  const curPl = parseFloat(block.style.paddingLeft) || 0;
  const nextPl = Math.max(0, curPl - 2);
  block.style.paddingLeft = nextPl > 0 ? nextPl + 'em' : '';
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleFloatingBack() {
  const fab = document.getElementById('header-back-btn');
  const from = fab?.dataset?.fromPage;
  if (from === 'page-event-records') { exitEventRecordForm(); return; }
  if (from === 'page-transfer-eval') { cancelTransferEvalForm(); return; }
  // v185：結案評估／個案資料表單改走各自的離開防護（原本這裡直接導頁，繞過草稿備援與離開詢問）
  if (from === 'page-closure-eval') { cancelClosureEval(); return; }
  // v265：晤談記錄／初次晤談表 banner 返回鈕比照 v185 教訓，改走各自的離開防護——
  // 原本直接導頁（見上），會在有未儲存輸入時繞過草稿備援與離開詢問
  if (from === 'page-new-record') { exitRecordForm(); return; }
  if (from === 'page-initial-interview') { exitIIForm(); return; }
  // #7：從「新增個案」按「查看現有案號」進入詳細頁時，banner 返回也要走專屬動線回新增個案頁
  // （與頁內 btn-detail-back 一致，見 _renderDetailBackBtn），先前一律回列表導致回不去新增個案。
  if (from === 'page-case-detail' && typeof _detailReturnToNewCase !== 'undefined' && _detailReturnToNewCase) {
    _detailBackToNewCase();
    return;
  }
  if (from === 'page-new-case') { cancelCaseForm(); return; }
  if (from === 'page-case-detail' || from === 'page-pending') {
    showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
    try { renderCases(); } catch(_) {}
    return;
  }
  showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
}

function setAlert(containerId, type, msg) {
  document.getElementById(containerId).innerHTML =
    msg ? `<div class="alert alert-${type}">${msg}</div>` : '';
}

