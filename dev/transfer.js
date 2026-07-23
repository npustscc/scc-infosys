// dev/transfer.js — 畢業轉銜管理模組（拆 index.html 絞殺者第二十二刀，v269）。
// 內容為從 index.html 逐字搬出的連續區段（轉銜評估表開啟/儲存/列印/軟刪除、Excel
// 匯入、評估人指派與變更、決議與歷史 badge、快速開案小視窗與背景開案）。全域
// transferData 宣告留在主檔（v267 起與 psychTestDB 等同批集中）。
// 載入期副作用（column-0 複核）：僅 window.X = function 賦值（_adminWhToggleDay／
// _showAssessorChangeConfirm／_changeGradAssessor 等，賦值本身無外部呼叫）與
// new Set() 初始化，無裸呼叫、無 document 監聽，可安全前移到主 inline script 之前
// 載入（刀法①）。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════════════════════════
//  畢業轉銜管理模組（Graduate-Transition Module）
// ══════════════════════════════════════════════════════════════════

// ── 學制學號前綴動態設定 ────────────────────────────
function _getDegreeMapping() {
  const defaults = { bachelor: ['B','E','F','K'], master: ['M','N'], phd: ['P'] };
  if (!configData || !configData.degreeMapping) return defaults;
  return {
    bachelor: configData.degreeMapping.bachelor || defaults.bachelor,
    master:   configData.degreeMapping.master   || defaults.master,
    phd:      configData.degreeMapping.phd      || defaults.phd,
  };
}

function _buildDegreeMaps() {
  const dm = _getDegreeMapping();
  const progMap = {}, degreeMap = {};
  (dm.bachelor || []).forEach(c => { progMap[c.toUpperCase()] = 4; degreeMap[c.toUpperCase()] = '學士'; });
  (dm.master   || []).forEach(c => { progMap[c.toUpperCase()] = 2; degreeMap[c.toUpperCase()] = '碩士'; });
  (dm.phd      || []).forEach(c => { progMap[c.toUpperCase()] = 3; degreeMap[c.toUpperCase()] = '博士'; });
  return { progMap, degreeMap };
}

async function _ensureKnownPrefix(typeChar) {
  const dm = _getDegreeMapping();
  const allKnown = [...(dm.bachelor||[]), ...(dm.master||[]), ...(dm.phd||[])].map(c => c.toUpperCase());
  if (allKnown.includes(typeChar.toUpperCase())) return true;
  return new Promise(resolve => {
    const prev = document.getElementById('unknown-prefix-modal');
    if (prev) prev.remove();
    const modal = document.createElement('div');
    modal.id = 'unknown-prefix-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 12px;font-size:1.05rem;">⚠️ 偵測到未定義的學號前綴</h3>
      <p style="color:#4a5568;font-size:.9rem;margin-bottom:18px;">偵測到未定義的學號前綴「<strong>${escHtml(typeChar)}</strong>」。<br>請為其指定所屬學制以繼續操作：</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:22px;">
        <label class="upm-opt" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid #e2e8f0;border-radius:8px;">
          <input type="radio" name="upm-degree" value="bachelor" style="accent-color:#3498db;"> <span><strong>學士班</strong>（4年制）</span>
        </label>
        <label class="upm-opt" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid #e2e8f0;border-radius:8px;">
          <input type="radio" name="upm-degree" value="master" style="accent-color:#3498db;"> <span><strong>碩士班</strong>（2年制）</span>
        </label>
        <label class="upm-opt" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid #e2e8f0;border-radius:8px;">
          <input type="radio" name="upm-degree" value="phd" style="accent-color:#3498db;"> <span><strong>博士班</strong>（3年制）</span>
        </label>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="upm-cancel" class="btn btn-secondary">取消操作</button>
        <button id="upm-confirm" class="btn btn-primary">確認並繼續</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('input[name="upm-degree"]').forEach(radio => {
      radio.addEventListener('change', () => {
        modal.querySelectorAll('.upm-opt').forEach(l => l.style.borderColor = '#e2e8f0');
        radio.closest('.upm-opt').style.borderColor = '#3498db';
      });
    });
    document.getElementById('upm-cancel').onclick = () => { modal.remove(); resolve(false); };
    document.getElementById('upm-confirm').onclick = async () => {
      const chosen = modal.querySelector('input[name="upm-degree"]:checked')?.value;
      if (!chosen) { alert('請先選擇學制。'); return; }
      const tc = typeChar.toUpperCase();
      if (configData) {
        if (!configData.degreeMapping) configData.degreeMapping = { bachelor: ['B','E','F','K'], master: ['M','N'], phd: ['P'] };
        if (!configData.degreeMapping[chosen]) configData.degreeMapping[chosen] = [];
        if (!configData.degreeMapping[chosen].includes(tc)) configData.degreeMapping[chosen].push(tc);
        try { await driveUpdateJsonFile(CONFIG_FILE, configData); } catch (_) {}
        if (document.getElementById('admin-degree-wrap')) renderAdminDegreeMapping();
      }
      modal.remove(); resolve(true);
    };
  });
}

async function _ensureUnknownPrefixes(sids) {
  const seen = new Set();
  for (const sid of (sids || [])) {
    if (!sid || sid.length < 2) continue;
    const tc = sid[0].toUpperCase();
    if (seen.has(tc) || !/^[A-Z]$/.test(tc)) continue;
    seen.add(tc);
    const ok = await _ensureKnownPrefix(tc);
    if (!ok) return false;
  }
  return true;
}

function renderAdminDegreeMapping() {
  const el = document.getElementById('admin-degree-wrap');
  if (!el) return;
  const dm = _getDegreeMapping();
  const sections = [
    { key: 'bachelor', label: '學士班', years: 4, color: '#2b6cb0' },
    { key: 'master',   label: '碩士班', years: 2, color: '#6b46c1' },
    { key: 'phd',      label: '博士班', years: 3, color: '#c05621' },
  ];
  el.innerHTML = `
    <div style="font-size:.78rem;color:#718096;margin-bottom:10px;padding:6px 10px;background:#f7fafc;border-radius:5px;">
      💡 提示：字母 chip 可拖曳到其他學制列以改變歸屬（等同修改前綴對應）。
    </div>` + sections.map(s => {
    const chips = (dm[s.key] || []).map(c =>
      `<span draggable="true" data-char="${escHtml(c)}" data-src-key="${escHtml(s.key)}"
        ondragstart="_dmDragStart(event)" ondragend="_dmDragEnd(event)"
        style="display:inline-flex;align-items:center;gap:2px;background:${s.color}18;color:${s.color};border:1px solid ${s.color}50;border-radius:12px;padding:2px 8px 2px 10px;font-size:.85rem;font-weight:700;cursor:grab;"
        title="拖曳至其他學制以變更歸屬">${escHtml(c)}<button onclick="_adminRemovePrefix('${escHtml(s.key)}','${escHtml(c)}')" title="移除" style="background:none;border:none;cursor:pointer;color:${s.color};font-size:1rem;line-height:1;padding:0 0 0 3px;margin:0;">×</button></span>`
    ).join(' ');
    return `<div class="dm-drop-row" data-key="${escHtml(s.key)}"
      ondragover="_dmDragOver(event)" ondragleave="_dmDragLeave(event)" ondrop="_dmDrop(event)"
      style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 8px;border-bottom:1px solid #f0f4f8;border-radius:6px;transition:background .15s;">
      <span style="font-weight:600;font-size:.88rem;width:92px;color:${s.color};flex-shrink:0;">${escHtml(s.label)}（${s.years}年）</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1;min-height:28px;">
        ${chips || '<span style="font-size:.82rem;color:#a0aec0;">（尚未設定；可從其他學制拖曳字母過來）</span>'}
      </div>
      <div style="display:inline-flex;gap:4px;align-items:center;flex-shrink:0;">
        <input type="text" id="dm-input-${s.key}" maxlength="1" placeholder="字母" style="width:44px;padding:4px 6px;border:1px solid #cbd5e0;border-radius:6px;font-size:.85rem;text-align:center;text-transform:uppercase;" oninput="this.value=this.value.toUpperCase()">
        <button class="btn btn-secondary btn-sm" onclick="_adminAddPrefix('${escHtml(s.key)}')">新增</button>
      </div>
    </div>`;
  }).join('');
}
// ── 學制前綴拖曳 handlers ──
function _dmDragStart(ev) {
  const el = ev.currentTarget;
  ev.dataTransfer.setData('text/plain', JSON.stringify({ ch: el.dataset.char, src: el.dataset.srcKey }));
  ev.dataTransfer.effectAllowed = 'move';
  el.style.opacity = '.5';
}
function _dmDragEnd(ev) { ev.currentTarget.style.opacity = ''; }
function _dmDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.style.background = '#ebf8ff';
}
function _dmDragLeave(ev) { ev.currentTarget.style.background = ''; }
async function _dmDrop(ev) {
  ev.preventDefault();
  const row = ev.currentTarget;
  row.style.background = '';
  const destKey = row.dataset.key;
  let payload = {};
  try { payload = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); } catch (_) {}
  const { ch, src } = payload;
  if (!ch || !src || !destKey) return;
  if (src === destKey) return; // 同一學制內拖曳無意義
  if (!configData.degreeMapping) configData.degreeMapping = { bachelor:['B','E','F','K'], master:['M','N'], phd:['P'] };
  const dm = configData.degreeMapping;
  if (!Array.isArray(dm[src])) dm[src] = [];
  if (!Array.isArray(dm[destKey])) dm[destKey] = [];
  dm[src] = dm[src].filter(x => x !== ch);
  if (!dm[destKey].includes(ch)) dm[destKey].push(ch);
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('調整學制前綴對應', null, null, `字母 ${ch}：${src} → ${destKey}`);
    renderAdminDegreeMapping();
    showToast?.(`已將字母「${ch}」改為 ${({bachelor:'學士',master:'碩士',phd:'博士'})[destKey]||destKey}`, 'success');
  } catch (e) {
    alert('儲存失敗：' + e.message);
    // 回滾
    dm[destKey] = dm[destKey].filter(x => x !== ch);
    if (!dm[src].includes(ch)) dm[src].push(ch);
    renderAdminDegreeMapping();
  }
}

async function _adminAddPrefix(degreeKey) {
  const input = document.getElementById(`dm-input-${degreeKey}`);
  const c = (input?.value || '').trim().toUpperCase();
  if (!c || !/^[A-Z]$/.test(c)) { alert('請輸入單一英文字母。'); return; }
  const dm = _getDegreeMapping();
  const allChars = [...(dm.bachelor||[]), ...(dm.master||[]), ...(dm.phd||[])].map(x => x.toUpperCase());
  if (allChars.includes(c)) { alert(`字母「${c}」已存在於其他學制的對應中。`); return; }
  if (!configData.degreeMapping) configData.degreeMapping = { bachelor: ['B','E','F','K'], master: ['M','N'], phd: ['P'] };
  if (!configData.degreeMapping[degreeKey]) configData.degreeMapping[degreeKey] = [];
  configData.degreeMapping[degreeKey].push(c);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); if (input) input.value = ''; renderAdminDegreeMapping(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

async function _adminRemovePrefix(degreeKey, char) {
  if (!confirm(`確認移除學號前綴「${char}」？移除後以此字母開頭的學號將無法判斷學制。`)) return;
  if (!configData?.degreeMapping) return;
  if (configData.degreeMapping[degreeKey]) configData.degreeMapping[degreeKey] = configData.degreeMapping[degreeKey].filter(c => c !== char);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminDegreeMapping(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

function renderAdminDeptCollege() {
  const el = document.getElementById('admin-dept-college-wrap');
  if (!el) return;
  const dc = _getDeptToCollege();
  const colleges = [...new Set(Object.values(dc))].sort();
  const byCollege = {};
  colleges.forEach(col => { byCollege[col] = Object.keys(dc).filter(d => dc[d] === col).sort(); });
  const usingConfig = configData?.deptToCollege && Object.keys(configData.deptToCollege).length > 0;
  el.innerHTML = `
    <div style="margin-bottom:12px;font-size:.82rem;color:${usingConfig?'#276749':'#718096'};background:${usingConfig?'#f0fff4':'#f7fafc'};border:1px solid ${usingConfig?'#9ae6b4':'#e2e8f0'};padding:8px 12px;border-radius:6px;">
      ${usingConfig ? '✓ 目前使用 config.json 中的自訂對照表。' : '⚠ 目前使用系統內建對照表（未自訂），修改後將寫入 config.json。'}
    </div>
    <div style="font-size:.78rem;color:#718096;margin-bottom:10px;padding:6px 10px;background:#f7fafc;border-radius:5px;">
      💡 提示：系所 chip 可拖曳到其他學院區塊以改變歸屬（等同修改對照表）。統計、新開案的學院顯示會即時反映；歷史個案的顯示因走 live lookup 也會一併更新。
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="dc-input-dept" class="field-input" placeholder="系所名稱" style="flex:1;min-width:180px;max-width:280px;" />
      <input type="text" id="dc-input-college" class="field-input" placeholder="學院名稱" style="flex:1;min-width:140px;max-width:200px;" list="dc-college-list" />
      <datalist id="dc-college-list">${colleges.map(c=>`<option value="${escHtml(c)}">`).join('')}</datalist>
      <button class="btn btn-primary btn-sm" onclick="_adminAddDeptCollege()">新增對應</button>
      ${usingConfig ? '' : `<button class="btn btn-secondary btn-sm" onclick="_adminInitDeptCollegeFromDefault()">匯入系統預設</button>`}
    </div>
    ${colleges.map(col => `
      <div class="dc-drop-group" data-college="${escHtml(col)}"
        ondragover="_dcDragOver(event)" ondragleave="_dcDragLeave(event)" ondrop="_dcDrop(event)"
        style="margin-bottom:14px;border-radius:6px;padding:2px;transition:background .15s;">
        <div style="font-weight:700;font-size:.88rem;color:#2b6cb0;background:#ebf8ff;padding:5px 10px;border-radius:6px;margin-bottom:6px;">${escHtml(col)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 4px;min-height:28px;">
          ${(byCollege[col]||[]).map(dept =>
            `<span draggable="true" data-dept="${escHtml(dept)}" data-src-college="${escHtml(col)}"
              ondragstart="_dcDragStart(event)" ondragend="_dcDragEnd(event)"
              style="display:inline-flex;align-items:center;gap:2px;background:#edf2f7;color:#2d3748;border:1px solid #cbd5e0;border-radius:12px;padding:2px 8px 2px 10px;font-size:.83rem;cursor:grab;"
              title="拖曳至其他學院區塊以變更歸屬">
              ${escHtml(dept)}<button onclick="_adminRemoveDeptCollege('${escHtml(dept)}')" title="移除" style="background:none;border:none;cursor:pointer;color:#718096;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
            </span>`).join('') || '<span style="font-size:.78rem;color:#a0aec0;">（可從其他學院拖曳系所過來）</span>'}
        </div>
      </div>`).join('')}
    ${Object.keys(dc).length === 0 ? '<div style="color:#a0aec0;font-size:.85rem;">尚無對應資料。</div>' : ''}
    ${_renderDeptAbbrevAdmin(dc)}
    ${_renderPrintAbbrevAdmin(dc)}`;
}

// v188：列印用系所縮寫管理（B3）——晤談紀錄列印「班級」欄位組字用；與上方「系所簡寫對照」
// （deptAbbrevMap，信件簡寫→正式系所名，方向相反）無關，勿混用勿改壞。
function _renderPrintAbbrevAdmin(dc) {
  const custom = configData?.deptPrintAbbrev || {};
  const depts = Object.keys(dc).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const rows = depts.map(d => {
    const isCustom = Object.prototype.hasOwnProperty.call(custom, d) && !!custom[d];
    const val = isCustom ? custom[d] : (DEPT_PRINT_ABBREV_DEFAULT[d] || '');
    return `
    <div class="pa-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 10px;border-bottom:1px solid #f0f4f8;font-size:.85rem;">
      <span style="flex:1;min-width:200px;color:#2d3748;">${escHtml(d)}</span>
      <input type="text" class="field-input pa-input" data-dept="${escHtml(d)}" value="${escHtml(val)}" maxlength="4"
        style="width:70px;text-align:center;padding:3px 6px;" />
      <span style="font-size:.72rem;color:${isCustom?'#276749':'#a0aec0'};min-width:36px;">${isCustom?'已自訂':'預設'}</span>
      <button class="btn btn-secondary btn-sm" onclick="_adminSaveDeptPrintAbbrev(this)" style="padding:3px 10px;font-size:.78rem;">儲存</button>
    </div>`;
  }).join('');
  return `
    <div style="margin-top:24px;border-top:2px solid #e2e8f0;padding-top:14px;">
      <div style="font-weight:700;font-size:.92rem;color:#2d3748;margin-bottom:6px;">🖨️ 列印用系所縮寫</div>
      <div style="font-size:.78rem;color:#718096;margin-bottom:10px;padding:6px 10px;background:#f7fafc;border-radius:5px;">
        用於晤談紀錄列印的班級欄位（如「四休運四A」）。未自訂時使用系統內建預設縮寫；儲存後立即生效。
      </div>
      ${rows || '<div style="color:#a0aec0;font-size:.85rem;">尚無系所資料。</div>'}
    </div>`;
}

async function _adminSaveDeptPrintAbbrev(btn) {
  const row = btn.closest('.pa-row');
  const input = row?.querySelector('.pa-input');
  if (!input) return;
  const dept = input.dataset.dept;
  const val = input.value.trim();
  if (!val) { alert('請填寫縮寫。'); return; }
  if (!configData.deptPrintAbbrev) configData.deptPrintAbbrev = {};
  const prev = configData.deptPrintAbbrev[dept];
  configData.deptPrintAbbrev[dept] = val;
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('修改列印用系所縮寫', null, null, `${dept}：${prev || DEPT_PRINT_ABBREV_DEFAULT[dept] || '（無）'} → ${val}`);
    renderAdminDeptCollege();
    showToast?.(`已儲存「${dept}」的列印縮寫`, 'success');
  } catch (e) {
    if (prev !== undefined) configData.deptPrintAbbrev[dept] = prev; else delete configData.deptPrintAbbrev[dept];
    alert('儲存失敗：' + e.message);
  }
}

// 系所簡寫對照管理（renderAdminDeptCollege 的附加區塊）
function _renderDeptAbbrevAdmin(dc) {
  const map = _getDeptAbbrevMap();
  const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'zh-TW'));
  const deptOpts = Object.keys(dc).sort((a, b) => a.localeCompare(b, 'zh-TW'))
    .map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
  const rows = entries.map(([raw, dept]) => `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 10px;border-bottom:1px solid #f0f4f8;font-size:.85rem;">
      <span style="font-weight:600;color:#2d3748;">${escHtml(raw)}</span>
      <span style="color:#a0aec0;">→</span>
      <span style="color:${dept ? '#2b6cb0' : '#a0aec0'};">${dept ? escHtml(dept) : '（無法判別）'}</span>
      <button data-raw="${encodeURIComponent(raw)}" onclick="_adminRemoveDeptAbbrev(this)" title="移除此對照（會重新出現在待辦頁協助歸類清單）"
        style="margin-left:auto;background:none;border:none;cursor:pointer;color:#718096;font-size:1rem;line-height:1;">×</button>
    </div>`).join('');
  return `
    <div style="margin-top:24px;border-top:2px solid #e2e8f0;padding-top:14px;">
      <div style="font-weight:700;font-size:.92rem;color:#2d3748;margin-bottom:6px;">🧩 系所簡寫對照（身心調適假信件擷取用）</div>
      <div style="font-size:.78rem;color:#718096;margin-bottom:10px;padding:6px 10px;background:#f7fafc;border-radius:5px;">
        信件中擷取到的系所簡寫會依此表對應到正式系所（進而對到學院統計）。無法自動對應的簡寫會出現在「待辦事項」頁的「協助系統歸類」區塊，全體同仁都可協助認領歸類。
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="da-input-raw" class="field-input" placeholder="簡寫（如信件中的原文）" style="flex:1;min-width:160px;max-width:240px;" />
        <select id="da-input-dept" class="field-select" style="max-width:220px;">
          <option value="">—對應正式系所—</option>${deptOpts}
        </select>
        <button class="btn btn-primary btn-sm" onclick="_adminAddDeptAbbrev()">新增對照</button>
      </div>
      ${rows || '<div style="color:#a0aec0;font-size:.85rem;">尚無簡寫對照。</div>'}
    </div>`;
}

async function _adminAddDeptAbbrev() {
  const raw = (document.getElementById('da-input-raw')?.value || '').trim();
  const dept = document.getElementById('da-input-dept')?.value || '';
  if (!raw) { alert('請填寫簡寫原文。'); return; }
  if (!dept) { alert('請選擇對應的正式系所。'); return; }
  await _saveDeptAbbrev(raw, dept, null);
  renderAdminDeptCollege();
}

async function _adminRemoveDeptAbbrev(btn) {
  const raw = decodeURIComponent(btn.getAttribute('data-raw') || '');
  if (!confirm(`確認移除「${raw}」的簡寫對照？`)) return;
  const prev = configData.deptAbbrevMap?.[raw];
  if (configData.deptAbbrevMap) delete configData.deptAbbrevMap[raw];
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('移除系所簡寫對照', null, null, `「${raw}」（原對應：${prev || '無法判別'}）`);
    renderAdminDeptCollege();
    _renderClassifyHelpSection();
  } catch (e) {
    if (prev !== undefined) { if (!configData.deptAbbrevMap) configData.deptAbbrevMap = {}; configData.deptAbbrevMap[raw] = prev; }
    alert('儲存失敗：' + e.message);
  }
}
// ── 系所→學院 拖曳 handlers ──
function _dcDragStart(ev) {
  const el = ev.currentTarget;
  ev.dataTransfer.setData('text/plain', JSON.stringify({ dept: el.dataset.dept, src: el.dataset.srcCollege }));
  ev.dataTransfer.effectAllowed = 'move';
  el.style.opacity = '.5';
}
function _dcDragEnd(ev) { ev.currentTarget.style.opacity = ''; }
function _dcDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.style.background = '#f0fff4';
}
function _dcDragLeave(ev) { ev.currentTarget.style.background = ''; }
async function _dcDrop(ev) {
  ev.preventDefault();
  const grp = ev.currentTarget;
  grp.style.background = '';
  const destCollege = grp.dataset.college;
  let payload = {};
  try { payload = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); } catch (_) {}
  const { dept, src } = payload;
  if (!dept || !destCollege) return;
  if (src === destCollege) return;
  if (!configData.deptToCollege) configData.deptToCollege = { ..._getDeptToCollege() };
  const prev = configData.deptToCollege[dept];
  configData.deptToCollege[dept] = destCollege;
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('調整系所學院歸屬', null, null, `${dept}：${prev||'（未設）'} → ${destCollege}`);
    renderAdminDeptCollege();
    showToast?.(`已將「${dept}」歸入「${destCollege}」`, 'success');
  } catch (e) {
    alert('儲存失敗：' + e.message);
    // 回滾
    if (prev) configData.deptToCollege[dept] = prev; else delete configData.deptToCollege[dept];
    renderAdminDeptCollege();
  }
}

async function _adminAddDeptCollege() {
  const dept = (document.getElementById('dc-input-dept')?.value || '').trim();
  const col  = (document.getElementById('dc-input-college')?.value || '').trim();
  if (!dept) { alert('請填寫系所名稱。'); return; }
  if (!col)  { alert('請填寫學院名稱。'); return; }
  if (!configData.deptToCollege) configData.deptToCollege = { ..._getDeptToCollege() };
  configData.deptToCollege[dept] = col;
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); document.getElementById('dc-input-dept').value=''; renderAdminDeptCollege(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

async function _adminRemoveDeptCollege(dept) {
  if (!confirm(`確認移除「${dept}」的學院對應？`)) return;
  if (!configData.deptToCollege) configData.deptToCollege = { ..._getDeptToCollege() };
  delete configData.deptToCollege[dept];
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminDeptCollege(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

async function _adminInitDeptCollegeFromDefault() {
  if (!confirm('將系統內建的系所-學院對照表匯入 config.json 作為初始設定？')) return;
  configData.deptToCollege = { ...DEPT_TO_COLLEGE };
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminDeptCollege(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

function _getEmgRelPresets() {
  return configData?.emgRelationPresets || ['父','母','兄','姊','弟','妹','配偶','祖父','祖母','外祖父','外祖母','友人'];
}

// ── B 案原由 快速選項 ─────────────────────────────
function _getBCaseReasonPresets() {
  return configData?.bCaseReasonPresets || ['性平無主案'];
}
function renderAdminBReasons() {
  const el = document.getElementById('admin-breasons-wrap');
  if (!el) return;
  const presets = _getBCaseReasonPresets();
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="breasons-input" class="field-input" placeholder="新增 B 案原由…" style="flex:1;min-width:140px;max-width:260px;" />
      <button class="btn btn-primary btn-sm" onclick="_adminAddBReason()">新增</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${presets.length ? presets.map(r =>
        `<span style="display:inline-flex;align-items:center;gap:2px;background:#fffaf0;color:#7c2d12;border:1px solid #fbd38d;border-radius:12px;padding:3px 10px;font-size:.85rem;">
          ${escHtml(r)}<button onclick="_adminRemoveBReason('${escHtml(r)}')" title="移除" style="background:none;border:none;cursor:pointer;color:#7c2d12;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
        </span>`
      ).join('') : '<span style="font-size:.83rem;color:#a0aec0;">尚無選項；新增至少一項後 B 案表單才能送出。</span>'}
    </div>`;
}
async function _adminAddBReason() {
  const val = (document.getElementById('breasons-input')?.value || '').trim();
  if (!val) { alert('請填寫 B 案原由。'); return; }
  if (!configData.bCaseReasonPresets) configData.bCaseReasonPresets = [..._getBCaseReasonPresets()];
  if (configData.bCaseReasonPresets.includes(val)) { alert('此選項已存在。'); return; }
  configData.bCaseReasonPresets.push(val);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); document.getElementById('breasons-input').value=''; renderAdminBReasons(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminRemoveBReason(val) {
  if (!confirm(`確認移除「${val}」？\n\n已使用此選項的既有個案資料不受影響。`)) return;
  if (!configData.bCaseReasonPresets) configData.bCaseReasonPresets = [..._getBCaseReasonPresets()];
  configData.bCaseReasonPresets = configData.bCaseReasonPresets.filter(r => r !== val);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminBReasons(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

// 新開案表單：B 案 chips 相關
let _ncBReasonsSelected = new Set();
function _ncOnAbTypeChange() {
  const ab = document.querySelector('input[name="nc-ab-type"]:checked')?.value || '';
  const section = document.getElementById('nc-b-reasons-section');
  if (!section) return;
  if (ab === 'B案') {
    section.style.display = '';
    _ncRenderBReasonChips();
  } else {
    section.style.display = 'none';
    _ncBReasonsSelected.clear();
  }
}
function _ncRenderBReasonChips() {
  const wrap = document.getElementById('nc-b-reasons-chips');
  if (!wrap) return;
  const presets = _getBCaseReasonPresets();
  if (!presets.length) {
    wrap.innerHTML = '<span style="font-size:.82rem;color:#c53030;">尚無 B 案原由選項，請至「後台管理 → 快速選項」新增。</span>';
    return;
  }
  wrap.innerHTML = presets.map(r => {
    const selected = _ncBReasonsSelected.has(r);
    const bg = selected ? '#fbd38d' : '#fff';
    const color = selected ? '#7c2d12' : '#4a5568';
    const border = selected ? '#c05621' : '#cbd5e0';
    return `<span onclick="_ncToggleBReason('${escHtml(r)}')" style="cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:3px;background:${bg};color:${color};border:1px solid ${border};border-radius:14px;padding:4px 12px;font-size:.85rem;font-weight:${selected?600:400};">
      ${selected ? '✓ ' : ''}${escHtml(r)}
    </span>`;
  }).join('');
}
function _ncToggleBReason(val) {
  if (_ncBReasonsSelected.has(val)) _ncBReasonsSelected.delete(val);
  else _ncBReasonsSelected.add(val);
  _ncRenderBReasonChips();
}
// 表單內即席新增 B 案原由：即時可勾選 + 同步存到 config 供未來共用
async function _ncAddBReasonInline() {
  const input = document.getElementById('nc-b-reason-new');
  if (!input) return;
  const val = (input.value || '').trim();
  if (!val) { alert('請輸入 B 案原由。'); return; }
  const presets = _getBCaseReasonPresets();
  if (presets.includes(val)) {
    // 已存在：直接勾選、不重複寫入
    _ncBReasonsSelected.add(val);
    _ncRenderBReasonChips();
    input.value = '';
    return;
  }
  if (!configData.bCaseReasonPresets) configData.bCaseReasonPresets = [...presets];
  configData.bCaseReasonPresets.push(val);
  _ncBReasonsSelected.add(val);
  _ncRenderBReasonChips();
  input.value = '';
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); }
  catch (e) { showToast('已加入本次選單，但同步至後台失敗：' + e.message, 'warn'); }
}


function renderAdminPresets() {
  const el = document.getElementById('admin-emgrel-wrap');
  if (!el) return;
  const presets = _getEmgRelPresets();
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <input type="text" id="emgrel-input" class="field-input" placeholder="新增關係詞…" style="flex:1;min-width:140px;max-width:220px;" />
      <button class="btn btn-primary btn-sm" onclick="_adminAddEmgRelPreset()">新增</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${presets.length ? presets.map(r =>
        `<span style="display:inline-flex;align-items:center;gap:2px;background:#ebf8ff;color:#2b6cb0;border:1px solid #90cdf4;border-radius:12px;padding:3px 10px;font-size:.85rem;">
          ${escHtml(r)}<button onclick="_adminRemoveEmgRelPreset('${escHtml(r)}')" title="移除" style="background:none;border:none;cursor:pointer;color:#2b6cb0;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
        </span>`
      ).join('') : '<span style="font-size:.83rem;color:#a0aec0;">尚無自訂選項。</span>'}
    </div>`;
}

async function _adminAddEmgRelPreset() {
  const val = (document.getElementById('emgrel-input')?.value || '').trim();
  if (!val) { alert('請填寫關係詞。'); return; }
  if (!configData.emgRelationPresets) configData.emgRelationPresets = [..._getEmgRelPresets()];
  if (configData.emgRelationPresets.includes(val)) { alert('此選項已存在。'); return; }
  configData.emgRelationPresets.push(val);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); document.getElementById('emgrel-input').value=''; renderAdminPresets(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

async function _adminRemoveEmgRelPreset(val) {
  if (!confirm(`確認移除「${val}」？`)) return;
  if (!configData.emgRelationPresets) configData.emgRelationPresets = [..._getEmgRelPresets()];
  configData.emgRelationPresets = configData.emgRelationPresets.filter(r => r !== val);
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminPresets(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}

// ── 上班時間設定 UI ──────────────────────────────
// 支援每個星期各自不同的上班時段（例：週一/週四晚班到 21:00，週二三五 18:00）
function renderAdminWorkHours() {
  const el = document.getElementById('admin-workhours-wrap');
  if (!el) return;
  const cfg = _getWorkHoursConfig();
  const hourOpts = n => Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === n ? ' selected' : ''}>${String(h).padStart(2,'0')}:00</option>`
  ).join('');
  const dowLabels = ['週日','週一','週二','週三','週四','週五','週六'];
  const dowOrder  = [1,2,3,4,5,6,0]; // 顯示順序：週一~週日
  const dayRow = dow => {
    const h = cfg.weeklyHours?.[dow];
    const isWork = !!(h && Number.isFinite(h.start) && Number.isFinite(h.end));
    const s  = h?.start ?? 8;
    const e  = h?.end   ?? 18;
    const we = Number.isFinite(h?.workEnd) ? h.workEnd : Math.min(e, s + 9); // 下班時間；舊資料無此欄位時預覽 fallback 值
    const fieldLabel = txt => `<span style="font-size:.68rem;color:#a0aec0;display:block;line-height:1;margin-bottom:2px;">${txt}</span>`;
    return `<div style="display:flex;align-items:flex-end;gap:8px;padding:6px 0;flex-wrap:wrap;">
      <label style="min-width:110px;font-size:.88rem;cursor:pointer;padding-bottom:4px;">
        <input type="checkbox" class="wh-day-cb" data-dow="${dow}" ${isWork?'checked':''} onchange="_adminWhToggleDay(${dow},this.checked)">
        ${dowLabels[dow]}
      </label>
      <span>${fieldLabel('上班')}<select class="wh-day-start" data-dow="${dow}" ${isWork?'':'disabled'} style="padding:4px 6px;border:1px solid #cbd5e0;border-radius:5px;font-size:.85rem;">${hourOpts(s)}</select></span>
      <span style="font-size:.85rem;color:#4a5568;padding-bottom:5px;">~</span>
      <span>${fieldLabel('下班')}<select class="wh-day-workend" data-dow="${dow}" ${isWork?'':'disabled'} style="padding:4px 6px;border:1px solid #cbd5e0;border-radius:5px;font-size:.85rem;">${hourOpts(we)}</select></span>
      <span style="font-size:.85rem;color:#4a5568;padding-bottom:5px;">~</span>
      <span>${fieldLabel('彈性下班')}<select class="wh-day-end" data-dow="${dow}" ${isWork?'':'disabled'} style="padding:4px 6px;border:1px solid #cbd5e0;border-radius:5px;font-size:.85rem;">${hourOpts(e)}</select></span>
      <span style="font-size:.78rem;color:#a0aec0;padding-bottom:5px;">${isWork ? `（差勤下班 ${String(we).padStart(2,'0')}:00；${String(s).padStart(2,'0')}:00 前、${String(e).padStart(2,'0')}:00 後系統視為異常上線）` : '（非上班日）'}</span>
    </div>`;
  };
  const dateChips = (arr, id) => (arr && arr.length)
    ? arr.map(d => `<span style="display:inline-flex;align-items:center;gap:2px;background:#faf5ff;color:#553c9a;border:1px solid #d6bcfa;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;">
        ${escHtml(d)}<button onclick="_adminWhRemoveDate('${id}','${escHtml(d)}')" style="background:none;border:none;cursor:pointer;color:#553c9a;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
      </span>`).join('')
    : '<span style="font-size:.83rem;color:#a0aec0;">（尚無）</span>';
  // #4 輪值上班：人員下拉 + 輪值 chips（日期·姓名）
  // #4b：輪值人員下拉——依輔導人員列表排序，只列「專任」「實習生」，只顯示姓名（不含職稱），套用身分色
  const dutyPersonOpts = COUNSELOR_ROLE_GROUPS
    .filter(g => g.label === '專任' || g.label === '實習生')
    .map(group => {
      const entries = Object.entries(configData?.users || {})
        .filter(([, info]) => info && !info.disabled && info.name && group.roles.includes(info.role || ''))
        .sort(([, ia], [, ib]) => {
          const oa = group.roles.indexOf(ia.role || ''), ob = group.roles.indexOf(ib.role || '');
          return oa !== ob ? oa - ob : (ia.name || '').localeCompare(ib.name || '', 'zh');
        });
      if (!entries.length) return '';
      return `<optgroup label="${escHtml(group.label)}">` +
        entries.map(([email, info]) => `<option value="${escHtml(email)}" style="${roleColorOptionStyle(info.role)}">${escHtml(info.name)}</option>`).join('') +
        '</optgroup>';
    }).join('');
  const dutyChips = (arr) => (arr && arr.length)
    ? [...arr].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(r => `<span style="display:inline-flex;align-items:center;gap:2px;background:#fffaf0;color:#9c4221;border:1px solid #fbd38d;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;">
        ${escHtml(r.date)} · ${escHtml(configData?.users?.[r.email]?.name || r.email)}<button onclick="_adminWhRemoveDuty('${escHtml(r.date)}','${escHtml(r.email)}')" style="background:none;border:none;cursor:pointer;color:#9c4221;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
      </span>`).join('')
    : '<span style="font-size:.83rem;color:#a0aec0;">（尚無）</span>';
  // #4a：學期時段 chips（from~to）
  const semPeriodChips = (arr) => (arr && arr.length)
    ? [...arr].sort((a, b) => (a.from || '').localeCompare(b.from || '')).map((p, i) => `<span style="display:inline-flex;align-items:center;gap:2px;background:#ebf8ff;color:#2b6cb0;border:1px solid #90cdf4;border-radius:12px;padding:3px 10px;margin:2px;font-size:.85rem;">
        ${escHtml(p.from)} ~ ${escHtml(p.to)}<button onclick="_adminWhRemoveSemester(${i})" style="background:none;border:none;cursor:pointer;color:#2b6cb0;font-size:1rem;line-height:1;padding:0 0 0 3px;">×</button>
      </span>`).join('')
    : '<span style="font-size:.83rem;color:#a0aec0;">（尚無；未設定學期時段時，一律沿用每日上班時段，不做學期/非學期區分）</span>';
  const _nonSemEnd = Number.isFinite(cfg.nonSemesterEndHour) ? cfg.nonSemesterEndHour : 18;
  el.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">
        每日上班時段
        <span style="font-size:.75rem;font-weight:400;color:#718096;">（勾選為上班日；各日可設不同時段，例如週一/週四延到 21:00）</span>
      </div>
      <div style="font-size:.75rem;color:#718096;margin-bottom:8px;">
        「下班」＝差勤實際下班時間，請假時數計算與請假申請表單起訖時間預設值皆以此為準；
        「彈性下班」＝系統判斷「異常上線」的時間邊界（超過此時間仍在系統上操作個案資料，會列入非上班時間監督），與請假時數無關。
      </div>
      ${dowOrder.map(dayRow).join('')}
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">假日（覆蓋上班日）</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="wh-holiday-input" class="field-input" style="max-width:180px;">
        <button class="btn btn-secondary btn-sm" onclick="_adminWhAddDate('holidays','wh-holiday-input')">加入假日</button>
      </div>
      <div id="wh-holidays-chips">${dateChips(cfg.holidays, 'holidays')}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">
        補班日
        <span style="font-size:.75rem;font-weight:400;color:#718096;">（該日視為上班日；時段沿用該日對應星期的設定，若該星期未設則用「其他星期的第一組時段」）</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="wh-extra-input" class="field-input" style="max-width:180px;">
        <button class="btn btn-secondary btn-sm" onclick="_adminWhAddDate('extraWorkDays','wh-extra-input')">加入補班日</button>
      </div>
      <div id="wh-extras-chips">${dateChips(cfg.extraWorkDays, 'extraWorkDays')}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">
        輪值上班（寒暑假等僅一人上班的排班）
        <span style="font-size:.75rem;font-weight:400;color:#718096;">（指定某日的輪值人員；該日僅輪值者視為上班，其他人若上線／看改個案會列入「非上班時間監督」通知）</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="wh-duty-date" class="field-input" style="max-width:180px;">
        <select id="wh-duty-person" class="field-input" style="max-width:220px;"><option value="">選擇輪值人員…</option>${dutyPersonOpts}</select>
        <button class="btn btn-secondary btn-sm" onclick="_adminWhAddDuty()">加入輪值</button>
      </div>
      <div id="wh-duty-chips">${dutyChips(cfg.dutyRoster)}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">
        學期時段（此區間內才有晚班）
        <span style="font-size:.75rem;font-weight:400;color:#718096;">（設定學期起訖；學期期間沿用上方每日上班時段(含晚班)，非學期期間(寒暑假等)下班時間上限降為下方時數＝無晚班）</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="wh-sem-from" class="field-input" style="max-width:170px;">
        <span style="color:#718096;">~</span>
        <input type="date" id="wh-sem-to" class="field-input" style="max-width:170px;">
        <button class="btn btn-secondary btn-sm" onclick="_adminWhAddSemester()">加入學期時段</button>
      </div>
      <div id="wh-sem-chips">${semPeriodChips(cfg.semesterPeriods)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:.82rem;color:#4a5568;">非學期下班時間上限（無晚班）：</label>
        <select id="wh-nonsem-end" class="field-input" style="width:auto;" onchange="_adminWhSetNonSemEnd(this.value)">
          ${[16,17,18,19,20].map(h => `<option value="${h}"${_nonSemEnd === h ? ' selected' : ''}>${String(h).padStart(2,'0')}:00</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;padding-top:12px;border-top:1px solid #e2e8f0;">
      <button class="btn btn-primary" onclick="_adminSaveWorkHours()">儲存上班時間設定</button>
      <span id="wh-status" style="font-size:.82rem;color:#718096;"></span>
    </div>`;
}
window._adminWhToggleDay = function(dow, checked) {
  const s  = document.querySelector(`.wh-day-start[data-dow="${dow}"]`);
  const we = document.querySelector(`.wh-day-workend[data-dow="${dow}"]`);
  const e  = document.querySelector(`.wh-day-end[data-dow="${dow}"]`);
  if (s) s.disabled = !checked;
  if (we) we.disabled = !checked;    // 下班；預設值（17 或 min(彈性下班,上班+9)）已由 dayRow 渲染時算好
  if (e) e.disabled = !checked;
};
async function _adminWhAddDate(field, inputId) {
  const val = (document.getElementById(inputId)?.value || '').trim();
  if (!val) { alert('請先選擇日期。'); return; }
  const cur = _getWorkHoursConfig();
  const arr = [...(cur[field] || [])];
  if (arr.includes(val)) { alert('此日期已存在。'); return; }
  arr.push(val); arr.sort();
  const next = { ...cur, [field]: arr };
  configData.workHoursConfig = next;
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminWorkHours(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminWhRemoveDate(field, val) {
  if (!confirm(`確認移除「${val}」？`)) return;
  const cur = _getWorkHoursConfig();
  const arr = (cur[field] || []).filter(d => d !== val);
  const next = { ...cur, [field]: arr };
  configData.workHoursConfig = next;
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminWorkHours(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
// #4：輪值上班——新增/移除某日的輪值人員（dutyRoster: [{date,email}]）
async function _adminWhAddDuty() {
  const date  = (document.getElementById('wh-duty-date')?.value || '').trim();
  const email = (document.getElementById('wh-duty-person')?.value || '').trim();
  if (!date || !email) { alert('請選擇日期與輪值人員。'); return; }
  const cur = _getWorkHoursConfig();
  const arr = [...(cur.dutyRoster || [])];
  if (arr.some(r => r.date === date && r.email === email)) { alert('此輪值已存在。'); return; }
  arr.push({ date, email });
  configData.workHoursConfig = { ...cur, dutyRoster: arr };
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('新增輪值上班', null, null, `${date}　${configData?.users?.[email]?.name || email}`, { major: true });
    renderAdminWorkHours();
  } catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminWhRemoveDuty(date, email) {
  if (!confirm(`確認移除輪值「${date} · ${configData?.users?.[email]?.name || email}」？`)) return;
  const cur = _getWorkHoursConfig();
  const arr = (cur.dutyRoster || []).filter(r => !(r.date === date && r.email === email));
  configData.workHoursConfig = { ...cur, dutyRoster: arr };
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminWorkHours(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
// #4a：學期時段 新增/移除／非學期下班上限
async function _adminWhAddSemester() {
  const from = (document.getElementById('wh-sem-from')?.value || '').trim();
  const to   = (document.getElementById('wh-sem-to')?.value   || '').trim();
  if (!from || !to) { alert('請選擇學期起訖日期。'); return; }
  if (to < from) { alert('結束日期不可早於開始日期。'); return; }
  const cur = _getWorkHoursConfig();
  const arr = [...(cur.semesterPeriods || [])];
  if (arr.some(p => p.from === from && p.to === to)) { alert('此學期時段已存在。'); return; }
  arr.push({ from, to });
  configData.workHoursConfig = { ...cur, semesterPeriods: arr };
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); auditLog('新增學期時段', null, null, `${from} ~ ${to}`, { major: true }); renderAdminWorkHours(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminWhRemoveSemester(idx) {
  const cur = _getWorkHoursConfig();
  const arr = [...(cur.semesterPeriods || [])];
  if (idx < 0 || idx >= arr.length) return;
  if (!confirm(`確認移除學期時段「${arr[idx].from} ~ ${arr[idx].to}」？`)) return;
  arr.splice(idx, 1);
  configData.workHoursConfig = { ...cur, semesterPeriods: arr };
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); renderAdminWorkHours(); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminWhSetNonSemEnd(val) {
  const h = parseInt(val, 10);
  if (!Number.isFinite(h)) return;
  const cur = _getWorkHoursConfig();
  configData.workHoursConfig = { ...cur, nonSemesterEndHour: h };
  try { await driveUpdateJsonFile(CONFIG_FILE, configData); }
  catch (e) { alert('儲存失敗：' + e.message); }
}
async function _adminSaveWorkHours() {
  const weeklyHours = {};
  const dowLabels = ['日','一','二','三','四','五','六'];
  let error = '';
  document.querySelectorAll('.wh-day-cb').forEach(cb => {
    if (error) return;
    const dow = parseInt(cb.dataset.dow, 10);
    if (!Number.isFinite(dow)) return;
    if (!cb.checked) return; // 未勾選：該日不上班，不寫入 weeklyHours
    const s  = parseInt(document.querySelector(`.wh-day-start[data-dow="${dow}"]`)?.value, 10);
    const we = parseInt(document.querySelector(`.wh-day-workend[data-dow="${dow}"]`)?.value, 10);
    const e  = parseInt(document.querySelector(`.wh-day-end[data-dow="${dow}"]`)?.value, 10);
    if (!Number.isFinite(s) || !Number.isFinite(we) || !Number.isFinite(e)
        || s < 0 || s > 23 || we < 0 || we > 23 || e < 0 || e > 23) {
      error = `週${dowLabels[dow]} 時段格式錯誤。`; return;
    }
    if (!(s < we)) { error = `週${dowLabels[dow]} 下班時間必須晚於上班時間。`; return; }
    if (!(we <= e)) { error = `週${dowLabels[dow]} 彈性下班時間不可早於下班時間。`; return; }
    weeklyHours[dow] = { start: s, workEnd: we, end: e };
  });
  if (error) { alert(error); return; }
  if (!Object.keys(weeklyHours).length) { alert('請至少勾選一個上班日。'); return; }
  const cur = _getWorkHoursConfig();
  const next = { ...cur, weeklyHours };
  // 清除舊格式殘留欄位，避免 _getWorkHoursConfig 又走 migrate 路徑
  delete next.startHour; delete next.endHour; delete next.workDays;
  configData.workHoursConfig = next;
  const st = document.getElementById('wh-status');
  if (st) st.textContent = '儲存中…';
  try {
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    // 稽核 detail 用可讀格式
    const detail = Object.keys(weeklyHours).sort().map(d => {
      const h = weeklyHours[d];
      return `週${dowLabels[d]} ${String(h.start).padStart(2,'0')}:00–${String(h.workEnd).padStart(2,'0')}:00（彈性下班 ${String(h.end).padStart(2,'0')}:00）`;
    }).join('、');
    auditLog('更新上班時間設定', null, null, detail, { major: true });
    if (st) { st.textContent = '✓ 已儲存'; setTimeout(() => { if (st) st.textContent = ''; }, 3000); }
    renderAdminWorkHours();
  } catch (e) {
    if (st) st.textContent = '';
    alert('儲存失敗：' + e.message);
  }
}

// ── Google 日曆編輯權限一鍵同步 UI ──────────────────────────
function _gcSyncEligibleUsers() {
  return Object.entries(configData?.users || {}).filter(([email, u]) => {
    if (!u || u.disabled || !email || email.startsWith('nomail_')) return false;
    const r = u.role || '';
    return r === '主任' || u.isAdmin === true || u.extraRole === '管理者' || (typeof r === 'string' && r.startsWith('專任'));
  });
}
// 授權失敗時常見原因是執行帳號（npust.scc）對該 Google 日曆只有「編輯」而非「擁有者/可管理共用設定」權限；
// 把第一筆實際錯誤訊息直接攤在畫面上，不用開 DevTools 才看得到
let _gcAclLastErrors = []; // [{email, message}]
function _gcAclErrSummary(errors) {
  if (!errors || !errors.length) return '';
  const first = errors[0];
  return `${first.email || ''}：${first.message || '未知錯誤'}`;
}
function renderAdminGcSync() {
  const el = document.getElementById('admin-gcsync-wrap');
  if (!el) return;
  const eligible = _gcSyncEligibleUsers();
  const pending = eligible.filter(([, u]) => !u.gcAclSynced);
  const done    = eligible.filter(([,  u]) =>  u.gcAclSynced);
  const rowsPending = pending.length
    ? pending.map(([email, u]) => `<li style="font-size:.85rem;padding:2px 0;">${escHtml(u.name || email)} <span style="color:#718096;">（${escHtml(email)} · ${escHtml(u.role || '')}${u.extraRole?'/'+escHtml(u.extraRole):''}${u.isAdmin?' · 管理者':''}）</span></li>`).join('')
    : '<li style="font-size:.85rem;color:#a0aec0;">（無）</li>';
  const rowsDone = done.length
    ? done.map(([email, u]) => `<li style="font-size:.83rem;padding:2px 0;color:#276749;">✓ ${escHtml(u.name || email)} <span style="color:#718096;">（${escHtml(email)}）</span></li>`).join('')
    : '<li style="font-size:.83rem;color:#a0aec0;">（無）</li>';
  const errorBanner = _gcAclLastErrors.length ? `
    <div style="background:#fff5f5;border:1px solid #feb2b2;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
      <div style="font-size:.88rem;font-weight:700;color:#c53030;margin-bottom:4px;">⚠ 上次同步失敗（${_gcAclLastErrors.length} 筆），可能是執行帳號對此 Google 日曆只有「編輯」而非「擁有者/可管理共用設定」權限，需請日曆擁有者手動調整：</div>
      <ul style="list-style:none;padding:0;margin:0;font-size:.8rem;color:#822727;max-height:150px;overflow-y:auto;">
        ${_gcAclLastErrors.map(e => `<li>${escHtml(e.email||'')}：${escHtml(e.message||'未知錯誤')}</li>`).join('')}
      </ul>
    </div>` : '';
  el.innerHTML = errorBanner + `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="flex:1;min-width:260px;background:#fffbeb;border:1px solid #f6ad55;border-radius:8px;padding:10px 14px;">
        <div style="font-size:.9rem;font-weight:700;color:#9c4221;margin-bottom:6px;">待授權（${pending.length}）</div>
        <ul style="list-style:none;padding:0;margin:0;">${rowsPending}</ul>
      </div>
      <div style="flex:1;min-width:260px;background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:10px 14px;">
        <div style="font-size:.9rem;font-weight:700;color:#276749;margin-bottom:6px;">已授權（${done.length}）</div>
        <ul style="list-style:none;padding:0;margin:0;max-height:200px;overflow-y:auto;">${rowsDone}</ul>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-primary" ${pending.length?'':'disabled'} onclick="_adminGcAclSyncAll()">一鍵授權待授權者（${pending.length}）</button>
      <span id="admin-gcsync-status" style="font-size:.82rem;color:#718096;"></span>
    </div>`;
}
async function _adminGcAclSyncAll() {
  const eligible = _gcSyncEligibleUsers().filter(([, u]) => !u.gcAclSynced);
  if (!eligible.length) return;
  const emails = eligible.map(([email]) => email);
  const st = document.getElementById('admin-gcsync-status');
  if (st) st.textContent = `授權中… (${emails.length} 位)`;
  const jobId = bgJobAdd(`Google 日曆編輯權限同步：${emails.length} 位`);
  try {
    const res = await proxyCall('shareCalendarWriters', { emails });
    (res?.granted || []).forEach(em => { if (configData.users[em]) configData.users[em].gcAclSynced = true; });
    await driveUpdateJsonFile(CONFIG_FILE, configData);
    auditLog('同步 Google 日曆編輯權限', null, null, `授權 ${res?.granted?.length || 0} 位；錯誤 ${res?.errors?.length || 0} 位`, { major: true });
    bgJobDone(jobId);
    _gcAclLastErrors = res?.errors || [];
    if (st) { st.textContent = `✓ 完成：${res?.granted?.length||0} 授權；${res?.errors?.length||0} 錯誤${_gcAclLastErrors.length ? '（' + _gcAclErrSummary(_gcAclLastErrors) + '）' : ''}`; setTimeout(() => { if (st) st.textContent = ''; }, 8000); }
    if (_gcAclLastErrors.length) console.warn('Google 日曆授權錯誤：', _gcAclLastErrors);
    renderAdminGcSync();
  } catch (e) {
    bgJobFail(jobId, e.message);
    if (st) st.textContent = '';
    alert('授權失敗：' + e.message);
  }
}
// 空間預約頁「連結 Google 日曆」：主任/系統管理者批次授權全部符合資格者；其他人連結自己的帳號
async function _bkLinkGc() {
  const isPrivU = currentRole === '主任' || extraRole === '管理者';
  if (isPrivU) {
    const eligible = _gcSyncEligibleUsers();
    const emails = eligible.map(([email]) => email);
    if (!emails.length) { showToast('沒有符合資格的使用者', 'warn'); return; }
    if (!confirm(`將批次確認 ${emails.length} 位（主任／系統管理者／專任）都被邀請到 Google 日曆並具編輯權限。\n\n確定執行？`)) return;
    const jobId = bgJobAdd(`Google 日曆帳號連結：${emails.length} 位`);
    try {
      const res = await proxyCall('shareCalendarWriters', { emails });
      (res?.granted || []).forEach(em => { if (configData.users[em]) configData.users[em].gcAclSynced = true; });
      await driveUpdateJsonFile(CONFIG_FILE, configData);
      auditLog('同步 Google 日曆編輯權限', null, null, `（空間預約頁）授權 ${res?.granted?.length || 0} 位；錯誤 ${res?.errors?.length || 0} 位`, { major: true });
      bgJobDone(jobId);
      const errN = res?.errors?.length || 0;
      _gcAclLastErrors = res?.errors || [];
      showToast(`${errN ? '⚠' : '✓'} Google 日曆連結完成：${res?.granted?.length || 0} 位已具編輯權${errN ? `；${errN} 位失敗（${_gcAclErrSummary(_gcAclLastErrors)}；完整清單見系統管理頁）` : ''}`, errN ? 'warn' : 'success', 9000);
      if (errN) console.warn('Google 日曆授權錯誤：', _gcAclLastErrors);
    } catch (e) { bgJobFail(jobId, e.message); alert('連結失敗：' + e.message); }
  } else {
    const me = currentUser?.email;
    if (!me) return;
    const jobId = bgJobAdd('Google 日曆帳號連結（本人）');
    try {
      const res = await proxyCall('shareCalendarWriters', { emails: [me] });
      if ((res?.granted || []).includes(me)) {
        if (configData?.users?.[me]) { configData.users[me].gcAclSynced = true; _configSelfPatch({ gcAclSynced: true }).catch(() => {}); }
        auditLog('同步 Google 日曆編輯權限（本人）', null, null, me);
        bgJobDone(jobId);
        showToast('✓ 已確認您的帳號具有 Google 日曆編輯權限，請至 Google 日曆查看共用日曆', 'success', 6000);
      } else {
        const err = (res?.errors || [])[0];
        throw new Error(err?.message || '未能授權，請聯繫系統管理者');
      }
    } catch (e) { bgJobFail(jobId, e.message); alert('連結失敗：' + e.message); }
  }
}

// saveUser 增量 hook：儲存為專任/主任/管理者且尚未同步 → 背景授權該一位
async function _gcAclAutoSyncOne(email) {
  const u = configData?.users?.[email];
  if (!u || u.disabled || !email || email.startsWith('nomail_')) return;
  const r = u.role || '';
  const eligible = r === '主任' || u.isAdmin === true || u.extraRole === '管理者' || (typeof r === 'string' && r.startsWith('專任'));
  if (!eligible || u.gcAclSynced) return;
  try {
    const res = await proxyCall('shareCalendarWriters', { emails: [email] });
    if ((res?.granted || []).includes(email)) {
      u.gcAclSynced = true;
      driveUpdateJsonFile(CONFIG_FILE, configData).catch(() => {});
      auditLog('同步 Google 日曆編輯權限（增量）', null, null, email);
    }
  } catch (_) { /* 靜默 */ }
}

function _computeGradStatus(c, curSemStr) {
  const sid = (c.studentId || '').trim();
  if (sid.length < 4) return null;
  const typeChar = sid[0].toUpperCase();
  const digits = sid.slice(1);
  if (digits.length < 3 || !/^\d/.test(digits)) return null;
  const { progMap, degreeMap } = _buildDegreeMaps();
  let progYears = progMap[typeChar];
  if (!progYears) return null;
  const degreeName = degreeMap[typeChar] || '';
  // 獸醫系大學部：學號第5-6位為16（如 B11316xxx），修業年限為5年
  if (typeChar === 'B' && sid.length >= 6 && sid[4] === '1' && sid[5] === '6') progYears = 5;
  const admYear = parseInt(digits.slice(0, 3), 10);
  if (isNaN(admYear) || admYear < 80 || admYear > 200) return null;
  const sem = curSemStr || currentSemesterPrefix();
  const curYear = parseInt(sem.slice(0, -1), 10);
  const curSemType = sem.slice(-1);
  if (isNaN(curYear)) return null;
  const yearsAttended = curYear - admYear + 1;
  if (yearsAttended < 0) return null;
  const isOverdue = yearsAttended > progYears;
  const isAboutToGraduate = yearsAttended === progYears && curSemType === '2';
  return { progYears, yearsAttended, admYear, typeChar, degreeName, curYear, curSemType,
    isOverdue, isAboutToGraduate, isRelevant: isOverdue || isAboutToGraduate };
}

function _isTransferCoordinator() {
  return currentRole === '主任' || extraRole === '管理者' || isTransferContact || extraRole === '轉銜管理員';
}

function _hasCaseTransferEval(caseId, sem) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return false;
  return (c.transferEvaluations || []).some(e => e.semester === sem && !e.deletedAt);
}

function _getLatestTeId(caseId, sem) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return null;
  const evals = (c.transferEvaluations || []).filter(e => !e.deletedAt && !e.replacedBy && e.semester === sem);
  evals.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return evals[0]?.teId || null;
}

function _getGradTransferDecision(caseId, sem) {
  return (transferData || []).find(r => r.type === 'graduation' && r.caseId === caseId && r.semester === sem);
}

function _checkTransferGradTodos() {
  const curSem = currentSemesterPrefix();
  todosData = todosData.filter(t => (t.type !== 'transfer_grad_counselor' && t.type !== 'transfer_grad_coord') || t.archivedAt || (t.done && t.doneAt));
  const myEmail = currentUser?.email;
  if (!myEmail || !casesData.length) { _syncTodoBadge(); return; }
  const myCasesNeedTE = casesData.filter(c => {
    if (c.deleted || c.counselorEmail !== myEmail) return false;
    const gs = _computeGradStatus(c, curSem);
    if (!gs || !gs.isRelevant) return false;
    const d = _getGradTransferDecision(c.id, curSem);
    if (d && d.status !== 'pending') return false;
    return !_hasCaseTransferEval(c.id, curSem);
  });
  if (myCasesNeedTE.length > 0) {
    _putTodoItem({
      id: `transfer_grad_counselor_${myEmail}_${curSem}`,
      type: 'transfer_grad_counselor',
      label: `轉銜：${myCasesNeedTE.length} 位主責學生尚未填寫轉銜評估`,
      detail: myCasesNeedTE.slice(0,5).map(c => c.name).join('、') + (myCasesNeedTE.length > 5 ? `…等${myCasesNeedTE.length}人` : ''),
      semester: curSem, caseIds: myCasesNeedTE.map(c => c.id),
      done: false, notifRead: false, createdAt: new Date().toISOString(),
    });
  }
  if (_isTransferCoordinator()) {
    const noDecision = casesData.filter(c => {
      if (c.deleted) return false;
      const gs = _computeGradStatus(c, curSem);
      if (!gs || !gs.isRelevant) return false;
      const d = _getGradTransferDecision(c.id, curSem);
      return !d || d.status === 'pending';
    });
    if (noDecision.length > 0) {
      _putTodoItem({
        id: `transfer_grad_coord_${curSem}`,
        type: 'transfer_grad_coord',
        label: `轉銜管理：本學期有 ${noDecision.length} 位學生尚未進行校級評估`,
        semester: curSem, done: false, notifRead: false, createdAt: new Date().toISOString(),
      });
    }
  }
  _checkTransferClosureReminders();
  _checkWithdrawTodos();
  _syncTodoBadge();
}

function _checkTransferClosureReminders() {
  todosData = todosData.filter(t => t.type !== 'transfer_closure_reminder' || t.archivedAt || (t.done && t.doneAt));
  const myEmail = currentUser?.email;
  const isCoord = _isTransferCoordinator();
  const now = new Date();
  (transferData || []).forEach(rec => {
    if (rec.type !== 'graduation' || rec.status !== 'transfer_school') return;
    if (!rec.caseId) return; // 未歸屬紀錄不觸發提醒
    if (rec.closureMeetingDone) return;
    const c = casesData.find(x => x.id === rec.caseId && !x.deleted);
    if (!c) return;
    const isMyCounselor = c.counselorEmail === myEmail;
    if (!isMyCounselor && !isCoord) return;
    const nextSem = nextSemesterPrefix(rec.semester);
    const dueDate = _semPrefixToEndDate(nextSem);
    const nextSemStartMs = new Date(_semPrefixToApproxDate(nextSem)).getTime();
    if (now.getTime() < nextSemStartMs) return;
    const daysDiff = Math.floor((new Date(dueDate).getTime() - now.getTime()) / 86400000);
    let stage;
    if (daysDiff > 30) stage = 1;
    else if (daysDiff > 7) stage = 2;
    else if (daysDiff > 0) stage = 3;
    else stage = 4;
    const isLocked = stage === 4;
    const caseName = c.name || '未知個案';
    const labels = [
      '',
      `轉銜追蹤：${caseName} 已校級決議轉銜，需於 ${dueDate} 前完成結案會議（尚餘 ${daysDiff} 天）`,
      `轉銜追蹤：${caseName} 結案會議到期前 ${daysDiff} 天（${dueDate}），請盡快安排`,
      `⚠ 轉銜追蹤：${caseName} 結案會議即將到期（${dueDate}），僅剩 ${daysDiff} 天`,
      `🚨 轉銜追蹤：${caseName} 結案會議已逾期（${dueDate}）—— 請立即完成，提醒將鎖定直到完成`,
    ];
    _putTodoItem({
      id: `transfer_closure_${rec.id}`,
      type: 'transfer_closure_reminder',
      label: labels[stage],
      caseId: c.id, caseLabel: caseName,
      transferRecId: rec.id, dueDate, stage, isLocked,
      done: false, notifRead: false, createdAt: new Date().toISOString(),
    });
  });
}

function _checkWithdrawTodos() {
  const curSem = currentSemesterPrefix();
  todosData = todosData.filter(t => t.type !== 'transfer_withdraw_coord' || t.archivedAt || (t.done && t.doneAt));
  if (!_isTransferCoordinator()) return;
  const semRecs = (transferData || []).filter(r => r.type === 'withdraw' && r.semester === curSem && !r.deleted);
  const pending = semRecs.filter(r => _getWdDecision(r, curSem) === 'pending');
  const deletedRecs = (transferData || []).filter(r => r.type === 'withdraw' && r.semester === curSem && r.deleted);
  if (!semRecs.length && !deletedRecs.length) return;
  const teNoDecCount = pending.filter(r => { const lc = _getLinkedCaseForWithdraw(r); return lc && _hasCaseTransferEval(lc.id, curSem); }).length;
  const parts = [];
  if (pending.length > 0) {
    const teNote = teNoDecCount > 0 ? `（其中 ${teNoDecCount} 位已填評估）` : '';
    parts.push(`${pending.length} 位待決議${teNote}`);
  }
  if (deletedRecs.length > 0) parts.push(`${deletedRecs.length} 位已刪除`);
  if (!parts.length) return;
  const detail = pending.slice(0, 5).map(r => r.name || r.studentId).join('、') + (pending.length > 5 ? `…等${pending.length}人` : '');
  _putTodoItem({
    id: `transfer_withdraw_coord_${curSem}`,
    type: 'transfer_withdraw_coord',
    label: `教務處名單（${semesterLabel(curSem)}）：${parts.join('、')}`,
    detail: detail || undefined,
    semester: curSem, done: false, notifRead: false, createdAt: new Date().toISOString(),
  });
}

// 生成「主責需驗證的姓名/學號不符」待辦 (state-derived，每次登入後重算)
function _checkWithdrawMismatchTodos() {
  const myEmail = currentUser?.email;
  todosData = todosData.filter(t => t.type !== 'transfer_withdraw_mismatch' || t.archivedAt || (t.done && t.doneAt));
  if (!myEmail) return;
  const mismatches = (transferData || []).filter(r =>
    r.type === 'withdraw_mismatch_pending' && !r.resolved && r.matchedCaseCounselor === myEmail
  );
  mismatches.forEach(m => {
    const typeLabel = m.matchType === 'sid_only' ? '學號相符、姓名不符' : '姓名相符、學號不符';
    _putTodoItem({
      id: `withdraw_mismatch_${m.id}`,
      type: 'transfer_withdraw_mismatch',
      label: `教務處名單匯入：姓名/學號不符（${m.importedName || m.originalName}）`,
      detail: `類型：${typeLabel}。匯入資料：${m.importedName}（${m.importedSid}）；系統個案：${m.matchedCaseName}（${m.matchedCaseCounselor}）`,
      mismatchId: m.id,
      wdRecordId: m.wdRecordId,
      caseId: m.matchedCaseId,
      caseLabel: `${m.matchedCaseName}（${m.matchedCaseId}）`,
      semester: m.semester,
      done: false, notifRead: false,
      createdAt: m.importedAt || new Date().toISOString(),
    });
  });
  _syncTodoBadge();
}

async function _resolveWithdrawMismatch(mismatchId, action) {
  const m = (transferData || []).find(r => r.type === 'withdraw_mismatch_pending' && r.id === mismatchId);
  if (!m) return;
  m.resolved = true; m.resolvedAt = new Date().toISOString(); m.resolvedAction = action;
  if (action === 'confirm') {
    // 將 withdraw record 的 studentId 連結到 matched case 的 studentId
    const wdRec = (transferData || []).find(r => r.id === m.wdRecordId);
    if (wdRec && m.matchedCaseCounselor) {
      const mc = casesData.find(c => c.id === m.matchedCaseId);
      if (mc) wdRec.studentId = mc.studentId || wdRec.studentId;
    }
  }
  const todoId = `withdraw_mismatch_${m.id}`;
  const t = todosData.find(x => x.id === todoId);
  if (t) { t.done = true; t.doneAt = new Date().toISOString(); }
  _checkWithdrawMismatchTodos();
  renderTodosPage();
  const jobId = bgJobAdd('處理教務處名單姓名/學號不符驗證');
  try { await saveTransfer(); bgJobDone(jobId); }
  catch(e) { bgJobFail(jobId, e.message); }
}

async function _markTransferClosureDone(todoId, transferRecId) {
  const today = new Date().toISOString().slice(0, 10);
  const date = await new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:800;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:#fff;border-radius:12px;padding:28px 32px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <h3 style="font-size:1rem;margin-bottom:4px;">確認結案會議完成</h3>
      <p style="font-size:.82rem;color:#718096;margin-bottom:16px;">請填入結案會議日期，完成後提醒將關閉。</p>
      <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:6px;">結案會議日期</label>
      <input type="date" id="_closure-date-inp" value="${today}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.9rem;box-sizing:border-box;">
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
        <button id="_closure-cancel" class="btn btn-secondary">取消</button>
        <button id="_closure-confirm" class="btn btn-primary">確認完成</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_closure-confirm').onclick = () => {
      const d = ov.querySelector('#_closure-date-inp').value;
      document.body.removeChild(ov); resolve(d || today);
    };
    ov.querySelector('#_closure-cancel').onclick = () => { document.body.removeChild(ov); resolve(null); };
  });
  if (date === null) return;
  const rec = (transferData || []).find(r => r.id === transferRecId);
  if (rec) { rec.closureMeetingDone = true; rec.closureMeetingDate = date; rec.closureMeetingDoneAt = new Date().toISOString(); }
  const t = todosData.find(x => x.id === todoId);
  if (t) { t.done = true; t.doneAt = new Date().toISOString(); t.isLocked = false; }
  _syncTodoBadge();
  renderTodosPage();
  if (rec) {
    const jobId = bgJobAdd('儲存轉銜結案會議完成狀態');
    (async () => { try { await saveTransfer(); bgJobDone(jobId); auditLog('完成轉銜結案會議', rec.caseId, null, date); } catch(e) { bgJobFail(jobId, e.message); } })();
  }
}

// ── 共用：八向度詳細行（含說明） ──
function _buildTEDimRows(ev) {
  const dims = ev.dimensions || [];
  if (!dims.length) return '';
  const lvlLabel = v => ({'1':'1 低','2':'2 中','3':'3 中','4':'4 高','5':'5 高','無':'無','不清楚':'不清楚'}[v] || v || '—');
  const lvlColor = v => v==='1'?'#276749':['2','3'].includes(v)?'#dd6b20':['4','5'].includes(v)?'#c53030':'#718096';
  const rows = dims.map((d, i) => {
    const expText = _getDimExp(i, d.level);
    return `<div style="padding:5px 0;border-bottom:1px solid #f0f4f8;">
      <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
        <span style="font-size:.8rem;color:#4a5568;flex:1;">${i+1}. ${escHtml(d.label)}</span>
        <span style="font-size:.78rem;font-weight:700;color:${lvlColor(d.level)};white-space:nowrap;flex-shrink:0;">${escHtml(lvlLabel(d.level))}</span>
      </div>
      ${expText ? `<div style="font-size:.75rem;color:#718096;font-style:italic;margin-top:2px;padding-left:16px;">${escHtml(expText)}</div>` : ''}
    </div>`;
  }).join('');
  const sourceNote = ev.sourceEvalDate ? `（帶入自 ${escHtml(ev.sourceEvalDate)}）` : '';
  return `<div style="margin-top:10px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:4px;">八向度${sourceNote}</div>${rows}</div>`;
}

// ── 教務處名單：歷史校級評估 chips（withdraw 卡片第二行） ──
function _buildSchoolMeetingHistHtml(r) {
  const hist = r.schoolMeetingHistory;
  if (!hist || !hist.length) return '';
  const chips = hist.map(h => {
    const dateStr = h.date || h.recordedAt?.slice(0, 10) || '';
    const decLabel = _TRANSFER_DEC_LABEL[h.decision] || h.decision || '—';
    return `<span style="font-size:.74rem;background:#fef3c7;color:#92400e;border-radius:8px;padding:1px 7px;border:1px solid #fbbf24;white-space:nowrap;">${escHtml(dateStr ? dateStr + '：' : '校級評估：')}${escHtml(decLabel)}</span>`;
  }).join('');
  return `<div style="padding:3px 0 5px 30px;display:flex;align-items:center;flex-wrap:wrap;gap:3px;border-top:1px solid #f0f4f8;margin-top:2px;">
    <span style="font-size:.74rem;color:#a0aec0;flex-shrink:0;margin-right:2px;">歷史校級評估：</span>
    ${chips}
  </div>`;
}

// ── 個案詳細頁：校級評估紀錄區塊（放在轉銜評估卡片區最上方） ──
function _buildCaseSchoolEvalSection(c) {
  const items = [];
  (transferData || [])
    .filter(r => r.type === 'withdraw' && r.studentId === c.studentId && !r.deleted)
    .forEach(r => {
      const sem = r.semester;
      const gd = _getGradTransferDecision(c.id, sem);
      const decStatus = gd?.status || r.decision || 'pending';
      const decDate = gd?.schoolMeetingDate || r.schoolMeetingDate || '';
      if (decStatus !== 'pending') {
        items.push({ sem, date: decDate, label: _TRANSFER_DEC_LABEL[decStatus] || decStatus, decStatus, isCurrent: true });
      }
      (r.schoolMeetingHistory || []).forEach(h => {
        items.push({ sem, date: h.date || '', label: _TRANSFER_DEC_LABEL[h.decision] || h.decision || '—', decStatus: h.decision, isCurrent: false });
      });
    });
  if (!items.length) return '';
  items.sort((a, b) => (b.date || b.sem || '').localeCompare(a.date || a.sem || ''));
  const chips = items.map(item => {
    const semLbl = semesterLabel(item.sem || '');
    const bg     = item.isCurrent ? (_TRANSFER_DEC_BG[item.decStatus]    || '#f0f4f8') : '#fef3c7';
    const color  = item.isCurrent ? (_TRANSFER_DEC_COLOR[item.decStatus] || '#718096') : '#92400e';
    const border = item.isCurrent ? color : '#fbbf24';
    const tag    = item.isCurrent ? '' : ' <span style="font-size:.7rem;opacity:.7;">（歷史）</span>';
    return `<span style="font-size:.76rem;padding:2px 8px;border-radius:10px;background:${bg};color:${color};border:1px solid ${border};white-space:nowrap;">${escHtml(semLbl)}${item.date ? ' ' + item.date : ''}：${escHtml(item.label)}${tag}</span>`;
  }).join('');
  return `<div style="padding:10px 14px 8px;background:#fffbeb;border-bottom:1px solid #fbd38d;border-radius:6px 6px 0 0;">
    <div style="font-size:.78rem;color:#744210;margin-bottom:6px;font-weight:600;">校級評估紀錄</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>
  </div>`;
}

// ── 共用：轉銜評估卡片展開內容 ──
function _buildTECardBody(ev) {
  const _resolveName = email => { if (!email) return ''; const u = configData?.users?.[email]; return u ? (u.role ? `${u.name || email} ${u.role}` : (u.name || email)) : email; };
  const filledByName  = _resolveName(ev.filledBy) || ev.filledBy || '';
  const counselorDisp = ev.counselorEmail ? _resolveName(ev.counselorEmail) : (ev.counselorName || '');
  const metaLine = (filledByName || counselorDisp)
    ? `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.78rem;color:#718096;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f4f8;">
        ${counselorDisp ? `<span>主責：<strong style="color:#4a5568;">${escHtml(counselorDisp)}</strong></span>` : ''}
        ${filledByName  ? `<span>評估人：<strong style="color:#4a5568;">${escHtml(filledByName)}</strong></span>` : ''}
      </div>` : '';
  const recLabels = { transfer:'建議評估會議轉銜', discuss:'建議評估會議討論後再決定', noTransfer:'建議不需轉銜' };
  const recColors = { transfer:'#c0392b', discuss:'#7d6608', noTransfer:'#1d6a3a' };
  const recBgs   = { transfer:'#fde8e8', discuss:'#fef9e7', noTransfer:'#d5f5e3' };
  const recColor = recColors[ev.recommendation] || '#718096';
  const recBg    = recBgs[ev.recommendation]   || '#f7fafc';
  const recLabel = recLabels[ev.recommendation] || '';
  return `${_buildTEDimRows(ev)}
    ${metaLine}
    ${ev.mainIssue        ? `<div style="margin-bottom:8px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">主訴問題</div><div style="font-size:.88rem;">${renderMaybeHtml(ev.mainIssue)}</div></div>` : ''}
    ${ev.intervention     ? `<div style="margin-bottom:8px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">介入處遇</div><div style="font-size:.88rem;">${renderMaybeHtml(ev.intervention)}</div></div>` : ''}
    ${ev.transferAssessment?`<div style="margin-bottom:8px;"><div style="font-size:.78rem;color:#a0aec0;margin-bottom:3px;">轉銜評估</div><div style="font-size:.88rem;">${renderMaybeHtml(ev.transferAssessment)}</div></div>` : ''}
    ${recLabel ? `<div style="margin-top:10px;padding:6px 10px;background:${recBg};border-left:3px solid ${recColor};border-radius:0 4px 4px 0;font-size:.82rem;font-weight:600;color:${recColor};">轉銜評估建議：${escHtml(recLabel)}</div>` : ''}`;
}

// ── 身心調適假 helper functions ──
function _mlSemHasConsec3(semRecs) {
  if (!semRecs.length) return false;
  const _add1 = s => { const d = new Date(s); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const allDays = new Set();
  semRecs.forEach(l => { const { from, to } = _mlParseDateRange(l); if (!from) return; let c = from; while (c <= (to || from)) { allDays.add(c); c = _add1(c); } });
  const sorted = [...allDays].sort();
  for (let i = 0; i + 2 < sorted.length; i++) {
    if ((new Date(sorted[i+1]) - new Date(sorted[i])) === 86400000 && (new Date(sorted[i+2]) - new Date(sorted[i+1])) === 86400000) return true;
  }
  return false;
}
function _mlSemTotalDays(semRecs) {
  const _add1 = s => { const d = new Date(s); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const allDays = new Set();
  semRecs.forEach(l => { const { from, to } = _mlParseDateRange(l); if (!from) return; let c = from; while (c <= (to || from) && allDays.size < 200) { allDays.add(c); c = _add1(c); } });
  return allDays.size;
}
function _hasCaseInSem(studentId, sem) {
  if (!studentId || !sem) return false;
  return (casesData || []).some(c => {
    if (c.deleted || c.studentId !== studentId) return false;
    const sems = Array.isArray(c.semesters) && c.semesters.length ? c.semesters : [openDateToSemPrefix(c.openDate)].filter(Boolean);
    return sems.includes(sem);
  });
}

// #17：本次 session 已詢問過「快速開案」的案號＋學期組合（同一案同一學期只問一次，
// 使用者按「稍後再說」後不再糾纏；重新整理頁面會重置，可接受）。
const _quickOpenCaseAsked = new Set();

// 連結個案在「指定日期所屬學期」尚未開案時，詢問使用者是否前往新增個案頁快速開案。
// 供各表單「連結個案」成功儲存後呼叫；只要傳入的是樂觀更新後的資料即可，不需等待背景 commit 完成。
// caseId 若對應到封存/結案的 cold 個案（不在 casesData），改從 _casesIndexCache 取 studentId 判斷。
function _maybePromptQuickOpenCase(caseId, dateStr) {
  if (!caseId || !dateStr) return;
  const c = casesData.find(x => x.id === caseId && !x.deleted)
    || _casesIndexCache?.cases?.find(x => x.id === caseId && !x.deleted);
  if (!c || !c.studentId) return;
  const sem = openDateToSemPrefix(dateStr);
  if (!sem || _hasCaseInSem(c.studentId, sem)) return;
  const askKey = `${caseId}|${sem}`;
  if (_quickOpenCaseAsked.has(askKey)) return;
  _quickOpenCaseAsked.add(askKey);
  _showQuickOpenCasePrompt(c, sem);
}

function _showQuickOpenCasePrompt(c, sem) {
  document.getElementById('quick-open-case-modal')?.remove(); // 避免重複疊加
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'quick-open-case-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h3>該學期尚未開案</h3></div>
      <div class="modal-body" style="padding:12px 0 16px;">
        <p style="font-size:.9rem;color:#4a5568;">個案（案號 <strong>${escHtml(c.id)}</strong>）在 <strong>${escHtml(semesterLabel(sem))}</strong> 尚未開案，是否快速開案？</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('quick-open-case-modal').remove()">稍後再說</button>
        <button class="btn btn-primary" onclick="document.getElementById('quick-open-case-modal').remove();_quickReopenCaseSemBg('${escHtml(c.id)}','${escHtml(sem)}')">快速開案</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ══════════════════════════════════════════════
//  v181：快速開案改「小視窗＋背景開案」（回應使用者對 v179 confirm+全頁導頁做法的退回意見）
//  不得讓使用者離開目前表單、不得遺失已填內容；原 _goQuickOpenCase（導頁到新增個案頁再手動送出，
//  全頁 overlay 且慢）已移除，改成以下兩支背景函式：
//   ‧ _quickReopenCaseSemBg：案號已存在，只是缺這學期 → 背景直接在同一案號新增本學期開案紀錄
//     （不彈欄位視窗，維持一學生一案號；供空間預約「該學期尚未開案」提示、評估表「有歷史個案」情形共用）
//   ‧ _showQuickOpenCaseModal／_createQuickCaseBg：完全無個案的全新學生 → 小 modal 收集
//     案號/學號/姓名/身分證/電話（最小欄位）後背景建立新案，新案標記 profileIncomplete:true
// ══════════════════════════════════════════════

// 背景直接在既有案號新增本學期開案紀錄（不離開/不重繪呼叫端目前的頁面）。case 缺少的欄位
// （開案日期以外的細節）比照快速開案精神先標記 profileIncomplete:true，供之後「儲存後提醒」導去補齊。
async function _quickReopenCaseSemBg(caseId, sem, onDone, onFail) {
  _crisisEnsureCaseStub(caseId); // cold/封存個案可能尚未在 casesData，先補 stub 讓 on-demand 載入生效
  let c = casesData.find(x => x.id === caseId);
  if (c?._indexOnly && !c._fullLoaded) {
    try { await _ensureFullCases([caseId]); }
    catch (e) { alert('載入個案資料失敗：' + e.message); if (onFail) onFail(e.message); return; }
    c = casesData.find(x => x.id === caseId);
  }
  if (!c) { if (onFail) onFail('找不到個案資料'); return; }
  if (!Array.isArray(c.semesters)) c.semesters = _caseSems(c);
  if (c.semesters.includes(sem)) { if (onDone) onDone(caseId); return; } // 已開過，視為完成
  // 點了「快速開案」代表有意開案 → 清掉本案所有「已詢問」記錄，失敗時才有機會重新詢問（見 catch）
  [..._quickOpenCaseAsked].forEach(k => { if (k.startsWith(caseId + '|')) _quickOpenCaseAsked.delete(k); });
  const _prevSemesters = [...c.semesters];
  const _prevStatus = c.semesterStatus ? { ...c.semesterStatus } : null;
  const _prevSnaps = c.basicInfoSnapshots ? { ...c.basicInfoSnapshots } : null;
  const _prevProfileIncomplete = c.profileIncomplete;
  const jobId = bgJobAdd(`快速開案（新增學期）：${c.name || c.studentId || caseId}`, semesterLabel(sem));
  c.semesters.push(sem); c.semesters.sort();
  if (!c.semesterStatus) c.semesterStatus = {};
  c.semesterStatus[sem] = 'active';
  if (!c.basicInfoSnapshots) c.basicInfoSnapshots = {};
  const _snap = {}; BASIC_INFO_SNAPSHOT_FIELDS.forEach(f => { if (c[f] !== undefined) _snap[f] = c[f]; });
  c.basicInfoSnapshots[sem] = _snap;
  c.profileIncomplete = true;
  c.status = _recomputeCaseStatus(c);
  c.updatedAt = new Date().toISOString();
  try {
    await saveCasesChunks(caseId);
    bgJobDone(jobId);
    auditLog('快速開案', caseId, null, `${semesterLabel(sem)}學期（背景新增）`);
    _qocPendingProfileIncomplete.push({ id: caseId, name: c.name || c.studentId || caseId });
    showToast(`已完成 ${semesterLabel(sem)} 開案：${c.name || caseId}`, 'success');
    if (onDone) onDone(caseId);
    // v186：背景開案在此完成時，若觸發它的評估表已儲存離開（或本來就不是從評估表觸發），
    // 立即補跳「尚未完成開案資料」提醒；評估表仍開啟中則 _qocMaybeShowIncompleteReminder 內部會自行按兵不動
    _qocMaybeShowIncompleteReminder();
  } catch (err) {
    c.semesters = _prevSemesters;
    c.semesterStatus = _prevStatus;
    c.basicInfoSnapshots = _prevSnaps;
    c.profileIncomplete = _prevProfileIncomplete;
    bgJobFail(jobId, err.message);
    alert('快速開案失敗：' + err.message);
    if (onFail) onFail(err.message);
  }
}

// 全新學生：小 modal 收集最小欄位（案號/學號/姓名/身分證/電話），送出後立即關閉 modal，
// 實際建案交由 _createQuickCaseBg 背景執行，呼叫端表單不受影響。
// onDone(caseId)：背景建案成功時呼叫；onStart()：驗證通過、真正開始背景建案時呼叫（供呼叫端立即切換 UI 為「開案中…」）；
// onFail(msg)：背景建案失敗時呼叫（供呼叫端還原 UI，讓使用者可再次操作）。
function _showQuickOpenCaseModal(prefill, onDone, onStart, onFail) {
  document.getElementById('qoc-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'qoc-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h3>快速開案</h3></div>
      <div class="modal-body" style="padding:10px 0 4px;display:flex;flex-direction:column;gap:10px;">
        <div><label class="field-label">案號<span class="req">*</span></label><input type="text" class="field-input" id="qoc-id" value="${escHtml(generateCaseId())}"></div>
        <div><label class="field-label">學號<span class="req">*</span></label><input type="text" class="field-input" id="qoc-sid" value="${escHtml(prefill?.studentId || '')}"></div>
        <div><label class="field-label">姓名<span class="req">*</span></label><input type="text" class="field-input" id="qoc-name" value="${escHtml(prefill?.name || '')}"></div>
        <div><label class="field-label">身分證字號</label><input type="text" class="field-input" id="qoc-idnum" value=""></div>
        <div><label class="field-label">電話</label><input type="text" class="field-input" id="qoc-phone" value=""></div>
        <div id="qoc-alert" style="display:none;color:#c53030;font-size:.85rem;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('qoc-modal').remove()">取消</button>
        <button class="btn btn-primary" onclick="_submitQuickOpenCase()">儲存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._qocOnDone = onDone || null;
  window._qocOnStart = onStart || null;
  window._qocOnFail = onFail || null;
}

function _submitQuickOpenCase() {
  const id = (document.getElementById('qoc-id').value || '').trim();
  const studentId = (document.getElementById('qoc-sid').value || '').trim();
  const name = (document.getElementById('qoc-name').value || '').trim();
  const idNumber = (document.getElementById('qoc-idnum').value || '').trim();
  const phone = (document.getElementById('qoc-phone').value || '').trim();
  const alertEl = document.getElementById('qoc-alert');
  const showErr = (msg) => { if (alertEl) { alertEl.textContent = msg; alertEl.style.display = ''; } };
  if (!id || id.length !== 7) { showErr('案號須為 7 碼。'); return; }
  if (parseInt(id.slice(4), 10) === 0) { showErr('案號序號不可為 000，須從 001 起。'); return; }
  if (!studentId) { showErr('請輸入學號。'); return; }
  if (!name) { showErr('請輸入姓名。'); return; }
  // 案號唯一性檢查不可排除已刪除個案（絕不可發出與任何歷史案號重複的案號，含已刪除者）
  if (casesData.some(c => c.id === id)) { showErr('案號已被使用，請重新輸入。'); return; }
  // v186：一學生一案號——僅「未刪除」的既有案號視為衝突而擋下快速開案；已刪除的歷史案號不算數
  // （使用者裁決：已刪除的個案/案號一律視同無歷史，走全新開案流程，同學號可能因此並存已刪除舊案號與新案號）
  const _dup = casesData.find(c => c.studentId === studentId && c.id !== id && !c.deleted);
  if (_dup) { showErr(`學號 ${studentId} 已有案號 ${_dup.id}，快速開案僅供全新學生使用；請至個案列表以「再次開案」流程處理。`); return; }
  const onDone = window._qocOnDone;
  const onStart = window._qocOnStart;
  const onFail = window._qocOnFail;
  document.getElementById('qoc-modal').remove();
  if (onStart) onStart();
  _createQuickCaseBg({ id, studentId, name, idNumber, phone }, onDone, onFail);
}

// 背景建立最小化新案（不佔用 UI、不導頁）：僅寫入本次收集的最小欄位，其餘（法定性別/系所/
// 案別 A/B 等）維持空白，交由「繼續完成開案」導向的個案編輯頁補齊；新案標記 profileIncomplete:true。
async function _createQuickCaseBg(fields, onDone, onFail) {
  const { id, studentId, name, idNumber, phone } = fields;
  if (casesData.some(c => c.id === id)) {
    alert('快速開案失敗：案號已被使用，請重新操作。');
    if (onFail) onFail('案號已被使用');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const thisSem = currentSemesterPrefix();
  const now = new Date().toISOString();
  const newCase = {
    id, openDate: today, name, studentId, idNumber, phone,
    semesters: [thisSem], status: 'active',
    counselorEmail: currentUser.email,
    counselorName: formatCounselorLabel(currentUser.email) || currentUser.email,
    profileIncomplete: true, // 僅填最小欄位，開案資料尚未完整（回應「儲存後提醒」需求）
    createdAt: now, updatedAt: now, records: [],
  };
  casesData.push(newCase);
  _assignChunkForNewCase(id); // Slice 3：已重新分塊時分配 active chunk，否則不動作（legacy fallback）
  const jobId = bgJobAdd(`快速開案：${name}`, id);
  try {
    await saveCasesChunks(id);
    bgJobDone(jobId);
    auditLog('快速開案', id, null, name);
    _qocPendingProfileIncomplete.push({ id, name });
    showToast(`已快速開案：${name}（${id}）`, 'success');
    if (onDone) onDone(id);
    // v186：同上——背景建案在此完成時，若觸發它的評估表已儲存離開，立即補跳提醒
    _qocMaybeShowIncompleteReminder();
  } catch (err) {
    const idx = casesData.findIndex(c => c.id === id);
    if (idx >= 0) casesData.splice(idx, 1);
    bgJobFail(jobId, err.message);
    alert('快速開案失敗：' + err.message);
    if (onFail) onFail(err.message);
  }
}

// 「儲存後提醒」：本次工作階段（頁面未重新整理前）透過快速開案建立、仍 profileIncomplete 的個案佇列。
// 背景開案成功時 push；於評估表／空間預約表單儲存成功後 drain 一筆出來提醒（見 _qocMaybeShowIncompleteReminder）。
let _qocPendingProfileIncomplete = [];

function _qocMaybeShowIncompleteReminder() {
  if (!_qocPendingProfileIncomplete.length) return;
  if (document.querySelector('.modal-overlay')) return; // 避免與其他已開啟的 modal 疊加，留到下次儲存成功再提醒
  // v186：身心狀態評估表為全頁（非 modal-overlay），上面的檢查不會誤判其開啟中；
  // 使用者若還在填寫評估表（尚未儲存/離開），此處先不跳提醒，避免打斷填寫——
  // 待評估表儲存成功後，saveMlAssessment 既有的呼叫點會再次觸發本函式補跳
  if (document.getElementById('page-ml-assess')?.classList.contains('active')) return;
  const item = _qocPendingProfileIncomplete.shift();
  const c = casesData.find(x => x.id === item.id);
  if (!c || !c.profileIncomplete) return; // 已被完成或已刪除，不需提醒
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'qoc-incomplete-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h3>個案開案資料尚未完成</h3>
        <button onclick="document.getElementById('qoc-incomplete-modal').remove()" title="關閉（稍後處理）" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#a0aec0;line-height:1;">×</button>
      </div>
      <div class="modal-body" style="padding:12px 0 16px;">
        <p style="font-size:.9rem;color:#4a5568;">剛剛快速開案的「<strong>${escHtml(item.name)}</strong>」個案（案號 ${escHtml(item.id)}）尚未完成開案資料填寫。</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('qoc-incomplete-modal').remove();_qocAddIncompleteTodo('${escHtml(item.id)}','${escHtml(item.name)}')">列為待辦</button>
        <button class="btn btn-primary" onclick="document.getElementById('qoc-incomplete-modal').remove();openEditCasePage('${escHtml(item.id)}')">繼續完成開案</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _qocAddIncompleteTodo(caseId, name) {
  const now = new Date().toISOString();
  _putTodoItem({
    id: _genTodoId(), type: 'case_profile_incomplete',
    label: `快速開案「${name}」（${caseId}）尚未完成開案資料填寫`,
    caseId, caseLabel: `${name}（${caseId}）`,
    assignedTo: currentUser.email,
    createdAt: now, updatedAt: now, done: false, notifRead: false,
  });
  saveUserTodos().catch(() => {});
  if (typeof _syncTodoBadge === 'function') _syncTodoBadge();
  showToast('已列為待辦');
}

function _checkMlCumulativeTodos() {
  const myStudentIds = _getMyCaseStudentIds();
  if (!myStudentIds.size || !mentalLeavesData.length) return;
  const curSem = currentSemesterPrefix();
  const consec3Ids = _mlConsecutive3DayIds(mentalLeavesData.filter(l => !l.deleted && l.semester === curSem));
  let changed = false;
  myStudentIds.forEach(sid => {
    if (consec3Ids.has(sid)) return; // 已有連請三天，不需累計三天提醒
    const semRecs = mentalLeavesData.filter(l => !l.deleted && l.studentId === sid && l.semester === curSem);
    if (_mlSemTotalDays(semRecs) < 3) return;
    const todoId = `ml_cumul3_${sid}_${curSem}`;
    if (todosData.some(t => t.id === todoId)) return; // 已存在（任何狀態）
    const caseItem = (casesData || []).find(c => !c.deleted && c.studentId === sid);
    const name = caseItem?.name || sid;
    todosData.push({
      id: todoId, type: 'ml_cumul3',
      label: `身心調適假累計三天：${name}（${semesterLabel(curSem)}）`,
      caseLabel: name, studentId: sid, semester: curSem,
      caseId: caseItem?.id || null,
      createdAt: new Date().toISOString(),
      done: false, notifRead: false,
    });
    changed = true;
  });
  if (changed) {
    _syncTodoBadge();
    saveUserTodos().catch(() => {});
    if (document.getElementById('page-todos')?.classList.contains('active')) renderTodosPage();
  }
}

// D：主責個案新增身心調適假 → 建立待辦通知主責＋鈴鐺提醒（notifRead:false 已自動計入 _syncBellBadge／_syncTodoBadge）。
// 防重複：與 ml_cumul3 不同，本函式的通知對象未必是目前登入者（ml_cumul3 只查「我的」個案、靠 todoId
// 比對自己本機 todosData 即可去重），故無法沿用 id 比對法；比照同檔 _mlNotifyAssessmentDue 的既有作法，
// 改在身心調適假紀錄本身寫 mainNotifiedAt 標記欄位去重。
async function _checkMlNewLeaveTodos() {
  const pending = (mentalLeavesData || []).filter(l => !l.deleted && l.studentId && !l.mainNotifiedAt);
  if (!pending.length) return;
  const now = new Date().toISOString();
  // 防洪閘：功能上線前的既有紀錄（建立超過 3 天）只補 mainNotifiedAt 標記、不發待辦——
  // 否則首次執行會把全部歷史紀錄一口氣灌成待辦。主責已按過「收到」的也視同已知悉、只標記不發。
  const _cutoffMs = Date.now() - 3 * 86400000;
  const _isStale = (l) => {
    const t = new Date(l.createdAt || l.leaveDate || '').getTime();
    return isNaN(t) ? true : t < _cutoffMs;
  };
  let ownChanged = false;
  let recordChanged = false;
  for (const l of pending) {
    const mc = (casesData || []).find(c => !c.deleted && c.studentId === l.studentId);
    const email = mc?.counselorEmail;
    if (_isStale(l)) { l.mainNotifiedAt = now; recordChanged = true; continue; }
    if (email && (l.acknowledgedBy || []).includes(email)) { l.mainNotifiedAt = now; recordChanged = true; continue; }
    if (!mc || !email) continue; // 尚未開案或無主責 → 暫不標記，待資料補齊後下次掃描再補發通知（3 天內有效）
    const { from, to } = _mlParseDateRange(l);
    const dateLbl = from ? (from !== to ? `${from} ~ ${to}` : from) : (l.leaveDate || '');
    const mkTodo = () => ({
      id: _genTodoId(), type: 'ml_new_leave',
      label: `主責個案新增身心調適假：${mc.name}（${mc.id}）${dateLbl}`,
      leaveId: l.id, studentId: l.studentId, caseId: mc.id,
      createdAt: now, done: false, notifRead: false,
    });
    try {
      if (email === currentUser?.email) {
        // 主責＝本人：直接寫本機 todosData，比照 ml_cumul3 的本人寫入路徑，省去對自己檔案的 RMW 網路往返
        todosData.push(mkTodo());
        ownChanged = true;
      } else {
        await _appendTodoToUser(email, mkTodo());
      }
      l.mainNotifiedAt = now;
      recordChanged = true;
    } catch (_) { /* 個別主責寫入失敗不阻斷其他人，未標記 mainNotifiedAt，下次掃描重試 */ }
  }
  if (ownChanged) { _syncTodoBadge(); saveUserTodos().catch(() => {}); }
  if (recordChanged) { try { await saveMentalLeaves(); } catch (_) {} }
}

// ── 所有學期轉銜評估卡片（個案詳細頁，不限學期） ──
// v179：改時間軸呈現（時間升冪）——請假卡片（連續日合併）／評估卡片／聯繫小卡／轉 A 案註記；
// 資料組裝交給純函式 _mlCaseTimelineItems（見上方定義，附單元測試），本函式只負責畫面渲染。
function _renderCaseMlCard(c) {
  if (!c.studentId) return '';
  const recs = mentalLeavesData.filter(l => !l.deleted && l.studentId === c.studentId);
  if (!recs.length) return '';

  const uid = c.id.replace(/[^a-zA-Z0-9]/g, '-');
  const outerBodyId = `case-ml-outer-${uid}`;
  const fmtDate = d => d ? d.slice(5).replace('-', '/') : '—';

  const assessments = recs.filter(l => l.assessment);
  const contacts = [];
  assessments.forEach(l => (l.assessment.contacts || []).forEach(ct => contacts.push({ ...ct, leaveId: l.id })));
  const items = _mlCaseTimelineItems(recs, assessments, contacts, c.abTypeHistory);

  const cardHtml = items.map(item => {
    if (item.type === 'leave') {
      const rows = item.records.map(l => {
        const { level: maxLevel } = _mlEffectiveRisk(l);
        const bg = maxLevel===3?'#fff5f5':maxLevel===2?'#fffdf0':'';
        const hVal = l.handlingStatus || (maxLevel >= 3 ? '待處理' : '非危機');
        const hs = ML_HANDLING_STYLE[hVal] || {};
        const { from: _rFrom, to: _rTo } = _mlParseDateRange(l);
        const _rDateStr = _rFrom ? (_rFrom !== _rTo ? `${fmtDate(_rFrom)} – ${fmtDate(_rTo)}` : fmtDate(_rFrom)) : (l.leaveDate || '—');
        // A-4：個案詳細頁的身心調適假紀錄卡片同樣加「收到」，直接重用 window._mlAcknowledge
        const _mlaAckedByMe = !!(currentUser?.email && (l.acknowledgedBy || []).includes(currentUser.email));
        const _mlaAckCell = _mlaAckedByMe
          ? `<span style="color:#276749;font-size:.74rem;white-space:nowrap;">已收到 ✓</span>`
          : `<button onclick="event.stopPropagation();window._mlAcknowledge('${escHtml(l.id)}')" style="padding:2px 8px;background:#276749;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.74rem;white-space:nowrap;">收到</button>`;
        return `<tr style="background:${bg};">
          <td style="padding:4px 8px;white-space:nowrap;font-size:.82rem;">${escHtml(_rDateStr)}</td>
          <td style="padding:4px 8px;font-size:.82rem;max-width:220px;">${escHtml(l.reason||'—')}</td>
          <td style="padding:4px 8px;">${_mlRiskBadge(maxLevel, true)}</td>
          <td style="padding:4px 8px;font-size:.78rem;"><span style="background:${hs.bg||'#f7fafc'};color:${hs.color||'#718096'};border:1px solid ${hs.border||'#e2e8f0'};border-radius:4px;padding:0 5px;">${escHtml(hVal)}</span></td>
          <td style="padding:4px 8px;font-size:.78rem;color:#718096;">${escHtml(l.semester||'—')}</td>
          <td style="padding:4px 8px;text-align:center;">${_mlaAckCell}</td>
        </tr>`;
      }).join('');
      return `<div style="margin-bottom:8px;border:1px solid #e9d8fd;border-radius:6px;overflow:hidden;">
        <div style="padding:6px 12px;background:#ede9fe;font-size:.85rem;font-weight:600;color:#553c9a;">📅 ${escHtml(item.dateRange)}${item.isConsec3 ? ` <span style="background:#fed7d7;color:#9b2c2c;border-radius:4px;padding:0 6px;font-size:.72rem;font-weight:600;">連請三天</span>` : ''}</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f3e8ff;color:#44337a;font-size:.8rem;">
            <th style="padding:4px 8px;text-align:left;font-weight:600;">請假日期</th>
            <th style="padding:4px 8px;text-align:left;font-weight:600;">緣由</th>
            <th style="padding:4px 8px;text-align:left;font-weight:600;">風險</th>
            <th style="padding:4px 8px;text-align:left;font-weight:600;">受理情況</th>
            <th style="padding:4px 8px;text-align:left;font-weight:600;">學期</th>
            <th style="padding:4px 8px;text-align:center;font-weight:600;">確認</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    }
    if (item.type === 'eval') {
      const _a = item.assessment;
      const _aOutcome = _a.resultOutcome === 'counseling' ? '進入諮商輔導流程' : _a.resultOutcome === 'noCase' ? '不開案' : '—';
      const _aBtns = [
        `<button class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:1px 8px;" onclick="openMlAssessmentModal('${escHtml(item.leave.id)}', true)">檢視</button>`,
        (_mlAssessCanEdit() && !_detailReadOnly) ? `<button class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:1px 8px;" onclick="openMlAssessmentModal('${escHtml(item.leave.id)}')">編輯</button>` : '',
        `<button class="btn btn-secondary btn-sm" style="font-size:.72rem;padding:1px 8px;" onclick="printMlAssessment('${escHtml(item.leave.id)}')">列印</button>`,
      ].filter(Boolean).join('');
      return `<div style="margin-bottom:8px;padding:8px 12px;background:#fdfaff;border:1px solid #e9d8fd;border-radius:6px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.78rem;color:#553c9a;">
          <span style="background:#e9d8fd;border-radius:4px;padding:0 6px;font-weight:600;" data-tip="此評估表為身心調適假窗口於進案前對學生進行的評估與介入紀錄（非諮商晤談紀錄）">📝 ${escHtml(fmtDate(item.date))} 身心狀態評估表</span>
          ${_a.bsrsUnanswered ? `<span>BSRS：<b>個案皆未回答</b></span>` : `<span>BSRS 總分：<b>${_mlAssessBsrsTotal(_a)}</b></span><span>自殺想法：<b>${_a.suicide ?? '—'}</b></span>`}
          <span>評估結果：${escHtml(_aOutcome)}${_a.resultText ? `（${escHtml(_a.resultText)}）` : ''}</span>
          ${_aBtns}
        </div>
      </div>`;
    }
    if (item.type === 'contact') {
      const ct = item.contact;
      const timeLbl = ct.period || ((ct.timeStart || ct.timeEnd) ? `${ct.timeStart||''}–${ct.timeEnd||''}` : '');
      const targetLbl = escHtml(ct.target || '—') + (ct.targetNote ? `（${escHtml(ct.targetNote)}）` : '');
      return `<div style="margin-bottom:6px;padding:6px 12px;background:#e6fffa;border:1px solid #b2f5ea;border-radius:6px;font-size:.8rem;color:#234e52;">
        ☎ ${escHtml(fmtDate(item.date))}${timeLbl?`　${escHtml(timeLbl)}`:''}　${escHtml(ct.method||'—')}　對象：${targetLbl}${ct.description?`　${escHtml(ct.description)}`:''}
      </div>`;
    }
    if (item.type === 'abChange') {
      return `<div style="margin-bottom:6px;padding:6px 12px;background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;font-size:.8rem;color:#2b6cb0;">
        🔀 ${escHtml(fmtDate(item.date))} 轉為 A 案（${escHtml(item.history.byName || item.history.by || '—')}）
      </div>`;
    }
    return '';
  }).join('');

  return `<div style="margin-top:14px;margin-bottom:16px;">
    <div style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#faf5ff;border:1px solid #d6bcfa;border-radius:8px 8px 0 0;" onclick="window._toggleDisplay('${outerBodyId}','${outerBodyId}-icon')">
      <span style="font-weight:600;color:#553c9a;font-size:.9rem;">身心調適假紀錄（共 ${recs.length} 筆，時間軸）</span>
      <span id="${outerBodyId}-icon">▼</span>
    </div>
    <div id="${outerBodyId}" style="background:#faf5ff;border:1px solid #d6bcfa;border-top:none;border-radius:0 0 8px 8px;padding:12px 14px;">
      ${cardHtml || '<div style="color:#a0aec0;font-size:.85rem;text-align:center;padding:10px;">尚無紀錄</div>'}
    </div>
  </div>`;
}

function _renderAllTransferEvalsCard(c, cid) {
  const allEvals = (c.transferEvaluations || [])
    .sort((a, b) => {
      const sc = (b.semester||'').localeCompare(a.semester||'');
      return sc !== 0 ? sc : (b.createdAt||'').localeCompare(a.createdAt||'');
    });
  if (!allEvals.length) return `<div class="form-section section-collapsible collapsed" id="cs-transfer-eval-all">
    <div class="form-section-title" onclick="toggleSection('cs-transfer-eval-all')" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
      <span>轉銜評估紀錄</span>
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openTransferEvalForm('${escHtml(cid)}',null)" style="font-size:.78rem;padding:3px 10px;white-space:nowrap;flex-shrink:0;">＋ 新增轉銜評估</button>
      <span class="toggle-icon">▲</span>
    </div>
    <div class="section-body"><div style="padding:16px;color:#a0aec0;font-size:.88rem;text-align:center;">尚無轉銜評估紀錄</div></div>
  </div>`;
  const recColors = { transfer:'#c0392b', discuss:'#7d6608', noTransfer:'#1d6a3a' };
  const recBgs   = { transfer:'#fde8e8', discuss:'#fef9e7', noTransfer:'#d5f5e3' };
  const recLabels = { transfer:'建議評估會議轉銜', discuss:'建議評估會議討論後再決定', noTransfer:'建議不需轉銜' };
  // 統計各學期有效評估數（用於收合 chips）
  const semCounts = {};
  allEvals.filter(e => !e.replacedBy && !e.deletedAt).forEach(e => {
    const s = e.semester || '—';
    semCounts[s] = (semCounts[s] || 0) + 1;
  });
  const chips = Object.entries(semCounts)
    .sort(([a],[b]) => b.localeCompare(a))
    .map(([sem, n]) => `<span style="font-size:.72rem;background:#ccfbf1;color:#0f766e;border-radius:8px;padding:1px 7px;border:1px solid #5eead4;white-space:nowrap;">${escHtml(semesterLabel(sem))}：${n}</span>`)
    .join('');
  const cards = allEvals.map(ev => {
    const isDeleted  = !!ev.deletedAt;
    const isReplaced = !!ev.replacedBy;
    const teId  = ev.teId || '';
    const safeId = ('all_' + teId).replace(/[^a-zA-Z0-9_]/g, '_');
    const recColor = recColors[ev.recommendation] || '#718096';
    const recBg    = recBgs[ev.recommendation]    || '#f0f4f8';
    const recLabel = recLabels[ev.recommendation] || '—';
    const semLbl   = semesterLabel(ev.semester || '');
    const _resolveName = email => email ? (configData?.users?.[email]?.name || email) : '—';
    const filledByDisp = _resolveName(ev.filledBy) || ev.filledBy || '—';
    let statusBadge;
    if (isDeleted)       statusBadge = `<span style="font-size:.72rem;background:#fde8e8;color:#c53030;border-radius:4px;padding:1px 5px;">已刪除 ${(ev.deletedAt||'').slice(0,10)}</span>`;
    else if (isReplaced) statusBadge = `<span style="font-size:.72rem;background:#f0f4f8;color:#718096;border-radius:4px;padding:1px 5px;border:1px solid #e2e8f0;">已修改（${(ev.replacedAt||'').slice(0,10)}）</span>`;
    else                 statusBadge = `<span style="font-size:.75rem;padding:2px 8px;border-radius:10px;background:${recBg};color:${recColor};white-space:nowrap;">${recLabel}</span>`;
    const bgColor = isDeleted ? '#f9fafb' : isReplaced ? '#fafafa' : '#f0fff4';
    const actionBtns = isDeleted && teId
      ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();restoreTransferEval('${escHtml(cid)}','${teId}')" style="font-size:.72rem;padding:2px 7px;">還原</button>`
      : (!isDeleted && !isReplaced && teId
        ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openTransferEvalForm('${escHtml(cid)}','${teId}')" style="font-size:.72rem;padding:2px 7px;">編輯</button>
           <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();softDeleteTransferEval('${escHtml(cid)}','${teId}')" style="font-size:.72rem;padding:2px 7px;color:#c53030;border-color:#fc8181;">刪除</button>
           <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();printTransferEval('${escHtml(cid)}','${teId}')" style="font-size:.72rem;padding:2px 7px;">列印</button>`
        : '');
    return `<div class="te-card${isDeleted?' te-deleted':''}">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${bgColor};cursor:pointer;flex-wrap:wrap;" onclick="toggleTECard('${safeId}')">
        <span style="font-size:.72rem;font-weight:600;background:#c6f6d5;color:#1a7341;border:1px solid #9ae6b4;border-radius:4px;padding:1px 6px;white-space:nowrap;flex-shrink:0;">轉銜評估</span>
        <span style="font-size:.73rem;background:#e9d8fd;color:#553c9a;border-radius:8px;padding:1px 7px;border:1px solid #b794f4;white-space:nowrap;flex-shrink:0;">${escHtml(semLbl)}</span>
        <span style="flex:1;font-weight:600;font-size:.86rem;">${escHtml(filledByDisp)}</span>
        <span style="font-size:.78rem;color:#718096;">${escHtml(ev.evalDate || ev.filledDate || '')}</span>
        ${statusBadge}${actionBtns}
        <span id="te-icon-${safeId}">▶</span>
      </div>
      <div id="te-body-${safeId}" style="display:none;padding:10px 14px;">
        ${_buildTECardBody(ev)}
      </div>
    </div>`;
  }).join('');
  return `<div class="form-section section-collapsible collapsed" id="cs-transfer-eval-all">
    <div class="form-section-title" onclick="toggleSection('cs-transfer-eval-all')" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
      <span>轉銜評估紀錄</span>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-right:auto;margin-left:10px;">${chips}</div>
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openTransferEvalForm('${escHtml(cid)}',null)" style="font-size:.78rem;padding:3px 10px;white-space:nowrap;flex-shrink:0;">＋ 新增轉銜評估</button>
      <span class="toggle-icon">▲</span>
    </div>
    <div class="section-body">${_buildCaseSchoolEvalSection(c)}${cards}</div>
  </div>`;
}

function toggleTECard(safeTeId) {
  const body = document.getElementById('te-body-' + safeTeId);
  const icon = document.getElementById('te-icon-' + safeTeId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (icon) icon.textContent = isOpen ? '▶' : '▲';
}

function printTransferEval(caseId, teId, mode = 'print') {
  const c = casesData.find(x => x.id === caseId);
  if (!c || !teId) return;
  const ev = (c.transferEvaluations || []).find(e => e.teId === teId);
  if (!ev) return;
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _nameWithRole = email => {
    if (!email) return '—';
    const u = configData?.users?.[email];
    if (u) return u.role ? `${u.name || email} ${u.role}` : (u.name || email);
    return email;
  };
  const filledByDisplay   = _nameWithRole(ev.filledBy);
  const counselorDisplay  = ev.counselorEmail ? _nameWithRole(ev.counselorEmail) : _nameWithRole(ev.counselorName || c.counselorName || '');
  const semLabel = semesterLabel(ev.semester || '');
  const recLabels = { transfer: '建議評估會議轉銜', discuss: '建議評估會議討論後再決定', noTransfer: '建議不需轉銜' };
  const _pDimColor = lvl => lvl === '1' ? '#276749' : ['2','3'].includes(lvl) ? '#dd6b20' : ['4','5'].includes(lvl) ? '#c53030' : '#718096';
  const _dimLevelLabel = v => ({ '1':'1 (低)','2':'2 (中)','3':'3 (中)','4':'4 (高)','5':'5 (高)','無':'無','不清楚':'不清楚' }[v] || v || '—');
  const _ccReasonLabel = { contact_fail:'聯繫未果', green_close:'綠燈結案', other:'其他' };
  const _cstLabel = { agree:'同意', disagree:'不同意', unclear:'未明確表達意願' };
  const cc = ev.clientConsent;
  let _ccRow = '';
  if (cc?.type === 'not_notified') {
    const rLbl = cc.notNotifiedReason === 'other' ? `其他：${esc(cc.notNotifiedOther||'')}` : (_ccReasonLabel[cc.notNotifiedReason] || cc.notNotifiedReason || '');
    _ccRow = `<tr><td colspan="2" style="padding:6px 8px;">☑ 未告知轉銜輔導相關措施　理由：${rLbl}</td></tr>`;
  } else if (cc?.type === 'notified') {
    const sLbl = _cstLabel[cc.studentConsent] || cc.studentConsent || '—';
    const gLbl = cc.guardianConsent ? (_cstLabel[cc.guardianConsent] || cc.guardianConsent) : null;
    _ccRow = `<tr><td colspan="2" style="padding:6px 8px;">☑ 告知轉銜輔導相關措施後<br><span style="margin-left:12pt;">當事人（即學生本人）：${sLbl}</span>${gLbl ? `<br><span style="margin-left:12pt;">法定代理人：${gLbl}</span>` : ''}</td></tr>`;
  }
  const clientConsentSection = _ccRow ? `<div class="section"><table><thead><tr><th colspan="2">當事人意願</th></tr></thead><tbody>${_ccRow}</tbody></table></div>` : '';
  const dimRows = (ev.dimensions || []).map((d, i) => {
    const expText = _getDimExp(i, d.level);
    return `<tr><td style="padding:5px 8px;font-size:11pt;">${i + 1}. ${esc(d.label)}${expText ? `<div style="font-size:9pt;color:#555;margin-top:3px;">${esc(expText)}</div>` : ''}</td>
     <td style="padding:5px 8px;text-align:center;font-size:12pt;font-weight:700;color:${_pDimColor(d.level)};vertical-align:top;">${esc(_dimLevelLabel(d.level))}</td></tr>`;
  }).join('');
  const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').trim();
  const htmlBody = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
  <title>轉銜評估 - ${esc(c.name)}</title>
  <style>
    body { font-family:'微軟正黑體','Microsoft JhengHei',sans-serif; font-size:12pt; margin:20mm 18mm; color:#1a1a1a; }
    h2 { text-align:center; font-size:15pt; margin-bottom:4px; }
    .meta { text-align:center; font-size:10pt; color:#555; margin-bottom:18px; }
    table { width:100%; border-collapse:collapse; margin-bottom:14px; }
    th { background:#f0f4f8; padding:6px 8px; font-size:10.5pt; text-align:left; border:1px solid #ccc; }
    td { border:1px solid #ccc; vertical-align:top; }
    .label { font-size:9.5pt; color:#666; margin-bottom:2px; }
    .section { margin-bottom:14px; }
    .desc { white-space:pre-wrap; font-size:10.5pt; border:1px solid #ccc; padding:8px; min-height:50px; }
    @media print { body { margin:15mm 14mm; } }
  </style></head><body>
  <h2>國立屏東科技大學學生諮商中心 ${esc(semLabel)} 轉銜評估</h2>
  <div class="meta">個案姓名：${esc(c.name)} &ensp;|&ensp; 案號：${esc(c.id)} &ensp;|&ensp; 評估日期：${esc(ev.evalDate || '—')} &ensp;|&ensp; 填表日期：${esc(ev.filledDate || '—')}</div>
  <div class="meta" style="margin-top:-10px;">主責：${esc(counselorDisplay)} &ensp;|&ensp; 評估人：${esc(filledByDisplay)}</div>
  ${clientConsentSection}
  ${dimRows ? `<div class="section"><table><thead><tr><th style="width:80%;">轉銜類型</th><th style="width:20%;text-align:center;">風險等級</th></tr></thead><tbody>${dimRows}</tbody></table></div>` : ''}
  ${stripHtml(ev.mainIssue) ? `<div class="section"><div class="label" style="font-weight:700;margin-bottom:6px;">主訴問題</div><div class="desc">${stripHtml(ev.mainIssue)}</div></div>` : ''}
  ${stripHtml(ev.intervention) ? `<div class="section"><div class="label" style="font-weight:700;margin-bottom:6px;">介入處遇</div><div class="desc">${stripHtml(ev.intervention)}</div></div>` : ''}
  ${stripHtml(ev.transferAssessment) ? `<div class="section"><div class="label" style="font-weight:700;margin-bottom:6px;">轉銜評估</div><div class="desc">${stripHtml(ev.transferAssessment)}</div></div>` : ''}
  <div class="section"><table><tr><th>轉銜評估建議</th></tr><tr><td style="padding:8px;font-weight:700;">${esc(recLabels[ev.recommendation] || ev.recommendation || '—')}</td></tr></table></div>
  </body></html>`;
  _printViaIframe(htmlBody);
}

let _teFormCaseId = null;
let _teFormTeId   = null;
let _teDraftTodoId = null; // v185：從草稿待辦「繼續編輯」重開時記錄對應 todoId

// ── v185：轉銜評估表單草稿備援與離開防護 ──────────────────────────────────
function _teFormSnapshot() {
  const gv = id => document.getElementById(id)?.value ?? '';
  const gr = n => document.querySelector(`[name="${n}"]:checked`)?.value || '';
  return {
    mainIssue: getRichTextValue('te-main-issue'),
    intervention: getRichTextValue('te-intervention'),
    assessment: getRichTextValue('te-assessment'),
    rec: gr('te-rec'),
    ccType: gr('te-cc-type'), ccReason: gr('te-cc-reason'), ccOther: gv('te-cc-other'),
    ccStudent: gr('te-cc-student'), ccGuardian: gr('te-cc-guardian'),
    dims: (CLOSURE_DIMS || []).map((_, i) => document.querySelector(`[name="te-dim-${i}"]:checked`)?.value || ''),
    filledBy: gv('te-filled-by'), evalDate: gv('te-eval-date'), counselor: gv('te-counselor'),
  };
}
function _teDraftKey() {
  return `scc_draft_transfer_${currentUser?.email || ''}_${_teFormCaseId || ''}_${_teFormTeId || 'new'}`;
}
function _startTeDraftAutosave() {
  _gdStartAutosave('transfer', _teDraftKey(), _teFormSnapshot, '_te-draft-status');
}
function _stopTeDraftAutosave() { _gdStopAutosave('transfer'); }

function _restoreTransferEvalDraft(snap) {
  if (!snap) return;
  if (snap.mainIssue != null)    setRichTextValue('te-main-issue', snap.mainIssue);
  if (snap.intervention != null) setRichTextValue('te-intervention', snap.intervention);
  if (snap.assessment != null)   setRichTextValue('te-assessment', snap.assessment);
  if (snap.rec) { const r = document.querySelector(`[name="te-rec"][value="${snap.rec}"]`); if (r) r.checked = true; }
  if (snap.ccType) { const r = document.querySelector(`[name="te-cc-type"][value="${snap.ccType}"]`); if (r) { r.checked = true; _teClientConsentChange(); } }
  if (snap.ccReason) { const r = document.querySelector(`[name="te-cc-reason"][value="${snap.ccReason}"]`); if (r) r.checked = true; }
  const ccOtherEl = document.getElementById('te-cc-other'); if (ccOtherEl && snap.ccOther) ccOtherEl.value = snap.ccOther;
  if (snap.ccStudent) { const r = document.querySelector(`[name="te-cc-student"][value="${snap.ccStudent}"]`); if (r) r.checked = true; }
  if (snap.ccGuardian) { const r = document.querySelector(`[name="te-cc-guardian"][value="${snap.ccGuardian}"]`); if (r) r.checked = true; }
  (snap.dims || []).forEach((level, i) => { if (!level) return; const r = document.querySelector(`[name="te-dim-${i}"][value="${level}"]`); if (r) r.checked = true; });
  const byEl = document.getElementById('te-filled-by'); if (byEl && snap.filledBy) byEl.value = snap.filledBy;
  const evEl = document.getElementById('te-eval-date'); if (evEl && snap.evalDate) evEl.value = snap.evalDate;
  const coEl = document.getElementById('te-counselor'); if (coEl && snap.counselor) coEl.value = snap.counselor;
  _teUpdateSections();
  _gdSetBaseline('transfer', _teFormSnapshot());
}

function _teClientConsentChange() {
  const type = document.querySelector('[name="te-cc-type"]:checked')?.value;
  const rw = document.getElementById('te-cc-reason-wrap');
  const nw = document.getElementById('te-cc-notified-wrap');
  if (rw) rw.style.display = type === 'not_notified' ? 'flex' : 'none';
  if (nw) nw.style.display = type === 'notified' ? 'block' : 'none';
  _teUpdateSections();
}
function _teToggleSection(key) {
  // #6：banner 標題列可反白選字複製；使用者正在選取文字時不觸發收合/展開
  if (window.getSelection && String(window.getSelection()) !== '') return;
  const body    = document.getElementById(`te-${key}-body`);
  const chevron = document.getElementById(`te-${key}-chevron`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chevron) chevron.textContent = isOpen ? '▶ 已收束' : '▼ 展開中';
}
function _teUpdateSections() {
  const type    = document.querySelector('[name="te-cc-type"]:checked')?.value;
  const reason  = document.querySelector('[name="te-cc-reason"]:checked')?.value;
  const student = document.querySelector('[name="te-cc-student"]:checked')?.value;
  const isExempt = (type === 'not_notified' && reason === 'green_close') || (type === 'notified' && student === 'agree');
  const dimsBody    = document.getElementById('te-dims-body');
  const qualBody    = document.getElementById('te-qual-body');
  const dimsChevron = document.getElementById('te-dims-chevron');
  const qualChevron = document.getElementById('te-qual-chevron');
  const dimsReqStar = document.getElementById('te-dims-req-star');
  const qualReqStar = document.getElementById('te-qual-req-star');
  if (isExempt) {
    if (dimsBody && dimsBody.style.display !== 'none') { dimsBody.style.display = 'none'; if (dimsChevron) dimsChevron.textContent = '▶ 已收束'; }
    if (qualBody && qualBody.style.display !== 'none') { qualBody.style.display = 'none'; if (qualChevron) qualChevron.textContent = '▶ 已收束'; }
    if (dimsReqStar) dimsReqStar.style.display = 'none';
    if (qualReqStar) qualReqStar.style.display = 'none';
  } else if (type) {
    if (dimsBody && dimsBody.style.display === 'none') { dimsBody.style.display = ''; if (dimsChevron) dimsChevron.textContent = '▼ 展開中'; }
    if (qualBody && qualBody.style.display === 'none') { qualBody.style.display = ''; if (qualChevron) qualChevron.textContent = '▼ 展開中'; }
    if (dimsReqStar) dimsReqStar.style.display = '';
    if (qualReqStar) qualReqStar.style.display = '';
  }
}

function openTransferEvalForm(caseId, teId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  _teFormCaseId = caseId;
  _teFormTeId   = teId || null;
  const activeSem = _caseDetailActiveSem || currentSemesterPrefix();
  const existing  = teId ? (c.transferEvaluations || []).find(e => e.teId === teId) : null;
  const isNew     = !existing;
  let autoDims = [], autoIssue = '', autoSrcDate = '';

  if (isNew) {
    const allEvals = [...(c.semesterEvaluations || [])].filter(e => !e.deletedAt && !e.replacedBy);
    if (!allEvals.length && c.closureEvaluation) allEvals.push({ ...c.closureEvaluation });
    allEvals.sort((a, b) => (b.evaluatedAt || '').localeCompare(a.evaluatedAt || ''));
    const latest = allEvals[0];
    const noticeEl = document.getElementById('te-form-autofill-notice');
    if (latest) {
      const srcDate = latest.evaluatedAt ? latest.evaluatedAt.slice(0,10) : '—';
      autoSrcDate = srcDate !== '—' ? srcDate : '';
      autoDims = latest.dimensions || [];
      const parts = [latest.chiefComplaint, latest.treatmentProvided, latest.description].filter(Boolean);
      autoIssue = parts.join('\n\n');
      if (noticeEl) {
        noticeEl.innerHTML = `<div style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:10px 14px;font-size:.88rem;color:#276749;">✅ 已自動帶入 ${escHtml(srcDate)} 的${latest.type==='closure'?'結案':'學期'}評估資料（轉銜類型與主訴問題合併帶入）</div>`;
        noticeEl.style.display = '';
      }
    } else if (noticeEl) {
      noticeEl.style.display = 'none';
    }
  } else {
    const noticeEl = document.getElementById('te-form-autofill-notice');
    if (noticeEl) noticeEl.style.display = 'none';
  }

  const titleEl = document.getElementById('te-form-page-title');
  if (titleEl) titleEl.textContent = `${isNew?'新增':'編輯'}轉銜評估 — ${c.name}`;

  const caseInfoEl = document.getElementById('te-form-case-info');
  if (caseInfoEl) caseInfoEl.textContent = `個案：${c.name}（${c.id}）　主責：${c.counselorName || configData?.users?.[c.counselorEmail]?.name || c.counselorEmail || '—'}${_counselorStatusSuffix(c.counselorEmail)}`;

  const filledDateInfoEl = document.getElementById('te-form-filled-date-info');
  if (filledDateInfoEl) filledDateInfoEl.innerHTML = `填表日期：<strong>${new Date().toISOString().slice(0,10)}</strong>（自動帶入當日）`;

  // 當事人意願
  const ccEl = document.getElementById('te-client-consent');
  if (ccEl) {
    const cc = existing?.clientConsent || {};
    const isAdult = c.birthday ? (() => {
      const bd = new Date(c.birthday); const now = new Date();
      let age = now.getFullYear() - bd.getFullYear();
      const mo = now.getMonth() - bd.getMonth();
      if (mo < 0 || (mo === 0 && now.getDate() < bd.getDate())) age--;
      return age >= 18;
    })() : false;
    const ck = (key, v) => cc[key] === v ? ' checked' : '';
    const nnShow = cc.type === 'not_notified' ? 'flex' : 'none';
    const noShow = cc.type === 'notified' ? 'block' : 'none';
    ccEl.innerHTML = `<div style="margin-top:4px;">
      <div style="margin-bottom:12px;">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
          <input type="radio" name="te-cc-type" value="not_notified"${ck('type','not_notified')} onchange="_teClientConsentChange()" style="margin-top:3px;">
          <div style="flex:1;">未告知轉銜輔導相關措施&emsp;理由：
            <div id="te-cc-reason-wrap" style="margin-top:6px;display:${nnShow};gap:6px 16px;flex-wrap:wrap;align-items:center;">
              <label style="font-size:.86rem;"><input type="radio" name="te-cc-reason" value="contact_fail"${ck('notNotifiedReason','contact_fail')} onchange="_teUpdateSections()"> 聯繫未果</label>
              <label style="font-size:.86rem;"><input type="radio" name="te-cc-reason" value="green_close"${ck('notNotifiedReason','green_close')} onchange="_teUpdateSections()"> 綠燈結案</label>
              <label style="font-size:.86rem;display:flex;align-items:center;gap:6px;"><input type="radio" name="te-cc-reason" value="other"${ck('notNotifiedReason','other')} onchange="_teUpdateSections()"> 其他：<input type="text" id="te-cc-other" value="${escHtml(cc.notNotifiedOther||'')}" style="border:1px solid #e2e8f0;border-radius:4px;padding:2px 8px;font-size:.85rem;width:140px;"></label>
            </div>
          </div>
        </label>
      </div>
      <div>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
          <input type="radio" name="te-cc-type" value="notified"${ck('type','notified')} onchange="_teClientConsentChange()" style="margin-top:3px;">
          <div style="flex:1;">告知轉銜輔導相關措施後
            <div id="te-cc-notified-wrap" style="margin-top:10px;display:${noShow};">
              <div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">當事人（即學生本人）</div>
              <div style="display:flex;gap:6px 16px;flex-wrap:wrap;margin-bottom:14px;">
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-student" value="agree"${ck('studentConsent','agree')} onchange="_teUpdateSections()"> 同意未來就讀學校提供轉銜輔導及服務 <span style="font-size:.78rem;color:#276749;">（選填本項者，得免選填「轉銜類型」及「質性描述」欄位）</span></label>
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-student" value="disagree"${ck('studentConsent','disagree')} onchange="_teUpdateSections()"> 不同意未來就讀學校提供轉銜輔導及服務</label>
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-student" value="unclear"${ck('studentConsent','unclear')} onchange="_teUpdateSections()"> 未明確表達意願</label>
              </div>
              ${!isAdult ? `<div style="font-size:.88rem;font-weight:600;color:#4a5568;margin-bottom:6px;">法定代理人 <span style="font-size:.78rem;font-weight:400;color:#718096;">（學生年滿18歲，本項免填）</span></div>
              <div style="display:flex;gap:6px 16px;flex-wrap:wrap;">
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-guardian" value="agree"${ck('guardianConsent','agree')}> 同意未來就讀學校提供轉銜輔導及服務</label>
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-guardian" value="disagree"${ck('guardianConsent','disagree')}> 不同意未來就讀學校提供轉銜輔導及服務</label>
                <label style="font-size:.86rem;"><input type="radio" name="te-cc-guardian" value="unclear"${ck('guardianConsent','unclear')}> 未明確表達意願</label>
              </div>` : '<div style="font-size:.82rem;color:#718096;font-style:italic;">（本生年滿18歲，法定代理人欄位免填）</div>'}
            </div>
          </div>
        </label>
      </div>
    </div>`;
  }

  // 轉銜類型（原八向度）
  const dimSource = existing?.dimensions || autoDims;
  const dimsEl = document.getElementById('te-dims');
  if (dimsEl) {
    dimsEl.innerHTML = (CLOSURE_DIMS||[]).map(function(dim, i) {
      const saved = (dimSource||[]).find(function(d){ return d.label === dim; });
      const cur = saved ? saved.level : '';
      const ck = function(v){ return cur === v ? ' checked' : ''; };
      return '<div class="dim-row">'
        + '<div class="dim-label"><strong>' + (i+1) + '.</strong> ' + escHtml(dim) + '</div>'
        + '<div style="display:inline-grid;grid-template-columns:repeat(7,auto);gap:1px 6px;align-items:center;margin-top:3px;">'
        + '<div></div>'
        + '<div style="text-align:center;color:#276749;font-weight:600;font-size:.71rem;border-top:2px solid #276749;border-left:2px solid #276749;border-right:2px solid #276749;border-radius:4px 4px 0 0;padding:1px 6px;">低</div>'
        + '<div style="grid-column:span 2;text-align:center;color:#dd6b20;font-weight:600;font-size:.71rem;border-top:2px solid #dd6b20;border-left:2px solid #dd6b20;border-right:2px solid #dd6b20;border-radius:4px 4px 0 0;padding:1px 6px;">中</div>'
        + '<div style="grid-column:span 2;text-align:center;color:#c53030;font-weight:600;font-size:.71rem;border-top:2px solid #c53030;border-left:2px solid #c53030;border-right:2px solid #c53030;border-radius:4px 4px 0 0;padding:1px 6px;">高</div>'
        + '<div></div>'
        + '<label data-tip="此向度對個案無明顯影響"><input type="radio" name="te-dim-' + i + '" value="無"' + ck('無') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> 無</label>'
        + '<label data-tip="' + escHtml(DIM_LEVEL_EXPLANATIONS[i].low) + '"><input type="radio" name="te-dim-' + i + '" value="1"' + ck('1') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> <span class="badge badge-green">1</span></label>'
        + '<label data-tip="' + escHtml(DIM_LEVEL_EXPLANATIONS[i].mid) + '"><input type="radio" name="te-dim-' + i + '" value="2"' + ck('2') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> <span class="badge badge-orange">2</span></label>'
        + '<label data-tip="' + escHtml(DIM_LEVEL_EXPLANATIONS[i].mid) + '"><input type="radio" name="te-dim-' + i + '" value="3"' + ck('3') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> <span class="badge badge-orange">3</span></label>'
        + '<label data-tip="' + escHtml(DIM_LEVEL_EXPLANATIONS[i].high) + '"><input type="radio" name="te-dim-' + i + '" value="4"' + ck('4') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> <span class="badge" style="background:#fde8e8;color:#c0392b;">4</span></label>'
        + '<label data-tip="' + escHtml(DIM_LEVEL_EXPLANATIONS[i].high) + '"><input type="radio" name="te-dim-' + i + '" value="5"' + ck('5') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> <span class="badge" style="background:#fde8e8;color:#c0392b;">5</span></label>'
        + '<label data-tip="目前資訊不足以評估此向度"><input type="radio" name="te-dim-' + i + '" value="不清楚"' + ck('不清楚') + ' onchange="window._dimExpUpdate(\'te-dim\',' + i + ',this.value)"/> 不清楚</label>'
        + '</div>'
        + '<div id="te-dim-exp-' + i + '" style="font-size:.78rem;color:#718096;font-style:italic;margin-top:4px;padding:3px 6px;border-left:3px solid #e2e8f0;min-height:1em;">' + escHtml(_getDimExp(i, cur)) + '</div>'
        + '</div>';
    }).join('');
  }

  // 服務概況 badges（八向度後、質性描述前）
  const svcEl = document.getElementById('te-service-history');
  if (svcEl) {
    const allSems = Array.isArray(c.semesters) && c.semesters.length ? [...c.semesters].sort() : [openDateToSemPrefix(c.openDate)].filter(Boolean);
    const badges = allSems.map(s => {
      const snap = c.basicInfoSnapshots?.[s];
      const coName = snap?.counselorText || snap?.counselorName || snap?.counselorEmail || c.counselorText || c.counselorName || c.counselorEmail || '—';
      const cnt = (c.records||[]).filter(r => !r.deleted && openDateToSemPrefix(r.date) === _semKeyBase(s)).length;
      const isCur = s === activeSem;
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:.8rem;background:${isCur?'#ebf8ff':'#f7fafc'};border:1px solid ${isCur?'#90cdf4':'#e2e8f0'};color:${isCur?'#2b6cb0':'#4a5568'};white-space:nowrap;font-weight:${isCur?600:400};">`
        + `<span style="color:#a0aec0;font-size:.72rem;">${escHtml(semesterLabel(s))}</span>`
        + `<span>${escHtml(coName)}</span>`
        + `<span style="background:${isCur?'#3182ce':'#718096'};color:#fff;border-radius:10px;padding:1px 7px;font-size:.72rem;font-weight:700;">${cnt}次</span>`
        + `</span>`;
    }).join('');
    svcEl.innerHTML = `<div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;">`
      + `<div style="font-size:.76rem;font-weight:700;color:#718096;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em;">各學期服務概況（主責・次數）</div>`
      + `<div style="display:flex;flex-wrap:wrap;gap:6px;">${badges||'<span style="color:#a0aec0;font-size:.82rem;">無資料</span>'}</div>`
      + `</div>`;
  }

  // 建議 radios
  document.querySelectorAll('[name="te-rec"]').forEach(r => { r.checked = r.value === (existing?.recommendation || ''); });

  // 下拉選單
  const byEl = document.getElementById('te-filled-by');
  const coEl = document.getElementById('te-counselor');
  if (byEl) byEl.innerHTML = buildCounselorOptgroups(null, '— 請選擇 —');
  if (coEl) coEl.innerHTML = buildCounselorOptgroups(null, '— 請選擇 —');

  // 評估日期：編輯時沿用原值，新增時預設當日
  const evalDateEl = document.getElementById('te-eval-date');
  if (evalDateEl) evalDateEl.value = existing?.evalDate || new Date().toISOString().slice(0, 10);

  _teUpdateSections();
  showPage('page-transfer-eval', null);
  scrollToTop();

  setTimeout(() => {
    setRichTextValue('te-main-issue',   existing?.mainIssue   || autoIssue);
    setRichTextValue('te-intervention', existing?.intervention || '');
    setRichTextValue('te-assessment',   existing?.transferAssessment || '');
    const currentFilledByName = configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
    if (byEl) {
      const existingFilledBy = existing?.filledBy || '';
      const opts = Array.from(byEl.options);
      const m = opts.find(o => o.text.includes(existingFilledBy || currentFilledByName));
      if (m) byEl.value = m.value;
    }
    if (coEl) coEl.value = existing?.counselorEmail || c.counselorEmail || '';
    // v185：欄位（含 rich text／下拉，這兩者要等這個 setTimeout 才真正就緒）填完後才取基準快照
    _gdSetBaseline('transfer', _teFormSnapshot());
    _startTeDraftAutosave();
    const _teds0 = document.getElementById('_te-draft-status'); if (_teds0) _teds0.textContent = '';
  }, 0);
}

function cancelTransferEvalForm() {
  const _exit = () => {
    _stopTeDraftAutosave();
    try { localStorage.removeItem(_teDraftKey()); } catch(_) {}
    _teDraftTodoId = null;
    if (_teFormCaseId) showCaseDetail(_teFormCaseId);
    else showPage('page-cases', document.querySelector('[data-nav-id="page-cases"]'));
  };
  if (!document.getElementById('page-transfer-eval')?.classList.contains('active') || !_gdIsDirty('transfer', _teFormSnapshot())) {
    _exit(); return;
  }
  _showExitDialog('離開轉銜評估表',
    () => saveTransferEval(),
    () => _draftTransferEval(),
    () => _exit()
  );
}

function _draftTransferEval() {
  const snap = _teFormSnapshot();
  const c = casesData.find(x => x.id === _teFormCaseId);
  const existingTodo = _teDraftTodoId ? todosData.find(t => t.id === _teDraftTodoId) : null;
  const todoId = existingTodo?.id || _genTodoId();
  _putTodoItem({
    id: todoId, type: 'transfer_draft', label: '轉銜評估草稿',
    caseId: _teFormCaseId, caseLabel: c ? `${c.name}（${_teFormCaseId}）` : (_teFormCaseId || ''),
    draftData: { caseId: _teFormCaseId, teId: _teFormTeId, snapshot: snap },
    origin: 'manual', notifRead: false, done: false,
    createdAt: existingTodo?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  _stopTeDraftAutosave();
  try { localStorage.removeItem(_teDraftKey()); } catch(_) {}
  _teDraftTodoId = null;
  showPage('page-todos', document.querySelector('[data-nav-id="page-todos"]'));
  renderTodosPage();
  showToast('已暫存草稿至待辦事項', 'success');
  saveUserTodos().catch(e => console.warn('saveUserTodos failed:', e));
}

async function saveTransferEval() {
  const caseId    = _teFormCaseId;
  const teIdOrNew = _teFormTeId || '__new__';
  const gV = id => (document.getElementById(id)?.value || '').trim();
  const gR = n => document.querySelector(`[name="${n}"]:checked`)?.value || '';
  const _stripRt = h => (h||'').replace(/<[^>]*>/g,'').trim();
  const mainIssue    = getRichTextValue('te-main-issue');
  const intervention = getRichTextValue('te-intervention');
  const assessment   = getRichTextValue('te-assessment');
  const rec          = gR('te-rec');
  const filledDate   = new Date().toISOString().slice(0,10);
  const evalDate     = gV('te-eval-date');
  const counselorEmail = gV('te-counselor');
  const filledByRaw  = gV('te-filled-by');
  const _ccTypeV   = gR('te-cc-type');
  const _ccReasonV = gR('te-cc-reason');
  const _ccStudentV= gR('te-cc-student');
  const _isQualExempt = (_ccTypeV === 'not_notified' && _ccReasonV === 'green_close') || (_ccTypeV === 'notified' && _ccStudentV === 'agree');
  if (!_isQualExempt && (!_stripRt(mainIssue) || !_stripRt(intervention) || !_stripRt(assessment))) {
    alert('主訴問題、介入處遇、轉銜評估皆為必填。'); return;
  }
  if (!rec) { alert('請選擇建議選項。'); return; }
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const activeSem = _caseDetailActiveSem || currentSemesterPrefix();
  if (!c.transferEvaluations) c.transferEvaluations = [];
  const now = new Date().toISOString();
  // 當事人意願
  const ccType = gR('te-cc-type');
  const clientConsent = ccType ? {
    type: ccType,
    ...(ccType === 'not_notified' ? {
      notNotifiedReason: gR('te-cc-reason'),
      notNotifiedOther: gV('te-cc-other')
    } : {
      studentConsent: gR('te-cc-student'),
      ...(document.querySelector('[name="te-cc-guardian"]') ? { guardianConsent: gR('te-cc-guardian') } : {})
    })
  } : null;
  // 從表單讀取轉銜類型（已選的項目才存入）
  const dimensions = (CLOSURE_DIMS||[]).map((label, i) => {
    const level = document.querySelector(`[name="te-dim-${i}"]:checked`)?.value || '';
    return { label, level };
  }).filter(d => d.level);
  // sourceEvalDate：新增時取自最新評估，編輯時沿用原值
  let sourceEvalDate = '';
  if (teIdOrNew === '__new__') {
    const allEvals = [...(c.semesterEvaluations || [])].filter(e => !e.deletedAt && !e.replacedBy);
    if (!allEvals.length && c.closureEvaluation) allEvals.push({ ...c.closureEvaluation });
    allEvals.sort((a, b) => (b.evaluatedAt || '').localeCompare(a.evaluatedAt || ''));
    if (allEvals[0]) sourceEvalDate = allEvals[0].evaluatedAt?.slice(0,10) || '';
  } else {
    const ex = c.transferEvaluations.find(e => e.teId === teIdOrNew);
    if (ex) sourceEvalDate = ex.sourceEvalDate || '';
  }
  const counselorName = counselorEmail ? (configData?.users?.[counselorEmail]?.name || counselorEmail) : (c.counselorName || '');
  const filledByName  = filledByRaw || configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  const evalData = { mainIssue, intervention, transferAssessment: assessment, recommendation: rec,
    filledBy: filledByName, filledDate, evalDate, counselorEmail, counselorName,
    semester: evalDate ? openDateToSemPrefix(evalDate) : activeSem, dimensions, sourceEvalDate, updatedAt: now,
    ...(clientConsent ? { clientConsent } : {}) };
  if (teIdOrNew === '__new__') {
    evalData.teId = `te_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    evalData.createdAt = now; evalData.createdBy = currentUser?.email;
    c.transferEvaluations.push(evalData);
  } else {
    const newTeId = `te_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const idx = c.transferEvaluations.findIndex(e => e.teId === teIdOrNew);
    if (idx >= 0) {
      c.transferEvaluations[idx] = { ...c.transferEvaluations[idx], replacedBy: newTeId, replacedAt: now };
      evalData.teId = newTeId;
      evalData.createdAt = now; evalData.createdBy = currentUser?.email;
      c.transferEvaluations.push(evalData);
    } else {
      c.transferEvaluations.push({ ...evalData, teId: teIdOrNew, createdAt: now });
    }
  }
  c.updatedAt = now;
  const _teOrigId = teIdOrNew === '__new__' ? null : teIdOrNew; // 供儲存失敗還原時重開同一筆
  // v185：確定會儲存——停止草稿備援、清掉草稿 key；若是從草稿待辦繼續編輯，標記該待辦完成
  _stopTeDraftAutosave();
  try { localStorage.removeItem(_teDraftKey()); } catch(_) {}
  if (_teDraftTodoId) {
    const _tedt = todosData.find(t => t.id === _teDraftTodoId);
    if (_tedt) { _tedt.done = true; _tedt.doneAt = now; }
    _teDraftTodoId = null;
    saveUserTodos().catch(() => {});
  }
  showCaseDetail(caseId);
  const jobId = bgJobAdd(`儲存轉銜評估：${c.name}`);
  _armSaveFailSnapshot('轉銜評估', 'page-transfer-eval', () => openTransferEvalForm(caseId, _teOrigId), saveTransferEval, jobId);
  (async () => {
    try {
      await saveCasesChunks(caseId);
      _checkTransferGradTodos();
      auditLog('儲存轉銜評估', caseId);
      bgJobDone(jobId);
      _clearSaveFailSnapshot(jobId);
    } catch (e) {
      // 尚未持久化成功，回滾本次寫入（含編輯時標記舊筆 replacedBy），避免「重新儲存」造成重複資料
      const _ci = casesData.findIndex(x => x.id === caseId);
      if (_ci >= 0) {
        const cc = casesData[_ci];
        const _newIdx = (cc.transferEvaluations || []).findIndex(x => x.teId === evalData.teId);
        if (_newIdx >= 0) cc.transferEvaluations.splice(_newIdx, 1);
        if (_teOrigId) {
          const _old = (cc.transferEvaluations || []).find(x => x.teId === _teOrigId);
          if (_old && _old.replacedBy === evalData.teId) { delete _old.replacedBy; delete _old.replacedAt; }
        }
      }
      bgJobFail(jobId, e.message);
      _showSaveFailModal(e.message, jobId);
    }
  })();
}

function softDeleteTransferEval(caseId, teId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c || !teId || !confirm('確定刪除此轉銜評估？（30天內可還原）')) return;
  const ev = (c.transferEvaluations || []).find(e => e.teId === teId);
  if (!ev) return;
  ev.deletedAt = new Date().toISOString();
  c.updatedAt = new Date().toISOString();
  showCaseDetail(caseId);
  const jobId = bgJobAdd(`刪除轉銜評估：${c.name}`);
  (async () => { try { await saveCasesChunks(caseId); bgJobDone(jobId); } catch (e) { bgJobFail(jobId, e.message); } })();
}

function _teSummaryHtml(caseId, semToUse) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return '';
  const latestTeId = _getLatestTeId(caseId, semToUse);
  const te = latestTeId ? (c.transferEvaluations||[]).find(e => e.teId === latestTeId && !e.replacedBy && !e.deletedAt) : null;
  if (!te) return '';
  const cc = te.clientConsent || {};
  let ccText = '';
  if (cc.type === 'not_notified') {
    const rMap = { contact_fail: '聯繫未果', green_close: '綠燈結案', other: cc.notNotifiedOther || '其他' };
    ccText = `未告知（${rMap[cc.notNotifiedReason] || cc.notNotifiedReason || '—'}）`;
  } else if (cc.type === 'notified') {
    const cMap = { agree: '同意', disagree: '不同意', unclear: '未明確表達' };
    ccText = `告知後${cMap[cc.studentConsent] || cc.studentConsent || '—'}`;
  }
  const recMap = { transfer: '建議評估會議轉銜', discuss: '建議評估會議討論後再決定', noTransfer: '建議不需轉銜' };
  const recText = recMap[te.recommendation] || te.recommendation || '';
  if (!ccText && !recText) return '';
  return `<div style="font-size:.77rem;color:#4a5568;display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
    ${ccText ? `<span><span style="color:#a0aec0;">意願：</span>${escHtml(ccText)}</span>` : ''}
    ${recText ? `<span><span style="color:#a0aec0;">建議：</span>${escHtml(recText)}</span>` : ''}
  </div>`;
}
function restoreTransferEval(caseId, teId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c || !teId) return;
  const ev = (c.transferEvaluations || []).find(e => e.teId === teId);
  if (!ev) return;
  delete ev.deletedAt;
  c.updatedAt = new Date().toISOString();
  showCaseDetail(caseId);
  const jobId = bgJobAdd(`還原轉銜評估：${c.name}`);
  (async () => { try { await saveCasesChunks(caseId); bgJobDone(jobId); } catch (e) { bgJobFail(jobId, e.message); } })();
}

// ══════════════════════════════════════════════
// 共用：轉銜管理決議常數 & 歷史 badge 建構器
// ══════════════════════════════════════════════
const _TRANSFER_DEC_LABEL = { pending:'待決議', noTransfer_self:'主責評估綠燈不轉銜', noTransfer_self_reason:'主責評估不轉銜（原因自填）', transfer_school:'校級建議轉銜', noTransfer_school:'校級建議不需轉銜', stay:'本學期不離校', b_case:'B案（無須評估）', one_time_consult:'一次性諮詢不予討論', direct_admission:'直升碩/博士（免評估）', untraceable:'年久不可考' };
const _TRANSFER_DEC_COLOR = { pending:'#718096', noTransfer_self:'#1d6a3a', noTransfer_self_reason:'#276749', transfer_school:'#c0392b', noTransfer_school:'#1d6a3a', stay:'#553c9a', b_case:'#4a5568', one_time_consult:'#4a5568', direct_admission:'#2b6cb0', untraceable:'#6b7280' };
const _TRANSFER_DEC_BG    = { pending:'#f0f4f8', noTransfer_self:'#d5f5e3', noTransfer_self_reason:'#c6f6d5', transfer_school:'#fde8e8', noTransfer_school:'#d5f5e3', stay:'#e9d8fd', b_case:'#e2e8f0', one_time_consult:'#e2e8f0', direct_admission:'#e0f2fe', untraceable:'#f3f4f6' };

function _getLinkedCaseForWithdraw(r) {
  if (!r?.studentId) return null;
  return casesData.filter(c => !c.deleted && c.studentId === r.studentId)
    .sort((a, b) => (b.openDate||'').localeCompare(a.openDate||''))[0] || null;
}
function _getWdDecision(r, sem) {
  const lc = _getLinkedCaseForWithdraw(r);
  const gd = lc ? _getGradTransferDecision(lc.id, sem) : null;
  return gd?.status || r.decision || 'pending';
}

const _HIST_LIGHT_STYLES = { '紅燈':{ bg:'#fde8e8',border:'#fc8181',color:'#c0392b' }, '橙燈':{ bg:'#fdebd0',border:'#f6ad55',color:'#9c4a00' }, '黃燈':{ bg:'#fef9e7',border:'#ecc94b',color:'#7d6608' }, '綠燈':{ bg:'#d5f5e3',border:'#68d391',color:'#1d6a3a' } };

function _buildCaseSemMap(studentId) {
  const semMap = {};
  if (!studentId) return semMap;
  casesData.forEach(cc => {
    if (cc.deleted || cc.studentId !== studentId) return;
    const sems = (Array.isArray(cc.semesters) && cc.semesters.length ? cc.semesters : [openDateToSemPrefix(cc.openDate)]).filter(Boolean);
    sems.forEach(sem => {
      const evals = cc.semesterEvaluations || [];
      const hasTypedClosures = evals.some(e => e.type === 'closure');
      const ev = evals.find(e => e.type === 'closure' && e.semester === sem) || (!hasTypedClosures ? (cc.closureEvaluation || null) : null);
      const ms = semesterMonths(sem);
      const recCount = (cc.records || []).filter(r => !r.deleted && ms.includes((r.date||'').slice(0,7))).length;
      semMap[sem] = { caseId: cc.id, counselorName: configData?.users?.[cc.counselorEmail]?.name || cc.counselorName || '', light: ev?.light || ev?.statusLight || '', status: cc.semesterStatus?.[sem] || cc.status || 'active', recCount };
    });
  });
  return semMap;
}

function _makeHistChip({ sem, caseId, counselorName, light, status, recCount }, curSem, allSemKeys) {
  const dupStyle = _semDupStyle(allSemKeys || [], sem);
  const { bg, border, color } = dupStyle || _HIST_LIGHT_STYLES[light]
    || (status !== 'closed'
      ? (sem < curSem ? { bg:'#f3e8ff',border:'#a855f7',color:'#6b21a8' } : { bg:'#ebf8ff',border:'#63b3ed',color:'#2b6cb0' })
      : { bg:'#f0f4f8',border:'#cbd5e0',color:'#718096' });
  const tipText = (dupStyle ? '此學生本學期有多筆開案｜' : '') + `學期：${semesterLabel(sem)}｜主責：${counselorName||'—'}｜服務次數：${recCount??0} 次`;
  return `<span onclick="event.stopPropagation();showCaseDetailAtSem('${escHtml(caseId)}','${escHtml(sem)}')" style="display:inline-block;background:${bg};border:1px solid ${border};color:${color};border-radius:10px;padding:1px 8px;font-size:.78rem;white-space:nowrap;cursor:pointer;" data-tip="${escHtml(tipText)}">${escHtml(semesterLabel(sem))}${counselorName ? `<span style="font-size:.7rem;opacity:.75;margin-left:3px;">${escHtml(counselorName)}</span>` : ''}<span style="font-size:.7rem;opacity:.8;margin-left:3px;">: ${recCount??0}次</span></span>`;
}

function _buildHistBadgesHtml(semMap, curSem, isExpanded, cardId, toggleFnPrefix) {
  const allSemKeys = Object.keys(semMap);
  const histSems = allSemKeys.sort().reverse().map(sem => ({ sem, ...semMap[sem] }));
  if (!histSems.length) return '';
  const visible = histSems.slice(0, 2);
  const extra   = histSems.slice(2);
  const hasExtra = extra.length > 0;
  const chevHtml = hasExtra
    ? `<button onclick="event.stopPropagation();${toggleFnPrefix}ToggleHistory('${escHtml(cardId)}')" data-hist-chev="${escHtml(cardId)}" title="展開／收合歷史學期" style="background:none;border:none;cursor:pointer;padding:0 3px 0 0;font-size:.78rem;color:#718096;line-height:1;flex-shrink:0;">${isExpanded?'▲':'▼'}</button>`
    : '';
  return `<div style="padding:3px 0 5px 30px;display:flex;align-items:center;flex-wrap:wrap;gap:3px;border-top:1px solid #f0f4f8;margin-top:4px;">
    ${chevHtml}<span style="font-size:.74rem;color:#a0aec0;flex-shrink:0;margin-right:2px;">歷史：</span>
    ${visible.map(h => _makeHistChip(h, curSem, allSemKeys)).join('')}
    ${hasExtra ? `<span data-hist-extra="${escHtml(cardId)}" style="display:${isExpanded?'contents':'none'};">${extra.map(h => _makeHistChip(h, curSem, allSemKeys)).join('')}</span><span data-hist-more="${escHtml(cardId)}" onclick="event.stopPropagation();${toggleFnPrefix}ToggleHistory('${escHtml(cardId)}')" style="display:${isExpanded?'none':'inline-block'};font-size:.76rem;color:#3182ce;cursor:pointer;padding:1px 7px;border-radius:8px;background:#ebf8ff;border:1px solid #bee3f8;" data-tip="顯示全部 ${histSems.length} 個學期">...${extra.length} 筆</span>` : ''}
  </div>`;
}

function _buildSourceChip(studentId) {
  if (!studentId) return '';
  const first = casesData.filter(cc => !cc.deleted && cc.studentId === studentId).sort((a, b) => (a.openDate||'').localeCompare(b.openDate||''))[0];
  if (!first) return '';
  const sem = openDateToSemPrefix(first.openDate);
  const src = first.source || '';
  return (sem && src) ? `<span style="display:inline-block;background:#fffbeb;border:1px solid #fbd38d;color:#744210;border-radius:10px;padding:1px 8px;font-size:.74rem;white-space:nowrap;" data-tip="首次進案來源">${escHtml(semesterLabel(sem))}學期，${escHtml(src)}</span>` : '';
}

// ── 轉銜：改變評估者確認流程 ──
function _toggleAssessorPopover(btn) {
  const popover = btn.nextElementSibling;
  const isOpen = popover.style.display !== 'none';
  document.querySelectorAll('.assessor-popover').forEach(p => p.style.display = 'none');
  if (!isOpen) {
    popover.style.display = 'block';
    const sel = popover.querySelector('select');
    if (sel) sel.focus();
    setTimeout(() => {
      const handler = e => {
        if (!btn.closest('.assessor-change-wrap').contains(e.target)) {
          popover.style.display = 'none';
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }, 0);
  }
}

window._showAssessorChangeConfirm = function(transferType, id1, id2, newEmail, selectEl) {
  if (selectEl) {
    selectEl.value = '';
    selectEl.closest('.assessor-popover') && (selectEl.closest('.assessor-popover').style.display = 'none');
  }
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  let contextLabel = '', caseId = null, caseName = '';
  if (transferType === 'grad') {
    caseId = id1;
    const c = casesData.find(x => x.id === caseId);
    caseName = c?.name || caseId;
    contextLabel = `${caseName}（${caseId}）`;
  } else {
    caseId = id2 || null;
    const rec = (transferData || []).find(r => r.id === id1);
    caseName = rec?.name || id1;
    contextLabel = caseId ? `${caseName}（${caseId}）` : caseName;
  }
  window._pendingAssessorChange = { transferType, id1, id2, newEmail, caseName, caseId, contextLabel };
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'assessor-change-confirm-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><h3>確認轉派評估者程序</h3></div>
      <div class="modal-body" style="padding:12px 0 16px;">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">個案：<strong>${escHtml(contextLabel)}</strong></p>
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:14px;">將轉派評估者為：<strong style="color:#3182ce;">${escHtml(newName)}</strong></p>
        <div style="background:#ebf8ff;border:1px solid #90cdf4;border-radius:6px;padding:10px 12px;font-size:.82rem;color:#2b6cb0;">
          確定後，系統將在您的待辦事項建立「轉派評估者」任務。<br>
          請至待辦事項頁面點選「<strong>轉派評估者</strong>」按鈕，才會正式完成轉派並通知對方。
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('assessor-change-confirm-modal').remove()">取消</button>
        ${_isTransferCoordinator() ? `<button class="btn btn-warning" onclick="_onDirectAssessorReassign()">直接轉派</button>` : ''}
        <button class="btn btn-primary" onclick="_onConfirmAssessorChange()">確定，進入轉派程序</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
};

window._onConfirmAssessorChange = function() {
  document.getElementById('assessor-change-confirm-modal')?.remove();
  const p = window._pendingAssessorChange;
  if (!p) return;
  window._pendingAssessorChange = null;
  _createAssessorReassignTodo(p.transferType, p.id1, p.id2, p.newEmail, p.caseName, p.caseId);
};

window._onDirectAssessorReassign = async function() {
  document.getElementById('assessor-change-confirm-modal')?.remove();
  const p = window._pendingAssessorChange;
  if (!p) return;
  window._pendingAssessorChange = null;
  const { transferType, id1, id2, newEmail, caseName, caseId } = p;
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  const myName = configData?.users?.[currentUser?.email]?.name || currentUser?.email || '';
  const caseLbl = caseId ? `${caseName}（${caseId}）` : caseName;
  if (transferType === 'grad') {
    await window._changeGradAssessor(id1, id2, newEmail);
  } else {
    await window._changeWithdrawAssessor(id1, id2, newEmail);
  }
  addNotificationToUser(newEmail, 'transfer_reassign_assessor_notify', caseId || '', caseLbl,
    `${myName} 已將「${caseLbl}」的轉銜評估者直接指派給您，請完成評估`);
  _flushNotifOps().catch(() => {});
  const jobId = bgJobAdd(`直接通知轉派 → ${newName}`);
  try {
    await _appendTodoToUser(newEmail, {
      id: _genTodoId(),
      type: 'transfer_reassign_assessor_notify',
      label: `您被指派為轉銜評估者：${caseLbl}`,
      caseId: caseId || null,
      caseLabel: caseLbl,
      transferType,
      fromName: myName,
      createdAt: new Date().toISOString(),
      done: false, notifRead: false,
    });
    bgJobDone(jobId);
  } catch(e) { bgJobFail(jobId, e.message); }
  showToast(`已直接轉派評估者給 ${newName}，對方將收到通知`, 'success', 3500);
};

function _createAssessorReassignTodo(transferType, id1, id2, newEmail, caseName, caseId) {
  const newName = configData?.users?.[newEmail]?.name || newEmail;
  _putTodoItem({
    id: _genTodoId(),
    type: 'transfer_reassign_assessor',
    label: `轉派評估者 → ${newName}`,
    caseId: caseId || null,
    caseLabel: caseId ? `${caseName}（${caseId}）` : caseName,
    transferType, id1, id2,
    targetEmail: newEmail, targetName: newName,
    createdAt: new Date().toISOString(),
    done: false, notifRead: false,
  });
  saveUserTodos().catch(() => {});
  auditLog('轉銜改變評估者（建立待辦）', caseId || null, null, `→ ${newName}（${newEmail}）`);
  showToast('已建立待辦：請點選「轉派評估者」按鈕完成轉派', 'info', 4000);
  const navEl = document.querySelector('[data-nav-id="page-todos"]');
  showPage('page-todos', navEl);
  renderTodosPage();
}

async function _executeAssessorReassign(todoId) {
  const t = todosData.find(x => x.id === todoId);
  if (!t || t.done) return;
  const sel = document.getElementById('reassign-sel-' + todoId);
  const overrideEmail = sel?.value || '';
  const finalEmail = overrideEmail || t.targetEmail;
  const finalName = overrideEmail ? (configData?.users?.[overrideEmail]?.name || overrideEmail) : t.targetName;
  if (!finalEmail) { showToast('請選擇評估者', 'warn', 2500); return; }
  const btn = document.querySelector(`[data-reassign-id="${todoId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '轉派中…'; }
  const cancelBtn = document.querySelector(`[data-reassign-cancel-id="${todoId}"]`);
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.style.opacity = '0.35'; cancelBtn.style.cursor = 'not-allowed'; }
  try {
    if (t.transferType === 'grad') {
      await window._changeGradAssessor(t.id1, t.id2, finalEmail);
    } else {
      await window._changeWithdrawAssessor(t.id1, t.id2, finalEmail);
    }
    t.targetEmail = finalEmail; t.targetName = finalName;
    t.done = true; t.doneAt = new Date().toISOString();
    _syncTodoBadge();
    saveUserTodos().catch(() => {});
    const myName = configData?.users?.[currentUser?.email]?.name || currentUser?.email || '';
    const caseLbl = t.caseLabel || '';
    addNotificationToUser(finalEmail, 'transfer_reassign_assessor_notify', t.caseId || '', caseLbl,
      `${myName} 已將「${caseLbl}」的轉銜評估者指派給您，請完成評估`);
    _flushNotifOps().catch(() => {});
    const jobId = bgJobAdd(`通知轉派 → ${finalName}`);
    try {
      await _appendTodoToUser(finalEmail, {
        id: _genTodoId(),
        type: 'transfer_reassign_assessor_notify',
        label: `您被指派為轉銜評估者：${caseLbl}`,
        caseId: t.caseId || null,
        caseLabel: caseLbl,
        transferType: t.transferType,
        fromName: myName,
        createdAt: new Date().toISOString(),
        done: false, notifRead: false,
      });
      bgJobDone(jobId);
    } catch(e) { bgJobFail(jobId, e.message); }
    showToast(`已成功轉派評估者給 ${finalName}，對方將收到通知`, 'success', 3500);
    renderTodosPage();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '轉派評估者'; }
    showToast(`轉派失敗：${e.message}`, 'error', 4000);
  }
}

// ── 轉銜：改變評估者 ──
window._changeGradAssessor = async function(caseId, sem, email) {
  if (!email || !caseId) return;
  const cidx = casesData.findIndex(c => c.id === caseId);
  if (cidx < 0) return;
  const cname = configData?.users?.[email]?.name || email;
  casesData[cidx].counselorEmail = email;
  casesData[cidx].counselorName  = cname;
  if (casesData[cidx].basicInfoSnapshots?.[sem]) {
    casesData[cidx].basicInfoSnapshots[sem].counselorEmail = email;
    casesData[cidx].basicInfoSnapshots[sem].counselorName  = cname;
  }
  document.getElementById('transfer-body').innerHTML = _renderGradTransferTab();
  const jobId = bgJobAdd(`轉銜：改變評估者 → ${cname}`);
  try {
    await saveCasesChunks(caseId);
    auditLog('轉銜改變評估者', caseId, null, `→ ${cname}（${email}）`);
    bgJobDone(jobId);
  } catch(e) { bgJobFail(jobId, e.message); }
};

window._changeWithdrawAssessor = async function(rId, lcId, email) {
  if (!email) return;
  const cname = configData?.users?.[email]?.name || email;
  if (lcId) {
    const cidx = casesData.findIndex(c => c.id === lcId);
    if (cidx >= 0) {
      const F = window._withdrawFilters;
      const semToUse = (F?.semester && F.semester !== 'all') ? F.semester : currentSemesterPrefix();
      casesData[cidx].counselorEmail = email;
      casesData[cidx].counselorName  = cname;
      if (casesData[cidx].basicInfoSnapshots?.[semToUse]) {
        casesData[cidx].basicInfoSnapshots[semToUse].counselorEmail = email;
        casesData[cidx].basicInfoSnapshots[semToUse].counselorName  = cname;
      }
    }
  }
  const allWithdraw = (transferData || []).filter(r => r.type === 'withdraw');
  document.getElementById('transfer-body').innerHTML = _renderWithdrawTab(allWithdraw);
  const jobId = bgJobAdd(`轉銜：改變評估者 → ${cname}`);
  try {
    if (lcId) {
      await saveCasesChunks(lcId);
      auditLog('轉銜改變評估者', lcId, null, `→ ${cname}（${email}）`);
    }
    bgJobDone(jobId);
  } catch(e) { bgJobFail(jobId, e.message); }
};

// ── 畢業轉銜總覽分頁 ──
function _renderGradTransferTab() {
  const curSem = currentSemesterPrefix();
  if (!window._gradTransferFilters) {
    const _gtfDefault = () => ({ counselor: currentUser?.email || '', decision: 'pending', filled: 'all', gradStatus: 'all', showResolved: false, semester: 'all', search: '' });
    try {
      const saved = localStorage.getItem('scc_gtf_' + DRIVE_FOLDER_ID);
      window._gradTransferFilters = saved ? { ..._gtfDefault(), ...JSON.parse(saved) } : _gtfDefault();
    } catch(_) { window._gradTransferFilters = _gtfDefault(); }
  }
  if (window._gradTransferFilters.semester === undefined) window._gradTransferFilters.semester = 'all';
  if (window._gradTransferFilters.search === undefined) window._gradTransferFilters.search = '';
  const F = window._gradTransferFilters;
  const semToUse = (F.semester && F.semester !== 'all') ? F.semester : curSem;
  const semLbl = semesterLabel(semToUse);

  // 學期選項（從 transferData 取不重複的畢業轉銜學期，由新到舊）
  const semOpts = [...new Set(
    (transferData || [])
      .filter(r => r.type === 'graduation' && r.semester)
      .map(r => r.semester)
  )].sort().reverse();

  // 基礎個案清單
  let allGradCases;
  if (F.semester && F.semester !== 'all') {
    // 歷史學期模式：從 transferData 取有紀錄的 caseId，不限封存狀態
    const semCaseIds = new Set(
      (transferData || [])
        .filter(r => r.type === 'graduation' && r.semester === F.semester)
        .map(r => r.caseId)
    );
    allGradCases = casesData
      .filter(c => !c.deleted && semCaseIds.has(c.id))
      .map(c => {
        const gs = _computeGradStatus(c, semToUse);
        return { c, gs: gs || { isRelevant: true, isOverdue: false, isAboutToGraduate: false, yearsAttended: 0, progYears: 0, degreeName: '', typeChar: '', curYear: 0, curSemType: '1', admYear: 0 } };
      })
      .sort((a, b) => (a.c.name || '').localeCompare(b.c.name || ''));
  } else {
    // 當前學期模式：原有邏輯
    allGradCases = casesData
      .filter(c => !c.deleted && !c.archived)
      .map(c => ({ c, gs: _computeGradStatus(c, curSem) }))
      .filter(({ gs }) => gs && gs.isRelevant)
      .sort((a, b) => (a.c.name || '').localeCompare(b.c.name || ''));
  }

  if (!allGradCases.length) {
    const emptySemSelect = semOpts.length ? `<div style="margin-top:16px;"><select style="padding:5px 10px;font-size:.85rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="window._gradTransferFilters.semester=this.value;document.getElementById('transfer-body').innerHTML=_renderGradTransferTab()"><option value="all"${F.semester==='all'?' selected':''}>全部學期</option>${semOpts.map(s=>`<option value="${escHtml(s)}"${F.semester===s?' selected':''}>${escHtml(semesterLabel(s))}</option>`).join('')}</select></div>` : '';
    return `<div class="empty-state"><div class="icon">🎓</div><p>${semLbl} 學期無畢業轉銜紀錄</p><p style="font-size:.85rem;color:#a0aec0;">（系統依學號自動偵測：B/E/F/K=4年制、M/N=碩士2年、P=博士3年）</p>${emptySemSelect}</div>`;
  }
  const total = allGradCases.length;
  const withTE  = allGradCases.filter(({ c }) => _hasCaseTransferEval(c.id, semToUse)).length;
  const withDec = allGradCases.filter(({ c }) => { const d = _getGradTransferDecision(c.id, semToUse); return d && d.status !== 'pending'; }).length;
  // 套用篩選
  let gradCases = allGradCases;
  if (F.decision === 'resolved') {
    gradCases = gradCases.filter(({ c }) => (_getGradTransferDecision(c.id, semToUse)?.status || 'pending') !== 'pending');
  } else {
    if (!F.showResolved) gradCases = gradCases.filter(({ c }) => { const d = _getGradTransferDecision(c.id, semToUse); return !d || d.status === 'pending'; });
    if (F.decision !== 'all') gradCases = gradCases.filter(({ c }) => (_getGradTransferDecision(c.id, semToUse)?.status || 'pending') === F.decision);
  }
  if (F.counselor) gradCases = gradCases.filter(({ c }) => (c.counselorEmail||c.counselorName||'') === F.counselor);
  if (F.filled    !== 'all') gradCases = gradCases.filter(({ c }) => F.filled === 'yes' ? _hasCaseTransferEval(c.id, semToUse) : !_hasCaseTransferEval(c.id, semToUse));
  if (F.gradStatus !== 'all') gradCases = gradCases.filter(({ gs }) => F.gradStatus === 'overdue' ? gs.isOverdue : !gs.isOverdue);
  if (F.search) { const q = F.search.toLowerCase(); gradCases = gradCases.filter(({ c }) => (c.studentId||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q) || (c.id||'').toLowerCase().includes(q)); }
  const decLabelMap = _TRANSFER_DEC_LABEL;
  const decColorMap = _TRANSFER_DEC_COLOR;
  const decBgMap    = _TRANSFER_DEC_BG;
  const today = new Date().toISOString().slice(0, 10);
  const statsBar = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
    <span style="background:#f0f4f8;border-radius:8px;padding:6px 14px;font-size:.85rem;">共 <strong>${total}</strong> 位</span>
    <span style="background:#f0fff4;border-radius:8px;padding:6px 14px;font-size:.85rem;">已填評估：<strong>${withTE}</strong></span>
    <span style="background:#faf5ff;border-radius:8px;padding:6px 14px;font-size:.85rem;">已有決議：<strong>${withDec}</strong></span>
    <span style="background:#ebf8ff;border-radius:8px;padding:6px 14px;font-size:.85rem;">篩選顯示：<strong>${gradCases.length}</strong></span>
  </div>`;
  const filterBar = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:.82rem;color:#718096;font-weight:600;flex-shrink:0;">篩選：</span>
    <select id="grad-filter-semester" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_gradFilterChange()">
      <option value="all"${F.semester==='all'?' selected':''}>全部學期</option>
      ${semOpts.map(s => `<option value="${escHtml(s)}"${F.semester===s?' selected':''}>${escHtml(semesterLabel(s))}</option>`).join('')}
    </select>
    <select id="grad-filter-counselor" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_gradFilterChange()">
      ${_buildGradFilterCounselorOpts(F.counselor)}
    </select>
    <select id="grad-filter-decision" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_gradFilterChange()">
      <option value="all"${F.decision==='all'?' selected':''}>全部決議</option>
      <option value="pending"${F.decision==='pending'?' selected':''}>待決議</option>
      <option value="resolved"${F.decision==='resolved'?' selected':''}>已決議（全部）</option>
      <option value="noTransfer_self"${F.decision==='noTransfer_self'?' selected':''}>主責不需轉銜</option>
      <option value="transfer_school"${F.decision==='transfer_school'?' selected':''}>校級建議轉銜</option>
      <option value="noTransfer_school"${F.decision==='noTransfer_school'?' selected':''}>校級不需轉銜</option>
      <option value="stay"${F.decision==='stay'?' selected':''}>本學期不離校</option>
      <option value="b_case"${F.decision==='b_case'?' selected':''}>B案</option>
      <option value="one_time_consult"${F.decision==='one_time_consult'?' selected':''}>一次性諮詢</option>
      <option value="direct_admission"${F.decision==='direct_admission'?' selected':''}>直升碩/博士</option>
      <option value="untraceable"${F.decision==='untraceable'?' selected':''}>年久不可考</option>
    </select>
    <select id="grad-filter-filled" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_gradFilterChange()">
      <option value="all"${F.filled==='all'?' selected':''}>全部評估表</option>
      <option value="yes"${F.filled==='yes'?' selected':''}>已填寫</option>
      <option value="no"${F.filled==='no'?' selected':''}>未填寫</option>
    </select>
    <select id="grad-filter-gradstatus" style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="_gradFilterChange()">
      <option value="all"${F.gradStatus==='all'?' selected':''}>全部畢業狀態</option>
      <option value="overdue"${F.gradStatus==='overdue'?' selected':''}>延畢生</option>
      <option value="near"${F.gradStatus==='near'?' selected':''}>預作畢業生</option>
    </select>
    <label style="display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer;flex-shrink:0;white-space:nowrap;margin-left:4px;">
      <input type="checkbox" id="grad-filter-showresolved" ${F.showResolved?'checked':''} onchange="_gradFilterChange()">
      顯示已決議個案
    </label>
    <input id="grad-filter-search" type="text" placeholder="搜尋學號／姓名／案號…" value="${escHtml(F.search||'')}"
      style="padding:4px 8px;font-size:.82rem;border:1px solid #e2e8f0;border-radius:4px;min-width:160px;"
      oninput="if(!_gradSearchComposing)_gradFilterSearchDebounce()"
      oncompositionstart="_gradSearchComposing=true"
      oncompositionend="_gradSearchComposing=false;_gradFilterChange()">
    <button onclick="_gradFilterClear()" style="padding:4px 10px;font-size:.82rem;border:1px solid #cbd5e0;border-radius:4px;background:#fff;color:#4a5568;cursor:pointer;white-space:nowrap;flex-shrink:0;" title="恢復預設篩選條件">清除篩選</button>
  </div>`;
  const actionBar = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
    <label style="cursor:pointer;" data-tip="Excel 欄位（固定6欄）：姓名、學號、校級評估會議日期、校級會議轉銜評估結果、結案會議日期、結案會議評估結果">
      <input type="file" accept=".xlsx,.xls" style="display:none" onchange="handleImportGradTransferExcel(this)">
      <span class="btn btn-secondary btn-sm">📥 匯入校級評估結果 (Excel)</span>
    </label>
    <button class="btn btn-secondary btn-sm" onclick="downloadGradTransferExcelTemplate()" data-tip="下載校級評估結果 Excel 範本（6欄固定格式，填寫後直接匯入）">📄 下載校級評估結果 Excel 範本</button>
  </div>`;
  const batchBar = `<div style="background:#f0f8ff;border:1px solid #bee3f8;border-radius:8px;padding:9px 14px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input type="checkbox" id="grad-select-all" onchange="_gradToggleAll(this.checked)" title="全選/取消全選" style="flex-shrink:0;">
    <span style="font-size:.82rem;color:#2b6cb0;font-weight:600;">批次套用：</span>
    <select id="grad-batch-status" style="padding:4px 8px;font-size:.82rem;border:1px solid #bee3f8;border-radius:4px;background:#fff;">
      <option value="">選擇決議</option>
      <option value="noTransfer_self">主責評估綠燈不轉銜</option>
      <option value="noTransfer_self_reason">主責評估不轉銜（原因自填）</option>
      <option value="transfer_school">校級建議轉銜</option>
      <option value="noTransfer_school">校級建議不需轉銜</option>
      <option value="stay">本學期不離校</option>
      <option value="b_case">B案（無須評估）</option>
      <option value="one_time_consult">一次性諮詢不予討論</option>
      <option value="direct_admission">直升碩/博士（免評估）</option>
      <option value="untraceable">年久不可考</option>
    </select>
    <input type="date" id="grad-batch-date" value="${today}" title="校級評估會議日期" style="padding:4px 8px;font-size:.82rem;border:1px solid #bee3f8;border-radius:4px;">
    <button class="btn btn-primary btn-sm" onclick="_applyGradBatch('${semToUse}')">套用至已勾選</button>
    <span id="grad-batch-info" style="font-size:.82rem;color:#2b6cb0;"></span>
  </div>`;
  const rows = gradCases.map(({ c, gs }) => {
    const hasTE = _hasCaseTransferEval(c.id, semToUse);
    const dec = _getGradTransferDecision(c.id, semToUse);
    const decStatus = dec?.status || 'pending';
    const isResolved = decStatus !== 'pending';
    let gradBadge;
    if (decStatus === 'stay') {
      // 本學期不離校 = 仍屬延畢，下學期自動再出現
      gradBadge = `<span class="grad-badge grad-overdue" style="font-size:.7rem;">${gs.degreeName}${gs.yearsAttended}年，延畢中</span>`;
    } else if (decStatus !== 'pending') {
      // 已決議 = 已畢業；但直升碩博士若在新學期重新開案則取消已畢業標籤
      const hideGraduated = decStatus === 'direct_admission' &&
        casesData.some(cc => !cc.deleted && cc.name === c.name && cc.id !== c.id);
      gradBadge = hideGraduated
        ? (gs.isOverdue
            ? `<span class="grad-badge grad-overdue" style="font-size:.7rem;">${gs.degreeName}${gs.yearsAttended}年，延畢中</span>`
            : `<span class="grad-badge grad-near" style="font-size:.7rem;">預作畢業</span>`)
        : `<span class="grad-badge" style="background:#e6fffa;color:#1d6a3a;border:1px solid #81e6d9;font-size:.7rem;">已畢業</span>`;
    } else {
      gradBadge = gs.isOverdue
        ? `<span class="grad-badge grad-overdue" style="font-size:.7rem;">${gs.degreeName}${gs.yearsAttended}年，延畢中</span>`
        : `<span class="grad-badge grad-near" style="font-size:.7rem;">預作畢業</span>`;
    }
    const resolvedBadge = isResolved
      ? `<span style="font-size:.72rem;background:#d5f5e3;color:#1d6a3a;border-radius:8px;padding:1px 7px;border:1px solid #9ae6b4;font-weight:600;">已決議</span>`
      : '';
    const teBadge = hasTE
      ? `<span style="font-size:.73rem;background:#d5f5e3;color:#1d6a3a;border-radius:8px;padding:1px 7px;border:1px solid #9ae6b4;">已填評估</span>`
      : `<span style="font-size:.73rem;background:#fde8e8;color:#c0392b;border-radius:8px;padding:1px 7px;border:1px solid #fc8181;">未填評估</span>`;
    const decStyle = `font-size:.73rem;padding:2px 8px;border-radius:10px;background:${decBgMap[decStatus]};color:${decColorMap[decStatus]};border:1px solid ${decColorMap[decStatus]};`;
    const schoolDateDisplay = dec?.schoolMeetingDate ? `<span style="font-size:.75rem;color:#718096;">校級會議：${escHtml(dec.schoolMeetingDate)}</span>` : '';
    const reasonDisplay = decStatus === 'noTransfer_self_reason' && dec?.noTransferReason ? `<span style="font-size:.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;border-radius:6px;padding:1px 6px;" title="不轉銜原因">原因：${escHtml(dec.noTransferReason)}</span>` : '';
    // ── 開案學期歷史 badges（共用 helper）──
    const wdRec = transferData.find(wr => wr.type === 'withdraw' && wr.studentId === c.studentId && wr.semester === semToUse);
    const drChip = wdRec?.departureReason ? `<span style="font-size:.76rem;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fbbf24;">${escHtml(wdRec.departureReason)}</span>` : '';
    const isExpanded = window._gradCardExpanded?.has(c.id) || false;
    const semMap = _buildCaseSemMap(c.studentId);
    const sourceChip = _buildSourceChip(c.studentId);
    const histBadgesHtml = _buildHistBadgesHtml(semMap, curSem, isExpanded, c.id, '_grad');
    return `<div class="record-card" style="margin-bottom:8px;${isResolved?'border-left:3px solid '+decColorMap[decStatus]+';opacity:.88;':''}">
      <div class="record-card-header" style="flex-wrap:wrap;gap:6px;">
        <input type="checkbox" class="grad-cb" data-cid="${escHtml(c.id)}" onchange="_gradCbChange()" style="margin-top:3px;flex-shrink:0;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1;">
          <strong>${escHtml(c.name||'—')}</strong>
          <span style="color:#718096;font-size:.82rem;">${escHtml(c.studentId||'—')}</span>
          ${gradBadge}${resolvedBadge}${teBadge}
          <span style="${decStyle}">${decLabelMap[decStatus]||'—'}</span>
          ${reasonDisplay}${drChip}
          <span style="font-size:.78rem;color:#718096;">主責：${escHtml(c.counselorName||configData?.users?.[c.counselorEmail]?.name||c.counselorEmail||'—')}${_counselorStatusBadge(c.counselorEmail)}</span>
          ${schoolDateDisplay}
          ${sourceChip}
        </div>
        <div style="display:flex;flex-direction:row;align-items:flex-start;gap:8px;">
          <div style="display:flex;flex-direction:column;align-items:flex-start;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <button class="btn btn-secondary btn-sm" onclick="showCaseDetail('${escHtml(c.id)}')">查看個案</button>
              ${hasTE
                ? `<button class="btn btn-secondary btn-sm" onclick="showCaseDetail('${escHtml(c.id)}');setTimeout(()=>openTransferEvalForm('${escHtml(c.id)}',_getLatestTeId('${escHtml(c.id)}','${semToUse}')),500)">編輯評估</button>`
                : `<button class="btn btn-primary btn-sm" onclick="showCaseDetail('${escHtml(c.id)}');setTimeout(()=>openTransferEvalForm('${escHtml(c.id)}',null),500)">填寫評估</button>`}
            </div>
            ${hasTE ? _teSummaryHtml(c.id, semToUse) : ''}
          </div>
          <div style="display:flex;flex-direction:row;align-items:center;gap:4px;flex-wrap:wrap;">
            <select class="field-input" id="gd-sel-${escHtml(c.id)}" style="padding:4px 8px;font-size:.82rem;width:auto;max-width:170px;" onchange="setGradTransferDecision('${escHtml(c.id)}','${semToUse}',this.value)">
              <option value="">設定校級決議▼</option>
              <option value="noTransfer_self"${decStatus==='noTransfer_self'?' selected':''}>主責評估綠燈不轉銜</option>
              <option value="noTransfer_self_reason"${decStatus==='noTransfer_self_reason'?' selected':''}>主責評估不轉銜（原因自填）</option>
              <option value="transfer_school"${decStatus==='transfer_school'?' selected':''}>校級建議轉銜</option>
              <option value="noTransfer_school"${decStatus==='noTransfer_school'?' selected':''}>校級建議不需轉銜</option>
              <option value="stay"${decStatus==='stay'?' selected':''}>本學期不離校</option>
              <option value="b_case"${decStatus==='b_case'?' selected':''}>B案（無須評估）</option>
              <option value="one_time_consult"${decStatus==='one_time_consult'?' selected':''}>一次性諮詢不予討論</option>
              <option value="direct_admission"${decStatus==='direct_admission'?' selected':''}>直升碩/博士（免評估）</option>
              <option value="untraceable"${decStatus==='untraceable'?' selected':''}>年久不可考</option>
            </select>
            <input type="date" id="gd-date-${escHtml(c.id)}" value="${escHtml(dec?.schoolMeetingDate||'')}" title="校級評估會議日期" style="padding:4px;font-size:.8rem;border:1px solid #e2e8f0;border-radius:4px;" onchange="setGradTransferMeetingDate('${escHtml(c.id)}','${semToUse}',this.value)">
            <div style="position:relative;display:inline-block;" class="assessor-change-wrap">
              <button class="btn btn-sm" style="padding:3px 8px;font-size:.78rem;" data-tip="改變評估者（目前：${escHtml(c.counselorName||c.counselorEmail||'未指定')}）" onclick="_toggleAssessorPopover(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><polyline points="20 8 23 11 20 14"/></svg></button>
              <div class="assessor-popover" style="display:none;position:absolute;z-index:500;background:#fff;border:1px solid #cbd5e0;border-radius:8px;padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.15);min-width:200px;top:calc(100% + 4px);right:0;">
                <div style="font-size:.8rem;color:#4a5568;font-weight:600;margin-bottom:6px;">改變評估者</div>
                <select class="field-input" style="padding:4px 8px;font-size:.82rem;width:100%;" onchange="if(this.value)window._showAssessorChangeConfirm('grad','${escHtml(c.id)}','${semToUse}',this.value,this)">
                  <option value="">請選擇…</option>
                  ${buildCounselorOptgroups()}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
      ${histBadgesHtml}
    </div>`;
  }).join('');
  const emptyMsg = !gradCases.length
    ? `<div style="text-align:center;padding:24px;color:#a0aec0;font-size:.9rem;">無符合條件的個案${!F.showResolved && withDec > 0 ? `（${withDec} 位已決議個案已隱藏，可勾選「顯示已決議個案」）` : ''}</div>`
    : '';
  return filterBar + actionBar + `<div id="grad-results-body">${statsBar}${batchBar}${rows || emptyMsg}</div>`;
}

function _buildGradFilterCounselorOpts(selectedValue) {
  return buildCounselorFilterOpts(selectedValue, true, '全部主責');
}

let _gradFilterSearchTimer = null;
let _gradSearchComposing = false;
// v255：畢業/離校生評估區塊拆到 dev/grad-eval.js（build 原樣複製）

let _withdrawFilterSearchTimer = null;
let _wdSearchComposing = false;
function _withdrawFilterSearchDebounce() {
  clearTimeout(_withdrawFilterSearchTimer);
  _withdrawFilterSearchTimer = setTimeout(_withdrawFilterChange, 220);
}

function _withdrawFilterChange() {
  if (!window._withdrawFilters) window._withdrawFilters = {};
  const F = window._withdrawFilters;
  const g = id => document.getElementById(id);
  if (g('wd-filter-semester'))    F.semester    = g('wd-filter-semester').value;
  if (g('wd-filter-counselor'))   F.counselor   = g('wd-filter-counselor').value;
  if (g('wd-filter-decision'))    F.decision    = g('wd-filter-decision').value;
  if (g('wd-filter-filled'))      F.filled      = g('wd-filter-filled').value;
  if (g('wd-filter-showresolved')) F.showResolved = g('wd-filter-showresolved').checked;
  if (g('wd-filter-search'))      F.search      = g('wd-filter-search').value;
  if (F.decision === 'resolved') { F.showResolved = true; const cb = g('wd-filter-showresolved'); if (cb) cb.checked = true; }
  try { localStorage.setItem('scc_wdf_' + DRIVE_FOLDER_ID, JSON.stringify(F)); } catch(_) {}
  const all = transferData.filter(r => r.type === 'withdraw');
  const _gr = document.getElementById('wd-results-body');
  if (_gr) {
    const _t = document.createElement('div');
    _t.innerHTML = _renderWithdrawTab(all);
    const _rb = _t.querySelector('#wd-results-body');
    _gr.innerHTML = _rb ? _rb.innerHTML : _t.innerHTML;
  } else {
    document.getElementById('transfer-body').innerHTML = _renderWithdrawTab(all);
  }
}

function _withdrawFilterClear() {
  const curSem = currentSemesterPrefix();
  window._withdrawFilters = { semester: curSem, counselor: currentUser?.email || '', decision: 'all', filled: 'all', showResolved: false, search: '' };
  try { localStorage.removeItem('scc_wdf_' + DRIVE_FOLDER_ID); } catch(_) {}
  document.getElementById('transfer-body').innerHTML = _renderWithdrawTab(transferData.filter(r => r.type === 'withdraw'));
}

function _withdrawToggleHistory(id) {
  if (!window._withdrawCardExpanded) window._withdrawCardExpanded = new Set();
  const isExp = window._withdrawCardExpanded.has(id);
  if (isExp) window._withdrawCardExpanded.delete(id); else window._withdrawCardExpanded.add(id);
  const nowExp = !isExp;
  const extraEl = document.querySelector(`[data-hist-extra="${CSS.escape(id)}"]`);
  const moreEl  = document.querySelector(`[data-hist-more="${CSS.escape(id)}"]`);
  const chevEl  = document.querySelector(`[data-hist-chev="${CSS.escape(id)}"]`);
  if (extraEl) extraEl.style.display = nowExp ? 'contents' : 'none';
  if (moreEl)  moreEl.style.display  = nowExp ? 'none' : 'inline-block';
  if (chevEl)  chevEl.textContent     = nowExp ? '▲' : '▼';
}

async function handleImportWithdrawExcel(input) {
  if (!input.files?.length) return;
  const file = input.files[0]; input.value = '';
  document.getElementById('transfer-body').innerHTML = '<div style="padding:20px;color:#718096;">解析中…</div>';
  try {
    const buf = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(buf, { type: 'array', cellDates: true }, { fileName: file.name });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
    const rows = raw.map(r => Array.isArray(r) ? r.map(c => (c == null ? '' : String(c).trim())) : []);
    if (rows.length < 2) { alert('找不到資料列'); renderTransferPage(); return; }
    await showWithdrawImportPreview(rows);
  } catch(e) {
    if (e.xlsxCancelled) { alert(e.message); renderTransferPage(); return; }
    alert('解析失敗：' + e.message); renderTransferPage();
  }
}

async function showWithdrawImportPreview(rows) {
  const headers = rows[0].map(h => String(h).trim());
  const nameIdx = headers.findIndex(h => /姓名/.test(h));
  const sidIdx  = headers.findIndex(h => /學號/.test(h));
  const drIdx   = headers.findIndex(h => /離校原因/.test(h));
  if (nameIdx < 0 && sidIdx < 0) { alert('找不到「姓名」或「學號」欄位'); renderTransferPage(); return; }
  const curSem = currentSemesterPrefix();

  // ── 分類每一列資料 ──
  const entries = rows.slice(1).filter(r => r.some(v => v)).map((r, i) => {
    const originalName    = nameIdx >= 0 ? String(r[nameIdx]||'').trim() : '';
    const originalSid     = sidIdx  >= 0 ? String(r[sidIdx] ||'').trim() : '';
    const departureReason = drIdx   >= 0 ? String(r[drIdx]  ||'').trim() : '';
    const { mc, matchType } = _importMatchCase(originalName, originalSid);
    const existingWd = originalSid
      ? transferData.find(t => t.type === 'withdraw' && t.semester === curSem && t.studentId === originalSid && !t.deleted)
      : null;
    const isDuplicate  = !!existingWd;
    const _hasDecision = !!(existingWd && _getWdDecision(existingWd, curSem) !== 'pending');
    // 預設勾選：正常資料，以及重複但尚無決議者
    const _sel = (matchType === 'full' && !isDuplicate) || (isDuplicate && !_hasDecision);
    return { i, name: originalName, sid: originalSid, originalName, originalSid,
             departureReason, mc, matchType, isDuplicate, _hasDecision, _sel,
             forceType: null, _relinking: false };
  });
  if (!entries.length) { alert('未找到有效資料。'); renderTransferPage(); return; }

  let sel = new Set(entries.reduce((acc, e, idx) => { if (e._sel) acc.push(idx); return acc; }, []));
  window._wdRow = entries;

  // ── 頁籤分流 ──
  // normal  : matchType==='full' && !isDuplicate
  // dup     : isDuplicate===true
  // mismatch: (sid_only|name_only) && !isDuplicate
  // notfound: matchType==='none' && !isDuplicate
  let previewTab = entries.some(e => e.matchType === 'full' && !e.isDuplicate) ? 'normal' : 'dup';
  function _wdGetTabEntries(tab) {
    switch (tab) {
      case 'normal':   return entries.filter(e => e.matchType === 'full' && !e.isDuplicate);
      case 'dup':      return entries.filter(e => e.isDuplicate);
      case 'mismatch': return entries.filter(e => (e.matchType === 'sid_only' || e.matchType === 'name_only') && !e.isDuplicate);
      case 'notfound': return entries.filter(e => e.matchType === 'none' && !e.isDuplicate);
      default: return [];
    }
  }
  let _wdLastClick = -1; // Shift 範圍選取：上次點擊的 entries 索引（見全站批次勾選共用 helper）
  window._wdPreviewTab = (t) => { previewTab = t; _wdLastClick = -1; _wdRender(); };

  // ── 勾選操作（Shift 範圍計算呼叫共用純函式 _ckgRangeIndices）──
  window._wdSel = (i, c, evt) => {
    const tabIdxs = _wdGetTabEntries(previewTab).map(e => entries.indexOf(e));
    const range = (evt?.shiftKey && _wdLastClick >= 0 && tabIdxs.includes(_wdLastClick)) ? _ckgRangeIndices(tabIdxs, _wdLastClick, i) : [i];
    range.forEach(idx => c ? sel.add(idx) : sel.delete(idx));
    _wdLastClick = i;
    _wdRender();
  };
  window._wdToggleAll = () => {
    const tabIdxs = _wdGetTabEntries(previewTab).map(e => entries.indexOf(e));
    const allSel  = tabIdxs.every(i => sel.has(i));
    tabIdxs.forEach(i => allSel ? sel.delete(i) : sel.add(i));
    _wdLastClick = -1;
    _wdRender();
  };

  // ── 欄位排序 ──
  let sortKey = null, sortDir = 1;
  window._wdSort = (key) => {
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    const selSet = new Set([...sel].map(i => entries[i]));
    entries.sort((a, b) => (a[key]||'').localeCompare(b[key]||'', 'zh-TW') * sortDir);
    sel = new Set(entries.map((e, i) => selSet.has(e) ? i : -1).filter(i => i >= 0));
    _wdRender();
  };

  // ── 行內編輯後重新驗證（blur 觸發）──
  window._wdRevalidate = (i) => {
    const e = window._wdRow[i];
    const { mc, matchType } = _importMatchCase(e.name, e.sid);
    const existingWd = e.sid ? transferData.find(t => t.type === 'withdraw' && t.semester === curSem && t.studentId === e.sid && !t.deleted) : null;
    const isDuplicate  = !!existingWd;
    const _hasDecision = !!(existingWd && _getWdDecision(existingWd, curSem) !== 'pending');
    e.mc = mc; e.matchType = matchType; e.isDuplicate = isDuplicate; e._hasDecision = _hasDecision;
    e.forceType = null; e._relinking = false;
    if (matchType === 'full' && !isDuplicate)      sel.add(i);
    else if (isDuplicate && !_hasDecision)          sel.add(i);
    else                                            sel.delete(i);
    _wdRender();
    if (matchType !== 'full') {
      const tr = document.querySelector(`tr[data-wd-row-idx="${i}"]`);
      if (tr) { tr.classList.remove('gt-shake'); void tr.offsetWidth; tr.classList.add('gt-shake'); setTimeout(() => tr.classList.remove('gt-shake'), 600); }
    }
  };

  // ── 動作按鈕 callback ──
  window._wdForceLink      = (i) => { entries[i].forceType = 'direct';           sel.add(i); _wdRender(); };
  window._wdUpdateSid      = (i) => { entries[i].forceType = 'update_sid';        sel.add(i); _wdRender(); };
  window._wdLinkByName     = (i) => { entries[i].forceType = 'link_by_name';      sel.add(i); _wdRender(); };
  window._wdDeferCounselor = (i) => { entries[i].forceType = 'defer_counselor';   sel.add(i); _wdRender(); };
  window._wdStartRelink    = (i) => { window._wdRow[i]._relinking = true; _wdRender(); };
  window._wdRelinkPick     = (i, cid) => {
    const mc = casesData.find(c => c.id === cid);
    if (!mc) return;
    const e = window._wdRow[i];
    e.mc = mc; e.sid = mc.studentId; e.forceType = 'relink'; e._relinking = false;
    sel.add(i); _wdRender();
  };
  window._wdCancelRelink = (i) => { window._wdRow[i]._relinking = false; _wdRender(); };
  window._wdCancelForce  = (i) => {
    const e = entries[i];
    const { mc, matchType } = _importMatchCase(e.name, e.sid);
    const existingWd = e.sid ? transferData.find(t => t.type === 'withdraw' && t.semester === curSem && t.studentId === e.sid && !t.deleted) : null;
    e.mc = mc; e.matchType = matchType; e.isDuplicate = !!existingWd;
    e._hasDecision = !!(existingWd && _getWdDecision(existingWd, curSem) !== 'pending');
    e.forceType = null; e._relinking = false; sel.delete(i); _wdRender();
  };

  // ── 單列渲染 ──
  function _wdMakeRow(e, i) {
    const forceAccepted = !!e.forceType;
    const isEditable    = !e.isDuplicate && e.matchType !== 'full' && !forceAccepted && !e._relinking;
    const manuallyFixed = (e.name !== e.originalName || e.sid !== e.originalSid) && e.matchType === 'full' && !e.isDuplicate;
    const existingWd    = e.isDuplicate ? (transferData.find(t => t.type==='withdraw'&&t.semester===curSem&&t.studentId===e.sid&&!t.deleted)||{}) : null;
    const decBadge = e.isDuplicate && e._hasDecision
      ? `<span style="font-size:.72rem;background:#fed7aa;color:#9c4221;border-radius:4px;padding:1px 5px;border:1px solid #fb923c;">已有決議：${escHtml(_TRANSFER_DEC_LABEL[_getWdDecision(existingWd,curSem)]||'—')}</span>`
      : e.isDuplicate
        ? `<span style="font-size:.72rem;background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 5px;border:1px solid #7dd3fc;">已有紀錄（尚無決議，將更新）</span>`
        : '';
    const warnMsg = !e.isDuplicate && !forceAccepted && !manuallyFixed
      ? (e.matchType==='none'      ? '❌ 找不到個案'
       : e.matchType==='sid_only'  ? `⚠ 學號符合姓名不符（系統：${escHtml(e.mc?.name||'—')}）`
       : e.matchType==='name_only' ? `⚠ 姓名符合學號不符（系統：${escHtml(e.mc?.studentId||'—')}）` : '')
      : '';
    const rowBg = e.isDuplicate && e._hasDecision ? '#fff7ed'
      : e.isDuplicate ? '#eff6ff'
      : forceAccepted || manuallyFixed ? '#ecfdf5'
      : isEditable ? '#fff8e1'
      : (i % 2 === 0 ? '#fff' : '#f7fafc');
    const auditHtml = [
      e.name !== e.originalName ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">(原姓名：${escHtml(e.originalName)})</div>` : '',
      e.sid  !== e.originalSid  ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">(原學號：${escHtml(e.originalSid)})</div>`  : '',
    ].join('');
    const _btn = (onclick, label, color, bg) =>
      `<button onclick="${onclick}" style="margin-top:3px;font-size:.82rem;padding:4px 10px;border:1px solid ${color};background:${bg};color:${color};border-radius:4px;cursor:pointer;white-space:nowrap;">${label}</button>`;
    let actionBtns = '';
    if (!e.isDuplicate && !forceAccepted && !e._relinking) {
      const _mcCounselor = e.mc ? (formatCounselorLabel(e.mc.counselorEmail) || e.mc.counselorName || '主責') : null;
      const _deferLabel = _mcCounselor ? `交由主責${_mcCounselor}驗證` : '交由主責驗證';
      if      (e.matchType === 'sid_only')  actionBtns =
        _btn(`window._wdForceLink(${i})`,      '直接匯入（以學號連結）', '#059669', '#ecfdf5') +
        (_mcCounselor ? _btn(`window._wdDeferCounselor(${i})`, _deferLabel, '#9b2c2c', '#fff5f5') : '');
      else if (e.matchType === 'name_only') actionBtns =
        _btn(`window._wdUpdateSid(${i})`,      `更新個案學號為 ${escHtml(e.sid)}`, '#2b6cb0', '#ebf8ff') +
        _btn(`window._wdLinkByName(${i})`,     '與姓名連結',            '#6b21a8', '#faf5ff') +
        (_mcCounselor ? _btn(`window._wdDeferCounselor(${i})`, _deferLabel, '#9b2c2c', '#fff5f5') : '');
      else if (e.matchType === 'none')      actionBtns = _btn(`window._wdStartRelink(${i})`, '手動連結個案', '#718096', '#f7fafc');
    }
    const relinkUI = e._relinking
      ? `<div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
           <select onchange="if(this.value)window._wdRelinkPick(${i},this.value)" style="font-size:.75rem;padding:2px;max-width:180px;border:1px solid #a0aec0;border-radius:4px;">
             <option value="">— 選擇個案 —</option>
             ${casesData.filter(c=>!c.deleted).sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-TW')).map(c=>`<option value="${c.id}">${escHtml(c.name)}（${escHtml(c.studentId||'—')}）</option>`).join('')}
           </select>
           <button onclick="window._wdCancelRelink(${i})" style="font-size:.72rem;padding:1px 6px;border:1px solid #cbd5e0;background:#fff;color:#718096;border-radius:4px;cursor:pointer;width:fit-content;">取消</button>
         </div>`
      : '';
    const forceLabelMap = { direct: '直接匯入（以學號連結）', update_sid: '更新個案學號後連結', link_by_name: '與姓名連結', relink: '重新連結至', defer_counselor: '已排程交由主責驗證' };
    const _resultName = e.mc?.name || '—';
    const _resultSid  = e.forceType === 'update_sid' ? (e.sid || '—') : (e.mc?.studentId || '—');
    const _resultMsg  = (e.forceType === 'update_sid' || e.forceType === 'link_by_name')
      ? `<div style="font-size:.78rem;color:#2b6cb0;margin-top:4px;background:#ebf8ff;border-radius:4px;padding:3px 8px;">因為匯入者的點選，所以個案的姓名、學號將變成：${escHtml(_resultName)}（${escHtml(_resultSid)}）</div>`
      : '';
    const statusContent = e._relinking
      ? relinkUI
      : forceAccepted
        ? `<span style="font-size:.78rem;color:#059669;">✅ ${forceLabelMap[e.forceType]||''}</span><div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">對應：${escHtml(e.mc?.name||'—')}（${escHtml(e.mc?.studentId||'—')}）</div><button onclick="window._wdCancelForce(${i})" style="margin-top:4px;font-size:.7rem;padding:1px 6px;border:1px solid #fc8181;background:#fff5f5;color:#c53030;border-radius:4px;cursor:pointer;">↩ 取消</button>${_resultMsg}`
        : manuallyFixed
          ? `<span style="font-size:.78rem;color:#059669;">✅ 已手動修正對應</span>${auditHtml}`
          : `${decBadge}${warnMsg ? (decBadge ? '<br>' : '') + warnMsg : ''}<div style="display:flex;flex-direction:column;">${actionBtns}</div>${auditHtml}`;
    return `<tr data-wd-row-idx="${i}" style="background:${rowBg};transition:background 0.3s;">
      <td style="text-align:center;padding:4px 6px;"><input type="checkbox" id="wd-cb-${i}" ${sel.has(i)?'checked':''} onchange="window._wdSel(${i},this.checked,event)"></td>
      <td style="min-width:60px;padding:4px 6px;"><div contenteditable="${isEditable}" style="outline:none;" oninput="window._wdRow[${i}].name=this.textContent.trim()" onblur="window._wdRevalidate(${i})">${escHtml(e.name)}</div></td>
      <td style="min-width:80px;padding:4px 6px;"><div contenteditable="${isEditable}" style="outline:none;" oninput="window._wdRow[${i}].sid=this.textContent.trim()" onblur="window._wdRevalidate(${i})">${escHtml(e.sid)}</div></td>
      <td style="padding:4px 6px;font-size:.82rem;color:#92400e;">${escHtml(e.departureReason||'')}</td>
      <td style="font-size:.78rem;min-width:120px;">${statusContent}</td>
    </tr>`;
  }

  // ── 主渲染函式 ──
  function _wdRender() {
    const el = document.getElementById('wd-import-list');
    if (!el) return;
    const normalCount   = entries.filter(e => e.matchType === 'full' && !e.isDuplicate).length;
    const dupCount      = entries.filter(e => e.isDuplicate).length;
    const mismatchCount = entries.filter(e => (e.matchType === 'sid_only' || e.matchType === 'name_only') && !e.isDuplicate).length;
    const notfoundCount = entries.filter(e => e.matchType === 'none' && !e.isDuplicate).length;
    const _sth = (label, key) => {
      const arrow = sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ' ⇅';
      return `<th onclick="window._wdSort('${key}')" style="cursor:pointer;user-select:none;white-space:nowrap;">${label}<span style="font-size:.7rem;color:#a0aec0;">${arrow}</span></th>`;
    };
    const _tabBtn = (id, label, count, color, warn) => {
      const active = previewTab === id;
      const badge  = warn && count > 0 ? `<span style="font-size:.68rem;background:${color}25;color:${color};border-radius:8px;padding:0 5px;margin-left:3px;border:1px solid ${color}60;">!</span>` : '';
      return `<button onclick="window._wdPreviewTab('${id}')" style="padding:6px 14px;border:none;cursor:pointer;font-size:.82rem;font-weight:${active?'700':'400'};background:none;border-bottom:${active?`2px solid ${color}`:'2px solid transparent'};color:${active?color:'#718096'};margin-bottom:-2px;white-space:nowrap;">${label}（${count}）${badge}</button>`;
    };
    const tabBtns = `<div class="gt-tabs-bar" style="position:sticky;top:0;z-index:20;background:#fff;display:flex;gap:2px;border-bottom:2px solid #e2e8f0;padding-bottom:2px;flex-wrap:wrap;padding-top:2px;">
      ${_tabBtn('normal',   '正常資料',     normalCount,   '#2b6cb0', false)}
      ${_tabBtn('dup',      '重複資料',     dupCount,      '#c05621', true)}
      ${_tabBtn('mismatch', '姓名/學號不符', mismatchCount, '#d97706', true)}
      ${_tabBtn('notfound', '找不到個案',   notfoundCount, '#e53e3e', true)}
    </div>`;
    const hintMap = {
      normal:   `<div style="font-size:.82rem;color:#4a5568;margin-bottom:8px;">✅ 姓名與學號完全符合，尚無本學期轉退學紀錄，預設全選。</div>`,
      dup:      `<div style="font-size:.82rem;color:#9c4221;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-bottom:8px;">🔁 本學期已有轉退學紀錄。<br>• 尚無決議（藍色）：預設勾選，匯入後更新姓名與離校原因。<br>• 已有決議（橙色）：預設不勾選，勾選後匯入將舊決議備份至歷史，請謹慎確認。</div>`,
      mismatch: `<div style="font-size:.82rem;color:#d97706;background:#fffaf0;border:1px solid #f6ad55;border-radius:6px;padding:8px 12px;margin-bottom:8px;">⚠ 學號或姓名其中一項符合，另一項不符。可直接點選格子修改，離開欄位後即時重新比對；或使用下方動作按鈕選擇處理方式。</div>`,
      notfound: `<div style="font-size:.82rem;color:#e53e3e;background:#fff5f5;border:1px solid #fc8181;border-radius:6px;padding:8px 12px;margin-bottom:8px;">❌ 系統中找不到對應個案。勾選後仍可匯入（納入名單但暫無連結個案），或使用「手動連結個案」先行連結再確認。</div>`,
    };
    const emptyMap = { normal: '無正常資料', dup: '無重複資料', mismatch: '無姓名/學號不符資料', notfound: '無找不到個案的資料' };
    const tabEntries  = _wdGetTabEntries(previewTab);
    const tabIdxs     = tabEntries.map(e => entries.indexOf(e));
    const tabSelCount = tabIdxs.filter(i => sel.has(i)).length;
    const tbody = tabEntries.map(e => _wdMakeRow(e, entries.indexOf(e))).join('');
    const tableHtml = tabEntries.length
      ? `<table class="grad-import-table" style="width:100%;border-collapse:collapse;font-size:.85rem;">
           <thead><tr id="wd-thead-row" style="background:#f7fafc;font-size:.8rem;position:sticky;top:0;">
             <th style="width:30px;"><input type="checkbox" id="wd-sel-all-cb" title="全選/取消全選" onclick="window._wdToggleAll()"></th>
             ${_sth('姓名','name')}${_sth('學號','sid')}<th>離校原因</th><th>狀態</th>
           </tr></thead><tbody>${tbody}</tbody></table>`
      : `<div style="padding:20px;text-align:center;color:#a0aec0;">${emptyMap[previewTab]}</div>`;
    el.innerHTML = tabBtns + hintMap[previewTab] + tableHtml;
    // sticky 頁籤列高度補偏
    const tabsBarEl = el.querySelector('.gt-tabs-bar');
    const theadEl   = document.getElementById('wd-thead-row');
    if (tabsBarEl && theadEl) theadEl.style.top = tabsBarEl.offsetHeight + 'px';
    // 全選 checkbox 三態
    const headerCb = document.getElementById('wd-sel-all-cb');
    if (headerCb && tabEntries.length > 0) {
      headerCb.checked       = tabSelCount === tabEntries.length;
      headerCb.indeterminate = tabSelCount > 0 && tabSelCount < tabEntries.length;
    }
    // 底部按鈕
    const btn = document.getElementById('wd-confirm-btn');
    if (btn) btn.textContent = `匯入 / 更新 ${sel.size} 筆`;
    const selDupDecCount = [...sel].filter(i => entries[i]?.isDuplicate && entries[i]?._hasDecision).length;
    const infoEl = document.getElementById('wd-sel-info');
    if (infoEl) infoEl.textContent = selDupDecCount > 0 ? `（含 ${selDupDecCount} 筆將備份舊決議）` : '';
  }

  document.getElementById('transfer-body').innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:1rem;color:#1a202c;">教務處轉/退學名單匯入（共 ${entries.length} 筆）</h3>
        <button onclick="renderTransferPage()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:#718096;">&times;</button>
      </div>
      <div id="wd-import-list" style="max-height:60vh;overflow-y:auto;"></div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
        <button id="wd-confirm-btn" class="btn btn-primary" onclick="window._wdConfirm()">匯入</button>
        <button class="btn btn-secondary" onclick="renderTransferPage()">取消</button>
        <span id="wd-sel-info" style="font-size:.82rem;color:#d97706;"></span>
      </div>
    </div>`;
  _wdRender();

  // ── 寫入 ──
  window._wdConfirm = async () => {
    const toImport = entries.filter((_, i) => sel.has(i));
    if (!toImport.length) { alert('未選取任何列'); return; }
    const now = new Date().toISOString();
    const sidUpdateCaseIds = [];
    toImport.forEach(e => {
      if (e.isDuplicate) {
        // 重複：更新既有紀錄
        const existing = transferData.find(t => t.type === 'withdraw' && t.semester === curSem && t.studentId === (e.originalSid || e.sid) && !t.deleted);
        if (existing) {
          if (e._hasDecision) {
            // 舊決議備份到歷史
            const lc = _getLinkedCaseForWithdraw(existing);
            const gd = lc ? _getGradTransferDecision(lc.id, curSem) : null;
            const oldDec    = gd?.status || existing.decision || '';
            const oldDate   = gd?.schoolMeetingDate || existing.schoolMeetingDate || '';
            const oldReason = gd?.noTransferReason  || existing.noTransferReason  || '';
            if (oldDec && oldDec !== 'pending') {
              if (!existing.schoolMeetingHistory) existing.schoolMeetingHistory = [];
              existing.schoolMeetingHistory.push({ decision: oldDec, date: oldDate, noTransferReason: oldReason, recordedAt: now });
              if (gd) { gd.status = 'pending'; delete gd.schoolMeetingDate; delete gd.noTransferReason; }
              else { delete existing.decision; delete existing.schoolMeetingDate; delete existing.noTransferReason; }
            }
          }
          if (e.name) existing.name = e.name;
          existing.departureReason = e.departureReason || '';
          existing.updatedAt = now; existing.updatedBy = currentUser?.email;
        }
      } else {
        // 新增（含 notfound、mismatch 已處理的）
        if (e.forceType === 'update_sid' && e.mc && e.sid && e.sid !== e.mc.studentId) {
          e.mc.studentId = e.sid; sidUpdateCaseIds.push(e.mc.id);
        }
        const recId = 'wd_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const rec = {
          id: recId, type: 'withdraw', semester: curSem,
          name: e.name, studentId: e.sid,
          createdAt: now, createdBy: currentUser?.email, createdByName: currentUser?.name,
        };
        if (e.departureReason) rec.departureReason = e.departureReason;
        transferData.push(rec);
        // 交由主責驗證：在 transferData 新增一筆待審紀錄
        if (e.forceType === 'defer_counselor' && e.mc) {
          transferData.push({
            id: 'wdm_' + Date.now() + '_' + Math.random().toString(36).slice(2),
            type: 'withdraw_mismatch_pending',
            semester: curSem,
            wdRecordId: recId,
            matchedCaseId: e.mc.id,
            matchedCaseName: e.mc.name,
            matchedCaseCounselor: e.mc.counselorEmail,
            originalName: e.originalName, originalSid: e.originalSid,
            importedName: e.name, importedSid: e.sid,
            matchType: e.matchType,
            importedAt: now, importedBy: currentUser?.email,
            resolved: false,
          });
        }
      }
    });
    renderTransferPage();
    const total = toImport.length;
    const deferCount = toImport.filter(e => e.forceType === 'defer_counselor').length;
    const jobId = bgJobAdd(`匯入教務處轉/退學名單（${total}筆）`);
    (async () => { try {
      await saveTransfer();
      if (sidUpdateCaseIds.length) await saveCasesChunks(...sidUpdateCaseIds);
      _checkTransferGradTodos();
      _checkWithdrawMismatchTodos();
      bgJobDone(jobId);
      auditLog('匯入教務處轉/退學名單', null, null, `${total}筆${deferCount ? `（含 ${deferCount} 筆交由主責驗證）` : ''}${sidUpdateCaseIds.length ? `（含 ${sidUpdateCaseIds.length} 筆學號更新）` : ''}`);
    } catch (e2) { bgJobFail(jobId, e2.message); } })();
  };
}

async function downloadWithdrawTemplate() {
  await _xlsxEnsureLib();
  const ws = XLSX.utils.aoa_to_sheet([['姓名', '學號', '離校原因']]);
  ws['!cols'] = [14, 12, 20].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '教務處轉退學名單');
  XLSX.writeFile(wb, '樣版_教務處轉退學名單批次匯入.xlsx');
}

function _renderTransferRow(r) {
  const hasAssessment = r.type === 'outgoing' && r.recommendation;
  const statusBadge = r.type === 'outgoing'
    ? (hasAssessment ? `<span class="badge badge-green">已填評估</span>` : `<span class="badge badge-orange">待填評估</span>`)
    : (r.caseId ? `<span class="badge badge-green">已連結個案</span>` : `<span class="badge badge-gray">待分案</span>`);
  const recBadge = r.recommendation === 'transfer' ? '<span class="badge badge-red">建議轉銜</span>'
    : r.recommendation === 'discuss' ? '<span class="badge badge-orange">建議討論</span>'
    : r.recommendation === 'noTransfer' ? '<span class="badge badge-green">建議不轉銜</span>' : '';
  const schoolInfo = r.fromSchool ? `<span style="font-size:.8rem;color:#718096;">來源：${escHtml(r.fromSchool)}</span>` : (r.toSchool ? `<span style="font-size:.8rem;color:#718096;">轉至：${escHtml(r.toSchool)}</span>` : '');
  const caseLink = (r.type === 'incoming' && r.caseId) ? `<span style="font-size:.8rem;color:#3182ce;">案號：${escHtml(r.caseId)}</span>` : '';
  let counselorInfo = '', semCountInfo = '';
  if (r.type === 'incoming' && r.caseId) {
    const _lc = casesData.find(c => c.id === r.caseId);
    if (_lc) {
      if (_lc.counselorName || _lc.counselorEmail) {
        counselorInfo = `<span style="font-size:.8rem;color:#4a5568;">主責：${escHtml(_lc.counselorName || configData?.users?.[_lc.counselorEmail]?.name || _lc.counselorEmail)}${_counselorStatusBadge(_lc.counselorEmail)}</span>`;
      }
      const _lcSems = Array.isArray(_lc.semesters) && _lc.semesters.length
        ? [..._lc.semesters].sort()
        : [openDateToSemPrefix(_lc.openDate)].filter(Boolean);
      const _semCounts = _lcSems.map(s => {
        const ms = semesterMonths(s);
        const cnt = (_lc.records || []).filter(rec => !rec.deleted && ms.includes((rec.date||'').slice(0,7))).length;
        return `${semesterLabel(s)}：${cnt}次`;
      });
      semCountInfo = `<span style="font-size:.8rem;color:#718096;">${_semCounts.join('　')}</span>`;
    }
  }
  const actions = r.type === 'outgoing'
    ? `<button class="btn btn-secondary btn-sm" onclick="openTransferAssessmentModal('${escHtml(r.id)}','outgoing')">填寫評估</button>
       ${hasAssessment ? `<button class="btn btn-secondary btn-sm" onclick="printTransferAssessment('${escHtml(r.id)}')">列印</button>` : ''}
       <button class="btn btn-danger btn-sm" onclick="deleteTransferRecord('${escHtml(r.id)}')">刪除</button>`
    : `${!r.caseId ? `<button class="btn btn-primary btn-sm" onclick="createCaseFromTransfer('${escHtml(r.id)}')">建立個案</button>` : `<button class="btn btn-secondary btn-sm" onclick="showCaseDetail('${escHtml(r.caseId)}')">查看個案</button>`}
       <button class="btn btn-danger btn-sm" onclick="deleteTransferRecord('${escHtml(r.id)}')">刪除</button>`;
  return `<div class="record-card" style="margin-bottom:10px;">
    <div class="record-card-header">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong>${escHtml(r.name||'—')}</strong>
        <span style="color:#718096;font-size:.83rem;">${escHtml(r.studentId||r.idNumber||'')}</span>
        ${statusBadge}${recBadge}${schoolInfo}${caseLink}${counselorInfo ? ' ' + counselorInfo : ''}${semCountInfo ? ' ' + semCountInfo : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions}</div>
    </div>
  </div>`;
}

async function downloadTransferImportTemplate() {
  await _xlsxEnsureLib();
  const headers = ['高關懷學生姓名', '學號', '身分證字號', '就讀班級/系所', '法定性別（男/女）', '出生年月日（西元，如1999-01-15）', '來源學校'];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = [14, 12, 14, 16, 14, 24, 16].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '轉入名單');
  XLSX.writeFile(wb, '樣版_轉銜學生批次匯入檔案.xlsx');
}

async function handleImportTransferExcel(input, type) {
  if (!input.files?.length) return;
  const file = input.files[0]; input.value = '';
  const prog = document.getElementById('transfer-body');
  prog.innerHTML = '<div style="padding:20px;color:#718096;">解析中…</div>';
  try {
    const ab = await file.arrayBuffer();
    const { wb } = await _xlsxReadUnlocked(ab, { type: 'array' }, { fileName: file.name, presetPasswords: XLSX_LEGACY_IMPORT_PASSWORDS });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) { alert('找不到資料列'); renderTransferPage(); return; }
    await showTransferImportPreview(rows, type);
  } catch(e) {
    if (e.xlsxCancelled) { alert(e.message); renderTransferPage(); return; }
    alert('解析失敗：' + e.message); renderTransferPage();
  }
}

async function showTransferImportPreview(rows, type) {
  const headers = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1).filter(r => r.some(v => v !== ''));
  const colIdx = {};
  headers.forEach((h, i) => {
    if (/姓名/.test(h)) colIdx.name = i;
    else if (/學號/.test(h)) colIdx.studentId = i;
    else if (/身分證/.test(h)) colIdx.idNumber = i;
    else if (/出生|生日/.test(h)) colIdx.birthday = i;
    else if (/班級|系所|科系/.test(h)) colIdx.department = i;
    else if (/法定性別|性別/.test(h)) colIdx.legalGender = i;
    else if (/來源學校|原就讀/.test(h)) colIdx.fromSchool = i;
    else if (/轉至|接收學校/.test(h)) colIdx.toSchool = i;
  });
  const students = dataRows.map(r => ({
    name: colIdx.name !== undefined ? String(r[colIdx.name]||'').trim() : '',
    studentId: colIdx.studentId !== undefined ? String(r[colIdx.studentId]||'').trim() : '',
    idNumber: colIdx.idNumber !== undefined ? String(r[colIdx.idNumber]||'').trim() : '',
    birthday: colIdx.birthday !== undefined ? String(r[colIdx.birthday]||'').trim() : '',
    department: colIdx.department !== undefined ? String(r[colIdx.department]||'').trim() : '',
    legalGender: colIdx.legalGender !== undefined ? String(r[colIdx.legalGender]||'').trim() : '',
    fromSchool: colIdx.fromSchool !== undefined ? String(r[colIdx.fromSchool]||'').trim() : '',
    toSchool: colIdx.toSchool !== undefined ? String(r[colIdx.toSchool]||'').trim() : '',
  })).filter(s => s.name || s.studentId);
  if (!students.length) { alert('未找到有效資料。請確認第一列為標題（需含「姓名」欄）。'); renderTransferPage(); return; }
  students.forEach(s => { s._dup = transferData.some(t => t.type === type && t.name === s.name && t.studentId === s.studentId && s.studentId); });

  let sel = new Set(students.map((_,i) => i).filter(i => !students[i]._dup));
  const typeName = type === 'outgoing' ? '轉出' : '轉入';
  const colH4 = type === 'incoming' ? '來源學校' : '轉至學校';
  const colV4 = s => type === 'incoming' ? s.fromSchool : s.toSchool;

  const render = () => {
    const tbody = students.map((s, i) =>
      `<tr style="${s._dup?'background:#fff8e1;':''}">
        <td style="padding:6px 8px;"><input type="checkbox" ${sel.has(i)?'checked':''} onchange="window._tiSel(${i},this.checked)"></td>
        <td style="padding:6px 8px;">${escHtml(s.name)}</td>
        <td style="padding:6px 8px;">${escHtml(s.studentId)}</td>
        <td style="padding:6px 8px;">${escHtml(s.department)}</td>
        <td style="padding:6px 8px;">${escHtml(colV4(s))}</td>
        <td style="padding:6px 8px;color:#d97706;font-size:.8rem;">${s._dup?'⚠ 重複':''}</td>
      </tr>`).join('');
    document.getElementById('ti-list').innerHTML = `
      <table id="ti-table" style="width:100%;border-collapse:collapse;font-size:.88rem;">
        <colgroup>
          <col id="ti-col-1" style="width:36px;">
          <col id="ti-col-2" style="min-width:80px;">
          <col id="ti-col-3" style="min-width:80px;">
          <col id="ti-col-4" style="min-width:100px;">
          <col id="ti-col-5" style="min-width:100px;">
          <col id="ti-col-6" style="min-width:60px;">
        </colgroup>
        <thead><tr style="background:#f7fafc;font-size:.8rem;">
          <th data-col="1" style="padding:6px 8px;"><input type="checkbox" onchange="window._tiSelAll(this.checked)"></th>
          <th data-col="2" style="padding:6px 8px;">姓名</th><th data-col="3" style="padding:6px 8px;">學號</th>
          <th data-col="4" style="padding:6px 8px;">系所/班級</th><th data-col="5" style="padding:6px 8px;">${colH4}</th><th data-col="6"></th>
        </tr></thead><tbody>${tbody}</tbody>
      </table>`;
    _makeTableResizable({ table: document.getElementById('ti-table'), colPrefix: 'ti-col-', colNums: [1,2,3,4,5,6], prefKey: 'tiColWidths', skipCols: new Set([1,6]) });
    document.getElementById('ti-confirm-btn').textContent = `匯入 ${sel.size} 筆`;
  };
  window._tiSel = (i, c) => { c ? sel.add(i) : sel.delete(i); render(); };
  window._tiSelAll = (c) => { sel = c ? new Set(students.map((_,i)=>i)) : new Set(); render(); };
  document.getElementById('transfer-body').innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:1rem;color:#1a202c;">匯入${typeName}學生（共 ${students.length} 筆）</h3>
        <button onclick="renderTransferPage()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:#718096;">&times;</button>
      </div>
      ${students.some(s=>s._dup)?'<div style="padding:8px 12px;background:#fff8e1;border-radius:6px;color:#d97706;font-size:.85rem;margin-bottom:10px;">⚠ 黃色列為重複記錄，預設不匯入</div>':''}
      <div id="ti-list"></div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button id="ti-confirm-btn" class="btn btn-primary" onclick="window._tiConfirm()">匯入</button>
        <button class="btn btn-secondary" onclick="renderTransferPage()">取消</button>
      </div>
    </div>`;
  render();
  window._tiConfirm = async () => {
    const toImport = students.filter((_,i) => sel.has(i));
    if (!toImport.length) { alert('未選取任何學生'); return; }
    const now = new Date().toISOString();
    toImport.forEach(s => {
      const ex = s._dup ? transferData.find(t => t.type===type && t.name===s.name && t.studentId===s.studentId) : null;
      if (ex) { Object.assign(ex, { ...s, type, updatedAt: now }); }
      else { transferData.push({ id:'tr_'+Date.now()+'_'+Math.random().toString(36).slice(2), type, ...s, createdAt:now, updatedAt:now, createdBy:currentUser?.email, createdByName:currentUser?.name, filledBy:currentUser?.name||currentUser?.email||'', filledDate:now.slice(0,10) }); }
    });
    renderTransferPage();
    const _bgId = bgJobAdd(`匯入${typeName}學生名單（${toImport.length}筆）`);
    (async () => {
      try { await saveTransfer(); auditLog(`匯入${typeName}學生名單`,`${toImport.length}筆`); bgJobDone(_bgId); }
      catch(e) { bgJobFail(_bgId, e.message); }
    })();
  };
}

// v247：轉銜學生初評草稿備援。key 刻意不用 scc_draft_ 前綴，避免被 _migrateLocalStorageDrafts() 掃到
// 誤產生一筆待辦事項——modal 為 insertAdjacentHTML 動態產生、無獨立資料模型，比照家系圖
// _genoDraftKey() 的做法，走「重開表單時本機偵測詢問還原」，不進 todo 清單。
function _taDraftKey(transferId, type) {
  return `scc_ta_draft_${currentUser?.email || ''}_${transferId || 'new'}_${type}`;
}
// 收集目前表單所有欄位（含八向度指標），存空字串/null 代表元素不存在或未填。
function _taFormSnapshot() {
  const gV = id => document.getElementById(id)?.value?.trim() || '';
  const gR = n => document.querySelector(`[name="${n}"]:checked`)?.value || '';
  const indicators = {};
  TRANSFER_INDICATORS.forEach(ind => {
    indicators[ind.key] = {
      degree: gR(`ind_deg_${ind.key}`),
      riskScore: gR(`ind_rsk_${ind.key}`),
      notApplicable: document.querySelector(`[name="ind_na_${ind.key}"]`)?.checked || false,
    };
  });
  return {
    caseId: gV('ta-case-id'), name: gV('ta-name'), dept: gV('ta-dept'), birthday: gV('ta-birthday'),
    gender: gV('ta-gender'), idNumber: gV('ta-id'), sid: gV('ta-sid'),
    from: gV('ta-from'), to: gV('ta-to'),
    cs: gR('ta_cs'), ni: gR('ta_ni'), niOther: gV('ta-ni-other'),
    sc: gR('ta_sc'), gc: gR('ta_gc'),
    indicators,
    issue: gV('ta-issue'), interv: gV('ta-interv'), ta: gV('ta-ta'),
    by: gV('ta-by'), date: gV('ta-date'), rec: gR('ta_rec'),
  };
}
// 逐欄回填草稿快照（radio 用 querySelector 勾選；還原後同步 ta_cs 顯示/隱藏邏輯）。
function _taRestoreDraft(d) {
  const sV = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const sR = (n, v) => { if (!v) return; const el = document.querySelector(`[name="${n}"][value="${CSS.escape(v)}"]`); if (el) el.checked = true; };
  sV('ta-case-id', d.caseId); sV('ta-name', d.name); sV('ta-dept', d.dept); sV('ta-birthday', d.birthday);
  sV('ta-gender', d.gender); sV('ta-id', d.idNumber); sV('ta-sid', d.sid);
  sV('ta-from', d.from); sV('ta-to', d.to);
  sR('ta_cs', d.cs); sR('ta_ni', d.ni); sV('ta-ni-other', d.niOther);
  sR('ta_sc', d.sc); sR('ta_gc', d.gc);
  TRANSFER_INDICATORS.forEach(ind => {
    const iv = d.indicators?.[ind.key];
    if (!iv) return;
    sR(`ind_deg_${ind.key}`, iv.degree);
    sR(`ind_rsk_${ind.key}`, iv.riskScore);
    const naEl = document.querySelector(`[name="ind_na_${ind.key}"]`);
    if (naEl) naEl.checked = !!iv.notApplicable;
  });
  sV('ta-issue', d.issue); sV('ta-interv', d.interv); sV('ta-ta', d.ta);
  sV('ta-by', d.by); sV('ta-date', d.date); sR('ta_rec', d.rec);
  if (d.cs) {
    const niSec = document.getElementById('ta-ni-sec');
    const infSec = document.getElementById('ta-inf-sec');
    if (niSec) niSec.style.display = d.cs === 'notInformed' ? '' : 'none';
    if (infSec) infSec.style.display = d.cs === 'informed' ? '' : 'none';
  }
}
// v247：關閉 modal 統一入口（× 與取消按鈕共用）——停自動暫存、不清草稿（誤關可還原，見 openTransferAssessmentModal）。
function closeTransferAssessmentModal() {
  _gdStopAutosave('taAssess');
  document.getElementById('transfer-assessment-modal')?.remove();
}

function openTransferAssessmentModal(transferId, type) {
  const rec = transferId ? transferData.find(r => r.id === transferId) : null;
  const t = type || rec?.type || 'outgoing';
  const r = rec || { name:'',studentId:'',idNumber:'',birthday:'',department:'',fromSchool:'',toSchool:'',legalGender:'',
    consentStatus:'',notInformedReason:'',notInformedOtherReason:'',studentConsent:'',guardianConsent:'',
    indicators:{},mainIssue:'',intervention:'',transferAssessment:'',
    filledBy:currentUser?.name||'',filledDate:new Date().toISOString().slice(0,10),recommendation:'' };
  const cs = r.consentStatus||'';
  const indRows = TRANSFER_INDICATORS.map(ind => {
    const iv = r.indicators?.[ind.key]||{};
    const dO = (v,l) => `<label style="margin-right:8px;white-space:nowrap;"><input type="radio" name="ind_deg_${ind.key}" value="${v}" ${iv.degree===v?'checked':''}> ${l}</label>`;
    const rO = v => `<label style="margin-right:6px;"><input type="radio" name="ind_rsk_${ind.key}" value="${v}" ${String(iv.riskScore)===String(v)?'checked':''}> ${v}</label>`;
    return `<tr style="border-bottom:1px solid #f0f4f8;">
      <td style="padding:8px;font-size:.82rem;vertical-align:top;">${escHtml(ind.label)}</td>
      <td style="padding:8px;vertical-align:top;white-space:nowrap;">${dO('low','低')}${dO('mid','中')}${dO('high','高')}${dO('unclear','不清楚')}<br><label><input type="checkbox" name="ind_na_${ind.key}" ${iv.notApplicable?'checked':''}> 無此議題</label></td>
      <td style="padding:8px;vertical-align:top;white-space:nowrap;">${[1,2,3,4,5].map(rO).join('')}</td>
    </tr>`;
  }).join('');
  const gO = (v,l) => `<option value="${v}" ${r.legalGender===v?'selected':''}>${l}</option>`;
  const csO = (v,l) => `<label style="margin-right:12px;"><input type="radio" name="ta_cs" value="${v}" ${cs===v?'checked':''}> ${l}</label>`;
  const niO = (v,l) => `<label style="margin-right:12px;"><input type="radio" name="ta_ni" value="${v}" ${r.notInformedReason===v?'checked':''}> ${l}</label>`;
  const scO = (v,l) => `<label style="margin-right:12px;"><input type="radio" name="ta_sc" value="${v}" ${r.studentConsent===v?'checked':''}> ${l}</label>`;
  const gcO = (v,l) => `<label style="margin-right:12px;"><input type="radio" name="ta_gc" value="${v}" ${r.guardianConsent===v?'checked':''}> ${l}</label>`;
  const rO2 = (v,l) => `<label style="margin-right:12px;"><input type="radio" name="ta_rec" value="${v}" ${r.recommendation===v?'checked':''}> ${l}</label>`;
  const isNew = !rec;
  const _currentFilledBy = r.filledBy || configData?.users?.[currentUser?.email]?.name || currentUser?.name || '';
  const _counselorByOpts = (() => {
    const opts = getSortedCounselorEntries(([k, info]) => info.role && info.role !== '系統管理者')
      .map(([k]) => {
        const nm = configData?.users?.[k]?.name || k;
        return `<option value="${escHtml(nm)}" ${_currentFilledBy === nm ? 'selected' : ''}>${escHtml(formatCounselorLabel(k))}</option>`;
      }).join('');
    return `<option value="">請選擇</option>` + opts;
  })();

  document.body.insertAdjacentHTML('beforeend', `
    <div id="transfer-assessment-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;">
      <div style="background:#fff;border-radius:12px;padding:28px;width:95%;max-width:800px;margin:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="font-size:1.1rem;">${isNew?'新增':'編輯'}轉銜學生初評（${t==='outgoing'?'轉出':'轉入'}）</h3>
          <button onclick="closeTransferAssessmentModal()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#718096;">&times;</button>
        </div>
        ${isNew && t === 'incoming' ? `
        <div style="background:#f0f9ff;border:1px solid #bee3f8;border-radius:8px;padding:14px;margin-bottom:18px;">
          <div style="font-weight:600;margin-bottom:8px;font-size:.88rem;">🔍 從既有個案帶入</div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="ta-refill-q" class="field-input" placeholder="輸入姓名、學號或案號搜尋"
              oninput="searchTransferRefill(this.value)" style="flex:1;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('ta-refill-q').value='';document.getElementById('ta-refill-results').innerHTML=''">清除</button>
          </div>
          <div id="ta-refill-results" style="margin-top:8px;"></div>
        </div>` : ''}
        <input type="hidden" id="ta-case-id" value="${escHtml(r.caseId||'')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
          <div><label class="field-label">高關懷學生姓名 <span class="req">*</span></label><input type="text" class="field-input" id="ta-name" value="${escHtml(r.name||'')}"></div>
          <div><label class="field-label">就讀班級/系所</label><input type="text" class="field-input" id="ta-dept" value="${escHtml(r.department||'')}"></div>
          <div><label class="field-label">出生年月日（西元）</label><input type="date" class="field-input" id="ta-birthday" value="${r.birthday||''}"></div>
          <div><label class="field-label">法定性別</label><select class="field-input" id="ta-gender"><option value="">請選擇</option>${gO('男','男')}${gO('女','女')}</select></div>
          <div><label class="field-label">身分證字號</label><input type="text" class="field-input" id="ta-id" value="${escHtml(r.idNumber||'')}"></div>
          <div><label class="field-label">學號</label><input type="text" class="field-input" id="ta-sid" value="${escHtml(r.studentId||'')}"></div>
          ${t==='incoming' ? `<div><label class="field-label">來源學校</label><input type="text" class="field-input" id="ta-from" value="${escHtml(r.fromSchool||'')}"></div>` : `<div><label class="field-label">轉至學校</label><input type="text" class="field-input" id="ta-to" value="${escHtml(r.toSchool||'')}"></div>`}
        </div>
        ${t !== 'incoming' ? `
        <div style="margin-bottom:20px;padding:14px;background:#f8fafc;border-radius:8px;">
          <div style="font-weight:600;margin-bottom:8px;">當事人意願 <span class="req">*</span></div>
          <div style="margin-bottom:8px;">${csO('notInformed','未告知轉銜輔導相關措施')}${csO('informed','已告知轉銜輔導相關措施')}</div>
          <div id="ta-ni-sec" style="${cs!=='notInformed'?'display:none;':''}margin-left:20px;margin-bottom:8px;">
            未告知理由：${niO('notReached','聯繫未果')}${niO('greenLight','綠燈結案')}${niO('other','其他')}
            <input type="text" id="ta-ni-other" class="field-input" style="width:200px;margin-top:4px;" placeholder="其他原因" value="${escHtml(r.notInformedOtherReason||'')}">
          </div>
          <div id="ta-inf-sec" style="${cs!=='informed'?'display:none;':''}margin-left:20px;">
            <div style="margin-bottom:6px;">當事人：${scO('agree','同意')}${scO('disagree','不同意')}${scO('unclear','未明確表達')}</div>
            <div>法定代理人（滿18歲免填）：${gcO('agree','同意')}${gcO('disagree','不同意')}${gcO('unclear','未明確表達')}${gcO('na','免填')}</div>
          </div>
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-weight:600;margin-bottom:8px;">轉銜類型評估指標</div>
          <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.83rem;">
            <thead><tr style="background:#f7fafc;"><th style="padding:8px;text-align:left;">指標</th><th style="padding:8px;text-align:left;">程度</th><th style="padding:8px;text-align:left;">風險值（1–5）</th></tr></thead>
            <tbody>${indRows}</tbody>
          </table></div>
        </div>
        <div style="padding:14px;background:#f8fafc;border-radius:8px;margin-bottom:20px;">
          <div style="font-weight:600;margin-bottom:10px;">總結初評結果 <span class="req">*</span></div>
          <div style="margin-bottom:10px;"><label class="field-label">主訴問題</label><textarea class="field-input" id="ta-issue" rows="3" style="resize:vertical;">${escHtml(r.mainIssue||'')}</textarea></div>
          <div style="margin-bottom:10px;"><label class="field-label">介入處遇</label><textarea class="field-input" id="ta-interv" rows="3" style="resize:vertical;">${escHtml(r.intervention||'')}</textarea></div>
          <div style="margin-bottom:10px;"><label class="field-label">轉銜評估</label><textarea class="field-input" id="ta-ta" rows="3" style="resize:vertical;">${escHtml(r.transferAssessment||'')}</textarea></div>
        </div>
        <div style="padding:14px;background:#f8fafc;border-radius:8px;margin-bottom:20px;">
          <div style="font-weight:600;margin-bottom:8px;">建議</div>
          ${rO2('transfer','建議評估會議轉銜')}${rO2('discuss','建議經評估會議討論後再決定')}${rO2('noTransfer','建議不需轉銜')}
        </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
          <div><label class="field-label">填表人</label><select class="field-input" id="ta-by">${_counselorByOpts}</select></div>
          <div><label class="field-label">填表日期</label><input type="date" class="field-input" id="ta-date" value="${r.filledDate || new Date().toISOString().slice(0,10)}"></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-primary" onclick="saveTransferAssessment('${isNew?'__new__':escHtml(r.id)}','${t}')">儲存</button>
          ${!isNew && r.recommendation ? `<button class="btn btn-secondary" onclick="printTransferAssessment('${escHtml(r.id)}')">列印</button>` : ''}
          <button class="btn btn-secondary" onclick="closeTransferAssessmentModal()">取消</button>
          <span id="_ta-draft-status" style="font-size:.78rem;color:#718096;"></span>
        </div>
      </div>
    </div>`);
  if (t !== 'incoming') {
    document.querySelectorAll('[name="ta_cs"]').forEach(el => el.addEventListener('change', () => {
      document.getElementById('ta-ni-sec').style.display = el.value==='notInformed' ? '' : 'none';
      document.getElementById('ta-inf-sec').style.display = el.value==='informed' ? '' : 'none';
    }));
  }
  // v247：modal 建好後偵測本機是否有殘留的草稿，詢問是否還原
  const _taKey = _taDraftKey(transferId, t);
  try {
    const _taRaw = localStorage.getItem(_taKey);
    if (_taRaw) {
      const _taDraft = JSON.parse(_taRaw);
      if (_taDraft && typeof _taDraft === 'object') {
        if (confirm('偵測到此筆轉銜學生初評有尚未儲存的草稿（可能因頁面重新整理而保留）。\n\n是否還原草稿內容？（會覆蓋目前帶入的內容）\n選擇「取消」則捨棄草稿。')) {
          _taRestoreDraft(_taDraft);
        } else {
          try { localStorage.removeItem(_taKey); } catch (_) {}
        }
      }
    }
  } catch (_) {}
  _gdSetBaseline('taAssess', _taFormSnapshot());
  _gdStartAutosave('taAssess', _taKey, _taFormSnapshot, '_ta-draft-status');
}

async function saveTransferAssessment(idOrNew, type) {
  const gV = id => document.getElementById(id)?.value?.trim()||'';
  const gR = n => { const el=document.querySelector(`[name="${n}"]:checked`); return el?el.value:''; };
  const indicators = {};
  TRANSFER_INDICATORS.forEach(ind => {
    indicators[ind.key] = {
      degree: gR(`ind_deg_${ind.key}`),
      riskScore: gR(`ind_rsk_${ind.key}`) ? parseInt(gR(`ind_rsk_${ind.key}`)) : null,
      notApplicable: document.querySelector(`[name="ind_na_${ind.key}"]`)?.checked||false,
    };
  });
  const now = new Date().toISOString();
  const data = {
    type, name:gV('ta-name'), department:gV('ta-dept'), birthday:gV('ta-birthday'),
    legalGender:gV('ta-gender'), idNumber:gV('ta-id'), studentId:gV('ta-sid'),
    fromSchool: type==='incoming' ? gV('ta-from') : '',
    toSchool: type==='outgoing' ? gV('ta-to') : '',
    caseId: type==='incoming' ? (gV('ta-case-id') || '') : '',
    consentStatus:gR('ta_cs'), notInformedReason:gR('ta_ni'),
    notInformedOtherReason:gV('ta-ni-other'),
    studentConsent:gR('ta_sc'), guardianConsent:gR('ta_gc'),
    indicators, mainIssue:gV('ta-issue'), intervention:gV('ta-interv'),
    transferAssessment:gV('ta-ta'), filledBy:gV('ta-by'), filledDate:gV('ta-date'),
    recommendation:gR('ta_rec'), updatedAt:now,
  };
  if (!data.name) { alert('請填寫學生姓名'); return; }
  // v247：儲存成功，草稿已無留存必要
  try { localStorage.removeItem(_taDraftKey(idOrNew === '__new__' ? null : idOrNew, type)); } catch (_) {}
  _gdStopAutosave('taAssess');
  if (idOrNew === '__new__') {
    data.id = 'tr_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    data.createdAt = now; data.createdBy = currentUser?.email; data.createdByName = currentUser?.name;
    transferData.push(data);
  } else {
    const idx = transferData.findIndex(r => r.id === idOrNew);
    if (idx >= 0) transferData[idx] = { ...transferData[idx], ...data };
    else transferData.push({ ...data, id:idOrNew, createdAt:now, createdBy:currentUser?.email, createdByName:currentUser?.name });
  }
  document.getElementById('transfer-assessment-modal')?.remove();
  renderTransferPage();
  const _bgId = bgJobAdd(`儲存轉銜評估：${data.name}`);
  (async () => {
    try {
      await saveTransfer();
      if (type === 'incoming' && data.caseId) {
        const linkedCase = casesData.find(c => c.id === data.caseId && !c.deleted);
        if (linkedCase) {
          if (!linkedCase.isTransferCase) {
            linkedCase.isTransferCase = true;
            linkedCase.updatedAt = now;
            await saveCasesChunks(data.caseId);
            renderCases();
          }
        } else {
          console.warn('saveTransferAssessment: caseId not found in casesData:', data.caseId);
        }
      }
      auditLog('儲存轉銜評估', data.name);
      bgJobDone(_bgId);
    } catch(e) { bgJobFail(_bgId, e.message); }
  })();
}

async function deleteTransferRecord(id) {
  const r = transferData.find(t => t.id === id);
  if (!r || !confirm(`確定刪除「${r.name}」的轉銜記錄？`)) return;
  transferData = transferData.filter(t => t.id !== id);
  renderTransferPage();
  const _bgId = bgJobAdd(`刪除轉銜記錄：${r.name}`);
  (async () => {
    try { await saveTransfer(); auditLog('刪除轉銜記錄', r.name); bgJobDone(_bgId); }
    catch(e) { bgJobFail(_bgId, e.message); }
  })();
}

async function createCaseFromTransfer(transferId) {
  const r = transferData.find(t => t.id === transferId);
  if (!r) return;
  const existing = r.studentId ? casesData.find(c => c.studentId === r.studentId && !c.deleted) : null;
  if (existing) {
    if (!confirm(`已有學號 ${r.studentId} 的個案（${existing.name}），前往查看？`)) return;
    showCaseDetail(existing.id); return;
  }
  openNewCasePage();
  await new Promise(res => setTimeout(res, 150));
  const setV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setV('nc-name', r.name);
  setV('nc-student-id', r.studentId);
  setV('nc-id-number', r.idNumber);
  setV('nc-dept', r.department);
  if (r.birthday) {
    const bParts = r.birthday.split('-');
    if (bParts.length === 3) {
      setV('nc-birth-year', bParts[0]);
      setV('nc-birth-month', bParts[1].replace(/^0/, ''));
      setV('nc-birth-day',   bParts[2].replace(/^0/, ''));
    }
  }
  if (r.legalGender) {
    const gRadio = document.querySelector(`input[name="nc-gender"][value="${r.legalGender}"]`);
    if (gRadio) gRadio.checked = true;
  }
  const _srcRadio = document.querySelector('input[name="nc-source"][value="轉銜關懷"]');
  if (_srcRadio) _srcRadio.checked = true;
  const _stsRadio = document.querySelector('input[name="nc-status"][value="pending"]');
  if (_stsRadio) _stsRadio.checked = true;
  const _tcEl = document.getElementById('nc-is-transfer-case');
  if (_tcEl) _tcEl.checked = true;
  window._transferPendingLink = transferId;
}

function printTransferAssessment(transferId, mode = 'print') {
  const r = transferData.find(t => t.id === transferId);
  if (!r) return;
  const rocDate = d => { if(!d) return '　年　月　日'; const p=d.split('-'); return p.length===3?`${parseInt(p[0])-1911}年${parseInt(p[1])}月${parseInt(p[2])}日`:d; };
  const degLabel = v => ({low:'低',mid:'中',high:'高',unclear:'不清楚'}[v]||'');
  const indHtml = TRANSFER_INDICATORS.map((ind,idx) => {
    const iv = r.indicators?.[ind.key]||{};
    return `<tr><td style="padding:6px 8px;font-size:12pt;border:1px solid #ccc;">${idx+1}. ${ind.label}</td>
      <td style="padding:6px 8px;text-align:center;border:1px solid #ccc;">${iv.notApplicable?'無此議題':degLabel(iv.degree)}</td>
      <td style="padding:6px 8px;text-align:center;border:1px solid #ccc;">${iv.notApplicable?'—':(iv.riskScore||'—')}</td></tr>`;
  }).join('');
  const _tck = s => s.replace(/[□■]/g, c => `<span style="font-size:2em;line-height:1;vertical-align:0.15em;">${c}</span>`);
  const consentHtml = _tck(r.consentStatus==='notInformed'
    ? `■ 未告知　理由：${r.notInformedReason==='notReached'?'■聯繫未果 □綠燈結案 □其他':r.notInformedReason==='greenLight'?'□聯繫未果 ■綠燈結案 □其他':`□聯繫未果 □綠燈結案 ■其他：${r.notInformedOtherReason||''}`}`
    : `□ 未告知　■ 已告知<br>當事人：${r.studentConsent==='agree'?'■':' □'}同意 ${r.studentConsent==='disagree'?'■':'□'}不同意 ${r.studentConsent==='unclear'?'■':'□'}未明確<br>法定代理人：${r.guardianConsent==='agree'?'■':'□'}同意 ${r.guardianConsent==='disagree'?'■':'□'}不同意 ${r.guardianConsent==='unclear'?'■':'□'}未明確 ${r.guardianConsent==='na'?'■':'□'}免填`);
  const recHtml = _tck(['transfer','discuss','noTransfer'].map((v,i) => {
    const labels = ['建議評估會議轉銜','建議經評估會議討論後再決定是否轉銜','建議不需轉銜'];
    return `${r.recommendation===v?'■':'□'} ${labels[i]}`;
  }).join('<br>'));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>轉銜評估表</title>
    <style>body{font-family:'標楷體',serif;font-size:12pt;line-height:1.8;margin:15mm;}
    h2{text-align:center;font-size:15pt;} h3{font-size:12pt;font-weight:bold;}
    table{width:100%;border-collapse:collapse;margin-bottom:14px;}
    th{background:#f5f5f5;padding:6px 10px;border:1px solid #ccc;font-size:12pt;}
    .sect{border:1px solid #ccc;padding:10px;border-radius:4px;margin-bottom:14px;}
    .no-print{margin-bottom:12px;} @media print{.no-print{display:none;}}</style></head><body>
<div id="dev-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#c05621;color:#fff;text-align:center;padding:5px 12px;font-size:.85rem;font-weight:700;letter-spacing:.05em;">
  <span style="pointer-events:none;">🔧 測試版（dev）— 此版本的資料與正式版完全隔離，請勿用於實際業務</span>
  <button onclick="toggleSyslog()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.72rem;font-weight:700;cursor:pointer;padding:2px 10px;border-radius:3px;letter-spacing:.06em;">LOG</button>
</div>
    <div class="no-print"><button onclick="window.print()">列印</button></div>
    <h2>轉銜學生初評參考指標</h2>
    <p style="text-align:center;font-size:12pt;color:#555;">本文件為保密性文件；僅供學校內部輔導專業評估使用</p>
    <div class="sect">
      <strong>高關懷學生姓名：</strong>${escHtml(r.name)||'　　　'}&emsp;
      <strong>法定性別：</strong>${r.legalGender||'　'}&emsp;
      <strong>出生年月日：</strong>${rocDate(r.birthday)}<br>
      <strong>身分證字號：</strong>${escHtml(r.idNumber)||'　　　　　　'}&emsp;
      <strong>就讀班級/系所：</strong>${escHtml(r.department)||'　　　　'}
    </div>
    <div class="sect"><h3>當事人意願</h3>${consentHtml}</div>
    <div class="sect"><h3>轉銜類型評估指標</h3>
      <table><thead><tr><th>指標</th><th style="width:80px;">程度</th><th style="width:70px;">風險值</th></tr></thead>
      <tbody>${indHtml}</tbody></table></div>
    <div class="sect"><h3>總結初評結果</h3>
      <p><strong>主訴問題：</strong></p><div style="white-space:pre-wrap;min-height:50px;border:1px solid #ccc;padding:6px;">${escHtml(r.mainIssue||'')}</div>
      <p><strong>介入處遇：</strong></p><div style="white-space:pre-wrap;min-height:50px;border:1px solid #ccc;padding:6px;">${escHtml(r.intervention||'')}</div>
      <p><strong>轉銜評估：</strong></p><div style="white-space:pre-wrap;min-height:50px;border:1px solid #ccc;padding:6px;">${escHtml(r.transferAssessment||'')}</div>
      <p><strong>填表人：</strong>${escHtml(r.filledBy||'　　　　')}&emsp;<strong>填表日期：</strong>${rocDate(r.filledDate)}</p>
    </div>
    <div class="sect"><h3>建議</h3>${recHtml}</div>
    </body></html>`;
  _printViaIframe(html);
}

