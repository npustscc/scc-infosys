#!/usr/bin/env node
// server/scripts/import-drive.js — 把 scripts/export-drive-tree.mjs（repo 根）匯出的 Drive 樹狀
// 資料，單交易 upsert 進虛擬 Drive（files 表）。fileId 一律保留原 Drive id（見計畫 B「Drive 匯入」：
// JSON 內容內嵌 fileId 引用、rootFolderId 同時是前端常數/白名單鍵，保留才能「前端只改一個 URL」）。
//
// 匯出格式（與 export-drive-tree.mjs 一致）：
//   <exportDir>/manifest.jsonl   每行一筆 { id, parentId, name, mimeType, trashed, modifiedTime }
//   <exportDir>/content/<id>     檔案內容（JSON/文字型 mimeType 存 UTF-8 文字；其餘存二進位原檔）
//
// 用法：node scripts/import-drive.js [--dir <exportDir>]（預設 repo 根目錄 drive-export/，已 gitignore）
// idempotent：以 id 為鍵 upsert，可重複執行；跑完會核對「manifest 筆數 == upsert 筆數」。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { openDb } = require('../src/db');

function isTextMime(mimeType) {
  return mimeType === 'application/vnd.google-apps.folder'
    || mimeType === 'application/json'
    || (mimeType || '').startsWith('text/');
}

function parseArgs(argv) {
  const out = { dir: path.join(__dirname, '..', '..', 'drive-export') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) { out.dir = argv[i + 1]; i++; }
  }
  return out;
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(dir, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    console.error(`找不到匯出資料：${manifestPath}`);
    console.error('請先在 host 端執行 node scripts/export-drive-tree.mjs（repo 根目錄）產生匯出資料，');
    console.error('再 scp 到本機（VM 部署時）或直接指定 --dir 指向該匯出目錄。');
    process.exit(1);
  }

  const lines = fs.readFileSync(manifestPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l));

  const db = openDb(config.DB_PATH);
  const upsertStmt = db.prepare(
    `INSERT INTO files (id, parent_id, name, mime_type, content, blob, trashed, created_at, updated_at)
     VALUES (@id, @parentId, @name, @mimeType, @content, @blob, @trashed, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       parent_id = excluded.parent_id, name = excluded.name, mime_type = excluded.mime_type,
       content = excluded.content, blob = excluded.blob, trashed = excluded.trashed,
       updated_at = excluded.updated_at`
  );

  let upserted = 0;
  const importAll = db.transaction((rows) => {
    for (const entry of rows) {
      const contentPath = path.join(dir, 'content', entry.id);
      let content = null;
      let blob = null;
      if (entry.mimeType !== 'application/vnd.google-apps.folder' && fs.existsSync(contentPath)) {
        if (isTextMime(entry.mimeType)) {
          content = fs.readFileSync(contentPath, 'utf8');
        } else {
          blob = fs.readFileSync(contentPath);
        }
      }
      const now = new Date().toISOString();
      upsertStmt.run({
        id: entry.id,
        parentId: entry.parentId || null,
        name: entry.name,
        mimeType: entry.mimeType || 'application/octet-stream',
        content,
        blob,
        trashed: entry.trashed ? 1 : 0,
        createdAt: entry.modifiedTime || now,
        updatedAt: entry.modifiedTime || now,
      });
      upserted++;
    }
  });
  importAll(entries);
  db.close();

  console.log(`匯入完成：manifest ${entries.length} 筆，upsert ${upserted} 筆。`);
  if (upserted !== entries.length) {
    console.error('警告：筆數不符，請檢查 manifest.jsonl 是否有重複/損毀的行。');
    process.exit(1);
  }
}

main();
