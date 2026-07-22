// dev/issues-ui.js — 問題回報/許願池模組（拆 index.html 絞殺者第十七刀之二，v263）。
// 沿用 v261/v262 刀法「inline script 區塊原地外部化」：原 index.html 內這一整段獨立的
// <script>…</script>（無 src、無 document.currentScript 依賴，已逐行複核確認）被整段原樣搬出，
// 原位置換成 <script src="issues-ui.js"></script>，標籤所在順序完全不變，因此載入與執行時機
// 與搬移前逐位元組一致——本檔頂層狀態與副作用一律照搬（原 <script> 本就把問題回報/許願池、
// PDF 小工具頁、系統除錯日誌面板三個尾端小模組併在同一個 <script> 標籤內，此次原地外部化
// 照這個既有邊界整段搬出，不重新切分）：
//   let issuesData／_issuesSnapshot／_issuesPollTimer／_atSuggestMeta／_atSuggestIdx／
//     _issueSysContext／_issueDraftTodoId／_issueSubmitting／_pdfToolSessions／_syslogEntries／
//     _debugLogFolderId／_debugLogFilename／_debugLogDirty
//   const AUTO_ISSUE_REPLY_QUEUE_URL／AUTO_ISSUE_REPLY_EMAIL／_SURNAME_INITIALS／_SYSLOG_MAX／
//     _SYSLOG_COLOR／_SYSLOG_READ_ACTIONS
//   document.addEventListener('click', …) —— @提及自動完成面板，點擊面板外自動收起
//   document.addEventListener('keydown', …) —— Alt+L 快捷鍵切換系統日誌面板
//   window.addEventListener('beforeunload', …) —— 離開頁面前自動把系統日誌 flush 到 Drive
//   三處皆為模組級事件委派、一次註冊，搬到外部檔後仍在同一執行時機（<script src> 標籤位置
//   不變）內註冊一次，行為不變。
// 本區塊在 index.html 中的原始位置緊接在新生心理測驗 UI 模組（ft-ui.js）之後，拆出後仍以同一
// 位置的 <script src> 載入，執行順序不受影響。
// ══════════════════════════════════════════════
//  錯誤回報/許願池（T10）
// ══════════════════════════════════════════════
let issuesData = [];
let _issuesSnapshot = [];

function _issueNextSerial() {
  return issuesData.reduce((m, x) => Math.max(m, x.serial || 0), 0) + 1;
}

async function loadIssues() {
  try {
    const data = await proxyCall('readJson', { path: ISSUES_FILE, rootFolderId: ISSUES_FOLDER_ID });
    issuesData = Array.isArray(data?.issues) ? data.issues : [];
  } catch (e) {
    issuesData = [];
  }
  _issuesSnapshot = _deepClone(issuesData);
  if (typeof renderIssuesBadge === 'function') renderIssuesBadge();
}
// 每 30 分鐘自動輪詢一次許願池；分頁隱藏時跳過，回到前景後立即補一次
// v237：抽成具名頂層函式 _issuesAutoRefreshTick，供 setInterval／visibilitychange／SSE
// fileChanged 事件共用同一份「讀取＋比較＋條件重繪」邏輯，不另寫第二套讀檔判斷。
let _issuesPollTimer = null;
async function _issuesAutoRefreshTick() {
  if (document.visibilityState !== 'visible') return;
  if (!currentUser?.email) return;
  const _prevJson = JSON.stringify(issuesData);
  await loadIssues();
  await _checkAutoIssueReplies?.().catch(() => {});
  // 若 issues 有異動且目前正在許願池頁面，重繪
  if (_prevJson !== JSON.stringify(issuesData)
      && document.getElementById('page-issues')?.classList.contains('active')
      && typeof renderIssuesPage === 'function') {
    renderIssuesPage();
  }
}
function scheduleIssuesAutoRefresh() {
  if (_issuesPollTimer) return;
  _issuesPollTimer = setInterval(_issuesAutoRefreshTick, 10 * 60 * 1000); // 落地 server 後 30→10 分鐘更即時
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _issuesAutoRefreshTick(); });
}

async function _saveIssuesFallback() {
  try {
    await proxyCall('updateJson', { path: ISSUES_FILE, content: { issues: issuesData }, rootFolderId: ISSUES_FOLDER_ID });
  } catch (e) {
    await proxyCall('createJson', { name: ISSUES_FILE, content: { issues: issuesData }, parentId: ISSUES_FOLDER_ID, rootFolderId: ISSUES_FOLDER_ID });
  }
  _issuesSnapshot = _deepClone(issuesData);
}
// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的問題回報，經 listCommit 依 id upsert/remove。
// issues.json 跨環境共用（dev/prod 同一份），帶 rootFolderId 比照既有讀寫路徑。
async function _saveIssues() {
  const diff = _diffListById(_issuesSnapshot, issuesData);
  if (!diff) { await _saveIssuesFallback(); return; }
  const res = await _listCommit(ISSUES_FILE, { ...diff, rootFolderId: ISSUES_FOLDER_ID });
  if (res && res.fallback) { await _saveIssuesFallback(); return; }
  if (res && res.data && Array.isArray(res.data.issues)) {
    issuesData = res.data.issues;
    _issuesSnapshot = _deepClone(issuesData);
  }
}

async function _manualRefreshIssues() {
  if (!window._autoRepliesChecked) { window._autoRepliesChecked = true; }
  await loadIssues();
  await _checkAutoIssueReplies?.().catch(() => {});
  await _autoResolveStaleIssueVerifications?.().catch(() => {});
  renderIssuesPage();
}

// ══════════════════════════════════════════════
//  問題回報：自動回覆佇列（Claude Code 開發流程用）
//  機制：pending-issue-replies.json 隨 repo 部署在 GitHub Pages（公開讀取，不經 GAS 驗證）；
//  系統管理者登入時抓取此檔，逐筆比對該 issue 是否已有相同 autoReplyId 的留言，
//  沒有則以 npust.scc 身份寫入留言（走既有已驗證的 issues.json 儲存路徑，不新增任何後端權限）。
// ══════════════════════════════════════════════
const AUTO_ISSUE_REPLY_QUEUE_URL = 'https://npustscc.github.io/scc-infosys/pending-issue-replies.json';
const AUTO_ISSUE_REPLY_EMAIL     = 'npust.scc@heartnpust.tw';
async function _checkAutoIssueReplies() {
  const isSysAdminTrigger = extraRole === '管理者' || currentRole === '系統管理者';
  if (!isSysAdminTrigger) return;
  let queue;
  try {
    const r = await fetch(AUTO_ISSUE_REPLY_QUEUE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    queue = await r.json();
  } catch (_) { return; }
  if (!Array.isArray(queue) || !queue.length) return;
  let changed = false;
  for (const q of queue) {
    if (!q || !q.id || !q.issueSerial || (!q.text && !q.statusTo)) continue;
    const issue = issuesData.find(x => x.serial === q.issueSerial);
    if (!issue) continue;
    if (q.text) {
      if (!issue.comments) issue.comments = [];
      if (!issue.comments.some(c => c.autoReplyId === q.id)) { // 已回覆過，避免重複
        issue.comments.push({
          id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          content: q.text,
          attachments: [],
          authorEmail: AUTO_ISSUE_REPLY_EMAIL,
          authorName: configData?.users?.[AUTO_ISSUE_REPLY_EMAIL]?.name || '系統管理者',
          createdAt: new Date().toISOString(),
          autoReplyId: q.id,
        });
        changed = true;
      }
    }
    if (q.statusTo && issue.status !== q.statusTo) {
      if (!issue.statusHistory) issue.statusHistory = [];
      if (!issue.statusHistory.some(h => h.queueId === q.id)) { // 已套用過，避免重複
        const prev = issue.status;
        issue.status = q.statusTo;
        issue.statusHistory.push({
          from: prev, to: q.statusTo,
          by: AUTO_ISSUE_REPLY_EMAIL,
          byName: configData?.users?.[AUTO_ISSUE_REPLY_EMAIL]?.name || '系統管理者',
          at: new Date().toISOString(),
          queueId: q.id,
        });
        if (q.statusTo === 'pending_verification') _onIssuePendingVerification(issue);
        changed = true;
      }
    }
  }
  if (!changed) return;
  try {
    await _saveIssues();
    if (document.getElementById('page-issues')?.classList.contains('active') && typeof renderIssuesPage === 'function') renderIssuesPage();
  } catch (e) { console.warn('[_checkAutoIssueReplies] 儲存失敗:', e.message); }
}

// ── @提及：解析內文中 @名字，回傳符合的 email 陣列 ──
// v184：content 現在可能是富文字 HTML（問題說明／留言改用 rt-editor），先去標籤轉純文字再解析，
// 避免 @名字 被格式標籤從中截斷而誤判、或誤吃到標籤內容
function _parseIssueMentions(content) {
  const text = _stripHtmlToText(content || '');
  const tokens = (text.match(/@([^\s@,，。！？\n]+)/g) || []).map(m => m.slice(1));
  if (!tokens.length) return [];
  const result = [];
  Object.entries(configData?.users || {}).forEach(([email, u]) => {
    const name = (u.name || '').trim();
    if (tokens.some(t => t === name || t === email)) result.push(email);
  });
  return [...new Set(result)];
}
// ── 問題說明／留言渲染：富文字（rt-editor 產出）先再消毒一次（存取兩端都消毒，防後端被直呼塞入內容），
// 舊格式純文字則沿用原本 escHtml＋換行轉 <br>；不論何者，皆在 @名字 前後插入帶顏色 span 做提及標示
// （用 TreeWalker 只處理文字節點，避免正則直接對 HTML 字串操作而誤傷標籤本身）──
function _renderIssueText(text) {
  if (!text) return '';
  const raw = String(text);
  const isHtml = /<\/?[a-z][\s\S]*?>/i.test(raw);
  const html = isHtml ? sanitizeRichHtml(raw) : escHtml(raw).replace(/\n/g, '<br>');
  const container = document.createElement('div');
  container.innerHTML = html;
  const mentionRe = /@([^\s@,，。！？\n]+)/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n; while ((n = walker.nextNode())) textNodes.push(n);
  textNodes.forEach(node => {
    const t = node.nodeValue;
    mentionRe.lastIndex = 0;
    if (!mentionRe.test(t)) return;
    mentionRe.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = mentionRe.exec(t))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      const span = document.createElement('span');
      span.style.color = '#2b6cb0';
      span.style.fontWeight = '600';
      span.textContent = '@' + m[1];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
  return isHtml ? '<span class="rt-html">' + container.innerHTML + '</span>' : container.innerHTML;
}

// ── 統一發送 issue 事件通知（鈴鐺 + 待辦）──
async function _notifyIssueEvent(issue, comment, { notifyCreator = false, mentioned = [] } = {}) {
  const myEmail = currentUser?.email || '';
  const toNotify = new Map(); // email → { isMentioned }
  if (notifyCreator && issue.submittedBy && issue.submittedBy !== myEmail) {
    toNotify.set(issue.submittedBy, { isMentioned: false });
  }
  (mentioned || []).forEach(email => {
    if (email !== myEmail) toNotify.set(email, { isMentioned: true });
  });
  if (!toNotify.size) return;
  const issueLabel = `#${String(issue.serial).padStart(3, '0')}`;
  // v184：內容可能是富文字 HTML，摘要改用去標籤純文字後再截斷，避免截斷切壞 HTML 標籤
  const snippet = _stripHtmlToText(comment ? comment.content : issue.description).slice(0, 60);
  const authorName = configData?.users?.[myEmail]?.name || currentUser?.displayName || myEmail;
  for (const [email, { isMentioned }] of toNotify) {
    const msg = isMentioned
      ? `${authorName} 在回報 ${issueLabel} 中提及了您：${snippet}`
      : `${authorName} 在回報 ${issueLabel} 留言：${snippet}`;
    addNotificationToUser(email, 'issue_comment', issue.id, issue.serial, msg);
    const todo = {
      id: _genTodoId(),
      type: 'issue_notification',
      issueId: issue.id,
      title: isMentioned ? `回報 ${issueLabel} 中提及了您` : `回報 ${issueLabel} 有新留言`,
      description: msg,
      done: false,
      notifRead: false,
      createdAt: new Date().toISOString(),
      origin: 'autosave',
    };
    if (email === myEmail) {
      _putTodoItem(todo);
      saveUserTodos().catch(() => {});
    } else {
      _appendTodoToUser(email, todo).catch(() => {});
    }
  }
  _flushNotifOps().catch(() => {});
}

// ── @提及 自動完成下拉 ──
// 姓氏拼音首字母對照（漢語拼音 / 通用拼音 / 台語羅馬字）
const _SURNAME_INITIALS = {
  '安':['a'],'艾':['a'],
  '白':['b'],'鮑':['b'],'包':['b'],'邊':['b'],
  '陳':['c','t'],'蔡':['c'],'曹':['c'],'程':['c'],'崔':['c'],'柴':['c'],'常':['c'],
  '丁':['d'],'鄧':['d'],'杜':['d'],'董':['d'],'戴':['d'],'段':['d'],
  '方':['f'],'馮':['f'],'范':['f'],'傅':['f'],'符':['f'],
  '高':['g','k'],'顧':['g'],'郭':['g'],'管':['g'],'龔':['g'],
  '黃':['h','n','ng'],'胡':['h'],'韓':['h'],'侯':['h'],'何':['h'],'洪':['h','a'],'賀':['h'],'霍':['h'],'花':['h'],
  '金':['j'],'賈':['j'],'江':['j'],'姜':['j'],'蔣':['j'],'焦':['j'],
  '孔':['k'],'柯':['k'],'康':['k'],
  '劉':['l'],'李':['l'],'林':['l'],'羅':['l'],'呂':['l'],'雷':['l'],'盧':['l'],'廖':['l'],'梁':['l'],'陸':['l'],'黎':['l'],'龍':['l'],'賴':['l'],'藍':['l'],'連':['l'],'練':['l'],
  '毛':['m'],'馬':['m'],'孟':['m'],'苗':['m'],
  '倪':['n'],'寧':['n'],'聶':['n'],
  '歐':['o','au'],
  '彭':['p'],'潘':['p'],'龐':['p'],
  '錢':['q','c'],'秦':['q'],'邱':['q','k'],
  '任':['r'],
  '宋':['s'],'孫':['s'],'沈':['s'],'施':['s'],'石':['s'],'史':['s'],'蘇':['s'],'邵':['s'],
  '唐':['t'],'田':['t'],'譚':['t'],'陶':['t'],'湯':['t'],'滕':['t'],'童':['t'],
  '王':['w','o'],'吳':['w','g','n'],'魏':['w'],'汪':['w'],'韋':['w'],'翁':['w','o'],'溫':['w'],
  '徐':['x','s'],'謝':['x','s'],'許':['x','s'],'薛':['x','s'],'蕭':['x','s'],'熊':['x'],
  '楊':['y'],'葉':['y'],'余':['y'],'于':['y'],'游':['y'],'岳':['y'],'顏':['y'],'嚴':['y'],'袁':['y'],'姚':['y'],'應':['y'],
  '張':['z','t'],'趙':['z'],'周':['z'],'朱':['z'],'鄭':['z','t'],'鄒':['z'],'曾':['z','c'],'莊':['z'],'鐘':['z'],
};

let _atSuggestMeta = null;
let _atSuggestIdx  = -1;

function _atMatchesQuery(user, q) {
  if (!q) return true;
  const name  = (user.name  || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  if (name.includes(q)) return true;
  if (q.length <= 4) {
    const inits = _SURNAME_INITIALS[user.name?.[0]] || [];
    if (inits.some(i => i.startsWith(q))) return true;
  }
  if (email.includes(q)) return true;
  return false;
}

function _atScore(user, q, recentMentioned) {
  const name  = (user.name  || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  let score = 0;
  const mi = recentMentioned.indexOf(user.email);
  if (mi !== -1) score += 1000 - mi * 50;
  if (!q) return score;
  if (name.startsWith(q)) score += 200;
  else if (name.includes(q)) score += 100;
  const inits = _SURNAME_INITIALS[user.name?.[0]] || [];
  if (inits.some(i => i === q)) score += 80;
  else if (inits.some(i => i.startsWith(q))) score += 60;
  if (email.startsWith(q)) score += 40;
  else if (email.includes(q)) score += 20;
  return score;
}

// v184：問題回報改用 rt-editor（contenteditable）取代 textarea，@ 提及自動完成需改用 Selection/Range API
// （textarea 用 value/selectionStart，contenteditable 沒有這兩者；el 可能是任一種，用 isContentEditable 判斷分流）
function _issueAtInput(el) {
  const isCE = el.isContentEditable || el.getAttribute?.('contenteditable') === 'true';
  let before;
  if (isCE) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) { _hideAtSuggest(); return; }
    const node = sel.anchorNode;
    if (node.nodeType !== 3) { _hideAtSuggest(); return; } // 僅處理游標在純文字節點內的情況（多數輸入情境）
    before = node.nodeValue.slice(0, sel.anchorOffset);
  } else {
    before = el.value.slice(0, el.selectionStart);
  }
  const m = before.match(/@([^\s@,，。！？\n]*)$/);
  if (!m) { _hideAtSuggest(); return; }
  const query = (m[1] || '').toLowerCase();

  // 從當前 issue context 取得最近提及名單（留言情境才有）
  let recentMentioned = [];
  const idMatch = (el.id || '').match(/^issue-comment-(.+)$/);
  if (idMatch) {
    const issue = issuesData.find(x => x.id === idMatch[1]);
    if (issue) {
      const texts = [issue.description, ...(issue.comments || []).map(c => c.content).reverse()];
      const seen = new Set();
      texts.forEach(text => {
        _parseIssueMentions(text || '').forEach(email => {
          if (!seen.has(email)) { seen.add(email); recentMentioned.push(email); }
        });
      });
    }
  }

  const myEmail = currentUser?.email || '';
  const users = Object.entries(configData?.users || {})
    .filter(([, u]) => !u.disabled)
    .map(([email, u]) => ({ email, name: u.name || email }))
    .filter(u => u.email !== myEmail)
    .filter(u => _atMatchesQuery(u, query))
    .sort((a, b) => _atScore(b, query, recentMentioned) - _atScore(a, query, recentMentioned))
    .slice(0, 8);

  if (!users.length) { _hideAtSuggest(); return; }
  if (isCE) {
    const sel = window.getSelection();
    _atSuggestMeta = { editable: true, node: sel.anchorNode, el, start: sel.anchorOffset - m[0].length, len: m[0].length };
  } else {
    _atSuggestMeta = { editable: false, textarea: el, start: el.selectionStart - m[0].length, len: m[0].length };
  }
  _atSuggestIdx  = -1;

  let panel = document.getElementById('at-suggest-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'at-suggest-panel';
    panel.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #cbd5e0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.14);min-width:160px;max-width:260px;overflow:hidden;display:none;';
    document.body.appendChild(panel);
  }

  // 方案 A 智慧翻轉：下方空間不足時改顯示在欄位上方
  const rect       = el.getBoundingClientRect();
  const PANEL_H    = Math.min(users.length * 38 + 8, 320);
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  panel.style.left   = Math.min(rect.left, window.innerWidth - 270) + 'px';
  panel.style.bottom = '';
  panel.style.top    = '';
  if (spaceBelow >= PANEL_H || spaceBelow >= spaceAbove) {
    panel.style.top = (rect.bottom + 4) + 'px';
  } else {
    panel.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  }
  panel.style.display = 'block';

  panel.innerHTML = users.map((u, idx) =>
    '<div data-at-idx="' + idx + '" data-name="' + escHtml(u.name) + '"' +
    ' style="padding:8px 14px;cursor:pointer;font-size:.86rem;display:flex;align-items:center;"' +
    ' onmousedown="event.preventDefault();_issueAtSelect(this.dataset.name)"' +
    ' onmouseover="this.style.background=\'#ebf8ff\';"' +
    ' onmouseout="if(_atSuggestIdx!==' + idx + ')this.style.background=\'\';">' +
    '<span style="font-weight:600;color:#2d3748;">' + escHtml(u.name) + '</span>' +
    '</div>'
  ).join('');
}

function _issueAtKeydown(e) {
  const panel = document.getElementById('at-suggest-panel');
  if (!panel || panel.style.display === 'none') return;
  if (e.key === 'ArrowDown') {
    e.preventDefault(); _atSuggestMove(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); _atSuggestMove(-1);
  } else if ((e.key === 'Enter' || e.key === 'Tab') && _atSuggestIdx >= 0) {
    e.preventDefault();
    const item = panel.querySelector('[data-at-idx="' + _atSuggestIdx + '"]');
    if (item) _issueAtSelect(item.dataset.name);
  } else if (e.key === 'Escape') {
    _hideAtSuggest();
  }
}

function _atSuggestMove(dir) {
  const panel = document.getElementById('at-suggest-panel');
  if (!panel) return;
  const items = panel.querySelectorAll('[data-at-idx]');
  if (!items.length) return;
  _atSuggestIdx = Math.max(0, Math.min(items.length - 1, _atSuggestIdx + dir));
  items.forEach((el, i) => { el.style.background = i === _atSuggestIdx ? '#ebf8ff' : ''; });
  items[_atSuggestIdx]?.scrollIntoView({ block: 'nearest' });
}

function _issueAtSelect(name) {
  if (!_atSuggestMeta) return;
  const insert = '@' + name + ' ';
  if (_atSuggestMeta.editable) {
    const { node, start, len, el } = _atSuggestMeta;
    const text = node.nodeValue || '';
    const s = Math.max(0, Math.min(start, text.length));
    const e = Math.max(s, Math.min(start + len, text.length));
    node.nodeValue = text.slice(0, s) + insert + text.slice(e);
    const range = document.createRange();
    range.setStart(node, Math.min(s + insert.length, node.nodeValue.length));
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el?.focus();
  } else {
    const { textarea, start, len } = _atSuggestMeta;
    textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(start + len);
    textarea.selectionStart = textarea.selectionEnd = start + insert.length;
    textarea.focus();
  }
  _hideAtSuggest();
}

function _hideAtSuggest() {
  const p = document.getElementById('at-suggest-panel');
  if (p) p.style.display = 'none';
  _atSuggestMeta = null;
  _atSuggestIdx  = -1;
}

document.addEventListener('click', e => {
  if (!document.getElementById('at-suggest-panel')?.contains(e.target)) _hideAtSuggest();
});
// 技術錯誤 → 非工程師可懂的白話翻譯（回報問題時同步附上，方便回報與溝通）
function _friendlyError(msg) {
  const m = String(msg || '');
  if (/401|身份驗證失敗|unauthorized/i.test(m)) return '登入逾時，系統需要重新登入';
  if (/404|503|冷啟動/.test(m)) return '雲端服務暫時沒有回應（系統會自動重試）';
  if (/Failed to fetch|NetworkError|network|ERR_INTERNET/i.test(m)) return '網路連線中斷或不穩定';
  if (/找不到 Drive (檔案|資料夾)|找不到檔案/.test(m)) return '雲端上找不到對應的資料檔';
  if (/quota|rate|429|too many/i.test(m)) return '雲端服務流量暫時滿載，稍後會恢復';
  if (/timeout|逾時|timed out/i.test(m)) return '等待雲端回應逾時';
  if (/permission|權限|forbidden|403/i.test(m)) return '帳號權限不足，無法執行該操作';
  return '系統發生未預期的錯誤';
}
// 取本次工作階段最近的系統錯誤（最多 5 筆），附白話翻譯
function _recentSysErrors() {
  return (_syslogEntries || [])
    .filter(e => e.level === 'error')
    .slice(-5)
    .map(e => ({ t: e.t, raw: `${e.msg}${e.detail ? '｜' + e.detail : ''}`, friendly: _friendlyError(e.msg) }));
}

let _issueSysContext = [];
let _issueDraftTodoId = null; // v185：從草稿待辦「繼續編輯」重開時記錄對應 todoId

// ── v185：問題回報表單草稿備援與離開防護 ──────────────────────────────────
// 注意：附件（尚未上傳的檔案）無法序列化進 localStorage/todo，草稿只保留文字說明；
// 若使用者選了附件但取消離開，重新開啟時附件需重新選取（於下方 _restoreIssueDraft 註記）。
function _issueFormSnapshot() {
  return { desc: getRichTextValue('issue-desc') };
}
function _issueDraftKey() {
  return `scc_draft_issue_${currentUser?.email || ''}`;
}
function _startIssueDraftAutosave() {
  _gdStartAutosave('issue', _issueDraftKey(), _issueFormSnapshot, '_issue-draft-status');
}
function _stopIssueDraftAutosave() { _gdStopAutosave('issue'); }

function _restoreIssueDraft(snap) {
  if (!snap) return;
  if (snap.desc != null) setRichTextValue('issue-desc', snap.desc);
  _gdSetBaseline('issue', _issueFormSnapshot());
}

function _exitIssueModal() {
  const _exit = () => {
    _stopIssueDraftAutosave();
    try { localStorage.removeItem(_issueDraftKey()); } catch(_) {}
    _issueDraftTodoId = null;
    document.getElementById('issue-submit-modal').style.display = 'none';
  };
  if (!_gdIsDirty('issue', _issueFormSnapshot())) { _exit(); return; }
  _showExitDialog('離開問題回報表單',
    () => submitIssue(),
    () => _draftIssue(),
    () => _exit()
  );
}

function _draftIssue() {
  const snap = _issueFormSnapshot();
  const existingTodo = _issueDraftTodoId ? todosData.find(t => t.id === _issueDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  const plain = _stripHtmlToText(snap.desc || '').trim();
  _putTodoItem({
    id: todoId, type: 'issue_draft', label: '問題回報草稿',
    caseId: '', caseLabel: plain ? (plain.length > 20 ? plain.slice(0, 20) + '…' : plain) : '（未輸入內容）',
    draftData: { snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopIssueDraftAutosave();
  try { localStorage.removeItem(_issueDraftKey()); } catch(_) {}
  _issueDraftTodoId = null;
  document.getElementById('issue-submit-modal').style.display = 'none';
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function openIssueModal() {
  setRichTextValue('issue-desc', '');
  // 自動偵測最近的系統錯誤，翻成白話顯示並於送出時一併附上
  _issueSysContext = _recentSysErrors();
  const ctxEl = document.getElementById('issue-sys-context');
  if (ctxEl) {
    if (_issueSysContext.length) {
      ctxEl.style.display = '';
      ctxEl.innerHTML = `<details style="background:#fff8e6;border:1px solid #f0d490;border-radius:8px;padding:8px 12px;">
        <summary style="cursor:pointer;font-size:.82rem;font-weight:600;color:#8a6d3b;">🔎 系統偵測到 ${_issueSysContext.length} 筆最近的錯誤（送出時會自動附上，協助工程端診斷）</summary>
        <div style="margin-top:6px;">${_issueSysContext.map(x => `
          <div style="padding:4px 0;border-top:1px solid #f0e4c0;font-size:.82rem;color:#4a5568;">
            <span style="color:#a0aec0;font-size:.74rem;">[${escHtml(x.t)}]</span> ${escHtml(x.friendly)}
            <div style="font-size:.72rem;color:#a0aec0;font-family:monospace;word-break:break-all;">${escHtml(x.raw.slice(0, 160))}${x.raw.length > 160 ? '…' : ''}</div>
          </div>`).join('')}</div>
      </details>`;
    } else {
      ctxEl.style.display = 'none';
      ctxEl.innerHTML = '';
    }
  }
  document.getElementById('issue-submit-modal').style.display = 'flex';
  setTimeout(() => { attachInit('issue_new', [], { dropTargets: ['issue-desc'] }); document.getElementById('issue-desc').focus(); }, 50);
  _issueDraftTodoId = null; // v185：一般開啟——重置（由「繼續編輯」草稿待辦重開時會在呼叫後另外設回）
  _gdSetBaseline('issue', _issueFormSnapshot());
  _startIssueDraftAutosave();
  const _ids0 = document.getElementById('_issue-draft-status'); if (_ids0) _ids0.textContent = '';
}

let _issueSubmitting = false;
async function submitIssue() {
  if (_issueSubmitting) return; // 防止重複點擊
  const descHtml = getRichTextValue('issue-desc'); // 富文字（已經 sanitizeRichHtml）
  if (!_stripHtmlToText(descHtml).trim()) { alert('請填寫問題說明'); return; }
  _issueSubmitting = true;
  const submitBtn = document.querySelector('#issue-submit-modal button.btn-primary');
  const cancelBtn = document.querySelector('#issue-submit-modal button.btn-secondary');
  const _origBtnHtml = submitBtn?.innerHTML;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '送出中…'; submitBtn.style.opacity = '.7'; submitBtn.style.cursor = 'wait'; }
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.style.opacity = '.5'; }
  showLoading('送出中…');
  let _issueAttachments = [];
  try {
    try { _issueAttachments = await attachFlush('issue_new'); }
    catch(e) { alert('附件上傳失敗：' + e.message); return; }
    const issue = {
      id: 'issue_' + Date.now(),
      serial: _issueNextSerial(),
      description: descHtml,
      attachments: _issueAttachments,
      submittedBy: currentUser?.email || '',
      submittedByName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
      submittedAt: new Date().toISOString(),
      status: 'open',
      resolution: '',
    };
    if (_issueSysContext.length) issue.systemContext = _issueSysContext;
    issuesData.push(issue);
    try {
      await _saveIssues();
      // 通知所有系統管理者（主任 or 管理者 extraRole）
      Object.entries(configData?.users || {}).forEach(([email, u]) => {
        if (u.role === '主任' || u.extraRole === '管理者') {
          addNotificationToUser(email, 'new_issue', issue.id, issue.serial);
        }
      });
      _flushNotifOps().catch(() => {});
      // @提及通知（排除已收到 new_issue 通知的管理者，避免重複）
      const _adminEmails = new Set(Object.entries(configData?.users || {})
        .filter(([, u]) => u.role === '主任' || u.extraRole === '管理者').map(([e]) => e));
      const _mentioned = _parseIssueMentions(descHtml).filter(e => !_adminEmails.has(e));
      if (_mentioned.length) _notifyIssueEvent(issue, null, { mentioned: _mentioned });
      // v185：確定送出成功——停止草稿備援、清掉草稿 key；若是從草稿待辦繼續編輯，標記該待辦完成
      _stopIssueDraftAutosave();
      try { localStorage.removeItem(_issueDraftKey()); } catch(_) {}
      if (_issueDraftTodoId) {
        const _idt = todosData.find(t => t.id === _issueDraftTodoId);
        if (_idt) { _idt.done = true; _idt.doneAt = new Date().toISOString(); }
        _issueDraftTodoId = null;
        saveUserTodos().catch(() => {});
      }
      document.getElementById('issue-submit-modal').style.display = 'none';
      setRichTextValue('issue-desc', '');
      renderIssuesPage();
      showToast(`已送出問題回報 #${String(issue.serial).padStart(3,'0')}`, 'success');
    } catch (e) {
      issuesData.pop();
      alert('送出失敗：' + e.message);
    }
  } finally {
    hideLoading();
    _issueSubmitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = _origBtnHtml || '送出'; submitBtn.style.opacity = ''; submitBtn.style.cursor = ''; }
    if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.style.opacity = ''; }
  }
}

// 進入「待驗證」時的共用 side effect：通知 + 待辦事項（讓回報者在待辦頁看到需要驗證）
function _onIssuePendingVerification(issue) {
  if (!issue.submittedBy) return;
  const _serialStr = `#${String(issue.serial).padStart(3,'0')}`;
  if (issue.submittedBy !== currentUser?.email) {
    addNotificationToUser(
      issue.submittedBy, 'issue_pending_verification', issue.id, _serialStr,
      `您回報的 ${_serialStr} 已改為「待驗證」，請至錯誤回報/許願池頁面確認是否已解決`
    );
    _flushNotifOps().catch(() => {});
  }
  _appendTodoToUser(issue.submittedBy, {
    id: 'todo_issue_verify_' + issue.id + '_' + Date.now(),
    type: 'issue_pending_verification',
    label: `問題回報 ${_serialStr} 待您驗證`,
    issueId: issue.id,
    issueSerial: issue.serial,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    done: false, notifRead: false,
  }).catch(() => {});
}

async function updateIssueStatus(issueId, newStatus) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const prev = issue.status;
  if (prev === newStatus) { showToast('狀態未變更（選擇的狀態與目前相同）', 'warn', 2500); return; }
  // 按鈕即時回饋：鎖定並顯示更新中（成功後 renderIssuesPage 會整頁重繪，失敗時還原）
  const _btn = document.getElementById('issue-status-btn-' + issueId);
  const _sel = document.getElementById('issue-status-' + issueId);
  if (_btn) { _btn.disabled = true; _btn.textContent = '更新中…'; }
  if (_sel) _sel.disabled = true;
  issue.status = newStatus;
  if (!issue.statusHistory) issue.statusHistory = [];
  issue.statusHistory.push({
    from: prev, to: newStatus,
    by: currentUser?.email || '',
    byName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
    at: new Date().toISOString(),
  });
  const jobId = bgJobAdd(`更新回報狀態（#${String(issue.serial).padStart(3,'0')}）`);
  try {
    await _saveIssues();
    if (newStatus === 'pending_verification') _onIssuePendingVerification(issue);
    bgJobDone(jobId);
    auditLog('更新回報狀態', null, null, `#${String(issue.serial).padStart(3,'0')}：${prev} → ${newStatus}`);
    renderIssuesPage();
  } catch (e) {
    issue.status = prev;
    issue.statusHistory.pop();
    if (_btn) { _btn.disabled = false; _btn.textContent = '更新狀態'; }
    if (_sel) _sel.disabled = false;
    bgJobFail(jobId, e.message);
    alert('儲存失敗：' + e.message);
  }
}

// 回報最後一次進入「待驗證」的時間（statusHistory 由新到舊找 to==='pending_verification'）
function _issuePendingSince(issue) {
  const h = Array.isArray(issue?.statusHistory) ? issue.statusHistory : [];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i]?.to === 'pending_verification' && h[i]?.at) return h[i].at;
  }
  return issue?.updatedAt || issue?.createdAt || issue?.submittedAt || '';
}
// 待驗證超過 7 日 → 開放所有人協助驗證（原回報者遲遲未回應時，避免問題永久卡住）
function _issueHelperVerifiable(issue) {
  if (!issue || issue.status !== 'pending_verification') return false;
  const since = _issuePendingSince(issue);
  if (!since) return false;
  const t = new Date(since).getTime();
  if (!t || isNaN(t)) return false;
  return (Date.now() - t) >= 86400000 * 7;
}
// 開放全員協助驗收（7 天）後再過 7 天仍無人驗收（共 14 天）→ 自動標記已解決並註記
function _issueAutoResolvable(issue) {
  if (!issue || issue.status !== 'pending_verification') return false;
  const since = _issuePendingSince(issue);
  const t = since ? new Date(since).getTime() : 0;
  if (!t || isNaN(t)) return false;
  return (Date.now() - t) >= 86400000 * 14;
}
// 由系統管理者登入或手動重新整理回報頁時觸發（與 _checkAutoIssueReplies 同觸發點），
// 逐筆補上自動驗收留言＋狀態歷程（byName「系統自動」），一次儲存
async function _autoResolveStaleIssueVerifications() {
  const isSysAdminTrigger = extraRole === '管理者' || currentRole === '系統管理者';
  if (!isSysAdminTrigger) return;
  const stale = (issuesData || []).filter(_issueAutoResolvable);
  if (!stale.length) return;
  const now = new Date().toISOString();
  stale.forEach(issue => {
    if (!issue.comments) issue.comments = [];
    issue.comments.push({
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      content: '✅ 自動驗收：此回報開放全員協助驗收後 7 天內無人驗收，系統自動標記為已解決。若實際仍有問題，歡迎重新回報。',
      attachments: [],
      authorEmail: AUTO_ISSUE_REPLY_EMAIL,
      authorName: '系統自動',
      createdAt: now,
      autoResolved: true,
    });
    if (!issue.statusHistory) issue.statusHistory = [];
    issue.statusHistory.push({
      from: issue.status, to: 'resolved',
      by: AUTO_ISSUE_REPLY_EMAIL,
      byName: '系統自動（7 天無人驗收）',
      at: now,
      autoResolved: true,
    });
    issue.status = 'resolved';
    auditLog('回報自動驗收', null, null, `#${String(issue.serial).padStart(3, '0')}：開放驗收後 7 天無人驗收，自動標記已解決`);
  });
  try {
    await _saveIssues();
    if (document.getElementById('page-issues')?.classList.contains('active') && typeof renderIssuesPage === 'function') renderIssuesPage();
  } catch (e) { console.warn('[_autoResolveStaleIssueVerifications] 儲存失敗:', e.message); }
}

// 回報者確認「驗證OK」→ 狀態改為已解決（沿用 updateIssueStatus，statusHistory 會如實記錄本人與時間）
async function _issueVerifyOk(issueId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  if (issue.submittedBy !== currentUser?.email && !_issueHelperVerifiable(issue)) return; // 安全防呆：僅原回報者或協助驗證者可按
  await updateIssueStatus(issueId, 'resolved');
  const relatedTodo = todosData.find(t => t.type === 'issue_pending_verification' && t.issueId === issueId && !t.done);
  if (relatedTodo) {
    relatedTodo.done = true; relatedTodo.doneAt = new Date().toISOString();
    saveUserTodos().catch(() => {});
    _syncTodoBadge();
  }
}

// 回報者「驗證後仍有問題」→ 留下理由留言並退回處理中（statusHistory/時間軸如實記錄本人與時間）
async function _issueVerifyNotOk(issueId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  if (issue.submittedBy !== currentUser?.email && !_issueHelperVerifiable(issue)) return; // 安全防呆：僅原回報者或協助驗證者可按
  const ta = document.getElementById('issue-verify-reason-' + issueId);
  const reason = (ta?.value || '').trim();
  if (!reason) { alert('請描述驗證時仍遇到的狀況，方便後續修正。'); ta?.focus(); return; }
  const sendBtn = document.getElementById('issue-verify-notok-send-' + issueId);
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '送出中…'; }
  if (!issue.comments) issue.comments = [];
  const comment = {
    id: 'c_' + Date.now(),
    content: '❌ 驗證後仍有問題：' + reason,
    attachments: [],
    authorEmail: currentUser?.email || '',
    authorName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
    createdAt: new Date().toISOString(),
  };
  issue.comments.push(comment);
  const prev = issue.status;
  issue.status = 'in_progress';
  if (!issue.statusHistory) issue.statusHistory = [];
  issue.statusHistory.push({
    from: prev, to: 'in_progress',
    by: currentUser?.email || '',
    byName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
    at: new Date().toISOString(),
  });
  const jobId = bgJobAdd(`驗證未通過退回（#${String(issue.serial).padStart(3,'0')}）`);
  try {
    await _saveIssues();
    // 通知所有系統管理者（主任 or 管理者 extraRole）：驗證未通過需重新處理
    const _label = `#${String(issue.serial).padStart(3, '0')}`;
    Object.entries(configData?.users || {}).forEach(([email, u]) => {
      if (u.role === '主任' || u.extraRole === '管理者') {
        addNotificationToUser(email, 'issue_comment', issue.id, issue.serial,
          `回報 ${_label} 驗證未通過，已退回處理中：${reason.slice(0, 60)}`);
      }
    });
    _flushNotifOps().catch(() => {});
    // 本人已完成驗證動作，收掉待辦提醒卡
    const relatedTodo = todosData.find(t => t.type === 'issue_pending_verification' && t.issueId === issueId && !t.done);
    if (relatedTodo) {
      relatedTodo.done = true; relatedTodo.doneAt = new Date().toISOString();
      saveUserTodos().catch(() => {});
      _syncTodoBadge();
    }
    bgJobDone(jobId);
    auditLog('回報驗證未通過退回', null, null, `#${String(issue.serial).padStart(3,'0')}：pending_verification → in_progress`);
    renderIssuesPage();
  } catch (e) {
    issue.comments.pop();
    issue.status = prev;
    issue.statusHistory.pop();
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '送出並退回處理中'; }
    bgJobFail(jobId, e.message);
    alert('儲存失敗：' + e.message);
  }
}

function editIssue(issueId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const sid = issueId.replace(/[^a-z0-9_]/gi, '_');
  const descEl = document.getElementById(`issue-desc-text-${sid}`);
  if (!descEl) return;
  descEl.innerHTML = `
    ${_rtToolbarStaticHtml()}
    <div id="issue-edit-ta-${sid}" class="rt-editor field-input" contenteditable="true" style="width:100%;min-height:60px;max-height:300px;overflow:auto;resize:vertical;padding:5px 7px;border:1px solid #cbd5e0;border-radius:5px;font-size:.85rem;line-height:1.6;box-sizing:border-box;"></div>
    <div style="display:flex;gap:5px;margin-top:4px;">
      <button class="btn btn-primary btn-sm" onclick="saveIssueEdit('${escHtml(issueId)}')">儲存</button>
      <button class="btn btn-secondary btn-sm" onclick="renderIssuesPage()">取消</button>
    </div>`;
  setRichTextValue(`issue-edit-ta-${sid}`, issue.description);
  document.getElementById(`issue-edit-ta-${sid}`)?.focus();
}

async function saveIssueEdit(issueId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const sid = issueId.replace(/[^a-z0-9_]/gi, '_');
  const newDescHtml = getRichTextValue(`issue-edit-ta-${sid}`);
  if (!_stripHtmlToText(newDescHtml).trim()) { alert('問題說明不可為空'); return; }
  const prev = issue.description;
  issue.description = newDescHtml;
  showLoading('儲存中…');
  try {
    await _saveIssues();
    renderIssuesPage();
  } catch (e) {
    issue.description = prev;
    alert('儲存失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

function editIssueComment(issueId, commentId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const c = (issue.comments || []).find(x => x.id === commentId);
  if (!c) return;
  const domId = `${issueId}-${commentId}`;
  const textEl = document.getElementById(`issue-comment-text-${domId}`);
  if (!textEl) return;
  textEl.innerHTML = `
    ${_rtToolbarStaticHtml()}
    <div id="issue-comment-edit-${domId}" class="rt-editor field-input" contenteditable="true" style="width:100%;min-height:50px;max-height:280px;overflow:auto;resize:vertical;padding:5px 7px;border:1px solid #cbd5e0;border-radius:5px;font-size:.85rem;line-height:1.6;box-sizing:border-box;"></div>
    <div style="display:flex;gap:5px;margin-top:4px;">
      <button class="btn btn-primary btn-sm" onclick="saveIssueCommentEdit('${escHtml(issueId)}','${escHtml(commentId)}')">儲存</button>
      <button class="btn btn-secondary btn-sm" onclick="renderIssuesPage()">取消</button>
    </div>`;
  setRichTextValue(`issue-comment-edit-${domId}`, c.content);
  document.getElementById(`issue-comment-edit-${domId}`)?.focus();
}

async function saveIssueCommentEdit(issueId, commentId) {
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const c = (issue.comments || []).find(x => x.id === commentId);
  if (!c) return;
  const newContentHtml = getRichTextValue(`issue-comment-edit-${issueId}-${commentId}`);
  if (!_stripHtmlToText(newContentHtml).trim()) { alert('留言內容不可為空'); return; }
  const prev = { content: c.content, editedAt: c.editedAt };
  c.content = newContentHtml;
  c.editedAt = new Date().toISOString();
  showLoading('儲存中…');
  try {
    await _saveIssues();
    renderIssuesPage();
  } catch (e) {
    c.content = prev.content; c.editedAt = prev.editedAt;
    alert('儲存失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

async function deleteIssueComment(issueId, commentId) {
  if (!confirm('確定刪除此留言？')) return;
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  const idx = (issue.comments || []).findIndex(x => x.id === commentId);
  if (idx === -1) return;
  const removed = issue.comments.splice(idx, 1)[0];
  showLoading('刪除中…');
  try {
    await _saveIssues();
    renderIssuesPage();
  } catch (e) {
    issue.comments.splice(idx, 0, removed);
    alert('刪除失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

async function addIssueComment(issueId) {
  const contentHtml = getRichTextValue('issue-comment-' + issueId);
  if (!_stripHtmlToText(contentHtml).trim()) { alert('請填寫留言內容'); return; }
  const issue = issuesData.find(x => x.id === issueId);
  if (!issue) return;
  if (!issue.comments) issue.comments = [];
  let attachments = [];
  try { attachments = await attachFlush('ic_' + issueId); }
  catch(e) { alert('附件上傳失敗：' + e.message); return; }
  const comment = {
    id: 'c_' + Date.now(),
    content: contentHtml,
    attachments,
    authorEmail: currentUser?.email || '',
    authorName: configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '',
    createdAt: new Date().toISOString(),
  };
  issue.comments.push(comment);
  showLoading('儲存中…');
  try {
    await _saveIssues();
    _notifyIssueEvent(issue, comment, { notifyCreator: true, mentioned: _parseIssueMentions(contentHtml) });
    renderIssuesPage();
  } catch (e) {
    issue.comments.pop();
    alert('儲存失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

function renderIssuesPage() {
  if (!window._autoRepliesChecked) {
    window._autoRepliesChecked = true;
    if (typeof _checkAutoIssueReplies === 'function') _checkAutoIssueReplies().catch(() => {});
  }
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const el = document.getElementById('issues-body');
  if (!el) return;
  if (!window._issueFilters) window._issueFilters = { statuses: {}, dateFrom: '', dateTo: '', reporter: '' };
  const F = window._issueFilters;

  const statusBadge = s => {
    if (s === 'resolved')             return '<span class="badge" style="background:#c6f6d5;color:#276749;border:1px solid #9ae6b4;">已解決</span>';
    if (s === 'pending_verification') return '<span class="badge" style="background:#e9d8fd;color:#553c9a;border:1px solid #d6bcfa;">待驗證</span>';
    if (s === 'in_progress')          return '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;">處理中</span>';
    return '<span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">待處理</span>';
  };
  const statusOrder = isAdmin
    ? { open: 0, in_progress: 1, pending_verification: 2, resolved: 3 }
    : { pending_verification: 0, open: 1, in_progress: 2, resolved: 3 };
  const statusLabel = { open: '待處理', in_progress: '處理中', pending_verification: '待驗證', resolved: '已解決' };

  // 回報人員清單（供篩選下拉選單用）：以顯示名稱為準，去重＋依中文排序
  const reporterNames = [...new Set(issuesData.map(x => x.submittedByName || x.submittedBy).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'));

  // 篩選
  let filtered = [...issuesData];
  const _anyChecked = Object.values(F.statuses || {}).some(v => v);
  if (_anyChecked) filtered = filtered.filter(x => (F.statuses[x.status]));
  if (F.dateFrom) filtered = filtered.filter(x => (x.submittedAt || '') >= F.dateFrom);
  if (F.dateTo)   filtered = filtered.filter(x => (x.submittedAt || '') <= F.dateTo + 'T23:59:59');
  if (F.reporter) filtered = filtered.filter(x => (x.submittedByName || x.submittedBy) === F.reporter);
  // 排序：依 statusOrder 排序，同狀態內由新到舊
  const sorted = filtered.sort((a, b) => {
    const sd = (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
    if (sd !== 0) return sd;
    return (b.submittedAt || '') > (a.submittedAt || '') ? 1 : -1;
  });

  const filterBar = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:.82rem;">
        <span style="color:#718096;">狀態：</span>
        ${['open','in_progress','pending_verification','resolved'].map(s => {
          const labels = {open:'待處理',in_progress:'處理中',pending_verification:'待驗證',resolved:'已解決'};
          return `<label style="cursor:pointer;display:flex;gap:4px;align-items:center;">
            <input type="checkbox" ${(F.statuses||{})[s]?'checked':''} onchange="(function(){if(!window._issueFilters.statuses)window._issueFilters.statuses={};window._issueFilters.statuses['${s}']=this.checked;renderIssuesPage()}).call(this)">
            ${labels[s]}
          </label>`;
        }).join('')}
      </div>
      <label style="font-size:.82rem;color:#718096;display:flex;gap:4px;align-items:center;">
        日期
        <input type="date" value="${escHtml(F.dateFrom)}" style="padding:3px 6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.82rem;" onchange="window._issueFilters.dateFrom=this.value;renderIssuesPage()">
        ～
        <input type="date" value="${escHtml(F.dateTo)}" style="padding:3px 6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.82rem;" onchange="window._issueFilters.dateTo=this.value;renderIssuesPage()">
      </label>
      <label style="font-size:.82rem;color:#718096;display:flex;gap:4px;align-items:center;">
        回報人員
        <select style="padding:3px 6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.82rem;" onchange="window._issueFilters.reporter=this.value;renderIssuesPage()">
          <option value=""${F.reporter ? '' : ' selected'}>全部</option>
          ${reporterNames.map(n => `<option value="${escHtml(n)}"${F.reporter===n?' selected':''}>${escHtml(n)}</option>`).join('')}
        </select>
      </label>
      <span style="font-size:.8rem;color:#a0aec0;">共 ${sorted.length} 筆</span>
      ${(_anyChecked || F.dateFrom || F.dateTo || F.reporter) ? `<button class="btn btn-secondary btn-sm" style="padding:2px 8px;" onclick="window._issueFilters={statuses:{},dateFrom:'',dateTo:'',reporter:''};renderIssuesPage()">清除篩選</button>` : ''}
    </div>`;

  if (!sorted.length) {
    el.innerHTML = filterBar + '<div class="empty-state" style="padding:24px;"><p>無符合條件的回報</p></div>';
    return;
  }

  el.innerHTML = sorted.map(issue => {
    const sid = escHtml(issue.id);

    // 留言串（兼容舊 resolution 欄位）
    const comments = issue.comments || [];
    const allComments = [...comments];
    if (issue.resolution && !comments.length) {
      allComments.push({ id:'legacy', content: issue.resolution,
        authorEmail: issue.resolvedBy || '', authorName: '（舊格式）', createdAt: issue.resolvedAt || '' });
    }
    // 時間軸：留言與狀態變更依時間交錯排列，一起呈現完整歷史軌跡
    const timelineEvents = [
      ...allComments.map(c => ({ kind: 'comment', t: c.createdAt || '', data: c })),
      ...(issue.statusHistory || []).map(h => ({ kind: 'status', t: h.at || '', data: h })),
    ].sort((a, b) => (a.t || '').localeCompare(b.t || ''));
    const timelineHtml = timelineEvents.length ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;">
        ${timelineEvents.map(ev => {
          if (ev.kind === 'status') {
            const h = ev.data;
            const atStr = h.at ? new Date(h.at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
            return `<div style="margin:4px 0;padding:4px 10px;font-size:.78rem;color:#a0aec0;border-left:2px dashed #cbd5e0;">
              <span style="color:#718096;font-weight:600;">${escHtml(h.byName||h.by||'—')}</span>
              將狀態由 <em>${escHtml(statusLabel[h.from]||h.from)}</em> 改為 <em>${escHtml(statusLabel[h.to]||h.to)}</em>
              ${atStr ? `<span style="color:#cbd5e0;">・${atStr}</span>` : ''}
            </div>`;
          }
          const c = ev.data;
          const cid = escHtml(c.id);
          const isOwn = c.authorEmail === currentUser?.email;
          const canEdit   = isOwn && c.id !== 'legacy';
          const canDelete = (isOwn || isAdmin) && c.id !== 'legacy';
          const actBtns = (canEdit || canDelete) ? `<span style="margin-left:auto;display:flex;gap:3px;">
            ${canEdit   ? `<button class="btn btn-secondary btn-sm" style="padding:0 5px;font-size:.7rem;" onclick="editIssueComment('${sid}','${cid}')">編輯</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" style="padding:0 5px;font-size:.7rem;" onclick="deleteIssueComment('${sid}','${cid}')">刪除</button>` : ''}
          </span>` : '';
          const editedMark = c.editedAt ? `<span style="font-size:.7rem;color:#a0aec0;">（已編輯）</span>` : '';
          const autoMark = c.autoReplyId ? `<span style="font-size:.68rem;font-weight:700;color:#805ad5;background:#faf5ff;border:1px solid #d6bcfa;border-radius:4px;padding:0 5px;">系統自動回覆</span>` : '';
          return `
          <div id="issue-comment-card-${sid}-${cid}" style="margin-bottom:6px;padding:7px 10px;background:#f7fafc;border-radius:6px;font-size:.85rem;">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px;font-size:.78rem;color:#718096;">
              <span style="font-weight:600;color:#4a5568;">${escHtml(c.authorName||c.authorEmail||'—')}</span>
              ${autoMark}
              <span>${c.createdAt ? new Date(c.createdAt).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : ''}</span>
              ${editedMark}${actBtns}
            </div>
            <div id="issue-comment-text-${sid}-${cid}" style="color:#2d3748;white-space:pre-wrap;">${_renderIssueText(c.content)}</div>
            ${renderAttachChips(c.attachments)}
          </div>`;
        }).join('')}
      </div>` : '';

    // 更新狀態：僅系統管理者可用（不含主任、不含回報者本人自助下拉）
    const isSysAdmin = extraRole === '管理者' || currentRole === '系統管理者';
    const statusControl = isSysAdmin ? `
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:8px;border-top:1px solid #e2e8f0;">
        <select id="issue-status-${sid}" style="padding:4px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:.83rem;background:#fff;">
          <option value="open"                  ${issue.status==='open'?'selected':''}>待處理</option>
          <option value="in_progress"           ${issue.status==='in_progress'?'selected':''}>處理中</option>
          <option value="pending_verification"  ${issue.status==='pending_verification'?'selected':''}>待驗證</option>
          <option value="resolved"              ${issue.status==='resolved'?'selected':''}>已解決</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="issue-status-btn-${sid}"
          onclick="updateIssueStatus('${sid}',document.getElementById('issue-status-${sid}').value)">更新狀態</button>
      </div>` : '';
    // 回報者「驗證OK / 驗證後仍有問題」：本人可見；待驗證超過 7 日未回應時開放所有人協助驗證
    const _isOrigReporter = issue.submittedBy === currentUser?.email;
    const _isHelperVerify = !_isOrigReporter && _issueHelperVerifiable(issue);
    const verifyControl = (issue.status === 'pending_verification' && (_isOrigReporter || _isHelperVerify)) ? `
      <div style="margin-top:8px;padding:8px 12px;background:#faf5ff;border:1px solid #d6bcfa;border-radius:6px;">
        ${_isHelperVerify ? `<div style="font-size:.78rem;color:#805ad5;margin-bottom:6px;">⏳ 回報者超過 7 日未驗證，已開放所有人協助驗證</div>` : ''}
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:#553c9a;font-weight:600;">
          <input type="checkbox" onchange="if(this.checked){this.disabled=true;_issueVerifyOk('${sid}');}" style="width:16px;height:16px;cursor:pointer;">
          ${_isHelperVerify ? '驗證OK（協助驗證：確認此問題已修正，將回報標記為已解決）' : '驗證OK（確認此問題已修正，將回報標記為已解決）'}
        </label>
        <div style="margin-top:6px;">
          <button class="btn btn-secondary btn-sm" id="issue-verify-notok-btn-${sid}" style="font-size:.78rem;"
            onclick="const w=document.getElementById('issue-verify-notok-${sid}');const on=w.style.display==='none';w.style.display=on?'':'none';if(on)document.getElementById('issue-verify-reason-${sid}').focus();">
            ✕ 驗證後仍有問題…</button>
          <div id="issue-verify-notok-${sid}" style="display:none;margin-top:6px;">
            <textarea id="issue-verify-reason-${sid}" rows="2" placeholder="請描述驗證時仍遇到的狀況（必填），送出後回報將退回「處理中」。"
              style="width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:.83rem;resize:vertical;box-sizing:border-box;"></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:4px;">
              <button class="btn btn-danger btn-sm" id="issue-verify-notok-send-${sid}" onclick="_issueVerifyNotOk('${sid}')">送出並退回處理中</button>
            </div>
          </div>
        </div>
      </div>` : '';

    const commentInput = `
      <div style="margin-top:8px;">
        ${_rtToolbarStaticHtml()}
        <div id="issue-comment-${sid}" class="rt-editor field-input" contenteditable="true" data-placeholder="新增留言… （輸入 @ 可提及使用者）"
          style="width:100%;min-height:44px;max-height:260px;overflow:auto;resize:vertical;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:.83rem;line-height:1.5;box-sizing:border-box;" oninput="_issueAtInput(this)" onkeydown="_issueAtKeydown(event)"></div>
        <div id="attachPicker_ic_${sid}" class="attach-picker-wrap"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:4px;">
          <button class="btn btn-primary btn-sm" onclick="addIssueComment('${sid}')">送出</button>
        </div>
      </div>`;

    const dateStr = issue.submittedAt
      ? new Date(issue.submittedAt).toLocaleString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';

    const isCreator = issue.submittedBy === currentUser?.email;
    const issueEditBtn = isCreator ? `<button class="btn btn-secondary btn-sm" style="padding:0 5px;font-size:.7rem;margin-left:auto;" onclick="editIssue('${sid}')">編輯</button>` : '';
    return `
      <div style="padding:12px 16px;border-bottom:1px solid #f0f4f8;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
          <span style="font-weight:700;color:#2d3748;">#${String(issue.serial).padStart(3,'0')}</span>
          ${statusBadge(issue.status)}
          <span style="font-size:.8rem;color:#718096;">${escHtml(issue.submittedByName||issue.submittedBy||'—')}</span>
          <span style="font-size:.78rem;color:#a0aec0;">${dateStr}</span>
          ${issueEditBtn}
        </div>
        <div id="issue-desc-text-${sid}" style="font-size:.88rem;color:#2d3748;white-space:pre-wrap;">${_renderIssueText(issue.description)}</div>
        ${Array.isArray(issue.systemContext) && issue.systemContext.length ? `
        <details style="margin-top:6px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;">
          <summary style="cursor:pointer;font-size:.78rem;font-weight:600;color:#4a5568;">🔎 回報當下系統偵測到的錯誤（${issue.systemContext.length} 筆）</summary>
          ${issue.systemContext.map(x => `
            <div style="padding:3px 0;border-top:1px solid #edf2f7;font-size:.8rem;color:#4a5568;">
              <span style="color:#a0aec0;font-size:.72rem;">[${escHtml(x.t || '')}]</span> ${escHtml(x.friendly || '')}
              <div style="font-size:.7rem;color:#a0aec0;font-family:monospace;word-break:break-all;">${escHtml(String(x.raw || '').slice(0, 200))}</div>
            </div>`).join('')}
        </details>` : ''}
        ${renderAttachChips(issue.attachments)}
        ${timelineHtml}
        ${verifyControl}
        ${statusControl}
        ${commentInput}
      </div>`;
  }).join('');
  el.innerHTML = filterBar + el.innerHTML;
  markIssuesSeen();
  setTimeout(() => {
    sorted.forEach(issue => { attachInit('ic_' + issue.id, [], { dropTargets: ['issue-comment-' + issue.id] }); });
  }, 0);
}

// ══════════════════════════════════════════════
//  Issues 側邊欄 badge（三色）
// ══════════════════════════════════════════════
function _issuesSeenKey() {
  return 'scc_issues_seen_' + (currentUser?.email || '');
}

function _getSeenIssueIds() {
  try { return new Set(JSON.parse(localStorage.getItem(_issuesSeenKey()) || '[]')); }
  catch { return new Set(); }
}

function _saveSeenIssueIds(set) {
  try { localStorage.setItem(_issuesSeenKey(), JSON.stringify([...set])); } catch {}
}

function markIssuesSeen() {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const myEmail = currentUser?.email || '';
  const relevant = issuesData.filter(x => isAdmin || x.submittedBy === myEmail);
  const resolved = relevant.filter(x => x.status === 'resolved').map(x => x.id);
  if (resolved.length) {
    const seen = _getSeenIssueIds();
    resolved.forEach(id => seen.add(id));
    _saveSeenIssueIds(seen);
  }
  renderIssuesBadge();
}

function renderIssuesBadge() {
  const wrap = document.getElementById('issues-badge-wrap');
  if (!wrap) return;
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const myEmail = currentUser?.email || '';
  const relevant = issuesData.filter(x => isAdmin || x.submittedBy === myEmail);
  const seen = _getSeenIssueIds();

  const redCount    = relevant.filter(x => x.status === 'open').length;
  const orangeCount = relevant.filter(x => x.status === 'in_progress').length;
  const purpleCount = relevant.filter(x => x.status === 'pending_verification').length;
  const onIssuesPage = !!document.getElementById('page-issues')?.classList.contains('active');
  const greenCount  = onIssuesPage ? 0 : relevant.filter(x => x.status === 'resolved' && !seen.has(x.id)).length;

  const badge = (count, bg) => count
    ? `<span style="display:inline-block;background:${bg};color:#fff;border-radius:10px;font-size:.68rem;font-weight:700;padding:1px 6px;min-width:18px;text-align:center;line-height:1.5;">${count}</span>`
    : '';

  const content = badge(redCount,'#e53e3e') + badge(orangeCount,'#dd6b20') + badge(purpleCount,'#805ad5') + badge(greenCount,'#38a169');
  wrap.innerHTML  = content;
  wrap.style.display = content ? 'flex' : 'none';
}

// ══════════════════════════════════════════════
//  PDF 轉圖片工具（記憶體模式，不使用 localStorage）
// ══════════════════════════════════════════════
let _pdfToolSessions = []; // { key, filename, createdAt, pages[] }

function renderPdfToolPage() {
  const el = document.getElementById('pdf-tool-results');
  if (!el) return;
  if (!_pdfToolSessions.length) { el.innerHTML = ''; return; }

  el.innerHTML = _pdfToolSessions.map(item => {
    const kEsc = escHtml(item.key);
    const thumbs = (item.pages || []).map((src, i) => `
      <div style="display:inline-block;text-align:center;margin:4px;">
        <img src="${src}" style="width:120px;height:auto;border:1px solid #e2e8f0;border-radius:4px;display:block;">
        <a href="${src}" download="${escHtml(item.filename || 'page')}_p${i+1}.jpg"
          style="font-size:.72rem;color:#3182ce;display:block;margin-top:2px;">下載 p${i+1}</a>
      </div>`).join('');
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap;gap:6px;">
          <div style="font-weight:600;font-size:.93rem;">${escHtml(item.filename || '（未命名）')}</div>
          <div style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:.78rem;color:#718096;">${(item.pages||[]).length} 頁・資料暫存，關閉瀏覽器後即刪除</span>
            <button class="btn btn-primary btn-sm" onclick="pdfToolDownloadAll('${kEsc}')">全部下載</button>
            <button class="btn btn-danger btn-sm" onclick="pdfToolDelete('${kEsc}')">清除</button>
          </div>
        </div>
        <div style="padding:10px 12px;overflow-x:auto;white-space:nowrap;">${thumbs}</div>
      </div>`;
  }).join('');
}

async function pdfToolFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  document.getElementById('pdf-tool-filename').textContent = file.name;
  input.value = '';

  if (!window.pdfjsLib) {
    showLoading('載入 PDF 解析套件…');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    hideLoading();
  }

  const progressWrap = document.getElementById('pdf-tool-progress');
  const progressBar  = document.getElementById('pdf-tool-progress-bar');
  const progressText = document.getElementById('pdf-tool-progress-text');
  progressWrap.style.display = '';
  progressBar.style.width = '0%';

  try {
    const buf    = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    const total  = pdfDoc.numPages;
    const pages  = [];
    const scale  = 1.5;

    for (let p = 1; p <= total; p++) {
      progressText.textContent = `轉換中 ${p} / ${total}…`;
      progressBar.style.width  = Math.round((p - 1) / total * 100) + '%';
      const page     = await pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas   = document.createElement('canvas');
      canvas.width   = Math.round(viewport.width);
      canvas.height  = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.88));
    }

    progressBar.style.width = '100%';
    progressText.textContent = '完成！轉換結果保留在本次視窗，請下載後再關閉頁面。';
    setTimeout(() => { progressWrap.style.display = 'none'; }, 3000);

    _pdfToolSessions.unshift({
      key: 'pdfimg_' + Date.now(),
      filename: file.name.replace(/\.pdf$/i, ''),
      createdAt: new Date().toISOString(),
      pages,
    });
    auditLog('使用 PDF 轉圖片工具', null, null, `共 ${total} 頁`);
    renderPdfToolPage();
  } catch (e) {
    progressWrap.style.display = 'none';
    alert('PDF 轉換失敗：' + e.message);
  }
}

function pdfToolDownloadAll(key) {
  const item = _pdfToolSessions.find(s => s.key === key);
  if (!item?.pages?.length) return;
  item.pages.forEach((src, i) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = (item.filename || 'page') + '_p' + (i + 1) + '.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

function pdfToolDelete(key) {
  if (!confirm('確定清除此轉換結果？')) return;
  _pdfToolSessions = _pdfToolSessions.filter(s => s.key !== key);
  renderPdfToolPage();
}

// ══════════════════════════════════════════════
//  系統記錄（System Log）
// ══════════════════════════════════════════════
const _SYSLOG_MAX = 1000;
let _syslogEntries = [];
const _SYSLOG_COLOR = { debug:'#718096', info:'#63b3ed', warn:'#f6ad55', error:'#fc8181', success:'#68d391' };
const _SYSLOG_READ_ACTIONS = new Set(['readJson','readJsonById','query','listFolder','getMetadata','ping','downloadFileBase64','startupBatch']);

function _syslog(level, msg, detail) {
  const now = new Date();
  const t = now.toLocaleTimeString('zh-TW', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const entry = { t, level, msg, detail: detail !== undefined ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : null };
  _syslogEntries.push(entry);
  if (_syslogEntries.length > _SYSLOG_MAX) _syslogEntries.shift();
  _syslogRenderRow(entry);
}

function _syslogRenderRow(entry) {
  const list = document.getElementById('_syslog_list');
  if (!list) return;
  const c = _SYSLOG_COLOR[entry.level] || '#e2e8f0';
  const row = document.createElement('div');
  row.style.cssText = 'padding:2px 10px;border-bottom:1px solid #1a202c;line-height:1.4;';
  const lvlPad = entry.level.toUpperCase().padEnd(7);
  const detailHtml = entry.detail ? ` <span style="color:#4a5568;font-size:.9em">— ${escHtml(entry.detail.slice(0, 200))}</span>` : '';
  row.innerHTML = `<span style="color:#2d3748">${entry.t}</span> <span style="color:${c};font-weight:700">[${lvlPad}]</span> <span style="color:#cbd5e0">${escHtml(entry.msg)}</span>${detailHtml}`;
  list.appendChild(row);
  const cnt = document.getElementById('_syslog_count');
  if (cnt) cnt.textContent = _syslogEntries.length;
  if (list.scrollTop + list.clientHeight >= list.scrollHeight - 60) list.scrollTop = list.scrollHeight;
  _debugLogDirty = true;
  _syslogSetSaveStatus('pending');
}

function _syslogClear() {
  _syslogEntries = [];
  const list = document.getElementById('_syslog_list');
  if (list) list.innerHTML = '';
  const cnt = document.getElementById('_syslog_count');
  if (cnt) cnt.textContent = '0';
}

function _syslogOnCopy(e) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  e.clipboardData.setData('text/plain', sel.toString());
  e.preventDefault();
}
function _syslogCopyAll() {
  const text = _syslogEntries.map(e => `${e.t} [${e.level.toUpperCase()}] ${e.msg}${e.detail ? ' — ' + e.detail : ''}`).join('\r\n');
  navigator.clipboard.writeText(text)
    .then(() => showToast('已複製系統記錄到剪貼簿', 'success', 2500))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('已複製', 'success', 2000); });
}

function toggleSyslog() {
  const panel = document.getElementById('_syslog_panel');
  if (!panel) return;
  const showing = panel.style.display === 'flex';
  panel.style.display = showing ? 'none' : 'flex';
  if (!showing) { const list = document.getElementById('_syslog_list'); if (list) setTimeout(() => { list.scrollTop = list.scrollHeight; }, 30); }
}

document.addEventListener('keydown', e => { if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); toggleSyslog(); } });

// ── Drive 持久化 ──
let _debugLogFolderId = null;
let _debugLogFilename = null;   // 本 session 的檔名（固定）
let _debugLogDirty    = false;  // 有新 entry 尚未 flush

function _debugLogEnsureFilename() {
  if (_debugLogFilename) return _debugLogFilename;
  const now  = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toLocaleTimeString('zh-TW', { hour12: false }).replace(/:/g, '-');
  const who  = (currentUser?.email || 'unknown').split('@')[0].slice(0, 12);
  _debugLogFilename = `${date}_${time}_${who}.json`;
  return _debugLogFilename;
}

async function _debugLogEnsureFolder() {
  if (_debugLogFolderId) return _debugLogFolderId;
  const q   = `name='debug_log' and mimeType='application/vnd.google-apps.folder' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`;
  const res = await proxyCall('query', { q, fields: 'id' }, true);
  if (res?.files?.length) { _debugLogFolderId = res.files[0].id; return _debugLogFolderId; }
  const r = await proxyCall('createFolder', { name: 'debug_log', parentId: DRIVE_FOLDER_ID }, true);
  _debugLogFolderId = r?.id || r;
  return _debugLogFolderId;
}

async function _syslogFlushToDrive() {
  if (!currentUser?.email || _syslogEntries.length === 0 || !_debugLogDirty) return;
  _syslogSetSaveStatus('saving');
  try {
    const folderId = await _debugLogEnsureFolder();
    const filename  = _debugLogEnsureFilename();
    const payload   = JSON.stringify({
      session: filename, user: currentUser.email,
      savedAt: new Date().toISOString(), total: _syslogEntries.length,
      entries: _syslogEntries,
    });
    // 先試 updateJson（path 方式），找不到時改 createFile
    try {
      await proxyCall('updateJson', { path: `debug_log/${filename}`, content: payload }, true);
    } catch (e) {
      if (!e.message.includes('找不到')) throw e;
      await proxyCall('createFile', { name: filename, content: payload, mimeType: 'application/json', parentId: folderId }, true);
    }
    _debugLogDirty = false;
    _syslogSetSaveStatus('saved');
  } catch (e) {
    console.warn('[debugLog] flush失敗:', e.message);
    _syslogSetSaveStatus('error', e.message);
  }
}

function _syslogSetSaveStatus(status, detail) {
  const el = document.getElementById('_syslog_save');
  if (!el) return;
  const map = { saving:'⏳ 儲存中…', saved:'💾 已存至 GD', error:'⚠ 存取失敗', pending:'⏳ 待存' };
  el.textContent = map[status] || status;
  el.style.color = status === 'saved' ? '#68d391' : status === 'error' ? '#fc8181' : '#f6ad55';
  if (detail) el.title = detail;
}


// 離開頁面時自動 flush
window.addEventListener('beforeunload', () => { _syslogFlushToDrive().catch(() => {}); });
