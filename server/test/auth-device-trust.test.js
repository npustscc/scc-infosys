// server/test/auth-device-trust.test.js — 信任裝置憑證（Phase 3b）純模組單元測試：
// 簽發／驗證／效期／撤銷／登出全部裝置語意／token 不可逆（DB 內無明文）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const deviceTrust = require('../src/auth/deviceTrust');

const DAY_MS = 24 * 3600 * 1000;

function freshDb() {
  return openDb(':memory:');
}

test('issueDevice → verifyDeviceToken：剛簽發的憑證立即驗證通過', () => {
  const db = freshDb();
  const { cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'test-ua');
  const ok = deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', null, 30);
  assert.equal(ok, true);
});

test('verifyDeviceToken：email 不符 → 拒絕', () => {
  const db = freshDb();
  const { cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua');
  assert.equal(deviceTrust.verifyDeviceToken(db, cookieValue, 'b@x.com', null, 30), false);
});

test('verifyDeviceToken：token 被竄改（同 id、錯 token）→ 拒絕', () => {
  const db = freshDb();
  const { id, cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua');
  const tampered = deviceTrust.buildCookieValue(id, 'wrong-token-value');
  assert.notEqual(tampered, cookieValue);
  assert.equal(deviceTrust.verifyDeviceToken(db, tampered, 'a@x.com', null, 30), false);
});

test('verifyDeviceToken：不存在的 id → 拒絕', () => {
  const db = freshDb();
  assert.equal(deviceTrust.verifyDeviceToken(db, 'no-such-id.token', 'a@x.com', null, 30), false);
});

test('verifyDeviceToken：格式錯誤的 cookie 值（無 "."）→ 拒絕（不拋例外）', () => {
  const db = freshDb();
  assert.equal(deviceTrust.verifyDeviceToken(db, 'not-a-valid-format', 'a@x.com', null, 30), false);
  assert.equal(deviceTrust.verifyDeviceToken(db, '', 'a@x.com', null, 30), false);
  assert.equal(deviceTrust.verifyDeviceToken(db, null, 'a@x.com', null, 30), false);
});

test('效期：TRUSTED_DEVICE_DAYS 內有效、超過即過期', () => {
  const db = freshDb();
  const t0 = Date.now();
  const { cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua', t0);
  // 29.9 天後仍有效
  assert.equal(
    deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', null, 30, t0 + 29.9 * DAY_MS),
    true
  );
  // 30.1 天後過期
  assert.equal(
    deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', null, 30, t0 + 30.1 * DAY_MS),
    false
  );
});

test('撤銷單台：revokeDevice 後該裝置驗證失敗，其他裝置不受影響', () => {
  const db = freshDb();
  const devA = deviceTrust.issueDevice(db, 'a@x.com', 'chrome');
  const devB = deviceTrust.issueDevice(db, 'a@x.com', 'firefox');

  const revoked = deviceTrust.revokeDevice(db, 'a@x.com', devA.id);
  assert.equal(revoked, true);

  assert.equal(deviceTrust.verifyDeviceToken(db, devA.cookieValue, 'a@x.com', null, 30), false);
  assert.equal(deviceTrust.verifyDeviceToken(db, devB.cookieValue, 'a@x.com', null, 30), true);
});

test('revokeDevice：撤銷不屬於自己的裝置 → 回 false，不影響原裝置', () => {
  const db = freshDb();
  const devA = deviceTrust.issueDevice(db, 'a@x.com', 'ua');
  const result = deviceTrust.revokeDevice(db, 'b@x.com', devA.id);
  assert.equal(result, false);
  assert.equal(deviceTrust.verifyDeviceToken(db, devA.cookieValue, 'a@x.com', null, 30), true);
});

test('revokeDevice：不存在的 deviceId → 回 false（不拋例外）', () => {
  const db = freshDb();
  assert.equal(deviceTrust.revokeDevice(db, 'a@x.com', 'no-such-id'), false);
  assert.equal(deviceTrust.revokeDevice(db, 'a@x.com', ''), false);
});

test('登出全部裝置語意：revokedBeforeSec 晚於裝置 created_at → 該裝置立即失效', () => {
  const db = freshDb();
  const t0 = Date.now();
  const { cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua', t0);
  const revokedBeforeSec = Math.floor((t0 + 1000) / 1000) + 1; // 裝置簽發之後的時間點
  assert.equal(
    deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', revokedBeforeSec, 30, t0 + 2000),
    false
  );
});

test('登出全部裝置語意：revokedBeforeSec 早於裝置 created_at（登出後才簽發的新裝置）→ 不受影響', () => {
  const db = freshDb();
  const t0 = Date.now();
  const revokedBeforeSec = Math.floor(t0 / 1000) - 100; // 舊的登出時間點
  const { cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua', t0);
  assert.equal(
    deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', revokedBeforeSec, 30, t0 + 1000),
    true
  );
});

test('listDevices：回列表且正確標記「目前這台」', () => {
  const db = freshDb();
  const devA = deviceTrust.issueDevice(db, 'a@x.com', 'chrome-ua');
  const devB = deviceTrust.issueDevice(db, 'a@x.com', 'firefox-ua');
  deviceTrust.revokeDevice(db, 'a@x.com', devB.id);

  const list = deviceTrust.listDevices(db, 'a@x.com', devA.cookieValue);
  assert.equal(list.length, 2);
  const a = list.find((d) => d.id === devA.id);
  const b = list.find((d) => d.id === devB.id);
  assert.equal(a.current, true);
  assert.equal(a.revoked, false);
  assert.equal(b.current, false);
  assert.equal(b.revoked, true);
  // 不同帳號的裝置不會出現在別人的清單
  const otherList = deviceTrust.listDevices(db, 'nobody@x.com', null);
  assert.equal(otherList.length, 0);
});

test('token 不可逆：DB 內只存雜湊，無明文 token（token_hash 與 cookie 值內的 token 段不同）', () => {
  const db = freshDb();
  const { id, cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua');
  const row = db.prepare('SELECT * FROM trusted_devices WHERE id = ?').get(id);
  const rawToken = deviceTrust.parseCookieValue(cookieValue).token;
  assert.notEqual(row.token_hash, rawToken);
  assert.equal(row.token_hash, deviceTrust.hashToken(rawToken));
  assert.equal(row.token_hash.length, 64); // sha256 hex
  // 明文 token 不應以任何子字串形式出現在雜湊值中
  assert.ok(!row.token_hash.includes(rawToken));
});

test('verifyDeviceToken 通過後會更新 last_seen_at', () => {
  const db = freshDb();
  const t0 = Date.now();
  const { id, cookieValue } = deviceTrust.issueDevice(db, 'a@x.com', 'ua', t0);
  const before = db.prepare('SELECT last_seen_at FROM trusted_devices WHERE id = ?').get(id).last_seen_at;
  deviceTrust.verifyDeviceToken(db, cookieValue, 'a@x.com', null, 30, t0 + 5000);
  const after = db.prepare('SELECT last_seen_at FROM trusted_devices WHERE id = ?').get(id).last_seen_at;
  assert.notEqual(before, after);
});
