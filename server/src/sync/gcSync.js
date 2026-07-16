// server/src/sync/gcSync.js — Google 日曆同步核心（Phase 2b：Calendar REST 直連移植）。對映
// dev/Code.gs Calendar Actions（L1807-2029）與後端定時同步（L3718-4101，gcSyncCore_ 一帶）。
//
// 本檔分兩層（比照 src/mail/mentalLeaves.js 的檔頭慣例）：
//   1. 純函式（可離線單元測試，不觸網/不碰 DB）：buildEventTitle／buildEventDesc／parseEventDescription／
//      gcSyncParseTitle／gcKnownRoomOfTitle／gcSyncShouldRun／diffBookingAgainstGcEvent／
//      computeAnnotatedDescription／mapEventToNormalized／normalizeEventId
//   2. 協調函式（觸網＋讀寫本地 DB）：calendarClientFromConfig／createGcEvent／updateGcEvent／
//      deleteGcEvent／listGcEventsNormalized／annotateGcEvent／getCalendarMeta／shareCalendarWriters／
//      gcSyncCore／gcAutoImportKnownRoom／bookingsCommitWithGc
//
// 移植原則＝bug-for-bug 對齊 GAS（與 Phase 2a 相同）：GAS 已知的死碼／殘留行為（如 gcPushBackQueue
// 恆空、gcAutoImportKnownRoom_ 與 gcSyncCore_ 各自重複一份 description 解析邏輯）保留其「效果」，
// 但在 Node 版藉由抽出共用純函式（parseEventDescription）避免重複程式碼——效果對齊，不代表逐行照抄
// GAS 的重複寫法。
'use strict';

const vdrive = require('../storage/vdrive');
const googleAuth = require('../google/auth');
const calendarApi = require('../google/calendar');
const commitActions = require('../actions/commit');
const { taipeiYmd, taipeiHm, taipeiYmdHm } = require('../util/taipeiTime');

// 與 dev/index.html 的 ROOMS 同步維護（該常數變動時本表也要跟著改，對映 GAS GC_SYNC_ROOMS）。
const GC_SYNC_ROOMS = ['玉山', '雪山', '中央山脈', '阿里山', '海岸山脈', '團體諮商室', '會議室', '其他'];

// ══════════════════════════════════════════════════════════════════════════
//  純函式
// ══════════════════════════════════════════════════════════════════════════

// ── 事件 ID 格式相容 ──────────────────────────────────────────────────────
// GAS CalendarApp 的 event.getId() 回傳「iCalUID」格式（`{id}@google.com`）；Calendar REST API 的
// event.id 是純 base32hex 字串、不帶 @google.com 後綴，且 events.get/patch/delete 的 eventId 路徑
// 參數只接受 REST 格式（帶 @google.com 後綴會 400 Bad Request：Invalid resource id value）。
// bookings.json 內 cutover 前由 GAS 寫入的 calendarEventId 欄位是 iCalUID 格式；Node 版之後新建
// 的事件則直接是 REST 格式（insertEvent 回傳值本就不含後綴）。本函式在兩個場合都要用：
//   (a) 呼叫 REST API 前，把可能帶後綴的既有值正規化成 REST 接受的格式；
//   (b) 比對 gcSyncCore 從 GC 抓回的事件 id（REST 格式）與 bookings.json 內的 calendarEventId 時，
//       兩邊都要正規化，否則舊資料的預約會被誤判為「GC 已刪除」而被同步刪除（見交付說明的最高風險點）。
// 對 REST 格式的 id（無後綴）是恆等操作（idempotent），故到處呼叫也不會造成副作用。
function normalizeEventId(id) {
  return String(id || '').replace(/@google\.com$/i, '');
}

// 對映 _gcSyncParseTitle_：解析 GC 事件標題「{空間字首}.{人員姓名,...}」→ 對照 config.users 還原 email。
function gcSyncParseTitle(title, users) {
  if (!title) return null;
  const dotIdx = title.indexOf('.');
  const roomPart = dotIdx >= 0 ? title.slice(0, dotIdx) : title;
  const personPart = dotIdx >= 0 ? title.slice(dotIdx + 1) : '';

  const knownRooms = GC_SYNC_ROOMS.filter((r) => r !== '其他');
  let room = null;
  for (let i = 0; i < knownRooms.length; i++) {
    if (knownRooms[i].charAt(0) === roomPart) { room = knownRooms[i]; break; }
  }
  if (!room && roomPart) room = roomPart; // 未知字首：原樣當 customRoom 字串保留（不做偏好註冊）

  const names = personPart ? personPart.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const counselors = names.map((name) => {
    let found = null;
    Object.keys(users || {}).some((email) => {
      if (((users[email] || {}).name || '') === name) { found = [email, users[email]]; return true; }
      return false;
    });
    return found
      ? { value: found[0], label: found[1].name || name, isCustom: false }
      : { value: name, label: name, isCustom: true };
  });
  return {
    room: room || '',
    counselors,
    counselorName: counselors.map((c) => c.label).join(','),
    counselorEmail: (counselors[0] && !counselors[0].isCustom) ? counselors[0].value : '',
  };
}

// 對映 buildEventTitle_。
function buildEventTitle(room, counselorName, customRoom) {
  const roomPart = (room === '其他') ? (customRoom || '其他') : (room ? room.charAt(0) : '');
  return counselorName ? roomPart + '.' + counselorName : roomPart;
}

// 對映 buildEventDesc_。dateTime 可為 ISO 字串／epoch ms／Date；時間顯示一律走台北時區安全格式化
// （taipeiYmdHm），不依賴 process TZ（對映 GAS 執行環境固定跑在 appsscript.json 設定的 Asia/Taipei）。
function buildEventDesc(actorName, notes, dateTime, bkSerial, isEdit) {
  const verb = isEdit ? '編輯' : '建立';
  let desc = notes ? notes.trim() : '';
  let actorLine = '';
  if (actorName || dateTime) {
    const dtStr = dateTime ? ' ' + taipeiYmdHm(dateTime) : '';
    actorLine = (actorName || '') + ' ' + verb + dtStr;
  }
  if (actorLine) desc += (desc ? '\n---\n' : '---\n') + actorLine;
  if (bkSerial) desc += '\n#' + String(bkSerial).padStart(4, '0');
  return desc;
}

// 對映 GC description 解析邏輯（gcSyncCore_ L3866-3880 與 gcAutoImportKnownRoom_ L4021-4025 兩處
// 完全相同的重複程式碼，Node 版收斂為單一純函式）：{備註}\n---\n{actor} 建立/編輯 YYYY/MM/DD HH:mm\n#{序號}
// → { serial: number|null, notes: string }。
function parseEventDescription(rawDesc) {
  const desc = rawDesc || '';
  let serial = null;
  let notes = '';
  const serialMatch = desc.match(/\n#(\d+)\s*$/);
  if (serialMatch) {
    serial = parseInt(serialMatch[1], 10);
    let body = desc.slice(0, desc.length - serialMatch[0].length);
    const sepIdx = body.lastIndexOf('\n---\n');
    if (sepIdx >= 0) body = body.slice(0, sepIdx);
    notes = body.trim();
  } else {
    const sepIdx = desc.lastIndexOf('\n---\n');
    notes = sepIdx >= 0 ? desc.slice(0, sepIdx).trim() : desc.trim();
  }
  return { serial, notes };
}

// 對映 _gcKnownRoomOfTitleGs_：判斷 GC 標題是否解析得出「已知空間．人員」。
function gcKnownRoomOfTitle(title) {
  const m = String(title || '').match(/^([^.]+)\.(.+)$/);
  if (!m) return null;
  const roomChar = m[1];
  const person = String(m[2] || '').trim();
  if (!person) return null;
  const known = GC_SYNC_ROOMS.filter((r) => r !== '其他');
  for (let i = 0; i < known.length; i++) { if (known[i].charAt(0) === roomChar) return known[i]; }
  return null;
}

// 對映 _gcSyncShouldRun：weekday 1=週一…7=週日。
function gcSyncShouldRun(weekday, hour, minute) {
  let isWorkHour = false;
  if (weekday === 1 || weekday === 4) isWorkHour = hour >= 8 && hour < 21;
  else if (weekday === 2 || weekday === 3 || weekday === 5) isWorkHour = hour >= 8 && hour < 18;
  if (isWorkHour) return true;
  return minute < 5;
}

// 對映 gcAnnotateEvent_ 的補註計算段（不含 Calendar 讀寫，純字串運算）。desc 為事件目前的
// description；找不到 marker 才會真的補註，插入點在既有流水號 `\n#\d+` 之前（若有）以維持
// parseEventDescription 的 `\n#(\d+)\s*$` 解析不被破壞。noteText 為空字串（且未命中 marker
// skip）會 throw，對映 GAS `if (!add) throw new Error('noteText required')`。
function computeAnnotatedDescription(desc, noteText, marker) {
  const mk = marker || '[系統補註';
  const d = desc || '';
  if (d.indexOf(mk) !== -1) return { skipped: true, newDesc: d };
  const add = String(noteText || '').slice(0, 500);
  if (!add) throw new Error('noteText required');
  const serialMatch = d.match(/\n#\d+\s*$/);
  let newDesc;
  if (serialMatch) {
    const body = d.slice(0, d.length - serialMatch[0].length).replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add + serialMatch[0];
  } else {
    const body = d.replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add;
  }
  return { skipped: false, newDesc };
}

// REST event resource → 對映 GAS listCalendarEvents_ 回傳形狀：
// { id, title, date, startTime, endTime, description, lastModified, creators, colorId }。
// 日期/時間一律用台北時區安全格式化（非依賴伺服器 process TZ）；all-day 事件（僅 start.date、無
// start.dateTime）不是本系統會產生的形態（房間預約一律有明確時段），此處以 start.date fallback
// 只求不崩潰，不保證與 GAS 版對 all-day 事件的顯示完全一致（GAS 版對此也未特別處理）。
function mapEventToNormalized(ev) {
  const startIso = (ev.start && (ev.start.dateTime || ev.start.date)) || '';
  const endIso = (ev.end && (ev.end.dateTime || ev.end.date)) || '';
  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs = endIso ? new Date(endIso).getTime() : NaN;
  const updatedMs = ev.updated ? new Date(ev.updated).getTime() : NaN;
  const creators = [];
  if (ev.creator && ev.creator.email) creators.push(ev.creator.email);
  return {
    id: ev.id,
    title: ev.summary || '',
    date: Number.isNaN(startMs) ? '' : taipeiYmd(startMs),
    startTime: Number.isNaN(startMs) ? '' : taipeiHm(startMs),
    endTime: Number.isNaN(endMs) ? '' : taipeiHm(endMs),
    description: ev.description || '',
    lastModified: Number.isNaN(updatedMs) ? (ev.updated || '') : new Date(updatedMs).toISOString(),
    creators,
    colorId: ev.colorId ? String(ev.colorId) : '',
  };
}

// { summary, description, start:{dateTime,timeZone}, end:{dateTime,timeZone} }（不含 colorId——
// colorId 由呼叫端（createGcEvent/updateGcEvent）另外用獨立 PATCH 呼叫設定並各自 try/catch 吞錯，
// 對映 GAS event.setColor() 失敗不影響事件本體建立/更新成功與否的行為，見該二函式註解）。
// date/startTime/endTime 直接以字串組出帶 +08:00 明確時區位移的 RFC3339，不經 Date 物件轉換，
// 避免任何隱含依賴伺服器本機時區的環節。
function buildEventResourceFields({ room, customRoom, date, startTime, endTime, counselorName, notes, actorName, actorTime, bkSerial, isEdit }) {
  return {
    summary: buildEventTitle(room, counselorName, customRoom || ''),
    description: buildEventDesc(actorName || counselorName || '', notes, actorTime, bkSerial, !!isEdit),
    start: { dateTime: `${date}T${startTime}:00+08:00`, timeZone: 'Asia/Taipei' },
    end: { dateTime: `${date}T${endTime}:00+08:00`, timeZone: 'Asia/Taipei' },
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  協調函式（觸網／讀寫本地 DB）
// ══════════════════════════════════════════════════════════════════════════

// credsPath → { tokenCache, calendarIdCache }（單一 server process 生命週期）。日曆 id 也快取
// （resolveByName 需分頁掃整份 calendarList，不宜每次呼叫都重打），比照 actions/mail.js 的
// tokenCaches 慣例。
const clientCache = new Map();

// config 未設定 CALENDAR_SYNC_CREDS（尚未部署日曆同步憑證）時回傳 null——呼叫端（dispatch.js／
// bookingsCommitWithGc）各自決定「未設定」的處理方式：dispatch 7 個日曆 action 直接 throw 業務錯誤
// （見 requireCalendarClient）；bookingsCommitWithGc 則靜默維持 Phase 1.5 行為（僅 RMW，不觸網）。
function calendarClientFromConfig(config) {
  if (!config || !config.CALENDAR_SYNC_CREDS) return null;
  const credsPath = config.CALENDAR_SYNC_CREDS;
  const calendarName = config.GC_CALENDAR_NAME || 'SCC 空間預約';
  let entry = clientCache.get(credsPath);
  if (!entry) {
    const creds = googleAuth.loadCreds(credsPath);
    entry = { tokenCache: googleAuth.createTokenCache(creds), calendarIdCache: new Map() };
    clientCache.set(credsPath, entry);
  }
  return {
    calendarName,
    getAccessToken() { return entry.tokenCache.getAccessToken(); },
    // 對映 getOrCreateCalendar_：0 筆／多筆同名日曆的錯誤訊息逐字對齊 GAS 版。
    async getCalendarId() {
      if (entry.calendarIdCache.has(calendarName)) return entry.calendarIdCache.get(calendarName);
      const token = await entry.tokenCache.getAccessToken();
      const matches = await calendarApi.findCalendarsByName(token, calendarName);
      if (matches.length === 0) {
        throw new Error('找不到日曆「' + calendarName + '」，請確認執行帳號已被加入該日曆共用名單，且權限為「進行變更並管理共用設定」。');
      }
      if (matches.length > 1) {
        throw new Error('找到 ' + matches.length + ' 顆同名日曆「' + calendarName + '」，請確認共用設定，移除或改名多餘的日曆後再試。');
      }
      const id = matches[0].id;
      entry.calendarIdCache.set(calendarName, id);
      return id;
    },
  };
}

function requireCalendarClient(config) {
  const c = calendarClientFromConfig(config);
  if (!c) throw new Error('伺服器尚未設定 CALENDAR_SYNC_CREDS（日曆同步憑證檔路徑），請聯絡系統管理者');
  return c;
}

// 對映 createCalendarEvent_：回傳新事件 id（REST 格式，無 @google.com 後綴）。
async function createGcEvent(calendarClient, params) {
  const { room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, bkSerial, colorId } = params || {};
  const resource = buildEventResourceFields({
    room, customRoom, date, startTime, endTime, counselorName, notes,
    actorName: creatorName || counselorName || '', actorTime: createdAt, bkSerial, isEdit: false,
  });
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  const created = await calendarApi.insertEvent(token, calId, resource);
  if (colorId) {
    try { await calendarApi.patchEvent(token, calId, created.id, { colorId: String(colorId) }); }
    catch (_e) { /* colorId 1-11 有效；異常則沿用預設（對映 GAS event.setColor 的 try/catch） */ }
  }
  return created.id;
}

// 對映 updateCalendarEvent_：eventId 找不到 → throw 'Event not found: <eventId>'（逐字對齊）。
async function updateGcEvent(calendarClient, params) {
  const { eventId, room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, updatedAt, isEdit, bkSerial, colorId } = params || {};
  const actorTime = isEdit ? (updatedAt || createdAt) : createdAt;
  const resource = buildEventResourceFields({
    room, customRoom, date, startTime, endTime, counselorName, notes,
    actorName: creatorName || counselorName || '', actorTime, bkSerial, isEdit,
  });
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  const normId = normalizeEventId(eventId);
  try {
    await calendarApi.patchEvent(token, calId, normId, resource);
  } catch (e) {
    if (e.status === 404) throw new Error('Event not found: ' + eventId);
    throw e;
  }
  if (colorId) {
    try { await calendarApi.patchEvent(token, calId, normId, { colorId: String(colorId) }); }
    catch (_e) { /* 沿用既有色（對映 GAS event.setColor 的 try/catch） */ }
  }
  return { ok: true };
}

// 對映 deleteCalendarEvent_：找不到事件（404/410）視為本來就不存在，no-op（不 throw）——
// GAS 版 cal.getEventById 找不到回 null，`if (event) event.deleteEvent();` 直接略過。
async function deleteGcEvent(calendarClient, { eventId }) {
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  try {
    await calendarApi.deleteEvent(token, calId, normalizeEventId(eventId));
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
  }
  return { ok: true };
}

// 對映 listCalendarEvents_：{ startDate, endDate } 為 'yyyy-MM-dd'。singleEvents=true 已在
// google/calendar.js listEvents 內固定帶上（對映 CalendarApp.getEvents 展開週期性事件的行為）。
async function listGcEventsNormalized(calendarClient, { startDate, endDate }) {
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  const raw = await calendarApi.listEvents(token, calId, {
    timeMin: startDate + 'T00:00:00+08:00',
    timeMax: endDate + 'T23:59:59+08:00',
  });
  return raw.map(mapEventToNormalized);
}

// 對映 gcAnnotateEvent_。
async function annotateGcEvent(calendarClient, { eventId, noteText, marker }) {
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  const normId = normalizeEventId(eventId);
  let ev;
  try {
    ev = await calendarApi.getEvent(token, calId, normId);
  } catch (e) {
    if (e.status === 404) throw new Error('Event not found: ' + eventId);
    throw e;
  }
  const computed = computeAnnotatedDescription(ev.description || '', noteText, marker);
  if (computed.skipped) return { ok: true, skipped: true };
  await calendarApi.patchEvent(token, calId, normId, { description: computed.newDesc });
  return { ok: true, skipped: false };
}

// 對映 getCalendarMeta_。
async function getCalendarMeta(calendarClient) {
  return { calendarId: await calendarClient.getCalendarId() };
}

// 對映 shareCalendarWriters_（Calendar.Acl.insert/update/remove 的 REST 對映）。
async function shareCalendarWriters(calendarClient, { emails, revoke }) {
  const token = await calendarClient.getAccessToken();
  const calId = await calendarClient.getCalendarId();
  const results = { granted: [], removed: [], errors: [] };
  for (const email of (emails || [])) {
    if (!email || typeof email !== 'string') continue;
    const ruleId = 'user:' + email;
    try {
      if (revoke) {
        try {
          await calendarApi.aclDelete(token, calId, ruleId);
        } catch (e) {
          if (!/not found/i.test((e && e.message) || '')) throw e;
        }
        results.removed.push(email);
      } else {
        const resource = { role: 'owner', scope: { type: 'user', value: email } };
        try {
          await calendarApi.aclInsert(token, calId, resource);
        } catch (e) {
          if (/already exists|duplicate/i.test((e && e.message) || '')) {
            await calendarApi.aclUpdate(token, calId, ruleId, resource);
          } else {
            throw e;
          }
        }
        results.granted.push(email);
      }
    } catch (e) {
      results.errors.push({ email, message: (e && e.message) || String(e) });
    }
  }
  return results;
}

// ── 讀 config.json 取 users（人名→email 解析用）；讀不到則回傳空物件（對映 _gcSyncReadUsers_，
//    不阻擋同步，只是無法還原 email）。
function readUsersForGcSync(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || {};
  } catch (_e) {
    return {};
  }
}

// 對映 _gcSyncAppendAuditLog_：附加到 audit_log.json 的 logs 陣列（前端「稽核紀錄」頁讀取的
// Drive 檔案，與 src/audit.js 寫入的本地 SQLite 操作日誌是兩份不同的稽核紀錄——後者是 Node 版
// 新增的伺服器維運日誌，不影響前端顯示）。直接重用 actions/commit.js 的 listCommit（append 模式、
// 交易內讀-改-寫，等效 GAS 版 LockService 防競態寫入）。
function appendGcSyncAuditLog(db, entries, ctx) {
  if (!entries || !entries.length) return;
  const now = new Date().toISOString();
  const upserts = entries.map((a) => {
    const entry = { t: now, email: 'system', name: '系統自動同步', action: a.action };
    if (a.caseId) entry.caseId = a.caseId;
    if (a.detail) entry.detail = a.detail;
    return entry;
  });
  commitActions.listCommit(db, { file: 'audit_log.json', upserts }, ctx);
}

// 純函式：單筆 booking 與其對映 GC 事件（可能不存在）的比對決策。對映 gcSyncCore_ 內
// newBookings.map 的比對段（L3846-3930）。回傳：
//   { kind: 'deleted' }                                     — GC 上已刪除，本機應同步刪除
//   { kind: 'unchanged', serialMismatch }                   — 無需更動 booking 欄位
//   { kind: 'changed', update, diffs, serialMismatch, roomDisplay } — 需以 GC 現況覆蓋 booking 欄位
// users 為選填（不影響 titleChanged/timeChanged/notesChanged 判定本身，只在需要解析新標題的
// 人員/空間欄位時才用得到——傳 null/undefined 時 gcSyncParseTitle 仍可運作，只是解不出真實 email）。
function diffBookingAgainstGcEvent(b, gcE, users) {
  if (!gcE) return { kind: 'deleted' };

  const bStart = (b.startTime || '').slice(0, 5);
  const bEnd = (b.endTime || '').slice(0, 5);
  const { serial: gcSerial, notes: gcNotes } = parseEventDescription(gcE.description || '');
  const serialMismatch = !!(b.bkSerial && gcSerial !== b.bkSerial);

  const expectedTitle = buildEventTitle(b.room, b.counselorName, b.customRoom || '');
  const titleChanged = gcE.title !== expectedTitle;
  const timeChanged = gcE.date !== b.date || gcE.startTime !== bStart || gcE.endTime !== bEnd;
  const notesChanged = gcNotes !== (b.notes || '');

  if (!(titleChanged || timeChanged || notesChanged)) {
    return { kind: 'unchanged', serialMismatch };
  }

  const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
  const diffs = [];
  const update = {};

  if (titleChanged) {
    const parsed = gcSyncParseTitle(gcE.title, users);
    if (parsed) {
      if (parsed.room && parsed.room !== rd) {
        diffs.push('空間 ' + rd + '→' + parsed.room);
        update.room = parsed.room; update.customRoom = '';
      }
      if ((parsed.counselorName || '') !== (b.counselorName || '')) {
        diffs.push('人員 ' + (b.counselorName || '—') + '→' + (parsed.counselorName || '—'));
        update.counselors = parsed.counselors; update.counselorName = parsed.counselorName; update.counselorEmail = parsed.counselorEmail;
      }
    }
  }
  if (timeChanged) {
    diffs.push(b.date + ' ' + bStart + '–' + bEnd + '→' + gcE.date + ' ' + gcE.startTime + '–' + gcE.endTime);
    update.date = gcE.date; update.startTime = gcE.startTime; update.endTime = gcE.endTime;
  }
  if (notesChanged) {
    diffs.push('說明 ' + (b.notes || '—') + '→' + (gcNotes || '—'));
    update.notes = gcNotes;
  }

  if (Object.keys(update).length === 0) return { kind: 'unchanged', serialMismatch };
  return { kind: 'changed', update, diffs, serialMismatch, roomDisplay: rd };
}

// GC 同步核心：讀 bookings.json + config.json + GC 事件（-30d~+90d），逐筆比對，套用變更
// （刪除/更新/流水號還原），寫回 bookings.json 並記稽核，最後跑自動匯入。對映 gcSyncCore_。
// 全程 try/catch：單筆推回/還原失敗 console.error 後繼續；整體失敗 console.error 不拋出
// （對映 trigger 不該紅——CLI 進入點 scripts/gc-sync-tick.js 呼叫本函式不會因同步失敗而非零 exit，
// 這是刻意對齊 GAS trigger 語意，非疏漏）。
async function gcSyncCore(db, ctx, calendarClient) {
  try {
    let bookings;
    try {
      const { data } = vdrive.readJson(db, 'bookings.json', ctx);
      bookings = Array.isArray(data && data.bookings) ? data.bookings : [];
    } catch (_e) {
      bookings = [];
    }
    if (!bookings.length) return;

    const users = readUsersForGcSync(db, ctx);

    const nowMs = Date.now();
    const startDate = taipeiYmd(nowMs - 30 * 86400 * 1000);
    const endDate = taipeiYmd(nowMs + 90 * 86400 * 1000);

    const gcEvents = await listGcEventsNormalized(calendarClient, { startDate, endDate });
    const gcMap = {};
    gcEvents.forEach((e) => { gcMap[normalizeEventId(e.id)] = e; });

    const deletedIds = {};
    const changedIds = {};
    const serialRestoreQueue = [];
    const auditActions = [];

    const newBookings = bookings.map((b) => {
      if (!b || !b.calendarEventId) return b;
      if (b.date < startDate || b.date > endDate) return b; // 查詢範圍外的預約不納入刪除判斷

      const gcE = gcMap[normalizeEventId(b.calendarEventId)];
      const decision = diffBookingAgainstGcEvent(b, gcE, users);

      if (decision.kind === 'deleted') {
        const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
        auditActions.push({
          action: '因系統自動同步日曆而刪除預約',
          caseId: b.caseId || null,
          detail: rd + '　' + b.date + '　' + (b.startTime || '').slice(0, 5) + '–' + (b.endTime || '').slice(0, 5) + (b.counselorName ? '　' + b.counselorName : ''),
        });
        deletedIds[b.id] = true;
        return b;
      }

      if (decision.serialMismatch) serialRestoreQueue.push(b.id);

      if (decision.kind === 'changed') {
        changedIds[b.id] = true;
        auditActions.push({
          action: '因系統自動同步日曆而更新',
          caseId: b.caseId || null,
          detail: decision.roomDisplay + (b.counselorName ? '　' + b.counselorName : '') + '　' + decision.diffs.join('；'),
        });
        return Object.assign({}, b, decision.update);
      }
      return b;
    });

    if (Object.keys(changedIds).length || Object.keys(deletedIds).length) {
      const ops = [];
      newBookings.forEach((b) => { if (b && changedIds[b.id]) ops.push({ op: 'upsert', booking: Object.assign({}, b) }); });
      Object.keys(deletedIds).forEach((id) => ops.push({ op: 'delete', id }));
      if (ops.length) {
        try {
          commitActions.bookingsCommit(db, { ops, checkConflicts: false }, ctx);
        } catch (e) {
          console.error('gcSyncCore bookingsCommit 失敗: ' + ((e && e.message) || e));
        }
      }
    }
    if (auditActions.length) {
      try { appendGcSyncAuditLog(db, auditActions, ctx); }
      catch (e) { console.error('gcSyncCore 稽核寫入失敗: ' + ((e && e.message) || e)); }
    }

    // 流水號還原：重寫 GC description（不重算 colorId，沿用既有顏色——後端無使用者色彩偏好可查）。
    // 註：GAS 版另有 gcPushBackQueue（系統較新推回 GC），但 2026-07-08 已改為「GC 端有差異一律
    // 拉進 INFOSYS」，該佇列宣告後從未 push 任何值，是保留的死碼；Node 版比照效果，不重建此佇列。
    for (const id of serialRestoreQueue) {
      const bk = newBookings.find((b) => b && b.id === id);
      if (!bk || !bk.calendarEventId) continue;
      try {
        const isEdit = !!(bk.updatedAt && bk.updatedAt !== bk.createdAt);
        await updateGcEvent(calendarClient, {
          eventId: bk.calendarEventId, room: bk.room, customRoom: bk.customRoom || '',
          date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
          counselorName: bk.counselorName || '', notes: bk.notes || '',
          creatorName: bk.creatorName || bk.counselorName || '',
          createdAt: bk.createdAt, updatedAt: bk.updatedAt || bk.createdAt,
          isEdit, bkSerial: bk.bkSerial,
        });
      } catch (e) {
        console.error('gcSyncCore 流水號還原失敗 [' + id + ']: ' + ((e && e.message) || e));
      }
    }

    // GC 新增、可解析為已知空間的事件 → 自動匯入為系統預約。
    try {
      await gcAutoImportKnownRoom(db, ctx, calendarClient, gcEvents, startDate, endDate, users);
    } catch (e) {
      console.error('gcSyncCore 自動匯入失敗: ' + ((e && e.message) || e));
    }
  } catch (e) {
    console.error('gcSyncCore 失敗: ' + ((e && e.message) || e));
  }
}

// 對映 gcAutoImportKnownRoom_：重讀 bookings.json 取最新占用與最大流水號，逐一為「未對應且標題為
// 已知空間」的 GC 事件建立預約，再回寫 GC serial/creator＋記稽核。
async function gcAutoImportKnownRoom(db, ctx, calendarClient, gcEvents, startDate, endDate, users) {
  let bookings;
  try {
    const { data } = vdrive.readJson(db, 'bookings.json', ctx);
    bookings = Array.isArray(data && data.bookings) ? data.bookings : [];
  } catch (_e) {
    bookings = [];
  }
  const matched = {};
  let maxSerial = 0;
  bookings.forEach((b) => {
    if (b && b.calendarEventId) matched[normalizeEventId(b.calendarEventId)] = true;
    if (b && b.bkSerial > maxSerial) maxSerial = b.bkSerial;
  });
  const toImport = (gcEvents || []).filter((ev) => ev && ev.id && !matched[normalizeEventId(ev.id)] && ev.date >= startDate && ev.date <= endDate && gcKnownRoomOfTitle(ev.title));
  if (!toImport.length) return;

  const ops = [];
  const created = [];
  const auditActions = [];
  toImport.forEach((ev, idx) => {
    const parsed = gcSyncParseTitle(ev.title, users) || { room: '', counselors: [], counselorName: '', counselorEmail: '' };
    const { notes } = parseEventDescription(ev.description || '');
    const now = new Date().toISOString();
    const bk = {
      id: 'bk_gc_' + Date.now() + '_' + idx,
      bkSerial: maxSerial + 1 + idx,
      room: parsed.room || '', customRoom: '',
      date: ev.date, startTime: ev.startTime, endTime: ev.endTime,
      counselors: parsed.counselors || [], counselorEmail: parsed.counselorEmail || '', counselorName: parsed.counselorName || '',
      caseId: '', caseName: '', notes,
      createdAt: now, updatedAt: now, creatorName: '系統自動同步',
      calendarEventId: ev.id,
    };
    created.push(bk);
    ops.push({ op: 'upsert', booking: bk });
    auditActions.push({
      action: '因系統自動同步日曆而匯入預約',
      caseId: null,
      detail: (bk.room || '') + '　' + bk.date + '　' + (bk.startTime || '').slice(0, 5) + '–' + (bk.endTime || '').slice(0, 5) + (bk.counselorName ? '　' + bk.counselorName : ''),
    });
  });

  try {
    commitActions.bookingsCommit(db, { ops, checkConflicts: false }, ctx);
  } catch (e) {
    console.error('gcAutoImportKnownRoom bookingsCommit 失敗: ' + ((e && e.message) || e));
    return;
  }

  for (const bk of created) {
    try {
      await updateGcEvent(calendarClient, {
        eventId: bk.calendarEventId, room: bk.room, customRoom: '',
        date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
        counselorName: bk.counselorName || '', notes: bk.notes || '',
        creatorName: bk.creatorName, createdAt: bk.createdAt, updatedAt: bk.updatedAt,
        isEdit: false, bkSerial: bk.bkSerial,
      });
    } catch (e) {
      console.error('gcAutoImportKnownRoom 回寫 GC 失敗: ' + ((e && e.message) || e));
    }
  }
  try { appendGcSyncAuditLog(db, auditActions, ctx); }
  catch (e) { console.error('gcAutoImportKnownRoom 稽核失敗: ' + ((e && e.message) || e)); }
}

// ── bookingsCommit 的 gc 參數整合 ───────────────────────────────────────────
// 對映 dev/Code.gs bookingsCommit_ 的 Phase 2（鎖外 GC best-effort）＋Phase 3（拿到新 eventId 才
// 補寫 calendarEventId）。刻意不修改 actions/commit.js 既有的（同步、無 GC）bookingsCommit——
// 那支函式有直接的單元測試假設同步呼叫/回傳（見 test/commit-actions.test.js），維持其純 RMW
// 語意；本函式是薄薄一層 wrapper：先呼叫既有 bookingsCommit 做 Phase 1（RMW＋衝突檢查），
// 再視 config 是否已設定 CALENDAR_SYNC_CREDS 決定要不要接著做 GC best-effort。
// 未設定 CALENDAR_SYNC_CREDS 時完全等同舊行為（Phase 1.5：gcErrors 恆為空陣列，不觸網）。
async function bookingsCommitWithGc(db, params, ctx, config) {
  const phase1 = commitActions.bookingsCommit(db, params, ctx);
  if (phase1 && phase1.error) return phase1; // 撞房/撞人衝突，未寫入，不做任何 GC 操作

  const calClient = calendarClientFromConfig(config);
  if (!calClient) return phase1;

  const ops = (params && params.ops) || [];
  const gcErrors = [];
  const idToNewEventId = {};
  for (const o of ops) {
    try {
      if (o.op === 'upsert' && o.gc && o.gc.mode === 'create') {
        const eid = await createGcEvent(calClient, o.gc.params || {});
        if (eid) idToNewEventId[o.booking.id] = eid;
      } else if (o.op === 'upsert' && o.gc && o.gc.mode === 'update' && o.booking.calendarEventId) {
        await updateGcEvent(calClient, Object.assign({ eventId: o.booking.calendarEventId }, o.gc.params || {}));
      } else if (o.op === 'delete' && o.gcEventId) {
        await deleteGcEvent(calClient, { eventId: o.gcEventId });
      }
    } catch (e) {
      gcErrors.push({ id: (o.booking && o.booking.id) || o.id, message: (e && e.message) || String(e) });
    }
  }

  // Phase 3：僅在拿到新 eventId 時，再次寫回 calendarEventId（沿用 bookingsCommit 的 upsert 語意，
  // checkConflicts:false——這不是新的使用者操作，只是把 Phase 2 拿到的新 id 補進既有紀錄）。
  if (Object.keys(idToNewEventId).length) {
    const phase3Ops = (phase1.bookings || [])
      .filter((b) => b && idToNewEventId[b.id])
      .map((b) => ({ op: 'upsert', booking: Object.assign({}, b, { calendarEventId: idToNewEventId[b.id] }) }));
    if (phase3Ops.length) {
      try {
        commitActions.bookingsCommit(db, { ops: phase3Ops, checkConflicts: false }, ctx);
      } catch (e) {
        gcErrors.push({ id: 'phase3', message: 'calendarEventId 補寫失敗：' + ((e && e.message) || e) });
      }
    }
  }

  const affectedIds = {};
  ops.forEach((o) => { if (o.op === 'upsert' && o.booking && o.booking.id) affectedIds[o.booking.id] = true; });
  let finalBookings = phase1.bookings || [];
  if (Object.keys(idToNewEventId).length) {
    try {
      const { data } = vdrive.readJson(db, 'bookings.json', ctx);
      finalBookings = (data.bookings || []).filter((b) => b && affectedIds[b.id]);
    } catch (_e) { /* 讀不到就沿用 phase1 結果，不因補寫查驗失敗而讓整個 commit 報錯 */ }
  }

  return { ok: true, bookings: finalBookings, gcErrors };
}

module.exports = {
  GC_SYNC_ROOMS,
  // 純函式
  normalizeEventId,
  gcSyncParseTitle,
  buildEventTitle,
  buildEventDesc,
  parseEventDescription,
  gcKnownRoomOfTitle,
  gcSyncShouldRun,
  computeAnnotatedDescription,
  mapEventToNormalized,
  buildEventResourceFields,
  diffBookingAgainstGcEvent,
  // 協調函式
  calendarClientFromConfig,
  requireCalendarClient,
  createGcEvent,
  updateGcEvent,
  deleteGcEvent,
  listGcEventsNormalized,
  annotateGcEvent,
  getCalendarMeta,
  shareCalendarWriters,
  readUsersForGcSync,
  appendGcSyncAuditLog,
  gcSyncCore,
  gcAutoImportKnownRoom,
  bookingsCommitWithGc,
};
