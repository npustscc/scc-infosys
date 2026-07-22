// dev/sms.js — 簡訊發送（三竹 Mitake／Every8D）模組（拆 index.html 絞殺者第十七刀之一，v263）。
// 沿用 v261/v262 刀法「inline script 區塊原地外部化」：原 index.html 內這一整段獨立的
// <script>…</script>（無 src、無 document.currentScript 依賴，已逐行複核確認）被整段原樣搬出，
// 原位置換成 <script src="sms.js"></script>，標籤所在順序完全不變，因此載入與執行時機與
// 搬移前逐位元組一致——本檔頂層狀態一律照搬：
//   let _sms（簡訊發送頁主狀態物件：目前供應商/收件人清單/排程等）
// 本檔無其他頂層 let/const、無頂層副作用（document/window 事件掛載），純粹一組函式集合。
// 帳密僅存於伺服器 .env，前端只傳收訊人/內容，永不經手帳密。
// 本區塊在 index.html 中的原始位置緊接在 openmail.js 之後、新生心理測驗 UI 模組（ft-ui.js）之前，
// 拆出後仍以同一位置的 <script src> 載入，執行順序不受影響。
// ══════════════════════════════════════════════
//  簡訊發送（v203）：三竹（Mitake）／Every8D，_sms 命名空間
//  帳密僅存於伺服器 .env，前端只傳收訊人/內容，永不經手帳密。
// ══════════════════════════════════════════════

// ── 純函式：GSM 字集判斷與則數估算（供 test/sms-segment.test.js 抽測，自成一體不依賴外部全域）──
// GSM 03.38 基本字元集（未含擴充字元）。內容全落在此集合內才算「英數簡訊」（160/153 字上限），
// 否則視為含中文等字元的「中文簡訊」（70/67 字上限）。
function _smsIsGsmMessage(text) {
  const basic = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const ext = "^{}\\[~]|";
  for (const ch of String(text || '')) {
    if (basic.indexOf(ch) === -1 && ext.indexOf(ch) === -1) return false;
  }
  return true;
}

// 依內容估算「字數」與「預估則數」。GSM 擴充字元（^ { } \ [ ~ ] |）每個佔 2 字額度。
// 英數簡訊：≤160 字 1 則，超過則每 153 字 1 則；中文等：≤70 字 1 則，超過則每 67 字 1 則。
function _smsSegmentInfo(text) {
  text = String(text || '');
  const isGsm = _smsIsGsmMessage(text);
  const ext = "^{}\\[~]|";
  const chars = Array.from(text); // 以 code point 為單位計數，避免中文/emoji 被 UTF-16 surrogate pair 誤算兩次
  let len = 0;
  if (isGsm) { for (const ch of chars) len += ext.indexOf(ch) !== -1 ? 2 : 1; }
  else { len = chars.length; }
  const singleCap = isGsm ? 160 : 70;
  const multiCap = isGsm ? 153 : 67;
  const segments = len === 0 ? 0 : (len <= singleCap ? 1 : Math.ceil(len / multiCap));
  return { isGsm, len, segments };
}

// 驗證/正規化手機號碼：09 開頭 10 碼，或 +886 開頭之國際格式；不符合回傳 null。
function _smsValidatePhone(raw) {
  const v = String(raw || '').trim();
  if (/^09\d{8}$/.test(v)) return v;
  if (/^\+8869\d{8}$/.test(v)) return v;
  return null;
}

// datetime-local 輸入值（YYYY-MM-DDTHH:MM，瀏覽器本機時間視同台北時間）轉後端要求的 14 碼格式。
function _smsFormatScheduledAt(dtLocalValue) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(dtLocalValue || '').trim());
  if (!m) return '';
  const y = m[1], mo = m[2], d = m[3], h = m[4], mi = m[5], s = m[6] || '00';
  return `${y}${mo}${d}${h}${mi}${s}`;
}

// 三竹／Every8D 狀態碼 → 繁中顯示文字（未列出的碼原樣顯示）。
function _smsStatusText(provider, code) {
  const mitakeMap = {
    '0': '預約中', '1': '已送達業者', '2': '已送達業者', '3': '已送達業者',
    '4': '已送達手機', '5': '內容錯誤', '6': '門號錯誤', '7': '已停用',
    '8': '逾時未送達', '9': '已取消',
  };
  const every8dMap = {
    '0': '已達電信端', '100': '已送達手機', '101': '關機或訊號不良', '102': '電信端異常',
    '103': '空號', '104': '黑名單', '105': '關鍵字阻擋', '106': '關鍵字阻擋',
    '300': '預約中', '301': '額度不足', '303': '已取消', '700': '已傳送',
  };
  const map = provider === 'every8d' ? every8dMap : mitakeMap;
  const key = code == null ? '' : String(code);
  return map[key] || key || '—';
}

// 發送紀錄整批狀態 → 繁中文字／badge 樣式（沿用既有 .badge-* class）。
function _smsLogStatusMeta(status) {
  const map = {
    sent:      { text: '已送出', badge: 'badge-green' },
    scheduled: { text: '預約中', badge: 'badge-blue' },
    canceled:  { text: '已取消', badge: 'badge-gray' },
    failed:    { text: '失敗',   badge: 'badge-orange' },
  };
  return map[status] || { text: status || '—', badge: 'badge-gray' };
}

// 業務錯誤碼 → 友善繁中訊息；detail 有值時附加在後面（比照 om 頁 _omErrMsg 的作法）。
function _smsErrMsg(code, detail) {
  const map = {
    sms_not_configured:    '此簡訊平台尚未設定，請聯絡系統管理者於伺服器完成設定',
    sms_invalid_phone:     '收訊人手機號碼格式錯誤',
    sms_empty_message:     '簡訊內容不可為空',
    sms_message_too_long:  '簡訊內容過長',
    sms_schedule_too_soon: '預約發送時間太接近現在，請至少設定在 11 分鐘以後',
    sms_schedule_invalid:  '預約發送時間格式錯誤',
    sms_provider_error:    '簡訊平台回應錯誤',
    sms_not_scheduled:     '此筆紀錄非預約發送狀態，無法取消',
    sms_cancel_failed:     '取消預約失敗，請稍後再試',
    sms_log_not_found:     '找不到這筆發送紀錄',
  };
  const base = map[code] || code || '發生未知錯誤';
  return detail ? `${base}：${detail}` : base;
}

// ── 頁面狀態 ──
let _sms = {
  status: null,               // smsStatus 回傳的 { providers: {...} }
  provider: null,             // 'mitake' | 'every8d'
  balance: {},                 // { mitake: number|null, every8d: number|null }
  balanceLoading: false,
  recipients: [],             // [{ phone, name, caseId }]
  sending: false,
  _pendingSend: null,         // 確認對話框待送出內容：{ message, scheduledAt }
  tab: 'send',
  log: { items: [], total: 0, page: 1, pageSize: 20, expanded: new Set(), loading: false },
};

async function renderSmsPage() {
  try {
    _sms.status = await proxyCall('smsStatus');
  } catch (e) {
    _sms.status = { providers: { mitake: { configured: false }, every8d: { configured: false } } };
  }
  const providers = _sms.status?.providers || {};
  const anyConfigured = !!(providers.mitake?.configured || providers.every8d?.configured);
  const alertEl = document.getElementById('sms-no-provider-alert');
  const formEl = document.getElementById('sms-send-form');
  if (alertEl) alertEl.style.display = anyConfigured ? 'none' : '';
  if (formEl) formEl.style.display = anyConfigured ? '' : 'none';
  if (anyConfigured && !_sms.provider) {
    _sms.provider = providers.mitake?.configured ? 'mitake' : 'every8d';
  }
  _smsRenderProviderCards();
  _smsRenderRecipients();
  _smsUpdateCounter();
  _smsSwitchTab(_sms.tab);
}

function _smsRenderProviderCards() {
  const el = document.getElementById('sms-provider-cards');
  if (!el) return;
  const providers = _sms.status?.providers || {};
  const defs = [{ key: 'mitake', label: '三竹簡訊' }, { key: 'every8d', label: 'Every8D' }];
  el.innerHTML = defs.map(d => {
    const configured = !!providers[d.key]?.configured;
    const sel = _sms.provider === d.key;
    const cls = 'sms-provider-card' + (sel ? ' sms-provider-sel' : '') + (configured ? '' : ' sms-provider-disabled');
    return `<div class="${cls}" ${configured ? `onclick="_smsSelectProvider('${d.key}')"` : ''}>
      <strong>${escHtml(d.label)}</strong>
      ${configured ? '' : '<span style="font-size:.76rem;color:#a0aec0;">（未設定，需在伺服器 .env 設定）</span>'}
    </div>`;
  }).join('');
}

function _smsSelectProvider(p) {
  if (_sms.provider === p) return;
  _sms.provider = p;
  const valEl = document.getElementById('sms-balance-value');
  if (valEl) valEl.textContent = '—';
  _smsRenderProviderCards();
  _smsUpdateCounter();
}

async function _smsRefreshBalance() {
  if (!_sms.provider || _sms.balanceLoading) return;
  _sms.balanceLoading = true;
  const btn = document.getElementById('sms-balance-refresh-btn');
  const valEl = document.getElementById('sms-balance-value');
  if (btn) btn.disabled = true;
  if (valEl) valEl.textContent = '查詢中…';
  try {
    // smsBalance 的業務錯誤（{error,detail}）已在 proxyCall 排除自動 throw，這裡自行判讀
    const r = await proxyCall('smsBalance', { provider: _sms.provider });
    if (r && r.error) {
      _sms.balance[_sms.provider] = null;
      if (valEl) valEl.textContent = _smsErrMsg(r.error, r.detail);
    } else {
      _sms.balance[_sms.provider] = r.balance;
      if (valEl) valEl.textContent = String(r.balance);
    }
  } catch (e) {
    if (valEl) valEl.textContent = _smsErrMsg(e.message);
  } finally {
    _sms.balanceLoading = false;
    if (btn) btn.disabled = false;
  }
}

// ── 收訊人 ──────────────────────────────────
function _smsRenderRecipients() {
  const el = document.getElementById('sms-recipients-chips');
  const countEl = document.getElementById('sms-recipients-count');
  if (countEl) countEl.textContent = String(_sms.recipients.length);
  if (!el) return;
  if (!_sms.recipients.length) { el.innerHTML = '<span style="font-size:.82rem;color:#a0aec0;">尚未加入收訊人</span>'; return; }
  el.innerHTML = _sms.recipients.map((r, i) => {
    const label = r.caseId ? `${escHtml(r.phone)}（${escHtml(r.caseId)}）` : escHtml(r.phone);
    return `<span class="ii-chip">${label}<button type="button" class="ii-chip-del" onclick="_smsRemoveRecipient(${i})">✕</button></span>`;
  }).join('');
}

function _smsAddRecipient(phone, name, caseId) {
  if (_sms.recipients.length >= 100) { showToast('收訊人已達 100 筆上限', 'warn'); return false; }
  if (_sms.recipients.some(r => r.phone === phone)) { showToast('此號碼已在收訊人清單中', 'warn'); return false; }
  _sms.recipients.push({ phone, name: name || '', caseId: caseId || '' });
  _smsRenderRecipients();
  return true;
}

function _smsRemoveRecipient(i) {
  _sms.recipients.splice(i, 1);
  _smsRenderRecipients();
}

function _smsAddPhoneFromInput() {
  const inp = document.getElementById('sms-phone-input');
  if (!inp) return;
  const v = _smsValidatePhone(inp.value);
  if (!v) { showToast('手機號碼格式錯誤，須為 09 開頭 10 碼或 +886 國際格式', 'warn'); return; }
  if (_smsAddRecipient(v, '', '')) inp.value = '';
}

// 從個案帶入：比照既有 searchCoupleCases（伴侶諮商加對象）的簡易搜尋慣例，
// 在已載入的 casesData 內以案號/姓名/學號比對（僅涵蓋目前已載入的個案，封存個案暫不支援）。
function _smsSearchCases(q) {
  const el = document.getElementById('sms-case-search-results');
  if (!el) return;
  q = (q || '').trim();
  if (!q) { el.innerHTML = ''; return; }
  const qLow = q.toLowerCase();
  const hits = casesData.filter(c => !c.deleted && (
    (c.name || '').toLowerCase().includes(qLow) ||
    (c.studentId || '').includes(qLow) ||
    (c.id || '').toLowerCase().includes(qLow)
  )).slice(0, 20);
  if (!hits.length) { el.innerHTML = '<div style="font-size:.85rem;color:#718096;padding:6px 4px;">找不到符合的個案。</div>'; return; }
  el.innerHTML = hits.map(c => {
    const hasPhone = !!(c.phone || '').trim();
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:4px;font-size:.85rem;">
      <span style="flex:1;">${escHtml(c.name || '—')}（${escHtml(c.id)}）${hasPhone ? '' : '<span style="color:#c0392b;font-size:.78rem;"> 無手機號，無法帶入</span>'}</span>
      ${hasPhone ? `<button type="button" class="btn btn-secondary btn-sm" onclick="_smsPickCase('${escHtml(c.id)}')">加入</button>` : ''}
    </div>`;
  }).join('');
}

function _smsPickCase(caseId) {
  const c = casesData.find(x => x.id === caseId);
  if (!c) return;
  const phone = _smsValidatePhone(c.phone);
  if (!phone) { showToast('此個案的手機號碼格式不正確，無法帶入', 'warn'); return; }
  _smsAddRecipient(phone, c.name || '', caseId);
  const inp = document.getElementById('sms-case-search-input'); if (inp) inp.value = '';
  const resEl = document.getElementById('sms-case-search-results'); if (resEl) resEl.innerHTML = '';
}

// ── 簡訊內容字數／則數 ──────────────────────
function _smsUpdateCounter() {
  const ta = document.getElementById('sms-message-textarea');
  const counterEl = document.getElementById('sms-message-counter');
  const warnEl = document.getElementById('sms-mitake-longsms-warn');
  const text = ta ? ta.value : '';
  const info = _smsSegmentInfo(text);
  const over333 = _sms.provider === 'every8d' && Array.from(text).length > 333;
  if (counterEl) counterEl.textContent = `字數 ${info.len}／預估 ${info.segments} 則${over333 ? '（已超過 Every8D 333 字上限）' : ''}`;
  if (warnEl) warnEl.style.display = (_sms.provider === 'mitake' && info.segments > 1) ? '' : 'none';
}

// ── 預約發送 ──────────────────────────────
function _smsToggleSchedule() {
  const cb = document.getElementById('sms-schedule-checkbox');
  const wrap = document.getElementById('sms-schedule-datetime-wrap');
  if (wrap) wrap.style.display = cb?.checked ? '' : 'none';
}

// ── 發送：確認對話框＋送出 ──────────────────
function _smsSendClick() {
  if (_sms.sending) return;
  if (!_sms.provider) { showToast('請先選擇發送平台', 'warn'); return; }
  if (!_sms.recipients.length) { showToast('請至少加入一位收訊人', 'warn'); return; }
  const message = (document.getElementById('sms-message-textarea')?.value || '').trim();
  if (!message) { showToast('簡訊內容不可為空', 'warn'); return; }
  const scheduleCb = document.getElementById('sms-schedule-checkbox');
  let scheduledAt = '';
  let scheduleDisplay = '';
  if (scheduleCb?.checked) {
    const dtVal = document.getElementById('sms-schedule-datetime')?.value || '';
    scheduledAt = _smsFormatScheduledAt(dtVal);
    if (!scheduledAt) { showToast('請輸入預約發送時間', 'warn'); return; }
    const target = new Date(dtVal);
    if (!(target.getTime() - Date.now() >= 11 * 60 * 1000)) {
      showToast('預約發送時間須為 11 分鐘以後', 'warn'); return;
    }
    scheduleDisplay = dtVal.replace('T', ' ');
  }
  const info = _smsSegmentInfo(message);
  const providerLabel = _sms.provider === 'every8d' ? 'Every8D' : '三竹簡訊';
  const estCost = info.segments * _sms.recipients.length;
  _sms._pendingSend = { message, scheduledAt };
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'sms-send-confirm-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:460px;">
      <div class="modal-header"><h3>確認發送簡訊</h3></div>
      <div class="modal-body">
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">平台：<strong>${escHtml(providerLabel)}</strong></p>
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">收訊人數：<strong>${_sms.recipients.length}</strong></p>
        <p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">預估則數：<strong>${info.segments}</strong>／預估扣點：<strong>${estCost}</strong></p>
        ${scheduleDisplay ? `<p style="font-size:.88rem;color:#4a5568;margin-bottom:6px;">預約時間：<strong>${escHtml(scheduleDisplay)}</strong></p>` : ''}
        <div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:.82rem;color:#2d3748;white-space:pre-wrap;max-height:140px;overflow:auto;margin-top:8px;">${escHtml(message)}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('sms-send-confirm-modal').remove();_sms._pendingSend=null;">取消</button>
        <button class="btn btn-primary" onclick="_smsDoSend()">確定發送</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function _smsDoSend() {
  document.getElementById('sms-send-confirm-modal')?.remove();
  if (_sms.sending) return;
  const pending = _sms._pendingSend;
  if (!pending) return;
  _sms.sending = true;
  const btn = document.getElementById('sms-send-btn');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '發送中…'; }
  try {
    const params = {
      provider: _sms.provider,
      recipients: _sms.recipients.map(r => ({ phone: r.phone, name: r.name || undefined, caseId: r.caseId || undefined })),
      message: pending.message,
    };
    if (pending.scheduledAt) params.scheduledAt = pending.scheduledAt;
    // smsSend 的業務錯誤（{error,detail}）已在 proxyCall 排除自動 throw，這裡自行判讀
    const r = await proxyCall('smsSend', params);
    if (r && r.error) {
      showToast(_smsErrMsg(r.error, r.detail), 'error');
      return;
    }
    showToast(`已發送 ${r.sent} 則，扣點 ${r.cost}，剩餘點數 ${r.balance}`, 'success');
    _sms.recipients = [];
    _smsRenderRecipients();
    const ta = document.getElementById('sms-message-textarea'); if (ta) ta.value = '';
    _smsUpdateCounter();
    const scheduleCb = document.getElementById('sms-schedule-checkbox');
    if (scheduleCb) scheduleCb.checked = false;
    _smsToggleSchedule();
    _sms.balance[_sms.provider] = r.balance;
    const valEl = document.getElementById('sms-balance-value'); if (valEl) valEl.textContent = String(r.balance);
    _sms.log.page = 1;
    if (_sms.tab === 'log') await _smsLoadLog();
  } catch (e) {
    showToast(_smsErrMsg(e.message), 'error');
  } finally {
    _sms.sending = false;
    _sms._pendingSend = null;
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '發送簡訊'; }
  }
}

// ── 分頁籤切換 ──────────────────────────────
function _smsSwitchTab(id) {
  _sms.tab = id;
  document.getElementById('sms-tabbtn-send')?.setAttribute('data-active', id === 'send' ? '1' : '0');
  document.getElementById('sms-tabbtn-log')?.setAttribute('data-active', id === 'log' ? '1' : '0');
  const sendEl = document.getElementById('sms-tab-send');
  const logEl = document.getElementById('sms-tab-log');
  if (sendEl) sendEl.style.display = id === 'send' ? '' : 'none';
  if (logEl) logEl.style.display = id === 'log' ? '' : 'none';
  if (id === 'log') _smsLoadLog();
}

// ── 發送紀錄 ──────────────────────────────
async function _smsLoadLog() {
  if (_sms.log.loading) return;
  _sms.log.loading = true;
  const body = document.getElementById('sms-log-table-body');
  if (body) body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#a0aec0;padding:20px;">⏳ 讀取中…</td></tr>`;
  try {
    const offset = (_sms.log.page - 1) * _sms.log.pageSize;
    const r = await proxyCall('smsListLog', { limit: _sms.log.pageSize, offset });
    _sms.log.items = Array.isArray(r?.items) ? r.items : [];
    _sms.log.total = r?.total || 0;
  } catch (e) {
    _sms.log.items = [];
    _sms.log.total = 0;
    showToast('讀取發送紀錄失敗：' + e.message, 'error');
  } finally {
    _sms.log.loading = false;
  }
  _smsRenderLogTable();
}

function _smsRenderLogTable() {
  const body = document.getElementById('sms-log-table-body');
  if (!body) return;
  if (!_sms.log.items.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#a0aec0;padding:20px;">尚無發送紀錄</td></tr>`;
    _smsRenderLogPagination();
    return;
  }
  body.innerHTML = _sms.log.items.map(it => {
    const meta = _smsLogStatusMeta(it.status);
    const providerLabel = it.provider === 'every8d' ? 'Every8D' : '三竹';
    const msgText = it.message || '';
    const preview = msgText.length > 24 ? msgText.slice(0, 24) + '…' : msgText;
    const expanded = _sms.log.expanded.has(it.id);
    const detailRow = expanded ? `<tr><td></td><td colspan="7">${_smsRenderRecipientDetail(it)}</td></tr>` : '';
    return `<tr>
      <td><button type="button" style="background:none;border:none;cursor:pointer;font-size:.8rem;" onclick="_smsToggleLogRow('${it.id}')">${expanded ? '▾' : '▸'}</button></td>
      <td>${escHtml(it.createdAt || '')}</td>
      <td>${escHtml(providerLabel)}</td>
      <td>${escHtml(it.senderEmail || '')}</td>
      <td>${(it.recipients || []).length}</td>
      <td data-tip="${escHtml(msgText)}">${escHtml(preview)}</td>
      <td><span class="badge ${meta.badge}">${escHtml(meta.text)}</span></td>
      <td>${it.cost ?? '—'}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="_smsQueryStatusClick('${it.id}')">查詢狀態</button>
        ${it.status === 'scheduled' ? `<button type="button" class="btn btn-danger btn-sm" onclick="_smsCancelClick('${it.id}')">取消預約</button>` : ''}
      </td>
    </tr>${detailRow}`;
  }).join('');
  _smsRenderLogPagination();
}

function _smsRenderRecipientDetail(it) {
  const rows = (it.recipients || []).map(r => `<tr>
    <td>${escHtml(r.phone || '')}</td>
    <td>${escHtml(r.name || r.caseId || '—')}</td>
    <td>${escHtml(_smsStatusText(it.provider, r.statusCode))}</td>
    <td>${escHtml(r.statusTime || '—')}</td>
  </tr>`).join('');
  return `<table style="width:100%;font-size:.82rem;background:#f7fafc;">
    <thead><tr><th>號碼</th><th>姓名/案號</th><th>狀態</th><th>狀態時間</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#a0aec0;">無收訊人明細</td></tr>'}</tbody>
  </table>`;
}

function _smsToggleLogRow(id) {
  if (_sms.log.expanded.has(id)) _sms.log.expanded.delete(id); else _sms.log.expanded.add(id);
  _smsRenderLogTable();
}

function _smsRenderLogPagination() {
  const el = document.getElementById('sms-log-pagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(_sms.log.total / _sms.log.pageSize));
  el.innerHTML = `
    <span>共 ${_sms.log.total} 筆</span>
    <button class="btn btn-secondary btn-sm" ${_sms.log.page <= 1 ? 'disabled' : ''} onclick="_smsChangeLogPage(${_sms.log.page - 1})">← 上一頁</button>
    <span>第 ${_sms.log.page} / ${totalPages} 頁</span>
    <button class="btn btn-secondary btn-sm" ${_sms.log.page >= totalPages ? 'disabled' : ''} onclick="_smsChangeLogPage(${_sms.log.page + 1})">下一頁 →</button>
  `;
}

function _smsChangeLogPage(p) {
  const totalPages = Math.max(1, Math.ceil(_sms.log.total / _sms.log.pageSize));
  if (p < 1 || p > totalPages) return;
  _sms.log.page = p;
  _smsLoadLog();
}

async function _smsQueryStatusClick(logId) {
  logId = Number(logId); // onclick 模板字串會把數字 id 變字串，統一轉回數字（後端與嚴格比較都吃數字）
  try {
    const r = await proxyCall('smsQueryStatus', { logId });
    if (r && r.batch) {
      const idx = _sms.log.items.findIndex(x => x.id === logId);
      if (idx !== -1) _sms.log.items[idx] = r.batch;
      _smsRenderLogTable();
      showToast('狀態已更新', 'success');
    }
  } catch (e) {
    showToast('查詢狀態失敗：' + _smsErrMsg(e.message), 'error');
  }
}

async function _smsCancelClick(logId) {
  logId = Number(logId); // 同 _smsQueryStatusClick：onclick 傳入為字串
  if (!confirm('確定要取消這筆預約發送？')) return;
  try {
    await proxyCall('smsCancel', { logId });
    showToast('已取消預約', 'success');
    await _smsLoadLog();
  } catch (e) {
    showToast(_smsErrMsg(e.message), 'error');
  }
}
