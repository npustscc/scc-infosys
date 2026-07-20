// test/freshman-test-tutorsync.test.js — 新生心理測驗（v209 Slice 3）導師名冊 tutorsys 同步：
// 前端純函式（衝突 diff／學院解析 fallback 鏈／博班補列／同步結果套用）。抽出對象皆為
// dev/index.html 內無 DOM 依賴的純函式（見 test/harness.js）。fixture 一律用假班級/假姓名，
// 不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

// ══════════════ 同步差異偵測（新增/衝突/無異動/刪除）══════════════

test('_ftTutorSyncDiff：本地空 → 全部歸入 newRows，無 conflicts/removed（首次同步）', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTutorSyncDiff', '_ftTrimCell']);
  const incoming = [{ cells: { class_abbr: '四農園一A', tutor_name: '王小明' } }];
  const r = S._ftTutorSyncDiff([], incoming, 'class_abbr');
  assert.equal(r.newRows.length, 1);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.removed.length, 0);
});

test('_ftTutorSyncDiff：本地既有值與同步值不同 → conflicts；tutorsys 已無的本地班級 → removed', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTutorSyncDiff', '_ftTrimCell']);
  const existing = [
    { cells: { class_abbr: '四農園一A', tutor_name: '舊導師' } },
    { cells: { class_abbr: '四農園二A', tutor_name: '已離職導師' } }, // tutorsys 已無此班級
  ];
  const incoming = [
    { cells: { class_abbr: '四農園一A', tutor_name: '新導師' } },
  ];
  const r = S._ftTutorSyncDiff(existing, incoming, 'class_abbr');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].key, '四農園一A');
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].cells.class_abbr, '四農園二A');
});

test('_ftTutorSyncDiff：完全相同 → unchanged，不進 conflicts/removed', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTutorSyncDiff', '_ftTrimCell']);
  const existing = [{ cells: { class_abbr: '四農園一A', tutor_name: '王小明' } }];
  const incoming = [{ cells: { class_abbr: '四農園一A', tutor_name: '王小明' } }];
  const r = S._ftTutorSyncDiff(existing, incoming, 'class_abbr');
  assert.equal(r.unchanged.length, 1);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.removed.length, 0);
});

// ══════════════ 套用同步結果 ══════════════

test('_ftApplyTutorSyncResult：勾選取代的衝突套用新值、未勾選維持舊值、新增列附加、勾選刪除的列移除', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTutorSyncDiff', '_ftBuildImportFinalRows', '_ftApplyTutorSyncResult', '_ftTrimCell']);
  const existing = [
    { _id: 'r1', cells: { class_abbr: 'A班', tutor_name: '舊導師A' } },
    { _id: 'r2', cells: { class_abbr: 'B班', tutor_name: '舊導師B' } },
    { _id: 'r3', cells: { class_abbr: 'C班', tutor_name: '已刪班級導師' } },
  ];
  const incoming = [
    { cells: { class_abbr: 'A班', tutor_name: '新導師A' } }, // 衝突，勾選取代
    { cells: { class_abbr: 'B班', tutor_name: '新導師B' } }, // 衝突，不勾選
    { cells: { class_abbr: 'D班', tutor_name: '新班級導師' } }, // 新增
  ];
  const diff = S._ftTutorSyncDiff(existing, incoming, 'class_abbr');
  const accepted = new Set(['A班']);
  const deleteKeys = new Set(['C班']);
  const final = S._ftApplyTutorSyncResult(existing, diff, accepted, deleteKeys);
  const byClass = Object.fromEntries(final.map(r => [r.cells.class_abbr, r.cells.tutor_name]));
  assert.equal(byClass['A班'], '新導師A');
  assert.equal(byClass['B班'], '舊導師B');
  assert.equal(byClass['D班'], '新班級導師');
  assert.ok(!('C班' in byClass)); // 已勾選刪除
  assert.equal(final.length, 3);
});

test('_ftApplyTutorSyncResult：首次同步（本地空）→ 直接全帶入，不需要特判', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTutorSyncDiff', '_ftBuildImportFinalRows', '_ftApplyTutorSyncResult', '_ftTrimCell']);
  const incoming = [
    { cells: { class_abbr: 'A班', tutor_name: '導師A' } },
    { cells: { class_abbr: 'B班', tutor_name: '導師B' } },
  ];
  const diff = S._ftTutorSyncDiff([], incoming, 'class_abbr');
  const final = S._ftApplyTutorSyncResult([], diff, new Set(), new Set());
  assert.equal(final.length, 2);
});

// ══════════════ 系所核心詞比對 ══════════════

test('_ftDeptCore：去除常見尾綴', () => {
  const S = load_(['_ftDeptCore']);
  assert.equal(S._ftDeptCore('農園系'), '農園');
  assert.equal(S._ftDeptCore('農園生產系'), '農園生產');
  assert.equal(S._ftDeptCore('動疫所'), '動疫');
  assert.equal(S._ftDeptCore('財務金融國際學士學位學程'), '財務金融國際');
  assert.equal(S._ftDeptCore(''), '');
});

test('_ftDeptCoreMatches：核心詞雙向子字串比對', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches']);
  assert.ok(S._ftDeptCoreMatches('農園系', '農園生產系'));
  assert.ok(!S._ftDeptCoreMatches('資管系', '農園生產系'));
  assert.ok(!S._ftDeptCoreMatches('', '農園生產系'));
});

// ══════════════ 學院解析 fallback 鏈 ══════════════

test('_ftResolveDeptCollege：deptToCollege 精確 key 命中 → 直接回傳', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege']);
  const deptToCollege = { '農園生產系': '農學院' };
  assert.equal(S._ftResolveDeptCollege('農園生產系', deptToCollege, []), '農學院');
});

test('_ftResolveDeptCollege：deptToCollege 無精確 key，模糊比對命中 → fallback①', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege']);
  const deptToCollege = { '農園生產系': '農學院', '獸醫學系': '獸醫學院' };
  assert.equal(S._ftResolveDeptCollege('農園系', deptToCollege, []), '農學院');
});

test('_ftResolveDeptCollege：deptToCollege 完全查無 → 改用 studentsDeptCollegePairs 猜 fallback②', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege']);
  const pairs = [{ deptName: '農園生產系', college: '農學院' }];
  assert.equal(S._ftResolveDeptCollege('農園系', {}, pairs), '農學院');
});

test('_ftResolveDeptCollege：兩者皆查無 → 無法分類', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege']);
  assert.equal(S._ftResolveDeptCollege('不存在系', {}, []), '無法分類');
  assert.equal(S._ftResolveDeptCollege('', { 'x': 'y' }, []), '無法分類');
});

// ══════════════ 系所紀錄模糊比對（系主任查找用）══════════════

test('_ftMatchDeptRecord：精確 id/name 命中優先於模糊比對', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftMatchDeptRecord']);
  const departments = [{ id: '農園系', name: '農園系', headEmail: 'a@x.com', headName: '甲系主任' }];
  const r = S._ftMatchDeptRecord('農園系', departments);
  assert.equal(r.headName, '甲系主任');
});

test('_ftMatchDeptRecord：查無比對 → null', () => {
  const S = load_(['_ftDeptCore', '_ftDeptCoreMatches', '_ftMatchDeptRecord']);
  assert.equal(S._ftMatchDeptRecord('不存在系', []), null);
});

// ══════════════ 主組裝函式：一般班級＋博班補列 ══════════════

test('_ftAssembleTutorSyncRows：一般 active class 組出一列，導師/Email 以「、」串接多筆', () => {
  const S = load_([
    '_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege', '_ftMatchDeptRecord',
    '_ftCollectStudentsDeptCollegePairs', '_ftAssembleTutorSyncRows',
  ]);
  const classes = [{
    id: 'c1', deptId: '農園系', displayName: '四農園一A',
    tutors: [{ name: '王小明', email: 'wang@test.local' }, { name: '陳小華', email: 'chen@test.local' }],
  }];
  const departments = [{ id: '農園系', name: '農園系', headEmail: '', headName: '' }];
  const deptToCollege = { '農園生產系': '農學院' };
  const rows = S._ftAssembleTutorSyncRows({ classes, departments, studentsRows: [], deptToCollege });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.class_abbr, '四農園一A');
  assert.equal(rows[0].cells.dept, '農園系');
  assert.equal(rows[0].cells.college, '農學院'); // fallback①模糊比對命中
  assert.equal(rows[0].cells.tutor_name, '王小明、陳小華');
  assert.equal(rows[0].cells.tutor_email, 'wang@test.local、chen@test.local');
  assert.equal(rows[0].cells.note, '');
});

test('_ftAssembleTutorSyncRows：博班補列——tutorsys 未涵蓋的「博」開頭班級簡稱自動補列，導師=系主任', () => {
  const S = load_([
    '_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege', '_ftMatchDeptRecord',
    '_ftCollectStudentsDeptCollegePairs', '_ftAssembleTutorSyncRows',
  ]);
  const classes = []; // tutorsys 無博士班班級（見 memory）
  const departments = [{ id: '生資博', name: '生物資源博士班', headEmail: 'head@test.local', headName: '博班系主任' }];
  const studentsRows = [
    { cells: { stu_id: 'B99999999', name_zh: '測試員甲', class_abbr: '博生資一A', dept_name: '生物資源博士班', college: '農學院' } },
  ];
  const rows = S._ftAssembleTutorSyncRows({ classes, departments, studentsRows, deptToCollege: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.class_abbr, '博生資一A');
  assert.equal(rows[0].cells.tutor_name, '博班系主任');
  assert.equal(rows[0].cells.tutor_email, 'head@test.local');
  assert.equal(rows[0].cells.note, '系主任（博士班預設）');
  assert.equal(rows[0].cells.college, '農學院'); // fallback② studentsRows 配對猜中
});

test('_ftAssembleTutorSyncRows：博班補列——查無系主任資料時備註加註「查無系主任資料」，導師/Email 留空', () => {
  const S = load_([
    '_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege', '_ftMatchDeptRecord',
    '_ftCollectStudentsDeptCollegePairs', '_ftAssembleTutorSyncRows',
  ]);
  const studentsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲', class_abbr: '博不存在系一A', dept_name: '不存在系', college: '' } },
  ];
  const rows = S._ftAssembleTutorSyncRows({ classes: [], departments: [], studentsRows, deptToCollege: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.tutor_name, '');
  assert.equal(rows[0].cells.tutor_email, '');
  assert.match(rows[0].cells.note, /查無系主任資料/);
});

test('_ftAssembleTutorSyncRows：tutorsys 已涵蓋的班級簡稱（即使「博」開頭）不重複補列', () => {
  const S = load_([
    '_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege', '_ftMatchDeptRecord',
    '_ftCollectStudentsDeptCollegePairs', '_ftAssembleTutorSyncRows',
  ]);
  const classes = [{ id: 'c1', deptId: '生資系', displayName: '博生資一A', tutors: [{ name: '既有導師', email: 'a@x.com' }] }];
  const studentsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲', class_abbr: '博生資一A', dept_name: '生資系', college: '' } },
  ];
  const rows = S._ftAssembleTutorSyncRows({ classes, departments: [], studentsRows, deptToCollege: {} });
  assert.equal(rows.length, 1); // 沒有補第二列
  assert.equal(rows[0].cells.tutor_name, '既有導師');
});

test('_ftAssembleTutorSyncRows：非「博」開頭且 tutorsys 未涵蓋的班級簡稱不補列（只有博班才補）', () => {
  const S = load_([
    '_ftDeptCore', '_ftDeptCoreMatches', '_ftResolveDeptCollege', '_ftMatchDeptRecord',
    '_ftCollectStudentsDeptCollegePairs', '_ftAssembleTutorSyncRows',
  ]);
  const studentsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲', class_abbr: '四某系一A', dept_name: '某系', college: '' } },
  ];
  const rows = S._ftAssembleTutorSyncRows({ classes: [], departments: [], studentsRows, deptToCollege: {} });
  assert.equal(rows.length, 0);
});

// ══════════════ 收集 students (系所全名,學院) 唯一配對 ══════════════

test('_ftCollectStudentsDeptCollegePairs：去重，缺 dept 或 college 的列跳過', () => {
  const S = load_(['_ftCollectStudentsDeptCollegePairs']);
  const rows = [
    { cells: { dept_name: '農園生產系', college: '農學院' } },
    { cells: { dept_name: '農園生產系', college: '農學院' } }, // 重複
    { cells: { dept_name: '', college: '農學院' } }, // 缺 dept
    { cells: { dept_name: '獸醫學系', college: '' } }, // 缺 college
  ];
  const pairs = S._ftCollectStudentsDeptCollegePairs(rows);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], { deptName: '農園生產系', college: '農學院' });
});
