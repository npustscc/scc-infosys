// 請假時數計算（v175）：_leaveWorkHours（只計實際上班時段＋扣午休）與 _dayWorkStartEnd
// （某日上班起訖，供表單預設值／改日期自動套用）的單元測試。
// 注意：檔名刻意避開既有 test/leave-hours.test.js（額度計算，早已存在、與本次無關），
// 避免覆蓋既有覆蓋範圍。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function loadFns(extra = {}) {
  return load(['_leaveWorkHours', '_dayWorkStartEnd', '_dayWorkHours', '_fmtDate'], extra);
}

// 測試用上班時間設定：週一～週五 08:00-18:00（一般班），週六 12:00-21:00（晚班），週日無設定（非上班日）。
// 日期選用 2026-07-13（一）、07-17（五）、07-18（六）、07-19（日）、07-20（一）。
const CFG = {
  weeklyHours: {
    1: { start: 8, end: 18 },
    2: { start: 8, end: 18 },
    3: { start: 8, end: 18 },
    4: { start: 8, end: 18 },
    5: { start: 8, end: 18 },
    6: { start: 12, end: 21 },
  },
  extraWorkDays: [],
  semesterPeriods: [],
  nonSemesterEndHour: 18,
  holidays: [],
};

test('_leaveWorkHours：單日整天（08:00-18:00）→ 扣 1 小時午休 = 9', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-13', '08:00', '2026-07-13', '18:00'), 9);
});

test('_leaveWorkHours：單日半天（08:00-11:00）未涵蓋午休 → 不扣 = 3', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-13', '08:00', '2026-07-13', '11:00'), 3);
});

test('_leaveWorkHours：跨日（五 16:00 ～ 一 10:00，含週末）→ 只計各日上班時段，過夜與非上班日不計', () => {
  const S = loadFns();
  // 五：16:00-18:00 = 2（不含午休）／六（晚班全天）：12:00-21:00 扣午休(16-17) = 8／日：非上班日 = 0／一：08:00-10:00 = 2
  // 合計 2 + 8 + 0 + 2 = 12
  assert.equal(S._leaveWorkHours(CFG, '2026-07-17', '16:00', '2026-07-20', '10:00'), 12);
});

test('_leaveWorkHours：非上班日（週日）整天 → 貢獻 0', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-19', '08:00', '2026-07-19', '18:00'), 0);
});

test('_leaveWorkHours：晚班日（週六 12:00-21:00）午休位置正確（上班起算第 5 小時＝16:00-17:00）', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-18', '12:00', '2026-07-18', '21:00'), 8); // 9 - 1
});

test('_leaveWorkHours：半天涵蓋部分午休（11:00-12:30，與 12:00-13:00 重疊 0.5hr）→ 1.5 - 0.5 = 1', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-13', '11:00', '2026-07-13', '12:30'), 1);
});

test('_leaveWorkHours：結束日早於開始日 → 0（不炸）', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '2026-07-13', '08:00', '2026-07-10', '18:00'), 0);
});

test('_leaveWorkHours：無開始日 → 0（不炸）', () => {
  const S = loadFns();
  assert.equal(S._leaveWorkHours(CFG, '', '08:00', '2026-07-13', '18:00'), 0);
});

test('_dayWorkStartEnd：一般班日（週一）→ 08:00-18:00', () => {
  const S = loadFns();
  assert.deepEqual(S._dayWorkStartEnd(CFG, '2026-07-13'), { start: '08:00', end: '18:00' });
});

test('_dayWorkStartEnd：晚班日（週六）→ 12:00-21:00', () => {
  const S = loadFns();
  assert.deepEqual(S._dayWorkStartEnd(CFG, '2026-07-18'), { start: '12:00', end: '21:00' });
});

test('_dayWorkStartEnd：非上班日（週日）→ 退回其他星期第一組有效時段（週一 08:00-18:00）', () => {
  const S = loadFns();
  assert.deepEqual(S._dayWorkStartEnd(CFG, '2026-07-19'), { start: '08:00', end: '18:00' });
});

test('_dayWorkStartEnd：cfg 完全無 weeklyHours 設定 → fallback 08:00-18:00', () => {
  const S = loadFns();
  assert.deepEqual(S._dayWorkStartEnd({ weeklyHours: {} }, '2026-07-19'), { start: '08:00', end: '18:00' });
});
