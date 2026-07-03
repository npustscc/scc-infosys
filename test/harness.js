// 測試載入器：從 dev/index.html 就地抽出指定的純函式，在隔離的 vm context 中執行。
// 完全不修改 index.html —— 測試檔讀的是同一份正式碼，改壞邏輯測試就會紅燈。
//
// 用法：
//   const { load } = require('./harness');
//   const S = load(['openDateToSemPrefix', 'semesterLabel'], { casesData: [] });
//   S.openDateToSemPrefix('2026-06-15');  // 呼叫抽出的函式
//
// 限制：以「跳過字串/註解的括號配對」抽出函式主體，適用本專案這類無 DOM 依賴的純函式；
// 若函式字串字面量內含不成對的大括號（本專案目前沒有），需改用更完整的解析器。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, '..', 'dev', 'index.html');

function readHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

// 從 src 中，以 openBraceIdx（指向 '{'）為起點，做「字串/註解感知」的括號配對，回傳結束 '}' 的索引。
function matchBrace(src, openBraceIdx) {
  let depth = 0;
  let i = openBraceIdx;
  let str = null;      // 目前所在的字串引號字元（' " `），null = 不在字串內
  let lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (str) {
      if (c === '\\') { i++; continue; }         // 跳過跳脫字元
      if (c === str) str = null;                 // 字串結束（含反引號整段跳過，含其 ${} 內大括號）
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('matchBrace: 找不到對應的結束大括號');
}

// 抽出名為 name 的頂層函式宣告原始碼字串。
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函式：' + name);
  const braceIdx = src.indexOf('{', m.index);
  if (braceIdx === -1) throw new Error('函式無主體：' + name);
  const endIdx = matchBrace(src, braceIdx);
  return src.slice(m.index, endIdx + 1);
}

// 載入一組函式到共用 sandbox。extraGlobals 提供被依賴的全域（常數、資料、被 stub 的 helper 等）。
// 回傳 sandbox 物件：抽出的函式與 extraGlobals 都掛在上面，測試中可讀寫（例如覆寫 casesData）。
function load(names, extraGlobals = {}) {
  const src = readHtml();
  const sandbox = Object.assign({
    Date, Math, Number, String, Boolean, parseInt, parseFloat, isNaN,
    RegExp, Array, Object, JSON, Set, Map, console,
  }, extraGlobals);
  vm.createContext(sandbox);
  const code = names.map((n) => extractFunction(src, n)).join('\n\n');
  vm.runInContext(code, sandbox);
  return sandbox;
}

// 產生「無參數 new Date() 固定為 isoOrMs」的 Date 子類，供測試日期相依函式（如 currentSemesterPrefix）。
function makeFixedDate(fixed) {
  const RealDate = Date;
  const FixedDate = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return new RealDate(fixed).getTime(); }
  };
  return FixedDate;
}

module.exports = { load, extractFunction, matchBrace, makeFixedDate, HTML_PATH };
