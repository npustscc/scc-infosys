// dev/import-export.js — 匯入輔導服務記錄＋匯出個案 CSV＋記錄批次列印模組
// （拆 index.html 絞殺者第三十刀，v277）。內容為從 index.html 逐字搬出的連續區段
// （Excel 匯入解析與確認流程、CSV 匯出、批次列印 modal 與事件處理記錄表列印樣板）。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告；列印 HTML
// 樣板為 template literal 內容。可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  匯入輔導服務記錄
// ══════════════════════════════════════════════
function handleImportRecordsFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  importCounselingRecords(file);
}

async function importCounselingRecords(file) {
  const prog = document.getElementById('import-progress');
  prog.style.display = '';
  prog.innerHTML = '<span style="color:#718096;">載入 SheetJS 中…</span>';

  prog.innerHTML = '<span style="color:#718096;">讀取檔案中…</span>';
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });

    const ws = wb.Sheets['輔導服務紀錄'] || wb.Sheets['輔導服務記錄'];
    if (!ws) throw new Error('找不到「輔導服務紀錄」工作表，請確認檔案格式。');

    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    prog.innerHTML = `<span style="color:#718096;">解析 ${rows.length - 1} 筆記錄…</span>`;

    const rocToAD = (raw) => {
      const s = String(raw).replace(/\D/g,'');
      if (s.length === 7) { const y = parseInt(s.slice(0,3)) + 1911; return `${y}-${s.slice(3,5)}-${s.slice(5,7)}`; }
      return '';
    };

    const nameMap = new Map();
    casesData.forEach(c => {
      if (!c.name) return;
      if (!nameMap.has(c.name)) nameMap.set(c.name, []);
      nameMap.get(c.name).push(c);
    });

    const findCounselorKey = (nameText) => {
      for (const [key, info] of Object.entries(configData?.users || {})) {
        if (info.name && nameText.includes(info.name)) return key;
      }
      return '';
    };

    const topicClean = (raw) => String(raw).trim().replace(/^\d+\.?\s*/, '');

    // 輔導時段 "星期X(N)" → BK_PERIODS label；無法對應者保留原字串
    const parseImportTime = (raw) => {
      if (!raw) return '';
      const m = raw.match(/\((\d+)\)$/);
      if (m) {
        const n = parseInt(m[1]);
        if (n >= 1 && n <= BK_PERIODS.length) return BK_PERIODS[n - 1].label;
      }
      return raw;
    };

    // 輔導方式 → 介入方式
    const mapInterventionMode = (raw) => {
      const s = String(raw||'').trim();
      if (!s) return '';
      if (/視訊/.test(s)) return '視訊';
      if (/團體/.test(s)) return '團體';
      if (/電話/.test(s)) return '電話關懷';
      if (/mail|email|簡訊/i.test(s)) return 'E-mail/簡訊';
      if (/外展/.test(s)) return '外展訪視';
      if (/面談|個別/.test(s)) return '面談';
      return '其他';
    };

    // 受訪對象 → interviewees 陣列（可能多個，用頓號/逗號分隔）
    const INTERVIEWEE_OPTIONS = ['學生本人','家屬','朋友','伴侶','教職員工生','資源網絡人員'];
    const mapInterviewees = (raw) => {
      const s = String(raw||'').trim();
      if (!s) return [];
      const parts = s.split(/[,，、\/；;]+/).map(x => x.trim()).filter(Boolean);
      return parts.map(p => {
        if (/學生|本人|個案/.test(p)) return '學生本人';
        if (/家屬|家長|父母|親屬/.test(p)) return '家屬';
        if (/朋友|同學/.test(p)) return '朋友';
        if (/伴侶|男友|女友|男朋友|女朋友/.test(p)) return '伴侶';
        if (/教職|教師|老師|職員|工生|教授/.test(p)) return '教職員工生';
        if (/資源|網絡|社工|機構|醫院/.test(p)) return '資源網絡人員';
        return INTERVIEWEE_OPTIONS.find(o => o.includes(p) || p.includes(o)) || '';
      }).filter(Boolean);
    };

    const buildRecord = (r, rowIdx) => {
      const counselorText = String(r[6]||'').trim();
      const counselorKey  = findCounselorKey(counselorText);
      const counselorName = counselorKey ? (formatCounselorLabel(counselorKey) || counselorText) : counselorText;
      const topics = [topicClean(r[9]), topicClean(r[10])].filter(Boolean);
      const serviceItems = [String(r[12]||'').trim(), String(r[13]||'').trim()].filter(Boolean);
      const modeRaw = String(r[7]||'').trim(), intervieweeRaw = String(r[8]||'').trim();
      const interventionMode = mapInterventionMode(modeRaw);
      const interviewees = mapInterviewees(intervieweeRaw);
      const remark = String(r[14]||'').trim();
      const crossUnit = String(r[15]||'').trim(), crossUnitOther = String(r[16]||'').trim();
      const summary = [
        remark,
        crossUnit ? `跨單位聯繫：${crossUnit}${crossUnitOther ? '（'+crossUnitOther+'）' : ''}` : '',
      ].filter(Boolean).join('\n');
      return {
        id: `REC-IMP-${rowIdx}-${Date.now()}`,
        date: rocToAD(String(r[0]||'').trim()),
        time: parseImportTime(String(r[1]||'').trim()),
        counselorEmail: counselorKey,
        counselorName,
        interventionMode,
        interviewees,
        topics,
        serviceItems,
        summary,
        assessment: '',
        nextPlan: '',
        isImported: true,
        createdAt: new Date().toISOString(),
      };
    };

    // ── Phase 1: parse, split matched / unmatched ──
    const matchedItems   = []; // { record, targetCase, studentName, rowIdx }
    const unmatchedItems = []; // { rawRow, record, studentName, rowIdx }

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const dateRaw     = String(r[0]||'').trim();
      const studentName = String(r[2]||'').trim();
      if (!studentName || !dateRaw) continue;
      const date = rocToAD(dateRaw);
      if (!date) continue;

      const candidates = nameMap.get(studentName) || [];
      let targetCase = null;
      if (candidates.length === 1) {
        targetCase = candidates[0];
      } else if (candidates.length > 1) {
        const sorted = candidates
          .filter(c => c.openDate && c.openDate <= date)
          .sort((a, b) => b.openDate.localeCompare(a.openDate));
        targetCase = sorted[0] || candidates[0];
      }

      const rec = buildRecord(r, i);
      if (targetCase) {
        matchedItems.push({ record: rec, targetCase, studentName, rowIdx: i });
      } else {
        unmatchedItems.push({ rawRow: r, record: rec, studentName, rowIdx: i });
      }
    }

    // ── Phase 2: 收集未識別主責人員 ──
    const _ncMapRec = {};
    [...matchedItems, ...unmatchedItems].forEach(item => {
      const ct = String(item.rawRow ? (item.rawRow[6]||'') : '').trim() || item.record.counselorName || '';
      if (!item.record.counselorEmail && ct) {
        if (!_ncMapRec[ct]) {
          _ncMapRec[ct] = { origText: ct, name: ct, role: '兼任諮商心理師',
            key: 'nomail_' + ct.replace(/\s+/g,'') + '_import', count: 0, include: true };
        }
        _ncMapRec[ct].count++;
      }
    });

    // ── Phase 3: show review modal ──
    prog.innerHTML = `<span style="color:#718096;">開啟預覽介面…</span>`;
    await showCounselingImportPreview(matchedItems, unmatchedItems, prog, _ncMapRec, fileSemPrefix);

  } catch(e) {
    if (e.xlsxCancelled) { prog.innerHTML = `<span style="color:#c53030;">${escHtml(e.message)}</span>`; return; }
    auditLog('匯入失敗', null, null, `匯入輔導服務記錄失敗：${e.message}`);
    prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e.message)}</span>`;
  }
}

// 輔導記錄匯入預覽 modal
function showCounselingImportPreview(matchedItems, unmatchedItems, prog, newCounselorsMap, fileSemPrefix) {
  return new Promise(resolve => {
    let modal = document.getElementById('counsel-import-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'counsel-import-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

    const _semMsForFile = fileSemPrefix ? semesterMonths(fileSemPrefix) : [];
    const _isOOR = rec => _semMsForFile.length > 0 && rec.date && !_semMsForFile.includes(rec.date.slice(0,7));

    // 每列維護一個狀態物件（可被使用者修改）
    const unmatchedState = unmatchedItems.map(item => ({
      ...item,
      assignedCaseId: '',
      skip: _isOOR(item.record),
      outOfRange: _isOOR(item.record),
      saveToUnassigned: !_isOOR(item.record),
    }));
    const matchedState = matchedItems.map(item => ({
      ...item,
      skip: _isOOR(item.record),
      outOfRange: _isOOR(item.record),
    }));
    const ciNcMap  = newCounselorsMap || {};
    const ciNcKeys = Object.keys(ciNcMap);
    let _ciShowTab = 'all'; // 'all','unmatched','matched','outofrange','newcounselors'

    const renderModal = () => {
      const filterVal = (modal.querySelector('#ci-filter-input')?.value || '').toLowerCase();
      const showTab = _ciShowTab || 'all';

      const unmatchedVisible = unmatchedState.filter(s => {
        if (showTab === 'matched') return false;
        if (showTab === 'outofrange' && !s.outOfRange) return false;
        if (!filterVal) return true;
        return s.studentName.includes(filterVal) ||
               s.record.date.includes(filterVal) ||
               s.record.counselorName.includes(filterVal);
      });
      const matchedVisible = matchedState.filter(s => {
        if (showTab === 'unmatched') return false;
        if (showTab === 'outofrange' && !s.outOfRange) return false;
        if (!filterVal) return true;
        return s.studentName.includes(filterVal) ||
               s.record.date.includes(filterVal) ||
               s.record.counselorName.includes(filterVal) ||
               s.targetCase.id.includes(filterVal);
      });

      const pendingConfirm = unmatchedState.filter(s => !s.skip && s.assignedCaseId).length
                           + matchedState.filter(s => !s.skip).length;
      const pendingUnmatched = unmatchedState.filter(s => !s.skip && !s.assignedCaseId && s.saveToUnassigned).length;

      // case 搜尋選項（用於 unmatched 的 select）
      const caseOptions = casesData
        .sort((a, b) => (a.name||'').localeCompare(b.name||''))
        .map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name||'—')} （${escHtml(c.id)}）${c.studentId ? ' '+escHtml(c.studentId) : ''}</option>`)
        .join('');

      const unmatchedRows = unmatchedVisible.map((s, vi) => {
        const realIdx = unmatchedState.indexOf(s);
        const skipCls  = s.skip ? 'opacity:.4;' : (!s.saveToUnassigned ? 'opacity:.55;' : '');
        const bgCls    = s.skip ? '#f7fafc' : s.outOfRange ? '#fffbeb' : !s.saveToUnassigned ? '#f7fafc' : s.assignedCaseId ? '#f0fff4' : '#fff5f5';
        const saveLbl  = s.saveToUnassigned ? '<span style="color:#276749;font-size:.75rem;">暫存</span>' : '<span style="color:#a0aec0;font-size:.75rem;">略過</span>';
        return `<tr data-type="unmatched" data-real-idx="${realIdx}" style="background:${bgCls};${skipCls}">
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;text-align:center;">
            <input type="checkbox" ${s.saveToUnassigned?'checked':''} title="勾選後匯入時存入未歸屬記錄" onchange="ciToggleSave(${realIdx},this.checked)">
          </td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;white-space:nowrap;color:#718096;">${escHtml(s.record.date)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.88rem;font-weight:600;">${escHtml(s.studentName)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;color:#4a5568;">
            ${escHtml(s.record.counselorName||'—')}
            ${s.record.interventionMode ? `<br><span style="font-size:.75rem;color:#2b6cb0;">${escHtml(s.record.interventionMode)}</span>` : ''}
            ${(s.record.interviewees||[]).length ? `<br><span style="font-size:.75rem;color:#276749;">${escHtml(s.record.interviewees.join('、'))}</span>` : ''}
          </td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;color:#4a5568;">${escHtml((s.record.topics||[]).join('、')||'—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;min-width:220px;">
            ${s.skip ? '<span style="color:#a0aec0;font-size:.8rem;">已跳過</span>' : `
            <input list="ci-case-list-${realIdx}" class="field-input" style="width:100%;font-size:.82rem;padding:4px 7px;" placeholder="搜尋姓名/案號…"
              data-real-idx="${realIdx}" oninput="ciAssignCase(this)" value="${escHtml(s._searchVal||'')}">
            <datalist id="ci-case-list-${realIdx}">${caseOptions}</datalist>`}
          </td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;text-align:center;">
            <button class="btn btn-secondary btn-sm" style="font-size:.78rem;padding:2px 8px;" onclick="ciToggleSkip('unmatched',${realIdx},event)">${s.skip ? '取消跳過' : '跳過'}</button>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="7" style="text-align:center;padding:20px;color:#a0aec0;">（無符合條件的記錄）</td></tr>`;

      const matchedRows = matchedVisible.map((s, vi) => {
        const realIdx = matchedState.indexOf(s);
        const skipCls = s.skip ? 'opacity:.4;' : '';
        return `<tr data-type="matched" data-real-idx="${realIdx}" style="background:${s.skip ? '#f7fafc' : s.outOfRange ? '#fffbeb' : '#fff'};${skipCls}">
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;white-space:nowrap;color:#718096;">${escHtml(s.record.date)}${s.outOfRange ? ' <span style="font-size:.7rem;color:#c05621;background:#feebc8;border-radius:3px;padding:0 3px;">超出範圍</span>' : ''}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.88rem;font-weight:600;">${escHtml(s.studentName)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;color:#4a5568;">
            ${escHtml(s.record.counselorName||'—')}
            ${s.record.interventionMode ? `<br><span style="font-size:.75rem;color:#2b6cb0;">${escHtml(s.record.interventionMode)}</span>` : ''}
            ${(s.record.interviewees||[]).length ? `<br><span style="font-size:.75rem;color:#276749;">${escHtml(s.record.interviewees.join('、'))}</span>` : ''}
          </td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;font-size:.82rem;color:#4a5568;">${escHtml((s.record.topics||[]).join('、')||'—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;">
            <span style="font-size:.82rem;color:#276749;">${escHtml(s.targetCase.id)}</span>
            <span style="font-size:.78rem;color:#718096;margin-left:6px;">${escHtml(s.targetCase.name||'')}</span>
          </td>
          <td style="padding:7px 10px;border-bottom:1px solid #edf2f7;text-align:center;">
            <button class="btn btn-secondary btn-sm" style="font-size:.78rem;padding:2px 8px;" onclick="ciToggleSkip('matched',${realIdx},event)">${s.skip ? '取消跳過' : '跳過'}</button>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="6" style="text-align:center;padding:20px;color:#a0aec0;">（無符合條件的記錄）</td></tr>`;

      const tabStyle = (active) => active
        ? 'padding:6px 16px;border:1.5px solid #2b6cb0;background:#ebf8ff;color:#2b6cb0;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:600;'
        : 'padding:6px 16px;border:1.5px solid #e2e8f0;background:#fff;color:#4a5568;border-radius:6px;cursor:pointer;font-size:.85rem;';
      const oorTabStyle = (active) => active
        ? 'padding:6px 16px;border:1.5px solid #c05621;background:#fffbeb;color:#c05621;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:600;'
        : 'padding:6px 16px;border:1.5px solid #ed8936;background:#fff;color:#c05621;border-radius:6px;cursor:pointer;font-size:.85rem;';
      const isAll = showTab === 'all', isUM = showTab === 'unmatched', isM = showTab === 'matched', isOOR = showTab === 'outofrange';
      const _oorCount = matchedState.filter(s => s.outOfRange).length + unmatchedState.filter(s => s.outOfRange).length;

      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:1100px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,.3);">
          <!-- Header -->
          <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;background:#f7fafc;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
              <h3 style="margin:0;color:#1a5276;font-size:1.1rem;">匯入輔導記錄 — 預覽與確認</h3>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${_oorCount > 0 ? `<span style="padding:3px 10px;background:#fffbeb;border:1px solid #f6ad55;border-radius:99px;font-size:.8rem;color:#c05621;font-weight:600;">⚠ 超出學期範圍 ${_oorCount} 筆（預設不匯入）</span>` : ''}
                ${unmatchedItems.length > 0 ? `<span style="padding:3px 10px;background:#fff5f5;border:1px solid #fc8181;border-radius:99px;font-size:.8rem;color:#c53030;font-weight:600;">⚠ 無法比對 ${unmatchedItems.length} 筆</span>` : ''}
                <span style="padding:3px 10px;background:#f0fff4;border:1px solid #68d391;border-radius:99px;font-size:.8rem;color:#276749;font-weight:600;">✓ 已比對 ${matchedItems.length} 筆</span>
              </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <button id="ci-tab-all" data-active="${isAll?'1':'0'}" style="${tabStyle(isAll)}" onclick="ciSwitchTab('all')">全部（${unmatchedItems.length + matchedItems.length}）</button>
              ${unmatchedItems.length > 0 ? `<button id="ci-tab-unmatched" data-active="${isUM?'1':'0'}" style="${tabStyle(isUM)}" onclick="ciSwitchTab('unmatched')">⚠ 無法比對（${unmatchedItems.length}）</button>` : ''}
              <button id="ci-tab-matched" data-active="${isM?'1':'0'}" style="${tabStyle(isM)}" onclick="ciSwitchTab('matched')">✓ 已比對（${matchedItems.length}）</button>
              ${_oorCount > 0 ? `<button id="ci-tab-oor" style="${oorTabStyle(isOOR)}" onclick="ciSwitchTab('outofrange')">⚠ 超出學期範圍（${_oorCount}）</button>` : ''}
              ${ciNcKeys.length ? `<button id="ci-tab-nc" style="${tabStyle(showTab==='newcounselors')}" onclick="ciSwitchTab('newcounselors')">👤 新增人員（${ciNcKeys.length}）</button>` : ''}
              ${showTab !== 'newcounselors' ? `<input id="ci-filter-input" class="field-input" placeholder="搜尋姓名 / 案號 / 輔導人員…" style="flex:1;min-width:200px;font-size:.85rem;" oninput="ciFilter()" value="${escHtml(filterVal)}">
              <button type="button" class="btn btn-secondary btn-sm" onclick="ciSelAll(false)">全不選</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="ciSelAll(true)">全選</button>` : ''}
            </div>
            ${pendingUnmatched > 0 ? `<div style="margin-top:8px;font-size:.82rem;color:#b7791f;background:#fffbeb;padding:6px 12px;border-radius:6px;border:1px solid #f6e05e;">
              ℹ ${pendingUnmatched} 筆無法比對且勾選「暫存」，匯入後將存入未歸屬記錄待後續指派。如要直接匯入請在下方「指派至個案」欄搜尋並選擇對應個案；取消勾選則略過。
            </div>` : ''}
          </div>

          <!-- Table -->
          <div style="overflow:auto;flex:1;">
            ${showTab === 'newcounselors' ? (() => {
              const ncRoleOpts = ROLES.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
              const ncRows = ciNcKeys.map(txt => {
                const nc = ciNcMap[txt];
                return `<tr style="background:#faf5ff;">
                  <td style="padding:7px 10px;text-align:center;"><input type="checkbox" ${nc.include?'checked':''} onchange="ciUpdNC('${escHtml(txt)}','include',this.checked)" style="cursor:pointer;width:14px;height:14px;"></td>
                  <td style="padding:7px 10px;font-size:.83rem;color:#718096;">${escHtml(txt)}</td>
                  <td style="padding:7px 10px;"><input type="text" value="${escHtml(nc.name)}" oninput="ciUpdNC('${escHtml(txt)}','name',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 7px;font-size:.83rem;width:120px;"></td>
                  <td style="padding:7px 10px;"><select onchange="ciUpdNC('${escHtml(txt)}','role',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 5px;font-size:.83rem;"><option value="">— 請選擇職稱 —</option>${ncRoleOpts.replace(new RegExp(`value="${escHtml(nc.role)}"`), `value="${escHtml(nc.role)}" selected`)}</select></td>
                  <td style="padding:7px 10px;font-size:.78rem;color:#a0aec0;text-align:center;">${nc.count} 筆記錄</td>
                </tr>`;
              }).join('');
              return `<div style="padding:10px 16px;background:#faf5ff;border-bottom:1px solid #e9d8fd;font-size:.83rem;color:#553c9a;">
                  以下人員在 Excel 中有出現，但在系統使用者清單中找不到對應帳號。勾選後將於確認匯入時自動新增至使用者管理。
                </div>
                <table style="width:100%;border-collapse:collapse;">
                  <thead><tr style="background:#e9d8fd;text-align:left;font-size:.79rem;color:#553c9a;">
                    <th style="padding:7px 10px;width:28px;"></th>
                    <th style="padding:7px 10px;">Excel 中顯示名稱</th>
                    <th style="padding:7px 10px;">姓名（可修改）</th>
                    <th style="padding:7px 10px;">職稱</th>
                    <th style="padding:7px 10px;text-align:center;">記錄筆數</th>
                  </tr></thead>
                  <tbody>${ncRows}</tbody>
                </table>`;
            })() : ''}
            ${(showTab !== 'matched' && showTab !== 'newcounselors' && unmatchedItems.length > 0) ? `
            <div style="padding:8px 16px 4px;background:#fff5f5;border-bottom:1px solid #fed7d7;">
              <span style="font-size:.82rem;font-weight:700;color:#c53030;">⚠ 無法比對的記錄（${unmatchedItems.length} 筆）— 請指派至正確個案，或跳過</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#fff5f5;font-size:.78rem;color:#718096;text-align:left;">
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;text-align:center;" title="勾選=匯入時存入未歸屬記錄">暫存</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;white-space:nowrap;">日期</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;">學生姓名</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;">輔導人員</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;">主題</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;">指派至個案</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #fed7d7;"></th>
                </tr>
              </thead>
              <tbody>${unmatchedRows}</tbody>
            </table>` : ''}

            ${(showTab !== 'unmatched' && showTab !== 'newcounselors' && matchedItems.length > 0) ? `
            <div style="padding:8px 16px 4px;background:#f0fff4;border-bottom:1px solid #c6f6d5;${showTab==='all'&&unmatchedItems.length>0?'margin-top:0;':''}">
              <span style="font-size:.82rem;font-weight:700;color:#276749;">✓ 已比對的記錄（${matchedItems.length} 筆）— 確認比對正確，或跳過不需要的筆</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f0fff4;font-size:.78rem;color:#718096;text-align:left;">
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;white-space:nowrap;">日期</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;">學生姓名</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;">輔導人員</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;">主題</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;">比對至個案</th>
                  <th style="padding:7px 10px;border-bottom:2px solid #c6f6d5;"></th>
                </tr>
              </thead>
              <tbody>${matchedRows}</tbody>
            </table>` : ''}
          </div>

          <!-- Footer -->
          <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f7fafc;flex-wrap:wrap;gap:10px;">
            <div style="font-size:.85rem;color:#718096;">
              將匯入 <strong style="color:#2d3748;">${pendingConfirm}</strong> 筆
              ${unmatchedState.filter(s=>s.skip).length + matchedState.filter(s=>s.skip).length > 0
                ? `，略過 <strong>${unmatchedState.filter(s=>s.skip).length + matchedState.filter(s=>s.skip).length}</strong> 筆`
                : ''}
              ${pendingUnmatched > 0 ? `，<span style="color:#b7791f;">${pendingUnmatched} 筆存入未歸屬記錄</span>` : ''}
            </div>
            <div id="ci-footer-info" style="display:none;"></div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-secondary" type="button" id="ci-cancel-btn">取消</button>
              <button class="btn btn-primary" type="button" id="ci-confirm-btn" ${(pendingConfirm===0&&pendingUnmatched===0)?'disabled':''}>確認匯入 ${pendingConfirm} 筆</button>
            </div>
          </div>
        </div>`;

      modal.querySelector('#ci-cancel-btn').onclick = () => {
        modal.remove();
        prog.innerHTML = '<span style="color:#a0aec0;">已取消匯入。</span>';
        resolve();
      };
      modal.querySelector('#ci-confirm-btn').onclick = () => doConfirmImport();
    };

    // 掛載輔助函式到 window（modal 內 onclick 用）
    window.ciSwitchTab = (tab) => {
      _ciShowTab = tab;
      ['all','unmatched','matched','oor'].forEach(t => {
        const el = modal.querySelector(`#ci-tab-${t}`);
        const tabId = t === 'oor' ? 'outofrange' : t;
        if (el) el.dataset.active = (tabId === tab ? '1' : '0');
      });
      renderModal();
    };
    window.ciUpdNC = (origText, field, val) => {
      const nc = ciNcMap[origText]; if (!nc) return;
      if (field === 'include') nc.include = val;
      else if (field === 'name') nc.name = val;
      else if (field === 'role') nc.role = val;
      renderModal();
    };
    window.ciFilter = () => renderModal();
    let _ciLastClick = { type: null, idx: -1 };
    window.ciToggleSkip = (type, realIdx, evt) => {
      const arr = type === 'unmatched' ? unmatchedState : matchedState;
      const newVal = !arr[realIdx].skip;
      if (evt?.shiftKey && _ciLastClick.type === type && _ciLastClick.idx >= 0) {
        const s = Math.min(_ciLastClick.idx, realIdx), e2 = Math.max(_ciLastClick.idx, realIdx);
        for (let i = s; i <= e2; i++) arr[i].skip = newVal;
      } else {
        arr[realIdx].skip = newVal;
      }
      _ciLastClick = { type, idx: realIdx };
      renderModal();
    };
    window.ciToggleSave = (realIdx, val) => {
      unmatchedState[realIdx].saveToUnassigned = val;
      renderModal();
    };
    window.ciSelAll = (select) => {
      const tab = modal.querySelector('#ci-tab-all')?.dataset.active === '1' ? 'all'
                : modal.querySelector('#ci-tab-unmatched')?.dataset.active === '1' ? 'unmatched' : 'matched';
      if (tab !== 'matched') unmatchedState.forEach(s => { s.skip = !select; });
      if (tab !== 'unmatched') matchedState.forEach(s => { s.skip = !select; });
      renderModal();
    };
    window.ciAssignCase = (input) => {
      const realIdx = parseInt(input.dataset.realIdx);
      const val = input.value;
      unmatchedState[realIdx]._searchVal = val;
      // 嘗試從 datalist 中比對完整選項（案號完全符合）
      const match = casesData.find(c =>
        val === `${c.name||'—'} （${c.id}）${c.studentId ? ' '+c.studentId : ''}` ||
        val === c.id ||
        val.includes(`（${c.id}）`)
      );
      unmatchedState[realIdx].assignedCaseId = match ? match.id : '';
      // 不重繪整個 modal，只更新 footer 計數
      const pendingConfirm = unmatchedState.filter(s => !s.skip && s.assignedCaseId).length
                           + matchedState.filter(s => !s.skip).length;
      const pendingUnmatched = unmatchedState.filter(s => !s.skip && !s.assignedCaseId && s.saveToUnassigned).length;
      const confirmBtn = modal.querySelector('#ci-confirm-btn');
      if (confirmBtn) {
        confirmBtn.disabled = pendingConfirm === 0 && pendingUnmatched === 0;
        confirmBtn.textContent = `確認匯入 ${pendingConfirm} 筆`;
      }
      const footerInfo = modal.querySelector('#ci-footer-info');
      if (footerInfo) {
        footerInfo.innerHTML = `將匯入 <strong style="color:#2d3748;">${pendingConfirm}</strong> 筆`
          + (unmatchedState.filter(s=>s.skip).length + matchedState.filter(s=>s.skip).length > 0
              ? `，略過 <strong>${unmatchedState.filter(s=>s.skip).length + matchedState.filter(s=>s.skip).length}</strong> 筆` : '')
          + (pendingUnmatched > 0 ? `，<span style="color:#b7791f;">${pendingUnmatched} 筆存入未歸屬記錄</span>` : '');
      }
      // 改變列背景色以給即時反饋
      const row = modal.querySelector(`tr[data-type="unmatched"][data-real-idx="${realIdx}"]`);
      if (row) row.style.background = match ? '#f0fff4' : '#fff5f5';
    };

    const doConfirmImport = async () => {
      // 先新增未識別主責人員
      let cfgChanged = false;
      for (const [origText, nc] of Object.entries(ciNcMap)) {
        if (!nc.include || !nc.name) continue;
        if (!nc.role) { alert(`請為「${nc.name}」選擇職稱後再確認匯入。`); return; }
        const key = nc.key || ('nomail_' + nc.name.replace(/\s+/g,'') + '_import');
        if (!configData.users[key]) {
          configData.users[key] = { name: nc.name, role: nc.role };
          cfgChanged = true;
        }
        nc.resolvedKey = key;
      }
      // 更新已有記錄的 counselorEmail
      const applyNc = (rec) => {
        if (!rec.counselorEmail && rec.counselorName) {
          const nc = ciNcMap[rec.counselorName];
          if (nc?.resolvedKey) { rec.counselorEmail = nc.resolvedKey; }
        }
      };
      matchedState.forEach(s => applyNc(s.record));
      unmatchedState.forEach(s => applyNc(s.record));
      if (cfgChanged) driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});

      modal.remove();
      prog.style.display = '';
      prog.innerHTML = '<span style="color:#718096;">寫入記錄至 Drive…</span>';
      const _ciJobId = bgJobAdd('匯入輔導服務記錄');

      const modifiedCaseIds = new Set();
      let added = 0;

      // 處理已比對（未跳過）
      for (const s of matchedState) {
        if (s.skip) continue;
        const idx = casesData.findIndex(c => c.id === s.targetCase.id);
        if (idx < 0) continue;
        if (!casesData[idx].records) casesData[idx].records = [];
        casesData[idx].records.push(s.record);
        casesData[idx].updatedAt = new Date().toISOString();
        modifiedCaseIds.add(s.targetCase.id);
        added++;
      }

      // 處理無法比對但已手動指派（未跳過）
      for (const s of unmatchedState) {
        if (s.skip || !s.assignedCaseId) continue;
        const idx = casesData.findIndex(c => c.id === s.assignedCaseId);
        if (idx < 0) continue;
        if (!casesData[idx].records) casesData[idx].records = [];
        casesData[idx].records.push(s.record);
        casesData[idx].updatedAt = new Date().toISOString();
        modifiedCaseIds.add(s.assignedCaseId);
        added++;
      }

      try {
        if (modifiedCaseIds.size > 0) {
          prog.innerHTML = `<span style="color:#718096;">寫入 ${modifiedCaseIds.size} 個個案至 Drive…</span>`;
          await saveCasesChunks(...modifiedCaseIds);
        }

        // 未比對且未跳過且已勾選暫存 → 存入 unassigned_records.json
        const unassignedToSave = unmatchedState.filter(s => !s.skip && !s.assignedCaseId && s.saveToUnassigned !== false);
        if (unassignedToSave.length) {
          prog.innerHTML = `<span style="color:#718096;">儲存 ${unassignedToSave.length} 筆未歸屬記錄…</span>`;
          const now = new Date().toISOString();
          for (const s of unassignedToSave) {
            unassignedRecordsData.push({
              id: `ur-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              name: s.studentName || s.record.counseleeName || '',
              semester: fileSemPrefix || '',
              serviceItems: s.record.serviceItems || [],
              importedAt: now,
              importedBy: currentUser?.email || '',
              record: s.record,
              resolved: false,
              matchedCaseId: null,
              matchedAt: null,
            });
          }
          await saveUnassignedRecords();
        }

        const skipped = unmatchedState.filter(s => s.skip).length + matchedState.filter(s => s.skip).length;
        const autoSaved = unassignedToSave.length;
        prog.innerHTML = `<span style="color:#276749;font-weight:600;">✓ 成功匯入 ${added} 筆輔導記錄`
          + (skipped > 0 ? `，已跳過 ${skipped} 筆` : '')
          + (autoSaved > 0 ? `，${autoSaved} 筆無法比對已存入未歸屬記錄` : '')
          + `。</span>`;
        auditLog(`批次匯入輔導服務記錄 ${added} 筆${autoSaved > 0 ? `，${autoSaved} 筆存入未歸屬記錄` : ''}`);
        bgJobDone(_ciJobId);
      } catch(_ciErr) {
        prog.innerHTML = `<span style="color:#c53030;">✗ 寫入失敗：${escHtml(_ciErr.message)}</span>`;
        bgJobFail(_ciJobId, _ciErr.message);
      }
      resolve();
    };

    document.body.appendChild(modal);
    renderModal();
  });
}

// ══════════════════════════════════════════════
//  匯出個案 CSV
// ══════════════════════════════════════════════
function exportCasesCSV() {
  const semesterOf = dateStr => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const roc = y - 1911;
    if (m >= 8) return `${roc}-1`;
    if (m === 1) return `${roc - 1}-1`;
    return `${roc}-2`;
  };
  const adToRocStr = d => {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length < 3) return d;
    return `${parseInt(parts[0]) - 1911}/${parts[1]}/${parts[2]}`;
  };

  const qEl = document.getElementById('cf-q');
  const semEl = document.getElementById('cf-semester');
  const counselorEl = document.getElementById('cf-counselor');
  const q = qEl?.value.trim().toLowerCase() || '';
  const semFilter = semEl?.value || '';
  const counselorFilter = counselorEl?.value || '';
  // v173：狀態／封存／案別改讀 caseFilters.groups（收合式勾選面板），比照 renderCases 用 _filterPanelMatch
  // 統一判定，避免與畫面上實際套用的篩選條件（cf-status/cf-archived 選單已移除）脫節
  const _exportActiveGroups = {
    status:   [...caseFilters.groups.status],
    archived: [...caseFilters.groups.archived],
    abType:   [...caseFilters.groups.abType],
  };

  const filtered = casesData.filter(c => {
    if (c.deleted) return false;
    if (!_filterPanelMatch({
      status:   _caseStatusTags(c),
      archived: c.archived ? ['archived'] : ['unarchived'],
      abType:   [_caseLatestAbType(c)].filter(Boolean),
    }, _exportActiveGroups)) return false;
    if (semFilter && semesterOf(c.openDate) !== semFilter) return false;
    if (counselorFilter) {
      const emails = [c.counselorEmail, ...(c.managers || [])];
      if (!emails.includes(counselorFilter)) return false;
    }
    if (q) {
      const hay = [c.name, c.studentId, c.id, c.counselorText, c.counselorName].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const headers = ['案號','姓名','學號','身分證字號','生日(民國)','法定性別','系所','年級','班別','開案日期','開案學期','主責人員','狀態','結案日期','聯絡電話','電子郵件','來源','BSRS總分'];
  const rows = filtered.map(c => [
    c.id,
    c.name,
    c.studentId,
    c.idNumber,
    adToRocStr(c.birthday),
    c.legalGender || '',
    c.department || '',
    c.grade || '',
    c.classNo || '',
    c.openDate || '',
    semesterOf(c.openDate),
    c.counselorText || c.counselorName || c.counselorEmail || '',
    c.status === 'closed' ? '已結案' : '進行中',
    c.closeDate || '',
    c.phone || '',
    c.email || '',
    c.source || '',
    c.bsrsTotal != null ? String(c.bsrsTotal) : '',
  ]);

  const escape = v => {
    const s = String(v == null ? '' : v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
  const bom = '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `個案列表_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════
//  記錄批次列印
// ══════════════════════════════════════════════
function openBatchPrintModal(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const records = (c.records || []).filter(r => !r.deleted).sort((a, b) => (a.date||'') < (b.date||'') ? -1 : 1);
  if (!records.length) { alert('此個案尚無晤談紀錄。'); return; }

  const weekdays = ['日','一','二','三','四','五','六'];
  const fmtDate = d => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return `${d}（${weekdays[dt.getDay()]}）`;
  };

  document.getElementById('batch-print-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'batch-print-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';

  const rows = records.map(r => {
    const snippet = (r.summary||'').replace(/<[^>]*>/g,'').slice(0, 60);
    const dateStr = escHtml(fmtDate(r.date));
    const timeStr = escHtml(r.time || '');
    const snipStr = snippet ? `<div style="font-size:.8rem;color:#718096;margin-top:2px;">${escHtml(snippet)}${snippet.length >= 60 ? '…' : ''}</div>` : '';
    return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:6px;cursor:pointer;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background=''">
      <input type="checkbox" class="bp-cb" data-rid="${escHtml(r.id)}" checked style="margin-top:3px;flex-shrink:0;">
      <div><div style="font-weight:600;font-size:.9rem;">${dateStr}　${timeStr}</div>${snipStr}</div>
    </label>`;
  }).join('');

  ov.innerHTML = `<div style="background:#fff;border-radius:10px;padding:24px;max-width:600px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.3);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:1.05rem;font-weight:700;">記錄批次列印 — ${escHtml(c.name)}（${escHtml(caseId)}）</div>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('batch-print-overlay').remove()">✕ 關閉</button>
    </div>
    <div style="margin-bottom:10px;display:flex;gap:8px;">
      <button class="btn btn-secondary btn-sm" onclick="_bpSelectAll(true)">全選</button>
      <button class="btn btn-secondary btn-sm" onclick="_bpSelectAll(false)">取消全選</button>
    </div>
    <div id="bp-list" style="overflow-y:auto;flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:6px;margin-bottom:16px;">${rows}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="document.getElementById('batch-print-overlay').remove()">取消</button>
      <button class="btn btn-primary" onclick="_doBatchPrint('${escHtml(caseId)}')">列印選取</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}

function _bpSelectAll(checked) {
  _ckgSetAll('bp-cb', checked);
}

function _doBatchPrint(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const checkedIds = new Set([...document.querySelectorAll('#batch-print-overlay .bp-cb:checked')].map(cb => cb.dataset.rid));
  if (!checkedIds.size) { alert('請至少勾選一筆紀錄。'); return; }
  const records = (c.records || [])
    .filter(r => !r.deleted && checkedIds.has(r.id))
    .sort((a, b) => (a.date||'') < (b.date||'') ? -1 : 1);
  document.getElementById('batch-print-overlay')?.remove();
  _renderBatchPrintHtml(c, records);
}

function _renderBatchPrintHtml(c, records) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const printRich = s => {
    const t = String(s || '');
    if (/<\/?[a-z][\s\S]*?>/i.test(t)) return sanitizeRichHtml(t);
    return esc(t).replace(/\n/g, '<br>');
  };
  const hasContent = s => !!(s||'').replace(/<[^>]*>/g,'').trim();

  const weekdays = ['日','一','二','三','四','五','六'];
  const bdDisp    = (c.birthday || '').replace(/-/g, '/');
  const deptDisp  = _caseClassDisp(c); // v188：班級（B1），取代舊版系級空白相接格式
  const printTime = new Date().toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const printerName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  const topicAliasMap = { '家庭問題':'家庭關係','人際互動':'人際關係','學業與學習':'學習與課業','生涯發展與規劃':'生涯探索','網路沉迷':'網路成癮' };

  const renderOne = (r, idx) => {
    const dateObj  = r.date ? new Date(r.date + 'T00:00:00') : null;
    const weekday  = dateObj ? `（${weekdays[dateObj.getDay()]}）` : '';
    const timeDisp = (r.time||'').startsWith('其他：') ? r.time.slice(3) : (r.time||'');
    const topicsText = (r.topics||[]).map(t => topicAliasMap[t] || t).join('、') || '—';
    const svcText    = (r.serviceItems||[]).map(s => s.replace(/[：:].*$/, '')).join('、') || '—';
    const counselor  = esc(r.counselorName || r.counselorEmail || '');

    // 處理經過：僅有主述時不加標籤；有其他欄位時全部加標籤
    const hasOther = hasContent(r.assessment) || hasContent(r.nextPlan) || hasContent(r.notes);
    let procParts = [];
    if (hasOther) {
      if (hasContent(r.summary))    procParts.push(`<div class="proc-label">【主述】</div><div class="proc-body">${printRich(r.summary)}</div>`);
      if (hasContent(r.assessment)) procParts.push(`<div class="proc-label">【問題評估】</div><div class="proc-body">${printRich(r.assessment)}</div>`);
      if (hasContent(r.nextPlan))   procParts.push(`<div class="proc-label">【後續處遇計畫】</div><div class="proc-body">${printRich(r.nextPlan)}</div>`);
      if (hasContent(r.notes))      procParts.push(`<div class="proc-label">【備註】</div><div class="proc-body">${printRich(r.notes)}</div>`);
    } else {
      procParts.push(`<div class="proc-body">${printRich(r.summary)}</div>`);
    }
    const procContent = procParts.join('<div class="proc-sep"></div>');

    // 基本資料格只在第一筆出現；後續筆次用粗線分隔
    const hdrHtml = idx === 0 ? `
<div class="hdr-school">國立屏東科技大學學生諮商中心</div>
<div class="title">事　件　處　理　記　錄　表</div>
<table class="info-tbl">
  <tr>
    <td class="th">姓名</td><td>${esc(c.name)}</td>
    <td class="th">學號</td><td>${esc(c.studentId)}</td>
    <td class="th">班級</td><td>${esc(deptDisp)}</td>
  </tr>
  <tr>
    <td class="th">案號</td><td>${esc(c.id)}</td>
    <td class="th">出生年月日</td><td>${esc(bdDisp)}</td>
    <td class="th">電話</td><td>${esc(c.phone)}</td>
  </tr>
</table>` : '<div class="rec-divider"></div>';

    return `
${hdrHtml}
<table class="info-tbl${idx===0?' no-top':''}">
  <tr>
    <td class="th">晤談日期</td><td colspan="3">${esc(r.date)}${weekday}　${esc(timeDisp)}</td>
    <td class="th">晤談者</td><td>${counselor}</td>
  </tr>
  <tr>
    <td class="th">會談主題</td><td colspan="5" style="line-height:1.6;">${esc(topicsText)}</td>
  </tr>
  <tr>
    <td class="th">服務項目</td><td colspan="5" style="line-height:1.6;">${esc(svcText)}</td>
  </tr>
</table>
<div class="proc-box">
  <div class="proc-title">處理<br>經過</div>
  <div class="proc-content">${procContent}</div>
</div>
<div class="sig"><div class="sig-f">晤談人員：<div class="sig-l">${counselor}</div></div></div>`;
  };

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>事件處理記錄表 ${esc(c.name)} ${esc(c.id)}</title>
<style>
@page{size:A4 portrait;margin:14mm 15mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'微軟正黑體','Microsoft JhengHei','Noto Sans TC',sans-serif;font-size:12pt;color:#000}
.hdr-school{text-align:center;font-size:12pt;margin-bottom:3pt;}
.title{text-align:center;font-size:14pt;font-weight:bold;letter-spacing:3pt;margin-bottom:8pt;padding-bottom:5pt;border-bottom:1.5pt solid #000}
.info-tbl{width:100%;border-collapse:collapse;font-size:10pt;}
.info-tbl td{padding:4pt 6pt;border:.8pt solid #555;}
.info-tbl td.th{font-weight:bold;background:#f0f0f0;white-space:nowrap;text-align:center;width:58pt;}
.info-tbl.no-top tr:first-child td{border-top:none;}
.proc-box{border:.8pt solid #555;border-top:none;display:flex;flex-direction:row;}
.proc-title{font-size:12pt;font-weight:bold;writing-mode:vertical-rl;text-orientation:mixed;text-align:center;padding:8pt 4pt;border-right:.8pt solid #555;background:#f0f0f0;white-space:nowrap;}
.proc-content{padding:8pt 10pt;font-size:10pt;line-height:1.8;word-break:break-all;flex:1;}
.proc-label{font-weight:bold;margin-top:8pt;margin-bottom:2pt;color:#1a202c;}
.proc-label:first-child{margin-top:0;}
.proc-body{padding-left:2pt;white-space:pre-wrap;}
.proc-sep{border-top:.5pt dashed #bbb;margin:8pt 0;}
.rec-divider{border-top:2pt solid #222;margin:14pt 0 12pt;}
.sig{display:flex;justify-content:flex-end;margin-top:10pt}
.sig-f{display:flex;align-items:flex-end;gap:6pt;font-size:10.5pt}
.sig-l{border-bottom:.8pt solid #000;min-width:120pt;padding-bottom:2pt;text-align:center;font-size:10pt}
.foot{font-size:7.5pt;color:#888;text-align:right;margin-top:12pt;padding-top:4pt}
${PRINT_RICH_LIST_CSS}
</style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div>
${records.map((r, i) => renderOne(r, i)).join('\n')}
<div class="foot">${printerName ? esc(printerName)+' 於 ' : ''}${esc(printTime)} 列印　共 ${records.length} 筆晤談紀錄　國立屏東科技大學學生諮商中心資訊系統</div>
<script>window.addEventListener('load',()=>{
  document.querySelectorAll('.proc-box').forEach(b=>{
    const cont=b.querySelector('.proc-content');
    const ttl=b.querySelector('.proc-title');
    if(cont&&ttl&&cont.offsetHeight>75)ttl.innerHTML='處理經過';
  });
  window.print();
});<\/script>
</body></html>`;

  _printViaIframe(html);
}

