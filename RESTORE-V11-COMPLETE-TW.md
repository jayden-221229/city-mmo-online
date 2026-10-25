# City MMO V11 完成版（舊世界恢復）

此包以 V11 為基礎，修正既有 Vercel 環境變數名稱相容性，並內附舊世界存檔作為一次性種子。

- 優先使用 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`；若不存在，改讀既有 `mmo_KV_REST_API_URL` / `mmo_KV_REST_API_TOKEN`。
- Socket.IO Redis Adapter 優先讀 `UPSTASH_REDIS_URL`，否則讀既有 `mmo_REDIS_URL`。
- 只有 Redis 的 `city-mmo:world` 尚無資料時，才把 `server/restore-seed-world.json` 匯入；若雲端已存在世界存檔，完全不覆蓋。
- 不會刪除 Redis keys，不會執行 reset。
- 帳號資料不包含在種子中，避免將帳號 token 再複製到部署檔；如果雲端原本沒有帳號資料，需另行安全匯入帳號。

部署後需檢查 `/api/socket-io/healthz`，再實際登入並確認地圖。健康檢查回覆 `ok` 本身不代表 Redis 已完成連線。
