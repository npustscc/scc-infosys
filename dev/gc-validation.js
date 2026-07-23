// dev/gc-validation.js — GC 事件驗證模組（六類錯誤檢核＋自動補註＋廣播）＋心理測驗
// 資料庫載入/儲存 helper（原檔連續區段一併搬出）（拆 index.html 絞殺者第三十七刀，v284）。
// 內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告。
// 可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  GC 事件驗證（六類錯誤 + 自動補註 + 廣播）
// ══════════════════════════════════════════════
async function loadGcErrorsCache() {
  _gcErrorsCache = await driveReadJsonOptional(GC_VALIDATION_ERRORS_FILE);
  if (!_gcErrorsCache || !Array.isArray(_gcErrorsCache.entries)) _gcErrorsCache = { entries: [] };
  if (!Array.isArray(_gcErrorsCache.ignored)) _gcErrorsCache.ignored = [];
}
async function _saveGcErrorsCache() {
  _gcErrorsCache.updatedAt = new Date().toISOString();
  try { await driveUpdateJsonFile(GC_VALIDATION_ERRORS_FILE, _gcErrorsCache); }
  catch (e) {
    try { await driveCreateJsonFile(GC_VALIDATION_ERRORS_FILE, _gcErrorsCache); }
    catch (e2) { console.warn('_saveGcErrorsCache failed:', e2); }
  }
}
function _gcValidateEvent(ev, bookingsIndex, usersByName, usersByEmail) {
  const kinds = new Set();
  const desc = ev.description || '';
  const title = ev.title || '';
  // 1. MISSING_SERIAL
  if (!/\n#\d+\s*$/.test(desc)) kinds.add('MISSING_SERIAL');
  // 2. MISSING_CREATOR（系統寫入的「某人 建立/編輯」行，或已由系統補註過建立者皆算有）
  if (!/\S+\s+(建立|編輯)/.test(desc) && desc.indexOf('[系統補註') === -1) kinds.add('MISSING_CREATOR');
  // 3. BAD_TITLE
  const titleMatch = title.match(/^([^\.]+)\.(.+)$/);
  if (!titleMatch) kinds.add('BAD_TITLE');
  else {
    const [, roomChar, personName] = titleMatch;
    // 4. UNKNOWN_ROOM
    const knownRooms = ROOMS.filter(r => r !== '其他').concat(_getBkCustomRooms());
    const roomHit = knownRooms.some(r => r.charAt(0) === roomChar) || roomChar === '其他' || roomChar.length > 1;
    if (!roomHit) kinds.add('UNKNOWN_ROOM');
    // 5. UNKNOWN_COUNSELOR（可能為逗號分隔的多人名單，逐一比對）
    const personNames = personName ? personName.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (personNames.length && personNames.some(n => !usersByName.has(n))) kinds.add('UNKNOWN_COUNSELOR');
  }
  // 6. UNMATCHED（無對應 INFOSYS booking）
  if (!bookingsIndex.has(ev.id)) kinds.add('UNMATCHED');
  return kinds;
}
async function _runGcValidationAndBackfill(gcEvents) {
  if (!Array.isArray(gcEvents) || !gcEvents.length) return;
  if (!_gcErrorsCache?.entries) await loadGcErrorsCache();
  const bookingsIndex = new Map((bookingsData || []).map(b => [b.calendarEventId, b]));
  const usersByName = new Map();
  const usersByEmail = new Map();
  Object.entries(configData?.users || {}).forEach(([email, u]) => {
    if (u?.name) usersByName.set(u.name, { email, ...u });
    usersByEmail.set(email, u);
  });
  // 上一次 feed 快照（key = eventId|kind）
  const prevKeys = new Set((_gcErrorsCache.entries || []).map(e => `${e.eventId}|${e.kind}`));
  const currentKeys = new Set();
  const newErrors = []; // 本輪偵測新增（非快取內）
  const survivedEntries = []; // 本輪仍存在的錯誤（舊+新，忽略中的不計入）
  const backfillCandidates = []; // MISSING_CREATOR 且有 creator email
  const ignoredKeys = new Set((_gcErrorsCache.ignored || []).map(x => `${x.eventId}|${x.kind}`));

  for (const ev of gcEvents) {
    const kinds = _gcValidateEvent(ev, bookingsIndex, usersByName, usersByEmail);
    for (const kind of kinds) {
      const key = `${ev.id}|${kind}`;
      currentKeys.add(key);
      if (ignoredKeys.has(key)) continue; // 使用者已忽略此筆：不進入待確認清單、不廣播
      const entry = {
        id: `gce-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        eventId: ev.id, kind,
        title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime,
        creators: ev.creators || [],
        t: new Date().toISOString(),
      };
      // 若已存在於 feed 中，沿用舊 entry id 與時間戳
      const existing = (_gcErrorsCache.entries || []).find(e => e.eventId === ev.id && e.kind === kind);
      if (existing) survivedEntries.push(existing);
      else { survivedEntries.push(entry); newErrors.push(entry); }
    }
    // 自動補註 candidates
    if (kinds.has('MISSING_CREATOR') && (ev.creators || []).length) {
      backfillCandidates.push(ev);
    }
  }

  // 移除已消失的錯誤（GC 端已修正 → 從 feed 移除）
  _gcErrorsCache.entries = survivedEntries;

  // 清出：忽略名單中已不在本輪 currentKeys 的項目（事件已修正或超出查詢視窗）自動出清
  let ignoredCleaned = false;
  if (Array.isArray(_gcErrorsCache.ignored) && _gcErrorsCache.ignored.length) {
    const beforeLen = _gcErrorsCache.ignored.length;
    _gcErrorsCache.ignored = _gcErrorsCache.ignored.filter(x => currentKeys.has(`${x.eventId}|${x.kind}`));
    ignoredCleaned = _gcErrorsCache.ignored.length !== beforeLen;
  }

  // 自動補註（每輪最多 5 筆，避免長時間佔用）
  const maxBackfill = 5;
  let backfilled = 0;
  for (const ev of backfillCandidates.slice(0, maxBackfill)) {
    const creatorEmail = ev.creators[0];
    const creatorUser = usersByEmail.get(creatorEmail);
    const creatorName = creatorUser?.name || '';
    const note = creatorName
      ? `[系統補註] 由 ${creatorName}（${creatorEmail}）建立，於 ${new Date().toLocaleString('zh-TW')} 補註`
      : `[系統補註] 建立者為非本系統帳號：${creatorEmail}，於 ${new Date().toLocaleString('zh-TW')} 標註`;
    try {
      // 專用追加 action：不動標題/時間、不覆蓋既有備註、流水號保持在末端；
      // 後端以 '[系統補註' 標記防重複（配合 _gcValidateEvent 認得此標記，補註後不再判定缺建立者）
      const r = await proxyCall('gcAnnotateEvent', { eventId: ev.id, noteText: note });
      if (r?.skipped) { // 先前已補註過（可能是舊版重複補註留下的），僅清 feed 不再寫入
        _gcErrorsCache.entries = _gcErrorsCache.entries.filter(e => !(e.eventId === ev.id && e.kind === 'MISSING_CREATOR'));
        continue;
      }
      backfilled++;
      // 補完後從 feed 移除該 MISSING_CREATOR 記錄
      _gcErrorsCache.entries = _gcErrorsCache.entries.filter(e => !(e.eventId === ev.id && e.kind === 'MISSING_CREATOR'));
    } catch (e) { console.warn('backfill failed for', ev.id, e); }
  }

  // 儲存 feed（若有變動）
  if (newErrors.length || backfilled > 0 || prevKeys.size !== currentKeys.size || ignoredCleaned) {
    await _saveGcErrorsCache();
  }

  // 廣播新錯誤通知（session 內同錯誤只推一次）
  const trulyNew = newErrors.filter(e => !_gcErrorsBroadcastedThisSession.has(`${e.eventId}|${e.kind}`));
  if (trulyNew.length) {
    trulyNew.forEach(e => _gcErrorsBroadcastedThisSession.add(`${e.eventId}|${e.kind}`));
    _broadcastGcValidationErrors(trulyNew);
  }
  // 重繪錯誤區塊（若在待辦頁）
  if (document.getElementById('page-todos')?.classList.contains('active')) _renderGcErrorsSection?.();
  renderNotifBell?.();
}
function _broadcastGcValidationErrors(newErrors) {
  const kindLabel = { MISSING_SERIAL:'缺流水號', MISSING_CREATOR:'缺建立者註記', BAD_TITLE:'標題格式錯誤',
    UNKNOWN_ROOM:'未知空間', UNKNOWN_COUNSELOR:'未知輔導人員', UNMATCHED:'無對應學諮資訊系統預約' };
  const brief = newErrors.slice(0, 3).map(e => `${kindLabel[e.kind]||e.kind}：${e.title||'(無標題)'}`).join('；');
  const more = newErrors.length > 3 ? `（另 ${newErrors.length - 3} 筆）` : '';
  const firstEntry = newErrors[0];
  const detailStr = firstEntry ? ` （${firstEntry.date || ''} ${(firstEntry.startTime||'').slice(0,5)}）` : '';
  const msg = `📋 Google 日曆${detailStr}偵測到 ${newErrors.length} 筆待確認事件：${brief}${more}。請至待辦頁「Google 日曆事件待確認」查看。`;
  const nowIso = new Date().toISOString();
  let pushed = 0;
  Object.entries(configData?.users || {}).forEach(([email, u]) => {
    if (!u || u.disabled) return;
    if (email === currentUser?.email) return;
    const r = u.role || '';
    const recipient = r === '主任' || u.isAdmin === true || u.extraRole === '管理者' || (typeof r === 'string' && r.startsWith('專任'));
    if (!recipient) return;
    _queueNotifPush(email, {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      type: 'gc_validation_error',
      message: msg,
      navTarget: 'todos:gc-errors',
      createdAt: nowIso, read: false,
    });
    pushed++;
  });
  if (pushed) _flushNotifOps().catch(() => {});
}

function _initBkAuditDropdowns() {
  // 操作者 — 從 configData.users 取有名稱的使用者
  const opSel = document.getElementById('bk-audit-operator');
  if (opSel) {
    const cur = opSel.value;
    opSel.innerHTML = buildCounselorFilterOpts(cur, true, '全部操作者', true);
  }
  // 空間 — 固定清單 + 自訂空間
  const roomSel = document.getElementById('bk-audit-room');
  if (roomSel) {
    const cur = roomSel.value;
    roomSel.innerHTML = '<option value="">全部空間</option>';
    const allRooms = [...ROOMS, ..._getBkCustomRooms()].filter(r => r !== '其他');
    allRooms.forEach(r => {
      const o = document.createElement('option');
      o.value = o.textContent = r;
      roomSel.appendChild(o);
    });
    roomSel.value = cur || '';
  }
}

function _toggleBkSection(bodyId, iconId) {
  const body = document.getElementById(bodyId);
  const icon = document.getElementById(iconId);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (icon) icon.textContent = hidden ? '▼' : '▶';
}

function _applyBkAuditFilter() {
  _bkAuditFilter = {
    dateFrom: (document.getElementById('bk-audit-date-from') || {}).value || '',
    dateTo:   (document.getElementById('bk-audit-date-to')   || {}).value || '',
    operator: (document.getElementById('bk-audit-operator')  || {}).value || '',
    room:     (document.getElementById('bk-audit-room')      || {}).value || '',
  };
  _bkAuditPage = 0;
  _renderBkAuditLogs(window._auditLogsCache || []);
}

function _clearBkAuditFilter() {
  ['bk-audit-date-from','bk-audit-date-to','bk-audit-operator','bk-audit-room'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _bkAuditFilter = { dateFrom: '', dateTo: '', operator: '', room: '' };
  _bkAuditPage = 0;
  _renderBkAuditLogs(window._auditLogsCache || []);
}

function _renderBkAuditLogs(logs) {
  const el = document.getElementById('bookings-audit-body');
  if (!el) return;

  const fmtDate = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
  };
  const fmtTimePart = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const aColor = a => {
    if (a.includes('刪除')) return 'color:#c0392b;font-weight:600;';
    if (a.includes('新增')) return 'color:#2980b9;font-weight:600;';
    return '';
  };

  const isBookingAction = a => a.includes('空間預約') || a.includes('同步日曆');
  let filtered = [...logs].reverse().filter(l => isBookingAction(l.action));

  const { dateFrom, dateTo, operator, room } = _bkAuditFilter;
  if (dateFrom) filtered = filtered.filter(l => l.t && l.t.slice(0,10) >= dateFrom);
  if (dateTo)   filtered = filtered.filter(l => l.t && l.t.slice(0,10) <= dateTo);
  if (operator) filtered = filtered.filter(l => (l.name || '').includes(operator));
  if (room)     filtered = filtered.filter(l => (l.detail || '').split('　')[0].includes(room));

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state" style="padding:16px;"><p>尚無符合條件的空間預約稽核記錄</p></div>`;
    return;
  }

  const total = filtered.length;
  _bkAuditTotalPages = Math.ceil(total / BK_AUDIT_PAGE_SIZE);
  if (_bkAuditPage >= _bkAuditTotalPages) _bkAuditPage = _bkAuditTotalPages - 1;
  const start = _bkAuditPage * BK_AUDIT_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + BK_AUDIT_PAGE_SIZE);

  const rows = pageItems.map(l => `
    <tr>
      <td style="white-space:nowrap;font-size:.8rem;color:#718096;">${fmtDate(l.t)}<br><span style="color:#a0aec0;">${fmtTimePart(l.t)}</span></td>
      <td style="font-size:.85rem;white-space:nowrap;">${escHtml(l.name || '—')}</td>
      <td style="font-size:.85rem;${aColor(l.action)}">${escHtml(l.action)}</td>
      <td style="font-size:.82rem;">${escHtml(l.detail || '—')}</td>
    </tr>`).join('');

  const pager = _bkAuditTotalPages > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid #e2e8f0;">
      <button class="btn btn-secondary btn-sm" onclick="_bkAuditPage=Math.max(0,_bkAuditPage-1);_renderBkAuditLogs(window._auditLogsCache||[])" ${_bkAuditPage===0?'disabled':''}>‹</button>
      <span style="font-size:.8rem;color:#718096;">${_bkAuditPage+1} / ${_bkAuditTotalPages}（共 ${total} 筆）</span>
      <button class="btn btn-secondary btn-sm" onclick="_bkAuditPage=Math.min(_bkAuditTotalPages-1,_bkAuditPage+1);_renderBkAuditLogs(window._auditLogsCache||[])" ${_bkAuditPage===_bkAuditTotalPages-1?'disabled':''}>›</button>
    </div>` : '';

  el.innerHTML = `<div style="overflow-x:auto;"><table>
    <thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>更動事由</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${pager}`;
}

async function renderBookingsAuditLog(forceRefresh = false) {
  const el = document.getElementById('bookings-audit-body');
  if (!el) return;

  _initBkAuditDropdowns();

  // 若快取已存在且不強制刷新 → 立即渲染，背景更新 Drive
  if (Array.isArray(window._auditLogsCache) && !forceRefresh) {
    _renderBkAuditLogs(window._auditLogsCache);
  } else {
    el.innerHTML = `<div style="padding:16px;color:#718096;font-size:.85rem;">⏳ 讀取稽核記錄中…</div>`;
  }

  // 背景從 Drive 拉最新資料並更新快取
  try {
    const data = await driveReadJson(AUDIT_LOG_FILE);
    const driveLogs = Array.isArray(data?.logs) ? data.logs : [];
    // 合併本地尚未寫入 Drive 的新項目（以時間戳去重）
    const driveTs = new Set(driveLogs.map(l => l.t));
    const localOnly = (window._auditLogsCache || []).filter(l => !driveTs.has(l.t));
    window._auditLogsCache = [...driveLogs, ...localOnly].sort((a, b) => (a.t || '') < (b.t || '') ? -1 : 1);
    _renderBkAuditLogs(window._auditLogsCache);
  } catch (_) {}
}

// 僅供舊後端 fallback（bookingsCommit 尚未部署時）使用，勿新增呼叫——整檔覆寫會被併發操作互相蓋掉。
// 新寫入一律走 bkCommit()。
async function saveBookings() {
  try {
    await driveUpdateJsonFile(BOOKINGS_FILE, { bookings: bookingsData });
  } catch (e) {
    if (e.message.includes('找不到')) {
      await driveCreateJsonFile(BOOKINGS_FILE, { bookings: bookingsData }, DRIVE_FOLDER_ID);
    } else throw e;
  }
}

// 併發安全的預約批次寫入（Slice A）：優先走後端 bookingsCommit（LockService＋寫入當下撞房/撞人檢查）。
// ops: [{op:'upsert', booking, gc:{mode:'create'|'update'|'none', params}} | {op:'delete', id, gcEventId}]
// 回傳：{ ok:true, bookings:[...], gcErrors:[...] } | { error:'conflict', conflictType, with } | { fallback:true }
// fallback:true 表示舊後端尚未部署（Unknown action），呼叫端需自行沿用 saveBookings() 整檔覆寫路徑。
async function bkCommit(ops, opts = {}) {
  const checkConflicts = opts.checkConflicts !== false;
  const skipPersonConflict = !!opts.skipPersonConflict;
  const res = await proxyCall('bookingsCommit', { ops, checkConflicts, skipPersonConflict });
  if (res == null) return { fallback: true };
  if (res.error && /Unknown action/i.test(res.error)) return { fallback: true };
  return res;
}

// 單筆預約 upsert 的 bkCommit 便利包裝（供個案紀錄「下次預約」新增/編輯使用）。
// bk 為 bookingsData 內的實際物件參照，成功時會被就地合併回後端最終狀態（含新 calendarEventId）。
// 回傳 bk（成功／fallback）或 null（衝突或失敗，已透過 bgJobFail 記錄，呼叫端應自行回滾 bk）。
async function _bkCommitOne(bk, gcMode, gcParams, jobLabel) {
  const jobId = bgJobAdd(jobLabel);
  try {
    const res = await bkCommit([{ op: 'upsert', booking: { ...bk }, gc: { mode: gcMode, params: gcParams || null } }]);
    if (res.fallback) {
      try {
        if (gcMode === 'create') {
          const eid = await proxyCall('createCalendarEvent', gcParams);
          if (eid) bk.calendarEventId = eid;
        } else if (gcMode === 'update' && bk.calendarEventId) {
          await proxyCall('updateCalendarEvent', { eventId: bk.calendarEventId, ...gcParams });
        }
      } catch (_) {}
      await saveBookings().catch(() => {});
      bgJobDone(jobId);
      return bk;
    }
    if (res.error) {
      bgJobFail(jobId, res.conflictType ? `與其他人${res.conflictType === 'person' ? '人員' : '空間'}衝突` : res.error);
      return null;
    }
    const fb = (res.bookings || []).find(x => x.id === bk.id);
    if (fb) Object.assign(bk, fb);
    bgJobDone(jobId);
    return bk;
  } catch (e) {
    bgJobFail(jobId, e.message);
    return null;
  }
}

let _transferSnapshot = [];
async function loadTransfer() {
  try {
    const data = await driveReadJson(TRANSFER_FILE);
    transferData = Array.isArray(data?.records) ? data.records : [];
  } catch(e) { transferData = []; }
  _transferSnapshot = _deepClone(transferData);
}

let _psychTestDBSnapshot = {};
async function loadPsychTestDB() {
  const data = await driveReadJsonOptional(PSYCH_TEST_DB_FILE);
  psychTestDB = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  _psychTestDBSnapshot = _deepClone(psychTestDB);
}
async function _savePsychTestDBFallback() {
  try {
    await driveUpdateJsonFile(PSYCH_TEST_DB_FILE, psychTestDB);
  } catch(e) {
    if (!e.message.includes('找不到')) throw e;
    await driveCreateJsonFile(PSYCH_TEST_DB_FILE, psychTestDB, DRIVE_FOLDER_ID);
  }
  _psychTestDBSnapshot = _deepClone(psychTestDB);
}
// 併發安全寫入（2026-07-09 事故延伸修復）：map 模式 diff（依學號 key），經 listCommit upsert/remove。
async function savePsychTestDB() {
  const diff = _diffMapByKey(_psychTestDBSnapshot, psychTestDB);
  const res = await _listCommit(PSYCH_TEST_DB_FILE, diff);
  if (res && res.fallback) { await _savePsychTestDBFallback(); return; }
  if (res && res.data && typeof res.data === 'object') {
    psychTestDB = res.data;
    _psychTestDBSnapshot = _deepClone(psychTestDB);
  }
}

