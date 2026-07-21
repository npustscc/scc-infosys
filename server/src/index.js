// server/src/index.js — POST /exec（wire contract 相容 GAS doPost）＋GET /（health）＋
// 靜態供應 public/（同源前端副本，見 scripts/build-public.js／CORS 測試法）。
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URLSearchParams } = require('node:url');

const config = require('./config');
const { openDb } = require('./db');
const { handleRequest } = require('./dispatch');
const cookies = require('./util/cookies');
const sse = require('./sse');

const db = openDb(config.DB_PATH);

// 信任裝置憑證 cookie 名稱以 ROOT_FOLDER_ID 命名空間化（比照前端 localStorage 的
// scc_session_<ROOT_FOLDER_ID> 慣例）：cookie 不像 fetch 那樣自然依 port 隔離，若 dev/prod
// 兩個 Node 實例跑在同一主機的不同 port，不加此命名空間會讓兩邊互相覆蓋彼此的 cookie
// （後果僅止於「裝置憑證失效、退回要求 TOTP」，不是安全漏洞，但仍應避免這種 UX 劣化）。
const DEVICE_COOKIE_NAME = `scc_device_${config.ROOT_FOLDER_ID}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // 25MB：uploadFile 走 base64 承載附件（v200，見 actions/attachments.js），單檔上限另訂 20MB
    // （decode 後位元組數，base64 膨脹係數約 4/3），此處為整個 HTTP body 的總限，留有餘裕；
    // 一般 JSON 請求遠小於此。
    const LIMIT = 25 * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > LIMIT) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// wire contract：application/x-www-form-urlencoded 單欄位 payload（前端 proxyCall 送法）；
// 也接受 application/json 方便 curl 冒煙測試——body 可以是 {"payload":"...json字串..."} 或
// 直接就是 payload 物件本身（{"action":"ping",...}）兩種寫法皆可。
function parsePayload(rawBody, contentType) {
  if (contentType && contentType.includes('application/json')) {
    const parsed = JSON.parse(rawBody || '{}');
    if (typeof parsed.payload === 'string') return JSON.parse(parsed.payload);
    if (parsed.payload && typeof parsed.payload === 'object') return parsed.payload;
    return parsed;
  }
  const params = new URLSearchParams(rawBody || '');
  const payloadStr = params.get('payload');
  if (!payloadStr) throw new Error('Missing payload field');
  return JSON.parse(payloadStr);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.join(config.PUBLIC_DIR, path.normalize(rel).replace(/^([.]{2}[/\\])+/, ''));
  if (!filePath.startsWith(config.PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS：token 在 body 非 cookie，允許任意來源（前端固定跑在 GitHub Pages / 同源 VM，此處
  // 沿用 GAS 版策略——安全邊界在後端授權閘，不靠 CORS）。urlencoded payload 無 preflight。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const urlPath = (req.url || '/').split('?')[0];

  // dev-login.html 獨立於 public/（該目錄是 dev/index.html 的 build 產物、已 gitignore）之外，
  // 直接從 server/ 根目錄供應，即使還沒跑 build-public 也能用（見「CORS／前端測試法」的
  // dev-login 注入技巧：同源表單打 sessionStart → token 寫進 localStorage → 跳轉 /）。
  if (req.method === 'GET' && urlPath === '/dev-login.html') {
    fs.readFile(path.join(__dirname, '..', 'dev-login.html'), (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // login.html：正式登入頁（Phase 3a，取代 Google 登入），與 dev-login.html 一樣獨立於 public/
  // 之外、直接從 server/ 根目錄供應。內含 __ROOT_FOLDER_ID__ 佔位字串，serve 時代入
  // config.ROOT_FOLDER_ID——同一份檔案 dev/prod 兩個 Node 實例（各自 .env 不同）都能直接用，
  // 不需要為每個環境各維護一份 login.html。
  if (req.method === 'GET' && urlPath === '/login.html') {
    fs.readFile(path.join(__dirname, '..', 'login.html'), 'utf8', (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      const html = data.replace(/__ROOT_FOLDER_ID__/g, config.ROOT_FOLDER_ID);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // v237：SSE 即時推播（見 src/sse.js 檔頭）——CORS headers 已在本函式最上方統一加過，這裡
  // 不需要重複設定。獨立於下面 GET 靜態檔案 fallback 之外，放在其之前避免被當成一般靜態路徑
  // 404（sse.handleEventsRequest 內部自行驗證 session 並在不通過時回 401）。
  if (req.method === 'GET' && urlPath === '/events') {
    sse.handleEventsRequest(db, config, req, res);
    return;
  }

  if (req.method === 'GET' && urlPath === '/') {
    if (fs.existsSync(path.join(config.PUBLIC_DIR, 'index.html'))) {
      serveStatic(req, res, '/');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, service: 'SCC Drive Proxy (Node/local)' }));
    }
    return;
  }

  if (req.method === 'GET' && urlPath !== '/exec') {
    serveStatic(req, res, urlPath);
    return;
  }

  if (req.method === 'POST' && urlPath === '/exec') {
    try {
      const rawBody = await readBody(req);
      const payload = parsePayload(rawBody, req.headers['content-type'] || '');
      // Phase 3b 信任裝置：把 Cookie header 內的裝置憑證注入 payload.deviceToken——dispatch/
      // actions 層維持純函式（不碰 req/res），HTTP 專屬的 Cookie 解析只在這裡做一次。所有
      // action 皆注入（不限 sessionStart），listMyDevices 用它標記「目前這台」。
      const cookieMap = cookies.parseCookieHeader(req.headers.cookie);
      if (cookieMap[DEVICE_COOKIE_NAME]) payload.deviceToken = cookieMap[DEVICE_COOKIE_NAME];

      const result = await handleRequest(db, config, payload);

      // sessionStart 簽發/沿用了新裝置憑證時，dispatch 回應會附 data.newDeviceToken——轉成
      // Set-Cookie 後從 JSON 回應剝除（機密紀律：裝置 token 明文只出現在 Set-Cookie，不落
      // JSON 回應／log／vdrive）。不加 Secure：見 util/cookies.js buildSetCookieHeader 註解。
      if (result && result.success && result.data && typeof result.data.newDeviceToken === 'string') {
        const maxAgeSec = config.TRUSTED_DEVICE_DAYS * 24 * 3600;
        res.setHeader('Set-Cookie', cookies.buildSetCookieHeader(DEVICE_COOKIE_NAME, result.data.newDeviceToken, maxAgeSec));
        delete result.data.newDeviceToken;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404).end('Not found');
});

if (require.main === module) {
  server.listen(config.PORT, () => {
    console.log(`SCC Drive Proxy (Node/local) 已啟動：http://localhost:${config.PORT}（ROOT_FOLDER_ID=${config.ROOT_FOLDER_ID}）`);
  });

  // v236：學諮系統資料夾（openmail archive）離職清理排程——本專案目前唯一的 in-process 排程器
  // （見 openmail/offboardSweep.js 檔頭）。只在直接執行本檔（node index.js）時啟動；require.main
  // !== module（例如測試檔 require('../src/index')）不會觸發，避免每次跑測試都意外啟動背景計時器。
  // 開機 60 秒後先跑一次（讓 db/routes 完全就緒），之後每 12 小時跑一次。
  const offboardSweep = require('./openmail/offboardSweep');
  setTimeout(() => offboardSweep.runSweep(db, config), 60 * 1000);
  setInterval(() => offboardSweep.runSweep(db, config), 12 * 3600 * 1000);
}

module.exports = { server, db };
