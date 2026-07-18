// server/test/sms-actions.test.js — src/sms/actions.js 業務層測試（:memory: db）。不打真實網路：
// provider 層一律 monkey-patch src/sms/mitake.js／src/sms/every8d.js 匯出的函式（比照
// test/openmail.test.js 對 openmail/client.js verifyLogin 的既有 monkey-patch 慣例——本檔的
// actions.js 呼叫 `mitake.sendSingle(...)` 等都是透過 require 進來的模組物件，monkey-patch
// 該物件上的方法即可攔截，不需要真的注入 fetchImpl 到 actions 層）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const mitake = require('../src/sms/mitake');
const every8d = require('../src/sms/every8d');
const actions = require('../src/sms/actions');

function fullConfig(overrides) {
  return Object.assign({
    SMS_MITAKE_HOST: 'smsapi.mitake.com.tw',
    SMS_MITAKE_BASE_PATH: '/api/mtk',
    SMS_MITAKE_USERNAME: 'u',
    SMS_MITAKE_PASSWORD: 'p',
    SMS_MITAKE_LONG: false,
    SMS_E8D_HOST: 'api.e8d.tw',
    SMS_E8D_UID: 'u',
    SMS_E8D_PWD: 'p',
  }, overrides || {});
}

// 往未來拿一個合法的 14 碼預約時間字串（相對「現在」加 N 分鐘），避免測試寫死日期日後過期。
function scheduledAtInMinutes(mins) {
  const d = new Date(Date.now() + mins * 60 * 1000 + 8 * 3600 * 1000); // +8h 換算台北時間
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function patch(obj, key, fn, t) {
  const orig = obj[key];
  obj[key] = fn;
  t.after(() => { obj[key] = orig; });
}

// ── smsStatus ──

test('smsStatus：兩平台皆缺帳密 → configured 皆為 false', () => {
  const r = actions.smsStatus({});
  assert.deepEqual(r, { providers: { mitake: { configured: false }, every8d: { configured: false } } });
});

test('smsStatus：兩平台帳密齊備 → configured 皆為 true', () => {
  const r = actions.smsStatus(fullConfig());
  assert.equal(r.providers.mitake.configured, true);
  assert.equal(r.providers.every8d.configured, true);
});

test('smsStatus：三竹缺 HOST → mitake configured:false，不影響 every8d', () => {
  const r = actions.smsStatus(fullConfig({ SMS_MITAKE_HOST: '' }));
  assert.equal(r.providers.mitake.configured, false);
  assert.equal(r.providers.every8d.configured, true);
});

// ── normalizePhone ──

test('normalizePhone：09 開頭 10 碼直接通過，去除空白/-/.', () => {
  assert.equal(actions.normalizePhone('0912345678'), '0912345678');
  assert.equal(actions.normalizePhone('0912-345-678'), '0912345678');
  assert.equal(actions.normalizePhone('0912.345.678'), '0912345678');
  assert.equal(actions.normalizePhone(' 0912345678 '), '0912345678');
});

test('normalizePhone：+8869xxxxxxxx／8869xxxxxxxx 轉為 09 開頭', () => {
  assert.equal(actions.normalizePhone('+886912345678'), '0912345678');
  assert.equal(actions.normalizePhone('886912345678'), '0912345678');
});

test('normalizePhone：格式不合法回 null', () => {
  assert.equal(actions.normalizePhone('12345'), null);
  assert.equal(actions.normalizePhone('0212345678'), null); // 市話非手機
  assert.equal(actions.normalizePhone(''), null);
  assert.equal(actions.normalizePhone(null), null);
});

// ── validateScheduledAt ──

test('validateScheduledAt：未帶值 → ok', () => {
  assert.deepEqual(actions.validateScheduledAt(undefined, 'every8d'), { ok: true, value: null });
  assert.deepEqual(actions.validateScheduledAt('', 'mitake'), { ok: true, value: null });
});

test('validateScheduledAt：格式錯誤（非 14 碼／非法日期）→ sms_schedule_invalid', () => {
  assert.equal(actions.validateScheduledAt('2026071812', 'every8d').error, 'sms_schedule_invalid');
  assert.equal(actions.validateScheduledAt('20261332120000', 'every8d').error, 'sms_schedule_invalid'); // 13 月
  assert.equal(actions.validateScheduledAt('20260230120000', 'every8d').error, 'sms_schedule_invalid'); // 2 月 30 日
});

test('validateScheduledAt：every8d 只要求晚於現在', () => {
  const soon = scheduledAtInMinutes(1);
  assert.equal(actions.validateScheduledAt(soon, 'every8d').ok, true);
});

test('validateScheduledAt：mitake 須晚於現在至少 11 分鐘', () => {
  const tooSoon = scheduledAtInMinutes(5);
  assert.equal(actions.validateScheduledAt(tooSoon, 'mitake').error, 'sms_schedule_too_soon');
  const okLater = scheduledAtInMinutes(15);
  assert.equal(actions.validateScheduledAt(okLater, 'mitake').ok, true);
});

// ── smsSend：驗證錯誤 ──

test('smsSend：provider 未設定 → sms_not_configured', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, {}, 'a@x.com', { provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi' });
  assert.equal(r.error, 'sms_not_configured');
});

test('smsSend：recipients 為 0 筆 → sms_invalid_phone', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', { provider: 'mitake', recipients: [], message: 'hi' });
  assert.equal(r.error, 'sms_invalid_phone');
});

test('smsSend：recipients 超過 100 筆 → sms_invalid_phone', async () => {
  const db = openDb(':memory:');
  const recipients = Array.from({ length: 101 }, () => ({ phone: '0912345678' }));
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', { provider: 'mitake', recipients, message: 'hi' });
  assert.equal(r.error, 'sms_invalid_phone');
});

test('smsSend：手機號碼格式不合法 → sms_invalid_phone，detail 帶壞號碼', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }, { phone: 'bad-phone' }], message: 'hi',
  });
  assert.equal(r.error, 'sms_invalid_phone');
  assert.match(r.detail, /bad-phone/);
});

test('smsSend：訊息空白 → sms_empty_message', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', { provider: 'mitake', recipients: [{ phone: '0912345678' }], message: '   ' });
  assert.equal(r.error, 'sms_empty_message');
});

test('smsSend：every8d 訊息超過 333 字 → sms_message_too_long', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'a'.repeat(334),
  });
  assert.equal(r.error, 'sms_message_too_long');
});

test('smsSend：mitake 未開通長簡訊、訊息超過單則長度（161 字）→ sms_message_too_long', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig({ SMS_MITAKE_LONG: false }), 'a@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'a'.repeat(161),
  });
  assert.equal(r.error, 'sms_message_too_long');
});

test('smsSend：mitake 已開通長簡訊（SMS_MITAKE_LONG）→ 161 字不擋（放行進入實際發送流程）', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'm1', statuscode: '1', accountPoint: 90, duplicate: false }), t);
  const r = await actions.smsSend(db, fullConfig({ SMS_MITAKE_LONG: true }), 'a@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'a'.repeat(161),
  });
  assert.equal(r.ok, true);
});

test('smsSend：scheduledAt 格式錯誤 → sms_schedule_invalid', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: 'bad',
  });
  assert.equal(r.error, 'sms_schedule_invalid');
});

test('smsSend：mitake scheduledAt 太快（< 11 分鐘）→ sms_schedule_too_soon', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsSend(db, fullConfig(), 'a@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: scheduledAtInMinutes(3),
  });
  assert.equal(r.error, 'sms_schedule_too_soon');
});

// ── smsSend：成功／部分失敗／全部失敗（mitake，逐一呼叫） ──

test('smsSend：mitake 全部成功 → ok:true、寫入 DB、status=sent', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async (cfg, p) => ({
    ok: true, msgid: `m-${p.phone}`, statuscode: '1', accountPoint: 88, duplicate: false,
  }), t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake',
    recipients: [{ phone: '0912345678', name: '甲', caseId: 'C001' }, { phone: '0987654321' }],
    message: '測試訊息',
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'mitake');
  assert.equal(r.sent, 2);
  assert.equal(r.balance, 88);
  assert.equal(r.recipients.length, 2);
  assert.ok(typeof r.logId === 'number');

  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(r.logId);
  assert.equal(row.status, 'sent');
  assert.equal(row.provider, 'mitake');
  assert.equal(row.sender_email, 'sender@x.com');
  const recRows = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ?').all(r.logId);
  assert.equal(recRows.length, 2);
  assert.equal(recRows[0].case_id, 'C001');
});

test('smsSend：mitake 部分失敗（1 成功 1 失敗）→ 整批仍 ok:true、status=sent，失敗筆記失敗碼', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async (cfg, p) => {
    if (p.phone === '0912345678') return { ok: true, msgid: 'm-ok', statuscode: '1', accountPoint: 50, duplicate: false };
    return { ok: false, msgid: null, statuscode: 'e', duplicate: false };
  }, t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake',
    recipients: [{ phone: '0912345678' }, { phone: '0987654321' }],
    message: 'hi',
  });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 1);
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(r.logId);
  assert.equal(row.status, 'sent');
  const recRows = db.prepare('SELECT * FROM sms_recipients WHERE batch_id = ? ORDER BY id').all(r.logId);
  assert.equal(recRows[0].provider_msgid, 'm-ok');
  assert.equal(recRows[1].provider_msgid, null);
  assert.equal(recRows[1].status_code, 'e');
});

test('smsSend：mitake 全部失敗 → sms_provider_error、DB 落 status=failed', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: false, msgid: null, statuscode: 'e', duplicate: false }), t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  assert.equal(r.error, 'sms_provider_error');
  const row = db.prepare('SELECT * FROM sms_batches ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
});

test('smsSend：provider 呼叫拋出例外（如網路中斷）→ sms_provider_error，仍落一筆 failed 紀錄', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => { throw new Error('ECONNRESET'); }, t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  assert.equal(r.error, 'sms_provider_error');
  assert.match(r.detail, /ECONNRESET/);
  const row = db.prepare('SELECT * FROM sms_batches ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
});

// ── smsSend：every8d（整批一次呼叫） ──

test('smsSend：every8d 成功 → ok:true、DB 記錄 provider_batch_id/cost', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: true, credit: 970, sended: 2, cost: 2, unsend: 0, batchId: 'BID-1' }), t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'every8d',
    recipients: [{ phone: '0912345678' }, { phone: '0987654321' }],
    message: 'hi',
  });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 2);
  assert.equal(r.cost, 2);
  assert.equal(r.balance, 970);
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(r.logId);
  assert.equal(row.provider_batch_id, 'BID-1');
  assert.equal(row.status, 'sent');
});

test('smsSend：every8d 失敗（- 開頭）→ sms_provider_error、DB 落 failed', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: false, code: '-101', message: '密碼錯誤' }), t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  assert.equal(r.error, 'sms_provider_error');
  assert.match(r.detail, /101/);
  const row = db.prepare('SELECT * FROM sms_batches ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
});

test('smsSend：帶合法 scheduledAt → DB status=scheduled', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: true, credit: 100, sended: 0, cost: 0, unsend: 1, batchId: 'BID-2' }), t);
  const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: scheduledAtInMinutes(20),
  });
  assert.equal(r.ok, true);
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(r.logId);
  assert.equal(row.status, 'scheduled');
});

// ── smsListLog ──

test('smsListLog：分頁＋新到舊排序', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: true, credit: 100, sended: 1, cost: 1, unsend: 0, batchId: 'B' }), t);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
      provider: 'every8d', recipients: [{ phone: '0912345678' }], message: `msg${i}`,
    });
    ids.push(r.logId);
  }
  const page1 = actions.smsListLog(db, { limit: 2, offset: 0 });
  assert.equal(page1.total, 3);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.items[0].id, ids[2]); // 新到舊
  assert.equal(page1.items[1].id, ids[1]);
  assert.equal(page1.items[0].recipients.length, 1);

  const page2 = actions.smsListLog(db, { limit: 2, offset: 2 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].id, ids[0]);
});

test('smsListLog：limit 預設 20、超過上限 100 會被夾住', async () => {
  const db = openDb(':memory:');
  const r1 = actions.smsListLog(db, {});
  assert.equal(r1.total, 0);
  // 間接驗證夾住行為：帶一個超大 limit 不應丟例外
  const r2 = actions.smsListLog(db, { limit: 99999 });
  assert.equal(r2.total, 0);
});

// ── smsQueryStatus ──

test('smsQueryStatus：查無 logId → sms_log_not_found', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsQueryStatus(db, fullConfig(), { logId: 999 });
  assert.equal(r.error, 'sms_log_not_found');
});

test('smsQueryStatus：mitake 批次回寫最新狀態', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '1', accountPoint: 50, duplicate: false }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  patch(mitake, 'queryStatus', async () => ({ ok: true, items: [{ msgid: 'MID-1', statuscode: '4', statustime: '20260718130000' }] }), t);
  const r = await actions.smsQueryStatus(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.ok, true);
  assert.equal(r.batch.recipients[0].statusCode, '4');
  assert.equal(r.batch.recipients[0].statusTime, '20260718130000');
});

test('smsQueryStatus：every8d 批次以手機號碼比對回寫狀態＋花費', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: true, credit: 100, sended: 1, cost: 1, unsend: 0, batchId: 'BID-9' }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  patch(every8d, 'getDeliveryStatus', async () => ({
    ok: true, smsCount: 1, batchId: 'BID-9',
    items: [{ MOBILE: '0912345678', STATUS: 100, COST: '1', RECEIVED_TIME: '20260718130500' }],
  }), t);
  const r = await actions.smsQueryStatus(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.ok, true);
  assert.equal(r.batch.recipients[0].statusCode, '100');
  assert.equal(r.batch.recipients[0].cost, 1);
});

test('smsQueryStatus：provider 未設定 → sms_not_configured', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '1', accountPoint: 50, duplicate: false }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  const r = await actions.smsQueryStatus(db, {}, { logId: sendRes.logId });
  assert.equal(r.error, 'sms_not_configured');
});

// ── smsCancel：狀態機 ──

test('smsCancel：查無 logId → sms_log_not_found', async () => {
  const db = openDb(':memory:');
  const r = await actions.smsCancel(db, fullConfig(), { logId: 999 });
  assert.equal(r.error, 'sms_log_not_found');
});

test('smsCancel：非 scheduled 狀態 → sms_not_scheduled', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '1', accountPoint: 50, duplicate: false }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  const r = await actions.smsCancel(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.error, 'sms_not_scheduled');
});

test('smsCancel：mitake 預約批次成功取消', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '0', accountPoint: 50, duplicate: false }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: scheduledAtInMinutes(20),
  });
  patch(mitake, 'cancel', async () => ({ ok: true, items: [{ msgid: 'MID-1', statuscode: '9', canceled: true }] }), t);
  const r = await actions.smsCancel(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.ok, true);
  assert.equal(r.canceled, 1);
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(sendRes.logId);
  assert.equal(row.status, 'canceled');
});

test('smsCancel：mitake 業者拒絕取消 → sms_cancel_failed', async (t) => {
  const db = openDb(':memory:');
  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '0', accountPoint: 50, duplicate: false }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: scheduledAtInMinutes(20),
  });
  patch(mitake, 'cancel', async () => ({ ok: true, items: [{ msgid: 'MID-1', statuscode: '8', canceled: false }] }), t);
  const r = await actions.smsCancel(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.error, 'sms_cancel_failed');
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(sendRes.logId);
  assert.equal(row.status, 'scheduled'); // 未變更
});

test('smsCancel：every8d 預約批次成功取消', async (t) => {
  const db = openDb(':memory:');
  patch(every8d, 'send', async () => ({ ok: true, credit: 100, sended: 0, cost: 0, unsend: 1, batchId: 'BID-9' }), t);
  const sendRes = await actions.smsSend(db, fullConfig(), 'sender@x.com', {
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi', scheduledAt: scheduledAtInMinutes(20),
  });
  patch(every8d, 'eraseBooking', async () => ({ ok: true, deleted: 1, refunded: 1 }), t);
  const r = await actions.smsCancel(db, fullConfig(), { logId: sendRes.logId });
  assert.equal(r.ok, true);
  assert.equal(r.canceled, 1);
  const row = db.prepare('SELECT * FROM sms_batches WHERE id = ?').get(sendRes.logId);
  assert.equal(row.status, 'canceled');
});

// ── smsBalance ──

test('smsBalance：provider 未設定 → sms_not_configured', async () => {
  const r = await actions.smsBalance({}, { provider: 'mitake' });
  assert.equal(r.error, 'sms_not_configured');
});

test('smsBalance：mitake 成功', async (t) => {
  patch(mitake, 'queryBalance', async () => ({ ok: true, balance: 55 }), t);
  const r = await actions.smsBalance(fullConfig(), { provider: 'mitake' });
  assert.equal(r.balance, 55);
});

test('smsBalance：mitake 失敗 → sms_provider_error', async (t) => {
  patch(mitake, 'queryBalance', async () => ({ ok: false, statuscode: 'e' }), t);
  const r = await actions.smsBalance(fullConfig(), { provider: 'mitake' });
  assert.equal(r.error, 'sms_provider_error');
});

test('smsBalance：every8d 成功', async (t) => {
  patch(every8d, 'getCredit', async () => ({ ok: true, balance: 777 }), t);
  const r = await actions.smsBalance(fullConfig(), { provider: 'every8d' });
  assert.equal(r.balance, 777);
});

test('smsBalance：every8d 失敗 → sms_provider_error', async (t) => {
  patch(every8d, 'getCredit', async () => ({ ok: false, code: '-101', message: '密碼錯誤' }), t);
  const r = await actions.smsBalance(fullConfig(), { provider: 'every8d' });
  assert.equal(r.error, 'sms_provider_error');
});
