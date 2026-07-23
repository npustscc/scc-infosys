// dev/notifications.js — 通知系統模組（拆 index.html 絞殺者第二十六刀，v273）。
// 內容為從 index.html 逐字搬出的連續區段（notifCommit 佇列/推播/鈴鐺/通知面板、
// 危機提醒 dismiss、背景工作追蹤 _bgJobs 與頂部進度 banner、個案紀錄表列印樣板）。
// 載入期副作用（column-0 複核）：let _notifCommitChain = Promise.resolve()（內建）、
// window._mlAcknowledge 等賦值、window beforeunload 監聽（背景工作/未存草稿離開攔阻）
// ——beforeunload 多 handler 任一 preventDefault 即攔，註冊順序無關，前移安全。
// 其餘 CSS/HTML 頂格行皆為 template literal 內容。可安全前移到主 inline script 之前
// 載入（刀法①）。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  通知系統
//  2026-07-09 事故延伸修復 v154：notifications 原存在 configData.users[email].notifications，
//  任何使用者收/發/讀通知都會觸發整份 config.json 覆寫（config 含全部使用者帳號與權限）——
//  ①兩則通知同時推播互相蓋掉 ②管理者改權限的瞬間撞上任何人的通知寫入會被蓋回。
//  拆成獨立 notifications.json＋後端 notifCommit（LockService 鎖內 ops 寫入），config.json
//  之後只剩低頻管理操作寫入。首次任何人推播/標讀會觸發後端一次性遷移建檔；遷移前所有讀寫點皆
//  fallback 回舊 configData 路徑，確保功能不中斷。
// ══════════════════════════════════════════════
let notifData = { users: {} };
let _notifLoaded = false; // true＝notifications.json 已成功載入，_myNotifs()／pollNotifications 改吃它
async function loadNotifications() {
  const data = await driveReadJsonOptional('notifications.json');
  if (data && data.users && typeof data.users === 'object') {
    notifData = data;
    _notifLoaded = true;
  } else {
    _notifLoaded = false; // 檔案不存在（尚未遷移）或讀取失敗 → 呼叫端一律 fallback 舊來源
  }
}
// 目前使用者的通知陣列：notifications.json 已載入就用它，否則 fallback 舊來源（尚未遷移／讀取失敗）
function _myNotifs() {
  if (_notifLoaded) return notifData.users?.[currentUser?.email] || [];
  return configData?.users?.[currentUser?.email]?.notifications || [];
}

// 同檔 commit 序列化（比照 _listCommit），避免同一分頁對 notifications.json 的多次 commit 交錯
let _notifCommitChain = Promise.resolve();
// 送出通知 ops 到後端（LockService 鎖內套用；首次呼叫觸發 config.json → notifications.json 一次性遷移）。
// 成功 → 把回傳 touched 合併進 notifData.users（涉及自己時順帶 renderNotifBell()）。
// 後端未部署（Unknown action）→ 回傳 {fallback:true}，呼叫端自行走舊路徑；其他錯誤（如 fail-closed 中止）原樣拋出。
function _notifCommit(ops) {
  const run = _notifCommitChain.then(async () => {
    try {
      const res = await proxyCall('notifCommit', { ops });
      if (res && res.touched) {
        Object.entries(res.touched).forEach(([email, arr]) => { notifData.users[email] = arr; });
        _notifLoaded = true;
        if (currentUser?.email && res.touched[currentUser.email] !== undefined) renderNotifBell();
      }
      return res;
    } catch (e) {
      if (/Unknown action/i.test(e.message || '')) return { fallback: true };
      throw e;
    }
  });
  _notifCommitChain = run.catch(() => {});
  return run;
}

// ── 推播佇列：同一次操作常需推播給多個收件人／呼叫多次 addNotificationToUser，
//    收集後統一呼叫一次 _flushNotifOps，避免同一操作多次鎖等待 ──
let _pendingNotifOps = [];
function _queueNotifPush(email, notif) {
  _pendingNotifOps.push({ op: 'push', email, notif });
}
// flush：送出本次累積的 ops。notifCommit 後端已在 dev/prod 雙邊穩定部署，fallback 分支永不觸發；
// 即使觸發也只警告，不再整檔回寫 config.json（那是唯一還會把舊 users[*].notifications 寫回去的
// 路徑，見 v154 遷移註解——本次通知會遺失，但不致把已遷移拆分的資料結構寫壞）。
async function _flushNotifOps() {
  const ops = _pendingNotifOps;
  _pendingNotifOps = [];
  if (!ops.length) return { pushed: 0 };
  const res = await _notifCommit(ops);
  if (res && res.fallback) {
    console.warn('_flushNotifOps: notifCommit 未部署（fallback），本次通知未落地', ops);
    return { pushed: ops.length, fallback: true };
  }
  return { pushed: ops.length };
}

function addNotificationToUser(toEmail, type, caseId, caseName, customMsg) {
  if (!toEmail || !configData?.users?.[toEmail]) return false;
  if (toEmail === currentUser?.email) return false;
  const msgs = {
    assigned_counselor:       `您已被指派為個案「${caseName}（${caseId}）」的主責輔導人員`,
    assigned_manager:         `您已被委任為個案「${caseName}（${caseId}）」的個案管理員`,
    same_sem_reopen:          `個案「${caseName}（${caseId}）」本學期在原主責尚未結案的情況下被再次開案，主責已轉移，請確認是否符合規定`,
    removed_manager:          `您已被移除個案「${caseName}（${caseId}）」的個案管理員身分`,
    unassigned_record_match:  `未歸屬輔導記錄找到可能對應的個案「${caseName}（${caseId}）」，請至未歸屬記錄管理頁確認`,
    new_issue:                `新的錯誤回報/許願池 #${String(caseName).padStart(3,'0')}，請至錯誤回報/許願池頁面查看`,
  };
  _queueNotifPush(toEmail, {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    type, caseId, caseName,
    message: customMsg || msgs[type] || type,
    createdAt: new Date().toISOString(),
    read: false,
  });
  return true;
}
function _hasNewCounselorAlert(c) {
  if (!c.newCounselorAlert?.date) return false;
  if (c.counselorEmail !== currentUser?.email) return false;
  const dismissed = configData?.users?.[currentUser.email]?.dismissedAlerts || [];
  if (dismissed.includes(c.id)) return false;
  return (Date.now() - new Date(c.newCounselorAlert.date).getTime()) / 86400000 <= 7;
}

async function dismissNewCounselorAlert(caseId) {
  const me = configData?.users?.[currentUser?.email];
  if (!me) return;
  if (!me.dismissedAlerts) me.dismissedAlerts = [];
  if (!me.dismissedAlerts.includes(caseId)) me.dismissedAlerts.push(caseId);
  renderCases();
  showCaseDetail(caseId);
  _configSelfPatch({ dismissedAlerts: me.dismissedAlerts }).catch(() => {});
}

// ── 背景工作追蹤 ──────────────────────────────────
let _bgJobs = [];
let _notifTab = 'notifs';
window.addEventListener('beforeunload', function(e) {
  // 未登入時（例如按「登入」導向 /login.html）一律不攔，避免誤攔正常導覽
  if (!currentUser) return;
  if (_bgJobs.some(j => j.state === 'running') || _saveFailSnapshot || window._ftDirty || _userPref_('confirmBeforeLeave', true)) {
    e.preventDefault(); e.returnValue = '';
  }
});

function bgJobAdd(label, detail) {
  const id = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  _bgJobs.unshift({ id, label, detail: detail || '', state: 'running', progress: 10, error: '', startedAt: Date.now(), endedAt: null });
  if (_bgJobs.length > 20) _bgJobs.length = 20;
  _syncBellBadge();
  _bgBannerUpsert(_bgJobs[0]);
  if (_notifTab === 'jobs' && document.getElementById('notif-panel')?.style.display !== 'none') renderJobList();
  return id;
}
function bgJobProgress(id, pct) {
  const j = _bgJobs.find(x => x.id === id);
  if (!j || j.state !== 'running') return;
  j.progress = Math.min(99, pct);
  _bgBannerUpsert(j);
  if (_notifTab === 'jobs' && document.getElementById('notif-panel')?.style.display !== 'none') renderJobList();
}
function bgJobDone(id) {
  const j = _bgJobs.find(x => x.id === id);
  if (!j) return;
  j.state = 'done'; j.progress = 100; j.endedAt = Date.now();
  _syncBellBadge();
  _bgBannerUpsert(j);
  _bgBannerScheduleRemoval(j.id);
  if (_notifTab === 'jobs' && document.getElementById('notif-panel')?.style.display !== 'none') renderJobList();
}
function bgJobFail(id, err) {
  const j = _bgJobs.find(x => x.id === id);
  if (!j) return;
  j.state = 'failed'; j.error = err || '未知錯誤'; j.endedAt = Date.now();
  _syncBellBadge();
  _bgBannerUpsert(j);
  _bgBannerScheduleRemoval(j.id);
  if (document.getElementById('notif-panel')?.style.display !== 'none') renderJobList();
}

// ── #036：儲存失敗記憶體快照＋還原（不落地 localStorage，個資僅存於本次頁面的記憶體變數）──
// 涵蓋七類表單（個案基本資料／晤談紀錄／事件處理記錄／精神科醫師紀錄／初談表／轉銜評估／結案評估表）。
// 這些表單的儲存多半採「樂觀更新＋背景寫入 Drive」：畫面已先跳轉離開表單，若背景寫入失敗
// （如網路中斷 Failed to fetch），使用者原本只能靠小鈴鐺「自動備援」分頁或背景工作失敗通知得知，
// 容易誤以為輸入內容已遺失（回應 #036）。現改為：儲存前先把表單目前內容存一份記憶體快照，
// 背景寫入失敗時除保留既有小鈴鐺／背景工作失敗通知（第二道防線）外，另外立刻彈出還原視窗。
let _saveFailSnapshot = null; // { label, containerId, fields, reopenFn, saveFn, jobId }

// 通用：擷取容器內所有具 id 的欄位目前的值（含核取方塊／單選鈕／富文字區塊），僅存於記憶體變數
function _snapshotFormFields(containerId) {
  const root = document.getElementById(containerId);
  const fields = {};
  if (!root) return fields;
  root.querySelectorAll('input[id], textarea[id], select[id]').forEach(el => {
    fields['id:' + el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });
  // 具名成組但無 id 的核取方塊／單選鈕（如 nc-topic、rec-service-main），以 name+value 為鍵
  root.querySelectorAll('input[name]:not([id])').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') fields[`nv:${el.name}:${el.value}`] = el.checked;
  });
  root.querySelectorAll('[contenteditable="true"][id]').forEach(el => {
    fields['rt:' + el.id] = getRichTextValue(el.id);
  });
  return fields;
}

// 通用：把快照還原回容器內對應欄位（找不到對應元素的欄位略過，不報錯；屬盡力還原）
function _restoreFormFields(containerId, fields) {
  const root = document.getElementById(containerId);
  if (!root || !fields) return;
  root.querySelectorAll('input[id], textarea[id], select[id]').forEach(el => {
    const key = 'id:' + el.id;
    if (!(key in fields)) return;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!fields[key];
    else el.value = fields[key];
  });
  root.querySelectorAll('input[name]:not([id])').forEach(el => {
    const key = `nv:${el.name}:${el.value}`;
    if (key in fields) el.checked = !!fields[key];
  });
  root.querySelectorAll('[contenteditable="true"][id]').forEach(el => {
    const key = 'rt:' + el.id;
    if (key in fields) setRichTextValue(el.id, fields[key]);
  });
}

// 儲存前呼叫：記錄本次儲存的快照與失敗時的還原方式。
// reopenFn 可為 null（該表單儲存失敗時原本就不會離開頁面，欄位仍在，不需重開）。
// jobId 若提供，僅在快照仍對應「同一次」儲存時才會彈出視窗，避免被使用者之後另一次儲存覆蓋後誤跳出。
// precomputedFields 可選：若呼叫當下欄位容器即將被移除（如 modal 儲存後立即 remove()），
// 呼叫端可提前用 _snapshotFormFields() 擷取好再傳入，避免此處才擷取時容器已消失。
function _armSaveFailSnapshot(label, containerId, reopenFn, saveFn, jobId, precomputedFields) {
  _saveFailSnapshot = { label, containerId, fields: precomputedFields || _snapshotFormFields(containerId), reopenFn, saveFn, jobId: jobId || null };
}
function _clearSaveFailSnapshot(jobId) {
  if (!_saveFailSnapshot) return;
  if (jobId && _saveFailSnapshot.jobId !== jobId) return; // 已被之後另一次儲存覆蓋，非同一筆快照
  _saveFailSnapshot = null;
}

// 儲存失敗時彈出的還原視窗
function _showSaveFailModal(errMsg, jobId) {
  const s = _saveFailSnapshot;
  if (!s || (jobId && s.jobId !== jobId)) return; // 快照已被後續操作覆蓋，改用既有背景工作失敗通知即可
  document.getElementById('save-fail-modal-overlay')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'save-fail-modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><h3 style="margin:0;color:#c0392b;">⚠️ 儲存失敗</h3></div>
      <div class="modal-body" style="padding:6px 0 4px;">
        <p style="font-size:.9rem;color:#4a5568;line-height:1.7;">「${escHtml(s.label)}」儲存失敗（${escHtml(errMsg || '網路中斷')}）。<br>
        您剛才輸入的內容已保留在系統記憶體中，尚未遺失，請選擇下一步：</p>
      </div>
      <div class="modal-footer" style="justify-content:center;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="_saveFailRetry()">🔄 重新儲存</button>
        <button class="btn btn-secondary" onclick="_saveFailBackToEdit()">↩ 回到編輯頁</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
function _closeSaveFailModal() {
  document.getElementById('save-fail-modal-overlay')?.remove();
}
async function _saveFailRetry() {
  const s = _saveFailSnapshot;
  _closeSaveFailModal();
  if (!s) return;
  if (typeof s.reopenFn === 'function') await s.reopenFn();
  setTimeout(() => {
    _restoreFormFields(s.containerId, s.fields);
    if (typeof s.saveFn === 'function') s.saveFn();
  }, s.reopenFn ? 200 : 0);
}
async function _saveFailBackToEdit() {
  const s = _saveFailSnapshot;
  _closeSaveFailModal();
  if (!s) return;
  if (typeof s.reopenFn === 'function') await s.reopenFn();
  setTimeout(() => _restoreFormFields(s.containerId, s.fields), s.reopenFn ? 200 : 0);
}

// ── #28：頂部背景工作進度 banner（僅視覺呈現，資料仍以 _bgJobs 為準）──
// 卡片顯示中：進行中顯示進度條；完成/失敗後維持顯示 5 秒，再花 5 秒淡出後移除 DOM。
function _bgBannerUpsert(job) {
  const banner = document.getElementById('bg-job-banner');
  if (!banner || !job) return;
  let card = banner.querySelector(`.bgb-card[data-job="${job.id}"]`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'bgb-card';
    card.dataset.job = job.id;
    card.setAttribute('data-tip', '點擊查看工作執行分頁');
    card.innerHTML = `<div class="bgb-label"></div><div class="bgb-track"><div class="bgb-fill"></div></div>`;
    card.onclick = () => _bgBannerGoToJob();
    banner.appendChild(card);
  }
  card.dataset.state = job.state;
  card.querySelector('.bgb-label').textContent = job.label;
  card.querySelector('.bgb-fill').style.width = (job.state === 'running' ? (job.progress || 10) : 100) + '%';
}
function _bgBannerScheduleRemoval(id) {
  const card = document.querySelector(`#bg-job-banner .bgb-card[data-job="${id}"]`);
  if (!card || card.dataset.fadeScheduled) return;
  card.dataset.fadeScheduled = '1';
  setTimeout(() => {
    card.classList.add('bgb-fadeout');
    setTimeout(() => card.remove(), 5000);
  }, 5000);
}
function _bgBannerGoToJob() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'block';
  setNotifTab('jobs');
}

// 頁面「重新整理」按鈕統一背景化：不鎖畫面（不呼叫 showLoading），進工作執行分頁追蹤，完成/失敗即時 toast 提醒
// 按鈕本身即時回饋：鎖定+「整理中…」，完成短暫顯示 ✓ 後還原（頁面若已重繪則自然以新按鈕呈現）
async function _bgRefreshClick(label, fn) {
  const btn = (typeof event !== 'undefined' && event?.currentTarget?.tagName === 'BUTTON') ? event.currentTarget : null;
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 整理中…'; }
  const jobId = bgJobAdd(label);
  try {
    await fn();
    bgJobDone(jobId);
    if (btn) {
      btn.innerHTML = '✓ 完成';
      setTimeout(() => { btn.disabled = false; btn.innerHTML = origHtml; }, 1500);
    }
    showToast(`✓ ${label}完成`, 'success', 4000);
  } catch (e) {
    bgJobFail(jobId, e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    showToast(`❌ ${label}失敗：${e.message}`, 'error', 8000);
  }
}
function _syncBellBadge() {
  const badge  = document.getElementById('notif-badge');
  const bell   = document.getElementById('notif-bell');
  if (!badge) return;
  if (bell) bell.style.display = 'flex';
  const historyBtn = document.getElementById('toast-history-btn');
  if (historyBtn) historyBtn.style.display = 'flex';
  const notifs  = _myNotifs();
  const unread  = notifs.filter(n => !n.read).length + (_updateAvailable ? 1 : 0);
  const failed  = _bgJobs.filter(j => j.state === 'failed').length;
  const running = _bgJobs.filter(j => j.state === 'running').length;
  const autosaveUnread = todosData.filter(t => !t.notifRead && !t.done).length;
  const mlUnread = _mlUnacknowledgedForMe().length;
  const total   = unread + failed + autosaveUnread + mlUnread;
  badge.textContent = total > 99 ? '99+' : (total || '');
  badge.style.display = (total > 0 || running > 0) ? 'flex' : 'none';
  badge.style.background = failed > 0 ? '#c53030' : running > 0 ? '#2b6cb0' : '#e53e3e';
  const jobTab = document.getElementById('ntab-jobs');
  if (jobTab) {
    const pending = running + failed;
    jobTab.textContent = pending > 0 ? `工作執行 (${pending})` : '工作執行';
  }
  const autosaveBadge = document.getElementById('autosave-notif-badge');
  if (autosaveBadge) {
    autosaveBadge.textContent = autosaveUnread > 99 ? '99+' : autosaveUnread;
    autosaveBadge.style.display = autosaveUnread > 0 ? 'inline' : 'none';
  }
  const notifTabBadge = document.getElementById('notifs-tab-badge');
  if (notifTabBadge) {
    const notifTabCount = unread + mlUnread;
    notifTabBadge.textContent = notifTabCount > 99 ? '99+' : notifTabCount;
    notifTabBadge.style.display = notifTabCount > 0 ? 'inline' : 'none';
  }
  if (!window._basePageTitle) window._basePageTitle = document.title;
  document.title = total > 0 ? `(${total > 99 ? '99+' : total}) ${window._basePageTitle}` : window._basePageTitle;
}
function renderJobList() {
  const el = document.getElementById('notif-job-list');
  if (!el) return;
  if (!_bgJobs.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#718096;font-size:.875rem;">目前沒有工作記錄（重新整理後清空）</div>';
    return;
  }
  const _t = ms => ms ? new Date(ms).toLocaleTimeString('zh-TW', { hour12: false }) : '';
  const _dur = ms => ms < 1000 ? '<1 秒' : ms < 60000 ? Math.round(ms / 1000) + ' 秒' : Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
  el.innerHTML = _bgJobs.map(j => {
    const stateLabel = j.state === 'running' ? '執行中…'
      : j.state === 'done' ? '✓ 完成'
      : '✕ 失敗：' + escHtml(j.error || '');
    // 時間戳：建立時間；完成/失敗加結束時間與耗時；執行中顯示已執行多久（可看出是否卡住）
    const timeLine = j.startedAt
      ? (j.endedAt
          ? `${_t(j.startedAt)} 建立 → ${_t(j.endedAt)} ${j.state === 'done' ? '完成' : '失敗'}（耗時 ${_dur(j.endedAt - j.startedAt)}）`
          : `${_t(j.startedAt)} 建立，已執行 ${_dur(Date.now() - j.startedAt)}`)
      : '';
    return `<div class="bg-job-item" data-state="${j.state}">
      <div class="bg-job-bar" style="width:${j.progress}%"></div>
      <div class="bg-job-meta">
        <div class="bg-job-label">${escHtml(j.label)}</div>
        ${j.detail ? `<div class="bg-job-detail">${escHtml(j.detail)}</div>` : ''}
        <div class="bg-job-status-text">${stateLabel}</div>
        ${timeLine ? `<div class="bg-job-detail" style="color:#a0aec0;">${escHtml(timeLine)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}
function setNotifTab(tab) {
  _notifTab = tab;
  ['notifs', 'jobs', 'autosave'].forEach(t => {
    const btn     = document.getElementById('ntab-' + t);
    const content = document.getElementById('ntab-content-' + t);
    if (btn) btn.classList.toggle('ntab-active', t === tab);
    if (content) content.style.display = t === tab ? '' : 'none';
  });
  const actionBtn = document.getElementById('notif-panel-action-btn');
  if (actionBtn) {
    if (tab === 'notifs') actionBtn.textContent = '全部標為已讀';
    else if (tab === 'autosave') actionBtn.textContent = '全部標為已讀';
    else actionBtn.textContent = '清除已完成';
  }
  if (tab === 'jobs') renderJobList();
  if (tab === 'autosave') renderTodosNotifList();
}
function _notifPanelAction() {
  if (_notifTab === 'notifs') {
    markAllNotifRead();
  } else if (_notifTab === 'autosave') {
    todosData.filter(t => !t.notifRead).forEach(t => { t.notifRead = true; });
    saveUserTodos().catch(() => {});
    _syncBellBadge();
    renderTodosNotifList();
  } else {
    _bgJobs = _bgJobs.filter(j => j.state !== 'done');
    _syncBellBadge();
    renderJobList();
  }
}

function renderNotifBell() {
  const bell = document.getElementById('notif-bell');
  if (bell) bell.style.display = 'flex';
  const historyBtn = document.getElementById('toast-history-btn');
  if (historyBtn) historyBtn.style.display = 'flex';
  _syncBellBadge();
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const open = panel.style.display === 'block';
  if (open) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  renderNotifList(); renderJobList();
  // 自動切換到有紅色項目的分頁（提醒 > 工作執行 > 待辦）
  const _unread = _myNotifs().filter(n => !n.read).length + (_updateAvailable ? 1 : 0);
  const _failed = _bgJobs.filter(j => j.state === 'failed').length;
  const _running = _bgJobs.filter(j => j.state === 'running').length;
  const _todoUnread = todosData.filter(t => !t.notifRead && !t.done).length;
  if (_unread > 0) setNotifTab('notifs');
  else if (_failed > 0 || _running > 0) setNotifTab('jobs');
  else if (_todoUnread > 0) setNotifTab('autosave');
  else setNotifTab('notifs');
}

// v239：📜 提示訊息紀錄面板——絕對定位在按鈕下方，比照通知面板點外關閉慣例
function toggleToastHistory() {
  const panel = document.getElementById('toast-history-panel');
  const btn = document.getElementById('toast-history-btn');
  if (!panel || !btn) return;
  const open = panel.style.display === 'block';
  if (open) { panel.style.display = 'none'; return; }
  const r = btn.getBoundingClientRect();
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.right = `${window.innerWidth - r.right}px`;
  panel.style.display = 'block';
  _renderToastHistory();
}

function _renderToastHistory() {
  const list = document.getElementById('toast-history-list');
  if (!list) return;
  if (!_toastHistory.length) {
    list.innerHTML = `<div style="padding:20px 16px;text-align:center;color:#a0aec0;font-size:.85rem;">尚無訊息</div>`;
    return;
  }
  const icon = { success: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' };
  const color = { warn: '#c05621', error: '#c53030' };
  list.innerHTML = _toastHistory.map(h => {
    const hh = String(h.time.getHours()).padStart(2, '0');
    const mm = String(h.time.getMinutes()).padStart(2, '0');
    const c = color[h.type] || '#2d3748';
    return `<div class="notif-item" style="cursor:default;">
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <span style="font-size:.72rem;color:#a0aec0;flex-shrink:0;white-space:nowrap;">${hh}:${mm}</span>
        <span style="flex-shrink:0;">${icon[h.type] || 'ℹ️'}</span>
        <span style="font-size:.85rem;color:${c};line-height:1.4;word-break:break-word;">${escHtml(h.msg)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderNotifList() {
  const notifs = _myNotifs();
  const list = document.getElementById('notif-list');
  if (!list) return;
  const updateBanner = _updateAvailable ? `
    <div class="notif-item notif-unread" style="border-left:4px solid #dd6b20;background:#fffaf0;cursor:default;">
      <div style="font-size:.875rem;color:#2d3748;line-height:1.5;">⚡ 系統已更新，建議重新整理頁面以取得最新版本</div>
      <button onclick="location.reload()" style="margin-top:6px;padding:4px 14px;background:#dd6b20;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.8rem;">立即重新整理</button>
    </div>` : '';
  const mlItems = _mlUnacknowledgedForMe();
  const _mlIsPriv = currentRole === '主任' || extraRole === '管理者' || isMentalLeaveContact;
  const _mlMyIds = _getMyCaseStudentIds();
  const _mlIndividualItems = _mlIsPriv ? mlItems.filter(l => _mlMyIds.has(l.studentId)) : mlItems;
  const _mlOtherItems = _mlIsPriv ? mlItems.filter(l => !_mlMyIds.has(l.studentId)) : [];
  const _mlItemBanner = items => items.map(l => {
    const mc = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
    const dateStr = (l.receivedAt || '').slice(0, 10);
    return `<div class="notif-item notif-unread" style="border-left:4px solid #276749;background:#f0fff4;cursor:default;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.8rem;font-weight:700;color:#276749;margin-bottom:3px;">🌿 身心調適假通知</div>
        <div style="font-size:.875rem;color:#2d3748;line-height:1.5;">${escHtml(l.name||l.studentId)} ${dateStr ? `（${dateStr}）` : ''} — ${escHtml((l.reason||'').slice(0,30))}${(l.reason||'').length>30?'…':''}</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          ${mc ? `<button onclick="showCaseDetail('${escHtml(mc.id)}')" style="padding:3px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;">前往個案</button>` : ''}
          <button onclick="event.stopPropagation();window._mlAcknowledge('${escHtml(l.id)}')" style="padding:3px 12px;background:#276749;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;">收到</button>
        </div>
      </div>
    </div>`;
  }).join('');
  const _mlSummaryBanner = _mlOtherItems.length ? (() => {
    const uniqStudents = new Set(_mlOtherItems.map(l => l.studentId)).size;
    const idsAttr = escHtml(JSON.stringify(_mlOtherItems.map(l => l.id)));
    return `<div class="notif-item notif-unread" style="border-left:4px solid #276749;background:#f0fff4;cursor:default;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.8rem;font-weight:700;color:#276749;margin-bottom:3px;">🌿 身心調適假通知（彙總）</div>
        <div style="font-size:.875rem;color:#2d3748;line-height:1.5;">已新增 ${_mlOtherItems.length} 個身心調適假通知，已開案個案有 ${uniqStudents} 位</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button onclick="showPage('page-mental-leave',document.getElementById('nav-mental-leave-item'));renderMentalLeavePage();toggleNotifPanel();" style="padding:3px 12px;background:#2b6cb0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;">前往身心調適假</button>
          <button data-ml-ids="${idsAttr}" onclick="event.stopPropagation();window._mlAcknowledgeAll(JSON.parse(this.dataset.mlIds))" style="padding:3px 12px;background:#276749;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.78rem;">全部收到</button>
        </div>
      </div>
    </div>`;
  })() : '';
  const mlBanner = _mlItemBanner(_mlIndividualItems) + _mlSummaryBanner;
  if (!notifs.length && !_updateAvailable && !mlItems.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#718096;font-size:.875rem;">目前沒有通知</div>';
    return;
  }
  list.innerHTML = updateBanner + mlBanner + notifs.map(n => {
    const navBtn = n.navTarget === 'todos:gc-errors' ?
      `<button onclick="showPage('page-todos',document.querySelector('[data-nav-id=page-todos]'));setTimeout(()=>document.getElementById('todos-gc-errors-section')?.scrollIntoView({behavior:'smooth'}),200);document.getElementById('notif-panel').style.display='none';" style="margin-top:4px;padding:2px 8px;font-size:.75rem;background:#4a5568;color:#fff;border:none;border-radius:4px;cursor:pointer;">前往處理</button>` : '';
    return `
    <div class="notif-item ${n.read ? 'notif-read' : 'notif-unread'}" style="display:flex;gap:8px;align-items:flex-start;"
      onclick="notifClick('${escHtml(n.id)}','${escHtml(n.caseId || '')}')">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.875rem;color:#2d3748;line-height:1.5;">${escHtml(n.message)}</div>
        <div style="font-size:.75rem;color:#a0aec0;margin-top:4px;">${escHtml((n.createdAt||'').slice(0,16).replace('T',' '))}</div>
        ${navBtn}
      </div>
      ${!n.read ? `<button onclick="event.stopPropagation();notifDismiss('${escHtml(n.id)}')" style="flex-shrink:0;background:none;border:none;color:#a0aec0;cursor:pointer;font-size:1rem;padding:0 2px;line-height:1;" title="已讀（不跳轉）">×</button>` : ''}
    </div>`;
  }).join('');
}

window._mlAcknowledge = async (id) => {
  const r = mentalLeavesData.find(l => l.id === id);
  if (!r || !currentUser?.email) return;
  if (!Array.isArray(r.acknowledgedBy)) r.acknowledgedBy = [];
  if (r.acknowledgedBy.includes(currentUser.email)) return;
  r.acknowledgedBy.push(currentUser.email);
  _syncTodoBadge();
  if (document.getElementById('notif-panel')?.style.display !== 'none') renderNotifList();
  if (document.getElementById('page-todos')?.classList.contains('active')) renderTodosPage();
  // A-4：列上／卡片上的「收到」鈕就地重繪，讓「已收到 ✓」立即反映，不必整頁重載
  if (document.getElementById('page-mental-leave')?.classList.contains('active')) renderMentalLeavePage();
  if (_detailCaseId) {
    const _mc = (casesData || []).find(cc => !cc.deleted && cc.studentId === r.studentId);
    if (_mc && _mc.id === _detailCaseId) {
      const _mlDiv = document.getElementById('detail-ml-leaves');
      if (_mlDiv) _mlDiv.innerHTML = _renderCaseMlCard(_mc);
    }
  }
  const jobId = bgJobAdd(`身心調適假已確認：${r.name || r.studentId}`);
  try { await saveMentalLeaves(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); }
};
window._mlAcknowledgeAll = async (ids) => {
  if (!currentUser?.email || !ids?.length) return;
  ids.forEach(id => {
    const r = mentalLeavesData.find(l => l.id === id);
    if (!r) return;
    if (!Array.isArray(r.acknowledgedBy)) r.acknowledgedBy = [];
    if (!r.acknowledgedBy.includes(currentUser.email)) r.acknowledgedBy.push(currentUser.email);
  });
  _syncTodoBadge();
  if (document.getElementById('notif-panel')?.style.display !== 'none') renderNotifList();
  if (document.getElementById('page-todos')?.classList.contains('active')) renderTodosPage();
  const jobId = bgJobAdd(`身心調適假已全部確認（${ids.length} 筆）`);
  try { await saveMentalLeaves(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); }
};

async function notifDismiss(notifId) {
  const n = _myNotifs().find(x => x.id === notifId);
  if (!n) return;
  n.read = true;
  if (!n.readAt) n.readAt = new Date().toISOString();
  renderNotifBell(); renderNotifList();
  // notifCommit 後端已在 dev/prod 雙邊穩定部署，fallback 分支永不觸發；即使觸發也不再整檔回寫
  // config.json（那是唯一還會把舊 users[*].notifications 寫回去的路徑，見 v154 遷移註解）。
  const res = await _notifCommit([{ op: 'markRead', email: currentUser.email, id: notifId, readAt: n.readAt }]);
  if (res && res.fallback) console.warn('notifDismiss: notifCommit 未部署（fallback），本次已讀狀態未落地');
}

async function notifClick(notifId, caseId) {
  const n = _myNotifs().find(x => x.id === notifId);
  if (n && !n.read) {
    n.read = true;
    n.readAt = new Date().toISOString();
    renderNotifBell();
    renderNotifList();
    const res = await _notifCommit([{ op: 'markRead', email: currentUser.email, id: notifId, readAt: n.readAt }]);
    if (res && res.fallback) console.warn('notifClick: notifCommit 未部署（fallback），本次已讀狀態未落地');
  }
  if (!caseId) return;
  const notif = _myNotifs().find(x => x.id === notifId);
  if (notif?.type === 'unassigned_record_match') {
    const navEl = document.querySelector('[data-nav-id="page-unassigned-records"]');
    showPage('page-unassigned-records', navEl);
    renderUnassignedRecordsPage();
  } else if (notif?.type === 'new_issue') {
    const navEl = document.querySelector('[data-nav-id="page-issues"]');
    markIssuesSeen();
    showPage('page-issues', navEl);
    renderIssuesPage();
  } else if (notif?.type === 'admin_verify_new_user') {
    const navEl = document.querySelector('[data-nav-id="page-admin"]');
    showPage('page-admin', navEl);
    if (notif.caseId) window._adminHighlightUser = notif.caseId;
    renderAdminUsers();
    renderAdminDegreeMapping();
  } else {
    showCaseDetail(caseId);
  }
}

async function markAllNotifRead() {
  const notifs = _myNotifs();
  if (!notifs.length) return;
  const nowIso = new Date().toISOString();
  notifs.forEach(n => { if (!n.read) { n.read = true; n.readAt = nowIso; } });
  renderNotifBell();
  renderNotifList();
  const res = await _notifCommit([{ op: 'markAllRead', email: currentUser.email, readAt: nowIso }]);
  if (res && res.fallback) console.warn('markAllNotifRead: notifCommit 未部署（fallback），本次已讀狀態未落地');
}

// ── 列印/PDF 共用 helper ──────────────────────────────────────────────────
function _stripPrintScript(html) {
  // 先整句移除 window.addEventListener('load',()=>window.print()); 這類包裹寫法——
  // 若只挖掉 window.print() 會留下 ()=>) 的殘句，在 srcdoc iframe 裡拋 SyntaxError（cosmetic 但吵）
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => {
    const nb = body
      .replace(/window\.addEventListener\(\s*['"]load['"]\s*,\s*\(\)\s*=>\s*window\.print\(\)\s*\)\s*;?\s*/g, '')
      .replace(/window\.print\(\);?\s*/g, '');
    return nb.trim() ? `<script>${nb}<\/script>` : '';
  });
}

function _printViaIframe(html) {
  const clean = _stripPrintScript(html);
  let frame = document.getElementById('_global_print_frame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = '_global_print_frame';
  frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow.print();
      setTimeout(() => { if (frame.parentNode) frame.remove(); }, 3000);
    }, 150);
  };
  frame.srcdoc = clean;
}

// 富文字（rt-editor）內容帶進列印頁時的共用清單樣式：列印頁多半用 *{margin:0;padding:0} 做版面重置，
// 若不補回 ol/ul 的 padding-left，li 的標號／項目符號會吊掛在容器外、比欄位標題更凸出。
// 這裡順便比照編輯器（.rt-editor ol/ul 相關規則）還原自訂括號編號／短橫項目符號的呈現，維持列印與畫面一致。
const PRINT_RICH_LIST_CSS = `
ol,ul{padding-left:1.6em;margin:.3em 0}
li{margin:0}
ol[data-rt-ls="paren"]{list-style-type:none;counter-reset:rt-li}
ol[data-rt-ls="paren"]>li{counter-increment:rt-li}
ol[data-rt-ls="paren"]>li::before{content:'(' counter(rt-li) ')';margin-right:.4em}
ul[data-rt-ls="dash"]{list-style-type:none}
ul[data-rt-ls="dash"]>li::before{content:'–';margin-right:.4em}
`;

function printRecord(caseId, recordId, mode = 'print') {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const r = (c.records || []).find(x => x.id === recordId);
  if (!r) return;

  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safe = s => esc(s || '');
  const printRich = s => {
    const t = String(s || '');
    if (/<\/?[a-z][\s\S]*?>/i.test(t)) return sanitizeRichHtml(t);
    return esc(t).replace(/\n/g, '<br>');
  };

  const weekdays = ['日','一','二','三','四','五','六'];
  const dateObj  = r.date ? new Date(r.date + 'T00:00:00') : null;
  const weekday  = dateObj ? `（${weekdays[dateObj.getDay()]}）` : '';
  const timeDisp = (r.time || '').startsWith('其他：') ? r.time.slice(3) : (r.time || '');
  const deptDisp = _caseClassDisp(c); // v188：班級（B1），取代舊版系級空白相接格式
  const bdDisp   = (c.birthday || '').replace(/-/g, '/');

  const topicAliasMap = { '家庭問題':'家庭關係','人際互動':'人際關係','學業與學習':'學習與課業','生涯發展與規劃':'生涯探索','網路沉迷':'網路成癮' };
  const normalizedTopics = new Set((r.topics || []).map(t => topicAliasMap[t] || t));
  const officialTopics = ['自我探索','情感困擾','家庭關係','心理疾患或傾向','情緒困擾','人際關係','學習與課業','生涯探索','生活適應','網路成癮','生理健康','性別議題','其他'];

  const topicCbs = officialTopics.map((t, i) => {
    const chk = normalizedTopics.has(t) || (t === '其他' && [...normalizedTopics].some(x => x.startsWith('其他')));
    const note = (t === '其他' && chk) ? ([...normalizedTopics].find(x => x.startsWith('其他：')) || '').slice(3) : '';
    return `<div class="cb-item"><div class="cb-row"><span style="font-size:2em;line-height:1;vertical-align:0.15em;">${chk?'■':'□'}</span> ${i+1}. ${safe(t)}${note?'：'+safe(note):''}</div></div>`;
  }).join('');

  const svcItems = r.serviceItems || [];
  const hasSvc = (...kws) => svcItems.some(s => kws.some(k => s.includes(k)));
  const formSvcs = [
    { label:'諮商輔導/諮詢',                         star:false, checked:hasSvc('諮商輔導') },
    { label:'心理測驗',                               star:true,  checked:hasSvc('心理測驗') },
    { label:'與個案相關資源或關係人聯繫',             star:true,  checked:hasSvc('與個案相關資源') },
    { label:'轉介至外部相關資源，持續諮商或治療',    star:false, checked:hasSvc('持續諮商') },
    { label:'轉介至外部相關資源，資源連結',           star:true,  checked:hasSvc('資源連結') },
    { label:'轉介校內精神科醫師',                     star:false, checked:hasSvc('校內精神科醫師') },
    { label:'轉介校外精神科醫師',                     star:false, checked:hasSvc('校外精神科醫師') },
    { label:'責任通報',                               star:true,  checked:hasSvc('責任通報') },
    { label:'陪同服務',                               star:true,  checked:hasSvc('陪同服務') },
    { label:'內部轉案',                               star:true,  checked:hasSvc('內部轉案') },
    { label:'結案',                                   star:false, checked:hasSvc('結案') },
    { label:'其他',                                   star:true,  checked:hasSvc('其他') },
  ];
  const getDetail = (...kws) => {
    const match = svcItems.find(s => kws.some(k => s.includes(k)));
    if (!match) return '';
    const ci = match.indexOf('：');
    return ci >= 0 ? match.slice(ci + 1) : '';
  };
  const detailMap = [
    '',                                  // 1 諮商輔導/諮詢
    getDetail('心理測驗'),               // 2 心理測驗
    '',                                  // 3 與個案相關資源
    '',                                  // 4 轉介外部（持續諮商）
    '',                                  // 5 轉介外部（資源連結）
    '',                                  // 6 轉介校內精神科
    '',                                  // 7 轉介校外精神科
    getDetail('責任通報'),               // 8 責任通報
    getDetail('陪同服務'),               // 9 陪同服務
    getDetail('內部轉案'),               // 10 內部轉案
    '',                                  // 11 結案
    getDetail('其他'),                   // 12 其他
  ];
  const svcCbs = formSvcs.map((sv, i) => {
    const det = detailMap[i] ? `<div class="cb-det">${safe(detailMap[i])}</div>` : '';
    return `<div class="cb-item"><div class="cb-row"><span style="font-size:2em;line-height:1;vertical-align:0.15em;">${sv.checked?'■':'□'}</span> ${i+1}. ${sv.star?'*':''}${safe(sv.label)}</div>${det}</div>`;
  }).join('');
  const printTime    = new Date().toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const printerName  = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>個案紀錄表 ${safe(c.name)} ${safe(r.date)}</title>
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'微軟正黑體','Microsoft JhengHei','Noto Sans TC',sans-serif;font-size:12pt;color:#000}
.wrap{padding:16mm 15mm}
.title{text-align:center;font-size:15pt;font-weight:bold;letter-spacing:2pt;margin-bottom:3pt}
table{width:100%;border-collapse:collapse;margin-bottom:3pt;font-size:10pt}
td{padding:3pt 0;border:none}
td+td{padding-left:12pt}
.sec{margin-bottom:8pt}
.sh{font-size:10.5pt;font-weight:bold;margin-bottom:3pt;border-bottom:.8pt solid #999;padding-bottom:2pt}
.box{min-height:60pt;padding:4pt 0;white-space:pre-wrap;font-size:10pt;line-height:1.7;word-break:break-all}
.box.sm{min-height:36pt}
.topic-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1pt 6pt;margin:3pt 0}
.svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:4pt 8pt;margin:3pt 0;align-items:start}
.cb-item{display:flex;flex-direction:column;font-size:9.5pt;line-height:1.2}
.cb-row{display:flex;align-items:baseline;gap:3pt}
.cb-det{font-size:8.5pt;color:#333;padding-left:30pt;margin-top:1pt}
.topic-grid .cb-item{line-height:1}
.topic-grid .cb-row{align-items:center}
.topic-grid .cb-row > span:first-child{font-size:1.3em !important}
.sig{display:flex;justify-content:flex-end;margin-top:14pt}
.sig-f{display:flex;align-items:flex-end;gap:6pt;font-size:10.5pt}
.sig-l{border-bottom:.8pt solid #000;width:120pt;padding-bottom:2pt;text-align:center;font-size:10pt}
.foot{font-size:7.5pt;color:#888;text-align:right;margin-top:10pt;padding-top:4pt}
.case-no-line{font-size:8.5pt;text-align:left;margin:0;padding-bottom:2pt;line-height:1.1}
.banner-hr{border:none;border-bottom:1pt solid #000;margin:0 0 1pt}
.session-line{font-size:10pt;margin:0 0 8pt}
${PRINT_RICH_LIST_CSS}
</style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div><div class="wrap">
<div class="title">個　案　紀　錄　表</div>
<div class="case-no-line">案號：${safe(c.id)}</div>
<hr class="banner-hr">
<table style="table-layout:fixed">
  <tr><td>姓名：${safe(c.name)}</td><td>電話：${safe(c.phone)}</td><td>出生年月日：${safe(bdDisp)}</td></tr>
  <tr><td>學號：${safe(c.studentId)}</td><td>班級：${safe(deptDisp)}</td><td>身分證／居留證：${safe(c.idNumber)}</td></tr>
</table>
<div class="session-line">晤談日期：${safe(r.date)}${weekday}　${safe(timeDisp)}</div>
<div class="sec"><div class="sh">一、會談主題</div><div class="topic-grid">${topicCbs}</div></div>
<div class="sec"><div class="sh">二、主述與會談資料</div><div class="box">${printRich(r.summary)}</div></div>
<div class="sec"><div class="sh">三、問題評估</div><div class="box sm">${printRich(r.assessment)}</div></div>
<div class="sec"><div class="sh">四、當次介入處遇</div><div class="svc-grid">${svcCbs}</div></div>
<div class="sec"><div class="sh">五、後續處遇計畫</div><div class="box sm">${
  (() => {
    const nextBk = r.nextBkId
      ? bookingsData.find(b => b.id === r.nextBkId)
      : bookingsData.find(b => b.caseId === r.caseId && b.date > r.date);
    const bkLine = nextBk ? `【下次預約】${nextBk.date} ${(nextBk.startTime||'').slice(0,5)}–${(nextBk.endTime||'').slice(0,5)} ${nextBk.room}` : '';
    return printRich(r.nextPlan) + (bkLine && r.nextPlan ? '<br>' : '') + safe(bkLine);
  })()
}</div></div>
<div class="sig"><div class="sig-f">晤談人員：<div class="sig-l">${safe(r.counselorName||r.counselorEmail||'')}</div></div></div>
<div class="foot">${printerName ? safe(printerName)+' 於 ' : ''}${safe(printTime)} 列印　國立屏東科技大學學生諮商中心資訊系統</div>
</div>
<script>window.addEventListener('load',()=>window.print());<\/script>
</body></html>`;

  _printViaIframe(html);
}

async function pollNotifications() {
  // 打卡權杖免登入模式：currentUser/configData 雖已填入最小資料，但沒有 session/idToken，
  // proxyCall 會因缺登入憑證而觸發 _refreshIdToken()（可能跳出 Google 登入 modal）——
  // 打卡頁不應該出現任何登入 UI，直接跳過。
  if (_clockTokenMode) return;
  if (!currentUser?.email || !configData) return;
  try {
    // 主路徑：notifications.json 獨立輪詢（v154），檔案小、頻率不變
    const freshNotif = await driveReadJsonOptional('notifications.json');
    if (freshNotif && freshNotif.users && typeof freshNotif.users === 'object') {
      notifData = freshNotif;
      _notifLoaded = true;
      renderNotifBell();
      const panel = document.getElementById('notif-panel');
      if (panel && panel.style.display === 'block') renderNotifList();
      return;
    }
    // fallback：notifications.json 尚未遷移建檔（尚未有人呼叫過 notifCommit）→ 沿用舊讀 config 邏輯
    const fresh = await driveReadJson(CONFIG_FILE);
    if (!fresh?.users) return;
    const freshCount   = Object.keys(fresh.users).length;
    const currentCount = Object.keys(configData.users || {}).length;
    if (freshCount >= currentCount) {
      // 正常情況：Drive 有等量或更多使用者，整體更新
      configData.users = fresh.users;
    } else if (freshCount > 0) {
      // Drive 使用者數少於記憶體（可能 Drive 資料損毀）：僅更新當前使用者的通知
      const myFresh = fresh.users[currentUser.email];
      if (configData.users?.[currentUser.email] && myFresh?.notifications !== undefined) {
        configData.users[currentUser.email].notifications = myFresh.notifications;
      }
    } else {
      return; // freshCount === 0，拒絕覆蓋
    }
    renderNotifBell();
    const panel = document.getElementById('notif-panel');
    if (panel && panel.style.display === 'block') renderNotifList();
  } catch (_) {}
}

// v242：版本更新偵測——落地 Node 後端每次 deploy 會重寫 server/public/version.json（buildId＝
// 前端內容 sha256，見 build-public.js），與舊 GitHub Pages 時代靠 HTTP last-modified 偵測的做法
// 不同（cutover 後 Node 靜態供應不送 last-modified，該手法早已失效）。GAS/Pages 環境沒有
// version.json 這條路由，直接略過；測試版（8788）與正式版都要偵測——deploy 後兩邊都可能還有
// 舊分頁開著，不再像舊版排除測試版。
async function checkForUpdate() {
  if (!IS_LOCAL_BACKEND) return;
  try {
    const base = APPS_SCRIPT_URL.replace(/\/exec$/, '');
    const resp = await fetch(base + '/version.json', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || !data.buildId) return;
    if (_appBuildId === null) {
      _appBuildId = data.buildId; // 第一次拿到：記住當下版本，不視為「有更新」
    } else if (data.buildId !== _appBuildId) {
      _updateAvailable = true;
      renderNotifBell();
      const panel = document.getElementById('notif-panel');
      if (panel && panel.style.display !== 'none') renderNotifList();
      _forceUpdateReload();
    }
  } catch (_) {}
}

// v242：偵測到新版後，全螢幕蓋板強制倒數 30 秒自動重新整理——避免有人繼續在已被伺服器換新的
// 舊前端上工作（欄位/流程對不上新版後端，可能造成資料不一致）。刻意不提供「稍後再說」：
// session／PIN 解鎖與表單草稿本來就存在 localStorage，重整後會自動恢復，延後只會拖長舊版
// 曝險時間，沒有對應的好處。_updateReloadShown 防重入——輪詢（setInterval）與 SSE onopen
// 都可能在短時間內各自呼叫到 checkForUpdate，避免疊加出兩層蓋板。
function _forceUpdateReload() {
  if (_updateReloadShown) return;
  _updateReloadShown = true;
  let seconds = 30;
  const ov = document.createElement('div');
  ov.id = '_force-update-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.82);display:flex;align-items:center;justify-content:center;padding:20px;';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:420px;width:100%;padding:28px 26px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.35);">
      <div style="font-size:1.15rem;font-weight:700;color:#2d3748;margin-bottom:10px;">🔄 系統已更新</div>
      <div style="font-size:.9rem;color:#4a5568;line-height:1.7;margin-bottom:16px;">系統剛發布了新版本，為避免繼續使用舊版造成不一致，將於 <span id="_force-update-countdown">${seconds}</span> 秒後自動重新整理。頁面重整後會自動回到登入狀態。<strong>正在填寫的表單內容系統每 5 秒會自動暫存在本機，並定期同步到伺服器</strong>，重整後重新開啟該表單即可還原，請放心。</div>
      <button onclick="location.reload()" style="padding:9px 28px;background:#2b6cb0;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.9rem;font-weight:600;">立即重新整理</button>
    </div>`;
  document.body.appendChild(ov);
  const countdownEl = document.getElementById('_force-update-countdown');
  const timer = setInterval(() => {
    seconds -= 1;
    if (countdownEl) countdownEl.textContent = String(Math.max(seconds, 0));
    if (seconds <= 0) { clearInterval(timer); location.reload(); }
  }, 1000);
}

function toggleRecordExpand(rid) {
  const card = document.getElementById('rec-card-' + rid) || document.getElementById(rid);
  if (!card) return;
  const expanded = card.classList.toggle('rec-expanded');
  const btn = card.querySelector('.rec-toggle-btn');
  if (btn) btn.textContent = expanded ? '收合 ▲' : '展開 ▼';
  if (expanded) {
    _loadRecordImages(rid);
    // B5：展開紀錄卡片 → 逐筆稽核（晤談紀錄／事件處理／精神科醫師評估／初次晤談表；不去重，每次展開都記，
    // detail 含該筆紀錄的日期時間）。只在「展開」時記，收合不記（見下方 if(expanded)）。
    try {
      const dc = (casesData || []).find(c => c.id === _detailCaseId); // 修正：用模組變數
      if (dc) {
        const ridStr = String(rid);
        const bare = ridStr.replace(/^rec-card-/, '').replace(/^psy-ded-/, '');
        const psyRec = (dc.psychiatristRecords || []).find(r => r.id === bare);
        const talkRec = (dc.records || []).find(r => r.id === bare);
        let label = '個案紀錄', dateDetail = '';
        if (/psy/i.test(ridStr) || psyRec) {
          label = '精神科醫師評估';
          dateDetail = psyRec?.date || '';
        } else if (/ii|initial/i.test(ridStr)) {
          label = '初次晤談表';
          const ii = _getCaseII(dc, _caseDetailActiveSem);
          dateDetail = (ii?.createdAt || '').slice(0, 10);
        } else if (talkRec) {
          label = talkRec.isEventRecord ? '事件處理記錄' : '晤談紀錄';
          const t = talkRec.time ? (talkRec.time.startsWith('其他：') ? talkRec.time.slice(3) : talkRec.time) : '';
          dateDetail = [talkRec.date, t].filter(Boolean).join(' ');
        }
        const detail = dateDetail ? `展開${label}（${dateDetail}）` : `展開${label}`;
        auditLog('查閱個案—展開' + label, dc.id, bare, detail); // 直接寫入，不經 _auditCaseSectionView 去重
      }
    } catch (_) {}
  }
}

// 點擊卡片頂端 banner 也可收合/展開；保留拖曳反白選字（有選取範圍或點在按鈕等互動元件上則不觸發）
function _bannerToggle(event, rid) {
  if (window.getSelection && String(window.getSelection()) !== '') return;
  if (event.target.closest('button, a, input, textarea, select, label')) return;
  toggleRecordExpand(rid);
}

function toggleSortLock() {
  sortStatusLocked = !sortStatusLocked;
  localStorage.setItem('scc_sort_status_locked', sortStatusLocked);
  syncUserPref_({ sortStatusLocked });
  renderCases();
}
let _casesCompact = localStorage.getItem('scc_cases_compact') === '1';
function toggleCasesCompact() {
  _casesCompact = !_casesCompact;
  localStorage.setItem('scc_cases_compact', _casesCompact ? '1' : '0');
  const wrap = document.getElementById('cases-table-wrap');
  if (wrap) wrap.classList.toggle('cases-compact', _casesCompact);
  const btn = document.getElementById('btn-cases-compact');
  if (btn) btn.textContent = _casesCompact ? '緊湊：開' : '緊湊：關';
}
function setCaseSort(col) {
  if (caseSort.col === col) { caseSort.dir *= -1; }
  else { caseSort.col = col; caseSort.dir = 1; }
  renderCases();
}
function sortArrow(col) {
  if (caseSort.col !== col) return '<span style="color:#c0cfe0;font-size:.75em;">↕</span>';
  return caseSort.dir === 1
    ? '<span style="color:#3182ce;font-size:.85em;">↑</span>'
    : '<span style="color:#3182ce;font-size:.85em;">↓</span>';
}

function statusBadge(status) {
  const map = { active: ['blue','進行中'], closed: ['gray','已結案'], pending: ['orange','待分配'] };
  const [cls, label] = map[status] || ['gray', status || '未知'];
  return `<span class="badge badge-${cls}">${escHtml(label)}</span>`;
}

