// 泛用清單型 JSON 檔併發安全寫入的 diff 純函式測試（2026-07-09 事故延伸修復，v151）。
// 對象：_diffListById（依 id 陣列 diff）、_diffMapByKey（依 key 物件 diff，psych_test_db.json 用）。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

test('_diffListById：新增項目 → 進 upserts，removes 為空', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }];
  const curr = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
  const { upserts, removes } = S._diffListById(prev, curr);
  assert.deepEqual(upserts, [{ id: 'b', v: 2 }]);
  assert.deepEqual(removes, []);
});

test('_diffListById：修改既有項目（內容不同）→ 進 upserts', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }];
  const curr = [{ id: 'a', v: 2 }];
  const { upserts, removes } = S._diffListById(prev, curr);
  assert.deepEqual(upserts, [{ id: 'a', v: 2 }]);
  assert.deepEqual(removes, []);
});

test('_diffListById：未修改項目 → 不進 upserts', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
  const curr = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
  const { upserts, removes } = S._diffListById(prev, curr);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, []);
});

test('_diffListById：prev 有、curr 沒有 → 進 removes', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
  const curr = [{ id: 'a', v: 1 }];
  const { upserts, removes } = S._diffListById(prev, curr);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, ['b']);
});

test('_diffListById：新增+修改+刪除混合', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }];
  const curr = [{ id: 'a', v: 1 }, { id: 'b', v: 99 }, { id: 'd', v: 4 }];
  const { upserts, removes } = S._diffListById(prev, curr);
  assert.deepEqual(upserts.sort((x, y) => x.id.localeCompare(y.id)), [{ id: 'b', v: 99 }, { id: 'd', v: 4 }]);
  assert.deepEqual(removes, ['c']);
});

test('_diffListById：curr 缺 id 的元素 → 回傳 null（無法安全 diff）', () => {
  const S = load(['_diffListById']);
  const prev = [{ id: 'a', v: 1 }];
  const curr = [{ id: 'a', v: 1 }, { v: 2 }];
  assert.equal(S._diffListById(prev, curr), null);
});

test('_diffListById：prev 缺 id 的元素 → 回傳 null', () => {
  const S = load(['_diffListById']);
  const prev = [{ v: 1 }];
  const curr = [{ id: 'a', v: 1 }];
  assert.equal(S._diffListById(prev, curr), null);
});

test('_diffListById：兩邊皆空陣列 → upserts/removes 皆空', () => {
  const S = load(['_diffListById']);
  const { upserts, removes } = S._diffListById([], []);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, []);
});

test('_diffListById：prev/curr 為 undefined 不炸，視同空陣列', () => {
  const S = load(['_diffListById']);
  assert.doesNotThrow(() => S._diffListById(undefined, undefined));
  const { upserts, removes } = S._diffListById(undefined, [{ id: 'a', v: 1 }]);
  assert.deepEqual(upserts, [{ id: 'a', v: 1 }]);
  assert.deepEqual(removes, []);
});

test('_diffMapByKey：新增 key → 進 upserts', () => {
  const S = load(['_diffMapByKey']);
  const prev = { s1: [{ t: 1 }] };
  const curr = { s1: [{ t: 1 }], s2: [{ t: 2 }] };
  const { upserts, removes } = S._diffMapByKey(prev, curr);
  assert.deepEqual(upserts, { s2: [{ t: 2 }] });
  assert.deepEqual(removes, []);
});

test('_diffMapByKey：修改既有 key 的 value（陣列內容不同）→ 進 upserts', () => {
  const S = load(['_diffMapByKey']);
  const prev = { s1: [{ t: 1 }] };
  const curr = { s1: [{ t: 1 }, { t: 2 }] };
  const { upserts, removes } = S._diffMapByKey(prev, curr);
  assert.deepEqual(upserts, { s1: [{ t: 1 }, { t: 2 }] });
  assert.deepEqual(removes, []);
});

test('_diffMapByKey：未修改 key → 不進 upserts', () => {
  const S = load(['_diffMapByKey']);
  const prev = { s1: [{ t: 1 }] };
  const curr = { s1: [{ t: 1 }] };
  const { upserts, removes } = S._diffMapByKey(prev, curr);
  assert.deepEqual(upserts, {});
  assert.deepEqual(removes, []);
});

test('_diffMapByKey：prev 有、curr 沒有 → 進 removes', () => {
  const S = load(['_diffMapByKey']);
  const prev = { s1: [{ t: 1 }], s2: [{ t: 2 }] };
  const curr = { s1: [{ t: 1 }] };
  const { upserts, removes } = S._diffMapByKey(prev, curr);
  assert.deepEqual(upserts, {});
  assert.deepEqual(removes, ['s2']);
});

test('_diffMapByKey：兩邊皆空物件 → upserts/removes 皆空', () => {
  const S = load(['_diffMapByKey']);
  const { upserts, removes } = S._diffMapByKey({}, {});
  assert.deepEqual(upserts, {});
  assert.deepEqual(removes, []);
});

test('_diffMapByKey：prev/curr 為 undefined 或非物件不炸，視同空物件', () => {
  const S = load(['_diffMapByKey']);
  assert.doesNotThrow(() => S._diffMapByKey(undefined, undefined));
  const { upserts, removes } = S._diffMapByKey(null, { a: [1] });
  assert.deepEqual(upserts, { a: [1] });
  assert.deepEqual(removes, []);
});
