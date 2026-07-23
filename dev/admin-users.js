// dev/admin-users.js — 使用者管理群（拆 index.html 絞殺者第二十七刀，v274）。
// 內容為從 index.html 逐字搬出的連續區段（使用者列表渲染/使用者 Modal/帳號安全卡/
// 批次建立與修改登入帳號/登入紀錄 tab/磁碟健康 tab）。
// 載入期副作用（column-0 複核）：let _modalSuperviseeSelected = new Set()（內建）與
// window._onModalSuperviseeToggle 賦值，無裸呼叫、無 document 監聽，可安全前移到主
// inline script 之前載入（刀法①）。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  渲染管理員使用者列表
// ══════════════════════════════════════════════
let _adminUserFilter = { status: 'active', role: '' };
let _adminActiveTab  = 'users';

function renderAdminPage() {
  _renderAdminTabs();
  const tab = _adminActiveTab;
  document.getElementById('admin-panel-users').style.display      = tab === 'users'     ? '' : 'none';
  const sessPanel = document.getElementById('admin-panel-sessions');
  if (sessPanel) sessPanel.style.display = tab === 'sessions' ? '' : 'none';
  document.getElementById('admin-panel-apps').style.display       = tab === 'apps'      ? '' : 'none';
  document.getElementById('admin-panel-depts').style.display      = tab === 'depts'     ? '' : 'none';
  document.getElementById('admin-panel-presets').style.display    = tab === 'presets'   ? '' : 'none';
  document.getElementById('admin-panel-workhours').style.display  = tab === 'workhours' ? '' : 'none';
  const gcPanel = document.getElementById('admin-panel-gcsync');
  if (gcPanel) gcPanel.style.display = tab === 'gcsync' ? '' : 'none';
  const kwPanel = document.getElementById('admin-panel-keywords');
  if (kwPanel) kwPanel.style.display = tab === 'keywords' ? '' : 'none';
  const dhPanel = document.getElementById('admin-panel-diskhealth');
  if (dhPanel) dhPanel.style.display = tab === 'diskhealth' ? '' : 'none';
  if (tab === 'users')    { renderAdminUsers(); }
  else if (tab === 'sessions')  renderAdminSessions();
  else if (tab === 'apps')      renderPendingUsersTab();
  else if (tab === 'depts')     { renderAdminDegreeMapping(); renderAdminDeptCollege(); }
  else if (tab === 'presets')   { renderAdminPresets(); renderAdminBReasons(); }
  else if (tab === 'workhours') renderAdminWorkHours();
  else if (tab === 'gcsync')    renderAdminGcSync();
  else if (tab === 'keywords')  { const kw = document.getElementById('admin-keywords-wrap'); if (kw) _mlRenderKeywordsTab(kw); }
  else if (tab === 'diskhealth') renderAdminDiskHealth();
}

// v218：使用者管理 tab bar 可拖曳排序。順序來源＝_adminTabOrder()（沿用 navOrder_ 前綴白名單，
// 跨裝置同步＋localStorage 立即生效，見 syncUserPref_/_userPref_），正規化交給既有泛用純函式
// _normalizeTodoTabOrder（不關心 key 語意，待辦 tab 排序原本就是這樣設計的）。tab 集合是條件式的
// （sessions 僅 IS_LOCAL_BACKEND 顯示）——順序陣列仍含完整 8 個 key，只在渲染時依條件過濾，
// 不會因為某裝置看不到某 tab 就打亂已存順序或漏掉其他 key。
const ADMIN_TAB_DEFAULT_ORDER = ['users', 'sessions', 'apps', 'depts', 'presets', 'workhours', 'gcsync', 'keywords', 'diskhealth'];
function _adminTabOrder() {
  return _normalizeTodoTabOrder(_userPref_('navOrder_adminTabs'), ADMIN_TAB_DEFAULT_ORDER);
}
function _setAdminTabOrder(order) {
  syncUserPref_({ navOrder_adminTabs: order });
}
function _renderAdminTabs() {
  const bar = document.getElementById('admin-tab-bar');
  if (!bar) return;
  const count = (pendingUsersData?.applications || []).filter(a => a.status === 'pending').length;
  const badge = count > 0
    ? ` <span style="background:#e53e3e;color:#fff;border-radius:10px;padding:0 5px;font-size:.72rem;">${count}</span>`
    : '';
  const labels = {
    users:     '使用者列表',
    sessions:  '登入紀錄',
    apps:      '帳號申請審核' + badge,
    depts:     '系所與學制',
    presets:   '快速選項',
    workhours: '上班時間',
    gcsync:    'Google 日曆同步',
    keywords:  '關鍵字字庫',
    diskhealth: '磁碟健康',
  };
  const _t = (key, label) => {
    const active = _adminActiveTab === key;
    return `<button type="button" class="scd-drag-item" data-drag-key="${key}" data-tip="可拖曳調整分頁順序" onclick="_adminTab('${key}')"
      style="padding:9px 20px;border:none;border-bottom:2px solid ${active?'#3182ce':'transparent'};
      background:none;color:${active?'#2b6cb0':'#4a5568'};cursor:grab;font-size:.9rem;
      font-weight:${active?'600':'400'};transition:all .15s;">${label}</button>`;
  };
  // v214：「登入紀錄」tab 僅本地帳密＋TOTP 後端顯示（見 IS_LOCAL_BACKEND）——順序陣列仍含此 key，
  // 只在渲染時依條件過濾掉，不影響已存順序的其餘 key。v221：「磁碟健康」同理（資料來源是本地
  // server 才有的 SMART 收集，GAS 版無此後端能力）。
  const order = _adminTabOrder().filter(key => (key !== 'sessions' && key !== 'diskhealth') || IS_LOCAL_BACKEND);
  bar.innerHTML = order.map(key => _t(key, labels[key] ?? key)).join('');
  _scdInitDrag(bar, {
    axis: 'x',
    itemSelector: '.scd-drag-item',
    longPressTouch: true,
    getOrder: _adminTabOrder,
    onReorder: (newOrder) => { _setAdminTabOrder(newOrder); _renderAdminTabs(); },
  });
}

function _adminTab(tab) {
  _adminActiveTab = tab;
  renderAdminPage();
}

function renderPendingUsersTab() {
  const wrap = document.getElementById('admin-apps-wrap');
  if (!wrap) return;
  const apps = (pendingUsersData?.applications || []).filter(a => a.status === 'pending');
  if (!apps.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">✅</div><p>目前沒有待審的帳號申請</p></div>`;
    return;
  }
  wrap.innerHTML = apps.map(a => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px;display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:#2d3748;font-size:.95rem;">${escHtml(a.name)}</div>
        <div style="font-size:.83rem;color:#718096;margin-top:2px;">${escHtml(a.email)}</div>
        <div style="font-size:.83rem;color:#4a5568;margin-top:4px;">申請身分：<b>${escHtml(a.requestedRole)}</b></div>
        ${a.note ? `<div style="font-size:.82rem;color:#718096;margin-top:4px;background:#f7fafc;padding:6px 8px;border-radius:4px;">${escHtml(a.note)}</div>` : ''}
        <div style="font-size:.75rem;color:#a0aec0;margin-top:4px;">申請時間：${new Date(a.submittedAt).toLocaleString('zh-TW')}</div>
        ${a.submittedByEmail && a.submittedByEmail !== a.email ? `<div style="font-size:.75rem;color:#a0aec0;">代為申請帳號：${escHtml(a.submittedByEmail)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;padding-top:4px;">
        <button class="btn btn-primary btn-sm" onclick="openApproveModal('${a.id}')">審核通過</button>
        <button class="btn btn-secondary btn-sm" onclick="rejectUserApp('${a.id}')">拒絕</button>
      </div>
    </div>`).join('');
}

async function _refreshPendingAppsBtn() {
  const btn = document.getElementById('pending-apps-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '重新整理中…'; }
  const jobId = bgJobAdd('帳號申請審核重新整理');
  try {
    pendingUsersData = await proxyCall('readJson', { path: PENDING_USERS_FILE });
  } catch (e) {
    if (e.message.includes('not found') || e.message.includes('Not found')) {
      pendingUsersData = { applications: [] }; // 檔案尚未建立 = 空清單
    } else {
      bgJobFail(jobId, e.message);
      showToast(`❌ 帳號申請審核重新整理失敗：${e.message}`, 'error', 8000);
      if (btn) {
        btn.disabled = false; btn.style.color = '#c53030';
        btn.textContent = '❌ 重新整理失敗（' + e.message + '）';
        setTimeout(() => { btn.style.color = ''; btn.textContent = '重新整理'; }, 4000);
      }
      return;
    }
  }
  if (!pendingUsersData || !Array.isArray(pendingUsersData.applications)) pendingUsersData = { applications: [] };
  _pendingUsersSnapshot = _deepClone(pendingUsersData.applications);
  _updatePendingUsersBadge();
  renderPendingUsersTab();
  const count = (pendingUsersData?.applications || []).filter(a => a.status === 'pending').length;
  bgJobDone(jobId);
  showToast(`✓ 帳號申請審核重新整理完成`, 'success', 4000);
  if (btn) {
    btn.disabled = false;
    btn.textContent = `✅ 已更新（${count} 筆待審）`;
    setTimeout(() => btn.textContent = '重新整理', 3000);
  }
}

function _onRoleChange() {
  const role = document.getElementById('modal-role').value;
  const wrap = document.getElementById('modal-intern-dates-wrap');
  if (wrap) wrap.style.display = role === '實習諮商心理師' ? '' : 'none';
}

function _refreshPendingAppsViews() {
  _updatePendingUsersBadge();
  if (document.getElementById('admin-panel-apps')?.style.display !== 'none') renderPendingUsersTab();
  if (document.getElementById('attendance-body')) renderAttendancePage();
}
let _adminUserSort   = { col: 'role', dir: 1 }; // col: 'key'|'name'|'role'|'extra'; dir: 1=asc, -1=desc

function renderAdminUsers() {
  const allUsers = Object.entries(configData.users || {});

  if (!allUsers.length) {
    document.getElementById('admin-users-wrap').innerHTML = `
      <div class="empty-state"><div class="icon">👥</div>
        <p>尚無使用者（config.json 的 users 資料可能遺失）</p>
        <p style="font-size:.85rem;color:#718096;margin-top:8px;">請點「＋ 新增使用者」逐一重建，或貼上 JSON 批次匯入：</p>
        <textarea id="bulk-users-json" rows="6" style="width:90%;max-width:500px;font-family:monospace;font-size:.8rem;padding:8px;border:1px solid #cbd5e0;border-radius:6px;margin-top:8px;" placeholder='{"email@gmail.com":{"name":"姓名","role":"專任諮商心理師","isAdmin":true},...}'></textarea>
        <br><button class="btn btn-primary" style="margin-top:8px;" onclick="importBulkUsers()">批次匯入使用者</button>
      </div>`;
    return;
  }

  // Counts for filter badges
  const totalCount    = allUsers.length;
  const activeCount   = allUsers.filter(([,i]) => !i.disabled).length;
  const disabledCount = allUsers.filter(([,i]) =>  i.disabled).length;

  // Collect distinct roles present in users
  const presentRoles = [...new Set(allUsers.map(([,i]) => i.role).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-TW'));

  // Apply filters
  const { status: fStatus, role: fRole } = _adminUserFilter;
  const filtered = allUsers.filter(([, info]) => {
    if (fStatus === 'active'   && info.disabled) return false;
    if (fStatus === 'disabled' && !info.disabled) return false;
    if (fRole && info.role !== fRole) return false;
    return true;
  });

  // Sort: disabled to bottom always; then by selected column (or name by default)
  filtered.sort(([keyA, a], [keyB, b]) => {
    if (!!a.disabled !== !!b.disabled) return a.disabled ? 1 : -1;
    const col = _adminUserSort.col, dir = _adminUserSort.dir;
    if (col === 'key') {
      // Sort by Gmail address; nomail_ accounts fall back to gmail field or name
      const gmailKey = (k, i) => k.startsWith('nomail_') ? ((i.gmail || i.name || k).toLowerCase()) : k.toLowerCase();
      return dir * gmailKey(keyA, a).localeCompare(gmailKey(keyB, b), 'zh-TW');
    }
    if (col === 'role') {
      const _isAdmin = i => i.isAdmin === true || i.extraRole === '管理者';
      const _hasGmail = k => !k.startsWith('nomail_');
      const rolePri = (k, i) => {
        if (_isAdmin(i)) return _hasGmail(k) ? 0 : 1; // 管理者：有 Gmail 者優先
        const r = i.role;
        if (r === '主任') return 2;
        if (r?.startsWith('專任')) return 3;
        if (r?.startsWith('實習')) return 4;
        if (r?.startsWith('兼任')) return 5;
        if (r) return 6;
        return 9;
      };
      const pa = rolePri(keyA, a), pb = rolePri(keyB, b);
      if (pa !== pb) return dir * (pa - pb);
      return dir * (a.role || '').localeCompare(b.role || '', 'zh-TW');
    }
    let va, vb;
    if (col === 'extra') {
      const xtra = i => (i.isAdmin || i.extraRole === '管理者') ? '管理者' : (i.extraRole || '');
      va = xtra(a); vb = xtra(b);
    } else { va = a.name || ''; vb = b.name || ''; }
    return dir * va.localeCompare(vb, 'zh-TW');
  });

  window._auFilter = (key, val) => { _adminUserFilter[key] = val; renderAdminUsers(); };
  window._auSort = col => {
    if (_adminUserSort.col === col) _adminUserSort.dir *= -1;
    else { _adminUserSort.col = col; _adminUserSort.dir = 1; }
    renderAdminUsers();
  };

  const tabStyle = (active) =>
    `padding:5px 13px;border:none;border-radius:16px;cursor:pointer;font-size:.84rem;font-weight:${active?'600':'400'};background:${active?'#3182ce':'#edf2f7'};color:${active?'#fff':'#4a5568'};transition:all .15s;`;

  const filterBar = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button type="button" onclick="_auFilter('status','all')"      style="${tabStyle(fStatus==='all')}">全部（${totalCount}）</button>
        <button type="button" onclick="_auFilter('status','active')"   style="${tabStyle(fStatus==='active')}">啟用中（${activeCount}）</button>
        <button type="button" onclick="_auFilter('status','disabled')" style="${tabStyle(fStatus==='disabled')}">停用（${disabledCount}）</button>
      </div>
      <select onchange="_auFilter('role',this.value)" style="padding:5px 10px;border:1px solid #cbd5e0;border-radius:16px;font-size:.84rem;cursor:pointer;background:#fff;">
        <option value="">全部職稱</option>
        ${presentRoles.map(r => `<option value="${escHtml(r)}" ${fRole===r?'selected':''}>${escHtml(r)}</option>`).join('')}
      </select>
      ${(fStatus!=='all'||fRole) ? `<button type="button" onclick="_auFilter('status','all');_auFilter('role','')" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;font-size:.82rem;color:#718096;cursor:pointer;">× 清除篩選</button>` : ''}
    </div>`;

  const _hlKey = window._adminHighlightUser || null;
  if (_hlKey) window._adminHighlightUser = null;
  const rows = filtered.map(([key, info]) => {
    const isAdminUser = info.isAdmin === true || info.extraRole === '管理者';
    const _xBadges = [];
    if (isAdminUser) _xBadges.push(`<span class="badge badge-orange">系統管理者</span>`);
    if (info.extraRole && info.extraRole !== '管理者') {
      _xBadges.push(info.extraRole === '個案管理員'
        ? `<span class="badge badge-gray">個案管理員</span><span style="color:#718096;font-size:.8rem;"> (${(info.allowedCases || []).length} 個案)</span>`
        : `<span class="badge badge-gray">${escHtml(info.extraRole)}</span>`);
    }
    if (info.isTransferContact)    _xBadges.push(`<span class="badge badge-teal">轉銜窗口</span>`);
    if (info.isMentalLeaveContact) _xBadges.push(`<span class="badge badge-blue">身心調適假窗口</span>`);
    if (info.isFreshmenTestContact) _xBadges.push(`<span class="badge" style="background:#ede9fe;color:#5b21b6;">新生心理測驗主責</span>`);
    if (info.isPartTimeContact)    _xBadges.push(`<span class="badge" style="background:#cffafe;color:#0e7490;">兼任心理師窗口</span>`);
    if (info.isVolunteerContact)   _xBadges.push(`<span class="badge" style="background:#dcfce7;color:#166534;">義務輔導老師窗口</span>`);
    const adminBadge = _xBadges.length ? _xBadges.join(' ') : '—';
    const isSelf = key === currentUser.email;
    const isNomail = key.startsWith('nomail_');
    const displayKey = isNomail
      ? `<span style="color:#a0aec0;font-size:.82em;">（無 Gmail 帳號）</span>`
      : escHtml(key);
    const disabledBadge = info.disabled ? `<span class="badge" style="background:#fed7d7;color:#c53030;margin-left:4px;">已停用</span>` : '';
    const disableBtn = isSelf ? '' : `<label title="${info.disabled?'啟用帳號':'停用帳號'}" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:.78rem;color:${info.disabled?'#c53030':'#718096'};margin-left:6px;"><input type="checkbox" ${info.disabled?'checked':''} onchange="toggleUserDisabled('${escHtml(key)}',this.checked)" style="cursor:pointer;"> 停用</label>`;
    const isHighlighted = key === _hlKey;
    return `
      <tr style="opacity:${info.disabled?'.55':'1'};${isHighlighted?'background:#fffbeb;outline:2px solid #f6ad55;':''}">
        <td>${displayKey}${isSelf ? ' <span class="badge badge-blue">本帳號</span>' : ''}${disabledBadge}${isHighlighted ? ' <span class="badge badge-orange" style="font-size:.72rem;">新建立</span>' : ''}</td>
        <td>${escHtml(info.name || '—')}</td>
        <td>${escHtml(info.role || '—')}</td>
        <td>${adminBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openUserModal('${escHtml(key)}')">編輯</button>
          ${info.pin ? `<button class="btn btn-warning btn-sm" style="margin-left:6px;" onclick="clearUserPin('${escHtml(key)}')">清除 PIN</button>` : ''}
          ${disableBtn}
          ${isSelf ? '' : `<button class="btn btn-danger btn-sm" style="margin-left:6px;" onclick="deleteUser('${escHtml(key)}')">刪除</button>`}
        </td>
      </tr>`;
  }).join('');

  const emptyRow = filtered.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:20px;color:#a0aec0;font-size:.88rem;">無符合條件的使用者</td></tr>` : '';

  const _sortIcon = col => {
    if (_adminUserSort.col !== col) return `<span style="color:#cbd5e0;font-size:.72rem;margin-left:3px;">⇅</span>`;
    return _adminUserSort.dir === 1
      ? `<span style="color:#3182ce;font-size:.72rem;margin-left:3px;">▲</span>`
      : `<span style="color:#3182ce;font-size:.72rem;margin-left:3px;">▼</span>`;
  };
  const _th = (col, label) =>
    `<th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="_auSort('${col}')">${label}${_sortIcon(col)}</th>`;

  document.getElementById('admin-users-wrap').innerHTML = `
    ${filterBar}
    <table>
      <thead><tr>
        ${_th('key','帳號 / 識別碼')}
        ${_th('name','姓名')}
        ${_th('role','角色')}
        ${_th('extra','附加身分')}
        <th>操作</th>
      </tr></thead>
      <tbody>${rows || emptyRow}</tbody>
    </table>`;
}

function openBulkAddModal() {
  const rolesHint = ROLES.join('、');
  const existingEmails = new Set(Object.keys(configData.users || {}));
  document.body.insertAdjacentHTML('beforeend', `
    <div id="bulk-add-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="background:#fff;border-radius:12px;padding:28px;width:95%;max-width:680px;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:1.1rem;color:#1a202c;">批次新增使用者</h3>
          <button onclick="document.getElementById('bulk-add-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#718096;">&times;</button>
        </div>
        <p style="font-size:.85rem;color:#718096;margin-bottom:6px;">每行一位，格式：<code style="background:#f7fafc;padding:2px 5px;border-radius:3px;">Email, 姓名, 角色, 管理者</code>（管理者欄填「是」或留空）</p>
        <p style="font-size:.82rem;color:#a0aec0;margin-bottom:12px;">可用角色：${rolesHint}</p>
        <textarea id="bulk-csv-input" rows="10" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-family:monospace;font-size:.85rem;resize:vertical;box-sizing:border-box;"
          placeholder="linkinlol528101@gmail.com, 陳錦錫, 專任諮商心理師, 是&#10;m036090006@gmail.com, 黃靖容, 專任社會工作師&#10;bce112214nptu@gmail.com, 王庭葳, 實習諮商心理師"></textarea>
        <div id="bulk-csv-preview" style="margin-top:14px;"></div>
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button class="btn btn-secondary" onclick="previewBulkUsers()">預覽</button>
          <button class="btn btn-primary" id="bulk-save-btn" style="display:none;" onclick="saveBulkUsers()">確認新增</button>
          <button class="btn btn-secondary" onclick="document.getElementById('bulk-add-modal').remove()">取消</button>
        </div>
      </div>
    </div>`);
}

function previewBulkUsers() {
  const raw = document.getElementById('bulk-csv-input').value.trim();
  if (!raw) { document.getElementById('bulk-csv-preview').innerHTML = ''; return; }
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const existingEmails = new Set(Object.keys(configData.users || {}));
  const parsed = [];
  const errors = [];

  lines.forEach((line, i) => {
    const cols = line.split(',').map(c => c.trim());
    const email = cols[0] || '';
    const name  = cols[1] || '';
    const role  = cols[2] || '';
    const isAdmin = /^(是|yes|y|true|1)$/i.test(cols[3] || '');
    if (!email.includes('@')) { errors.push(`第 ${i+1} 行：「${email}」不像 email`); return; }
    if (role && !ROLES.includes(role) && role !== '行政人員' && role !== '其他') {
      errors.push(`第 ${i+1} 行：角色「${role}」不在角色清單中（會照填，請確認）`);
    }
    parsed.push({ email, name, role, isAdmin, isDup: existingEmails.has(email) });
  });

  const errHtml = errors.length
    ? `<div style="padding:8px 12px;background:#fff5f5;border-radius:6px;color:#c53030;font-size:.83rem;margin-bottom:10px;">${errors.map(escHtml).join('<br>')}</div>`
    : '';

  if (!parsed.length) {
    document.getElementById('bulk-csv-preview').innerHTML = errHtml + '<p style="color:#718096;font-size:.88rem;">未解析到有效資料。</p>';
    document.getElementById('bulk-save-btn').style.display = 'none';
    return;
  }

  const rows = parsed.map(u => `
    <tr style="${u.isDup ? 'background:#fff8e1;' : ''}">
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(u.email)}</td>
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(u.name)}</td>
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(u.role)}</td>
      <td style="padding:6px 10px;font-size:.85rem;text-align:center;">${u.isAdmin ? '✅' : '—'}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#d97706;">${u.isDup ? '⚠ 將覆蓋現有' : ''}</td>
    </tr>`).join('');

  document.getElementById('bulk-csv-preview').innerHTML = errHtml + `
    <div style="font-size:.83rem;color:#718096;margin-bottom:6px;">解析結果（共 ${parsed.length} 位）：</div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <thead><tr style="background:#f7fafc;font-size:.8rem;">
        <th style="padding:6px 10px;text-align:left;">Email</th>
        <th style="padding:6px 10px;text-align:left;">姓名</th>
        <th style="padding:6px 10px;text-align:left;">角色</th>
        <th style="padding:6px 10px;">管理者</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.getElementById('bulk-save-btn').style.display = '';
  window._bulkParsed = parsed;
}

async function saveBulkUsers() {
  const parsed = window._bulkParsed;
  if (!parsed?.length) return;
  if (!configData.users) configData.users = {};
  parsed.forEach(u => {
    configData.users[u.email] = {
      ...(configData.users[u.email] || {}),
      name: u.name,
      role: u.role,
      ...(u.isAdmin ? { isAdmin: true } : {}),
    };
    if (!u.isAdmin && configData.users[u.email].isAdmin) delete configData.users[u.email].isAdmin;
  });
  document.getElementById('bulk-add-modal')?.remove();
  renderAdminUsers();
  const _buJobId = bgJobAdd(`批次新增使用者（${parsed.length} 位）`);
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('批次新增使用者', `${parsed.length} 位`);
    bgJobDone(_buJobId);
  } catch(e) { bgJobFail(_buJobId, e.message); alert('儲存失敗：' + e.message); }
}

async function importBulkUsers() {
  const raw = document.getElementById('bulk-users-json')?.value?.trim();
  if (!raw) { alert('請貼上 JSON 資料'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { alert('JSON 格式錯誤：' + e.message); return; }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) { alert('格式應為 { "email": { ... }, ... }'); return; }
  const count = Object.keys(parsed).length;
  if (!count || !confirm(`確定匯入 ${count} 位使用者？`)) return;
  if (!configData.users) configData.users = {};
  Object.assign(configData.users, parsed);
  renderAdminUsers();
  const _biuJobId = bgJobAdd(`批次匯入使用者（${count} 位）`);
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('批次匯入使用者', `${count} 位`);
    bgJobDone(_biuJobId);
  } catch(e) { bgJobFail(_biuJobId, e.message); alert('儲存失敗：' + e.message); }
}

// ══════════════════════════════════════════════
//  使用者 Modal
// ══════════════════════════════════════════════
let _editingEmail = null;
let _modalSuperviseeSelected = new Set(); // supervisee email 集合，儲存時寫回 superviseeEmails

// 依當下勾選的督導/窗口身分決定候選者：
//   實習生督導 → role === '實習諮商心理師'
//   兼任窗口   → role.startsWith('兼任')
function _modalSuperviseeCandidates() {
  const isInternSup = document.getElementById('modal-is-intern-admin-sup')?.checked
                    || document.getElementById('modal-is-intern-pro-sup')?.checked;
  const isPt = document.getElementById('modal-is-pt-contact')?.checked;
  const roles = new Set();
  if (isInternSup) roles.add('實習諮商心理師');
  return Object.entries(configData?.users || {}).filter(([, u]) => {
    if (!u || !u.role) return false;
    if (roles.has(u.role)) return true;
    if (isPt && typeof u.role === 'string' && u.role.startsWith('兼任')) return true;
    return false;
  }).sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'zh'));
}
function _updateModalSuperviseesWrap() {
  const isInternSup = document.getElementById('modal-is-intern-admin-sup')?.checked
                    || document.getElementById('modal-is-intern-pro-sup')?.checked;
  const isPt = document.getElementById('modal-is-pt-contact')?.checked;
  const wrap = document.getElementById('modal-supervisees-wrap');
  const label = document.getElementById('modal-supervisees-label');
  if (!wrap) return;
  if (!isInternSup && !isPt) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  if (label) {
    label.textContent = (isInternSup && isPt) ? '負責的實習生與兼任心理師'
                     : isInternSup ? '負責的實習生'
                     : '負責的兼任心理師';
  }
  _renderModalSuperviseesPicker();
}
function _renderModalSuperviseesPicker() {
  const picker = document.getElementById('modal-supervisees-picker');
  if (!picker) return;
  const cands = _modalSuperviseeCandidates();
  const active   = cands.filter(([, u]) => !u.disabled);
  const disabled = cands.filter(([,  u]) =>  u.disabled);
  if (!cands.length) {
    picker.innerHTML = '<span style="font-size:.82rem;color:#a0aec0;">目前無符合角色的候選人（實習諮商心理師/兼任心理師）。</span>';
    return;
  }
  const row = ([email, u], greyOut) => {
    const checked = _modalSuperviseeSelected.has(email) ? 'checked' : '';
    const name = escHtml(u.name || email);
    const role = escHtml(u.role || '');
    return `<label style="display:flex;align-items:center;gap:12px;padding:4px 8px;cursor:pointer;width:100%;font-size:.85rem;">
      <input type="checkbox" class="mspv-cb" style="flex-shrink:0;width:16px;height:16px;margin:0;padding:0;" data-email="${escHtml(email)}" ${checked} onchange="_onModalSuperviseeToggle(this)">
      <span style="font-weight:bold;color:${greyOut?'#a0aec0':'#1f2937'};white-space:nowrap;">${name}</span>
      <span style="font-size:.875rem;color:${greyOut?'#cbd5e0':'#6b7280'};white-space:nowrap;">${role}</span>
      ${greyOut ? '<span style="margin-left:auto;flex-shrink:0;color:#ef4444;font-size:.75rem;border:1px solid #ef4444;background:#fff5f5;padding:2px 4px;border-radius:4px;white-space:nowrap;font-weight:600;">已停用</span>' : ''}
    </label>`;
  };
  let html = '';
  if (active.length) {
    html += '<div style="font-size:.75rem;font-weight:700;color:#2b6cb0;padding:4px 4px;border-bottom:1px solid #e2e8f0;margin-bottom:4px;">啟用中</div>';
    html += active.map(x => row(x, false)).join('');
  }
  if (disabled.length) {
    html += '<div style="font-size:.75rem;font-weight:700;color:#a0aec0;padding:4px 4px;border-bottom:1px solid #e2e8f0;margin-top:10px;margin-bottom:4px;">已停用</div>';
    html += disabled.map(x => row(x, true)).join('');
  }
  picker.innerHTML = html;
}
window._onModalSuperviseeToggle = function(cb) {
  const email = cb.dataset.email;
  if (!email) return;
  if (cb.checked) _modalSuperviseeSelected.add(email);
  else _modalSuperviseeSelected.delete(email);
};


function openUserModal(key) {
  _editingEmail = key || null;

  const sel = document.getElementById('modal-role');
  sel.innerHTML = '<option value="">— 請選擇 —</option>' +
    ROLES.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');

  const emailEl   = document.getElementById('modal-email');
  const hintEl    = document.getElementById('modal-email-hint');
  if (_editingEmail) {
    const info = configData.users[_editingEmail] || {};
    const isNomail = _editingEmail.startsWith('nomail_');
    document.getElementById('modal-title').textContent = '編輯使用者';
    emailEl.value    = isNomail ? '' : _editingEmail;
    emailEl.disabled = false; // 主任/管理者可更改；使用者本人另有偏好設定入口
    emailEl.placeholder = isNomail ? '可補填 Gmail 帳號' : '';
    hintEl.textContent = isNomail
      ? '補填 Gmail 後將以該帳號作為識別碼，原無 Gmail 識別碼將移除。'
      : '⚠ 更改 Gmail 將同步更新所有個案的主責/初談者/個管指派，並發送通知給全體使用者，記入稽核紀錄，列為重大事件。';
    document.getElementById('modal-name').value     = info.name  || '';
    sel.value = info.role || '';
    document.getElementById('modal-is-admin').checked            = info.isAdmin === true || info.extraRole === '管理者';
    document.getElementById('modal-is-transfer-contact').checked  = info.isTransferContact === true;
    document.getElementById('modal-is-ml-contact').checked        = info.isMentalLeaveContact === true;
    document.getElementById('modal-is-ft-contact').checked        = info.isFreshmenTestContact === true;
    document.getElementById('modal-is-intern-admin-sup').checked  = info.extraRole === '實習生行政督導';
    document.getElementById('modal-is-intern-pro-sup').checked    = info.extraRole === '實習生專業督導';
    document.getElementById('modal-is-pt-contact').checked        = info.isPartTimeContact === true;
    document.getElementById('modal-is-vol-contact').checked       = info.isVolunteerContact === true;
    document.getElementById('modal-intern-from').value = info.internFrom || '';
    document.getElementById('modal-intern-to').value   = info.internTo   || '';
    _modalSuperviseeSelected = new Set(Array.isArray(info.superviseeEmails) ? info.superviseeEmails : []);
    _updateModalSuperviseesWrap();
    _onRoleChange();
  } else {
    document.getElementById('modal-title').textContent = '新增使用者';
    emailEl.value    = '';
    emailEl.disabled = false;
    emailEl.placeholder = '無 Gmail 帳號者可留空';
    hintEl.textContent = '無 Gmail 帳號者可留空，仍可指派為主責或個管。';
    document.getElementById('modal-name').value     = '';
    sel.value = '';
    document.getElementById('modal-is-admin').checked            = false;
    document.getElementById('modal-is-transfer-contact').checked  = false;
    document.getElementById('modal-is-ml-contact').checked        = false;
    document.getElementById('modal-is-ft-contact').checked        = false;
    document.getElementById('modal-is-intern-admin-sup').checked  = false;
    document.getElementById('modal-is-intern-pro-sup').checked    = false;
    document.getElementById('modal-is-pt-contact').checked        = false;
    document.getElementById('modal-is-vol-contact').checked       = false;
    document.getElementById('modal-intern-from').value = '';
    document.getElementById('modal-intern-to').value   = '';
    _modalSuperviseeSelected = new Set();
    _updateModalSuperviseesWrap();
    _onRoleChange();
  }

  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('modal-save-btn').disabled   = false;

  // 帳號安全卡片：僅本地帳密＋TOTP 後端、且為編輯既有有 Gmail 識別碼的使用者（見卡片 HTML 註解）。
  const secCard = document.getElementById('user-edit-security-card');
  if (secCard) {
    const showSec = IS_LOCAL_BACKEND && !!_editingEmail && !_editingEmail.startsWith('nomail_');
    secCard.style.display = showSec ? '' : 'none';
    if (showSec) _uesLoad(_editingEmail);
  }

  showPage('page-user-edit');
}

// 返回使用者清單：取消編輯／新增使用者時的頁面切換（比照全站 cancelXxx() 命名慣例）。
function _backToUserList() {
  showPage('page-admin', document.querySelector('[data-nav-id="page-admin"]'));
  renderAdminUsers();
}

// ══════════════════════════════════════════════
//  帳號安全（使用者編輯頁「帳號安全」卡片，僅本地帳密＋TOTP 後端，見 IS_LOCAL_BACKEND）
//  管理者專屬五個 action：adminUserAuthGet／adminCreateLocalAccount／adminUpdateLocalAccount／
//  adminResetPassword／adminResetTwofa，見 server/src/actions/adminUsers.js 檔頭與逐函式註解。
// ══════════════════════════════════════════════
let _uesState = null; // 最近一次 adminUserAuthGet 的結果快取，供儲存時比對「是否清空收碼信箱」用

// adminXxx 系列共用錯誤代碼 → 中文訊息；twofaMethod 相關兩則要求「錯誤訊息原樣顯示」（見任務規格），
// 其餘代碼仍轉譯成中文，僅未收錄的代碼才原樣顯示 code 本身。
function _uesErrMsg(code) {
  const map = {
    email_required: '缺少目標使用者 email。',
    email_not_in_config: '此使用者尚未存在於使用者名冊，請先於「基本資料」儲存後再建立登入帳號。',
    account_already_exists: '此使用者已有本地登入帳號。',
    login_name_required: '請輸入登入帳號。',
    login_name_taken: '此登入帳號已被使用，請換一個。',
    account_not_found: '找不到本地登入帳號。',
    no_fields_to_update: '未變更任何欄位。',
    otp_emails_required: '請至少輸入 1 個收碼信箱。',
    too_many_otp_emails: '最多只能輸入 3 個信箱。',
    invalid_otp_email: '信箱格式不正確，請確認每個欄位。',
    totp_not_enrolled: '該使用者尚未完成驗證器 App（TOTP）設定，須由本人於「偏好設定」完成綁定後，才能將驗證方式設為 TOTP。',
  };
  return map[code] || code;
}

async function _uesLoad(email) {
  const body = document.getElementById('user-edit-security-body');
  if (!body) return;
  body.textContent = '載入中…';
  try {
    _uesState = await proxyCall('adminUserAuthGet', { email });
  } catch (e) {
    body.innerHTML = `<span style="color:#c53030;">帳號安全狀態載入失敗：${escHtml(e.message)}</span>`;
    return;
  }
  _uesRender(email);
}

function _uesRender(email) {
  const body = document.getElementById('user-edit-security-body');
  if (!body || !_uesState) return;
  if (!_uesState.hasLocalAccount) {
    body.innerHTML = `
      <p style="font-size:.85rem;color:#718096;margin:0 0 10px;">此使用者尚無本地登入帳號（無法用登入帳號＋密碼登入本系統）。填寫登入帳號後可建立，初始密碼固定為 <code>123456789</code>，首次登入將強制要求變更密碼。</p>
      <div class="form-row" style="max-width:360px;">
        <label for="ues-login-name">登入帳號<span class="req">*</span></label>
        <input type="text" id="ues-login-name" class="field-input" placeholder="例如 intern01" autocomplete="off" />
      </div>
      <div class="form-row" style="max-width:360px;">
        <label>收碼信箱（選填，最多 3 個，日後可再補）</label>
        <input type="email" id="ues-otp-email-1" class="field-input" style="margin-bottom:6px;" placeholder="信箱 1（選填）" />
        <input type="email" id="ues-otp-email-2" class="field-input" style="margin-bottom:6px;" placeholder="信箱 2（選填）" />
        <input type="email" id="ues-otp-email-3" class="field-input" placeholder="信箱 3（選填）" />
      </div>
      <div id="user-edit-security-error" class="alert alert-error" style="display:none;max-width:360px;"></div>
      <div style="margin-top:8px;">
        <button class="btn btn-primary btn-sm" onclick="_uesCreateAccount('${escHtml(email)}')">建立登入帳號</button>
      </div>`;
    return;
  }
  const emails = _uesState.otpEmails || [];
  body.innerHTML = `
    <div class="form-row" style="max-width:360px;">
      <label for="ues-login-name">登入帳號</label>
      <input type="text" id="ues-login-name" class="field-input" value="${escHtml(_uesState.loginName || '')}" autocomplete="off" />
    </div>
    <div class="form-row" style="max-width:360px;">
      <label>收碼信箱（最多 3 個）</label>
      <input type="email" id="ues-otp-email-1" class="field-input" style="margin-bottom:6px;" value="${escHtml(emails[0] || '')}" placeholder="信箱 1（選填）" />
      <input type="email" id="ues-otp-email-2" class="field-input" style="margin-bottom:6px;" value="${escHtml(emails[1] || '')}" placeholder="信箱 2（選填）" />
      <input type="email" id="ues-otp-email-3" class="field-input" value="${escHtml(emails[2] || '')}" placeholder="信箱 3（選填）" />
    </div>
    <div class="form-row" style="max-width:360px;">
      <label for="ues-twofa-method">驗證方式</label>
      <select id="ues-twofa-method" class="field-input">
        <option value="">（不變更，目前：${_uesState.twofaMethod === 'totp' ? '驗證器 App（TOTP）' : _uesState.twofaMethod === 'email' ? 'Email 驗證碼' : '尚未設定'}）</option>
        <option value="totp" ${!_uesState.totpEnrolled ? 'disabled' : ''}>驗證器 App（TOTP）${!_uesState.totpEnrolled ? '－尚未由本人完成綁定' : ''}</option>
        <option value="email">Email 驗證碼</option>
      </select>
    </div>
    <div id="user-edit-security-error" class="alert alert-error" style="display:none;max-width:360px;"></div>
    <div style="margin-bottom:14px;">
      <button class="btn btn-primary btn-sm" onclick="_uesSaveAccount('${escHtml(email)}')">儲存帳號安全設定</button>
    </div>
    <div style="padding-top:12px;border-top:1px solid #edf2f7;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-warning btn-sm" onclick="_uesResetPassword('${escHtml(email)}')" data-tip="重設為初始密碼 123456789，並強制該使用者下次登入變更密碼">重設密碼為初始值</button>
      <button class="btn btn-danger btn-sm" onclick="_uesResetTwofa('${escHtml(email)}')" data-tip="清空第二因素設定並撤銷該帳號全部信任裝置，該使用者下次登入需重新設定">重設第二因素</button>
    </div>
    ${_uesState.mustChangePassword ? '<div style="margin-top:10px;font-size:.78rem;color:#dd6b20;">⚠ 此帳號下次登入時將被要求變更密碼（尚未完成過首次改密碼）。</div>' : ''}`;
}

function _uesReadOtpEmails() {
  return ['ues-otp-email-1', 'ues-otp-email-2', 'ues-otp-email-3']
    .map(id => document.getElementById(id)?.value.trim()).filter(Boolean);
}

async function _uesCreateAccount(email) {
  const loginName = document.getElementById('ues-login-name').value.trim();
  const errEl = document.getElementById('user-edit-security-error');
  errEl.style.display = 'none';
  if (!loginName) { errEl.textContent = '請輸入登入帳號。'; errEl.style.display = ''; return; }
  const otpEmails = _uesReadOtpEmails();
  const params = { email, loginName };
  if (otpEmails.length) params.otpEmails = otpEmails;
  try {
    await proxyCall('adminCreateLocalAccount', params);
    showToast('登入帳號已建立。初始密碼 123456789，首次登入須改密碼。', 'success', 4000);
    _uesLoad(email);
  } catch (e) {
    errEl.textContent = _uesErrMsg(e.message);
    errEl.style.display = '';
  }
}

async function _uesSaveAccount(email) {
  const errEl = document.getElementById('user-edit-security-error');
  errEl.style.display = 'none';
  const loginName = document.getElementById('ues-login-name').value.trim();
  if (!loginName) { errEl.textContent = '登入帳號不可清空。'; errEl.style.display = ''; return; }
  const otpEmails = _uesReadOtpEmails();
  const hadEmails = (_uesState?.otpEmails || []).length > 0;
  if (hadEmails && otpEmails.length === 0) {
    errEl.textContent = '請至少保留 1 個收碼信箱（無法清空已設定的收碼信箱）。';
    errEl.style.display = '';
    return;
  }
  const params = { email, loginName };
  if (otpEmails.length) params.otpEmails = otpEmails;
  const method = document.getElementById('ues-twofa-method').value;
  if (method) params.twofaMethod = method;
  try {
    await proxyCall('adminUpdateLocalAccount', params);
    showToast('帳號安全設定已更新。', 'success', 2500);
    _uesLoad(email);
  } catch (e) {
    errEl.textContent = _uesErrMsg(e.message);
    errEl.style.display = '';
  }
}

async function _uesResetPassword(email) {
  if (!confirm(`確定要將此帳號的密碼重設為初始密碼嗎？\n\n重設後密碼固定為 123456789，且該使用者下次登入將被強制要求變更密碼。`)) return;
  try {
    await proxyCall('adminResetPassword', { email });
    showToast('密碼已重設為初始密碼 123456789，該使用者下次登入將被要求變更密碼。', 'success', 4000);
    _uesLoad(email);
  } catch (e) {
    alert('重設密碼失敗：' + _uesErrMsg(e.message));
  }
}

async function _uesResetTwofa(email) {
  if (!confirm(`確定要重設此帳號的第二因素驗證設定嗎？\n\n這會清空其 TOTP／Email 驗證碼設定，並撤銷該帳號全部信任裝置，該使用者下次登入需重新設定第二因素。`)) return;
  try {
    await proxyCall('adminResetTwofa', { email });
    showToast('第二因素已重設，該帳號全部信任裝置已撤銷。', 'success', 4000);
    _uesLoad(email);
  } catch (e) {
    alert('重設第二因素失敗：' + _uesErrMsg(e.message));
  }
}

// ══════════════════════════════════════════════
//  批次建立登入帳號（使用者管理清單頁「批次建立登入帳號」卡片，僅本地帳密＋TOTP 後端，
//  見 IS_LOCAL_BACKEND）：逐一 adminUserAuthGet 掃描出尚未建立本地帳號者，批次
//  adminCreateLocalAccount。掃描／建立皆為循序呼叫（人數規模不需並發，見任務規格）。
// ══════════════════════════════════════════════
let _bcaRows = []; // [{ email, name, scanError?, done? }]；done 供「全部建立」重跑時略過已成功列

async function _bcaScan() {
  const body = document.getElementById('admin-bulk-create-accounts-body');
  if (!body) return;
  // 排除範圍（2026-07-17 使用者定案）：
  //   1. nomail_ 使用者（無 email 識別碼，多為尚未開始上班的兼任）——等實際上班時由管理者
  //      在編輯頁補 email 後再建帳號；
  //   2. 停用（disabled）使用者——視同不存在，日後要用時由管理者先啟用再建帳號。
  // 批次清單＝「啟用中＋已有 email」的急迫建帳對象。
  const entries = Object.entries(configData?.users || {})
    .filter(([key, info]) => !key.startsWith('nomail_') && info?.disabled !== true);
  if (!entries.length) {
    body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">目前沒有可掃描的使用者（啟用中且已有 email 者皆已涵蓋）。</p>';
    return;
  }
  body.innerHTML = `<p style="font-size:.85rem;color:#718096;margin:0;">掃描中… <span id="bca-scan-progress">0 / ${entries.length}</span></p>`;
  const missing = [];
  for (let i = 0; i < entries.length; i += 1) {
    const [email, info] = entries[i];
    try {
      // _silent=true：批次查詢屬背景掃描動作，不逐筆記進偵錯日誌（避免 49 筆刷版）。
      const r = await proxyCall('adminUserAuthGet', { email }, true);
      if (!r.hasLocalAccount) missing.push({ email, name: info?.name || email });
    } catch (e) {
      // 單筆查詢失敗不中斷整批掃描，記為「查詢失敗」列給管理者自行判斷（極少數情況）。
      missing.push({ email, name: info?.name || email, scanError: e.message });
    }
    const progressEl = document.getElementById('bca-scan-progress');
    if (progressEl) progressEl.textContent = `${i + 1} / ${entries.length}`;
  }
  _bcaRows = missing;
  _bcaRenderTable();
}

function _bcaRenderTable() {
  const body = document.getElementById('admin-bulk-create-accounts-body');
  if (!body) return;
  if (!_bcaRows.length) {
    body.innerHTML = '<p style="font-size:.85rem;color:#276749;margin:0;">✓ 所有使用者皆已建立本地登入帳號。</p>';
    return;
  }
  const rows = _bcaRows.map((r, i) => `
    <tr id="bca-row-${i}">
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(r.name)}</td>
      <td style="padding:6px 10px;font-size:.85rem;color:#718096;">${escHtml(r.email)}</td>
      <td style="padding:6px 10px;"><input type="text" id="bca-login-${i}" class="field-input" value="${escHtml(r.email)}" style="width:100%;min-width:160px;" /></td>
      <td style="padding:6px 10px;"><input type="email" id="bca-otpemail-${i}" class="field-input" value="${escHtml(r.email)}" style="width:100%;min-width:160px;" /></td>
      <td id="bca-status-${i}" style="padding:6px 10px;font-size:.82rem;color:${r.scanError ? '#c53030' : '#718096'};">${r.scanError ? `查詢失敗：${escHtml(r.scanError)}` : '尚未建立'}</td>
    </tr>`).join('');
  body.innerHTML = `
    <p style="font-size:.85rem;color:#718096;margin:0 0 10px;">共 ${_bcaRows.length} 位使用者尚未建立本地登入帳號。所有帳號初始密碼皆為 <code>123456789</code>，首次登入將強制修改密碼。可視需要修改「登入帳號」欄（例如改成校內帳號）後再建立。</p>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;min-width:640px;">
      <thead><tr style="background:#f7fafc;font-size:.8rem;">
        <th style="padding:6px 10px;text-align:left;">姓名</th>
        <th style="padding:6px 10px;text-align:left;">Email</th>
        <th style="padding:6px 10px;text-align:left;">登入帳號</th>
        <th style="padding:6px 10px;text-align:left;">收碼信箱</th>
        <th style="padding:6px 10px;text-align:left;">狀態</th>
      </tr></thead>
      <tbody id="bca-table-body">${rows}</tbody>
    </table></div>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="_bcaCreateAll()">全部建立</button>
      <span id="bca-summary" style="font-size:.85rem;color:#718096;"></span>
    </div>`;
}

async function _bcaCreateAll() {
  let success = 0, fail = 0;
  for (let i = 0; i < _bcaRows.length; i += 1) {
    const row = _bcaRows[i];
    if (row.done) { success += 1; continue; } // 已成功者略過，支援部分失敗後重跑「全部建立」
    const statusEl = document.getElementById(`bca-status-${i}`);
    const loginName = document.getElementById(`bca-login-${i}`)?.value.trim();
    const otpEmail = document.getElementById(`bca-otpemail-${i}`)?.value.trim();
    if (!loginName) {
      fail += 1;
      if (statusEl) { statusEl.textContent = '失敗：登入帳號不可空白'; statusEl.style.color = '#c53030'; }
      continue;
    }
    if (statusEl) { statusEl.textContent = '建立中…'; statusEl.style.color = '#718096'; }
    const params = { email: row.email, loginName };
    if (otpEmail) params.otpEmails = [otpEmail];
    try {
      await proxyCall('adminCreateLocalAccount', params, true);
      row.done = true;
      success += 1;
      if (statusEl) { statusEl.textContent = '✓ 已建立'; statusEl.style.color = '#276749'; }
      document.querySelectorAll(`#bca-row-${i} input`).forEach(inp => { inp.disabled = true; });
    } catch (e) {
      fail += 1;
      if (statusEl) { statusEl.textContent = '失敗：' + _uesErrMsg(e.message); statusEl.style.color = '#c53030'; }
    }
  }
  const summaryEl = document.getElementById('bca-summary');
  if (summaryEl) summaryEl.textContent = `已完成：成功 ${success}／失敗 ${fail}`;
  showToast(`批次建立完成：成功 ${success}／失敗 ${fail}`, fail ? 'warn' : 'success', 4500);
}

// ══════════════════════════════════════════════
//  批次修改登入帳號（使用者管理清單頁「批次修改登入帳號」卡片，僅本地帳密＋TOTP 後端，
//  見 IS_LOCAL_BACKEND）：逐一 adminUserAuthGet 掃描出已有本地帳號者，可批次修改「登入帳號」。
//  掃描寫法比照上方「批次建立登入帳號」；套用變更只送「新值≠目前值」的列，用背景工作顯示進度。
// ══════════════════════════════════════════════
let _bcmRows = []; // [{ email, name, loginName }]；僅收 hasLocalAccount=true 者

async function _bcmScan() {
  const body = document.getElementById('admin-bulk-modify-accounts-body');
  if (!body) return;
  const entries = Object.entries(configData?.users || {})
    .filter(([key, info]) => !key.startsWith('nomail_') && info?.disabled !== true);
  if (!entries.length) {
    body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">目前沒有可掃描的使用者。</p>';
    return;
  }
  body.innerHTML = `<p style="font-size:.85rem;color:#718096;margin:0;">掃描中… <span id="bcm-scan-progress">0 / ${entries.length}</span></p>`;
  const rows = [];
  for (let i = 0; i < entries.length; i += 1) {
    const [email, info] = entries[i];
    try {
      // _silent=true：批次查詢屬背景掃描動作，不逐筆記進偵錯日誌（同批次建立帳號的作法）。
      const r = await proxyCall('adminUserAuthGet', { email }, true);
      if (r.hasLocalAccount) rows.push({ email, name: info?.name || email, loginName: r.loginName || email });
    } catch (e) {
      // 單筆查詢失敗不中斷整批掃描，跳過即可（可再次掃描重試）。
    }
    const progressEl = document.getElementById('bcm-scan-progress');
    if (progressEl) progressEl.textContent = `${i + 1} / ${entries.length}`;
  }
  _bcmRows = rows;
  _bcmRenderTable();
}

function _bcmRenderTable() {
  const body = document.getElementById('admin-bulk-modify-accounts-body');
  if (!body) return;
  if (!_bcmRows.length) {
    body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">目前沒有已建立本地登入帳號的使用者。</p>';
    return;
  }
  const rows = _bcmRows.map((r, i) => `
    <tr id="bcm-row-${i}">
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(r.name)}</td>
      <td style="padding:6px 10px;font-size:.85rem;color:#718096;">${escHtml(r.email)}</td>
      <td style="padding:6px 10px;font-size:.85rem;color:#718096;">${escHtml(r.loginName)}</td>
      <td style="padding:6px 10px;"><input type="text" id="bcm-login-${i}" class="field-input" value="${escHtml(r.loginName)}" style="width:100%;min-width:160px;" /></td>
      <td id="bcm-status-${i}" style="padding:6px 10px;font-size:.82rem;color:#718096;"></td>
    </tr>`).join('');
  body.innerHTML = `
    <p style="font-size:.85rem;color:#718096;margin:0 0 10px;">共 ${_bcmRows.length} 位使用者已建立本地登入帳號。修改「新登入帳號」欄後按「套用變更」，只有值有變動的列才會送出。</p>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;min-width:640px;">
      <thead><tr style="background:#f7fafc;font-size:.8rem;">
        <th style="padding:6px 10px;text-align:left;">姓名</th>
        <th style="padding:6px 10px;text-align:left;">內部 Email</th>
        <th style="padding:6px 10px;text-align:left;">目前登入帳號</th>
        <th style="padding:6px 10px;text-align:left;">新登入帳號</th>
        <th style="padding:6px 10px;text-align:left;">狀態</th>
      </tr></thead>
      <tbody id="bcm-table-body">${rows}</tbody>
    </table></div>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="_bcmApplyAll()">套用變更</button>
      <span id="bcm-summary" style="font-size:.85rem;color:#718096;"></span>
    </div>`;
}

async function _bcmApplyAll() {
  const changed = [];
  _bcmRows.forEach((row, i) => {
    const newVal = document.getElementById(`bcm-login-${i}`)?.value.trim();
    if (newVal && newVal !== row.loginName) changed.push({ i, row, loginName: newVal });
  });
  if (!changed.length) { showToast('沒有變更的列，未送出任何請求。', 'error', 2500); return; }
  const jobId = bgJobAdd('批次修改登入帳號', `共 ${changed.length} 筆變更`);
  let success = 0, fail = 0;
  for (let idx = 0; idx < changed.length; idx += 1) {
    const { i, row, loginName } = changed[idx];
    const statusEl = document.getElementById(`bcm-status-${i}`);
    if (statusEl) { statusEl.textContent = '修改中…'; statusEl.style.color = '#718096'; }
    try {
      await proxyCall('adminUpdateLocalAccount', { email: row.email, loginName }, true);
      success += 1;
      row.loginName = loginName;
      if (statusEl) { statusEl.textContent = '✓ 已修改'; statusEl.style.color = '#276749'; }
    } catch (e) {
      fail += 1;
      if (statusEl) { statusEl.textContent = '失敗：' + _uesErrMsg(e.message); statusEl.style.color = '#c53030'; }
    }
    bgJobProgress(jobId, Math.round(((idx + 1) / changed.length) * 100));
  }
  bgJobDone(jobId);
  const summaryEl = document.getElementById('bcm-summary');
  if (summaryEl) summaryEl.textContent = `已完成：成功 ${success}／失敗 ${fail}`;
  showToast(`批次修改完成：成功 ${success}／失敗 ${fail}`, fail ? 'warn' : 'success', 4500);
}

// ══════════════════════════════════════════════
//  登入紀錄（使用者管理「登入紀錄」tab，僅本地帳密＋TOTP 後端，見 IS_LOCAL_BACKEND；v214 從
//  「使用者列表」tab 的卡片獨立成專屬 tab，並加上時間區間／人員篩選與管理端封存）：
//  管理者查核全體使用者登入狀況；adminListAllSessions 一次回傳所有使用者的 session（依時間倒序），
//  篩選（日期區間／人員）皆在前端對已載入的原始清單做，不重打後端；封存改呼叫新 action
//  adminArchiveSessions（可跨帳號指名封存，後端仍會再擋一次 active 紀錄，見 dispatch.js／
//  actions/adminUsers.js 該函式註解）。
// ══════════════════════════════════════════════
let _adminSessionsRaw = [];      // 最近一次 adminListAllSessions 回傳的原始清單（未篩選）
let _adminSessionsLoaded = false; // 是否已載入過一次（供切到本 tab 時只自動載入首次，避免每次切分頁都重打後端）

// tab 切換進入點：非本地後端不顯示此 tab（renderAdminPage 呼叫前已由 _renderAdminTabs 擋過一層，
// 這裡再擋一次防禦性檢查），首次切入才自動載入，之後靠「重新載入」按鈕或篩選列手動刷新。
function renderAdminSessions() {
  if (!IS_LOCAL_BACKEND) return;
  if (!_adminSessionsLoaded) _adminSessionsLoad();
}

function _sessionsFmtTime(iso) {
  try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (_) { return iso || ''; }
}
function _sessionsStatusBadge(s) {
  return s.archived
    ? '<span style="font-size:.72rem;color:#718096;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;">已封存</span>'
    : s.active
      ? '<span style="font-size:.72rem;font-weight:700;color:#2b6cb0;background:#ebf8ff;border:1px solid #bee3f8;border-radius:4px;padding:1px 6px;">使用中</span>'
      : s.revoked
        ? '<span style="font-size:.72rem;color:#822727;background:#fff5f5;border:1px solid #feb2b2;border-radius:4px;padding:1px 6px;">已登出</span>'
        : '<span style="font-size:.72rem;color:#718096;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;">已過期</span>';
}
// 日期區間比對：from 當日 00:00:00 起、to 當日 23:59:59 止，皆以本地時間解讀（同 af-date-from/to
// 稽核紀錄篩選慣例）；未附 from/to 該端不設限，issuedAt 解析失敗則不排除（寧可多顯示不誤篩掉）。
function _adminSessionsInRange(issuedAt, from, to) {
  const t = issuedAt ? new Date(issuedAt).getTime() : NaN;
  if (Number.isNaN(t)) return true;
  if (from) { const f = new Date(from + 'T00:00:00').getTime(); if (!Number.isNaN(f) && t < f) return false; }
  if (to)   { const e = new Date(to   + 'T23:59:59').getTime(); if (!Number.isNaN(e) && t > e) return false; }
  return true;
}
// 篩選用「人員」下拉：精神比照 buildCounselorFilterOpts（啟用者依角色分組在前、停用者灰字最後），
// 但範圍是「這批登入紀錄裡實際出現過的 email」而非全體人員名冊，且需涵蓋非輔導人員角色（如行政）
// 與已不在 config.users 名冊裡的舊帳號（見任務規格）。
function _adminSessionsPersonOptions(list, selectedValue) {
  const emailsInList = new Set((list || []).map(s => s.email));
  const users = configData?.users || {};
  const optOf = (email, info, disabled) => {
    const label = (info?.name || email) + (disabled ? '（已停用）' : '');
    return `<option value="${escHtml(email)}"${selectedValue === email ? ' selected' : ''}${disabled ? ' style="color:gray"' : ''}>${escHtml(label)}</option>`;
  };
  let html = `<option value=""${!selectedValue ? ' selected' : ''}>全部人員</option>`;
  const used = new Set();
  COUNSELOR_ROLE_GROUPS.forEach(group => {
    const entries = Object.entries(users)
      .filter(([email, info]) => emailsInList.has(email) && !info.disabled && group.roles.includes(info.role || ''))
      .sort(([, ia], [, ib]) => (ia.name || '').localeCompare(ib.name || '', 'zh'));
    if (!entries.length) return;
    html += `<optgroup label="${escHtml(group.label)}">`;
    entries.forEach(([email, info]) => { html += optOf(email, info, false); used.add(email); });
    html += '</optgroup>';
  });
  const others = Object.entries(users)
    .filter(([email, info]) => emailsInList.has(email) && !info.disabled && !used.has(email))
    .sort(([, ia], [, ib]) => (ia.name || '').localeCompare(ib.name || '', 'zh'));
  if (others.length) {
    html += `<optgroup label="其他">`;
    others.forEach(([email, info]) => { html += optOf(email, info, false); used.add(email); });
    html += '</optgroup>';
  }
  const disabledUsers = Object.entries(users)
    .filter(([email, info]) => emailsInList.has(email) && info.disabled)
    .sort(([, ia], [, ib]) => (ia.name || '').localeCompare(ib.name || '', 'zh'));
  if (disabledUsers.length) {
    html += `<optgroup label="已停用">`;
    disabledUsers.forEach(([email, info]) => { html += optOf(email, info, true); used.add(email); });
    html += '</optgroup>';
  }
  const unknown = [...emailsInList].filter(email => !users[email]).sort();
  if (unknown.length) {
    html += `<optgroup label="不在名冊中">`;
    unknown.forEach(email => { html += `<option value="${escHtml(email)}"${selectedValue === email ? ' selected' : ''}>${escHtml(email)}</option>`; });
    html += '</optgroup>';
  }
  return html;
}
// 重繪篩選列：重新從 _adminSessionsRaw 算選項，但保留使用者目前已選的篩選值（重新整理/封存後
// 重新載入不應該把篩選條件清空）。
function _adminSessionsRenderFilterBar() {
  const bar = document.getElementById('admin-sessions-filter-bar');
  if (!bar) return;
  const curFrom = document.getElementById('admin-sess-date-from')?.value || '';
  const curTo = document.getElementById('admin-sess-date-to')?.value || '';
  const curPerson = document.getElementById('admin-sess-person')?.value || '';
  bar.innerHTML = `
    <input type="date" id="admin-sess-date-from" class="field-input" style="max-width:150px;padding:5px 8px;font-size:.85rem;" onchange="_adminSessionsApplyFilter()" value="${escHtml(curFrom)}" />
    <span style="font-size:.85rem;color:#718096;">至</span>
    <input type="date" id="admin-sess-date-to" class="field-input" style="max-width:150px;padding:5px 8px;font-size:.85rem;" onchange="_adminSessionsApplyFilter()" value="${escHtml(curTo)}" />
    <select id="admin-sess-person" class="field-select" style="max-width:220px;padding:5px 8px;font-size:.85rem;" onchange="_adminSessionsApplyFilter()">
      ${_adminSessionsPersonOptions(_adminSessionsRaw, curPerson)}
    </select>`;
}
async function _adminSessionsLoad() {
  const body = document.getElementById('admin-sessions-overview-body');
  if (!body) return;
  const includeArchived = document.getElementById('admin-sessions-include-archived')?.checked || false;
  body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">載入中…</p>';
  try {
    const r = await proxyCall('adminListAllSessions', { includeArchived });
    _adminSessionsRaw = (r && r.sessions) || [];
  } catch (e) {
    body.innerHTML = `<p style="font-size:.85rem;color:#c53030;margin:0;">載入失敗：${escHtml(e.message)}</p>`;
    return;
  }
  _adminSessionsLoaded = true;
  _adminSessionsRenderFilterBar();
  _adminSessionsApplyFilter();
}
// 依目前篩選列（日期區間／人員）從 _adminSessionsRaw 重繪表格，不重打後端。
function _adminSessionsApplyFilter() {
  const body = document.getElementById('admin-sessions-overview-body');
  if (!body) return;
  if (!_adminSessionsRaw.length) { body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">目前沒有登入紀錄。</p>'; return; }
  const from = document.getElementById('admin-sess-date-from')?.value || '';
  const to = document.getElementById('admin-sess-date-to')?.value || '';
  const person = document.getElementById('admin-sess-person')?.value || '';
  const list = _adminSessionsRaw.filter(s => _adminSessionsInRange(s.issuedAt, from, to) && (!person || s.email === person));
  if (!list.length) { body.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">沒有符合篩選條件的登入紀錄。</p>'; return; }
  const rows = list.map(s => {
    // 僅非使用中（!active）的紀錄可勾選封存，比照 archiveMySessions/adminArchiveSessions 的安全
    // 原則（active 一律不可封存，即使被指名，見後端該函式註解）；使用中的那格直接顯示 —。
    const checkbox = !s.active
      ? `<input type="checkbox" class="admin-sess-chk" data-email="${escHtml(s.email)}" data-jti="${escHtml(s.jti)}" style="margin:0;">`
      : '<span style="color:#cbd5e0;">—</span>';
    return `
    <tr${s.archived ? ' style="color:#a0aec0;"' : ''}>
      <td style="padding:6px 10px;text-align:center;">${checkbox}</td>
      <td style="padding:6px 10px;font-size:.85rem;">${escHtml(configData?.users?.[s.email]?.name || s.email)}</td>
      <td style="padding:6px 10px;font-size:.82rem;">${escHtml(_sessionUaShort(s.ua))}</td>
      <td style="padding:6px 10px;font-size:.82rem;color:#718096;">${escHtml(s.ip || '（未取得）')}</td>
      <td style="padding:6px 10px;font-size:.82rem;color:#718096;">${escHtml(s.geo || '—')}</td>
      <td style="padding:6px 10px;font-size:.82rem;color:#718096;white-space:nowrap;">${escHtml(_sessionsFmtTime(s.issuedAt))}</td>
      <td style="padding:6px 10px;">${_sessionsStatusBadge(s)}</td>
    </tr>`;
  }).join('');
  const countNote = list.length !== _adminSessionsRaw.length ? `（篩選自 ${_adminSessionsRaw.length} 筆）` : '';
  body.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      ${_ckgToolbarHtml('admin-sess-chk')}
      <button class="btn btn-warning btn-sm" onclick="_adminSessionsArchiveChecked()">封存勾選</button>
    </div>
    <div style="max-height:480px;overflow-y:auto;overflow-x:auto;border:1px solid #e2e8f0;border-radius:6px;">
      <table style="width:100%;border-collapse:collapse;min-width:760px;">
        <thead><tr style="background:#f7fafc;font-size:.8rem;position:sticky;top:0;">
          <th style="padding:6px 10px;text-align:center;">封存</th>
          <th style="padding:6px 10px;text-align:left;">使用者</th>
          <th style="padding:6px 10px;text-align:left;">裝置</th>
          <th style="padding:6px 10px;text-align:left;">IP</th>
          <th style="padding:6px 10px;text-align:left;">位置</th>
          <th style="padding:6px 10px;text-align:left;">登入時間</th>
          <th style="padding:6px 10px;text-align:left;">狀態</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:.8rem;color:#718096;margin:8px 0 0;">共 ${list.length} 筆${countNote}。</p>`;
}
// 封存勾選的登入紀錄（管理端可跨帳號指名，見 adminArchiveSessions）；成功後重新載入（沿用目前篩選）。
async function _adminSessionsArchiveChecked() {
  const boxes = Array.from(document.querySelectorAll('#admin-sessions-overview-body .admin-sess-chk:checked'));
  if (!boxes.length) { showToast('請先勾選要封存的紀錄。', 'error', 2000); return; }
  const items = boxes.map(el => ({ email: el.dataset.email, jti: el.dataset.jti }));
  try {
    const r = await proxyCall('adminArchiveSessions', { items });
    // v218：封存後若目前「含已封存」未勾，重新載入會依 includeArchived=false 把剛封存的紀錄濾掉，
    // 使用者容易誤以為操作沒生效——toast 額外提示如何檢視。
    const includeArchived = document.getElementById('admin-sessions-include-archived')?.checked || false;
    const skippedNote = r.skipped ? `，略過 ${r.skipped} 筆` : '';
    const hintNote = (!includeArchived && (r.archived || 0) > 0) ? '（勾選「含已封存」可檢視）' : '';
    showToast(`已封存 ${r.archived || 0} 筆${hintNote}${skippedNote}。`, 'success', 4000);
    await _adminSessionsLoad();
  } catch (e) {
    alert('封存失敗：' + e.message);
  }
}

// ══════════════════════════════════════════════
//  磁碟健康（使用者管理「磁碟健康」tab，v221；僅本地帳密＋TOTP 後端顯示，見 IS_LOCAL_BACKEND）：
//  資料來源是 root systemd timer 定期收集寫出的 SMART 摘要 JSON（server/scripts/smart-poll.js，
//  唯讀，見 adminGetDiskHealth action），本頁只做展示與人性化格式轉換，不寫入任何資料。
// ══════════════════════════════════════════════
let _adminDiskHealthLoaded = false; // 是否已載入過一次（切到本 tab 首次自動載入，之後靠「重新整理」按鈕）

// tab 切換進入點：非本地後端不顯示此 tab（renderAdminPage 呼叫前已由 _renderAdminTabs 擋過一層，
// 這裡再擋一次防禦性檢查），首次切入才自動載入。
function renderAdminDiskHealth() {
  if (!IS_LOCAL_BACKEND) return;
  if (!_adminDiskHealthLoaded) _adminDiskHealthLoad();
}

// bytes → 人性化 GB/TB（磁碟容量習慣以十進位 1000 為底，非 1024）。
function _dhBytesHuman(n) {
  if (n === null || n === undefined) return '未知';
  const tb = n / 1e12;
  if (tb >= 1) return (tb >= 10 ? tb.toFixed(0) : tb.toFixed(1)) + ' TB';
  const gb = n / 1e9;
  return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
}

// 開機時數 → 換算年數附註。
function _dhHoursHuman(h) {
  if (h === null || h === undefined) return '未知';
  const years = h / 24 / 365;
  return `${Number(h).toLocaleString('zh-TW')} 小時（約 ${years.toFixed(1)} 年）`;
}

function _dhTempStyle(t) {
  if (t === null || t === undefined) return '';
  if (t > 65) return 'color:#c53030;font-weight:700;';
  if (t > 55) return 'color:#dd6b20;font-weight:700;';
  return '';
}

function _dhStatusBadge(passed) {
  if (passed === true) return '<span style="font-size:.78rem;font-weight:700;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;border-radius:4px;padding:2px 8px;">✓ 正常</span>';
  if (passed === false) return '<span style="font-size:.78rem;font-weight:700;color:#c53030;background:#fff5f5;border:1px solid #feb2b2;border-radius:4px;padding:2px 8px;">✕ 異常——請立即備份並更換</span>';
  return '<span style="font-size:.78rem;color:#718096;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 8px;">? 無法判讀</span>';
}

// 關鍵 SMART 屬性：raw 值代表的白話意義（見 server/scripts/smart-poll.js WANTED 對映，
// 前端只挑這 4 項出來特別提醒，其餘 ataAttrs 欄位——如 power_on_hours、temperature——已在
// 卡片其他區塊各自呈現，不重複列在此表）。
const DH_ATTR_LABELS = {
  reallocated_sectors: { label: '重新配置磁區數', hint: '壞軌已被換成備用磁區，數量持續增加代表磁碟正在老化' },
  pending_sectors: { label: '待處理不穩定磁區', hint: '疑似壞軌但尚未確認，持續增加是早期故障警訊' },
  offline_uncorrectable: { label: '離線不可修復磁區', hint: '已確定無法讀取的磁區，該處資料可能已受損' },
  reported_uncorrect: { label: '回報不可修正錯誤', hint: '讀寫時發生無法修正錯誤的累計次數' },
};

// 單顆磁碟是否有異常值得在卡片頂端／整頁警示條提醒（smartPassed 明確為 false，或關鍵屬性 raw>0）。
function _dhDiskHasWarning(disk) {
  if (disk.smartPassed === false) return true;
  const attrs = disk.ataAttrs || {};
  return Object.keys(DH_ATTR_LABELS).some(k => Number(attrs[k]?.raw) > 0);
}

function _dhDiskCard(disk) {
  if (disk.error) {
    return `
    <div style="border:1px solid #feb2b2;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff5f5;">
      <div style="font-weight:600;color:#822727;">${escHtml(disk.device || '（未知裝置）')}</div>
      <div style="font-size:.85rem;color:#822727;margin-top:4px;">讀取此顆磁碟的 SMART 資訊失敗：${escHtml(disk.error)}</div>
    </div>`;
  }
  const hasWarning = _dhDiskHasWarning(disk);
  const type = disk.nvme ? 'NVMe SSD' : (disk.rotationRate === 0 ? 'SSD' : (disk.rotationRate ? `HDD（${disk.rotationRate} RPM）` : '未知類型'));
  const attrs = disk.ataAttrs || {};
  const attrRows = Object.entries(DH_ATTR_LABELS).map(([key, meta]) => {
    const raw = attrs[key] ? attrs[key].raw : null;
    if (raw === null || raw === undefined) return '';
    const bad = Number(raw) > 0;
    return `
      <tr>
        <td style="padding:4px 8px;font-size:.82rem;color:#4a5568;">${escHtml(meta.label)}</td>
        <td style="padding:4px 8px;font-size:.82rem;${bad ? 'color:#dd6b20;font-weight:700;' : ''}">${escHtml(String(raw))}${bad ? ` ⚠️ ${escHtml(meta.hint)}` : ''}</td>
      </tr>`;
  }).join('');
  const nvmeBlock = disk.nvme ? `
    <div style="margin-top:8px;font-size:.82rem;color:#4a5568;">
      NVMe 壽命已用：<b style="${Number(disk.nvme.percentageUsed) >= 80 ? 'color:#c53030;' : (Number(disk.nvme.percentageUsed) >= 50 ? 'color:#dd6b20;' : '')}">${disk.nvme.percentageUsed ?? '未知'}%</b>
      ${disk.nvme.availableSpare !== null && disk.nvme.availableSpare !== undefined ? `，可用備援：${disk.nvme.availableSpare}%` : ''}
      ${disk.nvme.mediaErrors ? `，媒體錯誤：<b style="color:#dd6b20;">${disk.nvme.mediaErrors}</b>` : ''}
    </div>` : '';
  return `
    <div style="border:1px solid ${hasWarning ? '#feb2b2' : '#e2e8f0'};border-radius:8px;padding:16px;margin-bottom:12px;${hasWarning ? 'background:#fffaf9;' : ''}">
      ${hasWarning ? `<div style="font-size:.82rem;font-weight:600;color:#c53030;margin-bottom:8px;">⚠️ 此顆磁碟偵測到異常，建議儘速備份資料並安排更換</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:600;color:#2d3748;">${escHtml(disk.model || disk.device || '（未知型號）')}</div>
          <div style="font-size:.8rem;color:#718096;margin-top:2px;">${escHtml(disk.device || '')}　序號：${escHtml(disk.serial || '未知')}</div>
        </div>
        ${_dhStatusBadge(disk.smartPassed)}
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:.85rem;color:#4a5568;">
        <div>容量：<b>${_dhBytesHuman(disk.capacityBytes)}</b></div>
        <div>類型：<b>${escHtml(type)}</b></div>
        <div>溫度：<b style="${_dhTempStyle(disk.temperatureC)}">${disk.temperatureC ?? '未知'}${disk.temperatureC !== null && disk.temperatureC !== undefined ? '°C' : ''}</b></div>
        <div>開機時數：<b>${_dhHoursHuman(disk.powerOnHours)}</b></div>
      </div>
      ${disk.selfTestStatus ? `<div style="font-size:.8rem;color:#718096;margin-top:6px;">自我檢測：${escHtml(disk.selfTestStatus)}</div>` : ''}
      ${attrRows ? `<table style="width:100%;border-collapse:collapse;margin-top:10px;background:#f7fafc;border-radius:6px;">${attrRows}</table>` : ''}
      ${nvmeBlock}
    </div>`;
}

const DH_ERROR_MSGS = {
  smart_not_configured: '伺服器未設定 SMART 收集（SMART_STATUS_PATH）',
  smart_not_available: '讀不到健康度資料，收集排程可能尚未執行',
};

async function _adminDiskHealthLoad() {
  const wrap = document.getElementById('admin-diskhealth-wrap');
  const updatedEl = document.getElementById('admin-diskhealth-updated');
  if (!wrap) return;
  wrap.innerHTML = '<p style="font-size:.85rem;color:#718096;margin:0;">載入中…</p>';
  if (updatedEl) updatedEl.textContent = '';
  let data;
  try {
    data = await proxyCall('adminGetDiskHealth', {});
  } catch (e) {
    const msg = DH_ERROR_MSGS[e.message] || e.message;
    wrap.innerHTML = `<p style="font-size:.85rem;color:#c53030;margin:0;">載入失敗：${escHtml(msg)}</p>`;
    return;
  }
  _adminDiskHealthLoaded = true;
  const disks = Array.isArray(data.disks) ? data.disks : [];
  if (updatedEl) {
    const genAt = data.generatedAt ? new Date(data.generatedAt) : null;
    if (genAt && !Number.isNaN(genAt.getTime())) {
      const minsAgo = Math.round((Date.now() - genAt.getTime()) / 60000);
      const stale = minsAgo > 90;
      updatedEl.innerHTML = `資料時間：${escHtml(genAt.toLocaleString('zh-TW', { hour12: false }))}（${minsAgo} 分鐘前）` +
        (stale ? `　<span style="color:#c53030;font-weight:700;">資料過舊，收集排程可能停擺</span>` : '');
    } else {
      updatedEl.textContent = '資料時間：未知';
    }
  }
  if (!disks.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">💽</div><p>目前沒有偵測到任何磁碟資料。</p></div>`;
    return;
  }
  const anyWarning = disks.some(_dhDiskHasWarning);
  const banner = anyWarning
    ? `<div style="border:1px solid #feb2b2;background:#fff5f5;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:.88rem;color:#822727;font-weight:600;">⚠️ 偵測到至少一顆磁碟異常，請儘速確認並備份資料。</div>`
    : '';
  wrap.innerHTML = banner + disks.map(_dhDiskCard).join('');
}

async function saveUser() {
  const rawEmail = document.getElementById('modal-email').value.trim().toLowerCase();
  const name     = document.getElementById('modal-name').value.trim();
  const role     = document.getElementById('modal-role').value;
  const isAdmin        = document.getElementById('modal-is-admin').checked;
  const isTC           = document.getElementById('modal-is-transfer-contact').checked;
  const isML           = document.getElementById('modal-is-ml-contact').checked;
  const isFT           = document.getElementById('modal-is-ft-contact').checked;
  const isInternAdminS = document.getElementById('modal-is-intern-admin-sup').checked;
  const isInternProS   = document.getElementById('modal-is-intern-pro-sup').checked;
  const isPtContact    = document.getElementById('modal-is-pt-contact').checked;
  const isVolContact   = document.getElementById('modal-is-vol-contact').checked;
  const supervisees    = (isInternAdminS || isInternProS || isPtContact) ? [..._modalSuperviseeSelected] : [];
  const errEl    = document.getElementById('modal-error');
  errEl.style.display = 'none';

  // Validation
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    errEl.textContent = '電子郵件格式不正確。'; errEl.style.display = ''; return;
  }
  if (!name) { errEl.textContent = '請輸入姓名。'; errEl.style.display = ''; return; }
  if (!role) { errEl.textContent = '請選擇角色。'; errEl.style.display = ''; return; }

  const isNew = !_editingEmail;
  const oldKey = _editingEmail; // null for new users
  const isMigrating = oldKey?.startsWith('nomail_') && !!rawEmail; // nomail_ → Gmail
  // Gmail → Gmail 遷移（新增流程）：跨檔重寫個案 refs、通知全員、稽核重大事件
  const isEmailChange = !isNew && !isMigrating && !oldKey.startsWith('nomail_') && !!rawEmail && rawEmail !== oldKey;
  // Gmail → 清空：從有 Gmail 的帳號改為無 Gmail，遷移至新 nomail_ key 並走與 Gmail 變更相同的全套通知/稽核路徑
  const isEmailRemoval = !isNew && !oldKey.startsWith('nomail_') && !rawEmail;
  const removalNewKey = isEmailRemoval
    ? `nomail_${Date.now()}_${Math.random().toString(36).slice(2,5)}`
    : null;
  const newKey = isMigrating ? rawEmail
               : isEmailChange ? rawEmail
               : isEmailRemoval ? removalNewKey
               : (oldKey || rawEmail || `nomail_${Date.now()}`);

  // Duplicate check for Gmail migration/change
  if ((isMigrating || isEmailChange) && configData.users[newKey]) {
    errEl.textContent = '此 Gmail 帳號已存在，請確認後再試。'; errEl.style.display = ''; return;
  }

  // Gmail → Gmail / Gmail → 清空 走專屬遷移路徑（同一 helper）
  if (isEmailChange || isEmailRemoval) {
    const _internFromV = document.getElementById('modal-intern-from').value;
    const _internToV   = document.getElementById('modal-intern-to').value;
    _backToUserList();
    _migrateUserEmail(oldKey, newKey, {
      name, role,
      isAdmin, isTC, isML, isFT, isInternAdminS, isInternProS,
      internFrom: _internFromV, internTo: _internToV,
    }, { removal: isEmailRemoval });
    return;
  }

  // Snapshot for revert
  const usersBackup = JSON.parse(JSON.stringify(configData.users || {}));

  // Apply locally
  configData.users = configData.users || {};
  const _internFrom = document.getElementById('modal-intern-from').value;
  const _internTo   = document.getElementById('modal-intern-to').value;
  if (isMigrating) {
    const merged = { ...(configData.users[oldKey] || {}), name, role };
    if (isAdmin) merged.isAdmin = true; else delete merged.isAdmin;
    if (isTC)    merged.isTransferContact    = true; else delete merged.isTransferContact;
    if (isML)    merged.isMentalLeaveContact = true; else delete merged.isMentalLeaveContact;
    if (isFT)    merged.isFreshmenTestContact = true; else delete merged.isFreshmenTestContact;
    if (isPtContact) merged.isPartTimeContact = true; else delete merged.isPartTimeContact;
    if (isVolContact) merged.isVolunteerContact = true; else delete merged.isVolunteerContact;
    if (isInternAdminS)    merged.extraRole = '實習生行政督導';
    else if (isInternProS) merged.extraRole = '實習生專業督導';
    else if (!isAdmin)     delete merged.extraRole;
    if (role === '實習諮商心理師') {
      if (_internFrom) merged.internFrom = _internFrom; else delete merged.internFrom;
      if (_internTo)   merged.internTo   = _internTo;   else delete merged.internTo;
    } else { delete merged.internFrom; delete merged.internTo; }
    if (supervisees.length) merged.superviseeEmails = supervisees; else delete merged.superviseeEmails;
    configData.users[newKey] = merged;
    delete configData.users[oldKey];
  } else {
    const entry = configData.users[newKey] || {};
    entry.name = name; entry.role = role;
    if (isAdmin) entry.isAdmin = true; else delete entry.isAdmin;
    if (isTC)    entry.isTransferContact    = true; else delete entry.isTransferContact;
    if (isML)    entry.isMentalLeaveContact = true; else delete entry.isMentalLeaveContact;
    if (isFT)    entry.isFreshmenTestContact = true; else delete entry.isFreshmenTestContact;
    if (isPtContact) entry.isPartTimeContact = true; else delete entry.isPartTimeContact;
    if (isVolContact) entry.isVolunteerContact = true; else delete entry.isVolunteerContact;
    if (isInternAdminS)       entry.extraRole = '實習生行政督導';
    else if (isInternProS)    entry.extraRole = '實習生專業督導';
    else if (!isAdmin)        delete entry.extraRole;
    if (role === '實習諮商心理師') {
      if (_internFrom) entry.internFrom = _internFrom; else delete entry.internFrom;
      if (_internTo)   entry.internTo   = _internTo;   else delete entry.internTo;
    } else { delete entry.internFrom; delete entry.internTo; }
    if (supervisees.length) entry.superviseeEmails = supervisees; else delete entry.superviseeEmails;
    configData.users[newKey] = entry;
  }
  _invalidateAutoMgrCache();

  // Close edit page and update UI immediately
  _backToUserList();

  const displayLabel = newKey.startsWith('nomail_') ? `${name}（無 Gmail）` : newKey;
  const action = isNew ? '新增使用者' : '編輯使用者';
  const jobId = bgJobAdd(`${action}「${name}」`);

  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog(action, null, null, displayLabel + (isMigrating ? `（${oldKey} → ${newKey}）` : ''));
    bgJobDone(jobId);
    setAlert('admin-alert', 'success', `使用者 ${escHtml(displayLabel)} 已儲存。`);
    // 增量：專任/主任/管理者且尚未同步過 → 背景授與 GC writer 權限
    if (!newKey.startsWith('nomail_')) _gcAclAutoSyncOne(newKey).catch(() => {});
  } catch (err) {
    bgJobFail(jobId, err.message);
    setAlert('admin-alert', 'error', '儲存失敗：' + err.message);
    configData.users = usersBackup; // revert
    renderAdminUsers();
  }
}

// Gmail → Gmail 遷移 或 Gmail → 清空（→ nomail_）：跨檔重寫個案 refs、通知全員、稽核重大事件
// 呼叫者：admin 從編輯 modal（saveUser 分派）或使用者本人從偏好設定
async function _migrateUserEmail(oldEmail, newEmail, entryPatches = {}, opts = {}) {
  const isSelf     = oldEmail === currentUser?.email;
  const isPriv     = currentRole === '主任' || extraRole === '管理者';
  const isRemoval  = !!opts.removal; // Gmail → nomail_（清空 email）
  if (!isSelf && !isPriv) { alert('只有主任、管理者或本人才能變更 Gmail 帳號。'); return; }
  if (!oldEmail || !newEmail || oldEmail === newEmail) return;
  if (!configData.users[oldEmail]) { alert('找不到原帳號。'); return; }
  if (!isRemoval && configData.users[newEmail]) { alert('目標 Gmail 帳號已存在於系統，無法遷移。'); return; }

  const oldName = configData.users[oldEmail]?.name || oldEmail;
  const actionVerb = isRemoval ? '清空' : '更改';
  const targetLabel = isRemoval ? '（無 Gmail 帳號）' : newEmail;
  const confirmMsg =
    `即將把「${oldName}」的 Gmail 由\n  ${oldEmail}\n${actionVerb}為\n  ${targetLabel}\n\n此操作將：\n` +
    `1. 遷移該帳號所有系統設定（角色、附加身分、allowedCases 等）\n` +
    `2. 重寫所有相關個案的主責 / 初談者 / interviewerEmails\n` +
    `3. 發送通知給全體使用者\n` +
    `4. 記入稽核紀錄，列為重大事件` +
    (isSelf ? `\n5. 完成後系統會自動登出${isRemoval ? '（本帳號已無 Gmail，將無法自行登入，需由管理者補填後才能再次使用）' : '，請以新 Gmail 重新登入'}` : '') +
    `\n\n確定要繼續嗎？`;
  if (!confirm(confirmMsg)) return;

  const jobId = bgJobAdd(`Gmail ${actionVerb}：${oldEmail} → ${targetLabel}`);
  const usersBackup = JSON.parse(JSON.stringify(configData.users || {}));

  try {
    // 1. 遷移 users key + patch 屬性 + 紀錄舊 email 供未來查詢
    const oldEntry = configData.users[oldEmail] || {};
    const merged = { ...oldEntry };
    Object.keys(entryPatches || {}).forEach(k => {
      const v = entryPatches[k];
      if (k === 'name' || k === 'role') { if (v) merged[k] = v; return; }
      if (k === 'isAdmin')       { if (v) merged.isAdmin = true; else delete merged.isAdmin; return; }
      if (k === 'isTC')          { if (v) merged.isTransferContact = true; else delete merged.isTransferContact; return; }
      if (k === 'isML')          { if (v) merged.isMentalLeaveContact = true; else delete merged.isMentalLeaveContact; return; }
      if (k === 'isFT')          { if (v) merged.isFreshmenTestContact = true; else delete merged.isFreshmenTestContact; return; }
      if (k === 'isInternAdminS'){ if (v) merged.extraRole = '實習生行政督導'; return; }
      if (k === 'isInternProS')  { if (v) merged.extraRole = '實習生專業督導'; return; }
      if (k === 'internFrom')    { if (v) merged.internFrom = v; else delete merged.internFrom; return; }
      if (k === 'internTo')      { if (v) merged.internTo   = v; else delete merged.internTo; return; }
    });
    if (!Array.isArray(merged.previousEmails)) merged.previousEmails = [];
    merged.previousEmails.push({ email: oldEmail, changedAt: new Date().toISOString(), by: currentUser?.email || '' });
    configData.users[newEmail] = merged;
    delete configData.users[oldEmail];
    bgJobProgress(jobId, 20);

    // 2. 重寫 casesData（counselorEmail / initialInterview / interviewerEmails / basicInfoSnapshots）
    const affectedIds = new Set();
    (casesData || []).forEach(c => {
      let changed = false;
      if (c.counselorEmail === oldEmail) { c.counselorEmail = newEmail; changed = true; }
      Object.values(c.basicInfoSnapshots || {}).forEach(snap => {
        if (snap && snap.counselorEmail === oldEmail) { snap.counselorEmail = newEmail; changed = true; }
      });
      if (c.initialInterview?.interviewerEmail === oldEmail) { c.initialInterview.interviewerEmail = newEmail; changed = true; }
      if (c.initialInterviews) {
        Object.values(c.initialInterviews).forEach(ii => {
          if (ii && ii.interviewerEmail === oldEmail) { ii.interviewerEmail = newEmail; changed = true; }
        });
      }
      if (Array.isArray(c.interviewerEmails) && c.interviewerEmails.includes(oldEmail)) {
        c.interviewerEmails = c.interviewerEmails.map(e => e === oldEmail ? newEmail : e);
        changed = true;
      }
      if (changed) affectedIds.add(c.id);
    });
    bgJobProgress(jobId, 40);

    // 3. 全員通知（露出舊 email + 操作者身分便於對接；7 天後自動移除；操作者本人也塞一份作留痕確認）
    const _actorEmail = currentUser?.email || '';
    const _actorName  = configData.users[_actorEmail]?.name || currentUser?.name || _actorEmail || '未知操作者';
    const _actorTag   = _actorName && _actorEmail && _actorName !== _actorEmail
                          ? `（由 ${_actorName}／${_actorEmail} 執行）`
                          : `（由 ${_actorName || _actorEmail || '未知操作者'} 執行）`;
    const gmailNoticeMsg = isRemoval
      ? `使用者 ${merged.name || newEmail} 的 Gmail 已由 ${oldEmail} 清空（改為無 Gmail 帳號）${_actorTag}`
      : `使用者 ${merged.name || newEmail} 的 Gmail 已由 ${oldEmail} 更改為 ${newEmail}${_actorTag}`;
    const nowIso = new Date().toISOString();
    Object.keys(configData.users).forEach(email => {
      _queueNotifPush(email, {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        type: 'gmail_changed',
        message: gmailNoticeMsg,
        actorEmail: _actorEmail,
        actorName:  _actorName,
        createdAt: nowIso,
        read: false,
      });
    });
    bgJobProgress(jobId, 55);

    // 4. 儲存 configData（使用者 key 遷移）＋ notifications.json（廣播通知，v154 已拆出獨立檔）
    // 非管理者遷移「本人」帳號（!isPriv && isSelf，本函式頂端已限定只有這種組合才會走到這裡而非
    // 提前 alert 退出）：改走 configCasesPatch 的 selfRename op（後端鎖內把呼叫者本人條目原樣搬到
    // toEmail，不接受 params 內容、防止夾帶提權；previousEmails 由後端依伺服器端已知的呼叫者身分
    // 自動附加，稽核追蹤功能不因改走此通道而遺失）。管理者觸發（isPriv，含管理者遷移他人帳號的
    // 情境——selfRename 語意上只能搬「呼叫者本人」條目，無法涵蓋）維持整檔寫入，管理者不受
    // v164 非管理者整檔寫入 deny 影響。
    if (!isPriv && isSelf) {
      await Promise.all([_configCasesPatch([{ type: 'selfRename', toEmail: newEmail }]), _flushNotifOps()]);
    } else {
      await Promise.all([driveUpdateJsonFile(CONFIG_FILE, configData), _flushNotifOps()]);
    }
    bgJobProgress(jobId, 70);

    // 5. 儲存受影響的個案 chunks（無則跳過）
    if (affectedIds.size) {
      await saveCasesChunks(...affectedIds, (done, total) =>
        bgJobProgress(jobId, 70 + Math.round(25 * done / total))
      );
    }

    // 6. 稽核日誌（重大事件）
    auditLog(isRemoval ? '清空使用者 Gmail' : '更改使用者 Gmail', null, null,
      `${oldName}：${oldEmail} → ${isRemoval ? '（無 Gmail 帳號）' : newEmail}（更新 ${affectedIds.size} 筆個案）`,
      { major: true });

    bgJobDone(jobId);
    setAlert?.('admin-alert', 'success',
      isRemoval
        ? `Gmail 已由 ${escHtml(oldEmail)} 清空（更新 ${affectedIds.size} 筆個案；已通知全體 ${Object.keys(configData.users).length} 位使用者，含您本人；由 ${escHtml(_actorName)} 執行）。`
        : `Gmail 已由 ${escHtml(oldEmail)} 遷移至 ${escHtml(newEmail)}（更新 ${affectedIds.size} 筆個案；已通知全體 ${Object.keys(configData.users).length} 位使用者，含您本人；由 ${escHtml(_actorName)} 執行）。`);
    renderAdminUsers?.();
    if (typeof renderCases === 'function') renderCases();
    renderNotifBell?.();

    // 7. 自己遷移 → 強制登出（session 綁在舊 Gmail）
    if (isSelf) {
      alert(isRemoval
        ? '您的 Gmail 已清空。系統將登出，由於本帳號已無 Gmail，將無法再自行登入，需由管理者補填後才能再次使用。'
        : '您的 Gmail 已成功更改。系統將登出，請以新 Gmail 帳號重新登入。');
      if (typeof signOut === 'function') signOut();
    }
  } catch (err) {
    console.error('Gmail migration failed:', err);
    configData.users = usersBackup;
    bgJobFail(jobId, err.message || String(err));
    alert('Gmail 遷移失敗：' + (err.message || err) +
      '\n\n記憶體已回復到操作前狀態。請重新整理頁面並再次確認。');
  }
}

async function deleteUser(key) {
  const info = configData.users?.[key] || {};
  const label = key.startsWith('nomail_') ? (info.name || key) : key;
  if (!confirm(`確定要刪除使用者「${label}」嗎？此操作無法復原。`)) return;

  showLoading('刪除使用者…');
  const jobId = bgJobAdd(`刪除使用者：${label}`);
  try {
    delete configData.users[key];
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    bgJobDone(jobId);
    auditLog('刪除使用者', null, null, label);
    hideLoading();
    setAlert('admin-alert', 'info', `使用者 ${escHtml(label)} 已刪除。`);
    renderAdminUsers();
  } catch (err) {
    bgJobFail(jobId, err.message);
    hideLoading();
    setAlert('admin-alert', 'error', '刪除失敗：' + err.message);
  }
}

async function toggleUserDisabled(key, disabled) {
  if (!configData.users?.[key]) return;
  const name = configData.users[key].name || key;
  // Apply locally first so UI reflects immediately
  if (disabled) configData.users[key].disabled = true;
  else delete configData.users[key].disabled;
  renderAdminUsers();
  const jobId = bgJobAdd(disabled ? `停用「${name}」` : `啟用「${name}」`);
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog(disabled ? '停用使用者' : '啟用使用者', null, null, name);
    bgJobDone(jobId);
    setAlert('admin-alert', 'success', disabled ? `已停用「${escHtml(name)}」` : `已啟用「${escHtml(name)}」`);
  } catch (err) {
    bgJobFail(jobId, err.message);
    setAlert('admin-alert', 'error', '儲存失敗：' + err.message);
    // Revert local state on failure
    if (disabled) delete configData.users[key].disabled;
    else configData.users[key].disabled = true;
    renderAdminUsers();
  }
}

async function clearUserPin(key) {
  if (!configData.users?.[key]) return;
  const name = configData.users[key].name || key;
  if (!confirm(`確定要清除「${name}」的 PIN 碼嗎？\n該使用者下次登入時需重新設定 PIN 碼。`)) return;
  delete configData.users[key].pin;
  delete configData.users[key].pinSkipped;
  renderAdminUsers();
  const jobId = bgJobAdd(`清除「${name}」的 PIN 碼`);
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('清除使用者 PIN 碼', null, null, name);
    bgJobDone(jobId);
    setAlert('admin-alert', 'success', `已清除「${escHtml(name)}」的 PIN 碼`);
  } catch (err) {
    bgJobFail(jobId, err.message);
    setAlert('admin-alert', 'error', '儲存失敗：' + err.message);
    renderAdminUsers();
  }
}

