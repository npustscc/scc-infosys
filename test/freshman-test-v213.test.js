// test/freshman-test-v213.test.js — 新生心理測驗 v213 九項改進的前端純函式測試（復原/重做、
// 儲存格去空白、學期代碼/顯示名稱預設、匯入欄位自動對應、貼上欄數溢出計算、軟刪除過濾）。
// 抽出對象皆為 dev/index.html 內無 DOM 依賴的純函式（見 test/harness.js）。fixture 一律用假學號/
// 假姓名（B99999999／測試員），不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

// ══════════════ ③ 儲存格值頭尾去空白 ══════════════

test('_ftTrimCell：去除半形空白頭尾，保留中間空白', () => {
  const S = load_(['_ftTrimCell']);
  assert.equal(S._ftTrimCell('  B99999999  '), 'B99999999');
  assert.equal(S._ftTrimCell('王 小明'), '王 小明');
});

test('_ftTrimCell：去除全形空白（U+3000）、Tab、不換行空白（U+00A0）、換行', () => {
  const S = load_(['_ftTrimCell']);
  assert.equal(S._ftTrimCell('　王小明　'), '王小明');
  assert.equal(S._ftTrimCell('\tB99999999\t'), 'B99999999');
  assert.equal(S._ftTrimCell(' B99999999 '), 'B99999999');
  assert.equal(S._ftTrimCell('\nB99999999\n'), 'B99999999');
});

test('_ftTrimCell：null/undefined 原樣放行（不是空字串）', () => {
  const S = load_(['_ftTrimCell']);
  assert.equal(S._ftTrimCell(null), null);
  assert.equal(S._ftTrimCell(undefined), undefined);
});

test('_ftTrimCell：非字串值先轉字串再處理', () => {
  const S = load_(['_ftTrimCell']);
  assert.equal(S._ftTrimCell(123), '123');
});

// ══════════════ ② 軟刪除過濾 ══════════════

test('_ftFilterDeleted：排除 deleted:true 的列，其餘保留', () => {
  const S = load_(['_ftFilterDeleted']);
  const rows = [
    { _id: 'r1', cells: {} },
    { _id: 'r2', cells: {}, deleted: true },
    { _id: 'r3', cells: {}, deleted: false },
  ];
  const r = S._ftFilterDeleted(rows);
  assert.deepEqual(r.map(x => x._id), ['r1', 'r3']);
});

test('_ftFilterDeleted：null/undefined 輸入不炸，回空陣列', () => {
  const S = load_(['_ftFilterDeleted']);
  assert.deepEqual(S._ftFilterDeleted(null), []);
  assert.deepEqual(S._ftFilterDeleted(undefined), []);
});

// ══════════════ ⑤ 貼上欄數溢出計算 ══════════════

test('_ftPasteOverflowInfo：貼上欄數在容納範圍內 → overflow=0', () => {
  const S = load_(['_ftPasteOverflowInfo']);
  const r = S._ftPasteOverflowInfo(10, 5, 3); // 總 10 欄，從第 5 欄起，還有 5 欄可容納，貼 3 欄
  assert.deepEqual(r, { needed: 3, available: 5, overflow: 0 });
});

test('_ftPasteOverflowInfo：貼上欄數超出容納範圍 → overflow>0', () => {
  const S = load_(['_ftPasteOverflowInfo']);
  const r = S._ftPasteOverflowInfo(10, 8, 5); // 總 10 欄，從第 8 欄起，只剩 2 欄，貼 5 欄
  assert.deepEqual(r, { needed: 5, available: 2, overflow: 3 });
});

test('_ftPasteOverflowInfo：起點已在最後一欄之後（不應發生但防禦）→ available 不為負', () => {
  const S = load_(['_ftPasteOverflowInfo']);
  const r = S._ftPasteOverflowInfo(5, 10, 2);
  assert.equal(r.available, 0);
  assert.equal(r.overflow, 2);
});

// ══════════════ ④ 匯入欄位自動對應 ══════════════

test('_ftAutoMapImportHeaders：欄名 trim 後精確相等 → 自動對上', () => {
  const S = load_(['_ftAutoMapImportHeaders', '_ftTrimCell']);
  const cols = [{ id: 'stu_id', name: '學號' }, { id: 'name_zh', name: '中文姓名' }];
  const mapping = S._ftAutoMapImportHeaders([' 學號 ', '中文姓名'], cols);
  assert.equal(mapping[0].colId, 'stu_id');
  assert.equal(mapping[0].autoIgnored, false);
  assert.equal(mapping[1].colId, 'name_zh');
});

test('_ftAutoMapImportHeaders：有內容但對不上任何現有欄位 → colId 為 null 且非 autoIgnored', () => {
  const S = load_(['_ftAutoMapImportHeaders', '_ftTrimCell']);
  const cols = [{ id: 'stu_id', name: '學號' }];
  const mapping = S._ftAutoMapImportHeaders(['學號', '不存在的欄位'], cols);
  assert.equal(mapping[1].colId, null);
  assert.equal(mapping[1].autoIgnored, false);
});

test('_ftAutoMapImportHeaders：空白表頭 → autoIgnored:true（不強迫使用者處理）', () => {
  const S = load_(['_ftAutoMapImportHeaders', '_ftTrimCell']);
  const cols = [{ id: 'stu_id', name: '學號' }];
  const mapping = S._ftAutoMapImportHeaders(['學號', '   '], cols);
  assert.equal(mapping[1].colId, null);
  assert.equal(mapping[1].autoIgnored, true);
});

test('_ftAutoMapImportHeaders：同一現有欄位不會被自動對到兩次（先到先得）', () => {
  const S = load_(['_ftAutoMapImportHeaders', '_ftTrimCell']);
  const cols = [{ id: 'stu_id', name: '學號' }];
  const mapping = S._ftAutoMapImportHeaders(['學號', '學號'], cols);
  assert.equal(mapping[0].colId, 'stu_id');
  assert.equal(mapping[1].colId, null); // 第二個「學號」對不到（已被用掉），需人工處理
  assert.equal(mapping[1].autoIgnored, false);
});

test('_ftImportNeedsMapping：全部命中（或自動忽略）→ false；有任一未命中的非空欄 → true', () => {
  const S = load_(['_ftAutoMapImportHeaders', '_ftTrimCell', '_ftImportNeedsMapping']);
  const cols = [{ id: 'stu_id', name: '學號' }];
  assert.equal(S._ftImportNeedsMapping(S._ftAutoMapImportHeaders(['學號', ''], cols)), false);
  assert.equal(S._ftImportNeedsMapping(S._ftAutoMapImportHeaders(['學號', '系級'], cols)), true);
});

// ══════════════ ⑦⑧ 新增學期預設代碼／顯示名稱 ══════════════

test('_ftDefaultSemesterCode：8~12 月 → 當年 ROC 年-1 上學期', () => {
  const S = load_(['_ftDefaultSemesterCode']);
  assert.equal(S._ftDefaultSemesterCode(new Date(2026, 7, 1)), '115-1');  // 8月
  assert.equal(S._ftDefaultSemesterCode(new Date(2026, 11, 31)), '115-1'); // 12月
});

test('_ftDefaultSemesterCode：2~7 月 → 上一學年下學期', () => {
  const S = load_(['_ftDefaultSemesterCode']);
  assert.equal(S._ftDefaultSemesterCode(new Date(2026, 1, 1)), '114-2');  // 2月
  assert.equal(S._ftDefaultSemesterCode(new Date(2026, 6, 20)), '114-2'); // 7月（今天日期所在月份）
});

test('_ftDefaultSemesterCode：1 月 → 上一學年上學期（尚未進入下學期）', () => {
  const S = load_(['_ftDefaultSemesterCode']);
  assert.equal(S._ftDefaultSemesterCode(new Date(2026, 0, 15)), '114-1');
});

test('_ftDefaultSemesterCode：未帶參數 → 用 new Date()（不炸）', () => {
  const S = load_(['_ftDefaultSemesterCode']);
  assert.match(S._ftDefaultSemesterCode(), /^\d+-[12]$/);
});

test('_ftSemesterDisplayFromCode：合法代碼 → 「XXX學年度第Y學期」', () => {
  const S = load_(['_ftSemesterDisplayFromCode']);
  assert.equal(S._ftSemesterDisplayFromCode('114-1'), '114學年度第1學期');
  assert.equal(S._ftSemesterDisplayFromCode('115-2'), '115學年度第2學期');
});

test('_ftSemesterDisplayFromCode：格式不符 → 回空字串', () => {
  const S = load_(['_ftSemesterDisplayFromCode']);
  assert.equal(S._ftSemesterDisplayFromCode('114'), ''); // 沒有連字號與學期碼
  assert.equal(S._ftSemesterDisplayFromCode('114-3'), ''); // 學期只有 1 或 2
  assert.equal(S._ftSemesterDisplayFromCode('abc-1'), ''); // 非數字學年
  assert.equal(S._ftSemesterDisplayFromCode(''), '');
  assert.equal(S._ftSemesterDisplayFromCode(null), '');
});

// ══════════════ ① 交易式復原/重做 ══════════════

function withUid(rows) {
  return rows.map((r, i) => ({ ...r, _uid: r._uid || ('u' + (i + 1)) }));
}

test('_ftDiffRowsForTransaction：儲存格值變更 → 一筆 cell fieldChange', () => {
  const S = load_(['_ftDiffRowsForTransaction']);
  const before = withUid([{ _id: 'r1', cells: { stu_id: 'B1', name_zh: '舊值' } }]);
  const after = before.map(r => ({ ...r, cells: { ...r.cells, name_zh: '新值' } }));
  const tx = S._ftDiffRowsForTransaction(before, after);
  assert.equal(tx.fieldChanges.length, 1);
  assert.deepEqual(tx.fieldChanges[0], { rowIdx: 0, kind: 'cell', colId: 'name_zh', oldValue: '舊值', newValue: '新值' });
  assert.equal(tx.insertions.length, 0);
  assert.equal(tx.removals.length, 0);
});

test('_ftDiffRowsForTransaction：新增列（無 _uid 對應）→ 一筆 insertions', () => {
  const S = load_(['_ftDiffRowsForTransaction']);
  const before = withUid([{ _id: 'r1', cells: { stu_id: 'B1' } }]);
  const newRow = { _id: null, _uid: 'newU', cells: { stu_id: 'B2' } };
  const after = [...before, newRow];
  const tx = S._ftDiffRowsForTransaction(before, after);
  assert.equal(tx.insertions.length, 1);
  assert.equal(tx.insertions[0].at, 1);
  assert.equal(tx.insertions[0].rows.length, 1);
  assert.equal(tx.insertions[0].rows[0]._uid, 'newU');
});

test('_ftDiffRowsForTransaction：列消失（_uid 不再出現於 after）→ 一筆 removals，記原索引', () => {
  const S = load_(['_ftDiffRowsForTransaction']);
  const before = withUid([
    { _id: 'r1', cells: { stu_id: 'A' } },
    { _id: 'r2', cells: { stu_id: 'B' } },
    { _id: 'r3', cells: { stu_id: 'C' } },
  ]);
  const after = [before[0], before[2]]; // 移除中間那筆（r2）
  const tx = S._ftDiffRowsForTransaction(before, after);
  assert.equal(tx.removals.length, 1);
  assert.equal(tx.removals[0].index, 1);
  assert.equal(tx.removals[0].row._id, 'r2');
});

test('_ftDiffRowsForTransaction：excluded／_pendingDelete 旗標變更 → 一筆 flag fieldChange', () => {
  const S = load_(['_ftDiffRowsForTransaction']);
  const before = withUid([{ _id: 'r1', cells: {}, excluded: false }]);
  const after = before.map(r => ({ ...r, _pendingDelete: true }));
  const tx = S._ftDiffRowsForTransaction(before, after);
  assert.equal(tx.fieldChanges.length, 1);
  assert.deepEqual(tx.fieldChanges[0], { rowIdx: 0, kind: 'flag', name: '_pendingDelete', oldValue: false, newValue: true });
});

test('_ftDiffRowsForTransaction：前後完全相同 → 三個陣列皆為空', () => {
  const S = load_(['_ftDiffRowsForTransaction']);
  const before = withUid([{ _id: 'r1', cells: { stu_id: 'B1' } }]);
  const after = before.map(r => ({ ...r, cells: { ...r.cells } }));
  const tx = S._ftDiffRowsForTransaction(before, after);
  assert.equal(tx.fieldChanges.length, 0);
  assert.equal(tx.insertions.length, 0);
  assert.equal(tx.removals.length, 0);
});

test('_ftApplyTransaction：redo 套用 fieldChanges 新值', () => {
  const S = load_(['_ftApplyTransaction', '_ftSetFieldValue']);
  const rows = [{ _id: 'r1', cells: { name_zh: '舊值' } }];
  const tx = { removals: [], insertions: [], fieldChanges: [{ rowIdx: 0, kind: 'cell', colId: 'name_zh', oldValue: '舊值', newValue: '新值' }] };
  const after = S._ftApplyTransaction(rows, tx, 'redo');
  assert.equal(after[0].cells.name_zh, '新值');
  assert.equal(rows[0].cells.name_zh, '舊值'); // 不修改輸入
});

test('_ftApplyTransaction：undo 還原 fieldChanges 為舊值', () => {
  const S = load_(['_ftApplyTransaction', '_ftSetFieldValue']);
  const rows = [{ _id: 'r1', cells: { name_zh: '新值' } }];
  const tx = { removals: [], insertions: [], fieldChanges: [{ rowIdx: 0, kind: 'cell', colId: 'name_zh', oldValue: '舊值', newValue: '新值' }] };
  const before = S._ftApplyTransaction(rows, tx, 'undo');
  assert.equal(before[0].cells.name_zh, '舊值');
});

test('_ftApplyTransaction：redo 套用 insertions（接在尾端）；undo 移除', () => {
  const S = load_(['_ftApplyTransaction', '_ftSetFieldValue']);
  const rows = [{ _id: 'r1', cells: {} }];
  const newRow = { _id: null, _uid: 'u2', cells: { stu_id: 'B2' } };
  const tx = { removals: [], fieldChanges: [], insertions: [{ at: 1, rows: [newRow] }] };
  const after = S._ftApplyTransaction(rows, tx, 'redo');
  assert.equal(after.length, 2);
  assert.equal(after[1].cells.stu_id, 'B2');
  const back = S._ftApplyTransaction(after, tx, 'undo');
  assert.equal(back.length, 1);
});

test('_ftApplyTransaction：redo 套用 removals（依原索引由大到小移除）；undo 依原索引插回', () => {
  const S = load_(['_ftApplyTransaction', '_ftSetFieldValue']);
  const rows = [
    { _id: 'r1', cells: { stu_id: 'A' } },
    { _id: 'r2', cells: { stu_id: 'B' } },
    { _id: 'r3', cells: { stu_id: 'C' } },
  ];
  const tx = { removals: [{ index: 1, row: rows[1] }], fieldChanges: [], insertions: [] };
  const after = S._ftApplyTransaction(rows, tx, 'redo');
  assert.deepEqual(after.map(r => r._id), ['r1', 'r3']);
  const back = S._ftApplyTransaction(after, tx, 'undo');
  assert.deepEqual(back.map(r => r._id), ['r1', 'r2', 'r3']);
  assert.equal(back[1].cells.stu_id, 'B'); // 插回的是原本那一列的內容
});

test('_ftApplyTransaction：redo/undo 往返複合交易（removals+fieldChanges+insertions）可還原到原狀態', () => {
  const S = load_(['_ftApplyTransaction', '_ftSetFieldValue', '_ftDiffRowsForTransaction']);
  const before = withUid([
    { _id: 'r1', cells: { class_abbr: 'A班', tutor_name: '舊導師A' } },
    { _id: 'r2', cells: { class_abbr: 'B班', tutor_name: '導師B' } },
    { _id: 'r3', cells: { class_abbr: 'C班', tutor_name: '已刪班級導師' } },
  ]);
  // 模擬導師同步：A班取代新值、C班刪除、新增 D班
  const kept = [before[0], before[1]].map(r => r._id === 'r1' ? { ...r, cells: { ...r.cells, tutor_name: '新導師A' } } : r);
  const after = [...kept, { _id: null, _uid: 'uNew', cells: { class_abbr: 'D班', tutor_name: '新班級導師' } }];
  const tx = S._ftDiffRowsForTransaction(before, after);

  const redone = S._ftApplyTransaction(before, tx, 'redo');
  assert.deepEqual(redone.map(r => r.cells.class_abbr), ['A班', 'B班', 'D班']);
  assert.equal(redone[0].cells.tutor_name, '新導師A');

  const undone = S._ftApplyTransaction(redone, tx, 'undo');
  assert.deepEqual(undone.map(r => r.cells.class_abbr), ['A班', 'B班', 'C班']);
  assert.equal(undone[0].cells.tutor_name, '舊導師A');
  assert.equal(undone[2].cells.tutor_name, '已刪班級導師');
});
