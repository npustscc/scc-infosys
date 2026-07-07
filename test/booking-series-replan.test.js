// v100：編輯系列預約調整頻率／次數 — _bkSeriesReplan 純函式單元測試。
// #24：擴充每三週（固定 21 天，做法同 7/14）與每月（'monthly'，需保留「日」並處理月底邊界，
// 不可用固定天數推算）— _bkAddMonths / _bkAddFreq / _bkDetectSeriesFreq 一併測試。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkFmtDate', '_bkAddDays', '_bkAddMonths', '_bkAddFreq', '_bkDaysBetween', '_bkSeriesReplan', '_bkDetectSeriesFreq']);
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

// ── #24：_bkAddMonths（月底邊界）───────────────────────────────
test('_bkAddMonths：一般情況，保留原本的日', () => {
  const S = load_();
  assert.equal(S._bkAddMonths('2026-07-08', 1), '2026-08-08');
  assert.equal(S._bkAddMonths('2026-07-08', 2), '2026-09-08');
});

test('_bkAddMonths：月底邊界 — 目標月無此日則取該月最後一天，且不受中間月份裁切影響', () => {
  const S = load_();
  // 1/31 起算：2月無31日→取28日（2026非閏年）；3月有31日→應為31日（不會因2月被裁成28日而誤算成28）
  assert.equal(S._bkAddMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(S._bkAddMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(S._bkAddMonths('2026-01-31', 3), '2026-04-30'); // 4月僅30日
  assert.equal(S._bkAddMonths('2026-01-31', 4), '2026-05-31');
});

test('_bkAddMonths：跨年', () => {
  const S = load_();
  assert.equal(S._bkAddMonths('2026-12-15', 1), '2027-01-15');
});

// ── #24：_bkAddFreq（頻率統一入口）─────────────────────────────
test('_bkAddFreq：天數頻率＝anchor + periods*天數', () => {
  const S = load_();
  assert.equal(S._bkAddFreq('2026-07-15', 21, 2), '2026-08-26'); // 每三週，第2期
});

test('_bkAddFreq：monthly＝anchor 往後 periods 個月（月底邊界）', () => {
  const S = load_();
  assert.equal(S._bkAddFreq('2026-01-31', 'monthly', 2), '2026-03-31');
});

// ── #24：每三週（固定 21 天）— 與 7/14 做法相同，僅頻率數值不同 ──────
test('_bkSeriesReplan：每三週（21天）— 後段依新頻率重排，可跨月', () => {
  const S = load_();
  const series = seriesFixture();
  const r = S._bkSeriesReplan(series, 'b3', '2026-07-15', 21, 5);
  const b4 = r.redates.find(x => x.id === 'b4');
  const b5 = r.redates.find(x => x.id === 'b5');
  assert.equal(b4.date, '2026-08-05'); // 07-15 + 21
  assert.equal(b5.date, '2026-08-26'); // 07-15 + 42
  assert.deepEqual(r.creates, []);
  assert.deepEqual(r.deleteIds, []);
});

// ── #24：每月（'monthly'）— 系列重排需正確處理月底邊界，不能鏈式累加造成日期漂移 ──
function monthlySeriesFixture() {
  return [
    { id: 'm1', date: '2026-01-03' },  // front，不受影響
    { id: 'm2', date: '2026-01-31' },  // 編輯這筆（錨點，月底最後一天）
    { id: 'm3', date: '2026-02-01' },  // back，原日期任意（將被重排覆蓋）
    { id: 'm4', date: '2026-03-01' },  // back
  ];
}

test('_bkSeriesReplan：每月頻率 — 後段依錨點的日重排，2月無31日取月底28日、3月則正確回到31日', () => {
  const S = load_();
  const series = monthlySeriesFixture();
  const r = S._bkSeriesReplan(series, 'm2', '2026-01-31', 'monthly', 4);
  assert.ok(!r.redates.some(x => x.id === 'm1')); // front 不受影響
  const m3 = r.redates.find(x => x.id === 'm3');
  const m4 = r.redates.find(x => x.id === 'm4');
  assert.equal(m3.date, '2026-02-28'); // 月底邊界：2月無31日
  assert.equal(m4.date, '2026-03-31'); // 3月有31日，不因2月被裁切而誤算成28
  assert.deepEqual(r.creates, []);
  assert.deepEqual(r.deleteIds, []);
});

test('_bkSeriesReplan：每月頻率＋加次數 — 新增筆接續錨點月底邊界序列（4月30、5月31）', () => {
  const S = load_();
  const series = monthlySeriesFixture();
  const r = S._bkSeriesReplan(series, 'm2', '2026-01-31', 'monthly', 6); // 4→6，增2筆
  assert.deepEqual(r.creates, ['2026-04-30', '2026-05-31']); // 4月僅30日；5月31日
});

test('_bkSeriesReplan：每月頻率＋減次數 — 刪除日期最晚者，錨點本身不可刪', () => {
  const S = load_();
  const series = monthlySeriesFixture();
  const r = S._bkSeriesReplan(series, 'm2', '2026-01-31', 'monthly', 2); // 4→2，刪2筆
  assert.deepEqual(r.deleteIds, ['m4', 'm3']); // 重排後日期最晚者優先（03-31 → 02-28）
  assert.ok(!r.deleteIds.includes('m2'));
  assert.ok(!r.deleteIds.includes('m1'));
});

// ── #24：_bkDetectSeriesFreq（由既有系列日期反推當初頻率，供編輯時預先勾選）──
test('_bkDetectSeriesFreq：固定天數 7/14/21 皆可正確判斷', () => {
  const S = load_();
  assert.equal(S._bkDetectSeriesFreq(['2026-07-01', '2026-07-08', '2026-07-15']), 7);
  assert.equal(S._bkDetectSeriesFreq(['2026-07-01', '2026-07-15', '2026-07-29']), 14);
  assert.equal(S._bkDetectSeriesFreq(['2026-07-01', '2026-07-22', '2026-08-12']), 21);
});

test('_bkDetectSeriesFreq：每月（含月底邊界）判斷為 monthly', () => {
  const S = load_();
  assert.equal(S._bkDetectSeriesFreq(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']), 'monthly');
});

test('_bkDetectSeriesFreq：日期曾被個別調整（非固定間隔、也非每月）回傳 null', () => {
  const S = load_();
  assert.equal(S._bkDetectSeriesFreq(['2026-07-01', '2026-07-09', '2026-07-20']), null);
});
