// 拆檔防護網（v249~ 絞殺者拆檔系列的自動安檢）：
// 1. BOM 檢查——dev/index.html 檔首必須是「恰好一個」UTF-8 BOM（v251 曾意外變雙 BOM，
//    第二個 BOM 會成為 DOCTYPE 前的內容字元，可能把瀏覽器打進 quirks mode）；拆出的
//    dev/*.js 則一律不得帶 BOM。
// 2. 跨檔頂層宣告碰撞——所有 <script src> 拆出檔與 index.html 內嵌 script 同屬全域 scope，
//    同名 let/const 重複宣告會讓後載入的整個 script 直接 SyntaxError（頁面白屏）。拆檔搬移
//    若不慎留下副本（或兩刀各搬走一份），測試在 commit 前就要攔下來。
// 3. 拆出檔存在性——index.html 引用的每個 <script src> 檔案必須真的存在於 dev/。
//
// 掃描法為行首（column-0）regex 啟發式：本專案頂層宣告一律頂格書寫（見各拆刀的 column-0
// 複核慣例），函式體內縮排宣告不會被誤掃；template literal 內若出現頂格的宣告字樣會誤判，
// 屆時把該行加進 KNOWN_FALSE_POSITIVES 即可。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DEV_DIR = path.join(__dirname, '..', 'dev');
const INDEX_PATH = path.join(DEV_DIR, 'index.html');

// 已知誤判白名單：'檔名:宣告名'（目前無）
const KNOWN_FALSE_POSITIVES = new Set([]);

function readBuf(p) { return fs.readFileSync(p); }

function listScriptSrcFiles(html) {
  const out = [];
  const re = /<script\s+src="([^"]+\.js)"><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/^https?:\/\//.test(m[1])) continue; // 外部 CDN（如 leaflet）不在拆檔安檢範圍
    out.push(m[1]);
  }
  return out;
}

// 從一段 JS 原始碼掃出頂格（column-0）宣告：let / const / var / function / async function / class
function topLevelDecls(src, label) {
  const decls = [];
  const re = /^(let|const|var|async function|function|class)\s+([A-Za-z_$][\w$]*)/;
  for (const line of src.split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    if (KNOWN_FALSE_POSITIVES.has(`${label}:${m[2]}`)) continue;
    decls.push({ kind: m[1], name: m[2], file: label });
  }
  return decls;
}

// 抽出 index.html 所有內嵌（無 src）script 區塊內容
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) { if (m[1].trim()) out.push(m[1]); }
  return out;
}

const indexBuf = readBuf(INDEX_PATH);
const indexHtml = indexBuf.toString('utf8');
const srcFiles = listScriptSrcFiles(indexHtml);

test('index.html 檔首恰好一個 BOM', () => {
  const b = indexBuf;
  assert.ok(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF, '檔首必須有 UTF-8 BOM');
  assert.ok(!(b[3] === 0xEF && b[4] === 0xBB && b[5] === 0xBF), '檔首出現雙重 BOM（v251 事故重演），請移除多餘的一個');
});

test('拆出的 .js 檔不得帶 BOM 且必須存在', () => {
  assert.ok(srcFiles.length >= 3, `index.html 應引用多個拆出檔，實際只掃到 ${srcFiles.length} 個（regex 可能失效）`);
  for (const f of srcFiles) {
    const p = path.join(DEV_DIR, f);
    assert.ok(fs.existsSync(p), `index.html 引用的 ${f} 不存在於 dev/`);
    const b = readBuf(p);
    assert.ok(!(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF), `${f} 帶有 BOM（拆出檔慣例為無 BOM）`);
  }
});

test('跨檔頂層宣告無碰撞（let/const 重複＝載入期 SyntaxError）', () => {
  const all = [];
  for (const f of srcFiles) {
    all.push(...topLevelDecls(fs.readFileSync(path.join(DEV_DIR, f), 'utf8'), f));
  }
  inlineScripts(indexHtml).forEach((s, i) => all.push(...topLevelDecls(s, `index.html#inline${i}`)));

  const byName = new Map();
  for (const d of all) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }
  const fatal = [];
  const dupFn = [];
  for (const [name, ds] of byName) {
    if (ds.length < 2) continue;
    // let/const/class 涉入的重複＝致命；純 function/var 重複＝後者靜默覆蓋前者，也視為拆檔事故
    if (ds.some(d => d.kind === 'let' || d.kind === 'const' || d.kind === 'class')) {
      fatal.push(`${name}：${ds.map(d => `${d.file}(${d.kind})`).join(' vs ')}`);
    } else {
      dupFn.push(`${name}：${ds.map(d => d.file).join(' vs ')}`);
    }
  }
  assert.deepStrictEqual(fatal, [], `頂層 let/const/class 跨檔重複宣告（會白屏）：\n${fatal.join('\n')}`);
  assert.deepStrictEqual(dupFn, [], `頂層 function/var 跨檔重複（靜默覆蓋，多半是拆檔留了副本）：\n${dupFn.join('\n')}`);
});
