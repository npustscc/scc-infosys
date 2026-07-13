// v174：空間預約「時段格線」（單日詳細預約）拖曳改期——系列預約整批時間平移用的兩個純函式。
// _bkTimeDeltaMin：算出兩個 'HH:MM' 時間的分鐘差；_bkShiftTime：依分鐘差平移一個 'HH:MM' 時間字串。
// 供 _bkDragConfirmScope 比照既有日期平移（_bkDaysBetween/_bkAddDays）邏輯整批位移系列預約時間。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkTimeDeltaMin', '_bkShiftTime']);
}

// ── _bkTimeDeltaMin ─────────────────────────────────────────────────
test('_bkTimeDeltaMin：新時間較晚 → 正分鐘差', () => {
  const S = load_();
  assert.equal(S._bkTimeDeltaMin('08:10', '09:10'), 60);
});

test('_bkTimeDeltaMin：新時間較早 → 負分鐘差', () => {
  const S = load_();
  assert.equal(S._bkTimeDeltaMin('14:30', '13:30'), -60);
});

test('_bkTimeDeltaMin：相同時間 → 0', () => {
  const S = load_();
  assert.equal(S._bkTimeDeltaMin('10:15', '10:15'), 0);
});

test('_bkTimeDeltaMin：非整點差（節次時間常見的不規則分鐘數）', () => {
  const S = load_();
  // 第3節 10:15–11:05 拖到第4節 11:10–12:00：起始時間差 55 分鐘
  assert.equal(S._bkTimeDeltaMin('10:15', '11:10'), 55);
});

// ── _bkShiftTime ─────────────────────────────────────────────────────
test('_bkShiftTime：正常平移（不跨日）', () => {
  const S = load_();
  assert.equal(S._bkShiftTime('09:10', 60), '10:10');
  assert.equal(S._bkShiftTime('14:30', -60), '13:30');
});

test('_bkShiftTime：0 分鐘差原樣返回', () => {
  const S = load_();
  assert.equal(S._bkShiftTime('10:15', 0), '10:15');
});

test('_bkShiftTime：邊界——平移後落在午夜前後仍以 24 小時循環處理（本系統節次不會實際用到跨日）', () => {
  const S = load_();
  assert.equal(S._bkShiftTime('23:30', 60), '00:30');
  assert.equal(S._bkShiftTime('00:30', -60), '23:30');
});

// ── 兩者搭配：_bkTimeDeltaMin 算出的差值餵給 _bkShiftTime 應能還原目標時間 ──
test('搭配使用：deltaMin 往返一致（先算差、再平移應得到原目標時間）', () => {
  const S = load_();
  const oldStart = '08:10', newStart = '10:15';
  const delta = S._bkTimeDeltaMin(oldStart, newStart);
  assert.equal(S._bkShiftTime(oldStart, delta), newStart);
  // 系列中另一筆原始時間不同，套用同一 delta 平移
  assert.equal(S._bkShiftTime('09:10', delta), '11:15');
});
