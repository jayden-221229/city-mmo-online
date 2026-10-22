# City MMO 上線部署（GitHub Pages + Render + Upstash）

這份專案包含前端（`index.html`、`assets/`）、多人伺服器（`server/`）與 Render Blueprint（`render.yaml`）。GitHub Pages 只負責網站前端；Render 執行 Node.js 與 Socket.IO 伺服器；Upstash Redis REST 儲存世界與帳號，避免免費主機重啟後本機檔案消失。

## 1. 把專案上傳至 GitHub

1. 在 GitHub 建立 Repository。
2. 將 ZIP 解壓縮後的所有內容上傳到 Repository 根目錄；打開 Repository 就要直接看到 `index.html`、`assets/`、`server/`、`package.json` 和 `render.yaml`。
3. 不要上傳密碼、API Token、`.env`、帳號資料或 `node_modules/`。

## 2. 發布 GitHub Pages 前端

1. Repository → **Settings → Pages**。
2. Source 選 **Deploy from a branch**。
3. Branch 選 `main`，資料夾選 `/(root)`，按 Save。
4. 等候 Pages 網站發布，記下網址。

若網址形如 `https://你的帳號.github.io/專案名稱/`，CORS 的來源只填 `https://你的帳號.github.io`，不要附上 `/專案名稱/`。若使用自訂網域，來源則填自訂網域的 `https://` 網址。

## 3. 建立 Upstash Redis 資料庫

1. 在 <https://upstash.com/> 登入並建立 Redis 資料庫。
2. 開啟資料庫的 REST API 區域，複製 REST URL 和 REST Token。
3. 這兩項都是私密資料，只貼在 Render 的環境變數欄位，不要放進 GitHub 檔案。

伺服器會把世界存成 `SAVE_KEY`（預設 `city-mmo:world`），帳號資料存成 `ACCOUNTS_KEY`（預設 `city-mmo:accounts`）。帳號密碼會先用 scrypt 雜湊，不會以明文儲存。

## 4. 用 Render 部署 Node.js 後端

1. 前往 <https://render.com/>，登入並連結你的 GitHub 帳號。
2. 選 **New → Blueprint**，選擇剛上傳的 Repository。Render 會讀取根目錄的 `render.yaml`。
3. 建立服務時，填入以下環境變數：
   - `CORS_ORIGIN`：你的 GitHub Pages 來源，例如 `https://你的帳號.github.io`（不要加專案路徑）。
   - `UPSTASH_REDIS_REST_URL`：Upstash 的 REST URL。
   - `UPSTASH_REDIS_REST_TOKEN`：Upstash 的 REST Token。
4. 部署完成後，在 Render 的服務頁取得 `https://你的服務名稱.onrender.com` 類似的網址。
5. 開啟 `https://你的服務名稱.onrender.com/healthz`，應看到 `ok`。

免費 Web Service 可能在閒置後休眠，喚醒需要時間；適合試玩，不等於保證全天候線上。首次上線後，先用測試帳號確認登入、建城、刷新後存檔、聊天和結盟。

## 5. 將前端連到後端

編輯 `assets/js/config.js`，把空字串改成你的 Render 網址：

```js
window.GAME_SERVER = 'https://你的服務名稱.onrender.com';
```

儲存後 commit/push 到 GitHub，等 GitHub Pages 更新，再用 Pages 網址開啟遊戲。

## 6. 測試與重要提醒

- 前端網址應是 GitHub Pages 網址；伺服器網址應是 Render 的 `https://...onrender.com` 網址。
- `CORS_ORIGIN` 必須與前端來源完全相符，不能加尾端路徑或混用 `http`/`https`。
- 不要把 Upstash Token 提交到 GitHub。
- 請先用測試帳號遊玩並確認資料持久化，再邀請朋友。免費服務可能休眠或重啟。
- 若部署失敗，先查看 Render → 服務 → **Logs**，把錯誤訊息貼出來；不要貼任何 Token 或密碼。

## 本機測試

需要 Node.js 18 或更新版本：

```bash
npm install
npm test
npm start
```

然後開啟 <http://localhost:3000>。
