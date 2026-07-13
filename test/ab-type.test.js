// _caseLatestAbType：個案有效 abType（A案/B案）單一真相——A/B徽章與個案列表/案號查詢與管理/
// 身心調適假三處篩選（v169）共用此函式，避免邏輯分歧。
// 執行：node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const FNS = ['_caseLatestAbType', 'openDateToSemPrefix'];

test('_caseLatestAbType：無 semesters/snapshots → fallback 頂層 abType', () => {
  const S = load(FNS);
  assert.equal(S._caseLatestAbType({ id: '1', abType: 'A案' }), 'A案');
  assert.equal(S._caseLatestAbType({ id: '1', abType: 'B案' }), 'B案');
  assert.equal(S._caseLatestAbType({ id: '1' }), ''); // 完全缺值 → 空字串
});

test('_caseLatestAbType：最新學期快照優先於頂層欄位', () => {
  const S = load(FNS);
  const c = {
    id: '1141005',
    abType: 'A案', // 頂層是舊值
    semesters: ['1141', '1142'],
    basicInfoSnapshots: { 1141: { abType: 'A案' }, 1142: { abType: 'B案' } },
  };
  assert.equal(S._caseLatestAbType(c), 'B案');
});

test('_caseLatestAbType：最新學期快照缺 abType 時往前找較舊學期', () => {
  const S = load(FNS);
  const c = {
    id: '1141005',
    semesters: ['1141', '1142'],
    basicInfoSnapshots: { 1141: { abType: 'A案' }, 1142: {} }, // 1142 無 abType
  };
  assert.equal(S._caseLatestAbType(c), 'A案');
});

test('_caseLatestAbType：無 semesters 時以 openDate 推斷單一學期', () => {
  const S = load(FNS);
  const c = {
    id: '1142001', openDate: '2026-06-01', abType: 'B案',
    basicInfoSnapshots: { 1142: { abType: 'A案' } },
  };
  assert.equal(S._caseLatestAbType(c), 'A案');
});

test('_caseLatestAbType：index-only stub（無 basicInfoSnapshots）優雅降級為頂層 abType', () => {
  // 個案列表走輕量 index，冷資料個案可能僅有 index stub；index 已預先存入 _caseLatestAbType 算好的值於頂層 abType
  const S = load(FNS);
  const stub = { id: '1132001', semesters: ['1132'], abType: 'B案' }; // 無 basicInfoSnapshots
  assert.equal(S._caseLatestAbType(stub), 'B案');
  const stubMissing = { id: '1132002', semesters: ['1132'] }; // 舊版 index 缺 abType 欄位
  assert.equal(S._caseLatestAbType(stubMissing), '');
});
