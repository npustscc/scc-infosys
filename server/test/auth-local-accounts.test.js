// server/test/auth-local-accounts.test.js — 帳號發放與管理（migration 005）單元測試：
// getUserByLogin（登入帳號別名層、大小寫不敏感）＋validateNewPassword（新密碼政策）＋
// upsertUser 的 login_name/must_change_password backfill 語意。整合測試（sessionStart 首登
// 強制改密碼全流程／admin 五個 action）見 test/dispatch-password-change.test.js／
// test/dispatch-admin-users.test.js。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const local = require('../src/auth/local');

function freshDb() { return openDb(':memory:'); }

test('upsertUser：不傳 loginName 時預設 login_name=lower(email)（backfill 語意，既有呼叫端不用改）', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'A@X.com', 'right-password');
  const row = local.getUser(db, 'A@X.com');
  assert.equal(row.login_name, 'a@x.com');
  assert.equal(row.must_change_password, 0);
});

test('getUserByLogin：大小寫不敏感——存小寫、查小寫皆可命中同一筆', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  assert.equal(local.getUserByLogin(db, 'a@x.com').email, 'a@x.com');
  assert.equal(local.getUserByLogin(db, 'A@X.COM').email, 'a@x.com');
  assert.equal(local.getUserByLogin(db, '  a@x.com  ').email, 'a@x.com', '前後空白應被 trim');
});

test('getUserByLogin：查無 → null，不 fallback 以 email 欄位再查一次', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password', { loginName: 'staff01' });
  // 'a@x.com' 是內部 email，但 login_name 已改成 'staff01'——用 email 字串當登入帳號查應查無。
  assert.equal(local.getUserByLogin(db, 'a@x.com'), null);
  assert.equal(local.getUserByLogin(db, 'staff01').email, 'a@x.com');
});

test('upsertUser：可指定 loginName（與 email 脫鉤，供實習生/兼任自訂登入帳號情境）＋mustChangePassword', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'intern1@x.com', 'right-password', { loginName: 'Intern01', mustChangePassword: true });
  const row = local.getUser(db, 'intern1@x.com');
  assert.equal(row.login_name, 'intern01', 'login_name 應存小寫');
  assert.equal(row.must_change_password, 1);
});

test('validateNewPassword：長度 <8 → too_short', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  const user = local.getUser(db, 'a@x.com');
  const r = await local.validateNewPassword('short7x', user);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_short');
});

test('validateNewPassword：等於預設初始密碼 123456789 → same_as_default', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  const user = local.getUser(db, 'a@x.com');
  const r = await local.validateNewPassword('123456789', user);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'same_as_default');
});

test('validateNewPassword：與目前密碼相同 → same_as_old', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  const user = local.getUser(db, 'a@x.com');
  const r = await local.validateNewPassword('right-password', user);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'same_as_old');
});

test('validateNewPassword：符合規則的新密碼 → ok:true', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'right-password');
  const user = local.getUser(db, 'a@x.com');
  const r = await local.validateNewPassword('brand-new-pw-2026', user);
  assert.equal(r.ok, true);
});

test('verifyLocalCredentials（精簡版）：既有呼叫端傳 email 當第一參數，backfill 後行為不變', async () => {
  const db = freshDb();
  await local.upsertUser(db, 'a@x.com', 'correct-horse-battery-staple');
  const result = await local.verifyLocalCredentials(db, 'a@x.com', 'correct-horse-battery-staple', '');
  assert.equal(result, 'a@x.com');
});

test('verifyLocalCredentialsDetailed：loginName 不存在 → invalid_credentials（不洩漏帳號是否存在）', async () => {
  const db = freshDb();
  const r = await local.verifyLocalCredentialsDetailed(db, 'nosuch-login', 'whatever', '', '', false, undefined, undefined);
  assert.equal(r.kind, 'invalid_credentials');
});
