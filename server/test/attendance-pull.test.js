// server/test/attendance-pull.test.js — 打卡紀錄 Drive 拉取器的合併純函式單元測試。
// 只測 mergeAttendance（不觸網、不建 DB）：add-only 語意——只新增本地沒有的 id，
// 本地既有紀錄／其他頂層欄位一律原樣保留。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { mergeAttendance } = require('../scripts/pull-attendance');

test('空本地 + N 筆 Drive 紀錄 → 全數併入', () => {
  const drive = [
    { id: 'a1', type: 'punch', email: 'x@y.z' },
    { id: 'a2', type: 'punch', email: 'x@y.z' },
    { id: 'a3', type: 'punch', email: 'x@y.z' },
  ];
  const { merged, added, skippedNoId } = mergeAttendance(null, drive);
  assert.equal(added, 3);
  assert.equal(skippedNoId, 0);
  assert.equal(merged.records.length, 3);
  assert.deepEqual(merged.records.map((r) => r.id), ['a1', 'a2', 'a3']);
});

test('重複 id 不重複加：本地已有的 id，Drive 同 id 不再新增', () => {
  const local = { records: [{ id: 'a1', type: 'punch', note: 'local-original' }] };
  const drive = [
    { id: 'a1', type: 'punch', note: 'drive-version' },
    { id: 'a2', type: 'punch' },
  ];
  const { merged, added } = mergeAttendance(local, drive);
  assert.equal(added, 1, '只有 a2 是新的');
  assert.equal(merged.records.length, 2);
});

test('本地既有紀錄內容不被 Drive 同 id 覆蓋（add-only，非 upsert）', () => {
  const local = { records: [{ id: 'a1', type: 'punch', note: 'manual-correction' }] };
  const drive = [{ id: 'a1', type: 'punch', note: 'from-drive-should-not-win' }];
  const { merged, added } = mergeAttendance(local, drive);
  assert.equal(added, 0);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.records[0].note, 'manual-correction', '本地既有紀錄絕不可被 Drive 同 id 版本覆寫');
});

test('Drive 紀錄無 id 或 id 非非空字串 → 跳過並計數', () => {
  const drive = [
    { type: 'punch' }, // 無 id
    { id: '', type: 'punch' }, // 空字串
    { id: 123, type: 'punch' }, // 非字串
    { id: null, type: 'punch' },
    { id: 'ok1', type: 'punch' },
  ];
  const { merged, added, skippedNoId } = mergeAttendance(null, drive);
  assert.equal(added, 1);
  assert.equal(skippedNoId, 4);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.records[0].id, 'ok1');
});

test('保留 localData 其他頂層欄位（非 records）', () => {
  const local = { records: [{ id: 'a1' }], schemaVersion: 3, note: 'keep-me' };
  const drive = [{ id: 'a2' }];
  const { merged } = mergeAttendance(local, drive);
  assert.equal(merged.schemaVersion, 3);
  assert.equal(merged.note, 'keep-me');
  assert.equal(merged.records.length, 2);
});

test('added 計數正確：混合新舊/無效 id 的情境', () => {
  const local = { records: [{ id: 'a1' }, { id: 'a2' }] };
  const drive = [
    { id: 'a1' }, // 重複，不算新增
    { id: 'a2' }, // 重複，不算新增
    { id: 'a3' }, // 新
    { id: 'a4' }, // 新
    {}, // 無 id，skippedNoId
  ];
  const { merged, added, skippedNoId } = mergeAttendance(local, drive);
  assert.equal(added, 2);
  assert.equal(skippedNoId, 1);
  assert.equal(merged.records.length, 4);
});

test('localData 為 null 時，不因此產生非 records 的多餘欄位', () => {
  const { merged } = mergeAttendance(null, [{ id: 'a1' }]);
  assert.deepEqual(Object.keys(merged), ['records']);
});
