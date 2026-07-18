// server/test/sms-segments.test.js — src/sms/segments.js 純函式測試：GSM/UCS2 判定、
// 70/67、160/153 邊界、擴充字元（^{}\[~]|€）算 2 字。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const segments = require('../src/sms/segments');

test('estimate：純英數短訊 → GSM、1 則', () => {
  const r = segments.estimate('Hello world');
  assert.equal(r.encoding, 'GSM');
  assert.equal(r.chars, 11);
  assert.equal(r.segments, 1);
});

test('estimate：中文內容 → UCS2（即使只有一個中文字混在英數裡）', () => {
  const r = segments.estimate('Hello 諮商中心');
  assert.equal(r.encoding, 'UCS2');
});

test('estimate：GSM 單則邊界 — 剛好 160 字＝1 則，161 字＝2 則', () => {
  const s160 = 'a'.repeat(160);
  const s161 = 'a'.repeat(161);
  const r160 = segments.estimate(s160);
  const r161 = segments.estimate(s161);
  assert.equal(r160.encoding, 'GSM');
  assert.equal(r160.segments, 1);
  assert.equal(r161.segments, 2);
});

test('estimate：GSM 多則邊界 — 306(=153*2) 字＝2 則，307 字＝3 則', () => {
  const r306 = segments.estimate('a'.repeat(306));
  const r307 = segments.estimate('a'.repeat(307));
  assert.equal(r306.segments, 2);
  assert.equal(r307.segments, 3);
});

test('estimate：UCS2 單則邊界 — 剛好 70 字＝1 則，71 字＝2 則', () => {
  const s70 = '諮'.repeat(70);
  const s71 = '諮'.repeat(71);
  assert.equal(segments.estimate(s70).segments, 1);
  assert.equal(segments.estimate(s71).segments, 2);
});

test('estimate：UCS2 多則邊界 — 134(=67*2) 字＝2 則，135 字＝3 則', () => {
  assert.equal(segments.estimate('諮'.repeat(134)).segments, 2);
  assert.equal(segments.estimate('諮'.repeat(135)).segments, 3);
});

test('estimate：GSM 擴充字元（^{}\\[~]|€）每個算 2 字 — 160 個 ^ 已超過單則septet上限', () => {
  const r = segments.estimate('^'.repeat(160));
  assert.equal(r.encoding, 'GSM');
  assert.equal(r.chars, 160); // 顯示字元數仍是 160
  // 160 個擴充字元 = 320 個 septet，遠超單則 160 上限，且超過 153 的整倍數計算
  assert.equal(r.segments, Math.ceil(320 / 153));
});

test('estimate：GSM 擴充字元恰好卡在邊界 — 80 個 ^ = 160 septet，仍是 1 則', () => {
  const r = segments.estimate('^'.repeat(80));
  assert.equal(r.encoding, 'GSM');
  assert.equal(r.segments, 1);
  const r2 = segments.estimate('^'.repeat(81)); // 162 septet > 160
  assert.equal(r2.segments, 2);
});

test('estimate：空字串 → 1 則（不因除以零或空陣列出錯）', () => {
  const r = segments.estimate('');
  assert.equal(r.chars, 0);
  assert.equal(r.segments, 1);
});

test('estimate：null/undefined → 視為空字串，不丟例外', () => {
  assert.equal(segments.estimate(null).chars, 0);
  assert.equal(segments.estimate(undefined).chars, 0);
});
