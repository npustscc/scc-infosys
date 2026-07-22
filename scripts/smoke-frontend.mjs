#!/usr/bin/env node
// 前端載入冒煙檢查（拆檔系列的自動眼驗輔助）：用系統 Edge/Chrome 無頭模式實際載入
// 測試版（或指定 URL）頁面，收集載入期未捕捉例外（SyntaxError/TDZ/ReferenceError 會在此
// 現形＝拆檔最大風險類型），並逐一驗證每個拆出檔的哨兵函式已定義於全域——等於機器代勞
// 「開頁面看 console 有沒有紅字」的第一層眼驗。
//
// 用法：
//   node scripts/smoke-frontend.mjs                    # 預設打測試版 http://192.168.100.123:8788/
//   node scripts/smoke-frontend.mjs http://192.168.100.123:8787/   # 指定 URL（如正式版）
//
// 零依賴：Node 21+ 內建 WebSocket ＋ Chrome DevTools Protocol，不需安裝 puppeteer
// （Google Drive 同步資料夾下 npm install 會 TAR_ENTRY_ERROR，故刻意不走 npm 套件）。
'use strict';

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_TARGET = process.argv[2] || 'http://192.168.100.123:8788/';

// 各拆出檔的哨兵：載入成功＝這些全域識別字存在且型別正確
const SENTINELS = [
  ['utils.js', 'escHtml', 'function'],
  ['utils.js', 'currentSemesterPrefix', 'function'],
  ['ft-core.js', '_ftCurrentSheet', 'function'],
  ['case-detail.js', 'showCaseDetail', 'function'],
  ['case-import.js', 'finalizeImport', 'function'],
  ['initial-interview.js', 'printInitialInterview', 'function'],
  ['psych-import.js', 'renderRecycleBin', 'function'],
  ['grad-eval.js', 'renderTransferPage', 'function'],
  ['closure-eval.js', '_closureDraftKey', 'function'],
  ['event-records.js', 'renderTodosPage', 'function'],
  ['draft-engine.js', '_cloudDraftDiff', 'function'],
  ['draft-engine.js', '_gdStartAutosave', 'function'],
  ['record-form.js', 'saveRecord', 'function'],
  ['mental-leave.js', 'openMlAssessmentModal', 'function'],
  ['openmail.js', 'openOmCompose', 'function'],
  ['ft-ui.js', '_ftEnterEdit', 'function'],
  ['sms.js', '_smsRefreshBalance', 'function'],
  ['issues-ui.js', 'submitIssue', 'function'],
  ['hints.js', 'TC_HINTS', 'object'],
  ['changelog.js', 'CHANGELOG_ENTRIES', 'object'],
  ['index.html 主 script', 'proxyCall', 'function'],
  ['index.html 主 script', 'showToast', 'function'],
];

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) { console.error('找不到 Edge/Chrome，無法冒煙'); process.exit(2); }

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-smoke-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

function cleanup(code) {
  try { child.kill(); } catch (_) {}
  setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {} process.exit(code); }, 500);
}

// 等 stderr 吐出 DevTools listening on ws://...
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('等不到 DevTools websocket（10s）')), 10000);
  child.stderr.on('data', (d) => {
    buf += d.toString();
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
  child.on('exit', () => reject(new Error('瀏覽器提前退出')));
}).catch((e) => { console.error(e.message); cleanup(2); });

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const events = [];
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};
await new Promise((r) => { ws.onopen = r; });

// 開新分頁並 attach（flat session）
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);

const loaded = new Promise((r) => {
  const iv = setInterval(() => {
    if (events.some((e) => e.method === 'Page.loadEventFired' && e.sessionId === sessionId)) { clearInterval(iv); r(); }
  }, 100);
  setTimeout(() => { clearInterval(iv); r(); }, 20000); // 20s 保底
});
console.log(`→ 載入 ${URL_TARGET}（${path.basename(exe)} headless）`);
await send('Page.navigate', { url: URL_TARGET }, sessionId);
await loaded;
await new Promise((r) => setTimeout(r, 3000)); // 讓載入後的非同步初始化跑一下

// 收集：未捕捉例外（最重要）＋ console.error ＋ 資源載入失敗
const exceptions = [];
const consoleErrors = [];
const netErrors = [];
for (const e of events) {
  if (e.sessionId !== sessionId) continue;
  if (e.method === 'Runtime.exceptionThrown') {
    const d = e.params.exceptionDetails;
    exceptions.push(`${d.text || ''} ${d.exception?.description || ''}`.trim().slice(0, 300));
  } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
    consoleErrors.push(e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
    const t = e.params.entry;
    (t.source === 'network' ? netErrors : consoleErrors).push(`[${t.source}] ${t.text}`.slice(0, 300));
  }
}

// 哨兵檢查
// 注意：頂層 const/let 是全域詞法綁定、不掛 globalThis，必須用字面 typeof 檢查
const typeofArr = '[' + SENTINELS.map(([, name]) => `typeof ${name}`).join(',') + ']';
const expr = `JSON.stringify((${typeofArr}).map((actual, i) => {
  const [f, name, kind] = ${JSON.stringify(SENTINELS)}[i];
  return { f, name, kind, actual, ok: actual === kind };
}))`;
const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
const sentinelResults = JSON.parse(result.value);

// 頁面有渲染出登入畫面嗎（粗略：body 有內容且含「登入」字樣）
const { result: bodyRes } = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ len: document.body.innerHTML.length, hasLogin: /登入/.test(document.body.innerText) })`,
  returnByValue: true,
}, sessionId);
const body = JSON.parse(bodyRes.value);

console.log('\n═══ 冒煙結果 ═══');
console.log(`頁面渲染：body ${body.len} chars，${body.hasLogin ? '含' : '不含'}「登入」字樣`);
const badSentinels = sentinelResults.filter((s) => !s.ok);
console.log(`哨兵檢查：${sentinelResults.length - badSentinels.length}/${sentinelResults.length} 通過`);
for (const s of badSentinels) console.log(`  ✖ ${s.f} → ${s.name} 應為 ${s.kind}，實際 ${s.actual}`);
console.log(`未捕捉例外：${exceptions.length} 筆`);
exceptions.forEach((x) => console.log(`  ✖ ${x}`));
console.log(`console.error：${consoleErrors.length} 筆`);
consoleErrors.forEach((x) => console.log(`  ⚠ ${x}`));
console.log(`資源載入失敗：${netErrors.length} 筆（外部 CDN/追蹤在無網環境屬預期）`);
netErrors.forEach((x) => console.log(`  ・ ${x}`));

const fail = exceptions.length > 0 || badSentinels.length > 0 || !body.hasLogin;
console.log(fail ? '\n❌ 冒煙未通過' : '\n✅ 冒煙通過：所有拆出檔載入正常、無未捕捉例外、登入頁有渲染');
cleanup(fail ? 1 : 0);
