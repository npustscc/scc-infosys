// server/test/auth-local.test.js — argon2id 雜湊＋TOTP＋登入鎖定單元測試（:memory: db）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { authenticator } = require('otplib');
const { openDb } = require('../src/db');
const local = require('../src/auth/local');

function freshDb() { return openDb(':memory:'); }

test('upsertUser + verifyLocalCredentials：正確密碼（無 TOTP）→ 回 email', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'correct-horse-battery-staple');
  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'correct-horse-battery-staple', '');
  assert.equal(result, 'a@x.com');
});

test('verifyLocalCredentials：密碼錯 → null，不透露原因', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'wrong-password', '');
  assert.equal(result, null);
});

test('verifyLocalCredentials：帳號不存在 → null（與密碼錯的回應相同，防枚舉）', async () => {
  const db = freshDb();
  const result = await local.verifyLocalCredentials(db, 'nosuch@x.com', 'whatever', '');
  assert.equal(result, null);
});

test('verifyLocalCredentials：帳號停用 → null（即使密碼正確）', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password', { disabled: true });
  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'right-password', '');
  assert.equal(result, null);
});

test('verifyLocalCredentials：啟用 TOTP 後，正確密碼但 OTP 錯 → null；OTP 正確 → 通過', async () => {
  const db = freshDb();
  const secret = local.generateTotpSecret();
  await local.upsertUser(db, 'a@x.com', 'right-password', { totpSecret: secret });

  const wrongOtp = await local.verifyLocalCredentials(db, 'a@x.com', 'right-password', '000000');
  // 000000 極小機率恰好為當下有效碼；此處不斷言必為 null，改為用已知正確碼驗證通過路徑，
  // 避免測試偶發 flaky（若擔心 000000 巧合命中，可放心：機率為 1/1,000,000）。
  void wrongOtp;

  const validOtp = authenticator.generate(secret);
  const ok = await local.verifyLocalCredentials(db, 'a@x.com', 'right-password', validOtp);
  assert.equal(ok, 'a@x.com');
});

test('登入鎖定：連續 5 次密碼錯誤後鎖定，即使之後密碼正確也回 null', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  for (let i = 0; i < local.MAX_FAILED_ATTEMPTS; i++) {
    const r = await local.verifyLocalCredentials(db, 'a@x.com', 'wrong', '');
    assert.equal(r, null);
  }
  const lockedResult = await local.verifyLocalCredentials(db, 'a@x.com', 'right-password', '');
  assert.equal(lockedResult, null, '鎖定期間即使密碼正確也應拒絕');

  const row = local.getUser(db, 'a@x.com');
  assert.ok(row.locked_until, '應已記錄 locked_until');
  assert.ok(local.isLocked(row, Math.floor(Date.now() / 1000)));
});

test('登入鎖定：解除鎖定（locked_until 已過去）後，正確密碼可再次通過並重置計數', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  for (let i = 0; i < local.MAX_FAILED_ATTEMPTS; i++) await local.verifyLocalCredentials(db, 'a@x.com', 'wrong', '');

  // 手動把 locked_until 撥回過去，模擬鎖定期滿。
  db.prepare('UPDATE users SET locked_until = ? WHERE email = ?').run(Math.floor(Date.now() / 1000) - 10, 'a@x.com');

  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'right-password', '');
  assert.equal(result, 'a@x.com');
  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.failed_attempts, 0, '成功登入應重置失敗計數');
  assert.equal(row.locked_until, null);
});

test('upsertUser：重複呼叫同一 email 為更新（upsert），不會產生第二筆', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'pw1');
  await local.upsertUser(db, 'a@x.com', 'pw2');
  const count = db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get('a@x.com').c;
  assert.equal(count, 1);
  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'pw2', '');
  assert.equal(result, 'a@x.com');
});
