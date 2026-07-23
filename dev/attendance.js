// dev/attendance.js — 差勤系統群（拆 index.html 絞殺者第二十一刀，v268）。
// 內容為從 index.html 逐字搬出的連續區段（實習生差勤申請/差勤管理後台/實習生差勤
// 申請頁/我的差勤/打卡權杖免登入/本週差勤總覽/差勤匯總/出勤月報表列印/實習生專屬
// 打卡網址管理）。差勤資料載入（loadAttendance）、URL routing、併發安全清單寫入與
// config PATCH helper 等跨模組基礎留在主檔。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告；出勤月報表
// 的 HTML 樣板為 template literal 內容。函式內部呼叫時才引用主檔全域（attendanceData／
// configData／currentUser 等），跨 script 全域可見。
// ══════════════════════════════════════════════
//  實習生差勤申請（請假 / 補休）
// ══════════════════════════════════════════════
let _leavesSnapshot = [];
async function loadLeaves() {
  try {
    leavesData = await driveReadJson(LEAVES_FILE);
    if (!leavesData || !Array.isArray(leavesData.applications)) leavesData = { applications: [] };
  } catch {
    leavesData = { applications: [] };
  }
  _leavesSnapshot = _deepClone(leavesData.applications);
  _updateLeaveBadges();
}

// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的申請單，經 listCommit 依 id upsert/remove，
// 取代整檔覆寫（多人同時審核/申請時會互蓋）。後端未部署或無法安全 diff → fallback 整檔覆寫。
async function saveLeaves() {
  const diff = _diffListById(_leavesSnapshot, leavesData.applications);
  if (!diff) { await driveUpdateJsonFile(LEAVES_FILE, leavesData); _leavesSnapshot = _deepClone(leavesData.applications); return; }
  const res = await _listCommit(LEAVES_FILE, diff);
  if (res && res.fallback) { await driveUpdateJsonFile(LEAVES_FILE, leavesData); _leavesSnapshot = _deepClone(leavesData.applications); return; }
  if (res && res.data && Array.isArray(res.data.applications)) {
    leavesData.applications = res.data.applications;
    _leavesSnapshot = _deepClone(leavesData.applications);
  }
}

// 預設假別（首次無設定時用）；deductsQuota=是否扣抵額度
const DEFAULT_LEAVE_TYPES = [
  { id: 'summer',   name: '暑休',   unit: 'hour', deductsQuota: true,  defaultQuotaHours: 40, order: 1, periodStart: '07-01', periodEnd: '08-31' },
  { id: 'personal', name: '事假',   unit: 'hour', deductsQuota: false, defaultQuotaHours: 0,  order: 2 },
  { id: 'sick',     name: '病假',   unit: 'hour', deductsQuota: false, defaultQuotaHours: 0,  order: 3 },
  { id: 'official', name: '公假',   unit: 'hour', deductsQuota: false, defaultQuotaHours: 0,  order: 4 },
  // 加班補休：額度為「已認證加班時數 − 已用補休」，非固定額度（isComp）
  { id: 'comp',     name: '加班補休', unit: 'hour', deductsQuota: true, isComp: true, defaultQuotaHours: 0, order: 5 },
];
const WORK_HOURS_NORMAL = 9; // 簽到到簽退滿 9 小時為正常出勤（午休不另扣）

function getLeaveTypes() {
  const lt = configData?.leaveTypes;
  if (Array.isArray(lt) && lt.length) return [...lt].sort((a, b) => (a.order || 0) - (b.order || 0));
  return DEFAULT_LEAVE_TYPES;
}

function getLeaveType(id) {
  return getLeaveTypes().find(t => t.id === id) || null;
}

// ── 假別申請期間限制（MM-DD）：如暑休僅 07-01 ~ 08-31 可申請 ──
function _isValidMMDD(s) {
  if (!/^\d{2}-\d{2}$/.test(s || '')) return false;
  const mm = Number(s.slice(0, 2)), dd = Number(s.slice(3));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}
function _leavePeriodLabel(t) {
  return (t && _isValidMMDD(t.periodStart) && _isValidMMDD(t.periodEnd)) ? `${t.periodStart} ~ ${t.periodEnd}` : '全年';
}
// 某日期（YYYY-MM-DD）是否落在假別的可申請期間內；無設定則全年皆可。支援跨年區間（如 12-01 ~ 01-31）
function _dateInLeavePeriod(t, yyyymmdd) {
  if (!t || !_isValidMMDD(t.periodStart) || !_isValidMMDD(t.periodEnd)) return true;
  const md = (yyyymmdd || '').slice(5); // MM-DD
  if (!/^\d{2}-\d{2}$/.test(md)) return true;
  const s = t.periodStart, e = t.periodEnd;
  return s <= e ? (md >= s && md <= e) : (md >= s || md <= e);
}
// 週期型假別「當前這次週期」的實際日期區間 [start,end]（YYYY-MM-DD），以 refDate（預設今天）為基準
// 用於年度額度自動化：暑休 40hr 每年 7/1 自動回滿——已用時數只計本次週期內的申請，無需主動配額、無重複配風險
function _leavePeriodWindow(t, refDate) {
  if (!t || !_isValidMMDD(t.periodStart) || !_isValidMMDD(t.periodEnd)) return null;
  const ref = refDate || _fmtDate(new Date());
  const year = Number(ref.slice(0, 4));
  const md = ref.slice(5);
  const s = t.periodStart, e = t.periodEnd;
  if (s <= e) return { start: `${year}-${s}`, end: `${year}-${e}` }; // 同年區間，如 07-01~08-31
  // 跨年區間，如 12-01~01-31：ref 落在年初側時，週期起點為前一年
  const startYear = (md >= s) ? year : year - 1;
  return { start: `${startYear}-${s}`, end: `${startYear + 1}-${e}` };
}
// 週期型假別的年度標籤（如「2026 年暑休」），供 UI 顯示；非週期型回空字串
function _leavePeriodYearLabel(t, refDate) {
  const win = _leavePeriodWindow(t, refDate);
  return win ? `${win.start.slice(0, 4)} 年${t.name}期間` : '';
}

// 取得某實習生某假別的額度（小時）：優先 per-user 設定，否則用假別預設
function _leaveQuotaHours(email, leaveTypeId) {
  const userQuota = configData?.users?.[email]?.leaveQuota;
  if (userQuota && userQuota[leaveTypeId] != null) return Number(userQuota[leaveTypeId]) || 0;
  const t = getLeaveType(leaveTypeId);
  return t ? (Number(t.defaultQuotaHours) || 0) : 0;
}

// 已使用時數（approved + pending 皆視為已佔用，避免重複申請超額）
// 週期型假別（如暑休）只計「本次週期視窗」內的申請 → 額度每年自動刷新（年度額度自動化）
function _leaveUsedHours(email, leaveTypeId, excludeId, refDate) {
  const t = getLeaveType(leaveTypeId);
  const win = t ? _leavePeriodWindow(t, refDate) : null;
  return (leavesData?.applications || [])
    .filter(a => a.email === email && a.leaveTypeId === leaveTypeId &&
      (a.status === 'approved' || a.status === 'pending') && a.id !== excludeId &&
      (!win || (a.fromDate >= win.start && a.fromDate <= win.end)))
    .reduce((s, a) => s + (Number(a.hours) || 0), 0);
}

// 剩餘時數（不扣抵的假別回傳 null 表示無上限；加班補休依已認證加班動態計算）
function _leaveRemaining(email, leaveTypeId, excludeId) {
  const t = getLeaveType(leaveTypeId);
  if (!t || !t.deductsQuota) return null;
  if (t.isComp) return _compRemaining(email, excludeId);
  return _leaveQuotaHours(email, leaveTypeId) - _leaveUsedHours(email, leaveTypeId, excludeId);
}

// ── 加班補休餘額：已認證加班（kind=overtime, approved）− 已用補休（comp 假別, approved+pending）──
function _compEarnedHours(email) {
  return (leavesData?.applications || [])
    .filter(a => a.email === email && a.kind === 'overtime' && a.status === 'approved')
    .reduce((s, a) => s + (Number(a.hours) || 0), 0);
}
function _compUsedHours(email, excludeId) {
  const compType = getLeaveTypes().find(t => t.isComp);
  if (!compType) return 0;
  return (leavesData?.applications || [])
    .filter(a => a.email === email && a.kind !== 'overtime' && a.leaveTypeId === compType.id &&
      (a.status === 'approved' || a.status === 'pending') && a.id !== excludeId)
    .reduce((s, a) => s + (Number(a.hours) || 0), 0);
}
function _compRemaining(email, excludeId) {
  return _compEarnedHours(email) - _compUsedHours(email, excludeId);
}

// ── 每日打卡工時（工時 = 當日最後一次打卡 − 第一次打卡；≥9hr 為正常）──
function _dailyWorkHours(email, yyyymm) {
  const recs = (attendanceData?.records || []).filter(r => r.email === email && (!yyyymm || (r.date || '').startsWith(yyyymm)));
  const byDate = {};
  recs.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r.timestamp); });
  return Object.entries(byDate).map(([date, ts]) => {
    ts.sort();
    const first = ts[0], last = ts[ts.length - 1];
    const hours = ts.length >= 2 ? Math.round((new Date(last) - new Date(first)) / 3600000 * 10) / 10 : 0;
    return { date, first, last, count: ts.length, hours, normal: hours >= WORK_HOURS_NORMAL };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function _updateLeaveBadges() {
  // 督導/主任：待審核件數；實習生：自己被駁回未讀（簡化以待辦呈現，這裡僅更新後台 tab 數字）
  const isMgr = currentRole === '主任' || extraRole === '管理者' || isInternAdminSupervisor || isInternProSupervisor;
  const pendingCount = isMgr ? (leavesData?.applications || []).filter(a => a.status === 'pending').length : 0;
  const el = document.getElementById('nav-leave-review-badge');
  if (el) { el.textContent = pendingCount; el.style.display = pendingCount > 0 ? '' : 'none'; }
}

// ── 共用小工具 ──
function _leaveStatusBadge(s) {
  const m = { pending: ['待審核', '#dd6b20', '#fffaf0'], approved: ['已核准', '#276749', '#f0fff4'], rejected: ['已駁回', '#c53030', '#fff5f5'], cancelled: ['已取消', '#718096', '#f7fafc'] };
  const [t, c, bg] = m[s] || [s, '#718096', '#f7fafc'];
  return `<span style="background:${bg};color:${c};border:1px solid ${c}55;border-radius:10px;padding:1px 8px;font-size:.75rem;font-weight:600;">${t}</span>`;
}
function _fmtLeaveHours(h) {
  const n = Number(h) || 0;
  const days = n / INTERN_HOURS_PER_DAY;
  return Number.isInteger(days) && days >= 1 ? `${n} 小時（${days} 天）` : `${n} 小時`;
}
function _leaveReviewerEmails() {
  return Object.entries(configData?.users || {})
    .filter(([, u]) => u.extraRole === '實習生行政督導' || u.extraRole === '實習生專業督導')
    .map(([email]) => email);
}
function _directorEmails() {
  return Object.entries(configData?.users || {})
    .filter(([, u]) => u.role === '主任')
    .map(([email]) => email);
}
function _userName(email) {
  return configData?.users?.[email]?.name || email;
}

// ══════════════════════════════════════════════
//  差勤管理後台（分頁）
// ══════════════════════════════════════════════
let _attMgrTab = 'punch';
function renderAttendanceMgr() {
  const bar = document.getElementById('att-mgr-tabs');
  const tabs = [
    { id: 'punch',   label: '打卡紀錄' },
    { id: 'summary', label: '差勤匯總' },
    { id: 'review',  label: '請假審核' },
    { id: 'types',   label: '假別與班表' },
  ];
  const pend = (leavesData?.applications || []).filter(a => a.status === 'pending').length;
  if (bar) {
    bar.innerHTML = tabs.map(t => {
      const active = _attMgrTab === t.id;
      const badge = (t.id === 'review' && pend > 0) ? ` <span style="background:#dd6b20;color:#fff;border-radius:10px;padding:0 6px;font-size:.72rem;">${pend}</span>` : '';
      return `<button type="button" onclick="_attMgrTab='${t.id}';renderAttendanceMgr()" style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:.9rem;font-weight:${active ? '700' : '500'};color:${active ? '#2b6cb0' : '#718096'};border-bottom:3px solid ${active ? '#2b6cb0' : 'transparent'};margin-bottom:-2px;">${t.label}${badge}</button>`;
    }).join('');
  }
  const geo = document.getElementById('geo-fence-card');
  const clockTokenCard = document.getElementById('clock-token-card');
  if (_attMgrTab === 'punch') {
    renderAttendancePage();
    if (typeof _initGeoFenceCard === 'function') _initGeoFenceCard();
    if (typeof _initClockTokenCard === 'function') _initClockTokenCard();
  } else {
    if (geo) geo.style.display = 'none';
    if (clockTokenCard) clockTokenCard.style.display = 'none';
    if (_attMgrTab === 'summary') renderAttendanceSummary();
    else if (_attMgrTab === 'review') renderLeaveReview();
    else if (_attMgrTab === 'types') renderLeaveTypesAdmin();
  }
}

// ── 請假審核 tab ──
function renderLeaveReview() {
  const body = document.getElementById('attendance-body');
  if (!body) return;
  const apps = [...(leavesData?.applications || [])].sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));
  const pending = apps.filter(a => a.status === 'pending');
  const decided = apps.filter(a => a.status !== 'pending');
  const row = (a, showActions) => {
    const isOt = a.kind === 'overtime';
    const typeCell = isOt
      ? '<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:.74rem;font-weight:600;">加班登記</span>'
      : escHtml(a.leaveTypeName);
    return `
    <tr>
      <td>${escHtml(a.name || a.email)}</td>
      <td>${typeCell}</td>
      <td>${escHtml(_leaveDateTimeStr(a))}</td>
      <td style="text-align:right;">${_fmtLeaveHours(a.hours)}</td>
      <td>${escHtml(a.reason || '—')}${renderAttachChips(a.attachments)}</td>
      <td>${_leaveStatusBadge(a.status)}${a.reviewedByName ? `<div style="font-size:.72rem;color:#718096;margin-top:2px;">${escHtml(a.reviewedByName)}</div>` : ''}${a.reviewNote ? `<div style="font-size:.72rem;color:#c05621;margin-top:2px;">備註：${escHtml(a.reviewNote)}</div>` : ''}</td>
      <td style="white-space:nowrap;">${showActions
        ? `<button class="btn btn-primary btn-sm leave-review-btn" style="font-size:.76rem;" onclick="approveLeave('${a.id}', event)">${isOt ? '認證' : '核准'}</button>
           <button class="btn btn-danger btn-sm leave-review-btn" style="font-size:.76rem;margin-left:4px;" onclick="rejectLeave('${a.id}', event)">${isOt ? '不予認證' : '駁回'}</button>`
        : '—'}</td>
    </tr>`;
  };
  body.innerHTML = `
    <div style="margin-bottom:8px;font-weight:600;color:#dd6b20;">待審核（${pending.length}）</div>
    <div style="overflow-x:auto;margin-bottom:24px;">
      <table class="data-table" style="min-width:720px;">
        <thead><tr><th>實習生</th><th>假別</th><th>日期</th><th style="text-align:right;">時數</th><th>事由</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>${pending.length ? pending.map(a => row(a, true)).join('') : '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px;">目前沒有待審核申請</td></tr>'}</tbody>
      </table>
    </div>
    <div style="margin-bottom:8px;font-weight:600;color:#718096;">已處理（最近）</div>
    <div style="overflow-x:auto;">
      <table class="data-table" style="min-width:720px;">
        <thead><tr><th>實習生</th><th>假別</th><th>日期</th><th style="text-align:right;">時數</th><th>事由</th><th>狀態</th><th></th></tr></thead>
        <tbody>${decided.length ? decided.slice(0, 50).map(a => row(a, false)).join('') : '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px;">尚無已處理紀錄</td></tr>'}</tbody>
      </table>
    </div>`;
}

let _leaveReviewBusy = false;
// 處理審核動作時鎖定所有審核按鈕並把點到的那顆標示為處理中，避免重複點擊
function _lockReviewBtns(clickedEl, busyText) {
  document.querySelectorAll('.leave-review-btn').forEach(b => {
    b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'wait';
  });
  if (clickedEl) { clickedEl.style.opacity = '1'; clickedEl.textContent = busyText; }
}

async function approveLeave(id, ev) {
  if (_leaveReviewBusy) return;
  const app = (leavesData?.applications || []).find(a => a.id === id);
  if (!app || app.status !== 'pending') return;
  const isOt = app.kind === 'overtime';
  if (app.deductsQuota) {
    const remaining = _leaveRemaining(app.email, app.leaveTypeId, app.id);
    if (remaining != null && app.hours > remaining) {
      if (!confirm(`此申請 ${app.hours} 小時超出 ${app.name} 的剩餘額度（剩 ${remaining} 小時）。\n仍要核准嗎？（核准後將造成負額度）`)) return;
    }
  }
  _leaveReviewBusy = true;
  _lockReviewBtns(ev?.target, isOt ? '認證中…' : '核准中…');
  app.status = 'approved';
  app.reviewedBy = currentUser.email;
  app.reviewedByName = _userName(currentUser.email);
  app.reviewedAt = new Date().toISOString();
  const jobId = bgJobAdd(`${isOt ? '認證加班' : '核准差勤申請'}（${app.name}）`);
  try {
    await saveLeaves();
    await _notifyLeaveDecision(app, true);
    bgJobDone(jobId);
    showToast(isOt
      ? `✅ 已認證加班 ${app.hours} 小時，已累積為 ${app.name} 的補休。`
      : `✅ 已核准（${app.name}・${app.leaveTypeName} ${app.hours} 小時），並通知申請人與主任。`, 'success');
  } catch (e) { bgJobFail(jobId, e.message); app.status = 'pending'; showToast('核准失敗：' + e.message, 'error'); }
  _leaveReviewBusy = false;
  renderAttendanceMgr();
  _updateLeaveBadges();
}

async function rejectLeave(id, ev) {
  if (_leaveReviewBusy) return;
  const app = (leavesData?.applications || []).find(a => a.id === id);
  if (!app || app.status !== 'pending') return;
  const isOt = app.kind === 'overtime';
  const note = prompt(`請輸入${isOt ? '不予認證' : '駁回'}原因（將通知申請人）：`, '');
  if (note === null) return;
  _leaveReviewBusy = true;
  _lockReviewBtns(ev?.target, '處理中…');
  app.status = 'rejected';
  app.reviewedBy = currentUser.email;
  app.reviewedByName = _userName(currentUser.email);
  app.reviewedAt = new Date().toISOString();
  app.reviewNote = note.trim();
  const jobId = bgJobAdd(`${isOt ? '不予認證加班' : '駁回差勤申請'}（${app.name}）`);
  try {
    await saveLeaves();
    await _notifyLeaveDecision(app, false);
    bgJobDone(jobId);
    showToast(isOt ? `已不予認證（${app.name}），並通知申請人。` : `已駁回（${app.name}），並通知申請人。`, 'success');
  } catch (e) { bgJobFail(jobId, e.message); app.status = 'pending'; showToast('處理失敗：' + e.message, 'error'); }
  _leaveReviewBusy = false;
  renderAttendanceMgr();
  _updateLeaveBadges();
}

async function _notifyLeaveReviewers(app) {
  const isOt = app.kind === 'overtime';
  const dateStr = _leaveDateTimeStr(app);
  const label = isOt
    ? `加班登記待認證：${app.name} 登記加班 ${app.hours} 小時（${dateStr}）`
    : `差勤申請待審核：${app.name} 申請${app.leaveTypeName} ${app.hours} 小時（${dateStr}）`;
  const reviewers = _leaveReviewerEmails();
  await Promise.all(reviewers.map(email => _appendTodoToUser(email, {
    id: _genTodoId(), type: 'leave_pending_review',
    label, leaveId: app.id, createdAt: new Date().toISOString(), done: false, notifRead: false,
  }).catch(() => {})));
}

async function _notifyLeaveDecision(app, approved) {
  const isOt = app.kind === 'overtime';
  const targets = new Set([app.email]);
  if (approved) { _leaveReviewerEmails().forEach(e => targets.add(e)); _directorEmails().forEach(e => targets.add(e)); }
  const verb = isOt ? (approved ? '已認證' : '不予認證') : (approved ? '已核准' : '已駁回');
  const what = isOt ? '加班登記' : app.leaveTypeName;
  const extra = isOt && approved ? `（+${app.hours} 小時補休）` : '';
  await Promise.all([...targets].map(email => _appendTodoToUser(email, {
    id: _genTodoId(), type: 'leave_approved_notify',
    label: `${isOt ? '加班登記' : '差勤申請'}${verb}：${app.name} ${what} ${app.hours} 小時（${_leaveDateTimeStr(app)}）${extra}${app.reviewNote ? '｜備註：' + app.reviewNote : ''}　審核：${app.reviewedByName || ''}`,
    leaveId: app.id, createdAt: new Date().toISOString(), done: false, notifRead: false,
  }).catch(() => {})));
}

// ── 假別與額度 tab ──
function renderLeaveTypesAdmin() {
  const body = document.getElementById('attendance-body');
  if (!body) return;
  const types = getLeaveTypes();
  const _pInput = (id, val) => `<input id="${id}" value="${escHtml(val || '')}" placeholder="MM-DD" maxlength="5" style="width:60px;padding:3px 5px;text-align:center;border:1px solid #cbd5e0;border-radius:6px;font-size:.8rem;">`;
  const typeRows = types.map(t => `
    <tr>
      <td><input id="lt_name_${t.id}" value="${escHtml(t.name)}" style="width:120px;padding:3px 6px;border:1px solid #cbd5e0;border-radius:6px;font-size:.85rem;">${t.isComp ? ' <span style="font-size:.7rem;color:#92400e;background:#fef3c7;border-radius:4px;padding:0 5px;">加班補休</span>' : ''}</td>
      <td style="text-align:center;">${t.isComp ? '<span style="color:#a0aec0;font-size:.8rem;">依認證</span>' : `<input type="checkbox" id="lt_deducts_${t.id}" ${t.deductsQuota ? 'checked' : ''} onchange="_ltRowToggle('${t.id}')">`}</td>
      <td style="text-align:right;">${t.isComp ? '<span style="color:#a0aec0;font-size:.8rem;">依加班認證</span>' : `<input type="number" min="0" step="1" id="lt_quota_${t.id}" value="${Number(t.defaultQuotaHours) || 0}" ${t.deductsQuota ? '' : 'disabled'} style="width:76px;padding:3px 6px;text-align:right;border:1px solid #cbd5e0;border-radius:6px;"> <span style="font-size:.72rem;color:#a0aec0;">h</span>`}</td>
      <td style="white-space:nowrap;">${_pInput('ltp_start_' + t.id, t.periodStart)} <span style="color:#a0aec0;">~</span> ${_pInput('ltp_end_' + t.id, t.periodEnd)}
        <div style="font-size:.68rem;color:#a0aec0;margin-top:2px;">留空＝全年；如暑休填 07-01 ~ 08-31</div></td>
      <td style="white-space:nowrap;"><button class="btn btn-primary btn-sm" style="font-size:.74rem;" onclick="saveLeaveType('${t.id}')">儲存</button>${t.isComp ? '' : ` <button class="btn btn-danger btn-sm" style="font-size:.74rem;" onclick="deleteLeaveType('${t.id}')">刪除</button>`}</td>
    </tr>`).join('');

  // 在任實習生 × 扣抵型假別 的額度設定
  const today = _fmtDate(new Date());
  const interns = Object.entries(configData?.users || {})
    .filter(([, u]) => u.role === '實習諮商心理師' && !u.disabled && _isInternActive(u, today))
    .map(([email, u]) => ({ email, name: u.name || email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  const deductTypes = types.filter(t => t.deductsQuota && !t.isComp); // 加班補休為動態餘額，不在此設定
  const quotaHead = deductTypes.map(t => `<th style="text-align:center;">${escHtml(t.name)}<div style="font-size:.7rem;color:#a0aec0;">預設 ${Number(t.defaultQuotaHours) || 0}h</div></th>`).join('');
  const quotaRows = interns.map(i => {
    const cells = deductTypes.map(t => {
      const q = _leaveQuotaHours(i.email, t.id);
      const used = _leaveUsedHours(i.email, t.id);
      return `<td style="text-align:center;">
        <input type="number" min="0" step="1" id="q_${i.email.replace(/[^a-zA-Z0-9]/g, '_')}_${t.id}" value="${q}" style="width:64px;padding:3px 6px;text-align:right;border:1px solid #cbd5e0;border-radius:6px;">
        <div style="font-size:.68rem;color:#718096;margin-top:2px;">已用 ${used}h</div>
      </td>`;
    }).join('');
    return `<tr><td style="white-space:nowrap;">${escHtml(i.name)}</td>${cells}<td><button class="btn btn-secondary btn-sm" style="font-size:.74rem;" onclick="saveInternQuota('${i.email}')">儲存</button></td></tr>`;
  }).join('');

  // 實習生晚班班表（v177）：全中心統一晚班時段 + 逐實習生勾晚班星期
  const esCfg = _getWorkHoursConfig().eveningShift || { start: 12, workEnd: 21 };
  const esHourOpts = n => Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === n ? ' selected' : ''}>${String(h).padStart(2,'0')}:00</option>`
  ).join('');
  const esDowLabels = ['週日','週一','週二','週三','週四','週五','週六'];
  const esDowOrder = [1,2,3,4,5,6,0]; // 顯示順序：週一~週日
  const eveningRows = interns.map(i => {
    const days = Array.isArray(configData?.users?.[i.email]?.eveningShiftDays) ? configData.users[i.email].eveningShiftDays : [];
    const cbs = esDowOrder.map(dow => `
      <td style="text-align:center;">
        <input type="checkbox" id="es_day_${_safeIdKey(i.email)}_${dow}" ${days.includes(dow) ? 'checked' : ''}>
      </td>`).join('');
    return `<tr><td style="white-space:nowrap;">${escHtml(i.name)}</td>${cbs}<td><button class="btn btn-secondary btn-sm" style="font-size:.74rem;" onclick="_saveInternEveningDays('${i.email}')">儲存</button></td></tr>`;
  }).join('');

  body.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>可申請假別</h3></div>
      <div style="padding:16px 20px;">
        <div style="overflow-x:auto;margin-bottom:16px;">
          <table class="data-table" style="min-width:600px;">
            <thead><tr><th>假別名稱</th><th>扣抵額度</th><th style="text-align:right;">預設額度</th><th>申請期間</th><th></th></tr></thead>
            <tbody>${typeRows}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;border-top:1px solid #edf2f7;padding-top:14px;">
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">新增假別名稱<span class="req">*</span></label>
            <input id="lt-name" class="field-input" placeholder="如：特休、勞動節公假" style="min-width:160px;"></div>
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">扣抵額度</label>
            <label style="font-size:.85rem;display:flex;align-items:center;gap:4px;height:38px;"><input type="checkbox" id="lt-deducts"> 此假別會扣抵額度</label></div>
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">預設額度（小時）</label>
            <input id="lt-quota" type="number" min="0" step="1" value="0" class="field-input" style="width:120px;"></div>
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">申請期間（MM-DD，可留空）</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <input id="lt-period-start" class="field-input" placeholder="07-01" maxlength="5" style="width:80px;text-align:center;">
              <span style="color:#a0aec0;">~</span>
              <input id="lt-period-end" class="field-input" placeholder="08-31" maxlength="5" style="width:80px;text-align:center;"></div></div>
          <button class="btn btn-primary btn-sm" onclick="addLeaveType()">新增假別</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>實習生額度設定（扣抵型假別）</h3></div>
      <div style="padding:16px 20px;">
        ${deductTypes.length === 0
          ? '<div style="color:#a0aec0;font-size:.9rem;">目前沒有扣抵型假別，請先於上方新增並勾選「扣抵額度」。</div>'
          : interns.length === 0
            ? '<div style="color:#a0aec0;font-size:.9rem;">目前沒有在任實習生。</div>'
            : `<p style="font-size:.82rem;color:#718096;margin-bottom:12px;">未設定者沿用假別預設額度。修改後請按該列「儲存」。<br>有申請期間的假別（如暑休）額度為<strong>年度制</strong>——「已用」只計本次期間，每年自動回滿，無需手動重配。</p>
               <div style="overflow-x:auto;">
                 <table class="data-table" style="min-width:480px;">
                   <thead><tr><th>實習生</th>${quotaHead}<th></th></tr></thead>
                   <tbody>${quotaRows}</tbody>
                 </table>
               </div>`}
      </div>
    </div>
    <div class="card" style="margin-top:20px;">
      <div class="card-header"><h3>實習生晚班班表</h3></div>
      <div style="padding:16px 20px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #edf2f7;">
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">晚班上班</label>
            <select id="es-start" class="field-select" style="width:auto;">${esHourOpts(esCfg.start)}</select></div>
          <span style="color:#a0aec0;padding-bottom:8px;">~</span>
          <div><label style="font-size:.8rem;color:#718096;display:block;margin-bottom:4px;">晚班下班</label>
            <select id="es-workend" class="field-select" style="width:auto;">${esHourOpts(esCfg.workEnd)}</select></div>
          <button class="btn btn-primary btn-sm" onclick="_adminSaveEveningShift()">儲存晚班時段</button>
          <span style="font-size:.76rem;color:#a0aec0;">（全中心統一，個人不可調；下方逐實習生只勾選「哪幾天算晚班日」）</span>
        </div>
        ${interns.length === 0
          ? '<div style="color:#a0aec0;font-size:.9rem;">目前沒有在任實習生。</div>'
          : `<div style="overflow-x:auto;">
               <table class="data-table" style="min-width:560px;">
                 <thead><tr><th>實習生</th>${esDowOrder.map(dow => `<th style="text-align:center;">${esDowLabels[dow]}</th>`).join('')}<th></th></tr></thead>
                 <tbody>${eveningRows}</tbody>
               </table>
             </div>`}
        <p style="font-size:.76rem;color:#a0aec0;margin-top:10px;">晚班日＝該生整日上班時段改為晚班時段，請假時數與請假表單預設起訖依此計算；寒暑假（學期時段外）晚班自動失效以一般時段計；此設定不影響非上班時間監督的判定。</p>
      </div>
    </div>`;
}

async function addLeaveType() {
  const name = (document.getElementById('lt-name')?.value || '').trim();
  if (!name) { alert('請輸入假別名稱'); return; }
  const deducts = !!document.getElementById('lt-deducts')?.checked;
  const quota = Number(document.getElementById('lt-quota')?.value) || 0;
  const pStart = (document.getElementById('lt-period-start')?.value || '').trim();
  const pEnd = (document.getElementById('lt-period-end')?.value || '').trim();
  if ((pStart || pEnd) && !(_isValidMMDD(pStart) && _isValidMMDD(pEnd))) { alert('申請期間需兩欄皆填且格式為 MM-DD（如 07-01），或兩欄皆留空。'); return; }
  if (!Array.isArray(configData.leaveTypes)) configData.leaveTypes = getLeaveTypes().map(t => ({ ...t }));
  if (configData.leaveTypes.some(t => t.name === name)) { alert('已有同名假別'); return; }
  const nt = {
    id: 'lt_' + Date.now().toString(36), name, unit: 'hour',
    deductsQuota: deducts, defaultQuotaHours: deducts ? quota : 0,
    order: configData.leaveTypes.length + 1,
  };
  if (_isValidMMDD(pStart) && _isValidMMDD(pEnd)) { nt.periodStart = pStart; nt.periodEnd = pEnd; }
  configData.leaveTypes.push(nt);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); auditLog('新增假別', null, null, name); renderLeaveTypesAdmin(); showToast('已新增假別', 'success'); }
  catch (e) { showToast('新增失敗：' + e.message, 'error'); }
}

async function deleteLeaveType(id) {
  const t = getLeaveType(id);
  if (!t) return;
  if (!confirm(`確定刪除假別「${t.name}」？\n已申請的紀錄不受影響，但日後無法再選此假別。`)) return;
  if (!Array.isArray(configData.leaveTypes)) configData.leaveTypes = getLeaveTypes().map(x => ({ ...x }));
  configData.leaveTypes = configData.leaveTypes.filter(x => x.id !== id);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); auditLog('刪除假別', null, null, t.name); renderLeaveTypesAdmin(); showToast('已刪除', 'success'); }
  catch (e) { showToast('刪除失敗：' + e.message, 'error'); }
}

// 扣抵額度勾選切換 → 預設額度輸入框啟用/停用
function _ltRowToggle(id) {
  const d = document.getElementById('lt_deducts_' + id)?.checked;
  const q = document.getElementById('lt_quota_' + id);
  if (q) { q.disabled = !d; if (!d) q.value = 0; }
}

// 儲存單一假別（名稱／扣抵額度／預設額度／申請期間一次存）；期間兩欄皆空＝清除限制
async function saveLeaveType(id) {
  const cur = getLeaveType(id);
  if (!cur) { alert('找不到假別'); return; }
  const name = (document.getElementById('lt_name_' + id)?.value || '').trim();
  if (!name) { alert('假別名稱不可空白'); return; }
  const isComp = !!cur.isComp;
  const deducts = isComp ? true : !!document.getElementById('lt_deducts_' + id)?.checked;
  const quota = Number(document.getElementById('lt_quota_' + id)?.value) || 0;
  const pStart = (document.getElementById('ltp_start_' + id)?.value || '').trim();
  const pEnd = (document.getElementById('ltp_end_' + id)?.value || '').trim();
  if ((pStart || pEnd) && !(_isValidMMDD(pStart) && _isValidMMDD(pEnd))) { alert('申請期間需兩欄皆填且格式為 MM-DD（如 07-01），或兩欄皆留空以清除限制。'); return; }
  if (!Array.isArray(configData.leaveTypes)) configData.leaveTypes = getLeaveTypes().map(x => ({ ...x }));
  if (configData.leaveTypes.some(x => x.id !== id && x.name === name)) { alert('已有同名假別'); return; }
  const t = configData.leaveTypes.find(x => x.id === id);
  if (!t) { alert('找不到假別'); return; }
  t.name = name;
  if (!isComp) { t.deductsQuota = deducts; t.defaultQuotaHours = deducts ? quota : 0; }
  if (_isValidMMDD(pStart) && _isValidMMDD(pEnd)) { t.periodStart = pStart; t.periodEnd = pEnd; }
  else { delete t.periodStart; delete t.periodEnd; }
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('編輯假別', null, null, `${t.name}：${isComp ? '依加班認證' : (t.deductsQuota ? t.defaultQuotaHours + 'h' : '不扣抵')}／期間 ${_leavePeriodLabel(t)}`);
    renderLeaveTypesAdmin();
    showToast(`已儲存「${t.name}」`, 'success');
  } catch (e) { showToast('儲存失敗：' + e.message, 'error'); }
}

async function saveInternQuota(email) {
  const deductTypes = getLeaveTypes().filter(t => t.deductsQuota);
  const key = email.replace(/[^a-zA-Z0-9]/g, '_');
  if (!configData.users[email]) { alert('找不到使用者'); return; }
  const quota = { ...(configData.users[email].leaveQuota || {}) };
  deductTypes.forEach(t => {
    const v = document.getElementById(`q_${key}_${t.id}`)?.value;
    if (v != null && v !== '') quota[t.id] = Number(v) || 0;
  });
  configData.users[email].leaveQuota = quota;
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); showToast(`已儲存 ${_userName(email)} 的額度`, 'success'); renderLeaveTypesAdmin(); }
  catch (e) { showToast('儲存失敗：' + e.message, 'error'); }
}

// ── 實習生晚班班表（v177）──────────────────────────
// 讀取某使用者的晚班設定：eveningShiftDays 非空陣列時回 { days, start, workEnd }（晚班時段一律讀全中心統一設定），
// 否則回 null（無晚班）。純函式 _dayWorkHours／_dayWorkStartEnd／_leaveWorkHours 不讀 configData，
// 一律由呼叫端（請假表單、後台預覽等）先呼叫本函式組好 evening 物件再傳入。
function _userEveningShift(email) {
  const days = configData?.users?.[email]?.eveningShiftDays;
  if (!Array.isArray(days) || !days.length) return null;
  const es = _getWorkHoursConfig().eveningShift || { start: 12, workEnd: 21 };
  return { days, start: es.start, workEnd: es.workEnd };
}

// 儲存全中心統一的晚班時段（後台「假別與班表」卡片頂部）
async function _adminSaveEveningShift() {
  const s = parseInt(document.getElementById('es-start')?.value, 10);
  const e = parseInt(document.getElementById('es-workend')?.value, 10);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return;
  if (s >= e) { alert('晚班上班時間須早於下班時間。'); return; }
  const cur = _getWorkHoursConfig();
  configData.workHoursConfig = { ...cur, eveningShift: { start: s, workEnd: e } };
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('設定晚班時段', null, null, `${String(s).padStart(2,'0')}:00 ~ ${String(e).padStart(2,'0')}:00`, { major: true });
    showToast('已儲存晚班時段', 'success');
    renderLeaveTypesAdmin();
  } catch (err) { showToast('儲存失敗：' + err.message, 'error'); }
}

// 儲存單一實習生的晚班星期（週幾勾選陣列；空陣列＝無晚班）
async function _saveInternEveningDays(email) {
  if (!configData.users?.[email]) { alert('找不到使用者'); return; }
  const days = [0,1,2,3,4,5,6].filter(dow => document.getElementById(`es_day_${_safeIdKey(email)}_${dow}`)?.checked);
  configData.users[email].eveningShiftDays = days;
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('設定實習生晚班日', null, null, `${_userName(email)}：${days.length ? days.map(d => '日一二三四五六'[d]).join('') : '（無晚班）'}`);
    showToast(`已儲存 ${_userName(email)} 的晚班日`, 'success');
    renderLeaveTypesAdmin();
  } catch (err) { showToast('儲存失敗：' + err.message, 'error'); }
}
function _safeIdKey(email) { return String(email || '').replace(/[^a-zA-Z0-9]/g, '_'); }

// ══════════════════════════════════════════════
//  實習生差勤申請頁
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
//  我的差勤（原「差勤申請」頁；改為 tab 結構：本週差勤／請假申請／月報表。
//  「打卡」分頁於 v133 依使用者決定移除——打卡走 nav「差勤打卡」頁或 ?page=clock 快速打卡頁）
// ══════════════════════════════════════════════
let _myAttTab = 'week';
let _myAttTabRestored = false;
const _MYATT_TABS = [
  { id: 'week',   label: '差勤總覽' },
  { id: 'apply',  label: '請假申請' },
  { id: 'report', label: '月報表' },
];
function renderLeaveApplyPage() {
  const body = document.getElementById('leave-apply-body');
  if (!body) return;
  const isIntern = currentRole === '實習諮商心理師';
  const _isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canApply = isIntern || _isAdmin || isInternAdminSupervisor || isInternProSupervisor;
  if (!canApply) { body.innerHTML = '<div class="alert alert-info">此頁僅供實習生查看／申請差勤。</div>'; return; }
  // 第一次渲染時從 config 還原上次所在的 tab（比照 _mlTabRestored／_bkPageTabRestored 的既有模式）
  if (!_myAttTabRestored) {
    _myAttTabRestored = true;
    const saved = configData?.users?.[currentUser?.email]?.myAttTab;
    if (saved && _MYATT_TABS.some(t => t.id === saved)) _myAttTab = saved;
  }
  body.innerHTML = `
    <div style="display:flex;gap:2px;border-bottom:2px solid #e2e8f0;margin-bottom:20px;">
      ${_MYATT_TABS.map(t => _myAttTabBtn(t.id, t.label)).join('')}
    </div>
    <div id="myatt-tab-content"></div>`;
  _myAttRenderTab();
}
function _myAttTabBtn(id, label) {
  const active = _myAttTab === id;
  return `<button onclick="_myAttSwitchTab('${id}')" style="padding:8px 18px;border:none;cursor:pointer;background:none;font-size:.9rem;font-weight:${active ? 700 : 500};border-bottom:3px solid ${active ? '#2b6cb0' : 'transparent'};color:${active ? '#2b6cb0' : '#718096'};margin-bottom:-2px;">${label}</button>`;
}
function _myAttSwitchTab(id) {
  _myAttTab = id;
  syncUserPref_({ myAttTab: id });
  renderLeaveApplyPage(); // 整頁重繪（含 tab 列），active 底線才會跟著移動
}
function _myAttRenderTab() {
  const el = document.getElementById('myatt-tab-content');
  if (!el) return;
  if (_myAttTab === 'week') _myAttRenderWeekTab(el);
  else if (_myAttTab === 'apply') _myAttRenderApplyTab(el);
  else _myAttRenderReportTab(el);
}

// ── 差勤總覽 tab（原「本週差勤」，v246 改版）：本週概況（與差勤管理共用 renderWeekAttendanceOverview，
//    只傳入自己的 email）＋下方新增「我的打卡紀錄」查詢——可自選日期區間，嚴格只列自己的紀錄 ──
function _myAttRenderWeekTab(el) {
  el.innerHTML = `
    <div id="myatt-week-overview"></div>
    <div class="card" style="margin-top:20px;">
      <div class="card-header"><h3>我的打卡紀錄</h3></div>
      <div style="padding:16px 20px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
          <div><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">起日</label>
            <input id="myatt-punch-from" type="date" class="field-input" onchange="_myAttRenderPunchList()"></div>
          <div><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">迄日</label>
            <input id="myatt-punch-to" type="date" class="field-input" onchange="_myAttRenderPunchList()"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="_myAttPunchQuick('today')">今天</button>
            <button class="btn btn-secondary btn-sm" onclick="_myAttPunchQuick('week')">本週</button>
            <button class="btn btn-secondary btn-sm" onclick="_myAttPunchQuick('month')">本月</button>
            <button class="btn btn-secondary btn-sm" onclick="_myAttPunchQuick('all')">全部</button>
          </div>
        </div>
        <div id="myatt-punch-list"></div>
      </div>
    </div>`;
  renderWeekAttendanceOverview('myatt-week-overview', [currentUser.email]);
  // 預設區間＝本週（週一~今日），比照上方「本週概況」的週期一致
  const wk = _myAttPunchQuickRange('week', _fmtDate(new Date()));
  const fromEl = document.getElementById('myatt-punch-from');
  const toEl   = document.getElementById('myatt-punch-to');
  if (fromEl) fromEl.value = wk.from;
  if (toEl)   toEl.value   = wk.to;
  _myAttRenderPunchList();
}
// 快捷鈕：today／week／month／all（全部＝清空起訖不限制），切換後即重繪並把值塞回 input
function _myAttPunchQuick(kind) {
  const range = _myAttPunchQuickRange(kind, _fmtDate(new Date()));
  const fromEl = document.getElementById('myatt-punch-from');
  const toEl   = document.getElementById('myatt-punch-to');
  if (fromEl) fromEl.value = range.from;
  if (toEl)   toEl.value   = range.to;
  _myAttRenderPunchList();
}
// 依目前 from/to 輸入值重繪「我的打卡紀錄」表格。安全注意：即使呼叫端傳錯 email 也無妨——
// 這裡永遠以 currentUser.email 過濾，絕不可能列出他人打卡紀錄。
function _myAttRenderPunchList() {
  const listEl = document.getElementById('myatt-punch-list');
  if (!listEl) return;
  const from = document.getElementById('myatt-punch-from')?.value || '';
  const to   = document.getElementById('myatt-punch-to')?.value   || '';
  if (from && to && from > to) {
    listEl.innerHTML = '<div class="alert alert-info">迄日不可早於起日，請重新選擇日期區間。</div>';
    return;
  }
  const allRecords = attendanceData?.records || [];
  // 供 _punchLabel 判斷簽到/簽退用：取本人「全部」紀錄（不受畫面篩選區間影響），避免區間邊界誤判
  const myAllRecords = allRecords.filter(r => r.email === currentUser.email);
  const rows = _myAttFilterPunchRecords(myAllRecords, currentUser.email, from, to);
  listEl.innerHTML = `
    <div style="font-size:.82rem;color:#718096;margin-bottom:8px;">共 ${rows.length} 筆</div>
    <div style="overflow-x:auto;">
      <table class="data-table" style="min-width:440px;">
        <thead><tr><th>日期</th><th>類型</th><th>時間</th><th>定位</th></tr></thead>
        <tbody>
          ${rows.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px;">此區間無打卡紀錄</td></tr>'
            : rows.map(r => {
                const { icon, text, color } = _punchLabel(r, myAllRecords);
                return `<tr>
                  <td>${escHtml(r.date || '')}</td>
                  <td><span style="font-weight:600;color:${color}">${icon} ${text}</span>${r.manual ? ' <span style="font-size:.7rem;color:#6b46c1;background:#e9d8fd;border-radius:4px;padding:0 5px;" title="手動補登">手動</span>' : ''}</td>
                  <td>${new Date(r.timestamp).toLocaleString('zh-TW')}</td>
                  <td>${_attLocBadgeHtml(r)}${_attManualBadgeHtml(r)}${(r.manual && r.manualNote) ? `<div style="font-size:.72rem;color:#6b46c1;margin-top:2px;">備註：${escHtml(r.manualNote)}</div>` : ''}</td>
                </tr>`;
              }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 請假申請 tab：新增差勤申請表單＋我的申請紀錄（原「差勤申請」頁內容，只搬位置不改行為）──
function _myAttRenderApplyTab(el) {
  const isIntern = currentRole === '實習諮商心理師';
  const _adminNote = isIntern ? '' : '<div class="alert alert-info" style="margin-bottom:16px;">您以管理者／督導身分檢視此頁；送出的申請會以您的帳號建立（供驗證用）。</div>';
  const types = getLeaveTypes();
  const myApps = (leavesData?.applications || [])
    .filter(a => a.email === currentUser.email)
    .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));
  const typeOpts = types.map(t => `<option value="${t.id}">${escHtml(t.name)}${t.isComp ? '（用補休）' : t.deductsQuota ? '（扣抵額度）' : ''}</option>`).join('');
  const today = _fmtDate(new Date());
  const _todayWork = _dayWorkStartEnd(_getWorkHoursConfig(), today, _userEveningShift(currentUser?.email)); // 起訖時間預設值＝今日上班起訖（含本人晚班設定）
  const myRows = myApps.length ? myApps.map(a => `
    <tr>
      <td>${escHtml(a.leaveTypeName)}</td>
      <td>${escHtml(_leaveDateTimeStr(a))}</td>
      <td style="text-align:right;">${_fmtLeaveHours(a.hours)}</td>
      <td>${escHtml(a.reason || '—')}${renderAttachChips(a.attachments)}</td>
      <td>${_leaveStatusBadge(a.status)}${a.reviewNote ? `<div style="font-size:.72rem;color:#c05621;margin-top:2px;">備註：${escHtml(a.reviewNote)}</div>` : ''}</td>
      <td>${a.status === 'pending' ? `<button class="btn btn-secondary btn-sm" style="font-size:.74rem;" onclick="cancelLeave('${a.id}')">取消</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:#a0aec0;padding:20px;">尚無申請紀錄</td></tr>';

  el.innerHTML = `
    ${_adminNote}
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>新增差勤申請</h3></div>
      <div style="padding:16px 20px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">類型</label>
            <select id="la-kind" class="field-select" style="min-width:130px;" onchange="_laKindChange()">
              <option value="leave">請假 / 補休</option>
              <option value="overtime">加班登記</option>
              <option value="manual">手動打卡</option>
            </select></div>
          <div id="la-type-row"><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">假別<span class="req">*</span></label>
            <select id="la-type" class="field-select" style="min-width:170px;" onchange="_laUpdateRemaining()">${typeOpts}</select></div>
          <div><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;"><span id="la-from-label">開始（日期／時間）</span><span class="req">*</span></label>
            <div style="display:flex;gap:4px;">
              <input id="la-from" type="date" class="field-input" value="${today}" onchange="_laFromDateChange()">
              ${_laTimeSelectsHtml('la-from-time', _todayWork.start)}
            </div></div>
          <div id="la-end-row"><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">結束（日期／時間）</label>
            <div style="display:flex;gap:4px;">
              <input id="la-to" type="date" class="field-input" value="${today}" onchange="_laToDateChange()">
              ${_laTimeSelectsHtml('la-to-time', _todayWork.end)}
            </div></div>
          <div id="la-hours-row"><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">時數（小時，系統自動計算）</label>
            <input id="la-hours" type="number" class="field-input" style="width:110px;background:#f7fafc;cursor:not-allowed;" readonly tabindex="-1" title="依起訖日期時間自動計算，已扣除非上班時段與午休" placeholder="0"></div>
        </div>
        <div id="la-hint-hours" style="font-size:.76rem;color:#a0aec0;margin-top:6px;">時數依起訖日期／時間自動換算（例：08:00–12:00 = 4 小時），已扣除非上班時段與午休，不可手動修改。整天請假可只填日期。</div>
        <div id="la-hint-manual" style="display:none;font-size:.76rem;color:#a0aec0;margin-top:6px;">補登一筆打卡紀錄（如忘記簽到／簽退）。系統會依當日打卡時間先後自動判定簽到／簽退，如同打卡機。手動補登的紀錄會標記為「手動」供督導稽核。</div>
        <div id="la-remaining" style="font-size:.82rem;color:#2b6cb0;margin-top:10px;"></div>
        <div style="margin-top:10px;"><label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">事由</label>
          <textarea id="la-reason" class="field-input" rows="2" style="width:100%;max-width:520px;" placeholder="請簡述事由"></textarea></div>
        <div id="attachPicker_la" style="margin-top:12px;max-width:520px;"></div>
        <button id="la-submit-btn" class="btn btn-primary" style="margin-top:14px;" onclick="submitLeave()">送出申請</button>
        <div id="la-msg" style="display:none;margin-top:12px;max-width:520px;" class="alert"></div>
        <div style="font-size:.78rem;color:#a0aec0;margin-top:8px;">送出後將通知督導審核；任一督導核准即生效，並通知您與主任。加班登記經督導認證後才會累積為補休時數。</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>我的申請紀錄</h3></div>
      <div style="padding:16px 20px;overflow-x:auto;">
        <table class="data-table" style="min-width:560px;">
          <thead><tr><th>假別</th><th>日期</th><th style="text-align:right;">時數</th><th>事由</th><th>狀態</th><th></th></tr></thead>
          <tbody>${myRows}</tbody>
        </table>
      </div>
    </div>`;
  _laKindChange();
  _laAutoHours();   // 依預設起訖日期/時間算出初始時數（la-hours 唯讀，需在此先算好）
  attachInit('la', [], { dropTargets: ['la-reason'] });
}

// ── 月報表 tab：本月打卡工時＋月份選擇＋列印（共用 printAttendanceMonthlyReport，只有自己的資料）──
function _myAttRenderReportTab(el) {
  const today = _fmtDate(new Date());
  const thisMonth = today.slice(0, 7);
  const compRemain = _compRemaining(currentUser.email);
  const workDays = _dailyWorkHours(currentUser.email, thisMonth);
  const workRows = workDays.length ? workDays.map(d => `
    <tr>
      <td>${escHtml(d.date)}</td>
      <td>${d.first ? _fmtTime(d.first) : '—'}</td>
      <td>${d.count >= 2 ? _fmtTime(d.last) : '—'}</td>
      <td style="text-align:right;">${d.count >= 2 ? d.hours + ' 小時' : '單筆打卡'}</td>
      <td>${d.count >= 2 ? (d.normal ? '<span style="color:#276749;">正常</span>' : '<span style="color:#c05621;">不足 ' + WORK_HOURS_NORMAL + 'hr</span>') : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:16px;">本月尚無打卡紀錄</td></tr>';

  el.innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h3>本月打卡工時（${escHtml(thisMonth)}）</h3>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="la-print-month" type="month" value="${thisMonth}" style="padding:4px 6px;border:1px solid #cbd5e0;border-radius:6px;font-size:.82rem;">
          <button class="btn btn-secondary btn-sm" onclick="printAttendanceMonthlyReport(currentUser.email, document.getElementById('la-print-month').value)">🖨️ 列印月報表</button>
        </div>
      </div>
      <div style="padding:16px 20px;">
        <div style="font-size:.85rem;color:#4a5568;margin-bottom:10px;">目前可用補休時數：<strong style="color:${compRemain > 0 ? '#276749' : '#718096'};">${compRemain}</strong> 小時（已認證加班 − 已用補休）</div>
        <div style="overflow-x:auto;">
          <table class="data-table" style="min-width:440px;">
            <thead><tr><th>日期</th><th>簽到</th><th>簽退</th><th style="text-align:right;">工時</th><th>判定</th></tr></thead>
            <tbody>${workRows}</tbody>
          </table>
        </div>
        <div style="font-size:.76rem;color:#a0aec0;margin-top:8px;">工時 = 當日最後一次打卡 − 第一次打卡，滿 ${WORK_HOURS_NORMAL} 小時為正常（午休不另扣）。如有加班，請以上方「加班登記」提出，由督導認證。</div>
      </div>
    </div>`;
}

function _laKindChange() {
  const kind = document.getElementById('la-kind')?.value || 'leave';
  const isManual = kind === 'manual';
  const _show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  _show('la-type-row', kind === 'leave');
  _show('la-end-row', !isManual);       // 手動打卡只有單一時間點
  _show('la-hours-row', !isManual);     // 手動打卡不需時數
  _show('la-hint-hours', !isManual);
  _show('la-hint-manual', isManual);
  const fromLabel = document.getElementById('la-from-label');
  if (fromLabel) fromLabel.textContent = isManual ? '打卡時間（日期／時間）' : '開始（日期／時間）';
  const submitBtn = document.getElementById('la-submit-btn');
  if (submitBtn) submitBtn.textContent = isManual ? '新增打卡' : '送出申請';
  const rem = document.getElementById('la-remaining');
  if (rem && isManual) { rem.textContent = ''; }
  else _laUpdateRemaining();
}

// 請假時間欄（24 小時制）：以「時：分」兩個下拉取代原生 type=time——原生欄位的上午/下午
// 12 小時制顯示跟著瀏覽器語系走、無法強制 24 小時制。值介面維持 'HH:MM' 字串，
// 一律經 _laGetTime／_laSetTime 存取；分鐘提供完整 00–59（手動補登打卡需要分鐘精度）。
function _laTimeSelectsHtml(baseId, hhmm) {
  const [h0, m0] = /^\d{1,2}:\d{2}$/.test(hhmm || '') ? hhmm.split(':') : ['08', '00'];
  const opts = (n, sel) => Array.from({ length: n }, (_, i) => {
    const v = String(i).padStart(2, '0');
    return `<option value="${v}"${v === String(sel).padStart(2, '0') ? ' selected' : ''}>${v}</option>`;
  }).join('');
  return `<span style="display:inline-flex;align-items:center;gap:2px;">
    <select id="${baseId}-h" class="field-select" onchange="_laAutoHours()">${opts(24, h0)}</select>
    <span style="color:#4a5568;">:</span>
    <select id="${baseId}-m" class="field-select" onchange="_laAutoHours()">${opts(60, m0)}</select>
  </span>`;
}
function _laGetTime(baseId) {
  const h = document.getElementById(baseId + '-h'), m = document.getElementById(baseId + '-m');
  return (h && m) ? `${h.value}:${m.value}` : '';
}
function _laSetTime(baseId, hhmm) {
  const mch = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!mch) return;
  const h = document.getElementById(baseId + '-h'), m = document.getElementById(baseId + '-m');
  if (h) h.value = mch[1].padStart(2, '0');
  if (m) m.value = mch[2];
}
// 依起訖日期＋時間自動換算「實際上班時數」（_leaveWorkHours：只計上班時段、扣午休）。
// la-hours 為唯讀欄位，值一律由此函式統一寫入，使用者不可手動修改。
function _laAutoHours() {
  const fromD = document.getElementById('la-from')?.value;
  const toD   = document.getElementById('la-to')?.value || fromD;
  const fromT = _laGetTime('la-from-time');
  const toT   = _laGetTime('la-to-time');
  const hoursEl = document.getElementById('la-hours');
  if (!hoursEl || !fromD) return;
  hoursEl.value = _leaveWorkHours(_getWorkHoursConfig(), fromD, fromT, toD, toT, _userEveningShift(currentUser?.email));
}
// 把某日期欄位（la-from／la-to）對應的當日上班起訖時間，套到對應的時間欄位（改日期時自動同步）
function _laApplyDayTime(dateElId, timeElId) {
  const dateEl = document.getElementById(dateElId);
  if (!dateEl || !dateEl.value || !document.getElementById(timeElId + '-h')) return;
  const dw = _dayWorkStartEnd(_getWorkHoursConfig(), dateEl.value, _userEveningShift(currentUser?.email));
  _laSetTime(timeElId, (dateElId === 'la-from') ? dw.start : dw.end);
}
// 開始日期變更：若晚於目前結束日，結束日自動跟上開始日（避免結束早於開始）；
// 兩者日期各自套用當日上班起訖時間後，重新換算時數。
function _laFromDateChange() {
  const fromEl = document.getElementById('la-from');
  const toEl = document.getElementById('la-to');
  if (fromEl && toEl && toEl.value && fromEl.value && fromEl.value > toEl.value) {
    toEl.value = fromEl.value;
    _laApplyDayTime('la-to', 'la-to-time');
  }
  _laApplyDayTime('la-from', 'la-from-time');
  _laAutoHours();
}
// 結束日期變更：套用當日上班起訖時間，重新換算時數。
function _laToDateChange() {
  _laApplyDayTime('la-to', 'la-to-time');
  _laAutoHours();
}

// 申請日期/時間範圍的純文字描述（HTML 顯示時請自行 escHtml）
function _leaveDateTimeStr(a) {
  const ft = a.fromTime ? ' ' + a.fromTime : '';
  const tt = a.toTime ? ' ' + a.toTime : '';
  if (a.toDate && a.toDate !== a.fromDate) return `${a.fromDate}${ft} ~ ${a.toDate}${tt}`;
  if (a.fromTime || a.toTime) return `${a.fromDate} ${a.fromTime || ''}~${a.toTime || ''}`;
  return a.fromDate || '';
}

function _laUpdateRemaining() {
  const el = document.getElementById('la-remaining');
  if (!el) return;
  const kind = document.getElementById('la-kind')?.value || 'leave';
  if (kind === 'overtime') {
    el.textContent = '加班登記：經督導認證後將累積為可用補休時數。';
    el.style.color = '#718096';
    return;
  }
  const typeId = document.getElementById('la-type')?.value;
  const t = getLeaveType(typeId);
  // 期間限制提示（可申請期間 + 目前是否在期間內）
  let periodTip = '';
  if (t && _isValidMMDD(t.periodStart) && _isValidMMDD(t.periodEnd)) {
    const inPeriod = _dateInLeavePeriod(t, _fmtDate(new Date()));
    periodTip = `<div style="font-size:.78rem;margin-top:4px;color:${inPeriod ? '#718096' : '#c53030'};">📅 「${escHtml(t.name)}」申請期間：${t.periodStart} ~ ${t.periodEnd}${inPeriod ? '' : '（目前不在期間內，無法申請）'}</div>`;
  }
  if (!t || !t.deductsQuota) { el.innerHTML = '此假別不扣抵額度。' + periodTip; el.style.color = '#718096'; return; }
  const remaining = _leaveRemaining(currentUser.email, typeId);
  if (t.isComp) {
    el.innerHTML = `可用補休：<strong>${remaining}</strong> 小時（已認證加班 − 已用補休，含待審核佔用）` + periodTip;
  } else {
    const quota = _leaveQuotaHours(currentUser.email, typeId);
    const win = _leavePeriodWindow(t);
    const scopeTip = win ? `<span style="color:#718096;font-weight:400;">（${_leavePeriodYearLabel(t)}，每年自動回滿）</span>` : '';
    el.innerHTML = `剩餘額度：<strong>${remaining}</strong> / ${quota} 小時（含待審核佔用）${scopeTip}` + periodTip;
  }
  el.style.color = remaining <= 0 ? '#c53030' : '#2b6cb0';
}

let _leaveSubmitting = false;
function _laMsg(type, text) {
  const el = document.getElementById('la-msg');
  if (!el) return;
  el.className = 'alert alert-' + (type === 'error' ? 'error' : type === 'info' ? 'info' : 'success');
  el.textContent = text;
  el.style.display = '';
}
async function submitLeave() {
  if (_leaveSubmitting) return; // 防重複提交
  const kind = document.getElementById('la-kind')?.value || 'leave';
  if (kind === 'manual') { await submitManualPunch(); return; }
  const fromDate = document.getElementById('la-from')?.value;
  const toDate = document.getElementById('la-to')?.value || fromDate;
  const fromTime = _laGetTime('la-from-time');
  const toTime = _laGetTime('la-to-time');
  const hours = Number(document.getElementById('la-hours')?.value);
  const reason = (document.getElementById('la-reason')?.value || '').trim();
  if (!fromDate) { alert('請選擇開始日期'); return; }
  if (toDate < fromDate) { alert('結束日期不可早於開始日期'); return; }
  if (toDate === fromDate && fromTime && toTime && toTime <= fromTime) { alert('同日的結束時間需晚於開始時間'); return; }
  if (!hours || hours <= 0) { alert('所選起訖期間無實際上班時數，請確認日期／時間'); return; }

  let leaveTypeId = '', leaveTypeName = '加班登記', deductsQuota = false;
  if (kind !== 'overtime') {
    leaveTypeId = document.getElementById('la-type')?.value;
    const t = getLeaveType(leaveTypeId);
    if (!t) { alert('請選擇假別'); return; }
    leaveTypeName = t.name; deductsQuota = !!t.deductsQuota;
    if (_isValidMMDD(t.periodStart) && _isValidMMDD(t.periodEnd)) {
      if (!_dateInLeavePeriod(t, fromDate) || !_dateInLeavePeriod(t, toDate)) {
        alert(`「${t.name}」僅限每年 ${t.periodStart} ~ ${t.periodEnd} 期間申請，且起訖日期皆需落在此期間內。`);
        return;
      }
    }
    if (t.deductsQuota) {
      const remaining = _leaveRemaining(currentUser.email, leaveTypeId);
      if (remaining != null && hours > remaining) {
        alert(t.isComp
          ? `超出可用補休時數（剩 ${remaining} 小時）。請先登記加班並由督導認證。`
          : `超出剩餘額度（剩 ${remaining} 小時）。如需調整額度，請洽主任。`);
        return;
      }
    }
  }
  // 進入實際送出階段：鎖定按鈕、顯示送出中，避免重複點擊
  _leaveSubmitting = true;
  const btn = document.getElementById('la-submit-btn');
  const _btnText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait'; btn.textContent = '送出中…'; }
  _laMsg('info', '⏳ 送出中，請稍候…');

  let attachments = [];
  try { attachments = await attachFlush('la'); }
  catch (e) {
    _leaveSubmitting = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.textContent = _btnText; }
    _laMsg('error', '附件未完成：' + e.message);
    showToast('附件未完成：' + e.message, 'error');
    return;
  }
  const app = {
    id: 'lv_' + currentUser.email + '_' + Date.now(),
    email: currentUser.email, name: _userName(currentUser.email),
    kind: kind === 'overtime' ? 'overtime' : 'leave',
    leaveTypeId, leaveTypeName, deductsQuota,
    fromDate, toDate, fromTime, toTime, hours, reason, status: 'pending',
    appliedAt: new Date().toISOString(), attachments,
  };
  if (!leavesData || !Array.isArray(leavesData.applications)) leavesData = { applications: [] };
  leavesData.applications.push(app);
  const jobId = bgJobAdd('送出差勤申請');
  try {
    await saveLeaves();
    await _notifyLeaveReviewers(app);
    bgJobDone(jobId);
    _leaveSubmitting = false;
    showToast('✅ 已送出申請，待督導審核。', 'success');
    renderLeaveApplyPage();           // 重繪：表單清空、新申請出現在「我的申請紀錄」最上方
    _laMsg('success', `✅ 已送出：${leaveTypeName} ${hours} 小時（${_leaveDateTimeStr(app)}），請於下方「我的申請紀錄」確認。`);
  } catch (e) {
    leavesData.applications.pop();
    bgJobFail(jobId, e.message);
    _leaveSubmitting = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.textContent = _btnText; }
    _laMsg('error', '送出失敗：' + e.message);
    showToast('送出失敗：' + e.message, 'error');
  }
  _updateLeaveBadges();
}

// 手動補登打卡：只有單一時間點，寫入 attendanceData（與打卡機同一資料）；簽到/簽退由當日時間先後自動判定
async function submitManualPunch() {
  if (_leaveSubmitting) return;
  const date = document.getElementById('la-from')?.value;
  const time = _laGetTime('la-from-time');
  const reason = (document.getElementById('la-reason')?.value || '').trim();
  if (!date) { alert('請選擇打卡日期'); return; }
  if (!time) { alert('請選擇打卡時間'); return; }
  const when = new Date(`${date}T${time}`);
  if (isNaN(when.getTime())) { alert('打卡時間格式不正確'); return; }
  if (when.getTime() > Date.now() + 60000) { alert('打卡時間不可為未來時間'); return; }

  _leaveSubmitting = true;
  const btn = document.getElementById('la-submit-btn');
  const _btnText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait'; btn.textContent = '新增中…'; }
  _laMsg('info', '⏳ 新增打卡中…');

  const record = {
    id: 'att_' + currentUser.email + '_' + when.getTime(),
    email: currentUser.email,
    name: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
    type: 'punch',
    timestamp: when.toISOString(),
    date: _fmtDate(when),
    manual: true,
    manualBy: currentUser.email,
    manualAt: new Date().toISOString(),
    ...(reason ? { manualNote: reason } : {}),
  };
  if (!attendanceData || !Array.isArray(attendanceData.records)) attendanceData = { records: [] };
  const jobId = bgJobAdd('手動補登打卡');
  try {
    await _attendanceCommit([record]); // 併發安全：只 append 這筆
    auditLog('手動補登打卡', null, null, `${record.name || currentUser.email} ${date} ${time}${reason ? '（' + reason + '）' : ''}`);
    bgJobDone(jobId);
    _leaveSubmitting = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.textContent = _btnText; }
    showToast('✅ 已補登打卡', 'success');
    _laMsg('success', `✅ 已補登打卡：${date} ${time}`);
  } catch (e) {
    bgJobFail(jobId, e.message);
    _leaveSubmitting = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.textContent = _btnText; }
    _laMsg('error', '補登失敗：' + e.message);
    showToast('補登失敗：' + e.message, 'error');
  }
}

async function cancelLeave(id) {
  const app = (leavesData?.applications || []).find(a => a.id === id);
  if (!app || app.status !== 'pending' || app.email !== currentUser.email) return;
  if (!confirm('確定取消此申請？')) return;
  app.status = 'cancelled';
  app.cancelledAt = new Date().toISOString();
  try { await saveLeaves(); showToast('已取消申請', 'success'); }
  catch (e) { app.status = 'pending'; showToast('取消失敗：' + e.message, 'error'); }
  renderLeaveApplyPage();
  _updateLeaveBadges();
}

let _pendingUsersSnapshot = [];
async function loadPendingUsers() {
  try {
    pendingUsersData = await proxyCall('readJson', { path: PENDING_USERS_FILE });
  } catch {
    pendingUsersData = { applications: [] };
  }
  if (!pendingUsersData || !Array.isArray(pendingUsersData.applications)) pendingUsersData = { applications: [] };
  _pendingUsersSnapshot = _deepClone(pendingUsersData.applications);
  _updatePendingUsersBadge();
}

function _updatePendingUsersBadge() {
  const count = (pendingUsersData?.applications || []).filter(a => a.status === 'pending').length;
  for (const id of ['nav-pending-users-badge', 'nav-admin-apps-badge']) {
    const el = document.getElementById(id);
    if (el) { el.textContent = count; el.style.display = count > 0 ? '' : 'none'; }
  }
  _renderAdminTabs(); // 同步更新 tab bar 上的數字
}

// ── 打卡輔助：依當天位置判斷簽到/簽退標籤 ──
function _punchLabel(r, allRecords) {
  const dayTs = allRecords
    .filter(x => x.email === r.email && x.date === r.date)
    .map(x => x.timestamp).sort();
  if (dayTs[0] === r.timestamp) return { icon: '🟢', text: '簽到', color: '#276749' };
  if (dayTs.length > 1 && dayTs[dayTs.length - 1] === r.timestamp) return { icon: '🔴', text: '簽退', color: '#c53030' };
  return { icon: '🔵', text: '打卡', color: '#2b6cb0' };
}

// ══════════════════════════════════════════════
//  打卡權杖免登入模式（?page=clock#ct=<token>）
//  給實習生的專屬打卡網址：手機打開不需登入即可打卡，但只能打卡——不提供任何導向其他頁面的入口。
// ══════════════════════════════════════════════

// 獨立輕量的 proxy call：不共用 proxyCall 的 session 換發/重登/稽核細節記錄邏輯（那些假設使用者
// 已登入）。404/429/503 暫時性錯誤仍比照 proxyCall 重試最多 4 次。
// 安全注意：_clockToken 絕不可寫入 _syslog（那是系統管理者可見的除錯紀錄，token 外流即可冒充打卡）。
async function _clockProxyCall(action, params = {}, _retry = 0) {
  const payload = JSON.stringify({ clockToken: _clockToken, action, rootFolderId: DRIVE_FOLDER_ID, ...params });
  const form = new URLSearchParams();
  form.append('payload', payload);
  const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: form, redirect: 'follow' });
  if (!r.ok) {
    if ((r.status === 404 || r.status === 429 || r.status === 503) && _retry < 4) {
      await new Promise(res => setTimeout(res, 1200 * (_retry + 1)));
      return _clockProxyCall(action, params, _retry + 1);
    }
    throw new Error(`Apps Script 呼叫失敗 (${r.status})`);
  }
  const data = await r.json();
  if (!data.success) throw new Error(data.error || 'Apps Script 回應錯誤');
  if (data.data && typeof data.data === 'object' && data.data.error) throw new Error(data.data.error);
  return data.data;
}

// 免登入打卡模式啟動：隱藏側欄與登入畫面、只顯示打卡頁，向後端要打卡所需的最小資料。
// 失敗（權杖失效/停用/網路問題）時顯示明確錯誤訊息＋登入連結，不留在空白畫面。
async function _bootClockTokenMode(token) {
  _clockTokenMode = true;
  _clockToken = token;
  _clockOnlyMode = false; // 與既有「已登入快速打卡模式」互斥，避免其升級路徑（假設已登入）誤觸發
  const loginScreen = document.getElementById('login-screen');
  const mainLayout  = document.getElementById('main-layout');
  const appHeader   = document.getElementById('app-header');
  const sidebar     = document.getElementById('sidebar');
  if (loginScreen) loginScreen.style.display = 'none';
  if (appHeader)   appHeader.style.display   = 'none';
  if (mainLayout)  mainLayout.style.display  = 'flex';
  if (sidebar)     sidebar.style.display     = 'none'; // 務必隱藏：使用者不可導向打卡以外的任何頁面
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-clock');
  if (pageEl) pageEl.classList.add('active');

  try {
    const ctx = await _clockProxyCall('clockContext');
    currentUser = { email: ctx.email, name: ctx.name || ctx.email };
    configData = { users: { [ctx.email]: { name: ctx.name || '' } }, ...(ctx.geoFence ? { attendanceGeoFence: ctx.geoFence } : {}) };
    attendanceData = { records: ctx.records || [] };
    renderClockPage();
  } catch (e) {
    _renderClockTokenError();
  }
}

function _renderClockTokenError() {
  const body = document.getElementById('clock-body');
  if (!body) return;
  const loginUrl = location.origin + location.pathname + location.search; // 去掉 hash（權杖），保留其餘網址
  body.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;text-align:center;background:#f0f4f8;">
      <div style="font-size:2.4rem;margin-bottom:14px;">⚠️</div>
      <div style="font-size:1.05rem;font-weight:700;color:#c53030;margin-bottom:8px;">此打卡網址已失效或無法連線</div>
      <div style="font-size:.88rem;color:#4a5568;margin-bottom:22px;line-height:1.6;">可能原因：網址已被重新產生或停用、帳號已停用、或暫時性網路問題。<br>請聯繫中心同仁重新產生打卡網址。</div>
      <a href="${loginUrl}" style="color:#3182ce;font-size:.9rem;font-weight:600;">使用帳號登入 →</a>
    </div>`;
}

// ── 打卡頁面 ──
// ns：容器 id 前綴。目前僅「差勤打卡」頁／?page=clock 使用（''，id 完全不變）；前綴機制保留，
// 供未來再有內嵌他頁的需求時避免 id 重複（v130 曾內嵌「我的差勤」打卡分頁、v133 依使用者決定移除）。
// _clockNs 記錄「目前作用中」的那份，供 _startClockTick／clockAction／updateAttendanceLoc／_showClockMap
// 這些不便逐一傳參的既有函式讀取，判斷該操作哪一份 DOM。
let _clockNs = '';
function renderClockPage(ns) {
  _clockNs = ns || '';
  const id = s => _clockNs + s;
  const isIntern = currentRole === '實習諮商心理師';
  const _isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canPunch = _clockTokenMode || isIntern || _isAdmin || isInternAdminSupervisor || isInternProSupervisor;
  const today = _fmtDate(new Date());
  const allRecords = attendanceData?.records || [];
  const myRecords = allRecords
    .filter(r => r.email === currentUser.email && r.date === today)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const container = document.getElementById(id('clock-body'));
  if (!container) return;

  container.innerHTML = `
    <div style="min-height:${_clockNs ? 'auto' : '100vh'};display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:${_clockNs ? '0' : '24px 16px'};background:${_clockNs ? 'transparent' : '#f0f4f8'};">
      <div style="width:100%;max-width:420px;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:2rem;font-weight:700;color:#2d3748;letter-spacing:.04em;" id="${id('clock-time-display')}">--:--:--</div>
          <div style="font-size:1rem;color:#718096;margin-top:4px;">${today}</div>
          <div style="font-size:.9rem;color:#4a5568;margin-top:4px;">${configData?.users?.[currentUser.email]?.name || currentUser.name || currentUser.email}</div>
        </div>

        <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:16px;">
          <div style="font-size:.85rem;color:#718096;margin-bottom:12px;font-weight:600;">今日打卡紀錄</div>
          ${myRecords.length === 0
            ? '<div style="color:#a0aec0;font-size:.9rem;text-align:center;padding:8px 0;">尚無紀錄</div>'
            : myRecords.map(r => {
                const { icon, text } = _punchLabel(r, allRecords);
                const locTag = r.lat
                  ? `<span style="font-size:.75rem;color:${r.locationUpdated?'#3182ce':r.accuracyLow?'#c05621':'#a0aec0'};cursor:pointer;" onclick="_showClockMap(${r.lat},${r.lng})">📍 ${_isNearCampus(r.lat,r.lng)?'校區內':'校區外'}${r.accuracyLow&&!r.locationUpdated?' ⚠️':''}${r.locationUpdated?' ✏️':''}</span>`
                  : `<span style="font-size:.75rem;color:#a0aec0;">📍 無定位</span>`;
                const updBtn = (r.locationUpdated || _clockTokenMode) ? '' : `<button class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:2px 8px;" onclick="updateAttendanceLoc('${r.id}')">更新定位</button>`;
                const hint = r.accuracyLow && !r.locationUpdated ? `<div style="font-size:.72rem;color:#c05621;margin-top:2px;padding-left:4px;">⚠️ 定位精度不足（可能為電腦 IP 定位），建議手機重新打卡或點「更新定位」</div>` : '';
                const origHint = r.locationUpdated && r.origLat != null ? `<div style="font-size:.72rem;color:#a0aec0;margin-top:2px;padding-left:4px;">原始：📍 ${_isNearCampus(r.origLat,r.origLng)?'校區內':'校區外'}${r.origAccuracy?`（誤差 ${r.origAccuracy}m）`:''}</div>` : '';
                return `
                <div style="padding:8px 0;border-bottom:1px solid #f7fafc;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:1.1rem;">${icon}</span>
                    <span style="font-weight:600;color:#2d3748;min-width:36px;">${text}</span>
                    <span style="color:#4a5568;font-size:.9rem;">${_fmtTime(r.timestamp)}</span>
                    ${r.manual ? '<span style="font-size:.7rem;color:#6b46c1;background:#e9d8fd;border-radius:4px;padding:0 5px;">手動</span>' : ''}
                    <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">${locTag}${updBtn}</span>
                  </div>${hint}${origHint}
                </div>`;
              }).join('')
          }
        </div>

        <div id="${id('clock-geo-status')}" style="font-size:.8rem;color:#718096;text-align:center;margin-bottom:12px;"></div>

        ${isIntern && !_clockNs && !_clockTokenMode ? `
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:16px;">
          <input id="clock-print-month" type="month" value="${today.slice(0, 7)}" style="padding:6px 8px;border:1px solid #cbd5e0;border-radius:8px;font-size:.85rem;">
          <button class="btn btn-secondary btn-sm" onclick="printAttendanceMonthlyReport(currentUser.email, document.getElementById('clock-print-month').value)">🖨️ 列印月報表</button>
        </div>` : ''}

        ${canPunch ? `
        ${!isIntern && !_clockTokenMode ? '<div class="alert alert-info" style="margin-bottom:12px;">您以管理者／督導身分檢視；打卡將以您的帳號建立（供驗證用）。</div>' : ''}
        <button id="${id('clock-punch-btn')}" onclick="clockAction()" style="width:100%;padding:18px;font-size:1.1rem;font-weight:700;border:none;border-radius:12px;cursor:pointer;background:#3182ce;color:#fff;margin-bottom:16px;">
          ⏱ 打卡
        </button>` : '<div class="alert alert-info" style="margin-bottom:16px;">您目前不是實習生身分，僅可查看差勤紀錄。</div>'}

        <div id="${id('clock-msg')}" style="display:none;" class="alert"></div>

        <div id="${id('clock-map-wrap')}" style="display:none;border-radius:12px;overflow:hidden;margin-top:16px;">
          <div id="${id('clock-map')}" style="height:200px;"></div>
        </div>

        ${_clockTokenMode ? `
        <div style="text-align:center;font-size:.78rem;color:#a0aec0;margin-top:22px;">
          專屬打卡網址（免登入，僅供打卡）・<a href="${location.origin + location.pathname + location.search}" style="color:#3182ce;">使用完整功能請登入</a>
        </div>` : ''}
      </div>
    </div>`;

  _startClockTick();
}

let _clockTickTimer = null;
function _startClockTick() {
  clearInterval(_clockTickTimer);
  const el = document.getElementById(_clockNs + 'clock-time-display');
  if (!el) return;
  _clockTickTimer = setInterval(() => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (el) el.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }, 1000);
}

async function clockAction() {
  const msgEl = document.getElementById(_clockNs + 'clock-msg');
  const btn = document.getElementById(_clockNs + 'clock-punch-btn');
  msgEl.style.display = 'none';
  if (btn) btn.disabled = true;
  document.getElementById(_clockNs + 'clock-geo-status').textContent = '正在取得定位…';

  let lat = null, lng = null, accuracy = null;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 30000 })
    );
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    accuracy = Math.round(pos.coords.accuracy);
    document.getElementById(_clockNs + 'clock-geo-status').textContent = `定位成功（誤差約 ${accuracy} 公尺）`;
  } catch (e) {
    document.getElementById(_clockNs + 'clock-geo-status').textContent = '⚠️ 無法取得定位（仍可繼續打卡）';
  }

  // 打卡權杖免登入模式：不信任前端身分，record 完全由後端依權杖驗證出的 email 與 config 決定，
  // 前端只送定位；不呼叫 _attendanceCommit/auditLog（那些走一般 session 授權）。
  if (_clockTokenMode) {
    try {
      const locParams = lat !== null ? { lat, lng, accuracy } : {};
      const resp = await _clockProxyCall('clockPunch', locParams);
      attendanceData = { records: resp.records || [] };
      msgEl.className = 'alert alert-success';
      msgEl.textContent = '✅ 打卡成功！ ' + _fmtTime(resp.record.timestamp);
      msgEl.style.display = '';
      setTimeout(() => renderClockPage(), 800);
    } catch (e) {
      msgEl.className = 'alert alert-error';
      msgEl.textContent = '打卡失敗：' + e.message;
      msgEl.style.display = '';
      document.getElementById(_clockNs + 'clock-geo-status').textContent = '';
      if (btn) btn.disabled = false;
    }
    return;
  }

  const now = new Date();
  const record = {
    id: 'att_' + currentUser.email + '_' + now.getTime(),
    email: currentUser.email,
    name: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
    type: 'punch',
    timestamp: now.toISOString(),
    date: _fmtDate(now),
    ...(lat !== null ? { lat, lng, accuracy, accuracyLow: accuracy > 200 } : {}),
  };

  if (!attendanceData) attendanceData = { records: [] };
  try {
    await _attendanceCommit([record]); // 併發安全：只 append 這筆，回傳合併後 records 更新記憶體
    msgEl.className = 'alert alert-success';
    msgEl.textContent = '✅ 打卡成功！ ' + _fmtTime(record.timestamp);
    msgEl.style.display = '';
    const ns = _clockNs;
    setTimeout(() => renderClockPage(ns), 800);
  } catch (e) {
    msgEl.className = 'alert alert-error';
    msgEl.textContent = '打卡失敗：' + e.message;
    msgEl.style.display = '';
    document.getElementById(_clockNs + 'clock-geo-status').textContent = '';
    if (btn) btn.disabled = false;
  }
}

async function updateAttendanceLoc(recordId) {
  const rec = (attendanceData?.records || []).find(r => r.id === recordId);
  if (!rec) return;
  const statusEl = document.getElementById(_clockNs + 'clock-geo-status');
  if (statusEl) statusEl.textContent = '正在取得定位…';
  let lat, lng, accuracy;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 12000, maximumAge: 0 })
    );
    lat = pos.coords.latitude; lng = pos.coords.longitude;
    accuracy = Math.round(pos.coords.accuracy);
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠️ 無法取得定位：' + (e.message || '位置存取被拒絕');
    return;
  }
  // 保留原始位置
  if (!rec.locationUpdated) {
    rec.origLat = rec.lat ?? null; rec.origLng = rec.lng ?? null;
    rec.origAccuracy = rec.accuracy ?? null;
  }
  rec.lat = lat; rec.lng = lng; rec.accuracy = accuracy;
  rec.accuracyLow = accuracy > 200;
  rec.locationUpdated = true;
  rec.locationUpdatedAt = new Date().toISOString();
  try {
    await _attendanceCommit([rec]); // 併發安全：只 replace 這筆
    if (statusEl) statusEl.textContent = `✅ 定位已更新（誤差約 ${accuracy} 公尺）`;
    renderClockPage(_clockNs);
  } catch (e) {
    // 回滾
    rec.locationUpdated = false; rec.lat = rec.origLat; rec.lng = rec.origLng;
    rec.accuracy = rec.origAccuracy; delete rec.origLat; delete rec.origLng;
    delete rec.origAccuracy; delete rec.locationUpdatedAt;
    if (statusEl) statusEl.textContent = '❌ 儲存失敗：' + e.message;
  }
}

let _clockMapInstance = null;
function _showClockMap(lat, lng) {
  const wrap = document.getElementById(_clockNs + 'clock-map-wrap');
  wrap.style.display = '';
  if (_clockMapInstance) { _clockMapInstance.remove(); _clockMapInstance = null; }
  _clockMapInstance = L.map(_clockNs + 'clock-map').setView([lat, lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_clockMapInstance);
  L.marker([lat, lng]).addTo(_clockMapInstance);
}

// 屏科大內埔校區中心座標（預設值，可由管理者在差勤設定中調整）
const _CAMPUS_LAT_DEFAULT = 22.6390, _CAMPUS_LNG_DEFAULT = 120.6009, _CAMPUS_RADIUS_DEFAULT = 1500;
function _geoFenceCfg() {
  const g = configData?.attendanceGeoFence;
  return {
    lat:    (g?.lat    != null) ? Number(g.lat)    : _CAMPUS_LAT_DEFAULT,
    lng:    (g?.lng    != null) ? Number(g.lng)    : _CAMPUS_LNG_DEFAULT,
    radius: (g?.radius != null) ? Number(g.radius) : _CAMPUS_RADIUS_DEFAULT,
  };
}
function _isNearCampus(lat, lng) {
  const { lat: cLat, lng: cLng, radius } = _geoFenceCfg();
  const R = 6371000;
  const dLat = (lat - cLat) * Math.PI / 180;
  const dLng = (lng - cLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(cLat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) <= radius;
}

function _fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _fmtTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

// ── 實習生在任狀態判斷 ──
function _isInternActive(info, today) {
  if (info.disabled) return false;
  const from = info.internFrom, to = info.internTo;
  if (!from && !to) return true;
  if (from && today < from) return false;
  if (to   && today > to)   return false;
  return true;
}

// ══════════════════════════════════════════════
//  本週差勤總覽（共用元件：差勤管理／我的差勤 皆呼叫此函式，僅傳入的 emails 不同）
// ══════════════════════════════════════════════
// 某日期（YYYY-MM-DD）所在那一週的週一日期
function _weekMondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=週日...6=週六
  const diff = dow === 0 ? -6 : 1 - dow; // 週一為一週起點
  d.setDate(d.getDate() + diff);
  return _fmtDate(d);
}

// ── 「我的打卡紀錄」查詢（我的差勤／差勤總覽 tab 用）：純函式，方便單元測試 ──
// 依 email＋起訖日期（皆含）篩選＋依 timestamp 降冪排序；from/to 為空字串＝不限制該端。
// 嚴格以 email 參數過濾（呼叫端固定傳 currentUser.email），確保絕不列出他人紀錄。
function _myAttFilterPunchRecords(records, email, from, to) {
  return (records || [])
    .filter(r => r && r.email === email)
    .filter(r => !from || (r.date || '') >= from)
    .filter(r => !to   || (r.date || '') <= to)
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}
// 快捷區間：today/week/month → {from,to}（皆含今日）；其餘（如 'all'）→ 清空起訖＝不限制
function _myAttPunchQuickRange(kind, today) {
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'week')  return { from: _weekMondayOf(today), to: today };
  if (kind === 'month') return { from: today.slice(0, 7) + '-01', to: today };
  return { from: '', to: '' };
}

// 將本週（週一~週日）每人的打卡概況＋今日打卡情形＋本週請假中，渲染進 containerId
function renderWeekAttendanceOverview(containerId, emails) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const today = _fmtDate(new Date());
  const monday = _weekMondayOf(today);
  const weekdayLbl = ['一', '二', '三', '四', '五', '六', '日'];
  const weekDates = weekdayLbl.map((_, i) => { const d = new Date(monday + 'T00:00:00'); d.setDate(d.getDate() + i); return _fmtDate(d); });
  const users = configData?.users || {};
  const records = attendanceData?.records || [];
  const apps = leavesData?.applications || [];

  const cards = emails.map(email => {
    const name = users[email]?.name || email;
    const todayRecs = records.filter(r => r.email === email && r.date === today).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    let statusHtml;
    if (todayRecs.length === 0) statusHtml = '<span style="color:#a0aec0;font-weight:600;">未打卡</span>';
    else if (todayRecs.length === 1) statusHtml = `<span style="color:#276749;font-weight:600;">已簽到</span> <span style="color:#718096;">${_fmtTime(todayRecs[0].timestamp)}</span>`;
    else statusHtml = `<span style="color:#2b6cb0;font-weight:600;">已簽退</span> <span style="color:#718096;">${_fmtTime(todayRecs[todayRecs.length - 1].timestamp)}</span>`;

    const dots = weekDates.map((d, i) => {
      const has = records.some(r => r.email === email && r.date === d);
      const isToday = d === today;
      const isFuture = d > today;
      const bg = has ? '#48bb78' : isFuture ? '#e2e8f0' : '#feb2b2';
      const tip = `${d}（週${weekdayLbl[i]}）${has ? '：已打卡' : isFuture ? '' : '：未打卡'}`;
      return `<span data-tip="${escHtml(tip)}" style="display:inline-block;width:15px;height:15px;border-radius:4px;background:${bg};${isToday ? 'outline:2px solid #2b6cb0;outline-offset:1px;' : ''}"></span>`;
    }).join('');

    // 本週請假中：已核准且非加班登記，日期範圍與本週有重疊
    const leaveThisWeek = apps.filter(a => a.email === email && a.status === 'approved' && a.kind !== 'overtime' &&
      (a.fromDate || '') <= weekDates[6] && (a.toDate || a.fromDate || '') >= weekDates[0]);
    const leaveHtml = leaveThisWeek.length
      ? `<div style="font-size:.72rem;color:#c05621;margin-top:6px;">🏖️ ${leaveThisWeek.map(a => `${escHtml(a.leaveTypeName)}（${escHtml(_leaveDateTimeStr(a))}）`).join('、')}</div>`
      : '';

    return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:170px;background:#fff;">
      <div style="font-weight:600;color:#2d3748;font-size:.88rem;margin-bottom:4px;">${escHtml(name)}</div>
      <div style="font-size:.8rem;margin-bottom:6px;">今日：${statusHtml}</div>
      <div style="display:flex;gap:3px;">${dots}</div>
      ${leaveHtml}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-weight:600;color:#2d3748;margin-bottom:8px;">本週差勤（${weekDates[0].slice(5)} ~ ${weekDates[6].slice(5)}）</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">${cards || '<div style="color:#a0aec0;font-size:.85rem;">目前沒有可顯示的實習生資料</div>'}</div>`;
}

// ── 差勤管理後台 ──
function renderAttendancePage() {
  const records = attendanceData?.records || [];
  const users = configData?.users || {};
  const today = _fmtDate(new Date());
  const filterEmailVal = document.getElementById('att-filter-email')?.value || '';
  const filterEmail = filterEmailVal;
  const filterDate  = document.getElementById('att-filter-date')?.value  || today;
  const allInterns = Object.entries(users)
    .filter(([, u]) => u.role === '實習諮商心理師')
    .map(([email, u]) => ({ email, name: u.name || email, active: _isInternActive(u, today), disabled: !!u.disabled }));

  // 依在任→非在任→停用分組，組內按姓名排序
  const _ig = (cat) => allInterns.filter(i => i.cat === cat).sort((a,b) => a.name.localeCompare(b.name,'zh-TW'));
  allInterns.forEach(i => { i.cat = i.disabled ? 2 : i.active ? 0 : 1; });
  const activeInterns   = _ig(0);
  const inactiveInterns = _ig(1);
  const disabledInterns = _ig(2);
  const interns = [...activeInterns, ...inactiveInterns, ...disabledInterns];
  const _opt = i => `<option value="${i.email}" ${filterEmailVal===i.email?'selected':''}>${i.name}${i.cat===1?' (非在任)':i.cat===2?' (停用)':''}</option>`;
  const internSelectHtml = [
    ...(activeInterns.length   ? [`<optgroup label="在任實習生">`,   ...activeInterns.map(_opt),   `</optgroup>`] : []),
    ...(inactiveInterns.length ? [`<optgroup label="非在任實習生">`, ...inactiveInterns.map(_opt), `</optgroup>`] : []),
    ...(disabledInterns.length ? [`<optgroup label="已停用">`,       ...disabledInterns.map(_opt), `</optgroup>`] : []),
  ].join('');

  // 預設排序：日期／時間降冪（最新在最上）
  const filtered = records.filter(r =>
    (!filterEmail || r.email === filterEmail) &&
    (!filterDate  || r.date  === filterDate)
  ).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  document.getElementById('attendance-body').innerHTML = `

    <div id="att-week-overview" style="margin-bottom:24px;"></div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px;">
      <div>
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">實習生</label>
        <select id="att-filter-email" class="field-select" onchange="renderAttendancePage()" style="min-width:160px;">
          <option value="">全部</option>
          ${internSelectHtml}
        </select>
      </div>
      <div>
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">日期</label>
        <input id="att-filter-date" type="date" class="field-input" value="${filterDate}" onchange="renderAttendancePage()" />
      </div>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('att-map-wrap').style.display='';renderAttendanceMap()">📍 顯示地圖</button>
    </div>

    <div style="overflow-x:auto;margin-bottom:24px;">
      <table class="data-table" style="min-width:480px;">
        <thead><tr>
          <th>姓名</th><th>類型</th><th>時間</th><th>定位</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px;">無打卡紀錄</td></tr>'
            : filtered.map(r => {
                const { icon, text, color } = _punchLabel(r, records);
                return `<tr>
                <td>${r.name || r.email}</td>
                <td><span style="font-weight:600;color:${color}">${icon} ${text}</span>${r.manual ? ' <span style="font-size:.7rem;color:#6b46c1;background:#e9d8fd;border-radius:4px;padding:0 5px;" title="手動補登">手動</span>' : ''}</td>
                <td>${new Date(r.timestamp).toLocaleString('zh-TW')}</td>
                <td>${r.manual ? `<span style="color:#6b46c1;font-size:.8rem;">手動補登${r.manualNote ? '：' + escHtml(r.manualNote) : ''}</span>` : r.lat ? `<button class="btn btn-secondary btn-sm" onclick="renderAttendanceMapPoint(${r.lat},${r.lng})">📍</button> ${_isNearCampus(r.lat,r.lng)?'<span style="color:#276749">校區內</span>':'<span style="color:#c53030">校區外</span>'}${r.accuracyLow&&!r.locationUpdated?' <span style="color:#c05621" title="定位精度不足">⚠️</span>':''}${r.locationUpdated?` <span style="font-size:.72rem;color:#3182ce;">✏️已更新</span>`:''}${r.locationUpdated&&r.origLat!=null?`<br><span style="font-size:.72rem;color:#a0aec0;">原: ${_isNearCampus(r.origLat,r.origLng)?'校區內':'校區外'}</span>`:''}` : '—'}</td>
              </tr>`;}).join('')}
        </tbody>
      </table>
    </div>

    <div id="att-map-wrap" style="display:none;margin-bottom:24px;">
      <div style="font-weight:600;color:#2d3748;margin-bottom:8px;">打卡位置地圖</div>
      <div id="att-map" style="height:340px;border-radius:10px;overflow:hidden;"></div>
    </div>
  `;
  renderWeekAttendanceOverview('att-week-overview', activeInterns.map(i => i.email));
  _initGeoFenceCard();
}

// ── 打卡紀錄／定位／手動 小徽章（差勤匯總表用）；#26-2/3 有定位者可點開小視窗看定位在哪 ──
function _attLocBadgeHtml(rec) {
  if (!rec) return '';
  if (rec.lat == null) return '<span style="background:#edf2f7;color:#718096;border-radius:10px;padding:1px 7px;font-size:.7rem;margin-left:5px;">無定位</span>';
  const click = ` onclick="_attShowLocPopup(${Number(rec.lat)},${Number(rec.lng)})" data-tip="點擊查看打卡定位位置" `;
  return _isNearCampus(rec.lat, rec.lng)
    ? `<span${click}style="background:#c6f6d5;color:#276749;border-radius:10px;padding:1px 7px;font-size:.7rem;margin-left:5px;cursor:pointer;">校內</span>`
    : `<span${click}style="background:#edf2f7;color:#718096;border-radius:10px;padding:1px 7px;font-size:.7rem;margin-left:5px;cursor:pointer;">校外</span>`;
}
// 打卡定位小視窗（Leaflet 地圖＋校區範圍圈），差勤匯總 badge 點擊開啟
let _attLocPopupMap = null;
function _attShowLocPopup(lat, lng) {
  let pop = document.getElementById('att-loc-popup');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'att-loc-popup';
    pop.style.cssText = 'position:fixed;z-index:100000;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);width:min(420px,92vw);overflow:hidden;';
    pop.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#f7fafc;border-bottom:1px solid #e2e8f0;">
        <span id="att-loc-popup-title" style="font-size:.88rem;font-weight:600;color:#2d3748;"></span>
        <button onclick="_attCloseLocPopup()" style="border:none;background:none;font-size:1.05rem;cursor:pointer;color:#718096;line-height:1;">✕</button>
      </div>
      <div id="att-loc-popup-map" style="height:260px;"></div>`;
    document.body.appendChild(pop);
  }
  pop.style.display = '';
  document.getElementById('att-loc-popup-title').textContent = `打卡定位（${_isNearCampus(lat, lng) ? '校內' : '校外'}）`;
  if (_attLocPopupMap) { _attLocPopupMap.remove(); _attLocPopupMap = null; }
  _attLocPopupMap = L.map('att-loc-popup-map').setView([lat, lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_attLocPopupMap);
  L.marker([lat, lng]).addTo(_attLocPopupMap);
  const gc = _geoFenceCfg();
  L.circle([gc.lat, gc.lng], { radius: gc.radius, color: '#3182ce', fillOpacity: .08 }).addTo(_attLocPopupMap);
}
function _attCloseLocPopup() {
  const pop = document.getElementById('att-loc-popup');
  if (pop) pop.style.display = 'none';
  if (_attLocPopupMap) { _attLocPopupMap.remove(); _attLocPopupMap = null; }
}
function _attManualBadgeHtml(rec) {
  return rec?.manual ? '<span style="background:#feebc8;color:#c05621;border-radius:10px;padding:1px 7px;font-size:.7rem;margin-left:5px;">手動</span>' : '';
}

// ══════════════════════════════════════════════
//  差勤匯總（分頁）：可依日期／月份＋實習生篩選，並可就地列印月報表
// ══════════════════════════════════════════════
let _attSumMode = 'date'; // 'date' | 'month'
// 管理者手動補登打卡：替選定人員新增一筆打卡（併發安全，走 _attendanceCommit）
async function submitAdminManualPunch() {
  const email = document.getElementById('att-adm-email')?.value || '';
  const date  = document.getElementById('att-adm-date')?.value  || '';
  const time  = document.getElementById('att-adm-time')?.value  || '';
  const reason = (document.getElementById('att-adm-reason')?.value || '').trim();
  const msg = document.getElementById('att-adm-msg');
  const _m = (type, t) => { if (msg) { msg.style.display = ''; msg.style.color = type === 'error' ? '#c53030' : type === 'success' ? '#276749' : '#718096'; msg.textContent = t; } };
  if (!email) { _m('error', '請選擇補登對象'); return; }
  if (!date)  { _m('error', '請選擇日期'); return; }
  if (!time)  { _m('error', '請選擇時間'); return; }
  const when = new Date(`${date}T${time}`);
  if (isNaN(when.getTime())) { _m('error', '時間格式不正確'); return; }
  if (when.getTime() > Date.now() + 60000) { _m('error', '打卡時間不可為未來時間'); return; }
  const u = configData?.users?.[email] || {};
  const record = {
    id: 'att_' + email + '_' + when.getTime(),
    email, name: u.name || email, type: 'punch',
    timestamp: when.toISOString(), date: _fmtDate(when),
    manual: true, manualBy: currentUser.email,
    manualByName: configData?.users?.[currentUser.email]?.name || currentUser.name || '',
    manualByAdmin: true, manualAt: new Date().toISOString(),
    ...(reason ? { manualNote: reason } : {}),
  };
  _m('info', '⏳ 補登中…');
  try {
    await _attendanceCommit([record]);
    auditLog('管理者手動補登打卡', null, null, `${u.name || email} ${date} ${time}${reason ? '（' + reason + '）' : ''}`, { major: true });
    _m('success', `✅ 已為 ${u.name || email} 補登 ${date} ${time}`);
    renderAttendanceSummary();
  } catch (e) {
    _m('error', '補登失敗：' + e.message);
  }
}

function _attSumSetMode(mode) {
  _attSumMode = mode;
  renderAttendanceSummary();
}
function renderAttendanceSummary() {
  const body = document.getElementById('attendance-body');
  if (!body) return;
  const records = attendanceData?.records || [];
  const users = configData?.users || {};
  const today = _fmtDate(new Date());
  const thisMonth = today.slice(0, 7);
  const filterEmailVal = document.getElementById('att-sum-email')?.value ?? '';
  const filterDate  = document.getElementById('att-sum-date')?.value  || today;
  const filterMonth = document.getElementById('att-sum-month')?.value || thisMonth;

  const allInterns = Object.entries(users)
    .filter(([, u]) => u.role === '實習諮商心理師')
    .map(([email, u]) => ({ email, name: u.name || email, active: _isInternActive(u, today), disabled: !!u.disabled }));
  const _ig = (cat) => allInterns.filter(i => i.cat === cat).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  allInterns.forEach(i => { i.cat = i.disabled ? 2 : i.active ? 0 : 1; });
  const _opt = i => `<option value="${i.email}" ${filterEmailVal === i.email ? 'selected' : ''}>${i.name}${i.cat === 1 ? ' (非在任)' : i.cat === 2 ? ' (停用)' : ''}</option>`;
  const internSelectHtml = [
    ...(_ig(0).length ? [`<optgroup label="在任實習生">`, ..._ig(0).map(_opt), `</optgroup>`] : []),
    ...(_ig(1).length ? [`<optgroup label="非在任實習生">`, ..._ig(1).map(_opt), `</optgroup>`] : []),
    ...(_ig(2).length ? [`<optgroup label="已停用">`, ..._ig(2).map(_opt), `</optgroup>`] : []),
  ].join('');
  // 管理者手動補登打卡：對象可為任一未停用且有姓名的使用者
  const _admPersonOpts = Object.entries(users)
    .filter(([, u]) => u && !u.disabled && u.name)
    .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'zh-Hant'))
    .map(([email, u]) => `<option value="${escHtml(email)}">${escHtml(u.name)}${u.role ? '（' + escHtml(u.role) + '）' : ''}</option>`).join('');

  const filtered = records.filter(r =>
    (!filterEmailVal || r.email === filterEmailVal) &&
    (_attSumMode === 'date' ? r.date === filterDate : r.date.startsWith(filterMonth))
  );
  const summaryMap = {};
  filtered.forEach(r => {
    if (!summaryMap[r.email]) summaryMap[r.email] = {};
    if (!summaryMap[r.email][r.date]) summaryMap[r.email][r.date] = [];
    summaryMap[r.email][r.date].push(r);
  });
  const printMonth = _attSumMode === 'month' ? filterMonth : filterDate.slice(0, 7);

  body.innerHTML = `
    <div style="background:#fffaf0;border:1px solid #fbd38d;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="font-weight:600;color:#9c4221;margin-bottom:6px;">🖊️ 管理者手動補登打卡</div>
      <p style="font-size:.8rem;color:#975a16;margin:0 0 10px;">替同仁補登一筆打卡（如忘記打卡）。簽到／簽退由當日時間先後自動判定；補登紀錄會標記「手動 · 由管理者」供稽核。</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div><label style="font-size:.78rem;color:#975a16;display:block;margin-bottom:3px;">對象</label>
          <select id="att-adm-email" class="field-select" style="min-width:170px;"><option value="">選擇人員…</option>${_admPersonOpts}</select></div>
        <div><label style="font-size:.78rem;color:#975a16;display:block;margin-bottom:3px;">日期</label>
          <input id="att-adm-date" type="date" class="field-input" value="${today}"></div>
        <div><label style="font-size:.78rem;color:#975a16;display:block;margin-bottom:3px;">時間</label>
          <input id="att-adm-time" type="time" class="field-input"></div>
        <div style="flex:1;min-width:140px;"><label style="font-size:.78rem;color:#975a16;display:block;margin-bottom:3px;">原因</label>
          <input id="att-adm-reason" type="text" class="field-input" placeholder="如：忘記打卡" style="width:100%;"></div>
        <button class="btn btn-primary btn-sm" onclick="submitAdminManualPunch()">補登打卡</button>
      </div>
      <div id="att-adm-msg" style="display:none;margin-top:8px;font-size:.82rem;"></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px;">
      <div style="display:flex;gap:6px;">
        <label class="bk-view-chip${_attSumMode === 'date' ? ' bk-view-chip-sel' : ''}" onclick="_attSumSetMode('date')"><span class="bk-view-chip-box">${_attSumMode === 'date' ? '✓' : ''}</span>依日期</label>
        <label class="bk-view-chip${_attSumMode === 'month' ? ' bk-view-chip-sel' : ''}" onclick="_attSumSetMode('month')"><span class="bk-view-chip-box">${_attSumMode === 'month' ? '✓' : ''}</span>依月份</label>
      </div>
      <div style="display:${_attSumMode === 'date' ? '' : 'none'};">
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">日期</label>
        <input id="att-sum-date" type="date" class="field-input" value="${filterDate}" onchange="renderAttendanceSummary()" />
      </div>
      <div style="display:${_attSumMode === 'month' ? '' : 'none'};">
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">月份</label>
        <input id="att-sum-month" type="month" class="field-input" value="${filterMonth}" onchange="renderAttendanceSummary()" />
      </div>
      <div>
        <label style="font-size:.82rem;color:#718096;display:block;margin-bottom:4px;">實習生</label>
        <select id="att-sum-email" class="field-select" onchange="renderAttendanceSummary()" style="min-width:160px;">
          <option value="">全部</option>
          ${internSelectHtml}
        </select>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="printAttendanceMonthlyReport(document.getElementById('att-sum-email').value, '${printMonth}')">🖨️ 列印月報表</button>
    </div>
    <div style="overflow-x:auto;">
      <table class="data-table" style="min-width:520px;">
        <thead><tr><th>實習生</th><th>日期</th><th>簽到</th><th>簽退</th><th>工時</th></tr></thead>
        <tbody>
          ${Object.entries(summaryMap).flatMap(([email, dates]) =>
              Object.entries(dates).map(([date, recs]) => {
                const sorted = [...recs].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
                const name = users[email]?.name || email;
                const inRec  = sorted.length > 0 ? sorted[0] : null;
                const outRec = sorted.length > 1 ? sorted[sorted.length - 1] : null;
                const inT  = inRec  ? _fmtTime(inRec.timestamp)  + _attLocBadgeHtml(inRec)  + _attManualBadgeHtml(inRec)  : '—';
                const outT = outRec ? _fmtTime(outRec.timestamp) + _attLocBadgeHtml(outRec) + _attManualBadgeHtml(outRec) : '—';
                const hrs  = sorted.length > 1
                  ? ((new Date(sorted[sorted.length - 1].timestamp) - new Date(sorted[0].timestamp)) / 3600000).toFixed(1) + ' h'
                  : '—';
                return `<tr><td>${escHtml(name)}</td><td>${date}</td><td>${inT}</td><td>${outT}</td><td>${hrs}</td></tr>`;
              })
          ).join('') || '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:16px;">無紀錄</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════
//  出勤月報表列印（A4 直式，供紙本核章）
// ══════════════════════════════════════════════
// 權限：印自己＝一律可以；印別人＝需為主任／系統管理者／實習生行政或專業督導
function printAttendanceMonthlyReport(email, yyyymm) {
  if (!email) { alert('請先選擇要列印的實習生'); return; }
  const isMgr = currentRole === '主任' || extraRole === '管理者' || isInternAdminSupervisor || isInternProSupervisor;
  if (email !== currentUser.email && !isMgr) { alert('您沒有權限列印其他人的月報表'); return; }
  const ym = (yyyymm && /^\d{4}-\d{2}$/.test(yyyymm)) ? yyyymm : _fmtDate(new Date()).slice(0, 7);
  const [yearStr, monthStr] = ym.split('-');
  const year = Number(yearStr), month = Number(monthStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const name = configData?.users?.[email]?.name || email;
  const esc = s => escHtml(String(s == null ? '' : s));
  const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
  const pad2 = n => String(n).padStart(2, '0');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  // 打卡資料（沿用 _dailyWorkHours）
  const workByDate = {};
  _dailyWorkHours(email, ym).forEach(d => { workByDate[d.date] = d; });
  const allRecords = attendanceData?.records || [];

  // 假別 / 加班（approved，且日期範圍與本月有重疊）
  const monthStart = `${ym}-01`, monthEnd = `${ym}-${pad2(daysInMonth)}`;
  const apps = (leavesData?.applications || []).filter(a =>
    a.email === email && a.status === 'approved' &&
    (a.fromDate || '') <= monthEnd && (a.toDate || a.fromDate || '') >= monthStart);

  const leaveTotals = {}; // leaveTypeName -> 小時
  let overtimeTotal = 0;
  apps.forEach(a => {
    if (a.kind === 'overtime') overtimeTotal += Number(a.hours) || 0;
    else leaveTotals[a.leaveTypeName] = (leaveTotals[a.leaveTypeName] || 0) + (Number(a.hours) || 0);
  });
  const leaveTotal = Object.values(leaveTotals).reduce((s, h) => s + h, 0);

  const rows = [];
  let totalWorkHours = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${ym}-${pad2(day)}`;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    const w = workByDate[dateStr];
    // #4：手動補登註記改標在簽到/簽退時間旁（精簡為「手動」），不再佔用註記欄
    const dayRecs = allRecords.filter(r => r.email === email && r.date === dateStr)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    let inCell = '', outCell = '', hoursCell = '';
    if (w) {
      inCell = w.first ? _fmtTime(w.first) + (dayRecs[0]?.manual ? '（手動）' : '') : '';
      if (w.count >= 2) { outCell = _fmtTime(w.last) + (dayRecs[dayRecs.length - 1]?.manual ? '（手動）' : ''); hoursCell = w.hours + ' 小時'; totalWorkHours += w.hours; }
      else { hoursCell = '單筆打卡'; }
    }

    const notes = [];
    apps.forEach(a => {
      const from = a.fromDate || '', to = a.toDate || a.fromDate || '';
      if (dateStr < from || dateStr > to) return;
      if (a.kind === 'overtime') { notes.push(`加班認證 ${a.hours} 小時`); return; }
      // 請假：補上核准資訊「幾月幾日由誰核准」；舊資料若無 reviewedAt/reviewedByName 則維持原樣
      let note = `${a.leaveTypeName} ${a.hours} 小時`;
      if (a.reviewedAt && a.reviewedByName) {
        const rd = new Date(a.reviewedAt);
        if (!isNaN(rd.getTime())) note += `（${rd.getMonth() + 1}/${rd.getDate()} ${a.reviewedByName}核准）`;
      }
      notes.push(note);
    });

    // 週六日預設不列印整列；但當天若有打卡（含手動補登）、核准請假或加班認證，仍照常呈現該列（含灰底標示週末）
    const hasRecordToday = !!w || notes.length > 0;
    if (isWeekend && !hasRecordToday) continue;

    rows.push(`<tr${isWeekend ? ' class="we"' : ''}>
      <td>${month}/${day}（${weekdays[dow]}）</td>
      <td>${esc(inCell)}</td>
      <td>${esc(outCell)}</td>
      <td>${esc(hoursCell)}</td>
      <td class="note">${esc(notes.join('、'))}</td>
    </tr>`);
  }

  const leaveDetailStr = Object.entries(leaveTotals).map(([n, h]) => `${n} ${r1(h)} 小時`).join('、') || '無';
  const printDateTime = new Date().toLocaleString('zh-TW');
  const printerName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.email || '';

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>出勤月報表 ${esc(name)} ${esc(ym)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft JhengHei','微軟正黑體','Noto Sans TC',sans-serif; font-size: 11pt; color: #1a202c; margin: 0; padding: 0; }
  .hdr1 { text-align:center; font-size:16pt; font-weight:700; letter-spacing:.04em; }
  .hdr2 { text-align:center; font-size:14pt; font-weight:700; margin-top:2mm; letter-spacing:.06em; }
  .hdr3 { text-align:center; font-size:11pt; color:#2d3748; margin-top:4mm; }
  .hdr4 { text-align:right; font-size:9pt; color:#718096; margin-top:2mm; }
  .hr { border-top:1px solid #333; margin:3mm 0 4mm; }
  table.rpt { width:100%; border-collapse:collapse; font-size:10pt; }
  table.rpt th, table.rpt td { border:1px solid #555; padding:2.2pt 4pt; text-align:center; }
  table.rpt th { background:#f0f0f0; font-weight:700; }
  table.rpt td.note { text-align:left; font-size:9pt; color:#4a5568; }
  tr.we { background:#f0f0f0; }
  .summary { margin-top:5mm; font-size:11pt; line-height:1.9; }
  .summary b { color:#1a202c; }
  .sig-wrap { margin-top:10mm; page-break-inside: avoid; break-inside: avoid; }
  table.sig-tbl { width:100%; border-collapse:collapse; table-layout:fixed; }
  table.sig-tbl td { border:1px solid #333; height:25mm; width:25%; vertical-align:top; padding:5pt 6pt; }
  .sig-cell { display:flex; flex-direction:column; justify-content:space-between; height:100%; }
  .sig-cell .lbl { text-align:center; font-weight:700; font-size:11pt; }
  .sig-cell .dt { text-align:center; font-size:9pt; color:#333; }
  .foot { margin-top:6mm; font-size:8pt; color:#a0aec0; text-align:right; }
</style>
</head>
<body>
<div class="hdr1">國立屏東科技大學學生事務處學生諮商中心</div>
<div class="hdr2">實習心理師出勤月報表</div>
<div class="hdr3">姓名：${esc(name)}　年月：${year} 年 ${month} 月</div>
<div class="hdr4">列印時間：${esc(printDateTime)}</div>
<div class="hr"></div>
<table class="rpt">
  <thead><tr><th style="width:20%;">日期</th><th style="width:14%;">簽到</th><th style="width:14%;">簽退</th><th style="width:14%;">工時</th><th>註記</th></tr></thead>
  <tbody>${rows.join('')}</tbody>
</table>
<div class="summary">
  <div>當月總工時：<b>${r1(totalWorkHours)} 小時</b></div>
  <div>請假總時數：<b>${r1(leaveTotal)} 小時</b>（${esc(leaveDetailStr)}）</div>
  <div>加班認證總時數：<b>${r1(overtimeTotal)} 小時</b></div>
</div>
<div class="sig-wrap">
  <table class="sig-tbl"><tr>
    <td><div class="sig-cell"><div class="lbl">實習生簽名</div><div class="dt">日期：＿＿＿＿＿＿</div></div></td>
    <td><div class="sig-cell"><div class="lbl">行政督導</div><div class="dt">日期：＿＿＿＿＿＿</div></div></td>
    <td><div class="sig-cell"><div class="lbl">專業督導</div><div class="dt">日期：＿＿＿＿＿＿</div></div></td>
    <td><div class="sig-cell"><div class="lbl">主任</div><div class="dt">日期：＿＿＿＿＿＿</div></div></td>
  </tr></table>
</div>
<div class="foot">${esc(printerName)} 列印　國立屏東科技大學學生諮商中心資訊系統</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=820,height=1060');
  if (!win) { alert('請允許彈出視窗以開啟列印預覽'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 700);
}

let _attMapInstance = null;
function renderAttendanceMap() {
  const records = (attendanceData?.records || []).filter(r => r.lat);
  if (_attMapInstance) { _attMapInstance.remove(); _attMapInstance = null; }
  const _gc = _geoFenceCfg();
  _attMapInstance = L.map('att-map').setView([_gc.lat, _gc.lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_attMapInstance);
  L.circle([_gc.lat, _gc.lng], { radius: _gc.radius, color: '#3182ce', fillOpacity: .08 }).addTo(_attMapInstance);
  const _allRecs = attendanceData?.records || [];
  records.forEach(r => {
    const { text } = _punchLabel(r, _allRecs);
    L.marker([r.lat, r.lng], { title: r.name + ' ' + text })
      .addTo(_attMapInstance)
      .bindPopup(`${r.name || r.email}<br>${text} ${_fmtTime(r.timestamp)}`);
  });
}

function renderAttendanceMapPoint(lat, lng) {
  document.getElementById('att-map-wrap').style.display = '';
  if (_attMapInstance) { _attMapInstance.remove(); _attMapInstance = null; }
  _attMapInstance = L.map('att-map').setView([lat, lng], 17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_attMapInstance);
  L.marker([lat, lng]).addTo(_attMapInstance);
  document.getElementById('att-map').scrollIntoView({ behavior: 'smooth' });
}

// ── 地理圍欄設定（管理者） ──
let _geoPreviewMap = null;

function _initGeoFenceCard() {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const card = document.getElementById('geo-fence-card');
  if (!card) return;
  card.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) return;
  const gc = _geoFenceCfg();
  document.getElementById('geo-lat').value    = gc.lat;
  document.getElementById('geo-lng').value    = gc.lng;
  document.getElementById('geo-radius').value = gc.radius;
}

// ══════════════════════════════════════════════
//  實習生專屬打卡網址（免登入）── 差勤管理後台卡片
//  後端硬閘（見 Code.gs _clockTokenAdminGate_）才是真正的權限邊界；此處判斷只決定 UI 是否顯示，
//  不是安全邊界——攻擊者呼叫 proxyCall('clockTokenIssue', ...) 一樣會被後端擋下。
// ══════════════════════════════════════════════
function _isClockTokenMgr() {
  return currentRole === '主任' || extraRole === '管理者' || isInternAdminSupervisor || isInternProSupervisor;
}

let _clockTokenListCache = null; // null＝尚未載入完成；載入後為 {email:{iat,exp,issuedBy}} 物件（可能為空物件）

function _initClockTokenCard() {
  const isMgr = _isClockTokenMgr();
  const card = document.getElementById('clock-token-card');
  if (!card) return;
  card.style.display = isMgr ? '' : 'none';
  if (!isMgr) return;
  _clockTokenListCache = null;
  _renderClockTokenList();
  proxyCall('clockTokenList').then(res => {
    _clockTokenListCache = res?.tokens || {};
    _renderClockTokenList();
  }).catch(e => {
    console.warn('[clockTokenList] 失敗:', e.message);
    _clockTokenListCache = {};
    _renderClockTokenList();
  });
}

function _ctSafeId(email) { return String(email).replace(/[^a-zA-Z0-9]/g, '_'); }

function _clockTokenInterns() {
  const users = configData?.users || {};
  return Object.entries(users)
    .filter(([, u]) => u.role === '實習諮商心理師' && u.disabled !== true)
    .map(([email, u]) => ({ email, name: u.name || email }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
}

function _clockTokenRowStatusHtml(email) {
  if (_clockTokenListCache === null) return '<span style="color:#a0aec0;">載入中…</span>';
  const info = _clockTokenListCache[email];
  if (!info) return '<span style="color:#a0aec0;">未產生</span>';
  const expStr = info.exp ? _fmtDate(new Date(info.exp * 1000)) : '—';
  return `<span style="color:#276749;">已產生（到期 ${escHtml(expStr)}・由 ${escHtml(_userName(info.issuedBy))} 產生）</span>`;
}

function _clockTokenRowButtonsHtml(email) {
  const hasInfo = !!(_clockTokenListCache && _clockTokenListCache[email]);
  return `
    <button class="btn btn-secondary btn-sm" onclick="_clockTokenGenerate('${email}')">${hasInfo ? '重新產生' : '產生'}</button>
    ${hasInfo ? `<button class="btn btn-danger btn-sm" onclick="_clockTokenRevokeClick('${email}')">停用</button>` : ''}`;
}

function _renderClockTokenList() {
  const body = document.getElementById('clock-token-body');
  if (!body) return;
  const interns = _clockTokenInterns();
  if (!interns.length) {
    body.innerHTML = '<div style="color:#a0aec0;font-size:.88rem;padding:8px 0;">目前沒有「實習諮商心理師」身分的使用者。</div>';
    return;
  }
  body.innerHTML = interns.map(({ email, name }) => {
    const sid = _ctSafeId(email);
    return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #f7fafc;">
      <div style="min-width:140px;">
        <div style="font-weight:600;color:#2d3748;">${escHtml(name)}</div>
        <div style="font-size:.74rem;color:#a0aec0;">${escHtml(email)}</div>
      </div>
      <div id="ct-status-${sid}" style="flex:1;min-width:180px;font-size:.85rem;">${_clockTokenRowStatusHtml(email)}</div>
      <div id="ct-btns-${sid}" style="display:flex;gap:6px;flex-shrink:0;">${_clockTokenRowButtonsHtml(email)}</div>
      <div id="ct-url-wrap-${sid}" style="width:100%;"></div>
    </div>`;
  }).join('');
}

async function _clockTokenGenerate(email) {
  const isRegenerate = !!(_clockTokenListCache && _clockTokenListCache[email]);
  if (isRegenerate && !confirm(`確定要重新產生「${_userName(email)}」的打卡網址嗎？\n重新產生後，舊網址將立即失效。`)) return;
  const sid = _ctSafeId(email);
  try {
    const res = await proxyCall('clockTokenIssue', { email });
    // 指向獨立打卡頁（scc-clock repo）：主網站遷移/轉私有後網址仍長期有效；舊 ?page=clock#ct= 網址過渡期仍可用
    const url = CLOCK_PAGE_URL + '#ct=' + res.token;
    if (!_clockTokenListCache) _clockTokenListCache = {};
    _clockTokenListCache[email] = { iat: Math.floor(Date.now() / 1000), exp: res.exp, issuedBy: currentUser.email };
    const statusEl = document.getElementById('ct-status-' + sid);
    const btnsEl  = document.getElementById('ct-btns-' + sid);
    const urlWrap = document.getElementById('ct-url-wrap-' + sid);
    if (statusEl) statusEl.innerHTML = _clockTokenRowStatusHtml(email);
    if (btnsEl)  btnsEl.innerHTML  = _clockTokenRowButtonsHtml(email);
    if (urlWrap) urlWrap.innerHTML = `
      <div style="width:100%;margin-top:8px;padding:10px;background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;">
        <div style="font-size:.76rem;color:#c05621;font-weight:600;margin-bottom:6px;">⚠️ 網址僅此刻顯示，請當場複製傳給實習生；遺失請重新產生。</div>
        <div style="display:flex;gap:6px;">
          <input type="text" readonly value="${escHtml(url)}" style="flex:1;font-size:.8rem;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;" onclick="this.select()">
          <button class="btn btn-secondary btn-sm" onclick="_clockTokenCopyUrl(this)">📋 複製</button>
        </div>
      </div>`;
    // 稽核不記錄 token 本體，只記姓名/email（去識別化原則不適用此處——本來就是留痕給誰產生過網址）
    auditLog(isRegenerate ? '重新產生專屬打卡網址' : '產生專屬打卡網址', null, null, _userName(email));
    showToast(`✅ 已${isRegenerate ? '重新' : ''}產生打卡網址，請立即複製傳給實習生`, 'success');
  } catch (e) {
    showToast('產生失敗：' + e.message, 'error');
  }
}

function _clockTokenCopyUrl(btn) {
  const input = btn.previousElementSibling;
  if (!input) return;
  input.select();
  const done = () => showToast('已複製網址', 'success');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(input.value).then(done).catch(() => {
      try { document.execCommand('copy'); done(); } catch (_) { showToast('複製失敗，請手動選取複製', 'error'); }
    });
  } else {
    try { document.execCommand('copy'); done(); } catch (_) { showToast('複製失敗，請手動選取複製', 'error'); }
  }
}

async function _clockTokenRevokeClick(email) {
  if (!confirm(`確定要停用「${_userName(email)}」的打卡網址嗎？\n停用後該網址將立即失效。`)) return;
  const sid = _ctSafeId(email);
  try {
    await proxyCall('clockTokenRevoke', { email });
    if (_clockTokenListCache) delete _clockTokenListCache[email];
    const statusEl = document.getElementById('ct-status-' + sid);
    const btnsEl  = document.getElementById('ct-btns-' + sid);
    const urlWrap = document.getElementById('ct-url-wrap-' + sid);
    if (statusEl) statusEl.innerHTML = _clockTokenRowStatusHtml(email);
    if (btnsEl)  btnsEl.innerHTML  = _clockTokenRowButtonsHtml(email);
    if (urlWrap) urlWrap.innerHTML = '';
    auditLog('停用專屬打卡網址', null, null, _userName(email));
    showToast('已停用打卡網址', 'success');
  } catch (e) {
    showToast('停用失敗：' + e.message, 'error');
  }
}

function previewGeoFence() {
  const lat    = parseFloat(document.getElementById('geo-lat').value);
  const lng    = parseFloat(document.getElementById('geo-lng').value);
  const radius = parseFloat(document.getElementById('geo-radius').value);
  if (!lat || !lng || !radius) return;
  const wrap = document.getElementById('geo-map-wrap');
  wrap.style.display = '';
  if (_geoPreviewMap) { _geoPreviewMap.remove(); _geoPreviewMap = null; }
  _geoPreviewMap = L.map('geo-map').setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_geoPreviewMap);
  L.circle([lat, lng], { radius, color: '#3182ce', fillOpacity: .12 }).addTo(_geoPreviewMap);
  L.marker([lat, lng]).addTo(_geoPreviewMap).bindPopup('中心點').openPopup();
}

async function saveGeoFenceSettings() {
  const lat    = parseFloat(document.getElementById('geo-lat').value);
  const lng    = parseFloat(document.getElementById('geo-lng').value);
  const radius = parseFloat(document.getElementById('geo-radius').value);
  const msg    = document.getElementById('geo-msg');
  if (!lat || !lng || isNaN(radius) || radius < 100) {
    msg.style.display = '';
    msg.style.color   = '#c53030';
    msg.textContent   = '請填入有效的座標與半徑（至少 100 公尺）。';
    return;
  }
  msg.style.display = '';
  msg.style.color   = '#4a5568';
  msg.textContent   = '儲存中…';
  try {
    if (!configData) throw new Error('configData 未載入');
    configData.attendanceGeoFence = { lat, lng, radius };
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    msg.style.color = '#276749';
    msg.textContent = '✅ 已儲存。打卡範圍設定已更新。';
  } catch (e) {
    msg.style.color = '#c53030';
    msg.textContent = '儲存失敗：' + e.message;
  }
}

// ── 帳號申請審核 ──
let _approveTargetId = null;
function openApproveModal(appId) {
  _approveTargetId = appId;
  const app = pendingUsersData.applications.find(a => a.id === appId);
  if (!app) return;
  const users = configData?.users || {};
  const noMailUsers = Object.entries(users)
    .filter(([, u]) => u.noMail || !u.gmail)
    .map(([email, u]) => ({ email, name: u.name }));

  const el = document.getElementById('approve-modal');
  if (el) el.remove();
  const modal = document.createElement('div');
  modal.id = 'approve-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;max-width:440px;width:100%;max-height:80vh;overflow-y:auto;">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:16px;">審核帳號申請</div>
      <div style="margin-bottom:12px;font-size:.9rem;color:#4a5568;">
        <b>${app.name}</b>（${app.email}）<br>申請身分：${app.requestedRole}
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:.85rem;color:#4a5568;display:block;margin-bottom:4px;">處理方式</label>
        <select id="approve-action" class="field-select" style="width:100%;" onchange="_onApproveActionChange()">
          <option value="new">建立新帳號</option>
          ${noMailUsers.length > 0 ? `<option value="link">連結到現有使用者（補 Gmail）</option>` : ''}
        </select>
      </div>
      <div id="approve-link-wrap" style="display:none;margin-bottom:14px;">
        <label style="font-size:.85rem;color:#4a5568;display:block;margin-bottom:4px;">連結對象</label>
        <select id="approve-link-target" class="field-select" style="width:100%;">
          ${noMailUsers.map(u => `<option value="${u.email}">${u.name}（${u.email}）</option>`).join('')}
        </select>
      </div>
      <div id="approve-new-fields">
        <div style="margin-bottom:12px;">
          <label style="font-size:.85rem;color:#4a5568;display:block;margin-bottom:4px;">指派角色</label>
          <select id="approve-role" class="field-select" style="width:100%;">
            ${ROLES.filter(r => r !== '系統管理者').map(r => `<option value="${r}" ${r===app.requestedRole?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="approve-modal-err" class="alert alert-error" style="display:none;margin-bottom:12px;"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="_doApproveUser()" style="flex:1;">確認通過</button>
        <button class="btn btn-secondary" onclick="document.getElementById('approve-modal').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _onApproveActionChange() {
  const action = document.getElementById('approve-action').value;
  document.getElementById('approve-link-wrap').style.display  = action === 'link' ? '' : 'none';
  document.getElementById('approve-new-fields').style.display = action === 'new'  ? '' : 'none';
}

async function _doApproveUser() {
  const app = pendingUsersData.applications.find(a => a.id === _approveTargetId);
  if (!app) return;
  const action = document.getElementById('approve-action').value;
  const errEl  = document.getElementById('approve-modal-err');
  errEl.style.display = 'none';

  try {
    if (action === 'new') {
      const role = document.getElementById('approve-role').value;
      if (!configData.users) configData.users = {};
      configData.users[app.email] = { name: app.name, role };
      await driveUpdateJsonFile('config.json', configData);
      // 清除 Apps Script 白名單快取（5 分鐘後自動過期，無法主動清除）
    } else {
      const linkEmail = document.getElementById('approve-link-target').value;
      if (!configData.users[linkEmail]) throw new Error('找不到目標使用者');
      configData.users[app.email] = { ...configData.users[linkEmail] };
      delete configData.users[linkEmail];
      await driveUpdateJsonFile('config.json', configData);
    }
    app.status = 'approved';
    app.approvedAt = new Date().toISOString();
    app.approvedBy = currentUser.email;
    await savePendingUsers();
    const _approvedRole = action === 'new' ? document.getElementById('approve-role').value : '（連結現有使用者）';
    auditLog('審核通過帳號申請', null, null, `${app.name}（${app.email}）→ ${_approvedRole}`);
    document.getElementById('approve-modal').remove();
    _refreshPendingAppsViews();
  } catch (e) {
    errEl.textContent = '操作失敗：' + e.message;
    errEl.style.display = '';
  }
}

async function rejectUserApp(appId) {
  const app = pendingUsersData?.applications?.find(a => a.id === appId);
  if (!app) return;
  if (!confirm(`確定拒絕 ${app.name}（${app.email}）的申請？`)) return;
  app.status   = 'rejected';
  app.rejectedAt = new Date().toISOString();
  app.rejectedBy = currentUser.email;
  await savePendingUsers();
  auditLog('拒絕帳號申請', null, null, `${app.name}（${app.email}）`);
  _refreshPendingAppsViews();
}

// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的申請單，經 listCommit 依 id upsert/remove，
// 取代整檔覆寫（多位管理者同時審核時會互蓋彼此的審核結果）。
async function savePendingUsers() {
  if (!pendingUsersData || !Array.isArray(pendingUsersData.applications)) pendingUsersData = { applications: [] };
  const diff = _diffListById(_pendingUsersSnapshot, pendingUsersData.applications);
  if (!diff) { await driveUpdateJsonFile(PENDING_USERS_FILE, pendingUsersData); _pendingUsersSnapshot = _deepClone(pendingUsersData.applications); return; }
  const res = await _listCommit(PENDING_USERS_FILE, diff);
  if (res && res.fallback) { await driveUpdateJsonFile(PENDING_USERS_FILE, pendingUsersData); _pendingUsersSnapshot = _deepClone(pendingUsersData.applications); return; }
  if (res && res.data && Array.isArray(res.data.applications)) {
    pendingUsersData.applications = res.data.applications;
    _pendingUsersSnapshot = _deepClone(pendingUsersData.applications);
  }
}

