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
  def('bus_stop', 'transport', '公車站牌',   { jobs: 1, cost: 180, upkeep: 0.25, h: 9, color: '#20a39e', uses: { road: 1 }, happy: 0.5 });
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
  // ── 新內容：觀光、教育醫療、未來科技（group 讓 UI 可以獨立成一個「新建築」分頁）──
  def('beach_resort', 'commercial', '海濱度假村', { group: 'newbuildings', unlock: 250, cost: 6200, upkeep: 5, jobs: 38, h: 34, color: '#2a9d8f', needs: 'shore', uses: { road: 1, power: 12, water: 10 }, income: 22, demand: 90, happy: 5 });
  def('aquarium', 'service', '海洋水族館', { group: 'newbuildings', unlock: 250, cost: 7800, upkeep: 6, jobs: 32, h: 32, color: '#4ea8de', uses: { road: 1, power: 18, water: 14 }, income: 8, demand: 70, happy: 6 });
  def('museum', 'service', '城市博物館', { group: 'newbuildings', unlock: 60, cost: 2200, upkeep: 2, jobs: 12, h: 24, color: '#cbb994', uses: { road: 1, power: 4, water: 2 }, happy: 4 });
  def('medical_campus', 'service', '醫療研究園區', { group: 'newbuildings', unlock: 800, cost: 11800, upkeep: 10, jobs: 70, h: 40, color: '#e8f4f8', uses: { road: 1, power: 25, water: 18 }, happy: 11 });
  def('research_center', 'service', '尖端研究中心', { group: 'newbuildings', unlock: 250, cost: 6500, upkeep: 5, jobs: 42, h: 38, color: '#90e0ef', uses: { road: 1, power: 20, water: 8 }, tax: 14, happy: 4 });
  def('wind_farm', 'utility', '大型風力發電場', { group: 'newbuildings', unlock: 60, cost: 2400, upkeep: 1, jobs: 4, h: 35, color: '#a8dadc', supplies: { power: 95 }, pollution: -1 });
  def('robot_factory', 'industrial', '機器人製造廠', { group: 'newbuildings', unlock: 800, cost: 12500, upkeep: 8, jobs: 64, h: 30, color: '#8d99ae', uses: { road: 1, power: 35, water: 12 }, tax: 20, goods: 13, pollution: 3 });
  def('quantum_lab', 'industrial', '量子運算研究所', { group: 'newbuildings', unlock: 2500, cost: 26500, upkeep: 12, jobs: 85, h: 52, color: '#7b2cbf', uses: { road: 1, power: 55, water: 18 }, tax: 45, goods: 10, pollution: -2 });
  def('orbital_port', 'commercial', '軌道太空港', { group: 'newbuildings', unlock: 2500, cost: 42000, upkeep: 22, jobs: 110, h: 66, color: '#90caf9', uses: { road: 1, power: 70, water: 28 }, income: 90, demand: 320, happy: 5 });
  def('sky_garden', 'commercial', '空中花園大樓', { group: 'newbuildings', unlock: 800, cost: 14500, upkeep: 7, jobs: 42, h: 50, color: '#52b788', uses: { road: 1, power: 18, water: 20 }, income: 28, demand: 100, happy: 8, pollution: -3 });

  // ── 城市裝飾：不要求道路、水電；主要用來美化並增加幸福度 ──
  def('fountain', 'service', '中央噴泉', { group: 'decoration', cost: 260, upkeep: 0.05, h: 8, color: '#48cae4', happy: 1.2 });
  def('flower_plaza', 'service', '花卉廣場', { group: 'decoration', cost: 380, upkeep: 0.08, h: 4, color: '#f284b6', happy: 1.8 });
  def('sculpture', 'service', '公共藝術雕塑', { group: 'decoration', unlock: 60, cost: 520, h: 18, color: '#adb5bd', happy: 1.4 });
  def('tree_grove', 'service', '城市樹林', { group: 'decoration', cost: 320, upkeep: 0.03, h: 16, color: '#2d6a4f', happy: 1.5, pollution: -0.2 });
  def('lantern_park', 'service', '夜間燈籠花園', { group: 'decoration', unlock: 60, cost: 680, upkeep: 0.12, h: 10, color: '#ffd166', happy: 2.2 });
  def('clock_tower', 'service', '市中心鐘樓', { group: 'decoration', unlock: 250, cost: 1800, upkeep: 0.15, h: 32, color: '#c9ada7', happy: 2.5 });

  // ── 可切換的城市玩法模式（每位玩家獨立，儲存在城市存檔）──
  const GAME_MODES = {
    classic: { id: 'classic', name: '經典模式', buildMultiplier: 1, claimMultiplier: 1, incomeMultiplier: 1, upkeepMultiplier: 1, refundMultiplier: 0.5,
      description: '原本的平衡：正常建造費、領地費、收入與維護費。' },
    creative: { id: 'creative', name: '創意模式', buildMultiplier: 0, claimMultiplier: 0, incomeMultiplier: 1, upkeepMultiplier: 0, refundMultiplier: 0,
      description: '建造與擴張免費，免維護費，適合自由規劃城市。' },
    challenge: { id: 'challenge', name: '挑戰模式', buildMultiplier: 1.25, claimMultiplier: 1.5, incomeMultiplier: 1.1, upkeepMultiplier: 1.15, refundMultiplier: 0.3,
      description: '建造費 +25%、領地費 ×1.5、維護費 +15%，收入也提高 10%。' },
  };

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


  // ── 城市擴充包：100 款新建築 ──
  def("tram_depot", "transport", "輕軌電車車庫", {architecture:"utility",color:"#4c9caa",unlock:250,cost:4200,h:18,jobs:24,upkeep:3,uses:{road:1,power:8,water:2},happy:1});
  def("ferry_terminal", "transport", "海灣渡輪碼頭", {architecture:"harbor",color:"#76a8bd",unlock:250,cost:5600,h:16,jobs:28,upkeep:4,uses:{road:1,power:6,water:2},happy:2,needs:"shore"});
  def("bicycle_hub", "transport", "公共單車租借站", {architecture:"market",color:"#55a88b",unlock:60,cost:650,h:8,jobs:2,upkeep:0.25,uses:{road:1,power:1},happy:1.2});
  def("taxi_depot", "transport", "計程車服務中心", {architecture:"glass",color:"#e0b35a",unlock:60,cost:1800,h:12,jobs:9,upkeep:1.2,uses:{road:1,power:3},happy:0.8});
  def("parking_garage", "transport", "多層立體停車場", {architecture:"midrise",color:"#8597a5",unlock:60,cost:3200,h:24,jobs:12,upkeep:1.5,uses:{road:1,power:4,water:1},happy:0.5});
  def("park_and_ride", "transport", "轉乘停車廣場", {architecture:"plaza",color:"#93b78b",unlock:250,cost:4800,h:10,jobs:8,upkeep:1.5,uses:{road:1,power:3},happy:1.5});
  def("monorail_station", "transport", "單軌列車車站", {architecture:"glass",color:"#8cadd0",unlock:800,cost:8800,h:22,jobs:20,upkeep:5,uses:{road:1,power:14,water:3},happy:2});
  def("metro_hub", "transport", "城市捷運轉乘中心", {architecture:"civic",color:"#6c9ba9",unlock:800,cost:14500,h:26,jobs:42,upkeep:8,uses:{road:1,power:24,water:4},happy:3});
  def("train_station", "transport", "城際鐵路車站", {architecture:"civic",color:"#c6b69c",unlock:250,cost:7600,h:20,jobs:26,upkeep:4,uses:{road:1,power:10,water:2},happy:2});
  def("cargo_terminal", "transport", "貨運集散總站", {architecture:"industrial",color:"#bb8d60",unlock:800,cost:12000,h:19,jobs:46,upkeep:7,uses:{road:1,power:16,water:4},income:8,goods:14,pollution:2});
  def("city_airport_terminal", "transport", "城市航空客運大樓", {architecture:"glass",color:"#c5d7e6",unlock:2500,cost:65000,h:32,jobs:140,upkeep:45,uses:{road:1,power:55,water:18},income:100,demand:550,pollution:7});
  def("transit_interchange", "transport", "綜合交通轉運站", {architecture:"campus",color:"#5dabb0",unlock:250,cost:9200,h:18,jobs:30,upkeep:5,uses:{road:1,power:12,water:4},happy:2.5});
  def("geothermal_plant", "utility", "地熱發電站", {architecture:"utility",color:"#b76f62",unlock:250,cost:5200,h:25,jobs:16,upkeep:5,supplies:{power:135},pollution:0.5});
  def("hydro_plant", "utility", "水力發電廠", {architecture:"utility",color:"#3d9ca9",unlock:800,cost:14000,h:20,jobs:35,upkeep:8,supplies:{power:420},pollution:0.2});
  def("battery_storage", "utility", "大型儲能電池站", {architecture:"utility",color:"#6d8fc7",unlock:60,cost:2800,h:13,jobs:5,upkeep:1,supplies:{power:42},pollution:-0.2});
  def("desalination_plant", "utility", "海水淡化廠", {architecture:"industrial",color:"#58a5c4",unlock:250,cost:7800,h:18,jobs:24,upkeep:6,supplies:{water:145},pollution:1,needs:"shore"});
  def("sewage_plant", "utility", "污水處理廠", {architecture:"industrial",color:"#6c9fa0",unlock:250,cost:6200,h:17,jobs:20,upkeep:5,uses:{road:1,power:12,water:4},happy:1,pollution:-5});
  def("smart_grid_station", "utility", "智慧電網控制中心", {architecture:"glass",color:"#73b8c0",unlock:800,cost:9500,h:22,jobs:28,upkeep:4,supplies:{power:180},pollution:-0.5});
  def("district_heating", "utility", "區域供熱中心", {architecture:"industrial",color:"#d18d67",unlock:250,cost:4700,h:18,jobs:18,upkeep:4,uses:{road:1,power:5,water:5},happy:1,pollution:1});
  def("hydrogen_plant", "utility", "綠氫能源基地", {architecture:"utility",color:"#6bb7a7",unlock:2500,cost:24000,h:30,jobs:58,upkeep:12,supplies:{power:720},pollution:-1});
  def("waste_to_energy", "utility", "垃圾焚化發電廠", {architecture:"industrial",color:"#87969c",unlock:800,cost:11800,h:25,jobs:36,upkeep:8,supplies:{power:240},pollution:2});
  def("rooftop_solar_farm", "utility", "屋頂太陽能園區", {architecture:"solar",color:"#5986b0",unlock:60,cost:1600,h:5,jobs:3,upkeep:0.2,supplies:{power:32},pollution:-0.2});
  def("water_recycling_plant", "utility", "中水回用中心", {architecture:"industrial",color:"#4e9ba7",unlock:800,cost:9600,h:19,jobs:31,upkeep:6,supplies:{water:230},pollution:-3});
  def("pumped_storage", "utility", "抽水蓄能電站", {architecture:"utility",color:"#428fba",unlock:2500,cost:22000,h:28,jobs:48,upkeep:13,supplies:{power:850},pollution:0});
  def("micro_reactor", "utility", "模組化核能電站", {architecture:"utility",color:"#b6c4d0",unlock:8000,cost:76000,h:34,jobs:85,upkeep:55,supplies:{power:3600},pollution:0.8});
  def("flood_control", "utility", "城市防洪抽水站", {architecture:"utility",color:"#4e91a5",unlock:250,cost:3600,h:12,jobs:14,upkeep:2,uses:{road:1,power:5},happy:0.8});
  def("rain_harvesting", "utility", "雨水收集中心", {architecture:"utility",color:"#659ca5",unlock:60,cost:1250,h:10,jobs:5,upkeep:0.4,supplies:{water:28},pollution:-0.3});
  def("marine_energy", "utility", "海洋潮汐電站", {architecture:"utility",color:"#397c9e",unlock:2500,cost:31000,h:26,jobs:65,upkeep:15,supplies:{power:960},pollution:0,needs:"shore"});
  def("food_factory", "industrial", "食品加工廠", {architecture:"industrial",color:"#c69c68",unlock:60,cost:950,h:13,jobs:18,upkeep:1.8,uses:{road:1,power:6,water:4},tax:4,goods:8,pollution:1.2});
  def("biotech_lab", "industrial", "生物科技實驗園", {architecture:"glass",color:"#8a9dd0",unlock:800,cost:7200,h:29,jobs:55,upkeep:6,uses:{road:1,power:24,water:12},tax:18,goods:3,pollution:-1});
  def("ev_factory", "industrial", "電動車製造工廠", {architecture:"industrial",color:"#7298aa",unlock:800,cost:11500,h:23,jobs:70,upkeep:8,uses:{road:1,power:36,water:12},tax:24,goods:15,pollution:1});
  def("chip_fab", "industrial", "半導體晶片工廠", {architecture:"glass",color:"#6f93b8",unlock:2500,cost:28500,h:30,jobs:120,upkeep:19,uses:{road:1,power:90,water:38},tax:75,goods:20,pollution:2});
  def("robotics_warehouse", "industrial", "機器人物流倉", {architecture:"industrial",color:"#8797a4",unlock:250,cost:5300,h:18,jobs:32,upkeep:4,uses:{road:1,power:16,water:4},tax:12,goods:16,pollution:1});
  def("cold_storage", "industrial", "低溫冷鏈倉庫", {architecture:"industrial",color:"#9ac1cb",unlock:60,cost:1800,h:15,jobs:13,upkeep:2,uses:{road:1,power:9,water:2},tax:5,goods:10,pollution:0.5});
  def("eco_factory", "industrial", "低碳循環工廠", {architecture:"industrial",color:"#6ea98a",unlock:250,cost:6400,h:20,jobs:42,upkeep:3,uses:{road:1,power:24,water:10},tax:15,goods:9,pollution:-4});
  def("paper_mill", "industrial", "紙品製造廠", {architecture:"industrial",color:"#bca78c",unlock:60,cost:1550,h:15,jobs:17,upkeep:2,uses:{road:1,power:8,water:8},tax:5,goods:9,pollution:3});
  def("beverage_brewery", "industrial", "飲品釀造廠", {architecture:"industrial",color:"#a8a05c",unlock:60,cost:1750,h:15,jobs:19,upkeep:2,uses:{road:1,power:7,water:8},tax:6,goods:10,pollution:1});
  def("textile_mill", "industrial", "紡織設計工場", {architecture:"industrial",color:"#bb8d9c",unlock:60,cost:1350,h:13,jobs:18,upkeep:1.7,uses:{road:1,power:6,water:4},tax:5,goods:7,pollution:1.5});
  def("shipyard", "industrial", "造船維修船塢", {architecture:"harbor",color:"#728b9b",unlock:800,cost:14500,h:24,jobs:60,upkeep:10,uses:{road:1,power:28,water:14},tax:25,goods:18,pollution:4,needs:"shore"});
  def("aerospace_plant", "industrial", "航空航太製造中心", {architecture:"industrial",color:"#8798c4",unlock:2500,cost:38000,h:31,jobs:135,upkeep:24,uses:{road:1,power:95,water:32},tax:90,goods:18,pollution:2});
  def("data_farm", "industrial", "雲端資料運算中心", {architecture:"glass",color:"#4c7da7",unlock:800,cost:16000,h:25,jobs:38,upkeep:12,uses:{road:1,power:130,water:20},tax:35,goods:2,pollution:1});
  def("research_park", "industrial", "產業創新研究園", {architecture:"campus",color:"#72a8a3",unlock:800,cost:9800,h:18,jobs:48,upkeep:5,uses:{road:1,power:24,water:9},tax:26,goods:5,pollution:-1,happy:2});
  def("cargo_depot", "industrial", "城市貨運轉運倉", {architecture:"industrial",color:"#b38d70",unlock:250,cost:4900,h:18,jobs:34,upkeep:4,uses:{road:1,power:12,water:4},tax:16,goods:17,pollution:2});
  def("packaging_plant", "industrial", "智慧包裝工廠", {architecture:"industrial",color:"#baa784",unlock:250,cost:3750,h:17,jobs:28,upkeep:3,uses:{road:1,power:14,water:4},tax:11,goods:12,pollution:1});
  def("cottage", "residential", "林間鄉村小屋", {architecture:"cottage",color:"#b7835d",unlock:0,cost:220,h:12,pop:7,tax:0.7,uses:{road:1,power:1,water:1},happy:1.2});
  def("duplex", "residential", "雙拼住宅", {architecture:"villa",color:"#d0a07b",unlock:0,cost:360,h:14,pop:12,tax:1.1,uses:{road:1,power:2,water:2}});
  def("row_house", "residential", "彩色連排住宅", {architecture:"townhouse",color:"#cf8c6e",unlock:0,cost:480,h:18,pop:18,tax:1.8,uses:{road:1,power:2,water:2}});
  def("courtyard_homes", "residential", "中庭花園住宅", {architecture:"campus",color:"#c1a27b",unlock:60,cost:1100,h:20,pop:28,tax:2.8,uses:{road:1,power:3,water:3},happy:2.2});
  def("eco_village", "residential", "綠意生態社區", {architecture:"green",color:"#78aa8a",unlock:250,cost:3600,h:28,pop:78,tax:7.2,uses:{road:1,power:5,water:5},happy:5,pollution:-1});
  def("suburban_villa", "residential", "景觀獨棟別墅", {architecture:"villa",color:"#d4b493",unlock:60,cost:980,h:19,pop:25,tax:2.5,uses:{road:1,power:3,water:3},happy:2});
  def("garden_apartment", "residential", "空中花園公寓", {architecture:"green",color:"#78aa93",unlock:250,cost:2400,h:34,pop:75,tax:7.8,uses:{road:1,power:8,water:6},happy:4,pollution:-0.5});
  def("tower_block", "residential", "城市住宅塔樓", {architecture:"tower",color:"#a3b0bd",unlock:800,cost:5800,h:55,pop:145,tax:14,uses:{road:1,power:16,water:12}});
  def("waterfront_condo", "residential", "海景精品公寓", {architecture:"glass",color:"#77a8bd",unlock:800,cost:7200,h:44,pop:115,tax:13,uses:{road:1,power:12,water:10},happy:4,needs:"shore"});
  def("student_dorm", "residential", "大學學生宿舍", {architecture:"midrise",color:"#8ca3b9",unlock:250,cost:2200,h:31,pop:80,tax:4,uses:{road:1,power:7,water:6},happy:1});
  def("senior_residence", "residential", "樂齡安養住宅", {architecture:"civic",color:"#d6bea3",unlock:250,cost:3100,h:24,pop:48,tax:5.2,uses:{road:1,power:6,water:5},happy:4});
  def("co_living", "residential", "共享生活公寓", {architecture:"glass",color:"#8ab7b5",unlock:60,cost:1450,h:26,pop:52,tax:4.8,uses:{road:1,power:5,water:4},happy:2});
  def("public_housing", "residential", "公共平價住宅", {architecture:"midrise",color:"#a4aab4",unlock:60,cost:850,h:25,pop:60,tax:3.2,uses:{road:1,power:5,water:4},happy:0.6});
  def("hillside_home", "residential", "山坡景觀住宅", {architecture:"villa",color:"#b99b7d",unlock:60,cost:760,h:16,pop:19,tax:1.9,uses:{road:1,power:2,water:2},happy:2});
  def("manor", "residential", "莊園大宅", {architecture:"civic",color:"#e0c9a3",unlock:800,cost:9200,h:38,pop:95,tax:16,uses:{road:1,power:10,water:8},happy:5});
  def("tiny_home", "residential", "微型環保住宅", {architecture:"cottage",color:"#9abf93",unlock:0,cost:160,h:9,pop:5,tax:0.45,uses:{road:1,power:1,water:1},happy:1,pollution:-0.2});
  def("farmhouse", "residential", "田園農舍", {architecture:"cottage",color:"#c59b6c",unlock:0,cost:290,h:13,pop:9,tax:0.8,uses:{road:1,power:1,water:1},happy:1.6});
  def("loft_apartment", "residential", "工業風閣樓公寓", {architecture:"midrise",color:"#a99a91",unlock:250,cost:1950,h:30,pop:62,tax:6.6,uses:{road:1,power:7,water:5}});
  def("micro_apartments", "residential", "微型套房大樓", {architecture:"tower",color:"#9ba9b6",unlock:250,cost:2800,h:38,pop:100,tax:7.8,uses:{road:1,power:9,water:6}});
  def("luxury_penthouse", "residential", "頂層空中豪邸", {architecture:"tower",color:"#d2ba91",unlock:2500,cost:16500,h:72,pop:175,tax:32,uses:{road:1,power:25,water:18},happy:8});
  def("cafe", "commercial", "街角精品咖啡館", {architecture:"market",color:"#c38e73",unlock:0,cost:180,h:10,jobs:4,upkeep:0.2,uses:{road:1,power:1,water:1},income:2.2,demand:12,happy:0.8});
  def("bakery", "commercial", "社區麵包烘焙坊", {architecture:"market",color:"#d8b583",unlock:0,cost:280,h:11,jobs:5,upkeep:0.3,uses:{road:1,power:2,water:1},income:3,demand:16,happy:0.7});
  def("restaurant", "commercial", "景觀餐廳", {architecture:"market",color:"#ba765e",unlock:60,cost:850,h:15,jobs:13,upkeep:1,uses:{road:1,power:4,water:3},income:8,demand:40,happy:1.4});
  def("supermarket", "commercial", "大型超級市場", {architecture:"market",color:"#72a89b",unlock:60,cost:1450,h:16,jobs:22,upkeep:1.3,uses:{road:1,power:6,water:3},income:12,demand:75});
  def("department_store", "commercial", "城市百貨公司", {architecture:"midrise",color:"#b48cb9",unlock:250,cost:6500,h:30,jobs:65,upkeep:5,uses:{road:1,power:24,water:10},income:30,demand:200,happy:2});
  def("business_park", "commercial", "現代商務園區", {architecture:"campus",color:"#649ca8",unlock:250,cost:9200,h:26,jobs:95,upkeep:6,uses:{road:1,power:32,water:12},income:40,demand:160,pollution:0.4});
  def("business_hotel", "commercial", "國際商務酒店", {architecture:"tower",color:"#8ea9bb",unlock:800,cost:8800,h:42,jobs:58,upkeep:7,uses:{road:1,power:16,water:15},income:36,demand:130,happy:2});
  def("boutique_hotel", "commercial", "海灣精品旅館", {architecture:"villa",color:"#c89d82",unlock:250,cost:3200,h:24,jobs:24,upkeep:2.5,uses:{road:1,power:8,water:8},income:15,demand:65,happy:2,needs:"shore"});
  def("convention_centre", "commercial", "國際會展中心", {architecture:"civic",color:"#8ba5b4",unlock:800,cost:16500,h:25,jobs:82,upkeep:9,uses:{road:1,power:38,water:14},income:52,demand:280,happy:2});
  def("cinema", "commercial", "多廳電影院", {architecture:"midrise",color:"#c67d87",unlock:60,cost:1350,h:16,jobs:18,upkeep:1.4,uses:{road:1,power:8,water:3},income:9,demand:55,happy:1.5});
  def("night_market", "commercial", "夜市美食街", {architecture:"market",color:"#d9a34b",unlock:0,cost:780,h:8,jobs:16,upkeep:0.7,uses:{road:1,power:3,water:2},income:7,demand:48,happy:2});
  def("shopping_arcade", "commercial", "玻璃拱廊購物街", {architecture:"glass",color:"#7fb6b4",unlock:250,cost:3600,h:21,jobs:38,upkeep:3,uses:{road:1,power:12,water:6},income:19,demand:100,happy:2});
  def("coworking_space", "commercial", "共享辦公空間", {architecture:"glass",color:"#8cabbc",unlock:60,cost:1800,h:20,jobs:25,upkeep:1.8,uses:{road:1,power:7,water:3},income:13,demand:45});
  def("financial_tower", "commercial", "金融中心摩天大樓", {architecture:"tower",color:"#7488aa",unlock:2500,cost:32500,h:90,jobs:240,upkeep:24,uses:{road:1,power:85,water:36},income:160,demand:650});
  def("tech_campus", "commercial", "科技企業總部園區", {architecture:"campus",color:"#5d9fae",unlock:800,cost:18500,h:38,jobs:155,upkeep:13,uses:{road:1,power:48,water:18},income:82,demand:270,pollution:-1});
  def("art_mall", "commercial", "藝術設計購物中心", {architecture:"civic",color:"#c29aac",unlock:250,cost:5200,h:23,jobs:42,upkeep:4,uses:{road:1,power:18,water:9},income:24,demand:125,happy:4});
  def("rooftop_market", "commercial", "空中花園市集", {architecture:"green",color:"#6cae8f",unlock:250,cost:3800,h:24,jobs:32,upkeep:2.6,uses:{road:1,power:10,water:8},income:18,demand:90,happy:3,pollution:-0.5});
  def("game_arcade", "commercial", "電競遊樂中心", {architecture:"glass",color:"#7e8fd3",unlock:60,cost:2250,h:18,jobs:21,upkeep:1.8,uses:{road:1,power:12,water:3},income:15,demand:70,happy:2});
  def("daycare", "service", "社區幼兒園", {architecture:"cottage",color:"#dda5a1",unlock:0,cost:380,h:11,jobs:8,upkeep:0.5,uses:{road:1,power:2,water:1},happy:2.5});
  def("elementary_school", "service", "市立小學", {architecture:"civic",color:"#d2b373",unlock:60,cost:1250,h:18,jobs:18,upkeep:1.5,uses:{road:1,power:5,water:3},happy:4});
  def("high_school", "service", "綜合高中", {architecture:"civic",color:"#94a9c4",unlock:250,cost:3600,h:23,jobs:34,upkeep:3.4,uses:{road:1,power:12,water:5},happy:5});
  def("city_library", "service", "中央圖書館", {architecture:"civic",color:"#c2b79f",unlock:60,cost:1550,h:20,jobs:12,upkeep:1.2,uses:{road:1,power:4,water:2},happy:4.5});
  def("community_center", "service", "市民活動中心", {architecture:"civic",color:"#b5ad9c",unlock:60,cost:1100,h:15,jobs:10,upkeep:0.8,uses:{road:1,power:3,water:2},happy:3});
  def("fire_hq", "service", "消防總局", {architecture:"civic",color:"#c46c62",unlock:250,cost:2900,h:22,jobs:28,upkeep:3.2,uses:{road:1,power:9,water:5},happy:4});
  def("police_hq", "service", "警政總部", {architecture:"civic",color:"#6c83af",unlock:250,cost:3400,h:27,jobs:32,upkeep:3.8,uses:{road:1,power:10,water:4},happy:4});
  def("medical_center", "service", "區域醫療中心", {architecture:"civic",color:"#d2e0e3",unlock:250,cost:4600,h:28,jobs:48,upkeep:5,uses:{road:1,power:18,water:12},happy:7});
  def("science_university", "service", "科技研究大學", {architecture:"campus",color:"#7fabbc",unlock:800,cost:13800,h:31,jobs:82,upkeep:9,uses:{road:1,power:30,water:12},happy:8});
  def("heritage_museum", "service", "歷史文化博物館", {architecture:"civic",color:"#c4a98d",unlock:60,cost:1850,h:21,jobs:14,upkeep:1.5,uses:{road:1,power:5,water:2},happy:5});
  def("concert_hall", "service", "城市音樂廳", {architecture:"dome",color:"#b2a0c8",unlock:250,cost:5400,h:27,jobs:35,upkeep:4.8,uses:{road:1,power:16,water:6},happy:8});
  def("art_gallery", "service", "當代藝術美術館", {architecture:"civic",color:"#ddc5a4",unlock:250,cost:4250,h:19,jobs:22,upkeep:3,uses:{road:1,power:9,water:4},happy:6});
  def("sports_center", "service", "全民綜合運動中心", {architecture:"stadium",color:"#83a9a1",unlock:250,cost:5200,h:17,jobs:28,upkeep:4,uses:{road:1,power:16,water:9},happy:7});
  def("botanical_garden", "service", "國家植物園", {architecture:"plaza",color:"#8fbd8e",unlock:60,cost:1750,h:7,jobs:8,upkeep:0.8,uses:{road:1,power:1,water:5},happy:7,pollution:-2});
  def("city_zoo", "service", "城市動物園", {architecture:"plaza",color:"#9cae74",unlock:800,cost:9800,h:12,jobs:48,upkeep:8,uses:{road:1,power:12,water:16},happy:9});
  def("aquatic_center", "service", "水上運動中心", {architecture:"stadium",color:"#5fa4be",unlock:250,cost:4900,h:15,jobs:26,upkeep:5,uses:{road:1,power:15,water:20},happy:7});
  def("observatory", "service", "山頂天文觀測台", {architecture:"spire",color:"#879ab7",unlock:800,cost:7700,h:32,jobs:14,upkeep:2.3,uses:{road:1,power:5,water:1},happy:5});
  def("television_tower", "service", "城市電視廣播塔", {architecture:"spire",color:"#8c9eac",unlock:250,cost:6400,h:78,jobs:42,upkeep:4,uses:{road:1,power:20,water:2},income:8,happy:1});

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

    { id: 'greenDistrict', name: '綠色街區', desc: '建造 5 座低碳或綠化建築', reward: 8000, check: c => (c.built.eco_village||0)+(c.built.eco_factory||0)+(c.built.botanical_garden||0)+(c.built.rooftop_solar_farm||0)+(c.built.water_recycling_plant||0) >= 5 },
    { id: 'transitHub', name: '四通八達', desc: '建造 3 座大型轉運設施', reward: 12000, check: c => (c.built.transit_interchange||0)+(c.built.metro_hub||0)+(c.built.train_station||0)+(c.built.city_airport_terminal||0) >= 3 },
    { id: 'educationCity', name: '知識之城', desc: '建造 3 間教育設施', reward: 9000, check: c => (c.built.elementary_school||0)+(c.built.high_school||0)+(c.built.science_university||0)+(c.built.city_library||0) >= 3 },
    { id: 'cultureDistrict', name: '藝文首都', desc: '建造 3 座藝文設施', reward: 10000, check: c => (c.built.concert_hall||0)+(c.built.art_gallery||0)+(c.built.heritage_museum||0)+(c.built.art_mall||0) >= 3 },
    { id: 'skyline', name: '閃耀天際線', desc: '建造 5 座高層建築', reward: 25000, check: c => (c.built.financial_tower||0)+(c.built.luxury_penthouse||0)+(c.built.tower_block||0)+(c.built.television_tower||0)+(c.built.data_farm||0) >= 5 },
    { id: 'waterMaster', name: '水資源大師', desc: '建造 3 座供水或水循環設施', reward: 8000, check: c => (c.built.desalination_plant||0)+(c.built.water_recycling_plant||0)+(c.built.rain_harvesting||0)+(c.built.sewage_plant||0) >= 3 },
    { id: 'industryLeader', name: '產業領航者', desc: '建造 5 座現代工業設施', reward: 18000, check: c => (c.built.biotech_lab||0)+(c.built.ev_factory||0)+(c.built.chip_fab||0)+(c.built.aerospace_plant||0)+(c.built.data_farm||0) >= 5 },
    { id: 'residentialMix', name: '宜居城市', desc: '建立 4 種不同住宅型態', reward: 6000, check: c => (c.built.cottage||0)+(c.built.eco_village||0)+(c.built.tower_block||0)+(c.built.student_dorm||0)+(c.built.waterfront_condo||0)+(c.built.public_housing||0) >= 4 },
    { id: 'tourismBoom', name: '觀光熱點', desc: '建造 3 座休閒與旅遊設施', reward: 14000, check: c => (c.built.business_hotel||0)+(c.built.boutique_hotel||0)+(c.built.city_zoo||0)+(c.built.aquatic_center||0)+(c.built.convention_centre||0) >= 3 },
    { id: 'cityCreator', name: '城市創造家', desc: '總建築數達到 500', reward: 90000, check: c => c.total >= 500 },
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

  // ── V11 自由城市擴充：觀光、文化、產業鏈與地標 ──
  def("chinatown_gate", "service", "唐人街牌樓", {architecture:"civic",color:"#c83e35",unlock:60,cost:2200,h:23,jobs:8,upkeep:0.6,uses:{road:1},happy:4,income:1.5});
  def("neon_market", "commercial", "霓虹夜市街區", {architecture:"market",color:"#b64de0",unlock:60,cost:3100,h:19,jobs:26,upkeep:1.2,uses:{road:1,power:8,water:3},tax:12,income:3,happy:3});
  def("waterfront_promenade", "service", "海濱觀景步道", {architecture:"campus",color:"#4aa9bd",unlock:60,cost:1800,h:8,jobs:6,upkeep:0.3,happy:4,income:0.8,needs:"shore"});
  def("botanical_dome", "service", "玻璃植物園穹頂", {architecture:"dome",color:"#5eaf7d",unlock:250,cost:6800,h:27,jobs:22,upkeep:2.5,uses:{road:1,power:8,water:12},happy:7,pollution:-2});
  def("convention_centre", "commercial", "國際會展中心", {architecture:"glass",color:"#6b9fc9",unlock:800,cost:17500,h:28,jobs:72,upkeep:9,uses:{road:1,power:28,water:12},income:22,tax:28,happy:3});
  def("film_studio", "industrial", "影視製作園區", {architecture:"campus",color:"#a879b8",unlock:250,cost:6100,h:20,jobs:38,upkeep:4,uses:{road:1,power:18,water:4},tax:18,income:5,happy:1});
  def("marina", "commercial", "遊艇碼頭", {architecture:"harbor",color:"#4d9fb7",unlock:250,cost:7200,h:18,jobs:28,upkeep:4,uses:{road:1,power:7,water:4},income:14,happy:4,needs:"shore"});
  def("food_market", "commercial", "城市美食廣場", {architecture:"market",color:"#d8a14e",unlock:0,cost:850,h:13,jobs:14,upkeep:0.5,uses:{road:1,power:3,water:3},tax:4,income:1.5,happy:2});
  def("urban_farm", "industrial", "垂直都市農場", {architecture:"green",color:"#69a96b",unlock:60,cost:2450,h:25,jobs:20,upkeep:1.4,uses:{road:1,power:7,water:8},goods:12,tax:5,pollution:-1,happy:2});
  def("sorting_centre", "industrial", "智慧資源分類中心", {architecture:"industrial",color:"#719a8b",unlock:250,cost:5400,h:18,jobs:30,upkeep:3,uses:{road:1,power:14,water:3},goods:8,tax:10,pollution:-3});
  def("logistics_hub", "industrial", "多式聯運物流樞紐", {architecture:"industrial",color:"#b18a65",unlock:800,cost:12800,h:24,jobs:64,upkeep:7,uses:{road:1,power:22,water:5},goods:22,tax:24,income:7,pollution:2});
  def("data_exchange", "commercial", "城市數據交易中心", {architecture:"glass",color:"#4f88cb",unlock:2500,cost:26500,h:34,jobs:95,upkeep:17,uses:{road:1,power:65,water:10},tax:58,income:18,pollution:0.8});
  def("science_museum", "service", "科學探索博物館", {architecture:"dome",color:"#e1a65a",unlock:250,cost:5300,h:22,jobs:20,upkeep:2,uses:{road:1,power:7,water:3},happy:4,tax:5,income:2});
  def("grand_arena", "service", "城市巨蛋競技場", {architecture:"dome",color:"#c46f6f",unlock:800,cost:19800,h:31,jobs:65,upkeep:11,uses:{road:1,power:30,water:14},happy:8,income:15,tax:20});
  def("world_wonder", "service", "全服合作奇觀", {architecture:"spire",color:"#d6b45b",unlock:2500,cost:85000,h:48,jobs:40,upkeep:18,uses:{road:1,power:22,water:8},happy:12,income:25,tax:20,pollution:-1});
  def("eco_transit_hub", "transport", "綠能交通樞紐", {architecture:"green",color:"#48a995",unlock:800,cost:11200,h:23,jobs:42,upkeep:5,uses:{road:1,power:18,water:5},happy:5,pollution:-1.5});

  return { CHUNK, NET_BIT, CATS, BUILDINGS, def, variant, needBits, LEVELS, levelIndex, ACHIEVEMENTS, EVENTS, GAME_MODES,
    CLAIM_BASE: 1500, START_MONEY: 5000, BASE_SUPPLY: { power: 30, water: 30 } };   // BASE_SUPPLY：每位玩家免費的基礎水電額度
});
