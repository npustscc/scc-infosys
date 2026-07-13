// _filterPanelMatch：v173 收合式勾選篩選面板（momo 購物式）的核心純函式。
// 規則：同群組內複選＝OR、跨群組＝AND、某群全沒勾＝該維度不篩（＝全部通過）。
// 個案列表 renderCases／案號查詢與管理 renderCaseNums／身心調適假 _mlRenderRecordsTab／
// 稽核紀錄 _mlLoadAuditTrack 四處共用此函式判定「一筆資料是否通過目前已勾選的條件」。
// 執行：node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const FNS = ['_filterPanelMatch'];

test('_filterPanelMatch：activeGroups 全空（每群組都沒勾）→ 全部通過，不篩', () => {
  const S = load(FNS);
  assert.equal(S._filterPanelMatch({ status: 'active' }, { status: [] }), true);
  assert.equal(S._filterPanelMatch({}, {}), true);
  assert.equal(S._filterPanelMatch({ status: 'active', abType: 'A案' }, { status: [], abType: [] }), true);
});

test('_filterPanelMatch：單群組內複選＝OR（命中群組內任一勾選值即通過）', () => {
  const S = load(FNS);
  const activeGroups = { status: ['active', 'closed'] };
  assert.equal(S._filterPanelMatch({ status: 'active' }, activeGroups), true);
  assert.equal(S._filterPanelMatch({ status: 'closed' }, activeGroups), true);
  assert.equal(S._filterPanelMatch({ status: 'deleted' }, activeGroups), false); // 沒被勾到的值 → 不通過
});

test('_filterPanelMatch：跨群組＝AND（每個有勾選的群組都要各自命中）', () => {
  const S = load(FNS);
  const activeGroups = { status: ['active'], abType: ['A案'] };
  assert.equal(S._filterPanelMatch({ status: 'active', abType: 'A案' }, activeGroups), true);
  assert.equal(S._filterPanelMatch({ status: 'active', abType: 'B案' }, activeGroups), false); // abType 群組沒命中
  assert.equal(S._filterPanelMatch({ status: 'closed', abType: 'A案' }, activeGroups), false); // status 群組沒命中
});

test('_filterPanelMatch：一筆資料在某維度可同時掛多個標籤（陣列值），命中其一即通過（如個案狀態 tags）', () => {
  const S = load(FNS);
  const activeGroups = { status: ['past_unclosed'] };
  assert.equal(S._filterPanelMatch({ status: ['active', 'past_unclosed'] }, activeGroups), true);
  assert.equal(S._filterPanelMatch({ status: ['closed'] }, activeGroups), false);
});

test('_filterPanelMatch：多維度組合＋部分維度不篩（空陣列）混用', () => {
  const S = load(FNS);
  const activeGroups = { status: ['active'], archived: [], abType: ['B案'] };
  // archived 全沒勾 → 不篩該維度，只看 status 與 abType 是否都命中
  assert.equal(S._filterPanelMatch({ status: 'active', archived: 'archived', abType: 'B案' }, activeGroups), true);
  assert.equal(S._filterPanelMatch({ status: 'active', archived: 'unarchived', abType: 'A案' }, activeGroups), false);
});

test('_filterPanelMatch：資料缺該維度值（undefined）時視為不命中任何已勾選條件', () => {
  const S = load(FNS);
  const activeGroups = { abType: ['A案'] };
  assert.equal(S._filterPanelMatch({}, activeGroups), false);
  assert.equal(S._filterPanelMatch({ abType: undefined }, activeGroups), false);
  assert.equal(S._filterPanelMatch({ abType: [] }, activeGroups), false); // 缺欄位 fallback 空陣列亦同（如 index stub 缺 abType）
});
