// dev/ft-core.js — 新生心理測驗純函式層（拆 index.html 絞殺者第四刀，v250）。
// 內容為從 index.html 逐字搬出的純函式（網格/資料處理層）：不碰 document/window/localStorage、
// 頂層無任何執行副作用（只有 function 宣告與少量 const 純資料）。函式內部在呼叫時會引用本模組
// 的全域可變狀態 window._ft（schema/rows/tab 等，定義仍留在 index.html——不是純資料，故不隨本刀
// 搬移），屬 call-time 解析，與主程式其餘散落的 _ft* 全域狀態使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="ft-core.js"></script> 載入（放在 utils.js 之後、
// 主 inline script 之前，確保這裡的函式先於主程式定義）。
//
// 邊界：本檔止於「統計 tab — 渲染層（DOM）」註解標記之前——之後的 _ftLoadStatsView 等函式會
// 存取 document/proxyCall，屬渲染層，不在本刀範圍內，仍留在 index.html 原地。

function _ftCurrentSheet() { return FT_TAB_SHEET[_ft.tab] || null; }

// ── 純函式：儲存格值頭尾去空白（v213 規格③）。JS 的 Unicode WhiteSpace 定義本就涵蓋半形空白
//    （U+0020）、全形空白（U+3000）、Tab、不換行空白（U+00A0）與換行，故直接用 \s 頭尾比對即可，
//    不需要手動列舉字元類別。只動頭尾，不動字串中間（保留使用者刻意輸入的內部空白）。
//    null/undefined 原樣放行（不是「空字串」，呼叫端可能仍要區分「未填寫」與「填了空字串」）。──
function _ftTrimCell(v) {
  if (v == null) return v;
  return String(v).replace(/^\s+|\s+$/g, '');
}

// ── 純函式：排除已軟刪除（deleted:true）的列（v213 規格②）。供每個讀取 ftGetSheet 結果的入口
//    統一呼叫一次（grid／整合／統計／報告／匯入衝突比對／Google表單重複偵測／學生快照皆吃同一份
//    已過濾的 rows，見任務規格「統一過濾，別散彈」）。──
function _ftFilterDeleted(rows) {
  return (rows || []).filter(r => !(r && r.deleted === true));
}

// ── 純函式：貼上文字解析（\t 分欄、\n 分列，去除尾端多餘空行）──
function _ftParsePasteText(text) {
  if (text == null) return [];
  const norm = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = norm.split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(line => line.split('\t'));
}

// ── 純函式：把貼上的二維陣列套用到 rows（從 startRowIdx/startColIdx 開始鋪），超出現有列數
//    自動增列；超出現有欄位範圍的貼上內容捨棄（不新增欄位，欄位新增走欄位管理另一條路徑）。
//    不修改輸入 rows（回傳新陣列），供呼叫端決定要不要接受這次結果。──
function _ftApplyPasteToRows(rows, colIds, startRowIdx, startColIdx, grid) {
  const result = (rows || []).map(r => ({ ...r, cells: { ...((r && r.cells) || {}) } }));
  const neededRows = startRowIdx + grid.length;
  while (result.length < neededRows) result.push({ _id: null, cells: {} });
  grid.forEach((line, ri) => {
    const row = result[startRowIdx + ri];
    line.forEach((val, ci) => {
      const colId = colIds[startColIdx + ci];
      if (!colId) return;
      row.cells[colId] = val;
    });
  });
  return result;
}

// ── 純函式：欄位管理「新增欄位」用的 colId 產生器（與欄名脫鉤，欄名可自由改）──
function _ftGenColId(existingIds) {
  const used = new Set(existingIds || []);
  let id;
  do { id = 'col_' + Math.random().toString(36).slice(2, 8); } while (used.has(id));
  return id;
}

// ── 純函式：貼上欄數是否超出容納範圍（v213 規格⑤）。totalCols＝目前欄位總數，
//    startColIdx＝貼上起點欄位索引，pasteColCount＝貼上資料的欄數（多列貼上取最寬那一列）。──
function _ftPasteOverflowInfo(totalCols, startColIdx, pasteColCount) {
  const available = Math.max(0, (totalCols || 0) - (startColIdx || 0));
  const needed = pasteColCount || 0;
  const overflow = Math.max(0, needed - available);
  return { needed, available, overflow };
}

// ── 純函式：匯入欄位自動對應（v213 規格④）。規則：欄名 trim 後與現有欄位名稱精確相等，且該現有
//    欄位尚未被前面的匯入欄用掉（同一現有欄位不會被自動對到兩次）。匯入欄名為空白 → autoIgnored:true
//    （不強迫使用者在「欄位對照」modal 處理純空白的匯入欄，見任務規格對「有任一匯入欄對不上」的
//    合理詮釋——真正需要人工判斷的是「有內容但對不上」的欄，不是本來就沒填標題的空欄）。──
function _ftAutoMapImportHeaders(header, schemaCols) {
  const cols = schemaCols || [];
  const usedColIds = new Set();
  return (header || []).map((rawName) => {
    const name = _ftTrimCell(rawName);
    if (!name) return { importName: rawName, colId: null, autoIgnored: true };
    const col = cols.find(c => c.name === name && !usedColIds.has(c.id));
    if (col) { usedColIds.add(col.id); return { importName: rawName, colId: col.id, autoIgnored: false }; }
    return { importName: rawName, colId: null, autoIgnored: false };
  });
}

// 是否需要跳出「欄位對照」modal：只要有任一匯入欄「有內容但對不上」現有欄位即觸發。
function _ftImportNeedsMapping(mapping) {
  return (mapping || []).some(m => !m.colId && !m.autoIgnored);
}

// ══════════════ v223 A：欄位對照 modal 排序切換（純顯示排序，不影響確認邏輯）══════════════
// 該欄是否「已解決」：使用者已明確選過（userChoice 非 null，見 _ftRenderColumnMappingModal 的
// onchange），或初始自動對映時已精確命中現有欄位，或原本就是空白標題（autoIgnored，預設忽略、
// 不需要人工決定）。userChoice 優先於原始 mapping 狀態——即使原本「對不上」，使用者選過任何選項
// （含明確選「忽略此欄」）後就不再算「需要處理」。
function _ftColMapEntryResolved(m, userChoiceValue) {
  if (userChoiceValue != null) return true;
  return !!(m && (m.colId || m.autoIgnored));
}

// 依 sortMode 算出欄位對照列的顯示順序（真實索引陣列）：'issues' 把「需要處理」的欄排到最前面
// （組內維持原相對順序，穩定排序）；其餘（含預設 'file'）維持檔案原始欄位順序。
function _ftColumnMappingDisplayOrder(needsWorkFlags, sortMode) {
  const idxs = (needsWorkFlags || []).map((_, i) => i);
  if (sortMode !== 'issues') return idxs;
  const front = idxs.filter(i => needsWorkFlags[i]);
  const back = idxs.filter(i => !needsWorkFlags[i]);
  return front.concat(back);
}

// ══════════════ v213：交易式復原/重做（純函式部分）══════════════
// 設計：每筆交易記「反向差量」而非整表快照——removals（本交易移除的既有列，含原索引，供 undo
// 插回原位）、fieldChanges（儲存格/列旗標的新舊值，rowIdx 是「扣掉 removals、還沒套用 insertions」
// 那個中繼陣列的位置）、insertions（本交易新增的列，一律接在當時陣列尾端，見任務規格「反向差量」
// ＋呼叫端只在會實際成長陣列尾端的操作（新增列/貼上擴列/匯入新增/導師同步新增）產生 insertions，
// 移除操作僅發生在導師同步「刪除本地已無班級」——是本系統唯一的物理移除列來源）。
// 列身分比對用 _uid（前端自管的穩定 key，涵蓋尚未存檔、_id 為 null 的新列），不是 _id。

// 依 direction 對單一 fieldChange 套用 oldValue／newValue 到 rows[change.rowIdx]。
function _ftSetFieldValue(rows, change, useNew) {
  const row = rows[change.rowIdx];
  if (!row) return;
  const val = useNew ? change.newValue : change.oldValue;
  if (change.kind === 'cell') {
    row.cells = row.cells || {};
    row.cells[change.colId] = val;
  } else {
    row[change.name] = val;
  }
}

// 純函式：把一筆交易套用到 rows（direction 'redo' 依序 removals→fieldChanges(new)→insertions；
// 'undo' 依相反順序 insertions→fieldChanges(old)→removals，見上方檔頭「反向管線」說明）。
// 不修改輸入 rows（回傳新陣列＋深拷貝各列 cells，供呼叫端安心整包指派給 _ft.rows）。
function _ftApplyTransaction(rows, tx, direction) {
  const result = (rows || []).map(r => ({ ...r, cells: { ...((r && r.cells) || {}) } }));
  const removals = (tx && tx.removals) || [];
  const fieldChanges = (tx && tx.fieldChanges) || [];
  const insertions = (tx && tx.insertions) || [];
  if (direction === 'redo') {
    removals.slice().sort((a, b) => b.index - a.index).forEach(rm => { result.splice(rm.index, 1); });
    fieldChanges.forEach(ch => _ftSetFieldValue(result, ch, true));
    insertions.forEach(ins => {
      const clones = (ins.rows || []).map(r => ({ ...r, cells: { ...((r && r.cells) || {}) } }));
      result.splice(ins.at, 0, ...clones);
    });
  } else {
    insertions.slice().sort((a, b) => b.at - a.at).forEach(ins => { result.splice(ins.at, (ins.rows || []).length); });
    for (let i = fieldChanges.length - 1; i >= 0; i--) _ftSetFieldValue(result, fieldChanges[i], false);
    removals.slice().sort((a, b) => a.index - b.index).forEach(rm => {
      const clone = { ...rm.row, cells: { ...((rm.row && rm.row.cells) || {}) } };
      result.splice(rm.index, 0, clone);
    });
  }
  return result;
}

// 純函式：比較「交易前／交易後」兩份 rows 陣列（皆已由呼叫端確保每列有 _uid），算出上面
// _ftApplyTransaction 吃的交易物件。以 _uid 找出：交易後消失的列（removals，記錄消失前在 before
// 陣列的索引）；沿用下來的列（依 before 相對順序比對 cells 各欄與 excluded/_pendingDelete 旗標）；
// after 陣列中「本來就沒有 _uid 對應」的列一概視為本交易新增（insertions，接在沿用列之後——本
// 系統的成長操作一律發生在尾端，見檔頭說明）。若交易前後完全相同，回傳的三個陣列皆為空（呼叫端
// 應據此判斷「沒有變化，不需要推入 undo 堆疊」）。
function _ftDiffRowsForTransaction(beforeRows, afterRows) {
  const before = beforeRows || [];
  const after = afterRows || [];
  const beforeByUid = new Map();
  before.forEach((r, i) => { if (r && r._uid != null) beforeByUid.set(r._uid, { row: r, index: i }); });
  const afterByUid = new Set();
  after.forEach((r) => { if (r && r._uid != null) afterByUid.add(r._uid); });

  const removals = [];
  before.forEach((r, i) => {
    if (r && r._uid != null && !afterByUid.has(r._uid)) removals.push({ index: i, row: r });
  });

  const keptAfterRows = after.filter(r => r && r._uid != null && beforeByUid.has(r._uid));
  const fieldChanges = [];
  keptAfterRows.forEach((r, ki) => {
    const prev = beforeByUid.get(r._uid);
    const oldCells = (prev.row && prev.row.cells) || {};
    const newCells = (r && r.cells) || {};
    const allCols = new Set([...Object.keys(oldCells), ...Object.keys(newCells)]);
    allCols.forEach((colId) => {
      const ov = oldCells[colId];
      const nv = newCells[colId];
      if (String(ov ?? '') !== String(nv ?? '')) {
        fieldChanges.push({ rowIdx: ki, kind: 'cell', colId, oldValue: ov, newValue: nv });
      }
    });
    if (!!prev.row.excluded !== !!r.excluded) {
      fieldChanges.push({ rowIdx: ki, kind: 'flag', name: 'excluded', oldValue: !!prev.row.excluded, newValue: !!r.excluded });
    }
    if (!!prev.row._pendingDelete !== !!r._pendingDelete) {
      fieldChanges.push({ rowIdx: ki, kind: 'flag', name: '_pendingDelete', oldValue: !!prev.row._pendingDelete, newValue: !!r._pendingDelete });
    }
  });

  const newRows = after.filter(r => !r || r._uid == null || !beforeByUid.has(r._uid));
  const insertions = newRows.length ? [{ at: keptAfterRows.length, rows: newRows }] : [];
  return { removals, fieldChanges, insertions };
}

// ── v213 規格⑦⑧⑨：新增學期預設代碼／顯示名稱 ──
// 純函式：依目前日期算出預設學期代碼（「學年-學期」格式，比照既有 114-1 慣例）。
// 規則（見任務規格）：8 月起算新學年上學期；2~7 月為上一學年下學期；1 月仍屬上一學年上學期
// （寒假／上學期期末，尚未進入下學期）。
function _ftDefaultSemesterCode(now) {
  const d = now || new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  if (m >= 8) return `${y - 1911}-1`;
  if (m >= 2) return `${y - 1912}-2`;
  return `${y - 1912}-1`; // 1 月
}

// 純函式：由學期代碼推導預設顯示名稱（「XXX學年度第Y學期」）。代碼格式不符時回傳空字串
// （呼叫端據此判斷不覆寫使用者已輸入的內容）。
function _ftSemesterDisplayFromCode(code) {
  const m = /^(\d+)-([12])$/.exec(String(code == null ? '' : code).trim());
  if (!m) return '';
  return `${m[1]}學年度第${m[2]}學期`;
}

// ── 純函式：匯入資料以「學號」（keyColId）比對既有列，分成 新增/衝突(欄位值有差異)/無異動 三類
//    （students／tests tab 用；Google表單 tab 走不同的重複狀態流程，見 _ftGformMergeImport）。
//    v213：比對鍵一律先經 _ftTrimCell 去頭尾空白——既有存檔資料可能已含尾隨空白（教務處 Excel
//    常見），join 端 trim 才能救回歷史資料的比對，見任務規格③。──
function _ftDetectImportConflicts(existingRows, importRows, keyColId) {
  const byKey = new Map();
  (existingRows || []).forEach(r => {
    const k = _ftTrimCell(r && r.cells && r.cells[keyColId]);
    if (k) byKey.set(String(k), r);
  });
  const newRows = [], conflicts = [], unchanged = [];
  (importRows || []).forEach(incoming => {
    const k = _ftTrimCell(incoming && incoming.cells && incoming.cells[keyColId]);
    if (!k) return;
    const existing = byKey.get(String(k));
    if (!existing) { newRows.push(incoming); return; }
    const diffCols = [];
    const allCols = new Set([...Object.keys((existing && existing.cells) || {}), ...Object.keys((incoming && incoming.cells) || {})]);
    allCols.forEach(c => {
      const ev = ((existing.cells || {})[c] ?? '');
      const iv = ((incoming.cells || {})[c] ?? '');
      if (String(ev) !== String(iv)) diffCols.push(c);
    });
    if (diffCols.length) conflicts.push({ key: String(k), existing, incoming, diffCols });
    else unchanged.push(existing);
  });
  return { newRows, conflicts, unchanged };
}

// ══════════════ v223 C：匯入衝突統一處理視窗（純函式）══════════════
// 依「統一處理視窗」裡每組衝突已決定的最終內容（resolvedGroups：[{ existing, workingCells }]，
// workingCells 可能是原始現有值、原始匯入值，或使用者手動改過的混合值——與舊版
// _ftBuildImportFinalRows 的「整列二選一」不同，本函式不重新判斷取代與否，呼叫端已經決定好），
// 組出最終要送給 ftSaveRows 的完整 rows 陣列；newRows（無衝突的新資料）直接附加。
function _ftBuildImportFinalRowsFromGroups(existingRows, newRows, resolvedGroups) {
  const workingByExisting = new Map((resolvedGroups || []).map(g => [g.existing, g.workingCells]));
  const result = (existingRows || []).map(r => {
    const wc = workingByExisting.get(r);
    if (wc) return { ...r, cells: { ...wc } };
    return r;
  });
  return result.concat(newRows || []);
}

// 分頁：依 page（0-based）、pageSize 切出當頁要顯示的衝突組（大量衝突時避免一次全部塞進 DOM，
// 見任務規格「>200 組時每頁 50 組」）。
function _ftImportResolvePageSlice(groups, page, pageSize) {
  const size = pageSize || 50;
  const start = Math.max(0, page || 0) * size;
  return (groups || []).slice(start, start + size);
}

function _ftImportResolveTotalPages(total, pageSize) {
  const size = pageSize || 50;
  return Math.max(1, Math.ceil((total || 0) / size));
}

// ── 純函式：依匯入預覽的使用者勾選結果（acceptedKeys＝要「取代」的衝突學號集合），組出最終要
//    送給 ftSaveRows 的完整 rows 陣列（未勾選的衝突維持既有值；新增列直接附加）。v223：本函式
//    仍供「導師系統同步」（_ftApplyTutorSyncResult）沿用勾選式二選一邏輯，未變動——匯入衝突 modal
//    本身改走上方 _ftBuildImportFinalRowsFromGroups（統一處理視窗，可就地編輯），兩者並存。──
function _ftBuildImportFinalRows(existingRows, detect, acceptedKeys) {
  const result = (existingRows || []).map(r => {
    const match = detect.conflicts.find(c => c.existing === r);
    if (match && acceptedKeys.has(match.key)) {
      return { ...r, cells: { ...r.cells, ...match.incoming.cells } };
    }
    return r;
  });
  return result.concat(detect.newRows);
}

// ══════════════ v223 D2：資料 tab（tests／gform）刪除並儲存後的「評判記憶」（純函式）══════════════
// 使用者刪除某列並儲存（＝真刪，見 v216 軟刪除改儲存即真刪）後，記住該列的「簽名」（學號＋整列
// cells 內容的穩定雜湊）；之後再匯入內容完全相同的列時，不當成新資料帶入，而是靜默略過（見任務
// 規格 12-1）。儲存位置：該 sheet 的 rows.json 內新增 judged 欄位（見 server/src/freshmanTest/
// actions.js ftSaveRows／ftGetSheet），隨存檔一起送出／隨讀取原樣回傳，前端只負責計算內容。

// FNV-1a（32-bit）字串雜湊，回傳 8 碼十六進位字串——選用理由：實作簡單、分佈夠好，本用途只是
// 「內容比對用的指紋」，不是密碼學安全雜湊。
function _ftFnv1aHash(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 把 cells 轉成「跟物件 key 出現順序無關」的穩定字串再雜湊——欄位值一律先 _ftTrimCell（比照存檔
// 前整批 trim 慣例），空值/空字串視為未填寫、不落入指紋（確保「只差頭尾空白」或「同樣沒填的欄位
// 用 undefined 還是空字串表示」不會被誤判成不同內容）。
function _ftStableCellsString(cells) {
  const c = cells || {};
  const parts = [];
  Object.keys(c).sort().forEach((k) => {
    const v = _ftTrimCell(c[k]);
    if (v == null || v === '') return;
    parts.push(k + '=' + String(v));
  });
  return parts.join('');
}

function _ftRowJudgeHash(cells) {
  return _ftFnv1aHash(_ftStableCellsString(cells));
}

// 算出一列的評判記憶簽名 { stuId, hash }：stuId 供快速篩選候選、hash 供精確比對整列內容是否相同。
function _ftRowJudgeSignature(row, keyColId) {
  const cells = (row && row.cells) || {};
  const stuId = _ftTrimCell(cells[keyColId || 'stu_id']) || '';
  return { stuId, hash: _ftRowJudgeHash(cells) };
}

// 把本次存檔真正被刪除的既有列（見 _ftSaveEdit：_pendingDelete 且已有 _id）併入既有評判記憶，
// 同 stuId+hash 不重複記錄；deletedAt 由呼叫端傳入本次存檔時間（供測試可控，不在純函式內叫
// new Date()）。
function _ftBuildJudgedEntries(existingJudged, deletedRows, keyColId, nowIso) {
  const seen = new Set((existingJudged || []).map((j) => j.stuId + '' + j.hash));
  const merged = (existingJudged || []).map((j) => ({ stuId: j.stuId, hash: j.hash, deletedAt: j.deletedAt }));
  (deletedRows || []).forEach((row) => {
    const sig = _ftRowJudgeSignature(row, keyColId);
    if (!sig.stuId) return; // 沒有學號的列無法比對，不記錄
    const key = sig.stuId + '' + sig.hash;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ stuId: sig.stuId, hash: sig.hash, deletedAt: nowIso });
  });
  return merged;
}

// 該次「儲存」是否等同「全部刪除並儲存」（見任務規格 12-2：全部刪除＝重來，評判記憶應整批清空；
// 單筆刪除則持續累積）。判準：儲存前 rows 非空、且每一列都已標記 _pendingDelete——不論是透過工具
// 列「🗑 全部刪除」一次標記、還是使用者逐列點刪除湊滿全部，效果視為等價。
function _ftIsFullClearSave(rowsBeforeSave) {
  return !!(rowsBeforeSave && rowsBeforeSave.length && rowsBeforeSave.every((r) => r && r._pendingDelete === true));
}

// 匯入的新資料列（既有資料查無對應學號的列）比對評判記憶，把「內容與先前某筆已評判刪除的紀錄
// 完全相同」的列靜默篩掉，不當成新資料帶入。回傳 { kept, skippedCount }，kept 保留原順序。
function _ftFilterImportRowsAgainstJudged(rows, judged, keyColId) {
  const set = new Set((judged || []).map((j) => j.stuId + '' + j.hash));
  const kept = [];
  let skippedCount = 0;
  (rows || []).forEach((row) => {
    const sig = _ftRowJudgeSignature(row, keyColId);
    if (sig.stuId && set.has(sig.stuId + '' + sig.hash)) { skippedCount++; return; }
    kept.push(row);
  });
  return { kept, skippedCount };
}

// ── 純函式：該列缺少哪些必填欄位（不阻擋儲存，只用來標記醒目提示）──
function _ftRowMissingRequired(row, schema) {
  const cells = (row && row.cells) || {};
  return ((schema && schema.cols) || []).filter(c => c.required && !String(cells[c.id] ?? '').trim()).map(c => c.id);
}

// ══════════════ v222：資料 tab 關鍵字篩選＋問題列置頂（純函式，僅影響顯示順序，不動底層資料）══════════════
// 風險評估（見任務規格④）：虛擬化 grid 以「真實列索引」為單位運作（_ftRowHtml(ri) 直接取
// _ft.rows[ri]，編輯用的 oninput/onblur handler 也是把 ri 燒進 HTML 屬性），若在編輯模式下也套用
// 篩選/重排，等於要把「顯示順序位置」與「真實列索引」的映射貫穿到每一格的 DOM 事件與虛擬化窗口
// 計算，任何一處遺漏就會發生「編輯到別列」的資料損毀風險——遠高於本功能的效益。故採任務規格提供
// 的退而求其次路線：篩選／置頂只在非編輯模式可用（此時 grid 是純唯讀渲染，重排顯示順序不牽涉任何
// 事件 data-row 綁定），進入編輯模式即自動清空篩選並提示，見 _ftEnterEdit。

// 關鍵字是否比對到該列任一欄位值（不分大小寫、substring）。
function _ftRowMatchesFilter(row, filterText) {
  const q = String(filterText || '').trim().toLowerCase();
  if (!q) return true;
  const cells = (row && row.cells) || {};
  return Object.keys(cells).some(k => String(cells[k] ?? '').toLowerCase().includes(q));
}

// 該列是否為「問題列」：學號格式錯/重複、姓名不符（來自 _ftComputeCellChecks 的逐列結果，
// tests/gform tab 才有），或缺任一必填欄位（students/tests/gform 皆適用）。
function _ftRowIsIssue(row, schema, rowChecks) {
  if (rowChecks && (rowChecks.stuIdBad || rowChecks.stuIdDup || rowChecks.nameMismatch)) return true;
  return _ftRowMissingRequired(row, schema).length > 0;
}

// 算出顯示順序（真實列索引陣列）：先依關鍵字篩選，再視 pinIssuesTop 決定是否把問題列排到最前面
// （組內仍維持原相對順序，穩定排序，方便使用者理解「沒有被打散」）。checks 為 null 時視為
// 「沒有 tests/gform 檢核結果」（例如 students tab），只看必填缺漏。
function _ftComputeDisplayOrder(rows, schema, checks, filterText, pinIssuesTop) {
  const matched = [];
  for (let i = 0; i < (rows || []).length; i++) {
    if (_ftRowMatchesFilter(rows[i], filterText)) matched.push(i);
  }
  if (!pinIssuesTop) return matched;
  const issues = [];
  const rest = [];
  matched.forEach((i) => {
    const isIssue = _ftRowIsIssue(rows[i], schema, checks ? checks[i] : null);
    (isIssue ? issues : rest).push(i);
  });
  return issues.concat(rest);
}

// ── 純函式：v222 tab 快取——比較新舊 schema/rows 是否有實質差異（JSON 深比對即可，資料量不大，
//    不需要精緻的欄位級 diff；只用來決定「背景刷新回來的資料要不要無聲覆蓋畫面」，見
//    _ftRefreshActiveSheetInBackground）。──
function _ftSheetDataChanged(schemaA, rowsA, schemaB, rowsB) {
  return JSON.stringify(schemaA) !== JSON.stringify(schemaB) || JSON.stringify(rowsA) !== JSON.stringify(rowsB);
}

// ── 純函式：v222 統計 tab「高關懷清冊」長文案（可信度分析／綜合分析）預設收合摘要——超過 maxLen
//    截斷＋刪節號，未超過則原樣顯示（isLong 為 false，呼叫端不需要顯示展開/收合鈕）。──
function _ftTruncateForCollapse(text, maxLen) {
  const t = String(text == null ? '' : text);
  const limit = maxLen || 40;
  if (t.length <= limit) return { isLong: false, preview: t };
  return { isLong: true, preview: t.slice(0, limit) + '…' };
}

// ── 純函式：Excel 日期序號（如 SheetJS 以 header:1 讀出、未指定 cellDates 時，日期儲存格會是浮點數
//    序號，如 45923.61...）轉成可讀日期字串「YYYY/MM/DD HH:mm:ss」。v222：gform tab 的時間戳記
//    （ts 欄）匯入後顯示一串數字即此問題，見 _ftAoaToImportRows（匯入時轉換）與 _ftRowHtml（顯示
//    歷史髒資料時轉換）。序號基準日 1899-12-30（Excel/SheetJS 慣例，已內含 1900 閏年 bug 的偏移），
//    全程以 UTC 毫秒運算、不經過 Date 的 local getter，避免作業系統時區造成時間偏移。40000~60000
//    大致對應西元 2009~2064 年，超出此範圍視為非日期序號（例如一般數值欄位），回傳 null 不轉換。
function _ftExcelSerialToDateString(v) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < 40000 || n > 60000) return null;
  const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
  const ms = EXCEL_EPOCH_UTC_MS + Math.round(n * 86400000);
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ── 純函式：把 Excel/CSV 讀出的二維陣列（首列為標題列）轉成匯入列陣列——依欄名比對 schema.cols，
//    找不到對映欄名的欄位直接捨棄（欄位對照 modal 會在呼叫端把有落差的表頭改寫成現有欄名後才
//    呼叫本函式，見 _ftConfirmColumnMapping，本函式本身仍是單純的「精確欄名比對」）；
//    整列皆空白的列跳過。v213：每格值一律經 _ftTrimCell 去頭尾空白（規格③「匯入解析後」）。
//    v222：colId 為 'ts'（時間戳記，目前僅 gform tab 有此欄）且值為 Excel 日期序號時，匯入當下就轉
//    成可讀日期字串（見 _ftExcelSerialToDateString），落地資料即為可讀格式，不留待顯示層才轉換。──
function _ftAoaToImportRows(aoa, schemaCols) {
  if (!Array.isArray(aoa) || !aoa.length) return [];
  const header = aoa[0].map(h => String(h == null ? '' : h).trim());
  const colIdByName = new Map((schemaCols || []).map(c => [c.name, c.id]));
  const colIdxToColId = header.map(h => colIdByName.get(h) || null);
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    if (line.every(v => String(v == null ? '' : v).trim() === '')) continue;
    const cells = {};
    colIdxToColId.forEach((colId, ci) => {
      if (!colId) return;
      let v = line[ci];
      if (v !== undefined && v !== '') {
        if (colId === 'ts') {
          const converted = _ftExcelSerialToDateString(v);
          if (converted) v = converted;
        }
        cells[colId] = _ftTrimCell(String(v));
      }
    });
    rows.push({ cells });
  }
  return rows;
}

// ══════════════ v208 檢核（純函式）：學號格式／重複／姓名不符 ══════════════
// 套用於「測驗資料」與「Google表單」兩個 tab 的 grid render（「學生基本資料」tab 是比對基準本身，
// 不需要檢核自己）。純函式＋一次 O(n) 計算（見 _ftComputeCellChecks），render 逐格只查表，
// 不得在每格 render 時重新掃全表（效能要求）。

// 學號格式檢核：標準＝1 英文字母＋8 碼數字；科技農業特例＝系所欄含「科技農業」時，1字母＋4數字＋
// A＋3數字亦視為合格（見 memory project_freshman_test.md 使用者裁決）。空白視為不合格（不是「跳過」）。
function _ftValidateStuId(stuId, deptName) {
  const v = String(stuId == null ? '' : stuId).trim();
  if (!v) return { valid: false, reason: '學號空白' };
  if (/^[A-Za-z]\d{8}$/.test(v)) return { valid: true, reason: null };
  const isAgriDept = String(deptName || '').includes('科技農業');
  if (isAgriDept && /^[A-Za-z]\d{4}A\d{3}$/.test(v)) return { valid: true, reason: null };
  return { valid: false, reason: '學號格式不符（須為1英文字母+8碼數字，科技農業特例為1字母+4數字+A+3數字）' };
}

// 找出 rows 中同一 keyColId 值出現一次以上（忽略空白）的集合，供「同 tab 內學號重複」紅底標記
// （測驗資料 tab）與 Google表單「重複狀態」判斷（_ftRenderGformDupBar／_ftRowHtml）共用。
function _ftFindDuplicateStuIds(rows, keyColId) {
  const count = new Map();
  (rows || []).forEach(r => {
    const k = String(((r && r.cells) || {})[keyColId] ?? '').trim();
    if (!k) return;
    count.set(k, (count.get(k) || 0) + 1);
  });
  const dup = new Set();
  count.forEach((n, k) => { if (n > 1) dup.add(k); });
  return dup;
}

// 逐列算出檢核結果：
//  - stuIdBad/stuIdBadReason：學號格式（含科農特例）
//  - stuIdDup：cfg.flagDuplicates 為 true 時才標記——Google表單 tab 的重複已用列底色/刪除線處理，
//    避免雙重視覺，故 gform 呼叫時傳 false（見任務規格）；測驗資料 tab 傳 true。
//  - nameMismatch：學號存在於「學生基本資料」但姓名不一致；students 找不到此學號＝不標（那是
//    整合 tab 的事，見任務規格）。
function _ftComputeCellChecks(rows, cfg) {
  const keyColId = cfg.keyColId, nameColId = cfg.nameColId, deptColId = cfg.deptColId;
  const dupKeys = cfg.flagDuplicates ? _ftFindDuplicateStuIds(rows, keyColId) : new Set();
  const studentsNameByKey = new Map();
  (cfg.studentsRows || []).forEach(r => {
    const k = String(((r && r.cells) || {})[cfg.studentsKeyColId] ?? '').trim();
    if (k) studentsNameByKey.set(k, String(((r && r.cells) || {})[cfg.studentsNameColId] ?? '').trim());
  });
  return (rows || []).map(row => {
    const cells = (row && row.cells) || {};
    const stuId = String(cells[keyColId] ?? '').trim();
    const deptName = deptColId ? String(cells[deptColId] ?? '') : '';
    const fmt = _ftValidateStuId(stuId, deptName);
    const isDup = !!stuId && dupKeys.has(stuId);
    let nameMismatch = false;
    if (stuId && studentsNameByKey.has(stuId)) {
      const expected = studentsNameByKey.get(stuId);
      const actual = String(cells[nameColId] ?? '').trim();
      if (expected && actual && expected !== actual) nameMismatch = true;
    }
    return { stuIdBad: !fmt.valid, stuIdBadReason: fmt.valid ? null : fmt.reason, stuIdDup: isDup, nameMismatch };
  });
}

// ══════════════ v208 Google表單匯入：同學號多筆視為「重複狀態」（純函式）══════════════
// 完全相同列（各欄皆同，含比對既有列）→ 靜默跳過；其餘（含同學號但內容不同）一律新增為新列，
// 交由 grid 顯示層的重複偵測（_ftFindDuplicateStuIds）與「選主條目」處理，刻意不在匯入當下彈出
// 衝突勾選（與 students/tests tab 的匯入流程不同，見任務規格第 3 節：學生可能多次填寫，每筆都是
// 真實紀錄，不是需要人工判斷「取代或保留」的欄位衝突）。
function _ftGformMergeImport(existingRows, importRows) {
  const isSameCells = (a, b) => {
    const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of allKeys) {
      if (String((a || {})[k] ?? '') !== String((b || {})[k] ?? '')) return false;
    }
    return true;
  };
  const result = (existingRows || []).slice();
  let addedCount = 0, skippedCount = 0;
  (importRows || []).forEach(incoming => {
    const dupExact = result.some(r => isSameCells(r.cells, incoming.cells));
    if (dupExact) { skippedCount++; return; }
    result.push(incoming);
    addedCount++;
  });
  return { rows: result, addedCount, skippedCount };
}

// 找出重複組內「有差異」的欄位（供「選主條目」modal 只顯示差異欄，而非整列全部列出）。
function _ftGroupDiffCols(groupRows) {
  const allCols = new Set();
  (groupRows || []).forEach(r => Object.keys((r && r.cells) || {}).forEach(k => allCols.add(k)));
  const diff = [];
  allCols.forEach(col => {
    const vals = new Set((groupRows || []).map(r => String(((r && r.cells) || {})[col] ?? '')));
    if (vals.size > 1) diff.push(col);
  });
  return diff;
}

// 套用「選主條目」選擇結果：primaryRow（groupRows 其中一筆的物件參照）excluded 設為 false，
// 同組其餘列 excluded 設為 true；組外的列完全不受影響。以物件參照比對（比照既有
// _ftBuildImportFinalRows 的 c.existing === r 慣例），不需要額外的穩定 id 機制——呼叫端一律傳入
// 從 _ft.rows 篩選出的同一批物件參照（見 _ftShowGformDupModal／_ftConfirmGformPrimary）。
function _ftApplyPrimarySelection(rows, groupRows, primaryRow) {
  const groupSet = new Set(groupRows || []);
  return (rows || []).map(r => {
    if (!groupSet.has(r)) return r;
    return { ...r, excluded: r !== primaryRow };
  });
}

// ══════════════ v208 列虛擬化：可視窗口計算（純函式）══════════════
// 只 render 可視窗口＋緩衝列，捲動換窗（測驗資料 146 欄 × ~2000 列的效能硬需求，見任務規格第 2
// 節）。rowHeight/buffer 若不是正數則退回安全預設值（30px／0 列緩衝），rowCount<=0 回傳空窗口。
function _ftComputeVirtualWindow(scrollTop, viewportHeight, rowCount, rowHeight, buffer) {
  const rh = rowHeight > 0 ? rowHeight : 30;
  const buf = buffer > 0 ? buffer : 0;
  const total = rowCount > 0 ? rowCount : 0;
  const totalHeight = total * rh;
  if (!total) return { startIdx: 0, endIdx: 0, totalHeight: 0, offsetY: 0 };
  const st = scrollTop > 0 ? scrollTop : 0;
  let startIdx = Math.floor(st / rh) - buf;
  if (startIdx < 0) startIdx = 0;
  const vh = viewportHeight > 0 ? viewportHeight : rh;
  const visibleCount = Math.ceil(vh / rh) + buf * 2;
  let endIdx = startIdx + visibleCount;
  if (endIdx > total) endIdx = total;
  if (startIdx > total) startIdx = total;
  return { startIdx, endIdx, totalHeight, offsetY: startIdx * rh };
}

// ══════════════ v209：導師名冊 tutorsys 同步 — 純函式（衝突 diff／學院解析／博班補列）══════════════
// 後端 ftTutorSyncFetch 只負責唯讀讀取 tutorsys 快照（見 server/src/freshmanTest/tutorsysSync.js
// 白名單），本頁「與導師系統同步」按鈕的組裝／差異比對／使用者確認邏輯全部在前端純函式完成，
// 確認後仍是呼叫既有 ftSaveRows（sheet:'tutors'）落地——不另開一個後端寫入 action（比照 Slice 1
// ftSaveRows 檔頭「匯入合併沿用本 action、減少攻擊面」的既有原則）。

// 同步差異偵測：新增/衝突/無異動直接重用既有 _ftDetectImportConflicts（依 keyColId 比對），另外
// 算出「本地有但同步來源已無」的列（tutorsys 已刪除/停用的班級），供使用者勾選是否比照刪除
// （任務規格：「本地有但 tutorsys 已無的班級列出讓使用者勾選是否刪除」）。
// v213：key 一律經 _ftTrimCell（規格③，同 _ftDetectImportConflicts 的理由）。
function _ftTutorSyncDiff(existingRows, incomingRows, keyColId) {
  const base = _ftDetectImportConflicts(existingRows, incomingRows, keyColId);
  const incomingKeys = new Set((incomingRows || []).map(r => String(_ftTrimCell(r && r.cells && r.cells[keyColId]) ?? '')).filter(Boolean));
  const removed = (existingRows || []).filter(r => {
    const k = String(_ftTrimCell(r && r.cells && r.cells[keyColId]) ?? '');
    return !!k && !incomingKeys.has(k);
  });
  return { newRows: base.newRows, conflicts: base.conflicts, unchanged: base.unchanged, removed };
}

// 套用同步結果：先移除使用者勾選要刪除的列（本地有但 tutorsys 已無），再重用既有
// _ftBuildImportFinalRows 套用「取代」勾選與新增列（該函式以物件參照比對 conflicts.existing，
// 過濾動作只是縮減陣列、保留原物件參照，不影響比對邏輯）。首次同步（existingRows 為空陣列）走
// 這條路徑自然等於「全部視為新增」，不需要額外特判。v213：key 一律經 _ftTrimCell（規格③）。
function _ftApplyTutorSyncResult(existingRows, diff, acceptedReplaceKeys, deleteKeys) {
  const kept = (existingRows || []).filter(r => {
    const k = String(_ftTrimCell(r && r.cells && r.cells.class_abbr) ?? '');
    return !(deleteKeys && deleteKeys.has(k));
  });
  return _ftBuildImportFinalRows(kept, diff, acceptedReplaceKeys);
}

// 系所名稱正規化：去除常見尾綴（系/所/學程/進修部等），供「模糊比對」抓出同一系所的不同寫法
// （tutorsys deptId 多為短形式如「農園系」，本系統系所全名／deptToCollege 對照表則是教務全名
// 「農園生產系」之類，兩者常有共同核心詞但外綴不同，見 memory project_freshman_test.md「班級簡稱
// 三方比對」對這批系所命名分歧的完整記錄）。只做「去尾綴」單一層級的正規化，不試圖解決全部命名
// 分歧——查無比對一律回「無法分類」交人工於試算表補正，不是自動化的失敗。
function _ftDeptCore(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  s = s.replace(/(進修學士學位學程|學士學位學程|國際學位專班|國際碩士學位學程|學位學程|研究所|進修部|學程|進)$/, '');
  s = s.replace(/(系|所)$/, '');
  return s;
}

// 兩系所名稱是否視為同一系所：正規化後互為子字串（雙向 includes），且雙方正規化結果皆非空
// （避免空字串誤判為「互相包含」）。
function _ftDeptCoreMatches(a, b) {
  const ca = _ftDeptCore(a), cb = _ftDeptCore(b);
  if (!ca || !cb) return false;
  return ca.includes(cb) || cb.includes(ca);
}

// 學院解析 fallback 鏈（任務規格第 1 節）：
//  1. 優先在 deptToCollege（本系統後台「系所與學院對照」，key 為系所全名）用模糊比對找一筆；
//  2. 找不到，改在 studentsDeptCollegePairs（同學期 students sheet 實際出現過的「系所全名/學院」
//     配對，來源可能不如①權威但涵蓋較新/客製的系所寫法）用同樣邏輯猜；
//  3. 都找不到 → '無法分類'。
function _ftResolveDeptCollege(deptQuery, deptToCollege, studentsDeptCollegePairs) {
  const q = String(deptQuery || '').trim();
  if (!q) return '無法分類';
  if (deptToCollege && Object.prototype.hasOwnProperty.call(deptToCollege, q)) return deptToCollege[q];
  const cfgKeys = deptToCollege ? Object.keys(deptToCollege) : [];
  for (const full of cfgKeys) {
    if (_ftDeptCoreMatches(q, full)) return deptToCollege[full];
  }
  for (const pair of (studentsDeptCollegePairs || [])) {
    if (!pair || !pair.college) continue;
    if (pair.deptName === q || _ftDeptCoreMatches(q, pair.deptName)) return pair.college;
  }
  return '無法分類';
}

// 系所紀錄模糊比對（找 tutorsys 系所的系主任資料，供博班補列使用）——同樣的核心詞比對邏輯，
// 比對對象是 tutorsys departments 陣列的 id/name。
function _ftMatchDeptRecord(deptQuery, departments) {
  const q = String(deptQuery || '').trim();
  if (!q) return null;
  const exact = (departments || []).find(d => d && (d.id === q || d.name === q));
  if (exact) return exact;
  return (departments || []).find(d => d && (_ftDeptCoreMatches(q, d.id) || _ftDeptCoreMatches(q, d.name))) || null;
}

// 從 students rows 收集 (系所全名, 學院) 唯一配對，供學院解析 fallback② 使用。
function _ftCollectStudentsDeptCollegePairs(studentsRows) {
  const seen = new Set(), pairs = [];
  (studentsRows || []).forEach(r => {
    const dept = String((r && r.cells && r.cells.dept_name) ?? '').trim();
    const college = String((r && r.cells && r.cells.college) ?? '').trim();
    if (!dept || !college) return;
    const key = dept + '||' + college;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ deptName: dept, college });
  });
  return pairs;
}

// 主組裝函式：由 tutorsys 快照（classes/departments）＋同學期 students rows＋本系統系所↔學院
// 對照，組出「導師名冊」同步用的 incoming rows（尚未落地，交由呼叫端與既有列 diff／使用者確認後
// 才真正儲存，見 _ftTutorSyncDiff／既有 ftSaveRows）。
//  - 一般班級：一個 tutorsys active class 一列，系所欄直接放 deptId（任務規格明定，不轉換為全名）。
//  - 博士班補列：tutorsys 沒有博士班班級（見 memory project_freshman_test.md），改由 students
//    sheet 找「博」開頭、tutorsys 未涵蓋的班級簡稱，導師欄預設為系主任（找不到系主任資料則留空
//    並在備註加註）。
// 參數刻意不用解構寫在函式簽名上（用一般物件參數＋函式主體內解構）——測試載入器
// （test/harness.js）以「函式名稱後第一個 '{'」找函式本體起點，解構參數會讓它誤抓到參數列表的
// '{' 當作本體起點，見 harness.js 檔頭「跳過字串/註解的括號配對」限制。
function _ftAssembleTutorSyncRows(input) {
  const { classes, departments, studentsRows, deptToCollege } = input || {};
  const pairs = _ftCollectStudentsDeptCollegePairs(studentsRows);
  const rows = [];
  const coveredClassAbbr = new Set();

  (classes || []).forEach(cls => {
    const classAbbr = String((cls && cls.displayName) || '').trim();
    if (!classAbbr) return;
    coveredClassAbbr.add(classAbbr);
    const college = _ftResolveDeptCollege(cls.deptId, deptToCollege, pairs);
    const tutors = Array.isArray(cls.tutors) ? cls.tutors : [];
    rows.push({
      cells: {
        college,
        dept: cls.deptId || '',
        class_abbr: classAbbr,
        tutor_name: tutors.map(t => (t && t.name) || '').filter(Boolean).join('、'),
        tutor_email: tutors.map(t => (t && t.email) || '').filter(Boolean).join('、'),
        note: '',
      },
    });
  });

  // 博班補列：students sheet 內「博」開頭且 tutorsys 未涵蓋的班級簡稱，每個唯一班級簡稱補一列
  // （代表系所以該班級簡稱第一筆出現的學生資料為準——同班級簡稱理論上系所應一致）。
  const doctoralByClassAbbr = new Map();
  (studentsRows || []).forEach(r => {
    const classAbbr = String((r && r.cells && r.cells.class_abbr) ?? '').trim();
    if (!classAbbr || !classAbbr.startsWith('博')) return;
    if (coveredClassAbbr.has(classAbbr)) return;
    if (doctoralByClassAbbr.has(classAbbr)) return;
    doctoralByClassAbbr.set(classAbbr, String((r.cells && r.cells.dept_name) ?? '').trim());
  });
  doctoralByClassAbbr.forEach((deptName, classAbbr) => {
    const deptRecord = _ftMatchDeptRecord(deptName, departments);
    const college = _ftResolveDeptCollege(deptName, deptToCollege, pairs);
    const headDisplay = deptRecord ? (deptRecord.headName || deptRecord.headEmail || '') : '';
    const note = headDisplay ? '系主任（博士班預設）' : '系主任（博士班預設，查無系主任資料）';
    rows.push({
      cells: {
        college,
        dept: deptRecord ? deptRecord.id : deptName,
        class_abbr: classAbbr,
        tutor_name: headDisplay,
        tutor_email: deptRecord ? (deptRecord.headEmail || '') : '',
        note,
      },
    });
  });

  return rows;
}

// ══════════════ v209：整合 tab — 純函式（PR 解析／燈號／高關懷／同意判定／欄位計算）══════════════
// 整合 tab 是唯讀衍生視圖（不落地儲存，見任務規格第 2 節），本節純函式把 students/tests/gforms
// 三個 sheet 的 rows 即時算成 60 欄「整合」列——欄位語意比照 ef 整合表（見 memory
// project_freshman_test.md），計算規則為使用者已裁決版本（高關懷 >95、不是 ef VBA 的 >90 bug）。

// PR 字串解析：純數字直取；"<=20"/">=95"/"<80"/">95" 一律取其中的數字；"20~30" 型距取平均。
// 解析失敗（非空但無法辨識格式）回傳 error:true，供燈號顯示「數值錯誤」。
function _ftParsePrValue(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { value: null, error: false };
  if (/^\d+(\.\d+)?$/.test(s)) return { value: Number(s), error: false };
  let m;
  if ((m = s.match(/^[<>]=?\s*(\d+(?:\.\d+)?)$/))) return { value: Number(m[1]), error: false };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*[~-]\s*(\d+(?:\.\d+)?)$/))) return { value: (Number(m[1]) + Number(m[2])) / 2, error: false };
  return { value: null, error: true };
}

// 燈號（任務規格）：●紅 PR≥95、◎橙 ≥90、○黃 ≥80、☆綠 <80；空值不顯示燈號；解析失敗顯示「數值錯誤」。
function _ftPrDotDisplay(parsed) {
  if (!parsed) return '';
  if (parsed.error) return '數值錯誤';
  if (parsed.value == null) return '';
  if (parsed.value >= 95) return '●';
  if (parsed.value >= 90) return '◎';
  if (parsed.value >= 80) return '○';
  return '☆';
}

// 高關懷＝高自殺=true/v 或 解析後 ALPR>95（注意是 >95，不是 ef VBA 的 >90，見任務規格與使用者裁決①）。
function _ftIsHighConcern(highSuicideRaw, alprValue) {
  const hs = String(highSuicideRaw == null ? '' : highSuicideRaw).trim().toLowerCase();
  const flagged = hs === 'v' || hs === 'true' || hs === '1' || hs === '是';
  return flagged || (alprValue != null && alprValue > 95);
}

// Google表單同意題文字 → v/x/未填寫。「不同意」/「No」須先於「同意」/「Yes」判斷（"不同意" 內含
// "同意" 子字串，順序錯了會誤判為同意）。
function _ftGformConsentFromText(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '未填寫';
  if (t.includes('不同意') || /\bNo\b/i.test(t)) return 'x';
  if (t.includes('同意') || /\bYes\b/i.test(t)) return 'v';
  return '未填寫';
}

// 整合 19 個 PR 欄位 id（與測驗資料 sheet 同名，VKPR 不在其中——VKPR 只用於別的判準，不是燈號
// 欄位，見 memory project_freshman_test.md「35 項需求批」與 ef「系統(燈號標準)」設計）。
const FT_MERGED_PR_IDS = [
  'alpr', 'd1pr', 'd2pr', 'f1pr', 'f2pr', 'f3pr', 'f4pr',
  's01pr', 's02pr', 's03pr', 's04pr', 's05pr', 's06pr', 's07pr', 's08pr', 's09pr', 's10pr', 's11pr', 's12pr',
];

// 整合 tab 60 欄 schema：A~N 14 欄（與 server STUDENTS_DEFAULT_COLS 欄序/id 一致，此處獨立複製一份
// ——前後端是兩個獨立 runtime，沒有共用模組機制；C 改「測驗日期」、其餘 13 欄照舊）
// ＋O~R 四個 debug 旗標＋S 同意知情＋高自殺風險＋可信度＋19 PR＋19 燈號＋高關懷，共 60 欄。
function _ftMergedSchemaCols() {
  return [
    { id: 'stu_id', name: '學號' },
    { id: 'name_zh', name: '中文姓名' },
    { id: 'test_date', name: '測驗日期' },
    { id: 'edu_code', name: '學制代碼' },
    { id: 'edu_abbr', name: '學制簡稱' },
    { id: 'college', name: '學院' },
    { id: 'dept_code', name: '系所代碼' },
    { id: 'dept_name', name: '系所全名' },
    { id: 'class_code', name: '班級代碼' },
    { id: 'class_abbr', name: '班級簡稱' },
    { id: 'gender', name: '性別' },
    { id: 'email', name: 'Email' },
    { id: 'phone_contact', name: '學生聯絡電話' },
    { id: 'phone_mobile', name: '學生手機' },
    { id: 'flag_gform_id', name: 'Google表單有此學號' },
    { id: 'flag_gform_name', name: 'Google表單有此姓名' },
    { id: 'flag_test_id', name: '測驗資料有此學號' },
    { id: 'flag_test_name', name: '測驗資料有此姓名' },
    { id: 'consent', name: '是否同意導師知情' },
    { id: 'high_suicide', name: '高自殺風險' },
    { id: 'validity', name: '測驗結果可信度' },
    ...FT_MERGED_PR_IDS.map(id => ({ id, name: id.toUpperCase() })),
    ...FT_MERGED_PR_IDS.map(id => ({ id: id + '_dot', name: id.toUpperCase() + ' 燈號' })),
    { id: 'high_concern', name: '高關懷' },
  ];
}

// 單一學生列的整合欄位計算。existence 帶跨 sheet 存在性集合（O~R 旗標與 flag 用，見呼叫端
// _ftComputeMergedRows），testRow/gformRow 為 null 代表查無對應紀錄。
function _ftComputeMergedCells(studentsRow, testRow, gformRow, existence) {
  const sCells = (studentsRow && studentsRow.cells) || {};
  const tCells = (testRow && testRow.cells) || {};
  const gCells = (gformRow && gformRow.cells) || {};

  const cells = {
    // v216：stu_id／name_zh 顯示值須 trim——JOIN 比對本身（_ftComputeMergedRows 的 norm()）
    // 早已雙邊 trim，但這裡組出的顯示值先前未 trim，導致舊資料尾隨空白會一路帶到整合 tab／
    // 統計／報告／匯出，看起來像「對不上」（實際上比對沒問題，只是顯示值帶著空白）。
    stu_id: _ftTrimCell(sCells.stu_id) ?? '',
    name_zh: _ftTrimCell(sCells.name_zh) ?? '',
    test_date: tCells.test_date ?? '',
    edu_code: sCells.edu_code ?? '',
    edu_abbr: sCells.edu_abbr ?? '',
    college: sCells.college ?? '',
    dept_code: sCells.dept_code ?? '',
    dept_name: sCells.dept_name ?? '',
    class_code: sCells.class_code ?? '',
    class_abbr: sCells.class_abbr ?? '',
    gender: (tCells.gender && String(tCells.gender).trim()) || sCells.gender || '', // K：測驗資料優先
    email: sCells.email ?? '',
    phone_contact: sCells.phone_contact ?? '',
    phone_mobile: sCells.phone_mobile ?? '',
  };

  cells.flag_gform_id = existence.gformIdSet.has(existence.stuId) ? '是' : '';
  cells.flag_gform_name = existence.gformNameSet.has(existence.nameZh) ? '是' : '';
  cells.flag_test_id = existence.testIdSet.has(existence.stuId) ? '是' : '';
  cells.flag_test_name = existence.testNameSet.has(existence.nameZh) ? '是' : '';

  // S：取 Google表單主條目（呼叫端已排除 excluded:true，見 _ftComputeMergedRows）同意題文字。
  cells.consent = gformRow ? _ftGformConsentFromText(gCells.consent_mentor) : '未填寫';

  const validityParsed = _ftParsePrValue(tCells.validity);
  const alprParsed = _ftParsePrValue(tCells.alpr);
  // 效度=0/空 或 ALPR=0/空 → 測驗相關欄整組留空（視同未受測，見使用者裁決②；O~R／S 不受影響，
  // 那是「有沒有出現在來源表」的存在性旗標，與測驗結果是否有效無關）。
  const skip = !testRow || validityParsed.value == null || validityParsed.value === 0 || alprParsed.value == null || alprParsed.value === 0;

  if (skip) {
    cells.high_suicide = '';
    cells.validity = '';
    FT_MERGED_PR_IDS.forEach(id => { cells[id] = ''; cells[id + '_dot'] = ''; });
    cells.high_concern = '';
  } else {
    const hs = String(tCells.high_suicide == null ? '' : tCells.high_suicide).trim().toLowerCase();
    cells.high_suicide = (hs === 'v' || hs === '是' || hs === 'true') ? 'v' : '';
    cells.validity = tCells.validity ?? '';
    FT_MERGED_PR_IDS.forEach(id => {
      cells[id] = tCells[id] ?? '';
      cells[id + '_dot'] = _ftPrDotDisplay(_ftParsePrValue(tCells[id]));
    });
    cells.high_concern = _ftIsHighConcern(tCells.high_suicide, alprParsed.value) ? 'v' : '';
  }

  return cells;
}

// 主計算函式：學號優先比對（第一筆命中者為準，重複學號的檢核由各自 tab 的 grid 紅底標記負責，
// 不是整合 tab 的職責），姓名比對只用於 O~R 存在性旗標（見任務規格）。回傳 { rows, unmatched }，
// unmatched 為測驗資料／Google表單中「學號查無對應學生」的列（debug 用，見任務規格「未對應清單」）。
function _ftComputeMergedRows(studentsRows, testsRows, gformRows) {
  const norm = (v) => String(v == null ? '' : v).trim();

  const testsByStuId = new Map();
  (testsRows || []).forEach(r => {
    const id = norm(r && r.cells && r.cells.stu_id);
    if (id && !testsByStuId.has(id)) testsByStuId.set(id, r);
  });
  const testIdSet = new Set((testsRows || []).map(r => norm(r && r.cells && r.cells.stu_id)).filter(Boolean));
  const testNameSet = new Set((testsRows || []).map(r => norm(r && r.cells && r.cells.name_zh)).filter(Boolean));

  const gformPrimaryByStuId = new Map();
  (gformRows || []).forEach(r => {
    if (r && r.excluded === true) return; // 排除非主條目（Google表單同學號多筆選主條目，見 v208）
    const id = norm(r && r.cells && r.cells.stu_id);
    if (id && !gformPrimaryByStuId.has(id)) gformPrimaryByStuId.set(id, r);
  });
  const gformIdSet = new Set((gformRows || []).map(r => norm(r && r.cells && r.cells.stu_id)).filter(Boolean));
  const gformNameSet = new Set((gformRows || []).map(r => norm(r && r.cells && r.cells.name_zh)).filter(Boolean));

  const studentsIdSet = new Set((studentsRows || []).map(r => norm(r && r.cells && r.cells.stu_id)).filter(Boolean));

  const rows = (studentsRows || []).map(sRow => {
    const stuId = norm(sRow && sRow.cells && sRow.cells.stu_id);
    const nameZh = norm(sRow && sRow.cells && sRow.cells.name_zh);
    const testRow = stuId ? testsByStuId.get(stuId) : null;
    const gformRow = stuId ? gformPrimaryByStuId.get(stuId) : null;
    const cells = _ftComputeMergedCells(sRow, testRow, gformRow, { stuId, nameZh, testIdSet, testNameSet, gformIdSet, gformNameSet });
    return { cells, _hasTest: !!testRow };
  });

  const unmatched = [];
  (testsRows || []).forEach(r => {
    const id = norm(r && r.cells && r.cells.stu_id);
    if (id && !studentsIdSet.has(id)) unmatched.push({ stuId: id, name: norm(r.cells && r.cells.name_zh), source: '測驗資料' });
  });
  (gformRows || []).forEach(r => {
    const id = norm(r && r.cells && r.cells.stu_id);
    if (id && !studentsIdSet.has(id)) unmatched.push({ stuId: id, name: norm(r.cells && r.cells.name_zh), source: 'Google表單' });
  });

  return { rows, unmatched };
}

// v223 一.12：未對應清單「以姓名為主」的候選比對。unmatched 的學號在學生基本資料查無時，改用姓名
// 去學生基本資料找同名的人（以學生基本資料為評判主體），協助主責判斷這筆是否為某位學生的學號登打
// 錯誤。回傳每筆 unmatched 附上 candidates:[{stuId,name}]（可能多筆同名）。純函式、不動輸入。
function _ftUnmatchedNameCandidates(unmatched, studentsRows) {
  const norm = (v) => String(v == null ? '' : v).trim();
  const byName = new Map();
  (studentsRows || []).forEach(r => {
    const nm = norm(r && r.cells && r.cells.name_zh);
    if (!nm) return;
    if (!byName.has(nm)) byName.set(nm, []);
    byName.get(nm).push({ stuId: norm(r.cells && r.cells.stu_id), name: nm });
  });
  return (unmatched || []).map(u => ({ ...u, candidates: (u.name && byName.get(norm(u.name))) || [] }));
}

// 彙總列：總人數/有測驗紀錄數/高關懷數/未受測數（見任務裁決⑤：未受測＝無測驗紀錄，與「無效」
// (受測但可信度<61) 是不同概念，未受測數用 _hasTest 判斷，不受 skip 規則影響）。
function _ftMergedSummaryStats(rows) {
  const total = (rows || []).length;
  let withTest = 0, highConcern = 0;
  (rows || []).forEach(r => {
    if (r._hasTest) withTest++;
    if (r.cells && r.cells.high_concern === 'v') highConcern++;
  });
  return { total, withTest, untested: total - withTest, highConcern };
}

// ══════════════ v210 Slice 4：統計 tab — 純函式（指標單一來源，全部子表共用）══════════════
// 任務規格明定「全部從整合計算衍生，指標定義單一來源」——本節函式一律吃 _ftComputeMergedRows()
// 算出來的 rows（{cells, _hasTest}[]），不重寫任何 high_concern／validity／consent 判定
// （直接讀 cells.high_concern／cells.validity／cells.consent，這些欄位已由 v209 整合函式算好）。

// 應測/已測/未測/受測率/高關懷(總數/扣除不同意)/高關懷率/無效人數——五個子表（院系統計／學制統計／
// 高關懷班級前N）共用同一個彙總函式，避免各自重算造成指標不一致。
function _ftGroupMetrics(rows) {
  const list = rows || [];
  let tested = 0, highConcern = 0, highConcernConsentOnly = 0, invalid = 0;
  list.forEach(function (r) {
    if (r && r._hasTest) tested++;
    if (_ftInvalidCategory(r)) invalid++;
    if (r && r.cells && r.cells.high_concern === 'v') {
      highConcern++;
      if (r.cells.consent === 'v') highConcernConsentOnly++;
    }
  });
  const total = list.length;
  const untested = total - tested;
  return {
    total: total,
    tested: tested,
    untested: untested,
    testRate: total > 0 ? tested / total : 0,
    highConcern: highConcern,
    highConcernConsentOnly: highConcernConsentOnly,
    highConcernRate: tested > 0 ? highConcern / tested : 0,
    invalid: invalid,
  };
}

// 無效類別（使用者裁決②③）：學號根本不在測驗資料（_hasTest=false）→「未接受測驗」；已測但
// cells.validity（已套用 v209 效度/ALPR 皆為0時整組留空的 skip 規則）空白或 <61 →「測驗結果可信度
// 低」；否則（已測且可信度足夠）回傳 null（非無效）。回傳 null 而非 false，供呼叫端直接當類別文字用。
function _ftInvalidCategory(row) {
  if (!row || !row._hasTest) return '未接受測驗';
  const parsed = _ftParsePrValue(row.cells && row.cells.validity);
  if (parsed.value == null || parsed.value < 61) return '測驗結果可信度低';
  return null;
}

// 可信度分析文案（照 ef 原始 Excel 系統表 J14~K16 三段文，見任務規格①）。
// v211 修正：v210 把門檻與文案對應弄反了（誤把 <61 配「倉促」、61~80 配「不太專心」、>80 才配
// 「認真」）。正確對應＝>70 認真／>60 且 <=70 倉促／<=60 不太專心——注意 <=60 這條分界線恰好與
// _ftInvalidCategory 的無效判準「<61」一致（都是以 60/61 為界），並非巧合，是同一份 ef 邏輯。
function _ftValidityAnalysisText(validityRaw) {
  const parsed = _ftParsePrValue(validityRaw);
  if (parsed.value == null) return '';
  if (parsed.value > 70) return '您很認真填答，測驗報告是準確的。';
  if (parsed.value > 60) return '您似乎填答的有點倉促，結果報告可能有一點點不準。';
  return '您填答過程可能不太專心，結果報告可信度不高。';
}

// 綜合分析文案（照 ef Module4 語意，但判定改用乾淨規則：高自殺=v 或 AL 燈=紅● 為第一段；
// AL 燈=橙◎ 為第二段；其餘（黃○/綠☆）為第三段。刻意不採 ef「是否同意導師知情用 P 欄」的 bug，
// 本函式完全不讀 consent。）
function _ftComprehensiveAnalysisText(cells) {
  const c = cells || {};
  const hs = String(c.high_suicide == null ? '' : c.high_suicide).trim().toLowerCase() === 'v';
  const alDot = c.alpr_dot;
  if (hs || alDot === '●') {
    return '您最近似乎處在困擾中，甚至可能動彈不得的處境。非常建議您找尋專業人員求助，他們可以陪伴你，和你一同釐清、克服眼前的難關。';
  }
  if (alDot === '◎') {
    return '您最近似乎過得有點辛苦，不知道是哪些事情讓你心煩意亂呢？建議您持續觀察自己最近的生理、心理健康狀況。若覺得需要，歡迎找尋心理專業人員求助。';
  }
  return '您最近似乎把自己照顧的不錯喔，繼續維持。';
}

function _ftConsentDisplay(consent) {
  if (consent === 'v') return '同意';
  if (consent === 'x') return '不同意';
  return '未填寫';
}

// ①高關懷清冊：單列展開（19 個燈號欄＋可信度/綜合分析文案）。
function _ftHighConcernListRow(row) {
  const c = (row && row.cells) || {};
  return {
    stuId: c.stu_id || '',
    nameZh: c.name_zh || '',
    college: c.college || '',
    deptName: c.dept_name || '',
    classAbbr: c.class_abbr || '',
    gender: c.gender || '',
    validity: c.validity || '',
    highSuicide: c.high_suicide || '',
    highConcern: c.high_concern || '',
    consent: c.consent || '',
    consentDisplay: _ftConsentDisplay(c.consent),
    dots: FT_MERGED_PR_IDS.map(function (id) { return { id: id, dot: c[id + '_dot'] || '' }; }),
    validityAnalysis: _ftValidityAnalysisText(c.validity),
    comprehensiveAnalysis: _ftComprehensiveAnalysisText(c),
  };
}

// viewMode：'all' | 'consent'（S=v）| 'noconsent'（S=x 或 未填寫，見使用者裁決④「未填寫視同不同意」）。
function _ftHighConcernListRows(mergedRows, viewMode) {
  return (mergedRows || [])
    .filter(function (r) { return r && r.cells && r.cells.high_concern === 'v'; })
    .filter(function (r) {
      if (viewMode === 'consent') return r.cells.consent === 'v';
      if (viewMode === 'noconsent') return r.cells.consent !== 'v';
      return true;
    })
    .map(_ftHighConcernListRow);
}

// ②無效名單
function _ftInvalidListRow(row, category) {
  const c = (row && row.cells) || {};
  return {
    stuId: c.stu_id || '',
    nameZh: c.name_zh || '',
    college: c.college || '',
    deptName: c.dept_name || '',
    classAbbr: c.class_abbr || '',
    gender: c.gender || '',
    category: category,
  };
}

function _ftInvalidListRows(mergedRows) {
  const out = [];
  (mergedRows || []).forEach(function (r) {
    const cat = _ftInvalidCategory(r);
    if (cat) out.push(_ftInvalidListRow(r, cat));
  });
  return out;
}

// 分組鍵：直接用學生基本資料的學院／系所全名／班級簡稱值分組（任務規格明定不要用 ef 的關鍵字
// InStr 猜測法），空值歸「（未分類）」。
function _ftGroupKey(v) {
  const s = String(v == null ? '' : v).trim();
  return s || '（未分類）';
}

// ③院系統計：學院→系所→班級三層分組樹，每層都用同一個 _ftGroupMetrics 算指標（小計＝該層底下
// 所有列重新彙總，不是逐欄加總，避免無效人數等非可加性指標算錯）。
function _ftBuildCollegeDeptClassStats(mergedRows) {
  const collegeMap = new Map();
  (mergedRows || []).forEach(function (r) {
    const c = (r && r.cells) || {};
    const college = _ftGroupKey(c.college);
    const dept = _ftGroupKey(c.dept_name);
    const cls = _ftGroupKey(c.class_abbr);
    if (!collegeMap.has(college)) collegeMap.set(college, new Map());
    const deptMap = collegeMap.get(college);
    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const clsMap = deptMap.get(dept);
    if (!clsMap.has(cls)) clsMap.set(cls, []);
    clsMap.get(cls).push(r);
  });

  const collegeKeys = Array.from(collegeMap.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  return collegeKeys.map(function (college) {
    const deptMap = collegeMap.get(college);
    const deptKeys = Array.from(deptMap.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    let collegeRows = [];
    const depts = deptKeys.map(function (dept) {
      const clsMap = deptMap.get(dept);
      const clsKeys = Array.from(clsMap.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
      let deptRows = [];
      const classes = clsKeys.map(function (cls) {
        const rowsForClass = clsMap.get(cls);
        deptRows = deptRows.concat(rowsForClass);
        return { classAbbr: cls, metrics: _ftGroupMetrics(rowsForClass) };
      });
      collegeRows = collegeRows.concat(deptRows);
      return { dept: dept, metrics: _ftGroupMetrics(deptRows), classes: classes };
    });
    return { college: college, metrics: _ftGroupMetrics(collegeRows), depts: depts };
  });
}

// 攤平樹狀結構供表格渲染：每個系所後面接一列系所小計，每個學院所有系所後面接一列學院小計
// （使用者要求「系所小計與學院小計列」，ef 原表沒有，屬本切片新增）。
function _ftFlattenCollegeDeptStats(tree) {
  const out = [];
  (tree || []).forEach(function (c) {
    (c.depts || []).forEach(function (d) {
      (d.classes || []).forEach(function (cl) {
        out.push({ kind: 'class', college: c.college, dept: d.dept, classAbbr: cl.classAbbr, metrics: cl.metrics });
      });
      out.push({ kind: 'deptSubtotal', college: c.college, dept: d.dept, metrics: d.metrics });
    });
    out.push({ kind: 'collegeSubtotal', college: c.college, metrics: c.metrics });
  });
  return out;
}

// ④學制統計：分類規則照使用者裁決⑧（碩博士新生優先於大一新生判定，因「碩農園一」同時含「一」與
// 「碩」）。
function _ftClassifyEduLevel(classAbbr) {
  const s = String(classAbbr == null ? '' : classAbbr);
  if (s.indexOf('碩') !== -1 || s.indexOf('博') !== -1) return '碩博士新生';
  if (s.indexOf('二') !== -1 || s.indexOf('三') !== -1) return '轉學生';
  if (s.indexOf('一') !== -1) return '大一新生';
  return '無法分類';
}

// 導師 join：以班級簡稱在導師名冊（tutors sheet rows）精確比對，查無回傳 null（前端顯示紅字
// 「未找到」，見任務規格）。
function _ftFindTutorForClass(classAbbr, tutorsRows) {
  const q = String(classAbbr == null ? '' : classAbbr).trim();
  const found = (tutorsRows || []).find(function (r) {
    return r && r.cells && String(r.cells.class_abbr == null ? '' : r.cells.class_abbr).trim() === q;
  });
  return found ? (found.cells.tutor_name || '') : null;
}

// S01~S12 議題中文名對照（memory project_freshman_test.md；programmatic 常數，非 ef 的欄名 regex
// 猜測——刻意明確用 sXXpr_dot 燈號欄，不會誤吃 SxxPR/Sxx_dot 兩組欄名，見 ef bug 清單第 6 點）。
const FT_ISSUE_S_IDS = ['s01pr', 's02pr', 's03pr', 's04pr', 's05pr', 's06pr', 's07pr', 's08pr', 's09pr', 's10pr', 's11pr', 's12pr'];
const FT_ISSUE_LABELS = {
  s01pr: '同儕與人際互動', s02pr: '家庭功能影響', s03pr: '知心好友與親密關係', s04pr: '課業與作息變化',
  s05pr: '網路經驗與霸凌', s06pr: '性別認同壓力', s07pr: '情境誘發情緒', s08pr: '生氣與衝動控制',
  s09pr: '憤怒表達與攻擊', s10pr: '負向認知', s11pr: '憂鬱相關症狀', s12pr: '自殺意圖',
};

// 前5高議題：紅燈●人數排序（同數同名次不特別處理排名文字，僅回傳排序後清單，呼叫端 slice(0,5)）。
function _ftTop5IssuesForRows(rows) {
  const counts = {};
  FT_ISSUE_S_IDS.forEach(function (id) { counts[id] = 0; });
  (rows || []).forEach(function (r) {
    const c = (r && r.cells) || {};
    FT_ISSUE_S_IDS.forEach(function (id) {
      if (c[id + '_dot'] === '●') counts[id]++;
    });
  });
  return FT_ISSUE_S_IDS
    .map(function (id) { return { id: id, label: FT_ISSUE_LABELS[id], count: counts[id] }; })
    .filter(function (x) { return x.count > 0; })
    .sort(function (a, b) { return b.count - a.count || a.id.localeCompare(b.id); })
    .slice(0, 5);
}

// 依班級簡稱分組（學制統計主表），大一新生班級額外附前5高議題。
function _ftBuildEduLevelClassStats(mergedRows, tutorsRows) {
  const byClass = new Map();
  (mergedRows || []).forEach(function (r) {
    const cls = _ftGroupKey(r && r.cells && r.cells.class_abbr);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(r);
  });
  const classKeys = Array.from(byClass.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  return classKeys.map(function (cls) {
    const rows = byClass.get(cls);
    const level = _ftClassifyEduLevel(cls);
    const tutorName = _ftFindTutorForClass(cls, tutorsRows);
    const entry = {
      classAbbr: cls,
      level: level,
      metrics: _ftGroupMetrics(rows),
      tutorName: tutorName,
      tutorFound: tutorName != null,
    };
    if (level === '大一新生') entry.top5Issues = _ftTop5IssuesForRows(rows);
    return entry;
  });
}

// 大一新生班級前20高關懷排名：同高關懷人數同名次（標準競賽排名 1,1,3…）；0 人不排入
// （任務規格「上榜列整列紅字」的前提是要先排出名次）。
function _ftRankFreshmanClasses(classStatsList) {
  const freshman = (classStatsList || []).filter(function (e) { return e.level === '大一新生' && e.metrics.highConcern > 0; });
  const sorted = freshman.slice().sort(function (a, b) {
    return b.metrics.highConcern - a.metrics.highConcern || a.classAbbr.localeCompare(b.classAbbr, 'zh-Hant');
  });
  let rank = 0, prevCount = null;
  return sorted.map(function (e, idx) {
    if (prevCount === null || e.metrics.highConcern !== prevCount) {
      rank = idx + 1;
      prevCount = e.metrics.highConcern;
    }
    return Object.assign({}, e, { rank: rank });
  });
}

// ⑤高關懷班級前N（ef 隱藏表「高關懷班級」乾淨重做）：大一新生班級依高關懷人數降冪，取前 N 班
// 彙總（不足 N 班則以現有班級數為準）。ef 原表語意不明，這是我方乾淨詮釋版本。
function _ftTopNFreshmanSummary(classStatsList, n) {
  const freshman = (classStatsList || []).filter(function (e) { return e.level === '大一新生'; });
  const sorted = freshman.slice().sort(function (a, b) {
    return b.metrics.highConcern - a.metrics.highConcern || a.classAbbr.localeCompare(b.classAbbr, 'zh-Hant');
  });
  const top = sorted.slice(0, n);
  let sumHighConcern = 0, sumTested = 0;
  top.forEach(function (e) { sumHighConcern += e.metrics.highConcern; sumTested += e.metrics.tested; });
  return {
    n: n,
    classCount: top.length,
    highConcern: sumHighConcern,
    tested: sumTested,
    rate: sumTested > 0 ? sumHighConcern / sumTested : 0,
  };
}

function _ftTopNFreshmanClassesReport(classStatsList) {
  return [5, 10, 15, 20].map(function (n) { return _ftTopNFreshmanSummary(classStatsList, n); });
}
