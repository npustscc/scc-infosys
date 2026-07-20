// v223：匯入衝突統一處理視窗（C 段）與整合 tab「以姓名比對」（一.12）的純函式測試。
// 抽自 dev/index.html，改壞邏輯即紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const S = load([
  '_ftBuildImportFinalRowsFromGroups',
  '_ftImportResolvePageSlice',
  '_ftImportResolveTotalPages',
  '_ftUnmatchedNameCandidates',
]);

test('_ftBuildImportFinalRowsFromGroups：有 workingCells 的既有列被取代、其餘保留、新增列附加', () => {
  const rowA = { _id: 'a', cells: { stu_id: '1', name_zh: '甲', score: '10' } };
  const rowB = { _id: 'b', cells: { stu_id: '2', name_zh: '乙', score: '20' } };
  const existing = [rowA, rowB];
  const newRows = [{ cells: { stu_id: '3', name_zh: '丙' } }];
  const resolved = [{ existing: rowA, workingCells: { stu_id: '1', name_zh: '甲', score: '99' } }];
  const out = S._ftBuildImportFinalRowsFromGroups(existing, newRows, resolved);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].cells.score, '99');      // rowA 被 workingCells 取代
  assert.strictEqual(out[0]._id, 'a');               // 其餘欄位（_id）保留
  assert.strictEqual(out[1].cells.score, '20');      // rowB 未在 resolvedGroups → 原樣保留
  assert.strictEqual(out[2].cells.stu_id, '3');      // 新增列附加在後
});

test('_ftBuildImportFinalRowsFromGroups：resolvedGroups 空陣列＝只附加新增列（無衝突路徑）', () => {
  const rowA = { cells: { stu_id: '1' } };
  const out = S._ftBuildImportFinalRowsFromGroups([rowA], [{ cells: { stu_id: '2' } }], []);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0], rowA);                  // 未被改到的既有列維持同一參照
});

test('_ftBuildImportFinalRowsFromGroups：不修改傳入的原始列物件（cells 為新物件）', () => {
  const rowA = { cells: { stu_id: '1', score: '10' } };
  const out = S._ftBuildImportFinalRowsFromGroups([rowA], [], [{ existing: rowA, workingCells: { stu_id: '1', score: '55' } }]);
  assert.strictEqual(rowA.cells.score, '10');        // 原物件不動
  assert.strictEqual(out[0].cells.score, '55');
});

test('_ftImportResolveTotalPages：依 pageSize 進位、至少 1 頁', () => {
  assert.strictEqual(S._ftImportResolveTotalPages(0, 50), 1);
  assert.strictEqual(S._ftImportResolveTotalPages(50, 50), 1);
  assert.strictEqual(S._ftImportResolveTotalPages(51, 50), 2);
  assert.strictEqual(S._ftImportResolveTotalPages(201, 50), 5);
});

test('_ftImportResolvePageSlice：切出當頁區段', () => {
  const groups = Array.from({ length: 120 }, (_, i) => i);
  assert.deepStrictEqual(S._ftImportResolvePageSlice(groups, 0, 50), groups.slice(0, 50));
  assert.deepStrictEqual(S._ftImportResolvePageSlice(groups, 2, 50), groups.slice(100, 120));
  assert.deepStrictEqual(S._ftImportResolvePageSlice(groups, 5, 50), []); // 超出範圍→空
});

test('_ftUnmatchedNameCandidates：以姓名找學生基本資料同名者，附上候選學號', () => {
  const students = [
    { cells: { stu_id: '1122081', name_zh: '王小明' } },
    { cells: { stu_id: '1132035', name_zh: '李小華' } },
    { cells: { stu_id: '1140001', name_zh: '王小明' } }, // 同名
  ];
  const unmatched = [
    { stuId: '9999999', name: '王小明', source: '測驗資料' },
    { stuId: '8888888', name: '陳不存在', source: 'Google表單' },
  ];
  const out = S._ftUnmatchedNameCandidates(unmatched, students);
  assert.deepStrictEqual(Array.from(out[0].candidates, c => c.stuId), ['1122081', '1140001']);
  assert.strictEqual(out[1].candidates.length, 0);   // 查無同名
  assert.strictEqual(out[0].stuId, '9999999');       // 原欄位保留
});

test('_ftUnmatchedNameCandidates：姓名前後空白與缺姓名不誤判', () => {
  const students = [{ cells: { stu_id: '1', name_zh: ' 林大同 ' } }];
  const out = S._ftUnmatchedNameCandidates(
    [{ stuId: 'x', name: '林大同' }, { stuId: 'y', name: '' }],
    students,
  );
  assert.deepStrictEqual(Array.from(out[0].candidates, c => c.stuId), ['1']); // trim 後對得上
  assert.strictEqual(out[1].candidates.length, 0);                     // 空姓名→無候選
});
