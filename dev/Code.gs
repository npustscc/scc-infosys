// Code.gs — SCC Drive Proxy（測試版）
// 執行身份：Me (npust.scc)；存取：任何擁有 Google 帳戶
// ⚠️ 此為測試版專用 GAS，只能存取 dev 資料夾，不可存取正式版資料。

const CLIENT_ID      = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
const ROOT_FOLDER_ID = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';  // dev 資料夾
const CALENDAR_NAME  = '[DEV] SCC 空間預約';
const CONFIG_FILE_ID_OVERRIDE = null;  // dev 版從 root 路徑查找 config.json

// 白名單：只允許 dev 資料夾
const ALLOWED_ROOTS = {
  '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx': { configOverride: null, calendarName: '[DEV] SCC 空間預約', gmailLabel: 'ml-processed-dev' },
};

// 緊急備援名單：即使 config 讀不到或帳號不在名單，這些帳號仍可登入以修復系統（對應前端 BOOTSTRAP_ADMIN_EMAIL）。
// 註：列出 email 不構成後門——仍須持有該帳號的 Google 憑證（有效 ID token）才通過，攻擊者知道 email 也無法冒充。
const BOOTSTRAP_ADMINS = ['npust.scc@heartnpust.tw', 'linkinlol528101@gmail.com'];

// ── 進入點 ────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const payload = JSON.parse(e.parameter.payload);
    const { idToken, action, rootFolderId, ...params } = payload;

    // OAuth2 code exchange 不需要 idToken（code 本身即為授權證明）
    if (action === 'exchangeNpust5OAuthCode') {
      return jsonResp_(exchangeNpust5OAuthCode_(params));
    }

    const userEmail = verifyIdToken_(idToken);
    if (!userEmail) return jsonResp_({ error: 'Unauthorized' });

    // 根據前端傳入的 rootFolderId 決定此次請求的資料根目錄與日曆名稱
    let ctx = { root: ROOT_FOLDER_ID, configOverride: CONFIG_FILE_ID_OVERRIDE, calendarName: CALENDAR_NAME };
    if (rootFolderId) {
      if (ALLOWED_ROOTS[rootFolderId]) {
        const rootCfg = ALLOWED_ROOTS[rootFolderId];
        ctx = { root: rootFolderId, configOverride: rootCfg.configOverride, calendarName: rootCfg.calendarName || CALENDAR_NAME, gmailLabel: rootCfg.gmailLabel || 'ml-processed-dev' };
      } else {
        // 例外白名單：issues.json (許願池/錯誤回報) 允許跨環境（dev/prod 共用同一份）
        const p = params.path || params.name || '';
        const isIssuesOp = p === 'issues.json';
        if (!isIssuesOp) return jsonResp_({ error: 'Unauthorized rootFolderId' });
        ctx = { root: rootFolderId, configOverride: null, calendarName: CALENDAR_NAME };
      }
    }

    // ── 使用者授權閘：email 必須存在於 config.users 且未停用（少數 action 例外）──
    // 修補重大漏洞：先前僅驗證 ID token 對 CLIENT_ID 有效，未比對授權名單，導致任何 Google 帳號
    // 皆可用公開的 CLIENT_ID / APPS_SCRIPT_URL / rootFolderId 直接撈取或竄改全部個案資料。
    // ping（探測）與 submitUserApplication（尚未獲授權者申請帳號的唯一入口）需在授權前放行。
    var AUTHZ_EXEMPT = { ping: true, submitUserApplication: true };
    if (!AUTHZ_EXEMPT[action] && !isAuthorizedUser_(userEmail, ctx)) {
      return jsonResp_({ error: 'Unauthorized user' });
    }

    let result;
    switch (action) {
      case 'ping':               result = { ok: true, email: userEmail }; break;
      case 'getMetadata':        result = getMetadata_(params); break;
      case 'readJson':           result = readJson_(params, ctx); break;
      case 'readJsonById':       result = readJsonById_(params); break;
      case 'createJson':         result = createJson_(params); break;
      case 'updateJson':         result = updateJson_(params, ctx); break;
      case 'createFolder':       result = createFolder_(params); break;
      case 'trashFile':          result = trashFile_(params); break;
      case 'deleteFile':         result = deleteFile_(params); break;
      case 'moveFile':           result = moveFile_(params); break;
      case 'updateContentById':  result = updateContentById_(params); break;
      case 'query':              result = driveQuery_(params); break;
      case 'listFolder':         result = listFolder_(params); break;
      case 'listDir':            result = listDir_(params, ctx); break;
      case 'resolveDir':         result = resolveDir_(params, ctx); break;
      case 'createCalendarEvent':  result = createCalendarEvent_(params, ctx); break;
      case 'updateCalendarEvent':  result = updateCalendarEvent_(params, ctx); break;
      case 'deleteCalendarEvent':  result = deleteCalendarEvent_(params, ctx); break;
      case 'listCalendarEvents':   result = listCalendarEvents_(params, ctx); break;
      case 'shareCalendarWriters': result = shareCalendarWriters_(params, ctx); break;
      case 'gcAnnotateEvent':      result = gcAnnotateEvent_(params, ctx); break;
      case 'uploadFile':           result = uploadFile_(params); break;
      case 'downloadFileBase64':   result = downloadFileBase64_(params); break;
      case 'fetchMentalLeaves':    result = fetchMentalLeaves_(ctx, params); break;
      case 'getNpust5AuthUrl':     result = getAuthUrlNpust5_(); break;
      case 'dumpNpust5Emails':     result = dumpNpust5Emails_(ctx); break;
      case 'listInboxEmails':      result = listInboxEmails_(ctx); break;
      case 'clearMentalLeaves':              result = clearMentalLeaves_(ctx); break;
      case 'countMentalLeavesUnprocessed':   result = countMentalLeavesUnprocessed_(ctx); break;
      case 'submitUserApplication': result = submitUserApplication_({ ...params, submittedByEmail: userEmail, ctx }); break;
      case 'startupBatch':         result = startupBatch_(params, ctx); break;
      case 'casesUpsert':          result = casesUpsert_(params, ctx); break;
      default: return jsonResp_({ error: 'Unknown action: ' + action });
    }
    return jsonResp_(result);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Handle OAuth2 callback for npust5 Gmail
  if (e && e.parameter && e.parameter.code) {
    return npust5HandleOAuthCallback_(e);
  }
  return jsonResp_({ ok: true, service: 'SCC Drive Proxy (DEV)' });
}

// ── ID Token 驗證 ─────────────────────────────────────────────────────────────

function verifyIdToken_(idToken) {
  // CacheService 快取：同一 idToken 在 5 分鐘內跳過外部 tokeninfo HTTP 呼叫
  // idToken 末尾為 JWT 簽章（每個 token 唯一），取末 199 字元作為 key（CacheService 限制 250 字元）
  const cache = CacheService.getScriptCache();
  const cacheKey = 't' + idToken.slice(-199);
  try {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  } catch (_) {}
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken,
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const d = JSON.parse(res.getContentText());
    if (d.aud !== CLIENT_ID) return null;
    if (Number(d.exp) < Math.floor(Date.now() / 1000)) return null;
    try { cache.put(cacheKey, d.email, 300); } catch (_) {}
    return d.email;
  } catch (e) { return null; }
}

// ── 使用者授權閘 ──────────────────────────────────────────────────────────────
// email 必須存在於 config.users 且未停用（判定基準與前端 resolveUserRole 一致）。
// fail-closed：config 讀不到一律拒絕（BOOTSTRAP_ADMINS 例外，避免 config 全毀時管理者被鎖死）。
// 命中結果以 CacheService 快取 5 分鐘，避免每個請求都多讀一次 config。
// 副作用：新增/停用使用者後，後端授權狀態最多延遲 5 分鐘生效。
function isAuthorizedUser_(userEmail, ctx) {
  if (!userEmail) return false;
  if (BOOTSTRAP_ADMINS.indexOf(userEmail) !== -1) return true;
  var cache = CacheService.getScriptCache();
  var key = 'authz:' + userEmail.slice(0, 240);
  try { if (cache.get(key) === '1') return true; } catch (_) {}
  try {
    var cfgId = ctx.configOverride || resolvePathToId_('config.json', ctx);
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return false;
    var cfg = JSON.parse(res.getContentText());
    var u = cfg && cfg.users && cfg.users[userEmail];
    var ok = !!u && u.disabled !== true;
    if (ok) { try { cache.put(key, '1', 300); } catch (_) {} }
    return ok;
  } catch (e) { return false; }
}

// ── 回應工具 ──────────────────────────────────────────────────────────────────

function jsonResp_(data) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Drive API 底層 ────────────────────────────────────────────────────────────

function tok_() { return ScriptApp.getOAuthToken(); }

function driveGet_(path, qParams) {
  const base = { supportsAllDrives: true, includeItemsFromAllDrives: true };
  const merged = Object.assign(base, qParams || {});
  const qs = Object.entries(merged).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/' + path + '?' + qs,
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(body.error && body.error.message || 'Drive error');
  return body;
}

function drivePatch_(fileId, metadata) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?supportsAllDrives=true',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true
    }
  );
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(body.error && body.error.message || 'Drive error');
  return body;
}

function driveDelete_(fileId) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?supportsAllDrives=true',
    { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) {
    const body = JSON.parse(res.getContentText() || '{}');
    throw new Error(body.error && body.error.message || 'Delete error');
  }
  return { ok: true };
}

function driveUpload_(name, jsonContent, parentId) {
  const body = JSON.stringify(jsonContent);
  const boundary = 'scc_boundary';
  const metadata = JSON.stringify({ name: name, mimeType: 'application/json', parents: [parentId] });
  const multipart =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    body + '\r\n' +
    '--' + boundary + '--';
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok_(),
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      payload: multipart,
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'Upload error');
  return data;
}

function driveUpdateContent_(fileId, jsonContent) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media&supportsAllDrives=true',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: JSON.stringify(jsonContent),
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'Update error');
  return data;
}

// 路徑解析：把 "cases/manifest.json" 轉成 fileId
function resolvePathToId_(path, ctx) {
  if (path === 'config.json' && ctx.configOverride) return ctx.configOverride;
  const parts = path.split('/');
  let curId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const q = "name='" + parts[i] + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + curId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    curId = res.files[0].id;
  }
  const fileName = parts[parts.length - 1];
  const q2 = "name='" + fileName + "' and '" + curId + "' in parents and trashed=false";
  const res2 = driveGet_('files', { q: q2, fields: 'files(id)', orderBy: 'modifiedTime desc', pageSize: '5' });
  if (!res2.files || res2.files.length === 0) throw new Error('File not found: ' + path);
  if (res2.files.length > 1) {
    res2.files.slice(1).forEach(function(f) { try { drivePatch_(f.id, { trashed: true }); } catch(e) {} });
  }
  return res2.files[0].id;
}

function resolvePathToParentAndName_(path, ctx) {
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  let parentId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const q = "name='" + parts[i] + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + parentId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    parentId = res.files[0].id;
  }
  return { parentId, fileName };
}

// ── Drive Actions ─────────────────────────────────────────────────────────────

function getMetadata_({ fileId, fields }) {
  return driveGet_('files/' + fileId, { fields: fields || 'id,name,mimeType' });
}

function readJson_({ path }, ctx) {
  const fileId = resolvePathToId_(path, ctx);
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) throw new Error('readJson failed: ' + path);
  return JSON.parse(res.getContentText());
}

function readJsonById_({ fileId }) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) throw new Error('readJsonById failed: ' + fileId);
  return JSON.parse(res.getContentText());
}

function createJson_({ name, content, parentId }) {
  return driveUpload_(name, content, parentId);
}

function updateContentById_({ fileId, content }) {
  return driveUpdateContent_(fileId, content);
}

function updateJson_({ path, content }, ctx) {
  let fileId;
  try {
    fileId = resolvePathToId_(path, ctx);
  } catch (notFound) {
    const { parentId, fileName } = resolvePathToParentAndName_(path, ctx);
    const verify = driveGet_('files', {
      q: "name='" + fileName + "' and '" + parentId + "' in parents and trashed=false",
      fields: 'files(id)', orderBy: 'modifiedTime desc', pageSize: '5'
    });
    if (verify.files && verify.files.length > 0) {
      fileId = verify.files[0].id;
      verify.files.slice(1).forEach(function(f) { try { drivePatch_(f.id, { trashed: true }); } catch(e) {} });
    } else {
      return driveUpload_(fileName, content, parentId);
    }
  }
  return driveUpdateContent_(fileId, content);
}

function createFolder_({ name, parentId }) {
  const metadata = JSON.stringify({
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  });
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: metadata,
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'createFolder error');
  return data;
}

function trashFile_({ fileId }) {
  return drivePatch_(fileId, { trashed: true });
}

function deleteFile_({ fileId }) {
  return driveDelete_(fileId);
}

function moveFile_({ fileId, addParents, removeParents }) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?addParents=' + encodeURIComponent(addParents) +
    '&removeParents=' + encodeURIComponent(removeParents) +
    '&supportsAllDrives=true&fields=id,parents',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: '{}',
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'moveFile error');
  return data;
}

function driveQuery_({ q, fields, pageSize }) {
  return driveGet_('files', {
    q: q,
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 100)
  });
}

function listFolder_({ folderId, fields, pageSize }) {
  return driveGet_('files', {
    q: "'" + folderId + "' in parents and trashed=false",
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 400)
  });
}

function resolveDir_({ path }, ctx) {
  const parts = path.split('/');
  let curId = ctx.root;
  for (let i = 0; i < parts.length; i++) {
    const q = "name='" + parts[i] + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + curId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    curId = res.files[0].id;
  }
  return { id: curId };
}

function listDir_({ path, fields, pageSize }, ctx) {
  const { id: folderId } = resolveDir_({ path }, ctx);
  return driveGet_('files', {
    q: "'" + folderId + "' in parents and trashed=false",
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 400)
  });
}

// ── Calendar Actions ──────────────────────────────────────────────────────────

function getOrCreateCalendar_(ctx) {
  const name = (ctx && ctx.calendarName) || CALENDAR_NAME;
  const cals = CalendarApp.getCalendarsByName(name);
  if (cals.length === 1) return cals[0];
  if (cals.length > 1) {
    throw new Error('找到 ' + cals.length + ' 顆同名日曆「' + name + '」，請確認共用設定，移除或改名多餘的日曆後再試。');
  }
  throw new Error('找不到日曆「' + name + '」，請確認執行帳號已被加入該日曆共用名單，且權限為「進行變更並管理共用設定」。');
}

function parseEventTimes_(date, startTime, endTime) {
  const [y, m, d] = date.split('-').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return {
    start: new Date(y, m - 1, d, sh, sm),
    end:   new Date(y, m - 1, d, eh, em)
  };
}

function buildEventTitle_(room, counselorName, customRoom) {
  const roomPart = (room === '其他') ? (customRoom || '其他') : (room ? room.charAt(0) : '');
  return counselorName ? roomPart + '.' + counselorName : roomPart;
}

function buildEventDesc_(actorName, notes, dateTime, bkSerial, isEdit) {
  const verb = isEdit ? '編輯' : '建立';
  const pad = n => String(n).padStart(2, '0');
  let desc = notes ? notes.trim() : '';
  let actorLine = '';
  if (actorName || dateTime) {
    let dtStr = '';
    if (dateTime) {
      const d = new Date(dateTime);
      dtStr = ' ' + d.getFullYear() + '/' + pad(d.getMonth()+1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    actorLine = (actorName || '') + ' ' + verb + dtStr;
  }
  if (actorLine) desc += (desc ? '\n---\n' : '---\n') + actorLine;
  if (bkSerial) desc += '\n#' + String(bkSerial).padStart(4, '0');
  return desc;
}

function createCalendarEvent_({ room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, bkSerial, colorId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const title = buildEventTitle_(room, counselorName, customRoom || '');
  const desc  = buildEventDesc_(creatorName || counselorName || '', notes, createdAt, bkSerial, false);
  const event = cal.createEvent(title, start, end, { description: desc });
  if (colorId) {
    try { event.setColor(String(colorId)); } catch (e) { /* colorId 1-11 有效；異常則沿用預設 */ }
  }
  return event.getId();
}

function updateCalendarEvent_({ eventId, room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, updatedAt, isEdit, bkSerial, colorId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (!event) throw new Error('Event not found: ' + eventId);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const actorTime = isEdit ? (updatedAt || createdAt) : createdAt;
  event.setTitle(buildEventTitle_(room, counselorName, customRoom || ''));
  event.setDescription(buildEventDesc_(creatorName || counselorName || '', notes, actorTime, bkSerial, !!isEdit));
  event.setTime(start, end);
  if (colorId) {
    try { event.setColor(String(colorId)); } catch (e) { /* 沿用既有色 */ }
  }
  return { ok: true };
}

function uploadFile_({ parentFolderId, fileName, mimeType, base64Data }) {
  const bytes = Utilities.base64Decode(base64Data);
  const blob  = Utilities.newBlob(bytes, mimeType, fileName);
  const folder = DriveApp.getFolderById(parentFolderId);
  const file  = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName() };
}

function downloadFileBase64_({ fileId }) {
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  return {
    fileName: file.getName(),
    mimeType: blob.getContentType(),
    base64:   Utilities.base64Encode(blob.getBytes()),
  };
}

function deleteCalendarEvent_({ eventId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (event) event.deleteEvent();
  return { ok: true };
}

function listCalendarEvents_({ startDate, endDate }, ctx) {
  const tz  = 'Asia/Taipei';
  const cal = getOrCreateCalendar_(ctx);
  const start = new Date(startDate + 'T00:00:00+08:00');
  const end   = new Date(endDate   + 'T23:59:59+08:00');
  const events = cal.getEvents(start, end);
  return events.map(e => {
    var creators = [];
    try { creators = (e.getCreators() || []); } catch (err) { creators = []; }
    var colorId = '';
    try { colorId = String(e.getColor() || ''); } catch (err) { colorId = ''; }
    return {
      id:           e.getId(),
      title:        e.getTitle(),
      date:         Utilities.formatDate(e.getStartTime(), tz, 'yyyy-MM-dd'),
      startTime:    Utilities.formatDate(e.getStartTime(), tz, 'HH:mm'),
      endTime:      Utilities.formatDate(e.getEndTime(),   tz, 'HH:mm'),
      description:  e.getDescription() || '',
      lastModified: e.getLastUpdated().toISOString(),
      creators:     creators,
      colorId:      colorId,
    };
  });
}

// 補註 GC 事件備註：僅追加文字，不動標題/時間/既有內容。
// - 防重複：description 已含 marker（預設 '[系統補註'）時直接跳過
// - 流水號保護：description 以 #流水號 結尾時，補註插在流水號之前，讓 \n#\d+$ 解析不被破壞
function gcAnnotateEvent_({ eventId, noteText, marker }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (!event) throw new Error('Event not found: ' + eventId);
  const desc = event.getDescription() || '';
  const mk = marker || '[系統補註';
  if (desc.indexOf(mk) !== -1) return { ok: true, skipped: true };
  const add = String(noteText || '').slice(0, 500);
  if (!add) throw new Error('noteText required');
  const serialMatch = desc.match(/\n#\d+\s*$/);
  let newDesc;
  if (serialMatch) {
    const body = desc.slice(0, desc.length - serialMatch[0].length).replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add + serialMatch[0];
  } else {
    const body = desc.replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add;
  }
  event.setDescription(newDesc);
  return { ok: true, skipped: false };
}

// 授與（或撤除）指定 email 對本行事曆的 owner（進行變更並管理共用設定）權限
// 註：CalendarApp.addEditor()/removeEditor() 只有在日曆為執行帳號「原生擁有」時才可用，
// 對於分享而來（即使被授予「管理共用設定」）的日曆一律不存在該方法，因此改用 Calendar 進階服務（Calendar API v3 ACL）操作，
// 其授權以 ACL 角色為準，不受「原生擁有」限制。
function shareCalendarWriters_({ emails, revoke }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const calendarId = cal.getId();
  const results = { granted: [], removed: [], errors: [] };
  (emails || []).forEach(function(email) {
    if (!email || typeof email !== 'string') return;
    const ruleId = 'user:' + email;
    try {
      if (revoke) {
        try {
          Calendar.Acl.remove(calendarId, ruleId);
        } catch (e) {
          if (!/not found/i.test((e && e.message) || '')) throw e;
        }
        results.removed.push(email);
      } else {
        const resource = { role: 'owner', scope: { type: 'user', value: email } };
        try {
          Calendar.Acl.insert(resource, calendarId);
        } catch (e) {
          if (/already exists|duplicate/i.test((e && e.message) || '')) {
            Calendar.Acl.update(resource, calendarId, ruleId);
          } else {
            throw e;
          }
        }
        results.granted.push(email);
      }
    } catch (e) {
      results.errors.push({ email: email, message: (e && e.message) || String(e) });
    }
  });
  return results;
}

// ══════════════════════════════════════════════
//  身心調適假：信箱解析與關鍵字比對
// ══════════════════════════════════════════════

function runFetchMentalLeaves() {
  Object.keys(ALLOWED_ROOTS).forEach(function(rootId) {
    try {
      var ctx = { root: rootId, configOverride: ALLOWED_ROOTS[rootId].configOverride, gmailLabel: ALLOWED_ROOTS[rootId].gmailLabel };
      fetchMentalLeaves_(ctx);
    } catch(e) {
      Logger.log('fetchMentalLeaves 失敗 [' + rootId + ']: ' + e.message);
    }
  });
}

function fetchMentalLeaves_(ctx, opts) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(2000);
  if (!acquired) {
    return { status: 'locked', message: '另一工作階段正在擷取中，請稍後再試' };
  }
  try {
    return fetchMentalLeavesInner_(ctx, opts);
  } finally {
    lock.releaseLock();
  }
}

function fetchMentalLeavesInner_(ctx, opts) {
  var force = opts && opts.force;
  var reparse = opts && opts.reparse;  // 重新解析已擷取信件（保留 handlingStatus 等使用者欄位）
  var token = npust5GetAccessToken_();
  if (!token) {
    return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  }

  var labelName = ctx.gmailLabel || 'ml-processed-dev';

  var existingData = { records: [] };
  try {
    var mlFileId = resolvePathToId_('mental_leaves.json', ctx);
    var mlRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + mlFileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (mlRes.getResponseCode() === 200) {
      existingData = JSON.parse(mlRes.getContentText());
      if (!Array.isArray(existingData.records)) existingData.records = [];
    }
  } catch(e) {}

  var keywords = loadMlKeywords_(ctx);

  var processedLabelId = gmailGetOrCreateLabel_(token, labelName);
  // reparse 模式：查詢已標記的信件（重新解析用）
  var query;
  if (reparse) query = 'subject:(請假 OR 身心調適假 OR 缺課) label:' + labelName;
  else if (force) query = 'subject:(請假 OR 身心調適假 OR 缺課)';
  else query = 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var batchSize = (opts && opts.batchSize) ? opts.batchSize : ((force || reparse) ? 300 : 50);
  var apiUrl = '/messages?q=' + encodeURIComponent(query) + '&maxResults=' + batchSize;
  var pageTokenToUse = (opts && 'pageToken' in opts) ? opts.pageToken : ((force || reparse) ? (existingData.fetchPageToken || null) : null);
  if (pageTokenToUse) apiUrl += '&pageToken=' + encodeURIComponent(pageTokenToUse);
  var searchData = gmailApi_(token, apiUrl);
  var messages = searchData.messages || [];

  var newRecords = [];
  var updatedCount = 0;
  var existingSet = {};
  var existingByEmailId = {};
  existingData.records.forEach(function(r, i) {
    if (r.emailId) { existingSet[r.emailId] = true; existingByEmailId[r.emailId] = i; }
  });

  messages.forEach(function(m) {
    try {
      var msgId = m.id;
      // reparse 模式：不跳過既有，改為 merge；非 reparse 才跳過
      if (!reparse && existingSet[msgId]) return;

      var msg = gmailApi_(token, '/messages/' + msgId + '?format=full');
      var subject = '', fromHdr = '';
      (msg.payload.headers || []).forEach(function(h) {
        var n = h.name.toLowerCase();
        if (n === 'subject') subject = h.value || '';
        else if (n === 'from') fromHdr = h.value || '';
      });

      var bodies = gmailDecodeBody_(msg.payload);
      var plainBody = bodies.text || '';
      var htmlBody  = bodies.html || '';

      var studentId = '', name = '', department = '', reason = '', semester = '';
      var leaveDate = '', leaveDateTo = '', course = '';

      var mId = subject.match(/學號[:：]\s*([A-Z0-9]{7,12})/);
      if (mId) {
        studentId = mId[1].trim();
        var mN = subject.match(new RegExp(studentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([^\\s　]+)'));
        if (mN) name = mN[1].trim();
        var mDp = subject.match(/([^\s　，,。]+)\s*學生請/);
        if (mDp) department = mDp[1].trim();
        var mRs = subject.match(/因\s+(.+?)\s*[，,]\s*申請/);
        if (mRs) reason = mRs[1].trim();
        var mDt = subject.match(/身心調適假從\s*([\d\/]+)至\s*([\d\/]+)/);
        if (mDt) {
          leaveDate = mDt[1].trim().replace(/\//g, '-');
          var mDtEnd = mDt[2].trim().replace(/\//g, '-');
          if (mDtEnd && mDtEnd !== leaveDate) leaveDateTo = mDtEnd;
        }
      } else {
        var m1 = subject.match(/([A-Z0-9a-z]{8,12})[_\s]*([^\s_（(]+)[_\s]*([^\s_（(]+)[_\s]*(.+)?/);
        var m2 = subject.match(/([^\s（(]+)（([A-Z0-9]{8,12})）/);
        if (m1 && /[A-Z]/.test(m1[1]) && m1[1].length >= 8) {
          studentId = m1[1].trim(); name = m1[2].trim(); department = m1[3].trim();
          if (m1[4]) reason = m1[4].trim();
        } else if (m2) {
          name = m2[1].trim(); studentId = m2[2].trim();
        }
      }

      try {
        var rows = [];
        var tableRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        var trMatch;
        while ((trMatch = tableRe.exec(htmlBody)) !== null) {
          var cells = [];
          var cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
          var tdMatch;
          while ((tdMatch = cellRe.exec(trMatch[1])) !== null) {
            cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim());
          }
          if (cells.length >= 2) rows.push(cells);
        }
        rows.forEach(function(cells) {
          var label = cells[0] || '', val = cells[1] || '';
          if (!studentId  && /學號/.test(label))       studentId  = val.trim();
          if (!name       && /姓名/.test(label))        name       = val.trim();
          if (!department && /系所|科系|班級/.test(label)) department = val.trim();
          if (!reason     && /原因|緣由|事由/.test(label)) reason     = val.trim();
          if (!leaveDate  && /日期|請假日/.test(label))  leaveDate  = val.trim();
          if (!course     && /課程|科目/.test(label))   course     = val.trim();
          if (!semester   && /學期/.test(label))        semester   = val.trim();
        });
        if (!studentId) {
          var sidMatch = (plainBody + htmlBody.replace(/<[^>]+>/g, '')).match(/學號[：:\s]*([A-Z0-9]{8,12})/);
          if (sidMatch) studentId = sidMatch[1].trim();
        }
        if (!name) {
          var nameMatch = plainBody.match(/姓名[：:\s]*([^\s\n\r,，、]{2,6})/);
          if (nameMatch) name = nameMatch[1].trim();
        }
        if (!reason) {
          var rMatch = plainBody.match(/(?:原因|緣由|事由)[：:\s]*([^\n\r]{2,80})/);
          if (rMatch) reason = rMatch[1].trim();
        }
      } catch(parseErr) {
        Logger.log('解析信件 body 失敗：' + msgId + ' / ' + parseErr.message);
      }

      var coursesArr = [];
      try {
        // ── 方法 1（優先）：直接解析 HTML 表格 <tr><td>×5</tr> ──
        // 校務系統信件明細為 5 欄結構：流水號 / 課程名稱 / 請假日 / 星期 / 節次
        // 以 <tr> 為單位切，每列取 5 個 <td>；標頭列 (第 1 欄非數字) 自動略過
        if (htmlBody) {
          var detailIdx = htmlBody.indexOf('請假明細');
          var scanBody  = detailIdx >= 0 ? htmlBody.slice(detailIdx) : htmlBody;
          var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          var trM;
          while ((trM = trRe.exec(scanBody)) !== null) {
            var cells = [];
            var cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
            var cellM;
            while ((cellM = cellRe.exec(trM[1])) !== null) {
              var txt = cellM[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g,  '&')
                .replace(/&lt;/g,   '<')
                .replace(/&gt;/g,   '>')
                .replace(/\s+/g, ' ')
                .trim();
              cells.push(txt);
            }
            // 只吃「至少 5 欄且第 1 欄為 4-6 位純數字流水號」的資料列
            if (cells.length >= 5 && /^\d{4,6}$/.test(cells[0])) {
              coursesArr.push({
                name:    cells[1],
                date:    cells[2],
                weekday: cells[3],
                period:  cells[4]
              });
            }
          }
        }
        // ── 方法 2（fallback）：純文字 regex（相容早期 plain text 格式）──
        // 放寬 weekday：可接受「星期一/週一/禮拜一」等前綴；period 也接受 - 分隔
        if (!coursesArr.length) {
          var bodyText = plainBody || (htmlBody||'').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
          var fullCRe = /(\d{4,6})\s+([^\d\s\n][^\n\r]{2,40}?)\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+(?:星期|週|禮拜)?([一二三四五六日])\s+([\d,、\-]+)/g, cM;
          while ((cM = fullCRe.exec(bodyText)) !== null) {
            coursesArr.push({
              name:    cM[2].trim(),
              date:    cM[3].trim(),
              weekday: cM[4].trim(),
              period:  cM[5].trim()
            });
          }
        }
        // ── 方法 3（最終 fallback）：只抓課程名稱（節次資訊缺失時） ──
        if (!coursesArr.length) {
          var bodyText2 = plainBody || (htmlBody||'').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
          var cRe2 = /\d{4,6}\s+([^\d\s\n][^\n\r]+?)\s+\d{4}\/\d{1,2}\/\d{1,2}/g, cM2;
          while ((cM2 = cRe2.exec(bodyText2)) !== null) {
            var cn = cM2[1].trim();
            if (cn) coursesArr.push({ name: cn });
          }
        }
        if (!course && coursesArr.length) {
          var seen = {}, uniq = [];
          coursesArr.forEach(function(c) { if (!seen[c.name]) { seen[c.name] = true; uniq.push(c.name); } });
          course = uniq.join('；');
        }
      } catch(e2) {
        Logger.log('解析課程明細失敗：' + msgId + ' / ' + e2.message);
      }

      if (!studentId && !name) return;

      var matchedKeywords = [];
      var maxLevel = 0;
      var fullText = subject + ' ' + reason + ' ' + plainBody;
      keywords.forEach(function(k) {
        var matchText = (k.scope === 'reason') ? reason : fullText;
        if (matchText.indexOf(k.kw) !== -1) {
          matchedKeywords.push({ kw: k.kw, level: k.level });
          if (k.level > maxLevel) maxLevel = k.level;
        }
      });

      if (!semester) {
        var rd = msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date();
        var rocY = rd.getFullYear() - 1911;
        var mon  = rd.getMonth() + 1;
        semester = mon >= 8 ? rocY + '1' : (mon === 1 ? (rocY-1) + '1' : (rocY-1) + '2');
      }

      var receivedAt = msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : new Date().toISOString();
      var parsedRec = {
        id: 'ml_' + msgId, emailId: msgId,
        studentId: studentId, name: name, department: department,
        reason: reason, leaveDate: leaveDate, leaveDateTo: leaveDateTo,
        course: course, courses: coursesArr,
        semester: String(semester), matchedKeywords: matchedKeywords,
        riskLevel: maxLevel,
        handlingStatus: maxLevel >= 3 ? '待處理' : '非危機',
        receivedAt: receivedAt, parsedAt: new Date().toISOString(),
      };
      // reparse 模式：merge 到既有紀錄，保留使用者管理的欄位
      if (reparse && existingByEmailId[msgId] !== undefined) {
        var idx = existingByEmailId[msgId];
        var existing = existingData.records[idx];
        // 保留使用者欄位（handlingStatus, acknowledgedBy, deleted 等）
        var preserved = {
          handlingStatus: existing.handlingStatus,
          acknowledgedBy: existing.acknowledgedBy,
          deleted: existing.deleted, deletedAt: existing.deletedAt, deletedBy: existing.deletedBy,
        };
        // 用解析結果覆蓋 existing 的其他欄位
        Object.keys(parsedRec).forEach(function(k) { existing[k] = parsedRec[k]; });
        // 還原使用者欄位
        Object.keys(preserved).forEach(function(k) { if (preserved[k] !== undefined) existing[k] = preserved[k]; });
        updatedCount++;
      } else {
        newRecords.push(parsedRec);
        existingSet[msgId] = true;
      }

      if (processedLabelId && !reparse) {
        try { gmailApi_(token, '/messages/' + msgId + '/modify', 'post', { addLabelIds: [processedLabelId] }); } catch(e) {}
      }
    } catch(msgErr) {
      Logger.log('處理信件失敗：' + msgErr.message);
    }
  });

  if (force || reparse) {
    if (searchData.nextPageToken) {
      existingData.fetchPageToken = searchData.nextPageToken;
    } else {
      delete existingData.fetchPageToken;
    }
  }

  existingData.lastFetchedAt = new Date().toISOString();
  if (newRecords.length) existingData.records = existingData.records.concat(newRecords);
  try {
    updateJson_({ path: 'mental_leaves.json', content: existingData }, ctx);
  } catch(e) {
    var parentInfo = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', existingData, parentInfo.parentId);
  }

  return {
    newCount: newRecords.length,
    updatedCount: updatedCount,
    totalCount: existingData.records.length,
    batchCount: messages.length,
    hasMore: !!((force || reparse) && existingData.fetchPageToken),
    nextPageToken: ((force || reparse) && existingData.fetchPageToken) || null
  };
}

function dumpNpust5Emails_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) {
    return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  }

  var query = '(subject:請假 OR subject:身心調適 OR subject:缺課 OR subject:假單 OR subject:假條) newer_than:365d';
  var searchData = gmailApi_(token, '/messages?q=' + encodeURIComponent(query) + '&maxResults=100');
  var messages = searchData.messages || [];

  var emails = [];
  messages.forEach(function(m) {
    try {
      var msg = gmailApi_(token, '/messages/' + m.id + '?format=full');
      var subject = '', fromHdr = '', dateStr = '';
      (msg.payload.headers || []).forEach(function(h) {
        var n = h.name.toLowerCase();
        if (n === 'subject') subject = h.value;
        else if (n === 'from') fromHdr = h.value;
        else if (n === 'date') dateStr = h.value;
      });
      var bodies = gmailDecodeBody_(msg.payload);
      var plain = (bodies.text || bodies.html.replace(/<[^>]+>/g, '') || '').slice(0, 1500);
      emails.push({
        id: m.id, subject: subject, from: fromHdr,
        date: msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : dateStr,
        snippet: msg.snippet || '', body: plain
      });
    } catch(e) {
      emails.push({ id: m.id, error: e.message });
    }
  });

  var dump = { dumpedAt: new Date().toISOString(), count: emails.length, emails: emails };
  try {
    updateJson_({ path: 'ml_email_dump.json', content: dump }, ctx);
  } catch(e) {
    try {
      var pi = resolvePathToParentAndName_('ml_email_dump.json', ctx);
      driveUpload_('ml_email_dump.json', dump, pi.parentId);
    } catch(e2) { Logger.log('dump 寫入失敗: ' + e2.message); }
  }
  return { count: emails.length };
}

function clearMentalLeaves_(ctx) {
  var token = npust5GetAccessToken_();
  var removedLabels = 0;
  var labelName = ctx.gmailLabel || 'ml-processed-dev';
  if (token) {
    try {
      var labelData = gmailApi_(token, '/labels');
      var processed = (labelData.labels || []).filter(function(l) { return l.name === labelName; })[0];
      if (processed) {
        var tagged = gmailApi_(token, '/messages?labelIds=' + processed.id + '&maxResults=500');
        (tagged.messages || []).forEach(function(m) {
          try { gmailApi_(token, '/messages/' + m.id + '/modify', 'post', { removeLabelIds: [processed.id] }); removedLabels++; } catch(e) {}
        });
      }
    } catch(e) { Logger.log('移除 ml-processed-dev label 失敗: ' + e.message); }
  }
  try {
    updateJson_({ path: 'mental_leaves.json', content: { records: [] } }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', { records: [] }, pi.parentId);
  }
  return { ok: true, removedLabels: removedLabels };
}

function countMentalLeavesUnprocessed_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  var labelName = ctx.gmailLabel || 'ml-processed-dev';
  var query = 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var searchData = gmailApi_(token, '/messages?q=' + encodeURIComponent(query) + '&maxResults=500');
  var messages = searchData.messages || [];
  return { count: messages.length, hasMore: !!searchData.nextPageToken };
}

function listInboxEmails_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };

  var profile = gmailApi_(token, '/profile');
  var authedEmail = profile.emailAddress || '(unknown)';

  var inboxData = gmailApi_(token, '/messages?maxResults=50&labelIds=INBOX');
  var allData   = gmailApi_(token, '/messages?maxResults=50');

  var messages = (inboxData.messages && inboxData.messages.length)
    ? inboxData.messages
    : (allData.messages || []);

  var emails = [];
  messages.slice(0, 20).forEach(function(m) {
    try {
      var msg = gmailApi_(token, '/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date');
      var subject = '', from = '', date = '';
      (msg.payload.headers || []).forEach(function(h) {
        if (h.name === 'Subject') subject = h.value;
        else if (h.name === 'From') from = h.value;
        else if (h.name === 'Date') date = h.value;
      });
      emails.push({ id: m.id, subject: subject, from: from, date: date, snippet: msg.snippet || '' });
    } catch(e) { emails.push({ id: m.id, error: e.message }); }
  });

  var dump = {
    dumpedAt: new Date().toISOString(),
    authedEmail: authedEmail,
    inboxRaw: inboxData,
    allMailRaw: allData,
    count: emails.length,
    emails: emails
  };
  try {
    updateJson_({ path: 'ml_inbox_list.json', content: dump }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('ml_inbox_list.json', ctx);
    driveUpload_('ml_inbox_list.json', dump, pi.parentId);
  }
  return { authedEmail: authedEmail, inboxCount: (inboxData.messages || []).length, allCount: (allData.messages || []).length, emails: emails };
}

function ping() { return 'pong (DEV) ' + new Date().toISOString(); }

// ══════════════════════════════════════════════
//  npust5 Gmail OAuth2（手動實作）
// ══════════════════════════════════════════════

var NPUST5_REDIR_  = 'https://npustscc.github.io/scc-infosys/dev/oauth-callback.html';

function npust5Cid_() { return PropertiesService.getScriptProperties().getProperty('NPUST5_CID') || ''; }
function npust5Cs_()  { return PropertiesService.getScriptProperties().getProperty('NPUST5_CS')  || ''; }

function npust5BuildAuthUrl_() {
  var state = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('NPUST5_OAUTH_STATE', state);
  return 'https://accounts.google.com/o/oauth2/auth?' + [
    'client_id='    + encodeURIComponent(npust5Cid_()),
    'redirect_uri=' + encodeURIComponent(NPUST5_REDIR_),
    'response_type=code',
    'scope='        + encodeURIComponent('https://www.googleapis.com/auth/gmail.modify'),
    'access_type=offline', 'prompt=select_account%20consent',
    'login_hint='   + encodeURIComponent('heartnpust5@gmail.com'),
    'state='        + state
  ].join('&');
}

function npust5HandleOAuthCallback_(e) {
  var code = e.parameter.code;
  if (!code) return HtmlService.createHtmlOutput('❌ 授權失敗：缺少 code');
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { code: code, client_id: npust5Cid_(), client_secret: npust5Cs_(),
                 redirect_uri: NPUST5_REDIR_, grant_type: 'authorization_code' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      var p = PropertiesService.getScriptProperties();
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      if (t.refresh_token) p.setProperty('NPUST5_REFRESH_TOKEN', t.refresh_token);
      return HtmlService.createHtmlOutput('<h3 style="font-family:sans-serif;color:#059669;">✅ npust5 Gmail 授權成功，可關閉此視窗。</h3>');
    }
    return HtmlService.createHtmlOutput('❌ 授權失敗：' + JSON.stringify(t));
  } catch(err) {
    return HtmlService.createHtmlOutput('❌ 錯誤：' + err.message);
  }
}

function npust5GetAccessToken_() {
  var p = PropertiesService.getScriptProperties();
  var tok = p.getProperty('NPUST5_ACCESS_TOKEN');
  var exp = parseInt(p.getProperty('NPUST5_EXPIRY') || '0');
  if (tok && Date.now() < exp - 300000) return tok;
  var rt = p.getProperty('NPUST5_REFRESH_TOKEN');
  if (!rt) return null;
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { refresh_token: rt, client_id: npust5Cid_(), client_secret: npust5Cs_(), grant_type: 'refresh_token' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      return t.access_token;
    }
    p.deleteProperty('NPUST5_ACCESS_TOKEN'); p.deleteProperty('NPUST5_REFRESH_TOKEN');
    return null;
  } catch(e) { return null; }
}

function exchangeNpust5OAuthCode_(params) {
  var code = params.code;
  if (!code) return { ok: false, error: '缺少 code' };
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { code: code, client_id: npust5Cid_(), client_secret: npust5Cs_(),
                 redirect_uri: NPUST5_REDIR_, grant_type: 'authorization_code' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      var p = PropertiesService.getScriptProperties();
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      if (t.refresh_token) p.setProperty('NPUST5_REFRESH_TOKEN', t.refresh_token);
      return { ok: true };
    }
    return { ok: false, error: t.error_description || t.error || JSON.stringify(t) };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

function getAuthUrlNpust5_() {
  if (npust5GetAccessToken_()) return { authorized: true };
  return { authorized: false, authUrl: npust5BuildAuthUrl_() };
}

// ── Gmail REST API helpers ──────────────────────────────────────────────────

function gmailApi_(token, path, method, body) {
  var opts = {
    method: method || 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body) { opts.payload = JSON.stringify(body); opts.contentType = 'application/json'; }
  return JSON.parse(
    UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, opts).getContentText()
  );
}

function gmailDecodeBody_(payload) {
  if (!payload) return { text: '', html: '' };
  if (payload.body && payload.body.data) {
    try {
      var d = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString();
      return (payload.mimeType || '').indexOf('html') >= 0 ? { text: '', html: d } : { text: d, html: '' };
    } catch(e) { return { text: '', html: '' }; }
  }
  var result = { text: '', html: '' };
  (payload.parts || []).forEach(function(p) {
    if (p.parts) {
      var sub = gmailDecodeBody_(p);
      if (!result.text && sub.text) result.text = sub.text;
      if (!result.html && sub.html) result.html = sub.html;
    }
    if (!p.body || !p.body.data) return;
    try {
      var d = Utilities.newBlob(Utilities.base64DecodeWebSafe(p.body.data)).getDataAsString();
      if (p.mimeType === 'text/plain' && !result.text) result.text = d;
      else if (p.mimeType === 'text/html'  && !result.html) result.html = d;
    } catch(e) {}
  });
  return result;
}

function gmailGetOrCreateLabel_(token, labelName) {
  try {
    var data = gmailApi_(token, '/labels');
    var existing = (data.labels || []).filter(function(l) { return l.name === labelName; })[0];
    if (existing) return existing.id;
    return gmailApi_(token, '/labels', 'post', { name: labelName }).id || null;
  } catch(e) { return null; }
}

function loadMlKeywords_(ctx) {
  var keywords = [];
  try {
    var cfgId = ctx.configOverride || resolvePathToId_('config.json', ctx);
    var cfgRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (cfgRes.getResponseCode() === 200) {
      var cfg = JSON.parse(cfgRes.getContentText());
      if (Array.isArray(cfg.mentalLeaveKeywords) && cfg.mentalLeaveKeywords.length) keywords = cfg.mentalLeaveKeywords;
    }
  } catch(e) {}
  if (!keywords.length) {
    '死,結束生命,不想活,自傷,自殘,自殺,跳,崩潰,喘不過氣,恐慌,解離,幻覺,車禍,意外,喪,暴力,性平,性騷,家暴,輕生,消失'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 3 }); });
    '身心科,精神科,急診,住院,看診,回診,藥物副作用,換藥,斷藥,戒斷,憂鬱,焦慮,躁鬱,失眠,厭食,暴食,哭,壓力大,情緒'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 2 }); });
    keywords.push({ kw: '諮商', level: 2, scope: 'reason' });
    '分手,感情問題,排擠,霸凌,期中,期末,退學,休學,擋修,家庭衝突,經濟壓力,身心調適,休息調適,個人因素,照顧家人'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 1 }); });
  }
  return keywords;
}

// ── 啟動批次讀取：以 UrlFetchApp.fetchAll 並行讀取所有啟動所需資料，減少 GAS 執行次數 ──
function startupBatch_(params, ctx) {
  var tok = tok_();
  var authHeader = { Authorization: 'Bearer ' + tok };
  var qBase = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,modifiedTime)&pageSize=5&q=';
  var contentBase = 'https://www.googleapis.com/drive/v3/files/';

  var issuesRootId      = params.issuesRootId || ctx.root;
  var userEmail         = params.userEmail || '';
  var envSuffix         = params.envSuffix || '';
  var usersFolderIdHint = params.usersFolderIdHint || null;

  // ── Phase 1：並行解析所有 fileId ────────────────────────────────────────────
  var p1Reqs = [];
  var p1Keys = [];

  function addQuery(key, parentId, name, mime) {
    var q = "name='" + name + "' and '" + parentId + "' in parents and trashed=false";
    if (mime) q += " and mimeType='" + mime + "'";
    p1Reqs.push({ url: qBase + encodeURIComponent(q), headers: authHeader, muteHttpExceptions: true });
    p1Keys.push(key);
  }

  if (!ctx.configOverride) addQuery('config', ctx.root, 'config.json');
  addQuery('pending_cases', ctx.root, 'pending_cases.json');
  addQuery('bookings',      ctx.root, 'bookings.json');
  addQuery('transfer',      ctx.root, 'transfer.json');
  addQuery('unassigned',    ctx.root, 'unassigned_records.json');
  addQuery('issues',        issuesRootId, 'issues.json');

  var todoFileName   = 'todos_' + userEmail + '_' + envSuffix + '.json';
  var legacyTodoName = 'todos_' + userEmail + '.json';

  if (usersFolderIdHint) {
    addQuery('todos_new',    usersFolderIdHint, todoFileName);
    addQuery('todos_legacy', usersFolderIdHint, legacyTodoName);
  } else {
    addQuery('users_folder', ctx.root, 'users', 'application/vnd.google-apps.folder');
  }

  var p1Results = UrlFetchApp.fetchAll(p1Reqs);

  var fileIds  = {};
  var modTimes = {};
  if (ctx.configOverride) fileIds['config'] = ctx.configOverride;

  p1Keys.forEach(function(key, i) {
    var res = p1Results[i];
    if (res.getResponseCode() !== 200) return;
    var body = JSON.parse(res.getContentText());
    var files = body.files || [];
    if (files.length > 0) {
      fileIds[key] = files[0].id;
      if (files[0].modifiedTime) modTimes[key] = files[0].modifiedTime;
    }
  });

  // ── Phase 1b（無 hint 時）：解析 todos 檔 ──────────────────────────────────
  var usersFolderId = usersFolderIdHint || fileIds['users_folder'] || null;
  var isTodoLegacy = false;

  if (!fileIds['todos_new'] && !fileIds['todos_legacy'] && usersFolderId && !usersFolderIdHint) {
    var todoPhase = [
      { url: qBase + encodeURIComponent("name='" + todoFileName   + "' and '" + usersFolderId + "' in parents and trashed=false"), headers: authHeader, muteHttpExceptions: true },
      { url: qBase + encodeURIComponent("name='" + legacyTodoName + "' and '" + usersFolderId + "' in parents and trashed=false"), headers: authHeader, muteHttpExceptions: true },
    ];
    var tpRes = UrlFetchApp.fetchAll(todoPhase);
    var newTodo = JSON.parse(tpRes[0].getContentText());
    var legTodo = JSON.parse(tpRes[1].getContentText());
    if (newTodo.files && newTodo.files.length) {
      fileIds['todos_new'] = newTodo.files[0].id;
    } else if (legTodo.files && legTodo.files.length) {
      fileIds['todos_legacy'] = legTodo.files[0].id;
    }
  }

  var todoFileId = fileIds['todos_new'] || fileIds['todos_legacy'] || null;
  if (!fileIds['todos_new'] && fileIds['todos_legacy']) isTodoLegacy = true;

  // ── Phase 2：並行讀取所有檔案內容 ──────────────────────────────────────────
  var p2Reqs = [];
  var p2Keys = [];

  ['config', 'pending_cases', 'bookings', 'transfer', 'unassigned', 'issues'].forEach(function(key) {
    if (fileIds[key]) {
      p2Reqs.push({ url: contentBase + fileIds[key] + '?alt=media&supportsAllDrives=true', headers: authHeader, muteHttpExceptions: true });
      p2Keys.push(key);
    }
  });
  if (todoFileId) {
    p2Reqs.push({ url: contentBase + todoFileId + '?alt=media&supportsAllDrives=true', headers: authHeader, muteHttpExceptions: true });
    p2Keys.push('todos');
  }

  var p2Results = UrlFetchApp.fetchAll(p2Reqs);

  var result = { usersFolderId: usersFolderId, todoFileId: todoFileId, isTodoLegacy: isTodoLegacy, modTimes: modTimes };
  p2Keys.forEach(function(key, i) {
    var res = p2Results[i];
    if (res.getResponseCode() === 200) {
      try { result[key] = JSON.parse(res.getContentText()); } catch(e) { result[key] = null; }
    } else {
      result[key] = null;
    }
  });
  // 暫時 debug：回傳 Phase 1 查詢結果，協助診斷
  result._debug = {
    ctxRoot: ctx.root,
    configOverride: ctx.configOverride || null,
    phase1Keys: p1Keys,
    phase1Codes: p1Results.map(function(r) { return r.getResponseCode(); }),
    phase1Results: p1Results.map(function(r) {
      try {
        var b = JSON.parse(r.getContentText());
        return { fileCount: (b.files || []).length, fileIds: (b.files || []).map(function(f){ return f.id; }), error: b.error || null };
      } catch(e) { return { parseError: r.getContentText().slice(0, 200) }; }
    }),
    fileIdsFound: Object.keys(fileIds),
  };
  return result;
}

// ── 帳號申請送出
function submitUserApplication_(params) {
  var targetEmail   = ((params.targetEmail || '').trim().toLowerCase()) || params.submittedByEmail;
  var name          = params.name;
  var requestedRole = params.requestedRole;
  var note          = params.note || '';
  var submittedBy   = params.submittedByEmail;
  var pendingFile   = params.pendingFile;
  var ctx           = params.ctx || {};

  if (!targetEmail || !name || !requestedRole) throw new Error('缺少必要欄位');

  var filePath = (pendingFile && /^pending_users[\w-]*\.json$/.test(pendingFile))
    ? pendingFile : 'pending_users.json';

  var data;
  try { data = readJson_({ path: filePath }, ctx); } catch (_) { data = { applications: [] }; }
  if (!Array.isArray(data.applications)) data.applications = [];

  var dup = data.applications.filter(function(a) { return a.email === targetEmail && a.status === 'pending'; });
  if (dup.length) throw new Error('此 Gmail 已有一筆待審申請，請等待管理者處理。');

  data.applications.push({
    id: 'app_' + Date.now(),
    email: targetEmail,
    submittedByEmail: submittedBy || targetEmail,
    name: name,
    requestedRole: requestedRole,
    note: note,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  });

  try {
    updateJson_({ path: filePath, content: data }, ctx);
  } catch (writeErr) {
    throw new Error('儲存申請失敗（' + filePath + '）：' + writeErr.message);
  }
  return { ok: true };
}

// ── cases-hot.json / cases-index.json 併發安全的 upsert（LockService）──
// 前端傳 { path, upserts:[{id,...完整entry}], removes:[id...] }，GAS 在 lock 內做 RMW。
// 檔案結構固定：{ updatedAt, cases:[{ id, ... }] }
function casesUpsert_({ path, upserts, removes }, ctx) {
  if (!path) throw new Error('casesUpsert: path required');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let fileId = null;
    let data = { updatedAt: '', cases: [] };
    try {
      fileId = resolvePathToId_(path, ctx);
      const res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() < 400) {
        try { data = JSON.parse(res.getContentText()); } catch (_) { data = { updatedAt: '', cases: [] }; }
        if (!data || !Array.isArray(data.cases)) data = { updatedAt: '', cases: [] };
      }
    } catch (_) { /* 檔不存在，稍後建立 */ }

    const pos = {};
    data.cases.forEach(function (c, i) { if (c && c.id) pos[c.id] = i; });
    (upserts || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      if (pos[entry.id] !== undefined) data.cases[pos[entry.id]] = entry;
      else { pos[entry.id] = data.cases.length; data.cases.push(entry); }
    });
    const rmSet = {};
    (removes || []).forEach(function (id) { if (id) rmSet[id] = true; });
    if (Object.keys(rmSet).length) {
      data.cases = data.cases.filter(function (c) { return c && c.id && !rmSet[c.id]; });
    }
    data.updatedAt = new Date().toISOString();

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      const pn = resolvePathToParentAndName_(path, ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    return { ok: true, count: data.cases.length, updatedAt: data.updatedAt };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
