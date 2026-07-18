// server/test/sms-every8d.test.js — src/sms/every8d.js 回應解析測試。全部透過 opts.fetchImpl
// 注入假 fetch，不打真實的 Every8D 伺服器。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const every8d = require('../src/sms/every8d');

const CFG = { host: 'api.e8d.tw', uid: 'u', pwd: 'p' };

function fakeFetch(responseText) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { text: async () => responseText };
  };
  fn.calls = calls;
  return fn;
}

test('send：成功回應 CSV（CREDIT,SENDED,COST,UNSEND,BATCHID）解析', async () => {
  const fetchImpl = fakeFetch('970.5,2,2.5,0,ABCD-1234-EFGH-5678');
  const res = await every8d.send(CFG, { phones: ['0912345678', '0987654321'], message: 'hi', scheduledAt: '' }, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.credit, 970.5);
  assert.equal(res.sended, 2);
  assert.equal(res.cost, 2.5);
  assert.equal(res.unsend, 0);
  assert.equal(res.batchId, 'ABCD-1234-EFGH-5678');
  assert.match(fetchImpl.calls[0].url, /\/API21\/HTTP\/sendSMS\.ashx$/);
  const params = new URLSearchParams(fetchImpl.calls[0].opts.body);
  assert.equal(params.get('DEST'), '0912345678,0987654321');
  assert.equal(params.get('SB'), '');
});

test('send：失敗回應（- 開頭）解析為 code/message', async () => {
  const fetchImpl = fakeFetch('-101,密碼錯誤');
  const res = await every8d.send(CFG, { phones: ['0912345678'], message: 'hi' }, { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, '-101');
  assert.equal(res.message, '密碼錯誤');
});

test('send：失敗回應無逗號（只有代碼）仍可解析，message 為 null', async () => {
  const fetchImpl = fakeFetch('-99');
  const res = await every8d.send(CFG, { phones: ['0912345678'], message: 'hi' }, { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, '-99');
  assert.equal(res.message, null);
});

test('getCredit：成功回應純文字餘額', async () => {
  const fetchImpl = fakeFetch('1000.00');
  const res = await every8d.getCredit(CFG, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.balance, 1000);
});

test('getCredit：失敗回應', async () => {
  const fetchImpl = fakeFetch('-101,密碼錯誤');
  const res = await every8d.getCredit(CFG, { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, '-101');
});

test('getDeliveryStatus：成功回應 JSON（SMS_COUNT/BID/DATA）解析', async () => {
  const json = JSON.stringify({
    SMS_COUNT: 2,
    BID: 'ABCD-1234',
    DATA: [
      { NAME: '', MOBILE: '0912345678', SEND_TIME: '20260718120000', COST: '1', STATUS: 100, RECEIVED_TIME: '20260718120010' },
      { NAME: '', MOBILE: '0987654321', SEND_TIME: '20260718120000', COST: '1', STATUS: 103, RECEIVED_TIME: '' },
    ],
  });
  const fetchImpl = fakeFetch(json);
  const res = await every8d.getDeliveryStatus(CFG, 'ABCD-1234', { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.smsCount, 2);
  assert.equal(res.batchId, 'ABCD-1234');
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].STATUS, 100);
  const params = new URLSearchParams(fetchImpl.calls[0].opts.body);
  assert.equal(params.get('RESPFORMAT'), '1');
  assert.equal(params.get('PNO'), '1');
});

test('getDeliveryStatus：非合法 JSON → ok:false、code:parse_error', async () => {
  const fetchImpl = fakeFetch('not json');
  const res = await every8d.getDeliveryStatus(CFG, 'ABCD-1234', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'parse_error');
});

test('getDeliveryStatus：- 開頭失敗回應', async () => {
  const fetchImpl = fakeFetch('-201,查無此批次');
  const res = await every8d.getDeliveryStatus(CFG, 'nope', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, '-201');
});

test('eraseBooking：成功回應「刪除筆數,回補點數」解析', async () => {
  const fetchImpl = fakeFetch('2,5');
  const res = await every8d.eraseBooking(CFG, 'ABCD-1234', { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.deleted, 2);
  assert.equal(res.refunded, 5);
});

test('eraseBooking：失敗回應', async () => {
  const fetchImpl = fakeFetch('-303,已無法取消');
  const res = await every8d.eraseBooking(CFG, 'ABCD-1234', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, '-303');
});

test('drStatusText：已知代碼回中文說明，負數視為呼叫層級錯誤，未知正代碼回可讀 fallback', () => {
  assert.equal(every8d.drStatusText(100), '已送達手機');
  assert.equal(every8d.drStatusText('100'), '已送達手機');
  assert.match(every8d.drStatusText(-5), /呼叫層級錯誤/);
  assert.match(every8d.drStatusText(999), /未知狀態代碼/);
  assert.equal(every8d.drStatusText(null), null);
});
