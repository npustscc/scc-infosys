// dev/tooltip.js — v264 拆 index.html 第十八刀：data-tip 自訂 tooltip 模組（inline script 區塊原地外部化，
// 原 <script> 標籤位置改為 <script src>，載入與執行時機不變）。由 build-public.js 原樣複製並納入 buildId 雜湊。
function _showDataTip(el) {
  const tip = document.getElementById('_tip_el');
  if (!tip || !el) return;
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.opacity = '0';
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.top - th - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top < 8) top = r.bottom + 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    tip.style.opacity = '1';
  });
}
(function(){
  const tip = document.getElementById('_tip_el');
  let timer, lastEl;
  // v199：rt-editor 內嵌圖片（雙擊可編輯，見 _rtImgEditorOpen）的提示文字，比照全站 data-tip 視覺樣式，
  // 但刻意不寫入 data-tip 屬性到圖片本身——那類 DOM 寫入若在表單載入時發生會跟 _gd 草稿基準快照的
  // 擷取時序打架，讓使用者一開表單就被誤判有未儲存變更（詳見 _rtImgEditorOpen 前的說明）。
  // 家系圖圖片（data-geno-key）已有自己的雙擊入口與別的提示方式，此處排除避免文字重複/衝突。
  const RT_IMG_TIP_SELECTOR = '.rt-editor img:not([data-geno-key])';
  const RT_IMG_TIP_TEXT = '雙擊編輯圖片';
  function tipTextFor(el) {
    return el.getAttribute('data-tip') || (el.matches(RT_IMG_TIP_SELECTOR) ? RT_IMG_TIP_TEXT : '');
  }
  function showTip(el) {
    const text = tipTextFor(el);
    if (!text) return;
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.opacity = '0';
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      let top = r.top - th - 8;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      if (top < 8) top = r.bottom + 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.opacity = '1';
    });
  }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest(`[data-tip], ${RT_IMG_TIP_SELECTOR}`);
    if (!el || el === lastEl) return;
    lastEl = el;
    clearTimeout(timer);
    timer = setTimeout(() => showTip(el), 700);
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest(`[data-tip], ${RT_IMG_TIP_SELECTOR}`)) return;
    clearTimeout(timer);
    lastEl = null;
    tip.style.opacity = '0';
    setTimeout(() => { if (tip.style.opacity === '0') tip.style.display = 'none'; }, 160);
  });
  document.addEventListener('click', () => {
    clearTimeout(timer);
    lastEl = null;
    tip.style.opacity = '0';
    setTimeout(() => { if (tip.style.opacity === '0') tip.style.display = 'none'; }, 160);
  });
})();
