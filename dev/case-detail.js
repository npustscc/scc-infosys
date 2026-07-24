// dev/case-detail.js — 個案詳細頁區塊＋合併/遷移引擎＋個案管理（拆 index.html 絞殺者第五刀，v251）。
// 內容為從 index.html 逐字搬出的函式：個案詳細頁渲染主體（showCaseDetail 等，含 DOM 操作）、
// 學期切換／輔導老師異動、心測報告渲染、個案合併與學號/曾用號遷移引擎（_buildMergePlan／
// _mergeCaseGroup／_migIdentityConflicts／_caseInternalIdMismatch／_sameNameDiffIdSets 等純函式，
// 供 test/merge-engine*.test.js 透過 harness.load() 抽取單元測試）、個案管理員增刪。
// 頂層無任何執行副作用（只有 function 宣告與少量 const 純資料，如 PSYCH_TEST_DIMS）。函式內部
// 在呼叫時會引用主檔全域可變狀態（casesData／configData／currentUser／currentRole／extraRole／
// _detailScrollObserver／_detailReadOnly／_viewedSectionsThisDetail 等，定義仍留在 index.html），
// 屬 call-time 解析，與其他拆檔模組（utils.js／ft-core.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="case-detail.js"></script> 載入（放在 ft-core.js
// 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// 進入詳細頁即記「查閱基本資料」；並以 IntersectionObserver 記錄捲動時看到的各敏感區塊（不必展開）。
function _setupDetailViewAudit(caseId) {
  if (_detailScrollObserver) { try { _detailScrollObserver.disconnect(); } catch (_) {} _detailScrollObserver = null; }
  const c = (casesData || []).find(x => x.id === caseId);
  if (!c || !_shouldAuditDetailViewing(c)) return;
  _auditCaseSectionView('進入詳細頁·查閱基本資料');
  if (typeof IntersectionObserver === 'undefined') return;
  _detailScrollObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const titleEl = en.target.querySelector('.form-section-title') || en.target.querySelector('.rec-section-label');
      const label = titleEl ? titleEl.textContent.replace(/[▲▼]/g, '').trim() : '';
      if (label && _AUDIT_SENSITIVE_SECTIONS.some(k => label.includes(k))) _auditCaseSectionView('捲動查閱·' + label);
    });
  }, { threshold: 0.35 });
  // 詳細頁 DOM 已由 showPage 顯示；稍候觀察各區塊（mkSection 產生的 .form-section）
  setTimeout(() => {
    if (!_detailScrollObserver) return;
    document.querySelectorAll('#page-case-detail .form-section').forEach(el => { try { _detailScrollObserver.observe(el); } catch (_) {} });
  }, 300);
}

function toggleSection(id) {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  const el = document.getElementById(id);
  if (!el) return;
  const nowCollapsed = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', nowCollapsed);
  // #10：展開（非收合）敏感區塊 → 記錄查閱
  if (!nowCollapsed && _detailCaseId && id.startsWith('cs-')) {
    const titleEl = el.querySelector('.form-section-title');
    const label = titleEl ? titleEl.textContent.replace(/[▲▼]/g, '').trim() : '';
    if (label && _AUDIT_SENSITIVE_SECTIONS.some(k => label.includes(k))) _auditCaseSectionView('展開' + label);
  }
  // Persist state per user per case for case-detail sections
  if (_detailCaseId && id.startsWith('cs-')) {
    const key = `scc_sec_${currentUser?.email||''}_${_detailCaseId}`;
    try {
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      state[id] = nowCollapsed;
      localStorage.setItem(key, JSON.stringify(state));
    } catch (_) {}
  }
}

function mkSection(id, title, bodyHtml, open = true, style = '') {
  return `
    <div class="form-section section-collapsible${open ? '' : ' collapsed'}" id="cs-${id}"${style ? ` style="${style}"` : ''}>
      <div class="form-section-title" onclick="toggleSection('cs-${id}')">
        ${escHtml(title)}
        <span class="toggle-icon">▲</span>
      </div>
      <div class="section-body">${bodyHtml}</div>
    </div>`;
}

function _getRelatedCases(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return [c].filter(Boolean);
  const sid = (c.studentId || '').trim();
  const idn = (c.idNumber  || '').trim();
  if (!sid && !idn) return [c];
  return casesData
    .filter(x => !x.deleted && (
      (sid && (x.studentId || '').trim() === sid) ||
      (idn && (x.idNumber  || '').trim() === idn)
    ))
    .sort((a, b) => (a.openDate || '') < (b.openDate || '') ? -1 : 1);
}

function toggleDetailSemFilter(caseId) {
  const sy = window.scrollY;
  _detailSemFilter = _detailSemFilter === 'all' ? 'current' : 'all';
  _recPage = 1;
  showCaseDetail(caseId);
  requestAnimationFrame(() => window.scrollTo(0, sy));
}
function _setDetailSemFilter(val, caseId) {
  const sy = window.scrollY;
  _detailSemFilter = val;
  _recPage = 1;
  showCaseDetail(caseId);
  requestAnimationFrame(() => window.scrollTo(0, sy));
}
function _switchCaseSem(sem, caseId) {
  const sy = window.scrollY;
  // B5 修正：同案號內點學期 chip 切換檢視也要稽核（v152 只涵蓋跨案號的「歷年學期」nav）；點當前學期不記
  if (sem !== _caseDetailActiveSem) {
    try { auditLog('查閱個案—切換學期檢視', caseId, null, `切換至 ${semesterLabel(sem)}（案號 ${caseId}）`); } catch (_) {}
  }
  _caseDetailMode = 'semester';
  _caseDetailActiveSem = sem;
  _detailSemFilter = 'current';
  showCaseDetail(caseId);
  requestAnimationFrame(() => window.scrollTo(0, sy));
}
function showCaseDetailAtSem(caseId, sem) {
  _recPage = 1;
  _detailCaseId = caseId;
  _caseDetailActiveSem = sem;
  _caseDetailMode = 'semester';
  _caseDetailPsychIdx = 0;
  _detailSemFilter = 'current';
  showCaseDetail(caseId);
}

// ── 大專院校學生心理健康關懷量表向度對照
const PSYCH_TEST_DIMS = {
  AL:'整體量表結果', D1:'外部情境向度', D2:'內在個人向度',
  F1:'關係保護/危險因子', F2:'生活調控警訊因子',
  F3:'情緒保護/危險因子', F4:'憂鬱自殺警訊因子',
  S01:'同儕與人際互動', S02:'家庭功能影響', S03:'知心好友與親密關係',
  S04:'課業與作息變化', S05:'網路經驗與霸凌', S06:'性別認同壓力',
  S07:'情境誘發情緒', S08:'生氣與衝動控制', S09:'憤怒表達與攻擊',
  S10:'負向認知', S11:'憂鬱相關症狀', S12:'自殺意圖',
};
const PSYCH_TEST_TREE = [
  {k:'AL',  l:'整體量表結果',       i:0},
  {k:'D1',  l:'外部情境向度',       i:1},
  {k:'F1',  l:'關係保護/危險因子',  i:2},
  {k:'S01', l:'同儕與人際互動',     i:3},
  {k:'S02', l:'家庭功能影響',       i:3},
  {k:'S03', l:'知心好友與親密關係', i:3},
  {k:'F2',  l:'生活調控警訊因子',   i:2},
  {k:'S04', l:'課業與作息變化',     i:3},
  {k:'S05', l:'網路經驗與霸凌',     i:3},
  {k:'S06', l:'性別認同壓力',       i:3},
  {k:'D2',  l:'內在個人向度',       i:1},
  {k:'F3',  l:'情緒保護/危險因子',  i:2},
  {k:'S07', l:'情境誘發情緒',       i:3},
  {k:'S08', l:'生氣與衝動控制',     i:3},
  {k:'S09', l:'憤怒表達與攻擊',     i:3},
  {k:'F4',  l:'憂鬱自殺警訊因子',   i:2},
  {k:'S10', l:'負向認知',           i:3},
  {k:'S11', l:'憂鬱相關症狀',       i:3},
  {k:'S12', l:'自殺意圖',           i:3},
];

function _psychTestLight(pr) {
  const v = parseFloat(pr);
  if (pr === null || pr === undefined || pr === '' || isNaN(v)) return {sym:'—', color:'#a0aec0', bg:'#f7fafc'};
  if (v >= 90) return {sym:'●', label:'紅燈', color:'#c53030', bg:'#fff5f5'};
  if (v >= 80) return {sym:'◎', label:'橙燈', color:'#c05621', bg:'#fffaf0'};
  return {sym:'○', label:'黃燈', color:'#276749', bg:'#f0fff4'};
}

function _renderPsychTestReport(c, idx) {
  const t = (c.psychTestResults || [])[idx];
  if (!t) return '<div class="empty-state" style="padding:30px;"><div class="icon">📊</div><p>找不到測驗結果</p></div>';
  const hasFullData = t.D1 !== undefined || t.D2 !== undefined;
  const tree = hasFullData ? PSYCH_TEST_TREE : [
    {k:'AL', l:'整體量表結果', i:0},
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map(n => {
      const k = 'S' + String(n).padStart(2,'0');
      return {k, l: PSYCH_TEST_DIMS[k] || k, i:1};
    }),
  ];
  const rows = tree.map(d => {
    const v = t[d.k];
    if (v === undefined) return '';
    const lt = _psychTestLight(v);
    return `<tr>
      <td style="padding:5px 8px 5px ${d.i*14+8}px;color:${d.i===0?'#1a5276':d.i===1?'#2d3748':'#4a5568'};font-size:.875rem;font-weight:${d.i<=1?600:400};">${escHtml(d.l)}</td>
      <td style="padding:5px 8px;text-align:center;"><span style="background:${lt.bg};color:${lt.color};border-radius:6px;padding:2px 8px;font-size:.9rem;font-weight:700;">${lt.sym}</span></td>
      <td style="padding:5px 8px;text-align:center;color:#4a5568;font-size:.875rem;">${v !== null && v !== undefined ? v : '—'}</td>
    </tr>`;
  }).join('');
  const meta = [
    t.testSemester ? `<span><strong>受測學期：</strong>${escHtml(semesterLabel(t.testSemester))}</span>` : '',
    t.className    ? `<span><strong>班級：</strong>${escHtml(t.className)}</span>` : '',
    t.validity     ? `<span><strong>問卷可信度：</strong>${escHtml(t.validity)}</span>` : '',
    t.importedAt   ? `<span><strong>匯入：</strong>${escHtml(t.importedAt.slice(0,10))}</span>` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const caseId = c.id;
  const failsafeHtml = `<div style="margin-top:14px;padding:10px 12px;background:#fff8f0;border:1px solid #fbd38d;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="font-size:.82rem;color:#744210;flex:1;">若測驗結果有誤，可重新上傳或刪除。</span>
    <label style="cursor:pointer;padding:4px 12px;background:#ed8936;color:#fff;border-radius:6px;font-size:.83rem;font-weight:600;white-space:nowrap;">
      重新上傳/覆蓋
      <input type="file" accept=".csv,.xlsx,.xlsm,.xls" style="display:none;" onchange="reuploadPsychTestResult('${escHtml(caseId)}',${idx},this)">
    </label>
    <button onclick="deletePsychTestResult('${escHtml(caseId)}',${idx})" style="padding:4px 12px;background:#fff;color:#c53030;border:1.5px solid #fc8181;border-radius:6px;font-size:.83rem;font-weight:600;cursor:pointer;white-space:nowrap;">刪除此測驗結果</button>
  </div>`;
  return mkSection('psych-report', '大專院校學生心理健康關懷量表結果報告',
    `<div style="font-size:.85rem;color:#718096;margin-bottom:12px;">${meta}</div>` +
    (t['是否為高關懷'] ? `<div style="background:#fff5f5;border:1px solid #feb2b2;border-radius:6px;padding:6px 12px;margin-bottom:10px;font-size:.875rem;color:#c53030;font-weight:600;">⚠ 高關懷個案</div>` : '') +
    (t['同意導師知情'] ? `<div style="background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;padding:6px 12px;margin-bottom:10px;font-size:.875rem;color:#2b6cb0;">✓ 同意導師知情</div>` : '') +
    `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f7fafc;">
        <th style="padding:6px 8px;text-align:left;font-size:.8rem;color:#718096;font-weight:600;">向度名稱</th>
        <th style="padding:6px 8px;text-align:center;font-size:.8rem;color:#718096;font-weight:600;">燈號</th>
        <th style="padding:6px 8px;text-align:center;font-size:.8rem;color:#718096;font-weight:600;">PR 值</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;font-size:.8rem;color:#718096;">○ PR ≤ 79：適應良好 &nbsp;◎ PR 80–89：適應有些困難 &nbsp;● PR ≥ 90：需要關注</div>` +
    failsafeHtml
  );
}

// 個案的最新學期（semesters 排序最後；無 semesters 用 openDate 推）
function _caseLatestSem(c) {
  const sems = (Array.isArray(c.semesters) && c.semesters.length
    ? [...c.semesters] : [openDateToSemPrefix(c.openDate)].filter(Boolean)).sort();
  return sems[sems.length - 1] || '';
}
// ── 一學生一案號：sem key 可能帶 '#N' 後綴（同學期重複開案序號，如 '1142#2'）─────
// base：去除 '#N' 後綴的原始學期前綴；無 '#' 原樣回傳
function _semKeyBase(key) {
  if (!key) return '';
  const i = key.indexOf('#');
  return i === -1 ? key : key.slice(0, i);
}
// 個案的學期 key 陣列（含可能的 #N 後綴）；無 semesters[] 時退回以 openDate 推算單一學期
function _caseSems(c) {
  return (Array.isArray(c.semesters) && c.semesters.length)
    ? [...c.semesters]
    : [openDateToSemPrefix(c.openDate)].filter(Boolean);
}
// 個案是否已開過某學期（以 base 比對，含 #N 重複開案的學期）
function _caseHasSem(c, sem) {
  return _caseSems(c).some(k => _semKeyBase(k) === sem);
}
// 個案架構重構 Slice 4：統計雙指標——服務學生數 vs 開案人次。
// 一學生一案號後，casesData 筆數＝不重複學生數；但同一學生可能跨多學期開案（甚至同學期 #N 重複開案），
// 與歷史報表（每學期開案各算一件）比較時需要「開案人次」而非「學生數」。
// semFilter 為 falsy（未篩選學期）：students=全部符合篩選條件的個案（學生）數；openings=所有學期開案人次總和（含 #N）。
// semFilter 為某學期 base key：students=該學期有開案的學生數；openings=該學期開案人次（含同學期 #N 重複開案）。
function _statCaseCounts(cases, semFilter) {
  let students = 0, openings = 0;
  (cases || []).forEach(c => {
    const sems = _caseSems(c);
    if (semFilter) {
      const matched = sems.filter(k => _semKeyBase(k) === semFilter).length;
      if (matched > 0) { students++; openings += matched; }
    } else {
      students++;
      openings += sems.length;
    }
  });
  return { students, openings };
}
// #8：個案相對「本學期」的開案狀態徽章（本學期開案中／有開案但已結案／有開案但已封存／未開案）。
// 共用於個案列表（完整搜尋時）、危機個案閱讀、案號查詢管理三處。
function _semStatusBadgeHtml(c) {
  if (!c) return '';
  const cur = currentSemesterPrefix();
  const opened = _caseHasSem(c, cur);
  const semClosed = opened && ((c.semesterStatus && c.semesterStatus[cur] === 'closed') || c.status === 'closed');
  let label, bg, color, border;
  if (!opened)          { label = '本學期未開案';        bg = '#feebc8'; color = '#9c4221'; border = '#f6ad55'; }
  else if (c.archived)  { label = '本學期有開案但已封存'; bg = '#e2e8f0'; color = '#4a5568'; border = '#cbd5e0'; }
  else if (semClosed)   { label = '本學期有開案但已結案'; bg = '#e0e7ef'; color = '#3f4f66'; border = '#b8c4d6'; }
  else                  { label = '本學期開案中';        bg = '#d5f5e3'; color = '#1d6a3a'; border = '#9ae6b4'; }
  return `<span style="display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:700;white-space:nowrap;" data-tip="此個案的本學期開案狀態">${label}</span>`;
}
// 同一 base 學期若有 2 筆以上開案（#N），依序號給不同醒目底色；單筆開案回傳 null（維持原樣式不受影響）
function _semDupStyle(caseSems, sem) {
  const base = _semKeyBase(sem);
  const siblings = (caseSems || []).filter(k => _semKeyBase(k) === base);
  if (siblings.length < 2) return null;
  const hashIdx = sem.indexOf('#');
  const n = hashIdx === -1 ? 1 : (parseInt(sem.slice(hashIdx + 1), 10) || 1);
  const palette = [
    { bg:'#e0f2fe', border:'#38bdf8', color:'#075985' }, // #1
    { bg:'#fce7f3', border:'#f472b6', color:'#9d174d' }, // #2
    { bg:'#ecfccb', border:'#a3e635', color:'#3f6212' }, // #3
    { bg:'#ede9fe', border:'#a78bfa', color:'#5b21b6' }, // #4 以後循環
  ];
  return palette[(n - 1) % palette.length];
}
// 取得某學期下一個可用的開案 key：該學期未開過→回傳原樣；已開過 N 次→回傳 'sem#(N+1)'
function _nextSemOpenKey(c, sem) {
  const sems = _caseSems(c);
  if (!sems.some(k => _semKeyBase(k) === sem)) return sem;
  let maxSeq = 1; // base key 本身視為序號 1
  sems.forEach(k => {
    if (_semKeyBase(k) !== sem) return;
    const hashIdx = k.indexOf('#');
    if (hashIdx === -1) return;
    const n = parseInt(k.slice(hashIdx + 1), 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  return `${sem}#${maxSeq + 1}`;
}

// ── 同學期再次開案的 sem key 對稱重編（#35）────────────────────────────────
// 設計：同一 base 學期下，只要存在 2 筆以上（分身），「全部」都帶明確序號
// ('sem#1'、'sem#2'…)；只剩 1 筆時一律恢復無後綴。這樣「產生分身時原本那筆同步變 _1」、
// 「刪到剩 1 筆時自動恢復無後綴」、「刪中間那筆時後面依序遞補」三種情境都用同一套規則處理，
// 不需要分開寫三段邏輯。後綴只影響這個 sem key 字串本身；引用處一律以「重編後的新 key」為準
// （見 _applySemKeyRenumber），caseId／formerIds／預約的 caseId 不受影響（案號本身不含後綴）。
//
// existingKeys：某 base 學期目前『仍存在』的 sem key 陣列（可能含 #N 後綴，也可能是重編前的舊值）。
// 回傳：{ 舊key: 新key } 對照表，僅包含實際有變動的項目（未變動者不出現在表中）。
function _renumberSemKeys(base, existingKeys) {
  const seqOf = k => {
    const i = k.indexOf('#');
    return i === -1 ? 1 : (parseInt(k.slice(i + 1), 10) || 1);
  };
  const sorted = [...(existingKeys || [])].sort((a, b) => seqOf(a) - seqOf(b));
  const map = {};
  sorted.forEach((oldKey, i) => {
    const newKey = sorted.length === 1 ? base : `${base}#${i + 1}`;
    if (newKey !== oldKey) map[oldKey] = newKey;
  });
  return map;
}

// 將 _renumberSemKeys 產生的對照表套用到個案物件的所有引用處：
// semesters 陣列本身、以 sem key 為屬性名稱的物件（basicInfoSnapshots／semesterStatus／
// initialInterviews），以及 semesterEvaluations[].semester 欄位。
// 縮小範圍說明：transferEvaluations[].semester、records 的學期一律由日期動態推算（不存 sem key），
// 兩者皆不受後綴影響，故不在此處理；預約（bookingsData）只引用 caseId（不含後綴），同樣不受影響。
function _applySemKeyRenumber(c, keyMap) {
  if (!c || !keyMap || !Object.keys(keyMap).length) return;
  if (Array.isArray(c.semesters)) {
    c.semesters = c.semesters.map(k => keyMap[k] || k);
  }
  ['basicInfoSnapshots', 'semesterStatus', 'initialInterviews'].forEach(field => {
    if (c[field] && typeof c[field] === 'object') {
      const next = {};
      Object.keys(c[field]).forEach(k => { next[keyMap[k] || k] = c[field][k]; });
      c[field] = next;
    }
  });
  if (Array.isArray(c.semesterEvaluations)) {
    c.semesterEvaluations.forEach(e => { if (e && keyMap[e.semester]) e.semester = keyMap[e.semester]; });
  }
}

// ══════════════════════════════════════════════
// ── 個案架構重構 Slice 2：一學生一案號遷移引擎（純函式，供單元測試） ──
// ══════════════════════════════════════════════
// ── v156：dry-run 驗證強化（識別欄位比對／案內混人偵測／同名同姓提示）純函式 ──
// 身分證字號遮罩顯示：僅前1碼＋後3碼，中間以＊填滿；長度≤4（前後已涵蓋全部）原樣顯示，不遮罩。
function _maskIdNumber(idNumber) {
  const s = (idNumber || '').trim();
  if (!s) return '';
  if (s.length <= 4) return s;
  return s[0] + '＊'.repeat(s.length - 4) + s.slice(-3);
}

// 合併組內識別衝突偵測：members 為該組所有案號的 {id, studentId, idNumber}。
// 同一欄位出現 2 個以上「非空且不同」的值即為衝突；任一成員該欄位為空只標記 incomplete、不算衝突
// （空值不能拿來比對，但要提醒使用者識別資料不全，人工再確認）。
function _migIdentityConflicts(members) {
  const list = Array.isArray(members) ? members : [];
  const fields = ['studentId', 'idNumber'];
  const conflicts = [];
  let incomplete = false;
  fields.forEach(field => {
    const entries = list.map(m => ({ id: m.id, value: (m[field] || '').trim() }));
    if (entries.some(e => !e.value)) incomplete = true;
    const nonEmpty = entries.filter(e => e.value);
    const distinct = [...new Set(nonEmpty.map(e => e.value))];
    if (distinct.length > 1) conflicts.push({ field, entries: nonEmpty });
  });
  return { hasConflict: conflicts.length > 0, incomplete, conflicts };
}

// 單一案號內部混人偵測（陳彥廷情境）：root 欄位（c.studentId／c.idNumber）＋各學期
// basicInfoSnapshots 的 studentId／idNumber，若出現 2 個以上非空且不同的值，
// 視為同一案號內混入不同人的資料，需人工處理，不可用一般合併流程解決。
function _caseInternalIdMismatch(c) {
  const entries = [];
  if (c) {
    entries.push({ source: 'root', studentId: (c.studentId || '').trim(), idNumber: (c.idNumber || '').trim() });
    const snaps = c.basicInfoSnapshots || {};
    Object.keys(snaps).forEach(semKey => {
      const s = snaps[semKey] || {};
      entries.push({ source: semKey, studentId: (s.studentId || '').trim(), idNumber: (s.idNumber || '').trim() });
    });
  }
  const distinctOf = field => [...new Set(entries.map(e => e[field]).filter(Boolean))];
  const studentIdVariants = distinctOf('studentId');
  const idNumberVariants = distinctOf('idNumber');
  return {
    mismatch: studentIdVariants.length > 1 || idNumberVariants.length > 1,
    entries,
    studentIdVariants,
    idNumberVariants,
  };
}

// 同名同姓但識別欄位不同（＝不同人，未合併）彙總：依姓名分群後，用與 _buildMergePlan 相同的
// 「studentId 或 idNumber 相符即同一人」規則做 union-find 分堆；同姓名下若分出 2 堆以上即列入
// （純資訊，供人工確認系統沒有漏合併／錯合併，不影響任何勾選）。
function _sameNameDiffIdSets(cases) {
  const list = (Array.isArray(cases) ? cases : []).filter(c => c && c.id && !c.deleted && (c.name || '').trim());
  const byName = new Map();
  list.forEach(c => {
    const name = c.name.trim();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(c);
  });
  const result = [];
  byName.forEach((members, name) => {
    if (members.length < 2) return;
    const parent = new Map(members.map(m => [m.id, m.id]));
    const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        const sidA = (a.studentId || '').trim(), sidB = (b.studentId || '').trim();
        const idnA = (a.idNumber || '').trim(), idnB = (b.idNumber || '').trim();
        if ((sidA && sidA === sidB) || (idnA && idnA === idnB)) union(a.id, b.id);
      }
    }
    const clusters = new Map();
    members.forEach(m => {
      const root = find(m.id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push({ id: m.id, studentId: (m.studentId || '').trim(), idNumber: (m.idNumber || '').trim() });
    });
    if (clusters.size > 1) result.push({ name, clusters: [...clusters.values()] });
  });
  return result;
}

// 掃描 cases（通常是 casesData），依 studentId／idNumber（trim 後非空）分組同一學生的多筆 record，
// 找出「暫定主案號」（openDate 最早；同日取案號數字最小者）。回傳 dry-run 計畫，不修改任何資料。
// v156：另全量掃描每筆 record 的案內識別不一致（internalMismatches）與同名同姓不同人彙總
// （sameNameDiffIdSets），並把識別衝突（identityConflict）併入各組，供報告醒目標示＋預設取消勾選。
function _buildMergePlan(cases) {
  const list = Array.isArray(cases) ? cases : [];
  const seen = new Set();
  const groups = [];
  const internalMismatches = list
    .filter(c => c && c.id && !c.deleted)
    .map(c => ({ id: c.id, name: (c.name || '').trim(), result: _caseInternalIdMismatch(c) }))
    .filter(x => x.result.mismatch)
    .map(x => ({
      id: x.id, name: x.name,
      studentIdVariants: x.result.studentIdVariants,
      idNumberVariants: x.result.idNumberVariants,
      entries: x.result.entries,
    }));
  const mismatchIds = new Set(internalMismatches.map(x => x.id));
  list.forEach(c => {
    if (!c || !c.id || c.deleted || seen.has(c.id)) return;
    const sid = (c.studentId || '').trim();
    const idn = (c.idNumber  || '').trim();
    if (!sid && !idn) return;
    const related = list.filter(x => x && x.id && !x.deleted && (
      (sid && (x.studentId || '').trim() === sid) ||
      (idn && (x.idNumber  || '').trim() === idn)
    ));
    related.forEach(x => seen.add(x.id));
    if (related.length < 2) return;
    // 暫定主案號：openDate 最早；同日取案號數字最小者
    const target = related.reduce((best, x) => {
      if (!best) return x;
      const bd = best.openDate || '', xd = x.openDate || '';
      if (xd < bd) return x;
      if (xd > bd) return best;
      const bn = parseInt((best.id || '').slice(4), 10);
      const xn = parseInt((x.id   || '').slice(4), 10);
      if (!isNaN(xn) && (isNaN(bn) || xn < bn)) return x;
      return best;
    }, null);
    const sourceIds = related.filter(x => x.id !== target.id).map(x => x.id);
    // 同學期衝突偵測：以 sem key 的 base 比對（不論是否已帶 #N）
    const semBaseOwners = new Map(); // base -> Set(caseId)
    related.forEach(x => {
      _caseSems(x).forEach(k => {
        const base = _semKeyBase(k);
        if (!semBaseOwners.has(base)) semBaseOwners.set(base, new Set());
        semBaseOwners.get(base).add(x.id);
      });
    });
    const semConflicts = [...semBaseOwners.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([semBase, ids]) => ({ semBase, ids: [...ids] }));
    const names = new Set(related.map(x => (x.name || '').trim()).filter(Boolean));
    const identity = _migIdentityConflicts(related.map(x => ({ id: x.id, studentId: x.studentId, idNumber: x.idNumber })));
    const hasInternalMismatchMember = related.some(x => mismatchIds.has(x.id));
    groups.push({
      targetId: target.id,
      sourceIds,
      semConflicts,
      nameMismatch: names.size > 1,
      names: [...names],
      members: related.map(x => ({ id: x.id, studentId: (x.studentId || '').trim(), idNumber: (x.idNumber || '').trim() })),
      identityConflict: identity.hasConflict || hasInternalMismatchMember,
      identityIncomplete: identity.incomplete,
      identityConflictDetails: identity.conflicts,
      identityInternalMismatchMember: hasInternalMismatchMember,
    });
  });
  return { groups, internalMismatches, sameNameDiffIdSets: _sameNameDiffIdSets(list) };
}

// 實際合併：把 sources 逐一折入 target（就地修改 target；不修改／不刪除 sources，呼叫端負責從 casesData 移除）。
// 回傳 { sourceRemaps: [{ id, semKeyMap }] } 供呼叫端 remap configData.users[*].allowedCases(Sems) 與 transferData。
// rootFallbackFields：選填，覆寫「target 缺時可從來源補值」的欄位清單（預設用 BASIC_INFO_SNAPSHOT_FIELDS 排除主責與開案日期）。
function _mergeCaseGroup(target, sources, rootFallbackFields) {
  if (!target || !target.id) throw new Error('_mergeCaseGroup: target 不可為空');
  const srcSorted = [...(sources || [])].sort((a, b) => (a.openDate || '') < (b.openDate || '') ? -1 : 1);
  const rootFields = rootFallbackFields || (typeof BASIC_INFO_SNAPSHOT_FIELDS !== 'undefined' ? BASIC_INFO_SNAPSHOT_FIELDS : [])
    .filter(f => !['counselorText', 'counselorName', 'counselorEmail', 'openDate'].includes(f));

  // 主號自己原生學期（供日後主號↔曾用號對調時往返一致）：合併前先定格，之後每次合併皆累加
  target.mainIdSems = [...new Set([...(target.mainIdSems || []), ..._caseSems(target)])];

  // sem key 分配：沿用 target 既有 key；來源 base 撞號者依序追加 #N（baseMaxSeq 記錄各 base 目前用到第幾號，1＝base 本身）
  const baseMaxSeq = new Map();
  _caseSems(target).forEach(k => {
    const base = _semKeyBase(k);
    const hashIdx = k.indexOf('#');
    const seq = hashIdx === -1 ? 1 : (parseInt(k.slice(hashIdx + 1), 10) || 1);
    baseMaxSeq.set(base, Math.max(baseMaxSeq.get(base) || 1, seq));
  });

  const sourceRemaps = [];
  if (!target.formerIds) target.formerIds = [];
  srcSorted.forEach(src => {
    const semKeyMap = {};
    _caseSems(src).slice().sort().forEach(k => {
      const base = _semKeyBase(k);
      if (!baseMaxSeq.has(base)) {
        semKeyMap[k] = base;
        baseMaxSeq.set(base, 1);
      } else {
        const nextSeq = baseMaxSeq.get(base) + 1;
        semKeyMap[k] = `${base}#${nextSeq}`;
        baseMaxSeq.set(base, nextSeq);
      }
    });
    const remappedSems = _caseSems(src).map(k => semKeyMap[k] || k);
    target.semesters = [...new Set([...(target.semesters || _caseSems(target)), ...remappedSems])].sort();

    // per-sem map：折入且 target 已有的 key 不覆蓋
    ['basicInfoSnapshots', 'semesterStatus', 'initialInterviews'].forEach(mapKey => {
      if (!src[mapKey]) return;
      if (!target[mapKey]) target[mapKey] = {};
      Object.entries(src[mapKey]).forEach(([oldKey, val]) => {
        const newKey = semKeyMap[oldKey] || oldKey;
        if (target[mapKey][newKey] === undefined) target[mapKey][newKey] = val;
      });
    });

    // semesterEvaluations：remap .semester 後串接
    if (Array.isArray(src.semesterEvaluations) && src.semesterEvaluations.length) {
      const remapped = src.semesterEvaluations.map(ev => ({ ...ev, semester: semKeyMap[ev.semester] || ev.semester }));
      target.semesterEvaluations = [...(target.semesterEvaluations || []), ...remapped];
    }

    // records / psychiatristRecords / events：以 .date 排序串接，不涉及 sem key
    ['records', 'psychiatristRecords', 'events'].forEach(arrKey => {
      if (Array.isArray(src[arrKey]) && src[arrKey].length) {
        target[arrKey] = [...(target[arrKey] || []), ...src[arrKey]];
      }
    });

    // psychTestResults：依 testSemester 去重，target 既有優先
    if (Array.isArray(src.psychTestResults) && src.psychTestResults.length) {
      const existSems = new Set((target.psychTestResults || []).map(t => t.testSemester));
      const toAdd = src.psychTestResults.filter(t => !existSems.has(t.testSemester));
      target.psychTestResults = [...(target.psychTestResults || []), ...toAdd];
    }

    // root 欄位補缺（target 缺、來源有）：不覆蓋 target 既有值
    rootFields.forEach(f => {
      const cur = target[f];
      const isEmpty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
      if (isEmpty && src[f] !== undefined && src[f] !== null && src[f] !== '') target[f] = src[f];
    });

    // formerIds：紀錄此來源曾用過的（remap 後）學期
    target.formerIds.push({ id: src.id, semesters: remappedSems });
    sourceRemaps.push({ id: src.id, semKeyMap });
  });

  ['records', 'psychiatristRecords', 'events'].forEach(k => {
    if (Array.isArray(target[k])) target[k].sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  });
  if (Array.isArray(target.semesterEvaluations)) {
    target.semesterEvaluations.sort((a, b) => (a.semester || '') < (b.semester || '') ? -1 : 1);
  }

  // archived：全部（含 target）都 archived 才保留 true
  target.archived = !!target.archived && srcSorted.every(s => !!s.archived);
  target.status = _recomputeCaseStatus(target);
  target.updatedAt = new Date().toISOString();

  return { sourceRemaps };
}

// 合併後主號改採「自訂全新案號」的純記帳邏輯（不碰 Drive／DOM）：
// 把 target 原 id 連同其原生學期 push 進 formerIds、mainIdSems 清空（自訂號從未被使用過）、id 換成 customId。
// 回傳原 id。需在 migrateToChunks() 全量重建之前呼叫（重建按當下 id 放 chunk，無需 _renameCaseId）。
function _migApplyCustomId(target, customId) {
  if (!target || !target.id) throw new Error('_migApplyCustomId: target 不可為空');
  if (!customId || customId === target.id) return target.id;
  const oldId = target.id;
  const oldSems = (Array.isArray(target.mainIdSems) && target.mainIdSems.length)
    ? [...target.mainIdSems] : _caseSems(target);
  if (!target.formerIds) target.formerIds = [];
  target.formerIds.push({ id: oldId, semesters: oldSems });
  target.mainIdSems = []; // 自訂號從未被任何學期使用過
  target.id = customId;
  return oldId;
}

// 主號↔曾用號互換的純記帳邏輯（不碰 Drive／DOM）：抽出以利單元測試往返一致性。
// 就地修改 c：交換 c.id 與被選定的曾用號，並互換 mainIdSems（供對調後再對調回去仍能還原原始狀態）。
function _swapFormerId(c, formerId) {
  const entry = (c.formerIds || []).find(f => f.id === formerId);
  if (!entry) throw new Error(`找不到曾用案號：${formerId}`);
  const oldMainId = c.id;
  const oldMainSems = c.mainIdSems ? [...c.mainIdSems] : _caseSems(c);
  c.formerIds = (c.formerIds || []).filter(f => f.id !== formerId).concat([{ id: oldMainId, semesters: oldMainSems }]);
  c.mainIdSems = entry.semesters;
  c.id = formerId;
  return { oldId: oldMainId, newId: formerId };
}

// 轉派前置：把「全案層級目前的主責」定格到所有尚無主責資訊的學期快照。
// 沒有這步，之後只改單一學期＋全案層級時，其他學期的顯示（fallback 到全案層級）會跟著變（#023 第二輪）
function _stampSemCounselorSnapshots(c) {
  if (!c?.basicInfoSnapshots) return;
  Object.values(c.basicInfoSnapshots).forEach(snap => {
    if (!snap) return;
    if (snap.counselorEmail || snap.counselorName || snap.counselorText) return; // 已有主責資訊，不動
    if (c.counselorEmail) {
      snap.counselorEmail = c.counselorEmail;
      snap.counselorName  = c.counselorName || '';
    } else if (c.counselorText || c.counselorName) {
      snap.counselorText = c.counselorText || '';
      snap.counselorName = c.counselorName || '';
    }
  });
}
// 轉派共用寫入：只寫目標學期快照；「目標學期＝最新學期」才同步更新全案層級主責
function _applyCounselorChange(c, targetSem, newEmail, newName) {
  _stampSemCounselorSnapshots(c);
  const sem = targetSem || _caseLatestSem(c);
  if (sem) {
    if (!c.basicInfoSnapshots) c.basicInfoSnapshots = {};
    if (!c.basicInfoSnapshots[sem]) c.basicInfoSnapshots[sem] = {};
    c.basicInfoSnapshots[sem].counselorEmail = newEmail;
    c.basicInfoSnapshots[sem].counselorName  = newName;
    c.basicInfoSnapshots[sem].counselorText  = '';
  }
  if (!sem || sem === _caseLatestSem(c)) {
    c.counselorEmail = newEmail;
    c.counselorName  = newName;
    c.counselorText  = '';
  }
}

// 學期主責顯示名稱：已連結帳號（counselorEmail）時以帳號名稱為準，
// 避免匯入時的原始文字（counselorText）蓋過後續轉派結果（#023：歷屆主責不隨變更）
function _semCounselorDisplay(c, sem) {
  const pick = (o) => !o ? '' : (o.counselorEmail
    ? (configData?.users?.[o.counselorEmail]?.name || o.counselorName || o.counselorEmail)
    : (o.counselorText || o.counselorName || ''));
  return pick(c.basicInfoSnapshots?.[sem]) || pick(c) || '—';
}

function _buildCounselorHistoryBtn(c, activeSem) {
  const sems = (c.semesters || []).filter(s => c.basicInfoSnapshots?.[s]);
  if (sems.length <= 1) return '';
  const safeId = c.id.replace(/[^a-zA-Z0-9]/g, '_');
  return ` <span style="cursor:pointer;font-size:.75rem;color:#718096;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:1px 7px;user-select:none;" onclick="toggleCounselorHistory(this,'${escHtml(c.id)}')">歷屆 ▾</span>`;
}

function toggleCounselorHistory(btn, caseId) {
  const popId = '_ch_pop';
  const existing = document.getElementById(popId);
  if (existing) { existing.remove(); if (existing._btn === btn) return; }
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const sems = Array.isArray(c.semesters) ? [...c.semesters].sort() : [openDateToSemPrefix(c.openDate)].filter(Boolean);
  const rows = sems.map(s => {
    const display = _semCounselorDisplay(c, s);
    const isCurrent = s === _caseDetailActiveSem;
    return `<div style="padding:3px 0;font-size:.85rem;color:${isCurrent?'#2b6cb0':'#4a5568'};font-weight:${isCurrent?600:400};">${escHtml(semesterLabel(s))}：${escHtml(display)}${isCurrent?' <span style="font-size:.7rem;color:#4299e1;">（本學期）</span>':''}</div>`;
  }).join('');
  const pop = document.createElement('div');
  pop.id = popId; pop._btn = btn;
  pop.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.12);padding:10px 14px;min-width:200px;';
  pop.innerHTML = `<div style="font-size:.72rem;color:#a0aec0;font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">歷屆主責</div>${rows}`;
  document.body.appendChild(pop);
  const rect = btn.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
  setTimeout(() => {
    const h = (e) => { if (!pop.contains(e.target) && e.target !== btn) { pop.remove(); document.removeEventListener('click', h); } };
    document.addEventListener('click', h);
  }, 0);
}

function _switchCasePsychTest(idx, caseId) {
  const sy = window.scrollY;
  _caseDetailMode = 'psychtest';
  _caseDetailPsychIdx = idx;
  // #10：檢視心理測驗結果報告 → 記錄查閱（此時 _detailCaseId 已是同一案）
  _detailCaseId = caseId;
  _auditCaseSectionView('檢視心理測驗結果報告');
  showCaseDetail(caseId);
  requestAnimationFrame(() => window.scrollTo(0, sy));
}

async function deletePsychTestResult(caseId, idx) {
  const c = casesData.find(x => x.id === caseId);
  if (!c || !c.psychTestResults || !c.psychTestResults[idx]) return;
  const t = c.psychTestResults[idx];
  const label = t.testSemester ? semesterLabel(t.testSemester) : '（未知學期）';
  if (!confirm(`確定要刪除「${label}」的心理測驗結果？此操作將記入稽核紀錄。`)) return;
  c.psychTestResults.splice(idx, 1);
  const jobId = bgJobAdd(`刪除心理測驗結果：${label}`);
  try {
    await migrateToChunks();
    bgJobDone(jobId);
    auditLog('刪除心理測驗結果', caseId, null, `學期：${label}`);
    showToast('已刪除測驗結果', 'success');
    _caseDetailPsychIdx = Math.max(0, idx - 1);
    showCaseDetail(caseId);
  } catch(e) { bgJobFail(jobId, e.message); }
}

async function reuploadPsychTestResult(caseId, idx, input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const old = (c.psychTestResults || [])[idx];
  const oldLabel = old?.testSemester ? semesterLabel(old.testSemester) : '（未知學期）';
  showToast('解析檔案中…', 'info');
  try {
    let result = null;
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV 無資料列');
      const headers = lines[0].split(',').map(h => h.trim());
      const idx2 = Object.fromEntries(headers.map((h,i) => [h, i]));
      const row = lines[1].split(',');
      const get = f => (idx2[f] >= 0 ? (row[idx2[f]] || '').trim() : '');
      const sid = get('學號');
      const semester = get('受測學期');
      result = {
        testSemester: semester, className: get('班級'),
        AL: get('AL'), D1: get('D1'), D2: get('D2'), F1: get('F1'), F2: get('F2'), F3: get('F3'), F4: get('F4'),
        S01: get('S01'), S02: get('S02'), S03: get('S03'), S04: get('S04'), S05: get('S05'), S06: get('S06'),
        S07: get('S07'), S08: get('S08'), S09: get('S09'), S10: get('S10'), S11: get('S11'), S12: get('S12'),
        teacherConsent: get('同意導師知情'), highConcern: get('是否為高關懷'), validity: get('問卷有效性'),
        importedAt: new Date().toISOString(),
      };
      if (sid && sid !== c.studentId) {
        if (!confirm(`CSV 中的學號（${sid}）與個案學號（${c.studentId}）不符，是否仍要覆蓋？`)) return;
      }
      if (sid) _upsertPsychTestDB(sid || c.studentId, semester, result);
    } else {
      const buf = await file.arrayBuffer();
      const { wb } = await _xlsxReadUnlocked(buf, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });
      const ws = wb.Sheets['新生測驗資料庫'] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('找不到工作表');
      const rows2 = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const targetRow = rows2.find(r => String(r['學號']||'').trim() === c.studentId) || rows2[0];
      if (!targetRow) throw new Error('找不到對應學號的資料列');
      const get2 = f => String(targetRow[f]||'').trim();
      const semester = get2('受測學期');
      result = {
        testSemester: semester, className: get2('班級'),
        AL: get2('AL'), D1: get2('D1'), D2: get2('D2'), F1: get2('F1'), F2: get2('F2'), F3: get2('F3'), F4: get2('F4'),
        S01: get2('S01'), S02: get2('S02'), S03: get2('S03'), S04: get2('S04'), S05: get2('S05'), S06: get2('S06'),
        S07: get2('S07'), S08: get2('S08'), S09: get2('S09'), S10: get2('S10'), S11: get2('S11'), S12: get2('S12'),
        teacherConsent: get2('同意導師知情'), highConcern: get2('是否為高關懷'), validity: get2('問卷有效性'),
        importedAt: new Date().toISOString(),
      };
      if (c.studentId) _upsertPsychTestDB(c.studentId, semester, result);
    }
    if (!result) throw new Error('無法解析測驗結果');
    if (!c.psychTestResults) c.psychTestResults = [];
    if (idx < c.psychTestResults.length) c.psychTestResults[idx] = result;
    else c.psychTestResults.push(result);
    const newLabel = result.testSemester ? semesterLabel(result.testSemester) : '（未知學期）';
    auditLog('覆蓋心理測驗結果', caseId, null, `原學期：${oldLabel} → 新學期：${newLabel}，檔案：${file.name}`);
    await savePsychTestDB();
    await migrateToChunks();
    showToast('已更新測驗結果', 'success');
    showCaseDetail(caseId);
  } catch(e) {
    if (e.xlsxCancelled) { showToast(e.message, 'warning'); return; }
    showToast('解析失敗：' + e.message, 'error');
  }
}

function _renderStudentSemNav(caseId, relatedCases) {
  const nav = document.getElementById('detail-student-sem-nav');
  if (!nav) return;
  if (!relatedCases || relatedCases.length <= 1) { nav.innerHTML = ''; nav.style.display = 'none'; return; }
  nav.style.display = '';
  nav.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;align-items:center;">
    <span style="font-size:.8rem;color:#718096;font-weight:600;white-space:nowrap;">歷年學期：</span>
    ${relatedCases.map(rc => {
      const isCurrent = rc.id === caseId;
      const rcSem = openDateToSemPrefix(rc.openDate);
      const semLbl = semesterLabel(rcSem);
      const ls = _semLightStyle(rc, rcSem);
      const bg = isCurrent ? '#ebf8ff' : ls.bg;
      const border = isCurrent ? '#3182ce' : ls.border;
      const color = isCurrent ? '#1a5276' : ls.color;
      const fw = isCurrent ? '700' : '500';
      return `<button onclick="_switchDetailSemester('${escHtml(rc.id)}','${escHtml(semLbl)}')"
        style="padding:4px 14px;border-radius:16px;border:1px solid ${border};
               background:${bg};color:${color};
               font-size:.82rem;font-weight:${fw};cursor:pointer;white-space:nowrap;">
        ${escHtml(semLbl)}
      </button>`;
    }).join('')}
  </div>`;
}
// B5：個案詳細頁「歷年學期」chip 切換檢視學期 → 稽核（每次切換都記，不去重；detail 含案號與切到的學期）
function _switchDetailSemester(targetCaseId, semLbl) {
  if (targetCaseId !== _detailCaseId) {
    try { auditLog('查閱個案—切換學期檢視', targetCaseId, null, `切換至 ${semLbl}（案號 ${targetCaseId}）`); } catch (_) {}
  }
  showCaseDetail(targetCaseId);
}

function _buildAllSemTimeline(relatedCases, currentCaseId, isAdminUser) {
  const items = [];
  for (const rc of relatedCases) {
    const semLabel = semesterLabel(openDateToSemPrefix(rc.openDate));
    const isCurrent = rc.id === currentCaseId;
    for (const r of (rc.records || [])) {
      if (r.deleted && !isAdminUser && r.createdBy !== currentUser?.email) continue;
      if (!canReadRecord(r, rc)) continue;
      items.push({ type:'record', date:r.date||(r.createdAt||'').slice(0,10), semLabel, isCurrent, caseId:rc.id, data:r, case:rc });
    }
    const iiMap = rc.initialInterviews || (rc.initialInterview ? {[openDateToSemPrefix(rc.openDate)]:rc.initialInterview} : {});
    for (const ii of Object.values(iiMap)) {
      if (!ii || ii.deleted || (!ii.problemsMain?.length && !ii.mainIssue)) continue;
      items.push({ type:'ii', date:(ii.createdAt||'').slice(0,10), semLabel, isCurrent, caseId:rc.id, data:ii, case:rc });
    }
    for (const pr of (rc.psychiatristRecords||[])) {
      if (pr.deleted && !isAdminUser) continue;
      items.push({ type:'psychiatrist', date:pr.date||'', semLabel, isCurrent, caseId:rc.id, data:pr, case:rc });
    }
  }
  items.sort((a,b) => { const da=a.date,db=b.date; return _recSortDesc?(da<db?1:-1):(da<db?-1:1); });
  if (!items.length) return '<div class="empty-state" style="padding:30px;"><div class="icon">📝</div><p>尚無任何紀錄</p></div>';

  return items.map(item => {
    const semBadge = !item.isCurrent
      ? `<span style="background:#ebf8ff;color:#2b6cb0;padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:600;white-space:nowrap;">${escHtml(item.semLabel)}</span>`
      : '';
    const viewBtn = !item.isCurrent
      ? `<button class="btn btn-secondary btn-sm" style="font-size:.75rem;" onclick="showCaseDetail('${escHtml(item.caseId)}')">查閱</button>`
      : '';

    if (item.type === 'record') {
      const r = item.data, rc = item.case;
      const isPending = r.status === 'pending';
      const deletedBadge = r.deleted ? `<span class="deleted-badge">已刪除</span>` : '';
      const pendingBadge = isPending ? `<span style="background:#fefcbf;color:#744210;padding:1px 8px;border-radius:10px;font-size:.72rem;margin-left:4px;">草稿</span>` : '';
      const timeDisp = r.time ? ` ${escHtml(r.time.startsWith('其他：')?r.time.slice(3):r.time)}` : '';
      const topics = r.topics?.length ? `<div style="margin:4px 0;">${r.topics.map(t=>`<span class="badge badge-gray" style="margin-right:3px;">${escHtml(t)}</span>`).join('')}</div>` : '';
      let actions = viewBtn;
      if (item.isCurrent && !r.deleted && !isPending) {
        actions += `<button class="btn-rec btn-rec-edit" onclick="printRecord('${escHtml(rc.id)}','${escHtml(r.id)}')">列印</button>`;
        if (isRecordCreator(r)) actions += `<button class="btn-rec btn-rec-edit" onclick="editRecord('${escHtml(rc.id)}','${escHtml(r.id)}')">編輯</button>`;
      }
      if (item.isCurrent && !r.deleted && (isRecordCreator(r) || isAdminUser))
        actions += `<button class="btn-rec btn-rec-delete" onclick="deleteRecord('${escHtml(rc.id)}','${escHtml(r.id)}')">刪除</button>`;
      return `<div class="record-card${r.deleted?' deleted':''}" style="margin-bottom:8px;${!item.isCurrent?'border-left:3px solid #bee3f8;':''}">
        <div class="record-card-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-size:.88rem;color:#4a5568;font-weight:600;">${escHtml(r.date||'草稿')}${escHtml(timeDisp)}</span>
            ${semBadge}${pendingBadge}${deletedBadge}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">${actions}</div>
        </div>
        ${topics}
        ${r.summary&&!r.deleted?`<div style="padding:0 12px 8px;font-size:.85rem;color:#4a5568;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${renderMaybeHtml(r.summary)}</div>`:''}
      </div>`;
    }
    if (item.type === 'ii') {
      const ii = item.data;
      const probBadges = (ii.problemsMain||[]).map(p=>`<span class="badge badge-gray" style="margin-right:3px;">${escHtml(p)}</span>`).join('');
      let actions = viewBtn;
      if (item.isCurrent) actions += `<button class="btn btn-secondary btn-sm" style="font-size:.75rem;" onclick="printInitialInterview('${escHtml(item.caseId)}')">列印</button>`;
      return `<div class="record-card" style="margin-bottom:8px;border:1.5px solid #b2d8b2;background:#f6fbf6;${!item.isCurrent?'opacity:.8;':''}">
        <div class="record-card-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-weight:600;color:#276749;">📋 初次晤談紀錄表</span>
            ${item.date?`<span style="font-size:.8rem;color:#718096;">${escHtml(item.date)}</span>`:''}
            ${semBadge}
          </div>
          <div style="display:flex;gap:6px;">${actions}</div>
        </div>
        ${probBadges?`<div style="padding:4px 12px 8px;">${probBadges}</div>`:''}
        ${ii.mainIssue?`<div style="padding:0 12px 8px;font-size:.85rem;color:#4a5568;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${renderMaybeHtml(ii.mainIssue)}</div>`:''}
      </div>`;
    }
    if (item.type === 'psychiatrist') {
      const pr = item.data;
      const diagLabel = pr.diagnosisType==='specific'?`符合：${escHtml(pr.diagnosisName||'—')}`:'不符合任一精神疾患診斷';
      const deletedBadge = pr.deleted?`<span class="deleted-badge">已刪除</span>`:'';
      let actions = viewBtn;
      if (item.isCurrent && !pr.deleted) actions += `<button class="btn btn-secondary btn-sm" style="font-size:.75rem;" onclick="printPsychiatristRecord('${escHtml(item.caseId)}','${escHtml(pr.id)}')">列印</button>`;
      return `<div class="record-card${pr.deleted?' deleted':''}" style="margin-bottom:8px;border-left:3px solid #e9d8fd;${!item.isCurrent?'opacity:.8;':''}">
        <div class="record-card-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-size:.88rem;font-weight:600;">🩺 ${escHtml(pr.date||'—')}</span>
            <span style="font-size:.8rem;color:#718096;">${diagLabel}</span>
            ${semBadge}${deletedBadge}
          </div>
          <div style="display:flex;gap:6px;">${actions}</div>
        </div>
        ${pr.recommendations&&!pr.deleted?`<div style="padding:0 12px 8px;font-size:.85rem;color:#4a5568;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${renderMaybeHtml(pr.recommendations)}</div>`:''}
      </div>`;
    }
    return '';
  }).join('');
}

async function showCaseDetail(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  // Cold case：列表只有 index 摘要，點開時 on-demand 載入完整 chunk
  if (c._indexOnly && !c._fullLoaded) {
    // #9b：封存/舊學期個案 on-demand 載入較慢 → 顯示明確「載入中」遮罩（含個案姓名），讀取完成自動關閉
    showLoading(`「${c.name || caseId}」個案資料載入中…`);
    const chunkName = getCaseChunkName(caseId);
    try {
      let data = await _ckLoadAny(chunkName).catch(() => null); // 先試 IndexedDB
      if (!data) {
        data = await driveReadJson(`cases/${chunkName}.json`);
        if (data) _ckSave(chunkName, data, '');
      }
      const full = (data?.cases || []).find(x => x.id === caseId);
      if (full) Object.assign(c, full, { _fullLoaded: true, _indexOnly: false });
      else c._fullLoaded = true; // 找不到完整資料，避免反覆重試
    } catch (e) {
      c._fullLoaded = true;
      showToast('讀取完整資料失敗，僅顯示摘要：' + e.message, 'warn');
      _syslog('warn', `cold case 載入失敗（${caseId}）：${e.message}`);
    } finally {
      hideLoading();
    }
  }
  if (_detailCaseId !== caseId) { _recPage = 1; _detailCaseId = caseId; _caseDetailActiveSem = null; _caseDetailMode = 'semester'; _caseDetailPsychIdx = 0; _detailSemFilter = 'current'; _viewedSectionsThisDetail = new Set(); /* #10：換個案時重設區塊查閱去重 */ }
  _recSortDesc = _userPref_('recSortDesc', false);
  // 危機唯讀檢視：非危機途徑本就看不到、但今日有危機授權 → 唯讀。
  // B5 修正：「記錄閱讀」與「唯讀」語義分離——主任/管理者因 _caseNormallyAccessible 恆 true，
  // 舊條件使其經危機閱讀開啟個案時完全不留閱讀紀錄（#13-4 本意是特權身份同樣受監督）。
  // 改為只要今日有危機授權（授權只會因走過危機閱讀申請而存在）就記錄閱讀；唯讀判定維持原條件不變。
  const _crisisRead = _hasCrisisGrant(c.id);
  const _crisisView = !_caseNormallyAccessible(c) && _crisisRead;
  _detailReadOnly = _crisisView;
  // #33-2：主責／個管開啟自己個案的詳情，即視為已閱其身心調適假紀錄。
  // 將本人 email 併入 acknowledgedBy → 管理頁「主責已讀」同步、鈴鐺待確認清單自動消除。
  // 僅在非危機唯讀檢視、且本人確為此案主責或個管（allowedCases）時觸發；有新增才寫檔。
  if (!_detailReadOnly && currentUser?.email && c.studentId) {
    const _mineCase = c.counselorEmail === currentUser.email
      || (configData?.users?.[currentUser.email]?.allowedCases || []).includes(c.id);
    if (_mineCase) {
      let _mlAcked = 0;
      mentalLeavesData.forEach(l => {
        if (l.deleted || l.studentId !== c.studentId) return;
        if (!Array.isArray(l.acknowledgedBy)) l.acknowledgedBy = [];
        if (!l.acknowledgedBy.includes(currentUser.email)) { l.acknowledgedBy.push(currentUser.email); _mlAcked++; }
      });
      if (_mlAcked) { try { _syncTodoBadge(); } catch (_) {} saveMentalLeaves().catch(() => {}); }
    }
  }
  const _relatedCases = _getRelatedCases(caseId);
  const _hasRelated = _relatedCases.length > 1;

  // 學期 tab 計算（跨學期同案號）— 必須在所有使用 _cd 的 DOM 操作之前
  const _csems = Array.isArray(c.semesters) && c.semesters.length > 1 ? [...c.semesters].sort() : null;
  if (_csems) {
    if (!_caseDetailActiveSem || !_csems.includes(_caseDetailActiveSem))
      _caseDetailActiveSem = _csems[_csems.length - 1];
  } else {
    _caseDetailActiveSem = openDateToSemPrefix(c.openDate);
  }
  const _activeSem = _caseDetailActiveSem;
  if (_crisisRead) _logCrisisRead(c, _activeSem); // 區塊級閱讀記錄（session 節流）；含主任/管理者（B5 修正）
  // Per-semester snapshot: use snapshot data if available, otherwise fall back to case
  const _snapData = (c.basicInfoSnapshots && _activeSem && c.basicInfoSnapshots[_activeSem]) || null;
  const _cd = (field) => (_snapData !== null && _snapData[field] !== undefined) ? _snapData[field] : c[field];

  _renderDetailBackBtn();
  document.getElementById('detail-name').textContent = c.name || '—';
  document.getElementById('detail-meta').innerHTML =
    `案號：<strong>${escHtml(c.id)}</strong> &nbsp;|&nbsp; ` +
    `開案日期：${adToRocDisplay(_cd('openDate'))} &nbsp;|&nbsp; ` +
    `主責：${escHtml(_cd('counselorText') || _cd('counselorName') || configData?.users?.[_cd('counselorEmail')]?.name || _cd('counselorEmail') || '—')}` +
    _counselorStatusBadge(_cd('counselorEmail')) +
    (!_cd('counselorEmail') && (_cd('counselorText') || _cd('counselorName')) ? ' <span style="font-size:.72rem;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:1px 7px;color:#a0aec0;">未連結帳號</span>' : '') +
    _buildCounselorHistoryBtn(c, _activeSem) +
    `&nbsp;&nbsp;${statusBadge(c.status)}` +
    ((c.isTransferCase || (transferData||[]).some(t => t.type === 'incoming' && t.caseId === c.id)) ? ' &nbsp;<span class="badge badge-teal">轉銜個案</span>' : '') +
    (c.archived ? ' &nbsp;<span style="background:#e2e8f0;color:#4a5568;border-radius:4px;padding:2px 8px;font-size:.78rem;font-weight:600;">封存</span>' : '') +
    (c.deleted ? ` &nbsp;<span class="badge-case-deleted">已刪除 by ${escHtml(c.deletedByName || c.deletedBy || '?')}</span>` : '');
  if (_crisisView) {
    document.getElementById('detail-meta').insertAdjacentHTML('afterbegin',
      '<div style="background:#fff5f5;border:2px solid #fc8181;color:#c53030;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-weight:600;font-size:.86rem;">⚠ 危機閱讀（唯讀）— 你透過危機申請檢視此案，無法編輯；你的閱讀已記錄並公開於全體監督區。</div>');
  }

  const notesEl = document.getElementById('detail-import-notes');
  if (notesEl) {
    if (c.importDateNotes?.length) {
      notesEl.style.display = '';
      notesEl.innerHTML =
        `<div class="alert alert-warn" style="margin:0 0 12px;background:#fffbeb;border:1px solid #f6ad55;color:#744210;border-radius:8px;padding:12px 16px;">` +
        `<strong>⚠ 匯入日期自動修正提示</strong>` +
        c.importDateNotes.map(n => `<div style="margin-top:6px;font-size:.875rem;">• ${escHtml(n)}</div>`).join('') +
        `</div>`;
    } else {
      notesEl.style.display = 'none';
      notesEl.innerHTML = '';
    }
  }

  const semDupEl = document.getElementById('detail-sem-dup-notice');
  if (semDupEl) {
    const _cSemPrefix = openDateToSemPrefix(c.openDate);
    const _semDups = casesData.filter(other =>
      other.id !== c.id && !other.deleted &&
      openDateToSemPrefix(other.openDate) === _cSemPrefix &&
      ((c.studentId && other.studentId === c.studentId) ||
       (c.idNumber  && other.idNumber  === c.idNumber))
    );
    if (_semDups.length) {
      semDupEl.style.display = '';
      semDupEl.innerHTML =
        `<div style="margin:0 0 12px;background:#fff5f5;border:2px solid #fc8181;border-radius:8px;padding:12px 16px;">` +
        `<div style="font-size:.9rem;font-weight:700;color:#c53030;margin-bottom:6px;">🚨 本學期同一個案另有開案紀錄</div>` +
        _semDups.map(d =>
          `<div style="font-size:.85rem;color:#742a2a;margin-bottom:3px;">
            案號：<strong>${escHtml(d.id)}</strong>　主責：${escHtml(d.counselorName || configData?.users?.[d.counselorEmail]?.name || d.counselorEmail || '—')}${_counselorStatusBadge(d.counselorEmail)}　開案日期：${escHtml(d.openDate || '—')}
            <span onclick="showCaseDetail('${escHtml(d.id)}')" style="color:#2b6cb0;cursor:pointer;text-decoration:underline;margin-left:8px;">查看</span>
          </div>`
        ).join('') +
        `</div>`;
    } else {
      semDupEl.style.display = 'none';
      semDupEl.innerHTML = '';
    }
  }

  auditLog('查閱個案', caseId);

  const isAdminUser = currentRole === '主任' || extraRole === '管理者';
  const _canEditMgrs = !_detailReadOnly && (isAdminUser || c.counselorEmail === currentUser?.email
    || _hasManagerAccess(currentUser?.email, c.id, _activeSem));
  const isActive = ((c.semesterStatus || {})[_activeSem] || 'active') !== 'closed';
  const caseIsDeleted = !!c.deleted;
  const cid = escHtml(c.id);

  // ── 一學生一案號 Slice 2：曾用案號（合併遷移後被併掉的舊案號）顯示＋對調入口 ──
  const formerIdsEl = document.getElementById('detail-former-ids');
  if (formerIdsEl) {
    if (Array.isArray(c.formerIds) && c.formerIds.length) {
      const _canSwapMainId = !_detailReadOnly && !caseIsDeleted &&
        (isAdminUser || _getLatestCounselorEmail(c) === currentUser?.email);
      formerIdsEl.style.display = '';
      formerIdsEl.innerHTML =
        `<div style="margin:0 0 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;font-size:.85rem;color:#4a5568;">` +
        `曾用案號：` +
        c.formerIds.map(f => {
          const semLabel = (f.semesters || []).map(semesterLabel).join('、');
          const swapBtn = _canSwapMainId
            ? ` <span onclick="_swapMainCaseIdConfirm('${cid}','${escHtml(f.id)}')" style="color:#2b6cb0;cursor:pointer;text-decoration:underline;margin-left:4px;" data-tip="將此曾用案號設為主案號（僅代表號互換，資料不動）">設為主號</span>`
            : '';
          return `<strong>${escHtml(f.id)}</strong>${semLabel ? `（${escHtml(semLabel)}）` : ''}${swapBtn}`;
        }).join('、') +
        `</div>`;
    } else {
      formerIdsEl.style.display = 'none';
      formerIdsEl.innerHTML = '';
    }
  }

  // ── 全案層級按鈕（頂部） ──
  let actionsHtml = '';
  if (!caseIsDeleted) {
    actionsHtml += `<button class="btn btn-secondary" onclick="showNewSemModal('${cid}')" data-tip="為此個案開立新學期，適用於個案在新學期再次求助時。">新學期開案</button>`;
    if (_hasNewCounselorAlert(c)) actionsHtml += ` <button class="btn btn-secondary" style="font-size:.83rem;padding:4px 10px;" onclick="dismissNewCounselorAlert('${cid}')">取消新案提醒</button>`;
    const canArchive = isAdminUser || c.counselorEmail === currentUser?.email;
    if (canArchive) {
      if (c.archived) {
        actionsHtml += ` <button class="btn btn-secondary" onclick="unarchiveCase('${cid}')" data-tip="解除封存後，此個案將重新出現在個案列表的預設檢視中。">♻️ 解除封存</button>`;
      } else {
        actionsHtml += ` <button class="btn btn-secondary" onclick="archiveCase('${cid}')" data-tip="封存後，此個案將在個案列表中預設隱藏（可透過篩選「已封存」查閱）。適用於不再需要主動服務的個案，統計分析仍會計入。">📦 封存個案</button>`;
      }
    }
    if (isAdminUser) {
      actionsHtml += ` <button class="btn btn-danger" onclick="deleteCase('${cid}')" data-tip="將個案標記為已刪除（軟刪除，可復原）。確認無誤後再由管理者執行永久刪除。">刪除個案</button>`;
      actionsHtml += ` <button class="btn btn-secondary" style="padding:4px 8px;font-size:.8rem;" onclick="event.stopPropagation();_showDataTip(this)" data-tip="【封存個案】封存後此個案在列表中預設隱藏，可透過篩選「已封存」查閱，統計分析仍計入。&#10;【錯誤建案】點「刪除個案」→ 確認無誤後由管理者「永久刪除」（無法復原）。">？</button>`;
    } else {
      actionsHtml += ` <button class="btn btn-secondary" style="padding:4px 8px;font-size:.8rem;" onclick="event.stopPropagation();_showDataTip(this)" data-tip="封存後，此個案在個案列表中預設隱藏。適用於不再需要主動服務、但仍需保存紀錄的個案。可透過篩選「已封存」查閱，統計分析仍會計入。">？</button>`;
    }
  } else {
    if (isAdminUser) {
      actionsHtml += `<button class="btn btn-secondary" onclick="restoreCaseAdmin('${cid}')">復原個案</button>`;
      actionsHtml += ` <button class="btn btn-danger" onclick="hardDeleteCase('${cid}')">永久刪除</button>`;
    }
  }
  document.getElementById('detail-actions').innerHTML = actionsHtml;

  // ── 學期內操作按鈕（在學期chips之下） ──
  const _canDeleteSem = (c.semesters||[]).length > 1;
  let semActHtml = '';
  if (!caseIsDeleted && !_detailReadOnly) { // 危機唯讀：不顯示任何個案操作按鈕
    if (isActive) {
      semActHtml += `<button class="btn btn-primary" onclick="openNewRecordPage('${cid}')">＋ 新增記錄</button>`;
      semActHtml += ` <button class="btn btn-secondary" onclick="openEventRecordForm('${cid}', undefined, 'case-detail')">＋ 事件處理記錄</button>`;
    }
    semActHtml += ` <button class="btn btn-secondary" onclick="openEditCasePage('${cid}')">編輯基本資料</button>`;
    semActHtml += ` <button class="btn btn-secondary" onclick="openBatchPrintModal('${cid}')" data-tip="產生事件處理記錄表">記錄批次列印</button>`;
    semActHtml += ` <button class="btn btn-secondary" onclick="_scrollToIiCard('${cid}')" data-tip="會跳到初次晤談表卡片區（需切換到本學期模式）">移至初次晤談卡片</button>`;
    semActHtml += ` <button class="btn btn-secondary" onclick="_scrollToPsychCard('${cid}')" data-tip="會跳到精神科醫師評估卡片區">移至精神科醫師卡片</button>`;
    semActHtml += ` <button class="btn btn-secondary" onclick="_scrollToEvalCard('${cid}')" data-tip="會跳到結案/學期評估卡片區">移至結案/學期評估卡片</button>`;
    if (isActive) {
      semActHtml += ` <button class="btn btn-danger" onclick="closeCaseConfirm('${cid}')">結案</button>`;
    }
    if (!isActive) {
      semActHtml += ` <button class="btn btn-secondary" onclick="reopenCase('${cid}','${_activeSem}')" data-tip="將此學期狀態從已結案改回進行中，適用於結案後需繼續服務的情況。">取消結案</button>`;
    }
    if (_canDeleteSem) {
      semActHtml += ` <button class="btn btn-danger" onclick="deleteCaseSemData('${cid}','${_activeSem}')" data-tip="刪除此學期的開案資料。個案有多個學期時可用，不影響其他學期的紀錄。">刪除此學期基本資料</button>`;
    } else {
      semActHtml += ` <button class="btn btn-danger" onclick="deleteCase('${cid}')" data-tip="這是唯一學期，刪除後整筆個案將消失（軟刪除，管理者可復原）。">刪除此個案</button>`;
    }
  }
  const semActEl = document.getElementById('detail-sem-actions');
  if (semActEl) semActEl.innerHTML = _caseDetailMode === 'semester' ? semActHtml : '';

  const mgrsEl = document.getElementById('detail-managers');
  const _mgrEmailsTop = _getManagersForCase(c.id);
  const _autoMgrTopMap = new Map(); // email → reason
  _getAutoManagersForCase(c.id).forEach(x => _autoMgrTopMap.set(x.email, x.reason));
  // 初談者：權限等同個管員，但獨立顯示、標籤不同（排除主責，避免重複）
  const _iiEmailsTop = _getInitialInterviewersForCase(c).filter(e => e && e !== c.counselorEmail);
  const _mgrNameOf = e => escHtml(formatCounselorLabel(e) || configData?.users?.[e]?.name || e) +
    (_autoMgrTopMap.has(e) ? `<span style="font-size:.7rem;color:#553c9a;background:#e9d8fd;border-radius:6px;padding:0 5px;margin-left:3px;" data-tip="當然個管：${escHtml(_autoMgrTopMap.get(e).label + ' · ' + _autoMgrTopMap.get(e).supervisee)}">當然</span>` : '');
  const _mgrLine = _mgrEmailsTop.length
    ? `<div style="font-size:.82rem;color:#718096;">個案管理員：${_mgrEmailsTop.map(_mgrNameOf).join('、')}</div>`
    : '';
  const _iiLine = _iiEmailsTop.length
    ? `<div style="font-size:.82rem;color:#276749;">初談者：${_iiEmailsTop.map(e => escHtml(formatCounselorLabel(e) || configData?.users?.[e]?.name || e)).join('、')}</div>`
    : '';
  if (_mgrLine || _iiLine) {
    mgrsEl.innerHTML = `<div style="margin-top:2px;display:flex;flex-direction:column;gap:2px;">${_mgrLine}${_iiLine}</div>`;
    mgrsEl.style.display = '';
  } else {
    mgrsEl.style.display = 'none';
  }

  const field = (label, val) => `
    <div>
      <div style="font-size:.76rem;color:#a0aec0;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">${escHtml(label)}</div>
      <div style="font-size:.9rem;color:#2d3748;">${escHtml(val || '—')}</div>
    </div>`;

  const natLabel = _cd('nationality')
    ? (_cd('nationality') + (_cd('foreignCountry') ? `（${_cd('foreignCountry')}）` : ''))
    : '—';
  const ethLabel = _cd('ethnicity')
    ? (_cd('ethnicity') + (_cd('ethnicityNote') ? `（${_cd('ethnicityNote')}）` : ''))
    : (_cd('nationality') === '本國籍' ? '無/未填寫' : '—');
  const pastLabel = (_cd('pastRecords') || []).length ? (_cd('pastRecords') || []).join('、') : '無/未填寫';

  // 晤談紀錄區塊
  const allRecords = c.records || [];
  // 可閱讀：管理者、建立者、共同晤談者、主責、個案管理員
  const readable = allRecords.filter(r => canReadRecord(r, c));
  // 已刪除：管理者可見全部；建立者可看到自己被刪除的「痕跡」；其他人不顯示已刪除
  const visibleRecords = readable.filter(r => {
    if (_csems && _detailSemFilter !== 'all' && r.date && r.status !== 'pending') {
      if (openDateToSemPrefix(r.date) !== _semKeyBase(_activeSem)) return false;
    }
    if (!r.deleted) return true;
    if (isAdminUser) return true;
    if (isRecordCreator(r)) return true;
    return false;
  });
  const activeCount = visibleRecords.filter(r => !r.deleted).length;
  const deletedCount = visibleRecords.filter(r => r.deleted).length;

  // 精神科醫師評估：併入個案紀錄時間軸依日期排序顯示（僅未刪除者；已刪除紀錄仍僅顯示於精神科醫師評估卡片）
  const _visiblePsyForTimeline = (c.psychiatristRecords || []).filter(pr => {
    if (pr.deleted) return false;
    if (_csems && _detailSemFilter !== 'all' && pr.date) {
      if (openDateToSemPrefix(pr.date) !== _semKeyBase(_activeSem)) return false;
    }
    return true;
  });

  // 身心狀態評估表（#030-⑤）：有案號者，已填評估表併入個案紀錄時間軸依日期排序顯示
  const _visibleMlAssessForTimeline = (typeof mentalLeavesData !== 'undefined' ? mentalLeavesData : []).filter(l => {
    if (l.deleted || !l.assessment || l.studentId !== c.studentId) return false;
    const _mlaDate = l.assessment.evalDate || (l.assessment.filledAt || '').slice(0, 10);
    if (_csems && _detailSemFilter !== 'all' && _mlaDate) {
      if (openDateToSemPrefix(_mlaDate) !== _semKeyBase(_activeSem)) return false;
    }
    return true;
  });

  // v179：聯繫歷程融入服務歷程主時間軸——每筆聯繫展開為一項，可見性比照評估表（同一批 _visibleMlAssessForTimeline）
  const _visibleMlContactsForTimeline = [];
  _visibleMlAssessForTimeline.forEach(l => {
    (l.assessment.contacts || []).forEach(ct => {
      if (_csems && _detailSemFilter !== 'all' && ct.date) {
        if (openDateToSemPrefix(ct.date) !== _semKeyBase(_activeSem)) return;
      }
      _visibleMlContactsForTimeline.push({ leave: l, contact: ct });
    });
  });

  const renderRecordCard = r => {
    const editable = !r.deleted && isEditable(r.createdAt) && !_detailReadOnly;
    const isCreator = isRecordCreator(r);
    const isLinkedAsII = !r.deleted && c.initialInterview?.type === 'linkedRecord' && r.id === c.initialInterview?.recordId;
    const rcid = escHtml(c.id);
    const rid  = escHtml(r.id);
    const isPending = r.status === 'pending';
    let actions = '';
    if (!caseIsDeleted) {
      if (!r.deleted) {
        if (!isPending) {
          actions += `<button class="btn-rec btn-rec-edit" onclick="printRecord('${rcid}','${rid}')">列印</button>`;
          // 編輯：僅建立者可編輯（管理者無編輯權，僅可刪除）
          if (isCreator) {
            actions += editable
              ? `<button class="btn-rec btn-rec-edit" onclick="editRecord('${rcid}','${rid}')">編輯</button>`
              : `<span class="edit-locked">超過2週，不可編輯</span>`;
          }
        }
        // 刪除：建立者或管理者
        if (isCreator || isAdminUser) {
          actions += `<button class="btn-rec btn-rec-delete" onclick="deleteRecord('${rcid}','${rid}')">刪除</button>`;
        }
      } else if (isAdminUser) {
        actions += `<button class="btn-rec btn-rec-restore" onclick="restoreRecord('${rcid}','${rid}')">復原</button>`;
        actions += `<button class="btn-rec btn-rec-delete" onclick="purgeRecord('${rcid}','${rid}')" title="徹底移除痕跡">徹底移除</button>`;
      }
    }

    const showDeleted = r.deleted || caseIsDeleted;
    let deletedLabel = '';
    if (r.deleted) {
      deletedLabel = `<span class="deleted-badge">已刪除 by ${escHtml(r.deletedByName || r.deletedBy)}</span>`;
    } else if (caseIsDeleted) {
      deletedLabel = `<span class="deleted-badge">已刪除（個案已刪除）</span>`;
    }

    const timeDisplay = r.time ? ` ${escHtml(r.time.startsWith('其他：') ? r.time.slice(3) : r.time)}` : '';
    // Compact inline chips for header (介入方式 / 晤談對象 / 會談主題 / 服務項目)
    const _cs = 'font-size:.71rem;padding:1px 6px;white-space:nowrap;line-height:1.6;';
    const statChipsHtml = [
      r.interventionMode ? `<span class="badge badge-gray" style="background:#ebf4ff;color:#2b6cb0;border:1px solid #bee3f8;${_cs}">${escHtml(r.interventionMode)}</span>` : '',
      ...(r.interviewees||[]).map(v=>`<span class="badge badge-gray" style="background:#f0fff4;color:#276749;border:1px solid #c6f6d5;${_cs}">${escHtml(v)}</span>`),
      ...(r.topics||[]).map(t=>`<span class="badge badge-gray" style="${_cs}">${escHtml(t)}</span>`),
      ...(r.serviceItems||[]).map(s=>`<span class="badge badge-gray" style="background:#fef9e7;color:#7d6608;border:1px solid #fbd38d;${_cs}">${escHtml(s)}</span>`)
    ].filter(Boolean).join('');
    const coupleBadge = (r.coupleId && r.couplePartnerName)
      ? `<span class="badge" style="background:#e9d8fd;color:#553c9a;border:1px solid #d6bcfa;${_cs}">伴侶：${escHtml(r.couplePartnerName)}</span>`
      : '';

    // 下次預約（即時查 bookingsData；預約已被刪除則不顯示）
    const _recNextBk = r.nextBkId ? bookingsData.find(b => b.id === r.nextBkId) : null;
    const _recNextBkRoomD = _recNextBk ? (_recNextBk.room === '其他' ? (_recNextBk.customRoom || '其他') : (_recNextBk.room || '')) : '';
    const _recNextBkFoldLine = _recNextBk
      ? `<div style="margin-top:2px;font-size:.78rem;color:#a0aec0;">📅 ${escHtml((_recNextBk.date||'').slice(5).replace('-','/'))} ${escHtml((_recNextBk.startTime||'').slice(0,5))} ${escHtml(_recNextBkRoomD)}</div>` : '';
    const _recNextBkFullLine = _recNextBk
      ? `<div style="margin-top:4px;font-size:.85rem;color:#4a5568;">下次預約：${escHtml(_recNextBk.date||'')} ${escHtml((_recNextBk.startTime||'').slice(0,5))}–${escHtml((_recNextBk.endTime||'').slice(0,5))} ${escHtml(_recNextBkRoomD)}</div>` : '';

    const foldView = `<div class="rec-fold-view">
      ${r.summary ? `<div class="record-summary rec-summary-clamp">${renderMaybeHtml(r.summary)}</div>
      <div class="rec-fold-more"><span class="rec-dots">……</span><button class="rec-more-btn" onclick="toggleRecordExpand('${escHtml(r.id)}')">更多</button></div>` : ''}
      ${r.nextPlan ? `<div style="margin-top:6px;font-size:.82rem;color:#718096;" class="rec-nextplan-clamp">📌 ${renderMaybeHtml(r.nextPlan)}</div>${_recNextBkFoldLine}` : ''}
      ${r.notes ? `<div style="margin-top:4px;font-size:.82rem;color:#a0aec0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;">備註：${renderMaybeHtml(r.notes)}</div>` : ''}
    </div>`;

    const fullView = `<div class="rec-full-view">
      ${r.summary ? `<div class="rec-section-label">主述與會談資料</div><div class="record-summary">${renderMaybeHtml(r.summary)}</div>` : ''}
      ${r.assessment ? `<div class="rec-section-label">問題評估</div><div class="record-summary">${renderMaybeHtml(r.assessment)}</div>` : ''}
      ${r.nextPlan ? `<div class="rec-section-label">後續處遇計畫</div><div class="record-summary">${renderMaybeHtml(r.nextPlan)}</div>${_recNextBkFullLine}` : ''}
      ${r.notes ? `<div class="rec-section-label">備註</div><div class="record-summary">${renderMaybeHtml(r.notes)}</div>` : ''}
      ${(r.summaryImages?.length || r.image) ? `<div id="rec-img-view-${r.id}" style="margin-top:8px;display:none;gap:8px;flex-wrap:wrap;align-items:flex-start;"></div>` : ''}
      ${renderAttachChips(r.attachments)}
    </div>`;

    const toggleBtn = !r.deleted
      ? `<button class="rec-toggle-btn" onclick="toggleRecordExpand('${escHtml(r.id)}')">展開 ▼</button>`
      : '';

    const pendingStyle = isPending ? ' style="background:#fffff0;border-color:#f6e05e;"' : '';
    const _pendingTodo = isPending ? todosData.find(t => t.recordId === r.id) : null;
    const _pendingLabel = _pendingTodo?.origin === 'autosave' ? '自動備援' : '草稿';
    const pendingBadge = isPending ? `<span class="badge badge-orange" style="font-size:.73rem;background:#fefcbf;color:#744210;border:1px solid #f6e05e;">${_pendingLabel}</span>` : '';
    const pendingEditBtn = isPending
      ? `<button class="btn-rec" style="background:#fefcbf;border-color:#f6e05e;color:#744210;" onclick="openNewRecordPage('${rcid}','${rid}','${escHtml(r.recordKind||'晤談記錄')}')">繼續編輯</button>`
      : '';

    return `
      <div class="record-card${showDeleted ? ' deleted' : ''}" id="rec-card-${escHtml(r.id)}"${isLinkedAsII ? ' style="background:#ebf8ff;border-color:#90cdf4;"' : (isPending ? pendingStyle : '')}>
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${escHtml(r.id)}')">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1;min-width:0;margin-right:10px;">
            <span class="record-date">${escHtml(r.date || '草稿')}${timeDisplay}</span>
            ${pendingBadge}
            ${r.isEventRecord ? '<span class="badge badge-orange" style="font-size:.73rem;">事件處理</span>' : ''}
            ${isLinkedAsII ? '<span class="badge" style="background:#bee3f8;color:#2b6cb0;border:1px solid #90cdf4;font-size:.73rem;">📋 初談記錄表</span>' : ''}
            ${deletedLabel}
            ${coupleBadge}${statChipsHtml}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span class="record-counselor">${escHtml(r.counselorName || r.counselorEmail || '')}</span>
            <div class="record-card-actions">${pendingEditBtn}${actions}</div>
            ${toggleBtn}
          </div>
        </div>
        ${foldView}${fullView}
      </div>`;
  };

  // 精神科醫師評估之個案紀錄時間軸卡片：可收合/展開，展開後顯示填表人/評估人
  const renderPsyTimelineCard = pr => {
    const isCreator = pr.createdBy === currentUser?.email;
    const psyEditable = (!pr.createdAt || isEditable(pr.createdAt)) && !_detailReadOnly;
    const _pf = _psyFillerInfo(pr);
    let actions = '';
    if (!caseIsDeleted) {
      if (psyEditable) actions += `<button class="btn-rec btn-rec-edit" onclick="openPsychiatristModal('${escHtml(c.id)}','${escHtml(pr.id)}')">編輯</button>`;
      actions += `<button class="btn-rec btn-rec-edit" onclick="printPsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')">列印</button>`;
      if (isAdminUser || (isCreator && psyEditable))
        actions += `<button class="btn-rec btn-rec-delete" onclick="deletePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')">刪除</button>`;
    }
    const diagBadge = pr.diagnosisType==='specific' ? `<span class="badge badge-orange">${escHtml(pr.diagnosisName||'確診')}</span>` : '';
    const medBadge  = pr.medicationAdvice==='yes' ? '<span class="badge badge-red">建議藥物</span>' : '';
    const hospBadge = pr.hospitalizationAdvice==='yes' ? '<span class="badge badge-red">建議住院</span>' : '';

    const foldView = `<div class="rec-fold-view">
      ${pr.recommendations ? `<div class="record-summary rec-summary-clamp">${renderMaybeHtml(pr.recommendations)}</div>
      <div class="rec-fold-more"><span class="rec-dots">……</span><button class="rec-more-btn" onclick="toggleRecordExpand('${escHtml(pr.id)}')">更多</button></div>` : ''}
    </div>`;

    const fullView = `<div class="rec-full-view">
      ${pr.mainIssue ? `<div class="rec-section-label">主述與會談資料</div><div class="record-summary">${renderMaybeHtml(pr.mainIssue)}</div>` : ''}
      ${pr.coreAssessment ? `<div class="rec-section-label">核心問題之評估與判斷</div><div class="record-summary">${renderMaybeHtml(pr.coreAssessment)}</div>` : ''}
      ${pr.intervention ? `<div class="rec-section-label">介入處遇</div><div class="record-summary">${renderMaybeHtml(pr.intervention)}</div>` : ''}
      ${pr.recommendations ? `<div class="rec-section-label">給學生諮商中心的建議</div><div class="record-summary">${renderMaybeHtml(pr.recommendations)}</div>` : ''}
      ${pr.otherNotes ? `<div class="rec-section-label">其他注意事項</div><div class="record-summary">${renderMaybeHtml(pr.otherNotes)}</div>` : ''}
      <div class="rec-section-label">${escHtml(_pf.label)}</div><div class="record-summary">${escHtml(_pf.display)}</div>
      ${renderAttachChips(pr.attachments)}
    </div>`;

    const toggleBtn = `<button class="rec-toggle-btn" onclick="toggleRecordExpand('${escHtml(pr.id)}')">展開 ▼</button>`;

    return `
      <div class="record-card" id="rec-card-${escHtml(pr.id)}">
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${escHtml(pr.id)}')">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1;min-width:0;margin-right:10px;">
            <span class="record-date">🩺 ${escHtml(pr.date || '—')}</span>
            <span class="badge" style="background:#e9d8fd;color:#553c9a;border:1px solid #d6bcfa;font-size:.73rem;">精神科評估</span>
            ${diagBadge}${medBadge}${hospBadge}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <div class="record-card-actions">${actions}</div>
            ${toggleBtn}
          </div>
        </div>
        ${foldView}${fullView}
      </div>`;
  };

  // 身心狀態評估表之個案紀錄時間軸卡片（#030-⑤）：檢視/列印隨個案詳情權限；編輯僅窗口/主任/系統管理者且非唯讀情境
  const renderMlAssessTimelineCard = l => {
    const a = l.assessment || {};
    const cardId = `mla-tl-${escHtml(l.id)}`;
    const aDate = a.evalDate || (a.filledAt || '').slice(0, 10) || '—';
    const outcomeBadge = a.resultOutcome === 'counseling'
      ? '<span class="badge" style="background:#c6f6d5;color:#276749;border:1px solid #9ae6b4;font-size:.73rem;">進入諮商輔導流程</span>'
      : a.resultOutcome === 'noCase'
      ? '<span class="badge" style="background:#e2e8f0;color:#4a5568;border:1px solid #cbd5e0;font-size:.73rem;">不開案</span>'
      : '';
    const suicideVal = a.suicide ?? null;
    const suicideBadge = suicideVal !== null && suicideVal >= 1
      ? `<span class="badge badge-red" style="font-size:.73rem;">自殺想法 ${suicideVal} 分</span>` : '';
    let actions = `<button class="btn-rec btn-rec-edit" onclick="openMlAssessmentModal('${escHtml(l.id)}', true)">檢視</button>`;
    if (!caseIsDeleted) {
      if (_mlAssessCanEdit() && !_detailReadOnly)
        actions += `<button class="btn-rec btn-rec-edit" onclick="openMlAssessmentModal('${escHtml(l.id)}')">編輯</button>`;
      actions += `<button class="btn-rec btn-rec-edit" onclick="printMlAssessment('${escHtml(l.id)}')">列印</button>`;
    }
    const fillerName = configData?.users?.[a.filledBy]?.name || a.filledByName || a.filledBy || '—';
    // v179：BSRS 明細（五題分數＋總分＋自殺想法）與「身心調適假之身心評估」註記
    // v186：個案皆未回答時，明細改顯示提示文字而非全空的一排「—」
    const bsrsDetailHtml = a.bsrsUnanswered
      ? `<div style="font-size:.82rem;color:#a0aec0;">個案皆未回答</div>`
      : `<div style="font-size:.82rem;color:#4a5568;line-height:1.7;">
      ${_bsrsOrderedLabels(ML_ASSESS_BSRS_LABELS).map(({label,storageIdx},displayIdx)=>`(${displayIdx+1}) ${escHtml(label)}：<b>${a.bsrs?.[storageIdx] ?? '—'}</b>`).join('　')}
    </div>`;
    const fullView = `<div class="rec-full-view">
      <div class="rec-section-label">BSRS-5 明細<span style="font-weight:400;color:#a0aec0;">（身心調適假之身心評估）</span></div>
      ${bsrsDetailHtml}
      <div class="record-summary">${a.bsrsUnanswered ? '個案皆未回答' : `(1)-(5) 題總分 ${_mlAssessBsrsTotal(a)} 分，★自殺想法 ${suicideVal ?? '—'} 分`}</div>
      ${a.reason ? `<div class="rec-section-label">請假事由</div><div class="record-summary">${escHtml(a.reason)}</div>` : ''}
      ${(a.resultText || a.resultOutcome) ? `<div class="rec-section-label">評估結果</div><div class="record-summary">${escHtml(a.resultText || '')}${a.resultOutcome==='counseling' ? `（進入諮商輔導流程${a.resultCounselorName?`，主責輔導人員：${escHtml(a.resultCounselorName)}`:''}）` : a.resultOutcome==='noCase' ? '（不開案）' : ''}</div>` : ''}
      <div class="rec-section-label">填表人</div><div class="record-summary">${escHtml(fillerName)}${a.filledAt ? `　${escHtml((a.filledAt||'').replace('T',' ').slice(0,16))}` : ''}</div>
    </div>`;
    const foldView = `<div class="rec-fold-view">
      ${a.resultText ? `<div class="record-summary rec-summary-clamp">${escHtml(a.resultText)}</div>
      <div class="rec-fold-more"><span class="rec-dots">……</span><button class="rec-more-btn" onclick="toggleRecordExpand('${cardId}')">更多</button></div>` : ''}
    </div>`;
    return `
      <div class="record-card" id="rec-card-${cardId}">
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${cardId}')">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1;min-width:0;margin-right:10px;">
            <span class="record-date">📝 ${escHtml(aDate)}</span>
            <span class="badge" style="background:#fde8ef;color:#9d174d;border:1px solid #f9a8c9;font-size:.73rem;" data-tip="身心調適假之身心評估">身心狀態評估表</span>
            <span class="badge" style="background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0;font-size:.73rem;">BSRS ${_mlAssessBsrsTotal(a)} 分</span>
            ${suicideBadge}${outcomeBadge}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <div class="record-card-actions">${actions}</div>
            <button class="rec-toggle-btn" onclick="toggleRecordExpand('${cardId}')">展開 ▼</button>
          </div>
        </div>
        ${foldView}${fullView}
      </div>`;
  };

  // v179：聯繫歷程時間軸小卡（融入服務歷程主時間軸，見 _visibleMlContactsForTimeline）
  const renderMlContactTimelineCard = item => {
    const { leave: l, contact: ct } = item;
    const cardId = `mlc-tl-${escHtml(ct.id || (l.id + '-' + (ct.date||'')))}`;
    const timeLbl = ct.period || ((ct.timeStart || ct.timeEnd) ? `${ct.timeStart||''}–${ct.timeEnd||''}` : '');
    const targetLbl = escHtml(ct.target || '—') + (ct.targetNote ? `（${escHtml(ct.targetNote)}）` : '');
    return `
      <div class="record-card" id="rec-card-${cardId}">
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${cardId}')">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1;min-width:0;margin-right:10px;">
            <span class="record-date">☎ ${escHtml(ct.date || '—')}${timeLbl ? `　${escHtml(timeLbl)}` : ''}</span>
            <span class="badge" style="background:#e6fffa;color:#234e52;border:1px solid #81e6d9;font-size:.73rem;" data-tip="身心調適假窗口與學生／家屬等的聯繫紀錄">身心調適假聯繫</span>
            <span class="badge" style="background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0;font-size:.73rem;">${escHtml(ct.method || '—')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <button class="rec-toggle-btn" onclick="toggleRecordExpand('${cardId}')">展開 ▼</button>
          </div>
        </div>
        <div class="rec-fold-view">
          <div class="record-summary rec-summary-clamp">對象：${targetLbl}${ct.description ? `　${escHtml(ct.description)}` : ''}</div>
        </div>
        <div class="rec-full-view">
          <div class="rec-section-label">聯繫對象</div><div class="record-summary">${targetLbl}</div>
          ${ct.methodContent ? `<div class="rec-section-label">內容</div><div class="record-summary">${escHtml(ct.methodContent)}</div>` : ''}
          ${ct.description ? `<div class="rec-section-label">聯繫經過描述</div><div class="record-summary">${escHtml(ct.description)}</div>` : ''}
          ${ct.note ? `<div class="rec-section-label">備註</div><div class="record-summary">${escHtml(ct.note)}</div>` : ''}
          <div class="rec-section-label">記錄人</div><div class="record-summary">${escHtml(configData?.users?.[ct.by]?.name || ct.byName || ct.by || '—')}${ct.createdAt ? `　${escHtml((ct.createdAt||'').replace('T',' ').slice(0,16))}` : ''}</div>
        </div>
      </div>`;
  };

  // 排序後的記錄列表（含分頁；晤談紀錄、精神科評估、身心狀態評估表、身心調適假聯繫依日期合併排序）
  const _pendingRecs = visibleRecords.filter(r => r.status === 'pending').map(r => ({ type:'record', ref:r }));
  const _normalItems = [
    ...visibleRecords.filter(r => !r.deleted && r.status !== 'pending').map(r => ({ type:'record', date: r.date || (r.createdAt||'').slice(0,10), ref:r })),
    ..._visiblePsyForTimeline.map(pr => ({ type:'psychiatrist', date: pr.date || (pr.createdAt||'').slice(0,10), ref:pr })),
    ..._visibleMlAssessForTimeline.map(l => ({ type:'mlAssessment', date: l.assessment.evalDate || (l.assessment.filledAt||'').slice(0,10), ref:l })),
    ..._visibleMlContactsForTimeline.map(item => ({ type:'mlContact', date: item.contact.date || '', ref:item })),
  ];
  _normalItems.sort((a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da === db) return 0;
    return _recSortDesc ? (da < db ? 1 : -1) : (da < db ? -1 : 1);
  });
  const _deletedRecs = visibleRecords.filter(r => r.deleted).map(r => ({ type:'record', ref:r }));
  const sortedRecords = [..._pendingRecs, ..._normalItems, ..._deletedRecs];
  const totalRecCount = sortedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalRecCount / _recPageSize));
  if (_recPage > totalPages) _recPage = totalPages;
  const pagedRecords = sortedRecords.slice((_recPage - 1) * _recPageSize, _recPage * _recPageSize);

  const _pageSizeBtn = (n) =>
    `<button class="btn btn-secondary btn-sm${_recPageSize===n?' active':''}" style="font-size:.78rem;${_recPageSize===n?'background:#bee3f8;border-color:#90cdf4;':''}min-width:28px;"
      onclick="_recPageSize=${n};_recPage=1;localStorage.setItem('scc_rec_pagesize','${n}');syncUserPref_({recPageSize:${n}});showCaseDetail('${escHtml(c.id)}')">${n}</button>`;
  const paginationHtml = totalRecCount === 0 ? '' : `
    <div style="display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #f0f4f8;">
      <button class="btn btn-secondary btn-sm" style="font-size:.78rem;" ${_recPage<=1?'disabled':''} onclick="_recPage--;showCaseDetail('${escHtml(c.id)}')">◀</button>
      <span style="font-size:.82rem;color:#718096;">${_recPage} / ${totalPages}</span>
      <button class="btn btn-secondary btn-sm" style="font-size:.78rem;" ${_recPage>=totalPages?'disabled':''} onclick="_recPage++;showCaseDetail('${escHtml(c.id)}')">▶</button>
      <span style="font-size:.78rem;color:#a0aec0;margin-left:8px;">每頁：</span>
      ${[5,10,15].map(_pageSizeBtn).join('')}
      ${totalRecCount > _recPageSize ? `<span style="font-size:.78rem;color:#a0aec0;">（共 ${totalRecCount} 筆）</span>` : ''}
    </div>`;

  const recordCards = totalRecCount === 0
    ? `<div class="empty-state" style="padding:30px;"><div class="icon">📝</div><p>尚無服務歷程</p></div>`
    : pagedRecords.map(item => item.type === 'psychiatrist' ? renderPsyTimelineCard(item.ref) : item.type === 'mlAssessment' ? renderMlAssessTimelineCard(item.ref) : item.type === 'mlContact' ? renderMlContactTimelineCard(item.ref) : renderRecordCard(item.ref)).join('') + paginationHtml;

  // 學期 tab 已移至頁面頂部 detail-student-sem-nav，此處留空
  const _semTabsHtml = '';

  // 初次晤談獨立卡片（獨立於晤談紀錄列表，置於精神科評估之上）
  const iiCardHtml = (() => {
    if (caseIsDeleted) return _semTabsHtml;
    const ii = _getCaseII(c, _activeSem);
    const iiId = `ii-card-${escHtml(c.id)}`;
    const cid = escHtml(c.id);
    const _needsII = !ii || ii.deleted ||
      (ii.type !== 'continuation' && !(ii.type === 'linkedRecord' && ii.recordId) &&
       ii.type !== 'filled' && !ii.problemsMain?.length && !ii.summary && !ii.mainIssue);

    // 動作列（需填寫 / 已刪除時顯示）
    const _iiActionBtns = (showRestore) => _detailReadOnly ? '' : `
      <div id="ii-needs-buttons-${cid}" style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0 4px;">
        <button class="btn btn-primary btn-sm" onclick="openInitialInterviewPage('${cid}')">填寫</button>
        <button class="btn btn-secondary btn-sm" onclick="showIiContinuationPanel('${cid}')">舊案延續</button>
        <button class="btn btn-secondary btn-sm" onclick="pickRecordAsInitialInterview('${cid}')">採用現有紀錄</button>
        ${showRestore ? `<button class="btn btn-secondary btn-sm" onclick="restoreInitialInterview('${cid}')">復原已刪除之初次晤談表</button>` : ''}
      </div>
      <div id="ii-continuation-panel-${cid}" style="display:none;"></div>`;

    if (_needsII) {
      const isDeleted = ii?.deleted;
      const canRestore = isDeleted && (isAdminUser || ii.createdBy === currentUser?.email);
      const deletedBadge = isDeleted && canRestore
        ? `<div style="font-size:.8rem;color:#a0aec0;margin-bottom:6px;">（已刪除 by ${escHtml(ii.deletedByName||ii.deletedBy||'—')}${isAdminUser ? '' : ''}）
           ${isAdminUser ? `<button class="btn btn-danger btn-sm" style="font-size:.75rem;margin-left:8px;" onclick="purgeInitialInterview('${cid}')" title="徹底移除">徹底移除</button>` : ''}</div>`
        : '';
      return _semTabsHtml + `
        <div class="record-card" id="${iiId}" style="border:1.5px dashed #f6c00b;background:#fffbeb;">
          <div style="padding:10px 16px 12px;">
            <span style="font-weight:700;color:#8a6d3b;">⚠ 初次晤談紀錄表（未填寫）</span>
            ${deletedBadge}
            ${_iiActionBtns(canRestore)}
          </div>
        </div>`;
    }
    if (!ii) return _semTabsHtml;
    if (ii.type === 'continuation') {
      return _semTabsHtml + `
        <div class="record-card" id="${iiId}" style="border:1.5px solid #c6f6d5;background:#f0fff4;">
          <div class="record-card-header">
            <span style="font-weight:700;color:#276749;">🗂 初次晤談紀錄表（舊案延續）</span>
            <button class="btn btn-secondary btn-sm" onclick="clearInitialInterviewMark('${cid}')" style="font-size:.78rem;">清除標記</button>
          </div>
          ${ii.note ? `<div style="padding:0 16px 10px;font-size:.85rem;color:#4a5568;">${escHtml(ii.note)}</div>` : ''}
        </div>`;
    }
    if (ii.type === 'linkedRecord') {
      const lr = (c.records || []).find(x => x.id === ii.recordId);
      const lrFoldView = lr ? `
        <div class="rec-fold-view" style="padding:4px 16px 10px;font-size:.85rem;color:#4a5568;">
          <div style="margin-bottom:3px;"><span style="font-size:.78rem;color:#a0aec0;">晤談日期：</span>${escHtml(lr.date||'—')} ${escHtml(lr.time||'')}</div>
          <div><span style="font-size:.78rem;color:#a0aec0;">晤談者：</span>${escHtml(lr.counselorName||lr.counselorEmail||'—')}</div>
        </div>` : '';
      const lrFullView = lr ? `
        <div class="rec-full-view" style="padding:4px 16px 12px;font-size:.85rem;color:#4a5568;border-top:1px solid #bee3f8;">
          <div style="margin-bottom:4px;"><span style="font-size:.78rem;color:#a0aec0;">晤談日期：</span>${escHtml(lr.date||'—')} ${escHtml(lr.time||'')}</div>
          <div style="margin-bottom:4px;"><span style="font-size:.78rem;color:#a0aec0;">晤談者：</span>${escHtml(lr.counselorName||lr.counselorEmail||'—')}</div>
          ${lr.topics?.length ? `<div style="margin-bottom:4px;"><span style="font-size:.78rem;color:#a0aec0;">主題：</span>${lr.topics.map(t=>`<span class="badge badge-gray" style="margin-right:3px;">${escHtml(t)}</span>`).join('')}</div>` : ''}
          ${lr.summary ? `<div style="margin-bottom:4px;"><span style="font-size:.78rem;color:#a0aec0;">摘要：</span><div style="margin-top:3px;">${renderMaybeHtml(lr.summary)}</div></div>` : ''}
          ${lr.assessment ? `<div style="margin-bottom:4px;"><span style="font-size:.78rem;color:#a0aec0;">問題評估：</span><div style="margin-top:3px;">${renderMaybeHtml(lr.assessment)}</div></div>` : ''}
          ${lr.nextPlan ? `<div><span style="font-size:.78rem;color:#a0aec0;">後續處遇計畫：</span><div style="margin-top:3px;">${renderMaybeHtml(lr.nextPlan)}</div></div>` : ''}
        </div>` : '';
      return _semTabsHtml + `
        <div class="record-card" id="${iiId}" style="border:1.5px solid #bee3f8;background:#ebf8ff;">
          <div class="record-card-header"${lr ? ` style="cursor:pointer;" onclick="_bannerToggle(event,'${iiId}')"` : ''}>
            <span style="font-weight:700;color:#2b6cb0;">🔗 初次晤談紀錄表（採用 ${escHtml(lr?.date || '某筆')} 晤談紀錄）</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-secondary btn-sm" onclick="clearInitialInterviewMark('${cid}')" style="font-size:.78rem;">清除標記</button>
              ${lr ? `<button class="rec-toggle-btn" onclick="toggleRecordExpand('${iiId}')">展開 ▼</button>` : ''}
            </div>
          </div>
          ${lrFoldView}${lrFullView}
        </div>`;
    }
    // 已填寫
    const probBadges = (ii.problemsMain || []).map(p => `<span class="badge badge-gray" style="margin-right:4px;">${escHtml(p)}</span>`).join('');
    const riskColor = ii.risk === '高' ? '#c53030' : ii.risk === '中' ? '#b7791f' : '#276749';
    const riskBadge = ii.risk ? `<span class="badge" style="background:#fff;border:1px solid ${riskColor};color:${riskColor};margin-left:6px;">風險：${escHtml(ii.risk)}</span>` : '';
    const foldContent = `
      <div class="rec-fold-view">
        <div style="margin-bottom:5px;">${probBadges}${riskBadge}</div>
        ${ii.mainIssue ? `<div class="record-summary rec-summary-clamp" style="color:#4a5568;">${renderMaybeHtml(ii.mainIssue)}</div>
        <div class="rec-fold-more"><span class="rec-dots">……</span><button class="rec-more-btn" onclick="toggleRecordExpand('${iiId}')">更多</button></div>` : ''}
      </div>`;
    const iiField = (label, val) => val
      ? `<div style="margin-bottom:8px;"><div style="font-size:.75rem;color:#a0aec0;margin-bottom:2px;">${escHtml(label)}</div><div style="font-size:.88rem;">${renderMaybeHtml(val)}</div></div>`
      : '';
    const fullContent = `
      <div class="rec-full-view">
        ${(ii.problemsMain||[]).length ? `<div style="margin-bottom:8px;"><span style="font-size:.75rem;color:#a0aec0;">問題評估：</span>${probBadges}${riskBadge}</div>` : ''}
        ${iiField('個案類型', ii.caseType)}
        ${ii.oldMainCounselor ? iiField('原主責輔導人員', formatCounselorLabel(ii.oldMainCounselor)||ii.oldMainCounselor) : ''}
        ${iiField('家庭背景', ii.family)}
        ${iiField('主訴問題', ii.mainIssue)}
        ${iiField('問題摘要', ii.summary)}
        ${iiField('個案期待', ii.expectation)}
        ${iiField('風險描述', ii.riskDesc)}
        ${iiField('服務計畫', ii.plan)}
        ${(ii.serviceItems||ii.services||[]).length ? `<div style="margin-bottom:8px;"><span style="font-size:.75rem;color:#a0aec0;">服務項目：</span>${(ii.serviceItems||ii.services||[]).map(s=>`<span class="badge badge-gray" style="margin-right:4px;">${escHtml(s)}</span>`).join('')}</div>` : ''}
        ${iiField('主責輔導人員', ii.assignDecision === 'onetime' ? '一次性服務，不指派主責' : ii.assignDecision === 'defer' ? '暫不指派' : ii.resultCounselor ? (formatCounselorLabel(ii.resultCounselor)||ii.resultCounselor) : [ii.resultSW,ii.resultFullTime,ii.resultPartTime,ii.resultVol].filter(Boolean).join('　'))}
        ${iiField('備註', ii.notes || ii.attendees)}
        ${renderAttachChips(ii.attachments)}
        ${ii.updatedAt ? `<div style="font-size:.75rem;color:#a0aec0;margin-top:6px;">更新：${new Date(ii.updatedAt).toLocaleString('zh-TW')}</div>` : ''}
      </div>`;
    const iiIsCreator = ii.createdBy === currentUser?.email;
    const iiEditable = (!ii.createdAt || isEditable(ii.createdAt)) && !_detailReadOnly;
    const iiCanDelete = isAdminUser || (iiIsCreator && iiEditable);
    return _semTabsHtml + `
      <div class="record-card" id="${iiId}" style="border:1.5px solid #b2d8b2;background:#f6fbf6;">
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${iiId}')">
          <span style="font-weight:700;color:#276749;">📋 初次晤談紀錄表</span>
          ${ii.filledByName ? `<span style="background:#e9d8fd;color:#553c9a;border:1px solid #d6bcfa;border-radius:12px;padding:1px 8px;font-size:.74rem;">初談者：${escHtml(ii.filledByName)}</span>` : ''}
          <div style="display:flex;gap:6px;align-items:center;">
            ${iiEditable
              ? `<button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="openInitialInterviewPage('${cid}')">編輯</button>`
              : `<span style="font-size:.78rem;color:#a0aec0;">超過2週，不可編輯</span>`}
            <button class="btn btn-secondary btn-sm" style="font-size:.78rem;" onclick="printInitialInterview('${cid}')">列印</button>
            ${iiCanDelete && !caseIsDeleted && !_detailReadOnly ? `<button class="btn btn-danger btn-sm" style="font-size:.78rem;" onclick="deleteInitialInterview('${cid}')">刪除</button>` : ''}
            ${!_detailReadOnly ? `<button class="btn btn-secondary btn-sm" onclick="clearInitialInterviewMark('${cid}')" style="font-size:.78rem;">清除</button>` : ''}
            <button class="rec-toggle-btn" onclick="toggleRecordExpand('${iiId}')">展開 ▼</button>
          </div>
        </div>
        ${foldContent}${fullContent}
      </div>`;
  })();

  const sortLabel = _recSortDesc ? '新→舊' : '舊→新';
  const sortBtn = `<button class="btn btn-secondary btn-sm" style="font-size:.8rem;" onclick="_recSortDesc=!_recSortDesc;syncUserPref_({recSortDesc:_recSortDesc});showCaseDetail('${escHtml(c.id)}')">排序：${sortLabel}</button>`;
  const _semFilterBtn = (_hasRelated || (_csems && _csems.length > 1))
    ? `<select style="font-size:.8rem;padding:3px 8px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;cursor:pointer;" onchange="_setDetailSemFilter(this.value,'${escHtml(c.id)}')">
        <option value="current"${_detailSemFilter!=='all'?' selected':''}>本學期</option>
        <option value="all"${_detailSemFilter==='all'?' selected':''}>所有學期</option>
      </select>`
    : '';

  let countLabel, listContent;
  if (_detailSemFilter === 'all') {
    listContent = _buildAllSemTimeline(_relatedCases, caseId, isAdminUser);
    countLabel = '所有學期紀錄';
  } else {
    countLabel = (isAdminUser && deletedCount > 0
      ? `服務歷程（${activeCount} 筆，含 ${deletedCount} 筆已刪除）`
      : `服務歷程（${activeCount} 筆）`) + (_visiblePsyForTimeline.length ? `・含 ${_visiblePsyForTimeline.length} 筆精神科評估` : '');
    listContent = recordCards;
  }

  const recordsHtml = `
    <div class="card" id="detail-records-card" style="margin-bottom:20px;">
      <div class="card-header">
        <h3>${countLabel}</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${_semFilterBtn}
          ${sortBtn}
          ${_detailSemFilter !== 'all' && !caseIsDeleted && !_detailReadOnly ? (isActive
            ? `<button class="btn btn-primary" onclick="openNewRecordPage('${escHtml(c.id)}')">＋ 新增紀錄</button>
               <button class="btn btn-secondary btn-sm" onclick="openEventRecordForm('${escHtml(c.id)}', undefined, 'case-detail')">＋ 事件處理記錄</button>`
            : `<span style="font-size:.82rem;color:#718096;font-style:italic;padding:4px 0;">取消結案以新增記錄</span>`) : ''}
        </div>
      </div>
      <div style="padding:16px;">${listContent}</div>
    </div>`;

  const iiReminderHtml = '';

  // 精神科醫師評估區塊
  const psyHtml = (() => {
    const allPsy = (c.psychiatristRecords || []);
    const visiblePsy = allPsy.filter(pr => {
      if (_csems && _detailSemFilter !== 'all' && pr.date) {
        if (openDateToSemPrefix(pr.date) !== _semKeyBase(_activeSem)) return false;
      }
      if (!pr.deleted) return true;
      if (isAdminUser) return true;
      if (pr.createdBy === currentUser?.email) return true;
      return false;
    });
    const activeCount = allPsy.filter(pr => !pr.deleted).length;
    const deletedCount = allPsy.filter(pr => pr.deleted).length;
    const cards = visiblePsy.map(pr => {
      const isCreator = pr.createdBy === currentUser?.email;
      const psyEditable = (!pr.createdAt || isEditable(pr.createdAt)) && !_detailReadOnly;
      let btnHtml = '';
      if (!caseIsDeleted) {
        if (!pr.deleted) {
          btnHtml += psyEditable
            ? `<button class="btn btn-secondary btn-sm" onclick="openPsychiatristModal('${escHtml(c.id)}','${escHtml(pr.id)}')">編輯</button>`
            : `<span style="font-size:.78rem;color:#a0aec0;">超過2週，不可編輯</span>`;
          btnHtml += `<button class="btn btn-secondary btn-sm" onclick="printPsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')">列印</button>`;
          if (isAdminUser || (isCreator && psyEditable))
            btnHtml += `<button class="btn btn-danger btn-sm" onclick="deletePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')">刪除</button>`;
        } else if (isAdminUser) {
          btnHtml += `<button class="btn btn-secondary btn-sm" onclick="restorePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')">復原</button>`;
          btnHtml += `<button class="btn btn-danger btn-sm" onclick="purgePsychiatristRecord('${escHtml(c.id)}','${escHtml(pr.id)}')" title="徹底移除痕跡">徹底移除</button>`;
        }
      }
      const deletedBadge = pr.deleted ? `<span class="deleted-badge">已刪除 by ${escHtml(pr.deletedByName||pr.deletedBy||'—')}</span>` : '';
      const _psyDedId = `psy-ded-${escHtml(pr.id)}`;
      const _pf = _psyFillerInfo(pr);
      const foldView = `<div class="rec-fold-view">
        ${pr.recommendations ? `<div class="record-summary rec-summary-clamp" style="padding:8px 12px 0;">${renderMaybeHtml(pr.recommendations)}</div>
        <div class="rec-fold-more" style="padding:0 12px;"><span class="rec-dots">……</span><button class="rec-more-btn" onclick="toggleRecordExpand('${_psyDedId}')">更多</button></div>` : ''}
      </div>`;
      const fullView = `<div class="rec-full-view" style="padding:8px 12px;">
        ${pr.mainIssue ? `<div class="rec-section-label">主述與會談資料</div><div class="record-summary">${renderMaybeHtml(pr.mainIssue)}</div>` : ''}
        ${pr.coreAssessment ? `<div class="rec-section-label">核心問題之評估與判斷</div><div class="record-summary">${renderMaybeHtml(pr.coreAssessment)}</div>` : ''}
        ${pr.intervention ? `<div class="rec-section-label">介入處遇</div><div class="record-summary">${renderMaybeHtml(pr.intervention)}</div>` : ''}
        ${pr.recommendations ? `<div class="rec-section-label">給學生諮商中心的建議</div><div class="record-summary">${renderMaybeHtml(pr.recommendations)}</div>` : ''}
        ${pr.otherNotes ? `<div class="rec-section-label">其他注意事項</div><div class="record-summary">${renderMaybeHtml(pr.otherNotes)}</div>` : ''}
        ${!pr.deleted ? `<div class="rec-section-label">${escHtml(_pf.label)}</div><div class="record-summary">${escHtml(_pf.display)}</div>` : ''}
      </div>`;
      return `
      <div class="record-card${pr.deleted?' deleted':''}" id="${_psyDedId}" style="margin-bottom:10px;">
        <div class="record-card-header" style="cursor:pointer;" onclick="_bannerToggle(event,'${_psyDedId}')">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;">🩺 ${escHtml(pr.date||'—')}</span>
            ${pr.timeStart ? `<span style="color:#718096;font-size:.83rem;">${escHtml(pr.timeStart)}–${escHtml(pr.timeEnd||'')}</span>` : ''}
            ${pr.diagnosisType==='specific' ? `<span class="badge badge-orange">${escHtml(pr.diagnosisName||'確診')}</span>` : ''}
            ${pr.medicationAdvice==='yes' ? '<span class="badge badge-red">建議藥物</span>' : ''}
            ${pr.hospitalizationAdvice==='yes' ? '<span class="badge badge-red">建議住院</span>' : ''}
            ${deletedBadge}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">${btnHtml}<button class="rec-toggle-btn" onclick="toggleRecordExpand('${_psyDedId}')">展開 ▼</button></div>
        </div>
        ${foldView}${fullView}
        ${renderAttachChips(pr.attachments)}
      </div>`;
    }).join('');
    const addBtn = (!caseIsDeleted && !_detailReadOnly) ? `<button class="btn btn-primary" onclick="openPsychiatristModal('${escHtml(c.id)}')">＋ 新增評估</button>` : '';
    const countLabel = isAdminUser && deletedCount > 0
      ? `精神科醫師評估（${activeCount} 筆，含 ${deletedCount} 筆已刪除）`
      : `精神科醫師評估（${activeCount} 筆）`;
    const emptyMsg = activeCount === 0 && deletedCount === 0 ? '<div style="color:#718096;font-size:.88rem;padding:8px 0;">尚無精神科評估紀錄</div>' : '';
    return mkSection('psychiatrist', countLabel,
      `<div style="margin-bottom:10px;">${addBtn}</div><div>${emptyMsg}${cards}</div>`);
  })();

  // 結案/學期評估：合併單一卡片，依填表時間排序，歷程淡化呈現
  const evalHtml = (() => {
    const allEvals = c.semesterEvaluations || [];
    const semEvals = allEvals.filter(e => !_activeSem || _semKeyBase(e.semester) === _semKeyBase(_activeSem));
    const hasAnyTyped = allEvals.some(e => !e.deletedAt && !e.replacedBy);
    let displayEvals = [...semEvals];
    if (!hasAnyTyped && c.closureEvaluation) {
      const legSem = c.closureEvaluation.semester || _activeSem;
      if (!_activeSem || _semKeyBase(legSem) === _semKeyBase(_activeSem))
        displayEvals = [{ ...c.closureEvaluation, _isLegacy: true, type: c.closureEvaluation.type || 'closure' }];
    }
    if (!displayEvals.length) return '';
    // 依填表時間降冪（最新在前）
    displayEvals.sort((a, b) => (b.evaluatedAt||'').localeCompare(a.evaluatedAt||''));
    const lightMap = { '紅燈':'light-red','橙燈':'light-orange','黃燈':'light-yellow','綠燈':'light-green' };
    let firstActive = true;
    const cards = displayEvals.map(ev => {
      const isActive = !ev.deletedAt && !ev.replacedBy;
      const isOpen = isActive && firstActive;
      if (isActive) firstActive = false;
      const isClosure = (ev.type || 'closure') === 'closure';
      const typeLabel = isClosure ? '結案評估' : '學期評估';
      const typeStyle = isClosure
        ? 'background:#fde8e8;color:#c0392b;border:1px solid #fc8181;'
        : 'background:#e9d8fd;color:#553c9a;border:1px solid #b794f4;';
      const safeId = ((ev.evalId || (ev._isLegacy ? '_legacy_' : '_noid_' + (ev.evaluatedAt||'')))).replace(/[^a-zA-Z0-9_]/g,'_');
      const lightVal = ev.light || ev.statusLight || '';
      const evalDate = ev.evaluatedAt ? ev.evaluatedAt.slice(0,10) : '—';
      const _cdLabel = (ev.type||'closure') === 'closure' ? '結案' : '評估';
      const closureDateBadge = ev.closureDate ? `<span style="font-size:.72rem;color:#718096;background:#f0f4f8;border-radius:3px;padding:1px 5px;">${_cdLabel} ${ev.closureDate}</span>` : '';
      let statusTag = '', actionBtn = '';
      if (ev.deletedAt) {
        statusTag = `<span style="background:#fde8e8;color:#c53030;border-radius:4px;padding:1px 5px;font-size:.72rem;">已刪除 ${ev.deletedAt.slice(0,10)}</span>`;
        if (ev.evalId && !_detailReadOnly) actionBtn = `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();restoreDeletedEval('${escHtml(cid)}','${escHtml(ev.evalId)}')" style="font-size:.72rem;padding:2px 7px;">還原</button>`;
      } else if (ev.replacedBy) {
        statusTag = `<span style="background:#e2e8f0;color:#718096;border-radius:4px;padding:1px 5px;font-size:.72rem;">已取代</span>`;
      } else if (ev.evalId && !ev._isLegacy) {
        actionBtn = `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();printClosureEval('${escHtml(cid)}',null,null,'${escHtml(ev.evalId)}')" style="font-size:.72rem;padding:2px 7px;">列印</button>` +
        (_detailReadOnly ? '' : `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openClosureEvalPage('${escHtml(cid)}','${ev.type||'closure'}','${escHtml(ev.evalId)}')" style="font-size:.72rem;padding:2px 7px;">編輯</button>
<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();softDeleteEval('${escHtml(cid)}','${escHtml(ev.evalId)}')" style="font-size:.72rem;padding:2px 7px;color:#c53030;border-color:#fc8181;">刪除</button>`);
      }
      const opacity = isActive ? '' : 'opacity:.6;';
      const borderColor = isActive ? (isClosure ? '#bee3f8' : '#d6bcfa') : '#e2e8f0';
      const bannerBg = isActive ? (isClosure ? '#ebf8ff' : '#faf5ff') : '#f9fafb';
      const _dvBadge = lvl => ['1','低'].includes(lvl)?'badge-green':['2','3','中'].includes(lvl)?'badge-orange':'';
      const _dvStyle = lvl => ['4','5','高'].includes(lvl)?'background:#fde8e8;color:#c0392b;border-color:#fc8181;':lvl==='無'||lvl==='不清楚'?'background:#f0f4f8;color:#718096;border-color:#cbd5e0;':'';
      const dimRows = (ev.dimensions||[]).map(d =>
        `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f4f8;font-size:.84rem;">
          <span style="color:#4a5568;">${escHtml(d.label)}</span>
          <span class="badge ${_dvBadge(d.level)}" style="${_dvStyle(d.level)}">${escHtml(d.level)}</span>
        </div>`).join('');
      const body = `
        <div style="margin-bottom:10px;">${dimRows}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;">
          <div><span style="font-size:.78rem;color:#a0aec0;">狀態評估</span><br>
            <span class="badge ${lightMap[lightVal]||'badge-gray'}">${escHtml(lightVal||'—')}</span></div>
          ${ev.lightDescription ? `<div><span style="font-size:.78rem;color:#a0aec0;">狀態說明</span><br>
            <span style="font-size:.88rem;">${escHtml(ev.lightDescription)}</span></div>` : ''}
          ${ev.closureReason ? `<div><span style="font-size:.78rem;color:#a0aec0;">結案原因</span><br>
            <span style="font-size:.88rem;">${escHtml(ev.closureReason)}</span></div>` : ''}
          ${ev.closureDate ? `<div><span style="font-size:.78rem;color:#a0aec0;">結案日期</span><br>
            <span style="font-size:.88rem;">${escHtml(ev.closureDate)}</span></div>` : ''}
          ${ev.followup ? (() => {
            const fp = ev.followup;
            let label;
            if (fp === 'self') label = '原主責續接';
            else if (fp?.startsWith('transfer:')) {
              const email = fp.slice(9);
              const name = configData?.users?.[email]?.name || email;
              label = `內部轉案 → ${name}`;
            } else label = fp;
            return `<div><span style="font-size:.78rem;color:#a0aec0;">後續安排</span><br><span style="font-size:.88rem;">${escHtml(label)}</span></div>`;
          })() : ''}
          <div><span style="font-size:.78rem;color:#a0aec0;">填表人</span><br>
            <span style="font-size:.88rem;">${escHtml(ev.evaluatorName||ev.evaluatorEmail||'—')}</span></div>
        </div>
        ${ev.chiefComplaint ? `<div style="margin-top:10px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">個案主訴問題</div>
          <div style="font-size:.88rem;">${renderMaybeHtml(ev.chiefComplaint)}</div></div>` : ''}
        ${ev.assessment ? `<div style="margin-top:8px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">評估</div>
          <div style="font-size:.88rem;">${renderMaybeHtml(ev.assessment)}</div></div>` : ''}
        ${ev.treatmentProvided ? `<div style="margin-top:8px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">已提供之輔導處遇</div>
          <div style="font-size:.88rem;">${renderMaybeHtml(ev.treatmentProvided)}</div></div>` : ''}
        ${ev.description ? `<div style="margin-top:10px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">質性描述</div>
          <div style="font-size:.88rem;">${renderMaybeHtml(ev.description)}</div></div>` : ''}
        `;
      return `<div style="border:1px solid ${borderColor};border-radius:8px;margin-bottom:8px;overflow:hidden;${opacity}">
        <div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:${bannerBg};cursor:pointer;" onclick="toggleEvalCard('${safeId}')">
          <span style="${typeStyle}border-radius:4px;padding:1px 6px;font-size:.72rem;font-weight:600;flex-shrink:0;">${typeLabel}</span>
          <span style="font-weight:600;font-size:.86rem;flex:1;${!isActive?'color:#a0aec0;':''}">${escHtml(ev.evaluatorName||ev.evaluatorEmail||typeLabel)}</span>
          <span style="font-size:.78rem;color:#a0aec0;">${evalDate}</span>
          ${closureDateBadge}
          <span class="badge ${lightMap[lightVal]||'badge-gray'}" style="font-size:.74rem;">${escHtml(lightVal||'—')}</span>
          ${statusTag}${actionBtn}
          <span id="evalcard-icon-${safeId}">${isOpen?'▲':'▶'}</span>
        </div>
        <div id="evalcard-body-${safeId}" style="${isOpen?'':'display:none;'}padding:10px 14px;">${body}</div>
      </div>`;
    }).join('');
    const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
      <button class="btn btn-secondary btn-sm" onclick="closeCaseConfirm('${escHtml(cid)}')">＋ 新增評估</button>
    </div>`;
    return mkSection('eval', '結案 / 學期評估', addBtn + cards);
  })();
  const semEvalHtml = '';
  const transferEvalHtml = '';
  const _teAllDiv = document.getElementById('detail-transfer-evals');
  if (_teAllDiv) _teAllDiv.innerHTML = _renderAllTransferEvalsCard(c, cid);
  const _mlLeavesDiv = document.getElementById('detail-ml-leaves');
  if (_mlLeavesDiv) _mlLeavesDiv.innerHTML = _renderCaseMlCard(c);

  if (_caseDetailMode === 'psychtest') {
    document.getElementById('detail-body').innerHTML = _renderPsychTestReport(c, _caseDetailPsychIdx);
  } else {
  // ── 個案管理員區段 HTML ──
  const _mgrEmails = _getManagersForCase(c.id);
  // 拆分手動個管與當然個管；同一人若兼有兩者 → 顯示手動 chip + 附註「亦為當然個管」
  const _autoMgrMapDetail = new Map();
  _getAutoManagersForCase(c.id).forEach(x => _autoMgrMapDetail.set(x.email, x.reason));
  const _manualMgrEmails = _mgrEmails.filter(e => (configData?.users?.[e]?.allowedCases || []).includes(c.id));
  const _autoOnlyEmails  = _mgrEmails.filter(e => !_manualMgrEmails.includes(e) && _autoMgrMapDetail.has(e));
  // 初談者：權限等同個管員，但獨立顯示為綠色 chips（排除主責及已列為個管者，避免重複）
  const _iiEmailsDetail = _getInitialInterviewersForCase(c).filter(e => e && e !== c.counselorEmail && !_mgrEmails.includes(e));
  const _mgrNonSet = new Set(
    Object.entries(configData?.users || {})
      .filter(([email, info]) => !_mgrEmails.includes(email) && email !== c.counselorEmail && info.role && info.role !== '系統管理者')
      .map(([email]) => email)
  );
  const _mgrChips = _manualMgrEmails.length
    ? _manualMgrEmails.map(email => {
        const _mSems = configData?.users?.[email]?.allowedCasesSems?.[c.id];
        const _semTag = _mSems?.length
          ? `<span style="font-size:.73rem;color:#2b6cb0;background:#bee3f8;border-radius:8px;padding:1px 5px;margin-left:3px;white-space:nowrap;">${_mSems.map(s => escHtml(semesterLabel(s))).join('、')}</span>`
          : `<span style="font-size:.73rem;color:#718096;margin-left:3px;">所有學期</span>`;
        const _autoNote = _autoMgrMapDetail.has(email)
          ? `<span style="font-size:.7rem;color:#553c9a;background:#e9d8fd;border-radius:6px;padding:1px 5px;margin-left:3px;" data-tip="亦是當然個管：${escHtml(_autoMgrMapDetail.get(email).label + ' · ' + _autoMgrMapDetail.get(email).supervisee)}">兼當然</span>`
          : '';
        return `<span style="display:inline-flex;align-items:center;gap:2px;background:#ebf5fb;border:1px solid #aed6f1;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;">
          ${escHtml(formatCounselorLabel(email))}${_semTag}${_autoNote}
          ${_canEditMgrs ? `<button onclick="removeCaseManager('${escHtml(c.id)}','${escHtml(email)}')" style="border:none;background:none;cursor:pointer;color:#718096;font-size:.9rem;padding:0 0 0 4px;line-height:1;">✕</button>` : ''}
        </span>`;
      }).join('')
    : '';
  const _autoChips = _autoOnlyEmails.map(email => {
    const reason = _autoMgrMapDetail.get(email) || { label: '當然個管', supervisee: '' };
    return `<span style="display:inline-flex;align-items:center;gap:2px;background:#faf5ff;border:1px solid #d6bcfa;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;color:#553c9a;" data-tip="當然個管（不可移除，依「督導/窗口 → 負責人員」設定推導；解除後即失效）">
      ${escHtml(formatCounselorLabel(email))}
      <span style="font-size:.72rem;color:#553c9a;background:#e9d8fd;border-radius:8px;padding:1px 5px;margin-left:3px;">${escHtml(reason.label)}${reason.supervisee?` · ${escHtml(reason.supervisee)}`:''}</span>
    </span>`;
  }).join('');
  const _mgrChipsAll = (_mgrChips + _autoChips) || `<span style="color:#718096;font-size:.85rem;">尚未指定</span>`;
  const _iiChips = _iiEmailsDetail.length
    ? _iiEmailsDetail.map(email =>
        `<span style="display:inline-flex;align-items:center;gap:2px;background:#e6ffed;border:1px solid #86efac;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;color:#276749;" data-tip="初次晤談者，權限與個案管理員相同（不可移除，依初次晤談紀錄自動判定）">
          ${escHtml(formatCounselorLabel(email))}
          <span style="font-size:.72rem;color:#276749;background:#d4edda;border-radius:8px;padding:1px 5px;margin-left:3px;">初談者</span>
        </span>`
      ).join('')
    : '';
  const _mgrAddOpts = buildCounselorOptgroups(([email]) => _mgrNonSet.has(email), '— 選擇輔導人員 —');
  const _mgrHasMulSems = _csems && _csems.length > 1;
  const _mgrSemOpts = _mgrHasMulSems
    ? `<select id="cm-sem-scope" class="field-select" style="max-width:160px;" data-tip="選擇此管理員可閱覽的學期範圍。「所有學期」表示不限制。">
        <option value="all">所有學期</option>
        ${[...(_csems||[])].map(s => `<option value="${escHtml(s)}"${s===_activeSem?' selected':''}>${escHtml(semesterLabel(s))}</option>`).join('')}
      </select>` : '';
  const _mgrEditSection = _canEditMgrs
    ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">個案管理員
          <span style="font-size:.75rem;font-weight:400;color:#718096;">（可閱讀此個案紀錄的輔導人員，主責以外）</span>
        </div>
        <div style="margin-bottom:8px;">${_mgrChipsAll}${_iiChips}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="cm-add-select" class="field-select" style="max-width:200px;">${_mgrAddOpts}</select>
          ${_mgrSemOpts}
          <button class="btn btn-secondary btn-sm" onclick="addCaseManagerInDetail('${escHtml(caseId)}')">新增</button>
        </div>
      </div>`
    : (_mgrEmails.length || _iiEmailsDetail.length
        ? `<div style="margin-top:10px;font-size:.82rem;color:#718096;">
            ${_mgrEmails.length ? `個案管理員：${_mgrEmails.map(e=>escHtml(formatCounselorLabel(e)||configData?.users?.[e]?.name||e)).join('、')}` : ''}
            ${_iiEmailsDetail.length ? `<div style="color:#276749;">初談者：${_iiEmailsDetail.map(e=>escHtml(formatCounselorLabel(e)||configData?.users?.[e]?.name||e)).join('、')}</div>` : ''}
          </div>`
        : '');

  document.getElementById('detail-body').innerHTML =
    mkSection('basic', '個案基本資料', `<div class="form-grid">
      ${field('開案日期', adToRocDisplay(_cd('openDate')))}
      ${field('法定性別', _cd('legalGender'))}
      ${field('性別認同', _cd('genderIdentity') || '（未填）')}
      ${field('學號', _cd('studentId'))}
      ${field('生日', adToRocDisplay(_cd('birthday')))}
      ${field('身分證字號／居留證號', _cd('idNumber'))}
    </div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="font-weight:600;font-size:.88rem;" data-tip="變更主責後需至待辦頁確認，確認後才會正式轉移。">主責輔導人員：</label>
      <select id="detail-counselor-sel" class="field-select" style="max-width:240px;" data-tip="選擇新主責輔導人員，儲存後建立轉案待辦。">
        ${buildCounselorOptgroups()}
      </select>
      <button class="btn btn-primary btn-sm" onclick="_detailChangeCounselor('${escHtml(caseId)}')" data-tip="點選後將建立轉案待辦，需至待辦頁確認後才會正式變更主責。">儲存變更</button>
    </div>
    ${_mgrEditSection}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:.82rem;color:#4a5568;"${
      _abTypeHistoryIsLegacy(c) ? ` data-tip="${escHtml('此處顯示 A/B 案的設定與轉換時間紀錄；本案建立於此功能上線前，未留存設定時間戳記與設定者。日後若變更案別，將自動記錄並顯示如：115.04.25 開案設定 B 案，115.09.20 轉為 A 案（陳幸只）')}"` : ''
    }><strong>案別紀錄：</strong>${escHtml(_abTypeHistoryLine(c))}</div>`) +
    mkSection('bg', '背景資料', `<div class="form-grid">
      ${_cd('abType') ? field('案別', _cd('abType') + (_cd('abType') === 'B案' && Array.isArray(_cd('bCaseReasons')) && _cd('bCaseReasons').length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${_cd('bCaseReasons').map(r => `<span style="display:inline-block;background:#fffaf0;color:#7c2d12;border:1px solid #fbd38d;border-radius:10px;padding:1px 8px;font-size:.75rem;">${escHtml(r)}</span>`).join('')}</div>` : '')) : ''}
      ${field('對象類別', _cd('caseType'))}
      ${field('國籍', natLabel)}
      ${field('族群', ethLabel)}
      ${field('學制', _cd('program'))}
      ${field('系所', _cd('department'))}
      ${field('年級／班別', [_cd('grade'), _cd('classNo')].filter(Boolean).join(' / ') || '—')}
      ${field('障礙類別', _cd('disability') || '無/未填寫')}
    </div>`) +
    mkSection('contact', '聯絡資料', `<div class="form-grid">
      ${field('聯絡電話', _cd('phone'))}
      ${_cd('email') ? field('電子郵件', _cd('email')) : ''}
      ${field('住所類型', _cd('residence'))}
      ${field('宿舍樓層／地址', _cd('address') || '無/未填寫')}
      ${field('緊急聯絡人', _cd('emergencyName'))}
      ${field('緊急聯絡電話', _cd('emergencyPhone'))}
      ${field('與個案關係', _cd('emergencyRelation'))}
    </div>`) +
    (() => {
      const _bsrs = _cd('bsrs'); const _bsrsTotal = _cd('bsrsTotal'); const _bsrs6 = _cd('bsrs6');
      const scoreLabel = v => (['完全沒有','輕微','有時如此','常常如此','幾乎每天'][v] ?? '—');
      const qLabels = ['睡眠困擾','感覺緊張不安','覺得容易苦惱或動怒','感覺憂鬱、心情低落','覺得比不上別人或自己沒有用'];
      const hasIndividual = (_bsrs||[]).some(v=>v!==null&&v!==undefined);
      const alertRow = (info) => `<div class="full"><div style="padding:7px 10px;border-left:3px solid ${info.border};background:${info.bg};color:${info.color};font-size:.84rem;border-radius:0 4px 4px 0;">${info.msg}</div></div>`;
      // v181：畫面依紙本顯示序（回應 #037），讀值仍用 storageIdx 對回原本的儲存索引，語意不變
      const individualRows = hasIndividual
        ? _bsrsOrderedLabels(qLabels).map(({label,storageIdx},displayIdx)=>{ const v=(_bsrs||[])[storageIdx]; return field(`${displayIdx+1}. ${label}`, v!==null&&v!==undefined?`${v} ${scoreLabel(v)}`:'—'); }).join('')
        : '';
      const q6score = _bsrs6 !== null && _bsrs6 !== undefined ? _bsrs6 : null;
      const q6Row = field('6. 有自殺的想法', q6score !== null ? `${q6score} ${scoreLabel(q6score)}` : '未填');
      // #10-BSRS：完整填寫＝(1)-(5)題＋自殺意念題皆有值，缺一即視為未完整填寫
      const isComplete = [0,1,2,3,4].every(i => (_bsrs||[])[i] !== null && (_bsrs||[])[i] !== undefined)
        && q6score !== null;
      let bodyHtml, cardStyle;
      if (!isComplete) {
        // 未完整填寫（含全空、確認未填、只填部分題項）：不顯示評估文字（此時的分數/評估無意義），卡片以醒目的琥珀色標示待補
        cardStyle = 'background:#fffbeb;border:2px solid #f6ad55;';
        const _unfilledNote = _cd('bsrsUnfilled') ? '（已勾選「個案未填寫 BSRS」確認）' : '';
        bodyHtml = `<div style="padding:8px 10px;margin-bottom:12px;background:#fef3c7;border:1px solid #f6ad55;color:#7c2d12;font-size:.85rem;font-weight:700;border-radius:6px;">⚠ 未完整填寫${_unfilledNote}：尚未提供困擾程度評估</div>
        <div class="form-grid">${individualRows}${q6Row}</div>`;
      } else {
        const levelInfo = bsrsLevelInfo(_bsrsTotal);
        cardStyle = `background:${levelInfo.bg};border:2px solid ${levelInfo.border};`;
        const totalRow = field('總困擾分數（第1–5題）', _bsrsTotal+' 分') + alertRow(levelInfo);
        const q6AlertRow = q6score > 0 ? alertRow(bsrs6AlertInfo(q6score)) : '';
        bodyHtml = `<div class="form-grid">${individualRows}${totalRow}${q6Row}${q6AlertRow}</div>`;
      }
      return mkSection('bsrs','BSRS-5 心理困擾量表', bodyHtml, true, cardStyle);
    })() +
    mkSection('intake', '來談資訊', `<div class="form-grid">
      ${field('來源', _cd('source'))}
      ${field('過去紀錄', pastLabel)}
      ${field('主訴問題', (_cd('topics') || []).join('、') || '—')}
    </div>`) +
    transferEvalHtml +
    evalHtml +
    semEvalHtml +
    (_detailSemFilter !== 'all' && iiCardHtml ? `<div style="margin-bottom:20px;">${iiCardHtml}</div>` : '') +
    (_detailSemFilter !== 'all' ? psyHtml : '') +
    _buildMentalLeaveDetailCard(c) +
    recordsHtml;
  const _detSel = document.getElementById('detail-counselor-sel');
  if (_detSel) _detSel.value = c.counselorEmail || '';
  } // end psychtest mode else

  const _testResults = c.psychTestResults || [];
  const _testChipsHtml = _testResults.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px;background:#fef3c7;border:1px solid #f6d860;border-radius:8px;margin-bottom:6px;align-items:center;">
        <span style="font-size:.8rem;color:#92600a;font-weight:600;white-space:nowrap;">心理測驗結果報告：</span>
        ${_testResults.map((t, i) => {
          const isAct = _caseDetailMode === 'psychtest' && _caseDetailPsychIdx === i;
          return `<button onclick="_switchCasePsychTest(${i},'${escHtml(c.id)}')"
            style="padding:4px 14px;border-radius:16px;border:1px solid ${isAct?'#d97706':'#f6d860'};
                   background:${isAct?'#fef3c7':'#fffbeb'};color:${isAct?'#92600a':'#78350f'};
                   font-size:.82rem;font-weight:${isAct?'700':'400'};cursor:pointer;white-space:nowrap;">
            ${escHtml(semesterLabel(t.testSemester) || t.testSemester || `第${i+1}次`)}
          </button>`;
        }).join('')}
      </div>`
    : '';

  if (_csems && _csems.length > 1) {
    // 同案號多學期：在頂部顯示學期 TAB
    const nav = document.getElementById('detail-student-sem-nav');
    if (nav) {
      const _isHistSem = _caseDetailMode === 'semester' && _activeSem !== _csems[_csems.length - 1];
      nav.style.display = '';
      nav.innerHTML = _testChipsHtml +
        `<div style="padding:10px 14px;background:${_isHistSem?'#fffbeb':'#f7fafc'};border:1px solid ${_isHistSem?'#f6ad55':'#e2e8f0'};border-radius:8px;align-items:center;margin-bottom:${_isHistSem?'4':'14'}px;">
          <div style="display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;align-items:center;scrollbar-width:thin;padding-bottom:4px;"
               onwheel="this.scrollLeft+=event.deltaY*0.7;event.preventDefault();">
          <span style="font-size:.8rem;color:#718096;font-weight:600;white-space:nowrap;flex-shrink:0;">學期：</span>
          ${_csems.map(s => {
            const isAct = _caseDetailMode === 'semester' && s === _activeSem;
            const _ls = _semLightStyle(c, s);
            // 學期存取限制：僅限管理員（非主任/主責）且有學期限制者
            const _myEmail = currentUser?.email;
            const _isMgrOnly = !isAdminUser && c.counselorEmail !== _myEmail;
            const _semLocked = _isMgrOnly && _hasManagerAccess(_myEmail, c.id)
              && !_hasManagerAccess(_myEmail, c.id, s);
            return _semLocked
              ? `<button disabled data-tip="您沒有 ${escHtml(semesterLabel(s))} 學期的閱覽權限。"
                  style="padding:4px 14px;border-radius:16px;border:1px solid #cbd5e0;
                         background:#f7fafc;color:#a0aec0;font-size:.82rem;
                         cursor:not-allowed;white-space:nowrap;opacity:.6;">
                  🔒 ${escHtml(semesterLabel(s))}
                </button>`
              : `<button onclick="_switchCaseSem('${escHtml(s)}','${escHtml(c.id)}')"
                  style="padding:4px 14px;border-radius:16px;
                         border:${isAct?`2.5px solid ${_ls.border}`:`1px solid ${_ls.border}`};
                         background:${_ls.bg};color:${_ls.color};
                         font-size:.82rem;font-weight:${isAct?'700':'500'};cursor:pointer;white-space:nowrap;
                         ${isAct?`filter:brightness(0.88);box-shadow:0 0 0 1px ${_ls.border};`:''}">
                  ${escHtml(semesterLabel(s))}
                </button>`;
          }).join('')}
          </div>
        </div>
        ${_isHistSem ? `<div style="background:#fffbeb;border:1px solid #f6ad55;color:#744210;border-radius:6px;padding:6px 14px;margin-bottom:14px;font-size:.82rem;">⚠ 目前顯示 <strong>${escHtml(semesterLabel(_activeSem))}</strong> 的歷史版本基本資料</div>` : ''}`;
    }
  } else {
    _renderStudentSemNav(caseId, _relatedCases);
    if (_testChipsHtml) {
      const nav = document.getElementById('detail-student-sem-nav');
      if (nav) { nav.style.display = ''; nav.innerHTML = _testChipsHtml + nav.innerHTML; }
    }
  }

  // Restore per-case section collapse states
  const _secKey = `scc_sec_${currentUser?.email||''}_${caseId}`;
  try {
    const _secState = JSON.parse(localStorage.getItem(_secKey) || '{}');
    Object.entries(_secState).forEach(([id, collapsed]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('collapsed', !!collapsed);
    });
  } catch (_) {}

  showPage('page-case-detail', null);
  _setupDetailViewAudit(caseId); // #9c/#10：敏感查閱時記錄進入＋捲動看到的區塊
}

function _detailChangeCounselor(caseId) {
  const sel = document.getElementById('detail-counselor-sel');
  const newEmail = sel?.value || '';
  if (!newEmail) { alert('請先選擇主責輔導人員。'); return; }
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  if (newEmail === (c.counselorEmail || '')) { showToast('主責未變更。', 'info'); return; }
  _showCounselorChangeConfirm(caseId, newEmail, c);
}

function _showCounselorChangeConfirm(caseId, newEmail, c) {
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  const caseName = c.name || caseId;
  const sem = _caseDetailActiveSem;
  const semLine = sem ? `<p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">學期：<strong>${escHtml(semesterLabel(sem))}</strong></p>` : '';
  const canDirect = currentRole === '主任' || extraRole === '管理者' || extraRole === '個案管理員';
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'counselor-change-confirm-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><h3>確認變更主責輔導人員</h3></div>
      <div class="modal-body" style="padding:12px 0 16px;">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">個案：<strong>${escHtml(caseName)}（${escHtml(caseId)}）</strong></p>
        ${semLine}
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:14px;">將主責改為：<strong style="color:#3182ce;">${escHtml(newName)}</strong></p>
        <div style="background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;padding:10px 12px;font-size:.82rem;color:#2b6cb0;">
          確定後，系統將在您的待辦事項建立「內部轉案」任務。<br>
          請至待辦事項頁面確認後執行。
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('counselor-change-confirm-modal').remove()">取消</button>
        ${canDirect ? `<button class="btn btn-warning" onclick="document.getElementById('counselor-change-confirm-modal').remove();_directChangeCounselor('${escHtml(caseId)}','${escHtml(newEmail)}','${escHtml(sem||'')}')">直接轉派</button>` : ''}
        <button class="btn btn-primary" onclick="document.getElementById('counselor-change-confirm-modal').remove();_doDetailChangeCounselor('${escHtml(caseId)}','${escHtml(newEmail)}','${escHtml(sem||'')}')">確定，建立待辦</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _doDetailChangeCounselor(caseId, newEmail, semester) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  _putTodoItem({
    id: _genTodoId(), type: 'internal_transfer',
    label: `內部轉案派案：${c.name}（${caseId}）`,
    caseId, caseLabel: `${c.name}（${caseId}）`,
    assignedCounselor: newEmail,
    assignedCounselorName: newName,
    fromCounselor: currentUser.email,
    fromCounselorName: configData?.users?.[currentUser.email]?.name || currentUser.name,
    semester: semester || undefined,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    done: false, notifRead: false,
  });
  saveUserTodos().catch(() => {});
  showToast('已建立轉案待辦，請至待辦頁確認後執行。', 'success');
}

async function _directChangeCounselor(caseId, newEmail, semester) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  const oldName = configData?.users?.[c.counselorEmail]?.name || c.counselorEmail || '';
  // 只寫目標學期快照；目標為最新學期才動全案層級（#023 第二輪：改舊學期不得影響其他學期）
  _applyCounselorChange(c, semester, newEmail, newName);
  const semLabel = semester ? `（${semesterLabel(semester)}）` : '';
  const jobId = bgJobAdd(`直接轉派主責 → ${newName}`);
  try {
    await saveCasesChunks(caseId);
    auditLog('變更主責輔導人員（直接轉派）', caseId, null, `${oldName} → ${newName}（${newEmail}）${semLabel}`);
    bgJobDone(jobId);
    showToast(`已直接變更主責為 ${newName}${semLabel}`, 'success', 3000);
    showCaseDetail(caseId);
  } catch(e) {
    bgJobFail(jobId, e.message);
    showToast(`變更失敗：${e.message}`, 'error', 4000);
  }
}

function renderCaseManagersBody(c) {
  const allUsers = Object.entries(configData.users || {});
  const managers = allUsers.filter(([, info]) => (info.allowedCases || []).includes(c.id));
  const nonManagers = allUsers.filter(([email, info]) =>
    !(info.allowedCases || []).includes(c.id) && email !== c.counselorEmail
  );

  const chips = managers.length
    ? managers.map(([email]) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:#ebf5fb;border:1px solid #aed6f1;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;">
          ${escHtml(formatCounselorLabel(email))}
          <button onclick="removeCaseManager('${escHtml(c.id)}','${escHtml(email)}')"
            style="border:none;background:none;cursor:pointer;color:#718096;font-size:.9rem;padding:0 0 0 4px;line-height:1;">✕</button>
        </span>`).join('')
    : `<span style="color:#718096;font-size:.85rem;">尚未指定</span>`;

  const nonMgrSet = new Set(nonManagers.map(([email]) => email));
  /* COUNSELOR_SELECT_GROUP:cm-add-select */
  const options = buildCounselorOptgroups(([email]) => nonMgrSet.has(email), '— 選擇輔導人員 —');

  return `
    <div style="margin-bottom:10px;">${chips}</div>
    <div style="font-size:.78rem;color:#718096;margin-bottom:6px;">新增個案管理員：</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="cm-add-select" style="padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:.875rem;">${options}</select>
      <button class="btn btn-secondary" style="font-size:.85rem;" onclick="addCaseManager('${escHtml(c.id)}')">新增</button>
    </div>`;
}

async function addCaseManager(caseId) {
  const email = document.getElementById('cm-add-select').value;
  if (!email) return;
  const entry = configData.users[email] || {};
  entry.allowedCases = entry.allowedCases || [];
  if (!entry.allowedCases.includes(caseId)) entry.allowedCases.push(caseId);
  if (!entry.extraRole) entry.extraRole = '個案管理員';
  configData.users[email] = entry;
  const caseName = casesData.find(c => c.id === caseId)?.name || caseId;
  addNotificationToUser(email, 'assigned_manager', caseId, caseName);
  showLoading('儲存個案管理員…');
  const jobId = bgJobAdd(`新增個案管理員：${email}`);
  try {
    await Promise.all([_configCasesPatch([{ type: 'caseAccessUpsert', email, caseId }]), _flushNotifOps()]);
    bgJobDone(jobId);
    renderNotifBell();
    auditLog(`新增個案管理員 ${email}`, caseId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    bgJobFail(jobId, err.message);
    hideLoading();
    alert('儲存失敗：' + err.message + '\n請重新整理頁面確認實際狀態。');
  }
}

async function removeCaseManager(caseId, email) {
  const name = configData.users[email]?.name || email;
  if (!confirm(`確定移除「${name}」對此個案的管理員身分？`)) return;
  const entry = configData.users[email];
  if (!entry) return;
  entry.allowedCases = (entry.allowedCases || []).filter(id => id !== caseId);
  if (!entry.allowedCases.length) { delete entry.allowedCases; if (entry.extraRole === '個案管理員') delete entry.extraRole; }
  if (entry.allowedCasesSems) {
    delete entry.allowedCasesSems[caseId];
    if (!Object.keys(entry.allowedCasesSems).length) delete entry.allowedCasesSems;
  }
  const removedCaseName = casesData.find(c => c.id === caseId)?.name || caseId;
  addNotificationToUser(email, 'removed_manager', caseId, removedCaseName);
  showLoading('移除個案管理員…');
  const jobId = bgJobAdd(`移除個案管理員：${email}`);
  try {
    await Promise.all([_configCasesPatch([{ type: 'caseAccessRemove', email, caseId }]), _flushNotifOps()]);
    bgJobDone(jobId);
    auditLog(`移除個案管理員 ${email}`, caseId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    bgJobFail(jobId, err.message);
    hideLoading();
    alert('移除失敗：' + err.message + '\n請重新整理頁面確認實際狀態。');
  }
}

// ══════════════════════════════════════════════
//  個案管理員輔助函數
// ══════════════════════════════════════════════

function _hasManagerAccess(email, caseId, semPrefix) {
  const info = configData?.users?.[email];
  if (!info) return false;
  // 手動個管路徑
  if ((info.allowedCases || []).includes(caseId)) {
    const sems = info.allowedCasesSems?.[caseId];
    if (!sems || !semPrefix) return true;
    if (sems.includes(semPrefix)) return true;
    // 手動 allowedCases 存在但 sem 不在其範圍 → 落到派生路徑再檢一次（跨學期覆蓋）
  }
  // 派生路徑：督導/窗口對其 supervisee 的案有當然個管權
  if (_getAutoManagedCaseIds(email).has(caseId)) return true;
  return false;
}

function _getManagersForCase(caseId) {
  // 手動個管
  const manual = Object.entries(configData?.users || {})
    .filter(([email, info]) => (info?.allowedCases || []).includes(caseId))
    .map(([email]) => email);
  // 自動個管（去掉已在手動清單者，避免重複顯示；顯示端有需要另外標記）
  const autoOnly = _getAutoManagersForCase(caseId).map(x => x.email).filter(e => !manual.includes(e));
  return [...manual, ...autoOnly];
}

async function addCaseManagerInDetail(caseId) {
  const email = document.getElementById('cm-add-select')?.value;
  if (!email) { alert('請先選擇要新增的輔導人員。'); return; }
  const semScope = document.getElementById('cm-sem-scope')?.value || 'all';
  const entry = configData.users[email] || (configData.users[email] = {});
  entry.allowedCases = entry.allowedCases || [];
  if (!entry.allowedCases.includes(caseId)) {
    entry.allowedCases.push(caseId);
    if (!entry.extraRole) entry.extraRole = '個案管理員';
  }
  if (semScope !== 'all') {
    if (!entry.allowedCasesSems) entry.allowedCasesSems = {};
    entry.allowedCasesSems[caseId] = [...new Set([...(entry.allowedCasesSems[caseId] || []), semScope])];
  } else if (entry.allowedCasesSems?.[caseId]) {
    delete entry.allowedCasesSems[caseId];
    if (!Object.keys(entry.allowedCasesSems).length) delete entry.allowedCasesSems;
  }
  // 先 upsert 確保 caseId 在 allowedCases（caseAccessSemsSet 後端前提），再視 semScope 覆寫/清除範圍；
  // 兩個 op 同批送出，後端鎖內依序套用，semsSet 一定看得到同批 upsert 剛加入的 caseId。
  const ops = [{ type: 'caseAccessUpsert', email, caseId }];
  ops.push({ type: 'caseAccessSemsSet', email, caseId, sems: semScope !== 'all' ? entry.allowedCasesSems[caseId] : [] });
  const caseName = casesData.find(c => c.id === caseId)?.name || caseId;
  addNotificationToUser(email, 'assigned_manager', caseId, caseName);
  showLoading('儲存個案管理員…');
  const jobId = bgJobAdd(`新增個案管理員：${email}`);
  try {
    await Promise.all([_configCasesPatch(ops), _flushNotifOps()]);
    bgJobDone(jobId);
    renderNotifBell();
    auditLog(`新增個案管理員 ${email}`, caseId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    bgJobFail(jobId, err.message);
    hideLoading();
    alert('儲存失敗：' + err.message + '\n請重新整理頁面確認實際狀態。');
  }
}
