// server/src/actions/commit.js — 五個「厚 commit action」垂直切片：casesUpsert／attendanceCommit／
// bookingsCommit／listCommit／notifCommit。對映 dev/Code.gs L2540-2950（casesUpsert_/attendanceCommit_/
// listCommit_/notifCommit_）與 L3234-3438（bookingsCommit_）。
//
// 併發模型：GAS 版用 LockService.getScriptLock()（全域鎖）保護「讀-改-寫」整段；Node 版改用
// better-sqlite3 的 db.transaction(fn).immediate()——IMMEDIATE 立刻取得寫鎖（等效 BEGIN IMMEDIATE），
// 同一 db handle 上的另一個交易若同時嘗試寫入會被序列化（受 db.js 設定的 busy_timeout 保護，
// 逾時才拋 SQLITE_BUSY，等效 GAS lock.waitLock(15000) 逾時拋錯的語意）。整段讀-改-寫（含檔案不存在時
// 的建檔）都在同一個 transaction 內完成，不會有「讀到舊值、寫回時蓋掉別人已提交的新值」的窗口。
//
// fail-closed（2026-07-08/07-09 事故教訓，見 CLAUDE.md）：檔案存在但內容不是預期形狀（JSON 解析失敗、
// 頂層陣列/物件缺失）一律 throw 中止整個交易（better-sqlite3 自動 ROLLBACK），絕不以空殼覆寫已有資料。
'use strict';

const vdrive = require('../storage/vdrive');
const audit = require('../audit');

// 共用讀檔：path 解析不到 → 回傳 fileId=null（呼叫端建立預設空殼）；解析到但檔案列消失/已在回收桶
// （理論上因整段包在同一交易內、不會有其他交易能在讀後但寫前把它 trash 掉，這裡仍保留防呆）→ 用
// 呼叫端提供的訊息字串 throw（訊息格式對映 GAS 版「讀取 X 失敗（HTTP nnn）」的等義中止語意，Node 版
// 沒有 HTTP round trip，故不含 HTTP 狀態碼，其餘用詞逐字對齊）。JSON.parse 失敗同樣視為讀取失敗。
function readExistingOrNull(db, path, ctx, readFailMessage) {
  let fileId;
  try {
    fileId = vdrive.resolvePathToId(db, path, ctx);
  } catch (_e) {
    return { fileId: null, data: undefined };
  }
  const row = vdrive.getFileById(db, fileId);
  if (!row || row.trashed) throw new Error(readFailMessage);
  let parsed;
  try {
    parsed = row.content == null ? null : JSON.parse(row.content);
  } catch (_e) {
    throw new Error(readFailMessage);
  }
  return { fileId, data: parsed };
}

function writeBack(db, fileId, path, data, ctx) {
  if (fileId) {
    vdrive.updateContentById(db, fileId, data);
    return fileId;
  }
  const { parentId, fileName } = vdrive.resolvePathToParentAndName(db, path, ctx);
  const created = vdrive.createJson(db, { name: fileName, content: data, parentId });
  return created.id;
}

// 依 id upsert（既有 id → 原地取代；新 id → append）。對映 GAS 各 commit action 共用的 pos/upsert 樣式。
function upsertById(list, items) {
  const pos = {};
  list.forEach((item, i) => { if (item && item.id) pos[item.id] = i; });
  (items || []).forEach((item) => {
    if (!item || !item.id) return;
    if (pos[item.id] !== undefined) list[pos[item.id]] = item;
    else { pos[item.id] = list.length; list.push(item); }
  });
  return list;
}

// 依 id 陣列移除；removes 為空時完全不過濾（GAS 版同樣只在 Object.keys(rmSet).length 時才 filter，
// 避免無意義地丟掉沒有 id 欄位的既有項目）。
function removeByIds(list, ids) {
  const rmSet = {};
  (ids || []).forEach((id) => { if (id) rmSet[id] = true; });
  if (!Object.keys(rmSet).length) return list;
  return list.filter((item) => item && item.id && !rmSet[item.id]);
}

// ── casesUpsert：cases-hot.json／cases-index.json／個案 chunk 檔（cases/{name}.json）共用 upsert ──
// 對映 dev/Code.gs casesUpsert_（L2546）。v155：關閉「前端整檔覆寫」個案 chunk 的併發覆蓋窗口。
function casesUpsert(db, { path, upserts, removes }, ctx) {
  if (!path) throw new Error('casesUpsert: path required');
  return db.transaction(() => {
    const { fileId, data: loaded } = readExistingOrNull(
      db, path, ctx,
      `casesUpsert: 讀取 ${path} 失敗，已中止寫入以保護資料`
    );
    let data;
    if (fileId == null) {
      data = { updatedAt: '', cases: [] };
    } else {
      if (!loaded || !Array.isArray(loaded.cases)) {
        throw new Error(`casesUpsert: ${path} 內容異常（cases 非陣列），已中止寫入以保護資料`);
      }
      data = loaded;
    }

    data.cases = upsertById(data.cases, upserts);
    data.cases = removeByIds(data.cases, removes);
    data.updatedAt = new Date().toISOString();

    writeBack(db, fileId, path, data, ctx);
    return { ok: true, count: data.cases.length, updatedAt: data.updatedAt };
  }).immediate();
}

// ── attendanceCommit：attendance.json 併發安全打卡寫入 ──
// 對映 dev/Code.gs attendanceCommit_（L2660）。修 2026-07-09 事故：前端整檔覆寫多人同時打卡互相蓋掉。
// v168 彙整信：GAS 版鎖釋放後 MailApp 寄信；Node Phase 1 無 SMTP，改落 audit_log 紀錄
// （action='attendanceCommit.punchMail', outcome='skipped', detail 含 mailSent=false），
// 回傳形狀不受影響（GAS 版 attendanceCommit_ 的回傳本就不含 mailSent 欄位——寄信是鎖外的純副作用）。
function attendanceCommit(db, { upserts, removes }, ctx) {
  const newPunches = [];
  const result = db.transaction(() => {
    const { fileId, data: loaded } = readExistingOrNull(
      db, 'attendance.json', ctx,
      'attendanceCommit: 讀取 attendance.json 失敗，已中止寫入以保護資料'
    );
    let data;
    if (fileId == null) {
      data = { records: [] };
    } else {
      if (!loaded || !Array.isArray(loaded.records)) {
        throw new Error('attendanceCommit: attendance.json 內容異常（records 非陣列），已中止寫入以保護資料');
      }
      data = loaded;
    }

    const pos = {};
    data.records.forEach((r, i) => { if (r && r.id) pos[r.id] = i; });
    (upserts || []).forEach((rec) => {
      if (!rec || !rec.id) return;
      if (pos[rec.id] !== undefined) {
        data.records[pos[rec.id]] = rec;
      } else {
        pos[rec.id] = data.records.length;
        data.records.push(rec);
        if (rec.type === 'punch' && rec.email) newPunches.push(rec);
      }
    });
    data.records = removeByIds(data.records, removes);

    writeBack(db, fileId, 'attendance.json', data, ctx);
    return { ok: true, records: data.records, count: data.records.length };
  }).immediate();

  // 鎖（交易）已釋放：逐筆記錄「本應寄送彙整信」，失敗不得影響打卡主流程或回傳值。
  if (newPunches.length) {
    newPunches.forEach((rec) => {
      try {
        audit.appendAuditLog(db, {
          email: rec.email || null,
          action: 'attendanceCommit.punchMail',
          target: rec.date || null,
          outcome: 'skipped',
          latencyMs: null,
          detail: 'mailSent=false;reason=phase1_no_smtp',
        });
      } catch (_e) { /* 稽核寫入失敗不可影響打卡主流程 */ }
    });
  }

  return result;
}

// ── listCommit：泛用「清單型 JSON 檔」併發安全寫入（白名單 registry，預設 deny）──
// 對映 dev/Code.gs listCommit_ + LIST_COMMIT_REGISTRY_（L2735-2845）。
const LIST_COMMIT_REGISTRY = {
  'leaves.json': { key: 'applications', mode: 'list' },
  'transfer.json': { key: 'records', mode: 'list' },
  'mental_leaves.json': { key: 'records', mode: 'list' },
  'pending_cases.json': { key: 'cases', mode: 'list' },
  'unassigned_records.json': { key: 'records', mode: 'list' },
  'issues.json': { key: 'issues', mode: 'list' },
  'audit_log.json': { key: 'logs', mode: 'append' },
  'case_access_log.json': { key: 'entries', mode: 'append', touchUpdatedAt: true },
  'off_hours_log.json': { key: 'entries', mode: 'append', touchUpdatedAt: true },
  'psych_test_db.json': { mode: 'map' },
};

// file 命中固定 registry，或符合動態規則：pending_users*.json／users/todos_*.json。
// 不認得的檔名一律回 null（呼叫端 throw「不支援的檔案」）——預設 deny，不可讓呼叫端指定任意檔名。
function resolveListCommitEntry(file) {
  if (LIST_COMMIT_REGISTRY[file]) return LIST_COMMIT_REGISTRY[file];
  if (/^pending_users[\w-]*\.json$/.test(file)) return { key: 'applications', mode: 'list' };
  if (/^users\/todos_[^/]+\.json$/.test(file)) return { key: 'todos', mode: 'list' };
  return null;
}

function listCommit(db, params, ctx) {
  const file = params && params.file;
  const upserts = (params && params.upserts) || [];
  const removes = (params && params.removes) || [];
  const meta = (params && params.meta) || null;
  if (!file) throw new Error('listCommit: file required');

  const entry = resolveListCommitEntry(file);
  if (!entry) throw new Error(`listCommit: 不支援的檔案（${file}）`);

  return db.transaction(() => {
    const { fileId, data: loaded } = readExistingOrNull(
      db, file, ctx,
      `listCommit: 讀取 ${file} 失敗，已中止寫入以保護資料`
    );
    let data;
    if (fileId == null) {
      data = entry.mode === 'map' ? {} : { [entry.key]: [] };
    } else if (entry.mode === 'map') {
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
        throw new Error(`listCommit: ${file} 內容異常（非物件），已中止寫入以保護資料`);
      }
      data = loaded;
    } else {
      if (!loaded || !Array.isArray(loaded[entry.key])) {
        throw new Error(`listCommit: ${file} 內容異常（${entry.key} 非陣列），已中止寫入以保護資料`);
      }
      data = loaded;
    }

    if (entry.mode === 'map') {
      // upserts：{ key: value }；removes：[key,...]
      if (removes && removes.length) removes.forEach((k) => { if (k) delete data[k]; });
      if (upserts && typeof upserts === 'object' && !Array.isArray(upserts)) {
        Object.keys(upserts).forEach((k) => { data[k] = upserts[k]; });
      }
    } else if (entry.mode === 'append') {
      if (removes && removes.length) {
        throw new Error(`listCommit: ${file} 為 append-only，不允許 removes`);
      }
      upserts.forEach((item) => { if (item !== undefined && item !== null) data[entry.key].push(item); });
      if (entry.touchUpdatedAt) data.updatedAt = new Date().toISOString();
    } else {
      // list：依 id upsert/remove
      data[entry.key] = upsertById(data[entry.key], upserts);
      data[entry.key] = removeByIds(data[entry.key], removes);
    }

    // meta：呼叫端指定的其他頂層欄位覆寫（如 mental_leaves 的 lastFetchedAt、todos 的
    // suppressedRecordIds/caseSearchPrefs/updatedAt）。
    if (meta && typeof meta === 'object') {
      Object.keys(meta).forEach((k) => { data[k] = meta[k]; });
    }

    writeBack(db, fileId, file, data, ctx);
    return { ok: true, data };
  }).immediate();
}

// ── notifCommit：notifications.json 併發安全寫入（v154：從 config.json 拆分獨立通知檔）──
// 對映 dev/Code.gs notifCommit_ + _notifApplyOp_（L2860-2950）。
// 首次遷移分支：GAS 版首次建檔時把 config.json 各 users[email].notifications 複製進來作初始內容。
// Node 版種子資料已直接含 notifications.json，正常情況不會走到這支；但防呆仍保留（若運維手動清空
// notifications.json 或匯入資料缺漏該檔，仍可安全地從 config.json 補救式初始化，不會整段炸掉）。
function notifApplyOp(users, op) {
  if (!op || !op.email) return;
  const email = op.email;
  if (!Array.isArray(users[email])) users[email] = [];
  const arr = users[email];
  if (op.op === 'push') {
    if (!op.notif || !op.notif.id) return;
    const idx = arr.findIndex((n) => n && n.id === op.notif.id);
    if (idx >= 0) arr.splice(idx, 1);
    arr.unshift(op.notif);
    if (arr.length > 100) users[email] = arr.slice(0, 100);
  } else if (op.op === 'markRead') {
    const n = arr.find((x) => x && x.id === op.id);
    if (n) { n.read = true; n.readAt = op.readAt || new Date().toISOString(); }
  } else if (op.op === 'markAllRead') {
    arr.forEach((n) => { if (n && !n.read) { n.read = true; n.readAt = op.readAt || new Date().toISOString(); } });
  } else if (op.op === 'removeIds') {
    const ids = {};
    (op.ids || []).forEach((id) => { if (id) ids[id] = true; });
    users[email] = arr.filter((n) => !(n && ids[n.id]));
  }
}

function notifCommit(db, params, ctx) {
  const ops = (params && params.ops) || [];
  if (!ops.length) throw new Error('notifCommit: ops required');

  return db.transaction(() => {
    const file = 'notifications.json';
    const { fileId, data: loaded } = readExistingOrNull(
      db, file, ctx,
      'notifCommit: 讀取 notifications.json 失敗，已中止寫入以保護資料'
    );
    let data;
    if (fileId == null) {
      const users = {};
      try {
        const cfg = vdrive.readJson(db, 'config.json', ctx);
        if (cfg.data && cfg.data.users && typeof cfg.data.users === 'object') {
          Object.keys(cfg.data.users).forEach((email) => {
            const u = cfg.data.users[email];
            if (u && Array.isArray(u.notifications) && u.notifications.length) users[email] = u.notifications;
          });
        }
      } catch (_e) { /* config.json 讀取失敗不應永久卡住通知系統啟用；以空殼繼續 */ }
      data = { updatedAt: new Date().toISOString(), users };
    } else {
      if (!loaded || typeof loaded.users !== 'object' || loaded.users === null || Array.isArray(loaded.users)) {
        throw new Error('notifCommit: notifications.json 內容異常（users 非物件），已中止寫入以保護資料');
      }
      data = loaded;
    }

    const touched = {};
    ops.forEach((op) => {
      notifApplyOp(data.users, op);
      if (op && op.email) touched[op.email] = true;
    });
    data.updatedAt = new Date().toISOString();

    writeBack(db, fileId, file, data, ctx);

    const result = {};
    Object.keys(touched).forEach((email) => { result[email] = data.users[email] || []; });
    return { ok: true, touched: result };
  }).immediate();
}

// ── bookingsCommit：bookings.json 併發安全批次寫入＋寫入當下撞房/撞人檢查 ──
// 對映 dev/Code.gs bookingsCommit_（L3317）＋ _bkFindConflictGs_/_bkNormalizeCounselorsGs_（L3243-3281）。
// 與 GAS 版的刻意差異（Phase 1.5 範圍）：GAS 版 Phase 2/3 在鎖外呼叫 createCalendarEvent_/
// updateCalendarEvent_/deleteCalendarEvent_ 做 Google 日曆同步、成功後再次鎖內補寫 calendarEventId；
// Node 後端的日曆同步 action 仍是 Phase 2 GAS 代理 stub（見 actions/proxy.js，尚未實作轉發本體），
// 故本函式只做 Phase 1（RMW＋衝突檢查＋calendarEventId 重複匯入防護），不嘗試呼叫日曆——不是「嘗試
// 失敗」，是本階段尚未整合，因此 gcErrors 恆為空陣列（沿用回傳形狀，前端本就把 gcErrors 當 best-effort
// 附加資訊處理，不會因為是空陣列而改變行為）。
function bkNormalizeCounselors(b) {
  if (b && Array.isArray(b.counselors) && b.counselors.length) return b.counselors;
  if (b && (b.counselorEmail || b.counselorName)) return [{ value: b.counselorEmail || b.counselorName }];
  return [];
}

function bkFindConflict(existing, candidate, opts) {
  opts = opts || {};
  const cStart = String(candidate.startTime || '').slice(0, 5);
  const cEnd = String(candidate.endTime || '').slice(0, 5);
  const cRoom = candidate.room === '其他' ? (candidate.customRoom || '') : (candidate.room || '');
  const cCounselorValues = (candidate.counselors || [])
    .map((c) => c && c.value)
    .filter((v) => v && v !== '中心會議');

  for (let i = 0; i < existing.length; i++) {
    const b = existing[i];
    if (!b || !b.id) continue;
    if (b.date !== candidate.date) continue;
    const bStart = String(b.startTime || '').slice(0, 5);
    const bEnd = String(b.endTime || '').slice(0, 5);
    if (!(cStart < bEnd && cEnd > bStart)) continue;

    const bRoom = b.room === '其他' ? (b.customRoom || '') : (b.room || '');
    if (cRoom && bRoom && cRoom === bRoom) return { type: 'room', with: b };

    if (!opts.skipPerson && cRoom !== bRoom) {
      const bCounselorValues = bkNormalizeCounselors(b)
        .map((c) => c && c.value)
        .filter((v) => v && v !== '中心會議');
      if (cCounselorValues.some((v) => bCounselorValues.indexOf(v) !== -1)) return { type: 'person', with: b };
    }
  }
  return null;
}

function bookingsCommit(db, { ops, checkConflicts, skipPersonConflict }, ctx) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('bookingsCommit: ops required');

  const upsertOps = ops.filter((o) => o && o.op === 'upsert' && o.booking && o.booking.id);
  const deleteOps = ops.filter((o) => o && o.op === 'delete' && o.id);

  return db.transaction(() => {
    const file = 'bookings.json';
    const { fileId, data: loaded } = readExistingOrNull(
      db, file, ctx,
      'bookings.json 讀取失敗，已中止寫入以保護資料'
    );
    let data;
    if (fileId == null) {
      data = { bookings: [] };
    } else {
      if (!loaded || !Array.isArray(loaded.bookings)) {
        throw new Error('bookings.json 內容異常（bookings 非陣列），已中止寫入以保護資料');
      }
      data = loaded;
    }

    if (checkConflicts) {
      const batchIds = {};
      upsertOps.forEach((o) => { batchIds[o.booking.id] = true; });
      for (let i = 0; i < upsertOps.length; i++) {
        const cand = upsertOps[i].booking;
        const pool = data.bookings.filter((b) => b && b.id && b.id !== cand.id && !batchIds[b.id]);
        const conflict = bkFindConflict(pool, cand, { skipPerson: !!skipPersonConflict });
        if (conflict) {
          const w = conflict.with;
          return {
            error: 'conflict',
            conflictType: conflict.type,
            with: {
              id: w.id, date: w.date, room: w.room, customRoom: w.customRoom || '',
              startTime: w.startTime, endTime: w.endTime,
              counselorName: w.counselorName || '', bkSerial: w.bkSerial,
            },
          };
        }
      }
    }

    const pos = {};
    data.bookings.forEach((b, idx) => { if (b && b.id) pos[b.id] = idx; });
    const usedSerials = {};
    data.bookings.forEach((b) => { if (b && b.bkSerial) usedSerials[b.bkSerial] = true; });
    // GC 事件→預約 唯一性：記錄鎖（交易）內現有各 calendarEventId 對應的預約 id，防止重複匯入。
    const eventIdOwner = {};
    data.bookings.forEach((b) => { if (b && b.id && b.calendarEventId) eventIdOwner[b.calendarEventId] = b.id; });

    upsertOps.forEach((o) => {
      const entry = o.booking;
      const isNew = pos[entry.id] === undefined;
      if (isNew && entry.calendarEventId && eventIdOwner[entry.calendarEventId] && eventIdOwner[entry.calendarEventId] !== entry.id) {
        return; // 重複匯入同一 GC 事件，略過（idempotent）
      }
      if (entry.calendarEventId) eventIdOwner[entry.calendarEventId] = entry.id;
      if (isNew && entry.bkSerial && usedSerials[entry.bkSerial]) {
        let maxSerial = 0;
        data.bookings.forEach((b) => { if (b && b.bkSerial > maxSerial) maxSerial = b.bkSerial; });
        entry.bkSerial = maxSerial + 1;
      }
      if (entry.bkSerial) usedSerials[entry.bkSerial] = true;
      if (pos[entry.id] !== undefined) data.bookings[pos[entry.id]] = entry;
      else { pos[entry.id] = data.bookings.length; data.bookings.push(entry); }
    });

    data.bookings = removeByIds(data.bookings, deleteOps.map((o) => o.id));

    writeBack(db, fileId, file, data, ctx);

    const affectedIds = {};
    upsertOps.forEach((o) => { affectedIds[o.booking.id] = true; });
    const finalBookings = data.bookings.filter((b) => b && affectedIds[b.id]);
    // Phase 1.5：不整合 GC（見檔頭註解），gcErrors 恆為空陣列。
    return { ok: true, bookings: finalBookings, gcErrors: [] };
  }).immediate();
}

module.exports = {
  casesUpsert,
  attendanceCommit,
  listCommit,
  notifCommit,
  bookingsCommit,
  // 供 parity 測試直接對打的內部純函式：
  upsertById,
  removeByIds,
  resolveListCommitEntry,
  LIST_COMMIT_REGISTRY,
  notifApplyOp,
  bkFindConflict,
  bkNormalizeCounselors,
};
