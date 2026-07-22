// dev/utils.js — 純函式工具區（拆 index.html 絞殺者第三刀，v249）。
// 內容為從 index.html 逐字搬出的純函式：不碰 document/window/localStorage、不呼叫區塊外
// 才定義的函式（彼此互call或呼叫更早載入檔案內的函式除外）、頂層無執行副作用（只有
// function 宣告）。單一來源固定本檔；index.html 以 <script src="utils.js"></script> 載入
// （放在 hints.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。
//
// 說明：純函式在本專案散落於各功能模組內部（如新生心理測驗、空間預約、身心調適假等各自
// 都有標註「純函式」的小段落），本刀只挑「連續、無 DOM/全域狀態依賴」的區塊搬移，不逐一
// 東挑西撿——其餘散落的純函式（如 _ckgRangeIndices、_parseDraftKeyType 等）仍留在 index.html
// 原地，供未來各自模組專屬的拆檔續拆。

// ══════════════════════════════════════════════
//  學期換算（原「全域狀態」區段內的純函式部分）
// ══════════════════════════════════════════════
function currentSemesterPrefix() {
  const now = new Date();
  const rocYear = now.getFullYear() - 1911;
  const month = now.getMonth() + 1;
  if (month >= 8) return `${rocYear}1`;
  if (month === 1) return `${rocYear - 1}1`;
  return `${rocYear - 1}2`;
}
function openDateToSemPrefix(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const rocYear = d.getFullYear() - 1911;
  const month = d.getMonth() + 1;
  if (month >= 8) return `${rocYear}1`;
  if (month === 1) return `${rocYear - 1}1`;
  return `${rocYear - 1}2`;
}
function semesterLabel(prefix) {
  if (!prefix) return '—';
  // 同學期重複開案的 sem key 帶 '#N' 後綴（如 '1142#2'）；base 轉一般標籤，附加 '#N' 後綴（'114-2#2'）
  const hashIdx = prefix.indexOf('#');
  const base   = hashIdx === -1 ? prefix : prefix.slice(0, hashIdx);
  const suffix = hashIdx === -1 ? '' : '#' + prefix.slice(hashIdx + 1);
  if (base.length < 4) return prefix;
  return `${base.slice(0, -1)}-${base.slice(-1)}${suffix}`;
}
function semesterMonths(prefix) {
  const hashIdx = prefix ? prefix.indexOf('#') : -1;
  const base = !prefix ? '' : (hashIdx === -1 ? prefix : prefix.slice(0, hashIdx));
  if (!base || base.length < 4) return [];
  const semType = base.slice(-1);
  const adYear = parseInt(base.slice(0, -1)) + 1911;
  if (semType === '1') {
    return [`${adYear}-08`,`${adYear}-09`,`${adYear}-10`,`${adYear}-11`,`${adYear}-12`,`${adYear+1}-01`];
  } else {
    return [`${adYear+1}-02`,`${adYear+1}-03`,`${adYear+1}-04`,`${adYear+1}-05`,`${adYear+1}-06`,`${adYear+1}-07`];
  }
}
function semesterDateRange(prefix) {
  if (!prefix || prefix.length < 4) return null;
  const semType = prefix.slice(-1);
  const adYear  = parseInt(prefix.slice(0, -1)) + 1911;
  if (isNaN(adYear)) return null;
  return semType === '1'
    ? { first: `${adYear}-08-01`,     last: `${adYear + 1}-01-31` }
    : { first: `${adYear + 1}-02-01`, last: `${adYear + 1}-07-31` };
}

// ══════════════════════════════════════════════
//  工具
// ══════════════════════════════════════════════
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\x27/g, '&#39;')   // R6：屬性若用單引號包住使用者輸入時防 XSS（\x27 避免字面量單引號干擾字串/註解感知的工具解析）
    .replace(/\x60/g, '&#96;');  // R6：防範反引號被用於樣板字面量注入的邊角情境（\x60 同上，避免字面量反引號）
}

// ══════════════════════════════════════════════
//  空間預約：系列日期／頻率換算（純函式）
// ══════════════════════════════════════════════
function _bkFmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _bkAddDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return _bkFmtDate(new Date(y, m - 1, d + n));
}

// #24：每月頻率用——從 dateStr 起算 k 個月後，保留原本的「日」；若目標月無此日
// （如 1/31 加 1 個月 → 2 月無 31 日），取該月最後一天（不可用固定天數推算）。
function _bkAddMonths(dateStr, k) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + k;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(ny, nm + 1, 0).getDate(); // 該月天數（下月第 0 天＝本月最後一天）
  return _bkFmtDate(new Date(ny, nm, Math.min(d, lastDay)));
}

// #24：依「頻率週期數」從錨點日期往後推算單一目標日期。freq 為天數（7/14/21…）時
// ＝anchor + periods*freq 天；freq==='monthly' 時＝anchor 往後 periods 個月（月底邊界見 _bkAddMonths）。
// 一律以錨點直接算（不鏈式從前一期日期累加），避免月底裁切造成的日期漂移
// （例：1/31 起算兩期應為 3/31；若從 1/31+1個月＝2/28 再加一個月會誤算成 3/28）。
function _bkAddFreq(anchorDateStr, freq, periods) {
  return freq === 'monthly' ? _bkAddMonths(anchorDateStr, periods) : _bkAddDays(anchorDateStr, periods * freq);
}

// 系列日期平移用：回傳 b 相對於 a 的天數差（可正可負，可跨月跨年）。a, b 為 'YYYY-MM-DD'。
function _bkDaysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = new Date(ay, am - 1, ad);
  const db = new Date(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

// v174：時段格線拖曳系列預約平移用——回傳 newT 相對於 oldT 的分鐘差（可正可負）。t 為 'HH:MM'（或含秒的
// 'HH:MM:SS'，僅取前兩段）。與 _bkDaysBetween 同一組平移語意，供 _bkDragConfirmScope 整批位移時間用。
function _bkTimeDeltaMin(oldT, newT) {
  const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  return toMin(newT) - toMin(oldT);
}
// v174：依分鐘差平移 'HH:MM' 時間字串（超出 0–24 時以 24 小時循環處理，本系統節次皆在同日內不會用到跨日）。
function _bkShiftTime(t, deltaMin) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  let total = (h || 0) * 60 + (m || 0) + (deltaMin || 0);
  total = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// #24：由系列既有日期陣列（依日期升冪排序）反推當初的重複頻率，供編輯系列時預先勾選對應的頻率
// radio。固定天數（7/14/21）優先判斷；否則檢查是否為「每月同一天」模式（含月底邊界）；
// 皆不符（例如系列中有某幾筆被個別調整過日期）回傳 null，UI 呈現為「頻率非固定」。
function _bkDetectSeriesFreq(dates) {
  if (!Array.isArray(dates) || dates.length < 2) return null;
  let fixedDays = null, fixedOk = true;
  for (let i = 1; i < dates.length; i++) {
    const d = _bkDaysBetween(dates[i - 1], dates[i]);
    if (fixedDays === null) fixedDays = d;
    else if (d !== fixedDays) { fixedOk = false; break; }
  }
  if (fixedOk && [7, 14, 21].includes(fixedDays)) return fixedDays;
  // 每月判斷需以「第一筆（錨點）的日」為準逐一比對 anchor+i個月，不可用前一筆逐次疊加
  // （前一筆若剛好被月底裁切過，如 2/28，會誤把疊加基準的「日」也降成 28，導致 3 月誤判為 28 而非 31）。
  const monthlyOk = dates.every((d, i) => i === 0 || _bkAddMonths(dates[0], i) === d);
  if (monthlyOk) return 'monthly';
  return null;
}

// #24：頻率的可讀文案（稽核紀錄等唯讀呈現處使用），與「重複預約」radio 的選項文字一致。
function _bkFreqLabel(freq) {
  if (freq === 'monthly') return '每月';
  const map = { 7: '每週', 14: '每兩週', 21: '每三週' };
  return map[freq] || `每 ${freq} 天`;
}

// 系列編輯／拖曳共用：依範圍從 bookings 篩出目標預約清單（回傳實際物件參照，非複本）。
// editedBooking：被操作的那一筆（以其 seriesId/date 為基準）；scope：'this' | 'future' | 'all'。
// scope 為 'this' 或 editedBooking 非系列成員時，只回傳 editedBooking 自己（在 bookings 內找得到才回傳）。
function _bkSeriesTargets(bookings, editedBooking, scope) {
  if (scope === 'this' || !editedBooking?.seriesId) {
    const self = bookings.find(x => x.id === editedBooking?.id);
    return self ? [self] : [];
  }
  return bookings.filter(x => x.seriesId === editedBooking.seriesId &&
    (scope === 'all' || x.date >= editedBooking.date));
}

// 系列預約中「下次會談」：同 seriesId、日期晚於 booking 的最早一筆；找不到（無系列或已是最後一筆）回 null。
function _bkNextInSeries(bookings, booking) {
  if (!booking?.seriesId) return null;
  const later = bookings.filter(x => x.seriesId === booking.seriesId && x.date > booking.date);
  if (!later.length) return null;
  return later.reduce((earliest, x) => (x.date < earliest.date ? x : earliest));
}

// v100：編輯系列預約時調整頻率／次數（純函式，供 saveBooking 呼叫與單元測試共用）。
// seriesSorted：同系列全部筆依日期升冪排序的陣列（至少含 {id, date}，為套用此次編輯「之前」的原始狀態）。
// editedId／editedNewDate：被編輯筆的 id 與其於 modal 填的新日期（重排錨點）。
// freq：本次生效頻率——天數（7/14/21…）或 'monthly'（#24 擴充每三週／每月，見 _bkAddFreq）；
// newCount：目標系列總筆數。
// 語意（已與使用者確認）：被編輯筆本身視為錨點、不重排；同系列中「原日期晚於被編輯筆原日期」的筆
// 依新頻率重排為 anchor 起算第 1、2…期（依原日期排序決定順序，會覆蓋先前個別調整的日期）；
// 更早的筆維持原日期不動。次數增加時從（重排後）系列最後一期繼續往後推算新增；
// 次數減少時刪除（重排後）日期最晚者，被編輯筆本身一律不可刪。
// 回傳 { redates:[{id,date}], creates:[date,...], deleteIds:[id,...] }：
//   redates 只含日期實際變動、且不會被刪除的筆；creates 為新增筆日期（依序）；deleteIds 為待刪既有筆 id。
// 注意：簽名不可用預設參數（`opts = {}` 會被 test/harness.js 的 indexOf('{') 抽取誤導）。
function _bkSeriesReplan(seriesSorted, editedId, editedNewDate, freq, newCount) {
  const edited = seriesSorted.find(b => b.id === editedId);
  const editedOrigDate = edited ? edited.date : editedNewDate;
  const front = seriesSorted.filter(b => b.id !== editedId && b.date < editedOrigDate);
  const back  = seriesSorted.filter(b => b.id !== editedId && b.date > editedOrigDate);

  let redates = [];
  const backNewDates = back.map((b, idx) => {
    const nd = _bkAddFreq(editedNewDate, freq, idx + 1);
    if (nd !== b.date) redates.push({ id: b.id, date: nd });
    return nd;
  });

  const currentTotal = front.length + 1 + back.length;
  const creates = [];
  let deleteIds = [];

  if (newCount > currentTotal) {
    // 新增筆一律從錨點往後接續第 back.length+1、+2…期（monthly 每期都直接以錨點的「日」推算，
    // 不鏈式從前一筆日期累加，避免月底裁切造成日期漂移；固定天數時與鏈式累加結果等價）。
    for (let k = 1; k <= newCount - currentTotal; k++) {
      creates.push(_bkAddFreq(editedNewDate, freq, back.length + k));
    }
  } else if (newCount < currentTotal) {
    const removeCount = currentTotal - newCount;
    const others = [
      ...front.map(b => ({ id: b.id, date: b.date })),
      ...back.map((b, idx) => ({ id: b.id, date: backNewDates[idx] })),
    ];
    others.sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0))); // 日期新→舊
    deleteIds = others.slice(0, removeCount).map(o => o.id);
    const delSet = new Set(deleteIds);
    redates = redates.filter(r => !delSet.has(r.id));
  }

  return { redates, creates, deleteIds };
}
