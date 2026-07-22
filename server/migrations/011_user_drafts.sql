-- server/migrations/011_user_drafts.sql
-- v248：草稿雲端備援 v2 —— 除既有本機 localStorage 每 5 秒暫存外，前端每 30 秒把有變動的草稿
-- 額外同步一份到本表（存自己帳號底下），登入時拉回，達成跨裝置還原與兜底（見
-- server/src/actions/drafts.js 檔頭）。
--
-- 衝突規則：本機存在同 key 草稿時本機贏，不會被伺服器值覆蓋（見前端 _restoreCloudDraftsThenMigrate）。
-- owner_email 一律來自已驗證 session（同 openmail/archive.js 既有原則），每筆查詢/寫入皆帶
-- owner_email 條件，跨 owner 一律查無。TTL 14 天由 draftCloudSync/draftCloudList 呼叫時順便清理，
-- 不另開排程。個資紀律：payload 內容絕不可進 audit_log（只記筆數/位元組數，見 audit.js）。
CREATE TABLE IF NOT EXISTS user_drafts (
  owner_email TEXT NOT NULL,
  draft_key   TEXT NOT NULL,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_email, draft_key)
);
