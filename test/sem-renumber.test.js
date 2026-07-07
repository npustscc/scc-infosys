// 同學期再次開案的 sem key 對稱重編（#35）單元測試。執行：node --test test/*.test.js
// 對象：_renumberSemKeys（純函式：算出對照表）／_applySemKeyRenumber（套用到個案物件的所有引用處）
//
// 背景：個案架構重構 Slice 2 下，「案號」本身不變（一學生一案號）；同學期重複開案是以
// c.semesters[] 內的「sem key」區分——例如 '1142'、'1142#2'、'1142#3'。
// 本次需求：一旦同學期有 2 筆以上，全部都要帶明確序號（'1142#1'、'1142#2'…）；
// 刪到只剩 1 筆時該筆一律恢復無後綴；刪除中間那筆時後面的要依序遞補（不留號碼空缺）。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ── _renumberSemKeys：純函式，輸入 base 學期目前仍存在的 key 陣列，回傳 {舊key: 新key} 對照表 ──

test('_renumberSemKeys：產生分身——原本只有 1 筆（無後綴），新增第 2 筆後，原本那筆要變成 #1', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142', '1142#2']);
  assert.deepEqual(map, { '1142': '1142#1' }); // '1142#2' 本身不變，不出現在對照表
});

test('_renumberSemKeys：刪除 #2 後，只剩 #1 → 恢復無後綴', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142#1']);
  assert.deepEqual(map, { '1142#1': '1142' });
});

test('_renumberSemKeys：刪除 #1 後，只剩 #2 → 改為無後綴（遞補為主號）', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142#2']);
  assert.deepEqual(map, { '1142#2': '1142' });
});

test('_renumberSemKeys：3 筆時刪除 #1，#2/#3 依序遞補為 #1/#2', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142#2', '1142#3']);
  assert.deepEqual(map, { '1142#2': '1142#1', '1142#3': '1142#2' });
});

test('_renumberSemKeys：3 筆時刪除中間 #2，#1 不變、#3 遞補為 #2', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142#1', '1142#3']);
  assert.deepEqual(map, { '1142#3': '1142#2' }); // '1142#1' 本就正確，不在對照表中
});

test('_renumberSemKeys：只有 1 筆且已無後綴 → 無需變動（空對照表）', () => {
  const S = load(['_renumberSemKeys']);
  assert.deepEqual(S._renumberSemKeys('1142', ['1142']), {});
});

test('_renumberSemKeys：只有 1 筆但帶著多餘後綴（如刪光其他分身後殘留 #3）→ 恢復無後綴', () => {
  const S = load(['_renumberSemKeys']);
  const map = S._renumberSemKeys('1142', ['1142#3']);
  assert.deepEqual(map, { '1142#3': '1142' });
});

test('_renumberSemKeys：空陣列 → 空對照表，不炸', () => {
  const S = load(['_renumberSemKeys']);
  assert.doesNotThrow(() => S._renumberSemKeys('1142', []));
  assert.deepEqual(S._renumberSemKeys('1142', []), {});
});

// ── _applySemKeyRenumber：把對照表套用到個案物件的所有引用處 ──────────────────

test('_applySemKeyRenumber：同步更新 semesters／basicInfoSnapshots／semesterStatus／semesterEvaluations', () => {
  const S = load(['_applySemKeyRenumber', '_renumberSemKeys']);
  const c = {
    semesters: ['1141', '1142', '1142#2'],
    basicInfoSnapshots: { 1141: { a: 1 }, 1142: { a: 2 } },
    semesterStatus: { 1141: 'closed', 1142: 'active', '1142#2': 'active' },
    semesterEvaluations: [{ semester: '1142', type: 'closure' }, { semester: '1141', type: 'semester' }],
  };
  const map = S._renumberSemKeys('1142', ['1142', '1142#2']); // { '1142': '1142#1' }
  S._applySemKeyRenumber(c, map);
  assert.deepEqual(c.semesters, ['1141', '1142#1', '1142#2']);
  assert.deepEqual(c.basicInfoSnapshots, { 1141: { a: 1 }, '1142#1': { a: 2 } });
  assert.deepEqual(c.semesterStatus, { 1141: 'closed', '1142#1': 'active', '1142#2': 'active' });
  assert.deepEqual(c.semesterEvaluations, [
    { semester: '1142#1', type: 'closure' },
    { semester: '1141', type: 'semester' }, // 未受影響的學期原樣保留
  ]);
});

test('_applySemKeyRenumber：一併重編 initialInterviews 的 key', () => {
  const S = load(['_applySemKeyRenumber', '_renumberSemKeys']);
  const c = {
    semesters: ['1142', '1142#2'],
    initialInterviews: { 1142: { interviewDate: '2026-06-01' } },
  };
  const map = S._renumberSemKeys('1142', ['1142', '1142#2']);
  S._applySemKeyRenumber(c, map);
  assert.deepEqual(c.initialInterviews, { '1142#1': { interviewDate: '2026-06-01' } });
});

test('_applySemKeyRenumber：空對照表時原樣不動（no-op）', () => {
  const S = load(['_applySemKeyRenumber', '_renumberSemKeys']);
  const c = { semesters: ['1142'], basicInfoSnapshots: { 1142: { a: 1 } } };
  S._applySemKeyRenumber(c, {});
  assert.deepEqual(c.semesters, ['1142']);
  assert.deepEqual(c.basicInfoSnapshots, { 1142: { a: 1 } });
});

test('_applySemKeyRenumber：keyMap 為 null/undefined 不炸', () => {
  const S = load(['_applySemKeyRenumber', '_renumberSemKeys']);
  const c = { semesters: ['1142'] };
  assert.doesNotThrow(() => S._applySemKeyRenumber(c, null));
  assert.doesNotThrow(() => S._applySemKeyRenumber(c, undefined));
});
