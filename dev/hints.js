// dev/hints.js — 小技巧輪播模組（拆 index.html 絞殺者第二刀之 2，v245）。
// 登入畫面／PIN 解鎖畫面共用的小技巧輪播卡＋全覽 Modal：四語言（華語／台語／客語／English／輪流）
// 切換、每 15 秒自動輪播、hover 暫停。單一來源固定本檔；index.html 以
// <script src="hints.js"></script> 載入（放在 changelog.js 之後）。頂層只有 const/let/function
// 宣告、無立即執行語句，載入順序不影響行為。

// ══════════════════════════════════════════════
//  v219：小技巧輪播（登入畫面／PIN 解鎖畫面共用；banner「💡 小技巧」按鈕開全覽 Modal）
// ══════════════════════════════════════════════
const TC_INTERVAL_SEC = 15;

// A 級（14 則，附簡約 inline SVG，viewBox 0 0 60 60，單色 currentColor 線條）
const TC_ICONS = {
  pin:        '<path d="M30 9c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16z"/><circle cx="30" cy="25" r="6"/>',
  drag:       '<circle cx="21" cy="15" r="3.2"/><circle cx="39" cy="15" r="3.2"/><circle cx="21" cy="30" r="3.2"/><circle cx="39" cy="30" r="3.2"/><circle cx="21" cy="45" r="3.2"/><circle cx="39" cy="45" r="3.2"/>',
  shiftcheck: '<rect x="7" y="23" width="15" height="15" rx="3"/><polyline points="10,30.5 14,34.5 19,26"/><line x1="24" y1="30.5" x2="35" y2="30.5"/><polyline points="31,26.5 35.5,30.5 31,34.5"/><rect x="38" y="23" width="15" height="15" rx="3"/><polyline points="41,30.5 45,34.5 50,26"/>',
  autosave:   '<path d="M19 41a10.5 10.5 0 0 1-2-20.8A13.5 13.5 0 0 1 43 22a9.3 9.3 0 0 1-2 19H19z"/><polyline points="23,30.5 28,35.5 38,24"/>',
  draft:      '<path d="M16 9h28v42l-14-8.5-14 8.5z"/><line x1="22" y1="20" x2="38" y2="20"/><line x1="22" y1="28" x2="38" y2="28"/>',
  attach:     '<rect x="8" y="30" width="26" height="18" rx="3" stroke-dasharray="4 4"/><line x1="21" y1="32" x2="21" y2="44"/><polyline points="15,39 21,45 27,39"/><path d="M46 12v22a8 8 0 0 1-16 0V15a5 5 0 0 1 10 0v17a2 2 0 0 1-4 0V18"/>',
  pdf2img:    '<path d="M9 6h15l7 7v27H9z"/><path d="M24 6v7h7"/><line x1="14" y1="21" x2="26" y2="21"/><line x1="14" y1="27" x2="26" y2="27"/><line x1="37" y1="25" x2="37" y2="37"/><polyline points="31,31 37,37 43,31"/><rect x="24" y="41" width="27" height="16" rx="2"/><circle cx="31" cy="47" r="2.4"/><polyline points="26,53 34,47 42,53 46,49"/>',
  imgpaste:   '<rect x="9" y="9" width="30" height="24" rx="2"/><circle cx="17" cy="17" r="3"/><polyline points="11,30 23,21 29,27 37,16"/><path d="M39 39l10-2-2 10-3-3-6 6-2-2 6-6z"/>',
  dblcal:     '<rect x="8" y="11" width="34" height="30" rx="3"/><line x1="8" y1="20" x2="42" y2="20"/><line x1="17" y1="6" x2="17" y2="15"/><line x1="33" y1="6" x2="33" y2="15"/><circle cx="44" cy="44" r="3"/><circle cx="44" cy="44" r="8" stroke-dasharray="3 4"/><circle cx="44" cy="44" r="13" stroke-dasharray="3 5"/>',
  recycle:    '<path d="M15 18h30l-2.5 30a3 3 0 0 1-3 2.8H20.5a3 3 0 0 1-3-2.8z"/><line x1="10" y1="18" x2="50" y2="18"/><line x1="24" y1="11" x2="36" y2="11"/><line x1="24" y1="11" x2="24" y2="18"/><line x1="36" y1="11" x2="36" y2="18"/><path d="M20 40a10 10 0 0 1 17-7"/><polyline points="34,29 37,33 32,35"/>',
  bgjob:      '<rect x="8" y="16" width="44" height="28" rx="4"/><line x1="15" y1="25" x2="34" y2="25"/><rect x="15" y="32" width="30" height="5" rx="2.5"/><rect x="15" y="32" width="18" height="5" rx="2.5" fill="currentColor" stroke="none"/>',
  indent:     '<line x1="9" y1="14" x2="51" y2="14"/><line x1="19" y1="30" x2="51" y2="30"/><line x1="29" y1="46" x2="51" y2="46"/><polyline points="9,22 16,30 9,38"/>',
  mention:    '<circle cx="24" cy="24" r="14"/><circle cx="24" cy="24" r="5.5"/><path d="M29.5 24v4.5a5.5 5.5 0 0 0 11 0v-4.5a16.5 16.5 0 1 0-7 13.6"/><line x1="38" y1="38" x2="50" y2="50"/>',
  dblimg:     '<rect x="7" y="8" width="28" height="22" rx="2"/><circle cx="14" cy="15" r="2.6"/><polyline points="9,27 20,19 26,24 33,15"/><circle cx="44" cy="44" r="3"/><circle cx="44" cy="44" r="8" stroke-dasharray="3 4"/><circle cx="44" cy="44" r="13" stroke-dasharray="3 5"/>',
};

// 22 則（順序固定；輪播起始位置隨機挑選，但播放順序照本陣列順序前進/後退）。
// v241 多語：title/desc＝華語（預設）；tw＝台語（台文漢字）、hk＝客語（四縣腔用字）、en＝English，
// 各為 { t, d }。翻譯由 Claude 撰寫、供親切感與趣味用途；技術詞（Ctrl+V、PDF、Excel…）保留原文。
const TC_HINTS = [
  { id: 1,  icon: 'pin',        title: '選單釘選',        desc: '左側選單項目左緣的細條可「釘選」，分類收合後釘選項目仍會顯示。',
    tw: { t: '選單釘牢', d: '倒爿選單項目倚左爿彼條細條仔會當「釘牢」，分類收起來了後，釘牢的項目猶原看會著。' },
    hk: { t: '選單釘等', d: '左片選單項目左脣个細條仔做得「釘等」，分類收攏以後，釘等个項目還係看得到。' },
    en: { t: 'Pin menu items', d: 'Click the thin strip on a sidebar item\'s left edge to pin it — pinned items stay visible even when the category is collapsed.' } },
  { id: 2,  icon: 'drag',       title: '選單拖曳排序',    desc: '滑過選單項目會出現 ⠿ 把手，拖曳即可排序，順序會跨裝置同步。',
    tw: { t: '選單搝來排', d: '滑鼠掃過選單項目會出現 ⠿ 手把，搝咧徙位就會當重排，順序閣會逐台裝置同步。' },
    hk: { t: '選單拉等排', d: '滑鼠掃過選單項目會出現 ⠿ 手把，拉等徙位就做得重排，順序還會逐隻裝置同步。' },
    en: { t: 'Drag to reorder menu', d: 'Hover a sidebar item to reveal the ⠿ handle, then drag to reorder — the order syncs across devices.' } },
  { id: 3,  icon: 'shiftcheck', title: 'Shift 範圍勾選',  desc: '所有勾選清單按住 Shift 點擊，可一次勾選整段範圍。',
    tw: { t: 'Shift 規段勾', d: '所有的勾選清單，揤牢 Shift 閣點落去，就會當一擺勾規段範圍。' },
    hk: { t: 'Shift 歸段勾', d: '所有个勾選清單，捺等 Shift 再點下去，就做得一擺勾歸段範圍。' },
    en: { t: 'Shift range-select', d: 'In any checklist, hold Shift and click to tick a whole range at once.' } },
  { id: 4,  icon: 'autosave',   title: '表單自動備援',    desc: '表單打到一半不怕丟：晤談記錄、初談表、結案評估、轉銜學生初評、寫信等表單每 5 秒自動在本機暫存草稿，意外重新整理或系統強制更新後，重新開啟該表單即可還原。每 30 秒還會同步到伺服器帳號底下，換電腦登入也能還原。',
    tw: { t: '表單自動備份', d: '表單拍一半免驚無去：晤談紀錄、初談表、結案評估、轉銜初評、寫批信這寡表單，逐 5 秒仔會家己共草稿暫存佇本機，若拄著袂細膩重整抑是系統強制更新，才閣打開仝一張表單就會當復原。逐 30 秒閣會共款同步去伺服器帳戶底下，換電腦登入嘛會當復原。' },
    hk: { t: '表單自動備份', d: '表單打一半毋使驚無忒：晤談紀錄、初談表、結案評估、轉銜初評、寫信這兜表單，逐 5 秒自家會共草稿暫存在本機，若係堵到無細義重整抑係系統強制更新，再打開共一張表單就做得復原。逐 30 秒還會共下同步去伺服器帳戶底背，換電腦登入也做得復原。' },
    en: { t: 'Auto form backup', d: 'Never lose a half-finished form: interview records, intake forms, closure assessments, transfer assessments, and compose-mail forms all auto-save a local draft every 5 seconds — reopen the same form after an accidental refresh or a forced update to restore it. Every 30 seconds it also syncs to your account on the server, so you can restore it after logging in on a different computer.' } },
  { id: 5,  icon: 'draft',      title: '暫存草稿至待辦',  desc: '表單填一半可存成待辦事項，之後按「繼續編輯」完整還原。',
    tw: { t: '草稿寄佇待辦', d: '表單寫一半會當存做待辦事項，了後揤「繼續編輯」就規份還原。' },
    hk: { t: '草稿寄在待辦', d: '表單寫一半做得存做待辦事項，過後捺「繼續編輯」就歸份還原。' },
    en: { t: 'Save drafts as to-dos', d: 'Half-finished forms can be saved as a to-do; hit “Continue editing” later to restore everything.' } },
  { id: 6,  icon: 'attach',     title: '拖曳／貼上附件',  desc: '圖片檔案可直接拖曳進來，或用 Ctrl+V 貼到任何文字框變成附件。',
    tw: { t: '搝入／貼上附件', d: '圖片佮檔案會當直接搝入來，抑是用 Ctrl+V 貼佇任何文字框，就變做附件。' },
    hk: { t: '拉入／貼上附件', d: '圖片同檔案做得直接拉入來，抑係用 Ctrl+V 貼在任何文字框，就變做附件。' },
    en: { t: 'Drag or paste attachments', d: 'Drop image files straight in, or Ctrl+V into any text box to turn them into attachments.' } },
  { id: 7,  icon: 'pdf2img',    title: 'PDF 轉圖片',      desc: '左側選單內建 PDF 轉圖片工具，全程在你的電腦內完成，不會上傳。',
    tw: { t: 'PDF 轉圖', d: '倒爿選單有 PDF 轉圖片的工具，規個過程攏佇你的電腦內底做，袂傳出去。' },
    hk: { t: 'PDF 轉圖', d: '左片選單有 PDF 轉圖片个工具，歸個過程全在你个電腦肚做，毋會傳出去。' },
    en: { t: 'PDF to images', d: 'The built-in PDF-to-image tool runs entirely on your computer — nothing gets uploaded.' } },
  { id: 8,  icon: 'imgpaste',   title: '圖片編輯 Ctrl+V', desc: '圖片編輯頁可直接貼上剪貼簿圖片編輯，成品能一鍵複製回剪貼簿。',
    tw: { t: '圖片編輯 Ctrl+V', d: '圖片編輯頁會當直接貼剪貼簿的圖來改，改好一鍵閣複製轉去剪貼簿。' },
    hk: { t: '圖片編輯 Ctrl+V', d: '圖片編輯頁做得直接貼剪貼簿个圖來改，改好一鍵再複製轉去剪貼簿。' },
    en: { t: 'Image editor Ctrl+V', d: 'Paste clipboard images straight into the editor, then copy the result back with one click.' } },
  { id: 9,  icon: 'dblcal',     title: '預約點兩下',      desc: '空間預約表空白格點兩下直接新增，預約卡片可拖曳改期。',
    tw: { t: '預約點兩下', d: '空間預約表的空白格仔點兩下就直接新增，預約卡片搝咧徙就會當改期。' },
    hk: { t: '預約點兩下', d: '空間預約表个空白格仔點兩下就直接新增，預約卡片拉等徙就做得改期。' },
    en: { t: 'Double-click to book', d: 'Double-click an empty slot in the booking grid to add one; drag booking cards to reschedule.' } },
  { id: 10, icon: 'recycle',    title: '資源回收桶',      desc: '刪錯的個案或紀錄會保留 30 天，可隨時復原。',
    tw: { t: '資源回收桶', d: '刪毋著的個案抑是紀錄會留 30 工，隨時攏會當復原。' },
    hk: { t: '資源回收桶', d: '刪毋著个個案抑係紀錄會留 30 日，隨時都做得復原。' },
    en: { t: 'Recycle bin', d: 'Deleted cases and records are kept for 30 days and can be restored anytime.' } },
  { id: 11, icon: 'bgjob',      title: '背景工作卡片',    desc: '頂端進度小卡可點擊，直接跳到工作分頁看細節。',
    tw: { t: '背景工作卡片', d: '頂懸的進度小卡會當點，直接跳去工作分頁看詳細。' },
    hk: { t: '背景工作卡片', d: '頂高个進度細卡做得點，直接跳去工作分頁看詳細。' },
    en: { t: 'Background job cards', d: 'Click the progress card at the top to jump straight to the jobs tab for details.' } },
  { id: 12, icon: 'indent',     title: '清單縮排',        desc: '富文字清單按 Tab／Shift+Tab 可調整縮排層級。',
    tw: { t: '清單縮排', d: '富文字的清單揤 Tab／Shift+Tab，會當調整縮排的層。' },
    hk: { t: '清單縮排', d: '富文字个清單捺 Tab／Shift+Tab，做得調整縮排个層。' },
    en: { t: 'List indenting', d: 'In rich-text lists, press Tab / Shift+Tab to change indent levels.' } },
  { id: 13, icon: 'mention',    title: '@提及拼音搜尋',   desc: '@人名可用拼音或台語羅馬字首字母模糊搜尋。',
    tw: { t: '@人名羅馬字揣人', d: '@人名會當用拼音抑是台羅頭字母，模糊揣人。' },
    hk: { t: '@人名拼音尋人', d: '@人名做得用拼音抑係台語羅馬字頭字母，模糊尋人。' },
    en: { t: '@mention fuzzy search', d: 'Type @name and search by pinyin or Taiwanese-romanization initials.' } },
  { id: 14, icon: 'dblimg',     title: '雙擊改圖',        desc: '富文字裡的圖片雙擊即可重新編輯。',
    tw: { t: '點兩下改圖', d: '富文字內底的圖，點兩下就會當閣再編輯。' },
    hk: { t: '點兩下改圖', d: '富文字肚个圖，點兩下就做得再編輯。' },
    en: { t: 'Double-click to edit images', d: 'Double-click any image in rich text to re-open it in the editor.' } },
  { id: 15, emoji: '🧬', title: '家系圖',           desc: '自訂元件庫可重複使用，✨ 一鍵美化排版，Space+拖曳可平移畫布。',
    tw: { t: '家系圖', d: '家己訂的元件庫會當重複用，✨ 一鍵美化排版，Space+搝會當徙畫布。' },
    hk: { t: '家系圖', d: '自家訂个元件庫做得重複用，✨ 一鍵美化排版，Space+拉做得徙畫布。' },
    en: { t: 'Genogram', d: 'Reuse your custom component library, ✨ auto-beautify the layout, and pan the canvas with Space+drag.' } },
  { id: 16, emoji: '📊', title: '新生心測試算表',   desc: '可直接貼上 Excel 多列多欄，Ctrl+Z／Y 逐步復原重做。',
    tw: { t: '新生心測試算表', d: '會當直接貼 Excel 規片的資料落去，Ctrl+Z／Y 一步一步復原重做。' },
    hk: { t: '新生心測試算表', d: '做得直接貼 Excel 歸片个資料落去，Ctrl+Z／Y 一步一步復原重做。' },
    en: { t: 'Freshman test sheet', d: 'Paste multi-row Excel data directly; Ctrl+Z / Y steps through undo and redo.' } },
  { id: 17, emoji: '📅', title: '日曆反向匯入',     desc: 'Google 日曆端新增的事件可一鍵匯入成系統預約。',
    tw: { t: '日曆倒頭匯入', d: 'Google 日曆遐新增的事件，一鍵就會當匯入來變系統的預約。' },
    hk: { t: '日曆倒轉匯入', d: 'Google 日曆該片新增个事件，一鍵就做得匯入來變系統个預約。' },
    en: { t: 'Reverse calendar import', d: 'Events added on the Google Calendar side can be imported as system bookings in one click.' } },
  { id: 18, emoji: '📬', title: '身心調適假',       desc: '選單項目旁的小圖示可直接從信箱擷取假單。',
    tw: { t: '身心調適假', d: '選單項目邊仔的小圖示，會當直接對信箱掠假單入來。' },
    hk: { t: '身心調適假', d: '選單項目脣个細圖示，做得直接對信箱擷假單入來。' },
    en: { t: 'Wellness leave', d: 'The small icon next to the menu item pulls leave forms straight from the mailbox.' } },
  { id: 19, emoji: '🔀', title: '案號管理',         desc: '個案合併遷移與主案號對調（管理者），含 dry-run 檢核。',
    tw: { t: '案號管理', d: '個案合併遷徙佮主案號對換（管理者），閣有 dry-run 通檢查。' },
    hk: { t: '案號管理', d: '個案合併遷徙同主案號對換（管理者），還有 dry-run 好檢查。' },
    en: { t: 'Case-number admin', d: 'Merge or migrate cases and swap primary case numbers (admin), with a dry-run check.' } },
  { id: 20, emoji: '🖨', title: '心測報告',         desc: '個人／導師／系主任／院長四種報告可批次列印＋Excel 匯出。',
    tw: { t: '心測報告', d: '個人／導師／系主任／院長四種報告，攏會當規批印＋匯出 Excel。' },
    hk: { t: '心測報告', d: '個人／導師／系主任／院長四種報告，全做得歸批印＋匯出 Excel。' },
    en: { t: 'Test reports', d: 'Four report types (student, tutor, chair, dean) support batch printing and Excel export.' } },
  { id: 21, icon: 'dblcal',     title: '差勤總覽查打卡',  desc: '我的差勤 → 差勤總覽可用日期區間查詢自己的所有打卡紀錄，快捷鈕一鍵切今天/本週/本月。',
    tw: { t: '差勤總覽揣打卡', d: '我的差勤 → 差勤總覽會當用日期區間揣家己所有的打卡紀錄，快捷鈕一鍵就會當切今仔日/本禮拜/本月。' },
    hk: { t: '差勤總覽尋打卡', d: '我的差勤 → 差勤總覽做得用日期區間尋自家所有个打卡紀錄，快捷鈕一鍵就做得切今仔日/本禮拜/本月。' },
    en: { t: 'Attendance overview lookup', d: 'My Attendance → Attendance Overview lets you query your own punch records by date range; quick buttons switch to Today/This week/This month in one click.' } },
  { id: 22, emoji: '📌', title: '初談表暫不指派',    desc: '初談表第七項若尚無定案，可選「暫不指派」先存表單——會建立一則不可封存的「待派案」提醒，指派主責後自動消除；一次性服務個案選「一次性服務，不指派主責」即不需指派。',
    tw: { t: '初談表且莫指派', d: '初談表第七項若猶未定案，會使揀「且莫指派」先共表單存起來——會有一則袂當封存的「待派案」提醒，等指派主責了後才會家己消掉；一擺性服務的個案揀「一擺性服務，免指派主責」就免指派。' },
    hk: { t: '初談表暫毋指派', d: '初談表第七項若還吂定案，做得揀「暫毋指派」先將表單存起來——會有一則毋做得封存个「待派案」提醒，等指派主責以後正會自家消掉；一擺性服務个個案揀「一擺性服務，毋使指派主責」就毋使指派。' },
    en: { t: 'Defer counselor assignment', d: 'If item 7 on the intake form isn\'t decided yet, pick "Defer assignment" to save the form now — this creates an unarchivable "assignment pending" reminder that clears automatically once a counselor is assigned. For one-time-service cases, pick "One-time service, no assignment needed" instead.' } },
];

// ── v241 小技巧多語 ──────────────────────────────────────────────
// 語言偏好存 localStorage（裝置層級）：小技巧卡也出現在登入／PIN 畫面，當時還拿不到伺服器端
// 使用者偏好，故刻意不走 syncUserPref_。'mix'＝輪流模式：每一則依索引輪流換語言（華→台→客→英）。
const TC_LANG_ORDER = ['zh', 'tw', 'hk', 'en', 'mix'];
const TC_LANG_META = {
  zh:  { chip: '華',  name: '華語',    header: '💡 小技巧' },
  tw:  { chip: '台',  name: '台語',    header: '💡 小撇步' },
  hk:  { chip: '客',  name: '客語',    header: '💡 好步數' },
  en:  { chip: 'EN',  name: 'English', header: '💡 Tips' },
  mix: { chip: '輪',  name: '輪流',    header: '💡 小技巧' },
};
function _tcLangGet() {
  try { const v = localStorage.getItem('scc_tc_lang'); return TC_LANG_ORDER.includes(v) ? v : 'zh'; } catch (_) { return 'zh'; }
}
function _tcLangSet(v) { try { localStorage.setItem('scc_tc_lang', v); } catch (_) {} }
// v241 修正：語言偏好除了 localStorage（裝置層級，登入前的登入/PIN 畫面用），登入後同步寫進
// 帳號偏好（syncUserPref_ tcLang），跨裝置記住；登入時 applyDrivePrefs 以帳號值為準回寫本機。
// 所有切換入口（輪播卡 chip／全覽 modal 語言列／偏好設定 radio）一律走本函式。
function tcSetLang(v) {
  if (!TC_LANG_ORDER.includes(v)) return;
  _tcLangSet(v);
  try { if (typeof syncUserPref_ === 'function' && currentUser?.email) syncUserPref_({ tcLang: v }); } catch (_) {}
  Object.keys(_tcState).forEach(id => tcRenderMount(id));
  if (document.getElementById('tc-modal')?.style.display === 'flex') tcOpenModal();
  const radio = document.querySelector('input[name="pref-tc-lang"][value="' + v + '"]');
  if (radio) radio.checked = true;
}
// 取得某一則在目前語言設定下要顯示的 { t, d }。mix 模式依該則索引輪流（同一畫面前後則語言不同，
// 輪播時語言也跟著換，符合「輪流」的趣味）；tw/hk/en 缺譯時回落華語。
function tcHintText(h, idx) {
  let lang = _tcLangGet();
  if (lang === 'mix') lang = ['zh', 'tw', 'hk', 'en'][((idx % 4) + 4) % 4];
  if (lang !== 'zh' && h[lang] && h[lang].t) return { t: h[lang].t, d: h[lang].d };
  return { t: h.title, d: h.desc };
}
// 語言切換：輪播卡上的小 chip（華→台→客→EN→輪循環），切換後所有掛載點與全覽 modal 立即重繪。
function tcCycleLang(mountId) {
  const cur = _tcLangGet();
  const next = TC_LANG_ORDER[(TC_LANG_ORDER.indexOf(cur) + 1) % TC_LANG_ORDER.length];
  tcSetLang(next);
  const st = mountId && _tcState[mountId];
  if (st) st.countdown = TC_INTERVAL_SEC; // 使用者正在互動，重設倒數避免馬上被輪播走
}

let _tcState = {};       // mountId -> { index, countdown, paused }
let _tcTickTimer = null; // 全域 1 秒 ticker（畫面不可見／分頁隱藏時該 tick 直接跳過，不推進）

function tcSvg(iconKey) {
  return `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${TC_ICONS[iconKey] || ''}</svg>`;
}

function tcInit(mountId) {
  const el = document.getElementById(mountId);
  if (!el) return;
  _tcState[mountId] = { index: Math.floor(Math.random() * TC_HINTS.length), countdown: TC_INTERVAL_SEC, paused: false };
  el.addEventListener('mouseenter', () => { const s = _tcState[mountId]; if (s) s.paused = true; });
  el.addEventListener('mouseleave', () => { const s = _tcState[mountId]; if (s) s.paused = false; });
  tcRenderMount(mountId);
  if (!_tcTickTimer) _tcTickTimer = setInterval(tcTick, 1000);
}

function tcRenderMount(mountId) {
  const el = document.getElementById(mountId);
  const st = _tcState[mountId];
  if (!el || !st) return;
  const h = TC_HINTS[st.index];
  const txt = tcHintText(h, st.index); // v241：依語言偏好取字（mix 模式依索引輪流）
  const langMeta = TC_LANG_META[_tcLangGet()];
  el.innerHTML = `
    <div class="tc-icon${h.emoji ? ' tc-icon-emoji' : ''}">${h.emoji ? h.emoji : tcSvg(h.icon)}</div>
    <div class="tc-body">
      <div class="tc-title">${escHtml(txt.t)}</div>
      <div class="tc-desc">${escHtml(txt.d)}</div>
    </div>
    <div class="tc-nav">
      <div class="tc-nav-btns">
        <button type="button" onclick="tcAdvance('${mountId}',-1)" aria-label="上一則">‹</button>
        <button type="button" onclick="tcAdvance('${mountId}',1)" aria-label="下一則">›</button>
        <button type="button" onclick="tcCycleLang('${mountId}')" title="切換語言：華語／台語／客語／English／輪流（目前：${langMeta.name}）" aria-label="切換語言" style="font-size:.68rem;letter-spacing:0;">${langMeta.chip}</button>
      </div>
      <span class="tc-counter">${st.index + 1}/${TC_HINTS.length}</span>
    </div>`;
}

function tcAdvance(mountId, delta) {
  const st = _tcState[mountId];
  if (!st) return;
  st.index = (st.index + delta + TC_HINTS.length) % TC_HINTS.length;
  st.countdown = TC_INTERVAL_SEC;
  tcRenderMount(mountId);
}

// 每秒檢查一次：分頁不可見（document.visibilityState）或掛載點本身不可見（display:none／祖先隱藏）
// 或滑鼠正 hover 在卡片上時，該掛載點這一 tick 直接跳過、不倒數、不換下一則。
function tcTick() {
  Object.keys(_tcState).forEach(mountId => {
    const st = _tcState[mountId];
    if (!st) return;
    const el = document.getElementById(mountId);
    if (!el) return;
    if (document.visibilityState !== 'visible') return;
    if (el.offsetParent === null) return;
    if (st.paused) return;
    st.countdown -= 1;
    if (st.countdown <= 0) tcAdvance(mountId, 1);
  });
}

function tcOpenModal() {
  // v241：全覽 modal 跟隨語言偏好；mix（輪流）模式下逐則輪流換語言，跟輪播卡同一套規則。
  const lang = _tcLangGet();
  const titleEl = document.getElementById('tc-modal-title');
  if (titleEl) titleEl.textContent = TC_LANG_META[lang].header;
  const langsEl = document.getElementById('tc-modal-langs');
  if (langsEl) {
    langsEl.innerHTML = TC_LANG_ORDER.map(l => `
      <button type="button" onclick="tcSetLang('${l}');tcOpenModal();"
        style="border:1px solid ${l === lang ? '#3182ce' : '#e2e8f0'};background:${l === lang ? '#ebf8ff' : '#fff'};color:${l === lang ? '#2b6cb0' : '#718096'};border-radius:6px;padding:2px 8px;font-size:.74rem;cursor:pointer;${l === lang ? 'font-weight:700;' : ''}">${TC_LANG_META[l].name}</button>`).join('');
  }
  const list = document.getElementById('tc-modal-list');
  if (list) {
    list.innerHTML = TC_HINTS.map((h, i) => {
      const txt = tcHintText(h, i);
      return `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 4px;${i > 0 ? 'border-top:1px solid #e2e8f0;' : ''}">
        <div class="tc-icon${h.emoji ? ' tc-icon-emoji' : ''}" style="width:42px;height:42px;">${h.emoji ? h.emoji : tcSvg(h.icon)}</div>
        <div style="flex:1;min-width:0;">
          <div class="tc-title" style="font-size:.92rem;">${escHtml(txt.t)}</div>
          <div class="tc-desc" style="font-size:.82rem;">${escHtml(txt.d)}</div>
        </div>
      </div>`;
    }).join('');
  }
  const modal = document.getElementById('tc-modal');
  if (modal) modal.style.display = 'flex';
}

function tcCloseModal() {
  const modal = document.getElementById('tc-modal');
  if (modal) modal.style.display = 'none';
}
