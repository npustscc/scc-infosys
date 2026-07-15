// _mlCaseTimelineItems：個案詳細頁「身心調適假紀錄」卡改時間軸（v179）——純函式，資料組裝與排序邏輯
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const FNS = ['_mlCaseTimelineItems', '_mlGroupAndSort', '_mlParseDateRange'];

test('_mlCaseTimelineItems：單筆請假 → 一筆 leave 項目，日期=請假日', () => {
  const S = load(FNS);
  const leaves = [{ id: 'l1', studentId: 's1', leaveDate: '2026-05-10' }];
  const items = S._mlCaseTimelineItems(leaves, [], [], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'leave');
  assert.equal(items[0].date, '2026-05-10');
  assert.equal(items[0].dateRange, '05/10');
});

test('_mlCaseTimelineItems：連續三日請假合併為一張請假卡片，isConsec3 為 true', () => {
  const S = load(FNS);
  const leaves = [
    { id: 'l1', studentId: 's1', leaveDate: '2026-05-15' },
    { id: 'l2', studentId: 's1', leaveDate: '2026-05-16' },
    { id: 'l3', studentId: 's1', leaveDate: '2026-05-17' },
  ];
  const items = S._mlCaseTimelineItems(leaves, [], [], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'leave');
  assert.equal(items[0].dateRange, '05/15 – 05/17');
  assert.equal(items[0].isConsec3, true);
  assert.equal(items[0].records.length, 3);
});

test('_mlCaseTimelineItems：已刪除請假不計入', () => {
  const S = load(FNS);
  const leaves = [
    { id: 'l1', studentId: 's1', leaveDate: '2026-05-10' },
    { id: 'l2', studentId: 's1', leaveDate: '2026-05-11', deleted: true },
  ];
  const items = S._mlCaseTimelineItems(leaves, [], [], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].records.length, 1);
});

test('_mlCaseTimelineItems：評估項目日期取 evalDate，缺 evalDate 時 fallback filledAt', () => {
  const S = load(FNS);
  const l1 = { id: 'l1', studentId: 's1', leaveDate: '2026-05-01', assessment: { evalDate: '2026-05-03', bsrs: [0,0,0,0,0] } };
  const l2 = { id: 'l2', studentId: 's1', leaveDate: '2026-05-01', assessment: { filledAt: '2026-05-04T09:00:00' } };
  const items = S._mlCaseTimelineItems([l1, l2], [l1, l2], [], []);
  const evals = items.filter(i => i.type === 'eval');
  assert.equal(evals.length, 2);
  assert.equal(evals.find(e => e.leave.id === 'l1').date, '2026-05-03');
  assert.equal(evals.find(e => e.leave.id === 'l2').date, '2026-05-04');
});

test('_mlCaseTimelineItems：聯繫項目照傳入陣列逐筆展開，日期=contact.date', () => {
  const S = load(FNS);
  const contacts = [
    { leaveId: 'l1', date: '2026-05-02', method: '電話關懷', target: '學生本人' },
    { leaveId: 'l1', date: '2026-05-06', method: 'E-mail/簡訊', target: '家屬' },
  ];
  const items = S._mlCaseTimelineItems([], [], contacts, []);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.date), ['2026-05-02', '2026-05-06']);
  assert.equal(items[0].contact.method, '電話關懷');
});

test('_mlCaseTimelineItems：abTypeHistory 只取 kind=change 且 to 含 A 的條目（open 不算、轉 B 不算）', () => {
  const S = load(FNS);
  const hist = [
    { kind: 'open', to: 'A案', at: '2026-01-01T09:00:00', byName: '甲' }, // open：不算轉入
    { kind: 'change', from: 'A案', to: 'B案', at: '2026-02-01T09:00:00', byName: '乙' }, // 轉 B：不算
    { kind: 'change', from: 'B案', to: 'A案', at: '2026-03-01T09:00:00', byName: '丙' }, // 轉 A：算
  ];
  const items = S._mlCaseTimelineItems([], [], [], hist);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'abChange');
  assert.equal(items[0].date, '2026-03-01');
  assert.equal(items[0].history.byName, '丙');
});

test('_mlCaseTimelineItems：整體依日期升冪排序；同日期依 leave < eval < contact < abChange', () => {
  const S = load(FNS);
  const leaves = [{ id: 'l1', studentId: 's1', leaveDate: '2026-06-10', assessment: { evalDate: '2026-06-10' } }];
  const contacts = [{ leaveId: 'l1', date: '2026-06-10', method: '面談', target: '學生本人' }];
  const hist = [{ kind: 'change', to: 'A案', at: '2026-06-10T00:00:00', byName: '丁' }];
  const items = S._mlCaseTimelineItems(leaves, leaves, contacts, hist);
  assert.deepEqual(items.map(i => i.type), ['leave', 'eval', 'contact', 'abChange']);

  // 不同日期時整體升冪
  const leaves2 = [{ id: 'l2', studentId: 's1', leaveDate: '2026-08-01' }];
  const contacts2 = [{ leaveId: 'l2', date: '2026-01-01', method: '面談', target: '學生本人' }];
  const items2 = S._mlCaseTimelineItems(leaves2, [], contacts2, []);
  assert.deepEqual(items2.map(i => i.date), ['2026-01-01', '2026-08-01']);
});

test('_mlCaseTimelineItems：全部輸入皆空 → 回傳空陣列', () => {
  const S = load(FNS);
  assert.deepEqual(S._mlCaseTimelineItems([], [], [], []), []);
  assert.deepEqual(S._mlCaseTimelineItems(undefined, undefined, undefined, undefined), []);
});
