// server/test/dispatch-office-decrypt.test.js — dispatch.js 對 decryptOfficeFile action 的接線／
// 授權閘／業務錯誤碼／稽核紀錄 smoke test。比照 test/dispatch-sms.test.js 寫法：直接呼叫
// handleRequest，:memory: db，不打真實網路（officecrypto-tool 純本機運算，本就不需要 mock）。
//
// fixture：test/fixtures/office-encrypted-xlsx.b64（pw.xlsx，密碼 1234，Agile 加密）／
// office-encrypted-xls.b64（pw.xls，密碼 1234，新版 Excel 存的 CryptoAPI RC4 加密）／
// office-plain-xls.b64（plain.xls，未加密）——內容皆假資料（學號 B2/B3 開頭測試值），以文字 base64
// 存放（不把 .xls/.xlsx 二進位檔入 repo，見 CLAUDE.md 資安原則 2）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_OFFICE_DECRYPT_TEST';

function readFixtureB64(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8').trim();
}

const ENCRYPTED_XLSX_B64 = readFixtureB64('office-encrypted-xlsx.b64');
const ENCRYPTED_XLS_B64 = readFixtureB64('office-encrypted-xls.b64');
const PLAIN_XLS_B64 = readFixtureB64('office-plain-xls.b64');

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-office-decrypt',
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

test('decryptOfficeFile：未帶 sessionToken → Session expired（一般授權閘生效，非 AUTHZ_EXEMPT）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', rootFolderId: ROOT, dataBase64: ENCRYPTED_XLSX_B64, probe: true,
  });
  assert.equal(r.data.error, 'Session expired');
});

test('decryptOfficeFile：已登入但不在 config.users → Unauthorized user', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'nobody@x.com', 'right-password', {});
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: {} } });
  const login1 = await login(db, testConfig(), 'nobody@x.com', 'right-password');
  assert.equal(login1.data.error, 'Unauthorized user');
});

// ── probe ───────────────────────────────────────────────────────────────

test('decryptOfficeFile：probe 加密的 xlsx → encrypted:true', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, probe: true,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, true);
  assert.equal(r.data.dataBase64, undefined); // probe 模式不回檔案內容
});

test('decryptOfficeFile：probe 加密的 xls（CryptoAPI RC4）→ encrypted:true', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLS_B64, probe: true,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, true);
});

test('decryptOfficeFile：probe 明文 .xls → encrypted:false', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: PLAIN_XLS_B64, probe: true,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, false);
});

// ── 一般模式：解密 ──────────────────────────────────────────────────────

test('decryptOfficeFile：正確密碼解密 xlsx（Agile）→ 回傳 base64 解開後為 ZIP（PK magic）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, password: '1234',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, true);
  assert.ok(typeof r.data.dataBase64 === 'string' && r.data.dataBase64.length > 0);
  const decoded = Buffer.from(r.data.dataBase64, 'base64');
  assert.deepEqual(decoded.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04])); // 'PK\x03\x04' ZIP magic
});

test('decryptOfficeFile：正確密碼解密 xls（CryptoAPI RC4）→ 回傳 base64 解開後為 CFB（D0CF11E0 magic）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLS_B64, password: '1234',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, true);
  const decoded = Buffer.from(r.data.dataBase64, 'base64');
  assert.deepEqual(decoded.subarray(0, 4), Buffer.from([0xd0, 0xcf, 0x11, 0xe0])); // CFB magic
});

test('decryptOfficeFile：未加密檔案（非 probe）→ encrypted:false，不回傳內容', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: PLAIN_XLS_B64, password: 'irrelevant',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.encrypted, false);
  assert.equal(r.data.dataBase64, undefined);
});

test('decryptOfficeFile：錯誤密碼 → wrong_password', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, password: 'wrong-password',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'wrong_password');
});

test('decryptOfficeFile：加密檔缺 password（非 probe）→ invalid_params', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'invalid_params');
});

test('decryptOfficeFile：超過 20MB → file_too_large', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const bigBuf = Buffer.alloc(21 * 1024 * 1024, 0x41); // 21MB，超過 MAX_ATTACHMENT_BYTES(20MB)
  const r = await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: bigBuf.toString('base64'), probe: true,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'file_too_large');
});

// ── 稽核 ────────────────────────────────────────────────────────────────

test('decryptOfficeFile：audit_log 不含密碼字串，只記大小與結果分類', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const SECRET_PW = 'my-super-secret-pw-1234';

  // 1) 密碼錯誤（用一個獨特的假密碼字串，確認完全不出現在 audit_log 任何欄位）
  await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, password: SECRET_PW,
  });
  let auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'decryptOfficeFile' ORDER BY id DESC LIMIT 1").get();
  assert.equal(auditRow.outcome, 'ok'); // 業務錯誤（wrong_password）走 dispatch 正常回傳路徑，非例外
  assert.doesNotMatch(JSON.stringify(auditRow), new RegExp(SECRET_PW));
  assert.match(auditRow.detail, /office_outcome=wrong_password/);
  assert.doesNotMatch(auditRow.detail, /\bpassword_len=/); // password 在 CONFIDENTIAL_KEYS，連長度都不記

  // 2) probe 成功（加密）
  await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, probe: true,
  });
  auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'decryptOfficeFile' ORDER BY id DESC LIMIT 1").get();
  assert.match(auditRow.detail, /office_outcome=probe_encrypted/);
  assert.match(auditRow.detail, /dataBase64_len=\d+/); // 只記長度，不含檔案內容本身

  // 3) 正確密碼解密成功
  await handleRequest(db, testConfig(), {
    action: 'decryptOfficeFile', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    dataBase64: ENCRYPTED_XLSX_B64, password: '1234',
  });
  auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'decryptOfficeFile' ORDER BY id DESC LIMIT 1").get();
  assert.match(auditRow.detail, /office_outcome=decrypted/);
  assert.doesNotMatch(auditRow.detail, /1234/); // 密碼本身不落地
});
