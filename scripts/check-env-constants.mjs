#!/usr/bin/env node
// 環境常數守門員：確認 index.html（正式版）與 dev/index.html（測試版）各自的
// DRIVE_FOLDER_ID 與 APPS_SCRIPT_URL 都是「對的那一組」。
//
// 為什麼需要它：promote 時用 Copy-Item dev→index.html 會把 dev 的兩個環境常數一起帶進正式版，
// 兩者必須成對改回 prod 值，缺一都會讓正式版完全無法登入。這兩個是 60+ 字元的字串，
// 人工比對曾漏改 APPS_SCRIPT_URL 造成正式版全面無法登入（事故：2026-07-03）。
// 期望值取自「當時正常運作的 index.html」ground truth，不靠人工轉抄。
//
// 用法：node scripts/check-env-constants.mjs      → 綠燈 exit 0；任何不符 exit 1
// 建議：每次 promote（Copy-Item 後、git push 前）必跑，綠燈才推。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 期望值（ground truth，來自正常運作的 index.html / dev/index.html）
const EXPECT = {
  prod: {
    file: 'index.html',
    DRIVE_FOLDER_ID: '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycby9ZDT7NO7Jso3mbzbMaOzN0mdfgREbxoHRLC3NEbulGtKwp9eTibpD0XwKJCeC9wlh/exec',
    CLOCK_PAGE_URL: 'https://npustscc.github.io/scc-clock/',
  },
  dev: {
    file: 'dev/index.html',
    DRIVE_FOLDER_ID: '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwQjkuKkKn33XlMCNtt-Al3x1jkkxk1fdawb64lozIZ6rwSeGZUGhQ1gujXN8k9hPlDlw/exec',
    CLOCK_PAGE_URL: 'https://npustscc.github.io/scc-clock/dev/',
  },
};

// v192 起才有的常數：檔案裡沒有時「略過」不算失敗（prod 在 v192 promote 前沒有此常數；
// 一旦存在——promote 會把 dev 值帶進來——就必須是對的那組）
const OPTIONAL_IF_ABSENT = new Set(['CLOCK_PAGE_URL']);

function readConst(html, name) {
  const m = html.match(new RegExp('^const ' + name + " = '([^']*)'", 'm'));
  return m ? m[1] : null;
}

let failed = false;
for (const [env, spec] of Object.entries(EXPECT)) {
  let html;
  try {
    html = readFileSync(join(root, spec.file), 'utf8');
  } catch (e) {
    console.error(`✗ [${env}] 讀不到 ${spec.file}: ${e.message}`);
    failed = true;
    continue;
  }
  for (const key of ['DRIVE_FOLDER_ID', 'APPS_SCRIPT_URL', 'CLOCK_PAGE_URL']) {
    const actual = readConst(html, key);
    if (actual === null && OPTIONAL_IF_ABSENT.has(key)) {
      console.log(`- [${env}] ${spec.file} ${key}（尚無此常數，略過）`);
      continue;
    }
    if (actual === spec[key]) {
      console.log(`✓ [${env}] ${spec.file} ${key}`);
    } else {
      failed = true;
      console.error(`✗ [${env}] ${spec.file} ${key}`);
      console.error(`    期望：${spec[key]}`);
      console.error(`    實際：${actual === null ? '(找不到此常數)' : actual}`);
    }
  }
}

if (failed) {
  console.error('\n環境常數不符 —— 請勿 push。promote 後常見原因：Copy-Item 把 dev 的常數帶進正式版，忘了改回 prod 值。');
  process.exit(1);
}
console.log('\n環境常數全部正確 ✅');
