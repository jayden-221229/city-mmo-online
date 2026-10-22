(() => {
'use strict';
const { CHUNK: C, BUILDINGS: B, CATS, EVENTS } = GameData;
const TR = GameTerrain;
const TW = 64, TH = 32;                                   // 等角地磚：64x32 的菱形
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];          // +x -x +y -y（與 MID 順序對應）
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const isoX = (x, y) => (x - y) * TW / 2;
const isoY = (x, y) => (x + y) * TH / 2;
const ERR = { not_owned: '這不是你的領地', occupied: '此處已有建築', money: '資金不足', need_road: '必須緊鄰道路', taken: '已被佔領',
  not_adjacent: '必須與你的領地相鄰', not_bordering: '雙方領地未相鄰', already_linked: '雙方已連接', already_pending: '已送出請求，等待對方審核',
  rate_limit: '操作太快了', no_request: '請求已失效', empty: '這裡沒有東西', bad_request: '無效的操作', not_linked: '你們尚未結盟', locked: '尚未解鎖：需要更高的城市人口',
  water: '水面上不能蓋建築（橋樑除外）', need_water: '橋樑只能蓋在水面上', need_forest: '伐木場必須蓋在森林上', need_ore: '礦場必須蓋在礦脈上', need_shore: '港口必須緊鄰水邊' };
const NEEDS = { water: '只能蓋在水面上', forest: '必須蓋在森林上', ore: '必須蓋在礦脈上', shore: '必須緊鄰水邊' };

// ───────────────── 畫布 / 相機 ─────────────────
const cv = $('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
const resize = () => { dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; };
addEventListener('resize', resize); resize();
const cam = { x: 0, y: 0, z: 1 };                         // (x,y) = 螢幕中心對應的等角世界座標
/** 螢幕座標 → 連續的格子座標（等角投影的反運算） */
const toGrid = (sx, sy) => {
  const ix = (sx - W / 2) / cam.z + cam.x, iy = (sy - H / 2) / cam.z + cam.y;
  const a = iy / (TH / 2), b = ix / (TW / 2);              // a = x+y, b = x-y
  return [(a + b) / 2, (a - b) / 2];
};

// ───────────────── 客戶端世界狀態 ─────────────────
const chunks = new Map();                                 // "cx,cy" → { cx, cy, owner, tiles: Map<idx,{type,f,n}> }
const players = new Map(), links = new Set();
let me = null, stats = { money: 0, claimCost: 0 }, tool = null, hover = null, lastVp = '';
const mouse = { sx: 0, sy: 0 };
const labels = [], pops = [], hooks = [], view = { cx0: 0, cx1: 0, cy0: 0, cy1: 0 };
let nowMs = 0, lastPeak = -1, trafficOverlay = false;
const trafficPressureCache = new Map(); let trafficCacheAt = 0;
const getChunk = (x, y) => chunks.get(Math.floor(x / C) + ',' + Math.floor(y / C));
const ownerAt = (x, y) => { const c = getChunk(x, y); return c && c.owner; };
const getTile = (x, y) => { const c = getChunk(x, y); return c && c.tiles.get(((y % C + C) % C) * C + ((x % C + C) % C)); };
const canCross = (a, b) => !!a && !!b && (a === b || links.has(pair(a, b)));

// ───────────────── 貼圖系統 ─────────────────
// 優先使用 /assets/atlas.json + atlas.png（真實美術）；缺圖時用程序生成的等角方塊補上，遊戲永遠能跑。
// atlas.json 格式：{ "image":"atlas.png", "frames": { "shop": {"x":0,"y":0,"w":64,"h":80}, "road:5": {...} } }
// 錨點規則：貼圖「底邊中央」對齊地磚的下頂點。道路等線型用 "id:鄰接遮罩(0-15)" 當 key（自動拼接）。
const Atlas = { img: null, frames: {} };
const sprites = new Map(), PAD = 8;

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16), k = f < 0 ? 0 : 255, p = Math.abs(f);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.round((k - r) * p + r)},${Math.round((k - g) * p + g)},${Math.round((k - b) * p + b)})`;
};

const makeBlock = CityShapes.makeBlock;                                       // 各建築造型在 shapes.js

/** 程序生成：線型（道路/鐵路/電線/水管），依 4 鄰居遮罩自動接合 */
const MID = [[0.75, 0.75], [0.25, 0.25], [0.25, 0.75], [0.75, 0.25]];       // 各方向的菱形邊中點（比例）
function makeLine(d, mask) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d'), L = d.line, ctr = [TW / 2, TH / 2];
  if (!mask) mask = 3;                                                       // 孤立一格：畫成一小段直線
  const arms = MID.filter((_, i) => mask & (1 << i)).map(m => [m[0] * TW, m[1] * TH]);
  const stroke = (color, w, dash) => {
    g.strokeStyle = g.fillStyle = color; g.lineWidth = w; g.setLineDash(dash || []);
    for (const a of arms) { g.beginPath(); g.moveTo(...ctr); g.lineTo(...a); g.stroke(); }
    g.beginPath(); g.arc(ctr[0], ctr[1], w / 2, 0, 7); g.fill();
  };
  stroke(L.color, L.w);
  if (L.mark) stroke(L.mark, 1.5, [4, 4]);
  if (L.rails) stroke(L.rails, 2);
  return c;
}

function getSprite(d, mask, v) {
  const key = d.line ? d.id + ':' + mask : d.id + '#' + v;
  let s = sprites.get(key);
  if (s) return s;
  const f = Atlas.img && (Atlas.frames[key] || Atlas.frames[d.id]);              // 圖集可只放基本款（id），或每個變體（id#0/1/2）
  if (f) s = { img: Atlas.img, sx: f.x, sy: f.y, w: f.w, h: f.h };
  else { const c = d.line ? makeLine(d, mask) : makeBlock(d, v); s = { img: c, sx: 0, sy: 0, w: c.width, h: c.height, top: c.top, smokes: c.smokes }; }
  sprites.set(key, s);
  return s;
}
function lineMask(x, y, d) {
  let m = 0; const o = ownerAt(x, y);
  DIRS.forEach(([dx, dy], i) => {
    const t = getTile(x + dx, y + dy);
    if (t && B[t.type].conducts === d.conducts && canCross(o, ownerAt(x + dx, y + dy))) m |= 1 << i;
  });
  return m;
}
(async () => {                                                               // 非同步載入美術圖集，失敗就維持程序貼圖
  try {
    const j = await (await fetch('assets/atlas.json')).json();
    const im = new Image(); im.src = 'assets/' + j.image; await im.decode();
    Atlas.img = im; Atlas.frames = j.frames; sprites.clear(); buildPalette();
  } catch (e) { /* no atlas → procedural sprites */ }
})();

// ───────────────── 網路 ─────────────────
// 內嵌頁面（例如 itch.io）可能擋掉 prompt() 或 localStorage，所以用自己的對話框，儲存失敗也不會當掉
const store = {
  ok: true,
  get(k) { try { return localStorage.getItem(k); } catch (e) { this.ok = false; return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { this.ok = false; } },
};
// 音效：用瀏覽器內建的 WebAudio 合成，不需要音檔；瀏覽器要求先有點擊才能出聲，所以第一次播放時才建立
let actx = null, muted = store.get('cm_mute') === '1';
const SFX = { build: [[520, .05, 'square', .04]], err: [[160, .14, 'sawtooth', .05]], bulldoze: [[220, .09, 'triangle', .06]],
  coin: [[880, .06, 'sine', .05], [1320, .12, 'sine', .05]], level: [[523, .1], [659, .1], [784, .1], [1047, .28]], ach: [[784, .1], [988, .1], [1319, .3]] };
function sfx(kind) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const [f, d, type = 'sine', v = 0.06] of SFX[kind] || []) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d); t += d * 0.9;
    }
  } catch (e) { /* 沒有音訊裝置就算了 */ }
}
function ask(title, def) {
  return new Promise(res => {
    const box = $('dlg'), inp = $('dlgIn');
    $('dlgTitle').textContent = title; inp.value = def || ''; box.style.display = 'block'; inp.focus();
    const done = v => { box.style.display = 'none'; $('dlgOk').onclick = null; inp.onkeydown = null; res(v); };
    $('dlgOk').onclick = () => done(inp.value);
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value); else if (e.key === 'Escape') done(null); };
  });
}
let token = store.get('cm_auth_token');
let myName = store.get('cm_auth_name') || '';
let authReady = !!token;
const authScreen = $('authScreen');
if (authReady) authScreen.style.display = 'none';
function setAuthError(message) { $('authError').textContent = message || ''; }
async function authRequest(mode) {
  const username = $('authUsername').value.trim(), password = $('authPassword').value;
  setAuthError('');
  if (!/^[a-zA-Z0-9_-]{3,16}$/.test(username)) return setAuthError('帳號需為 3–16 個英文字母、數字、底線或連字號。');
  if (password.length < 8) return setAuthError('密碼至少需要 8 個字元。');
  $('loginBtn').disabled = $('registerBtn').disabled = true;
  try {
    const apiBase = String(window.GAME_SERVER || '').replace(/\/+$/, '');
    const response = await fetch(apiBase + '/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '驗證失敗');
    token = data.token; myName = data.username; authReady = true;
    store.set('cm_auth_token', token); store.set('cm_auth_name', myName);
    authScreen.style.display = 'none';
    if (socket.connected) connectGame();
  } catch (e) { setAuthError(e.message || '無法連線，請稍後再試。'); }
  finally { $('loginBtn').disabled = $('registerBtn').disabled = false; }
}
$('authCard').addEventListener('submit', e => { e.preventDefault(); authRequest('login'); });
$('registerBtn').addEventListener('click', () => authRequest('register'));
const socket = window.GAME_SERVER ? io(window.GAME_SERVER, { transports: ['websocket', 'polling'] }) : io();
function connectGame() {
  if (!authReady || !token) return;
  $('net').style.display = 'none';
  chunks.clear(); lastVp = '';
  socket.emit('hello', { token, name: myName }, res => {
    if (!res || !res.you) { setAuthError('無法載入玩家資料，請重新登入。'); return; }
    me = res.you; players.set(me.id, me);
    links.clear(); res.links.forEach(l => links.add(l));
    setWorldEvent(res.event, true);
    $('diplo').innerHTML = '';
    (res.incoming || []).forEach(r => addRequest(r.from, r.fromName));
    if (window.CityGame && typeof window.CityGame.diplomacyInit === 'function') {
      window.CityGame.diplomacyInit(res.incoming || [], res.outgoing || []);
    }
    cam.x = isoX(res.home.cx * C + C / 2, res.home.cy * C + C / 2);
    cam.y = isoY(res.home.cx * C + C / 2, res.home.cy * C + C / 2);
  });
}
socket.on('connect', () => {
  if (authReady) connectGame();
  else { $('net').style.display = 'none'; authScreen.style.display = 'flex'; }
});
socket.on('chunk', p => {
  trafficPressureCache.clear(); trafficCacheAt = 0;
  if (p.ownerInfo) players.set(p.ownerInfo.id, p.ownerInfo);
  const prev = chunks.get(p.cx + ',' + p.cy);                                     // 保留建造動畫的起始時間
  chunks.set(p.cx + ',' + p.cy, { cx: p.cx, cy: p.cy, owner: p.owner, tiles: new Map(p.tiles.map(([i, type, f, n]) => {
    const o = prev && prev.tiles.get(i); return [i, { type, f, n, born: o && o.type === type ? o.born : 0 }];
  })) });
});
function applyTile(p) {
  trafficPressureCache.clear(); trafficCacheAt = 0;
  const ch = getChunk(p.x, p.y); if (!ch) return;
  const i = ((p.y % C + C) % C) * C + ((p.x % C + C) % C);
  if (p.type) ch.tiles.set(i, { type: p.type, f: p.f, n: p.n, born: nowMs }); else ch.tiles.delete(i);
}
socket.on('tile', applyTile);
socket.on('tiles', list => list.forEach(applyTile));                       // 批量建造 / 拆除：一次一批
socket.on('me', s => {
  stats = s;
  $('money').textContent = '$' + s.money.toLocaleString();
  const r = $('rate'); r.textContent = (s.rate >= 0 ? '+' : '') + s.rate; r.parentElement.className = 'rate ' + (s.rate < 0 ? 'neg' : 'pos');
  $('pop').textContent = s.pop.toLocaleString(); $('happy').textContent = s.happiness; $('chunks').textContent = s.chunks;
  $('level').textContent = s.levelName + (s.nextAt != null ? ` ${s.peakPop}/${s.nextAt}` : '（最高）');
  if (s.peakPop !== lastPeak) { lastPeak = s.peakPop; showTab(curTab); }                  // 人口變動 → 重新整理建築的鎖定狀態
  $('employ').textContent = s.employ + '%'; $('power').textContent = s.power.use + '/' + s.power.cap; $('water').textContent = s.water.use + '/' + s.water.cap;
  const tc = clamp(Math.round(s.traffic || 0), 0, 100);
  $('traffic').textContent = (tc < 10 ? '順暢' : tc < 35 ? '繁忙' : tc < 65 ? '壅塞' : '嚴重壅塞') + ' ' + tc + '%';
  $('traffic').title = `道路負載 ${Math.round(s.trafficLoad || 0)}%｜道路 ${Math.round(s.roadTiles || 0)} 格｜壅塞會影響幸福度、商業營收與入住速度`;
  markPoor();
});
socket.on('diplo:incoming', r => { addRequest(r.from, r.fromName); toast(r.fromName + ' 想與你結盟'); });
socket.on('diplo:cancelled', r => {
  const node = [...$('diplo').querySelectorAll('.req')].find(el => el.dataset.from === String(r.from));
  if (node) node.remove();
  toast((r.fromName || '對方') + ' 撤回了結盟邀請');
});
socket.on('disconnect', () => { $('net').style.display = 'block'; });
socket.on('connect_error', () => { $('net').style.display = 'block'; });
let worldEvent = null;                                                      // 目前的全服事件 { id, icon, name, desc, good, until }
function setWorldEvent(ev, quiet) {
  worldEvent = ev && ev.id ? { ...ev, until: Date.now() + (ev.left != null ? ev.left : 90000) } : null;
  updateEventBar();
  if (worldEvent && !quiet) { toast(`${ev.icon} 全服事件：${ev.name}　${ev.desc}`, !ev.good, 7000); sfx(ev.good ? 'ach' : 'err'); }
}
function updateEventBar() {
  const bar = $('eventBar');
  if (!worldEvent || Date.now() >= worldEvent.until) { worldEvent = null; bar.style.display = 'none'; return; }
  const s = Math.ceil((worldEvent.until - Date.now()) / 1000);
  bar.textContent = `${worldEvent.icon} ${worldEvent.name}　${worldEvent.desc}　剩餘 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  bar.className = worldEvent.good ? 'good' : 'bad'; bar.style.display = 'block';
}
socket.on('worldEvent', ev => setWorldEvent(ev));
setInterval(updateEventBar, 500);
socket.on('online', n => { $('online').textContent = n; });
socket.on('diplo:linked', ({ a, b }) => { links.add(pair(a, b)); toast('結盟成功：道路互通，剩餘水電共享'); });
socket.on('diplo:unlinked', ({ a, b }) => { links.delete(pair(a, b)); toast('結盟已解除'); });
socket.on('diplo:denied', r => toast(r.by + ' 拒絕了連接請求', true));

function syncViewport(x0, y0, x1, y1) {                                      // 視野改變才回報（以 chunk 為單位）
  const k = [x0, y0, x1, y1].join();
  if (k !== lastVp && socket.connected) { lastVp = k; socket.emit('viewport', { x0, y0, x1, y1 }); }
}

// ───────────────── 車流 ─────────────────
const cars = [], CAR_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#2ecc71', '#9b59b6'];
const isRoad = (x, y) => { const t = getTile(x, y); return !!t && B[t.type].conducts === 'road'; };
function roadNeighborCount(x, y) {
  const owner = ownerAt(x, y);
  return DIRS.reduce((n, [dx, dy]) => n + (isRoad(x + dx, y + dy) && canCross(owner, ownerAt(x + dx, y + dy)) ? 1 : 0), 0);
}
function signalGreen(x, y) {
  const offset = ((Math.abs(x * 3 + y * 7) % 7) * 180);
  return Math.floor((nowMs + offset) / 2400) % 2 === 0;
}
function drawTrafficSignals(roads) {
  if (cam.z < 0.42) return;
  for (const r of roads) {
    if (roadNeighborCount(r.x, r.y) < 3) continue;
    const x = isoX(r.x + 0.5, r.y + 0.5) + 13, y = isoY(r.x + 0.5, r.y + 0.5);
    const green = signalGreen(r.x, r.y);
    ctx.strokeStyle = '#4f5a61'; ctx.lineWidth = 2 / cam.z;
    ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y - 15); ctx.stroke();
    ctx.fillStyle = '#263640'; ctx.fillRect(x - 4, y - 23, 8, 12);
    ctx.fillStyle = green ? '#713d43' : '#ff4d5d'; ctx.beginPath(); ctx.arc(x, y - 19, 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = green ? '#39e4a5' : '#315f52'; ctx.beginPath(); ctx.arc(x, y - 14, 2.1, 0, Math.PI * 2); ctx.fill();
  }
}

function updateCars(dt, roads, gx0, gx1, gy0, gy1) {
  while (roads.length && cars.length < Math.min(70, roads.length / 3)) {
    const r = roads[(Math.random() * roads.length) | 0];
    const roll = Math.random(), kind = (stats.goods || 0) > 2 && roll < 0.16 ? 'truck' : (stats.transitCapacity || 0) >= 12 && roll < 0.40 ? 'bus' : 'car';
    const palette = kind === 'bus' ? ['#21b6a8', '#f4c95d'] : kind === 'truck' ? ['#e99c4b', '#d65d4d', '#6c8ebf'] : CAR_COLORS;
    cars.push({ fx: r.x, fy: r.y, tx: r.x, ty: r.y, t: 1, kind, sp: kind === 'bus' ? 0.8 + Math.random() * 0.35 : kind === 'truck' ? 0.65 + Math.random() * 0.4 : 1.1 + Math.random() * 0.8, c: palette[(Math.random() * palette.length) | 0] });
  }
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i]; c.t += dt * c.sp * (1 - clamp((stats.traffic || 0) / 100, 0, 1) * 0.62);
    if (c.t < 1) continue;
    const cx = c.tx, cy = c.ty;
    // 三岔路口與十字路口有交替號誌，紅燈時車輛會在停止線前等待。
    if (roadNeighborCount(cx, cy) >= 3 && !signalGreen(cx, cy)) { c.t = 0.9; continue; }
    c.t = 0;
    const o = ownerAt(cx, cy);
    let opts = DIRS.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => isRoad(x, y) && canCross(o, ownerAt(x, y)));
    const fwd = opts.filter(([x, y]) => !(x === c.fx && y === c.fy));       // 盡量不迴轉
    if (fwd.length) opts = fwd;
    if (!isRoad(cx, cy) || !opts.length || cx < gx0 || cx > gx1 || cy < gy0 || cy > gy1) { cars.splice(i, 1); continue; }
    const [nx, ny] = opts[(Math.random() * opts.length) | 0];
    c.fx = cx; c.fy = cy; c.tx = nx; c.ty = ny;
  }
}
function drawCar(o) {
  const x = o.x + 0.5, y = o.y + 0.5, ix = isoX(x, y), iy = isoY(x, y), kind = o.car.kind || 'car';
  const w = kind === 'bus' ? 13 : kind === 'truck' ? 12 : 8, h = kind === 'car' ? 5 : 6;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(ix - w / 2 - 1, iy - 1, w + 2, 4);
  if (kind === 'truck') { ctx.fillStyle = '#d9e0e5'; ctx.fillRect(ix - 6, iy - 5, 7, 5); ctx.fillStyle = o.car.c; ctx.fillRect(ix + 1, iy - 4, 5, 4); ctx.fillStyle = '#d8f0f7'; ctx.fillRect(ix + 2, iy - 4, 2, 2); }
  else { ctx.fillStyle = o.car.c; ctx.fillRect(ix - w / 2, iy - h, w, h); ctx.fillStyle = kind === 'bus' ? '#d7f5f2' : 'rgba(255,255,255,.72)'; ctx.fillRect(ix - w / 2 + 2, iy - h + 1, w - 4, 2); if (kind === 'bus') { ctx.fillStyle = '#164f5a'; ctx.fillRect(ix - w / 2 + 2, iy - h + 4, w - 4, 1); } }
}

// 交通熱區：依道路周圍建築的人口、工作、商業人流及貨運需求著色。
// 整座城市的壅塞數值由伺服器計算；熱區只負責顯示局部道路壓力。
const ROAD_CLASS_CAP = { road: 1, oneway: 1.3, highway: 2.8, bridge: 0.9 };
function localTrafficPressure(x, y) {
  let pressure = 0;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const dist = Math.abs(dx) + Math.abs(dy);
    if (!dist || dist > 4) continue;
    const t = getTile(x + dx, y + dy); if (!t) continue;
    const d = B[t.type]; if (!d) continue;
    const near = 1 - dist / 5;
    if (d.id === 'bus_station') { pressure -= 2.5 * near; continue; }
    if (d.id === 'bus_terminal' || d.id === 'subway') { pressure -= 5 * near; continue; }
    if (d.line || d.conducts) continue;
    const needPenalty = t.n && t.f !== t.n ? 0.35 : 1;
    const load = (d.pop || 0) * 0.055 + (d.jobs || 0) * 0.03 + (d.demand || 0) * 0.04 + (d.goods || 0) * 0.45;
    pressure += load * near * needPenalty;
  }
  return Math.max(0, pressure);
}
function drawTrafficOverlay(roads) {
  if (!trafficOverlay) return;
  // 熱區每半秒更新，避免每個動畫影格都重新掃描道路周圍。
  if (nowMs - trafficCacheAt > 500) { trafficPressureCache.clear(); trafficCacheAt = nowMs; }
  ctx.save(); ctx.globalAlpha = 0.48;
  for (const r of roads) {
    const tile = getTile(r.x, r.y), d = tile && B[tile.type];
    if (!d || d.conducts !== 'road') continue;
    const key = r.x + ',' + r.y;
    if (!trafficPressureCache.has(key)) trafficPressureCache.set(key, localTrafficPressure(r.x, r.y) / (6 * (ROAD_CLASS_CAP[d.id] || 1)));
    const pressure = trafficPressureCache.get(key);
    const color = pressure < 0.3 ? '#22d3a6' : pressure < 0.65 ? '#f4d35e' : pressure < 1.05 ? '#ff9f43' : '#ff4d5d';
    const x = isoX(r.x + 0.5, r.y + 0.5), y = isoY(r.x + 0.5, r.y + 0.5);
    ctx.beginPath(); ctx.moveTo(x, y - TH / 2); ctx.lineTo(x + TW / 2, y); ctx.lineTo(x, y + TH / 2); ctx.lineTo(x - TW / 2, y); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1 / cam.z; ctx.stroke();
  }
  ctx.restore();
}

// ───────────────── 繪製 ─────────────────
function chunkPath(cx, cy) {
  const x0 = cx * C, y0 = cy * C, x1 = x0 + C, y1 = y0 + C;
  ctx.beginPath(); ctx.moveTo(isoX(x0, y0), isoY(x0, y0)); ctx.lineTo(isoX(x1, y0), isoY(x1, y0));
  ctx.lineTo(isoX(x1, y1), isoY(x1, y1)); ctx.lineTo(isoX(x0, y1), isoY(x0, y1)); ctx.closePath();
}
const claimable = (cx, cy) => me && !chunks.has(cx + ',' + cy) && DIRS.some(([dx, dy]) => { const n = chunks.get((cx + dx) + ',' + (cy + dy)); return n && n.owner === me.id; });

function drawGround(cx, cy, ch) {
  chunkPath(cx, cy);
  ctx.fillStyle = ch ? grass() || '#5b8a52' : '#15232b'; ctx.fill();
  if (ch) { ctx.globalAlpha = 0.2; ctx.fillStyle = (players.get(ch.owner) || {}).color || '#fff'; ctx.fill(); ctx.globalAlpha = 1; }
  if (ch && cam.z >= 0.6) {                                                  // 放大時才畫格線
    const x0 = cx * C, y0 = cy * C;
    ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1 / cam.z; ctx.beginPath();
    for (let i = 1; i < C; i++) {
      ctx.moveTo(isoX(x0 + i, y0), isoY(x0 + i, y0)); ctx.lineTo(isoX(x0 + i, y0 + C), isoY(x0 + i, y0 + C));
      ctx.moveTo(isoX(x0, y0 + i), isoY(x0, y0 + i)); ctx.lineTo(isoX(x0 + C, y0 + i), isoY(x0 + C, y0 + i));
    }
    ctx.stroke();
  }
  chunkPath(cx, cy);                                                         // 重建外框路徑（上面的格線會弄髒目前路徑）
  const mine = ch && me && ch.owner === me.id;
  ctx.lineWidth = (mine ? 3 : 2) / cam.z; ctx.strokeStyle = mine ? '#ffd27a' : ch ? 'rgba(255,255,255,.55)' : 'rgba(120,150,165,.25)'; ctx.stroke();
  if (tool && tool.kind === 'claim' && claimable(cx, cy)) { ctx.setLineDash([14, 9]); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 3 / cam.z; ctx.stroke(); ctx.setLineDash([]); }
  if (ch && cam.z < 0.9) {
    const nm = (players.get(ch.owner) || {}).name;
    if (nm) labels.push({ nm, x: isoX(cx * C + C / 2, cy * C + C / 2), y: isoY(cx * C + C / 2, cy * C + C / 2) });
  }
}

const variantOf = (x, y) => Math.abs(x * 7 + y * 13) % 3;
function smoke(x, y) {                                                            // 煙囪冒煙：純時間函數，不需要保存狀態
  for (let k = 0; k < 3; k++) {
    const p = ((nowMs / 2200) + k / 3) % 1;
    ctx.globalAlpha = 0.45 * (1 - p); ctx.fillStyle = '#e4e4e4';
    ctx.beginPath(); ctx.arc(x + p * 12, y - p * 26, 3 + p * 5, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function blit(o) {
  const s = getSprite(o.d, o.d.line ? lineMask(o.x, o.y, o.d) : 0, variantOf(o.x, o.y));
  const ix = isoX(o.x, o.y), iy = isoY(o.x, o.y);
  const age = o.t.born ? Math.min(1, (nowMs - o.t.born) / 380) : 1;               // 新建築：從地下「長」出來
  const rise = (1 - age) * 14;
  if (age < 1) ctx.globalAlpha = 0.25 + 0.75 * age;
  ctx.drawImage(s.img, s.sx, s.sy, s.w, s.h, ix - s.w / 2, iy + TH - s.h + rise, s.w, s.h);
  ctx.globalAlpha = 1;
  if (s.smokes && cam.z > 0.5) for (const [sx, sy] of s.smokes) smoke(ix - s.w / 2 + sx, iy + TH - s.h + sy);
  if (o.t.n && cam.z > 0.45) {                                                    // 狀態燈：綠 = 道路/電/水齊全；紅燈閃爍
    const ok = o.t.f === o.t.n;
    ctx.beginPath(); ctx.arc(ix, (s.top != null ? iy + TH / 2 - s.top - 9 : iy + TH - s.h + PAD - 3) + rise, 3.5, 0, 7);
    ctx.fillStyle = ok ? '#3cff7a' : (Math.floor(nowMs / 450) % 2 ? '#ff4d4d' : '#9c2a2a'); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
  }
}
let grassPat = null;
function grass() {                                                                // 草地：與地磚對齊的雙色菱形圖樣，隨世界座標重複
  if (grassPat) return grassPat;
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d');
  g.fillStyle = '#5b8a52'; g.fillRect(0, 0, TW, TH); g.fillStyle = '#548250';
  for (const y of [0, TH]) { g.beginPath(); g.moveTo(TW / 2, y - TH / 2); g.lineTo(TW, y); g.lineTo(TW / 2, y + TH / 2); g.lineTo(0, y); g.closePath(); g.fill(); }
  grassPat = ctx.createPattern(c, 'repeat'); return grassPat;
}
function drawPops() {                                                             // 浮動文字：-$建造費、+$拆除退款…
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i], a = (nowMs - p.t0) / 1100;
    if (a >= 1) { pops.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - a; ctx.font = `bold ${Math.round(14 / Math.max(cam.z, 0.6))}px sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.fillStyle = p.color;
    const x = isoX(p.x, p.y), y = isoY(p.x, p.y) - 20 - a * 30;
    ctx.strokeText(p.text, x, y); ctx.fillText(p.text, x, y);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
}
function drawLabels() {                                                           // 拉遠時顯示領地主人名稱
  ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
  ctx.font = `bold ${Math.round(Math.max(22, 13 / cam.z))}px sans-serif`;
  for (const l of labels) { ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.fillStyle = '#fff'; ctx.strokeText(l.nm, l.x, l.y); ctx.fillText(l.nm, l.x, l.y); }
  ctx.textAlign = 'start';
}
function diamond(x, y, fill) {
  ctx.beginPath(); ctx.moveTo(isoX(x, y), isoY(x, y)); ctx.lineTo(isoX(x + 1, y), isoY(x + 1, y));
  ctx.lineTo(isoX(x + 1, y + 1), isoY(x + 1, y + 1)); ctx.lineTo(isoX(x, y + 1), isoY(x, y + 1)); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

// ───────────── 地形 ─────────────
const terrCache = new Map();
function terrainList(cx, cy) {                                              // 這個 chunk 裡「不是平地」的格子（算一次就快取）
  const k = cx + ',' + cy; let l = terrCache.get(k);
  if (!l) {
    l = [];
    for (let i = 0; i < C * C; i++) { const x = cx * C + (i % C), y = cy * C + Math.floor(i / C), t = TR.terrainAt(x, y); if (t) l.push([x, y, t, i]); }
    terrCache.set(k, l);
  }
  return l;
}
function diamondsPath(list) {                                               // list = [x0,y0,x1,y1,…]，全部畫成同一條路徑 → 一次填色
  ctx.beginPath();
  for (let k = 0; k < list.length; k += 2) {
    const x = list[k], y = list[k + 1];
    ctx.moveTo(isoX(x, y), isoY(x, y)); ctx.lineTo(isoX(x + 1, y), isoY(x + 1, y)); ctx.lineTo(isoX(x + 1, y + 1), isoY(x + 1, y + 1)); ctx.lineTo(isoX(x, y + 1), isoY(x, y + 1)); ctx.closePath();
  }
}
const treeSprites = [];
function treeSprite(v) {
  if (treeSprites[v]) return treeSprites[v];
  const c = document.createElement('canvas'); c.width = 40; c.height = 44;
  const g = c.getContext('2d');
  const trees = [[[20, 30, 9], [11, 27, 7], [29, 28, 7]], [[20, 29, 10], [30, 32, 6]], [[14, 31, 8], [26, 29, 9], [20, 23, 6]]][v];
  for (const [x, y, r] of [...trees].sort((a, b) => a[1] - b[1])) {
    g.fillStyle = '#5a3b1e'; g.fillRect(x - 1, y, 2.4, 7);
    g.fillStyle = '#2b7a39'; g.beginPath(); g.arc(x, y - 1, r, 0, 7); g.fill();
    g.fillStyle = '#3f9650'; g.beginPath(); g.arc(x - r * 0.25, y - 1 - r * 0.3, r * 0.65, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(x - r * 0.4, y - 1 - r * 0.45, r * 0.3, 0, 7); g.fill();
  }
  return (treeSprites[v] = c);
}
function drawTree(o) {
  const ix = isoX(o.x + 0.5, o.y + 0.5), iy = isoY(o.x + 0.5, o.y + 0.5);
  ctx.drawImage(treeSprite(Math.abs(o.x * 5 + o.y * 11) % 3), ix - 20, iy - 36);
}
function drawTerrain(water, ore, forest, solid) {
  if (water.length) {                                                       // 水面：藍色 + 緩慢閃動的亮光
    diamondsPath(water); ctx.fillStyle = '#2f77b5'; ctx.fill(); ctx.lineWidth = 1 / cam.z; ctx.strokeStyle = '#2f77b5'; ctx.stroke();
    ctx.globalAlpha = 0.1 + 0.07 * Math.sin(nowMs / 800); ctx.fillStyle = '#bfe6ff'; ctx.fill(); ctx.globalAlpha = 1;
  }
  if (ore.length) {                                                         // 礦脈：灰色岩石 + 亮點
    diamondsPath(ore); ctx.fillStyle = '#676b74'; ctx.fill(); ctx.lineWidth = 1 / cam.z; ctx.strokeStyle = '#676b74'; ctx.stroke();
    if (cam.z > 0.6) { ctx.fillStyle = '#d6dbe3'; for (let k = 0; k < ore.length; k += 2) { const x = ore[k], y = ore[k + 1]; ctx.fillRect(isoX(x + 0.3, y + 0.5), isoY(x + 0.3, y + 0.5), 2.5, 2.5); ctx.fillRect(isoX(x + 0.7, y + 0.8), isoY(x + 0.7, y + 0.8) - 5, 2, 2); } }
  }
  if (forest.length) {
    if (cam.z < 0.55) { diamondsPath(forest); ctx.fillStyle = '#3a7a42'; ctx.fill(); }                 // 拉遠：只畫綠色地塊
    else for (let k = 0; k < forest.length; k += 2) solid.push({ x: forest[k], y: forest[k + 1], tree: true });
  }
}

// ───────────── 日夜、下雨 ─────────────
const DAY_MS = 10 * 60 * 1000;                                              // 一個晝夜 10 分鐘（用現實時間算：所有玩家看到同樣的天色）
const nightLevel = () => Math.pow((1 - Math.cos(((Date.now() % DAY_MS) / DAY_MS) * 2 * Math.PI)) / 2, 1.3);
let glowImg = null;
function glow() {
  if (glowImg) return glowImg;
  glowImg = document.createElement('canvas'); glowImg.width = glowImg.height = 64;
  const g = glowImg.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,214,140,.55)'); gr.addColorStop(1, 'rgba(255,214,140,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return glowImg;
}
function drawDayNight(solid) {
  const n = nightLevel(), rain = !!worldEvent && worldEvent.id === 'rain';
  if (n < 0.03 && !rain) return;
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = `rgba(8,16,52,${0.5 * n + (rain ? 0.12 : 0)})`; ctx.fillRect(0, 0, W, H);          // 夜色 / 烏雲
  if (rain) {
    ctx.strokeStyle = 'rgba(190,215,255,.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 140; i++) { const x = ((i * 97 + nowMs * 0.12) % (W + 40)) - 20, y = ((i * 53 + nowMs * 0.9) % (H + 40)) - 20; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 11); }
    ctx.stroke();
  }
  ctx.restore();
  if (n > 0.25 && cam.z > 0.4) {                                            // 夜裡每棟建築亮起暖色燈光
    ctx.globalAlpha = Math.min(1, (n - 0.2) * 1.3);
    for (const s of solid) if (s.d && !s.d.line) ctx.drawImage(glow(), isoX(s.x + 0.5, s.y + 0.5) - 26, isoY(s.x + 0.5, s.y + 0.5) - 26 - (s.d.h || 20) * 0.4, 52, 52);
    ctx.globalAlpha = 1;
  }
}

// ───────────── 批量框選的預覽 ─────────────
function drawSelection() {
  if (!sel || !me) return;
  const good = [], bad = [], isBuild = tool && tool.kind === 'build', d = isBuild ? B[tool.type] : null;
  for (const [x, y] of sel.tiles.values()) {
    const ch = getChunk(x, y), mine = ch && ch.owner === me.id;
    const ok = mine && (isBuild ? !getTile(x, y) && !TR.placeError(d, x, y) : !!getTile(x, y));
    (ok ? good : bad).push(x, y);
  }
  if (good.length) { diamondsPath(good); ctx.fillStyle = 'rgba(60,255,122,.42)'; ctx.fill(); }
  if (bad.length) { diamondsPath(bad); ctx.fillStyle = 'rgba(255,77,77,.42)'; ctx.fill(); }
}

function draw(dt) {
  const z = cam.z;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
  ctx.imageSmoothingEnabled = false;                                         // 像素風貼圖不糊邊
  // 視野裁剪：螢幕四角反投影 → 格子範圍（+6 邊界，高樓會往上突出）
  const cs = [[0, 0], [W, 0], [0, H], [W, H]].map(p => toGrid(p[0], p[1]));
  const gx0 = Math.floor(Math.min(...cs.map(c => c[0]))) - 6, gx1 = Math.ceil(Math.max(...cs.map(c => c[0]))) + 6;
  const gy0 = Math.floor(Math.min(...cs.map(c => c[1]))) - 6, gy1 = Math.ceil(Math.max(...cs.map(c => c[1]))) + 6;
  const cx0 = Math.floor(gx0 / C), cx1 = Math.floor(gx1 / C), cy0 = Math.floor(gy0 / C), cy1 = Math.floor(gy1 / C);
  syncViewport(cx0 - 1, cy0 - 1, cx1 + 1, cy1 + 1);

  Object.assign(view, { cx0, cx1, cy0, cy1 }); labels.length = 0;
  const flat = [], solid = [], roads = [], water = [], ore = [], forest = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ch = chunks.get(cx + ',' + cy);
    drawGround(cx, cy, ch);
    if (!ch) continue;
    for (const [x, y, t, i] of terrainList(cx, cy)) {                                  // 已佔領的區域才看得到地形
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) continue;
      if (t === TR.WATER) water.push(x, y);
      else if (ch.tiles.has(i)) continue;                                             // 蓋了建築的格子不畫樹 / 礦石
      else if (t === TR.FOREST) forest.push(x, y);
      else ore.push(x, y);
    }
    for (const [i, t] of ch.tiles) {
      const x = cx * C + (i % C), y = cy * C + Math.floor(i / C);
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) continue;
      const d = B[t.type]; if (!d) continue;
      (d.line ? flat : solid).push({ x, y, t, d });
      if (d.conducts === 'road') roads.push({ x, y });
    }
  }
  drawTerrain(water, ore, forest, solid);
  for (const f of flat) blit(f);                                             // 先畫貼地的道路/管線
  drawTrafficOverlay(roads);
  updateCars(dt, roads, gx0, gx1, gy0, gy1);
  for (const car of cars) solid.push({ x: car.fx + (car.tx - car.fx) * car.t, y: car.fy + (car.ty - car.fy) * car.t, car, depth: 0.5 });
  solid.sort((a, b) => (a.x + a.y + (a.depth || 0)) - (b.x + b.y + (b.depth || 0)));   // 畫家演算法：由後往前
  for (const s of solid) (s.car ? drawCar(s) : s.tree ? drawTree(s) : blit(s));
  drawTrafficSignals(roads);
  drawSelection();
  drawDayNight(solid);
  drawLabels(); drawPops();

  if (hover && me) {                                                         // 滑鼠高亮
    if (tool && ['claim', 'diplo', 'unlink', 'gift'].includes(tool.kind)) {
      chunkPath(hover.cx, hover.cy); ctx.lineWidth = 4 / z; ctx.strokeStyle = '#ffd27a'; ctx.stroke();
    } else {
      const ch = chunks.get(hover.cx + ',' + hover.cy), free = ch && ch.owner === me.id && !getTile(hover.x, hover.y) && !(tool && tool.kind === 'build' && TR.placeError(B[tool.type], hover.x, hover.y));
      diamond(hover.x, hover.y, !tool ? 'rgba(255,255,255,.22)' : (tool.kind === 'bulldoze' ? !free && ch && ch.owner === me.id : free) ? 'rgba(60,255,122,.38)' : 'rgba(255,77,77,.38)');
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0e1a21'; ctx.fillRect(0, 0, cv.width, cv.height);
  nowMs = now;
  if (me) draw(dt);
  for (const f of hooks) f(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ───────────────── 輸入：拖曳平移 / 滾輪縮放 / 點擊 ─────────────────
const tip = $('tip');
function describe(t) {
  const f = [[1, '道路', '缺少道路'], [2, '電力', '電力不足'], [4, '水', '水不足']].filter(([b]) => t.n & b).map(([b, n, bad]) => (t.f & b ? n + '✓' : bad)).join('　');
  return B[t.type].name + (f ? '　' + f : '');
}
function updateHover() {
  const [gx, gy] = toGrid(mouse.sx, mouse.sy), x = Math.floor(gx), y = Math.floor(gy);
  hover = { x, y, cx: Math.floor(x / C), cy: Math.floor(y / C) };
  const t = getTile(x, y), ch = chunks.get(hover.cx + ',' + hover.cy);
  let msg = '';
  if (sel) msg = `${sel.tiles.size} 格${tool.kind === 'build' ? ` · 約 $${(sel.tiles.size * B[tool.type].cost).toLocaleString()}` : ''}${sel.tiles.size >= SEL_MAX ? '（已達上限 400 格）' : ''}`;
  else if (tool && tool.kind === 'claim') msg = ch ? '' : (claimable(hover.cx, hover.cy) ? `佔領此區域　$${stats.claimCost}` : '必須與你的領地相鄰');
  else if (tool && tool.kind === 'diplo') msg = ch && ch.owner !== me.id ? `向 ${(players.get(ch.owner) || {}).name} 發送結盟請求` : '';
  else if (tool && tool.kind === 'gift') msg = ch && ch.owner !== me.id ? `贈送資金給 ${(players.get(ch.owner) || {}).name}（需已結盟）` : '';
  else if (tool && tool.kind === 'unlink') msg = ch && ch.owner !== me.id ? `解除與 ${(players.get(ch.owner) || {}).name} 的結盟` : '';
  else if (tool && tool.kind === 'build') {
    const d = B[tool.type], err = TR.placeError(d, x, y), fee = TR.clearFee(d, x, y);
    msg = err ? ERR[err] : `${d.name}　$${d.cost + fee}${fee ? `（含森林整地費 $${fee}）` : ''}　Shift 拖曳連續鋪、Ctrl 拖曳框選`;
  }
  else if (t) msg = describe(t);
  else if (ch) msg = '領地：' + ((players.get(ch.owner) || {}).name || '') + ' · ' + TR.NAMES[TR.terrainAt(x, y)] + (me && ch.owner !== me.id && links.has(pair(me.id, ch.owner)) ? '（盟友）' : '');
  tip.textContent = msg; tip.style.display = msg ? 'block' : 'none';
  tip.style.left = mouse.sx + 14 + 'px'; tip.style.top = mouse.sy + 14 + 'px';
}

function act(x, y) {
  const cx = Math.floor(x / C), cy = Math.floor(y / C), ch = chunks.get(cx + ',' + cy);
  const cb = r => { if (r && r.err) { toast(ERR[r.err] || r.err, true); sfx('err'); } };
  if (!tool) { const t = getTile(x, y); if (t) showInfo(t); else hideInfo(); return; }
  if (tool.kind === 'build') {
    const type = tool.type;
    socket.emit('build', { x, y, type }, r => { cb(r); if (r && r.ok) { sfx('build'); pops.push({ x: x + 0.5, y: y + 0.5, text: '-$' + B[type].cost, color: '#ffb4a8', t0: nowMs }); } });
  }
  else if (tool.kind === 'bulldoze') {
    const t = getTile(x, y);
    socket.emit('bulldoze', { x, y }, r => { cb(r); if (r && r.ok && t) sfx('bulldoze'); if (r && r.ok && t) pops.push({ x: x + 0.5, y: y + 0.5, text: '+$' + Math.floor(B[t.type].cost / 2), color: '#b6ffb0', t0: nowMs }); });
  }
  else if (tool.kind === 'claim') {
    socket.emit('claim', { cx, cy }, r => { cb(r); if (r && r.ok) { sfx('coin'); pops.push({ x: cx * C + C / 2, y: cy * C + C / 2, text: '領地擴張！', color: '#ffd27a', t0: nowMs }); } });
  }
  else if (tool.kind === 'gift') {
    if (ch && ch.owner !== me.id) {
      const nm = (players.get(ch.owner) || {}).name || '盟友';
      ask('要贈送多少資金給 ' + nm + '？（最少 10）', '500').then(v => {
        const amt = parseInt(v, 10), to = ch.owner;
        if (amt >= 10) socket.emit('gift', { to, amount: amt }, r => { cb(r); if (r && r.ok) pops.push({ x: cx * C + C / 2, y: cy * C + C / 2, text: '-$' + amt, color: '#ffb4a8', t0: nowMs }); });
      });
    } else toast('請點選盟友的領地', true);
  }
  else if (tool.kind === 'unlink') {
    if (ch && ch.owner !== me.id) socket.emit('diplo:unlink', { to: ch.owner }, r => (r.ok ? 0 : cb(r)));
    else toast('請點選盟友的領地', true);
  }
  else if (tool.kind === 'diplo') {
    if (ch && ch.owner !== me.id) socket.emit('diplo:request', { to: ch.owner }, r => (r.ok ? toast('已送出連接請求，等待對方同意') : cb(r)));
    else toast('請點選鄰居的領地', true);
  }
}

let drag = null, sel = null;                                                // sel：批量框選 { mode:'path'|'rect', start, last, tiles: Map }
const SEL_MAX = 400;
const tileAt = (sx, sy) => { const [gx, gy] = toGrid(sx, sy); return [Math.floor(gx), Math.floor(gy)]; };
function selUpdate(x, y) {
  if (sel.mode === 'path') {                                                // 路徑：連到上一格之間補滿（滑鼠移太快也不會出現缺口）
    let [px, py] = sel.last || [x, y];
    const dx = Math.abs(x - px), dy = Math.abs(y - py), sx = px < x ? 1 : -1, sy = py < y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (sel.tiles.size < SEL_MAX) sel.tiles.set(px + ',' + py, [px, py]);
      if (px === x && py === y) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; px += sx; }
      if (e2 < dx) { err += dx; py += sy; }
    }
    sel.last = [x, y];
    return;
  }
  sel.tiles.clear();                                                        // 矩形：起點到目前格子
  const [x0, y0] = sel.start;
  for (let xx = Math.min(x0, x); xx <= Math.max(x0, x); xx++) for (let yy = Math.min(y0, y); yy <= Math.max(y0, y); yy++) {
    if (sel.tiles.size >= SEL_MAX) return;
    sel.tiles.set(xx + ',' + yy, [xx, yy]);
  }
}
function selSubmit() {
  const tiles = [...sel.tiles.values()], isBuild = tool.kind === 'build', type = tool.type;
  sel = null;
  if (!tiles.length) return;
  socket.emit(isBuild ? 'buildMany' : 'bulldozeMany', isBuild ? { type, tiles } : { tiles }, r => {
    if (!r || !r.ok) { toast(ERR[r && r.err] || (r && r.err) || '失敗了', true); sfx('err'); return; }
    const money = isBuild ? `花費 $${(r.spent || 0).toLocaleString()}` : `退款 $${(r.refund || 0).toLocaleString()}`;
    toast(`${isBuild ? '已建造' : '已拆除'} ${r.built || 0} 格，${money}${r.failed ? `；${r.failed} 格沒成功（${ERR[r.err] || r.err}）` : ''}`, !r.built, 4000);
    sfx(r.built ? (isBuild ? 'build' : 'bulldoze') : 'err');
  });
}
cv.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  cv.setPointerCapture(e.pointerId);
  drag = { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  if ((e.shiftKey || e.ctrlKey) && tool && (tool.kind === 'build' || tool.kind === 'bulldoze')) {   // Shift+拖曳 = 沿路徑連續鋪；Ctrl+拖曳 = 框選填滿
    const [x, y] = tileAt(e.clientX, e.clientY);
    sel = { mode: e.ctrlKey ? 'rect' : 'path', start: [x, y], last: null, tiles: new Map() };
    selUpdate(x, y); drag.moved = true;
  }
});
cv.addEventListener('pointermove', e => {
  mouse.sx = e.clientX; mouse.sy = e.clientY;
  if (drag) {
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
    if (sel) { const [x, y] = tileAt(e.clientX, e.clientY); selUpdate(x, y); }
    else {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
      if (drag.moved) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; }
    }
  }
  updateHover();
});
cv.addEventListener('pointerup', e => {
  if (sel) selSubmit();
  else if (drag && !drag.moved) { const [x, y] = tileAt(e.clientX, e.clientY); act(x, y); }
  drag = null;
});
cv.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none'; });
cv.addEventListener('contextmenu', e => { e.preventDefault(); setTool(null); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [gx, gy] = toGrid(e.clientX, e.clientY);                             // 以游標為中心縮放：游標下的點保持不動
  const nz = clamp(cam.z * Math.exp(-e.deltaY * 0.0012), 0.25, 2.5);
  cam.z = nz; cam.x = isoX(gx, gy) - (e.clientX - W / 2) / nz; cam.y = isoY(gx, gy) - (e.clientY - H / 2) / nz;
  updateHover();
}, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { setTool(null); hideInfo(); }
  else if (/^[1-7]$/.test(e.key)) showTab(Object.keys({ ...CATS, tools: 1 })[+e.key - 1]);   // 數字鍵切換分頁
  else if (e.key === 'b' || e.key === 'B') setTool({ kind: 'bulldoze' });
});

// ───────────────── UI：工具列 / 通知 / 外交面板 ─────────────────
const tabs = $('tabs'), items = $('items');
let curTab = 'transport';
function buildPalette() {
  tabs.innerHTML = ''; let tabNo = 0;
  for (const [k, label] of Object.entries({ ...CATS, tools: '領地 / 外交' })) {
    const b = document.createElement('button'); b.textContent = (++tabNo) + ' ' + label; b.dataset.k = k; b.onclick = () => showTab(k); tabs.appendChild(b);
  }
  showTab(curTab);
}
function showTab(k) {
  curTab = k; [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
  items.innerHTML = '';
  const defs = k === 'tools'
    ? [{ id: 'claim', name: '擴張領地', tool: { kind: 'claim' } }, { id: 'diplo', name: '結盟（合併）', tool: { kind: 'diplo' } }, { id: 'unlink', name: '解除結盟', tool: { kind: 'unlink' } }, { id: 'gift', name: '贈送資金', tool: { kind: 'gift' } }, { id: 'bulldoze', name: '拆除', tool: { kind: 'bulldoze' } }]
    : Object.values(B).filter(d => d.cat === k).map(d => ({ id: d.id, name: d.name, cost: d.cost, d, tool: { kind: 'build', type: d.id } }));
  for (const it of defs) {
    const b = document.createElement('button'); b.className = 'item'; b.dataset.id = it.id;
    const locked = !!it.d && (it.d.unlock || 0) > (stats.peakPop || 0);                   // 城市等級不夠 → 鎖定
    if (locked) b.classList.add('locked'); else if (it.cost != null) b.dataset.cost = it.cost;
    if (it.d) {
      const s = getSprite(it.d, 3, 1), pv = document.createElement('canvas'); pv.width = s.w; pv.height = s.h;
      pv.getContext('2d').drawImage(s.img, s.sx, s.sy, s.w, s.h, 0, 0, s.w, s.h); b.appendChild(pv);
    }
    const nm = document.createElement('span'); nm.textContent = it.name; b.appendChild(nm);
    if (it.cost != null) { const sm = document.createElement('small'); sm.textContent = locked ? '🔒 人口 ' + it.d.unlock.toLocaleString() : '$' + it.cost.toLocaleString(); b.appendChild(sm); }
    b.onclick = () => {
      if (locked) { toast(`需要累積人口 ${it.d.unlock.toLocaleString()} 才能解鎖「${it.name}」（你目前最高 ${(stats.peakPop || 0).toLocaleString()}）`, true); return; }
      setTool(tool && tool.kind === it.tool.kind && tool.type === it.tool.type ? null : it.tool);
    };
    items.appendChild(b);
  }
  markTool(); markPoor();
}
function markPoor() { [...items.children].forEach(b => b.classList.toggle('poor', !!b.dataset.cost && +b.dataset.cost > stats.money)); }
function markTool() { [...items.children].forEach(b => b.classList.toggle('on', !!tool && b.dataset.id === (tool.type || tool.kind))); }
function setTool(t) { tool = t; markTool(); updateHover(); }
function setTrafficOverlay(on) {
  trafficOverlay = !!on;
  const button = $('trafficMode');
  if (button) { button.classList.toggle('on', trafficOverlay); button.textContent = trafficOverlay ? '🚦關閉熱區' : '🚦交通圖'; }
  toast(trafficOverlay ? '交通熱區已開啟：綠色順暢、黃色繁忙、橘紅色壅塞' : '已關閉交通熱區圖');
}
$('trafficMode').addEventListener('click', () => setTrafficOverlay(!trafficOverlay));

function hideInfo() { $('info').style.display = 'none'; }
function showInfo(t) {                                                            // 建築資訊卡：點建築（沒選工具時）
  const d = B[t.type], el = $('info'); if (!d) return;
  el.innerHTML = '';
  const h = document.createElement('h4'); h.textContent = d.name; el.appendChild(h);
  const row = (k, v) => { if (v == null || v === '' || v === 0) return; const r = document.createElement('div'); r.className = 'irow'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); el.appendChild(r); };
  const miss = [[1, '缺少道路'], [2, '電力不足'], [4, '水不足']].filter(([b]) => (t.n & b) && !(t.f & b)).map(x => x[1]);
  row('狀態', miss.length ? miss.join('、') : (t.n ? '運作中' : '一般'));
  row('分類', CATS[d.cat]); row('解鎖需求', d.unlock ? '人口 ' + d.unlock.toLocaleString() : 0); row('放置條件', NEEDS[d.needs]); row('造價', '$' + d.cost.toLocaleString()); row('拆除退款', '$' + Math.floor(d.cost / 2).toLocaleString());
  row('維護費', d.upkeep ? '$' + d.upkeep + '/秒' : 0);
  const u = d.uses || {}; row('耗電', u.power); row('耗水', u.water);
  const s = d.supplies || {}; row('供電', s.power); row('供水', s.water);
  row('居住人口', d.pop); row('提供工作', d.jobs); row('稅收', d.tax ? '$' + d.tax + '/秒' : 0); row('營收', d.income ? '$' + d.income + '/秒' : 0);
  row('物資', d.goods); row('污染', d.pollution); row('幸福度', d.happy ? '+' + d.happy : 0);
  el.style.display = 'block';
}

let toastTimer;
function toast(msg, bad, ms) {
  const el = $('toast'); el.textContent = msg; el.className = bad ? 'bad' : ''; el.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.opacity = 0; }, ms || 2400);
}
function addRequest(from, fromName) {
  const existing = [...$('diplo').querySelectorAll('.req')].find(node => node.dataset.from === String(from));
  if (existing) { if (fromName) existing.dataset.fromName = fromName; return; }
  const el = document.createElement('div'); el.className = 'req'; el.dataset.from = String(from); el.dataset.fromName = fromName || '';
  const p = document.createElement('p'); p.textContent = `${fromName || '鄰居'} 請求與你結盟：道路互通，並共享彼此剩餘的電力與水。`; el.appendChild(p);
  for (const [label, ok] of [['同意', true], ['拒絕', false]]) {
    const b = document.createElement('button'); b.textContent = label; if (ok) b.className = 'yes';
    b.onclick = () => {
      b.disabled = true;
      socket.emit('diplo:respond', { from, accept: ok }, r => {
        if (r && !r.err) {
          el.remove();
          if (window.CityGame && typeof window.CityGame.diplomacyResponded === 'function') window.CityGame.diplomacyResponded(from, ok);
        } else { b.disabled = false; toast(ERR[r && r.err] || (r && r.err) || '操作失敗，請重試。', true); }
      });
    };
    el.appendChild(b);
  }
  $('diplo').appendChild(el);
  if (window.CityGame && typeof window.CityGame.diplomacyIncoming === 'function') window.CityGame.diplomacyIncoming(from, fromName);
}
buildPalette();
// 登出只清除這個瀏覽器的登入狀態；帳號與城市存檔保留在伺服器。
$('acct').onclick = () => {
  if (!confirm('確定要登出嗎？你的城市會保存在伺服器，下次可用相同帳號登入。')) return;
  store.set('cm_auth_token', ''); store.set('cm_auth_name', ''); location.reload();
};
$('snd').textContent = muted ? '🔇' : '🔊';
$('snd').onclick = () => { muted = !muted; store.set('cm_mute', muted ? '1' : '0'); $('snd').textContent = muted ? '🔇' : '🔊'; if (!muted) sfx('coin'); };
// 提供給 ui.js（聊天 / 小地圖 / 目標）使用
const jumpTo = (gx, gy) => { cam.x = isoX(gx, gy); cam.y = isoY(gx, gy); };
window.CityGame = {
  socket, cam, chunks, players, links, hooks, view, C, B, toast, sfx, jumpTo, toGrid,
  getMe: () => me, getStats: () => stats,
  clearDiplomacyRequest: from => {
    const node = [...$('diplo').querySelectorAll('.req')].find(el => el.dataset.from === String(from));
    if (node) node.remove();
  }
};
})();
