// server/src/actions/session.js — sessionStart／sessionLogout／listMySessions 垂直切片。
// 對映 dev/Code.gs sessionStart_/sessionLogout_/sessionsListForUser_（L410-456、L711-736），
// 差異：身分來源由 Google idToken 改為本地帳密＋TOTP（auth/local.js），寄信在 Phase 1 落為
// audit only（mailSent 恆為 false，見計畫「關鍵實作提醒」）；v166 異常偵測/geo 鎖定/7 天保底信
// 等 GAS 版通知邏輯本階段不移植（純本地開發環境驗證用，非公網部署，之後接 Phase 2 SMTP 時再補）。
'use strict';

const vdrive = require('../storage/vdrive');
const sessionAuth = require('../auth/session');
const local = require('../auth/local');
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

// 回傳 { kind: 'invalid_credentials' | 'unauthorized' | 'ok', ...(ok 時附 sessionToken/exp/email/mailSent) }
async function sessionStart(db, { email, password, otp, ua, ip, geo, cc }, ctx, secret) {
  const authedEmail = await local.verifyLocalCredentials(db, email, password, otp);
  if (!authedEmail) return { kind: 'invalid_credentials' };

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

  return { kind: 'ok', sessionToken: issued.token, exp: issued.exp, email: authedEmail, mailSent: false };
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
