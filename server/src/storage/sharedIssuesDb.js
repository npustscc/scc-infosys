// server/src/storage/sharedIssuesDb.js — issues.json dev/prod 共用 sqlite 路由（v198）。
//
// 背景：GAS 時代 issues.json 是 dev/prod 共用一份（固定 ISSUES_FOLDER_ID，見 dev/Code.gs 與
// dev/index.html 的 ISSUES_FOLDER_ID 常數）；cutover 到 Node＋sqlite 時 Node 版採單一 root 骨架，
// 沒有 GAS 版「跨環境固定資料夾 id」的機制，issues.json 因而退化成各環境獨立一份（見
// actions/storage.js startupBatch 檔頭曾經的「與計畫的偏差」註解）。本模組恢復共用：不靠
// rootFolderId／資料夾 id 路由（Node 版單一 root，資料夾 id 早已不是真實 Drive 資源），改用
// 「另開一個獨立 sqlite 檔」的方式——dev/prod 兩個 Node 實例的 .env 都指到同一個
// SHARED_ISSUES_DB 路徑，即可讀寫同一份 issues.json。
//
// 安全邊界（務必維持）：本模組只給 issues.json 這一個檔案使用。共用庫用主庫同一套
// schema/migrations 初始化（見 db.js runMigrations），因此技術上「有能力」長出 cases/config 等表，
// 但呼叫端（dispatch.js）刻意只在 action 目標檔名精確等於 'issues.json' 時才會把 db handle 換成
// 這裡回傳的共用庫——個案等機敏資料永遠不會被路由進來。若未來要讓其他檔案也走共用庫，
// 必須在這裡與 dispatch.js 的路由白名單同步擴充、並重新評估資安影響，不可只加檔名字串了事。
'use strict';

const { openDb } = require('../db');

// 共用庫內部的虛擬根目錄 id（vdrive 的 root 本就是「虛擬」概念——不需要 files 表裡真的有一列
// 才能當 parent_id 使用，見 vdrive.isUnderRoot 的檔頭註解）。這裡刻意不沿用 GAS 時代遺留的
// ISSUES_FOLDER_ID 字面值，避免讓人誤以為它仍對應某個真實 Drive 資料夾 id——它現在純粹是
// 「共用庫自己的頂層錨點」，只要 dev/prod 兩邊读寫時一致即可，寫死常數即可滿足。
const SHARED_ISSUES_ROOT = 'shared-issues-root';
const SHARED_CTX = Object.freeze({ root: SHARED_ISSUES_ROOT });

// dbPath → 已開啟的 db handle 快取。同一個路徑在同一個 process 生命週期內只 open 一次並重用
// （比照 src/index.js 對主庫的作法：openDb 一次、掛在 module scope）。better-sqlite3 於 WAL
// 模式下天生支援跨行程併發讀寫，同行程內沒有理由對同一檔案重複 open。
const cache = new Map();

function getSharedIssuesDb(dbPath) {
  if (!dbPath) return null;
  let db = cache.get(dbPath);
  if (!db) {
    // 重用主庫同一套 schema/migrations（見 db.js）——共用庫因此也會長出 sessions/config 等
    // 用不到的表，這些是「多出的空表」，無害；好處是不必為共用庫另開一套 migrations 維護。
    db = openDb(dbPath);
    cache.set(dbPath, db);
  }
  return db;
}

// 測試專用：關閉並清空快取。測試檔常對同一個暫存路徑重覆驗證 open/close 語意，若不清快取
// 會撈到前一個測試留下的舊 handle。正式程式路徑（config.js 讀出的路徑固定不變）不需要呼叫。
function _resetCacheForTest() {
  for (const db of cache.values()) {
    try { db.close(); } catch (_e) { /* 已關閉或連線失效 */ }
  }
  cache.clear();
}

module.exports = { SHARED_ISSUES_ROOT, SHARED_CTX, getSharedIssuesDb, _resetCacheForTest };
