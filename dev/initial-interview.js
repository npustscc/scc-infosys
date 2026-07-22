// dev/initial-interview.js — 初次晤談模組（拆 index.html 絞殺者第七刀，v253）。
// 內容為從 index.html 逐字搬出的函式：初次晤談 chip 系統（_iiChipData／_iiInitChipGroup／
// _iiRenderChipGroup／iiChipToggle／iiChipAdd／iiChipRemove／iiProbMainChange／iiSupToggle／
// iiLoadFamilyImage）、服務項目輔助函式（_appendCustomCheckboxII／iiAddCustomServiceOption／
// iiAddDynamicTag／iiToggleTransferCounselor／_iiCollectServiceItems／_iiRestoreServiceItems 等）、
// 初談表開啟／填寫／驗證／儲存（openInitialInterviewPage／_iiPopulateForm／snapshotInitialInterview／
// _checkIIDuplicate／saveInitialInterview／startIIDraftAutosave／stopIIDraftAutosave／clearIIDraft）、
// 舊案延續與沿用既有紀錄（showIiContinuationPanel／confirmIiContinuation／pickRecordAsInitialInterview）、
// 刪除／復原／徹底移除（deleteInitialInterview／restoreInitialInterview／purgeInitialInterview）、
// 列印初談表（printInitialInterview）。
// 頂層無任何執行副作用（只有 function/async function 宣告、let/const 純資料，如 II_PROBLEMS／
// II_SERVICES／II_SUP_RISKS 等選項清單）。函式內部在呼叫時會引用主檔全域可變狀態（casesData／
// configData／currentUser／extraRole／todosData 等，定義仍留在 index.html），以及主檔內其他共用
// 函式（escHtml／setAlert／showPage／showLoading／hideLoading／showCaseDetail／auditLog／showToast／
// bgJobAdd 系列／saveCasesChunks／_configCasesPatch／openDateToSemPrefix／_semKeyBase／
// _dupFindSameSlot／_dupRenderAlert／_dupResolveAtSave／formatCounselorLabel／getRichTextValue／
// setRichTextValue／exitIIForm／_printViaIframe 等），屬 call-time 解析，與其他拆檔模組
// （utils.js／ft-core.js／case-detail.js／case-import.js）使用方式一致。
// 單一來源固定本檔；index.html 以 <script src="initial-interview.js"></script> 載入（放在
// case-import.js 之後、主 inline script 之前，確保這裡的函式先於主程式定義）。

// ══════════════════════════════════════════════
//  初次晤談紀錄表
// ══════════════════════════════════════════════
let _initialInterviewCaseId = null;
let _initialInterviewSem    = null; // which semester's ii is being edited
let _caseDetailActiveSem    = null; // active semester tab on case detail page
let _caseDetailMode         = 'semester'; // 'semester' | 'psychtest'
let _caseDetailPsychIdx     = 0;
let _iiDraftKey  = null;
let _iiDraftTimer = null;

const II_PROBLEMS = [
  { key: '1.自我探索', subs: ['不知存在的意義','不知能力為何','不知興趣為何'] },
  { key: '2.情感困擾', subs: ['不知如何與異性相處','三角問題','失戀','分手問題'] },
  { key: '3.心理疾患或傾向', subs: ['憂鬱症','焦慮症','躁鬱症','強迫症','思覺失調症','人格障礙'] },
  { key: '4.情緒困擾', subs: ['情緒起伏不定','心情差毫無動力','遭遇重大身心創傷'] },
  { key: '5.家庭問題', subs: ['與父母溝通互動有問題','家庭暴力','家教嚴格'] },
  { key: '6.人際互動', subs: ['與室友互動有問題','與同班同學互動有問題','與任課老師互動有問題','與作報告同組同學互動有問題','與其他校內人員互動有問題'] },
  { key: '7.學業與學習', subs: ['轉系','課業成績不良','學習方法有誤','對學習內容無興趣','對學習內容感到茫然'] },
  { key: '8.生涯發展與規劃', subs: ['學非所用','家人對自己的決定不支持','是否需要考研究所','對未來就業的茫然'] },
  { key: '9.生活適應', subs: ['對大學生活適應困難','想念家人','生活經濟來源問題','工讀與課業衝突'] },
  { key: '10.網路沈迷', subs: [] },
  { key: '11.生理健康', subs: [] },
  { key: '12.性別議題', subs: [] },
  { key: '13.其他', subs: [] },
];
const II_SERVICES = [
  '1.諮商輔導/諮詢','2.心理測驗','3.與個案相關資源或關係人聯繫',
  '4.性平行為人性平教育課程','5.性平行為人心理諮商',
  '6.轉介到外部相關資源,持續諮商或治療','7.轉介到外部相關資源，資源連結',
  '8.轉介校內精神科醫師','9.轉介校外精神科醫師','10.責任通報',
  '11.陪同服務','12.內部轉案','13.一次性服務','14.結案','15.其他',
];
const II_SUP_RISKS = [
  '(1)有精神相關議題者','(2)明顯自殺企圖且有具體計畫者或傷害他人','(3)精神疾患發作者',
  '(4)人身安全遭受威脅恐嚇者','(5)BSRS自殺想法2分以上(含2分)',
];
const II_SUP_TOPICS = ['自我探索','情感困擾','家庭關係','心理疾患','情緒困擾','人際關係','學習與課業','生涯探索','生活適應','網路沉迷','生理健康','性別議題'];
const II_SUP_SKILLS = ['自我探索','家庭議題','家庭會談','親職教育','人際困擾','情感困擾','伴侶會談','創傷議題','悲傷與失落','情緒與壓力管理','精神疾病適應','生涯議題','生命與存在議題','性／別與情感關係','親密關係暴力／性別暴力','司法社會工作','學習與課業','生活適應'];

// ── 初次晤談 chip 系統 ────────────────────────────────────────────────────
let _iiChipData = {};
let _iiFamilyImage = null;

function _iiChipFreqKey(gk) { return 'scc_ii_cf_' + (currentUser?.email || '') + '_' + gk; }
function _iiGetFreq(gk) { try { return JSON.parse(localStorage.getItem(_iiChipFreqKey(gk)) || '{}'); } catch { return {}; } }
function _iiSaveFreq(gk, f) { try { localStorage.setItem(_iiChipFreqKey(gk), JSON.stringify(f)); } catch {} }

function _iiInitChipGroup(gk, defOpts, savedSel, savedCustom) {
  const freq = _iiGetFreq(gk);
  // 固定選項保持原始順序在前，自訂 chip 依使用頻率排序在後
  const customOpts = (savedCustom || []).filter(c => !defOpts.includes(c));
  customOpts.sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
  const opts = [...defOpts, ...customOpts];
  _iiChipData[gk] = { opts, sel: new Set(savedSel || []), custom: new Set(savedCustom || []) };
}

function _iiResizeChipInput(el) {
  const m = document.createElement('span');
  m.style.cssText = 'position:fixed;top:-9999px;font-size:.82rem;white-space:pre;';
  m.textContent = el.value || 'X';
  document.body.appendChild(m);
  el.style.width = Math.max(68, m.offsetWidth + 24) + 'px';
  document.body.removeChild(m);
}

function _iiRenderChipGroup(gk, cid) {
  const el = document.getElementById(cid);
  if (!el) return;
  const d = _iiChipData[gk];
  if (!d) return;
  const chips = d.opts.map(opt => {
    const sel = d.sel.has(opt);
    const del = d.custom.has(opt)
      ? `<button class="ii-chip-del" data-gk="${escHtml(gk)}" data-cid="${escHtml(cid)}" data-opt="${escHtml(opt)}" onclick="event.stopPropagation();iiChipRemove(this.dataset.gk,this.dataset.cid,this.dataset.opt)" title="刪除">×</button>`
      : '';
    return `<span class="ii-chip${sel?' ii-chip-sel':''}" data-gk="${escHtml(gk)}" data-cid="${escHtml(cid)}" data-opt="${escHtml(opt)}" onclick="iiChipToggle(this.dataset.gk,this.dataset.cid,this.dataset.opt)">${escHtml(opt)}${del}</span>`;
  }).join('');
  const egk = escHtml(gk), ecid = escHtml(cid);
  el.innerHTML = chips + `<span class="ii-chip-new"><input id="ii-chip-input-${egk}" placeholder="新增…" data-gk="${egk}" data-cid="${ecid}" oninput="_iiResizeChipInput(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();iiChipAdd(this.dataset.gk,this.dataset.cid)}" /><button type="button" data-gk="${egk}" data-cid="${ecid}" onclick="iiChipAdd(this.dataset.gk,this.dataset.cid)">＋</button></span>`;
}

function iiChipToggle(gk, cid, value) {
  const d = _iiChipData[gk]; if (!d) return;
  if (d.sel.has(value)) { d.sel.delete(value); }
  else {
    d.sel.add(value);
    const f = _iiGetFreq(gk); f[value] = (f[value] || 0) + 1; _iiSaveFreq(gk, f);
  }
  _iiRenderChipGroup(gk, cid);
}

function iiChipAdd(gk, cid) {
  const inp = document.getElementById('ii-chip-input-' + gk); if (!inp) return;
  const val = inp.value.trim(); if (!val) return;
  const d = _iiChipData[gk]; if (!d) return;
  if (!d.opts.includes(val)) { d.opts.push(val); d.custom.add(val); }
  d.sel.add(val);
  const f = _iiGetFreq(gk); f[val] = (f[val] || 0) + 1; _iiSaveFreq(gk, f);
  _iiRenderChipGroup(gk, cid);
}

function iiChipRemove(gk, cid, value) {
  const d = _iiChipData[gk]; if (!d) return;
  d.opts = d.opts.filter(o => o !== value); d.sel.delete(value); d.custom.delete(value);
  _iiRenderChipGroup(gk, cid);
}

function iiProbMainChange(idx) {
  const cbs = document.querySelectorAll('input[name="ii-prob-main"]');
  const checked = cbs[idx]?.checked;
  const row = document.getElementById('ii-prob-chips-' + idx);
  if (row) row.classList.toggle('ii-disabled', !checked);
}

function iiSupToggle(radio) {
  const isOld = radio.value === '舊案';
  ['ii-sup-new-section','ii-sup-45-section'].forEach(id =>
    document.getElementById(id)?.classList.toggle('ii-disabled', isOld)
  );
  ['ii-section-seven','ii-section-eight'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.opacity = isOld ? '.4' : ''; el.style.pointerEvents = isOld ? 'none' : ''; }
  });
  const oldRow = document.getElementById('ii-sup-old-counselor-row');
  if (oldRow) oldRow.style.display = isOld ? 'block' : 'none';
  const sevenReq = document.getElementById('ii-section-seven-req');
  const sevenOpt = document.getElementById('ii-section-seven-opt');
  if (sevenReq) sevenReq.style.display = isOld ? 'none' : '';
  if (sevenOpt) sevenOpt.style.display = isOld ? '' : 'none';
  // 自動預填原主責
  if (isOld) {
    const _iiC = casesData.find(x => x.id === _initialInterviewCaseId);
    if (_iiC?.counselorEmail) {
      const _oldSel = document.getElementById('ii-sup-old-counselor');
      if (_oldSel && !_oldSel.value) _oldSel.value = _iiC.counselorEmail;
    }
  }
}

function iiLoadFamilyImage(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    _iiFamilyImage = e.target.result;
    const prev = document.getElementById('ii-family-image-preview');
    if (prev) prev.innerHTML = `<img src="${escHtml(_iiFamilyImage)}" style="max-width:100%;max-height:280px;border-radius:6px;border:1px solid #e2e8f0;" />`;
    const clr = document.getElementById('ii-family-image-clear');
    if (clr) clr.style.display = '';
  };
  reader.readAsDataURL(file);
}

function iiClearFamilyImage() {
  _iiFamilyImage = null;
  const prev = document.getElementById('ii-family-image-preview'); if (prev) prev.innerHTML = '';
  const clr = document.getElementById('ii-family-image-clear'); if (clr) clr.style.display = 'none';
  const inp = document.getElementById('ii-family-image-input'); if (inp) inp.value = '';
}

// ── ii- 服務項目輔助函數 ─────────────────────────────────────────────────
function _appendCustomCheckboxII(listId, cbName, value, checked = false) {
  const el = document.getElementById(listId); if (!el) return;
  const row = document.createElement('div'); row.className = 'custom-opt-row';
  const lbl = document.createElement('label'); lbl.className = 'custom-cb-label';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.name = cbName; cb.value = value;
  if (checked) cb.checked = true;
  lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + value));
  row.appendChild(lbl); el.appendChild(row);
}

function iiAddCustomServiceOption(type) {
  const inputId = 'ii-sp-' + type + '-input';
  const listId  = 'ii-sp-' + type + '-list';
  const cbName  = 'ii-' + type;
  const cfgKey  = type === 'psychtest' ? 'psychTests' : 'referralOptions';
  const inputEl = document.getElementById(inputId);
  const val = inputEl.value.trim(); if (!val) return;
  const existing = [...document.querySelectorAll(`#${listId} input[type="checkbox"]`)].map(cb => cb.value);
  if (existing.includes(val)) { alert(`「${val}」已在清單中。`); return; }
  _appendCustomCheckboxII(listId, cbName, val, true);
  inputEl.value = '';
  if (!configData.customOptions) configData.customOptions = {};
  if (!configData.customOptions[cfgKey]) configData.customOptions[cfgKey] = [];
  if (!configData.customOptions[cfgKey].includes(val)) {
    configData.customOptions[cfgKey].push(val);
    driveUpdateJsonFile(CONFIG_FILE, configData).catch(e => console.warn('儲存自訂選項失敗：', e));
  }
}

function iiAddDynamicTag(type) {
  const cfg = {
    accompany: { inputId:'ii-sp-accompany-input', tagsId:'ii-sp-accompany-tags' },
    other:     { inputId:'ii-sp-other-input',     tagsId:'ii-sp-other-tags' },
  }[type]; if (!cfg) return;
  const inputEl = document.getElementById(cfg.inputId);
  const val = inputEl.value.trim(); if (!val) return;
  const tagsEl = document.getElementById(cfg.tagsId);
  if ([...tagsEl.querySelectorAll('.dynamic-tag')].some(t => t.dataset.name === val)) { alert(`「${val}」已在列表中。`); return; }
  const tag = document.createElement('div');
  tag.className = 'dynamic-tag'; tag.dataset.name = val;
  tag.innerHTML = `${escHtml(val)} <button onclick="this.parentElement.remove()" type="button">×</button>`;
  tagsEl.appendChild(tag); inputEl.value = '';
}

function iiToggleTransferCounselor() {
  const type = document.querySelector('input[name="ii-transfer-type"]:checked')?.value;
  const d = document.getElementById('ii-sp-transfer-counselor');
  if (d) d.style.display = type === '指定輔導人員' ? '' : 'none';
}

function iiToggleSocialReport(cb) {
  const d = document.getElementById('ii-sp-social-report'); if (d) d.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) {
    document.querySelectorAll('input[name="ii-social-report"]').forEach(el => { el.checked = false; });
    const o = document.getElementById('ii-sp-social-report-other'); if (o) { o.value = ''; o.style.display = 'none'; }
  }
}

function iiToggleSocialReportOther(cb) {
  const el = document.getElementById('ii-sp-social-report-other');
  if (el) { el.style.display = cb.checked ? 'inline-block' : 'none'; if (!cb.checked) el.value = ''; }
}

function iiToggleReportOther(cb) {
  const el = document.getElementById('ii-sp-report-other');
  if (el) { el.style.display = cb.checked ? 'inline-block' : 'none'; if (!cb.checked) el.value = ''; }
}

function _iiLoadCustomServiceOptions() {
  const custom = configData?.customOptions || {};
  ['ii-sp-psychtest-list','ii-sp-referral-list'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    [...el.querySelectorAll('.custom-cb-label')].forEach(l => l.remove());
  });
  (custom.psychTests || []).forEach(n => _appendCustomCheckboxII('ii-sp-psychtest-list', 'ii-psychtest', n));
  (custom.referralOptions || []).forEach(n => _appendCustomCheckboxII('ii-sp-referral-list', 'ii-referral', n));
}

const _II_REFERRAL_FIXED = [
  '轉介外部資源（持續諮商或治療）','轉介外部資源（資源連結）','轉介校內精神科醫師',
  '生活輔導組','課外指導組','衛生保健組','原住民資源中心','校內申訴窗口',
  '性別平等委員會窗口','霸凌委員會窗口','教務處','國際事務處','屏安醫院',
  '社會局','自殺防治中心','屏東地方法院','勵馨基金會','食物銀行',
];

function _iiCollectServiceItems() {
  const items = [];
  document.querySelectorAll('input[name="ii-service-main"]:checked').forEach(cb => {
    const val = cb.value;
    if (val === '心理測驗') {
      const subs = [...document.querySelectorAll('input[name="ii-psychtest"]:checked')].map(c => c.value);
      items.push(subs.length ? `心理測驗：${subs.join('、')}` : '心理測驗');
    } else if (val === '性平行為人') {
      const subs = [...document.querySelectorAll('input[name="ii-genderequal"]:checked')].map(c => c.value);
      items.push(subs.length ? `性平行為人：${subs.join('、')}` : '性平行為人');
    } else if (val === '轉介相關資源') {
      const subs = [...document.querySelectorAll('input[name="ii-referral"]:checked')].map(c => c.value);
      if (subs.length) subs.forEach(s => items.push(s)); else items.push('轉介相關資源');
    } else if (val === '責任通報') {
      const subs = [...document.querySelectorAll('input[name="ii-report"]:checked')].map(c => {
        if (c.value === '社政通報') {
          const ss = [...document.querySelectorAll('input[name="ii-social-report"]:checked')].map(s => {
            if (s.value === '其他') { const t = document.getElementById('ii-sp-social-report-other').value.trim(); return t ? `其他：${t}` : '其他'; }
            return s.value;
          });
          return ss.length ? `社政通報（${ss.join('、')}）` : '社政通報';
        }
        if (c.value === '其他通報') { const t = document.getElementById('ii-sp-report-other').value.trim(); return t ? `其他通報：${t}` : '其他通報'; }
        return c.value;
      });
      items.push(subs.length ? `責任通報：${subs.join('、')}` : '責任通報');
    } else if (val === '陪同服務') {
      const tags = [...document.querySelectorAll('#ii-sp-accompany-tags .dynamic-tag')].map(t => t.dataset.name);
      items.push(tags.length ? `陪同服務：${tags.join('、')}` : '陪同服務');
    } else if (val === '內部轉案') {
      const type = document.querySelector('input[name="ii-transfer-type"]:checked')?.value;
      if (type === '指定輔導人員') {
        const email = document.getElementById('ii-transfer-counselor').value;
        const name = configData?.users?.[email]?.name || email;
        items.push(`內部轉案：${name}`);
      } else { items.push('內部轉案：分案會議'); }
    } else if (val === '其他') {
      const tags = [...document.querySelectorAll('#ii-sp-other-tags .dynamic-tag')].map(t => t.dataset.name);
      items.push(tags.length ? `其他：${tags.join('、')}` : '其他');
    } else { items.push(val); }
  });
  return items;
}

function _iiRestoreServiceItems(serviceItems) {
  if (!serviceItems?.length) return;
  const _chkII = v => { const c = document.querySelector(`input[name="ii-service-main"][value="${v}"]`); if (c) c.checked = true; };
  const _chkOrAddII = (cbName, val, listId) => {
    let c = document.querySelector(`input[name="${cbName}"][value="${CSS.escape(val)}"]`);
    if (!c) { _appendCustomCheckboxII(listId, cbName, val); c = [...document.querySelectorAll(`input[name="${cbName}"]`)].find(el => el.value === val); }
    if (c) c.checked = true;
  };
  for (const item of serviceItems) {
    if (['諮商輔導／諮詢','與個案相關資源或關係人聯繫','一次性服務'].includes(item)) { _chkII(item); }
    else if (item.startsWith('心理測驗')) {
      _chkII('心理測驗'); document.getElementById('ii-sp-psychtest')?.classList.add('active');
      if (item.includes('：')) item.slice(item.indexOf('：')+1).split('、').forEach(s => _chkOrAddII('ii-psychtest', s.trim(), 'ii-sp-psychtest-list'));
    } else if (item.startsWith('性平行為人')) {
      _chkII('性平行為人'); document.getElementById('ii-sp-genderequal')?.classList.add('active');
      if (item.includes('：')) item.slice(item.indexOf('：')+1).split('、').forEach(s => { const c = document.querySelector(`input[name="ii-genderequal"][value="${s.trim()}"]`); if (c) c.checked = true; });
    } else if (_II_REFERRAL_FIXED.includes(item) || item.startsWith('轉介')) {
      _chkII('轉介相關資源'); document.getElementById('ii-sp-referral')?.classList.add('active');
      _chkOrAddII('ii-referral', item, 'ii-sp-referral-list');
    } else if (item.startsWith('責任通報')) {
      _chkII('責任通報'); document.getElementById('ii-sp-report')?.classList.add('active');
      if (item.includes('：')) item.slice(item.indexOf('：')+1).split('、').forEach(sub => {
        sub = sub.trim();
        if (sub.startsWith('社政通報')) {
          const c = document.querySelector('input[name="ii-report"][value="社政通報"]');
          if (c) { c.checked = true; document.getElementById('ii-sp-social-report').style.display = ''; }
          const inner = sub.match(/[（(](.+)[）)]/);
          if (inner) inner[1].split('、').forEach(s => {
            s = s.trim();
            if (s.startsWith('其他：')) { const sc = document.querySelector('input[name="ii-social-report"][value="其他"]'); if (sc) { sc.checked = true; const o = document.getElementById('ii-sp-social-report-other'); o.value = s.slice(3); o.style.display = 'inline-block'; } }
            else { const sc = document.querySelector(`input[name="ii-social-report"][value="${s}"]`); if (sc) sc.checked = true; }
          });
        } else if (sub.startsWith('其他通報：')) {
          const c = document.querySelector('input[name="ii-report"][value="其他通報"]'); if (c) c.checked = true;
          const o = document.getElementById('ii-sp-report-other'); o.value = sub.slice(5); o.style.display = 'inline-block';
        } else { const c = document.querySelector(`input[name="ii-report"][value="${sub}"]`); if (c) c.checked = true; }
      });
    } else if (item.startsWith('陪同服務')) {
      _chkII('陪同服務'); document.getElementById('ii-sp-accompany')?.classList.add('active');
      if (item.includes('：')) item.slice(item.indexOf('：')+1).split('、').forEach(t => { const tag = document.createElement('div'); tag.className = 'dynamic-tag'; tag.dataset.name = t.trim(); tag.innerHTML = `${escHtml(t.trim())} <button onclick="this.parentElement.remove()" type="button">×</button>`; document.getElementById('ii-sp-accompany-tags')?.appendChild(tag); });
    } else if (item.startsWith('內部轉案')) {
      _chkII('內部轉案'); document.getElementById('ii-sp-transfer')?.classList.add('active');
      if (!item.includes('：') || item.includes('分案會議')) { const r = document.querySelector('input[name="ii-transfer-type"][value="分案會議"]'); if (r) r.checked = true; }
      else { const r = document.querySelector('input[name="ii-transfer-type"][value="指定輔導人員"]'); if (r) { r.checked = true; document.getElementById('ii-sp-transfer-counselor').style.display = ''; } const name = item.slice(item.indexOf('：')+1).trim(); const sel = document.getElementById('ii-transfer-counselor'); if (sel) [...sel.options].forEach(o => { if (o.text.startsWith(name)) o.selected = true; }); }
    } else if (item.startsWith('其他')) {
      _chkII('其他'); document.getElementById('ii-sp-other')?.classList.add('active');
      if (item.includes('：')) item.slice(item.indexOf('：')+1).split('、').forEach(t => { const tag = document.createElement('div'); tag.className = 'dynamic-tag'; tag.dataset.name = t.trim(); tag.innerHTML = `${escHtml(t.trim())} <button onclick="this.parentElement.remove()" type="button">×</button>`; document.getElementById('ii-sp-other-tags')?.appendChild(tag); });
    }
  }
}

// 是否需要提醒填寫初次晤談表
function needsInitialInterview(c) {
  if (!c) return false;
  const ii = c.initialInterview;
  if (!ii) return true;
  if (ii.deleted) return true; // 刪除後重新顯示填寫選項
  if (ii.type === 'continuation') return false;
  if (ii.type === 'linkedRecord' && ii.recordId) return false;
  if (ii.type === 'filled' || ii.problemsMain || ii.summary || ii.mainIssue) return false;
  return true;
}

// 取得指定學期的初次晤談表（multi-sem 案件使用 initialInterviews 欄位）
function _getCaseII(c, semPrefix) {
  if (Array.isArray(c.semesters) && c.semesters.length > 1) {
    if (c.initialInterviews?.[semPrefix]) return c.initialInterviews[semPrefix];
    // backward compat: if no per-sem storage yet, associate old initialInterview with oldest semester
    const firstSem = [...c.semesters].sort()[0];
    return semPrefix === firstSem ? (c.initialInterview || null) : null;
  }
  return c.initialInterview || null;
}

function openInitialInterviewPage(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  _initialInterviewCaseId = caseId;
  _initialInterviewSem = _caseDetailActiveSem || openDateToSemPrefix(c.openDate);
  document.getElementById('initial-interview-case-info').textContent = `個案：${c.name}（${c.id}）`;
  // 重置同時段重複紀錄檢核（#9）的殘留狀態/警示區塊
  delete _dupStates.ii;
  const _iiDupEl0 = document.getElementById('ii-dup-alert');
  if (_iiDupEl0) { _iiDupEl0.style.display = 'none'; _iiDupEl0.innerHTML = ''; }

  // Reset chip state and image
  _iiChipData = {};
  _iiFamilyImage = null;

  // Build problem list with chips for subs (all problems get a chip row for custom options)
  const probEl = document.getElementById('ii-problems-list');
  probEl.innerHTML = II_PROBLEMS.map((p, i) =>
    `<div>
      <label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;">
        <input type="checkbox" name="ii-prob-main" value="${escHtml(p.key)}" onchange="iiProbMainChange(${i})" />
        ${escHtml(p.key)}
      </label>
      <div id="ii-prob-chips-${i}" class="ii-chip-row ii-disabled" style="margin-left:22px;margin-top:4px;"></div>
    </div>`
  ).join('');

  // Initialize chip groups for all problems (empty subs still allow custom options)
  II_PROBLEMS.forEach((p, i) => {
    _iiInitChipGroup(`prob-${i}`, p.subs, [], []);
    _iiRenderChipGroup(`prob-${i}`, `ii-prob-chips-${i}`);
  });

  // Initialize and render sup chip groups
  _iiInitChipGroup('sup-risk', II_SUP_RISKS, [], []);
  _iiInitChipGroup('sup-topic', II_SUP_TOPICS, [], []);
  _iiInitChipGroup('sup-skill', II_SUP_SKILLS, [], []);
  _iiRenderChipGroup('sup-risk', 'ii-sup-risk-chips');
  _iiRenderChipGroup('sup-topic', 'ii-sup-topics-chips');
  _iiRenderChipGroup('sup-skill', 'ii-sup-skills-chips');

  // Clear text fields
  ['ii-family','ii-main-issue','ii-summary','ii-expectation','ii-plan'].forEach(id => setRichTextValue(id, ''));
  ['ii-risk-desc','ii-sup-other','ii-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  iiClearFamilyImage();

  // Reset service items and sub-panels
  document.querySelectorAll('#page-initial-interview input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('#page-initial-interview .service-subpanel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#ii-sp-accompany-tags,#ii-sp-other-tags').forEach(el => el.innerHTML = '');
  const defTransferType = document.querySelector('input[name="ii-transfer-type"][value="分案會議"]');
  if (defTransferType) defTransferType.checked = true;
  ['ii-sp-transfer-counselor','ii-sp-social-report'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  ['ii-sp-social-report-other','ii-sp-report-other'].forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.style.display = 'none'; } });

  // Reset radios
  const defaultRisk = document.querySelector('input[name="ii-risk"][value="無"]');
  if (defaultRisk) defaultRisk.checked = true;
  const defaultCaseType = document.querySelector('input[name="ii-case-type"][value="新案/轉案"]');
  if (defaultCaseType) defaultCaseType.checked = true;
  ['ii-sup-new-section','ii-sup-45-section'].forEach(id =>
    document.getElementById(id)?.classList.remove('ii-disabled')
  );
  ['ii-section-seven','ii-section-eight'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.opacity = ''; el.style.pointerEvents = ''; }
  });

  // Load custom service options into ii- lists
  _iiLoadCustomServiceOptions();

  // Reset interview date/time/interviewer — default date to today for new forms
  const _iiDateEl = document.getElementById('ii-interview-date');
  if (_iiDateEl) _iiDateEl.value = new Date().toISOString().split('T')[0];
  const _iiTimeEl = document.getElementById('ii-interview-time');
  if (_iiTimeEl) _iiTimeEl.value = '';
  const _iiTimeOtherEl = document.getElementById('ii-interview-time-other');
  if (_iiTimeOtherEl) { _iiTimeOtherEl.value = ''; _iiTimeOtherEl.style.display = 'none'; }

  // Populate counselor dropdowns /* COUNSELOR_SELECT_GROUP:ii-result/transfer/sup-old-counselor */
  const _COUNSELING_ROLES_II = new Set(['主任','專任社會工作師','專任諮商心理師','專任臨床心理師','兼任諮商心理師','兼任臨床心理師','駐校精神科醫師','實習諮商心理師','義務輔導老師']);
  const counselorOpts = buildCounselorOptgroups(([e, u]) => !!(u?.name) && _COUNSELING_ROLES_II.has(u?.role));
  ['ii-result-counselor','ii-transfer-counselor','ii-sup-old-counselor'].forEach(id => {
    const sel = document.getElementById(id); if (sel) sel.innerHTML = counselorOpts;
  });
  const _iiInterSel = document.getElementById('ii-interviewer-sel');
  if (_iiInterSel) { _iiInterSel.innerHTML = buildCounselorOptgroups(); _iiInterSel.value = currentUser?.email || ''; }

  const existing = _getCaseII(c, _initialInterviewSem);
  if (existing && !existing.deleted && existing.type !== 'continuation' && existing.type !== 'linkedRecord') _iiPopulateForm(existing);
  attachInit('ii', (existing && !existing.deleted) ? (existing.attachments || []) : [], { dropTargets: ['ii-family','ii-main-issue','ii-summary','ii-expectation','ii-plan','ii-risk-desc'] });

  setAlert('initial-interview-alert', '', '');
  showPage('page-initial-interview', null);

  stopIIDraftAutosave();
  if (!(existing && !existing.deleted && existing.type !== 'continuation' && existing.type !== 'linkedRecord')) {
    _iiDraftKey = `scc_draft_ii_${currentUser?.email||''}_${caseId}`;
    startIIDraftAutosave();
  } else {
    _iiDraftKey = null;
  }
}

function _iiPopulateForm(d) {
  if (!d) return;
  setRichTextValue('ii-family',      d.family      || '');
  setRichTextValue('ii-main-issue',  d.mainIssue   || '');
  setRichTextValue('ii-summary',     d.summary     || '');
  setRichTextValue('ii-expectation', d.expectation || '');
  document.getElementById('ii-risk-desc').value = d.riskDesc || '';
  setRichTextValue('ii-plan',        d.plan        || '');
  document.getElementById('ii-sup-other').value = d.supOther || '';
  document.getElementById('ii-notes').value = d.notes || d.attendees || '';

  document.querySelectorAll('input[name="ii-risk"]').forEach(r => { r.checked = (d.risk === r.value); });
  document.querySelectorAll('input[name="ii-case-type"]').forEach(r => { r.checked = (d.caseType === r.value); });
  if (d.caseType === '舊案') {
    ['ii-sup-new-section','ii-sup-45-section'].forEach(id =>
      document.getElementById(id)?.classList.add('ii-disabled')
    );
    ['ii-section-seven','ii-section-eight'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.opacity = '.4'; el.style.pointerEvents = 'none'; }
    });
    const oldRow = document.getElementById('ii-sup-old-counselor-row');
    if (oldRow) oldRow.style.display = 'block';
    const sevenReq = document.getElementById('ii-section-seven-req');
    const sevenOpt = document.getElementById('ii-section-seven-opt');
    if (sevenReq) sevenReq.style.display = 'none';
    if (sevenOpt) sevenOpt.style.display = '';
  }
  // Restore old main counselor
  const oldSel = document.getElementById('ii-sup-old-counselor');
  if (oldSel && d.oldMainCounselor) oldSel.value = d.oldMainCounselor;

  // Restore vacancy checkboxes
  (d.vacancy || []).forEach(v => { const cb = document.querySelector(`input[name="ii-vacancy"][value="${CSS.escape(v)}"]`); if (cb) cb.checked = true; });

  // Restore problem main checkboxes and chip groups (all problems, including those without default subs)
  (d.problemsMain || []).forEach(v => {
    const cb = document.querySelector(`input[name="ii-prob-main"][value="${CSS.escape(v)}"]`);
    if (cb) { cb.checked = true; const idx = II_PROBLEMS.findIndex(p => p.key === v); if (idx >= 0) iiProbMainChange(idx); }
  });
  II_PROBLEMS.forEach((p, i) => {
    const savedSel = (d.problemSubs || []).filter(x => x.idx === i).map(x => x.value);
    const customEntry = (d.probCustomSubs || []).find(x => x.idx === i);
    _iiInitChipGroup(`prob-${i}`, p.subs, savedSel, customEntry?.values || []);
    _iiRenderChipGroup(`prob-${i}`, `ii-prob-chips-${i}`);
    const row = document.getElementById(`ii-prob-chips-${i}`);
    if (row && (d.problemsMain || []).includes(p.key)) row.classList.remove('ii-disabled');
  });

  // Restore service items
  _iiRestoreServiceItems(d.serviceItems || d.services || []);

  // Restore sup chip groups with saved selections and custom values
  const _restoreSup = (gk, cid, defOpts, savedSel, savedCustom) => {
    _iiInitChipGroup(gk, defOpts, savedSel, savedCustom);
    _iiRenderChipGroup(gk, cid);
  };
  _restoreSup('sup-risk',  'ii-sup-risk-chips',   II_SUP_RISKS,   d.supRisks  || [], d.supRisksCustom  || []);
  _restoreSup('sup-topic', 'ii-sup-topics-chips',  II_SUP_TOPICS,  d.supTopics || [], d.supTopicsCustom || []);
  _restoreSup('sup-skill', 'ii-sup-skills-chips',  II_SUP_SKILLS,  d.supSkills || [], d.supSkillsCustom || []);

  // Restore counselor dropdown
  const sel = document.getElementById('ii-result-counselor');
  if (sel && d.resultCounselor) sel.value = d.resultCounselor;

  // Restore interview date/time/interviewer
  const _iiD = document.getElementById('ii-interview-date'); if (_iiD && d.interviewDate) _iiD.value = d.interviewDate;
  if (d.interviewTime) {
    const _iiT = document.getElementById('ii-interview-time');
    const _iiTO = document.getElementById('ii-interview-time-other');
    if (_iiT) {
      if (d.interviewTime.startsWith('其他：')) { _iiT.value = '其他'; if (_iiTO) { _iiTO.value = d.interviewTime.slice(3); _iiTO.style.display = ''; } }
      else { _iiT.value = d.interviewTime; }
    }
  }
  const _iiIS = document.getElementById('ii-interviewer-sel'); if (_iiIS && d.interviewerEmail) _iiIS.value = d.interviewerEmail;

  // Restore family image
  if (d.familyImage) {
    _iiFamilyImage = d.familyImage;
    const prev = document.getElementById('ii-family-image-preview');
    if (prev) prev.innerHTML = `<img src="${escHtml(_iiFamilyImage)}" style="max-width:100%;max-height:280px;border-radius:6px;border:1px solid #e2e8f0;" />`;
    const clr = document.getElementById('ii-family-image-clear'); if (clr) clr.style.display = '';
  }
}

function snapshotInitialInterview() {
  const get = (id) => { const el = document.getElementById(id); if (!el) return ''; return (el.isContentEditable || el.getAttribute('contenteditable')==='true') ? getRichTextValue(id) : el.value||''; };
  const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(cb => cb.value);

  // Collect problem chip selections
  const problemsMain = checked('ii-prob-main');
  const problemSubs = [];
  const probCustomSubs = [];
  II_PROBLEMS.forEach((p, i) => {
    const d = _iiChipData[`prob-${i}`]; if (!d) return;
    d.sel.forEach(v => problemSubs.push({ idx: i, value: v }));
    if (d.custom.size) probCustomSubs.push({ idx: i, values: [...d.custom] });
  });

  // Collect sup chip selections
  const _supSel    = (gk) => { const d = _iiChipData[gk]; return d ? [...d.sel]    : []; };
  const _supCustom = (gk) => { const d = _iiChipData[gk]; return d ? [...d.custom] : []; };

  return {
    type: 'filled',
    problemsMain, problemSubs, probCustomSubs,
    family: get('ii-family'), mainIssue: get('ii-main-issue'),
    summary: get('ii-summary'), expectation: get('ii-expectation'),
    risk: document.querySelector('input[name="ii-risk"]:checked')?.value || '無',
    riskDesc: get('ii-risk-desc'), plan: get('ii-plan'),
    serviceItems: _iiCollectServiceItems(),
    caseType: document.querySelector('input[name="ii-case-type"]:checked')?.value || '',
    supRisks:  _supSel('sup-risk'),   supRisksCustom:  _supCustom('sup-risk'),
    supTopics: _supSel('sup-topic'),  supTopicsCustom: _supCustom('sup-topic'),
    supSkills: _supSel('sup-skill'),  supSkillsCustom: _supCustom('sup-skill'),
    vacancy: checked('ii-vacancy'),
    supOther: get('ii-sup-other'),
    oldMainCounselor: get('ii-sup-old-counselor'),
    resultCounselor: get('ii-result-counselor'),
    interviewDate: get('ii-interview-date'),
    interviewTime: (() => { const s = document.getElementById('ii-interview-time'); if (!s) return ''; if (s.value === '其他') return '其他：' + (document.getElementById('ii-interview-time-other')?.value || ''); return s.value; })(),
    interviewerEmail: get('ii-interviewer-sel'),
    interviewerName: (() => { const em = get('ii-interviewer-sel'); return configData?.users?.[em]?.name || em || ''; })(),
    notes: get('ii-notes'),
    familyImage: _iiFamilyImage || null,
    attachments: (_attachState.get('ii')?.existing || []),
  };
}

// 初次晤談紀錄表：把個案目前所有初談表（含各學期分頁）轉成同時段檢核共用的統一形狀
function _iiDupEntries(c) {
  const entries = [];
  if (Array.isArray(c.semesters) && c.semesters.length > 1 && c.initialInterviews) {
    Object.entries(c.initialInterviews).forEach(([sem, ii]) => {
      if (ii && !ii.deleted) entries.push({ id: sem, date: ii.interviewDate, time: ii.interviewTime, counselorEmails: [ii.interviewerEmail].filter(Boolean), createdAt: ii.createdAt });
    });
  } else if (c.initialInterview && !c.initialInterview.deleted) {
    const _selfKey = (Array.isArray(c.semesters) && c.semesters[0]) || openDateToSemPrefix(c.openDate) || 'default';
    entries.push({ id: _selfKey, date: c.initialInterview.interviewDate, time: c.initialInterview.interviewTime, counselorEmails: [c.initialInterview.interviewerEmail].filter(Boolean), createdAt: c.initialInterview.createdAt });
  }
  return entries;
}

// 即時檢查同個案＋同初談者＋同時段是否已有既存的初談表（可能是別的學期分頁）
function _checkIIDuplicate() {
  if (!_initialInterviewCaseId) return;
  const c = casesData.find(x => x.id === _initialInterviewCaseId);
  if (!c) return;
  const date = document.getElementById('ii-interview-date')?.value || '';
  const timeSel = document.getElementById('ii-interview-time')?.value || '';
  const time = timeSel === '其他' ? ('其他：' + (document.getElementById('ii-interview-time-other')?.value || '').trim()) : timeSel;
  const interviewerEmail = document.getElementById('ii-interviewer-sel')?.value || '';
  const match = _dupFindSameSlot(_iiDupEntries(c), { date, time, counselorEmails: [interviewerEmail].filter(Boolean), excludeId: _initialInterviewSem || null });
  _dupRenderAlert('ii-dup-alert', 'ii', match);
}

async function saveInitialInterview() {
  if (!_initialInterviewCaseId) return;
  setAlert('initial-interview-alert', '', '');

  const _saveBtn = document.getElementById('ii-save-btn');
  if (_saveBtn) { _saveBtn.disabled = true; _saveBtn.textContent = '儲存中…'; }
  try {

  const snap = snapshotInitialInterview();
  const _rtText = v => (v||'').replace(/<[^>]*>/g,'').trim();
  const errs = [];
  if (!snap.interviewDate) errs.push('初談日期（必填）');
  if (!snap.interviewerEmail) errs.push('初談者（必填）');
  if (!(snap.problemsMain || []).length) errs.push('一、個案問題評估（至少選一項）');
  if (!_rtText(snap.family))      errs.push('二、問題內容說明（一）家庭概況（必填）');
  if (!_rtText(snap.mainIssue))   errs.push('二、問題內容說明（二）主訴問題（必填）');
  if (!_rtText(snap.summary))     errs.push('二、問題內容說明（三）會談摘要（必填）');
  if (!_rtText(snap.expectation)) errs.push('二、問題內容說明（四）會談期待（必填）');
  if (snap.risk === '有' && !snap.riskDesc) errs.push('三、風險評估（已選「有」，請說明）');
  if (!_rtText(snap.plan)) errs.push('四、個別化服務計畫');
  if (!(snap.serviceItems || []).length) errs.push('五、此次服務項目（至少選一項）');
  if (!snap.caseType) errs.push('六、同儕督導會議（請選擇新案/轉案或舊案）');
  if (snap.caseType === '舊案') {
    if (!snap.oldMainCounselor) errs.push('六、原主責輔導人員（請選擇）');
  } else {
    if (!(snap.supRisks || []).length)  errs.push('六-1. 風險評估（至少選一項）');
    if (!(snap.supTopics || []).length) errs.push('六-2. 主訴議題（至少選一項）');
    if (!(snap.supSkills || []).length) errs.push('六-3. 輔導人員專長（至少選一項）');
    if (!snap.resultCounselor) errs.push('七、確認主責輔導人員（請選擇）');
  }
  if (errs.length) { setAlert('initial-interview-alert', 'error', '請填寫必填項目：\n• ' + errs.join('\n• ')); document.getElementById('initial-interview-alert')?.scrollIntoView({behavior:'smooth',block:'center'}); return; }

  const cidx = casesData.findIndex(c => c.id === _initialInterviewCaseId);
  if (cidx === -1) return;

  // #18：初談紀錄要歸入哪個學期，一律由「初談日期」推導，而不是開表單當下的分頁情境
  // （_initialInterviewSem 是開表單那一刻的分頁/接案日期，使用者填的日期可能落在別的學期）。
  // 找得到既有分頁對應的完整 key（含 #N 分身後綴）就沿用，找不到就退回日期推得的純學期前綴。
  const _iiDateSemBase = snap.interviewDate ? openDateToSemPrefix(snap.interviewDate) : '';
  let _iiSemKey = _initialInterviewSem;
  if (_iiDateSemBase && _semKeyBase(_initialInterviewSem) !== _iiDateSemBase) {
    const _iiMatchKey = (Array.isArray(casesData[cidx].semesters) ? casesData[cidx].semesters : [])
      .find(k => _semKeyBase(k) === _iiDateSemBase);
    _iiSemKey = _iiMatchKey || _iiDateSemBase;
  }

  // ── 同時段重複紀錄檢核（#9）：儲存前最後把關 ──
  // 若同個案在別的學期分頁已有「同日期時間＋同初談者」的既存初談表，選「覆蓋」時直接改存進
  // 那個既有分頁的 key（等同編輯那一筆），而不是存進本次日期推得的 _iiSemKey
  let _iiDidMerge = false;
  {
    const _iiDupMatch = _dupFindSameSlot(_iiDupEntries(casesData[cidx]), {
      date: snap.interviewDate, time: snap.interviewTime,
      counselorEmails: [snap.interviewerEmail].filter(Boolean), excludeId: _initialInterviewSem || null,
    });
    if (_iiDupMatch && _dupResolveAtSave('ii', _iiDupMatch) === 'merge') {
      _iiSemKey = _iiDupMatch.id;
      _iiDidMerge = true;
    }
  }

  let _iiAttachments;
  try { _iiAttachments = await attachFlush('ii'); }
  catch(e) { setAlert('initial-interview-alert','error','附件上傳失敗：' + e.message); return; }
  snap.attachments = _iiAttachments;
  snap.updatedAt = new Date().toISOString();
  snap.updatedBy = currentUser?.email;
  const _isMultiSem = Array.isArray(casesData[cidx].semesters) && casesData[cidx].semesters.length > 1;
  const prev = _isMultiSem && _iiSemKey
    ? (casesData[cidx].initialInterviews?.[_iiSemKey] || casesData[cidx].initialInterview)
    : casesData[cidx].initialInterview;
  snap.createdAt = prev?.createdAt || snap.updatedAt;
  snap.createdBy = prev?.createdBy || currentUser?.email;
  // 鎖定初談者（首次填寫時固定）
  snap.filledBy     = prev?.filledBy     || currentUser?.email;
  snap.filledByName = prev?.filledByName || configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  delete snap.status; delete snap.draftSavedAt;
  if (_isMultiSem && _iiSemKey) {
    if (!casesData[cidx].initialInterviews) casesData[cidx].initialInterviews = {};
    casesData[cidx].initialInterviews[_iiSemKey] = snap;
    casesData[cidx].initialInterview = snap; // backward compat
  } else {
    casesData[cidx].initialInterview = snap;
  }
  casesData[cidx].updatedAt = snap.updatedAt;
  // 初談者自動加入 allowedCases（若尚未設定）
  if (snap.interviewerEmail && configData?.users?.[snap.interviewerEmail]) {
    const _iiMgrEntry = configData.users[snap.interviewerEmail];
    _iiMgrEntry.allowedCases = _iiMgrEntry.allowedCases || [];
    if (!_iiMgrEntry.allowedCases.includes(_initialInterviewCaseId)) {
      _iiMgrEntry.allowedCases.push(_initialInterviewCaseId);
      if (!_iiMgrEntry.extraRole) _iiMgrEntry.extraRole = '個案管理員';
      // 此表單失敗不離開頁面、初談表本身已用 saveCasesChunks 走完整儲存流程，這一步失敗不擋主流程，
      // 但不得靜默吞掉——改用 toast 明確提示，供使用者知道需要重新整理或手動補派。
      _configCasesPatch([{ type: 'caseAccessUpsert', email: snap.interviewerEmail, caseId: _initialInterviewCaseId }])
        .catch(e => showToast('初談者自動列管儲存失敗：' + e.message + '，請重新整理頁面確認狀態。', 'error', 6000));
    }
  }
  // mark corresponding todo as done
  const _iiTodo = todosData.find(t => t.caseId === _initialInterviewCaseId && t.type === 'initial_interview' && !t.done);
  if (_iiTodo) { _iiTodo.done = true; _iiTodo.doneAt = new Date().toISOString(); saveUserTodos().catch(()=>{}); _syncTodoBadge(); }
  // 建立/更新待派案 todo（若本學期已有主責輔導人員則跳過）
  const _semSnapII = casesData[cidx].basicInfoSnapshots?.[_iiSemKey];
  const _existingCounselor = _semSnapII?.counselorEmail || casesData[cidx].counselorEmail;
  if (!_existingCounselor) {
    const _existAssign = todosData.find(t => t.type === 'case_assignment' && t.caseId === _initialInterviewCaseId && !t.done);
    const _caseName = casesData[cidx].name;
    const _assignItem = {
      id: _existAssign?.id || _genTodoId(),
      type: 'case_assignment',
      label: `待派案：${_caseName}（${_initialInterviewCaseId}）`,
      caseId: _initialInterviewCaseId,
      caseLabel: `${_caseName}（${_initialInterviewCaseId}）`,
      assignedCounselor: snap.resultCounselor || '',
      filledBy: snap.filledBy,
      filledByName: snap.filledByName,
      semester: _iiSemKey,
      createdAt: _existAssign?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      done: false, notifRead: false,
    };
    _putTodoItem(_assignItem);
    saveUserTodos().catch(() => {});
  }

  const jobId = bgJobAdd('儲存初次晤談表…');
  // 此表單失敗時不會離開頁面（欄位仍在），故不需重開頁面（reopenFn 給 null）
  _armSaveFailSnapshot('初談表', 'page-initial-interview', null, saveInitialInterview, jobId);
  try {
    await saveCasesChunks(_initialInterviewCaseId);
    // #18：稽核日誌的學期標籤改以「初談日期推得的實際歸屬學期」為準（原本固定顯示個案開案學期，
    // 多學期個案在較晚學期補填初談表時會誤標成最早那個學期）
    const _iiSemLabel = semesterLabel(_iiSemKey || openDateToSemPrefix(casesData[cidx]?.openDate));
    auditLog('儲存初次晤談表', `案號 ${_initialInterviewCaseId}（${_iiSemLabel} 學期）` + (_iiDidMerge ? '；覆蓋同時段紀錄' : ''));
    bgJobDone(jobId, '初次晤談表已儲存');
    _clearSaveFailSnapshot(jobId);
    clearIIDraft();
    _switchDetailSemTo(casesData[cidx], _iiSemKey);
    showCaseDetail(_initialInterviewCaseId);
    _flashRecordCard('ii-card-' + _initialInterviewCaseId);
  } catch (err) {
    casesData[cidx].initialInterview = prev;
    bgJobFail(jobId, '儲存失敗：' + err.message);
    setAlert('initial-interview-alert', 'error', '儲存失敗：' + err.message);
    _showSaveFailModal(err.message, jobId);
  }

  } finally {
    if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = '儲存初次晤談表'; }
  }
}

function cancelInitialInterview() { exitIIForm(); }

function startIIDraftAutosave() {
  stopIIDraftAutosave();
  if (!_iiDraftKey) return;
  _iiDraftTimer = setInterval(() => {
    try {
      const page = document.getElementById('page-initial-interview');
      if (!page?.classList.contains('active')) return;
      const snap = snapshotInitialInterview();
      delete snap.familyImage; // skip base64 image to avoid quota issues
      snap._savedAt = new Date().toISOString();
      if (snap.family || snap.mainIssue || snap.summary || snap.plan || (snap.problemsMain||[]).length)
        localStorage.setItem(_iiDraftKey, JSON.stringify(snap));
    } catch(e) { console.warn('ii draft autosave failed', e); }
  }, 5000);
}

function stopIIDraftAutosave() {
  if (_iiDraftTimer) { clearInterval(_iiDraftTimer); _iiDraftTimer = null; }
}

function clearIIDraft() {
  stopIIDraftAutosave();
  if (_iiDraftKey) { try { localStorage.removeItem(_iiDraftKey); } catch(_) {} }
  _iiDraftKey = null;
}

// 舊案延續：在卡片內展示過往初次晤談表 chips 供選擇
function showIiContinuationPanel(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const panel = document.getElementById(`ii-continuation-panel-${caseId}`);
  const btns  = document.getElementById(`ii-needs-buttons-${caseId}`);
  if (!panel || !btns) return;

  // 找同一學生（相同學號，或無學號時比對姓名）的其他案件中已填寫的初次晤談表
  const prevCases = casesData.filter(x =>
    x.id !== caseId &&
    (c.studentId ? x.studentId === c.studentId : x.name === c.name) &&
    x.initialInterview && !x.initialInterview.deleted &&
    (x.initialInterview.type === 'filled' || x.initialInterview.problemsMain || x.initialInterview.mainIssue)
  );

  if (!prevCases.length) {
    alert('查無此學生的舊有初次晤談表，無法使用舊案延續。');
    return;
  }

  btns.style.display = 'none';
  panel.style.display = 'block';

  const chips = prevCases.map(x => {
    const sem = semesterLabel(openDateToSemPrefix(x.openDate));
    const creatorEmail = x.initialInterview.createdBy;
    const creatorName = configData?.users?.[creatorEmail]?.name || creatorEmail || '未知';
    return `<span class="ii-chip" data-ref-caseid="${escHtml(x.id)}" onclick="this.classList.toggle('ii-chip-sel')">${escHtml(sem)}　${escHtml(creatorName)}建立之初次晤談表</span>`;
  }).join('');

  panel.innerHTML = `
    <div style="font-size:.88rem;color:#4a5568;margin-bottom:8px;">請選擇此案所延續的初次晤談表：</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">${chips}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" onclick="confirmIiContinuation('${escHtml(caseId)}')">確認舊案延續</button>
      <button class="btn btn-secondary btn-sm" onclick="cancelIiContinuationPanel('${escHtml(caseId)}')">取消</button>
    </div>`;
}

function cancelIiContinuationPanel(caseId) {
  const panel = document.getElementById(`ii-continuation-panel-${caseId}`);
  const btns  = document.getElementById(`ii-needs-buttons-${caseId}`);
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  if (btns)  btns.style.display = '';
}

async function confirmIiContinuation(caseId) {
  const panel = document.getElementById(`ii-continuation-panel-${caseId}`);
  if (!panel) return;
  const sel = panel.querySelector('.ii-chip.ii-chip-sel');
  if (!sel) { alert('請點選一個舊有初次晤談表'); return; }
  const refCaseId = sel.dataset.refCaseid;
  const refCase = casesData.find(x => x.id === refCaseId);
  const sem = semesterLabel(openDateToSemPrefix(refCase?.openDate));
  const creatorEmail = refCase?.initialInterview?.createdBy;
  const creatorName = configData?.users?.[creatorEmail]?.name || creatorEmail || '';
  const note = `延續 ${sem}　${creatorName}建立之初次晤談表`;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const prev = casesData[cidx].initialInterview;
  casesData[cidx].initialInterview = {
    type: 'continuation', note, refCaseId,
    createdAt: new Date().toISOString(), createdBy: currentUser?.email,
  };
  casesData[cidx].updatedAt = new Date().toISOString();
  showLoading('儲存中…');
  try {
    await saveCasesChunks(caseId);
    auditLog('標記初次晤談為舊案延續', caseId);
    hideLoading(); showCaseDetail(caseId);
  } catch (err) {
    casesData[cidx].initialInterview = prev;
    hideLoading(); alert('儲存失敗：' + err.message);
  }
}

function _showAllSemWarning(caseId, label, targetElId) {
  const existing = document.getElementById('_all-sem-warn-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = '_all-sem-warn-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);';
  modal.innerHTML = `<div style="background:#fff;border-radius:10px;padding:24px 28px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2);"><div style="font-weight:700;font-size:1rem;margin-bottom:10px;color:#2d3748;">⚠ 無法捲動至「${label}」</div><div style="font-size:.9rem;color:#4a5568;margin-bottom:18px;">目前為「所有學期」模式，${label}不會顯示。<br>請切換回「本學期」模式後再使用此功能。</div><div style="display:flex;gap:10px;justify-content:flex-end;"><button onclick="document.getElementById('_all-sem-warn-modal').remove()" style="padding:7px 18px;border:1px solid #cbd5e0;border-radius:6px;background:#fff;cursor:pointer;font-size:.9rem;">確認</button><button onclick="_allSemSwitchAndScroll('${caseId}','${targetElId || ''}')" style="padding:7px 18px;border:none;border-radius:6px;background:#3182ce;color:#fff;cursor:pointer;font-size:.9rem;font-weight:600;">切回本學期</button></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// 切回本學期 + 重繪完成後自動捲動至目標卡片（不還原原捲動位置，避免看起來「沒反應」）
async function _allSemSwitchAndScroll(caseId, targetElId) {
  document.getElementById('_all-sem-warn-modal')?.remove();
  _detailSemFilter = 'current';
  _recPage = 1;
  await showCaseDetail(caseId);
  if (!targetElId) return;
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(targetElId);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (++tries < 10) setTimeout(tick, 150);
  };
  tick();
}

// 從現有晤談紀錄挑一筆作為「初次晤談」
function _scrollToIiCard(cid) {
  const el = document.getElementById('ii-card-' + cid);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else _showAllSemWarning(cid, '初次晤談卡片', 'ii-card-' + cid);
}
function _scrollToPsychCard(cid) {
  const el = document.getElementById('cs-psychiatrist');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else _showAllSemWarning(cid, '精神科醫師卡片', 'cs-psychiatrist');
}
function _scrollToEvalCard(cid) {
  const el = document.getElementById('cs-eval');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else _showAllSemWarning(cid, '結案/學期評估卡片', 'cs-eval');
}

function pickRecordAsInitialInterview(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const records = (c.records || []).filter(r => !r.deleted).sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  if (!records.length) { alert('此個案尚無晤談紀錄可挑選。'); return; }

  let modal = document.getElementById('ii-pick-record-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'ii-pick-record-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:30px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;">
        <h3 style="margin:0;color:#1a5276;font-size:1.05rem;">將既有晤談紀錄標記為「初次晤談」</h3>
        <div style="color:#718096;font-size:.83rem;margin-top:4px;">挑一筆作為初次晤談的代表紀錄。</div>
      </div>
      <div style="padding:10px 16px;overflow:auto;flex:1;">
        ${records.map(r => `
          <label style="display:flex;gap:8px;align-items:center;padding:8px 6px;border-bottom:1px solid #f0f4f8;cursor:pointer;">
            <input type="radio" name="ii-pick-record" value="${escHtml(r.id)}" />
            <div style="flex:1;font-size:.88rem;">
              <div><strong>${escHtml(r.date)}</strong> ${escHtml(r.time || '')}</div>
              <div style="color:#718096;font-size:.8rem;">${escHtml((r.counselorName || r.counselorEmail || '').slice(0, 40))}</div>
            </div>
          </label>
        `).join('')}
      </div>
      <div style="padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f7fafc;">
        <button class="btn btn-secondary" type="button" onclick="document.getElementById('ii-pick-record-modal').remove()">取消</button>
        <button class="btn btn-primary" type="button" id="ii-pick-confirm">確認標記</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#ii-pick-confirm').onclick = async () => {
    const recId = modal.querySelector('input[name="ii-pick-record"]:checked')?.value;
    if (!recId) { alert('請選擇一筆晤談紀錄'); return; }
    modal.remove();
    const cidx = casesData.findIndex(x => x.id === caseId);
    if (cidx === -1) return;
    const prev = casesData[cidx].initialInterview;
    casesData[cidx].initialInterview = {
      type: 'linkedRecord', recordId: recId,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.email,
    };
    casesData[cidx].updatedAt = new Date().toISOString();
    showLoading('儲存中…');
    try {
      await saveCasesChunks(caseId);
      auditLog('將既有紀錄標記為初次晤談', caseId, recId);
      hideLoading();
      showCaseDetail(caseId);
    } catch (err) {
      casesData[cidx].initialInterview = prev;
      hideLoading();
      alert('儲存失敗：' + err.message);
    }
  };
}

// 取消「舊案延續」/ 取消「沿用某筆紀錄」標記，回到尚未填寫狀態
async function clearInitialInterviewMark(caseId) {
  if (!confirm('要清除目前的初次晤談狀態？清除後系統會重新提醒填寫。')) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const prev = casesData[cidx].initialInterview;
  delete casesData[cidx].initialInterview;
  casesData[cidx].updatedAt = new Date().toISOString();
  showLoading('儲存中…');
  try {
    await saveCasesChunks(caseId);
    auditLog('清除初次晤談標記', caseId);
    hideLoading();
    showCaseDetail(caseId);
  } catch (err) {
    casesData[cidx].initialInterview = prev;
    hideLoading();
    alert('儲存失敗：' + err.message);
  }
}

async function deleteInitialInterview(caseId) {
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const ii = casesData[cidx].initialInterview;
  if (!ii || ii.deleted) return;
  if (!isAdmin() && ii.createdBy !== currentUser?.email) { alert('僅建立者或管理者可刪除初次晤談表'); return; }
  if (!confirm('確定刪除此初次晤談表？\n\n刪除後仍會在建立者與管理者介面留下「痕跡」，管理者可執行「徹底移除」。')) return;
  const prev = { deleted: ii.deleted, deletedAt: ii.deletedAt, deletedBy: ii.deletedBy, deletedByName: ii.deletedByName };
  ii.deleted = true;
  ii.deletedAt = new Date().toISOString();
  ii.deletedBy = currentUser?.email;
  ii.deletedByName = configData?.users?.[currentUser?.email]?.name || currentUser?.name;
  showCaseDetail(caseId);
  const jobId = bgJobAdd('刪除初次晤談表');
  saveCasesChunks(caseId).then(() => {
    bgJobDone(jobId);
    auditLog('刪除初次晤談表', caseId);
    showToast('初次晤談表已刪除');
  }).catch(e => {
    bgJobFail(jobId, e.message);
    Object.assign(ii, prev);
    showCaseDetail(caseId);
    showToast('刪除失敗：' + e.message, 'error');
  });
}

async function restoreInitialInterview(caseId) {
  if (!confirm('確定要復原此初次晤談表？')) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const ii = casesData[cidx].initialInterview;
  if (!ii) return;
  const prev = { deleted: ii.deleted, deletedAt: ii.deletedAt, deletedBy: ii.deletedBy, deletedByName: ii.deletedByName };
  delete ii.deleted; delete ii.deletedAt; delete ii.deletedBy; delete ii.deletedByName;
  showLoading('復原中…');
  try {
    await saveCasesChunks(caseId);
    auditLog('復原初次晤談表', caseId);
    hideLoading(); showCaseDetail(caseId);
  } catch(e) {
    Object.assign(ii, prev);
    hideLoading(); alert('操作失敗：'+e.message);
  }
}

async function purgeInitialInterview(caseId) {
  if (!isAdmin()) { alert('僅管理者可徹底移除初次晤談表。'); return; }
  if (!confirm('確定要徹底移除此初次晤談表？此動作不可復原，將清除「已刪除」痕跡。')) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx === -1) return;
  const prev = casesData[cidx].initialInterview;
  delete casesData[cidx].initialInterview;
  casesData[cidx].updatedAt = new Date().toISOString();
  showLoading('徹底移除…');
  try {
    await saveCasesChunks(caseId);
    auditLog('徹底移除初次晤談表', caseId);
    hideLoading(); showCaseDetail(caseId);
  } catch(e) {
    casesData[cidx].initialInterview = prev;
    hideLoading(); alert('操作失敗：'+e.message);
  }
}

function printInitialInterview(caseId, mode = 'print') {
  const cid = caseId || _initialInterviewCaseId;
  const c = casesData.find(x => x.id === cid);
  if (!c) return;
  let d;
  if (document.getElementById('page-initial-interview')?.classList.contains('active') && _initialInterviewCaseId === cid) {
    d = snapshotInitialInterview();
  } else {
    d = c.initialInterview || {};
  }
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const printRich = v => { const t=String(v||''); if(/<[a-z][\s\S]*?>/i.test(t)) return t; return esc(t).replace(/\n/g,'<br>'); };
  const cb = (b) => `<span style="font-size:2em;line-height:1;vertical-align:-0.05em;">${b ? '■' : '□'}</span>`;

  // 一: 只列出有勾選的問題項目
  const probBlock = (() => {
    const items = II_PROBLEMS.map((p, i) => {
      const mainChecked = (d.problemsMain || []).includes(p.key);
      if (!mainChecked) return '';
      const allSubs = [...p.subs];
      const customEntry = (d.probCustomSubs || []).find(x => x.idx === i);
      if (customEntry) customEntry.values.forEach(v => { if (!allSubs.includes(v)) allSubs.push(v); });
      const subsChecked = (d.problemSubs || []).filter(x => x.idx === i).map(x => x.value);
      const checkedSubs = allSubs.filter(s => subsChecked.includes(s));
      const subsHtml = checkedSubs.length
        ? '<div style="margin-left:22px;font-size:11.5px;padding:2px 0;">' + checkedSubs.map(s => `${cb(true)} ${esc(s)}`).join('　') + '</div>'
        : '';
      return `<div style="margin-bottom:3px;">${cb(true)} <b>${esc(p.key)}</b></div>${subsHtml}`;
    }).filter(Boolean);
    return items.length ? items.join('') : '（未勾選）';
  })();

  // 五: serviceItems as list
  const svcItems = d.serviceItems || d.services || [];
  const svcBlock = svcItems.length ? svcItems.map(s => `<div>■ ${esc(s)}</div>`).join('') : '（未選擇）';

  // 六: sup chips (default + custom) — only show checked items
  const _supBlockFiltered = (defArr, savedSel, savedCustom) => {
    const all = [...defArr];
    (savedCustom || []).forEach(v => { if (!all.includes(v)) all.push(v); });
    const checked = all.filter(v => (savedSel||[]).includes(v));
    return checked.length ? checked.map(v => `${cb(true)} ${esc(v)}`).join('　') : '（未選）';
  };
  const supRiskBlock  = _supBlockFiltered(II_SUP_RISKS,   d.supRisks,   d.supRisksCustom);
  const supTopicBlock = _supBlockFiltered(II_SUP_TOPICS,   d.supTopics,  d.supTopicsCustom);
  const supSkillBlock = _supBlockFiltered(II_SUP_SKILLS,   d.supSkills,  d.supSkillsCustom);
  const vacancyBlock  = (() => {
    const all = ['專任專輔人員','兼任專輔人員','義輔老師'];
    const checked = all.filter(v => (d.vacancy||[]).includes(v));
    return checked.length ? checked.map(v => `${cb(true)} ${esc(v)}`).join('　') : '（未選）';
  })();

  // 六: old main counselor (for 舊案)
  const oldCounselorEmail = d.oldMainCounselor || '';
  const oldCounselorName = oldCounselorEmail ? (formatCounselorLabel(oldCounselorEmail) || oldCounselorEmail) : '';

  // 七: single counselor
  const resultEmail = d.resultCounselor || '';
  const resultName = resultEmail ? (formatCounselorLabel(resultEmail) || resultEmail)
    : [d.resultSW, d.resultFullTime, d.resultPartTime, d.resultVol].filter(Boolean).join('　') || '（未指定）';

  const printTime = new Date().toLocaleString('zh-TW');
  const printerName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';

  const sigGrid = `<div style="height:80px;"></div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>初次晤談紀錄表</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family:'Microsoft JhengHei','Noto Sans TC',sans-serif;font-size:12pt;line-height:1.5;color:#000; }
  h1 { text-align:center;font-size:16pt;margin:0 0 10px; }
  table.basic { width:100%;border-collapse:collapse;margin-bottom:10px; }
  table.basic td { border:1px solid #333;padding:4px 8px; }
  .sec-title { font-weight:bold;background:#f0f0f0;padding:4px 8px 2px;margin-top:10px;margin-bottom:1px;border-left:4px solid #333; }
  .box { padding:4px 8px;min-height:20px; }
  .row { margin:2px 0; }
  .foot { margin-top:10px;font-size:9pt;color:#666;text-align:right; }
</style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div>
<h1>初次晤談紀錄表</h1>
<table class="basic">
  <tr><td colspan="6"><b>個案基本資料</b>　案號：<b>${esc(c.id)}</b>　${d.interviewDate ? `初談日期：${esc(d.interviewDate)}${d.interviewTime ? ' ' + esc(d.interviewTime) : ''}` : `接案日期：${esc(c.openDate || '')}`}</td></tr>
  <tr><td><b>姓名</b></td><td>${esc(c.name)}</td><td><b>法定性別</b></td><td>${esc(c.legalGender)}</td><td><b>學號</b></td><td>${esc(c.studentId)}</td></tr>
  <tr><td><b>對象</b></td><td colspan="5">${esc(c.caseType || '')}　${esc(c.program || '')}</td></tr>
  <tr><td><b>來源</b></td><td colspan="5">${esc(c.source || '')}</td></tr>
</table>
<div class="sec-title">一、個案問題評估（可複選）</div>
<div style="padding:4px 8px;">${probBlock}</div>
<div class="sec-title">二、問題內容說明</div>
<div class="row"><b>(一)家庭概況：</b></div><div style="padding:3px 0 8px;">${printRich(d.family)}</div>
${d.familyImage ? `<div style="margin-top:6px;"><img src="${d.familyImage}" style="max-width:100%;max-height:200px;border:1px solid #ccc;border-radius:4px;" /></div>` : ''}
<div class="row" style="margin-top:6px;"><b>(二)主訴問題：</b></div><div style="padding:3px 0 8px;">${printRich(d.mainIssue)}</div>
<div class="row" style="margin-top:6px;"><b>(三)會談摘要：</b></div><div style="padding:3px 0 8px;">${printRich(d.summary)}</div>
<div class="row" style="margin-top:6px;"><b>(四)會談期待：</b></div><div style="padding:3px 0 8px;">${printRich(d.expectation)}</div>
<div class="sec-title">三、風險評估</div>
<div>${cb(d.risk === '無')} 暫無　${cb(d.risk === '有')} 有，說明：</div><div style="padding:3px 0 8px;">${esc(d.riskDesc)}</div>
<div class="sec-title">四、個別化服務計畫</div><div style="padding:4px 8px;">${printRich(d.plan)}</div>
<div class="sec-title">五、此次服務項目</div>
<div style="padding:4px 8px;">${svcBlock}</div>
<div class="row" style="margin-top:8px;text-align:right;"><b>初談人員：</b>${esc(d.interviewerName || printerName)}</div>
<div class="sec-title">六、同儕督導會議</div>
<div>${cb(d.caseType === '舊案')} (一)舊案，原主責續接　${cb(d.caseType === '新案/轉案')} (二)新案/轉案</div>
${d.caseType === '舊案' && oldCounselorName ? `<div class="row" style="margin-top:4px;"><b>原主責輔導人員：</b>${esc(oldCounselorName)}</div>` : ''}
${d.caseType !== '舊案' ? `<div class="row"><b>1. 風險評估：</b>${supRiskBlock}</div>
<div class="row"><b>2. 個案主訴議題：</b>${supTopicBlock}</div>
<div class="row"><b>3. 適切之輔導人員專長：</b>${supSkillBlock}</div>
<div class="row"><b>4. 空堂的適配性：</b>${vacancyBlock}</div>
<div class="row"><b>5. 其他：</b>${esc(d.supOther)}</div>` : ''}
<div class="sec-title">七、同儕督導會議結果：確認主責輔導人員</div>
<div class="row" style="text-align:right;margin-top:4px;"><b>主責輔導人員：</b>${esc(resultName)}</div>
${(d.notes || d.attendees) ? `<div class="sec-title">八、備註</div><div class="box">${esc(d.notes || d.attendees)}</div>` : ''}
<div class="sec-title">九、同儕督導會議參與者簽章</div>
${sigGrid}
<div class="foot">${esc(printerName ? printerName + ' 於 ' : '')}${esc(printTime)} 列印　國立屏東科技大學學生諮商中心資訊系統</div>
<script>window.addEventListener('load',()=>window.print());<\/script>
</body></html>`;
  const _iiC2 = casesData.find(x => x.id === caseId);
  _printViaIframe(html);
}
