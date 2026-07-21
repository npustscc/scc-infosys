// server/src/openmail/offboardSweep.js — v236：學諮系統資料夾（openmail archive）離職清理排程。
//
// 資安／資料安全模型（CLAUDE.md 資安原則、事故教訓 incident_20260708/20260709 的「fail-safe 優先」）：
//   - 定位：學諮系統資料夾（migrations/007/008，openmail_archive_folders/messages）是使用者的
//     「個人工作副本」，不是個案紀錄的權威存放處——屬於個案的信件應由使用者另外歸入個案紀錄
//     （見 dev/index.html v236 前端提醒）。既然是個人副本，使用者離職（帳號停用）後就不該無限期
//     佔用伺服器空間，故訂出「停用滿 90 天（可設定）自動整批刪除」的清理規則。
//   - 最高安全護欄（本專案兩次資料事故的直接教訓：衍生/週期性清理邏輯必須 fail-closed，讀不到
//     權威資料時寧可什麼都不做，也不可誤刪）：config.json 的 users 讀不到（null）、非物件、或
//     Object.values(users) 裡找不到任何一個「未停用」的使用者（全部停用或整個是空物件——這種
//     狀態極不尋常，很可能代表 config 本身壞掉、或讀取邏輯本身出錯，而不是「全公司真的都被停用
//     了」），一律整輪 sweep 直接跳過，不刪除任何東西、也不啟動/推進任何一個 owner 的寬限鐘。
//   - 寬限鐘「首次發現才起算」：見 migrations/010_omsv_offboard_grace.sql 檔頭，config.json 不記錄
//     「何時被停用」，本模組只能觀察到「當下是不是停用」，保守做法是鐘從 sweep 第一次觀察到停用
//     的那一刻起算——只會比真實停用時刻晚（讓資料多留一些），不會比真實停用時刻早（提前刪資料）。
//   - 與 credPersist（v235「記住密碼」）的關係：密碼是活體登入憑證，一旦發現使用者已停用即無
//     繼續保留的正當理由，故 saved_creds 是「發現停用當下立即清除」，不比照 90 天寬限——這與
//     封存信件（保留給使用者事後自行歸檔/救回的緩衝期）的取捨基礎不同，是刻意的差異化設計，
//     不是遺漏。
//   - 為何用 in-process setInterval（本專案目前唯一的排程器）：見 server/src/index.js 的啟動
//     區塊註解——只在 require.main===module（直接執行 node index.js）時啟動，require 進測試檔
//     不會觸發，避免每次跑測試都意外啟動背景計時器。
'use strict';

const vdrive = require('../storage/vdrive');
const audit = require('../audit');
const credStore = require('./credStore');

// ── 純函式核心：只吃已解析好的 users 表，方便單元測試，不碰 vdrive/config ──
//
// 回傳：
//   { skipped: true, reason }                                                  ← 護欄擋下，什麼都沒做
//   { skipped: false, credsRemoved, graceStarted, purged, reactivated }        ← 正常執行完的摘要
function sweepWithUsers(db, users, graceDays, nowMs = Date.now()) {
  if (!users || typeof users !== 'object' || Array.isArray(users)) {
    return { skipped: true, reason: 'users_unavailable_or_empty' };
  }
  const hasAnyActiveUser = Object.values(users).some((u) => u && u.disabled !== true);
  if (!hasAnyActiveUser) {
    return { skipped: true, reason: 'users_unavailable_or_empty' };
  }

  // distinct owner_email：四表聯集（寬限表也要掃，才能處理「封存已空但寬限鐘還在」與「重新啟用
  // 歸零」這兩種情況——這兩種情況下 owner 可能已經不在 archive/creds 兩表裡了）。
  const owners = new Set();
  for (const row of db.prepare('SELECT DISTINCT owner_email FROM openmail_archive_folders').all()) owners.add(row.owner_email);
  for (const row of db.prepare('SELECT DISTINCT owner_email FROM openmail_archive_messages').all()) owners.add(row.owner_email);
  for (const row of db.prepare('SELECT DISTINCT owner_email FROM openmail_saved_creds').all()) owners.add(row.owner_email);
  for (const row of db.prepare('SELECT owner_email FROM openmail_offboard_grace').all()) owners.add(row.owner_email);

  const credsRemoved = [];
  const graceStarted = [];
  const purged = [];
  const reactivated = [];

  const graceMs = graceDays * 24 * 3600 * 1000;
  const nowIso = new Date(nowMs).toISOString();

  const purgeOwnerTx = db.transaction((owner) => {
    const folderIds = db.prepare('SELECT id FROM openmail_archive_folders WHERE owner_email = ?').all(owner).map((r) => r.id);
    let messages = 0;
    if (folderIds.length) {
      const placeholders = folderIds.map(() => '?').join(',');
      messages = db.prepare(`DELETE FROM openmail_archive_messages WHERE folder_id IN (${placeholders})`).run(...folderIds).changes;
    }
    const folders = db.prepare('DELETE FROM openmail_archive_folders WHERE owner_email = ?').run(owner).changes;
    db.prepare('DELETE FROM openmail_offboard_grace WHERE owner_email = ?').run(owner);
    return { folders, messages };
  });

  for (const owner of owners) {
    const active = !!users[owner] && users[owner].disabled !== true;

    if (active) {
      const graceRow = db.prepare('SELECT 1 FROM openmail_offboard_grace WHERE owner_email = ?').get(owner);
      if (graceRow) {
        db.prepare('DELETE FROM openmail_offboard_grace WHERE owner_email = ?').run(owner);
        reactivated.push(owner);
      }
      continue; // active 使用者：封存/creds 一律不動
    }

    // 停用（含帳號整個從 users 移除的情況，同樣視為停用）。
    const credRow = db.prepare('SELECT 1 FROM openmail_saved_creds WHERE owner_email = ?').get(owner);
    if (credRow) {
      db.prepare('DELETE FROM openmail_saved_creds WHERE owner_email = ?').run(owner);
      credStore.clear(owner);
      credsRemoved.push(owner);
    }

    const graceRow = db.prepare('SELECT owner_email, first_seen_disabled_at FROM openmail_offboard_grace WHERE owner_email = ?').get(owner);
    if (!graceRow) {
      db.prepare('INSERT INTO openmail_offboard_grace (owner_email, first_seen_disabled_at) VALUES (?, ?)').run(owner, nowIso);
      graceStarted.push(owner);
      continue;
    }

    const firstSeenMs = Date.parse(graceRow.first_seen_disabled_at);
    if (Number.isFinite(firstSeenMs) && nowMs - firstSeenMs >= graceMs) {
      const { folders, messages } = purgeOwnerTx(owner);
      purged.push({ owner, folders, messages });
    }
    // 未滿寬限：不動。
  }

  return { skipped: false, credsRemoved, graceStarted, purged, reactivated };
}

// ── 外層：讀 config.users，套用 sweepWithUsers，逐類結果寫 audit ──
function runSweep(db, config) {
  try {
    const ctx = { root: config.ROOT_FOLDER_ID };
    let users = null;
    try {
      const { data } = vdrive.readJson(db, 'config.json', ctx);
      users = (data && data.users) || null;
    } catch (_e) {
      users = null;
    }

    const result = sweepWithUsers(db, users, config.OMSV_OFFBOARD_GRACE_DAYS);

    // skipped：不寫 audit（每 12 小時跑一次，users 讀取失敗時避免持續 spam 稽核紀錄；真正的
    // config 讀取失敗會有其他管道可觀察，不靠本排程的稽核紀錄發現）。
    if (result.skipped) return result;

    for (const owner of result.credsRemoved) {
      audit.appendAuditLog(db, { email: 'system:offboard', action: 'omsvOffboardCredRemove', target: owner, outcome: 'ok' });
    }
    for (const owner of result.graceStarted) {
      audit.appendAuditLog(db, { email: 'system:offboard', action: 'omsvOffboardGraceStart', target: owner, outcome: 'ok', detail: `graceDays=${config.OMSV_OFFBOARD_GRACE_DAYS}` });
    }
    for (const p of result.purged) {
      audit.appendAuditLog(db, { email: 'system:offboard', action: 'omsvOffboardPurge', target: p.owner, outcome: 'ok', detail: `folders=${p.folders},messages=${p.messages}` });
    }
    for (const owner of result.reactivated) {
      audit.appendAuditLog(db, { email: 'system:offboard', action: 'omsvOffboardGraceCancel', target: owner, outcome: 'ok' });
    }

    return result;
  } catch (err) {
    // 排程呼叫不能炸掉 process（setInterval 的 callback 若 throw 會變成未捕捉例外）。
    console.error('[offboardSweep] runSweep failed:', err && err.message);
    return { skipped: true, reason: 'error' };
  }
}

module.exports = { sweepWithUsers, runSweep };
