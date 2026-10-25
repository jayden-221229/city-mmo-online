const path = require('path'), fs = require('fs'), http = require('http'), os = require('os'), crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { World } = require('../server/world');
const G = require('../shared/buildings');

const { createStorage } = require('../server/storage');          // 存檔位置：本機檔案（DATA_DIR）或 Upstash 雲端
const { findAccountByToken, normalizeAccounts } = require('../server/auth');
const IS_VERCEL = !!process.env.VERCEL;
const storage = createStorage();
const world = new World();
let bootPromise = null;
let bootError = null;
let redisPubClient = null;
let redisSubClient = null;
const WORLD_KEY = process.env.SAVE_KEY || 'city-mmo:world';
const WORLD_LOCK_KEY = WORLD_KEY + ':vercel-lock';

const app = express();
const server = http.createServer(app);
// GitHub Pages 前端與 Node.js 後端通常是不同網域；同一個 CORS_ORIGIN 設定也用於 REST 登入 API。
// 建議正式部署時把 CORS_ORIGIN 設為你的 Pages 網域來源，例如 https://your-name.github.io（不要附路徑）。
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) : ['*'];
app.use((req, res, next) => {
  if (!IS_VERCEL || !bootPromise) return next();
  bootPromise.then(() => {
    if (bootError) return res.status(503).json({ error: 'server_start_failed', message: 'City MMO 後端尚未就緒，請檢查 Vercel 環境變數與部署日誌。' });
    next();
  }).catch(() => res.status(503).json({ error: 'server_start_failed', message: 'City MMO 後端啟動失敗。' }));
});
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
const io = new Server(server, { path: process.env.SOCKET_IO_PATH || '/api/socket-io/socket.io', transports: ['websocket'], cors: { origin: corsOrigins.includes('*') ? '*' : corsOrigins } });
io.use((socket, next) => {
  if (!IS_VERCEL || !bootPromise) return next();
  bootPromise.then(() => bootError ? next(new Error('server_not_ready')) : next()).catch(next);
});
// Username/password accounts. Passwords are scrypt-hashed; accounts use the same durable storage backend as the world.
// If this marker exists, perform one destructive reset at startup. It is only
// removed after world + account data have been cleared successfully.
const resetMarker = path.join(__dirname, '../server/RESET_WORLD_ONCE');
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
app.post('/api/admin/restore-v10', async (req, res) => {
  const expected = process.env.V11_RESTORE_TOKEN;
  const authHeader = String(req.headers.authorization || '');
  const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!expected) return res.status(404).json({ error: 'not_found' });
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(404).json({ error: 'not_found' });
  try { res.json(await restoreV10SeedOnce()); }
  catch (e) {
    console.error('V10 seed restore failed:', e.message);
    res.status(500).json({ error: 'restore_failed', message: '資料合併失敗；原存檔仍保留，請檢查部署日誌。' });
  }
});
app.post(['/api/auth/register', '/api/socket-io/api/auth/register'], async (req, res) => {
  try {
    const result = await withWorldTransaction(async () => {
      accounts = normalizeAccounts((await storage.loadAccounts()) || {});
      const username = String((req.body || {}).username || '').trim();
      const password = (req.body || {}).password;
      if (!validUsername(username)) return { status: 400, body: { error: '帳號需為 3–16 個英文字母、數字、底線或連字號。' } };
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) return { status: 400, body: { error: '密碼長度需為 8–128 個字元。' } };
      const key = username.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(accounts, key)) return { status: 409, body: { error: '這個使用者名稱已被使用。' } };
      const credentials = await hashPassword(password);
      const token = crypto.randomBytes(32).toString('hex');
      accounts[key] = { username, ...credentials, token, createdAt: Date.now() };
      await storage.saveAccounts(JSON.stringify(accounts, null, 2));
      return { status: 200, body: { token, username } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { console.error('register failed:', e); res.status(500).json({ error: '註冊失敗，請稍後再試。' }); }
});
app.post(['/api/auth/login', '/api/socket-io/api/auth/login'], async (req, res) => {
  try {
    accounts = normalizeAccounts((await storage.loadAccounts()) || {});
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
async function board() {
  const counts = new Map(), home = new Map(), onlinePlayers = new Set();
  try {
    const sockets = await io.fetchSockets();
    for (const sock of sockets) for (const r of sock.rooms || []) if (r.startsWith('p:')) onlinePlayers.add(r.slice(2));
  } catch (e) { for (const [id] of world.players) if (io.sockets.adapter.rooms.has('p:' + id)) onlinePlayers.add(id); }
  for (const c of world.chunks.values()) { counts.set(c.owner, (counts.get(c.owner) || 0) + 1); if (!home.has(c.owner)) home.set(c.owner, [c.cx, c.cy]); }
  return [...world.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, pop: Math.round(p.pop), chunks: counts.get(p.id) || 0, online: onlinePlayers.has(p.id), home: home.get(p.id) || [0, 0],
  })).sort((a, b) => b.pop - a.pop || b.chunks - a.chunks).slice(0, 30);
}
async function broadcastOnline() {
  try { io.emit('online', (await io.fetchSockets()).length); }
  catch { io.emit('online', io.of('/').sockets.size); }
}

io.on('connection', socket => {
  let me = null, bucket = 20, lastChat = 0;                  // 每個連線的 token bucket：每秒補 10 次動作
  const refill = setInterval(() => { bucket = Math.min(20, bucket + 10); }, 1000);
  void broadcastOnline();

  const guard = fn => (data, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    if (!me) return ack({ err: 'no_login' });
    if (bucket-- <= 0) return ack({ err: 'rate_limit' });
    withWorldTransaction(() => {
      const id = me && me.id;
      me = id ? (world.players.get(id) || null) : null;
      if (!me) return { err: 'no_login' };
      return fn(data || {}) || { ok: true };
    }).then(result => ack(result || { ok: true })).catch(e => { console.error('world transaction failed:', e); ack({ err: 'server_error' }); });
  };

  socket.on('hello', async (data, ack) => {
    const { token } = data || {};
    if (typeof ack !== 'function') return;
    try {
      const result = await withWorldTransaction(async () => {
        accounts = normalizeAccounts((await storage.loadAccounts()) || {});
        const account = findAccountByToken(accounts, token);
        if (!account) return { err: 'unauthorized' };
        let p = world.playerByToken(token), fresh = false;
        if (!p) { p = world.createPlayer(token, account.username); fresh = true; }
        else if (p.name !== account.username) p.name = account.username;
        me = p;
        socket.join('p:' + me.id);
        const home = world.ownedChunks(me.id)[0];
        if (fresh) { io.to(room(home.cx, home.cy)).emit('chunk', world.chunkPayload(home)); io.emit('world', world.worldMap()); sysChat(me.name + ' 建立了新城市'); }
        const hello = {
          you: world.pub(p), home: { cx: home.cx, cy: home.cy }, event: withLeft(world.currentEvent()),
          links: [...world.links].filter(l => l.split('|').includes(me.id)),
          incoming: world.incoming(me.id).map(r => ({ from: r.from, fromName: (world.players.get(r.from) || {}).name })),
          outgoing: world.outgoing(me.id).map(r => ({ to: r.to, toName: (world.players.get(r.to) || {}).name })),
          world: world.worldMap(),
        };
        const bonus = world.claimDaily(me.id);
        return { hello, id: me.id, fresh, bonus };
      }, { reloadAccounts: false });
      if (result && result.err) return ack(result);
      ack({ you: result.hello.you, home: result.hello.home, event: result.hello.event, links: result.hello.links, incoming: result.hello.incoming, outgoing: result.hello.outgoing });
      if (result.bonus) socket.emit('toast', { text: `每日登入獎勵 +$${result.bonus.toLocaleString()}` });
      sendMe(result.id);
      if (!result.fresh) socket.emit('world', result.hello.world);
      socket.emit('chatlog', chatLog);
      socket.emit('board', await board());
      void broadcastOnline();
    } catch (e) { console.error('hello failed:', e); ack({ err: 'server_error' }); }
  });

  // 視野裁剪：客戶端回報可見 chunk 範圍 → 伺服器只讓它加入那些房間
  socket.on('viewport', async data => {
    if (!me) return; // 未登入的 socket 不可訂閱世界區塊
    let { x0, y0, x1, y1 } = data || {};
    if (![x0, y0, x1, y1].every(Number.isInteger)) return;
    try { await withWorldTransaction(() => {
      if (!me || !world.players.has(me.id)) return;
      x1 = Math.min(x1, x0 + MAX_VIEW - 1); y1 = Math.min(y1, y0 + MAX_VIEW - 1);
      const want = new Set();
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) want.add(room(cx, cy));
      for (const r of [...socket.rooms]) if (r.startsWith('c:') && !want.has(r)) socket.leave(r);
      for (const r of want) if (!socket.rooms.has(r)) {
        socket.join(r);
        const ch = world.chunks.get(r.slice(2));
        if (ch) socket.emit('chunk', world.chunkPayload(ch));
      }
    }, { autoTick: false }); } catch (e) { console.error('viewport refresh failed:', e.message); }
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

  socket.on('disconnect', () => { clearInterval(refill); void broadcastOnline(); });
});

// ── Vercel + Upstash：跨 Function 共用世界與廣播 ──
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
      if (!IS_VERCEL) process.exit(1); else throw e;
    }
  }
  for (let i = 1; i <= 5; i++) {
    try {
      const j = await storage.load();
      if (j) { world.fromJSON(j); console.log(`world loaded (${storage.kind}${storage.file ? '：' + storage.file : ''})`); } else console.log(`fresh world (${storage.kind}${storage.file ? '：' + storage.file : ''})`);
      chatLog = world.chatLog;
      // Rebuild derived connectivity/utility flags after hydrating the saved data.
      world.recompute(Date.now()); world.dirty = false;
      return;
    } catch (e) { console.error(`讀取存檔失敗（${i}/5）：`, e.message); await new Promise(r => setTimeout(r, 1000 * i)); }
  }
  const err = new Error('一直讀不到世界存檔。為避免用空世界覆蓋舊資料，伺服器不啟動。');
  console.error(err.message);
  if (!IS_VERCEL) process.exit(1); else throw err;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function upstashCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.mmo_KV_REST_API_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.mmo_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('缺少 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Upstash REST 回傳非 JSON'); }
  if (!response.ok || data.error) throw new Error(data.error || `Upstash HTTP ${response.status}`);
  return data.result;
}
const ACQUIRE_WORLD_LUA = `
local ok = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
if not ok then return {0, ''} end
local value = redis.call('GET', KEYS[2])
if not value then value = '' end
return {1, value}
`;
const SAVE_AND_UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[1])
return 1
`;
const UNLOCK_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
async function acquireWorldLease() {
  const token = crypto.randomBytes(16).toString('hex');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await upstashCommand(['EVAL', ACQUIRE_WORLD_LUA, '2', WORLD_LOCK_KEY, WORLD_KEY, token, '60000']);
    if (Array.isArray(result) && Number(result[0]) === 1) return { token, worldText: typeof result[1] === 'string' ? result[1] : '' };
    await sleep(60 + Math.floor(Math.random() * 70));
  }
  throw new Error('世界資料正在忙碌，請稍後重試。');
}
async function releaseWorldLease(token, worldText) {
  if (worldText == null) return upstashCommand(['EVAL', UNLOCK_LUA, '1', WORLD_LOCK_KEY, token]);
  const result = await upstashCommand(['EVAL', SAVE_AND_UNLOCK_LUA, '2', WORLD_LOCK_KEY, WORLD_KEY, token, worldText]);
  if (Number(result) !== 1) throw new Error('世界鎖定逾時；本次資料未寫入，請重試。');
  return result;
}
function restoreCounts(j) {
  return {
    players: Array.isArray(j && j.players) ? j.players.length : 0,
    chunks: Array.isArray(j && j.chunks) ? j.chunks.length : 0,
    links: Array.isArray(j && j.links) ? j.links.length : 0,
    pending: Array.isArray(j && j.pending) ? j.pending.length : 0,
    transitRoutes: Array.isArray(j && j.transitRoutes) ? j.transitRoutes.length : 0,
  };
}

function mergeV10SeedWorld(current, seed) {
  const base = current && typeof current === 'object' ? current : {};
  const players = Array.isArray(base.players) ? base.players.slice() : [];
  const playerIds = new Set(players.filter(p => p && p.id).map(p => p.id));
  let addedPlayers = 0;
  for (const p of (Array.isArray(seed.players) ? seed.players : [])) {
    if (!p || !p.id || playerIds.has(p.id)) continue;
    players.push(p); playerIds.add(p.id); addedPlayers++;
  }
  const chunks = Array.isArray(base.chunks) ? base.chunks.slice() : [];
  const chunkMap = new Map(chunks.map((c, i) => [String(c.cx) + ',' + String(c.cy), i]));
  let addedChunks = 0, addedTiles = 0, skippedChunkOwnerConflicts = 0;
  for (const c of (Array.isArray(seed.chunks) ? seed.chunks : [])) {
    const key = String(c.cx) + ',' + String(c.cy);
    if (!playerIds.has(c.owner)) continue;
    if (!chunkMap.has(key)) { chunks.push(c); chunkMap.set(key, chunks.length - 1); addedChunks++; continue; }
    const existing = chunks[chunkMap.get(key)];
    if (existing.owner !== c.owner) { skippedChunkOwnerConflicts++; continue; }
    const tiles = Array.isArray(existing.tiles) ? existing.tiles.slice() : [];
    const tileIds = new Set(tiles.filter(t => Array.isArray(t)).map(t => String(t[0])));
    for (const tile of (Array.isArray(c.tiles) ? c.tiles : [])) {
      if (!Array.isArray(tile) || tile.length < 2 || tileIds.has(String(tile[0]))) continue;
      tiles.push(tile); tileIds.add(String(tile[0])); addedTiles++;
    }
    chunks[chunkMap.get(key)] = { ...existing, tiles };
  }
  const links = Array.isArray(base.links) ? base.links.slice() : [];
  const linkSet = new Set(links);
  let addedLinks = 0;
  for (const link of (Array.isArray(seed.links) ? seed.links : [])) {
    if (typeof link !== 'string') continue;
    const parts = link.split('|');
    if (parts.length !== 2 || !playerIds.has(parts[0]) || !playerIds.has(parts[1]) || linkSet.has(link)) continue;
    links.push(link); linkSet.add(link); addedLinks++;
  }
  const pending = Array.isArray(base.pending) ? base.pending.slice() : [];
  const pendingSet = new Set(pending.filter(r => r).map(r => String(r.from) + '>' + String(r.to)));
  let addedPending = 0;
  for (const row of (Array.isArray(seed.pending) ? seed.pending : [])) {
    if (!row || !playerIds.has(row.from) || !playerIds.has(row.to)) continue;
    const key = String(row.from) + '>' + String(row.to);
    if (pendingSet.has(key)) continue;
    pending.push(row); pendingSet.add(key); addedPending++;
  }
  const transitRoutes = Array.isArray(base.transitRoutes) ? base.transitRoutes.slice() : [];
  const routeIds = new Set(transitRoutes.filter(r => r && r.id).map(r => r.id));
  let addedTransitRoutes = 0;
  for (const row of (Array.isArray(seed.transitRoutes) ? seed.transitRoutes : [])) {
    if (!row || !row.id || routeIds.has(row.id) || !playerIds.has(row.owner)) continue;
    transitRoutes.push(row); routeIds.add(row.id); addedTransitRoutes++;
  }
  const merged = { ...seed, ...base, players, chunks, links, pending, transitRoutes };
  if (!Array.isArray(merged.chatLog)) merged.chatLog = [];
  if (!Number.isFinite(Number(merged.lastEconomyAt))) merged.lastEconomyAt = 0;
  if (!Number.isFinite(Number(merged.nextEventAt))) merged.nextEventAt = 0;
  return { world: merged, added: { players: addedPlayers, chunks: addedChunks, tiles: addedTiles, skippedChunkOwnerConflicts, links: addedLinks, pending: addedPending, transitRoutes: addedTransitRoutes } };
}

const SAVE_WORLD_AND_MARK_RESTORE_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[3], ARGV[3])
redis.call('DEL', KEYS[1])
return 1
`;

async function restoreV10SeedOnce() {
  if (!IS_VERCEL || storage.kind !== 'upstash') throw new Error('雲端存檔尚未就緒。');
  const markerKey = WORLD_KEY + ':v10-seed-restore-complete';
  const marker = await upstashCommand(['GET', markerKey]);
  if (marker) { try { return { ok: true, alreadyRestored: true, summary: JSON.parse(marker) }; } catch { return { ok: true, alreadyRestored: true }; } }
  const seedPath = path.join(__dirname, '../server/restore-seed-world.json');
  const seed = JSON.parse(await fs.promises.readFile(seedPath, 'utf8'));
  const lease = await acquireWorldLease();
  let finished = false;
  try {
    const markerAgain = await upstashCommand(['GET', markerKey]);
    if (markerAgain) {
      await releaseWorldLease(lease.token, null); finished = true;
      try { return { ok: true, alreadyRestored: true, summary: JSON.parse(markerAgain) }; } catch { return { ok: true, alreadyRestored: true }; }
    }
    const current = lease.worldText ? JSON.parse(lease.worldText) : null;
    const merged = mergeV10SeedWorld(current, seed);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const accountsKey = process.env.ACCOUNTS_KEY || 'city-mmo:accounts';
    const backupWorldKey = WORLD_KEY + ':backup-v10-' + stamp;
    const backupAccountsKey = accountsKey + ':backup-v10-' + stamp;
    let worldBackupCreated = false, accountsBackupCreated = false;
    if (lease.worldText) { await upstashCommand(['SET', backupWorldKey, lease.worldText]); worldBackupCreated = true; }
    const accountText = await upstashCommand(['GET', accountsKey]);
    if (accountText) { await upstashCommand(['SET', backupAccountsKey, accountText]); accountsBackupCreated = true; }
    const summary = {
      version: 'v10-to-v11-merge', completedAt: new Date().toISOString(),
      before: restoreCounts(current), after: restoreCounts(merged.world), added: merged.added,
      backupWorldKey: worldBackupCreated ? backupWorldKey : null,
      backupAccountsKey: accountsBackupCreated ? backupAccountsKey : null,
    };
    const saved = await upstashCommand(['EVAL', SAVE_WORLD_AND_MARK_RESTORE_LUA, '3', WORLD_LOCK_KEY, WORLD_KEY, markerKey, lease.token, JSON.stringify(merged.world), JSON.stringify(summary)]);
    if (Number(saved) !== 1) throw new Error('無法原子儲存合併結果；請保留備份並重試。');
    finished = true;
    world.fromJSON(merged.world); world.recompute(Date.now()); world.dirty = false; chatLog = world.chatLog;
    console.log('V10 world merge complete:', JSON.stringify({ before: summary.before, after: summary.after, added: summary.added }));
    return { ok: true, summary };
  } catch (e) {
    if (!finished) { try { await releaseWorldLease(lease.token, null); } catch (unlockError) { console.error('V10 restore lock release failed:', unlockError.message); } }
    throw e;
  }
}
async function initRedisAdapter() {
  if (!IS_VERCEL) return;
  if (storage.kind !== 'upstash') throw new Error('請在 Vercel 設定 Upstash Redis REST URL 與 Token。');
  const redisUrl = process.env.UPSTASH_REDIS_URL || process.env.mmo_REDIS_URL;
  if (!redisUrl) {
    console.warn('Upstash TCP Pub/Sub URL 未設定；使用 Socket.IO 本機 adapter，世界存檔仍透過 REST 共用。');
    return;
  }
  const IORedis = require('ioredis');
  const { createAdapter } = require('@socket.io/redis-adapter');
  redisPubClient = new IORedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null, connectTimeout: 8000, retryStrategy: n => Math.min(n * 300, 3000) });
  redisSubClient = redisPubClient.duplicate();
  redisPubClient.on('error', e => console.error('Upstash Redis publisher:', e.message));
  redisSubClient.on('error', e => console.error('Upstash Redis subscriber:', e.message));
  try {
    await Promise.all([redisPubClient.connect(), redisSubClient.connect()]);
    io.adapter(createAdapter(redisPubClient, redisSubClient, { key: 'city-mmo:socket.io' }));
    console.log('Socket.IO Redis adapter connected.');
  } catch (e) {
    console.error('Socket.IO Redis adapter unavailable; using in-memory adapter for this function instance:', e.message);
    try { if (redisPubClient) redisPubClient.disconnect(); } catch {}
    try { if (redisSubClient) redisSubClient.disconnect(); } catch {}
    redisPubClient = null; redisSubClient = null;
  }
}
function tickWorldIfDue(now = Date.now()) {
  const last = Number(world.lastEconomyAt) || 0;
  if (last && now - last < 30000) return false;
  const elapsed = last ? Math.max(1, Math.min(60, (now - last) / 1000)) : 1;
  world.tickEvents(now);
  const changed = world.tickEconomy(now, elapsed);
  world.lastEconomyAt = now;
  for (const ch of changed) io.to(room(ch.cx, ch.cy)).emit('chunk', world.chunkPayload(ch));
  for (const ev of world.drainEvents()) {
    if (ev.type === 'world') { io.emit('worldEvent', withLeft(ev)); if (ev.id) sysChat(`${ev.icon} 全服事件：${ev.name}（${ev.desc}）`); continue; }
    const pl = world.players.get(ev.pid); if (!pl) continue;
    if (ev.type === 'ach') { io.to('p:' + ev.pid).emit('ach', ev); if (ev.reward >= 15000) sysChat(`🏆 ${pl.name} 達成成就「${ev.name}」`); }
    else { io.to('p:' + ev.pid).emit('level', ev); if (ev.lvl > 0) sysChat(`${pl.name} 的城市升級為「${ev.name}」！`); }
  }
  // Redis adapter distributes these emits to players connected to any Vercel instance.
  for (const id of world.players.keys()) sendMe(id);
  return true;
}
async function withWorldTransaction(fn, options = {}) {
  if (!IS_VERCEL) return fn();
  const lease = await acquireWorldLease();
  let released = false;
  try {
    if (lease.worldText) world.fromJSON(JSON.parse(lease.worldText));
    chatLog = world.chatLog;
    // Deserialized tiles intentionally omit derived power/water/road state; rebuild it before game actions.
    world.recompute(Date.now()); world.dirty = false;
    if (options.reloadAccounts) accounts = normalizeAccounts((await storage.loadAccounts()) || {});
    if (options.autoTick !== false) tickWorldIfDue(Date.now());
    const before = lease.worldText || '';
    const value = await fn();
    world.chatLog = chatLog;
    const after = JSON.stringify(world);
    if (options.saveWorld !== false && after !== before) await releaseWorldLease(lease.token, after);
    else await releaseWorldLease(lease.token, null);
    released = true;
    return value;
  } catch (e) {
    if (!released) { try { await releaseWorldLease(lease.token, null); } catch (unlockError) { console.error('world unlock failed:', unlockError.message); } }
    throw e;
  }
}
async function loadWorldForStart() { return loadWorld(); }
let closing = false;
if (!IS_VERCEL) for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    if (closing) return; closing = true;
    await Promise.race([saveNow(), new Promise(r => setTimeout(r, 4000))]);
    process.exit(0);
  });

async function start() {
  if (IS_VERCEL) await initRedisAdapter();
  if (!resetRequested) {
    try { accounts = normalizeAccounts((await storage.loadAccounts()) || {}); }
    catch (e) { console.error('讀取帳號資料失敗：', e.message); if (!IS_VERCEL) process.exit(1); else throw e; }
  }
  await loadWorldForStart();
  if (IS_VERCEL && process.env.V11_AUTO_RESTORE_V10 === '1') {
    const restoreResult = await restoreV10SeedOnce();
    console.log('V10 one-time restore status:', JSON.stringify(restoreResult.summary || { alreadyRestored: true }));
  }
  if (IS_VERCEL) {
    // Vercel functions are instance-based. Each instance shares world state through Upstash and broadcasts through Socket.IO's Redis adapter.
    setInterval(() => { withWorldTransaction(() => ({ ok: true })).catch(e => console.error('scheduled world tick failed:', e.message)); }, 30000);
    setInterval(async () => { try { io.emit('board', await board()); } catch (e) { console.error('board broadcast failed:', e.message); } }, 5000);
    return;
  }
  // Local/Render: keep the original one-second simulation and periodic file/Upstash saves.
  setInterval(() => {
    world.tickEvents();
    const changed = world.tickEconomy();
    for (const ch of changed) io.to(room(ch.cx, ch.cy)).emit('chunk', world.chunkPayload(ch));
    for (const ev of world.drainEvents()) {
      if (ev.type === 'world') { io.emit('worldEvent', withLeft(ev)); if (ev.id) sysChat(`${ev.icon} 全服事件：${ev.name}（${ev.desc}）`); continue; }
      const pl = world.players.get(ev.pid); if (!pl) continue;
      if (ev.type === 'ach') { io.to('p:' + ev.pid).emit('ach', ev); if (ev.reward >= 15000) sysChat(`🏆 ${pl.name} 達成成就「${ev.name}」`); }
      else { io.to('p:' + ev.pid).emit('level', ev); if (ev.lvl > 0) sysChat(`${pl.name} 的城市升級為「${ev.name}」！`); }
    }
    for (const id of world.players.keys()) if (io.sockets.adapter.rooms.has('p:' + id)) sendMe(id);
  }, 1000);
  setInterval(async () => io.emit('board', await board()), 5000);
  let lastSize = 0;
  const loop = async () => { lastSize = (await saveNow()) || lastSize; setTimeout(loop, storage.delayFor(lastSize)); };
  setTimeout(loop, storage.delayFor(0));
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`City MMO on http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || [])
      if (i.family === 'IPv4' && !i.internal) console.log(`  同一個 Wi-Fi 的朋友請開：http://${i.address}:${PORT}`);
  });
}
bootPromise = start().catch(e => { bootError = e; console.error('City MMO startup failed:', e); });
module.exports = server;
