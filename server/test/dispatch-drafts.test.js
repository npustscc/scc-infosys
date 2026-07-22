// server/test/dispatch-drafts.test.js — dispatch.js 對 draftCloudSync/draftCloudList action 的接線／
// 授權閘／owner 隔離／批次上限／TTL smoke test（v248 草稿雲端備援 v2）。比照
// test/dispatch-office-decrypt.test.js／test/openmail-archive.test.js 寫法：直接呼叫 handleRequest，
// :memory: db，不打真實網路。額外驗證 audit_log 不含 payload 內容，只記筆數/位元組數
// （見 audit.js summarizeDraftsParams）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const draftsActions = require('../src/actions/drafts');

const ROOT = 'ROOT_DRAFTS_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-drafts',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password, {});
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

// ── 授權閘 ──────────────────────────────────────────────────────────────

test('draftCloudSync：未帶 sessionToken → Session expired（一般授權閘生效，非 AUTHZ_EXEMPT）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', rootFolderId: ROOT, upserts: [{ key: 'k1', payload: '{}' }], deletes: [],
  });
  assert.equal(r.data.error, 'Session expired');
});

test('draftCloudList：已登入但不在 config.users → Unauthorized user', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'nobody@x.com', 'right-password', {});
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: {} } });
  const login1 = await login(db, testConfig(), 'nobody@x.com', 'right-password');
  assert.equal(login1.data.error, 'Unauthorized user');
});

// ── owner 隔離 ──────────────────────────────────────────────────────────

test('A 存的草稿 B list 不到；B 刪不掉（deleted=0）', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'a@x.com', 'right-password', {});
  await local.upsertUser(db, 'b@x.com', 'right-password', {});
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { 'a@x.com': { role: '專任諮商心理師' }, 'b@x.com': { role: '專任諮商心理師' } } },
  });
  const loginA = await login(db, testConfig(), 'a@x.com', 'right-password');
  const loginB = await login(db, testConfig(), 'b@x.com', 'right-password');

  const syncA = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: loginA.data.sessionToken, rootFolderId: ROOT,
    upserts: [{ key: 'scc_draft_case_a@x.com_new', payload: JSON.stringify({ name: '王小明' }) }], deletes: [],
  });
  assert.equal(syncA.success, true);
  assert.deepEqual(syncA.data.saved, ['scc_draft_case_a@x.com_new']);

  const listB = await handleRequest(db, testConfig(), {
    action: 'draftCloudList', sessionToken: loginB.data.sessionToken, rootFolderId: ROOT,
  });
  assert.equal(listB.success, true);
  assert.deepEqual(listB.data.drafts, []);

  const delB = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: loginB.data.sessionToken, rootFolderId: ROOT,
    upserts: [], deletes: ['scc_draft_case_a@x.com_new'],
  });
  assert.equal(delB.success, true);
  assert.equal(delB.data.deleted, 0);

  // A 仍看得到自己的草稿（未被 B 誤刪）
  const listA = await handleRequest(db, testConfig(), {
    action: 'draftCloudList', sessionToken: loginA.data.sessionToken, rootFolderId: ROOT,
  });
  assert.equal(listA.data.drafts.length, 1);
});

// ── upsert → list → delete 循環 ────────────────────────────────────────

test('upsert → list → delete 循環：完整走一遍', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const sync1 = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [
      { key: 'evr_draft_C001_a@x.com', payload: JSON.stringify({ records: [{ note: 'x' }] }) },
      { key: 'scc_om_compose_draft_a@x.com', payload: JSON.stringify({ subject: 'hi' }) },
    ], deletes: [],
  });
  assert.equal(sync1.success, true);
  assert.equal(sync1.data.saved.length, 2);
  assert.equal(sync1.data.deleted, 0);
  assert.deepEqual(sync1.data.skipped, []);

  const list1 = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list1.data.drafts.length, 2);
  assert.ok(list1.data.drafts.some(d => d.key === 'evr_draft_C001_a@x.com'));

  // 更新其中一筆＋刪除另一筆
  const sync2 = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [{ key: 'evr_draft_C001_a@x.com', payload: JSON.stringify({ records: [{ note: 'y' }] }) }],
    deletes: ['scc_om_compose_draft_a@x.com'],
  });
  assert.equal(sync2.data.saved.length, 1);
  assert.equal(sync2.data.deleted, 1);

  const list2 = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list2.data.drafts.length, 1);
  assert.match(list2.data.drafts[0].payload, /"note":"y"/);
});

// ── 邊界：payload 過大 / 超過 50 筆上限 / 批次過大 ────────────────────────

test('payload 超過 200KB 被 skip，不寫入', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const bigPayload = JSON.stringify({ blob: 'x'.repeat(201 * 1024) });

  const r = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [{ key: 'scc_draft_issue_a@x.com', payload: bigPayload }], deletes: [],
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.saved, []);
  assert.equal(r.data.skipped.length, 1);
  assert.equal(r.data.skipped[0].key, 'scc_draft_issue_a@x.com');
  assert.equal(r.data.skipped[0].reason, 'payload_too_large');

  const list = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list.data.drafts.length, 0);
});

test('超過每人 50 筆上限：第 51 筆新 key 被 skip，既有 key 更新不受影響', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  // 先塞滿 50 筆（分批，避免一次超過單批 30 筆上限）
  for (let batch = 0; batch < 2; batch++) {
    const upserts = [];
    for (let i = batch * 25; i < batch * 25 + 25; i++) {
      upserts.push({ key: `scc_draft_case_a@x.com_${i}`, payload: JSON.stringify({ n: i }) });
    }
    const r = await handleRequest(db, testConfig(), {
      action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT, upserts, deletes: [],
    });
    assert.equal(r.data.saved.length, 25);
  }

  const list1 = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list1.data.drafts.length, 50);

  // 第 51 筆新 key → 被 skip
  const r51 = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [{ key: 'scc_draft_case_a@x.com_new_key', payload: '{}' }], deletes: [],
  });
  assert.deepEqual(r51.data.saved, []);
  assert.equal(r51.data.skipped[0].reason, 'user_draft_limit');

  // 更新既有 key（不佔新額度）→ 應成功
  const rUpdate = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [{ key: 'scc_draft_case_a@x.com_0', payload: JSON.stringify({ n: 'updated' }) }], deletes: [],
  });
  assert.deepEqual(rUpdate.data.saved, ['scc_draft_case_a@x.com_0']);
  assert.deepEqual(rUpdate.data.skipped, []);

  const list2 = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list2.data.drafts.length, 50); // 未增加
});

test('單批 upserts 超過 30 筆或 deletes 超過 100 筆 → 業務錯誤 draft_batch_too_large', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const tooManyUpserts = Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, payload: '{}' }));
  const r1 = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT, upserts: tooManyUpserts, deletes: [],
  });
  assert.equal(r1.data.error, 'draft_batch_too_large');

  const tooManyDeletes = Array.from({ length: 101 }, (_, i) => `k${i}`);
  const r2 = await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT, upserts: [], deletes: tooManyDeletes,
  });
  assert.equal(r2.data.error, 'draft_batch_too_large');
});

// ── TTL：14 天自動清 ───────────────────────────────────────────────────

test('TTL：手動塞一筆 updated_at 15 天前的資料，下次呼叫後消失', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const staleIso = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO user_drafts (owner_email, draft_key, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run('a@x.com', 'stale_key', '{}', staleIso);
  // 順便塞一筆未過期的，確認 TTL 清理不會誤刪
  db.prepare('INSERT INTO user_drafts (owner_email, draft_key, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run('a@x.com', 'fresh_key', '{}', new Date().toISOString());

  const list = await handleRequest(db, testConfig(), { action: 'draftCloudList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(list.data.drafts.length, 1);
  assert.equal(list.data.drafts[0].key, 'fresh_key');
});

test('draftCloudSync 呼叫也會觸發 TTL 清理', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const staleIso = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO user_drafts (owner_email, draft_key, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run('a@x.com', 'stale_key2', '{}', staleIso);

  await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT, upserts: [], deletes: [],
  });

  const row = db.prepare('SELECT * FROM user_drafts WHERE draft_key = ?').get('stale_key2');
  assert.equal(row, undefined);
});

// ── 稽核 ────────────────────────────────────────────────────────────────

test('draftCloudSync：audit_log 不含 payload 內容/draft key，只記筆數與位元組數', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const SECRET_CONTENT = '這是諮商紀錄機密內容不該進稽核';
  const payload = JSON.stringify({ note: SECRET_CONTENT });

  await handleRequest(db, testConfig(), {
    action: 'draftCloudSync', sessionToken: tok, rootFolderId: ROOT,
    upserts: [{ key: 'scc_draft_record_a@x.com_C001_new', payload }], deletes: ['scc_draft_case_a@x.com_old'],
  });

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'draftCloudSync' ORDER BY id DESC LIMIT 1").get();
  assert.equal(auditRow.outcome, 'ok');
  assert.doesNotMatch(auditRow.detail, new RegExp(SECRET_CONTENT));
  assert.doesNotMatch(JSON.stringify(auditRow), /scc_draft_record_a@x\.com_C001_new/); // key 本身含 email，不落地
  assert.match(auditRow.detail, /upserts=1/);
  assert.match(auditRow.detail, /deletes=1/);
  assert.match(auditRow.detail, new RegExp(`bytes=${Buffer.byteLength(payload, 'utf8')}`));
});

// ── 直接呼叫 actions/drafts.js（不經 dispatch）補齊業務層細節 ─────────────

test('draftsActions.draftCloudSync：無效 key/payload 型別一律 skip，不炸例外', () => {
  const db = openDb(':memory:');
  const r = draftsActions.draftCloudSync(db, 'a@x.com', {
    upserts: [
      { key: '', payload: '{}' },
      { key: 123, payload: '{}' },
      { key: 'ok_key', payload: { not: 'a string' } },
      { key: 'ok_key2', payload: '{}' },
    ],
    deletes: [],
  });
  assert.equal(r.skipped.length, 3);
  assert.deepEqual(r.saved, ['ok_key2']);
});
