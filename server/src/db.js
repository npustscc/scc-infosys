// server/src/db.js — better-sqlite3 開啟／WAL／執行 migrations。
// openDb(dbPath) 為主要匯出：dbPath 可為檔案路徑或 ':memory:'（單元測試用）。
// LockService 全域鎖在 GAS 版用來保護「讀-改-寫」的併發安全（見 sessions.json/casesUpsert_ 等），
// Node 版改用 better-sqlite3 的 db.transaction()（同進程內對同一 DB 檔的寫入本就序列化，
// 搭配 transaction 的 BEGIN IMMEDIATE 語意即可根治，不需另外實作鎖）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// schema_migrations：追蹤「哪些 migration 檔已套用過」。001_init.sql 全用 CREATE TABLE IF NOT EXISTS
// 天生 idempotent、不需要這張表也能每次啟動重跑；但 002 起開始出現 ALTER TABLE ADD COLUMN
// （TOTP 註冊欄位），SQLite 的 ADD COLUMN 沒有 IF NOT EXISTS 語法、重跑會噴 duplicate column，
// 故補一張追蹤表，讓每個 migration 檔一生只執行一次（filename 當主鍵，寫入即代表套用完成）。
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename));
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(f);
  }
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 等效 GAS LockService.getScriptLock().waitLock(15000)：若另一個連線持有寫鎖（IMMEDIATE 交易），
  // 逾時前重試而非立即拋 SQLITE_BUSY（厚 commit action，見 actions/commit.js，多以此保護 RMW）。
  db.pragma('busy_timeout = 15000');
  runMigrations(db);
  return db;
}

module.exports = { openDb };
