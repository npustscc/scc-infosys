// server/src/openmail/unreadPush.js — v238：信箱未讀推播。
//
// 用途：側邊選單「信箱」項要顯示未讀數徽章，不必使用者開著信箱頁才更新。做法是每 2 分鐘（見
// server/src/index.js require.main===module 區塊的 setInterval）掃一次「目前有 SSE 連線」的
// 使用者，對每個人各做一次 IMAP STATUS INBOX 查未讀數，數字有變才推播（sse.sendTo，個人化事件，
// 見下）。
//
// 只對「SSE 在線 ∩ credStore 有帳密（信箱已連結）」的人做：
//   - SSE 未連線：不知道要推去哪、也沒有前端在等，跳過。
//   - credStore.get(email) 回 null（未連結信箱／密碼已過期需重新輸入）：絕不嘗試用舊帳密碰 IMAP
//     ——2026-07-20 事件教訓是「不可造成重複登入嘗試」，credStore 回 null 就是「沒有可用帳密」，
//     連一次登入都不該試。順手把該 email 從 lastSent 記憶清掉，這樣之後重新連結信箱、下一輪
//     STATUS 拿到的值一定會被視為「變了」而推播一次（不會因為剛好與清除前最後一次相同而漏推）。
//
// 頻率刻意與既有前端「信箱頁開著時每 2 分鐘 _omLoadFolders() 輪詢」相同——這不是新增負擔，只是
// 把原本「只有開著信箱頁才問一次伺服器」的頻率，變成「不管有沒有開著信箱頁都問一次」，對郵件
// 伺服器的請求量級沒有本質改變。查詢一律走 client.js 的 withImap 連線池（同一 email 的所有操作
// 序列化在同一顆已登入的連線上，5 分鐘 idle 才關閉），不會另外觸發登入嘗試。
//
// 個人化：未讀數是使用者的個人資訊（连结的是他本人的信箱），一律用 sse.sendTo(email, ...) 只推
// 給本人的連線，不可用 broadcast 推給全體（比對 sse.js 檔頭：broadcast 只適合「不含個資的檔名
// 訊號」）。
//
// tick() 對外承諾「整體不 throw」：排程呼叫端（index.js 的 setInterval）不應因為任何一個使用者
// 的 IMAP 查詢失敗而讓計時器邏輯中斷，也不可讓例外冒出去變成未捕捉例外。單一使用者查詢失敗
// （斷線、逾時、任何 IMAP 錯誤）一律靜默跳過、留待下一輪再試，不重試、不記錄。
'use strict';

// email → 最後一次推播的未讀數。用於「數字沒變就不重送」——避免每 2 分鐘對所有在線使用者
// 無條件推播造成前端無意義的重新渲染。
const lastSent = new Map();

async function tick(db, config, deps = {}) {
  const {
    sse: sseDep = require('../sse'),
    credStore: credDep = require('./credStore'),
    client: clientDep = require('./client'),
  } = deps;

  for (const email of sseDep.connectedEmails()) {
    const creds = credDep.get(email);
    if (!creds) {
      lastSent.delete(email);
      continue;
    }

    try {
      const st = await clientDep.withImap(email, creds.mailUser, creds.mailPass, config, (imap) => imap.status('INBOX', { unseen: true }));
      const unseen = Number(st && st.unseen) || 0;
      if (lastSent.get(email) !== unseen) {
        lastSent.set(email, unseen);
        sseDep.sendTo(email, 'omUnread', { unseen });
      }
    } catch (_e) {
      // 連線/IMAP 失敗靜默跳過，下一輪（2 分鐘後）再試——不可 throw、不可觸發額外登入嘗試。
    }
  }
}

module.exports = { tick, _lastSentForTest: lastSent };
