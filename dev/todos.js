// dev/todos.js — 待辦事項（todos）基礎建設（載入/儲存/新增/完成、評估表待辦連動、
// 重大事件通知區塊、身心調適假通知批次確認）（拆 index.html 絞殺者第三十三刀，v280）。
// 內容為從 index.html 逐字搬出的連續區段。載入期副作用（column-0 複核）：僅 let/const
// 以字面值或 new Set() 初始化＋八個 window.* 函式賦值，無 DOM 操作、無監聽、無跨檔
// 初始化呼叫。可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  待辦事項（todos）基礎建設
// ══════════════════════════════════════════════

let todosData = [];
let _todosSnapshot = [];
let _todoFileId = null;
let _suppressedTodoRecordIds = new Set(); // recordIds whose todos were explicitly deleted
let _todosViewUser = null;    // null=自己, '__all__'=全部, email=特定人員
let _todosShowArchived = false;
let _adminTodosCache = {};    // email → todos[]
let _usersFolderIdCache = null;
// v280 拆檔唯一非逐字改動：原為頂層 const _USERS_FOLDER_LS_KEY = 'scc_users_folder_id_' + DRIVE_FOLDER_ID，
// 但 DRIVE_FOLDER_ID 是主 inline script 設定區的環境常數（deploy 自動置換，必須留在 index.html），
// 本檔先於主 script 載入、載入期取用會 ReferenceError，故改為惰性函式，各使用點同步改呼叫式。
function _usersFolderLsKey() { return 'scc_users_folder_id_' + DRIVE_FOLDER_ID; }

async function getUsersFolderId() {
  if (!_usersFolderIdCache) {
    const cached = localStorage.getItem(_usersFolderLsKey()) || null;
    // Validate: must be a real ID string, not "[object Object]" from a past bug
    if (cached && cached !== '[object Object]' && cached.length >= 10) {
      _usersFolderIdCache = cached;
    } else if (cached) {
      localStorage.removeItem(_usersFolderLsKey());
    }
  }
  if (!_usersFolderIdCache) {
    const q = `name='users' and mimeType='application/vnd.google-apps.folder' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`;
    const res = await driveQuery(q, 'id');
    if (res.files && res.files.length) {
      _usersFolderIdCache = res.files[0].id;
    } else {
      const folderResult = await driveCreateFolder('users', DRIVE_FOLDER_ID);
      _usersFolderIdCache = folderResult?.id || folderResult;
    }
    localStorage.setItem(_usersFolderLsKey(), _usersFolderIdCache);
  }
  return _usersFolderIdCache;
}

async function loadUserTodos() {
  const email = currentUser?.email;
  if (!email) return;
  try {
    const usersId = await getUsersFolderId();
    const envSuffix = DRIVE_FOLDER_ID.slice(-8);
    const newFileName = `todos_${email}_${envSuffix}.json`;
    const oldFileName = `todos_${email}.json`;
    // Try env-specific file first; fall back to legacy file (auto-migrates on next save)
    let q = `name='${newFileName}' and '${usersId}' in parents and trashed=false`;
    let res = await driveQuery(q, 'id');
    let isLegacy = false;
    if (!res.files?.length) {
      q = `name='${oldFileName}' and '${usersId}' in parents and trashed=false`;
      res = await driveQuery(q, 'id');
      isLegacy = true;
    }
    if (res.files && res.files.length) {
      _todoFileId = res.files[0].id;
      const raw = await driveReadJsonById(_todoFileId);
      todosData = Array.isArray(raw?.todos) ? raw.todos : [];
      _suppressedTodoRecordIds = new Set(Array.isArray(raw?.suppressedRecordIds) ? raw.suppressedRecordIds : []);
      const _prefs = raw?.caseSearchPrefs || {};
      if (_prefs.closureStatus !== undefined) _cnClosureStatus = _cnPrefToSet(_prefs.closureStatus);
      if (_prefs.archived !== undefined) _cnArchived = _cnPrefToSet(_prefs.archived);
      // Loaded from legacy file → clear file ID so saveUserTodos creates a new env-specific file。
      // 快照設空陣列：目標新檔尚無資料，下一次 save 需把目前全部 todos 當成 upserts 寫入新檔，
      // 否則若快照誤設為「與 todosData 相同」，diff 出的 upserts 會是空的，遷移將遺漏資料。
      if (isLegacy) { _todoFileId = null; _todosSnapshot = []; saveUserTodos().catch(() => {}); }
      else { _todosSnapshot = _deepClone(todosData); }
    } else {
      todosData = [];
      _suppressedTodoRecordIds = new Set();
      _todosSnapshot = [];
    }
    _cleanupOldTodos();
  } catch (e) {
    console.warn('loadUserTodos failed:', e);
    todosData = [];
    _todosSnapshot = [];
  }
}

async function _saveUserTodosFallback() {
  const email = currentUser?.email;
  if (!email) return;
  const envSuffix = DRIVE_FOLDER_ID.slice(-8);
  const fileName = `todos_${email}_${envSuffix}.json`;
  const content = { todos: todosData, suppressedRecordIds: [..._suppressedTodoRecordIds], caseSearchPrefs: { closureStatus: [..._cnClosureStatus], archived: [..._cnArchived] }, updatedAt: new Date().toISOString() };
  const usersId = await getUsersFolderId();
  if (!_todoFileId) {
    const q = `name='${fileName}' and '${usersId}' in parents and trashed=false`;
    const res = await driveQuery(q, 'id');
    if (res.files && res.files.length) _todoFileId = res.files[0].id;
  }
  if (_todoFileId) {
    try {
      await proxyCall('updateContentById', { fileId: _todoFileId, content });
    } catch (e) {
      // File ID stale; re-query or create
      _todoFileId = null;
      try {
        const q2 = `name='${fileName}' and '${usersId}' in parents and trashed=false`;
        const res2 = await driveQuery(q2, 'id');
        if (res2.files && res2.files.length) {
          _todoFileId = res2.files[0].id;
          await proxyCall('updateContentById', { fileId: _todoFileId, content });
        } else {
          const nf = await driveCreateJsonFile(fileName, content, usersId);
          if (nf?.id) _todoFileId = nf.id;
        }
      } catch (e2) {
        throw new Error(`saveUserTodos 失敗：${e2?.message || e2}（原因：${e?.message || e}）`);
      }
    }
  } else {
    const nf = await driveCreateJsonFile(fileName, content, usersId);
    if (nf?.id) _todoFileId = nf.id;
  }
  _todosSnapshot = _deepClone(todosData);
}
// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的待辦事項，經 listCommit 依 id upsert/remove，
// suppressedRecordIds/caseSearchPrefs/updatedAt 等非清單頂層欄位放 meta 一併送（只有檔案擁有者會帶 meta）。
// 後端未部署或無法安全 diff → fallback 走舊 updateContentById 整檔覆寫（含既有的 legacy 檔遷移邏輯）。
async function saveUserTodos() {
  const email = currentUser?.email;
  if (!email) return;
  const envSuffix = DRIVE_FOLDER_ID.slice(-8);
  const fileName = `todos_${email}_${envSuffix}.json`;
  const filePath = `users/${fileName}`;
  const diff = _diffListById(_todosSnapshot, todosData);
  if (!diff) { await _saveUserTodosFallback(); return; }
  const meta = { suppressedRecordIds: [..._suppressedTodoRecordIds], caseSearchPrefs: { closureStatus: [..._cnClosureStatus], archived: [..._cnArchived] }, updatedAt: new Date().toISOString() };
  const res = await _listCommit(filePath, { ...diff, meta });
  if (res && res.fallback) { await _saveUserTodosFallback(); return; }
  if (res && res.data && Array.isArray(res.data.todos)) {
    todosData = res.data.todos;
    _todosSnapshot = _deepClone(todosData);
  }
}

// 幫另一使用者（非目前登入者）附加一筆待辦——單筆 upsert，不帶 meta（避免覆寫對方的
// suppressedRecordIds/caseSearchPrefs；那些欄位只由檔案擁有者本人的 saveUserTodos() 維護）。
async function _appendTodoToUser(email, newTodo) {
  const envSuffix = DRIVE_FOLDER_ID.slice(-8);
  const fileName = `todos_${email}_${envSuffix}.json`;
  const filePath = `users/${fileName}`;
  const res = await _listCommit(filePath, { upserts: [newTodo] });
  if (!(res && res.fallback)) return;
  // 後端未部署（Unknown action）→ fallback 舊 RMW 路徑：讀最新→push→整檔寫回。
  // 修 bug：舊版 fallback 曾把讀到的 suppressedRecordIds/caseSearchPrefs 等頂層欄位整個丟掉
  // （content 只留 todos+updatedAt），改為保留原檔所有頂層欄位、只換 todos＋updatedAt。
  const usersId = await getUsersFolderId();
  const q = `name='${fileName}' and '${usersId}' in parents and trashed=false`;
  const q1 = await driveQuery(q, 'id');
  const fileId = q1.files?.[0]?.id || null;
  let raw = null;
  if (fileId) {
    try { raw = await driveReadJsonById(fileId); } catch(_) {}
  }
  const todos = Array.isArray(raw?.todos) ? [...raw.todos, newTodo] : [newTodo];
  const content = { ...(raw || {}), todos, updatedAt: new Date().toISOString() };
  if (fileId) {
    await proxyCall('updateContentById', { fileId, content });
  } else {
    await driveCreateJsonFile(fileName, content, usersId);
  }
}

function _cleanupDeletedEvals() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const c of casesData) {
    if (!Array.isArray(c.semesterEvaluations)) continue;
    const before = c.semesterEvaluations.length;
    c.semesterEvaluations = c.semesterEvaluations.filter(ev => {
      if (!ev.deletedAt) return true;
      return new Date(ev.deletedAt).getTime() > thirtyDaysAgo;
    });
    if (c.semesterEvaluations.length !== before) changed = true;
  }
  if (changed) renderCases();
}

function _cleanupOldTodos() {
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  todosData = todosData.filter(t => {
    if (t.done && t.doneAt) return new Date(t.doneAt).getTime() > twoWeeksAgo;
    return true;
  });
}

function _genTodoId() {
  return `todo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}

function _putTodoItem(item) {
  const idx = todosData.findIndex(t => t.id === item.id);
  if (idx >= 0) {
    const ex = todosData[idx];
    if (ex.archivedAt && !('archivedAt' in item))
      item = { ...item, archivedAt: ex.archivedAt };
    // 保留使用者手動標記的已完成狀態，避免 state-derived todo 重建時覆蓋
    if (ex.done && ex.doneAt && item.done === false)
      item = { ...item, done: true, doneAt: ex.doneAt };
    todosData[idx] = item;
  } else todosData.push(item);
  if (item.recordId) _suppressedTodoRecordIds.delete(item.recordId);
  _syncTodoBadge();
}

function _removeTodoItem(id) {
  todosData = todosData.filter(t => t.id !== id);
  _syncTodoBadge();
}

function _syncTodoBadge() {
  const pending = todosData.filter(t => !t.done && !(t.type === 'unclosed_reminder' && t.notifRead)).length;
  const badge = document.getElementById('todos-nav-badge');
  if (badge) {
    badge.textContent = pending > 99 ? '99+' : pending;
    badge.style.display = pending > 0 ? 'inline-flex' : 'none';
  }
  _syncBellBadge();
}

// v258：草稿引擎＋雲端備援＋待派案 todo 區塊拆到 dev/draft-engine.js（build 原樣複製）

// ── 同仁個案閱讀監督（危機閱讀 feed；主任/管理者/專任可見）──
function _accessAuditSeenKey() { return 'scc_access_audit_seen_' + DRIVE_FOLDER_ID.slice(-8); }
function _toggleAccessAudit() { window._accessAuditCollapsed = !window._accessAuditCollapsed; _renderCaseAccessAuditSection(); }
function _markAccessAuditSeen() { localStorage.setItem(_accessAuditSeenKey(), new Date().toISOString()); _renderCaseAccessAuditSection(); }
function _renderCaseAccessAuditSection() {
  const section = document.getElementById('todos-access-audit-section');
  if (!section) return;
  if (!_canViewAccessAudit()) { section.innerHTML = ''; return; }
  const entries = _accessLogEntries();
  if (!entries.length) { section.innerHTML = ''; return; }
  // 依 申請人|案|日期 分組：一組＝某人某日對某案的一次危機閱讀（授權 + 該次所有閱讀）
  const groups = {};
  entries.forEach(e => {
    const day = (e.t || '').slice(0, 10);
    const key = `${e.email}|${e.caseId}|${day}`;
    if (!groups[key]) groups[key] = { email: e.email, name: e.name, caseId: e.caseId, caseName: e.caseName || '', reason: '', grantT: '', reads: [], latest: '' };
    const g = groups[key];
    if (e.type === 'grant') { g.reason = e.reason || ''; g.grantT = e.t; if (!g.caseName) g.caseName = e.caseName || ''; }
    else if (e.type === 'read') g.reads.push(e);
    if ((e.t || '') > g.latest) g.latest = e.t || '';
    if (!g.caseName && e.caseName) g.caseName = e.caseName;
  });
  const list = Object.values(groups).sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
  const seenAt = localStorage.getItem(_accessAuditSeenKey()) || '';
  const unread = entries.filter(e => (e.t || '') > seenAt).length;
  const isCollapsed = !!window._accessAuditCollapsed;
  const showAll = !!window._accessAuditShowAll;
  const shown = showAll ? list : list.slice(0, 20);
  const fmtT = t => t ? new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const groupHtml = g => {
    const readsHtml = g.reads.sort((a, b) => (a.t || '').localeCompare(b.t || '')).map(r =>
      `<div style="font-size:.78rem;color:#4a5568;padding:2px 0 2px 14px;border-left:2px solid #e9d8fd;margin-left:4px;">
        → 閱讀 ${escHtml((r.blocks || []).map(b => _crisisBlockLabel(b.k) + '×' + b.n).join('、') || '（無資料區塊）')}${r.sem ? `（${escHtml(semesterLabel(r.sem))}）` : ''} <span style="color:#a0aec0;">${fmtT(r.t)}</span>
      </div>`).join('');
    return `<div style="padding:8px 0;border-top:1px solid #fed7d7;">
      <div style="font-size:.86rem;color:#2d3748;">
        <span style="font-weight:700;">${escHtml(g.name || g.email)}</span>
        申請閱讀 <span style="font-weight:600;">${escHtml(g.caseName || g.caseId)}</span>
        <span style="font-family:monospace;font-size:.76rem;color:#718096;">${escHtml(g.caseId)}</span>
        <span style="color:#a0aec0;font-size:.76rem;">${fmtT(g.grantT || g.latest)}</span>
      </div>
      <div style="font-size:.82rem;color:#9b2c2c;margin:2px 0 4px;">目的：${escHtml(g.reason || '（未填）')}</div>
      ${readsHtml || '<div style="font-size:.76rem;color:#a0aec0;padding-left:14px;">（尚未開啟閱讀）</div>'}
    </div>`;
  };
  section.innerHTML = `
    <div style="background:#fffaf0;border:1px solid #fbb6ce;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:.9rem;color:#97266d;">🚨 同仁個案閱讀監督（${list.length}）${unread > 0 ? ` <span class="badge" style="background:#e53e3e;color:#fff;font-size:.72rem;">${unread} 則新</span>` : ''}</span>
        <div style="display:flex;gap:6px;">
          ${unread > 0 ? `<button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;" onclick="_markAccessAuditSeen()">標示已讀</button>` : ''}
          <button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;background:#fff;" onclick="_toggleAccessAudit()">${isCollapsed ? '展開 ▼' : '收合 ▲'}</button>
        </div>
      </div>
      ${isCollapsed ? '' : `<div style="margin-top:8px;">
        ${shown.map(groupHtml).join('')}
        ${!showAll && list.length > shown.length ? `<div style="text-align:center;margin-top:8px;"><button class="btn btn-sm" style="font-size:.76rem;" onclick="window._accessAuditShowAll=true;_renderCaseAccessAuditSection()">顯示全部 ${list.length} 筆</button></div>` : ''}
      </div>`}
    </div>`;
}

// ── 非上班時間監督（同仁在非上班時間看/改個案時的完整 feed；主任/管理者/專任可見）──
// 點選案號：有檢視權限 → 個案詳細頁；無權限 → 案號查詢與管理帶入該案號
function _offHoursGoCase(caseId) {
  if (!caseId) return;
  const c = (casesData || []).find(x => x.id === caseId && !x.deleted);
  if (c && _caseNormallyAccessible(c)) { showCaseDetail(caseId); return; }
  showPage('page-casenums', document.querySelector('[data-nav-id="page-casenums"]'));
  _cnArchived = new Set(); _cnClosureStatus = new Set(); _cnCounselor = ''; _cnPage = 1;
  renderCaseNums(); // 確保頁面結構（含搜尋框）已建立
  const s = document.getElementById('cn-search');
  if (s) s.value = caseId;
  renderCaseNums(true);
}
function _offHoursSeenKey() { return 'scc_off_hours_seen_' + DRIVE_FOLDER_ID.slice(-8); }
function _toggleOffHoursSection() { window._offHoursSectionCollapsed = !window._offHoursSectionCollapsed; _renderOffHoursSection(); }
function _markOffHoursSeen() { localStorage.setItem(_offHoursSeenKey(), new Date().toISOString()); _renderOffHoursSection(); }
function _renderOffHoursSection() {
  const section = document.getElementById('todos-off-hours-section');
  if (!section) return;
  if (!_canViewAccessAudit()) { section.innerHTML = ''; return; }
  const entries = (_offHoursLogCache && Array.isArray(_offHoursLogCache.entries)) ? _offHoursLogCache.entries : [];
  if (!entries.length) { section.innerHTML = ''; return; }
  // 依 email|day 分組：一組 = 該同仁該日的所有非上班時間活動（登入 + 所有 case action）
  const groups = {};
  entries.forEach(e => {
    const day = (e.t || '').slice(0, 10);
    const key = `${e.email}|${day}`;
    if (!groups[key]) groups[key] = {
      email: e.email, name: e.name, day,
      isPriv: !!e.isPriv, currentRole: e.currentRole, extraRole: e.extraRole,
      loginT: '', actions: [], latest: '',
    };
    const g = groups[key];
    if (e.type === 'login') { if (!g.loginT || (e.t || '') < g.loginT) g.loginT = e.t || ''; if (e.currentRole) g.currentRole = e.currentRole; if (e.extraRole) g.extraRole = e.extraRole; }
    else if (e.type === 'case_action') g.actions.push(e);
    if ((e.t || '') > g.latest) g.latest = e.t || '';
    if (e.isPriv) g.isPriv = true;
  });
  const list = Object.values(groups).sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
  const seenAt = localStorage.getItem(_offHoursSeenKey()) || '';
  const unread = entries.filter(e => (e.t || '') > seenAt).length;
  const isCollapsed = !!window._offHoursSectionCollapsed;
  const showAll = !!window._offHoursShowAll;
  const shown = showAll ? list : list.slice(0, 20);
  const fmtT = t => t ? new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const _roleTag = g => {
    const parts = [];
    if (g.currentRole) parts.push(g.currentRole);
    if (g.extraRole)   parts.push(g.extraRole);
    return parts.length ? `<span style="font-size:.72rem;color:#553c9a;background:#e9d8fd;border-radius:8px;padding:1px 6px;margin-left:4px;">${escHtml(parts.join('・'))}</span>` : '';
  };
  const groupHtml = g => {
    const acts = g.actions.slice().sort((a, b) => (a.t || '').localeCompare(b.t || ''));
    const actsHtml = acts.map(a => {
      const detail = a.detail ? `：${escHtml(String(a.detail).slice(0, 80))}${String(a.detail).length > 80 ? '…' : ''}` : '';
      const caseTag = a.caseId
        ? `<span onclick="_offHoursGoCase('${escHtml(a.caseId)}')" data-tip="點選案號可前往個案詳細頁（無檢視權限時會改開「案號查詢與管理」呈現該案）" style="font-family:monospace;font-size:.74rem;color:#2b6cb0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${escHtml(a.caseName || '')}${a.caseName ? '（' : ''}${escHtml(a.caseId)}${a.caseName ? '）' : ''}</span>`
        : (a.caseName
          ? `<span style="font-family:monospace;font-size:.74rem;color:#4a5568;">${escHtml(a.caseName)}</span>`
          : '');
      return `<div style="font-size:.78rem;color:#4a5568;padding:2px 0 2px 14px;border-left:2px solid #d6bcfa;margin-left:4px;">
        → <span style="color:#553c9a;font-weight:600;">${escHtml(a.action)}</span>${detail} ${caseTag}
        <span style="color:#a0aec0;">${fmtT(a.t)}</span>
      </div>`;
    }).join('');
    const _privTags = [];
    if (g.currentRole === '主任') _privTags.push('主任');
    if (g.extraRole === '管理者') _privTags.push('系統管理者');
    if (!_privTags.length && g.isPriv) _privTags.push('主任／系統管理者'); // 保底：當天缺登入事件、role 欄位未知時仍標示為特權
    const privBadge = _privTags.map(t => `<span style="font-size:.7rem;color:#c05621;background:#fed7aa;border-radius:8px;padding:1px 6px;margin-left:6px;">${escHtml(t)}</span>`).join('');
    return `<div style="padding:8px 0;border-top:1px solid #e9d8fd;">
      <div style="font-size:.86rem;color:#2d3748;">
        <span style="font-weight:700;">${escHtml(g.name || g.email)}</span>${_roleTag(g)}${privBadge}
        <span style="color:#a0aec0;font-size:.76rem;margin-left:6px;">${escHtml(g.day)}${g.loginT ? `　登入 ${fmtT(g.loginT)}` : ''}</span>
      </div>
      ${actsHtml || '<div style="font-size:.76rem;color:#a0aec0;padding-left:14px;">（僅登入，未進行個案動作）</div>'}
    </div>`;
  };
  section.innerHTML = `
    <div style="background:#faf5ff;border:1px solid #d6bcfa;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;cursor:pointer;" onclick="if(!event.target.closest('button'))_toggleOffHoursSection()">
        <span style="font-weight:700;font-size:.9rem;color:#553c9a;">🌙 非上班時間監督（${list.length}）${unread > 0 ? ` <span class="badge" style="background:#e53e3e;color:#fff;font-size:.72rem;">${unread} 則新</span>` : ''}</span>
        <div style="display:flex;gap:6px;">
          ${unread > 0 ? `<button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;" onclick="_markOffHoursSeen()">標示已讀</button>` : ''}
          <button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;background:#fff;" onclick="_toggleOffHoursSection()">${isCollapsed ? '展開 ▼' : '收合 ▲'}</button>
        </div>
      </div>
      ${isCollapsed ? '' : `<div style="margin-top:8px;">
        ${shown.map(groupHtml).join('')}
        ${!showAll && list.length > shown.length ? `<div style="text-align:center;margin-top:8px;"><button class="btn btn-sm" style="font-size:.76rem;" onclick="window._offHoursShowAll=true;_renderOffHoursSection()">顯示全部 ${list.length} 筆</button></div>` : ''}
      </div>`}
    </div>`;
}

// ── GC 事件錯誤區塊（主任/管理者/專任可見）──
function _gcErrorsSeenKey() { return 'scc_gc_errors_seen_' + DRIVE_FOLDER_ID.slice(-8); }
function _toggleGcErrorsSection() { window._gcErrorsCollapsed = !window._gcErrorsCollapsed; _renderGcErrorsSection(); }
function _markGcErrorsSeen() { localStorage.setItem(_gcErrorsSeenKey(), new Date().toISOString()); _renderGcErrorsSection(); }
function _renderGcErrorsSection() {
  const section = document.getElementById('todos-gc-errors-section');
  if (!section) return;
  if (!_canViewAccessAudit()) { section.innerHTML = ''; return; }
  const entries = (_gcErrorsCache && Array.isArray(_gcErrorsCache.entries)) ? _gcErrorsCache.entries : [];
  const ignoredList = (_gcErrorsCache && Array.isArray(_gcErrorsCache.ignored)) ? _gcErrorsCache.ignored : [];
  if (!entries.length && !ignoredList.length) { section.innerHTML = ''; return; }
  const kindLabel = { MISSING_SERIAL:'缺流水號', MISSING_CREATOR:'缺建立者註記', BAD_TITLE:'標題格式錯誤',
    UNKNOWN_ROOM:'未知空間', UNKNOWN_COUNSELOR:'未知輔導人員', UNMATCHED:'無對應學諮資訊系統預約' };
  const kindColor = { MISSING_SERIAL:'#dd6b20', MISSING_CREATOR:'#3182ce', BAD_TITLE:'#e53e3e',
    UNKNOWN_ROOM:'#9333ea', UNKNOWN_COUNSELOR:'#c026d3', UNMATCHED:'#c05621' };
  // 新1：改以「事件」為主體分組——每個 GC 事件一個區塊，下方列出它的多個缺失標籤
  const byEvent = {};
  entries.forEach(e => {
    if (!byEvent[e.eventId]) byEvent[e.eventId] = { eventId: e.eventId, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, creators: e.creators, kinds: [], t: e.t || '' };
    const g = byEvent[e.eventId];
    g.kinds.push({ kind: e.kind, id: e.id });
    if ((e.t || '') > g.t) g.t = e.t;
    if (!g.title && e.title) g.title = e.title;
    if (!g.date && e.date) g.date = e.date;
  });
  const events = Object.values(byEvent).sort((a, b) => (b.t || '').localeCompare(a.t || ''));
  const seenAt = localStorage.getItem(_gcErrorsSeenKey()) || '';
  const unread = entries.filter(e => (e.t || '') > seenAt).length;
  const isCollapsed = !!window._gcErrorsCollapsed;
  const fmtT = t => t ? new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const eventHtml = ev => {
    const unmatched = ev.kinds.find(k => k.kind === 'UNMATCHED');
    const tags = ev.kinds.map(k => `<span style="background:${kindColor[k.kind]||'#c53030'}22;color:${kindColor[k.kind]||'#c53030'};border-radius:6px;padding:1px 7px;font-size:.72rem;font-weight:600;margin:1px 4px 1px 0;display:inline-block;">${escHtml(kindLabel[k.kind]||k.kind)}</span>`).join('');
    return `<div style="padding:8px 0;border-top:1px solid #fcd34d;">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:.85rem;color:#4a5568;">${escHtml(ev.title || '(無標題)')}</span>
        <span style="color:#a0aec0;font-size:.76rem;">${escHtml(ev.date||'')} ${escHtml((ev.startTime||'').slice(0,5))}–${escHtml((ev.endTime||'').slice(0,5))}</span>
        ${ev.creators?.[0] ? `<span style="color:#718096;font-family:monospace;font-size:.7rem;">建立者：${escHtml(ev.creators[0])}</span>` : ''}
        <span style="color:#a0aec0;font-size:.72rem;">${fmtT(ev.t)}</span>
        <span style="margin-left:auto;display:inline-flex;gap:4px;white-space:nowrap;">
          <button class="btn btn-sm" style="font-size:.68rem;padding:1px 6px;" data-tip="在 Google 日曆開啟此事件" onclick="_gcOpenEvent('${escHtml(ev.eventId)}')">🔗</button>
          ${unmatched ? `<button class="btn btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="_gcImportAsBooking('${escHtml(unmatched.id)}')">匯入為預約</button>` : ''}
          <button class="btn btn-sm" style="font-size:.68rem;padding:1px 6px;" data-tip="不再於待確認清單顯示此事件" onclick="_gcIgnoreEventAll('${escHtml(ev.eventId)}')">忽略</button>
        </span>
      </div>
      <div style="margin-top:4px;padding-left:2px;font-size:.76rem;color:#718096;">缺失（${ev.kinds.length}）：${tags}</div>
      ${unmatched ? _gcUnmatchedRowExtra({ id: unmatched.id, eventId: ev.eventId, title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime }) : ''}
    </div>`;
  };
  const isIgnoredCollapsed = window._gcIgnoredCollapsed !== false;
  const ignoredHtml = !ignoredList.length ? '' : `<div style="margin-top:10px;border-top:1px dashed #d69e2e;padding-top:8px;">
      <div style="cursor:pointer;font-size:.8rem;color:#92400e;font-weight:600;" onclick="window._gcIgnoredCollapsed = !window._gcIgnoredCollapsed; _renderGcErrorsSection();">
        ${isIgnoredCollapsed ? '▶' : '▼'} 已忽略（${ignoredList.length}）
      </div>
      ${isIgnoredCollapsed ? '' : `<div style="margin-top:6px;">
        ${ignoredList.map(x => `<div style="font-size:.76rem;color:#718096;padding:2px 0 2px 14px;">
          → <span style="font-weight:600;">${escHtml(x.title || '(無標題)')}</span>
          <span style="margin-left:6px;">${escHtml(kindLabel[x.kind]||x.kind)}</span>
          <span style="margin-left:6px;color:#a0aec0;">${escHtml(x.byName||x.by||'')}　${fmtT(x.at)}</span>
          <button class="btn btn-sm" style="font-size:.68rem;padding:1px 6px;margin-left:8px;" onclick="_gcUnignoreEvent('${escHtml(x.eventId)}','${escHtml(x.kind)}')">取消忽略</button>
        </div>`).join('')}
      </div>`}
    </div>`;
  section.innerHTML = `
    <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:.9rem;color:#92400e;">📋 Google 日曆事件待確認（${events.length} 個事件）${unread > 0 ? ` <span class="badge" style="background:#e53e3e;color:#fff;font-size:.72rem;">${unread} 則新</span>` : ''}</span>
        <div style="display:flex;gap:6px;">
          ${unread > 0 ? `<button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;" onclick="_markGcErrorsSeen()">標示已讀</button>` : ''}
          <button class="btn btn-sm" style="font-size:.76rem;padding:2px 10px;background:#fff;" onclick="_toggleGcErrorsSection()">${isCollapsed ? '展開 ▼' : '收合 ▲'}</button>
        </div>
      </div>
      ${isCollapsed ? '' : `<div style="margin-top:8px;">${events.slice(0, 40).map(eventHtml).join('')}${events.length > 40 ? `<div style="font-size:.72rem;color:#a0aec0;padding-top:6px;">…另 ${events.length - 40} 個事件</div>` : ''}${ignoredHtml}</div>`}
    </div>`;
}

// ── 忽略 / 取消忽略 GC 待確認事件 ──
async function _gcIgnoreEvent(entryId) {
  const entries = _gcErrorsCache?.entries || [];
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx < 0) return;
  const e = entries[idx];
  if (!Array.isArray(_gcErrorsCache.ignored)) _gcErrorsCache.ignored = [];
  _gcErrorsCache.ignored.push({
    eventId: e.eventId, kind: e.kind, title: e.title || '',
    by: currentUser?.email || '',
    byName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
    at: new Date().toISOString(),
  });
  entries.splice(idx, 1);
  await _saveGcErrorsCache();
  const kindLabel = { MISSING_SERIAL:'缺流水號', MISSING_CREATOR:'缺建立者註記', BAD_TITLE:'標題格式錯誤',
    UNKNOWN_ROOM:'未知空間', UNKNOWN_COUNSELOR:'未知輔導人員', UNMATCHED:'無對應學諮資訊系統預約' };
  auditLog('忽略GC待確認事件', null, null, `${kindLabel[e.kind]||e.kind}：${e.title||''}`);
  _renderGcErrorsSection();
}
// 新1：以事件為主體 → 一次忽略某事件的全部缺失標籤
async function _gcIgnoreEventAll(eventId) {
  const entries = _gcErrorsCache?.entries || [];
  const toIgnore = entries.filter(e => e.eventId === eventId);
  if (!toIgnore.length) return;
  if (!confirm('確定忽略此事件？此事件的所有缺失都不再於待確認清單顯示。')) return;
  if (!Array.isArray(_gcErrorsCache.ignored)) _gcErrorsCache.ignored = [];
  const now = new Date().toISOString();
  toIgnore.forEach(e => _gcErrorsCache.ignored.push({
    eventId: e.eventId, kind: e.kind, title: e.title || '',
    by: currentUser?.email || '', byName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '', at: now,
  }));
  _gcErrorsCache.entries = entries.filter(e => e.eventId !== eventId);
  await _saveGcErrorsCache();
  auditLog('忽略GC待確認事件', null, null, `${toIgnore[0].title || ''}（${toIgnore.length} 項缺失）`);
  _renderGcErrorsSection();
}
async function _gcUnignoreEvent(eventId, kind) {
  if (!Array.isArray(_gcErrorsCache?.ignored)) return;
  const before = _gcErrorsCache.ignored.length;
  _gcErrorsCache.ignored = _gcErrorsCache.ignored.filter(x => !(x.eventId === eventId && x.kind === kind));
  if (_gcErrorsCache.ignored.length === before) return;
  await _saveGcErrorsCache();
  _renderGcErrorsSection();
}

// ── 將 UNMATCHED GC 事件匯入為系統預約 ──
async function _gcImportAsBooking(entryId) {
  const entry = (_gcErrorsCache?.entries || []).find(e => e.id === entryId);
  if (!entry) return;
  const jobId = bgJobAdd('匯入 Google 日曆事件為預約', entry.title || '');
  try {
    const dayEvents = await proxyCall('listCalendarEvents', { startDate: entry.date, endDate: entry.date });
    const ev = Array.isArray(dayEvents) ? dayEvents.find(x => x.id === entry.eventId) : null;
    if (!ev) {
      alert('此 Google 日曆事件已不存在，已從待確認清單移除。');
      _gcErrorsCache.entries = (_gcErrorsCache.entries || []).filter(e => e.id !== entryId);
      await _saveGcErrorsCache();
      _renderGcErrorsSection();
      bgJobDone(jobId);
      return;
    }
    const parsed = _parseBkGcTitle(ev.title) || { room: ev.title || '', counselors: [], counselorName: '', counselorEmail: '' };
    // 解析備註（同 syncFromCalendar 對 description 的解析：去掉結尾 #serial 與 \n---\n 之後的系統行）
    const _rawDesc = ev.description || '';
    let notes = '';
    const _serialMatch = _rawDesc.match(/\n#(\d+)\s*$/);
    if (_serialMatch) {
      let _body = _rawDesc.slice(0, _rawDesc.length - _serialMatch[0].length);
      const _sepIdx = _body.lastIndexOf('\n---\n');
      if (_sepIdx >= 0) _body = _body.slice(0, _sepIdx);
      notes = _body.trim();
    } else {
      const _sepIdx = _rawDesc.lastIndexOf('\n---\n');
      notes = (_sepIdx >= 0 ? _rawDesc.slice(0, _sepIdx) : _rawDesc).trim();
    }
    const room = parsed.room || '';
    const counselorName = parsed.counselorName || '';
    const confirmMsg = `確定將此 Google 日曆事件匯入為系統預約？\n\n空間：${room || '（無）'}\n日期：${ev.date}\n時間：${(ev.startTime||'').slice(0,5)}–${(ev.endTime||'').slice(0,5)}\n人員：${counselorName || '（無）'}`;
    if (!confirm(confirmMsg)) { bgJobDone(jobId); return; }
    const myName = configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '';
    const now = new Date().toISOString();
    const bk = {
      id: 'bk_' + Date.now(),
      bkSerial: _bkNextSerial(),
      room, customRoom: '',
      date: ev.date, startTime: ev.startTime, endTime: ev.endTime,
      counselors: parsed.counselors || [], counselorEmail: parsed.counselorEmail || '', counselorName,
      caseId: '', caseName: '',
      notes,
      createdAt: now, updatedAt: now, creatorName: myName,
      calendarEventId: ev.id,
    };
    // 此路徑事件已存在於 GC（匯入既有事件），bkCommit 只負責併發安全寫入 bookings.json，不重複建立/覆蓋 GC 事件
    const _importResult = await bkCommit([{ op: 'upsert', booking: { ...bk }, gc: { mode: 'none' } }], { checkConflicts: false });
    if (_importResult.fallback) {
      bookingsData.push(bk);
      await saveBookings();
    } else if (!_importResult.error) {
      const fb = (_importResult.bookings || []).find(x => x.id === bk.id);
      bookingsData.push(fb || bk);
    } else {
      bookingsData.push(bk); // 理論上不會有 conflict（checkConflicts:false），保底仍寫入本機
    }
    bgJobProgress(jobId, 70);
    try {
      await proxyCall('updateCalendarEvent', {
        eventId: ev.id, room: bk.room, customRoom: bk.customRoom || '',
        date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
        counselorName: bk.counselorName || '', notes: bk.notes || '',
        creatorName: bk.creatorName || bk.counselorName || '',
        createdAt: bk.createdAt, updatedAt: bk.updatedAt, isEdit: false, bkSerial: bk.bkSerial,
        colorId: _bkGcColorId(bk) });
    } catch (_) {}
    // 匯入＋回寫後，該事件的所有錯誤 kind 都應消失
    _gcErrorsCache.entries = (_gcErrorsCache.entries || []).filter(e => e.eventId !== ev.id);
    await _saveGcErrorsCache();
    auditLog('Google日曆事件匯入為預約', null, null, `${room||'（無）'}　${ev.date}　${(ev.startTime||'').slice(0,5)}–${(ev.endTime||'').slice(0,5)}${counselorName?'　'+counselorName:''}`);
    _renderGcErrorsSection();
    renderBookingsPage?.();
    bgJobDone(jobId);
  } catch (e) {
    bgJobFail(jobId, e.message);
    alert('匯入失敗：' + e.message);
  }
}

// ── #5-7：UNMATCHED（無對應學諮資訊系統預約）孤兒事件——找疑似對應的既有預約供使用者連結 ──
// 判斷依據：同日期＋開始/結束時間有重疊＋（標題解析出的人名與該預約主責/人員相符其一，
// 標題解析不到人名則僅憑時間/空間比對，寬鬆處理）。由於 entry 本身即代表「無 booking 的
// calendarEventId 指向此事件」，找到的候選必然尚未綁定此 eventId；優先挑完全沒有 calendarEventId
// 的（真正孤兒），其次才挑已綁別的事件者（提示可能是重複事件）。
function _gcFindProbableMatch(entry) {
  if (!entry?.date || !entry?.startTime || !entry?.endTime) return null;
  const parsed = _parseBkGcTitle(entry.title) || {};
  const names = new Set((parsed.counselors || []).map(c => c.label).filter(Boolean));
  const candidates = (bookingsData || []).filter(b => {
    if (b.date !== entry.date) return false;
    if (!(b.startTime < entry.endTime && b.endTime > entry.startTime)) return false;
    if (!names.size) return true;
    const bNames = new Set([
      ...(b.counselors || []).map(c => c.name || c.label).filter(Boolean),
      ...(b.counselorName ? b.counselorName.split(',').map(s => s.trim()).filter(Boolean) : []),
    ]);
    return [...names].some(n => bNames.has(n));
  });
  if (!candidates.length) return null;
  return candidates.find(b => !b.calendarEventId) || candidates[0];
}
// 待確認清單裡 UNMATCHED 那一筆下方的「疑似對應」子區塊（含連結按鈕）
function _gcUnmatchedRowExtra(e) {
  const m = _gcFindProbableMatch(e);
  if (!m) return '';
  const mRoom = m.room === '其他' ? (m.customRoom || '其他') : (m.room || '');
  const dupWarn = m.calendarEventId
    ? '　<span style="color:#c05621;">⚠ 該預約已連結另一日曆事件，連結後原連結將變成未綁定，若為重複事件請至 Google 日曆刪除</span>'
    : '';
  return `<div style="font-size:.74rem;color:#2f855a;padding:2px 0 2px 10px;margin-top:2px;">
    ↳ 疑似對應：${escHtml(mRoom)} ${escHtml(m.date||'')} ${escHtml((m.startTime||'').slice(0,5))}–${escHtml((m.endTime||'').slice(0,5))} ${escHtml(m.counselorName||'')}${dupWarn}
    <button class="btn btn-sm" id="gc-link-btn-${escHtml(e.id)}" style="font-size:.68rem;padding:1px 6px;margin-left:6px;" onclick="_gcLinkProbableMatch('${escHtml(e.id)}','${escHtml(m.id)}')">連結到此預約</button>
  </div>`;
}
// 將 UNMATCHED GC 事件連結到既有預約：改寫該預約的 calendarEventId 指向此事件（gc mode 'none'，
// 不動 GC 事件本身），並從待確認清單移除該筆。
async function _gcLinkProbableMatch(entryId, bookingId) {
  const entry = (_gcErrorsCache?.entries || []).find(e => e.id === entryId);
  const bk = bookingsData.find(b => b.id === bookingId);
  if (!entry || !bk) return;
  const roomD = bk.room === '其他' ? (bk.customRoom || '其他') : (bk.room || '');
  let msg = `確定將此 Google 日曆事件連結到系統預約？\n\n${roomD}　${bk.date}　${(bk.startTime||'').slice(0,5)}–${(bk.endTime||'').slice(0,5)}${bk.counselorName ? '　'+bk.counselorName : ''}`;
  if (bk.calendarEventId) {
    msg += `\n\n⚠ 此預約原本已連結另一個日曆事件，連結後原事件將變成未綁定，若為重複事件請至 Google 日曆刪除。`;
  }
  if (!confirm(msg)) return;
  // 操作回饋：按鈕即時鎖定顯示進度，成功後 toast 明確告知（清單重繪後該筆會消失）
  const _btn = document.getElementById('gc-link-btn-' + entryId);
  if (_btn) { _btn.disabled = true; _btn.textContent = '連結中…'; }
  const jobId = bgJobAdd('連結 Google 日曆事件到預約', `${roomD} ${bk.date}`);
  try {
    const updated = { ...bk, calendarEventId: entry.eventId };
    const result = await bkCommit([{ op: 'upsert', booking: { ...updated }, gc: { mode: 'none' } }], { checkConflicts: false });
    if (result.fallback) {
      const idx = bookingsData.findIndex(x => x.id === bk.id);
      if (idx >= 0) bookingsData[idx] = updated;
      await saveBookings();
    } else if (!result.error) {
      const fb = (result.bookings || []).find(x => x.id === bk.id);
      const idx = bookingsData.findIndex(x => x.id === bk.id);
      if (idx >= 0) bookingsData[idx] = fb || updated;
    } else {
      const idx = bookingsData.findIndex(x => x.id === bk.id);
      if (idx >= 0) bookingsData[idx] = updated; // 理論上不會有 conflict（checkConflicts:false），保底仍寫入本機
    }
    _gcErrorsCache.entries = (_gcErrorsCache.entries || []).filter(e => e.id !== entryId);
    await _saveGcErrorsCache();
    auditLog('連結Google日曆孤兒事件到預約', bk.caseId || null, null, `${roomD}　${bk.date}　${(bk.startTime||'').slice(0,5)}–${(bk.endTime||'').slice(0,5)}`);
    _renderGcErrorsSection();
    renderBookingsPage?.();
    bgJobDone(jobId);
    showToast(`✅ 已連結到預約：${roomD}　${bk.date}　${(bk.startTime||'').slice(0,5)}–${(bk.endTime||'').slice(0,5)}，此事件已從待確認清單移除`, 'success');
  } catch (e) {
    if (_btn) { _btn.disabled = false; _btn.textContent = '連結到此預約'; }
    bgJobFail(jobId, e.message);
    alert('連結失敗：' + e.message);
  }
}

// ── 於 Google 日曆開啟指定事件 ──
async function _gcOpenEvent(eventId) {
  try {
    if (!window._gcCalendarMeta) {
      const meta = await proxyCall('getCalendarMeta', {});
      if (!meta?.calendarId) { alert('無法取得日曆資訊，請確認 Apps Script 已部署最新版本。'); return; }
      window._gcCalendarMeta = meta;
    }
    const calendarId = window._gcCalendarMeta.calendarId;
    const eid = btoa(eventId.replace(/@google\.com$/, '') + ' ' + calendarId).replace(/=+$/, '');
    window.open('https://calendar.google.com/calendar/event?eid=' + eid, '_blank');
  } catch (e) {
    alert('開啟失敗：' + e.message);
  }
}

function _renderMlNotifSection() {
  const section = document.getElementById('todos-ml-notif-section');
  if (!section) return;
  const _isAdm = currentRole === '主任' || extraRole === '管理者';
  const _isContactOnly = isMentalLeaveContact && !_isAdm;
  const items = _mlUnacknowledgedForMe();
  if (!items.length) { section.innerHTML = ''; return; }
  const isCollapsed = !!window._mlSectionCollapsed;
  const _renderItem = l => {
    const mc = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
    const dateStr = (l.receivedAt || '').slice(0, 10);
    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-top:1px solid #c6f6d5;">
      <input type="checkbox" class="ml-notif-cb" data-id="${escHtml(l.id)}" style="margin-top:3px;flex-shrink:0;" onchange="_mlUpdateBatchBtn()">
      <div style="flex:1;min-width:0;">
        <span style="font-weight:600;color:#2d3748;">${escHtml(l.name||l.studentId)}</span>
        <span style="font-size:.78rem;color:#718096;margin-left:6px;">${escHtml(l.studentId||'')}</span>
        ${dateStr ? `<span style="font-size:.78rem;color:#718096;margin-left:4px;">${dateStr}</span>` : ''}
        <div style="font-size:.82rem;color:#4a5568;margin-top:2px;">${escHtml((l.reason||'').slice(0,60))}${(l.reason||'').length>60?'…':''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        ${mc ? `<button onclick="showCaseDetail('${escHtml(mc.id)}')" style="padding:3px 10px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;">前往個案</button>` : ''}
        <button onclick="window._mlAcknowledge('${escHtml(l.id)}')" style="padding:3px 10px;background:#276749;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;" data-tip="封存此通知，表示已確認此筆身心調適假">📦 封存</button>
      </div>
    </div>`;
  };
  let displayItems, titleText;
  if (_isContactOnly) {
    const myIds = _getMyCaseStudentIds();
    displayItems = items.filter(l => myIds.has(l.studentId));
    titleText = `🌿 身心調適假通知 共新增 ${items.length} 名`;
  } else {
    displayItems = items;
    titleText = `🌿 身心調適假待確認（${items.length} 筆）`;
  }
  section.innerHTML = `
    <div style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${!isCollapsed && displayItems.length ? '4px' : '0'};cursor:pointer;" onclick="if(!event.target.closest('button,input,label'))_mlToggleSection()" data-tip="${isCollapsed?'展開':'收束'}身心調適假區塊">
        <div style="font-weight:700;color:#276749;font-size:.95rem;">${titleText}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${!isCollapsed ? `<label style="font-size:.8rem;color:#276749;cursor:pointer;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="ml-cb-all" onchange="_mlToggleAllCb(this)">全選</label>
          <button id="ml-batch-btn" class="btn btn-sm" style="display:none;font-size:.78rem;background:#276749;color:#fff;border-color:#276749;" onclick="_mlBatchAcknowledge()">📦 批次封存</button>` : ''}
          <button onclick="_mlToggleSection()" style="background:none;border:none;cursor:pointer;font-size:.88rem;color:#276749;padding:0 2px;" data-tip="${isCollapsed?'展開':'收束'}身心調適假區塊">${isCollapsed?'▶':'▼'}</button>
        </div>
      </div>
      ${!isCollapsed ? `<div id="ml-notif-items">${displayItems.map(_renderItem).join('')}</div>` : ''}
    </div>`;
}

window._mlToggleSection = function() {
  window._mlSectionCollapsed = !window._mlSectionCollapsed;
  _renderMlNotifSection();
};

// 待辦頁「重大事件」區塊：拉通知中的重大類型顯示（如 Gmail 變更、非上班時間活動）
// 資料來源與鈴鐺同一份（_myNotifs()，v154 起為獨立 notifications.json），無需額外 Drive 寫入
const MAJOR_EVENT_NOTIF_TYPES = new Set(['gmail_changed', 'off_hours_activity', 'email_change_request']);
// 空間預約成功兩類原列於重大事件；2026-07-08 依使用者需求降級為獨立的一般通知卡
// （沒這麼嚴重），資料來源與「收到」即封存機制不變，只換呈現位置與視覺
const BOOKING_NOTIF_TYPES = new Set(['booking_created_self', 'booking_created_broadcast']);
const MAJOR_EVENT_TYPE_LABELS = {
  gmail_changed:        '重大事件・Gmail 變更',
  off_hours_activity:   '重大事件・非上班時間活動',
  email_change_request: '申請事項・Email 更改申請',
  booking_created_self:      '空間預約・預約成功',
  booking_created_broadcast: '空間預約・他人為你建立',
};
// #5-1／#30：「收到」＝使用者已知悉，點一下就直接不再顯示（不像單純「標記已讀」還會維持已讀
// 7 天可回顧稽核）；未來若有其他重大事件也想要「收到即消失」，加進這個 Set 共用同一套機制即可。
// #30 定案（2026-07-08）：gmail_changed／off_hours_activity 預設維持「標記已讀後保留 7 天回顧」
// （主任/專任可事後於待辦頁回顧稽核），另提供每位使用者可自行切換的「收到後立即封存」偏好
// （localStorage，跟其他 scc_* 檢視偏好一樣屬個人裝置設定）；預約成功兩類則一律收到即封存。
// 無論何種設定，off_hours_log.json（feed 全量保留）／audit_log.json（major:true）都可追查。
const MAJOR_EVENT_DISMISS_ON_READ = new Set(['booking_created_self', 'booking_created_broadcast']);
const MAJOR_EVENT_OPTIONAL_DISMISS = new Set(['gmail_changed', 'off_hours_activity', 'email_change_request']);
function _majorEventDismissPref() { try { return localStorage.getItem('scc_major_dismiss_on_read') === '1'; } catch { return false; } }
function _majorEventDismissOnRead(type) {
  return MAJOR_EVENT_DISMISS_ON_READ.has(type) || (MAJOR_EVENT_OPTIONAL_DISMISS.has(type) && _majorEventDismissPref());
}
function _renderMajorEventNotifs() {
  const section = document.getElementById('todos-major-events-section');
  if (!section) return;
  // 僅在檢視自己的待辦時顯示
  const viewingOwn = !_todosViewUser || _todosViewUser === currentUser?.email;
  if (!viewingOwn) { section.innerHTML = ''; return; }
  const allNotifs = _myNotifs();
  const notifs = allNotifs.filter(n =>
    MAJOR_EVENT_NOTIF_TYPES.has(n.type) && !(n.read && _majorEventDismissOnRead(n.type)));
  const bkNotifs = allNotifs.filter(n => BOOKING_NOTIF_TYPES.has(n.type) && !n.read); // 收到即封存
  const pending = notifs.filter(n => !n.read);
  if (!notifs.length && !bkNotifs.length) { section.innerHTML = ''; return; }
  const isCollapsed = !!window._majorEventsCollapsed;
  const _fmt = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  };
  // theme：紫（重大事件）／藍（空間預約），項目與「收到」按鈕共用同一套標記已讀機制
  const _renderItem = (n, th) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-top:1px solid ${th.line};${n.read?'opacity:.6;':''}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.72rem;color:${th.fg};background:${th.chipBg};border-radius:3px;padding:0 5px;display:inline-block;font-weight:700;">${escHtml(MAJOR_EVENT_TYPE_LABELS[n.type] || '重大事件')}</div>
        <div style="font-size:.86rem;color:#2d3748;margin-top:4px;line-height:1.5;">${escHtml(n.message || '')}</div>
        <div style="font-size:.74rem;color:#718096;margin-top:3px;">
          ${_fmt(n.createdAt)}${n.actorName ? `　・操作者：${escHtml(n.actorName)}` : ''}${n.read && n.readAt ? `　・已讀 ${_fmt(n.readAt)}` : ''}
        </div>
      </div>
      ${!n.read ? `<button onclick="_majorEventMarkRead('${escHtml(n.id)}')" style="padding:3px 10px;background:${th.fg};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;flex-shrink:0;" data-tip="${_majorEventDismissOnRead(n.type) ? '收到後即不再顯示' : '標記為已讀；7 天後自動移除'}">${_majorEventDismissOnRead(n.type) ? '收到' : '標記已讀'}</button>` : ''}
    </div>`;
  const _thMajor = { fg: '#553c9a', chipBg: '#e9d8fd', line: '#e9d8fd' };
  const _thBk    = { fg: '#2b6cb0', chipBg: '#bee3f8', line: '#bee3f8' };
  const titleText = pending.length
    ? `⚠ 重大事件通知（${pending.length} 筆未讀 / 共 ${notifs.length}）`
    : `重大事件通知（${notifs.length} 筆，皆已讀）`;
  const majorCard = notifs.length ? `
    <div style="background:#faf5ff;border:1px solid #d6bcfa;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${!isCollapsed && notifs.length ? '4px' : '0'};cursor:pointer;" onclick="_majorEventsToggle()" data-tip="${isCollapsed?'展開':'收起'}重大事件區塊">
        <div style="font-weight:700;color:#553c9a;font-size:.95rem;">${titleText}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${!isCollapsed && pending.length ? `<button onclick="event.stopPropagation();_majorEventMarkAllRead()" style="padding:2px 10px;font-size:.78rem;background:#fff;border:1px solid #b794f4;border-radius:4px;color:#553c9a;cursor:pointer;">全部標為已讀</button>` : ''}
          <button style="background:none;border:none;cursor:pointer;font-size:.88rem;color:#553c9a;padding:0 2px;">${isCollapsed?'▶':'▼'}</button>
        </div>
      </div>
      ${!isCollapsed ? `<div>${notifs.map(n => _renderItem(n, _thMajor)).join('')}</div>
      <div style="border-top:1px solid #e9d8fd;margin-top:6px;padding-top:8px;">
        <label style="font-size:.76rem;color:#718096;cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:5px;" data-tip="僅影響 Gmail 變更／非上班時間活動兩類；空間預約通知一律收到即封存。此為個人偏好，只存在本裝置瀏覽器">
          <input type="checkbox" ${_majorEventDismissPref() ? 'checked' : ''} onchange="_majorEventDismissPrefToggle(this.checked)" style="cursor:pointer;">
          Gmail 變更／非上班時間活動：收到後立即封存（未勾選＝已讀後保留 7 天可回顧）
        </label>
      </div>` : ''}
    </div>` : '';
  // 空間預約通知卡（一般通知，非重大事件）：藍色、較輕的視覺；點「收到」即封存
  const isBkCollapsed = !!window._bookingNotifsCollapsed;
  const bkCard = bkNotifs.length ? `
    <div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${!isBkCollapsed ? '4px' : '0'};cursor:pointer;" onclick="_bookingNotifsToggle()" data-tip="${isBkCollapsed?'展開':'收起'}空間預約通知區塊">
        <div style="font-weight:700;color:#2b6cb0;font-size:.95rem;">📅 空間預約通知（${bkNotifs.length} 筆）</div>
        <button style="background:none;border:none;cursor:pointer;font-size:.88rem;color:#2b6cb0;padding:0 2px;">${isBkCollapsed?'▶':'▼'}</button>
      </div>
      ${!isBkCollapsed ? `<div>${bkNotifs.map(n => _renderItem(n, _thBk)).join('')}</div>` : ''}
    </div>` : '';
  section.innerHTML = majorCard + bkCard;
}
window._bookingNotifsToggle = function() {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  window._bookingNotifsCollapsed = !window._bookingNotifsCollapsed;
  _renderMajorEventNotifs();
};
window._majorEventsToggle = function() {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  window._majorEventsCollapsed = !window._majorEventsCollapsed;
  _renderMajorEventNotifs();
};
window._majorEventDismissPrefToggle = function(on) {
  try { localStorage.setItem('scc_major_dismiss_on_read', on ? '1' : '0'); } catch {}
  _renderMajorEventNotifs();
};
window._majorEventMarkRead = async function(notifId) {
  const n = _myNotifs().find(x => x.id === notifId);
  if (!n) return;
  n.read = true;
  if (!n.readAt) n.readAt = new Date().toISOString();
  _renderMajorEventNotifs();
  renderNotifBell?.();
  const res = await _notifCommit([{ op: 'markRead', email: currentUser.email, id: notifId, readAt: n.readAt }]);
  if (res && res.fallback) console.warn('_majorEventMarkRead: notifCommit 未部署（fallback），本次已讀狀態未落地');
};
window._majorEventMarkAllRead = async function() {
  const notifs = _myNotifs();
  if (!notifs.length) return;
  const nowIso = new Date().toISOString();
  const ids = [];
  notifs.forEach(n => {
    if (MAJOR_EVENT_NOTIF_TYPES.has(n.type) && !n.read) {
      n.read = true; n.readAt = nowIso; ids.push(n.id);
    }
  });
  if (!ids.length) return;
  _renderMajorEventNotifs();
  renderNotifBell?.();
  // 只標記重大事件類型（非全部通知），backend markRead 逐則套用，故一次送出多筆 markRead ops
  const res = await _notifCommit(ids.map(id => ({ op: 'markRead', email: currentUser.email, id, readAt: nowIso })));
  if (res && res.fallback) console.warn('_majorEventMarkAllRead: notifCommit 未部署（fallback），本次已讀狀態未落地');
};

function _mlUpdateBatchBtn() {
  const checked = document.querySelectorAll('.ml-notif-cb:checked').length;
  const btn = document.getElementById('ml-batch-btn');
  if (btn) btn.style.display = checked > 0 ? '' : 'none';
  const allCb = document.getElementById('ml-cb-all');
  if (allCb) {
    const total = document.querySelectorAll('.ml-notif-cb').length;
    allCb.indeterminate = checked > 0 && checked < total;
    allCb.checked = total > 0 && checked === total;
  }
}

window._mlToggleAllCb = function(el) {
  document.querySelectorAll('.ml-notif-cb').forEach(cb => { cb.checked = el.checked; });
  _mlUpdateBatchBtn();
};

window._mlBatchAcknowledge = async function() {
  const ids = [...document.querySelectorAll('.ml-notif-cb:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  let changed = 0;
  ids.forEach(id => {
    const r = mentalLeavesData.find(l => l.id === id);
    if (!r || !currentUser?.email) return;
    if (!Array.isArray(r.acknowledgedBy)) r.acknowledgedBy = [];
    if (!r.acknowledgedBy.includes(currentUser.email)) { r.acknowledgedBy.push(currentUser.email); changed++; }
  });
  if (!changed) return;
  _syncTodoBadge();
  _renderMlNotifSection();
  if (document.getElementById('notif-panel')?.style.display !== 'none') renderNotifList();
  const jobId = bgJobAdd(`批次封存 ${changed} 筆身心調適假通知`);
  try { await saveMentalLeaves(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); }
};

