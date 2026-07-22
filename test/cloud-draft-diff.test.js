// v248：草稿雲端備援 v2 —— _cloudDraftDiff 純函式單元測試。執行：node --test test/*.test.js
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

test('_cloudDraftDiff：本機新 key（syncedMap 沒有）→ upsert，syncedMap 沒有對應 delete', () => {
  const S = load(['_cloudDraftDiff']);
  const r = S._cloudDraftDiff({ k1: '{"a":1}' }, {});
  assert.deepEqual(r, { upserts: [{ key: 'k1', payload: '{"a":1}' }], deletes: [] });
});

test('_cloudDraftDiff：本機 payload 與已同步值相同 → 不 upsert', () => {
  const S = load(['_cloudDraftDiff']);
  const r = S._cloudDraftDiff({ k1: '{"a":1}' }, { k1: '{"a":1}' });
  assert.deepEqual(r, { upserts: [], deletes: [] });
});

test('_cloudDraftDiff：本機 payload 內容變動 → upsert 帶新值', () => {
  const S = load(['_cloudDraftDiff']);
  const r = S._cloudDraftDiff({ k1: '{"a":2}' }, { k1: '{"a":1}' });
  assert.deepEqual(r, { upserts: [{ key: 'k1', payload: '{"a":2}' }], deletes: [] });
});

test('_cloudDraftDiff：syncedMap 有、本機已刪除（不在 localMap）→ delete', () => {
  const S = load(['_cloudDraftDiff']);
  const r = S._cloudDraftDiff({}, { k1: '{"a":1}' });
  assert.deepEqual(r, { upserts: [], deletes: ['k1'] });
});

test('_cloudDraftDiff：混合情境——新增/不變/變動/刪除同時發生', () => {
  const S = load(['_cloudDraftDiff']);
  const localMap = { unchanged: 'x', changed: 'new-value', added: 'y' };
  const syncedMap = { unchanged: 'x', changed: 'old-value', removed: 'z' };
  const r = S._cloudDraftDiff(localMap, syncedMap);
  assert.deepEqual(r.upserts.sort((a, b) => a.key.localeCompare(b.key)), [
    { key: 'added', payload: 'y' },
    { key: 'changed', payload: 'new-value' },
  ]);
  assert.deepEqual(r.deletes, ['removed']);
});

test('_cloudDraftDiff：兩者皆空 → 空陣列，不炸例外', () => {
  const S = load(['_cloudDraftDiff']);
  assert.deepEqual(S._cloudDraftDiff({}, {}), { upserts: [], deletes: [] });
  assert.deepEqual(S._cloudDraftDiff(null, null), { upserts: [], deletes: [] });
  assert.deepEqual(S._cloudDraftDiff(undefined, undefined), { upserts: [], deletes: [] });
});
