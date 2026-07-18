// server/src/freshmanTest/actions.js — 新生心理測驗（v207 Slice 1）：學期資料集＋分頁資料表
// （本切片僅「學生基本資料」，其餘四個資料 tab 為前端佔位、後端尚未實作，見 SHEETS 白名單）。
//
// 儲存設計（vdrive JSON，路徑固定，不吃前端任意路徑）：
//   freshman-test/semesters.json                     — 學期清單 { semesters:[{id,label,createdAt,createdBy}] }
//   freshman-test/<semester>/schema-<sheet>.json      — 欄位定義 { version, cols:[{id,name,required,locked?,width?}] }
//   freshman-test/<semester>/<sheet>.json             — 列資料 { rows:[{_id,_createdAt,_updatedAt,cells:{colId:value}}] }
//
// 「增刪欄位不影響歷史資料」的實作核心：schema 與 rows 是兩個獨立檔案，cells 以 colId（非欄名）為
// key。刪欄只是 schema.cols 拿掉一筆——rows.json 完全不受觸碰，舊列的 cells[被刪colId] 資料原樣保留
// （只是沒有任何欄位會再顯示它）；新增欄同理，舊列單純沒有這個 key，前端顯示空白。這是結構性保證，
// 不需要額外程式碼在「刪欄時」去搬移或清除 rows 資料。
//
// 併發模型：比照 actions/commit.js 的 readExistingOrNull／writeBack RMW 慣例——整段讀-改-寫在同一個
// db.transaction(fn).immediate() 內完成，fail-closed（檔案存在但形狀異常一律 throw 中止，不以空殼覆寫）。
//
// 授權：所有 ft* action 走 authz/gate.js 的 freshmanTestDecision（管理者或 isFreshmenTestContact），
// 見 dispatch.js 對 /^ft[A-Z]/ 前綴的統一閘門判斷（CLAUDE.md 資安原則 1：新增 action 預設需授權）。
//
// 稽核去識別化（CLAUDE.md 資安原則 3）：本檔不決定 audit detail 怎麼寫（由 dispatch.js 的
// audit.summarizeFtParams 負責），但刻意讓回傳值只帶筆數/欄位定義/學期代碼，不含學生個資明細，
// 供 dispatch.js 需要時取用（historical 旗標同理）。
'use strict';

const vdrive = require('../storage/vdrive');

const ROOT_DIR = 'freshman-test';
const SEMESTERS_PATH = `${ROOT_DIR}/semesters.json`;

// Slice 1：僅「學生基本資料」實作到後端。測驗資料/Google表單/導師名冊/整合/統計等後續切片會擴充
// 本白名單與 LOCKED_COL_ID／defaultSchema——刻意先只開放已完整實作的 sheet，避免前端佔位 tab
// 意外能呼叫到尚未設計欄位/驗證規則的後端路徑（預設 deny，CLAUDE.md 資安原則 1）。
const SHEETS = new Set(['students']);
const LOCKED_COL_ID = { students: 'stu_id' }; // 學號欄固定不可刪（比對主鍵）

const STUDENTS_DEFAULT_COLS = [
  { id: 'stu_id', name: '學號', required: true, locked: true, width: 110 },
  { id: 'name_zh', name: '中文姓名', required: true },
  { id: 'reg_status', name: '註冊狀態' },
  { id: 'edu_code', name: '學制代碼' },
  { id: 'edu_abbr', name: '學制簡稱' },
  { id: 'college', name: '學院' },
  { id: 'dept_code', name: '系所代碼' },
  { id: 'dept_name', name: '系所全名' },
  { id: 'class_code', name: '班級代碼' },
  { id: 'class_abbr', name: '班級簡稱' },
  { id: 'gender', name: '性別' },
  { id: 'email', name: 'Email' },
  { id: 'phone_contact', name: '學生聯絡電話' },
  { id: 'phone_mobile', name: '學生手機' },
];

function defaultSchema(sheet) {
  if (sheet === 'students') {
    return { version: 1, cols: STUDENTS_DEFAULT_COLS.map((c) => ({ ...c })) };
  }
  throw new Error(`freshmanTest: 未知 sheet（${sheet}）`);
}

function assertSheetAllowed(sheet) {
  if (!SHEETS.has(sheet)) throw new Error(`freshmanTest: 不支援的 sheet（${sheet}）`);
}

// 學期代碼格式：114-1／114-2（學年-學期，教務慣例，見 memory project_freshman_test.md）。
const SEMESTER_ID_RE = /^\d{3}-[12]$/;
function assertSemesterId(id) {
  if (typeof id !== 'string' || !SEMESTER_ID_RE.test(id)) {
    throw new Error(`freshmanTest: 學期代碼格式錯誤（須為 114-1 格式，收到 ${JSON.stringify(id)}）`);
  }
}

function semesterDir(semester) { return `${ROOT_DIR}/${semester}`; }
function sheetFileName(sheet) { return `${sheet}.json`; }
function schemaFileName(sheet) { return `schema-${sheet}.json`; }

// ── 讀檔 helper（比照 actions/commit.js 的 readExistingOrNull／writeBack RMW 慣例）──
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

function writeBack(db, fileId, dirPath, fileName, data, ctx) {
  if (fileId) {
    vdrive.updateContentById(db, fileId, data);
    return fileId;
  }
  const parentId = vdrive.ensureDirId(db, dirPath, ctx);
  const created = vdrive.createJson(db, { name: fileName, content: data, parentId });
  return created.id;
}

// ── ftListSemesters ──
function ftListSemesters(db, ctx) {
  const { data } = readExistingOrNull(
    db, SEMESTERS_PATH, ctx, 'ftListSemesters: 讀取 semesters.json 失敗，已中止以保護資料'
  );
  if (!data || !Array.isArray(data.semesters)) return { semesters: [] };
  return { semesters: data.semesters };
}

// 純函式：依 id 字典序取最新學期（114-1 < 114-2 < 115-1——三碼學年+連字號+單碼學期，字典序恰好
// 等於學年期序，不需額外拆解比較）。供「歷史學期」判定使用（見下方 isHistoricalSemester）。
function latestSemesterId(semesters) {
  if (!Array.isArray(semesters) || !semesters.length) return null;
  const ids = semesters.map((s) => s && s.id).filter(Boolean).sort();
  return ids.length ? ids[ids.length - 1] : null;
}

// 是否為「歷史學期」（非目前最新一筆）——修改歷史學期的寫入，dispatch.js 的稽核 detail 會標記
// historical:true（日後通知機制的鉤子，本切片不做通知，見任務規格第 3 節）。
function isHistoricalSemester(db, ctx, semester) {
  const { semesters } = ftListSemesters(db, ctx);
  const latest = latestSemesterId(semesters);
  return !!(latest && latest !== semester);
}

// ── ftCreateSemester：新增學期資料集（semesters.json 條目 + 該學期資料夾下的預設 schema）──
function ftCreateSemester(db, params, ctx, userEmail) {
  const id = params && params.id;
  const label = params && params.label;
  assertSemesterId(id);
  const cleanLabel = (label == null ? '' : String(label)).trim().slice(0, 60) || id;

  const result = db.transaction(() => {
    const { fileId, data: loaded } = readExistingOrNull(
      db, SEMESTERS_PATH, ctx, 'ftCreateSemester: 讀取 semesters.json 失敗，已中止寫入以保護資料'
    );
    let data;
    if (fileId == null) {
      data = { semesters: [] };
    } else {
      if (!loaded || !Array.isArray(loaded.semesters)) {
        throw new Error('ftCreateSemester: semesters.json 內容異常（semesters 非陣列），已中止寫入以保護資料');
      }
      data = loaded;
    }
    if (data.semesters.some((s) => s && s.id === id)) {
      throw new Error(`ftCreateSemester: 學期已存在（${id}）`);
    }
    const now = new Date().toISOString();
    const entry = { id, label: cleanLabel, createdAt: now, createdBy: userEmail || null };
    data.semesters.push(entry);
    data.updatedAt = now;
    writeBack(db, fileId, ROOT_DIR, 'semesters.json', data, ctx);

    // 預先建立預設 schema（rows 檔留到第一次存檔才建立——ftGetSheet 對缺檔案回空 rows 陣列，
    // 不需要為每個 sheet 都建一份空殼 rows.json）。
    const dir = semesterDir(id);
    Array.from(SHEETS).forEach((sheet) => {
      const path = `${dir}/${schemaFileName(sheet)}`;
      let existingId;
      try { existingId = vdrive.resolvePathToId(db, path, ctx); } catch (_e) { existingId = null; }
      if (existingId == null) {
        const parentId = vdrive.ensureDirId(db, dir, ctx);
        vdrive.createJson(db, { name: schemaFileName(sheet), content: defaultSchema(sheet), parentId });
      }
    });

    return { ok: true, semester: entry };
  }).immediate();

  return result;
}

// ── ftGetSheet：回傳 { schema, rows }。缺檔一律回預設 schema／空 rows（尚未建立資料的新學期）──
function ftGetSheet(db, params, ctx) {
  const semester = params && params.semester;
  const sheet = params && params.sheet;
  assertSemesterId(semester);
  assertSheetAllowed(sheet);
  const dir = semesterDir(semester);
  const schemaPath = `${dir}/${schemaFileName(sheet)}`;
  const rowsPath = `${dir}/${sheetFileName(sheet)}`;

  const { data: schemaData } = readExistingOrNull(
    db, schemaPath, ctx, `ftGetSheet: 讀取 ${schemaPath} 失敗，已中止以保護資料`
  );
  const schema = (schemaData && Array.isArray(schemaData.cols)) ? schemaData : defaultSchema(sheet);

  const { data: rowsData } = readExistingOrNull(
    db, rowsPath, ctx, `ftGetSheet: 讀取 ${rowsPath} 失敗，已中止以保護資料`
  );
  const rows = (rowsData && Array.isArray(rowsData.rows)) ? rowsData.rows : [];

  return { schema, rows };
}

// ── ftSaveSchema：整份 cols 取代（欄位數量小，不需差異式 op）。刪欄不觸碰 rows.json（見檔頭
//    schema/rows 分檔設計），「增刪欄位不影響歷史資料」是結構性保證。──
function validateCols(sheet, cols) {
  if (!Array.isArray(cols) || !cols.length) throw new Error('ftSaveSchema: cols 須為非空陣列');
  const seen = new Set();
  const lockedId = LOCKED_COL_ID[sheet];
  let hasLocked = false;
  cols.forEach((c) => {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
      throw new Error('ftSaveSchema: 每個欄位須有 id');
    }
    if (seen.has(c.id)) throw new Error(`ftSaveSchema: 欄位 id 重複（${c.id}）`);
    seen.add(c.id);
    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`ftSaveSchema: 欄位缺少名稱（${c.id}）`);
    if (c.id === lockedId) hasLocked = true;
  });
  if (lockedId && !hasLocked) throw new Error(`ftSaveSchema: 不可刪除固定欄位（${lockedId}）`);
}

function ftSaveSchema(db, params, ctx, userEmail) {
  const semester = params && params.semester;
  const sheet = params && params.sheet;
  const cols = params && params.cols;
  assertSemesterId(semester);
  assertSheetAllowed(sheet);
  validateCols(sheet, cols);
  const historical = isHistoricalSemester(db, ctx, semester);

  const result = db.transaction(() => {
    const dir = semesterDir(semester);
    const path = `${dir}/${schemaFileName(sheet)}`;
    const { fileId } = readExistingOrNull(
      db, path, ctx, `ftSaveSchema: 讀取 ${path} 失敗，已中止寫入以保護資料`
    );
    const now = new Date().toISOString();
    const lockedId = LOCKED_COL_ID[sheet];
    const data = {
      version: 1,
      cols: cols.map((c) => {
        const col = { id: c.id, name: String(c.name).trim(), required: c.required === true };
        if (c.id === lockedId) col.locked = true;
        if (Number.isFinite(c.width)) col.width = c.width;
        return col;
      }),
      updatedAt: now,
      updatedBy: userEmail || null,
    };
    writeBack(db, fileId, dir, schemaFileName(sheet), data, ctx);
    return { ok: true, schema: data };
  }).immediate();

  return { ...result, historical };
}

// ── ftSaveRows：整份 rows 取代（前端維護完整陣列送出）。既有列以 _id 比對保留 _createdAt，
//    沒有 _id 的新列由後端配發（不信任前端自報 id，避免 id 衝突/偽造），比照 vdrive.newFileId
//    既有的隨機 id 產生器（不另外重造一套）。「匯入合併」沿用本 action：前端把匯入衝突勾選解析完的
//    最終列陣列整包送來即可，不需要獨立的後端 merge action（減少攻擊面，CLAUDE.md 資安原則 1）。──
function ftSaveRows(db, params, ctx, userEmail) {
  const semester = params && params.semester;
  const sheet = params && params.sheet;
  const rows = params && params.rows;
  assertSemesterId(semester);
  assertSheetAllowed(sheet);
  if (!Array.isArray(rows)) throw new Error('ftSaveRows: rows 須為陣列');
  const historical = isHistoricalSemester(db, ctx, semester);

  const result = db.transaction(() => {
    const dir = semesterDir(semester);
    const path = `${dir}/${sheetFileName(sheet)}`;
    const { fileId, data: loaded } = readExistingOrNull(
      db, path, ctx, `ftSaveRows: 讀取 ${path} 失敗，已中止寫入以保護資料`
    );
    const oldById = new Map();
    if (fileId != null) {
      if (!loaded || !Array.isArray(loaded.rows)) {
        throw new Error(`ftSaveRows: ${path} 內容異常（rows 非陣列），已中止寫入以保護資料`);
      }
      loaded.rows.forEach((r) => { if (r && r._id) oldById.set(r._id, r); });
    }
    const now = new Date().toISOString();
    const nextRows = rows.map((r) => {
      const id = (r && typeof r._id === 'string' && r._id) || vdrive.newFileId();
      const old = oldById.get(id);
      const cells = (r && r.cells && typeof r.cells === 'object' && !Array.isArray(r.cells)) ? r.cells : {};
      return { _id: id, _createdAt: (old && old._createdAt) || now, _updatedAt: now, cells };
    });
    const data = { rows: nextRows, updatedAt: now, updatedBy: userEmail || null };
    writeBack(db, fileId, dir, sheetFileName(sheet), data, ctx);
    return { ok: true, count: nextRows.length, updatedAt: now };
  }).immediate();

  return { ...result, historical };
}

module.exports = {
  ROOT_DIR,
  SHEETS,
  LOCKED_COL_ID,
  STUDENTS_DEFAULT_COLS,
  defaultSchema,
  assertSheetAllowed,
  assertSemesterId,
  semesterDir,
  latestSemesterId,
  isHistoricalSemester,
  validateCols,
  ftListSemesters,
  ftCreateSemester,
  ftGetSheet,
  ftSaveSchema,
  ftSaveRows,
};
