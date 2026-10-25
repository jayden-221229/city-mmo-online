// City MMO 伺服器設定
// 同網域 Vercel 部署使用 api/socket-io.js；本機 server/server.js 也支援相同路徑。
// 若使用外部後端，GAME_SERVER 請填後端 HTTPS 網址，不要放 API 金鑰或密碼。
window.GAME_SERVER = '';
window.GAME_SOCKET_PATH = '/api/socket-io/socket.io';
window.GAME_API_PREFIX = '/api/socket-io';
