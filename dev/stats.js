// dev/stats.js — 統計分析頁模組（renderStats 與各統計 tab 狀態）（拆 index.html 絞殺者
// 第三十六刀，v283）。內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告。
// 可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  統計分析
// ══════════════════════════════════════════════
let _statsTab    = 'overview';
let _statsSvcSem = null;

async function renderStats() {
  // 統計頁需迭代所有 case 的 records/psychiatristRecords；補載入封存/舊學期完整資料
  await _ensureAllFullyLoaded('統計分析');
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  // 服務狀況／身心調適假／課程統計三分頁：主任／管理者／專任皆可用（原僅限主任／管理者）；
  // 統計分析頁本身維持全員可見不變，非上述身分僅能看「個案概況」（自己的個案）
  const canAdminTabs = isAdmin || (typeof currentRole === 'string' && currentRole.startsWith('專任'));
  const visible = isAdmin
    ? casesData
    : casesData.filter(c => c.counselorEmail === currentUser?.email);

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // Slice 4：雙指標——服務學生數（不重複個案記錄）與開案人次（依學期展開，含 #N 重複開案）。
  // overview 分頁本身無學期篩選 UI，故傳 null（= 全部學期）。
  const ovCounts     = _statCaseCounts(visible, null);
  const active       = visible.filter(c => c.status !== 'closed').length;
  const closed       = visible.filter(c => c.status === 'closed').length;
  const newThisMonth = visible.filter(c => (c.createdAt || '').slice(0, 7) === thisMonth).length;
  const totalSessions = visible.reduce(
    (sum, c) => sum + (c.records || []).filter(r => !r.deleted).length, 0);

  const countBy = (arr, key) => arr.reduce((m, c) => {
    const k = c[key] || '未填'; m[k] = (m[k] || 0) + 1; return m;
  }, {});
  const byType       = countBy(visible, 'caseType');
  const byCounselor  = countBy(visible, 'counselorName');

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const byMonth = Object.fromEntries(months.map(m => [m, 0]));
  visible.forEach(c => { const m = (c.createdAt || '').slice(0, 7); if (m in byMonth) byMonth[m]++; });

  const mkBar = (label, val, max, color) => {
    const pct = max ? Math.round(val / max * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="width:110px;font-size:.82rem;text-align:right;color:#4a5568;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(String(label))}">${escHtml(String(label))}</div>
      <div style="flex:1;background:#f0f4f8;border-radius:4px;overflow:hidden;height:18px;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;"></div>
      </div>
      <div style="width:24px;font-size:.82rem;font-weight:600;color:#2d3748;text-align:right;">${val}</div>
    </div>`;
  };

  const sortedEntries = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const typeMax       = Math.max(...Object.values(byType),      1);
  const counselorMax  = Math.max(...Object.values(byCounselor), 1);
  const monthMax      = Math.max(...Object.values(byMonth),     1);

  // ── 服務狀況統計 ──
  const roleGroups = {
    '專任輔導人員': new Set(['主任','專任社會工作師','專任諮商心理師','專任臨床心理師']),
    '兼任輔導人員': new Set(['兼任諮商心理師','兼任臨床心理師']),
    '精神科醫師':   new Set(['駐校精神科醫師']),
    '實習心理師':   new Set(['實習諮商心理師']),
    '義務輔導老師': new Set(['義務輔導老師']),
  };
  const emailToGroup = {};
  Object.entries(configData?.users || {}).forEach(([email, info]) => {
    for (const [grp, roles] of Object.entries(roleGroups)) {
      if (roles.has(info.role || '')) { emailToGroup[email] = grp; break; }
    }
  });
  const svcSemPrefixes = new Set();
  visible.forEach(c => (c.records || []).filter(r => !r.deleted).forEach(r => {
    const s = openDateToSemPrefix(r.date || ''); if (s) svcSemPrefixes.add(s);
  }));
  const svcSemList = [...svcSemPrefixes].sort().reverse();
  const svcDefaultSem = _statsSvcSem || svcSemList[0] || currentSemesterPrefix();
  // Build academic year and calendar year lists from svcSemPrefixes
  const _aYearSet = new Set(), _cYearSet = new Set();
  svcSemPrefixes.forEach(p => {
    _aYearSet.add(p.slice(0, -1));
    semesterMonths(p).forEach(m => _cYearSet.add(m.slice(0, 4)));
  });
  const aYearList = [..._aYearSet].sort().reverse();
  const cYearList = [..._cYearSet].sort().reverse();

  window._svcStatsVisible = visible;
  window._svcEmailToGroup = emailToGroup;
  window._renderSvcTable = (sem) => {
    const vis = window._svcStatsVisible;
    const e2g = window._svcEmailToGroup;
    const colKeys = ['總計', ...Object.keys(roleGroups), '電話關懷'];
    // Determine months array based on sem key prefix
    let mos;
    if (sem.startsWith('y_')) {
      const yr = sem.slice(2);
      mos = Array.from({length: 12}, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
    } else if (sem.startsWith('a_')) {
      const rocYr = sem.slice(2);
      mos = [...semesterMonths(rocYr + '1'), ...semesterMonths(rocYr + '2')];
    } else {
      mos = semesterMonths(sem);
    }
    const st = {};
    mos.forEach(m => {
      st[m] = {};
      colKeys.forEach(g => { st[m][g] = { p: new Set(), n: 0 }; });
    });
    const totals = {};
    colKeys.forEach(g => { totals[g] = { p: new Set(), n: 0 }; });
    vis.forEach(c => (c.records || []).filter(r => !r.deleted).forEach(r => {
      const m = (r.date || '').slice(0, 7);
      if (!st[m]) return;
      const grp = e2g[r.counselorEmail || ''];
      // totals key by (caseId, semester) so cross-semester same person counts separately
      const _semKey = c.id + '|' + openDateToSemPrefix(m + '-01');
      st[m]['總計'].p.add(c.id); st[m]['總計'].n++;
      totals['總計'].p.add(_semKey); totals['總計'].n++;
      if (grp) {
        st[m][grp].p.add(c.id); st[m][grp].n++;
        totals[grp].p.add(_semKey); totals[grp].n++;
      }
      if ((r.interventionMode || '') === '電話關懷') {
        st[m]['電話關懷'].p.add(c.id); st[m]['電話關懷'].n++;
        totals['電話關懷'].p.add(_semKey); totals['電話關懷'].n++;
      }
    }));
    const cell = (d) => d.n === 0 && d.p.size === 0
      ? `<span style="color:#cbd5e0;">—</span>`
      : `${d.p.size}&nbsp;/&nbsp;${d.n}`;
    const hdr = colKeys.map((g, i) =>
      `<th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:${i===0?'700':'600'};white-space:nowrap;border-bottom:2px solid #e2e8f0;border-left:${i===colKeys.length-1?'2px':'1px'} solid #e2e8f0;">${g}</th>`
    ).join('');
    const rows = mos.map((m, ri) => {
      const bg = ri % 2 === 0 ? '#fff' : '#f7fafc';
      const cols = colKeys.map((g, i) =>
        `<td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:${i===0?'700':'400'};border-left:${i===colKeys.length-1?'2px':'1px'} solid #e2e8f0;">${cell(st[m][g])}</td>`
      ).join('');
      return `<tr style="background:${bg};"><td style="padding:6px 10px;font-size:.82rem;font-weight:600;white-space:nowrap;border-right:1px solid #e2e8f0;">${parseInt(m.slice(5))}月</td>${cols}</tr>`;
    }).join('');
    const totalCols = colKeys.map((g, i) =>
      `<td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:${i===colKeys.length-1?'2px':'1px'} solid #e2e8f0;">${cell(totals[g])}</td>`
    ).join('');
    const totalsRow = `<tr style="background:#edf2f7;border-top:2px solid #cbd5e0;"><td style="padding:6px 10px;font-size:.82rem;font-weight:700;white-space:nowrap;border-right:1px solid #e2e8f0;">合計</td>${totalCols}</tr>`;
    return `<div style="overflow-x:auto;">
      <p style="font-size:.8rem;color:#718096;margin:0 0 8px 0;">格式：<strong>人數 / 人次</strong>（人數為當月不重複學生數；合計人數為期間不重複學生總數）</p>
      <table style="width:100%;border-collapse:collapse;min-width:520px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#edf2f7;">
          <th style="padding:7px 10px;text-align:left;font-size:.79rem;font-weight:600;min-width:50px;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;">月份</th>${hdr}</tr></thead>
        <tbody>${rows}${totalsRow}</tbody>
      </table></div>`;
  };
  const svcSemSelect = `<select class="field-select" style="font-size:.85rem;padding:4px 8px;" onchange="_statsSvcSem=this.value;const el=document.getElementById('svc-tbl');if(el)el.innerHTML=window._renderSvcTable(this.value)">
    ${svcSemList.length
      ? `<optgroup label="學期">${svcSemList.map(s => `<option value="${escHtml(s)}" ${s===svcDefaultSem?'selected':''}>${semesterLabel(s)} 學期</option>`).join('')}</optgroup>`
        + (aYearList.length ? `<optgroup label="學年">${aYearList.map(a => `<option value="a_${escHtml(a)}">${a} 學年度</option>`).join('')}</optgroup>` : '')
        + (cYearList.length ? `<optgroup label="年">${cYearList.map(y => `<option value="y_${y}">${y} 年</option>`).join('')}</optgroup>` : '')
      : `<option value="${escHtml(svcDefaultSem)}">${semesterLabel(svcDefaultSem)} 學期</option>`}
  </select>`;

  // ── 身心調適假統計 ──
  if (!window._mlStatsF) window._mlStatsF = { mode: 'month', dateFrom: '', dateTo: '' };
  window._mlActive = mentalLeavesData.filter(l => !l.deleted);

  window._renderMlContainer = () => {
    const el = document.getElementById('ml-stats-container');
    if (!el) return;
    const F = window._mlStatsF;
    let data = [...window._mlActive];
    if (F.dateFrom) data = data.filter(l => (l.leaveDate || '') >= F.dateFrom);
    if (F.dateTo)   data = data.filter(l => (l.leaveDate || '') <= F.dateTo);

    const groups = {};
    data.forEach(l => {
      const k = F.mode === 'semester'
        ? (l.semester || '未知')
        : ((l.leaveDate || '').slice(0, 7) || '未知');
      if (!groups[k]) groups[k] = [];
      groups[k].push(l);
    });
    const keys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    const handleCols = ['待處理', '已致電關懷', '已簡訊關懷', '非危機'];
    const modeBtn = (m, lbl) => {
      const act = F.mode === m;
      return `<button style="padding:4px 12px;font-size:.82rem;border:none;cursor:pointer;background:${act?'#3182ce':'#f7fafc'};color:${act?'#fff':'#4a5568'};"
        onclick="window._mlStatsF.mode='${m}';window._renderMlContainer()">${lbl}</button>`;
    };
    const filterBar = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
        <div style="display:flex;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
          ${modeBtn('month','月份')}${modeBtn('semester','學期')}
        </div>
        <label style="font-size:.82rem;color:#718096;display:flex;gap:4px;align-items:center;">
          日期
          <input type="date" value="${escHtml(F.dateFrom)}" style="padding:3px 6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.82rem;"
            onchange="window._mlStatsF.dateFrom=this.value;window._renderMlContainer()">
          ～
          <input type="date" value="${escHtml(F.dateTo)}" style="padding:3px 6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.82rem;"
            onchange="window._mlStatsF.dateTo=this.value;window._renderMlContainer()">
        </label>
        ${(F.dateFrom || F.dateTo) ? `<button class="btn btn-secondary btn-sm" style="padding:2px 8px;" onclick="window._mlStatsF.dateFrom='';window._mlStatsF.dateTo='';window._renderMlContainer()">清除</button>` : ''}
        <span style="font-size:.8rem;color:#a0aec0;">共 ${data.length} 筆</span>
      </div>`;

    if (!keys.length) {
      el.innerHTML = filterBar + '<p style="color:#a0aec0;font-size:.85rem;margin:0;">暫無資料</p>';
      return;
    }

    const hdr = `<tr style="background:#edf2f7;">
      <th style="padding:7px 10px;text-align:left;font-size:.79rem;font-weight:600;min-width:60px;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;">${F.mode==='semester'?'學期':'月份'}</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:700;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;">筆數</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;">人數</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:2px solid #e2e8f0;white-space:nowrap;background:#fff5f5;color:#c53030;">高風險</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;background:#fffbeb;color:#b7791f;">中風險</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;background:#f0fff4;color:#276749;">低風險</th>
      <th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;">無標記</th>
      ${handleCols.map(h => `<th style="padding:7px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;">${escHtml(h)}</th>`).join('')}
    </tr>`;

    let totN = 0;
    const totUniq = new Set(), totRisk = {0:0,1:0,2:0,3:0}, totH = {};
    handleCols.forEach(h => totH[h] = 0);

    const ce = v => v ? String(v) : `<span style="color:#cbd5e0;">—</span>`;
    const tableRows = keys.map((k, ri) => {
      const arr = groups[k];
      const uniq = new Set(arr.map(l => l.studentId));
      const byRisk = {0:0,1:0,2:0,3:0};
      const byH = {};
      handleCols.forEach(h => byH[h] = 0);
      arr.forEach(l => {
        byRisk[_mlEffectiveRisk(l).level]++;
        const hs = l.handlingStatus || '待處理';
        if (hs in byH) byH[hs]++;
      });
      totN += arr.length; arr.forEach(l => totUniq.add(l.studentId));
      [0,1,2,3].forEach(r => totRisk[r] += byRisk[r]);
      handleCols.forEach(h => totH[h] += byH[h]);
      const label = F.mode === 'semester'
        ? semesterLabel(k) + ' 學期'
        : (() => { const yr = k.slice(0,4), mo = parseInt(k.slice(5)); return `${yr}/${String(mo).padStart(2,'0')}`; })();
      const bg = ri % 2 === 0 ? '#fff' : '#f7fafc';
      return `<tr style="background:${bg};">
        <td style="padding:6px 10px;font-size:.82rem;font-weight:600;white-space:nowrap;border-right:1px solid #e2e8f0;">${escHtml(label)}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${arr.length}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:1px solid #e2e8f0;">${uniq.size}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:2px solid #e2e8f0;">${ce(byRisk[3])}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:1px solid #e2e8f0;">${ce(byRisk[2])}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:1px solid #e2e8f0;">${ce(byRisk[1])}</td>
        <td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:1px solid #e2e8f0;">${ce(byRisk[0])}</td>
        ${handleCols.map(h => `<td style="padding:6px 8px;text-align:center;font-size:.8rem;border-left:1px solid #e2e8f0;">${ce(byH[h])}</td>`).join('')}
      </tr>`;
    }).join('');

    const totalRow = `<tr style="background:#edf2f7;border-top:2px solid #cbd5e0;">
      <td style="padding:6px 10px;font-size:.82rem;font-weight:700;border-right:1px solid #e2e8f0;">合計</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${totN}</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${totUniq.size}</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:2px solid #e2e8f0;">${ce(totRisk[3])}</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(totRisk[2])}</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(totRisk[1])}</td>
      <td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(totRisk[0])}</td>
      ${handleCols.map(h => `<td style="padding:6px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(totH[h])}</td>`).join('')}
    </tr>`;

    // ── 學院 / 系所統計 ──
    const _dg = {};
    data.forEach(l => {
      // 先套系所簡寫對照（deptAbbrevMap），對得到就用正式系所名歸組（學院也能跟著對到）
      const dept = resolveDeptName(l.department) || l.department || '（未填系所）';
      if (!_dg[dept]) _dg[dept] = [];
      _dg[dept].push(l);
    });
    const _cm = {};
    Object.entries(_dg).forEach(([dept, recs]) => {
      const col = getCollegeFromDept(dept) || '（未分類）';
      if (!_cm[col]) _cm[col] = {};
      _cm[col][dept] = recs;
    });
    const _cols = [...COLLEGE_ORDER.filter(c => _cm[c]), ...Object.keys(_cm).filter(c => !COLLEGE_ORDER.includes(c)).sort()];
    const _th = (txt, extra='') => `<th style="padding:6px 8px;text-align:center;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;border-left:1px solid #e2e8f0;white-space:nowrap;${extra}">${txt}</th>`;
    const _dHdr = `<tr style="background:#edf2f7;">
      <th style="padding:6px 10px;text-align:left;font-size:.79rem;font-weight:600;border-bottom:2px solid #e2e8f0;min-width:140px;">學院 / 系所</th>
      ${_th('筆數','font-weight:700;')}${_th('人數')}
      ${_th('高風險','border-left:2px solid #e2e8f0;background:#fff5f5;color:#c53030;')}
      ${_th('中風險','background:#fffbeb;color:#b7791f;')}${_th('低風險','background:#f0fff4;color:#276749;')}${_th('無標記')}
    </tr>`;
    const _dRows = _cols.map(col => {
      const depts = _cm[col];
      const allR = Object.values(depts).flat();
      const cU = new Set(allR.map(l => l.studentId));
      const cR = {0:0,1:0,2:0,3:0};
      allR.forEach(l => cR[_mlEffectiveRisk(l).level]++);
      const colRow = `<tr style="background:#dbeafe;">
        <td style="padding:5px 10px;font-size:.82rem;font-weight:700;color:#1e3a5f;border-right:1px solid #e2e8f0;">${escHtml(col)}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${allR.length}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${cU.size}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:2px solid #e2e8f0;">${ce(cR[3])}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(cR[2])}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(cR[1])}</td>
        <td style="padding:5px 8px;text-align:center;font-size:.8rem;font-weight:700;border-left:1px solid #e2e8f0;">${ce(cR[0])}</td></tr>`;
      const deptRows = Object.entries(depts)
        .sort(([a],[b]) => a.localeCompare(b,'zh'))
        .map(([dept, recs], di) => {
          const dU = new Set(recs.map(l => l.studentId));
          const dR = {0:0,1:0,2:0,3:0};
          recs.forEach(l => dR[_mlEffectiveRisk(l).level]++);
          const bg = di % 2 === 0 ? '#fff' : '#f7fafc';
          return `<tr style="background:${bg};">
            <td style="padding:4px 8px 4px 20px;font-size:.78rem;color:#4a5568;border-right:1px solid #e2e8f0;">↳ ${escHtml(dept)}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:1px solid #e2e8f0;">${recs.length}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:1px solid #e2e8f0;">${dU.size}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:2px solid #e2e8f0;">${ce(dR[3])}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:1px solid #e2e8f0;">${ce(dR[2])}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:1px solid #e2e8f0;">${ce(dR[1])}</td>
            <td style="padding:4px 8px;text-align:center;font-size:.78rem;border-left:1px solid #e2e8f0;">${ce(dR[0])}</td></tr>`;
        }).join('');
      return colRow + deptRows;
    }).join('');

    el.innerHTML = filterBar +
      `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:700px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;"><thead>${hdr}</thead><tbody>${tableRows}${totalRow}</tbody></table></div>` +
      (_cols.length ? `<div style="margin-top:20px;"><div style="font-size:.83rem;font-weight:700;color:#2d3748;margin-bottom:6px;">學院 / 系所統計</div><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:600px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;"><thead>${_dHdr}</thead><tbody>${_dRows}</tbody></table></div></div>` : '');
  };

  const _stTabBtn = (id, lbl) => {
    const act = _statsTab === id;
    return `<button onclick="_statsTab='${id}';renderStats()" style="padding:8px 18px;border:none;cursor:pointer;background:none;font-size:.9rem;font-weight:${act?700:400};border-bottom:${act?'2.5px solid #2d6a4f':'2px solid transparent'};color:${act?'#2d6a4f':'#718096'};margin-bottom:-2px;">${lbl}</button>`;
  };

  if (!canAdminTabs && _statsTab !== 'overview') _statsTab = 'overview';

  const _overviewHtml = `
    <div class="stats-cards">
      <div class="stats-card" data-tip="服務學生：不重複學生數（一學生一案號，即可檢視的個案記錄數）。&#10;開案人次：依學期展開加總，每學期開案（含同學期重複開案 #N）各算 1 人次，可與歷史報表對照。">
        <div class="stats-num">${ovCounts.students}</div>
        <div class="stats-lbl">服務學生（人）</div>
        <div style="font-size:.76rem;color:#a0aec0;margin-top:4px;">開案 ${ovCounts.openings} 人次</div>
      </div>
      <div class="stats-card"><div class="stats-num" style="color:#2980b9;">${active}</div><div class="stats-lbl">進行中（學生）</div></div>
      <div class="stats-card"><div class="stats-num" style="color:#718096;">${closed}</div><div class="stats-lbl">已結案（學生）</div></div>
      <div class="stats-card"><div class="stats-num" style="color:#27ae60;">${newThisMonth}</div><div class="stats-lbl">本月新增（學生）</div></div>
      <div class="stats-card"><div class="stats-num" style="color:#8e44ad;">${totalSessions}</div><div class="stats-lbl">總晤談次數</div></div>
    </div>
    <p style="font-size:.78rem;color:#a0aec0;margin:-10px 0 16px;">※ 歷史資料完成合併遷移前，同一學生可能仍有多筆個案記錄，服務學生數可能略高於實際；開案人次不受影響。</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="card">
        <div class="card-header"><h3>依案件類型（學生數）</h3></div>
        <div style="padding:16px;">
          ${sortedEntries(byType).map(([k,v]) => mkBar(k, v, typeMax, '#3498db')).join('') || '<p style="color:#a0aec0;font-size:.85rem;">暫無資料</p>'}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>依主責人員（學生數）</h3></div>
        <div style="padding:16px;">
          ${sortedEntries(byCounselor).map(([k,v]) => mkBar(k, v, counselorMax, '#9b59b6')).join('') || '<p style="color:#a0aec0;font-size:.85rem;">暫無資料</p>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3 data-tip="以個案記錄建立時間（首次開案）分組，計「新增學生」數；學生於既有案號下跨學期重複開案不會重複計入">近 6 個月新增學生趨勢</h3></div>
      <div style="padding:16px;">
        ${months.map(m => mkBar(parseInt(m.slice(5)) + ' 月', byMonth[m], monthMax, '#27ae60')).join('')}
      </div>
    </div>`;

  let _tabContent;
  if (_statsTab === 'overview') {
    _tabContent = _overviewHtml;
  } else if (_statsTab === 'service') {
    _tabContent = `<div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;">服務狀況統計</h3>
        <div>${svcSemSelect}</div>
      </div>
      <div style="padding:16px;" id="svc-tbl">${window._renderSvcTable(svcDefaultSem)}</div>
    </div>`;
  } else if (_statsTab === 'mental-leave') {
    _tabContent = `<div class="card">
      <div class="card-header"><h3>身心調適假統計</h3></div>
      <div style="padding:16px;" id="ml-stats-container"></div>
    </div>`;
  } else if (_statsTab === 'courses') {
    _tabContent = `<div id="stats-courses-container"></div>`;
  }

  document.getElementById('stats-body').innerHTML = `
    <div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:20px;flex-wrap:wrap;">
      ${_stTabBtn('overview','📊 個案概況')}
      ${canAdminTabs ? _stTabBtn('service','📋 服務狀況') : ''}
      ${canAdminTabs ? _stTabBtn('mental-leave','🌿 身心調適假') : ''}
      ${canAdminTabs ? _stTabBtn('courses','📚 課程統計') : ''}
    </div>
    ${_tabContent}`;

  if (_statsTab === 'mental-leave') window._renderMlContainer();
  if (_statsTab === 'courses') _mlRenderCourseStatsTab(document.getElementById('stats-courses-container'));
}

