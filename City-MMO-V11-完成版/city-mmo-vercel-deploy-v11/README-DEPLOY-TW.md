# City MMO v11：Vercel + Upstash 一鍵部署指南

這份是適用於 Vercel 的完整專案：根目錄包含 `index.html`、`assets/`、`shared/`、`server/`、`api/[...path].js` 和 `vercel.json`。請部署整個 ZIP，不要只上傳 `index.html`。

## A. 上傳專案

1. 登入 Vercel。
2. 打開 <https://vercel.com/drop>。
3. 將整個 ZIP 拖曳到畫面，選擇帳號／Team，專案名稱可填 `city-mmo-online`，按 Deploy。
4. 部署完成後，記下 `https://你的專案.vercel.app` 網址。

Vercel Drop 每次上傳會建立新專案；第一次上線使用 Drop 最簡單。更新既有專案可以之後再用 Vercel CLI 或連接 Git。

## B. 設定 Upstash Redis（必要）

Vercel Function 不可使用本機檔案作永久存檔，所以必須設定 Upstash。可以從 Vercel Marketplace 建立／連接 Upstash Redis，或在 Upstash Console 建立資料庫。

在 Vercel 專案的 **Settings → Environment Variables** 加入以下變數，至少選 **Production**（建議 Preview 也勾選）：

| 名稱 | 值要填什麼 |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash 的 REST API URL，通常以 `https://` 開頭 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash 的 REST Token |
| `UPSTASH_REDIS_URL` | Upstash 的 Redis/TCP 連線 URL，通常以 `rediss://` 開頭，供 Socket.IO 跨執行個體廣播使用 |

注意：三項都是從 Upstash Console 複製；Token 與連線 URL 都是密鑰，絕對不要放進前端 JS、公開檔案或貼到聊天。

儲存環境變數後，進入 **Deployments**，對最新部署選 **Redeploy**，使新變數生效。

## C. 確認上線

1. 開啟 `https://你的專案.vercel.app/api/socket-io/healthz`，應回覆 `ok`。
2. 開啟 `https://你的專案.vercel.app/`，確認遊戲首頁正常顯示。
3. 建立測試帳號並登入，建造一棟建築後重新整理，確認存檔仍在。
4. 用另一個瀏覽器或無痕視窗登入另一個測試帳號，確認兩個視窗看見同一個世界，並測試聊天和建造同步。
5. 通過測試後再把網址分享給朋友。

## 重要限制與排錯

- 此版本使用 `api/[...path].js` 作為 Vercel catch-all Function，負責 Socket.IO WebSocket、登入 API 及健康檢查。
- Vercel Hobby 免費方案的 WebSocket Function 最長執行時間為 60 秒；客戶端已啟用自動重連，但可能短暫重新連線。
- 世界和帳號資料由 Upstash 保存，Socket.IO Redis Adapter 用於不同 Function 執行個體之間的廣播。Upstash 免費額度有限，請留意使用量。
- 如果部署建置成功但 Socket.IO 連不上，先確認 Function 支援 WebSocket／Fluid Compute 已啟用，再到 Vercel 專案 **Logs** 查看錯誤。
- 如果 `/api/socket-io/healthz` 回覆 503，通常是 Upstash 三個環境變數缺漏或值貼錯。不要因為看到空白世界就刪除資料庫；先檢查部署 Logs，避免覆蓋舊存檔。
- 原有 `data/` 僅供本機模式使用。Vercel 版本的存檔在 Upstash，請不要手動刪除 Upstash 資料庫或更改 `SAVE_KEY`，否則可能看不到之前的世界。

## 本機回歸測試

需要 Node.js 22：

```bash
npm install
npm test
npm start
```

本機啟動會使用原本本機存檔；雲端 Vercel 部署必須設定 Upstash 環境變數。
