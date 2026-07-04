#!/usr/bin/env node
// 拉取「錯誤回報/許願池」（issues.json）與其附件圖片到本機 bugreports/ 資料夾，
// 供 Claude Code 直接讀取、判讀與討論。資料夾已列入 .gitignore（含個資，repo 為 public 絕不可入庫）。
//
// 用法：
//   node scripts/pull-bugreports.mjs
// （issues.json 為 dev/prod 共用、存於正式版資料夾；附件依 fileId 直接下載，不分環境）
//
// 第一次執行會開啟瀏覽器要求 Google 授權（請用 npust.scc@heartnpust.tw 登入，
// 因為資料檔由該帳號持有）；之後 token 快取在 .drive-token.json（已 gitignore）自動更新。
//
// 零依賴：只用 Node 18+ 內建 fetch / http / fs。

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_PATH = path.join(ROOT, 'creds.json');
const TOKEN_PATH = path.join(ROOT, '.drive-token.json');

const FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP'; // ISSUES_FOLDER_ID：dev/prod 共用正式版資料夾
const OUT_DIR = path.join(ROOT, 'bugreports');
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// ── OAuth（installed app / loopback flow）─────────────────────────────
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
        const redirectUri = 'http://localhost:' + server.address().port;
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
      const redirectUri = 'http://localhost:' + server.address().port;
      const authUrl = creds.auth_uri + '?' + new URLSearchParams({
        client_id: creds.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'select_account consent',            // 強制跳出帳號選擇，避免瀏覽器預設帳號直接授權
        login_hint: 'npust.scc@heartnpust.tw',       // 預選/提示正確帳號
      });
      console.log('\n請在瀏覽器開啟以下網址完成授權（請用 npust.scc@heartnpust.tw 登入）：\n');
      console.log(authUrl + '\n');
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

async function findFileInFolder(name, folderId) {
  const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
  const r = await (await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`)).json();
  return r.files?.[0] || null;
}

async function downloadTo(fileId, destPath) {
  const res = await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

// ── 主流程 ───────────────────────────────────────────────────────────
function collectAttachments(att, serial, out) {
  (att || []).forEach((a) => {
    if (a.type === 'pdf_pages') {
      (a.pages || []).forEach((p) => out.push({
        fileId: p.fileId, serial,
        fileName: (a.fileName || 'pdf').replace(/\.pdf$/i, '') + '_p' + p.pageNum + '.jpg',
      }));
    } else if (a.fileId) {
      out.push({ fileId: a.fileId, serial, fileName: a.fileName || a.fileId });
    }
  });
}

function fmtDate(iso) { return iso ? iso.replace('T', ' ').slice(0, 16) : '—'; }

const STATUS_LABEL = { open: '待處理', in_progress: '處理中', pending_verification: '待驗證', resolved: '已解決' };

async function main() {
  ACCESS_TOKEN = await getAccessToken();
  console.log(`輸出：${OUT_DIR}`);

  const meta = await findFileInFolder('issues.json', FOLDER_ID);
  if (!meta) throw new Error('資料夾內找不到 issues.json（請確認授權帳號有權限存取該資料夾）');
  const issuesPath = path.join(OUT_DIR, 'issues.json');
  await downloadTo(meta.id, issuesPath);
  const data = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
  const issues = Array.isArray(data) ? data : (data.issues || []);
  console.log(`issues.json 下載完成（最後修改 ${meta.modifiedTime}），共 ${issues.length} 筆回報`);

  // 收集所有附件（回報本體 + 留言）
  const wanted = [];
  issues.forEach((it) => {
    const serial = String(it.serial ?? '0').padStart(3, '0');
    collectAttachments(it.attachments, serial, wanted);
    (it.comments || []).forEach((c) => collectAttachments(c.attachments, serial, wanted));
  });
  let dl = 0, skip = 0, fail = 0;
  for (const w of wanted) {
    const dest = path.join(OUT_DIR, 'attachments', '#' + w.serial, w.fileName.replace(/[\\/:*?"<>|]/g, '_'));
    if (fs.existsSync(dest)) { skip++; continue; }
    try { await downloadTo(w.fileId, dest); dl++; }
    catch (e) { fail++; console.warn(`附件下載失敗（#${w.serial} ${w.fileName}）：${e.message.split('\n')[0]}`); }
  }
  console.log(`附件：新下載 ${dl}、已存在略過 ${skip}、失敗 ${fail}`);

  // 摘要 markdown：Claude 判讀入口
  const lines = ['# 錯誤回報/許願池 摘要', '',
    `> 產生時間：${new Date().toISOString()}　來源 issues.json 最後修改：${meta.modifiedTime}`, ''];
  [...issues].sort((a, b) => (b.serial || 0) - (a.serial || 0)).forEach((it) => {
    const serial = String(it.serial ?? '0').padStart(3, '0');
    lines.push(`## #${serial}（${STATUS_LABEL[it.status] || it.status || '—'}）`);
    lines.push(`- 回報者：${it.submittedByName || it.submittedBy || '—'}　時間：${fmtDate(it.submittedAt)}`);
    lines.push(`- 說明：${(it.description || '').replace(/\r?\n/g, ' ⏎ ')}`);
    if (it.systemContext?.length) lines.push(`- 系統偵測錯誤：${it.systemContext.map(s => typeof s === 'string' ? s : JSON.stringify(s)).join('；')}`);
    const att = [];
    collectAttachments(it.attachments, serial, att);
    if (att.length) lines.push(`- 附件：${att.map(a => `attachments/#${serial}/${a.fileName}`).join('、')}`);
    (it.comments || []).forEach((c) => {
      lines.push(`  - 💬 ${c.authorName || c.authorEmail || '—'}（${fmtDate(c.createdAt)}）：${(c.content || '').replace(/\r?\n/g, ' ⏎ ')}`);
      const catt = [];
      collectAttachments(c.attachments, serial, catt);
      if (catt.length) lines.push(`    附件：${catt.map(a => `attachments/#${serial}/${a.fileName}`).join('、')}`);
    });
    (it.statusHistory || []).forEach((h) => {
      lines.push(`  - 🔄 ${h.byName || h.by || '—'}（${fmtDate(h.at)}）：${STATUS_LABEL[h.from] || h.from} → ${STATUS_LABEL[h.to] || h.to}`);
    });
    lines.push('');
  });
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), lines.join('\n'));
  console.log(`摘要完成：${path.join(OUT_DIR, 'summary.md')}`);
}

main().catch((e) => { console.error('\n失敗：' + e.message); process.exit(1); });
