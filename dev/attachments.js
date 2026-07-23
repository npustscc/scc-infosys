// dev/attachments.js — 附件功能＋圖片編輯器模組（拆 index.html 絞殺者第二十四刀，v271）。
// 內容為從 index.html 逐字搬出的連續區段（附件 picker 狀態/上傳/縮圖/預覽＋
// Fabric.js 圖片編輯器 _imgEd* 全套與獨立圖編頁）。
// 載入期副作用（column-0 複核）：const _attachState/_attachUploadPromises/_recImgCache
// = new Map()（內建，無外部依賴）、window._imgEdActive = false 賦值，以及一個
// document paste 監聽（獨立圖編頁貼圖入口）——該監聽有 page-img-editor active 頁面
// guard，與 ft-ui.js 的 paste 監聽互斥；且本檔仍先於 ft-ui.js 載入（ft-ui 在 body 尾端），
// 兩者相對註冊順序與拆前一致，無行為差異。可安全前移到主 inline script 之前載入
// （刀法①）。函式內部呼叫時才引用主檔全域，跨 script 全域可見。
// ══════════════════════════════════════════════
//  附件功能（Attachment Feature）
// ══════════════════════════════════════════════
const _attachState = new Map(); // pickerId → { existing, pending, deletedFileIds, imagesOnly?, imgMaxPx?, imgQuality? }
const _attachUploadPromises = new Map(); // pickerId → Set<Promise>
let _attachFolderCache = null;
const _recImgCache = new Map(); // fileId → dataUrl（圖片下載快取）

async function _ensureAttachFolder() {
  if (_attachFolderCache) return _attachFolderCache;
  const r = await proxyCall('query', {
    q: `'${DRIVE_FOLDER_ID}' in parents and name='attachments' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'id,name', pageSize: 1
  });
  if (r?.files?.length) { _attachFolderCache = r.files[0].id; return _attachFolderCache; }
  const f = await proxyCall('createFolder', { name: 'attachments', parentId: DRIVE_FOLDER_ID });
  _attachFolderCache = f.id;
  return _attachFolderCache;
}

// 綁定「拖曳檔案」與「Ctrl+V 貼上」到指定元素，觸發時把 files 灌給 pid 對應的 attach picker
// 用於將附件貼法延伸到文字框（textarea / input），不必先點選附件區才能拖曳/貼上
function attachBindDropPaste(el, pid) {
  if (!el || el._attachBoundPid) return; // 已被其他 pid 綁定就跳過（先綁先贏，避免多個 picker 搶同一文字框）
  el._attachBoundPid = pid;
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    el.classList.add('attach-drag-over');
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('attach-drag-over');
  });
  el.addEventListener('drop', e => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    el.classList.remove('attach-drag-over');
    attachHandleInput(pid, { files });
  });
  el.addEventListener('paste', e => {
    if (window._imgEdActive) return; // v197：圖片編輯器開啟中，貼上交給編輯器處理（雙重保險，主要靠 capture-phase stopImmediatePropagation）
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    attachHandleInput(pid, { files });
  });
}

function attachInit(pid, existing, opts = {}) {
  _attachState.set(pid, { existing: existing ? [...existing] : [], pending: [], deletedFileIds: [],
    imagesOnly: !!opts.imagesOnly, imgMaxPx: opts.imgMaxPx || 1280, imgQuality: opts.imgQuality || 0.85 });
  _attachUploadPromises.set(pid, new Set());
  attachRender(pid);
  const wrap = document.getElementById('attachPicker_' + pid);
  if (wrap && !wrap._attachEventsAdded) {
    wrap._attachEventsAdded = true;
    wrap.setAttribute('tabindex', '0');
    attachBindDropPaste(wrap, pid);
  }
  // opts.dropTargets: 額外綁定拖曳/貼上到文字框（element id 陣列，或 element 本身）
  if (Array.isArray(opts.dropTargets)) {
    opts.dropTargets.forEach(t => {
      const el = typeof t === 'string' ? document.getElementById(t) : t;
      if (el) attachBindDropPaste(el, pid);
    });
  }
}

function _attachTotal(pid) {
  const s = _attachState.get(pid);
  return s ? s.existing.length + s.pending.length : 0;
}

function _attachSlots(pid) {
  const s = _attachState.get(pid);
  if (!s) return 0;
  const cost = a => a.type === 'image' ? 1 : 5;
  return s.existing.reduce((n, a) => n + cost(a), 0) +
         s.pending.reduce((n, a) => n + cost(a), 0);
}

function _attachIcon(type) {
  if (type === 'image')     return '🖼️';
  if (type === 'pdf_pages') return '📄';
  if (type === 'word')      return '📝';
  return '📎';
}

function _attachLabel(a) {
  const name = a.fileName || '附件';
  return (a.type === 'pdf_pages' && a.pageRange) ? `${name}（第${a.pageRange}頁）` : name;
}

function attachRender(pid) {
  const wrap = document.getElementById('attachPicker_' + pid);
  if (!wrap) return;
  const s = _attachState.get(pid);
  if (!s) return;
  if (s.imagesOnly) { _attachRenderImages(pid, s); return; }
  const slots = _attachSlots(pid), canAdd = slots < 15;

  const exHtml = s.existing.map((a, i) => `
    <div class="attach-item existing">
      <span style="color:#276749;flex-shrink:0;font-size:.85rem;">✓</span>
      <span>${_attachIcon(a.type)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(_attachLabel(a))}">${escHtml(_attachLabel(a))}</span>
      ${a.type === 'image' ? `<button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditExisting('${escHtml(pid)}',${i})">✏️</button>` : ''}
      <button type="button" class="attach-del-btn" onclick="attachRemoveExisting('${escHtml(pid)}',${i})">×</button>
    </div>`).join('');

  const penHtml = s.pending.map((a, i) => {
    if (a.uploadStatus === 'error') {
      return `<div class="attach-item upload-error">
        <span style="color:#c53030;flex-shrink:0;font-size:.85rem;">✗</span>
        <span>${_attachIcon(a.type)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(a.errorMsg||'')} — ${escHtml(_attachLabel(a))}">${escHtml(_attachLabel(a))}</span>
        <span style="font-size:.72rem;color:#c53030;flex-shrink:0;">上傳失敗</span>
        ${a.type === 'image' ? `<button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditPending('${escHtml(pid)}',${i})">✏️</button>` : ''}
        <button type="button" class="attach-del-btn" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
      </div>`;
    }
    if (a.uploadStatus === 'local') {
      // v197：圖片編輯器產生的「本機待傳」項目——編輯階段完全不打 API，等表單真正儲存（attachFlush）時才上傳
      return `<div class="attach-item">
        <span style="color:#3182ce;flex-shrink:0;font-size:.85rem;">✎</span>
        ${a.dataUrl ? `<img src="${a.dataUrl}" style="width:26px;height:26px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : `<span>${_attachIcon(a.type)}</span>`}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(_attachLabel(a))}">${escHtml(_attachLabel(a))}</span>
        <span style="font-size:.72rem;color:#3182ce;flex-shrink:0;">待儲存時上傳</span>
        <button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditPending('${escHtml(pid)}',${i})">✏️</button>
        <button type="button" class="attach-del-btn" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
      </div>`;
    }
    return `<div class="attach-item uploading">
      <span class="attach-spinner"></span>
      ${a.type === 'image' && a.dataUrl ? `<img src="${a.dataUrl}" style="width:26px;height:26px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : `<span>${_attachIcon(a.type)}</span>`}
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(_attachLabel(a))}">${escHtml(_attachLabel(a))}</span>
      <span style="font-size:.72rem;color:#2b6cb0;flex-shrink:0;">上傳中…</span>
      <button type="button" class="attach-del-btn" title="取消" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
    </div>`;
  }).join('');

  const addBtn = canAdd
    ? `<button type="button" class="attach-add-btn" onclick="document.getElementById('attachInput_${pid}').click()">＋ 新增附件</button>
       <button type="button" class="attach-add-btn" onclick="_attachEditThenAdd('${escHtml(pid)}',false)" data-tip="先在圖片編輯器編輯圖片，完成後才新增為附件（編輯階段不會上傳原圖）">🖌️ 編輯後新增</button>` : '';

  wrap.innerHTML = `
    <div style="font-size:.82rem;color:#4a5568;margin-bottom:5px;font-weight:500;">
      附件 <span style="font-weight:400;color:#718096;cursor:help;" data-tip="最多15張圖片，或最多3個附件（PDF/Word）；兩者混合時，1個附件＝5張圖片的額度，合計上限15額度。支援拖曳或 Ctrl+V 貼上。已用 ${slots}/15 額度。">（已用 ${slots}/15 額度・支援拖曳/貼上 ⓘ）</span>
    </div>
    ${exHtml}${penHtml}${addBtn}
    <input type="file" id="attachInput_${pid}" style="display:none"
      accept="image/*,.pdf,.doc,.docx,.docm"
      onchange="attachHandleInput('${escHtml(pid)}',this)">`;
}

function attachRemoveExisting(pid, idx) {
  const s = _attachState.get(pid);
  if (!s || !s.existing[idx]) return;
  s.existing.splice(idx, 1);
  attachRender(pid);
}

function attachRemovePending(pid, idx) {
  const s = _attachState.get(pid);
  if (!s) return;
  s.pending.splice(idx, 1);
  attachRender(pid);
}

async function attachHandleInput(pid, input) {
  const _s0 = _attachState.get(pid);
  if (_s0?.imagesOnly) {
    const files = [...(input.files || [])]; input.value = '';
    for (const file of files) {
      if (!_attachState.get(pid) || _attachTotal(pid) >= 15) break;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (file.type.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
        await _attachAddRecImg(pid, file);
      } else { showToast('附圖僅支援圖片格式', 'warning'); }
    }
    return;
  }
  const files = [...(input.files || [])];
  input.value = '';
  for (const file of files) {
    const s = _attachState.get(pid);
    if (!s) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImg = file.type.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp'].includes(ext);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    const isWord = ['doc','docx','docm'].includes(ext) || (file.type||'').includes('wordprocessingml') || file.type === 'application/msword';
    const slotCost = isImg ? 1 : 5;
    const usedSlots = _attachSlots(pid);
    if (usedSlots + slotCost > 15) {
      const rem = 15 - usedSlots;
      if (isImg) showToast('圖片額度已用完（15張上限）', 'warning');
      else showToast(`附件需佔 5 個額度，目前剩餘 ${rem} 個`, 'warning');
      return;
    }
    if (isImg) { await _attachAddImage(pid, file); }
    else if (isPdf) { await _attachAddPdf(pid, file); }
    else if (isWord) {
      // v212：Office 家族附件先偵測是否密碼加密，加密則詢問解鎖／原樣上傳／取消（見
      // _attachMaybeUnlockOfficeFile）；取消時略過本檔繼續處理下一檔，不中斷整批。
      const resolved = await _attachMaybeUnlockOfficeFile(file);
      if (!resolved) continue;
      if (resolved.size > 5 * 1024 * 1024) { alert(`Word 檔案「${resolved.name}」超過 5MB 限制`); return; }
      _attachAddWord(pid, resolved);
    } else {
      alert(`不支援的檔案類型：${file.name}\n支援：圖片、PDF、Word (.doc/.docx)`);
    }
  }
}

async function _attachAddImage(pid, file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', 0.85);
        const b64 = dataUrl.split(',')[1];
        const bArr = atob(b64); const arr = new Uint8Array(bArr.length);
        for (let i = 0; i < bArr.length; i++) arr[i] = bArr.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const s = _attachState.get(pid);
        if (s) {
          const item = { type:'image', fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType:'image/jpeg', blob, dataUrl, uploadStatus:'uploading' };
          s.pending.push(item);
          attachRender(pid);
          _startUpload(pid, item);
        }
        resolve();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function _attachAddRecImg(pid, file) {
  const s = _attachState.get(pid);
  const MAX = s?.imgMaxPx || 1024;
  const QUALITY = s?.imgQuality || 0.7;
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', QUALITY);
        const b64 = dataUrl.split(',')[1];
        const bArr = atob(b64); const arr = new Uint8Array(bArr.length);
        for (let i = 0; i < bArr.length; i++) arr[i] = bArr.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const s2 = _attachState.get(pid);
        if (s2) {
          const item = { type:'image', fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType:'image/jpeg', blob, dataUrl, uploadStatus:'uploading' };
          s2.pending.push(item);
          attachRender(pid);
          _startUpload(pid, item);
        }
        resolve();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _attachRenderImages(pid, s) {
  const wrap = document.getElementById('attachPicker_' + pid);
  if (!wrap) return;
  const total = _attachTotal(pid), canAdd = total < 15;

  const exHtml = s.existing.map((a, i) => `
    <div class="attach-item existing">
      <span style="color:#276749;flex-shrink:0;font-size:.85rem;">✓</span>
      <span>🖼️</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem;" title="${escHtml(a.fileName||'')}">${escHtml(a.fileName||'圖片')}</span>
      <button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditExisting('${escHtml(pid)}',${i})">✏️</button>
      <button type="button" class="attach-del-btn" onclick="attachRemoveExisting('${escHtml(pid)}',${i})">×</button>
    </div>`).join('');

  const penHtml = s.pending.map((a, i) => {
    if (a.uploadStatus === 'error') {
      return `<div class="attach-item upload-error">
        <span style="color:#c53030;flex-shrink:0;font-size:.85rem;">✗</span>
        ${a.dataUrl ? `<img src="${a.dataUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : '<span>🖼️</span>'}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.fileName||'')}</span>
        <span style="font-size:.72rem;color:#c53030;flex-shrink:0;">上傳失敗</span>
        <button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditPending('${escHtml(pid)}',${i})">✏️</button>
        <button type="button" class="attach-del-btn" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
      </div>`;
    }
    if (a.uploadStatus === 'local') {
      return `<div class="attach-item">
        <span style="color:#3182ce;flex-shrink:0;font-size:.85rem;">✎</span>
        ${a.dataUrl ? `<img src="${a.dataUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : '<span>🖼️</span>'}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.fileName||'')}</span>
        <span style="font-size:.72rem;color:#3182ce;flex-shrink:0;">待儲存時上傳</span>
        <button type="button" class="attach-del-btn" title="編輯" onclick="_attachEditPending('${escHtml(pid)}',${i})">✏️</button>
        <button type="button" class="attach-del-btn" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
      </div>`;
    }
    return `<div class="attach-item uploading">
      <span class="attach-spinner"></span>
      ${a.dataUrl ? `<img src="${a.dataUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : '<span>🖼️</span>'}
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(a.fileName||'')}</span>
      <span style="font-size:.72rem;color:#2b6cb0;flex-shrink:0;">上傳中…</span>
      <button type="button" class="attach-del-btn" onclick="attachRemovePending('${escHtml(pid)}',${i})">×</button>
    </div>`;
  }).join('');

  const addBtn = canAdd
    ? `<button type="button" class="attach-add-btn" onclick="document.getElementById('attachInput_${pid}').click()">＋ 新增附圖</button>
       <button type="button" class="attach-add-btn" onclick="_attachEditThenAdd('${escHtml(pid)}',true)" data-tip="先在圖片編輯器編輯圖片，完成後才新增為附圖（編輯階段不會上傳原圖）">🖌️ 編輯後新增</button>` : '';

  wrap.innerHTML = `
    <div style="font-size:.82rem;color:#4a5568;margin-bottom:5px;font-weight:500;">
      附圖 <span style="font-weight:400;color:#718096;cursor:help;" data-tip="最多15張，壓縮後上傳至 Drive。支援拖曳或 Ctrl+V 貼上。">（${total}/15 張・支援拖曳/貼上 ⓘ）</span>
    </div>
    ${exHtml}${penHtml}${addBtn}
    <input type="file" id="attachInput_${pid}" style="display:none" accept="image/*" multiple
      onchange="attachHandleInput('${escHtml(pid)}',this)">`;
}

async function _downloadRecImg(fileId) {
  if (_recImgCache.has(fileId)) return _recImgCache.get(fileId);
  const r = await proxyCall('downloadFileBase64', { fileId }, true);
  const dataUrl = `data:${r.mimeType};base64,${r.base64}`;
  _recImgCache.set(fileId, dataUrl);
  return dataUrl;
}

async function _loadRecordImages(rid) {
  const rec = casesData.flatMap(c => c.records || []).find(r => r.id === rid);
  if (!rec) return;
  const container = document.getElementById('rec-img-view-' + rid);
  if (!container) return;

  const items = [];
  if (rec.image) items.push({ kind: 'base64', data: rec.image, name: '附圖' });
  for (const img of (rec.summaryImages || [])) items.push({ kind: 'drive', ...img });
  if (!items.length) { container.style.display = 'none'; return; }

  container.style.display = 'flex';
  container.innerHTML = items.map((item, i) =>
    item.kind === 'base64'
      ? `<img src="${escHtml(item.data)}" style="max-height:180px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;" onclick="_recImgFullview('${escHtml(item.data)}','附圖')" />`
      : `<div id="rec-img-slot-${rid}-${i}" style="width:100px;height:75px;border-radius:6px;border:1px solid #e2e8f0;background:#f7fafc;display:flex;align-items:center;justify-content:center;"><span style="font-size:.72rem;color:#a0aec0;">載入中…</span></div>`
  ).join('');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'drive') continue;
    const slot = document.getElementById(`rec-img-slot-${rid}-${i}`);
    if (!slot) continue;
    try {
      const dataUrl = await _downloadRecImg(item.fileId);
      const safe = escHtml(dataUrl); const safeName = escHtml(item.fileName || '附圖');
      slot.outerHTML = `<img src="${safe}" style="max-height:180px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;" onclick="_recImgFullview('${safe}','${safeName}')" />`;
    } catch(e) {
      const slot2 = document.getElementById(`rec-img-slot-${rid}-${i}`);
      if (slot2) slot2.innerHTML = `<span style="font-size:.72rem;color:#c53030;">圖片載入失敗</span>`;
    }
  }
}

function _recImgFullview(dataUrl, fileName) {
  _attachShowImageModal(dataUrl, fileName || '附圖');
}

async function _attachAddPdf(pid, file) {
  if (!window.pdfjsLib) {
    showLoading('載入 PDF 解析套件…');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = res; s.onerror = () => rej(new Error('無法載入 PDF 解析套件'));
      document.head.appendChild(s);
    });
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    hideLoading();
  }
  showLoading('解析 PDF 頁面…');
  try {
    const buf = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    const numPages = pdfDoc.numPages;
    hideLoading();

    const s = _attachState.get(pid);
    if (!s) return;
    const availSlots = Math.floor((15 - _attachSlots(pid)) / 5);

    if (numPages === 1) {
      showLoading('轉換第 1 頁…');
      const pages = await _pdfRenderPages(pdfDoc, [1]);
      hideLoading();
      const item = { type:'pdf_pages', fileName: file.name, mimeType:'image/jpeg', pages, pageRange:'1', uploadStatus:'uploading' };
      s.pending.push(item);
      attachRender(pid);
      _startUpload(pid, item);
      return;
    }

    showLoading('渲染頁面縮圖…');
    const allPageNums = Array.from({ length: numPages }, (_, i) => i + 1);
    const allPages = await _pdfRenderPages(pdfDoc, allPageNums);
    hideLoading();

    const selected = await _showPdfPageSelector(file.name, allPages, availSlots);
    if (!selected || !selected.length) return;

    for (let i = 0; i < selected.length; i += 5) {
      const chunk = selected.slice(i, i + 5);
      const s2 = _attachState.get(pid);
      if (!s2 || _attachSlots(pid) + 5 > 15) break;
      const pr1 = chunk[0].pageNum, pr2 = chunk[chunk.length - 1].pageNum;
      const item = {
        type: 'pdf_pages', fileName: file.name, mimeType: 'image/jpeg',
        pages: chunk, pageRange: pr1 === pr2 ? String(pr1) : `${pr1}-${pr2}`,
        uploadStatus: 'uploading'
      };
      s2.pending.push(item);
      _startUpload(pid, item);
    }
    attachRender(pid);
  } catch(e) { hideLoading(); alert('PDF 解析失敗：' + e.message); }
}

async function _pdfRenderPages(pdfDoc, pageNums) {
  const result = [];
  for (let i = 0; i < pageNums.length; i++) {
    const pageNum = pageNums[i];
    if (pageNums.length > 1) showLoading(`轉換頁面 ${i + 1} / ${pageNums.length}…`);
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1.5 });
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const dataUrl = cv.toDataURL('image/jpeg', 0.82);
    const b64 = dataUrl.split(',')[1];
    const bArr = atob(b64); const arr = new Uint8Array(bArr.length);
    for (let j = 0; j < bArr.length; j++) arr[j] = bArr.charCodeAt(j);
    result.push({ pageNum, dataUrl, blob: new Blob([arr], { type:'image/jpeg' }) });
  }
  return result;
}

function _showPdfPageSelector(fileName, allPages, availSlots) {
  return new Promise(resolve => {
    const maxPgs = Math.min(availSlots * 5, allPages.length);
    let selected = allPages.slice(0, maxPgs).map((_, i) => i);
    let _pdfLastClick = -1; // Shift 範圍選取：上次點擊的頁面索引（見全站批次勾選共用 helper）
    let modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.82);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const render = () => {
      const selSet = new Set(selected);
      const slots = Math.ceil(selected.length / 5);
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
            <h3 style="margin:0 0 3px;font-size:.98rem;color:#1a5276;">選擇要上傳的頁面</h3>
            <div style="font-size:.81rem;color:#718096;">${escHtml(fileName)} 共 ${allPages.length} 頁，剩餘 ${availSlots} 個附件槽（每槽最多5頁）</div>
            <div id="pdf-sel-info" style="font-size:.81rem;margin-top:3px;color:${selected.length>maxPgs?'#e53e3e':'#276749'};">
              已選 ${selected.length} 頁 → 將佔用 ${slots} 個附件槽
            </div>
          </div>
          <div style="padding:10px 14px;overflow:auto;flex:1;">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px;">
              ${allPages.map((p, i) => `
                <div onclick="window._pdfToggle(${i},event)" style="cursor:pointer;text-align:center;">
                  <div style="border:2px solid ${selSet.has(i)?'#3182ce':'#e2e8f0'};border-radius:5px;overflow:hidden;background:${selSet.has(i)?'#ebf8ff':'#fff'};">
                    <img src="${p.dataUrl}" style="width:100%;display:block;max-height:110px;object-fit:contain;">
                  </div>
                  <div style="font-size:.75rem;color:${selSet.has(i)?'#3182ce':'#718096'};margin-top:2px;">第${p.pageNum}頁</div>
                </div>`).join('')}
            </div>
          </div>
          <div style="padding:10px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;gap:6px;">
              <button type="button" style="padding:4px 9px;border:1px solid #cbd5e0;border-radius:6px;font-size:.8rem;cursor:pointer;background:#f7fafc;"
                onclick="window._pdfSelAll(${allPages.length},${maxPgs})">全選前${maxPgs}頁</button>
              <button type="button" style="padding:4px 9px;border:1px solid #cbd5e0;border-radius:6px;font-size:.8rem;cursor:pointer;background:#f7fafc;"
                onclick="window._pdfClearAll()">全部取消</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" id="pdf-cancel" style="padding:5px 13px;border:1px solid #cbd5e0;border-radius:6px;font-size:.84rem;cursor:pointer;background:#f7fafc;">取消</button>
              <button type="button" id="pdf-confirm" ${selected.length===0||selected.length>maxPgs?'disabled style="opacity:.45;"':''}
                style="padding:5px 13px;border:none;border-radius:6px;font-size:.84rem;cursor:pointer;background:#3182ce;color:#fff;">確認上傳</button>
            </div>
          </div>
        </div>`;
      // Shift+點擊：對「上次點擊」到本次點擊之間的頁面套用本次點擊後的勾選狀態（範圍計算呼叫
      // 共用純函式 _ckgRangeIndices，見全站批次勾選共用 helper）。單純點擊則維持原本逐頁切換行為。
      window._pdfToggle = (i, evt) => {
        if (evt?.shiftKey && _pdfLastClick >= 0) {
          const target = !selected.includes(i); // 本次點擊後的狀態：原本未選→勾選，原本已選→取消
          const ids = allPages.map((_, idx) => idx);
          _ckgRangeIndices(ids, _pdfLastClick, i).forEach(idx => {
            const pos = selected.indexOf(idx);
            if (target) { if (pos < 0 && selected.length < maxPgs) selected.push(idx); }
            else if (pos >= 0) selected.splice(pos, 1);
          });
        } else {
          const pos = selected.indexOf(i);
          if (pos >= 0) selected.splice(pos, 1);
          else if (selected.length < maxPgs) selected.push(i);
          else { showToast(`最多只能選 ${maxPgs} 頁`, 'warning'); return; }
        }
        selected.sort((a,b) => a-b);
        _pdfLastClick = i;
        render();
      };
      window._pdfSelAll = (total, max) => { selected = Array.from({length:Math.min(total,max)},(_,i)=>i); _pdfLastClick = -1; render(); };
      window._pdfClearAll = () => { selected = []; _pdfLastClick = -1; render(); };
      modal.querySelector('#pdf-cancel').onclick = () => { modal.remove(); resolve(null); };
      modal.querySelector('#pdf-confirm').onclick = () => {
        if (!selected.length) return;
        modal.remove();
        resolve(selected.map(i => allPages[i]));
      };
    };

    render();
    document.body.appendChild(modal);
  });
}

function _attachAddWord(pid, file) {
  const s = _attachState.get(pid);
  if (!s) return;
  const item = { type:'word', fileName:file.name, mimeType:file.type||'application/vnd.openxmlformats-officedocument.wordprocessingml.document', blob:file, uploadStatus:'uploading' };
  s.pending.push(item);
  attachRender(pid);
  _startUpload(pid, item);
}

function _blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function _startUpload(pid, item) {
  const uploadSet = _attachUploadPromises.get(pid);
  const prom = (async () => {
    try {
      const folderId = await _ensureAttachFolder();
      const ts = Date.now().toString(36);
      let uploaded;
      if (item.type === 'image') {
        const b64 = await _blobToBase64(item.blob);
        const r = await proxyCall('uploadFile', { parentFolderId:folderId, fileName:`${ts}_${item.fileName}`, mimeType:item.mimeType, base64Data:b64 });
        uploaded = { type:'image', fileId:r.fileId, fileName:item.fileName, mimeType:item.mimeType };
      } else if (item.type === 'pdf_pages') {
        const pages = [];
        for (const pg of item.pages) {
          const b64 = await _blobToBase64(pg.blob);
          const r = await proxyCall('uploadFile', {
            parentFolderId: folderId,
            fileName: `${ts}_${item.fileName.replace(/\.pdf$/i,'')}_p${pg.pageNum}.jpg`,
            mimeType: 'image/jpeg', base64Data: b64
          });
          pages.push({ fileId:r.fileId, pageNum:pg.pageNum });
        }
        uploaded = { type:'pdf_pages', fileName:item.fileName, mimeType:'image/jpeg', pages, pageRange:item.pageRange };
      } else if (item.type === 'word') {
        const b64 = await _blobToBase64(item.blob);
        const r = await proxyCall('uploadFile', { parentFolderId:folderId, fileName:`${ts}_${item.fileName}`, mimeType:item.mimeType, base64Data:b64 });
        uploaded = { type:'word', fileId:r.fileId, fileName:item.fileName, mimeType:item.mimeType };
      }
      const s = _attachState.get(pid);
      if (s) {
        const idx = s.pending.indexOf(item);
        if (idx >= 0) { s.pending.splice(idx, 1); s.existing.push(uploaded); }
        attachRender(pid);
      }
    } catch(e) {
      item.uploadStatus = 'error';
      item.errorMsg = e.message;
      const s = _attachState.get(pid);
      if (s) attachRender(pid);
    }
  })();
  if (uploadSet) { uploadSet.add(prom); prom.finally(() => uploadSet.delete(prom)); }
}

async function attachFlush(pid) {
  const s = _attachState.get(pid);
  if (!s) return [];
  // v197：圖片編輯器產生的「本機待傳」項目（uploadStatus 'local'，見 _attachEditThenAdd／_attachEditPending／
  // _attachEditExistingSave）到此才真正觸發上傳——呼應「上傳前先編輯」：編輯階段完全不打 API，
  // 只在表單真正儲存時才上傳，一切先前只動 _attachState。
  s.pending.filter(p => p.uploadStatus === 'local').forEach(item => {
    item.uploadStatus = 'uploading';
    _startUpload(pid, item);
  });
  const uploads = _attachUploadPromises.get(pid);
  if (uploads && uploads.size) {
    showLoading('等待附件上傳完成…');
    await Promise.allSettled([...uploads]);
    hideLoading();
  }
  const errors = s.pending.filter(p => p.uploadStatus === 'error');
  if (errors.length) throw new Error(`${errors.length} 個附件上傳失敗：${errors.map(p => p.fileName).join(', ')}`);
  return [...s.existing];
}

// ── v197：附件圖片編輯整合（入口 B）──────────────────────────
// 共用：dataURL → 依附件既有 MAX/QUALITY 慣例重新縮放/壓成 JPEG blob（比照 _attachAddImage／_attachAddRecImg
// 既有的內嵌壓縮邏輯，抽成共用函式供圖片編輯器產生的圖片走同一套尺寸/畫質慣例）。
function _imgEdDataUrlToJpegBlob(dataUrl, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const outUrl = cv.toDataURL('image/jpeg', quality);
      const b64 = outUrl.split(',')[1];
      const bArr = atob(b64); const arr = new Uint8Array(bArr.length);
      for (let i = 0; i < bArr.length; i++) arr[i] = bArr.charCodeAt(i);
      resolve({ dataUrl: outUrl, blob: new Blob([arr], { type: 'image/jpeg' }) });
    };
    img.onerror = () => reject(new Error('圖片轉檔失敗'));
    img.src = dataUrl;
  });
}

// 「編輯後新增」：先選檔→開編輯器，儲存後才加入 pending（uploadStatus 'local'，attachFlush 時才真正上傳）。
// 與一般「＋ 新增附件/附圖」平行存在，不改動既有選檔即自動上傳的路徑（降低既有動線的變動風險）。
function _attachEditThenAdd(pid, imagesOnly) {
  const s = _attachState.get(pid);
  if (!s) return;
  if (_attachTotal(pid) >= 15) { showToast(imagesOnly ? '附圖已達15張上限' : '附件額度已用完（15額度上限）', 'warning'); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      _imgEdOpen({
        dataUrl: e.target.result,
        fileName: file.name,
        sourceLabel: '編輯後新增附件',
        saveActions: [{
          label: '✓ 新增為附件',
          handler: async (dataUrl) => {
            const s2 = _attachState.get(pid);
            if (!s2) { showToast('表單已關閉，無法新增', 'error'); return; }
            if (_attachTotal(pid) >= 15) { showToast('額度已滿，無法新增', 'warning'); return; }
            const { blob } = await _imgEdDataUrlToJpegBlob(dataUrl, s2.imgMaxPx || 1280, s2.imgQuality || 0.85);
            const item = { type: 'image', fileName: (file.name || '圖片').replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', blob, dataUrl, uploadStatus: 'local' };
            s2.pending.push(item);
            attachRender(pid);
            _imgEd.close();
            showToast('已加入附件（表單儲存時才會上傳）', 'success');
          },
        }],
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

// 「pending（尚未上傳）」編輯：只允許 error（上傳失敗，確定仍是純本機資料）與 local（編輯器產生、尚未觸發上傳）
// 兩種狀態；uploadStatus 'uploading' 時不提供編輯（避免與已在飛行中的上傳請求互相覆蓋——那個請求已經
// 讀走舊版 blob，编輯階段再改本機資料也追不回，讓它先跑完，失敗的話再編輯重試更安全）。
function _attachEditPending(pid, idx) {
  const s = _attachState.get(pid);
  const item = s?.pending[idx];
  if (!item || item.type !== 'image') return;
  if (item.uploadStatus === 'uploading') { showToast('上傳中，請稍候完成後再編輯（或先移除重新加入）', 'warning'); return; }
  _attachOpenPendingEditor(pid, idx, item.dataUrl, item.fileName);
}
function _attachOpenPendingEditor(pid, idx, dataUrl, fileName) {
  const item = _attachState.get(pid)?.pending[idx];
  if (!item) return;
  _imgEdOpen({
    dataUrl, fileName, sourceLabel: '編輯附件（尚未上傳）',
    saveActions: [{
      label: '✓ 儲存',
      handler: async (url) => {
        const s2 = _attachState.get(pid);
        const cur = (s2 && s2.pending[idx] === item) ? item : null;
        if (!cur) { showToast('此附件狀態已變更，請重新操作', 'warning'); return; }
        const { blob } = await _imgEdDataUrlToJpegBlob(url, s2.imgMaxPx || 1280, s2.imgQuality || 0.85);
        cur.dataUrl = url; cur.blob = blob; cur.mimeType = 'image/jpeg';
        cur.uploadStatus = 'local'; cur.errorMsg = undefined;
        attachRender(pid);
        _imgEd.close();
        showToast('已更新（表單儲存時才會上傳，不上傳原圖）', 'success');
      },
    }],
  });
}

// 「existing（已上傳有 fileId）」編輯：下載→編輯→取代原檔／另存新附件／下載。
// 取代與另存皆只動 _attachState、產生 uploadStatus 'local' 的新 pending 項，attachFlush 時才真正上傳；
// 取代只換陣列參照（比照既有 attachRemoveExisting 慣例：不呼叫刪除 API，舊檔留在 Drive 但不再被引用）。
async function _attachEditExisting(pid, idx) {
  const s = _attachState.get(pid);
  const a = s?.existing[idx];
  if (!a || a.type !== 'image') return;
  showLoading('載入附件…');
  let dataUrl;
  try {
    const r = await proxyCall('downloadFileBase64', { fileId: a.fileId });
    dataUrl = `data:${r.mimeType};base64,${r.base64}`;
  } catch (e) { hideLoading(); alert('載入失敗：' + e.message); return; }
  hideLoading();
  _attachOpenExistingEditor(pid, idx, dataUrl, a.fileName);
}
function _attachOpenExistingEditor(pid, idx, dataUrl, fileName) {
  _imgEdOpen({
    dataUrl, fileName, sourceLabel: '編輯附件（已上傳）',
    saveActions: [
      { label: '🔁 取代原檔', handler: (url) => _attachEditExistingSave(pid, idx, url, 'replace') },
      { label: '➕ 另存新附件', handler: (url) => _attachEditExistingSave(pid, idx, url, 'saveAs') },
      { label: '⬇ 下載 PNG', format: 'png', handler: (url) => _imgEdDownload(url, fileName, 'png') },
      { label: '⬇ 下載 JPG', format: 'jpeg', handler: (url) => _imgEdDownload(url, fileName, 'jpg') },
    ],
  });
}
async function _attachEditExistingSave(pid, idx, dataUrl, mode) {
  const s = _attachState.get(pid);
  const a = s?.existing[idx];
  if (!s || !a) { showToast('表單狀態已變更，請重新操作', 'warning'); return; }
  if (mode === 'saveAs' && _attachTotal(pid) >= 15) {
    showToast('附件額度已滿，無法另存新附件；請改用「取代原檔」或先下載', 'warning', 4000);
    return;
  }
  const { blob } = await _imgEdDataUrlToJpegBlob(dataUrl, s.imgMaxPx || 1280, s.imgQuality || 0.85);
  const newFileName = _imgEdEditedFileName((a.fileName || '附件.jpg').replace(/\.[^.]+$/, '')) + '.jpg';
  const item = { type: 'image', fileName: newFileName, mimeType: 'image/jpeg', blob, dataUrl, uploadStatus: 'local' };
  if (mode === 'replace') s.existing.splice(idx, 1); // 只換參照，不刪遠端檔（比照既有移除慣例）
  s.pending.push(item);
  attachRender(pid);
  _imgEd.close();
  showToast(mode === 'replace' ? '已標記取代，表單儲存時會上傳新圖並換掉原附件' : '已新增為附件，表單儲存時才會上傳', 'success', 3500);
}

// ── v199：富文字內嵌圖片編輯整合（入口 C）──────────────────────────
// rt-editor（各表單富文字編輯區，如晤談紀錄、結案評估等）內嵌圖片雙擊開圖片編輯器，「套用變更」後
// 就地替換該 <img> 的 src（不新增/刪除節點、不動其他內容），不需另外觸發 dirty/草稿偵測——
// _gd 系列草稿引擎是輪詢比對（每 5 秒重新以 getRichTextValue 讀目前 innerHTML 做快照），直接改
// DOM 即可被下一輪快照感知，比照家系圖既有作法（GenogramEditor 也是直接 img.src/replaceWith，
// 不 dispatch input）。刻意不用 MutationObserver 幫圖片動態掛 data-tip/title 屬性做提示——那類作法
// 會在表單載入完成、_gdSetBaseline 完成快照「之後」才以 microtask 執行，讓草稿基準快照少了這個屬性、
// 之後每輪快照卻多了它，造成使用者尚未編輯就被誤判為「有未儲存變更」；因此可發現性提示改延伸共用的
// 全域 data-tip 懸浮提示邏輯（見全站 _tip_el/mouseover 監聽段），用選擇器涵蓋而非寫入屬性，見該處註解。
// v197 圖片編輯器路線圖原註記「入口 C 排在下一版（v198）」，v198 該號被問題回報遷移用掉，故本入口
// 順延至 v199 完成。
function _rtImgEmbedNeedsRecompress(byteLength) {
  return byteLength > 500 * 1024;
}
function _rtImgEditorOpen(img) {
  if (!img || !img.src) return;
  if (!/^data:/i.test(img.src)) {
    showToast('僅能編輯內嵌圖片，此圖片並非內嵌儲存，無法在此編輯', 'warning', 3000);
    return;
  }
  _imgEdOpen({
    dataUrl: img.src,
    fileName: img.alt || '內嵌圖片',
    sourceLabel: '編輯內嵌圖片',
    saveActions: [{
      label: '✓ 套用變更',
      handler: async (url, meta) => {
        let finalUrl = url;
        // 套用結果若仍偏大（>500KB）且尚未是 JPEG，改壓 JPEG 存回，避免富文字內容（進 JSON 紀錄）暴肥；
        // 沿用附件子系統既有的 dataURL→JPEG 轉檔函式（含等比縮放），長邊上限比附件縮圖（1280）寬鬆，
        // 顧及內嵌圖片可能需要較高可讀解析度。
        if (meta?.format !== 'jpeg' && _rtImgEmbedNeedsRecompress(_imgEdDataUrlByteLength(url))) {
          try {
            const conv = await _imgEdDataUrlToJpegBlob(url, 2000, 0.85);
            finalUrl = conv.dataUrl;
          } catch (e) { /* 轉檔失敗則保留原圖，不阻斷套用 */ }
        }
        img.src = finalUrl;
        _imgEd.close();
        showToast('已套用變更', 'success', 1500);
      },
    }],
  });
}

function renderAttachChips(attachments) {
  if (!attachments || !attachments.length) return '';
  return `<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
    <span style="font-size:.78rem;color:#718096;">附件：</span>
    ${attachments.map(a => `<button type="button" class="attach-chip"
      onclick='viewAttachment(${JSON.stringify(JSON.stringify(a))})'>${_attachIcon(a.type)} ${escHtml(_attachLabel(a))}</button>`).join('')}
  </div>`;
}

async function viewAttachment(jsonStr) {
  const a = JSON.parse(jsonStr);
  if (a.type === 'image') {
    showLoading('載入附件…');
    try {
      const r = await proxyCall('downloadFileBase64', { fileId: a.fileId });
      hideLoading();
      _attachShowImageModal(`data:${r.mimeType};base64,${r.base64}`, a.fileName);
    } catch(e) { hideLoading(); alert('載入失敗：' + e.message); }
  } else if (a.type === 'pdf_pages') {
    showLoading('載入附件…');
    try {
      const pages = [];
      for (const p of a.pages) {
        const r = await proxyCall('downloadFileBase64', { fileId: p.fileId });
        pages.push({ dataUrl: `data:${r.mimeType};base64,${r.base64}`, pageNum: p.pageNum });
      }
      hideLoading();
      _attachShowPdfModal(a.fileName, pages, a.pageRange);
    } catch(e) { hideLoading(); alert('載入失敗：' + e.message); }
  } else if (a.type === 'word') {
    showLoading('下載中…');
    try {
      const r = await proxyCall('downloadFileBase64', { fileId: a.fileId });
      hideLoading();
      const link = document.createElement('a');
      link.href = `data:${r.mimeType};base64,${r.base64}`;
      link.download = a.fileName;
      link.click();
    } catch(e) { hideLoading(); alert('下載失敗：' + e.message); }
  }
}

function _attachShowImageModal(dataUrl, fileName) {
  document.getElementById('attach-view-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'attach-view-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:100001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
  m.innerHTML = `
    <div style="max-width:90vw;display:flex;flex-direction:column;align-items:center;gap:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;">
        <span style="color:#e2e8f0;font-size:.83rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(fileName)}</span>
        <span style="display:flex;gap:6px;flex-shrink:0;">
          <button id="attach-view-edit-btn" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:5px;padding:3px 10px;cursor:pointer;">✏️ 編輯</button>
          <button onclick="document.getElementById('attach-view-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:5px;padding:3px 10px;cursor:pointer;">關閉</button>
        </span>
      </div>
      <img src="${dataUrl}" style="max-width:100%;max-height:80vh;border-radius:6px;object-fit:contain;">
    </div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  // v197：此檢視 modal 多為唯讀詳細頁（已存檔紀錄的附件檢視），編輯只提供下載/複製，不回寫任何紀錄
  // ——避免繞過表單原本的授權與儲存流程；要編輯後存回表單，請由表單附件區的 ✏️ 鈕進入
  // （_attachEditExisting／_attachEditPending，走取代/另存/上傳前編輯的正規流程）。
  const editBtn = document.getElementById('attach-view-edit-btn');
  if (editBtn) editBtn.onclick = () => {
    m.remove();
    _imgEdOpen({
      dataUrl, fileName, sourceLabel: '檢視圖片編輯（僅本機，不會存回紀錄）',
      saveActions: [
        { label: '⬇ 下載 PNG', format: 'png', handler: (url) => _imgEdDownload(url, fileName, 'png') },
        { label: '⬇ 下載 JPG', format: 'jpeg', handler: (url) => _imgEdDownload(url, fileName, 'jpg') },
        { label: '📋 複製到剪貼簿', handler: (url) => _imgEdCopyToClipboard(url) },
      ],
    });
  };
}

function _attachShowPdfModal(fileName, pages, pageRange) {
  document.getElementById('attach-view-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'attach-view-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:100001;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:20px;gap:10px;';
  m.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;width:100%;max-width:700px;flex-shrink:0;">
      <span style="color:#e2e8f0;font-size:.83rem;">${escHtml(fileName)}${pageRange ? ` (第${pageRange}頁)` : ''}</span>
      <button onclick="document.getElementById('attach-view-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:5px;padding:3px 10px;cursor:pointer;">關閉</button>
    </div>
    ${pages.map(p => `<div style="width:100%;max-width:700px;"><div style="color:#a0aec0;font-size:.75rem;margin-bottom:3px;">第 ${p.pageNum} 頁</div><img src="${p.dataUrl}" style="width:100%;border-radius:5px;display:block;"></div>`).join('')}`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
}

// v197 圖片編輯器：另存新附件時的檔名後綴——避免重複編輯疊加「-編輯-編輯」
function _imgEdEditedFileName(name) {
  const src = name || '附件';
  const dot = src.lastIndexOf('.');
  const base = dot > 0 ? src.slice(0, dot) : src;
  const ext = dot > 0 ? src.slice(dot) : '';
  if (base.endsWith('-編輯')) return base + ext;
  return base + '-編輯' + ext;
}

// v197 圖片編輯器：匯出格式決策——估算位元組數 > 2MB 時改用 JPEG（省空間），否則預設 PNG（畫質較佳、支援透明）
function _imgEdExportFormat(byteLength) {
  return byteLength > 2 * 1024 * 1024 ? 'jpeg' : 'png';
}

// v197 圖片編輯器：估算 data URL（base64）還原後的位元組數，供匯出格式決策使用
function _imgEdDataUrlByteLength(dataUrl) {
  if (!dataUrl) return 0;
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}

// ══════════════════════════════════════════════
//  圖片編輯器（Image Editor，v197）—— _imgEd 命名空間
//  以 vendored Fabric.js 5.3.0 為引擎；全螢幕 overlay，z-index 20002（高於附件檢視 modal 20001）。
//  進入點：_imgEdOpen(opts)，opts = { dataUrl?, fileName?, width?, height?,
//    saveActions:[{label, handler(dataUrl,meta), format?}], sourceLabel? }
//  無 dataUrl 時開空白畫布（呼叫端另外指定 width/height，白底）。
//  saveActions 的 format 為本模組相對 spec 的小擴充（可選）：指定 'png'/'jpeg' 強制匯出格式（例如
//  「下載 JPG」按鈕），省略時依 _imgEdExportFormat 依大小自動判斷——向下相容，不影響既有呼叫慣例。
//  v197：編輯器核心＋左側選單獨立工具（入口A）＋附件編輯（入口B）。
//  v199：富文字內嵌圖片編輯（入口C，rt-editor 內雙擊圖片，見附件編輯整合區塊 _rtImgEditorOpen）。
//  視圖縮放（滾輪/適應視窗）改用 CSS transform:scale() 縮放 fabric 的 wrapperEl，完全不動 fabric 內部
//  viewportTransform／zoom——getPointer 會自動依 CSS 縮放比例換算，圖層座標與匯出全程維持文件原始尺寸，
//  故「匯出不受檢視縮放影響」是設計上天然成立，toDataURL 前仍保留 viewportTransform 重設一步作為保險。
// ══════════════════════════════════════════════
window._imgEdActive = false; // 供既有全域貼上處理（v43 附件拖曳/貼上、v195 頭像貼上）判斷早退

const _imgEd = (function() {
  let canvas = null;
  let opts = null;
  let tool = 'select';
  let dirty = false;
  let ready = false;
  let history = [], histPtr = -1;
  let suppressHistory = false;
  let historyTimer = null;
  let cropRect = null, cropDrawing = false;
  let drawingShape = null, drawStart = null, lastDrawPoint = null;
  let spaceDown = false, isPanning = false, panLast = null, panScrollStart = null;
  let layerSeq = 0;
  let zoomLevel = 1;

  const MAX_HISTORY = 30;
  const HISTORY_DEBOUNCE = 250;

  function injectStyle() {
    if (document.getElementById('imged-style')) return;
    const st = document.createElement('style');
    st.id = 'imged-style';
    st.textContent = [
      '#imged-overlay{position:fixed;inset:0;z-index:100002;background:#1a202c;display:flex;flex-direction:column;font-family:inherit;}',
      '#imged-topbar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#2d3748;border-bottom:1px solid #4a5568;flex-wrap:wrap;}',
      '#imged-topbar .imged-title{color:#e2e8f0;font-size:.85rem;font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#imged-toolbar{display:flex;align-items:center;gap:4px;padding:6px 14px;background:#2d3748;border-bottom:1px solid #4a5568;flex-wrap:wrap;}',
      '.imged-btn{background:#4a5568;color:#e2e8f0;border:1px solid #718096;border-radius:6px;padding:5px 10px;font-size:.8rem;cursor:pointer;white-space:nowrap;}',
      '.imged-btn:hover{background:#5a6578;}',
      '.imged-btn.active{background:#3182ce;border-color:#63b3ed;color:#fff;}',
      '.imged-sep{width:1px;align-self:stretch;background:#4a5568;margin:0 4px;}',
      '#imged-options{display:flex;align-items:center;gap:10px;padding:6px 14px;background:#232c3a;border-bottom:1px solid #4a5568;flex-wrap:wrap;font-size:.8rem;color:#cbd5e0;min-height:22px;}',
      '#imged-options label{display:flex;align-items:center;gap:5px;}',
      '#imged-body{flex:1;display:flex;overflow:hidden;min-height:0;}',
      '#imged-canvas-wrap{flex:1;position:relative;overflow:auto;background:#4a5568;display:flex;align-items:center;justify-content:center;}',
      '#imged-layers{width:220px;flex-shrink:0;background:#2d3748;border-left:1px solid #4a5568;overflow-y:auto;padding:8px;}',
      '#imged-layers h4{color:#a0aec0;font-size:.74rem;font-weight:700;margin:2px 0 8px;text-transform:uppercase;letter-spacing:.03em;}',
      '.imged-layer-row{display:flex;align-items:center;gap:5px;padding:5px 6px;border-radius:5px;margin-bottom:3px;cursor:pointer;background:#374151;border:1px solid transparent;}',
      '.imged-layer-row:hover{background:#3f4b5e;}',
      '.imged-layer-row.active{border-color:#63b3ed;background:#2c5282;}',
      '.imged-layer-row .imged-layer-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;color:#e2e8f0;}',
      '.imged-layer-row button{background:none;border:none;color:#a0aec0;cursor:pointer;font-size:.82rem;padding:1px 3px;flex-shrink:0;}',
      '.imged-layer-row button:hover{color:#fff;}',
      '#imged-save-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function buildUI() {
    const ov = document.createElement('div');
    ov.id = 'imged-overlay';
    const saveBtns = (opts.saveActions || []).map((sa, i) =>
      `<button class="imged-btn" style="background:#3182ce;border-color:#63b3ed;" onclick="_imgEd.runSaveAction(${i})">${escHtml(sa.label)}</button>`).join('');
    ov.innerHTML = `
      <div id="imged-topbar">
        <span class="imged-title">${escHtml(opts.sourceLabel || '圖片編輯')}${opts.fileName ? '：' + escHtml(opts.fileName) : ''}</span>
        <div class="imged-sep"></div>
        <button class="imged-btn" onclick="_imgEd.undo()" title="復原（Ctrl+Z）">↩ 復原</button>
        <button class="imged-btn" onclick="_imgEd.redo()" title="重做（Ctrl+Y）">↪ 重做</button>
        <div class="imged-sep"></div>
        <button class="imged-btn" onclick="_imgEd.zoomOut()" title="縮小">－</button>
        <span id="imged-zoom-label" style="color:#cbd5e0;font-size:.78rem;min-width:38px;text-align:center;">100%</span>
        <button class="imged-btn" onclick="_imgEd.zoomIn()" title="放大">＋</button>
        <button class="imged-btn" onclick="_imgEd.zoomFit()" title="適應視窗">⊞ 適應</button>
        <div id="imged-save-actions">
          ${saveBtns}
          <button class="imged-btn" onclick="_imgEd.requestClose()">✕ 關閉</button>
        </div>
      </div>
      <div id="imged-toolbar">
        <button class="imged-btn imged-tool-btn active" data-tool="select" onclick="_imgEd.setTool('select')" title="選取/移動">↖ 選取</button>
        <button class="imged-btn imged-tool-btn" data-tool="pencil" onclick="_imgEd.setTool('pencil')" title="畫筆">🖊 畫筆</button>
        <button class="imged-btn imged-tool-btn" data-tool="highlighter" onclick="_imgEd.setTool('highlighter')" title="螢光筆">🖍 螢光筆</button>
        <button class="imged-btn imged-tool-btn" data-tool="text" onclick="_imgEd.setTool('text')" title="文字註記：點畫布新增">🅰 文字</button>
        <button class="imged-btn imged-tool-btn" data-tool="rect" onclick="_imgEd.setTool('rect')" title="矩形：拖曳繪製">▭ 矩形</button>
        <button class="imged-btn imged-tool-btn" data-tool="ellipse" onclick="_imgEd.setTool('ellipse')" title="橢圓：拖曳繪製">⬭ 橢圓</button>
        <button class="imged-btn imged-tool-btn" data-tool="line" onclick="_imgEd.setTool('line')" title="直線：拖曳繪製">➖ 直線</button>
        <button class="imged-btn imged-tool-btn" data-tool="arrow" onclick="_imgEd.setTool('arrow')" title="箭頭：拖曳繪製">➜ 箭頭</button>
        <button class="imged-btn imged-tool-btn" data-tool="crop" onclick="_imgEd.setTool('crop')" title="裁切：拖出範圍後按「確認裁切」">⛶ 裁切</button>
        <div class="imged-sep"></div>
        <button class="imged-btn" onclick="_imgEd.deleteSelected()" title="刪除所選（Delete鍵）">🗑 刪除</button>
      </div>
      <div id="imged-options"></div>
      <div id="imged-body">
        <div id="imged-canvas-wrap"><canvas id="imged-canvas"></canvas></div>
        <div id="imged-layers">
          <h4>圖層</h4>
          <div id="imged-layers-list"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }

  function initCanvas(w, h) {
    const el = document.getElementById('imged-canvas');
    canvas = new fabric.Canvas(el, { backgroundColor: '#ffffff', preserveObjectStacking: true, selection: true });
    canvas.setWidth(w); canvas.setHeight(h);
    bindCanvasEvents();
  }

  function bindCanvasEvents() {
    canvas.on('object:added', onCanvasChanged);
    canvas.on('object:modified', onCanvasChanged);
    canvas.on('object:removed', onCanvasChanged);
    canvas.on('path:created', () => onCanvasChanged());
    canvas.on('selection:created', renderLayers);
    canvas.on('selection:updated', renderLayers);
    canvas.on('selection:cleared', renderLayers);
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('mouse:wheel', onWheel);
  }

  function onCanvasChanged() {
    renderLayers();
    if (!ready) return;
    scheduleHistoryPush();
  }

  function safeHideRotate(o) { try { o.setControlVisible('mtr', false); } catch (_) {} }

  function open(o) {
    if (document.getElementById('imged-overlay')) { showToast('圖片編輯器已開啟', 'warning', 1500); return; }
    opts = o || {};
    injectStyle();
    buildUI();
    window._imgEdActive = true;
    history = []; histPtr = -1; dirty = false; ready = false; layerSeq = 0; tool = 'select'; zoomLevel = 1;
    cropRect = null; cropDrawing = false; drawingShape = null; drawStart = null; lastDrawPoint = null;

    const finishInit = () => {
      pushHistoryImmediate();
      ready = true;
      fitToView();
      renderLayers();
      renderToolOptions();
    };

    if (opts.dataUrl) {
      const probe = new Image();
      probe.onload = () => {
        const MAXEDGE = 2600;
        const nw = probe.naturalWidth || probe.width, nh = probe.naturalHeight || probe.height;
        const scaleDown = Math.max(nw, nh) > MAXEDGE ? MAXEDGE / Math.max(nw, nh) : 1;
        const cw = Math.max(1, Math.round(nw * scaleDown)), ch = Math.max(1, Math.round(nh * scaleDown));
        initCanvas(cw, ch);
        fabric.Image.fromURL(opts.dataUrl, (fimg) => {
          fimg.set({ left: 0, top: 0 });
          if (scaleDown !== 1) fimg.scale(scaleDown);
          fimg.__imgEdLabel = '圖層' + (++layerSeq);
          safeHideRotate(fimg);
          canvas.add(fimg);
          finishInit();
        }, { crossOrigin: 'anonymous' });
      };
      probe.onerror = () => { initCanvas(opts.width || 1280, opts.height || 720); finishInit(); };
      probe.src = opts.dataUrl;
    } else {
      initCanvas(opts.width || 1280, opts.height || 720);
      finishInit();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste, true);
    setTimeout(() => {
      const wrap = document.getElementById('imged-canvas-wrap');
      if (wrap) { wrap.addEventListener('dragover', onDragOver); wrap.addEventListener('drop', onDrop); }
    }, 0);
  }

  function requestClose() {
    if (dirty) {
      if (!confirm('有未儲存的變更，確定要離開圖片編輯器嗎？離開後變更不會保留。')) return;
    }
    closeInternal();
  }
  function closeForce() { closeInternal(); }
  function closeInternal() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('paste', onPaste, true);
    const wrap = document.getElementById('imged-canvas-wrap');
    if (wrap) { wrap.removeEventListener('dragover', onDragOver); wrap.removeEventListener('drop', onDrop); }
    clearTimeout(historyTimer);
    if (canvas) { try { canvas.dispose(); } catch (_) {} canvas = null; }
    document.getElementById('imged-overlay')?.remove();
    window._imgEdActive = false;
    opts = null; history = []; histPtr = -1; cropRect = null; drawingShape = null; dirty = false;
  }

  // ── 復原/重做 ──
  function snapshotNow() {
    return JSON.stringify({ w: canvas.getWidth(), h: canvas.getHeight(), objs: canvas.toJSON(['__imgEdLabel', '__imgEdShapeName', '__imgEdShapeKind']) });
  }
  function pushHistoryImmediate() {
    if (!canvas) return;
    const snap = snapshotNow();
    if (histPtr >= 0 && history[histPtr] === snap) return;
    history = history.slice(0, histPtr + 1);
    history.push(snap);
    if (history.length > MAX_HISTORY) history.shift();
    histPtr = history.length - 1;
  }
  function scheduleHistoryPush() {
    if (suppressHistory) return;
    dirty = true;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(pushHistoryImmediate, HISTORY_DEBOUNCE);
  }
  function restoreSnapshot(str) {
    const data = JSON.parse(str);
    suppressHistory = true;
    canvas.setWidth(data.w); canvas.setHeight(data.h);
    canvas.loadFromJSON(data.objs, () => {
      canvas.renderAll();
      renderLayers();
      suppressHistory = false;
      dirty = true;
    });
  }
  function undo() { if (histPtr <= 0) return; histPtr--; restoreSnapshot(history[histPtr]); }
  function redo() { if (histPtr >= history.length - 1) return; histPtr++; restoreSnapshot(history[histPtr]); }

  // ── 工具切換 ──
  function setTool(name) {
    if (tool === 'crop' && name !== 'crop') cancelCrop();
    tool = name;
    document.querySelectorAll('.imged-tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
    canvas.isDrawingMode = (name === 'pencil' || name === 'highlighter');
    if (canvas.isDrawingMode) {
      const brush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush = brush;
    }
    const interactive = (name === 'select');
    canvas.selection = interactive;
    canvas.forEachObject(o => { if (!o.__imgEdCropHelper) { o.selectable = interactive; o.evented = interactive; } });
    if (!interactive) canvas.discardActiveObject();
    canvas.defaultCursor = name === 'select' ? 'default' : (name === 'text' ? 'text' : 'crosshair');
    canvas.renderAll();
    renderToolOptions();
  }

  function renderToolOptions() {
    const el = document.getElementById('imged-options');
    if (!el) return;
    if (tool === 'pencil' || tool === 'highlighter') {
      el.innerHTML = `
        <label>顏色 <input type="color" id="imged-brush-color" value="${tool === 'highlighter' ? '#ffff00' : '#e53e3e'}" onchange="_imgEd.applyBrushSettings()"></label>
        <label>粗細 <input type="range" id="imged-brush-width" min="1" max="60" value="${tool === 'highlighter' ? 18 : 4}" oninput="_imgEd.applyBrushSettings()"></label>`;
      applyBrushSettings();
    } else if (tool === 'text') {
      el.innerHTML = `
        <label>顏色 <input type="color" id="imged-text-color" value="#1a202c"></label>
        <label>字級 <input type="number" id="imged-text-size" min="8" max="120" value="24" style="width:56px;"></label>
        <span style="color:#a0aec0;">點畫布新增文字，再點一下可編輯內容</span>`;
    } else if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) {
      el.innerHTML = `
        <label>線色 <input type="color" id="imged-shape-stroke" value="#e53e3e"></label>
        <label>線寬 <input type="range" id="imged-shape-width" min="1" max="30" value="3"></label>
        ${(tool === 'rect' || tool === 'ellipse') ? '<label><input type="checkbox" id="imged-shape-fill"> 填滿（可用實心矩形遮蓋個資）</label>' : ''}
        <span style="color:#a0aec0;">拖曳繪製</span>`;
    } else if (tool === 'crop') {
      if (cropRect && !cropDrawing) {
        el.innerHTML = `<span style="color:#cbd5e0;">已選取裁切範圍</span>
          <button class="imged-btn" style="background:#276749;border-color:#48bb78;" onclick="_imgEd.confirmCrop()">✓ 確認裁切</button>
          <button class="imged-btn" onclick="_imgEd.cancelCrop()">✕ 取消裁切</button>`;
      } else {
        el.innerHTML = `<span style="color:#a0aec0;">拖曳出裁切範圍</span>`;
      }
    } else {
      el.innerHTML = `<span style="color:#a0aec0;">選取物件後可拖曳移動、用控點縮放；Delete 鍵刪除</span>`;
    }
  }
  function applyBrushSettings() {
    if (!canvas.isDrawingMode) return;
    const colorEl = document.getElementById('imged-brush-color');
    const widthEl = document.getElementById('imged-brush-width');
    const brush = canvas.freeDrawingBrush;
    if (!brush) return;
    if (tool === 'highlighter') brush.color = hexToRgba(colorEl?.value || '#ffff00', 0.4);
    else brush.color = colorEl?.value || '#e53e3e';
    brush.width = widthEl ? +widthEl.value : brush.width;
  }
  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return hex;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── 滑鼠事件：選取/移動走 fabric 內建；其餘工具（文字/形狀/裁切/平移）自行處理 ──
  function onMouseDown(e) {
    if (spaceDown || e.e.button === 1) { startPan(e); return; }
    if (tool === 'select') return;
    const p = canvas.getPointer(e.e);
    if (tool === 'text') {
      const size = +(document.getElementById('imged-text-size')?.value || 24);
      const color = document.getElementById('imged-text-color')?.value || '#1a202c';
      const t = new fabric.IText('文字', { left: p.x, top: p.y, fontSize: size, fill: color, fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif' });
      safeHideRotate(t);
      canvas.add(t);
      canvas.setActiveObject(t);
      t.enterEditing();
      t.selectAll();
      setTool('select');
      return;
    }
    if (tool === 'crop') { startCrop(p); return; }
    if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) { startShape(tool, p); return; }
  }
  function onMouseMove(e) {
    if (isPanning) {
      const wrap = document.getElementById('imged-canvas-wrap');
      const dx = e.e.clientX - panLast.x, dy = e.e.clientY - panLast.y;
      wrap.scrollLeft = panScrollStart.left - dx;
      wrap.scrollTop = panScrollStart.top - dy;
      return;
    }
    if (drawingShape && drawStart) { updateShape(canvas.getPointer(e.e)); return; }
    if (cropDrawing && drawStart) { updateCropRect(canvas.getPointer(e.e)); return; }
  }
  function onMouseUp() {
    if (isPanning) {
      isPanning = false;
      canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
      canvas.selection = tool === 'select';
      return;
    }
    if (drawingShape) { finishShape(); return; }
    if (cropDrawing) { finishCropDraw(); return; }
  }
  function onWheel(fEvt) {
    const e = fEvt.e;
    e.preventDefault(); e.stopPropagation();
    setZoom(zoomLevel * (e.deltaY > 0 ? 0.9 : 1.1));
  }
  function startPan(e) {
    isPanning = true;
    panLast = { x: e.e.clientX, y: e.e.clientY };
    const wrap = document.getElementById('imged-canvas-wrap');
    panScrollStart = { left: wrap.scrollLeft, top: wrap.scrollTop };
    canvas.selection = false;
    canvas.defaultCursor = 'grabbing';
  }

  // ── 鍵盤：ESC 取消選取/裁切、Delete 刪除、空白鍵平移、Ctrl+Z/Y 復原重做 ──
  function onKeyDown(e) {
    if (!window._imgEdActive) return;
    const active = canvas?.getActiveObject();
    if (e.code === 'Space' && !spaceDown) {
      if (active && active.isEditing) return;
      spaceDown = true; canvas.defaultCursor = 'grab'; canvas.selection = false; e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (cropDrawing || cropRect) { cancelCrop(); e.preventDefault(); return; }
      if (canvas?.getActiveObject()) { canvas.discardActiveObject(); canvas.renderAll(); e.preventDefault(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (active && active.isEditing) return;
      const tgt = document.activeElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if (!active) return;
      e.preventDefault();
      deleteSelected();
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceDown = false;
      if (!isPanning) { canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair'; canvas.selection = tool === 'select'; }
    }
  }
  function deleteSelected() {
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    canvas.discardActiveObject();
    objs.forEach(o => canvas.remove(o));
    canvas.renderAll();
  }

  // ── 形狀繪製（矩形/橢圓/直線/箭頭；拖曳中即時更新，放開滑鼠定案）──
  function arrowPathD(x1, y1, x2, y2) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.min(16, Math.hypot(x2 - x1, y2 - y1) * 0.6 || 16);
    const a1 = angle - Math.PI / 7, a2 = angle + Math.PI / 7;
    const hx1 = x2 - headLen * Math.cos(a1), hy1 = y2 - headLen * Math.sin(a1);
    const hx2 = x2 - headLen * Math.cos(a2), hy2 = y2 - headLen * Math.sin(a2);
    return `M ${x1} ${y1} L ${x2} ${y2} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`;
  }
  function startShape(kind, p) {
    drawStart = p; lastDrawPoint = p;
    const strokeColor = document.getElementById('imged-shape-stroke')?.value || '#e53e3e';
    const strokeWidth = +(document.getElementById('imged-shape-width')?.value || 3);
    const filled = !!document.getElementById('imged-shape-fill')?.checked;
    const fillColor = filled ? strokeColor : 'transparent';
    const common = { selectable: false, evented: false, strokeUniform: true };
    if (kind === 'rect') drawingShape = new fabric.Rect({ left: p.x, top: p.y, width: 0.01, height: 0.01, stroke: strokeColor, strokeWidth, fill: fillColor, ...common });
    else if (kind === 'ellipse') drawingShape = new fabric.Ellipse({ left: p.x, top: p.y, rx: 0.01, ry: 0.01, stroke: strokeColor, strokeWidth, fill: fillColor, ...common });
    else if (kind === 'line') drawingShape = new fabric.Line([p.x, p.y, p.x, p.y], { stroke: strokeColor, strokeWidth, ...common });
    else if (kind === 'arrow') drawingShape = new fabric.Path(arrowPathD(p.x, p.y, p.x, p.y), { stroke: strokeColor, strokeWidth, fill: '', ...common });
    drawingShape.__imgEdShapeName = { rect: '矩形', ellipse: '橢圓', line: '直線', arrow: '箭頭' }[kind];
    drawingShape.__imgEdShapeKind = kind;
    canvas.add(drawingShape);
  }
  function updateShape(p) {
    if (!drawingShape || !drawStart) return;
    const kind = drawingShape.__imgEdShapeKind;
    if (kind === 'rect') {
      drawingShape.set({ left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y), width: Math.max(1, Math.abs(p.x - drawStart.x)), height: Math.max(1, Math.abs(p.y - drawStart.y)) });
    } else if (kind === 'ellipse') {
      drawingShape.set({ left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y), rx: Math.max(0.5, Math.abs(p.x - drawStart.x) / 2), ry: Math.max(0.5, Math.abs(p.y - drawStart.y) / 2) });
    } else if (kind === 'line') {
      drawingShape.set({ x2: p.x, y2: p.y });
    } else if (kind === 'arrow') {
      const stroke = drawingShape.stroke, strokeWidth = drawingShape.strokeWidth;
      canvas.remove(drawingShape);
      drawingShape = new fabric.Path(arrowPathD(drawStart.x, drawStart.y, p.x, p.y), { stroke, strokeWidth, fill: '', selectable: false, evented: false, strokeUniform: true });
      drawingShape.__imgEdShapeName = '箭頭'; drawingShape.__imgEdShapeKind = 'arrow';
      canvas.add(drawingShape);
    }
    lastDrawPoint = p;
    canvas.renderAll();
  }
  function finishShape() {
    if (drawingShape) {
      const kind = drawingShape.__imgEdShapeKind;
      let tooSmall;
      if (kind === 'line' || kind === 'arrow') {
        const p2 = lastDrawPoint || drawStart;
        tooSmall = Math.hypot(p2.x - drawStart.x, p2.y - drawStart.y) < 4;
      } else {
        tooSmall = (drawingShape.width || 0) < 3 && (drawingShape.height || 0) < 3;
      }
      if (tooSmall) canvas.remove(drawingShape);
      else { drawingShape.set({ evented: false }); safeHideRotate(drawingShape); canvas.renderAll(); }
    }
    drawingShape = null; drawStart = null; lastDrawPoint = null;
    renderLayers();
    scheduleHistoryPush();
  }

  // ── 裁切：拖曳出範圍→確認才真正改變畫布尺寸並平移所有物件對位；取消則還原 ──
  function startCrop(p) {
    if (cropRect) { canvas.remove(cropRect); cropRect = null; }
    drawStart = p; cropDrawing = true;
    cropRect = new fabric.Rect({ left: p.x, top: p.y, width: 0.01, height: 0.01, fill: 'rgba(49,130,206,0.15)', stroke: '#3182ce', strokeDashArray: [6, 4], strokeWidth: 2, selectable: false, evented: false, __imgEdCropHelper: true });
    canvas.add(cropRect);
    canvas.bringToFront(cropRect);
  }
  function updateCropRect(p) {
    if (!cropRect || !drawStart) return;
    cropRect.set({ left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y), width: Math.abs(p.x - drawStart.x), height: Math.abs(p.y - drawStart.y) });
    canvas.renderAll();
  }
  function finishCropDraw() {
    cropDrawing = false; drawStart = null;
    if (!cropRect || cropRect.width < 4 || cropRect.height < 4) {
      if (cropRect) canvas.remove(cropRect);
      cropRect = null;
      canvas.renderAll();
      renderToolOptions();
      return;
    }
    renderToolOptions();
  }
  function confirmCrop() {
    if (!cropRect) return;
    const offX = cropRect.left, offY = cropRect.top;
    const newW = Math.max(1, Math.round(cropRect.width)), newH = Math.max(1, Math.round(cropRect.height));
    canvas.remove(cropRect);
    cropRect = null;
    canvas.getObjects().forEach(o => { o.set({ left: o.left - offX, top: o.top - offY }); o.setCoords(); });
    canvas.setWidth(newW); canvas.setHeight(newH);
    canvas.renderAll();
    fitToView();
    renderLayers();
    renderToolOptions();
    scheduleHistoryPush();
    showToast('已裁切', 'success', 1500);
  }
  function cancelCrop() {
    if (cropRect) { canvas.remove(cropRect); cropRect = null; }
    cropDrawing = false; drawStart = null;
    if (canvas) canvas.renderAll();
    renderToolOptions();
  }

  // ── 圖層面板 ──
  function getContentObjects() { return canvas ? canvas.getObjects().filter(o => !o.__imgEdCropHelper) : []; }
  function labelFor(o) {
    if (o.type === 'image') return o.__imgEdLabel || '圖層';
    if (o.type === 'i-text' || o.type === 'text') {
      const t = (o.text || '').replace(/\s+/g, ' ').trim();
      return t ? (t.length > 12 ? t.slice(0, 12) + '…' : t) : '（空白文字）';
    }
    return o.__imgEdShapeName || '物件';
  }
  function iconFor(o) {
    if (o.type === 'image') return '🖼️';
    if (o.type === 'i-text' || o.type === 'text') return '🅰️';
    if (o.__imgEdShapeName === '矩形') return '▭';
    if (o.__imgEdShapeName === '橢圓') return '⬭';
    if (o.__imgEdShapeName === '直線') return '➖';
    if (o.__imgEdShapeName === '箭頭') return '➜';
    if (o.type === 'path') return '✏️';
    return '⬛';
  }
  function contentAt(idx) { return getContentObjects()[idx]; }
  function renderLayers() {
    const el = document.getElementById('imged-layers-list');
    if (!el || !canvas) return;
    const objs = getContentObjects().slice().reverse();
    const active = canvas.getActiveObject();
    el.innerHTML = objs.map((o, i) => {
      const idx = objs.length - 1 - i;
      const isActive = active === o || (active && active._objects && active._objects.includes(o));
      return `<div class="imged-layer-row${isActive ? ' active' : ''}" onclick="_imgEd.layerClick(${idx})">
        <span>${iconFor(o)}</span>
        <span class="imged-layer-name">${escHtml(labelFor(o))}</span>
        <button onclick="event.stopPropagation();_imgEd.layerMove(${idx},1)" title="上移">↑</button>
        <button onclick="event.stopPropagation();_imgEd.layerMove(${idx},-1)" title="下移">↓</button>
        <button onclick="event.stopPropagation();_imgEd.layerToggle(${idx})" title="顯示/隱藏">${o.visible === false ? '🚫' : '👁'}</button>
        <button onclick="event.stopPropagation();_imgEd.layerDelete(${idx})" title="刪除">🗑</button>
      </div>`;
    }).join('') || '<div style="color:#718096;font-size:.78rem;padding:8px 4px;">（尚無圖層）</div>';
  }
  function layerClick(idx) {
    const o = contentAt(idx); if (!o) return;
    if (tool !== 'select') setTool('select');
    canvas.setActiveObject(o);
    canvas.renderAll();
    renderLayers();
  }
  function layerMove(idx, dir) {
    const o = contentAt(idx); if (!o) return;
    if (dir > 0) canvas.bringForward(o); else canvas.sendBackwards(o);
    canvas.renderAll();
    renderLayers();
    scheduleHistoryPush();
  }
  function layerToggle(idx) {
    const o = contentAt(idx); if (!o) return;
    o.visible = !o.visible;
    canvas.renderAll();
    renderLayers();
    scheduleHistoryPush();
  }
  function layerDelete(idx) {
    const o = contentAt(idx); if (!o) return;
    canvas.remove(o);
    canvas.renderAll();
  }

  // ── 貼上 / 拖曳圖片＝新增圖層 ──
  function onPaste(e) {
    if (!window._imgEdActive) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        addImageFile(it.getAsFile());
        return;
      }
    }
  }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type && file.type.startsWith('image/')) addImageFile(file);
  }
  function addImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => addImageDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  }
  function addImageDataUrl(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
      const maxW = canvas.getWidth() * 0.8, maxH = canvas.getHeight() * 0.8;
      let scale = 1;
      if (img.width > maxW || img.height > maxH) scale = Math.min(maxW / img.width, maxH / img.height);
      img.scale(scale);
      img.set({ left: (canvas.getWidth() - img.getScaledWidth()) / 2, top: (canvas.getHeight() - img.getScaledHeight()) / 2 });
      img.__imgEdLabel = '圖層' + (++layerSeq);
      safeHideRotate(img);
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      setTool('select');
    }, { crossOrigin: 'anonymous' });
  }

  // ── 檢視縮放（CSS transform，不動 fabric 內部座標系）──
  function applyZoomCss() {
    const wrapper = canvas?.wrapperEl;
    if (!wrapper) return;
    wrapper.style.transform = `scale(${zoomLevel})`;
    wrapper.style.transformOrigin = 'top left';
    const lbl = document.getElementById('imged-zoom-label');
    if (lbl) lbl.textContent = Math.round(zoomLevel * 100) + '%';
    canvas?.calcOffset && canvas.calcOffset();
  }
  function setZoom(z) { zoomLevel = Math.max(0.1, Math.min(4, z)); applyZoomCss(); }
  function zoomIn() { setZoom(zoomLevel * 1.2); }
  function zoomOut() { setZoom(zoomLevel / 1.2); }
  function fitToView() {
    const wrap = document.getElementById('imged-canvas-wrap');
    if (!wrap || !canvas) return;
    const pad = 32;
    const z = Math.min((wrap.clientWidth - pad) / canvas.getWidth(), (wrap.clientHeight - pad) / canvas.getHeight(), 2);
    setZoom(z > 0 && isFinite(z) ? z : 1);
  }

  // ── 匯出（供 saveActions 使用）：暫時重設 viewportTransform，確保不受檢視縮放影響 ──
  function exportDataUrl(forceFormat) {
    const vt = canvas.viewportTransform.slice();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    let format = forceFormat, url;
    if (format === 'jpeg') {
      url = canvas.toDataURL({ format: 'jpeg', quality: 0.9 });
    } else if (format === 'png') {
      url = canvas.toDataURL({ format: 'png' });
    } else {
      const pngUrl = canvas.toDataURL({ format: 'png' });
      const bytes = _imgEdDataUrlByteLength(pngUrl);
      format = _imgEdExportFormat(bytes);
      if (format === 'jpeg') { url = canvas.toDataURL({ format: 'jpeg', quality: 0.9 }); showToast('圖片較大，已自動改用 JPEG 格式匯出', 'warning', 2500); }
      else url = pngUrl;
    }
    canvas.setViewportTransform(vt);
    canvas.renderAll();
    return { dataUrl: url, format };
  }
  function runSaveAction(i) {
    const sa = (opts?.saveActions || [])[i];
    if (!sa || !canvas) return;
    const { dataUrl, format } = exportDataUrl(sa.format);
    try { sa.handler(dataUrl, { fileName: opts.fileName, width: canvas.getWidth(), height: canvas.getHeight(), format }); }
    catch (e) { console.error(e); showToast('儲存動作發生錯誤：' + e.message, 'error'); }
  }

  return {
    open, requestClose, close: closeForce, undo, redo, setTool, applyBrushSettings,
    zoomIn, zoomOut, zoomFit: fitToView, confirmCrop, cancelCrop, deleteSelected,
    layerClick, layerMove, layerToggle, layerDelete, runSaveAction,
  };
})();

function _imgEdOpen(o) { _imgEd.open(o); }

// 此頁面（未開啟編輯器時）按 Ctrl+V 直接貼上剪貼簿圖片開始編輯（比照 v195 頭像貼上的判斷慣例）
document.addEventListener('paste', (e) => {
  if (window._imgEdActive) return;
  const pageActive = document.getElementById('page-img-editor')?.classList.contains('active');
  if (!pageActive) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      e.preventDefault();
      const file = it.getAsFile();
      const reader = new FileReader();
      reader.onload = (ev) => _imgEdOpenStandalone(ev.target.result, file.name || '貼上的圖片');
      reader.readAsDataURL(file);
      return;
    }
  }
});

// ── 入口 A：左側選單「圖片編輯」頁 ──
function renderImgEditorPage() {
  // 靜態頁面，不需動態渲染；此函式存在是配合既有 nav onclick 慣例
}
function _imgEdDownload(dataUrl, fileName, ext) {
  const base = (fileName || '圖片').replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${base}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  showToast('已下載', 'success', 1500);
}
async function _imgEdCopyToClipboard(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast('已複製到剪貼簿', 'success', 1500);
  } catch (e) {
    showToast('複製失敗（瀏覽器可能不支援剪貼簿圖片功能），請改用下載', 'warning', 3500);
  }
}
function _imgEdOpenStandalone(dataUrl, fileName, w, h) {
  _imgEdOpen({
    dataUrl: dataUrl || undefined,
    width: w, height: h,
    fileName,
    sourceLabel: '圖片編輯',
    saveActions: [
      { label: '⬇ 下載 PNG', format: 'png', handler: (url) => _imgEdDownload(url, fileName, 'png') },
      { label: '⬇ 下載 JPG', format: 'jpeg', handler: (url) => _imgEdDownload(url, fileName, 'jpg') },
      { label: '📋 複製到剪貼簿', handler: (url) => _imgEdCopyToClipboard(url) },
    ],
  });
}
function _imgEdPageFileSelected(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) { alert('請選擇圖片檔案'); return; }
  const reader = new FileReader();
  reader.onload = (e) => _imgEdOpenStandalone(e.target.result, file.name);
  reader.readAsDataURL(file);
}
function _imgEdPageNewCanvas() {
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100003;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,.22);">
      <div style="font-weight:700;font-size:1rem;color:#2b6cb0;margin-bottom:14px;">新建空白畫布</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        <button class="btn btn-secondary" onclick="_imgEdNewCanvasConfirm(1280,720)">1280 × 720（16:9）</button>
        <button class="btn btn-secondary" onclick="_imgEdNewCanvasConfirm(1920,1080)">1920 × 1080（16:9 全高清）</button>
      </div>
      <div style="font-size:.82rem;color:#4a5568;margin-bottom:6px;">自訂尺寸：</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:16px;">
        <input type="number" id="imged-nc-w" value="1000" min="50" max="4000" class="field-input" style="width:80px;">
        <span>×</span>
        <input type="number" id="imged-nc-h" value="800" min="50" max="4000" class="field-input" style="width:80px;">
        <button class="btn btn-primary btn-sm" onclick="_imgEdNewCanvasCustom()">建立</button>
      </div>
      <div style="text-align:right;"><button class="btn btn-secondary btn-sm" onclick="window._imgEdNcModal?.remove()">取消</button></div>
    </div>`;
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  window._imgEdNcModal = m;
}
function _imgEdNewCanvasConfirm(w, h) {
  window._imgEdNcModal?.remove();
  _imgEdOpenStandalone(null, '未命名畫布', w, h);
}
function _imgEdNewCanvasCustom() {
  const w = Math.max(50, Math.min(4000, +document.getElementById('imged-nc-w').value || 1000));
  const h = Math.max(50, Math.min(4000, +document.getElementById('imged-nc-h').value || 800));
  window._imgEdNcModal?.remove();
  _imgEdOpenStandalone(null, '未命名畫布', w, h);
}

