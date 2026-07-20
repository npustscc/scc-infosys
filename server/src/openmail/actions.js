// server/src/openmail/actions.js -- v202 openmail: business layer for the om* dispatch actions.
//
// Every function here takes the caller's session email (never anything from params -- mirrors the
// existing convention in actions/twofa.js / actions/password.js of never trusting a client-supplied
// email for "who am I acting as") and looks the openmail credentials up fresh from credStore. If
// credStore has nothing cached (never connected, or the cached entry expired), every action that
// needs the mailbox returns the fixed business error 'mail_not_connected' (dispatch.js wraps the
// returned object with envelope.ok(), so { error: 'mail_not_connected' } surfaces exactly like the
// other bizError-style action results already in this codebase, e.g. actions/mail.js
// fetchMentalLeaves's `{ error: ... }` for an unsupported mode).
'use strict';

const { simpleParser } = require('mailparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const credStore = require('./credStore');
const client = require('./client');
const sanitize = require('./sanitize');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_INLINE_CID_BYTES = 2 * 1024 * 1024;
const MAX_SEND_ATTACH_BYTES = 50 * 1024 * 1024;

function clampPageSize(n) {
  const v = Number(n) || DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(v)));
}

// Runs fn(creds) only if the caller has a live (non-expired) credStore entry; otherwise returns the
// fixed business error without ever touching the network.
async function withCreds(email, fn) {
  const creds = credStore.get(email);
  if (!creds) return { error: 'mail_not_connected' };
  return fn(creds);
}

// ── omStatus / omConnect / omDisconnect ─────────────────────────────────────

function omStatus(email) {
  const creds = credStore.get(email);
  return { connected: !!creds, mailUser: creds ? creds.mailUser : null };
}

// v224：信箱伺服器可達性探測（連線頁「可連線」燈號／信箱「在線」燈號用）。純 TCP 探測、不需帳密、
// 不觸發登入限流；同時回報本 session 是否已連結（credStore 有效）。
async function omReachable(email, config) {
  const reachable = await client.probeReachable(config);
  return { reachable, connected: !!credStore.get(email) };
}

async function omConnect(email, config, params) {
  const mailUser = params && params.mailUser;
  const mailPass = params && params.mailPass;
  if (!mailUser || !mailPass) return { error: 'mail_auth_failed' };
  const result = await client.verifyLogin(mailUser, mailPass, config);
  if (!result.ok) {
    if (result.reason === 'auth') return { error: 'mail_auth_failed' };
    if (result.reason === 'timeout') return { error: 'mail_server_timeout' };
    return { error: 'mail_server_unreachable' };
  }
  credStore.set(email, mailUser, mailPass);
  return { ok: true, mailUser: mailUser };
}

function omDisconnect(email) {
  credStore.clear(email);
  client.closeConnection(email);
  return { ok: true };
}

// ── omListFolders ────────────────────────────────────────────────────────

async function omListFolders(email, config) {
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    const list = await imap.list({ statusQuery: { messages: true, unseen: true } });
    return {
      folders: list.map((f) => ({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter,
        specialUse: f.specialUse || null,
        unseen: (f.status && f.status.unseen) || 0,
        total: (f.status && f.status.messages) || 0,
      })),
    };
  }));
}

async function findSpecialUseFolder(imap, use) {
  const list = await imap.list();
  const hit = list.find((f) => f.specialUse === use);
  return hit ? hit.path : null;
}

// ── omListMessages / omSearch shared helpers ────────────────────────────────

function bodyStructureHasAttachment(node) {
  if (!node) return false;
  if (node.disposition && String(node.disposition).toLowerCase() === 'attachment') return true;
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    return node.childNodes.some(bodyStructureHasAttachment);
  }
  return false;
}

function envelopeAddr(addr) {
  if (!addr) return { name: '', address: '' };
  const address = addr.address || (addr.mailbox && addr.host ? `${addr.mailbox}@${addr.host}` : '');
  return { name: addr.name || '', address };
}

function toMessageSummary(msg) {
  const env = msg.envelope || {};
  const from = (env.from && env.from[0]) || null;
  return {
    uid: msg.uid,
    subject: env.subject || '',
    from: envelopeAddr(from),
    date: env.date ? new Date(env.date).toISOString() : null,
    seen: msg.flags ? msg.flags.has('\\Seen') : false,
    flagged: msg.flags ? msg.flags.has('\\Flagged') : false,
    answered: msg.flags ? msg.flags.has('\\Answered') : false,
    hasAttachments: bodyStructureHasAttachment(msg.bodyStructure),
    size: msg.size || 0,
  };
}

const LIST_FETCH_QUERY = { envelope: true, flags: true, size: true, bodyStructure: true, uid: true };

async function fetchMessagesRange(imap, folder, page, pageSize) {
  const lock = await imap.getMailboxLock(folder);
  try {
    const total = imap.mailbox ? imap.mailbox.exists : 0;
    const p = Math.max(1, Number(page) || 1);
    const size = clampPageSize(pageSize);
    if (!total) return { total: 0, page: p, pageSize: size, messages: [] };
    const endSeq = total - (p - 1) * size;
    if (endSeq < 1) return { total, page: p, pageSize: size, messages: [] };
    const startSeq = Math.max(1, endSeq - size + 1);
    const out = [];
    for await (const msg of imap.fetch(`${startSeq}:${endSeq}`, LIST_FETCH_QUERY)) {
      out.push(msg);
    }
    out.sort((a, b) => (b.seq || 0) - (a.seq || 0)); // newest-first
    return { total, page: p, pageSize: size, messages: out.map(toMessageSummary) };
  } finally {
    lock.release();
  }
}

async function omListMessages(email, config, params) {
  const folder = params && params.folder;
  if (!folder) throw new Error('omListMessages: 缺少 folder');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config,
    (imap) => fetchMessagesRange(imap, folder, params.page, params.pageSize)));
}

// ── omSearch ─────────────────────────────────────────────────────────────

async function omSearch(email, config, params) {
  const folder = params && params.folder;
  const query = params && params.query;
  if (!folder || !query) throw new Error('omSearch: 缺少 folder/query');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    let uids;
    const lock = await imap.getMailboxLock(folder);
    try {
      // imapflow encodes non-ASCII search terms with CHARSET UTF-8 automatically when needed.
      uids = await imap.search({ or: [{ from: query }, { subject: query }, { body: query }] }, { uid: true });
    } finally {
      lock.release();
    }
    const sortedUids = (uids || []).slice().sort((a, b) => b - a); // newest-first (uid ~ time order)
    const p = Math.max(1, Number(params.page) || 1);
    const size = clampPageSize(params.pageSize);
    const total = sortedUids.length;
    const pageUids = sortedUids.slice((p - 1) * size, (p - 1) * size + size);
    if (!pageUids.length) return { total, page: p, pageSize: size, messages: [] };

    const lock2 = await imap.getMailboxLock(folder);
    const fetched = [];
    try {
      for await (const msg of imap.fetch(pageUids, LIST_FETCH_QUERY, { uid: true })) {
        fetched.push(msg);
      }
    } finally {
      lock2.release();
    }
    const byUid = new Map(fetched.map((m) => [m.uid, m]));
    const messages = pageUids.map((u) => byUid.get(u)).filter(Boolean).map(toMessageSummary);
    return { total, page: p, pageSize: size, messages };
  }));
}

// ── omGetMessage ─────────────────────────────────────────────────────────

function firstAddr(addrObj) {
  if (!addrObj) return null;
  const list = Array.isArray(addrObj) ? addrObj.reduce((acc, a) => acc.concat((a && a.value) || []), []) : (addrObj.value || []);
  if (!list.length) return null;
  return { name: list[0].name || '', address: list[0].address || '' };
}

function addrList(addrObj) {
  if (!addrObj) return [];
  const list = Array.isArray(addrObj) ? addrObj.reduce((acc, a) => acc.concat((a && a.value) || []), []) : (addrObj.value || []);
  return list.map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function escapeTextToHtml(text) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre>${esc}</pre>`;
}

function replaceCidRefs(html, cidMap) {
  if (!cidMap.size) return html;
  return html.replace(/((?:src|background)\s*=\s*["'])cid:([^"']+)(["'])/gi, (full, pre, cid, post) => {
    const key = cid.replace(/^</, '').replace(/>$/, '');
    const dataUri = cidMap.get(key) || cidMap.get(cid);
    return dataUri ? `${pre}${dataUri}${post}` : full;
  });
}

// 把 mailparser 解析結果轉成前端閱讀窗需要的 view model（html 消毒、cid 內嵌、附件清單）。
// meta 為呼叫端補上的額外欄位（uid/seen/flagged 是即時 IMAP 讀信才有；omsv 封存信重放時沒有這些
// IMAP 專屬概念，見 openmail/archive.js omsvGet 只傳 {} ）——抽出本函式供兩邊共用，避免 HTML
// 消毒/cid 內嵌/附件清單這段邏輯分裂成兩份。
function buildMessageView(parsed, meta) {
  const attachmentsOut = [];
  const cidMap = new Map();
  (parsed.attachments || []).forEach((att, idx) => {
    const isInlineCid = !!att.cid && att.related !== false;
    if (isInlineCid && att.content && att.content.length <= MAX_INLINE_CID_BYTES) {
      cidMap.set(att.cid, `data:${att.contentType || 'application/octet-stream'};base64,${att.content.toString('base64')}`);
      return;
    }
    attachmentsOut.push({
      index: idx,
      filename: att.filename || `attachment-${idx + 1}`,
      contentType: att.contentType || 'application/octet-stream',
      size: att.size != null ? att.size : (att.content ? att.content.length : 0),
      cid: att.cid || null,
      inline: !!isInlineCid,
    });
  });

  const rawHtml = parsed.html || (parsed.text ? escapeTextToHtml(parsed.text) : '');
  const { html: sanitizedHtml, blockedRemoteImages } = sanitize.sanitizeHtml(rawHtml);
  const htmlWithCid = replaceCidRefs(sanitizedHtml, cidMap);

  return {
    subject: parsed.subject || '',
    from: firstAddr(parsed.from),
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    replyTo: addrList(parsed.replyTo),
    date: parsed.date ? new Date(parsed.date).toISOString() : null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []),
    html: htmlWithCid,
    text: parsed.text || '',
    attachments: attachmentsOut,
    blockedRemoteImages,
    ...(meta || {}),
  };
}

async function omGetMessage(email, config, params) {
  const folder = params && params.folder;
  const uid = params && params.uid;
  if (!folder || uid == null) throw new Error('omGetMessage: 缺少 folder/uid');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    let sourceBuf;
    let flags = null;
    const lock = await imap.getMailboxLock(folder);
    try {
      const msg = await imap.fetchOne(Number(uid), { source: true, flags: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('mail_message_not_found');
      sourceBuf = msg.source;
      flags = msg.flags || null;
      await imap.messageFlagsAdd(Number(uid), ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }

    const parsed = await simpleParser(sourceBuf);
    return buildMessageView(parsed, {
      uid: Number(uid),
      seen: true,
      flagged: flags ? flags.has('\\Flagged') : false,
    });
  }));
}

// ── omDownloadAttachment ─────────────────────────────────────────────────

async function omDownloadAttachment(email, config, params) {
  const folder = params && params.folder;
  const uid = params && params.uid;
  const index = params && params.index;
  if (!folder || uid == null || index == null) throw new Error('omDownloadAttachment: 缺少 folder/uid/index');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    let sourceBuf;
    const lock = await imap.getMailboxLock(folder);
    try {
      const msg = await imap.fetchOne(Number(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('mail_message_not_found');
      sourceBuf = msg.source;
    } finally {
      lock.release();
    }
    const parsed = await simpleParser(sourceBuf);
    const att = (parsed.attachments || [])[Number(index)];
    if (!att) throw new Error('mail_attachment_not_found');
    return {
      filename: att.filename || `attachment-${Number(index) + 1}`,
      contentType: att.contentType || 'application/octet-stream',
      base64: (att.content || Buffer.alloc(0)).toString('base64'),
    };
  }));
}

// ── omMarkSeen / omFlag / omMove / omDelete ─────────────────────────────────

async function omMarkSeen(email, config, params) {
  const folder = params && params.folder;
  const uids = params && params.uids;
  if (!folder || !Array.isArray(uids) || !uids.length) throw new Error('omMarkSeen: 缺少 folder/uids');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    const lock = await imap.getMailboxLock(folder);
    try {
      const range = uids.map(Number).join(',');
      if (params.seen === false) await imap.messageFlagsRemove(range, ['\\Seen'], { uid: true });
      else await imap.messageFlagsAdd(range, ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
    return { ok: true };
  }));
}

async function omFlag(email, config, params) {
  const folder = params && params.folder;
  const uid = params && params.uid;
  if (!folder || uid == null) throw new Error('omFlag: 缺少 folder/uid');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    const lock = await imap.getMailboxLock(folder);
    try {
      if (params.flagged === false) await imap.messageFlagsRemove(Number(uid), ['\\Flagged'], { uid: true });
      else await imap.messageFlagsAdd(Number(uid), ['\\Flagged'], { uid: true });
    } finally {
      lock.release();
    }
    return { ok: true };
  }));
}

async function omMove(email, config, params) {
  const folder = params && params.folder;
  const uids = params && params.uids;
  const toFolder = params && params.toFolder;
  if (!folder || !toFolder || !Array.isArray(uids) || !uids.length) throw new Error('omMove: 缺少 folder/uids/toFolder');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    const lock = await imap.getMailboxLock(folder);
    try {
      await imap.messageMove(uids.map(Number).join(','), toFolder, { uid: true });
    } finally {
      lock.release();
    }
    return { ok: true };
  }));
}

async function omDelete(email, config, params) {
  const folder = params && params.folder;
  const uids = params && params.uids;
  if (!folder || !Array.isArray(uids) || !uids.length) throw new Error('omDelete: 缺少 folder/uids');
  return withCreds(email, (creds) => client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
    const trash = await findSpecialUseFolder(imap, '\\Trash');
    const lock = await imap.getMailboxLock(folder);
    try {
      const range = uids.map(Number).join(',');
      if (trash && trash !== folder) {
        await imap.messageMove(range, trash, { uid: true });
      } else {
        // No \Trash folder (or already in it): fall back to \Deleted + expunge.
        await imap.messageDelete(range, { uid: true });
      }
    } finally {
      lock.release();
    }
    return { ok: true };
  }));
}

// ── omSend ──────────────────────────────────────────────────────────────

function buildRawMessage(mail) {
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => {
      if (err) reject(err); else resolve(message);
    });
  });
}

function extractAddr(a) {
  const m = /<([^>]+)>/.exec(a);
  return (m ? m[1] : a).trim();
}

function collectRecipients() {
  const out = [];
  for (let i = 0; i < arguments.length; i++) {
    const g = arguments[i];
    if (!g) continue;
    String(g).split(',').forEach((s) => { const v = extractAddr(s); if (v) out.push(v); });
  }
  return out;
}

async function omSend(email, config, params) {
  const p = params || {};
  if (!p.to) throw new Error('omSend: 缺少 to');
  return withCreds(email, async (creds) => {
    const rawAttachments = Array.isArray(p.attachments) ? p.attachments : [];
    let totalBytes = 0;
    const nmAttachments = [];
    for (const a of rawAttachments) {
      if (!a || !a.base64) continue;
      let buf;
      try {
        buf = Buffer.from(a.base64, 'base64');
      } catch (_e) {
        return { error: 'mail_send_failed' };
      }
      totalBytes += buf.length;
      if (totalBytes > MAX_SEND_ATTACH_BYTES) return { error: 'mail_too_large' };
      nmAttachments.push({ filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', content: buf });
    }

    const mail = {
      from: creds.mailUser,
      to: p.to,
      cc: p.cc || undefined,
      bcc: p.bcc || undefined,
      subject: p.subject || '',
      html: p.html || undefined,
      text: p.text || (p.html ? undefined : ''),
      attachments: nmAttachments,
      inReplyTo: p.inReplyTo || undefined,
      references: p.references || undefined,
    };

    let raw;
    try {
      raw = await buildRawMessage(mail);
    } catch (_e) {
      return { error: 'mail_send_failed' };
    }

    const transporter = client.buildSmtpTransport(creds.mailUser, creds.mailPass, config);
    try {
      await transporter.sendMail({
        envelope: { from: creds.mailUser, to: collectRecipients(p.to, p.cc, p.bcc) },
        raw,
      });
    } catch (_e) {
      return { error: 'mail_send_failed' };
    }

    // Best-effort Sent-folder backup: if there's no \Sent special-use folder, skip silently.
    try {
      await client.withImap(email, creds.mailUser, creds.mailPass, config, async (imap) => {
        const sentPath = await findSpecialUseFolder(imap, '\\Sent');
        if (sentPath) await imap.append(sentPath, raw, ['\\Seen']);
      });
    } catch (_e) { /* Sent backup failing must not affect the already-sent result */ }

    return { ok: true };
  });
}

module.exports = {
  omStatus,
  omReachable,
  omConnect,
  omDisconnect,
  omListFolders,
  omListMessages,
  omGetMessage,
  omDownloadAttachment,
  omMarkSeen,
  omFlag,
  omMove,
  omDelete,
  omSearch,
  omSend,
  // exported for unit tests of pure helpers
  bodyStructureHasAttachment,
  replaceCidRefs,
  // exported for reuse by openmail/archive.js (v220 學諮伺服器資料夾)：同一套「mailparser 解析
  // 結果 → 前端閱讀窗 view model」邏輯，封存信重放（沒有即時 IMAP 連線）也要用同一套 HTML 消毒/
  // cid 內嵌/附件清單規則，不能分裂成兩份互不同步的實作。
  buildMessageView,
  firstAddr,
  addrList,
};
