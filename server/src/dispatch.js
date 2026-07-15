// server/src/dispatch.js — 閘門管線＋ACTION_TABLE，1:1 對映 dev/Code.gs doPost（L27-208）。
// 閘門順序（與 GAS 版相同的先後次序，差異見各段註解）：
//   1. token 解析（無 token 僅 sessionStart 走本地認證，其餘回 Session expired）
//   2. rootFolderId → ctx（Node 版單一 root，見 authz/gate.js 檔頭註解）
//   3. 授權閘（isAuthorizedUser_ 對映：AUTHZ_EXEMPT 之外，email 須在 vdrive config.json 的
//      users 且未停用；sessionStart 由 actions/session.js 內部自行判斷，不重複走此閘）
//   4. admin/細部閘（config.json 整檔寫入保護、ROOT_GUARDED、query 白名單）
//   5. ACTION_TABLE 分派；日曆 7＋信件 4 個 action → proxy stub；其餘未實作 action → 明確業務錯誤
// 每個請求無論成功/拒絕/例外都寫一筆 audit_log（見 audit.js，content 類參數只記長度）。
'use strict';

const envelope = require('./envelope');
const vdrive = require('./storage/vdrive');
const sessionAuth = require('./auth/session');
const gate = require('./authz/gate');
const proxy = require('./actions/proxy');
const audit = require('./audit');
const sessionActions = require('./actions/session');
const storageActions = require('./actions/storage');
const commitActions = require('./actions/commit');

const STORAGE_ACTIONS = new Set([
  'readJson', 'updateJson', 'readJsonById', 'updateContentById',
  'createJson', 'getMetadata', 'listFolder', 'query', 'startupBatch',
]);

// Phase 1.5：厚 commit 類 action（見 actions/commit.js），皆為併發安全的鎖內讀-改-寫。
const COMMIT_ACTIONS = new Set([
  'casesUpsert', 'attendanceCommit', 'bookingsCommit', 'listCommit', 'notifCommit',
]);

function getConfigUsersSafe(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || null;
  } catch (_e) {
    return null;
  }
}

function getConfigFileIdSafe(db, ctx) {
  try {
    return vdrive.resolvePathToId(db, 'config.json', ctx);
  } catch (_e) {
    return null;
  }
}

// 主入口：payload 為 doPost 收到的整個 JSON 物件（已由 index.js 從 urlencoded/JSON body 解出）。
async function handleRequest(db, config, payload) {
  const t0 = Date.now();
  const { sessionToken, action, rootFolderId, ...params } = payload || {};
  let outcomeEmail = null;
  let outcome = 'ok';
  let responseEnvelope;
  let strippedNote = ''; // R1 caseAuthz shadow 模式：本應剝除幾筆的稽核備註（見下方 onShadowStrip）

  try {
    // exchangeNpust5OAuthCode：OAuth2 code exchange 不需要 idToken/sessionToken（同 GAS 版，
    // code 本身即為授權證明）；Phase 1 未實作轉發本體，直接回業務錯誤，不吃身分/授權閘。
    if (action === 'exchangeNpust5OAuthCode') {
      outcome = 'denied';
      responseEnvelope = envelope.bizError(`Not implemented (phase 2 GAS proxy): ${action}`);
      return responseEnvelope;
    }

    // ── 1. 身分解析 ──────────────────────────────────────────────────────────
    let userEmail = null;
    let jti = null;
    if (sessionToken) {
      const decoded = sessionAuth.verifySessionToken(sessionToken, config.SESSION_SECRET);
      if (!decoded) {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
      const revokedBefore = sessionAuth.getRevokedBefore(db, decoded.e);
      if (revokedBefore && Number(decoded.iat) < Number(revokedBefore)) {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
      userEmail = decoded.e;
      jti = decoded.jti;
      outcomeEmail = userEmail;
      // sessionStart 只收本地帳密：不允許拿舊 session 換新 session（每日重登為設計目標）。
      if (action === 'sessionStart') {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
    } else if (action !== 'sessionStart') {
      // 無 token 且非 sessionStart → 一律視為憑證過期（業務級，前端會自動重登重試）。
      outcome = 'denied';
      return envelope.bizError('Session expired');
    }

    // ── 2. rootFolderId → ctx（單一 root：必須等於 .env 設定的 ROOT_FOLDER_ID，不符即拒絕）──
    if (rootFolderId && rootFolderId !== config.ROOT_FOLDER_ID) {
      outcome = 'denied';
      return envelope.bizError('Unauthorized rootFolderId');
    }
    const ctx = { root: config.ROOT_FOLDER_ID };

    // ── sessionStart：本地帳密＋TOTP 認證＋授權閘（在 actions/session.js 內部一次做完）──
    if (action === 'sessionStart') {
      const result = await sessionActions.sessionStart(db, params, ctx, config.SESSION_SECRET);
      outcomeEmail = params.email || null;
      if (result.kind === 'invalid_credentials') {
        outcome = 'denied';
        return envelope.bizError('invalid_credentials');
      }
      if (result.kind === 'unauthorized') {
        outcome = 'denied';
        return envelope.bizError('Unauthorized user');
      }
      outcomeEmail = result.email;
      return envelope.ok({ sessionToken: result.sessionToken, exp: result.exp, email: result.email, mailSent: result.mailSent });
    }

    // ── 3. 授權閘（AUTHZ_EXEMPT={ping, submitUserApplication, sessionStart} 之外，
    //      email 須在 vdrive config.json 的 users 且未停用）──
    if (!gate.AUTHZ_EXEMPT[action]) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.authzDecision(users, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Unauthorized user');
      }
    }

    // ── 4a. admin-only actions（deleteFile/moveFile；Phase 1 骨架未實作，仍保留閘門順序）──
    if (gate.ADMIN_ONLY_ACTIONS[action]) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Forbidden: admin only');
      }
    }

    // ── 4b. config.json 整檔寫入保護：非管理者不得變動 users ──
    const cfgFileId = getConfigFileIdSafe(db, ctx);
    if (gate.isConfigWrite(action, params, cfgFileId)) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail)) {
        let oldCfg = null;
        try { oldCfg = vdrive.readJson(db, 'config.json', ctx).data; } catch (_e) { oldCfg = null; }
        if (!gate.configUsersUnchanged(oldCfg, params.content)) {
          outcome = 'denied';
          return envelope.bizError('Forbidden: non-admin config.json write must not modify users; use configSelfPatch/configCasesPatch for user or case-access changes');
        }
      }
    }

    // ── 4c. F3：ROOT_GUARDED（fileId/parentId/folderId 類動作限本次 ctx.root 子樹）──
    const rgKey = gate.ROOT_GUARDED[action];
    if (rgKey && params[rgKey] && !vdrive.isUnderRoot(db, params[rgKey], ctx.root)) {
      outcome = 'denied';
      return envelope.bizError('Forbidden: target outside root');
    }

    // ── 4d. P1：query action 限根 ──
    if (action === 'query' && !gate.queryParentsAllowed(params.q, (id) => vdrive.isUnderRoot(db, id, ctx.root))) {
      outcome = 'denied';
      return envelope.bizError('Forbidden: query must be scoped under root');
    }

    // ── 5. ACTION_TABLE 分派 ──────────────────────────────────────────────────
    const onShadowStrip = (count, label) => { strippedNote = `caseAuthzShadow:${count}@${label}`; };

    let result;
    switch (action) {
      case 'ping': result = { ok: true, email: userEmail }; break;
      case 'sessionLogout': result = sessionActions.sessionLogout(db, userEmail); break;
      case 'listMySessions': result = sessionActions.listMySessions(db, userEmail, params, ctx); break;
      case 'readJson': result = storageActions.readJson(db, params, ctx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateJson': result = storageActions.updateJson(db, params, ctx); break;
      case 'readJsonById': result = storageActions.readJsonById(db, params, ctx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateContentById': result = storageActions.updateContentById(db, params); break;
      case 'createJson': result = storageActions.createJson(db, params); break;
      case 'getMetadata': result = storageActions.getMetadata(db, params); break;
      case 'listFolder': result = storageActions.listFolder(db, params); break;
      case 'query': result = storageActions.query(db, params); break;
      case 'startupBatch': result = storageActions.startupBatch(db, params, ctx); break;
      case 'casesUpsert': result = commitActions.casesUpsert(db, params, ctx); break;
      case 'attendanceCommit': result = commitActions.attendanceCommit(db, params, ctx); break;
      case 'bookingsCommit': result = commitActions.bookingsCommit(db, params, ctx); break;
      case 'listCommit': result = commitActions.listCommit(db, params, ctx); break;
      case 'notifCommit': result = commitActions.notifCommit(db, params, ctx); break;
      default: {
        if (proxy.isProxyAction(action)) {
          outcome = 'denied';
          return envelope.bizError(`Not implemented (phase 2 GAS proxy): ${action}`);
        }
        outcome = 'denied';
        return envelope.bizError(`Not implemented on node backend: ${action}`);
      }
    }

    return envelope.ok(result);
  } catch (err) {
    outcome = 'error';
    return envelope.fail(err);
  } finally {
    try {
      const detail = audit.summarizeParams(params) + (strippedNote ? `,${strippedNote}` : '');
      audit.appendAuditLog(db, {
        email: outcomeEmail,
        action: action || '(none)',
        target: params && (params.path || params.file || params.fileId || params.folderId || params.parentId || null),
        outcome,
        latencyMs: Date.now() - t0,
        detail,
      });
    } catch (_auditErr) { /* 稽核寫入失敗不可讓請求失敗 */ }
  }
}

module.exports = { handleRequest, STORAGE_ACTIONS, COMMIT_ACTIONS };
