// server/src/actions/session.js — sessionStart／sessionLogout／listMySessions 垂直切片。
// 對映 dev/Code.gs sessionStart_/sessionLogout_/sessionsListForUser_（L410-456、L711-736），
// 差異：身分來源由 Google idToken 改為本地帳密＋TOTP（auth/local.js），寄信在 Phase 1 落為
// audit only（mailSent 恆為 false，見計畫「關鍵實作提醒」）；v166 異常偵測/geo 鎖定/7 天保底信
// 等 GAS 版通知邏輯本階段不移植（純本地開發環境驗證用，非公網部署，之後接 Phase 2 SMTP 時再補）。
'use strict';

const vdrive = require('../storage/vdrive');
const sessionAuth = require('../auth/session');
const local = require('../auth/local');
const deviceTrust = require('../auth/deviceTrust');
const gate = require('../authz/gate');

const SESSIONS_PATH = 'sessions.json';
const MAX_SESSIONS_PER_USER = 15;
const RETENTION_DAYS = 45;

function readSessionsData(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, SESSIONS_PATH, ctx);
    if (data && Array.isArray(data.sessions)) return data;
  } catch (_e) { /* 檔不存在，稍後建立 */ }
  return { sessions: [] };
}

function appendSessionRecord(db, ctx, rec) {
  const data = readSessionsData(db, ctx);
  data.sessions.push(rec);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  data.sessions = data.sessions.filter((s) => s && s.issuedAtMs && s.issuedAtMs >= cutoff);
  data.sessions.sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0));
  const perUser = {};
  const kept = [];
  data.sessions.forEach((s) => {
    const e = s.email || '';
    perUser[e] = (perUser[e] || 0) + 1;
    if (perUser[e] <= MAX_SESSIONS_PER_USER) kept.push(s);
  });
  data.sessions = kept;
  vdrive.updateJson(db, SESSIONS_PATH, data, ctx);
}

function readConfigUsers(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || null;
  } catch (_e) {
    return null;
  }
}

// 回傳 { kind: 'invalid_credentials' | 'totp_required' | 'invalid_totp' | 'unauthorized' | 'ok',
//        ...(ok 時附 sessionToken/exp/email/mailSent/totpEnrolled/newDeviceToken?) }
// totp_required／invalid_totp 只在密碼已驗證正確時才會出現（見 local.verifyLocalCredentialsDetailed
// 的 kind 語意註解）——帳密錯誤一律回 invalid_credentials，不洩漏帳密是否正確以外的資訊。
//
// Phase 3b 信任裝置：deviceToken（由 index.js 從 Cookie header 注入 payload，見該檔頭註解）若為
// 該帳號目前有效的裝置憑證，等同第二因素（TOTP）已滿足——密碼正確、已註冊 TOTP、本次未附 otp
// 的情境（即原本會回 totp_required）改為直接放行。deviceDays＝config.TRUSTED_DEVICE_DAYS。
async function sessionStart(db, { email, password, otp, ua, ip, geo, cc, deviceToken }, ctx, secret, deviceDays) {
  const revokedBefore = sessionAuth.getRevokedBefore(db, email);
  const deviceValid = !!(email && deviceToken
    && deviceTrust.verifyDeviceToken(db, deviceToken, email, revokedBefore, deviceDays));

  let authResult = await local.verifyLocalCredentialsDetailed(db, email, password, otp);
  if (authResult.kind === 'totp_required' && deviceValid) {
    // 裝置信任放行：比照一般登入成功重置鎖定計數（verifyLocalCredentialsDetailed 在
    // totp_required 分支不會呼叫內部的 registerSuccess，見 local.registerLoginSuccess 註解）。
    local.registerLoginSuccess(db, email);
    authResult = { kind: 'ok', email, totpEnrolled: true };
  }
  if (authResult.kind !== 'ok') return { kind: authResult.kind };
  const authedEmail = authResult.email;

  const users = readConfigUsers(db, ctx);
  if (!gate.authzDecision(users, authedEmail)) return { kind: 'unauthorized' };

  const issued = sessionAuth.issueSessionToken(authedEmail, secret);
  try {
    appendSessionRecord(db, ctx, {
      jti: issued.jti, email: authedEmail,
      ua: String(ua || '').slice(0, 200) || '（未提供）',
      ip: String(ip || '').slice(0, 64),
      geo: String(geo || '').slice(0, 120),
      cc: String(cc || '').slice(0, 8),
      iat: issued.iat, exp: issued.exp,
      issuedAtMs: Date.now(), issuedAt: new Date().toISOString(),
      mailSent: false, mailReason: 'phase1_no_smtp',
    });
  } catch (_e) { /* 登入紀錄寫入失敗不阻斷登入，同 GAS 版行為 */ }

  // 裝置憑證：既有裝置有效則沿用（verifyDeviceToken 已順手更新 last_seen_at），否則視為新裝置／
  // 無痕首登／裝置信任已過期／已被撤銷／尚未註冊 TOTP 的帳號首次登入，一律簽發新憑證——
  // 未註冊 TOTP 的帳號簽發裝置 cookie 目前無實際「免 TOTP」效果，但簽發本身無害；刻意選擇單一
  // 路徑（不為「已註冊/未註冊 TOTP」分岔兩套簽發邏輯），實作與後續維護都更簡單（見任務回報）。
  let newDeviceToken;
  if (!deviceValid) {
    const issuedDevice = deviceTrust.issueDevice(db, authedEmail, ua);
    newDeviceToken = issuedDevice.cookieValue;
  }

  return {
    kind: 'ok', sessionToken: issued.token, exp: issued.exp, email: authedEmail, mailSent: false,
    totpEnrolled: !!authResult.totpEnrolled,
    ...(newDeviceToken ? { newDeviceToken } : {}),
  };
}

function sessionLogout(db, userEmail) {
  sessionAuth.revokeAllDevices(db, userEmail);
  return { ok: true };
}

function listMySessions(db, userEmail, params, ctx) {
  const data = readSessionsData(db, ctx);
  const revokedBefore = sessionAuth.getRevokedBefore(db, userEmail);
  const nowSec = Math.floor(Date.now() / 1000);
  const curJti = String((params && params.currentJti) || '');
  const mine = data.sessions.filter((s) => s && s.email === userEmail);
  mine.sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0));
  mine.forEach((s) => {
    s.expired = Number(s.exp) <= nowSec;
    s.revoked = !!(revokedBefore && Number(s.iat) < Number(revokedBefore));
    s.active = !s.expired && !s.revoked;
    s.current = !!(curJti && s.jti === curJti);
  });
  return { sessions: mine };
}

module.exports = { sessionStart, sessionLogout, listMySessions, readConfigUsers };
