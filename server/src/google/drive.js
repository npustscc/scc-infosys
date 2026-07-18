// server/src/google/drive.js — Drive v3 REST API 薄封裝層（唯讀）。對映 dev/Code.gs 對
// www.googleapis.com/drive/v3 的直接呼叫片段（createFolder_/downloadFileBase64_ 一帶）。
// 目前僅供 actions/attachments.js 的「cutover 前舊附件」唯讀 fallback使用（見該檔頭註解）——
// 本模組刻意只提供唯讀操作（getMetadata／downloadMedia），不提供寫入，因為 Node 版附件的正規
// 儲存位置是 vdrive（sqlite），Drive 只作為歷史資料的唯讀後援來源。
//
// 測試友善設計：跟 google/auth.js／google/gmail.js 同慣例，內部一律透過 `exports.xxx(...)` 呼叫
// 自身其他函式，使測試可用整包物件替換（monkey-patch）掉個別方法而不需真的打網路。
'use strict';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// 泛用底層呼叫：非 2xx 一律 throw（不印回應內容——可能夾帶未預期的個資/權杖細節）。
async function driveFetch(accessToken, path) {
  const res = await fetch(DRIVE_API_BASE + path, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) {
    throw new Error('Drive API 呼叫失敗（HTTP ' + res.status + '）：' + path.split('?')[0]);
  }
  return res;
}

// 對映 dev/Code.gs driveGet_('files/' + id, ...)：取得 metadata（預設含 parents，供 F3 白名單
// 逐層上溯用；也支援 name/mimeType 供下載時組回傳形狀）。
async function getMetadata(accessToken, fileId, fields) {
  const res = await exports.driveFetch(
    accessToken,
    '/files/' + encodeURIComponent(fileId)
      + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields || 'id,name,mimeType,parents'),
  );
  return res.json();
}

// 對映 downloadFileBase64_ 的 alt=media 下載；回傳原始位元組（Buffer），呼叫端自行轉 base64。
async function downloadMedia(accessToken, fileId) {
  const res = await exports.driveFetch(
    accessToken,
    '/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true',
  );
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

exports.driveFetch = driveFetch;
exports.getMetadata = getMetadata;
exports.downloadMedia = downloadMedia;
exports.DRIVE_API_BASE = DRIVE_API_BASE;
