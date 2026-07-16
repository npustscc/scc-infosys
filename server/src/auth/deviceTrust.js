// server/src/auth/deviceTrust.js — 信任裝置憑證（Phase 3b）：純函式操作 trusted_devices 表
// （migration 003），與 auth/session.js 的 session token 是兩套獨立機制、互不修改對方。
//
// cookie 值格式：`${id}.${token}`——id 是查表鍵（非機密，裝置清單／撤銷用），token 是高熵秘密本體
// （crypto.randomBytes(32)）。DB 只存 token 的 sha256 雜湊：token 本身熵已足夠高，雜湊只是「DB
// 外洩不直接洩漏可用憑證」的防線，不是抵抗離線暴力破解弱密碼，故不需要 argon2 等慢雜湊
// （對比 auth/local.js 的 password_hash 用途不同）。
//
// 「登出全部裝置」的效果：刻意重用 auth/session.js 既有的 session_revocation 表（不新增第二套
// 撤銷時間戳）——verifyDeviceToken 比對裝置 created_at 是否早於呼叫端傳入的 revokedBeforeSec，
// 早於則視為已失效，語意等同 session token 的 iat < revoked_before 判斷。
'use strict';

const crypto = require('node:crypto');

const DAY_MS = 24 * 3600 * 1000;

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 16 字元的查表鍵，非機密（裝置清單／撤銷 API 會回傳給前端顯示，見 actions/trustedDevices.js）。
function newId() {
  return base64url(crypto.randomBytes(12));
}

// 高熵秘密本體：DB 從不存明文，只出現在本次簽發回傳值（呼叫端須僅用於組 Set-Cookie，不落 log）。
function newToken() {
  return base64url(crypto.randomBytes(32));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function buildCookieValue(id, token) {
  return `${id}.${token}`;
}

// 容錯解析：格式不符（無 '.'、任一半為空）一律回 null，呼叫端視為「無有效裝置憑證」。
function parseCookieValue(value) {
  if (typeof value !== 'string' || !value) return null;
  const idx = value.indexOf('.');
  if (idx <= 0 || idx === value.length - 1) return null;
  const id = value.slice(0, idx);
  const token = value.slice(idx + 1);
  if (!id || !token) return null;
  return { id, token };
}

// 簽發新裝置憑證：寫入 DB（只存雜湊），回傳 { id, cookieValue }。
function issueDevice(db, email, ua, nowMs = Date.now()) {
  const id = newId();
  const token = newToken();
  const now = new Date(nowMs).toISOString();
  db.prepare(
    `INSERT INTO trusted_devices (id, email, token_hash, created_at, last_seen_at, ua, revoked)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, email, hashToken(token), now, now, String(ua || '').slice(0, 200));
  return { id, cookieValue: buildCookieValue(id, token) };
}

// 驗證 cookie 值是否為該 email 的有效裝置憑證：id 存在、token 雜湊相符（常數時間比對）、
// 未撤銷、未過期（days 天內）、email 相符，且 created_at 須晚於 revokedBeforeSec（登出全部裝置
// 語意，見檔頭註解）。驗證通過會順手更新 last_seen_at（呼叫端不需另外呼叫 touchLastSeen）。
function verifyDeviceToken(db, cookieValue, email, revokedBeforeSec, days, nowMs = Date.now()) {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed || !email) return false;
  const row = db.prepare('SELECT * FROM trusted_devices WHERE id = ?').get(parsed.id);
  if (!row) return false;
  if (row.revoked) return false;
  if (row.email !== email) return false;

  const expected = Buffer.from(hashToken(parsed.token), 'hex');
  const actual = Buffer.from(row.token_hash, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

  const createdMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdMs)) return false;
  if (nowMs - createdMs > Number(days) * DAY_MS) return false;
  if (revokedBeforeSec) {
    const createdSec = Math.floor(createdMs / 1000);
    if (createdSec < Number(revokedBeforeSec)) return false;
  }

  db.prepare('UPDATE trusted_devices SET last_seen_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), parsed.id);
  return true;
}

function touchLastSeen(db, cookieValue, nowMs = Date.now()) {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return;
  db.prepare('UPDATE trusted_devices SET last_seen_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), parsed.id);
}

// 本人裝置清單（未撤銷／已撤銷皆列出，前端自行以 revoked 決定顯示方式）。currentCookieValue
// 提供時會標記「目前這台」（見 dispatch.js：deviceToken 由 index.js 從 Cookie header 注入
// params，每個 action 皆可取得，非 sessionStart 專屬）。
function listDevices(db, email, currentCookieValue) {
  const rows = db.prepare(
    'SELECT id, created_at, last_seen_at, ua, revoked FROM trusted_devices WHERE email = ? ORDER BY last_seen_at DESC'
  ).all(email);
  const curId = currentCookieValue ? (parseCookieValue(currentCookieValue) || {}).id : null;
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    ua: r.ua,
    revoked: !!r.revoked,
    current: !!(curId && r.id === curId),
  }));
}

// 撤銷指定裝置：僅限本人（deviceId 不屬於該 email 或不存在 → 安靜回 false，不洩漏其他人裝置是否存在）。
function revokeDevice(db, email, deviceId) {
  if (!deviceId) return false;
  const row = db.prepare('SELECT id FROM trusted_devices WHERE id = ? AND email = ?').get(deviceId, email);
  if (!row) return false;
  db.prepare('UPDATE trusted_devices SET revoked = 1 WHERE id = ?').run(deviceId);
  return true;
}

module.exports = {
  newId,
  newToken,
  hashToken,
  buildCookieValue,
  parseCookieValue,
  issueDevice,
  verifyDeviceToken,
  touchLastSeen,
  listDevices,
  revokeDevice,
};
