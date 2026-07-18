// server/src/sms/actions.js — 簡訊發送業務層：驗證、呼叫 provider（mitake/every8d）、寫 sqlite
// 紀錄（sms_batches／sms_recipients，見 migrations/006_sms_log.sql）。對映 openmail/actions.js 的
// 既有慣例：
//   - userEmail 一律來自已驗證 session（dispatch.js 解出），本檔完全不吃 params 裡的身分欄位。
//   - 帳密（三竹 username/password、Every8D UID/PWD）只在 server .env（config.js），本檔不快取、
//     不回傳給前端、不落 audit_log（見 audit.js CONFIDENTIAL_KEYS／summarizeSmsParams）。
//   - 業務錯誤一律回傳 { error: 'xxx', detail? }（不 throw），dispatch.js 的 envelope.ok() 會原樣
//     包裝成 { success:true, data:{ error:'xxx' } }，前端據此判讀——與 openmail 的 bizError 慣例
//     完全相同寫法（見 openmail/actions.js 檔頭註解）。
'use strict';

const crypto = require('node:crypto');
const mitake = require('./mitake');
const every8d = require('./every8d');
const segments = require('./segments');
const taipeiTime = require('../util/taipeiTime');

const MAX_RECIPIENTS = 100;
const E8D_MAX_CHARS = 333;
const MITAKE_SCHEDULE_MARGIN_MS = 11 * 60 * 1000; // 三竹官方要求 dlvtime 須大於現在 10 分鐘；多留 1 分鐘緩衝
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

// ── provider 設定（讀 config.js 集中管理的 env 值，不直接讀 process.env——比照 openmail 的
//    OPENMAIL_IMAP_HOST 等既有慣例）。回傳 null＝該平台未設定必要帳密，呼叫端一律回
//    { error: 'sms_not_configured' }，不觸網。──

function getMitakeConfig(config) {
  if (!config || !config.SMS_MITAKE_HOST || !config.SMS_MITAKE_USERNAME || !config.SMS_MITAKE_PASSWORD) return null;
  return {
    host: config.SMS_MITAKE_HOST,
    basePath: config.SMS_MITAKE_BASE_PATH || '/api/mtk',
    username: config.SMS_MITAKE_USERNAME,
    password: config.SMS_MITAKE_PASSWORD,
    long: !!config.SMS_MITAKE_LONG,
  };
}

function getE8dConfig(config) {
  if (!config || !config.SMS_E8D_UID || !config.SMS_E8D_PWD) return null;
  return {
    host: config.SMS_E8D_HOST || 'api.e8d.tw',
    uid: config.SMS_E8D_UID,
    pwd: config.SMS_E8D_PWD,
  };
}

function providerConfig(provider, config) {
  if (provider === 'mitake') return getMitakeConfig(config);
  if (provider === 'every8d') return getE8dConfig(config);
  return null;
}

// ── smsStatus：只看 env 是否齊備，不打網路 ──

function smsStatus(config) {
  return {
    providers: {
      mitake: { configured: !!getMitakeConfig(config) },
      every8d: { configured: !!getE8dConfig(config) },
    },
  };
}

// ── smsBalance ──

async function smsBalance(config, params) {
  const provider = params && params.provider;
  const cfg = providerConfig(provider, config);
  if (!cfg) return { error: 'sms_not_configured' };
  try {
    if (provider === 'mitake') {
      const res = await mitake.queryBalance(cfg);
      if (!res.ok) return { error: 'sms_provider_error', detail: res.statuscode ? mitake.statusText(res.statuscode) : res.raw };
      return { balance: res.balance };
    }
    const res = await every8d.getCredit(cfg);
    if (!res.ok) return { error: 'sms_provider_error', detail: describeE8dFailure(res) };
    return { balance: res.balance };
  } catch (err) {
    return { error: 'sms_provider_error', detail: errMsg(err) };
  }
}

function errMsg(err) {
  return String((err && err.message) || err);
}

function describeE8dFailure(res) {
  return `${res.code || ''} ${res.message || ''}`.trim() || res.raw || 'unknown';
}

// ── 電話正規化：去空白/-/.；接受 09xxxxxxxx（10 碼）或 +8869xxxxxxxx／8869xxxxxxxx（轉為 09 開頭）。
//    不合格回傳 null（呼叫端據此收集壞號碼列表）。──

function normalizePhone(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s\-.]/g, '');
  if (/^\+8869\d{8}$/.test(s)) s = '0' + s.slice(4);
  else if (/^8869\d{8}$/.test(s)) s = '0' + s.slice(3);
  return /^09\d{8}$/.test(s) ? s : null;
}

// ── 預約時間驗證：14 碼 YYYYMMDDHHMMSS（台北時間字串），須晚於現在；三竹另要求至少 11 分鐘緩衝
//    （官方原始規則是 10 分鐘，多留 1 分鐘緩衝，見檔頭常數註解）。回傳
//    { ok:true, value } 或 { ok:false, error }（14 碼但格式不合理／不是合法日期 → sms_schedule_invalid；
//    格式合法但太快 → sms_schedule_too_soon）。──

function parseScheduledAtToUtcMs(str) {
  if (!/^\d{14}$/.test(str)) return null;
  const y = Number(str.slice(0, 4));
  const mo = Number(str.slice(4, 6));
  const d = Number(str.slice(6, 8));
  const h = Number(str.slice(8, 10));
  const mi = Number(str.slice(10, 12));
  const s = Number(str.slice(12, 14));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - taipeiTime.OFF_MS;
  // Date.UTC 對超出範圍的日期（如 2 月 30 日）會自動進位成隔月，用往返比對抓出這種偽合法輸入。
  const check = new Date(utcMs + taipeiTime.OFF_MS);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
  return utcMs;
}

function validateScheduledAt(scheduledAt, provider, nowMs) {
  nowMs = nowMs == null ? Date.now() : nowMs;
  if (scheduledAt == null || scheduledAt === '') return { ok: true, value: null };
  const utcMs = parseScheduledAtToUtcMs(String(scheduledAt));
  if (utcMs == null) return { ok: false, error: 'sms_schedule_invalid' };
  const marginMs = provider === 'mitake' ? MITAKE_SCHEDULE_MARGIN_MS : 0;
  if (utcMs <= nowMs + marginMs) return { ok: false, error: 'sms_schedule_too_soon' };
  return { ok: true, value: String(scheduledAt) };
}

// ── DB 存取 helper ──

function insertBatchWithRecipients(db, batch, recipients) {
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO sms_batches (provider, sender_email, message, scheduled_at, status, provider_batch_id, cost, balance_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      batch.provider, batch.senderEmail, batch.message, batch.scheduledAt || null, batch.status,
      batch.providerBatchId || null, batch.cost == null ? null : batch.cost, batch.balanceAfter == null ? null : batch.balanceAfter
    );
    const batchId = info.lastInsertRowid;
    const insertRecipient = db.prepare(
      `INSERT INTO sms_recipients (batch_id, phone, name, case_id, provider_msgid, status_code, status_text, status_time, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of recipients) {
      insertRecipient.run(
        batchId, r.phone, r.name || null, r.caseId || null, r.msgid || null,
        r.statusCode || null, r.statusText || null, r.statusTime || null, r.cost == null ? null : r.cost
      );
    }
    return batchId;
  });
  return tx();
}

function toBatchView(db, row) {
  const recipients = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ? ORDER BY id ASC').all(row.id);
  return {
    id: row.id,
    provider: row.provider,
    senderEmail: row.sender_email,
    message: row.message,
    scheduledAt: row.scheduled_at,
    status: row.status,
    cost: row.cost,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
    recipients: recipients.map((r) => ({
      phone: r.phone,
      name: r.name,
      caseId: r.case_id,
      msgid: r.provider_msgid,
      statusCode: r.status_code,
      statusText: r.status_text,
      statusTime: r.status_time,
      cost: r.cost,
    })),
  };
}

function getBatch(db, logId) {
  if (logId == null) return null;
  return db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(logId);
}

// ── smsSend ──

async function smsSend(db, config, senderEmail, params) {
  const p = params || {};
  const provider = p.provider;
  const cfg = providerConfig(provider, config);
  if (!cfg) return { error: 'sms_not_configured' };

  const recipientsIn = Array.isArray(p.recipients) ? p.recipients : [];
  if (!recipientsIn.length || recipientsIn.length > MAX_RECIPIENTS) {
    return { error: 'sms_invalid_phone', detail: `收件人須為 1~${MAX_RECIPIENTS} 筆（目前 ${recipientsIn.length} 筆）` };
  }

  const normalized = [];
  const badPhones = [];
  for (const r of recipientsIn) {
    const phone = normalizePhone(r && r.phone);
    if (!phone) { badPhones.push(String((r && r.phone) == null ? '' : r.phone)); continue; }
    normalized.push({ phone, name: (r && r.name) || null, caseId: (r && r.caseId) || null });
  }
  if (badPhones.length) return { error: 'sms_invalid_phone', detail: badPhones.join(', ') };

  const message = p.message;
  if (message == null || !String(message).trim()) return { error: 'sms_empty_message' };

  if (provider === 'every8d') {
    const len = Array.from(String(message)).length;
    if (len > E8D_MAX_CHARS) {
      return { error: 'sms_message_too_long', detail: `Every8D 單則內容上限 ${E8D_MAX_CHARS} 字，目前 ${len} 字` };
    }
  } else {
    const est = segments.estimate(message);
    if (!cfg.long && est.segments > 1) {
      return {
        error: 'sms_message_too_long',
        detail: `三竹帳號未開通長簡訊權限（SMS_MITAKE_LONG），超過單則長度會被業者靜默截斷；目前內容編碼 ${est.encoding}、需 ${est.segments} 則`,
      };
    }
  }

  const scheduleCheck = validateScheduledAt(p.scheduledAt, provider);
  if (!scheduleCheck.ok) return { error: scheduleCheck.error };
  const scheduledAt = scheduleCheck.value;

  let sendResult;
  try {
    sendResult = provider === 'mitake'
      ? await sendViaMitake(cfg, normalized, message, scheduledAt)
      : await sendViaEvery8d(cfg, normalized, message, scheduledAt);
  } catch (err) {
    const failedRecipients = normalized.map((r) => ({
      ...r, msgid: null, statusCode: 'error', statusText: errMsg(err), statusTime: null, cost: null,
    }));
    insertBatchWithRecipients(db, {
      provider, senderEmail, message, scheduledAt, status: 'failed',
      providerBatchId: null, cost: null, balanceAfter: null,
    }, failedRecipients);
    return { error: 'sms_provider_error', detail: errMsg(err) };
  }

  const status = sendResult.ok ? (scheduledAt ? 'scheduled' : 'sent') : 'failed';
  const logId = insertBatchWithRecipients(db, {
    provider, senderEmail, message, scheduledAt, status,
    providerBatchId: sendResult.providerBatchId, cost: sendResult.cost, balanceAfter: sendResult.balance,
  }, sendResult.recipients);

  if (!sendResult.ok) {
    return { error: 'sms_provider_error', detail: sendResult.detail };
  }

  const sentCount = sendResult.recipients.filter((r) => r.ok).length;
  return {
    ok: true,
    logId,
    provider,
    sent: sentCount,
    cost: sendResult.cost == null ? null : sendResult.cost,
    balance: sendResult.balance == null ? null : sendResult.balance,
    recipients: sendResult.recipients.map((r) => ({
      phone: r.phone,
      msgid: r.msgid || undefined,
      statuscode: r.statusCode || undefined,
    })),
  };
}

// 三竹：規模小、不用 SmBulkSend，逐一呼叫 SmSend，每人拿到自己的 msgid。中途某筆呼叫失敗（帳密/
// IP/參數錯誤等）不中斷，繼續發完其餘——整批 ok（是否落 DB 為 sent/scheduled）取決於「是否至少一筆
// 成功」，全部失敗才整批視為失敗（sms_provider_error）。
async function sendViaMitake(cfg, recipients, message, scheduledAt) {
  const results = [];
  let lastBalance = null;
  for (const r of recipients) {
    const res = await mitake.sendSingle(cfg, { phone: r.phone, message, scheduledAt });
    if (res.accountPoint != null) lastBalance = res.accountPoint;
    results.push({
      phone: r.phone,
      name: r.name,
      caseId: r.caseId,
      msgid: res.msgid || null,
      statusCode: res.statuscode || null,
      statusText: res.statuscode ? mitake.statusText(res.statuscode) : null,
      statusTime: null,
      cost: null,
      ok: !!res.ok,
    });
  }
  const anySucceeded = results.some((r) => r.ok);
  return {
    ok: anySucceeded,
    detail: anySucceeded ? null : (results.find((r) => r.statusText) || {}).statusText || '所有收件人皆發送失敗',
    cost: null,
    balance: lastBalance,
    providerBatchId: null,
    recipients: results,
  };
}

// Every8D：一次呼叫涵蓋整批收件人（DEST 逗號分隔），成功/失敗是整批層級（無逐人 msgid，逐人送達
// 狀態要等 smsQueryStatus 用 BATCHID 查 getDeliveryStatus 才知道）。
async function sendViaEvery8d(cfg, recipients, message, scheduledAt) {
  const phones = recipients.map((r) => r.phone);
  const res = await every8d.send(cfg, { phones, message, scheduledAt });
  if (!res.ok) {
    return {
      ok: false,
      detail: describeE8dFailure(res),
      cost: null,
      balance: null,
      providerBatchId: null,
      recipients: recipients.map((r) => ({
        phone: r.phone, name: r.name, caseId: r.caseId,
        msgid: null, statusCode: null, statusText: null, statusTime: null, cost: null, ok: false,
      })),
    };
  }
  return {
    ok: true,
    detail: null,
    cost: res.cost,
    balance: res.credit,
    providerBatchId: res.batchId,
    recipients: recipients.map((r) => ({
      phone: r.phone, name: r.name, caseId: r.caseId,
      msgid: null, statusCode: null, statusText: null, statusTime: null, cost: null, ok: true,
    })),
  };
}

// ── smsListLog ──

function smsListLog(db, params) {
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Number((params && params.limit) || DEFAULT_LIST_LIMIT) || DEFAULT_LIST_LIMIT));
  const offset = Math.max(0, Number((params && params.offset) || 0) || 0);
  const total = db.prepare('SELECT COUNT(*) AS n FROM sms_batches').get().n;
  const rows = db.prepare('SELECT * FROM sms_batches ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { items: rows.map((row) => toBatchView(db, row)), total };
}

// ── smsQueryStatus：向 provider 查該批最新狀態並回寫 sms_recipients ──

async function smsQueryStatus(db, config, params) {
  const logId = params && params.logId;
  const batch = getBatch(db, logId);
  if (!batch) return { error: 'sms_log_not_found' };

  if (batch.provider === 'mitake') {
    const cfg = getMitakeConfig(config);
    if (!cfg) return { error: 'sms_not_configured' };
    const recipients = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ? AND provider_msgid IS NOT NULL').all(batch.id);
    if (!recipients.length) return { ok: true, batch: toBatchView(db, batch) };
    let statusRes;
    try {
      statusRes = await mitake.queryStatus(cfg, recipients.map((r) => r.provider_msgid));
    } catch (err) {
      return { error: 'sms_provider_error', detail: errMsg(err) };
    }
    const byMsgid = new Map(statusRes.items.map((it) => [it.msgid, it]));
    const updateStmt = db.prepare('UPDATE sms_recipients SET status_code = ?, status_text = ?, status_time = ? WHERE id = ?');
    db.transaction(() => {
      for (const r of recipients) {
        const hit = byMsgid.get(r.provider_msgid);
        if (!hit) continue;
        updateStmt.run(hit.statuscode, mitake.statusText(hit.statuscode), hit.statustime || null, r.id);
      }
    })();
  } else if (batch.provider === 'every8d') {
    const cfg = getE8dConfig(config);
    if (!cfg) return { error: 'sms_not_configured' };
    if (!batch.provider_batch_id) return { ok: true, batch: toBatchView(db, batch) };
    let statusRes;
    try {
      statusRes = await every8d.getDeliveryStatus(cfg, batch.provider_batch_id);
    } catch (err) {
      return { error: 'sms_provider_error', detail: errMsg(err) };
    }
    if (!statusRes.ok) return { error: 'sms_provider_error', detail: describeE8dFailure(statusRes) };
    const byPhone = new Map();
    for (const item of statusRes.items) {
      const phone = normalizePhone(item.MOBILE) || item.MOBILE;
      byPhone.set(phone, item);
    }
    const recipients = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ?').all(batch.id);
    const updateStmt = db.prepare('UPDATE sms_recipients SET status_code = ?, status_text = ?, status_time = ?, cost = ? WHERE id = ?');
    db.transaction(() => {
      for (const r of recipients) {
        const hit = byPhone.get(r.phone);
        if (!hit) continue;
        const statusCode = hit.STATUS != null ? String(hit.STATUS) : null;
        updateStmt.run(
          statusCode, every8d.drStatusText(hit.STATUS), hit.RECEIVED_TIME || hit.SEND_TIME || null,
          hit.COST != null ? Number(hit.COST) : null, r.id
        );
      }
    })();
  } else {
    return { error: 'sms_provider_error', detail: `未知的簡訊平台：${batch.provider}` };
  }

  const updated = getBatch(db, batch.id);
  return { ok: true, batch: toBatchView(db, updated) };
}

// ── smsCancel：僅 status='scheduled' 可取消 ──

async function smsCancel(db, config, params) {
  const logId = params && params.logId;
  const batch = getBatch(db, logId);
  if (!batch) return { error: 'sms_log_not_found' };
  if (batch.status !== 'scheduled') return { error: 'sms_not_scheduled' };

  if (batch.provider === 'mitake') {
    const cfg = getMitakeConfig(config);
    if (!cfg) return { error: 'sms_not_configured' };
    const recipients = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ? AND provider_msgid IS NOT NULL').all(batch.id);
    if (!recipients.length) return { error: 'sms_cancel_failed', detail: '無可取消的訊息編號（provider_msgid 皆為空）' };
    let cancelRes;
    try {
      cancelRes = await mitake.cancel(cfg, recipients.map((r) => r.provider_msgid));
    } catch (err) {
      return { error: 'sms_cancel_failed', detail: errMsg(err) };
    }
    const successIds = new Set(cancelRes.items.filter((it) => it.canceled).map((it) => it.msgid));
    if (!successIds.size) return { error: 'sms_cancel_failed', detail: '業者拒絕取消' };
    db.transaction(() => {
      const updRecip = db.prepare("UPDATE sms_recipients SET status_code = '9', status_text = ? WHERE id = ?");
      for (const r of recipients) {
        if (successIds.has(r.provider_msgid)) updRecip.run(mitake.statusText('9'), r.id);
      }
      db.prepare("UPDATE sms_batches SET status = 'canceled' WHERE id = ?").run(batch.id);
    })();
    return { ok: true, canceled: successIds.size };
  }

  if (batch.provider === 'every8d') {
    const cfg = getE8dConfig(config);
    if (!cfg) return { error: 'sms_not_configured' };
    if (!batch.provider_batch_id) return { error: 'sms_cancel_failed', detail: '無批次編號（BATCHID）可取消' };
    let eraseRes;
    try {
      eraseRes = await every8d.eraseBooking(cfg, batch.provider_batch_id);
    } catch (err) {
      return { error: 'sms_cancel_failed', detail: errMsg(err) };
    }
    if (!eraseRes.ok) return { error: 'sms_cancel_failed', detail: describeE8dFailure(eraseRes) };
    const recipientCount = db.prepare('SELECT COUNT(*) AS n FROM sms_recipients WHERE batch_id = ?').get(batch.id).n;
    const canceled = eraseRes.deleted != null ? eraseRes.deleted : recipientCount;
    db.prepare("UPDATE sms_batches SET status = 'canceled' WHERE id = ?").run(batch.id);
    return { ok: true, canceled };
  }

  return { error: 'sms_cancel_failed', detail: `未知的簡訊平台：${batch.provider}` };
}

module.exports = {
  smsStatus,
  smsBalance,
  smsSend,
  smsListLog,
  smsQueryStatus,
  smsCancel,
  // 匯出供單元測試／內部重用
  normalizePhone,
  validateScheduledAt,
  getMitakeConfig,
  getE8dConfig,
  toBatchView,
};
