#!/usr/bin/env node
// scripts/mint-drive-rw-token.mjs — 鑄造「寫入 scope」的 Drive refresh token（.drive-token-rw.json，已 gitignore）。
// 只給 scripts/deidentify-dev.mjs 上傳去識別化結果使用；平常的唯讀 token（.drive-token.json）不受影響。
// 授權段複製 scripts/pull-bugreports.mjs 的 loopback 模式；請用 npust.scc@heartnpust.tw 完成授權。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) { /* 使用者手動複製網址 */ }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_PATH = path.join(ROOT, 'creds.json');
const TOKEN_PATH = path.join(ROOT, '.drive-token-rw.json');
const SCOPE = 'https://www.googleapis.com/auth/drive';

function loadCreds() {
  const j = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const c = j.installed || j.web;
  if (!c) throw new Error('creds.json 格式不符（缺 installed/web）');
  return c;
}

async function interactiveAuth(creds) {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://localhost');
        if (u.pathname !== '/') { res.writeHead(404).end(); return; }
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(code ? '<h2>授權完成，可以關閉此視窗回到終端機。</h2>' : '<h2>授權失敗：' + (err || '未知') + '</h2>');
        server.close();
        if (!code) { reject(new Error('授權失敗：' + err)); return; }
        const tokenRes = await fetch(creds.token_uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            code, grant_type: 'authorization_code', redirect_uri: redirectUri,
          }),
        });
        if (!tokenRes.ok) { reject(new Error('token 交換失敗（HTTP ' + tokenRes.status + '）')); return; }
        resolve(await tokenRes.json());
      } catch (e) { reject(e); }
    });
    server.listen(0, '127.0.0.1', () => {
      redirectUri = 'http://localhost:' + server.address().port;
      const authUrl = creds.auth_uri + '?' + new URLSearchParams({
        client_id: creds.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'select_account consent',
        login_hint: 'npust.scc@heartnpust.tw',
      });
      console.log('\n已嘗試自動開啟瀏覽器，請用 npust.scc@heartnpust.tw 完成授權（scope：Drive 讀寫）。');
      console.log('若瀏覽器未自動開啟，請完整複製以下整行網址到網址列：\n');
      console.log(authUrl + '\n');
      openBrowser(authUrl);
    });
  });
}

const t = await interactiveAuth(loadCreds());
if (!t.refresh_token) {
  console.error('回應未含 refresh_token（可能因重複授權被省略）——請先到 Google 帳戶安全性撤銷本 App 存取權後重跑。');
  process.exit(1);
}
fs.writeFileSync(TOKEN_PATH, JSON.stringify({ refresh_token: t.refresh_token }, null, 2));
console.log('已寫入 .drive-token-rw.json（已 gitignore）。');
