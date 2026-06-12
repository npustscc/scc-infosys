// Code.gs — SCC Drive Proxy
// 執行身份：Me (npust.scc)；存取：任何擁有 Google 帳戶

const CLIENT_ID      = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
const ROOT_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';
const CALENDAR_NAME  = 'SCC 空間預約';
// 2026-05-20 修復：直接寫死乾淨的 config.json ID，跳過名稱搜尋（Drive 有兩個同名檔案，orderBy 在 shared drive 被忽略）
const CONFIG_FILE_ID_OVERRIDE = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';

// 白名單：前端可傳入的 rootFolderId → configOverride（null = 從該 root 路徑查找 config.json）
const ALLOWED_ROOTS = {
  '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP': { configOverride: '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj', calendarName: 'SCC 空間預約' },       // 正式版
  '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx': { configOverride: null,                                  calendarName: '[DEV] SCC 空間預約' }, // 測試版
};

// ── 進入點 ────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const payload = JSON.parse(e.parameter.payload);
    const { idToken, action, rootFolderId, ...params } = payload;

    const userEmail = verifyIdToken_(idToken);
    if (!userEmail) return jsonResp_({ error: 'Unauthorized' });

    // 根據前端傳入的 rootFolderId 決定此次請求的資料根目錄與日曆名稱
    let ctx = { root: ROOT_FOLDER_ID, configOverride: CONFIG_FILE_ID_OVERRIDE, calendarName: CALENDAR_NAME };
    if (rootFolderId) {
      if (!ALLOWED_ROOTS[rootFolderId]) return jsonResp_({ error: 'Unauthorized rootFolderId' });
      const rootCfg = ALLOWED_ROOTS[rootFolderId];
      ctx = { root: rootFolderId, configOverride: rootCfg.configOverride, calendarName: rootCfg.calendarName || CALENDAR_NAME };
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
      case 'uploadFile':           result = uploadFile_(params); break;
      case 'downloadFileBase64':   result = downloadFileBase64_(params); break;
      default: return jsonResp_({ error: 'Unknown action: ' + action });
    }
    return jsonResp_(result);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return jsonResp_({ ok: true, service: 'SCC Drive Proxy' });
}

// ── ID Token 驗證 ─────────────────────────────────────────────────────────────

function verifyIdToken_(idToken) {
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken,
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const d = JSON.parse(res.getContentText());
    if (d.aud !== CLIENT_ID) return null;
    if (Number(d.exp) < Math.floor(Date.now() / 1000)) return null;
    return d.email;
  } catch (e) { return null; }
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
  // 自動清理重複檔案（保留最近修改的那份）
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
    // 先二次確認（防止 Drive 索引延遲誤判為不存在而建立重複檔案）
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
  const boundary = 'scc_boundary';
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

// 以 ctx.root 為起點解析資料夾路徑，回傳資料夾 ID
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

// 以 ctx.root 為起點解析路徑，再列出該資料夾內容
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
  if (cals.length > 0) return cals[0];
  return CalendarApp.createCalendar(name, { color: CalendarApp.Color.CYAN });
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

function createCalendarEvent_({ room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, bkSerial }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const title = buildEventTitle_(room, counselorName, customRoom || '');
  const desc  = buildEventDesc_(creatorName || counselorName || '', notes, createdAt, bkSerial, false);
  const event = cal.createEvent(title, start, end, { description: desc });
  return event.getId();
}

function updateCalendarEvent_({ eventId, room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, updatedAt, isEdit, bkSerial }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (!event) throw new Error('Event not found: ' + eventId);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const actorTime = isEdit ? (updatedAt || createdAt) : createdAt;
  event.setTitle(buildEventTitle_(room, counselorName, customRoom || ''));
  event.setDescription(buildEventDesc_(creatorName || counselorName || '', notes, actorTime, bkSerial, !!isEdit));
  event.setTime(start, end);
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

// ── 一次性工具：將正式版啟用使用者加入正式版 GC 為編輯者 ─────────────────────
// 在 Apps Script 編輯器中手動選取此函式並執行，勿透過 doPost 觸發。
function setupProdCalendarEditors() {
  const PROD_CONFIG_ID = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';
  const PROD_CAL_NAME  = 'SCC 空間預約';
  const token = ScriptApp.getOAuthToken();

  // 讀取正式版 config.json
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + PROD_CONFIG_ID + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) { Logger.log('無法讀取 config.json：' + res.getContentText()); return; }
  const config = JSON.parse(res.getContentText());

  // 取得（或建立）正式版日曆
  const owned = CalendarApp.getOwnedCalendarsByName(PROD_CAL_NAME);
  const cal = owned.length > 0 ? owned[0] : CalendarApp.createCalendar(PROD_CAL_NAME, { color: CalendarApp.Color.CYAN });
  const calId = cal.getId();
  Logger.log('日曆：' + cal.getName() + '（ID: ' + calId + '）');

  // 透過 Calendar REST API 加入編輯者（ACL writer）
  const users = config.users || {};
  const added = [], skipped = [];
  for (const email in users) {
    const info = users[email];
    if (info.disabled) { skipped.push(email + '（已停用）'); continue; }
    if (email.startsWith('nomail_') || !email.includes('@')) { skipped.push(email + '（無 email）'); continue; }
    const aclRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calId) + '/acl',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ role: 'writer', scope: { type: 'user', value: email } }),
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      }
    );
    if (aclRes.getResponseCode() < 300) {
      added.push(email);
    } else {
      skipped.push(email + '（失敗 ' + aclRes.getResponseCode() + '：' + aclRes.getContentText().substring(0, 80) + '）');
    }
  }
  Logger.log('✅ 已加入（' + added.length + '）：\n' + added.join('\n'));
  if (skipped.length) Logger.log('⏭ 跳過（' + skipped.length + '）：\n' + skipped.join('\n'));
  return { added, skipped, calId };
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
  return events.map(e => ({
    id:           e.getId(),
    title:        e.getTitle(),
    date:         Utilities.formatDate(e.getStartTime(), tz, 'yyyy-MM-dd'),
    startTime:    Utilities.formatDate(e.getStartTime(), tz, 'HH:mm'),
    endTime:      Utilities.formatDate(e.getEndTime(),   tz, 'HH:mm'),
    description:  e.getDescription() || '',
    lastModified: e.getLastUpdated().toISOString(),
  }));
}
