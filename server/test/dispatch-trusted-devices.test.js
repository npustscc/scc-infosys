// server/test/dispatch-trusted-devices.test.js — Phase 3b 信任裝置制登入整合測試（:memory: db）：
// 完整生命週期（簽發→免 TOTP 登入→過期→要 TOTP→撤銷單台→其他台不受影響→sessionLogout→
// 全部要 TOTP）＋listMyDevices／revokeDevice action 授權閘。比照 test/dispatch-totp.test.js 寫法，
// 直接呼叫 handleRequest；deviceToken 在真實部署由 index.js 從 Cookie header 注入 payload
// （見 test/util-cookies.test.js 涵蓋該純函式），此處測試直接在 payload 帶 deviceToken 模擬其效果。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const totp = require('../src/auth/totp');

const ROOT = 'ROOT_DEVICE_DISPATCH_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-device',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password, userOpts) {
  await local.upsertUser(db, email, password, userOpts || {});
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

// 多使用者情境（如「A 的裝置憑證不可跨帳號用於 B」）：config.json 是單一整檔（vdrive
// resolvePathToId 對同名多檔採「取最新一筆」bug-for-bug 語意，見 test/vdrive.test.js），故第二個
// 使用者不可再呼叫 setupAuthorizedUser（會整檔覆蓋、讓第一個使用者從 users 消失）——改用
// updateJson 把新使用者併入既有 config.json。
async function addAuthorizedUser(db, email, password, userOpts) {
  await local.upsertUser(db, email, password, userOpts || {});
  const { data } = vdrive.readJson(db, 'config.json', { root: ROOT });
  data.users[email] = { role: '專任諮商心理師' };
  vdrive.updateJson(db, 'config.json', data, { root: ROOT });
}

function loginPayload(email, password, extra) {
  return Object.assign({ action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' }, extra || {});
}

// ── sessionStart：TOTP 未註冊帳號也會簽發裝置憑證（無害，見設計說明） ──

test('sessionStart：未註冊 TOTP → 仍簽發 newDeviceToken（實作單一路徑，簽發本身無害）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password'));
  assert.equal(r.success, true);
  assert.ok(r.data.sessionToken);
  assert.ok(r.data.newDeviceToken, '應附新裝置憑證供 index.js 轉 Set-Cookie');
});

// ── 完整生命週期 ──

test('信任裝置完整生命週期：簽發→免 TOTP→過期→要 TOTP→撤銷單台→其他台不受影響→登出全部→全部要 TOTP', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });

  // 1) 首次登入：無裝置憑證，已註冊 TOTP → 要求 otp
  const first = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password'));
  assert.equal(first.data.error, 'totp_required');

  // 2) 附正確 otp 登入 → 通過，簽發新裝置憑證
  const code = totp.totp(secret);
  const withOtp = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { otp: code }));
  assert.ok(withOtp.data.sessionToken);
  const deviceToken = withOtp.data.newDeviceToken;
  assert.ok(deviceToken, '首次 TOTP 通過後應簽發裝置憑證');

  // 3) 帶有效裝置憑證再次登入：免 otp 放行，且不重新簽發（沿用同一裝置）
  const trusted = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken }));
  assert.equal(trusted.success, true);
  assert.ok(trusted.data.sessionToken, '有效裝置憑證應免 TOTP 放行');
  assert.equal(trusted.data.newDeviceToken, undefined, '沿用既有裝置憑證，不應重新簽發');

  // 4) 裝置憑證過期（模擬：TRUSTED_DEVICE_DAYS 設為極小值）→ 要求 otp
  // 確保真實時間已推進（哪怕只有幾毫秒），讓「已過 0 天效期」判斷確定成立，避免同一毫秒內
  // nowMs - createdMs === 0 造成的時序巧合。
  await new Promise((resolve) => setTimeout(resolve, 5));
  const expiredCfg = testConfig({ TRUSTED_DEVICE_DAYS: 0 });
  const expired = await handleRequest(db, expiredCfg, loginPayload('a@x.com', 'right-password', { deviceToken }));
  assert.equal(expired.data.error, 'totp_required', '裝置憑證過期後應退回要求 TOTP');

  // 5) 撤銷單台：先開第二台裝置，撤銷第一台後，第一台要 TOTP、第二台不受影響
  const second = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { otp: totp.totp(secret) }));
  const deviceToken2 = second.data.newDeviceToken;
  assert.ok(deviceToken2);
  assert.notEqual(deviceToken2, deviceToken);

  const list1 = await handleRequest(db, testConfig(), {
    action: 'listMyDevices', sessionToken: withOtp.data.sessionToken, rootFolderId: ROOT, deviceToken,
  });
  assert.equal(list1.success, true);
  assert.equal(list1.data.devices.length, 2);
  const dev1Id = list1.data.devices.find((d) => d.current).id;

  const revokeR = await handleRequest(db, testConfig(), {
    action: 'revokeDevice', sessionToken: withOtp.data.sessionToken, rootFolderId: ROOT, deviceId: dev1Id,
  });
  assert.equal(revokeR.data.ok, true);

  const afterRevokeDev1 = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken }));
  assert.equal(afterRevokeDev1.data.error, 'totp_required', '第一台裝置撤銷後應要求 TOTP');

  const afterRevokeDev2 = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken: deviceToken2 }));
  assert.ok(afterRevokeDev2.data.sessionToken, '第二台裝置不受影響，仍應免 TOTP 放行');

  // 6) 登出全部裝置（sessionLogout）→ 連未撤銷的裝置（第二台）也要求 TOTP
  const logoutR = await handleRequest(db, testConfig(), {
    action: 'sessionLogout', sessionToken: afterRevokeDev2.data.sessionToken, rootFolderId: ROOT,
  });
  assert.equal(logoutR.data.ok, true);

  // 註銷判定為 created_at < revoked_before（比照 auth/session.js 的 iat < revoked_before 語意，
  // 見 test/dispatch.test.js「sessionLogout 後，舊 token 立即失效」同一段註解）：若簽發/登出發生在
  // 同一秒，revoked_before 與 created_at 可能相等而不觸發。測試環境執行速度快，兩者常落在同一秒，
  // 故此處直接把 revoked_before 撥到裝置 created_at 之後，明確驗證「一旦 revoked_before 晚於
  // created_at，舊裝置憑證即失效」這條核心規則，避免測試被時間粒度誤判為假陽性。
  const sessionAuth = require('../src/auth/session');
  sessionAuth.revokeAllDevices(db, 'a@x.com', Date.now() + 1500);

  const afterLogoutDev2 = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken: deviceToken2 }));
  assert.equal(afterLogoutDev2.data.error, 'totp_required', '登出全部裝置後，既有裝置憑證應全部失效');
});

test('信任裝置：帶錯誤/竄改的裝置憑證 → 視同無裝置憑證，退回要求 TOTP（不拋例外）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken: 'garbage.value' }));
  assert.equal(r.data.error, 'totp_required');
});

test('信任裝置：另一帳號的裝置憑證不可跨帳號使用', async () => {
  const db = openDb(':memory:');
  const secretA = totp.generateSecret();
  const secretB = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secretA });
  await addAuthorizedUser(db, 'b@x.com', 'right-password', { totpSecret: secretB });

  const loginA = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { otp: totp.totp(secretA) }));
  const deviceTokenA = loginA.data.newDeviceToken;

  const loginBWithADevice = await handleRequest(db, testConfig(), loginPayload('b@x.com', 'right-password', { deviceToken: deviceTokenA }));
  assert.equal(loginBWithADevice.data.error, 'totp_required', 'A 的裝置憑證不應對 B 帳號生效');
});

// ── listMyDevices／revokeDevice：一般授權閘（未登入 → Session expired；只能操作自己的裝置） ──

test('listMyDevices／revokeDevice：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r1 = await handleRequest(db, testConfig(), { action: 'listMyDevices', rootFolderId: ROOT });
  assert.equal(r1.data.error, 'Session expired');
  const r2 = await handleRequest(db, testConfig(), { action: 'revokeDevice', rootFolderId: ROOT, deviceId: 'x' });
  assert.equal(r2.data.error, 'Session expired');
});

test('revokeDevice：不能撤銷別人的裝置（回 ok:false，且該裝置仍可正常免 TOTP 登入）', async () => {
  const db = openDb(':memory:');
  const secretA = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secretA });
  await addAuthorizedUser(db, 'b@x.com', 'right-password');

  const loginA = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { otp: totp.totp(secretA) }));
  const deviceTokenA = loginA.data.newDeviceToken;
  const list = await handleRequest(db, testConfig(), {
    action: 'listMyDevices', sessionToken: loginA.data.sessionToken, rootFolderId: ROOT, deviceToken: deviceTokenA,
  });
  const devAId = list.data.devices[0].id;

  const loginB = await handleRequest(db, testConfig(), loginPayload('b@x.com', 'right-password'));
  const revokeAttempt = await handleRequest(db, testConfig(), {
    action: 'revokeDevice', sessionToken: loginB.data.sessionToken, rootFolderId: ROOT, deviceId: devAId,
  });
  assert.equal(revokeAttempt.data.ok, false);

  const stillWorks = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken: deviceTokenA }));
  assert.ok(stillWorks.data.sessionToken, 'B 撤銷失敗不應影響 A 的裝置憑證');
});

test('listMyDevices：帳密登入失敗鎖定計數——裝置信任放行後 failed_attempts 會重置（比照一般成功登入）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const login1 = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { otp: totp.totp(secret) }));
  const deviceToken = login1.data.newDeviceToken;

  // 先製造一次密碼錯誤（增加 failed_attempts），再用裝置信任登入應重置。
  await handleRequest(db, testConfig(), loginPayload('a@x.com', 'wrong-password'));
  const userRow = local.getUser(db, 'a@x.com');
  assert.equal(userRow.failed_attempts, 1);

  await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', { deviceToken }));
  const userRowAfter = local.getUser(db, 'a@x.com');
  assert.equal(userRowAfter.failed_attempts, 0);
});
