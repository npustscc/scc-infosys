// v246：我的差勤「差勤總覽」tab 新增「我的打卡紀錄」查詢——純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
// _myAttFilterPunchRecords／_myAttPunchQuickRange 皆為純函式（不碰 DOM），故可在 vm sandbox 直接跑。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const records = [
  { email: 'a@x.com', date: '2026-07-13', timestamp: '2026-07-13T01:00:00.000Z' }, // 週一 簽到
  { email: 'a@x.com', date: '2026-07-13', timestamp: '2026-07-13T09:00:00.000Z' }, // 週一 簽退
  { email: 'a@x.com', date: '2026-07-20', timestamp: '2026-07-20T01:00:00.000Z' }, // 週一（次週）
  { email: 'b@x.com', date: '2026-07-20', timestamp: '2026-07-20T02:00:00.000Z' }, // 他人紀錄——絕不可混入
];

test('_myAttFilterPunchRecords：無起訖限制 → 只留該 email，依 timestamp 降冪', () => {
  const S = load(['_myAttFilterPunchRecords']);
  const r = S._myAttFilterPunchRecords(records, 'a@x.com', '', '');
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(x => x.timestamp), [
    '2026-07-20T01:00:00.000Z',
    '2026-07-13T09:00:00.000Z',
    '2026-07-13T01:00:00.000Z',
  ]);
});

test('_myAttFilterPunchRecords：絕不列出他人紀錄（即使日期在區間內）', () => {
  const S = load(['_myAttFilterPunchRecords']);
  const r = S._myAttFilterPunchRecords(records, 'a@x.com', '2026-07-20', '2026-07-20');
  assert.equal(r.length, 1);
  assert.equal(r[0].email, 'a@x.com');
});

test('_myAttFilterPunchRecords：只填起日 → 該日(含)以後', () => {
  const S = load(['_myAttFilterPunchRecords']);
  const r = S._myAttFilterPunchRecords(records, 'a@x.com', '2026-07-20', '');
  assert.deepEqual(r.map(x => x.date), ['2026-07-20']);
});

test('_myAttFilterPunchRecords：只填迄日 → 該日(含)以前', () => {
  const S = load(['_myAttFilterPunchRecords']);
  const r = S._myAttFilterPunchRecords(records, 'a@x.com', '', '2026-07-13');
  assert.deepEqual(r.map(x => x.date), ['2026-07-13', '2026-07-13']);
});

test('_myAttFilterPunchRecords：起訖同日 → 單日', () => {
  const S = load(['_myAttFilterPunchRecords']);
  const r = S._myAttFilterPunchRecords(records, 'a@x.com', '2026-07-13', '2026-07-13');
  assert.equal(r.length, 2);
});

test('_myAttFilterPunchRecords：空/null records → 不炸，回傳空陣列', () => {
  const S = load(['_myAttFilterPunchRecords']);
  assert.deepEqual(S._myAttFilterPunchRecords(null, 'a@x.com', '', ''), []);
  assert.deepEqual(S._myAttFilterPunchRecords(undefined, 'a@x.com', '', ''), []);
});

test('_myAttPunchQuickRange：today → from=to=今日', () => {
  const S = load(['_myAttPunchQuickRange']);
  assert.deepEqual(S._myAttPunchQuickRange('today', '2026-07-22'), { from: '2026-07-22', to: '2026-07-22' });
});

test('_myAttPunchQuickRange：week → from=本週一，to=今日', () => {
  const S = load(['_myAttPunchQuickRange', '_weekMondayOf', '_fmtDate']);
  // 2026-07-22 為週三，本週一為 2026-07-20
  assert.deepEqual(S._myAttPunchQuickRange('week', '2026-07-22'), { from: '2026-07-20', to: '2026-07-22' });
});

test('_myAttPunchQuickRange：month → from=當月 1 日，to=今日', () => {
  const S = load(['_myAttPunchQuickRange', '_weekMondayOf', '_fmtDate']);
  assert.deepEqual(S._myAttPunchQuickRange('month', '2026-07-22'), { from: '2026-07-01', to: '2026-07-22' });
});

test('_myAttPunchQuickRange：all（或未知 kind） → 清空起訖（不限制）', () => {
  const S = load(['_myAttPunchQuickRange']);
  assert.deepEqual(S._myAttPunchQuickRange('all', '2026-07-22'), { from: '', to: '' });
  assert.deepEqual(S._myAttPunchQuickRange('bogus', '2026-07-22'), { from: '', to: '' });
});
