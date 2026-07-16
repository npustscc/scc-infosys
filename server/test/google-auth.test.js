// server/test/google-auth.test.js — src/google/auth.js 單元測試：憑證檔讀取／refresh_token
// 交換／記憶體快取。不打真實網路——monkey-patch 全域 fetch。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../src/google/auth');

function withFetch(fakeFetch, fn) {
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = orig; });
}

function tmpCredsFile(content) {
  const p = path.join(os.tmpdir(), 'scc-test-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

// ── loadCreds ────────────────────────────────────────────────────────

test('loadCreds：合法憑證檔 → 回傳 { client_id, client_secret, refresh_token }', () => {
  const p = tmpCredsFile({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
  try {
    const creds = auth.loadCreds(p);
    assert.deepEqual(creds, { client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
  } finally {
    fs.unlinkSync(p);
  }
});

test('loadCreds：檔案不存在 → throw 含路徑的錯誤', () => {
  assert.throws(() => auth.loadCreds('/no/such/file/creds.json'), /讀取憑證檔失敗/);
});

test('loadCreds：內容不是合法 JSON → throw', () => {
  const p = tmpCredsFile('{not json');
  try {
    assert.throws(() => auth.loadCreds(p), /不是合法 JSON/);
  } finally {
    fs.unlinkSync(p);
  }
});

test('loadCreds：缺 refresh_token 欄位 → throw 格式不符', () => {
  const p = tmpCredsFile({ client_id: 'cid', client_secret: 'cs' });
  try {
    assert.throws(() => auth.loadCreds(p), /格式不符/);
  } finally {
    fs.unlinkSync(p);
  }
});

// ── tokenFromRefresh ─────────────────────────────────────────────────

test('tokenFromRefresh：成功 → 回傳 { accessToken, expiresIn }', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, auth.TOKEN_URI);
    assert.equal(opts.method, 'POST');
    const body = String(opts.body);
    assert.ok(body.includes('refresh_token=rt'));
    assert.ok(body.includes('grant_type=refresh_token'));
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'AT123', expires_in: 1800 }),
    };
  }, async () => {
    const r = await auth.tokenFromRefresh({ client_id: 'cid', client_secret: 'cs' }, 'rt');
    assert.deepEqual(r, { accessToken: 'AT123', expiresIn: 1800 });
  });
});

test('tokenFromRefresh：缺 expires_in → 預設 3600 秒', async () => {
  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT' }) }), async () => {
    const r = await auth.tokenFromRefresh({ client_id: 'c', client_secret: 's' }, 'rt');
    assert.equal(r.expiresIn, 3600);
  });
});

test('tokenFromRefresh：HTTP 非 2xx → throw（不外洩回應內容）', async () => {
  await withFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', secret: 'leaked?' }) }), async () => {
    await assert.rejects(
      () => auth.tokenFromRefresh({ client_id: 'c', client_secret: 's' }, 'bad'),
      (err) => {
        assert.match(err.message, /HTTP 400/);
        assert.ok(!err.message.includes('leaked?'), '錯誤訊息不可包含回應內容');
        return true;
      }
    );
  });
});

test('tokenFromRefresh：回應缺 access_token → throw 格式異常', async () => {
  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }), async () => {
    await assert.rejects(() => auth.tokenFromRefresh({ client_id: 'c', client_secret: 's' }, 'rt'), /缺 access_token/);
  });
});

// ── createTokenCache ─────────────────────────────────────────────────

test('createTokenCache：短時間內重複呼叫只打一次 token endpoint（快取命中）', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ access_token: 'AT-' + calls, expires_in: 3600 }) };
  }, async () => {
    const cache = auth.createTokenCache({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
    const a = await cache.getAccessToken();
    const b = await cache.getAccessToken();
    assert.equal(a, 'AT-1');
    assert.equal(b, 'AT-1', '第二次呼叫應命中快取，不重新交換');
    assert.equal(calls, 1);
  });
});

test('createTokenCache：快取過期（expires_in 極短）→ 下次呼叫重新交換', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    // expires_in 給負值，模擬「已過期」（提前 5 分鐘緩衝下必定視為過期）。
    return { ok: true, status: 200, json: async () => ({ access_token: 'AT-' + calls, expires_in: -1 }) };
  }, async () => {
    const cache = auth.createTokenCache({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
    const a = await cache.getAccessToken();
    const b = await cache.getAccessToken();
    assert.equal(a, 'AT-1');
    assert.equal(b, 'AT-2', '過期後應重新交換');
    assert.equal(calls, 2);
  });
});
