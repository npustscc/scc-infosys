// Code.gs — SCC Drive Proxy
// 執行身份：Me (npust.scc)；存取：任何擁有 Google 帳戶

const CLIENT_ID      = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
const ROOT_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';
const CALENDAR_NAME  = 'SCC 空間預約';
// 2026-05-20 修復：直接寫死乾淨的 config.json ID，跳過名稱搜尋（Drive 有兩個同名檔案，orderBy 在 shared drive 被忽略）
const CONFIG_FILE_ID_OVERRIDE = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';

// 白名單：前端可傳入的 rootFolderId → configOverride（null = 從該 root 路徑查找 config.json）
const ALLOWED_ROOTS = {
  '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP': { configOverride: '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj', calendarName: 'SCC 空間預約',        gmailLabel: 'ml-processed' },     // 正式版
  '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx': { configOverride: null,                                  calendarName: '[DEV] SCC 空間預約',  gmailLabel: 'ml-processed-dev' }, // 測試版
};

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
      if (!ALLOWED_ROOTS[rootFolderId]) return jsonResp_({ error: 'Unauthorized rootFolderId' });
      const rootCfg = ALLOWED_ROOTS[rootFolderId];
      ctx = { root: rootFolderId, configOverride: rootCfg.configOverride, calendarName: rootCfg.calendarName || CALENDAR_NAME, gmailLabel: rootCfg.gmailLabel || 'ml-processed' };
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
      case 'fetchMentalLeaves':    result = fetchMentalLeaves_(ctx, params); break;
      case 'getNpust5AuthUrl':     result = getAuthUrlNpust5_(); break;
      case 'dumpNpust5Emails':     result = dumpNpust5Emails_(ctx); break;
      case 'listInboxEmails':      result = listInboxEmails_(ctx); break;
      case 'clearMentalLeaves':              result = clearMentalLeaves_(ctx); break;
      case 'countMentalLeavesUnprocessed':   result = countMentalLeavesUnprocessed_(ctx); break;
      case 'submitUserApplication': result = submitUserApplication_({ ...params, submittedByEmail: userEmail, ctx }); break;
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

// ══════════════════════════════════════════════
//  身心調適假：信箱解析與關鍵字比對
//
//  【前置設定說明】
//  本函式使用 GmailApp 存取腳本擁有者的 Gmail 信箱。
//  若請假信件送至 heartnpust5@gmail.com，請擇一完成下列設定後再使用：
//    方法 A：在 heartnpust5@gmail.com 設定「自動轉寄」至本腳本擁有者信箱
//    方法 B：在 Gmail 設定中授予本腳本擁有者「委託存取」(Grant access) 權限
//    方法 C：將本 Apps Script 專案搬移至 heartnpust5@gmail.com 帳號執行
//
//  時間觸發器設定（每小時自動執行一次）：
//    在 Apps Script「觸發器」頁面，新增 runFetchMentalLeaves 函式，選擇「時間驅動 > 小時計時器」
// ══════════════════════════════════════════════

// 時間觸發器入口（無需 idToken，直接呼叫所有已允許的根目錄）
function runFetchMentalLeaves() {
  Object.keys(ALLOWED_ROOTS).forEach(function(rootId) {
    try {
      var ctx = { root: rootId, configOverride: ALLOWED_ROOTS[rootId].configOverride };
      fetchMentalLeaves_(ctx);
    } catch(e) {
      Logger.log('fetchMentalLeaves 失敗 [' + rootId + ']: ' + e.message);
    }
  });
}

// 核心解析函式（由 doPost 或觸發器呼叫）
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
  var token = npust5GetAccessToken_();
  if (!token) {
    return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  }

  // 環境隔離：dev/prod 使用各自的 Gmail 標籤，互不干擾
  var labelName = ctx.gmailLabel || 'ml-processed';

  // 1. 讀取現有紀錄（用於去重）
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

  // 2. 讀取關鍵字庫
  var keywords = loadMlKeywords_(ctx);

  // 3. 搜尋未處理的請假信件（Gmail REST API）
  var processedLabelId = force ? gmailGetOrCreateLabel_(token, labelName) : gmailGetOrCreateLabel_(token, labelName);
  var query = force
    ? 'subject:(請假 OR 身心調適假 OR 缺課)'
    : 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var batchSize = (opts && opts.batchSize) ? opts.batchSize : (force ? 300 : 50);
  var apiUrl = '/messages?q=' + encodeURIComponent(query) + '&maxResults=' + batchSize;
  // 若 opts 明確帶 pageToken，使用它；否則用 Drive 存的 token
  var pageTokenToUse = (opts && 'pageToken' in opts) ? opts.pageToken : (force ? (existingData.fetchPageToken || null) : null);
  if (pageTokenToUse) apiUrl += '&pageToken=' + encodeURIComponent(pageTokenToUse);
  var searchData = gmailApi_(token, apiUrl);
  var messages = searchData.messages || [];

  var newRecords = [];
  var existingSet = {};
  existingData.records.forEach(function(r) { if (r.emailId) existingSet[r.emailId] = true; });

  messages.forEach(function(m) {
    try {
      var msgId = m.id;
      if (existingSet[msgId]) return;

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

      // ── 解析主旨
      var studentId = '', name = '', department = '', reason = '', semester = '';
      var leaveDate = '', leaveDateTo = '', course = '';

      // NPUST 學生線上請假系統格式：
      // 學號:[ID] [姓名] [班級]學生請身心調適假累計達N日，...因 [reason] ，申請 身心調適假從[date]至[date]
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

      // 從 HTML body 解析欄位（fallback，主旨已有的欄位不覆蓋）
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

      // 從 body 提取課程明細（NPUST 格式：流水號 課程名稱 請假日 星期 節次）
      var coursesArr = [];
      try {
        var bodyText = plainBody || htmlBody.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
        // 嘗試完整五欄解析
        var fullCRe = /\d{4,6}\s+([^\d\s\n][^\n\r]{2,40}?)\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+([一二三四五六日])\s+([\d,、]+)/g, cM;
        while ((cM = fullCRe.exec(bodyText)) !== null) {
          coursesArr.push({ name: cM[1].trim(), date: cM[2].trim(), weekday: cM[3].trim(), period: cM[4].trim() });
        }
        if (!coursesArr.length) {
          // fallback：只抓課程名稱（舊格式）
          var cRe2 = /\d{4,6}\s+([^\d\s\n][^\n\r]+?)\s+\d{4}\/\d{1,2}\/\d{1,2}/g;
          while ((cM = cRe2.exec(bodyText)) !== null) {
            var cn = cM[1].trim();
            if (cn) coursesArr.push({ name: cn });
          }
        }
        if (!course && coursesArr.length) {
          var seen = {}, uniq = [];
          coursesArr.forEach(function(c) { if (!seen[c.name]) { seen[c.name] = true; uniq.push(c.name); } });
          course = uniq.join('；');
        }
      } catch(e2) {}

      if (!studentId && !name) return;

      // ── 關鍵字比對（scope:'reason' 只比對緣由，其餘比對全文）
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

      // ── 學期推算
      if (!semester) {
        var rd = msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date();
        var rocY = rd.getFullYear() - 1911;
        var mon  = rd.getMonth() + 1;
        semester = mon >= 8 ? rocY + '1' : (mon === 1 ? (rocY-1) + '1' : (rocY-1) + '2');
      }

      var receivedAt = msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : new Date().toISOString();
      newRecords.push({
        id: 'ml_' + msgId, emailId: msgId,
        studentId: studentId, name: name, department: department,
        reason: reason, leaveDate: leaveDate, leaveDateTo: leaveDateTo,
        course: course,       // 課程名稱字串（向下相容）
        courses: coursesArr,  // 結構化課程陣列 [{name, date, weekday, period}]
        semester: String(semester), matchedKeywords: matchedKeywords,
        riskLevel: maxLevel,
        handlingStatus: maxLevel >= 3 ? '待處理' : '非危機',
        receivedAt: receivedAt, parsedAt: new Date().toISOString(),
      });
      existingSet[msgId] = true;

      // 標記為已處理
      if (processedLabelId) {
        try { gmailApi_(token, '/messages/' + msgId + '/modify', 'post', { addLabelIds: [processedLabelId] }); } catch(e) {}
      }
    } catch(msgErr) {
      Logger.log('處理信件失敗：' + msgErr.message);
    }
  });

  // 4. 更新 pageToken（force 模式）並寫回 Drive
  if (force) {
    if (searchData.nextPageToken) {
      existingData.fetchPageToken = searchData.nextPageToken;
    } else {
      delete existingData.fetchPageToken;
    }
  }

  existingData.lastFetchedAt = new Date().toISOString();
  existingData.records = existingData.records.concat(newRecords);
  try {
    updateJson_({ path: 'mental_leaves.json', content: existingData }, ctx);
  } catch(e) {
    var parentInfo = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', existingData, parentInfo.parentId);
  }

  return {
    newCount: newRecords.length,
    totalCount: existingData.records.length,
    batchCount: messages.length,
    hasMore: !!(force && existingData.fetchPageToken),
    nextPageToken: (force && existingData.fetchPageToken) || null
  };
}

// ── 廣域擷取信件供關鍵字分析（dump 至 Drive）
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

// ── 清空身心調適假資料（僅限測試版，由前端確認後呼叫）
function clearMentalLeaves_(ctx) {
  var token = npust5GetAccessToken_();
  var removedLabels = 0;
  var labelName = ctx.gmailLabel || 'ml-processed';
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
    } catch(e) { Logger.log('移除 ml-processed label 失敗: ' + e.message); }
  }
  try {
    updateJson_({ path: 'mental_leaves.json', content: { records: [] } }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', { records: [] }, pi.parentId);
  }
  return { ok: true, removedLabels: removedLabels };
}

// ── 掃描未處理的請假信件數量（用於前端顯示 X/Y 進度）
function countMentalLeavesUnprocessed_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  var labelName = ctx.gmailLabel || 'ml-processed';
  var query = 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var searchData = gmailApi_(token, '/messages?q=' + encodeURIComponent(query) + '&maxResults=500');
  var messages = searchData.messages || [];
  return { count: messages.length, hasMore: !!searchData.nextPageToken };
}

// ── 可直接在 GAS 編輯器執行的 wrapper（寫到 dev 資料夾）
function runDumpNpust5Emails() {
  var ctx = { rootFolderId: '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx' };
  var result = dumpNpust5Emails_(ctx);
  Logger.log('dump 完成，共 ' + result.count + ' 封信，已寫入 ml_email_dump.json');
}

// ── 列出 inbox 最近 50 封信（不過濾主旨），doPost action 版
function listInboxEmails_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };

  // 確認授權帳號
  var profile = gmailApi_(token, '/profile');
  var authedEmail = profile.emailAddress || '(unknown)';

  // 先試 INBOX，再試 all mail
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

// ── 列出 inbox 最近 50 封信（不過濾主旨），診斷用（GAS 編輯器直接執行）
function runListRecentEmails() {
  var token = npust5GetAccessToken_();
  if (!token) { Logger.log('尚未授權'); return; }
  var ctx = { root: '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx', configOverride: null };
  var searchData = gmailApi_(token, '/messages?maxResults=50&labelIds=INBOX');
  var messages = searchData.messages || [];
  Logger.log('inbox 共 ' + messages.length + ' 封（最多50）');
  var emails = [];
  messages.forEach(function(m) {
    try {
      var msg = gmailApi_(token, '/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date');
      var subject = '', from = '', date = '';
      (msg.payload.headers || []).forEach(function(h) {
        if (h.name === 'Subject') subject = h.value;
        else if (h.name === 'From') from = h.value;
        else if (h.name === 'Date') date = h.value;
      });
      emails.push({ id: m.id, subject: subject, from: from, date: date, snippet: msg.snippet || '' });
      Logger.log('[' + date + '] ' + subject + ' | from: ' + from);
    } catch(e) { Logger.log('error: ' + e.message); }
  });
  var dump = { dumpedAt: new Date().toISOString(), count: emails.length, emails: emails };
  try {
    updateJson_({ path: 'ml_inbox_list.json', content: dump }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('ml_inbox_list.json', ctx);
    driveUpload_('ml_inbox_list.json', dump, pi.parentId);
  }
  Logger.log('已寫入 ml_inbox_list.json');
}

// ── clasp run 連線測試
function ping() { return 'pong ' + new Date().toISOString(); }

// ── 完整診斷：確認授權帳號 + inbox + all mail（GAS 編輯器直接執行）
function runDiagInboxEmails() {
  var token = npust5GetAccessToken_();
  if (!token) { Logger.log('❌ 尚未授權，請先執行 OAuth 流程'); return; }

  // 1. 確認授權帳號
  var profile = gmailApi_(token, '/profile');
  var authedEmail = profile.emailAddress || '(unknown)';
  Logger.log('✅ 授權帳號：' + authedEmail);

  // 2. INBOX 信件數
  var inboxData = gmailApi_(token, '/messages?maxResults=50&labelIds=INBOX');
  var inboxCount = (inboxData.messages || []).length;
  Logger.log('📬 INBOX 信件數：' + inboxCount);

  // 3. All mail 信件數（不限 label）
  var allData = gmailApi_(token, '/messages?maxResults=50');
  var allCount = (allData.messages || []).length;
  Logger.log('📂 All mail 信件數：' + allCount);

  // 4. 取前 20 封的主旨
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
      Logger.log('[' + date + '] ' + subject + ' | from: ' + from);
    } catch(e) { Logger.log('error: ' + m.id + ' ' + e.message); }
  });

  // 5. 寫入 Drive
  var ctx = { root: '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx', configOverride: null };
  var dump = {
    dumpedAt: new Date().toISOString(),
    authedEmail: authedEmail,
    inboxCount: inboxCount,
    allCount: allCount,
    count: emails.length,
    emails: emails
  };
  try {
    updateJson_({ path: 'ml_inbox_list.json', content: dump }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('ml_inbox_list.json', ctx);
    driveUpload_('ml_inbox_list.json', dump, pi.parentId);
  }
  Logger.log('✅ 已寫入 ml_inbox_list.json（授權帳號：' + authedEmail + '，inbox：' + inboxCount + '，all mail：' + allCount + '）');
}

// ══════════════════════════════════════════════
//  npust5 Gmail OAuth2（手動實作）
// ══════════════════════════════════════════════

var NPUST5_REDIR_  = 'https://npustscc.github.io/scc-infosys/dev/oauth-callback.html';

// 憑證存放於 Script Properties（不寫死在原始碼）：
//   NPUST5_CID — OAuth2 Client ID for heartnpust5@gmail.com
//   NPUST5_CS  — OAuth2 Client Secret
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

// 由 doPost 'exchangeNpust5OAuthCode' 呼叫（不需 idToken）
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

// 由 doPost 'getNpust5AuthUrl' 呼叫
function getAuthUrlNpust5_() {
  if (npust5GetAccessToken_()) return { authorized: true };
  return { authorized: false, authUrl: npust5BuildAuthUrl_() };
}

function revokeNpust5Auth_() {
  var p = PropertiesService.getScriptProperties();
  ['NPUST5_ACCESS_TOKEN','NPUST5_REFRESH_TOKEN','NPUST5_EXPIRY','NPUST5_OAUTH_STATE'].forEach(function(k){ p.deleteProperty(k); });
  Logger.log('npust5 授權已撤銷。');
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
    // Level 3 危機/紅燈（2026-06-18 AI分析更新：移除「諮商」假陽性，補充輕生/消失）
    '死,結束生命,不想活,自傷,自殘,自殺,跳,崩潰,喘不過氣,恐慌,解離,幻覺,車禍,意外,喪,暴力,性平,性騷,家暴,輕生,消失'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 3 }); });
    // Level 2 醫療/黃燈（「諮商」改為 scope:'reason' 只比對緣由欄位，避免主旨假陽性）
    '身心科,精神科,急診,住院,看診,回診,藥物副作用,換藥,斷藥,戒斷,憂鬱,焦慮,躁鬱,失眠,厭食,暴食,哭,壓力大,情緒'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 2 }); });
    keywords.push({ kw: '諮商', level: 2, scope: 'reason' }); // 僅比對緣由，避免主旨「學生諮商中心」假陽性
    // Level 1 壓力/關注（補充身心調適/個人因素常見緣由）
    '分手,感情問題,排擠,霸凌,期中,期末,退學,休學,擋修,家庭衝突,經濟壓力,身心調適,休息調適,個人因素,照顧家人'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 1 }); });
  }
  return keywords;
}

// ── 帳號申請送出（未授權使用者也可呼叫）
function submitUserApplication_(params) {
  var targetEmail   = ((params.targetEmail || '').trim().toLowerCase()) || params.submittedByEmail;
  var name          = params.name;
  var requestedRole = params.requestedRole;
  var note          = params.note || '';
  var submittedBy   = params.submittedByEmail;
  var pendingFile   = params.pendingFile;
  var ctx           = params.ctx || {};

  if (!targetEmail || !name || !requestedRole) throw new Error('缺少必要欄位');

  // 允許 dev 用 pending_users_dev.json，只接受安全的檔名格式
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
