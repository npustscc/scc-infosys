#!/usr/bin/env node
// scripts/export-drive-tree.mjs — host 端 Drive 匯出：BFS 走訪 rootFolderId 底下整棵樹，
// 輸出 server/scripts/import-drive.js 可直接吃的格式：
//   <outDir>/manifest.jsonl   每行一筆 { id, parentId, name, mimeType, trashed, modifiedTime }
//   <outDir>/content/<id>     檔案內容（資料夾不下載內容；JSON/文字型與二進位皆保留原始 bytes）
//
// fileId 一律保留原 Drive id（見實作計畫 B「Drive 匯入」：JSON 內容內嵌 fileId 引用、
// rootFolderId 同時是前端常數/白名單鍵，保留才能讓「前端只改一個 APPS_SCRIPT_URL 常數」成立）。
//
// OAuth 段複製 scripts/pull-bugreports.mjs 的 creds.json + .drive-token.json loopback 模式
// （零依賴，只用 Node 18+ 內建 fetch/http/fs）；用法與授權帳號需求同 pull-bugreports.mjs
// （用持有資料的帳號登入，例如 npust.scc@heartnpust.tw）。
//
// 用法：
//   node scripts/export-drive-tree.mjs [--root <folderId>] [--out <dir>]
//   預設 --root 為 dev 版 ROOT_FOLDER_ID（'1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx'）、
//   預設 --out 為 repo 根目錄 drive-export/（已 gitignore，不得進 repo）。
//
// ⚠️ 本階段（Phase 1 骨架）只寫這支腳本，不執行——實際匯出留待 M4（Drive 匯入）里程碑，
// 屆時再視匯出資料量評估是否需要加分頁/限流/斷點續傳。

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
  } catch (_) { /* 失敗就靠使用者手動複製網址 */ }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_PATH = path.join(ROOT, 'creds.json');
const TOKEN_PATH = path.join(ROOT, '.drive-token.json');
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DEFAULT_ROOT_FOLDER_ID = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx'; // dev 資料夾

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT_FOLDER_ID, out: path.join(ROOT, 'drive-export') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) { out.root = argv[i + 1]; i++; }
    else if (argv[i] === '--out' && argv[i + 1]) { out.out = path.resolve(argv[i + 1]); i++; }
  }
  return out;
}

// ── OAuth（installed app / loopback flow）── 與 pull-bugreports.mjs 逐段相同 ──
function loadCreds() {
  const j = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const c = j.installed || j.web;
  if (!c) throw new Error('creds.json 格式不符（缺 installed/web）');
  return c;
}

async function tokenFromRefresh(creds, refreshToken) {
  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('refresh token 失效（' + res.status + '）：' + await res.text());
  return res.json();
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
        if (!tokenRes.ok) { reject(new Error('token 交換失敗：' + await tokenRes.text())); return; }
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
      console.log('\n已嘗試自動開啟瀏覽器，請用持有資料的帳號完成授權（如 npust.scc@heartnpust.tw）。');
      console.log('若瀏覽器未自動開啟，請「完整複製」以下整行網址貼到網址列：\n');
      console.log(authUrl + '\n');
      openBrowser(authUrl);
    });
  });
}

async function getAccessToken() {
  const creds = loadCreds();
  if (fs.existsSync(TOKEN_PATH)) {
    const cached = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    if (cached.refresh_token) {
      try {
        const t = await tokenFromRefresh(creds, cached.refresh_token);
        return t.access_token;
      } catch (e) {
        console.warn('token 快取失效，需重新授權：' + e.message);
      }
    }
  }
  const t = await interactiveAuth(creds);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ refresh_token: t.refresh_token }, null, 2));
  console.log('已快取 refresh token 至 .drive-token.json（已 gitignore）');
  return t.access_token;
}

// ── Drive API ────────────────────────────────────────────────────────
let ACCESS_TOKEN = '';
async function drive(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
  if (!res.ok) throw new Error('Drive API ' + res.status + '：' + (await res.text()).slice(0, 300) + '\nURL: ' + url);
  return res;
}

async function listChildren(folderId) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents`,
      fields: 'nextPageToken,files(id,name,mimeType,trashed,modifiedTime,parents)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await (await drive(`https://www.googleapis.com/drive/v3/files?${params.toString()}`)).json();
    files.push(...(r.files || []));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function downloadTo(fileId, destPath) {
  const res = await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

// ── 主流程：BFS 走訪整棵樹 ───────────────────────────────────────────
async function main() {
  const { root, out } = parseArgs(process.argv.slice(2));
  ACCESS_TOKEN = await getAccessToken();
  console.log(`root folder：${root}`);
  console.log(`輸出目錄：${out}`);

  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(out, 'content'), { recursive: true });
  const manifestStream = fs.createWriteStream(path.join(out, 'manifest.jsonl'));

  const queue = [root];
  const seen = new Set();
  let fileCount = 0, folderCount = 0, downloadFail = 0;

  while (queue.length) {
    const folderId = queue.shift();
    if (seen.has(folderId)) continue;
    seen.add(folderId);

    let children;
    try {
      children = await listChildren(folderId);
    } catch (e) {
      console.warn(`列出子項失敗（${folderId}）：${e.message.split('\n')[0]}`);
      continue;
    }

    for (const f of children) {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      const entry = {
        id: f.id,
        parentId: folderId,
        name: f.name,
        mimeType: f.mimeType,
        trashed: !!f.trashed,
        modifiedTime: f.modifiedTime,
      };
      manifestStream.write(JSON.stringify(entry) + '\n');

      if (isFolder) {
        folderCount++;
        queue.push(f.id);
      } else {
        fileCount++;
        try {
          await downloadTo(f.id, path.join(out, 'content', f.id));
        } catch (e) {
          downloadFail++;
          console.warn(`下載失敗（${f.name} / ${f.id}）：${e.message.split('\n')[0]}`);
        }
      }
    }
  }

  manifestStream.end();
  console.log(`完成：資料夾 ${folderCount} 個、檔案 ${fileCount} 個（含 root 自身未列入 manifest，匯入端 ctx.root 即為 --root 指定值）、下載失敗 ${downloadFail} 個`);
  console.log('下一步：把此目錄 scp 到目標主機，執行 server/scripts/import-drive.js --dir <此目錄> 匯入 SQLite。');
}

main().catch((e) => { console.error('\n失敗：' + e.message); process.exit(1); });
