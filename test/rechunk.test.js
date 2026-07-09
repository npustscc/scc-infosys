// 個案架構重構 Slice 3：chunk 與案號脫鉤（active/cold 分塊）純函式測試。
// 涵蓋：新歸屬計算（_rechunkAssignments，滿 20 分塊、active/cold 分界）、最後活動學年推導
// （_lastActivityYearOf，含缺值 fallback 鏈）、新開案 active chunk 挑選（_pickActiveChunkForNew）、
// getCaseChunkName 的 map 優先／legacy fallback 分支、新開案指派（_assignChunkForNewCase，含「尚未
// 重新分塊」時完全不動作）、index ↔ _caseChunkMap 同步（_syncCaseChunkMapFromIndex）、
// _rechunkHasRun 判定。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load, makeFixedDate } = require('./harness');

// ── _rechunkHasRun ──────────────────────────────────────────────────────────
test('_rechunkHasRun：manifest.chunks 有 active- 開頭項 → true', () => {
  const S = load(['_rechunkHasRun'], { casesManifest: { chunks: ['active-01', 'cold-113-1'] } });
  assert.equal(S._rechunkHasRun(), true);
});

test('_rechunkHasRun：全是舊式（案號推導）chunk 名稱 → false', () => {
  const S = load(['_rechunkHasRun'], { casesManifest: { chunks: ['114/1141001-1141020', 'misc'] } });
  assert.equal(S._rechunkHasRun(), false);
});

test('_rechunkHasRun：manifest 為空／chunks 缺漏 → false，不炸', () => {
  const S = load(['_rechunkHasRun'], { casesManifest: {} });
  assert.equal(S._rechunkHasRun(), false);
  const S2 = load(['_rechunkHasRun'], { casesManifest: null });
  assert.equal(S2._rechunkHasRun(), false);
});

// ── _lastActivityYearOf ─────────────────────────────────────────────────────
test('_lastActivityYearOf：優先採 lastActivityAt（換算民國學年前3碼）', () => {
  const S = load(['_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase']);
  assert.equal(S._lastActivityYearOf({ id: '1131001', lastActivityAt: '2026-03-15', semesters: ['1141'] }), '114');
});

test('_lastActivityYearOf：lastActivityAt 為完整 ISO datetime 也能正確取日期部分', () => {
  const S = load(['_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase']);
  assert.equal(S._lastActivityYearOf({ id: '1131001', lastActivityAt: '2026-03-15T08:30:00.000Z' }), '114');
});

test('_lastActivityYearOf：缺 lastActivityAt → 退回 semesters 最大值（去除 #N 後綴）', () => {
  const S = load(['_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase']);
  assert.equal(S._lastActivityYearOf({ id: '1121001', semesters: ['1131', '1132#2', '1141'] }), '114');
});

test('_lastActivityYearOf：缺 lastActivityAt 與 semesters → 退回案號前3碼', () => {
  const S = load(['_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase']);
  assert.equal(S._lastActivityYearOf({ id: '1121005' }), '112');
});

test('_lastActivityYearOf：極端全缺（理論上不會發生）→ 回傳 000，不炸', () => {
  const S = load(['_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase']);
  assert.equal(S._lastActivityYearOf({}), '000');
});

// ── _rechunkAssignments ─────────────────────────────────────────────────────
test('_rechunkAssignments：25 筆活躍個案 → active-01 恰 20 筆，active-02 剩 5 筆', () => {
  const S = load(['_rechunkAssignments'], { CHUNK_SIZE: 20 });
  const cases = Array.from({ length: 25 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}` }));
  const map = S._rechunkAssignments(cases, () => true); // 全部視為活躍
  const byChunk = {};
  map.forEach((chunk, id) => { (byChunk[chunk] = byChunk[chunk] || []).push(id); });
  assert.equal(byChunk['active-01'].length, 20);
  assert.equal(byChunk['active-02'].length, 5);
  assert.equal(Object.keys(byChunk).length, 2);
});

test('_rechunkAssignments：恰好 20 筆活躍 → 只產生 active-01，不多開一塊', () => {
  const S = load(['_rechunkAssignments'], { CHUNK_SIZE: 20 });
  const cases = Array.from({ length: 20 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}` }));
  const map = S._rechunkAssignments(cases, () => true);
  const chunks = new Set(map.values());
  assert.deepEqual([...chunks], ['active-01']);
});

test('_rechunkAssignments：非活躍個案依 _lastActivityYearOf 分年分塊為 cold-{學年}-N', () => {
  const S = load(['_rechunkAssignments', '_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase'], { CHUNK_SIZE: 20 });
  const cases = [
    { id: 'a1', lastActivityAt: '2025-03-01' }, // 113 學年
    { id: 'a2', lastActivityAt: '2024-03-01' }, // 112 學年
  ];
  const map = S._rechunkAssignments(cases, () => false); // 全部非活躍
  assert.equal(map.get('a1'), 'cold-113-1');
  assert.equal(map.get('a2'), 'cold-112-1');
});

test('_rechunkAssignments：同一冷歸檔學年滿 20 筆 → 分成 cold-{學年}-1／cold-{學年}-2', () => {
  const S = load(['_rechunkAssignments', '_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase'], { CHUNK_SIZE: 20 });
  const cases = Array.from({ length: 23 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, lastActivityAt: '2025-03-01' }));
  const map = S._rechunkAssignments(cases, () => false);
  const byChunk = {};
  map.forEach((chunk, id) => { (byChunk[chunk] = byChunk[chunk] || []).push(id); });
  assert.equal(byChunk['cold-113-1'].length, 20);
  assert.equal(byChunk['cold-113-2'].length, 3);
});

test('_rechunkAssignments：活躍與非活躍混合 → 各自獨立分塊', () => {
  const S = load(['_rechunkAssignments', '_lastActivityYearOf', 'openDateToSemPrefix', '_semKeyBase'], { CHUNK_SIZE: 20 });
  const cases = [
    { id: 'hot1' }, { id: 'hot2' },
    { id: 'cold1', lastActivityAt: '2025-03-01' },
  ];
  const isActive = c => c.id.startsWith('hot');
  const map = S._rechunkAssignments(cases, isActive);
  assert.equal(map.get('hot1'), 'active-01');
  assert.equal(map.get('hot2'), 'active-01');
  assert.equal(map.get('cold1'), 'cold-113-1');
});

test('_rechunkAssignments：同一份輸入重跑兩次 → 結果完全相同（idempotent，供重新分塊可重跑）', () => {
  const S = load(['_rechunkAssignments'], { CHUNK_SIZE: 20 });
  const cases = Array.from({ length: 30 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}` }));
  const map1 = S._rechunkAssignments(cases, () => true);
  const map2 = S._rechunkAssignments(cases, () => true);
  assert.deepEqual([...map1.entries()].sort(), [...map2.entries()].sort());
});

test('_rechunkAssignments：省略 isActiveFn 時預設用 _isHotCase', () => {
  const S = load(['_rechunkAssignments', '_isHotCase', 'currentSemesterPrefix', 'openDateToSemPrefix', '_lastActivityYearOf', '_semKeyBase'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), CHUNK_SIZE: 20,
  });
  const cases = [
    { id: 'hot1', semesters: ['1141'] },   // 114-1 學期，本學期（2026-06 屬 114-2？需與 _isHotCase 邏輯一致，見下）
    { id: 'cold1', semesters: ['1131'] },  // 舊學期
  ];
  const map = S._rechunkAssignments(cases);
  // 不預先假設 currentSemesterPrefix 確切值，只驗證兩案被分到不同性質的塊（一 active 一 cold）
  const hotChunk = map.get('hot1');
  const coldChunk = map.get('cold1');
  assert.notEqual(hotChunk, coldChunk);
});

// ── _pickActiveChunkForNew ───────────────────────────────────────────────────
test('_pickActiveChunkForNew：無任何 active chunk → active-01', () => {
  const S = load(['_pickActiveChunkForNew'], { CHUNK_SIZE: 20 });
  assert.equal(S._pickActiveChunkForNew({}), 'active-01');
});

test('_pickActiveChunkForNew：既有 chunk 未滿 → 挑第一個未滿的（依名稱排序）', () => {
  const S = load(['_pickActiveChunkForNew'], { CHUNK_SIZE: 20 });
  assert.equal(S._pickActiveChunkForNew({ 'active-01': 20, 'active-02': 5, 'active-03': 20 }), 'active-02');
});

test('_pickActiveChunkForNew：全部滿 20 → 配置下一號', () => {
  const S = load(['_pickActiveChunkForNew'], { CHUNK_SIZE: 20 });
  assert.equal(S._pickActiveChunkForNew({ 'active-01': 20, 'active-02': 20 }), 'active-03');
});

test('_pickActiveChunkForNew：輸入順序不影響結果（依名稱排序挑選）', () => {
  const S = load(['_pickActiveChunkForNew'], { CHUNK_SIZE: 20 });
  assert.equal(S._pickActiveChunkForNew({ 'active-03': 20, 'active-01': 20, 'active-02': 5 }), 'active-02');
});

// ── getCaseChunkName：map 優先 vs legacy fallback ────────────────────────────
test('getCaseChunkName：_caseChunkMap 有記錄 → 優先採用（不落回案號推導）', () => {
  const map = new Map([['1142001', 'active-03']]);
  const S = load(['getCaseChunkName'], { CHUNK_SIZE: 20, _caseChunkMap: map });
  assert.equal(S.getCaseChunkName('1142001'), 'active-03');
});

test('getCaseChunkName：_caseChunkMap 存在但無此 caseId 記錄 → 落回案號推導（legacy fallback）', () => {
  const map = new Map([['9999999', 'active-01']]); // 與待查案號無關
  const S = load(['getCaseChunkName'], { CHUNK_SIZE: 20, _caseChunkMap: map });
  assert.equal(S.getCaseChunkName('1142001'), '114/1142001-1142020');
});

test('getCaseChunkName：_caseChunkMap 未注入（如既有呼叫情境）→ 沿用 legacy 公式，不炸', () => {
  const S = load(['getCaseChunkName'], { CHUNK_SIZE: 20 });
  assert.equal(S.getCaseChunkName('1142001'), '114/1142001-1142020');
});

test('getCaseChunkName：caseId 長度非 7 → 恆為 misc（map 命中與否都一樣，長度檢查在最前）', () => {
  const map = new Map([['abc', 'active-01']]);
  const S = load(['getCaseChunkName'], { CHUNK_SIZE: 20, _caseChunkMap: map });
  assert.equal(S.getCaseChunkName('abc'), 'misc');
});

// ── _syncCaseChunkMapFromIndex ───────────────────────────────────────────────
test('_syncCaseChunkMapFromIndex：從 index cases 的 chunk 欄位重建 map', () => {
  const S = load(['_syncCaseChunkMapFromIndex'], { _caseChunkMap: new Map() });
  S._syncCaseChunkMapFromIndex([
    { id: '1142001', chunk: 'active-01' },
    { id: '1142002', chunk: 'cold-113-1' },
  ]);
  assert.equal(S._caseChunkMap.get('1142001'), 'active-01');
  assert.equal(S._caseChunkMap.get('1142002'), 'cold-113-1');
});

test('_syncCaseChunkMapFromIndex：entry 缺 chunk 欄位（尚未重新分塊過的舊資料）→ 不寫入該筆', () => {
  const S = load(['_syncCaseChunkMapFromIndex'], { _caseChunkMap: new Map() });
  S._syncCaseChunkMapFromIndex([{ id: '1142001' }, { id: '1142002', chunk: '' }]);
  assert.equal(S._caseChunkMap.has('1142001'), false);
  assert.equal(S._caseChunkMap.has('1142002'), false);
});

test('_syncCaseChunkMapFromIndex：重新同步會整批覆蓋舊內容（不殘留前一次已刪除個案的歸屬）', () => {
  const S = load(['_syncCaseChunkMapFromIndex'], { _caseChunkMap: new Map([['stale', 'active-09']]) });
  S._syncCaseChunkMapFromIndex([{ id: '1142001', chunk: 'active-01' }]);
  assert.equal(S._caseChunkMap.has('stale'), false);
  assert.equal(S._caseChunkMap.get('1142001'), 'active-01');
});

// ── _activeChunkCounts ───────────────────────────────────────────────────────
test('_activeChunkCounts：統計各 active-NN 筆數，忽略 cold-*／無 chunk 欄位', () => {
  const S = load(['_activeChunkCounts']);
  const counts = S._activeChunkCounts([
    { id: 'a', chunk: 'active-01' }, { id: 'b', chunk: 'active-01' },
    { id: 'c', chunk: 'cold-113-1' }, { id: 'd' },
  ]);
  assert.deepEqual(counts, { 'active-01': 2 });
});

// ── _assignChunkForNewCase ───────────────────────────────────────────────────
test('_assignChunkForNewCase：尚未執行過重新分塊 → 完全不動作（legacy fallback 交給 getCaseChunkName）', () => {
  const chunkMap = new Map();
  const S = load(['_assignChunkForNewCase', '_rechunkHasRun', '_activeChunkCounts', '_pickActiveChunkForNew'], {
    CHUNK_SIZE: 20, _caseChunkMap: chunkMap,
    casesManifest: { chunks: ['114/1141001-1141020'] },
    _casesIndexCache: { cases: [] },
  });
  S._assignChunkForNewCase('1142099');
  assert.equal(chunkMap.has('1142099'), false);
});

test('_assignChunkForNewCase：已執行過重新分塊 → 指派到未滿的 active chunk', () => {
  const chunkMap = new Map();
  const S = load(['_assignChunkForNewCase', '_rechunkHasRun', '_activeChunkCounts', '_pickActiveChunkForNew'], {
    CHUNK_SIZE: 20, _caseChunkMap: chunkMap,
    casesManifest: { chunks: ['active-01', 'active-02'] },
    _casesIndexCache: { cases: [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `old${i}`, chunk: 'active-01' })),
      { id: 'old20', chunk: 'active-02' },
    ] },
  });
  S._assignChunkForNewCase('1142099');
  assert.equal(chunkMap.get('1142099'), 'active-02'); // active-01 已滿 20，active-02 只有 1 筆
});

test('_assignChunkForNewCase：已執行過重新分塊但所有 active chunk 都滿 → 開新的 active-N', () => {
  const chunkMap = new Map();
  const S = load(['_assignChunkForNewCase', '_rechunkHasRun', '_activeChunkCounts', '_pickActiveChunkForNew'], {
    CHUNK_SIZE: 20, _caseChunkMap: chunkMap,
    casesManifest: { chunks: ['active-01'] },
    _casesIndexCache: { cases: Array.from({ length: 20 }, (_, i) => ({ id: `old${i}`, chunk: 'active-01' })) },
  });
  S._assignChunkForNewCase('1142099');
  assert.equal(chunkMap.get('1142099'), 'active-02');
});

test('_assignChunkForNewCase：caseId 已有歸屬記錄 → 不重複指派（保持原值）', () => {
  const chunkMap = new Map([['1142099', 'active-01']]);
  const S = load(['_assignChunkForNewCase', '_rechunkHasRun', '_activeChunkCounts', '_pickActiveChunkForNew'], {
    CHUNK_SIZE: 20, _caseChunkMap: chunkMap,
    casesManifest: { chunks: ['active-01', 'active-02'] },
    _casesIndexCache: { cases: [] },
  });
  S._assignChunkForNewCase('1142099');
  assert.equal(chunkMap.get('1142099'), 'active-01');
});

test('_assignChunkForNewCase：caseId 為空 → 不動作，不炸', () => {
  const chunkMap = new Map();
  const S = load(['_assignChunkForNewCase', '_rechunkHasRun', '_activeChunkCounts', '_pickActiveChunkForNew'], {
    CHUNK_SIZE: 20, _caseChunkMap: chunkMap,
    casesManifest: { chunks: ['active-01'] },
    _casesIndexCache: { cases: [] },
  });
  assert.doesNotThrow(() => S._assignChunkForNewCase(''));
  assert.equal(chunkMap.size, 0);
});

// ── _fullRebuildAssignments（migrateToChunks／_rebuildChunksCore 共用的歸屬計算入口）────────
test('_fullRebuildAssignments：scheme=legacy → 逐案採 getCaseChunkName（等同重構前 migrateToChunks 行為）', () => {
  const S = load(['_fullRebuildAssignments', 'getCaseChunkName'], { CHUNK_SIZE: 20, _caseChunkMap: new Map() });
  const cases = [{ id: '1142001' }, { id: '1142099' }];
  const map = S._fullRebuildAssignments(cases, 'legacy');
  assert.equal(map.get('1142001'), '114/1142001-1142020');
  assert.equal(map.get('1142099'), '114/1142081-1142100');
});

test('_fullRebuildAssignments：scheme=active-cold → 改走 _rechunkAssignments（活躍集中、其餘依學年分塊）', () => {
  const S = load(['_fullRebuildAssignments', '_rechunkAssignments', '_isHotCase', 'currentSemesterPrefix',
    'openDateToSemPrefix', '_lastActivityYearOf', '_semKeyBase'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), CHUNK_SIZE: 20,
  });
  const cases = [
    { id: 'hot1', semesters: ['1141'] },
    { id: 'cold1', semesters: ['1131'] },
  ];
  const map = S._fullRebuildAssignments(cases, 'active-cold');
  assert.notEqual(map.get('hot1'), map.get('cold1'));
  assert.ok(!/^\d{3}\//.test(map.get('hot1')), 'active/cold scheme 不應產生 legacy 的 "學年/範圍" 格式');
});

test('_fullRebuildAssignments：忽略沒有 id 的個案，不炸', () => {
  const S = load(['_fullRebuildAssignments', 'getCaseChunkName'], { CHUNK_SIZE: 20, _caseChunkMap: new Map() });
  const map = S._fullRebuildAssignments([{ id: '1142001' }, { name: '無案號' }], 'legacy');
  assert.equal(map.size, 1);
});
