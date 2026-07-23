// dev/pin-lock.js — PIN 鎖定系統（拆 index.html 絞殺者第二十九刀，v276）。
// 內容為從 index.html 逐字搬出的連續區段（PIN 設定/解鎖/閒置偵測、偏好設定頁尾段
// 與頭像編輯 canvas 拖曳等歷史累積內容）。
// 載入期副作用（column-0 複核）：window resize 監聽（各 resize handler 獨立、順序無關）
// 與一個 IIFE——內部僅宣告區域變數並掛 DOMContentLoaded 監聽（頭像 canvas 拖曳），
// 本檔仍為 body 內同步 script，必在 DOMContentLoaded 前執行，前移無行為差異。
// 可安全前移到主 inline script 之前載入（刀法①）。
// ══════════════════════════════════════════════
//  PIN 鎖定系統
// ══════════════════════════════════════════════
let _afkTimer = null;
let _isLocked = false;

const pinKey     = () => `scc_pin_${currentUser?.email || ''}`;
const pinTmoKey  = () => `scc_pin_tmo_${currentUser?.email || ''}`;

function getAfkMinutes() {
  return parseInt(localStorage.getItem(pinTmoKey()) ?? '10');
}

function resetAfkTimer() {
  if (_isLocked) return;
  clearTimeout(_afkTimer);
  const stored = localStorage.getItem(pinKey());
  const mins   = getAfkMinutes();
  if (stored && stored.length > 0 && mins > 0) {
    _afkTimer = setTimeout(lockScreen, mins * 60 * 1000);
  }
}

function lockScreen(manual = false) {
  const stored = localStorage.getItem(pinKey());
  if (!stored || stored.length === 0) {
    if (manual) alert('尚未設定 PIN 碼，請先至「偏好設定」設定 PIN 碼後再使用鎖定功能。');
    return;
  }
  _isLocked = true;
  clearTimeout(_afkTimer);
  document.getElementById('lock-overlay').style.display = 'flex';
  const disp = document.getElementById('lock-user-display');
  // v218：鎖定畫面顯示「姓名＋職稱」而非帳號名稱。姓名取 configData.users[email].name（中文姓名，
  // 比 Google payload.name 可靠），職稱取 configData.users[email].role（config.json 既有欄位，
  // Header／Sidebar 顯示職稱亦沿用同一欄位，見 resolveUserRole）。configData 理論上此時已載入
  // （lockScreen 僅可能由登入後的 header 鎖定鈕／AFK 逾時／偏好設定頁觸發，皆在 checkPinSetup 之後），
  // 但仍保留 fallback 鏈以防萬一：姓名＋職稱 → 只有姓名 → email → 空字串。
  if (disp) {
    const _u = configData?.users?.[currentUser?.email];
    const _name = _u?.name || currentUser?.name || currentUser?.email || '';
    const _role = _u?.role || '';
    const _label = _name ? (_role ? `${_name} ${_role}` : _name) : '';
    disp.textContent = _label ? `${_label}，請輸入 PIN 碼解鎖。` : '請輸入 PIN 碼解鎖。';
  }
  const inp = document.getElementById('lock-pin-input');
  if (inp) { inp.value = ''; inp.focus(); }
  document.getElementById('lock-pin-error').style.display = 'none';
}

function tryUnlockSilent() {
  const inp    = document.getElementById('lock-pin-input');
  const stored = localStorage.getItem(pinKey());
  if (inp.value === stored) {
    _isLocked = false;
    document.getElementById('lock-overlay').style.display = 'none';
    inp.value = '';
    resetAfkTimer();
  }
}
function tryUnlock() {
  const inp    = document.getElementById('lock-pin-input');
  const stored = localStorage.getItem(pinKey());
  if (inp.value === stored) {
    _isLocked = false;
    document.getElementById('lock-overlay').style.display = 'none';
    inp.value = '';
    resetAfkTimer();
  } else {
    document.getElementById('lock-pin-error').style.display = '';
    inp.value = '';
    inp.focus();
  }
}

// 登入後：若已設定 PIN（不論是否為空字串）僅啟動 AFK timer；
// 若從未設定過則同步沿用使用者偏好（configData.users[email].pin），
// 否則不再強迫顯示首次設定 Modal — 使用者可至偏好設定自行設定。
function checkPinSetup() {
  _isLocked = false;
  const lockEl = document.getElementById('lock-overlay');
  if (lockEl) lockEl.style.display = 'none';
  const setupEl = document.getElementById('pin-setup-modal');
  if (setupEl) setupEl.style.display = 'none';

  let stored = localStorage.getItem(pinKey());
  let pinSkipped = false;
  // 跨裝置同步：從 Drive user profile 回填 PIN 與 pinTmo 到 localStorage
  if (configData?.users?.[currentUser?.email]) {
    const u = configData.users[currentUser.email];
    if (u.pin !== undefined) {
      try { localStorage.setItem(pinKey(), u.pin); } catch (_) {}
      if (u.pinTmo !== undefined) { try { localStorage.setItem(pinTmoKey(), String(u.pinTmo)); } catch (_) {} }
      stored = u.pin;
    }
    if (u.pinSkipped === true) pinSkipped = true;
  }
  const hasPinNow = !!(stored && stored.length > 0);
  const lockBtn = document.getElementById('header-lock-btn');
  if (lockBtn) lockBtn.style.display = hasPinNow ? 'flex' : 'none';

  if (hasPinNow) {
    lockScreen(); // 有 PIN → 登入即鎖定，要求驗證
  } else if (pinSkipped) {
    resetAfkTimer(); // 使用者明確選擇不使用 PIN
  } else {
    // 尚未設定 PIN 也未選擇略過 → 顯示設定 modal
    if (setupEl) setupEl.style.display = 'flex';
  }
}

function _onPinSetupSkipChange(cb) {
  const pinEl = document.getElementById('pin-setup-value');
  pinEl.disabled = cb.checked;
  if (cb.checked) pinEl.value = '';
}

function savePinSetup() {
  const pinVal   = document.getElementById('pin-setup-value').value.trim();
  const skipPIN  = document.getElementById('pin-setup-skip').checked;
  const tmoSel   = document.getElementById('pin-setup-timeout').value;
  const tmoMins  = tmoSel === 'custom'
    ? (parseInt(document.getElementById('pin-setup-custom').value) || 10)
    : parseInt(tmoSel);
  const errEl = document.getElementById('pin-setup-error');

  if (!skipPIN && !pinVal) {
    errEl.textContent = '請輸入 PIN 碼，或勾選「我不需要 PIN 碼」。';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';

  const finalPin = skipPIN ? '' : pinVal;
  localStorage.setItem(pinKey(),    finalPin);
  localStorage.setItem(pinTmoKey(), String(tmoMins));
  syncUserPref_({ pin: finalPin, pinTmo: tmoMins, pinSkipped: skipPIN });
  document.getElementById('pin-setup-modal').style.display = 'none';
  if (!skipPIN) lockScreen(); // 設完 PIN 立即鎖定，驗證是否正確
  else resetAfkTimer();
}

// 將 PIN 同步寫入使用者 Drive profile，跨瀏覽器登入時可自動沿用
async function syncPinToConfig(pinVal, tmoMins) {
  try {
    if (!configData || !currentUser?.email) return;
    // 安全性：只更新已授權帳號，禁止建立新條目
    if (!configData.users?.[currentUser.email]) return;
    const updates = { pin: pinVal };
    if (tmoMins !== undefined && tmoMins !== null) updates.pinTmo = tmoMins;
    configData.users[currentUser.email].pin = pinVal;
    if (tmoMins !== undefined && tmoMins !== null) configData.users[currentUser.email].pinTmo = tmoMins;
    await _configSelfPatch(updates);
  } catch (e) { console.warn('syncPinToConfig failed', e); }
}

function toggleSetupCustom(sel) {
  document.getElementById('pin-setup-custom').style.display = sel.value === 'custom' ? '' : 'none';
}

// ── 版本更新紀錄 ────────────────────────────
function _clToggle(id) {
  const ul = document.getElementById(id);
  const chev = document.getElementById(id + '-chev');
  if (!ul) return;
  const open = ul.style.display !== 'none';
  ul.style.display = open ? 'none' : '';
  if (chev) chev.textContent = open ? '▶' : '▼';
}
function _clSetTab(tab) {
  ['prod','dev'].forEach(t => {
    const btn = document.getElementById('cltab-' + t);
    const content = document.getElementById('cl-content-' + t);
    if (btn) btn.classList.toggle('ntab-active', t === tab);
    if (content) content.style.display = t === tab ? '' : 'none';
  });
}
function renderChangelogPage() {
  const el = document.getElementById('changelog-body');
  if (!el) return;
  const tag = (type, text) => {
    const colors = { '新功能': '#2b6cb0,#ebf8ff,#bee3f8', '改善': '#276749,#f0fff4,#9ae6b4', '修復': '#c05621,#fffaf0,#fbd38d' };
    const [c, bg, brd] = (colors[type] || '#718096,#f7fafc,#e2e8f0').split(',');
    return `<span style="font-size:.72rem;font-weight:700;color:${c};background:${bg};border:1px solid ${brd};border-radius:4px;padding:1px 6px;margin-right:4px;white-space:nowrap;">${text}</span>`;
  };
  const item = (type, text) => `<li style="margin:5px 0;line-height:1.6;">${tag(type, type)}${escHtml(text)}</li>`;
  const mkSection = (prefix) => {
    let idx = 0;
    return (date, v, title, isProd, items) => {
      const id = `cl-${prefix}-${++idx}`;
      const borderColor = isProd ? '#276749' : '#3182ce';
      const prodBadge = isProd
        ? '<span style="font-size:.72rem;font-weight:700;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;border-radius:4px;padding:1px 7px;flex-shrink:0;">✓ 正式版</span>'
        : '<span style="font-size:.72rem;font-weight:700;color:#3182ce;background:#ebf8ff;border:1px solid #bee3f8;border-radius:4px;padding:1px 7px;flex-shrink:0;">dev</span>';
      const vBadge = v ? `<span style="font-size:.72rem;font-weight:700;color:#805ad5;background:#faf5ff;border:1px solid #d6bcfa;border-radius:4px;padding:1px 7px;flex-shrink:0;">v${v}</span>` : '';
      return `<div style="margin-bottom:10px;border-left:3px solid ${borderColor};padding-left:16px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;user-select:none;padding:5px 0;" onclick="_clToggle('${id}')">
          <span style="font-size:.78rem;font-weight:700;color:#718096;flex-shrink:0;">${escHtml(date)}</span>
          ${vBadge}
          ${prodBadge}
          <strong style="font-size:.93rem;flex:1;">${escHtml(title)}</strong>
          <span id="${id}-chev" style="font-size:.78rem;color:#a0aec0;flex-shrink:0;">▶</span>
        </div>
        <ul id="${id}" style="display:none;margin:4px 0 8px 0;padding-left:18px;color:#2d3748;font-size:.875rem;">${items.join('')}</ul>
      </div>`;
    };
  };

  // v243：版本條目資料拆到 changelog.js（拆 index.html 絞殺者第一刀），此處只負責渲染。
  const allEntries = (window.CHANGELOG_ENTRIES || []).map(e => ({ ...e, items: e.items.map(p => item(p[0], p[1])) }));

  const renderList = (prefix, entries) => {
    const sec = mkSection(prefix);
    return entries.map(e => sec(e.date, e.v, e.title, e.isProd, e.items)).join('');
  };
  const prodEntries = allEntries.filter(e => e.isProd);

  el.innerHTML = `
  <div style="max-width:800px;">
    <div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:.86rem;color:#4a5568;">
      系統由國立屏東科技大學學生諮商中心開發，採純前端架構（Google Drive 後端）。<br>
      <span style="color:#718096;">GitHub：</span><a href="https://github.com/npustscc/scc-infosys" target="_blank" style="color:#2b6cb0;">npustscc/scc-infosys</a>
      <span style="margin-left:12px;color:#718096;">正式版網址：</span><a href="https://npustscc.github.io/scc-infosys/" target="_blank" style="color:#2b6cb0;">npustscc.github.io/scc-infosys</a>
    </div>
    ${allEntries.length === 0 ? '<div style="color:#a0aec0;font-size:.85rem;margin-bottom:12px;">（更新紀錄載入失敗，請重新整理）</div>' : ''}
    <div style="border-bottom:1px solid #e2e8f0;margin-bottom:16px;display:flex;">
      <button id="cltab-prod" class="ntab ntab-active" style="flex:none;padding:8px 20px;" onclick="_clSetTab('prod')">正式版</button>
      <button id="cltab-dev"  class="ntab"             style="flex:none;padding:8px 20px;" onclick="_clSetTab('dev')">dev 版</button>
    </div>
    <div id="cl-content-prod">${renderList('prod', prodEntries)}</div>
    <div id="cl-content-dev" style="display:none;">${renderList('dev', allEntries)}</div>
  </div>`;
}

// ── 偏好設定頁面 ────────────────────────────
function _onPrefPinSkipChange(cb) {
  const pinEl = document.getElementById('pref-pin');
  const pinConfEl = document.getElementById('pref-pin-confirm');
  pinEl.disabled = cb.checked;
  pinConfEl.disabled = cb.checked;
  const grayStyle = cb.checked ? '#e2e8f0' : '';
  pinEl.style.background = grayStyle; pinConfEl.style.background = grayStyle;
  if (cb.checked) { pinEl.value = ''; pinConfEl.value = ''; }
}

function renderPrefsPage() {
  const stored     = localStorage.getItem(pinKey());
  const tmo        = String(_userPref_('pinTmo', 10));
  const hasPIN     = stored !== null && stored.length > 0;
  const pinSkipped = configData?.users?.[currentUser?.email]?.pinSkipped === true;

  const statusEl = document.getElementById('pref-current-pin-status');
  statusEl.textContent = hasPIN
    ? `目前 PIN 碼：已設定（${stored.length} 位）`
    : (pinSkipped ? '目前 PIN 碼：未設定（已選擇不使用）' : '目前 PIN 碼：未設定');

  const selEl = document.getElementById('pref-timeout');
  const stdVals = ['0','1','3','5','10','20','30'];
  if (stdVals.includes(tmo)) {
    selEl.value = tmo;
    document.getElementById('pref-timeout-custom').style.display = 'none';
  } else {
    selEl.value = 'custom';
    const customEl = document.getElementById('pref-timeout-custom');
    customEl.style.display = '';
    customEl.value = tmo;
  }

  document.getElementById('pref-pin').value         = '';
  document.getElementById('pref-pin-confirm').value = '';
  document.getElementById('pref-pin-skip').checked  = !hasPIN && pinSkipped;
  const _pinGray = (!hasPIN && pinSkipped) ? '#e2e8f0' : '';
  document.getElementById('pref-pin').disabled           = !hasPIN && pinSkipped;
  document.getElementById('pref-pin-confirm').disabled   = !hasPIN && pinSkipped;
  document.getElementById('pref-pin').style.background          = _pinGray;
  document.getElementById('pref-pin-confirm').style.background  = _pinGray;
  document.getElementById('pref-error').style.display   = 'none';
  document.getElementById('pref-success').style.display = 'none';
  document.getElementById('pref-counselor-freq').checked = _userPref_('counselorFreqMode', false);
  const clEl = document.getElementById('pref-confirm-leave');
  if (clEl) clEl.checked = _userPref_('confirmBeforeLeave', true);
  const csEl = document.querySelector('input[name="pref-cursor-size"][value="' + _userPref_('cursorSize', 'std') + '"]');
  if (csEl) csEl.checked = true;
  // v241 修正：小技巧語言 radio——以目前生效值為準（帳號偏好已在 applyDrivePrefs 回寫本機）
  const tlEl = document.querySelector('input[name="pref-tc-lang"][value="' + _tcLangGet() + '"]');
  if (tlEl) tlEl.checked = true;

  // 同步鎖定按鈕可見性
  const lockBtn = document.getElementById('header-lock-btn');
  if (lockBtn) lockBtn.style.display = hasPIN ? 'flex' : 'none';
  const immLockBtn = document.getElementById('pref-immediate-lock-btn');
  if (immLockBtn) immLockBtn.style.display = hasPIN ? '' : 'none';

  // 更改 Gmail 卡片：顯示目前 email；nomail_ 使用者隱藏（需管理者補填）
  const gmailCard = document.getElementById('pref-gmail-card');
  if (gmailCard) {
    const me = currentUser?.email || '';
    if (me && !me.startsWith('nomail_')) {
      gmailCard.style.display = '';
      const cur = document.getElementById('pref-gmail-current-val');
      if (cur) cur.textContent = me;
      const inp = document.getElementById('pref-gmail-new');
      if (inp) inp.value = '';
    } else {
      gmailCard.style.display = 'none';
    }
  }

  // 登入紀錄（#6）：背景載入，不阻塞頁面渲染
  _renderMySessions().catch(() => {});
  // Phase 3b：信任裝置清單，同樣背景載入（僅本地帳密＋TOTP 後端顯示，見 IS_LOCAL_BACKEND；
  // 卡片本身預設 display:none，非本地後端呼叫 listMyDevices 也只是白做工不影響畫面，故不特別判斷）。
  if (IS_LOCAL_BACKEND) _renderMyDevices().catch(() => {});
  // 登入安全卡片：同樣背景載入，僅本地帳密＋TOTP 後端顯示。
  if (IS_LOCAL_BACKEND) _renderLoginSecurityCard().catch(() => {});

  // 空間預約顯示顏色 grid（INFOSYS 預設色／GC 預設色／其他使用者一覽）
  _renderBkColorGrid();
  _renderBkGcDefaultGrid();
  _renderBkColorRoster();

  // 待辦事項分類順序（與待辦事項頁 tab 拖曳排序共用同一份偏好）
  _renderPrefTodoOrderList();

  // 頂欄頭像預覽（v194）
  _renderPrefAvatarPreview_();

  // v194 穩定瀑布流：每次進頁依當下卡片高度重新分欄一次（之後停留期間不再重排）
  _prefsMasonryLayout(true);
}

// ── 偏好設定瀑布流（v194 穩定分欄）──────────────────────────────
// CSS multi-column 會在任一卡片高度變化時整體重流（正在操作的卡片被搬到別欄，使用者跟丟）。
// 改為：量測當下高度 → 依原始 DOM 順序貪婪塞進最短的欄 → 之後高度變化只長在原欄。
// 重新分欄時機：進偏好設定頁（force）、視窗縮放造成欄數改變。
let _prefsMasonryCards = null; // 卡片原始 DOM 順序快照（首次進頁擷取，重排時維持穩定順序）
let _prefsMasonryCols = 0;
function _prefsMasonryLayout(force) {
  const wrap = document.getElementById('prefs-masonry');
  if (!wrap) return;
  if (!_prefsMasonryCards) _prefsMasonryCards = Array.from(wrap.querySelectorAll('.card'));
  const COL_W = 340, GAP = 20;
  const n = Math.max(1, Math.floor((wrap.clientWidth + GAP) / (COL_W + GAP)));
  if (!force && n === _prefsMasonryCols) return;
  _prefsMasonryCols = n;
  const heights = _prefsMasonryCards.map(c => c.offsetHeight || 0);
  const cols = [], colH = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'prefs-masonry-col';
    cols.push(d); colH.push(0);
  }
  _prefsMasonryCards.forEach((card, i) => {
    let best = 0;
    for (let k = 1; k < n; k++) if (colH[k] < colH[best]) best = k;
    cols[best].appendChild(card);
    if (heights[i] > 0) colH[best] += heights[i] + GAP; // 隱藏卡片不佔高度
  });
  wrap.innerHTML = '';
  cols.forEach(d => wrap.appendChild(d));
}
let _prefsMasonryRzTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_prefsMasonryRzTimer);
  _prefsMasonryRzTimer = setTimeout(() => _prefsMasonryLayout(false), 200);
});

// ── 頂欄頭像自訂上傳（v194；v195 加拖曳/貼上＋裁切編輯）──────────────────────────────
// 入口三種：選擇圖片、拖曳到虛線框、在偏好設定頁 Ctrl+V 貼上剪貼簿圖片——皆進入編輯狀態
//（220×220 預覽 canvas，拖曳平移＋滑桿縮放），按「套用」才依使用者調整的範圍輸出 128×128 JPEG
// dataURL 存個人偏好 avatar（後端 configSelfPatch 白名單已放行）；壓縮後仍超過 100KB 一律拒絕，
// 防塞爆全員共用的 config.json。
const _AV_EDIT = 220; // 編輯 canvas 邊長
const _AV_OUT = 128;  // 輸出頭像邊長
let _avImg = null, _avScaleMin = 1, _avScale = 1, _avOffX = 0, _avOffY = 0;

function prefAvatarUpload(input) {
  const file = input.files && input.files[0];
  input.value = '';
  _avLoadFile(file);
}

// File/Blob → Image → 進編輯狀態（三種入口共用）
function _avLoadFile(file) {
  if (!file || !/^image\//.test(file.type || '')) { if (file) showToast('請選擇圖片檔', 'error'); return; }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => { URL.revokeObjectURL(url); _avOpenEditor(img); };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('無法讀取這張圖片', 'error'); };
  img.src = url;
}

function _avOpenEditor(img) {
  _avImg = img;
  // 最小縮放＝短邊剛好蓋滿編輯框（cover）；預設置中
  _avScaleMin = Math.max(_AV_EDIT / img.naturalWidth, _AV_EDIT / img.naturalHeight);
  _avScale = _avScaleMin;
  _avOffX = (_AV_EDIT - img.naturalWidth * _avScale) / 2;
  _avOffY = (_AV_EDIT - img.naturalHeight * _avScale) / 2;
  document.getElementById('pref-avatar-idle').style.display = 'none';
  document.getElementById('pref-avatar-editor').style.display = '';
  document.getElementById('pref-avatar-zoom').value = 0;
  _avDraw();
}

function _avCloseEditor() {
  _avImg = null;
  document.getElementById('pref-avatar-editor').style.display = 'none';
  document.getElementById('pref-avatar-idle').style.display = '';
}

// 平移上下限：圖片邊緣不得離開編輯框（cover 不變量）
function _avClampOffsets() {
  const w = _avImg.naturalWidth * _avScale, h = _avImg.naturalHeight * _avScale;
  _avOffX = Math.min(0, Math.max(_AV_EDIT - w, _avOffX));
  _avOffY = Math.min(0, Math.max(_AV_EDIT - h, _avOffY));
}

function _avDraw() {
  if (!_avImg) return;
  const canvas = document.getElementById('pref-avatar-edit-canvas');
  const cx = canvas.getContext('2d');
  _avClampOffsets();
  cx.fillStyle = '#f7fafc';
  cx.fillRect(0, 0, _AV_EDIT, _AV_EDIT);
  cx.drawImage(_avImg, _avOffX, _avOffY, _avImg.naturalWidth * _avScale, _avImg.naturalHeight * _avScale);
}

// 縮放滑桿 0~100 → 最小縮放的 1~3 倍；以編輯框中心為錨點縮放（畫面中心的內容不動）
function _avZoomInput(v) {
  if (!_avImg) return;
  const newScale = _avScaleMin * (1 + (Number(v) / 100) * 2);
  const anchorX = (_AV_EDIT / 2 - _avOffX) / _avScale;
  const anchorY = (_AV_EDIT / 2 - _avOffY) / _avScale;
  _avScale = newScale;
  _avOffX = _AV_EDIT / 2 - anchorX * _avScale;
  _avOffY = _AV_EDIT / 2 - anchorY * _avScale;
  _avDraw();
}

function _avConfirm() {
  if (!_avImg) return;
  // 編輯框可視範圍 → 來源矩形，重取樣輸出 128×128
  const canvas = document.createElement('canvas');
  canvas.width = _AV_OUT; canvas.height = _AV_OUT;
  const cx = canvas.getContext('2d');
  const sx = -_avOffX / _avScale, sy = -_avOffY / _avScale, sw = _AV_EDIT / _avScale;
  cx.drawImage(_avImg, sx, sy, sw, sw, 0, 0, _AV_OUT, _AV_OUT);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  if (dataUrl.length > 100 * 1024) { showToast('圖片壓縮後仍過大，請換一張', 'error'); return; }
  syncUserPref_({ avatar: dataUrl });
  _avCloseEditor();
  _applyHeaderAvatar_();
  _renderPrefAvatarPreview_();
  showToast('頭像已更新', 'success', 1800);
}

function _avCancel() { _avCloseEditor(); }

function prefAvatarRemove() {
  syncUserPref_({ avatar: null });
  _applyHeaderAvatar_();
  _renderPrefAvatarPreview_();
  showToast('已移除自訂頭像', 'success', 1800);
}

function _renderPrefAvatarPreview_() {
  const el = document.getElementById('pref-avatar-preview');
  if (el) el.src = document.getElementById('user-avatar')?.src || '';
}

// 編輯 canvas 拖曳平移（pointer events，setPointerCapture 讓拖出框外也不中斷）
(function () {
  let dragging = false, lastX = 0, lastY = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('pref-avatar-edit-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      if (!_avImg) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !_avImg) return;
      _avOffX += e.clientX - lastX;
      _avOffY += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      _avDraw();
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = 'grab';
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // 拖曳圖片進虛線框
    const drop = document.getElementById('pref-avatar-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.style.borderColor = '#3182ce';
        drop.style.background = '#ebf8ff';
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.style.borderColor = '#cbd5e0';
        drop.style.background = '';
      }));
      drop.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) _avLoadFile(f);
      });
    }

    // 偏好設定頁 Ctrl+V 貼上剪貼簿圖片：只在①偏好設定頁顯示中②焦點不在輸入框/富文字時攔下，
    // 避免干擾其他頁與各表單的正常貼上行為。
    document.addEventListener('paste', (e) => {
      if (window._imgEdActive) return; // v197：圖片編輯器開啟中，貼上交給編輯器處理（雙重保險，主要靠 capture-phase stopImmediatePropagation）
      const prefsActive = document.getElementById('page-prefs')?.classList.contains('active');
      if (!prefsActive) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          _avLoadFile(it.getAsFile());
          return;
        }
      }
    });
  });
})();

// v187：整列可用滑鼠/觸控拖曳排序（_scdInitDrag，axis 'y'，插入預覽為水平線），↑↓ 按鈕保留
// 作為無障礙備援；清單含「系所歸類 🧩」（與待辦頁 tab 順序共用同一份 navOrder_todoTabs）。
function _renderPrefTodoOrderList() {
  const el = document.getElementById('pref-todo-order-list');
  if (!el) return;
  const order = _todoCategoryOrder();
  el.innerHTML = order.map((key, idx) => {
    const meta = _todoTabMeta(key);
    return `<div class="scd-drag-item" data-drag-key="${key}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;" data-tip="可拖曳調整順序">
      <span style="font-size:1rem;">${meta.emoji}</span>
      <span style="flex:1;font-size:.88rem;font-weight:600;color:#2d3748;">${escHtml(meta.label)}</span>
      <button class="btn btn-sm" ${idx === 0 ? 'disabled' : ''} onclick="_prefTodoOrderMove(${idx},-1)" data-tip="上移">↑</button>
      <button class="btn btn-sm" ${idx === order.length - 1 ? 'disabled' : ''} onclick="_prefTodoOrderMove(${idx},1)" data-tip="下移">↓</button>
    </div>`;
  }).join('');
  _scdInitDrag(el, {
    axis: 'y',
    itemSelector: '.scd-drag-item',
    longPressTouch: true, // 拖曳軸向與頁面捲動軸向相同（皆縱向），需長按才啟動，避免擋住觸控捲動
    getOrder: _todoCategoryOrder,
    onReorder: (newOrder) => { _setTodoCategoryOrder(newOrder); _renderPrefTodoOrderList(); showToast('已更新順序', 'success', 1500); },
  });
}
function _prefTodoOrderMove(idx, dir) {
  const order = _todoCategoryOrder();
  const j = idx + dir;
  if (j < 0 || j >= order.length) return;
  [order[idx], order[j]] = [order[j], order[idx]];
  _setTodoCategoryOrder(order);
  _renderPrefTodoOrderList();
  showToast('已更新順序', 'success', 1500);
}

function saveLeaveConfirmPref() {
  const val = document.getElementById('pref-confirm-leave')?.checked ?? true;
  syncUserPref_({ confirmBeforeLeave: val });
  showToast(val ? '已啟用離開確認提示' : '已關閉離開確認提示');
}

// v240：游標大小偏好，radio 選擇即改即存（不掛在 PIN 儲存按鈕上）
function _prefCursorSizeChange(v) {
  _applyCursorSize(v);
  syncUserPref_({ cursorSize: v });
  showToast('游標大小已更新', 'success');
}

// v241 修正：小技巧語言偏好（偏好設定入口）。tcSetLang 內含 localStorage＋syncUserPref_ 雙寫。
function _prefTcLangChange(v) {
  tcSetLang(v);
  showToast('小技巧語言已更新：' + (TC_LANG_META[v]?.name || v), 'success');
}
// Email 更改申請制（2026-07-17 定案，取代原 _prefChangeMyGmail 自助直改）：只通知管理者群
// ＋記稽核，不動 users/cases、不全員廣播。原因：email＝內部身分主鍵（名冊 key／server 帳號
// 資料庫主鍵／個案指派），自助直改在本地後端上會造成身分脫鉤把人鎖在系統外；正式的管理者
// 連動改 email 功能（同步 DB/名冊/個案/GC）排於觀察期後實作。_migrateUserEmail 保留給管理者
// 既有動線（saveUser 的 nomail_ 補填等），一般使用者不再有直改入口。
function _prefRequestEmailChange() {
  const me = currentUser?.email;
  if (!me) return;
  if (me.startsWith('nomail_')) { alert('無 Email 帳號者請由主任/管理者於使用者管理頁補填。'); return; }
  const raw = (document.getElementById('pref-gmail-new')?.value || '').trim().toLowerCase();
  if (!raw) { alert('請輸入想更改成的新 Email。'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { alert('Email 格式不正確。'); return; }
  if (raw === me) { alert('新 Email 與目前相同。'); return; }
  if (!confirm(`確定要送出 Email 更改申請嗎？\n\n  ${me}\n→ ${raw}\n\n管理者會收到通知；處理完成前系統仍沿用目前 Email，登入不受影響。`)) return;
  const myName = configData?.users?.[me]?.name || me;
  const admins = Object.entries(configData?.users || {})
    .filter(([, u]) => u && u.disabled !== true && (u.role === '主任' || u.isAdmin === true || u.extraRole === '管理者'))
    .map(([email]) => email);
  const nowIso = new Date().toISOString();
  const msg = `${myName} 申請將 Email 由 ${me} 更改為 ${raw}（待管理者執行連動更改；處理完成前系統仍沿用原 Email）`;
  new Set([...admins, me]).forEach(email => { // 管理者群收申請；本人也留一份作送出存證
    _queueNotifPush(email, {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'email_change_request',
      message: msg,
      actorEmail: me,
      actorName: myName,
      createdAt: nowIso,
      read: false,
    });
  });
  _flushNotifOps().catch(() => {});
  auditLog('申請更改Email', `${me} → ${raw}`);
  const inp = document.getElementById('pref-gmail-new');
  if (inp) inp.value = '';
  showToast('已送出申請並通知管理者。', 'success', 3500);
}
function toggleCustomTimeout(sel) {
  document.getElementById('pref-timeout-custom').style.display = sel.value === 'custom' ? '' : 'none';
}
// gridId/currentId 預設對應偏好設定頁；booking 頁彈窗會傳入另一組 id 重用同一份渲染邏輯
// gridId/currentId 預設對應偏好設定頁；booking 頁彈窗會傳入另一組 id 重用同一份渲染邏輯。
// extraGridId（若該 id 存在於畫面上）渲染「GC 11 色」附加選項，讓 INFOSYS 預設色也能選跟 GC 一致的顏色。
function _renderBkColorGrid(gridId, currentId, extraGridId) {
  const grid = document.getElementById(gridId || 'pref-bkcolor-grid');
  const cur  = document.getElementById(currentId || 'pref-bkcolor-current');
  if (!grid) return;
  const me = currentUser?.email;
  const my = configData?.users?.[me]?.bkColor || '';
  // 統計每個顏色被哪些「其他使用者」選用，供 hover 顯示
  const usersByColor = {};
  Object.entries(configData?.users || {}).forEach(([email, u]) => {
    if (!u || u.disabled || email === me || !u.bkColor) return;
    const key = u.bkColor.toUpperCase();
    (usersByColor[key] = usersByColor[key] || []).push(u.name || email);
  });
  const _swatch = hex => {
    const key = hex.toUpperCase();
    const sel = key === (my || '').toUpperCase();
    const others = usersByColor[key] || [];
    const tip = others.length ? ` data-tip="已由 ${escHtml(others.join('、'))} 選用"` : '';
    const box = sel
      ? 'inset 0 0 0 3px #fff, 0 0 0 2px #2b6cb0'
      : others.length
        ? 'inset 0 0 0 2px #fff, 0 0 0 2px #2d3748'
        : 'inset 0 0 0 1px rgba(0,0,0,.08)';
    return `<div onclick="pickMyBkColor('${hex}','${escHtml(gridId||'pref-bkcolor-grid')}','${escHtml(currentId||'pref-bkcolor-current')}')"
      title="${escHtml(hex)}"${tip}
      style="width:32px;height:32px;border-radius:6px;background:${hex};cursor:pointer;
      box-shadow:${box};transition:transform .1s;"
      onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform=''"></div>`;
  };
  grid.innerHTML = BK_USER_COLORS.map(_swatch).join('');
  const extraGrid = document.getElementById(extraGridId || (gridId ? gridId + '-gc-extra' : 'pref-bkcolor-grid-gc-extra'));
  if (extraGrid) extraGrid.innerHTML = BK_USER_COLORS_EXTRA_GC.map(_swatch).join('');
  if (cur) cur.textContent = my ? `目前：${my}` : '目前：未設定（沿用預設灰底）';
}
async function pickMyBkColor(hex, gridId, currentId) {
  const me = currentUser?.email;
  if (!me || !configData?.users?.[me]) return;
  configData.users[me].bkColor = hex;
  _renderBkColorGrid(gridId, currentId);
  try { await _configSelfPatch({ bkColor: hex }); } catch (e) { alert('儲存失敗：' + e.message); return; }
  if (document.getElementById('page-bookings')?.classList.contains('active')) renderBookingsPage();
  _renderBkColorRoster();
  showToast?.(`已設定顏色 ${hex}`, 'success');
}
function openBkColorModal() {
  document.getElementById('bk-color-modal').style.display = 'flex';
  _renderBkColorGrid('bk-color-modal-grid', 'bk-color-modal-current');
  _renderBkGcDefaultGrid('bk-color-modal-gc-grid', 'bk-color-modal-gc-current');
  _renderBkColorRoster('bk-color-modal-roster');
}
function closeBkColorModal() {
  document.getElementById('bk-color-modal').style.display = 'none';
}
async function clearMyBkColor(gridId, currentId) {
  const me = currentUser?.email;
  if (!me || !configData?.users?.[me]) return;
  if (!confirm('要清除您的 INFOSYS 預設色，改回預設灰底嗎？')) return;
  delete configData.users[me].bkColor;
  _renderBkColorGrid(gridId, currentId);
  try { await _configSelfPatch({ bkColor: null }); } catch (e) { alert('儲存失敗：' + e.message); return; }
  if (document.getElementById('page-bookings')?.classList.contains('active')) renderBookingsPage();
  _renderBkColorRoster();
  showToast?.('已清除自訂顏色', 'info');
}

// #5-3：GC 預設色——建立者在此設定的預約同步到 Google 日曆時套用此色。GC 事件色僅 11 色，
// 直接讓使用者從這 11 色挑選（不做近似轉換的模糊感），與 INFOSYS 預設色各自獨立、不綁死。
function _renderBkGcDefaultGrid(gridId, currentId) {
  const grid = document.getElementById(gridId || 'pref-bkcolor-gc-grid');
  const cur  = document.getElementById(currentId || 'pref-bkcolor-gc-current');
  if (!grid) return;
  const me = currentUser?.email;
  const my = String(configData?.users?.[me]?.bkColorGc || '');
  // 比照 INFOSYS 選色盤：已被其他使用者選用的色塊加深色外框＋hover 顯示誰在用（僅提示，不阻擋選擇）
  const usersByGc = {};
  Object.entries(configData?.users || {}).forEach(([email, u]) => {
    if (!u || u.disabled || email === me || !u.bkColorGc) return;
    const key = String(u.bkColorGc);
    (usersByGc[key] = usersByGc[key] || []).push(u.name || email);
  });
  grid.innerHTML = Object.entries(GC_EVENT_COLORS).map(([id, hex]) => {
    const sel = id === my;
    const others = usersByGc[id] || [];
    const tip = others.length ? ` data-tip="已由 ${escHtml(others.join('、'))} 選用"` : '';
    const box = sel
      ? 'inset 0 0 0 3px #fff, 0 0 0 2px #2b6cb0'
      : others.length
        ? 'inset 0 0 0 2px #fff, 0 0 0 2px #2d3748'
        : 'inset 0 0 0 1px rgba(0,0,0,.08)';
    return `<div onclick="pickMyBkGcColor('${id}','${escHtml(gridId||'pref-bkcolor-gc-grid')}','${escHtml(currentId||'pref-bkcolor-gc-current')}')"
      title="${escHtml(hex)}"${tip}
      style="width:32px;height:32px;border-radius:6px;background:${hex};cursor:pointer;
      box-shadow:${box};transition:transform .1s;"
      onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform=''"></div>`;
  }).join('');
  if (cur) cur.textContent = my ? `目前：GC 色 #${my}` : '目前：未設定（沿用 INFOSYS 預設色的近似轉換）';
}
async function pickMyBkGcColor(id, gridId, currentId) {
  const me = currentUser?.email;
  if (!me || !configData?.users?.[me]) return;
  configData.users[me].bkColorGc = id;
  _renderBkGcDefaultGrid(gridId, currentId);
  try { await _configSelfPatch({ bkColorGc: id }); } catch (e) { alert('儲存失敗：' + e.message); return; }
  _renderBkColorRoster();
  showToast?.(`已設定 GC 預設色 #${id}`, 'success');
}
async function clearMyBkGcColor(gridId, currentId) {
  const me = currentUser?.email;
  if (!me || !configData?.users?.[me]) return;
  if (!confirm('要清除您的 GC 預設色嗎？清除後同步到 Google 日曆時將沿用 INFOSYS 預設色的近似轉換。')) return;
  delete configData.users[me].bkColorGc;
  _renderBkGcDefaultGrid(gridId, currentId);
  try { await _configSelfPatch({ bkColorGc: null }); } catch (e) { alert('儲存失敗：' + e.message); return; }
  _renderBkColorRoster();
  showToast?.('已清除 GC 預設色', 'info');
}

// #5-3：其他使用者的預設色一覽（唯讀）——名字＋INFOSYS 色塊＋GC 色塊，讓大家知道彼此的顏色。
function _renderBkColorRoster(containerId) {
  const el = document.getElementById(containerId || 'pref-bkcolor-roster');
  if (!el) return;
  const me = currentUser?.email;
  const rows = Object.entries(configData?.users || {})
    .filter(([email, u]) => u && !u.disabled && email !== me)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'zh'))
    .map(([email, u]) => {
      const infosysSwatch = u.bkColor
        ? `<span title="${escHtml(u.bkColor)}" style="width:16px;height:16px;border-radius:4px;background:${escHtml(u.bkColor)};display:inline-block;border:1px solid rgba(0,0,0,.15);"></span>`
        : `<span style="width:16px;height:16px;border-radius:4px;background:#edf2f7;display:inline-block;border:1px dashed #cbd5e0;"></span>`;
      const gcHex = u.bkColorGc && GC_EVENT_COLORS[u.bkColorGc] ? GC_EVENT_COLORS[u.bkColorGc] : '';
      const gcSwatch = gcHex
        ? `<span title="GC 色 #${escHtml(String(u.bkColorGc))}" style="width:16px;height:16px;border-radius:4px;background:${gcHex};display:inline-block;border:1px solid rgba(0,0,0,.15);"></span>`
        : `<span style="width:16px;height:16px;border-radius:4px;background:#edf2f7;display:inline-block;border:1px dashed #cbd5e0;"></span>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.82rem;color:#4a5568;">
        <span style="min-width:70px;">${escHtml(u.name || email)}</span>
        <span style="display:flex;align-items:center;gap:4px;" data-tip="學諮資訊系統預設色">${infosysSwatch}</span>
        <span style="display:flex;align-items:center;gap:4px;" data-tip="Google 日曆預設色">${gcSwatch}</span>
      </div>`;
    });
  el.innerHTML = rows.length ? rows.join('') : '<div style="font-size:.8rem;color:#a0aec0;">（尚無其他使用者）</div>';
}
function prefResetBkFreqs() {
  if (!confirm('確定清除空間預約使用頻率記憶？選項排序將回到預設。')) return;
  syncUserPref_({ bkFreqs: {} });
  renderPrefsPage();
}
function prefResetCounselorFreqs() {
  if (!confirm('確定清除輔導人員選單使用記憶？')) return;
  syncUserPref_({ counselorFreqs: {} });
  renderPrefsPage();
}

async function savePrefs() {
  const errEl = document.getElementById('pref-error');
  const okEl  = document.getElementById('pref-success');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  const pinVal     = document.getElementById('pref-pin').value;
  const pinConfirm = document.getElementById('pref-pin-confirm').value;
  const tmoSel     = document.getElementById('pref-timeout').value;
  const tmoMins    = tmoSel === 'custom'
    ? (parseInt(document.getElementById('pref-timeout-custom').value) || 10)
    : parseInt(tmoSel);

  const pinSkip    = document.getElementById('pref-pin-skip').checked;
  const existingPin = localStorage.getItem(pinKey()) || '';

  if (pinVal && pinVal !== pinConfirm) {
    errEl.textContent = 'PIN 碼與確認 PIN 碼不一致。';
    errEl.style.display = '';
    return;
  }
  if (!pinVal && !pinSkip && !existingPin) {
    errEl.textContent = '請輸入 PIN 碼，或勾選「我不需要 PIN 碼」。';
    errEl.style.display = '';
    return;
  }

  let finalPin, finalPinSkipped;
  if (pinVal) {
    finalPin = pinVal;
    finalPinSkipped = false;
  } else if (pinSkip) {
    finalPin = '';
    finalPinSkipped = true;
  } else {
    finalPin = existingPin;
    finalPinSkipped = false;
  }

  localStorage.setItem(pinKey(), finalPin);
  localStorage.setItem(pinTmoKey(), String(tmoMins));
  const freqMode = document.getElementById('pref-counselor-freq').checked;
  const writePromise = syncUserPref_({ counselorFreqMode: freqMode, pinTmo: tmoMins, pin: finalPin, pinSkipped: finalPinSkipped });

  resetAfkTimer();
  renderPrefsPage();

  if (writePromise) {
    okEl.textContent = 'PIN 同步中…';
    okEl.style.display = '';
    try {
      await writePromise;
      okEl.textContent = finalPin
        ? 'PIN 已同步至 Drive，其他裝置登入時將要求驗證。'
        : (finalPinSkipped ? '已設定不使用 PIN，已同步至 Drive。' : '偏好設定已儲存。');
    } catch(e) {
      okEl.style.display = 'none';
      errEl.textContent = 'PIN 本機已儲存，但同步 Drive 失敗：' + e.message;
      errEl.style.display = '';
    }
  } else {
    okEl.textContent = '偏好設定已儲存。';
    okEl.style.display = '';
  }
}

