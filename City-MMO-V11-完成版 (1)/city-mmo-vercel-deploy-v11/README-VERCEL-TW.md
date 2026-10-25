# City MMO v11：Vercel + Upstash 部署（繁體中文）

這份專案以 v10 介面收合版為基礎，加入 Vercel Functions 的 Socket.IO 入口與 Upstash Redis 跨執行個體共享。它不是純靜態網站，請部署完整專案，不要只上傳 `index.html`。

## 最簡單的瀏覽器部署方式

1. 登入 Vercel，打開 <https://vercel.com/drop>。
2. 將整個 `city-mmo-vercel-deploy-v11.zip` 拖到頁面，選擇帳號／Team，專案名稱可填 `city-mmo-online`，然後 Deploy。
3. 部署完成後，記下 `https://你的專案.vercel.app` 網址。
4. 在 Vercel 專案內開啟 **Storage / Marketplace**，建立或連接 Upstash Redis。若是建立獨立 Upstash 資料庫，也可以在 Upstash Console 取得以下三項值。
5. 在 **Project Settings → Environment Variables** 加入以下 Production 變數（Preview 也可一併加入）：
   - `UPSTASH_REDIS_REST_URL`：Upstash REST API URL（通常以 `https://` 開頭）。
   - `UPSTASH_REDIS_REST_TOKEN`：Upstash REST token。
   - `UPSTASH_REDIS_URL`：Upstash 的 Redis/TCP 連線 URL（通常以 `rediss://` 開頭），供 Socket.IO Redis Adapter 跨 Function 廣播使用。
6. 儲存環境變數後，去 Deployments 重新部署最新一次部署。
7. 測試 `https://你的專案.vercel.app/api/socket-io/healthz`，應回覆 `ok`；再開首頁、註冊測試帳號、登入、建造及聊天。
8. 用兩個不同瀏覽器／無痕視窗登入，確認同一個世界與聊天會同步後，再分享網址給朋友。

## 重要注意事項

- `UPSTASH_REDIS_REST_TOKEN` 和 `UPSTASH_REDIS_URL` 都是密鑰，只能放進 Vercel 環境變數，不要貼到聊天、前端 JS 或公開檔案。
- Vercel Hobby 免費方案的 WebSocket Function 最長時間為 60 秒；客戶端已設定 Socket.IO 自動重連，但短暫重新連線仍可能發生。
- Upstash 免費額度有限。多人測試時請查看 Upstash 用量。不要在遊戲有重要進度時刪除 Redis 資料庫或更換 `SAVE_KEY`。
- Vercel Drop 每次拖放會建立新 Project。更新既有專案建議透過 Vercel CLI 或連接 Git Repository；不需要 GitHub 的初次上線可先用 Drop。
- 這個版本使用 Vercel catch-all API function `api/[...path].js`，讓 `/api/socket-io/socket.io`、登入 API 和健康檢查都進入同一個 Function。
- Vercel Function 是按請求／連線執行，不是永遠常駐的普通伺服器。世界狀態與帳號資料存於 Upstash；Socket.IO Redis Adapter 用於跨執行個體廣播。

## 本機測試

需要 Node.js 22：

```bash
npm install
npm test
npm start
```

本機啟動時可使用原本本機檔案存檔；Vercel 上必須設定上述 Upstash 變數。
