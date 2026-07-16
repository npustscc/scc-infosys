// server/test/calendar-client.test.js — src/google/calendar.js 薄 REST 層單元測試。不打真實網路——
// monkey-patch 全域 fetch，驗證每個 helper 組出的 path/method/body/query string、分頁、錯誤處理
// （含在 Error 物件附上 .status，供上層依 404/410 判斷「事件已不存在」等語意）。比照
// test/gmail-client.test.js 的寫法。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const calendar = require('../src/google/calendar');

function withFetch(fakeFetch, fn) {
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = orig; });
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

// ── calendarFetch：底層 ──────────────────────────────────────────────

test('calendarFetch：非 2xx → throw 含 HTTP 狀態與訊息，且 err.status 為該狀態碼', async () => {
  await withFetch(async () => jsonRes(404, { error: { message: 'Not Found' } }), async () => {
    await assert.rejects(() => calendar.getEvent('TOK', 'cal1', 'evt1'), (err) => {
      assert.match(err.message, /HTTP 404|Not Found/);
      assert.equal(err.status, 404);
      return true;
    });
  });
});

test('calendarFetch：204 No Content（空 body）→ 回傳 {}，不 throw', async () => {
  await withFetch(async () => jsonRes(204, undefined), async () => {
    const r = await calendar.deleteEvent('TOK', 'cal1', 'evt1');
    assert.deepEqual(r, {});
  });
});

test('calendarFetch：回應不是合法 JSON → throw', async () => {
  await withFetch(async () => ({ ok: true, status: 200, text: async () => 'not json' }), async () => {
    await assert.rejects(() => calendar.getEvent('TOK', 'cal1', 'evt1'), /不是合法 JSON/);
  });
});

// ── findCalendarsByName / resolveCalendarIdByName ───────────────────

test('findCalendarsByName：分頁掃完整份 calendarList，收集所有同名相符者', async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls++;
    if (!url.includes('pageToken')) {
      assert.ok(url.includes('/users/me/calendarList'));
      return jsonRes(200, { items: [{ id: 'A', summary: 'SCC 空間預約' }, { id: 'B', summary: '別的' }], nextPageToken: 'P2' });
    }
    assert.ok(url.includes('pageToken=P2'));
    return jsonRes(200, { items: [{ id: 'C', summary: 'SCC 空間預約' }] } );
  }, async () => {
    const matches = await calendar.findCalendarsByName('TOK', 'SCC 空間預約');
    assert.deepEqual(matches.map((m) => m.id), ['A', 'C']);
    assert.equal(calls, 2);
  });
});

test('resolveCalendarIdByName：恰一筆相符 → 回傳其 id', async () => {
  await withFetch(async () => jsonRes(200, { items: [{ id: 'ONLY', summary: 'X' }] }), async () => {
    const id = await calendar.resolveCalendarIdByName('TOK', 'X');
    assert.equal(id, 'ONLY');
  });
});

test('resolveCalendarIdByName：0 筆或多筆相符 → 回傳 null（薄層不下錯誤判斷，交給呼叫端）', async () => {
  await withFetch(async () => jsonRes(200, { items: [] }), async () => {
    assert.equal(await calendar.resolveCalendarIdByName('TOK', 'X'), null);
  });
  await withFetch(async () => jsonRes(200, { items: [{ id: 'A', summary: 'X' }, { id: 'B', summary: 'X' }] }), async () => {
    assert.equal(await calendar.resolveCalendarIdByName('TOK', 'X'), null);
  });
});

// ── listEvents：分頁＋query string ───────────────────────────────────

test('listEvents：組出 singleEvents=true／timeMin／timeMax，並串接多頁 items', async () => {
  const seenUrls = [];
  await withFetch(async (url) => {
    seenUrls.push(url);
    if (!url.includes('pageToken')) return jsonRes(200, { items: [{ id: 'e1' }], nextPageToken: 'PT2' });
    return jsonRes(200, { items: [{ id: 'e2' }] });
  }, async () => {
    const items = await calendar.listEvents('TOK', 'cal-1@group.calendar.google.com', { timeMin: '2026-07-01T00:00:00+08:00', timeMax: '2026-07-02T00:00:00+08:00' });
    assert.deepEqual(items.map((e) => e.id), ['e1', 'e2']);
  });
  assert.ok(seenUrls[0].includes('singleEvents=true'));
  assert.ok(seenUrls[0].includes(encodeURIComponent('2026-07-01T00:00:00+08:00')));
  assert.ok(seenUrls[0].includes('/calendars/' + encodeURIComponent('cal-1@group.calendar.google.com') + '/events'));
  assert.ok(seenUrls[1].includes('pageToken=PT2'));
});

// ── insertEvent / patchEvent / deleteEvent ───────────────────────────

test('insertEvent：POST /calendars/{id}/events，body 為傳入的 resource', async () => {
  let seenUrl, seenMethod, seenBody;
  await withFetch(async (url, opts) => {
    seenUrl = url; seenMethod = opts.method; seenBody = JSON.parse(opts.body);
    return jsonRes(200, { id: 'NEW_EVT' });
  }, async () => {
    const r = await calendar.insertEvent('TOK', 'CAL', { summary: 'title' });
    assert.equal(r.id, 'NEW_EVT');
  });
  assert.equal(seenMethod, 'POST');
  assert.ok(seenUrl.endsWith('/calendars/CAL/events'));
  assert.deepEqual(seenBody, { summary: 'title' });
});

test('patchEvent：PATCH /calendars/{id}/events/{eventId}，calendarId／eventId 皆做 URI 編碼', async () => {
  let seenUrl, seenMethod;
  await withFetch(async (url, opts) => { seenUrl = url; seenMethod = opts.method; return jsonRes(200, { id: 'e1' }); }, async () => {
    await calendar.patchEvent('TOK', 'a@b.com', 'evt/1', { summary: 'x' });
  });
  assert.equal(seenMethod, 'PATCH');
  assert.ok(seenUrl.includes(encodeURIComponent('a@b.com')));
  assert.ok(seenUrl.includes(encodeURIComponent('evt/1')));
});

test('deleteEvent：DELETE /calendars/{id}/events/{eventId}', async () => {
  let seenMethod;
  await withFetch(async (_url, opts) => { seenMethod = opts.method; return jsonRes(204, undefined); }, async () => {
    await calendar.deleteEvent('TOK', 'CAL', 'evt1');
  });
  assert.equal(seenMethod, 'DELETE');
});

// ── acl ───────────────────────────────────────────────────────────

test('aclInsert：POST /calendars/{id}/acl', async () => {
  let seenUrl, seenMethod, seenBody;
  await withFetch(async (url, opts) => { seenUrl = url; seenMethod = opts.method; seenBody = JSON.parse(opts.body); return jsonRes(200, {}); }, async () => {
    await calendar.aclInsert('TOK', 'CAL', { role: 'owner', scope: { type: 'user', value: 'a@x.com' } });
  });
  assert.equal(seenMethod, 'POST');
  assert.ok(seenUrl.endsWith('/calendars/CAL/acl'));
  assert.deepEqual(seenBody, { role: 'owner', scope: { type: 'user', value: 'a@x.com' } });
});

test('aclUpdate：PUT /calendars/{id}/acl/{ruleId}', async () => {
  let seenUrl, seenMethod;
  await withFetch(async (url, opts) => { seenUrl = url; seenMethod = opts.method; return jsonRes(200, {}); }, async () => {
    await calendar.aclUpdate('TOK', 'CAL', 'user:a@x.com', { role: 'owner' });
  });
  assert.equal(seenMethod, 'PUT');
  assert.ok(seenUrl.includes(encodeURIComponent('user:a@x.com')));
});

test('aclDelete：DELETE /calendars/{id}/acl/{ruleId}', async () => {
  let seenMethod;
  await withFetch(async (_url, opts) => { seenMethod = opts.method; return jsonRes(204, undefined); }, async () => {
    await calendar.aclDelete('TOK', 'CAL', 'user:a@x.com');
  });
  assert.equal(seenMethod, 'DELETE');
});
