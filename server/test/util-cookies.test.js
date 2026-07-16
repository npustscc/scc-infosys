// server/test/util-cookies.test.js — Cookie header 解析／Set-Cookie 組字串純函式測試。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseCookieHeader, buildSetCookieHeader } = require('../src/util/cookies');

test('parseCookieHeader：多個 cookie 以 "; " 分隔，正確拆成 key/value', () => {
  const out = parseCookieHeader('a=1; b=2; scc_device_ROOT=abc.def');
  assert.deepEqual(out, { a: '1', b: '2', scc_device_ROOT: 'abc.def' });
});

test('parseCookieHeader：空字串／undefined／無效格式 → 空物件（不拋例外）', () => {
  assert.deepEqual(parseCookieHeader(''), {});
  assert.deepEqual(parseCookieHeader(undefined), {});
  assert.deepEqual(parseCookieHeader('garbage-no-equals'), {});
});

test('parseCookieHeader：值可含 "." 等 base64url 字元', () => {
  const out = parseCookieHeader('scc_device_X=aBc123_-.dEf456_-');
  assert.equal(out.scc_device_X, 'aBc123_-.dEf456_-');
});

test('buildSetCookieHeader：含 HttpOnly／SameSite=Strict／Max-Age／Path=/，不含 Secure', () => {
  const h = buildSetCookieHeader('scc_device_X', 'idA.tokB', 30 * 24 * 3600);
  assert.match(h, /^scc_device_X=idA\.tokB; HttpOnly; SameSite=Strict; Max-Age=2592000; Path=\/$/);
  assert.ok(!/Secure/.test(h), '區網 http 部署不可加 Secure，否則瀏覽器會丟棄整個 cookie');
});

test('buildSetCookieHeader：Max-Age 四捨五入為整數秒', () => {
  const h = buildSetCookieHeader('n', 'v', 100.6);
  assert.match(h, /Max-Age=101/);
});
