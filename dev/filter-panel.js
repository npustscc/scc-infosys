// dev/filter-panel.js — 收合式勾選篩選面板（momo 購物式可重用元件，v173）＋個案列表
// 篩選狀態與批次列勾選（拆 index.html 絞殺者第三十二刀，v279）。內容為從 index.html
// 逐字搬出的連續區段。載入期副作用（column-0 複核）：①let _fpOpen = new Set()（內建
// 建構，無跨檔依賴）②三個 window._fp* 賦值 ③一個 document click bubble 監聽（點面板外
// 收合；開關按鈕走 inline onclick＋內層 stopPropagation，與 document 層註冊順序無關）。
// 前移後仍在 ui-helpers.js 之後、主 inline script 之前，相對順序與拆前一致。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  收合式勾選篩選面板（momo 購物式，可重用元件）v173
//  取代並排 <select>：低數量的篩選維度改勾選框群組，項目一多也不佔版面。
//  規則：同群組內複選＝OR、跨群組＝AND、某群全沒勾＝該維度不篩（＝不縮限）。
// ══════════════════════════════════════════════
// 純函式（有單元測試，見 test/filter-panel.test.js）：
// groupValues  ＝這筆資料在各群組維度的值，{ groupKey: string | string[] }（一筆可能同時命中多個標籤）
// activeGroups ＝目前已勾選的條件，{ groupKey: string[] }（空陣列＝該維度不篩）
function _filterPanelMatch(groupValues, activeGroups) {
  for (const key of Object.keys(activeGroups)) {
    const checked = activeGroups[key];
    if (!checked || !checked.length) continue; // 該群組全沒勾 → 不篩
    const raw = groupValues[key];
    const vals = Array.isArray(raw) ? raw : [raw];
    if (!vals.some(v => checked.includes(v))) return false; // 群組內 OR；本群沒命中即整體不通過（跨群 AND）
  }
  return true;
}

let _fpOpen = new Set();     // 目前展開中的面板 id（全域共用，同時間可能不只一個頁面掛著面板）
let _fpRegistry = {};        // panelId → { groups, state }，供勾選/清除全部反查對應的呼叫端狀態
function _fpActiveCount(groups, state) {
  return groups.filter(g => state[g.key] instanceof Set && state[g.key].size > 0).length;
}
// 按鈕：顯示「🔽 篩選」＋已套用條件數；面板初始為空殼，內容由 _fpSyncPanel() 於每次 render 時填入
function _fpButtonHtml(panelId, label = '🔽 篩選') {
  return `<button type="button" class="btn btn-secondary" id="fp-btn-${panelId}" style="font-size:.85rem;padding:6px 12px;white-space:nowrap;"
    onclick="event.stopPropagation();window._fpTogglePanel('${panelId}')">${label}<span id="fp-count-${panelId}"></span></button>`;
}
function _fpPanelHtml(panelId) {
  // flex-basis:100%+order:99：放在任何 flex-wrap 篩選列中都會被擠到最後一行整行顯示，窄螢幕也不擠版
  return `<div id="fp-panel-${panelId}" class="fp-panel" style="display:none;flex-basis:100%;width:100%;order:99;box-sizing:border-box;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:8px;"></div>`;
}
// 每次該頁 render() 呼叫，重繪按鈕條件數與面板內容（勾選框不需保留輸入焦點，全重繪安全）
function _fpSyncPanel(panelId, groups, state, onChangeExpr) {
  const btn = document.getElementById('fp-btn-' + panelId);
  const panel = document.getElementById('fp-panel-' + panelId);
  if (!btn || !panel) return;
  _fpRegistry[panelId] = { groups, state };
  const countEl = document.getElementById('fp-count-' + panelId);
  if (countEl) { const n = _fpActiveCount(groups, state); countEl.textContent = n ? ` (${n})` : ''; }
  panel.style.display = _fpOpen.has(panelId) ? 'block' : 'none';
  const groupsHtml = groups.map(g => {
    const checked = state[g.key] instanceof Set ? state[g.key] : new Set();
    const optsHtml = g.options.map(o => `
      <label style="display:flex;align-items:center;gap:5px;font-size:.83rem;color:#4a5568;white-space:nowrap;cursor:pointer;padding:2px 0;">
        <input type="checkbox" value="${escHtml(o.value)}" ${checked.has(o.value) ? 'checked' : ''}
          onchange="window._fpToggle('${panelId}','${g.key}',this.value,this.checked);${onChangeExpr}">
        ${escHtml(o.label)}
      </label>`).join('') || '<span style="color:#a0aec0;font-size:.8rem;">（無可選項目）</span>';
    return `<div style="min-width:110px;">
      <div style="font-size:.78rem;color:#718096;font-weight:600;margin-bottom:5px;">${escHtml(g.title)}</div>
      ${optsHtml}
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div style="display:flex;gap:22px;flex-wrap:wrap;">${groupsHtml}</div>
    <div style="margin-top:10px;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="window._fpClearAll('${panelId}');${onChangeExpr}">清除全部</button>
    </div>`;
}
window._fpTogglePanel = (panelId) => {
  if (_fpOpen.has(panelId)) _fpOpen.delete(panelId); else _fpOpen.add(panelId);
  const panel = document.getElementById('fp-panel-' + panelId);
  if (panel) panel.style.display = _fpOpen.has(panelId) ? 'block' : 'none';
};
window._fpToggle = (panelId, groupKey, value, checked) => {
  const reg = _fpRegistry[panelId];
  if (!reg) return;
  if (!(reg.state[groupKey] instanceof Set)) reg.state[groupKey] = new Set();
  if (checked) reg.state[groupKey].add(value); else reg.state[groupKey].delete(value);
};
window._fpClearAll = (panelId) => {
  const reg = _fpRegistry[panelId];
  if (!reg) return;
  reg.groups.forEach(g => { if (reg.state[g.key] instanceof Set) reg.state[g.key].clear(); });
};
// 點面板外或再點一次按鈕收合（比照既有 notif-panel/ml-row-menu 的點外面關閉慣例）
document.addEventListener('click', (e) => {
  if (!_fpOpen.size) return;
  [..._fpOpen].forEach(id => {
    const panel = document.getElementById('fp-panel-' + id);
    const btn = document.getElementById('fp-btn-' + id);
    if (panel && !panel.contains(e.target) && (!btn || !btn.contains(e.target))) {
      _fpOpen.delete(id);
      panel.style.display = 'none';
    }
  });
});

// 個案列表「狀態」勾選群組用：一筆個案在狀態維度可能同時命中多個標籤（OR），
// deleted 與其他標籤互斥（比照改版前 if/else if 的優先序）；past_unclosed 為獨立疊加標籤。
function _caseStatusTags(c) {
  if (c.deleted) return ['deleted'];
  const tags = [c.status === 'closed' ? 'closed' : 'active'];
  if (_hasPastUnclosed(c)) tags.push('past_unclosed');
  return tags;
}

function renderCases() {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';

  // 過濾個案：只有最新學期主責 / 個管 可以看到自己的個案；無主責或已封存者所有人可見
  let visible = casesData;
  if (!isAdmin) {
    const allowedSet = new Set(configData?.users?.[currentUser.email]?.allowedCases || []);
    visible = casesData.filter(c => {
      if (c.archived) return true; // 已封存全員可見
      if (_caseVisibleToUser(c, currentUser.email, allowedSet)) return true;
      return _hasCrisisGrant(c.id); // 危機閱讀當日授權
    });
  }

  // 非管理者看不到已刪除個案
  if (!isAdmin) visible = visible.filter(c => !c.deleted);

  // ── 僅主責/個管篩選 ──
  if (_casesMyOnly) {
    const myAllowed = new Set(configData?.users?.[currentUser?.email]?.allowedCases || []);
    const myAutoManaged = _getAutoManagedCaseIds(currentUser?.email);
    visible = visible.filter(c => {
      const lat = _getLatestCounselorEmail(c);
      return lat === currentUser?.email || myAllowed.has(c.id) || myAutoManaged.has(c.id);
    });
  }
  const _isPrivilegedCases = currentRole === '主任' || extraRole === '管理者';
  const cfMyOnlyWrap = document.getElementById('cf-my-only-wrap');
  if (cfMyOnlyWrap) cfMyOnlyWrap.style.display = _isPrivilegedCases ? '' : 'none';
  const cfMyOnly = document.getElementById('cf-my-only');
  if (cfMyOnly) cfMyOnly.checked = _casesMyOnly;

  // ── 排序鎖定按鈕文字 ──
  const btnSortLock = document.getElementById('btn-sort-lock');
  if (btnSortLock) btnSortLock.textContent = sortStatusLocked ? '結案排後：開' : '結案排後：關';
  const btnArchiveNC = document.getElementById('btn-archive-non-current');
  if (btnArchiveNC) btnArchiveNC.style.display = isAdmin ? '' : 'none';
  const _compactWrap = document.getElementById('cases-table-wrap');
  if (_compactWrap) _compactWrap.classList.toggle('cases-compact', _casesCompact);
  const _compactBtn = document.getElementById('btn-cases-compact');
  if (_compactBtn) _compactBtn.textContent = _casesCompact ? '緊湊：開' : '緊湊：關';

  // ── 學期選單 ──
  const cfSemester = document.getElementById('cf-semester');
  if (cfSemester) {
    const semesters = [...new Set(
      visible.flatMap(c => Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)]).filter(Boolean).map(_semKeyBase)
    )].sort().reverse();
    const prev = caseFilters.semester;
    cfSemester.innerHTML = '<option value="">全部學期</option>' +
      semesters.map(s => `<option value="${escHtml(s)}"${prev === s ? ' selected' : ''}>${escHtml(semesterLabel(s))}</option>`).join('');
  }

  // ── 篩選列 UI 控制 ──
  const cfCounselorWrap = document.getElementById('cf-counselor-wrap');
  const cfCounselor     = document.getElementById('cf-counselor');
  if (cfCounselorWrap) cfCounselorWrap.style.display = isAdmin ? '' : 'none';
  if (isAdmin && cfCounselor) {
    const prev = cfCounselor.value;
    cfCounselor.innerHTML = buildCounselorFilterOpts(prev, true, '全部人員');
  }
  // v173：狀態／封存／案別收合式勾選面板（已刪除僅 admin 可勾，比照改版前 cf-status-deleted 僅 admin 可見）
  _fpSyncPanel('cf', [
    { key: 'status', title: '狀態', options: [
      { value: 'active', label: '進行中' },
      { value: 'closed', label: '已結案' },
      { value: 'past_unclosed', label: '過去學期未結案' },
      ...(isAdmin ? [{ value: 'deleted', label: '已刪除' }] : []),
    ] },
    { key: 'archived', title: '封存', options: [
      { value: 'unarchived', label: '未封存' },
      { value: 'archived', label: '已封存' },
    ] },
    { key: 'abType', title: '案別', options: [
      { value: 'A案', label: 'A案' },
      { value: 'B案', label: 'B案' },
    ] },
  ], caseFilters.groups, 'renderCases()');

  // ── 套用搜尋 / 篩選 ──
  const { q, semester, counselor, dateFrom, dateTo } = caseFilters;
  const cfActiveGroups = {
    status:   [...caseFilters.groups.status],
    archived: [...caseFilters.groups.archived],
    abType:   [...caseFilters.groups.abType],
  };
  // #8：搜尋完整姓名/學號/案號時，用來補回被 archived/status/semester 篩掉的相符個案（權限已在此之前套過）
  const _searchBaseForHint = [...visible];
  // 狀態／封存／案別三維度合併一次判定（同群組 OR、跨群組 AND、全沒勾＝不篩，見 _filterPanelMatch）；
  // 個案列表走輕量 index（部分冷資料個案僅有 index stub，可能缺 abType 欄位），缺值時視為不命中任何特定案別
  visible = visible.filter(c => _filterPanelMatch({
    status:   _caseStatusTags(c),
    archived: c.archived ? ['archived'] : ['unarchived'],
    abType:   [_caseLatestAbType(c)].filter(Boolean),
  }, cfActiveGroups));
  if (semester) visible = visible.filter(c => {
    if (Array.isArray(c.semesters) && c.semesters.length) return _caseHasSem(c, semester);
    return openDateToSemPrefix(c.openDate) === semester;
  });
  if (q) {
    const ql = q.toLowerCase();
    visible = visible.filter(c =>
      (c.name      || '').toLowerCase().includes(ql) ||
      (c.studentId || '').toLowerCase().includes(ql) ||
      (c.id        || '').toLowerCase().includes(ql) ||
      (c.formerIds || []).some(f => (f.id||'').toLowerCase().includes(ql)) // 曾用案號也要能被搜尋命中
    );
  }
  if (counselor) visible = visible.filter(c => {
    const key = c.counselorEmail || c.counselorName || c.counselorText || '';
    return key === counselor;
  });
  if (dateFrom)  visible = visible.filter(c => (c.openDate || '') >= dateFrom);
  if (dateTo)    visible = visible.filter(c => (c.openDate || '') <= dateTo);
  if (caseFilters.mlLeaveFrom || caseFilters.mlLeaveTo) {
    const mlFrom = caseFilters.mlLeaveFrom;
    const mlTo   = caseFilters.mlLeaveTo;
    visible = visible.filter(c => {
      if (!c.studentId) return false;
      return mentalLeavesData.some(l => {
        if (l.deleted || l.studentId !== c.studentId) return false;
        const { from: _lf, to: _lt } = _mlParseDateRange(l);
        if (!_lf) return false;
        if (mlFrom && _lt < mlFrom) return false;
        if (mlTo   && _lf > mlTo)   return false;
        return true;
      });
    });
  }

  // #8：搜尋完整姓名/學號/案號 → 補回被篩掉的相符個案並標記狀態提示
  //   ・本學期未開案（該生歷來有案但本學期無開案紀錄）
  //   ・本學期有開案但已結案／已封存
  const _exactHintMap = new Map();
  if (q) {
    const _qx = q.trim().toLowerCase();
    const _isExact = c => (c.name || '').toLowerCase() === _qx || (c.studentId || '').toLowerCase() === _qx
      || (c.id || '').toLowerCase() === _qx || (c.formerIds || []).some(f => (f.id || '').toLowerCase() === _qx);
    const _visIds = new Set(visible.map(c => c.id));
    _searchBaseForHint.forEach(c => {
      if (!c || c.deleted || !_isExact(c)) return;
      // #8：完整搜尋相符 → 一律顯示本學期開案狀態徽章（含「本學期開案中」），並補回被篩掉者
      _exactHintMap.set(c.id, _semStatusBadgeHtml(c));
      if (!_visIds.has(c.id)) { visible.push(c); _visIds.add(c.id); }
    });
  }

  // 統計（排除已刪除）
  const nonDeleted = visible.filter(c => !c.deleted);
  document.getElementById('stat-total').textContent  = nonDeleted.length;
  document.getElementById('stat-active').textContent = nonDeleted.filter(c => c.status === 'active').length;
  document.getElementById('stat-closed').textContent = nonDeleted.filter(c => c.status === 'closed').length;

  const wrap = document.getElementById('cases-table-wrap');

  if (visible.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="icon">📂</div>
        <p>目前沒有可檢視的個案</p>
      </div>`;
    return;
  }

  // ── 排序 ──
  const myEmail = currentUser?.email;
  const myAllowedCases = new Set(
    (configData?.users?.[myEmail]?.allowedCases || [])
  );
  visible = [...visible].sort((a, b) => {
    if (sortStatusLocked) {
      const aOrd = (!a.deleted && a.status === 'active') ? 0 : 1;
      const bOrd = (!b.deleted && b.status === 'active') ? 0 : 1;
      if (aOrd !== bOrd) return aOrd - bOrd;
    }
    if (caseSort.col) {
      const av = (a[caseSort.col] || '').toLowerCase();
      const bv = (b[caseSort.col] || '').toLowerCase();
      if (av < bv) return -1 * caseSort.dir;
      if (av > bv) return  1 * caseSort.dir;
      return 0;
    }
    const roleScore = c => c.counselorEmail === myEmail ? 0 : myAllowedCases.has(c.id) ? 1 : 2;
    const rd = roleScore(a) - roleScore(b);
    if (rd !== 0) return rd;
    return (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1;
  });

  // 建立「個案ID → 管理員名單」反查表（手動個管 + 派生的「當然個管」）；
  // 每人可能同時具備多個 tag（如手動個管兼督導），一律用 Map<email, Set<tag>> 記錄，渲染時每人各自的 tag 各自成一個徽章
  const caseManagerMap = {};
  Object.entries(configData.users || {}).forEach(([key, info]) => {
    (info.allowedCases || []).forEach(id => {
      if (!caseManagerMap[id]) caseManagerMap[id] = new Map();
      if (!caseManagerMap[id].has(key)) caseManagerMap[id].set(key, new Set());
      caseManagerMap[id].get(key).add('管');
    });
  });
  visible.forEach(c => {
    _getAutoManagersForCase(c.id).forEach(({ email, reason }) => {
      if (!caseManagerMap[c.id]) caseManagerMap[c.id] = new Map();
      if (!caseManagerMap[c.id].has(email)) caseManagerMap[c.id].set(email, new Set());
      const tag = reason.shortTag || (reason.kind === 'supervisor' ? '督' : '兼窗');
      caseManagerMap[c.id].get(email).add(tag);
    });
  });
  // 建立「個案ID → 初談者名單」反查表（權限同個管，badge 不同）
  const caseInitInterviewerMap = {};
  visible.forEach(c => {
    _getInitialInterviewersForCase(c).forEach(email => {
      if (!email || email === c.counselorEmail) return; // 排除主責，避免重複
      if (!caseInitInterviewerMap[c.id]) caseInitInterviewerMap[c.id] = [];
      caseInitInterviewerMap[c.id].push(formatCounselorLabel(email));
    });
  });

  const _semMs = caseFilters.semester ? semesterMonths(caseFilters.semester) : null;
  const transferCaseIds = new Set((transferData||[]).filter(t => t.type === 'incoming' && t.caseId).map(t => t.caseId));

  // 同步勾選狀態：從 _casesSelected 移除不再可見的 ID（封存個案仍可勾選，以便批次解封）
  const visibleIds = new Set(visible.filter(c => !c.deleted).map(c => c.id));
  [..._casesSelected].forEach(id => { if (!visibleIds.has(id)) _casesSelected.delete(id); });
  const allCasesChecked = visibleIds.size > 0 && [...visibleIds].every(id => _casesSelected.has(id));

  const rows = visible.map(c => {
    const cid = escHtml(c.id);
    let actionBtn;
    if (c.deleted) {
      actionBtn = isAdmin
        ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();restoreCaseAdmin('${cid}')">復原個案</button>`
        : '';
    } else if (c.archived) {
      actionBtn = `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();unarchiveCase('${cid}')" title="解除封存後，此個案將重新出現在個案列表的預設檢視中。">♻️ 解除封存</button>`;
    } else {
      const mainBtn = c.status === 'closed'
        ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();reopenCase('${cid}')" data-tip="重新開立此學期個案，將狀態從已結案改回進行中。">重開案</button>`
        : `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();closeCaseConfirm('${cid}')">結案</button>`;
      const canArchive = isAdmin || c.counselorEmail === currentUser?.email;
      const archiveBtn = canArchive
        ? `<button class="btn btn-secondary btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();archiveCase('${cid}')" title="封存後，此個案將在個案列表中預設隱藏（可透過篩選「已封存」查閱）。適用於不再需要主動服務的個案，統計分析仍會計入。">📦 封存個案</button>`
        : '';
      actionBtn = mainBtn + archiveBtn;
    }
    const sessCount = (c.records||[]).filter(r => !r.deleted && r.status !== 'pending' && (!_semMs || _semMs.includes((r.date||'').slice(0,7)))).length;
    const _latestAbType = _caseLatestAbType(c);
    const abBadge = _latestAbType === 'A案' ? '<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:4px;padding:0 5px;font-size:.7rem;font-weight:600;margin-top:2px;">A案</span>'
                  : _latestAbType === 'B案' ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:4px;padding:0 5px;font-size:.7rem;font-weight:600;margin-top:2px;">B案</span>'
                  : '';
    const transferBadge = (c.isTransferCase || transferCaseIds.has(c.id)) ? ' <span class="badge badge-teal">轉銜個案</span>' : '';
    const newCounselorBadge = (() => {
      if (!c.newCounselorAlert?.date) return '';
      if (c.counselorEmail !== currentUser?.email) return '';
      const dismissed = configData?.users?.[currentUser.email]?.dismissedAlerts || [];
      if (dismissed.includes(c.id)) return '';
      if ((Date.now() - new Date(c.newCounselorAlert.date).getTime()) / 86400000 > 7) return '';
      const mmdd = c.newCounselorAlert.date.slice(5,10).replace('-','/');
      return ` <span class="badge badge-orange" style="cursor:default;">新案 ${mmdd} 轉入</span>`;
    })();
    const pastUnclosedSems = _pastUnclosedSems(c);
    const pastUnclosedTag = pastUnclosedSems.length
      ? `<div style="font-size:.72rem;color:#9c4221;background:#feebc8;border-radius:3px;padding:1px 5px;margin-top:3px;display:inline-block;">${pastUnclosedSems.map(s => `<span onclick="event.stopPropagation();showCaseDetailAtSem('${escHtml(cid)}','${escHtml(s)}')" style="cursor:pointer;text-decoration:underline;" data-tip="點選跳至該學期結案評估">${semesterLabel(s)}</span>`).join('、')} 學期未完成結案</div>`
      : '';
    const caseSems = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)].filter(Boolean);
    const displaySems = caseFilters.semester ? caseSems.filter(s => _semKeyBase(s) === caseFilters.semester) : caseSems;
    const semTag = displaySems.length
      ? `<div style="margin-top:3px;">${displaySems.map(s => {
          const dupStyle = _semDupStyle(caseSems, s);
          const { bg, border, color } = dupStyle || _semLightStyle(c, s);
          const tip = dupStyle ? '此學生本學期有多筆開案' : '點選跳至該學期詳細資料';
          return `<span onclick="event.stopPropagation();showCaseDetailAtSem('${cid}','${s}')" style="display:inline-block;background:${bg};border:1px solid ${border};color:${color};border-radius:10px;padding:0 6px;font-size:.73rem;margin:1px 2px;cursor:pointer;" data-tip="${tip}">${escHtml(semesterLabel(s))}</span>`;
        }).join('')}</div>`
      : '';
    const archivedBadge = c.archived ? ' <span style="display:inline-block;background:#e2e8f0;color:#4a5568;border-radius:4px;padding:1px 6px;font-size:.75rem;font-weight:600;">封存</span>' : '';
    const mlRecentBadge = (() => {
      if (!c.studentId || !mentalLeavesData.length) return '';
      const fmt = d => d ? d.slice(5).replace('-', '/') : '';
      const mlFrom = caseFilters.mlLeaveFrom, mlTo = caseFilters.mlLeaveTo;
      if (mlFrom || mlTo) {
        const matched = mentalLeavesData.filter(l => {
          if (l.deleted || l.studentId !== c.studentId) return false;
          const { from: lf, to: lt } = _mlParseDateRange(l);
          if (!lf) return false;
          if (mlFrom && lt < mlFrom) return false;
          if (mlTo   && lf > mlTo)   return false;
          return true;
        });
        if (!matched.length) return '';
        const froms = matched.map(l => _mlParseDateRange(l).from).filter(Boolean).sort();
        const tos   = matched.map(l => _mlParseDateRange(l).to).filter(Boolean).sort();
        const rFrom = froms[0], rTo = tos[tos.length - 1];
        const rangeStr = rFrom !== rTo ? `${fmt(rFrom)}–${fmt(rTo)}` : fmt(rFrom);
        return `<div style="margin-top:3px;"><span style="display:inline-block;background:#e9d8fd;color:#553c9a;border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:600;" title="${matched.length} 筆符合篩選">身心調適假 ${escHtml(rangeStr)}</span></div>`;
      }
      const curSem = currentSemesterPrefix();
      const curSemRecs = mentalLeavesData.filter(l => !l.deleted && l.studentId === c.studentId && l.semester === curSem);
      const _hasConsec3 = _mlSemHasConsec3(curSemRecs);
      const _hasCumul3 = !_hasConsec3 && _mlSemTotalDays(curSemRecs) >= 3;
      const riskBadges = (_hasConsec3 || _hasCumul3)
        ? `<div style="margin-top:3px;">` +
          (_hasConsec3 ? `<span style="display:inline-block;background:#fed7d7;color:#9b2c2c;border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:600;margin-right:3px;">連請三天</span>` : '') +
          (_hasCumul3  ? `<span style="display:inline-block;background:#feebc8;color:#9c4221;border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:600;margin-right:3px;">累計三天</span>` : '') +
          `</div>` : '';
      const thirtyAgo = Date.now() - 30 * 86400000;
      const recent = mentalLeavesData.filter(l => !l.deleted && l.studentId === c.studentId && l.receivedAt && new Date(l.receivedAt).getTime() >= thirtyAgo);
      if (!recent.length) return riskBadges;
      const dates = recent.map(l => _mlParseDateRange(l).from || l.leaveDate || '').filter(Boolean).sort();
      const range = dates.length >= 2 ? `${fmt(dates[0])}–${fmt(dates[dates.length-1])}` : dates[0] ? fmt(dates[0]) : '';
      return riskBadges + `<div style="margin-top:3px;"><span style="display:inline-block;background:#e9d8fd;color:#553c9a;border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:600;" title="近30天有身心調適假紀錄">身心調適假 ${escHtml(range)}</span></div>`;
    })();
    // #8：搜尋完整相符 → 於狀態欄加「本學期開案狀態」徽章（含開案中）
    const _searchHintBadge = _exactHintMap.get(c.id) ? ' ' + _exactHintMap.get(c.id) : '';
    const statusCell = c.deleted
      ? `<span class="badge-case-deleted">已刪除</span>`
      : statusBadge(c.status) + _searchHintBadge + archivedBadge + transferBadge + newCounselorBadge + semTag + (pastUnclosedTag ? '<br>' + pastUnclosedTag : '') + mlRecentBadge;
    const rowBg = !c.deleted && !c.archived && c.status !== 'closed' && pastUnclosedSems.length ? 'background:#fffbeb;' : '';
    const canCheckCase = !c.deleted; // 封存個案也可勾選，以便批次解封
    // 底色優先順序：deleted > archived > closed > pastUnclosed(warm) > active(白)
    const _rowClass = c.deleted ? 'case-deleted-row'
                    : c.archived ? 'case-archived-row'
                    : c.status === 'closed' ? 'case-closed-row'
                    : '';
    return `
    <tr class="${_rowClass}" style="cursor:pointer;${rowBg}" onclick="showCaseDetail('${cid}')">
      <td style="width:36px;text-align:center;" onclick="event.stopPropagation()">${canCheckCase ? `<input type="checkbox" class="case-row-chk" data-id="${cid}" ${_casesSelected.has(c.id)?'checked':''} onchange="_caseChkChange(this)">` : ''}</td>
      <td>${escHtml(c.id || '—')}${abBadge ? `<br>${abBadge}` : ''}</td>
      <td>${escHtml(c.name  || '—')}</td>
      <td>${escHtml(c.studentId || '—')}</td>
      <td>${escHtml(c.counselorName || configData?.users?.[c.counselorEmail]?.name || c.counselorEmail || '—')}${_counselorStatusBadge(c.counselorEmail)}${
        caseManagerMap[c.id] && caseManagerMap[c.id].size
          ? `<div style="font-size:.72rem;margin-top:2px;display:flex;flex-wrap:wrap;">
               ${[...caseManagerMap[c.id].entries()].map(([email, tags]) => _caseBadgeChip([...tags], formatCounselorLabel(email) + (email.startsWith('nomail_') ? '（無 Gmail）' : (configData?.users?.[email]?.disabled ? '（已停用）' : '')))).join('')}
             </div>`
          : ''
      }${
        (caseInitInterviewerMap[c.id] || []).length
          ? `<div style="font-size:.72rem;margin-top:2px;display:flex;flex-wrap:wrap;">
               ${(caseInitInterviewerMap[c.id] || []).map(label => _caseBadgeChip(['初'], label)).join('')}
             </div>`
          : ''
      }</td>
      <td>${statusCell}</td>
      <td style="text-align:center;">${sessCount}</td>
      <td>${escHtml((c.updatedAt || '').slice(0,10) || '—')}</td>
      <td onclick="event.stopPropagation()">${actionBtn}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table id="cases-main-table">
      <colgroup>
        <col id="cases-col-1" style="width:36px;">
        <col id="cases-col-2" style="min-width:70px;">
        <col id="cases-col-3" style="min-width:80px;">
        <col id="cases-col-4" style="min-width:90px;">
        <col id="cases-col-5" style="min-width:180px;width:210px;">
        <col id="cases-col-6" style="min-width:80px;">
        <col id="cases-col-7" style="min-width:60px;">
        <col id="cases-col-8" style="min-width:80px;">
        <col id="cases-col-9" style="min-width:80px;">
      </colgroup>
      <thead>
        <tr>
          <th style="width:36px;text-align:center;" data-col="1">
            <input type="checkbox" id="cases-select-all" title="全選當頁個案"
              ${allCasesChecked && visibleIds.size > 0 ? 'checked' : ''}
              onchange="_casesSelectAll(this.checked)">
          </th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('id')" data-col="2">案號 ${sortArrow('id')}</th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('name')" data-col="3">個案姓名 ${sortArrow('name')}</th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('studentId')" data-col="4">學號 ${sortArrow('studentId')}</th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('counselorName')" data-col="5">主責人員 ${sortArrow('counselorName')}</th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('status')" data-col="6">狀態 ${sortArrow('status')}</th>
          <th style="text-align:center;white-space:nowrap;" data-col="7">服務次數</th>
          <th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCaseSort('updatedAt')" data-col="8">更新日期 ${sortArrow('updatedAt')}</th>
          <th data-col="9">操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  const csa = document.getElementById('cases-select-all');
  if (csa) csa.indeterminate = !allCasesChecked && _casesSelected.size > 0;
  _syncCasesBatchBar();
  _makeTableResizable({ table: document.getElementById('cases-main-table'), colPrefix: 'cases-col-', colNums: [1,2,3,4,5,6,7,8,9], prefKey: 'casesColWidths', skipCols: new Set([1,9]) });
}

function _caseChkChange(el) {
  if (el.checked) _casesSelected.add(el.dataset.id);
  else _casesSelected.delete(el.dataset.id);
  const allIds = [...document.querySelectorAll('.case-row-chk')].map(x => x.dataset.id);
  const allChecked = allIds.length > 0 && allIds.every(id => _casesSelected.has(id));
  const someChecked = allIds.some(id => _casesSelected.has(id));
  const sa = document.getElementById('cases-select-all');
  if (sa) { sa.checked = allChecked; sa.indeterminate = !allChecked && someChecked; }
  _syncCasesBatchBar();
}
function _casesSelectAll(checked) {
  document.querySelectorAll('.case-row-chk').forEach(el => {
    el.checked = checked;
    if (checked) _casesSelected.add(el.dataset.id);
    else _casesSelected.delete(el.dataset.id);
  });
  _syncCasesBatchBar();
}
function _syncCasesBatchBar() {
  const bar = document.getElementById('cases-batch-bar');
  const cnt = document.getElementById('cases-batch-count');
  if (!bar) return;
  if (_casesSelected.size > 0) {
    bar.style.display = 'flex';
    if (cnt) cnt.textContent = `已選 ${_casesSelected.size} 筆`;
    // 依勾選內容顯示對應的批次按鈕（封存個案才顯示解封，反之亦然）
    const sel = [..._casesSelected].map(id => casesData.find(c => c.id === id)).filter(Boolean);
    const hasArchived   = sel.some(c => c.archived);
    const hasUnarchived = sel.some(c => !c.archived);
    const archBtn   = document.getElementById('btn-batch-archive');
    const unarchBtn = document.getElementById('btn-batch-unarchive');
    if (archBtn)   archBtn.style.display   = hasUnarchived ? '' : 'none';
    if (unarchBtn) unarchBtn.style.display = hasArchived   ? '' : 'none';
  } else {
    bar.style.display = 'none';
  }
}

function resetCaseFilters() {
  const sem = currentSemesterPrefix();
  caseFilters = {
    q: '', semester: sem, counselor: '', dateFrom: '', dateTo: '', mlLeaveFrom: '', mlLeaveTo: '',
    groups: { status: new Set(), archived: new Set(['unarchived']), abType: new Set() },
  };
  caseSort = { col: null, dir: 1 };
  localStorage.setItem('scc_semester_pref', sem);
  syncUserPref_({ semesterPref: sem });
  const _mlFromEl = document.getElementById('cf-ml-from');
  const _mlToEl = document.getElementById('cf-ml-to');
  if (_mlFromEl) _mlFromEl.value = '';
  if (_mlToEl) _mlToEl.value = '';
  ['cf-q', 'cf-counselor', 'cf-date-from', 'cf-date-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cfSem = document.getElementById('cf-semester');
  if (cfSem) cfSem.value = sem;
  renderCases();
}

