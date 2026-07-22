// server/src/actions/drafts.js — v248 草稿雲端備援 v2：除既有本機 localStorage 每 5 秒暫存外，
// 前端每 30 秒把「有變動的草稿」額外同步一份到本表（user_drafts，見 migrations/011_user_drafts.sql），
// 存自己帳號底下；登入時拉回（見 dev/index.html _restoreCloudDraftsThenMigrate），達成跨裝置還原與
// 兜底。對映 openmail/archive.js 既有慣例：
//   - ownerEmail 一律來自已驗證 session（dispatch.js 解出），本檔完全不吃 params 裡的身分欄位——
//     每一條查詢/刪除都帶 owner_email 條件，跨 owner 一律「查無」/「刪 0 筆」，不洩漏他人 key 存在性。
//   - 業務錯誤一律回傳 { error: 'xxx' }（不 throw），dispatch.js 的 envelope.ok() 會原樣包裝。
//   - 個資紀律（CLAUDE.md 資安原則 3）：payload 內容絕不可進 audit_log，只記筆數/位元組數
//     （見 audit.js summarizeParams 的 draftCloudSync 分支）。
//   - 衝突規則「本機贏」是前端邏輯（sweeper 只會把本機值往上傳，絕不會用伺服器值覆蓋本機），
//     本檔單純是一個 key-value 儲存＋TTL 清理，不判斷/不理解 payload 內容本身。
'use strict';

const MAX_KEY_LEN = 300;
const MAX_PAYLOAD_BYTES = 200 * 1024;
const MAX_UPSERTS_PER_CALL = 30;
const MAX_DELETES_PER_CALL = 100;
const MAX_DRAFTS_PER_USER = 50;
const TTL_DAYS = 14;

function ttlCutoffIso() {
  return new Date(Date.now() - TTL_DAYS * 24 * 3600 * 1000).toISOString();
}

// 每次呼叫（sync／list）都先做 TTL 清理，不另開排程——草稿本就是低頻寫入的小表，多做一次
// DELETE（通常 0 筆命中）成本可忽略。
function sweepExpired(db, ownerEmail) {
  db.prepare('DELETE FROM user_drafts WHERE owner_email = ? AND updated_at < ?').run(ownerEmail, ttlCutoffIso());
}

// params = { upserts: [{key, payload}], deletes: [key, ...] }。
// 批次上限（upserts ≤30／deletes ≤100）超過直接回業務錯誤，不逐筆處理——這代表前端呼叫端邏輯有誤
// （正常 sweeper 每次 diff 出的筆數不可能這麼多），fail-fast 比默默截斷更容易發現問題。
// 單筆驗證失敗（key/payload 格式不對、payload 超過 200KB、超過每人 50 筆上限）則個別跳過、
// 列入回傳的 skipped，不影響同批其餘筆的處理。
function draftCloudSync(db, ownerEmail, params) {
  sweepExpired(db, ownerEmail);

  const p = params || {};
  const upsertsIn = Array.isArray(p.upserts) ? p.upserts : [];
  const deletesIn = Array.isArray(p.deletes) ? p.deletes : [];

  if (upsertsIn.length > MAX_UPSERTS_PER_CALL || deletesIn.length > MAX_DELETES_PER_CALL) {
    return { error: 'draft_batch_too_large' };
  }

  const saved = [];
  const skipped = [];

  // 每人 50 筆上限：只有「新增 key」才會讓總筆數增加，既有 key 更新（覆蓋 payload）不佔用額度。
  const existingKeys = new Set(
    db.prepare('SELECT draft_key FROM user_drafts WHERE owner_email = ?').all(ownerEmail).map((r) => r.draft_key)
  );
  let currentCount = existingKeys.size;

  const upsertStmt = db.prepare(
    `INSERT INTO user_drafts (owner_email, draft_key, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_email, draft_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  );

  for (const item of upsertsIn) {
    const key = item && item.key;
    const payload = item && item.payload;
    if (typeof key !== 'string' || !key || key.length > MAX_KEY_LEN) {
      skipped.push({ key: typeof key === 'string' ? key : String(key == null ? '' : key), reason: 'invalid_key' });
      continue;
    }
    if (typeof payload !== 'string') {
      skipped.push({ key, reason: 'invalid_payload' });
      continue;
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
      skipped.push({ key, reason: 'payload_too_large' });
      continue;
    }
    const isNewKey = !existingKeys.has(key);
    if (isNewKey && currentCount >= MAX_DRAFTS_PER_USER) {
      skipped.push({ key, reason: 'user_draft_limit' });
      continue;
    }
    upsertStmt.run(ownerEmail, key, payload, new Date().toISOString());
    if (isNewKey) { existingKeys.add(key); currentCount++; }
    saved.push(key);
  }

  let deletedCount = 0;
  if (deletesIn.length) {
    const delStmt = db.prepare('DELETE FROM user_drafts WHERE owner_email = ? AND draft_key = ?');
    for (const key of deletesIn) {
      if (typeof key !== 'string' || !key) continue;
      const info = delStmt.run(ownerEmail, key);
      deletedCount += info.changes;
    }
  }

  return { saved, deleted: deletedCount, skipped };
}

// 只回自己的草稿（owner_email 條件），供登入時 materialize 回 localStorage 用。
function draftCloudList(db, ownerEmail) {
  sweepExpired(db, ownerEmail);
  const rows = db.prepare(
    'SELECT draft_key, payload, updated_at FROM user_drafts WHERE owner_email = ? ORDER BY updated_at DESC'
  ).all(ownerEmail);
  return {
    drafts: rows.map((r) => ({ key: r.draft_key, payload: r.payload, updatedAt: r.updated_at })),
  };
}

module.exports = {
  draftCloudSync,
  draftCloudList,
  // exported for tests
  MAX_KEY_LEN,
  MAX_PAYLOAD_BYTES,
  MAX_UPSERTS_PER_CALL,
  MAX_DELETES_PER_CALL,
  MAX_DRAFTS_PER_USER,
  TTL_DAYS,
};
