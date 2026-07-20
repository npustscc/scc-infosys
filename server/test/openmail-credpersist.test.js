// server/test/openmail-credpersist.test.js — v235 信箱「記住密碼（自動登入）」opt-in 加密落地：
// encrypt/decrypt roundtrip、AAD 綁定 owner、壞資料 fail-closed、save/hydrate 對 credStore 的
// 回填行為，以及 dispatch omConnect/omDisconnect 的 rememberMe 資料層效果。
//
// 資安要求：本檔不得觸網（比照 openmail.test.js／openmail-archive.test.js 既有慣例）；credStore
// 為 process 全域單例，每個測試前後都要 clear() 相關 email，避免測試互相汙染。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const credStore = require('../src/openmail/credStore');
const credPersist = require('../src/openmail/credPersist');
const client = require('../src/openmail/client');

const TEST_KEY = crypto.randomBytes(32); // 32-byte Buffer，等同 64 hex chars 的 OPENMAIL_CRED_KEY
const TEST_KEY_HEX = TEST_KEY.toString('hex');

// ── keyFromConfig ────────────────────────────────────────────────────────

test('keyFromConfig：合法 64 hex chars → 32-byte Buffer', () => {
  const key = credPersist.keyFromConfig({ OPENMAIL_CRED_KEY: TEST_KEY_HEX });
  assert.ok(Buffer.isBuffer(key));
  assert.equal(key.length, 32);
});

test('keyFromConfig：未設定／空字串／格式錯誤（非 64 hex）一律回 null（fail-closed）', () => {
  assert.equal(credPersist.keyFromConfig({}), null);
  assert.equal(credPersist.keyFromConfig({ OPENMAIL_CRED_KEY: '' }), null);
  assert.equal(credPersist.keyFromConfig({ OPENMAIL_CRED_KEY: 'not-hex-and-wrong-length' }), null);
  assert.equal(credPersist.keyFromConfig({ OPENMAIL_CRED_KEY: 'ab'.repeat(31) }), null); // 62 chars，差 2
  assert.equal(credPersist.keyFromConfig({ OPENMAIL_CRED_KEY: 'zz'.repeat(32) }), null); // 64 字但非 hex
});

// ── encryptCreds / decryptCreds ──────────────────────────────────────────

test('encryptCreds/decryptCreds：roundtrip 還原 mailUser/mailPass', () => {
  const enc = credPersist.encryptCreds(TEST_KEY, 'a@x.com', 'a', 'super-secret-pass');
  assert.equal(typeof enc, 'string');
  assert.equal(enc.split('.').length, 3); // base64(iv).base64(tag).base64(ct)
  const out = credPersist.decryptCreds(TEST_KEY, 'a@x.com', enc);
  assert.deepEqual(out, { mailUser: 'a', mailPass: 'super-secret-pass' });
});

test('decryptCreds：密文本身不含明文密碼字串（確認真的有加密，不是原樣存）', () => {
  const enc = credPersist.encryptCreds(TEST_KEY, 'a@x.com', 'a', 'THE-PLAINTEXT-MARKER-abc123');
  assert.doesNotMatch(enc, /THE-PLAINTEXT-MARKER-abc123/);
});

test('decryptCreds：錯誤金鑰 → null（不 throw）', () => {
  const enc = credPersist.encryptCreds(TEST_KEY, 'a@x.com', 'a', 'secret');
  const wrongKey = crypto.randomBytes(32);
  assert.equal(credPersist.decryptCreds(wrongKey, 'a@x.com', enc), null);
});

test('decryptCreds：AAD 換人（用別人的 email 解自己的密文）→ null（不 throw）', () => {
  const enc = credPersist.encryptCreds(TEST_KEY, 'owner-a@x.com', 'a', 'secret');
  assert.equal(credPersist.decryptCreds(TEST_KEY, 'owner-b@x.com', enc), null);
});

test('decryptCreds：格式亂碼 → null（不 throw）', () => {
  assert.equal(credPersist.decryptCreds(TEST_KEY, 'a@x.com', 'not-even-three-parts'), null);
  assert.equal(credPersist.decryptCreds(TEST_KEY, 'a@x.com', 'a.b.c'), null); // 三段但非合法 base64/長度
  assert.equal(credPersist.decryptCreds(TEST_KEY, 'a@x.com', ''), null);
  assert.equal(credPersist.decryptCreds(TEST_KEY, 'a@x.com', null), null);
});

// ── save / remove / hasSaved / hydrate（sqlite 資料層） ──────────────────

test('save→hasSaved→hydrate：成功回填 credStore，記憶體已有值時 credStore.get 反映新值', () => {
  const db = openDb(':memory:');
  const email = 'hydrate-ok@x.com';
  credStore.clear(email);
  try {
    assert.equal(credPersist.hasSaved(db, email), false);
    credPersist.save(db, TEST_KEY, email, 'hydrate-ok', 'pw-1');
    assert.equal(credPersist.hasSaved(db, email), true);

    const hydrated = credPersist.hydrate(db, TEST_KEY, email);
    assert.equal(hydrated, true);
    const cached = credStore.get(email);
    assert.equal(cached.mailUser, 'hydrate-ok');
    assert.equal(cached.mailPass, 'pw-1');
  } finally {
    credStore.clear(email);
  }
});

test('hydrate：credStore 已有值時不動作（直接回 false，不查 db 覆蓋既有記憶體值）', () => {
  const db = openDb(':memory:');
  const email = 'hydrate-noop@x.com';
  credStore.clear(email);
  try {
    credPersist.save(db, TEST_KEY, email, 'saved-user', 'saved-pass');
    credStore.set(email, 'live-user', 'live-pass'); // 記憶體已有「當下連線」的值
    const hydrated = credPersist.hydrate(db, TEST_KEY, email);
    assert.equal(hydrated, false);
    const cached = credStore.get(email);
    assert.equal(cached.mailUser, 'live-user'); // 未被落地資料覆蓋
    assert.equal(cached.mailPass, 'live-pass');
  } finally {
    credStore.clear(email);
  }
});

test('hydrate：key 為 null（金鑰未設定）→ 不查 db、回 false', () => {
  const db = openDb(':memory:');
  const email = 'hydrate-nokey@x.com';
  credStore.clear(email);
  try {
    credPersist.save(db, TEST_KEY, email, 'u', 'p'); // 先假設有金鑰時存過一筆
    const hydrated = credPersist.hydrate(db, null, email);
    assert.equal(hydrated, false);
    assert.equal(credStore.get(email), null); // 未被回填
  } finally {
    credStore.clear(email);
  }
});

test('hydrate：無落地資料（從未 save）→ 回 false', () => {
  const db = openDb(':memory:');
  const email = 'hydrate-none@x.com';
  credStore.clear(email);
  const hydrated = credPersist.hydrate(db, TEST_KEY, email);
  assert.equal(hydrated, false);
  assert.equal(credStore.get(email), null);
});

test('hydrate：壞密文（金鑰已換／密文損毀）→ 解不開，該列被刪除，回 false（fail-closed，不留壞資料）', () => {
  const db = openDb(':memory:');
  const email = 'hydrate-corrupt@x.com';
  credStore.clear(email);
  credPersist.save(db, TEST_KEY, email, 'u', 'p');
  assert.equal(credPersist.hasSaved(db, email), true);

  const wrongKey = crypto.randomBytes(32);
  const hydrated = credPersist.hydrate(db, wrongKey, email);
  assert.equal(hydrated, false);
  assert.equal(credStore.get(email), null);
  assert.equal(credPersist.hasSaved(db, email), false); // 壞列已被刪除
});

test('save：重複 save（UPSERT）覆蓋舊密文，不留重複列', () => {
  const db = openDb(':memory:');
  const email = 'upsert-test@x.com';
  credPersist.save(db, TEST_KEY, email, 'u1', 'p1');
  credPersist.save(db, TEST_KEY, email, 'u2', 'p2');
  const rows = db.prepare('SELECT COUNT(*) AS c FROM openmail_saved_creds WHERE owner_email = ?').get(email);
  assert.equal(rows.c, 1);
  const creds = credPersist.decryptCreds(TEST_KEY, email, db.prepare('SELECT enc FROM openmail_saved_creds WHERE owner_email = ?').get(email).enc);
  assert.deepEqual(creds, { mailUser: 'u2', mailPass: 'p2' });
});

test('remove：刪除後 hasSaved 回 false，hydrate 亦回 false', () => {
  const db = openDb(':memory:');
  const email = 'remove-test@x.com';
  credPersist.save(db, TEST_KEY, email, 'u', 'p');
  assert.equal(credPersist.hasSaved(db, email), true);
  credPersist.remove(db, email);
  assert.equal(credPersist.hasSaved(db, email), false);
  credStore.clear(email);
  assert.equal(credPersist.hydrate(db, TEST_KEY, email), false);
});

// ── dispatch 整合：omConnect rememberMe 資料層效果 ───────────────────────

const ROOT = 'ROOT_OPENMAIL_CREDPERSIST_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-openmail-credpersist',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    OPENMAIL_CRED_KEY: TEST_KEY_HEX,
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

test('omConnect：rememberMe:true 且金鑰可用 → 落地儲存，回傳 remembered:true', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const email = 'remember-on@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.clear(email);
  credPersist.remove(db, email);

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: true });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'remember-on', mailPass: 'pw', rememberMe: true,
    });
    assert.deepEqual(r.data, { ok: true, mailUser: 'remember-on', remembered: true });
    assert.equal(credPersist.hasSaved(db, email), true);
  } finally {
    client.verifyLogin = orig;
    credStore.clear(email);
    credPersist.remove(db, email);
  }
});

test('omConnect：rememberMe falsy（未帶／false）→ 不落地儲存（並會 remove 掉舊的），回傳 remembered:false', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const email = 'remember-off@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.clear(email);
  credPersist.save(db, TEST_KEY, email, 'old-user', 'old-pass'); // 模擬先前勾過一次

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: true });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'remember-off', mailPass: 'pw',
    });
    assert.deepEqual(r.data, { ok: true, mailUser: 'remember-off', remembered: false });
    assert.equal(credPersist.hasSaved(db, email), false); // 不勾＝忘記舊的
  } finally {
    client.verifyLogin = orig;
    credStore.clear(email);
    credPersist.remove(db, email);
  }
});

test('omConnect：rememberMe:true 但伺服器未設定金鑰 → 不落地，回傳 remembered:false', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig({ OPENMAIL_CRED_KEY: '' }); // 金鑰未設定＝功能關閉
  const email = 'remember-nokey@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.clear(email);

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: true });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'remember-nokey', mailPass: 'pw', rememberMe: true,
    });
    assert.deepEqual(r.data, { ok: true, mailUser: 'remember-nokey', remembered: false });
    assert.equal(credPersist.hasSaved(db, email), false);
  } finally {
    client.verifyLogin = orig;
    credStore.clear(email);
  }
});

test('omDisconnect：中斷連結會刪除已落地的「記住密碼」資料（完整忘記）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const email = 'disconnect-test@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.set(email, 'u', 'p');
  credPersist.save(db, TEST_KEY, email, 'u', 'p');
  assert.equal(credPersist.hasSaved(db, email), true);

  const r = await handleRequest(db, cfg, { action: 'omDisconnect', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(r.data.ok, true);
  assert.equal(credStore.get(email), null);
  assert.equal(credPersist.hasSaved(db, email), false);
});

test('sessionLogout：登出不刪除已落地的「記住密碼」資料（只清記憶體，保留落地供下次自動登入）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const email = 'logout-keeps-saved@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.set(email, 'u', 'p');
  credPersist.save(db, TEST_KEY, email, 'u', 'p');

  const r = await handleRequest(db, cfg, { action: 'sessionLogout', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(r.data.ok, true);
  assert.equal(credStore.get(email), null); // 記憶體已清
  assert.equal(credPersist.hasSaved(db, email), true); // 落地資料仍在，供下次登入 hydrate

  credPersist.remove(db, email); // 測後清理
});

test('dispatch hydrate：om* 呼叫前自動從落地資料回填 credStore（重啟情境模擬——記憶體無值但 sqlite 有）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const email = 'auto-hydrate@x.com';
  await setupAuthorizedUser(db, email, 'right-password');
  const tok = (await login(db, cfg, email, 'right-password')).data.sessionToken;
  credStore.clear(email); // 模擬伺服器重啟後記憶體是空的
  credPersist.save(db, TEST_KEY, email, 'auto-hydrated-user', 'auto-hydrated-pass');

  try {
    const status = await handleRequest(db, cfg, { action: 'omStatus', sessionToken: tok, rootFolderId: ROOT });
    assert.deepEqual(status.data, { connected: true, mailUser: 'auto-hydrated-user' });
    const cached = credStore.get(email);
    assert.equal(cached.mailPass, 'auto-hydrated-pass');
  } finally {
    credStore.clear(email);
    credPersist.remove(db, email);
  }
});

test('omReachable：rememberAvailable 反映伺服器是否設定加密金鑰（monkey-patch client.probeReachable，不觸網）', async () => {
  const origProbe = client.probeReachable;
  client.probeReachable = async () => true; // 比照本檔「不得觸網」慣例，不真的打 mail.npust.edu.tw
  try {
    const dbA = openDb(':memory:');
    const cfgWithKey = testConfig();
    const email = 'reach-with-key@x.com';
    await setupAuthorizedUser(dbA, email, 'right-password');
    const tokA = (await login(dbA, cfgWithKey, email, 'right-password')).data.sessionToken;
    const rA = await handleRequest(dbA, cfgWithKey, { action: 'omReachable', sessionToken: tokA, rootFolderId: ROOT });
    assert.equal(rA.data.rememberAvailable, true);

    const dbB = openDb(':memory:');
    const cfgNoKey = testConfig({ OPENMAIL_CRED_KEY: '' });
    await setupAuthorizedUser(dbB, email, 'right-password');
    const tokB = (await login(dbB, cfgNoKey, email, 'right-password')).data.sessionToken;
    const rB = await handleRequest(dbB, cfgNoKey, { action: 'omReachable', sessionToken: tokB, rootFolderId: ROOT });
    assert.equal(rB.data.rememberAvailable, false);
  } finally {
    client.probeReachable = origProbe;
  }
});
