/**
 * 地形（前後端共用）：由座標決定，不需要存檔，所有玩家看到的世界一模一樣。
 *   水面：不能蓋一般建築（橋樑只能蓋在水面上）   森林：可以蓋，但要付整地費（伐木場除外）
 *   礦脈：礦場必須蓋在上面                       港口：必須緊鄰水邊
 * 每個 chunk 中央 20×20 一定是平地，保證起始道路和新手建設不會被水擋住。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameTerrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CHUNK = 50, LAND = 0, WATER = 1, FOREST = 2, ORE = 3;
  const NAMES = ['平地', '水面', '森林', '礦脈'];
  const WATER_T = 0.33, FOREST_T = 0.64, ORE_T = 0.88;

  const hash = (x, y, s) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const noise = (x, y, scale, seed) => {                      // 值噪聲：格點雜湊 + 雙線性插值 → 連續的湖泊與森林
    const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = smooth(gx - x0), fy = smooth(gy - y0);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };
  const mod = v => ((v % CHUNK) + CHUNK) % CHUNK;

  function terrainAt(x, y) {
    const lx = mod(x), ly = mod(y);
    if (lx >= 15 && lx <= 34 && ly >= 15 && ly <= 34) return LAND;
    if (noise(x, y, 13, 11) * 0.7 + noise(x, y, 5, 12) * 0.3 < WATER_T) return WATER;
    if (noise(x, y, 8, 13) * 0.65 + noise(x, y, 3.5, 14) * 0.35 > FOREST_T) return FOREST;
    if (noise(x, y, 3, 15) > ORE_T) return ORE;
    return LAND;
  }

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  /** 這個建築能不能蓋在 (x,y)？回傳 null = 可以，否則回傳錯誤代碼（伺服器與客戶端共用同一套規則） */
  function placeError(d, x, y) {
    const t = terrainAt(x, y);
    if (d.needs === 'water') return t === WATER ? null : 'need_water';
    if (t === WATER) return 'water';
    if (d.needs === 'forest') return t === FOREST ? null : 'need_forest';
    if (d.needs === 'ore') return t === ORE ? null : 'need_ore';
    if (d.needs === 'shore') return DIRS.some(([dx, dy]) => terrainAt(x + dx, y + dy) === WATER) ? null : 'need_shore';
    return null;
  }
  /** 森林整地費（伐木場不用；道路類只收少少的） */
  const clearFee = (d, x, y) => (terrainAt(x, y) === FOREST && d.needs !== 'forest' ? (d.line ? 10 : 40) : 0);

  return { LAND, WATER, FOREST, ORE, NAMES, terrainAt, placeError, clearFee };
});
