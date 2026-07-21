// server/test/openmail-unread.test.js — v238 信箱未讀推播（openmail/unreadPush.js）單元測試。
// 全部用 deps 注入假的 sse/credStore/client，不碰真 IMAP、不碰 sqlite（tick 本身不吃 db）。
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const unreadPush = require('../src/openmail/unreadPush');

// 每個測試前清空模組內的 lastSent 記憶，避免測試間互相污染（多個 test 共用同一個 require 進來
// 的模組實例，lastSent 是 module-level Map）。
beforeEach(() => {
  unreadPush._lastSentForTest.clear();
});

function fakeSse(connected) {
  const sent = [];
  return {
    connectedEmails: () => connected,
    sendTo: (email, eventName, dataObj) => sent.push({ email, eventName, dataObj }),
    _sent: sent,
  };
}

function fakeCredStore(map) {
  return { get: (email) => (Object.prototype.hasOwnProperty.call(map, email) ? map[email] : null) };
}

function fakeClient(unseenByEmail, calls) {
  return {
    withImap: async (email, mailUser, mailPass, config, fn) => {
      calls.push(email);
      if (unseenByEmail[email] instanceof Error) throw unseenByEmail[email];
      return fn({ status: async () => ({ unseen: unseenByEmail[email] }) });
    },
  };
}

test('無 SSE 連線：withImap 未被呼叫', async () => {
  const sse = fakeSse([]);
  const credStore = fakeCredStore({ 'a@x.com': { mailUser: 'a', mailPass: 'p' } });
  const calls = [];
  const client = fakeClient({}, calls);
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(sse._sent.length, 0);
});

test('有連線但 credStore 回 null：withImap 未被呼叫，且 lastSent 清除', async () => {
  const sse = fakeSse(['a@x.com']);
  const credStore = fakeCredStore({}); // 無帳密
  const calls = [];
  const client = fakeClient({}, calls);
  unreadPush._lastSentForTest.set('a@x.com', 3); // 模擬先前推過
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(sse._sent.length, 0);
  assert.strictEqual(unreadPush._lastSentForTest.has('a@x.com'), false);
});

test('有連線有帳密：首輪推播、同值不重送、值變了再送', async () => {
  const sse = fakeSse(['a@x.com']);
  const credStore = fakeCredStore({ 'a@x.com': { mailUser: 'a', mailPass: 'p' } });
  const calls = [];
  const unseenByEmail = { 'a@x.com': 5 };
  const client = fakeClient(unseenByEmail, calls);

  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(sse._sent.length, 1);
  assert.deepStrictEqual(sse._sent[0], { email: 'a@x.com', eventName: 'omUnread', dataObj: { unseen: 5 } });

  // 同值第二輪：不重送
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(sse._sent.length, 1);

  // 值變了：再送一次
  unseenByEmail['a@x.com'] = 7;
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(sse._sent.length, 2);
  assert.deepStrictEqual(sse._sent[1], { email: 'a@x.com', eventName: 'omUnread', dataObj: { unseen: 7 } });

  assert.strictEqual(calls.length, 3);
});

test('withImap throw：不炸、不 sendTo，下一個 email 照常處理', async () => {
  const sse = fakeSse(['bad@x.com', 'ok@x.com']);
  const credStore = fakeCredStore({
    'bad@x.com': { mailUser: 'bad', mailPass: 'p' },
    'ok@x.com': { mailUser: 'ok', mailPass: 'p' },
  });
  const calls = [];
  const unseenByEmail = { 'bad@x.com': new Error('IMAP connection reset'), 'ok@x.com': 2 };
  const client = fakeClient(unseenByEmail, calls);

  await assert.doesNotReject(unreadPush.tick(null, {}, { sse, credStore, client }));
  assert.deepStrictEqual(calls, ['bad@x.com', 'ok@x.com']);
  assert.strictEqual(sse._sent.length, 1);
  assert.deepStrictEqual(sse._sent[0], { email: 'ok@x.com', eventName: 'omUnread', dataObj: { unseen: 2 } });
});

test('兩個 email 各自獨立：A 變 B 不變 → 只推 A', async () => {
  const sse = fakeSse(['a@x.com', 'b@x.com']);
  const credStore = fakeCredStore({
    'a@x.com': { mailUser: 'a', mailPass: 'p' },
    'b@x.com': { mailUser: 'b', mailPass: 'p' },
  });
  const calls = [];
  const unseenByEmail = { 'a@x.com': 1, 'b@x.com': 4 };
  const client = fakeClient(unseenByEmail, calls);

  // 首輪：兩個都推
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(sse._sent.length, 2);

  // 第二輪：A 變了，B 不變 → 只推 A
  unseenByEmail['a@x.com'] = 9;
  await unreadPush.tick(null, {}, { sse, credStore, client });
  assert.strictEqual(sse._sent.length, 3);
  assert.deepStrictEqual(sse._sent[2], { email: 'a@x.com', eventName: 'omUnread', dataObj: { unseen: 9 } });
});
