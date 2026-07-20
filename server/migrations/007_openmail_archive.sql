-- server/migrations/007_openmail_archive.sql
-- 學諮伺服器資料夾（v220）：信件封存到本系統 sqlite（不佔 openmail 信箱空間）。原始 .eml 全文
-- 存 BLOB（source），需要顯示/下載附件時由 mailparser 即時解析（見 openmail/archive.js），不額外
-- 拆欄位存正文本身，避免解析邏輯分裂成兩套（沿用 openmail/actions.js omGetMessage 既有的
-- simpleParser + sanitize 套路）。
--
-- openmail_archive_folders：使用者自訂封存資料夾，owner_email + name 唯一（同一人不可有兩個
--   同名資料夾；不同人可以同名，互不影響——owner 隔離見 openmail/archive.js 所有查詢皆帶
--   owner_email 條件，跨 owner 一律查無視同拒絕）。
-- openmail_archive_messages：實際封存的信件。
--   folder_id  — 所屬封存資料夾（FK；db.js 已開 foreign_keys=ON）。
--   owner_email — 冗餘存一份（可從 folder_id JOIN folders 取得，但直接存一份讓 omsvGet/
--                 omsvDownloadAttachment/omsvDelete 等單筆存取只需 id+owner_email 就能做 owner
--                 檢查，不必每次 JOIN；也是防禦寫法，避免任何理論上的孤兒列查不到 owner）。
--   subject/from_addr/to_addr/date — 從 mailparser 解析結果抽出的摘要欄位，供 omsvList 列表顯示
--                 用，不必每次都重新解析整份 source。
--   size_bytes — 原始 .eml 位元組數，供前端顯示與稽核（audit_log 只記大小/資料夾名，不記主旨/
--                內容，見 audit.js summarizeOmsvParams，CLAUDE.md 資安原則 3 去識別化）。
--   source     — 完整原始 .eml（BLOB），單封上限 25MB（見 openmail/archive.js
--                MAX_ARCHIVE_MESSAGE_BYTES）。
CREATE TABLE IF NOT EXISTS openmail_archive_folders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_email, name)
);
CREATE INDEX IF NOT EXISTS idx_omsv_folders_owner ON openmail_archive_folders(owner_email);

CREATE TABLE IF NOT EXISTS openmail_archive_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id   INTEGER NOT NULL REFERENCES openmail_archive_folders(id),
  owner_email TEXT NOT NULL,
  subject     TEXT,
  from_addr   TEXT,
  to_addr     TEXT,
  date        TEXT,
  size_bytes  INTEGER NOT NULL,
  source      BLOB NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_omsv_messages_folder ON openmail_archive_messages(folder_id);
CREATE INDEX IF NOT EXISTS idx_omsv_messages_owner ON openmail_archive_messages(owner_email);
