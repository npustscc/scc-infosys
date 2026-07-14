-- server/migrations/001_init.sql
-- Phase 1 骨架 schema。設計要點見實作計畫 B「SQLite schema 要點」。
-- 所有 CREATE 均為 IF NOT EXISTS：db.js 每次啟動都會執行本檔，維持 idempotent（無獨立
-- migration 版本追蹤表——骨架階段只有這一份 migration，之後若新增 schema 變更再加編號檔＋追蹤表）。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 虛擬 Drive：files 表取代 Google Drive 的檔案/資料夾樹。
-- id 保留原 Drive fileId 格式相容（匯入時延續舊 id；本機新建則由 newFileId() 產生同格式亂數 id），
-- 讓 JSON 內容中內嵌的 fileId 引用（如 issues.json attachments）與 rootFolderId 命名空間無需改寫。
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT,
  name        TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'application/json',
  content     TEXT,              -- JSON 檔文字內容（mime_type 非資料夾/blob 時使用）
  blob        BLOB,              -- 二進位內容（附件；uploadFile/downloadFileBase64，Phase 1.5 才會寫入）
  trashed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_files_parent_trashed_name ON files(parent_id, trashed, name);

-- 認證帳號（僅認證，不管授權——授權仍讀 vdrive 內 config.json 的 users，isAuthorizedUser_ 語意 1:1）。
CREATE TABLE IF NOT EXISTS users (
  email            TEXT PRIMARY KEY,
  password_hash    TEXT NOT NULL,     -- argon2id
  totp_secret      TEXT,              -- otplib base32 secret；NULL＝該帳號未啟用 TOTP（Phase 1 骨架容許，正式上線前應強制）
  disabled         INTEGER NOT NULL DEFAULT 0,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     INTEGER,           -- epoch 秒；NULL 或已過去＝未鎖定
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 登出即註銷（全部裝置）＝ GAS 的 SESSION_REVOKED_BEFORE：iat < revoked_before 的 token 一律失效。
CREATE TABLE IF NOT EXISTS session_revocation (
  email          TEXT PRIMARY KEY,
  revoked_before INTEGER NOT NULL   -- epoch 秒
);

-- 稽核紀錄（append-only；去識別化——content 類參數只記長度，不記內容，見 CLAUDE.md 資安原則）。
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  email       TEXT,
  action      TEXT NOT NULL,
  target      TEXT,              -- 目標摘要（path/fileId 等，非內容）
  outcome     TEXT NOT NULL,     -- ok | denied | error
  latency_ms  INTEGER,
  detail      TEXT               -- 短摘要（如 "content_len=1234"），不得含個資內容
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_email ON audit_log(email);
