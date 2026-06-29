  // Code.gs — SCC Drive Proxy
  // 執行身份：Me (npust.scc)；存取：任何擁有 Google 帳戶

  const CLIENT_ID          = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
  const ROOT_FOLDER_ID     = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';
  const CALENDAR_NAME      = 'SCC 空間預約';
  const BOOTSTRAP_ADMIN    = 'linkinlol528101@gmail.com';

  // ── 進入點 ────────────────────────────────────────────────────────────────────

  function doPost(e) {
    try {
      const payload = JSON.parse(e.parameter.payload);
      const { idToken, action, ...params } = payload;

      const userEmail = verifyIdToken_(idToken);
      if (!userEmail) throw new Error('身份驗證失敗');

      // submitUserApplication 不需白名單（讓未授權使用者也能提交申請）
      if (action === 'submitUserApplication') {
        return jsonResp_(submitUserApplication_({ ...params, submittedByEmail: userEmail }));
      }

      if (!isAllowedUser_(userEmail)) throw new Error('此帳號未被授權存取本系統');

      let result;
      switch (action) {
        case 'ping':               result = { ok: true, email: userEmail }; break;
        case 'getMetadata':        result = getMetadata_(params); break;
        case 'readJson':           result = readJson_(params); break;
        case 'readJsonById':       result = readJsonById_(params); break;
        case 'createJson':         result = createJson_(params); break;
        case 'updateJson':         result = updateJson_(params); break;
        case 'createFolder':       result = createFolder_(params); break;
        case 'trashFile':          result = trashFile_(params); break;
        case 'deleteFile':         result = deleteFile_(params); break;
        case 'moveFile':           result = moveFile_(params); break;
        case 'query':              result = driveQuery_(params); break;
        case 'listFolder':         result = listFolder_(params); break;
        case 'createCalendarEvent': result = createCalendarEvent_(params); break;
        case 'updateCalendarEvent': result = updateCalendarEvent_(params); break;
        case 'deleteCalendarEvent': result = deleteCalendarEvent_(params); break;
        case 'listCalendarEvents': result = listCalendarEvents_(params); break;
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

  // ── 身份驗證 ─────────────────────────────────────────────────────────────────

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

  function submitUserApplication_({ targetEmail, name, requestedRole, note, submittedByEmail }) {
    const email = (targetEmail || '').trim().toLowerCase() || submittedByEmail;
    if (!email || !name || !requestedRole) throw new Error('缺少必要欄位');
    let data;
    try {
      data = readJson_({ path: 'pending_users.json' });
    } catch (_) {
      data = { applications: [] };
    }
    if (!Array.isArray(data.applications)) data.applications = [];
    // 防重複申請（同 targetEmail 且 pending 狀態）
    const dup = data.applications.find(a => a.email === email && a.status === 'pending');
    if (dup) throw new Error('此 Gmail 已有一筆待審申請，請等待管理者處理。');
    data.applications.push({
      id: 'app_' + Date.now(),
      email,
      submittedByEmail: submittedByEmail || email,
      name, requestedRole,
      note: note || '',
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });
    updateJson_({ path: 'pending_users.json', content: data });
    return { ok: true };
  }

  function isAllowedUser_(email) {
    if (email === BOOTSTRAP_ADMIN) return true;
    const cache = CacheService.getScriptCache();
    let raw = cache.get('allowed_users');
    if (raw === null) {
      try {
        const cfg = readJson_({ path: 'config.json' });
        raw = JSON.stringify(Object.keys(cfg?.users || {}));
        cache.put('allowed_users', raw, 300);
      } catch(e) {
        return true; // config.json 不存在（初次設定），暫時允許
      }
    }
    return JSON.parse(raw).includes(email);
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
  function resolvePathToId_(path) {
    const parts = path.split('/');
    let curId = ROOT_FOLDER_ID;
    for (let i = 0; i < parts.length - 1; i++) {
      const q = "name='" + parts[i] + "' and mimeType='application/vnd.google-apps.folder'" +
                " and '" + curId + "' in parents and trashed=false";
      const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
      if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
      curId = res.files[0].id;
    }
    const fileName = parts[parts.length - 1];
    const q2 = "name='" + fileName + "' and '" + curId + "' in parents and trashed=false";
    const res2 = driveGet_('files', { q: q2, fields: 'files(id)', pageSize: '1' });
    if (!res2.files || res2.files.length === 0) throw new Error('File not found: ' + path);
    return res2.files[0].id;
  }

  function resolvePathToParentAndName_(path) {
    const parts = path.split('/');
    const fileName = parts[parts.length - 1];
    let parentId = ROOT_FOLDER_ID;
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

  function readJson_({ path }) {
    const fileId = resolvePathToId_(path);
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

  function updateJson_({ path, content }) {
    let fileId;
    try {
      fileId = resolvePathToId_(path);
    } catch (notFound) {
      // 檔案不存在時自動建立
      const { parentId, fileName } = resolvePathToParentAndName_(path);
      return driveUpload_(fileName, content, parentId);
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

  // ── Calendar Actions ──────────────────────────────────────────────────────────

  function getOrCreateCalendar_() {
    const cals = CalendarApp.getCalendarsByName(CALENDAR_NAME);
    if (cals.length > 0) return cals[0];
    return CalendarApp.createCalendar(CALENDAR_NAME, { color: CalendarApp.Color.CYAN });
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

  function buildEventTitle_(room, counselorName, caseName) {
    return (room ? room.charAt(0) : '') + (counselorName || '');
  }

  function fmtDt_(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth()+1) + '/' + p(d.getDate())
         + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 格式：備註\n\n姓名 建立/編輯 YYYY/MM/DD HH:mm\n\n#流水號
  function buildEventDesc_({ notes, creatorName, createdAt, updatedAt, isEdit, bkSerial }) {
    const parts = [];
    if (notes) parts.push(notes);
    const actor  = creatorName || '';
    const action = isEdit ? '編輯' : '建立';
    const ts     = isEdit ? (updatedAt || createdAt) : (createdAt || updatedAt);
    parts.push(actor + ' ' + action + ' ' + fmtDt_(ts));
    if (bkSerial) parts.push('#' + bkSerial);
    return parts.join('\n\n');
  }

  function createCalendarEvent_({ room, date, startTime, endTime, counselorName, caseId, caseName, notes, creatorName, createdAt, bkSerial }) {
    const cal = getOrCreateCalendar_();
    const { start, end } = parseEventTimes_(date, startTime, endTime);
    const title = buildEventTitle_(room, counselorName, caseName);
    const desc  = buildEventDesc_({ notes, creatorName, createdAt, isEdit: false, bkSerial });
    const event = cal.createEvent(title, start, end, { description: desc });
    return event.getId();
  }

  function updateCalendarEvent_({ eventId, room, date, startTime, endTime, counselorName, caseId, caseName, notes, creatorName, createdAt, updatedAt, isEdit, bkSerial }) {
    const cal = getOrCreateCalendar_();
    const event = cal.getEventById(eventId);
    if (!event) throw new Error('Event not found: ' + eventId);
    const { start, end } = parseEventTimes_(date, startTime, endTime);
    event.setTitle(buildEventTitle_(room, counselorName, caseName));
    event.setDescription(buildEventDesc_({ notes, creatorName, createdAt, updatedAt, isEdit: !!isEdit, bkSerial }));
    event.setTime(start, end);
    return { ok: true };
  }

  function deleteCalendarEvent_({ eventId }) {
    const cal = getOrCreateCalendar_();
    const event = cal.getEventById(eventId);
    if (event) event.deleteEvent();
    return { ok: true };
  }

  function listCalendarEvents_({ startDate, endDate }) {
    const TZ  = 'Asia/Taipei';
    const cal = getOrCreateCalendar_();
    const s   = new Date(startDate + 'T00:00:00+08:00');
    const e   = new Date(endDate   + 'T23:59:59+08:00');
    return cal.getEvents(s, e).map(ev => ({
      id:           ev.getId(),
      title:        ev.getTitle(),
      date:         Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd'),
      startTime:    Utilities.formatDate(ev.getStartTime(), TZ, 'HH:mm'),
      endTime:      Utilities.formatDate(ev.getEndTime(),   TZ, 'HH:mm'),
      description:  ev.getDescription(),
      lastModified: ev.getLastUpdated().toISOString(),
    }));
  }