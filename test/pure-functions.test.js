// 純函式單元測試。執行：node --test test/
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
// 用非嚴格 assert：抽出的函式在獨立 vm realm 執行，其陣列/物件的 prototype 與本 realm 不同，
// deepStrictEqual 會因 prototype 不相等而誤判；deepEqual（loose）只比結構與值，正是我們要的。
const assert = require('node:assert');
const { load, makeFixedDate } = require('./harness');

// ── 學期前綴／標籤（民國學年制）───────────────────────────────────────────────
test('openDateToSemPrefix：依開案日期換算學期前綴', () => {
  const S = load(['openDateToSemPrefix']);
  assert.equal(S.openDateToSemPrefix('2025-09-01'), '1141'); // 9 月 = 上學期 114-1
  assert.equal(S.openDateToSemPrefix('2026-01-10'), '1141'); // 1 月仍屬上學期 114-1
  assert.equal(S.openDateToSemPrefix('2026-06-15'), '1142'); // 6 月 = 下學期 114-2
  assert.equal(S.openDateToSemPrefix('2025-08-01'), '1141'); // 8/1 為上學期起點（>=8）
  assert.equal(S.openDateToSemPrefix('2025-07-31'), '1132'); // 7 月屬前一學期下學期 113-2
  assert.equal(S.openDateToSemPrefix(''), '');
  assert.equal(S.openDateToSemPrefix('not-a-date'), '');
});

test('semesterLabel：前綴轉可讀標籤', () => {
  const S = load(['semesterLabel']);
  assert.equal(S.semesterLabel('1142'), '114-2');
  assert.equal(S.semesterLabel('1131'), '113-1');
  assert.equal(S.semesterLabel(''), '—');
  assert.equal(S.semesterLabel('11'), '11'); // 長度不足原樣回傳
});

test('semesterMonths：學期涵蓋月份', () => {
  const S = load(['semesterMonths']);
  assert.deepEqual(S.semesterMonths('1141'),
    ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  assert.deepEqual(S.semesterMonths('1142'),
    ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
  assert.deepEqual(S.semesterMonths(''), []);
});

test('currentSemesterPrefix：以（固定）今天換算', () => {
  const S = load(['currentSemesterPrefix'], { Date: makeFixedDate('2026-06-15T00:00:00') });
  assert.equal(S.currentSemesterPrefix(), '1142');
});

// ── 案號產生與分塊 ─────────────────────────────────────────────────────────────
test('generateCaseId：取同學期最大序號 +1、補三位', () => {
  // 一學生一案號 Slice 2：generateCaseId 依賴 _usedFormerIdSeqs（曾用案號感知，避免撞號）
  const S = load(['generateCaseId', 'currentSemesterPrefix', '_usedFormerIdSeqs'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), // 學期前綴 1142
    casesData: [{ id: '1142001' }, { id: '1142003' }, { id: '1141009' }],
  });
  assert.equal(S.generateCaseId(), '1142004'); // 忽略他學期 1141009
});

test('generateCaseId：本學期尚無案號時從 001 起', () => {
  const S = load(['generateCaseId', 'currentSemesterPrefix', '_usedFormerIdSeqs'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
    casesData: [{ id: '1141009' }],
  });
  assert.equal(S.generateCaseId(), '1142001');
});

test('generateCaseId：曾用案號視為已占用，跳過該序號', () => {
  const S = load(['generateCaseId', 'currentSemesterPrefix', '_usedFormerIdSeqs'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
    casesData: [{ id: '1142001' }, { id: '1131099', formerIds: [{ id: '1142002', semesters: ['1142'] }] }],
  });
  assert.equal(S.generateCaseId(), '1142003'); // 跳過已被當作曾用案號的 1142002
});

test('getCaseChunkName：每 20 號一塊、跨塊邊界正確', () => {
  const S = load(['getCaseChunkName'], { CHUNK_SIZE: 20 });
  assert.equal(S.getCaseChunkName('1142001'), '114/1142001-1142020');
  assert.equal(S.getCaseChunkName('1142020'), '114/1142001-1142020'); // 塊尾
  assert.equal(S.getCaseChunkName('1142021'), '114/1142021-1142040'); // 下一塊起點
  assert.equal(S.getCaseChunkName('1142000'), '114/1142misc');        // 序號 0
  assert.equal(S.getCaseChunkName('abc'), 'misc');                    // 長度非 7
});

// ── 請假期間與年度視窗 ─────────────────────────────────────────────────────────
test('_isValidMMDD：MM-DD 格式與範圍檢查', () => {
  const S = load(['_isValidMMDD']);
  assert.equal(S._isValidMMDD('07-01'), true);
  assert.equal(S._isValidMMDD('12-31'), true);
  assert.equal(S._isValidMMDD('13-01'), false); // 月份越界
  assert.equal(S._isValidMMDD('00-05'), false);
  assert.equal(S._isValidMMDD('07-32'), false); // 日越界
  assert.equal(S._isValidMMDD('7-1'), false);   // 需補零
  assert.equal(S._isValidMMDD(''), false);
});

test('_dateInLeavePeriod：同年區間', () => {
  const S = load(['_dateInLeavePeriod', '_isValidMMDD']);
  const summer = { periodStart: '07-01', periodEnd: '08-31' };
  assert.equal(S._dateInLeavePeriod(summer, '2026-07-15'), true);
  assert.equal(S._dateInLeavePeriod(summer, '2026-07-01'), true); // 邊界含
  assert.equal(S._dateInLeavePeriod(summer, '2026-08-31'), true); // 邊界含
  assert.equal(S._dateInLeavePeriod(summer, '2026-06-30'), false);
  assert.equal(S._dateInLeavePeriod(summer, '2026-09-01'), false);
});

test('_dateInLeavePeriod：跨年區間與無限制', () => {
  const S = load(['_dateInLeavePeriod', '_isValidMMDD']);
  const winter = { periodStart: '12-01', periodEnd: '01-31' };
  assert.equal(S._dateInLeavePeriod(winter, '2026-12-15'), true);
  assert.equal(S._dateInLeavePeriod(winter, '2026-01-10'), true);
  assert.equal(S._dateInLeavePeriod(winter, '2026-06-01'), false);
  assert.equal(S._dateInLeavePeriod({}, '2026-06-01'), true); // 無期間設定 = 全年
});

test('_leavePeriodWindow：本次週期的實際年份區間', () => {
  const S = load(['_leavePeriodWindow', '_isValidMMDD'], { _fmtDate: () => '2026-06-15' });
  const summer = { periodStart: '07-01', periodEnd: '08-31' };
  assert.deepEqual(S._leavePeriodWindow(summer, '2026-07-15'),
    { start: '2026-07-01', end: '2026-08-31' });

  const winter = { periodStart: '12-01', periodEnd: '01-31' };
  // ref 落在年末側 → 週期起於當年、迄於次年
  assert.deepEqual(S._leavePeriodWindow(winter, '2026-12-15'),
    { start: '2026-12-01', end: '2027-01-31' });
  // ref 落在年初側 → 週期起於前一年
  assert.deepEqual(S._leavePeriodWindow(winter, '2026-01-10'),
    { start: '2025-12-01', end: '2026-01-31' });

  assert.equal(S._leavePeriodWindow({}, '2026-06-15'), null); // 非週期型
});

test('_leavePeriodLabel：期間標籤', () => {
  const S = load(['_leavePeriodLabel', '_isValidMMDD']);
  assert.equal(S._leavePeriodLabel({ periodStart: '07-01', periodEnd: '08-31' }), '07-01 ~ 08-31');
  assert.equal(S._leavePeriodLabel({}), '全年');
});

// ── 系所 → 學院對照 ────────────────────────────────────────────────────────────
test('getCollegeFromDept：查對照表、查不到回空字串', () => {
  const S = load(['getCollegeFromDept'], {
    _getDeptToCollege: () => ({ '資訊管理系': '管理學院', '獸醫學系': '獸醫學院' }),
  });
  assert.equal(S.getCollegeFromDept('資訊管理系'), '管理學院');
  assert.equal(S.getCollegeFromDept('獸醫學系'), '獸醫學院');
  assert.equal(S.getCollegeFromDept('不存在的系'), '');
});
