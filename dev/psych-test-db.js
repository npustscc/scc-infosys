// dev/psych-test-db.js — 心理測驗資料庫頁面＋詳細報告 modal＋轉銜儲存/待轉銜比對
// helper（原檔連續區段一併搬出）（拆 index.html 絞殺者第三十八刀，v285）。
// 內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告。
// 可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  心理測驗資料庫頁面
// ══════════════════════════════════════════════
const PSYCH_TEST_DB_TYPES = ['新生心理測驗'];   // 未來可擴充

function renderPsychTestDBPage() {
  const body = document.getElementById('psych-test-db-body');
  if (!body) return;
  const isAdmin = currentRole === '主任' || extraRole === '管理者';

  // 建立 studentId → { caseId, dept, gender, grade } 快速查找（以最新開案為主）
  const sidToCase = {};
  [...casesData].filter(c => !c.deleted && c.studentId)
    .sort((a, b) => (b.openDate || '').localeCompare(a.openDate || ''))
    .forEach(c => { if (!sidToCase[c.studentId]) sidToCase[c.studentId] = { caseId: c.id, dept: c.department, gender: c.legalGender, grade: c.grade, name: c.name }; });

  // 展平 rows，補 type 欄位
  const allRows = [];
  Object.entries(psychTestDB).forEach(([sid, entries]) => {
    (entries || []).forEach(e => {
      const cInfo = sidToCase[sid] || {};
      allRows.push({ sid, type: e.type || '新生心理測驗', caseId: cInfo.caseId || '', ...e });
    });
  });

  // 學期選項
  const semSet = new Set(allRows.map(r => r.testSemester).filter(Boolean));
  const semOpts = ['', ...[...semSet].sort().reverse()]
    .map(s => `<option value="${escHtml(s)}">${s ? semesterLabel(s) + ' 學期' : '全部學期'}</option>`).join('');
  const typeOpts = `<option value="">— 未選取 —</option>` +
    PSYCH_TEST_DB_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');

  const scoreCell = (v) => {
    if (v === '' || v === undefined || v === null) return '<td style="padding:5px 8px;text-align:center;color:#cbd5e0;">—</td>';
    const n = parseFloat(v);
    const lt = _psychTestLight(n);
    return `<td style="padding:5px 8px;text-align:center;font-size:.82rem;color:${lt.color};font-weight:${n>=80?'700':'400'};">${escHtml(String(v))}</td>`;
  };

  const renderRows = (rows) => {
    if (!rows.length) return '<div style="padding:28px;text-align:center;color:#a0aec0;font-size:.875rem;">沒有符合的資料</div>';
    return `<div style="overflow-x:auto;">
      <table id="psych-db-table" style="width:100%;border-collapse:collapse;font-size:.85rem;">
        <colgroup>
          <col id="pdb-col-1" style="min-width:90px;">
          <col id="pdb-col-2" style="min-width:70px;">
          <col id="pdb-col-3" style="min-width:80px;">
          <col id="pdb-col-4" style="min-width:70px;">
          <col id="pdb-col-5" style="min-width:60px;">
          <col id="pdb-col-6" style="min-width:45px;">
          <col id="pdb-col-7" style="min-width:45px;">
          <col id="pdb-col-8" style="min-width:45px;">
          <col id="pdb-col-9" style="min-width:80px;">
          <col id="pdb-col-10" style="min-width:50px;">
        </colgroup>
        <thead><tr style="background:#edf2f7;text-align:left;">
          <th style="padding:7px 10px;white-space:nowrap;" data-col="1">學號</th>
          <th style="padding:7px 10px;white-space:nowrap;" data-col="2">案號</th>
          <th style="padding:7px 10px;white-space:nowrap;" data-col="3">班級</th>
          <th style="padding:7px 10px;white-space:nowrap;" data-col="4">學期</th>
          <th style="padding:7px 10px;white-space:nowrap;" data-col="5">高關懷</th>
          <th style="padding:7px 10px;text-align:center;white-space:nowrap;" title="整體量表結果" data-col="6">AL</th>
          <th style="padding:7px 10px;text-align:center;white-space:nowrap;" title="外部情境向度" data-col="7">D1</th>
          <th style="padding:7px 10px;text-align:center;white-space:nowrap;" title="內在個人向度" data-col="8">D2</th>
          <th style="padding:7px 10px;white-space:nowrap;" data-col="9">匯入時間</th>
          <th style="padding:7px 10px;" data-col="10"></th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const highColor = (r.highConcern === '是' || r.highConcern === true) ? '#c53030' : '#a0aec0';
          const highW     = (r.highConcern === '是') ? '600' : '400';
          return `<tr style="border-bottom:1px solid #e2e8f0;cursor:pointer;" onclick="showPsychTestDBDetail('${escHtml(r.sid)}','${escHtml(r.testSemester||'')}')">
            <td style="padding:6px 10px;font-family:monospace;font-size:.82rem;">${escHtml(r.sid)}</td>
            <td style="padding:6px 10px;font-family:monospace;font-size:.82rem;color:${r.caseId?'#2b6cb0':'#a0aec0'};">${escHtml(r.caseId || '—')}</td>
            <td style="padding:6px 10px;font-size:.82rem;color:#718096;">${escHtml(r.className || '—')}</td>
            <td style="padding:6px 10px;white-space:nowrap;">${r.testSemester ? escHtml(semesterLabel(r.testSemester)) : '—'}</td>
            <td style="padding:6px 10px;color:${highColor};font-weight:${highW};">${escHtml(String(r.highConcern || '—'))}</td>
            ${scoreCell(r.AL)}${scoreCell(r.D1)}${scoreCell(r.D2)}
            <td style="padding:6px 10px;font-size:.78rem;color:#a0aec0;white-space:nowrap;">${(r.importedAt||'').slice(0,10)||'—'}</td>
            <td style="padding:6px 10px;" onclick="event.stopPropagation()">
              ${isAdmin ? `<button class="btn btn-sm" style="color:#c53030;border-color:#fc8181;font-size:.75rem;"
                onclick="deletePsychTestDBEntry('${escHtml(r.sid)}','${escHtml(r.testSemester||'')}')">刪除${adminOnlyChip(false, true)}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  };

  body.innerHTML = `<div class="card" style="margin-bottom:0;">
    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
      <select id="ptdb-type" onchange="_filterPsychTestDB()"
        style="padding:7px 10px;border:1.5px solid #cbd5e0;border-radius:6px;font-size:.88rem;min-width:140px;">${typeOpts}</select>
      <select id="ptdb-sem" onchange="_filterPsychTestDB()"
        style="padding:7px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:.88rem;">${semOpts}</select>
      <input id="ptdb-search" type="search" placeholder="搜尋學號或案號…" oninput="_filterPsychTestDB()"
        style="padding:7px 12px;border:1px solid #cbd5e0;border-radius:6px;font-size:.88rem;flex:1;min-width:140px;">
      <span id="ptdb-count" style="font-size:.83rem;color:#718096;white-space:nowrap;"></span>
    </div>
    <div id="ptdb-table"><div style="padding:40px;text-align:center;color:#a0aec0;font-size:.9rem;">請選擇「種類」以顯示資料</div></div>
  </div>`;

  window._filterPsychTestDB = () => {
    const type = document.getElementById('ptdb-type')?.value || '';
    const sem  = document.getElementById('ptdb-sem')?.value || '';
    const q    = (document.getElementById('ptdb-search')?.value || '').trim().toLowerCase();
    if (!type) {
      document.getElementById('ptdb-table').innerHTML = '<div style="padding:40px;text-align:center;color:#a0aec0;font-size:.9rem;">請選擇「種類」以顯示資料</div>';
      document.getElementById('ptdb-count').textContent = '';
      return;
    }
    let rows = allRows.filter(r => r.type === type);
    if (sem) rows = rows.filter(r => r.testSemester === sem);
    if (q)   rows = rows.filter(r => r.sid.toLowerCase().includes(q) || (r.caseId||'').toLowerCase().includes(q));
    document.getElementById('ptdb-table').innerHTML = renderRows(rows);
    document.getElementById('ptdb-count').textContent = `${rows.length} 筆`;
    _makeTableResizable({ table: document.getElementById('psych-db-table'), colPrefix: 'pdb-col-', colNums: [1,2,3,4,5,6,7,8,9,10], prefKey: 'psychDbColWidths', skipCols: new Set([10]) });
  };
}

// ──────────────────────────────────────────────
//  心理測驗詳細報告 modal
// ──────────────────────────────────────────────
function showPsychTestDBDetail(sid, sem) {
  const entries = psychTestDB[sid] || [];
  const t = sem ? entries.find(e => e.testSemester === sem) : entries[0];
  if (!t) { showToast('找不到資料', 'error'); return; }

  // 找對應個案
  const caseObj = casesData.find(c => !c.deleted && c.studentId === sid) || null;
  const isAdmin = currentRole === '主任' || extraRole === '管理者';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;';

  const renderReport = (editMode) => {
    const tree = PSYCH_TEST_TREE;
    const dimRows = tree.map(d => {
      const v = t[d.k];
      if (v === undefined || v === null || v === '') return '';
      const lt = _psychTestLight(v);
      const indent = d.i * 18;
      const fs = d.i === 0 ? '1rem' : d.i === 1 ? '.9rem' : d.i === 2 ? '.85rem' : '.82rem';
      const fw = d.i <= 1 ? '700' : d.i === 2 ? '600' : '400';
      const bg = d.i === 0 ? '#ebf8ff' : d.i === 1 ? '#f7fafc' : 'transparent';
      const valCell = editMode
        ? `<input type="number" min="0" max="100" value="${escHtml(String(v))}" data-key="${escHtml(d.k)}"
             style="width:60px;padding:2px 6px;border:1px solid #cbd5e0;border-radius:4px;font-size:.85rem;text-align:center;">`
        : `<span style="color:${lt.color};font-weight:700;">${escHtml(String(v))}</span>`;
      return `<tr style="background:${bg};border-bottom:1px solid #edf2f7;">
        <td style="padding:7px 10px 7px ${indent+10}px;font-size:${fs};font-weight:${fw};color:#2d3748;">${escHtml(d.l)}</td>
        <td style="padding:7px 10px;text-align:center;white-space:nowrap;">
          <span style="background:${lt.bg};color:${lt.color};border-radius:20px;padding:2px 10px;font-size:.85rem;font-weight:700;">${lt.sym || '—'} ${lt.label || ''}</span>
        </td>
        <td style="padding:7px 10px;text-align:center;">${valCell}</td>
      </tr>`;
    }).join('');

    // 綜合分析文字
    const alVal = parseFloat(t.AL);
    const analysis = isNaN(alVal) ? '' :
      alVal >= 90 ? '您目前可能正處在較大的困擾與壓力中，非常建議您尋求學生諮商中心的協助，專業輔導人員可以陪伴您、和您一同釐清困難並提供支持。' :
      alVal >= 80 ? '您最近似乎在某些方面感到相當程度的困擾，建議您主動前往學生諮商中心聊聊，專業人員可以協助您一同面對現況。' :
      '您的整體心理健康狀況目前尚在可接受範圍，若有輕微困擾歡迎隨時到諮商中心聊聊。';

    const studentInfo = [
      caseObj?.department ? `<span><b>系所：</b>${escHtml(caseObj.department)}</span>` : '',
      `<span><b>學號：</b>${escHtml(sid)}</span>`,
      caseObj?.grade ? `<span><b>年級：</b>${escHtml(caseObj.grade)}</span>` : '',
      caseObj?.legalGender ? `<span><b>性別：</b>${escHtml(caseObj.legalGender)}</span>` : '',
      t.className ? `<span><b>班級：</b>${escHtml(t.className)}</span>` : '',
    ].filter(Boolean).join(' &nbsp;|&nbsp; ');

    return `
      <div style="background:#1a5276;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:1rem;font-weight:700;">大專院校學生心理健康關懷量表結果報告</div>
          <div style="font-size:.8rem;opacity:.8;margin-top:3px;">${t.testSemester ? semesterLabel(t.testSemester) + ' 學期' : ''}</div>
        </div>
        <button onclick="this.closest('.ptdb-modal-overlay').remove()" style="background:none;border:none;color:#fff;font-size:1.5rem;cursor:pointer;line-height:1;padding:0 4px;">×</button>
      </div>
      <div style="padding:14px 20px;background:#ebf8ff;border-bottom:1px solid #bee3f8;font-size:.88rem;color:#2c5282;">${studentInfo || `學號：${escHtml(sid)}`}</div>
      ${t.highConcern==='是' ? '<div style="padding:8px 20px;background:#fff5f5;border-bottom:1px solid #fed7d7;font-size:.875rem;color:#c53030;font-weight:600;">⚠ 高關懷個案</div>' : ''}
      ${t.teacherConsent==='是' ? '<div style="padding:8px 20px;background:#ebf8ff;border-bottom:1px solid #bee3f8;font-size:.875rem;color:#2b6cb0;">✓ 同意導師知情</div>' : ''}
      <div style="padding:0 20px 6px;overflow-x:auto;">
        <div id="ptdb-edit-form">
          <table style="width:100%;border-collapse:collapse;margin-top:14px;">
            <thead><tr style="background:#f7fafc;">
              <th style="padding:6px 10px;text-align:left;font-size:.8rem;color:#718096;">向度</th>
              <th style="padding:6px 10px;text-align:center;font-size:.8rem;color:#718096;">燈號</th>
              <th style="padding:6px 10px;text-align:center;font-size:.8rem;color:#718096;">PR值</th>
            </tr></thead>
            <tbody>${dimRows}</tbody>
          </table>
        </div>
        <div style="margin-top:10px;font-size:.78rem;color:#a0aec0;padding-bottom:4px;">
          ○ 黃燈：PR &lt; 80，適應良好 &nbsp;◎ 橙燈：PR 80–89，輕微困擾 &nbsp;● 紅燈：PR ≥ 90，需要關注
        </div>
        ${t.validity ? `<div style="margin-top:10px;padding:8px 12px;background:#f7fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:.875rem;">
          <b>測驗可信度：</b>${escHtml(t.validity)}
        </div>` : ''}
        ${analysis ? `<div style="margin-top:10px;padding:10px 14px;background:#fffaf0;border-radius:6px;border:1px solid #fbd38d;font-size:.875rem;line-height:1.6;">
          <b>綜合分析：</b>${escHtml(analysis)}
        </div>` : ''}
      </div>
      <div style="padding:14px 20px;border-top:1px solid #e2e8f0;background:#f7fafc;border-radius:0 0 10px 10px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="_ptdbPrint()">列印</button>
        ${isAdmin && !editMode ? `<button class="btn btn-sm" style="background:#fff;border-color:#63b3ed;color:#2b6cb0;"
          onclick="_ptdbToggleEdit('${escHtml(sid)}','${escHtml(sem||'')}',true)">編輯${adminOnlyChip(false, true)}</button>` : ''}
        ${isAdmin && editMode ? `<button class="btn btn-primary btn-sm"
          onclick="_ptdbSaveEdit('${escHtml(sid)}','${escHtml(sem||'')}')">儲存</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.ptdb-modal-overlay').remove()">關閉</button>
      </div>`;
  };

  overlay.className = 'ptdb-modal-overlay';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:10px;width:100%;max-width:640px;box-shadow:0 25px 50px rgba(0,0,0,.25);margin:auto;';
  card.innerHTML = renderReport(false);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  window._ptdbPrint = () => {
    const orig = document.body.innerHTML;
    document.body.innerHTML = `<style>body{font-family:sans-serif;font-size:12pt;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:6px;}@media print{body{margin:0;}}</style>` + card.innerHTML;
    window.print();
    document.body.innerHTML = orig;
    location.reload();
  };
  window._ptdbToggleEdit = (sid, sem, on) => { card.innerHTML = renderReport(on); };
  window._ptdbSaveEdit = async (sid, sem) => {
    const inputs = card.querySelectorAll('#ptdb-edit-form input[data-key]');
    const entry = (psychTestDB[sid] || []).find(e => e.testSemester === sem);
    if (!entry) return;
    inputs.forEach(inp => { entry[inp.dataset.key] = inp.value === '' ? '' : inp.value; });
    try {
      showToast('儲存中…');
      await savePsychTestDB();
      auditLog('編輯心理測驗資料庫', null, null, `${sid} ${sem}`);
      showToast('已儲存');
      overlay.remove();
      renderPsychTestDBPage();
    } catch(e) { alert('儲存失敗：' + e.message); }
  };
}

async function deletePsychTestDBEntry(sid, sem) {
  if (!sid) return;
  if (!confirm(`確定要刪除學號 ${sid}${sem ? '、' + semesterLabel(sem) + ' 學期' : ''} 的測驗資料？`)) return;
  if (sem) {
    const arr = psychTestDB[sid];
    if (arr) {
      const i = arr.findIndex(t => t.testSemester === sem);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) delete psychTestDB[sid];
    }
  } else {
    delete psychTestDB[sid];
  }
  const jobId = bgJobAdd(`刪除心理測驗資料庫：${sid}${sem ? ' ' + sem : ''}`);
  try {
    await savePsychTestDB();
    bgJobDone(jobId);
    auditLog(`刪除心理測驗資料庫 ${sid}${sem ? ' ' + sem : ''}`);
    showToast('已刪除');
    renderPsychTestDBPage();
  } catch(e) { bgJobFail(jobId, e.message); alert('刪除失敗：' + e.message); }
}

async function _saveTransferFallback() {
  try {
    await driveUpdateJsonFile(TRANSFER_FILE, { records: transferData });
  } catch(e) {
    if (e.message.includes('找不到')) {
      await driveCreateJsonFile(TRANSFER_FILE, { records: transferData }, DRIVE_FOLDER_ID);
    } else throw e;
  }
  _transferSnapshot = _deepClone(transferData);
}
// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的轉銜紀錄，經 listCommit 依 id upsert/remove。
async function saveTransfer() {
  const diff = _diffListById(_transferSnapshot, transferData);
  if (!diff) { await _saveTransferFallback(); return; }
  const res = await _listCommit(TRANSFER_FILE, diff);
  if (res && res.fallback) { await _saveTransferFallback(); return; }
  if (res && res.data && Array.isArray(res.data.records)) {
    transferData = res.data.records;
    _transferSnapshot = _deepClone(transferData);
  }
}

let _bkWeekMode = false;

function _bkGetMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diff = (dow === 0) ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return _bkFmtDate(date);
}

function setBkListView() {
  _bkListView = true;
  _bkWeekMode = false;
  _bkListPage = 1;
  const fromEl = document.getElementById('bk-list-from');
  if (fromEl && !fromEl.value) fromEl.value = new Date().toISOString().slice(0, 10);
  syncUserPref_({ bkViewMode: 'list' });
  renderBookingsPage();
}

function setBkWeekView() {
  _bkListView = false;
  _bkWeekMode = true;
  _bkDaySpan = 5;
  const el = document.getElementById('booking-date');
  if (el) {
    const base = el.value || _bkFmtDate(new Date());
    el.value = _bkGetMondayOf(base);
  }
  syncUserPref_({ bkViewMode: 'week' });
  renderBookingsPage();
}

function shiftBkWeek(delta) {
  const el = document.getElementById('booking-date');
  if (!el) return;
  const today = new Date();
  const base = el.value || _bkFmtDate(today);
  const monday = _bkGetMondayOf(base);
  const [y, m, d] = monday.split('-').map(Number);
  el.value = _bkFmtDate(new Date(y, m - 1, d + delta * 7));
  _bkWeekMode = true;
  _bkDaySpan = 5;
  renderBookingsPage();
}

function setBkViewSelect(val) {
  if (val === 'week') { setBkWeekView(); }
  else if (val === 'list') { setBkListView(); }
  else { setBkDaySpan(parseInt(val)); }
}

// #5-4：檢視切換改為勾選式 chips（單選語意不變）。統一存成 bkViewMode 這組使用者偏好
// （'1'|'3'|'5'|'week'|'list'），與「我的顏色」等既有偏好相同機制（config.users[email]，見 syncUserPref_／
// applyDrivePrefs），下次進空間預約頁自動還原目前檢視。
function _bkRenderViewChips() {
  const box = document.getElementById('bk-view-chips');
  if (!box) return;
  const cur = _bkListView ? 'list' : _bkWeekMode ? 'week' : String(_bkDaySpan);
  const opts = [['1', '1天'], ['3', '3天'], ['5', '5天'], ['week', '週'], ['list', '列表']];
  box.innerHTML = opts.map(([val, label]) => {
    const sel = cur === val;
    return `<label class="bk-view-chip${sel ? ' bk-view-chip-sel' : ''}" onclick="setBkViewSelect('${val}')">
      <span class="bk-view-chip-box">${sel ? '✓' : ''}</span>${label}
    </label>`;
  }).join('');
}

function setBkDaySpan(n) {
  _bkListView = false;
  _bkWeekMode = false;
  _bkDaySpan = n;
  localStorage.setItem('scc_bk_span', n);
  syncUserPref_({ bkDaySpan: n, bkViewMode: String(n) });
  renderBookingsPage();
}

function _getBkDisplayRooms() {
  const extra = new Set();
  bookingsData.forEach(b => { if (b.room && !ROOMS.includes(b.room)) extra.add(b.room); });
  _getBkCustomRooms().forEach(r => { if (!ROOMS.includes(r)) extra.add(r); });
  return [...ROOMS, ...extra];
}

function renderPendingList() {
  const body = document.getElementById('pending-list-body');
  if (!body) return;
  const q = (document.getElementById('pending-q')?.value || '').trim().toLowerCase();
  const filtered = pendingCasesData.filter(p => {
    if (!q) return true;
    return [p.name, p.studentId, p.idNumber].join(' ').toLowerCase().includes(q);
  });
  if (!filtered.length) {
    body.innerHTML = `<div class="empty-state" style="padding:30px 0;"><div class="icon">📁</div><p>${q ? '查無結果' : '尚無不開案個案'}</p></div>`;
    return;
  }
  body.innerHTML = filtered.map(p => `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #f0f4f8;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:#1a202c;font-size:.95rem;">${escHtml(p.name)}</div>
        <div style="font-size:.8rem;color:#718096;margin-top:3px;">
          ${p.studentId ? '學號：' + escHtml(p.studentId) + '　' : ''}
          ${p.idNumber ? '身分證：' + escHtml(p.idNumber) + '　' : ''}
          ${p.department ? escHtml(p.department) : ''}${p.grade ? ' ' + escHtml(p.grade) + '年級' : ''}
        </div>
        ${p.notes ? `<div style="font-size:.82rem;color:#4a5568;margin-top:4px;white-space:pre-wrap;">${escHtml(p.notes)}</div>` : ''}
        <div style="font-size:.75rem;color:#a0aec0;margin-top:3px;">建立：${(p.createdAt||'').slice(0,10)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;">
        <button class="btn btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="openPendingModal('${escHtml(p.id)}')">編輯</button>
        <button class="btn btn-danger" style="font-size:.8rem;padding:4px 10px;" onclick="deletePendingCase('${escHtml(p.id)}')">刪除</button>
      </div>
    </div>`).join('');
}

let _editingPendingId = null;
function openPendingModal(id) {
  _editingPendingId = id || null;
  const p = id ? pendingCasesData.find(x => x.id === id) : null;
  document.getElementById('pending-modal-title').textContent = p ? '編輯不開案個案' : '新增不開案個案';
  document.getElementById('pnd-name').value = p?.name || '';
  document.getElementById('pnd-student-id').value = p?.studentId || '';
  document.getElementById('pnd-id-number').value = p?.idNumber || '';
  document.getElementById('pnd-birthday').value = p?.birthday || '';
  document.getElementById('pnd-dept').value = p?.department || '';
  document.getElementById('pnd-grade').value = p?.grade || '';
  document.getElementById('pnd-phone').value = p?.phone || '';
  document.getElementById('pnd-notes').value = p?.notes || '';
  document.getElementById('pending-modal-alert').innerHTML = '';
  const modal = document.getElementById('pending-modal');
  modal.style.display = 'flex';
}

function closePendingModal() {
  document.getElementById('pending-modal').style.display = 'none';
}

async function savePendingCase() {
  const name = document.getElementById('pnd-name').value.trim();
  if (!name) {
    document.getElementById('pending-modal-alert').innerHTML = '<div class="alert alert-error">姓名為必填。</div>';
    return;
  }
  const btn = document.querySelector('#pending-modal .btn-primary');
  btn.disabled = true;
  btn.textContent = '儲存中…';
  try {
    const now = new Date().toISOString();
    if (_editingPendingId) {
      const idx = pendingCasesData.findIndex(x => x.id === _editingPendingId);
      if (idx >= 0) {
        pendingCasesData[idx] = { ...pendingCasesData[idx],
          name, studentId: document.getElementById('pnd-student-id').value.trim(),
          idNumber: document.getElementById('pnd-id-number').value.trim(),
          birthday: document.getElementById('pnd-birthday').value,
          department: document.getElementById('pnd-dept').value.trim(),
          grade: document.getElementById('pnd-grade').value,
          phone: document.getElementById('pnd-phone').value.trim(),
          notes: document.getElementById('pnd-notes').value.trim(),
          updatedAt: now };
      }
    } else {
      pendingCasesData.push({ id: 'PND-' + Date.now(), name,
        studentId: document.getElementById('pnd-student-id').value.trim(),
        idNumber: document.getElementById('pnd-id-number').value.trim(),
        birthday: document.getElementById('pnd-birthday').value,
        department: document.getElementById('pnd-dept').value.trim(),
        grade: document.getElementById('pnd-grade').value,
        phone: document.getElementById('pnd-phone').value.trim(),
        notes: document.getElementById('pnd-notes').value.trim(),
        createdAt: now, updatedAt: now });
    }
    await savePendingCases();
    closePendingModal();
    renderPendingList();
  } catch(e) {
    document.getElementById('pending-modal-alert').innerHTML = `<div class="alert alert-error">儲存失敗：${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '儲存';
  }
}

async function deletePendingCase(id) {
  const p = pendingCasesData.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`確定要刪除不開案個案「${p.name}」？`)) return;
  pendingCasesData = pendingCasesData.filter(x => x.id !== id);
  await savePendingCases();
  renderPendingList();
}

function checkPendingMatch() {
  const name = document.getElementById('nc-name')?.value.trim() || '';
  const sid = document.getElementById('nc-student-id')?.value.trim() || '';
  const idn = document.getElementById('nc-id-number')?.value.trim() || '';
  checkCurrentSemesterDuplicate();
  const banner = document.getElementById('nc-pending-match');
  const list = document.getElementById('nc-pending-match-list');
  if (!banner || !list) return;
  if (!pendingCasesData.length) { banner.style.display = 'none'; return; }
  const matches = pendingCasesData.filter(p => {
    if (sid && p.studentId && sid === p.studentId) return true;
    if (idn && p.idNumber && idn === p.idNumber) return true;
    if (name.length >= 2 && p.name.includes(name)) return true;
    return false;
  });
  if (!matches.length) { banner.style.display = 'none'; return; }
  banner.style.display = '';
  list.innerHTML = matches.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#fff;border:1px solid #f6e05e;border-radius:6px;margin-bottom:6px;">
      <div>
        <span style="font-weight:600;color:#744210;">${escHtml(p.name)}</span>
        <span style="font-size:.8rem;color:#92400e;margin-left:8px;">
          ${p.studentId ? '學號：' + escHtml(p.studentId) : ''}
          ${p.idNumber ? '　身分證：' + escHtml(p.idNumber) : ''}
          ${p.department ? '　' + escHtml(p.department) : ''}
        </span>
        ${p.notes ? `<div style="font-size:.8rem;color:#78350f;margin-top:2px;">${escHtml(p.notes.slice(0,80))}${p.notes.length>80?'…':''}</div>` : ''}
        <div style="font-size:.75rem;color:#a0aec0;margin-top:1px;">[不開案個案] 建立於 ${(p.createdAt||'').slice(0,10)}</div>
      </div>
      <button class="btn btn-secondary" style="font-size:.8rem;padding:4px 10px;flex-shrink:0;margin-left:12px;" onclick="fillFromPending('${escHtml(p.id)}')">帶入資料</button>
    </div>`).join('');
  checkCurrentSemesterDuplicate();
}

function checkCurrentSemesterDuplicate() {
  const prefix = currentSemesterPrefix();
  const sid = (document.getElementById('nc-student-id')?.value || '').trim();
  const idn = (document.getElementById('nc-id-number')?.value || '').trim();
  const warn = document.getElementById('nc-semester-dup-warn');
  const list = document.getElementById('nc-semester-dup-list');
  if (!warn || !list) return;
  if (!sid && !idn) { warn.style.display = 'none'; return; }
  const dups = casesData.filter(c =>
    !c.deleted &&
    c.id !== _editingCaseId &&
    _caseHasSem(c, prefix) &&
    ((sid && c.studentId === sid) || (idn && c.idNumber === idn))
  );
  if (!dups.length) { warn.style.display = 'none'; return; }
  warn.style.display = '';
  list.innerHTML = dups.map(d =>
    `<div style="margin-bottom:4px;">
      案號：<strong>${escHtml(d.id)}</strong>　姓名：${escHtml(d.name || '—')}　開案日期：${escHtml(d.openDate || '—')}
      <span onclick="showCaseDetail('${escHtml(d.id)}')" style="color:#2b6cb0;cursor:pointer;text-decoration:underline;margin-left:8px;font-size:.82rem;">查看</span>
    </div>`
  ).join('');
}

function fillFromPending(id) {
  const p = pendingCasesData.find(x => x.id === id);
  if (!p) return;
  if (p.name) document.getElementById('nc-name').value = p.name;
  if (p.studentId) document.getElementById('nc-student-id').value = p.studentId;
  if (p.idNumber) document.getElementById('nc-id-number').value = p.idNumber;
  if (p.department) { document.getElementById('nc-dept').value = p.department; }
  _updateNcCollege();
  if (p.grade) document.getElementById('nc-grade').value = p.grade;
  if (p.phone) document.getElementById('nc-phone').value = p.phone;
  if (p.birthday) {
    const parts = p.birthday.split('-');
    if (parts.length === 3) {
      document.getElementById('nc-birth-year').value = parts[0];
      document.getElementById('nc-birth-month').value = parts[1];
      document.getElementById('nc-birth-day').value = parts[2];
      if (typeof updateBirthRoc === 'function') updateBirthRoc();
    }
  }
  const _ncIdFillP = document.getElementById('nc-id');
  _ncIdFillP.value = generateCaseId();
  _ncIdFillP.classList.remove('_nc-id-flash');
  void _ncIdFillP.offsetWidth;
  _ncIdFillP.classList.add('_nc-id-flash');
  renderCaseIdSuggestions();
  checkCaseIdDuplicate();
  checkCurrentSemesterDuplicate();
  const _dupWarnP = document.getElementById('nc-semester-dup-warn');
  if (_dupWarnP && _dupWarnP.style.display !== 'none') _dupWarnP.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('nc-pending-match').style.display = 'none';
}

// v254：心理測驗匯入區塊拆到 dev/psych-import.js（build 原樣複製）

