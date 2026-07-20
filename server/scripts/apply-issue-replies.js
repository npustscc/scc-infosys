#!/usr/bin/env node
// server/scripts/apply-issue-replies.js — 把 pending-issue-replies.json 佇列直接套用進 issues.json
// （以 npust.scc 身份留言/改狀態），不再等系統管理者登入前端才貼出。
//
// 背景：前端 _checkAutoIssueReplies（dev/index.html）在系統管理者登入時讀取佇列並套用；cutover 到
// 區網 server 後，管理者登入頻率下降，回覆會卡在佇列裡。本腳本讓 Claude 於 push 佇列後直接在
// 伺服器上套用（ssh 執行），與前端邏輯共用同一套 dedup 鍵（comments[].autoReplyId、
// statusHistory[].queueId），先跑腳本、之後管理者登入時前端會自動略過已套用的項目，不會重複。
//
// 套用內容（對映前端 _checkAutoIssueReplies）：
//   q.text     → issue.comments push（authorEmail=npust.scc，autoReplyId=q.id 防重複）
//   q.statusTo → issue.status＋statusHistory push（queueId=q.id 防重複）
//   statusTo==='pending_verification' 時 → 比照前端 _onIssuePendingVerification 對回報者推鈴鐺通知
//   （notifCommit 寫本實例主庫 notifications.json——通知只會落在「執行本腳本的實例」的使用者上，
//    回報者都在 prod，故正式使用時應在 ~/scc-prod/server 執行；前端的「待您驗證」待辦卡片
//    無法在此補（存於各使用者 todos 檔），回報者仍會收到鈴鐺通知＋回報頁的待驗證狀態）。
//
// 用法：
//   node scripts/apply-issue-replies.js [--dry-run] [--queue /path/to/pending-issue-replies.json]
//   預設佇列路徑＝本 checkout 的 repo 根（../pending-issue-replies.json）。prod checkout 若尚未
//   pull 到最新佇列，可用 --queue 指向 dev checkout 的檔案（issues 庫是 dev/prod 共用的
//   SHARED_ISSUES_DB，從哪個實例目錄執行都寫同一份 issues.json；差別只在通知落在哪個主庫）。
//
// exit code：0＝正常（含「無新項目可套用」）；非零＝佇列檔讀取失敗/DB 錯誤。
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');
const sharedIssuesDb = require('../src/storage/sharedIssuesDb');
const commitActions = require('../src/actions/commit');

const AUTO_EMAIL = 'npust.scc@heartnpust.tw'; // 與前端 AUTO_ISSUE_REPLY_EMAIL 一致

function nowIso() { return new Date().toISOString(); }

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const qIdx = process.argv.indexOf('--queue');
  const queuePath = qIdx >= 0 && process.argv[qIdx + 1]
    ? path.resolve(process.argv[qIdx + 1])
    : path.join(__dirname, '..', '..', 'pending-issue-replies.json');

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (e) {
    console.error(`[apply-issue-replies] 佇列檔讀取失敗：${queuePath}（${e.message}）`);
    process.exit(1);
    return;
  }
  if (!Array.isArray(queue) || !queue.length) {
    console.log('[apply-issue-replies] 佇列為空，無事可做');
    return;
  }

  const mainDb = openDb(config.DB_PATH);
  const mainCtx = { root: config.ROOT_FOLDER_ID };
  const useShared = !!config.SHARED_ISSUES_DB;
  const issuesDb = useShared ? sharedIssuesDb.getSharedIssuesDb(config.SHARED_ISSUES_DB) : mainDb;
  const issuesCtx = useShared ? sharedIssuesDb.SHARED_CTX : mainCtx;

  let loaded;
  try {
    loaded = vdrive.readJson(issuesDb, 'issues.json', issuesCtx);
  } catch (e) {
    console.error(`[apply-issue-replies] issues.json 讀取失敗：${e.message}`);
    process.exit(1);
    return;
  }
  const data = loaded.data || {};
  const issues = Array.isArray(data.issues) ? data.issues : [];

  // 留言者顯示名稱：主庫 config.json users[npust.scc].name（讀不到時退回固定字串，比照前端）
  let authorName = '系統管理者';
  try {
    const cfg = vdrive.readJson(mainDb, 'config.json', mainCtx).data;
    if (cfg && cfg.users && cfg.users[AUTO_EMAIL] && cfg.users[AUTO_EMAIL].name) authorName = cfg.users[AUTO_EMAIL].name;
  } catch (_e) { /* 名稱非關鍵，退回預設 */ }

  let appliedComments = 0, appliedStatus = 0, skipped = 0;
  const notifOps = [];

  for (const q of queue) {
    if (!q || !q.id || !q.issueSerial || (!q.text && !q.statusTo)) { skipped++; continue; }
    const issue = issues.find((x) => x && x.serial === q.issueSerial);
    if (!issue) { skipped++; continue; }

    if (q.text) {
      if (!Array.isArray(issue.comments)) issue.comments = [];
      if (!issue.comments.some((c) => c && c.autoReplyId === q.id)) {
        appliedComments++;
        console.log(`  + #${String(q.issueSerial).padStart(3, '0')} 留言（${q.id}）`);
        if (!dryRun) {
          issue.comments.push({
            id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            content: q.text,
            attachments: [],
            authorEmail: AUTO_EMAIL,
            authorName,
            createdAt: nowIso(),
            autoReplyId: q.id,
          });
        }
      }
    }

    if (q.statusTo && issue.status !== q.statusTo) {
      if (!Array.isArray(issue.statusHistory)) issue.statusHistory = [];
      if (!issue.statusHistory.some((h) => h && h.queueId === q.id)) {
        appliedStatus++;
        console.log(`  + #${String(q.issueSerial).padStart(3, '0')} 狀態 ${issue.status} → ${q.statusTo}（${q.id}）`);
        if (!dryRun) {
          const prev = issue.status;
          issue.status = q.statusTo;
          issue.statusHistory.push({ from: prev, to: q.statusTo, by: AUTO_EMAIL, byName: authorName, at: nowIso(), queueId: q.id });
          if (q.statusTo === 'pending_verification' && issue.submittedBy && issue.submittedBy !== AUTO_EMAIL) {
            const serialStr = `#${String(issue.serial).padStart(3, '0')}`;
            notifOps.push({
              op: 'push',
              email: issue.submittedBy,
              notif: {
                id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                type: 'issue_pending_verification',
                caseId: issue.id,
                caseName: serialStr,
                message: `您回報的 ${serialStr} 已改為「待驗證」，請至錯誤回報/許願池頁面確認是否已解決`,
                createdAt: nowIso(),
                read: false,
              },
            });
          }
        }
      }
    }
  }

  if (dryRun) {
    console.log(`[apply-issue-replies] dry-run：將套用留言 ${appliedComments} 則、狀態變更 ${appliedStatus} 筆（略過 ${skipped}）`);
    return;
  }
  if (!appliedComments && !appliedStatus) {
    console.log('[apply-issue-replies] 佇列項目皆已套用過（或無對應回報），無新寫入');
    return;
  }

  vdrive.updateJson(issuesDb, 'issues.json', { ...data, issues }, issuesCtx);
  console.log(`[apply-issue-replies] 已寫入 issues.json：留言 ${appliedComments} 則、狀態變更 ${appliedStatus} 筆`);

  if (notifOps.length) {
    try {
      commitActions.notifCommit(mainDb, { ops: notifOps }, mainCtx);
      console.log(`[apply-issue-replies] 已推送鈴鐺通知 ${notifOps.length} 則（本實例主庫）`);
    } catch (e) {
      console.warn(`[apply-issue-replies] 鈴鐺通知寫入失敗（不影響留言/狀態已套用）：${e.message}`);
    }
  }
}

main();
