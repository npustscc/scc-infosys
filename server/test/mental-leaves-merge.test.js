// server/test/mental-leaves-merge.test.js — mergeMentalLeaves 純函式單元測試（不觸網、不建 DB）。
// 比照 test/attendance-pull.test.js 的 mergeAttendance 測試風格：add-only 語意——只新增本地沒有
// 的 emailId，本地既有紀錄（含使用者手動編輯過的 handlingStatus 等欄位）一律原樣保留。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { mergeMentalLeaves } = require('../src/mail/mentalLeaves');

test('空本地 + N 筆新解析紀錄 → 全數併入', () => {
  const incoming = [
    { id: 'ml_a', emailId: 'a', studentId: 'U1' },
    { id: 'ml_b', emailId: 'b', studentId: 'U2' },
  ];
  const { merged, added, addedRecords } = mergeMentalLeaves([], incoming);
  assert.equal(added, 2);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((r) => r.emailId), ['a', 'b']);
  assert.deepEqual(addedRecords.map((r) => r.emailId), ['a', 'b']);
});

test('重複 emailId 不重複加：本地已有的 emailId，新解析出的同 emailId 不再新增', () => {
  const existing = [{ id: 'ml_a', emailId: 'a', handlingStatus: '待處理', acknowledgedBy: 'staff@x.com' }];
  const incoming = [
    { id: 'ml_a', emailId: 'a', handlingStatus: '非危機' }, // 同一封信被重新查詢/解析出來（不應發生，但需驗證防呆）
    { id: 'ml_b', emailId: 'b' },
  ];
  const { merged, added } = mergeMentalLeaves(existing, incoming);
  assert.equal(added, 1, '只有 b 是新的');
  assert.equal(merged.length, 2);
});

test('本地既有紀錄的使用者欄位不被同 emailId 的新解析結果覆蓋（add-only，非 upsert）', () => {
  const existing = [{ id: 'ml_a', emailId: 'a', handlingStatus: '待處理', acknowledgedBy: 'staff@x.com', deleted: false }];
  const incoming = [{ id: 'ml_a', emailId: 'a', handlingStatus: '非危機', acknowledgedBy: null }];
  const { merged, added } = mergeMentalLeaves(existing, incoming);
  assert.equal(added, 0);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].handlingStatus, '待處理', '既有 handlingStatus 不可被覆蓋');
  assert.equal(merged[0].acknowledgedBy, 'staff@x.com', '既有 acknowledgedBy 不可被覆蓋');
});

test('incoming 紀錄無 emailId 或非非空字串 → 略過（不 throw、不計入 added）', () => {
  const incoming = [
    { id: 'ml_x' }, // 無 emailId
    { id: 'ml_y', emailId: '' }, // 空字串
    { id: 'ml_z', emailId: 123 }, // 非字串
    { id: 'ml_ok', emailId: 'ok1' },
  ];
  const { merged, added } = mergeMentalLeaves([], incoming);
  assert.equal(added, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].emailId, 'ok1');
});

test('existingRecords 非陣列（如 undefined）時視為空陣列，不 throw', () => {
  const { merged, added } = mergeMentalLeaves(undefined, [{ id: 'ml_a', emailId: 'a' }]);
  assert.equal(added, 1);
  assert.equal(merged.length, 1);
});

test('冪等：對同一批 incoming 執行兩次合併，第二次 added=0（模擬重跑排程）', () => {
  const incoming = [{ id: 'ml_a', emailId: 'a' }, { id: 'ml_b', emailId: 'b' }];
  const first = mergeMentalLeaves([], incoming);
  assert.equal(first.added, 2);
  const second = mergeMentalLeaves(first.merged, incoming);
  assert.equal(second.added, 0, '重跑同一批不得重複記錄');
  assert.equal(second.merged.length, 2);
});
