// server/src/openmail/archive.js — v220 學諮伺服器資料夾：信件封存到本系統 sqlite（不佔 openmail
// 信箱空間），見 migrations/007_openmail_archive.sql。omsv* 業務層，對映 openmail/actions.js 的
// om* 既有慣例：
//   - ownerEmail 一律來自已驗證 session（dispatch.js 解出），本檔完全不吃 params 裡的身分欄位——
//     每一條查詢都帶 owner_email 條件，跨 owner 一律「查無」視同拒絕（不回洩漏性的 403，直接
//     404 風格的 omsv_folder_not_found / omsv_message_not_found，不透露該 id 是否存在於別人名下）。
//   - 業務錯誤一律回傳 { error: 'xxx' }（不 throw），dispatch.js 的 envelope.ok() 會原樣包裝，
//     前端據此判讀（同 om*/sms* 既有慣例）。
//   - 原始 .eml 存 BLOB（source 欄位），需要顯示/下載附件時才用 mailparser 即時解析，重用
//     openmail/actions.js 的 buildMessageView（HTML 消毒／cid 內嵌／附件清單同一套規則，不分裂
//     成兩份實作）。
'use strict';

const { simpleParser } = require('mailparser');
const credStore = require('./credStore');
const client = require('./client');
const omActions = require('./actions');

const MAX_ARCHIVE_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_FOLDER_NAME_LEN = 100;
// v234：資料夾階層（子資料夾，見 migrations/008_omsv_folder_parent.sql）。根層＝第 1 層，
// 最深可到第 3 層（根層資料夾底下最多再兩層子孫）。
const MAX_FOLDER_DEPTH = 3;

function errMsg(err) {
  return String((err && err.message) || err);
}

// ── 資料夾 ──────────────────────────────────────────────────────────────

function omsvFolderList(db, ownerEmail) {
  const rows = db.prepare(
    `SELECT f.id, f.name, f.parent_id, f.created_at,
            (SELECT COUNT(*) FROM openmail_archive_messages m WHERE m.folder_id = f.id) AS message_count
     FROM openmail_archive_folders f WHERE f.owner_email = ? ORDER BY f.name COLLATE NOCASE`
  ).all(ownerEmail);
  return {
    folders: rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id == null ? null : r.parent_id,
      createdAt: r.created_at,
      messageCount: r.message_count,
    })),
  };
}

// ── 階層計算 helper（v234）──────────────────────────────────────────────
// 資料量小（單一使用者的資料夾數不多），用 JS 迴圈/遞迴即可，不必寫遞迴 SQL。上溯／遞迴皆設
// 上限，防禦任何理論上的髒資料（parent_id 形成循環）造成無窮迴圈或堆疊溢位。
const WALK_GUARD_LIMIT = 20;

// folder 本身的深度（根層＝1），沿 parent_id 鏈往上數。folder 需為已用 getOwnedFolder 取得的列，
// 呼叫端已確認擁有權；祖先鏈上的其他列本就只可能由同一 owner 建立（parent_id 只在驗證過擁有權後
// 才會被設定，見 omsvFolderCreate／omsvFolderMove），故上溯時不必逐層重覆帶 owner_email 條件。
function folderDepth(db, folder) {
  let depth = 1;
  let currentParentId = folder ? folder.parent_id : null;
  let guard = 0;
  while (currentParentId != null && guard < WALK_GUARD_LIMIT) {
    depth++;
    guard++;
    const row = db.prepare('SELECT parent_id FROM openmail_archive_folders WHERE id = ?').get(currentParentId);
    currentParentId = row ? row.parent_id : null;
  }
  return depth;
}

// candidateId 是否為 nodeId 自己、或 nodeId 的祖先（沿 nodeId 的 parent_id 鏈往上找）。用來判斷
// 「要不要把某資料夾移到它自己或自己的子孫底下」的循環情況：呼叫端傳入
// (folder.id, 目標父層.id)，true 就代表目標父層其實是這個資料夾自己或它的子孫。
function isAncestorOrSelf(db, candidateId, nodeId) {
  let currentId = nodeId;
  let guard = 0;
  while (currentId != null && guard < WALK_GUARD_LIMIT) {
    if (currentId === candidateId) return true;
    guard++;
    const row = db.prepare('SELECT parent_id FROM openmail_archive_folders WHERE id = ?').get(currentId);
    currentId = row ? row.parent_id : null;
  }
  return false;
}

// 以 folderId 為根的子樹高度（葉節點＝1，往下每多一層 +1）。BFS 逐層展開，只查同一 owner 底下
// 的子資料夾（子孫的 parent_id 皆已驗證過擁有權才會被設定，同 folderDepth 的假設）。
function subtreeHeight(db, ownerEmail, folderId) {
  let height = 1;
  let frontier = [folderId];
  let guard = 0;
  while (frontier.length && guard < WALK_GUARD_LIMIT) {
    guard++;
    const placeholders = frontier.map(() => '?').join(',');
    const children = db.prepare(
      `SELECT id FROM openmail_archive_folders WHERE owner_email = ? AND parent_id IN (${placeholders})`
    ).all(ownerEmail, ...frontier);
    if (!children.length) break;
    height++;
    frontier = children.map((c) => c.id);
  }
  return height;
}

function validName(name) {
  const trimmed = String(name == null ? '' : name).trim();
  if (!trimmed || trimmed.length > MAX_FOLDER_NAME_LEN) return null;
  return trimmed;
}

function isUniqueViolation(err) {
  return !!(err && /UNIQUE/i.test(String(err.message || err.code || '')));
}

// v234：parentId 為選用——省略/null 建在根層；有給時須是自己名下的資料夾（跨 owner 一律
// omsv_folder_not_found，不洩漏存在性），且父層深度已達上限時拒絕（omsv_folder_too_deep）。
function omsvFolderCreate(db, ownerEmail, params) {
  const name = validName(params && params.name);
  if (!name) return { error: 'omsv_invalid_name' };
  const parentIdRaw = params && params.parentId;
  let parentFolder = null;
  if (parentIdRaw != null) {
    parentFolder = getOwnedFolder(db, ownerEmail, parentIdRaw);
    if (!parentFolder) return { error: 'omsv_folder_not_found' };
    if (folderDepth(db, parentFolder) >= MAX_FOLDER_DEPTH) return { error: 'omsv_folder_too_deep' };
  }
  try {
    const info = db.prepare('INSERT INTO openmail_archive_folders (owner_email, name, parent_id) VALUES (?, ?, ?)')
      .run(ownerEmail, name, parentFolder ? parentFolder.id : null);
    return { ok: true, id: info.lastInsertRowid, name, parentId: parentFolder ? parentFolder.id : null };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'omsv_folder_name_taken' };
    throw err;
  }
}

// 跨 owner 存取一律拒絕：查詢本身就帶 owner_email 條件，別人的資料夾（即使 id 存在）查不到，
// 呼叫端一律視為 omsv_folder_not_found（不洩漏「這個 id 其實存在，只是不是你的」）。
function getOwnedFolder(db, ownerEmail, folderId) {
  const id = Number(folderId);
  if (!Number.isFinite(id)) return null;
  return db.prepare('SELECT * FROM openmail_archive_folders WHERE id = ? AND owner_email = ?').get(id, ownerEmail);
}

function omsvFolderRename(db, ownerEmail, params) {
  const folder = getOwnedFolder(db, ownerEmail, params && params.folderId);
  if (!folder) return { error: 'omsv_folder_not_found' };
  const name = validName(params && params.name);
  if (!name) return { error: 'omsv_invalid_name' };
  try {
    db.prepare('UPDATE openmail_archive_folders SET name = ? WHERE id = ?').run(name, folder.id);
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'omsv_folder_name_taken' };
    throw err;
  }
}

// 資料夾內還有信、或還有子資料夾時拒刪，提示先清空（見任務規格）——避免誤刪連帶遺失已封存的
// 信件內容，或讓子資料夾變成沒有 owner 可觸及的孤兒列（parent_id 指向一個已被刪除的 id）。
function omsvFolderDelete(db, ownerEmail, params) {
  const folder = getOwnedFolder(db, ownerEmail, params && params.folderId);
  if (!folder) return { error: 'omsv_folder_not_found' };
  const msgCount = db.prepare('SELECT COUNT(*) AS n FROM openmail_archive_messages WHERE folder_id = ?').get(folder.id).n;
  if (msgCount > 0) return { error: 'omsv_folder_not_empty' };
  const childCount = db.prepare('SELECT COUNT(*) AS n FROM openmail_archive_folders WHERE parent_id = ?').get(folder.id).n;
  if (childCount > 0) return { error: 'omsv_folder_not_empty' };
  db.prepare('DELETE FROM openmail_archive_folders WHERE id = ?').run(folder.id);
  return { ok: true };
}

// v234：把資料夾移到另一個資料夾底下（或省略/null parentId 移回根層）。folderId／parentId 皆須是
// 自己名下的資料夾（跨 owner 一律 omsv_folder_not_found）。兩種業務錯誤：
//   - omsv_folder_cycle：目標父層是自己，或自己的子孫（會形成循環，parent_id 鏈永遠走不到根）。
//   - omsv_folder_too_deep：移動後，被移子樹裡最深的那個資料夾會超過 MAX_FOLDER_DEPTH 層
//     （新深度 = 目標父層深度 + 被移子樹高度；移回根層時目標父層深度視為 0）。
function omsvFolderMove(db, ownerEmail, params) {
  const folder = getOwnedFolder(db, ownerEmail, params && params.folderId);
  if (!folder) return { error: 'omsv_folder_not_found' };

  const parentIdRaw = params && params.parentId;
  let parentFolder = null;
  if (parentIdRaw != null) {
    parentFolder = getOwnedFolder(db, ownerEmail, parentIdRaw);
    if (!parentFolder) return { error: 'omsv_folder_not_found' };
    if (isAncestorOrSelf(db, folder.id, parentFolder.id)) return { error: 'omsv_folder_cycle' };
  }

  const newParentDepth = parentFolder ? folderDepth(db, parentFolder) : 0;
  const movedSubtreeHeight = subtreeHeight(db, ownerEmail, folder.id);
  if (newParentDepth + movedSubtreeHeight > MAX_FOLDER_DEPTH) return { error: 'omsv_folder_too_deep' };

  db.prepare('UPDATE openmail_archive_folders SET parent_id = ? WHERE id = ?').run(parentFolder ? parentFolder.id : null, folder.id);
  return { ok: true };
}

// ── 封存信件列表／單封讀取／附件／刪除 ──────────────────────────────────

function omsvList(db, ownerEmail, params) {
  const folder = getOwnedFolder(db, ownerEmail, params && params.folderId);
  if (!folder) return { error: 'omsv_folder_not_found' };
  const rows = db.prepare(
    `SELECT id, subject, from_addr, to_addr, date, size_bytes, created_at
     FROM openmail_archive_messages WHERE folder_id = ? ORDER BY date DESC, id DESC`
  ).all(folder.id);
  return {
    messages: rows.map((r) => ({
      id: r.id,
      subject: r.subject || '',
      from: r.from_addr || '',
      to: r.to_addr || '',
      date: r.date,
      size: r.size_bytes,
      archivedAt: r.created_at,
    })),
  };
}

// 單筆存取直接用 id+owner_email 做 owner 檢查，不必每次 JOIN folders（見 migration 007 檔頭註解）。
function getOwnedMessageRow(db, ownerEmail, messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id)) return null;
  return db.prepare('SELECT * FROM openmail_archive_messages WHERE id = ? AND owner_email = ?').get(id, ownerEmail);
}

async function omsvGet(db, ownerEmail, params) {
  const row = getOwnedMessageRow(db, ownerEmail, params && params.id);
  if (!row) return { error: 'omsv_message_not_found' };
  let parsed;
  try {
    parsed = await simpleParser(row.source);
  } catch (_e) {
    return { error: 'omsv_parse_failed' };
  }
  return omActions.buildMessageView(parsed, { id: row.id, folderId: row.folder_id, size: row.size_bytes });
}

async function omsvDownloadAttachment(db, ownerEmail, params) {
  const row = getOwnedMessageRow(db, ownerEmail, params && params.id);
  if (!row) return { error: 'omsv_message_not_found' };
  const index = params && params.index;
  if (index == null) return { error: 'omsv_attachment_not_found' };
  let parsed;
  try {
    parsed = await simpleParser(row.source);
  } catch (_e) {
    return { error: 'omsv_parse_failed' };
  }
  const att = (parsed.attachments || [])[Number(index)];
  if (!att) return { error: 'omsv_attachment_not_found' };
  return {
    filename: att.filename || `attachment-${Number(index) + 1}`,
    contentType: att.contentType || 'application/octet-stream',
    base64: (att.content || Buffer.alloc(0)).toString('base64'),
  };
}

function omsvDelete(db, ownerEmail, params) {
  const row = getOwnedMessageRow(db, ownerEmail, params && params.id);
  if (!row) return { error: 'omsv_message_not_found' };
  db.prepare('DELETE FROM openmail_archive_messages WHERE id = ?').run(row.id);
  return { ok: true };
}

// ── 封存（從 openmail IMAP 抓完整原始信、存進本表；成功且 deleteFromMail 才嘗試從 openmail 刪除）──
//
// 失敗時絕不刪信：INSERT 成功之後才會嘗試刪除，而且刪除失敗也不會回滾已寫入的封存列（寧可信件
// 同時留在兩邊、由使用者事後自行清理，也不冒著「封存寫入成功但因為刪除失敗的例外處理不慎，
// 反而把剛封存好的唯一副本也弄丟」的風險）。回傳 deleted:false + deleteError 時，前端應提示
// 使用者「已封存，但未能從 openmail 刪除原信，請自行確認」。
async function omsvArchiveMessage(db, ownerEmail, config, params) {
  const p = params || {};
  const folder = p.folder;
  const uid = p.uid;
  const targetFolderId = p.targetFolderId;
  const deleteFromMail = !!p.deleteFromMail;
  if (!folder || uid == null || targetFolderId == null) {
    throw new Error('omsvArchiveMessage: 缺少 folder/uid/targetFolderId');
  }

  const targetFolder = getOwnedFolder(db, ownerEmail, targetFolderId);
  if (!targetFolder) return { error: 'omsv_folder_not_found' };

  const creds = credStore.get(ownerEmail);
  if (!creds) return { error: 'mail_not_connected' };

  let sourceBuf;
  try {
    sourceBuf = await client.withImap(ownerEmail, creds.mailUser, creds.mailPass, config, async (imap) => {
      const lock = await imap.getMailboxLock(folder);
      try {
        const msg = await imap.fetchOne(Number(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) throw new Error('mail_message_not_found');
        return msg.source;
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    return { error: 'omsv_fetch_failed', detail: errMsg(err) };
  }

  if (!sourceBuf || sourceBuf.length > MAX_ARCHIVE_MESSAGE_BYTES) {
    return { error: 'omsv_too_large' };
  }

  let parsed;
  try {
    parsed = await simpleParser(sourceBuf);
  } catch (_e) {
    return { error: 'omsv_parse_failed' };
  }

  const fromAddr = (omActions.firstAddr(parsed.from) || {}).address || '';
  const toAddr = omActions.addrList(parsed.to).map((a) => a.address).filter(Boolean).join(', ');
  const dateIso = parsed.date ? new Date(parsed.date).toISOString() : null;

  const info = db.prepare(
    `INSERT INTO openmail_archive_messages (folder_id, owner_email, subject, from_addr, to_addr, date, size_bytes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(targetFolder.id, ownerEmail, parsed.subject || '', fromAddr, toAddr, dateIso, sourceBuf.length, sourceBuf);

  let deleted = false;
  let deleteError;
  if (deleteFromMail) {
    try {
      await client.withImap(ownerEmail, creds.mailUser, creds.mailPass, config, async (imap) => {
        const lock = await imap.getMailboxLock(folder);
        try {
          await imap.messageDelete(Number(uid), { uid: true });
        } finally {
          lock.release();
        }
      });
      deleted = true;
    } catch (err) {
      deleteError = errMsg(err);
    }
  }

  const result = { ok: true, archivedId: info.lastInsertRowid, deleted };
  if (deleteError) result.deleteError = deleteError;
  return result;
}

module.exports = {
  omsvFolderList,
  omsvFolderCreate,
  omsvFolderRename,
  omsvFolderDelete,
  omsvFolderMove,
  omsvArchiveMessage,
  omsvList,
  omsvGet,
  omsvDownloadAttachment,
  omsvDelete,
  // exported for tests
  MAX_ARCHIVE_MESSAGE_BYTES,
  MAX_FOLDER_DEPTH,
};
