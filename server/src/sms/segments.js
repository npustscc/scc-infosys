// server/src/sms/segments.js — 簡訊字數／則數計算（GSM 03.38 7-bit 預設字母表 vs UCS2）。
//
// 純函式、無 I/O，供 actions.js（送出前擋超長簡訊，避免三竹靜默截斷）與前端另一支 agent
// 共用同一套「幾個字算幾則」規則。演算法摘要（任務指示已定案，不做其他假設）：
//   - 內容全部落在 GSM 基本字集（大小寫英數＋常見符號） → GSM 7-bit 編碼：
//       單則上限 160 字；超過則每 153 字一則（多則簡訊每則要扣掉串接標頭的 7 個字）。
//   - 只要有任一字元不在 GSM 基本／擴充字集（例如中文、日文、emoji）→ 全篇改採 UCS2 16-bit 編碼：
//       單則上限 70 字；超過則每 67 字一則。
//   - GSM 擴充字集（`^{}\[~]|€` 等）需要「跳脫字元＋本體」兩個 septet 才能送出，故算作 2 個字。
'use strict';

// GSM 03.38 基本字集（128 碼中，本模組只列出會被使用者輸入到的可視字元；控制碼/換行不逐一列出
// 但沿用官方定義 \n、\r 亦屬基本字集，故仍計入 GSM_BASIC）。
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅå' +
  'Δ_ΦΓΛΩΠΨΣΘΞ' + // Δ_ΦΓΛΩΠΨΣΘΞ
  'ÆæßÉ' + // ÆæßÉ
  ' !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿' +
  'abcdefghijklmnopqrstuvwxyzäöñüà';

// GSM 03.38 擴充字集（每字元需 ESC+本體共 2 個 septet，計費／截斷判斷時算 2 字）。
const GSM_EXT = '^{}\\[~]|€'; // ^ { } \ [ ~ ] | €

const GSM_BASIC_SET = new Set(GSM_BASIC.split(''));
const GSM_EXT_SET = new Set(GSM_EXT.split(''));

const GSM_SINGLE_LIMIT = 160;
const GSM_MULTIPART_LIMIT = 153;
const UCS2_SINGLE_LIMIT = 70;
const UCS2_MULTIPART_LIMIT = 67;

// 以 code point 為單位掃描字串（避免代理對／組合字元被攔腰算成兩個字），判定：
//   - encoding：'GSM'（全篇落在基本／擴充字集）或 'UCS2'（含任何一個篇外字元，如中文）。
//   - chars：顯示用字元數（unicode code point 數，不是 GSM septet 加權數）。
//   - segments：則數（依 encoding 對應的單則/多則上限計算；擴充字元在 septet 計算時算 2）。
function estimate(message) {
  const text = message == null ? '' : String(message);
  const chars = Array.from(text);

  let isGsm = true;
  let septets = 0;
  for (const ch of chars) {
    if (GSM_BASIC_SET.has(ch)) { septets += 1; continue; }
    if (GSM_EXT_SET.has(ch)) { septets += 2; continue; }
    isGsm = false;
    break;
  }

  if (!isGsm) {
    const len = chars.length;
    const segments = len === 0 ? 1 : (len <= UCS2_SINGLE_LIMIT ? 1 : Math.ceil(len / UCS2_MULTIPART_LIMIT));
    return { encoding: 'UCS2', chars: len, segments };
  }

  const len = chars.length;
  const segments = septets === 0 ? 1 : (septets <= GSM_SINGLE_LIMIT ? 1 : Math.ceil(septets / GSM_MULTIPART_LIMIT));
  return { encoding: 'GSM', chars: len, segments };
}

module.exports = {
  estimate,
  GSM_BASIC_SET,
  GSM_EXT_SET,
  GSM_SINGLE_LIMIT,
  GSM_MULTIPART_LIMIT,
  UCS2_SINGLE_LIMIT,
  UCS2_MULTIPART_LIMIT,
};
