const path = require('path'), fs = require('fs'), http = require('http'), os = require('os'), crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { World } = require('./world');
const G = require('../shared/buildings');

const { createStorage } = require('./storage');          // 存檔位置：本機檔案（DATA_DIR）或 Upstash 雲端
const { findAccountByToken, normalizeAccounts } = require('./auth');
const storage = createStorage();
const world = new World();

const app = express();
const server = http.createServer(app);
// GitHub Pages 前端與 Node.js 後端通常是不同網域；同一個 CORS_ORIGIN 設定也用於 REST 登入 API。
// 建議正式部署時把 CORS_ORIGIN 設為你的 Pages 網域來源，例如 https://your-name.github.io（不要附路徑）。
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) : ['*'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (corsOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Socket.IO 跨網域限制和 REST API 共用 CORS_ORIGIN。
const io = new Server(server, { path: process.env.SOCKET_IO_PATH || '/api/socket-io/socket.io', cors: { origin: corsOrigins.includes('*') ? '*' : corsOrigins } });
// Username/password accounts. Passwords are scrypt-hashed; accounts use the same durable storage backend as the world.
// If this marker exists, perform one destructive reset at startup. It is only
// removed after world + account data have been cleared successfully.
const resetMarker = path.join(__dirname, 'RESET_WORLD_ONCE');
const resetRequested = fs.existsSync(resetMarker);
let accounts = normalizeAccounts({});
let authWrite = Promise.resolve();
function saveAccounts() {
  const text = JSON.stringify(accounts, null, 2);
  authWrite = authWrite.then(() => storage.saveAccounts(text));
  return authWrite;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash: key.toString('hex') })));
}
function validUsername(name) { return typeof name === 'string' && /^[a-zA-Z0-9_-]{3,16}$/.test(name); }
app.use(express.json({ limit: '10kb' }));
app.post(['/api/auth/register', '/api/socket-io/api/auth/register'], async (req, res) => {
  try {
    const username = String((req.body || {}).username || '').trim();
    const password = (req.body || {}).password;
    if (!validUsername(username)) return res.status(400).json({ error: '帳號需為 3–16 個英文字母、數字、底線或連字號。' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: '密碼長度需為 8–128 個字元。' });
    const key = username.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(accounts, key)) return res.status(409).json({ error: '這個使用者名稱已被使用。' });
    const credentials = await hashPassword(password);
    const token = crypto.randomBytes(32).toString('hex');
    accounts[key] = { username, ...credentials, token, createdAt: Date.now() };
    await saveAccounts();
    res.json({ token, username });
  } catch (e) { console.error('register failed:', e); res.status(500).json({ error: '註冊失敗，請稍後再試。' }); }
});
app.post(['/api/auth/login', '/api/socket-io/api/auth/login'], async (req, res) => {
  try {
    const username = String((req.body || {}).username || '').trim();
    const password = (req.body || {}).password;
    const account = accounts[username.toLowerCase()];
    if (!account || typeof password !== 'string') return res.status(401).json({ error: '帳號或密碼錯誤。' });
    const candidate = await hashPassword(password, account.salt);
    const a = Buffer.from(candidate.hash, 'hex'), b = Buffer.from(account.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: '帳號或密碼錯誤。' });
    res.json({ token: account.token, username: account.username });
  } catch (e) { console.error('login failed:', e); res.status(500).json({ error: '登入失敗，請稍後再試。' }); }
});
app.get(['/healthz', '/api/socket-io/healthz'], (req, res) => res.send('ok'));                          // 主機服務的健康檢查用
app.use('/shared', express.static(path.join(__dirname, '../shared'))); // 舊版客戶端路徑相容
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));

const room = (cx, cy) => `c:${cx},${cy}`;      // 視野廣播房間：一個 chunk 一個房間
const MAX_VIEW = 14;                           // 單一玩家最多同時訂閱 14x14 chunks，防濫用

const withLeft = ev => (ev && ev.until ? { ...ev, left: ev.until - Date.now() } : ev);   // 用「剩餘毫秒」傳給客戶端，不受電腦時鐘影響
const sendMe = id => {
  const p = world.players.get(id);
  if (p) io.to('p:' + id).emit('me', {
    money: Math.floor(p.money), rate: +p.rate.toFixed(1), pop: Math.round(p.pop),
    happiness: Math.round(p.happiness), chunks: world.ownedChunks(id).length, claimCost: world.claimCost(id), goods: p.goods,
    power: (p.util || {}).power || { cap: 0, use: 0 }, water: (p.util || {}).water || { cap: 0, use: 0 },
    jobs: Math.round(p.jobs || 0), employ: Math.round((p.employ == null ? 1 : p.employ) * 100), shopCap: Math.round(p.shopCap || 0),
    traffic: Math.round(p.traffic || 0), trafficLoad: Math.round(p.trafficLoad || 0), roadTiles: Math.round(p.roadTiles || 0), roadCapacity: Math.round(p.roadCapacity || 0), transitCapacity: Math.round(p.transitCapacity || 0),
    peakPop: Math.floor(p.peakPop || 0), mode: G.GAME_MODES[p.mode] ? p.mode : 'classic', levelName: G.LEVELS[p.lvl || 0].name,
    nextAt: (G.LEVELS[(p.lvl || 0) + 1] || {}).at == null ? null : G.LEVELS[(p.lvl || 0) + 1].at, nextName: (G.LEVELS[(p.lvl || 0) + 1] || {}).name || null, ach: p.ach || [],
  });
};

// 批量建造 / 拆除的結果依 chunk 分組廣播（一個 chunk 一則訊息，不是一格一則）
const broadcastTiles = list => {
  const by = new Map();
  for (const b of list) { const k = room(b.ch.cx, b.ch.cy); if (!by.has(k)) by.set(k, []); by.get(k).push(b); }
  for (const [k, arr] of by) io.to(k).emit('tiles', arr.map(b => ({ x: b.x, y: b.y, type: b.tile ? b.tile.type : null, f: b.tile ? b.tile.f : 0, n: b.tile ? b.tile.n : 0 })));
};

// ── 社交：聊天紀錄、排行榜 ──
let chatLog = world.chatLog;
const pushChat = m => { chatLog.push(m); if (chatLog.length > 30) chatLog.shift(); world.chatLog = chatLog; io.emit('chat', m); };
const sysChat = text => pushChat({ sys: true, text, t: Date.now() });
const board = () => {
  const counts = new Map(), home = new Map();
  for (const c of world.chunks.values()) { counts.set(c.owner, (counts.get(c.owner) || 0) + 1); if (!home.has(c.owner)) home.set(c.owner, [c.cx, c.cy]); }
  return [...world.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, pop: Math.round(p.pop), chunks: counts.get(p.id) || 0, online: io.sockets.adapter.rooms.has('p:' + p.id), home: home.get(p.id) || [0, 0],
  })).sort((a, b) => b.pop - a.pop || b.chunks - a.chunks).slice(0, 30);
};

io.on('connection', socket => {
  let me = null, bucket = 20, lastChat = 0;                  // 每個連線的 token bucket：每秒補 10 次動作
  const refill = setInterval(() => { bucket = Math.min(20, bucket + 10); }, 1000);
  io.emit('online', io.of('/').sockets.size);                    // 線上人數

  const guard = fn => (data, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    if (!me) return ack({ err: 'no_login' });
    if (bucket-- <= 0) return ack({ err: 'rate_limit' });
    try { ack(fn(data || {}) || { ok: true }); } catch (e) { console.error(e); ack({ err: 'server_error' }); }
  };

  socket.on('hello', (data, ack) => {
    const { token } = data || {};
    if (typeof ack !== 'function') return;
    const account = findAccountByToken(accounts, token);
    if (!account) return ack({ err: 'unauthorized' });
    let p = world.playerByToken(token), fresh = false;
    if (!p) { p = world.createPlayer(token, account.username); fresh = true; }
    else if (p.name !== account.username) p.name = account.username;
    me = p;
    socket.join('p:' + me.id);
    const home = world.ownedChunks(me.id)[0];
    if (fresh) { io.to(room(home.cx, home.cy)).emit('chunk', world.chunkPayload(home)); io.emit('world', world.worldMap()); sysChat(me.name + ' 建立了新城市'); }
    ack({
      you: world.pub(me), home: { cx: home.cx, cy: home.cy }, event: withLeft(world.currentEvent()),
      links: [...world.links].filter(l => l.split('|').includes(me.id)),
      incoming: world.incoming(me.id).map(r => ({ from: r.from, fromName: (world.players.get(r.from) || {}).name })),
      outgoing: world.outgoing(me.id).map(r => ({ to: r.to, toName: (world.players.get(r.to) || {}).name })),
    });
    const bonus = world.claimDaily(me.id);                                      // 每日登入獎勵
    if (bonus) socket.emit('toast', { text: `每日登入獎勵 +$${bonus.toLocaleString()}` });
    sendMe(me.id);
    if (!fresh) socket.emit('world', world.worldMap());
    socket.emit('chatlog', chatLog); socket.emit('board', board());
  });

  // 視野裁剪：客戶端回報可見 chunk 範圍 → 伺服器只讓它加入那些房間
  socket.on('viewport', data => {
    if (!me) return; // 未登入的 socket 不可訂閱世界區塊
    let { x0, y0, x1, y1 } = data || {};
    if (![x0, y0, x1, y1].every(Number.isInteger)) return;
    x1 = Math.min(x1, x0 + MAX_VIEW - 1); y1 = Math.min(y1, y0 + MAX_VIEW - 1);
    const want = new Set();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) want.add(room(cx, cy));
    for (const r of [...socket.rooms]) if (r.startsWith('c:') && !want.has(r)) socket.leave(r);
    for (const r of want) if (!socket.rooms.has(r)) {
      socket.join(r);
      const ch = world.chunks.get(r.slice(2));
      if (ch) socket.emit('chunk', world.chunkPayload(ch));        // 新進入視野 → 補發整個 chunk
    }
  });

  socket.on('build', guard(({ x, y, type }) => {
    const r = world.build(me.id, x, y, type);
    if (r.err) return r;
    io.to(room(r.ch.cx, r.ch.cy)).emit('tile', { x, y, type, f: r.tile.f, n: r.tile.n });
    sendMe(me.id);
  }));

  socket.on('buildMany', guard(({ type, tiles }) => {
    const r = world.buildMany(me.id, type, tiles);
    if (!r.ok) return r;
    broadcastTiles(r.built); sendMe(me.id);
    return { ok: true, built: r.built.length, failed: r.failed, err: r.err, spent: r.spent };
  }));

  socket.on('bulldozeMany', guard(({ tiles }) => {
    const r = world.bulldozeMany(me.id, tiles);
    if (!r.ok) return r;
    broadcastTiles(r.built); sendMe(me.id);
    return { ok: true, built: r.built.length, failed: r.failed, err: r.err, refund: r.refund };
  }));

  socket.on('bulldoze', guard(({ x, y }) => {
    const r = world.bulldoze(me.id, x, y);
    if (r.err) return r;
    io.to(room(r.ch.cx, r.ch.cy)).emit('tile', { x, y, type: null });
    sendMe(me.id);
  }));

  socket.on('mode:set', guard(({ mode }) => {
    const r = world.setMode(me.id, mode);
    if (r.err) return r;
    sendMe(me.id);
    return { ok: true, mode: r.mode };
  }));

  socket.on('transit:list', guard(() => ({ ok: true, routes: world.publicTransitRoutes() })));
  socket.on('transit:save', guard(input => {
    const r = world.saveTransitRoute(me.id, input);
    if (r.err) return r;
    const routes = world.publicTransitRoutes();
    io.emit('transit:routes', routes);
    return { ok: true, route: r.route, routes };
  }));
  socket.on('transit:delete', guard(({ id }) => {
    const r = world.deleteTransitRoute(me.id, id);
    if (r.err) return r;
    const routes = world.publicTransitRoutes();
    io.emit('transit:routes', routes);
    return { ok: true, id: r.id, routes };
  }));

  socket.on('claim', guard(({ cx, cy }) => {
    const r = world.claim(me.id, cx, cy);
    if (r.err) return r;
    io.to(room(cx, cy)).emit('chunk', world.chunkPayload(r.chunk));
    io.emit('world', world.worldMap());
    sendMe(me.id);
  }));

  socket.on('diplo:request', guard(({ to }) => {
    const r = world.requestLink(me.id, to);
    if (r.err) return r;
    const target = world.players.get(to);
    io.to('p:' + to).emit('diplo:incoming', { from: me.id, fromName: me.name });
    io.to('p:' + me.id).emit('diplo:outgoing', { to, toName: target ? target.name : '玩家' });
    return r;
  }));

  socket.on('diplo:respond', guard(({ from, accept }) => {
    const r = world.respondLink(me.id, from, !!accept);
    if (r.err) return r;
    if (r.accepted) {
      io.to('p:' + from).to('p:' + me.id).emit('diplo:linked', { a: from, b: me.id });
      const o = world.players.get(from); if (o) sysChat(`${o.name} 與 ${me.name} 結盟了`);
    }
    else io.to('p:' + from).emit('diplo:denied', { by: me.name, from, to: me.id });
    io.to('p:' + from).to('p:' + me.id).emit('diplo:responded', { from, to: me.id, accepted: !!r.accepted });
    return r;
  }));

  socket.on('diplo:cancel', guard(({ to }) => {
    const r = world.cancelLink(me.id, to);
    if (r.err) return r;
    io.to('p:' + to).emit('diplo:cancelled', { from: me.id, fromName: me.name });
    io.to('p:' + me.id).emit('diplo:outgoing-cancelled', { to });
    return r;
  }));

  socket.on('diplo:unlink', guard(({ to }) => {
    const r = world.unlink(me.id, to);
    if (r.err) return r;
    io.to('p:' + to).to('p:' + me.id).emit('diplo:unlinked', { a: me.id, b: to });
  }));

  socket.on('gift', guard(({ to, amount }) => {
    const r = world.gift(me.id, to, amount);
    if (r.err) return r;
    sysChat(`${me.name} 贈送 $${amount.toLocaleString()} 給 ${world.players.get(to).name}`);
    sendMe(me.id); sendMe(to);
  }));

  socket.on('chat', guard(({ text }) => {
    text = String(text || '').trim().slice(0, 120);
    if (!text) return { err: 'bad_request' };
    if (Date.now() - lastChat < 700) return { err: 'rate_limit' };                 // 聊天另外限速：每 0.7 秒一則
    lastChat = Date.now();
    pushChat({ name: me.name, color: me.color, text, t: lastChat });
  }));

  socket.on('disconnect', () => { clearInterval(refill); io.emit('online', io.of('/').sockets.size); });
});

// ── 存檔 ──
let inflight = null;
function saveNow() {
  if (inflight) return inflight;
  inflight = (async () => {
    try { const str = JSON.stringify(world); await storage.save(str); return str.length; }
    catch (e) { console.error('save failed:', e.message); }
  })().finally(() => { inflight = null; });
  return inflight;
}
async function loadWorld() {
  if (resetRequested) {
    console.warn('RESET_WORLD_ONCE found: permanently clearing world, accounts, and local backups...');
    try {
      if (typeof storage.reset !== 'function') throw new Error('Storage backend does not support reset');
      await storage.reset();
      accounts = normalizeAccounts({});
      await saveAccounts();
      await fs.promises.unlink(resetMarker);
      console.warn('One-time reset complete. All players must register again. Marker removed; future restarts will keep new progress.');
    } catch (e) {
      console.error('One-time reset failed; marker kept so it can be retried:', e.message);
      process.exit(1);
    }
  }
  for (let i = 1; i <= 5; i++) {
    try {
      const j = await storage.load();
      if (j) { world.fromJSON(j); console.log(`world loaded (${storage.kind}${storage.file ? '：' + storage.file : ''})`); } else console.log(`fresh world (${storage.kind}${storage.file ? '：' + storage.file : ''})`);
      return;
    } catch (e) { console.error(`讀取存檔失敗（${i}/5）：`, e.message); await new Promise(r => setTimeout(r, 2000 * i)); }
  }
  console.error('一直讀不到世界存檔。為避免用空世界覆蓋舊資料，伺服器不啟動。'); process.exit(1);
}
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'])                                    // 關機或重新部署前先存檔
  process.on(sig, async () => {
    if (closing) return; closing = true;
    await Promise.race([saveNow(), new Promise(r => setTimeout(r, 4000))]);
    process.exit(0);
  });

async function start() {
  // Load accounts before opening the server so registrations never race the initial load.
  if (!resetRequested) {
    try { accounts = normalizeAccounts((await storage.loadAccounts()) || {}); }
    catch (e) { console.error('讀取帳號資料失敗：', e.message); process.exit(1); }
  }
  await loadWorld();
  // 每秒：重算連通性（只有 dirty 時）+ 經濟結算 → 只把「狀態有變的 chunk」推給訂閱它的人
  setInterval(() => {
    world.tickEvents();
    const changed = world.tickEconomy();
    for (const ch of changed) io.to(room(ch.cx, ch.cy)).emit('chunk', world.chunkPayload(ch));
    for (const ev of world.drainEvents()) {                                    // 全服事件 / 成就 / 升級通知
      if (ev.type === 'world') { io.emit('worldEvent', withLeft(ev)); if (ev.id) sysChat(`${ev.icon} 全服事件：${ev.name}（${ev.desc}）`); continue; }
      const pl = world.players.get(ev.pid); if (!pl) continue;
      if (ev.type === 'ach') { io.to('p:' + ev.pid).emit('ach', ev); if (ev.reward >= 15000) sysChat(`🏆 ${pl.name} 達成成就「${ev.name}」`); }
      else { io.to('p:' + ev.pid).emit('level', ev); if (ev.lvl > 0) sysChat(`${pl.name} 的城市升級為「${ev.name}」！`); }
    }
    for (const id of world.players.keys()) if (io.sockets.adapter.rooms.has('p:' + id)) sendMe(id);
  }, 1000);
  setInterval(() => io.emit('board', board()), 5000);
  let lastSize = 0;
  const loop = async () => { lastSize = (await saveNow()) || lastSize; setTimeout(loop, storage.delayFor(lastSize)); };
  setTimeout(loop, storage.delayFor(0));

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`City MMO on http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || [])      // 區網其他裝置用這些網址加入
      if (i.family === 'IPv4' && !i.internal) console.log(`  同一個 Wi-Fi 的朋友請開：http://${i.address}:${PORT}`);
  });
}
start();
