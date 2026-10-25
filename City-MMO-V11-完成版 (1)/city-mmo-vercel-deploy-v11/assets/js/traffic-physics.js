/* Lightweight client-side road traffic helpers. Kept deterministic and testable in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrafficPhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function gridPointAt(car, t) {
    return {
      x: car.fx + 0.5 + (car.tx - car.fx) * t,
      y: car.fy + 0.5 + (car.ty - car.fy) * t,
    };
  }

  function dot(p, d) { return p.x * d.x + p.y * d.y; }
  function cross(p, d) { return d.x * p.y - d.y * p.x; }

  /*
   * Follow-the-leader queueing, intentionally limited to cars travelling in the
   * same direction on the same straight lane. The previous all-pairs collision
   * solver treated cars crossing at an intersection as permanent obstacles;
   * once two paths overlapped it could freeze every car forever. Opposing traffic
   * now uses visually separated lanes and does not block the whole simulation.
   */
  function resolveProgress(cars, proposed, pointAt, gapFor, passes = 8) {
    const old = cars.map((car) => Math.max(0, Math.min(1, Number(car.t) || 0)));
    const next = proposed.map((t, i) => Math.max(old[i], Math.min(1, Number(t) || 0)));
    if (cars.length < 2) return next;

    const direction = (car) => ({ x: Math.sign(car.tx - car.fx), y: Math.sign(car.ty - car.fy) });
    const starts = cars.map((car) => gridPointAt(car, 0));
    const headings = cars.map(direction);
    const oldS = cars.map((car, i) => dot(gridPointAt(car, old[i]), headings[i]));
    const distancePerTile = cars.map((car) => Math.max(1, distance(pointAt(car, 0), pointAt(car, 1))));
    const gapPx = (a, b) => typeof gapFor === 'function' ? gapFor(cars[a], cars[b]) : gapFor;

    for (let pass = 0; pass < passes; pass++) {
      let changed = false;
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          const di = headings[i], dj = headings[j];
          if (di.x !== dj.x || di.y !== dj.y || (di.x === 0 && di.y === 0)) continue;
          // Exact same lane line only: different adjacent roads and cross traffic never lock each other.
          if (Math.abs(cross(starts[i], di) - cross(starts[j], dj)) > 1e-5) continue;
          const leader = oldS[i] >= oldS[j] ? i : j;
          const follower = leader === i ? j : i;
          if (Math.abs(oldS[i] - oldS[j]) < 1e-5) continue;
          const d = headings[leader];
          const leaderS = dot(gridPointAt(cars[leader], next[leader]), d);
          const followerStartS = dot(starts[follower], d);
          const pxPerTile = distancePerTile[follower];
          const neededTiles = Math.max(0, gapPx(leader, follower)) / pxPerTile;
          const maxProgress = leaderS - neededTiles - followerStartS;
          if (next[follower] > maxProgress + 1e-6) {
            // Clamp forward motion only. If already too close, hold until the leader creates room.
            const capped = Math.max(old[follower], Math.min(next[follower], maxProgress));
            if (capped < next[follower] - 1e-7) {
              next[follower] = capped;
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
    }
    return next;
  }

  // Keep opposing directions visibly separated according to the width of the road.
  // Values are in the same world-pixel units used by the canvas renderer.
  function laneOffsetForWidth(width) {
    const w = Math.max(12, Number(width) || 18);
    return Math.min(9, Math.max(4.8, w * 0.30));
  }

  function offsetPoint(baseX, baseY, dirX, dirY, offset, side) {
    const len = Math.hypot(dirX, dirY) || 1;
    return { x: baseX - (dirY / len) * offset * side, y: baseY + (dirX / len) * offset * side };
  }

  return Object.freeze({ resolveProgress, offsetPoint, distance, laneOffsetForWidth });
});
