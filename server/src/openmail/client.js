// server/src/openmail/client.js -- v202 openmail: imapflow/nodemailer connection wrapper.
//
// One cached IMAP connection per (session) email: lazy connect, operations serialized through a
// per-connection promise chain (imapflow requires exclusive access via mailboxLock -- see
// getMailboxLock usage in openmail/actions.js -- but even non-mailbox operations like LIST must
// not interleave on the same socket), idle-closed after 5 minutes, and rebuilt automatically after
// a disconnect. Host/port come from config (see config.js OPENMAIL_IMAP_HOST/PORT/SMTP_HOST/PORT).
//
// This module never persists credentials -- callers (openmail/actions.js) always pass mailUser/
// mailPass fetched fresh from credStore for each call.
'use strict';

const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const net = require('net');

const IDLE_CLOSE_MS = 5 * 60 * 1000;

// v224：輕量網路可達性探測——只做 TCP connect 到 IMAP host:port（不做 TLS 握手、不登入），成功即
// 視為信箱伺服器可連線。刻意不帶帳密：這不是登入嘗試，不會觸發信箱伺服器的登入失敗限流，可安全地
// 供「連線頁可連線燈號 / 信箱在線燈號」定期輪詢。逾時或錯誤一律回 false（fail-closed）。
function probeReachable(config, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const socket = net.connect({ host: imapHost(config), port: imapPort(config) });
    const finish = (reachable) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) {}
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function imapHost(config) { return (config && config.OPENMAIL_IMAP_HOST) || 'mail.npust.edu.tw'; }
function imapPort(config) { return Number((config && config.OPENMAIL_IMAP_PORT) || 993); }
function smtpHost(config) { return (config && config.OPENMAIL_SMTP_HOST) || imapHost(config); }
function smtpPort(config) { return Number((config && config.OPENMAIL_SMTP_PORT) || 465); }

// email -> { client: ImapFlow|null, queue: Promise, timer: Timeout|null }
const connections = new Map();

function buildImapClient(mailUser, mailPass, config) {
  return new ImapFlow({
    host: imapHost(config),
    port: imapPort(config),
    secure: true,
    auth: { user: mailUser, pass: mailPass },
    logger: false,
  });
}

function getConn(email) {
  let conn = connections.get(email);
  if (!conn) {
    conn = { client: null, queue: Promise.resolve(), timer: null };
    connections.set(email, conn);
  }
  return conn;
}

function armIdleTimer(email, conn) {
  if (conn.timer) clearTimeout(conn.timer);
  conn.timer = setTimeout(() => { closeConnection(email); }, IDLE_CLOSE_MS);
  if (conn.timer.unref) conn.timer.unref();
}

function isConnectionError(err) {
  const msg = String((err && err.message) || '');
  return /closed|econnreset|timeout|socket|not\s*connected/i.test(msg) || (err && err.code === 'NoConnection');
}

// Serialized access to the cached IMAP connection: fn(client) may return a promise. Any operation
// that looks like a transport-level failure invalidates the cached client so the next call
// reconnects instead of retrying against a dead socket.
function withImap(email, mailUser, mailPass, config, fn) {
  const conn = getConn(email);
  const task = conn.queue.then(async () => {
    if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }
    if (!conn.client) {
      const c = buildImapClient(mailUser, mailPass, config);
      c.on('close', () => { if (conn.client === c) conn.client = null; });
      c.on('error', () => { /* the 'close' event handles cleanup; this just avoids an unhandled error */ });
      await c.connect();
      conn.client = c;
    }
    try {
      return await fn(conn.client);
    } catch (err) {
      if (isConnectionError(err)) {
        try { conn.client && conn.client.close(); } catch (_e) { /* ignore */ }
        conn.client = null;
      }
      throw err;
    } finally {
      armIdleTimer(email, conn);
    }
  });
  // Keep the queue alive even if this task rejects -- the caller still receives the original
  // rejection via `task`, only the internal chain must not get stuck.
  conn.queue = task.catch(() => {});
  return task;
}

function closeConnection(email) {
  const conn = connections.get(email);
  if (!conn) return;
  if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }
  const c = conn.client;
  conn.client = null;
  if (c) {
    try {
      c.logout().catch(() => { try { c.close(); } catch (_e) { /* ignore */ } });
    } catch (_e) {
      try { c.close(); } catch (_e2) { /* ignore */ }
    }
  }
}

function isAuthError(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  const flagged = !!(err && (err.authenticationFailed || err.code === 'AUTHENTICATIONFAILED'));
  return flagged || /auth|login|credential|invalid/.test(msg);
}

// Standalone login check for omConnect -- verifies the account/password before it is ever cached
// in credStore. Never touches the `connections` cache (a throwaway client is used and always
// closed), so a failed verify cannot leave a half-open cached connection behind.
async function verifyLogin(mailUser, mailPass, config) {
  const c = new ImapFlow({
    host: imapHost(config), port: imapPort(config), secure: true,
    auth: { user: mailUser, pass: mailPass }, logger: false,
    // 2026-07-20 事件：郵件伺服器對連續登入失敗會懲罰性不回應，ImapFlow 預設 connectionTimeout
    // 90 秒讓使用者每次重試都卡滿 90 秒。縮到 15 秒快速回報「郵件伺服器沒回應」。
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  try {
    await c.connect();
    await c.logout();
    return { ok: true };
  } catch (err) {
    try { c.close(); } catch (_e) { /* ignore */ }
    if (isAuthError(err)) return { ok: false, reason: 'auth' };
    const msg = String((err && err.message) || '').toLowerCase();
    if (/timeout|timed out/.test(msg) || err.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'unreachable' };
  }
}

function buildSmtpTransport(mailUser, mailPass, config) {
  return nodemailer.createTransport({
    host: smtpHost(config),
    port: smtpPort(config),
    secure: true,
    auth: { user: mailUser, pass: mailPass },
  });
}

// Test-only: force-close every cached connection so unit tests don't leak timers between cases.
function _resetForTest() {
  for (const email of Array.from(connections.keys())) closeConnection(email);
  connections.clear();
}

module.exports = {
  withImap,
  closeConnection,
  verifyLogin,
  buildSmtpTransport,
  probeReachable,
  imapHost,
  imapPort,
  smtpHost,
  smtpPort,
  _resetForTest,
};
