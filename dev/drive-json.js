// dev/drive-json.js — Drive JSON 檔案 helper 群（_withRetry 重試、個案 chunk 讀寫、
// 索引條目推導、driveRead/Create/Update JSON 檔與資料夾 helper）（拆 index.html 絞殺者
// 第三十四刀，v281）。內容為從 index.html 逐字搬出的連續區段。
// 載入期副作用（column-0 複核）：無——頂層僅 function/const/純 let 宣告。
// 可安全前移到主 inline script 之前載入（刀法①）。
// 函式內部呼叫時才引用主檔全域（proxyCall 等），跨 script 全域可見。
// ══════════════════════════════════════════════
//  支援 "fileName" 或 "subfolder/fileName"（fileName 已含 .json 副檔名）
async function _withRetry(fn, maxRetries = 2, baseDelayMs = 1500) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const v = await fn();
      if (attempt > 0) _hideRetryNotice();
      return v;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const wait = baseDelayMs * (attempt + 1);
        _syslog('warn', `重試 ${attempt + 1}/${maxRetries}（等待 ${wait}ms）：${e.message}`);
        _showRetryNotice(`⟳ 資料存取失敗，${Math.round(wait / 1000)} 秒後自動重試（第 ${attempt + 1}/${maxRetries} 次）…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  _syslog('error', `重試耗盡（${maxRetries} 次）：${lastErr.message}`);
  throw lastErr;
}

async function driveSaveJsonInCases(fileName, content) {
  return _withRetry(async () => {
    const slashIdx = fileName.indexOf('/');
    const leafName = slashIdx >= 0 ? fileName.slice(slashIdx + 1) : fileName;
    const path = `cases/${fileName}`;
    try {
      // 先嘗試路徑更新（不需要 folder ID，對既有檔案最快）
      await driveUpdateJsonFile(path, content);
    } catch (e) {
      if (!e.message.includes('找不到')) throw e;
      // 檔案不存在時才解析 parentId 並建立（避免 getCasesFolderId 在 Apps Script 未部署時卡住）
      let parentId;
      if (slashIdx >= 0) {
        parentId = await getOrCreateCasesSubfolder(fileName.slice(0, slashIdx));
      } else {
        parentId = await getCasesFolderId();
      }
      await driveCreateJsonFile(leafName, content, parentId);
    }
  });
}

// 批次匯入專用：直接以 casesData 記憶體資料覆寫受影響的 chunk，不先讀 Drive
// 避免 saveCasesChunks 的 read-merge-write 在 Drive 快取未刷新時寫入舊資料
async function _batchWriteChunks(affectedIds, onProgress) {
  const affSet = new Set(affectedIds);
  const affChunks = new Set([...affSet].map(getCaseChunkName));
  // 保護：affected chunks 內若有 cold case（含未在 affectedIds 但在同 chunk 者），先載入完整資料
  const coldIdsInAffChunks = casesData
    .filter(c => c?.id && c._indexOnly && !c._fullLoaded && affChunks.has(getCaseChunkName(c.id)))
    .map(c => c.id);
  if (coldIdsInAffChunks.length) await _ensureFullCases(coldIdsInAffChunks);
  const chunkMap = {};
  const deletedSet = new Set(casesManifest.deletedIds || []);
  casesData.forEach(c => {
    if (!c.id) return;
    const name = getCaseChunkName(c.id);
    if (!affChunks.has(name) || deletedSet.has(c.id)) return;
    if (!chunkMap[name]) chunkMap[name] = [];
    // chunk 欄位（Slice 3 歸屬記錄）只存 index，不可落地進 chunk 檔本體（case 物件可能因從 index entry 展開而帶有）
    const { chunk, ...cleanC } = c;
    chunkMap[name].push(cleanC);
  });
  const chunks = Object.keys(chunkMap).sort();
  let manifestChanged = false;
  for (const name of chunks) {
    if (!casesManifest.chunks.includes(name)) {
      casesManifest.chunks.push(name); casesManifest.chunks.sort(); manifestChanged = true;
    }
  }
  if (manifestChanged) await driveSaveJsonInCases('manifest.json', casesManifest);
  // 寫入前 patch lastActivityAt（衍生欄位）
  chunks.forEach(name => {
    (chunkMap[name] || []).forEach(c => { if (c && c.id) c.lastActivityAt = _computeLastActivityAt(c); });
  });
  let done = 0;
  const BATCH = 3;
  for (let i = 0; i < chunks.length; i += BATCH) {
    await Promise.all(chunks.slice(i, i + BATCH).map(async name => {
      await driveSaveJsonInCases(`${name}.json`, { cases: chunkMap[name] });
      done++;
      if (onProgress) onProgress(done, chunks.length);
    }));
  }
  // 同步輕量索引與 hot 集合
  await _updateCasesIndexEntries([...affSet]);
  await _updateCasesHotEntries([...affSet]);
}

// ── cases-index.json（Hot/Cold 分層載入用輕量索引）─────────────────
// 從完整 case 物件擷取索引欄位（足夠列表渲染與搜尋；封存個案僅靠此資料顯示）
// 蒐集個案的所有初次晤談者 email（供 index 驅動的可見性判定；不含空值、去重）
function _caseInterviewerEmails(c) {
  const set = new Set();
  if (c?.initialInterview?.interviewerEmail) set.add(c.initialInterview.interviewerEmail);
  if (c?.initialInterviews) {
    Object.values(c.initialInterviews).forEach(ii => { if (ii?.interviewerEmail) set.add(ii.interviewerEmail); });
  }
  return [...set];
}

function _caseToIndexEntry(c) {
  return {
    id: c.id,
    name: c.name || '',
    studentId: c.studentId || '',
    idNumber: c.idNumber || '',
    phone: c.phone || '',
    archived: !!c.archived,
    deleted: !!c.deleted,
    // 存「最新學期主責」而非 raw root 值，確保 scoped 載入與可見性判定用同一真相
    counselorEmail: _getLatestCounselorEmail(c) || '',
    counselorName: c.counselorName || '',
    counselorText: c.counselorText || '',
    // index-only 個案可能已帶有 interviewerEmails（來自上次 index），若無完整資料則沿用；有完整資料則重算
    interviewerEmails: (c.initialInterview || c.initialInterviews)
      ? _caseInterviewerEmails(c)
      : (Array.isArray(c.interviewerEmails) ? [...c.interviewerEmails] : []),
    department: c.department || '',
    grade: c.grade || '',
    openDate: c.openDate || '',
    updatedAt: c.updatedAt || '',
    lastActivityAt: c.lastActivityAt || '',
    status: c.status || '',
    abType: _caseLatestAbType(c),
    caseType: c.caseType || '',
    isTransferCase: !!c.isTransferCase,
    // 精神科醫師「僅評估列表可見」權限用：標記此案是否有（未刪除的）精神科評估
    hasPsyEval: (c.psychiatristRecords || c._fullLoaded || !c._indexOnly)
      ? !!(c.psychiatristRecords || []).some(p => p && !p.deleted)
      : !!c.hasPsyEval,
    semesters: (Array.isArray(c.semesters) && c.semesters.length)
      ? [...c.semesters]
      : [openDateToSemPrefix(c.openDate)].filter(Boolean),
    // 個案架構重構 Slice 3：chunk 歸屬持久化（僅存於 index；getCaseChunkName 經 _caseChunkMap 讀回）
    chunk: getCaseChunkName(c.id),
  };
}

// 從 case 掃描 records / psychiatristRecords / events，取最新非刪除項目的 date；
// 保守 fallback 到 c.updatedAt。用於索引展示與未來「殭屍案」偵測。
function _computeLastActivityAt(c) {
  const dates = [];
  (c.records || []).forEach(r => { if (r && r.date && !r.deleted) dates.push(r.date); });
  (c.psychiatristRecords || []).forEach(p => { if (p && p.date && !p.deleted) dates.push(p.date); });
  (c.events || []).forEach(ev => { if (ev && ev.date && !ev.deleted) dates.push(ev.date); });
  if (!dates.length) return c.updatedAt || c.openDate || '';
  dates.sort();
  return dates[dates.length - 1];
}

// 判定 case 是否 hot（本學期開案、未結案、未封存、未刪除）
function _isHotCase(c) {
  if (!c || !c.id) return false;
  if (c.archived || c.deleted) return false;
  const cur = currentSemesterPrefix();
  const sems = (Array.isArray(c.semesters) && c.semesters.length)
    ? c.semesters : [openDateToSemPrefix(c.openDate)].filter(Boolean);
  if (!sems.includes(cur)) return false;
  const st = (c.semesterStatus && c.semesterStatus[cur]) || 'active';
  if (st === 'closed') return false;
  return true;
}

// ── 個案架構重構 Slice 3：chunk 與案號脫鉤（active/cold 分塊）──────────────
// 是否已執行過重新分塊：以 manifest.chunks 有無 'active-' 開頭項判定。
// 尚未執行過 → 新開案／全量重建一律沿用現行案號推導（legacy）；執行過一次後 → 之後都採新制。
function _rechunkHasRun() {
  return (casesManifest?.chunks || []).some(n => typeof n === 'string' && n.startsWith('active-'));
}

// 推算個案「最後活動學年」（民國 3 碼）：優先 lastActivityAt（可能為完整 ISO 或 YYYY-MM-DD，只取日期部分換算）；
// 缺值則退回 semesters 最大值（去除 #N 後綴）的前 3 碼；再缺則退回案號前 3 碼；理論上不會發生的極端狀況回傳 '000'。
function _lastActivityYearOf(c) {
  const raw = c?.lastActivityAt ? String(c.lastActivityAt).slice(0, 10) : '';
  const sem = raw ? openDateToSemPrefix(raw) : '';
  if (sem) return sem.slice(0, 3);
  const sems = Array.isArray(c?.semesters) ? c.semesters.filter(Boolean) : [];
  if (sems.length) {
    const maxBase = sems.map(s => _semKeyBase(s)).sort().pop();
    if (maxBase && maxBase.length >= 3) return maxBase.slice(0, 3);
  }
  if (c?.id && c.id.length >= 3) return c.id.slice(0, 3);
  return '000';
}

// 純函式（供測試）：計算全體個案的新 chunk 歸屬。
// isActiveFn 預設 _isHotCase；活躍個案依 id 排序、每 CHUNK_SIZE 筆一塊分入 active-01, active-02…；
// 其餘依 _lastActivityYearOf 分組後，各年內再依 id 排序、每 CHUNK_SIZE 筆一塊分入 cold-{學年}-1, cold-{學年}-2…
// 回傳 Map(caseId -> chunkName)。輸入相同順序恆得到相同結果（穩定排序），供測試斷言與重跑 idempotent。
function _rechunkAssignments(cases, isActiveFn) {
  const isActive = isActiveFn || _isHotCase;
  const activeIds = [];
  const coldByYear = new Map();
  (cases || []).forEach(c => {
    if (!c || !c.id) return;
    if (isActive(c)) { activeIds.push(c.id); return; }
    const year = _lastActivityYearOf(c);
    if (!coldByYear.has(year)) coldByYear.set(year, []);
    coldByYear.get(year).push(c.id);
  });
  const map = new Map();
  activeIds.sort();
  for (let i = 0; i < activeIds.length; i += CHUNK_SIZE) {
    const n = Math.floor(i / CHUNK_SIZE) + 1;
    const name = `active-${String(n).padStart(2, '0')}`;
    activeIds.slice(i, i + CHUNK_SIZE).forEach(id => map.set(id, name));
  }
  [...coldByYear.keys()].sort().forEach(year => {
    const ids = coldByYear.get(year).sort();
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const n = Math.floor(i / CHUNK_SIZE) + 1;
      const name = `cold-${year}-${n}`;
      ids.slice(i, i + CHUNK_SIZE).forEach(id => map.set(id, name));
    }
  });
  return map;
}

// 純函式（供測試）：統計目前各 active-NN chunk 已知筆數（key=chunk 名稱）。
function _activeChunkCounts(indexCases) {
  const counts = {};
  (indexCases || []).forEach(c => {
    const name = c?.chunk;
    if (typeof name === 'string' && name.startsWith('active-')) counts[name] = (counts[name] || 0) + 1;
  });
  return counts;
}

// 純函式（供測試）：依現有 active-NN 各自筆數，挑一個未滿 CHUNK_SIZE 的既有 chunk（依名稱排序取第一個）；
// 皆滿或尚無任何 active chunk → 配置下一號（active-01 起算）。
function _pickActiveChunkForNew(chunkCounts) {
  const names = Object.keys(chunkCounts || {}).sort();
  for (const n of names) {
    if ((chunkCounts[n] || 0) < CHUNK_SIZE) return n;
  }
  let maxN = 0;
  names.forEach(n => {
    const m = /^active-(\d+)$/.exec(n);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  });
  return `active-${String(maxN + 1).padStart(2, '0')}`;
}

// 新開案的 chunk 歸屬指派：僅在「已執行過重新分塊」時介入，寫入 _caseChunkMap；
// 尚未執行過 → 不動作，getCaseChunkName 自然落回 legacy 推導（維持現狀）。
// 呼叫時機：casesData.push(新案) 之後、saveCasesChunks 之前（每個「開新案」流程呼叫點）。
// 用全域 _casesIndexCache（而非本機 casesData）統計現有 active chunk 筆數，非管理者 scoped session 也能正確判斷
// （cases-index.json 是全域完整索引，scoped 載入的使用者也持有它，只是沒有完整 case 內容）。
function _assignChunkForNewCase(caseId) {
  if (!caseId || _caseChunkMap.has(caseId)) return;
  if (!_rechunkHasRun()) return;
  const counts = _activeChunkCounts(_casesIndexCache?.cases);
  const chunkName = _pickActiveChunkForNew(counts);
  _caseChunkMap.set(caseId, chunkName);
}

// 2026-07-24 prod 事故修補：開新案（含匯入/快速開案）重用「曾被永久刪除的案號」（墓碑，
// manifest.deletedIds）時，必須先清墓碑並回寫 manifest——否則 _chunkCommitPayload 會把同一
// id 同時放進 upserts 與 removes，後端 casesUpsert 先 upsert 再 remove，新個案「存進去馬上
// 被抹掉」且回 ok 完全無聲；索引/hot 亦因墓碑走 remove，並把 _caseChunkMap 歸屬刪掉，
// 後續儲存落回 legacy chunk 路徑報錯。與 _renameCaseId 的墓碑清除（改案號重用舊號）同一
// 精神：使用者明確以該案號建立活案＝墓碑失效。
// 呼叫時機：casesData.push(新案) 之後、saveCasesChunks 之前（每個開新案流程呼叫點）。
async function _unTombstoneNewCases(caseIds) {
  if (!Array.isArray(casesManifest?.deletedIds) || !casesManifest.deletedIds.length) return;
  const hit = new Set((caseIds || []).filter(id => id && casesManifest.deletedIds.includes(id)));
  if (!hit.size) return;
  casesManifest.deletedIds = casesManifest.deletedIds.filter(id => !hit.has(id));
  await driveSaveJsonInCases('manifest.json', casesManifest);
}

// 從 cases-index.json 的 cases 陣列重建 _caseChunkMap（載入 / 全量重建 index 後呼叫，讓 getCaseChunkName
// 立即反映最新歸屬）。缺 chunk 欄位的 entry（尚未重新分塊過的舊資料）不寫入，交由 legacy fallback 處理。
function _syncCaseChunkMapFromIndex(indexCases) {
  const map = new Map();
  (indexCases || []).forEach(c => { if (c?.id && c.chunk) map.set(c.id, c.chunk); });
  _caseChunkMap = map;
}

// 從目前 casesData 全量重建並寫入 cases-index.json（遷移／首建時用）
async function _saveCasesIndex() {
  // 🔴 紅線：只有持有全體完整資料時才可全量重建；scoped 載入（非管理者）只有自己幾筆，重建會覆蓋掉全體索引
  if (!_loadedFullDataset) { _syslog('warn', '跳過 cases-index 全量重建（scoped 載入，未持有全體資料）'); return; }
  const delSet = new Set(casesManifest?.deletedIds || []);
  const cases = casesData
    .filter(c => c?.id && !delSet.has(c.id))
    .map(_caseToIndexEntry);
  // 🔴 2026-07-08 事故防護（覆蓋率驗證）：manifest 列出的每個 chunk 都必須至少貢獻 1 筆，
  // 否則代表重建來源載入異常（chunk 檔非空卻 0 筆），寧可放棄本次重建（index 為衍生快取，
  // 舊版仍可用），也不可寫出缺整塊 chunk 的索引讓該批個案從系統消失。
  const _coveredChunks = new Set(cases.map(c => getCaseChunkName(c.id)));
  const _emptyChunks = (casesManifest?.chunks || []).filter(n => !_coveredChunks.has(n));
  if (_emptyChunks.length) {
    _syslog('error', `cases-index 重建中止：${_emptyChunks.length} 個 chunk 重建後 0 筆（${_emptyChunks.join('、')}），疑似來源載入異常，已放棄覆寫`);
    return;
  }
  _casesIndexCache = { updatedAt: new Date().toISOString(), cases };
  _syncCaseChunkMapFromIndex(cases); // Slice 3：全量重建後同步 _caseChunkMap，讓 getCaseChunkName 立即反映最新歸屬
  await driveSaveJsonInCases(CASES_INDEX_FILE, _casesIndexCache);
  _syslog('info', `cases-index 已建立：${cases.length} 筆`);
}

// 從目前 casesData 全量重建並寫入 cases-hot.json（遷移／首建時用）
// 僅收 hot 個案完整資料；_indexOnly 個案跳過（避免覆蓋）
async function _saveCasesHot() {
  // 🔴 紅線：只有持有全體完整資料時才可全量重建；scoped 載入（非管理者）重建會把全體 hot 覆蓋成只剩自己的案
  if (!_loadedFullDataset) { _syslog('warn', '跳過 cases-hot 全量重建（scoped 載入，未持有全體資料）'); return; }
  const cases = casesData
    .filter(c => c?.id && !c._indexOnly && _isHotCase(c))
    // chunk 欄位（Slice 3 歸屬記錄）只存 index，不可落地進 cases-hot（比照 _indexOnly/_fullLoaded 剝離）
    .map(c => { const { _indexOnly, _fullLoaded, chunk, ...rest } = c; return rest; });
  _casesHotCache = { updatedAt: new Date().toISOString(), cases };
  await driveSaveJsonInCases(CASES_HOT_FILE, _casesHotCache);
  _syslog('info', `cases-hot 已建立：${cases.length} 筆`);
}

// patch 指定個案的 index entry；透過 GAS casesUpsert action（LockService 保護）
// 不丟例外：index 為衍生快取，失敗僅記 log，下次完整載入會重建
async function _updateCasesIndexEntries(ids) {
  const idSet = [...new Set((ids || []).filter(Boolean))];
  if (!idSet.length) return;
  const delSet = new Set(casesManifest?.deletedIds || []);
  const upserts = [];
  const removes = [];
  idSet.forEach(id => {
    if (delSet.has(id)) { removes.push(id); return; }
    const c = casesData.find(x => x.id === id);
    // 🔴 2026-07-08 事故防護：記憶體找不到 ≠ 個案已刪除（可能只是本 session 資料不全），
    // 只有墓碑（deletedIds）才可從索引移除；找不到一律跳過。
    if (!c) { _syslog('warn', `cases-index patch：${id} 不在記憶體，跳過（不移除索引）`); return; }
    upserts.push(_caseToIndexEntry(c));
  });
  // #36 根因修補：cases-index 是「個案列表」唯一資料來源。過去此處失敗僅記 warn 就吞掉，導致
  // 個案已寫入 chunk（主資料成功）卻不在列表、使用者也沒收到任何錯誤——看似資料遺失（實則在
  // chunk／小鈴鐺備份內）。且 _selfHealMissingChunks 只補「整段 chunk 在索引 0 筆」的情況，
  // 無法救「已有其他個案的 chunk 裡單筆漏索引」，故永遠不會自動回來。改為：重試一次，仍失敗
  // 則明確提示使用者重新整理／通知管理者重建索引，絕不靜默。
  const _commitIndex = () => proxyCall('casesUpsert', { path: `cases/${CASES_INDEX_FILE}`, upserts, removes });
  try {
    await _commitIndex();
  } catch (e1) {
    _syslog('warn', `更新 cases-index 失敗，重試一次：${e1.message}`);
    try {
      await _commitIndex();
    } catch (e2) {
      _syslog('error', `更新 cases-index 失敗（已重試）：${e2.message}`);
      showToast('個案已儲存，但「個案列表索引」更新失敗；請重新整理頁面，若列表仍未顯示該個案，請通知管理者重建索引（資料本身未遺失）。', 'error', 9000);
      return;  // 索引未更新，不同步 _caseChunkMap（維持與 Drive 一致）
    }
  }
  // Slice 3：patch 成功後同步 _caseChunkMap，讓本 session 後續 getCaseChunkName 立即反映最新歸屬
  upserts.forEach(e => { if (e?.id && e.chunk) _caseChunkMap.set(e.id, e.chunk); });
  removes.forEach(id => _caseChunkMap.delete(id));
}

// patch 指定個案的 hot entry；hot 判定 true 就 upsert 完整資料，false 就 remove
// 透過 GAS casesUpsert action（LockService 保護）
async function _updateCasesHotEntries(ids) {
  const idSet = [...new Set((ids || []).filter(Boolean))];
  if (!idSet.length) return;
  const delSet = new Set(casesManifest?.deletedIds || []);
  const upserts = [];
  const removes = [];
  idSet.forEach(id => {
    if (delSet.has(id)) { removes.push(id); return; }
    const c = casesData.find(x => x.id === id);
    // 🔴 2026-07-08 事故防護：本機沒有完整資料（找不到或僅 index stub）時「跳過」而非「移除」——
    // 誤移除會讓該案下次啟動失去 hot 快路徑、且曾直接造成個案自 hot 消失（見事故紀錄）。
    if (!c) { _syslog('warn', `cases-hot patch：${id} 不在記憶體，跳過（不移除）`); return; }
    if (c._indexOnly) { _syslog('warn', `cases-hot patch：${id} 僅索引資料，跳過（不上傳、不移除）`); return; }
    if (_isHotCase(c)) {
      // chunk 欄位（Slice 3 歸屬記錄）只存 index，不可落地進 cases-hot（比照 _indexOnly/_fullLoaded 剝離）
      const { _indexOnly, _fullLoaded, chunk, ...rest } = c;
      upserts.push(rest);
    } else {
      removes.push(id); // 有完整資料且判定非 hot（結案/封存/非本學期）→ 移除合理
    }
  });
  // #36：hot 更新失敗不會讓個案自列表消失（列表看 index），但會拖慢下次啟動的快路徑；重試一次提高可靠度。
  const _commitHot = () => proxyCall('casesUpsert', { path: `cases/${CASES_HOT_FILE}`, upserts, removes });
  try {
    await _commitHot();
  } catch (e1) {
    _syslog('warn', `更新 cases-hot 失敗，重試一次：${e1.message}`);
    try {
      await _commitHot();
    } catch (e2) {
      _syslog('error', `更新 cases-hot 失敗（已重試）：${e2.message}`);
    }
  }
}

// 索引自我修復：manifest 列出的 chunk 在索引中一筆都沒有 → 從 chunk 檔把個案補回索引（與 hot）。
// 對應 2026-07-08 事故：index 全量重建時單一 chunk 載入異常，該 chunk 20 筆個案自索引整批消失
// （chunk 原始資料完好）。僅在持有全體資料的 session（主任/管理者）執行，patch 走 casesUpsert（有鎖）。
async function _selfHealMissingChunks() {
  if (!_loadedFullDataset) return;
  const chunks = casesManifest?.chunks || [];
  if (!chunks.length) return;
  const delSet = new Set(casesManifest?.deletedIds || []);
  const covered = new Set(casesData.filter(c => c?.id).map(c => getCaseChunkName(c.id)));
  const missing = chunks.filter(n => !covered.has(n));
  if (!missing.length) return;
  _syslog('warn', `索引自我修復：${missing.length} 個 chunk 在索引中 0 筆，嘗試從 chunk 檔補回（${missing.join('、')}）`);
  let healedTotal = 0;
  for (const name of missing) {
    let data = null;
    try { data = await driveReadJson(`cases/${name}.json`); }
    catch (e) { _syslog('error', `自我修復讀取 ${name} 失敗：${e.message}`); continue; }
    const restore = (data?.cases || []).filter(c => c?.id && !delSet.has(c.id) && !casesData.some(x => x.id === c.id));
    if (!restore.length) { _syslog('info', `自我修復：${name} 無可補回個案（chunk 為空或全數為墓碑）`); continue; }
    restore.forEach(c => casesData.push({ ...c, _fullLoaded: !c._indexOnly, _indexOnly: !!c._indexOnly }));
    const ids = restore.map(c => c.id);
    // Slice 3：補回的個案來自「已知 chunk 名稱 name」，直接記錄歸屬，讓補回的 index entry 帶正確 chunk 欄位
    // （這些案子原本就不在 index 裡，getCaseChunkName 對它們沒有 legacy 依據可言，此處是唯一可靠的來源）
    ids.forEach(id => _caseChunkMap.set(id, name));
    await _updateCasesIndexEntries(ids);
    await _updateCasesHotEntries(ids);
    healedTotal += ids.length;
    auditLog('系統自動修復個案索引', null, null, `${name}：補回 ${ids.length} 筆索引`, { major: true });
    _syslog('info', `自我修復完成：${name} 補回 ${ids.length} 筆`);
  }
  if (healedTotal) {
    renderCases();
    showToast(`已自動修復個案索引：補回 ${healedTotal} 筆個案`, 'success', 8000);
  }
}

// 舊 index（無 interviewerEmails 欄位）遷移：由管理者登入時偵測並一次性重建
// 僅限管理者執行（需全體完整資料），非管理者不觸發以免破壞資料最小化
async function _maybeRebuildIndexForInterviewers() {
  const isPriv = currentRole === '主任' || extraRole === '管理者';
  if (!isPriv) return;
  const cases = _casesIndexCache?.cases || [];
  if (!cases.length) return;
  if (cases.every(c => 'interviewerEmails' in c && 'hasPsyEval' in c)) return; // 已是新版 index
  _syslog('info', '偵測到舊 index 缺 interviewerEmails/hasPsyEval，管理者背景重建中…');
  try {
    await _ensureAllFullyLoaded('重建索引（補初次晤談者/精神科評估欄位）');
    _loadedFullDataset = true; // 已補齊全體完整資料
    await _saveCasesIndex();
    await _saveCasesHot();
    _syslog('info', 'index/hot 已重建（含 interviewerEmails + hasPsyEval）');
  } catch (e) { _syslog('warn', `重建 index 失敗：${e.message}`); }
}

// 進入重度分析頁時 bulk load 所有 cold cases 補回完整資料
// 首次呼叫顯示 loading + toast；同一 session 再呼叫直接放行
async function _ensureAllFullyLoaded(reason) {
  if (_bulkLoadedAllOnce) return;
  const coldIds = casesData.filter(c => c?.id && c._indexOnly && !c._fullLoaded).map(c => c.id);
  if (!coldIds.length) { _bulkLoadedAllOnce = true; return; }
  showLoading(`${reason || '分析頁載入中'}：補載入 ${coldIds.length} 筆封存/舊學期個案…`);
  try {
    await _ensureFullCases(coldIds);
    _bulkLoadedAllOnce = true;
    showToast(`已載入 ${coldIds.length} 筆歷史個案完整資料，本次工作階段不再重載`, 'success');
  } finally {
    hideLoading();
  }
}

// 確保給定的 caseIds 都是 _fullLoaded；cold case 先從 IndexedDB／Drive 補回完整資料
// 保護 saveCasesChunks／_batchWriteChunks 不會用 _indexOnly 覆蓋 Drive 完整內容（records/attachments 等）
// 合併語意：僅補上 c 未持有的欄位，呼叫者已修改的欄位（如 archived）不被覆蓋
async function _ensureFullCases(caseIds) {
  const ids = [...new Set((caseIds || []).filter(Boolean))];
  const needLoad = ids
    .map(id => casesData.find(x => x.id === id))
    .filter(c => c && c._indexOnly && !c._fullLoaded);
  if (!needLoad.length) return;
  const byChunk = new Map();
  needLoad.forEach(c => {
    const name = getCaseChunkName(c.id);
    if (!byChunk.has(name)) byChunk.set(name, []);
    byChunk.get(name).push(c);
  });
  await Promise.all([...byChunk.entries()].map(async ([chunkName, cases]) => {
    let data = await _ckLoadAny(chunkName).catch(() => null);
    if (!data) {
      try {
        data = await driveReadJson(`cases/${chunkName}.json`);
        if (data) _ckSave(chunkName, data, '');
      } catch (e) {
        // 🔴 2026-07-08 事故防護：讀取失敗絕不可標記 _fullLoaded（假完整），否則後續儲存會用
        // index 摘要 stub 覆寫 Drive 上的完整個案（晤談紀錄等全數消失）。改為 fail-closed 中止操作。
        _syslog('error', `_ensureFullCases 讀取 ${chunkName} 失敗：${e.message}`);
        throw new Error(`個案完整資料暫時無法載入（${chunkName}），已中止本次儲存以避免資料被覆寫，請稍候重試`);
      }
    }
    const byId = new Map((data?.cases || []).map(x => [x.id, x]));
    cases.forEach(c => {
      const full = byId.get(c.id);
      if (full) {
        for (const k of Object.keys(full)) if (!(k in c)) c[k] = full[k];
        c._fullLoaded = true;
        c._indexOnly = false;
      } else {
        c._fullLoaded = true;
      }
    });
  }));
}

// 計算 hot chunks：含有「未封存且未刪除」個案的 chunk 名單（與 manifest 取交集）
function _getHotChunks(indexData, manifest, deletedSet) {
  const manifestChunks = manifest?.chunks || [];
  const manifestSet = new Set(manifestChunks);
  // 個案架構重構 Slice 3：已重新分塊時，chunk 命名本身就是 hot/cold 判定（active-* 恆為 hot，
  // cold-* 恆不是），不需逐案掃描——這正是本次重構要解決的問題：舊制下 cold chunk 常混有大量
  // 「未封存但非本學期」的舊案，導致下面逐案掃描把幾乎每個 chunk 都判成 hot（實測 66/109 壓不下來）。
  if (manifestChunks.some(n => typeof n === 'string' && n.startsWith('active-'))) {
    return manifestChunks.filter(n => typeof n === 'string' && n.startsWith('active-'));
  }
  const hot = new Set();
  (indexData?.cases || []).forEach(c => {
    if (!c?.id || c.archived || c.deleted) return;
    if (deletedSet && deletedSet.has(c.id)) return;
    const name = getCaseChunkName(c.id);
    if (manifestSet.has(name)) hot.add(name);
  });
  return [...hot];
}

// 非管理者 scoped 載入：只算「我可見的非封存個案」所在 chunk（主責/個管/初次晤談者/未派案）
// 封存與他人案不納入 → 敏感晤談紀錄不進入無權者的瀏覽器
function _getMyChunks(indexData, manifest, deletedSet, email, allowedSet) {
  const manifestSet = new Set(manifest?.chunks || []);
  const mine = new Set();
  (indexData?.cases || []).forEach(c => {
    if (!c?.id || c.archived || c.deleted) return;
    if (deletedSet && deletedSet.has(c.id)) return;
    if (!_caseVisibleToUser(c, email, allowedSet) && !_hasCrisisGrant(c.id)) return;
    const name = getCaseChunkName(c.id);
    if (manifestSet.has(name)) mine.add(name);
  });
  return [...mine];
}

// 載入指定 chunk 名單，回傳去重後的 case 陣列（含 IndexedDB 快取、分批、重試、chunk bar）
async function _fetchCasesChunks(loadOrder, fileMap, fileTimesMap, deletedSet, opts = {}) {
  const { progressBase = 60, progressSpan = 30, onCached = null } = opts;
  if (!loadOrder.length) { _clbDone?.(); return []; }
  const LOAD_BATCH = 5;
  const totalChunks = loadOrder.length;

  const _resolveChunk = chunk => {
    const fullFile = `${chunk}.json`;
    const leaf = chunk.split('/').pop() + '.json';
    const yearPfx = chunk.slice(0, 3);
    let fid = fileMap?.get(fullFile);
    let modTime = fileTimesMap?.get(fullFile) || '';
    if (!fid && !chunk.includes('/')) {
      const alt = `${yearPfx}/${fullFile}`;
      fid = fileMap?.get(alt);
      if (fid) modTime = fileTimesMap?.get(alt) || modTime;
    }
    if (!fid && chunk.includes('/')) {
      fid = fileMap?.get(leaf);
      if (fid) modTime = fileTimesMap?.get(leaf) || modTime;
    }
    return { fid, drivePathFile: `cases/${fullFile}`, modTime };
  };

  _clbInit(loadOrder);
  const ckMeta = await _ckMetaRead();
  const _resolvedChunks = loadOrder.map(chunk => ({ chunk, ..._resolveChunk(chunk) }));
  const _cacheChecks = await Promise.all(_resolvedChunks.map(async ({ chunk, fid, drivePathFile, modTime }) => ({
    chunk, fid, drivePathFile, modTime, cached: await _ckLoad(chunk, ckMeta, modTime)
  })));
  const cachedResults = [];
  const toFetch = [];
  for (const { chunk, cached, fid, drivePathFile, modTime } of _cacheChecks) {
    if (cached) {
      _clbSetState(chunk, 'cached', (cached.cases || []).length);
      cachedResults.push({ chunk, data: cached });
    } else {
      toFetch.push({ chunk, fid, drivePathFile, modTime });
    }
  }
  if (cachedResults.length > 0 && onCached) {
    onCached(cachedResults.flatMap(r => r.data.cases || []));
  }

  const fetchedResults = [];
  const failedChunks = [];
  for (let i = 0; i < toFetch.length; i += LOAD_BATCH) {
    const batch = toFetch.slice(i, i + LOAD_BATCH);
    batch.forEach(({ chunk }) => _clbSetState(chunk, 'loading'));
    const batchResults = await Promise.all(batch.map(async ({ chunk, fid, drivePathFile, modTime }) => {
      try {
        const data = await (fid ? driveReadJsonById(fid) : driveReadJson(drivePathFile));
        _ckSave(chunk, data, modTime);
        _clbSetState(chunk, 'ok', (data.cases || []).length);
        return { chunk, data, ok: true };
      } catch (e) {
        console.warn('[_fetchCasesChunks] chunk 載入失敗:', chunk, e.message);
        failedChunks.push({ chunk, fid, drivePathFile, modTime });
        _clbSetState(chunk, 'fail');
        const fallback = await _ckLoadAny(chunk);
        return { chunk, data: fallback || { cases: [] }, ok: false };
      }
    }));
    fetchedResults.push(...batchResults);
    const _loaded = cachedResults.length + Math.min(i + LOAD_BATCH, toFetch.length);
    _setCasesLoadingProgress(progressBase + Math.round(progressSpan * _loaded / totalChunks),
      `載入中（${_loaded}/${totalChunks}）`);
  }

  if (failedChunks.length > 0) {
    _syslog('warn', `${failedChunks.length} 個 chunks 載入失敗，1 秒後重試`);
    _showRetryNotice(`⟳ ${failedChunks.length} 份個案資料載入失敗，1 秒後自動重試…`);
    await new Promise(r => setTimeout(r, 1000));
    await Promise.all(failedChunks.map(async ({ chunk, fid, drivePathFile, modTime }) => {
      _clbSetState(chunk, 'retry');
      try {
        const data = await (fid ? driveReadJsonById(fid) : driveReadJson(drivePathFile));
        _ckSave(chunk, data, modTime);
        const idx = fetchedResults.findIndex(r => r.chunk === chunk);
        if (idx >= 0) fetchedResults[idx] = { chunk, data, ok: true };
        _clbSetState(chunk, 'ok', (data.cases || []).length);
        _syslog('info', `chunk ${chunk} 重試成功`);
      } catch (e) {
        _clbSetState(chunk, 'fail');
        _syslog('warn', `chunk ${chunk} 重試失敗：${e.message}`);
      }
    }));
    const stillFailed = fetchedResults.filter(r => !r.ok).length;
    if (stillFailed > 0) _showRetryNotice(`⚠ ${stillFailed} 份個案資料重試後仍載入失敗，畫面可能不完整，請重新整理頁面`);
    else _hideRetryNotice();
  }
  _clbDone();

  const allResults = [...cachedResults.map(r => r.data), ...fetchedResults.map(r => r.data)];
  const seen = new Set();
  const out = [];
  allResults.flatMap(r => r.cases || []).forEach(c => {
    if (!c?.id || deletedSet.has(c.id) || seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  });
  return out;
}

// 純函式（供測試）：算出單一 chunk 要送給後端 casesUpsert 的 { upserts, removes }。
// modifiedIds／removeIds／deletedIds 為未過濾的完整清單，函式內部依 getChunkName(id) 分流到本 chunk；
// getCase(id) 由呼叫端注入（記憶體 casesData 查找）。
// 🔴 2026-07-08 事故防護：index 摘要 stub（_indexOnly）絕不可進 upserts——代表完整資料未載入，
// 直接拋錯中止整批儲存（呼叫端應已先跑過 _ensureFullCases，此處是最後一道防線）。
function _chunkCommitPayload(chunkName, modifiedIds, removeIds, deletedIds, getCase, getChunkName) {
  const upserts = [];
  (modifiedIds || []).forEach(id => {
    if (getChunkName(id) !== chunkName) return;
    const c = getCase(id);
    if (!c) return; // 理論上不會發生：modifiedIds 來自呼叫端傳入的 caseIds，應存在於記憶體
    if (c._indexOnly) throw new Error(`個案 ${id} 完整資料未載入，已中止儲存以避免覆寫 Drive 上的完整資料`);
    // chunk 欄位（Slice 3 歸屬記錄）只存 index，不可落地進 chunk 檔本體（比照 _indexOnly/_fullLoaded 剝離）
    const { _indexOnly, _fullLoaded, chunk, ...clean } = c;
    upserts.push(clean);
  });
  const removes = [...new Set([
    ...(removeIds || []).filter(id => getChunkName(id) === chunkName),
    ...(deletedIds || []).filter(id => getChunkName(id) === chunkName),
  ])];
  // 🔴 2026-07-24 事故防護：同一 id 同時在 upserts 與 removes ＝ 這筆「活案」的案號還掛著
  // 墓碑（deletedIds）。後端 casesUpsert 先 upsert 再 remove，照送等於把剛存進去的個案馬上
  // 抹掉且回 ok（無聲資料遺失）。fail-closed 丟錯：開新案流程應先走 _unTombstoneNewCases；
  // 若是其他 session 正在儲存一個已被永久刪除的個案，也應收到明確錯誤而非無聲吞沒。
  const upsertIds = new Set(upserts.map(c => c.id));
  const clash = removes.find(id => upsertIds.has(id));
  if (clash) throw new Error(`個案 ${clash} 的案號在「已永久刪除」清單（墓碑）中，已中止儲存以避免資料無聲消失；若要以此案號開新案，請重新整理頁面後再試一次`);
  return { upserts, removes };
}

async function saveCasesChunks(...args) {
  // 最後一個參數若為 function，視為 onProgress(done, total) callback
  let onProgress = null;
  if (args.length && typeof args[args.length - 1] === 'function') onProgress = args.pop();
  // 最後一個參數若為（非陣列）物件，視為 opts：{ removeIds }——供改案號／合併遷移明確移除舊 id 的殘留紀錄
  // （已知缺陷修復：舊版改案號跨 chunk 時，driveMap 保留 Drive 上的舊紀錄、casesData 已無此 id 無從覆蓋，
  //  導致舊 id 在舊 chunk 復活；改由呼叫端明確傳入 removeIds 來刪除）
  let removeIds = [];
  if (args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])) {
    removeIds = args.pop().removeIds || [];
  }
  const caseIds = args.filter(Boolean);
  const removeSet = new Set(removeIds.filter(Boolean));
  // 保護：cold case 寫入前補回完整資料，避免 _indexOnly 覆蓋 Drive（records/attachments 等）
  await _ensureFullCases(caseIds);
  const chunkNames = [...new Set([...caseIds.map(getCaseChunkName), ...[...removeSet].map(getCaseChunkName)])];
  const modifiedIds = new Set(caseIds);
  let manifestChanged = false;
  for (const name of chunkNames) {
    if (!casesManifest.chunks.includes(name)) {
      casesManifest.chunks.push(name);
      casesManifest.chunks.sort();
      manifestChanged = true;
    }
  }
  if (manifestChanged) await driveSaveJsonInCases('manifest.json', casesManifest);
  // 寫入前 patch lastActivityAt（衍生欄位）
  caseIds.forEach(id => {
    const c = casesData.find(x => x.id === id);
    if (c) c.lastActivityAt = _computeLastActivityAt(c);
  });
  let done = 0;
  // 逐批處理（每批 3 個），避免並發過多導致 Apps Script CORS/rate-limit 錯誤
  const BATCH = 3;
  const _getCase = id => casesData.find(x => x.id === id);
  // 2026-07-09：改走後端鎖內 upsert（casesUpsert_，LockService 保護），關閉「前端讀 Drive 最新版→
  // 記憶體合併→整檔覆寫」這段 1~3 秒視窗內兩人同時存同一 chunk 不同個案會互蓋的最後漏洞。
  // fail-closed：casesUpsert_ 讀取失敗／內容異常一律中止，此處失敗直接往上拋，不得退回舊整檔覆寫
  // （那會繞過 fail-closed 保護）。舊版「先讀 Drive 最新版→driveMap 合併→整檔覆寫」的程式碼已移除，
  // 可於 git 歷史查閱（v155 之前）。
  // 語義差異（刻意）：舊版整檔覆寫時，除了本次修改的個案，還會順便把「記憶體有、Drive 沒有」的個案
  // 一併補寫（涵蓋先前寫入失敗造成 Drive 缺漏的罕見情況）；改走 upsert 後只送 modifiedIds（本次真正
  // 被修改的個案），不再順便補寫其餘個案——如需補回 Drive 缺漏，另外觸發該筆個案的儲存（例如重新
  // 編輯後存檔）或走 _selfHealMissingChunks／管理者重建。
  for (let i = 0; i < chunkNames.length; i += BATCH) {
    await Promise.all(chunkNames.slice(i, i + BATCH).map(async name => {
      const { upserts, removes } = _chunkCommitPayload(
        name, [...modifiedIds], [...removeSet], casesManifest.deletedIds || [], _getCase, getCaseChunkName
      );
      if (upserts.length || removes.length) {
        await proxyCall('casesUpsert', { path: `cases/${name}.json`, upserts: upserts.map(_deepClone), removes });
      }
      done++;
      if (onProgress) onProgress(done, chunkNames.length);
    }));
  }
  // 同步輕量索引與 hot 集合（衍生檔，失敗不影響主寫入）；removeIds 在 casesData 已查無對應 record，
  // _updateCasesIndexEntries／_updateCasesHotEntries 會自動判定為 remove
  await _updateCasesIndexEntries([...caseIds, ...removeSet]);
  await _updateCasesHotEntries([...caseIds, ...removeSet]);
}

// 一學生一案號 Slice 2：安全的案號改名共用 helper（editCaseNum／主號對調 _swapMainCaseId 共用）。
// 支援兩種呼叫時機：呼叫前 c.id 仍是 oldId（一般改名），或呼叫前 c.id 已被改成 newId（_swapFormerId 已先改好，見該函式）。
async function _renameCaseId(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  let idx = casesData.findIndex(x => x.id === newId);
  if (idx === -1) {
    idx = casesData.findIndex(x => x.id === oldId);
    if (idx === -1) throw new Error(`找不到案號：${oldId}`);
    casesData[idx].id = newId;
  }
  casesData[idx].updatedAt = new Date().toISOString();
  // remap configData.users[*].allowedCases / allowedCasesSems
  let cfgChanged = false;
  Object.values(configData?.users || {}).forEach(info => {
    if (!info) return;
    if (Array.isArray(info.allowedCases) && info.allowedCases.includes(oldId)) {
      info.allowedCases = [...new Set(info.allowedCases.map(id => id === oldId ? newId : id))];
      cfgChanged = true;
    }
    if (info.allowedCasesSems?.[oldId]) {
      const sems = info.allowedCasesSems[oldId];
      delete info.allowedCasesSems[oldId];
      info.allowedCasesSems[newId] = [...new Set([...(info.allowedCasesSems[newId] || []), ...sems])];
      cfgChanged = true;
    }
  });
  // remap transferData[].caseId
  let transferChanged = false;
  (transferData || []).forEach(t => { if (t.caseId === oldId) { t.caseId = newId; transferChanged = true; } });
  // newId 若先前是墓碑（曾永久刪除）→ 清除，避免復活後仍被視為已刪除
  if (Array.isArray(casesManifest?.deletedIds) && casesManifest.deletedIds.includes(newId)) {
    casesManifest.deletedIds = casesManifest.deletedIds.filter(id => id !== newId);
  }
  // Slice 3：若 oldId 已有重新分塊後的權威歸屬，newId 就地沿用同一 chunk（純改名，資料不搬家）——
  // 絕不可讓 newId 落回 legacy 推導（可能算出一個 manifest 早已不再列出的舊式 chunk 名稱，
  // 誤把該 legacy chunk 檔重新掛回 manifest）。oldId 暫留同一筆對照，讓 saveCasesChunks 內
  // getCaseChunkName(oldId)（用於 removeIds 分流）也解析到同一個檔案；呼叫結束後才清除 oldId。
  const _renameChunk = _caseChunkMap.has(oldId) ? _caseChunkMap.get(oldId) : null;
  if (_renameChunk) _caseChunkMap.set(newId, _renameChunk);
  await saveCasesChunks(newId, { removeIds: [oldId] });
  if (_renameChunk) _caseChunkMap.delete(oldId);
  // v164：改走 configCasesPatch 的 caseIdRemap op（後端鎖內對「當下最新」config 做 oldId→newId
  // remap，不受「呼叫端這份 configData 快照可能已過期」影響），取代整檔覆寫 config.json
  // （非管理者呼叫此路徑時，整檔寫入已被後端全面 deny，必須改走此通道；管理者呼叫也一併受益於
  // 鎖內合併，不再有「讀到寫之間別人異動被蓋回」風險）。
  if (cfgChanged) {
    try {
      await _configCasesPatch([{ type: 'caseIdRemap', fromId: oldId, toId: newId }]);
    } catch (e) {
      alert(`案號改名：個案管理員授權範圍同步失敗（${e.message}），案號本身與資料已改名成功，請重新整理頁面確認個案管理員名單是否正確，必要時手動於個案詳細頁調整。`);
    }
  }
  if (transferChanged) await saveTransfer();
}

// 一學生一案號 Slice 2：主號↔曾用號對調（僅代表號互換，資料不動）。
async function _swapMainCaseId(caseId, formerId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) throw new Error('找不到個案');
  const { oldId, newId } = _swapFormerId(c, formerId);
  await _renameCaseId(oldId, newId);
  auditLog('主案號對調', newId, null, `由 ${oldId} 對調為 ${newId}`);
}

// 個案架構重構 Slice 3：算出全量重建時每個個案的新 chunk 名稱（Map caseId -> chunkName）。
// scheme='legacy' → 現行案號推導公式（getCaseChunkName；重新分塊前 _caseChunkMap 為空，等同純公式，行為不變）；
// scheme='active-cold' → _rechunkAssignments（活躍集中 active-NN／其餘依最後活動學年歸檔 cold-{學年}-N）。
function _fullRebuildAssignments(cases, scheme) {
  if (scheme === 'active-cold') return _rechunkAssignments(cases, _isHotCase);
  const map = new Map();
  (cases || []).forEach(c => { if (c?.id) map.set(c.id, getCaseChunkName(c.id)); });
  return map;
}

// 共用「計算歸屬＋寫入 chunk 檔＋更新 manifest」核心，供 migrateToChunks（合併遷移引擎尾端／首次升級資料
// 結構等既有呼叫點）與管理者手動「重新分塊」（_manualRechunk）共用——沿用原本 migrateToChunks 既有的
// 分批寫入順序（這條路徑經過實戰）。
// fail-closed：任一批 chunk 寫入失敗，Promise.all 直接向上拋出例外中止，尚未寫入的批次不會執行，
// casesManifest／_caseChunkMap 也都還沒被本次結果覆寫——中止當下系統仍讀舊 manifest.chunks，沿用既有 chunk 檔。
async function _rebuildChunksCore(scheme) {
  const assignMap = _fullRebuildAssignments(casesData.filter(c => c?.id), scheme);
  const chunkMap = {};
  casesData.forEach(c => {
    if (!c.id) return;
    const chunkName = assignMap.get(c.id) || getCaseChunkName(c.id);
    if (!chunkMap[chunkName]) chunkMap[chunkName] = [];
    // chunk 欄位（Slice 3 歸屬記錄）只存 index，不可落地進 chunk 檔本體（case 物件可能因從 index entry 展開而帶有）
    const { chunk, ...cleanC } = c;
    chunkMap[chunkName].push(cleanC);
  });
  const chunks = Object.keys(chunkMap).sort();
  // 逐批儲存（每批 3 個），避免並發過多導致 Apps Script CORS/rate-limit 錯誤
  const BATCH = 3;
  for (let i = 0; i < chunks.length; i += BATCH) {
    await Promise.all(chunks.slice(i, i + BATCH).map(name =>
      driveSaveJsonInCases(`${name}.json`, { cases: chunkMap[name] })
    ));
  }
  // 全部 chunk 寫入成功才更新歸屬與 manifest（上面任一批失敗會直接拋出，不會執行到這裡）
  assignMap.forEach((name, id) => _caseChunkMap.set(id, name));
  // 保留既有墓碑（避免被遺忘的永久刪除復活）
  const prevDeletedIds = Array.isArray(casesManifest?.deletedIds) ? casesManifest.deletedIds : [];
  casesManifest = { chunks, deletedIds: prevDeletedIds };
  await driveSaveJsonInCases('manifest.json', casesManifest);
  return { chunks, scheme };
}

// 全量重建 chunk 檔＋manifest。不帶 opts 時自動偵測現行 scheme：已執行過重新分塊（manifest.chunks
// 有 active- 開頭項）→ 'active-cold'，否則 → 'legacy'——與重新分塊功能上線前完全相同行為，
// 既有呼叫點（合併遷移引擎尾端、首次升級資料結構等）不需個別修改即自動沿用現行 scheme。
// opts.scheme 可強制指定 'active-cold'，供管理者「重新分塊」操作使用（見 _manualRechunk）。
async function migrateToChunks(opts) {
  const scheme = (opts && opts.scheme) || (_rechunkHasRun() ? 'active-cold' : 'legacy');
  return _rebuildChunksCore(scheme);
}

async function driveFindFile(path) {
  const parts = path.split('/');
  // 從固定的 scc-infosys 資料夾開始，不再從 root 搜尋
  let parentId = DRIVE_FOLDER_ID;

  // 逐層找子資料夾
  for (let i = 0; i < parts.length - 1; i++) {
    const folderName = parts[i];
    const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' ` +
              `and '${parentId}' in parents and trashed=false`;
    const res = await driveQuery(q, 'id');
    if (!res.files || !res.files.length) throw new Error(`找不到 Drive 資料夾：${folderName}`);
    parentId = res.files[0].id;
  }

  // 找檔案
  const fileName = parts[parts.length - 1];
  const q = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
  const res = await driveQuery(q, 'id');
  if (!res.files || !res.files.length) throw new Error(`找不到 Drive 檔案：${path}`);
  return res.files[0].id;
}

async function driveQuery(q, fields = 'id,name') {
  return proxyCall('query', { q, fields });
}

async function driveReadJson(path) {
  return proxyCall('readJson', { path });
}

// 選用型資料檔（feed/快取類，首次使用前不存在屬正常）：靜默讀取，
// 不存在或讀取失敗一律回 null，不寫入系統錯誤紀錄（避免回報 modal 出現「未預期的錯誤」噪音）
async function driveReadJsonOptional(path) {
  try { return await proxyCall('readJson', { path }, true); }
  catch { return null; }
}

async function driveReadJsonById(fileId) {
  return proxyCall('readJsonById', { fileId });
}

let _casesFolderIdCache = null;
async function getCasesFolderFileMap() {
  // 使用 listDir（Apps Script 路徑解析）確保從正確的 ROOT_FOLDER_ID 下找 cases 資料夾
  // getCasesFolderId() 以前端 DRIVE_FOLDER_ID 為根，在 dev 環境與 Apps Script 根不一致時會找到錯誤資料夾
  const r = await proxyCall('listDir', { path: 'cases', fields: 'id,name,mimeType,modifiedTime', pageSize: 400 });
  const map = new Map();
  const fileTimes = new Map();
  const subfolders = [];
  (r.files || []).forEach(f => {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      subfolders.push(f);
      if (!_yearFolderIdCache.has(f.name)) _yearFolderIdCache.set(f.name, f.id);
    } else {
      const t = f.modifiedTime || '';
      if (!map.has(f.name) || (fileTimes.get(f.name) || '') < t) {
        map.set(f.name, f.id); fileTimes.set(f.name, t);
      }
    }
  });
  // 年份子資料夾逐批列表（每批 3 個），避免並發過多觸發 rate-limit；單個失敗不影響其他
  const SUB_BATCH = 3;
  for (let i = 0; i < subfolders.length; i += SUB_BATCH) {
    await Promise.all(subfolders.slice(i, i + SUB_BATCH).map(async sub => {
      try {
        const subRes = await proxyCall('listFolder', { folderId: sub.id, fields: 'id,name,modifiedTime', pageSize: 400 });
        (subRes.files || []).forEach(f => {
          const key = `${sub.name}/${f.name}`;
          const t = f.modifiedTime || '';
          if (!map.has(key) || (fileTimes.get(key) || '') < t) {
            map.set(key, f.id); fileTimes.set(key, t);
          }
        });
      } catch (e) {
        console.warn('[getCasesFolderFileMap] 子資料夾列表失敗:', sub.name, e.message);
      }
    }));
  }
  return { map, fileTimes };
}

async function driveCreateFolder(name, parentId) {
  return proxyCall('createFolder', { name, parentId });
}

async function driveCreateJsonFile(name, content, parentId) {
  return proxyCall('createJson', { name, content, parentId });
}

async function driveUpdateJsonFile(path, content) {
  return proxyCall('updateJson', { path, content });
}

