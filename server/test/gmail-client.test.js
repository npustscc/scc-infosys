// server/test/gmail-client.test.js — src/google/gmail.js 薄 REST 層單元測試。不打真實網路——
// monkey-patch 全域 fetch，驗證每個 helper 組出的 path/method/body 與回應解析/錯誤處理。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const gmail = require('../src/google/gmail');

function withFetch(fakeFetch, fn) {
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = orig; });
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('listMessages：組出正確 q/maxResults/pageToken query string', async () => {
  let seenUrl;
  await withFetch(async (url) => { seenUrl = url; return jsonRes(200, { messages: [{ id: 'm1' }] }); }, async () => {
    const r = await gmail.listMessages('TOK', 'subject:(請假)', { maxResults: 50, pageToken: 'PT' });
    assert.deepEqual(r, { messages: [{ id: 'm1' }] });
  });
  assert.ok(seenUrl.includes('/messages?q='));
  assert.ok(seenUrl.includes(encodeURIComponent('subject:(請假)')));
  assert.ok(seenUrl.includes('maxResults=50'));
  assert.ok(seenUrl.includes('pageToken=PT'));
});

test('getMessage：組出 format=full 的 path', async () => {
  let seenUrl;
  await withFetch(async (url) => { seenUrl = url; return jsonRes(200, { id: 'm1', payload: {} }); }, async () => {
    await gmail.getMessage('TOK', 'm1');
  });
  assert.ok(seenUrl.endsWith('/messages/m1?format=full'));
});

test('modifyLabels：POST body 只含有值的 addLabelIds/removeLabelIds', async () => {
  let seenBody, seenMethod;
  await withFetch(async (url, opts) => { seenMethod = opts.method; seenBody = JSON.parse(opts.body); return jsonRes(200, { id: 'm1' }); }, async () => {
    await gmail.modifyLabels('TOK', 'm1', { addLabelIds: ['L1'] });
  });
  assert.equal(seenMethod, 'POST');
  assert.deepEqual(seenBody, { addLabelIds: ['L1'] });
});

test('getOrCreateLabel：既有同名 label → 直接回傳其 id，不呼叫建立', async () => {
  let createCalled = false;
  await withFetch(async (url, opts) => {
    if ((opts && opts.method) === 'POST') { createCalled = true; return jsonRes(200, { id: 'NEW' }); }
    return jsonRes(200, { labels: [{ id: 'EXIST', name: 'ml-processed-dev' }] });
  }, async () => {
    const id = await gmail.getOrCreateLabel('TOK', 'ml-processed-dev');
    assert.equal(id, 'EXIST');
  });
  assert.equal(createCalled, false);
});

test('getOrCreateLabel：無同名 label → 建立新的並回傳其 id', async () => {
  await withFetch(async (url, opts) => {
    if ((opts && opts.method) === 'POST') return jsonRes(200, { id: 'NEW-ID', name: 'ml-processed-dev' });
    return jsonRes(200, { labels: [] });
  }, async () => {
    const id = await gmail.getOrCreateLabel('TOK', 'ml-processed-dev');
    assert.equal(id, 'NEW-ID');
  });
});

test('gmailFetch：非 2xx → throw 含 HTTP 狀態與 Gmail 錯誤訊息', async () => {
  await withFetch(async () => jsonRes(403, { error: { message: 'Insufficient Permission' } }), async () => {
    await assert.rejects(() => gmail.listLabels('TOK'), /Insufficient Permission/);
  });
});

test('gmailFetch：回應不是合法 JSON → throw', async () => {
  await withFetch(async () => ({ ok: true, status: 200, text: async () => 'not json' }), async () => {
    await assert.rejects(() => gmail.listLabels('TOK'), /不是合法 JSON/);
  });
});
