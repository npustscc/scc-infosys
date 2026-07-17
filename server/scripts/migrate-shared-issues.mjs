#!/usr/bin/env node
// server/scripts/migrate-shared-issues.mjs — issues.json dev/prod 共用遷移腳本（v198）。
//
// 背景：見 server/src/storage/sharedIssuesDb.js 檔頭。本腳本把 prod 主庫與 dev 主庫各自的
// issues.json 合併寫入 SHARED_ISSUES_DB 指向的共用庫，供切換 .env（設定 SHARED_ISSUES_DB 後
// 重啟兩個 Node 實例）之後兩邊立即看到彼此既有的問題回報／許願池。
//
// 用法：
//   node scripts/migrate-shared-issues.mjs --prod <prod.sqlite> --dev <dev.sqlite> --shared <shared.sqlite> [--dry-run]
//
// 合併規則（以 id 為鍵）：
//   1. 以 shared 現有內容為底（idempotent 可重跑：第二次跑不會把已經合併過的資料弄丟）。
//   2. 疊上 prod 目前的 issues.json（id 已存在則視為潛在衝突，見下）。
//   3. 疊上 dev 目前的 issues.json（同上）。
//   衝突判定：同一 id 但內容不同（JSON 深度不同）→ 印出衝突、以 updatedAt 較新者為準；
//   updatedAt 缺失或相同時改比 statusHistory 陣列長度（較長＝互動較多，視為較新）。
//   （重跑且內容完全相同 → 不算衝突、不印訊息，這正是 idempotent 的關鍵：prod/dev promote
//   後再跑一次本腳本做「增量收斂」，不會洗版印一堆已經處理過的舊衝突。）
//
// dry-run：prod／dev／shared 三邊皆以唯讀方式讀取（shared 若尚未建立檔案，視為空），只印出
// 合併結果與衝突清單，不對任何檔案做任何寫入（不含 schema/migrations 初始化——見下方
// readIssuesReadonly，刻意不呼叫 openDb，避免連「跑 migrations」這種輕量寫入都算進 dry-run）。
'use strict';

import fs from 'node:fs';
import Database from 'better-sqlite3';
import vdrive from '../src/storage/vdrive.js';
import sharedIssuesDb from '../src/storage/sharedIssuesDb.js';

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--prod') { out.prod = argv[++i]; continue; }
    if (a === '--dev') { out.dev = argv[++i]; continue; }
    if (a === '--shared') { out.shared = argv[++i]; continue; }
  }
  return out;
}

// 唯讀讀取一個 sqlite 檔裡的 issues.json（若檔案不存在，或裡面根本沒有這個檔案，回傳空陣列）。
// 刻意不透過 vdrive.resolvePathToId（需要知道 ctx.root 字面值）——直接以 name='issues.json' 查
// files 表即可：每個 db 檔案本就只有單一 root，name 相同的未 trash 檔案裡取 updated_at 最新一筆，
// 語意等同 resolvePathToId 但不需呼叫端先知道該 db 的 root id 是什麼。
function readIssuesReadonly(dbPath, label) {
  if (!dbPath) return [];
  if (!fs.existsSync(dbPath)) {
    console.log(`（${label}）檔案不存在（${dbPath}），視為空清單`);
    return [];
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      `SELECT content FROM files WHERE name = 'issues.json' AND trashed = 0
       ORDER BY updated_at DESC LIMIT 1`
    ).get();
    if (!row || row.content == null) return [];
    const parsed = JSON.parse(row.content);
    return Array.isArray(parsed.issues) ? parsed.issues : [];
  } finally {
    db.close();
  }
}

function pickNewer(existing, incoming) {
  const eTime = existing && existing.updatedAt;
  const iTime = incoming && incoming.updatedAt;
  if (eTime && iTime && eTime !== iTime) return eTime > iTime ? existing : incoming;
  const eLen = (existing && Array.isArray(existing.statusHistory)) ? existing.statusHistory.length : 0;
  const iLen = (incoming && Array.isArray(incoming.statusHistory)) ? incoming.statusHistory.length : 0;
  return iLen >= eLen ? incoming : existing;
}

// 依序疊 layers（[{label, issues}, ...]），回傳 { merged, conflicts }。
function mergeLayers(layers) {
  const byId = new Map();
  const order = [];
  const conflicts = [];

  for (const { label, issues } of layers) {
    for (const item of issues) {
      if (!item || !item.id) continue;
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
        order.push(item.id);
        continue;
      }
      const existing = byId.get(item.id);
      if (JSON.stringify(existing) === JSON.stringify(item)) continue; // 重跑時的正常情形，非衝突
      const winner = pickNewer(existing, item);
      conflicts.push({
        id: item.id, incomingFrom: label,
        existingUpdatedAt: existing.updatedAt || null, incomingUpdatedAt: item.updatedAt || null,
        kept: winner === item ? label : '既有（shared 或先前 layer）',
      });
      byId.set(item.id, winner);
    }
  }
  return { merged: order.map((id) => byId.get(id)), conflicts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prod || !args.dev || !args.shared) {
    console.error('用法：node scripts/migrate-shared-issues.mjs --prod <prod.sqlite> --dev <dev.sqlite> --shared <shared.sqlite> [--dry-run]');
    process.exit(1);
  }

  console.log(`== issues.json 共用遷移${args.dryRun ? '（dry-run，不寫入）' : ''} ==`);
  console.log(`prod:   ${args.prod}`);
  console.log(`dev:    ${args.dev}`);
  console.log(`shared: ${args.shared}`);

  const sharedBaseline = readIssuesReadonly(args.shared, 'shared');
  const prodIssues = readIssuesReadonly(args.prod, 'prod');
  const devIssues = readIssuesReadonly(args.dev, 'dev');

  console.log(`\n讀取筆數：shared=${sharedBaseline.length}　prod=${prodIssues.length}　dev=${devIssues.length}`);

  const { merged, conflicts } = mergeLayers([
    { label: 'shared', issues: sharedBaseline },
    { label: 'prod', issues: prodIssues },
    { label: 'dev', issues: devIssues },
  ]);

  if (conflicts.length) {
    console.log(`\n衝突（同 id 內容不同，以較新者為準，共 ${conflicts.length} 筆）：`);
    for (const c of conflicts) {
      console.log(`  id=${c.id}　來自=${c.incomingFrom}　既有 updatedAt=${c.existingUpdatedAt}　新進 updatedAt=${c.incomingUpdatedAt}　採用=${c.kept}`);
    }
  } else {
    console.log('\n無衝突。');
  }

  console.log(`\n合併後總筆數：${merged.length}（新增 ${merged.length - sharedBaseline.length} 筆相對於 shared 現有內容）`);

  if (args.dryRun) {
    console.log('\n== dry-run：以上為合併計畫，未寫入任何檔案 ==');
    return;
  }

  // 真正寫入：沿用 sharedIssuesDb／vdrive 既有程式碼路徑（與正式程式讀寫共用庫的方式完全一致）。
  // vdrive.updateJson 找不到既有檔時本就會自動於 ctx.root 下新建（見 vdrive.js updateJson_ 對映
  // 註解），不需自己再包一層 try/create 後備。本腳本情境下是單一寫入者（遷移期間不會有使用者
  // 同時透過 API 寫 issues.json），故直接整檔寫入即可，不需要 listCommit 的併發 upsert/remove 語意。
  const db = sharedIssuesDb.getSharedIssuesDb(args.shared);
  const content = { issues: merged };
  vdrive.updateJson(db, 'issues.json', content, sharedIssuesDb.SHARED_CTX);
  console.log(`\n== 已寫入共用庫：${args.shared}（issues.json 共 ${merged.length} 筆）==`);
}

main().catch((e) => { console.error('遷移失敗：' + (e && e.stack || e)); process.exit(1); });
