// Tests for content expansion and selectable city modes. Uses Node core only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../shared/buildings');
const ClientG = require('../assets/shared/buildings');
const { World } = require('./world');

// Prevent the front-end catalog from drifting away from the server catalog.
assert.deepStrictEqual(ClientG.BUILDINGS, G.BUILDINGS, 'browser and server building definitions must match');
assert.deepStrictEqual(ClientG.GAME_MODES, G.GAME_MODES, 'browser and server game modes must match');

// Every selectable building must have a dedicated sprite model, or be a road/network
// segment rendered by its line definition. This catches blank/generic new-building art.
const shapeSource = fs.readFileSync(path.join(__dirname, '../assets/js/shapes.js'), 'utf8');
const shapeSections = [
  shapeSource.match(/const SHAPES = \{([\s\S]*?)\n\};/),
  shapeSource.match(/const SIGNATURE_SHAPES = \{([\s\S]*?)\n\};/)
].filter(Boolean).map(m => m[1]);
const knownSprites = new Set();
for (const section of shapeSections) {
  for (const match of section.matchAll(/^\s{2}([A-Za-z_$][\w$]*)(?:\s*:\s*\([^)]*\)\s*=>|\s*\([^)]*\)\s*\{)/gm)) {
    knownSprites.add(match[1]);
  }
}
for (const [id, def] of Object.entries(G.BUILDINGS)) {
  assert(def.line || knownSprites.has(id), 'building needs a dedicated sprite or line rendering: ' + id);
}
assert.strictEqual(Object.keys(G.BUILDINGS).length, 169, 'expected 169 catalog entries including the 100 expanded buildings');

assert(G.BUILDINGS.bus_stop && G.BUILDINGS.bus_stop.cat === 'transport', 'early-game bus stop is available in the transport category');

// New city-expansion buildings must have real coloured sprite art and economy rules.
for (const id of ["chinatown_gate","neon_market","waterfront_promenade","botanical_dome","convention_centre","film_studio","marina","food_market","urban_farm","sorting_centre","logistics_hub","data_exchange","science_museum","grand_arena","world_wonder","eco_transit_hub"]) {
  assert(G.BUILDINGS[id], 'city expansion building exists: ' + id);
  assert(/^#[0-9a-f]{6}$/i.test(G.BUILDINGS[id].color), 'building has a real colour: ' + id);
  assert(knownSprites.has(id), 'building has bespoke non-placeholder sprite art: ' + id);
}


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
