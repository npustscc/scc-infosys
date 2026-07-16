// server/test/dispatch-email-otp.test.js — Email 驗證碼後備第二因素（migration 004）整合測試
// （:memory: db）：全生命週期（寄出→正確碼通過→發裝置 cookie／錯誤碼累計→鎖定／過期拒絕／
// 單次有效／60 秒防重寄不重寄）＋switchToEmailOtp 登入中途切換方法。
// monkey-patch src/google/gmail.js 的 gmailFetch＋src/google/auth.js 的 tokenFromRefresh，
// 比照 test/dispatch-mail-integration.test.js 的 withSendCapture 寫法（不打真實網路）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const gmail = require('../src/google/gmail');
const googleAuth = require('../src/google/auth');

const ROOT = 'ROOT_EMAIL_OTP_TEST';

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-emailotp-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function decodeRaw(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}
function extractSubject(rawDecoded) {
  const m = rawDecoded.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
}
function extractTo(rawDecoded) {
  const m = rawDecoded.match(/^To: (.+)\r\n/);
  return m ? m[1] : null;
}
function extractBodyText(rawDecoded) {
  const bodyB64 = rawDecoded.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  return Buffer.from(bodyB64, 'base64').toString('utf8');
}

// 攔截所有 /messages/send 呼叫，記錄每次的 to/subject/body（解碼後）；其餘 gmailFetch 呼叫視為未預期。
function withSendCapture(fn) {
  const sent = [];
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = async (_accessToken, p, opts) => {
    if (p === '/messages/send') {
      const decoded = decodeRaw(opts.body.raw);
      sent.push({ to: extractTo(decoded), subject: extractSubject(decoded), body: extractBodyText(decoded) });
      return { id: 'msg_' + sent.length };
    }
    throw new Error('unexpected gmailFetch path in test: ' + p);
  };
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(() => fn(sent))
    .finally(() => {
      gmail.gmailFetch = origGmailFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-email-otp',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    GC_CALENDAR_NAME: '[DEV] SCC 空間預約',
    MAIL_SEND_CREDS: tmpCredsFile(),
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupEmailOtpUser(db, email, password) {
  await local.upsertUser(db, email, password);
  db.prepare("UPDATE users SET twofa_method = 'email' WHERE email = ?").run(email);
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

// 尚未設定任何第二因素的一般授權使用者（比照 test/dispatch-twofa.test.js 的同名 helper）——
// 供「先登入拿 session 再用 twofaSetMethod 設定 otp_emails」這類測試使用。
async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

function loginPayload(email, password, extra) {
  return Object.assign({ action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' }, extra || {});
}

function extractCode(body) {
  const m = body.match(/您的登入驗證碼為：(\d{6})/);
  assert.ok(m, '信件內文應含 6 位數驗證碼：' + body);
  return m[1];
}

// 成功登入（kind:'ok'）會另外觸發既有 v166 登入通知信（見 actions/session.js 的 loginNotify 段，
// 與本次 email OTP 功能無關、本測試檔之前既有覆蓋於 test/dispatch-mail-integration.test.js）——
// 兩種信件都會被 withSendCapture 攔截到同一個 sent 陣列，驗證「OTP 有沒有重寄」時需以主旨篩選，
// 排除登入通知信的干擾，只算 OTP 驗證碼信本身的封數。
function otpMailsOnly(sent) {
  return sent.filter((m) => (m.subject || '').includes('登入驗證碼'));
}

// ══════════════════════════════════════════════════════════════════════════
// 全生命週期
// ══════════════════════════════════════════════════════════════════════════

test('email OTP：寄出→正確碼通過→發裝置 cookie，主旨含【測試版】前綴，收件人為登入者本人', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    const first = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(first.data.error, 'email_otp_sent');
    assert.equal(first.data.resent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'a@x.com');
    assert.match(sent[0].subject, /^【測試版】【屏科大學諮資訊系統】登入驗證碼$/);

    const code = extractCode(sent[0].body);
    const ok = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.equal(ok.success, true);
    assert.ok(ok.data.sessionToken, '驗證碼正確應核發 session');
    assert.ok(ok.data.newDeviceToken, '首次通過第二因素應簽發裝置憑證');

    // 裝置憑證可用於下次免第二因素登入（沿用既有信任裝置機制，非本次新開一套）。
    const trusted = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { deviceToken: ok.data.newDeviceToken }));
    assert.ok(trusted.data.sessionToken, '有效裝置憑證應免第二因素放行');
    assert.equal(otpMailsOnly(sent).length, 1, '裝置信任放行不應再寄 OTP 信（可能仍有既有登入通知信，與本次功能無關）');
  });
});

test('email OTP：錯誤碼 → invalid_email_otp，email_otp_attempts 累計', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    void sent;
    const wrong1 = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: '000000' }));
    assert.equal(wrong1.data.error, 'invalid_email_otp');
    let row = local.getUser(db, 'a@x.com');
    assert.equal(row.email_otp_attempts, 1);

    const wrong2 = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: '111111' }));
    assert.equal(wrong2.data.error, 'invalid_email_otp');
    row = local.getUser(db, 'a@x.com');
    assert.equal(row.email_otp_attempts, 2);
  });
});

test('email OTP：5 次錯誤 → 帳號鎖定，之後即使碼正確也擋下（invalid_credentials）', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    const first = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    const code = extractCode(sent[0].body);

    for (let i = 0; i < local.MAX_FAILED_ATTEMPTS; i += 1) {
      const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: '999999' }));
      assert.equal(r.data.error, 'invalid_email_otp');
    }
    void first;

    const row = local.getUser(db, 'a@x.com');
    assert.ok(local.isLocked(row, Math.floor(Date.now() / 1000)), '應已鎖定');

    // 鎖定期間，即使補上原本正確的碼也應被擋下（不洩漏鎖定原因，統一回 invalid_credentials）。
    const withCorrectCode = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.equal(withCorrectCode.data.error, 'invalid_credentials', '鎖定期間即使碼正確也應拒絕');
  });
});

test('email OTP：過期 → 拒絕（invalid_email_otp）', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    const code = extractCode(sent[0].body);

    // 把過期時間撥到過去，模擬 10 分鐘效期已過。
    db.prepare("UPDATE users SET email_otp_expires_at = ? WHERE email = ?")
      .run(new Date(Date.now() - 1000).toISOString(), 'a@x.com');

    const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.equal(r.data.error, 'invalid_email_otp');
  });
});

test('email OTP：單次有效——驗證通過後同一碼不能再用一次', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    const code = extractCode(sent[0].body);

    const first = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.ok(first.data.sessionToken);

    const replay = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.equal(replay.data.error, 'invalid_email_otp', '用過的碼不應再被接受');
  });
});

test('email OTP：60 秒內重複請求 → 不重寄（gmailFetch 只呼叫一次），回應 resent:false', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig();

  await withSendCapture(async (sent) => {
    const first = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(first.data.resent, true);
    assert.equal(sent.length, 1);

    const second = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(second.data.error, 'email_otp_sent');
    assert.equal(second.data.resent, false, '60 秒內不應視為新一輪寄送');
    assert.equal(sent.length, 1, '60 秒內不應再次呼叫 Gmail API 寄信');
  });
});

test('email OTP：MAIL_SEND_CREDS 未設定 → email_otp_unavailable（不阻塞在「已寄出」的假象）', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig({ MAIL_SEND_CREDS: '' });

  const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
  assert.equal(r.data.error, 'email_otp_unavailable');
});

test('email OTP：正式版環境（GC_CALENDAR_NAME 不以 [DEV] 開頭）→ 主旨不含【測試版】前綴', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  const config = testConfig({ GC_CALENDAR_NAME: 'SCC 空間預約' });

  await withSendCapture(async (sent) => {
    await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(sent[0].subject, '【屏科大學諮資訊系統】登入驗證碼');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// switchToEmailOtp：登入中途從 TOTP 改用 Email 驗證碼
// ══════════════════════════════════════════════════════════════════════════

test('switchToEmailOtp：已註冊 TOTP 但未選方法的帳號，登入中途切換 → 立即寄送 email OTP 且持久生效', async () => {
  const totp = require('../src/auth/totp');
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await local.upsertUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'a@x.com': { role: '專任諮商心理師' } } } });
  const config = testConfig();

  // 未切換前：照舊要求 TOTP。
  const before = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
  assert.equal(before.data.error, 'totp_required');

  await withSendCapture(async (sent) => {
    const switched = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', {
      switchToEmailOtp: true, otpEmails: ['a@x.com'],
    }));
    assert.equal(switched.data.error, 'email_otp_sent');
    assert.equal(otpMailsOnly(sent).length, 1);
    const code = extractCode(otpMailsOnly(sent)[0].body);

    const ok = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: code }));
    assert.ok(ok.data.sessionToken);

    // 持久生效：下一輪獨立登入不需再帶 switchToEmailOtp，直接走 email 分支。
    const nextLogin = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(nextLogin.data.error, 'email_otp_sent', '切換後應持久生效，不需每次都帶 switchToEmailOtp');
    assert.equal(otpMailsOnly(sent).length, 2, '第二輪應是新的一封 OTP 信（sent_at 已因上輪驗證通過而清空,不受 60 秒冷卻卡住）');
  });
});

test('switchToEmailOtp：未附 otpEmails（0 個）→ otp_emails_required，twofa_method 不生效', async () => {
  const totp = require('../src/auth/totp');
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await local.upsertUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'a@x.com': { role: '專任諮商心理師' } } } });
  const config = testConfig();

  const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { switchToEmailOtp: true }));
  assert.equal(r.data.error, 'otp_emails_required');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.twofa_method, null, '驗證失敗不應變更 twofa_method');

  // 未生效，所以下一次登入仍照舊要求 TOTP。
  const stillTotp = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
  assert.equal(stillTotp.data.error, 'totp_required');
});

test('switchToEmailOtp：密碼錯誤時不生效（不洩漏、也不允許越權改他人帳號的 twofa_method）', async () => {
  const totp = require('../src/auth/totp');
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await local.upsertUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'a@x.com': { role: '專任諮商心理師' } } } });
  const config = testConfig();

  const wrongPw = await handleRequest(db, config, loginPayload('a@x.com', 'wrong-password', {
    switchToEmailOtp: true, otpEmails: ['a@x.com'],
  }));
  assert.equal(wrongPw.data.error, 'invalid_credentials');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.twofa_method, null, '密碼錯誤時不應變動 twofa_method');
});

// ══════════════════════════════════════════════════════════════════════════
// otp_emails：多收件人寄送＋防禦性 fallback
// ══════════════════════════════════════════════════════════════════════════

test('多收件人：twofaSetMethod 設定 3 個 email 後，下次登入寄送 OTP 應各自收到一封同樣驗證碼的信（不是一封信塞多個 To）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password'); // 尚未設定第二因素，先登入一次拿 session
  const config = testConfig();

  const firstLogin = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
  const tok = firstLogin.data.sessionToken;
  const setR = await handleRequest(db, config, {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email',
    emails: ['a@x.com', 'backup1@x.com', 'backup2@x.com'],
  });
  assert.equal(setR.data.ok, true);

  await withSendCapture(async (sent) => {
    // 這是新的一輪 sessionStart（尚無有效裝置憑證），會走 email 第二因素分支寄出驗證碼。
    const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(r.data.error, 'email_otp_sent');
    const mails = otpMailsOnly(sent);
    assert.equal(mails.length, 3, '應各自寄一封信給 3 個地址（不是一封信塞多個 To）');
    const tos = mails.map((m) => m.to).sort();
    assert.deepEqual(tos, ['a@x.com', 'backup1@x.com', 'backup2@x.com']);
    const codes = mails.map((m) => extractCode(m.body));
    assert.equal(new Set(codes).size, 1, '三封信應是同一組驗證碼');

    // 用任一封信的碼登入都應成立（同一組碼，非各自獨立）。
    const ok = await handleRequest(db, config, loginPayload('a@x.com', 'right-password', { emailOtp: codes[0] }));
    assert.ok(ok.data.sessionToken);
  });
});

test('防禦性 fallback：twofa_method=\'email\' 但 otp_emails 為空 → 退回寄到帳號本身 email', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password'); // otp_emails 從未設定，欄位為 NULL
  const config = testConfig();

  await withSendCapture(async (sent) => {
    const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(r.data.error, 'email_otp_sent');
    const mails = otpMailsOnly(sent);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'a@x.com', 'otp_emails 空應 fallback 回帳號本身 email');
  });
});

test('多收件人：其中一個地址寄送失敗，其餘成功 → 仍視為寄出成功（best-effort，非全有全無）', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  db.prepare('UPDATE users SET otp_emails = ? WHERE email = ?')
    .run(JSON.stringify(['a@x.com', 'bad@x.com']), 'a@x.com');
  const config = testConfig();

  const gmail = require('../src/google/gmail');
  const googleAuth = require('../src/google/auth');
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  const sent = [];
  gmail.gmailFetch = async (_accessToken, p, opts) => {
    if (p === '/messages/send') {
      const decoded = decodeRaw(opts.body.raw);
      const to = extractTo(decoded);
      if (to === 'bad@x.com') throw new Error('模擬該地址寄送失敗');
      sent.push({ to, body: extractBodyText(decoded) });
      return { id: 'msg_ok' };
    }
    throw new Error('unexpected gmailFetch path in test: ' + p);
  };
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE', expiresIn: 3600 });
  try {
    const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(r.data.error, 'email_otp_sent', '至少一個地址成功即視為寄出成功');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'a@x.com');
  } finally {
    gmail.gmailFetch = origGmailFetch;
    googleAuth.tokenFromRefresh = origTokenFromRefresh;
  }
});

test('多收件人：全部地址都寄送失敗 → email_otp_unavailable', async () => {
  const db = openDb(':memory:');
  await setupEmailOtpUser(db, 'a@x.com', 'right-password');
  db.prepare('UPDATE users SET otp_emails = ? WHERE email = ?')
    .run(JSON.stringify(['bad1@x.com', 'bad2@x.com']), 'a@x.com');
  const config = testConfig();

  const gmail = require('../src/google/gmail');
  const googleAuth = require('../src/google/auth');
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = async () => { throw new Error('模擬全部失敗'); };
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE', expiresIn: 3600 });
  try {
    const r = await handleRequest(db, config, loginPayload('a@x.com', 'right-password'));
    assert.equal(r.data.error, 'email_otp_unavailable');
  } finally {
    gmail.gmailFetch = origGmailFetch;
    googleAuth.tokenFromRefresh = origTokenFromRefresh;
  }
});
