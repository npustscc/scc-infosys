// dev/draft-engine.js — 草稿引擎＋雲端備援＋待派案 todo 模組（拆 index.html 絞殺者第十二刀，v258）。
// 內容為從 index.html 逐字搬出的函式，依原始順序分為五組：待辦/草稿還原批次工具
// （_migrateLocalStorageDrafts／_checkPastSemUnclosedForDirectors／_syncPendingRecordsToTodos）、
// 草稿 key 型別解析與全站表單草稿共用引擎（_parseDraftKeyType／_isDraftSnapshotDirty／
// _gdSetBaseline／_gdIsDirty／_gdStartAutosave／_gdStopAutosave）、草稿雲端備援 v2（v248 加，
// _collectLocalDrafts／_cloudDraftDiff／_cloudDraftTick／_startCloudDraftSync／
// _restoreCloudDraftsThenMigrate）、離開表單對話框與各表單（晤談紀錄／初次晤談表／精神科評估）
// 退出/暫存/捨棄（_genoExitDialog／_showExitDialog／exitRecordForm／_snapshotRecordFormPartial／
// draftRecord／discardRecord／exitIIForm／draftInitialInterview／discardInitialInterview／
// exitPsyForm／draftPsychiatristRecord／discardPsychiatristRecord）、管理者查看他人待辦
// （_fetchAdminTodosForUser／_onTodosUserFilterChange）、待派案 todo 渲染與確認派案/轉案
// （_renderAssignmentTodos／_confirmInternalTransfer／_confirmCaseAssignment），共 31 個函式。
// 頂層無任何執行副作用（只有 function/async function 與純初始值 const/let 宣告）；本檔頂層
// 宣告的 2 個 const（_genericDraftState／CLOUD_DRAFT_KEY_PREFIXES）與 2 個 let（_cloudSyncedMap／
// _cloudSyncTimerStarted）一併搬移，經逐一確認全專案僅本檔各一處宣告、無跨檔重複宣告
// （比照 v253/v256/v257 的作法）。column-0 複核：本區塊全數為 function/async function/
// const/let/收尾大括號/註解/空行，未發現 addEventListener／IIFE／window.X=／裸呼叫，
// 故無需像 v257（_initStdPeriodSelects 觸發語句）那樣窄化邊界——整段原樣搬移。
// 函式內部在呼叫時才會引用主檔全域可變狀態（currentUser／todosData／casesData／configData／
// _suppressedTodoRecordIds／_adminTodosCache／_todosViewUser／_recCounselors／_recordKind／
// _attachState／DRIVE_FOLDER_ID 等，定義仍留在 index.html），以及主檔與其他拆檔模組內的共用
// 函式（_genTodoId／_putTodoItem／_removeTodoItem／_syncTodoBadge（緊鄰本檔前一段，仍留
// index.html）、proxyCall／_getSession／showToast／showPage／showCaseDetail（case-detail.js）／
// backToCaseList（closure-eval.js）／bgJobAdd／bgJobDone／bgJobFail／saveUserTodos／
// saveCasesChunks／getRichTextValue／_collectServiceItems／stopRecordDraftAutosave／
// clearRecordDraft／clearPsyDraft／stopPsyDraftAutosave／buildCounselorOptgroups／auditLog／
// renderCases／getUsersFolderId／driveQuery／driveReadJsonById／_myNotifs／_queueNotifPush／
// _flushNotifOps／renderNotifBell 等，皆定義於 index.html；snapshotInitialInterview／
// stopIIDraftAutosave／clearIIDraft 定義於 initial-interview.js；_applyCounselorChange 定義於
// case-detail.js；renderTodosPage 定義於 event-records.js；escHtml／semesterLabel／
// openDateToSemPrefix／currentSemesterPrefix 定義於 utils.js），屬 call-time 解析，與其他拆檔
// 模組（utils.js／ft-core.js／case-detail.js／case-import.js／initial-interview.js／
// psych-import.js／grad-eval.js／closure-eval.js／event-records.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="draft-engine.js"></script> 載入（放在
// event-records.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

function _migrateLocalStorageDrafts() {
  const email = currentUser?.email || '';
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('scc_draft_') && k.includes(email)) keys.push(k);
    }
  } catch (_) {}
  if (!keys.length) return;
  let changed = false;
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') continue;
      const savedAt = draft._savedAt || new Date().toISOString();
      // skip if already migrated (but clean up stale localStorage copy)
      if (todosData.find(t => t.draftKey === key)) {
        try { localStorage.removeItem(key); } catch(_) {}
        continue;
      }
      let type = 'autosave', label = '自動備援草稿';
      if (key.includes('scc_draft_psy_')) { type = 'psychiatrist'; label = '精神科評估草稿'; }
      else if (key.includes('scc_draft_ii_')) { type = 'initial_interview'; label = '初次晤談表草稿'; }
      else if (key.includes('scc_draft_record_')) { type = 'record'; label = '晤談記錄草稿'; }
      else {
        // v185：新增 7 張表單其中 6 張（不含家系圖，其還原機制獨立、不進 todo）沿用 scc_draft_ 前綴系列
        const _nt = _parseDraftKeyType(key);
        if (_nt) { type = _nt.type; label = _nt.label; }
      }
      // extract caseId: key format scc_draft_record_{email}_{caseId}_{recordId}
      const parts = key.split('_');
      const emailParts = email.split('@');
      let caseId = '';
      const emailIdx = parts.findIndex(p => p === emailParts[0] || key.includes(email));
      // simpler: find caseId as the part that starts with letter/year pattern
      const afterEmail = key.replace(`scc_draft_`, '').replace(/^(record|psy|ii|case|closure|transfer|mlassess|booking|issue)_/, '').replace(email + '_', '');
      caseId = afterEmail.split('_')[0] || '';
      // find case name
      const caseObj = casesData.find(c => c.id === caseId);
      const caseLabel = caseObj ? `${caseObj.name}（${caseId}）` : caseId;
      _putTodoItem({
        id: _genTodoId(),
        type,
        label,
        caseId,
        caseLabel,
        draftKey: key,
        draftData: draft,
        origin: 'autosave',
        notifRead: false,
        done: false,
        createdAt: savedAt,
      });
      // draft data is now in Drive (Todo's draftData), safe to free localStorage
      try { localStorage.removeItem(key); } catch(_) {}
      changed = true;
    } catch (_) {}
  }
  if (changed) {
    saveUserTodos().catch(e => console.warn('saveUserTodos after migrate failed:', e));
    _syncBellBadge();
  }
}

// ── 把 casesData 中遺失對應 todo 的 pending 記錄補回待辦事項 ──

// ── 4-10: 學期結束後未結案持續提醒主任 ──────────────────────────────────────
function _checkPastSemUnclosedForDirectors() {
  const me = configData?.users?.[currentUser?.email];
  if (!me || me.role !== '主任') return;
  const curSem = currentSemesterPrefix();
  const unclosedSems = new Set();
  for (const c of casesData) {
    if (c.deleted || c.archived) continue;
    const sems = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)].filter(Boolean);
    for (const sem of sems) {
      if (sem >= curSem) continue; // 只看過去學期
      const semStatus = (c.semesterStatus || {})[sem];
      if (semStatus !== 'closed') unclosedSems.add(sem);
    }
  }
  if (!unclosedSems.size) return;
  const semList = [...unclosedSems].sort().map(s => semesterLabel(s)).join('、');
  const notifKey = `past_sem_unclosed_${[...unclosedSems].sort().join('_')}`;
  if (!_myNotifs().find(n => n.id === notifKey && !n.read)) {
    _queueNotifPush(currentUser.email, {
      id: notifKey, type: 'past_sem_unclosed', caseId: '', caseName: '',
      message: `提醒：${semList} 學期仍有個案尚未完成結案評估，請確認是否需要處理。`,
      createdAt: new Date().toISOString(), read: false,
    });
    _flushNotifOps().catch(() => {});
    renderNotifBell();
  }
  // 建立/更新 todo 項目（讓左側 badge 顯示）
  const todoKey = `unclosed_reminder_${[...unclosedSems].sort().join('_')}`;
  if (!todosData.find(t => t.id === todoKey && !t.done)) {
    todosData = todosData.filter(t => t.type !== 'unclosed_reminder' || t.done || t.archivedAt);
    _putTodoItem({
      id: todoKey, type: 'unclosed_reminder',
      label: `未結案提醒：${semList} 學期`,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      done: false, notifRead: false,
    });
    saveUserTodos().catch(() => {});
  }
}

function _syncPendingRecordsToTodos() {
  let changed = false;
  for (const c of casesData) {
    if (c.deleted) continue;
    const caseLabel = `${c.name}（${c.id}）`;
    for (const r of (c.records || [])) {
      if (r.status !== 'pending') continue;
      if (r.deleted) continue;
      if (_suppressedTodoRecordIds.has(r.id)) continue;
      if (todosData.find(t => t.recordId === r.id && t.type === 'record')) continue;
      _putTodoItem({
        id: _genTodoId(), type: 'record', label: '晤談記錄草稿',
        caseId: c.id, caseLabel, recordId: r.id,
        origin: 'manual', notifRead: false, done: false,
        createdAt: r.draftSavedAt || r.createdAt || new Date().toISOString(),
        updatedAt: r.draftSavedAt || r.updatedAt || new Date().toISOString(),
      });
      changed = true;
    }
    for (const pr of (c.psychiatristRecords || [])) {
      if (pr.status !== 'pending') continue;
      if (pr.deleted) continue;
      if (_suppressedTodoRecordIds.has(pr.id)) continue;
      if (todosData.find(t => t.recordId === pr.id && t.type === 'psychiatrist')) continue;
      _putTodoItem({
        id: _genTodoId(), type: 'psychiatrist', label: '精神科評估草稿',
        caseId: c.id, caseLabel, recordId: pr.id,
        origin: 'manual', notifRead: false, done: false,
        createdAt: pr.draftSavedAt || pr.createdAt || new Date().toISOString(),
        updatedAt: pr.draftSavedAt || pr.updatedAt || new Date().toISOString(),
      });
      changed = true;
    }
    if (c.initialInterview?.status === 'pending') {
      if (!todosData.find(t => t.caseId === c.id && t.type === 'initial_interview' && !t.draftKey)) {
        const ii = c.initialInterview;
        _putTodoItem({
          id: _genTodoId(), type: 'initial_interview', label: '初次晤談表草稿',
          caseId: c.id, caseLabel,
          origin: 'manual', notifRead: false, done: false,
          createdAt: ii.draftSavedAt || ii.createdAt || new Date().toISOString(),
          updatedAt: ii.draftSavedAt || ii.updatedAt || new Date().toISOString(),
        });
        changed = true;
      }
    }
  }
  if (changed) {
    saveUserTodos().catch(e => console.warn('saveUserTodos after sync failed:', e));
    _syncBellBadge();
  }
}

// ── v185：全站表單草稿備援共用引擎 ──────────────────────────────────────
// 供本次補上防護的 6 張表單使用（個案資料／結案評估／轉銜評估／身心狀態評估表／空間預約／問題回報）；
// 晤談記錄／初談表／精神科評估／事件處理記錄已各自有既有實作，不動既有邏輯。
// 家系圖編輯器另有獨立機制（不進 todo），不使用本引擎。

// 純函式：依 localStorage key 判斷屬於哪一種新表單草稿（scc_draft_<tag>_ 前綴系列）。
// 找不到對應前綴時回傳 null（呼叫端 fallback 為既有的通用 'autosave' 類型，不影響既有行為）。
function _parseDraftKeyType(key) {
  const MAP = [
    ['scc_draft_case_',     'case_draft',      '個案資料草稿'],
    ['scc_draft_closure_',  'closure_draft',   '結案評估草稿'],
    ['scc_draft_transfer_', 'transfer_draft',  '轉銜評估草稿'],
    ['scc_draft_mlassess_', 'ml_assess_draft', '身心狀態評估表草稿'],
    ['scc_draft_booking_',  'booking_draft',   '空間預約草稿'],
    ['scc_draft_issue_',    'issue_draft',     '問題回報草稿'],
  ];
  for (const [prefix, type, label] of MAP) {
    if (key && key.includes(prefix)) return { type, label };
  }
  return null;
}

// 純函式：目前表單快照是否與開表單當下的基準快照（baseline）不同——用來判定「使用者是否有實際輸入」，
// 而不是單純看欄位是否為空，避免編輯模式回填既有資料、或新增模式的預設值（如今天日期）被誤判為使用者輸入。
// baselineJson 允許為 null/undefined（尚未設定基準時視為「與任何非 undefined 快照都不同」＝ dirty）。
function _isDraftSnapshotDirty(currentSnapshot, baselineJson) {
  if (baselineJson == null) return currentSnapshot !== undefined;
  return JSON.stringify(currentSnapshot) !== baselineJson;
}

// name → { timer, baseline(JSON string) }
const _genericDraftState = {};
function _gdSetBaseline(name, snapshot) {
  _genericDraftState[name] = { ..._genericDraftState[name], baseline: JSON.stringify(snapshot) };
}
function _gdIsDirty(name, snapshot) {
  return _isDraftSnapshotDirty(snapshot, _genericDraftState[name]?.baseline);
}
// snapshotFn()：回傳目前表單快照（plain object）；statusElId：畫面上顯示「草稿備援 HH:MM」的小字 id（可省略）。
// 200KB 上限（家系圖等大型 JSON 走獨立機制，這裡是保險——極端情況下若某表單快照異常肥大，跳過該次寫入並於狀態小字註明）。
function _gdStartAutosave(name, key, snapshotFn, statusElId) {
  _gdStopAutosave(name);
  if (!_genericDraftState[name]) _genericDraftState[name] = {};
  _genericDraftState[name].timer = setInterval(() => {
    try {
      const snap = snapshotFn();
      if (!_gdIsDirty(name, snap)) return;
      const json = JSON.stringify(snap);
      const statusEl = statusElId ? document.getElementById(statusElId) : null;
      if (json.length > 200000) {
        if (statusEl) statusEl.textContent = '草稿內容過大，本次未備援';
        return;
      }
      localStorage.setItem(key, json);
      if (statusEl) {
        const t = new Date();
        statusEl.textContent = `草稿備援 ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
      }
    } catch (e) { console.warn('draft autosave failed:', name, e); }
  }, 5000);
}
function _gdStopAutosave(name) {
  if (_genericDraftState[name]?.timer) { clearInterval(_genericDraftState[name].timer); _genericDraftState[name].timer = null; }
}

// ── v248：草稿雲端備援 v2 ──────────────────────────────────────────────
// 本機草稿（localStorage，上方既有每 5 秒機制）之外，額外每 30 秒把有變動的草稿同步一份到伺服器
// （sqlite，存自己帳號底下，見 server/src/actions/drafts.js），登入時拉回（見
// _restoreCloudDraftsThenMigrate），達成跨裝置還原與兜底（換電腦、清瀏覽器資料不至於整份遺失）。
// 衝突規則：**本機存在同 key 草稿時本機贏**——sweeper 只會把本機值往上傳，絕不會用伺服器值覆蓋
// 正在使用中的本機草稿；本機沒有該 key 時才從伺服器 materialize 到 localStorage，之後接手既有
// 各表單「重開詢問還原」流程，本引擎不涉入還原 UI。刪除傳播：不改任何既有 removeItem 呼叫點，
// 純粹靠比對「上次已同步集合」與目前 localStorage 偵測本機消失的 key，順帶請伺服器一併刪除。

// 涵蓋的 localStorage key 前綴（5 類會落地的表單草稿；家系圖／evr／om 撰寫／轉銜初評皆刻意不用
// scc_draft_ 前綴，見各自 _xxxDraftKey 檔頭註解，但都已逐一確認 key 字串含 currentUser.email）。
const CLOUD_DRAFT_KEY_PREFIXES = ['scc_draft_', 'scc_geno_draft_', 'evr_draft_', 'scc_om_compose_draft_', 'scc_ta_draft_'];

// 掃 localStorage，收集屬於目前登入者、符合上述前綴的草稿 key/payload（key 字串須含 email，防同機
// 多帳號互洩）；單筆 >200KB 跳過（同 _gdStartAutosave 既有上限，這類草稿本就不該同步）。
// 回傳 { key: payloadJson, ... }。
function _collectLocalDrafts() {
  const email = currentUser?.email || '';
  const out = {};
  if (!email) return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.includes(email)) continue;
      if (!CLOUD_DRAFT_KEY_PREFIXES.some(p => k.startsWith(p))) continue;
      const raw = localStorage.getItem(k);
      if (raw == null || raw.length > 200 * 1024) continue;
      out[k] = raw;
    }
  } catch (_) {}
  return out;
}

// 純函式：比對「目前本機草稿」與「上次已同步到伺服器的集合」，算出這次要 upsert／delete 的 key。
// localMap 有、且與 syncedMap 不同（新增或內容變動）→ upsert；syncedMap 有而 localMap 沒有
// （本機已刪除，走既有各表單 removeItem 呼叫點）→ delete。可測試的純函式，見 test/cloud-draft-diff.test.js。
function _cloudDraftDiff(localMap, syncedMap) {
  const lm = localMap || {};
  const sm = syncedMap || {};
  const upserts = [];
  for (const key of Object.keys(lm)) {
    if (lm[key] !== sm[key]) upserts.push({ key, payload: lm[key] });
  }
  const deletes = [];
  for (const key of Object.keys(sm)) {
    if (!(key in lm)) deletes.push(key);
  }
  return { upserts, deletes };
}

// key -> 上次已成功同步到伺服器的 payload 字串（登入時由 _restoreCloudDraftsThenMigrate 初始化）。
let _cloudSyncedMap = {};
let _cloudSyncTimerStarted = false;

async function _cloudDraftTick() {
  if (!currentUser?.email || !_getSession()) return; // 未登入/session 已過期，什麼都不做
  const localMap = _collectLocalDrafts();
  const { upserts, deletes } = _cloudDraftDiff(localMap, _cloudSyncedMap);
  if (!upserts.length && !deletes.length) return; // 沒有變動，不打 API
  try {
    const r = await proxyCall('draftCloudSync', { upserts, deletes }, true);
    const skippedKeys = new Set((r?.skipped || []).map(s => s.key));
    for (const u of upserts) {
      if (skippedKeys.has(u.key)) continue; // 被伺服器跳過（過大/超過每人上限）的不記入已同步
      _cloudSyncedMap[u.key] = u.payload;
    }
    for (const k of deletes) delete _cloudSyncedMap[k];
  } catch (e) {
    console.warn('_cloudDraftTick: draftCloudSync 失敗，留待下一輪重試：', e.message);
  }
}

// 登入成功後呼叫一次即可（旗標防重複啟動多個 interval）。
function _startCloudDraftSync() {
  if (_cloudSyncTimerStarted) return;
  _cloudSyncTimerStarted = true;
  setInterval(_cloudDraftTick, 30000);
}

// 登入時拉回：伺服器有、本機沒有的 key → materialize 到 localStorage（記入已同步集合，之後接手
// 既有「重開詢問還原」流程）；本機已有的 key → 本機贏，把**本機值**記入已同步集合（下一輪 tick
// 會自然把較新的本機版本推回伺服器，不會被舊的伺服器值覆蓋）。無論成敗最後都呼叫既有的
// _migrateLocalStorageDrafts()（不可讓雲端拉回失敗擋住既有本機還原），並啟動 30 秒 sweeper。
async function _restoreCloudDraftsThenMigrate() {
  try {
    const r = await proxyCall('draftCloudList', {}, true);
    const localMap = _collectLocalDrafts();
    for (const d of (r?.drafts || [])) {
      if (d.key in localMap) {
        _cloudSyncedMap[d.key] = localMap[d.key]; // 本機贏
      } else {
        try { localStorage.setItem(d.key, d.payload); } catch (_) { continue; }
        _cloudSyncedMap[d.key] = d.payload;
      }
    }
  } catch (e) {
    console.warn('_restoreCloudDraftsThenMigrate: draftCloudList 失敗，僅還原本機草稿：', e.message);
  }
  _migrateLocalStorageDrafts();
  _startCloudDraftSync();
}

// v185：家系圖編輯器專用離開對話框（存回表單／留草稿離開／捨棄離開／取消）。家系圖草稿走獨立
// localStorage 機制、不進 todo（宿主表單上下文複雜），故不能直接沿用下方 _showExitDialog
// （其「暫存草稿」語意是寫入待辦事項，且按鈕文案針對一般紀錄表單，套用在此處會誤導）。
function _genoExitDialog(onSaveBack, onKeepDraft, onDiscard) {
  document.getElementById('exit-dialog-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'exit-dialog-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100010;display:flex;align-items:center;justify-content:center;padding:20px;';
  el.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 24px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:1rem;font-weight:700;margin-bottom:6px;">離開家族圖編輯器</div>
      <div style="font-size:.875rem;color:#718096;margin-bottom:20px;">尚未插入回表單，請選擇離開方式：</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-primary" id="geno-exit-save" style="text-align:left;padding:10px 14px;">存回表單 — 插入家族圖後離開</button>
        <button class="btn btn-secondary" id="geno-exit-draft" style="text-align:left;padding:10px 14px;">留草稿離開 — 下次重開此圖時可還原</button>
        <button class="btn btn-secondary" id="geno-exit-discard" style="text-align:left;padding:10px 14px;color:#c53030;border-color:#fc8181;">捨棄離開 — 放棄本次編輯</button>
        <button class="btn btn-secondary" id="geno-exit-cancel" style="text-align:left;padding:10px 14px;">取消 — 繼續編輯</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('geno-exit-save').onclick    = () => { el.remove(); onSaveBack(); };
  document.getElementById('geno-exit-draft').onclick   = () => { el.remove(); onKeepDraft(); };
  document.getElementById('geno-exit-discard').onclick = () => { el.remove(); onDiscard(); };
  document.getElementById('geno-exit-cancel').onclick  = () => el.remove();
}

// ── 待辦事項：退出表單對話框 ──

function _showExitDialog(title, onSave, onDraft, onDiscard) {
  document.getElementById('exit-dialog-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'exit-dialog-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:20px;';
  el.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 24px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:1rem;font-weight:700;margin-bottom:6px;">${escHtml(title)}</div>
      <div style="font-size:.875rem;color:#718096;margin-bottom:20px;">請選擇離開方式：</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-primary" id="exit-dlg-save" style="text-align:left;padding:10px 14px;">儲存紀錄 — 驗證並正式儲存</button>
        <button class="btn btn-secondary" id="exit-dlg-draft" style="text-align:left;padding:10px 14px;">暫存草稿 — 儲存草稿至待辦事項</button>
        <button class="btn btn-secondary" id="exit-dlg-discard" style="text-align:left;padding:10px 14px;color:#c53030;border-color:#fc8181;">捨棄離開 — 放棄並離開</button>
        <button class="btn btn-secondary" id="exit-dlg-cancel" style="text-align:left;padding:10px 14px;">取消 — 繼續編輯</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('exit-dlg-save').onclick    = () => { el.remove(); onSave(); };
  document.getElementById('exit-dlg-draft').onclick   = () => { el.remove(); onDraft(); };
  document.getElementById('exit-dlg-discard').onclick = () => { el.remove(); onDiscard(); };
  document.getElementById('exit-dlg-cancel').onclick  = () => el.remove();
}

// ── 晤談記錄：退出 / 暫存 / 不儲存 ──

function exitRecordForm() {
  const _rtE = v => !(v||'').replace(/<[^>]*>/g,'').trim();
  const topics   = document.querySelectorAll('input[name="rec-topic"]:checked').length;
  const services = document.querySelectorAll('input[name="rec-service-main"]:checked').length;
  if (_rtE(getRichTextValue('rec-summary')) && _rtE(getRichTextValue('rec-assessment')) &&
      _rtE(getRichTextValue('rec-next-plan')) && _rtE(getRichTextValue('rec-notes')) &&
      !topics && !services) {
    discardRecord(); return;
  }
  _showExitDialog('離開晤談紀錄',
    () => saveRecord(),
    () => draftRecord(),
    () => discardRecord()
  );
}

function _snapshotRecordFormPartial() {
  const date    = document.getElementById('rec-date')?.value || '';
  const rawTime = document.getElementById('rec-time')?.value || '';
  const time    = rawTime === '其他' ? (document.getElementById('rec-time-other')?.value || '') : rawTime;
  const summary = getRichTextValue('rec-summary');
  const assessment = getRichTextValue('rec-assessment');
  const nextPlan   = getRichTextValue('rec-next-plan');
  const notes      = getRichTextValue('rec-notes');
  const topics = [...document.querySelectorAll('input[name="rec-topic"]:checked')].map(cb => cb.value);
  const serviceItems = _collectServiceItems();
  const interviewees = [...document.querySelectorAll('input[name="rec-interviewee"]:checked')].map(cb => cb.value);
  const intervieweeNote = document.getElementById('rec-interviewee-note')?.value || '';
  const interventionMode = document.getElementById('rec-intervention-mode')?.value || '';
  const counselors = [..._recCounselors];
  const counselorName = counselors.map(c => c.label).join('、');
  return { date, time, summary, assessment, nextPlan, notes, topics, serviceItems, interviewees, intervieweeNote, interventionMode, counselors, counselorName, recordKind: _recordKind, attachments: (_attachState.get('rec')?.existing || []), summaryImages: (_attachState.get('recimg')?.existing || []) || undefined };
}

function draftRecord() {
  const snap = _snapshotRecordFormPartial();
  const cidx = casesData.findIndex(c => c.id === _recordCaseId);
  if (cidx === -1) { showToast('無法暫存：個案不存在', 'error'); return; }
  if (!casesData[cidx].records) casesData[cidx].records = [];

  let draftRecordId;
  if (_editingRecordId) {
    draftRecordId = _editingRecordId;
    const ridx = casesData[cidx].records.findIndex(r => r.id === draftRecordId);
    if (ridx >= 0) {
      Object.assign(casesData[cidx].records[ridx], snap, { status: 'pending', draftSavedAt: new Date().toISOString() });
    }
  } else {
    draftRecordId = `REC_DRAFT_${Date.now()}`;
    casesData[cidx].records.push({
      id: draftRecordId, ...snap,
      status: 'pending',
      creatorEmail: currentUser?.email,
      createdAt: new Date().toISOString(),
      draftSavedAt: new Date().toISOString(),
    });
  }

  const caseObj = casesData[cidx];
  const caseLabel = `${caseObj.name}（${_recordCaseId}）`;
  const existingTodo = todosData.find(t => t.recordId === draftRecordId && t.type === 'record');
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'record', label: '晤談記錄草稿',
    caseId: _recordCaseId, caseLabel, recordId: draftRecordId,
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  stopRecordDraftAutosave();
  clearRecordDraft();
  showCaseDetail(_recordCaseId);
  showToast('已暫存草稿至待辦事項', 'success');

  const jobId = bgJobAdd('暫存晤談記錄草稿…');
  saveCasesChunks(_recordCaseId)
    .then(() => bgJobDone(jobId, '草稿已儲存'))
    .catch(e => bgJobFail(jobId, e.message));
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function discardRecord() {
  stopRecordDraftAutosave();
  clearRecordDraft();
  if (_recordCaseId) showCaseDetail(_recordCaseId);
  else backToCaseList();
}

// ── 初次晤談表：退出 / 暫存 / 不儲存 ──

function exitIIForm() {
  const snap = snapshotInitialInterview();
  const _rtE = v => !(v||'').replace(/<[^>]*>/g,'').trim();
  if (!snap.problemsMain.length && _rtE(snap.family) && _rtE(snap.mainIssue) &&
      _rtE(snap.summary) && _rtE(snap.expectation) && _rtE(snap.plan)) {
    discardInitialInterview(); return;
  }
  _showExitDialog('離開初次晤談表',
    () => saveInitialInterview(),
    () => draftInitialInterview(),
    () => discardInitialInterview()
  );
}

function draftInitialInterview() {
  const caseId = _initialInterviewCaseId;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) { showToast('無法暫存：個案不存在', 'error'); return; }
  const snap = snapshotInitialInterview();
  snap.status = 'pending';
  snap.draftSavedAt = new Date().toISOString();
  const prev = casesData[cidx].initialInterview;
  casesData[cidx].initialInterview = { ...(prev || {}), ...snap };

  const caseObj = casesData[cidx];
  const caseLabel = `${caseObj.name}（${caseId}）`;
  const existingTodo = todosData.find(t => t.caseId === caseId && t.type === 'initial_interview');
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'initial_interview', label: '初次晤談表草稿',
    caseId, caseLabel, origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  stopIIDraftAutosave();
  clearIIDraft();
  showCaseDetail(caseId);
  showToast('已暫存草稿至待辦事項', 'success');

  const jobId = bgJobAdd('暫存初次晤談表草稿…');
  saveCasesChunks(caseId)
    .then(() => bgJobDone(jobId, '草稿已儲存'))
    .catch(e => bgJobFail(jobId, e.message));
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function discardInitialInterview() {
  stopIIDraftAutosave();
  clearIIDraft();
  if (_initialInterviewCaseId) showCaseDetail(_initialInterviewCaseId);
}

// ── 精神科評估：退出 / 暫存 / 不儲存 ──

function exitPsyForm(caseId, recordId) {
  const _rtE = v => !(v||'').replace(/<[^>]*>/g,'').trim();
  if (_rtE(getRichTextValue('pr-main')) && _rtE(getRichTextValue('pr-core')) &&
      _rtE(getRichTextValue('pr-interv')) && _rtE(getRichTextValue('pr-rec')) &&
      _rtE(getRichTextValue('pr-notes'))) {
    discardPsychiatristRecord(caseId); return;
  }
  _showExitDialog('離開精神科醫師評估',
    () => savePsychiatristRecord(caseId, recordId),
    () => draftPsychiatristRecord(caseId, recordId),
    () => discardPsychiatristRecord(caseId)
  );
}

function draftPsychiatristRecord(caseId, recordId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) { showToast('無法暫存：個案不存在', 'error'); return; }
  const gV = id => document.getElementById(id)?.value?.trim() || '';
  const gR = n => { const el = document.querySelector(`[name="${n}"]:checked`); return el ? el.value : ''; };
  const snap = {
    intervieweeName: gV('pr-name'), legalGender: gV('pr-gender'),
    department: gV('pr-dept'), studentId: gV('pr-sid'),
    date: gV('pr-date'), timeStart: gV('pr-start'), timeEnd: gV('pr-end'),
    sessionPeriod: gV('pr-period'),
    mainIssue: getRichTextValue('pr-main'), coreAssessment: getRichTextValue('pr-core'),
    intervention: getRichTextValue('pr-interv'), recommendations: getRichTextValue('pr-rec'),
    diagnosisType: gR('pr_diag'), diagnosisName: gV('pr-diag-name'),
    medicationAdvice: gR('pr_med'), hospitalizationAdvice: gR('pr_hosp'),
    otherNotes: getRichTextValue('pr-notes'),
    attachments: (_attachState.get('psy')?.existing || []),
    status: 'pending', draftSavedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), updatedBy: currentUser?.email,
  };
  if (!c.psychiatristRecords) c.psychiatristRecords = [];
  let draftId = recordId === '__new__' ? null : recordId;
  if (draftId) {
    const idx = c.psychiatristRecords.findIndex(r => r.id === draftId);
    if (idx >= 0) Object.assign(c.psychiatristRecords[idx], snap);
    else { snap.id = draftId; snap.createdAt = new Date().toISOString(); c.psychiatristRecords.push(snap); }
  } else {
    draftId = `psy_draft_${Date.now()}`;
    snap.id = draftId; snap.createdAt = new Date().toISOString(); snap.createdBy = currentUser?.email;
    c.psychiatristRecords.push(snap);
  }

  const caseLabel = `${c.name}（${caseId}）`;
  const existingTodo = todosData.find(t => t.recordId === draftId && t.type === 'psychiatrist');
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'psychiatrist', label: '精神科評估草稿',
    caseId, caseLabel, recordId: draftId,
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  clearPsyDraft();
  stopPsyDraftAutosave();
  document.getElementById('psychiatrist-modal')?.remove();
  showCaseDetail(caseId);
  showToast('已暫存草稿至待辦事項', 'success');

  const jobId = bgJobAdd('暫存精神科評估草稿…');
  saveCasesChunks(caseId)
    .then(() => bgJobDone(jobId, '草稿已儲存'))
    .catch(e => bgJobFail(jobId, e.message));
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function discardPsychiatristRecord(caseId) {
  clearPsyDraft();
  stopPsyDraftAutosave();
  document.getElementById('psychiatrist-modal')?.remove();
  if (caseId) showCaseDetail(caseId);
}

// ── 管理者：載入特定人員的待辦事項 ──

async function _fetchAdminTodosForUser(email) {
  if (_adminTodosCache[email] !== undefined) return _adminTodosCache[email];
  try {
    const usersId = await getUsersFolderId();
    const envSuffix = DRIVE_FOLDER_ID.slice(-8);
    const newFileName = `todos_${email}_${envSuffix}.json`;
    const oldFileName = `todos_${email}.json`;
    let q = `name='${newFileName}' and '${usersId}' in parents and trashed=false`;
    let res = await driveQuery(q, 'id');
    if (!res.files?.length) {
      q = `name='${oldFileName}' and '${usersId}' in parents and trashed=false`;
      res = await driveQuery(q, 'id');
    }
    if (res.files && res.files.length) {
      const raw = await driveReadJsonById(res.files[0].id);
      _adminTodosCache[email] = Array.isArray(raw?.todos) ? raw.todos : [];
    } else {
      _adminTodosCache[email] = [];
    }
  } catch (e) {
    console.warn('_fetchAdminTodosForUser failed:', email, e);
    _adminTodosCache[email] = [];
  }
  return _adminTodosCache[email];
}

async function _onTodosUserFilterChange() {
  const sel = document.getElementById('todos-filter-user');
  const val = sel?.value || '';
  _todosViewUser = val || null;

  // Reset other filters when switching view
  const s = document.getElementById('todos-search'); if (s) s.value = '';
  const st = document.getElementById('todos-filter-status'); if (st) st.value = '';
  const ty = document.getElementById('todos-filter-type'); if (ty) ty.value = '';

  const viewingOwn = !_todosViewUser || _todosViewUser === currentUser?.email;
  if (viewingOwn) { renderTodosPage(); return; }

  const loadingEl = document.getElementById('todos-admin-loading');
  if (loadingEl) loadingEl.style.display = '';
  try {
    if (_todosViewUser === '__all__') {
      const emails = Object.keys(configData?.users || {});
      await Promise.all(emails.map(e => _fetchAdminTodosForUser(e)));
    } else {
      await _fetchAdminTodosForUser(_todosViewUser);
    }
  } catch (e) { console.warn('_onTodosUserFilterChange error:', e); }
  if (loadingEl) loadingEl.style.display = 'none';
  renderTodosPage();
}

// ── 待辦事項頁面渲染 ──

// ── 待派案 todo 渲染（req 2）───────────────────────────────────────────────
function _renderAssignmentTodos() {
  const section = document.getElementById('todos-assignment-section');
  if (!section) return;
  const items = todosData.filter(t => (t.type === 'case_assignment' || t.type === 'internal_transfer') && !t.done);
  if (!items.length) { section.innerHTML = ''; return; }
  const unread = items.filter(t => !t.notifRead);
  const read   = items.filter(t => t.notifRead);
  const renderCard = (t) => {
    const isTransfer = t.type === 'internal_transfer';
    const hasAssigned = !!t.assignedCounselor;
    const bgCol = hasAssigned ? '#f0fff4' : '#fffbeb';
    const borderCol = hasAssigned ? '#68d391' : '#f6ad55';
    const badge = hasAssigned
      ? `<span class="badge badge-green" style="font-size:.72rem;">已選主責</span>`
      : `<span class="badge badge-orange" style="font-size:.72rem;">待選主責</span>`;
    const typeTag = isTransfer
      ? `<span class="badge" style="background:#fde8e8;color:#c0392b;font-size:.72rem;">內部轉案</span>`
      : `<span class="badge" style="background:#e9d8fd;color:#553c9a;font-size:.72rem;">初談派案</span>`;
    const subInfo = isTransfer
      ? `${t.semester ? `<div style="font-size:.82rem;color:#718096;margin-bottom:4px;">學期：${escHtml(semesterLabel(t.semester))}</div>` : ''}${t.fromCounselorName ? `<div style="font-size:.82rem;color:#718096;margin-bottom:8px;">原主責：${escHtml(t.fromCounselorName)}</div>` : ''}`
      : `${t.semester ? `<div style="font-size:.82rem;color:#718096;margin-bottom:4px;">學期：${escHtml(semesterLabel(t.semester))}</div>` : ''}${t.filledByName ? `<div style="font-size:.82rem;color:#718096;margin-bottom:8px;">初談者：${escHtml(t.filledByName)}</div>` : ''}`;
    const confirmFn = isTransfer ? '_confirmInternalTransfer' : '_confirmCaseAssignment';
    return `<div id="todo-card-${escHtml(t.id)}" style="background:${bgCol};border:1px solid ${borderCol};border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        ${typeTag}
        <span style="font-weight:600;font-size:.9rem;">${escHtml(t.caseLabel||t.label||'')}</span>
        ${badge}
      </div>
      ${subInfo}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="font-size:.85rem;font-weight:600;">指派主責：</label>
        <select id="assign-sel-${t.id}" class="field-select" style="max-width:200px;">
          <option value="">—請選擇輔導人員—</option>
          ${buildCounselorOptgroups()}
        </select>
        <button class="btn btn-primary btn-sm" onclick="${confirmFn}('${t.id}')">確認派案</button>
      </div>
    </div>`;
  };

  let html = '';
  if (unread.length) {
    html += `<div style="font-weight:600;font-size:.88rem;color:#9c4221;margin-bottom:6px;">🔔 待派案（${unread.length} 件）</div>` + unread.map(renderCard).join('');
  }
  if (read.length) {
    html += `<details style="margin-top:${unread.length?'10px':'0'};">
      <summary style="font-weight:600;font-size:.85rem;color:#718096;cursor:pointer;padding:4px 0;">已讀派案（${read.length} 件）</summary>
      <div style="margin-top:6px;">${read.map(renderCard).join('')}</div>
    </details>`;
  }
  section.innerHTML = `<div style="background:#fffbeb;border:1px solid #f6ad55;border-radius:8px;padding:12px 16px;margin-bottom:14px;">${html}</div>`;

  // 還原已選值
  items.forEach(t => {
    const sel = document.getElementById('assign-sel-' + t.id);
    if (sel && t.assignedCounselor) sel.value = t.assignedCounselor;
  });
}

async function _confirmInternalTransfer(todoId) {
  const t = todosData.find(x => x.id === todoId);
  if (!t) return;
  const sel = document.getElementById('assign-sel-' + todoId);
  const counselorEmail = sel?.value || '';
  if (!counselorEmail) { alert('請選擇輔導人員後再確認轉案。'); return; }
  const cidx = casesData.findIndex(c => c.id === t.caseId);
  if (cidx === -1) { alert('找不到個案資料。'); return; }
  const counselorName = configData?.users?.[counselorEmail]?.name || counselorEmail;
  const sems = (Array.isArray(casesData[cidx].semesters) && casesData[cidx].semesters.length
    ? [...casesData[cidx].semesters] : [openDateToSemPrefix(casesData[cidx].openDate)].filter(Boolean)).sort();
  // 優先用建立 todo 當下記錄的目標學期（t.semester）；舊格式沒有此欄位才退回「最新學期」猜測
  const targetSem = t.semester || sems[sems.length - 1];
  const _semNote = targetSem ? `${semesterLabel(targetSem)}${t.semester ? '' : '（此待辦未記錄學期，推定為最新學期）'}` : '（無法判定學期）';
  if (!confirm(`確定將「${casesData[cidx].name}」轉派給 ${counselorName}？\n\n本次派案學期：${_semNote}`)) return;
  const _cardEl = document.getElementById('todo-card-' + todoId);
  if (_cardEl) { _cardEl.style.background='#c6f6d5'; _cardEl.style.borderColor='#68d391'; _cardEl.style.opacity='.7'; const _b=_cardEl.querySelector('.btn-primary'); if(_b){_b.disabled=true;_b.textContent='確認中…';} }
  // 只寫目標學期快照；目標為最新學期才動全案層級（#023 第二輪：改舊學期不得影響其他學期）
  _applyCounselorChange(casesData[cidx], targetSem, counselorEmail, counselorName);
  t.done = true; t.doneAt = new Date().toISOString(); t.assignedCounselor = counselorEmail; t.assignedCounselorName = counselorName;
  _syncTodoBadge();
  const jobId = bgJobAdd('確認內部轉案', casesData[cidx].name);
  try {
    await Promise.all([saveCasesChunks(t.caseId), saveUserTodos()]);
    bgJobDone(jobId);
    auditLog('確認內部轉案', t.caseId, null, `轉給 ${counselorName}`);
    renderCases();
    renderTodosPage();
  } catch (err) { bgJobFail(jobId, err.message); }
}

async function _confirmCaseAssignment(todoId) {
  const t = todosData.find(x => x.id === todoId);
  if (!t) return;
  const sel = document.getElementById('assign-sel-' + todoId);
  const counselorEmail = sel?.value || '';
  if (!counselorEmail) { alert('請選擇輔導人員後再確認派案。'); return; }
  const cidx = casesData.findIndex(c => c.id === t.caseId);
  if (cidx === -1) { alert('找不到個案資料。'); return; }
  const counselorName = configData?.users?.[counselorEmail]?.name || counselorEmail;
  const sems = (Array.isArray(casesData[cidx].semesters) && casesData[cidx].semesters.length
    ? [...casesData[cidx].semesters] : [openDateToSemPrefix(casesData[cidx].openDate)].filter(Boolean)).sort();
  // 優先用建立 todo 當下記錄的目標學期（t.semester，來自初次晤談表當時的學期）；舊格式沒有此欄位才退回「最新學期」猜測
  const targetSem = t.semester || sems[sems.length - 1];
  const _semNote2 = targetSem ? `${semesterLabel(targetSem)}${t.semester ? '' : '（此待辦未記錄學期，推定為最新學期）'}` : '（無法判定學期）';
  if (!confirm(`確定將「${casesData[cidx].name}」派案給 ${counselorName}？\n\n本次派案學期：${_semNote2}`)) return;
  const _cardEl2 = document.getElementById('todo-card-' + todoId);
  if (_cardEl2) { _cardEl2.style.background='#c6f6d5'; _cardEl2.style.borderColor='#68d391'; _cardEl2.style.opacity='.7'; const _b=_cardEl2.querySelector('.btn-primary'); if(_b){_b.disabled=true;_b.textContent='確認中…';} }
  // 更新個案主責：只寫目標學期快照；目標為最新學期才動全案層級（#023 第二輪）
  _applyCounselorChange(casesData[cidx], targetSem, counselorEmail, counselorName);
  // 標記 todo 完成
  t.done = true; t.doneAt = new Date().toISOString(); t.assignedCounselor = counselorEmail; t.assignedCounselorName = counselorName;
  _syncTodoBadge();
  // 背景儲存
  const jobId = bgJobAdd('確認派案', casesData[cidx].name);
  try {
    await Promise.all([saveCasesChunks(t.caseId), saveUserTodos()]);
    bgJobDone(jobId);
    auditLog('確認派案', t.caseId, null, `指派給 ${counselorName}`);
    renderCases();
    renderTodosPage();
  } catch (err) {
    bgJobFail(jobId, err.message);
  }
}
