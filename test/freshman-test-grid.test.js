// test/freshman-test-grid.test.js — 新生心理測驗（v207 Slice 1）學生基本資料試算表純函式測試。
// 抽出對象皆為 dev/index.html 內無 DOM 依賴的純函式（見 test/harness.js）。
// fixture 一律用假學號/假姓名（B99999999／測試員），不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

// ══════════════ 貼上解析 ══════════════

test('_ftParsePasteText：\\t 分欄、\\n 分列', () => {
  const S = load_(['_ftParsePasteText']);
  assert.deepEqual(S._ftParsePasteText('B99999999\t測試員甲\nB99999998\t測試員乙'), [
    ['B99999999', '測試員甲'],
    ['B99999998', '測試員乙'],
  ]);
});

test('_ftParsePasteText：\\r\\n（Windows 換行）視同 \\n', () => {
  const S = load_(['_ftParsePasteText']);
  assert.deepEqual(S._ftParsePasteText('a\tb\r\nc\td'), [['a', 'b'], ['c', 'd']]);
});

test('_ftParsePasteText：去除尾端多餘的單一空行（Excel 複製範圍常帶）', () => {
  const S = load_(['_ftParsePasteText']);
  assert.deepEqual(S._ftParsePasteText('a\tb\n'), [['a', 'b']]);
});

test('_ftParsePasteText：單一儲存格（無 tab/換行）', () => {
  const S = load_(['_ftParsePasteText']);
  assert.deepEqual(S._ftParsePasteText('B99999999'), [['B99999999']]);
});

test('_ftParsePasteText：null/undefined → 空陣列', () => {
  const S = load_(['_ftParsePasteText']);
  assert.deepEqual(S._ftParsePasteText(null), []);
  assert.deepEqual(S._ftParsePasteText(undefined), []);
});

// ══════════════ 貼上套用到 rows（自動增列、超出欄位範圍捨棄）══════════════

test('_ftApplyPasteToRows：從指定起點鋪貼上內容，既有列被覆寫', () => {
  const S = load_(['_ftApplyPasteToRows']);
  const rows = [{ _id: 'r1', cells: { stu_id: 'B1', name_zh: '舊值' } }];
  const colIds = ['stu_id', 'name_zh'];
  const result = S._ftApplyPasteToRows(rows, colIds, 0, 1, [['新值']]);
  assert.equal(result[0].cells.name_zh, '新值');
  assert.equal(result[0].cells.stu_id, 'B1'); // 未在貼上範圍內的欄位不受影響
  assert.equal(result[0]._id, 'r1'); // 保留既有列 id
});

test('_ftApplyPasteToRows：貼上列數超過現有列數 → 自動增列', () => {
  const S = load_(['_ftApplyPasteToRows']);
  const rows = [{ _id: 'r1', cells: {} }];
  const colIds = ['stu_id', 'name_zh'];
  const result = S._ftApplyPasteToRows(rows, colIds, 0, 0, [['B1', '甲'], ['B2', '乙'], ['B3', '丙']]);
  assert.equal(result.length, 3);
  assert.equal(result[2].cells.stu_id, 'B3');
  assert.equal(result[2]._id, null); // 新增列尚未有後端配發的 id
});

test('_ftApplyPasteToRows：貼上欄數超出目前欄位範圍 → 超出部分捨棄，不擴增欄位', () => {
  const S = load_(['_ftApplyPasteToRows']);
  const rows = [{ _id: 'r1', cells: {} }];
  const colIds = ['stu_id']; // 只有一欄
  const result = S._ftApplyPasteToRows(rows, colIds, 0, 0, [['B1', '多出來的值']]);
  assert.equal(result[0].cells.stu_id, 'B1');
  assert.equal(Object.keys(result[0].cells).length, 1);
});

test('_ftApplyPasteToRows：不修改輸入 rows（回傳新陣列）', () => {
  const S = load_(['_ftApplyPasteToRows']);
  const rows = [{ _id: 'r1', cells: { stu_id: 'B1' } }];
  const result = S._ftApplyPasteToRows(rows, ['stu_id'], 0, 0, [['B2']]);
  assert.equal(rows[0].cells.stu_id, 'B1'); // 原陣列不變
  assert.equal(result[0].cells.stu_id, 'B2');
});

// ══════════════ colId 產生 ══════════════

test('_ftGenColId：產生的 id 不與既有 id 衝突', () => {
  const S = load_(['_ftGenColId']);
  const existing = ['col_aaaaaa', 'col_bbbbbb'];
  const id = S._ftGenColId(existing);
  assert.ok(!existing.includes(id));
  assert.match(id, /^col_[a-z0-9]+$/);
});

test('_ftGenColId：空陣列／未帶參數皆可正常產生', () => {
  const S = load_(['_ftGenColId']);
  assert.match(S._ftGenColId([]), /^col_/);
  assert.match(S._ftGenColId(), /^col_/);
});

test('_ftGenColId：與欄名脫鉤——同名欄位刪除後重建，新 id 不會與舊資料的 colId 撞號', () => {
  const S = load_(['_ftGenColId']);
  // 模擬「刪除舊欄位再新增同名欄位」情境：舊 colId 仍留在歷史列 cells 內，existingIds 傳入時應排除新 id 撞號
  const existing = ['stu_id', 'name_zh', 'col_oldslug'];
  const id = S._ftGenColId(existing);
  assert.ok(!existing.includes(id));
});

// ══════════════ 學號衝突比對 ══════════════

test('_ftDetectImportConflicts：新學號 → 歸入 newRows', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTrimCell']);
  const existing = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }];
  const imported = [{ cells: { stu_id: 'B88888888', name_zh: '測試員乙' } }];
  const r = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  assert.equal(r.newRows.length, 1);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.unchanged.length, 0);
});

test('_ftDetectImportConflicts：同學號但欄位值有差異 → 歸入 conflicts，含差異欄位清單', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTrimCell']);
  const existing = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲', gender: '男' } }];
  const imported = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲', gender: '女' } }];
  const r = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].diffCols, ['gender']);
  assert.equal(r.conflicts[0].key, 'B99999999');
});

test('_ftDetectImportConflicts：同學號且所有欄位值相同 → 歸入 unchanged，不視為衝突', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTrimCell']);
  const existing = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }];
  const imported = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }];
  const r = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.unchanged.length, 1);
});

test('_ftDetectImportConflicts：多筆混合（新增/衝突/無異動）同時正確分類', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTrimCell']);
  const existing = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: 'B2', name_zh: '乙' } },
  ];
  const imported = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },       // 無異動
    { cells: { stu_id: 'B2', name_zh: '乙乙' } },     // 衝突
    { cells: { stu_id: 'B3', name_zh: '丙' } },       // 新增
  ];
  const r = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  assert.equal(r.unchanged.length, 1);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.newRows.length, 1);
});

test('_ftDetectImportConflicts：匯入列缺少學號欄位值 → 略過（不歸入任何分類）', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftTrimCell']);
  const existing = [];
  const imported = [{ cells: { name_zh: '無學號' } }];
  const r = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  assert.equal(r.newRows.length, 0);
  assert.equal(r.conflicts.length, 0);
});

// ══════════════ 匯入衝突勾選結果套用 ══════════════

test('_ftBuildImportFinalRows：勾選「取代」的衝突套用匯入值；未勾選維持既有值；新增列直接附加', () => {
  const S = load_(['_ftDetectImportConflicts', '_ftBuildImportFinalRows', '_ftTrimCell']);
  const existing = [
    { _id: 'r1', cells: { stu_id: 'B1', gender: '男' } },
    { _id: 'r2', cells: { stu_id: 'B2', gender: '男' } },
  ];
  const imported = [
    { cells: { stu_id: 'B1', gender: '女' } }, // 衝突，將勾選取代
    { cells: { stu_id: 'B2', gender: '女' } }, // 衝突，不勾選
    { cells: { stu_id: 'B3', gender: '女' } }, // 新增
  ];
  const detect = S._ftDetectImportConflicts(existing, imported, 'stu_id');
  const accepted = new Set(['B1']); // 只接受 B1 的取代
  const final = S._ftBuildImportFinalRows(existing, detect, accepted);
  const byId = Object.fromEntries(final.map(r => [r.cells.stu_id, r.cells.gender]));
  assert.equal(byId.B1, '女');  // 已取代
  assert.equal(byId.B2, '男');  // 維持既有
  assert.equal(byId.B3, '女');  // 新增列
  assert.equal(final.length, 3);
});

// ══════════════ 必填欄位缺值提示（不阻擋儲存）══════════════

test('_ftRowMissingRequired：回傳缺值的必填欄位 id', () => {
  const S = load_(['_ftRowMissingRequired']);
  const schema = { cols: [
    { id: 'stu_id', required: true },
    { id: 'name_zh', required: true },
    { id: 'gender', required: false },
  ] };
  const row = { cells: { stu_id: 'B1', name_zh: '  ', gender: '' } };
  assert.deepEqual(S._ftRowMissingRequired(row, schema), ['name_zh']); // 空白字元視為未填
});

test('_ftRowMissingRequired：所有必填皆有值 → 空陣列', () => {
  const S = load_(['_ftRowMissingRequired']);
  const schema = { cols: [{ id: 'stu_id', required: true }] };
  const row = { cells: { stu_id: 'B1' } };
  assert.deepEqual(S._ftRowMissingRequired(row, schema), []);
});

// ══════════════ schema 增刪欄不影響歷史列（結構性保證：schema／rows 為兩個獨立資料結構）══════════════

test('schema 增刪欄不影響歷史資料：刪除 schema.cols 一筆後，既有列的 cells 物件完全不受影響', () => {
  const row = { _id: 'r1', cells: { stu_id: 'B1', name_zh: '測試員甲', gender: '女' } };
  const schemaBefore = { cols: [{ id: 'stu_id' }, { id: 'name_zh' }, { id: 'gender' }] };
  // 模擬前端刪除「性別」欄的操作：只操作 schema.cols，row 完全不被觸碰（兩者是獨立資料結構，
  // 對映後端 schema-students.json／students.json 分檔設計）。
  const schemaAfter = { cols: schemaBefore.cols.filter(c => c.id !== 'gender') };
  assert.equal(schemaAfter.cols.length, 2);
  assert.equal(schemaAfter.cols.some(c => c.id === 'gender'), false);
  // row 的 cells 仍保留被刪欄位的資料——只是沒有任何 schema 欄位會再顯示它
  assert.equal(row.cells.gender, '女');
  assert.deepEqual(row.cells, { stu_id: 'B1', name_zh: '測試員甲', gender: '女' });
});

test('schema 增刪欄不影響歷史資料：新增欄位後，既有列沒有該 colId → 視為空白（不報錯）', () => {
  const oldRow = { cells: { stu_id: 'B1', name_zh: '測試員甲' } };
  const schemaAfter = { cols: [{ id: 'stu_id' }, { id: 'name_zh' }, { id: 'col_newcol', name: '新欄位' }] };
  const displayValue = (oldRow.cells['col_newcol'] ?? '');
  assert.equal(displayValue, '');
  assert.equal(schemaAfter.cols.length, 3);
});

// ══════════════ Excel/CSV 匯入：標題列 → colId 對映 ══════════════

test('_ftAoaToImportRows：依標題列文字對映既有欄位 name → colId，逐列組出 cells', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell']);
  const schemaCols = [{ id: 'stu_id', name: '學號' }, { id: 'name_zh', name: '中文姓名' }];
  const aoa = [
    ['學號', '中文姓名'],
    ['B99999999', '測試員甲'],
    ['B99999998', '測試員乙'],
  ];
  const rows = S._ftAoaToImportRows(aoa, schemaCols);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells.stu_id, 'B99999999');
  assert.equal(rows[0].cells.name_zh, '測試員甲');
});

test('_ftAoaToImportRows：找不到對映的標題欄位 → 該欄捨棄，不報錯', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell']);
  const schemaCols = [{ id: 'stu_id', name: '學號' }];
  const aoa = [['學號', '未知欄位'], ['B1', '某值']];
  const rows = S._ftAoaToImportRows(aoa, schemaCols);
  assert.deepEqual(rows[0].cells, { stu_id: 'B1' });
});

test('_ftAoaToImportRows：整列皆空白 → 跳過該列', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell']);
  const schemaCols = [{ id: 'stu_id', name: '學號' }];
  const aoa = [['學號'], [''], ['B1']];
  const rows = S._ftAoaToImportRows(aoa, schemaCols);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.stu_id, 'B1');
});

test('_ftAoaToImportRows：空 aoa 或只有標題列 → 空陣列', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell']);
  assert.deepEqual(S._ftAoaToImportRows([], []), []);
  assert.deepEqual(S._ftAoaToImportRows([['學號']], [{ id: 'stu_id', name: '學號' }]), []);
});
