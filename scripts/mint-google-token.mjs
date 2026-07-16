#!/usr/bin/env node
// scripts/mint-google-token.mjs — 通用 Google OAuth refresh token 鑄造器（Phase 2 直連 Google API 用）。
// 產出 .gtoken-<name>.json（已 gitignore），內容為 {client_id, client_secret, refresh_token, scopes}
// —— 與 server 端 DRIVE_SYNC_CREDS / GMAIL_SYNC_CREDS / CALENDAR_SYNC_CREDS 憑證檔同格式，可直接 scp 上 server。
//
// 用法：
//   node scripts/mint-google-token.mjs gmail    # 用「收身心調適假信件的帳號（npust5）」授權，scope=gmail.modify
//   node scripts/mint-google-token.mjs calendar # 用 npust.scc@heartnpust.tw 授權，scope=calendar + gmail.send（寄信）
// 授權段沿用 mint-drive-rw-token.mjs 的 loopback 模式。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROFILES = {
  gmail: {
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    loginHint: 'npust5@gmail.com', // 收身心調適假信件的信箱（對映 GAS npust5GetAccessToken_）
    note: '請用 npust5@gmail.com（收身心調適假信件的信箱）完成授權（scope：Gmail 讀取＋標籤）。',
  },
  calendar: {
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.send'],
    loginHint: 'npust.scc@heartnpust.tw',
    note: '請用 npust.scc@heartnpust.tw 完成授權（scope：日曆讀寫＋寄信）。',
  },
};

const name = process.argv[2];
if (!PROFILES[name]) {
  console.error('用法：node scripts/mint-google-token.mjs <gmail|calendar>');
  process.exit(1);
}
const profile = PROFILES[name];

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) { /* 使用者手動複製網址 */ }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_PATH = path.join(ROOT, 'creds.json');
const TOKEN_PATH = path.join(ROOT, '.gtoken-' + name + '.json');

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
      const params = {
        client_id: creds.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: profile.scopes.join(' '),
        access_type: 'offline',
        prompt: 'select_account consent',
      };
      if (profile.loginHint) params.login_hint = profile.loginHint;
      const authUrl = creds.auth_uri + '?' + new URLSearchParams(params);
      console.log('\n已嘗試自動開啟瀏覽器。' + profile.note);
      console.log('若瀏覽器未自動開啟，請完整複製以下整行網址到網址列：\n');
      console.log(authUrl + '\n');
      openBrowser(authUrl);
    });
  });
}

const creds = loadCreds();
const t = await interactiveAuth(creds);
if (!t.refresh_token) {
  console.error('回應未含 refresh_token（可能因重複授權被省略）——請先到該 Google 帳戶「安全性→第三方存取權」撤銷本 App 後重跑。');
  process.exit(1);
}
fs.writeFileSync(TOKEN_PATH, JSON.stringify({
  client_id: creds.client_id,
  client_secret: creds.client_secret,
  refresh_token: t.refresh_token,
  scopes: profile.scopes,
}, null, 2));
console.log('已寫入 ' + path.basename(TOKEN_PATH) + '（已 gitignore）。之後我會把它 scp 到 server 並 chmod 600。');
