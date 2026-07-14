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

const db = openDb(config.DB_PATH);

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
    const LIMIT = 25 * 1024 * 1024; // 25MB：附件走 base64 upload 尚未實作，一般 JSON 請求遠小於此
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
      const result = await handleRequest(db, config, payload);
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
}

module.exports = { server, db };
