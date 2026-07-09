// 個案合併遷移 dry-run 驗證強化（v156）純函式單元測試：
// _maskIdNumber（身分證遮罩）、_migIdentityConflicts（組內識別衝突）、
// _caseInternalIdMismatch（案內混人偵測，陳彥廷情境）、_sameNameDiffIdSets（同名不同人彙總）、
// 以及三者併入 _buildMergePlan() 後的整合行為（identityConflict 預設取消勾選、internalMismatches／sameNameDiffIdSets 輸出）。
// 執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function loadIdentityFns(extra = {}) {
  return load(
    ['_maskIdNumber', '_migIdentityConflicts', '_caseInternalIdMismatch', '_sameNameDiffIdSets',
      '_buildMergePlan', '_caseSems', '_semKeyBase', 'openDateToSemPrefix'],
    extra
  );
}

// ── _maskIdNumber：身分證字號遮罩（僅前1碼＋後3碼） ─────────────────────────

test('_maskIdNumber：空值回傳空字串', () => {
  const S = loadIdentityFns();
  assert.equal(S._maskIdNumber(''), '');
  assert.equal(S._maskIdNumber(undefined), '');
  assert.equal(S._maskIdNumber(null), '');
});

test('_maskIdNumber：10 碼身分證字號 → 前1碼＋6顆星＋後3碼', () => {
  const S = loadIdentityFns();
  assert.equal(S._maskIdNumber('A123456789'), 'A＊＊＊＊＊＊789');
});

test('_maskIdNumber：長度≤4 太短，無可遮罩空間，原樣顯示', () => {
  const S = loadIdentityFns();
  assert.equal(S._maskIdNumber('AB12'), 'AB12');
  assert.equal(S._maskIdNumber('A1'), 'A1');
});

test('_maskIdNumber：5 碼時中間僅 1 顆星', () => {
  const S = loadIdentityFns();
  assert.equal(S._maskIdNumber('A1234'), 'A＊234');
});

// ── _migIdentityConflicts：組內識別衝突偵測 ────────────────────────────────

test('_migIdentityConflicts：一致組（學號、身分證皆相同）→ 無衝突、資料完整', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: 'S001', idNumber: 'A123456789' },
    { id: '1142002', studentId: 'S001', idNumber: 'A123456789' },
  ]);
  assert.equal(r.hasConflict, false);
  assert.equal(r.incomplete, false);
  assert.deepEqual(r.conflicts, []);
});

test('_migIdentityConflicts：學號不一致 → 衝突，conflicts 標明 studentId 欄位與兩案號的值', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: 'S001', idNumber: 'A123456789' },
    { id: '1142002', studentId: 'S002', idNumber: 'A123456789' },
  ]);
  assert.equal(r.hasConflict, true);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].field, 'studentId');
  assert.deepEqual(r.conflicts[0].entries.map(e => e.value).sort(), ['S001', 'S002']);
});

test('_migIdentityConflicts：身分證不一致 → 衝突，conflicts 標明 idNumber 欄位', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: 'S001', idNumber: 'A123456789' },
    { id: '1142002', studentId: 'S001', idNumber: 'B987654321' },
  ]);
  assert.equal(r.hasConflict, true);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].field, 'idNumber');
});

test('_migIdentityConflicts：兩欄位同時不一致 → conflicts 含兩筆', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: 'S001', idNumber: 'A123456789' },
    { id: '1142002', studentId: 'S002', idNumber: 'B987654321' },
  ]);
  assert.equal(r.hasConflict, true);
  assert.equal(r.conflicts.length, 2);
});

test('_migIdentityConflicts：空值不算衝突，但標記識別資料不全', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: 'S001', idNumber: '' },
    { id: '1142002', studentId: 'S001', idNumber: 'A123456789' },
  ]);
  assert.equal(r.hasConflict, false); // 只有一筆非空值，不構成衝突
  assert.equal(r.incomplete, true);
});

test('_migIdentityConflicts：全部欄位皆空 → 不衝突但不完整', () => {
  const S = loadIdentityFns();
  const r = S._migIdentityConflicts([
    { id: '1131001', studentId: '', idNumber: '' },
    { id: '1142002', studentId: '', idNumber: '' },
  ]);
  assert.equal(r.hasConflict, false);
  assert.equal(r.incomplete, true);
});

// ── _caseInternalIdMismatch：案內混人偵測（陳彥廷情境） ─────────────────────

test('_caseInternalIdMismatch：root 與各學期快照全部一致 → 無混人', () => {
  const S = loadIdentityFns();
  const c = {
    id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001',
    basicInfoSnapshots: {
      '1131': { studentId: 'S100', idNumber: 'A100000001' },
      '1142': { studentId: 'S100', idNumber: 'A100000001' },
    },
  };
  const r = S._caseInternalIdMismatch(c);
  assert.equal(r.mismatch, false);
  assert.deepEqual(r.studentIdVariants, ['S100']);
});

test('_caseInternalIdMismatch：不同學期快照學號不同 → 疑似混人', () => {
  const S = loadIdentityFns();
  const c = {
    id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001',
    basicInfoSnapshots: {
      '1131': { studentId: 'S100', idNumber: 'A100000001' },
      '1142': { studentId: 'S999', idNumber: 'A999999999' }, // 不同人混進來
    },
  };
  const r = S._caseInternalIdMismatch(c);
  assert.equal(r.mismatch, true);
  assert.deepEqual(r.studentIdVariants.sort(), ['S100', 'S999']);
  assert.deepEqual(r.idNumberVariants.sort(), ['A100000001', 'A999999999']);
});

test('_caseInternalIdMismatch：root 欄位與快照不一致（僅 root 錯置）也算混人', () => {
  const S = loadIdentityFns();
  const c = {
    id: '1131013', name: '陳彥廷', studentId: 'S999', idNumber: 'A100000001', // root studentId 與快照不同
    basicInfoSnapshots: {
      '1131': { studentId: 'S100', idNumber: 'A100000001' },
    },
  };
  const r = S._caseInternalIdMismatch(c);
  assert.equal(r.mismatch, true);
  assert.deepEqual(r.studentIdVariants.sort(), ['S100', 'S999']);
});

test('_caseInternalIdMismatch：無 basicInfoSnapshots，只有 root → 不構成混人', () => {
  const S = loadIdentityFns();
  const c = { id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001' };
  const r = S._caseInternalIdMismatch(c);
  assert.equal(r.mismatch, false);
});

// ── _sameNameDiffIdSets：同名同姓、識別欄位不同（未合併）彙總 ────────────────

test('_sameNameDiffIdSets：同名但學號／身分證皆不同 → 回傳 2 個 cluster', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001' },
    { id: '1131008', name: '陳彥廷', studentId: 'S200', idNumber: 'B200000002' },
  ];
  const r = S._sameNameDiffIdSets(cases);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, '陳彥廷');
  assert.equal(r[0].clusters.length, 2);
});

test('_sameNameDiffIdSets：同名且識別欄位相同（同一人多筆）→ 不列入（只有 1 cluster）', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131001', name: '甲生', studentId: 'S001', idNumber: 'A123456789' },
    { id: '1142002', name: '甲生', studentId: 'S001', idNumber: 'A123456789' },
  ];
  const r = S._sameNameDiffIdSets(cases);
  assert.equal(r.length, 0);
});

test('_sameNameDiffIdSets：三筆同名，兩筆同一人＋一筆不同人 → 仍回傳 2 個 cluster', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131001', name: '乙生', studentId: 'S010', idNumber: '' },
    { id: '1142002', name: '乙生', studentId: 'S010', idNumber: '' }, // 與上面同學號，同一人
    { id: '1142003', name: '乙生', studentId: 'S020', idNumber: '' }, // 不同學號，不同人
  ];
  const r = S._sameNameDiffIdSets(cases);
  assert.equal(r.length, 1);
  assert.equal(r[0].clusters.length, 2);
});

test('_sameNameDiffIdSets：已刪除（deleted）的個案不納入', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001' },
    { id: '1131008', name: '陳彥廷', studentId: 'S200', idNumber: 'B200000002', deleted: true },
  ];
  const r = S._sameNameDiffIdSets(cases);
  assert.equal(r.length, 0); // 只剩一筆未刪除，無同名可比
});

test('_sameNameDiffIdSets：姓名不同或缺姓名不納入分群', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131001', name: '甲生', studentId: 'S001' },
    { id: '1142002', name: '乙生', studentId: 'S002' },
    { id: '1142003', studentId: 'S003' }, // 無姓名
  ];
  const r = S._sameNameDiffIdSets(cases);
  assert.equal(r.length, 0);
});

// ── 整合：_buildMergePlan() 併入識別衝突／案內混人／同名同姓彙總 ─────────────

test('_buildMergePlan：合併組內學號一致但身分證不同 → identityConflict 為 true 且預設應取消勾選', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131020', name: '甲生', studentId: 'S300', idNumber: 'B123456789', openDate: '2024-09-01', semesters: ['1131'] },
    { id: '1142021', name: '甲生', studentId: 'S300', idNumber: 'C987654321', openDate: '2025-03-01', semesters: ['1142'] },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 1);
  const g = plan.groups[0];
  assert.equal(g.identityConflict, true);
  assert.equal(g.identityConflictDetails.length, 1);
  assert.equal(g.identityConflictDetails[0].field, 'idNumber');
  // 每個成員的識別欄位應附在 g.members 供報告顯示
  assert.equal(g.members.length, 2);
  assert.ok(g.members.some(m => m.id === '1131020' && m.studentId === 'S300'));
});

test('_buildMergePlan：識別欄位皆一致 → identityConflict 為 false', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131005', name: '甲生', studentId: 'S001', idNumber: 'A123456789', openDate: '2024-09-01', semesters: ['1131'] },
    { id: '1142010', name: '甲生', studentId: 'S001', idNumber: 'A123456789', openDate: '2025-03-01', semesters: ['1142'] },
  ];
  const plan = S._buildMergePlan(cases);
  const g = plan.groups[0];
  assert.equal(g.identityConflict, false);
  assert.equal(g.identityIncomplete, false);
});

test('_buildMergePlan：組內某成員案內混人（縱使 root 學號一致）→ 該組也自動標識別衝突', () => {
  const S = loadIdentityFns();
  const cases = [
    {
      id: '1131040', name: '丙生', studentId: 'S500', openDate: '2024-09-01', semesters: ['1131'],
      basicInfoSnapshots: { '1131': { studentId: 'S500' }, '1142': { studentId: 'S600' } }, // 案內混人
    },
    { id: '1142041', name: '丙生', studentId: 'S500', openDate: '2025-03-01', semesters: ['1142'] },
  ];
  const plan = S._buildMergePlan(cases);
  const g = plan.groups.find(x => x.targetId === '1131040' || x.sourceIds.includes('1131040'));
  assert.ok(g);
  assert.equal(g.identityConflict, true);
  assert.equal(g.identityInternalMismatchMember, true);
});

test('_buildMergePlan：internalMismatches 全量掃描——即使該案號沒有合併對象也要列出', () => {
  const S = loadIdentityFns();
  const cases = [
    {
      id: '1131013', name: '陳彥廷', studentId: 'S100', openDate: '2024-09-01', semesters: ['1131', '1142'],
      basicInfoSnapshots: {
        '1131': { studentId: 'S100', idNumber: 'A100000001' },
        '1142': { studentId: 'S999', idNumber: 'A999999999' }, // 不同人混入同一案號
      },
    },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 0); // 沒有第二筆案號可合併
  assert.equal(plan.internalMismatches.length, 1);
  assert.equal(plan.internalMismatches[0].id, '1131013');
  assert.deepEqual(plan.internalMismatches[0].studentIdVariants.sort(), ['S100', 'S999']);
});

test('_buildMergePlan：sameNameDiffIdSets 併入回傳（陳彥廷情境：同名不同人未合併）', () => {
  const S = loadIdentityFns();
  const cases = [
    { id: '1131013', name: '陳彥廷', studentId: 'S100', idNumber: 'A100000001', openDate: '2024-09-01' },
    { id: '1131008', name: '陳彥廷', studentId: 'S200', idNumber: 'B200000002', openDate: '2024-09-02' },
  ];
  const plan = S._buildMergePlan(cases);
  assert.equal(plan.groups.length, 0); // 學號、身分證皆不同，不會被合併
  assert.equal(plan.sameNameDiffIdSets.length, 1);
  assert.equal(plan.sameNameDiffIdSets[0].name, '陳彥廷');
  assert.equal(plan.sameNameDiffIdSets[0].clusters.length, 2);
});
