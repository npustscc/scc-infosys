// dev/booking.js — 空間預約模組（拆 index.html 絞殺者第二十刀，v267）。
// 內容為從 index.html 逐字搬出的三段（原 21138~21483、21498~21837、24608~27491 行，
// 段間原有的 GC 事件驗證／身心調適假／列印通知單／心理測驗資料庫等區塊留在主檔）：
// 空間預約主區段（狀態/渲染/系列/GC 同步佇列）、時段格線與使用率統計、拖曳衝突
// 修正 modal、空間與人員選擇器 chips、系列預覽 modal、表單草稿備援與離開防護、
// saveBooking/deleteBooking。原區段內累積的跨模組全域（transferData／psychTestDB／
// mentalLeavesData／_mlCheckedIds／ML_DEFAULT_KEYWORDS）刻意留在主檔未搬。
// 載入期副作用（column-0 複核）僅一處：document click 監聽（收合 bk-ctx-menu 浮動
// 選單）——開啟入口 _bkCtxMenu 有 event.stopPropagation()，不經 document 層，故註冊
// 順序前移無行為差異。其餘頂層皆 function/const/純 let，初始化式僅字面值、
// new Set/Map、parseInt(localStorage...)，無主檔識別字引用，可安全前移到主 inline
// script 之前載入（刀法①）。函式內部呼叫時才引用主檔全域（BK_PERIODS／ROOMS／
// casesData／configData 等），跨 script 全域可見。
// ══════════════════════════════════════════════
//  空間預約
// ══════════════════════════════════════════════
let bookingsData = [];
let _editingBookingId = null;
let _bkEditScope = 'this'; // 'this' | 'future' | 'all'
// v162：從「檢視此系列預約」清單點選某筆進入編輯時記錄來源（{ seriesId }），
// 供 editBooking 略過範圍選擇、直接進入單筆編輯並鎖定僅此筆；離開編輯（儲存成功／取消關閉）
// 由 closeBookingModal() 據此自動返回本清單。只有此入口會設定；一般編輯／新增／複製一律為 null。
let _bkSeriesViewReturn = null;

// T3：系列編輯範圍確認
function _bkConfirmSeriesScope(scope) {
  _bkEditScope = scope;
  document.getElementById('bk-series-scope-modal').style.display = 'none';
  document.getElementById('booking-modal').style.display = 'flex';
  _bkModalResizeSetup();
  _bkUpdateScopeInfo();
  _checkBkConflict();
}

// v163：「檢視此系列預約」清單與「原規劃」比對——系列預約未存建立當下的原始規則或逐筆快照
// （新增/系列重排時只落地最終欄位值，見 saveBooking），且刪除為直接從 bookingsData 移除、無墓碑欄位，
// 故無法採方案 A／B（無原始規則可查、無法回溯已刪除筆的快照）。改採方案 C：以系列「現存筆數」的多數值
// 反推基準——日期比對「星期幾」或「每月同一天」兩種規律何者較符合多數（皆未過半則不判斷日期）；
// 節次（起訖時間）、空間各自獨立取多數值，未過半（如剛好各半）不判斷、不誤標。
// 刪除偵測：僅在相鄰日期差存在明確多數（固定天數頻率，如每週/每兩週）時，以該頻率從最早一筆推算到
// 最晚一筆之間「應有但目前不存在」的日期，視為疑似被刪除的原規劃筆；頻率不固定（如每月，日差不固定）
// 或資料點過少則不推算，只做偏離醒目標示。
// v165：新建系列／整系列重排（見 saveBooking）起，成員預約會落地 seriesPlan/planDate 原規劃快照
// （同一批次共用同一 seriesPlan.stampedAt「代別」）。若清單全員帶「同一代」快照 → 精確模式：
// 逐筆直接比 x.date vs x.planDate、x.room/customRoom/startTime/endTime vs x.seriesPlan 本身，
// 不再靠多數值猜；刪除偵測＝seriesPlan.dates（原規劃全部日期）減去現存成員的 planDate 集合，
// 缺的就是精確已刪除場次（非推算）。若快照缺漏或代別混雜（例如「此筆之後」重排過一部分、或
// 舊系列後來手動加了新筆）→ 有自己快照的筆仍逐筆精確比對（用自己那份 seriesPlan，不同代之間
// 互不影響），沒有快照的筆退回沿用 legacy 多數值反推；刪除偵測則整體退回 v163 推算法（混代的
// dates 若取聯集，會把被合法取代的舊日期誤報成刪除，寧可保守退回推算）。舊資料（完全無快照）
// 行為與 v163 完全相同。純函式（無 DOM／無日期以外的外部依賴），供 _bkRenderSeriesListModal
// 呼叫，亦供單元測試（test/booking-series-diff.test.js）。
// list：同一 seriesId 的預約物件陣列（不要求已排序），至少含 id/date/startTime/endTime/room/customRoom，
// 可選 seriesPlan（{dates,startTime,endTime,room,customRoom,stampedAt}）/planDate。
function _bkSeriesDiffAnalyze(list) {
  const mode = (arr) => {
    const cnt = new Map();
    arr.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1));
    let best = null, bestN = 0;
    cnt.forEach((n, v) => { if (n > bestN) { bestN = n; best = v; } });
    return { value: best, count: bestN };
  };
  const roomKeyOf = x => x.room === '其他' ? `其他::${x.customRoom || ''}` : (x.room || '');
  const periodKeyOf = x => `${(x.startTime || '').slice(0, 5)}|${(x.endTime || '').slice(0, 5)}`;
  const weekdayOf = x => x.date ? new Date(x.date + 'T00:00:00').getDay() : null;
  const domOf = x => x.date ? parseInt(x.date.slice(8, 10), 10) : null;
  const daysBetween = (a, b) => {
    const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
    return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
  };
  const addDays = (d, n) => {
    const [y, m, dd] = d.split('-').map(Number);
    const nd = new Date(y, m - 1, dd + n);
    return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
  };

  const total = list.length;
  if (total < 2) return { baseline: null, items: new Map(), missingDates: [], deletionMode: null };

  const roomMode = mode(list.map(roomKeyOf));
  const periodMode = mode(list.map(periodKeyOf));
  const dated = list.filter(x => x.date);
  const wdMode = mode(dated.map(weekdayOf));
  const domMode = mode(dated.map(domOf));

  const roomConfident = roomMode.count / total > 0.5;
  const periodConfident = periodMode.count / total > 0.5;
  const wdRatio = dated.length ? wdMode.count / dated.length : 0;
  const domRatio = dated.length ? domMode.count / dated.length : 0;
  let dateRule = null;
  if (dated.length && Math.max(wdRatio, domRatio) > 0.5) {
    dateRule = domRatio > wdRatio ? { type: 'dom', value: domMode.value } : { type: 'weekday', value: wdMode.value };
  }
  const roomSample = list.find(x => roomKeyOf(x) === roomMode.value);
  const periodSample = list.find(x => periodKeyOf(x) === periodMode.value);

  const legacyBaseline = {
    room: roomConfident ? (roomSample?.room || '') : null,
    customRoom: roomConfident ? (roomSample?.customRoom || '') : null,
    roomConfident,
    startTime: periodConfident ? (periodSample?.startTime || '') : null,
    endTime: periodConfident ? (periodSample?.endTime || '') : null,
    periodConfident,
    dateRule,
    exact: false,
  };

  // v165：全員帶「同一代」原規劃快照才算精確模式；缺漏或代別混雜的筆逐筆退回 legacy 比對。
  const withPlan = list.filter(x => x.seriesPlan && x.planDate);
  const stampSet = new Set(withPlan.map(x => x.seriesPlan.stampedAt));
  const preciseMode = withPlan.length === total && stampSet.size === 1;

  const items = new Map();
  list.forEach(x => {
    if (x.seriesPlan && x.planDate) {
      const sp = x.seriesPlan;
      const roomChanged = roomKeyOf(x) !== roomKeyOf({ room: sp.room, customRoom: sp.customRoom });
      const periodChanged = periodKeyOf(x) !== `${(sp.startTime || '').slice(0, 5)}|${(sp.endTime || '').slice(0, 5)}`;
      const dateChanged = (x.date || '') !== x.planDate;
      items.set(x.id, {
        roomChanged, periodChanged, dateChanged, exact: true,
        origDate: x.planDate, origRoom: sp.room || '', origCustomRoom: sp.customRoom || '',
        origStart: sp.startTime || '', origEnd: sp.endTime || '',
      });
      return;
    }
    const roomChanged = roomConfident && roomKeyOf(x) !== roomMode.value;
    const periodChanged = periodConfident && periodKeyOf(x) !== periodMode.value;
    let dateChanged = false;
    if (dateRule && x.date) {
      dateChanged = dateRule.type === 'weekday' ? weekdayOf(x) !== dateRule.value : domOf(x) !== dateRule.value;
    }
    items.set(x.id, {
      roomChanged, periodChanged, dateChanged, exact: false,
      origDate: null,
      origRoom: roomConfident ? (legacyBaseline.room || '') : null,
      origCustomRoom: roomConfident ? (legacyBaseline.customRoom || '') : null,
      origStart: periodConfident ? (legacyBaseline.startTime || '') : null,
      origEnd: periodConfident ? (legacyBaseline.endTime || '') : null,
    });
  });

  let missingDates = [];
  let deletionMode = 'inferred';
  if (preciseMode) {
    // 精確模式：seriesPlan.dates（全員同代、內容共用同一份）減去現存成員的 planDate 集合＝精確已刪除場次
    const planDates = withPlan[0].seriesPlan.dates || [];
    const existing = new Set(withPlan.map(x => x.planDate));
    missingDates = planDates.filter(d => !existing.has(d)).sort();
    deletionMode = 'exact';
  } else {
    // 混代／部分缺／全無快照：退回 v163 推算法。至少 3 筆且相鄰日期差存在明確多數才推算，避免資料點
    // 過少、或頻率本就不固定時誤判；dateRule 為「每月同一天」時不推算（月份長短不一，固定天數步進會算錯）。
    const dates = dated.map(x => x.date).sort();
    if (dates.length >= 3 && (!dateRule || dateRule.type !== 'dom')) {
      const diffs = [];
      for (let i = 1; i < dates.length; i++) diffs.push(daysBetween(dates[i - 1], dates[i]));
      const diffMode = mode(diffs);
      if (diffMode.value > 0 && diffMode.count / diffs.length > 0.5) {
        const set = new Set(dates);
        let cur = dates[0];
        const last = dates[dates.length - 1];
        let guard = 0;
        while (guard++ < 500) {
          cur = addDays(cur, diffMode.value);
          if (cur > last) break;
          if (!set.has(cur)) missingDates.push(cur);
        }
      }
    }
  }

  const baseline = preciseMode ? {
    room: withPlan[0].seriesPlan.room || '', customRoom: withPlan[0].seriesPlan.customRoom || '',
    roomConfident: true,
    startTime: withPlan[0].seriesPlan.startTime || '', endTime: withPlan[0].seriesPlan.endTime || '',
    periodConfident: true,
    dateRule: null,
    exact: true,
  } : legacyBaseline;

  return { baseline, items, missingDates, deletionMode };
}

// 共用：依 seriesId 重繪「系列預約清單」內容並開窗；highlightId 標示「目前這筆」。
// 供 _bkViewSeriesList()（從編輯範圍選擇跳出）與 _bkReopenSeriesView()（v162：單筆編輯結束後返回）共用。
// v163：與 _bkSeriesDiffAnalyze() 反推的「原規劃」基準比對——偏離的日期／節次／空間以底色醒目標示，
// hover 顯示原規劃值；推算出的疑似被刪除原規劃日期以灰階＋刪除線列呈現（按日期插入清單中正確位置）。
function _bkRenderSeriesListModal(seriesId, highlightId) {
  const today = new Date().toISOString().slice(0, 10);
  const list = [...bookingsData.filter(x => x.seriesId === seriesId)]
    .sort((x, y) => `${x.date || ''}${x.startTime || ''}`.localeCompare(`${y.date || ''}${y.startTime || ''}`));
  const _periodLabel = (start, end) => {
    const p = BK_PERIODS.find(pp => pp.start === (start || '').slice(0, 5) && pp.end === (end || '').slice(0, 5));
    return p ? p.label : `${(start || '').slice(0, 5)}–${(end || '').slice(0, 5)}`;
  };
  const { baseline, items, missingDates, deletionMode } = _bkSeriesDiffAnalyze(list);
  const _weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const _dateRuleHint = baseline?.dateRule
    ? (baseline.dateRule.type === 'weekday' ? `原規劃：每週${_weekdayNames[baseline.dateRule.value]}` : `原規劃：每月 ${baseline.dateRule.value} 日`)
    : '';
  const HL = 'background:#fefcbf;border-radius:3px;padding:0 2px;'; // 偏離基準的欄位醒目樣式

  const rows = list.map(x => {
    const room = x.room === '其他' ? (x.customRoom || '其他') : x.room;
    const isCur = x.id === highlightId;
    const diff = items.get(x.id) || {};
    const statusParts = [];
    if (isCur) statusParts.push('目前編輯這筆');
    else if ((x.date || '') < today) statusParts.push('已過期');
    if (!x.caseId) statusParts.push('未連結個案');
    // v165：diff.exact 時（該筆帶原規劃快照）hover 顯示快照精確值，否則沿用 v163 推算基準的提示文字
    const dateHint = diff.exact ? `原規劃：${diff.origDate}` : _dateRuleHint;
    const dateHtml = diff.dateChanged
      ? `<span style="${HL}" data-tip="${escHtml(dateHint)}">${escHtml(x.date || '—')}</span>`
      : escHtml(x.date || '—');
    const periodHint = diff.exact
      ? '原規劃：' + _periodLabel(diff.origStart, diff.origEnd)
      : (baseline?.periodConfident ? '原規劃：' + _periodLabel(baseline.startTime, baseline.endTime) : '');
    const periodHtml = diff.periodChanged
      ? `<span style="${HL}" data-tip="${escHtml(periodHint)}">${escHtml(_periodLabel(x.startTime, x.endTime))}</span>`
      : escHtml(_periodLabel(x.startTime, x.endTime));
    const baseRoomTxt = diff.exact
      ? (diff.origRoom === '其他' ? (diff.origCustomRoom || '其他') : diff.origRoom)
      : (baseline?.roomConfident ? (baseline.room === '其他' ? (baseline.customRoom || '其他') : baseline.room) : '');
    const roomHtml = diff.roomChanged
      ? `<span style="${HL}" data-tip="${escHtml('原規劃：' + (baseRoomTxt || '—'))}">${escHtml(room || '—')}</span>`
      : escHtml(room || '—');
    return { date: x.date, html: `<div onclick="_bkViewSeriesJumpTo('${escHtml(x.id)}')"
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid ${isCur ? '#1a5276' : '#e2e8f0'};border-radius:8px;margin-bottom:8px;cursor:pointer;background:${isCur ? '#ebf8ff' : '#fff'};"
        onmouseenter="this.style.background='#f7fafc'" onmouseleave="this.style.background='${isCur ? '#ebf8ff' : '#fff'}'">
      <div>
        <div style="font-size:.9rem;font-weight:600;color:#2d3748;">${dateHtml}　${periodHtml}</div>
        <div style="font-size:.8rem;color:#718096;margin-top:2px;">${roomHtml}${x.caseName ? '　｜　' + escHtml(x.caseName) : ''}</div>
      </div>
      ${statusParts.length ? `<span style="font-size:.75rem;color:${isCur ? '#1a5276' : '#a0aec0'};white-space:nowrap;">${escHtml(statusParts.join('・'))}</span>` : ''}
    </div>` };
  });

  // 被刪除的原規劃列——不可點擊、灰階＋刪除線，仍顯示原規劃日期／節次／空間；
  // v165：deletionMode==='exact' 時（精確模式，來自 seriesPlan.dates 精確比對）標「已刪除」，
  // 否則沿用 v163 標「已刪除（推算）」。
  const _deletedLabel = deletionMode === 'exact' ? '已刪除' : '已刪除（推算）';
  const deletedRows = missingDates.map(d => {
    const roomTxt = baseline?.roomConfident ? (baseline.room === '其他' ? (baseline.customRoom || '其他') : baseline.room) : '—';
    const periodTxt = baseline?.periodConfident ? _periodLabel(baseline.startTime, baseline.endTime) : '—';
    return { date: d, html: `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px dashed #cbd5e0;border-radius:8px;margin-bottom:8px;background:#f7fafc;opacity:.6;">
      <div style="text-decoration:line-through;">
        <div style="font-size:.9rem;font-weight:600;color:#718096;">${escHtml(d)}　${escHtml(periodTxt)}</div>
        <div style="font-size:.8rem;color:#a0aec0;margin-top:2px;">${escHtml(roomTxt)}</div>
      </div>
      <span style="font-size:.75rem;color:#a0aec0;white-space:nowrap;text-decoration:none;">${escHtml(_deletedLabel)}</span>
    </div>` };
  });

  const combined = [...rows, ...deletedRows].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const bodyEl = document.getElementById('bk-series-list-body');
  bodyEl.innerHTML = combined.map(c => c.html).join('') || '<div style="padding:16px;text-align:center;color:#a0aec0;font-size:.85rem;">找不到系列預約資料。</div>';
  document.getElementById('bk-series-list-modal').style.display = 'flex';
}

// #2-4：編輯系列預約第四選項「檢視此系列預約」——列出同系列所有預約（日期、節次/時間、空間、狀態），
// 點任一筆直接進入該筆的單筆編輯（見 _bkViewSeriesJumpTo／editBooking：v162 起會略過範圍選擇、
// 標示「僅修改此筆」，儲存成功或取消／關閉後自動返回本清單）。
function _bkViewSeriesList() {
  const b = _editingBookingId ? bookingsData.find(x => x.id === _editingBookingId) : null;
  if (!b?.seriesId) return;
  document.getElementById('bk-series-scope-modal').style.display = 'none';
  _bkRenderSeriesListModal(b.seriesId, b.id);
}
function _bkViewSeriesJumpTo(id) {
  const target = bookingsData.find(x => x.id === id);
  document.getElementById('bk-series-list-modal').style.display = 'none';
  // v162：記錄「來自系列檢視清單」，供 editBooking 略過範圍選擇並鎖定僅此筆；
  // 離開編輯（儲存成功或取消／關閉）時 closeBookingModal() 會據此自動返回本清單。
  _bkSeriesViewReturn = target?.seriesId ? { seriesId: target.seriesId } : null;
  editBooking(id);
}
// v162：單筆編輯結束（儲存成功／取消關閉）後，回到來源系列的檢視清單（見 closeBookingModal）。
function _bkReopenSeriesView(seriesId, highlightId) {
  if (!seriesId) return;
  _bkRenderSeriesListModal(seriesId, highlightId);
}
// v162：「僅修改此筆」提示列——只在從系列檢視清單進入的單筆編輯顯示，說明本次修改只影響這一筆、
// 不影響系列其他預約；一般編輯（含系列範圍選擇後的僅此筆／此筆之後／全部系列）不顯示。
function _bkUpdateSeriesViewBanner(show) {
  const el = document.getElementById('bk-series-view-banner');
  if (el) el.style.display = show ? '' : 'none';
}

// 範圍透明化：於預約 Modal 標題下方顯示目前套用範圍（含筆數）與系列 badge；非系列編輯時隱藏。
function _bkUpdateScopeInfo() {
  const el = document.getElementById('bk-scope-info');
  if (!el) return;
  const b = _editingBookingId ? bookingsData.find(x => x.id === _editingBookingId) : null;
  if (!b?.seriesId) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const seriesTotal = bookingsData.filter(x => x.seriesId === b.seriesId).length;
  const n = _bkSeriesTargets(bookingsData, b, _bkEditScope).length;
  const scopeLabel = _bkEditScope === 'all' ? `全部系列（共 ${n} 筆）`
    : _bkEditScope === 'future' ? `此筆及之後（共 ${n} 筆）`
    : '僅此筆';
  const shiftNote = _bkEditScope !== 'this'
    ? '<br><span style="color:#c05621;">變更日期將平移套用範圍內所有預約</span>' : '';
  el.style.display = '';
  el.innerHTML = `<div style="font-size:.82rem;color:#4a5568;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin-bottom:10px;">
    套用範圍：${scopeLabel}${shiftNote}
    <div style="margin-top:2px;color:#718096;">此預約屬於系列預約（共 ${seriesTotal} 筆）</div>
  </div>`;
}

// T1：⋯ 浮動選單
let _bkCtxId = null;
function _bkCtxMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById('bk-ctx-menu');
  if (!menu) return;
  if (_bkCtxId === id && menu.style.display !== 'none') {
    menu.style.display = 'none'; _bkCtxId = null; return;
  }
  _bkCtxId = id;
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.display = '';
  menu.style.top  = (rect.bottom + window.scrollY + 2) + 'px';
  menu.style.left = Math.max(4, rect.right - 144 + window.scrollX) + 'px';
}
function _bkCtxAction(action) {
  const id = _bkCtxId;
  document.getElementById('bk-ctx-menu').style.display = 'none';
  _bkCtxId = null;
  if (!id) return;
  if (action === 'copy') copyBooking(id);
  else if (action === 'fill') bkFillRecord(id);
}
document.addEventListener('click', () => {
  const menu = document.getElementById('bk-ctx-menu');
  if (menu && menu.style.display !== 'none') { menu.style.display = 'none'; _bkCtxId = null; }
});

// T1：從空間預約填寫晤談記錄
function bkFillRecord(id) {
  const b = bookingsData.find(x => x.id === id);
  if (!b) return;
  if (!b.caseId) { alert('此預約尚未連結個案，請先在預約上設定「連結個案」後再填寫記錄。'); return; }
  const c = casesData.find(x => x.id === b.caseId);
  if (!c) { alert('找不到對應個案資料，請確認案號是否正確。'); return; }
  openNewRecordPage(b.caseId, null, '晤談記錄', {
    date: b.date,
    startTime: b.startTime || '',
    endTime:   b.endTime   || '',
    counselorEmail: b.counselorEmail || '',
    room: b.room === '其他' ? (b.customRoom || '其他') : (b.room || ''),
    bookingId: b.id
  });
}

function _bkNextSerial() {
  return bookingsData.reduce((m, b) => Math.max(m, b.bkSerial || 0), 0) + 1;
}

let _bkDaySpan = parseInt(localStorage.getItem('scc_bk_span') || '1') || 1;
let _bkListView = false;
// #5-6：空間預約頁「預約」／「稽核紀錄」tab；bkPageTabRestored 確保只在首次 render 從 config 還原一次
// （比照 _mlTabRestored／_mlTab 的既有模式）。
let _bkPageTab = 'booking';
let _bkPageTabRestored = false;
// v172（重構 Slice D）：時段格線目前檢視日期／使用率統計目前檢視區間（'' 時 render 函式會補預設值）
let _bkGridDate = '';
let _bkStatFrom = '';
let _bkStatTo = '';
let _bkListPage = 1;
const _BK_LIST_PAGE_SIZE = 15;
let _bkAuditPage = 0;
let _bkAuditTotalPages = 1;
let _bkAuditFilter = { dateFrom: '', dateTo: '', operator: '', room: '' };
const BK_AUDIT_PAGE_SIZE = 50;

// 上次成功讀取 bookings.json 的時間戳（ms）；供進頁重讀／背景重讀判斷「多久沒讀了」。
let _bkLastLoadAt = 0;
// 背景重讀 in-flight 旗標，避免上一輪還沒讀完又疊加下一輪。
let _bkBgRereadInFlight = false;

async function loadBookings() {
  try {
    const data = await driveReadJson(BOOKINGS_FILE);
    bookingsData = Array.isArray(data?.bookings) ? data.bookings : [];
    _bkLastLoadAt = Date.now();
  } catch (e) {
    // 讀取失敗保留記憶體既有資料：背景重讀／開窗前重讀如今頻繁呼叫本函式，
    // 偶發網路錯誤不得把畫面上的預約清空（也避免 editBooking 誤判「已被刪除」）。
    if (!Array.isArray(bookingsData)) bookingsData = [];
  }
}

async function refreshBookings() {
  await loadBookings();
  renderBookingsPage();
}

// 空間預約背景重讀（v172 起沿用的既有邏輯，v237 抽成具名函式，供 setInterval 輪詢與 SSE
// fileChanged 事件共用同一份判斷：頁面開著時靜默拉最新資料，讓他人新增/修改的預約及時出現。
// 條件：空間預約頁為目前作用頁＋分頁可見＋新增/編輯視窗未開啟（避免重繪清掉使用者輸入）＋無 in-flight 重讀。
function _bkBgRereadTick() {
  if (_bkBgRereadInFlight) return;
  if (document.visibilityState !== 'visible') return;
  if (!document.getElementById('page-bookings')?.classList.contains('active')) return;
  if (document.getElementById('booking-modal')?.style.display === 'flex') return;
  _bkBgRereadInFlight = true;
  loadBookings().then(renderBookingsPage).catch(() => {}).finally(() => { _bkBgRereadInFlight = false; });
}

// nav 進入空間預約頁：showPage/renderBookingsPage 行為不變；若距上次讀取已超過 2 分鐘，
// 背景靜默重讀一次最新資料再重繪（不卡畫面，失敗忽略）。
function _bkNavOpen(el) {
  showPage('page-bookings', el);
  renderBookingsPage();
  if (Date.now() - _bkLastLoadAt > 2 * 60 * 1000) {
    loadBookings().then(renderBookingsPage).catch(() => {});
  }
}

// ── Google Calendar 同步 ────────────────────────────────
// 定時同步已移至後端 GAS trigger（runGcSyncTick，見 dev/Code.gs），不再依賴前端分頁開著；
// 手動「與Google日曆同步」按鈕仍呼叫下方 syncFromCalendar() 本體，行為不變。

function _buildBkExpectedTitle(b) {
  const room = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
  const roomPart = room ? room.charAt(0) : '';
  return b.counselorName ? roomPart + '.' + b.counselorName : roomPart;
}

function _parseBkGcTitle(title) {
  if (!title) return null;
  const dotIdx = title.indexOf('.');
  const roomPart   = dotIdx >= 0 ? title.slice(0, dotIdx) : title;
  const personPart = dotIdx >= 0 ? title.slice(dotIdx + 1) : '';

  const allRooms = [...ROOMS.filter(r => r !== '其他'), ..._getBkCustomRooms()];
  let room = allRooms.find(r => r.charAt(0) === roomPart) || null;
  if (!room && roomPart) {
    room = roomPart;
    const customs = _getBkCustomRooms();
    if (!customs.includes(roomPart) && !ROOMS.includes(roomPart)) { customs.push(roomPart); _saveBkCustomRooms(customs); }
  }

  const names = personPart ? personPart.split(',').map(s => s.trim()).filter(Boolean) : [];
  const counselors = names.map(name => {
    const found = configData?.users && Object.entries(configData.users).find(([, u]) => (u.name || '') === name);
    return found ? { value: found[0], label: found[1].name || name, isCustom: false }
                 : { value: name, label: name, isCustom: true };
  });
  return {
    room: room || '',
    counselors,
    counselorName: counselors.map(c => c.label).join(','),
    counselorEmail: counselors[0] && !counselors[0].isCustom ? counselors[0].value : '',
  };
}

// 2026-07-08：判斷 GC 標題是否解析得出「已知空間．人員」——只認內建 ROOMS（排除「其他」）的首字。
// 未知/自訂空間一律回 null（→ 留待確認清單人工匯入，不自動建立）。純檢查、無副作用（不呼叫會註冊自訂空間的 _parseBkGcTitle）。
function _gcKnownRoomOfTitle(title) {
  const m = (title || '').match(/^([^.]+)\.(.+)$/);
  if (!m) return null;
  const roomChar = m[1];
  const person = (m[2] || '').trim();
  if (!person) return null;
  return ROOMS.filter(r => r !== '其他').find(r => r.charAt(0) === roomChar) || null;
}

// GC 上「無對應 INFOSYS 預約」且標題可解析為已知空間的新事件 → 自動匯入為系統預約（配流水號、回寫 GC serial/creator）。
// 解析不出已知空間者不在此處理，留給 _runGcValidationAndBackfill 列入待確認清單供人工「匯入為預約」。回傳匯入筆數。
async function _gcAutoImportKnownRoomEvents(gcEvents, startDate, endDate) {
  const matched = new Set((bookingsData || []).map(b => b.calendarEventId).filter(Boolean));
  const toImport = (gcEvents || []).filter(ev =>
    ev && ev.id && !matched.has(ev.id) &&
    ev.date >= startDate && ev.date <= endDate &&
    _gcKnownRoomOfTitle(ev.title));
  if (!toImport.length) return 0;
  const myName = configData?.users?.[currentUser?.email]?.name || currentUser?.displayName || '';
  const baseSerial = _bkNextSerial();
  const newBks = toImport.map((ev, idx) => {
    const parsed = _parseBkGcTitle(ev.title) || { room: '', counselors: [], counselorName: '', counselorEmail: '' };
    const raw = ev.description || '';
    let notes = '';
    const sm = raw.match(/\n#(\d+)\s*$/);
    if (sm) { let body = raw.slice(0, raw.length - sm[0].length); const si = body.lastIndexOf('\n---\n'); if (si >= 0) body = body.slice(0, si); notes = body.trim(); }
    else { const si = raw.lastIndexOf('\n---\n'); notes = (si >= 0 ? raw.slice(0, si) : raw).trim(); }
    const now = new Date().toISOString();
    return {
      id: 'bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      bkSerial: baseSerial + idx,
      room: parsed.room || '', customRoom: '',
      date: ev.date, startTime: ev.startTime, endTime: ev.endTime,
      counselors: parsed.counselors || [], counselorEmail: parsed.counselorEmail || '', counselorName: parsed.counselorName || '',
      caseId: '', caseName: '', notes,
      createdAt: now, updatedAt: now, creatorName: myName,
      calendarEventId: ev.id,
    };
  });
  const ops = newBks.map(bk => ({ op: 'upsert', booking: { ...bk }, gc: { mode: 'none' } }));
  const res = await bkCommit(ops, { checkConflicts: false });
  // 只認伺服器確認寫入的預約（後端可能因 calendarEventId 已被占用而略過重複匯入）
  let confirmed = newBks;
  if (res.fallback) { newBks.forEach(bk => bookingsData.push(bk)); await saveBookings(); }
  else if (!res.error) {
    const byId = new Map((res.bookings || []).map(x => [x.id, x]));
    confirmed = newBks.filter(bk => byId.has(bk.id));
    confirmed.forEach(bk => bookingsData.push(byId.get(bk.id)));
  } else { confirmed = []; }
  for (const bk of confirmed) {
    try {
      await proxyCall('updateCalendarEvent', {
        eventId: bk.calendarEventId, room: bk.room, customRoom: '',
        date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
        counselorName: bk.counselorName || '', notes: bk.notes || '',
        creatorName: bk.creatorName || bk.counselorName || '',
        createdAt: bk.createdAt, updatedAt: bk.updatedAt, isEdit: false, bkSerial: bk.bkSerial,
        colorId: _bkGcColorId(bk) });
    } catch (_) {}
    auditLog('因同步日曆自動匯入預約', null, null, `${bk.room}　${bk.date}　${(bk.startTime || '').slice(0, 5)}–${(bk.endTime || '').slice(0, 5)}${bk.counselorName ? '　' + bk.counselorName : ''}`);
  }
  return confirmed.length;
}

async function syncFromCalendar(silent = false) {
  const jobId = silent ? null : bgJobAdd('Google 日曆同步', '取得事件中…');
  try {
    const minus30 = new Date(); minus30.setDate(minus30.getDate() - 30);
    const plus90  = new Date(); plus90.setDate(plus90.getDate() + 90);
    const startDate = minus30.toISOString().slice(0, 10);
    const endDate   = plus90.toISOString().slice(0, 10);

    const gcEventsRaw = await proxyCall('listCalendarEvents', { startDate, endDate });
    if (gcEventsRaw == null) {
      if (!silent) setAlert('bookings-alert', 'warn', 'Google 日曆同步功能需要重新部署 Apps Script 最新版本。');
      if (jobId) bgJobFail(jobId, 'Apps Script 尚未支援 Calendar 同步');
      return;
    }
    if (!Array.isArray(gcEventsRaw)) {
      throw new Error('Google 日曆回傳格式錯誤，請確認 Apps Script 已部署最新版本。');
    }
    const gcEvents = gcEventsRaw;
    const gcMap = new Map(gcEvents.map(e => [e.id, e]));

    const myName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.email || '';
    const auditActions = [];
    let changed = false;
    const deletedIds = new Set();
    const changedIds = new Set();
    const serialRestoreQueue = [];
    const gcPushBackQueue = [];  // 系統比 GC 新 → 推回 GC

    bookingsData = bookingsData.map(b => {
      if (!b.calendarEventId) return b;
      // 查詢範圍外的預約不納入刪除判斷（可能仍存在於 GC）
      if (b.date < startDate || b.date > endDate) return b;

      const gcE = gcMap.get(b.calendarEventId);
      if (!gcE) {
        // GC 上已刪除 → 同步刪除本機預約
        changed = true;
        const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
        auditActions.push({ action: '因' + myName + '同步日曆而刪除預約', caseId: b.caseId || null, detail: rd + '　' + b.date + '　' + (b.startTime||'').slice(0,5) + '–' + (b.endTime||'').slice(0,5) + (b.counselorName ? '　' + b.counselorName : '') });
        deletedIds.add(b.id);
        return b;
      }

      // 比對標題、時間與說明
      const bStart = (b.startTime || '').slice(0, 5);
      const bEnd   = (b.endTime   || '').slice(0, 5);
      // 解析 GC description
      // 格式：{備註}\n---\n{actor} 建立/編輯 YYYY/MM/DD HH:mm\n#{serial}
      const _rawDesc = gcE.description || '';
      let gcSerial = null;
      let gcNotes = '';
      const _serialMatch = _rawDesc.match(/\n#(\d+)\s*$/);
      if (_serialMatch) {
        gcSerial = parseInt(_serialMatch[1]);
        let _body = _rawDesc.slice(0, _rawDesc.length - _serialMatch[0].length);
        const _sepIdx = _body.lastIndexOf('\n---\n');
        if (_sepIdx >= 0) _body = _body.slice(0, _sepIdx);
        gcNotes = _body.trim();
      } else {
        // 無流水號：嘗試以 ---\n 分隔符取備註
        const _sepIdx = _rawDesc.lastIndexOf('\n---\n');
        if (_sepIdx >= 0) {
          gcNotes = _rawDesc.slice(0, _sepIdx).trim();
        } else {
          gcNotes = _rawDesc.trim();
        }
      }
      // 流水號對不上 → 排入還原佇列
      if (b.bkSerial && gcSerial !== b.bkSerial) serialRestoreQueue.push(b.id);
      const expectedTitle = _buildBkExpectedTitle(b);
      const titleChanged  = gcE.title !== expectedTitle;
      const timeChanged   = gcE.date !== b.date || gcE.startTime !== bStart || gcE.endTime !== bEnd;
      const notesChanged  = gcNotes !== (b.notes || '');

      if (titleChanged || timeChanged || notesChanged) {
        const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
        // 2026-07-08：GC 端有差異一律拉進 INFOSYS（以 GC 現況為準）。先前的「系統較新就推回 GC」時間戳
        // 仲裁會把使用者在 GC 的修改覆蓋回去（使用者回報「GC 修改不反映」根因）→ 已移除。
        // INFOSYS 端自己的修改仍在儲存當下即時推到 GC（bookingsCommit），雙向一致不依賴本同步的推回。
        const diffs = [];
        const update = {};

        if (titleChanged) {
          const parsed = _parseBkGcTitle(gcE.title);
          if (parsed) {
            if (parsed.room && parsed.room !== rd) {
              diffs.push(`空間 ${rd}→${parsed.room}`);
              update.room = parsed.room; update.customRoom = '';
            }
            if ((parsed.counselorName || '') !== (b.counselorName || '')) {
              diffs.push(`人員 ${b.counselorName||'—'}→${parsed.counselorName||'—'}`);
              update.counselors = parsed.counselors; update.counselorName = parsed.counselorName; update.counselorEmail = parsed.counselorEmail;
            }
          }
        }
        if (timeChanged) {
          diffs.push(`${b.date} ${bStart}–${bEnd}→${gcE.date} ${gcE.startTime}–${gcE.endTime}`);
          update.date = gcE.date; update.startTime = gcE.startTime; update.endTime = gcE.endTime;
        }
        if (notesChanged) {
          diffs.push(`說明 ${b.notes||'—'}→${gcNotes||'—'}`);
          update.notes = gcNotes;
        }

        if (Object.keys(update).length > 0) {
          changed = true;
          changedIds.add(b.id);
          auditActions.push({ action: '因' + myName + '同步日曆而更新', caseId: b.caseId || null, detail: rd + (b.counselorName ? '　' + b.counselorName : '') + '　' + diffs.join('；') });
          return { ...b, ...update };
        }
      }
      return b;
    });

    if (changed) {
      // 批次 bkCommit（gc:'none'，checkConflicts:false）：這裡的變更全部來自 GC 現況比對，不是新的使用者操作，
      // 不需再做撞房/撞人檢查；GC 事件本身已是最終狀態，不需再回頭觸碰 GC。
      const ops = [];
      bookingsData.forEach(b => { if (changedIds.has(b.id)) ops.push({ op: 'upsert', booking: { ...b }, gc: { mode: 'none' } }); });
      deletedIds.forEach(id => ops.push({ op: 'delete', id, gcEventId: null }));
      if (deletedIds.size > 0) bookingsData = bookingsData.filter(b => !deletedIds.has(b.id));
      if (ops.length > 0) {
        try {
          const result = await bkCommit(ops, { checkConflicts: false });
          if (result.fallback) {
            await saveBookings();
          } else if (!result.error) {
            (result.bookings || []).forEach(fb => {
              const idx = bookingsData.findIndex(x => x.id === fb.id);
              if (idx >= 0) bookingsData[idx] = fb;
            });
          }
        } catch (e) { console.warn('syncFromCalendar bkCommit failed', e); }
      }
      auditActions.forEach(a => auditLog(a.action, a.caseId, null, a.detail));
      renderBookingsPage();
    }
    if (jobId) bgJobProgress(jobId, 80);
    if (!silent) {
      setAlert('bookings-alert', 'ok', changed ? 'Google 日曆同步完成，已更新本機資料。' : 'Google 日曆同步完成，無變動。');
    }

    // 流水號還原：背景修復 GC description 中被篡改的流水號
    const _allRestoreIds = [...new Set([...serialRestoreQueue, ...gcPushBackQueue])];
    if (_allRestoreIds.length > 0) {
      for (const bId of _allRestoreIds) {
        const bk = bookingsData.find(x => x.id === bId);
        if (!bk?.calendarEventId) continue;
        try {
          const _isEdit = !!(bk.updatedAt && bk.updatedAt !== bk.createdAt);
          await proxyCall('updateCalendarEvent', {
            eventId: bk.calendarEventId, room: bk.room, customRoom: bk.customRoom || '',
            date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
            counselorName: bk.counselorName || '', notes: bk.notes || '',
            creatorName: bk.creatorName || bk.counselorName || '',
            createdAt: bk.createdAt, updatedAt: bk.updatedAt || bk.createdAt,
            isEdit: _isEdit, bkSerial: bk.bkSerial,
            colorId: _bkGcColorId(bk) });
        } catch (_) {}
      }
    }
    // 自動匯入 GC 新增、可解析為已知空間的事件（解析不出的留給下方驗證列入待確認清單）
    let _autoImported = 0;
    try { _autoImported = await _gcAutoImportKnownRoomEvents(gcEvents, startDate, endDate); } catch (e) { console.warn('gc auto-import failed', e); }
    if (_autoImported > 0) { try { renderBookingsPage?.(); } catch (_) {} }
    // GC 事件驗證 + 自動補註 + 廣播（背景，不阻擋 sync 完成回報）
    try { await _runGcValidationAndBackfill(gcEvents); } catch (e) { console.warn('gc validation failed', e); }
    if (jobId) bgJobDone(jobId, _autoImported > 0 ? `已自動匯入 ${_autoImported} 筆 GC 新增事件` : undefined);
  } catch (e) {
    if (jobId) bgJobFail(jobId, e.message);
    if (!silent) setAlert('bookings-alert', 'warn', '同步失敗：' + e.message);
    console.warn('syncFromCalendar failed', e);
  }
}

// ──（以上至此為原 21138~21837 兩段；以下為原 24608~27491 段，中間隔著留在主檔的其他模組）──
// ── v172（重構 Slice D1）：時段格線——一天檢視，列＝BK_PERIODS 節次、欄＝ROOMS 空間 ──────
// 某節次是否與該筆預約時間重疊（半開區間，比照既有 _bkFindConflict／saveBooking 撞房判定）
function _bkPeriodOverlaps(b, period) {
  return (b.startTime || '') < period.end && (b.endTime || '') > period.start;
}
// 一筆預約橫跨多節次時，找出「起始」節次索引（用來判斷其餘節次要標「續」），
// 找不到重疊節次（自訂時間完全落在節次表外）回傳 -1。
function _bkFirstOverlapPeriodIdx(b) {
  return BK_PERIODS.findIndex(p => _bkPeriodOverlaps(b, p));
}
// 判斷一筆預約是否歸入「其他」欄：room 直接是 '其他'（含舊資料 customRoom 附掛），
// 或 room 是不在 ROOMS 固定 8 項內的自訂空間名稱（見 saveBooking：新建時直接把自訂空間名存進 room）。
function _bkIsOtherRoomBooking(b) {
  return b.room === '其他' || !!(b.room && !ROOMS.includes(b.room));
}
function _bkShiftGridDate(delta) {
  if (!_bkGridDate) _bkGridDate = new Date().toISOString().slice(0, 10);
  _bkGridDate = _bkAddDays(_bkGridDate, delta);
  renderBkGridTab();
}
function _bkOpenGridNew(room, date, start, end) {
  // 「其他」欄彙整非標準空間的預約（見 _bkIsOtherRoomBooking），本身不是新增預約 modal 裡的可選
  // 空間 chip（_populateBookingRoomChipsList 排除 ROOMS 中的『其他』），故不預帶空間，交由使用者
  // 自行挑選既有空間或新增自訂空間；其餘欄位（日期／節次時間）照常預帶。
  const prefill = { date, startTime: start, endTime: end };
  if (room !== '其他') prefill.room = room;
  openBookingModal(null, prefill);
}
function renderBkGridTab() {
  if (!_bkGridDate) _bkGridDate = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById('bk-grid-date');
  if (dateEl) dateEl.value = _bkGridDate;
  const body = document.getElementById('bk-grid-body');
  if (!body) return;

  const dayBookings = bookingsData.filter(b => b.date === _bkGridDate);
  const cellMatch = (b, room) => room === '其他' ? _bkIsOtherRoomBooking(b) : b.room === room;
  // v174：占用格改以「主責」為主顯示（不論有無連結個案，一律顯示主責姓名）；案號等識別資訊
  // 改為 hover 才看得到（見 _gridHoverInfo），避免一眼掃過格線就看到個案識別。
  const _gridMainLabel = b => escHtml(b.counselorName || b.counselors?.[0]?.name || b.counselors?.[0]?.label || '—');
  const _gridHoverInfo = b => {
    const caseInfo = b.caseId ? (b.caseName ? `${b.caseName}（${b.caseId}）` : b.caseId) : (b.bkSerial ? `預約編號 ${b.bkSerial}` : '');
    return escHtml(caseInfo + (b.notes ? (caseInfo ? '／' : '') + b.notes : ''));
  };

  let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">`;
  html += `<tr><th style="padding:6px 8px;background:#f7fafc;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;font-size:.78rem;color:#718096;text-align:left;white-space:nowrap;">節次</th>`;
  html += ROOMS.map(r => `<th style="padding:6px 8px;background:#f7fafc;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;font-size:.78rem;font-weight:700;color:#2d3748;text-align:center;white-space:nowrap;min-width:96px;">${escHtml(r)}</th>`).join('');
  html += '</tr>';

  BK_PERIODS.forEach(p => {
    html += `<tr><td style="padding:5px 8px;background:#f7fafc;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;font-size:.76rem;color:#4a5568;white-space:nowrap;">${escHtml(p.label)}</td>`;
    ROOMS.forEach(room => {
      const matches = dayBookings.filter(b => cellMatch(b, room) && _bkPeriodOverlaps(b, p));
      if (matches.length === 0) {
        // v174：空格仍點一下新增（沿用既有 _bkOpenGridNew）；同時是拖曳放置目標——拖入代表把某筆
        // 預約改到「本格空間＋本格節次起訖時間」，重用既有 bkDragOver/bkDrop 拖曳與衝突機制。
        html += `<td onclick="_bkOpenGridNew('${escHtml(room)}','${_bkGridDate}','${p.start}','${p.end}')" ondragover="bkDragOver(event)" ondrop="bkDrop(event,'${escHtml(room)}',undefined,'${p.start}','${p.end}')" ondragenter="bkDragEnter(this)" ondragleave="bkDragLeave(this)" data-tip="點此新增預約，亦可拖曳既有預約至此" style="padding:5px 7px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;color:#cbd5e0;cursor:pointer;transition:background .1s;" onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''">＋</td>`;
      } else {
        const cells = matches.map(b => {
          const clr = _bkEffColor(b);
          const style = clr ? `background:${clr}22;border-left:3px solid ${clr};` : 'background:#edf2f7;';
          const continued = _bkFirstOverlapPeriodIdx(b) !== BK_PERIODS.indexOf(p);
          const txt = continued ? `↳續 ${_gridMainLabel(b)}` : _gridMainLabel(b);
          // v174：改雙擊編輯（比照預約卡片既有雙擊機制 _bkCardDblClick，避免誤點）；可拖曳
          // （bkDragStart/bkDragEnd，重用既有卡片拖曳機制），放到目標格＝把此筆預約改到目標欄空間＋目標列節次時間。
          return `<div data-bk-card="1" draggable="true" ondragstart="bkDragStart(event,'${escHtml(b.id)}')" ondragend="bkDragEnd(event)" ondblclick="_bkCardDblClick(event,'${escHtml(b.id)}')" data-tip="點兩下編輯，可拖曳改期" title="${_gridHoverInfo(b)}" style="${style}border-radius:4px;padding:2px 5px;margin-bottom:2px;font-size:.76rem;cursor:grab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${txt}</div>`;
        }).join('');
        html += `<td ondragover="bkDragOver(event)" ondrop="bkDrop(event,'${escHtml(room)}',undefined,'${p.start}','${p.end}')" ondragenter="bkDragEnter(this)" ondragleave="bkDragLeave(this)" style="padding:4px 5px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:top;transition:outline .1s;">${cells}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table></div>';

  // 自訂時間、完全不落在任何節次區間內的預約（如早於第1節或晚於第11節）：另列一區，避免漏顯示。
  const unmatched = dayBookings.filter(b => _bkFirstOverlapPeriodIdx(b) === -1);
  if (unmatched.length) {
    const fmtT = t => (t || '').slice(0, 5);
    html += `<div style="padding:10px 16px;border-top:1px solid #e2e8f0;">
      <div style="font-size:.8rem;font-weight:600;color:#718096;margin-bottom:6px;">不落在節次表內的自訂時間預約</div>` +
      unmatched.map(b => {
        const clr = _bkEffColor(b);
        const style = clr ? `background:${clr}22;border-left:3px solid ${clr};` : 'background:#edf2f7;';
        const roomD = _bkIsOtherRoomBooking(b) ? (b.customRoom || b.room || '其他') : (b.room || '—');
        return `<div ondblclick="_bkCardDblClick(event,'${escHtml(b.id)}')" data-tip="點兩下編輯" title="${_gridHoverInfo(b)}" style="${style}border-radius:5px;padding:5px 8px;margin-bottom:4px;font-size:.82rem;cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span style="font-weight:600;">${fmtT(b.startTime)}–${fmtT(b.endTime)}</span>
          <span style="color:#4a5568;">${escHtml(roomD)}</span>
          <span>${_gridMainLabel(b)}</span>
        </div>`;
      }).join('') + `</div>`;
  }

  body.innerHTML = html;
}

// ── v172（重構 Slice D2）：使用率統計 ─────────────────────────────────────────
// 純函式（無 DOM／全域讀寫副作用，供 test/booking-usage.test.js 單元測試；依賴 BK_PERIODS 由呼叫端
// 所在的全域提供，harness 測試以 extraGlobals 注入替身，見 test/README「加新測試」）。
// bookings：預約陣列；from/to：'YYYY-MM-DD' 字串（含端點，from<=date<=to 才計入）。
// 回傳 { byRoom:[{room,count}]（多到少）, byPeriod:[{label,count}]（依 BK_PERIODS 順序）,
//        byPerson:[{name,count}]（多到少） }。
function _bkUsageStats(bookings, from, to) {
  const inRange = (bookings || []).filter(b => b && b.date >= from && b.date <= to);

  // byRoom：'其他'（含舊資料 customRoom 附掛）優先以 customRoom 呈現實際空間名稱，避免全部
  // 不同的自訂空間被籠統歸成同一列「其他」，看不出各自使用量。
  const roomCounts = new Map();
  inRange.forEach(b => {
    const key = (b.room === '其他' && b.customRoom) ? b.customRoom : (b.room || b.customRoom || '（未指定空間）');
    roomCounts.set(key, (roomCounts.get(key) || 0) + 1);
  });
  const byRoom = [...roomCounts.entries()]
    .map(([room, count]) => ({ room, count }))
    .sort((a, b) => b.count - a.count);

  // byPeriod：依重疊判定，一筆預約可能同時累計到多個節次（跨節次預約），依 BK_PERIODS 原順序呈現。
  const byPeriod = BK_PERIODS.map(p => ({
    label: p.label,
    count: inRange.reduce((n, b) => n + (((b.startTime || '') < p.end && (b.endTime || '') > p.start) ? 1 : 0), 0),
  }));

  // byPerson：以 counselorName（顯示用聯合字串）為主，缺值才退回 counselors[0]
  const personCounts = new Map();
  inRange.forEach(b => {
    const name = b.counselorName || b.counselors?.[0]?.name || b.counselors?.[0]?.label || '（未指定）';
    personCounts.set(name, (personCounts.get(name) || 0) + 1);
  });
  const byPerson = [...personCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { byRoom, byPeriod, byPerson };
}

function renderBkStatsTab() {
  const today = new Date().toISOString().slice(0, 10);
  if (!_bkStatFrom) _bkStatFrom = today.slice(0, 8) + '01'; // 預設本月 1 號
  if (!_bkStatTo) _bkStatTo = today;
  const fromEl = document.getElementById('bk-stat-from');
  const toEl   = document.getElementById('bk-stat-to');
  if (fromEl) fromEl.value = _bkStatFrom;
  if (toEl)   toEl.value   = _bkStatTo;

  const body = document.getElementById('bk-stats-body');
  if (!body) return;
  const { byRoom, byPeriod, byPerson } = _bkUsageStats(bookingsData, _bkStatFrom, _bkStatTo);

  // 數字為主、長條為輔：pct = 該列 count / 該組 max（無資料時避免除以 0）
  const barTable = (title, rows, labelKey) => {
    const max = Math.max(1, ...rows.map(r => r.count));
    const rowsHtml = rows.length
      ? rows.map(r => {
          const pct = Math.round((r.count / max) * 100);
          return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
            <span style="min-width:160px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.85rem;color:#2d3748;" title="${escHtml(r[labelKey])}">${escHtml(r[labelKey])}</span>
            <span style="min-width:28px;text-align:right;font-size:.85rem;font-weight:700;color:#2b6cb0;">${r.count}</span>
            <div style="flex:1;background:#edf2f7;border-radius:4px;overflow:hidden;height:10px;">
              <div style="width:${pct}%;background:#4299e1;height:100%;"></div>
            </div>
          </div>`;
        }).join('')
      : '<div style="color:#a0aec0;font-size:.85rem;padding:6px 0;">（此區間無資料）</div>';
    return `<div style="margin-bottom:20px;">
      <div style="font-weight:700;color:#2d3748;margin-bottom:8px;">${escHtml(title)}</div>
      ${rowsHtml}
    </div>`;
  };

  body.innerHTML =
    barTable('各空間使用量', byRoom, 'room') +
    barTable('各節次熱度', byPeriod, 'label') +
    barTable('各人預約量', byPerson, 'name');
}

function _bkRenderDayColumn(date) {
  const fmtT = t => (t || '').slice(0, 5);
  const dayBookings = bookingsData.filter(b => b.date === date);
  let html = '';
  for (const room of _getBkDisplayRooms()) {
    const rb = dayBookings.filter(b => b.room === room).sort((a, b) => (a.startTime || '') < (b.startTime || '') ? -1 : 1);
    html += `<div style="border-bottom:1px solid #e2e8f0;padding:8px 10px;">
      <div style="font-weight:600;color:#2d3748;margin-bottom:4px;font-size:.82rem;">${escHtml(room)}</div>`;
    if (rb.length === 0) {
      html += `<div style="color:#cbd5e0;font-size:.78rem;">—</div>`;
    } else {
      rb.forEach(b => {
        const caseTag = b.caseId ? `<div style="font-size:.75rem;color:#2471a3;">個案 ${escHtml(b.caseId)}${b.caseName ? ' '+escHtml(b.caseName) : ''}</div>` : '';
        const noteTag = b.notes ? `<div style="font-size:.75rem;color:#718096;">${escHtml(b.notes.slice(0,25))}${b.notes.length>25?'…':''}</div>` : '';
        const calTag = b.calendarEventId
          ? `<span title="已同步 Google 日曆" style="font-size:.8rem;">📅</span>`
          : `<button class="btn btn-secondary btn-sm" style="padding:1px 5px;font-size:.72rem;" data-sync-id="${escHtml(b.id)}" onclick="syncBookingToCalendar('${escHtml(b.id)}')">📅</button>`;
        const actBtns = `<span style="display:flex;gap:3px;margin-top:3px;align-items:center;">
          <button class="btn btn-secondary btn-sm" style="padding:1px 6px;font-size:.72rem;" onclick="editBooking('${escHtml(b.id)}')">編輯</button>
          <button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:.72rem;" onclick="deleteBooking('${escHtml(b.id)}')">刪除</button>
          ${calTag}
          <button class="btn btn-secondary btn-sm" style="padding:1px 6px;font-size:.72rem;" onclick="_bkCtxMenu(event,'${escHtml(b.id)}')">⋯</button>
        </span>`;
        html += `<div style="padding:4px 6px;${_bkCellStyle(b)}border-radius:5px;margin-bottom:4px;">
          <div style="font-size:.82rem;font-weight:600;color:#2d3748;">${fmtT(b.startTime)}–${fmtT(b.endTime)}</div>
          <div style="font-size:.82rem;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(b.counselorName || '')}">${escHtml(b.counselorName || '—')}${_bkCounselorBadges(b)}</div>
          ${caseTag}${noteTag}${actBtns}
        </div>`;
      });
    }
    html += '</div>';
  }
  return html;
}

// 預約有效顏色：單筆自訂（bkOverrideColor）優先，其次主責人員的個人 bkColor
function _bkEffColor(b) {
  return b?.bkOverrideColor || configData?.users?.[b?.counselorEmail]?.bkColor || '';
}

// #5-3：推送到 GC 事件的顏色。優先序：
// 1. 逐筆自訂色（bkOverrideColor）——使用者這筆明確想要這個顏色，直接找最接近的 GC 色；
// 2. 主責人員設定的「GC 預設色」（bkColorGc，11 色其一，直接對應 colorId，不做近似轉換）；
// 3. 都沒設定 → 退回既有 INFOSYS 顯示色（bkColor）的近似轉換（_nearestGcColorId）。
function _bkGcColorId(b) {
  if (b?.bkOverrideColor) return _nearestGcColorId(b.bkOverrideColor);
  const gcId = configData?.users?.[b?.counselorEmail]?.bkColorGc;
  if (gcId && GC_EVENT_COLORS[gcId]) return String(gcId);
  const hex = _bkEffColor(b);
  return hex ? _nearestGcColorId(hex) : null;
}

// 依有效顏色產生 cell 樣式：淡背景（13% 透明）+ 左邊 4px 條紋；未設沿用現行灰底
function _bkCellStyle(b) {
  const hex = _bkEffColor(b);
  if (!hex || hex[0] !== '#') return 'background:#edf2f7;';
  return `background:${hex}22;border-left:4px solid ${hex};`;
}

// 系列預約 badge：同 seriesId 筆數建一次 Map（呼叫端於 render 開頭建立一次並傳入，避免每筆重新掃描 bookingsData）。
function _bkBuildSeriesCountMap(bookings) {
  const m = new Map();
  (bookings || []).forEach(b => { if (b.seriesId) m.set(b.seriesId, (m.get(b.seriesId) || 0) + 1); });
  return m;
}
// compact=true 時只顯示 🔁（多日表格空間較小）；否則顯示「🔁 系列」徽章。
function _bkSeriesBadge(b, seriesCountMap, compact) {
  if (!b?.seriesId) return '';
  const n = seriesCountMap?.get(b.seriesId) || 1;
  const title = escHtml(`系列預約（共 ${n} 筆）`);
  if (compact) return `<span title="${title}" style="font-size:.7rem;">🔁</span>`;
  return `<span title="${title}" style="font-size:.7rem;background:#e9d8fd;color:#553c9a;border:1px solid #d6bcfa;border-radius:8px;padding:0 5px;white-space:nowrap;">🔁 系列</span>`;
}

// 從 booking 物件組出 GC 事件參數（含依有效顏色算出的 colorId）。
// 供拖曳（bkDrop/_bkDragConfirmScope）與 saveBooking 系列編輯逐筆 GC 同步共用，避免重複組裝邏輯。
function _bkGcParamsOf(b, isEdit) {
  return {
    room: b.room, customRoom: b.customRoom, date: b.date, startTime: b.startTime, endTime: b.endTime,
    counselorName: b.counselorName, notes: b.notes,
    creatorName: configData?.users?.[b.creatorEmail]?.name || b.creatorName || '',
    createdAt: b.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    isEdit: !!isEdit, bkSerial: b.bkSerial,
    colorId: _bkGcColorId(b),
  };
}

// ── 單筆預約自訂顏色（僅影響該筆預約，複製/重複預約沿用）──
let _bkPickedColor = '';
function _toggleBkOverridePanel() {
  const p = document.getElementById('bk-color-override-panel');
  if (!p) return;
  const show = p.style.display === 'none';
  p.style.display = show ? '' : 'none';
  if (show) _renderBkOverrideGrid();
}
function _renderBkOverrideGrid() {
  const grid = document.getElementById('bk-color-override-grid');
  if (!grid) return;
  grid.innerHTML = BK_USER_COLORS.map(hex => {
    const sel = hex.toUpperCase() === (_bkPickedColor || '').toUpperCase();
    return `<div onclick="_pickBkOverrideColor('${hex}')" title="${hex}" style="width:32px;height:32px;border-radius:6px;background:${hex};cursor:pointer;box-shadow:${sel ? 'inset 0 0 0 3px #fff, 0 0 0 2px #2b6cb0' : 'inset 0 0 0 1px rgba(0,0,0,.08)'};transition:transform .1s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform=''"></div>`;
  }).join('');
  _updateBkOverrideCurrent();
}
function _pickBkOverrideColor(hex) {
  _bkPickedColor = hex || '';
  _renderBkOverrideGrid();
}
function _updateBkOverrideCurrent() {
  const cur = document.getElementById('bk-color-override-current');
  if (!cur) return;
  cur.innerHTML = _bkPickedColor
    ? `<span style="width:14px;height:14px;border-radius:4px;background:${_bkPickedColor};display:inline-block;border:1px solid rgba(0,0,0,.15);"></span>此預約使用自訂顏色 ${_bkPickedColor}`
    : '未自訂（沿用主責人員的預設顏色）';
}
function _resetBkOverrideUi(color) {
  _bkPickedColor = color || '';
  const p = document.getElementById('bk-color-override-panel');
  if (p) p.style.display = 'none';
  _updateBkOverrideCurrent();
}
// #5-6：「預約」／「稽核紀錄」tab 切換，純前端顯示切換（不重新載入預約資料；稽核紀錄僅在切入
// 該 tab 時才視需要讀取，沿用 renderBookingsAuditLog 既有的快取優先＋背景更新機制）。
function _bkApplyTabVisibility() {
  // v172：新增 grid（時段格線）／stats（使用率統計）兩個 tab，比照既有 booking/audit pattern
  // v174：booking 改名「預約總覽」、grid 改名「單日詳細預約」（僅顯示文字，key 不變）
  const labels = { booking: '預約總覽', audit: '稽核紀錄', grid: '單日詳細預約', stats: '使用率統計' };
  Object.keys(labels).forEach(id => {
    const btn = document.getElementById('bk-tabbtn-' + id);
    if (btn) btn.dataset.active = (_bkPageTab === id) ? '1' : '0';
    const panel = document.getElementById('bk-tab-' + id);
    if (panel) panel.style.display = (_bkPageTab === id) ? '' : 'none';
  });
}
function _bkSwitchTab(id) {
  _bkPageTab = id;
  syncUserPref_({ bkPageTab: id });
  _bkApplyTabVisibility();
  if (id === 'audit') renderBookingsAuditLog();
  else if (id === 'grid') renderBkGridTab();
  else if (id === 'stats') renderBkStatsTab();
}

function renderBookingsPage() {
  // 首次進頁時從使用者偏好還原上次所在的 tab（比照 _mlTabRestored／_mlTab 的模式）
  if (!_bkPageTabRestored) {
    _bkPageTabRestored = true;
    const saved = configData?.users?.[currentUser?.email]?.bkPageTab;
    if (saved === 'audit' || saved === 'booking' || saved === 'grid' || saved === 'stats') _bkPageTab = saved;
  }
  _bkApplyTabVisibility();
  const dateEl = document.getElementById('booking-date');
  if (!dateEl) return;
  // 週檢視：空值時預設「包含今天的那一週」週一，而非直接塞今天（避免非週一時打亂週一～週五版面）；
  // 此分支也涵蓋登入時從使用者偏好還原檢視（見 applyDrivePrefs）後首次進頁的情境。
  if (!dateEl.value) dateEl.value = _bkWeekMode ? _bkGetMondayOf(new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
  const startDate = dateEl.value;
  const body = document.getElementById('bookings-body');
  if (!body) return;

  // 檢視切換 chips（勾選式，#5-4）與控制項顯示
  _bkRenderViewChips();
  const dateCtrl = document.getElementById('bk-date-controls');
  if (dateCtrl) dateCtrl.style.display = _bkListView ? 'none' : '';
  const filterBar = document.getElementById('bk-list-filter-bar');
  if (filterBar) filterBar.style.display = _bkListView ? 'flex' : 'none';

  if (_bkListView) {
    // 從使用者偏好還原列表檢視時（見 applyDrivePrefs），起始日欄位尚未預填，補與手動點列表檢視相同的預設值
    const fromEl = document.getElementById('bk-list-from');
    if (fromEl && !fromEl.value) fromEl.value = new Date().toISOString().slice(0, 10);
    renderBkListView(body);
    if (_bkPageTab === 'audit') renderBookingsAuditLog();
  else if (_bkPageTab === 'grid') renderBkGridTab();
  else if (_bkPageTab === 'stats') renderBkStatsTab();
    return;
  }

  const WD = ['日','一','二','三','四','五','六'];
  const addDays = (dateStr, n) => _bkAddDays(dateStr, n);
  const fmtDateHeader = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth()+1}/${d.getDate()} (${WD[d.getDay()]})`;
  };
  const isToday = (dateStr) => dateStr === new Date().toISOString().slice(0,10);
  const _seriesCountMap = _bkBuildSeriesCountMap(bookingsData);

  if (_bkDaySpan === 1) {
    // 單日模式：原始垂直列表（較寬鬆）
    const fmtT = t => (t || '').slice(0, 5);
    const dayBookings = bookingsData.filter(b => b.date === startDate);
    let html = '';
    for (const room of _getBkDisplayRooms()) {
      const rb = dayBookings.filter(b => b.room === room).sort((a, b) => (a.startTime || '') < (b.startTime || '') ? -1 : 1);
      html += `<div ondragover="bkDragOver(event)" ondrop="bkDrop(event,'${escHtml(room)}','${startDate}')" ondragenter="bkDragEnter(this)" ondragleave="bkDragLeave(this)" ondblclick="_bkCellDblClick(event,'${escHtml(room)}','${startDate}')" style="border-bottom:1px solid #e2e8f0;padding:10px 16px;transition:outline .1s;">
        <div style="font-weight:600;color:#2d3748;margin-bottom:6px;font-size:.9rem;">${escHtml(room)}</div>`;
      if (rb.length === 0) {
        html += `<div style="color:#a0aec0;font-size:.85rem;padding:2px 0;" data-tip="點兩下可直接新增預約">（無預約，可拖曳至此，雙擊可新增）</div>`;
      } else {
        rb.forEach(b => {
          const caseTag = b.caseId ? `<span style="font-size:.8rem;color:#2471a3;margin-left:6px;">個案 ${escHtml(b.caseId)}${b.caseName ? ' '+escHtml(b.caseName) : ''}</span>` : '';
          const noteTag = b.notes ? `<span style="font-size:.8rem;color:#718096;margin-left:6px;">${escHtml(b.notes.slice(0,30))}${b.notes.length>30?'…':''}</span>` : '';
          const calTag = b.calendarEventId
            ? `<span title="已同步 Google 日曆" style="font-size:.85rem;">📅</span>`
            : `<button class="btn btn-secondary btn-sm" style="padding:1px 7px;font-size:.75rem;" data-sync-id="${escHtml(b.id)}" onclick="event.stopPropagation();syncBookingToCalendar('${escHtml(b.id)}')">📅 同步</button>`;
          html += `<div data-bk-card="1" draggable="true" ondragstart="bkDragStart(event,'${escHtml(b.id)}')" ondragend="bkDragEnd(event)" ondblclick="_bkCardDblClick(event,'${escHtml(b.id)}')" data-tip="點兩下編輯" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;${_bkCellStyle(b)}border-radius:6px;margin-bottom:4px;cursor:grab;">
            <span style="font-size:.85rem;font-weight:600;color:#2d3748;min-width:105px;">${fmtT(b.startTime)}–${fmtT(b.endTime)}</span>
            <span style="font-size:.875rem;color:#4a5568;" title="${escHtml(b.counselorName || '')}">${escHtml(b.counselorName || '—')}${_bkCounselorBadges(b)}</span>
            ${_bkSeriesBadge(b, _seriesCountMap, false)}
            ${caseTag}${noteTag}${calTag}
            <span style="margin-left:auto;display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="event.stopPropagation();editBooking('${escHtml(b.id)}')">編輯</button>
              <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="event.stopPropagation();copyBooking('${escHtml(b.id)}')">複製</button>
              <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="event.stopPropagation();bkFillRecord('${escHtml(b.id)}')">填寫記錄</button>
              <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="event.stopPropagation();deleteBooking('${escHtml(b.id)}')">刪除</button>
            </span>
          </div>`;
        });
      }
      html += '</div>';
    }
    body.innerHTML = html;
  } else {
    // 多日模式：空間×日期 table，每空間一列、每天一欄，高度一致
    const dates = Array.from({ length: _bkDaySpan }, (_, i) => addDays(startDate, i));
    const rooms = _getBkDisplayRooms();
    const fmtT = t => (t || '').slice(0, 5);

    let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">`;
    // 表頭
    html += `<tr><th style="padding:6px 10px;background:#f7fafc;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;font-size:.78rem;color:#718096;text-align:left;white-space:nowrap;min-width:72px;">空間</th>`;
    dates.forEach(d => {
      const tc = isToday(d);
      html += `<th style="padding:6px 8px;background:${tc?'#ebf8ff':'#f7fafc'};border-bottom:2px solid ${tc?'#3182ce':'#e2e8f0'};border-right:1px solid #e2e8f0;font-size:.82rem;font-weight:700;color:${tc?'#2b6cb0':'#2d3748'};text-align:center;white-space:nowrap;min-width:110px;">` +
        `${fmtDateHeader(d)}<br><button class="btn btn-secondary btn-sm" style="font-size:.65rem;padding:0 5px;margin-top:2px;" onclick="document.getElementById('booking-date').value='${d}';setBkDaySpan(1)">單日</button></th>`;
    });
    html += '</tr>';
    // 每空間一列
    rooms.forEach(room => {
      html += `<tr><td style="padding:6px 10px;background:#f7fafc;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;font-weight:600;font-size:.8rem;color:#2d3748;vertical-align:top;white-space:nowrap;">${escHtml(room)}</td>`;
      dates.forEach(d => {
        const tc = isToday(d);
        const rb = bookingsData.filter(b => b.date === d && b.room === room).sort((a, b) => (a.startTime||'') < (b.startTime||'') ? -1 : 1);
        html += `<td ondragover="bkDragOver(event)" ondrop="bkDrop(event,'${escHtml(room)}','${escHtml(d)}')" ondragenter="bkDragEnter(this)" ondragleave="bkDragLeave(this)" ondblclick="_bkCellDblClick(event,'${escHtml(room)}','${escHtml(d)}')"${rb.length === 0 ? ' data-tip="點兩下可直接新增預約"' : ''} style="padding:5px 7px;background:${tc?'#f0f9ff':''};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:top;transition:outline .1s;">`;
        if (rb.length === 0) {
          html += `<span style="color:#cbd5e0;font-size:.75rem;">—</span>`;
        } else {
          rb.forEach(b => {
            const calTag = b.calendarEventId
              ? `<span title="已同步" style="font-size:.75rem;">📅</span>`
              : `<button class="btn btn-secondary btn-sm" style="padding:0 3px;font-size:.65rem;" data-sync-id="${escHtml(b.id)}" onclick="event.stopPropagation();syncBookingToCalendar('${escHtml(b.id)}')">📅</button>`;
            html += `<div data-bk-card="1" draggable="true" ondragstart="bkDragStart(event,'${escHtml(b.id)}')" ondragend="bkDragEnd(event)" ondblclick="_bkCardDblClick(event,'${escHtml(b.id)}')" data-tip="點兩下編輯" style="padding:3px 5px;${_bkCellStyle(b)}border-radius:4px;margin-bottom:3px;font-size:.78rem;cursor:grab;">` +
              `<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;font-weight:600;color:#2d3748;">${fmtT(b.startTime)}–${fmtT(b.endTime)}${_bkSeriesBadge(b, _seriesCountMap, true)}</div>` +
              `<div style="color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(b.counselorName||'')}">${escHtml(b.counselorName||'—')}</div>` +
              (b.caseId ? `<div style="color:#2471a3;font-size:.72rem;">${escHtml(b.caseId)}</div>` : '') +
              (b.notes ? `<div style="color:#718096;font-size:.72rem;">${escHtml(b.notes.slice(0,20))}${b.notes.length>20?'…':''}</div>` : '') +
              `<div style="display:flex;gap:2px;margin-top:2px;align-items:center;">` +
              `<button class="btn btn-secondary btn-sm" style="padding:0 5px;font-size:.67rem;" onclick="event.stopPropagation();editBooking('${escHtml(b.id)}')">編輯</button>` +
              `<button class="btn btn-secondary btn-sm" style="padding:0 5px;font-size:.67rem;" data-tip="填寫晤談紀錄" onclick="event.stopPropagation();bkFillRecord('${escHtml(b.id)}')">📝</button>` +
              `<button class="btn btn-danger btn-sm" style="padding:0 5px;font-size:.67rem;" onclick="event.stopPropagation();deleteBooking('${escHtml(b.id)}')">刪除</button>` +
              calTag +
              `<button class="btn btn-secondary btn-sm" style="padding:0 5px;font-size:.67rem;" onclick="event.stopPropagation();_bkCtxMenu(event,'${escHtml(b.id)}')">⋯</button>` +
              `</div></div>`;
          });
        }
        html += `</td>`;
      });
      html += `</tr>`;
    });
    html += `</table></div>`;
    body.innerHTML = html;
  }
  if (_bkPageTab === 'audit') renderBookingsAuditLog();
  else if (_bkPageTab === 'grid') renderBkGridTab();
  else if (_bkPageTab === 'stats') renderBkStatsTab();
}

function renderBkListView(body) {
  const from       = document.getElementById('bk-list-from')?.value      || '';
  const to         = document.getElementById('bk-list-to')?.value        || '';
  const roomFilter = document.getElementById('bk-list-room')?.value      || '';
  const cnslFilter = document.getElementById('bk-list-counselor')?.value || '';
  const sort       = document.getElementById('bk-list-sort')?.value      || 'time-asc';

  // 動態填充空間選單
  const roomSel = document.getElementById('bk-list-room');
  if (roomSel) {
    const cur = roomSel.value;
    roomSel.innerHTML = '<option value="">全部空間</option>' +
      _getBkDisplayRooms().map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
    roomSel.value = cur;
  }

  // 動態填充主責選單
  const cnslSel = document.getElementById('bk-list-counselor');
  if (cnslSel) {
    const cur = cnslSel.value;
    cnslSel.innerHTML = buildCounselorFilterOpts(cur, false, '全部主責');
  }

  // 篩選
  let rows = bookingsData.filter(b => {
    if (from && (b.date || '') < from) return false;
    if (to   && (b.date || '') > to)   return false;
    if (roomFilter && b.room !== roomFilter) return false;
    if (cnslFilter && b.counselorEmail !== cnslFilter) return false;
    return true;
  });

  // 排序
  const key = b => (b.date || '') + (b.startTime || '') + (b.room || '');
  rows.sort((a, b) => {
    if (sort === 'time-desc') return key(b) < key(a) ? -1 : 1;
    if (sort === 'room')      return (a.room || '') < (b.room || '') ? -1 : (a.room || '') > (b.room || '') ? 1 : key(a) < key(b) ? -1 : 1;
    if (sort === 'counselor') { const an = a.counselors?.[0]?.label || a.counselorName || '', bn = b.counselors?.[0]?.label || b.counselorName || ''; return an < bn ? -1 : an > bn ? 1 : key(a) < key(b) ? -1 : 1; }
    return key(a) < key(b) ? -1 : 1; // time-asc default
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / _BK_LIST_PAGE_SIZE));
  _bkListPage = Math.min(Math.max(1, _bkListPage), totalPages);
  const pageRows = rows.slice((_bkListPage - 1) * _BK_LIST_PAGE_SIZE, _bkListPage * _BK_LIST_PAGE_SIZE);

  const countEl = document.getElementById('bk-list-count');
  if (countEl) countEl.textContent = `共 ${total} 筆`;

  if (total === 0) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:#718096;">無符合條件的預約</div>';
    return;
  }

  const WD = ['日','一','二','三','四','五','六'];
  const fmtT = t => (t || '').slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);
  const fmtDate = ds => {
    const d = new Date(ds + 'T00:00:00');
    return `${d.getFullYear()-1911}/${d.getMonth()+1}/${d.getDate()} (${WD[d.getDay()]})`;
  };
  const _seriesCountMap = _bkBuildSeriesCountMap(bookingsData);

  body.innerHTML = pageRows.map(b => {
    const isPast   = b.date < today;
    const isTdy    = b.date === today;
    const rowBg    = isTdy ? '#ebf8ff' : isPast ? '#f9fafb' : '#fff';
    const dateClr  = isTdy ? '#2b6cb0' : isPast ? '#a0aec0' : '#2d3748';
    const caseTag  = b.caseId ? `${escHtml(b.caseId)}${b.caseName ? ' ' + escHtml(b.caseName) : ''}` : '';
    const calTag   = b.calendarEventId
      ? `<span title="已同步 Google 日曆" style="font-size:.85rem;">📅</span>`
      : `<button class="btn btn-secondary btn-sm" style="padding:1px 7px;font-size:.75rem;" onclick="syncBookingToCalendar('${escHtml(b.id)}')">📅 同步</button>`;
    // #5-5：套用該筆有效顏色（建立者/主責偏好色）— 粗色左邊框＋極淡同色底，文字顏色不變；無顏色者維持原樣
    const _rowClr  = _bkEffColor(b);
    const rowStyle = _rowClr ? `background:${_rowClr}1a;border-left:4px solid ${_rowClr};` : `background:${rowBg};`;
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid #e2e8f0;${rowStyle}flex-wrap:wrap;">
      <div style="min-width:140px;">
        <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:.88rem;color:${dateClr};">${fmtDate(b.date)}${_bkSeriesBadge(b, _seriesCountMap, false)}</div>
        <div style="font-size:.85rem;color:#4a5568;margin-top:2px;">${fmtT(b.startTime)}–${fmtT(b.endTime)}</div>
      </div>
      <div style="min-width:90px;">
        <div style="font-size:.75rem;color:#718096;">空間</div>
        <div style="font-size:.88rem;color:#2d3748;font-weight:600;">${escHtml(b.room || '—')}</div>
      </div>
      <div style="min-width:90px;max-width:160px;">
        <div style="font-size:.75rem;color:#718096;">主責</div>
        <div style="font-size:.88rem;color:#2d3748;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(b.counselorName || '')}">${escHtml(b.counselorName || '—')}${_bkCounselorBadges(b)}</div>
      </div>
      ${caseTag ? `<div style="min-width:90px;"><div style="font-size:.75rem;color:#718096;">個案</div><div style="font-size:.88rem;color:#2471a3;">${caseTag}</div></div>` : ''}
      ${b.notes ? `<div style="flex:1;min-width:100px;"><div style="font-size:.75rem;color:#718096;">備註</div><div style="font-size:.85rem;color:#4a5568;">${escHtml(b.notes.slice(0,60))}${b.notes.length>60?'…':''}</div></div>` : ''}
      <div style="margin-left:auto;display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        ${calTag}
        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="editBooking('${escHtml(b.id)}')">編輯</button>
        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="copyBooking('${escHtml(b.id)}')">複製</button>
        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="bkFillRecord('${escHtml(b.id)}')">填寫記錄</button>
        <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:.78rem;" onclick="deleteBooking('${escHtml(b.id)}')">刪除</button>
      </div>
    </div>`;
  }).join('') + (totalPages > 1 ? `
  <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f7fafc;flex-wrap:wrap;">
    <button class="btn btn-secondary btn-sm" onclick="_bkListGo(1)" ${_bkListPage===1?'disabled':''}>«</button>
    <button class="btn btn-secondary btn-sm" onclick="_bkListGo(${_bkListPage-1})" ${_bkListPage===1?'disabled':''}>‹</button>
    <span style="font-size:.85rem;color:#4a5568;">第 ${_bkListPage} / ${totalPages} 頁（共 ${total} 筆）</span>
    <button class="btn btn-secondary btn-sm" onclick="_bkListGo(${_bkListPage+1})" ${_bkListPage===totalPages?'disabled':''}>›</button>
    <button class="btn btn-secondary btn-sm" onclick="_bkListGo(${totalPages})" ${_bkListPage===totalPages?'disabled':''}>»</button>
  </div>` : '');
}

function _bkListGo(page) { _bkListPage = page; renderBookingsPage(); }

function resetBkListFilters() {
  ['bk-list-from', 'bk-list-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['bk-list-room', 'bk-list-counselor'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sortEl = document.getElementById('bk-list-sort');
  if (sortEl) sortEl.value = 'time-asc';
  _bkListPage = 1;
  renderBookingsPage();
}

// 拖曳結束後瀏覽器有時仍會補一個 click 事件在卡片上，若不抑制會在放開拖曳的瞬間誤觸
// _bkCardDblClick 開出編輯 Modal；dragend 後延遲清旗標，讓緊接著補發的 click 先讀到 true 而被擋下。
let _bkJustDragged = false;
function bkDragStart(event, bookingId) {
  event.dataTransfer.setData('bk-id', bookingId);
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.style.opacity = '0.5';
  _bkJustDragged = true;
}
function bkDragEnd(event) {
  event.currentTarget.style.opacity = '';
  setTimeout(() => { _bkJustDragged = false; }, 200);
}
function bkDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}
function bkDragEnter(el) {
  el.dataset.dragOver = '1';
  el.style.outline = '2px dashed #3182ce';
}
function bkDragLeave(el) {
  if (el.dataset.dragOver) { delete el.dataset.dragOver; el.style.outline = ''; }
}

// v136：單日／多日（3/5/週）檢視——在預約卡片上雙擊才開編輯 Modal（單擊太容易誤觸，改為雙擊；
// 卡片內各按鈕已各自 stopPropagation，不會與此重複觸發）；拖曳剛結束補發的 click 一律忽略（見 _bkJustDragged）。
function _bkCardDblClick(event, id) {
  event.stopPropagation();
  if (_bkJustDragged) return;
  editBooking(id);
}

// v103：單日／多日（3/5/週）檢視——在空白時段格子上雙擊直接開新增預約 Modal，帶入該空間／日期。
// 雙擊落在既有卡片（data-bk-card）上時不處理（交由卡片自己的雙擊編輯邏輯，避免雙擊卡片誤開新增；
// 卡片的 dblclick 已 stopPropagation，此處的 closest 檢查是雙重保險）。
function _bkCellDblClick(event, room, date) {
  if (event.target.closest('[data-bk-card]')) return;
  openBookingModal(null, { room, date });
}

// GC 背景同步佇列（Map 確保同一筆快速拖曳只推送最終狀態）
// 現況（bkDrop 改走 bkCommit 後）：僅剩「舊後端尚未部署（bkCommit 回傳 fallback）」時的相容路徑會用到，
// 正常路徑的 GC 同步已交由後端 bookingsCommit 逐 op 處理。
const _bkGcQueue = new Map();
let _bkGcRunning = false;
async function _bkGcFlush() {
  if (_bkGcRunning || _bkGcQueue.size === 0) return;
  _bkGcRunning = true;
  while (_bkGcQueue.size > 0) {
    const [id, snap] = _bkGcQueue.entries().next().value;
    _bkGcQueue.delete(id);
    if (!snap.calendarEventId) continue;
    const creatorName = configData?.users?.[snap.creatorEmail]?.name || snap.creatorName || '';
    try {
      await proxyCall('updateCalendarEvent', {
        eventId: snap.calendarEventId,
        room: snap.room, customRoom: snap.customRoom,
        date: snap.date, startTime: snap.startTime, endTime: snap.endTime,
        counselorName: snap.counselorName, notes: snap.notes,
        creatorName, createdAt: snap.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(), isEdit: true, bkSerial: snap.bkSerial,
        colorId: _bkGcColorId(snap),
      });
    } catch(_) { /* 靜默失敗，不影響本機資料 */ }
  }
  _bkGcRunning = false;
}

// v174：拖曳結束後最終畫面刷新——依目前所在 tab 決定重繪目標；「時段格線」（單日詳細預約）拖曳
// 只改房間／節次時間、不改日期，仍走同一套 bkDrop/_bkDragConfirmScope/衝突修正 modal，僅render目標不同。
function _bkRefreshCurrentView() {
  if (_bkPageTab === 'grid') renderBkGridTab(); else renderBookingsPage();
}

// 拖曳調整：非系列預約直接套用＋衝突檢查；系列預約先詢問套用範圍（見 _bkDragConfirmScope）。
let _bkDragPending = null; // { id, newRoom, newDate, newStart, newEnd }（等待系列範圍確認時暫存，尚未套用到 bookingsData）

// newStart/newEnd（v174，選填）：時段格線拖曳改期用——把預約改到目標節次的起訖時間（房間/日期拖曳
// 不帶這兩個參數）。衝突判定完全重用 _bkFindConflict／_bkLocalConflicts（本就以 candidate.startTime/
// endTime 通用比對，不需另寫邏輯）；系列預約走既有 _bkDragConfirmScope，時間差同日期差一樣做整批平移。
async function bkDrop(event, newRoom, newDate, newStart, newEnd) {
  event.preventDefault();
  const dropEl = event.currentTarget;
  dropEl.style.outline = '';
  const bookingId = event.dataTransfer.getData('bk-id');
  const b = bookingsData.find(x => x.id === bookingId);
  if (!b) return;
  const changed = (newRoom && b.room !== newRoom) || (newDate && b.date !== newDate) ||
    (newStart && b.startTime !== newStart) || (newEnd && b.endTime !== newEnd);
  if (!changed) return;

  if (b.seriesId) {
    // 系列預約：先不套用，詢問範圍後由 _bkDragConfirmScope 處理
    _bkDragPending = { id: bookingId, newRoom: newRoom || '', newDate: newDate || '', newStart: newStart || '', newEnd: newEnd || '' };
    document.getElementById('bk-drag-scope-modal').style.display = 'flex';
    return;
  }

  // 前端本機衝突檢查（放開拖曳當下先算，不必等後端來回）：有衝突就不套用任何變更，改開衝突修正 modal
  const proposal = { ...b };
  if (newRoom) proposal.room = newRoom;
  if (newDate) proposal.date = newDate;
  if (newStart) proposal.startTime = newStart;
  if (newEnd) proposal.endTime = newEnd;
  if (_bkLocalConflicts([proposal], new Set([b.id])).length) {
    _bkOpenDragFixModal([b], [proposal], '拖曳調整預約');
    return;
  }

  const oldRoom = b.room, oldDate = b.date, oldStart = b.startTime, oldEnd = b.endTime;
  if (newRoom) b.room = newRoom;
  if (newDate) b.date = newDate;
  if (newStart) b.startTime = newStart;
  if (newEnd) b.endTime = newEnd;

  // 立即更新畫面（樂觀更新，不顯示 loading）
  _bkRefreshCurrentView();

  const jobId = bgJobAdd('拖曳調整預約', `${b.room} ${b.date}`);
  try {
    bgJobProgress(jobId, 40);
    const gcMode = b.calendarEventId ? 'update' : 'create';
    const result = await bkCommit(
      [{ op: 'upsert', booking: { ...b }, gc: { mode: gcMode, params: _bkGcParamsOf(b, true) } }],
      { checkConflicts: true });
    bgJobProgress(jobId, 75);

    if (result.error === 'conflict') {
      b.room = oldRoom; b.date = oldDate; b.startTime = oldStart; b.endTime = oldEnd;
      _bkRefreshCurrentView();
      const w = result.with || {};
      const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
      const kind = result.conflictType === 'person' ? '人員' : '空間';
      setAlert('bookings-alert', 'warn',
        `⚠ 拖曳未套用：與其他預約發生${kind}衝突（${escHtml(wRoom)} ${escHtml(w.date||'')} ${escHtml((w.startTime||'').slice(0,5))}–${escHtml((w.endTime||'').slice(0,5))}${w.counselorName ? '　'+escHtml(w.counselorName) : ''}），已還原原時段。`);
      bgJobFail(jobId, `拖曳${kind}衝突`);
      return;
    }

    if (result.fallback) {
      // 舊後端尚未部署：沿用原路徑（整檔覆寫＋既有 calendarEventId 才進 GC 佇列）
      await saveBookings();
      if (b.calendarEventId) { _bkGcQueue.set(bookingId, { ...b }); _bkGcFlush(); }
    } else {
      const fb = (result.bookings || []).find(x => x.id === b.id);
      if (fb) Object.assign(b, fb);
    }

    const timeMsg = (newStart || newEnd) ? `　時間 ${(oldStart||'').slice(0,5)}–${(oldEnd||'').slice(0,5)} → ${(b.startTime||'').slice(0,5)}–${(b.endTime||'').slice(0,5)}` : '';
    auditLog(`空間預約調整：${oldRoom}${oldDate !== (newDate||oldDate) ? ' '+oldDate : ''} → ${b.room}${b.date !== oldDate ? ' '+b.date : ''}（${b.counselorName || '—'}）${timeMsg}`);
    bgJobDone(jobId);
    _bkRefreshCurrentView();
  } catch(e) {
    b.room = oldRoom; b.date = oldDate; b.startTime = oldStart; b.endTime = oldEnd;
    _bkRefreshCurrentView();
    bgJobFail(jobId, e.message);
  }
}

// 系列拖曳：使用者選定套用範圍後套用（房間變更套用所有 targets；日期依 delta 平移，語意與 saveBooking T3 相同；
// v174：時間變更同理依 delta 分鐘數整批平移，供時段格線拖曳系列預約使用）。
async function _bkDragConfirmScope(scope) {
  document.getElementById('bk-drag-scope-modal').style.display = 'none';
  const pending = _bkDragPending; _bkDragPending = null;
  if (!pending) return;
  const b = bookingsData.find(x => x.id === pending.id);
  if (!b) return;

  const dateDelta = pending.newDate ? _bkDaysBetween(b.date, pending.newDate) : 0;
  const startDeltaMin = pending.newStart ? _bkTimeDeltaMin(b.startTime, pending.newStart) : 0;
  const endDeltaMin = pending.newEnd ? _bkTimeDeltaMin(b.endTime, pending.newEnd) : 0;
  const targets = _bkSeriesTargets(bookingsData, b, scope);
  if (!targets.length) return;

  // 前端本機衝突檢查（放開拖曳當下先算）：有衝突就整批先不套用，改開衝突修正 modal（逐筆調整或刪除）
  const proposals = targets.map(t => {
    const p = { ...t };
    if (pending.newRoom) p.room = pending.newRoom;
    if (dateDelta) p.date = _bkAddDays(t.date, dateDelta);
    if (startDeltaMin) p.startTime = _bkShiftTime(t.startTime, startDeltaMin);
    if (endDeltaMin) p.endTime = _bkShiftTime(t.endTime, endDeltaMin);
    return p;
  });
  const excludeIds = new Set(targets.map(t => t.id));
  if (_bkLocalConflicts(proposals, excludeIds).length) {
    _bkOpenDragFixModal(targets, proposals, '拖曳調整系列預約');
    return;
  }

  const snapshot = targets.map(t => ({ id: t.id, room: t.room, customRoom: t.customRoom, date: t.date, startTime: t.startTime, endTime: t.endTime }));

  targets.forEach(t => {
    if (pending.newRoom) t.room = pending.newRoom;
    if (dateDelta) t.date = _bkAddDays(t.date, dateDelta);
    if (startDeltaMin) t.startTime = _bkShiftTime(t.startTime, startDeltaMin);
    if (endDeltaMin) t.endTime = _bkShiftTime(t.endTime, endDeltaMin);
  });
  _bkRefreshCurrentView();

  const jobId = bgJobAdd('拖曳調整系列預約', `共 ${targets.length} 筆`);
  try {
    const ops = targets.map(t => ({
      op: 'upsert', booking: { ...t },
      gc: { mode: t.calendarEventId ? 'update' : 'create', params: _bkGcParamsOf(t, true) },
    }));
    const result = await bkCommit(ops, { checkConflicts: true });

    if (result.error === 'conflict') {
      snapshot.forEach(s => {
        const t = bookingsData.find(x => x.id === s.id);
        if (t) { t.room = s.room; t.customRoom = s.customRoom; t.date = s.date; t.startTime = s.startTime; t.endTime = s.endTime; }
      });
      _bkRefreshCurrentView();
      const w = result.with || {};
      const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
      const kind = result.conflictType === 'person' ? '人員' : '空間';
      const skipHint = kind === '人員' ? '（拖曳不提供略過人員衝突，如需忽略請改用編輯表單處理）' : '';
      setAlert('bookings-alert', 'warn',
        `⚠ 拖曳未套用：系列預約中有一筆與其他預約發生${kind}衝突（${escHtml(wRoom)} ${escHtml(w.date||'')} ${escHtml((w.startTime||'').slice(0,5))}–${escHtml((w.endTime||'').slice(0,5))}${w.counselorName ? '　'+escHtml(w.counselorName) : ''}），整批已還原。${skipHint}`);
      bgJobFail(jobId, `拖曳系列${kind}衝突`);
      return;
    }

    if (result.fallback) {
      await saveBookings();
      targets.forEach(t => { if (t.calendarEventId) { _bkGcQueue.set(t.id, { ...t }); _bkGcFlush(); } });
    } else {
      (result.bookings || []).forEach(fb => {
        const idx = bookingsData.findIndex(x => x.id === fb.id);
        if (idx >= 0) bookingsData[idx] = fb;
      });
    }

    auditLog(`空間預約調整（系列拖曳，共 ${targets.length} 筆）：${pending.newRoom ? '空間→'+pending.newRoom+'；' : ''}${dateDelta ? `日期平移 ${dateDelta} 天；` : ''}${(startDeltaMin || endDeltaMin) ? `時間平移 ${startDeltaMin || endDeltaMin} 分鐘` : ''}`);
    bgJobDone(jobId);
    _bkRefreshCurrentView();
  } catch (e) {
    snapshot.forEach(s => {
      const t = bookingsData.find(x => x.id === s.id);
      if (t) { t.room = s.room; t.customRoom = s.customRoom; t.date = s.date; t.startTime = s.startTime; t.endTime = s.endTime; }
    });
    _bkRefreshCurrentView();
    bgJobFail(jobId, e.message);
  }
}

// ── 拖曳衝突修正 modal ──────────────────────────────────────────────
// 拖曳前端本機偵測到衝突時，不整批還原了事，改開這個 modal：每個衝突的預約一個 tab，
// 可逐筆調整時間/空間或直接刪除，全部解決（或刪除）前不能套用。
// _bkDragFix 形狀：
//   proposals: Map<id, proposal>  擬議狀態（可編輯）
//   originals: Map<id, booking>   原始筆（未套用任何拖曳變更，供還原/GC 對照）
//   deletedIds: Set<id>           使用者標記要刪除的筆
//   tabIds: string[]              曾經衝突過而開出 tab 的 id（保留順序，解決後仍顯示 ✓）
//   activeTabId: string|null
//   conflicts: [{id,type,with}]   最近一次重算的衝突清單（排除已標記刪除者）
//   scopeLabel: string            供背景工作/稽核日誌描述用
let _bkDragFix = null;

// preDeletedIds（v100，選填）：呼叫端已決定要刪除的既有筆 id（如系列重排減少次數要刪掉的筆）——
// 預先加入 deletedIds，這些筆若沒有衝突就不會開 tab，但 _bkDragFixApply 迭代時仍會歸入 delete ops。
function _bkOpenDragFixModal(originals, proposals, scopeLabel, preDeletedIds) {
  _bkDragFix = {
    proposals: new Map(proposals.map(p => [p.id, { ...p }])),
    originals: new Map(originals.map(o => [o.id, o])),
    deletedIds: new Set(preDeletedIds || []),
    tabIds: [],
    activeTabId: null,
    conflicts: [],
    scopeLabel: scopeLabel || '拖曳調整預約',
  };
  _bkDragFixRecompute();
  document.getElementById('bk-drag-fix-modal').style.display = 'flex';
}

// 任何欄位變更／標記刪除後呼叫：排除已標記刪除者整批重算 _bkLocalConflicts，
// 新出現衝突的筆自動開 tab（保留已開過的 tab，即使該筆衝突已解決也繼續顯示 ✓）。
function _bkDragFixRecompute() {
  const st = _bkDragFix;
  if (!st) return;
  const allIds = new Set(st.proposals.keys());
  const live = [...st.proposals.values()].filter(p => !st.deletedIds.has(p.id));
  st.conflicts = _bkLocalConflicts(live, allIds);
  st.conflicts.forEach(c => { if (!st.tabIds.includes(c.id)) st.tabIds.push(c.id); });
  if (!st.activeTabId || !st.tabIds.includes(st.activeTabId)) st.activeTabId = st.tabIds[0] || null;
  _bkDragFixRender();
}

function _bkDragFixSwitchTab(id) {
  if (!_bkDragFix) return;
  _bkDragFix.activeTabId = id;
  _bkDragFixRender();
}

function _bkDragFixFieldChange(id, field, value) {
  const st = _bkDragFix;
  if (!st) return;
  const p = st.proposals.get(id);
  if (!p) return;
  if (field === 'room') { p.room = value; if (value !== '其他') p.customRoom = ''; }
  else p[field] = value;
  _bkDragFixRecompute();
}

function _bkDragFixToggleDelete(id) {
  const st = _bkDragFix;
  if (!st) return;
  if (st.deletedIds.has(id)) st.deletedIds.delete(id); else st.deletedIds.add(id);
  _bkDragFixRecompute();
}

function _bkDragFixCancel() {
  document.getElementById('bk-drag-fix-modal').style.display = 'none';
  _bkDragFix = null;
}

function _bkDragFixRoomLabel(p) {
  return p.room === '其他' ? (p.customRoom || '其他') : (p.room || '');
}

// 節次下拉：選定節次即帶入該節開始/結束時間並整批重算衝突；選「自訂時間」則保留手動輸入值
function _bkDragFixPeriodChange(id, label) {
  const st = _bkDragFix;
  if (!st) return;
  const p = st.proposals.get(id);
  if (!p) return;
  const period = BK_PERIODS.find(x => x.label === label);
  if (!period) return; // 「— 自訂時間 —」：不動現值，維持手動輸入
  p.startTime = period.start;
  p.endTime = period.end;
  _bkDragFixRecompute();
}

function _bkDragFixRenderTabContent(id) {
  const st = _bkDragFix;
  if (!st || !id) return '';
  const p = st.proposals.get(id);
  if (!p) return '';
  const isDeleted = st.deletedIds.has(id);
  const conflict = st.conflicts.find(c => c.id === id);
  const roomVal = p.room === '其他' ? '其他' : p.room;
  const roomOpts = _getBkDisplayRooms().map(r =>
    `<option value="${escHtml(r)}" ${r === roomVal ? 'selected' : ''}>${escHtml(r)}</option>`).join('');

  let statusHtml;
  if (isDeleted) {
    statusHtml = `<div class="alert alert-warn" style="margin-top:10px;">此筆將被刪除，不會套用任何變更。</div>`;
  } else if (conflict) {
    const w = conflict.with || {};
    const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
    const kind = conflict.type === 'person' ? '人員' : '空間';
    statusHtml = `<div class="alert alert-warn" style="margin-top:10px;">⚠ ${kind}衝突：與 ${escHtml(wRoom)} ${escHtml(w.date || '')} ${escHtml((w.startTime || '').slice(0,5))}–${escHtml((w.endTime || '').slice(0,5))}${w.counselorName ? '　' + escHtml(w.counselorName) : ''} 衝突，請調整時間／空間或刪除此筆。</div>`;
  } else {
    statusHtml = `<div class="alert alert-info" style="margin-top:10px;">✓ 已解決衝突。</div>`;
  }

  const curPeriod = BK_PERIODS.find(x => x.start === (p.startTime || '').slice(0,5) && x.end === (p.endTime || '').slice(0,5));
  const periodOpts = `<option value="">— 自訂時間 —</option>` + BK_PERIODS.map(x =>
    `<option value="${escHtml(x.label)}" ${curPeriod && curPeriod.label === x.label ? 'selected' : ''}>${escHtml(x.label)}</option>`).join('');

  return `
    <div style="opacity:${isDeleted ? '.55' : '1'};">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:.8rem;color:#718096;">日期</label>
          <input type="date" class="field-input" value="${escHtml(p.date || '')}" ${isDeleted ? 'disabled' : ''}
            onchange="_bkDragFixFieldChange('${escHtml(id)}','date',this.value)">
        </div>
        <div>
          <label style="font-size:.8rem;color:#718096;">空間</label>
          <select class="field-input" ${isDeleted ? 'disabled' : ''}
            onchange="_bkDragFixFieldChange('${escHtml(id)}','room',this.value)">${roomOpts}</select>
        </div>
        <div style="grid-column:1/-1;">
          <label style="font-size:.8rem;color:#718096;">節次（選定即帶入該節時間）</label>
          <select class="field-input" ${isDeleted ? 'disabled' : ''}
            onchange="_bkDragFixPeriodChange('${escHtml(id)}',this.value)">${periodOpts}</select>
        </div>
        <div>
          <label style="font-size:.8rem;color:#718096;">開始時間</label>
          <input type="time" class="field-input" value="${escHtml((p.startTime || '').slice(0,5))}" ${isDeleted ? 'disabled' : ''}
            onchange="_bkDragFixFieldChange('${escHtml(id)}','startTime',this.value)">
        </div>
        <div>
          <label style="font-size:.8rem;color:#718096;">結束時間</label>
          <input type="time" class="field-input" value="${escHtml((p.endTime || '').slice(0,5))}" ${isDeleted ? 'disabled' : ''}
            onchange="_bkDragFixFieldChange('${escHtml(id)}','endTime',this.value)">
        </div>
      </div>
      <div style="margin-top:8px;font-size:.82rem;color:#4a5568;">${escHtml(p.counselorName || '—')}${p.caseId ? '　個案 ' + escHtml(p.caseId) : ''}</div>
      ${statusHtml}
      <div style="margin-top:10px;">
        <button type="button" class="btn ${isDeleted ? 'btn-secondary' : 'btn-danger'} btn-sm" onclick="_bkDragFixToggleDelete('${escHtml(id)}')">${isDeleted ? '↩ 復原刪除' : '🗑 刪除此筆'}</button>
      </div>
    </div>`;
}

function _bkDragFixRender() {
  const st = _bkDragFix;
  if (!st) return;
  const countEl = document.getElementById('bk-drag-fix-count');
  if (countEl) countEl.textContent = String(st.tabIds.length);

  const tabsEl = document.getElementById('bk-drag-fix-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = st.tabIds.map(id => {
      const p = st.proposals.get(id);
      if (!p) return '';
      const isDeleted = st.deletedIds.has(id);
      const isConflict = st.conflicts.some(c => c.id === id);
      const icon = isDeleted ? '🗑' : isConflict ? '⚠' : '✓';
      const label = `${(p.date || '').slice(5).replace('-', '/')} ${_bkDragFixRoomLabel(p)}`;
      const active = id === st.activeTabId;
      return `<button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" style="white-space:nowrap;" onclick="_bkDragFixSwitchTab('${escHtml(id)}')">${icon} ${escHtml(label)}</button>`;
    }).join('');
  }

  const contentEl = document.getElementById('bk-drag-fix-content');
  if (contentEl) contentEl.innerHTML = _bkDragFixRenderTabContent(st.activeTabId);

  const applyBtn = document.getElementById('bk-drag-fix-apply-btn');
  if (applyBtn) {
    const unresolved = st.tabIds.some(id => !st.deletedIds.has(id) && st.conflicts.some(c => c.id === id));
    applyBtn.disabled = unresolved;
  }
}

async function _bkDragFixApply() {
  const st = _bkDragFix;
  if (!st) return;
  const unresolved = st.tabIds.some(id => !st.deletedIds.has(id) && st.conflicts.some(c => c.id === id));
  if (unresolved) return;

  document.getElementById('bk-drag-fix-modal').style.display = 'none';

  const survivors = [];
  const deleted = [];
  st.proposals.forEach((p, id) => { if (st.deletedIds.has(id)) deleted.push(p); else survivors.push(p); });

  const _snapshot = bookingsData.map(b => ({ ...b }));

  // 樂觀更新：套用存活筆變更、移除刪除筆
  // v100：survivors 可能含 bookingsData 尚不存在的新筆（如系列重排新增筆）——找不到既有筆就 push 而非略過。
  survivors.forEach(p => {
    const idx = bookingsData.findIndex(x => x.id === p.id);
    if (idx >= 0) bookingsData[idx] = { ...bookingsData[idx], ...p };
    else bookingsData.push({ ...p });
  });
  const deletedIdSet = new Set(deleted.map(b => b.id));
  if (deletedIdSet.size) bookingsData = bookingsData.filter(b => !deletedIdSet.has(b.id));
  _bkRefreshCurrentView();

  const jobId = bgJobAdd(st.scopeLabel, `共 ${survivors.length} 筆，刪除 ${deleted.length} 筆`);
  try {
    const ops = [
      ...survivors.map(p => ({
        op: 'upsert', booking: { ...p },
        gc: { mode: p.calendarEventId ? 'update' : 'create', params: _bkGcParamsOf(p, true) },
      })),
      ...deleted.map(b => ({ op: 'delete', id: b.id, gcEventId: b.calendarEventId || null })),
    ];
    const result = await bkCommit(ops, { checkConflicts: true });

    if (result.error === 'conflict') {
      bookingsData = _snapshot;
      _bkRefreshCurrentView();
      const w = result.with || {};
      const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
      const kind = result.conflictType === 'person' ? '人員' : '空間';
      setAlert('bookings-alert', 'warn',
        `⚠ 拖曳未套用：與其他使用者同時操作發生${kind}衝突（${escHtml(wRoom)} ${escHtml(w.date || '')} ${escHtml((w.startTime || '').slice(0,5))}–${escHtml((w.endTime || '').slice(0,5))}${w.counselorName ? '　' + escHtml(w.counselorName) : ''}），整批已還原，請重新確認後再操作一次。`);
      bgJobFail(jobId, `拖曳${kind}衝突`);
      _bkDragFix = null;
      return;
    }

    if (result.fallback) {
      // 舊後端尚未部署：整檔覆寫＋既有 calendarEventId 才進 GC 佇列（_bkGcFlush 只處理 update）；
      // v100：survivors 可能含新增筆（無 calendarEventId），改直接呼叫 createCalendarEvent 補建。
      await saveBookings();
      for (const p of survivors) {
        if (p.calendarEventId) { _bkGcQueue.set(p.id, { ...p }); continue; }
        try {
          const eid = await proxyCall('createCalendarEvent', _bkGcParamsOf(p, false));
          if (eid) { const bk = bookingsData.find(x => x.id === p.id); if (bk) bk.calendarEventId = eid; }
        } catch (_) {}
      }
      _bkGcFlush();
      deleted.forEach(b => { if (b.calendarEventId) proxyCall('deleteCalendarEvent', { eventId: b.calendarEventId }).catch(() => {}); });
    } else {
      (result.bookings || []).forEach(fb => {
        const idx = bookingsData.findIndex(x => x.id === fb.id);
        if (idx >= 0) bookingsData[idx] = fb;
      });
    }

    const _fixFirst = survivors[0] ? `${_bkDragFixRoomLabel(survivors[0])} ${survivors[0].date} ${(survivors[0].startTime||'').slice(0,5)}–${(survivors[0].endTime||'').slice(0,5)}${survivors[0].counselorName ? '　'+survivors[0].counselorName : ''}` : '';
    auditLog(`空間預約調整（拖曳＋衝突修正，共 ${survivors.length} 筆，刪除 ${deleted.length} 筆）：${_fixFirst}${survivors.length > 1 ? ' 等' : ''}`);
    bgJobDone(jobId);
    _bkRefreshCurrentView();
  } catch (e) {
    bookingsData = _snapshot;
    _bkRefreshCurrentView();
    bgJobFail(jobId, e.message);
  }
  _bkDragFix = null;
}

function shiftBookingDate(delta) {
  if (_bkWeekMode) { shiftBkWeek(delta); return; }
  const el = document.getElementById('booking-date');
  if (!el) return;
  const d = new Date(el.value || new Date());
  d.setDate(d.getDate() + delta * _bkDaySpan);
  el.value = d.toISOString().slice(0, 10);
  renderBookingsPage();
}

function setBookingDateToday() {
  const el = document.getElementById('booking-date');
  const todayStr = new Date().toISOString().slice(0, 10);
  // 週檢視：跳到「包含今天的那一週」且維持週一開頭（週一～週五），不可直接把今天塞進第一欄，
  // 否則今天若非週一會把整週版面打亂（例如今天是週三，會變成「週三～下週二」）。
  if (el) el.value = _bkWeekMode ? _bkGetMondayOf(todayStr) : todayStr;
  renderBookingsPage();
}

// ── 空間預約「空間」選擇器（chips）──────────────────
let _bkSelectedRoom = '';
let _bkRoomChipComposing = false;
function _getBkCustomRooms()       { return [...(_userPref_('bkCustomRooms', []))]; }
function _saveBkCustomRooms(rooms) { syncUserPref_({ bkCustomRooms: rooms }); }

function _populateBookingRoomChips(restoreRoom) {
  if (restoreRoom !== undefined) _bkSelectedRoom = restoreRoom;
  const wrap = document.getElementById('bk-room-chips-wrap');
  if (!wrap) return;
  // 骨架僅建立一次；重繪時只更新 chips 內層，避免打字時 input 被銷毀失焦
  if (!document.getElementById('bk-room-chip-list')) {
    wrap.innerHTML =
      `<div id="bk-room-chip-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>` +
      `<div style="display:flex;gap:6px;"><input type="text" id="bk-room-chip-inp" class="field-input" placeholder="新增自訂空間…" style="flex:1;font-size:.82rem;padding:5px 9px;" oninput="if(!_bkRoomChipComposing)_populateBookingRoomChipsList()" oncompositionstart="_bkRoomChipComposing=true" oncompositionend="_bkRoomChipComposing=false;_populateBookingRoomChipsList()" onkeydown="if(event.key==='Enter'){event.preventDefault();_bkAddCustomRoom();}"/><button type="button" onclick="_bkAddCustomRoom()" style="padding:5px 14px;background:#edf2f7;border:1px solid #cbd5e0;border-radius:6px;cursor:pointer;font-size:.82rem;white-space:nowrap;">新增</button></div>`;
  }
  _populateBookingRoomChipsList();
}
function _populateBookingRoomChipsList() {
  const list = document.getElementById('bk-room-chip-list');
  if (!list) return;
  const builtIn = ROOMS.filter(r => r !== '其他');
  const custom  = _getBkCustomRooms();
  const all     = [...builtIn, ...custom];
  const filter  = (document.getElementById('bk-room-chip-inp')?.value || '').trim().toLowerCase();
  const chips = all.map(r => {
    const sel = r === _bkSelectedRoom;
    const isC = !builtIn.includes(r);
    const hi  = filter && !sel && r.toLowerCase().includes(filter);
    const del = isC ? `<span class="bk-opt-chip-del" onclick="event.stopPropagation();_bkDelCustomRoom(${escHtml(JSON.stringify(r))})">✕</span>` : '';
    return `<div class="bk-opt-chip${sel?' bk-opt-chip-sel':''}${hi?' bk-room-chip-match':''}" onclick="_bkPickRoom(${escHtml(JSON.stringify(r))})">${escHtml(r)}${del}</div>`;
  }).join('');
  list.innerHTML = chips || '<span style="color:#a0aec0;font-size:.82rem;">（無空間）</span>';
}
function _bkPickRoom(room) { _bkSelectedRoom = room; _populateBookingRoomChips(room); _checkBkConflict(); }
function _bkAddCustomRoom() {
  const inp = document.getElementById('bk-room-chip-inp');
  const name = (inp?.value||'').trim(); if (!name) return;
  const rooms = _getBkCustomRooms();
  if (!rooms.includes(name) && !ROOMS.includes(name)) { rooms.push(name); _saveBkCustomRooms(rooms); }
  inp.value = ''; _bkPickRoom(name);
}
function _bkDelCustomRoom(room) {
  _saveBkCustomRooms(_getBkCustomRooms().filter(r => r !== room));
  if (_bkSelectedRoom === room) _bkSelectedRoom = '';
  _populateBookingRoomChips(_bkSelectedRoom); _checkBkConflict();
}

// ── 空間預約「輔導人員/借用事由」選擇器（可複選，[0]＝主責）──
let _bkSelectedOpts = [];   // [{value,label,isCustom}]
function _getBkFreqs()        { return { ..._userPref_('bkFreqs', {}) }; }
function _recordBkFreq(v) {
  if (!v) return;
  const f = _getBkFreqs(); f[v] = (f[v] || 0) + 1;
  syncUserPref_({ bkFreqs: f });
}
function _getBkCustomOpts()   { return [...(_userPref_('bkCustomOpts', []))]; }
function _saveBkCustomOpts(opts) { syncUserPref_({ bkCustomOpts: opts }); }

function _bkBuildAllOpts() {
  const freqs = _getBkFreqs();
  const counselors = getSortedCounselorEntries(([, u]) => BK_COUNSELING_ROLES.has(u.role || ''))
    .map(([email, u]) => ({ value: email, label: u.name || email, isCustom: false }));
  const fixed   = [{ value: '中心會議', label: '🏛 中心會議', isCustom: false }];
  const custom  = _getBkCustomOpts().map(lbl => ({ value: lbl, label: lbl, isCustom: true }));
  const all     = [...counselors, ...fixed, ...custom];
  all.sort((a, b) => (freqs[b.value] || 0) - (freqs[a.value] || 0));
  return all;
}

// 舊資料相容：只有純量 counselorEmail/counselorName 的 booking 視為單人陣列
function _bkNormalizeCounselors(b) {
  if (Array.isArray(b?.counselors) && b.counselors.length) return b.counselors;
  if (b?.counselorEmail || b?.counselorName) {
    return [{ value: b.counselorEmail || b.counselorName, label: b.counselorName || b.counselorEmail, isCustom: !b.counselorEmail }];
  }
  return [];
}
function _bkHasCounselor(b, value) { return !!value && _bkNormalizeCounselors(b).some(c => c.value === value); }

// 統一撞房／撞人衝突檢查（純函式）。與後端 Code.gs 的 _bkFindConflictGs_ 邏輯一致（各自實作、規則相同）。
// existing: 要比對的既有預約陣列；candidate: {id,date,room,customRoom,startTime,endTime,counselors}
// opts: { ignoreIds: Set|Array, skipPerson: bool }；回傳 null 或 { type:'room'|'person', with: booking }
// 註：簽名不用預設參數 `opts = {}`——test/harness.js 以 indexOf('{') 找函式本體，會被預設參數的大括號誤導。
function _bkFindConflict(existing, candidate, opts) {
  opts = opts || {};
  const ignoreIds = opts.ignoreIds instanceof Set ? opts.ignoreIds : new Set(opts.ignoreIds || []);
  const cStart = (candidate.startTime || '').slice(0, 5);
  const cEnd   = (candidate.endTime   || '').slice(0, 5);
  const cRoom  = candidate.room === '其他' ? (candidate.customRoom || '') : (candidate.room || '');
  const cCounselorValues = (candidate.counselors || [])
    .map(c => c && c.value).filter(v => v && v !== '中心會議');

  for (const b of existing) {
    if (!b || !b.id) continue;
    if (candidate.id && b.id === candidate.id) continue;
    if (ignoreIds.has(b.id)) continue;
    if (b.date !== candidate.date) continue;
    const bStart = (b.startTime || '').slice(0, 5);
    const bEnd   = (b.endTime   || '').slice(0, 5);
    if (!(cStart < bEnd && cEnd > bStart)) continue;

    const bRoom = b.room === '其他' ? (b.customRoom || '') : (b.room || '');
    if (cRoom && bRoom && cRoom === bRoom) return { type: 'room', with: b };

    if (!opts.skipPerson && cRoom !== bRoom) {
      const bCounselorValues = _bkNormalizeCounselors(b).map(c => c.value).filter(v => v && v !== '中心會議');
      if (cCounselorValues.some(v => bCounselorValues.includes(v))) return { type: 'person', with: b };
    }
  }
  return null;
}

// 拖曳前端本機衝突檢查（放開拖曳當下先算，不必等後端 bkCommit 來回才知道有沒有衝突）。
// proposals：擬議狀態陣列（{id,room,customRoom,date,startTime,endTime,counselors,...}，id 與原始筆相同）。
// excludeIds：這批要移動的原始 id 集合（Set 或陣列）——比對現況 bookingsData 時排除，避免拿同批其他筆尚未套用變更的舊狀態誤判。
// 回傳 [{id, type:'room'|'person', with}]（每筆最多回報一個衝突：先比對既有 bookingsData，再比對批內彼此是否互撞）。
function _bkLocalConflicts(proposals, excludeIds) {
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const results = [];
  (proposals || []).forEach(p => {
    let hit = _bkFindConflict(bookingsData, p, { ignoreIds: exclude });
    if (!hit) {
      const others = proposals.filter(o => o.id !== p.id);
      hit = _bkFindConflict(others, p, {});
    }
    if (hit) results.push({ id: p.id, type: hit.type, with: hit.with });
  });
  return results;
}

function _populateBookingCounselorSelect(restoreOpts) {
  if (restoreOpts !== undefined) _bkSelectedOpts = Array.isArray(restoreOpts) ? [...restoreOpts] : [];
  const opts = _bkBuildAllOpts();
  if (!_bkSelectedOpts.length && currentUser?.email && BK_COUNSELING_ROLES.has(configData?.users?.[currentUser.email]?.role)) {
    const me = opts.find(o => o.value === currentUser.email);
    if (me) _bkSelectedOpts = [{ value: me.value, label: me.label, isCustom: false }];
  }
  const chips = opts.map(o => {
    const selIdx = _bkSelectedOpts.findIndex(s => s.value === o.value);
    const sel = selIdx >= 0;
    const primaryTag = sel && selIdx === 0 ? ' <span style="font-size:.68rem;color:#1a5276;font-weight:700;">主責</span>' : '';
    const del = o.isCustom
      ? `<span class="bk-opt-chip-del" onclick="event.stopPropagation();_bkDelCustomOpt(${escHtml(JSON.stringify(o.value))})">✕</span>`
      : '';
    const role = configData?.users?.[o.value]?.role || '';
    return `<div class="bk-opt-chip${sel ? ' bk-opt-chip-sel' : ''}" onclick="_bkPickOpt(${escHtml(JSON.stringify(o.value))},${escHtml(JSON.stringify(o.label))},${o.isCustom ? 'true' : 'false'})">${roleColorDotHtml(role)}${escHtml(o.label)}${primaryTag}${del}</div>`;
  }).join('');
  const picker = document.getElementById('bk-counselor-picker');
  if (!picker) return;
  picker.innerHTML =
    `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${chips || '<span style="color:#a0aec0;font-size:.82rem;">（尚無選項）</span>'}</div>` +
    `<div style="display:flex;gap:6px;"><input type="text" id="bk-custom-inp" class="field-input" placeholder="新增自訂選項…" style="flex:1;font-size:.82rem;padding:5px 9px;" onkeydown="if(event.key==='Enter'){event.preventDefault();_bkAddCustomOpt();}"/><button type="button" onclick="_bkAddCustomOpt()" style="padding:5px 14px;background:#edf2f7;border:1px solid #cbd5e0;border-radius:6px;cursor:pointer;font-size:.82rem;white-space:nowrap;">新增</button></div>`;
}
function _bkPickOpt(value, label, isCustom) {
  if (value === '中心會議') {
    // 中心會議與複選人員互斥：此時段代表中心會議，不特定於某人
    _bkSelectedOpts = _bkSelectedOpts.some(o => o.value === '中心會議') ? [] : [{ value, label, isCustom: false }];
  } else {
    _bkSelectedOpts = _bkSelectedOpts.filter(o => o.value !== '中心會議');
    const idx = _bkSelectedOpts.findIndex(o => o.value === value);
    if (idx >= 0) _bkSelectedOpts.splice(idx, 1);
    else _bkSelectedOpts.push({ value, label, isCustom: !!isCustom });
  }
  _populateBookingCounselorSelect();
  _populateBookingCaseDatalist(); // #29：主責變更後重排 datalist（主責個案排最前）
  _checkBkConflict();
}
function _bkAddCustomOpt() {
  const inp = document.getElementById('bk-custom-inp');
  const lbl = (inp?.value || '').trim(); if (!lbl) return;
  const opts = _getBkCustomOpts(); if (!opts.includes(lbl)) { opts.push(lbl); _saveBkCustomOpts(opts); }
  _bkSelectedOpts = _bkSelectedOpts.filter(o => o.value !== '中心會議');
  if (!_bkSelectedOpts.some(o => o.value === lbl)) _bkSelectedOpts.push({ value: lbl, label: lbl, isCustom: true });
  inp.value = ''; _populateBookingCounselorSelect();
}
function _bkDelCustomOpt(value) {
  _saveBkCustomOpts(_getBkCustomOpts().filter(l => l !== value));
  _bkSelectedOpts = _bkSelectedOpts.filter(o => o.value !== value);
  _populateBookingCounselorSelect();
}

let _recNextBkRoom = '';
function _populateRecNextBkRoomChips(restoreRoom) {
  if (restoreRoom !== undefined) _recNextBkRoom = restoreRoom;
  const builtIn = ROOMS.filter(r => r !== '其他');
  const custom  = _getBkCustomRooms();
  const all     = [...builtIn, ...custom];
  const chips = all.map(r => {
    const sel = r === _recNextBkRoom;
    const isC = !builtIn.includes(r);
    const del = isC ? `<span class="bk-opt-chip-del" onclick="event.stopPropagation();_bkDelCustomRoom(${escHtml(JSON.stringify(r))});_populateRecNextBkRoomChips()">✕</span>` : '';
    return `<div class="bk-opt-chip${sel?' bk-opt-chip-sel':''}" onclick="_recNextPickRoom(${escHtml(JSON.stringify(r))})">${escHtml(r)}${del}</div>`;
  }).join('');
  const wrap = document.getElementById('rec-next-bk-room-wrap');
  if (!wrap) return;
  wrap.innerHTML =
    `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">${chips||'<span style="color:#a0aec0;font-size:.82rem;">（無空間）</span>'}</div>`+
    `<div style="display:flex;gap:6px;"><input type="text" id="rec-next-bk-inp" class="field-input" placeholder="新增自訂空間…" style="flex:1;font-size:.82rem;padding:5px 9px;" onkeydown="if(event.key==='Enter'){event.preventDefault();_recNextAddCustomRoom();}"/><button type="button" onclick="_recNextAddCustomRoom()" style="padding:5px 14px;background:#edf2f7;border:1px solid #cbd5e0;border-radius:6px;cursor:pointer;font-size:.82rem;white-space:nowrap;">新增</button></div>`;
}
function _recNextPickRoom(room) { _recNextBkRoom = room; _populateRecNextBkRoomChips(room); _checkRecNextBkRealtime(); }
function _recNextAddCustomRoom() {
  const inp = document.getElementById('rec-next-bk-inp');
  const name = (inp?.value||'').trim(); if (!name) return;
  const rooms = _getBkCustomRooms();
  if (!rooms.includes(name) && !ROOMS.includes(name)) { rooms.push(name); _saveBkCustomRooms(rooms); }
  inp.value = ''; _recNextPickRoom(name);
}

function _bkTimeBlur(inp) {
  const digits = inp.value.trim().replace(/\D/g, '');
  if (digits.length === 3) inp.value = '0' + digits[0] + ':' + digits.slice(1);
  else if (digits.length === 4) inp.value = digits.slice(0,2) + ':' + digits.slice(2);
  _checkBkConflict();
}

// 自訂時間輸入即時遮罩：輸入數字滿 2 位自動補「:」，退格可自然刪除（重算後長度變回 ≤2 位即不含冒號）；
// 送出值仍維持 HH:MM。供空間預約自填時間（bk-start/bk-end）與晤談紀錄「預約下次諮商空間」自填時間
// （rec-next-bk-start/rec-next-bk-end）共用，避免使用者要離開欄位（blur）才看得到冒號。
function _attachTimeMask(el) {
  if (!el || el._bkTimeMaskBound) return;
  el._bkTimeMaskBound = true;
  el.addEventListener('input', () => {
    const digits = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  });
}

function prFillPeriod() {
  const val = document.getElementById('pr-period')?.value || '';
  const p = BK_PERIODS.find(x => x.label === val);
  const timeRow = document.getElementById('pr-time-row');
  if (p) {
    document.getElementById('pr-start').value = p.start;
    document.getElementById('pr-end').value   = p.end;
    if (timeRow) timeRow.style.display = 'none';
  } else {
    if (timeRow) timeRow.style.display = 'flex';
  }
}

function onBkPeriodChange(sel) {
  const customDiv = document.getElementById('bk-custom-times');
  const val = sel.value;
  if (val === '其他') {
    customDiv.style.display = '';
    document.getElementById('bk-start').value = '';
    document.getElementById('bk-end').value = '';
  } else {
    customDiv.style.display = 'none';
    const p = BK_PERIODS.find(x => x.label === val);
    document.getElementById('bk-start').value = p ? p.start : '';
    document.getElementById('bk-end').value   = p ? p.end   : '';
  }
  _checkBkConflict();
}

function _checkBkConflict() {
  const room  = _bkSelectedRoom;
  const date  = document.getElementById('bk-date')?.value;
  const start = document.getElementById('bk-start')?.value;
  const end   = document.getElementById('bk-end')?.value;
  const roomWarnEl   = document.getElementById('bk-room-conflict-warn');
  const personWarnEl = document.getElementById('bk-person-conflict-warn');

  if (!room || !date || !start || !end || start >= end) {
    if (roomWarnEl)   roomWarnEl.style.display   = 'none';
    if (personWarnEl) personWarnEl.style.display = 'none';
    return;
  }

  // 空間衝突
  const roomConflict = bookingsData.find(b =>
    b.id !== _editingBookingId && b.room === room && b.date === date &&
    b.startTime < end && b.endTime > start
  );
  if (roomWarnEl) {
    if (roomConflict) {
      roomWarnEl.style.display = '';
      roomWarnEl.textContent = `時間衝突：${room} 在 ${(roomConflict.startTime||'').slice(0,5)}–${(roomConflict.endTime||'').slice(0,5)} 已由 ${roomConflict.counselorName || '—'} 預約。`;
    } else {
      roomWarnEl.style.display = 'none';
    }
  }

  // 同人員同時段不同空間（即時提醒，無操作按鈕；檢查所有被選中的人）
  if (personWarnEl) {
    const myOpts = _bkSelectedOpts.filter(o => o.value !== '中心會議');
    let personConflict = null, conflictOpt = null;
    outer: for (const b of bookingsData) {
      if (b.id === _editingBookingId || b.room === room || b.date !== date) continue;
      if (!(b.startTime < end && b.endTime > start)) continue;
      for (const o of myOpts) {
        if (_bkHasCounselor(b, o.value)) { personConflict = b; conflictOpt = o; break outer; }
      }
    }
    if (personConflict) {
      const pRoom = personConflict.room === '其他' ? (personConflict.customRoom || '其他') : personConflict.room;
      personWarnEl.style.display = '';
      personWarnEl.innerHTML =
        `<div style="background:#fffbeb;border:2px solid #f6ad55;border-radius:8px;padding:10px 14px;">` +
        `<div style="font-weight:600;color:#744210;margin-bottom:4px;">⚠ ${escHtml(conflictOpt?.label || conflictOpt?.value || '')} 已在此時段預約另一空間</div>` +
        `<div style="font-size:.875rem;color:#92400e;margin-bottom:8px;">目前已預約「${escHtml(pRoom)}」（${escHtml((personConflict.startTime||'').slice(0,5))}–${escHtml((personConflict.endTime||'').slice(0,5))}）</div>` +
        `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.875rem;color:#744210;">` +
        `<input type="checkbox" id="bk-person-conflict-ack" style="width:16px;height:16px;cursor:pointer;" onchange="_bkAckPersonConflict()">` +
        `確認仍要為此人預約「${escHtml(room)}」</label>` +
        `<div class="bk-conflict-hint" style="display:none;margin-top:6px;font-size:.82rem;color:#744210;">✔ 已確認，請繼續往下點「儲存」完成預約。</div>` +
        `</div>`;
    } else {
      personWarnEl.style.display = 'none';
      _bkSkipPersonConflict = false;
    }
  }
}

// T1：填寫記錄頁空間／人員衝突即時提醒
function _checkRecBkConflict() {
  const roomWarnEl   = document.getElementById('rec-bk-room-conflict-warn');
  const personWarnEl = document.getElementById('rec-bk-person-conflict-warn');
  if (roomWarnEl)   roomWarnEl.style.display = 'none';
  if (personWarnEl) personWarnEl.style.display = 'none';
  if (!_recFromBkRoom) return;

  const date    = document.getElementById('rec-date')?.value;
  const timeVal = document.getElementById('rec-time')?.value || '';
  let start, end;
  if (timeVal === '其他') {
    const other = document.getElementById('rec-time-other')?.value || '';
    const m = other.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (m) { start = m[1]; end = m[2]; }
  } else if (timeVal) {
    const m = timeVal.match(/(\d{2}:\d{2})[-–](\d{2}:\d{2})/);
    if (m) { start = m[1]; end = m[2]; }
  }
  if (!date || !start || !end || start >= end) return;

  const room = _recFromBkRoom;
  // 空間衝突
  if (roomWarnEl) {
    const rc = bookingsData.find(b =>
      b.id !== _recFromBkId && b.room === room && b.date === date &&
      b.startTime < end && b.endTime > start
    );
    if (rc) {
      const rcRoom = rc.room === '其他' ? (rc.customRoom || '其他') : rc.room;
      roomWarnEl.style.display = '';
      roomWarnEl.textContent = `⚠ 空間衝突：${rcRoom} 在 ${(rc.startTime||'').slice(0,5)}–${(rc.endTime||'').slice(0,5)} 已由 ${rc.counselorName || '—'} 預約。`;
    }
  }
  // 人員衝突
  if (personWarnEl && _recCounselors.length > 0) {
    const emails = new Set(_recCounselors.map(c => c.email));
    const pc = bookingsData.find(b =>
      b.id !== _recFromBkId && b.room !== room && b.date === date &&
      _bkNormalizeCounselors(b).some(c => emails.has(c.value)) && b.startTime < end && b.endTime > start
    );
    if (pc) {
      const pRoom = pc.room === '其他' ? (pc.customRoom || '其他') : pc.room;
      const matchedVal = _bkNormalizeCounselors(pc).find(c => emails.has(c.value))?.value;
      const conflictName = (_recCounselors.find(c => c.email === matchedVal)?.label) || pc.counselorName || '—';
      personWarnEl.style.display = '';
      personWarnEl.textContent = `⚠ 人員衝突：${conflictName} 已在此時段預約「${pRoom}」（${(pc.startTime||'').slice(0,5)}–${(pc.endTime||'').slice(0,5)}）。`;
    }
  }
}

function _restoreBkPeriod(startTime, endTime) {
  const s = (startTime || '').slice(0, 5);
  const e = (endTime   || '').slice(0, 5);
  const p = BK_PERIODS.find(x => x.start === s && x.end === e);
  const periodSel  = document.getElementById('bk-period');
  const customDiv  = document.getElementById('bk-custom-times');
  if (p) {
    periodSel.value = p.label;
    customDiv.style.display = 'none';
    document.getElementById('bk-start').value = p.start;
    document.getElementById('bk-end').value   = p.end;
  } else {
    periodSel.value = startTime ? '其他' : '';
    customDiv.style.display = startTime ? '' : 'none';
    document.getElementById('bk-start').value = startTime || '';
    document.getElementById('bk-end').value   = endTime   || '';
  }
}

async function _bkCalModalSync(bkId, calParams) {
  const modalId = 'bk-cal-sync-modal';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = modalId;
    modalEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modalEl);
  }
  modalEl.innerHTML = `<div style="background:#fff;border-radius:10px;padding:28px 32px;min-width:300px;max-width:400px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.2);">
    <div id="bk-cal-sync-status" style="font-size:1rem;color:#2d3748;margin-bottom:20px;">📅 正在同步至 Google 日曆…</div>
    <div id="bk-cal-sync-btn" style="display:none;"><button class="btn btn-primary" onclick="document.getElementById('${modalId}').remove();">完成</button></div>
  </div>`;
  modalEl.style.display = 'flex';
  try {
    const calendarEventId = await proxyCall('createCalendarEvent', calParams);
    if (calendarEventId) {
      const bkRef = bookingsData.find(x => x.id === bkId);
      if (bkRef) bkRef.calendarEventId = calendarEventId;
      await saveBookings().catch(() => {});
    }
    const statusEl = document.getElementById('bk-cal-sync-status');
    if (statusEl) statusEl.innerHTML = calendarEventId ? '✅ <strong>同步完成！</strong>' : '⚠ 同步完成但未取得事件 ID。';
    return calendarEventId;
  } catch(e) {
    const statusEl = document.getElementById('bk-cal-sync-status');
    if (statusEl) statusEl.textContent = `❌ 同步失敗：${e.message}`;
    return null;
  } finally {
    const btnEl = document.getElementById('bk-cal-sync-btn');
    if (btnEl) btnEl.style.display = '';
  }
}

async function syncBookingToCalendar(id) {
  const b = bookingsData.find(x => x.id === id);
  if (!b || b.calendarEventId) return;

  // Show progress modal
  const modalId = 'bk-cal-sync-modal';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = modalId;
    modalEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modalEl);
  }
  modalEl.innerHTML = `<div style="background:#fff;border-radius:10px;padding:28px 32px;min-width:280px;max-width:400px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.2);">
    <div id="bk-cal-sync-status" style="font-size:1rem;color:#2d3748;margin-bottom:20px;">📅 正在同步至 Google 日曆…</div>
    <div id="bk-cal-sync-btn" style="display:none;">
      <button class="btn btn-primary" onclick="document.getElementById('${modalId}').remove();renderBookingsPage();">完成</button>
    </div>
  </div>`;
  modalEl.style.display = 'flex';

  try {
    const calParams = { room: b.room, date: b.date, startTime: b.startTime, endTime: b.endTime,
      counselorName: b.counselorName, caseId: b.caseId || '', caseName: b.caseName || '', notes: b.notes || '',
      colorId: _bkGcColorId(b) };
    const calendarEventId = await proxyCall('createCalendarEvent', calParams);
    if (calendarEventId) {
      const idx = bookingsData.findIndex(x => x.id === id);
      if (idx >= 0) bookingsData[idx].calendarEventId = calendarEventId;
      // 先拿到 eventId 再補寫：bkCommit 只負責併發安全寫回 calendarEventId，GC 已在上一步建立完成（gc:'none'）
      const result = await bkCommit([{ op: 'upsert', booking: { ...(idx >= 0 ? bookingsData[idx] : b) }, gc: { mode: 'none' } }], { checkConflicts: false });
      if (result.fallback) {
        await saveBookings();
      } else if (!result.error) {
        const fb = (result.bookings || []).find(x => x.id === id);
        if (fb && idx >= 0) bookingsData[idx] = fb;
      }
      const statusEl = document.getElementById('bk-cal-sync-status');
      if (statusEl) statusEl.innerHTML = '✅ <strong>同步完成！</strong>';
    } else {
      const statusEl = document.getElementById('bk-cal-sync-status');
      if (statusEl) statusEl.textContent = '⚠ 同步完成但未取得事件 ID。';
    }
  } catch (e) {
    const statusEl = document.getElementById('bk-cal-sync-status');
    if (statusEl) statusEl.textContent = `❌ 同步失敗：${e.message}`;
  }
  const btnEl = document.getElementById('bk-cal-sync-btn');
  if (btnEl) btnEl.style.display = '';
}

function _populateBookingCaseDatalist() {
  const el = document.getElementById('bk-case-list');
  if (!el) return;
  // #29：datalist（瀏覽器原生建議）依插入順序顯示，主責個案要排最前只能在這裡排；
  // 主責人員變更時由 _bkPickOpt 重建，維持排序與目前選定主責一致
  const sel = _bkPrimaryCounselorEmail();
  const list = casesData.filter(c => !c.deleted && c.status === 'active');
  const sorted = sel
    ? list.slice().sort((a, b) =>
        (_getLatestCounselorEmail(a) === sel ? 0 : 1) - (_getLatestCounselorEmail(b) === sel ? 0 : 1))
    : list;
  el.innerHTML = sorted
      .map(c => {
        const label = [c.id, c.name, c.studentId].filter(Boolean).join(' ');
        return `<option value="${escHtml(c.id)}">${escHtml(label)}</option>`;
      }).join('');
}

// 目前於預約 Modal 選定的主責人員 email（_bkSelectedOpts[0] 為主責，見 _populateBookingCounselorSelect
// 的「主責」標示）；自訂選項／中心會議或尚無系統使用者對應時回傳空字串（不參與排序加權）。
function _bkPrimaryCounselorEmail() {
  const o = _bkSelectedOpts?.[0];
  if (!o || o.isCustom) return '';
  return configData?.users?.[o.value] ? o.value : '';
}

// 近 2 學期（本學期＋上一學期）的學期 prefix，供 #29 封存/結案個案的模糊搜尋門檻判定
function _recentSemPrefixes() {
  const cur = currentSemesterPrefix();
  const y = parseInt(cur.slice(0, -1), 10), t = cur.slice(-1);
  return [cur, t === '2' ? `${y}1` : `${y - 1}2`];
}

function onBkCaseIdInput() {
  const raw = document.getElementById('bk-case-id').value.trim();
  const hint = document.getElementById('bk-case-hint');
  if (!raw) { hint.style.display = 'none'; return; }

  // #29：搜尋資料源改用 cases-index 全量索引（涵蓋 hot/cold 分層後不在 casesData 的封存/結案個案），
  // 尚無索引時退回 casesData
  const src = (_casesIndexCache?.cases?.length ? _casesIndexCache.cases : casesData)
    .filter(c => c?.id && !c.deleted);

  // #7＋#29 定案（2026-07-08）：封存／已結案個案輸入「完整案號／完整全名／完整學號」一律可搜到
  // （視為使用者本就知道完整身分）；「模糊比對」（姓名部分字）只納入近 2 學期內仍有開案者——
  // 已 2 學期以上未開案的封存個案不因隨手打幾個字就曝光曾有諮商紀錄（個資保護，刻意設計）。
  const recentSems = _recentSemPrefixes();
  const _isActive = c => !c.archived && c.status === 'active';
  const _isRecent = c => (Array.isArray(c.semesters) ? c.semesters : []).some(s => recentSems.includes(s));

  let matches = src.filter(c => c.id === raw);
  if (!matches.length) matches = src.filter(c => c.studentId && c.studentId === raw);
  if (!matches.length) matches = src.filter(c => c.name && c.name === raw);
  if (!matches.length && raw.length >= 2) {
    matches = src.filter(c => (c.name || '').includes(raw) && (_isActive(c) || _isRecent(c)));
  }

  if (!matches.length) { hint.style.display = 'none'; return; }

  // #29 排序：主責 > 非主責；同層內 啟用 > 結案 > 封存（sort 為穩定排序，同分維持原相對順序）
  const _selCounselor = _bkPrimaryCounselorEmail();
  const _tier = c => c.archived ? 2 : (c.status === 'closed' ? 1 : 0);
  matches = matches.slice().sort((a, b) =>
    ((_selCounselor && _getLatestCounselorEmail(a) === _selCounselor) ? 0 : 1)
      - ((_selCounselor && _getLatestCounselorEmail(b) === _selCounselor) ? 0 : 1)
    || _tier(a) - _tier(b));

  // 封存／已結案狀態徽章（配色沿用事件處理記錄個案搜尋 _evrSearch 既有樣式，維持全站一致）
  const _statusBadge = m =>
    (m.status === 'closed' ? '<span style="font-size:.7rem;background:#f0f4f8;color:#718096;border-radius:4px;padding:1px 5px;margin-left:4px;">已結案</span>' : '') +
    (m.archived ? '<span style="font-size:.7rem;background:#fefcbf;color:#744210;border-radius:4px;padding:1px 5px;margin-left:4px;">已封存</span>' : '');

  hint.style.display = '';
  hint.style.color = '';
  if (matches.length === 1) {
    const m = matches[0];
    hint.innerHTML =
      `是否是 <b>${escHtml(m.name || m.id)}</b>（學號：${escHtml(m.studentId || '—')}，案號：${escHtml(m.id)}）？${_statusBadge(m)}` +
      `<button type="button" class="btn btn-sm btn-primary" style="margin-left:8px;padding:2px 10px;" onclick="confirmBkCase('${escHtml(m.id)}','${escHtml(m.name||'')}')">✓ 是</button>` +
      `<button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px;margin-left:4px;" onclick="document.getElementById('bk-case-hint').style.display='none'">✗ 否</button>`;
  } else {
    const rows = matches.slice(0, 5).map(m =>
      `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;">` +
      `<span style="font-size:.88rem;">${escHtml(m.name || m.id)}（${escHtml(m.id)}${m.studentId ? '，學號 ' + escHtml(m.studentId) : ''}）${_statusBadge(m)}</span>` +
      `<button type="button" class="btn btn-sm btn-primary" style="padding:2px 8px;" onclick="confirmBkCase('${escHtml(m.id)}','${escHtml(m.name||'')}')">選</button>` +
      `</div>`).join('');
    hint.innerHTML = `<div style="font-size:.82rem;color:#718096;margin-bottom:3px;">找到 ${matches.length} 筆符合個案：</div>${rows}`;
  }
}

function confirmBkCase(caseId, caseName) {
  document.getElementById('bk-case-id').value = caseId;
  const hint = document.getElementById('bk-case-hint');
  hint.style.display = '';
  hint.style.color = '#276749';
  hint.innerHTML = `✓ 已連結：<b>${escHtml(caseName)}</b>（${escHtml(caseId)}）`;
}

function _initBkPeriodSelect() {
  const sel = document.getElementById('bk-period');
  if (!sel) return;
  sel.innerHTML = '<option value="">— 請選擇節次 —</option>'
    + BK_PERIODS.map(p => `<option value="${escHtml(p.label)}">${escHtml(p.label)}</option>`).join('')
    + '<option value="其他">其他（自填時間）</option>';
}

// v100：編輯系列預約時，UI 帶入推導值後使用者是否改動了頻率／次數的比對基準；
// { freq: 7|14|21|'monthly'|null（null＝非固定頻率，未勾選）, count: N }（#24 擴充每三週／每月）。
// 由 _bkShowSeriesRepeatEditable 設定，_bkResetRepeatUi／非系列編輯路徑設回 null（代表本次編輯與系列重排無關）。
let _bkSeriesRepeatBaseline = null;

// 重複預約 UI 恢復為可互動預設值（新增／複製入口共用）：toggle 未勾選且可用、panel 隱藏、
// 頻率預設每週且可用、次數預設 4 且可用、移除系列附註（若有）。
function _bkResetRepeatUi() {
  const wrap = document.getElementById('bk-repeat-wrap');
  if (wrap) wrap.style.display = '';
  const toggle = document.getElementById('bk-repeat-toggle');
  if (toggle) { toggle.checked = false; toggle.disabled = false; }
  const panel = document.getElementById('bk-repeat-panel');
  if (panel) panel.style.display = 'none';
  document.querySelectorAll('input[name="bk-repeat-freq"]').forEach(r => {
    r.disabled = false;
    r.checked = r.value === '7';
  });
  const countInp = document.getElementById('bk-repeat-count');
  if (countInp) { countInp.disabled = false; countInp.value = '4'; countInp.max = '16'; }
  const note = document.getElementById('bk-repeat-readonly-note');
  if (note) note.remove();
  _bkSeriesRepeatBaseline = null;
}

// v100：編輯系列預約時，帶入系列建立當初的重複設定，並開放調整頻率／次數（先前為唯讀呈現，
// 使用者驗證後拍板改為可調整：改頻率＝此筆之後的預約依新頻率重排，改次數＝從系列尾端增刪）。
// 依系列成員日期反推頻率（見 _bkDetectSeriesFreq：固定天數 7/14/21，或「每月同一天」，含月底邊界；
// #24 擴充）→ 對應勾選；偵測不到（曾被個別調整）則不勾任何頻率。
// 推導基準值存 _bkSeriesRepeatBaseline，供 saveBooking 判斷使用者這次是否改動了頻率／次數。
function _bkShowSeriesRepeatEditable(b) {
  const seriesAll = bookingsData.filter(x => x.seriesId === b.seriesId).sort((x, y) => x.date < y.date ? -1 : (x.date > y.date ? 1 : 0));
  const n = seriesAll.length;
  const freq = _bkDetectSeriesFreq(seriesAll.map(x => x.date));
  const wrap = document.getElementById('bk-repeat-wrap');
  if (wrap) wrap.style.display = '';
  const toggle = document.getElementById('bk-repeat-toggle');
  if (toggle) { toggle.checked = true; toggle.disabled = true; } // 系列身分本身不可退出，僅頻率／次數可調
  const panel = document.getElementById('bk-repeat-panel');
  if (panel) panel.style.display = '';
  document.querySelectorAll('input[name="bk-repeat-freq"]').forEach(r => {
    r.disabled = false;
    r.checked = freq !== null && String(freq) === r.value;
  });
  const countInp = document.getElementById('bk-repeat-count');
  if (countInp) {
    countInp.disabled = false;
    countInp.min = '2';
    countInp.max = String(Math.max(16, n));
    countInp.value = String(n);
  }
  _bkSeriesRepeatBaseline = { freq, count: n };
  let note = document.getElementById('bk-repeat-readonly-note');
  if (!note && panel) {
    note = document.createElement('p');
    note.id = 'bk-repeat-readonly-note';
    note.style.cssText = 'font-size:.78rem;color:#8a6d3b;background:#fff8e6;border:1px solid #f0d490;border-radius:6px;padding:6px 10px;margin:8px 0 0;';
    panel.appendChild(note);
  }
  if (note) {
    const baseNote = `系列重複設定（共 ${n} 筆）。調整頻率會把此筆之後的預約依新頻率重排（會覆蓋先前個別調整的日期）；調整次數會從系列尾端新增或刪除。`;
    note.textContent = freq === null ? `此系列的日期曾個別調整，頻率非固定。${baseNote}` : baseNote;
  }
}

// prefill：由格子雙擊帶入（見 _bkCellDblClick）時提供 { room, date }，指定該空間／日期；
// v172：時段格線點空格新增（見 _bkOpenGridNew）另外提供 { startTime, endTime }，指定該節次時間，
// 沿用既有 _restoreBkPeriod 比對機制自動選對應節次選單（比對不到節次時退回自訂時間欄位）。
// 未提供時（如點頁面上方「＋新增預約」按鈕）日期一律預設為今天（本地時區），不沿用目前檢視中瀏覽到的日期。
function openBookingModal(prefillCaseId, prefill) {
  // 立即用記憶體資料開窗（不卡畫面）；最新預約改在背景重讀，回來後重跑衝突檢查（見函式結尾）。
  // 先前在此 await loadBookings() 才顯示視窗，後端讀取慢時會讓視窗遲遲不出現（誤以為沒反應）。
  _editingBookingId = null;
  _bkSkipPersonConflict = false;
  _bkSelectedOpts = [];
  _bkSeriesViewReturn = null; // v162：新增預約與系列檢視清單無關，防呆清除
  _bkUpdateSeriesViewBanner(false);
  document.getElementById('booking-modal-title').textContent = '新增預約';
  _bkSelectedRoom = '';
  _populateBookingRoomChips(prefill?.room || '');
  _populateBookingCounselorSelect();
  _populateBookingCaseDatalist();
  _initBkPeriodSelect();
  document.getElementById('bk-date').value = prefill?.date || new Date().toISOString().slice(0,10);
  if (prefill?.startTime) {
    _restoreBkPeriod(prefill.startTime, prefill.endTime);
  } else {
    document.getElementById('bk-period').value = '';
    document.getElementById('bk-custom-times').style.display = 'none';
    document.getElementById('bk-start').value = '';
    document.getElementById('bk-end').value = '';
  }
  document.getElementById('bk-notes').value = '';
  document.getElementById('bk-case-id').value = prefillCaseId || '';
  document.getElementById('bk-case-hint').style.display = 'none';
  document.getElementById('booking-conflict-warn').style.display = 'none';
  document.getElementById('bk-room-conflict-warn').style.display = 'none';
  document.getElementById('bk-person-conflict-warn').style.display = 'none';
  const sb = document.getElementById('btn-save-booking'); if (sb) sb.disabled = false;
  const dbBtn = document.getElementById('btn-delete-booking'); if (dbBtn) dbBtn.style.display = 'none'; // 新增時尚無此筆可刪
  _bkEditScope = 'this';
  // 新增時顯示「重複預約」區塊（可互動預設值）
  _bkResetRepeatUi();
  _resetBkOverrideUi('');
  document.getElementById('booking-modal').style.display = 'flex';
  _bkModalResizeSetup();
  _bkUpdateScopeInfo();
  _bkDraftTodoId = null; // v185：一般新增預約——重置（由「繼續編輯」草稿待辦重開時會在呼叫後另外設回）
  _gdSetBaseline('booking', _bkFormSnapshot());
  _startBkDraftAutosave();
  const _bkds0 = document.getElementById('_bk-draft-status'); if (_bkds0) _bkds0.textContent = '';
  // 背景重讀最新預約，回來後（若仍停在此新增視窗）重跑衝突檢查，兼顧即時性與撞期偵測。
  loadBookings().then(() => {
    const modalOpen = document.getElementById('booking-modal')?.style.display === 'flex';
    if (modalOpen && _editingBookingId === null) _checkBkConflict();
  }).catch(() => {});
}

function editBooking(id) {
  // 立即用記憶體資料開窗（不卡畫面）；最新資料改在背景重讀，回來後偵測「已被他人刪除」並重跑衝突檢查。
  // 先前在此 await loadBookings() 才開窗，後端讀取慢時雙擊卡片／按「編輯」都要等數秒視窗才出現。
  const b = bookingsData.find(x => x.id === id);
  if (!b) {
    alert('此預約已被其他使用者刪除，清單已更新。');
    renderBookingsPage();
    return;
  }
  _bkSkipPersonConflict = false;
  _editingBookingId = id;
  document.getElementById('booking-modal-title').textContent = '編輯預約';
  _populateBookingCounselorSelect(_bkNormalizeCounselors(b));
  _populateBookingCaseDatalist();
  _initBkPeriodSelect();
  let _editRoom = b.room || '';
  if (_editRoom === '其他') {
    _editRoom = b.customRoom || '其他';
    if (_editRoom && _editRoom !== '其他') {
      const _cr = _getBkCustomRooms();
      if (!_cr.includes(_editRoom) && !ROOMS.includes(_editRoom)) { _cr.push(_editRoom); _saveBkCustomRooms(_cr); }
    }
  }
  _populateBookingRoomChips(_editRoom);
  document.getElementById('bk-date').value = b.date || '';
  _restoreBkPeriod(b.startTime, b.endTime);
  document.getElementById('bk-case-id').value = b.caseId || '';
  document.getElementById('bk-case-hint').style.display = 'none';
  document.getElementById('bk-notes').value = b.notes || '';
  document.getElementById('booking-conflict-warn').style.display = 'none';
  document.getElementById('bk-room-conflict-warn').style.display = 'none';
  document.getElementById('bk-person-conflict-warn').style.display = 'none';
  const sb2 = document.getElementById('btn-save-booking'); if (sb2) sb2.disabled = false;
  const dbBtn2 = document.getElementById('btn-delete-booking'); if (dbBtn2) dbBtn2.style.display = ''; // 編輯既有預約才可刪除
  // 重複預約區塊：系列預約帶入當初設定並開放調整頻率／次數；
  // #34：非系列預約也開放「重複預約」（可互動預設值），讓使用者事後把單筆改為系列，免刪除重建。
  if (b.seriesId) {
    _bkShowSeriesRepeatEditable(b);
  } else {
    _bkResetRepeatUi();
  }
  _resetBkOverrideUi(b.bkOverrideColor || '');
  _bkEditScope = 'this';
  _bkDraftTodoId = null; // v185：一般編輯——重置（由「繼續編輯」草稿待辦重開時會在呼叫後另外設回）
  _gdSetBaseline('booking', _bkFormSnapshot());
  _startBkDraftAutosave();
  const _bkds1 = document.getElementById('_bk-draft-status'); if (_bkds1) _bkds1.textContent = '';
  // 若屬系列，先選範圍；v162：若是從「檢視此系列預約」清單點選進入（_bkSeriesViewReturn 記錄同一
  // 系列），代表使用者已明確選定這一筆，略過範圍選擇、直接進入編輯畫面（範圍鎖定為僅此筆）。
  const _fromSeriesView = !!(b.seriesId && _bkSeriesViewReturn && _bkSeriesViewReturn.seriesId === b.seriesId);
  if (b.seriesId && !_fromSeriesView) {
    document.getElementById('bk-series-scope-modal').style.display = 'flex';
  } else {
    document.getElementById('booking-modal').style.display = 'flex';
    _bkModalResizeSetup();
    _bkUpdateScopeInfo();
    _checkBkConflict();
  }
  _bkUpdateSeriesViewBanner(_fromSeriesView);
  // 背景重讀最新預約：若此筆已被他人刪除則提示並關窗，否則（仍停在此筆編輯）重跑衝突檢查。
  loadBookings().then(() => {
    if (_editingBookingId !== id) return; // 使用者已切到別筆或關窗
    if (!bookingsData.find(x => x.id === id)) {
      alert('此預約已被其他使用者刪除，清單已更新。');
      closeBookingModal();
      document.getElementById('bk-series-scope-modal').style.display = 'none';
      renderBookingsPage();
      return;
    }
    if (document.getElementById('booking-modal')?.style.display === 'flex') _checkBkConflict();
  }).catch(() => {});
}

let _copyingBkId = null;

// v249：空間預約系列日期／頻率換算純函式（_bkFmtDate／_bkAddDays／_bkAddMonths／_bkAddFreq／
// _bkDaysBetween／_bkTimeDeltaMin／_bkShiftTime／_bkDetectSeriesFreq／_bkFreqLabel／
// _bkSeriesTargets／_bkNextInSeries／_bkSeriesReplan）拆到 dev/utils.js（build 原樣複製）

// v101：系列重排「生效頻率推導＋重排試算」共用入口。儲存前預覽與 saveBooking 實際套用
// 都呼叫這一個函式取結果（同輸入同輸出），保證預覽顯示的內容＝實際套用的內容，不會算兩次不一致。
// 生效頻率：UI 勾選 > 開啟編輯時的基準頻率（_bkSeriesRepeatBaseline.freq）> 系列最後兩筆日期差 > 預設 7 天。
function _bkSeriesReplanCompute(originalSeries, editedId, editedNewDate, uiFreqSel, uiCountVal) {
  let effFreq = uiFreqSel;
  if (effFreq == null) effFreq = _bkSeriesRepeatBaseline?.freq ?? null;
  if (effFreq == null) {
    if (originalSeries.length >= 2) {
      const _a = originalSeries[originalSeries.length - 2], _c = originalSeries[originalSeries.length - 1];
      effFreq = _bkDaysBetween(_a.date, _c.date) || 7;
    } else effFreq = 7;
  }
  const replan = _bkSeriesReplan(
    originalSeries.map(b => ({ id: b.id, date: b.date })),
    editedId, editedNewDate, effFreq, uiCountVal);
  return { effFreq, replan };
}

// ── v101：系列預約儲存前確認預覽 modal（Promise resolve 寫法，比照 rec-next-bk-choice-modal）──
let _bkSeriesPreviewResolver = null;
function _bkSeriesPreviewResolve(ok) {
  document.getElementById('bk-series-preview-modal').style.display = 'none';
  const resolve = _bkSeriesPreviewResolver; _bkSeriesPreviewResolver = null;
  if (resolve) resolve(!!ok);
}
// 回傳 Promise<boolean>：true＝確認執行、false＝返回修改（呼叫端應保持預約 modal 開啟、不套用任何變更）。
function _bkSeriesPreviewConfirm(previewHtml, title) {
  document.getElementById('bk-series-preview-title').textContent = title || '系列預約確認';
  document.getElementById('bk-series-preview-content').innerHTML = previewHtml;
  document.getElementById('bk-series-preview-modal').style.display = 'flex';
  return new Promise(resolve => { _bkSeriesPreviewResolver = resolve; });
}

function _bkDateWithWeekday(dateStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr || '';
  const WD = ['日','一','二','三','四','五','六'];
  return `${dateStr}（週${WD[new Date(y, m - 1, d).getDay()]}）`;
}

// v101：編輯系列預約的「修正前 → 修正後」對照表 HTML。
// beforeArr：同系列全部筆依日期排序（原始狀態）；afterMap：Map<id, {date,startTime,endTime,room,customRoom}>
//（模擬套用後的狀態，不含將被刪除的筆）；creates：新增筆陣列（同形狀）；deleteIds：Set<id>；
// contentChangedIds：Set<id>（人員/案號/備註/顏色等非日期時間空間的內容有變的筆，列尾附註「內容更新」）。
function _bkBuildSeriesEditPreview(beforeArr, afterMap, creates, deleteIds, contentChangedIds) {
  const roomOf = (b) => b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
  const fmt = (b) => ({
    d: _bkDateWithWeekday(b.date),
    t: `${(b.startTime || '').slice(0, 5)}–${(b.endTime || '').slice(0, 5)}`,
    r: roomOf(b),
  });
  const seg = (val, changed) => changed
    ? `<span style="color:#1a202c;font-weight:700;">${escHtml(val)}</span>`
    : `<span style="color:#a0aec0;">${escHtml(val)}</span>`;
  const badge = (label, color, bg) =>
    `<span style="display:inline-block;min-width:36px;text-align:center;font-size:.72rem;border-radius:6px;padding:1px 6px;margin-right:8px;color:${color};background:${bg};flex-shrink:0;">${label}</span>`;
  const row = (inner) => `<div style="display:flex;align-items:baseline;padding:5px 0;border-bottom:1px solid #f0f4f8;line-height:1.5;"><div style="flex:1;min-width:0;">${inner}</div></div>`;
  const rows = [];
  beforeArr.forEach(b => {
    const bf = fmt(b);
    const bfStr = `${bf.d} ${bf.t} ${bf.r}`;
    if (deleteIds.has(b.id)) {
      rows.push(row(`${badge('刪除', '#742a2a', '#fed7d7')}<span style="text-decoration:line-through;color:#742a2a;">${escHtml(bfStr)}</span>`));
      return;
    }
    const a = afterMap.get(b.id);
    if (!a) return; // 防禦：afterMap 缺漏時不顯示（不應發生）
    const af = fmt(a);
    const dCh = af.d !== bf.d, tCh = af.t !== bf.t, rCh = af.r !== bf.r;
    const contentCh = contentChangedIds.has(b.id);
    if (!dCh && !tCh && !rCh && !contentCh) {
      rows.push(row(`${badge('不變', '#4a5568', '#edf2f7')}<span style="color:#a0aec0;">${escHtml(bfStr)}</span>`));
      return;
    }
    const note = contentCh ? `<span style="font-size:.75rem;color:#2b6cb0;margin-left:6px;">（內容更新）</span>` : '';
    rows.push(row(
      `${badge('修改', '#2a4365', '#bee3f8')}<span style="color:#718096;">${escHtml(bfStr)}</span>` +
      `<span style="color:#a0aec0;margin:0 6px;">→</span>${seg(af.d, dCh)} ${seg(af.t, tCh)} ${seg(af.r, rCh)}${note}`));
  });
  (creates || []).forEach(c => {
    const cf = fmt(c);
    rows.push(row(`${badge('新增', '#22543d', '#c6f6d5')}<span style="font-weight:700;color:#22543d;">${escHtml(`${cf.d} ${cf.t} ${cf.r}`)}</span>`));
  });
  return rows.join('');
}

function copyBooking(id) {
  _copyingBkId = id;
  const b = bookingsData.find(x => x.id === id);
  if (!b) return;
  const nextDate = _bkAddDays(b.date, 7);
  const btn = document.getElementById('bk-copy-next-week-btn');
  if (btn) btn.textContent = `📅 複製到下週同一時間（${nextDate}）`;
  const conflictEl = document.getElementById('bk-copy-conflict-msg');
  if (conflictEl) conflictEl.style.display = 'none';
  document.getElementById('bk-copy-options-modal').style.display = 'flex';
}

function _bkCopyOpenModal() {
  const b = bookingsData.find(x => x.id === _copyingBkId);
  document.getElementById('bk-copy-options-modal').style.display = 'none';
  if (!b) return;
  _bkSkipPersonConflict = false;
  _editingBookingId = null;
  _bkSeriesViewReturn = null; // v162：複製預約與系列檢視清單無關，防呆清除
  _bkUpdateSeriesViewBanner(false);
  document.getElementById('booking-modal-title').textContent = '複製預約';
  _populateBookingCounselorSelect(_bkNormalizeCounselors(b));
  _populateBookingCaseDatalist();
  _initBkPeriodSelect();
  let _copyRoom = b.room || '';
  if (_copyRoom === '其他') {
    _copyRoom = b.customRoom || '其他';
    if (_copyRoom && _copyRoom !== '其他') {
      const _cr = _getBkCustomRooms();
      if (!_cr.includes(_copyRoom) && !ROOMS.includes(_copyRoom)) { _cr.push(_copyRoom); _saveBkCustomRooms(_cr); }
    }
  }
  _populateBookingRoomChips(_copyRoom);
  document.getElementById('bk-date').value = b.date || '';
  _restoreBkPeriod(b.startTime, b.endTime);
  document.getElementById('bk-case-id').value = b.caseId || '';
  document.getElementById('bk-case-hint').style.display = 'none';
  document.getElementById('bk-notes').value = b.notes || '';
  document.getElementById('booking-conflict-warn').style.display = 'none';
  document.getElementById('bk-room-conflict-warn').style.display = 'none';
  document.getElementById('bk-person-conflict-warn').style.display = 'none';
  const sb = document.getElementById('btn-save-booking'); if (sb) sb.disabled = false;
  const dbBtn3 = document.getElementById('btn-delete-booking'); if (dbBtn3) dbBtn3.style.display = 'none'; // 複製為新增，尚無此筆可刪
  _bkResetRepeatUi();
  _resetBkOverrideUi(b.bkOverrideColor || '');
  _bkEditScope = 'this';
  document.getElementById('booking-modal').style.display = 'flex';
  _bkModalResizeSetup();
  _bkUpdateScopeInfo();
  _checkBkConflict();
  _bkDraftTodoId = null; // v185：複製預約——重置
  _gdSetBaseline('booking', _bkFormSnapshot());
  _startBkDraftAutosave();
  const _bkds2 = document.getElementById('_bk-draft-status'); if (_bkds2) _bkds2.textContent = '';
}

function _bkCopyToNextWeek() {
  const b = bookingsData.find(x => x.id === _copyingBkId);
  if (!b) return;
  const newDate = _bkAddDays(b.date, 7);
  const roomConflict = bookingsData.find(x =>
    x.id !== b.id && x.room === b.room && x.date === newDate &&
    x.startTime < b.endTime && x.endTime > b.startTime
  );
  if (roomConflict) {
    const el = document.getElementById('bk-copy-conflict-msg');
    if (el) {
      el.style.display = '';
      el.innerHTML = `<div style="background:#fff5f5;border:1px solid #fc8181;border-radius:6px;padding:8px 12px;font-size:.85rem;color:#742a2a;">
        ⛔ ${escHtml(b.room)} 在 ${escHtml(newDate)} ${(b.startTime||'').slice(0,5)}–${(b.endTime||'').slice(0,5)} 已有其他預約（${escHtml(roomConflict.counselorName||'—')}），無法複製到此時段。<br>
        <span style="font-size:.8rem;color:#744210;">請改用「✏️ 編輯後新增」以調整時間後新增。</span>
        <div style="margin-top:8px;">
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('bk-copy-options-modal').style.display='none'">關閉</button>
        </div></div>`;
    }
    return;
  }
  _bkCopyToNextWeekConfirm();
}

async function _bkCopyToNextWeekConfirm() {
  const b = bookingsData.find(x => x.id === _copyingBkId);
  if (!b) return;
  document.getElementById('bk-copy-options-modal').style.display = 'none';
  const newDate = _bkAddDays(b.date, 7);
  showLoading('複製中…');
  const newBk = { ...b, id: `bk_${Date.now()}`, bkSerial: _bkNextSerial(),
    date: newDate, calendarEventId: null, createdAt: new Date().toISOString(), createdBy: currentUser?.email };
  try {
    const result = await bkCommit([{ op: 'upsert', booking: newBk, gc: { mode: 'none' } }]);
    if (result.fallback) {
      bookingsData.push(newBk);
      await saveBookings();
    } else if (result.error === 'conflict') {
      const w = result.with || {};
      const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
      const kind = result.conflictType === 'person' ? '人員' : '空間';
      throw new Error(`與其他使用者同時操作發生${kind}衝突（${wRoom} ${w.date||''} ${(w.startTime||'').slice(0,5)}–${(w.endTime||'').slice(0,5)}${w.counselorName ? '　'+w.counselorName : ''}）`);
    } else {
      const fb = (result.bookings || []).find(x => x.id === newBk.id);
      bookingsData.push(fb || newBk);
    }
    auditLog(`空間預約 複製到下週`, null, null, `${b.room} ${newDate} ${(b.startTime||'').slice(0,5)}–${(b.endTime||'').slice(0,5)}`);
    renderBookingsPage();
    setAlert('bookings-alert', 'ok', `已複製到 ${newDate}。`);
  } catch (e) {
    alert('複製失敗：' + e.message);
  } finally {
    hideLoading();
  }
}

// ── v185：空間預約表單草稿備援與離開防護（含系列/多日）────────────────────
let _bkDraftTodoId = null; // 從草稿待辦「繼續編輯」重開時記錄對應 todoId
function _bkFormSnapshot() {
  const gv = id => document.getElementById(id)?.value ?? '';
  return {
    room: _bkSelectedRoom || '', date: gv('bk-date'), period: gv('bk-period'), start: gv('bk-start'), end: gv('bk-end'),
    counselors: (_bkSelectedOpts || []).map(o => o?.value || '').sort(),
    caseId: gv('bk-case-id'), notes: gv('bk-notes'),
    repeatToggle: !!document.getElementById('bk-repeat-toggle')?.checked,
    repeatFreq: document.querySelector('[name="bk-repeat-freq"]:checked')?.value || '',
    repeatCount: gv('bk-repeat-count'),
    colorOverride: _bkPickedColor || '',
  };
}
function _bkDraftKey() {
  return `scc_draft_booking_${currentUser?.email || ''}_${_editingBookingId || 'new'}`;
}
function _startBkDraftAutosave() {
  _gdStartAutosave('booking', _bkDraftKey(), _bkFormSnapshot, '_bk-draft-status');
}
function _stopBkDraftAutosave() { _gdStopAutosave('booking'); }

function _restoreBookingDraft(snap) {
  if (!snap) return;
  if (snap.room) { _bkSelectedRoom = snap.room; _populateBookingRoomChips(snap.room); }
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  sv('bk-date', snap.date);
  if (snap.period) {
    sv('bk-period', snap.period);
    const customDiv = document.getElementById('bk-custom-times');
    if (snap.period === '其他') { if (customDiv) customDiv.style.display = ''; sv('bk-start', snap.start); sv('bk-end', snap.end); }
    else { if (customDiv) customDiv.style.display = 'none'; }
  }
  sv('bk-case-id', snap.caseId); sv('bk-notes', snap.notes);
  const toggle = document.getElementById('bk-repeat-toggle');
  if (toggle) { toggle.checked = !!snap.repeatToggle; toggle.dispatchEvent(new Event('change')); }
  if (snap.repeatFreq) { const r = document.querySelector(`[name="bk-repeat-freq"][value="${snap.repeatFreq}"]`); if (r) r.checked = true; }
  sv('bk-repeat-count', snap.repeatCount);
  if (snap.colorOverride) _resetBkOverrideUi(snap.colorOverride);
  _checkBkConflict();
  _gdSetBaseline('booking', _bkFormSnapshot());
}

// 使用者主動關閉（X／取消）才走離開防護；儲存成功／刪除成功等內部呼叫仍直接呼叫 closeBookingModal()，不受影響。
function _bkExitModal() {
  const _exit = () => {
    _stopBkDraftAutosave();
    try { localStorage.removeItem(_bkDraftKey()); } catch(_) {}
    _bkDraftTodoId = null;
    closeBookingModal();
  };
  if (!_gdIsDirty('booking', _bkFormSnapshot())) { _exit(); return; }
  _showExitDialog('離開空間預約表單',
    () => saveBooking(),
    () => _draftBooking(),
    () => _exit()
  );
}

function _draftBooking() {
  const snap = _bkFormSnapshot();
  const existingTodo = _bkDraftTodoId ? todosData.find(t => t.id === _bkDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  const c = snap.caseId ? casesData.find(x => x.id === snap.caseId) : null;
  _putTodoItem({
    id: todoId, type: 'booking_draft', label: '空間預約草稿',
    caseId: snap.caseId || '', caseLabel: c ? `${c.name}（${snap.caseId}）` : (snap.room || '（未選空間）'),
    draftData: { editingBookingId: _editingBookingId, snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopBkDraftAutosave();
  try { localStorage.removeItem(_bkDraftKey()); } catch(_) {}
  _bkDraftTodoId = null;
  closeBookingModal();
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

function closeBookingModal() {
  // v185：無論是使用者取消／儲存成功／刪除成功，本次編輯階段都已結束——統一在此清掉草稿備援
  // （唯一進出口，比逐一在各成功分支插入更不易漏）；若是從草稿待辦繼續編輯，順便標記該待辦完成。
  _stopBkDraftAutosave();
  try { localStorage.removeItem(_bkDraftKey()); } catch(_) {}
  if (_bkDraftTodoId) {
    const _bkdt = todosData.find(t => t.id === _bkDraftTodoId);
    if (_bkdt) { _bkdt.done = true; _bkdt.doneAt = new Date().toISOString(); }
    _bkDraftTodoId = null;
    saveUserTodos().catch(() => {});
  }
  document.getElementById('booking-modal').style.display = 'none';
  // v162：若本次編輯是從「檢視此系列預約」清單進入，離開編輯畫面（無論儲存成功或取消／關閉）
  // 一律回到該系列的檢視清單。用 setTimeout(0) 讓呼叫端接下來對 bookingsData 的樂觀更新（若有，
  // 例如儲存成功後才更新該筆內容）先跑完，清單才會顯示最新結果。只有此入口會設定
  // _bkSeriesViewReturn；改走刪除或拖曳衝突修正等其他流程的呼叫點會自行先清除，避免視窗互疊。
  if (_bkSeriesViewReturn) {
    const seriesId = _bkSeriesViewReturn.seriesId;
    const highlightId = _editingBookingId;
    _bkSeriesViewReturn = null;
    _bkUpdateSeriesViewBanner(false);
    setTimeout(() => _bkReopenSeriesView(seriesId, highlightId), 0);
  }
}

// 需求（2026-07-08）：預約視窗寬度可拖曳調整（CSS resize:horizontal，見 booking-modal-box），
// 並記住使用者偏好（本裝置 localStorage）；上限＝瀏覽器寬度（max-width:calc(100vw - 32px)）。
// 首次開啟時套用記憶寬度；ResizeObserver 於使用者拖曳後 debounce 寫回。
let _bkModalResizeInited = false;
function _bkModalResizeSetup() {
  if (_bkModalResizeInited) return;
  const box = document.getElementById('booking-modal-box');
  if (!box || typeof ResizeObserver === 'undefined') return;
  _bkModalResizeInited = true;
  const saved = parseInt(localStorage.getItem('scc_bk_modal_w') || '', 10);
  if (saved >= 320) box.style.width = Math.min(saved, Math.max(320, window.innerWidth - 32)) + 'px';
  let t = null;
  new ResizeObserver(() => {
    if (document.getElementById('booking-modal')?.style.display !== 'flex') return;
    clearTimeout(t);
    t = setTimeout(() => {
      const w = Math.round(box.getBoundingClientRect().width);
      if (w >= 320) { try { localStorage.setItem('scc_bk_modal_w', String(w)); } catch {} }
    }, 400);
  }).observe(box);
}

// v103：編輯預約 Modal 內的「刪除」按鈕——先關閉編輯 Modal 再走既有 deleteBooking 流程
// （非系列直接 confirm；系列跳「僅此筆／此筆之後／全部系列」範圍選擇，皆沿用原本的確認文案與
// bkCommit 刪除＋GC 事件刪除＋auditLog，不重造輪子）。
function _bkDeleteFromModal() {
  const id = _editingBookingId;
  if (!id) return;
  // v162：刪除走獨立確認流程（可能另跳系列刪除範圍選擇視窗），不觸發返回系列檢視清單，
  // 避免與刪除確認視窗互疊。
  _bkSeriesViewReturn = null;
  closeBookingModal();
  deleteBooking(id);
}

let _bkSkipPersonConflict = false;
function _bkAckPersonConflict() {
  _bkSkipPersonConflict = true;
  const warn = document.getElementById('bk-person-conflict-warn');
  if (warn) {
    const hint = warn.querySelector('.bk-conflict-hint');
    if (hint) hint.style.display = '';
  }
}

// #5-1：預約建立成功通知——(a) 建立者本人在待辦頁「重大事件」收到「已預約成功」提示；
// (b) 若主責／人員含建立者以外的使用者，廣播「XXX 為你建立了一筆空間預約」給那些人。
// 走既有 MAJOR_EVENT_NOTIF_TYPES 機制（notifications.json，v154 起拆自 config.json），
// 「收到」＝點一下即從畫面消失（見 MAJOR_EVENT_DISMISS_ON_READ），只在此次使用者操作時寫檔一次，
// 不在每次 render 時重複寫入。
function _bkNotifyCreated(createdObjs, counselors) {
  if (!configData?.users || !currentUser?.email || !createdObjs?.length) return;
  const me = configData.users[currentUser.email];
  if (!me) return;
  const first = createdObjs[0];
  const roomD = first.room === '其他' ? (first.customRoom || '其他') : (first.room || '');
  const timeStr = `${first.date} ${(first.startTime||'').slice(0,5)}–${(first.endTime||'').slice(0,5)}`;
  const countSuffix = createdObjs.length > 1 ? `等共 ${createdObjs.length} 筆` : '';
  const brief = `${roomD}　${timeStr}${countSuffix}${first.counselorName ? '　主責：' + first.counselorName : ''}`;
  const nowIso = new Date().toISOString();

  _queueNotifPush(currentUser.email, {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    type: 'booking_created_self',
    message: `✅ 已預約成功：${brief}`,
    createdAt: nowIso, read: false,
  });

  const myName = me.name || currentUser.name || currentUser.given_name || (currentUser.email?.split('@')[0] ?? '') || '';
  const notified = new Set();
  (counselors || []).forEach(c => {
    if (!c?.email || c.email === currentUser.email || notified.has(c.email)) return;
    const u = configData.users[c.email];
    if (!u || u.disabled) return;
    notified.add(c.email);
    _queueNotifPush(c.email, {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      type: 'booking_created_broadcast',
      message: `${myName || '同仁'} 為你建立了一筆空間預約：${brief}`,
      createdAt: nowIso, read: false,
    });
  });

  renderNotifBell?.();
  if (document.getElementById('page-todos')?.classList.contains('active')) renderTodosPage();
  _flushNotifOps().catch(() => {});
}

async function saveBooking() {
  const saveBtn = document.getElementById('btn-save-booking');
  if (saveBtn?.disabled) return;
  if (saveBtn) saveBtn.disabled = true;

  const room       = _bkSelectedRoom;
  const customRoom = '';
  const date       = document.getElementById('bk-date').value;
  const start      = document.getElementById('bk-start').value;
  const end        = document.getElementById('bk-end').value;
  const _bkOptsToCounselor = (o) => {
    const isSys = !o.isCustom && !!configData?.users?.[o.value];
    return {
      value: o.value, isCustom: !!o.isCustom,
      email: (isSys || o.value === '中心會議') ? o.value : '',
      name:  isSys ? (configData.users[o.value].name || o.value) : (o.value || ''),
    };
  };
  const counselors = _bkSelectedOpts.map(_bkOptsToCounselor);
  const counselorEmail = counselors[0]?.email || '';
  const caseId = document.getElementById('bk-case-id').value.trim();
  const notes  = document.getElementById('bk-notes').value.trim();

  const _bkWarn = (msg) => {
    document.getElementById('booking-conflict-warn').style.display = '';
    document.getElementById('booking-conflict-warn').textContent = msg;
    if (saveBtn) saveBtn.disabled = false;
  };

  if (!room || !date) { _bkWarn('請填寫空間與日期。'); return; }
  if (!start || !end) { _bkWarn('請選擇節次或填寫自訂時間。'); return; }
  const _tRx = /^\d{2}:\d{2}$/;
  if (!_tRx.test(start) || !_tRx.test(end)) { _bkWarn('時間格式錯誤，請輸入 HH:MM（如 09:10）。'); return; }
  if (start >= end)   { _bkWarn('結束時間必須晚於開始時間。'); return; }

  // 空間衝突：顯示在空間卡片下方
  const roomConflict = bookingsData.find(b =>
    b.id !== _editingBookingId && b.room === room && b.date === date &&
    b.startTime < end && b.endTime > start
  );
  if (roomConflict) {
    const rcEl = document.getElementById('bk-room-conflict-warn');
    if (rcEl) { rcEl.style.display = ''; rcEl.textContent = `時間衝突：${room} 在 ${(roomConflict.startTime||'').slice(0,5)}–${(roomConflict.endTime||'').slice(0,5)} 已由 ${roomConflict.counselorName || '—'} 預約。`; }
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  // 同一人同時段借用不同空間：顯示在人員卡片下方，需確認才儲存（檢查所有被選中的人）
  {
    const myValues = _bkSelectedOpts.filter(o => o.value !== '中心會議').map(o => o.value);
    let personConflict = null;
    outer: for (const b of bookingsData) {
      if (b.id === _editingBookingId || b.room === room || b.date !== date) continue;
      if (!(b.startTime < end && b.endTime > start)) continue;
      for (const v of myValues) { if (_bkHasCounselor(b, v)) { personConflict = b; break outer; } }
    }
    if (personConflict && !_bkSkipPersonConflict) {
      // 警告已由 _checkBkConflict() 即時顯示（含確認勾選框）
      if (saveBtn) saveBtn.disabled = false;
      return;
    }
  }
  const skipPersonConflict = _bkSkipPersonConflict;
  _bkSkipPersonConflict = false;

  // counselorName：所有選中人員姓名以半形逗號串接，同時作為畫面顯示與 GC 標題來源
  const counselorName = counselors.map(c => c.name).join(',');
  // #7：連結的個案可能是封存／結案案號（cold，尚未載入到 casesData），caseName 改用索引 fallback，
  // 避免這類個案連結後 caseName 存成空字串
  const caseObj = caseId
    ? (casesData.find(c => c.id === caseId) || _casesIndexCache?.cases?.find(c => c.id === caseId))
    : null;
  const now = new Date().toISOString();
  const creatorName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || currentUser?.given_name || (currentUser?.email?.split('@')[0] ?? '') || '';

  // T2：重複預約設定（#24：頻率除固定天數 7/14/21 外，新增 'monthly' 每月同一天，見 _bkAddFreq）
  // #34：編輯一筆「非系列」預約時若勾選重複預約 → 就地把它轉為系列的第一筆並依頻率／次數新增其餘筆。
  const _bkEditingObj = _editingBookingId ? bookingsData.find(x => x.id === _editingBookingId) : null;
  const _repeatToggled = !!(document.getElementById('bk-repeat-toggle')?.checked);
  const _convertToSeries = !!_editingBookingId && !_bkEditingObj?.seriesId && _repeatToggled;
  const isRepeat = (!_editingBookingId || _convertToSeries) && _repeatToggled;
  const _repeatFreqVal = document.querySelector('input[name="bk-repeat-freq"]:checked')?.value || '7';
  const repeatFreq = isRepeat ? (_repeatFreqVal === 'monthly' ? 'monthly' : parseInt(_repeatFreqVal, 10)) : 0;
  const repeatCount = isRepeat ? Math.max(2, Math.min(16, parseInt(document.getElementById('bk-repeat-count')?.value || '4'))) : 1;
  const seriesId = isRepeat ? `series_${Date.now()}` : null;

  // 先取舊的 calendarEventId 與舊狀態快照（編輯時用，供稽核日誌差異比對與衝突回滾）
  const _oldBkSnap = _editingBookingId ? bookingsData.find(x => x.id === _editingBookingId) : null;
  const newSerial = _editingBookingId ? (_oldBkSnap?.bkSerial) : _bkNextSerial();
  const _bkOverride = _bkPickedColor || '';
  const calParams = { room, customRoom, date, startTime: start, endTime: end, counselorName, notes, creatorName,
    createdAt: _editingBookingId ? (_oldBkSnap?.createdAt || now) : now,
    updatedAt: now, isEdit: !!_editingBookingId,
    bkSerial: newSerial,
    colorId: _bkGcColorId({ bkOverrideColor: _bkOverride, counselorEmail }) };
  const existingCalEventId = _oldBkSnap?.calendarEventId;
  const newId = _editingBookingId || `bk_${Date.now()}`;

  // 動手前先快照，供後端回報衝突時回滾本機樂觀更新
  const _bkSnapshot = bookingsData.map(b => ({ ...b }));
  const ops = []; // bkCommit 的 upsert 清單
  const _pushOp = (bk, gcMode, gcParams) => {
    ops.push({ op: 'upsert', booking: { ...bk }, gc: { mode: gcMode, params: gcParams || null } });
  };

  // v100：系列編輯時讀取「重複預約」UI 目前的頻率／次數，與開啟編輯時的推導基準值比對，
  // 判斷使用者這次是否改動了頻率或次數——與 _bkEditScope（僅此筆／此筆及之後／全部系列）無關，
  // scope 只決定 room/時間/人員/案號/備註 這些欄位套用到哪些筆。
  const _editedBForReplan = _editingBookingId ? bookingsData.find(x => x.id === _editingBookingId) : null;
  let _uiFreqSel = null, _uiCountVal = null, _seriesReplanTriggered = false;
  if (_editedBForReplan?.seriesId) {
    const _freqChecked = document.querySelector('input[name="bk-repeat-freq"]:checked');
    _uiFreqSel = _freqChecked ? (_freqChecked.value === 'monthly' ? 'monthly' : parseInt(_freqChecked.value, 10)) : null;
    const _countInp = document.getElementById('bk-repeat-count');
    const _countMax = parseInt(_countInp?.max || '16', 10) || 16;
    _uiCountVal = Math.min(_countMax, Math.max(2, parseInt(_countInp?.value || '0', 10) || (_bkSeriesRepeatBaseline?.count || 2)));
    if (_bkSeriesRepeatBaseline) {
      _seriesReplanTriggered = (_uiFreqSel !== _bkSeriesRepeatBaseline.freq) || (_uiCountVal !== _bkSeriesRepeatBaseline.count);
    }
  }

  // v101：系列預約儲存前確認預覽 — 任何樂觀更新／衝突預檢之前，先讓使用者看到套用後的樣子。
  // 觸發：新增且勾重複預約（≥2 筆）；或編輯系列且影響多筆（scope 非僅此筆，或觸發 v100 重排）。
  // scope='this' 且未觸發重排＝純單筆修改，不跳預覽（與非系列編輯一致，避免煩人）。
  // 「返回修改」→ 只關預覽，預約 modal 保持開啟、欄位維持使用者剛填的值，不套用任何變更。
  // _srPlan：重排觸發時預覽階段先算好的結果（effFreq＋replan），下方 v100 重排分支直接沿用
  // 同一份，保證預覽顯示＝實際套用（不會算兩次不一致）。
  let _srPlan = null;
  if (isRepeat && repeatCount >= 2) {
    const _pvRows = [];
    for (let _pi = 0; _pi < repeatCount; _pi++) {
      const _pd = _pi === 0 ? date : _bkAddFreq(date, repeatFreq, _pi);
      _pvRows.push(`<div style="padding:5px 0;border-bottom:1px solid #f0f4f8;">${escHtml(_bkDateWithWeekday(_pd))} ${escHtml(start)}–${escHtml(end)} ${escHtml(room)}</div>`);
    }
    const _pvHtml = (counselorName ? `<div style="color:#4a5568;margin-bottom:8px;">主責：${escHtml(counselorName)}</div>` : '') + _pvRows.join('');
    const _pvOk = await _bkSeriesPreviewConfirm(_pvHtml, `即將建立系列預約（共 ${repeatCount} 筆）`);
    if (!_pvOk) { if (saveBtn) saveBtn.disabled = false; return; }
  } else if (_editedBForReplan?.seriesId && (_bkEditScope !== 'this' || _seriesReplanTriggered)) {
    const _pvSeries = bookingsData.filter(x => x.seriesId === _editedBForReplan.seriesId)
      .map(x => ({ ...x }))
      .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
    const _pvScopeIds = new Set(_bkSeriesTargets(bookingsData, _editedBForReplan, _bkEditScope).map(t => t.id));
    const _pvAfter = new Map();
    let _pvCreates = [], _pvDeleteIds = new Set();
    if (_seriesReplanTriggered) {
      _srPlan = _bkSeriesReplanCompute(_pvSeries, _editingBookingId, date, _uiFreqSel, _uiCountVal);
      _srPlan.originalSeries = _pvSeries;
      _srPlan.scopeTargetIds = _pvScopeIds;
      const _pvRedates = new Map(_srPlan.replan.redates.map(r => [r.id, r.date]));
      _pvDeleteIds = new Set(_srPlan.replan.deleteIds);
      _pvSeries.forEach(b => {
        if (_pvDeleteIds.has(b.id)) return;
        const _inScope = _pvScopeIds.has(b.id);
        _pvAfter.set(b.id, {
          date: b.id === _editingBookingId ? date : (_pvRedates.get(b.id) || b.date),
          startTime: _inScope ? start : b.startTime,
          endTime:   _inScope ? end   : b.endTime,
          room:       _inScope ? room       : b.room,
          customRoom: _inScope ? customRoom : b.customRoom,
        });
      });
      _pvCreates = _srPlan.replan.creates.map(cd => ({ date: cd, startTime: start, endTime: end, room, customRoom }));
    } else {
      // 未觸發重排：沿用既有平移語意（delta = 表單日期 − 被編輯筆原日期，套用到 scope 目標筆）
      const _pvDelta = _bkDaysBetween(_editedBForReplan.date, date);
      _pvSeries.forEach(b => {
        const _inScope = _pvScopeIds.has(b.id);
        _pvAfter.set(b.id, {
          date: (_inScope && _pvDelta) ? _bkAddDays(b.date, _pvDelta) : b.date,
          startTime: _inScope ? start : b.startTime,
          endTime:   _inScope ? end   : b.endTime,
          room:       _inScope ? room       : b.room,
          customRoom: _inScope ? customRoom : b.customRoom,
        });
      });
    }
    // 人員/案號/備註/顏色等內容變更（scope 目標筆才會被套用；日期時間空間另行比對強調）
    const _pvContentIds = new Set();
    _pvSeries.forEach(b => {
      if (!_pvScopeIds.has(b.id) || _pvDeleteIds.has(b.id)) return;
      if ((b.counselorName || '') !== (counselorName || '') ||
          (b.caseId || '') !== (caseId || '') ||
          (b.notes || '') !== (notes || '') ||
          ((b.bkOverrideColor || '') !== (_bkOverride || ''))) _pvContentIds.add(b.id);
    });
    const _pvHtml = _bkBuildSeriesEditPreview(_pvSeries, _pvAfter, _pvCreates, _pvDeleteIds, _pvContentIds);
    const _pvOk = await _bkSeriesPreviewConfirm(_pvHtml, '系列預約變更確認');
    if (!_pvOk) { if (saveBtn) saveBtn.disabled = false; return; }
  }

  // #5-1：本次若為新建（非編輯），收集新建立的筆供成功後推播「已預約成功」通知（見 _bkNotifyCreated）
  const _createdObjs = [];

  // 立即更新本機資料（樂觀更新）
  if (_editingBookingId) {
    const _editedB = bookingsData.find(x => x.id === _editingBookingId);
    if (_convertToSeries) {
      // #34：把原本非系列的單筆預約就地轉為系列 —— 第 0 筆＝更新既有這筆（沿用 id／GC 事件）掛上 seriesId，
      // 其餘 (repeatCount-1) 筆依頻率新增（比照新增系列的建立路徑；共用下方 bkCommit 收尾）。
      // v165：等同「新建系列」——全體成員（含就地轉換的第 0 筆）落地同一代原規劃快照
      // （seriesPlan.dates／planDate），供之後「檢視此系列預約」精確比對。
      const _convDatesAll = Array.from({ length: repeatCount }, (_, _i) => _i === 0 ? date : _bkAddFreq(date, repeatFreq, _i));
      const _convSeriesPlan = { dates: _convDatesAll, startTime: start, endTime: end, room, customRoom, stampedAt: now };
      const idx0 = bookingsData.findIndex(x => x.id === _editingBookingId);
      if (idx0 >= 0) {
        bookingsData[idx0] = { ...bookingsData[idx0],
          room, customRoom, date, startTime: start, endTime: end,
          counselors, counselorEmail, counselorName, caseId: caseId || '', caseName: caseObj?.name || '',
          notes, updatedAt: now, seriesId, planDate: date, seriesPlan: _convSeriesPlan };
        if (_bkOverride) bookingsData[idx0].bkOverrideColor = _bkOverride; else delete bookingsData[idx0].bkOverrideColor;
        _pushOp(bookingsData[idx0], existingCalEventId ? 'update' : 'create', calParams);
        _createdObjs.push(bookingsData[idx0]);
      }
      const _convSerialBase = _bkNextSerial();
      for (let _ci = 1; _ci < repeatCount; _ci++) {
        const _cDate = _convDatesAll[_ci];
        const _cObj = {
          id: `bk_${Date.now() + _ci}`, bkSerial: _convSerialBase + _ci - 1,
          room, customRoom, date: _cDate, startTime: start, endTime: end,
          counselors, counselorEmail, counselorName, caseId: caseId || '', caseName: caseObj?.name || '',
          notes, createdAt: now, updatedAt: now, creatorName, seriesId,
          planDate: _cDate, seriesPlan: _convSeriesPlan,
        };
        if (_bkOverride) _cObj.bkOverrideColor = _bkOverride;
        bookingsData.push(_cObj);
        _pushOp(_cObj, 'create', { ...calParams, date: _cDate, bkSerial: _cObj.bkSerial });
        _createdObjs.push(_cObj);
      }
    } else if (_editedB?.seriesId && _seriesReplanTriggered) {
      // v100：頻率或次數被改動 — 系列重排／增刪；自成一個流程，處理完直接 return（不落入下方共用的
      // bgJob／bkCommit 收尾，因為 ops 形狀與衝突處理路線都不同：可能需要改開拖曳衝突修正視窗）。
      // v101：originalSeries/scope/effFreq/replan 沿用預覽階段（_srPlan）算好的同一份結果，
      // 保證使用者在預覽視窗看到並確認的內容＝實際套用的內容；防禦性 fallback（不應發生）才重算。
      if (!_srPlan) {
        const _os = bookingsData.filter(x => x.seriesId === _editedB.seriesId)
          .map(x => ({ ...x }))
          .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
        _srPlan = _bkSeriesReplanCompute(_os, _editingBookingId, date, _uiFreqSel, _uiCountVal);
        _srPlan.originalSeries = _os;
        _srPlan.scopeTargetIds = new Set(_bkSeriesTargets(bookingsData, _editedB, _bkEditScope).map(t => t.id));
      }
      const originalSeries = _srPlan.originalSeries;
      const scopeTargetIds = _srPlan.scopeTargetIds;
      const effFreq = _srPlan.effFreq;
      const replan = _srPlan.replan;

      // 刪除前檢查：是否有晤談紀錄的「下次預約」掛接到將被刪除的筆
      if (replan.deleteIds.length) {
        const _delSet0 = new Set(replan.deleteIds);
        let _hooked = 0;
        casesData.forEach(c => (c.records || []).forEach(r => { if (r.nextBkId && _delSet0.has(r.nextBkId)) _hooked++; }));
        if (_hooked > 0 && !confirm(`有 ${_hooked} 筆晤談紀錄的「下次預約」掛接到將被刪除的預約，刪除後該顯示會消失。確定繼續？`)) {
          if (saveBtn) saveBtn.disabled = false;
          return;
        }
      }

      const deleteIdSet = new Set(replan.deleteIds);
      const redateMap = new Map(replan.redates.map(r => [r.id, r.date]));
      const editedFields = {
        room, customRoom, startTime: start, endTime: end,
        counselors, counselorEmail, counselorName,
        caseId: caseId || '', caseName: caseObj?.name || '', notes, updatedAt: now,
      };
      // 系列全部既有筆的擬議狀態：scope 選定的筆套欄位變更；日期只由「被編輯筆＝modal 新日期」與
      // replan.redates（重排的後段筆）決定，前段筆維持原日期不動（獨立於 scope）。
      const seriesProposalsAll = originalSeries.map(b => {
        const p = { ...b };
        if (scopeTargetIds.has(b.id)) {
          Object.assign(p, editedFields);
          if (_bkOverride) p.bkOverrideColor = _bkOverride; else delete p.bkOverrideColor;
        }
        if (b.id === _editingBookingId) p.date = date;
        else if (redateMap.has(b.id)) p.date = redateMap.get(b.id);
        return p;
      });
      // 新增筆：欄位取被編輯筆在 modal 上的最新值；seriesId 沿用；bkSerial 用 _bkNextSerial() 起始遞增
      const _newSerialBase = _bkNextSerial();
      const createdProposals = replan.creates.map((cDate, ci) => {
        const obj = {
          id: `bk_${Date.now()}_${ci}`, bkSerial: _newSerialBase + ci,
          room, customRoom, date: cDate, startTime: start, endTime: end,
          counselors, counselorEmail, counselorName,
          caseId: caseId || '', caseName: caseObj?.name || '',
          notes, createdAt: now, updatedAt: now, creatorName,
          seriesId: _editedB.seriesId,
        };
        if (_bkOverride) obj.bkOverrideColor = _bkOverride;
        return obj;
      });

      const survivors = seriesProposalsAll.filter(p => !deleteIdSet.has(p.id));
      // v165：整系列重排（頻率／次數變動）——存活筆＋新增筆落地「同一代」原規劃快照，
      // dates 取重排後的最終日期集合；即使衝突改走拖曳修正視窗，proposals 也已帶快照隨之流轉。
      const _srStampedAt = now;
      const _srSeriesPlan = { dates: [...survivors.map(p => p.date), ...createdProposals.map(p => p.date)].sort(),
        startTime: start, endTime: end, room, customRoom, stampedAt: _srStampedAt };
      survivors.forEach(p => { p.planDate = p.date; p.seriesPlan = _srSeriesPlan; });
      createdProposals.forEach(p => { p.planDate = p.date; p.seriesPlan = _srSeriesPlan; });
      // 衝突預檢排除預定刪除的筆（比照 _bkDragFixRecompute 的 live 過濾），避免對即將消失的筆誤報衝突
      const liveProposals = [...survivors, ...createdProposals];
      const excludeIds = new Set(originalSeries.map(b => b.id));
      const localConflicts = _bkLocalConflicts(liveProposals, excludeIds);

      if (localConflicts.length) {
        // 有衝突：不套用任何變更，關閉預約 modal，改開拖曳衝突修正視窗逐筆調整
        // （含將被刪除的筆，預先加入 deletedIds；_bkDragFixApply 迭代 proposals 時會自然歸入 delete ops）
        // v162：改走拖曳衝突修正流程，不觸發返回系列檢視清單，避免與該視窗互疊。
        _bkSeriesViewReturn = null;
        closeBookingModal();
        if (saveBtn) saveBtn.disabled = false;
        _bkOpenDragFixModal(originalSeries, [...seriesProposalsAll, ...createdProposals],
          '空間預約系列重排衝突修正', replan.deleteIds);
        return;
      }

      // 無衝突：關閉 modal、樂觀更新、背景 bkCommit（比照既有系列編輯/拖曳衝突修正的收尾模式）
      closeBookingModal();
      const _bkSnapshotSR = bookingsData.map(b => ({ ...b }));
      replan.deleteIds.forEach(id => {
        const idx = bookingsData.findIndex(x => x.id === id);
        if (idx >= 0) bookingsData.splice(idx, 1);
      });
      survivors.forEach(p => {
        const idx = bookingsData.findIndex(x => x.id === p.id);
        if (idx >= 0) bookingsData[idx] = p;
      });
      createdProposals.forEach(p => bookingsData.push(p));
      renderBookingsPage();
      _maybePromptQuickOpenCase(caseId, date); // #17：連結個案該學期尚未開案時詢問是否快速開案
      _qocMaybeShowIncompleteReminder(); // v181：儲存成功後，若本次工作階段有透過快速開案建立且尚未補齊資料的個案，提醒使用者

      const _srOldTotal = originalSeries.length;
      const _srNewTotal = survivors.length + createdProposals.length;
      const srJobId = bgJobAdd('編輯空間預約（系列重排）', `共 ${_srOldTotal}→${_srNewTotal} 筆`);
      const srOps = [
        ...survivors.map(p => ({
          op: 'upsert', booking: { ...p },
          gc: { mode: p.calendarEventId ? 'update' : 'create', params: _bkGcParamsOf(p, !!p.calendarEventId) },
        })),
        ...createdProposals.map(p => ({
          op: 'upsert', booking: { ...p },
          gc: { mode: 'create', params: _bkGcParamsOf(p, false) },
        })),
        ...replan.deleteIds.map(id => {
          const orig = originalSeries.find(b => b.id === id);
          return { op: 'delete', id, gcEventId: orig?.calendarEventId || null };
        }),
      ];
      (async () => {
        try {
          const result = await bkCommit(srOps, { checkConflicts: true });

          if (result.error === 'conflict') {
            bookingsData = _bkSnapshotSR;
            renderBookingsPage();
            const w = result.with || {};
            const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
            const kind = result.conflictType === 'person' ? '人員' : '空間';
            setAlert('bookings-alert', 'warn',
              `⚠ 儲存失敗：與其他使用者同時操作發生${kind}衝突（${escHtml(wRoom)} ${escHtml(w.date||'')} ${escHtml((w.startTime||'').slice(0,5))}–${escHtml((w.endTime||'').slice(0,5))}${w.counselorName ? '　'+escHtml(w.counselorName) : ''}），系列重排已還原，請重新確認後再操作一次。`);
            bgJobFail(srJobId, `與其他使用者${kind}衝突`);
            return;
          }

          if (result.fallback) {
            // 舊後端尚未部署：逐 op 自行呼叫 GC action（含新增筆 create、既有筆 update、刪除筆 delete）
            for (const o of srOps) {
              try {
                if (o.op === 'delete') {
                  if (o.gcEventId) await proxyCall('deleteCalendarEvent', { eventId: o.gcEventId });
                } else if (o.gc.mode === 'update' && o.booking.calendarEventId) {
                  await proxyCall('updateCalendarEvent', { eventId: o.booking.calendarEventId, ...o.gc.params });
                } else if (o.gc.mode === 'create') {
                  const eid = await proxyCall('createCalendarEvent', o.gc.params);
                  if (eid) { const bk = bookingsData.find(x => x.id === o.booking.id); if (bk) bk.calendarEventId = eid; }
                }
              } catch (_) {}
            }
            await saveBookings();
          } else {
            (result.bookings || []).forEach(fb => {
              const idx = bookingsData.findIndex(x => x.id === fb.id);
              if (idx >= 0) bookingsData[idx] = fb;
            });
          }

          auditLog(`空間預約系列重排（頻率 ${_bkFreqLabel(effFreq)}，共 ${_srOldTotal}→${_srNewTotal} 筆，新增 ${createdProposals.length} 筆，刪除 ${replan.deleteIds.length} 筆）`,
            _editedB.caseId || null);
          bgJobDone(srJobId);
          renderBookingsPage();
        } catch (e) {
          bookingsData = _bkSnapshotSR;
          renderBookingsPage();
          setAlert('bookings-alert', 'warn', '儲存失敗：' + e.message);
          bgJobFail(srJobId, e.message);
        }
      })();
      return;
    } else if (_editedB?.seriesId && _bkEditScope !== 'this') {
      // T3：系列編輯 — 套用到選定範圍；日期依「被編輯這筆」的日期差平移到範圍內其餘筆，
      // 被編輯這筆本身會恰好拿到 modal 填的日期（delta = date - _editedB.date，套用回自己等於 date）。
      // GC 逐筆同步：已有事件者 update、尚無事件者 create（順便回填歷史系列缺漏的 GC 事件）
      const _dateDelta = _bkDaysBetween(_editedB.date, date);
      const _rangeTargets = _bkSeriesTargets(bookingsData, _editedB, _bkEditScope);
      // v165：範圍內成員（'future' 為此筆之後子集／'all' 為全系列）套用平移後的最終日期，
      // 重打成「同一代」原規劃快照；範圍外的舊成員（僅 'future' 情形才會有）維持原本的快照不動——
      // 兩代快照並存＝混代，_bkSeriesDiffAnalyze 會據此自動退回刪除推算，欄位比對則仍逐筆精確。
      const _rangeSeriesPlan = { dates: _rangeTargets.map(sb => _dateDelta ? _bkAddDays(sb.date, _dateDelta) : sb.date).sort(),
        startTime: start, endTime: end, room, customRoom, stampedAt: now };
      _rangeTargets.forEach(sb => {
        sb.room = room; sb.customRoom = customRoom;
        sb.startTime = start; sb.endTime = end;
        sb.counselors = counselors; sb.counselorEmail = counselorEmail; sb.counselorName = counselorName;
        sb.caseId = caseId || ''; sb.caseName = caseObj?.name || '';
        sb.notes = notes; sb.updatedAt = now;
        if (_dateDelta) sb.date = _bkAddDays(sb.date, _dateDelta);
        if (_bkOverride) sb.bkOverrideColor = _bkOverride; else delete sb.bkOverrideColor;
        sb.planDate = sb.date; sb.seriesPlan = _rangeSeriesPlan;
        _pushOp(sb, sb.calendarEventId ? 'update' : 'create', _bkGcParamsOf(sb, !!sb.calendarEventId));
      });
    } else {
      const idx = bookingsData.findIndex(x => x.id === _editingBookingId);
      if (idx >= 0) {
        bookingsData[idx] = { ...bookingsData[idx],
          room, customRoom, date, startTime: start, endTime: end,
          counselors, counselorEmail, counselorName, caseId: caseId || '', caseName: caseObj?.name || '',
          notes, updatedAt: now };
        if (_bkOverride) bookingsData[idx].bkOverrideColor = _bkOverride; else delete bookingsData[idx].bkOverrideColor;
        _pushOp(bookingsData[idx], existingCalEventId ? 'update' : 'create', calParams);
      }
    }
  } else {
    // T2：單筆或系列建立 — 系列每一筆都建立 GC 事件（帶各自日期與流水號）
    // v165：新建系列時全體成員落地同一代原規劃快照（seriesPlan.dates／各自的 planDate），
    // 供之後「檢視此系列預約」精確比對／刪除偵測；單筆（無 seriesId）不落地，維持原行為。
    const _seriesDatesAll = seriesId
      ? Array.from({ length: repeatCount }, (_, _i) => _i === 0 ? date : _bkAddFreq(date, repeatFreq, _i))
      : null;
    const _newSeriesPlan = seriesId
      ? { dates: _seriesDatesAll, startTime: start, endTime: end, room, customRoom, stampedAt: now }
      : null;
    for (let _si = 0; _si < repeatCount; _si++) {
      const _sDate = _seriesDatesAll ? _seriesDatesAll[_si] : date;
      const _sObj = {
        id: _si === 0 ? newId : `bk_${Date.now() + _si}`,
        bkSerial: newSerial + _si, room, customRoom,
        date: _sDate, startTime: start, endTime: end,
        counselors, counselorEmail, counselorName, caseId: caseId || '', caseName: caseObj?.name || '',
        notes, createdAt: now, updatedAt: now, creatorName
      };
      if (seriesId) { _sObj.seriesId = seriesId; _sObj.planDate = _sDate; _sObj.seriesPlan = _newSeriesPlan; }
      if (_bkOverride) _sObj.bkOverrideColor = _bkOverride;
      bookingsData.push(_sObj);
      _pushOp(_sObj, 'create', { ...calParams, date: _sDate, bkSerial: _sObj.bkSerial });
      _createdObjs.push(_sObj);
    }
  }

  // 立即關閉 Modal 並顯示結果（樂觀更新）
  closeBookingModal();
  _recordBkFreq(_bkSelectedOpts[0]?.value);
  renderBookingsPage();
  _maybePromptQuickOpenCase(caseId, date); // #17：連結個案該學期尚未開案時詢問是否快速開案
  _qocMaybeShowIncompleteReminder(); // v181：儲存成功後，若本次工作階段有透過快速開案建立且尚未補齊資料的個案，提醒使用者

  // 背景：bookingsCommit（併發安全寫入＋衝突檢查）+ GC 同步（不阻擋 UI）
  const _bkJobLabel = _editingBookingId ? '編輯空間預約' : '新增空間預約';
  const _bkJobDetail = `${room} ${date} ${(start||'').slice(0,5)}–${(end||'').slice(0,5)}`;
  const jobId = bgJobAdd(_bkJobLabel, _bkJobDetail);
  (async () => {
    try {
      const result = await bkCommit(ops, { skipPersonConflict });

      if (result.error === 'conflict') {
        // 與其他使用者同時操作衝突：整批不寫入，回滾本機樂觀更新並重新載入
        bookingsData = _bkSnapshot;
        await refreshBookings();
        // #14：新增系列（重複預約）撞期 → 開拖曳衝突修正視窗逐筆調整（同款 UI，見 _bkOpenDragFixModal，
        // v99 起支援節次下拉選時間），把系列每一筆列成分頁讓使用者逐筆調整，全部無衝突才「套用並儲存」
        // 重新送出；取消則整批放棄（本機已於上方回滾，維持現狀不寫入）。單筆新增／編輯維持原行為
        // （訊息警示，使用者自行重新調整表單再送出）。
        if (!_editingBookingId && _createdObjs.length >= 2) {
          bgJobFail(jobId, '新增系列撞期，已開啟逐筆修正視窗');
          _bkOpenDragFixModal(_createdObjs, _createdObjs, '新增系列預約衝突修正', []);
          return;
        }
        const w = result.with || {};
        const wRoom = w.room === '其他' ? (w.customRoom || '其他') : (w.room || '');
        const kind = result.conflictType === 'person' ? '人員' : '空間';
        setAlert('bookings-alert', 'warn',
          `⚠ 儲存失敗：與其他使用者同時操作發生${kind}衝突（${escHtml(wRoom)} ${escHtml(w.date||'')} ${escHtml((w.startTime||'').slice(0,5))}–${escHtml((w.endTime||'').slice(0,5))}${w.counselorName ? '　'+escHtml(w.counselorName) : ''}），請重新確認後再操作一次。`);
        bgJobFail(jobId, `與其他使用者${kind}衝突`);
        return;
      }

      if (result.fallback) {
        // 舊後端尚未部署：沿用原路徑（本機已樂觀更新，整檔覆寫＋前端自行呼叫 GC action）
        for (const o of ops) {
          if (o.gc.mode === 'none') continue;
          try {
            if (o.gc.mode === 'update' && o.booking.calendarEventId) {
              await proxyCall('updateCalendarEvent', { eventId: o.booking.calendarEventId, ...o.gc.params });
            } else if (o.gc.mode === 'create') {
              const eid = await proxyCall('createCalendarEvent', o.gc.params);
              if (eid) { const bk = bookingsData.find(x => x.id === o.booking.id); if (bk) bk.calendarEventId = eid; }
            }
          } catch (_) {}
        }
        await saveBookings();
      } else {
        // 成功：套用後端回傳的最終狀態（含新 calendarEventId）
        (result.bookings || []).forEach(fb => {
          const idx = bookingsData.findIndex(x => x.id === fb.id);
          if (idx >= 0) bookingsData[idx] = fb;
        });
      }

      bgJobProgress(jobId, 90);
      let _bkDetail;
      if (_editingBookingId && _oldBkSnap) {
        const diffs = [];
        const oldRoomD = _oldBkSnap.room === '其他' ? (_oldBkSnap.customRoom || '其他') : (_oldBkSnap.room || '');
        const newRoomD = room;
        if (oldRoomD !== newRoomD) diffs.push(`${oldRoomD}→${newRoomD}`);
        const oldTimeStr = `${_oldBkSnap.date} ${(_oldBkSnap.startTime||'').slice(0,5)}–${(_oldBkSnap.endTime||'').slice(0,5)}`;
        const newTimeStr = `${date} ${(start||'').slice(0,5)}–${(end||'').slice(0,5)}`;
        if (oldTimeStr !== newTimeStr) diffs.push(`${oldTimeStr}→${newTimeStr}`);
        if ((_oldBkSnap.counselorName||'') !== (counselorName||'')) diffs.push(`${_oldBkSnap.counselorName||'—'}→${counselorName||'—'}`);
        if ((_oldBkSnap.caseId||'') !== (caseId||'')) diffs.push(`案號 ${_oldBkSnap.caseId||'無'}→${caseId||'無'}`);
        const _bkId = `${oldRoomD}　${oldTimeStr}${_oldBkSnap.counselorName ? '　'+_oldBkSnap.counselorName : ''}`;
        _bkDetail = diffs.length ? `${_bkId}　${diffs.join('；')}` : _bkId;
      } else {
        _bkDetail = `${room}　${date}　${(start||'').slice(0,5)}–${(end||'').slice(0,5)}${counselorName ? '　' + counselorName : ''}`;
      }
      auditLog(_editingBookingId ? '編輯空間預約' : '新增空間預約', caseId || null, null, _bkDetail);
      if (!_editingBookingId) _bkNotifyCreated(_createdObjs, counselors);
      bgJobDone(jobId);
      renderBookingsPage();
    } catch (e) {
      setAlert('bookings-alert', 'warn', '儲存失敗：' + e.message);
      bgJobFail(jobId, e.message);
    }
  })();
}

let _bkDeletingId = null;

async function deleteBooking(id) {
  const b = bookingsData.find(x => x.id === id);
  if (!b) return;
  if (b.seriesId) {
    _bkDeletingId = id;
    const _dRoomD = b.room === '其他' ? (b.customRoom||'其他') : b.room;
    const infoEl = document.getElementById('bk-series-delete-info');
    if (infoEl) infoEl.textContent = `${_dRoomD} ${b.date} ${(b.startTime||'').slice(0,5)}–${(b.endTime||'').slice(0,5)}`;
    document.getElementById('bk-series-delete-modal').style.display = 'flex';
    return;
  }
  const _delRoomD = b.room === '其他' ? (b.customRoom || '其他') : b.room;
  if (!confirm(`確定刪除 ${_delRoomD} ${b.date} ${(b.startTime||'').slice(0,5)}–${(b.endTime||'').slice(0,5)} 的預約？`)) return;
  await _doDeleteBookings([id], b);
}

async function _bkConfirmDeleteSeries(scope) {
  document.getElementById('bk-series-delete-modal').style.display = 'none';
  const id = _bkDeletingId; _bkDeletingId = null;
  if (!id) return;
  const b = bookingsData.find(x => x.id === id);
  if (!b) return;
  const idsToDelete = bookingsData
    .filter(x => x.seriesId === b.seriesId && (scope === 'all' || (scope === 'future' ? x.date >= b.date : x.id === id)))
    .map(x => x.id);
  if (!confirm(`確定刪除 ${idsToDelete.length} 筆預約？`)) return;
  await _doDeleteBookings(idsToDelete, b);
}

function _doDeleteBookings(idsToDelete, primaryB) {
  const toDelete = idsToDelete.map(id => bookingsData.find(x => x.id === id)).filter(Boolean);
  const ops = toDelete.map(b => ({ op: 'delete', id: b.id, gcEventId: b.calendarEventId || null }));
  const _delRoomD = primaryB.room === '其他' ? (primaryB.customRoom||'其他') : primaryB.room;
  const _delDetail = `${_delRoomD}　${primaryB.date}　${(primaryB.startTime||'').slice(0,5)}–${(primaryB.endTime||'').slice(0,5)}${primaryB.counselorName ? '　' + primaryB.counselorName : ''}`;
  const _suffix = idsToDelete.length > 1 ? ` (共${idsToDelete.length}筆)` : '';
  // 背景化：畫面立即移除（樂觀更新），儲存與 GC 刪除進工作執行分頁，不鎖畫面
  bookingsData = bookingsData.filter(x => !idsToDelete.includes(x.id));
  renderBookingsPage();
  const jobId = bgJobAdd(`刪除空間預約：${_delDetail}${_suffix}`);
  const _doCommitDelete = async () => {
    const result = await bkCommit(ops, { checkConflicts: false });
    if (result.fallback) {
      toDelete.forEach(b => { if (b.calendarEventId) proxyCall('deleteCalendarEvent', { eventId: b.calendarEventId }).catch(() => {}); });
      await saveBookings();
    } else if (result.error) {
      throw new Error(result.error);
    }
  };
  (async () => {
    bgJobProgress(jobId, 40);
    try {
      await _doCommitDelete();
      bgJobDone(jobId);
      auditLog('刪除空間預約', primaryB.caseId || null, null, _delDetail + _suffix);
    } catch (e) {
      // 5 秒後自動重試一次，仍失敗才醒目提醒
      await new Promise(r => setTimeout(r, 5000));
      try {
        await _doCommitDelete();
        bgJobDone(jobId);
        auditLog('刪除空間預約', primaryB.caseId || null, null, _delDetail + _suffix);
      } catch (_) {
        bgJobFail(jobId, '雲端儲存失敗');
        _showRetryNotice(`⚠ 刪除預約「${_delDetail}」已從畫面移除，但雲端儲存失敗，請重新整理頁面確認後再操作一次`);
        setAlert('bookings-alert', 'warn', '預約已從畫面移除，但雲端儲存失敗。請重新整理頁面確認狀態後再操作一次。');
        showToast('刪除預約的雲端儲存失敗，請重新整理頁面確認', 'error', 10000);
      }
    }
  })();
}

