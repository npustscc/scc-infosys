// v100：編輯系列預約調整頻率／次數 — _bkSeriesReplan 純函式單元測試。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkFmtDate', '_bkAddDays', '_bkDaysBetween', '_bkSeriesReplan']);
}

// 固定情境：5 筆系列，原本每週一次（freq=7）。
// b1 07-01, b2 07-08, b3 07-15（編輯這筆）, b4 07-22, b5 07-29。
function seriesFixture() {
  return [
    { id: 'b1', date: '2026-07-01' },
    { id: 'b2', date: '2026-07-08' },
    { id: 'b3', date: '2026-07-15' },
    { id: 'b4', date: '2026-07-22' },
    { id: 'b5', date: '2026-07-29' },
  ];
}

test('_bkSeriesReplan：只改頻率（7→14）— 後段依新頻率重排，前段與被編輯筆不動', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-15', 14, 5);
  // 前段 b1/b2 不出現在 redates
  assert.ok(!r.redates.some(x => x.id === 'b1'));
  assert.ok(!r.redates.some(x => x.id === 'b2'));
  // 被編輯筆本身不出現在 redates
  assert.ok(!r.redates.some(x => x.id === 'b3'));
  // 後段依新頻率重排：b4 = anchor+14, b5 = anchor+28
  const b4 = r.redates.find(x => x.id === 'b4');
  const b5 = r.redates.find(x => x.id === 'b5');
  assert.equal(b4.date, '2026-07-29');
  assert.equal(b5.date, '2026-08-12');
  assert.deepEqual(r.creates, []);
  assert.deepEqual(r.deleteIds, []);
});

test('_bkSeriesReplan：只加次數（5→7，頻率沿用 7）— 從重排後最後一筆日期起往後新增', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-15', 7, 7);
  assert.deepEqual(r.redates, []); // 頻率沿用，後段日期不變
  assert.deepEqual(r.creates, ['2026-08-05', '2026-08-12']);
  assert.deepEqual(r.deleteIds, []);
});

test('_bkSeriesReplan：只減次數（5→3）— 刪除日期最晚的幾筆，被編輯筆不可刪', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-15', 7, 3);
  assert.deepEqual(r.creates, []);
  assert.deepEqual(r.deleteIds, ['b5', 'b4']); // 日期最晚者優先
  assert.ok(!r.deleteIds.includes('b3'));
});

test('_bkSeriesReplan：頻率與次數同時改（7→14，5→6）', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-15', 14, 6);
  const b4 = r.redates.find(x => x.id === 'b4');
  const b5 = r.redates.find(x => x.id === 'b5');
  assert.equal(b4.date, '2026-07-29');
  assert.equal(b5.date, '2026-08-12');
  assert.deepEqual(r.creates, ['2026-08-26']); // 從重排後最後一筆（08-12）+14 起新增
  assert.deepEqual(r.deleteIds, []);
});

test('_bkSeriesReplan：被編輯筆是系列最後一筆 — 沒有後段可重排，加次數直接從錨點續接', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b5', '2026-07-29', 14, 6);
  assert.deepEqual(r.redates, []); // 沒有比 b5 更晚的筆
  assert.deepEqual(r.creates, ['2026-08-12']); // anchor(07-29) + 14
});

test('_bkSeriesReplan：被編輯筆是系列最後一筆 — 減次數刪除次晚（不含被編輯筆本身）', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b5', '2026-07-29', 7, 4);
  assert.deepEqual(r.deleteIds, ['b4']); // 前段中日期最晚者，b5（被編輯筆）不可刪
});

test('_bkSeriesReplan：editedNewDate 與原日期不同（平移＋重排疊加）', () => {
  const S = load_();
  const series = seriesFixture();
  // 使用者把被編輯筆（原 07-15）改到 07-17，頻率沿用 7 天，次數不變
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-17', 7, 5);
  const b4 = r.redates.find(x => x.id === 'b4');
  const b5 = r.redates.find(x => x.id === 'b5');
  assert.equal(b4.date, '2026-07-24'); // 07-17 + 7
  assert.equal(b5.date, '2026-07-31'); // 07-17 + 14
  assert.deepEqual(r.creates, []);
  assert.deepEqual(r.deleteIds, []);
});

test('_bkSeriesReplan：日期平移後次數同時減少 — 刪除筆從 redates 移除避免多餘動作', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-17', 7, 4); // 5→4，刪 1 筆
  assert.deepEqual(r.deleteIds, ['b5']); // 重排後日期最晚者
  assert.ok(!r.redates.some(x => x.id === 'b5')); // 反正要刪，不必出現在 redates
  const b4 = r.redates.find(x => x.id === 'b4');
  assert.equal(b4.date, '2026-07-24');
});
