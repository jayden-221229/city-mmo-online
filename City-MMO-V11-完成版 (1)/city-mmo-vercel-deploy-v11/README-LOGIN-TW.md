# City MMO（交通系統＋結盟中心）

若你要上傳 GitHub／使用 GitHub Pages，請先閱讀 [`README-GITHUB-TW.md`](README-GITHUB-TW.md)。

## 本機啟動

1. 使用 Windows Defender 掃描下載的 ZIP；如果出現威脅警告，請停止使用並維持隔離，不要選擇允許。
2. 解壓縮，安裝 Node.js 18 或更新版本。
3. 在此資料夾開啟命令提示字元，執行 `npm install`。
4. 執行 `npm test` 可跑原有遊戲與存檔測試。
5. 執行 `npm start`，再開啟 <http://localhost:3000>。

本專案使用 `index.html`、`assets/`、`server/` 與 `shared/` 分離結構。完整多人玩法需要 Node.js 後端。
