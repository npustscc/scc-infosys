// 個案架構重構 Slice 2：一學生一案號遷移引擎（合併＋主號↔曾用號對調）純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const BASIC_INFO_SNAPSHOT_FIELDS = [
  'name', 'legalGender', 'genderIdentity', 'studentId', 'birthday', 'idNumber',
  'nationality', 'foreignCountry', 'ethnicity', 'ethnicityNote',
  'caseType', 'abType', 'bCaseReasons', 'program', 'department', 'grade', 'classNo', 'disability',
  'phone', 'email', 'residence', 'address',
  'emergencyName', 'emergencyPhone', 'emergencyRelation',
  'source', 'pastRecords', 'topics',
  'bsrs', 'bsrsTotal', 'bsrs6',
  'counselorText', 'counselorName', 'counselorEmail',
  'openDate',
];

function loadMergeFns(extra = {}) {
  return load(
    ['_buildMergePlan', '_mergeCaseGroup', '_swapFormerId', '_migApplyCustomId', '_caseSems', '_semKeyBase', '_recomputeCaseStatus', 'openDateToSemPrefix',
      '_migIdentityConflicts', '_caseInternalIdMismatch', '_sameNameDiffIdSets'],
    { BASIC_INFO_SNAPSHOT_FIELDS, ...extra }
  );
}

// ── _buildMergePlan：分組＋選主號＋衝突偵測 ──────────────────────────────

test('_buildMergePlan：不同學期兩筆合併，選 openDate 最早者為主號', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1131005', studentId: 'S001', name: '甲生', openDate: '2024-09-01', semesters: ['1131'] },
    { id: '1142010', studentId: 'S001', name: '甲生', openDate: '2025-03-01', semesters: ['1142'] },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 1);
  const g = plan.groups[0];
  assert.equal(g.targetId, '1131005');
  assert.deepEqual(g.sourceIds, ['1142010']);
  assert.equal(g.semConflicts.length, 0);
  assert.equal(g.nameMismatch, false);
});

test('_buildMergePlan：同日開案取案號數字較小者為主號', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1142010', studentId: 'S002', name: '乙生', openDate: '2025-03-01', semesters: ['1142'] },
    { id: '1142003', studentId: 'S002', name: '乙生', openDate: '2025-03-01', semesters: ['1142#2'] },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups[0].targetId, '1142003');
});

test('_buildMergePlan：以身分證字號比對（學號不同或空）也視為同一學生', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1131001', idNumber: 'A123456789', name: '丙生', openDate: '2024-09-01' },
    { id: '1142002', idNumber: 'A123456789', name: '丙生', openDate: '2025-03-01' },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 1);
});

test('_buildMergePlan：學號、身分證皆空或不相符 → 不分組', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1131001', name: '丁生', openDate: '2024-09-01' },
    { id: '1142002', name: '丁生', openDate: '2025-03-01' },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 0);
});

test('_buildMergePlan：已刪除（deleted）的 record 不納入分組', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1131001', studentId: 'S003', name: '戊生', openDate: '2024-09-01' },
    { id: '1142002', studentId: 'S003', name: '戊生', openDate: '2025-03-01', deleted: true },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 0);
});

test('_buildMergePlan：偵測同學期衝突（兩筆同 base 學期）與姓名不一致', () => {
  const S = loadMergeFns();
  const cases = [
    { id: '1142001', studentId: 'S004', name: '己生', openDate: '2025-03-01', semesters: ['1142'] },
    { id: '1142005', studentId: 'S004', name: '己生（更名）', openDate: '2025-03-05', semesters: ['1142'] },
  ];
  const plan = S._buildMergePlan(cases);
  const g = plan.groups[0];
  assert.equal(g.semConflicts.length, 1);
  assert.equal(g.semConflicts[0].semBase, '1142');
  assert.deepEqual(g.semConflicts[0].ids.sort(), ['1142001', '1142005']);
  assert.equal(g.nameMismatch, true);
});

// ── _mergeCaseGroup：實際合併（就地修改 target） ─────────────────────────

test('_mergeCaseGroup：不同學期合併 — semesters 聯集、per-sem map 折入、formerIds 正確', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131'],
    basicInfoSnapshots: { '1131': { counselorEmail: 'a@x.com' } }, semesterStatus: { '1131': 'closed' } };
  const source = { id: '1142010', name: '甲生', openDate: '2025-03-01', semesters: ['1142'],
    basicInfoSnapshots: { '1142': { counselorEmail: 'b@x.com' } }, semesterStatus: { '1142': 'active' } };
  const { sourceRemaps } = S._mergeCaseGroup(target, [source]);

  assert.deepEqual(target.semesters, ['1131', '1142']);
  assert.deepEqual(target.basicInfoSnapshots['1142'], { counselorEmail: 'b@x.com' });
  assert.equal(target.semesterStatus['1142'], 'active');
  assert.deepEqual(target.formerIds, [{ id: '1142010', semesters: ['1142'] }]);
  assert.deepEqual(target.mainIdSems, ['1131']); // 主號自己原生學期，供日後對調用
  assert.equal(sourceRemaps.length, 1);
  assert.deepEqual(sourceRemaps[0], { id: '1142010', semKeyMap: { '1142': '1142' } });
});

test('_mergeCaseGroup：同學期衝突 — 來源 semKey 變 #2，per-sem map／semesterEvaluations 一起 remap', () => {
  const S = loadMergeFns();
  const target = { id: '1142001', name: '己生', openDate: '2025-03-01', semesters: ['1142'],
    basicInfoSnapshots: { '1142': { counselorEmail: 'a@x.com' } },
    semesterStatus: { '1142': 'active' },
    semesterEvaluations: [{ semester: '1142', type: 'semester', light: '綠燈' }] };
  const source = { id: '1142005', name: '己生', openDate: '2025-03-05', semesters: ['1142'],
    basicInfoSnapshots: { '1142': { counselorEmail: 'b@x.com' } },
    semesterStatus: { '1142': 'closed' },
    semesterEvaluations: [{ semester: '1142', type: 'closure', light: '紅燈' }] };
  const { sourceRemaps } = S._mergeCaseGroup(target, [source]);

  assert.deepEqual(target.semesters, ['1142', '1142#2']);
  assert.equal(sourceRemaps[0].semKeyMap['1142'], '1142#2');
  // target 既有 key 不被覆蓋
  assert.deepEqual(target.basicInfoSnapshots['1142'], { counselorEmail: 'a@x.com' });
  assert.deepEqual(target.basicInfoSnapshots['1142#2'], { counselorEmail: 'b@x.com' });
  assert.equal(target.semesterStatus['1142'], 'active');
  assert.equal(target.semesterStatus['1142#2'], 'closed');
  const closureEval = target.semesterEvaluations.find(e => e.type === 'closure');
  assert.equal(closureEval.semester, '1142#2'); // remap 後的 key
  assert.deepEqual(target.formerIds, [{ id: '1142005', semesters: ['1142#2'] }]);
});

test('_mergeCaseGroup：psychTestResults 依 testSemester 去重，target 既有優先', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131'],
    psychTestResults: [{ testSemester: '1131', AL: 50 }] };
  const source = { id: '1142010', name: '甲生', openDate: '2025-03-01', semesters: ['1142'],
    psychTestResults: [{ testSemester: '1131', AL: 99 }, { testSemester: '1142', AL: 60 }] };
  S._mergeCaseGroup(target, [source]);

  assert.equal(target.psychTestResults.length, 2);
  const t1131 = target.psychTestResults.find(t => t.testSemester === '1131');
  assert.equal(t1131.AL, 50); // target 既有優先，不被來源覆蓋
  const t1142 = target.psychTestResults.find(t => t.testSemester === '1142');
  assert.equal(t1142.AL, 60);
});

test('_mergeCaseGroup：root 欄位補缺不覆蓋 — target 已有值時保留，缺值時以來源補上', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131'],
    phone: '0900000000', email: '' };
  const source = { id: '1142010', name: '甲生', openDate: '2025-03-01', semesters: ['1142'],
    phone: '0911111111', email: 'a@x.com' };
  S._mergeCaseGroup(target, [source]);

  assert.equal(target.phone, '0900000000'); // target 已有，不覆蓋
  assert.equal(target.email, 'a@x.com');    // target 缺，來源補上
});

test('_mergeCaseGroup：records/psychiatristRecords/events 串接並依 date 排序', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131'],
    records: [{ date: '2024-10-01', summary: 'r1' }] };
  const source = { id: '1142010', name: '甲生', openDate: '2025-03-01', semesters: ['1142'],
    records: [{ date: '2025-03-10', summary: 'r2' }] };
  S._mergeCaseGroup(target, [source]);
  assert.equal(target.records.length, 2);
  assert.deepEqual(target.records.map(r => r.summary), ['r1', 'r2']);
});

// ── _swapFormerId：主號↔曾用號互換往返一致 ────────────────────────────────

test('_swapFormerId：對調後再對調回去，狀態應與原始一致（往返一致）', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131', '1142'],
    formerIds: [{ id: '1142010', semesters: ['1142'] }], mainIdSems: ['1131'] };
  const snapshot = JSON.parse(JSON.stringify(target));

  const r1 = S._swapFormerId(target, '1142010');
  assert.equal(r1.oldId, '1131005');
  assert.equal(r1.newId, '1142010');
  assert.equal(target.id, '1142010');
  assert.deepEqual(target.mainIdSems, ['1142']);
  assert.deepEqual(target.formerIds, [{ id: '1131005', semesters: ['1131'] }]);

  const r2 = S._swapFormerId(target, '1131005');
  assert.equal(r2.oldId, '1142010');
  assert.equal(r2.newId, '1131005');
  assert.equal(target.id, snapshot.id);
  assert.deepEqual(target.mainIdSems, snapshot.mainIdSems);
  assert.deepEqual(target.formerIds, snapshot.formerIds);
});

test('_swapFormerId：找不到指定的曾用案號時丟出錯誤', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', semesters: ['1131'], formerIds: [{ id: '1142010', semesters: ['1142'] }] };
  assert.throws(() => S._swapFormerId(target, '9999999'), /找不到曾用案號/);
});

// ── _mergeCaseGroup：使用者改選非最早筆當主號（target 覆寫） ─────────────────

test('_mergeCaseGroup：以較晚開案的 record 當 target 也正確 — formerIds 收最早那筆', () => {
  const S = loadMergeFns();
  const early = { id: '1131005', name: '甲生', openDate: '2024-09-01', semesters: ['1131'],
    semesterStatus: { '1131': 'closed' }, phone: '0900000000' };
  const late  = { id: '1142010', name: '甲生', openDate: '2025-03-01', semesters: ['1142'],
    semesterStatus: { '1142': 'active' } };
  S._mergeCaseGroup(late, [early]); // 使用者改選 1142010 當主號
  assert.deepEqual([...late.semesters].sort(), ['1131', '1142']);
  assert.equal(late.semesterStatus['1131'], 'closed');
  assert.deepEqual(late.formerIds, [{ id: '1131005', semesters: ['1131'] }]);
  assert.deepEqual(late.mainIdSems, ['1142']);
  assert.equal(late.phone, '0900000000'); // root 補缺一樣生效
});

// ── _migApplyCustomId：合併後主號改採自訂全新案號 ───────────────────────────

test('_migApplyCustomId：原主號入 formerIds（帶原生學期）、mainIdSems 清空、id 換自訂號', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', semesters: ['1131', '1142'],
    formerIds: [{ id: '1142010', semesters: ['1142'] }], mainIdSems: ['1131'] };
  const oldId = S._migApplyCustomId(target, '1149001');
  assert.equal(oldId, '1131005');
  assert.equal(target.id, '1149001');
  assert.deepEqual(target.mainIdSems, []); // 自訂號從未被使用過
  assert.deepEqual(target.formerIds, [
    { id: '1142010', semesters: ['1142'] },
    { id: '1131005', semesters: ['1131'] },
  ]);
});

test('_migApplyCustomId：套用自訂號後可 swap 回原主號，原生學期資訊不遺失', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', semesters: ['1131', '1142'],
    formerIds: [{ id: '1142010', semesters: ['1142'] }], mainIdSems: ['1131'] };
  S._migApplyCustomId(target, '1149001');
  const r = S._swapFormerId(target, '1131005');
  assert.equal(r.newId, '1131005');
  assert.equal(target.id, '1131005');
  assert.deepEqual(target.mainIdSems, ['1131']); // 原主號的原生學期還原
  // 自訂號退回曾用號（使用學期為空），另一曾用號不受影響
  assert.deepEqual(target.formerIds, [
    { id: '1142010', semesters: ['1142'] },
    { id: '1149001', semesters: [] },
  ]);
});

test('_migApplyCustomId：customId 與原 id 相同或為空 → 不動作', () => {
  const S = loadMergeFns();
  const target = { id: '1131005', semesters: ['1131'], mainIdSems: ['1131'] };
  S._migApplyCustomId(target, '1131005');
  S._migApplyCustomId(target, '');
  assert.equal(target.id, '1131005');
  assert.deepEqual(target.mainIdSems, ['1131']);
  assert.equal(target.formerIds, undefined);
});
