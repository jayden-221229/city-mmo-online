(() => {
'use strict';
const { CHUNK: C, BUILDINGS: B, CATS, EVENTS } = GameData;
// Keep the UI alive if a host/browser serves an older cached building catalog.
// The shipped package also syncs assets/shared/buildings.js with shared/buildings.js.
const GAME_MODES = GameData.GAME_MODES || {
  classic: { id: 'classic', name: '經典模式', buildMultiplier: 1, claimMultiplier: 1, incomeMultiplier: 1, upkeepMultiplier: 1, refundMultiplier: 0.5, description: '使用原本的城市經濟規則。' },
  creative: { id: 'creative', name: '創意模式', buildMultiplier: 0, claimMultiplier: 0, incomeMultiplier: 1, upkeepMultiplier: 0, refundMultiplier: 0, description: '建造與擴張免費，適合自由規劃。' },
  challenge: { id: 'challenge', name: '挑戰模式', buildMultiplier: 1.25, claimMultiplier: 1.5, incomeMultiplier: 1.1, upkeepMultiplier: 1.15, refundMultiplier: 0.3, description: '成本較高、收益也提高。' },
};
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
  route_name_required: '請輸入路線名稱', route_stop_count: '路線至少需要 2 站，最多 20 站', route_stop_not_owned: '路線只能使用你自己領地內的站點', route_bad_station: '所選位置不是符合此路線類型的站點', route_need_rail: '每座地鐵站旁都需要連接鐵軌', route_need_road: '每座公車站旁都需要連接道路', route_disconnected: '依照目前的站序，站點之間沒有連通的道路／鐵軌', route_limit: '每位玩家最多建立 12 條路線', route_not_found: '找不到這條路線',
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
let transitOverlay = false, transitDirty = true, transitLastScan = 0, transitRouteSignature = '';
let transitRoutes = { bus: [], metro: [] }, transitSummary = { busStops: 0, busRoutes: 0, buses: 0, subwayStations: 0, metroRoutes: 0, trains: 0, railTiles: 0 };
let savedTransitPlans = [], transitStationCache = { bus: [], metro: [] }, transitDraftStops = [], transitEditingId = null, transitStationOptionSignature = '';
const TRANSIT_COLORS = ['#20b6a4', '#f4c95d', '#4e80ba', '#b49aff', '#ff8a65', '#e57373'];
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
  else { const c = d.line ? makeLine(d, mask) : makeBlock(d, v); s = { img: c, sx: 0, sy: 0, w: c.width, h: c.height, top: c.top, smokes: c.smokes, rotors: c.rotors }; }
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
  remove(k) { try { localStorage.removeItem(k); } catch (e) { this.ok = false; } },
};
// 音效：用瀏覽器內建的 WebAudio 合成，不需要音檔；瀏覽器要求先有點擊才能出聲，所以第一次播放時才建立
let actx = null, muted = store.get('cm_mute') === '1';
const SFX = { build: [[520, .05, 'square', .04]], err: [[160, .14, 'sawtooth', .05]], bulldoze: [[220, .09, 'triangle', .06]],
  coin: [[880, .06, 'sine', .05], [1320, .12, 'sine', .05]], level: [[523, .1], [659, .1], [784, .1], [1047, .28]], ach: [[784, .1], [988, .1], [1319, .3]] };
const CITY_THEMES = {
  classic: { name: '自然綠地', desc: '原始城市色彩', grass1: '#5b8a52', grass2: '#548250', water: '#2f77b5', ore: '#676b74', forest: '#3a7a42', grid: 'rgba(0,0,0,.10)' },
  garden: { name: '春日花園', desc: '明亮柔和的綠色', grass1: '#8fbc78', grass2: '#9fca87', water: '#4dabf7', ore: '#7d8597', forest: '#4d9958', grid: 'rgba(45,65,35,.13)' },
  neon: { name: '霓虹夜城', desc: '深色地面與科技藍', grass1: '#243746', grass2: '#2b4150', water: '#1874a5', ore: '#576574', forest: '#285b50', grid: 'rgba(91,220,255,.18)' },
};
let activeTheme = CITY_THEMES[store.get('cm_city_theme')] ? store.get('cm_city_theme') : 'classic';
const cityTheme = () => CITY_THEMES[activeTheme] || CITY_THEMES.classic;
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
    const apiPrefix = String(window.GAME_API_PREFIX == null ? '' : window.GAME_API_PREFIX).replace(/\/+$/, '');
    const response = await fetch(apiBase + apiPrefix + '/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '驗證失敗');
    token = data.token; myName = data.username; authReady = true;
    store.set('cm_auth_token', token); store.set('cm_auth_name', myName);
    authScreen.style.display = 'none';
    if (mode === 'register') {
      store.set('citymmo.tutorial.pendingChoice', myName);
      window.dispatchEvent(new CustomEvent('citymmo:auth-registered', { detail: { username: myName } }));
    }
    if (socket.connected) connectGame();
  } catch (e) { setAuthError(e.message || '無法連線，請稍後再試。'); }
  finally { $('loginBtn').disabled = $('registerBtn').disabled = false; }
}
$('authCard').addEventListener('submit', e => { e.preventDefault(); authRequest('login'); });
$('registerBtn').addEventListener('click', () => authRequest('register'));
const socketOptions = { path: String(window.GAME_SOCKET_PATH || '/api/socket-io/socket.io'), transports: ['websocket'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800, reconnectionDelayMax: 10000 };
const socket = window.GAME_SERVER ? io(window.GAME_SERVER, socketOptions) : io(undefined, socketOptions);
function connectGame() {
  if (!authReady || !token) return;
  $('net').style.display = 'none';
  chunks.clear(); lastVp = ''; transitDirty = true;
  socket.emit('hello', { token, name: myName }, res => {
    if (!res || !res.you) {
      // 舊／失效的本機 token 不應把玩家卡在隱藏登入畫面的狀態。
      token = null; myName = ''; authReady = false; me = null;
      store.remove('cm_auth_token'); store.remove('cm_auth_name');
      $('net').style.display = 'none'; authScreen.style.display = 'flex';
      setAuthError('登入狀態已失效，請重新登入。');
      return;
    }
    me = res.you; players.set(me.id, me); transitStationOptionSignature = '';
    links.clear(); res.links.forEach(l => links.add(l));
    socket.emit('transit:list', {}, r => {
      if (r && r.ok && Array.isArray(r.routes)) { savedTransitPlans = r.routes; transitDirty = true; renderTransitPanel(); renderSavedTransitPlans(); }
    });
    setWorldEvent(res.event, true);
    $('diplo').innerHTML = '';
    (res.incoming || []).forEach(r => addRequest(r.from, r.fromName));
    if (window.CityGame && typeof window.CityGame.diplomacyInit === 'function') {
      window.CityGame.diplomacyInit(res.incoming || [], res.outgoing || []);
    }
    cam.x = isoX(res.home.cx * C + C / 2, res.home.cy * C + C / 2);
    cam.y = isoY(res.home.cx * C + C / 2, res.home.cy * C + C / 2);
    window.dispatchEvent(new CustomEvent('citymmo:game-ready', { detail: { username: myName } }));
  });
}
socket.on('connect', () => {
  if (authReady) connectGame();
  else { $('net').style.display = 'none'; authScreen.style.display = 'flex'; }
});
socket.on('chunk', p => {
  trafficPressureCache.clear(); trafficCacheAt = 0; transitDirty = true;
  if (p.ownerInfo) players.set(p.ownerInfo.id, p.ownerInfo);
  const prev = chunks.get(p.cx + ',' + p.cy);                                     // 保留建造動畫的起始時間
  chunks.set(p.cx + ',' + p.cy, { cx: p.cx, cy: p.cy, owner: p.owner, tiles: new Map(p.tiles.map(([i, type, f, n]) => {
    const o = prev && prev.tiles.get(i); return [i, { type, f, n, born: o && o.type === type ? o.born : 0 }];
  })) });
});
function applyTile(p) {
  trafficPressureCache.clear(); trafficCacheAt = 0; transitDirty = true;
  const ch = getChunk(p.x, p.y); if (!ch) return;
  const i = ((p.y % C + C) % C) * C + ((p.x % C + C) % C);
  if (p.type) ch.tiles.set(i, { type: p.type, f: p.f, n: p.n, born: nowMs }); else ch.tiles.delete(i);
}
socket.on('tile', applyTile);
socket.on('tiles', list => list.forEach(applyTile));                       // 批量建造 / 拆除：一次一批
socket.on('transit:routes', routes => {
  if (!Array.isArray(routes)) return;
  savedTransitPlans = routes;
  transitDirty = true;
  renderTransitPanel();
  renderSavedTransitPlans();
});
socket.on('me', s => {
  stats = s;
  $('money').textContent = '$' + s.money.toLocaleString();
  const r = $('rate'); r.textContent = (s.rate >= 0 ? '+' : '') + s.rate; r.parentElement.className = 'rate ' + (s.rate < 0 ? 'neg' : 'pos');
  $('pop').textContent = s.pop.toLocaleString(); $('happy').textContent = s.happiness; $('chunks').textContent = s.chunks;
  $('level').textContent = s.levelName + (s.nextAt != null ? ` ${s.peakPop}/${s.nextAt}` : '（最高）');
  if (s.peakPop !== lastPeak || s.mode !== lastRenderedMode) { lastPeak = s.peakPop; lastRenderedMode = s.mode || 'classic'; showTab(curTab); renderModePanel(); }                  // 人口變動 → 重新整理建築的鎖定狀態
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
socket.on('diplo:linked', ({ a, b }) => { links.add(pair(a, b)); transitDirty = true; toast('結盟成功：道路互通，剩餘水電共享'); });
socket.on('diplo:unlinked', ({ a, b }) => { links.delete(pair(a, b)); transitDirty = true; toast('結盟已解除'); });
socket.on('diplo:denied', r => toast(r.by + ' 拒絕了連接請求', true));

function syncViewport(x0, y0, x1, y1) {                                      // 視野改變才回報（以 chunk 為單位）
  const k = [x0, y0, x1, y1].join();
  if (k !== lastVp && socket.connected) { lastVp = k; socket.emit('viewport', { x0, y0, x1, y1 }); }
}

// ───────────────── 車流與路邊人行道 ─────────────────
const cars = [], CAR_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#2ecc71', '#9b59b6'];
const isRoad = (x, y) => { const t = getTile(x, y); return !!t && !!B[t.type] && B[t.type].conducts === 'road'; };
const isRailTile = (x, y) => { const t = getTile(x, y); return !!t && !!B[t.type] && B[t.type].conducts === 'rail'; };
// 行人只走一般道路、單行道與橋邊人行道；高速公路沒有行人通行區。
const isWalkableRoad = (x, y) => {
  const t = getTile(x, y);
  return !!t && !!B[t.type] && B[t.type].conducts === 'road' && ['road', 'oneway', 'bridge'].includes(t.type);
};
function roadNeighborCount(x, y) {
  const owner = ownerAt(x, y);
  return DIRS.reduce((n, [dx, dy]) => n + (isRoad(x + dx, y + dy) && canCross(owner, ownerAt(x + dx, y + dy)) ? 1 : 0), 0);
}
function roadSegmentWidth(x1, y1, x2, y2) {
  const a = getTile(x1, y1), b = getTile(x2, y2);
  return Math.max((a && B[a.type] && B[a.type].line && B[a.type].line.w) || 18,
    (b && B[b.type] && B[b.type].line && B[b.type].line.w) || 18);
}
function sidewalkOffset(x1, y1, x2, y2) {
  return roadSegmentWidth(x1, y1, x2, y2) / 2 + 4;
}
function roadCenter(x, y) {
  return { x: isoX(x + 0.5, y + 0.5), y: isoY(x + 0.5, y + 0.5) };
}
function roadSurfaceColor(aType, bType) {
  // One consistent charcoal surface makes adjacent road tiles read as one continuous road.
  if (aType === 'bridge' || bType === 'bridge') return '#564a43';
  if (aType === 'highway' || bType === 'highway') return '#292f38';
  return '#343941';
}
function isWalkableRoadType(type) { return type === 'road' || type === 'oneway' || type === 'bridge'; }
function drawContinuousRoads(roads) {
  if (!roads.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const drawn = new Set();
  const connectedNeighbors = (r) => {
    const owner = ownerAt(r.x, r.y);
    return DIRS.map(([dx, dy]) => [r.x + dx, r.y + dy])
      .filter(([nx, ny]) => isRoad(nx, ny) && canCross(owner, ownerAt(nx, ny)));
  };
  // Repaint connected center-to-center segments over the per-tile sprites. This hides
  // antialias seams and keeps long roads continuous at all zoom levels.
  for (const r of roads) {
    const rt = getTile(r.x, r.y); if (!rt || !B[rt.type] || !B[rt.type].line) continue;
    for (const [nx, ny] of connectedNeighbors(r)) {
      if (r.x > nx || (r.x === nx && r.y > ny)) continue;
      const key = `${r.x},${r.y}:${nx},${ny}`;
      if (drawn.has(key)) continue; drawn.add(key);
      const nt = getTile(nx, ny); if (!nt || !B[nt.type]) continue;
      const a = roadCenter(r.x, r.y), b = roadCenter(nx, ny);
      const width = roadSegmentWidth(r.x, r.y, nx, ny);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = roadSurfaceColor(rt.type, nt.type); ctx.lineWidth = width + 0.6; ctx.stroke();
    }
  }
  // Round the asphalt at every connected tile center so T-junctions and bends join cleanly.
  for (const r of roads) {
    const t = getTile(r.x, r.y); if (!t || !B[t.type] || !B[t.type].line) continue;
    const neighbors = connectedNeighbors(r);
    if (!neighbors.length) continue; // isolated tiles keep the base sprite's short road mark
    const p = roadCenter(r.x, r.y), width = Math.max(...neighbors.map(([nx, ny]) => roadSegmentWidth(r.x, r.y, nx, ny)), B[t.type].line.w || 18);
    ctx.beginPath(); ctx.arc(p.x, p.y, width / 2 + 0.25, 0, Math.PI * 2);
    ctx.fillStyle = roadSurfaceColor(t.type, t.type); ctx.fill();
  }
  // Reapply lane markings after the asphalt pass. The road stays dark; lane dashes remain separate.
  ctx.setLineDash([4.5, 4.5]); ctx.lineWidth = 1.35;
  const marked = new Set();
  for (const r of roads) {
    const rt = getTile(r.x, r.y); if (!rt || !B[rt.type] || !B[rt.type].line) continue;
    for (const [nx, ny] of connectedNeighbors(r)) {
      if (r.x > nx || (r.x === nx && r.y > ny)) continue;
      const key = `${r.x},${r.y}:${nx},${ny}`;
      if (marked.has(key)) continue; marked.add(key);
      const nt = getTile(nx, ny); if (!nt || !B[nt.type] || !B[nt.type].line) continue;
      // Keep lane dashes continuous through junctions; the zebra overlays are disabled.
      // Bridges intentionally have no painted center dashes.
      if (rt.type === 'bridge' || nt.type === 'bridge') continue;
      const highway = rt.type === 'highway' || nt.type === 'highway';
      const a = roadCenter(r.x, r.y), b = roadCenter(nx, ny);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = highway ? 'rgba(245,245,238,.9)' : '#d8bd63'; ctx.stroke();
    }
  }
  ctx.setLineDash([]); ctx.restore();
}
function drawSidewalks(roads) {
  if (cam.z < 0.28) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seen = new Set();
  for (const r of roads) {
    const rt = getTile(r.x, r.y);
    if (!rt || !isWalkableRoadType(rt.type)) continue;
    const aOwner = ownerAt(r.x, r.y);
    for (const [dx, dy] of DIRS) {
      const nx = r.x + dx, ny = r.y + dy;
      const nt = getTile(nx, ny);
      if (!nt || !isWalkableRoadType(nt.type) || !canCross(aOwner, ownerAt(nx, ny))) continue;
      if (r.x > nx || (r.x === nx && r.y > ny)) continue;
      const key = `${r.x},${r.y}:${nx},${ny}`;
      if (seen.has(key)) continue; seen.add(key);
      const a = roadCenter(r.x, r.y), b = roadCenter(nx, ny);
      const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy) || 1;
      const normalX = -vy / len, normalY = vx / len, off = sidewalkOffset(r.x, r.y, nx, ny);
      for (const side of [-1, 1]) {
        const sx = normalX * off * side, sy = normalY * off * side;
        ctx.beginPath(); ctx.moveTo(a.x + sx, a.y + sy); ctx.lineTo(b.x + sx, b.y + sy);
        ctx.strokeStyle = 'rgba(31, 42, 48, .46)'; ctx.lineWidth = 5.8; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x + sx, a.y + sy); ctx.lineTo(b.x + sx, b.y + sy);
        ctx.strokeStyle = '#b9b9b1'; ctx.lineWidth = 3.4; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x + sx, a.y + sy); ctx.lineTo(b.x + sx, b.y + sy);
        ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 0.65; ctx.stroke();
      }
    }
  }
  ctx.restore();
}
// 斑馬線已移除：路口保持連續柏油路面，車輛只沿已建道路網行駛。

function carNeighbors(x, y, previousX, previousY) {
  const owner = ownerAt(x, y);
  let opts = DIRS.map(([dx, dy]) => [x + dx, y + dy])
    .filter(([nx, ny]) => isRoad(nx, ny) && canCross(owner, ownerAt(nx, ny)));
  const fwd = opts.filter(([nx, ny]) => !(nx === previousX && ny === previousY));
  if (fwd.length) opts = fwd;
  return opts;
}
function chooseCarNext(x, y, previousX, previousY) {
  const opts = carNeighbors(x, y, previousX, previousY);
  if (!opts.length) return null;
  // Prefer continuing straight, while still allowing cars to turn at junctions.
  const inDx = previousX == null ? 0 : x - previousX;
  const inDy = previousY == null ? 0 : y - previousY;
  const straight = opts.filter(([nx, ny]) => nx - x === inDx && ny - y === inDy);
  if (straight.length && Math.random() < 0.74) return straight[(Math.random() * straight.length) | 0];
  return opts[(Math.random() * opts.length) | 0];
}
const transitKey = (x, y) => TransitNetwork.key(x, y);
function networkMapFromChunks(conducts) {
  const out = new Map();
  // Use all cached chunks, not only the camera's current view. This keeps routes stable
  // while the player pans around and lets buses/trains keep travelling off-screen.
  for (const ch of chunks.values()) {
    const bx = ch.cx * C, by = ch.cy * C;
    for (const [i, tile] of ch.tiles) {
      const d = B[tile.type];
      if (!d || d.conducts !== conducts) continue;
      const x = bx + (i % C), y = by + Math.floor(i / C);
      out.set(transitKey(x, y), { x, y, type: tile.type, owner: ch.owner });
    }
  }
  return out;
}
function collectTransitStops(types, network, mode) {
  const out = [];
  for (const ch of chunks.values()) {
    const bx = ch.cx * C, by = ch.cy * C;
    for (const [i, tile] of ch.tiles) {
      if (!types.has(tile.type)) continue;
      const x = bx + (i % C), y = by + Math.floor(i / C);
      // Stations without road/power requirements met are not part of an active line.
      if (tile.n && tile.f !== tile.n) continue;
      const access = [];
      for (const [dx, dy] of DIRS) {
        const ax = x + dx, ay = y + dy, node = network.get(transitKey(ax, ay));
        if (node && canCross(ch.owner, node.owner)) access.push(transitKey(ax, ay));
      }
      if (access.length) out.push({ key: `${mode}:${x},${y}`, x, y, type: tile.type, owner: ch.owner, access });
    }
  }
  return out;
}
function sameTransitRoutes(a, b) {
  return a.map(r => r.key).join('||') === b.map(r => r.key).join('||');
}
function createTransitCars(routes, mode, fallbackColor) {
  const out = [];
  for (const route of routes) {
    // Vehicle count is player-configured. Very short loops are limited to avoid
    // spawning two buses on the same exact tile.
    const count = Math.min(route.vehicleCount || 1, Math.max(1, Math.floor(route.nodes.length / 2)));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(route.nodes.length * i / count) % route.nodes.length;
      const a = route.nodes[idx], b = route.nodes[(idx + 1) % route.nodes.length];
      out.push({ fx: a.x, fy: a.y, tx: b.x, ty: b.y, t: 0,
        kind: mode === 'metro' ? 'metro' : 'bus', transit: true, transitMode: mode,
        routeKey: route.key, routeName: route.name, routeNodes: route.nodes, routeIndex: idx,
        routeStopKeys: new Set(route.stopKeys), dwell: route.stopKeys.has(transitKey(a.x, a.y)) ? (mode === 'metro' ? 0.65 : 0.35) : 0,
        sp: mode === 'metro' ? 0.88 + i * 0.025 : 0.70 + i * 0.025,
        c: route.color || (i ? '#f4c95d' : fallbackColor) });
    }
  }
  return out;
}
function transitStationLabel(stop, mode) {
  const tile = getTile(stop.x, stop.y), type = stop.type || (tile && tile.type), def = type && B[type];
  return `${def ? def.name : (mode === 'metro' ? '地鐵站' : '公車站')}（${stop.x}, ${stop.y}）`;
}
function setTransitEditorMessage(text, kind) {
  const el = $('transitEditorMessage'); if (!el) return;
  el.textContent = text || ''; el.className = 'transit-editor-message' + (kind ? ' ' + kind : '');
}
function renderTransitPanel() {
  const el = $('transitStats'), status = $('transitStatus');
  if (!el || !status) return;
  const s = transitSummary;
  el.innerHTML = '';
  const entries = [
    ['公車站點', s.busStops], ['已啟用公車路線', transitRoutes.bus.length], ['行駛中的公車', cars.filter(c => c.transitMode === 'bus').length],
    ['地鐵站', s.subwayStations], ['已啟用地鐵路線', transitRoutes.metro.length], ['行駛中的列車', cars.filter(c => c.transitMode === 'metro').length], ['已載入鐵軌', s.railTiles]
  ];
  for (const [label, value] of entries) {
    const row = document.createElement('div'); row.className = 'transit-stat';
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('b'); val.textContent = String(value);
    row.append(name, val); el.appendChild(row);
  }
  const plans = savedTransitPlans.filter(r => r.enabled !== false);
  const missing = transitRouteProblems || [];
  const busText = plans.some(r => r.mode === 'bus')
    ? (transitRoutes.bus.length ? `公車：${transitRoutes.bus.length} 條自訂路線正在運作。` : '公車：已設定路線，但部分站點尚未載入或路徑中斷。')
    : '公車：尚未建立自訂路線；請選擇站點並親自排列站序。';
  const metroText = plans.some(r => r.mode === 'metro')
    ? (transitRoutes.metro.length ? `地鐵：${transitRoutes.metro.length} 條自訂路線正在運作。` : '地鐵：已設定路線，但部分站點尚未載入或鐵軌不連通。')
    : '地鐵：尚未建立自訂路線；請選擇地鐵站並親自排列站序。';
  status.textContent = [busText, metroText, missing.length ? `待處理：${missing.slice(0, 2).join('；')}` : ''].filter(Boolean).join(' ');
}
let transitRouteProblems = [];
function refreshTransitStationOptions(force) {
  const select = $('transitStationChoice'), modeEl = $('transitRouteMode');
  if (!select || !modeEl) return;
  const mode = modeEl.value === 'metro' ? 'metro' : 'bus';
  const list = (transitStationCache[mode] || []).filter(s => me && s.owner === me.id);
  const signature = mode + '|' + list.map(s => `${s.x},${s.y}:${s.type}:${s.owner}`).join('|');
  if (!force && signature === transitStationOptionSignature) return;
  transitStationOptionSignature = signature;
  const prior = select.value;
  select.replaceChildren();
  const first = document.createElement('option'); first.value = ''; first.textContent = list.length ? '選擇一個已連接的站點…' : (mode === 'metro' ? '先建造地鐵站並接上鐵軌' : '先建造公車站並接上道路');
  select.appendChild(first);
  for (const stop of list) {
    const option = document.createElement('option'); option.value = `${stop.x},${stop.y}`;
    option.textContent = transitStationLabel(stop, mode); select.appendChild(option);
  }
  if ([...select.options].some(o => o.value === prior)) select.value = prior;
}
function renderTransitDraftStops() {
  const list = $('transitDraftStops'); if (!list) return;
  list.replaceChildren();
  if (!transitDraftStops.length) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = '尚未加入站點；請在上方選擇站點，再按「加入站序」。'; list.appendChild(li); return;
  }
  const mode = $('transitRouteMode').value;
  transitDraftStops.forEach((stop, index) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'transit-stop-name'; name.textContent = transitStationLabel(stop, mode); li.appendChild(name);
    const actions = document.createElement('span'); actions.className = 'transit-stop-actions';
    const button = (label, title, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.disabled = !!disabled; b.addEventListener('click', fn); actions.appendChild(b); };
    button('↑', '往前移', () => { if (index > 0) { [transitDraftStops[index - 1], transitDraftStops[index]] = [transitDraftStops[index], transitDraftStops[index - 1]]; renderTransitDraftStops(); } }, index === 0);
    button('↓', '往後移', () => { if (index < transitDraftStops.length - 1) { [transitDraftStops[index + 1], transitDraftStops[index]] = [transitDraftStops[index], transitDraftStops[index + 1]]; renderTransitDraftStops(); } }, index === transitDraftStops.length - 1);
    button('✕', '移除站點', () => { transitDraftStops.splice(index, 1); renderTransitDraftStops(); }, false);
    li.appendChild(actions); list.appendChild(li);
  });
}
function renderSavedTransitPlans() {
  const root = $('transitSavedRoutes'); if (!root) return;
  root.replaceChildren();
  if (!savedTransitPlans.length) {
    const empty = document.createElement('div'); empty.className = 'transit-no-routes'; empty.textContent = '目前沒有路線。建立路線後，它會儲存在伺服器，其他玩家也能看到。'; root.appendChild(empty); return;
  }
  for (const route of [...savedTransitPlans].sort((a, b) => (a.owner === (me && me.id) ? -1 : 1) - (b.owner === (me && me.id) ? -1 : 1) || String(a.name).localeCompare(String(b.name)))) {
    const card = document.createElement('div'); card.className = 'transit-route-card';
    const head = document.createElement('div'); head.className = 'transit-route-card-head';
    const swatch = document.createElement('span'); swatch.className = 'transit-route-swatch'; swatch.style.background = route.color || '#20b6a4'; head.appendChild(swatch);
    const title = document.createElement('span'); title.className = 'transit-route-title'; title.textContent = `${route.mode === 'metro' ? '🚇' : '🚌'} ${route.name || '未命名路線'}`; head.appendChild(title);
    const owner = document.createElement('span'); owner.className = 'transit-route-owner'; owner.textContent = route.owner === (me && me.id) ? '我的路線' : (route.ownerName || '其他玩家'); head.appendChild(owner); card.appendChild(head);
    const stops = Array.isArray(route.stops) ? route.stops : [];
    const meta = document.createElement('div'); meta.className = 'transit-route-meta';
    meta.textContent = `${route.enabled === false ? '已停用' : '營運中'}・${stops.length} 站・設定 ${route.vehicleCount || 1} 輛車・站序：${stops.map((s, i) => `${i + 1}.${transitStationLabel(s, route.mode)}`).join(' → ')}`;
    card.appendChild(meta);
    if (route.owner === (me && me.id)) {
      const buttons = document.createElement('div'); buttons.className = 'transit-route-buttons';
      const addButton = (label, fn, extraClass) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (extraClass) b.className = extraClass; b.addEventListener('click', fn); buttons.appendChild(b); };
      addButton('編輯站序', () => editTransitPlan(route));
      addButton(route.enabled === false ? '啟用' : '暫停營運', () => socket.emit('transit:save', { ...route, enabled: route.enabled === false }, result => {
        if (!result || !result.ok) setTransitEditorMessage(ERR[result && result.err] || '無法更新路線。', 'bad');
        else { savedTransitPlans = result.routes || savedTransitPlans; transitDirty = true; renderSavedTransitPlans(); toast(route.enabled === false ? '路線已啟用' : '路線已暫停'); }
      }), route.enabled === false ? '' : 'route-toggle-off');
      addButton('刪除', () => {
        setTransitEditorMessage(`正在刪除「${route.name}」…`);
        socket.emit('transit:delete', { id: route.id }, result => {
          if (!result || !result.ok) setTransitEditorMessage(ERR[result && result.err] || '刪除失敗。', 'bad');
          else { savedTransitPlans = result.routes || savedTransitPlans.filter(r => r.id !== route.id); if (transitEditingId === route.id) clearTransitDraft(); renderSavedTransitPlans(); transitDirty = true; toast('已刪除路線'); }
        });
      });
      card.appendChild(buttons);
    }
    root.appendChild(card);
  }
}
function clearTransitDraft() {
  transitEditingId = null; transitDraftStops = [];
  $('transitEditorTitle').textContent = '＋ 建立自己的路線';
  $('transitRouteName').value = ''; $('transitRouteMode').value = 'bus'; $('transitVehicleCount').value = '2';
  $('transitRouteColor').value = '#20b6a4'; $('transitRouteEnabled').checked = true;
  refreshTransitStationOptions(true); renderTransitDraftStops(); setTransitEditorMessage('');
  $('transitSaveRoute').textContent = '儲存路線';
}
function editTransitPlan(route) {
  if (!route || route.owner !== (me && me.id)) return;
  transitEditingId = route.id; transitDraftStops = (route.stops || []).map(s => ({ x: s.x, y: s.y, type: getTile(s.x, s.y)?.type }));
  $('transitEditorTitle').textContent = `✏️ 編輯路線：${route.name}`;
  $('transitRouteName').value = route.name || ''; $('transitRouteMode').value = route.mode === 'metro' ? 'metro' : 'bus';
  $('transitVehicleCount').value = String(route.vehicleCount || 1); $('transitRouteColor').value = route.color || (route.mode === 'metro' ? '#4e80ba' : '#20b6a4');
  $('transitRouteEnabled').checked = route.enabled !== false; $('transitSaveRoute').textContent = '儲存修改';
  refreshTransitStationOptions(true); renderTransitDraftStops(); setTransitEditorMessage('編輯後儲存即可更新全服路線。');
  $('transitRouteName').focus();
}
function saveTransitDraft() {
  const name = $('transitRouteName').value.trim(), mode = $('transitRouteMode').value;
  if (!name) return setTransitEditorMessage('請先輸入路線名稱。', 'bad');
  if (transitDraftStops.length < 2) return setTransitEditorMessage('至少要加入 2 個站點，並自行排好順序。', 'bad');
  if (transitDraftStops.length > 20) return setTransitEditorMessage('一條路線最多 20 個站點。', 'bad');
  const payload = { id: transitEditingId || undefined, name, mode, stops: transitDraftStops.map(({x,y}) => ({x,y})), vehicleCount: Number($('transitVehicleCount').value), color: $('transitRouteColor').value, enabled: $('transitRouteEnabled').checked };
  $('transitSaveRoute').disabled = true; setTransitEditorMessage('正在檢查站點與路網…');
  socket.emit('transit:save', payload, result => {
    $('transitSaveRoute').disabled = false;
    if (!result || !result.ok) { setTransitEditorMessage(ERR[result && result.err] || '儲存失敗，請確認站點和道路／鐵軌是否連通。', 'bad'); return; }
    savedTransitPlans = result.routes || savedTransitPlans; transitDirty = true; clearTransitDraft(); renderSavedTransitPlans(); renderTransitPanel();
    setTransitEditorMessage('路線已儲存到伺服器，其他玩家也會收到更新。', 'good'); toast('已儲存自訂公共運輸路線');
  });
}
function refreshTransitRoutes(roads, rails, gx0, gx1, gy0, gy1) {
  if (!transitDirty || nowMs - transitLastScan < 500) return;
  transitLastScan = nowMs; transitDirty = false;
  const roadNet = networkMapFromChunks('road'), railNet = networkMapFromChunks('rail');
  const busStops = collectTransitStops(new Set(['bus_stop', 'bus_station', 'bus_terminal']), roadNet, 'bus');
  const subwayStops = collectTransitStops(new Set(['subway']), railNet, 'metro');
  transitStationCache = { bus: busStops, metro: subwayStops };
  refreshTransitStationOptions(false);
  const stationMaps = {
    bus: new Map(busStops.map(s => [`${s.x},${s.y}`, s])),
    metro: new Map(subwayStops.map(s => [`${s.x},${s.y}`, s])),
  };
  const networks = { bus: roadNet, metro: railNet };
  const canTravel = (a, b) => canCross(a.owner, b.owner);
  const nextByMode = { bus: [], metro: [] }, problems = [];
  for (const plan of savedTransitPlans) {
    if (plan.enabled === false) continue;
    const mode = plan.mode === 'metro' ? 'metro' : 'bus';
    const map = stationMaps[mode];
    const orderedStops = (plan.stops || []).map(s => map.get(`${s.x},${s.y}`));
    if (orderedStops.length < 2 || orderedStops.some(s => !s)) {
      problems.push(`「${plan.name}」有站點尚未載入或未啟用`); continue;
    }
    const built = TransitNetwork.buildOrderedRoute(networks[mode], orderedStops, canTravel);
    if (!built) { problems.push(`「${plan.name}」的指定站序目前不連通`); continue; }
    nextByMode[mode].push({ ...built, key: `${plan.id}:${built.key}`, planId: plan.id, name: plan.name, owner: plan.owner, ownerName: plan.ownerName, mode, vehicleCount: plan.vehicleCount || 1, color: plan.color || (mode === 'metro' ? '#4e80ba' : '#20b6a4') });
  }
  const signaturePart = list => list.map(r => `${r.key}:${r.vehicleCount}:${r.color}:${r.name}`).join('||');
  const nextSignature = signaturePart(nextByMode.bus) + '|' + signaturePart(nextByMode.metro);
  if (nextSignature !== transitRouteSignature) {
    transitRouteSignature = nextSignature;
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i].transit) cars.splice(i, 1);
    cars.push(...createTransitCars(nextByMode.bus, 'bus', '#20b6a4'), ...createTransitCars(nextByMode.metro, 'metro', '#4e80ba'));
  }
  transitRoutes = nextByMode; transitRouteProblems = problems;
  transitSummary = {
    busStops: busStops.length, busRoutes: nextByMode.bus.length, buses: cars.filter(c => c.transitMode === 'bus').length,
    subwayStations: subwayStops.length, metroRoutes: nextByMode.metro.length, trains: cars.filter(c => c.transitMode === 'metro').length,
    railTiles: railNet.size
  };
  renderTransitPanel();
}
function drawTransitRoutes() {
  if (!transitOverlay) return;
  const draw = (routes, color) => {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = 0.78; ctx.lineWidth = 2.5 / cam.z;
    ctx.setLineDash([7 / cam.z, 4 / cam.z]); ctx.lineCap = 'round';
    const minX = view.cx0 * C - 8, maxX = (view.cx1 + 1) * C + 8, minY = view.cy0 * C - 8, maxY = (view.cy1 + 1) * C + 8;
    const inside = n => n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY;
    for (const route of routes) {
      if (route.nodes.length < 2) continue;
      const routeColor = route.color || color; ctx.strokeStyle = routeColor; ctx.fillStyle = routeColor;
      ctx.beginPath(); let drawing = false;
      for (let i = 0; i < route.nodes.length; i++) {
        const a = route.nodes[i], b = route.nodes[(i + 1) % route.nodes.length];
        if (!inside(a) && !inside(b)) { drawing = false; continue; }
        const pa = roadCenter(a.x, a.y), pb = roadCenter(b.x, b.y);
        if (!drawing) { ctx.moveTo(pa.x, pa.y); drawing = true; }
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      for (const stopKey of route.stopKeys) {
        const [x, y] = stopKey.split(',').map(Number);
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const p = roadCenter(x, y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 4.2 / cam.z, 0, Math.PI * 2); ctx.fillStyle = routeColor; ctx.fill();
      }
    }
    ctx.setLineDash([]); ctx.restore();
  };
  draw(transitRoutes.bus, '#2dd4bf'); draw(transitRoutes.metro, '#b49aff');
}

function carLaneOffset(car) {
  if (car.transitMode === 'metro') return 0; // 地鐵列車行駛在鐵軌中心，不使用公路車道偏移。
  // Wide roads get clearly separated opposing lanes; narrow streets stay compact.
  return TrafficPhysics.laneOffsetForWidth(roadSegmentWidth(car.fx, car.fy, car.tx, car.ty));
}
function carScreenPoint(x, y, car) {
  const baseX = isoX(x + 0.5, y + 0.5), baseY = isoY(x + 0.5, y + 0.5);
  if (car.transitMode === 'metro') return { x: baseX, y: baseY };
  const gx = car.tx - car.fx, gy = car.ty - car.fy;
  const vx = (gx - gy) * TW / 2, vy = (gx + gy) * TH / 2;
  // Offset perpendicular to travel: a car heading the opposite way occupies the opposite half.
  // On highways the offset grows with the road width, so neither direction drives down the middle.
  return TrafficPhysics.offsetPoint(baseX, baseY, vx, vy, carLaneOffset(car), 1);
}
function carPointAt(car, t) {
  const x = car.fx + (car.tx - car.fx) * t;
  const y = car.fy + (car.ty - car.fy) * t;
  return carScreenPoint(x, y, car);
}
function carGap(a, b) {
  // Center-to-center gap includes each isometric vehicle's projected length plus a bumper margin.
  // The v7 vehicles now have a larger grid footprint, so the old flat-sprite gap was too short.
  const lengthPx = kind => kind === 'metro' ? 29 : kind === 'bus' ? 21.5 : kind === 'truck' ? 19.3 : 15.4;
  return Math.max(12, (lengthPx(a.kind) + lengthPx(b.kind)) / 2 + 3.5);
}
function updateCars(dt, roads, rails, gx0, gx1, gy0, gy1) {
  refreshTransitRoutes(roads, rails, gx0, gx1, gy0, gy1);
  // Public-transit vehicles are inserted only when a connected station loop exists.
  // They share the safety-spacing solver with regular traffic, so cars queue behind buses.
  const target = Math.min(58, Math.max(2, Math.floor(roads.length / 4)));
  let spawnAttempts = 0;
  while (roads.length && cars.length < target && spawnAttempts < Math.min(70, roads.length * 5)) {
    spawnAttempts++;
    const preferred = roads.filter(r => isRoad(r.x, r.y) && roadNeighborCount(r.x, r.y) > 0 && roadNeighborCount(r.x, r.y) < 3);
    const pool = preferred.length ? preferred : roads.filter(r => isRoad(r.x, r.y) && roadNeighborCount(r.x, r.y) > 0);
    if (!pool.length) break;
    const r = pool[(Math.random() * pool.length) | 0];
    const pos = { x: isoX(r.x + 0.5, r.y + 0.5), y: isoY(r.x + 0.5, r.y + 0.5) };
    if (cars.some(c => TrafficPhysics.distance(pos, carPointAt(c, c.t)) < carGap(c, { kind: 'car' }) + 11)) continue;
    const next = chooseCarNext(r.x, r.y, null, null);
    if (!next) continue;
    const roll = Math.random(), kind = (stats.goods || 0) > 2 && roll < 0.16 ? 'truck' : 'car';
    const palette = kind === 'truck' ? ['#e99c4b', '#d65d4d', '#6c8ebf'] : CAR_COLORS;
    cars.push({ fx: r.x, fy: r.y, tx: next[0], ty: next[1], t: 0,
      kind, sp: kind === 'truck' ? 0.65 + Math.random() * 0.4 : 1.1 + Math.random() * 0.8,
      c: palette[(Math.random() * palette.length) | 0] });
  }

  // Remove cars whose current edge no longer exists; metro vehicles use rail, buses use roads.
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i], valid = c.transitMode === 'metro' ? isRailTile : isRoad;
    const outsideView = c.fx < gx0 - 3 || c.fx > gx1 + 3 || c.fy < gy0 - 3 || c.fy > gy1 + 3;
    if (!valid(c.fx, c.fy) || !valid(c.tx, c.ty) || (!c.transit && outsideView)) cars.splice(i, 1);
  }

  const progress = cars.map(c => {
    if (c.transit && c.dwell > 0) { c.dwell = Math.max(0, c.dwell - dt); return c.t; }
    const congestionSpeed = 1 - clamp((stats.traffic || 0) / 100, 0, 1) * 0.42;
    return Math.min(1, c.t + dt * c.sp * congestionSpeed);
  });
  const safeProgress = TrafficPhysics.resolveProgress(cars, progress, carPointAt, carGap, 6);
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i]; c.t = safeProgress[i];
    if (c.t < 1 - 1e-5) continue;
    const cx = c.tx, cy = c.ty;
    if (cx < gx0 - 2 || cx > gx1 + 2 || cy < gy0 - 2 || cy > gy1 + 2) { cars.splice(i, 1); continue; }
    if (c.transit) {
      const arrivedKey = transitKey(cx, cy);
      c.routeIndex = (c.routeIndex + 1) % c.routeNodes.length;
      const a = c.routeNodes[c.routeIndex], b = c.routeNodes[(c.routeIndex + 1) % c.routeNodes.length];
      if (!a || !b) { cars.splice(i, 1); continue; }
      c.fx = a.x; c.fy = a.y; c.tx = b.x; c.ty = b.y; c.t = 0;
      if (c.routeStopKeys.has(arrivedKey)) c.dwell = c.transitMode === 'metro' ? 1.45 : 0.95;
      continue;
    }
    const next = chooseCarNext(cx, cy, c.fx, c.fy);
    if (!next) { cars.splice(i, 1); continue; }
    c.fx = cx; c.fy = cy; c.tx = next[0]; c.ty = next[1]; c.t = 0;
  }
}

function carRoundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr); ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr); ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
}
function carPolygon(points, fill, stroke) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.55; ctx.stroke(); }
}
function carTone(color, amount) {
  // Shift a vehicle paint colour lighter/darker so its top and side planes read as volume.
  const match = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!match) return color || '#3984c6';
  const hex = match[1];
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  return '#' + channels.map(v => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next))).toString(16).padStart(2, '0');
  }).join('');
}
function drawCar(o) {
  // Draw cars in the same isometric projection as buildings: diamond-shaped top faces,
  // vertical side walls, raised cabins, and darker extrusion faces. Do not rotate a flat
  // screen-space rectangle; the car's footprint lives on the actual isometric ground plane.
  const car = o.car, kind = car.kind || 'car';
  const lanePoint = carScreenPoint(o.x, o.y, car), ix = lanePoint.x, iy = lanePoint.y;
  const dx = car.tx - car.fx, dy = car.ty - car.fy;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const forward = alongX ? Math.sign(dx || 1) : Math.sign(dy || 1);
  const length = kind === 'metro' ? 0.88 : kind === 'bus' ? 0.60 : kind === 'truck' ? 0.54 : 0.43;
  const width = kind === 'metro' ? 0.32 : kind === 'bus' ? 0.275 : kind === 'truck' ? 0.245 : 0.225;
  const bodyBottom = 0.65;
  const bodyTop = kind === 'metro' ? 6.1 : kind === 'bus' ? 5.9 : kind === 'truck' ? 3.15 : 3.25;
  const cabinTop = kind === 'metro' || kind === 'bus' ? bodyTop : kind === 'truck' ? bodyTop + 2.65 : bodyTop + 2.45;
  const paint = car.c || '#3984c6';
  const edge = 'rgba(17,27,34,.82)';

  // Project world-grid-relative coordinates to the same 64x32 isometric plane as shapes.js.
  const P = (gx, gy, z = 0) => [ix + (gx - gy) * TW / 2, iy + (gx + gy) * TH / 2 - z];
  const poly = (points, fill, stroke = edge) => carPolygon(points.map(([x, y, z = 0]) => P(x, y, z)), fill, stroke);
  const bounds = (alongCenter, alongLength, lateralCenter = 0, lateralWidth = width) => {
    const a0 = alongCenter - alongLength / 2, a1 = alongCenter + alongLength / 2;
    const l0 = lateralCenter - lateralWidth / 2, l1 = lateralCenter + lateralWidth / 2;
    return alongX ? { x0: a0, x1: a1, y0: l0, y1: l1 } : { x0: l0, x1: l1, y0: a0, y1: a1 };
  };
  const topFace = (b, z, color, stroke = edge) => poly([[b.x0,b.y0,z],[b.x1,b.y0,z],[b.x1,b.y1,z],[b.x0,b.y1,z]], color, stroke);
  const sideXFace = (b, z0, z1, color, stroke = edge) => poly([[b.x1,b.y0,z1],[b.x1,b.y1,z1],[b.x1,b.y1,z0],[b.x1,b.y0,z0]], color, stroke);
  const sideYFace = (b, z0, z1, color, stroke = edge) => poly([[b.x0,b.y1,z1],[b.x1,b.y1,z1],[b.x1,b.y1,z0],[b.x0,b.y1,z0]], color, stroke);
  const isoBox = (b, z0, z1, col, opts = {}) => {
    // The two camera-facing walls are shaded independently, exactly like the building boxes.
    sideXFace(b, z0, z1, opts.x || carTone(col, -0.38), opts.stroke || edge);
    sideYFace(b, z0, z1, opts.y || carTone(col, -0.24), opts.stroke || edge);
    topFace(b, z1, opts.top || carTone(col, 0.16), opts.stroke || edge);
  };
  const longSideWindows = (b, z0, z1, count, glass = '#527d8c') => {
    // Windows live on the long visible wall and are separated by painted pillars.
    const lo = alongX ? b.x0 : b.y0, hi = alongX ? b.x1 : b.y1;
    const span = hi - lo, gap = span / count, margin = span * 0.035;
    for (let i = 0; i < count; i++) {
      const a = lo + i * gap + margin, c = lo + (i + 1) * gap - margin;
      let pts;
      if (alongX) pts = [[a,b.y1,z1],[c,b.y1,z1],[c,b.y1,z0],[a,b.y1,z0]];
      else pts = [[b.x1,a,z1],[b.x1,c,z1],[b.x1,c,z0],[b.x1,a,z0]];
      poly(pts, glass, 'rgba(25,44,54,.86)');
      // A thin light strip gives each pane a glass reflection.
      const stripTop = z1 - Math.max(0.28, (z1-z0)*0.16);
      let highlight;
      if (alongX) highlight = [[a+gap*.06,b.y1,stripTop],[c-gap*.08,b.y1,stripTop],[c-gap*.08,b.y1,stripTop-.16],[a+gap*.06,b.y1,stripTop-.16]];
      else highlight = [[b.x1,a+gap*.06,stripTop],[b.x1,c-gap*.08,stripTop],[b.x1,c-gap*.08,stripTop-.16],[b.x1,a+gap*.06,stripTop-.16]];
      poly(highlight, 'rgba(229,249,255,.56)', 'rgba(229,249,255,.10)');
    }
  };
  const endGlass = (b, z0, z1, glass) => {
    // The camera-facing positive-axis end becomes either the windscreen or the rear glass,
    // depending on the car's travel direction.
    if (alongX) poly([[b.x1,b.y0 + width*.13,z1],[b.x1,b.y1 - width*.13,z1],[b.x1,b.y1 - width*.13,z0],[b.x1,b.y0 + width*.13,z0]], glass, 'rgba(25,44,54,.9)');
    else poly([[b.x0 + width*.13,b.y1,z1],[b.x1 - width*.13,b.y1,z1],[b.x1 - width*.13,b.y1,z0],[b.x0 + width*.13,b.y1,z0]], glass, 'rgba(25,44,54,.9)');
    if (alongX) poly([[b.x1,b.y0 + width*.2,z1-.18],[b.x1,b.y0 + width*.38,z1-.18],[b.x1,b.y0 + width*.38,z1-.34],[b.x1,b.y0 + width*.2,z1-.34]], 'rgba(238,252,255,.58)', 'rgba(255,255,255,.12)');
    else poly([[b.x0 + width*.2,b.y1,z1-.18],[b.x0 + width*.38,b.y1,z1-.18],[b.x0 + width*.38,b.y1,z1-.34],[b.x0 + width*.2,b.y1,z1-.34]], 'rgba(238,252,255,.58)', 'rgba(255,255,255,.12)');
  };
  const longSideBand = (b, z0, z1, color) => {
    if (alongX) poly([[b.x0 + .025,b.y1,z1],[b.x1 - .025,b.y1,z1],[b.x1 - .025,b.y1,z0],[b.x0 + .025,b.y1,z0]], color, 'rgba(12,21,28,.35)');
    else poly([[b.x1,b.y0 + .025,z1],[b.x1,b.y1 - .025,z1],[b.x1,b.y1 - .025,z0],[b.x1,b.y0 + .025,z0]], color, 'rgba(12,21,28,.35)');
  };
  const point = (along, lateral, z) => alongX ? P(along, lateral, z) : P(lateral, along, z);
  const shadeCol = (hex, amt) => carTone(hex, amt);

  // A soft ground shadow stays on the asphalt; its diamond orientation follows the map grid.
  poly([[-length*.52,-width*.56,0.15],[length*.52,-width*.56,0.15],[length*.52,width*.56,0.15],[-length*.52,width*.56,0.15]], 'rgba(0,0,0,.28)', 'rgba(0,0,0,0)');

  // Wheels are shown as separate dark sidewall ellipses, then partly covered by the body.
  const axle = length * ((kind === 'bus' || kind === 'metro') ? 0.34 : 0.31);
  for (const a of [-axle, axle]) for (const side of [-1, 1]) {
    const [wx, wy] = point(a, side * (width*.49), 0.55);
    ctx.beginPath(); ctx.ellipse(wx, wy, 1.75, 1.22, alongX ? 0.46 : -0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#171c22'; ctx.fill(); ctx.strokeStyle = '#06090c'; ctx.lineWidth = .45; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(wx, wy, .82, .63, alongX ? 0.46 : -0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#69747d'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(wx-.12, wy-.10, .33, .25, alongX ? 0.46 : -0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#c1c8cc'; ctx.fill();
  }

  const shell = bounds(0, length, 0, width);
  const shellBottom = bodyBottom;
  // Lower chassis and main shell: unlike the old rotated rectangle, these are actual iso box faces.
  isoBox(shell, shellBottom, bodyTop, paint, {
    x: shadeCol(paint, -0.43), y: shadeCol(paint, -0.27), top: shadeCol(paint, 0.13),
  });
  longSideBand(shell, shellBottom + .35, shellBottom + .82, shadeCol(paint, -.42));

  if (kind === 'truck') {
    // Raised cargo block and a separate cab create the same layered block geometry used by buildings.
    const cargo = bounds(-forward * length * .17, length * .55, 0, width * .88);
    isoBox(cargo, bodyTop - .12, bodyTop + 2.85, '#e0e5e6', { x: '#9ba8b0', y: '#bdc7cb', top: '#f8faf8' });
    const cargoSideZ = bodyTop + 1.05;
    longSideBand(cargo, cargoSideZ, cargoSideZ + .16, '#aeb8bd');
    for (let i = 1; i <= 3; i++) {
      const along = (alongX ? cargo.x0 : cargo.y0) + ((alongX ? cargo.x1-cargo.x0 : cargo.y1-cargo.y0) * i / 4);
      if (alongX) poly([[along,cargo.y1,cargoSideZ+.12],[along+.006,cargo.y1,cargoSideZ+.12],[along+.006,cargo.y1,bodyTop+2.65],[along,cargo.y1,bodyTop+2.65]], '#a2adb4', 'rgba(0,0,0,0)');
      else poly([[cargo.x1,along,cargoSideZ+.12],[cargo.x1,along+.006,cargoSideZ+.12],[cargo.x1,along+.006,bodyTop+2.65],[cargo.x1,along,bodyTop+2.65]], '#a2adb4', 'rgba(0,0,0,0)');
    }
    const cab = bounds(forward * length * .265, length * .34, 0, width * .86);
    const cabZ = bodyTop - .02, cabH = 2.55;
    isoBox(cab, cabZ, cabZ + cabH, paint, { x: shadeCol(paint,-.32), y: shadeCol(paint,-.18), top: shadeCol(paint,.27) });
    longSideWindows(cab, cabZ + .68, cabZ + cabH - .42, 1, '#4a7484');
    endGlass(cab, cabZ + .68, cabZ + cabH - .34, '#6e9dab');
    // Sunlit edge on the cargo top catches the same direction of light as the rooftops.
    poly([[cargo.x0+.025,cargo.y0+.025,bodyTop+2.87],[cargo.x1-.025,cargo.y0+.025,bodyTop+2.87],[cargo.x1-.025,cargo.y0+.035,bodyTop+2.87]], 'rgba(255,255,255,.42)', 'rgba(255,255,255,0)');
  } else if (kind === 'bus') {
    // Tall bus body with a roof panel, a row of individual windows, and a front/rear glass panel.
    longSideWindows(shell, 2.15, 5.15, 5, '#426f7d');
    endGlass(shell, 2.45, 5.25, forward > 0 ? '#6b9dad' : '#456f80');
    const roof = bounds(0, length*.78, 0, width*.68);
    isoBox(roof, bodyTop, bodyTop + .56, shadeCol(paint,.08), { x: shadeCol(paint,-.25), y: shadeCol(paint,-.12), top: shadeCol(paint,.30) });
    longSideBand(shell, 1.05, 4.95, 'rgba(37,61,70,.16)');
  } else if (kind === 'metro') {
    // A compact articulated-looking metro car: multiple reflective windows, doors and a yellow safety stripe.
    longSideWindows(shell, 1.75, 5.45, 6, '#3f7288');
    endGlass(shell, 2.0, 5.5, forward > 0 ? '#8ec4d4' : '#3e7188');
    const roof = bounds(0, length*.84, 0, width*.70);
    isoBox(roof, bodyTop, bodyTop + .50, shadeCol(paint,.12), { x: shadeCol(paint,-.24), y: shadeCol(paint,-.12), top: shadeCol(paint,.30) });
    longSideBand(shell, 1.10, 1.48, '#f4c95d');
    for (const along of [-length*.25, 0, length*.25]) {
      const door = bounds(along, length*.105, width*.485, width*.035);
      if (alongX) poly([[door.x0,door.y1,4.9],[door.x1,door.y1,4.9],[door.x1,door.y1,1.55],[door.x0,door.y1,1.55]], 'rgba(211,232,238,.30)', 'rgba(22,41,50,.6)');
      else poly([[door.x1,door.y0,4.9],[door.x1,door.y1,4.9],[door.x1,door.y1,1.55],[door.x1,door.y0,1.55]], 'rgba(211,232,238,.30)', 'rgba(22,41,50,.6)');
    }
  } else {
    // Passenger car: a raised glass cabin on a low bonnet/body, in the same box-and-roof style.
    const cabLength = length * .47, cabWidth = width * .77;
    const cab = bounds(-forward * length * .075, cabLength, 0, cabWidth);
    const cabZ = bodyTop - .03, cabH = 2.35;
    isoBox(cab, cabZ, cabZ + cabH, shadeCol(paint,.03), { x: shadeCol(paint,-.28), y: shadeCol(paint,-.17), top: shadeCol(paint,.26) });
    longSideWindows(cab, cabZ + .53, cabZ + cabH - .38, 2, '#456f80');
    endGlass(cab, cabZ + .55, cabZ + cabH - .34, forward > 0 ? '#8db9c9' : '#496f7e');
    // A low raised bonnet plane at the leading end makes the vehicle look like a tiny 3D model.
    const hoodBounds = bounds(forward * length * .365, length*.19, 0, width*.60);
    topFace(hoodBounds, bodyTop + .025, shadeCol(paint,.30), 'rgba(255,255,255,.12)');
    const hoodStripe = bounds(forward * length * .365, length*.105, -width*.06, width*.18);
    topFace(hoodStripe, bodyTop + .04, 'rgba(255,255,255,.28)', 'rgba(255,255,255,0)');
    // Slightly brighter roof inset and dark rim keep a clear roof silhouette at normal zoom.
    const roof = bounds(-forward * length * .075, cabLength*.68, 0, cabWidth*.63);
    topFace(roof, cabZ + cabH + .015, shadeCol(paint,.34), 'rgba(255,255,255,.18)');
  }

  // The camera-facing positive end receives lights: headlights if driving toward it, tail lights otherwise.
  const frontVisible = forward > 0;
  const lampColor = frontVisible ? '#fff0b6' : '#e3413d';
  const lampZ = kind === 'metro' ? 1.9 : kind === 'bus' ? 1.65 : 1.48;
  for (const lat of [-width*.28, width*.28]) {
    const px = alongX ? length*.49 : lat;
    const py = alongX ? lat : length*.49;
    const [lx, ly] = P(px, py, lampZ);
    ctx.beginPath(); ctx.ellipse(lx, ly, .86, .58, 0, 0, Math.PI*2);
    ctx.fillStyle = lampColor; ctx.fill(); ctx.strokeStyle = 'rgba(20,28,34,.55)'; ctx.lineWidth=.35; ctx.stroke();
  }
  if (frontVisible && kind !== 'metro') {
    // Small dark grille sits just inside the front lip.
    const grille = bounds(length*.485, .012, 0, width*.23);
    topFace(grille, lampZ + .08, '#39454d', 'rgba(0,0,0,.15)');
  }
}

// ───────────────── 行人動畫 ─────────────────
// 行人走在道路兩側明確繪製的人行道上，而不是道路中心或草地中間。
const pedestrians = [];
const PED_SHIRTS = ['#f4a261', '#3a86ff', '#e76f51', '#2a9d8f', '#9b5de5', '#f7f7ff', '#ffbe0b', '#ef476f'];
const PED_SKIN = ['#e0ac83', '#c6865b', '#f1c8a5', '#8d5524'];
function roadSteps(x, y) {
  const owner = ownerAt(x, y);
  return DIRS.map(([dx, dy]) => [x + dx, y + dy])
    .filter(([nx, ny]) => isWalkableRoad(nx, ny) && canCross(owner, ownerAt(nx, ny)));
}
function updatePedestrians(dt, roads, gx0, gx1, gy0, gy1) {
  const walkableRoads = roads.filter(r => isWalkableRoad(r.x, r.y));
  if (cam.z < 0.42 || !walkableRoads.length) { pedestrians.length = 0; return; }
  const target = Math.min(30, Math.max(3, Math.ceil(walkableRoads.length / 12)));
  let attempts = 0;
  while (pedestrians.length < target && attempts < Math.min(90, walkableRoads.length * 3)) {
    attempts++;
    const r = walkableRoads[(Math.random() * walkableRoads.length) | 0];
    const opts = roadSteps(r.x, r.y);
    if (!opts.length) continue;
    const [nx, ny] = opts[(Math.random() * opts.length) | 0];
    pedestrians.push({
      fx: r.x, fy: r.y, tx: nx, ty: ny, t: Math.random(),
      sp: 0.34 + Math.random() * 0.28,
      side: Math.random() < 0.5 ? -1 : 1,
      phase: Math.random() * Math.PI * 2,
      shirt: PED_SHIRTS[(Math.random() * PED_SHIRTS.length) | 0],
      skin: PED_SKIN[(Math.random() * PED_SKIN.length) | 0],
      bag: Math.random() < 0.2,
    });
  }
  for (let i = pedestrians.length - 1; i >= 0; i--) {
    const p = pedestrians[i];
    p.t += dt * p.sp;
    if (p.t < 1) continue;
    const x = p.tx, y = p.ty;
    if (x < gx0 - 2 || x > gx1 + 2 || y < gy0 - 2 || y > gy1 + 2) { pedestrians.splice(i, 1); continue; }
    let opts = roadSteps(x, y).filter(([nx, ny]) => !(nx === p.fx && ny === p.fy));
    if (!opts.length) opts = roadSteps(x, y);
    if (!opts.length) { pedestrians.splice(i, 1); continue; }
    const [nx, ny] = opts[(Math.random() * opts.length) | 0];
    p.fx = x; p.fy = y; p.tx = nx; p.ty = ny; p.t = 0;
  }
}
function pedestrianScreenPoint(p, wx, wy) {
  let dx = isoX(p.tx + 0.5, p.ty + 0.5) - isoX(p.fx + 0.5, p.fy + 0.5);
  let dy = isoY(p.tx + 0.5, p.ty + 0.5) - isoY(p.fx + 0.5, p.fy + 0.5);
  // Canonical orientation keeps a pedestrian on the same physical side when the road is traversed backwards.
  if (p.fx > p.tx || (p.fx === p.tx && p.fy > p.ty)) { dx = -dx; dy = -dy; }
  const baseX = isoX(wx + 0.5, wy + 0.5), baseY = isoY(wx + 0.5, wy + 0.5);
  return TrafficPhysics.offsetPoint(baseX, baseY, dx, dy, sidewalkOffset(p.fx, p.fy, p.tx, p.ty), p.side);
}
function drawPedestrian(o) {
  const p = o.ped, ix = o.pedScreenX, iy = o.pedScreenY;
  const walk = Math.sin(nowMs * (0.009 + p.sp * 0.004) + p.phase);
  const stride = walk * 1.05, bob = Math.abs(walk) * 0.28;
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.beginPath(); ctx.ellipse(ix, iy + 0.6, 2.0, 0.72, 0, 0, Math.PI * 2); ctx.fill();
  if (cam.z < 0.58) {
    ctx.fillStyle = p.shirt; ctx.beginPath(); ctx.arc(ix, iy - 2.4, 1.15, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#39434b'; ctx.lineWidth = 1.15;
  ctx.beginPath(); ctx.moveTo(ix, iy - 2.25 - bob); ctx.lineTo(ix + stride, iy - 0.15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ix, iy - 2.25 - bob); ctx.lineTo(ix - stride, iy - 0.15); ctx.stroke();
  ctx.strokeStyle = p.shirt; ctx.lineWidth = 1.65;
  ctx.beginPath(); ctx.moveTo(ix, iy - 2.35 - bob); ctx.lineTo(ix - stride * 0.55, iy - 4.0 - bob); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ix, iy - 2.35 - bob); ctx.lineTo(ix + stride * 0.55, iy - 4.0 - bob); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ix, iy - 2.0 - bob); ctx.lineTo(ix, iy - 5.15 - bob); ctx.stroke();
  ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(ix, iy - 6.05 - bob, 1.05, 0, Math.PI * 2); ctx.fill();
  if (p.bag) { ctx.fillStyle = '#6d597a'; ctx.fillRect(ix + 1.0, iy - 4.45 - bob, 1.0, 1.7); }
  ctx.restore();
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
    if (d.id === 'bus_stop') { pressure -= 1.3 * near; continue; }
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
  ctx.fillStyle = ch ? grass() || cityTheme().grass1 : (activeTheme === 'neon' ? '#0d1c29' : '#15232b'); ctx.fill();
  if (ch) { ctx.globalAlpha = 0.2; ctx.fillStyle = (players.get(ch.owner) || {}).color || '#fff'; ctx.fill(); ctx.globalAlpha = 1; }
  if (ch && cam.z >= 0.6) {                                                  // 放大時才畫格線
    const x0 = cx * C, y0 = cy * C;
    ctx.strokeStyle = cityTheme().grid; ctx.lineWidth = 1 / cam.z; ctx.beginPath();
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
function smoke(x, y, seed = 0) {                                                 // 煙囪煙團：時間函數動畫，不需寫入存檔
  // 多個半透明雲團交錯上升，讓工廠煙霧不再像固定的三顆圓點。
  for (let k = 0; k < 4; k++) {
    const p = ((nowMs / (3000 + k * 170) + k * 0.27 + seed * 0.013) % 1 + 1) % 1;
    const drift = Math.sin(nowMs * 0.0011 + seed + k * 1.7) * (1.6 + p * 2.2);
    const px = x + drift + p * (7 + (seed % 3));
    const py = y - p * (27 + (seed % 5));
    const r = 1.7 + p * 4.6;
    ctx.globalAlpha = (0.34 * (1 - p)) * (cam.z < 0.75 ? 0.78 : 1);
    ctx.fillStyle = k % 2 ? '#c4ccd1' : '#e6eaed';
    ctx.beginPath(); ctx.ellipse(px, py, r * 0.92, r * 0.72, -0.18, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha *= 0.72;
    ctx.beginPath(); ctx.ellipse(px - r * 0.45, py + r * 0.1, r * 0.58, r * 0.48, 0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawRotor(x, y, rotor) {                                              // 風力發電機轉子：真實逐幀旋轉
  const angle = nowMs * rotor.speed + rotor.phase;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  // 軸心後方的小陰影讓白色葉片在天空與建築背景上都清楚可見。
  ctx.fillStyle = 'rgba(25,38,48,.30)'; ctx.beginPath(); ctx.arc(0.7, 0.8, Math.max(1.4, rotor.r * 0.13), 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.save(); ctx.rotate(i * Math.PI * 2 / 3);
    ctx.beginPath(); ctx.moveTo(-0.65, -0.55); ctx.lineTo(rotor.r * 0.34, -1.2);
    ctx.lineTo(rotor.r, 0); ctx.lineTo(rotor.r * 0.34, 1.2); ctx.lineTo(-0.65, 0.55); ctx.closePath();
    ctx.fillStyle = '#f7fafc'; ctx.fill(); ctx.strokeStyle = 'rgba(90,108,118,.85)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#dbe4e8'; ctx.beginPath(); ctx.arc(0, 0, Math.max(1.6, rotor.r * 0.14), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#75838b'; ctx.lineWidth = 0.7; ctx.stroke(); ctx.restore();
}
function blit(o) {
  const s = getSprite(o.d, o.d.line ? lineMask(o.x, o.y, o.d) : 0, variantOf(o.x, o.y));
  const ix = isoX(o.x, o.y), iy = isoY(o.x, o.y);
  const age = o.t.born ? Math.min(1, (nowMs - o.t.born) / 380) : 1;               // 新建築：從地下「長」出來
  const rise = (1 - age) * 14;
  if (age < 1) ctx.globalAlpha = 0.25 + 0.75 * age;
  const drawX = ix - s.w / 2, drawY = iy + TH - s.h + rise;
  ctx.drawImage(s.img, s.sx, s.sy, s.w, s.h, drawX, drawY, s.w, s.h);
  ctx.globalAlpha = 1;
  if (s.smokes && cam.z > 0.4) for (let i = 0; i < s.smokes.length; i++) {
    const [sx, sy] = s.smokes[i]; smoke(drawX + sx, drawY + sy, o.x * 17 + o.y * 31 + i * 7);
  }
  if (s.rotors && cam.z > 0.35 && age > 0.85) for (const rotor of s.rotors) drawRotor(drawX + rotor.x, drawY + rotor.y, rotor);
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
  g.fillStyle = cityTheme().grass1; g.fillRect(0, 0, TW, TH); g.fillStyle = cityTheme().grass2;
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
    diamondsPath(water); ctx.fillStyle = cityTheme().water; ctx.fill(); ctx.lineWidth = 1 / cam.z; ctx.strokeStyle = cityTheme().water; ctx.stroke();
    ctx.globalAlpha = 0.1 + 0.07 * Math.sin(nowMs / 800); ctx.fillStyle = '#bfe6ff'; ctx.fill(); ctx.globalAlpha = 1;
  }
  if (ore.length) {                                                         // 礦脈：灰色岩石 + 亮點
    diamondsPath(ore); ctx.fillStyle = cityTheme().ore; ctx.fill(); ctx.lineWidth = 1 / cam.z; ctx.strokeStyle = cityTheme().ore; ctx.stroke();
    if (cam.z > 0.6) { ctx.fillStyle = '#d6dbe3'; for (let k = 0; k < ore.length; k += 2) { const x = ore[k], y = ore[k + 1]; ctx.fillRect(isoX(x + 0.3, y + 0.5), isoY(x + 0.3, y + 0.5), 2.5, 2.5); ctx.fillRect(isoX(x + 0.7, y + 0.8), isoY(x + 0.7, y + 0.8) - 5, 2, 2); } }
  }
  if (forest.length) {
    if (cam.z < 0.55) { diamondsPath(forest); ctx.fillStyle = cityTheme().forest; ctx.fill(); }                 // 拉遠：只畫綠色地塊
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
  gr.addColorStop(0, activeTheme === 'neon' ? 'rgba(90,225,255,.62)' : 'rgba(255,214,140,.55)'); gr.addColorStop(1, 'rgba(255,214,140,0)');
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

// Soft atmospheric perspective: restrained blue-grey haze, drifting fog banks and a warm horizon glow.
function drawAtmosphericHaze() {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  const fogBoost = worldEvent && worldEvent.id === 'smog' ? 1.55 : worldEvent && worldEvent.id === 'rain' ? 1.22 : 1;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, 'rgba(192,218,230,' + (0.105 * fogBoost) + ')');
  sky.addColorStop(0.30, 'rgba(177,211,224,' + (0.065 * fogBoost) + ')');
  sky.addColorStop(0.62, 'rgba(174,207,218,' + (0.025 * fogBoost) + ')');
  sky.addColorStop(1, 'rgba(174,207,218,0)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const drift = nowMs * 0.004;
  for (let i = 0; i < 4; i++) {
    const x = ((W * (0.12 + i * 0.27) + Math.sin(drift * 0.017 + i * 1.7) * W * 0.045 + drift * (i % 2 ? -0.18 : 0.12)) % (W * 1.3)) - W * 0.15;
    const y = H * (0.16 + (i % 3) * 0.13) + Math.sin(drift * 0.011 + i) * H * 0.018;
    const radius = Math.max(70, W * (0.22 + (i % 2) * 0.07));
    const mist = ctx.createRadialGradient(x, y, 0, x, y, radius);
    mist.addColorStop(0, 'rgba(211,231,236,' + (0.035 * fogBoost) + ')');
    mist.addColorStop(0.55, 'rgba(186,215,226,' + (0.018 * fogBoost) + ')');
    mist.addColorStop(1, 'rgba(186,215,226,0)');
    ctx.fillStyle = mist; ctx.fillRect(x - radius, y - radius * 0.43, radius * 2, radius * 0.86);
  }
  const glow = ctx.createRadialGradient(W * 0.74, H * 0.44, 2, W * 0.74, H * 0.44, Math.max(120, W * 0.37));
  glow.addColorStop(0, 'rgba(255,205,148,0.028)');
  glow.addColorStop(1, 'rgba(255,205,148,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.restore();
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
  const flat = [], solid = [], roads = [], rails = [], water = [], ore = [], forest = [];
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
      if (d.conducts === 'road') roads.push({ x, y, type: t.type });
      else if (d.conducts === 'rail') rails.push({ x, y, type: t.type });
    }
  }
  drawTerrain(water, ore, forest, solid);
  for (const f of flat) blit(f);                                             // 先畫貼地的道路/管線
  drawContinuousRoads(roads);                                                 // 把相鄰道路重新連成完整柏油路面
  drawSidewalks(roads);                                                       // 沿道路兩側畫連續人行道
  // 不繪製斑馬線；行人只在道路旁的人行道活動。
  drawTrafficOverlay(roads);
  updateCars(dt, roads, rails, gx0, gx1, gy0, gy1);
  drawTransitRoutes();
  updatePedestrians(dt, roads, gx0, gx1, gy0, gy1);
  for (const car of cars) solid.push({ x: car.fx + (car.tx - car.fx) * car.t, y: car.fy + (car.ty - car.fy) * car.t, car, depth: 0.5 });
  for (const p of pedestrians) {
    const wx = p.fx + (p.tx - p.fx) * p.t, wy = p.fy + (p.ty - p.fy) * p.t;
    const sp = pedestrianScreenPoint(p, wx, wy);
    // Sort using the logical road position, but draw the person on the side-walk pixel position.
    solid.push({ x: wx + 0.5, y: wy + 0.5, ped: p, pedScreenX: sp.x, pedScreenY: sp.y, depth: 0.32 });
  }
  solid.sort((a, b) => (a.x + a.y + (a.depth || 0)) - (b.x + b.y + (b.depth || 0)));   // 畫家演算法：由後往前
  for (const s of solid) (s.car ? drawCar(s) : s.ped ? drawPedestrian(s) : s.tree ? drawTree(s) : blit(s));
  drawSelection();
  drawDayNight(solid);
  drawAtmosphericHaze();
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
    const mc = GAME_MODES[(stats && stats.mode) || 'classic'] || GAME_MODES.classic, actualCost = Math.ceil((d.cost + fee) * mc.buildMultiplier);
    msg = err ? ERR[err] : `${d.name}　${actualCost === 0 ? '免費建造' : '$' + actualCost}${fee && actualCost ? `（含森林整地費 $${Math.ceil(fee * mc.buildMultiplier)}）` : ''}　Shift 拖曳連續鋪、Ctrl 拖曳框選`;
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
    socket.emit('build', { x, y, type }, r => { cb(r); if (r && r.ok) { window.dispatchEvent(new CustomEvent('citymmo:building-placed', { detail: { type, x, y } })); const mc = GAME_MODES[(stats && stats.mode) || 'classic'] || GAME_MODES.classic; const paid = Math.ceil((B[type].cost + TR.clearFee(B[type], x, y)) * mc.buildMultiplier); sfx('build'); pops.push({ x: x + 0.5, y: y + 0.5, text: paid ? '-$' + paid : '$0 建造', color: paid ? '#ffb4a8' : '#9ef3e4', t0: nowMs }); } });
  }
  else if (tool.kind === 'bulldoze') {
    const t = getTile(x, y);
    socket.emit('bulldoze', { x, y }, r => { cb(r); if (r && r.ok && t) sfx('bulldoze'); if (r && r.ok && t) { const mc = GAME_MODES[(stats && stats.mode) || 'classic'] || GAME_MODES.classic; const refund = Math.floor(B[t.type].cost * mc.refundMultiplier); pops.push({ x: x + 0.5, y: y + 0.5, text: refund ? '+$' + refund : '$0 退款', color: '#b6ffb0', t0: nowMs }); } });
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
  else if (/^[1-9]$/.test(e.key)) { const keys = [...Object.keys(CATS), 'newbuildings', 'decorations', 'tools']; if (+e.key <= keys.length) showTab(keys[+e.key - 1]); } // 數字鍵切換分頁
  else if (e.key === 'b' || e.key === 'B') setTool({ kind: 'bulldoze' });
});

// ───────────────── UI：工具列 / 通知 / 外交面板 ─────────────────
const tabs = $('tabs'), items = $('items');
const buildingSearch = $('buildingSearch'), buildingCount = $('buildingCount');
let buildingSearchTerm = '';
let curTab = 'transport';
function paletteDefsForTab(k) {
  return k === 'tools'
    ? [{ id: 'claim', name: '擴張領地', tool: { kind: 'claim' } }, { id: 'diplo', name: '結盟（合併）', tool: { kind: 'diplo' } }, { id: 'unlink', name: '解除結盟', tool: { kind: 'unlink' } }, { id: 'gift', name: '贈送資金', tool: { kind: 'gift' } }, { id: 'bulldoze', name: '拆除', tool: { kind: 'bulldoze' } }]
    : Object.values(B).filter(d => k === 'newbuildings' ? d.group === 'newbuildings' : k === 'decorations' ? d.group === 'decoration' : !d.group && d.cat === k).map(d => ({ id: d.id, name: d.name, cost: d.cost, d, tool: { kind: 'build', type: d.id } }));
}
if (buildingSearch) buildingSearch.addEventListener('input', () => {
  buildingSearchTerm = String(buildingSearch.value || '').trim().toLocaleLowerCase();
  showTab(curTab);
});
function buildPalette() {
  tabs.innerHTML = ''; let tabNo = 0;
  for (const [k, label] of Object.entries({ ...CATS, newbuildings: '新建築', decorations: '城市裝飾', tools: '領地 / 外交' })) {
    const count = paletteDefsForTab(k).length;
    const b = document.createElement('button'); b.textContent = (++tabNo) + ' ' + label + ' · ' + count; b.title = label + '，共 ' + count + ' 項'; b.dataset.k = k; b.onclick = () => showTab(k); tabs.appendChild(b);
  }
  showTab(curTab);
}
function showTab(k) {
  curTab = k; [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
  items.innerHTML = '';
  const allDefs = paletteDefsForTab(k);
  const defs = buildingSearchTerm ? allDefs.filter(it => (it.name + ' ' + it.id).toLocaleLowerCase().includes(buildingSearchTerm)) : allDefs;
  if (buildingCount) buildingCount.textContent = buildingSearchTerm ? '找到 ' + defs.length + ' / ' + allDefs.length + ' 項' : '共 ' + allDefs.length + ' 項';
  if (!defs.length) {
    const empty = document.createElement('div'); empty.className = 'catalog-empty'; empty.textContent = '找不到符合的建築，試試別的名稱。'; items.appendChild(empty);
    markPoor(); return;
  }
  for (const it of defs) {
    const b = document.createElement('button'); b.className = 'item'; b.dataset.id = it.id;
    const locked = !!it.d && (it.d.unlock || 0) > (stats.peakPop || 0);                   // 城市等級不夠 → 鎖定
    const modeCfg = GAME_MODES[(stats && stats.mode) || 'classic'] || GAME_MODES.classic;
    const visibleCost = it.cost != null ? Math.ceil(it.cost * modeCfg.buildMultiplier) : null;
    if (locked) b.classList.add('locked'); else if (visibleCost != null) b.dataset.cost = visibleCost;
    if (it.d) {
      const s = getSprite(it.d, 3, 1), pv = document.createElement('canvas'); pv.width = s.w; pv.height = s.h;
      pv.getContext('2d').drawImage(s.img, s.sx, s.sy, s.w, s.h, 0, 0, s.w, s.h); b.appendChild(pv);
    }
    const nm = document.createElement('span'); nm.textContent = it.name; b.appendChild(nm);
    if (it.d && it.d.group === 'newbuildings') { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '新增'; b.appendChild(tag); }
    if (it.cost != null) { const sm = document.createElement('small'); sm.textContent = locked ? '🔒 人口 ' + it.d.unlock.toLocaleString() : (visibleCost === 0 ? '免費建造' : '$' + visibleCost.toLocaleString()); b.appendChild(sm); }
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
$('transitMode').addEventListener('click', () => {
  const panel = $('transitPanel'), open = panel.style.display !== 'block';
  panel.style.display = open ? 'block' : 'none'; $('transitMode').classList.toggle('on', open);
  if (open) { renderTransitPanel(); refreshTransitStationOptions(true); renderTransitDraftStops(); renderSavedTransitPlans(); }
});
$('closeTransitPanel').addEventListener('click', () => { $('transitPanel').style.display = 'none'; $('transitMode').classList.remove('on'); });
$('transitOverlayToggle').addEventListener('change', e => { transitOverlay = !!e.target.checked; toast(transitOverlay ? '已顯示自訂公車與地鐵路線' : '已隱藏公共運輸路線'); });
$('transitRouteMode').addEventListener('change', () => {
  transitStationOptionSignature = ''; refreshTransitStationOptions(true);
  if (transitDraftStops.length && transitDraftStops.some(s => {
    const t = (getTile(s.x, s.y) || {}).type; return $('transitRouteMode').value === 'metro' ? t && !['subway'].includes(t) : t && !['bus_stop','bus_station','bus_terminal'].includes(t);
  })) setTransitEditorMessage('提醒：目前站序中有站點不是這種交通方式，請移除後再加入正確站點。', 'bad');
});
$('transitAddStop').addEventListener('click', () => {
  const value = $('transitStationChoice').value;
  if (!value) return setTransitEditorMessage('請先選擇一個可用站點。', 'bad');
  const [x, y] = value.split(',').map(Number);
  if (transitDraftStops.some(s => s.x === x && s.y === y)) return setTransitEditorMessage('這個站點已在站序中。', 'bad');
  if (transitDraftStops.length >= 20) return setTransitEditorMessage('一條路線最多 20 個站點。', 'bad');
  const mode = $('transitRouteMode').value, station = (transitStationCache[mode] || []).find(s => s.x === x && s.y === y);
  transitDraftStops.push({ x, y, type: station && station.type }); renderTransitDraftStops(); setTransitEditorMessage(`已將「${transitStationLabel({x,y,type: station && station.type}, mode)}」加入站序。`);
});
$('transitSaveRoute').addEventListener('click', saveTransitDraft);
$('transitCancelEdit').addEventListener('click', clearTransitDraft);
refreshTransitStationOptions(true); renderTransitDraftStops(); renderSavedTransitPlans();

function hideInfo() { $('info').style.display = 'none'; }
function showInfo(t) {                                                            // 建築資訊卡：點建築（沒選工具時）
  const d = B[t.type], el = $('info'); if (!d) return;
  el.innerHTML = '';
  const h = document.createElement('h4'); h.textContent = d.name; el.appendChild(h);
  const row = (k, v) => { if (v == null || v === '' || v === 0) return; const r = document.createElement('div'); r.className = 'irow'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); el.appendChild(r); };
  const miss = [[1, '缺少道路'], [2, '電力不足'], [4, '水不足']].filter(([b]) => (t.n & b) && !(t.f & b)).map(x => x[1]);
  row('狀態', miss.length ? miss.join('、') : (t.n ? '運作中' : '一般'));
  const modeCfg = GAME_MODES[(stats && stats.mode) || 'classic'] || GAME_MODES.classic;
  row('分類', (d.group === 'decoration' ? '城市裝飾' : d.group === 'newbuildings' ? '新建築' : CATS[d.cat])); row('解鎖需求', d.unlock ? '人口 ' + d.unlock.toLocaleString() : 0); row('放置條件', NEEDS[d.needs]); row('造價', '$' + Math.ceil(d.cost * modeCfg.buildMultiplier).toLocaleString()); row('拆除退款', '$' + Math.floor(d.cost * modeCfg.refundMultiplier).toLocaleString());
  row('維護費', d.upkeep ? '$' + (d.upkeep * modeCfg.upkeepMultiplier).toLocaleString() + '/秒' : 0);
  const u = d.uses || {}; row('耗電', u.power); row('耗水', u.water);
  const s = d.supplies || {}; row('供電', s.power); row('供水', s.water);
  row('居住人口', d.pop); row('提供工作', d.jobs); row('稅收', d.tax ? '$' + d.tax + '/秒' : 0); row('營收', d.income ? '$' + d.income + '/秒' : 0);
  row('物資', d.goods); row('污染', d.pollution); row('幸福度', d.happy ? '+' + d.happy : 0);
  if (['bus_stop','bus_station','bus_terminal'].includes(t.type)) { const hint = document.createElement('p'); hint.className = 'transit-building-hint'; hint.textContent = '公車服務：開啟「公共運輸」，選擇此站並自行排列路線順序；至少 2 站且道路需連通。'; el.appendChild(hint); }
  if (t.type === 'subway') { const hint = document.createElement('p'); hint.className = 'transit-building-hint'; hint.textContent = '地鐵服務：開啟「公共運輸」，自行選擇地鐵站並排列站序；至少 2 站且鐵軌需連通。'; el.appendChild(hint); }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'info-close'; close.textContent = '收起 ×'; close.title = '收起建築資訊；再次點擊建築即可重新開啟'; close.onclick = hideInfo; el.appendChild(close);
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
let lastRenderedMode = 'classic';
const modePanel = $('modePanel'), modeChoices = $('modeChoices'), themeChoices = $('themeChoices');
const escapeText = v => String(v == null ? '' : v);
function renderModePanel() {
  if (!modeChoices || !themeChoices) return;
  const current = (stats && stats.mode) || 'classic';
  modeChoices.innerHTML = '';
  for (const mode of Object.values(GAME_MODES)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mode-choice' + (mode.id === current ? ' on' : '');
    const title = document.createElement('b'); title.textContent = mode.name;
    const desc = document.createElement('small'); desc.textContent = mode.description;
    b.append(title, desc);
    b.onclick = () => {
      if (!socket.connected) return toast('目前未連線，請連線後再切換模式。', true);
      b.disabled = true;
      socket.emit('mode:set', { mode: mode.id }, res => {
        b.disabled = false;
        if (res && res.ok) { stats.mode = mode.id; lastRenderedMode = mode.id; showTab(curTab); renderModePanel(); toast('已切換為「' + mode.name + '」。'); updateHover(); }
        else toast('模式切換失敗：' + ((res && (ERR[res.err] || res.err)) || '請重試'), true);
      });
    };
    modeChoices.appendChild(b);
  }
  [...modeChoices.children].forEach((b, i) => b.classList.toggle('on', Object.values(GAME_MODES)[i].id === current));
  themeChoices.innerHTML = '';
  for (const [id, theme] of Object.entries(CITY_THEMES)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'theme-choice' + (activeTheme === id ? ' on' : '');
    const dot = document.createElement('span'); dot.style.cssText = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + theme.grass1 + ';border:1px solid #ffffff66;margin-right:5px;flex:0 0 auto';
    const title = document.createElement('b'); title.textContent = theme.name;
    const desc = document.createElement('small'); desc.textContent = theme.desc;
    const left = document.createElement('span'); left.style.cssText = 'display:flex;align-items:center;gap:4px'; left.append(dot, title);
    b.append(left, desc);
    b.onclick = () => {
      activeTheme = id; store.set('cm_city_theme', id); grassPat = null; glowImg = null; renderModePanel();
      toast('城市外觀已改為「' + theme.name + '」，只有你的畫面會改變。');
    };
    themeChoices.appendChild(b);
  }
  const curMode = GAME_MODES[current] || GAME_MODES.classic;
  $('modeStatus').textContent = '目前玩法：' + curMode.name + '｜外觀：' + cityTheme().name;
  $('gameMode').textContent = '🎮 ' + curMode.name;
  $('gameMode').classList.toggle('on', modePanel.style.display === 'block');
}
$('gameMode').addEventListener('click', () => { modePanel.style.display = modePanel.style.display === 'block' ? 'none' : 'block'; renderModePanel(); });
$('closeModePanel').addEventListener('click', () => { modePanel.style.display = 'none'; $('gameMode').classList.remove('on'); });

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
