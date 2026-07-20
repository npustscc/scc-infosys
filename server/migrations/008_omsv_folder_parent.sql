-- server/migrations/008_omsv_folder_parent.sql
-- v234：學諮系統資料夾支援階層（子資料夾，最多三層，見 openmail/archive.js MAX_FOLDER_DEPTH）。
--
-- parent_id：NULL＝根層（第 1 層）；有值＝該資料夾的父資料夾 id。名稱維持 007 訂下的
-- UNIQUE(owner_email, name) 全域唯一（同一人所有層級共用一個命名空間），刻意不改成「同一層才需
-- 唯一」——sqlite 的 UNIQUE 約束要改範圍（例如 UNIQUE(owner_email, parent_id, name)）需要重建整張
-- 表（sqlite 的 ALTER TABLE 不支援改約束），而且跨層同名（例如「A」底下有個「A」的子資料夾又叫
-- 「A」）在使用者眼中容易混淆、UI 也不好標示是哪一層，維持全域唯一反而更簡單清楚。
ALTER TABLE openmail_archive_folders ADD COLUMN parent_id INTEGER REFERENCES openmail_archive_folders(id);
CREATE INDEX IF NOT EXISTS idx_omsv_folders_parent ON openmail_archive_folders(parent_id);
