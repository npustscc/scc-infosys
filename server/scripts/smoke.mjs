#!/usr/bin/env node
// smoke.mjs — VM 端 16 項 curl 冒煙（Node fetch 版；放在 server/ 目錄下執行）。
// 11-15：Phase 1.5 五個厚 commit action（casesUpsert/attendanceCommit/bookingsCommit/listCommit/notifCommit）。
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8787';
const ROOT = process.env.ROOT_FOLDER_ID || '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';
const EMAIL = 'dev@scc.local';
const PASSWORD = 'devpass123';
const seedInfo = JSON.parse(fs.readFileSync(new URL('../data/seed-info.json', import.meta.url)));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  ←  ${String(detail).slice(0, 300)}`); }
}
async function call(payload) {
  const res = await fetch(BASE + '/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }),
  });
  return res.json();
}

// 1. health
const h = await fetch(BASE + '/');
check('1 health GET /', h.ok, h.status);

// 2. ping 無 token → Session expired
let r = await call({ action: 'ping', rootFolderId: ROOT });
check('2 ping 無 token → Session expired', r.success === true && r.data?.error === 'Session expired', JSON.stringify(r));

// 3. 錯密碼 → invalid_credentials
r = await call({ action: 'sessionStart', rootFolderId: ROOT, email: EMAIL, password: 'wrong-password', ua: 'smoke' });
check('3 錯密碼 → invalid_credentials', r.data?.error === 'invalid_credentials', JSON.stringify(r));

// 4. 正確登入 → token＋exp=台北午夜
r = await call({ action: 'sessionStart', rootFolderId: ROOT, email: EMAIL, password: PASSWORD, ua: 'smoke' });
const token = r.data?.sessionToken;
check('4a 登入成功取得 token', !!token, JSON.stringify(r));
const exp = r.data?.exp;
const expStr = exp ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(exp * 1000)) : 'n/a';
check('4b exp=台北午夜且在未來', exp * 1000 > Date.now() && expStr === '00:00:00', `exp=${exp} (台北 ${expStr})`);

// 5. 帶 token ping
r = await call({ action: 'ping', rootFolderId: ROOT, sessionToken: token });
check('5 帶 token ping', r.success === true && !r.data?.error, JSON.stringify(r));

// 6. updateJson + readJson roundtrip
await call({ action: 'updateJson', rootFolderId: ROOT, sessionToken: token, path: 'smoke-roundtrip.json', content: { hello: 'vm', n: 42 } });
r = await call({ action: 'readJson', rootFolderId: ROOT, sessionToken: token, path: 'smoke-roundtrip.json' });
const rt = r.data?.n === 42 || r.data?.content?.n === 42;
check('6 readJson/updateJson roundtrip', rt, JSON.stringify(r));

// 7. root 外 fileId → Forbidden
r = await call({ action: 'readJsonById', rootFolderId: ROOT, sessionToken: token, fileId: seedInfo.outsideId });
check('7 root 外 id → Forbidden', JSON.stringify(r).includes('Forbidden'), JSON.stringify(r));

// 8. listFolder
r = await call({ action: 'listFolder', rootFolderId: ROOT, sessionToken: token, folderId: ROOT });
check('8 listFolder root', r.success === true && !r.data?.error, JSON.stringify(r).slice(0, 200));

// 9. query
r = await call({ action: 'query', rootFolderId: ROOT, sessionToken: token, q: `'${ROOT}' in parents and trashed = false` });
check('9 query in parents', r.success === true && !r.data?.error, JSON.stringify(r).slice(0, 200));

// 10. startupBatch
r = await call({ action: 'startupBatch', rootFolderId: ROOT, sessionToken: token, userEmail: EMAIL });
check('10 startupBatch config/usersFolderId 齊全', !!(r.data?.config && r.data?.usersFolderId), JSON.stringify(r).slice(0, 300));

// 11. casesUpsert（Phase 1.5：厚 commit action，不整檔覆寫）
await call({ action: 'casesUpsert', rootFolderId: ROOT, sessionToken: token, path: 'smoke-cases.json', upserts: [{ id: 'C1', name: 'demo1' }] });
r = await call({ action: 'casesUpsert', rootFolderId: ROOT, sessionToken: token, path: 'smoke-cases.json', upserts: [{ id: 'C2', name: 'demo2' }] });
check('11 casesUpsert 累加不覆寫（count=2）', r.data?.ok === true && r.data?.count === 2, JSON.stringify(r));

// 12. attendanceCommit（fail-closed／不整檔覆寫打卡）
r = await call({ action: 'attendanceCommit', rootFolderId: ROOT, sessionToken: token, upserts: [{ id: 'P1', type: 'punch', email: EMAIL, name: 'smoke', date: '2026-07-15', timestamp: new Date().toISOString() }] });
check('12 attendanceCommit 新增打卡成功', r.data?.ok === true && r.data?.count === 1, JSON.stringify(r));

// 13. bookingsCommit（撞房應回 conflict，不寫入）
await call({ action: 'bookingsCommit', rootFolderId: ROOT, sessionToken: token, ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2099-01-01', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: EMAIL }] } }] });
r = await call({ action: 'bookingsCommit', rootFolderId: ROOT, sessionToken: token, checkConflicts: true, ops: [{ op: 'upsert', booking: { id: 'BK2', date: '2099-01-01', startTime: '09:30', endTime: '10:30', room: '玉山', counselors: [{ value: 'other@x.com' }] } }] });
check('13 bookingsCommit 撞房 → error:conflict，不寫入', r.data?.error === 'conflict' && r.data?.conflictType === 'room', JSON.stringify(r));

// 14. listCommit（append-only 白名單檔）
r = await call({ action: 'listCommit', rootFolderId: ROOT, sessionToken: token, file: 'audit_log.json', upserts: [{ msg: 'smoke' }] });
check('14 listCommit append-only 寫入成功', r.data?.ok === true && Array.isArray(r.data?.data?.logs), JSON.stringify(r));

// 15. notifCommit（push 通知，只回傳被觸及的 email）
r = await call({ action: 'notifCommit', rootFolderId: ROOT, sessionToken: token, ops: [{ op: 'push', email: EMAIL, notif: { id: 'N1', msg: 'smoke' } }] });
check('15 notifCommit push 成功', r.data?.ok === true && Array.isArray(r.data?.touched?.[EMAIL]), JSON.stringify(r));

// 16. logout 後舊 token 失效
// 註銷語意與 GAS 1:1：iat < revoked_before（嚴格、秒精度）——同一秒內登入＋登出 token 仍活，
// 故先等過秒界再登出（真實使用不可能同秒登入登出）。
await new Promise((res) => setTimeout(res, 1100));
await call({ action: 'sessionLogout', rootFolderId: ROOT, sessionToken: token });
r = await call({ action: 'ping', rootFolderId: ROOT, sessionToken: token });
check('16 logout 後舊 token → Session expired', r.data?.error === 'Session expired', JSON.stringify(r));

console.log(`\n=== 冒煙結果：${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
