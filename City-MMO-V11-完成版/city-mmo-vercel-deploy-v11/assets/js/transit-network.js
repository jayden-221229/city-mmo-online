/* Public-transport route helpers. Deterministic, small, testable, no dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TransitNetwork = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (x, y) => `${x},${y}`;

  function shortestPath(network, fromKey, toKey, canTravel) {
    if (!network.has(fromKey) || !network.has(toKey)) return null;
    if (fromKey === toKey) return [network.get(fromKey)];
    const prev = new Map([[fromKey, null]]), queue = [fromKey];
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head], node = network.get(k);
      for (const [dx, dy] of DIRS) {
        const nk = key(node.x + dx, node.y + dy), next = network.get(nk);
        if (!next || prev.has(nk) || (canTravel && !canTravel(node, next))) continue;
        prev.set(nk, k);
        if (nk === toKey) {
          const out = [network.get(nk)]; let at = nk;
          while (prev.get(at) != null) { at = prev.get(at); out.push(network.get(at)); }
          return out.reverse();
        }
        queue.push(nk);
      }
    }
    return null;
  }

  /*
   * Build a loop from an explicitly ordered stop list. Unlike buildLoops,
   * this function never changes the user's stop order. Each station chooses
   * one deterministic adjacent network tile, then every leg follows a shortest
   * path through connected roads/rails. Returns null if any leg is disconnected.
   */
  function buildOrderedRoute(network, orderedStops, canTravel) {
    if (!Array.isArray(orderedStops) || orderedStops.length < 2) return null;
    const stops = orderedStops.map(s => ({ ...s, access: [...new Set((s.access || []).filter(k => network.has(k)))].sort() }));
    if (stops.some(s => !s.access.length)) return null;

    // Solve the station-access choice around the whole loop, rather than picking
    // each station's access independently (which could create a visual jump).
    const pathCache = new Map();
    const pathBetween = (from, to) => {
      const k = from + '>' + to;
      if (!pathCache.has(k)) pathCache.set(k, shortestPath(network, from, to, canTravel));
      return pathCache.get(k);
    };
    let bestLoop = null;
    for (const startAccess of stops[0].access) {
      let states = new Map([[startAccess, { cost: 0, accesses: [startAccess], segments: [] }]]);
      for (let i = 1; i < stops.length; i++) {
        const nextStates = new Map();
        for (const access of stops[i].access) {
          let bestState = null;
          for (const [previousAccess, state] of states) {
            const path = pathBetween(previousAccess, access);
            if (!path || path.length < 2) continue;
            const candidate = { cost: state.cost + path.length - 1, accesses: [...state.accesses, access], segments: [...state.segments, path.map(n => key(n.x, n.y))] };
            const sig = candidate.accesses.join('|');
            if (!bestState || candidate.cost < bestState.cost || (candidate.cost === bestState.cost && sig < bestState.accesses.join('|'))) bestState = candidate;
          }
          if (bestState) nextStates.set(access, bestState);
        }
        states = nextStates;
        if (!states.size) break;
      }
      for (const [lastAccess, state] of states) {
        const closing = pathBetween(lastAccess, startAccess);
        if (!closing || closing.length < 2) continue;
        const candidate = { ...state, cost: state.cost + closing.length - 1, segments: [...state.segments, closing.map(n => key(n.x, n.y))] };
        const sig = candidate.accesses.join('|');
        if (!bestLoop || candidate.cost < bestLoop.cost || (candidate.cost === bestLoop.cost && sig < bestLoop.accesses.join('|'))) bestLoop = candidate;
      }
    }
    if (!bestLoop) return null;
    const nodeKeys = [];
    bestLoop.segments.forEach((segment, i) => {
      if (!i) nodeKeys.push(...segment);
      else nodeKeys.push(...segment.slice(1));
    });
    if (nodeKeys.length > 1 && nodeKeys[nodeKeys.length - 1] === nodeKeys[0]) nodeKeys.pop();
    const compact = nodeKeys.filter((k, i) => i === 0 || k !== nodeKeys[i - 1]);
    if (compact.length < 2) return null;
    return {
      key: compact.join(';') + '::' + stops.map(s => s.key).join('>'),
      nodes: compact.map(k => network.get(k)),
      stopKeys: new Set(bestLoop.accesses),
      stopCount: stops.length,
      orderedStopKeys: stops.map(s => s.key),
      orderedAccessKeys: bestLoop.accesses,
    };
  }

  /*
   * Build auto-loop routes over a connected road/rail graph. Each stop contains
   * { key, access:["x,y", ...] }. The planner greedily visits the nearest
   * reachable unvisited stop, then closes the loop back to the start.
   */
  function buildLoops(network, stops, canTravel) {
    const valid = (stops || []).map(s => ({ ...s, access: [...new Set((s.access || []).filter(k => network.has(k)))].sort() }))
      .filter(s => s.access.length).sort((a, b) => a.key.localeCompare(b.key));
    const pending = new Map(valid.map(s => [s.key, s]));
    const routes = [];
    while (pending.size) {
      const start = pending.values().next().value;
      pending.delete(start.key);
      const startAccess = start.access[0];
      let current = startAccess;
      const nodeKeys = [startAccess], stopKeys = [startAccess], visitedStops = [start.key];
      while (pending.size) {
        let best = null;
        for (const stop of pending.values()) {
          for (const access of stop.access) {
            const path = shortestPath(network, current, access, canTravel);
            if (!path || path.length < 2) continue;
            if (!best || path.length < best.path.length || (path.length === best.path.length && `${stop.key}|${access}` < `${best.stop.key}|${best.access}`)) {
              best = { stop, access, path };
            }
          }
        }
        if (!best) break;
        nodeKeys.push(...best.path.slice(1).map(n => key(n.x, n.y)));
        current = best.access; stopKeys.push(current); visitedStops.push(best.stop.key);
        pending.delete(best.stop.key);
      }
      if (visitedStops.length < 2) continue;
      const back = shortestPath(network, current, startAccess, canTravel);
      if (!back || back.length < 2) continue;
      nodeKeys.push(...back.slice(1, -1).map(n => key(n.x, n.y)));
      const uniqueNodeKeys = nodeKeys.filter((k, i) => i === 0 || k !== nodeKeys[i - 1]);
      if (uniqueNodeKeys.length < 2) continue;
      const nodes = uniqueNodeKeys.map(k => network.get(k));
      const signature = `${visitedStops.join(',')}::${uniqueNodeKeys.join(';')}`;
      routes.push({ key: signature, nodes, stopKeys: new Set(stopKeys), stopCount: visitedStops.length });
    }
    return routes;
  }

  return Object.freeze({ key, shortestPath, buildLoops, buildOrderedRoute });
});
