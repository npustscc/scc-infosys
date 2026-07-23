// dev/ml-mgmt.js — 身心調適假管理＋身心狀態評估表＋列印通知單模組（拆 index.html
// 絞殺者第二十五刀，v272）。內容為從 index.html 逐字搬出的連續區段（管理列表/tab/
// 篩選/批次/封存/信件擷取/關鍵字設定、評估表 modal 之管理端整合、通知單列印）。
// 渲染基礎（_mlRenderRecordsTab 等）在更早拆出的 dev/mental-leave.js；全域
// mentalLeavesData/_mlCheckedIds/ML_DEFAULT_KEYWORDS 宣告留在主檔（v267 起集中）。
// 載入期副作用（column-0 複核）：window._mlXxx = fn 賦值群（賦值本身無外部呼叫）、
// new Set() 初始化，以及 let _mlSemFilter = localStorage.getItem(...) ||
// currentSemesterPrefix()——後者定義於 dev/utils.js，載入順序在本檔之前，安全。
// 可安全前移到主 inline script 之前載入（刀法①）。
// ══════════════════════════════════════════════
//  身心調適假管理
// ══════════════════════════════════════════════

let _mentalLeavesSnapshot = [];
async function loadMentalLeaves() {
  try {
    const data = await driveReadJson(MENTAL_LEAVES_FILE);
    mentalLeavesData = Array.isArray(data?.records) ? data.records : [];
    _mlLastFetchedAt = data?.lastFetchedAt || null;
  } catch(e) { mentalLeavesData = []; }
  _mentalLeavesSnapshot = _deepClone(mentalLeavesData);
  _syncTodoBadge();
}

function _mlUpdateTitleBtn() {
  const _isAdmin = currentRole === '主任' || extraRole === '管理者';
  const _canFetch = _isAdmin || isMentalLeaveContact;
  const area = document.getElementById('ml-title-fetch');
  if (area) {
    area.innerHTML = _canFetch
      ? `<button class="btn btn-primary btn-sm" onclick="window._mlFetch()" style="white-space:nowrap;font-size:.85rem;padding:4px 12px;">📥 從信箱擷取</button>
         <button class="btn btn-secondary btn-sm" onclick="window._mlReparse()" style="white-space:nowrap;font-size:.85rem;padding:4px 12px;margin-left:6px;" data-tip="重新解析已擷取的信件，用來補上舊資料缺少的節次等欄位。使用者管理的欄位（受理情況、已閱等）會保留。">🔄 重新解析舊信件</button>`
      : '';
  }
  const icon = document.getElementById('nav-ml-fetch-icon');
  if (icon) icon.style.display = (_canFetch && !!currentRole) ? '' : 'none';
}

function _mlAutoFetchOnLogin() {
  const _isAdmin = currentRole === '主任' || extraRole === '管理者';
  if (!_isAdmin && !isMentalLeaveContact) return;
  const ONE_HOUR = 3600000;
  if (_mlLastFetchedAt && (Date.now() - new Date(_mlLastFetchedAt).getTime()) < ONE_HOUR) return;
  setTimeout(() => window._mlFetch(true), 1500);
}

async function _saveMentalLeavesFallback() {
  try {
    await driveUpdateJsonFile(MENTAL_LEAVES_FILE, { records: mentalLeavesData });
  } catch(e) {
    if (!e.message.includes('找不到')) throw e;
    await driveCreateJsonFile(MENTAL_LEAVES_FILE, { records: mentalLeavesData }, DRIVE_FOLDER_ID);
  }
  _mentalLeavesSnapshot = _deepClone(mentalLeavesData);
}
// 併發安全寫入（2026-07-09 事故延伸修復）：diff 出異動的紀錄，經 listCommit 依 id upsert/remove，
// 頂層 lastFetchedAt（由後端擷取信件時另行寫入）不受影響——舊整檔覆寫會意外清掉它，新路徑不會。
async function saveMentalLeaves() {
  const diff = _diffListById(_mentalLeavesSnapshot, mentalLeavesData);
  if (!diff) { await _saveMentalLeavesFallback(); return; }
  const res = await _listCommit(MENTAL_LEAVES_FILE, diff);
  if (res && res.fallback) { await _saveMentalLeavesFallback(); return; }
  if (res && res.data && Array.isArray(res.data.records)) {
    mentalLeavesData = res.data.records;
    _mentalLeavesSnapshot = _deepClone(mentalLeavesData);
  }
}

// 取得有效關鍵字庫（config 內有就用，否則用預設）
function _mlKeywords() {
  return Array.isArray(configData?.mentalLeaveKeywords) && configData.mentalLeaveKeywords.length
    ? configData.mentalLeaveKeywords
    : ML_DEFAULT_KEYWORDS;
}

// 比對請假緣由，回傳 { matchedKeywords: [{kw,level}], maxLevel }
function _mlMatchKeywords(reason) {
  if (!reason) return { matchedKeywords: [], maxLevel: 0 };
  const kws = _mlKeywords();
  const matched = kws.filter(k => reason.includes(k.kw));
  const maxLevel = matched.reduce((m, k) => Math.max(m, k.level), 0);
  return { matchedKeywords: matched, maxLevel };
}

// 風險 badge HTML
function _mlRiskBadge(maxLevel, small) {
  if (!maxLevel) return '';
  const sz = small ? 'font-size:.72rem;padding:1px 6px;' : 'font-size:.8rem;padding:3px 10px;';
  const map = { 3: ['🔴 紅燈 (危機)', '#c53030', '#fff5f5', '#fc8181'], 2: ['🟡 黃燈 (醫療)', '#d97706', '#fffbeb', '#fcd34d'], 1: ['🔵 關注', '#2b6cb0', '#ebf8ff', '#bee3f8'] };
  const [label, color, bg, border] = map[maxLevel] || ['', '#718096', '#f7fafc', '#e2e8f0'];
  return `<span style="${sz}background:${bg};color:${color};border:1px solid ${border};border-radius:12px;font-weight:600;">${label}</span>`;
}

// 個案詳細頁的身心調適假摺疊卡片
function _buildMentalLeaveDetailCard(c) {
  if (!c?.studentId) return '';
  const sid = c.studentId;
  const leaves = mentalLeavesData.filter(l => l.studentId === sid && !l.deleted);
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  if (!isAdmin && !isTransferContact) return '';
  if (!leaves.length) return '';
  const cards = [...leaves].sort((a, b) => _mlParseDateRange(b).from.localeCompare(_mlParseDateRange(a).from)).map(l => {
    const { matchedKeywords } = _mlMatchKeywords(l.reason);
    const { level: maxLevel } = _mlEffectiveRisk(l);
    const kwChips = matchedKeywords.map(k =>
      `<span style="font-size:.72rem;background:${maxLevel===3?'#fed7d7':maxLevel===2?'#fef9c3':'#dbeafe'};color:${maxLevel===3?'#9b2c2c':maxLevel===2?'#854d0e':'#1e40af'};border-radius:4px;padding:1px 6px;margin-right:3px;">${escHtml(k.kw)}</span>`
    ).join('');
    const { from: _bFrom, to: _bTo } = _mlParseDateRange(l);
    const _bDateStr = _bFrom ? (_bFrom !== _bTo ? `${_bFrom.slice(5).replace('-','/')} – ${_bTo.slice(5).replace('-','/')}` : _bFrom.slice(5).replace('-','/')) : (l.leaveDate || '—');
    // #16：課程明細改為可收合的 banner（點標題列 toggle），預設展開以維持原本一律顯示的現況
    const _cCount = _mlCourseCount(l);
    const _cdCourseId = `ml-cd-course-${escHtml(l.id)}`;
    const courseSection = _cCount ? `<div style="margin-top:6px;border:1px solid #c6f6d5;border-radius:6px;overflow:hidden;">
        <div style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:4px 10px;background:#f0fff4;" onclick="window._toggleDisplay('${_cdCourseId}','${_cdCourseId}-icon')">
          <span style="font-size:.76rem;font-weight:600;color:#276749;">📚 課程明細（${_cCount} 堂）</span>
          <span id="${_cdCourseId}-icon" style="font-size:.72rem;color:#276749;">▼</span>
        </div>
        <div id="${_cdCourseId}" style="padding:6px 10px;">${_mlCourseDetailHtml(l, `window._toggleDisplay('${_cdCourseId}','${_cdCourseId}-icon')`)}</div>
      </div>` : '';
    return `<div style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:8px;background:${maxLevel>=3?'#fff5f5':maxLevel>=2?'#fffbeb':'#fff'};">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-weight:600;font-size:.88rem;">${escHtml(_bDateStr)}</span>
        ${_mlRiskBadge(maxLevel, true)}
      </div>
      ${l.reason ? `<div style="font-size:.84rem;color:#4a5568;margin-bottom:4px;">緣由：${escHtml(l.reason)}</div>` : ''}
      ${kwChips ? `<div style="margin-top:4px;">命中關鍵字：${kwChips}</div>` : ''}
      ${courseSection}
    </div>`;
  }).join('');
  const cardId = `ml-case-card-${escHtml(c.id)}`;
  return `<div class="card" style="margin-bottom:20px;border:1.5px solid #a7c7a0;">
    <div class="card-header" style="cursor:pointer;background:#f6fbf6;" onclick="toggleSection('${cardId}')">
      <h3 style="color:#2d6a4f;">🌿 身心調適假紀錄（${leaves.length} 筆）</h3>
      <span id="${cardId}-icon">▶</span>
    </div>
    <div id="${cardId}" style="display:none;padding:12px 16px;">${cards}</div>
  </div>`;
}

// 課程相關 helpers
function _mlCourseCount(l) {
  if (Array.isArray(l.courses) && l.courses.length) return l.courses.length;
  if (l.course) return l.course.split('；').filter(Boolean).length;
  return 0;
}
// 匯總這筆請假的所有節次（去重排序），回傳「第 X、Y 節」字串；
// 若無節次資料 fallback 為課名清單（如「國文、英文」）；皆無回 ''
function _mlPeriodsSummary(l) {
  const courses = Array.isArray(l.courses) && l.courses.length
    ? l.courses
    : (l.course ? l.course.split('；').filter(Boolean).map(n => ({ name: n })) : []);
  if (!courses.length) return '';
  // 優先：節次摘要
  const set = new Set();
  courses.forEach(c => {
    (c.period || '').split(/[,、，\s]+/).map(s => s.trim()).filter(Boolean).forEach(p => set.add(p));
  });
  if (set.size) {
    const parts = [...set].sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
    return `第 ${parts.join('、')} 節`;
  }
  // Fallback：課名清單（去重）
  const nameSet = new Set();
  courses.forEach(c => { const n = (c.name || '').trim(); if (n) nameSet.add(n); });
  if (!nameSet.size) return '';
  return [...nameSet].join('、');
}
// 節次對應時間（參考新增晤談紀錄的節次表）
const _ML_PERIOD_TIMES = {
  '1':'08:10-09:00', '2':'09:10-10:00', '3':'10:15-11:05', '4':'11:10-12:00',
  '5':'13:30-14:20', '6':'14:30-15:20', '7':'15:30-16:20', '8':'16:30-17:20',
  '9':'18:00-18:50', '10':'18:55-19:45', '11':'19:50-20:40'
};
// 星期文字統一為單字國字（去除「星期/週/禮拜」前綴；數字轉國字）
function _mlNormalizeWeekday(w) {
  const s = String(w || '').trim();
  if (!s) return '';
  const map = { '1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'日','0':'日' };
  if (map[s]) return map[s];
  // 去前綴：星期一 → 一，週一 → 一
  const m = s.match(/[一二三四五六日]/);
  return m ? m[0] : s;
}
// 星期排序值（一=1、二=2、...、六=6、日=7）
function _mlWeekdayOrder(w) {
  const norm = _mlNormalizeWeekday(w);
  return { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7 }[norm] || 99;
}
// 節次排序值（用第一個數字；空字串排最後）
function _mlPeriodOrder(p) {
  const m = String(p || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}
// 節次顯示：把 "3,4" 轉為 "第 3 節 (10:15-11:05)、第 4 節 (11:10-12:00)"
function _mlPeriodWithTime(period) {
  const parts = String(period || '').split(/[,、，\s\-]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map(p => {
    const t = _ML_PERIOD_TIMES[p];
    return t ? `第 ${p} 節 (${t})` : `第 ${p} 節`;
  }).join('、');
}
// 日期字串（YYYY/M/D 或 YYYY-M-D）轉時間戳；無效值排最後
function _mlDateNum(s) {
  const str = String(s || '').trim().replace(/-/g, '/');
  if (!str) return Infinity;
  const m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return Infinity;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  // 用純數字組成排序鍵：YYYYMMDD（避免時區問題）
  return y * 10000 + mo * 100 + d;
}
// #16：toggleJs 有值時，欄位標題列（課程名稱/請假日/星期/節次）可點選收合，效果同「N 節課」badge／收合 banner
function _mlCourseDetailHtml(l, toggleJs) {
  const rawCourses = Array.isArray(l.courses) && l.courses.length
    ? l.courses
    : (l.course ? l.course.split('；').filter(Boolean).map(n => ({ name: n })) : []);
  if (!rawCourses.length) return '';
  const hasDetail = rawCourses.some(c => c.date);
  // ── 排序：第一層請假日（數值化）遞增；第二層節次（整數化）遞增 ──
  const courses = [...rawCourses].sort((a, b) => {
    const dt = _mlDateNum(a.date) - _mlDateNum(b.date);
    if (dt !== 0) return dt;
    return _mlPeriodOrder(a.period) - _mlPeriodOrder(b.period);
  });
  const headToggle = toggleJs ? ` onclick="${toggleJs}" data-tip="點選此列可收合課程明細"` : '';
  return `<table style="font-size:.78rem;border-collapse:collapse;width:100%;table-layout:fixed;box-sizing:border-box;">
    <thead><tr style="background:#f0fff4;color:#276749;${toggleJs ? 'cursor:pointer;' : ''}"${headToggle}>
      <th style="padding:3px 8px;text-align:left;font-weight:600;">課程名稱</th>
      ${hasDetail ? '<th style="padding:3px 8px;text-align:left;font-weight:600;width:80px;">請假日</th><th style="padding:3px 8px;text-align:left;font-weight:600;width:40px;">星期</th><th style="padding:3px 8px;text-align:left;font-weight:600;">節次</th>' : ''}
    </tr></thead>
    <tbody>${courses.map(c => `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:3px 8px;word-break:break-all;">${escHtml(c.name||'—')}</td>
      ${hasDetail ? `<td style="padding:3px 8px;color:#718096;word-break:break-all;">${escHtml(c.date||'—')}</td><td style="padding:3px 8px;color:#718096;text-align:center;">${escHtml(_mlNormalizeWeekday(c.weekday)||'—')}</td><td style="padding:3px 8px;color:#718096;word-break:break-all;">${escHtml(_mlPeriodWithTime(c.period))}</td>` : ''}
    </tr>`).join('')}</tbody>
  </table>`;
}
// v179：身心調適假列表「點列展開」——評估表結果摘要／聯繫歷程／課程明細（收合，預設收合）。
// 無評估表、無聯繫紀錄時只顯示課程 section；三者皆無則顯示空狀態文字。
function _mlRowExpandHtml(l) {
  const a = l.assessment;
  const contacts = a?.contacts || [];
  const parts = [];
  if (a) {
    const outcomeLbl = a.resultOutcome === 'counseling' ? '進入諮商輔導流程' : a.resultOutcome === 'noCase' ? '不開案' : '—';
    parts.push(`<div style="margin-bottom:8px;padding:8px 10px;background:#fdfaff;border:1px solid #e9d8fd;border-radius:6px;font-size:.8rem;color:#553c9a;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:600;">📝 評估表摘要</span>
        <span>評估日期：${escHtml(a.evalDate||'—')}</span>
        ${a.bsrsUnanswered ? `<span>BSRS：<b>個案皆未回答</b></span>` : `<span>BSRS 總分：<b>${_mlAssessBsrsTotal(a)}</b></span><span>自殺想法：<b>${a.suicide ?? '—'}</b></span>`}
        <span>評估結果：${escHtml(outcomeLbl)}</span>
        <button class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:1px 8px;" onclick="openMlAssessmentModal('${escHtml(l.id)}', true)">檢視</button>
      </div>
    </div>`);
    if (contacts.length) {
      const rows = contacts.map(ct => {
        const timeLbl = ct.period || ((ct.timeStart || ct.timeEnd) ? `${ct.timeStart||''}–${ct.timeEnd||''}` : '');
        const targetLbl = escHtml(ct.target || '—') + (ct.targetNote ? `（${escHtml(ct.targetNote)}）` : '');
        return `<div style="padding:4px 0;border-bottom:1px solid #edf2f7;font-size:.78rem;color:#4a5568;">${escHtml(ct.date||'—')}${timeLbl?`　${escHtml(timeLbl)}`:''}　${escHtml(ct.method||'—')}　${targetLbl}${ct.description?`　${escHtml(ct.description)}`:''}</div>`;
      }).join('');
      parts.push(`<div style="margin-bottom:8px;">
        <div style="font-weight:600;font-size:.8rem;color:#234e52;margin-bottom:4px;">☎ 聯繫歷程（${contacts.length} 筆）</div>
        ${rows}
      </div>`);
    }
  }
  const courseHtml = _mlCourseDetailHtml(l, null);
  if (courseHtml) {
    const courseId = `ml-course-sub-${escHtml(l.id)}`;
    parts.push(`<div>
      <div style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:.8rem;color:#276749;font-weight:600;" onclick="window._mlToggleCourseSub('${escHtml(l.id)}')">
        <span id="${courseId}-icon">▶</span> 課程明細
      </div>
      <div id="${courseId}" style="display:none;margin-top:4px;">${courseHtml}</div>
    </div>`);
  }
  return parts.length ? parts.join('') : `<div style="color:#a0aec0;font-size:.85rem;">無評估表、聯繫紀錄或課程資料</div>`;
}
window._mlToggleRowExpand = (id, focusSection) => {
  const row = document.getElementById('ml-expand-' + id);
  if (!row) return;
  const opening = row.style.display === 'none';
  row.style.display = opening ? '' : 'none';
  if (opening && focusSection === 'course') {
    const sub = document.getElementById(`ml-course-sub-${id}`);
    const icon = document.getElementById(`ml-course-sub-${id}-icon`);
    if (sub) sub.style.display = '';
    if (icon) icon.textContent = '▼';
  }
};
window._mlToggleCourseSub = (id) => {
  const row = document.getElementById('ml-course-sub-' + id);
  const icon = document.getElementById(`ml-course-sub-${id}-icon`);
  if (!row) return;
  const opening = row.style.display === 'none';
  row.style.display = opening ? '' : 'none';
  if (icon) icon.textContent = opening ? '▼' : '▶';
};

window._toggleDisplay = (bodyId, iconId) => {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  const el = document.getElementById(bodyId);
  if (!el) return;
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  const icon = iconId ? document.getElementById(iconId) : null;
  if (icon) icon.textContent = hidden ? '▼' : '▶';
};

// 課程統計 Tab
let _courseStatsSem = '';
function _mlRenderCourseStatsTab(el) {
  const records = mentalLeavesData.filter(l => !l.deleted);
  const semF = _courseStatsSem;
  const sems = [...new Set(records.map(l => l.semester).filter(Boolean))].sort().reverse();
  const semOpts = sems.map(s => `<option value="${escHtml(s)}"${semF===s?' selected':''}>${escHtml(semesterLabel(s)||s)}</option>`).join('');

  const courseCounts = {};
  records.filter(l => !semF || l.semester === semF).forEach(l => {
    const courses = Array.isArray(l.courses) && l.courses.length
      ? l.courses
      : (l.course ? l.course.split('；').filter(Boolean).map(n => ({ name: n })) : []);
    courses.forEach(c => {
      const name = (c.name || '').trim();
      if (!name) return;
      if (!courseCounts[name]) courseCounts[name] = { name, count: 0, students: new Set() };
      courseCounts[name].count++;
      if (l.studentId) courseCounts[name].students.add(l.studentId);
    });
  });

  const sorted = Object.values(courseCounts).sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, c) => s + c.count, 0);

  el.innerHTML = `
    <div class="card">
    <div class="card-header"><h3>課程統計</h3></div>
    <div style="padding:16px;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
      <select class="field-input" onchange="_courseStatsSem=this.value;_mlRenderCourseStatsTab(document.getElementById('${el.id}'))" style="width:auto;">
        <option value="">所有學期</option>${semOpts}
      </select>
      <span style="font-size:.85rem;color:#718096;">共 ${total} 節請假課程紀錄，${sorted.length} 門不同課程</span>
    </div>
    ${sorted.length ? `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:.875rem;">
        <thead><tr style="background:#f7fafc;text-align:left;">
          <th style="padding:8px 10px;">排名</th>
          <th style="padding:8px 10px;">課程名稱</th>
          <th style="padding:8px 10px;text-align:center;">請假節次</th>
          <th style="padding:8px 10px;text-align:center;">不同學生數</th>
          <th style="padding:8px 10px;min-width:120px;">佔比</th>
        </tr></thead>
        <tbody>${sorted.map((c, i) => {
          const pct = total ? Math.round(c.count / total * 100) : 0;
          const barW = Math.max(Math.round(c.count / sorted[0].count * 100), 4);
          return `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:7px 10px;color:#a0aec0;font-size:.8rem;">${i+1}</td>
            <td style="padding:7px 10px;font-weight:${i<3?'600':'400'};">${escHtml(c.name)}</td>
            <td style="padding:7px 10px;text-align:center;font-weight:600;color:#2d6a4f;">${c.count}</td>
            <td style="padding:7px 10px;text-align:center;color:#718096;">${c.students.size}</td>
            <td style="padding:7px 10px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="background:#9ae6b4;border-radius:3px;height:7px;width:${barW}px;max-width:100px;"></div>
                <span style="font-size:.8rem;color:#718096;">${pct}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<div style="padding:24px;text-align:center;color:#a0aec0;">尚無課程紀錄</div>'}
    </div></div>`;
}

// 主頁面渲染
let _mlTab = 'records';
let _mlPage = 1;
let _mlPageSize = 100;
let _mlFetchAborted = false;
let _mlSemFilter = localStorage.getItem('ml_sem_pref') || currentSemesterPrefix();
let _mlConsec3Filter = false;
let _mlQFilter = '';
let _mlRiskFilter = new Set();
let _mlHandlingFilter = new Set(); // v173：受理情況改收合式勾選面板，型別由字串改 Set（同群組可複選＝OR）
let _mlAbFilter = new Set(); // A案/B案篩選（依連結個案的有效 abType；空集合 = 全部）
// v173：稽核紀錄 tab 篩選（僅 canFullAccess 檢視時顯示；專任本人檢視無此篩選，見 _mlRenderAuditTab）
let _mlAuditActionFilter = new Set();
let _mlAuditOperator = '';
let _mlAuditDateFrom = '';
let _mlAuditDateTo = '';
let _mlAuditQ = '';
let _mlQComposing = false;
let _mlShowArchived = false; // A-3：受輔生／資料庫 tab 共用——是否切換為「檢視已封存」

// 可見個案身分之人員：專任＋實習＋主任＋系統管理者（不得向兼任/義務輔導老師/行政等未接觸個案身分之人員揭露該生為個案）
// 函式名沿用舊名 _mlIsFullTimeStaff 以避免大範圍改名，實際涵蓋範圍已不限專任（含實習諮商心理師）
const ML_FULL_TIME_ROLES = ['專任社會工作師', '專任諮商心理師', '專任臨床心理師', '實習諮商心理師'];
function _mlIsFullTimeStaff() {
  return ML_FULL_TIME_ROLES.includes(currentRole) || currentRole === '主任' || currentRole === '系統管理者' || extraRole === '管理者';
}

// 燈號手動覆寫：riskOverride 存在時優先於關鍵字自動判定（顯示/篩選/統計皆以此為準）
const ML_RISK_LEVEL_LABEL = { 3: '🔴 紅燈', 2: '🟡 黃燈', 1: '🔵 關注', 0: '無燈號' };
function _mlEffectiveRisk(l) {
  const auto = _mlMatchKeywords(l?.reason).maxLevel;
  if (l && l.riskOverride !== undefined && l.riskOverride !== null) {
    return { level: l.riskOverride, isOverride: true, autoLevel: auto };
  }
  return { level: auto, isOverride: false, autoLevel: auto };
}
function _mlRiskOverrideSelect(l) {
  const { level, isOverride } = _mlEffectiveRisk(l);
  const opts = [
    { v: '', lbl: '系統判定' },
    { v: '3', lbl: '🔴 紅燈' },
    { v: '2', lbl: '🟡 黃燈' },
    { v: '1', lbl: '🔵 關注' },
    { v: '0', lbl: '無燈號' },
  ];
  return `<select onclick="event.stopPropagation()" onchange="window._mlSetRiskOverride('${escHtml(l.id)}',this.value)" style="font-size:.7rem;border:1px solid #cbd5e0;border-radius:4px;padding:1px 2px;max-width:78px;width:78px;cursor:pointer;">
    ${opts.map(o => `<option value="${o.v}"${(isOverride ? String(level) === o.v : o.v === '') ? ' selected' : ''}>${o.lbl}</option>`).join('')}
  </select>`;
}
window._mlSetRiskOverride = async (id, val) => {
  const r = mentalLeavesData.find(l => l.id === id);
  if (!r) return;
  const before = _mlEffectiveRisk(r);
  const oldLabel = before.isOverride ? `${ML_RISK_LEVEL_LABEL[before.level] || before.level}（手動）` : `${ML_RISK_LEVEL_LABEL[before.level] || '無燈號'}（自動）`;
  const hadOverride = r.riskOverride !== undefined && r.riskOverride !== null;
  const prevOverride = r.riskOverride, prevBy = r.riskOverrideBy, prevAt = r.riskOverrideAt;
  if (val === '') {
    delete r.riskOverride; delete r.riskOverrideBy; delete r.riskOverrideAt;
  } else {
    r.riskOverride = parseInt(val, 10);
    r.riskOverrideBy = currentUser?.email || '';
    r.riskOverrideAt = new Date().toISOString();
  }
  const after = _mlEffectiveRisk(r);
  const newLabel = after.isOverride ? `${ML_RISK_LEVEL_LABEL[after.level] || after.level}（手動）` : `${ML_RISK_LEVEL_LABEL[after.level] || '無燈號'}（還原自動）`;
  renderMentalLeavePage();
  const jobId = bgJobAdd(`更新身心調適假燈號：學號 ${r.studentId || '—'}`);
  try {
    await saveMentalLeaves();
    bgJobDone(jobId);
    auditLog('更新身心調適假燈號', null, r.id, `學號 ${r.studentId || '—'}：${oldLabel} → ${newLabel}`);
    // 覆寫為紅燈且該生非受輔生、尚無評估表 → 通知窗口填寫身心狀態評估表（#030-⑤，防重複由紀錄標記把關）
    if (after.level === 3) { await _mlNotifyAssessmentDue().catch(() => {}); renderMentalLeavePage(); }
  } catch(e) {
    if (hadOverride) { r.riskOverride = prevOverride; r.riskOverrideBy = prevBy; r.riskOverrideAt = prevAt; }
    else { delete r.riskOverride; delete r.riskOverrideBy; delete r.riskOverrideAt; }
    bgJobFail(jobId, e.message);
    renderMentalLeavePage();
  }
};
// 再次提醒主責（重發 todo 通知）
window._mlRemind = async (id) => {
  const r = mentalLeavesData.find(l => l.id === id);
  if (!r) return;
  const mc = (casesData || []).find(c => !c.deleted && c.studentId === r.studentId);
  const email = mc?.counselorEmail;
  if (!email) { showToast('查無主責人員，無法提醒', 'error'); return; }
  const jobId = bgJobAdd(`再次提醒主責：學號 ${r.studentId || '—'}`);
  try {
    await _appendTodoToUser(email, {
      id: _genTodoId(),
      type: 'ml_reminder',
      label: `身心調適假再次提醒：學號 ${r.studentId || '—'}${r.semester ? '（' + (semesterLabel(r.semester) || r.semester) + '）' : ''}`,
      studentId: r.studentId, leaveId: r.id, caseId: mc.id,
      createdAt: new Date().toISOString(), done: false, notifRead: false,
    });
    bgJobDone(jobId);
    auditLog('身心調適假再次提醒主責', mc.id, r.id, '重新發送待辦提醒給主責'); // 去識別化：涉及個案僅記案號，不記學號
    showToast('已重新提醒主責人員', 'success');
  } catch(e) { bgJobFail(jobId, e.message); }
};
// A-1：頁面標題旁「？」說明鈕（原頁面無有效說明入口）。點了用既有 modal 樣式呈現簡短說明。
window._mlShowHelp = () => {
  document.getElementById('ml-help-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ml-help-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:480px;">
      <div class="modal-header"><h3>🌿 身心調適假管理說明</h3></div>
      <div class="modal-body" style="padding:12px 2px 8px;font-size:.88rem;color:#4a5568;line-height:1.7;">
        <p><strong>用途</strong>：從信箱自動擷取學生的身心調適假請假信件，依關鍵字比對風險燈號，協助窗口與主責及早關懷追蹤。</p>
        <p><strong>燈號意義</strong>：🔴 紅燈（危機）／🟡 黃燈（醫療）／🔵 關注／無燈號（未命中關鍵字，可手動覆寫）。</p>
        <p><strong>身心狀態評估表</strong>：身心調適假窗口於進案前對學生進行的評估與介入紀錄，適用於非受輔生且紅燈或連請三日者，並非諮商晤談紀錄。</p>
        <p><strong>封存</strong>：處理完畢的紀錄可封存，預設列表隱藏，可切換「顯示已封存」找回並解除封存。</p>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" onclick="document.getElementById('ml-help-modal')?.remove()">我知道了</button></div>
    </div>`;
  document.body.appendChild(modal);
};
function renderMentalLeavePage() {
  const el = document.getElementById('mental-leave-body');
  if (!el) return;
  if (!currentRole) { el.innerHTML = '<div style="padding:20px;color:#718096;">您沒有此頁面的存取權限。</div>'; return; }
  // 第一次渲染時從 config 還原最後使用的 tab（跨裝置記憶）
  if (!_mlTabRestored) {
    _mlTabRestored = true;
    const saved = configData?.users?.[currentUser?.email]?.mlTab;
    const valid = ['my', 'records', 'keywords', 'audit'];
    if (saved && valid.includes(saved)) _mlTab = saved;
  }
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canFullAccess = isAdmin || isMentalLeaveContact;
  // v173：稽核紀錄 tab 開放給所有「專任」角色（僅能看到自己的異動，見 _mlRenderAuditTab）；
  // 窗口／主任／管理者（canFullAccess）維持看得到全部人的異動。判定沿用既有 role 前綴慣例。
  const _mlIsFullTimeRole = typeof currentRole === 'string' && currentRole.startsWith('專任');
  const canSeeMlAudit = canFullAccess || _mlIsFullTimeRole;
  // 若目前 tab 無權限，自動回到受輔生
  if (!canFullAccess && (_mlTab === 'records' || _mlTab === 'keywords')) _mlTab = 'my';
  if (!canSeeMlAudit && _mlTab === 'audit') _mlTab = 'my';
  // Save filter state before destroying DOM
  _mlQFilter = document.getElementById('ml-q')?.value ?? _mlQFilter;
  const _mlQHadFocus = document.activeElement?.id === 'ml-q';
  el.innerHTML = `
    <div style="display:flex;gap:2px;border-bottom:2px solid #e2e8f0;margin-bottom:20px;">
      ${_mlTabBtn('my','🙋 受輔生')}
      ${canFullAccess ? _mlTabBtn('records','📋 資料庫') : ''}
      ${canFullAccess ? _mlTabBtn('keywords','🔑 關鍵字設定') : ''}
      ${canSeeMlAudit ? _mlTabBtn('audit','📋 稽核紀錄') : ''}
    </div>
    <div id="ml-tab-content"></div>`;
  _mlRenderTab();
  if (_mlQHadFocus) {
    const _qEl = document.getElementById('ml-q');
    if (_qEl) { _qEl.focus(); const _l = _qEl.value.length; _qEl.setSelectionRange(_l, _l); }
  }
}
function _mlTabBtn(id, label) {
  const active = _mlTab === id;
  return `<button onclick="window._mlSwitchTab('${id}')" style="padding:8px 18px;border:none;cursor:pointer;background:none;font-size:.9rem;font-weight:${active?700:400};border-bottom:${active?'2.5px solid #2d6a4f':'2px solid transparent'};color:${active?'#2d6a4f':'#718096'};margin-bottom:-2px;">${label}</button>`;
}
window._mlSwitchTab = (id) => { _mlTab = id; syncUserPref_({ mlTab: id }); renderMentalLeavePage(); };
window._mlFilterChange = () => { if (_mlQComposing) return; _mlPage = 1; renderMentalLeavePage(); };
// v173：風險/受理情況/案別勾選改由通用收合式面板（_fpToggle）處理，_mlRiskToggle 併入不再單獨存在

// ── ⑤ 稽核紀錄 tab（沿用既有稽核日誌的載入/表格渲染，僅篩選本模組動作） ──
// v173：窗口／主任／管理者（canFullAccess）看全部人的異動，並提供篩選；
// 一般「專任」角色（role 以'專任'開頭）也能進本 tab，但只看得到自己的異動（by 本人 email），且不提供篩選。
function _mlRenderAuditTab(el) {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canFullAccess = isAdmin || isMentalLeaveContact;
  el.innerHTML = `
    <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="display:flex;justify-content:flex-end;padding:10px 14px;background:#f7fafc;">
        <button class="btn btn-secondary btn-sm" onclick="window._mlLoadAuditTrack(true)">🔄 重新整理</button>
      </div>
      ${!canFullAccess ? `<div style="padding:8px 14px;font-size:.8rem;color:#718096;background:#f7fafc;border-top:1px solid #e2e8f0;">僅顯示您本人的異動紀錄</div>` : ''}
      <div id="ml-audit-track-table" style="padding:12px 14px;"></div>
    </div>`;
  window._mlLoadAuditTrack();
}
window._mlLoadAuditTrack = async (forceRefresh = false) => {
  const wrap = document.getElementById('ml-audit-track-table');
  if (!wrap) return;
  // 搜尋框全重繪會失焦，比照 ml-q 的作法：重繪前記住焦點與游標位置，重繪後復原
  const _hadFocus = document.activeElement?.id === 'ml-audit-q';
  const _selStart = _hadFocus ? document.activeElement.selectionStart : null;
  wrap.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="icon">⏳</div><p>讀取中…</p></div>`;
  if (!Array.isArray(window._auditLogsCache) || forceRefresh) {
    try {
      const data = await driveReadJson(AUDIT_LOG_FILE);
      const driveLogs = (data && Array.isArray(data.logs)) ? data.logs : [];
      const driveTs = new Set(driveLogs.map(l => l.t));
      const cachedOnly = (window._auditLogsCache || []).filter(l => !driveTs.has(l.t));
      window._auditLogsCache = [...driveLogs, ...cachedOnly].sort((a, b) => (a.t || '') < (b.t || '') ? -1 : 1);
    } catch (e) {
      wrap.innerHTML = `<div class="alert alert-error">讀取失敗：${escHtml(e.message)}</div>`;
      return;
    }
  }
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const canFullAccess = isAdmin || isMentalLeaveContact;
  // 隱私：「再次提醒主責」紀錄本身即揭露該生為個案（有主責），非專任人員不得見（與 A/B案標示同一限縮原則）
  const _mlAuditFT = _mlIsFullTimeStaff();
  const base = (window._auditLogsCache || []).filter(l => AUDIT_PAGE_CATEGORIES['身心調適假']?.(l.action)).filter(l => _mlAuditFT || l.action !== '身心調適假再次提醒主責');

  let filterBarHtml = '';
  let entries;
  let actionOpts = [];
  if (!canFullAccess) {
    // 一般專任：只看自己的異動（by＝本人 email），無篩選
    entries = base.filter(l => l.email === currentUser?.email);
  } else {
    // canFullAccess：動作類型／操作者選項從目前資料動態盤點（不寫死清單，避免漏列新動作字串）
    actionOpts = [...new Set(base.map(l => l.action))].sort().map(a => ({ value: a, label: a }));
    const operatorMap = new Map();
    base.forEach(l => { if (l.email && !operatorMap.has(l.email)) operatorMap.set(l.email, l.name || l.email); });
    const operatorOpts = [...operatorMap.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh-Hant'));
    const q = (_mlAuditQ || '').trim().toLowerCase();
    entries = base.filter(l => {
      if (!_filterPanelMatch({ action: l.action }, { action: [..._mlAuditActionFilter] })) return false;
      if (_mlAuditOperator && l.email !== _mlAuditOperator) return false;
      if (_mlAuditDateFrom && (l.t || '').slice(0, 10) < _mlAuditDateFrom) return false;
      if (_mlAuditDateTo   && (l.t || '').slice(0, 10) > _mlAuditDateTo)   return false;
      if (q) {
        const cid = (l.caseId || '').toLowerCase();
        let hit = cid.includes(q);
        if (!hit) {
          const c = casesData.find(x => x.id === l.caseId);
          if (c) hit = (c.name || '').toLowerCase().includes(q) || (c.studentId || '').toLowerCase().includes(q);
        }
        if (!hit) return false;
      }
      return true;
    });
    filterBarHtml = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#f7fafc;border-bottom:1px solid #e2e8f0;">
        ${_fpButtonHtml('mlaudit')}
        <select id="ml-audit-operator" class="field-input" style="width:auto;" onchange="_mlAuditOperator=this.value;window._mlLoadAuditTrack()">
          <option value="">全部操作者</option>
          ${operatorOpts.map(([email, name]) => `<option value="${escHtml(email)}"${_mlAuditOperator === email ? ' selected' : ''}>${escHtml(name)}</option>`).join('')}
        </select>
        <input type="date" id="ml-audit-from" class="field-input" style="width:auto;" value="${escHtml(_mlAuditDateFrom)}" onchange="_mlAuditDateFrom=this.value;window._mlLoadAuditTrack()">
        <span style="color:#718096;font-size:.85rem;">至</span>
        <input type="date" id="ml-audit-to" class="field-input" style="width:auto;" value="${escHtml(_mlAuditDateTo)}" onchange="_mlAuditDateTo=this.value;window._mlLoadAuditTrack()">
        <input type="text" id="ml-audit-q" class="field-input" placeholder="搜尋姓名/學號/案號" value="${escHtml(_mlAuditQ)}" style="max-width:180px;"
          oninput="_mlAuditQ=this.value;window._mlLoadAuditTrack()">
        <button class="btn btn-secondary btn-sm" onclick="_mlAuditActionFilter.clear();_mlAuditOperator='';_mlAuditDateFrom='';_mlAuditDateTo='';_mlAuditQ='';window._mlLoadAuditTrack()">清除篩選</button>
      </div>
      ${_fpPanelHtml('mlaudit')}`;
  }
  entries = entries.slice(-200);
  wrap.innerHTML = filterBarHtml + `<div style="padding:12px 14px;">${_mkAuditTable(entries)}</div>`;
  if (canFullAccess) {
    _fpSyncPanel('mlaudit', [{ key: 'action', title: '動作類型', options: actionOpts }],
      { action: _mlAuditActionFilter }, 'window._mlLoadAuditTrack()');
  }
  if (_hadFocus) {
    const qEl = document.getElementById('ml-audit-q');
    if (qEl) { qEl.focus(); qEl.setSelectionRange(_selStart, _selStart); }
  }
};
function _getMyCaseStudentIds() {
  const myAllowedIds = new Set(configData?.users?.[currentUser?.email]?.allowedCases || []);
  const result = new Set();
  (casesData || []).filter(c => !c.deleted).forEach(c => {
    if (c.counselorEmail === currentUser?.email || myAllowedIds.has(c.id)) {
      if (c.studentId) result.add(c.studentId);
    }
  });
  return result;
}

function _getAllCaseStudentIds() {
  const result = new Set();
  (casesData || []).filter(c => !c.deleted).forEach(c => { if (c.studentId) result.add(c.studentId); });
  return result;
}

function _getMyStudentIds() {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  const isPrivileged = isAdmin || isMentalLeaveContact;
  if (isPrivileged) {
    // privileged 預設看所有受輔生；勾選「僅看自己」則縮限
    return _mlMyOnly ? _getMyCaseStudentIds() : _getAllCaseStudentIds();
  }
  return _getMyCaseStudentIds();
}

function _mlUnacknowledgedForMe() {
  if (!currentUser?.email || !mentalLeavesData.length) return [];
  const _isAdm = currentRole === '主任' || extraRole === '管理者';
  const isPrivileged = _isAdm || isMentalLeaveContact;
  // privileged 看所有在案受輔生；一般諮商師只看自己主責
  const myStudentIds = isPrivileged ? _getAllCaseStudentIds() : _getMyCaseStudentIds();
  if (!myStudentIds.size) return [];
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  return mentalLeavesData.filter(l => {
    if (l.deleted) return false;
    if (!l.receivedAt || new Date(l.receivedAt).getTime() < thirtyDaysAgo) return false;
    if (!myStudentIds.has(l.studentId)) return false;
    return !(l.acknowledgedBy || []).includes(currentUser.email);
  });
}

function _mlRenderTab() {
  const el = document.getElementById('ml-tab-content');
  if (!el) return;
  if (_mlTab === 'keywords') _mlRenderKeywordsTab(el);
  else if (_mlTab === 'audit') _mlRenderAuditTab(el);
  else if (_mlTab === 'my') _mlRenderRecordsTab(el, _getMyStudentIds());
  else _mlRenderRecordsTab(el, null);
}

const ML_HANDLING_OPTS = ['待處理', '非危機', '已致電關懷', '已簡訊關懷'];
const ML_HANDLING_STYLE = {
  '待處理':   { bg: '#fff5f5', color: '#c53030', border: '#fc8181' },
  '非危機':   { bg: '#f0fff4', color: '#276749', border: '#9ae6b4' },
  '已致電關懷': { bg: '#ebf8ff', color: '#2b6cb0', border: '#90cdf4' },
  '已簡訊關懷': { bg: '#ebf8ff', color: '#2b6cb0', border: '#90cdf4' },
};

window._mlSetHandling = async (id, val) => {
  const r = mentalLeavesData.find(l => l.id === id);
  if (!r) return;
  const old = r.handlingStatus;
  r.handlingStatus = val;
  const jobId = bgJobAdd(`更新受理情況：${r.name||r.studentId}`);
  try {
    await saveMentalLeaves(); bgJobDone(jobId);
    auditLog('更新身心調適假受理情況', null, null, `${r.name} ${r.studentId}：${old||'(未設)'}→${val}`);
  } catch(e) { r.handlingStatus = old; bgJobFail(jobId, e.message); }
};

window._mlToggleCheck = (id, checked) => {
  if (checked) _mlCheckedIds.add(id); else _mlCheckedIds.delete(id);
  const bar = document.getElementById('ml-batch-bar');
  const cnt = document.getElementById('ml-batch-cnt');
  if (bar) bar.style.display = _mlCheckedIds.size > 0 ? 'flex' : 'none';
  if (cnt) cnt.textContent = `已選 ${_mlCheckedIds.size} 筆`;
};

window._mlCheckAll = (checked) => {
  document.querySelectorAll('.ml-row-chk').forEach(cb => {
    cb.checked = checked;
    if (checked) _mlCheckedIds.add(cb.dataset.id); else _mlCheckedIds.delete(cb.dataset.id);
  });
  const bar = document.getElementById('ml-batch-bar');
  const cnt = document.getElementById('ml-batch-cnt');
  if (bar) bar.style.display = _mlCheckedIds.size > 0 ? 'flex' : 'none';
  if (cnt) cnt.textContent = `已選 ${_mlCheckedIds.size} 筆`;
};

window._mlBatchHandling = async () => {
  const val = document.getElementById('ml-batch-status')?.value;
  if (!val) { alert('請選擇受理情況'); return; }
  if (!_mlCheckedIds.size) { alert('請先勾選要批次填寫的紀錄'); return; }
  const ids = [..._mlCheckedIds];
  let updated = 0;
  ids.forEach(id => { const r = mentalLeavesData.find(l => l.id === id); if (r) { r.handlingStatus = val; updated++; } });
  _mlCheckedIds.clear();
  renderMentalLeavePage();
  const jobId = bgJobAdd(`批次填寫受理情況：${val}（${updated} 筆）`);
  try { await saveMentalLeaves(); bgJobDone(jobId); auditLog('批次填寫身心調適假受理情況', null, null, `${val}，${updated} 筆`); }
  catch(e) { bgJobFail(jobId, e.message); }
};

// #33-4：管理頁批量標記已讀。將本人 email 併入所選紀錄的 acknowledgedBy，
// 主責在受輔生分頁批量標記自己的個案 → 管理頁「主責已讀」同步；沿用單筆「收到」的語義（見 _mlAcknowledge）。
// 注意：此為「已讀」而非 A-3 的真封存（archived 欄位）——兩者是不同動作，列表預設隱藏靠的是後者。
window._mlBatchAck = async () => {
  if (!_mlCheckedIds.size) { alert('請先勾選要標記已讀的紀錄'); return; }
  if (!currentUser?.email) return;
  const ids = [..._mlCheckedIds];
  let changed = 0;
  ids.forEach(id => {
    const r = mentalLeavesData.find(l => l.id === id);
    if (!r) return;
    if (!Array.isArray(r.acknowledgedBy)) r.acknowledgedBy = [];
    if (!r.acknowledgedBy.includes(currentUser.email)) { r.acknowledgedBy.push(currentUser.email); changed++; }
  });
  _mlCheckedIds.clear();
  try { _syncTodoBadge(); } catch (_) {}
  renderMentalLeavePage();
  if (!changed) return;
  const jobId = bgJobAdd(`批次標記已讀 ${changed} 筆身心調適假通知`);
  try { await saveMentalLeaves(); bgJobDone(jobId); } catch(e) { bgJobFail(jobId, e.message); }
};

// ── v174：每列「收到／填寫評估表／封存」改為姓名下方橫排小圖示（見 _mlRenderRecordsTab 內
// _mlIconBtn），取代原 A-2「⋯ 更多」溢位選單；_mlMenuItemHtml/_mlToggleRowMenu/_mlCloseRowMenus
// 已無呼叫端（grep 確認），一併移除。

// ── A-3：封存／解除封存（真正的列表隱藏，區別於「已讀」acknowledgedBy）──────────────
// A-4：批次封存前先檢查每筆的「主責」是否已收到（acknowledgedBy），未讀者跳出確認框去識別化（僅列案號）。
async function _mlArchiveIds(ids) {
  const targets = ids.map(id => mentalLeavesData.find(l => l.id === id)).filter(l => l && !l.deleted && !l.archived);
  if (!targets.length) { alert('沒有可封存的紀錄（已封存者自動跳過）。'); return; }
  const infoed = targets.map(l => {
    const mc = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
    const counselorEmail = mc ? _getLatestCounselorEmail(mc) : '';
    const isAcked = !!(counselorEmail && (l.acknowledgedBy || []).includes(counselorEmail));
    return { l, mc, counselorEmail, isAcked };
  });
  const unread = infoed.filter(x => x.counselorEmail && !x.isAcked);
  let toArchive = infoed;
  let toAckToo = [];
  if (unread.length) {
    // 去識別化：確認框僅顯示案號，不得出現姓名/學號
    const listTxt = unread.map(x => x.mc.id).join('、');
    const doAll = confirm(
      `以下個案的主責尚未確認收到：${listTxt}\n\n也要一起封存嗎？\n\n` +
      `【確定】＝全部封存（未讀者一併標記為已收到）\n【取消】＝只封存主責已收到的，未讀者暫不封存`
    );
    if (doAll) {
      toAckToo = unread;
    } else {
      const unreadIds = new Set(unread.map(x => x.l.id));
      toArchive = infoed.filter(x => !unreadIds.has(x.l.id));
      if (!toArchive.length) return;
    }
  } else if (!confirm(`確定要封存 ${targets.length} 筆身心調適假紀錄？`)) {
    return;
  }
  toAckToo.forEach(x => {
    if (!Array.isArray(x.l.acknowledgedBy)) x.l.acknowledgedBy = [];
    if (!x.l.acknowledgedBy.includes(x.counselorEmail)) x.l.acknowledgedBy.push(x.counselorEmail);
  });
  const now = new Date().toISOString();
  toArchive.forEach(x => { x.l.archived = true; x.l.archivedAt = now; x.l.archivedBy = currentUser?.email || ''; });
  // 只清掉「這次實際被封存」的勾選（跳過的未讀者維持勾選，方便使用者接續處理）；批次／單筆共用此函式皆適用
  toArchive.forEach(x => _mlCheckedIds.delete(x.l.id));
  renderMentalLeavePage();
  const jobId = bgJobAdd(`封存 ${toArchive.length} 筆身心調適假紀錄`);
  try {
    await saveMentalLeaves();
    bgJobDone(jobId);
    toArchive.forEach(x => auditLog('封存身心調適假紀錄', x.mc ? x.mc.id : null, x.l.id, `學號 ${x.l.studentId || '—'}`));
  } catch (e) {
    toArchive.forEach(x => { x.l.archived = false; delete x.l.archivedAt; delete x.l.archivedBy; });
    bgJobFail(jobId, e.message);
    renderMentalLeavePage();
  }
}
async function _mlUnarchiveIds(ids) {
  const targets = ids.map(id => mentalLeavesData.find(l => l.id === id)).filter(l => l && l.archived);
  if (!targets.length) { alert('沒有可解除封存的紀錄。'); return; }
  if (!confirm(`確定要解除封存 ${targets.length} 筆身心調適假紀錄？`)) return;
  targets.forEach(l => { l.archived = false; _mlCheckedIds.delete(l.id); });
  renderMentalLeavePage();
  const jobId = bgJobAdd(`解除封存 ${targets.length} 筆身心調適假紀錄`);
  try {
    await saveMentalLeaves();
    bgJobDone(jobId);
    targets.forEach(l => auditLog('解除封存身心調適假紀錄', null, l.id, `學號 ${l.studentId || '—'}`));
  } catch (e) {
    targets.forEach(l => { l.archived = true; });
    bgJobFail(jobId, e.message);
    renderMentalLeavePage();
  }
}
window._mlArchiveOne = async (id) => { await _mlArchiveIds([id]); };
window._mlUnarchiveOne = async (id) => { await _mlUnarchiveIds([id]); };
window._mlBatchArchive = async () => {
  if (!_mlCheckedIds.size) { alert('請先勾選要封存的紀錄'); return; }
  await _mlArchiveIds([..._mlCheckedIds]);
};
window._mlBatchUnarchive = async () => {
  if (!_mlCheckedIds.size) { alert('請先勾選要解除封存的紀錄'); return; }
  await _mlUnarchiveIds([..._mlCheckedIds]);
};

function _mlParseDateRange(l) {
  const raw = l.leaveDate || '';
  let from, to;
  if (raw.includes('~')) {
    const [f, t] = raw.split('~');
    from = f.trim().replace(/\//g, '-');
    to   = t.trim().replace(/\//g, '-');
  } else if (l.leaveDateTo) {
    from = raw.replace(/\//g, '-');
    to   = l.leaveDateTo.replace(/\//g, '-');
  } else {
    from = raw.replace(/\//g, '-');
    to   = from;
  }
  return { from, to };
}

function _mlConsecutive3DayIds(records) {
  const _addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const byStudent = {};
  records.forEach(l => {
    if (!l.studentId) return;
    const { from, to } = _mlParseDateRange(l);
    if (!from) return;
    if (!byStudent[l.studentId]) byStudent[l.studentId] = new Set();
    let cur = from;
    while (cur <= to) { byStudent[l.studentId].add(cur); cur = _addDays(cur, 1); }
  });
  const result = new Set();
  Object.entries(byStudent).forEach(([sid, dateSet]) => {
    const sorted = [...dateSet].sort();
    for (let i = 0; i + 2 < sorted.length; i++) {
      const d0 = new Date(sorted[i]), d1 = new Date(sorted[i+1]), d2 = new Date(sorted[i+2]);
      if ((d1 - d0) === 86400000 && (d2 - d1) === 86400000) { result.add(sid); break; }
    }
  });
  return result;
}

// ── 身心調適假通知資料庫 Tab ──────────────────────────────
function _mlGroupAndSort(records) {
  const _addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const fmt = d => d ? d.slice(5).replace('-', '/') : '';
  const byStudent = {};
  records.forEach(l => {
    const key = l.studentId || l.id;
    if (!byStudent[key]) byStudent[key] = [];
    byStudent[key].push(l);
  });
  const groups = [];
  Object.values(byStudent).forEach(recs => {
    const sorted = [...recs].sort((a, b) => _mlParseDateRange(a).from.localeCompare(_mlParseDateRange(b).from));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length) {
        const curTo    = _mlParseDateRange(sorted[j]).to;
        const nextFrom = _mlParseDateRange(sorted[j + 1]).from;
        if (curTo && nextFrom && _addDays(curTo, 1) === nextFrom) j++; else break;
      }
      const run = sorted.slice(i, j + 1);
      const firstFrom = _mlParseDateRange(run[0]).from;
      const lastTo    = _mlParseDateRange(run[run.length - 1]).to;
      const totalDays = (firstFrom && lastTo) ? Math.round((new Date(lastTo) - new Date(firstFrom)) / 86400000) + 1 : run.length;
      const dateRange = (firstFrom && lastTo && firstFrom !== lastTo) ? `${fmt(firstFrom)} – ${fmt(lastTo)}` : fmt(firstFrom);
      groups.push({
        records: run,
        isConsec3: totalDays >= 3,
        isRun: run.length >= 2 || (firstFrom !== lastTo),
        dateRange,
        latestDate: lastTo || firstFrom || ''
      });
      i = j + 1;
    }
  });
  groups.sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  return groups;
}

// v179：個案詳細頁「身心調適假紀錄」卡改時間軸——純函式，供 _renderCaseMlCard 呼叫、亦供單元測試。
// 輸入皆為呼叫端已依同一學生篩選/攤平好的陣列：
//   leaves        單一學生的身心調適假紀錄（含連續日請假、含 assessment）
//   assessments    leaves 中已填評估表者（l.assessment 存在），用來產生「評估卡片」
//   contacts       攤平後的聯繫紀錄，每筆 { leaveId, date, ...其餘 contact 欄位 }
//   abTypeHistory  連結個案的 c.abTypeHistory（見 saveCase）
// 回傳依日期升冪排序（同日期依 leave < eval < contact < abChange 排列）的項目陣列：
//   { type:'leave', date, dateRange, records, isConsec3 }
//   { type:'eval', date, leave, assessment }
//   { type:'contact', date, leaveId, contact }
//   { type:'abChange', date, history }
function _mlCaseTimelineItems(leaves, assessments, contacts, abTypeHistory) {
  const items = [];
  _mlGroupAndSort((leaves || []).filter(l => !l.deleted)).forEach(g => {
    const first = _mlParseDateRange(g.records[0]).from || '';
    items.push({ type: 'leave', date: first, dateRange: g.dateRange, records: g.records, isConsec3: g.isConsec3 });
  });
  (assessments || []).forEach(l => {
    const a = l.assessment || {};
    const date = a.evalDate || (a.filledAt || '').slice(0, 10) || '';
    items.push({ type: 'eval', date, leave: l, assessment: a });
  });
  (contacts || []).forEach(ct => {
    items.push({ type: 'contact', date: ct.date || '', leaveId: ct.leaveId, contact: ct });
  });
  (abTypeHistory || []).filter(h => h && h.kind === 'change' && String(h.to || '').includes('A')).forEach(h => {
    items.push({ type: 'abChange', date: (h.at || '').slice(0, 10), history: h });
  });
  const typeOrder = { leave: 0, eval: 1, contact: 2, abChange: 3 };
  items.sort((x, y) => {
    const dx = x.date || '', dy = y.date || '';
    if (dx !== dy) return dx < dy ? -1 : 1;
    return (typeOrder[x.type] ?? 9) - (typeOrder[y.type] ?? 9);
  });
  return items;
}

// ══════════════════════════════════════════════
//  身心狀態評估表（身心調適假連續三日者適用，#030-⑤）
// ══════════════════════════════════════════════
// 定位：窗口對「非受輔生」的分流評估工具。
// 填寫/編輯權限（從嚴，三種人）：身心調適假窗口＋主任＋系統管理者。其他人完全看不到填寫/編輯入口。
function _mlAssessCanEdit() {
  if (!currentUser) return false;
  return isMentalLeaveContact || currentRole === '主任' || currentRole === '系統管理者' || extraRole === '管理者';
}
// 檢視/列印權限：編輯者三種人，或（該生有開案時）能開啟該個案詳情的人（評估表視為個案資料的一部分）
function _mlAssessCanView(studentId) {
  if (!currentUser) return false;
  if (_mlAssessCanEdit()) return true;
  if (!studentId) return false;
  const mc = (casesData || []).find(c => !c.deleted && c.studentId === studentId);
  return !!(mc && (_caseNormallyAccessible(mc) || _hasCrisisGrant(mc.id)));
}
// 適用條件：非受輔生（該學期無開案）且（紅燈 level 3 含手動覆寫，或 連請三日）。
// 掛載位置：連請三日者掛該連續區段第一筆；純紅燈單筆者掛該筆。
// 回傳 map：區段內任一 record.id → anchor 紀錄（不符合者不在 map 中）
function _mlBuildAssessAnchors() {
  const map = {};
  const groups = _mlGroupAndSort(mentalLeavesData.filter(l => !l.deleted));
  groups.forEach(g => {
    const consecAnchor = g.isConsec3 ? g.records[0] : null;
    g.records.forEach(r => {
      const a = consecAnchor || (_mlEffectiveRisk(r).level === 3 ? r : null);
      if (a) map[r.id] = a;
    });
  });
  return map;
}
// 找出某筆紀錄的評估表掛載紀錄（anchor）；不符合條件回傳 null
function _mlAssessAnchor(l) {
  if (!l || !l.studentId) return null;
  return _mlBuildAssessAnchors()[l.id] || null;
}
// anchor 是否具備「填寫」資格：已填者永遠可檢視；未填者須為非受輔生（該學期無開案）
function _mlAssessFillable(anchor) {
  if (!anchor) return false;
  if (anchor.assessment) return true;
  return !!(anchor.studentId && anchor.semester && !_hasCaseInSem(anchor.studentId, anchor.semester));
}
// ── 3 個工作日倒數（工作日＝跳過週六日） ──
function _mlAddWorkdays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _mlAssessCountdown(dueDate) {
  if (!dueDate) return null;
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate + 'T00:00:00');
  if (isNaN(due.getTime())) return null;
  if (due < t0) {
    const overdue = Math.round((t0 - due) / 86400000);
    return { state: 'overdue', text: `已逾期 ${overdue} 日` };
  }
  if (due.getTime() === t0.getTime()) return { state: 'today', text: '今日截止' };
  let left = 0;
  const cur = new Date(t0);
  while (cur < due) { cur.setDate(cur.getDate() + 1); const dw = cur.getDay(); if (dw !== 0 && dw !== 6) left++; }
  return { state: left <= 1 ? 'urgent' : 'normal', text: `剩 ${left} 個工作日` };
}
// 倒數 chip：剩 2-3 日普通、剩 1 日橙色粗體、當日/逾期紅色＋⚠
function _mlAssessCountdownChip(dueDate, prefix) {
  const c = _mlAssessCountdown(dueDate);
  if (!c) return '';
  const style = (c.state === 'overdue' || c.state === 'today')
    ? 'background:#fed7d7;color:#9b2c2c;font-weight:700;border:1px solid #fc8181;'
    : c.state === 'urgent'
    ? 'background:#feebc8;color:#9c4221;font-weight:700;border:1px solid #fbd38d;'
    : 'background:#edf2f7;color:#4a5568;border:1px solid #e2e8f0;';
  const warn = (c.state === 'overdue' || c.state === 'today') ? '⚠ ' : '';
  return `<span style="border-radius:4px;padding:0 6px;font-size:.72rem;white-space:nowrap;${style}">${warn}${escHtml(prefix || '')}${escHtml(c.text)}</span>`;
}
// ── 窗口待辦提醒（信件擷取後 / 燈號覆寫為紅燈後呼叫）──
// 防重複：anchor 紀錄上打 assessmentNotifiedAt 標記，同一紀錄/區段只發一次
async function _mlNotifyAssessmentDue() {
  if (!_mlAssessCanEdit()) return; // 只有窗口/主任/管理者情境會觸發擷取與覆寫
  const anchorMap = _mlBuildAssessAnchors();
  const seen = new Set();
  const pending = [];
  Object.values(anchorMap).forEach(a => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    if (a.assessment || a.assessmentNotifiedAt) return;
    if (!a.studentId || !a.semester) return;
    if (_hasCaseInSem(a.studentId, a.semester)) return; // 僅非受輔生
    pending.push(a);
  });
  if (!pending.length) return;
  const contacts = Object.entries(configData?.users || {})
    .filter(([, info]) => info.isMentalLeaveContact === true && !info.disabled)
    .map(([email]) => email);
  const now = new Date().toISOString();
  const dueDate = _mlAddWorkdays(now.slice(0, 10), 3);
  let ownChanged = false;
  for (const a of pending) {
    const { from, to } = _mlParseDateRange(a);
    const dateLbl = from ? (from !== to ? `${from} ~ ${to}` : from) : (a.leaveDate || '');
    const mkTodo = () => ({
      id: _genTodoId(), type: 'ml_assessment_due',
      label: `身心狀態評估表待填寫：學號 ${a.studentId || '—'}（${dateLbl}）`,
      studentId: a.studentId, leaveId: a.id, dueDate,
      createdAt: now, done: false, notifRead: false,
    });
    for (const email of contacts) {
      try {
        if (email === currentUser?.email) {
          if (!todosData.some(t => t.type === 'ml_assessment_due' && t.leaveId === a.id)) { todosData.push(mkTodo()); ownChanged = true; }
        } else {
          await _appendTodoToUser(email, mkTodo());
        }
      } catch (_) { /* 個別窗口寫入失敗不阻斷其他人 */ }
    }
    a.assessmentNotifiedAt = now;
  }
  if (ownChanged) { saveUserTodos().catch(() => {}); _syncTodoBadge(); }
  try { await saveMentalLeaves(); } catch (_) {}
  auditLog('身心狀態評估表填寫提醒', null, null, `通知窗口 ${contacts.length} 人，共 ${pending.length} 筆（3 個工作日內完成，截止 ${dueDate}）`);
}
// 評估表已填 → 自動完成對應待辦（各使用者載入資料後各自校正）
function _mlReconcileAssessmentTodos() {
  let changed = false;
  const now = new Date().toISOString();
  (todosData || []).forEach(t => {
    if (t.type !== 'ml_assessment_due' || t.done || !t.leaveId) return;
    const r = mentalLeavesData.find(l => l.id === t.leaveId);
    if (r && r.assessment) { t.done = true; t.doneAt = now; changed = true; }
  });
  if (changed) { saveUserTodos().catch(() => {}); _syncTodoBadge(); }
}
// v181：拿掉題號前綴（改由 render 端依 _bsrsOrderedLabels 的顯示序動態產生 (1)-(5)），
// 陣列本身維持儲存序 [0]=睡眠…[4]=比不上，語意不變。
const ML_ASSESS_BSRS_LABELS = [
  '睡眠困難，譬如難以入睡、易醒或早醒',
  '感覺緊張或不安',
  '覺得容易苦惱或動怒',
  '感覺憂鬱、心情低落',
  '覺得比不上別人',
];
function _mlAssessBsrsTotal(a) {
  return (a?.bsrs || []).slice(0, 5).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
}
function _mlAssessDefault(l, mc) {
  return {
    name: l?.name || mc?.name || '', studentId: l?.studentId || mc?.studentId || '',
    // v179：收案日期預設今日（原預設 mc.openDate 常與實際收案時間脫節）；已有值的舊資料照舊顯示原值，不受此變更影響
    collectionDate: new Date().toISOString().slice(0, 10), evalDate: new Date().toISOString().slice(0, 10),
    reason: l?.reason || '', contactTime: '',
    // v179：聯繫時間改為結構化陣列（見 saveMlAssessment），contactTime 舊字串欄位僅供舊資料唯讀顯示
    contacts: [],
    bsrs: [null, null, null, null, null], suicide: null,
    medPsychiatry: '', medMedication: '', medCounseling: '',
    familyRel: '', familyRelOther: '',
    partnerHas: '', partnerType: '', partnerOther: '',
    friendType: '', friendOther: '',
    teacherType: '', teacherName: '', teacherOther: '',
    housing: '', housingOther: '',
    resultText: '', resultOutcome: '', resultCounselorName: '', resultCounselorEmail: '', resultNoCaseReasons: [],
    assessorNote: '', // v182：評估者備註（選填，A1）
  };
}

// v179：填寫/編輯/檢視改全頁（page-ml-assess），不再是浮動 modal；返回沿用全站通用「← 上一頁」機制（showPage 自動記錄來源頁）
let _mlaCurrentAnchorId = null;
let _mlaCurrentReadOnly = false;
let _mlaDraftContacts = []; // 聯繫時間草稿陣列（結構化，供日後統計聯繫次數）；新增/刪除直接操作此陣列＋局部重繪，避免整頁重繪遺失使用者輸入
let _mlaDraftTodoId = null; // v185：從草稿待辦「繼續編輯」重開時記錄對應 todoId

// ── v185：身心狀態評估表草稿備援與離開防護（僅編輯/新增模式；檢視唯讀模式不適用）──────────
function _mlaFormSnapshot() {
  const gv = id => document.getElementById(id)?.value ?? '';
  const gr = n => document.querySelector(`[name="${n}"]:checked`)?.value || '';
  const gchk = n => [...document.querySelectorAll(`[name="${n}"]:checked`)].map(el => el.value).sort();
  return {
    name: gv('mla-name'), sid: gv('mla-sid'),
    collectDate: gv('mla-collect-date'), evalDate: gv('mla-eval-date'),
    assessorNote: gv('mla-assessor-note'),
    contacts: JSON.parse(JSON.stringify(_mlaDraftContacts || [])),
    bsrs: [0,1,2,3,4].map(i => gv(`mla-bsrs-${i}`)),
    suicide: gv('mla-suicide'),
    medPsy: gr('mla-med-psy'), medDrug: gr('mla-med-drug'), medCounsel: gr('mla-med-counsel'),
    family: gr('mla-family'), familyOther: gv('mla-family-other'),
    partnerHas: gr('mla-partner-has'), partnerType: gr('mla-partner-type'), partnerOther: gv('mla-partner-other'),
    friend: gr('mla-friend'), friendOther: gv('mla-friend-other'),
    teacher: gr('mla-teacher'), teacherName: gv('mla-teacher-name'), teacherOther: gv('mla-teacher-other'),
    housing: gr('mla-housing'), housingOther: gv('mla-housing-other'),
    resultText: gv('mla-result-text'), outcome: gr('mla-outcome'), outcomeCounselor: gv('mla-outcome-counselor'),
    nocaseReasons: gchk('mla-nocase-reason'),
  };
}
function _mlaDraftKey() {
  return `scc_draft_mlassess_${currentUser?.email || ''}_${_mlaCurrentAnchorId || ''}`;
}
function _startMlaDraftAutosave() {
  _gdStartAutosave('mlassess', _mlaDraftKey(), _mlaFormSnapshot, '_mla-draft-status');
}
function _stopMlaDraftAutosave() { _gdStopAutosave('mlassess'); }

function exitMlAssessment() {
  if (_mlaCurrentReadOnly) { handlePrevPage(); return; } // 檢視模式無需離開防護
  const _exit = () => {
    _stopMlaDraftAutosave();
    try { localStorage.removeItem(_mlaDraftKey()); } catch(_) {}
    _mlaDraftTodoId = null;
    handlePrevPage();
  };
  if (!_gdIsDirty('mlassess', _mlaFormSnapshot())) { _exit(); return; }
  _showExitDialog('離開身心狀態評估表',
    () => saveMlAssessment(_mlaCurrentAnchorId),
    () => _draftMlAssessment(),
    () => _exit()
  );
}

function _draftMlAssessment() {
  const snap = _mlaFormSnapshot();
  const l = mentalLeavesData.find(x => x.id === _mlaCurrentAnchorId);
  const existingTodo = _mlaDraftTodoId ? todosData.find(t => t.id === _mlaDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'ml_assess_draft', label: '身心狀態評估表草稿',
    caseId: '', caseLabel: `${l?.name || snap.name || '—'}（學號 ${l?.studentId || snap.sid || '—'}）`,
    leaveId: _mlaCurrentAnchorId,
    draftData: { leaveId: _mlaCurrentAnchorId, snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopMlaDraftAutosave();
  try { localStorage.removeItem(_mlaDraftKey()); } catch(_) {}
  _mlaDraftTodoId = null;
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function _restoreMlAssessDraft(snap) {
  if (!snap) return;
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const sr = (name, v) => { if (!v) return; const el = document.querySelector(`[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
  sv('mla-name', snap.name); sv('mla-sid', snap.sid);
  sv('mla-collect-date', snap.collectDate); sv('mla-eval-date', snap.evalDate);
  sv('mla-assessor-note', snap.assessorNote);
  if (Array.isArray(snap.contacts)) { _mlaDraftContacts = JSON.parse(JSON.stringify(snap.contacts)); _mlaRenderContacts(); }
  (snap.bsrs || []).forEach((v, i) => { if (v !== '' && v != null) setBsrsBtn(`mla-bsrs-${i}`, v); });
  if (snap.suicide !== '' && snap.suicide != null) setBsrsBtn('mla-suicide', snap.suicide);
  sr('mla-med-psy', snap.medPsy); sr('mla-med-drug', snap.medDrug); sr('mla-med-counsel', snap.medCounsel);
  sr('mla-family', snap.family); sv('mla-family-other', snap.familyOther);
  sr('mla-partner-has', snap.partnerHas); sr('mla-partner-type', snap.partnerType); sv('mla-partner-other', snap.partnerOther);
  sr('mla-friend', snap.friend); sv('mla-friend-other', snap.friendOther);
  sr('mla-teacher', snap.teacher); sv('mla-teacher-name', snap.teacherName); sv('mla-teacher-other', snap.teacherOther);
  sr('mla-housing', snap.housing); sv('mla-housing-other', snap.housingOther);
  sv('mla-result-text', snap.resultText); sr('mla-outcome', snap.outcome); sv('mla-outcome-counselor', snap.outcomeCounselor);
  (snap.nocaseReasons || []).forEach(v => { const el = document.querySelector(`[name="mla-nocase-reason"][value="${v}"]`); if (el) el.checked = true; });
  document.querySelector('[name="mla-partner-has"]:checked')?.dispatchEvent(new Event('change'));
  document.querySelector('[name="mla-outcome"]:checked')?.dispatchEvent(new Event('change'));
  if (typeof _mlaCalcBsrsTotal === 'function') _mlaCalcBsrsTotal();
  _gdSetBaseline('mlassess', _mlaFormSnapshot());
}
// 聯繫方式／聯繫對象選項照搬「新增晤談紀錄」的介入方式／晤談對象（不含伴侶諮商，該選項為預約專用）
const ML_CONTACT_METHOD_OPTS = ['面談','視訊','團體','電話關懷','E-mail/簡訊','外展訪視','其他'];
const ML_CONTACT_TARGET_OPTS = ['學生本人','家屬','朋友','伴侶','教職員工生','資源網絡人員'];

function _mlaPeriodOptsHtml(selectedLabel) {
  return `<option value="">— 自訂時間 —</option>` + BK_PERIODS.map(x =>
    `<option value="${escHtml(x.label)}" ${selectedLabel === x.label ? 'selected' : ''}>${escHtml(x.label)}</option>`).join('');
}
function _mlaContactRowHtml(ct, idx, ro) {
  const dis = ro ? 'disabled' : '';
  const isCustom = !ct.period;
  const methodIsEmail = ct.method === 'E-mail/簡訊';
  return `<div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-weight:600;font-size:.85rem;color:#4a5568;">聯繫 #${idx + 1}</span>
      ${ro ? '' : `<button type="button" class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:1px 8px;color:#c53030;" onclick="window._mlaContactRemove(${idx})">刪除</button>`}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div><label class="field-label">日期<span class="req">*</span></label><input type="date" class="field-input" value="${escHtml(ct.date||'')}" ${dis} oninput="window._mlaContactSet(${idx},'date',this.value)"></div>
      <div>
        <label class="field-label">會談時間（節次）<span class="req">*</span></label>
        <select class="field-select" ${dis} onchange="window._mlaContactPeriodChange(${idx},this.value)">${_mlaPeriodOptsHtml(ct.period||'')}</select>
      </div>
      <div id="mla-ct-time-${idx}" style="display:${isCustom?'flex':'none'};gap:6px;align-items:flex-end;">
        <div><label class="field-label">起</label><input type="time" class="field-input" value="${escHtml(ct.timeStart||'')}" ${dis} oninput="window._mlaContactSet(${idx},'timeStart',this.value)"></div>
        <div><label class="field-label">迄</label><input type="time" class="field-input" value="${escHtml(ct.timeEnd||'')}" ${dis} oninput="window._mlaContactSet(${idx},'timeEnd',this.value)"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
      <div>
        <label class="field-label">聯繫方式<span class="req">*</span></label>
        <select class="field-select" ${dis} onchange="window._mlaContactSet(${idx},'method',this.value);const b=document.getElementById('mla-ct-methodbox-${idx}');if(b)b.style.display=this.value==='E-mail/簡訊'?'':'none';">
          ${ML_CONTACT_METHOD_OPTS.map(o=>`<option ${ct.method===o?'selected':''}>${escHtml(o)}</option>`).join('')}
        </select>
        <div id="mla-ct-methodbox-${idx}" style="display:${methodIsEmail?'':'none'};margin-top:6px;">
          <label class="field-label">E-mail／簡訊內容<span class="req">*</span></label>
          <textarea class="field-input" rows="2" style="resize:vertical;" placeholder="填寫 E-mail 或簡訊內容" ${dis} oninput="window._mlaContactSet(${idx},'methodContent',this.value)">${escHtml(ct.methodContent||'')}</textarea>
        </div>
      </div>
      <div>
        <label class="field-label">聯繫對象<span class="req">*</span></label>
        <select class="field-select" ${dis} onchange="window._mlaContactSet(${idx},'target',this.value)">
          ${ML_CONTACT_TARGET_OPTS.map(o=>`<option ${ct.target===o?'selected':''}>${escHtml(o)}</option>`).join('')}
        </select>
        <input type="text" class="field-input" style="margin-top:6px;" placeholder="備註：如○○導師" value="${escHtml(ct.targetNote||'')}" ${dis} oninput="window._mlaContactSet(${idx},'targetNote',this.value)">
      </div>
    </div>
    <div style="margin-top:8px;"><label class="field-label">聯繫經過描述<span class="req">*</span></label><textarea class="field-input" rows="2" style="resize:vertical;" ${dis} oninput="window._mlaContactSet(${idx},'description',this.value)">${escHtml(ct.description||'')}</textarea></div>
    <div style="margin-top:8px;"><label class="field-label">備註（選填）</label><textarea class="field-input" rows="2" style="resize:vertical;" ${dis} oninput="window._mlaContactSet(${idx},'note',this.value)">${escHtml(ct.note||'')}</textarea></div>
    ${ct.createdAt ? `<div style="margin-top:6px;font-size:.75rem;color:#a0aec0;">建立：${escHtml(configData?.users?.[ct.by]?.name || ct.byName || ct.by || '—')}　${escHtml((ct.createdAt||'').replace('T',' ').slice(0,16))}</div>` : ''}
  </div>`;
}
function _mlaRenderContacts() {
  const el = document.getElementById('mla-contacts-list');
  if (!el) return;
  el.innerHTML = _mlaDraftContacts.length
    ? _mlaDraftContacts.map((ct, idx) => _mlaContactRowHtml(ct, idx, _mlaCurrentReadOnly)).join('')
    : `<div style="color:#a0aec0;font-size:.85rem;padding:6px 0 10px;">尚無聯繫時間紀錄</div>`;
}
window._mlaContactSet = (idx, field, val) => { if (_mlaDraftContacts[idx]) _mlaDraftContacts[idx][field] = val; };
window._mlaContactPeriodChange = (idx, val) => {
  const ct = _mlaDraftContacts[idx]; if (!ct) return;
  if (val === '') { ct.period = ''; }
  else { const p = BK_PERIODS.find(x => x.label === val); ct.period = val; ct.timeStart = p?.start || ''; ct.timeEnd = p?.end || ''; }
  _mlaRenderContacts();
};
window._mlaContactAdd = () => {
  const updaterName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.email || '';
  _mlaDraftContacts.push({
    id: 'mlac_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    date: new Date().toISOString().slice(0, 10), period: '', timeStart: '', timeEnd: '',
    method: '電話關懷', methodContent: '', target: '學生本人', targetNote: '',
    description: '', note: '',
    createdAt: new Date().toISOString(), by: currentUser?.email, byName: updaterName,
  });
  _mlaRenderContacts();
};
window._mlaContactRemove = (idx) => {
  if (!confirm('確定要刪除這筆聯繫時間？')) return;
  _mlaDraftContacts.splice(idx, 1);
  _mlaRenderContacts();
};
// v181：快速開案整個重做（使用者退回 v179 的 confirm+導頁做法）——不得離開評估表、不得遺失已填內容。
// 案號欄「快速開案」：有歷史個案（同學號既有個案，含已刪除/曾用學號等）→ 背景直接新增本學期開案紀錄
// （同一案號，維持一學生一案號，不彈欄位視窗）；完全無個案 → 小 modal 收集最小欄位、背景建立新案。
// 兩種情形皆不離開/不重繪目前的評估表，只即時更新案號欄本身（見 mla-caseid-box）。
window._mlaQuickOpenCase = (anchorId) => {
  const l = mentalLeavesData.find(x => x.id === anchorId);
  if (!l) return;
  const _setBox = (html) => { const box = document.getElementById('mla-caseid-box'); if (box) box.innerHTML = html; };
  const _pendingHtml = `<div class="field-input" style="background:#f7fafc;color:#718096;flex:1;">開案中…</div>`;
  const _doneHtml = (caseId) => `<div class="field-input" style="background:#f7fafc;color:#718096;flex:1;">${escHtml(caseId)}</div>`;
  const _idleHtml = `<div class="field-input" style="background:#f7fafc;color:#718096;flex:1;">（尚未開案）</div><button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" onclick="window._mlaQuickOpenCase('${escHtml(anchorId)}')">快速開案</button>`;
  // v186：使用者裁決——已刪除的個案／案號一律不算「歷史」，一律走全新開案流程；
  // 案號欄顯示「（尚未開案）」時，只以「未刪除」的既有個案卡視為有歷史，已刪除的歷史案號不再攔下來
  // 要求去個案列表復原，改直接落入下方全新開案 modal（背景建案會產生一個新案號，同學號可能因此
  // 同時存在已刪除舊案號與全新案號，此為使用者確認可接受的行為）。
  const histCase = (casesData || []).find(c => c.studentId === l.studentId && !c.deleted);
  if (histCase) {
    _setBox(_pendingHtml);
    _quickReopenCaseSemBg(histCase.id, l.semester || currentSemesterPrefix(),
      (caseId) => _setBox(_doneHtml(caseId)), // onDone
      () => _setBox(_idleHtml));              // onFail：背景開案失敗，欄位還原為可再按一次「快速開案」
    return;
  }
  _showQuickOpenCaseModal({ studentId: l.studentId, name: l.name },
    (caseId) => _setBox(_doneHtml(caseId)), // onDone：背景建案完成
    () => _setBox(_pendingHtml),            // onStart：modal 按下「儲存」、驗證通過、真正開始背景建案時才切換為「開案中…」
    () => _setBox(_idleHtml));              // onFail：背景建案失敗，欄位還原為可再按一次「快速開案」
};
// v260：身心調適假渲染段拆到 dev/mental-leave.js（build 原樣複製）
window._resetMlColWidths = () => {
  const isAdmin = currentRole === '主任' || extraRole === '管理者';
  _resetTableColWidths({ table: document.getElementById('ml-records-table'), colPrefix: 'ml-col-', colNums: isAdmin ? [1,2,3,4,5,6,7,8,10] : [1,2,3,4,5,6,7,8], prefKey: 'mlColWidths2' });
};

// ══════════════════════════════════════════════
//  列印通知單
// ══════════════════════════════════════════════
function mlPrintNotices() {
  if (!_mlCheckedIds.size) { alert('請先勾選要列印的紀錄'); return; }
  const selectedRecords = mentalLeavesData.filter(l => _mlCheckedIds.has(l.id) && !l.deleted);
  if (!selectedRecords.length) { alert('無有效紀錄可列印'); return; }

  // 共用學期標籤
  const sems = [...new Set(selectedRecords.map(l => l.semester).filter(Boolean))].sort();
  const semLbl = sems.length === 1 ? semesterLabel(sems[0]) : (sems.length ? sems.map(semesterLabel).join('、') : '');
  const title2txt = semLbl ? `${semLbl} 身心調適假請假狀況通知信` : '身心調適假請假狀況通知信';

  // 列印日期 + 使用者
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const printDate = `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())}`;
  const userName = configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || currentUser?.email || '';

  // 去識別化
  function anonName(name) {
    if (!name) return '—';
    if (name.length <= 1) return name;
    if (name.length === 2) return name[0] + '○';
    return name[0] + '○'.repeat(name.length - 2) + name[name.length - 1];
  }

  // 累計天數（跨紀錄去重）
  function totalDays(recs) {
    const allDates = new Set();
    const addDay = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    recs.forEach(l => {
      const { from, to } = _mlParseDateRange(l);
      if (!from) return;
      let cur = from;
      while (cur <= (to || from)) { allDates.add(cur); cur = addDay(cur, 1); }
    });
    return allDates.size;
  }

  // 日期字串
  function dateStr(l) {
    const { from, to } = _mlParseDateRange(l);
    if (!from) return l.leaveDate || '—';
    const fmt = s => s.slice(5).replace('-', '/');
    return from !== to ? `${fmt(from)}～${fmt(to)}` : fmt(from);
  }

  // badge helpers（inline style，print-safe）
  function riskBadge(lv) {
    if (!lv) return '';
    const map = { 3:['🔴 紅燈（危機）','#c53030','#fff5f5','#fc8181'], 2:['🟡 黃燈（醫療）','#d97706','#fffbeb','#fcd34d'], 1:['🔵 關注','#2b6cb0','#ebf8ff','#bee3f8'] };
    const [lbl,c,bg,bd] = map[lv] || [];
    return lbl ? `<span style="background:${bg};color:${c};border:1px solid ${bd};border-radius:10px;padding:1px 8px;font-size:10pt;font-weight:600;white-space:nowrap;">${lbl}</span>` : '';
  }
  function tagBadge(cls, lbl) {
    const s = {consec:'#fee2e2,#c53030,#fc8181',accum:'#ebf8ff,#2b6cb0,#90cdf4'}[cls].split(',');
    return `<span style="background:${s[0]};color:${s[1]};border:1px solid ${s[2]};border-radius:10px;padding:1px 8px;font-size:10pt;font-weight:600;white-space:nowrap;">${lbl}</span>`;
  }

  // 依學生分組
  const byStudent = {};
  const sidOrder = [];
  selectedRecords.forEach(l => {
    if (!byStudent[l.studentId]) { byStudent[l.studentId] = []; sidOrder.push(l.studentId); }
    byStudent[l.studentId].push(l);
  });
  const consec3 = _mlConsecutive3DayIds(selectedRecords);

  // 剪裁線 HTML
  const cutLine = `<div style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:10pt;margin:5mm 0;page-break-inside:avoid;">` +
    `<div style="flex:1;border-top:1px dashed #bbb;"></div><span>✂</span><div style="flex:1;border-top:1px dashed #bbb;"></div></div>`;

  const cardHeader = `<div style="text-align:center;font-size:17pt;font-weight:900;letter-spacing:.06em;margin-bottom:1.5mm;">國立屏東科技大學 學生諮商中心</div>` +
    `<div style="text-align:center;font-size:13pt;font-weight:700;letter-spacing:.04em;color:#2d3748;margin-bottom:1.5mm;">${escHtml(title2txt)}</div>` +
    `<div style="text-align:right;font-size:9pt;color:#718096;margin-bottom:2.5mm;">列印日期：${escHtml(printDate)}　by ${escHtml(userName)}</div>` +
    `<div style="border-top:1px solid #e2e8f0;margin-bottom:2.5mm;"></div>`;

  const sids = [...new Set(sidOrder)];
  const blocks = sids.map(sid => {
    const recs = byStudent[sid];
    const sample = recs[0];
    const name = sample.name || '—';
    const mc = casesData.find(c => !c.deleted && c.studentId === sid);
    const caseNum = mc ? mc.id : '';
    const isConsec = consec3.has(sid);
    const days = totalDays(recs);
    const maxRisk = Math.max(0, ...recs.map(l => _mlEffectiveRisk(l).level));
    const tagHtml = isConsec ? tagBadge('consec','連請三天') : days >= 3 ? tagBadge('accum',`累計 ${days} 天`) : '';
    // 主責 + 個管（列印用，顯示姓名；無個管則不顯示個管標題）
    const counselorLbl = mc ? (formatCounselorLabel(mc.counselorEmail) || mc.counselorName || mc.counselorText || '—') : '—';
    const managers = mc ? Object.entries(configData?.users || {})
      .filter(([email, info]) => (info.allowedCases || []).includes(mc.id))
      .map(([email, info]) => info.name || email) : [];
    const staffLine = mc
      ? `<div style="font-size:12pt;font-weight:400;color:#4a5568;margin-top:1mm;">主責：${escHtml(counselorLbl)}${managers.length ? `　個管：${escHtml(managers.join('、'))}` : ''}</div>`
      : '';
    const headerId = caseNum
      ? `${escHtml(caseNum)}（${escHtml(anonName(name))} / ${escHtml(sid)}）`
      : `${escHtml(anonName(name))} / ${escHtml(sid)}`;
    const sorted = [...recs].sort((a,b) => (_mlParseDateRange(a).from||'').localeCompare(_mlParseDateRange(b).from||''));
    const rows = sorted.map(l =>
      `<div style="padding:1.5mm 0;font-size:11pt;color:#2d3748;border-bottom:1px dotted #edf2f7;">` +
      `請假日期：${escHtml(dateStr(l))}　請假原因：${escHtml(l.reason||'（未填）')}</div>`
    ).join('');
    return `<div style="page-break-inside:avoid;border:1px solid #cbd5e0;border-radius:5px;padding:4mm 6mm;">` +
      cardHeader +
      `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12pt;font-weight:700;margin-bottom:2mm;">` +
      `<span>${headerId}</span>${tagHtml?`<span>${tagHtml}</span>`:''}<span>${riskBadge(maxRisk)}</span></div>` +
      staffLine +
      rows + `</div>`;
  });

  const body = blocks.join(cutLine);

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title></title>
<style>
  @page { size: A4 portrait; margin: 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft JhengHei','微軟正黑體','Noto Sans TC',sans-serif; font-size:12pt; line-height:1.65; color:#1a202c; margin:0; padding:0; }
</style>
</head>
<body>${body}</body>
</html>`;

  const win = window.open('', '_blank', 'width=820,height=1060');
  if (!win) { alert('請允許彈出視窗以開啟列印預覽'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 700);
}

window._mlDeduplicateRecords = async () => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const fp = l => [norm(l.studentId), norm(l.name), norm(l.leaveDate), norm(l.leaveDateTo), norm(l.reason), norm(l.semester)].join('|');
  const STATUS_RANK = { '已致電關懷': 4, '已簡訊關懷': 3, '待處理': 2, '非危機': 1 };
  const groups = {};
  mentalLeavesData.forEach(l => {
    if (l.deleted) return;
    if (!l.studentId && !l.name) return;
    const k = fp(l);
    if (!groups[k]) groups[k] = [];
    groups[k].push(l);
  });
  let removed = 0;
  Object.values(groups).forEach(grp => {
    if (grp.length <= 1) return;
    // 優先保留受理情況最進階的，其次最早收到
    grp.sort((a, b) => {
      const sd = (STATUS_RANK[b.handlingStatus] || 0) - (STATUS_RANK[a.handlingStatus] || 0);
      if (sd !== 0) return sd;
      return (a.receivedAt || a.parsedAt || '') < (b.receivedAt || b.parsedAt || '') ? -1 : 1;
    });
    for (let i = 1; i < grp.length; i++) {
      grp[i].deleted = true;
      grp[i].deletedAt = new Date().toISOString();
      grp[i].deletedBy = '_dedup_content';
      removed++;
    }
  });
  if (!removed) { showToast('沒有找到重複紀錄', 'info'); return; }
  if (!confirm(`找到 ${removed} 筆重複紀錄（相同請假內容被重複擷取）。\n\n保留原則：優先保留受理情況較進階的，其次保留最早收到的。\n\n確定清除？`)) return;
  const jobId = bgJobAdd(`清除重複身心調適假紀錄（${removed} 筆）`);
  try {
    await saveMentalLeaves();
    bgJobDone(jobId);
    auditLog('清除重複身心調適假紀錄', null, null, `${removed} 筆（內容比對）`);
    showToast(`已清除 ${removed} 筆重複紀錄`, 'success');
    renderMentalLeavePage();
  } catch(e) { bgJobFail(jobId, e.message); }
};

window._mlDeleteRecord = async (id) => {
  if (!confirm('確定刪除此筆請假紀錄？')) return;
  const r = mentalLeavesData.find(l => l.id === id);
  if (!r) return;
  r.deleted = true; r.deletedAt = new Date().toISOString(); r.deletedBy = currentUser?.email;
  renderMentalLeavePage();
  const jobId = bgJobAdd(`刪除身心調適假紀錄：${r.name||r.studentId}`);
  try { await saveMentalLeaves(); bgJobDone(jobId); auditLog('刪除身心調適假紀錄', null, null, `${r.name} ${r.studentId}`); }
  catch(e) { delete r.deleted; delete r.deletedAt; delete r.deletedBy; bgJobFail(jobId, e.message); }
};

window._mlCreateFetchWin = (totalY, isAuto) => {
  const old = document.getElementById('ml-fetch-win');
  if (old) old.remove();
  const win = document.createElement('div');
  win.id = 'ml-fetch-win';
  win.style.cssText = 'position:fixed;right:24px;top:80px;width:288px;background:#fff;border:1px solid #cbd5e0;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.16);z-index:9999;user-select:none;font-family:inherit;';
  const headerBg = isAuto ? '#276749' : '#2b6cb0';
  const headerTitle = isAuto ? '🔄 自動擷取身心調適假' : '📥 從信箱擷取身心調適假';
  const autoNote = isAuto ? `<div style="font-size:10px;color:#718096;margin-top:4px;">這是自動擷取，關閉此視窗不影響擷取進度</div>` : '';
  win.innerHTML = `
    <div id="ml-fw-header" style="background:${headerBg};color:#fff;padding:8px 12px;border-radius:7px 7px 0 0;cursor:move;font-size:13px;font-weight:600;">
      ${headerTitle}
    </div>
    <div style="padding:12px 14px;">
      <div id="ml-fw-status" style="font-size:12px;color:#4a5568;margin-bottom:6px;">掃描未讀信件數量…</div>
      <div style="background:#e2e8f0;border-radius:4px;height:10px;overflow:hidden;margin-bottom:8px;">
        <div id="ml-fw-bar" style="height:100%;background:#3182ce;width:0%;transition:width .4s ease;"></div>
      </div>
      <div id="ml-fw-count" style="font-size:15px;font-weight:700;color:#2d3748;margin-bottom:4px;">0 / ${totalY ?? '?'}</div>
      <div id="ml-fw-new" style="font-size:12px;color:#2f855a;"></div>
      <div id="ml-fw-hint" style="font-size:11px;color:#e53e3e;margin-top:6px;display:none;line-height:1.5;"></div>
      ${autoNote}
      <div style="display:flex;gap:6px;margin-top:10px;">
        ${isAuto
          ? `<button id="ml-fw-abort" disabled style="flex:1;padding:6px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;cursor:not-allowed;font-size:13px;color:#a0aec0;">中斷</button>`
          : `<button id="ml-fw-abort" style="flex:1;padding:6px;background:#fff5f5;border:1px solid #fc8181;border-radius:4px;cursor:pointer;font-size:13px;color:#c53030;" onclick="window._mlAbortFetch()">中斷</button>`}
        <button id="ml-fw-done" style="flex:1;padding:6px;background:#e2e8f0;border:none;border-radius:4px;cursor:pointer;font-size:13px;opacity:.5;" disabled onclick="document.getElementById('ml-fetch-win').remove()">完成</button>
      </div>
    </div>`;
  // heart5 靜默化：自動擷取（登入後背景觸發）不顯示浮動視窗，整個過程靜默——window 節點仍建立供
  // 進度 querySelector 寫入（no-op），但不掛到畫面上；只有手動「📥 從信箱擷取」才顯示視窗。
  if (!isAuto) document.body.appendChild(win);
  const header = win.querySelector('#ml-fw-header');
  let ox = 0, oy = 0, dragging = false;
  header.addEventListener('pointerdown', e => {
    dragging = true;
    const r = win.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', e => {
    if (!dragging) return;
    win.style.left = (e.clientX - ox) + 'px';
    win.style.top  = (e.clientY - oy) + 'px';
    win.style.right = 'auto';
  });
  header.addEventListener('pointerup', () => { dragging = false; });
  return win;
};

window._mlAbortFetch = () => {
  _mlFetchAborted = true;
  const ab = document.getElementById('ml-fw-abort');
  if (ab) { ab.disabled = true; ab.textContent = '中斷中…'; }
};

window._mlFetch = async (isAuto) => {
  _mlFetchAborted = false;
  const btn = isAuto ? null : document.querySelector('[onclick="window._mlFetch()"]');
  const jobId = bgJobAdd(isAuto ? '自動擷取身心調適假' : '從信箱擷取身心調適假');

  const _restoreBtn = () => {
    if (!btn) return;
    btn.disabled = false;
    btn.style.cssText = '';
    btn.innerHTML = '';
    btn.textContent = '📥 從信箱擷取';
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = '擷取中…';
  }

  try {
    {
      // 一般擷取：先掃描總數，再分批擷取最多 200 封，進度浮動視窗
      const win = _mlCreateFetchWin(null, isAuto);
      const _winStatus = t => { const el = win.querySelector('#ml-fw-status'); if (el) el.textContent = t; };
      const _winCount  = t => { const el = win.querySelector('#ml-fw-count');  if (el) el.textContent = t; };
      const _winNew    = t => { const el = win.querySelector('#ml-fw-new');    if (el) el.textContent = t; };
      const _winPct    = p => { const el = win.querySelector('#ml-fw-bar');    if (el) el.style.width = p + '%'; };
      const _winDone   = ()=> {
        const done = win.querySelector('#ml-fw-done'); if (done) { done.disabled = false; done.style.opacity = '1'; }
        const ab   = win.querySelector('#ml-fw-abort'); if (ab)  { ab.disabled = true; ab.style.opacity = '.4'; ab.style.cursor = 'not-allowed'; }
      };
      try {
        // 掃描未處理信件數
        const countResult = await proxyCall('countMentalLeavesUnprocessed');
        if (countResult?.needsAuth) {
          bgJobFail(jobId, '需要 Gmail 授權'); if (!isAuto) _mlShowAuthModal(countResult.authUrl); // 自動擷取不彈授權窗（登入時擾民），改由手動擷取或稍後重試
          _winStatus('需要重新授權'); _winDone(); return;
        }
        const rawCount = countResult.count ?? 0;
        const displayY = countResult.hasMore ? rawCount + '+' : String(rawCount);
        _winCount(`0 / ${displayY}`);
        _winStatus('擷取中…');

        const BATCH_SIZE = 20, MAX_TOTAL = 200;
        let processed = 0, totalNew = 0, lastBatch = 0;
        while (processed < MAX_TOTAL) {
          if (_mlFetchAborted) break;
          const result = await proxyCall('fetchMentalLeaves', { batchSize: BATCH_SIZE });

          if (result?.status === 'locked') {
            if (isAuto) { win.remove(); bgJobDone(jobId); return; }
            _winStatus('另一工作階段正在擷取中，請稍後再試'); _winDone(); return;
          }
          if (result?.needsAuth) {
            bgJobFail(jobId, '需要 Gmail 授權'); if (!isAuto) _mlShowAuthModal(result.authUrl); // 自動擷取不彈授權窗
            _winStatus('需要重新授權'); _winDone(); return;
          }
          lastBatch = result.batchCount ?? 0;
          processed += lastBatch;
          totalNew  += result.newCount ?? 0;
          _winPct(Math.min(100, Math.round(processed / MAX_TOTAL * 100)));
          _winCount(`${processed} / ${displayY}`);
          _winNew(`本次新增：${totalNew} 筆`);
          await loadMentalLeaves(); renderMentalLeavePage();
          if (lastBatch < BATCH_SIZE) break; // 信件已耗盡
        }
        _checkMlCumulativeTodos();
        await _checkMlNewLeaveTodos().catch(() => {});
        // 身心狀態評估表（#030-⑤）：新紀錄符合「非受輔生＋紅燈/連請三日」→ 通知所有窗口填寫（防重複由紀錄標記把關）
        await _mlNotifyAssessmentDue().catch(() => {});
        renderMentalLeavePage();

        if (_mlFetchAborted) {
          bgJobDone(jobId);
          auditLog('從信箱擷取身心調適假（中斷）', null, null, `已擷取 ${processed} 封，新增 ${totalNew} 筆`);
          _winStatus(`已中斷，擷取 ${processed} / ${displayY} 封（新增 ${totalNew} 筆）`);
          const ab = document.getElementById('ml-fw-abort');
          if (ab) { ab.disabled = true; ab.textContent = '已中斷'; }
        } else {
          const stillMore = processed >= MAX_TOTAL && lastBatch >= BATCH_SIZE;
          bgJobDone(jobId);
          auditLog('從信箱擷取身心調適假', null, null,
            `擷取 ${processed} 封，新增 ${totalNew} 筆${stillMore ? '，尚有更多' : ''}`);
          // heart5 靜默化：自動擷取整程無視窗，只有真的抓到新請假信才輕量提示一次（0 筆完全靜默）
          if (isAuto && totalNew > 0) showToast(`身心調適假：背景擷取到 ${totalNew} 筆新請假信`, 'info');
          _winPct(100);
          if (stillMore) {
            _winStatus('首批 200 封已完成');
            const hint = win.querySelector('#ml-fw-hint');
            if (hint) { hint.innerHTML = '尚有更多未擷取信件，請<button onclick="document.getElementById(\'ml-fetch-win\').remove();window._mlFetch()" style="background:none;border:none;color:#2b6cb0;cursor:pointer;font-size:11px;font-weight:700;padding:0 2px;text-decoration:underline;">📥 點此繼續擷取</button>'; hint.style.display = 'block'; }
          } else {
            _winStatus('擷取完成');
          }
        }
        _winDone();
      } catch(e2) {
        bgJobFail(jobId, e2.message);
        _winStatus('擷取失敗：' + e2.message); _winDone();
        alert('從信箱擷取失敗：' + e2.message);
      }
      return;
    }
  } catch(e) {
    bgJobFail(jobId, e.message);
    alert('從信箱擷取失敗：' + e.message);
  } finally {
    _restoreBtn();
  }
};

// 重新解析所有已擷取的信件（用來補上舊資料缺少的節次等欄位）
// 保留使用者管理欄位：handlingStatus、acknowledgedBy、deleted、deletedAt、deletedBy
window._mlReparse = async () => {
  if (!confirm('重新解析所有已擷取的信件？\n\n用途：補上舊資料缺少的節次、課名等欄位。\n保留：受理情況、已閱、已刪除等使用者狀態。\n\n可能需要數十秒至數分鐘（依信件數）。')) return;
  const btn = document.querySelector('[onclick="window._mlReparse()"]');
  if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
  const jobId = bgJobAdd('重新解析身心調適假信件');
  const BATCH = 50, MAX_ROUNDS = 40;
  let totalUpdated = 0, totalProcessed = 0, rounds = 0;
  try {
    let hasMore = true;
    let nextToken = null; // 第一次強制從頭開始，避免受前次 fetch 遺留的 pageToken 影響
    while (hasMore && rounds < MAX_ROUNDS) {
      rounds++;
      const result = await proxyCall('fetchMentalLeaves', { reparse: true, batchSize: BATCH, pageToken: nextToken });
      if (result?.needsAuth) {
        bgJobFail(jobId, '需要 Gmail 授權'); _mlShowAuthModal(result.authUrl);
        return;
      }
      totalUpdated += result.updatedCount ?? 0;
      totalProcessed += result.batchCount ?? 0;
      hasMore = !!result.hasMore;
      nextToken = result.nextPageToken || null;
      if (btn) btn.textContent = `解析中… (${totalProcessed} 封 / 更新 ${totalUpdated})`;
      if (!result.batchCount) break;
    }
    await loadMentalLeaves();
    renderMentalLeavePage();
    bgJobDone(jobId);
    auditLog('重新解析身心調適假信件', null, null, `處理 ${totalProcessed} 封，更新 ${totalUpdated} 筆`);
    showToast(`重新解析完成：處理 ${totalProcessed} 封，更新 ${totalUpdated} 筆${rounds >= MAX_ROUNDS ? '（達最大回合數，可再點一次繼續）' : ''}`, 'success');
  } catch(e) {
    bgJobFail(jobId, e.message);
    alert('重新解析失敗：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 重新解析舊信件'; }
  }
};

window._mlClearAll = async () => {
  if (!confirm('確定清空所有身心調適假測試資料？\n（Drive 的 mental_leaves.json 會被清空，Gmail 的 ml-processed 標籤也會移除，讓信件下次重新擷取。）')) return;
  const btn = document.querySelector('[onclick="window._mlClearAll()"]');
  if (btn) { btn.disabled = true; btn.textContent = '清空中…'; }
  const jobId = bgJobAdd('清空身心調適假測試資料');
  try {
    const result = await proxyCall('clearMentalLeaves');
    mentalLeavesData = [];
    renderMentalLeavePage();
    bgJobDone(jobId);
    auditLog('清空身心調適假測試資料', null, null, `移除 ${result.removedLabels ?? 0} 個 ml-processed 標籤`);
    showToast(`已清空（移除 ${result.removedLabels ?? 0} 個 ml-processed 標籤）`);
  } catch(e) {
    bgJobFail(jobId, e.message);
    alert('清空失敗：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ 清空測試資料'; }
  }
};

function _mlShowAuthModal(authUrl) {
  document.getElementById('ml-auth-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ml-auth-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;';
  m.innerHTML = `<div style="background:#fff;border-radius:14px;padding:30px 34px;max-width:460px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.18);">
    <div style="font-size:2rem;margin-bottom:10px;">🔑</div>
    <h3 style="margin:0 0 8px;font-size:1.05rem;color:#1a202c;">需要 npust5 Gmail 授權</h3>
    <p style="color:#718096;font-size:.88rem;margin-bottom:22px;line-height:1.6;">點「前往授權」，以 <strong>heartnpust5@gmail.com</strong> 帳號登入並允許存取。<br>授權完成後彈出視窗會自動關閉。</p>
    <div id="ml-auth-status" style="display:none;color:#059669;font-size:.9rem;margin-bottom:12px;"></div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button id="ml-auth-btn" class="btn btn-primary">前往授權 ↗</button>
      <button class="btn btn-secondary" onclick="document.getElementById('ml-auth-modal').remove()">關閉</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  document.getElementById('ml-auth-btn').addEventListener('click', () => _mlOpenAuthPopup(authUrl));
}

function _mlOpenAuthPopup(authUrl) {
  const w = 520, h = 620;
  const left = Math.max(0, (screen.width - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);
  const popup = window.open(authUrl, 'npust5Auth', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`);
  if (!popup) { alert('請允許彈出視窗後再試'); return; }

  const handler = async (e) => {
    if (e.data?.type !== 'npust5_oauth') return;
    window.removeEventListener('message', handler);
    const statusEl = document.getElementById('ml-auth-status');
    const btnEl    = document.getElementById('ml-auth-btn');
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '交換 token 中…'; }
    if (btnEl) btnEl.disabled = true;
    try {
      const result = await proxyCall('exchangeNpust5OAuthCode', { code: e.data.code, state: e.data.state });
      if (result?.ok) {
        if (statusEl) statusEl.textContent = '✅ 授權成功！正在擷取信件…';
        setTimeout(() => { document.getElementById('ml-auth-modal')?.remove(); window._mlFetch(); }, 800);
      } else {
        if (statusEl) { statusEl.style.color = '#dc2626'; statusEl.textContent = '❌ 授權失敗：' + (result?.error || '未知'); }
        if (btnEl) btnEl.disabled = false;
      }
    } catch(err) {
      if (statusEl) { statusEl.style.color = '#dc2626'; statusEl.textContent = '❌ 錯誤：' + err.message; }
      if (btnEl) btnEl.disabled = false;
    }
  };
  window.addEventListener('message', handler);
}

// ── 關鍵字設定 Tab ─────────────────────────────────────
let _mlKwView = 'cards'; // 'cards' | 'table'
let _mlKwHostEl = null;  // 目前渲染關鍵字庫的容器（身心調適假頁 or 使用者管理頁），供異動後就地重繪
// 就地重繪目前顯示中的關鍵字庫（不論身在哪一頁）；容器已不在畫面上則退回整頁重繪
function _mlRerenderKw() {
  if (_mlKwHostEl && _mlKwHostEl.isConnected) _mlRenderKeywordsTab(_mlKwHostEl);
  else if (typeof renderMentalLeavePage === 'function') renderMentalLeavePage();
}
function _mlRenderKeywordsTab(el) {
  _mlKwHostEl = el;
  const kws = _mlKeywords();
  const usingDefault = !Array.isArray(configData?.mentalLeaveKeywords) || !configData.mentalLeaveKeywords.length;
  const levelLabel = { 3: '🔴 紅燈（危機）', 2: '🟡 黃燈（醫療）', 1: '🔵 關注' };
  const levelColor = { 3: '#c53030', 2: '#d97706', 1: '#2b6cb0' };
  const levelBg    = { 3: '#fff5f5',  2: '#fffbeb',  1: '#eff6ff' };
  const levelBorder = { 3: '#fc8181', 2: '#fbd38d', 1: '#90cdf4' };

  const tableRows = kws.map((k, i) => `
    <tr>
      <td style="padding:7px 10px;"><span style="font-size:.88rem;font-weight:600;">${escHtml(k.kw)}</span></td>
      <td style="padding:7px 10px;"><span style="background:${levelBg[k.level]||'#f7fafc'};color:${levelColor[k.level]||'#718096'};border-radius:12px;padding:2px 10px;font-size:.8rem;font-weight:600;">${levelLabel[k.level]||k.level}</span></td>
      <td style="padding:7px 10px;">
        <button class="btn btn-danger btn-sm" onclick="window._mlDeleteKw(${i})">刪除</button>
      </td>
    </tr>`).join('');

  const cardsHtml = [3, 2, 1].map(lv => {
    const group = kws.map((k, i) => ({ ...k, _i: i })).filter(k => k.level === lv);
    const chips = group.map(k => `
      <span draggable="true" ondragstart="_mlKwDragStart(event, ${k._i})" style="display:inline-flex;align-items:center;gap:4px;background:${levelBg[lv]};color:${levelColor[lv]};border:1px solid ${levelBorder[lv]};border-radius:20px;padding:4px 10px 4px 12px;font-size:.82rem;font-weight:600;margin:3px;cursor:grab;" title="可拖曳到其他燈號改變風險等級">
        ${escHtml(k.kw)}
        <button onclick="window._mlDeleteKw(${k._i})" style="background:none;border:none;cursor:pointer;color:${levelColor[lv]};font-size:.8rem;line-height:1;padding:0 0 0 2px;opacity:.7;" title="刪除">✕</button>
      </span>`).join('');
    return `<div ondragover="event.preventDefault();this.style.outline='2px dashed ${levelColor[lv]}';this.style.outlineOffset='-2px';" ondragleave="this.style.outline='';" ondrop="this.style.outline='';_mlKwDrop(event, ${lv})" style="border:1.5px solid ${levelBorder[lv]};border-radius:10px;padding:14px 16px;background:${levelBg[lv]};margin-bottom:12px;">
      <div style="font-weight:700;color:${levelColor[lv]};font-size:.92rem;margin-bottom:10px;">${levelLabel[lv]} <span style="font-size:.72rem;font-weight:400;color:#718096;">（可將關鍵字拖曳至此改為此燈號）</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:0;min-height:24px;">
        ${chips || `<span style="color:#a0aec0;font-size:.82rem;">（無關鍵字，可從其他燈號拖曳至此）</span>`}
      </div>
    </div>`;
  }).join('');

  const analysisLogs = Array.isArray(configData?.mlAnalysisLogs) ? configData.mlAnalysisLogs : [];
  const logsHtml = analysisLogs.length ? analysisLogs.map((lg, i) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:10px;position:relative;">
      <div style="font-size:.78rem;color:#718096;margin-bottom:4px;">${escHtml(lg.date||'')} · ${escHtml(lg.analyst||'')}</div>
      <div style="font-size:.87rem;color:#2d3748;white-space:pre-wrap;">${escHtml(lg.note||'')}</div>
      <button onclick="window._mlDeleteAnalysisLog(${i})" style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:#e53e3e;font-size:.8rem;">✕</button>
    </div>`).join('') : `<div style="color:#a0aec0;font-size:.85rem;padding:8px 0;">尚無分析備忘記錄</div>`;

  el.innerHTML = `
    ${usingDefault ? '<div style="background:#fffbeb;border:1px solid #f6d860;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.84rem;color:#744210;">⚠ 目前使用<strong>系統預設關鍵字庫</strong>。新增或刪除任何關鍵字後，設定將獨立儲存至本系統設定檔。</div>' : ''}
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:20px;">
      <h4 style="margin:0 0 12px;font-size:.92rem;color:#2d3748;">新增關鍵字</h4>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="ml-kw-new" class="field-input" placeholder="關鍵字（如：失眠）" style="max-width:160px;" maxlength="20">
        <select id="ml-kw-level" class="field-input" style="width:auto;">
          <option value="3">🔴 紅燈（危機）</option>
          <option value="2" selected>🟡 黃燈（醫療）</option>
          <option value="1">🔵 關注</option>
        </select>
        <button class="btn btn-primary" onclick="window._mlAddKw()">新增</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <span style="font-size:.88rem;color:#4a5568;font-weight:600;">關鍵字庫（共 ${kws.length} 筆）</span>
      <div style="display:flex;gap:6px;">
        <button onclick="_mlKwView='cards';_mlRerenderKw();" style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:6px 0 0 6px;background:${_mlKwView==='cards'?'#2d6a4f':'#fff'};color:${_mlKwView==='cards'?'#fff':'#4a5568'};cursor:pointer;font-size:.82rem;">🃏 卡片</button>
        <button onclick="_mlKwView='table';_mlRerenderKw();" style="padding:4px 12px;border:1px solid #cbd5e0;border-left:none;border-radius:0 6px 6px 0;background:${_mlKwView==='table'?'#2d6a4f':'#fff'};color:${_mlKwView==='table'?'#fff':'#4a5568'};cursor:pointer;font-size:.82rem;">☰ 列表</button>
      </div>
    </div>
    ${_mlKwView === 'cards'
      ? cardsHtml
      : `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.875rem;">
          <thead><tr style="background:#f7fafc;text-align:left;">
            <th style="padding:8px 10px;">關鍵字</th>
            <th style="padding:8px 10px;">風險等級</th>
            <th style="padding:8px 10px;"></th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>`
    }
    ${usingDefault ? '' : `<div style="margin-top:14px;"><button class="btn btn-secondary btn-sm" onclick="window._mlResetKw()">還原預設關鍵字庫</button></div>`}
    <div style="margin-top:28px;">
      <h4 style="margin:0 0 12px;font-size:.92rem;color:#2d3748;display:flex;align-items:center;gap:10px;">
        📊 AI 分析備忘記錄
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('ml-al-form').style.display=document.getElementById('ml-al-form').style.display==='none'?'block':'none'">+ 新增備忘</button>
      </h4>
      <div id="ml-al-form" style="display:none;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
          <label style="font-size:.84rem;color:#4a5568;">分析日期：</label>
          <input type="date" id="ml-al-date" class="field-input" value="${new Date().toISOString().slice(0,10)}" style="width:auto;">
        </div>
        <textarea id="ml-al-note" class="field-input" rows="5" placeholder="分析內容、關鍵字變更原因、命中率、建議…" style="width:100%;resize:vertical;font-family:inherit;"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="window._mlSaveAnalysisLog()">儲存備忘</button>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('ml-al-form').style.display='none'">取消</button>
        </div>
      </div>
      ${logsHtml}
    </div>`;
}

window._mlAddKw = async () => {
  const kwEl = document.getElementById('ml-kw-new');
  const kw = kwEl?.value.trim();
  if (!kw) { alert('請輸入關鍵字'); return; }
  const level = parseInt(document.getElementById('ml-kw-level')?.value || '2');
  const kws = [..._mlKeywords()];
  if (kws.some(k => k.kw === kw)) { alert('關鍵字已存在：' + kw); return; }
  kws.push({ kw, level });
  if (!configData) configData = {};
  configData.mentalLeaveKeywords = kws;
  if (kwEl) kwEl.value = '';
  _mlRerenderKw();
  const levelLabel = { 3: '紅燈', 2: '黃燈', 1: '藍燈' };
  const jobId = bgJobAdd(`新增關鍵字：${kw}`);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); auditLog('新增身心調適假關鍵字', null, null, `${kw}（${levelLabel[level] || level}）`); }
  catch(e) { bgJobFail(jobId, e.message); }
};

window._mlDeleteKw = async (i) => {
  const kws = [..._mlKeywords()];
  if (!kws[i] || !confirm(`確定刪除關鍵字「${kws[i].kw}」？`)) return;
  const deleted = kws[i];
  kws.splice(i, 1);
  if (!configData) configData = {};
  configData.mentalLeaveKeywords = kws;
  _mlRerenderKw();
  const jobId = bgJobAdd(`刪除關鍵字：${deleted.kw}`);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); auditLog('刪除身心調適假關鍵字', null, null, deleted.kw); }
  catch(e) { bgJobFail(jobId, e.message); }
};

window._mlResetKw = async () => {
  if (!confirm('確定還原為系統預設關鍵字庫？目前自訂設定將被清除。')) return;
  if (configData) delete configData.mentalLeaveKeywords;
  _mlRerenderKw();
  const jobId = bgJobAdd('還原預設關鍵字庫');
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); auditLog('還原身心調適假預設關鍵字庫'); }
  catch(e) { bgJobFail(jobId, e.message); }
};

// #2：跨燈號拖曳——把關鍵字拖到另一個燈號卡片即改變其風險等級（連動同一份 configData.mentalLeaveKeywords）
let _mlKwDragIdx = null;
window._mlKwDragStart = (e, idx) => {
  _mlKwDragIdx = idx;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
};
window._mlKwDrop = async (e, level) => {
  if (e && e.preventDefault) e.preventDefault();
  let idx = _mlKwDragIdx;
  if (idx == null) { try { idx = parseInt(e.dataTransfer.getData('text/plain'), 10); } catch (_) {} }
  _mlKwDragIdx = null;
  const kws = [..._mlKeywords()];
  if (idx == null || isNaN(idx) || !kws[idx] || kws[idx].level === level) return;
  const kw = kws[idx].kw;
  kws[idx] = { ...kws[idx], level };
  if (!configData) configData = {};
  configData.mentalLeaveKeywords = kws;
  _mlRerenderKw();
  const levelLabel = { 3: '紅燈', 2: '黃燈', 1: '藍燈' };
  const jobId = bgJobAdd(`調整關鍵字燈號：${kw}`);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); auditLog('調整身心調適假關鍵字燈號', null, null, `${kw}→${levelLabel[level] || level}`); }
  catch (e2) { bgJobFail(jobId, e2.message); }
};

window._mlSaveAnalysisLog = async () => {
  const date = document.getElementById('ml-al-date')?.value || new Date().toISOString().slice(0,10);
  const note = document.getElementById('ml-al-note')?.value.trim();
  if (!note) { alert('請輸入分析備忘內容'); return; }
  if (!configData) configData = {};
  if (!Array.isArray(configData.mlAnalysisLogs)) configData.mlAnalysisLogs = [];
  configData.mlAnalysisLogs.unshift({ date, analyst: currentUser?.email || '未知', note, savedAt: new Date().toISOString() });
  _mlRerenderKw();
  const jobId = bgJobAdd('儲存分析備忘');
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); auditLog('新增身心調適假分析備忘', null, null, date); }
  catch(e) { bgJobFail(jobId, e.message); }
};

window._mlDeleteAnalysisLog = async (i) => {
  if (!confirm('確定刪除此筆分析備忘？')) return;
  if (!Array.isArray(configData?.mlAnalysisLogs)) return;
  configData.mlAnalysisLogs.splice(i, 1);
  _mlRerenderKw();
  const jobId = bgJobAdd('刪除分析備忘');
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); bgJobDone(jobId); }
  catch(e) { bgJobFail(jobId, e.message); }
};
function _upsertPsychTestDB(sid, sem, result) {
  if (!sid) return;
  if (!psychTestDB[sid]) psychTestDB[sid] = [];
  const idx = sem ? psychTestDB[sid].findIndex(t => t.testSemester === sem) : -1;
  if (idx >= 0) psychTestDB[sid][idx] = result; else psychTestDB[sid].push(result);
}

