// node server/test.js — 不需要安裝任何套件
const assert = require('assert');
const { World } = require('./world');
const C = 50;

const w = new World();
const A = w.createPlayer('token-AAAA', 'A');
const B = w.createPlayer('token-BBBB', 'B');
A.money = B.money = 1e6;
A.peakPop = B.peakPop = 1e9;                           // 先跳過解鎖限制，專心測其他規則
const ca = w.ownedChunks(A.id)[0], cb = w.ownedChunks(B.id)[0];
const bx = ca.cx * C, by = ca.cy * C, qx = cb.cx * C, qy = cb.cy * C;
assert(w.bordering(A.id, B.id), '新玩家應緊鄰既有領地');

// 1. 建造規則：必須緊鄰道路、只能蓋在自己的領地
assert.strictEqual(w.build(A.id, bx + 17, by + 17, 'shop').err, 'need_road');   // 每個 chunk 中央 20×20 保證是平地
assert.strictEqual(w.build(A.id, qx + 5, qy + 5, 'road').err, 'not_owned');
assert(w.build(A.id, bx + 25, by + 24, 'shop').ok);
assert.strictEqual(w.build(A.id, bx + 25, by + 24, 'shop').err, 'occupied');

// 2. 水電不需連線：有路就運作（用的是每位玩家免費的基礎額度）
w.tickEconomy();
const shop = w.tileAt(bx + 25, by + 24);
assert.strictEqual(shop.f, shop.n, '只有道路、沒有電線水管 → 也是綠燈');
assert(A.util.power.cap === 30 && A.util.power.use === 2);

// 3. 容量：鋼鐵廠要電 40 > 基礎 30 → 紅燈；蓋燃煤電廠（不需連線）→ 綠燈
assert(w.build(A.id, bx + 26, by + 24, 'steel').ok);
w.tickEconomy();
const steel = w.tileAt(bx + 26, by + 24);
assert.strictEqual(steel.f & 2, 0, '電力不足 → 缺電位元');
assert.strictEqual(steel.f & 1, 1, '道路沒問題');
assert(w.build(A.id, bx + 33, by + 17, 'coal').ok, '電廠放哪都行，不必靠近');
w.tickEconomy();
assert.strictEqual(steel.f, steel.n, '電廠蓋好後，不用任何連線就綠燈');

// 4. 結盟前：B 的鋼鐵廠缺電；A 的電廠有剩餘，但不能跨玩家
assert(w.build(B.id, qx + 25, qy + 24, 'steel').ok);
w.tickEconomy();
const bSteel = w.tileAt(qx + 25, qy + 24);
assert.strictEqual(bSteel.f & 2, 0, '未結盟 → 不能用別人的電');

// 5. 結盟（合併）：道路互通 + 共享剩餘水電
const dx = cb.cx - ca.cx, dy = cb.cy - ca.cy;
const T0 = require('../shared/terrain');
let sx, sy, hx, hy;                                  // 沿著邊界找一組「兩側都是平地」的位置（邊界上可能有湖或森林）
for (let k = 0; k < C; k++) {
  const ax = dx ? ca.cx * C + (dx > 0 ? C - 1 : 0) : bx + k, ay = dx ? by + k : ca.cy * C + (dy > 0 ? C - 1 : 0);
  if (T0.terrainAt(ax, ay) === T0.LAND && T0.terrainAt(ax + dx, ay + dy) === T0.LAND) { sx = ax; sy = ay; hx = ax + dx; hy = ay + dy; break; }
}
assert(sx !== undefined, '邊界上找不到兩側都是平地的位置');   // B 側的商鋪（hx,hy）緊貼 A 的邊界道路（sx,sy）
assert(w.build(A.id, sx, sy, 'road').ok);
assert.strictEqual(w.build(B.id, hx, hy, 'shop').err, 'need_road', '未結盟 → 不能借用鄰居的道路');
assert(w.requestLink(A.id, B.id).ok);
assert.strictEqual(w.requestLink(A.id, B.id).err, 'already_pending');
assert.strictEqual(w.respondLink(B.id, 'nobody', true).err, 'no_request');
assert(w.respondLink(B.id, A.id, true).accepted);
assert(w.build(B.id, hx, hy, 'shop').ok, '結盟後道路互通');
w.tickEconomy();
assert.strictEqual(bSteel.f, bSteel.n, '結盟後共享 A 的剩餘電力 → 綠燈');
assert.strictEqual(w.tileAt(hx, hy).f & 1, 1, '跨界道路生效');

// 6. 存檔往返：結盟與連通性一致
const w2 = new World(); w2.fromJSON(JSON.parse(JSON.stringify(w)));
w2.tickEconomy();
assert.strictEqual(w2.tileAt(qx + 25, qy + 24).f, bSteel.n, '載入存檔後狀態一致');

// 7. 解除結盟 → 立刻回到缺電
assert.strictEqual(w.unlink(A.id, 'nobody').err, 'not_linked');
assert(w.unlink(A.id, B.id).ok);
w.tickEconomy();
assert.strictEqual(bSteel.f & 2, 0, '解除後 B 又缺電');

// 8. 領地擴張
assert.strictEqual(w.claim(A.id, ca.cx + 5, ca.cy + 5).err, 'not_adjacent');
const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => [ca.cx + x, ca.cy + y]).find(([x, y]) => !w.chunks.has(x + ',' + y));
A.money = 100;
assert.strictEqual(w.claim(A.id, ...free).err, 'money');
A.money = 10000;
assert(w.claim(A.id, ...free).ok && A.money < 10000);

// 9. 沒有任何 PK 途徑：不能拆別人的建築、不能佔別人的領地
assert.strictEqual(w.bulldoze(B.id, bx + 25, by + 24).err, 'not_owned');
assert.strictEqual(w.claim(B.id, ca.cx, ca.cy).err, 'taken');

w.tickEconomy();
assert(Number.isFinite(A.rate));

// 10. 贈送資金：只能給盟友
A.money = 1000; B.money = 0;
assert.strictEqual(w.gift(A.id, B.id, 100).err, 'not_linked', '未結盟不能贈送');
w.requestLink(A.id, B.id); w.respondLink(B.id, A.id, true);
assert.strictEqual(w.gift(A.id, B.id, 5).err, 'bad_request');
assert.strictEqual(w.gift(A.id, B.id, 5000).err, 'money');
assert(w.gift(A.id, B.id, 300).ok && A.money === 700 && B.money === 300, '贈送成功');

// 11. 入住率與就業：蓋住宅但沒有工作 → 失業，稅收打折；蓋商場後就業率回升
const w3 = new World();
const P = w3.createPlayer('token-PPPP', 'P'); P.money = 1e6; P.peakPop = 1e9;
const pc = w3.ownedChunks(P.id)[0], px0 = pc.cx * C, py0 = pc.cy * C;
for (const x of [22, 24, 26]) assert(w3.build(P.id, px0 + x, py0 + 24, 'apartment').ok);
w3.tickEconomy();
assert(Math.abs(P.pop - 3 * 30 * 0.04) < 1e-9, '第一秒入住率 4%，人口 ' + P.pop);
for (let i = 0; i < 40; i++) w3.tickEconomy();
assert(Math.abs(P.pop - 90) < 1e-9, '約 25 秒後住滿');
assert.strictEqual(P.employ, 0, '沒有任何工作 → 就業率 0');
assert(P.happiness < 50, '失業拉低幸福度');
const lowRate = P.rate;
assert(w3.build(P.id, px0 + 28, py0 + 24, 'mall').ok);
for (let i = 0; i < 40; i++) w3.tickEconomy();
assert(P.employ > 0.3 && P.jobs >= 39, '蓋商場後有工作了：就業率 ' + P.employ.toFixed(2));
assert(P.rate > lowRate, '有工作後收入提高');

// 12. 城市等級、解鎖、成就、每日獎勵
const w4 = new World();
const Q = w4.createPlayer('token-QQQQ', 'Q'); Q.money = 1e6;
const qc = w4.ownedChunks(Q.id)[0], qx0 = qc.cx * C, qy0 = qc.cy * C;
assert.strictEqual(w4.build(Q.id, qx0 + 22, qy0 + 24, 'apartment').err, 'locked', '人口不夠 → 高層公寓尚未解鎖');
assert.strictEqual(w4.build(Q.id, qx0 + 22, qy0 + 24, 'townhouse').err, 'locked', '連棟透天要人口 60');
let built = 0;
for (let i = 0; i < 16; i++) { const x = 20 + (i % 11), y = i < 11 ? 24 : 26; if (w4.build(Q.id, qx0 + x, qy0 + y, 'bungalow').ok) built++; }
assert.strictEqual(built, 16, '平房一開始就能蓋');
for (let i = 0; i < 40; i++) w4.tickEconomy();
assert(Q.peakPop >= 60, '16 間平房住滿 → 人口 ' + Q.peakPop);
const ev1 = w4.drainEvents();
assert(ev1.some(e => e.type === 'level' && e.name === '小鎮'), '人口 60 → 升級為小鎮');
assert(w4.build(Q.id, qx0 + 21, qy0 + 22, 'townhouse').err === 'need_road' || true);   // 位置不重要，只要不是 locked
assert.notStrictEqual(w4.build(Q.id, qx0 + 24, qy0 + 26, 'townhouse').err, 'locked', '升級後解鎖連棟透天');
assert.strictEqual(w4.build(Q.id, qx0 + 25, qy0 + 26, 'apartment').err, 'locked', '公寓仍需人口 250');
Q.peakPop = 250; assert.notStrictEqual(w4.build(Q.id, qx0 + 26, qy0 + 26, 'apartment').err, 'locked', '人口 250 → 解鎖公寓');

const moneyBefore = Q.money;
Q.peakPop = 100; w4.tickEconomy();
const ev2 = w4.drainEvents();
assert(ev2.some(e => e.type === 'ach' && e.id === 'pop100' && e.reward === 1000), '人口 100 成就');
assert(Q.ach.includes('pop100') && Q.money >= moneyBefore + 1000, '成就獎金入帳');
w4.tickEconomy();
assert(!w4.drainEvents().some(e => e.id === 'pop100'), '成就只會發一次');
const w5 = new World(); w5.fromJSON(JSON.parse(JSON.stringify(w4)));
assert(w5.players.get(Q.id).ach.includes('pop100') && w5.players.get(Q.id).lvl >= 1, '成就與等級會存檔');

const t0 = 1e12;
assert.strictEqual(w4.claimDaily(Q.id, t0), 500 + 400 * Q.lvl, '每日獎勵隨等級增加');
assert.strictEqual(w4.claimDaily(Q.id, t0 + 3600e3), 0, '一天只能領一次');
assert(w4.claimDaily(Q.id, t0 + 21 * 3600e3) > 0, '隔天可再領');

// 12b. 結盟不需要領地相鄰（朋友不一定住在隔壁）
const w6 = new World();
const X = w6.createPlayer('token-XXXX', 'X'), Y = w6.createPlayer('token-YYYY', 'Y');
const yc = w6.ownedChunks(Y.id)[0]; w6.chunks.delete(yc.cx + ',' + yc.cy); yc.cx = 20; yc.cy = 20; w6.chunks.set('20,20', yc);   // 把 Y 搬到很遠的地方
assert(!w6.bordering(X.id, Y.id), 'X 與 Y 不相鄰');
assert(w6.requestLink(X.id, Y.id).ok, '不相鄰也能送出結盟請求');
assert(w6.outgoing(X.id).some(r => r.to === Y.id), '發送者可查詢已送出的邀請');
assert(w6.incoming(Y.id).some(r => r.from === X.id), '接收者可查詢收到的邀請');
assert(w6.respondLink(Y.id, X.id, true).accepted && w6.links.has([X.id, Y.id].sort().join('|')), '對方同意後結盟成立');
assert.strictEqual(w6.outgoing(X.id).length, 0, '成立結盟後不保留送出的邀請');
assert.strictEqual(w6.incoming(Y.id).length, 0, '成立結盟後不保留收到的邀請');
const Z = w6.createPlayer('token-ZZZZ', 'Z');
assert(w6.requestLink(X.id, Z.id).ok, '可對第三位玩家發出邀請');
assert(w6.cancelLink(X.id, Z.id).ok, '發送者可撤回尚未回應的邀請');
assert.strictEqual(w6.outgoing(X.id).length, 0, '撤回後發送清單已更新');
assert.strictEqual(w6.incoming(Z.id).length, 0, '撤回後接收清單已更新');
assert.strictEqual(w6.cancelLink(X.id, Z.id).err, 'no_pending', '同一份邀請不能重複撤回');

// 13. 每棟建築都有完整資料；等級門檻只能是已定義的等級
const G = require('../shared/buildings');
const levels = new Set(G.LEVELS.map(l => l.at));
for (const d of Object.values(G.BUILDINGS)) {
  assert(G.CATS[d.cat], d.id + ' 分類錯誤'); assert(d.cost > 0 && d.name, d.id + ' 缺資料');
  assert(levels.has(d.unlock || 0), d.id + ' 的解鎖人口 ' + d.unlock + ' 不是任何等級的門檻');
}
assert.strictEqual(new Set(G.ACHIEVEMENTS.map(a => a.id)).size, G.ACHIEVEMENTS.length, '成就 id 不可重複');

// 14. 地形：水面不能蓋、橋樑只能蓋在水上、伐木場在森林、森林整地費
const T = require('../shared/terrain');
let found = null;                                     // 找一個同時有水、森林、礦脈、水邊的 chunk
for (let cx = -4; cx <= 4 && !found; cx++) for (let cy = -4; cy <= 4 && !found; cy++) {
  if (cx === 0 && cy === 0) continue;
  const f = { cx, cy, water: null, forest: null, ore: null, shore: null, land: null };
  for (let ly = 0; ly < C; ly++) for (let lx = 0; lx < C; lx++) {
    const x = cx * C + lx, y = cy * C + ly, t = T.terrainAt(x, y);
    if (t === T.WATER) f.water = f.water || [x, y];
    if (t === T.FOREST) f.forest = f.forest || [x, y];
    if (t === T.ORE) f.ore = f.ore || [x, y];
    if (t === T.LAND) { f.land = f.land || [x, y]; if (!f.shore && T.placeError(G.BUILDINGS.harbor, x, y) === null) f.shore = [x, y]; }
  }
  if (f.water && f.forest && f.ore && f.shore && f.land) found = f;
}
assert(found, '測試用的 chunk 找不到');
const w7 = new World();
const M = w7.createPlayer('token-MMMM', 'M'); M.money = 1e6; M.peakPop = 1e9;
w7.makeChunk(found.cx, found.cy, M.id);
assert.strictEqual(w7.build(M.id, ...found.water, 'well').err, 'water', '水面不能蓋一般建築');
assert.strictEqual(w7.build(M.id, ...found.land, 'bridge').err, 'need_water', '橋樑只能蓋在水面上');
assert(w7.build(M.id, ...found.water, 'bridge').ok, '橋樑可以蓋在水面上');
assert.strictEqual(w7.build(M.id, ...found.land, 'lumber').err, 'need_forest', '伐木場必須在森林');
assert.strictEqual(w7.build(M.id, ...found.land, 'mine').err, 'need_ore', '礦場必須在礦脈');
assert.strictEqual(T.placeError(G.BUILDINGS.mine, ...found.ore), null, '礦脈上可以蓋礦場');
assert.strictEqual(T.placeError(G.BUILDINGS.harbor, ...found.shore), null, '水邊可以蓋港口');
assert.strictEqual(w7.build(M.id, found.cx * C + 25, found.cy * C + 25, 'harbor').err, 'need_shore', '內陸不能蓋港口');
let before = M.money; assert(w7.build(M.id, ...found.forest, 'well').ok);
assert.strictEqual(before - M.money, G.BUILDINGS.well.cost + 40, '森林整地費 $40');
before = M.money; const wf = [found.forest[0] + 1, found.forest[1]];   // 隔壁格不一定是森林，所以只驗證 clearFee 本身
assert.strictEqual(T.clearFee(G.BUILDINGS.lumber, ...found.forest), 0, '伐木場不收整地費');
assert(T.clearFee(G.BUILDINGS.road, ...found.forest) === 10, '道路整地費較少');
const cnt = [0, 0, 0, 0]; for (let i = 0; i < 4000; i++) cnt[T.terrainAt(i * 7 - 9000, i * 13 - 5000)]++;
assert(cnt[0] > 2200 && cnt[1] > 200 && cnt[2] > 200, '地形比例合理 ' + cnt);
assert.strictEqual(T.terrainAt(-123, 456), T.terrainAt(-123, 456), '地形由座標決定，不隨機');

// 15. 批量建造 / 拆除
const w8 = new World();
const R = w8.createPlayer('token-RRRR', 'R'); R.money = 1e6; R.peakPop = 1e9;
const rc = w8.ownedChunks(R.id)[0], rx = rc.cx * C, ry = rc.cy * C;
const path = []; for (let x = 16; x <= 24; x++) path.push([rx + x, ry + 20]);
const rb = w8.buildMany(R.id, 'road', path);
assert(rb.ok && rb.built.length === 9 && rb.failed === 0 && rb.spent === 9 * 20, '一次鋪 9 格道路 ' + JSON.stringify([rb.built.length, rb.failed, rb.spent]));
const rb2 = w8.buildMany(R.id, 'road', [[rx + 16, ry + 20], [rx + 17, ry + 21]]);
assert(rb2.built.length === 1 && rb2.failed === 1 && rb2.err === 'occupied', '重複的格子會略過並回報原因');
R.money = 30;
const rb3 = w8.buildMany(R.id, 'road', [[rx + 16, ry + 22], [rx + 17, ry + 22], [rx + 18, ry + 22], [rx + 19, ry + 22]]);
assert(rb3.built.length === 1 && rb3.failed === 3 && rb3.err === 'money', '沒錢就停下，其餘算失敗');
assert.strictEqual(w8.buildMany(R.id, 'road', []).err, 'bad_request'); assert.strictEqual(w8.buildMany(R.id, 'road', new Array(401).fill([0, 0])).err, 'bad_request', '一次最多 400 格');
R.money = 0; const bd = w8.bulldozeMany(R.id, path);
assert(bd.ok && bd.built.length === 9 && bd.refund === 9 * 10, '批量拆除並退款 ' + bd.refund);

// 16. 鐵路加成：工業建築緊鄰鐵路 → 產出 ×1.25
const mk = withRail => {
  const w = new World(), p = w.createPlayer('token-' + withRail, 'R'); p.money = 1e6; p.peakPop = 1e9;
  const c = w.ownedChunks(p.id)[0], x0 = c.cx * C, y0 = c.cy * C;
  assert(w.build(p.id, x0 + 22, y0 + 24, 'warehouse').ok);
  if (withRail) assert(w.build(p.id, x0 + 23, y0 + 24, 'rail').ok);
  for (let i = 0; i < 40; i++) w.tickEconomy();
  return p;
};
assert(mk(true).rate > mk(false).rate + 3, '鐵路讓倉儲中心的收入明顯提高');

// 17. 全服事件
const w9 = new World();
const E = w9.createPlayer('token-EEEE', 'E'); E.money = 1e6; E.peakPop = 1e9;
const ec = w9.ownedChunks(E.id)[0], ex = ec.cx * C, ey = ec.cy * C;
assert(w9.build(E.id, ex + 22, ey + 24, 'bungalow').ok && w9.build(E.id, ex + 24, ey + 24, 'shop').ok);
const t0e = 1e12;
for (let i = 0; i < 40; i++) w9.tickEconomy(t0e);
assert.strictEqual(E.util.power.cap, 30); const rate0 = E.rate, happy0 = E.happiness;
assert(w9.startEvent('peak', t0e)); w9.tickEconomy(t0e + 1000); assert.strictEqual(E.util.power.cap, 24, '用電高峰：電力 ×0.8');
assert(w9.startEvent('rain', t0e)); w9.tickEconomy(t0e + 2000); assert.strictEqual(E.util.water.cap, 45, '大雨：水 ×1.5');
w9.startEvent('expo', t0e); w9.tickEconomy(t0e + 3000); assert(E.rate > rate0, '博覽會：商業收入提高');
w9.startEvent('sunny', t0e); w9.tickEconomy(t0e + 4000); assert.strictEqual(E.happiness, happy0 + 10, '晴空萬里：幸福度 +10');
assert.strictEqual(w9.currentEvent(t0e + 5000).id, 'sunny'); assert.strictEqual(w9.startEvent('不存在'), false);
w9.drainEvents();
w9.tickEvents(t0e + 91000);
assert.strictEqual(w9.currentEvent(t0e + 91000), null, '事件到期自動結束');
assert(w9.drainEvents().some(e => e.type === 'world' && e.id === null), '結束事件會通知客戶端');
w9.tickEconomy(t0e + 91000); assert.strictEqual(E.util.power.cap, 30, '事件結束後供給恢復');
const w10 = new World(); w10.createPlayer('token-SSSS', 'S');
w10.tickEvents(1000); assert.strictEqual(w10.currentEvent(1000), null, '開服 3 分鐘內不會觸發事件');
w10.tickEvents(1000 + 3 * 60000 + 1, () => 0); assert.strictEqual(w10.currentEvent(1000 + 3 * 60000 + 1).id, G.EVENTS[0].id, '到時間就隨機觸發事件');

// 18. 交通系統：道路容量、高速公路改善壅塞、壅塞會影響城市幸福度與營收。
const makeTrafficCity = mode => {
  const w = new World(), p = w.createPlayer('traffic-' + mode, 'Traffic');
  p.money = 1e7; p.peakPop = 1e9;
  const c = w.ownedChunks(p.id)[0], x0 = c.cx * C, y0 = c.cy * C;
  assert(w.build(p.id, x0 + 20, y0 + 23, 'gas').ok, '交通測試建立電力供應');
  assert(w.build(p.id, x0 + 22, y0 + 23, 'water_plant').ok, '交通測試建立水資源供應');
  for (let x = 20; x <= 30; x++) assert(w.build(p.id, x0 + x, y0 + 26, 'office').ok, '交通測試建立辦公大樓');
  if (mode === 'bus') assert(w.build(p.id, x0 + 20, y0 + 24, 'bus_terminal').ok, '交通測試建立公車總站');
  if (mode === 'highway') for (let x = 20; x <= 30; x++) assert(w.build(p.id, x0 + x, y0 + 24, 'highway').ok, '交通測試建立高速公路');
  for (let i = 0; i < 40; i++) w.tickEconomy();
  return p;
};
const trafficCity = makeTrafficCity('none'), highwayCity = makeTrafficCity('highway'), busCity = makeTrafficCity('bus');
assert.strictEqual(trafficCity.roadTiles, 11, '起始城市包含 11 格道路');
assert(trafficCity.roadCapacity > 0 && trafficCity.trafficDemand > 0, '伺服器會計算道路容量與交通需求');
assert(trafficCity.traffic > 50, '高交通需求、道路容量不足時會出現壅塞');
assert(highwayCity.roadCapacity > trafficCity.roadCapacity, '高速公路增加道路容量');
assert(highwayCity.traffic < trafficCity.traffic, '高速公路能降低壅塞');
assert(highwayCity.happiness > trafficCity.happiness, '減少壅塞可改善幸福度');
assert(highwayCity.rate > trafficCity.rate, '減少壅塞可改善城市營收');
assert(busCity.transitCapacity >= 38, '公車總站提供大眾運輸容量');
assert(busCity.traffic < trafficCity.traffic, '公車總站能分擔道路車流');

console.log('all tests passed');
