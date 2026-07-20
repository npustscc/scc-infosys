// test/freshman-test-v222.test.js — 新生心理測驗 v222 七項改進的前端純函式測試（Excel 日期序號
// 轉換、關鍵字篩選／問題列置頂顯示排序、tab 快取 key／變更偵測、統計 tab 長文案收合摘要）。
// 抽出對象皆為 dev/index.html 內無 DOM 依賴的純函式（見 test/harness.js）。fixture 一律用假學號/
// 假姓名（B99999999／測試員），不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

// ══════════════ ③ Excel 日期序號 → 可讀日期字串 ══════════════

test('_ftExcelSerialToDateString：典型序號（45923.61...）轉成 YYYY/MM/DD HH:mm:ss', () => {
  const S = load_(['_ftExcelSerialToDateString']);
  // 45923 = 2025-09-23（以 1899-12-30 為基準日往後推算，UTC 運算不受時區影響；已用獨立腳本核算）
  const r = S._ftExcelSerialToDateString(45923.610532407405);
  assert.match(r, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(r, '2025/09/23 14:39:10');
});

test('_ftExcelSerialToDateString：整數序號（無時間部分）也能轉換，時間為 00:00:00', () => {
  const S = load_(['_ftExcelSerialToDateString']);
  const r = S._ftExcelSerialToDateString(45923);
  assert.equal(r, '2025/09/23 00:00:00');
});

test('_ftExcelSerialToDateString：超出合理序號範圍（一般數值，非日期）→ 回傳 null 不誤轉', () => {
  const S = load_(['_ftExcelSerialToDateString']);
  assert.equal(S._ftExcelSerialToDateString(100), null);
  assert.equal(S._ftExcelSerialToDateString(99999), null);
  assert.equal(S._ftExcelSerialToDateString(0), null);
});

test('_ftExcelSerialToDateString：非數字/空值 → 回傳 null', () => {
  const S = load_(['_ftExcelSerialToDateString']);
  assert.equal(S._ftExcelSerialToDateString(''), null);
  assert.equal(S._ftExcelSerialToDateString(null), null);
  assert.equal(S._ftExcelSerialToDateString(undefined), null);
  assert.equal(S._ftExcelSerialToDateString('2025/09/14 10:00:00'), null); // 已是可讀字串，非序號
});

test('_ftAoaToImportRows：colId 為 ts 且值為 Excel 序號 → 匯入時直接轉成可讀日期字串', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell', '_ftExcelSerialToDateString']);
  const schemaCols = [{ id: 'ts', name: '時間戳記' }, { id: 'stu_id', name: '學號' }];
  const aoa = [
    ['時間戳記', '學號'],
    [45923.610532407405, 'B99999999'],
  ];
  const rows = S._ftAoaToImportRows(aoa, schemaCols);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.ts, '2025/09/23 14:39:10');
  assert.equal(rows[0].cells.stu_id, 'B99999999');
});

test('_ftAoaToImportRows：colId 為 ts 但值本來就是可讀字串（非序號）→ 原樣保留，不誤轉', () => {
  const S = load_(['_ftAoaToImportRows', '_ftTrimCell', '_ftExcelSerialToDateString']);
  const schemaCols = [{ id: 'ts', name: '時間戳記' }];
  const aoa = [['時間戳記'], ['2025/09/14 10:00:00']];
  const rows = S._ftAoaToImportRows(aoa, schemaCols);
  assert.equal(rows[0].cells.ts, '2025/09/14 10:00:00');
});

// ══════════════ ④ 關鍵字篩選／問題列置頂（顯示排序，不動底層資料）══════════════

test('_ftRowMatchesFilter：空白關鍵字比對全部通過', () => {
  const S = load_(['_ftRowMatchesFilter']);
  assert.equal(S._ftRowMatchesFilter({ cells: { stu_id: 'B99999999' } }, ''), true);
  assert.equal(S._ftRowMatchesFilter({ cells: { stu_id: 'B99999999' } }, '   '), true);
});

test('_ftRowMatchesFilter：不分大小寫、任一欄位命中即算命中', () => {
  const S = load_(['_ftRowMatchesFilter']);
  const row = { cells: { stu_id: 'B99999999', name_zh: '測試員甲', email: 'Test@Example.com' } };
  assert.equal(S._ftRowMatchesFilter(row, '測試員'), true);
  assert.equal(S._ftRowMatchesFilter(row, 'test@example'), true);
  assert.equal(S._ftRowMatchesFilter(row, '不存在的字串'), false);
});

test('_ftRowIsIssue：學號格式錯/重複/姓名不符任一為真 → 問題列', () => {
  const S = load_(['_ftRowIsIssue', '_ftRowMissingRequired']);
  const schema = { cols: [{ id: 'stu_id', required: true }] };
  const row = { cells: { stu_id: 'B99999999' } };
  assert.equal(S._ftRowIsIssue(row, schema, { stuIdBad: true }), true);
  assert.equal(S._ftRowIsIssue(row, schema, { stuIdDup: true }), true);
  assert.equal(S._ftRowIsIssue(row, schema, { nameMismatch: true }), true);
  assert.equal(S._ftRowIsIssue(row, schema, null), false);
});

test('_ftRowIsIssue：缺必填欄位（即使 checks 為 null，如 students tab）也算問題列', () => {
  const S = load_(['_ftRowIsIssue', '_ftRowMissingRequired']);
  const schema = { cols: [{ id: 'stu_id', required: true }, { id: 'name_zh', required: true }] };
  const row = { cells: { stu_id: 'B99999999' } }; // name_zh 缺
  assert.equal(S._ftRowIsIssue(row, schema, null), true);
});

test('_ftComputeDisplayOrder：不置頂時只做篩選，維持原順序', () => {
  const S = load_(['_ftComputeDisplayOrder', '_ftRowMatchesFilter', '_ftRowIsIssue', '_ftRowMissingRequired']);
  const rows = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: 'B2', name_zh: '乙' } },
    { cells: { stu_id: 'B3', name_zh: '丙' } },
  ];
  const schema = { cols: [] };
  const order = S._ftComputeDisplayOrder(rows, schema, null, '', false);
  assert.deepEqual(order, [0, 1, 2]);
});

test('_ftComputeDisplayOrder：篩選關鍵字只留下命中的列（依原順序）', () => {
  const S = load_(['_ftComputeDisplayOrder', '_ftRowMatchesFilter', '_ftRowIsIssue', '_ftRowMissingRequired']);
  const rows = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: 'B2', name_zh: '乙' } },
    { cells: { stu_id: 'B3', name_zh: '甲乙' } },
  ];
  const schema = { cols: [] };
  const order = S._ftComputeDisplayOrder(rows, schema, null, '甲', false);
  assert.deepEqual(order, [0, 2]);
});

test('_ftComputeDisplayOrder：問題列置頂——問題列排前面、其餘在後，各自維持原相對順序（穩定排序）', () => {
  const S = load_(['_ftComputeDisplayOrder', '_ftRowMatchesFilter', '_ftRowIsIssue', '_ftRowMissingRequired']);
  const schema = { cols: [{ id: 'stu_id', required: true }] };
  const rows = [
    { cells: { stu_id: 'B1' } },  // ok
    { cells: { stu_id: '' } },    // 缺必填 → 問題列
    { cells: { stu_id: 'B3' } },  // ok
    { cells: { stu_id: '' } },    // 缺必填 → 問題列
  ];
  const checks = null;
  const order = S._ftComputeDisplayOrder(rows, schema, checks, '', true);
  assert.deepEqual(order, [1, 3, 0, 2]);
});

test('_ftComputeDisplayOrder：置頂時仍先套用篩選，篩掉的列不會被拉進來', () => {
  const S = load_(['_ftComputeDisplayOrder', '_ftRowMatchesFilter', '_ftRowIsIssue', '_ftRowMissingRequired']);
  const schema = { cols: [{ id: 'stu_id', required: true }] };
  const rows = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: '', name_zh: '乙' } }, // 問題列，但不含關鍵字「甲」
  ];
  const order = S._ftComputeDisplayOrder(rows, schema, null, '甲', true);
  assert.deepEqual(order, [0]);
});

// ══════════════ ⑦ per-(semester,tab) 快取 ══════════════

test('_ftSheetCacheKey：學期＋sheet 組合成唯一 key', () => {
  const S = load_(['_ftSheetCacheKey']);
  assert.equal(S._ftSheetCacheKey('114-1', 'students'), '114-1::students');
  assert.notEqual(S._ftSheetCacheKey('114-1', 'tests'), S._ftSheetCacheKey('114-2', 'tests'));
});

test('_ftSheetDataChanged：schema 或 rows 任一不同即視為有變更', () => {
  const S = load_(['_ftSheetDataChanged']);
  const schema = { cols: [{ id: 'stu_id', name: '學號' }] };
  const rows = [{ _id: '1', cells: { stu_id: 'B1' } }];
  assert.equal(S._ftSheetDataChanged(schema, rows, schema, rows), false);
  assert.equal(S._ftSheetDataChanged(schema, rows, schema, [{ _id: '1', cells: { stu_id: 'B2' } }]), true);
  assert.equal(S._ftSheetDataChanged(schema, rows, { cols: [] }, rows), true);
});

test('_ftSheetDataChanged：無快取（null）視為有變更', () => {
  const S = load_(['_ftSheetDataChanged']);
  assert.equal(S._ftSheetDataChanged(null, null, { cols: [] }, []), true);
});

// ══════════════ ⑥ 統計 tab 高關懷清冊：長文案收合摘要 ══════════════

test('_ftTruncateForCollapse：文字長度未超過門檻 → 原樣顯示，isLong 為 false', () => {
  const S = load_(['_ftTruncateForCollapse']);
  const r = S._ftTruncateForCollapse('短文字', 40);
  assert.deepEqual(r, { isLong: false, preview: '短文字' });
});

test('_ftTruncateForCollapse：超過門檻 → 截斷加刪節號，isLong 為 true', () => {
  const S = load_(['_ftTruncateForCollapse']);
  const long = 'A'.repeat(50);
  const r = S._ftTruncateForCollapse(long, 40);
  assert.equal(r.isLong, true);
  assert.equal(r.preview, 'A'.repeat(40) + '…');
});

test('_ftTruncateForCollapse：null/undefined 視為空字串，不拋錯', () => {
  const S = load_(['_ftTruncateForCollapse']);
  assert.deepEqual(S._ftTruncateForCollapse(null, 40), { isLong: false, preview: '' });
  assert.deepEqual(S._ftTruncateForCollapse(undefined, 40), { isLong: false, preview: '' });
});
