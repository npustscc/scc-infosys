// dev/audit-log.js — 稽核日誌模組（auditLog 寫入、稽核頁渲染/篩選/欄寬調整/列展開）
// （拆 index.html 絞殺者第三十五刀，v282）。內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告。
// 可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  稽核日誌
// ══════════════════════════════════════════════
function auditLog(action, caseId = null, recordId = null, detail = null, opts = {}) {
  if (!currentUser) return;
  const entry = {
    t:      new Date().toISOString(),
    email:  currentUser.email,
    name:   configData?.users?.[currentUser.email]?.name || currentUser.name || '',
    action,
    ...(caseId   ? { caseId }   : {}),
    ...(recordId ? { recordId } : {}),
    ...(detail   ? { detail }   : {}),
    ...(opts.major ? { major: true } : {}),
  };
  // 立即更新本地快取，讓 renderBookingsAuditLog 可即時顯示
  if (!Array.isArray(window._auditLogsCache)) window._auditLogsCache = [];
  window._auditLogsCache.push(entry);

  // 併發安全 append（2026-07-09 事故延伸修復）：後端 listCommit append-only 模式（LockService 讀-改-寫，
  // 只 push 這一筆，不比對/不覆寫既有 logs）。後端未部署 → fallback 舊 RMW 整檔覆寫（含建檔分支）。
  (async () => {
    try {
      const res = await _listCommit(AUDIT_LOG_FILE, { upserts: [entry] });
      if (!(res && res.fallback)) return;
      let raw;
      try { raw = await driveReadJson(AUDIT_LOG_FILE); }
      catch { raw = null; /* 檔案尚未建立 */ }
      if (raw === null) {
        // 檔案不在 ROOT_FOLDER_ID 路徑：先嘗試不帶 parentId 建立（Apps Script 預設用 ROOT_FOLDER_ID）
        // 若已存在（可能在 DRIVE_FOLDER_ID 子夾）則用 DRIVE_FOLDER_ID 再試一次
        try { await driveCreateJsonFile('audit_log.json', { logs: [entry] }); }
        catch {
          try { await driveCreateJsonFile('audit_log.json', { logs: [entry] }, DRIVE_FOLDER_ID); }
          catch { /* 已存在則忽略 */ }
        }
        return;
      }
      const data = (Array.isArray(raw?.logs)) ? raw : { logs: [] };
      data.logs.push(entry);
      await driveUpdateJsonFile(AUDIT_LOG_FILE, data);
    } catch (e) { console.warn('audit log failed:', e); }
  })();

  // 非上班（含輪值日非輪值者）+ 看/改個案相關 → 追加到 off_hours_log 共享 feed，並於首次觸發廣播通知
  if (_isCaseRelatedAction(action) && _isOffDutyNow(currentUser.email, entry.t)) {
    const _isPriv = currentRole === '主任' || extraRole === '管理者';
    _appendOffHoursLog({
      id:      `oh-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      type:    'case_action',
      email:   entry.email,
      name:    entry.name,
      action,
      caseId:  caseId  || null,
      recordId: recordId || null,
      detail:  detail  || null,
      isPriv:  _isPriv,
      t:       entry.t,
    }).catch(() => {});
    // 主任/管理者本身活動仍入 feed（供同儕互相監督），但不再向全員推送鈴鐺通知
    if (!_isPriv && !_offHoursNotifiedThisSession) {
      _broadcastOffHoursSession(currentUser.email, 'case_action', action).catch(() => {});
    }
  }
}

const AUDIT_PAGE_CATEGORIES = {
  '空間預約':     a => a.includes('空間預約') || a.includes('同步日曆'),
  '個案列表':     a => ['新增個案','批次匯入個案','刪除個案','復原個案','修改案號','查閱個案','再次開案','同學期強制再開案','個案合併遷移','主案號對調','快速開案'].some(k => a.includes(k)),
  '個案詳細資料': a => ['編輯個案','執行結案','不開案'].some(k => a.includes(k)),
  '晤談紀錄':     a => a.includes('晤談紀錄') || a.includes('晤談記錄'),
  '初次晤談':     a => a.includes('初次晤談') || (a.includes('初談') && !a.includes('初談記錄')),
  '使用者管理':   a => a.includes('使用者'),
  '轉銜管理':     a => a.includes('轉銜'),
  '精神科評估':   a => a.includes('精神科'),
  '系統管理':     a => ['搬移至共用','整合學年','重組 cases','清除逾期','整併主責','連結主責'].some(k => a.includes(k)),
  '身心調適假':   a => a.includes('身心調適假'),
  '待辦事項':     a => a.includes('待辦事項'),
  '心理測驗':     a => a.includes('心理測驗'),
  '個案管理員':   a => a.includes('個案管理員'),
};

function _auditActionColor(a) {
  if (a.includes('刪除')) return 'color:#c0392b;font-weight:600;';
  if (a.includes('復原')) return 'color:#27ae60;font-weight:600;';
  if (a.includes('新增') || a.includes('建立')) return 'color:#2980b9;font-weight:600;';
  if (a.includes('結案')) return 'color:#8e44ad;font-weight:600;';
  return '';
}

function _mkAuditDetail(l) {
  const isCaseId = s => /^\d{7}$/.test(s || '');
  const parts = [];
  if (l.detail) parts.push(`<span style="color:#2d3748;">${escHtml(l.detail)}</span>`);
  if (l.caseId) {
    if (isCaseId(l.caseId)) {
      const c = casesData.find(x => x.id === l.caseId);
      const label = c ? `個案 ${l.caseId}（${c.name}）` : `個案 ${l.caseId}`;
      parts.push(`<span style="color:#1a5276;cursor:pointer;text-decoration:underline;" onclick="showCaseDetail('${escHtml(l.caseId)}')">${escHtml(label)}</span>`);
    } else { parts.push(`<span style="color:#4a5568;">${escHtml(l.caseId)}</span>`); }
  }
  if (l.recordId) parts.push(`<span style="color:#718096;font-size:.78rem;">› 晤談紀錄</span>`);
  return parts.length ? parts.join(' ') : '<span style="color:#a0aec0;">—</span>';
}

function toggleAuditRow(id) {
  const wrap = document.getElementById('alw-' + id);
  const btn = document.querySelector('.audit-detail-toggle[data-idx="' + id + '"]');
  if (!wrap) return;
  if (wrap.dataset.expanded === '1') {
    wrap.classList.add('audit-detail-wrap');
    wrap.dataset.expanded = '0';
    if (btn) btn.textContent = '展開 ▾';
  } else {
    wrap.classList.remove('audit-detail-wrap');
    wrap.dataset.expanded = '1';
    if (btn) btn.textContent = '收起 ▴';
  }
}

function _initAuditDetailToggles() {
  setTimeout(() => {
    document.querySelectorAll('.audit-detail-wrap').forEach(wrap => {
      // With -webkit-line-clamp, scrollHeight returns clamped height; temporarily remove class to get full height
      wrap.classList.remove('audit-detail-wrap');
      const fullH = wrap.scrollHeight;
      wrap.classList.add('audit-detail-wrap');
      const clampedH = wrap.clientHeight;
      if (fullH > clampedH + 4) {
        const btn = wrap.nextElementSibling;
        if (btn && btn.classList.contains('audit-detail-toggle')) btn.style.display = '';
      }
    });
  }, 100);
}

function _makeAuditTableResizable() {
  _makeTableResizable({ table: document.querySelector('#audit-table-wrap table'), colPrefix: 'audit-col-', colNums: [1,2,3,4,5], prefKey: 'auditColWidths', skipCols: window._auditColsHidden || new Set() });
}
function _resetAuditColWidths() {
  _resetTableColWidths({ table: document.querySelector('#audit-table-wrap table'), colPrefix: 'audit-col-', colNums: [1,2,3,4,5], prefKey: 'auditColWidths' });
}

function _mkAuditTable(entries) {
  if (!entries.length) return `<div class="empty-state" style="padding:30px;"><div class="icon">📜</div><p>無符合條件的記錄</p></div>`;
  const colHid = window._auditColsHidden || new Set();
  const thStyle = n => colHid.has(n) ? 'width:26px;min-width:26px;max-width:26px;padding:4px 2px;overflow:hidden;' : '';
  const tdStyle = n => colHid.has(n) ? 'display:none;' : '';
  const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; };
  const fmtClock = iso => { if (!iso) return ''; const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };
  const colBtn = (n, label) => {
    const hid = colHid.has(n);
    return `<th data-col="${n}" style="${thStyle(n)}white-space:nowrap;">${hid ? '' : label + ' '}<span style="font-size:.7rem;opacity:.5;cursor:pointer;user-select:none;" onclick="auditToggleCol(${n})" title="${hid?'展開':'收折'}">${hid?'▷':'◁'}</span></th>`;
  };
  const wrapC = (colN, idx, content) => {
    const id = `${idx}-${colN}`;
    return `<div class="audit-detail-wrap" id="alw-${id}" data-expanded="0">${content}</div><span class="audit-detail-toggle" data-idx="${id}" style="display:none;color:#718096;font-size:.72rem;cursor:pointer;user-select:none;" onclick="toggleAuditRow('${id}')">展開 ▾</span>`;
  };
  const rows = [...entries].reverse().map((l, idx) => `
    <tr>
      <td style="${tdStyle(1)}font-size:.8rem;color:#718096;min-width:52px;vertical-align:top;">${wrapC(1, idx, `${fmtDate(l.t)}<br><span style="color:#a0aec0;">${fmtClock(l.t)}</span>`)}</td>
      <td style="${tdStyle(2)}font-size:.85rem;vertical-align:top;">${wrapC(2, idx, escHtml(l.name || '—'))}</td>
      <td style="${tdStyle(3)}font-size:.75rem;color:#a0aec0;vertical-align:top;">${wrapC(3, idx, escHtml(l.email || '—'))}</td>
      <td style="${tdStyle(4)}font-size:.85rem;${_auditActionColor(l.action)}vertical-align:top;">${wrapC(4, idx, escHtml(l.action))}</td>
      <td style="${tdStyle(5)}font-size:.82rem;vertical-align:top;">${wrapC(5, idx, _mkAuditDetail(l))}</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto;">
      <table>
        <colgroup>
          <col id="audit-col-1"><col id="audit-col-2"><col id="audit-col-3"><col id="audit-col-4"><col id="audit-col-5">
        </colgroup>
        <thead><tr>
          ${colBtn(1,'時間')}${colBtn(2,'操作者')}${colBtn(3,'帳號')}${colBtn(4,'動作')}${colBtn(5,'更動事由')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function renderAuditLog() {
  const body = document.getElementById('audit-body');
  body.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>讀取稽核紀錄中…</p></div>`;

  let logs = [];
  try {
    const data = await driveReadJson(AUDIT_LOG_FILE);
    logs = (data && Array.isArray(data.logs)) ? data.logs : [];
  } catch (e) {
    body.innerHTML = `<div class="alert alert-error">讀取失敗：${escHtml(e.message)}</div>`;
    return;
  }

  // 合併本 session 尚未寫入 Drive 的在地快取（dev 環境 Drive 路徑可能不一致時確保當下操作可見）
  const driveTs = new Set(logs.map(l => l.t));
  const cachedOnly = (window._auditLogsCache || []).filter(l => !driveTs.has(l.t));
  if (cachedOnly.length) {
    logs = [...logs, ...cachedOnly].sort((a, b) => (a.t || '') < (b.t || '') ? -1 : 1);
  }

  // 篩選控制列
  const actions = [...new Set(logs.map(l => l.action))].sort();
  const persons = [...new Set(logs.map(l => l.name || l.email))].sort();

  const filterBar = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
        <select id="af-page" class="field-select" style="max-width:150px;padding:5px 8px;font-size:.85rem;" onchange="filterAuditLog()">
          <option value="">全部頁面</option>
          <optgroup label="個案">
            <option value="個案列表">個案列表</option>
            <option value="個案詳細資料">個案詳細資料</option>
            <option value="晤談紀錄">晤談紀錄</option>
            <option value="初次晤談">初次晤談</option>
          </optgroup>
          <option value="空間預約">空間預約</option>
          <option value="使用者管理">使用者管理</option>
          <option value="轉銜管理">轉銜管理</option>
          <option value="精神科評估">精神科評估</option>
          <option value="系統管理">系統管理</option>
        </select>
        <select id="af-action" class="field-select" style="max-width:150px;padding:5px 8px;font-size:.85rem;" onchange="filterAuditLog()">
          <option value="">全部動作</option>
          ${actions.map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('')}
        </select>
        <select id="af-person" class="field-select" style="max-width:150px;padding:5px 8px;font-size:.85rem;" onchange="filterAuditLog()">
          <option value="">全部人員</option>
          ${persons.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('')}
        </select>
        <button type="button" id="af-more-btn" class="btn btn-secondary btn-sm"
          onclick="const r=document.getElementById('af-row2');const open=r.style.display!=='none';r.style.display=open?'none':'flex';this.textContent=open?'▼ 更多篩選':'▲ 收起';">▲ 收起</button>
        <button class="btn btn-secondary btn-sm" onclick="_bgRefreshClick('稽核紀錄重新整理', () => renderAuditLog())">🔄 重新整理</button>
        <button class="btn btn-secondary btn-sm" onclick="_resetAuditColWidths()" data-tip="清除已儲存的欄寬設定，恢復預設比例">重設欄寬</button>
        <span id="af-count" style="font-size:.82rem;color:#718096;margin-left:auto;">${logs.length} 筆</span>
      </div>
      <div id="af-row2" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="af-case" class="field-input" style="max-width:170px;padding:5px 8px;font-size:.85rem;" placeholder="個案（姓名/案號/學號）" oninput="filterAuditLog()" />
        <input type="date" id="af-date-from" class="field-input" style="max-width:140px;padding:5px 8px;font-size:.85rem;" onchange="filterAuditLog()" />
        <span style="font-size:.85rem;color:#718096;">至</span>
        <input type="date" id="af-date-to" class="field-input" style="max-width:140px;padding:5px 8px;font-size:.85rem;" onchange="filterAuditLog()" />
      </div>
    </div>`;

  // 把 logs 存到全域讓 filterAuditLog 使用
  window._auditLogsCache = logs;

  // 稽核欄位收折狀態（按欄序 1-5）：優先從 Drive configData 讀取，回退 localStorage
  const _auditColKey = 'scc_audit_cols_' + (currentUser?.email || '');
  if (!window._auditColsHidden) {
    try {
      const driveVal = configData?.users?.[currentUser?.email]?.auditColsHidden;
      const raw = driveVal ?? JSON.parse(localStorage.getItem(_auditColKey) || '[]');
      window._auditColsHidden = new Set(raw);
    } catch { window._auditColsHidden = new Set(); }
  }

  body.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>稽核紀錄（共 ${logs.length} 筆）</h3></div>
      <div style="padding:16px;">
        ${filterBar}
        <div id="audit-table-wrap" style="overflow-x:auto;">${_mkAuditTable(logs)}</div>
      </div>
    </div>`;

  // 還原上次篩選條件（或預設篩選本人）
  const _auditKey = 'scc_audit_filter_' + (currentUser?.email || '');
  const _saved = (() => { try { return JSON.parse(localStorage.getItem(_auditKey) || '{}'); } catch { return {}; } })();
  const _myName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  const _afPage   = document.getElementById('af-page');
  const _afAction = document.getElementById('af-action');
  const _afPerson = document.getElementById('af-person');
  const _afFrom   = document.getElementById('af-date-from');
  const _afTo     = document.getElementById('af-date-to');
  if (_afPage)   _afPage.value   = _saved.page   || '';
  if (_afAction) _afAction.value = _saved.action  || '';
  if (_afPerson) _afPerson.value = 'person' in _saved ? (_saved.person || '') : _myName;
  if (_afFrom)   _afFrom.value   = _saved.from    || '';
  if (_afTo)     _afTo.value     = _saved.to      || '';
  filterAuditLog();
}

function filterAuditLog() {
  const logs = window._auditLogsCache || [];
  const page   = document.getElementById('af-page')?.value || '';
  const action = document.getElementById('af-action')?.value || '';
  const person = document.getElementById('af-person')?.value || '';
  const from   = document.getElementById('af-date-from')?.value || '';
  const to     = document.getElementById('af-date-to')?.value || '';
  const caseQ  = (document.getElementById('af-case')?.value || '').trim().toLowerCase();
  // 記憶篩選條件
  try {
    const _auditKey = 'scc_audit_filter_' + (currentUser?.email || '');
    localStorage.setItem(_auditKey, JSON.stringify({ page, action, person }));
  } catch(_) {}

  const filtered = logs.filter(l => {
    if (page   && !(AUDIT_PAGE_CATEGORIES[page]?.(l.action))) return false;
    if (action && l.action !== action) return false;
    if (person && (l.name || l.email) !== person) return false;
    if (from && l.t < from) return false;
    if (to   && l.t.slice(0,10) > to) return false;
    if (caseQ) {
      const cid = (l.caseId || '').toLowerCase();
      if (cid.includes(caseQ)) return true;
      const c = casesData.find(x => x.id === l.caseId);
      if (c) {
        if ((c.name || '').toLowerCase().includes(caseQ)) return true;
        if ((c.studentId || '').toLowerCase().includes(caseQ)) return true;
      }
      return false;
    }
    return true;
  });

  const wrap = document.getElementById('audit-table-wrap');
  if (!wrap) return;

  document.getElementById('af-count').textContent = `${filtered.length} 筆`;
  wrap.innerHTML = _mkAuditTable(filtered);
  _initAuditDetailToggles();
  _makeAuditTableResizable();
}

function auditToggleCol(n) {
  if (!window._auditColsHidden) window._auditColsHidden = new Set();
  if (window._auditColsHidden.has(n)) window._auditColsHidden.delete(n);
  else window._auditColsHidden.add(n);
  const colArr = [...window._auditColsHidden];
  syncUserPref_({ auditColsHidden: colArr });
  filterAuditLog();
}

