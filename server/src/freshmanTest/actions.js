// server/src/freshmanTest/actions.js — 新生心理測驗：學期資料集＋分頁資料表
// v207 Slice 1 僅「學生基本資料」；v208 Slice 2 擴充「測驗資料」（146 欄，見 genTestsDefaultCols）
// 與「Google表單」（8 欄，見 GFORMS_DEFAULT_COLS）——ftGetSheet/ftSaveSchema/ftSaveRows 本就是
// 帶 sheet 參數的泛化實作（Slice 1 就這樣設計），本次只需擴充 SHEETS 白名單＋defaultSchema／
// LOCKED_COL_ID 對應表，三個 action 本身完全不必改動（白名單外的 sheet 一律 assertSheetAllowed 擋下）。
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
const tutorsysSync = require('./tutorsysSync');

const ROOT_DIR = 'freshman-test';
const SEMESTERS_PATH = `${ROOT_DIR}/semesters.json`;

// v209 Slice 3：導師名冊（tutors）開放——整合（merged）仍是前端純衍生視圖、不落地儲存，維持
// 白名單外（預設 deny，CLAUDE.md 資安原則 1）；統計（stats）留待 Slice 4。
const SHEETS = new Set(['students', 'tests', 'gforms', 'tutors']);
// 學號欄固定不可刪（比對主鍵）——students/tests/gforms 三個 sheet 皆用同一個 colId『stu_id』代表
// 學號欄（刻意統一命名，讓前端「依學號跨 sheet 比對」的檢核程式碼不需要為每個 sheet 另外查一次
// colId 對映表）。tutors 的主鍵改為『class_abbr』（班級簡稱）——導師名冊沒有學號概念，比對主鍵
// 是班級。
const LOCKED_COL_ID = { students: 'stu_id', tests: 'stu_id', gforms: 'stu_id', tutors: 'class_abbr' };

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

// v208：Google表單匯出欄位——8 欄，欄名逐字對映校內 Google 表單實際題目文字（含中英夾雜、全形/
// 半形括號不一致等原始寫法），供日後匯入比對欄名時能精確對上（見前端 _ftAoaToImportRows）。
// 最後一欄題目文字特長（中英合一），前端 header 顯示會截斷＋hover 用 data-tip 顯示全文，欄名本身
// 不做任何截斷處理（截斷是純顯示層考量）。
const GFORMS_DEFAULT_COLS = [
  { id: 'ts', name: '時間戳記' },
  { id: 'name_zh', name: '姓名（Name）', required: true },
  { id: 'stu_id', name: '學號（Student ID Number）', required: true, locked: true, width: 130 },
  { id: 'dept', name: '系所（Department）' },
  { id: 'class_name', name: '班級（Class)' },
  { id: 'phone', name: '手機號碼（Cell Phone Number）' },
  { id: 'email', name: '電子信箱（E-mail）' },
  {
    id: 'consent_mentor',
    name: '若測驗結果顯示為高關懷，您是否同意系主任及導師知情，以讓系主任及導師了解您的狀況並適時提供關心。/ Would you agree to let your academic mentor and the department director get the test results if they show you might have some adaptive challenges? Then, your academic mentor and the department director could assist you.',
    width: 320,
  },
];

// v208：測驗資料——146 欄，程式化生成避免手打錯（欄位數量大、命名規律強）。順序與分組完全對映
// 使用者裁決（見 memory project_freshman_test.md）：①基本資料+效度 19 欄 ②xxavg 19 欄 ③原始分數
// 19 欄 ④PR 20 欄 ⑤item1~item53 共 53 欄 ⑥ALL+SxxL 13 欄 ⑦高自殺/Ver/基本資料修改註記 3 欄，
// 合計 146。colId 與欄名脫鉤（比照 STUDENTS_DEFAULT_COLS 慣例），但盡量取有意義的英文縮寫方便
// 除錯時人眼辨識。
function genTestsDefaultCols() {
  const cols = [];
  const push = (id, name, extra) => cols.push(Object.assign({ id, name }, extra || {}));
  const pad2 = (n) => String(n).padStart(2, '0');

  // ① 基本資料 + 效度（19 欄）
  push('test_date', '施測日期');
  push('stu_id', '學號', { required: true, locked: true, width: 110 });
  push('dept', '系所');
  push('name_zh', '姓名', { required: true });
  push('gender', '性別');
  push('grade', '年級');
  push('class_name', '班級');
  push('dob', '出生日期');
  push('edu_type', '學制類別');
  push('admit_type', '入學方式');
  push('identity', '身分別');
  push('dorm', '住宿狀況');
  push('parents_marriage', '父母婚姻狀況');
  push('dad_edu', '父親教育程度');
  push('mom_edu', '母親教育程度');
  push('consent_test', '是否同意施測');
  push('phone', '電話');
  push('email', 'Email');
  push('validity', '效度');

  // ② xxavg（19 欄）
  ['AL', 'D1', 'D2', 'F1', 'F2', 'F3', 'F4'].forEach((code) => push(`${code.toLowerCase()}avg`, `${code}avg`));
  for (let i = 1; i <= 12; i++) push(`s${pad2(i)}avg`, `S${pad2(i)}avg`);

  // ③ 原始分數（19 欄）
  ['AL', 'D1', 'D2', 'F1', 'F2', 'F3', 'F4'].forEach((code) => push(code.toLowerCase(), code));
  for (let i = 1; i <= 12; i++) push(`s${pad2(i)}`, `S${pad2(i)}`);

  // ④ PR（20 欄）
  push('vkpr', 'VKPR');
  push('alpr', 'ALPR');
  push('d1pr', 'D1PR');
  push('d2pr', 'D2PR');
  ['F1', 'F2', 'F3', 'F4'].forEach((code) => push(`${code.toLowerCase()}pr`, `${code}PR`));
  for (let i = 1; i <= 12; i++) push(`s${pad2(i)}pr`, `S${pad2(i)}PR`);

  // ⑤ item1~item53（53 欄）
  for (let i = 1; i <= 53; i++) push(`item${i}`, `item${i}`);

  // ⑥ ALL + SxxL（13 欄）
  push('all_score', 'ALL');
  for (let i = 1; i <= 12; i++) push(`s${pad2(i)}l`, `S${pad2(i)}L`);

  // ⑦ 尾段（3 欄）
  push('high_suicide', '高自殺');
  push('ver', 'Ver');
  push('basic_edit_note', '基本資料修改註記:');

  return cols;
}

// v209：導師名冊——5+1 欄，欄位順序照任務規格「學院／系所／班級簡稱／導師／導師Email」，
// 班級簡稱為鎖定主鍵欄（比照 students 的學號 locked）；另加一個「備註」欄供同步時標記
// 「系主任（博士班預設）」等提示文字（見前端 _ftAssembleTutorSyncRows）。
const TUTORS_DEFAULT_COLS = [
  { id: 'college', name: '學院' },
  { id: 'dept', name: '系所' },
  { id: 'class_abbr', name: '班級簡稱', required: true, locked: true, width: 140 },
  { id: 'tutor_name', name: '導師' },
  { id: 'tutor_email', name: '導師Email' },
  { id: 'note', name: '備註', width: 160 },
];

function defaultSchema(sheet) {
  if (sheet === 'students') {
    return { version: 1, cols: STUDENTS_DEFAULT_COLS.map((c) => ({ ...c })) };
  }
  if (sheet === 'tests') {
    return { version: 1, cols: genTestsDefaultCols() };
  }
  if (sheet === 'gforms') {
    return { version: 1, cols: GFORMS_DEFAULT_COLS.map((c) => ({ ...c })) };
  }
  if (sheet === 'tutors') {
    return { version: 1, cols: TUTORS_DEFAULT_COLS.map((c) => ({ ...c })) };
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

// ── ftGetSheet：回傳 { schema, rows, judged }。缺檔一律回預設 schema／空 rows（尚未建立資料的
//    新學期）。judged（v223 D2 評判記憶，見下方 ftSaveRows 檔頭）原樣回傳，缺欄位視為空陣列——
//    僅 tests／gforms 兩個 sheet 實際會有內容，其餘 sheet 一律是空陣列。──
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
  const judged = (rowsData && Array.isArray(rowsData.judged)) ? rowsData.judged : [];

  return { schema, rows, judged };
}

// ── v223 D2：評判記憶（judged）條目驗證——前端整份陣列取代送來（比照 rows 慣例），本函式只做
//    最基本的形狀檢查，過濾掉格式不對的項目（不整批 throw 中止存檔，避免單一髒項目擋掉整次
//    儲存；stuId 不得為空——沒有學號無法比對，判定為攻擊面/雜訊一律捨棄）。──
function sanitizeJudgedEntries(judged) {
  if (!Array.isArray(judged)) return null;
  return judged
    .filter((j) => j && typeof j.stuId === 'string' && j.stuId.trim()
      && (typeof j.hash === 'string' || typeof j.hash === 'number')
      && typeof j.deletedAt === 'string')
    .map((j) => ({ stuId: j.stuId, hash: String(j.hash), deletedAt: j.deletedAt }));
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
//    最終列陣列整包送來即可，不需要獨立的後端 merge action（減少攻擊面，CLAUDE.md 資安原則 1）。
//    v208：新增列層級 excluded 旗標（布林，非 cells 內的資料值）——供 Google表單 tab 同學號多筆
//    填寫「選主條目」使用：非主條目列標 excluded:true（前端半透明/刪除線顯示，不刪資料，供日後
//    整合 tab 只取主條目）。三個 sheet 共用同一個欄位，非 gforms 的列一律 excluded:false。
//    v213：新增列層級 deleted/deletedAt/deletedBy 旗標——供「每列軟刪除」使用：既有列（帶 _id）
//    可標 deleted:true 送來，本 action 計算刪除時間／操作者（若該列已是 deleted:true，保留原
//    deletedAt/deletedBy，不因重複儲存而覆蓋——同一次刪除只記一次時間/操作者）；deleted:false
//    （或未帶）一律清空 deletedAt/deletedBy。「新列（_id 尚未存在）且已標刪除」直接不送——那本來
//    就等於沒新增過，見前端 _ftSaveEdit 檔頭說明。
//    v216：標 deleted:true 送來的列，本次存檔即從資料檔「物理移除」（不再是永久保留的軟刪除）——
//    deletedAt/deletedBy 只用於本次回傳值（前端顯示成功訊息／稽核摘要用），不會被寫入持久化
//    檔案，因為該列本身就不會出現在寫入的 rows 陣列裡。
//    v223 D2：可選帶 params.judged（評判記憶，見前端 _ftBuildJudgedEntries 檔頭說明）——前端整份
//    陣列取代送來（比照 rows 慣例，不做差異式 op），未帶（undefined）視為「本次存檔不動評判記憶」
//    （沿用既有值，例如 students／tutors 兩個 sheet 從不送此參數）；帶空陣列 [] 則明確清空（對應
//    「全部刪除並儲存」語意，見 _ftIsFullClearSave）。──
function ftSaveRows(db, params, ctx, userEmail) {
  const semester = params && params.semester;
  const sheet = params && params.sheet;
  const rows = params && params.rows;
  assertSemesterId(semester);
  assertSheetAllowed(sheet);
  if (!Array.isArray(rows)) throw new Error('ftSaveRows: rows 須為陣列');
  const judgedIncoming = (params && Object.prototype.hasOwnProperty.call(params, 'judged'))
    ? sanitizeJudgedEntries(params.judged) : undefined;
  const historical = isHistoricalSemester(db, ctx, semester);

  const result = db.transaction(() => {
    const dir = semesterDir(semester);
    const path = `${dir}/${sheetFileName(sheet)}`;
    const { fileId, data: loaded } = readExistingOrNull(
      db, path, ctx, `ftSaveRows: 讀取 ${path} 失敗，已中止寫入以保護資料`
    );
    const oldById = new Map();
    const existingJudged = (loaded && Array.isArray(loaded.judged)) ? loaded.judged : [];
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
      const excluded = !!(r && r.excluded === true);
      const deleted = !!(r && r.deleted === true);
      const wasDeleted = !!(old && old.deleted === true);
      const deletedAt = deleted ? ((wasDeleted && old.deletedAt) || now) : null;
      const deletedBy = deleted ? ((wasDeleted && old.deletedBy) || userEmail || null) : null;
      return { _id: id, _createdAt: (old && old._createdAt) || now, _updatedAt: now, cells, excluded, deleted, deletedAt, deletedBy };
    });
    // v216：deleted:true 的列本次存檔即物理移除，不寫入持久化檔案（見上方函式頭註解）。
    const finalRows = nextRows.filter((r) => r.deleted !== true);
    const judged = judgedIncoming !== undefined ? judgedIncoming : existingJudged;
    const data = { rows: finalRows, judged, updatedAt: now, updatedBy: userEmail || null };
    writeBack(db, fileId, dir, sheetFileName(sheet), data, ctx);
    const deletedCount = nextRows.filter((r) => r.deleted === true).length;
    return { ok: true, count: finalRows.length, updatedAt: now, deletedCount };
  }).immediate();

  return { ...result, historical };
}

// ── ftTutorSyncFetch：唯讀讀取同機 tutorsys 的 classes.json／departments.json（投影後的最小
//    欄位集，見 tutorsysSync.js 檔頭）。純讀取、不寫入，因此不需要 semester/db 參數——tutorsys
//    的班級/系所本身不分學期（見 memory project_freshman_test.md「tutorsys 資料結構」：per-term
//    只有 records_<semesterId>.json 有分，classes/departments 是 tutorsys 目前現況的單一快照）。
//    「與哪個學期同步」是前端的事（同步組裝時要另外載入該學期的 students sheet 找博士班班級／
//    學院猜測配對，見前端 _ftAssembleTutorSyncRows），本 action 只負責回傳 tutorsys 原始快照。
//    TUTORSYS_STORE_DIR 未設定時直接拋錯，dispatch.js 讓它自然變成業務錯誤（前端顯示「未設定」）。──
function ftTutorSyncFetch(tutorsysStoreDir) {
  return tutorsysSync.fetchTutorsysSnapshot(tutorsysStoreDir);
}

module.exports = {
  ROOT_DIR,
  SHEETS,
  LOCKED_COL_ID,
  STUDENTS_DEFAULT_COLS,
  GFORMS_DEFAULT_COLS,
  TUTORS_DEFAULT_COLS,
  genTestsDefaultCols,
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
  ftTutorSyncFetch,
  sanitizeJudgedEntries,
};
