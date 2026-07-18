// server/test/sms-mitake.test.js — src/sms/mitake.js 回應解析測試。全部透過 opts.fetchImpl 注入
// 假 fetch，不打真實的三竹伺服器（比照任務指示的「Provider 模組支援注入 fetch 供測試」設計）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const mitake = require('../src/sms/mitake');

const CFG = { host: 'smsapi.mitake.com.tw', basePath: '/api/mtk', username: 'u', password: 'p' };

function fakeFetch(responseText) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { text: async () => responseText };
  };
  fn.calls = calls;
  return fn;
}

test('sendSingle：成功回應（statuscode=4 已送達手機）→ ok:true、取得 msgid/accountPoint', async () => {
  const text = '[abc-123]\nmsgid=20260718000001\nstatuscode=4\nAccountPoint=98\nDuplicate=false';
  const fetchImpl = fakeFetch(text);
  const res = await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hello' }, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.msgid, '20260718000001');
  assert.equal(res.statuscode, '4');
  assert.equal(res.accountPoint, 98);
  assert.equal(res.duplicate, false);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /\/SmSend\?CharsetURL=UTF8$/);
  assert.equal(fetchImpl.calls[0].opts.method, 'POST');
});

test('sendSingle：呼叫失敗（statuscode=e 帳密錯）→ ok:false、無 msgid', async () => {
  const text = '[abc-124]\nstatuscode=e';
  const fetchImpl = fakeFetch(text);
  const res = await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi' }, { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.msgid, null);
  assert.equal(res.statuscode, 'e');
  assert.equal(res.statusText, mitake.statusText('e'));
});

test('sendSingle：Duplicate=true 時仍解析為布林值', async () => {
  const text = '[abc-125]\nmsgid=1\nstatuscode=1\nDuplicate=true';
  const fetchImpl = fakeFetch(text);
  const res = await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi' }, { fetchImpl });
  assert.equal(res.duplicate, true);
});

test('sendSingle：clientid 未提供時自動產生（≤36 字），提供時沿用（截斷至 36 字）', async () => {
  const fetchImpl = fakeFetch('[x]\nmsgid=1\nstatuscode=1');
  const res1 = await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi' }, { fetchImpl });
  assert.ok(res1.clientId.length <= 36);
  const longId = 'x'.repeat(50);
  const res2 = await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi', clientId: longId }, { fetchImpl });
  assert.equal(res2.clientId, longId.slice(0, 36));
});

test('sendSingle：smbody 換行以 ASCII 6 取代（不是 LF/CR）', async () => {
  const fetchImpl = fakeFetch('[x]\nmsgid=1\nstatuscode=1');
  await mitake.sendSingle(CFG, { phone: '0912345678', message: 'line1\nline2' }, { fetchImpl });
  const body = fetchImpl.calls[0].opts.body;
  const params = new URLSearchParams(body);
  assert.equal(params.get('smbody'), 'line1' + String.fromCharCode(6) + 'line2');
});

test('sendSingle：有 scheduledAt 時帶 dlvtime，未帶時不出現該參數', async () => {
  const fetchImpl = fakeFetch('[x]\nmsgid=1\nstatuscode=0');
  await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi', scheduledAt: '20260101120000' }, { fetchImpl });
  const params1 = new URLSearchParams(fetchImpl.calls[0].opts.body);
  assert.equal(params1.get('dlvtime'), '20260101120000');

  const fetchImpl2 = fakeFetch('[x]\nmsgid=1\nstatuscode=0');
  await mitake.sendSingle(CFG, { phone: '0912345678', message: 'hi' }, { fetchImpl: fetchImpl2 });
  const params2 = new URLSearchParams(fetchImpl2.calls[0].opts.body);
  assert.equal(params2.has('dlvtime'), false);
});

test('queryBalance：成功回應 AccountPoint', async () => {
  const fetchImpl = fakeFetch('AccountPoint=110');
  const res = await mitake.queryBalance(CFG, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.balance, 110);
});

test('queryBalance：帳密錯誤（無 AccountPoint）→ ok:false', async () => {
  const fetchImpl = fakeFetch('statuscode=e');
  const res = await mitake.queryBalance(CFG, { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.statuscode, 'e');
});

test('queryStatus：Tab 分隔多筆狀態解析', async () => {
  const text = '20260718000001\t4\t20260718120000\n20260718000002\t6\t20260718120005';
  const fetchImpl = fakeFetch(text);
  const res = await mitake.queryStatus(CFG, ['20260718000001', '20260718000002'], { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items[0], { msgid: '20260718000001', statuscode: '4', statustime: '20260718120000' });
  assert.deepEqual(res.items[1], { msgid: '20260718000002', statuscode: '6', statustime: '20260718120005' });
});

test('queryStatus：msgid 陣列以逗號串接送出，最多截斷 100 筆', async () => {
  const fetchImpl = fakeFetch('');
  const many = Array.from({ length: 150 }, (_, i) => `id${i}`);
  await mitake.queryStatus(CFG, many, { fetchImpl });
  const params = new URLSearchParams(fetchImpl.calls[0].opts.body);
  const sent = params.get('msgid').split(',');
  assert.equal(sent.length, 100);
  assert.equal(sent[0], 'id0');
});

test('cancel：狀態 9 視為取消成功，其餘視為未成功', async () => {
  const text = '20260718000001=9\n20260718000002=8';
  const fetchImpl = fakeFetch(text);
  const res = await mitake.cancel(CFG, ['20260718000001', '20260718000002'], { fetchImpl });
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].canceled, true);
  assert.equal(res.items[1].canceled, false);
});

test('statusText：已知代碼回中文說明，未知代碼回可讀 fallback（不丟例外）', () => {
  assert.equal(mitake.statusText('4'), '已送達手機');
  assert.equal(mitake.statusText('e'), '帳號或密碼錯誤');
  assert.match(mitake.statusText('Z'), /未知狀態代碼/);
  assert.equal(mitake.statusText(null), null);
});

test('isCallAccepted：單一數字代碼視為呼叫成功，英數符號代碼視為失敗', () => {
  assert.equal(mitake.isCallAccepted('0'), true);
  assert.equal(mitake.isCallAccepted('4'), true);
  assert.equal(mitake.isCallAccepted('e'), false);
  assert.equal(mitake.isCallAccepted('*'), false);
  assert.equal(mitake.isCallAccepted(null), false);
});
