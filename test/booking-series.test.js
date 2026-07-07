// 系列預約編輯整修（v96）：_bkDaysBetween / _bkSeriesTargets 純函式單元測試。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkDaysBetween', '_bkSeriesTargets']);
}

// ── _bkDaysBetween ───────────────────────────────────────────────────
test('_bkDaysBetween：同一天回傳 0', () => {
  const S = load_();
  assert.equal(S._bkDaysBetween('2026-07-10', '2026-07-10'), 0);
});

test('_bkDaysBetween：正差（b 晚於 a）', () => {
  const S = load_();
  assert.equal(S._bkDaysBetween('2026-07-10', '2026-07-17'), 7);
});

test('_bkDaysBetween：負差（b 早於 a）', () => {
  const S = load_();
  assert.equal(S._bkDaysBetween('2026-07-17', '2026-07-10'), -7);
});

test('_bkDaysBetween：跨月', () => {
  const S = load_();
  assert.equal(S._bkDaysBetween('2026-07-28', '2026-08-04'), 7);
});

test('_bkDaysBetween：跨年', () => {
  const S = load_();
  assert.equal(S._bkDaysBetween('2026-12-30', '2027-01-06'), 7);
});

// ── _bkSeriesTargets ─────────────────────────────────────────────────
function seriesFixture() {
  return [
    { id: 'bk1', seriesId: 'series_1', date: '2026-07-01' },
    { id: 'bk2', seriesId: 'series_1', date: '2026-07-08' },
    { id: 'bk3', seriesId: 'series_1', date: '2026-07-15' },
    { id: 'bk-other', seriesId: 'series_2', date: '2026-07-08' },
  ];
}

test('_bkSeriesTargets：scope this 只回傳編輯筆本身', () => {
  const S = load_();
  const bookings = seriesFixture();
  const edited = bookings.find(b => b.id === 'bk2');
  const targets = S._bkSeriesTargets(bookings, edited, 'this');
  assert.deepEqual(targets.map(t => t.id), ['bk2']);
});

test('_bkSeriesTargets：scope future 含編輯筆本身與之後的筆，排除較早的筆', () => {
  const S = load_();
  const bookings = seriesFixture();
  const edited = bookings.find(b => b.id === 'bk2'); // date 2026-07-08
  const targets = S._bkSeriesTargets(bookings, edited, 'future');
  assert.deepEqual(targets.map(t => t.id).sort(), ['bk2', 'bk3']);
});

test('_bkSeriesTargets：scope all 含較早的筆（整個系列）', () => {
  const S = load_();
  const bookings = seriesFixture();
  const edited = bookings.find(b => b.id === 'bk2');
  const targets = S._bkSeriesTargets(bookings, edited, 'all');
  assert.deepEqual(targets.map(t => t.id).sort(), ['bk1', 'bk2', 'bk3']);
});

test('_bkSeriesTargets：不同 seriesId 一律排除', () => {
  const S = load_();
  const bookings = seriesFixture();
  const edited = bookings.find(b => b.id === 'bk2');
  const targets = S._bkSeriesTargets(bookings, edited, 'all');
  assert.ok(!targets.some(t => t.id === 'bk-other'));
});

test('_bkSeriesTargets：非系列成員（無 seriesId）只回傳自己', () => {
  const S = load_();
  const bookings = [
    { id: 'solo1', date: '2026-07-10' },
    { id: 'solo2', date: '2026-07-11' },
  ];
  const edited = bookings[0];
  const targets = S._bkSeriesTargets(bookings, edited, 'all');
  assert.deepEqual(targets.map(t => t.id), ['solo1']);
});

test('_bkSeriesTargets：找不到編輯筆本身（已被刪除）時 this/非系列回傳空陣列', () => {
  const S = load_();
  const bookings = seriesFixture();
  const goneEdited = { id: 'gone', date: '2026-07-08' };
  assert.deepEqual(S._bkSeriesTargets(bookings, goneEdited, 'this'), []);
});
