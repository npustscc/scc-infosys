// server/src/openmail/credPersist.js — v235：信箱「記住密碼（自動登入）」opt-in 落地儲存。
//
// 資安模型（見 migrations/009_openmail_saved_creds.sql 檔頭與 credStore.js 檔頭「密碼永不落地」
// 的最高資安要求）：
//   - 這是使用者裁決的**唯一例外**（2026-07-20 裁決）：只有使用者在 omConnect 時主動勾選
//     rememberMe===true，且伺服器已設定加密金鑰（OPENMAIL_CRED_KEY），密碼才會離開記憶體落地到
//     sqlite；預設關（不勾）＝行為與改動前完全一致，credStore.js 的「永不落地」原則對未 opt-in
//     的使用者絲毫不變。
//   - fail-closed：金鑰未設定（keyFromConfig 回 null）→ save/hydrate 一律不動作、視同功能關閉；
//     解密失敗（金鑰換過、密文損毀、AAD 不符）→ hydrate 直接刪除該列（壞資料不留），不 throw、
//     不讓呼叫端誤以為「有存但读不出來」的狀態懸在那裡。
//   - 金鑰與密文同機存放的侷限：見 migration 檔頭「資安取捨」段落，本模組不重複展開。
//   - 密碼明文與金鑰本身永不進 log／audit／回傳前端——本模組所有函式的回傳值只有布林/null，
//     從不回傳解密後的帳密（呼叫端經由 credStore.set 取用，不經過這裡的回傳值）。
'use strict';

const crypto = require('node:crypto');
const credStore = require('./credStore');

const KEY_HEX_LEN = 64; // 32 bytes
const IV_BYTES = 12;    // AES-GCM 建議 96-bit IV

// 從 config.OPENMAIL_CRED_KEY（.env 的 OPENMAIL_CRED_KEY，比照既有 config.OPENMAIL_IMAP_HOST 等
// UPPER_SNAKE 命名慣例，見 config.js）解出 32-byte Buffer；格式不符（非 64 hex chars）或未設定
// 一律回 null（fail-closed，呼叫端據此判斷功能是否可用，不 throw）。
function keyFromConfig(config) {
  const raw = config && config.OPENMAIL_CRED_KEY;
  if (typeof raw !== 'string' || raw.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(raw)) return null;
  try {
    return Buffer.from(raw, 'hex');
  } catch (_e) {
    return null;
  }
}

// AES-256-GCM 加密 {mailUser, mailPass} → `base64(iv).base64(authTag).base64(ciphertext)`。
// AAD 綁定 ownerEmail：即使密文列被搬到另一個 owner_email 底下（理論上的資料庫層級竄改），解密
// 時 AAD 不符會直接失敗，不會被用來冒充別人已儲存的憑證。
function encryptCreds(key, ownerEmail, mailUser, mailPass) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(ownerEmail)));
  const plaintext = Buffer.from(JSON.stringify({ u: mailUser, p: mailPass }), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

// 解密失敗（格式錯／驗證失敗／AAD 不符）一律回 null，絕不 throw——呼叫端（hydrate）據此判斷要
// 把壞資料整列刪除，不能讓一筆解不開的密文炸掉整個 dispatch 呼叫鏈。
function decryptCreds(key, ownerEmail, enc) {
  if (typeof enc !== 'string') return null;
  const parts = enc.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(String(ownerEmail)));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    const obj = JSON.parse(plaintext.toString('utf8'));
    if (!obj || typeof obj.u !== 'string' || typeof obj.p !== 'string') return null;
    return { mailUser: obj.u, mailPass: obj.p };
  } catch (_e) {
    return null;
  }
}

// UPSERT——重複勾選「記住密碼」重連時覆蓋舊密文（帳密可能已換），不留舊列。
function save(db, key, ownerEmail, mailUser, mailPass) {
  if (!key || !ownerEmail) return;
  const enc = encryptCreds(key, ownerEmail, mailUser, mailPass);
  db.prepare(
    `INSERT INTO openmail_saved_creds (owner_email, enc, created_at, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(owner_email) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at`
  ).run(ownerEmail, enc);
}

function remove(db, ownerEmail) {
  if (!ownerEmail) return;
  db.prepare('DELETE FROM openmail_saved_creds WHERE owner_email = ?').run(ownerEmail);
}

function hasSaved(db, ownerEmail) {
  if (!ownerEmail) return false;
  return !!db.prepare('SELECT 1 FROM openmail_saved_creds WHERE owner_email = ?').get(ownerEmail);
}

// 每次 om*/omsv* 呼叫前由 dispatch.js 呼叫一次（見 dispatch.js hydrate 註解）：credStore 已有值
// （記憶體快取未過期）→ 不動作、回 false（對已 opt-in 且記憶體仍有值的使用者，這是唯一路徑，
// 一次呼叫只查一次記憶體 Map，不碰 sqlite）；credStore 無值時才查 sqlite：
//   - 查無此 owner_email → 回 false（從未勾選「記住密碼」，或已被 remove）。
//   - 解密失敗（金鑰換過／密文損毀／AAD 不符）→ 整列刪除（fail-closed，不留壞資料），回 false。
//   - 成功 → credStore.set 回填記憶體，回 true。
// key 為 null（金鑰未設定）直接回 false，不查 db——功能整個關閉時這是最低成本路徑。
function hydrate(db, key, ownerEmail) {
  if (!key || !ownerEmail) return false;
  if (credStore.get(ownerEmail)) return false; // 記憶體已有值，不需要 hydrate
  const row = db.prepare('SELECT enc FROM openmail_saved_creds WHERE owner_email = ?').get(ownerEmail);
  if (!row) return false;
  const creds = decryptCreds(key, ownerEmail, row.enc);
  if (!creds) {
    remove(db, ownerEmail); // 壞資料不留，下次呼叫不必再解一次注定失敗的密文
    return false;
  }
  credStore.set(ownerEmail, creds.mailUser, creds.mailPass);
  return true;
}

module.exports = { keyFromConfig, encryptCreds, decryptCreds, save, remove, hasSaved, hydrate };
