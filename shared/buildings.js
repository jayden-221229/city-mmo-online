/**
 * 資料驅動的建築目錄（前後端共用）。
 * 新增建築 = 在這裡加一筆資料，伺服器規則、解鎖、UI 面板都會自動吃到；造型在 public/shapes.js 以 id 對應（沒有就用方盒）。
 *
 * 欄位說明
 *   cat       分類：transport | utility | residential | commercial | industrial | service
 *   cost      建造費   upkeep 每秒維護費   unlock 解鎖所需的「最高人口」（城市等級系統）
 *   needs     地形限制：'water'（只能蓋在水面，橋樑）| 'forest' | 'ore' | 'shore'（必須緊鄰水邊）；沒有 = 一般平地/森林都行，水面不行
 *   conducts  這個格子是導體：'road' | 'rail'（道路用 BFS 連成連通塊）
 *   supplies  電源/水源：{ power: N } 或 { water: N }（N = 容量）。水電「不需要連線」，供給整座城市共用
 *   uses      運作條件：{ road:1, power:N, water:N }（road 代表必須緊鄰道路；N 是耗用量）
 *   pop / jobs / tax / income / demand / goods / pollution / happy   經濟數值（每秒）；jobs = 提供的工作數；pollution 可為負（淨化）
 *   h / color / line   程序生成貼圖用（有真實貼圖時會被 atlas 覆蓋）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CHUNK = 50;
  const NET_BIT = { road: 1, power: 2, water: 4 };
  const CATS = { transport: '交通', utility: '能源水利', residential: '住宅', commercial: '商業', industrial: '工業', service: '公共服務' };
  const BUILDINGS = {};

  const def = (id, cat, name, o) => { BUILDINGS[id] = Object.assign({ id, cat, name, cost: 100, upkeep: 0, unlock: 0, h: 20, color: '#999999' }, o); };
  const variant = (base, id, name, o) => { BUILDINGS[id] = Object.assign({}, BUILDINGS[base], { id, name }, o); };   // 以既有建築為模板衍生變體

  // ── 交通 ──
  def('road',     'transport', '柏油道路',   { cost: 20,  conducts: 'road', line: { color: '#4b4f56', w: 18, mark: '#caa93a' } });
  def('oneway',   'transport', '單行道',     { cost: 30,  conducts: 'road', line: { color: '#5a5f68', w: 14, mark: '#ffd24a' } });
  def('highway',  'transport', '高速公路',   { unlock: 60, cost: 120, upkeep: 0.1, conducts: 'road', line: { color: '#2b3340', w: 28, mark: '#f0f0f0' } });
  def('bridge',   'transport', '橋樑',       { unlock: 60, cost: 250, upkeep: 0.2, needs: 'water', conducts: 'road', line: { color: '#8d6e63', w: 20, mark: '#5d4037' } });
  def('rail',     'transport', '鐵路軌道',   { unlock: 250, cost: 80,  upkeep: 0.1, conducts: 'rail', line: { color: '#8b7355', w: 10, rails: '#cfcfcf' } });
  def('subway',   'transport', '地鐵站',     { unlock: 800, jobs: 6, cost: 2500, upkeep: 6, h: 8, color: '#4a6fa5', uses: { road: 1, power: 3 }, happy: 1.5 });
  def('bus_station', 'transport', '公車轉運站', { unlock: 60, jobs: 12, cost: 2200, upkeep: 2, h: 10, color: '#20a39e', uses: { road: 1, power: 3, water: 1 }, happy: 2 });
  def('bus_terminal', 'transport', '大型公車總站', { unlock: 800, jobs: 35, cost: 9500, upkeep: 8, h: 18, color: '#0f8b8d', uses: { road: 1, power: 8, water: 3 }, happy: 4 });
  def('airport',  'transport', '國際機場',   { unlock: 2500, jobs: 120, cost: 60000, upkeep: 40, h: 14, color: '#ced4da', uses: { road: 1, power: 50, water: 15 }, income: 90, demand: 500, pollution: 8 });
  // ── 能源 / 水利 ──
  def('well',        'utility', '水井',         { cost: 120, upkeep: 0.2, h: 8, color: '#8d99ae', supplies: { water: 8 } });
  def('solar',       'utility', '太陽能板',     { cost: 600, upkeep: 0.5, h: 4, color: '#2a4a8a', supplies: { power: 8 } });
  def('water_tower', 'utility', '水塔',         { jobs: 1, cost: 400, upkeep: 1, h: 36, color: '#7aa6c2', supplies: { water: 20 } });
  def('wind',        'utility', '風力發電機',   { unlock: 60, jobs: 1, cost: 1800, upkeep: 1, h: 40, color: '#e9ecef', supplies: { power: 25 } });
  def('coal',        'utility', '燃煤發電廠',   { unlock: 60, jobs: 15, cost: 3000, upkeep: 8, h: 22, color: '#5b5b5b', supplies: { power: 100 }, pollution: 10 });
  def('water_plant', 'utility', '淨水廠',       { unlock: 60, jobs: 10, cost: 4000, upkeep: 12, h: 14, color: '#2f7fa8', supplies: { water: 200 } });
  def('gas',         'utility', '燃氣電廠',     { unlock: 250, jobs: 20, cost: 9000, upkeep: 18, h: 24, color: '#adb5bd', supplies: { power: 300 }, pollution: 4 });
  def('reservoir',   'utility', '水庫',         { unlock: 250, jobs: 10, cost: 12000, upkeep: 20, h: 6, color: '#0077b6', supplies: { water: 600 } });
  def('nuclear',     'utility', '核能發電廠',   { unlock: 2500, jobs: 40, cost: 40000, upkeep: 60, h: 20, color: '#c9d3d8', supplies: { power: 1000 }, pollution: 1 });
  def('fusion',      'utility', '核融合電廠',   { unlock: 8000, jobs: 60, cost: 150000, upkeep: 120, h: 40, color: '#7209b7', supplies: { power: 6000 } });
  // ── 住宅 ──
  def('bungalow',  'residential', '郊區平房', { cost: 150,  h: 14, color: '#d98e5f', uses: { road: 1, power: 1,  water: 1 },  pop: 4,   tax: 0.5 });
  def('townhouse', 'residential', '連棟透天', { unlock: 60,  cost: 420,  h: 24, color: '#d4a373', uses: { road: 1, power: 2,  water: 2 },  pop: 12,  tax: 1.4 });
  def('apartment', 'residential', '高層公寓', { unlock: 250, cost: 900,  h: 38, color: '#c9784a', uses: { road: 1, power: 5,  water: 4 },  pop: 30,  tax: 3 });
  def('condo',     'residential', '景觀大廈', { unlock: 800, cost: 2800, h: 58, color: '#b08968', uses: { road: 1, power: 8,  water: 6 },  pop: 60,  tax: 7 });
  def('luxury',    'residential', '摩天豪宅', { unlock: 2500, cost: 6000, h: 84, color: '#e0b86a', uses: { road: 1, power: 12, water: 10 }, pop: 120, tax: 15 });
  // ── 商業 ──
  def('convenience', 'commercial', '便利商店',     { jobs: 3, cost: 250, h: 14, color: '#6bb6d6', uses: { road: 1, power: 2, water: 1 }, income: 2.5, demand: 12 });
  def('shop',        'commercial', '街邊商鋪',     { jobs: 6, cost: 400, h: 16, color: '#4aa3c9', uses: { road: 1, power: 2, water: 1 }, income: 4, demand: 20 });
  def('market',      'commercial', '傳統市場',     { jobs: 8, cost: 300, h: 12, color: '#e07a5f', uses: { road: 1, power: 1, water: 2 }, income: 3, demand: 14 });
  def('mall',        'commercial', '大型購物中心', { unlock: 250, jobs: 40, cost: 2500, h: 18, color: '#3d7fd0', uses: { road: 1, power: 15, water: 10 }, income: 18, demand: 100 });
  def('office',      'commercial', '辦公大樓',     { unlock: 250, jobs: 90, cost: 5000, h: 62, color: '#4d908e', uses: { road: 1, power: 18, water: 6 }, income: 28, demand: 150 });
  def('hotel',       'commercial', '觀光旅館',     { unlock: 800, jobs: 45, cost: 4200, h: 44, color: '#bc6c25', uses: { road: 1, power: 10, water: 12 }, income: 24, demand: 80 });
  def('harbor',      'commercial', '貿易港口',     { unlock: 800, jobs: 60, cost: 16000, upkeep: 10, needs: 'shore', h: 24, color: '#1d6fa5', uses: { road: 1, power: 25, water: 8 }, income: 60, demand: 200, goods: 6, pollution: 3 });
  def('finance',     'commercial', '金融大樓',     { unlock: 2500, jobs: 150, cost: 12000, h: 96, color: '#5f6fd8', uses: { road: 1, power: 30, water: 12 }, income: 60, demand: 400 });
  def('theme_park',  'commercial', '主題樂園',     { unlock: 2500, jobs: 80, cost: 22000, upkeep: 10, h: 30, color: '#f72585', uses: { road: 1, power: 30, water: 25 }, income: 70, demand: 300, happy: 6 });
  // ── 工業 ──
  def('farm',          'industrial', '農場',         { jobs: 6, cost: 200, h: 8, color: '#a7c957', uses: { road: 1, water: 3 }, tax: 1, goods: 3 });
  def('lumber',        'industrial', '伐木場',       { jobs: 8, cost: 350, needs: 'forest', h: 12, color: '#8b5a2b', uses: { road: 1 }, tax: 1, goods: 5 });
  def('factory_light', 'industrial', '輕工廠',       { jobs: 12, cost: 500, h: 12, color: '#b8a64a', uses: { road: 1, power: 8, water: 4 }, tax: 3, goods: 2, pollution: 3 });
  def('warehouse',     'industrial', '倉儲物流中心', { unlock: 250, jobs: 25, cost: 2200, h: 14, color: '#8d99ae', uses: { road: 1, power: 10, water: 2 }, tax: 6, goods: 10, pollution: 2 });
  def('mine',          'industrial', '礦場',         { unlock: 250, jobs: 30, cost: 3000, upkeep: 4, needs: 'ore', h: 22, color: '#6c757d', uses: { road: 1, power: 15, water: 5 }, tax: 8, goods: 14, pollution: 6 });
  def('steel',         'industrial', '重工業鋼鐵廠', { unlock: 250, jobs: 50, cost: 3500, h: 18, color: '#7f7f86', uses: { road: 1, power: 40, water: 25 }, tax: 14, goods: 8, pollution: 12 });
  def('recycle',       'industrial', '資源回收廠',   { unlock: 800, jobs: 18, cost: 3800, upkeep: 4, h: 16, color: '#52b788', uses: { road: 1, power: 12, water: 6 }, tax: 2, goods: 2, pollution: -10 });
  def('fab',           'industrial', '高科技晶圓廠', { unlock: 2500, jobs: 80, cost: 15000, h: 18, color: '#8f5fd0', uses: { road: 1, power: 80, water: 40 }, tax: 55, goods: 20, pollution: 6 });
  def('datacenter',    'industrial', '資料中心',     { unlock: 2500, jobs: 40, cost: 18000, h: 18, color: '#3a86ff', uses: { road: 1, power: 100, water: 30 }, tax: 70, pollution: 3 });
  // ── 公共服務 ──
  def('park',       'service', '綠化公園',   { jobs: 1, cost: 200, upkeep: 0.2, h: 3, color: '#3f9d4f', uses: { road: 1 }, happy: 1.5 });
  def('clinic',     'service', '社區診所',   { unlock: 60, jobs: 6, cost: 900, upkeep: 1.2, h: 14, color: '#f1faee', uses: { road: 1, power: 3, water: 2 }, happy: 2.5 });
  def('school',     'service', '學校',       { unlock: 60, jobs: 14, cost: 1500, upkeep: 2, h: 16, color: '#e9c46a', uses: { road: 1, power: 4, water: 3 }, happy: 3 });
  def('police',     'service', '警察局',     { unlock: 60, jobs: 8, cost: 1200, upkeep: 2, h: 20, color: '#2c4a9a', uses: { road: 1, power: 6, water: 2 }, happy: 4 });
  def('fire',       'service', '消防局',     { unlock: 60, jobs: 8, cost: 1200, upkeep: 2, h: 18, color: '#c0392b', uses: { road: 1, power: 5, water: 3 }, happy: 4 });
  def('hospital',   'service', '綜合醫院',   { unlock: 250, jobs: 30, cost: 3500, upkeep: 5, h: 28, color: '#e8eef2', uses: { road: 1, power: 15, water: 10 }, happy: 8 });
  def('townhall',   'service', '市政廳',     { unlock: 250, jobs: 20, cost: 6000, upkeep: 5, h: 30, color: '#e5d9c3', uses: { road: 1, power: 8, water: 4 }, happy: 5 });
  def('stadium',    'service', '大型體育館', { unlock: 800, jobs: 20, cost: 8000, upkeep: 10, h: 14, color: '#d0d4d8', uses: { road: 1, power: 25, water: 8 }, happy: 10 });
  def('university', 'service', '大學',       { unlock: 800, jobs: 60, cost: 14000, upkeep: 12, h: 28, color: '#457b9d', uses: { road: 1, power: 20, water: 12 }, happy: 7 });
  def('monument',   'service', '勝利紀念碑', { unlock: 25000, cost: 250000, h: 70, color: '#ffd166', uses: { road: 1 }, happy: 20 });

  const needBits = d => Object.keys(d.uses || {}).reduce((m, k) => m | (NET_BIT[k] || 0), 0);

  // ── 城市等級：以「歷史最高人口」計算，人口掉下來也不會失去已解鎖的建築 ──
  const LEVELS = [
    { at: 0, name: '村莊' }, { at: 60, name: '小鎮' }, { at: 250, name: '城鎮' }, { at: 800, name: '城市' },
    { at: 2500, name: '大都會' }, { at: 8000, name: '國際都會' }, { at: 25000, name: '傳奇首都' },
  ];
  const levelIndex = peak => LEVELS.reduce((m, l, i) => (peak >= l.at ? i : m), 0);

  // ── 成就：達成時一次性發放獎金（check 吃伺服器每秒算出的城市統計 c）──
  const ACHIEVEMENTS = [
    { id: 'pop100',   name: '第一批居民', desc: '人口達到 100',      reward: 1000,   check: c => c.peakPop >= 100 },
    { id: 'pop500',   name: '小有規模',   desc: '人口達到 500',      reward: 4000,   check: c => c.peakPop >= 500 },
    { id: 'pop2000',  name: '繁榮城市',   desc: '人口達到 2,000',    reward: 15000,  check: c => c.peakPop >= 2000 },
    { id: 'pop10000', name: '大都會',     desc: '人口達到 10,000',   reward: 80000,  check: c => c.peakPop >= 10000 },
    { id: 'pop50000', name: '傳奇之城',   desc: '人口達到 50,000',   reward: 400000, check: c => c.peakPop >= 50000 },
    { id: 'land3',    name: '開疆闢土',   desc: '擁有 3 塊領地',     reward: 3000,   check: c => c.chunks >= 3 },
    { id: 'land8',    name: '版圖擴張',   desc: '擁有 8 塊領地',     reward: 25000,  check: c => c.chunks >= 8 },
    { id: 'build50',  name: '建築師',     desc: '蓋出 50 棟建築',    reward: 5000,   check: c => c.total >= 50 },
    { id: 'build300', name: '城市規劃師', desc: '蓋出 300 棟建築',   reward: 50000,  check: c => c.total >= 300 },
    { id: 'ally1',    name: '好鄰居',     desc: '與 1 位玩家結盟',   reward: 2000,   check: c => c.allies >= 1 },
    { id: 'ally3',    name: '外交官',     desc: '與 3 位玩家結盟',   reward: 15000,  check: c => c.allies >= 3 },
    { id: 'gift',     name: '慷慨解囊',   desc: '累計贈送盟友 $5,000', reward: 3000, check: c => c.gifted >= 5000 },
    { id: 'work',     name: '充分就業',   desc: '人口 500 以上且就業率 95%', reward: 10000, check: c => c.pop >= 500 && c.employ >= 0.95 },
    { id: 'green',    name: '綠色城市',   desc: '人口 1,000 以上且零污染',   reward: 20000, check: c => c.pop >= 1000 && c.pol <= 0 },
    { id: 'nuclear',  name: '能源巨頭',   desc: '蓋出核能或核融合電廠',      reward: 12000, check: c => (c.built.nuclear || 0) + (c.built.fusion || 0) >= 1 },
    { id: 'airport',  name: '空中門戶',   desc: '蓋出國際機場',      reward: 30000,  check: c => (c.built.airport || 0) >= 1 },
    { id: 'monument', name: '流芳百世',   desc: '蓋出勝利紀念碑',    reward: 200000, check: c => (c.built.monument || 0) >= 1 },
    { id: 'rich',     name: '百萬富翁',   desc: '資金達到 $1,000,000', reward: 50000, check: c => c.money >= 1e6 },
  ];

  // ── 全服隨機事件：每 8~16 分鐘一次，持續 90 秒，所有玩家同時受影響 ──
  const EVENTS = [
    { id: 'expo',     icon: '🎪', name: '商業博覽會', desc: '商業營收 ×1.5',                 good: true,  duration: 90000 },
    { id: 'harvest',  icon: '🌾', name: '大豐收',     desc: '物資收入 ×1.5',                 good: true,  duration: 90000 },
    { id: 'sunny',    icon: '☀️', name: '晴空萬里',   desc: '幸福度 +10',                    good: true,  duration: 90000 },
    { id: 'festival', icon: '🎉', name: '全城慶典',   desc: '居民入住速度 ×2',               good: true,  duration: 90000 },
    { id: 'rain',     icon: '🌧️', name: '連日大雨',   desc: '水資源 ×1.5',                   good: true,  duration: 90000 },
    { id: 'peak',     icon: '⚡', name: '用電高峰',   desc: '電力供給 ×0.8，小心停電',       good: false, duration: 90000 },
    { id: 'smog',     icon: '🌫️', name: '霧霾警報',   desc: '污染的負面影響 ×1.5',           good: false, duration: 90000 },
  ];

  return { CHUNK, NET_BIT, CATS, BUILDINGS, def, variant, needBits, LEVELS, levelIndex, ACHIEVEMENTS, EVENTS,
    CLAIM_BASE: 1500, START_MONEY: 5000, BASE_SUPPLY: { power: 30, water: 30 } };   // BASE_SUPPLY：每位玩家免費的基礎水電額度
});
