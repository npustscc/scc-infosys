// dev/case-import.js — 個案資料表單匯入區塊（拆 index.html 絞殺者第六刀，v252）。
// 內容為從 index.html 逐字搬出的函式：清空個案資料（confirmClearAllCases）、Drive 復原
// （recoverCasesFromDrive）、服務總表 Excel／CSV 批次匯入（handleImportFile／
// handleBatchImportFile／batchImportServiceTables／_batchParseCasesSheet／
// _batchParseRecordsSheet／_showBatchImportConfirm／_applyBatchImport／importCasesFromExcel）、
// 匯入預覽與合併／歷史學期結案勾選 modal（showImportReviewModal／showImportClosurePicker／
// showImportMergePreview）、最終寫入 Drive（finalizeImport）。
// 頂層無任何執行副作用（只有 function/async function 宣告與少量頂層註解）。函式內部在呼叫時
// 會引用主檔全域可變狀態（casesData／casesManifest／configData／currentUser／currentRole／
// extraRole／psychTestDB 等，定義仍留在 index.html），屬 call-time 解析，與其他拆檔模組
// （utils.js／ft-core.js／case-detail.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="case-import.js"></script> 載入（放在
// case-detail.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ── 資料匯入 ──────────────────────────────────────
async function confirmClearAllCases() {
  const answer = prompt('確定要清空所有個案資料嗎？此操作無法復原！\n\n請輸入「確認清空」繼續：');
  if (answer !== '確認清空') { alert('已取消。'); return; }
  showLoading('清空中…');
  try {
    let fileMap;
    try { ({ map: fileMap } = await getCasesFolderFileMap()); } catch { fileMap = new Map(); }
    const chunkIds = [...fileMap.entries()]
      .filter(([name]) => name !== 'manifest.json' && name !== 'index.json' && name.endsWith('.json'))
      .map(([, id]) => id);
    if (chunkIds.length > 0) {
      showLoading(`刪除 ${chunkIds.length} 個 chunk 檔…`);
      await Promise.all(chunkIds.map(id =>
        proxyCall('trashFile', { fileId: id }).catch(() => {})
      ));
    }
    casesData = [];
    casesManifest = { chunks: [] };
    await driveSaveJsonInCases('manifest.json', { chunks: [] });
    hideLoading();
    alert('✓ 已清空所有個案資料。');
  } catch(e) { hideLoading(); alert('清空失敗：' + e.message); }
}

async function recoverCasesFromDrive() {
  if (!confirm('嘗試從 Drive 上殘存的 chunk 檔案恢復個案資料？')) return;
  const jobId = bgJobAdd('從 Drive 恢復個案資料', '掃描 chunk 檔案中…');
  (async () => {
    try {
      const { map: fileMap } = await getCasesFolderFileMap();
      bgJobProgress(jobId, 15);
      const chunkEntries = [...fileMap.entries()].filter(
        ([name]) => name !== 'manifest.json' && name !== 'index.json' && name.endsWith('.json')
      );
      if (chunkEntries.length === 0) {
        bgJobFail(jobId, '找不到任何 chunk 檔案，資料可能已完全遺失');
        showToast('Drive 上找不到任何 chunk 檔案', 'error', 6000);
        return;
      }
      const results = await Promise.all(
        chunkEntries.map(([name, fid]) =>
          driveReadJsonById(fid).catch(e => { console.warn('chunk 讀取失敗:', name, e.message); return { cases: [] }; })
        )
      );
      bgJobProgress(jobId, 60);
      const recovered = results.flatMap(r => r.cases || []);
      if (recovered.length === 0) {
        bgJobFail(jobId, 'chunk 檔案存在但內容為空');
        showToast('chunk 檔案存在但內容為空，資料可能已遺失', 'error', 6000);
        return;
      }
      casesData = recovered;
      casesManifest = { chunks: [] };
      bgJobProgress(jobId, 70);
      await migrateToChunks();
      renderCases();
      bgJobDone(jobId);
      showToast(`✓ 成功恢復 ${recovered.length} 筆個案`, 'success');
    } catch(e) {
      bgJobFail(jobId, e.message);
      showToast('恢復失敗：' + e.message, 'error', 6000);
    }
  })();
}

function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  importCasesFromExcel(file);
}

function handleBatchImportFile(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  input.value = '';
  batchImportServiceTables(files);
}

async function batchImportServiceTables(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const prog = document.getElementById('import-progress');
  prog.style.display = '';
  prog.innerHTML = '<span style="color:#718096;">載入 SheetJS 中…</span>';

  const parsedFiles = [];
  for (const file of sorted) {
    prog.innerHTML = `<span style="color:#718096;">解析 ${escHtml(file.name)}…</span>`;
    try {
      const buf = await file.arrayBuffer();
      const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });
      const basicWs  = wb.Sheets['基本資料']    || wb.Sheets['學生資料'];
      const recordWs = wb.Sheets['輔導服務情形'] || wb.Sheets['輔導服務紀錄'] || wb.Sheets['輔導服務記錄'];
      const cases   = basicWs  ? _batchParseCasesSheet(basicWs, file.name)   : [];
      const records = recordWs ? _batchParseRecordsSheet(recordWs)            : [];
      const fnMatch = file.name.match(/^(\d{3})-([12])/);
      const semPrefix = fnMatch ? fnMatch[1] + fnMatch[2] : '';
      const semMs = semPrefix ? semesterMonths(semPrefix) : [];
      const outOfRangeRecords = semMs.length
        ? records.filter(r => r.record.date && !semMs.includes(r.record.date.slice(0,7)))
        : [];
      parsedFiles.push({ name: file.name, cases, records, semPrefix, outOfRangeRecords, error: null });
      _syslog('info', `批次匯入：${file.name} → ${cases.length} 筆個案、${records.length} 筆記錄（OOR: ${outOfRangeRecords.length}）`);
    } catch (e) {
      // 單檔取消解鎖不中斷整批：記為該檔失敗，繼續處理下一檔（見 _xlsxReadUnlocked 的 xlsxCancelled 旗標）。
      const errMsg = e.xlsxCancelled ? '使用者取消解鎖' : e.message;
      parsedFiles.push({ name: file.name, cases: [], records: [], semPrefix: '', outOfRangeRecords: [], error: errMsg });
      auditLog('匯入失敗', null, null, `${file.name}：${errMsg}`);
    }
  }

  // 收集未識別輔導人員（counselorText 有值但找不到系統帳號）
  const newCounselorsMap = {};
  parsedFiles.forEach(f => {
    (f.cases || []).forEach(c => {
      if (!c.counselorEmail && c.counselorText) {
        const txt = c.counselorText;
        if (!newCounselorsMap[txt]) {
          newCounselorsMap[txt] = {
            origText: txt, name: txt, role: '兼任諮商心理師',
            key: 'nomail_' + txt.replace(/\s+/g,'') + '_' + Date.now(),
            count: 0, include: true,
          };
        }
        newCounselorsMap[txt].count++;
      }
    });
  });

  const result = await _showBatchImportConfirm(parsedFiles, newCounselorsMap);
  if (!result.confirmed) { prog.style.display = 'none'; return; }

  const allCases   = parsedFiles.filter(f => !f.error).flatMap(f => f.cases);
  const allRecords = parsedFiles.filter(f => !f.error).flatMap(f => f.records)
    .filter(r => !result.excludedIds.has(r.record.id));

  // 套用新增人員：寫入 configData.users，並更新 allCases 的 counselorEmail
  const ncKeys = Object.keys(newCounselorsMap);
  if (ncKeys.length > 0) {
    ncKeys.forEach(txt => {
      const nc = newCounselorsMap[txt];
      if (nc.include && nc.name && nc.role && nc.key && !configData.users[nc.key]) {
        configData.users[nc.key] = { name: nc.name, role: nc.role, noMail: true };
      }
    });
    allCases.forEach(c => {
      if (!c.counselorEmail && c.counselorText) {
        const nc = newCounselorsMap[c.counselorText];
        if (nc && nc.include && nc.key) {
          c.counselorEmail = nc.key;
          c.counselorName  = nc.name || c.counselorText;
        }
      }
    });
    try { await driveUpdateJsonFile(CONFIG_FILE, configData); } catch(_) {}
  }

  prog.innerHTML = `<span style="color:#718096;">寫入資料中（${allCases.length} 筆個案、${allRecords.length} 筆記錄）…</span>`;
  await _applyBatchImport(allCases, allRecords, sorted.length, prog);
}

function _batchParseCasesSheet(ws, fileName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const fnMatch = fileName.match(/^(\d{3})-([12])/);
  const fileSemPrefix = fnMatch ? fnMatch[1] + fnMatch[2] : '';
  const fileSemRange  = fileSemPrefix ? semesterDateRange(fileSemPrefix) : null;
  const rocToAD = (raw) => {
    const s = String(raw).replace(/\D/g, '');
    if (s.length === 7) { const y = parseInt(s.slice(0,3))+1911; return `${y}-${s.slice(3,5)}-${s.slice(5,7)}`; }
    if (s.length === 6) { const y = parseInt(s.slice(0,2))+1911; return `${y}-${s.slice(2,4)}-${s.slice(4,6)}`; }
    return '';
  };
  const bsrsTextMap = {'完全沒有':0,'輕微':1,'有時如此':2,'常常如此':3,'幾乎每天':4};
  const parseEmg = (raw) => { const m = String(raw).match(/^(.+?)[\(（](.+?)[\)）]$/); return m ? [m[1].trim(), m[2].trim()] : [String(raw).trim(), '']; };
  const identityMap = (id, grade) => {
    if (id.includes('博碩') || id.includes('碩') || id.includes('博')) return { caseType:'研究所', program: (grade||'').includes('博') ? '博士班' : '碩士班' };
    if (id.includes('進修')) return { caseType:'進修部', program:'大學-進修部' };
    return { caseType:'日間部', program:'大學-日間部' };
  };
  const findCounselorEmail = (t) => { for (const [e, info] of Object.entries(configData?.users||{})) { if (info.name && t.includes(info.name)) return e; } return ''; };
  const now = new Date().toISOString();
  const result = [];
  let _skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[1]||'').trim();
    if (!id || id.length !== 7 || isNaN(parseInt(id))) { _skipped++; continue; }
    const counselorText = String(r[5]||'').trim();
    const abRaw = String(r[0]||'').trim();
    const abType = abRaw.includes('B') ? 'B案' : 'A案';
    const grade = String(r[7]||'').trim();
    const identity = String(r[24]||'').trim();
    const { caseType, program } = identityMap(identity, grade);
    const gradLevel = caseType === '研究所' ? (program === '博士班' ? '博' : '碩') : '';
    const natRaw = String(r[25]||'').trim();
    const nationality = (natRaw === '台灣' || natRaw === '臺灣') ? '本國籍' : (natRaw ? '外國籍' : '本國籍');
    const foreignCountry = nationality === '外國籍' ? natRaw : '';
    const bsrs6Raw = String(r[17]||'').trim();
    const [emgName, emgRelation] = parseEmg(r[18]);
    const counselorEmail = findCounselorEmail(counselorText);
    const counselorName  = counselorEmail ? (formatCounselorLabel(counselorEmail) || counselorEmail) : counselorText;
    const closeDateRaw = String(r[27]||'').trim();
    let closeDate = closeDateRaw ? rocToAD(closeDateRaw) : '';
    const openDateRaw = String(r[2]||'').trim();
    let openDateAD = rocToAD(openDateRaw);
    if (fileSemRange) {
      if (!openDateAD || openDateAD < fileSemRange.first || openDateAD > fileSemRange.last) openDateAD = fileSemRange.first;
      if (closeDateRaw && (!closeDate || closeDate < fileSemRange.first || closeDate > fileSemRange.last)) closeDate = fileSemRange.last;
    }
    result.push({
      id, abType, openDate: openDateAD, fileSem: fileSemPrefix, name: String(r[4]||'').trim(),
      studentId: String(r[13]||'').trim(), birthday: rocToAD(String(r[11]||'').trim()),
      idNumber: String(r[10]||'').trim(), legalGender: String(r[8]||'').trim(),
      genderIdentity: '', caseType, gradLevel, program, nationality, foreignCountry,
      ethnicity: '', ethnicityNote: '', department: String(r[6]||'').trim(), grade,
      classNo: '', phone: String(r[14]||'').trim(), residence: '',
      address: String(r[15]||'').trim(), emergencyName: emgName,
      emergencyPhone: String(r[19]||'').trim(), emergencyRelation: emgRelation,
      source: String(r[22]||'').trim() || '主動來談', pastRecords: [], topics: [],
      counselorEmail, counselorName, counselorText: counselorText || '',
      status: closeDate ? 'closed' : 'active', closeDate,
      bsrs: null, bsrsTotal: r[16] !== '' ? (parseInt(r[16])||null) : null,
      bsrs6: bsrs6Raw !== '' ? (bsrsTextMap[bsrs6Raw] ?? null) : null,
      disability: '', isImported: true, createdAt: now, updatedAt: now,
    });
  }
  if (_skipped > 0) _syslog('warn', `批次匯入解析 ${fileName}：跳過 ${_skipped} 列（欄位 B 非 7 位數字）`);
  _syslog('debug', `批次匯入解析 ${fileName}：共 ${rows.length - 1} 列，有效 ${result.length} 筆，跳過 ${_skipped} 筆`);
  return result;
}

function _batchParseRecordsSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rocToAD = (raw) => { const s = String(raw).replace(/\D/g,''); if (s.length===7){const y=parseInt(s.slice(0,3))+1911;return `${y}-${s.slice(3,5)}-${s.slice(5,7)}`;} return ''; };
  const findCounselorKey = (t) => { for (const [k,info] of Object.entries(configData?.users||{})){if(info.name&&t.includes(info.name))return k;} return ''; };
  const topicClean = (raw) => String(raw).trim().replace(/^\d+\.?\s*/,'');
  const parseImportTime = (raw) => { if(!raw)return''; const m=raw.match(/\((\d+)\)$/); if(m){const n=parseInt(m[1]);if(n>=1&&n<=BK_PERIODS.length)return BK_PERIODS[n-1].label;} return raw; };
  const mapMode = (s) => { s=String(s||'').trim(); if(/視訊/.test(s))return'視訊';if(/團體/.test(s))return'團體';if(/電話/.test(s))return'電話關懷';if(/mail|email|簡訊/i.test(s))return'E-mail/簡訊';if(/外展/.test(s))return'外展訪視';if(/面談|個別/.test(s))return'面談';return'其他'; };
  const mapInterviewees = (raw) => { const s=String(raw||'').trim();if(!s)return[];return s.split(/[,，、\/；;]+/).map(x=>x.trim()).filter(Boolean).map(p=>{if(/學生|本人|個案/.test(p))return'學生本人';if(/家屬|家長|父母|親屬/.test(p))return'家屬';if(/朋友|同學/.test(p))return'朋友';if(/伴侶|男友|女友/.test(p))return'伴侶';if(/教職|教師|老師|職員|教授/.test(p))return'教職員工生';if(/資源|網絡|社工|機構|醫院/.test(p))return'資源網絡人員';return'';}).filter(Boolean); };
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const dateRaw = String(r[0]||'').trim(), studentName = String(r[2]||'').trim();
    if (!studentName || !dateRaw) continue;
    const date = rocToAD(dateRaw);
    if (!date) continue;
    const ct = String(r[6]||'').trim();
    const ck = findCounselorKey(ct);
    const crossUnit = String(r[15]||'').trim(), crossUnitOther = String(r[16]||'').trim();
    const summary = [String(r[14]||'').trim(), crossUnit ? `跨單位聯繫：${crossUnit}${crossUnitOther?'（'+crossUnitOther+'）':''}` : ''].filter(Boolean).join('\n');
    result.push({ studentName, record: {
      id: `REC-BATCH-${i}-${Date.now()}`,
      date, time: parseImportTime(String(r[1]||'').trim()),
      counselorEmail: ck, counselorName: ck ? (formatCounselorLabel(ck)||ct) : ct,
      interventionMode: mapMode(r[7]), interviewees: mapInterviewees(r[8]),
      topics: [topicClean(r[9]), topicClean(r[10])].filter(Boolean),
      serviceItems: [String(r[12]||'').trim(), String(r[13]||'').trim()].filter(Boolean),
      summary, assessment: '', nextPlan: '', isImported: true,
      createdAt: new Date().toISOString(),
    }});
  }
  return result;
}

function _showBatchImportConfirm(parsedFiles, newCounselorsMap = {}) {
  return new Promise(resolve => {
    const totalCases = parsedFiles.reduce((s,f) => s + f.cases.length, 0);
    const totalRecs  = parsedFiles.reduce((s,f) => s + f.records.length, 0);
    const filesWithOOR = parsedFiles.filter(f => !f.error && (f.outOfRangeRecords||[]).length > 0);
    const ncKeys = Object.keys(newCounselorsMap);

    // 預設排除所有超出範圍的記錄
    const excludedIds = new Set();
    parsedFiles.forEach(f => (f.outOfRangeRecords||[]).forEach(r => excludedIds.add(r.record.id)));

    let activeTab = 'summary';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

    const render = () => {
      const tbStyle = (active, warn) => `padding:6px 14px;border:1.5px solid ${active?(warn?'#c05621':'#2b6cb0'):(warn?'#ed8936':'#e2e8f0')};background:${active?(warn?'#fffbeb':'#ebf8ff'):'#fff'};color:${active?(warn?'#c05621':'#2b6cb0'):(warn?'#c05621':'#4a5568')};border-radius:6px;cursor:pointer;font-size:.84rem;font-weight:${active?'700':'400'};`;
      const hasAnySidebar = filesWithOOR.length > 0 || ncKeys.length > 0;
      const tabBar = hasAnySidebar ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        <button onclick="window._bicTab('summary')" style="${tbStyle(activeTab==='summary',false)}">摘要</button>
        ${ncKeys.length ? `<button onclick="window._bicTab('newcounselors')" style="${tbStyle(activeTab==='newcounselors',true)}">👤 新增人員（${ncKeys.length}）</button>` : ''}
        ${filesWithOOR.map(f => `<button onclick="window._bicTab('${escHtml(f.name)}')" style="${tbStyle(activeTab===f.name,true)}">${semesterLabel(f.semPrefix)||escHtml(f.name)} <span style="font-size:.78rem;">（${(f.outOfRangeRecords||[]).length}筆超出範圍）</span></button>`).join('')}
      </div>` : '';

      let content = '';
      if (activeTab === 'summary') {
        // 計算匯入後將無主責的個案
        const noCounselorCases = parsedFiles.filter(f => !f.error).flatMap(f => f.cases).filter(c => {
          if (c.counselorEmail) return false; // 已有 email，正常
          if (!c.counselorText) return true;  // 欄位空白
          const nc = newCounselorsMap[c.counselorText];
          return !nc || !nc.include;           // 對應人員被取消勾選
        });
        const rows = parsedFiles.map(f => f.error
          ? `<tr><td style="padding:4px 8px;">${escHtml(f.name)}</td><td colspan="2" style="color:#c53030;font-size:.85rem;">${escHtml(f.error)}</td></tr>`
          : `<tr><td style="padding:4px 8px;font-size:.875rem;">${escHtml(f.name)}${f.semPrefix?`<span style="font-size:.75rem;color:#718096;margin-left:6px;">${semesterLabel(f.semPrefix)}</span>`:''}</td><td style="padding:4px 8px;text-align:right;font-size:.875rem;">${f.cases.length} 筆</td><td style="padding:4px 8px;text-align:right;font-size:.875rem;">${f.records.length} 筆</td></tr>`
        ).join('');
        const noCounselorHtml = noCounselorCases.length ? (() => {
          const listItems = noCounselorCases.slice(0, 50).map(c =>
            `<li style="padding:1px 0;">${escHtml(c.name||c.id||'—')}${c.studentId?`<span style="color:#a0aec0;font-size:.78rem;margin-left:6px;">${escHtml(c.studentId)}</span>`:''}${c.counselorText?`<span style="color:#e53e3e;font-size:.78rem;margin-left:6px;">（${escHtml(c.counselorText)} 未勾選）</span>`:''}</li>`
          ).join('');
          const more = noCounselorCases.length > 50 ? `<li style="color:#a0aec0;">…等共 ${noCounselorCases.length} 筆</li>` : '';
          return `<details style="background:#fff5f5;border:1px solid #fc8181;border-radius:6px;padding:8px 12px;margin-bottom:10px;">
            <summary style="font-size:.875rem;color:#c53030;cursor:pointer;font-weight:600;">⚠ 共 <strong>${noCounselorCases.length}</strong> 筆個案匯入後將<strong>無主責人員</strong>（點此展開）</summary>
            <ul style="margin:8px 0 0 12px;padding:0;font-size:.83rem;color:#4a5568;list-style:disc;">${listItems}${more}</ul>
          </details>`;
        })() : '';
        content = `
          <p style="font-size:.875rem;color:#4a5568;margin-bottom:10px;">以下 <strong>${parsedFiles.length}</strong> 個檔案將依序以<strong>覆蓋模式</strong>匯入，共 <strong>${totalCases}</strong> 筆個案、<strong>${totalRecs}</strong> 筆記錄。</p>
          ${ncKeys.length ? `<div style="background:#faf5ff;border:1px solid #d6bcfa;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.875rem;color:#553c9a;">👤 共 <strong>${ncKeys.length}</strong> 位輔導人員未在系統中找到對應帳號，請切換至「新增人員」分頁確認姓名與職稱。</div>` : ''}
          ${noCounselorHtml}
          ${excludedIds.size > 0 ? `<div style="background:#fffbeb;border:1px solid #f6ad55;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.875rem;color:#9c4221;">⚠ 共 <strong>${excludedIds.size}</strong> 筆超出學期範圍的記錄預設<strong>不匯入</strong>。請切換上方分頁確認，取消勾選可納入匯入。</div>` : ''}
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <thead><tr style="background:#f7fafc;">
              <th style="padding:5px 8px;text-align:left;font-size:.8rem;color:#718096;">檔案名稱</th>
              <th style="padding:5px 8px;text-align:right;font-size:.8rem;color:#718096;">個案</th>
              <th style="padding:5px 8px;text-align:right;font-size:.8rem;color:#718096;">記錄</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      } else if (activeTab === 'newcounselors') {
        const ncRoleOpts = (typeof ROLES !== 'undefined' ? ROLES : []).map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
        const ncRowsHtml = ncKeys.map(txt => {
          const nc = newCounselorsMap[txt];
          return `<tr style="background:#faf5ff;">
            <td style="padding:6px 10px;text-align:center;"><input type="checkbox" ${nc.include?'checked':''} onchange="window._bicNcToggle('${escHtml(txt)}','include',this.checked)" style="cursor:pointer;width:14px;height:14px;"></td>
            <td style="padding:6px 10px;font-size:.83rem;color:#718096;">${escHtml(txt)}</td>
            <td style="padding:6px 10px;"><input type="text" value="${escHtml(nc.name)}" oninput="window._bicNcToggle('${escHtml(txt)}','name',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 7px;font-size:.83rem;width:120px;"></td>
            <td style="padding:6px 10px;"><select onchange="window._bicNcToggle('${escHtml(txt)}','role',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 5px;font-size:.83rem;"><option value="">— 請選擇職稱 —</option>${ncRoleOpts.replace(new RegExp(`value="${escHtml(nc.role)}"`), `value="${escHtml(nc.role)}" selected`)}</select></td>
            <td style="padding:6px 10px;font-size:.78rem;color:#a0aec0;text-align:center;">${nc.count} 個案</td>
          </tr>`;
        }).join('');
        content = `
          <div style="background:#faf5ff;border:1px solid #d6bcfa;border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:.83rem;color:#553c9a;">
            以下人員在 Excel 中有出現，但在系統使用者清單中找不到對應帳號。<br>勾選後將於確認匯入時自動新增至使用者管理（無 Gmail 帳號格式）。
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:#e9d8fd;text-align:left;">
                <th style="padding:6px 10px;width:28px;"></th>
                <th style="padding:6px 10px;font-size:.8rem;">Excel 中顯示名稱</th>
                <th style="padding:6px 10px;font-size:.8rem;">姓名（可修改）</th>
                <th style="padding:6px 10px;font-size:.8rem;">職稱</th>
                <th style="padding:6px 10px;font-size:.8rem;text-align:center;">使用案數</th>
              </tr></thead>
              <tbody>${ncRowsHtml}</tbody>
            </table>
          </div>`;
      } else {
        const f = parsedFiles.find(pf => pf.name === activeTab);
        if (f) {
          const range = f.semPrefix ? semesterDateRange(f.semPrefix) : null;
          const rangeStr = range ? `${range.first} ～ ${range.last}` : '（無法判斷）';
          const oorRows = (f.outOfRangeRecords||[]).map(r => {
            const isExcluded = excludedIds.has(r.record.id);
            const reason = range ? ((r.record.date||'') < range.first ? '早於學期起始' : '晚於學期結束') : '超出範圍';
            return `<tr style="background:${isExcluded?'#f7fafc':'#fffbeb'};">
              <td style="padding:6px 10px;text-align:center;">
                <input type="checkbox" class="bic-oor-chk" ${isExcluded?'checked':''} title="勾選=排除不匯入" data-recid="${escHtml(r.record.id)}" onchange="window._bicToggle(this)" style="cursor:pointer;width:15px;height:15px;">
              </td>
              <td style="padding:6px 10px;font-size:.85rem;color:#4a5568;">${escHtml(r.record.date||'—')}</td>
              <td style="padding:6px 10px;font-size:.88rem;font-weight:600;">${escHtml(r.studentName||'—')}</td>
              <td style="padding:6px 10px;font-size:.82rem;color:#718096;">${escHtml(r.record.counselorName||'—')}</td>
              <td style="padding:6px 10px;font-size:.8rem;color:#c05621;">${reason}</td>
            </tr>`;
          }).join('');
          content = `
            <div style="background:#fffbeb;border:1px solid #f6ad55;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.875rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="flex:1;"><strong>${semesterLabel(f.semPrefix)||f.name}</strong> 學期範圍：${escHtml(rangeStr)}。
              以下 ${(f.outOfRangeRecords||[]).length} 筆記錄日期不在此範圍。<strong>勾選 = 排除不匯入</strong>（預設勾選），取消勾選可納入匯入。</span>
              <button onclick="window._bicSelectAll(true)" style="padding:3px 10px;font-size:.8rem;background:#fff;border:1px solid #ed8936;color:#c05621;border-radius:5px;cursor:pointer;white-space:nowrap;">全部勾選</button>
              <button onclick="window._bicSelectAll(false)" style="padding:3px 10px;font-size:.8rem;background:#fff;border:1px solid #68d391;color:#276749;border-radius:5px;cursor:pointer;white-space:nowrap;">全部取消</button>
            </div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <thead><tr style="background:#f7fafc;">
                <th style="padding:5px 8px;font-size:.78rem;color:#718096;">排除</th>
                <th style="padding:5px 8px;text-align:left;font-size:.78rem;color:#718096;">日期</th>
                <th style="padding:5px 8px;text-align:left;font-size:.78rem;color:#718096;">個案姓名</th>
                <th style="padding:5px 8px;text-align:left;font-size:.78rem;color:#718096;">輔導人員</th>
                <th style="padding:5px 8px;text-align:left;font-size:.78rem;color:#718096;">原因</th>
              </tr></thead>
              <tbody>${oorRows}</tbody>
            </table>`;
        }
      }

      const confirmLabel = excludedIds.size > 0
        ? `確認匯入（排除 ${excludedIds.size} 筆超出範圍記錄）`
        : '確認匯入';
      modal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;max-width:680px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,.25);">
        <h3 style="margin:0 0 14px;font-size:1.05rem;flex-shrink:0;">確認批次匯入服務總表</h3>
        <div style="flex-shrink:0;">${tabBar}</div>
        <div style="flex:1;overflow-y:auto;">${content}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-shrink:0;">
          <button id="_bic_cancel" class="btn btn-secondary">取消</button>
          <button id="_bic_confirm" class="btn btn-primary">${confirmLabel}</button>
        </div>
      </div>`;
      modal.querySelector('#_bic_confirm').onclick = () => { cleanup(); resolve({ confirmed: true, excludedIds }); };
      modal.querySelector('#_bic_cancel').onclick  = () => { cleanup(); resolve({ confirmed: false, excludedIds: new Set() }); };
    };

    window._bicTab = (id) => { activeTab = id; render(); };
    window._bicToggle = (cb) => {
      const id = cb.dataset.recid;
      if (cb.checked) excludedIds.add(id); else excludedIds.delete(id);
      const btn = modal.querySelector('#_bic_confirm');
      if (btn) btn.textContent = excludedIds.size > 0 ? `確認匯入（排除 ${excludedIds.size} 筆超出範圍記錄）` : '確認匯入';
    };
    window._bicSelectAll = (checkAll) => {
      const f = (activeTab !== 'summary' && activeTab !== 'newcounselors') ? parsedFiles.find(pf => pf.name === activeTab) : null;
      const ids = f ? (f.outOfRangeRecords || []).map(r => r.record.id) : parsedFiles.flatMap(pf => (pf.outOfRangeRecords||[]).map(r => r.record.id));
      ids.forEach(id => { if (checkAll) excludedIds.add(id); else excludedIds.delete(id); });
      render();
    };
    window._bicNcToggle = (origText, field, val) => {
      const nc = newCounselorsMap[origText]; if (!nc) return;
      if (field === 'include') nc.include = val === true || val === 'true';
      else nc[field] = val;
      // 不需要 re-render 整個 modal，只更新確認按鈕（姓名/職稱直接在 input 中修改）
    };
    const cleanup = () => { delete window._bicTab; delete window._bicToggle; delete window._bicSelectAll; delete window._bicNcToggle; modal.remove(); };

    render();
    document.body.appendChild(modal);
  });
}

async function _applyBatchImport(allCases, allRecords, fileCount, prog) {
  const now = new Date().toISOString();
  // importedMap 只保留同一 ID 的最後一筆（用於合併基本資料欄位）
  const importedMap = new Map(allCases.map(c => [c.id, c]));
  // fileSemsByID 收集同一 ID 在所有批次檔案中出現過的所有 fileSem（避免多檔匯入時後者覆蓋前者）
  const fileSemsByID = new Map();
  allCases.forEach(c => {
    if (!c.id) return;
    if (!fileSemsByID.has(c.id)) fileSemsByID.set(c.id, new Set());
    if (c.fileSem) fileSemsByID.get(c.id).add(c.fileSem);
    const _s = openDateToSemPrefix(c.openDate);
    if (_s) fileSemsByID.get(c.id).add(_s);
  });
  let addedCases = 0, updatedCases = 0;
  const affectedIds = new Set();

  casesData = casesData.map(ec => {
    const ic = importedMap.get(ec.id);
    if (!ic) return ec;
    updatedCases++;
    const impSem   = openDateToSemPrefix(ic.openDate);
    const fileSem  = ic.fileSem || '';
    const exSems   = Array.isArray(ec.semesters) ? [...ec.semesters] : [openDateToSemPrefix(ec.openDate)].filter(Boolean);
    // 套用此 ID 在所有匯入檔中出現過的全部 fileSem（修正：多學期批次時只保留最後一筆 fileSem 會漏加）
    (fileSemsByID.get(ec.id) || new Set()).forEach(s => { if (s && !exSems.includes(s)) exSems.push(s); });
    if (impSem && !exSems.includes(impSem)) exSems.push(impSem);
    if (fileSem && !exSems.includes(fileSem)) exSems.push(fileSem);
    const snaps = { ...(ec.basicInfoSnapshots || {}) };
    const cSem = openDateToSemPrefix(ec.openDate);
    if (cSem && !snaps[cSem]) { const s={}; BASIC_INFO_SNAPSHOT_FIELDS.forEach(f=>{if(ec[f]!==undefined)s[f]=ec[f];}); snaps[cSem]=s; }
    if (impSem) { const s={}; BASIC_INFO_SNAPSHOT_FIELDS.forEach(f=>{if(ic[f]!==undefined)s[f]=ic[f];}); snaps[impSem]=s; }
    if (fileSem && fileSem !== impSem) { const s={}; BASIC_INFO_SNAPSHOT_FIELDS.forEach(f=>{if(ic[f]!==undefined)s[f]=ic[f];}); snaps[fileSem]=s; }
    const curSem = currentSemesterPrefix();
    const semSt  = { ...(ec.semesterStatus || {}) };
    if (impSem && impSem < curSem) semSt[impSem] = 'closed';
    if (fileSem && fileSem !== impSem && fileSem < curSem) semSt[fileSem] = 'closed';
    // 套用此 ID 在所有批次檔中的 fileSem 的結案狀態
    (fileSemsByID.get(ec.id) || new Set()).forEach(s => { if (s && s < curSem) semSt[s] = 'closed'; });
    const merged = { ...ec, ...ic,
      records: ec.records || [], initialInterview: ec.initialInterview, initialInterviews: ec.initialInterviews,
      psychiatristRecords: ec.psychiatristRecords, semesterEvaluations: ec.semesterEvaluations,
      semesterStatus: semSt, closureEvaluation: ec.closureEvaluation,
      createdAt: ec.createdAt || ic.createdAt,
      semesters: [...new Set(exSems)].sort(), basicInfoSnapshots: snaps };
    merged.status = _recomputeCaseStatus ? _recomputeCaseStatus(merged) : (Object.values(semSt).every(v=>v==='closed') ? 'closed' : 'active');
    // Auto-attach psych test results from psychTestDB for updated cases
    const mergedSid = merged.studentId;
    if (mergedSid && Array.isArray(psychTestDB[mergedSid]) && psychTestDB[mergedSid].length) {
      const existSems = new Set((merged.psychTestResults || []).map(t => t.testSemester));
      const toAdd = psychTestDB[mergedSid].filter(t => !existSems.has(t.testSemester));
      if (toAdd.length) merged.psychTestResults = [...(merged.psychTestResults || []), ...toAdd];
    }
    // 只有真的有變動時才寫入 Drive（避免 re-import 觸發所有 chunk 重寫）
    const semsChanged = merged.semesters.join(',') !== (Array.isArray(ec.semesters) ? [...ec.semesters].sort() : []).join(',');
    const infoChanged = BASIC_INFO_SNAPSHOT_FIELDS.some(f => ic[f] !== undefined && ic[f] !== '' && ec[f] !== ic[f]);
    if (semsChanged || infoChanged) affectedIds.add(ec.id);
    return merged;
  });

  const curSemForNew = currentSemesterPrefix();
  const existingIds = new Set(casesData.map(c => c.id));
  const _newImportIds = [];
  allCases.filter(c => !existingIds.has(c.id)).forEach(c => {
    addedCases++;
    affectedIds.add(c.id);
    _newImportIds.push(c.id);
    const sem = openDateToSemPrefix(c.openDate);
    const _fSem = c.fileSem || '';
    if (!Array.isArray(c.semesters) || !c.semesters.length) c.semesters = sem ? [sem] : [];
    if (_fSem && !c.semesters.includes(_fSem)) c.semesters.push(_fSem);
    c.semesters = [...new Set(c.semesters)].sort();
    if (!c.basicInfoSnapshots && sem) { const s={}; BASIC_INFO_SNAPSHOT_FIELDS.forEach(f=>{if(c[f]!==undefined)s[f]=c[f];}); c.basicInfoSnapshots={[sem]:s}; }
    // 非當學期的所有 semesters 全部預設結案（不只 sem，fileSem 也要設）
    if (!c.semesterStatus) c.semesterStatus = {};
    c.semesters.forEach(s => { if (s && s < curSemForNew) c.semesterStatus[s] = 'closed'; });
    c.status = _recomputeCaseStatus(c);
    // Auto-attach psych test results from psychTestDB for new cases
    const newSid = c.studentId;
    if (newSid && Array.isArray(psychTestDB[newSid]) && psychTestDB[newSid].length) {
      const existSems = new Set((c.psychTestResults || []).map(t => t.testSemester));
      const toAdd = psychTestDB[newSid].filter(t => !existSems.has(t.testSemester));
      if (toAdd.length) c.psychTestResults = [...(c.psychTestResults || []), ...toAdd];
    }
    casesData.push(c);
    _assignChunkForNewCase(c.id); // Slice 3：已重新分塊時分配 active chunk，否則不動作（legacy fallback）
  });
  await _unTombstoneNewCases(_newImportIds); // 重用曾永久刪除的案號時先清墓碑（2026-07-24 事故修補）

  // 去重：同一 ID 可能出現在多個 Excel（跨學期繼續個案），合併 semesters 後只保留第一筆
  {
    const _seenById = new Map();
    casesData = casesData.filter(c => {
      if (!c.id) return true;
      if (_seenById.has(c.id)) {
        const _first = _seenById.get(c.id);
        if (Array.isArray(c.semesters))
          _first.semesters = [...new Set([...(_first.semesters || []), ...c.semesters])].sort();
        if (c.semesterStatus)
          Object.assign(_first.semesterStatus || (_first.semesterStatus = {}), c.semesterStatus);
        _first.semesters.forEach(s => { if (s && s < curSemForNew) { if (!_first.semesterStatus) _first.semesterStatus = {}; _first.semesterStatus[s] = 'closed'; } });
        _first.status = _recomputeCaseStatus(_first);
        return false;
      }
      _seenById.set(c.id, c);
      return true;
    });
  }

  const nameMap = new Map();
  casesData.forEach(c => { if (!c.name) return; if (!nameMap.has(c.name)) nameMap.set(c.name,[]); nameMap.get(c.name).push(c); });
  let addedRecs = 0, updatedRecs = 0, skippedRecs = 0, unmatchedRecs = 0;
  const _recKey = r => `${r.date || ''}|${r.time || ''}`;
  const _recChanged = (a, b) =>
    a.counselorEmail !== b.counselorEmail ||
    a.interventionMode !== b.interventionMode ||
    JSON.stringify(a.interviewees || []) !== JSON.stringify(b.interviewees || []) ||
    JSON.stringify(a.topics || []) !== JSON.stringify(b.topics || []) ||
    JSON.stringify(a.serviceItems || []) !== JSON.stringify(b.serviceItems || []) ||
    (a.summary || '') !== (b.summary || '');
  for (const { studentName, record } of allRecords) {
    const cands = nameMap.get(studentName) || [];
    let target = null;
    if (cands.length === 1) { target = cands[0]; }
    else if (cands.length > 1) { const s = cands.filter(c=>c.openDate&&c.openDate<=(record.date||'9999')).sort((a,b)=>b.openDate.localeCompare(a.openDate)); target = s[0] || cands[0]; }
    if (target) {
      if (!target.records) target.records = [];
      const key = _recKey(record);
      const matchIdx = key ? target.records.findIndex(r => _recKey(r) === key) : -1;
      if (matchIdx >= 0) {
        if (_recChanged(target.records[matchIdx], record)) {
          target.records[matchIdx] = { ...target.records[matchIdx], ...record, id: target.records[matchIdx].id, createdAt: target.records[matchIdx].createdAt, updatedAt: new Date().toISOString() };
          updatedRecs++; affectedIds.add(target.id);
        } else { skippedRecs++; }
      } else {
        target.records.push({ ...record, id: `REC-BATCH-${Date.now()}-${Math.random().toString(36).slice(2)}` });
        addedRecs++; affectedIds.add(target.id);
      }
    } else { unmatchedRecs++; }
  }

  _syslog('info', `批次匯入統計：新增 ${addedCases} 筆，更新 ${updatedCases} 筆，記錄新增 ${addedRecs}/更新 ${updatedRecs}/略過 ${skippedRecs}/無法比對 ${unmatchedRecs} 筆`);
  prog.innerHTML = `<span style="color:#718096;">統計：新增 ${addedCases} 筆個案、更新 ${updatedCases} 筆…寫入中</span>`;

  const jobId = bgJobAdd(`批次匯入服務總表（${fileCount} 個檔案）`);
  try {
    const _affArr = [...affectedIds];
    // 把「重新匯入的 ID」從墓碑清單移除，否則 _batchWriteChunks 會被 deletedSet 過濾掉
    if (Array.isArray(casesManifest.deletedIds) && casesManifest.deletedIds.length > 0) {
      const _affSet = new Set(_affArr);
      const _before = casesManifest.deletedIds.length;
      casesManifest.deletedIds = casesManifest.deletedIds.filter(id => !_affSet.has(id));
      if (casesManifest.deletedIds.length < _before) {
        _syslog('info', `移除墓碑：${_before - casesManifest.deletedIds.length} 筆（重新匯入）`);
        await driveSaveJsonInCases('manifest.json', casesManifest);
      }
    }
    const _chunkCount = new Set(_affArr.map(getCaseChunkName)).size;
    _syslog('info', `批次匯入寫入：${_affArr.length} 筆個案 → ${_chunkCount} 個 chunk`);
    await _batchWriteChunks(_affArr, (done, total) => {
      prog.innerHTML = `<span style="color:#718096;">寫入 chunk ${done}/${total}…</span>`;
    });
    let msg = `✓ 批次匯入完成`;
    if (addedCases)    msg += `：新增 ${addedCases} 筆個案`;
    if (updatedCases)  msg += `${addedCases?'、':'：'}更新 ${updatedCases} 筆`;
    if (addedRecs)     msg += `、新增 ${addedRecs} 筆記錄`;
    if (updatedRecs)   msg += `、更新 ${updatedRecs} 筆記錄`;
    if (skippedRecs)   msg += `、略過 ${skippedRecs} 筆重複`;
    if (unmatchedRecs) msg += `（${unmatchedRecs} 筆記錄無法比對個案）`;
    prog.innerHTML = `<span style="color:#276749;font-weight:600;">${msg}</span>`;
    showToast(msg, 'success', 7000);
    bgJobDone(jobId);
    auditLog('批次匯入服務總表', null, null, `${fileCount} 個檔案，${addedCases} 新增，${updatedCases} 更新，記錄新增 ${addedRecs}/更新 ${updatedRecs}/略過 ${skippedRecs}`);
    renderCases();
  } catch(e) {
    bgJobFail(jobId, e.message);
    auditLog('匯入失敗', null, null, `批次匯入失敗：${e.message}`);
    prog.innerHTML = `<span style="color:#c53030;">✗ 寫入失敗：${escHtml(e.message)}</span>`;
  }
}

async function importCasesFromExcel(file) {
  const prog = document.getElementById('import-progress');
  prog.style.display = '';
  prog.innerHTML = '<span style="color:#718096;">載入 SheetJS 中…</span>';

  prog.innerHTML = '<span style="color:#718096;">讀取檔案中…</span>';
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });

    const ws = wb.Sheets['學生資料'];
    if (!ws) throw new Error('找不到「學生資料」工作表，請確認檔案格式。');

    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    prog.innerHTML = `<span style="color:#718096;">解析資料中（共 ${rows.length-1} 列）…</span>`;

    // 從檔名前 5 碼（如 "113-1"）取得學期代號 → "1131"
    const _fnMatch = file.name.match(/^(\d{3})-([12])/);
    const fileSemPrefix = _fnMatch ? _fnMatch[1] + _fnMatch[2] : '';
    const fileSemRange  = semesterDateRange(fileSemPrefix);

    const imported = [];
    const rocToAD = (raw) => {
      const s = String(raw).replace(/\D/g,'');
      if (s.length === 7) { const y=parseInt(s.slice(0,3))+1911; return `${y}-${s.slice(3,5)}-${s.slice(5,7)}`; }
      if (s.length === 6) { const y=parseInt(s.slice(0,2))+1911; return `${y}-${s.slice(2,4)}-${s.slice(4,6)}`; }
      return '';
    };
    const bsrsTextMap = {'完全沒有':0,'輕微':1,'有時如此':2,'常常如此':3,'幾乎每天':4};
    const parseEmg = (raw) => {
      const m = String(raw).match(/^(.+?)[\(（](.+?)[\)）]$/);
      return m ? [m[1].trim(), m[2].trim()] : [String(raw).trim(), ''];
    };
    const identityMap = (id, grade) => {
      if (id.includes('博碩') || id.includes('碩') || id.includes('博')) {
        const prog = (grade||'').includes('博') ? '博士班' : '碩士班';
        return { caseType:'研究所', program:prog };
      }
      if (id.includes('進修')) return { caseType:'進修部', program:'大學-進修部' };
      return { caseType:'日間部', program:'大學-日間部' };
    };
    const findCounselorEmail = (nameText) => {
      for (const [email, info] of Object.entries(configData?.users||{})) {
        if (info.name && nameText.includes(info.name)) return email;
      }
      return '';
    };

    const now = new Date().toISOString();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id = String(r[1]||'').trim();
      if (!id || id.length !== 7 || isNaN(parseInt(id))) continue;

      const counselorText = String(r[5]||'').trim();
      // A欄（r[0]）：讀取A案/B案；空格時若有主責則歸A案（漏填），否則也預設A案
      const abRaw = String(r[0]||'').trim();
      const abType = abRaw.includes('B') ? 'B案' : (abRaw.includes('A') ? 'A案' : (counselorText ? 'A案' : 'A案'));
      const grade         = String(r[7]||'').trim();
      const identity      = String(r[24]||'').trim();
      const { caseType, program } = identityMap(identity, grade);
      const gradLevel = caseType === '研究所' ? (program === '博士班' ? '博' : '碩') : '';

      const natRaw   = String(r[25]||'').trim();
      const nationality = natRaw === '台灣' || natRaw === '臺灣' ? '本國籍' : (natRaw ? '外國籍' : '本國籍');
      const foreignCountry = nationality === '外國籍' ? natRaw : '';

      const bsrs6Raw   = String(r[17]||'').trim();
      const bsrsTotalRaw = r[16];
      const [emgName, emgRelation] = parseEmg(r[18]);
      const counselorEmail = findCounselorEmail(counselorText);
      const counselorName  = counselorEmail ? (formatCounselorLabel(counselorEmail) || counselorEmail) : counselorText;

      const closeDateRaw = String(r[27]||'').trim();
      let   closeDate    = closeDateRaw ? rocToAD(closeDateRaw) : '';

      const openDateRaw  = String(r[2]||'').trim();
      let   openDateAD   = rocToAD(openDateRaw);
      const importDateNotes = [];
      if (fileSemRange) {
        if (!openDateAD || openDateAD < fileSemRange.first || openDateAD > fileSemRange.last) {
          importDateNotes.push(`開案日期「${openDateRaw || '（空白）'}」不在學期範圍（${fileSemRange.first} 至 ${fileSemRange.last}），已自動修正為學期第一天 ${fileSemRange.first}。`);
          openDateAD = fileSemRange.first;
        }
        if (closeDateRaw) {
          if (!closeDate || closeDate < fileSemRange.first || closeDate > fileSemRange.last) {
            importDateNotes.push(`結案日期「${closeDateRaw}」不在學期範圍（${fileSemRange.first} 至 ${fileSemRange.last}），已自動修正為學期最後一天 ${fileSemRange.last}。`);
            closeDate = fileSemRange.last;
          }
        }
      }

      imported.push({
        id,
        abType,
        openDate:        openDateAD,
        name:            String(r[4]||'').trim(),
        studentId:       String(r[13]||'').trim(),
        birthday:        rocToAD(String(r[11]||'').trim()),
        idNumber:        String(r[10]||'').trim(),
        legalGender:     String(r[8]||'').trim(),
        genderIdentity:  '',
        caseType, gradLevel, program,
        nationality, foreignCountry,
        ethnicity:'', ethnicityNote:'',
        department:      String(r[6]||'').trim(),
        grade,
        classNo:'',
        phone:           String(r[14]||'').trim(),
        residence:'',
        address:         String(r[15]||'').trim(),
        emergencyName:   emgName,
        emergencyPhone:  String(r[19]||'').trim(),
        emergencyRelation: emgRelation,
        source:          String(r[22]||'').trim() || '主動來談',
        pastRecords:[],
        topics:[],
        counselorEmail,
        counselorName,
        counselorText: counselorText || '',
        status:          closeDate ? 'closed' : 'active',
        closeDate,
        bsrs:            null,
        bsrsTotal:       bsrsTotalRaw !== '' ? (parseInt(bsrsTotalRaw)||null) : null,
        bsrs6:           bsrs6Raw !== '' ? (bsrsTextMap[bsrs6Raw] ?? null) : null,
        testSemester:    String(r[36]||'').trim(),
        psychTestResults: (() => {
          const toNum = v => (v !== '' && v != null) ? (parseFloat(v) || null) : null;
          const ts = String(r[36]||'').trim();
          const AL = toNum(r[39]);
          const dims = { AL,
            S01:toNum(r[40]),S02:toNum(r[41]),S03:toNum(r[42]),S04:toNum(r[43]),
            S05:toNum(r[44]),S06:toNum(r[45]),S07:toNum(r[46]),S08:toNum(r[47]),
            S09:toNum(r[48]),S10:toNum(r[49]),S11:toNum(r[50]),S12:toNum(r[51]) };
          const hasAny = Object.values(dims).some(v => v !== null);
          return hasAny ? [{ testSemester: ts, ...dims, importedAt: now }] : [];
        })(),
        disability:'',
        isImported:      true,
        importDateNotes: importDateNotes.length ? importDateNotes : undefined,
        createdAt: now, updatedAt: now,
      });
    }

    // 偵測：是否包含「當前學期之前」的個案 → 預設全部結案，請使用者勾選未結案
    const curSem = currentSemesterPrefix();
    const isOlderThanCurrent = (sem) => {
      if (!sem || !curSem) return false;
      // 形如 "1141"，前 3 碼為年、最後 1 碼為學期；做字串比較即可
      return sem < curSem;
    };
    // 歷史學期個案預設結案（使用者可在預覽介面中調整）
    imported.forEach(c => {
      if (isOlderThanCurrent(openDateToSemPrefix(c.openDate))) {
        if (!c.closeDate) {
          c.closeDate = c.openDate;
          c.status = 'closed';
          c._defaultedClosed = true;
        }
      }
    });

    // 收集未識別主責人員（counselorEmail 空但 counselorText 有值）
    const _newCounselorsMap = {};
    imported.forEach(c => {
      if (!c.counselorEmail && c.counselorText) {
        const txt = c.counselorText;
        if (!_newCounselorsMap[txt]) {
          _newCounselorsMap[txt] = { origText: txt, name: txt, role: '兼任諮商心理師',
            key: 'nomail_' + txt.replace(/\s+/g,'') + '_' + Date.now(), count: 0, include: true };
        }
        _newCounselorsMap[txt].count++;
      }
    });

    prog.innerHTML = '<span style="color:#718096;">請於預覽介面確認所有個案後再匯入…</span>';
    const confirmed = await showImportReviewModal(imported, prog, _newCounselorsMap);
    if (!confirmed) return;
    await finalizeImport(imported, prog);
  } catch(e) {
    if (e.xlsxCancelled) {
      prog.innerHTML = `<span style="color:#c53030;">${escHtml(e.message)}</span>`;
      return;
    }
    auditLog('匯入失敗', null, null, `匯入個案基本資料失敗：${e.message}`);
    prog.innerHTML = `<span style="color:#c53030;">✗ 匯入失敗：${escHtml(e.message)}</span><br><span style="color:#a0aec0;font-size:.8rem;">若檔案受密碼保護，系統會自動跳出密碼輸入視窗；如仍失敗請確認檔案未毀損或格式正確。</span>`;
  }
}

// 匯入預覽 modal：呈現所有解析出的個案，供使用者逐欄確認後再匯入
function showImportReviewModal(imported, prog, newCounselorsMap) {
  return new Promise(resolve => {
    let modal = document.getElementById('ir-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'ir-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

    const PAGE_SIZE = 10;
    const reviewMap = new Map(); // origIdx → { status, closeDate, counselorEmail, counselorName, _selected }
    // 新增人員狀態（可編輯名稱、職稱）
    const ncMap = newCounselorsMap || {};
    imported.forEach((c, i) => {
      let counselorEmail = c.counselorEmail || '';
      let counselorName  = c.counselorName || c.counselorText || '';
      // Auto-assign ncMap entry if counselor is not in system yet
      if (!counselorEmail && c.counselorText && ncMap[c.counselorText]) {
        const nc = ncMap[c.counselorText];
        if (nc.include && nc.key) { counselorEmail = nc.key; counselorName = nc.name || c.counselorText; }
      }
      reviewMap.set(i, {
        status: c.status,
        closeDate: c.closeDate || '',
        counselorEmail,
        counselorName,
        _selected: true,
      });
    });

    // 顯示順序：應確認（舊學期預設結案）優先，其次依開案日期由新到舊
    const sorted = imported
      .map((c, origIdx) => ({ ...c, _origIdx: origIdx }))
      .sort((a, b) => {
        if (a._defaultedClosed && !b._defaultedClosed) return -1;
        if (!a._defaultedClosed && b._defaultedClosed) return 1;
        return (b.openDate || '').localeCompare(a.openDate || '');
      });

    let _tab = 'all', _search = '', _page = 0;
    const ncKeys = Object.keys(ncMap);
    const ncCount = ncKeys.length;

    // Dynamic: includes ncMap entries (include=true, name+role filled) so dropdowns show them immediately
    const getCounselorEntries = () => {
      const base = Object.entries(configData?.users || {})
        .filter(([, info]) => BK_COUNSELING_ROLES.has(info.role || ''));
      for (const nc of Object.values(ncMap)) {
        if (nc.include && nc.name && nc.role && nc.key && !configData?.users?.[nc.key]) {
          base.push([nc.key, { name: nc.name, role: nc.role }]);
        }
      }
      return base;
    };

    const getFiltered = () => {
      const q = _search.toLowerCase();
      return sorted.filter(c => {
        const ed = reviewMap.get(c._origIdx);
        if (_tab === 'confirm' && !c._defaultedClosed) return false;
        if (_tab === 'nocounselor' && ed.counselorEmail) return false;
        if (q && !((c.name||'').toLowerCase().includes(q) ||
                   (c.id||'').toLowerCase().includes(q) ||
                   (c.studentId||'').toLowerCase().includes(q) ||
                   (ed.counselorName||'').toLowerCase().includes(q))) return false;
        return true;
      });
    };

    const renderTable = () => {
      const filtered = getFiltered();
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (_page >= totalPages) _page = totalPages - 1;
      const rows = filtered.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

      const confirmCount = sorted.filter(c => c._defaultedClosed).length;
      const noCounselorCount = sorted.filter(c => !reviewMap.get(c._origIdx).counselorEmail).length;

      const ts = (tab, color) => {
        const on = _tab === tab;
        return `padding:7px 14px;border:none;background:none;cursor:pointer;font-size:.86rem;border-bottom:2px solid ${on?color:'transparent'};margin-bottom:-2px;color:${on?color:'#4a5568'};font-weight:${on?'600':'400'};`;
      };
      const tabs = `
        <div style="display:flex;margin-bottom:14px;border-bottom:2px solid #e2e8f0;flex-wrap:wrap;">
          <button type="button" onclick="irTab('all')" style="${ts('all','#3182ce')}">全部（${sorted.length}）</button>
          ${confirmCount ? `<button type="button" onclick="irTab('confirm')" style="${ts('confirm','#e53e3e')}">⚠ 應確認（${confirmCount}）</button>` : ''}
          ${noCounselorCount ? `<button type="button" onclick="irTab('nocounselor')" style="${ts('nocounselor','#dd6b20')}">主責未比對（${noCounselorCount}）</button>` : ''}
          ${ncCount ? `<button type="button" onclick="irTab('newcounselors')" style="${ts('newcounselors','#6b46c1')}">👤 新增人員（${ncCount}）</button>` : ''}
        </div>`;

      const rowsHtml = rows.map((c, ri) => {
        const oi = c._origIdx;
        const ed = reviewMap.get(oi);
        const warn = c._defaultedClosed;
        const bg = warn ? '#fff5f5' : (ri%2===0 ? '#fff' : '#f7fafc');
        /* COUNSELOR_SELECT_GROUP:ir-counselor (special: includes ncMap new entries, skip optgroup) */
        const counselorOpts = getCounselorEntries().map(([em, info]) =>
          `<option value="${escHtml(em)}" ${ed.counselorEmail===em?'selected':''}>${escHtml(info.name||em)}</option>`
        ).join('');
        const statusRadio =
          `<label style="white-space:nowrap;cursor:pointer;font-size:.79rem;display:inline-flex;align-items:center;gap:3px;">` +
          `<input type="radio" name="ir-st-${oi}" value="active" ${ed.status==='active'?'checked':''} onchange="irUpd(${oi},'status','active')" style="cursor:pointer;"> 在案中</label>` +
          `<label style="white-space:nowrap;cursor:pointer;font-size:.79rem;display:inline-flex;align-items:center;gap:3px;margin-left:6px;">` +
          `<input type="radio" name="ir-st-${oi}" value="closed" ${ed.status==='closed'?'checked':''} onchange="irUpd(${oi},'status','closed')" style="cursor:pointer;"> 已結案</label>`;
        const closeDateCell = ed.status === 'closed'
          ? `<input type="date" value="${escHtml(ed.closeDate)}" onchange="irUpd(${oi},'closeDate',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:2px 4px;font-size:.78rem;width:116px;">`
          : `<span style="color:#a0aec0;font-size:.79rem;">—</span>`;
        return `<tr style="background:${bg};opacity:${ed._selected?'1':'.45'};">
          <td style="padding:5px 8px;text-align:center;width:30px;"><input type="checkbox" ${ed._selected?'checked':''} onclick="irSel(${oi},this.checked,event)" style="width:14px;height:14px;cursor:pointer;"></td>
          <td style="padding:5px 8px;text-align:center;width:22px;">${warn?'<span style="color:#e53e3e;font-size:.82rem;" title="已預設結案，請確認">⚠</span>':''}</td>
          <td style="padding:5px 8px;font-size:.79rem;color:#4a5568;white-space:nowrap;">${escHtml(c.id)}</td>
          <td style="padding:5px 8px;font-size:.78rem;white-space:nowrap;"><span style="padding:2px 7px;border-radius:10px;background:${c.abType==='B案'?'#fed7e2':'#c6f6d5'};color:${c.abType==='B案'?'#9b2c2c':'#276749'};font-weight:600;">${escHtml(c.abType||'—')}</span></td>
          <td style="padding:5px 8px;font-size:.85rem;font-weight:600;">${escHtml(c.name||'—')}</td>
          <td style="padding:5px 8px;font-size:.78rem;color:#718096;">${escHtml(c.studentId||'—')}</td>
          <td style="padding:5px 8px;font-size:.78rem;color:#718096;white-space:nowrap;">${escHtml(c.openDate||'—')}</td>
          <td style="padding:5px 8px;"><select onchange="irUpd(${oi},'counselorEmail',this.value)" style="border:1px solid ${!ed.counselorEmail?'#fc8181':'#cbd5e0'};border-radius:4px;padding:2px 4px;font-size:.78rem;max-width:128px;"><option value="">— 未指定 —</option>${counselorOpts}</select></td>
          <td style="padding:5px 8px;">${statusRadio}</td>
          <td style="padding:5px 8px;">${closeDateCell}</td>
        </tr>`;
      }).join('');

      const pag = totalPages <= 1 ? '' : `
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;font-size:.84rem;color:#4a5568;">
          <button type="button" onclick="irPg(${_page-1})" ${_page===0?'disabled':''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;cursor:pointer;">‹</button>
          <span>第 ${_page+1} / ${totalPages} 頁（${filtered.length} 筆）</span>
          <button type="button" onclick="irPg(${_page+1})" ${_page>=totalPages-1?'disabled':''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;cursor:pointer;">›</button>
        </div>`;

      if (_tab === 'newcounselors') {
        const ncRoleOpts = ROLES.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
        const ncRowsHtml = ncKeys.map(txt => {
          const nc = ncMap[txt];
          return `<tr style="background:#faf5ff;">
            <td style="padding:6px 10px;text-align:center;"><input type="checkbox" ${nc.include?'checked':''} onchange="irUpdNC('${escHtml(txt)}','include',this.checked)" style="cursor:pointer;width:14px;height:14px;"></td>
            <td style="padding:6px 10px;font-size:.83rem;color:#718096;">${escHtml(txt)}</td>
            <td style="padding:6px 10px;"><input type="text" value="${escHtml(nc.name)}" oninput="irUpdNC('${escHtml(txt)}','name',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 7px;font-size:.83rem;width:120px;"></td>
            <td style="padding:6px 10px;"><select onchange="irUpdNC('${escHtml(txt)}','role',this.value)" style="border:1px solid #cbd5e0;border-radius:4px;padding:3px 5px;font-size:.83rem;"><option value="">— 請選擇職稱 —</option>${ncRoleOpts.replace(new RegExp(`value="${escHtml(nc.role)}"`), `value="${escHtml(nc.role)}" selected`)}</select></td>
            <td style="padding:6px 10px;font-size:.78rem;color:#a0aec0;text-align:center;">${nc.count} 個案</td>
          </tr>`;
        }).join('');
        return `${tabs}
          <div style="padding:6px 0 10px;font-size:.83rem;color:#553c9a;background:#faf5ff;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
            以下人員在 Excel 中有出現，但在系統使用者清單中找不到對應帳號。<br>勾選後將於確認匯入時自動新增至使用者管理（無 Gmail 帳號格式）。
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:#e9d8fd;text-align:left;">
                <th style="padding:6px 10px;width:28px;"></th>
                <th style="padding:6px 10px;font-size:.8rem;">Excel 中顯示名稱</th>
                <th style="padding:6px 10px;font-size:.8rem;">姓名（可修改）</th>
                <th style="padding:6px 10px;font-size:.8rem;">職稱</th>
                <th style="padding:6px 10px;font-size:.8rem;text-align:center;">使用案數</th>
              </tr></thead>
              <tbody>${ncRowsHtml}</tbody>
            </table>
          </div>`;
      }

      const allFilteredSel = filtered.every(c => reviewMap.get(c._origIdx)._selected);
      return `${tabs}
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#edf2f7;text-align:left;">
              <th style="padding:6px 8px;width:30px;text-align:center;"><input type="checkbox" title="全選/全不選" ${allFilteredSel?'checked':''} onchange="irSelAll(this.checked)" style="width:14px;height:14px;cursor:pointer;"></th>
              <th style="padding:6px 8px;width:22px;"></th>
              <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">案號</th>
              <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">案別</th>
              <th style="padding:6px 8px;font-size:.8rem;">姓名</th>
              <th style="padding:6px 8px;font-size:.8rem;">學號</th>
              <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">開案日期</th>
              <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">主責輔導人員</th>
              <th style="padding:6px 8px;font-size:.8rem;">狀態</th>
              <th style="padding:6px 8px;font-size:.8rem;white-space:nowrap;">結案日期</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>${pag}`;
    };

    const rerender = () => {
      const el = modal.querySelector('#ir-tbl'); if (el) el.innerHTML = renderTable();
      const btn = modal.querySelector('#ir-confirm');
      if (btn) { const n = [...reviewMap.values()].filter(ed => ed._selected).length; btn.textContent = `確認匯入（${n} 筆）`; }
    };

    window.irTab = (t) => { _tab = t; _page = 0; rerender(); };
    window.irUpdNC = (origText, field, val) => {
      const nc = ncMap[origText]; if (!nc) return;
      if (field === 'include') nc.include = val;
      else if (field === 'name') nc.name = val;
      else if (field === 'role') nc.role = val;
      // Sync reviewMap entries whose counselorText matches this nc entry
      imported.forEach((c, origIdx) => {
        if (c.counselorText !== origText) return;
        const ed = reviewMap.get(origIdx);
        if (field === 'include') {
          if (val && nc.name && nc.key) {
            ed.counselorEmail = nc.key;
            ed.counselorName  = nc.name;
          } else if (!val && ed.counselorEmail === nc.key) {
            ed.counselorEmail = '';
            ed.counselorName  = c.counselorText || '';
          }
        } else if (field === 'name' && ed.counselorEmail === nc.key) {
          ed.counselorName = val;
        }
      });
      rerender();
    };
    window.irSearch = (v) => { _search = v; _page = 0; rerender(); };
    window.irPg = (p) => {
      const tot = Math.max(1, Math.ceil(getFiltered().length / PAGE_SIZE));
      _page = Math.max(0, Math.min(tot-1, p));
      rerender();
    };
    window.irUpd = (origIdx, field, val) => {
      const ed = reviewMap.get(origIdx);
      if (field === 'status') { ed.status = val; if (val === 'active') ed.closeDate = ''; }
      else if (field === 'closeDate') { ed.closeDate = val; }
      else if (field === 'counselorEmail') {
        ed.counselorEmail = val;
        const info = configData?.users?.[val];
        const ncEntry = Object.values(ncMap).find(nc => nc.key === val);
        if (info) ed.counselorName = formatCounselorLabel(val) || info.name || val;
        else if (ncEntry) ed.counselorName = ncEntry.name || val;
        else ed.counselorName = '';
      }
      rerender();
    };
    window._irLastClick = -1;
    // Shift 範圍計算改呼叫共用純函式 _ckgRangeIndices（見全站批次勾選共用 helper），
    // 不再各自重複實作同一段 Math.min/max 範圍邏輯。
    window.irSel = (origIdx, checked, evt) => {
      const ids = getFiltered().map(c => c._origIdx);
      const range = (evt?.shiftKey && window._irLastClick >= 0) ? _ckgRangeIndices(ids, window._irLastClick, origIdx) : [origIdx];
      range.forEach(id => { reviewMap.get(id)._selected = checked; });
      window._irLastClick = origIdx;
      rerender();
    };
    window.irSelAll = (checked) => {
      getFiltered().forEach(c => { reviewMap.get(c._origIdx)._selected = checked; });
      window._irLastClick = -1;
      rerender();
    };

    const confirmCount = sorted.filter(c => c._defaultedClosed).length;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:980px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
          <h3 style="margin:0;color:#1a5276;font-size:1.1rem;">匯入預覽：確認所有個案資料</h3>
          <div style="color:#718096;font-size:.84rem;margin-top:5px;">
            共解析 <strong>${sorted.length}</strong> 筆個案。${confirmCount ? ` 其中 <strong style="color:#e53e3e;">${confirmCount}</strong> 筆來自舊學期，已預設「已結案」—請確認狀態後再匯入。` : ''}
          </div>
          <div style="margin-top:10px;">
            <input type="text" placeholder="搜尋姓名 / 案號 / 學號 / 主責…" style="width:100%;max-width:340px;padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:.87rem;" oninput="irSearch(this.value)" />
          </div>
        </div>
        <div id="ir-tbl" style="padding:16px 24px;overflow:auto;flex:1;">${renderTable()}</div>
        <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;flex-shrink:0;">
          <button class="btn btn-secondary" type="button" id="ir-cancel">取消匯入</button>
          <button class="btn btn-primary" type="button" id="ir-confirm">確認匯入（${sorted.length} 筆）</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#ir-cancel').onclick = () => {
      modal.remove();
      prog.innerHTML = '<span style="color:#a0aec0;">已取消匯入。</span>';
      resolve(false);
    };
    modal.querySelector('#ir-confirm').onclick = async () => {
      // 1. 新增未識別主責人員到 configData
      const addedCounselors = [];
      for (const [origText, nc] of Object.entries(ncMap)) {
        if (!nc.include || !nc.name) continue;
        if (!nc.role) { alert(`請為「${nc.name}」選擇職稱後再確認匯入。`); return; }
        const key = nc.key || ('nomail_' + nc.name.replace(/\s+/g,'') + '_import');
        if (!configData.users[key]) {
          configData.users[key] = { name: nc.name, role: nc.role };
          addedCounselors.push({ origText, key, name: nc.name, role: nc.role });
        }
        nc.resolvedKey = key;
      }
      if (addedCounselors.length) {
        try { driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {}); } catch(_) {}
      }

      // 2. 將已解析的主責人員 key 回寫到 reviewMap
      imported.forEach((c, origIdx) => {
        if (!c.counselorEmail && c.counselorText) {
          const nc = ncMap[c.counselorText];
          if (nc?.resolvedKey) {
            const ed = reviewMap.get(origIdx);
            ed.counselorEmail = nc.resolvedKey;
            ed.counselorName  = nc.name;
          }
        }
      });

      // 3. 收集最終匯入清單
      const finalImported = [];
      imported.forEach((c, origIdx) => {
        const ed = reviewMap.get(origIdx);
        if (!ed._selected) return;
        finalImported.push({ ...c, status: ed.status, closeDate: ed.closeDate, counselorEmail: ed.counselorEmail, counselorName: ed.counselorName });
        delete finalImported[finalImported.length-1]._defaultedClosed;
      });
      imported.length = 0;
      finalImported.forEach(c => imported.push(c));
      modal.remove();
      resolve(true);
    };
  });
}

// 歷史學期匯入：彈出 UI 讓使用者勾選哪些「其實還未結案」
function showImportClosurePicker(imported, prog) {
  return new Promise((resolve) => {
    let modal = document.getElementById('import-closure-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'import-closure-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:30px;';

    // 列出被預設為「結案」的個案（依學期分組）
    const candidates = imported.filter(c => c._defaultedClosed);
    const grouped = {};
    candidates.forEach(c => {
      const sem = openDateToSemPrefix(c.openDate) || '其他';
      if (!grouped[sem]) grouped[sem] = [];
      grouped[sem].push(c);
    });
    const semKeys = Object.keys(grouped).sort();

    const rowsHtml = semKeys.map(sem => {
      const list = grouped[sem].map(c => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #f0f4f8;font-size:.88rem;">
          <input type="checkbox" data-case-id="${escHtml(c.id)}" class="imp-unclosed" />
          <span style="flex:1;">
            <strong>${escHtml(c.name || '—')}</strong>
            <span style="color:#718096;font-size:.78rem;">（${escHtml(c.id)} / ${escHtml(c.studentId || '')}）</span>
            <span style="color:#a0aec0;font-size:.78rem;margin-left:6px;">主責：${escHtml(c.counselorText || c.counselorName || '—')}</span>
          </span>
          <span style="color:#a0aec0;font-size:.78rem;">開案：${escHtml(c.openDate || '—')}</span>
        </label>`).join('');
      return `
        <div style="margin-bottom:18px;">
          <div style="font-weight:700;font-size:.95rem;color:#1a5276;background:#ebf5fb;padding:8px 12px;border-radius:6px;margin-bottom:6px;">
            ${escHtml(semesterLabel(sem))} 學期（${grouped[sem].length} 筆）
          </div>
          <div style="max-height:none;overflow:visible;">${list}</div>
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:920px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
          <h3 style="margin:0;color:#1a5276;font-size:1.15rem;">確認匯入：勾選「仍未結案」的個案</h3>
          <div style="color:#718096;font-size:.85rem;margin-top:6px;line-height:1.5;">
            您正在匯入歷史學期的服務總表（${candidates.length} 筆來自於 ${semKeys.map(s => semesterLabel(s)).join('、')} 學期）。
            系統已預設這些個案為「<b style="color:#c53030;">已結案</b>」。
            請勾選哪些個案<b style="color:#1a5276;">實際上仍未結案</b>，再按確認匯入。
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="imp-search" class="field-input" placeholder="搜尋姓名 / 學號 / 案號 / 主責…" style="flex:1;min-width:200px;" oninput="filterImportClosureRows()" />
            <button class="btn btn-secondary btn-sm" type="button" onclick="document.querySelectorAll('.imp-unclosed:not([style*=display\\\\:none])').forEach(c=>c.checked=true)">全選顯示中</button>
            <button class="btn btn-secondary btn-sm" type="button" onclick="document.querySelectorAll('.imp-unclosed').forEach(c=>c.checked=false)">全部取消</button>
          </div>
        </div>
        <div id="imp-closure-list" style="padding:16px 24px;overflow:auto;flex:1;">${rowsHtml}</div>
        <div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;">
          <button class="btn btn-secondary" type="button" id="imp-cancel-btn">取消匯入</button>
          <button class="btn btn-primary" type="button" id="imp-confirm-btn">確認匯入</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const finish = async (proceed) => {
      if (!proceed) {
        modal.remove();
        prog.innerHTML = '<span style="color:#a0aec0;">已取消匯入。</span>';
        resolve();
        return;
      }
      // 將勾選的個案改回 active 並清空 closeDate
      const unclosedIds = new Set([...modal.querySelectorAll('.imp-unclosed:checked')].map(cb => cb.dataset.caseId));
      imported.forEach(c => {
        if (unclosedIds.has(c.id)) {
          c.status = 'active';
          c.closeDate = '';
        }
        delete c._defaultedClosed;
      });
      modal.remove();
      await finalizeImport(imported, prog);
      resolve();
    };

    modal.querySelector('#imp-cancel-btn').onclick = () => finish(false);
    modal.querySelector('#imp-confirm-btn').onclick = () => finish(true);
  });
}

// 匯入合併預覽 modal — 讓使用者選擇重複案號的處理方式（略過 / 更新）
function showImportMergePreview(imported, prog) {
  return new Promise(resolve => {
    let modal = document.getElementById('import-merge-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'import-merge-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:30px;';

    const existingMap = new Map(casesData.map(c => [c.id, c]));
    const newCases = [], dupCases = [];
    imported.forEach(imp => {
      const ex = existingMap.get(imp.id);
      if (!ex) { newCases.push(imp); return; }
      // Same ID, different semester → same student continuing across semesters; mark for semester tracking
      const impSem = openDateToSemPrefix(imp.openDate);
      const exSem  = openDateToSemPrefix(ex.openDate);
      if (impSem && exSem && impSem !== exSem) imp._crossSemMerge = true;
      dupCases.push(imp);
    });

    // Same name → auto smart-merge. Different name → per-case decision.
    // Cross-semester duplicates always treat as same-name (same student guaranteed).
    const sameNameDups = [];
    const diffNameDups = []; // { imp, ex, action:'use-imported'|'skip' }
    dupCases.forEach(imp => {
      const ex = casesData.find(c => c.id === imp.id);
      const sameN = imp._crossSemMerge || !imp.name || !ex?.name || imp.name === ex.name;
      if (sameN) sameNameDups.push({ imp, ex });
      else diffNameDups.push({ imp, ex, action: 'use-imported' });
    });

    const diffChoices = new Map(diffNameDups.map(d => [d.imp.id, 'use-imported']));

    const sameNameHtml = sameNameDups.length === 0 ? '' : `
      <div style="margin-top:14px;padding:12px 14px;background:#f0fff4;border-radius:8px;border:1px solid #9ae6b4;">
        <div style="font-weight:600;color:#276749;margin-bottom:6px;">✓ 同案號（${sameNameDups.length} 筆，含跨學期同案）— 自動以最新資料更新、保留既有晤談紀錄、累積學期</div>
        <details><summary style="font-size:.82rem;color:#276749;cursor:pointer;">查看清單</summary>
          <div style="margin-top:6px;max-height:140px;overflow:auto;border:1px solid #c6f6d5;border-radius:4px;">
            ${sameNameDups.map(d => `<div style="font-size:.82rem;padding:4px 8px;border-bottom:1px solid #e6ffed;">${escHtml(d.imp.id)} <strong>${escHtml(d.imp.name||'')}</strong></div>`).join('')}
          </div>
        </details>
      </div>`;

    const diffNameHtml = diffNameDups.length === 0 ? '' : `
      <div style="margin-top:14px;padding:12px 14px;background:#fff8e1;border-radius:8px;border:1px solid #f6ad55;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          <div style="font-weight:600;color:#7d4e00;">⚠ 同案號但姓名不一致（${diffNameDups.length} 筆）— 請逐筆確認</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" type="button" onclick="window._impSetAllDiff('skip')">全部略過（保留現有）</button>
            <button class="btn btn-secondary btn-sm" type="button" onclick="window._impSetAllDiff('use-imported')">全部以匯入取代</button>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.83rem;">
            <thead><tr style="background:#fef9c3;">
              <th style="padding:5px 8px;text-align:left;">案號</th>
              <th style="padding:5px 8px;text-align:left;">系統現有姓名</th>
              <th style="padding:5px 8px;text-align:left;">匯入資料姓名</th>
              <th style="padding:5px 8px;text-align:left;">處理方式</th>
            </tr></thead>
            <tbody>
              ${diffNameDups.map((d, ri) => `<tr style="background:${ri%2===0?'#fffdf0':'#fffbeb'};">
                <td style="padding:5px 8px;font-weight:600;">${escHtml(d.imp.id)}</td>
                <td style="padding:5px 8px;color:#c05621;">${escHtml(d.ex?.name||'—')}</td>
                <td style="padding:5px 8px;color:#276749;">${escHtml(d.imp.name||'—')}</td>
                <td style="padding:5px 8px;">
                  <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;">
                    <input type="radio" name="dc-${escHtml(d.imp.id)}" value="use-imported" checked onchange="window._impDiffChg('${escHtml(d.imp.id)}','use-imported')">
                    <span>以匯入取代</span>
                  </label>
                  <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;margin-left:10px;">
                    <input type="radio" name="dc-${escHtml(d.imp.id)}" value="skip" onchange="window._impDiffChg('${escHtml(d.imp.id)}','skip')">
                    <span>略過（保留現有）</span>
                  </label>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
          <h3 style="margin:0;color:#1a5276;font-size:1.1rem;">確認匯入</h3>
        </div>
        <div style="padding:20px 24px;overflow:auto;flex:1;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:4px;">
            <div style="text-align:center;padding:12px 18px;background:#f0fff4;border-radius:8px;flex:1;min-width:100px;">
              <div style="font-size:1.9rem;font-weight:700;color:#276749;">${newCases.length}</div>
              <div style="font-size:.8rem;color:#4a5568;margin-top:2px;">新個案（將新增）</div>
            </div>
            ${sameNameDups.length ? `<div style="text-align:center;padding:12px 18px;background:#f0fff4;border-radius:8px;flex:1;min-width:100px;">
              <div style="font-size:1.9rem;font-weight:700;color:#276749;">${sameNameDups.length}</div>
              <div style="font-size:.8rem;color:#4a5568;margin-top:2px;">同名更新</div>
            </div>` : ''}
            ${diffNameDups.length ? `<div style="text-align:center;padding:12px 18px;background:#fffbeb;border-radius:8px;flex:1;min-width:100px;">
              <div style="font-size:1.9rem;font-weight:700;color:#c05621;">${diffNameDups.length}</div>
              <div style="font-size:.8rem;color:#4a5568;margin-top:2px;">姓名不符（待確認）</div>
            </div>` : ''}
            <div style="text-align:center;padding:12px 18px;background:#ebf5fb;border-radius:8px;flex:1;min-width:100px;">
              <div style="font-size:1.9rem;font-weight:700;color:#1a5276;">${imported.length}</div>
              <div style="font-size:.8rem;color:#4a5568;margin-top:2px;">共解析筆數</div>
            </div>
          </div>
          ${sameNameHtml}${diffNameHtml}
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;flex-shrink:0;">
          <button class="btn btn-secondary" type="button" id="imp-merge-cancel">取消</button>
          <button class="btn btn-primary" type="button" id="imp-merge-confirm">確認匯入</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    window._impDiffChg = (id, action) => { diffChoices.set(id, action); };
    window._impSetAllDiff = (action) => {
      diffNameDups.forEach(d => {
        diffChoices.set(d.imp.id, action);
        const radios = modal.querySelectorAll(`[name="dc-${CSS.escape(d.imp.id)}"]`);
        radios.forEach(r => { r.checked = (r.value === action); });
      });
    };

    modal.querySelector('#imp-merge-cancel').onclick = () => {
      modal.remove();
      prog.innerHTML = '<span style="color:#a0aec0;">已取消匯入。</span>';
      resolve(null);
    };
    modal.querySelector('#imp-merge-confirm').onclick = () => {
      const finalDiffDups = diffNameDups.map(d => ({ ...d, action: diffChoices.get(d.imp.id) || 'use-imported' }));
      modal.remove();
      resolve({ newCases, sameNameDups, diffNameDups: finalDiffDups });
    };
  });
}

// 合併並寫入 Drive（支援略過 / 更新重複案號兩種模式）
async function finalizeImport(imported, prog) {
  const choice = await showImportMergePreview(imported, prog);
  if (!choice) return;
  const { newCases, sameNameDups, diffNameDups } = choice;

  // Fields to back-fill from existing when new import has blank value
  const FILL_FIELDS = ['phone','address','emergencyName','emergencyPhone','emergencyRelation',
                       'idNumber','birthday','residence','classNo','disability','ethnicityNote'];

  const sameNameIds = new Set(sameNameDups.map(d => d.imp.id));
  const diffImpIds  = new Set(diffNameDups.filter(d => d.action === 'use-imported').map(d => d.imp.id));
  const importedMap = new Map(imported.map(c => [c.id, c]));

  const toWrite = casesData.map(c => {
    const imp = importedMap.get(c.id);
    if (!imp) return c;
    if (sameNameIds.has(c.id)) {
      // Smart-merge: cross-sem case → keep existing basic fields; same-sem → new data wins
      const isCrossSem = !!imp._crossSemMerge;
      const merged = isCrossSem ? { ...c } : { ...imp };
      if (!isCrossSem) FILL_FIELDS.forEach(f => { if (!merged[f] && c[f]) merged[f] = c[f]; });
      merged.records          = c.records || [];
      merged.initialInterview = c.initialInterview;
      merged.psychTestResults = (imp.psychTestResults?.length ? imp.psychTestResults : c.psychTestResults) || [];
      merged.createdAt        = c.createdAt || imp.createdAt;
      // Preserve earliest openDate
      if (c.openDate && (!merged.openDate || c.openDate < merged.openDate)) merged.openDate = c.openDate;
      // Accumulate semesters: preserve all semesters this case has been active in
      const _exSems = Array.isArray(c.semesters) ? [...c.semesters] : [openDateToSemPrefix(c.openDate)].filter(Boolean);
      const _impSem = openDateToSemPrefix(imp.openDate);
      if (_impSem && !_exSems.includes(_impSem)) _exSems.push(_impSem);
      merged.semesters = [...new Set(_exSems)].sort();
      // Build per-semester basic info snapshots
      const _existSnaps = { ...(c.basicInfoSnapshots || {}) };
      const _cSem = openDateToSemPrefix(c.openDate);
      if (_cSem && !_existSnaps[_cSem]) {
        const _cSnap = {};
        BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (c[f] !== undefined) _cSnap[f] = c[f]; });
        _existSnaps[_cSem] = _cSnap;
      }
      if (_impSem) {
        const _impSnap = {};
        BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (imp[f] !== undefined) _impSnap[f] = imp[f]; });
        _existSnaps[_impSem] = _impSnap;
      }
      merged.basicInfoSnapshots = _existSnaps;
      delete merged._crossSemMerge;
      return merged;
    }
    if (diffImpIds.has(c.id)) {
      // User chose "以匯入取代": overwrite basic fields, keep records
      const _exSems2 = Array.isArray(c.semesters) ? [...c.semesters] : [openDateToSemPrefix(c.openDate)].filter(Boolean);
      const _impSem2 = openDateToSemPrefix(imp.openDate);
      if (_impSem2 && !_exSems2.includes(_impSem2)) _exSems2.push(_impSem2);
      const _existSnaps2 = { ...(c.basicInfoSnapshots || {}) };
      const _cSem2 = openDateToSemPrefix(c.openDate);
      if (_cSem2 && !_existSnaps2[_cSem2]) {
        const _cSnap2 = {};
        BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (c[f] !== undefined) _cSnap2[f] = c[f]; });
        _existSnaps2[_cSem2] = _cSnap2;
      }
      if (_impSem2) {
        const _impSnap2 = {};
        BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (imp[f] !== undefined) _impSnap2[f] = imp[f]; });
        _existSnaps2[_impSem2] = _impSnap2;
      }
      // Preserve earliest openDate so batch-delete groups by original open semester
      const _openDate2 = (c.openDate && (!imp.openDate || c.openDate < imp.openDate)) ? c.openDate : imp.openDate;
      return { ...imp, records: c.records || [], initialInterview: c.initialInterview,
               psychTestResults: (imp.psychTestResults?.length ? imp.psychTestResults : c.psychTestResults) || [],
               createdAt: c.createdAt || imp.createdAt,
               openDate: _openDate2,
               semesters: [...new Set(_exSems2)].sort(),
               basicInfoSnapshots: _existSnaps2 };
    }
    return c; // skip (user chose to keep existing)
  });

  const finalCases = [...toWrite, ...newCases];
  // Ensure every case has semesters populated (new cases from Excel may lack it)
  finalCases.forEach(c => {
    if (!Array.isArray(c.semesters) || !c.semesters.length) {
      const sem = openDateToSemPrefix(c.openDate);
      if (sem) c.semesters = [sem];
    }
  });
  const updatedCount = sameNameDups.length + diffNameDups.filter(d => d.action === 'use-imported').length;
  const skippedCount = diffNameDups.filter(d => d.action === 'skip').length;

  // 2026-07-24 補漏：新案先分配 active chunk 歸屬（已重新分塊時），否則 getCaseChunkName 落回
  // legacy 推導，會把早已除名的舊式 chunk 檔重新掛回 manifest（與 _applyBatchImport L530 同一防護）
  newCases.forEach(c => _assignChunkForNewCase(c.id));
  const changedIds = [
    ...newCases.map(c => c.id),
    ...sameNameDups.map(d => d.imp.id),
    ...diffNameDups.filter(d => d.action === 'use-imported').map(d => d.imp.id),
  ].filter(Boolean);
  const totalChunks = [...new Set(changedIds.map(getCaseChunkName))].length || 1;

  prog.innerHTML = `
    <div style="font-size:.88rem;color:#718096;margin-bottom:8px;">
      寫入 Drive 中（${finalCases.length} 筆，共 ${totalChunks} 個資料區塊）…
    </div>
    <div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%;overflow:hidden;">
      <div id="_imp_prog_fill" style="background:#2b6cb0;height:100%;width:0%;transition:width .3s ease;"></div>
    </div>
    <div id="_imp_prog_pct" style="font-size:.78rem;color:#718096;margin-top:4px;">0 / ${totalChunks} 區塊</div>`;

  const _updateImpProg = (done, total) => {
    const pct = Math.round(done / total * 100);
    const fill = document.getElementById('_imp_prog_fill');
    const lbl  = document.getElementById('_imp_prog_pct');
    if (fill) fill.style.width = pct + '%';
    if (lbl)  lbl.textContent  = `${done} / ${total} 區塊（${pct}%）`;
  };

  _syslog('info', `開始匯入：新增 ${newCases.length}、更新 ${updatedCount}、略過 ${skippedCount}，共 ${totalChunks} chunks`);
  const _jobId = bgJobAdd(`匯入個案（${newCases.length} 新增${updatedCount ? `、${updatedCount} 更新` : ''}）`);
  try {
    casesData = finalCases;
    // 把「重新匯入的 ID」從墓碑清單移除
    if (changedIds.length > 0 && Array.isArray(casesManifest.deletedIds) && casesManifest.deletedIds.length > 0) {
      const _cSet = new Set(changedIds);
      const _before = casesManifest.deletedIds.length;
      casesManifest.deletedIds = casesManifest.deletedIds.filter(id => !_cSet.has(id));
      if (casesManifest.deletedIds.length < _before) await driveSaveJsonInCases('manifest.json', casesManifest);
    }
    // 差量寫入：只更新有變動的 chunk，不重寫全部
    if (changedIds.length > 0) {
      await saveCasesChunks(...changedIds, (done, total) => {
        _syslog('debug', `chunk 寫入：${done}/${total}`);
        _updateImpProg(done, total);
      });
    } else {
      _updateImpProg(1, 1);
    }
    let msg = `✓ 成功匯入 ${newCases.length} 筆新個案`;
    if (updatedCount) msg += `，更新 ${updatedCount} 筆重複`;
    if (skippedCount) msg += `，略過 ${skippedCount} 筆`;
    _syslog('success', `匯入完成：${msg}`);
    prog.innerHTML = `<span style="color:#276749;font-weight:600;">${msg}！</span>`;
    renderCases();
    auditLog('批次匯入個案', `新增 ${newCases.length}、更新 ${updatedCount}、略過 ${skippedCount} 筆重複`);
    bgJobDone(_jobId);
    _syslogFlushToDrive().catch(() => {});
  } catch (e) {
    _syslog('error', `匯入失敗：${e.message}`);
    prog.innerHTML = `<span style="color:#c53030;">✗ 寫入失敗：${escHtml(e.message)}</span>`;
    bgJobFail(_jobId, e.message);
  }
}
