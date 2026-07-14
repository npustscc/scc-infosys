// server/test/envelope.test.js — GAS doPost 三態 envelope 的 bug-for-bug 相容性單元測試。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const envelope = require('../src/envelope');

test('ok：success:true，data 原樣包裹', () => {
  assert.deepEqual(envelope.ok({ foo: 1 }), { success: true, data: { foo: 1 } });
});

test('ok：data 為 undefined 時正規化為 null（避免 JSON.stringify 掉欄位）', () => {
  assert.deepEqual(envelope.ok(undefined), { success: true, data: null });
});

test('bizError：success 仍是 true——這是前端判讀的關鍵陷阱（見 CLAUDE.md/計畫三個陷阱）', () => {
  const e = envelope.bizError('Session expired');
  assert.equal(e.success, true);
  assert.deepEqual(e.data, { error: 'Session expired' });
});

test('bizError：可附加額外欄位（如 bookingsCommit 的 conflictType/with）', () => {
  const e = envelope.bizError('conflict', { conflictType: 'overlap', with: 'xyz' });
  assert.deepEqual(e.data, { error: 'conflict', conflictType: 'overlap', with: 'xyz' });
});

test('fail：success:false，error 為字串', () => {
  const e = envelope.fail(new Error('boom'));
  assert.deepEqual(e, { success: false, error: 'boom' });
});

test('fail：吃字串/非 Error 物件也不炸', () => {
  assert.deepEqual(envelope.fail('plain string'), { success: false, error: 'plain string' });
});

test('錯誤字串語意：invalid_credentials 不是 Session expired / Unauthorized（前端不會誤觸自動重試）', () => {
  const e = envelope.bizError('invalid_credentials');
  assert.notEqual(e.data.error, 'Session expired');
  assert.notEqual(e.data.error, 'Unauthorized');
});
