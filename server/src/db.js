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
// 每個 migration 檔包在 BEGIN IMMEDIATE 交易內執行（SQLite 的 ALTER TABLE 可在交易內回滾）：
//   1. 原子性：檔內任一句失敗整檔回滾，絕不留下「欄位加了、紀錄沒寫」的半套用狀態
//      （事故 2026-07-16：service 重啟與 attendance-pull timer 同時開 DB 各跑一次無交易的
//      migrations，dev DB 卡在半套用、服務 duplicate column 崩潰循環）。
//   2. 併發互斥＋鎖內二次檢查：IMMEDIATE 先取寫鎖（busy_timeout 內等待），取得後重查
//      schema_migrations——另一個進程若已在我們等鎖期間套用完成，這裡直接跳過。
function runMigrations(db, migrationsDir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const isApplied = (f) => !!db.prepare('SELECT 1 FROM schema_migrations WHERE filename = ?').get(f);
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (isApplied(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (isApplied(f)) { db.exec('ROLLBACK'); continue; } // 鎖內二次檢查
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(f);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_e) { /* 已回滾/連線失效 */ }
      throw e;
    }
  }
}

// opts.readonly（v200，附件跨環境 fallback／PEER_DB 專用）：唯讀連線——不建立目錄（假設檔案已由
// 對方環境的正常啟動流程建立）、不執行 runMigrations（唯讀連線本就無法寫 schema_migrations，且
// 對方環境的 schema 由它自己的部署流程負責維護，不該由本端唯讀連線代勞）、不設定 journal_mode/
// foreign_keys（這些是需要寫入權限才能變更的資料庫層級設定；WAL 模式下唯讀連線天生就能讀到另一個
// 行程已提交的最新資料，無需重複宣告）。檔案不存在時 fileMustExist 會直接拋錯，交由呼叫端視為
// 「查無」處理（見 actions/attachments.js getPeerDb），不可靜默建出一個空檔案。
function openDb(dbPath, opts) {
  const readonly = !!(opts && opts.readonly);
  if (dbPath !== ':memory:' && !readonly) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  if (readonly) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    return db;
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

module.exports = { openDb, runMigrations };
