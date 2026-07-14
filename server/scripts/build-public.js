#!/usr/bin/env node
// server/scripts/build-public.js — 把 dev/index.html 複製到 server/public/index.html，
// 只改 APPS_SCRIPT_URL 這一行常數（DRIVE_FOLDER_ID 保持不變——見計畫核心可行性依據：前端只需
// 改一個常數）。比對模式沿用 scripts/check-env-constants.mjs 的 regex 手法，只鎖定該行避免誤改。
//
// 用法：node scripts/build-public.js [目標 URL]（預設 http://localhost:<PORT>/exec，取自 .env）
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

const DEV_HTML = path.join(__dirname, '..', '..', 'dev', 'index.html');
const OUT_DIR = path.join(__dirname, '..', 'public');
const OUT_HTML = path.join(OUT_DIR, 'index.html');

function main() {
  const targetUrl = process.argv[2] || `http://localhost:${config.PORT}/exec`;
  if (!fs.existsSync(DEV_HTML)) {
    console.error(`找不到 ${DEV_HTML}`);
    process.exit(1);
  }
  const html = fs.readFileSync(DEV_HTML, 'utf8');

  const RE = /^const APPS_SCRIPT_URL = '([^']*)';$/m;
  const m = RE.exec(html);
  if (!m) {
    console.error('找不到 APPS_SCRIPT_URL 常數，dev/index.html 結構可能已改變——請確認後手動調整本腳本的 regex。');
    process.exit(1);
  }
  const patched = html.replace(RE, `const APPS_SCRIPT_URL = '${targetUrl}';`);

  // 機械驗證：只有這一行改變，其餘逐字元相同（避免 regex 誤傷其他內容）——寫入前先驗證。
  const before = html.split('\n');
  const after = patched.split('\n');
  const diffLines = before.map((l, i) => (l !== after[i] ? i : -1)).filter((i) => i !== -1);
  if (diffLines.length !== 1) {
    console.error(`預期只有 1 行變動，實際變動 ${diffLines.length} 行——已中止寫入，請檢查。`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, patched, 'utf8');

  console.log(`已產生 ${OUT_HTML}`);
  console.log(`APPS_SCRIPT_URL：${m[1]} → ${targetUrl}`);
  console.log('DRIVE_FOLDER_ID 未變動（前端只改這一個常數即可對打 Node 後端）。');
}

main();
