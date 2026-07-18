// test/freshman-test-checks.test.js — 新生心理測驗 v208 Slice 2（測驗資料／Google表單 tab）純函式測試。
// 涵蓋：學號格式檢核（含科技農業特例）、同 tab 學號重複偵測、跨 tab 姓名比對、Google表單匯入
// 重複狀態合併、選主條目旗標套用、列虛擬化可視窗口計算。抽出對象皆為 dev/index.html 內無 DOM
// 依賴的純函式（見 test/harness.js）。fixture 一律用假學號/假姓名（B99999999／測試員），不得出現
// 真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

// ══════════════ 學號格式檢核（含科技農業特例）══════════════

test('_ftValidateStuId：標準格式（1英文字母+8碼數字）→ 合格', () => {
  const S = load_(['_ftValidateStuId']);
  assert.deepEqual(S._ftValidateStuId('B99999999', '諮商心理學系'), { valid: true, reason: null });
});

test('_ftValidateStuId：空白 → 不合格（不是跳過）', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('', '諮商心理學系');
  assert.equal(r.valid, false);
  assert.match(r.reason, /空白/);
});

test('_ftValidateStuId：非科技農業系所、非標準格式 → 不合格', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('B9999A123', '諮商心理學系');
  assert.equal(r.valid, false);
});

test('_ftValidateStuId：科技農業特例格式（1字母+4數字+A+3數字）且系所含「科技農業」→ 合格', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('B1234A567', '科技農業進修學士學位學程');
  assert.deepEqual(r, { valid: true, reason: null });
});

test('_ftValidateStuId：科技農業特例格式，但系所名稱不含「科技農業」→ 不合格', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('B1234A567', '農園生產科學系');
  assert.equal(r.valid, false);
});

test('_ftValidateStuId：系所含「科技農業」但學號既非標準格式也非特例格式 → 不合格', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('B12A34567', '科技農業學士學位學程');
  assert.equal(r.valid, false);
});

test('_ftValidateStuId：科技農業系所的學生仍可用標準格式（非強制走特例）', () => {
  const S = load_(['_ftValidateStuId']);
  const r = S._ftValidateStuId('B99999999', '科技農業學士學位學程');
  assert.deepEqual(r, { valid: true, reason: null });
});

// ══════════════ 同 tab 內學號重複偵測 ══════════════

test('_ftFindDuplicateStuIds：同一學號出現兩次以上 → 列入重複集合', () => {
  const S = load_(['_ftFindDuplicateStuIds']);
  const rows = [
    { cells: { stu_id: 'B99999999' } },
    { cells: { stu_id: 'B88888888' } },
    { cells: { stu_id: 'B99999999' } },
  ];
  const dup = S._ftFindDuplicateStuIds(rows, 'stu_id');
  assert.equal(dup.has('B99999999'), true);
  assert.equal(dup.has('B88888888'), false);
});

test('_ftFindDuplicateStuIds：空白學號不計入重複判斷', () => {
  const S = load_(['_ftFindDuplicateStuIds']);
  const rows = [{ cells: { stu_id: '' } }, { cells: { stu_id: '  ' } }, { cells: {} }];
  const dup = S._ftFindDuplicateStuIds(rows, 'stu_id');
  assert.equal(dup.size, 0);
});

test('_ftFindDuplicateStuIds：無重複 → 空集合', () => {
  const S = load_(['_ftFindDuplicateStuIds']);
  const rows = [{ cells: { stu_id: 'B1' } }, { cells: { stu_id: 'B2' } }];
  assert.equal(S._ftFindDuplicateStuIds(rows, 'stu_id').size, 0);
});

// ══════════════ 逐格檢核彙整（格式／重複／跨 tab 姓名比對）══════════════

test('_ftComputeCellChecks：學號存在於學生基本資料但姓名不一致 → nameMismatch', () => {
  const S = load_(['_ftValidateStuId', '_ftFindDuplicateStuIds', '_ftComputeCellChecks']);
  const rows = [{ cells: { stu_id: 'B99999999', name_zh: '測試員乙（表單填寫）' } }];
  const studentsRows = [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲（正式學籍）' } }];
  const r = S._ftComputeCellChecks(rows, {
    keyColId: 'stu_id', nameColId: 'name_zh', deptColId: null, flagDuplicates: true,
    studentsRows, studentsKeyColId: 'stu_id', studentsNameColId: 'name_zh',
  });
  assert.equal(r[0].nameMismatch, true);
});

test('_ftComputeCellChecks：學號不存在於學生基本資料 → 不標記姓名不符（那是整合 tab 的事）', () => {
  const S = load_(['_ftValidateStuId', '_ftFindDuplicateStuIds', '_ftComputeCellChecks']);
  const rows = [{ cells: { stu_id: 'B77777777', name_zh: '測試員丙' } }];
  const r = S._ftComputeCellChecks(rows, {
    keyColId: 'stu_id', nameColId: 'name_zh', deptColId: null, flagDuplicates: true,
    studentsRows: [], studentsKeyColId: 'stu_id', studentsNameColId: 'name_zh',
  });
  assert.equal(r[0].nameMismatch, false);
});

test('_ftComputeCellChecks：flagDuplicates=false 時（Google表單 tab）即使學號重複也不標記 stuIdDup', () => {
  const S = load_(['_ftValidateStuId', '_ftFindDuplicateStuIds', '_ftComputeCellChecks']);
  const rows = [
    { cells: { stu_id: 'B99999999', name_zh: '甲' } },
    { cells: { stu_id: 'B99999999', name_zh: '甲' } },
  ];
  const r = S._ftComputeCellChecks(rows, {
    keyColId: 'stu_id', nameColId: 'name_zh', deptColId: null, flagDuplicates: false,
    studentsRows: [], studentsKeyColId: 'stu_id', studentsNameColId: 'name_zh',
  });
  assert.equal(r[0].stuIdDup, false);
  assert.equal(r[1].stuIdDup, false);
});

test('_ftComputeCellChecks：flagDuplicates=true 時（測驗資料 tab）學號重複標記 stuIdDup', () => {
  const S = load_(['_ftValidateStuId', '_ftFindDuplicateStuIds', '_ftComputeCellChecks']);
  const rows = [
    { cells: { stu_id: 'B99999999', name_zh: '甲' } },
    { cells: { stu_id: 'B99999999', name_zh: '甲' } },
  ];
  const r = S._ftComputeCellChecks(rows, {
    keyColId: 'stu_id', nameColId: 'name_zh', deptColId: null, flagDuplicates: true,
    studentsRows: [], studentsKeyColId: 'stu_id', studentsNameColId: 'name_zh',
  });
  assert.equal(r[0].stuIdDup, true);
  assert.equal(r[1].stuIdDup, true);
});

test('_ftComputeCellChecks：科技農業特例學號＋deptColId 正確帶入 → 格式合格', () => {
  const S = load_(['_ftValidateStuId', '_ftFindDuplicateStuIds', '_ftComputeCellChecks']);
  const rows = [{ cells: { stu_id: 'B1234A567', dept: '科技農業學士學位學程', name_zh: '甲' } }];
  const r = S._ftComputeCellChecks(rows, {
    keyColId: 'stu_id', nameColId: 'name_zh', deptColId: 'dept', flagDuplicates: true,
    studentsRows: [], studentsKeyColId: 'stu_id', studentsNameColId: 'name_zh',
  });
  assert.equal(r[0].stuIdBad, false);
});

// ══════════════ Google表單匯入：完全相同列靜默跳過，其餘（含同學號不同內容）新增為新列 ══════════════

test('_ftGformMergeImport：完全相同列（各欄皆同）→ 靜默跳過', () => {
  const S = load_(['_ftGformMergeImport']);
  const existing = [{ cells: { stu_id: 'B1', name_zh: '甲', ts: '2026-07-01' } }];
  const imported = [{ cells: { stu_id: 'B1', name_zh: '甲', ts: '2026-07-01' } }];
  const r = S._ftGformMergeImport(existing, imported);
  assert.equal(r.addedCount, 0);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.rows.length, 1);
});

test('_ftGformMergeImport：同學號但內容不同 → 新增為新列（形成重複狀態，不合併不覆蓋）', () => {
  const S = load_(['_ftGformMergeImport']);
  const existing = [{ cells: { stu_id: 'B1', name_zh: '甲', ts: '2026-07-01' } }];
  const imported = [{ cells: { stu_id: 'B1', name_zh: '甲', ts: '2026-07-15' } }];
  const r = S._ftGformMergeImport(existing, imported);
  assert.equal(r.addedCount, 1);
  assert.equal(r.skippedCount, 0);
  assert.equal(r.rows.length, 2);
});

test('_ftGformMergeImport：全新學號 → 新增', () => {
  const S = load_(['_ftGformMergeImport']);
  const r = S._ftGformMergeImport([], [{ cells: { stu_id: 'B2', name_zh: '乙' } }]);
  assert.equal(r.addedCount, 1);
  assert.equal(r.rows.length, 1);
});

test('_ftGformMergeImport：混合（完全相同+內容不同+全新）同時正確分類', () => {
  const S = load_(['_ftGformMergeImport']);
  const existing = [{ cells: { stu_id: 'B1', name_zh: '甲', ts: 't1' } }];
  const imported = [
    { cells: { stu_id: 'B1', name_zh: '甲', ts: 't1' } },   // 完全相同 → 跳過
    { cells: { stu_id: 'B1', name_zh: '甲', ts: 't2' } },   // 同學號不同內容 → 新增
    { cells: { stu_id: 'B3', name_zh: '丙', ts: 't3' } },   // 全新 → 新增
  ];
  const r = S._ftGformMergeImport(existing, imported);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.addedCount, 2);
  assert.equal(r.rows.length, 3);
});

// ══════════════ 差異欄位（選主條目 modal 顯示用）══════════════

test('_ftGroupDiffCols：只回傳組內有差異的欄位', () => {
  const S = load_(['_ftGroupDiffCols']);
  const group = [
    { cells: { stu_id: 'B1', name_zh: '甲', ts: 't1', phone: '0900' } },
    { cells: { stu_id: 'B1', name_zh: '甲', ts: 't2', phone: '0900' } },
  ];
  assert.deepEqual(S._ftGroupDiffCols(group), ['ts']);
});

test('_ftGroupDiffCols：各欄皆相同 → 空陣列', () => {
  const S = load_(['_ftGroupDiffCols']);
  const group = [{ cells: { a: '1' } }, { cells: { a: '1' } }];
  assert.deepEqual(S._ftGroupDiffCols(group), []);
});

// ══════════════ 選主條目：excluded 旗標套用 ══════════════

test('_ftApplyPrimarySelection：主條目 excluded=false，同組其餘 excluded=true，組外不受影響', () => {
  const S = load_(['_ftApplyPrimarySelection']);
  const r1 = { cells: { stu_id: 'B1' } };
  const r2 = { cells: { stu_id: 'B1' } };
  const other = { cells: { stu_id: 'B2' } };
  const rows = [r1, r2, other];
  const result = S._ftApplyPrimarySelection(rows, [r1, r2], r2);
  const byRef = new Map(result.map((r, i) => [rows[i], r]));
  assert.equal(byRef.get(r1).excluded, true);
  assert.equal(byRef.get(r2).excluded, false);
  assert.equal(byRef.get(other).excluded, undefined); // 組外的列完全不受影響
});

test('_ftApplyPrimarySelection：不修改輸入陣列（回傳新陣列）', () => {
  const S = load_(['_ftApplyPrimarySelection']);
  const r1 = { cells: { stu_id: 'B1' } };
  const rows = [r1];
  S._ftApplyPrimarySelection(rows, [r1], r1);
  assert.equal(r1.excluded, undefined); // 原物件不被就地修改
});

// ══════════════ 列虛擬化：可視窗口計算 ══════════════

test('_ftComputeVirtualWindow：捲動到頂端時從第 0 列開始，含緩衝', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(0, 300, 2000, 30, 8);
  assert.equal(w.startIdx, 0);
  assert.equal(w.totalHeight, 60000);
  assert.ok(w.endIdx > 10); // 300/30=10 可視列 + 緩衝
});

test('_ftComputeVirtualWindow：捲動到中間時視窗跟著往下移，且扣掉緩衝列數', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(3000, 300, 2000, 30, 8); // scrollTop=3000 → 第 100 列
  assert.equal(w.startIdx, 100 - 8);
  assert.equal(w.offsetY, w.startIdx * 30);
});

test('_ftComputeVirtualWindow：視窗不超出總列數上限', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(59000, 300, 2000, 30, 8); // 接近底部
  assert.ok(w.endIdx <= 2000);
});

test('_ftComputeVirtualWindow：rowCount 為 0 → 回傳空窗口，不報錯', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(0, 300, 0, 30, 8);
  assert.deepEqual(w, { startIdx: 0, endIdx: 0, totalHeight: 0, offsetY: 0 });
});

test('_ftComputeVirtualWindow：rowHeight/buffer 非正數時退回安全預設值', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(0, 300, 100, 0, -5);
  assert.equal(w.totalHeight, 100 * 30); // rowHeight 退回 30
  assert.equal(w.startIdx, 0); // buffer 退回 0，不會是負數
});

test('_ftComputeVirtualWindow：146 欄 × 2000 列情境下窗口大小遠小於總列數（虛擬化生效）', () => {
  const S = load_(['_ftComputeVirtualWindow']);
  const w = S._ftComputeVirtualWindow(0, 700, 2000, 30, 8); // 假設可視高度 700px
  const windowSize = w.endIdx - w.startIdx;
  assert.ok(windowSize < 100); // 遠小於 2000，證明只 render 可視窗口
});
