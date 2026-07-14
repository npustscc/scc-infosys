// server/src/auth/session.js — 逐行移植 dev/Code.gs L262-328 自簽 session token。
// 格式必須與前端 _getSession()（dev/index.html:4133）位元組相容：
//   base64url(JSON{e,jti,iat,exp}) + '.' + base64url(HMAC-SHA256(payloadB64, SECRET))
// 前端用 atob() 手動解 base64url（先把 -/_ 換回 +//），故這裡的 base64url 編碼必須「去 padding」，
// 與 GAS Utilities.base64EncodeWebSafe(...).replace(/=+$/, '') 完全一致。
'use strict';

const crypto = require('node:crypto');

// 下一個台北午夜的 Unix 秒——與 dev/Code.gs nextTaipeiMidnightEpochSec_ 逐行相同（純算術 UTC+8）。
function nextTaipeiMidnightEpochSec(nowMs) {
  const OFF = 8 * 3600;
  const tpeSec = Math.floor(nowMs / 1000) + OFF;
  return (Math.floor(tpeSec / 86400) + 1) * 86400 - OFF;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signSessionPayload(payloadB64, secret) {
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return base64url(sig);
}

function issueSessionToken(email, secret, nowMs = Date.now()) {
  if (!secret) throw new Error('SESSION_SECRET 未設定');
  const now = Math.floor(nowMs / 1000);
  const jti = crypto.randomUUID();
  const payload = { e: email, jti, iat: now, exp: nextTaipeiMidnightEpochSec(nowMs) };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const token = payloadB64 + '.' + signSessionPayload(payloadB64, secret);
  return { token, exp: payload.exp, jti, iat: now };
}

// 驗證通過回 email，否則 null（fail-closed：密鑰未設定、格式錯、簽章不符、過期、已被登出註銷都是 null）。
// revokedBeforeSec：呼叫端查好的該 email 之 revoked_before（epoch 秒）或 undefined/null。
function verifySessionToken(token, secret, revokedBeforeSec, nowMs = Date.now()) {
  try {
    if (!secret || !token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    // 常數時間比對，避免簽章逐字元比較的 timing side-channel
    const expected = Buffer.from(signSessionPayload(parts[0], secret));
    const actual = Buffer.from(parts[1]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    if (!payload || !payload.e) return null;
    if (Number(payload.exp) <= Math.floor(nowMs / 1000)) return null;
    if (revokedBeforeSec && Number(payload.iat) < Number(revokedBeforeSec)) return null;
    return payload;
  } catch (_e) {
    return null;
  }
}

// ── 登出即註銷（全部裝置）：session_revocation 表 = GAS 的 SESSION_REVOKED_BEFORE ──

function getRevokedBefore(db, email) {
  const row = db.prepare('SELECT revoked_before FROM session_revocation WHERE email = ?').get(email);
  return row ? row.revoked_before : null;
}

function revokeAllDevices(db, email, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  db.prepare(
    `INSERT INTO session_revocation (email, revoked_before) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET revoked_before = excluded.revoked_before`
  ).run(email, nowSec);
  return nowSec;
}

module.exports = {
  nextTaipeiMidnightEpochSec,
  base64url,
  base64urlDecode,
  signSessionPayload,
  issueSessionToken,
  verifySessionToken,
  getRevokedBefore,
  revokeAllDevices,
};
