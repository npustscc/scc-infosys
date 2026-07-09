// saveCasesChunks 改走後端 casesUpsert（LockService 鎖內 RMW）的純函式測試（v155）。
// 對象：_chunkCommitPayload —— 算出單一 chunk 要送給 casesUpsert 的 { upserts, removes }。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// 測試用簡化分塊規則：id 前綴（前 3 碼）決定 chunk 名稱
const chunkNameOf = id => (id || '').slice(0, 3) + 'chunk';

test('_chunkCommitPayload：本 chunk 有被修改的個案 → 進 upserts，並剝離 _indexOnly/_fullLoaded', () => {
  const S = load(['_chunkCommitPayload']);
  const cases = { a01: { id: 'a01', name: '甲', _fullLoaded: true, _indexOnly: false } };
  const { upserts, removes } = S._chunkCommitPayload('a01chunk', ['a01'], [], [], id => cases[id], chunkNameOf);
  assert.deepEqual(upserts, [{ id: 'a01', name: '甲' }]);
  assert.deepEqual(removes, []);
});

test('_chunkCommitPayload：modifiedIds 屬於其他 chunk → 不進本次 upserts', () => {
  const S = load(['_chunkCommitPayload']);
  const cases = { b01: { id: 'b01', name: '乙' } };
  const { upserts, removes } = S._chunkCommitPayload('a01chunk', ['b01'], [], [], id => cases[id], chunkNameOf);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, []);
});

test('_chunkCommitPayload：modifiedIds 在記憶體找不到 → 略過（不炸、不進 upserts）', () => {
  const S = load(['_chunkCommitPayload']);
  const { upserts } = S._chunkCommitPayload('a01chunk', ['a01'], [], [], () => undefined, chunkNameOf);
  assert.deepEqual(upserts, []);
});

test('_chunkCommitPayload：modifiedIds 為 _indexOnly stub → 拋錯中止（2026-07-08 事故防護）', () => {
  const S = load(['_chunkCommitPayload']);
  const cases = { a01: { id: 'a01', _indexOnly: true } };
  assert.throws(
    () => S._chunkCommitPayload('a01chunk', ['a01'], [], [], id => cases[id], chunkNameOf),
    /完整資料未載入/
  );
});

test('_chunkCommitPayload：removeIds 屬於本 chunk → 進 removes', () => {
  const S = load(['_chunkCommitPayload']);
  const { upserts, removes } = S._chunkCommitPayload('a01chunk', [], ['a01-2'], [], () => undefined, chunkNameOf);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, ['a01-2']);
});

test('_chunkCommitPayload：deletedIds 屬於本 chunk → 也進 removes', () => {
  const S = load(['_chunkCommitPayload']);
  const { removes } = S._chunkCommitPayload('a01chunk', [], [], ['a01-3'], () => undefined, chunkNameOf);
  assert.deepEqual(removes, ['a01-3']);
});

test('_chunkCommitPayload：removeIds 與 deletedIds 有重複 id → removes 去重', () => {
  const S = load(['_chunkCommitPayload']);
  const { removes } = S._chunkCommitPayload('a01chunk', [], ['a01-4'], ['a01-4'], () => undefined, chunkNameOf);
  assert.deepEqual(removes, ['a01-4']);
});

test('_chunkCommitPayload：removeIds/deletedIds 屬於其他 chunk → 不進本次 removes', () => {
  const S = load(['_chunkCommitPayload']);
  const { removes } = S._chunkCommitPayload('a01chunk', [], ['b05'], ['c06'], () => undefined, chunkNameOf);
  assert.deepEqual(removes, []);
});

test('_chunkCommitPayload：新增+修改+刪除混合於同一 chunk', () => {
  const S = load(['_chunkCommitPayload']);
  const cases = {
    'a01-1': { id: 'a01-1', v: 1 },
    'a01-2': { id: 'a01-2', v: 2, _indexOnly: false, _fullLoaded: true },
  };
  const { upserts, removes } = S._chunkCommitPayload(
    'a01chunk', ['a01-1', 'a01-2'], ['a01-3'], ['a01-4'], id => cases[id], chunkNameOf
  );
  assert.deepEqual(
    upserts.sort((x, y) => x.id.localeCompare(y.id)),
    [{ id: 'a01-1', v: 1 }, { id: 'a01-2', v: 2 }]
  );
  assert.deepEqual(removes.sort(), ['a01-3', 'a01-4']);
});

test('_chunkCommitPayload：全空輸入 → upserts/removes 皆空陣列', () => {
  const S = load(['_chunkCommitPayload']);
  const { upserts, removes } = S._chunkCommitPayload('a01chunk', [], [], [], () => undefined, chunkNameOf);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, []);
});
