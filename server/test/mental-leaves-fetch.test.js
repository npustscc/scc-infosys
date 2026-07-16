// server/test/mental-leaves-fetch.test.js — fetchAndMergeMentalLeaves 協調函式測試（:memory: db，
// gmailClient 為手工假物件，不觸網）。涵蓋：新增寫入／貼標、冪等重跑不重複、單封信解析失敗不
// 中斷整批、貼標失敗不影響已寫入的紀錄、loadMlKeywords 讀 config.json 覆寫與預設 fallback。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');
const ml = require('../src/mail/mentalLeaves');

const ROOT = 'ROOT_ML_TEST';
const CTX = { root: ROOT };

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function makeGmailDoc(id, subject, internalDate) {
  return {
    id,
    internalDate: internalDate || '1700000000000',
    payload: {
      headers: [{ name: 'Subject', value: subject }],
      mimeType: 'text/plain',
      body: { data: b64url('') },
    },
  };
}

function makeFakeGmail({ messages, docs, labelId, failGetIds, failModifyIds }) {
  const calls = { getMessage: [], modifyLabels: [], getOrCreateLabel: 0, listMessages: 0 };
  return {
    calls,
    async getOrCreateLabel() { calls.getOrCreateLabel++; return labelId || 'LBL1'; },
    async listMessages() { calls.listMessages++; return { messages }; },
    async getMessage(token, id) {
      calls.getMessage.push(id);
      if (failGetIds && failGetIds.has(id)) throw new Error('模擬 getMessage 失敗: ' + id);
      const doc = docs[id];
      if (!doc) throw new Error('no such message: ' + id);
      return doc;
    },
    async modifyLabels(token, id) {
      calls.modifyLabels.push(id);
      if (failModifyIds && failModifyIds.has(id)) throw new Error('模擬 modifyLabels 失敗: ' + id);
      return { id };
    },
  };
}

test('fetchAndMergeMentalLeaves：首次執行 → 新增紀錄、寫入 mental_leaves.json、對已解析信件貼標', async () => {
  const db = openDb(':memory:');
  const docs = {
    m1: makeGmailDoc('m1', '學號:U1234567 王小明 資訊工程系 學生請假 因 感冒，申請 身心調適假從2026/07/01至2026/07/01'),
    m2: makeGmailDoc('m2', 'U7654321_陳小華_資訊管理系_腸胃炎'),
  };
  const gmailClient = makeFakeGmail({ messages: [{ id: 'm1' }, { id: 'm2' }], docs });

  const result = await ml.fetchAndMergeMentalLeaves(db, CTX, {
    accessToken: 'FAKE_TOKEN', labelName: 'ml-processed-dev', gmailClient, keywords: [],
  });

  assert.equal(result.newCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.batchCount, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.labelErrors, []);
  assert.equal(gmailClient.calls.modifyLabels.length, 2);

  const { data } = vdrive.readJson(db, 'mental_leaves.json', CTX);
  assert.equal(data.records.length, 2);
  assert.ok(data.lastFetchedAt);
  assert.deepEqual(data.records.map((r) => r.emailId).sort(), ['m1', 'm2']);
});

test('fetchAndMergeMentalLeaves：冪等重跑——同一批訊息第二次執行 newCount=0，不重複呼叫 getMessage', async () => {
  const db = openDb(':memory:');
  const docs = { m1: makeGmailDoc('m1', '學號:U1234567 王小明 資訊工程系 學生請假 因 感冒，申請 身心調適假從2026/07/01至2026/07/01') };
  const gmailClient1 = makeFakeGmail({ messages: [{ id: 'm1' }], docs });
  await ml.fetchAndMergeMentalLeaves(db, CTX, { accessToken: 'T', labelName: 'ml-processed-dev', gmailClient: gmailClient1, keywords: [] });

  // 模擬排程下一輪：Gmail 查詢仍回傳 m1（例如上次貼標失敗，或查詢時間窗重疊）。
  const gmailClient2 = makeFakeGmail({ messages: [{ id: 'm1' }], docs });
  const result2 = await ml.fetchAndMergeMentalLeaves(db, CTX, { accessToken: 'T', labelName: 'ml-processed-dev', gmailClient: gmailClient2, keywords: [] });

  assert.equal(result2.newCount, 0);
  assert.equal(result2.totalCount, 1);
  assert.equal(gmailClient2.calls.getMessage.length, 0, '已入檔的 emailId 不應重新呼叫 getMessage');
  assert.equal(gmailClient2.calls.modifyLabels.length, 0, '沒有新解析出的信件，不應呼叫貼標');
});

test('fetchAndMergeMentalLeaves：單封信 getMessage 失敗不中斷整批，計入 errors', async () => {
  const db = openDb(':memory:');
  const docs = { m1: makeGmailDoc('m1', '學號:U1234567 王小明 資訊工程系 學生請假 因 感冒，申請 身心調適假從2026/07/01至2026/07/01') };
  const gmailClient = makeFakeGmail({ messages: [{ id: 'm1' }, { id: 'm2' }], docs, failGetIds: new Set(['m2']) });

  const result = await ml.fetchAndMergeMentalLeaves(db, CTX, { accessToken: 'T', labelName: 'ml-processed-dev', gmailClient, keywords: [] });

  assert.equal(result.newCount, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'm2');
});

test('fetchAndMergeMentalLeaves：抽不出 studentId/name 的信件不寫入、不貼標（對映 GAS 略過行為）', async () => {
  const db = openDb(':memory:');
  const docs = { m1: makeGmailDoc('m1', '無法解析的主旨') };
  const gmailClient = makeFakeGmail({ messages: [{ id: 'm1' }], docs });

  const result = await ml.fetchAndMergeMentalLeaves(db, CTX, { accessToken: 'T', labelName: 'ml-processed-dev', gmailClient, keywords: [] });

  assert.equal(result.newCount, 0);
  assert.equal(result.totalCount, 0);
  assert.equal(gmailClient.calls.modifyLabels.length, 0);
  assert.deepEqual(result.errors, []);
});

test('fetchAndMergeMentalLeaves：貼標失敗記入 labelErrors，但紀錄仍成功寫入本地', async () => {
  const db = openDb(':memory:');
  const docs = { m1: makeGmailDoc('m1', '學號:U1234567 王小明 資訊工程系 學生請假 因 感冒，申請 身心調適假從2026/07/01至2026/07/01') };
  const gmailClient = makeFakeGmail({ messages: [{ id: 'm1' }], docs, failModifyIds: new Set(['m1']) });

  const result = await ml.fetchAndMergeMentalLeaves(db, CTX, { accessToken: 'T', labelName: 'ml-processed-dev', gmailClient, keywords: [] });

  assert.equal(result.newCount, 1);
  assert.equal(result.labelErrors.length, 1);
  assert.equal(result.labelErrors[0].id, 'm1');
  const { data } = vdrive.readJson(db, 'mental_leaves.json', CTX);
  assert.equal(data.records.length, 1);
});

test('loadMlKeywords：config.json 有 mentalLeaveKeywords → 使用該表，不落回預設', () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { mentalLeaveKeywords: [{ kw: '自訂危機詞', level: 3 }] } });
  const kws = ml.loadMlKeywords(db, CTX);
  assert.deepEqual(kws, [{ kw: '自訂危機詞', level: 3 }]);
});

test('loadMlKeywords：config.json 不存在或無 mentalLeaveKeywords → 落回預設表', () => {
  const db = openDb(':memory:');
  const kws = ml.loadMlKeywords(db, CTX);
  assert.deepEqual(kws, ml.DEFAULT_KEYWORDS);
});
