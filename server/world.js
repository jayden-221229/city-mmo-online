/**
 * 世界狀態與規則（純邏輯，不依賴 socket，方便單元測試 / 之後搬進 worker / Redis）。
 *
 * 資料結構
 *   chunks : Map<"cx,cy", { cx, cy, owner, tiles: Map<localIdx, {type, f, n}> }>
 *            f = 已滿足的需求位元，n = 需要的位元（1=道路 2=電 4=水）；f === n 即「綠燈」
 *   players: Map<id, {...}>        links: Set<"idA|idB">（已核准的外交連線）
 *   pending: Map<"from>to", {from,to}>
 */
const G = require('../shared/buildings');
const { CHUNK, BUILDINGS, NET_BIT, needBits } = G;
const BASE = G.BASE_SUPPLY;
const T = require('../shared/terrain');

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mod = v => ((v % CHUNK) + CHUNK) % CHUNK;
const cOf = v => Math.floor(v / CHUNK);
const ck = (cx, cy) => cx + ',' + cy;
const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class World {
  constructor() {
    this.chunks = new Map();
    this.players = new Map();
    this.links = new Set();
    this.pending = new Map();
    this.event = null;        // 目前的全服事件 { id, until }
    this.nextEventAt = 0;
    this.events = [];         // 成就 / 升級事件，由 server.js 每秒取走並通知玩家
    this.snapshot = [];       // 最近一次 recompute 的扁平格子清單，經濟結算共用
    this.dirty = true;        // 建造/拆除/外交變動 → 下個 tick 重算連通性
  }

  // ───────── 查詢 ─────────
  chunkAt(x, y) { return this.chunks.get(ck(cOf(x), cOf(y))); }
  tileAt(x, y) { const c = this.chunkAt(x, y); return c && c.tiles.get(mod(y) * CHUNK + mod(x)); }
  /** 兩個擁有者之間的網路能否穿越邊界：同一人，或已有外交連線 */
  canCross(a, b) { return a === b || this.links.has(pair(a, b)); }
  pub(p) { return { id: p.id, name: p.name, color: p.color }; }
  playerByToken(token) { for (const p of this.players.values()) if (p.token === token) return p; }
  ownedChunks(pid) { return [...this.chunks.values()].filter(c => c.owner === pid); }
  claimCost(pid) { return G.CLAIM_BASE * this.ownedChunks(pid).length; }

  // ───────── 玩家 / 領地 ─────────
  createPlayer(token, name) {
    let id; do { id = Math.random().toString(36).slice(2, 8); } while (this.players.has(id));
    const p = { id, token, name: String(name || '').slice(0, 16) || '市長', color: `hsl(${(Math.random() * 360) | 0},65%,55%)`,
      money: G.START_MONEY, pop: 0, happiness: 50, rate: 0, goods: 0,
      peakPop: 0, lvl: 0, ach: [], lastDaily: 0, gifted: 0 };
    this.players.set(id, p);
    const [cx, cy] = this.pickSpawn();
    this.makeChunk(cx, cy, id, true);
    this.dirty = true;
    return p;
  }

  /** 新玩家出生在「緊貼既有領地、離原點最近」的空區域 → 世界長成連續拼圖，鄰居立刻能外交 */
  pickSpawn() {
    if (!this.chunks.size) return [0, 0];
    const cand = new Map();
    for (const c of this.chunks.values()) for (const [dx, dy] of DIRS) {
      const k = ck(c.cx + dx, c.cy + dy);
      if (!this.chunks.has(k)) cand.set(k, [c.cx + dx, c.cy + dy]);
    }
    const dist = ([x, y]) => Math.max(Math.abs(x), Math.abs(y));
    const pool = [...cand.values()].sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  makeChunk(cx, cy, owner, starter = false) {
    const ch = { cx, cy, owner, tiles: new Map() };
    if (starter) for (let lx = 20; lx <= 30; lx++) ch.tiles.set(25 * CHUNK + lx, { type: 'road', f: 0, n: 0 });  // 新手道路
    this.chunks.set(ck(cx, cy), ch);
    return ch;
  }

  claim(pid, cx, cy) {
    const p = this.players.get(pid);
    if (!p || !Number.isInteger(cx) || !Number.isInteger(cy)) return { err: 'bad_request' };
    if (this.chunks.has(ck(cx, cy))) return { err: 'taken' };
    if (!DIRS.some(([dx, dy]) => { const n = this.chunks.get(ck(cx + dx, cy + dy)); return n && n.owner === pid; })) return { err: 'not_adjacent' };
    const cost = this.claimCost(pid);
    if (p.money < cost) return { err: 'money', cost };
    p.money -= cost;
    this.dirty = true;
    return { ok: true, chunk: this.makeChunk(cx, cy, pid), cost };
  }

  // ───────── 建造 / 拆除 ─────────
  adjacentRoad(x, y, pid) {
    return DIRS.some(([dx, dy]) => {
      const t = this.tileAt(x + dx, y + dy);
      return t && BUILDINGS[t.type].conducts === 'road' && this.canCross(pid, this.chunkAt(x + dx, y + dy).owner);
    });
  }

  build(pid, x, y, type) {
    const p = this.players.get(pid), d = BUILDINGS[type];
    if (!p || !d || !Number.isInteger(x) || !Number.isInteger(y)) return { err: 'bad_request' };
    if ((p.peakPop || 0) < (d.unlock || 0)) return { err: 'locked', need: d.unlock };     // 城市等級不夠，尚未解鎖
    const ch = this.chunkAt(x, y);
    if (!ch || ch.owner !== pid) return { err: 'not_owned' };
    const i = mod(y) * CHUNK + mod(x);
    if (ch.tiles.has(i)) return { err: 'occupied' };
    const terr = T.placeError(d, x, y); if (terr) return { err: terr };                         // 地形限制：水面不能蓋、礦場要在礦脈上…
    const fee = T.clearFee(d, x, y);                                                             // 森林整地費
    if (p.money < d.cost + fee) return { err: 'money' };
    if (d.uses && d.uses.road && !this.adjacentRoad(x, y, pid)) return { err: 'need_road' };
    p.money -= d.cost + fee;
    const tile = { type, f: 0, n: needBits(d), occ: 0 };
    ch.tiles.set(i, tile);
    this.dirty = true;
    return { ok: true, tile, ch };
  }

  /** 批量建造 / 拆除（拖曳鋪路、框選填滿）。一次最多 400 格；遇到沒錢或未解鎖就停止，其他失敗（例如地形不符）會略過 */
  buildMany(pid, type, tiles) {
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > 400) return { err: 'bad_request' };
    const p = this.players.get(pid), before = p ? p.money : 0, built = [];
    let failed = 0, err = null;
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[k], r = Array.isArray(t) ? this.build(pid, t[0], t[1], type) : { err: 'bad_request' };
      if (r.ok) { built.push({ x: t[0], y: t[1], tile: r.tile, ch: r.ch }); continue; }
      failed++; err = err || r.err;
      if (r.err === 'money' || r.err === 'locked') { failed += tiles.length - k - 1; break; }
    }
    return { ok: true, built, failed, err, spent: p ? before - p.money : 0 };
  }
  bulldozeMany(pid, tiles) {
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > 400) return { err: 'bad_request' };
    const p = this.players.get(pid), before = p ? p.money : 0, removed = [];
    let failed = 0, err = null;
    for (const t of tiles) {
      const r = Array.isArray(t) ? this.bulldoze(pid, t[0], t[1]) : { err: 'bad_request' };
      if (r.ok) removed.push({ x: t[0], y: t[1], ch: r.ch }); else { failed++; err = err || r.err; }
    }
    return { ok: true, built: removed, failed, err, refund: p ? p.money - before : 0 };
  }
  bulldoze(pid, x, y) {
    const p = this.players.get(pid);
    const ch = Number.isInteger(x) && Number.isInteger(y) ? this.chunkAt(x, y) : null;
    if (!p || !ch || ch.owner !== pid) return { err: 'not_owned' };
    const i = mod(y) * CHUNK + mod(x), t = ch.tiles.get(i);
    if (!t) return { err: 'empty' };
    p.money += Math.floor(BUILDINGS[t.type].cost / 2);
    ch.tiles.delete(i);
    this.dirty = true;
    return { ok: true, ch };
  }

  // ───────── 外交 ─────────
  bordering(a, b) {
    for (const c of this.chunks.values()) if (c.owner === a)
      for (const [dx, dy] of DIRS) { const n = this.chunks.get(ck(c.cx + dx, c.cy + dy)); if (n && n.owner === b) return true; }
    return false;
  }
  requestLink(from, to) {
    if (from === to || !this.players.has(from) || !this.players.has(to)) return { err: 'bad_request' };
    const k = pair(from, to);
    if (this.links.has(k)) return { err: 'already_linked' };
    if ([...this.pending.values()].some(r => pair(r.from, r.to) === k)) return { err: 'already_pending' };
    this.pending.set(from + '>' + to, { from, to, t: Date.now() });
    return { ok: true };
  }
  respondLink(me, from, accept) {
    if (!this.pending.delete(from + '>' + me)) return { err: 'no_request' };
    if (accept) { this.links.add(pair(from, me)); this.dirty = true; }
    return { ok: true, accepted: !!accept };
  }
  /** 撤回自己送出的結盟邀請；只有發送者可取消該筆邀請。 */
  cancelLink(from, to) {
    if (!this.pending.delete(from + '>' + to)) return { err: 'no_pending' };
    return { ok: true };
  }
  incoming(pid) { return [...this.pending.values()].filter(r => r.to === pid); }
  outgoing(pid) { return [...this.pending.values()].filter(r => r.from === pid); }
  /** 每日登入獎勵：每 20 小時一次，金額隨城市等級增加 */
  claimDaily(pid, now = Date.now()) {
    const p = this.players.get(pid);
    if (!p || now - (p.lastDaily || 0) < 20 * 3600 * 1000) return 0;
    p.lastDaily = now;
    const amount = 500 + 400 * (p.lvl || 0);
    p.money += amount;
    return amount;
  }
  eventId(now = Date.now()) { return this.event && now < this.event.until ? this.event.id : null; }
  currentEvent(now = Date.now()) { return this.eventId(now) ? { ...this.event } : null; }
  startEvent(id, now = Date.now()) {
    const e = G.EVENTS.find(x => x.id === id);
    if (!e) return false;
    this.event = { id, until: now + (e.duration || 90000) }; this.dirty = true;            // 影響供給 → 下個 tick 重算
    this.events.push({ type: 'world', id, name: e.name, icon: e.icon, desc: e.desc, good: e.good, until: this.event.until });
    return true;
  }
  tickEvents(now = Date.now(), rnd = Math.random) {
    if (this.event && now >= this.event.until) { this.event = null; this.dirty = true; this.events.push({ type: 'world', id: null }); }
    if (!this.nextEventAt) this.nextEventAt = now + 3 * 60000;                              // 開服 3 分鐘後才會有第一個事件
    if (!this.event && now >= this.nextEventAt && this.players.size) {
      this.startEvent(G.EVENTS[Math.floor(rnd() * G.EVENTS.length)].id, now);
      this.nextEventAt = now + (8 + rnd() * 8) * 60000;
    }
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
  gift(from, to, amount) {                                          // 贈送資金給盟友（合作玩法，沒有任何對戰）
    const a = this.players.get(from), b = this.players.get(to);
    if (!a || !b || from === to || !Number.isInteger(amount) || amount < 10 || amount > 100000) return { err: 'bad_request' };
    if (!this.links.has(pair(from, to))) return { err: 'not_linked' };
    if (a.money < amount) return { err: 'money' };
    a.money -= amount; b.money += amount; a.gifted = (a.gifted || 0) + amount;
    return { ok: true };
  }
  unlink(a, b) {
    if (!this.links.delete(pair(a, b))) return { err: 'not_linked' };
    this.dirty = true;
    return { ok: true };
  }

  // ───────── 核心：道路 BFS + 水電分配 ─────────
  /**
   * 道路：BFS 洪水填充。把全世界格子攤平成清單並建立 "x,y" 雜湊表，從每條道路出發沿 4 鄰居擴散；
   *       鄰居屬於別的玩家時，必須有已核准的外交連線才能跨界（canCross）。
   * 水電：不需要電線或水管。每位玩家的供給 = 基礎額度 + 自己蓋的發電廠 / 水塔，先供應自己的建築；
   *       有外交連線的玩家組成「聯盟」（union-find），各自用完後剩下的供給，由聯盟內不足的人共享。
   * 最後 bits === need → 綠燈；缺哪一項，就是那一項的位元沒亮。
   */
  recompute(now = Date.now()) {
    const tiles = [], at = new Map();
    for (const ch of this.chunks.values()) for (const [i, t] of ch.tiles) {
      const x = ch.cx * CHUNK + (i % CHUNK), y = ch.cy * CHUNK + Math.floor(i / CHUNK);
      const e = { x, y, t, ch, owner: ch.owner, def: BUILDINGS[t.type], bits: 0, need: 0 };
      tiles.push(e); at.set(x + ',' + y, e);
    }
    const nbrs = e => {
      const out = [];
      for (const [dx, dy] of DIRS) { const n = at.get((e.x + dx) + ',' + (e.y + dy)); if (n && this.canCross(e.owner, n.owner)) out.push(n); }
      return out;
    };

    // ① 道路：BFS 求連通塊，消費者只要緊鄰任一條（可到達的）道路即可
    const roadComp = new Map(); let cid = 0;
    for (const s of tiles) {
      if (roadComp.has(s) || s.def.conducts !== 'road') continue;
      roadComp.set(s, ++cid);
      const q = [s];
      for (let h = 0; h < q.length; h++)                       // 用游標代替 shift，O(1)
        for (const n of nbrs(q[h])) if (!roadComp.has(n) && n.def.conducts === 'road') { roadComp.set(n, cid); q.push(n); }
    }
    for (const e of tiles) {
      if (!(e.def.uses && e.def.uses.road)) continue;
      e.need |= NET_BIT.road;
      if (nbrs(e).some(n => roadComp.has(n))) e.bits |= NET_BIT.road;
    }

    // 鐵路加成：工業建築緊鄰鐵路 → 產出 ×1.25
    for (const e of tiles) if (e.def.cat === 'industrial') e.rail = nbrs(e).some(n => n.def.conducts === 'rail');

    // ② 水電：各玩家自己的供給
    const own = new Map();
    for (const p of this.players.values()) own.set(p.id, {
      power: { cap: BASE.power, left: BASE.power, use: 0 }, water: { cap: BASE.water, left: BASE.water, use: 0 } });
    for (const e of tiles) {
      const o = own.get(e.owner), s = e.def.supplies;
      if (o && s) for (const net of ['power', 'water']) if (s[net]) { o[net].cap += s[net]; o[net].left += s[net]; }
    }
    const evId = this.eventId(now), mulP = evId === 'peak' ? 0.8 : 1, mulW = evId === 'rain' ? 1.5 : 1;   // 全服事件：用電高峰 / 大雨
    for (const o of own.values()) { o.power.cap *= mulP; o.power.left *= mulP; o.water.cap *= mulW; o.water.left *= mulW; }
    // 聯盟（外交連線）→ union-find
    const parent = new Map([...this.players.keys()].map(id => [id, id]));
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const l of this.links) { const [a, b] = l.split('|'); if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); }

    for (const net of ['power', 'water']) {
      const bit = NET_BIT[net], unmet = [];
      for (const e of tiles) {                                 // 第一輪：先用自己的供給
        const use = e.def.uses && e.def.uses[net];
        if (!use) continue;
        e.need |= bit;
        const o = own.get(e.owner);
        if (o && o[net].left >= use) { o[net].left -= use; o[net].use += use; e.bits |= bit; } else if (o) unmet.push(e);
      }
      const pool = new Map();                                  // 第二輪：聯盟內的剩餘供給
      for (const [pid, o] of own) { const r = find(pid); pool.set(r, (pool.get(r) || 0) + o[net].left); }
      for (const e of unmet) {
        const r = find(e.owner), use = e.def.uses[net];
        if ((pool.get(r) || 0) >= use) { pool.set(r, pool.get(r) - use); e.bits |= bit; own.get(e.owner)[net].use += use; }
      }
    }
    for (const [pid, o] of own) this.players.get(pid).util = { power: { cap: o.power.cap, use: o.power.use }, water: { cap: o.water.cap, use: o.water.use } };

    const changed = new Set();
    for (const e of tiles) if (e.t.f !== e.bits || e.t.n !== e.need) { e.t.f = e.bits; e.t.n = e.need; changed.add(e.ch); }
    this.snapshot = tiles;
    return changed;
  }

  // ───────── 經濟（每秒一次） ─────────
  /**
   * 入住率：綠燈的建築每秒 +4%（約 25 秒住滿），紅燈每秒 -10%。人口、工作、產出都乘上入住率。
   * 就業：就業率 = 工作數 / 人口；人手充足度 = 人口 / 工作數。
   *   住宅稅收 × (0.4 + 0.6 × 就業率)；商業 / 工業產出 × (0.4 + 0.6 × 人手充足度)；失業會拉低幸福度。
   * 污染：發電廠與工廠增加，資源回收廠（負污染）在運作時抵銷；總污染最低為 0。
   */
  tickEconomy(now = Date.now()) {
    const changed = this.dirty ? this.recompute(now) : new Set();
    this.dirty = false;
    const evId = this.eventId(now), gain = evId === 'festival' ? 0.08 : 0.04;
    const acc = new Map(), land = new Map();
    for (const c of this.chunks.values()) land.set(c.owner, (land.get(c.owner) || 0) + 1);
    for (const p of this.players.values()) acc.set(p.id, { pop: 0, jobs: 0, resTax: 0, bizTax: 0, shop: 0, cap: 0, goods: 0, pol: 0, joy: 0, upkeep: 0, total: 0, built: {}, roadTiles: 0, roadCapacity: 0, railTiles: 0, transitCapacity: 0, trafficDemand: 0 });
    for (const e of this.snapshot) {
      const a = acc.get(e.owner), d = e.def, t = e.t;
      if (!a) continue;
      a.upkeep += d.upkeep || 0;
      if ((d.pollution || 0) > 0) a.pol += d.pollution;
      if (!d.line) { a.total++; a.built[d.id] = (a.built[d.id] || 0) + 1; }
      // 道路容量：高速公路可以承載更多車流，單行道較有效率，橋樑容量較低。
      if (d.conducts === 'road') {
        a.roadTiles++;
        a.roadCapacity += ({ road: 7, oneway: 9, highway: 20, bridge: 6 }[d.id] || 7);
      } else if (d.conducts === 'rail') {
        a.railTiles++;
        a.transitCapacity += 1.8;
      }
      const ok = e.bits === e.need;
      const trafficSlow = 1 - clamp(((this.players.get(e.owner) || {}).traffic || 0) / 100, 0, 1) * 0.25;
      t.occ = ok ? Math.min(1, (t.occ || 0) + gain * trafficSlow) : Math.max(0, (t.occ || 0) - 0.1);
      if (!ok) continue;                                        // 紅燈 → 不運作、不產出
      const o = t.occ;
      if ((d.pollution || 0) < 0) a.pol += d.pollution * o;
      const rb = e.rail ? 1.25 : 1;                             // 鐵路加成
      a.pop += (d.pop || 0) * o; a.jobs += (d.jobs || 0) * o; a.goods += (d.goods || 0) * o * rb; a.joy += d.happy || 0;
      // 交通需求來自居民通勤、工作、商業人流與貨運；大眾運輸可抵銷一部分道路車流。
      a.trafficDemand += ((d.pop || 0) * 0.055 + (d.jobs || 0) * 0.03 + (d.demand || 0) * 0.04 + (d.goods || 0) * 0.45) * o;
      if (d.id === 'subway') a.transitCapacity += 22 * o;
      if (d.id === 'bus_station') a.transitCapacity += 16 * o;
      if (d.id === 'bus_terminal') a.transitCapacity += 38 * o;
      if (d.id === 'airport') a.trafficDemand += 16 * o;
      if (d.id === 'harbor') a.trafficDemand += 8 * o;
      if (d.cat === 'residential') a.resTax += (d.tax || 0) * o; else a.bizTax += (d.tax || 0) * o * rb;
      if (d.income) { a.shop += d.income * o; a.cap += (d.demand || 0) * o; }
    }
    for (const p of this.players.values()) {
      const a = acc.get(p.id);
      const demand = a.cap ? clamp(a.pop / a.cap, 0.2, 1) : 0;                  // 商業收入受人口支撐
      const employ = a.pop > 0 ? clamp(a.jobs / a.pop, 0, 1) : 1;               // 就業率
      const staff = a.jobs > 0 ? clamp(a.pop / a.jobs, 0.3, 1) : 1;             // 人手充足度
      const pol = Math.max(0, a.pol) * (evId === 'smog' ? 1.5 : 1);
      const effectiveDemand = Math.max(0, a.trafficDemand - a.transitCapacity);
      const roadLoad = a.roadCapacity > 0 ? effectiveDemand / a.roadCapacity : (effectiveDemand > 0 ? 2 : 0);
      // 道路負載超過約 55% 後開始壅塞；壅塞會降低幸福度、商業/貨運收入與入住速度。
      const congestion = clamp((roadLoad - 0.55) / 0.85, 0, 1);
      p.traffic = Math.round(congestion * 100);
      p.trafficLoad = Math.round(roadLoad * 100);
      p.roadTiles = a.roadTiles; p.roadCapacity = Math.round(a.roadCapacity);
      p.trafficDemand = +a.trafficDemand.toFixed(1); p.transitCapacity = +a.transitCapacity.toFixed(1);
      p.pop = a.pop; p.goods = a.goods; p.jobs = a.jobs; p.employ = employ; p.shopCap = a.cap;
      p.happiness = clamp(50 + a.joy + (evId === 'sunny' ? 10 : 0) - pol * 0.4 - (1 - employ) * 25 - congestion * 12, 0, 100);  // 服務加分、污染、失業與壅塞扣分
      const landValue = 0.5 + p.happiness / 100;                                // 幸福度 → 地價/收入倍率
      const roadEfficiency = 1 - congestion * 0.3;
      const gross = a.resTax * (0.4 + 0.6 * employ) + (a.bizTax + a.shop * demand * (evId === 'expo' ? 1.5 : 1) + a.goods * 2 * (evId === 'harvest' ? 1.5 : 1)) * (0.4 + 0.6 * staff) * roadEfficiency;
      p.rate = gross * landValue - a.upkeep;
      p.money = Math.max(0, p.money + p.rate);
      this.progress(p, a, land.get(p.id) || 0, employ, pol);
    }
    return changed;
  }

  /** 城市等級（解鎖建築）與成就（一次性獎金）。結果放進 this.events，由 server.js 通知玩家 */
  progress(p, a, chunks, employ, pol) {
    p.peakPop = Math.max(p.peakPop || 0, Math.floor(a.pop));
    const lvl = G.levelIndex(p.peakPop);
    if (lvl > (p.lvl || 0)) { p.lvl = lvl; this.events.push({ pid: p.id, type: 'level', lvl, name: G.LEVELS[lvl].name }); }
    const allies = [...this.links].filter(l => l.split('|').includes(p.id)).length;
    const ctx = { peakPop: p.peakPop, pop: a.pop, chunks, total: a.total, built: a.built, allies, employ, pol, money: p.money, gifted: p.gifted || 0 };
    p.ach = p.ach || [];
    for (const ach of G.ACHIEVEMENTS) if (!p.ach.includes(ach.id) && ach.check(ctx)) {
      p.ach.push(ach.id); p.money += ach.reward;
      this.events.push({ pid: p.id, type: 'ach', id: ach.id, name: ach.name, reward: ach.reward });
    }
  }

  // ───────── 序列化 ─────────
  chunkPayload(ch) {
    const o = this.players.get(ch.owner);
    return { cx: ch.cx, cy: ch.cy, owner: ch.owner, ownerInfo: o && this.pub(o), tiles: [...ch.tiles].map(([i, t]) => [i, t.type, t.f, t.n]) };
  }
  /** 全服領地一覽（小地圖用）：[cx, cy, ownerId] + 玩家名稱/顏色 */
  worldMap() {
    return { chunks: [...this.chunks.values()].map(c => [c.cx, c.cy, c.owner]), players: [...this.players.values()].map(p => this.pub(p)) };
  }
  toJSON() {
    return {
      players: [...this.players.values()], links: [...this.links], pending: [...this.pending.values()],
      chunks: [...this.chunks.values()].map(c => ({ cx: c.cx, cy: c.cy, owner: c.owner, tiles: [...c.tiles].map(([i, t]) => [i, t.type]) })),
    };
  }
  fromJSON(j) {
    this.players = new Map(j.players.map(p => [p.id, p]));
    for (const p of this.players.values()) Object.assign(p, { peakPop: p.peakPop || 0, lvl: p.lvl || 0, ach: p.ach || [], lastDaily: p.lastDaily || 0, gifted: p.gifted || 0 });   // 舊存檔補預設值
    this.links = new Set(j.links);
    this.pending = new Map(j.pending.map(r => [r.from + '>' + r.to, r]));
    this.chunks = new Map(j.chunks.map(c => [ck(c.cx, c.cy), {
      cx: c.cx, cy: c.cy, owner: c.owner,
      tiles: new Map(c.tiles.filter(([, type]) => BUILDINGS[type]).map(([i, type]) => [i, { type, f: 0, n: needBits(BUILDINGS[type]), occ: 1 }])),
    }]));
    this.dirty = true;
  }
}

module.exports = { World, ck, cOf, mod };
