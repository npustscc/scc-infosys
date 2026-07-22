// dev/openmail.js — 信箱（校內 openmail 收發信，IMAP/SMTP）模組（拆 index.html 絞殺者第十五刀，v261）。
// 本刀起改用新刀法「inline script 區塊原地外部化」：原 index.html 內這一整段獨立的
// <script>…</script>（無 src、無 document.currentScript 依賴，已逐行複核確認）被整段原樣搬出，
// 原位置換成 <script src="openmail.js"></script>，標籤所在順序完全不變，因此載入與執行時機
// 與搬移前逐位元組一致——不需要像前十四刀那樣對頂層 let/const 做 column-0 複核排除，
// 本檔頂層狀態一律照搬：
//   const _OM_SPECIAL_NAMES／OM_MAX_ATTACH_BYTES／OM_CACHE_MAX_BODIES
//   let _om（信箱連線/資料夾/郵件列表/草稿等主狀態物件）／_omFlushingOutbox／_omConnecting／_omSending
//   const OMSV_MAX_FOLDER_DEPTH
// 帳密僅使用者自行輸入、密碼只存後端伺服器記憶體（登出/每日過期即清），前端絕不落地密碼。
// 主要函式（依原始順序，含但不限）：連線/收發信核心（_om 命名空間）、離線草稿寄件匣與自動補寄
// （_omFlushingOutbox）、寫信視窗開啟/送出（openOmCompose／omSendSubmit）、
// 資料夾樹狀渲染與封存（_omsvRenderFolderTree／_omsvArchiveConfirm 等 _omsv 前綴函式）。
// 本區塊在 index.html 中的原始位置緊接在 mental-leave.js 之後、簡訊模組（sms）之前，
// 拆出後仍以同一位置的 <script src> 載入，執行順序不受影響。
// ══════════════════════════════════════════════
//  v202：信箱（校內 openmail 收發信，IMAP/SMTP，_om 命名空間）
//  帳密僅使用者自行輸入、密碼只存後端伺服器記憶體（登出/每日過期即清），前端絕不落地密碼。
// ══════════════════════════════════════════════
const _OM_SPECIAL_NAMES = { '\\Inbox':'收件匣', '\\Sent':'寄件備份', '\\Drafts':'草稿', '\\Trash':'垃圾桶', '\\Junk':'垃圾郵件' };
const OM_MAX_ATTACH_BYTES = 50 * 1024 * 1024;
const OM_CACHE_MAX_BODIES = 50; // v220：已開信內文快取上限（LRU 淘汰，見 _omCacheBodySet）
let _om = {
  connected: false,
  mailUser: '',
  folders: [],
  currentFolder: 'INBOX',
  messages: [],
  total: 0,
  page: 1,
  pageSize: 50,
  selected: new Set(),
  searchQuery: '',
  currentMsg: null,
  pollTimer: null,
  composeAttachments: [], // { filename, contentType, base64, size }
  composeMode: null,      // null | 'reply' | 'replyAll' | 'fwd'
  composeRefMsg: null,
  // v220：學諮伺服器資料夾（信件封存到本系統 sqlite，見 openmail/archive.js omsv* action）
  // v234：archiveFolders 每筆多一個 parentId（null＝根層），資料夾拖曳改階層時用的
  // _dragFolderId 動態掛在 _om 上（同 _dragUids 的既有寫法，不在此預先宣告）。
  archiveFolders: [],        // [{ id, name, parentId, createdAt, messageCount }]
  archiveCurrentFolderId: null, // 目前檢視中的封存資料夾 id；null＝目前顯示一般 openmail 信件列表
  archiveMessages: [],       // 目前封存資料夾的信件列表 metadata（omsvList）
  archiveViewingId: null,    // 閱讀窗目前顯示的封存信 id；null＝閱讀窗顯示的是即時 IMAP 信件
  archivePending: [],        // 封存 modal 待送出的 [{folder,uid}]
  // v220：前端記憶體快取（stale-while-revalidate），純記憶體不用 IndexedDB——見 _omClearCache 的
  // 呼叫點（登出／中斷連結／mail_not_connected 一律清空，密碼以外的信件內容快取沒有「永不落地」
  // 的等級要求，但仍比照同一份謹慎態度：離開帳號就清乾淨）。
  cache: {
    lists: new Map(),  // key `${folder}|${page}|${pageSize}` → { messages, total, page, pageSize }
    bodies: new Map(), // key `${folder}::${uid}` → 已開信的完整內文（LRU，上限 OM_CACHE_MAX_BODIES）
  },
};

function _omLsKey() { return 'scc_om_user_' + (currentUser?.email || ''); }

// ── 快取 helper（v220） ──────────────────────────────────────────────────
function _omListCacheKey(folder, page, pageSize) { return `${folder}|${page}|${pageSize}`; }
function _omBodyCacheKey(folder, uid) { return `${folder}::${uid}`; }

function _omCacheListSet(folder, page, pageSize, data) {
  _om.cache.lists.set(_omListCacheKey(folder, page, pageSize), {
    messages: Array.isArray(data.messages) ? data.messages : [],
    total: data.total || 0,
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
  });
}
// 資料夾內容有結構性變動（信件被移出/移入/刪除，分頁/總數都可能跟著變）時，整個資料夾的所有
// 分頁快取一併作廢，改由下次 _omLoadMessages 重新打 API（比就地修補分頁數字簡單可靠）。
function _omCacheListInvalidateFolder(folder) {
  if (!folder) return;
  const prefix = folder + '|';
  for (const key of [..._om.cache.lists.keys()]) {
    if (key.startsWith(prefix)) _om.cache.lists.delete(key);
  }
}
function _omCacheBodyGet(folder, uid) {
  const key = _omBodyCacheKey(folder, uid);
  const hit = _om.cache.bodies.get(key);
  if (hit) { _om.cache.bodies.delete(key); _om.cache.bodies.set(key, hit); } // 命中即移到 Map 尾端（LRU 最新）
  return hit;
}
function _omCacheBodySet(folder, uid, msg) {
  const key = _omBodyCacheKey(folder, uid);
  _om.cache.bodies.delete(key);
  _om.cache.bodies.set(key, msg);
  while (_om.cache.bodies.size > OM_CACHE_MAX_BODIES) {
    const oldestKey = _om.cache.bodies.keys().next().value; // Map 保留插入順序，最前面＝最舊
    _om.cache.bodies.delete(oldestKey);
  }
}
function _omCacheBodyDelete(folder, uid) {
  _om.cache.bodies.delete(_omBodyCacheKey(folder, uid));
}
function _omClearCache() {
  _om.cache.lists.clear();
  _om.cache.bodies.clear();
}

function _omErrMsg(msg) {
  const map = {
    mail_auth_failed: '帳號或密碼被信箱伺服器拒絕：請確認帳號使用完整位址（帳號@mail.npust.edu.tw）且密碼正確。連續失敗會被信箱伺服器暫時鎖定，若剛連錯多次請等 2～3 分鐘再試',
    mail_server_unreachable: '無法連線到屏科大信箱伺服器（非本系統問題），請稍後再試',
    mail_server_timeout: '屏科大信箱伺服器沒有回應（可能因連續登入失敗被暫時限流）：請等 2～3 分鐘再試，並確認帳號使用完整位址（帳號@mail.npust.edu.tw）',
    mail_not_connected: '信箱連線已中斷，請重新登入',
    mail_send_failed: '寄送失敗，請稍後再試',
    mail_too_large: '附件總容量超過 50MB 上限，請移除部分附件後再試',
    // v220：學諮伺服器資料夾（omsv*）業務錯誤
    omsv_invalid_name: '資料夾名稱不可為空，且長度需在 100 字以內',
    omsv_folder_name_taken: '已有相同名稱的資料夾',
    omsv_folder_not_found: '找不到指定的學諮伺服器資料夾',
    omsv_folder_not_empty: '資料夾內還有信件或子資料夾，請先清空',
    // v234：資料夾階層（子資料夾）業務錯誤
    omsv_folder_too_deep: '資料夾最多三層',
    omsv_folder_cycle: '不能移到自己或自己的子資料夾底下',
    omsv_message_not_found: '找不到這封已封存的信件',
    omsv_attachment_not_found: '找不到這個附件',
    omsv_too_large: '信件超過 25MB 封存上限，請改用其他方式保存',
    omsv_fetch_failed: '從信箱擷取信件失敗，請稍後再試',
    omsv_parse_failed: '信件內容解析失敗',
  };
  return map[msg] || msg || '發生未知錯誤';
}

// 所有 om* 呼叫共用的包裝：後端回 mail_not_connected 時自動切回連結卡片（規格明列的通用行為）
async function _omCall(action, params) {
  try {
    return await proxyCall(action, params);
  } catch (e) {
    if (e.message === 'mail_not_connected') {
      _om.connected = false;
      _omStopPoll();
      _omClearCache(); // v220：連線中斷即清空快取，避免下次重連後看到不同帳號/舊資料的殘留
      showToast('信箱連線已中斷，請重新登入', 'warn');
      renderOmPage();
    }
    throw e;
  }
}

async function renderOmPage() {
  try {
    const st = await proxyCall('omStatus');
    _om.connected = !!st.connected;
    _om.mailUser = st.mailUser || '';
  } catch (e) {
    _om.connected = false;
  }
  const cardEl = document.getElementById('om-connect-card');
  const boxEl = document.getElementById('om-mailbox');
  if (_om.connected) {
    if (cardEl) cardEl.style.display = 'none';
    if (boxEl) boxEl.style.display = '';
    _omUpdateAccountNote();   // v224：顯示登入帳號
    _omInitFolderResize();    // v224：還原/綁定高度拖曳
    _omInitFolderCollapse();  // v224：還原收合狀態
    _omInitLeftColResize();   // v230：左欄寬度拖曳（210~420px）
    _omStartPoll();
    await omRefreshAll();
  } else {
    if (cardEl) cardEl.style.display = '';
    if (boxEl) boxEl.style.display = 'none';
    _omStopPoll();
    try {
      const saved = localStorage.getItem(_omLsKey());
      const el = document.getElementById('om-mailuser');
      if (saved && el && !el.value) el.value = saved;
    } catch (_) {}
  }
  // v224：連線/在線燈號——不論連結與否都顯示，並在信箱頁開著時每 30 秒輪詢一次可達性。
  _omUpdateReachLight();
  _omStartReachPoll();
  _omRenderOutboxBar(); // v231：寄件匣提示條（連結前後都顯示）
}

// v224：查詢並更新「連線頁可連線」與「信箱在線」兩顆燈號。純 TCP 可達性探測（不觸發登入限流）。
async function _omUpdateReachLight() {
  const setLight = (id, html, color, tip) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    el.style.color = color;
    if (tip) el.setAttribute('data-tip', tip);
  };
  let reachable = false, connected = false;
  try {
    const r = await proxyCall('omReachable');
    reachable = !!r.reachable; connected = !!r.connected;
    // v235：只有伺服器已設定「記住密碼」加密金鑰才顯示勾選框，未設定＝功能整個關閉（fail-closed）。
    const rememberRow = document.getElementById('om-remember-row');
    if (rememberRow) rememberRow.style.display = r.rememberAvailable ? 'flex' : 'none';
  } catch (_) { reachable = false; }
  if (reachable) {
    setLight('om-reach-light', '🟢 信箱伺服器可連線', '#2f855a', '已可連到屏科大信箱伺服器（mail.npust.edu.tw），可輸入帳密連結');
    setLight('om-online-light', '🟢 在線上', '#2f855a', '與屏科大信箱伺服器連線正常');
    // v231：連線恢復且已連結 → 自動補寄寄件匣
    if (connected && _omOutboxLoad().length) _omFlushOutbox(true);
  } else {
    setLight('om-reach-light', '🔴 目前無法連線', '#c53030', '連不到屏科大信箱伺服器：可能校內網路異常或伺服器維護，稍後再試');
    setLight('om-online-light', '🔴 連線中斷', '#c53030', '目前連不到屏科大信箱伺服器，收發信可能失敗；稍後會自動重試');
  }
}
function _omStartReachPoll() {
  if (_om.reachTimer) return;
  _om.reachTimer = setInterval(() => {
    if (document.getElementById('page-om')?.classList.contains('active')) _omUpdateReachLight();
  }, 30000);
}
function _omStopReachPoll() {
  if (_om.reachTimer) { clearInterval(_om.reachTimer); _om.reachTimer = null; }
}

// v224：屏科大信箱資料夾樹——點 banner 收合/展開、可拖曳調整高度、顯示登入帳號附註。
function _omToggleFolderCollapse() {
  const tree = document.getElementById('om-folder-tree');
  const bar = document.getElementById('om-folder-resize');
  const chev = document.getElementById('om-collapse-chevron');
  if (!tree) return;
  const willCollapse = tree.style.display !== 'none';
  tree.style.display = willCollapse ? 'none' : '';
  if (bar) bar.style.display = willCollapse ? 'none' : '';
  if (chev) chev.textContent = willCollapse ? '▸' : '▾';
  try { localStorage.setItem('om_folder_collapsed', willCollapse ? '1' : '0'); } catch (_) {}
}

function _omInitFolderCollapse() {
  let collapsed = false;
  try { collapsed = localStorage.getItem('om_folder_collapsed') === '1'; } catch (_) {}
  const tree = document.getElementById('om-folder-tree');
  const bar = document.getElementById('om-folder-resize');
  const chev = document.getElementById('om-collapse-chevron');
  if (tree) tree.style.display = collapsed ? 'none' : '';
  if (bar) bar.style.display = collapsed ? 'none' : '';
  if (chev) chev.textContent = collapsed ? '▸' : '▾';
}

function _omInitFolderResize() {
  const bar = document.getElementById('om-folder-resize');
  const tree = document.getElementById('om-folder-tree');
  if (!bar || !tree) return;
  try { const h = parseInt(localStorage.getItem('om_folder_h'), 10); if (h >= 80 && h <= 800) tree.style.height = h + 'px'; } catch (_) {}
  if (bar._omResizeInited) return; // 事件只綁一次
  bar._omResizeInited = true;
  let startY = 0, startH = 0, dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startH = tree.getBoundingClientRect().height;
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = Math.max(80, Math.min(800, startH + (e.clientY - startY)));
    tree.style.height = h + 'px';
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem('om_folder_h', String(parseInt(tree.style.height, 10) || 280)); } catch (_) {}
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// v230：信箱左欄寬度拖曳（右緣把手；210px～420px＝預設的 2 倍上限，記憶 localStorage）。
function _omInitLeftColResize() {
  const bar = document.getElementById('om-left-resize');
  const col = document.getElementById('om-left-col');
  if (!bar || !col) return;
  try { const w = parseInt(localStorage.getItem('om_left_w'), 10); if (w >= 210 && w <= 420) col.style.width = w + 'px'; } catch (_) {}
  if (bar._omResizeInited) return; // 事件只綁一次
  bar._omResizeInited = true;
  let startX = 0, startW = 0, dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startW = col.getBoundingClientRect().width;
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = Math.max(210, Math.min(420, startW + (e.clientX - startX)));
    col.style.width = w + 'px';
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem('om_left_w', String(parseInt(col.style.width, 10) || 210)); } catch (_) {}
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// ══════ v231：寄件匣（離線寫信暫存）══════
// 寄出失敗（連線類錯誤）時把整封信存 localStorage，連線恢復後自動補寄（見 _omUpdateReachLight 的
// auto-flush hook）。per-使用者 key；附件以 base64 一併暫存，總量超過 2.5MB 不收（localStorage 配額
// 保護），請使用者移除附件或稍後再試。
function _omOutboxKey() { return 'scc_om_outbox_' + (currentUser?.email || ''); }
function _omOutboxLoad() {
  try { const a = JSON.parse(localStorage.getItem(_omOutboxKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function _omOutboxSave(arr) {
  try { localStorage.setItem(_omOutboxKey(), JSON.stringify(arr)); return true; }
  catch (e) { alert('寄件匣儲存失敗（瀏覽器儲存空間不足）：' + e.message); return false; }
}

// 是否為「值得進寄件匣」的連線類失敗（帳密被拒等使用者問題不收——重寄也不會成功）
function _omIsConnErr(msg) {
  return /mail_not_connected|mail_server_unreachable|mail_server_timeout|Failed to fetch|NetworkError|逾時|timeout/i.test(String(msg || ''));
}

function _omQueueOutbox(params) {
  const size = JSON.stringify(params).length;
  if (size > 2.5 * 1024 * 1024) {
    alert('這封信（含附件）超過寄件匣暫存上限 2.5MB，無法離線暫存；請先移除部分附件，或等連線恢復後直接寄出。');
    return false;
  }
  const arr = _omOutboxLoad();
  arr.push({ id: 'ob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString(), params });
  if (!_omOutboxSave(arr)) return false;
  _omRenderOutboxBar();
  return true;
}

function _omOutboxRemove(id) {
  const arr = _omOutboxLoad().filter(x => x.id !== id);
  _omOutboxSave(arr);
  _omRenderOutboxBar();
}

function _omRenderOutboxBar() {
  const bar = document.getElementById('om-outbox-bar');
  if (!bar) return;
  const arr = _omOutboxLoad();
  if (!arr.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const items = arr.map(x => `
    <div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:.8rem;color:#4a5568;">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">✉ ${escHtml((x.params.subject || '（無主旨）'))} → ${escHtml((x.params.to || []).join(', '))}</span>
      <span style="color:#a0aec0;flex-shrink:0;">${escHtml((x.createdAt || '').replace('T', ' ').slice(5, 16))}</span>
      <button class="btn btn-secondary btn-sm" style="padding:0 6px;flex-shrink:0;" onclick="_omOutboxRemove('${escHtml(x.id)}')" data-tip="從寄件匣移除（放棄這封信）">✕</button>
    </div>`).join('');
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <strong style="color:#975a16;">📤 寄件匣：${arr.length} 封待寄</strong>
      <span style="color:#975a16;font-size:.78rem;">連線恢復後會自動寄出，也可手動立即寄出</span>
      <span style="flex:1 1 auto;"></span>
      <button class="btn btn-primary btn-sm" onclick="_omFlushOutbox(false)">立即寄出</button>
    </div>
    <div style="margin-top:4px;">${items}</div>`;
  bar.style.display = 'block';
}

let _omFlushingOutbox = false;
async function _omFlushOutbox(isAuto) {
  if (_omFlushingOutbox) return;
  const arr = _omOutboxLoad();
  if (!arr.length) return;
  _omFlushingOutbox = true;
  let sent = 0;
  try {
    for (const item of arr.slice()) {
      try {
        await _omCall('omSend', item.params);
        sent++;
        _omOutboxRemove(item.id);
      } catch (e) {
        // 連線類失敗：留在寄件匣等下次；其他錯誤（如收件人格式）也保留但提示使用者處理
        if (!isAuto) showToast(`寄件匣寄出失敗（${_omErrMsg(e.message)}），未寄出的信仍保留在寄件匣`, 'warn');
        break;
      }
    }
    if (sent) {
      showToast(`寄件匣：已補寄出 ${sent} 封信`, 'success');
      const sentPath = _omFindSpecialFolderPath('\\Sent');
      if (sentPath) _omCacheListInvalidateFolder(sentPath);
    }
  } finally {
    _omFlushingOutbox = false;
    _omRenderOutboxBar();
  }
}

// 登入帳號附註（例：linkinlol）——為日後多信箱登入鋪路。
function _omUpdateAccountNote() {
  const el = document.getElementById('om-account-note');
  if (!el) return;
  const user = _om.mailUser || '';
  const local = user.includes('@') ? user.split('@')[0] : user;
  el.textContent = local ? ('👤 ' + local) : '';
  el.setAttribute('data-tip', user ? ('目前登入帳號：' + user) : '');
}

// ── 連結／中斷 ──────────────────────────────
let _omConnecting = false;
async function omConnectSubmit() {
  if (_omConnecting) return;
  const userEl = document.getElementById('om-mailuser');
  const passEl = document.getElementById('om-mailpass');
  let mailUser = (userEl?.value || '').trim();
  const mailPass = passEl?.value || '';
  // v224：帳號可只輸入前半，系統自動補學校網域——校方 Mail2000 只接受完整位址（帳號@mail.npust.edu.tw）
  if (mailUser && !mailUser.includes('@')) {
    mailUser = mailUser + '@mail.npust.edu.tw';
    if (userEl) userEl.value = mailUser; // 回填讓使用者看到補完的完整位址
  }
  const errEl = document.getElementById('om-connect-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!mailUser || !mailPass) {
    if (errEl) { errEl.textContent = '請輸入帳號與密碼'; errEl.style.display = ''; }
    return;
  }
  _omConnecting = true;
  const btn = document.getElementById('om-connect-btn');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '連結中…'; }
  try {
    const rememberMe = document.getElementById('om-remember-me')?.checked || false;
    const r = await proxyCall('omConnect', { mailUser, mailPass, rememberMe });
    _om.connected = true;
    _om.mailUser = r.mailUser || mailUser;
    try { localStorage.setItem(_omLsKey(), _om.mailUser); } catch (_) {}
    if (passEl) passEl.value = '';
    await renderOmPage();
    showToast(r.remembered ? '信箱已連結，已記住密碼，之後自動登入' : '信箱已連結', 'success');
  } catch (e) {
    if (errEl) { errEl.textContent = _omErrMsg(e.message); errEl.style.display = ''; }
  } finally {
    _omConnecting = false;
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '連結'; }
  }
}

async function omDisconnectClick() {
  if (!confirm('確定要中斷與屏科大信箱的連結？密碼將自伺服器記憶體清除；若曾勾選「記住密碼」，也會一併刪除伺服器上已儲存的密碼。')) return;
  showLoading('中斷連結中…');
  try { await proxyCall('omDisconnect'); } catch (e) { /* 即使失敗前端仍視為已中斷，避免卡在無法離開的狀態 */ }
  hideLoading();
  _om.connected = false;
  _om.currentMsg = null;
  _om.archiveCurrentFolderId = null;
  _om.archiveViewingId = null;
  _omStopPoll();
  _omClearCache(); // v220：登出/中斷連結一律清空快取
  renderOmPage();
  showToast('已中斷信箱連結', 'success');
}

// ── 資料夾 ──────────────────────────────────
function _omFolderLabel(f) {
  return _OM_SPECIAL_NAMES[f.specialUse] || f.name;
}
function _omFindSpecialFolderPath(specialUse) {
  const f = _om.folders.find(x => x.specialUse === specialUse);
  return f ? f.path : null;
}

async function omRefreshAll() {
  await _omLoadFolders();
  await _omLoadMessages();
  await _omsvLoadFolders(); // v220：學諮伺服器資料夾側欄
}

async function _omLoadFolders() {
  let data;
  try {
    data = await _omCall('omListFolders');
  } catch (e) {
    showToast('資料夾載入失敗：' + _omErrMsg(e.message), 'error');
    return;
  }
  _om.folders = Array.isArray(data.folders) ? data.folders : [];
  _omRenderFolderTree();
  _omRenderMoveOptions();
  // v238：信箱頁自己讀到的最新 INBOX 未讀數與側邊選單徽章同步，避免兩邊數字不一致（推播每 2
  // 分鐘才跑一次，信箱頁手動重新整理/切資料夾時應立即反映）。
  const inbox = _om.folders.find(f => f.path === 'INBOX');
  if (inbox) _omSetNavBadge(inbox.unseen);
}

function _omRenderFolderTree() {
  const el = document.getElementById('om-folder-tree');
  if (!el) return;
  const sorted = [..._om.folders].sort((a, b) => {
    const aInbox = a.path === 'INBOX' || a.specialUse === '\\Inbox';
    const bInbox = b.path === 'INBOX' || b.specialUse === '\\Inbox';
    if (aInbox !== bInbox) return aInbox ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  el.innerHTML = sorted.map(f => {
    const active = f.path === _om.currentFolder;
    const label = _omFolderLabel(f);
    const unseen = f.unseen ? `<span class="badge badge-blue" style="margin-left:auto;flex-shrink:0;">${f.unseen}</span>` : '';
    const pathEsc = escHtml(f.path).replace(/'/g, "\\'");
    return `<div class="nav-item${active ? ' active' : ''}" style="padding:6px 8px;font-size:.85rem;" onclick="_omSelectFolder('${pathEsc}')"
      ondragover="if(typeof _om!=='undefined'&&_om._dragUids){event.preventDefault();this.classList.add('om-drop-hover');}"
      ondragleave="this.classList.remove('om-drop-hover')"
      ondrop="this.classList.remove('om-drop-hover');_omDropOnFolder('${pathEsc}')">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(label)}</span>${unseen}
    </div>`;
  }).join('') || '<div style="padding:10px;color:#a0aec0;font-size:.82rem;">尚無資料夾</div>';
}

function _omRenderMoveOptions() {
  const sel = document.getElementById('om-move-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">移動到…</option>' + _om.folders
    .filter(f => f.path !== _om.currentFolder)
    .map(f => `<option value="${escHtml(f.path)}">${escHtml(_omFolderLabel(f))}</option>`).join('');
}

function _omSelectFolder(path) {
  _om.currentFolder = path;
  _om.page = 1;
  _om.searchQuery = '';
  const si = document.getElementById('om-search-input'); if (si) si.value = '';
  const cb = document.getElementById('om-search-clear-btn'); if (cb) cb.style.display = 'none';
  _omCloseReadPane();
  _om.selected.clear();
  // v220：切回一般 openmail 資料夾時，若原本在檢視學諮伺服器資料夾就退出該模式
  if (_om.archiveCurrentFolderId != null) {
    _om.archiveCurrentFolderId = null;
    _omsvSetViewMode(false);
    _omsvRenderFolderTree();
  }
  _omRenderFolderTree();
  _omRenderMoveOptions();
  _omLoadMessages();
}

// ── 信件列表 ────────────────────────────────
function _omFmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) === now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
  if (sameDay) return d.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
}
function _omFmtFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}
function _omFmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function _omLoadMessages() {
  const titleEl = document.getElementById('om-list-folder-title');
  if (titleEl) {
    const f = _om.folders.find(x => x.path === _om.currentFolder);
    titleEl.textContent = _om.searchQuery ? `搜尋：「${_om.searchQuery}」` : (f ? _omFolderLabel(f) : _om.currentFolder);
  }
  const folder = _om.currentFolder, page = _om.page, pageSize = _om.pageSize;

  // v220：stale-while-revalidate——有快取先立即渲染（秒開），同時背景重新抓最新列表回來無聲更新
  // （若使用者已切走就丟棄，見 _omRevalidateMessages）。搜尋結果不快取，永遠即時查詢。
  if (!_om.searchQuery) {
    const cached = _om.cache.lists.get(_omListCacheKey(folder, page, pageSize));
    if (cached) {
      _om.messages = cached.messages;
      _om.total = cached.total;
      _om.page = cached.page;
      _om.pageSize = cached.pageSize;
      _om.selected.clear();
      _omRenderMessageList();
      _omRenderPagination();
      _omRevalidateMessages(folder, page, pageSize);
      return;
    }
  }

  const listEl = document.getElementById('om-msg-list');
  if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a0aec0;">載入中…</div>';
  try {
    const action = _om.searchQuery ? 'omSearch' : 'omListMessages';
    const params = _om.searchQuery
      ? { folder, query: _om.searchQuery, page, pageSize }
      : { folder, page, pageSize };
    const data = await _omCall(action, params);
    _om.messages = Array.isArray(data.messages) ? data.messages : [];
    _om.total = data.total || 0;
    _om.page = data.page || page;
    _om.pageSize = data.pageSize || pageSize;
    if (!_om.searchQuery) _omCacheListSet(folder, page, pageSize, data);
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#c0392b;">載入失敗：${escHtml(_omErrMsg(e.message))}</div>`;
    return;
  }
  _om.selected.clear();
  _omRenderMessageList();
  _omRenderPagination();
}

// 背景重新整理（v220）：即使畫面已經用快取秒開，仍立刻打一次 API 拿最新資料覆蓋快取；只有使用者
// 仍停留在同一個資料夾/分頁/非搜尋狀態時才更新畫面，避免「背景回應慢了一拍、使用者早已切到別的
// 資料夾，畫面卻突然被換成上一個資料夾內容」。任何失敗（含 mail_not_connected，其 UI 切換已在
// _omCall 內部處理）一律靜默，保留原本已顯示的快取內容不動。
async function _omRevalidateMessages(folder, page, pageSize) {
  let data;
  try {
    data = await _omCall('omListMessages', { folder, page, pageSize });
  } catch (e) {
    return;
  }
  _omCacheListSet(folder, page, pageSize, data);
  if (_om.searchQuery || _om.currentFolder !== folder || _om.page !== page || _om.pageSize !== pageSize) return;
  _om.messages = Array.isArray(data.messages) ? data.messages : [];
  _om.total = data.total || 0;
  _omRenderMessageList();
  _omRenderPagination();
}

function _omRenderMessageList() {
  const el = document.getElementById('om-msg-list');
  if (!el) return;
  if (!_om.messages.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#a0aec0;">沒有信件</div>';
    return;
  }
  el.innerHTML = _om.messages.map(m => {
    const fromName = m.from?.name || m.from?.address || '(未知寄件人)';
    const unread = !m.seen;
    const flagIcon = m.flagged ? '★' : '☆';
    const attIcon = m.hasAttachments ? '📎 ' : '';
    const checked = _om.selected.has(m.uid) ? 'checked' : '';
    return `<div class="om-msg-row" data-uid="${m.uid}" draggable="true" ondragstart="_omMsgDragStart(event, ${m.uid})" ondragend="_omMsgDragEnd()" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #edf2f7;cursor:pointer;${unread ? 'background:#f7fbff;' : ''}" onclick="_omOpenMessage(${m.uid})" data-tip="可拖曳到左側資料夾移動信件，或拖到學諮系統資料夾封存">
      <input type="checkbox" class="om-msg-cb" ${checked} onclick="event.stopPropagation()" onchange="_omToggleSelectOne(${m.uid}, this.checked)" style="flex-shrink:0;">
      <span onclick="event.stopPropagation();_omToggleFlag(${m.uid}, ${!!m.flagged})" style="cursor:pointer;color:${m.flagged ? '#ecc94b' : '#cbd5e0'};flex-shrink:0;font-size:1rem;">${flagIcon}</span>
      <span style="width:110px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.84rem;${unread ? 'font-weight:700;color:#1a202c;' : 'color:#4a5568;'}">${escHtml(fromName)}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem;${unread ? 'font-weight:700;color:#1a202c;' : 'color:#4a5568;'}">${attIcon}${escHtml(m.subject || '(無主旨)')}</span>
      <span style="flex-shrink:0;font-size:.76rem;color:#a0aec0;width:74px;text-align:right;">${escHtml(_omFmtDate(m.date))}</span>
    </div>`;
  }).join('');
}

function _omRenderPagination() {
  const el = document.getElementById('om-pagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(_om.total / _om.pageSize));
  el.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" onchange="_omToggleSelectAll(this.checked)"> 全選</label>
    <span style="margin-left:auto;">共 ${_om.total} 封</span>
    <button class="btn btn-secondary btn-sm" ${_om.page <= 1 ? 'disabled' : ''} onclick="_omChangePage(${_om.page - 1})">← 上一頁</button>
    <span>第 ${_om.page} / ${totalPages} 頁</span>
    <button class="btn btn-secondary btn-sm" ${_om.page >= totalPages ? 'disabled' : ''} onclick="_omChangePage(${_om.page + 1})">下一頁 →</button>
  `;
}
function _omChangePage(p) {
  const totalPages = Math.max(1, Math.ceil(_om.total / _om.pageSize));
  if (p < 1 || p > totalPages) return;
  _om.page = p;
  _omLoadMessages();
}

// ── 選取／已讀未讀／旗標／移動／刪除 ──────────
function _omToggleSelectOne(uid, checked) {
  if (checked) _om.selected.add(uid); else _om.selected.delete(uid);
}
function _omToggleSelectAll(checked) {
  _om.selected.clear();
  if (checked) _om.messages.forEach(m => _om.selected.add(m.uid));
  _omRenderMessageList();
}

async function _omToggleFlag(uid, current) {
  try {
    await _omCall('omFlag', { folder: _om.currentFolder, uid, flagged: !current });
    const m = _om.messages.find(x => x.uid === uid);
    if (m) m.flagged = !current;
    _omRenderMessageList();
  } catch (e) {
    showToast('操作失敗：' + _omErrMsg(e.message), 'error');
  }
}

async function _omMarkSelected(seen) {
  const uids = [..._om.selected];
  if (!uids.length) { showToast('請先勾選信件', 'warn'); return; }
  try {
    await _omCall('omMarkSeen', { folder: _om.currentFolder, uids, seen });
    uids.forEach(uid => { const m = _om.messages.find(x => x.uid === uid); if (m) m.seen = seen; });
    _omRenderMessageList();
    _omLoadFolders();
    showToast(`已標記 ${uids.length} 封為${seen ? '已讀' : '未讀'}`, 'success');
  } catch (e) {
    showToast('操作失敗：' + _omErrMsg(e.message), 'error');
  }
}

// v232：移動核心抽出共用（下拉選單與拖曳皆呼叫）
async function _omMoveUids(uids, toFolder) {
  if (!uids.length || !toFolder || toFolder === _om.currentFolder) return;
  try {
    await _omCall('omMove', { folder: _om.currentFolder, uids, toFolder });
    showToast(`已移動 ${uids.length} 封信件`, 'success');
    _om.selected.clear();
    if (_om.currentMsg && uids.includes(_om.currentMsg.uid)) _omCloseReadPane();
    // v220：信件已離開原資料夾，捨棄兩邊的列表快取（分頁/總數都變了）＋原資料夾內文快取
    uids.forEach(uid => _omCacheBodyDelete(_om.currentFolder, uid));
    _omCacheListInvalidateFolder(_om.currentFolder);
    _omCacheListInvalidateFolder(toFolder);
    await _omLoadFolders();
    await _omLoadMessages();
  } catch (e) {
    showToast('移動失敗：' + _omErrMsg(e.message), 'error');
  }
}

async function _omMoveSelected(sel) {
  const toFolder = sel.value;
  if (!toFolder) return;
  const uids = [..._om.selected];
  if (!uids.length) { showToast('請先勾選信件', 'warn'); sel.value = ''; return; }
  await _omMoveUids(uids, toFolder);
  sel.value = '';
}

// ══════ v232：拖曳信件到資料夾（移動）／學諮系統資料夾（封存）══════
// 拖曳中的 uid 清單：拖已勾選的列＝整批勾選一起拖；拖未勾選的列＝只拖那一封。
function _omMsgDragStart(e, uid) {
  const uids = (_om.selected.has(uid) && _om.selected.size) ? [..._om.selected] : [uid];
  _om._dragUids = uids;
  document.body.classList.add('om-dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(uid)); } catch (_) {}
}
function _omMsgDragEnd() {
  _om._dragUids = null;
  document.body.classList.remove('om-dragging');
  document.querySelectorAll('.om-drop-hover').forEach(el => el.classList.remove('om-drop-hover'));
}

function _omDropOnFolder(toFolder) {
  const uids = _om._dragUids;
  _omMsgDragEnd();
  if (!uids || !uids.length) return;
  if (toFolder === _om.currentFolder) return;
  _omMoveUids(uids, toFolder);
}

// 拖進學諮系統資料夾 → 封存。是否同時刪原信依偏好：'ask'（預設，跳詢問窗＋「不再詢問」勾選）／
// 'del'（自動刪）／'keep'（自動留）。偏好可由學諮系統資料夾標題列的 ⚙ 重新設定（需求：勾錯了要有地方改）。
function _omDragDelPrefKey() { return 'scc_om_drag_del_' + (currentUser?.email || ''); }
function _omDragDelPrefGet() {
  try { const v = localStorage.getItem(_omDragDelPrefKey()); return (v === 'del' || v === 'keep') ? v : 'ask'; } catch (_) { return 'ask'; }
}
function _omDragDelPrefSet(v) { try { localStorage.setItem(_omDragDelPrefKey(), v); } catch (_) {} }

function _omDropOnArchiveFolder(folderId, folderName) {
  const uids = _om._dragUids;
  _omMsgDragEnd();
  if (!uids || !uids.length) return;
  const items = uids.map(uid => ({ folder: _om.currentFolder, uid }));
  const pref = _omDragDelPrefGet();
  if (pref === 'del' || pref === 'keep') {
    _omsvArchiveItems(items, folderId, pref === 'del');
    return;
  }
  _omShowDragDelModal(items, folderId, folderName);
}

// 詢問視窗（drop 模式）：刪原信/保留原信＋「記住我的選擇，不再詢問」勾選
function _omShowDragDelModal(items, folderId, folderName) {
  document.getElementById('om-drag-del-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'om-drag-del-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h3>封存到「${escHtml(folderName)}」</h3></div>
      <div class="modal-body">
        <p style="font-size:.88rem;color:#4a5568;">共 ${items.length} 封信件將封存到學諮系統資料夾。封存後要如何處理屏科大信箱裡的原信？</p>
        <p style="font-size:.78rem;color:#c05621;margin-top:8px;">⚠ 學諮系統資料夾是個人工作副本：帳號停用滿 90 天後將自動刪除。屬於個案的信件請另外歸入個案紀錄，勿以封存代替。</p>
        <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:#718096;margin-top:10px;cursor:pointer;">
          <input type="checkbox" id="om-drag-del-remember"> 記住我的選擇，之後拖曳封存不再詢問（可隨時從學諮系統資料夾標題列的「⚙ 封存偏好」重新設定）
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('om-drag-del-modal').remove()">取消</button>
        <button class="btn btn-secondary" id="om-drag-keep-btn">保留原信</button>
        <button class="btn btn-primary" id="om-drag-del-btn" style="background:#c53030;border-color:#c53030;">同時刪除原信</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const go = (del) => {
    const remember = !!document.getElementById('om-drag-del-remember')?.checked;
    if (remember) _omDragDelPrefSet(del ? 'del' : 'keep');
    modal.remove();
    _omsvArchiveItems(items, folderId, del);
  };
  document.getElementById('om-drag-keep-btn').onclick = () => go(false);
  document.getElementById('om-drag-del-btn').onclick = () => go(true);
}

// 偏好修正入口（⚙）：重新選擇拖曳封存時的原信處理方式
function _omDragDelPrefPrompt() {
  const cur = _omDragDelPrefGet();
  const labels = { ask: '每次詢問', del: '自動刪除原信', keep: '自動保留原信' };
  document.getElementById('om-drag-del-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'om-drag-del-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><h3>拖曳封存偏好</h3></div>
      <div class="modal-body">
        <p style="font-size:.86rem;color:#4a5568;margin-bottom:10px;">把信件拖進學諮系統資料夾封存時，屏科大信箱的原信要如何處理？（目前：${labels[cur]}）</p>
        ${['ask', 'keep', 'del'].map(v => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;font-size:.88rem;">
            <input type="radio" name="om-drag-pref" value="${v}" ${cur === v ? 'checked' : ''}> ${labels[v]}
          </label>`).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('om-drag-del-modal').remove()">取消</button>
        <button class="btn btn-primary" id="om-drag-pref-save-btn">儲存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('om-drag-pref-save-btn').onclick = () => {
    const v = modal.querySelector('input[name="om-drag-pref"]:checked')?.value || 'ask';
    _omDragDelPrefSet(v);
    modal.remove();
    showToast('已更新拖曳封存偏好', 'success');
  };
}

async function _omDeleteSelected() {
  const uids = [..._om.selected];
  if (!uids.length) { showToast('請先勾選信件', 'warn'); return; }
  if (!confirm(`確定要刪除選取的 ${uids.length} 封信件？`)) return;
  try {
    await _omCall('omDelete', { folder: _om.currentFolder, uids });
    showToast(`已刪除 ${uids.length} 封信件`, 'success');
    _om.selected.clear();
    if (_om.currentMsg && uids.includes(_om.currentMsg.uid)) _omCloseReadPane();
    _omInvalidateAfterDelete(_om.currentFolder, uids);
    await _omLoadFolders();
    await _omLoadMessages();
  } catch (e) {
    showToast('刪除失敗：' + _omErrMsg(e.message), 'error');
  }
}
async function _omDeleteCurrent() {
  if (!_om.currentMsg) return;
  if (!confirm('確定要刪除這封信件？')) return;
  try {
    const uid = _om.currentMsg.uid;
    await _omCall('omDelete', { folder: _om.currentFolder, uids: [uid] });
    showToast('已刪除信件', 'success');
    _omCloseReadPane();
    _omInvalidateAfterDelete(_om.currentFolder, [uid]);
    await _omLoadFolders();
    await _omLoadMessages();
  } catch (e) {
    showToast('刪除失敗：' + _omErrMsg(e.message), 'error');
  }
}
// v220：omDelete 實際上是「移到垃圾桶」（見 openmail/actions.js omDelete，沒有 \Trash 才真刪除），
// 兩邊列表快取（分頁/總數皆變）都要作廢，並丟棄已刪信件的內文快取。
function _omInvalidateAfterDelete(folder, uids) {
  uids.forEach(uid => _omCacheBodyDelete(folder, uid));
  _omCacheListInvalidateFolder(folder);
  const trashPath = _omFindSpecialFolderPath('\\Trash');
  if (trashPath && trashPath !== folder) _omCacheListInvalidateFolder(trashPath);
}

// ── 搜尋 ────────────────────────────────────
function _omSearchSubmit() {
  const val = (document.getElementById('om-search-input')?.value || '').trim();
  if (!val) { _omSearchClear(); return; }
  _om.searchQuery = val;
  _om.page = 1;
  const cb = document.getElementById('om-search-clear-btn'); if (cb) cb.style.display = '';
  _omLoadMessages();
}
function _omSearchClear() {
  _om.searchQuery = '';
  _om.page = 1;
  const si = document.getElementById('om-search-input'); if (si) si.value = '';
  const cb = document.getElementById('om-search-clear-btn'); if (cb) cb.style.display = 'none';
  _omLoadMessages();
}

// ── 閱讀窗 ──────────────────────────────────
function _omAddrList(list) {
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}
function _omFmtAddr(a) {
  if (!a) return '';
  return a.name ? `${a.name} <${a.address}>` : (a.address || '');
}

async function _omOpenMessage(uid) {
  const pane = document.getElementById('om-read-pane');
  if (pane) pane.style.display = 'flex';
  _om.archiveViewingId = null; // v220：進入一般信箱閱讀模式（非學諮資料夾封存信）
  const folder = _om.currentFolder;

  // v220：已看過的信直接用快取內文即開（IMAP 信件內容不可變，不需要背景重抓）——秒開，不打 API。
  const cached = _omCacheBodyGet(folder, uid);
  if (cached) {
    _om.currentMsg = cached;
    const li0 = _om.messages.find(x => x.uid === uid);
    if (li0) li0.seen = true;
    _omRenderMessageList();
    _omRenderReadPane(cached);
    _omsvRenderReadFooter();
    return;
  }

  const headerEl = document.getElementById('om-read-header');
  if (headerEl) headerEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a0aec0;">載入中…</div>';
  let msg;
  try {
    msg = await _omCall('omGetMessage', { folder, uid });
  } catch (e) {
    showToast('讀取信件失敗：' + _omErrMsg(e.message), 'error');
    return;
  }
  _omCacheBodySet(folder, uid, msg);
  _om.currentMsg = msg;
  // omGetMessage 慣例上會順帶標已讀，前端同步列表狀態（不額外呼叫 omMarkSeen）
  const li = _om.messages.find(x => x.uid === uid);
  if (li) li.seen = true;
  _omRenderMessageList();
  _omRenderReadPane(msg);
  _omsvRenderReadFooter();
}

function _omRenderReadPane(msg) {
  const headerEl = document.getElementById('om-read-header');
  if (headerEl) {
    const to = _omAddrList(msg.to).map(_omFmtAddr).join(', ');
    const cc = _omAddrList(msg.cc).map(_omFmtAddr).join(', ');
    headerEl.innerHTML = `
      <div style="font-size:1rem;font-weight:700;color:#1a202c;margin-bottom:6px;word-break:break-word;">${escHtml(msg.subject || '(無主旨)')}</div>
      <div style="font-size:.82rem;color:#4a5568;line-height:1.7;">
        <div><strong>寄件人：</strong>${escHtml(_omFmtAddr(msg.from))}</div>
        <div><strong>收件人：</strong>${escHtml(to)}</div>
        ${cc ? `<div><strong>副本：</strong>${escHtml(cc)}</div>` : ''}
        <div><strong>時間：</strong>${escHtml(_omFmtFullDate(msg.date))}</div>
      </div>`;
  }
  const blockedEl = document.getElementById('om-read-blocked-images');
  if (blockedEl) {
    if (msg.blockedRemoteImages > 0) {
      blockedEl.style.display = '';
      blockedEl.innerHTML = `已封鎖 ${msg.blockedRemoteImages} 張遠端圖片 <button class="btn btn-secondary btn-sm" style="margin-left:8px;" onclick="_omLoadBlockedImages()">載入圖片</button>`;
    } else {
      blockedEl.style.display = 'none';
      blockedEl.innerHTML = '';
    }
  }
  const iframe = document.getElementById('om-read-iframe');
  if (iframe) {
    const bodyHtml = msg.html || `<pre style="white-space:pre-wrap;font-family:inherit;">${escHtml(msg.text || '')}</pre>`;
    const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,"Segoe UI",Arial,sans-serif;font-size:14px;color:#1a202c;line-height:1.6;margin:12px;word-break:break-word;}img{max-width:100%;height:auto;}</style></head><body>${bodyHtml}</body></html>`;
    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        iframe.style.height = Math.min(Math.max(doc.body.scrollHeight + 24, 120), 2000) + 'px';
        // sandbox 未給 allow-scripts/allow-popups，連結一律由 parent 攔截後在新分頁開啟
        doc.querySelectorAll('a[href]').forEach(a => {
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            const href = a.getAttribute('href');
            if (href && /^https?:/i.test(href)) window.open(href, '_blank', 'noopener');
          });
        });
      } catch (_) {}
    };
    iframe.srcdoc = srcdoc;
  }
  const attEl = document.getElementById('om-read-attachments');
  if (attEl) {
    const atts = Array.isArray(msg.attachments) ? msg.attachments.filter(a => !a.inline) : [];
    if (atts.length) {
      attEl.style.display = '';
      attEl.innerHTML = '<strong>附件：</strong>' + atts.map(a =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:3px 8px;margin:2px 4px 2px 0;cursor:pointer;" onclick="_omDownloadAttachment(${a.index}, '${escHtml(a.filename).replace(/'/g, "\\'")}')">
          📎 ${escHtml(a.filename)} <span style="color:#a0aec0;">(${_omFmtSize(a.size)})</span>
        </span>`).join('');
    } else {
      attEl.style.display = 'none';
      attEl.innerHTML = '';
    }
  }
}

function _omCloseReadPane() {
  _om.currentMsg = null;
  _om.archiveViewingId = null;
  const pane = document.getElementById('om-read-pane');
  if (pane) pane.style.display = 'none';
  const iframe = document.getElementById('om-read-iframe');
  if (iframe) iframe.srcdoc = '';
}

function _omLoadBlockedImages() {
  const iframe = document.getElementById('om-read-iframe');
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    doc.querySelectorAll('[data-om-src]').forEach(elm => {
      elm.setAttribute('src', elm.getAttribute('data-om-src'));
      elm.removeAttribute('data-om-src');
    });
  } catch (_) {}
  const blockedEl = document.getElementById('om-read-blocked-images');
  if (blockedEl) blockedEl.style.display = 'none';
}

async function _omDownloadAttachment(index, filename) {
  if (!_om.currentMsg) return;
  showLoading('下載附件中…');
  try {
    // v220：閱讀窗目前顯示的是學諮伺服器資料夾封存信時，附件要從封存的 source 解析下載
    // （omsvDownloadAttachment），不是即時 IMAP（沒有 folder/uid 可用）。
    const r = _om.archiveViewingId != null
      ? await proxyCall('omsvDownloadAttachment', { id: _om.archiveViewingId, index })
      : await _omCall('omDownloadAttachment', { folder: _om.currentFolder, uid: _om.currentMsg.uid, index });
    _omSaveBase64File(r.base64, r.contentType || 'application/octet-stream', r.filename || filename);
  } catch (e) {
    showToast('下載失敗：' + _omErrMsg(e.message), 'error');
  } finally {
    hideLoading();
  }
}
function _omSaveBase64File(base64, mimeType, filename) {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'attachment';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── 撰寫視窗（寫信/回覆/回覆全部/轉寄） ────────
function _omToggleCcBcc() {
  const wrap = document.getElementById('om-cc-bcc-wrap');
  if (!wrap) return;
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

function _omQuoteBlock(refMsg) {
  const header = `寄件人：${escHtml(_omFmtAddr(refMsg.from))}<br>時間：${escHtml(_omFmtFullDate(refMsg.date))}<br>主旨：${escHtml(refMsg.subject || '')}`;
  const body = refMsg.html || escHtml(refMsg.text || '').replace(/\n/g, '<br>');
  return `<br><br><div>--- 原始郵件 ---</div><div style="color:#718096;font-size:.85em;">${header}</div><blockquote style="border-left:2px solid #cbd5e0;margin:8px 0 0;padding-left:10px;color:#4a5568;">${body}</blockquote>`;
}

// v247：寫信草稿備援。key 刻意不用 scc_draft_ 前綴，避免被 _migrateLocalStorageDrafts() 掃到
// 誤產生一筆待辦事項——寫信草稿走「重開撰寫視窗時本機偵測詢問還原」，比照家系圖 _genoDraftKey() 的做法，
// 不適合走 todo 清單（附件無法還原，語意跟一般表單草稿不同）。
function _omComposeDraftKey() {
  return `scc_om_compose_draft_${currentUser?.email || ''}`;
}
// 不含附件（base64 太大，_gdStartAutosave 有 200KB 上限，附件需寄出前重新附加）。
function _omComposeSnapshot() {
  return {
    to: document.getElementById('om-compose-to')?.value || '',
    cc: document.getElementById('om-compose-cc')?.value || '',
    bcc: document.getElementById('om-compose-bcc')?.value || '',
    subject: document.getElementById('om-compose-subject')?.value || '',
    bodyHtml: getRichTextValue('om-compose-body'),
  };
}

function openOmCompose(mode, refMsgOverride) {
  const refMsg = refMsgOverride || _om.currentMsg;
  if ((mode === 'reply' || mode === 'replyAll' || mode === 'fwd') && !refMsg) return;
  _om.composeMode = mode || null;
  _om.composeRefMsg = (mode && refMsg) ? refMsg : null;
  _om.composeAttachments = [];
  document.getElementById('om-compose-to').value = '';
  document.getElementById('om-compose-cc').value = '';
  document.getElementById('om-compose-bcc').value = '';
  document.getElementById('om-compose-subject').value = '';
  document.getElementById('om-cc-bcc-wrap').style.display = 'none';
  setRichTextValue('om-compose-body', '');
  _omRenderComposeAttachList();

  const titleEl = document.getElementById('om-compose-title');
  if (mode === 'reply' || mode === 'replyAll') {
    if (titleEl) titleEl.textContent = mode === 'reply' ? '回覆' : '回覆全部';
    document.getElementById('om-compose-to').value = _omFmtAddr(refMsg.from);
    if (mode === 'replyAll') {
      const myEmail = (_om.mailUser || '').toLowerCase();
      const fromAddr = (refMsg.from?.address || '').toLowerCase();
      const ccList = [..._omAddrList(refMsg.to), ..._omAddrList(refMsg.cc)]
        .filter(a => a.address && a.address.toLowerCase() !== myEmail && a.address.toLowerCase() !== fromAddr);
      if (ccList.length) {
        document.getElementById('om-cc-bcc-wrap').style.display = '';
        document.getElementById('om-compose-cc').value = ccList.map(_omFmtAddr).join(', ');
      }
    }
    document.getElementById('om-compose-subject').value = /^re:/i.test(refMsg.subject || '') ? refMsg.subject : `Re: ${refMsg.subject || ''}`;
    setRichTextValue('om-compose-body', _omQuoteBlock(refMsg));
  } else if (mode === 'fwd') {
    if (titleEl) titleEl.textContent = '轉寄';
    document.getElementById('om-compose-subject').value = /^fwd:/i.test(refMsg.subject || '') ? refMsg.subject : `Fwd: ${refMsg.subject || ''}`;
    setRichTextValue('om-compose-body', _omQuoteBlock(refMsg));
    _omLoadForwardAttachments(refMsg);
  } else {
    if (titleEl) titleEl.textContent = '寫信';
  }
  // v247：欄位填完初始值後，偵測本機是否有殘留的寫信草稿，詢問是否還原
  const _omKey = _omComposeDraftKey();
  try {
    const _omRaw = localStorage.getItem(_omKey);
    if (_omRaw) {
      const _omDraft = JSON.parse(_omRaw);
      if (_omDraft && typeof _omDraft === 'object') {
        if (confirm('偵測到上次未寄出的信件草稿（可能因頁面重新整理而保留）。\n\n是否還原草稿內容？（會覆蓋目前帶入的內容；附件無法還原，需重新附加）\n選擇「取消」則捨棄草稿。')) {
          document.getElementById('om-compose-to').value = _omDraft.to || '';
          document.getElementById('om-compose-cc').value = _omDraft.cc || '';
          document.getElementById('om-compose-bcc').value = _omDraft.bcc || '';
          document.getElementById('om-compose-subject').value = _omDraft.subject || '';
          setRichTextValue('om-compose-body', _omDraft.bodyHtml || '');
          if (_omDraft.cc || _omDraft.bcc) document.getElementById('om-cc-bcc-wrap').style.display = '';
        } else {
          try { localStorage.removeItem(_omKey); } catch (_) {}
        }
      }
    }
  } catch (_) {}
  _gdSetBaseline('omCompose', _omComposeSnapshot());
  _gdStartAutosave('omCompose', _omKey, _omComposeSnapshot, '_om-compose-draft-status');
  document.getElementById('om-compose-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('om-compose-to').focus(), 50);
}

async function _omLoadForwardAttachments(refMsg) {
  const atts = Array.isArray(refMsg.attachments) ? refMsg.attachments.filter(a => !a.inline) : [];
  if (!atts.length) return;
  const progEl = document.getElementById('om-compose-fwd-progress');
  if (progEl) progEl.style.display = '';
  for (let i = 0; i < atts.length; i++) {
    const a = atts[i];
    if (progEl) progEl.textContent = `正在附加原附件 ${i + 1}/${atts.length}：${a.filename}`;
    try {
      const r = await _omCall('omDownloadAttachment', { folder: _om.currentFolder, uid: refMsg.uid, index: a.index });
      _om.composeAttachments.push({ filename: r.filename || a.filename, contentType: r.contentType || a.contentType, base64: r.base64, size: a.size || 0 });
      _omRenderComposeAttachList();
    } catch (e) {
      showToast(`附件「${a.filename}」附加失敗：` + _omErrMsg(e.message), 'error');
    }
  }
  if (progEl) { progEl.style.display = 'none'; progEl.textContent = ''; }
}

async function _omAttachFilesSelected(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  for (const file of files) {
    try {
      // v212：Office 家族附件先偵測是否密碼加密，加密則詢問解鎖／原樣上傳／取消；
      // 取消時略過本檔繼續處理下一檔，不中斷整批（見 _attachMaybeUnlockOfficeFile）。
      const resolved = await _attachMaybeUnlockOfficeFile(file);
      if (!resolved) continue;
      const base64 = await _blobToBase64(resolved); // 共用附件子系統既有的 blob→base64 helper
      _om.composeAttachments.push({ filename: resolved.name, contentType: resolved.type || file.type || 'application/octet-stream', base64, size: resolved.size });
    } catch (e) {
      showToast(`附件「${file.name}」讀取失敗`, 'error');
    }
  }
  _omRenderComposeAttachList();
}

function _omRenderComposeAttachList() {
  const listEl = document.getElementById('om-compose-attach-list');
  const sizeEl = document.getElementById('om-compose-attach-size');
  const total = _om.composeAttachments.reduce((s, a) => s + (a.size || 0), 0);
  const overLimit = total > OM_MAX_ATTACH_BYTES;
  if (sizeEl) {
    sizeEl.textContent = _om.composeAttachments.length
      ? `共 ${_om.composeAttachments.length} 個附件，總計 ${_omFmtSize(total)}${overLimit ? '（超過 50MB 上限）' : ''}`
      : '';
    sizeEl.style.color = overLimit ? '#c0392b' : '#718096';
  }
  if (!listEl) return;
  listEl.innerHTML = _om.composeAttachments.map((a, idx) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:.82rem;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📎 ${escHtml(a.filename)}</span>
      <span style="color:#a0aec0;flex-shrink:0;">${_omFmtSize(a.size)}</span>
      <button type="button" class="btn btn-secondary btn-sm" style="padding:1px 6px;" onclick="_omRemoveComposeAttachment(${idx})">✕</button>
    </div>`).join('');
}
function _omRemoveComposeAttachment(idx) {
  _om.composeAttachments.splice(idx, 1);
  _omRenderComposeAttachList();
}
function _omCloseCompose() {
  // v247：關閉（取消）不清草稿——誤關可還原，重開時偵測詢問、拒絕才清（見 openOmCompose）
  _gdStopAutosave('omCompose');
  document.getElementById('om-compose-modal').style.display = 'none';
}

let _omSending = false;
async function omSendSubmit() {
  if (_omSending) return;
  const to = (document.getElementById('om-compose-to').value || '').trim();
  const cc = (document.getElementById('om-compose-cc').value || '').trim();
  const bcc = (document.getElementById('om-compose-bcc').value || '').trim();
  const subject = (document.getElementById('om-compose-subject').value || '').trim();
  const html = getRichTextValue('om-compose-body');
  if (!to) { alert('請輸入收件人'); return; }
  const totalSize = _om.composeAttachments.reduce((s, a) => s + (a.size || 0), 0);
  if (totalSize > OM_MAX_ATTACH_BYTES) { alert('附件總容量超過 50MB 上限，請移除部分附件後再試'); return; }
  _omSending = true;
  const btn = document.getElementById('om-compose-send-btn');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '寄出中…'; }
  showLoading('寄出中…');
  // v231：params 提到 try 外——寄送失敗（連線類）時要原封不動存進寄件匣
  const params = {
    to: to.split(',').map(s => s.trim()).filter(Boolean),
    cc: cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : [],
    bcc: bcc ? bcc.split(',').map(s => s.trim()).filter(Boolean) : [],
    subject,
    html,
    text: _stripHtmlToText(html),
    attachments: _om.composeAttachments.map(a => ({ filename: a.filename, contentType: a.contentType, base64: a.base64 })),
  };
  if (_om.composeMode && _om.composeRefMsg) {
    const ref = _om.composeRefMsg;
    const refs = Array.isArray(ref.references) ? ref.references.slice() : (ref.references ? [ref.references] : []);
    if (ref.messageId) { params.inReplyTo = ref.messageId; refs.push(ref.messageId); }
    if (refs.length) params.references = refs;
  }
  try {
    await _omCall('omSend', params);
    // v247：寄出成功，草稿已無留存必要
    try { localStorage.removeItem(_omComposeDraftKey()); } catch (_) {}
    _omCloseCompose();
    showToast('已寄出信件', 'success');
    // v220：寄出信件會 best-effort 備份一份到 \Sent（見 openmail/actions.js omSend），該資料夾的
    // 列表快取已過期，作廢讓下次切過去時重抓。
    const sentPath = _omFindSpecialFolderPath('\\Sent');
    if (sentPath) _omCacheListInvalidateFolder(sentPath);
    if (!_om.searchQuery) _omLoadMessages();
  } catch (e) {
    // v231：連線類失敗 → 提議存入寄件匣（連線恢復後自動寄出）；其他錯誤照舊提示
    if (_omIsConnErr(e.message)) {
      if (confirm('寄送失敗（信箱連線問題）：' + _omErrMsg(e.message) + '\n\n要把這封信存入「寄件匣」嗎？連線恢復後會自動寄出（也可在信箱頁手動立即寄出）。')) {
        if (_omQueueOutbox(params)) {
          // v247：已妥善存入寄件匣，草稿已無留存必要
          try { localStorage.removeItem(_omComposeDraftKey()); } catch (_) {}
          _omCloseCompose();
          showToast('已存入寄件匣，連線恢復後會自動寄出', 'info');
        }
      }
    } else {
      alert('寄送失敗：' + _omErrMsg(e.message));
    }
  } finally {
    hideLoading();
    _omSending = false;
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '寄出'; }
  }
}

// v238：側邊選單信箱未讀徽章。unseen<=0 隱藏；>99 顯示 99+。
function _omSetNavBadge(unseen) {
  const el = document.getElementById('nav-om-badge');
  if (!el) return;
  const n = Number(unseen) || 0;
  if (n <= 0) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = n > 99 ? '99+' : String(n);
  el.style.display = '';
}

// ── 輪詢（僅信箱頁開著時，每 2 分鐘刷新未讀數；離開頁面由 showPage 呼叫 _omStopPoll） ──
function _omStartPoll() {
  if (_om.pollTimer) return;
  _om.pollTimer = setInterval(() => {
    if (_om.connected && document.getElementById('page-om')?.classList.contains('active')) {
      _omLoadFolders();
    }
  }, 120000);
}
function _omStopPoll() {
  if (_om.pollTimer) { clearInterval(_om.pollTimer); _om.pollTimer = null; }
}

// ══════════════════════════════════════════════
//  v220：學諮伺服器資料夾（信件封存到本系統 sqlite，不佔 openmail 信箱空間）
//  後端 action：omsvFolderList/Create/Rename/Delete、omsvArchiveMessage、omsvList/Get/
//  DownloadAttachment/Delete（見 server/src/openmail/archive.js）。
// ══════════════════════════════════════════════

// ── 資料夾側欄 ──────────────────────────────
async function _omsvLoadFolders() {
  try {
    const data = await proxyCall('omsvFolderList');
    _om.archiveFolders = Array.isArray(data.folders) ? data.folders : [];
  } catch (e) {
    _om.archiveFolders = [];
  }
  _omsvRenderFolderTree();
}

// v234：學諮系統資料夾樹狀階層（子資料夾，最多三層，見 server/openmail/archive.js
// MAX_FOLDER_DEPTH）。收合狀態存 localStorage（比照 _omDragDelPrefKey 寫法，key 帶當前登入
// email，換帳號不會互相汙染）。
function _omsvCollapsedKey() { return 'scc_omsv_collapsed_' + (currentUser?.email || ''); }
function _omsvCollapsedGet() {
  try {
    const v = JSON.parse(localStorage.getItem(_omsvCollapsedKey()) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch (_) { return new Set(); }
}
function _omsvCollapsedSet(set) {
  try { localStorage.setItem(_omsvCollapsedKey(), JSON.stringify([...set])); } catch (_) {}
}
function _omsvToggleCollapse(id) {
  const set = _omsvCollapsedGet();
  if (set.has(id)) set.delete(id); else set.add(id);
  _omsvCollapsedSet(set);
  _omsvRenderFolderTree();
}

const OMSV_MAX_FOLDER_DEPTH = 3; // 對映 server 的 archive.js MAX_FOLDER_DEPTH（根層＝第 1 層）

function _omsvRenderFolderTree() {
  const el = document.getElementById('omsv-folder-tree');
  if (!el) return;
  if (!_om.archiveFolders.length) {
    el.innerHTML = '<div style="padding:8px;color:#a0aec0;font-size:.74rem;">尚無資料夾</div>';
    return;
  }
  // 以 parentId 建 children map。parentId 指向不存在的 id（理論上不該發生的髒資料）一律當根層
  // 處理，避免那個資料夾整個從畫面上消失、也避免遞迴時試圖走進不存在的節點。
  const byId = new Map(_om.archiveFolders.map(f => [f.id, f]));
  const childrenOf = new Map();
  _om.archiveFolders.forEach(f => {
    const pid = (f.parentId != null && byId.has(f.parentId)) ? f.parentId : null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(f);
  });
  childrenOf.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')));

  const collapsed = _omsvCollapsedGet();
  const rows = [];
  // seen 防禦：理論上不該有循環（server 端 omsvFolderMove 會擋），但遞迴渲染仍不吃任何已經
  // 渲染過的 id，避免任何理論上的髒資料造成無窮迴圈。
  const visit = (list, depth, seen) => {
    for (const f of list) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const kids = childrenOf.get(f.id) || [];
      const hasKids = kids.length > 0;
      const isCollapsed = collapsed.has(f.id);
      const active = _om.archiveCurrentFolderId === f.id;
      const nameEsc = escHtml(f.name).replace(/'/g, "\\'");
      const indent = 4 + depth * 14;
      const toggle = hasKids
        ? `<span style="cursor:pointer;flex-shrink:0;width:14px;text-align:center;color:#718096;" onclick="event.stopPropagation();_omsvToggleCollapse(${f.id})">${isCollapsed ? '▸' : '▾'}</span>`
        : `<span style="flex-shrink:0;width:14px;"></span>`;
      const addBtn = depth < OMSV_MAX_FOLDER_DEPTH - 1
        ? `<span style="cursor:pointer;flex-shrink:0;" title="新增子資料夾" onclick="event.stopPropagation();_omsvCreateFolderPrompt(${f.id})">＋</span>`
        : '';
      rows.push(`<div class="nav-item${active ? ' active' : ''}" draggable="true"
        style="padding:5px 8px 5px ${indent}px;font-size:.85rem;display:flex;align-items:center;gap:4px;"
        ondragstart="_omsvFolderDragStart(event, ${f.id})"
        ondragend="_omsvFolderDragEnd()"
        ondragover="if(typeof _om!=='undefined'&&(_om._dragUids||_om._dragFolderId)){event.preventDefault();this.classList.add('om-drop-hover');}"
        ondragleave="this.classList.remove('om-drop-hover')"
        ondrop="this.classList.remove('om-drop-hover');_omsvHandleDrop(${f.id}, '${nameEsc}')">
        ${toggle}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="_omsvSelectFolder(${f.id})">📦 ${escHtml(f.name)}</span>
        <span style="color:#a0aec0;flex-shrink:0;font-size:.7rem;">${f.messageCount}</span>
        ${addBtn}
        <span style="cursor:pointer;flex-shrink:0;" title="重新命名" onclick="event.stopPropagation();_omsvRenameFolderPrompt(${f.id}, '${nameEsc}')">✎</span>
        <span style="cursor:pointer;flex-shrink:0;" title="刪除" onclick="event.stopPropagation();_omsvDeleteFolderClick(${f.id})">🗑</span>
      </div>`);
      if (hasKids && !isCollapsed) visit(kids, depth + 1, seen);
    }
  };
  visit(childrenOf.get(null) || [], 0, new Set());
  el.innerHTML = rows.join('');
}

// v234：資料夾列的 drop 統一入口——拖的是資料夾（_om._dragFolderId 有值）就改階層，
// 否則沿用既有的信件封存流程（_omDropOnArchiveFolder）。拖到自己身上直接忽略。
function _omsvHandleDrop(targetId, targetName) {
  if (typeof _om !== 'undefined' && _om._dragFolderId != null) {
    const dragId = _om._dragFolderId;
    _omsvFolderDragEnd();
    if (dragId === targetId) return;
    _omsvMoveFolder(dragId, targetId);
    return;
  }
  _omDropOnArchiveFolder(targetId, targetName);
}

// 拖到「學諮系統資料夾」標題列＝移回根層；只在拖的是資料夾時才有反應（見標題列 ondrop）。
function _omsvDropOnRoot() {
  if (typeof _om === 'undefined' || _om._dragFolderId == null) return;
  const dragId = _om._dragFolderId;
  _omsvFolderDragEnd();
  _omsvMoveFolder(dragId, null);
}

function _omsvFolderDragStart(e, id) {
  _om._dragFolderId = id;
  document.body.classList.add('om-dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'omsv-folder:' + id); } catch (_) {}
}
function _omsvFolderDragEnd() {
  _om._dragFolderId = null;
  document.body.classList.remove('om-dragging');
  document.querySelectorAll('.om-drop-hover').forEach(el => el.classList.remove('om-drop-hover'));
}

async function _omsvMoveFolder(folderId, parentId) {
  try {
    await proxyCall('omsvFolderMove', { folderId, parentId });
    showToast('已移動資料夾', 'success');
    await _omsvLoadFolders();
  } catch (e) {
    showToast('移動失敗：' + _omErrMsg(e.message), 'error');
  }
}

async function _omsvCreateFolderPrompt(parentId) {
  const name = prompt('新資料夾名稱：');
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await proxyCall('omsvFolderCreate', parentId != null ? { name: trimmed, parentId } : { name: trimmed });
    showToast('已建立資料夾', 'success');
    await _omsvLoadFolders();
  } catch (e) {
    showToast('建立失敗：' + _omErrMsg(e.message), 'error');
  }
}

async function _omsvRenameFolderPrompt(folderId, oldName) {
  const name = prompt('新名稱：', oldName);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === oldName) return;
  try {
    await proxyCall('omsvFolderRename', { folderId, name: trimmed });
    showToast('已更名', 'success');
    await _omsvLoadFolders();
  } catch (e) {
    showToast('更名失敗：' + _omErrMsg(e.message), 'error');
  }
}

async function _omsvDeleteFolderClick(folderId) {
  if (!confirm('確定要刪除這個資料夾？（資料夾內還有信件或子資料夾時無法刪除，請先清空）')) return;
  try {
    await proxyCall('omsvFolderDelete', { folderId });
    showToast('已刪除資料夾', 'success');
    if (_om.archiveCurrentFolderId === folderId) _omsvBackToMailbox();
    await _omsvLoadFolders();
  } catch (e) {
    showToast('刪除失敗：' + _omErrMsg(e.message), 'error');
  }
}

// ── 中間清單：一般信箱 / 學諮資料夾 互斥顯示 ──
function _omsvSetViewMode(showArchive) {
  const mailPane = document.getElementById('om-list-pane');
  const archivePane = document.getElementById('omsv-list-pane');
  if (mailPane) mailPane.style.display = showArchive ? 'none' : 'flex';
  if (archivePane) archivePane.style.display = showArchive ? 'flex' : 'none';
}

async function _omsvSelectFolder(folderId) {
  _om.archiveCurrentFolderId = folderId;
  _omCloseReadPane();
  _omsvSetViewMode(true);
  _omsvRenderFolderTree();
  await _omsvLoadMessages();
}

function _omsvBackToMailbox() {
  _om.archiveCurrentFolderId = null;
  _omCloseReadPane();
  _omsvSetViewMode(false);
  _omsvRenderFolderTree();
}

async function _omsvLoadMessages() {
  const listEl = document.getElementById('omsv-msg-list');
  const titleEl = document.getElementById('omsv-list-folder-title');
  const folder = _om.archiveFolders.find(f => f.id === _om.archiveCurrentFolderId);
  if (titleEl) titleEl.textContent = folder ? `📦 ${folder.name}` : '學諮伺服器資料夾';
  if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a0aec0;">載入中…</div>';
  let data;
  try {
    data = await proxyCall('omsvList', { folderId: _om.archiveCurrentFolderId });
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#c0392b;">載入失敗：${escHtml(_omErrMsg(e.message))}</div>`;
    return;
  }
  _om.archiveMessages = Array.isArray(data.messages) ? data.messages : [];
  _omsvRenderMessageList();
}

function _omsvRenderMessageList() {
  const el = document.getElementById('omsv-msg-list');
  if (!el) return;
  if (!_om.archiveMessages.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#a0aec0;">沒有信件</div>';
    return;
  }
  el.innerHTML = _om.archiveMessages.map(m => `
    <div class="om-msg-row" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #edf2f7;cursor:pointer;" onclick="_omsvOpenMessage(${m.id})">
      <span style="width:130px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.84rem;color:#4a5568;">${escHtml(m.from || '(未知寄件人)')}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem;color:#4a5568;">${escHtml(m.subject || '(無主旨)')}</span>
      <span style="flex-shrink:0;font-size:.76rem;color:#a0aec0;width:70px;text-align:right;">${escHtml(_omFmtDate(m.date))}</span>
      <span style="cursor:pointer;flex-shrink:0;color:#c0392b;" title="刪除" onclick="event.stopPropagation();_omsvDeleteMessageClick(${m.id})">🗑</span>
    </div>`).join('');
}

async function _omsvOpenMessage(id) {
  const pane = document.getElementById('om-read-pane');
  if (pane) pane.style.display = 'flex';
  _om.archiveViewingId = id;
  const headerEl = document.getElementById('om-read-header');
  if (headerEl) headerEl.innerHTML = '<div style="padding:20px;text-align:center;color:#a0aec0;">載入中…</div>';
  let msg;
  try {
    msg = await proxyCall('omsvGet', { id });
  } catch (e) {
    showToast('讀取信件失敗：' + _omErrMsg(e.message), 'error');
    return;
  }
  _om.currentMsg = msg;
  _omRenderReadPane(msg);
  _omsvRenderReadFooter();
}

async function _omsvDeleteMessageClick(id) {
  if (!confirm('確定要刪除這封已封存的信件？此動作無法復原。')) return;
  try {
    await proxyCall('omsvDelete', { id });
    showToast('已刪除', 'success');
    if (_om.archiveViewingId === id) _omCloseReadPane();
    await _omsvLoadMessages();
    await _omsvLoadFolders(); // 更新側欄計數
  } catch (e) {
    showToast('刪除失敗：' + _omErrMsg(e.message), 'error');
  }
}

// 閱讀窗底部按鈕：一般信箱信件（回覆/回覆全部/轉寄/封存/刪除）與學諮資料夾封存信（刪除/關閉）
// 動作不同，共用同一組 DOM（#om-read-footer），依 _om.archiveViewingId 切換內容。
function _omsvRenderReadFooter() {
  const el = document.getElementById('om-read-footer');
  if (!el) return;
  if (_om.archiveViewingId != null) {
    el.innerHTML = `
      <button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="_omsvDeleteMessageClick(${_om.archiveViewingId})">🗑 刪除</button>
      <button class="btn btn-secondary btn-sm" onclick="_omCloseReadPane()">✕ 關閉</button>`;
  } else {
    el.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="openOmCompose('reply')">↩ 回覆</button>
      <button class="btn btn-secondary btn-sm" onclick="openOmCompose('replyAll')">↩↩ 回覆全部</button>
      <button class="btn btn-secondary btn-sm" onclick="openOmCompose('fwd')">➔ 轉寄</button>
      <button class="btn btn-secondary btn-sm" onclick="_omArchiveCurrentClick()">📦 封存到學諮資料夾</button>
      <button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="_omDeleteCurrent()">🗑 刪除</button>
      <button class="btn btn-secondary btn-sm" onclick="_omCloseReadPane()">✕ 關閉</button>`;
  }
}

// ── 封存到學諮資料夾（modal：選目標資料夾＋是否同時從 openmail 刪除原信） ──
function _omOpenArchiveModal(items) {
  if (!items.length) { showToast('請先勾選信件', 'warn'); return; }
  if (!_om.archiveFolders.length) { showToast('尚無學諮伺服器資料夾，請先在左側「＋ 新增資料夾」建立一個', 'warn'); return; }
  _om.archivePending = items;
  const countEl = document.getElementById('omsv-archive-modal-count');
  if (countEl) countEl.textContent = `共 ${items.length} 封信件`;
  const sel = document.getElementById('omsv-archive-target-select');
  if (sel) sel.innerHTML = _om.archiveFolders.map(f => `<option value="${f.id}">${escHtml(f.name)}</option>`).join('');
  const cb = document.getElementById('omsv-archive-delete-checkbox');
  if (cb) cb.checked = false;
  const modal = document.getElementById('omsv-archive-modal');
  if (modal) modal.style.display = 'flex';
}
function _omsvCloseArchiveModal() {
  const modal = document.getElementById('omsv-archive-modal');
  if (modal) modal.style.display = 'none';
  _om.archivePending = [];
}
function _omArchiveSelectedClick() {
  const uids = [..._om.selected];
  _omOpenArchiveModal(uids.map(uid => ({ folder: _om.currentFolder, uid })));
}
function _omArchiveCurrentClick() {
  if (!_om.currentMsg || _om.archiveViewingId != null) return;
  _omOpenArchiveModal([{ folder: _om.currentFolder, uid: _om.currentMsg.uid }]);
}

// v232：封存核心抽出共用（勾選封存 modal 與拖曳封存皆呼叫）
async function _omsvArchiveItems(items, targetFolderId, deleteFromMail) {
  if (!items.length || !targetFolderId) return;
  let okCount = 0, failCount = 0, deleteFailCount = 0;
  for (const item of items) {
    try {
      // 逐封依序呼叫（同一 IMAP 連線序列化執行，見 openmail/client.js withImap），避免併發搶同一顆
      // mailboxLock。單封失敗不中斷整批，繼續處理其餘信件。
      const r = await _omCall('omsvArchiveMessage', { folder: item.folder, uid: item.uid, targetFolderId, deleteFromMail });
      okCount++;
      if (deleteFromMail && r && !r.deleted) deleteFailCount++;
    } catch (e) {
      failCount++;
    }
  }

  if (okCount) {
    let msg = `已封存 ${okCount} 封信件`;
    if (deleteFailCount) msg += `，其中 ${deleteFailCount} 封未能從屏科大信箱刪除原信，請自行確認`;
    showToast(msg, deleteFailCount ? 'warn' : 'success');
  }
  if (failCount) showToast(`${failCount} 封信件封存失敗`, 'error');

  if (okCount) {
    // 目標資料夾計數變了；若有勾選同時刪除，來源信箱資料夾內容也變了。
    const srcFolders = new Set(items.map(it => it.folder));
    srcFolders.forEach(f => _omCacheListInvalidateFolder(f));
    if (_om.currentMsg && items.some(it => it.uid === _om.currentMsg.uid) && _om.archiveViewingId == null) _omCloseReadPane();
    _om.selected.clear();
    await _omLoadFolders();
    await _omLoadMessages();
    await _omsvLoadFolders();
    if (_om.archiveCurrentFolderId === targetFolderId) await _omsvLoadMessages();
  }
}

async function _omsvArchiveConfirm() {
  const items = _om.archivePending;
  const sel = document.getElementById('omsv-archive-target-select');
  const targetFolderId = sel ? Number(sel.value) : NaN;
  const deleteFromMail = !!document.getElementById('omsv-archive-delete-checkbox')?.checked;
  if (!items.length || !targetFolderId) return;
  const btn = document.getElementById('omsv-archive-confirm-btn');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '封存中…'; }
  await _omsvArchiveItems(items, targetFolderId, deleteFromMail);
  _omsvCloseArchiveModal();
  if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '封存'; }
}
