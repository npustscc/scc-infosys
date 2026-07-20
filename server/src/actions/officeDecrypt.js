// server/src/actions/officeDecrypt.js — decryptOfficeFile：後端解密有密碼保護的 Office 檔案
// （xlsx/xls），供前端匯入 Excel／附件上傳流程使用。SheetJS CE（前端既有 xlsx 套件）無法解密加密檔
// （已實測），改由後端用 officecrypto-tool（相依僅 cfb/crypto-js/xml2js，無網路呼叫）解密後把明文
// base64 回傳給前端。
//
// 走 dispatch.js 一般授權閘（不在 gate.AUTHZ_EXEMPT）——本系統資安原則 1：預設 deny，任何需要
// 授權的 action 一律過 isAuthorizedUser_ 等價閘門，不因為「只是個工具函式」而破例免授權。
//
// 業務錯誤一律回傳 { error: 'xxx' }（不 throw），比照 sms/actions.js／openmail/actions.js 既有慣例
// ——dispatch.js 的 envelope.ok() 會原樣包裝成 { success:true, data:{ error:'xxx' } }，前端據此判讀。
//
// 資安（CLAUDE.md 原則 3 去識別化＋原則 2 機密不落地）：
//   - password 從不落 audit_log（audit.js CONFIDENTIAL_KEYS 已含 'password'，連長度都不記）。
//   - 本 action 的參數本就不含檔名（params 只有 dataBase64/password/probe，見規格），故無檔名可落。
//   - 檔案內容（dataBase64／解密後 dataBase64）一律不進 audit_log 內容本身，預設摘要只記字串長度
//     （見 audit.summarizeParams），不記位元組內容。
//   - 任何錯誤回傳（含 decrypt_failed 分支）一律不夾帶底層例外訊息字串——officecrypto-tool 的錯誤
//     訊息理論上不含密碼本身，但為求保守（避免任何側洩漏管道），一律只回固定錯誤碼，不回傳 detail。
'use strict';

const officecrypto = require('officecrypto-tool');
const attachmentActions = require('./attachments');

// 單檔大小上限：比照 uploadFile（見 actions/attachments.js MAX_ATTACHMENT_BYTES 檔頭註解），
// 沿用同一個常數，不重複定義，避免兩處上限日後修改時漏改其中一處。
const MAX_BYTES = attachmentActions.MAX_ATTACHMENT_BYTES;

function decodeBase64(dataBase64) {
  if (!dataBase64 || typeof dataBase64 !== 'string') return null;
  let bytes;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch (_e) {
    return null;
  }
  return bytes.length ? bytes : null;
}

// params: { dataBase64, password, probe }
async function decryptOfficeFile(params) {
  const p = params || {};
  const probe = p.probe === true;

  const bytes = decodeBase64(p.dataBase64);
  if (!bytes) return { error: 'invalid_params' };
  if (bytes.length > MAX_BYTES) return { error: 'file_too_large' };

  let encrypted = false;
  try {
    encrypted = !!officecrypto.isEncrypted(bytes);
  } catch (_e) {
    // isEncrypted 對格式不明的檔案理論上不該拋錯，但保守起見視為「非加密」——後續流程（未加密
    // 分支）本就是「不回傳內容、前端自己有原檔」，不會因此誤放行任何資料。
    encrypted = false;
  }

  if (probe) return { encrypted };

  if (!encrypted) return { encrypted: false };

  if (!p.password || typeof p.password !== 'string') return { error: 'invalid_params' };

  let decrypted;
  try {
    decrypted = await officecrypto.decrypt(bytes, { password: p.password });
  } catch (err) {
    const msg = String((err && err.message) || err || '');
    if (/password is incorrect/i.test(msg)) return { error: 'wrong_password' };
    return { error: 'decrypt_failed' };
  }

  return { encrypted: true, dataBase64: Buffer.from(decrypted).toString('base64') };
}

module.exports = { decryptOfficeFile, MAX_BYTES };
