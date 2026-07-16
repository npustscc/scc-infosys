// server/src/actions/mail.js — fetchMentalLeaves／clearMentalLeaves dispatch 掛點。對映
// dev/Code.gs fetchMentalLeaves_（L2046）／clearMentalLeaves_（L2390）。
//
// npust5 Gmail 網頁 OAuth 授權流程（getNpust5AuthUrl/exchangeNpust5OAuthCode）在 Node 版已被
// 伺服器端憑證檔（GMAIL_SYNC_CREDS，見 google/auth.js）取代，兩者直接在 dispatch.js 回固定業務
// 錯誤訊息，不需要本模組介入（見 dispatch.js 對應 case／頂層特例）。
'use strict';

const vdrive = require('../storage/vdrive');
const googleAuth = require('../google/auth');
const gmail = require('../google/gmail');
const mentalLeaves = require('../mail/mentalLeaves');

// credsPath → tokenCache 的記憶體快取（單一 server process 生命週期），避免高頻手動觸發
// fetchMentalLeaves/clearMentalLeaves 時每次都重新打 token endpoint。
const tokenCaches = new Map();

function getTokenCache(credsPath) {
  let cache = tokenCaches.get(credsPath);
  if (!cache) {
    const creds = googleAuth.loadCreds(credsPath);
    cache = googleAuth.createTokenCache(creds);
    tokenCaches.set(credsPath, cache);
  }
  return cache;
}

async function getAccessTokenFromConfig(config) {
  if (!config.GMAIL_SYNC_CREDS) {
    throw new Error('伺服器尚未設定 GMAIL_SYNC_CREDS（信件解析憑證檔路徑），請聯絡系統管理者');
  }
  return getTokenCache(config.GMAIL_SYNC_CREDS).getAccessToken();
}

// ── fetchMentalLeaves：授權使用者可手動觸發，跑與 CLI（scripts/pull-mental-leaves.js）相同的核心
// （mentalLeaves.fetchAndMergeMentalLeaves）。只支援 GAS 版的 normal（增量）模式——force/reparse
// 為批次重跑/人工維運工具，Node 版未實作，改請走伺服器端 CLI（見檔頭註解）。
async function fetchMentalLeaves(db, config, ctx, params) {
  const mode = (params && params.mode) || 'normal';
  if (mode !== 'normal') {
    return { error: `fetchMentalLeaves: mode=${mode} 尚未支援，force/reparse 請改用伺服器端 CLI（node scripts/pull-mental-leaves.js）` };
  }
  const accessToken = await getAccessTokenFromConfig(config);
  return mentalLeaves.fetchAndMergeMentalLeaves(db, ctx, {
    accessToken,
    labelName: config.ML_GMAIL_LABEL,
    gmailClient: gmail,
  });
}

// ── clearMentalLeaves：清空 mental_leaves.json（破壞性）＋移除已處理信件的 label。對映
// clearMentalLeaves_：token/Gmail API 失敗僅記錄、不阻擋清檔（GAS 版 Logger.log 後續繼續清檔）。
async function clearMentalLeaves(db, config, ctx) {
  const labelName = config.ML_GMAIL_LABEL;
  let removedLabels = 0;
  if (config.GMAIL_SYNC_CREDS) {
    try {
      const accessToken = await getAccessTokenFromConfig(config);
      const labelData = await gmail.listLabels(accessToken);
      const processed = (labelData.labels || []).find((l) => l.name === labelName);
      if (processed) {
        const tagged = await gmail.gmailFetch(accessToken, '/messages?labelIds=' + encodeURIComponent(processed.id) + '&maxResults=500');
        const msgs = tagged.messages || [];
        for (const m of msgs) {
          try {
            await gmail.modifyLabels(accessToken, m.id, { removeLabelIds: [processed.id] });
            removedLabels++;
          } catch (_e) { /* 個別信件移除 label 失敗，比照 GAS 略過繼續 */ }
        }
      }
    } catch (_e) { /* 憑證/token/Gmail API 失敗：比照 GAS 僅記錄，不阻擋清檔 */ }
  }
  vdrive.updateJson(db, 'mental_leaves.json', { records: [] }, ctx);
  return { ok: true, removedLabels };
}

// ── countMentalLeavesUnprocessed：掃描未處理信件數（前端擷取進度視窗的分母）。對映
// countMentalLeavesUnprocessed_（dev/Code.gs L2415）：同一組查詢字串、maxResults=500、
// 回 { count, hasMore }。GAS 版無憑證時回 needsAuth＋authUrl；Node 版憑證在伺服器端，
// 無憑證屬部署設定缺失，直接拋錯（getAccessTokenFromConfig 的訊息會請使用者聯絡管理者）。
async function countMentalLeavesUnprocessed(config) {
  const accessToken = await getAccessTokenFromConfig(config);
  const query = `subject:(請假 OR 身心調適假 OR 缺課) -label:${config.ML_GMAIL_LABEL}`;
  const searchData = await gmail.listMessages(accessToken, query, { maxResults: 500 });
  const messages = searchData.messages || [];
  return { count: messages.length, hasMore: !!searchData.nextPageToken };
}

module.exports = { fetchMentalLeaves, clearMentalLeaves, countMentalLeavesUnprocessed };
