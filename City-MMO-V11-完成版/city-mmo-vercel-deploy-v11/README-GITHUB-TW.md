# City MMO（GitHub 上架版）

本專案已整理成適合 GitHub 的檔案結構：根目錄 `index.html`、前端資源在 `assets/`、多人伺服器在 `server/`。包含交通系統及外交／結盟中心。

## 重要：只開 GitHub Pages 還不能啟動完整 MMO

GitHub Pages 只能託管 HTML、CSS、JavaScript 等靜態檔案，不能執行 `server/server.js`。要讓朋友註冊、登入、建立城市、聊天及結盟，還需要把後端部署到支援 Node.js 和 WebSocket 的主機，並設定持久儲存。

**完整部署步驟請看 [`README-DEPLOY-TW.md`](README-DEPLOY-TW.md)**。這份指南使用以下搭配：

- GitHub Pages：發佈前端網站。
- Render Web Service：執行 Node.js／Socket.IO 多人伺服器（根目錄 `render.yaml` 可協助建立服務）。
- Upstash Redis REST：持久保存世界與帳號資料，避免免費主機重啟時遺失本機檔案。

## 上傳前檢查

1. 將 ZIP 解壓縮後的所有檔案上傳到 GitHub Repository 根目錄；打開 Repository 就應直接看到 `index.html`、`assets/`、`server/`、`package.json`、`render.yaml`。
2. 不要提交 Upstash Token、任何 `.env`、密碼、帳號存檔或 `node_modules/`。
3. 部署完成後，請先建立測試帳號，確認刷新網頁後城市仍存在，再邀請朋友。

本機測試需 Node.js 18 或更新版本：

```bash
npm install
npm test
npm start
```

接著開啟 <http://localhost:3000>。
