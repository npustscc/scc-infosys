// 差勤請假額度計算的單元測試（額度＝實習生能請多少假，算錯直接影響權益）。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// 測試用假別：暑休（週期型、扣抵、40hr）、事假（不扣抵）、加班補休（comp）
const TYPES = {
  summer:   { id: 'summer',   name: '暑休',     deductsQuota: true,  defaultQuotaHours: 40, periodStart: '07-01', periodEnd: '08-31' },
  personal: { id: 'personal', name: '事假',     deductsQuota: false },
  comp:     { id: 'comp',     name: '加班補休', deductsQuota: true,  isComp: true },
};

function loadLeaveFns(extra = {}) {
  return load(
    ['_leaveUsedHours', '_leaveRemaining', '_leaveQuotaHours',
     '_compEarnedHours', '_compUsedHours', '_compRemaining',
     '_leavePeriodWindow', '_isValidMMDD'],
    Object.assign({
      getLeaveType: (id) => TYPES[id],
      getLeaveTypes: () => Object.values(TYPES),
      _fmtDate: () => '2026-07-15', // _leaveRemaining 內部不帶 refDate 時的「今天」
      configData: { users: {} },
    }, extra)
  );
}

const APPS = [
  { id: '1', email: 'a', leaveTypeId: 'summer', status: 'approved', hours: 8, fromDate: '2026-07-10' },
  { id: '2', email: 'a', leaveTypeId: 'summer', status: 'pending',  hours: 4, fromDate: '2026-08-05' },
  { id: '3', email: 'a', leaveTypeId: 'summer', status: 'approved', hours: 8, fromDate: '2025-08-10' }, // 去年暑休 → 不計本期
  { id: '4', email: 'a', leaveTypeId: 'summer', status: 'rejected', hours: 8, fromDate: '2026-07-20' }, // 駁回 → 不計
  { id: '5', email: 'b', leaveTypeId: 'summer', status: 'approved', hours: 8, fromDate: '2026-07-11' }, // 他人 → 不計
];

test('_leaveUsedHours：只計本人、本假別、approved+pending、且在本期視窗內', () => {
  const S = loadLeaveFns({ leavesData: { applications: APPS } });
  assert.equal(S._leaveUsedHours('a', 'summer', null, '2026-07-15'), 12); // 8 + 4
});

test('_leaveUsedHours：excludeId 排除指定申請（編輯自己那筆時不重複佔用）', () => {
  const S = loadLeaveFns({ leavesData: { applications: APPS } });
  assert.equal(S._leaveUsedHours('a', 'summer', '2', '2026-07-15'), 8); // 排除 id=2 的 4hr
});

test('_leaveRemaining：扣抵型 = 額度 − 已用', () => {
  const S = loadLeaveFns({ leavesData: { applications: APPS } });
  assert.equal(S._leaveRemaining('a', 'summer', null), 28); // 40 − 12
});

test('_leaveRemaining：per-user 額度覆寫預設', () => {
  const S = loadLeaveFns({
    leavesData: { applications: APPS },
    configData: { users: { a: { leaveQuota: { summer: 24 } } } },
  });
  assert.equal(S._leaveRemaining('a', 'summer', null), 12); // 24 − 12
});

test('_leaveRemaining：不扣抵的假別回 null（無上限）', () => {
  const S = loadLeaveFns({ leavesData: { applications: [] } });
  assert.equal(S._leaveRemaining('a', 'personal', null), null);
});

test('_compRemaining / _leaveRemaining(comp)：已認證加班 − 已用補休', () => {
  const S = loadLeaveFns({ leavesData: { applications: [
    { id: 'o1', email: 'a', kind: 'overtime', status: 'approved', hours: 10 },            // 認證加班 → 賺 10
    { id: 'o2', email: 'a', kind: 'overtime', status: 'pending',  hours: 5 },             // 未認證 → 不算
    { id: 'c1', email: 'a', leaveTypeId: 'comp', status: 'approved', hours: 3 },          // 用掉 3
    { id: 'c2', email: 'a', leaveTypeId: 'comp', status: 'pending',  hours: 2 },          // 佔用 2
  ] } });
  assert.equal(S._compEarnedHours('a'), 10);
  assert.equal(S._compUsedHours('a', null), 5);
  assert.equal(S._compRemaining('a', null), 5);       // 10 − 5
  assert.equal(S._leaveRemaining('a', 'comp', null), 5); // isComp → 走 comp 餘額
});
