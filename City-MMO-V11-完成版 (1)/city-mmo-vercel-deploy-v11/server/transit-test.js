'use strict';
const assert = require('assert');
const TransitNetwork = require('../assets/js/transit-network.js');
const { World } = require('./world');
const { BUILDINGS } = require('../shared/buildings');

assert(BUILDINGS.bus_stop, 'bus stops exist in the shared building catalog');
assert.strictEqual(BUILDINGS.bus_stop.unlock, 0, 'bus stops are available from the beginning');
assert.strictEqual(BUILDINGS.bus_stop.uses.road, 1, 'bus stops require a connected road');

const nodes = [[0,0],[1,0],[2,0],[2,1],[1,1],[0,1]].map(([x,y]) => ({ x, y, owner: 'p1' }));
const network = new Map(nodes.map(n => [TransitNetwork.key(n.x, n.y), n]));
const routes = TransitNetwork.buildLoops(network, [
  { key: 'stop-a', access: ['0,0'] },
  { key: 'stop-b', access: ['2,1'] },
], (a,b) => a.owner === b.owner);
assert.strictEqual(routes.length, 1, 'legacy planner still handles connected route loops');
assert.strictEqual(routes[0].stopCount, 2, 'legacy planner includes both stops');
assert(routes[0].stopKeys.has('0,0') && routes[0].stopKeys.has('2,1'), 'route keeps both stop access points');
const path = routes[0].nodes;
for (let i = 0; i < path.length; i++) {
  const a = path[i], b = path[(i + 1) % path.length];
  assert(Math.abs(a.x-b.x) + Math.abs(a.y-b.y) === 1, 'route follows adjacent connected network tiles including its loop closure');
}
const split = new Map([
  ['0,0', {x:0,y:0,owner:'p1'}], ['1,0', {x:1,y:0,owner:'p1'}],
  ['5,5', {x:5,y:5,owner:'p1'}], ['6,5', {x:6,y:5,owner:'p1'}],
]);
assert.strictEqual(TransitNetwork.buildLoops(split, [
  { key:'a', access:['0,0'] }, { key:'b', access:['6,5'] }
], (a,b) => a.owner === b.owner).length, 0, 'disconnected stations never create an invalid route');

const ordered = TransitNetwork.buildOrderedRoute(network, [
  { key: 'stop-b', access: ['2,0'] }, { key: 'stop-a', access: ['0,0'] }
], (a, b) => a.owner === b.owner);
assert(ordered, 'a user-defined ordered route can be planned on a connected network');
assert.deepStrictEqual(ordered.orderedStopKeys, ['stop-b', 'stop-a'], 'manual route preserves the chosen stop order instead of rearranging stops');
for (let i = 0; i < ordered.nodes.length; i++) {
  const a = ordered.nodes[i], b = ordered.nodes[(i + 1) % ordered.nodes.length];
  assert(Math.abs(a.x-b.x) + Math.abs(a.y-b.y) === 1, 'manual route only uses adjacent road/rail tiles');
}

const w = new World();
const player = w.createPlayer('transit-test-token', 'TransitCity');
const chunk = w.ownedChunks(player.id)[0];
const x = chunk.cx * 50 + 20, y = chunk.cy * 50 + 24; // starter road lies directly south at y+1
const built = w.build(player.id, x, y, 'bus_stop');
assert(built.ok, 'a bus stop can be built adjacent to the starter road');
w.tickEconomy(Date.now() + 1000);
assert(player.transitCapacity > 0, 'operating bus stop adds public-transit capacity to city economics');
console.log('public transport tests passed: bus stops, route loops, disconnected networks, rail loop routing helper and economy capacity');

// Player-defined public transport lines preserve user-selected station order,
// can be edited/deleted by their owner only, and persist in the world save.
const customWorld = new World();
const customPlayer = customWorld.createPlayer('manual-transit-token', 'ManualCity');
const ownChunk = customWorld.ownedChunks(customPlayer.id)[0];
const baseX = ownChunk.cx * 50;
const baseY = ownChunk.cy * 50;
const stopA = { x: baseX + 20, y: baseY + 24 };
const stopB = { x: baseX + 24, y: baseY + 24 };
assert(customWorld.build(customPlayer.id, stopA.x, stopA.y, 'bus_stop').ok, 'manual route stop A can be built beside starter road');
assert(customWorld.build(customPlayer.id, stopB.x, stopB.y, 'bus_stop').ok, 'manual route stop B can be built beside starter road');
const manuallySaved = customWorld.saveTransitRoute(customPlayer.id, {
  name: '住宅區－市中心線', mode: 'bus', stops: [stopB, stopA], vehicleCount: 3, color: '#f4c95d', enabled: true
});
assert(manuallySaved.ok, 'user can save a route after selecting stops');
assert.deepStrictEqual(manuallySaved.route.stops, [stopB, stopA], 'route stores stops in the exact user-defined order');
assert.strictEqual(manuallySaved.route.vehicleCount, 3, 'route stores user-selected vehicle count');
assert.strictEqual(manuallySaved.route.color, '#f4c95d', 'route stores user-selected line color');
// An isolated road-connected stop is a valid station, but an active route may
// not jump across disconnected road networks. The player can still save it paused.
const isolatedRoad = { x: baseX + 40, y: baseY + 40 };
const isolatedStop = { x: baseX + 40, y: baseY + 39 };
assert(customWorld.build(customPlayer.id, isolatedRoad.x, isolatedRoad.y, 'road').ok, 'isolated test road can be built');
assert(customWorld.build(customPlayer.id, isolatedStop.x, isolatedStop.y, 'bus_stop').ok, 'test station can be built beside isolated road');
assert.strictEqual(customWorld.saveTransitRoute(customPlayer.id, { name: '斷路測試', mode: 'bus', stops: [stopA, isolatedStop], enabled: true }).err, 'route_disconnected', 'server rejects active line with disconnected segments');
const pausedDisconnected = customWorld.saveTransitRoute(customPlayer.id, { name: '待建路線', mode: 'bus', stops: [stopA, isolatedStop], enabled: false });
assert(pausedDisconnected.ok && pausedDisconnected.route.enabled === false, 'a future route may be saved paused while the player builds connections');
const savedWorld = customWorld.toJSON();
const loadedWorld = new World(); loadedWorld.fromJSON(savedWorld);
assert.deepStrictEqual(loadedWorld.publicTransitRoutes()[0].stops, [stopB, stopA], 'manual stop order persists after save/load');
const stranger = loadedWorld.createPlayer('other-transit-token', 'OtherCity');
assert.strictEqual(loadedWorld.deleteTransitRoute(stranger.id, manuallySaved.route.id).err, 'not_owned', 'another player cannot delete route they do not own');
const edited = loadedWorld.saveTransitRoute(customPlayer.id, { ...manuallySaved.route, name: '市中心快線', vehicleCount: 4 });
assert(edited.ok, 'route owner can edit a line');
assert.strictEqual(edited.route.name, '市中心快線', 'route edit saves new user-selected name');
assert.strictEqual(edited.route.vehicleCount, 4, 'route edit saves new vehicle count');
assert(loadedWorld.deleteTransitRoute(customPlayer.id, manuallySaved.route.id).ok, 'route owner can delete their own line');
assert(loadedWorld.deleteTransitRoute(customPlayer.id, pausedDisconnected.route.id).ok, 'route owner can remove a paused future route');
console.log('manual route tests passed: ordered stops, editable route settings, persistence, ownership and connectivity validation');
