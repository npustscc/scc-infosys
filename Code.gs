// ================================================================
// SCC Drive Proxy — Apps Script Web App
// 以 npust.scc 身份執行所有 Drive / Calendar 操作
// ================================================================

const CLIENT_ID      = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
const ROOT_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';
const CALENDAR_NAME  = 'SCC 空間預約';

// ── 進入點 ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const raw = (e.parameter && e.parameter.payload)
      ? e.parameter.payload
      : (e.postData ? e.postData.contents : null);
    if (!raw) return respond({ error: '無效請求' });

    const data = JSON.parse(raw);
    const { idToken, action } = data;

    const callerEmail = verifyIdToken(idToken);
    if (!callerEmail) return respond({ error: '身份驗證失敗', status: 401 });

    let result;
    switch (action) {
      case 'ping':
        result = { pong: true, caller: callerEmail, time: new Date().toISOString() };
        break;
      case 'getMetadata':
        result = getMetadata(data.fileId, data.fields);
        break;
      case 'readJson':
        result = readJson(data.path);
        break;
      case 'readJsonById':
        result = readJsonById(data.fileId);
        break;
      case 'createJson':
        result = createJson(data.name, data.content, data.parentId);
        break;
      case 'updateJson':
        // FIX: frontend sends path (not fileId); resolve path → fileId first
        result = updateJson(findFileByPath(data.path), data.content);
        break;
      case 'createFolder':
        result = createFolder(data.name, data.parentId);
        break;
      case 'trashFile':
        result = trashFile(data.fileId);
        break;
      case 'deleteFile':
        result = deleteFilePermanently(data.fileId);
        break;
      case 'moveFile':
        result = moveFile(data.fileId, data.addParents, data.removeParents);
        break;
      case 'query':
        result = queryFiles(data.q, data.fields, data.pageSize);
        break;
      case 'listFolder':
        result = listFolder(data.folderId, data.fields, data.pageSize);
        break;
      case 'createCalendarEvent':
        result = createCalendarEvent(data);
        break;
      case 'updateCalendarEvent':
        result = updateCalendarEvent(data);
        break;
      case 'deleteCalendarEvent':
        result = deleteCalendarEvent(data);
        break;
      default:
        return respond({ error: 'Unknown action: ' + action });
    }

    return respond({ success: true, data: result, caller: callerEmail });

  } catch (err) {
    console.error('[doPost]', err.message, err.stack);
    return respond({ error: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ID Token 驗證 ──────────────────────────────────────────────────
function verifyIdToken(token) {
  if (!token) return null;
  try {
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    const info = JSON.parse(resp.getContentText());
    if (info.error_description || !info.email) return null;
    return info.email;
  } catch (e) {
    console.error('[verifyIdToken]', e.message);
    return null;
  }
}

// ── 路徑解析：path → fileId ────────────────────────────────────────
function findFileByPath(path) {
  const parts = path.split('/');
  let parentId = ROOT_FOLDER_ID;

  for (let i = 0; i < parts.length - 1; i++) {
    const res = Drive.Files.list({
      q: `name='${parts[i]}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives'
    });
    if (!res.files || !res.files.length) throw new Error('找不到資料夾：' + parts[i]);
    parentId = res.files[0].id;
  }

  const fileName = parts[parts.length - 1];
  const res = Drive.Files.list({
    q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives'
  });
  if (!res.files || !res.files.length) throw new Error('File not found: ' + path);
  return res.files[0].id;
}

// ── Drive 操作 ────────────────────────────────────────────────────
function getMetadata(fileId, fields) {
  return Drive.Files.get(fileId, {
    fields: fields || 'id,name,mimeType',
    supportsAllDrives: true
  });
}

function readJson(path) {
  const fileId = findFileByPath(path);
  return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
}

function readJsonById(fileId) {
  return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
}

function createJson(name, content, parentId) {
  const blob = Utilities.newBlob(
    JSON.stringify(content, null, 2), 'application/json', name
  );
  const file = DriveApp.getFolderById(parentId).createFile(blob);
  return { id: file.getId() };
}

function updateJson(fileId, content) {
  const blob = Utilities.newBlob(
    JSON.stringify(content, null, 2), 'application/json'
  );
  Drive.Files.update({}, fileId, blob, { supportsAllDrives: true });
  return { id: fileId };
}

function createFolder(name, parentId) {
  const folder = DriveApp.getFolderById(parentId).createFolder(name);
  return { id: folder.getId() };
}

function trashFile(fileId) {
  Drive.Files.update({ trashed: true }, fileId, null, { supportsAllDrives: true });
  return { success: true };
}

function deleteFilePermanently(fileId) {
  Drive.Files.remove(fileId, { supportsAllDrives: true });
  return { success: true };
}

function moveFile(fileId, addParents, removeParents) {
  Drive.Files.update({}, fileId, null, {
    addParents: addParents,
    removeParents: removeParents,
    supportsAllDrives: true
  });
  return { success: true };
}

function queryFiles(q, fields, pageSize) {
  const res = Drive.Files.list({
    q: q,
    fields: 'files(' + (fields || 'id,name') + ')',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
    pageSize: pageSize || 400
  });
  return { files: res.files || [] };
}

function listFolder(folderId, fields, pageSize) {
  const res = Drive.Files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
    pageSize: pageSize || 1000
  });
  return { files: res.files || [] };
}

// ── Calendar 操作 ─────────────────────────────────────────────────
function getOrCreateCalendar() {
  const cals = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  if (cals.length > 0) return cals[0];
  return CalendarApp.createCalendar(CALENDAR_NAME, { color: CalendarApp.Color.CYAN });
}

function parseEventTimes(date, startTime, endTime) {
  const [y, m, d] = date.split('-').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return {
    start: new Date(y, m - 1, d, sh, sm),
    end:   new Date(y, m - 1, d, eh, em)
  };
}

function buildEventTitle(room, counselorName, caseName) {
  return '[' + room + '] ' + counselorName + (caseName ? ' - ' + caseName : '');
}

function buildEventDesc(room, counselorName, caseId, caseName, notes) {
  let desc = '空間：' + room + '\n輔導員：' + counselorName;
  if (caseId)   desc += '\n案號：' + caseId;
  if (caseName) desc += '\n個案：' + caseName;
  if (notes)    desc += '\n備註：' + notes;
  return desc;
}

function createCalendarEvent(data) {
  const cal = getOrCreateCalendar();
  const { start, end } = parseEventTimes(data.date, data.startTime, data.endTime);
  const title = buildEventTitle(data.room, data.counselorName, data.caseName);
  const desc  = buildEventDesc(data.room, data.counselorName, data.caseId, data.caseName, data.notes);
  const event = cal.createEvent(title, start, end, { description: desc });
  return event.getId();
}

function updateCalendarEvent(data) {
  const cal = getOrCreateCalendar();
  const event = cal.getEventById(data.eventId);
  if (!event) throw new Error('Event not found: ' + data.eventId);
  const { start, end } = parseEventTimes(data.date, data.startTime, data.endTime);
  event.setTitle(buildEventTitle(data.room, data.counselorName, data.caseName));
  event.setDescription(buildEventDesc(data.room, data.counselorName, data.caseId, data.caseName, data.notes));
  event.setTime(start, end);
  return { ok: true };
}

function deleteCalendarEvent(data) {
  const cal = getOrCreateCalendar();
  const event = cal.getEventById(data.eventId);
  if (event) event.deleteEvent();
  return { ok: true };
}
