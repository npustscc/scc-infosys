#!/usr/bin/env node
// scripts/deidentify-dev.mjs — 把 dev 環境的心理諮商個案資料去識別化，供展演使用。
//
// 讀取來源：drive-export-deid-backup/（manifest.jsonl + content/<fileId> 原始備份，已 gitignore）。
// 用法：
//   node scripts/deidentify-dev.mjs --transform   讀備份、產生 deid-out/（不寫回 Drive）
//   node scripts/deidentify-dev.mjs --apply       把 deid-out/ 的變動檔上傳、trash 清單執行 trash
//
// 零依賴：只用 Node 內建模組。任何輸出（stdout/report.json）只准出現統計數字與欄位名，
// 絕不可印出真實姓名/學號/身分證/電話/地址（見專案 CLAUDE.md 資安原則）。
//
// 設計要點：
// - 生日/地址只做「結構欄位」置換，絕不進全域替換器（共用日期字串會誤傷全系統日期欄位、
//   短地址字串會誤傷一般地名文字）。
// - 全域替換器與殘留掃描的純數字/英數 pattern 皆加邊界防護（lookaround）：
//   避免 10 碼電話誤中 13 碼毫秒 timestamp、誤中同仁帳號 email 內嵌的號碼
//   （如 pan09xxxxxxxx@gmail.com）、學號誤中 Drive fileId 等子字串。
// - trash 清單檔（migration-backup-* 與非 JSON 非資料夾檔案）不做內容轉換也不掃描——
//   --apply 會直接 trash（「套用後全集」不含它們）。
// - 假中文名不得「包含」任何 2 字真實姓名（避免掃描器把假名裡的子字串誤判為殘留）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.join(ROOT, 'drive-export-deid-backup');
const MANIFEST_PATH = path.join(BACKUP_DIR, 'manifest.jsonl');
const CONTENT_DIR = path.join(BACKUP_DIR, 'content');
const OUT_DIR = path.join(ROOT, 'deid-out');
const OUT_CONTENT_DIR = path.join(OUT_DIR, 'content');
const REPORT_PATH = path.join(OUT_DIR, 'report.json');
const MAPPING_PATH = path.join(ROOT, 'deid-mapping.json');
const CREDS_PATH = path.join(ROOT, 'creds.json');
const RW_TOKEN_PATH = path.join(ROOT, '.drive-token-rw.json');

// ── 確定性 PRNG（以字串 hash 做種子）───────────────────────────────────
function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(seedStr) { return mulberry32(fnv1a(String(seedStr))); }
function randInt(rng, maxExclusive) { return Math.floor(rng() * maxExclusive); }
function pick(rng, arr) { return arr[randInt(rng, arr.length)]; }

// ── 假資料用字池 ────────────────────────────────────────────────────
const COMPOUND_SURNAMES = ['歐陽', '張簡', '范姜', '司徒', '司馬', '周黃', '江謝', '鍾任', '劉張', '陳黃'];
const COMMON_SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪',
  '曾', '邱', '廖', '賴', '徐', '周', '葉', '蘇', '莊', '呂', '江', '何', '蕭', '羅', '高', '潘', '簡', '朱',
  '鍾', '彭', '游', '詹', '胡', '施', '沈', '余', '趙', '盧', '梁', '顏', '柯', '孫', '魏', '董'];
const GIVEN_NAME_CHARS = [...new Set([
  '明', '雅', '芳', '怡', '佳', '婷', '淑', '惠', '美', '麗', '靜', '雯', '萱', '涵', '穎', '潔', '珊', '妤', '晴',
  '欣', '宜', '姿', '君', '如', '娟', '芸', '慧', '琪', '瑄', '詩', '語', '昕', '妍', '恩', '萍', '芬', '雪', '梅',
  '蓉', '珍', '蘭', '鳳', '秀', '燕', '玉', '琴', '倩', '娜', '娥', '珮', '瑜', '志', '豪', '偉', '建', '國', '家',
  '宏', '俊', '傑', '勳', '凱', '翔', '昇', '承', '浩', '軒', '宇', '睿', '廷', '毅', '哲', '霖', '澤', '彥', '銘',
  '煒', '楷', '翊', '冠', '融', '安', '平', '德', '文', '華', '正', '忠', '信', '智', '勇', '東', '南', '杰', '嘉', '弘',
])];
const FAKE_LATIN_SURNAMES = ['Kessler', 'Meridian', 'Falkner', 'Bramwell', 'Sorrel', 'Thackeray', 'Halden',
  'Rivendale', 'Ashcombe', 'Wrenfield', 'Caldermoor', 'Brightwater', 'Fenwick', 'Harrow', 'Linden', 'Marrow',
  'Nordvale', 'Osprey', 'Pemberton', 'Quillan', 'Rosthwaite', 'Stonebridge', 'Thistledown', 'Underhill',
  'Vesper', 'Whitlock', 'Yarrow', 'Zephyrine', 'Corvin', 'Delacroix'];
const TOWNSHIPS = ['內埔鄉', '長治鄉', '麟洛鄉', '竹田鄉', '萬巒鄉', '潮州鎮', '屏東市', '萬丹鄉', '九如鄉', '里港鄉'];
const ROAD_NAMES = ['中山路', '中正路', '自由路', '和平路', '光復路', '建國路', '忠孝路', '復興路', '民族路',
  '勝利路', '光明路', '中華路', '公園路', '民生路', '信義路'];

const CLINICAL_PLACEHOLDER = '（示範資料）本欄位內容已以示範用假文取代。';
const SUMMARY_VARIANTS = [
  '（示範資料）本次晤談個案主動說明近期生活與課業適應狀況，情緒穩定，晤談歷程順暢，個案表達意願持續前來會談。',
  '（示範資料）本次晤談聚焦於人際互動與情緒調節議題，個案能覺察自身情緒起伏並嘗試以較適切方式因應，晤談氣氛良好。',
  '（示範資料）個案於晤談中分享近期壓力來源與因應方式，晤談過程配合度高，未見明顯風險徵兆。',
];
const ASSESSMENT_VARIANTS = [
  '（示範資料）評估個案目前情緒狀態穩定，因應資源尚可，暫無立即風險，建議持續追蹤。',
  '（示範資料）綜合晤談內容評估，個案適應功能尚可，人際與情緒調節能力逐步提升，未見自傷或傷人意念。',
  '（示範資料）個案整體狀態穩定，壓力來源可辨識且已有初步因應策略，建議維持目前晤談頻率觀察。',
];
const NEXTPLAN_VARIANTS = [
  '（示範資料）後續計畫持續每兩週安排一次晤談，追蹤情緒與課業適應狀況。',
  '（示範資料）建議下次晤談聚焦人際議題，並視狀況轉介相關資源協助。',
  '（示範資料）後續持續觀察個案調適情形，必要時提供轉介或資源連結。',
];
const PASTRECORDS_VARIANTS = [
  '（示範資料）個案過去無其他諮商紀錄。',
  '（示範資料）個案過去曾接受校外資源協助，細節略。',
  '（示範資料）個案過去有相關晤談紀錄，內容已以示範資料取代。',
];
const ML_REASON_VARIANTS = [
  '身心調適需求（示範資料）',
  '情緒調適需求（示範資料）',
  '生活適應需求（示範資料）',
];
function pickVariant(seedStr, variants) { return variants[fnv1a(seedStr) % variants.length]; }

// ── 台灣身分證檢查碼（字母轉數字 A=10..Z=33，加權 1,9,8,7,6,5,4,3,2,1,1）──
const ID_LETTER_TABLE = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35,
  P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};
function idCheckDigit(letter, digits8) {
  const code = ID_LETTER_TABLE[letter];
  const n1 = Math.floor(code / 10), n2 = code % 10;
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  let sum = n1 * 1 + n2 * 9;
  for (let i = 0; i < 8; i++) sum += digits8[i] * weights[i];
  return (10 - (sum % 10)) % 10;
}

// ── 全域唯一集合（預先塞入所有真實值，杜絕假值與任何真實值撞名/撞號）────
const usedFullNames = new Set();
const usedStudentIds = new Set();
const usedIdNumbers = new Set();
const usedPhones = new Set();
const realShortNames = new Set(); // 2 字真實姓名——假名不得「包含」這些子字串

function hasCJK(s) { return /[㐀-鿿]/.test(s || ''); }
function isForeignName(name) { return !hasCJK(name); }

function containsRealShortName(candidate) {
  for (const n of realShortNames) if (candidate.includes(n)) return true;
  return false;
}

function genChineseGivenName(rng, len) {
  const chars = [];
  let guard = 0;
  while (chars.length < len && guard++ < 200) {
    const c = pick(rng, GIVEN_NAME_CHARS);
    if (!chars.includes(c)) chars.push(c);
  }
  while (chars.length < len) chars.push(pick(rng, GIVEN_NAME_CHARS));
  return chars.join('');
}

function genFakeChineseName(rng, realName) {
  const compound = COMPOUND_SURNAMES.find((cs) => realName.startsWith(cs));
  const surname = compound || realName.slice(0, 1) || pick(rng, COMMON_SURNAMES);
  const surnameLen = compound ? 2 : 1;
  const totalLen = realName.length;
  const givenLenOriginal = Math.max(0, totalLen - surnameLen);
  let targetGivenLen;
  if (totalLen <= 2) targetGivenLen = 2;                                   // 單名(全名2字) → 自然變3字
  else if (totalLen === 3) targetGivenLen = Math.max(1, givenLenOriginal); // 3字維持3字
  else targetGivenLen = 2;                                                 // 4字以上取姓+2字
  let candidate, attempts = 0;
  do {
    candidate = surname + genChineseGivenName(rng, targetGivenLen);
    attempts++;
  } while ((usedFullNames.has(candidate) || containsRealShortName(candidate)) && attempts < 800);
  usedFullNames.add(candidate);
  return candidate;
}

function genFakeForeignName(rng, realName) {
  const tokens = realName.trim().split(/\s+/);
  const firstLetter = (tokens[0] || realName).charAt(0).toUpperCase() || 'X';
  let candidate, attempts = 0;
  do {
    const surn = pick(rng, FAKE_LATIN_SURNAMES);
    candidate = firstLetter + '. ' + surn + (attempts > 30 ? String(randInt(rng, 1000)) : '');
    attempts++;
  } while (usedFullNames.has(candidate) && attempts < 300);
  usedFullNames.add(candidate);
  return candidate;
}

function genFakeName(rng, realName) {
  if (!realName) return realName;
  return isForeignName(realName) ? genFakeForeignName(rng, realName) : genFakeChineseName(rng, realName);
}

function genFakeEmergencyName(rng) {
  let candidate, attempts = 0;
  do {
    candidate = pick(rng, COMMON_SURNAMES) + genChineseGivenName(rng, 2);
    attempts++;
  } while ((usedFullNames.has(candidate) || containsRealShortName(candidate)) && attempts < 800);
  usedFullNames.add(candidate);
  return candidate;
}

function genFakeStudentId(rng, real) {
  const len = real.length;
  const prefixLen = Math.max(0, len - 3);
  const prefix = real.slice(0, prefixLen); // 保留入學年+系所碼，只亂數化末 3 碼
  const suffixLen = len - prefixLen;
  let candidate, attempts = 0;
  do {
    let suffix = '';
    for (let i = 0; i < suffixLen; i++) suffix += String(randInt(rng, 10));
    candidate = prefix + suffix;
    attempts++;
  } while (usedStudentIds.has(candidate) && attempts < 2000);
  usedStudentIds.add(candidate);
  return candidate;
}

function genFakeIdNumber(rng, real) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const genderChar = real && real.length >= 2 && /[0-9]/.test(real[1]) ? real[1] : null; // 第二碼＝性別碼保留
  let candidate, attempts = 0;
  do {
    const letter = letters[randInt(rng, 26)];
    const d1 = genderChar != null ? Number(genderChar) : randInt(rng, 10);
    const rest = []; for (let i = 0; i < 7; i++) rest.push(randInt(rng, 10));
    const digits8 = [d1, ...rest];
    candidate = letter + digits8.join('') + String(idCheckDigit(letter, digits8));
    attempts++;
  } while (usedIdNumbers.has(candidate) && attempts < 2000);
  usedIdNumbers.add(candidate);
  return candidate;
}

function genFakePhone(rng) {
  let candidate, attempts = 0;
  do {
    let s = '09';
    for (let i = 0; i < 8; i++) s += String(randInt(rng, 10));
    candidate = s;
    attempts++;
  } while (usedPhones.has(candidate) && attempts < 2000);
  usedPhones.add(candidate);
  return candidate;
}

function genFakeAddress(rng) {
  return `屏東縣${pick(rng, TOWNSHIPS)}${pick(rng, ROAD_NAMES)}${randInt(rng, 200) + 1}號`;
}

function shiftBirthday(rng, real) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(real || '');
  if (!m) return real; // 格式不符原樣保留（實測全部符合 YYYY-MM-DD）
  const orig = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  let shiftDays = randInt(rng, 361) - 180; // -180..180
  if (shiftDays === 0) shiftDays = 37;
  let newTs = orig + shiftDays * 86400000;
  if (newTs > Date.now()) { shiftDays = -Math.abs(shiftDays); newTs = orig + shiftDays * 86400000; }
  const d = new Date(newTs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── Identity：一個真人（studentId 或 name fallback 鍵）的假資料快取 ──
class Identity {
  constructor(key) { this.key = key; this._cache = new Map(); }
  _memo(field, real, gen) {
    if (!real) return real;
    if (this._cache.has(field)) return this._cache.get(field);
    const fake = gen(rngFor(this.key + '|' + field), real);
    this._cache.set(field, fake);
    return fake;
  }
  fakeName(real) { return this._memo('name', real, genFakeName); }
  fakeStudentId(real) { return this._memo('studentId', real, genFakeStudentId); }
  fakeIdNumber(real) { return this._memo('idNumber', real, genFakeIdNumber); }
  fakePhone(real) { return this._memo('phone', real, (rng) => genFakePhone(rng)); }
  fakeAddress(real) { return this._memo('address', real, (rng) => genFakeAddress(rng)); }
  fakeEmergencyName(real) { return this._memo('emergencyName', real, (rng) => genFakeEmergencyName(rng)); }
  fakeEmergencyPhone(real) { return this._memo('emergencyPhone', real, (rng) => genFakePhone(rng)); }
  fakeBirthday(real) { return this._memo('birthday:' + real, real, (rng) => shiftBirthday(rng, real)); }
}

const identities = new Map();
function identityFor(key) {
  if (!key) return null;
  let id = identities.get(key);
  if (!id) { id = new Identity(key); identities.set(key, id); }
  return id;
}
function identityKeyOf(obj) { return (obj && (obj.studentId || obj.name)) || null; }

// ── 全域替換映射收錄規則 ─────────────────────────────────────────────
// 全域替換是對「任何字串值的任何位置」動手，太短/太通用的原值（電話欄的「不詳」、
// 4 碼分機、生日日期、短地址）會誤傷不相關文字，一律不得註冊——這些欄位在結構層
// 已被替換，全域層只負責「夠獨特」的原值出現在他處（待辦標籤/稽核內文/回報描述等）。
const GLOBAL_SWEEP_GUARDS = {
  name: (v) => v.length >= 2,
  id: (v) => /^[A-Za-z0-9-]{6,}$/.test(v),                                  // 學號/身分證
  phone: (v) => v.length >= 6 && (v.match(/\d/g) || []).length >= 6,
};
const realToFake = new Map(); // real -> fake（只收過守門的值）
function recordMapping(real, fake, kind) {
  if (!real || !fake || real === fake) return;
  const guard = GLOBAL_SWEEP_GUARDS[kind];
  if (!guard || !guard(String(real))) return;
  if (!realToFake.has(real)) realToFake.set(real, fake);
}

// pattern 邊界防護：純數字 → 前後不得緊鄰數字；英數 → 前後不得緊鄰英數；其餘原樣
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wrapPattern(real) {
  const esc = escapeRegExp(real);
  if (/^\d+$/.test(real)) return `(?<![0-9])${esc}(?![0-9])`;
  if (/^[A-Za-z0-9-]+$/.test(real)) return `(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`;
  return esc;
}
function buildCombinedRegex(valuesIterable) {
  const patterns = [...valuesIterable].sort((a, b) => b.length - a.length).map(wrapPattern); // 長字串優先
  if (!patterns.length) return null;
  return new RegExp(patterns.join('|'), 'g');
}

function buildGlobalReplacer(staffNames) {
  const lookup = new Map();
  for (const [real, fake] of realToFake) lookup.set(real, fake);
  // 同仁名自映射（自己換自己）合併進同一支長度優先 alternation，
  // 擋住 2 字個案名誤傷 3 字同仁名的子字串。
  for (const name of staffNames) if (name && name.length >= 2) lookup.set(name, name);
  const re = buildCombinedRegex(lookup.keys());
  if (!re) return (s) => s;
  return (str) => str.replace(re, (m) => (lookup.has(m) ? lookup.get(m) : m));
}

function walkReplace(node, replacer) {
  if (typeof node === 'string') return replacer(node);
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = walkReplace(node[i], replacer); return node; }
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) node[k] = walkReplace(node[k], replacer); return node; }
  return node;
}

// ── 結構層轉換 ───────────────────────────────────────────────────────
function transformBasicFields(obj, identity, stats) {
  if (!obj || !identity) return;
  if (obj.name) { const f = identity.fakeName(obj.name); recordMapping(obj.name, f, 'name'); obj.name = f; stats.name++; }
  if (obj.studentId) { const f = identity.fakeStudentId(obj.studentId); recordMapping(obj.studentId, f, 'id'); obj.studentId = f; stats.studentId++; }
  if (obj.idNumber) { const f = identity.fakeIdNumber(obj.idNumber); recordMapping(obj.idNumber, f, 'id'); obj.idNumber = f; stats.idNumber++; }
  if (obj.phone) { const f = identity.fakePhone(obj.phone); recordMapping(obj.phone, f, 'phone'); obj.phone = f; stats.phone++; }
  if (obj.address) { obj.address = identity.fakeAddress(obj.address); stats.address++; }
  if (obj.emergencyName) { const f = identity.fakeEmergencyName(obj.emergencyName); recordMapping(obj.emergencyName, f, 'name'); obj.emergencyName = f; stats.emergencyName++; }
  if (obj.emergencyPhone) { const f = identity.fakeEmergencyPhone(obj.emergencyPhone); recordMapping(obj.emergencyPhone, f, 'phone'); obj.emergencyPhone = f; stats.emergencyPhone++; }
  if (obj.birthday) { obj.birthday = identity.fakeBirthday(obj.birthday); stats.birthday++; }
}

// 其他臨床容器：先做 identity 欄位置換，再對長字串（>25）做示範假文取代
const CLINICAL_CONTAINER_KEYS = [
  'psychiatristRecords', 'semesterEvaluations', 'initialInterview', 'initialInterviews',
  'closureEvaluation', 'transferEvaluations', 'genogramStore', 'psychTestResults',
];
function patchIdentityFieldsDeep(node, identity, stats) {
  if (!identity) return;
  if (Array.isArray(node)) { node.forEach((n) => patchIdentityFieldsDeep(n, identity, stats)); return; }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && v) {
        if (k === 'studentId') { const f = identity.fakeStudentId(v); recordMapping(v, f, 'id'); node[k] = f; stats.containerIdentityFields++; continue; }
        if (k === 'name' || k === 'intervieweeName') { const f = identity.fakeName(v); recordMapping(v, f, 'name'); node[k] = f; stats.containerIdentityFields++; continue; }
        if (k === 'idNumber') { const f = identity.fakeIdNumber(v); recordMapping(v, f, 'id'); node[k] = f; stats.containerIdentityFields++; continue; }
      }
      patchIdentityFieldsDeep(v, identity, stats);
    }
  }
}
function redactLongStringsInPlace(node, stats) {
  if (Array.isArray(node)) { node.forEach((n) => redactLongStringsInPlace(n, stats)); return; }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') {
        if (v.length > 25 && v !== CLINICAL_PLACEHOLDER) { node[k] = CLINICAL_PLACEHOLDER; stats.containerLongText++; }
      } else {
        redactLongStringsInPlace(v, stats);
      }
    }
  }
}

function transformRecords(records, caseId, stats) {
  if (!Array.isArray(records)) return;
  records.forEach((r) => {
    if (r.summary) { r.summary = pickVariant(caseId + '|' + r.id + '|summary', SUMMARY_VARIANTS); stats.recordText++; }
    if (r.assessment) { r.assessment = pickVariant(caseId + '|' + r.id + '|assessment', ASSESSMENT_VARIANTS); stats.recordText++; }
    if (r.nextPlan) { r.nextPlan = pickVariant(caseId + '|' + r.id + '|nextPlan', NEXTPLAN_VARIANTS); stats.recordText++; }
  });
}

function transformCaseObject(c, stats) {
  const identity = identityFor(identityKeyOf(c));
  transformBasicFields(c, identity, stats);
  if (Array.isArray(c.pastRecords)) {
    c.pastRecords = c.pastRecords.map((s, idx) => {
      if (!s) return s;
      stats.pastRecords++;
      return pickVariant(c.id + '|pastRecords|' + idx, PASTRECORDS_VARIANTS);
    });
  } else if (typeof c.pastRecords === 'string' && c.pastRecords) {
    c.pastRecords = pickVariant(c.id + '|pastRecords', PASTRECORDS_VARIANTS);
    stats.pastRecords++;
  }
  if (c.basicInfoSnapshots && typeof c.basicInfoSnapshots === 'object') {
    for (const semKey of Object.keys(c.basicInfoSnapshots)) {
      transformBasicFields(c.basicInfoSnapshots[semKey], identity, stats);
    }
  }
  transformRecords(c.records, c.id, stats);
  for (const k of CLINICAL_CONTAINER_KEYS) {
    if (c[k] !== undefined && c[k] !== null && !(Array.isArray(c[k]) && c[k].length === 0)) {
      patchIdentityFieldsDeep(c[k], identity, stats);
      redactLongStringsInPlace(c[k], stats);
    }
  }
}

function transformMlRecord(r, stats) {
  const identity = identityFor(identityKeyOf(r));
  transformBasicFields(r, identity, stats);
  if (r.reason) { r.reason = pickVariant(r.id + '|reason', ML_REASON_VARIANTS); stats.mlReason++; }
  if (typeof r.assessment === 'string' && r.assessment.length > 25) {
    r.assessment = CLINICAL_PLACEHOLDER; stats.containerLongText++;
  } else if (r.assessment && typeof r.assessment === 'object') {
    redactLongStringsInPlace(r.assessment, stats);
  }
}

// ── 環境載入（manifest 分類）─────────────────────────────────────────
const CHUNK_RE = /^\d{7}-\d{7}\.json$/;

function casesOf(data) {
  if (data && Array.isArray(data.cases)) return data.cases;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data).filter((v) => v && typeof v === 'object' && v.id);
  return [];
}

function loadEnvironment() {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // trash 清單：migration-backup-* ＋ 所有非 JSON 非資料夾檔案（附件圖片/掃描件等）
  const trashList = manifest.filter((e) => e.name.startsWith('migration-backup-')
    || (e.mimeType !== 'application/json' && !e.mimeType.includes('folder')));
  const trashIds = new Set(trashList.map((e) => e.id));
  // 「套用後全集」＝未在垃圾桶、且不在 trash 清單的檔案
  const active = manifest.filter((e) => !e.trashed && !trashIds.has(e.id));
  const activeJson = active.filter((e) => e.mimeType === 'application/json');
  const env = {
    manifest, trashList, trashIds, activeJson,
    chunkEntries: activeJson.filter((e) => CHUNK_RE.test(e.name)),
    hotEntry: activeJson.find((e) => e.name === 'cases-hot.json'),
    indexEntry: activeJson.find((e) => e.name === 'cases-index.json'),
    mlEntry: activeJson.find((e) => e.name === 'mental_leaves.json'),
    mlEmailDumpEntry: activeJson.find((e) => e.name === 'ml_email_dump.json'),
    mlInboxListEntry: activeJson.find((e) => e.name === 'ml_inbox_list.json'),
    configEntry: activeJson.find((e) => e.name === 'config.json'),
  };
  env.identityFileIds = new Set([
    ...env.chunkEntries.map((e) => e.id),
    ...(env.hotEntry ? [env.hotEntry.id] : []),
    ...(env.indexEntry ? [env.indexEntry.id] : []),
    ...(env.mlEntry ? [env.mlEntry.id] : []),
  ]);
  return env;
}
function readContentRaw(fileId) { return fs.readFileSync(path.join(CONTENT_DIR, fileId), 'utf8'); }

function loadStaffNames(env) {
  if (!env.configEntry) return [];
  const cfg = JSON.parse(readContentRaw(env.configEntry.id));
  return Object.values(cfg.users || {}).map((u) => u && u.name).filter(Boolean);
}

// 從備份原始檔收集「應消失的真實值」四類（殘留掃描用；同仁名排除；
// 收錄門檻與全域映射守門一致——太短/不具辨識度的值不列入掃描以免子字串誤報）
function collectRealValues(env, staffNameSet) {
  const names = new Set(), studentIds = new Set(), idNumbers = new Set(), phones = new Set();
  function collect(o) {
    if (!o) return;
    for (const nm of [o.name, o.emergencyName, o.intervieweeName]) {
      if (nm && GLOBAL_SWEEP_GUARDS.name(nm) && !staffNameSet.has(nm)) names.add(nm);
    }
    if (o.studentId && GLOBAL_SWEEP_GUARDS.id(o.studentId)) studentIds.add(o.studentId);
    if (o.idNumber && GLOBAL_SWEEP_GUARDS.id(o.idNumber)) idNumbers.add(o.idNumber);
    for (const ph of [o.phone, o.emergencyPhone]) {
      if (ph && GLOBAL_SWEEP_GUARDS.phone(ph)) phones.add(ph);
    }
  }
  function collectCase(c) {
    collect(c);
    if (c.basicInfoSnapshots && typeof c.basicInfoSnapshots === 'object') Object.values(c.basicInfoSnapshots).forEach(collect);
    for (const k of CLINICAL_CONTAINER_KEYS) {
      if (!c[k] || typeof c[k] !== 'object') continue;
      (function deep(node) {
        if (Array.isArray(node)) { node.forEach(deep); return; }
        if (node && typeof node === 'object') {
          collect(node);
          Object.values(node).forEach(deep);
        }
      })(c[k]);
    }
  }
  for (const e of env.chunkEntries) casesOf(JSON.parse(readContentRaw(e.id))).forEach(collectCase);
  if (env.hotEntry) casesOf(JSON.parse(readContentRaw(env.hotEntry.id))).forEach(collectCase);
  if (env.indexEntry) casesOf(JSON.parse(readContentRaw(env.indexEntry.id))).forEach(collect);
  if (env.mlEntry) (JSON.parse(readContentRaw(env.mlEntry.id)).records || []).forEach(collect);
  return { names, studentIds, idNumbers, phones };
}

// 殘留掃描：「套用後全集」視角（deid-out 有的用新檔、沒有的用備份原檔；
// trash 清單檔與已在垃圾桶者不在集內）。回傳 { hits, categories }。
function residualScan(env, realSets) {
  const catRegex = [
    ['name', buildCombinedRegex(realSets.names)],
    ['studentId', buildCombinedRegex(realSets.studentIds)],
    ['idNumber', buildCombinedRegex(realSets.idNumbers)],
    ['phone', buildCombinedRegex(realSets.phones)],
  ];
  let hits = 0;
  const categories = new Set();
  for (const e of env.activeJson) {
    const outPath = path.join(OUT_CONTENT_DIR, e.id);
    const text = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : readContentRaw(e.id);
    for (const [cat, re] of catRegex) {
      if (!re) continue;
      re.lastIndex = 0;
      const m = text.match(re);
      if (m) { hits += m.length; categories.add(e.name + ':' + cat); }
    }
  }
  return { hits, categories: [...categories] };
}

// ═════════════════════════════ --transform ═════════════════════════
function cmdTransform() {
  const env = loadEnvironment();
  const staffNames = loadStaffNames(env);
  const staffNameSet = new Set(staffNames);
  staffNames.forEach((n) => usedFullNames.add(n));

  // ── Pass 0：預掃所有真實值進排除集（防假值撞真值），並收集 2 字真實姓名 ──
  const parsedChunks = new Map();
  function seedFromBasicObj(o) {
    if (!o) return;
    for (const nm of [o.name, o.emergencyName]) {
      if (nm) { usedFullNames.add(nm); if (hasCJK(nm) && nm.length === 2) realShortNames.add(nm); }
    }
    if (o.studentId) usedStudentIds.add(o.studentId);
    if (o.idNumber) usedIdNumbers.add(o.idNumber);
    if (o.phone) usedPhones.add(o.phone);
    if (o.emergencyPhone) usedPhones.add(o.emergencyPhone);
  }
  function seedFromCase(c) {
    seedFromBasicObj(c);
    if (c.basicInfoSnapshots && typeof c.basicInfoSnapshots === 'object') Object.values(c.basicInfoSnapshots).forEach(seedFromBasicObj);
  }
  for (const e of env.chunkEntries) {
    const data = JSON.parse(readContentRaw(e.id));
    parsedChunks.set(e.id, data);
    casesOf(data).forEach(seedFromCase);
  }
  let hotData = null;
  if (env.hotEntry) { hotData = JSON.parse(readContentRaw(env.hotEntry.id)); casesOf(hotData).forEach(seedFromCase); }
  let indexData = null;
  if (env.indexEntry) { indexData = JSON.parse(readContentRaw(env.indexEntry.id)); casesOf(indexData).forEach(seedFromBasicObj); }
  let mlData = null;
  if (env.mlEntry) { mlData = JSON.parse(readContentRaw(env.mlEntry.id)); (mlData.records || []).forEach(seedFromBasicObj); }

  // ── Pass A：結構層轉換（同時累積 realToFake 全域映射）────────────────
  const stats = {
    name: 0, studentId: 0, idNumber: 0, phone: 0, address: 0, emergencyName: 0, emergencyPhone: 0, birthday: 0,
    recordText: 0, pastRecords: 0, mlReason: 0, containerIdentityFields: 0, containerLongText: 0,
  };
  const chunkOriginal = new Map();
  for (const e of env.chunkEntries) {
    chunkOriginal.set(e.id, readContentRaw(e.id));
    casesOf(parsedChunks.get(e.id)).forEach((c) => transformCaseObject(c, stats));
  }
  if (hotData) casesOf(hotData).forEach((c) => transformCaseObject(c, stats));
  if (indexData) casesOf(indexData).forEach((c) => transformBasicFields(c, identityFor(identityKeyOf(c)), stats));
  if (mlData) (mlData.records || []).forEach((r) => transformMlRecord(r, stats));
  const identityCount = identities.size;

  // ── Pass B＋C：全域掃描替換所有 active JSON，寫出有變動的檔 ──────────
  const globalReplace = buildGlobalReplacer(staffNames);
  fs.rmSync(OUT_CONTENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_CONTENT_DIR, { recursive: true });
  const fileReport = {
    chunks: { total: env.chunkEntries.length, changed: 0 },
    hot: { total: env.hotEntry ? 1 : 0, changed: 0 },
    index: { total: env.indexEntry ? 1 : 0, changed: 0 },
    mentalLeaves: { total: env.mlEntry ? 1 : 0, changed: 0 },
    mlEmailDump: { total: env.mlEmailDumpEntry ? 1 : 0, changed: 0 },
    mlInboxList: { total: env.mlInboxListEntry ? 1 : 0, changed: 0 },
    otherJson: { total: 0, changed: 0 },
  };
  const changedFileIds = [];
  const countBefore = new Map(); // fileId -> 原筆數（chunk/hot/index=cases、ml=records）

  function writeIfChanged(fileId, originalCanonical, data) {
    const finalized = JSON.stringify(walkReplace(data, globalReplace)); // 與系統現行寫法一致：不縮排
    if (finalized !== originalCanonical) {
      fs.writeFileSync(path.join(OUT_CONTENT_DIR, fileId), finalized, 'utf8');
      changedFileIds.push(fileId);
      return true;
    }
    return false;
  }

  for (const e of env.chunkEntries) {
    const origParsed = JSON.parse(chunkOriginal.get(e.id));
    countBefore.set(e.id, casesOf(origParsed).length);
    if (writeIfChanged(e.id, JSON.stringify(origParsed), parsedChunks.get(e.id))) fileReport.chunks.changed++;
  }
  if (env.hotEntry) {
    const origParsed = JSON.parse(readContentRaw(env.hotEntry.id));
    countBefore.set(env.hotEntry.id, casesOf(origParsed).length);
    if (writeIfChanged(env.hotEntry.id, JSON.stringify(origParsed), hotData)) fileReport.hot.changed++;
  }
  if (env.indexEntry) {
    const origParsed = JSON.parse(readContentRaw(env.indexEntry.id));
    countBefore.set(env.indexEntry.id, casesOf(origParsed).length);
    if (writeIfChanged(env.indexEntry.id, JSON.stringify(origParsed), indexData)) fileReport.index.changed++;
  }
  if (env.mlEntry) {
    const origParsed = JSON.parse(readContentRaw(env.mlEntry.id));
    countBefore.set(env.mlEntry.id, (origParsed.records || []).length);
    if (writeIfChanged(env.mlEntry.id, JSON.stringify(origParsed), mlData)) fileReport.mentalLeaves.changed++;
  }
  if (env.mlEmailDumpEntry) {
    const orig = JSON.parse(readContentRaw(env.mlEmailDumpEntry.id));
    const wiped = { dumpedAt: orig.dumpedAt, count: 0, emails: [] };
    if (writeIfChanged(env.mlEmailDumpEntry.id, JSON.stringify(orig), wiped)) fileReport.mlEmailDump.changed++;
  }
  if (env.mlInboxListEntry) {
    const orig = JSON.parse(readContentRaw(env.mlInboxListEntry.id));
    const wiped = { ...orig, emails: [], inboxCount: 0, allCount: 0, count: 0 };
    if (writeIfChanged(env.mlInboxListEntry.id, JSON.stringify(orig), wiped)) fileReport.mlInboxList.changed++;
  }
  // 其餘所有 active JSON（todos/audit_log/系統日誌/bookings/config/debug_log…）：純全域掃描
  const otherEntries = env.activeJson.filter((e) => !env.identityFileIds.has(e.id)
    && e !== env.mlEmailDumpEntry && e !== env.mlInboxListEntry);
  fileReport.otherJson.total = otherEntries.length;
  for (const e of otherEntries) {
    let parsed;
    try { parsed = JSON.parse(readContentRaw(e.id)); } catch { continue; }
    if (writeIfChanged(e.id, JSON.stringify(parsed), parsed)) fileReport.otherJson.changed++;
  }

  // ── 內建驗證 ─────────────────────────────────────────────────────
  const validation = { ok: true, issues: [] };

  // 1) 變動檔可 JSON.parse＋筆數一致
  for (const fileId of changedFileIds) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(OUT_CONTENT_DIR, fileId), 'utf8')); }
    catch { validation.ok = false; validation.issues.push(`檔案 ${fileId} 輸出後無法 JSON.parse`); continue; }
    if (countBefore.has(fileId)) {
      const after = Array.isArray(parsed.records) && !parsed.cases ? parsed.records.length : casesOf(parsed).length;
      if (after !== countBefore.get(fileId)) {
        validation.ok = false;
        validation.issues.push(`檔案 ${fileId} 筆數改變（前 ${countBefore.get(fileId)} → 後 ${after}）`);
      }
    }
  }

  // 2) 假值唯一性：生成時即以全域集合排重＋Pass 0 預塞全部真值，
  //    故假值彼此、假值與任何真值皆不相撞；集合大小輸出供人工核對。
  validation.uniqueSetSizes = {
    fullNames: usedFullNames.size, studentIds: usedStudentIds.size,
    idNumbers: usedIdNumbers.size, phones: usedPhones.size,
  };

  // 3) 殘留掃描
  const realSets = collectRealValues(env, staffNameSet);
  const scan = residualScan(env, realSets);
  if (scan.hits > 0) {
    validation.ok = false;
    validation.issues.push(`殘留掃描發現 ${scan.hits} 筆真實值命中（類別見 residualSampleCategories）`);
  }
  validation.residualHits = scan.hits;
  validation.residualSampleCategories = scan.categories;

  // ── 映射表（含真值，已 gitignore，僅供人工核對）──────────────────────
  const mappingOut = {};
  for (const [key, id] of identities) {
    mappingOut[key] = {
      name: id._cache.get('name'),
      studentId: id._cache.get('studentId'),
      idNumber: id._cache.get('idNumber'),
      phone: id._cache.get('phone'),
      address: id._cache.get('address'),
      emergencyName: id._cache.get('emergencyName'),
      emergencyPhone: id._cache.get('emergencyPhone'),
    };
  }
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mappingOut), 'utf8');

  // ── report.json ──────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    identityCount,
    fieldChangeStats: stats,
    fileReport,
    writtenFiles: changedFileIds.length,
    trashList: env.trashList.map((e) => ({ id: e.id, name: e.name, mimeType: e.mimeType, alreadyTrashed: !!e.trashed })),
    validation,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  // ── stdout 摘要（零個資）──────────────────────────────────────────
  console.log('=== 去識別化轉換完成 ===');
  console.log(`identity 總數：${identityCount}`);
  console.log('各檔案類別變動數（changed/total）：');
  for (const [cat, v] of Object.entries(fileReport)) console.log(`  ${cat}: ${v.changed}/${v.total}`);
  console.log(`欄位變動次數：${JSON.stringify(stats)}`);
  console.log(`trash 清單筆數：${report.trashList.length}（migration-backup-* 與非JSON非資料夾檔案）`);
  console.log('trash 清單檔名：');
  report.trashList.forEach((t) => console.log(`  - ${t.name}${t.alreadyTrashed ? '（已在垃圾桶）' : ''}`));
  console.log(`唯一值集合大小：${JSON.stringify(validation.uniqueSetSizes)}`);
  console.log(`殘留掃描命中數：${scan.hits}${scan.hits ? '（類別：' + scan.categories.join(', ') + '）' : '（0 命中，通過）'}`);
  console.log(validation.ok ? '內建驗證：全部通過' : '內建驗證：發現問題 → ' + validation.issues.join('；'));
  console.log(`輸出：deid-out/content 內 ${changedFileIds.length} 個變動檔 + report.json`);
  console.log('映射表：deid-mapping.json（已 gitignore，僅供人工核對）');

  if (!validation.ok) process.exitCode = 1;
}

// ═════════════════════════════ --apply ═════════════════════════════
async function tokenFromRefresh(creds, refreshToken) {
  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id, client_secret: creds.client_secret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('refresh token 失效（' + res.status + '）：' + (await res.text()));
  return res.json();
}
function loadCreds() {
  const j = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const c = j.installed || j.web;
  if (!c) throw new Error('creds.json 格式不符（缺 installed/web）');
  return c;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err && err.status;
      if (status && status !== 429 && (status < 500 || status >= 600)) throw err; // 非 429/5xx 不重試
      if (attempt < 3) {
        console.warn(`  重試（${label}，第 ${attempt + 1} 次失敗：${err.message.split('\n')[0]}）`);
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}

async function cmdApply() {
  if (!fs.existsSync(REPORT_PATH)) throw new Error('deid-out/report.json 不存在，請先跑 --transform');
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (!report.validation || !report.validation.ok) {
    throw new Error('report.json 的內建驗證未通過（見 validation.issues），拒絕 --apply。請重跑 --transform。');
  }

  // --apply 前再跑一次殘留掃描（獨立重建真值集合，不信任 report 舊結果）
  console.log('apply 前殘留掃描中…');
  const env = loadEnvironment();
  const staffNameSet = new Set(loadStaffNames(env));
  const realSets = collectRealValues(env, staffNameSet);
  const scan = residualScan(env, realSets);
  if (scan.hits > 0) {
    throw new Error(`apply 前殘留掃描發現 ${scan.hits} 筆命中（類別：${scan.categories.join(', ')}），拒絕上傳。`);
  }
  console.log('apply 前殘留掃描：0 命中，通過。');

  if (!fs.existsSync(RW_TOKEN_PATH)) throw new Error('.drive-token-rw.json 不存在，請先跑 node scripts/mint-drive-rw-token.mjs 授權。');
  const creds = loadCreds();
  const cached = JSON.parse(fs.readFileSync(RW_TOKEN_PATH, 'utf8'));
  const tok = await tokenFromRefresh(creds, cached.refresh_token);
  const accessToken = tok.access_token;

  async function driveFetch(url, opts) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 300)}`); e.status = res.status; throw e; }
    return res;
  }

  const idToName = new Map(env.manifest.map((e) => [e.id, e.name]));
  const changedIds = fs.readdirSync(OUT_CONTENT_DIR);
  console.log(`共 ${changedIds.length} 個變動檔待上傳。`);
  let okCount = 0, failCount = 0;
  for (const fileId of changedIds) {
    const label = idToName.get(fileId) || fileId;
    const body = fs.readFileSync(path.join(OUT_CONTENT_DIR, fileId));
    try {
      await withRetry(() => driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      ), label);
      okCount++;
      console.log(`  已上傳：${label}`);
    } catch (err) { failCount++; console.error(`  上傳失敗：${label}：${err.message.split('\n')[0]}`); }
  }

  const toTrash = report.trashList.filter((t) => !t.alreadyTrashed);
  console.log(`共 ${toTrash.length} 個檔案待 trash（另有 ${report.trashList.length - toTrash.length} 個已在垃圾桶，略過）。`);
  let trashOk = 0, trashFail = 0;
  for (const item of toTrash) {
    try {
      await withRetry(() => driveFetch(
        `https://www.googleapis.com/drive/v3/files/${item.id}?supportsAllDrives=true`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
      ), item.name);
      trashOk++;
      console.log(`  已 trash：${item.name}`);
    } catch (err) { trashFail++; console.error(`  trash 失敗：${item.name}：${err.message.split('\n')[0]}`); }
  }

  console.log(`=== --apply 完成 === 上傳成功 ${okCount}/${changedIds.length}，trash 成功 ${trashOk}/${toTrash.length}`);
  if (failCount > 0 || trashFail > 0) process.exitCode = 1;
}

// ── entry ────────────────────────────────────────────────────────────
const mode = process.argv[2];
if (mode === '--transform') cmdTransform();
else if (mode === '--apply') cmdApply().catch((e) => { console.error('失敗：' + e.message); process.exit(1); });
else { console.error('用法：node scripts/deidentify-dev.mjs --transform | --apply'); process.exit(1); }
