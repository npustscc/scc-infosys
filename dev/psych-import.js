// dev/psych-import.js — 心理測驗匯入與批次清理模組（拆 index.html 絞殺者第八刀，v254）。
// 內容為從 index.html 逐字搬出的函式：心理測驗 CSV 匯入（handleImportPsychCSV／importPsychTestCSV）、
// 心理測驗 Excel 匯入／新生測驗資料庫（handleImportPsychExcel／importPsychTestFromExcel／
// showPsychTestPreviewModal）、學期批次刪除（searchCaseForDelete／confirmDeleteCaseFromAdmin／
// openSemesterDeleteModal／promptEmptyCaseDeletion）、資源回收桶（renderRecycleBin／_rbFilter／
// _rbToggleAll／_rbUpdateSelCount／rbBatchPurge／rbPurgeCase／rbRestoreRecord／rbPurgeRecord／
// rbRestorePsy／rbPurgePsy／rbRestoreIi／rbPurgeIi／rbPurgeAll／rbRestoreTransfer／rbPurgeTransfer）、
// 轉銜管理（TRANSFER_INDICATORS／searchTransferRefill／fillTransferFromCase）。
// 頂層無任何執行副作用（只有 function/async function 宣告、一個 const 常數陣列 TRANSFER_INDICATORS，
// 經確認全專案僅此一處宣告、無跨檔重複；後方 index.html 內畢業轉銜管理模組會在 call-time 引用它，
// 屬本檔載入後才會被呼叫，順序沒有問題）。函式內部在呼叫時會引用主檔全域可變狀態（casesData／
// configData／currentUser／extraRole／transferData 等，定義仍留在 index.html），以及主檔與其他
// 拆檔模組內的共用函式（escHtml／setAlert／showLoading／hideLoading／auditLog／showToast／
// bgJobAdd 系列／saveCasesChunks／driveSaveJsonInCases／migrateToChunks／restoreCaseAdmin／
// renderCases／renderTransferPage／saveTransfer／_upsertPsychTestDB／savePsychTestDB／
// _xlsxReadUnlocked／_ckgRangeIndices／_ckgToolbarHtml／_ensureAllFullyLoaded／openDateToSemPrefix／
// semesterLabel／semesterMonths 等），屬 call-time 解析，與其他拆檔模組（utils.js／ft-core.js／
// case-detail.js／case-import.js／initial-interview.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="psych-import.js"></script> 載入（放在
// initial-interview.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ══════════════════════════════════════════════
//  心理測驗 CSV 匯入
// ══════════════════════════════════════════════
function handleImportPsychCSV(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  importPsychTestCSV(file);
}

async function importPsychTestCSV(file) {
  const prog = document.getElementById('import-progress');
  prog.style.display = '';
  prog.innerHTML = '<span style="color:#718096;">解析 CSV 中…</span>';
  const _csvJobId = bgJobAdd('匯入心理測驗 CSV');
  try {
    const text = await file.text();
    const parseCSV = raw => {
      const lines = raw.split(/\r?\n/);
      return lines.map(line => {
        const fields = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
          } else if (ch === ',' && !inQ) {
            fields.push(cur); cur = '';
          } else cur += ch;
        }
        fields.push(cur);
        return fields;
      });
    };

    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV 格式錯誤或無資料列');
    const headers = rows[0].map(h => h.trim());
    const FIELDS = ['學號','姓名','受測學期','班級','AL','D1','D2','F1','F2','F3','F4','S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','同意導師知情','是否為高關懷','問卷有效性'];
    const idx = {};
    FIELDS.forEach(f => { idx[f] = headers.indexOf(f); });
    if (idx['學號'] < 0) throw new Error('找不到「學號」欄位，請確認 CSV 第一列為欄位名稱');

    let matched = 0, updated = 0, notFound = 0;
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
    const _csvNow = new Date().toISOString();
    for (const row of dataRows) {
      const get = f => (idx[f] >= 0 ? (row[idx[f]] || '').trim() : '');
      const sid = get('學號');
      if (!sid) continue;
      const semester = get('受測學期');
      const result = {
        testSemester: semester, className: get('班級'),
        AL: get('AL'), D1: get('D1'), D2: get('D2'), F1: get('F1'), F2: get('F2'), F3: get('F3'), F4: get('F4'),
        S01: get('S01'), S02: get('S02'), S03: get('S03'), S04: get('S04'), S05: get('S05'), S06: get('S06'),
        S07: get('S07'), S08: get('S08'), S09: get('S09'), S10: get('S10'), S11: get('S11'), S12: get('S12'),
        teacherConsent: get('同意導師知情'), highConcern: get('是否為高關懷'), validity: get('問卷有效性'),
        importedAt: _csvNow,
      };
      _upsertPsychTestDB(sid, semester, result);
      const c = casesData.find(x => x.studentId === sid && !x.deleted);
      if (!c) { notFound++; continue; }
      matched++;
      if (!c.psychTestResults) c.psychTestResults = [];
      const existIdx = semester ? c.psychTestResults.findIndex(t => t.testSemester === semester) : -1;
      if (existIdx >= 0) c.psychTestResults[existIdx] = result; else c.psychTestResults.push(result);
      updated++;
    }

    prog.innerHTML = '<span style="color:#718096;">儲存中…</span>';
    await savePsychTestDB();
    await migrateToChunks();
    prog.innerHTML = `<span style="color:#276749;font-weight:600;">✓ 心理測驗資料匯入完成：比對到 ${matched} 筆（更新 ${updated} 筆），${notFound} 筆找不到對應學號。</span>`;
    auditLog(`批次匯入心理測驗結果 ${updated} 筆`);
    bgJobDone(_csvJobId);
  } catch(e) {
    prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e.message)}</span>`;
    bgJobFail(_csvJobId, e.message);
  }
}

// ══════════════════════════════════════════════
//  心理測驗 Excel 匯入（新生測驗資料庫）
// ══════════════════════════════════════════════
function handleImportPsychExcel(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  importPsychTestFromExcel(file);
}

async function importPsychTestFromExcel(file) {
  const prog = document.getElementById('import-progress');
  prog.style.display = '';
  prog.innerHTML = '<span style="color:#718096;">載入 SheetJS 中…</span>';
  prog.innerHTML = '<span style="color:#718096;">讀取檔案中…</span>';
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });
    const ws = wb.Sheets['新生測驗資料庫'];
    if (!ws) throw new Error('找不到「新生測驗資料庫」工作表，請確認檔案格式。');
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) throw new Error('「新生測驗資料庫」工作表無資料列。');
    prog.innerHTML = `<span style="color:#718096;">解析資料中（共 ${rows.length} 列）…</span>`;
    const confirmed = await showPsychTestPreviewModal(rows, prog);
    if (!confirmed) return;
  } catch(e) {
    if (e.xlsxCancelled) { prog.innerHTML = `<span style="color:#c53030;">${escHtml(e.message)}</span>`; return; }
    prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e.message)}</span>`;
  }
}

function showPsychTestPreviewModal(rows, prog) {
  return new Promise(resolve => {
    let modal = document.getElementById('psych-preview-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'psych-preview-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

    const PAGE_SIZE = 20;
    // Match rows to cases and detect duplicates
    const items = rows.map((row, origIdx) => {
      const sid = String(row['學號'] || '').trim();
      const sem = String(row['受測學期'] || '').trim();
      const matchedCase = casesData.find(c => c.studentId === sid && !c.deleted) || null;
      const isDuplicate = !!(matchedCase && (matchedCase.psychTestResults || []).some(t => t.testSemester === sem && sem));
      return { origIdx, row, sid, sem, matchedCase, isDuplicate, selected: !!matchedCase };
    });

    let _tab = 'all', _search = '', _page = 0, _lastClick = -1;

    const getFiltered = () => {
      const q = _search.toLowerCase();
      return items.filter(it => {
        if (_tab === 'matched' && !it.matchedCase) return false;
        if (_tab === 'unmatched' && it.matchedCase) return false;
        if (_tab === 'duplicate' && !it.isDuplicate) return false;
        if (q && !(it.sid.toLowerCase().includes(q) ||
                   (it.row['姓名']||'').toLowerCase().includes(q) ||
                   it.sem.toLowerCase().includes(q))) return false;
        return true;
      });
    };

    const renderTable = () => {
      const filtered = getFiltered();
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (_page >= totalPages) _page = totalPages - 1;
      const pageItems = filtered.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

      const matchedCount = items.filter(i => i.matchedCase).length;
      const unmatchedCount = items.filter(i => !i.matchedCase).length;
      const dupCount = items.filter(i => i.isDuplicate).length;
      const selCount = items.filter(i => i.selected).length;
      const allSel = filtered.length > 0 && filtered.every(i => i.selected);

      const ts = (tab, color) => {
        const on = _tab === tab;
        return `padding:6px 14px;border:none;background:none;cursor:pointer;font-size:.85rem;border-bottom:2px solid ${on?color:'transparent'};margin-bottom:-2px;color:${on?color:'#4a5568'};font-weight:${on?'600':'400'};`;
      };
      const tabs = `<div style="display:flex;margin-bottom:12px;border-bottom:2px solid #e2e8f0;">
        <button type="button" onclick="ptTab('all')" style="${ts('all','#3182ce')}">全部（${items.length}）</button>
        <button type="button" onclick="ptTab('matched')" style="${ts('matched','#276749')}">✓ 已比對（${matchedCount}）</button>
        ${unmatchedCount ? `<button type="button" onclick="ptTab('unmatched')" style="${ts('unmatched','#c53030')}">✗ 未比對（${unmatchedCount}）</button>` : ''}
        ${dupCount ? `<button type="button" onclick="ptTab('duplicate')" style="${ts('duplicate','#dd6b20')}">⚠ 重複（${dupCount}）</button>` : ''}
      </div>`;

      const rowsHtml = pageItems.map((it, ri) => {
        const bg = !it.matchedCase ? '#fff5f5' : it.isDuplicate ? '#fffbeb' : (ri%2===0 ? '#fff' : '#f7fafc');
        const statusCell = !it.matchedCase
          ? '<span style="font-size:.78rem;color:#c53030;">✗ 無對應個案</span>'
          : it.isDuplicate
            ? `<span style="font-size:.78rem;color:#dd6b20;">⚠ 重複（將覆蓋）</span>`
            : '<span style="font-size:.78rem;color:#276749;">✓ 比對成功</span>';
        return `<tr style="background:${bg};opacity:${it.selected?'1':'.45'};">
          <td style="padding:5px 8px;text-align:center;width:32px;"><input type="checkbox" ${it.selected?'checked':''} onclick="ptSel(${it.origIdx},this.checked,event)" style="width:14px;height:14px;cursor:pointer;"></td>
          <td style="padding:5px 8px;font-size:.79rem;color:#4a5568;">${escHtml(it.sid)}</td>
          <td style="padding:5px 8px;font-size:.85rem;font-weight:600;">${escHtml(it.row['姓名']||'—')}</td>
          <td style="padding:5px 8px;font-size:.79rem;color:#718096;">${escHtml(it.sem||'—')}</td>
          <td style="padding:5px 8px;font-size:.79rem;color:#718096;">${escHtml(it.matchedCase?.name||'—')}</td>
          <td style="padding:5px 8px;">${statusCell}</td>
        </tr>`;
      }).join('');

      const pag = totalPages <= 1 ? '' : `<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;font-size:.84rem;color:#4a5568;">
        <button type="button" onclick="ptPg(${_page-1})" ${_page===0?'disabled':''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;cursor:pointer;">‹</button>
        <span>第 ${_page+1} / ${totalPages} 頁（${filtered.length} 筆）</span>
        <button type="button" onclick="ptPg(${_page+1})" ${_page>=totalPages-1?'disabled':''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;cursor:pointer;">›</button>
      </div>`;

      return `${tabs}<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#edf2f7;text-align:left;">
          <th style="padding:6px 8px;width:32px;text-align:center;"><input type="checkbox" ${allSel?'checked':''} onchange="ptSelAll(this.checked)" style="width:14px;height:14px;cursor:pointer;" title="全選/全不選"></th>
          <th style="padding:6px 8px;font-size:.8rem;">學號</th>
          <th style="padding:6px 8px;font-size:.8rem;">姓名</th>
          <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">受測學期</th>
          <th style="padding:6px 8px;font-size:.8rem;">比對個案</th>
          <th style="padding:6px 8px;font-size:.8rem;">狀況</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>${pag}`;
    };

    const rerender = () => {
      const el = modal.querySelector('#pt-tbl'); if (el) el.innerHTML = renderTable();
      const btn = modal.querySelector('#pt-confirm');
      if (btn) { const n = items.filter(i => i.selected).length; btn.textContent = `確認匯入（${n} 筆）`; }
    };

    window.ptTab = (t) => { _tab = t; _page = 0; rerender(); };
    window.ptPg = (p) => { const tot = Math.max(1, Math.ceil(getFiltered().length / PAGE_SIZE)); _page = Math.max(0, Math.min(tot-1, p)); rerender(); };
    window.ptSelAll = (checked) => { getFiltered().forEach(i => { i.selected = checked; }); _lastClick = -1; rerender(); };
    // Shift 範圍計算改呼叫共用純函式 _ckgRangeIndices（見全站批次勾選共用 helper）。
    window.ptSel = (origIdx, checked, evt) => {
      const ids = getFiltered().map(i => i.origIdx);
      const range = (evt?.shiftKey && _lastClick >= 0) ? _ckgRangeIndices(ids, _lastClick, origIdx) : [origIdx];
      range.forEach(id => { items[id].selected = checked; });
      _lastClick = origIdx;
      rerender();
    };

    const selCount = items.filter(i => i.selected).length;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:860px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
          <h3 style="margin:0;color:#1a5276;font-size:1.1rem;">心理測驗資料匯入預覽</h3>
          <div style="color:#718096;font-size:.84rem;margin-top:5px;">共解析 <strong>${items.length}</strong> 筆。已勾選的才會匯入。⚠ 重複代表同學期資料已存在，匯入後將覆蓋。</div>
          <div style="margin-top:10px;"><input type="text" placeholder="搜尋學號 / 姓名 / 受測學期…" style="width:100%;max-width:300px;padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:.87rem;" oninput="ptSearch(this.value)" /></div>
        </div>
        <div id="pt-tbl" style="padding:16px 24px;overflow:auto;flex:1;">${renderTable()}</div>
        <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;flex-shrink:0;">
          <button class="btn btn-secondary" type="button" id="pt-cancel">取消</button>
          <button class="btn btn-primary" type="button" id="pt-confirm">確認匯入（${selCount} 筆）</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    window.ptSearch = (v) => { _search = v; _page = 0; rerender(); };

    modal.querySelector('#pt-cancel').onclick = () => {
      modal.remove();
      prog.innerHTML = '<span style="color:#a0aec0;">已取消匯入。</span>';
      resolve(false);
    };
    modal.querySelector('#pt-confirm').onclick = async () => {
      const selected = items.filter(i => i.selected && i.matchedCase);
      if (selected.length === 0 && !items.some(i => i.selected)) { alert('沒有可匯入的資料（請確認已勾選且有對應個案）。'); return; }
      modal.remove();
      prog.innerHTML = '<span style="color:#718096;">匯入中…</span>';
      try {
        const now = new Date().toISOString();
        let updated = 0;
        // 將所有解析到的資料（含無對應個案）存入 psychTestDB
        items.forEach(it => {
          const get = f => String(it.row[f] || '').trim();
          const sem = get('受測學期');
          const result = {
            testSemester: sem, className: get('班級'),
            AL: get('AL'), D1: get('D1'), D2: get('D2'), F1: get('F1'), F2: get('F2'), F3: get('F3'), F4: get('F4'),
            S01:get('S01'),S02:get('S02'),S03:get('S03'),S04:get('S04'),S05:get('S05'),S06:get('S06'),
            S07:get('S07'),S08:get('S08'),S09:get('S09'),S10:get('S10'),S11:get('S11'),S12:get('S12'),
            teacherConsent: get('同意導師知情'), highConcern: get('是否為高關懷'), validity: get('問卷有效性'),
            importedAt: now,
          };
          _upsertPsychTestDB(it.sid, sem, result);
        });
        // 將勾選且有對應個案的資料存入個案
        selected.forEach(it => {
          const c = it.matchedCase;
          if (!c.psychTestResults) c.psychTestResults = [];
          const get = f => String(it.row[f] || '').trim();
          const sem = get('受測學期');
          const result = {
            testSemester: sem, className: get('班級'),
            AL: get('AL'), D1: get('D1'), D2: get('D2'), F1: get('F1'), F2: get('F2'), F3: get('F3'), F4: get('F4'),
            S01:get('S01'),S02:get('S02'),S03:get('S03'),S04:get('S04'),S05:get('S05'),S06:get('S06'),
            S07:get('S07'),S08:get('S08'),S09:get('S09'),S10:get('S10'),S11:get('S11'),S12:get('S12'),
            teacherConsent: get('同意導師知情'), highConcern: get('是否為高關懷'), validity: get('問卷有效性'),
            importedAt: now,
          };
          const existIdx = sem ? c.psychTestResults.findIndex(t => t.testSemester === sem) : -1;
          if (existIdx >= 0) c.psychTestResults[existIdx] = result;
          else c.psychTestResults.push(result);
          updated++;
        });
        prog.innerHTML = '<span style="color:#718096;">儲存中…</span>';
        const _xlJobId = bgJobAdd('匯入心理測驗（服務總表）');
        try {
          await savePsychTestDB();
          await migrateToChunks();
          prog.innerHTML = `<span style="color:#276749;font-weight:600;">✓ 心理測驗資料匯入完成：共匯入 ${updated} 筆（另有 ${items.length - updated} 筆已存入測驗資料庫，待個案建立時自動帶入）。</span>`;
          auditLog(`批次匯入心理測驗結果 ${updated} 筆（從服務總表）`);
          bgJobDone(_xlJobId);
          resolve(true);
        } catch(e2) {
          prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e2.message)}</span>`;
          bgJobFail(_xlJobId, e2.message);
          resolve(false);
        }
      } catch(e) {
        prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e.message)}</span>`;
        resolve(false);
      }
    };
  });
}

// ══════════════════════════════════════════════
//  學期批次刪除
// ══════════════════════════════════════════════
function searchCaseForDelete(q) {
  const wrap = document.getElementById('case-delete-results');
  if (!wrap) return;
  const v = (q || '').trim();
  if (!v) { wrap.innerHTML = ''; return; }

  const matches = casesData.filter(c =>
    c.id.includes(v) ||
    (c.name || '').includes(v) ||
    (c.studentId || '').includes(v)
  );

  if (!matches.length) {
    wrap.innerHTML = '<p style="font-size:.88rem;color:#718096;padding:4px 0;">找不到符合的個案。</p>';
    return;
  }

  // 依姓名+學號分組（同一個人）
  const groups = new Map();
  matches.forEach(c => {
    const key = (c.studentId || '') + '|' + (c.name || '');
    if (!groups.has(key)) groups.set(key, { name: c.name, studentId: c.studentId, cases: [] });
    groups.get(key).cases.push(c);
  });

  let html = '';
  groups.forEach(({ name, studentId, cases }) => {
    cases.sort((a, b) => (b.openDate || '').localeCompare(a.openDate || ''));
    const rows = cases.map(c => {
      const sem = openDateToSemPrefix(c.openDate);
      const semLabel = sem ? semesterLabel(sem) + ' 學期' : '（無開案日期）';
      const recCount = (c.records || []).filter(r => !r.deleted).length;
      const isDeleted = c.deleted;
      const deletedBadge = isDeleted ? `<span class="badge badge-red" style="font-size:.75rem;margin-left:4px;">已刪除</span>` : '';
      return `<tr>
        <td style="padding:7px 12px;font-size:.86rem;font-family:monospace;">${escHtml(c.id)}</td>
        <td style="padding:7px 12px;font-size:.86rem;">${escHtml(semLabel)}${deletedBadge}</td>
        <td style="padding:7px 12px;font-size:.86rem;color:#718096;">${recCount} 筆記錄</td>
        <td style="padding:7px 12px;">
          <button class="btn btn-danger btn-sm" style="font-size:.78rem;${isDeleted ? 'opacity:.4;cursor:not-allowed;' : ''}"
            ${isDeleted ? 'disabled' : `onclick="confirmDeleteCaseFromAdmin('${escHtml(c.id)}')"`}>
            刪除此學期
          </button>
        </td>
      </tr>`;
    }).join('');
    html += `<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:#f7fafc;padding:10px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;">
        <strong style="font-size:.95rem;">${escHtml(name || '（無姓名）')}</strong>
        ${studentId ? `<span style="color:#718096;font-size:.84rem;">學號：${escHtml(studentId)}</span>` : ''}
        <span style="color:#a0aec0;font-size:.8rem;">${cases.length} 筆個案</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#fafafa;">
          <th style="padding:6px 12px;font-size:.8rem;text-align:left;color:#718096;font-weight:500;">案號</th>
          <th style="padding:6px 12px;font-size:.8rem;text-align:left;color:#718096;font-weight:500;">學期</th>
          <th style="padding:6px 12px;font-size:.8rem;text-align:left;color:#718096;font-weight:500;">晤談記錄</th>
          <th style="padding:6px 12px;font-size:.8rem;text-align:left;color:#718096;font-weight:500;">操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  });
  wrap.innerHTML = html;
}

async function confirmDeleteCaseFromAdmin(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c || c.deleted) return;
  const sem = openDateToSemPrefix(c.openDate);
  const semLabel = sem ? `（${semesterLabel(sem)} 學期）` : '';
  if (!confirm(`確定要刪除個案「${c.name}（${c.id}）」${semLabel}？\n\n此個案將標記為已刪除，管理者可在個案列表中復原。`)) return;

  const idx = casesData.findIndex(x => x.id === caseId);
  const prev = { deleted: c.deleted, deletedBy: c.deletedBy, deletedByName: c.deletedByName, deletedAt: c.deletedAt };
  casesData[idx].deleted       = true;
  casesData[idx].deletedBy     = currentUser.email;
  casesData[idx].deletedByName = configData?.users?.[currentUser.email]?.name || currentUser.name;
  casesData[idx].deletedAt     = new Date().toISOString();
  casesData[idx].updatedAt     = new Date().toISOString();
  showLoading('刪除個案…');
  try {
    await saveCasesChunks(caseId);
    auditLog('刪除個案', caseId);
    hideLoading();
    const q = document.getElementById('case-delete-q')?.value || '';
    searchCaseForDelete(q);
    renderCases();
    setAlert('admin-alert', 'success', `個案「${c.name}（${c.id}）」已刪除。`);
  } catch (err) {
    Object.assign(casesData[idx], prev);
    if (!prev.deleted) {
      delete casesData[idx].deleted; delete casesData[idx].deletedBy;
      delete casesData[idx].deletedByName; delete casesData[idx].deletedAt;
    }
    hideLoading();
    alert('刪除失敗：' + err.message);
  }
}

async function openSemesterDeleteModal() {
  // 破壞性動作：確保所有 cold case 完整資料已載入，避免漏刪 records
  await _ensureAllFullyLoaded('學期批次刪除');
  // 以「記錄日期」+ 「個案 openDate」雙軌分組
  const semMap = new Map();
  const ensureSem = (sem) => {
    if (!semMap.has(sem)) semMap.set(sem, { recCount: 0, psyCount: 0, caseIds: new Set(), openCaseIds: new Set() });
  };
  casesData.filter(c => !c.deleted).forEach(c => {
    // 以 openDate 學期計入個案數（即使沒有記錄也能出現）
    const openSem = openDateToSemPrefix(c.openDate);
    if (openSem) { ensureSem(openSem); semMap.get(openSem).openCaseIds.add(c.id); }
    (c.records || []).filter(r => !r.deleted && r.status !== 'pending').forEach(r => {
      const sem = openDateToSemPrefix(r.date);
      if (!sem) return;
      ensureSem(sem); semMap.get(sem).recCount++; semMap.get(sem).caseIds.add(c.id);
    });
    (c.psychiatristRecords || []).filter(pr => !pr.deleted && pr.status !== 'pending').forEach(pr => {
      const sem = openDateToSemPrefix(pr.date);
      if (!sem) return;
      ensureSem(sem); semMap.get(sem).psyCount++; semMap.get(sem).caseIds.add(c.id);
    });
  });
  const sems = [...semMap.keys()].sort().reverse();
  if (sems.length === 0) { alert('目前沒有任何資料可刪除。'); return; }

  const selectedSems = await new Promise(resolve => {
    let modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    const semRows = sems.map(s => {
      const e = semMap.get(s);
      const psyNote = e.psyCount > 0 ? `，精神科 ${e.psyCount} 筆` : '';
      const recNote = e.recCount > 0 ? `晤談 ${e.recCount} 筆${psyNote}，` : '';
      const totalCaseIds = new Set([...e.caseIds, ...e.openCaseIds]);
      const noRecNote = e.recCount === 0 ? `<span style="color:#c05621;font-size:.79rem;">（僅個案基本資料，無晤談記錄）</span>` : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f0f4f8;cursor:pointer;font-size:.88rem;">
        <input type="checkbox" class="sem-chk" value="${escHtml(s)}" style="width:15px;height:15px;">
        <span style="font-weight:600;min-width:80px;">${escHtml(semesterLabel(s))} 學期</span>
        <span style="color:#718096;font-size:.82rem;">${recNote}${totalCaseIds.size} 個案</span> ${noRecNote}
      </label>`;
    }).join('');
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;">
          <h3 style="margin:0;color:#c53030;font-size:1.1rem;">學期批次刪除</h3>
          <p style="font-size:.84rem;color:#718096;margin:8px 0 0;">依<strong>記錄日期</strong>選擇學期刪除。資料將移入資源回收桶，<strong>30 天後</strong>永久刪除（期間可復原）。</p>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid #e2e8f0;display:flex;gap:8px;">
          ${_ckgToolbarHtml('sem-chk')}
        </div>
        <div style="overflow:auto;flex:1;">${semRows}</div>
        <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;">
          <button class="btn btn-secondary" type="button" id="sdm-cancel">取消</button>
          <button class="btn btn-danger" type="button" id="sdm-next">下一步 ›</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#sdm-cancel').onclick = () => { modal.remove(); resolve(null); };
    modal.querySelector('#sdm-next').onclick = () => {
      const sel = [...modal.querySelectorAll('.sem-chk:checked')].map(c => c.value);
      modal.remove();
      resolve(sel.length ? sel : null);
    };
  });
  if (!selectedSems) return;

  // 計算所選學期包含的月份
  const selMonthSet = new Set(selectedSems.flatMap(s => semesterMonths(s)));
  const now = new Date().toISOString();
  const deletedBy = currentUser.email;
  const deletedByName = configData?.users?.[currentUser.email]?.name || currentUser.name;

  // 以記錄日期篩選，跨所有案件
  const toProcess = [];
  casesData.filter(c => !c.deleted).forEach(c => {
    const recs    = (c.records || []).filter(r => !r.deleted && r.status !== 'pending' && selMonthSet.has((r.date||'').slice(0,7)));
    const psyRecs = (c.psychiatristRecords || []).filter(pr => !pr.deleted && pr.status !== 'pending' && selMonthSet.has((pr.date||'').slice(0,7)));
    if (recs.length || psyRecs.length) toProcess.push({ c, recs, psyRecs });
  });

  const totalRecs = toProcess.reduce((s, {recs}) => s + recs.length, 0);
  const totalPsy  = toProcess.reduce((s, {psyRecs}) => s + psyRecs.length, 0);
  // 所選學期的個案（依 openDate），包含無記錄的個案
  const selSemSet = new Set(selectedSems);
  const casesInSems = casesData.filter(c => !c.deleted && selSemSet.has(openDateToSemPrefix(c.openDate)));
  const psyNote = totalPsy > 0 ? `\n精神科評估：${totalPsy} 筆` : '';
  const caseNote = casesInSems.length > 0 ? `\n個案基本資料：${casesInSems.length} 筆（含無記錄者）` : '';
  if (!confirm(`確定要軟刪除以下資料？\n\n學期：${selectedSems.map(s => semesterLabel(s)).join('、')}\n晤談記錄：${totalRecs} 筆${psyNote}${caseNote}\n\n資料將移至資源回收桶，30 天後永久刪除。`)) return;

  // 記憶體內直接標記（同步、快速）
  for (const { c, recs, psyRecs } of toProcess) {
    recs.forEach(r => { r.deleted = true; r.deletedAt = now; r.deletedBy = deletedBy; r.deletedByName = deletedByName; });
    psyRecs.forEach(pr => { pr.deleted = true; pr.deletedAt = now; pr.deletedBy = deletedBy; pr.deletedByName = deletedByName; });
    c.updatedAt = now;
  }
  const allIds = [...new Set(toProcess.map(({ c }) => c.id))];
  // 所有記錄已刪或本無記錄的個案
  const emptyCases = casesInSems.filter(c => (c.records||[]).every(r => r.deleted));
  renderCases(); // 立即更新 UI，不等儲存
  // 非同步背景儲存
  const jobId = bgJobAdd(
    `批次刪除 ${selectedSems.map(s => semesterLabel(s)).join('、')}`,
    `${totalRecs} 筆記錄，${allIds.length} 個案`
  );
  (async () => {
    try {
      if (allIds.length) {
        await saveCasesChunks(...allIds, (done, total) => {
          bgJobProgress(jobId, Math.round(done / total * 90));
        });
      }
      auditLog(`批次軟刪除學期 ${selectedSems.join('、')} 記錄 ${totalRecs} 筆${totalPsy > 0 ? `，精神科 ${totalPsy} 筆` : ''}`);
      bgJobDone(jobId);
      if (emptyCases.length > 0) {
        await promptEmptyCaseDeletion(emptyCases, now);
      } else {
        showToast(`✓ 已將 ${totalRecs} 筆記錄移入資源回收桶`, 'success');
      }
    } catch(e) {
      bgJobFail(jobId, e.message);
      showToast('批次刪除儲存失敗：' + e.message, 'error', 6000);
    }
  })();
}

async function promptEmptyCaseDeletion(emptyCases, now) {
  return new Promise(resolve => {
    let modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';
    const rows = emptyCases.map(c => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #f0f4f8;cursor:pointer;font-size:.86rem;">
        <input type="checkbox" class="ecd-chk" value="${escHtml(c.id)}" checked style="width:15px;height:15px;">
        <strong style="min-width:80px;">${escHtml(c.id)}</strong>
        <span>${escHtml(c.name||'—')}</span>
        <span style="color:#718096;font-size:.79rem;">${escHtml(c.studentId||'')}</span>
      </label>`).join('');
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:580px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;">
          <h3 style="margin:0;color:#1a5276;font-size:1.1rem;">確認：釋放空個案案號</h3>
          <p style="font-size:.84rem;color:#718096;margin:8px 0 0;">以下 <strong>${emptyCases.length}</strong> 個個案刪除記錄後已無任何晤談紀錄。是否同時刪除個案基本資料（釋放案號）？</p>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid #e2e8f0;display:flex;gap:8px;">
          ${_ckgToolbarHtml('ecd-chk')}
        </div>
        <div style="overflow:auto;flex:1;">${rows}</div>
        <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;">
          <button class="btn btn-secondary" type="button" id="ecd-skip">跳過，保留案號</button>
          <button class="btn btn-danger" type="button" id="ecd-confirm">刪除勾選個案（軟刪除）</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const nowStr = now || new Date().toISOString();
    modal.querySelector('#ecd-skip').onclick = () => { modal.remove(); resolve(); };
    modal.querySelector('#ecd-confirm').onclick = async () => {
      const selIds = [...modal.querySelectorAll('.ecd-chk:checked')].map(c => c.value);
      modal.remove();
      if (!selIds.length) { resolve(); return; }
      const deletedBy = currentUser.email;
      const deletedByName = configData?.users?.[currentUser.email]?.name || currentUser.name;
      const validIds = [];
      for (const caseId of selIds) {
        const idx = casesData.findIndex(c => c.id === caseId);
        if (idx < 0) continue;
        Object.assign(casesData[idx], { deleted:true, deletedAt:nowStr, deletedBy, deletedByName, updatedAt:nowStr });
        validIds.push(caseId);
      }
      renderCases();
      resolve();
      if (!validIds.length) return;
      // 背景儲存
      const jobId2 = bgJobAdd(`刪除空個案基本資料`, `${validIds.length} 筆`);
      try {
        await saveCasesChunks(...validIds, (done, total) => {
          bgJobProgress(jobId2, Math.round(done / total * 90));
        });
        auditLog(`批次軟刪除空個案 ${validIds.length} 筆`);
        bgJobDone(jobId2);
        showToast(`✓ ${validIds.length} 個個案已移入資源回收桶`, 'success');
      } catch(e) {
        bgJobFail(jobId2, e.message);
        showToast('刪除個案失敗：' + e.message, 'error', 6000);
      }
    };
  });
}

// ══════════════════════════════════════════════
//  資源回收桶
// ══════════════════════════════════════════════
function renderRecycleBin() {
  const isAdminUser = currentRole === '主任' || extraRole === '管理者';
  if (!isAdminUser) {
    document.getElementById('recycle-body').innerHTML = '<p style="padding:24px;color:#718096;">僅管理者可檢視資源回收桶。</p>';
    return;
  }
  const now = Date.now();
  const DAYS = 30;
  const daysLeft = (iso) => {
    if (!iso) return DAYS;
    return Math.max(0, Math.ceil((new Date(iso).getTime() + DAYS*86400000 - now) / 86400000));
  };
  const fmt = iso => iso ? iso.slice(0, 10) : '—';

  const deletedCases = casesData.filter(c => c.deleted);
  const deletedRecs = [];
  casesData.forEach(c => {
    (c.records||[]).filter(r=>r.deleted).forEach(r => deletedRecs.push({ caseId:c.id, caseName:c.name||'—', caseAlsoDeleted:!!c.deleted, record:r }));
  });
  const deletedPsy = [];
  casesData.forEach(c => {
    (c.psychiatristRecords||[]).filter(pr=>pr.deleted).forEach(pr => deletedPsy.push({ caseId:c.id, caseName:c.name||'—', caseAlsoDeleted:!!c.deleted, record:pr }));
  });
  const deletedIi = casesData.filter(c => c.initialInterview?.deleted).map(c => ({ caseId:c.id, caseName:c.name||'—', caseAlsoDeleted:!!c.deleted, ii:c.initialInterview }));

  // 轉銜管理軟刪除
  const _trTypeLabel = { withdraw:'教務處轉退學', graduation:'本學期預作畢業', outgoing:'轉出', incoming:'轉入' };
  const deletedTransfer = (transferData||[]).filter(r => r.deleted && _trTypeLabel[r.type]);

  const tab = window._recycleTab || 'cases';
  const expiredCount = deletedCases.filter(c => daysLeft(c.deletedAt) <= 0).length
    + deletedRecs.filter(({record}) => daysLeft(record.deletedAt) <= 0).length
    + deletedPsy.filter(({record}) => daysLeft(record.deletedAt) <= 0).length
    + deletedIi.filter(({ii}) => daysLeft(ii.deletedAt) <= 0).length
    + deletedTransfer.filter(r => daysLeft(r.deletedAt) <= 0).length;

  const daysBadge = (d) => d <= 0
    ? '<span style="color:#c53030;font-size:.78rem;font-weight:700;">已逾期</span>'
    : `<span style="font-size:.82rem;color:${d<=7?'#e53e3e':'#4a5568'};">${d} 天</span>`;

  const tabBtn = (key, label) => `<button type="button" onclick="window._recycleTab='${key}';renderRecycleBin()" style="padding:7px 16px;border:1.5px solid ${tab===key?'#3182ce':'#e2e8f0'};background:${tab===key?'#ebf8ff':'#fff'};color:${tab===key?'#2b6cb0':'#4a5568'};border-radius:6px;cursor:pointer;font-size:.86rem;font-weight:${tab===key?'600':'400'};">${label}</button>`;

  const chkTh = `<th style="padding:7px 10px;width:32px;"><input type="checkbox" title="全選" onchange="_rbToggleAll(this.checked)"></th>`;
  const chkTd = (id, search) => `<td style="padding:6px 10px;"><input type="checkbox" class="rb-chk" data-id="${escHtml(id)}" onchange="_rbUpdateSelCount()"></td>`;

  const caseRows = deletedCases.map(c => {
    const d = daysLeft(c.deletedAt);
    return `<tr class="rb-row" data-search="${escHtml(c.id+' '+(c.name||'')+' '+(c.studentId||''))}" style="${d<=0?'background:#fff5f5;':''}">
      ${chkTd(c.id, '')}
      <td style="padding:6px 10px;font-size:.8rem;color:#4a5568;">${escHtml(c.id)}</td>
      <td style="padding:6px 10px;font-size:.85rem;font-weight:600;">${escHtml(c.name||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(c.studentId||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(c.deletedByName||c.deletedBy||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(fmt(c.deletedAt))}</td>
      <td style="padding:6px 10px;text-align:center;">${daysBadge(d)}</td>
      <td style="padding:6px 10px;text-align:center;white-space:nowrap;">
        ${d>0?`<button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="restoreCaseAdmin('${escHtml(c.id)}');renderRecycleBin();renderCases()">復原</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="rbPurgeCase('${escHtml(c.id)}')">立即永久刪除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#a0aec0;">（無已刪除個案資料）</td></tr>`;

  const recRows = deletedRecs.map(({caseId, caseName, caseAlsoDeleted, record:r}) => {
    const d = daysLeft(r.deletedAt);
    return `<tr class="rb-row" data-search="${escHtml(caseId+' '+caseName)}" style="${d<=0?'background:#fff5f5;':''}">
      ${chkTd(caseId+'|'+r.id, '')}
      <td style="padding:6px 10px;font-size:.8rem;color:#4a5568;">${escHtml(caseId)}</td>
      <td style="padding:6px 10px;font-size:.84rem;">${escHtml(caseName)}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(r.date||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#4a5568;">${escHtml(r.counselorName||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(r.deletedByName||r.deletedBy||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(fmt(r.deletedAt))}</td>
      <td style="padding:6px 10px;text-align:center;">${daysBadge(d)}</td>
      <td style="padding:6px 10px;text-align:center;white-space:nowrap;">
        ${d>0&&!caseAlsoDeleted?`<button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="rbRestoreRecord('${escHtml(caseId)}','${escHtml(r.id)}')">復原</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="rbPurgeRecord('${escHtml(caseId)}','${escHtml(r.id)}')">立即永久刪除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="text-align:center;padding:20px;color:#a0aec0;">（無已刪除晤談記錄）</td></tr>`;

  const psyRows = deletedPsy.map(({caseId, caseName, caseAlsoDeleted, record:pr}) => {
    const d = daysLeft(pr.deletedAt);
    return `<tr class="rb-row" data-search="${escHtml(caseId+' '+caseName)}" style="${d<=0?'background:#fff5f5;':''}">
      ${chkTd(caseId+'|'+pr.id, '')}
      <td style="padding:6px 10px;font-size:.8rem;color:#4a5568;">${escHtml(caseId)}</td>
      <td style="padding:6px 10px;font-size:.84rem;">${escHtml(caseName)}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(pr.date||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(pr.deletedByName||pr.deletedBy||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(fmt(pr.deletedAt))}</td>
      <td style="padding:6px 10px;text-align:center;">${daysBadge(d)}</td>
      <td style="padding:6px 10px;text-align:center;white-space:nowrap;">
        ${d>0&&!caseAlsoDeleted?`<button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="rbRestorePsy('${escHtml(caseId)}','${escHtml(pr.id)}')">復原</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="rbPurgePsy('${escHtml(caseId)}','${escHtml(pr.id)}')">立即永久刪除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#a0aec0;">（無已刪除精神科評估）</td></tr>`;

  const iiRows = deletedIi.map(({caseId, caseName, caseAlsoDeleted, ii}) => {
    const d = daysLeft(ii.deletedAt);
    return `<tr class="rb-row" data-search="${escHtml(caseId+' '+caseName)}" style="${d<=0?'background:#fff5f5;':''}">
      ${chkTd(caseId, '')}
      <td style="padding:6px 10px;font-size:.8rem;color:#4a5568;">${escHtml(caseId)}</td>
      <td style="padding:6px 10px;font-size:.84rem;">${escHtml(caseName)}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(ii.deletedByName||ii.deletedBy||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(fmt(ii.deletedAt))}</td>
      <td style="padding:6px 10px;text-align:center;">${daysBadge(d)}</td>
      <td style="padding:6px 10px;text-align:center;white-space:nowrap;">
        ${d>0&&!caseAlsoDeleted?`<button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="rbRestoreIi('${escHtml(caseId)}')">復原</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="rbPurgeIi('${escHtml(caseId)}')">立即永久刪除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="text-align:center;padding:20px;color:#a0aec0;">（無已刪除初次晤談表）</td></tr>`;

  const transferRows = deletedTransfer.map(r => {
    const d = daysLeft(r.deletedAt);
    const tabTag = _trTypeLabel[r.type] || r.type;
    return `<tr class="rb-row" data-search="${escHtml((r.name||'')+' '+(r.studentId||'')+' '+tabTag)}" style="${d<=0?'background:#fff5f5;':''}">
      ${chkTd(r.id, '')}
      <td style="padding:6px 10px;font-size:.8rem;"><span style="background:#e9d8fd;color:#553c9a;border-radius:4px;padding:1px 6px;font-size:.75rem;">${escHtml(tabTag)}</span></td>
      <td style="padding:6px 10px;font-size:.85rem;font-weight:600;">${escHtml(r.name||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;font-family:monospace;">${escHtml(r.studentId||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(semesterLabel(r.semester)||r.semester||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;">${escHtml(r.deletedByName||r.deletedBy||'—')}</td>
      <td style="padding:6px 10px;font-size:.8rem;color:#718096;white-space:nowrap;">${escHtml(fmt(r.deletedAt))}</td>
      <td style="padding:6px 10px;text-align:center;">${daysBadge(d)}</td>
      <td style="padding:6px 10px;text-align:center;white-space:nowrap;">
        ${d>0?`<button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="rbRestoreTransfer('${escHtml(r.id)}')">復原</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="rbPurgeTransfer('${escHtml(r.id)}')">立即永久刪除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="text-align:center;padding:20px;color:#a0aec0;">（無已刪除轉銜管理資料）</td></tr>`;

  const tableForTab = {
    cases: `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#edf2f7;text-align:left;">
        ${chkTh}<th style="padding:7px 10px;font-size:.8rem;">案號</th><th style="padding:7px 10px;font-size:.8rem;">姓名</th>
        <th style="padding:7px 10px;font-size:.8rem;">學號</th><th style="padding:7px 10px;font-size:.8rem;">刪除者</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">刪除時間</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">剩餘天數</th>
        <th style="padding:7px 10px;font-size:.8rem;text-align:center;">操作</th>
      </tr></thead><tbody>${caseRows}</tbody></table>`,
    records: `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#edf2f7;text-align:left;">
        ${chkTh}<th style="padding:7px 10px;font-size:.8rem;">案號</th><th style="padding:7px 10px;font-size:.8rem;">個案</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">晤談日期</th><th style="padding:7px 10px;font-size:.8rem;">晤談者</th>
        <th style="padding:7px 10px;font-size:.8rem;">刪除者</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">刪除時間</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">剩餘天數</th>
        <th style="padding:7px 10px;font-size:.8rem;text-align:center;">操作</th>
      </tr></thead><tbody>${recRows}</tbody></table>`,
    psy: `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#edf2f7;text-align:left;">
        ${chkTh}<th style="padding:7px 10px;font-size:.8rem;">案號</th><th style="padding:7px 10px;font-size:.8rem;">個案</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">評估日期</th>
        <th style="padding:7px 10px;font-size:.8rem;">刪除者</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">刪除時間</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">剩餘天數</th>
        <th style="padding:7px 10px;font-size:.8rem;text-align:center;">操作</th>
      </tr></thead><tbody>${psyRows}</tbody></table>`,
    ii: `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#edf2f7;text-align:left;">
        ${chkTh}<th style="padding:7px 10px;font-size:.8rem;">案號</th><th style="padding:7px 10px;font-size:.8rem;">個案</th>
        <th style="padding:7px 10px;font-size:.8rem;">刪除者</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">刪除時間</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">剩餘天數</th>
        <th style="padding:7px 10px;font-size:.8rem;text-align:center;">操作</th>
      </tr></thead><tbody>${iiRows}</tbody></table>`,
    transfer: `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#edf2f7;text-align:left;">
        ${chkTh}<th style="padding:7px 10px;font-size:.8rem;">類型（分頁）</th>
        <th style="padding:7px 10px;font-size:.8rem;">姓名</th>
        <th style="padding:7px 10px;font-size:.8rem;">學號</th>
        <th style="padding:7px 10px;font-size:.8rem;">學期</th>
        <th style="padding:7px 10px;font-size:.8rem;">刪除者</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">刪除時間</th>
        <th style="padding:7px 10px;font-size:.8rem;white-space:nowrap;">剩餘天數</th>
        <th style="padding:7px 10px;font-size:.8rem;text-align:center;">操作</th>
      </tr></thead><tbody>${transferRows}</tbody></table>`,
  };

  document.getElementById('recycle-body').innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="recycle-q" class="field-input" placeholder="搜尋姓名、學號或案號…" style="flex:1;min-width:160px;max-width:280px;" oninput="_rbFilter()">
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('recycle-q').value='';_rbFilter()">清除</button>
      <span id="rb-sel-count" style="font-size:.83rem;color:#718096;margin-left:4px;"></span>
      <button id="rb-batch-del-btn" class="btn btn-danger btn-sm" style="display:none;" onclick="rbBatchPurge()">永久刪除勾選項目</button>
      ${expiredCount>0?`<button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="rbPurgeAll()">清除所有逾期項目（${expiredCount}）</button>`:''}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
      ${tabBtn('cases', `個案資料（${deletedCases.length}）`)}
      ${tabBtn('records', `晤談記錄（${deletedRecs.length}）`)}
      ${tabBtn('psy', `精神科評估（${deletedPsy.length}）`)}
      ${tabBtn('ii', `初次晤談表（${deletedIi.length}）`)}
      ${tabBtn('transfer', `轉銜管理（${deletedTransfer.length}）`)}
    </div>
    <div style="background:#fff8e1;border:1px solid #f6d860;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.83rem;color:#7d4e00;">
      刪除的項目保留 <strong>30 天</strong>後永久刪除，期間可復原。點「立即永久刪除」可提前清除單一項目。
    </div>
    <div class="card"><div style="overflow-x:auto;">${tableForTab[tab] || tableForTab.cases}</div></div>`;

  // 還原篩選文字（切換 tab 時保留搜尋內容）
  const savedQ = window._recycleQ || '';
  if (savedQ) { const el = document.getElementById('recycle-q'); if (el) { el.value = savedQ; _rbFilter(); } }
}

function _rbFilter() {
  const q = (document.getElementById('recycle-q')?.value || '').trim().toLowerCase();
  window._recycleQ = q;
  document.querySelectorAll('.rb-row').forEach(row => {
    row.style.display = !q || (row.dataset.search||'').toLowerCase().includes(q) ? '' : 'none';
  });
  _rbUpdateSelCount();
}

function _rbToggleAll(checked) {
  document.querySelectorAll('.rb-chk').forEach(el => { el.checked = checked; });
  _rbUpdateSelCount();
}

function _rbUpdateSelCount() {
  const n = [...document.querySelectorAll('.rb-chk:checked')].filter(el => {
    const row = el.closest('tr'); return !row || row.style.display !== 'none';
  }).length;
  const countEl = document.getElementById('rb-sel-count');
  const btnEl   = document.getElementById('rb-batch-del-btn');
  if (countEl) countEl.textContent = n > 0 ? `已選 ${n} 筆` : '';
  if (btnEl)   btnEl.style.display  = n > 0 ? '' : 'none';
}

async function rbBatchPurge() {
  const tab = window._recycleTab || 'cases';
  const ids = [...document.querySelectorAll('.rb-chk:checked')]
    .filter(el => { const row = el.closest('tr'); return !row || row.style.display !== 'none'; })
    .map(el => el.dataset.id);
  if (!ids.length) { alert('請先勾選要刪除的項目。'); return; }
  if (!confirm(`確定永久刪除已勾選的 ${ids.length} 筆項目？此操作不可復原。`)) return;

  // 記憶體內直接移除（同步），立即更新 UI
  let affected = new Set();
  let auditMsg = '';
  if (tab === 'cases') {
    ids.forEach(caseId => {
      const idx = casesData.findIndex(c => c.id === caseId);
      if (idx < 0) return;
      casesData.splice(idx, 1);
      if (!Array.isArray(casesManifest.deletedIds)) casesManifest.deletedIds = [];
      if (!casesManifest.deletedIds.includes(caseId)) casesManifest.deletedIds.push(caseId);
      affected.add(caseId);
    });
    auditMsg = `批次永久刪除個案 ${ids.join('、')}`;
  } else if (tab === 'records') {
    ids.forEach(id => {
      const [caseId, recordId] = id.split('|');
      const c = casesData.find(c => c.id === caseId);
      if (!c) return;
      const idx = (c.records||[]).findIndex(r => r.id === recordId);
      if (idx >= 0) { c.records.splice(idx, 1); affected.add(caseId); }
    });
    auditMsg = `批次永久刪除晤談記錄 ${ids.length} 筆`;
  } else if (tab === 'psy') {
    ids.forEach(id => {
      const [caseId, recordId] = id.split('|');
      const c = casesData.find(c => c.id === caseId);
      if (!c) return;
      const idx = (c.psychiatristRecords||[]).findIndex(r => r.id === recordId);
      if (idx >= 0) { c.psychiatristRecords.splice(idx, 1); affected.add(caseId); }
    });
    auditMsg = `批次永久刪除精神科評估 ${ids.length} 筆`;
  } else if (tab === 'ii') {
    ids.forEach(caseId => {
      const c = casesData.find(c => c.id === caseId);
      if (!c) return;
      delete c.initialInterview;
      c.updatedAt = new Date().toISOString();
      affected.add(caseId);
    });
    auditMsg = `批次永久刪除初次晤談表 ${ids.length} 筆`;
  }
  renderRecycleBin(); renderCases(); // 立即更新 UI

  // 背景儲存
  const tabLabel = { cases:'個案', records:'晤談記錄', psy:'精神科評估', ii:'初次晤談表' }[tab] || tab;
  const jobId = bgJobAdd(`批次永久刪除 ${tabLabel}`, `${ids.length} 筆`);
  (async () => {
    try {
      if (tab === 'cases') {
        await driveSaveJsonInCases('manifest.json', casesManifest);
        bgJobProgress(jobId, 20);
      }
      const affectedArr = [...affected];
      if (affectedArr.length) {
        await saveCasesChunks(...affectedArr, (done, total) => {
          const base = tab === 'cases' ? 20 : 0;
          bgJobProgress(jobId, base + Math.round(done / total * (100 - base)));
        });
      }
      auditLog(auditMsg);
      bgJobDone(jobId);
      showToast(`✓ 已永久刪除 ${ids.length} 筆${tabLabel}`, 'success');
    } catch(e) {
      bgJobFail(jobId, e.message);
      showToast('批次永久刪除失敗：' + e.message, 'error', 6000);
    }
  })();
}

async function rbPurgeCase(caseId) {
  if (!confirm(`確定立即永久刪除個案 ${caseId}？此操作不可復原。`)) return;
  const idx = casesData.findIndex(c => c.id === caseId);
  if (idx < 0) return;
  const removed = casesData.splice(idx, 1)[0];
  if (!Array.isArray(casesManifest.deletedIds)) casesManifest.deletedIds = [];
  if (!casesManifest.deletedIds.includes(caseId)) casesManifest.deletedIds.push(caseId);
  showLoading('永久刪除中…');
  try {
    await driveSaveJsonInCases('manifest.json', casesManifest);
    await saveCasesChunks(caseId);
    auditLog(`永久刪除個案 ${caseId}`);
    hideLoading(); renderRecycleBin(); renderCases();
  } catch(e) {
    casesData.splice(idx, 0, removed);
    const di = casesManifest.deletedIds.indexOf(caseId);
    if (di >= 0) casesManifest.deletedIds.splice(di, 1);
    hideLoading(); alert('永久刪除失敗：' + e.message);
  }
}

async function rbRestoreRecord(caseId, recordId) {
  const c = casesData.find(c => c.id === caseId);
  if (!c) return;
  const r = (c.records||[]).find(r => r.id === recordId);
  if (!r) return;
  const prev = { deleted:r.deleted, deletedAt:r.deletedAt, deletedBy:r.deletedBy, deletedByName:r.deletedByName };
  delete r.deleted; delete r.deletedAt; delete r.deletedBy; delete r.deletedByName;
  c.updatedAt = new Date().toISOString();
  showLoading('復原記錄…');
  try {
    await saveCasesChunks(caseId);
    auditLog('復原晤談記錄', caseId, recordId);
    hideLoading(); renderRecycleBin();
  } catch(e) {
    Object.assign(r, prev); hideLoading(); alert('復原失敗：' + e.message);
  }
}

async function rbPurgeRecord(caseId, recordId) {
  if (!confirm('確定立即永久刪除此晤談記錄？此操作不可復原。')) return;
  const c = casesData.find(c => c.id === caseId);
  if (!c) return;
  const idx = (c.records||[]).findIndex(r => r.id === recordId);
  if (idx < 0) return;
  const removed = c.records.splice(idx, 1)[0];
  showLoading('永久刪除記錄…');
  try {
    await saveCasesChunks(caseId);
    auditLog('永久刪除晤談記錄', caseId, recordId);
    hideLoading(); renderRecycleBin();
  } catch(e) {
    c.records.splice(idx, 0, removed); hideLoading(); alert('永久刪除失敗：' + e.message);
  }
}

async function rbRestorePsy(caseId, recordId) {
  const c = casesData.find(c => c.id === caseId);
  if (!c) return;
  const pr = (c.psychiatristRecords||[]).find(r => r.id === recordId);
  if (!pr) return;
  const prev = { deleted:pr.deleted, deletedAt:pr.deletedAt, deletedBy:pr.deletedBy, deletedByName:pr.deletedByName };
  delete pr.deleted; delete pr.deletedAt; delete pr.deletedBy; delete pr.deletedByName;
  showLoading('復原精神科評估…');
  try {
    await saveCasesChunks(caseId);
    auditLog('復原精神科評估', caseId, recordId);
    hideLoading(); renderRecycleBin();
  } catch(e) { Object.assign(pr, prev); hideLoading(); alert('復原失敗：'+e.message); }
}

async function rbPurgePsy(caseId, recordId) {
  if (!confirm('確定立即永久刪除此精神科評估紀錄？此操作不可復原。')) return;
  const c = casesData.find(c => c.id === caseId);
  if (!c) return;
  const idx = (c.psychiatristRecords||[]).findIndex(r => r.id === recordId);
  if (idx < 0) return;
  const removed = c.psychiatristRecords.splice(idx, 1)[0];
  showLoading('永久刪除精神科評估…');
  try {
    await saveCasesChunks(caseId);
    auditLog('永久刪除精神科評估', caseId, recordId);
    hideLoading(); renderRecycleBin();
  } catch(e) { c.psychiatristRecords.splice(idx, 0, removed); hideLoading(); alert('永久刪除失敗：'+e.message); }
}

async function rbRestoreIi(caseId) {
  const c = casesData.find(c => c.id === caseId);
  if (!c || !c.initialInterview) return;
  const ii = c.initialInterview;
  const prev = { deleted:ii.deleted, deletedAt:ii.deletedAt, deletedBy:ii.deletedBy, deletedByName:ii.deletedByName };
  delete ii.deleted; delete ii.deletedAt; delete ii.deletedBy; delete ii.deletedByName;
  showLoading('復原初次晤談表…');
  try {
    await saveCasesChunks(caseId);
    auditLog('復原初次晤談表', caseId);
    hideLoading(); renderRecycleBin();
  } catch(e) { Object.assign(ii, prev); hideLoading(); alert('復原失敗：'+e.message); }
}

async function rbPurgeIi(caseId) {
  if (!confirm('確定立即永久刪除此初次晤談表？此操作不可復原。')) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx < 0) return;
  const prev = casesData[cidx].initialInterview;
  delete casesData[cidx].initialInterview;
  showLoading('永久刪除初次晤談表…');
  try {
    await saveCasesChunks(caseId);
    auditLog('永久刪除初次晤談表', caseId);
    hideLoading(); renderRecycleBin();
  } catch(e) { casesData[cidx].initialInterview = prev; hideLoading(); alert('永久刪除失敗：'+e.message); }
}

async function rbPurgeAll() {
  if (!confirm('確定清除所有已逾期（超過30天）的刪除項目？此操作不可復原。')) return;
  const threshold = new Date(Date.now() - 30*86400000).toISOString();
  showLoading('清除逾期項目…');
  try {
    casesData.forEach(c => {
      if (c.records) c.records = c.records.filter(r => !r.deleted || !r.deletedAt || r.deletedAt > threshold);
      if (c.psychiatristRecords) c.psychiatristRecords = c.psychiatristRecords.filter(pr => !pr.deleted || !pr.deletedAt || pr.deletedAt > threshold);
      if (c.initialInterview?.deleted && c.initialInterview.deletedAt && c.initialInterview.deletedAt <= threshold) delete c.initialInterview;
    });
    const toHardDel = casesData.filter(c => c.deleted && c.deletedAt && c.deletedAt <= threshold);
    if (toHardDel.length > 0) {
      if (!Array.isArray(casesManifest.deletedIds)) casesManifest.deletedIds = [];
      toHardDel.forEach(c => { if (!casesManifest.deletedIds.includes(c.id)) casesManifest.deletedIds.push(c.id); });
      casesData = casesData.filter(c => !c.deleted || !c.deletedAt || c.deletedAt > threshold);
      await driveSaveJsonInCases('manifest.json', casesManifest);
    }
    const expiredTransfer = (transferData||[]).filter(r => r.deleted && r.deletedAt && r.deletedAt <= threshold);
    if (expiredTransfer.length > 0) {
      transferData = transferData.filter(r => !r.deleted || !r.deletedAt || r.deletedAt > threshold);
      await saveTransfer();
    }
    await migrateToChunks();
    auditLog('清除逾期刪除項目');
    hideLoading(); renderRecycleBin(); renderCases(); if (window._transferTab) renderTransferPage();
  } catch(e) { hideLoading(); alert('清除失敗：' + e.message); }
}

async function rbRestoreTransfer(recId) {
  const r = (transferData||[]).find(t => t.id === recId);
  if (!r || !r.deleted) return;
  delete r.deleted; delete r.deletedAt; delete r.deletedBy; delete r.deletedByName;
  renderRecycleBin();
  renderTransferPage();
  const jobId = bgJobAdd(`復原轉銜管理：${r.name||r.studentId||recId}`);
  try { await saveTransfer(); bgJobDone(jobId); auditLog('復原轉銜管理紀錄', null, null, `${r.name||''} ${r.studentId||''} type:${r.type}`); }
  catch(e) {
    r.deleted = true; bgJobFail(jobId, e.message);
    renderRecycleBin();
  }
}

async function rbPurgeTransfer(recId) {
  if (!confirm('確定永久刪除此轉銜管理紀錄？此操作不可復原。')) return;
  const idx = (transferData||[]).findIndex(t => t.id === recId);
  if (idx < 0) return;
  const removed = transferData.splice(idx, 1)[0];
  renderRecycleBin();
  renderTransferPage();
  const jobId = bgJobAdd(`永久刪除轉銜管理：${removed.name||removed.studentId||recId}`);
  try { await saveTransfer(); bgJobDone(jobId); auditLog('永久刪除轉銜管理紀錄', null, null, `${removed.name||''} ${removed.studentId||''} type:${removed.type}`); }
  catch(e) { transferData.splice(idx, 0, removed); bgJobFail(jobId, e.message); renderRecycleBin(); }
}

// ══════════════════════════════════════════════
//  轉銜管理
// ══════════════════════════════════════════════
const TRANSFER_INDICATORS = [
  { key: 'i1', label: '嚴重自傷或自殺之虞，致使影響生活與學習' },
  { key: 'i2', label: '嚴重情緒困擾，或經醫師確診有精神或心理疾病，致使影響生活與學習' },
  { key: 'i3', label: '嚴重人際困擾，致使影響身心適應與學習' },
  { key: 'i4', label: '嚴重行為問題（攻擊或傷人傾向等），致使影響生活與學習' },
  { key: 'i5', label: '曾有觸法行為或有曝險之虞，致使影響生活或學習' },
  { key: 'i6', label: '家庭系統嚴重功能不足，致使嚴重影響身心適應與學習' },
  { key: 'i7', label: '曾依法被通報至各主管機關，有適應困難或嚴重影響生活與學習之虞' },
  { key: 'i8', label: '經歷重大創傷或重大災害事件、網路成癮或其他情形，致使嚴重影響身心適應與學習' },
];

function searchTransferRefill(q) {
  const wrap = document.getElementById('ta-refill-results');
  if (!wrap) return;
  if ((q||'').trim().length < 2) { wrap.innerHTML = ''; return; }
  const ql = q.trim().toLowerCase();
  const matches = casesData.filter(c => !c.deleted && (
    (c.name||'').toLowerCase().includes(ql) ||
    (c.studentId||'').toLowerCase().includes(ql) ||
    (c.id||'').toLowerCase().includes(ql)
  )).slice(0, 8);
  if (!matches.length) { wrap.innerHTML = '<div style="color:#718096;font-size:.875rem;">找不到符合的個案</div>'; return; }
  wrap.innerHTML = matches.map(c => `
    <div onclick="fillTransferFromCase('${escHtml(c.id)}')"
      style="padding:8px 12px;border:1px solid #bee3f8;border-radius:6px;margin-bottom:4px;cursor:pointer;background:#fff;display:flex;gap:16px;align-items:center;font-size:.875rem;"
      onmouseover="this.style.background='#ebf8ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;color:#1a5276;min-width:80px;">${escHtml(c.name||'—')}</span>
      <span style="color:#718096;">${escHtml(c.studentId||'—')}</span>
      <span style="color:#718096;font-size:.8rem;">${escHtml(c.id||'—')}</span>
    </div>`).join('');
}

function fillTransferFromCase(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const setV = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
  setV('ta-name', c.name);
  setV('ta-sid', c.studentId);
  setV('ta-id', c.idNumber);
  setV('ta-dept', c.department);
  if (c.birthday) setV('ta-birthday', c.birthday);
  const gSel = document.getElementById('ta-gender');
  if (gSel && c.legalGender) gSel.value = c.legalGender;
  setV('ta-case-id', caseId);
  document.getElementById('ta-refill-q').value = '';
  document.getElementById('ta-refill-results').innerHTML =
    `<div style="color:#276749;background:#f0fff4;border:1px solid #9ae6b4;padding:8px 12px;border-radius:6px;font-size:.875rem;">
      ✓ 已帶入「${escHtml(c.name||'—')}」（${escHtml(caseId)}）的資料，已連結至該個案
    </div>`;
}
