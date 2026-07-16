#!/usr/bin/env bash
# server/scripts/deploy.sh — scc-server 實例一鍵更新（Claude 遠端維運通道 milestone 第 1 項）。
#
# 用法（在實例的 server/ 目錄下執行）：
#   ./scripts/deploy.sh dev    # ~/scc-dev/server
#   ./scripts/deploy.sh prod   # ~/scc-prod/server
#
# 流程：身分核對（防止在 dev 目錄誤跑 prod）→ [prod] sqlite 備份 → git pull --ff-only
#       → npm test 綠才繼續 → 前端重建（僅當 public/index.html 已存在；沿用其現有 exec URL，
#         prod 來源用 repo 根 index.html、dev 用 dev/index.html）→ systemctl restart → 冒煙 curl。
# 任一步失敗即中止（set -e），失敗點會印在最後一行。
set -euo pipefail

ENV="${1:-}"
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "用法：./scripts/deploy.sh dev|prod" >&2
  exit 1
fi

cd "$(dirname "$0")/.."   # server/

# ── 身分核對：arg 與此目錄 .env 的 PORT 必須匹配（dev=8788、prod=8787）──
PORT="$(node -e "console.log(require('./src/config').PORT)")"
EXPECT_PORT=$([[ "$ENV" == "dev" ]] && echo 8788 || echo 8787)
if [[ "$PORT" != "$EXPECT_PORT" ]]; then
  echo "✗ 身分核對失敗：此目錄 .env 的 PORT=$PORT，但你指定 $ENV（預期 $EXPECT_PORT）。是不是跑錯實例目錄？" >&2
  exit 1
fi
echo "== deploy $ENV（PORT=$PORT）=="

# ── prod：更新前先備份 sqlite（better-sqlite3 online backup，WAL 安全）──
if [[ "$ENV" == "prod" ]]; then
  DB="$(node -e "console.log(require('./src/config').DB_PATH)")"
  DEST="data/backup-$(date +%Y%m%d-%H%M%S).sqlite"
  SRC="$DB" DEST="$DEST" node -e "const D=require('better-sqlite3');(async()=>{const db=new D(process.env.SRC,{readonly:true});await db.backup(process.env.DEST);console.log('備份完成: '+process.env.DEST);})().catch(e=>{console.error('備份失敗: '+e.message);process.exit(1)})"
  ls -1t data/backup-*.sqlite 2>/dev/null | tail -n +21 | xargs -r rm --  # 最多留 20 份
fi

# ── 更新程式 ──
git -C .. pull --ff-only origin master
echo "== repo 現在位於：$(git -C .. log --oneline -1) =="

# ── 測試綠才繼續 ──
npm test --silent >/tmp/scc-deploy-test-$ENV.log 2>&1 || { tail -20 /tmp/scc-deploy-test-$ENV.log; echo "✗ 測試未過，中止部署（服務未動）。" >&2; exit 1; }
echo "== 測試全綠 =="

# ── 前端重建：僅當已有 public/index.html（沿用其現有 exec URL）──
if [[ -f public/index.html ]]; then
  CUR_URL="$(node -e "const m=/^const APPS_SCRIPT_URL = '([^']*)';$/m.exec(require('fs').readFileSync('public/index.html','utf8'));console.log(m?m[1]:'')")"
  if [[ -z "$CUR_URL" ]]; then echo "✗ 讀不到現有前端的 APPS_SCRIPT_URL，中止。" >&2; exit 1; fi
  if [[ "$ENV" == "prod" ]]; then
    # cutover 起 prod 前端一律從 dev/index.html 建（換兩個環境常數）：repo 根 index.html
    # 已改為 Pages 遷移公告頁，不再是前端來源（見 build-public.js --prod-from-dev 檔頭註解）。
    node scripts/build-public.js --prod-from-dev "$CUR_URL"
  else
    node scripts/build-public.js "$CUR_URL"
  fi
else
  echo "== 此實例尚無前端（public/index.html 不存在），跳過重建（cutover 時先手動建一次即可納入）=="
fi

# ── 重啟＋冒煙 ──
sudo systemctl restart "scc-$ENV"
sleep 2
systemctl is-active --quiet "scc-$ENV" || { echo "✗ scc-$ENV 服務未起來，查 journalctl -u scc-$ENV" >&2; exit 1; }
SMOKE="$(curl -s -m 10 -X POST "http://localhost:$PORT/exec" --data-urlencode 'payload={"action":"ping"}')"
echo "$SMOKE" | grep -q '"success"' || { echo "✗ 冒煙失敗，API 回應異常：${SMOKE:0:120}" >&2; exit 1; }
echo "== 部署完成：scc-$ENV 存活、API 回應正常 =="
