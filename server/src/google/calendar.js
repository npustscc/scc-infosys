// server/src/google/calendar.js — Google Calendar REST v3 薄封裝層。對映 dev/Code.gs
// CalendarApp/Calendar 進階服務呼叫（getOrCreateCalendar_/createCalendarEvent_/updateCalendarEvent_/
// deleteCalendarEvent_/listCalendarEvents_/shareCalendarWriters_，L1807-2029）。全域 fetch
// （Node >=18 內建，零新 npm 依賴）。業務邏輯（標題/描述組字、diff 決策、GAS bug-for-bug 相容）
// 一律不放在本檔——本檔只管「怎麼呼叫 Calendar REST API」，放在 src/sync/gcSync.js。
//
// 測試友善設計：跟 google/gmail.js 同慣例，內部一律透過 `exports.xxx(...)` 呼叫自身其他函式，
// 使測試可用整包物件替換（monkey-patch）掉個別方法而不需真的打網路。
'use strict';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

// 泛用底層呼叫：回傳解析後的 JSON；非 2xx 一律 throw，並在 Error 物件附上 `.status`（HTTP 狀態碼），
// 供上層（gcSync.js）判斷「404＝事件已不存在」等語意（對映 GAS CalendarApp.getEventById() 找不到
// 回 null 的行為——REST 版改用明確的 404 狀態碼分辨，而非 try/catch 隱式判斷）。
// DELETE 成功回應通常是 204 No Content（空 body），與 GET/POST/PATCH 共用同一套「空字串視為 {}」解析。
async function calendarFetch(accessToken, path, opts) {
  opts = opts || {};
  const fetchOpts = {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + accessToken },
  };
  if (opts.body !== undefined) {
    fetchOpts.headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(CALENDAR_API_BASE + path, fetchOpts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    const err = new Error('Calendar API 回應不是合法 JSON（HTTP ' + res.status + '）：' + path.split('?')[0]);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
    const err = new Error('Calendar API 呼叫失敗：' + path.split('?')[0] + '（' + msg + '）');
    err.status = res.status;
    throw err;
  }
  return json;
}

// ── calendarList.list：依名稱找日曆（分頁掃完整份清單）──
// 對映 CalendarApp.getCalendarsByName(name)：回傳「所有 summary 完全相符」的日曆清單（可能 0/1/多筆），
// 由呼叫端（gcSync.js）決定 0 筆／多筆時的錯誤語意（getOrCreateCalendar_ 對這兩種情形各自有不同錯誤
// 訊息），本函式本身不下判斷、不 throw——保持薄層。
async function findCalendarsByName(accessToken, name) {
  const matches = [];
  let pageToken;
  do {
    let path = '/users/me/calendarList?maxResults=250';
    if (pageToken) path += '&pageToken=' + encodeURIComponent(pageToken);
    const data = await exports.calendarFetch(accessToken, path);
    (data.items || []).forEach((c) => { if (c && c.summary === name) matches.push(c); });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return matches;
}

// 只回傳「唯一相符」時的 id；找不到或有多筆回傳 null（供想要簡單 truthy 判斷的呼叫端使用）。
// gcSync.js 的 getOrCreateCalendarId 需要精確分辨 0 筆 vs 多筆以組出對映 GAS 的錯誤訊息，
// 故該處改直接呼叫 findCalendarsByName，不使用本函式。
async function resolveCalendarIdByName(accessToken, name) {
  const matches = await exports.findCalendarsByName(accessToken, name);
  return matches.length === 1 ? matches[0].id : null;
}

// ── events.list：分頁抓完整份區間內事件（singleEvents=true 展開週期性事件——對映 CalendarApp.getEvents()
// 一律回傳個別實例、不回傳週期性系列本身的行為）。回傳原始 REST event resource 陣列，正規化為
// GAS listCalendarEvents_ 回傳形狀的工作留給 gcSync.js（含事件 ID 格式、時區安全的日期/時間格式化）。
async function listEvents(accessToken, calendarId, { timeMin, timeMax }) {
  const items = [];
  let pageToken;
  do {
    let path = '/calendars/' + encodeURIComponent(calendarId) + '/events'
      + '?singleEvents=true&maxResults=2500'
      + '&timeMin=' + encodeURIComponent(timeMin)
      + '&timeMax=' + encodeURIComponent(timeMax);
    if (pageToken) path += '&pageToken=' + encodeURIComponent(pageToken);
    const data = await exports.calendarFetch(accessToken, path);
    (data.items || []).forEach((e) => items.push(e));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

async function getEvent(accessToken, calendarId, eventId) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId));
}

async function insertEvent(accessToken, calendarId, resource) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/events', { method: 'POST', body: resource });
}

// PATCH（局部更新）：對映 event.setTitle()/setDescription()/setTime()/setColor() 的合併效果——
// 只送有變動的欄位，未提及的欄位（如既有的 attendees/reminders）維持不變，語意較 PUT 貼近 GAS 版
// 「逐一呼叫 setter」的局部修改行為。
async function patchEvent(accessToken, calendarId, eventId, resource) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId), { method: 'PATCH', body: resource });
}

async function deleteEvent(accessToken, calendarId, eventId) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId), { method: 'DELETE' });
}

// ── acl：shareCalendarWriters_ 用（Calendar 進階服務 Calendar.Acl.insert/update/remove 的 REST 對映）──
async function aclInsert(accessToken, calendarId, resource) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/acl', { method: 'POST', body: resource });
}

async function aclUpdate(accessToken, calendarId, ruleId, resource) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/acl/' + encodeURIComponent(ruleId), { method: 'PUT', body: resource });
}

async function aclDelete(accessToken, calendarId, ruleId) {
  return exports.calendarFetch(accessToken, '/calendars/' + encodeURIComponent(calendarId) + '/acl/' + encodeURIComponent(ruleId), { method: 'DELETE' });
}

exports.CALENDAR_API_BASE = CALENDAR_API_BASE;
exports.calendarFetch = calendarFetch;
exports.findCalendarsByName = findCalendarsByName;
exports.resolveCalendarIdByName = resolveCalendarIdByName;
exports.listEvents = listEvents;
exports.getEvent = getEvent;
exports.insertEvent = insertEvent;
exports.patchEvent = patchEvent;
exports.deleteEvent = deleteEvent;
exports.aclInsert = aclInsert;
exports.aclUpdate = aclUpdate;
exports.aclDelete = aclDelete;
