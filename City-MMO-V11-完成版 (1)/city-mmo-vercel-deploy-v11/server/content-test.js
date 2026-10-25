// Tests for content expansion and selectable city modes. Uses Node core only.
const assert = require('assert');
const G = require('../shared/buildings');
const ClientG = require('../assets/shared/buildings');
const { World } = require('./world');

// Prevent the front-end catalog from drifting away from the server catalog.
assert.deepStrictEqual(ClientG.BUILDINGS, G.BUILDINGS, 'browser and server building definitions must match');
assert.deepStrictEqual(ClientG.GAME_MODES, G.GAME_MODES, 'browser and server game modes must match');
assert(G.BUILDINGS.bus_stop && G.BUILDINGS.bus_stop.cat === 'transport', 'early-game bus stop is available in the transport category');

for (const id of ['beach_resort','aquarium','museum','medical_campus','research_center','wind_farm','robot_factory','quantum_lab','orbital_port','sky_garden']) {
  assert(G.BUILDINGS[id], 'new building exists: ' + id);
  assert.strictEqual(G.BUILDINGS[id].group, 'newbuildings', 'new-building group: ' + id);
}
for (const id of ['fountain','flower_plaza','sculpture','tree_grove','lantern_park','clock_tower']) {
  assert(G.BUILDINGS[id], 'decoration exists: ' + id);
  assert.strictEqual(G.BUILDINGS[id].group, 'decoration', 'decoration group: ' + id);
  assert(!G.BUILDINGS[id].uses || !G.BUILDINGS[id].uses.road, 'decorations do not require roads: ' + id);
}
assert.deepStrictEqual(Object.keys(G.GAME_MODES), ['classic','creative','challenge']);
const w = new World();
const p = w.createPlayer('mode-token', 'ModeCity');
const c = w.ownedChunks(p.id)[0], x = c.cx * 50, y = c.cy * 50;
p.money = 0;
assert(w.setMode(p.id, 'creative').ok, 'creative mode can be selected');
assert(w.build(p.id, x + 21, y + 24, 'fountain').ok, 'creative mode allows free decoration');
assert.strictEqual(p.money, 0, 'creative build costs nothing');
assert.strictEqual(w.claimCost(p.id), 0, 'creative claim cost is free');
assert(w.setMode(p.id, 'challenge').ok, 'challenge mode can be selected');
p.money = 100;
const before = p.money;
assert(w.build(p.id, x + 22, y + 24, 'road').ok, 'challenge mode still allows building when money is sufficient');
assert.strictEqual(p.money, before - Math.ceil(20 * 1.25), 'challenge construction is 25% more expensive');
assert.strictEqual(w.setMode(p.id, 'bad-mode').err, 'bad_request', 'unknown modes are rejected');
const w2 = new World(); w2.fromJSON(JSON.parse(JSON.stringify(w)));
assert.strictEqual(w2.players.get(p.id).mode, 'challenge', 'mode persists across save/load');
console.log('content tests passed');
