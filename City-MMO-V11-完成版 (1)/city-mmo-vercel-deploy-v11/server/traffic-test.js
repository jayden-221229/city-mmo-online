'use strict';
const assert = require('assert');
const TrafficPhysics = require('../assets/js/traffic-physics.js');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'assets/js/game.js'), 'utf8');

const iso = (x, y) => ({ x: (x - y) * 32, y: (x + y) * 16 });
const pointAt = (c, t) => iso(c.fx + (c.tx - c.fx) * t, c.fy + (c.ty - c.fy) * t);
const cars = [
  { fx: 0, fy: 0, tx: 1, ty: 0, t: 0.72, kind: 'car' },
  { fx: 0, fy: 0, tx: 1, ty: 0, t: 0.35, kind: 'car' },
];
const gap = 12;
const progress = TrafficPhysics.resolveProgress(cars, [0.74, 0.78], pointAt, gap);
assert(progress[0] >= cars[0].t && progress[1] >= cars[1].t,
  'collision resolution slows cars without reversing their progress');
assert(TrafficPhysics.distance(pointAt(cars[0], progress[0]), pointAt(cars[1], progress[1])) >= gap - 0.02,
  'following vehicles maintain bumper spacing instead of overlapping');
assert(progress[1] <= 0.41, 'the following vehicle queues behind the leader');

const crossingCars = [
  { fx: 0, fy: 1, tx: 1, ty: 1, t: 0.35, kind: 'car' },
  { fx: 1, fy: 0, tx: 1, ty: 1, t: 0.35, kind: 'car' },
];
const crossingProgress = TrafficPhysics.resolveProgress(crossingCars, [0.70, 0.70], pointAt, gap);
assert.deepStrictEqual(crossingProgress, [0.70, 0.70],
  'crossing routes do not deadlock one another');

const opposingCars = [
  { fx: 0, fy: 0, tx: 1, ty: 0, t: 0.25, kind: 'car' },
  { fx: 1, fy: 0, tx: 0, ty: 0, t: 0.25, kind: 'car' },
];
const opposingProgress = TrafficPhysics.resolveProgress(opposingCars, [0.62, 0.62], pointAt, gap);
assert.deepStrictEqual(opposingProgress, [0.62, 0.62],
  'opposing traffic can keep moving without being globally frozen');

const normalLane = TrafficPhysics.laneOffsetForWidth(18);
const highwayLane = TrafficPhysics.laneOffsetForWidth(28);
assert(normalLane >= 4.8 && normalLane < highwayLane, 'wider roads use a wider lane offset');
assert(highwayLane >= 8 && highwayLane <= 9, 'highways have visibly separated opposing lanes');
const forward = TrafficPhysics.offsetPoint(100, 100, 32, 16, normalLane, 1);
const reverse = TrafficPhysics.offsetPoint(100, 100, -32, -16, normalLane, 1);
assert(TrafficPhysics.distance(forward, reverse) >= normalLane * 1.9,
  'opposite directions are drawn on opposing sides of a two-way road');

assert(/drawContinuousRoads\(roads\)/.test(game), 'connected asphalt segments are drawn continuously');
assert(/drawSidewalks\(roads\)/.test(game), 'sidewalks are drawn in the map render pass');
assert(!/drawCrosswalks\(roads\)/.test(game) && !/function drawCrosswalks\(/.test(game), 'crosswalks are fully disabled');
assert(/TrafficPhysics\.laneOffsetForWidth\(roadSegmentWidth/.test(game), 'vehicle lane offset scales with road width');
assert(/const P = \(gx, gy, z = 0\) => \[ix \+ \(gx - gy\) \* TW \/ 2, iy \+ \(gx \+ gy\) \* TH \/ 2 - z\]/.test(game), 'vehicles use the same isometric ground plane as buildings');
assert(/const isoBox =/.test(game) && /topFace/.test(game) && /longSideWindows/.test(game), 'vehicles are rendered as volumetric isometric boxes with roof and window faces');
assert(!/ctx\.rotate\(angle\)/.test(game.slice(game.indexOf('function drawCar(o)'), game.indexOf('// ───────────────── 行人動畫'))), 'no flat screen-space vehicle rotation remains');
assert(/filter\(\(\[nx, ny\]\) => isRoad\(nx, ny\)/.test(game), 'cars choose only connected road tiles as the route');
assert(/return Math\.min\(1, c\.t \+ dt \* c\.sp \* congestionSpeed\)/.test(game), 'vehicles progress continuously through signals');
assert(!/stopAtRedSignal|signalGreen\(c\.tx, c\.ty\)/.test(game), 'vehicle updates no longer stop at red lights');
assert(!/drawTrafficSignals\(roads\)/.test(game), 'traffic light poles are removed when the light system is disabled');
assert(/function refreshTransitRoutes\(/.test(game) && /TransitNetwork\.buildOrderedRoute\(networks\[mode\], orderedStops/.test(game), 'bus routes follow the player-defined stop order');
assert(!/TransitNetwork\.buildLoops\(/.test(game), 'the running client no longer automatically invents station order');
assert(/TransitNetwork\.buildOrderedRoute/.test(game) && /kind === 'metro'/.test(game), 'metro trains follow user-defined connected rail routes');
assert(/function drawTransitRoutes\(/.test(game) && /transitOverlay/.test(game), 'public-transport route overlay exists');
console.log('traffic flow, opposing lanes, public transport, metro routing, road-only routing, vehicle sprites and crosswalk removal tests passed');
