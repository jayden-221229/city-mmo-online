// 程序生成建築貼圖：每種建築有自己的造型（斜屋頂、冷卻塔、水塔、體育館…），不是單純方盒。
// 座標：u / w 是地磚平面座標（-0.5 ~ 0.5，u 朝畫面右下、w 朝畫面左下），z 是離地高度（像素）。
// 沒有真實美術時由 game.js 呼叫 CityShapes.makeBlock；有 atlas.png 時會被取代。
(() => {
'use strict';
const TW = 64, TH = 32, PAD = 8;

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16), k = f < 0 ? 0 : 255, p = Math.abs(f);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.round((k - r) * p + r)},${Math.round((k - g) * p + g)},${Math.round((k - b) * p + b)})`;
};
const tint = (hex, f) => {                                   // 與 shade 相同，但回傳 #hex（可再被 shade 處理）
  const n = parseInt(hex.slice(1), 16), k = f < 0 ? 0 : 255, p = Math.abs(f);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(s => Math.round((k - s) * p + s).toString(16).padStart(2, '0')).join('');
};
const LIT = 'rgba(255,236,160,.85)';

/** 繪圖工具箱：所有造型都用這些原件拼出來（方盒、斜屋頂、圓柱、圓錐、圓頂、冷卻塔…） */
function makeKit(g, cx, cyb, v) {
  const j = [-0.08, 0, 0.1][v];                              // 三種外觀變體的明暗差
  const K = { g, v, j, wv: [-0.05, 0, 0.06][v], maxZ: 0, smokes: [], rotors: [] };
  const P = K.P = (u, w, z = 0) => [cx + (u - w) * 32, cyb + (u + w) * 16 - z];
  const up = z => { if (z > K.maxZ) K.maxZ = z; };
  const poly = K.poly = (pts, fill, edge) => {
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = fill; g.fill();
    if (edge) { g.lineWidth = 0.75; g.strokeStyle = 'rgba(20,31,44,.16)'; g.stroke(); }
  };
  const grad = (x, r, col, a = 0.18, b = 0.45) => {
    const gr = g.createLinearGradient(x - r, 0, x + r, 0);
    gr.addColorStop(0, shade(col, a + j)); gr.addColorStop(0.5, shade(col, -0.08 + j)); gr.addColorStop(1, shade(col, -b + j));
    return gr;
  };

  K.shadow = () => poly([P(-.5, -.5), P(.5, -.5), P(.5, .5), P(-.5, .5)], 'rgba(0,0,0,.22)');
  // Decorative landscaped plinth: layered paving, lawns, paths and shrubs give buildings a sense of place.
  K.landscape = (d) => {
    const green = ['#8dbb72', '#78ad69', '#a2c982'][v];
    const stone = ['#d9d9d0', '#c8d0d2', '#e4d8c4'][v];
    poly([P(-.47,-.43,0),P(.43,-.47,0),P(.47,.43,0),P(-.43,.47,0)], stone, true);
    if (d.cat === 'residential' || d.cat === 'service' || d.id === 'stadium' || d.id === 'park') {
      poly([P(-.39,-.34,1),P(.30,-.39,1),P(.39,.28,1),P(-.30,.39,1)], green, false);
      // Small paved entrance approach and garden beds.
      poly([P(-.08,.30,1.4),P(.04,.30,1.4),P(.04,-.22,1.4),P(-.08,-.22,1.4)], '#e8dfca', false);
      for (const [u,w] of [[-.34,-.28],[.33,-.27],[-.31,.30],[.31,.29]]) {
        const [x,y]=P(u,w,1.5); g.fillStyle=['#397b45','#4f914d','#6da65b'][((v+Math.round((u+w)*10)+3)%3+3)%3];
        g.beginPath(); g.arc(x,y,2.2,0,Math.PI*2); g.fill();
        g.fillStyle='rgba(255,255,255,.22)'; g.beginPath(); g.arc(x-0.6,y-0.7,0.8,0,Math.PI*2); g.fill();
      }
    } else {
      // commercial/industrial/public plazas with contrasting paving and entry apron
      poly([P(-.34,.34,1),P(-.25,.34,1),P(-.25,-.18,1),P(-.34,-.18,1)], '#f4ead5', false);
      poly([P(.25,.32,1),P(.34,.32,1),P(.34,-.18,1),P(.25,-.18,1)], '#f4ead5', false);
      for(let i=0;i<3;i++) poly([P(-.28+i*.22,.40,1.1),P(-.22+i*.22,.40,1.1),P(-.22+i*.22,.34,1.1),P(-.28+i*.22,.34,1.1)], '#7aa66a', false);
    }
  };

  K.windows = (u0, u1, w0, w1, z0, hh, o = {}) => {          // 有窗框、反光與明暗變化的玻璃立面
    const gx = o.gx || 8, gy = o.gy || 7, ww = o.ww || 4, wh = o.wh || 3, lit = o.lit || LIT;
    const faces = [[P(u0, w1, z0 + hh), (u1 - u0) * 32, 0.5], [P(u1, w1, z0 + hh), (w1 - w0) * 32, -0.5]];
    for (const [[x, y], wd, sk] of faces) {
      g.save(); g.transform(1, sk, 0, 1, x, y);
      for (let yy = (o.top == null ? 4 : o.top) + v; yy < hh - (o.bot == null ? 3 : o.bot); yy += gy) {
        for (let xx = 4; xx < wd - 5; xx += gx) {
          const pattern = Math.abs(Math.floor(xx / gx) + Math.floor(yy / gy) * 2 + v) % 6;
          // 深色金屬窗框與內縮玻璃，避免原本亮色小方塊的塑膠感。
          g.fillStyle = 'rgba(22,35,48,.72)'; g.fillRect(xx - .7, yy - .6, ww + 1.4, wh + 1.2);
          g.fillStyle = pattern === 0 ? 'rgba(38,56,73,.96)' : (pattern === 1 ? 'rgba(255,211,129,.92)' : lit);
          g.fillRect(xx, yy, ww, wh);
          g.fillStyle = 'rgba(255,255,255,.42)'; g.fillRect(xx + .45, yy + .35, Math.max(.55, ww * .18), Math.max(.7, wh - .7));
          g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(xx, yy + wh - .45, ww, .45);
        }
      }
      g.restore();
    }
  };
  K.box = (u0, u1, w0, w1, z0, hh, col, o = {}) => {
    const t = z0 + hh; up(t);
    poly([P(u0, w1, z0), P(u1, w1, z0), P(u1, w1, t), P(u0, w1, t)], shade(col, -0.25 + j), 1);   // 左牆（面向 +w）
    poly([P(u1, w1, z0), P(u1, w0, z0), P(u1, w0, t), P(u1, w1, t)], shade(col, -0.42 + j), 1);   // 右牆（面向 +u）
    poly([P(u0, w0, t), P(u1, w0, t), P(u1, w1, t), P(u0, w1, t)], shade(o.top || col, 0.12 + j), 1);   // 頂面
    if (o.win) K.windows(u0, u1, w0, w1, z0, hh, o.win);
  };
  K.decalL = (u0, u1, w, z0, z1, col) => poly([P(u0, w, z0), P(u1, w, z0), P(u1, w, z1), P(u0, w, z1)], col);    // 貼在左牆上的色塊（門、招牌…）
  K.decalR = (u, w0, w1, z0, z1, col) => poly([P(u, w1, z0), P(u, w0, z0), P(u, w0, z1), P(u, w1, z1)], col);    // 貼在右牆上
  K.flat = (pts, z, col) => { up(z); poly(pts.map(([u, w]) => P(u, w, z)), col); };
  K.line = (u1, w1, z1, u2, w2, z2, col, wd = 1) => {
    up(Math.max(z1, z2)); g.beginPath(); g.moveTo(...P(u1, w1, z1)); g.lineTo(...P(u2, w2, z2));
    g.strokeStyle = col; g.lineWidth = wd; g.stroke();
  };
  K.ell = (u, w, z, rx, col, stroke) => {
    up(z); const [x, y] = P(u, w, z); g.beginPath(); g.ellipse(x, y, rx, rx / 2, 0, 0, Math.PI * 2);
    g.fillStyle = col; g.fill(); if (stroke) { g.lineWidth = 1; g.strokeStyle = stroke; g.stroke(); }
  };
  K.dot = (u, w, z, r, col) => { up(z + r); const [x, y] = P(u, w, z); g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = col; g.fill(); };
  K.tree = (u, w, z0, r) => {
    K.line(u, w, z0, u, w, z0 + 4, '#5a3b1e', 2);
    const [x, y] = P(u, w, z0 + 4 + r * 0.7); up(z0 + 4 + r * 1.6);
    g.fillStyle = '#2d7a3a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); g.fill();
  };
  K.gable = (u0, u1, w0, w1, z, hh, col, axis) => {          // 斜屋頂：axis='u' 屋脊沿 u 方向，'w' 沿 w 方向
    up(z + hh); const um = (u0 + u1) / 2, wm = (w0 + w1) / 2;
    if (axis === 'u') {
      poly([P(u0, w0, z), P(u1, w0, z), P(u1, wm, z + hh), P(u0, wm, z + hh)], shade(col, -0.3 + j), 1);   // 後坡（坡度淺時也看得到）
      poly([P(u0, w1, z), P(u1, w1, z), P(u1, wm, z + hh), P(u0, wm, z + hh)], shade(col, 0.02 + j), 1);    // 前坡
      poly([P(u1, w1, z), P(u1, w0, z), P(u1, wm, z + hh)], shade(col, -0.4 + j), 1);                         // 山牆
    } else {
      poly([P(u0, w0, z), P(u0, w1, z), P(um, w1, z + hh), P(um, w0, z + hh)], shade(col, -0.3 + j), 1);
      poly([P(u1, w0, z), P(u1, w1, z), P(um, w1, z + hh), P(um, w0, z + hh)], shade(col, -0.08 + j), 1);
      poly([P(u0, w1, z), P(u1, w1, z), P(um, w1, z + hh)], shade(col, -0.4 + j), 1);
    }
  };
  K.cyl = (u, w, r, z0, hh, col, o = {}) => {
    const [x, y0] = P(u, w, z0), y1 = y0 - hh; up(z0 + hh + r / 2);
    g.beginPath(); g.moveTo(x - r, y1); g.lineTo(x - r, y0); g.ellipse(x, y0, r, r / 2, 0, Math.PI, 0, true);
    g.lineTo(x + r, y1); g.ellipse(x, y1, r, r / 2, 0, 0, Math.PI); g.closePath();
    g.fillStyle = grad(x, r, col); g.fill();
    if (o.bands) {                                            // 條紋（煙囪的紅白帶）
      g.save(); g.clip(); g.globalAlpha = 0.6;
      for (let yy = y1, i = 0; yy < y0; yy += 5, i++) { g.fillStyle = o.bands[i % o.bands.length]; g.fillRect(x - r, yy, 2 * r, 5); }
      g.restore();
    }
    g.beginPath(); g.ellipse(x, y1, r, r / 2, 0, 0, Math.PI * 2); g.fillStyle = shade(o.top || col, 0.2 + j); g.fill();
  };
  K.cone = (u, w, r, z0, hh, col) => {
    const [x, y0] = P(u, w, z0); up(z0 + hh);
    g.beginPath(); g.moveTo(x - r, y0); g.ellipse(x, y0, r, r / 2, 0, Math.PI, 0, true); g.lineTo(x, y0 - hh); g.closePath();
    g.fillStyle = grad(x, r, col); g.fill();
  };
  K.dome = (u, w, r, z0, col) => {
    const [x, y0] = P(u, w, z0); up(z0 + r);
    g.beginPath(); g.moveTo(x - r, y0); g.ellipse(x, y0, r, r, 0, Math.PI, Math.PI * 2); g.ellipse(x, y0, r, r / 2, 0, 0, Math.PI); g.closePath();
    g.fillStyle = grad(x, r, col, 0.3, 0.35); g.fill();
  };
  K.tower = (u, w, rb, rw, rt, z0, hh, col) => {              // 雙曲面冷卻塔
    const [x, y0] = P(u, w, z0); up(z0 + hh + rt / 2);
    const rad = t => (t < 0.62 ? rw + (rb - rw) * ((0.62 - t) / 0.62) ** 2 : rw + (rt - rw) * ((t - 0.62) / 0.38) ** 2);
    const N = 16, L = [], R = [];
    for (let i = 0; i <= N; i++) { const t = i / N, r = rad(t), y = y0 - t * hh; L.push([x - r, y]); R.push([x + r, y]); }
    g.beginPath(); g.moveTo(...L[0]); L.forEach(p => g.lineTo(...p)); for (let i = N; i >= 0; i--) g.lineTo(...R[i]);
    g.ellipse(x, y0, rb, rb / 2, 0, 0, Math.PI); g.closePath();
    g.fillStyle = grad(x, rb, col, 0.12, 0.4); g.fill();
    g.beginPath(); g.ellipse(x, y0 - hh, rt, rt / 2, 0, 0, Math.PI * 2); g.fillStyle = shade(col, 0.2 + j); g.fill();
    g.beginPath(); g.ellipse(x, y0 - hh, rt * 0.78, rt * 0.39, 0, 0, Math.PI * 2); g.fillStyle = '#3c4348'; g.fill();
  };
  K.up = up;                                                  // 自訂繪圖（摩天輪、風車葉片）時用來告知最高點
  K.smoke = (u, w, z) => { K.smokes.push(P(u, w, z)); };      // 只記錄位置，由 game.js 每幀畫煙
  K.rotor = (u, w, z, r = 16, speed = 0.0015) => {          // 記錄風機轉子位置，由 game.js 每幀重畫葉片
    const [x, y] = P(u, w, z); up(z + r + 3);
    K.rotors.push({ x, y, r, speed, phase: K.rotors.length * 0.73 });
  };
  return K;
}

// ───────────── 各建築造型 ─────────────
const SHAPES = {
  _box: (K, d, h) => K.box(-.4, .4, -.34, .34, 0, h, d.color, { win: {} }),

  subway(K, d) {
    K.box(-.32, .32, -.26, .26, 0, 8, '#dfe5ec', { win: { gx: 12, top: 2, bot: 2, lit: 'rgba(120,170,220,.9)' } });
    K.box(-.4, .4, -.34, .34, 8, 2.5, d.color);
    K.decalL(-.12, .12, .26, 0, 7, '#2b3340');
    K.line(.36, .3, 0, .36, .3, 20, '#9aa4af', 1.5);
    K.dot(.36, .3, 22, 5, '#ffffff'); K.dot(.36, .3, 22, 3.6, d.color);
  },
  bus_stop(K, d) {
    // Compact curbside stop: raised concrete pad, shelter roof, supports, bench and bus sign.
    K.flat([[-.43,-.34],[.40,-.38],[.44,.31],[-.39,.36]], 0, '#c7d0d2');
    K.box(-.30, .15, -.22, .22, 0, 5.5, '#6c8589');
    K.box(-.33, .18, -.25, .25, 5.5, 1.35, d.color);
    K.box(-.29, .13, -.20, .20, 6.85, .55, '#eaf2ef');
    K.box(-.28, -.23, -.20, -.16, 0, 6.7, '#687980');
    K.box(.08, .20, -.20, -.16, 0, 6.7, '#687980');
    K.box(-.21, -.02, .12, .18, 0, 1.5, '#546a70');
    K.box(.22, .28, .23, .29, 0, 8.5, '#5b6e75');
    K.box(.15, .34, .22, .30, 8.5, 4, '#e8f1ee');
    K.box(.17, .32, .235, .285, 10.2, .7, '#20a39e');
    K.dot(.245, .25, 11.4, 1.2, '#f2c14e');
  },
  bus_station(K, d) {
    K.flat([[-.48,-.4],[.45,-.43],[.47,.4],[-.42,.43]], 0, '#c8d2d3');
    K.box(-.38, .18, -.28, .28, 0, 7, '#e7eceb', { win: { gx: 7, gy: 5, ww: 3, wh: 3, lit: 'rgba(139,224,216,.95)' } });
    K.box(-.42, .22, -.31, .31, 7, 2, d.color);
    K.box(.19, .42, -.25, .28, 0, 5, '#8eb8b4');
    K.flat([[-.43,-.38],[.44,-.38],[.43,-.32],[-.43,-.32]], 1.4, '#f8f4de');
    for (const u of [-.22, .05, .32]) { K.box(u-.065, u+.065, .32, .40, 0, 1.5, '#f3c969'); K.line(u, .34, 1.5, u, .34, 6, '#41545c', 1); }
  },
  bus_terminal(K, d) {
    K.flat([[-.48,-.44],[.46,-.46],[.48,.42],[-.45,.46]], 0, '#c8d1d4');
    K.box(-.38, .05, -.33, .30, 0, 12, '#e5ebed', { win: { gx: 8, gy: 6, ww: 4, wh: 3, lit: 'rgba(140,227,220,.9)' } });
    K.box(-.42, .10, -.36, .33, 12, 2.5, d.color);
    K.box(.12, .42, -.30, .30, 0, 7, '#6f9fa0');
    // 三個有頂棚的候車月台
    for (const w of [-.25, -.02, .21]) {
      K.box(.13, .43, w-.065, w+.065, 0, 3, '#dfe9e8');
      K.box(.09, .47, w-.085, w+.085, 3, 1.7, '#253c49');
      K.line(.1, w-.07, 1, .1, w-.07, 9, '#e5b85c', 1.3);
    }
    K.flat([[-.36,.37],[.41,.37],[.41,.42],[-.36,.42]], 1, '#f1c75b');
  },
  solar(K, d) {
    K.box(-.44, .44, -.44, .44, 0, 1.5, '#9aa0a6');
    for (const [cu, cw] of [[-.22, -.22], [.22, -.22], [-.22, .22], [.22, .22]]) {
      const pts = [[cu - .19, cw - .19, 4], [cu + .19, cw - .19, 4], [cu + .19, cw + .19, 2], [cu - .19, cw + .19, 2]].map(p => K.P(...p));
      K.poly(pts, '#1f3f7a', 1);
      K.g.strokeStyle = 'rgba(190,215,255,.6)'; K.g.lineWidth = 1; K.g.beginPath();
      K.g.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2); K.g.lineTo((pts[2][0] + pts[3][0]) / 2, (pts[2][1] + pts[3][1]) / 2);
      K.g.moveTo((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2); K.g.lineTo((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2); K.g.stroke();
    }
    K.box(.34, .44, -.44, -.34, 1.5, 5, '#c8ccd2');
  },
  coal(K, d, h) {
    K.box(-.42, .24, -.36, .3, 0, h, '#6a6a70', { win: { gx: 12, gy: 9, top: 4, lit: 'rgba(255,190,90,.7)' } });
    K.cyl(-.1, -.26, 4.5, h, 30, '#9a9aa0', { bands: ['#d94a3a', '#f2f2f2'] });
    K.cyl(.1, -.28, 4.5, h, 30, '#9a9aa0', { bands: ['#d94a3a', '#f2f2f2'] });
    K.smoke(-.1, -.26, h + 30); K.smoke(.1, -.28, h + 30);
    K.line(.2, .1, 1, .34, .22, 9, '#555a60', 2);
    K.cone(.34, .22, 9, 0, 8, '#25262b');
  },
  nuclear(K, d, h) {
    K.tower(-.18, -.16, 17, 11, 14, 0, 40, '#e9eef0');
    K.smoke(-.18, -.16, 40);
    K.cyl(.22, -.3, 10, 0, 8, '#d6dde2'); K.dome(.22, -.3, 10, 8, '#d6dde2');
    K.box(0, .44, -.1, .4, 0, 12, '#aeb6bc', { win: { gx: 12, gy: 9, top: 3 } });
  },
  water_tower(K, d, h) {
    const tz = h * 0.55;
    for (const [u, w] of [[-.16, -.16], [.16, -.16], [-.16, .16], [.16, .16]]) K.line(u * 1.2, w * 1.2, 0, u * .7, w * .7, tz, '#5b6770', 2);
    K.line(-.2, .2, tz * .45, .2, .2, tz * .45, '#7b8790', 1.2); K.line(.2, .2, tz * .45, .2, -.2, tz * .45, '#7b8790', 1.2);
    K.cyl(0, 0, 12, tz, h * 0.3, d.color);
    K.cone(0, 0, 12.5, tz + h * 0.3, h * 0.15, tint(d.color, -0.15));
    K.line(.2, .2, 0, .15, .15, tz, '#3d4349', 1);
  },
  water_plant(K, d) {
    K.box(-.4, .1, -.34, .3, 0, 12, '#d8e4ec', { win: { gx: 10, gy: 8, top: 5, lit: 'rgba(120,190,230,.9)' } });
    K.decalL(-.4, .1, .3, 9, 12, d.color); K.decalR(.1, -.34, .3, 9, 12, d.color);
    K.cyl(.3, -.2, 11, 0, 7, '#c9d6de', { top: '#4fa9d9' });
    K.line(.1, 0, 4, .3, 0, 4, '#8896a0', 2.5);
    K.cyl(.3, .22, 11, 0, 7, '#c9d6de', { top: '#4fa9d9' });
  },
  bungalow(K, d) {
    K.box(-.34, .3, -.26, .26, 0, 9, tint('#efe3cc', K.wv), { win: { gx: 10, top: 2, bot: 2 } });
    K.gable(-.38, .34, -.3, .3, 9, 9, d.color, 'u');
    K.box(.1, .2, -.2, -.1, 14, 6, '#9c6b4a');
    K.decalL(-.12, .0, .26, 0, 6, '#6b4a2f'); K.decalL(.1, .2, .26, 3, 7, '#9fd0e8');
    K.tree(-.42, .36, 0, 6);
  },
  apartment(K, d, h) {
    K.box(-.36, .36, -.3, .3, 0, h, d.color, { win: { gx: 8, gy: 7 } });
    K.decalL(-.36, .36, .3, 0, 5, 'rgba(0,0,0,.3)'); K.decalR(.36, -.3, .3, 0, 5, 'rgba(0,0,0,.3)');
    K.box(-.3, -.05, -.2, .05, h, 4, '#9aa0a8');
    K.cyl(.2, -.1, 4.5, h, 7, '#6f8fa8');
  },
  luxury(K, d, h) {
    const a = Math.round(h * 0.3), b = Math.round(h * 0.4), c = h - a - b - 6, gold = 'rgba(255,238,170,.9)';
    K.box(-.38, .38, -.32, .32, 0, a, d.color, { win: { gx: 7, gy: 6, lit: gold } });
    K.box(-.3, .3, -.25, .25, a, b, tint(d.color, .06), { win: { gx: 7, gy: 6, lit: gold } });
    K.box(-.22, .22, -.18, .18, a + b, c, tint(d.color, .12), { win: { gx: 6, gy: 6, lit: gold } });
    K.box(-.27, .27, -.22, .22, h - 6, 3, '#f4e3a8');
    K.line(0, 0, h - 3, 0, 0, h + 12, '#d8c27a', 1.5);
  },
  shop(K, d, h) {
    K.box(-.36, .36, -.3, .3, 0, h, '#f1ebdd', { win: { gx: 11, gy: 8, top: 8 } });
    const zA = Math.round(h * 0.45), zB = zA + 4;           // 彩色遮陽棚
    for (let i = 0; i < 6; i++) {
      const col = i % 2 ? '#ffffff' : d.color;
      K.decalL(-.36 + i * .12, -.36 + (i + 1) * .12, .3, zA, zB, col);
      K.decalR(.36, -.3 + i * .1, -.3 + (i + 1) * .1, zA, zB, col);
    }
    K.box(-.1, .12, -.05, .05, h, 4, d.color);
  },
  convenience(K, d, h) {
    K.box(-.3, .3, -.24, .24, 0, h, '#f4f6f8', { win: { gx: 12, top: 6 } });
    K.decalL(-.3, .3, .24, h - 5, h, d.color); K.decalR(.3, -.24, .24, h - 5, h, d.color);
    K.box(.32, .42, -.1, .1, 0, 6, '#dfe9f2');
  },
  mall(K, d, h) {
    K.box(-.42, .42, -.36, .36, 0, h, '#e6ebf0', { win: { gx: 12, gy: 9, ww: 7, wh: 5, top: 5, lit: 'rgba(150,200,240,.9)' } });
    K.box(-.38, -.1, -.3, -.12, h, 5, d.color); K.box(.1, .36, -.3, -.12, h, 3, '#aeb6bf');
    K.box(-.15, .15, .2, .46, 0, h + 6, '#b4dcf4', { win: { gx: 6, gy: 6, ww: 4, wh: 4, lit: 'rgba(255,255,255,.7)' } });
  },
  finance(K, d, h) {
    const bh = h - 22;
    K.box(-.3, .3, -.27, .27, 0, bh, d.color, { win: { gx: 5, gy: 5, ww: 3, wh: 3, top: 3, lit: 'rgba(200,225,255,.85)' } });
    K.box(-.22, .22, -.2, .2, bh, 8, tint(d.color, .18), { win: { gx: 5, gy: 4, ww: 3, wh: 2, top: 2, bot: 1 } });
    K.line(0, 0, bh + 8, 0, 0, bh + 22, '#c9d0da', 1.5);
  },
  factory_light(K, d, h) {
    K.box(-.42, .42, -.34, .34, 0, h, '#d9cf9a', { win: { gx: 10, gy: 8, top: 3 } });
    for (let i = 0; i < 3; i++) K.gable(-.42 + i * .28, -.42 + (i + 1) * .28, -.34, .34, h, 7, d.color, 'w');
    K.cyl(.34, -.28, 3.5, h, 12, '#7a5a40'); K.smoke(.34, -.28, h + 12);
    K.decalL(-.1, .08, .34, 0, 8, '#4a4f58');
    K.box(.28, .4, .38, .48, 0, 5, '#a8793f');
  },
  steel(K, d, h) {
    K.box(-.42, .4, -.34, .3, 0, h, '#8a8d96', { win: { gx: 12, gy: 9, top: 4, lit: 'rgba(255,170,80,.75)' } });
    K.cyl(-.2, -.2, 8, h, 26, '#5e6169', { top: '#ff9a3c' });
    K.cyl(.2, -.22, 3.5, h, 28, '#4a4c52', { bands: ['#4a4c52', '#c8c8c8'] }); K.smoke(.2, -.22, h + 28);
    K.cyl(0, -.27, 3.5, h, 22, '#4a4c52');
    K.box(-.3, .3, .3, .36, 2, 4, '#6e717a');
  },
  fab(K, d, h) {
    K.box(-.42, .42, -.36, .36, 0, h, d.color);
    for (const [a, b] of [[5, 7], [11, 13]]) { K.decalL(-.42, .42, .36, a, b, '#7ff3ff'); K.decalR(.42, -.36, .36, a, b, '#7ff3ff'); }
    for (const u of [-.3, -.05, .2]) K.box(u, u + .15, -.24, -.04, h, 5, '#d3c9ee');
    K.box(-.3, .3, .08, .3, h, 2, '#b9aee0');
  },
  police(K, d, h) {
    K.box(-.36, .36, -.3, .3, 0, h, d.color, { win: { gx: 9, gy: 8, top: 6 } });
    const z = Math.round(h * 0.55); K.decalL(-.36, .36, .3, z, z + 2, '#f4f6fa'); K.decalR(.36, -.3, .3, z, z + 2, '#f4f6fa');
    K.box(-.1, .12, -.06, .04, h, 3, '#e03030'); K.box(.12, .22, -.06, .04, h, 3, '#2f6cf0');
    K.line(.3, -.24, h, .3, -.24, h + 14, '#e8e8e8', 1);
    K.box(-.1, .12, .3, .42, 0, 7, '#dfe6f0');
  },
  fire(K, d, h) {
    K.box(-.36, .36, -.3, .3, 0, h, d.color, { win: { gx: 10, gy: 8, top: 10 } });
    K.box(.22, .36, -.28, -.14, h, 14, tint(d.color, -.1), { win: { gx: 8, top: 3 } });
    for (const u of [-.3, .06]) { K.decalL(u, u + .24, .3, 0, 11, '#e6e0d6'); K.decalL(u + .03, u + .21, .3, 0, 9, '#3b3f47'); }
    K.decalL(-.36, .36, .3, h - 3, h, '#f2f2f2');
  },
  hospital(K, d, h) {
    K.box(-.42, .06, -.34, .1, 0, h, '#f4f7fa', { win: { gx: 9, gy: 8, top: 4, lit: 'rgba(150,200,230,.9)' } });
    K.box(-.3, -.06, -.2, 0, h, 1.5, '#4b5560');
    K.line(-.24, -.2, h + 1.5, -.24, 0, h + 1.5, '#ffffff', 1.5); K.line(-.12, -.2, h + 1.5, -.12, 0, h + 1.5, '#ffffff', 1.5); K.line(-.24, -.1, h + 1.5, -.12, -.1, h + 1.5, '#ffffff', 1.5);
    K.box(-.06, .42, -.1, .34, 0, h - 6, '#eef2f6', { win: { gx: 9, gy: 8, top: 4, lit: 'rgba(150,200,230,.9)' } });
    K.decalL(.16, .2, .34, h - 25, h - 13, '#d83a3a'); K.decalL(.11, .25, .34, h - 21, h - 17, '#d83a3a');
  },
  park(K, d) {
    K.box(-.46, .46, -.46, .46, 0, 2, '#4aa65a', { top: '#5cbc6c' });
    K.flat([[-.46, .1], [-.2, .1], [.1, -.1], [.46, -.1], [.46, .02], [.1, .02], [-.2, .22], [-.46, .22]], 2.2, '#e8dcb8');
    K.ell(.18, .24, 2.4, 11, '#5fb4e6', '#3e8fc0');
    K.cyl(-.15, -.2, 5, 2, 4, '#c9ccd2', { top: '#7ec8f0' });
    K.tree(-.34, -.3, 2, 6); K.tree(.3, -.34, 2, 6.5);
    K.box(-.1, .1, .36, .4, 2, 3, '#8a5a3a');
    K.tree(-.38, .3, 2, 6); K.tree(.38, .1, 2, 5.5);
  },
  stadium(K, d, h) {
    // Modern oval stadium: white structural shell, colored seating bowl, green pitch and field markings.
    K.box(-.46,.46,-.43,.43,0,2,'#dce4e8',{top:'#f7fafb'});
    K.cyl(0,0,30,2,h,'#f4f6f7');
    K.ell(0,0,h,28,'#f8fbfc','#b6c4cc');
    K.ell(0,0,h-2,25,'#c7d4dd');
    K.ell(0,0,h-4,22,'#e8edf0');
    K.ell(0,0,h-5,19,'#d54e55');
    K.ell(0,0,h-7,16,'#f2f5f6');
    K.ell(0,0,h-9,13,'#286bb2');
    K.ell(0,0,h-11,10,'#3d9b52');
    // Pitch rectangle and precise white markings on the inner green field.
    K.flat([[-.24,-.16],[.24,-.16],[.24,.16],[-.24,.16]],h-10,'#31994b');
    K.line(-.24,-.16,h-9,.24,-.16,h-9,'#f8fff7',.8); K.line(-.24,.16,h-9,.24,.16,h-9,'#f8fff7',.8);
    K.line(-.24,-.16,h-9,-.24,.16,h-9,'#f8fff7',.8); K.line(.24,-.16,h-9,.24,.16,h-9,'#f8fff7',.8);
    K.ell(0,0,h-8,4,'rgba(255,255,255,0)','#f8fff7');
    K.box(-.25,-.18,-.035,.035,h-9,1,'#f8fff7'); K.box(.18,.25,-.035,.035,h-9,1,'#f8fff7');
    // Repeating roof ribs and corner floodlights make the silhouette less block-like.
    for(let i=0;i<7;i++) { const u=-.3+i*.1; K.line(u,-.35,h+1,u,-.35,h+5,'#ffffff',1.3); K.line(u,.35,h+1,u,.35,h+5,'#ffffff',1.3); }
    for (const [u,w] of [[-.38,-.36],[.38,-.36],[-.38,.36],[.38,.36]]) {
      K.line(u,w,0,u,w,h+12,'#b8c5cd',1.5); K.box(u-.035,u+.035,w-.035,w+.035,h+12,3,'#fff6c0');
    }
    // Glazed concourse bands and entrance canopy.
    K.ell(0,0,7,28,'rgba(83,166,196,.42)','#ffffff');
    K.box(-.13,.13,.38,.45,1,5,'#ffffff'); K.box(-.09,.09,.39,.45,2,'#49a4d2');
  },
  // ───────────── 新增建築 ─────────────
  townhouse(K, d, h) {
    const cols = [d.color, tint(d.color, 0.14), tint(d.color, -0.1)];
    for (let i = 0; i < 3; i++) {
      const u0 = -.4 + i * .27;
      K.box(u0, u0 + .25, -.28, .28, 0, h - 8, cols[i], { win: { gx: 7, gy: 7, top: 3, bot: 2 } });
      K.gable(u0 - .01, u0 + .26, -.3, .3, h - 8, 8, '#8a4b3a', 'w');
    }
  },
  condo(K, d, h) {
    K.box(-.34, .34, -.28, .28, 0, h, d.color, { win: { gx: 7, gy: 6 } });
    K.box(-.34, -.06, .28, .38, 0, h - 20, tint(d.color, .15), { win: { gx: 6, gy: 6 } });
    K.box(-.2, .2, -.2, .2, h, 5, '#cbd5e1'); K.cyl(.1, -.1, 4, h + 5, 6, '#6f8fa8');
  },
  market(K, d) {
    K.box(-.44, .44, -.38, .38, 0, 2, '#cdbf9a');
    const cols = [d.color, '#f4a261', '#e9c46a', '#2a9d8f'];
    [[-.3, -.26], [.06, -.26], [-.3, .08], [.06, .08]].forEach(([u, w], i) => {
      K.box(u, u + .24, w, w + .22, 2, 6, '#f4e9d8');
      K.gable(u - .02, u + .26, w - .02, w + .24, 8, 5, cols[i], 'u');
    });
  },
  office(K, d, h) {
    K.box(-.34, .34, -.3, .3, 0, h, d.color, { win: { gx: 6, gy: 5, ww: 4, wh: 3, top: 3, lit: 'rgba(190,230,230,.85)' } });
    K.box(-.2, .2, -.18, .18, h, 6, tint(d.color, .2)); K.box(-.08, .08, -.08, .08, h + 6, 8, '#c9d0da');
    K.line(0, 0, h + 14, 0, 0, h + 26, '#c9d0da', 1.2);
  },
  hotel(K, d, h) {
    K.box(-.36, .36, -.3, .3, 0, h, d.color, { win: { gx: 6, gy: 6, ww: 3, wh: 4, top: 8 } });
    K.box(-.3, .3, -.26, .26, h, 4, '#f6e7c1'); K.box(-.14, .14, -.06, .06, h + 4, 8, '#d62828');
    K.box(-.2, .3, .3, .46, 0, 8, '#f1e3c8'); K.decalL(-.12, .22, .46, 0, 6, '#3b2f2f');
  },
  theme_park(K, d, h) {
    K.box(-.46, .46, -.46, .46, 0, 2, '#6fbf73', { top: '#7fd184' });
    K.line(-.04, -.12, 2, 0, -.12, 24, '#8a929a', 2); K.line(.04, -.12, 2, 0, -.12, 24, '#8a929a', 2);
    const [x, y] = K.P(0, -.12, 24), g = K.g; K.up(24 + 22);                                  // 摩天輪
    g.strokeStyle = '#e9ecef'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 20, 0, 7); g.stroke();
    g.lineWidth = 1; for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t) * 20, y + Math.sin(t) * 20); g.stroke(); }
    const gond = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c'];
    for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3 + 0.5; g.fillStyle = gond[a]; g.beginPath(); g.arc(x + Math.cos(t) * 20, y + Math.sin(t) * 20, 3, 0, 7); g.fill(); }
    K.cone(-.3, .3, 9, 2, 12, d.color); K.cone(.3, .32, 8, 2, 10, '#ffd166');                 // 馬戲棚
  },
  farm(K, d) {
    K.box(-.46, .46, -.46, .46, 0, 1.5, '#8d6e47', { top: '#a9814f' });
    for (let i = 0; i < 5; i++) { const u0 = -.44 + i * .18; K.flat([[u0, 0], [u0 + .14, 0], [u0 + .14, .44], [u0, .44]], 1.7, i % 2 ? '#6a994e' : '#a7c957'); }
    K.box(-.42, -.1, -.42, -.1, 1.5, 9, '#b5382a'); K.gable(-.44, -.08, -.44, -.08, 10.5, 7, '#7a2a20', 'u');
    K.cyl(.22, -.3, 5, 1.5, 17, '#d8d8d0'); K.cone(.22, -.3, 5.4, 18.5, 5, '#9aa0a6');
  },
  warehouse(K, d, h) {
    K.box(-.44, .44, -.36, .36, 0, h, '#9aa5b1');
    for (let i = 0; i < 4; i++) K.decalL(-.4 + i * .2, -.26 + i * .2, .36, 0, 8, '#f4a261');
    for (let i = 0; i < 3; i++) K.decalR(.44, -.3 + i * .22, -.18 + i * .22, 0, 8, '#f4a261');
    K.box(-.44, .44, -.12, .12, h, 1.5, '#7b8794');
    K.box(.22, .44, .38, .5, 0, 5, '#e9ecef'); K.box(.2, .26, .38, .5, 0, 7, '#4a5568');
  },
  recycle(K, d, h) {
    K.box(-.42, .2, -.34, .3, 0, h, '#b7e4c7', { win: { gx: 10, gy: 8, top: 3 } });
    K.box(-.4, .18, -.3, .26, h, 2, d.color);
    K.decalL(-.3, -.06, .3, 4, h - 3, '#2d6a4f');
    K.box(.26, .42, -.3, -.12, 0, 5, '#6c757d'); K.box(.28, .44, -.06, .1, 0, 7, '#adb5bd'); K.box(.26, .4, .16, .3, 0, 5, '#8d99ae');
    K.line(.1, .1, h, .34, 0, 6, '#555a60', 2);
  },
  datacenter(K, d, h) {
    K.box(-.42, .4, -.34, .3, 0, h, '#2b2d42');
    for (const [a, b] of [[4, 6], [9, 11], [14, 16]]) { K.decalL(-.42, .4, .3, a, b, '#4cc9f0'); K.decalR(.4, -.34, .3, a, b, '#4cc9f0'); }
    for (const u of [-.3, -.05, .2]) K.cyl(u, -.05, 5, h, 4, '#8d99ae');
    K.box(.3, .44, .34, .46, 0, 6, '#adb5bd');
  },
  wind(K, d, h) {
    K.box(-.12, .12, -.12, .12, 0, 2, '#9aa0a6');
    K.cone(0, 0, 3.2, 2, h - 2, '#e9ecef');
    // The tower and nacelle are static; the rotor is drawn in the live game canvas.
    K.box(-.07, .07, -.08, .08, h - 1, 3, '#f8f9fa');
    K.rotor(0, 0, h, 17, 0.00145);
  },
  gas(K, d, h) {
    K.box(-.42, .1, -.34, .3, 0, h, '#adb5bd', { win: { gx: 12, gy: 9, top: 4, lit: 'rgba(255,200,120,.7)' } });
    K.cyl(-.15, -.24, 4, h, 26, '#6c757d', { bands: ['#6c757d', '#e9ecef'] }); K.smoke(-.15, -.24, h + 26);
    K.cyl(.3, -.2, 9, 0, 6, '#dee2e6'); K.dome(.3, -.2, 9, 6, '#e9ecef');
    K.cyl(.3, .22, 9, 0, 6, '#dee2e6'); K.dome(.3, .22, 9, 6, '#e9ecef');
    K.line(.1, 0, 3, .28, 0, 3, '#8896a0', 2);
  },
  well(K, d) {
    K.cyl(0, 0, 10, 0, 6, '#8d99ae', { top: '#4d96ff' });
    K.line(-.1, 0, 6, -.1, 0, 17, '#6b4a2f', 1.6); K.line(.1, 0, 6, .1, 0, 17, '#6b4a2f', 1.6);
    K.gable(-.16, .16, -.12, .12, 17, 5, '#9c4a3a', 'u');
  },
  reservoir(K, d) {
    K.box(-.46, .46, -.46, .46, 0, 2, '#7f8c8d', { top: '#95a5a6' });
    K.ell(-.02, -.06, 2.2, 29, '#1b6fb3'); K.ell(-.02, -.06, 2.5, 24, '#2a9df4'); K.ell(-.1, -.1, 2.7, 10, 'rgba(255,255,255,.18)');
    K.box(-.46, .46, .34, .46, 2, 6, '#cfd2d6');
    K.box(.3, .44, -.44, -.3, 2, 9, '#dee2e6', { win: { gx: 6, top: 2, bot: 1 } });
    K.tree(-.38, -.38, 2, 5);
  },
  fusion(K, d, h) {
    K.box(-.42, .42, -.36, .36, 0, 10, '#495057', { win: { gx: 12, gy: 9, top: 3, lit: 'rgba(120,200,255,.8)' } });
    K.cyl(0, -.02, 18, 10, 14, d.color, { top: '#c77dff' });
    K.dome(0, -.02, 16, 24, '#b5179e');
    K.ell(0, -.02, 28, 23, 'rgba(255,255,255,0)', '#f0abfc');
    K.dot(0, -.02, h, 3.5, '#ffffff');
  },
  clinic(K, d, h) {
    K.box(-.34, .34, -.28, .28, 0, h, '#f1faee', { win: { gx: 9, top: 3, lit: 'rgba(150,200,230,.9)' } });
    K.gable(-.36, .36, -.3, .3, h, 6, '#2a9d8f', 'u');
    K.decalL(0, .06, .28, 3, 11, '#e63946'); K.decalL(-.04, .1, .28, 5, 9, '#e63946');
  },
  school(K, d, h) {
    K.box(-.42, .42, -.36, -.12, 0, h, d.color, { win: { gx: 9, gy: 8, top: 3 } });
    K.box(-.08, .08, -.36, -.22, h, 10, '#f4a261'); K.gable(-.1, .1, -.38, -.2, h + 10, 6, '#9c4a3a', 'u');
    K.dot(0, -.22, h + 6, 2.6, '#ffffff');
    K.box(-.42, -.2, -.12, .3, 0, h, d.color, { win: { gx: 9, gy: 8, top: 3 } });
    K.box(.2, .42, -.12, .3, 0, h, d.color, { win: { gx: 9, gy: 8, top: 3 } });
    K.tree(0, .3, 0, 6);
  },
  university(K, d, h) {
    K.box(-.44, .44, -.32, .3, 0, h, '#d9d4c7', { win: { gx: 9, gy: 8, top: 4 } });
    K.cyl(0, -.02, 10, h, 6, '#e9ecef'); K.dome(0, -.02, 10, h + 6, d.color);
    K.box(-.22, .22, .3, .42, 0, h - 8, '#f1ece0');
    for (const u of [-.18, -.06, .06, .18]) K.line(u, .4, 0, u, .4, h - 9, '#ffffff', 2);
    K.tree(-.38, .42, 0, 5); K.tree(.38, .42, 0, 5);
  },
  townhall(K, d, h) {
    K.box(-.4, .4, -.3, .3, 0, 16, d.color, { win: { gx: 8, top: 4 } });
    K.gable(-.42, .42, -.32, .32, 16, 6, '#9c6644', 'u');
    K.box(-.1, .1, -.1, .1, 22, h - 14, d.color);
    K.gable(-.13, .13, -.13, .13, h + 8, 7, '#9c6644', 'u');
    K.dot(0, .1, h + 2, 3.2, '#ffffff'); K.dot(0, .1, h + 2, 1.2, '#333333');
    K.line(0, 0, h + 15, 0, 0, h + 26, '#dddddd', 1);
    K.decalL(-.08, .08, .3, 0, 8, '#6b4a2f');
  },
  airport(K, d, h) {
    K.box(-.46, .46, -.46, .46, 0, 1.5, '#6c757d', { top: '#868e96' });
    K.flat([[-.46, .08], [.46, .08], [.46, .22], [-.46, .22]], 1.7, '#495057');
    for (let i = 0; i < 5; i++) K.flat([[-.42 + i * .18, .14], [-.32 + i * .18, .14], [-.32 + i * .18, .16], [-.42 + i * .18, .16]], 1.9, '#f8f9fa');
    K.box(-.4, .1, -.4, -.1, 1.5, h - 1.5, '#ced4da', { win: { gx: 8, gy: 6, top: 3, lit: 'rgba(150,200,240,.9)' } });
    K.box(.26, .36, -.4, -.3, 1.5, 12, '#adb5bd'); K.box(.22, .4, -.44, -.26, 13.5, 5, '#74c0fc');
    K.line(.08, .15, 5, .34, .15, 5, '#ffffff', 3); K.line(.2, .06, 5, .2, .24, 5, '#ffffff', 2);
  },
  beach_resort(K, d, h) {
    K.box(-.42,.42,-.34,.34,0,12,'#f5e6cc',{win:{gx:7,gy:6,ww:3,wh:3,lit:'rgba(255,225,150,.95)'}});
    K.box(-.34,.34,-.28,.28,12,8,'#e9c46a'); K.flat([[-.42,-.38],[.42,-.38],[.42,-.28],[-.42,-.28]],22,'#2a9d8f');
    K.gable(-.4,.4,-.32,.32,20,7,'#e76f51','u');
    for (const [u,w] of [[-.42,.34],[.42,.3]]) { K.line(u,w,0,u,w,15,'#7a4e2d',2); K.cone(u,w,7,10,9,'#4f9d69'); }
    K.ell(-.2,.35,1,4,'#ffafcc'); K.ell(.18,.34,1,4,'#f4a261');
  },
  aquarium(K, d, h) {
    K.box(-.43,.43,-.34,.34,0,6,'#b7e4f9');
    K.box(-.4,.4,-.32,.32,6,18,'#168aad',{win:{gx:8,gy:7,ww:5,wh:5,lit:'rgba(128,224,255,.9)'}});
    K.box(-.45,.45,-.36,.36,24,4,'#caf0f8');
    for (const [u,w,z,col] of [[-.2,-.1,13,'#ffd166'],[.12,-.15,17,'#ff8fa3'],[.2,.12,11,'#f1fa8c']]) { K.ell(u,w,z,4,col,'#ffffff'); K.dot(u+.05,w,z+1,1,'#264653'); }
  },
  museum(K, d, h) {
    K.box(-.44,.44,-.34,.34,0,6,'#c8b99a'); K.gable(-.46,.46,-.36,.36,6,8,'#8b7355','u');
    for (const u of [-.32,-.16,0,.16,.32]) { K.cyl(u,.27,2.2,6,12,'#f2e9dc'); }
    K.box(-.12,.12,.28,.38,0,15,'#997b66'); K.dot(0,.34,18,2,'#d4a373');
  },
  medical_campus(K, d, h) {
    K.box(-.44,.08,-.34,.3,0,30,'#edf6f9',{win:{gx:8,gy:7,lit:'rgba(140,215,255,.85)'}});
    K.box(.1,.42,-.28,.3,0,20,'#dbe7ee',{win:{gx:7,gy:7,lit:'rgba(140,215,255,.85)'}});
    K.box(-.1,.12,-.02,.16,30,6,'#ffffff'); K.box(-.045,.065,-.08,.22,30,6,'#e63946'); K.box(-.18,.18,-.02,.16,32,2,'#ffffff');
    K.tree(-.38,.38,0,5); K.tree(.38,.38,0,5);
  },
  research_center(K, d, h) {
    K.box(-.42,.04,-.34,.28,0,26,'#d8f3fa',{win:{gx:7,gy:7,lit:'rgba(130,230,255,.9)'}});
    K.box(.08,.42,-.24,.3,0,18,'#90e0ef',{win:{gx:7,gy:6,lit:'rgba(255,255,255,.8)'}});
    K.cyl(-.18,-.08,7,26,8,'#f1faee'); K.dome(-.18,-.08,7,34,'#48cae4');
    K.line(.28,-.12,18,.28,-.12,32,'#3a506b',1.5); K.line(.2,-.12,29,.36,-.12,29,'#3a506b',1.5);
  },
  wind_farm(K, d, h) {
    K.flat([[-.45,-.42],[.45,-.42],[.45,.42],[-.45,.42]],0,'#b9d8c2');
    for (const [u,w,z] of [[-.26,-.14,22],[.2,-.2,28],[.08,.24,18]]) {
      K.line(u,w,0,u,w,z,'#edf6f9',2.2);
      K.box(u - .035, u + .035, w - .035, w + .035, z - 1, 2, '#6c8795');
      K.rotor(u, w, z, 7.5, 0.00105 + (Math.abs(u + w) % 0.04) * 0.008);
    }
  },
  robot_factory(K, d, h) {
    K.box(-.42,.12,-.32,.28,0,20,'#8d99ae',{win:{gx:8,gy:7,lit:'rgba(255,210,122,.9)'}});
    K.box(.16,.42,-.24,.28,0,13,'#adb5bd'); K.gable(-.44,.14,-.34,.3,20,5,'#495057','u');
    K.cyl(.28,-.16,4,13,18,'#495057'); K.smoke(.28,-.16,33);
    K.box(-.14,.06,.29,.4,0,12,'#e9ecef'); K.dot(-.04,.35,8,2.4,'#e63946');
  },
  quantum_lab(K, d, h) {
    K.box(-.4,.4,-.3,.3,0,28,'#47366f',{win:{gx:7,gy:6,lit:'rgba(192,132,252,.95)'}});
    K.cyl(0,-.02,12,28,8,'#9d4edd'); K.ell(0,-.02,37,13,'rgba(0,0,0,0)','rgba(128,255,234,.95)');
    K.ell(0,-.02,39,9,'rgba(0,0,0,0)','rgba(255,255,255,.9)'); K.dot(0,-.02,40,3,'#80ffdb');
    K.line(-.28,.24,28,.28,.24,28,'#c77dff',1.5);
  },
  orbital_port(K, d, h) {
    K.flat([[-.46,-.44],[.46,-.44],[.46,.44],[-.46,.44]],0,'#adb5bd');
    K.box(-.38,.12,-.3,.3,0,18,'#dbe7f0',{win:{gx:8,gy:6,lit:'rgba(120,210,255,.9)'}});
    K.cyl(.25,-.12,7,0,30,'#e9ecef'); K.cone(.25,-.12,7,30,12,'#f8f9fa');
    K.box(.12,.36,-.32,-.22,5,4,'#e63946'); K.line(.25,-.12,3,.25,-.12,35,'#e9ecef',1.5);
    K.ell(.25,-.12,44,8,'rgba(0,0,0,0)','rgba(144,202,249,.9)');
  },
  sky_garden(K, d, h) {
    K.box(-.32,.32,-.28,.28,0,h,d.color,{win:{gx:7,gy:7,lit:'rgba(255,255,255,.85)'}});
    for (let z=8;z<h;z+=12) { K.flat([[-.36,-.31],[.36,-.31],[.36,-.25],[-.36,-.25]],z,'#52b788'); K.flat([[-.34,.26],[.34,.26],[.34,.31],[-.34,.31]],z+2,'#95d5b2'); }
    K.tree(-.38,.32,0,5); K.tree(.38,.3,0,5);
  },
  fountain(K, d, h) {
    K.box(-.43,.43,-.43,.43,0,2,'#d9e2ec'); K.cyl(0,0,13,2,2,'#4895ef'); K.ell(0,0,4,12,'#48cae4','#e0fbfc');
    K.line(0,0,4,0,0,15,'#caf0f8',2); K.dot(0,0,16,2,'#caf0f8');
  },
  flower_plaza(K, d, h) {
    K.flat([[-.46,-.44],[.44,-.44],[.46,.42],[-.44,.44]],0,'#d9ed92');
    for (const [u,w,col] of [[-.27,-.2,'#ef476f'],[.25,-.22,'#ffd166'],[-.24,.22,'#9b5de5'],[.25,.2,'#f15bb5'],[0,0,'#ffffff']]) {
      K.ell(u,w,1,7,col); K.dot(u,w,2,1.8,'#ffd166');
    }
    K.flat([[-.05,-.42],[.05,-.42],[.05,.42],[-.05,.42]],.5,'#f6f0e8');
  },
  sculpture(K, d, h) {
    K.box(-.4,.4,-.4,.4,0,3,'#c8cdd2'); K.box(-.25,.25,-.25,.25,3,3,'#9ca3af');
    K.cyl(0,0,7,6,8,'#b0b7c3'); K.ell(0,0,16,8,'#adb5bd','#f8f9fa');
    K.line(-.18,0,10,.18,0,22,'#e9ecef',2); K.line(.18,0,10,-.18,0,22,'#e9ecef',2);
  },
  tree_grove(K, d, h) {
    K.flat([[-.45,-.43],[.45,-.43],[.45,.43],[-.45,.43]],0,'#7cb77b');
    for (const [u,w,r] of [[-.25,-.25,7],[.22,-.24,8],[-.2,.22,8],[.25,.2,7],[0,0,9]]) K.tree(u,w,0,r);
  },
  lantern_park(K, d, h) {
    K.flat([[-.45,-.42],[.45,-.42],[.45,.42],[-.45,.42]],0,'#9db4a0');
    for (const [u,w] of [[-.28,-.18],[.26,-.2],[-.24,.22],[.27,.21]]) { K.line(u,w,0,u,w,12,'#343a40',1.8); K.box(u-.055,u+.055,w-.055,w+.055,12,3,'#ffd166'); K.dot(u,w,14,3,'#ffe8a1'); }
  },
  clock_tower(K, d, h) {
    K.box(-.2,.2,-.18,.18,0,h-7,'#c9ada7'); K.box(-.28,.28,-.25,.25,h-7,3,'#9b7d73');
    K.gable(-.25,.25,-.22,.22,h-4,5,'#6d6875','u'); K.ell(0,-.19,h-15,4,'#f8f9fa','#495057');
    K.line(0,-.19,h-15,0,-.19,h-12,'#495057',1); K.line(0,-.19,h-15,2,-.19,h-15,'#495057',1);
  },
  monument(K, d, h) {
    K.box(-.44, .44, -.44, .44, 0, 3, '#adb5bd'); K.box(-.34, .34, -.34, .34, 3, 3, '#ced4da'); K.box(-.24, .24, -.24, .24, 6, 4, '#e9ecef');
    K.box(-.1, .1, -.1, .1, 10, h - 24, '#f1f3f5'); K.cone(0, 0, 7, h - 14, 12, d.color);
    K.dot(0, 0, h + 1, 3, '#fff3b0');
    K.tree(-.38, .38, 3, 5); K.tree(.38, .38, 3, 5);
  },
  lumber(K, d, h) {
    K.box(-.4, .05, -.32, .26, 0, 10, '#a67c52', { win: { gx: 9, top: 3, bot: 2 } });
    K.gable(-.44, .09, -.36, .3, 10, 7, '#6b4226', 'u');
    for (let i = 0; i < 3; i++) K.cyl(.28, -.3 + i * .22, 4, 0, 14 - i * 2, '#8b5a2b', { top: '#d7b98a' });
    K.box(.16, .44, .34, .46, 0, 3, '#b08968');
    K.tree(-.38, -.38, 0, 6);
  },
  mine(K, d, h) {
    K.box(-.4, .1, -.34, .3, 0, 12, '#7b7f87', { win: { gx: 12, top: 4, lit: 'rgba(255,190,90,.75)' } });
    K.decalL(-.28, -.02, .3, 0, 8, '#1f2328');
    K.line(.14, -.1, 0, .14, -.1, h + 6, '#4a4f56', 2); K.line(.34, -.1, 0, .34, -.1, h + 6, '#4a4f56', 2);
    K.line(.14, -.1, h + 6, .34, -.1, h + 6, '#4a4f56', 2); K.dot(.24, -.1, h + 6, 4, '#c9d0da');
    K.cone(.3, .24, 10, 0, 8, '#3c3f45');
  },
  harbor(K, d, h) {
    K.box(-.46, .46, -.46, .46, 0, 2, '#9aa0a6');
    K.box(-.4, .1, -.34, -.04, 2, 14, '#dfe3e8', { win: { gx: 9, gy: 8, top: 3 } });
    for (const [u, w, c] of [[.18, -.38, '#e63946'], [.18, -.18, '#2a9d8f'], [.3, -.28, '#f4a261']]) K.box(u, u + .14, w, w + .16, 2, 8, c);
    K.line(-.1, .3, 2, -.1, .3, h, '#f4a261', 2.5); K.line(-.1, .3, h, .42, .3, h, '#f4a261', 2.5);
    K.line(.3, .3, h, .3, .3, h - 8, '#444444', 1); K.box(.27, .33, .27, .33, h - 12, 4, '#e63946');
  },
};

// Fallback architecture styles keep newly added buildings visually distinct even without bespoke sprite art.

// Named, purpose-built silhouettes for every building in the expanded catalog.
// These are individual building drawings, not a category-wide coloured box.
const SIGNATURE_SHAPES = {
  tram_depot(K,d,h) {
    const H=Math.max(8,h*.56);
    K.box(-.43,.43,-.31,.30,0,H,'#d7dfdc',{win:{gx:8,gy:7,ww:3,wh:4}});
    K.gable(-.46,.46,-.35,.34,H,Math.max(4,h*.2),'#82949b','u');
    K.box(-.45,.45,-.37,.36,H+2,1.6,'#657780');
    for(const u of [-.30,-.10,.10,.30]) { K.line(u,-.37,1,u,-.37,H,'#455760',1.4); K.box(u-.035,u+.035,-.38,-.32,1,Math.max(3,H*.34),'#3f6d79'); }
    K.box(-.14,.14,.30,.38,1,H*.36,'#5f9eaa');
  },
  ferry_terminal(K,d,h) {
    K.flat([[-.48,-.42],[.44,-.42],[.48,.42],[-.46,.44]],0,'#9db8bd');
    K.box(-.39,.11,-.30,.18,0,Math.max(7,h*.60),'#edf0ec',{win:{gx:5.7,gy:5.5,ww:4,wh:4,lit:'rgba(176,230,239,.96)'}});
    K.box(-.42,.15,-.33,.21,Math.max(7,h*.60),2.2,d.color);
    K.flat([[.08,-.22],[.46,-.24],[.45,.42],[.08,.42]],1,'#927d65');
    K.poly([K.P(.10,.08,2),K.P(.42,.08,2),K.P(.37,.29,2),K.P(.15,.29,2)],'#f0f1ec',true);
    K.box(.17,.34,.07,.24,2,Math.max(3,h*.20),'#e7eeee',{win:{gx:5,gy:5,ww:3,wh:2}});
    K.line(.27,.15,Math.max(5,h*.20)+2,.27,.15,Math.max(5,h*.20)+7,'#7b8f96',1.1);
    K.line(-.4,.30,1,.4,.30,1,'#f4e3bd',1.3);
  },
  bicycle_hub(K,d,h) {
    K.flat([[-.45,-.4],[.45,-.4],[.45,.41],[-.45,.41]],0,'#c4ceca');
    K.box(-.31,.30,-.23,.20,0,Math.max(4,h*.34),'#e7e7db',{win:{gx:7,gy:6,ww:4,wh:3}});
    K.flat([[-.36,-.29],[.37,-.29],[.37,-.22],[-.36,-.22]],Math.max(4,h*.34)+1,'#5b8d89');
    for(const u of [-.32,-.16,0,.16,.32]) {
      K.ell(u-.04,.04,1,2.6,'#3c5057','#dce5e0'); K.ell(u+.045,.04,1,2.6,'#3c5057','#dce5e0');
      K.line(u-.04,.04,1,u,.07,3,'#e2ebe5',.8); K.line(u+.045,.04,1,u,.07,3,'#e2ebe5',.8);
    }
    K.box(-.10,.14,.22,.30,1,Math.max(4,h*.22),d.color);
    K.dot(.02,.26,Math.max(5,h*.30),1.6,'#f2d27b');
  },
  taxi_depot(K,d,h) {
    K.box(-.38,.35,-.30,.29,0,Math.max(6,h*.43),'#dbe1df',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.flat([[-.46,-.36],[.42,-.36],[.42,.36],[-.46,.36]],1,'#b7c0bd');
    K.box(-.12,.24,-.36,-.29,Math.max(5,h*.43),2.2,'#e2b943');
    for(const u of [-.32,-.04,.24]) {
      K.flat([[u-.075,.02],[u+.075,.02],[u+.085,.19],[u-.09,.19]],1,'#d8b33f');
      K.box(u-.075,u+.075,.02,.19,1,3,'#f0c64d');
      K.box(u-.048,u+.048,.04,.17,4,1.2,'#b7d5df');
      K.ell(u-.05,.05,1,1.8,'#353e42'); K.ell(u+.05,.05,1,1.8,'#353e42');
    }
    K.line(-.31,-.28,2,.30,-.28,2,'#faf0d4',1);
  },
  parking_garage(K,d,h) {
    const floors=Math.max(3,Math.min(5,Math.round(h/5)));
    K.box(-.43,.43,-.33,.33,0,h,'#8f9da4');
    for(let z=4;z<h;z+=h/floors) {
      K.flat([[-.44,-.34],[.44,-.34],[.44,.34],[-.44,.34]],z,'#e1e5e2');
      K.line(-.42,.34,z,.42,.34,z,'#4c626e',1.4);
      for(const u of [-.30,-.08,.15]) {
        K.box(u-.07,u+.07,.26,.32,z+1,1.6,['#cda84d','#7ca0ae','#8599a1'][(Math.floor(z+u*7)+8)%3]);
        K.box(u-.04,u+.04,.26,.32,z+2.6,1,'#34434b');
      }
      for(const u of [-.39,.39]) K.box(u-.02,u+.02,.31,.35,z,Math.max(3,h/floors),'#697c85');
    }
    K.box(-.44,.44,-.35,.35,h,1.8,'#6e828b');
    K.box(-.1,.1,.32,.38,1,Math.max(4,h*.38),'#e8bf51');
  },
  park_and_ride(K,d,h) {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#c3cdca');
    for(let i=0;i<4;i++) {
      const u=-.39+i*.22;
      K.flat([[u,-.36],[u+.16,-.36],[u+.16,.20],[u,.20]],.4,'#e1e3dc');
      K.box(u+.015,u+.14,-.18,.03,.4,3,['#d5b34a','#6b92a5','#91a9a8','#c58c70'][i]);
      K.box(u+.03,u+.12,-.14,-.01,3.4,1.5,'#bad3db');
    }
    K.box(-.38,.38,.22,.40,0,Math.max(5,h*.44),'#dfe4df',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.41,.41,.20,.42,Math.max(5,h*.44),2,d.color);
    K.box(-.07,.07,.39,.45,1,Math.max(3,h*.28),'#f4f1e5');
  },
  monorail_station(K,d,h) {
    const deck=Math.max(5,h*.34);
    K.box(-.48,.48,-.19,.19,deck,3.4,'#6b8290');
    for(const u of [-.36,.36]) K.box(u-.035,u+.035,-.12,.12,0,deck,'#9dabb3');
    K.box(-.38,.38,-.30,.30,deck+3,Math.max(5,h*.38),'#cfe2e5',{win:{gx:5,gy:5,ww:4,wh:3,lit:'rgba(185,231,241,.98)'}});
    K.box(-.43,.43,-.34,.34,deck+3+Math.max(5,h*.38),2,d.color);
    K.flat([[-.42,-.35],[.42,-.35],[.42,.35],[-.42,.35]],deck+6+Math.max(5,h*.38),'#eff3ed');
    K.line(-.49,-.18,deck,.49,-.18,deck,'#e8c85f',1.2);
    K.line(-.49,.18,deck,.49,.18,deck,'#e8c85f',1.2);
  },
  metro_hub(K,d,h) {
    K.flat([[-.45,-.4],[.45,-.4],[.45,.4],[-.45,.4]],0,'#b9c5c7');
    K.box(-.39,.39,-.29,.29,0,Math.max(4,h*.20),'#71858d');
    K.flat([[-.34,.26],[.34,.26],[.26,-.17],[-.26,-.17]],Math.max(4,h*.20)+1,'#9fbfc9');
    K.box(-.30,.30,-.21,.21,Math.max(4,h*.20)+1,2.4,'#edf1ee');
    K.box(-.24,.24,-.16,.16,Math.max(4,h*.20)+3.4,Math.max(3,h*.22),'#a8d0dc',{win:{gx:5,gy:4,ww:4,wh:2}});
    K.line(-.29,.28,Math.max(4,h*.20)+1,.29,.28,Math.max(4,h*.20)+1,'#f1cf70',1.1);
    K.box(-.12,.12,.28,.37,0,Math.max(3,h*.38),'#4c6674');
    K.box(-.09,.09,.31,.34,1,Math.max(3,h*.29),'#e7eee9');
  },
  train_station(K,d,h) {
    const body=Math.max(7,h*.40);
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#c2cac7');
    K.box(-.43,.43,-.29,.28,0,body,'#e0e2db',{win:{gx:6,gy:6,ww:4,wh:4,lit:'rgba(177,224,235,.96)'}});
    K.box(-.45,.45,-.32,.31,body,2.4,d.color);
    K.gable(-.48,.48,-.35,.35,body+2.4,Math.max(4,h*.22),'#637f8d','u');
    for(const u of [-.34,-.12,.12,.34]) K.line(u,.30,1,u,.30,body-1,'#f1efe2',1.1);
    K.dot(0,.325,body*.72,3.3,'#f3ce78');
    for(const u of [-.36,0,.36]) K.line(u,-.42,0,u,.42,0,'#718087',1.2);
  },
  cargo_terminal(K,d,h) {
    K.flat([[-.48,-.45],[.48,-.45],[.48,.45],[-.48,.45]],0,'#b8c4c4');
    K.box(-.44,.10,-.31,.23,0,Math.max(5,h*.37),'#cbd5d5');
    K.box(-.46,.12,-.33,.25,Math.max(5,h*.37),2.2,'#647a86');
    for(let row=0;row<2;row++) for(let j=0;j<3;j++) {
      const u=-.37+j*.19,w=-.20+row*.27;
      K.box(u,u+.16,w,w+.18,0,Math.max(3,h*.24),[['#c45e4e','#4d829c','#dcb352'],['#4c8b80','#d17e52','#697db1']][row][j]);
      K.line(u+.02,w+.18,1,u+.13,w+.18,1,'rgba(255,255,255,.6)',.7);
    }
    K.line(.18,-.28,1,.18,-.28,h*.75,'#e8bb56',2);
    K.line(.18,-.28,h*.75,.44,-.28,h*.75,'#e8bb56',2);
    K.line(.42,-.28,h*.75,.42,-.28,h*.55,'#495d66',1.4);
    K.box(.31,.46,-.32,-.14,0,Math.max(3,h*.24),'#dde3df');
  },
  city_airport_terminal(K,d,h) {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#b9c5c9');
    K.box(-.46,.45,-.27,.30,0,Math.max(6,h*.36),'#dce7e8',{win:{gx:4.5,gy:5,ww:4,wh:3,lit:'rgba(157,220,241,.98)'}});
    K.box(-.49,.48,-.30,.33,Math.max(6,h*.36),2.4,'#7199a8');
    K.flat([[-.35,-.34],[.33,-.34],[.42,-.04],[-.40,-.04]],Math.max(6,h*.36)+2.5,'#8fbac9');
    K.box(.27,.40,-.10,.06,0,Math.max(8,h*.82),'#dfe8e8',{win:{gx:4,gy:6,ww:2,wh:4}});
    K.box(.25,.42,-.12,.08,Math.max(8,h*.82),2,d.color);
    K.dot(.335,-.02,Math.max(8,h*.82)+3,2,'#e9c66c');
    K.poly([K.P(-.28,.16,1),K.P(-.02,.16,1),K.P(.10,.11,1),K.P(-.02,.21,1)],'#e9eeec',true);
    K.poly([K.P(-.18,.07,1),K.P(-.08,.07,1),K.P(-.04,.30,1),K.P(-.17,.26,1)],'#d0dce0',true);
  },
  transit_interchange(K,d,h) {
    K.box(-.44,-.07,-.30,.26,0,Math.max(7,h*.53),'#dce3e2',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(.07,.42,-.28,.27,0,Math.max(6,h*.42),'#b3cfd5',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(-.08,.08,-.06,.14,0,Math.max(4,h*.25),'#d5e2e1');
    K.flat([[-.12,.08],[.12,.08],[.12,-.12],[-.12,-.12]],Math.max(6,h*.42)+2,'#728a96');
    K.box(-.10,.10,-.13,.13,Math.max(6,h*.42)+2,Math.max(3,h*.20),'#dce8e6',{win:{gx:4,gy:5,ww:2,wh:2}});
    K.line(-.05,-.13,Math.max(6,h*.42)+2,.24,-.13,Math.max(6,h*.42)+2,'#efc961',1.2);
    K.box(-.46,.46,-.34,.34,Math.max(7,h*.53),2,d.color);
  },
  geothermal_plant(K,d,h) {
    K.box(-.43,.02,-.30,.28,0,Math.max(8,h*.60),'#d0d9d4',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.gable(-.45,.04,-.33,.31,Math.max(8,h*.60),Math.max(3,h*.17),'#81949a','u');
    for(const [u,w,r] of [[.20,-.24,6],[.34,-.08,4.4],[.18,.20,4.5]]) {
      K.cyl(u,w,r,0,Math.max(4,h*.42),'#a7bbb9',{top:'#e3e9e4'});
      K.ell(u,w,Math.max(4,h*.42),r,'#7b999c','#e2e8e1');
      K.line(u,w,Math.max(4,h*.42),u,w,Math.max(4,h*.42)+4,'#c7d8d5',1.2);
    }
    K.line(-.08,.18,3,.18,.18,3,'#9baeb0',2.4);
    K.line(.18,.18,3,.18,.18,Math.max(5,h*.42),'#9baeb0',2.4);
    K.smoke(.20,-.24,Math.max(4,h*.42)+4);
  },
  hydro_plant(K,d,h) {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#8db8ca');
    K.poly([K.P(-.48,-.28,3),K.P(.48,-.28,3),K.P(.34,.10,Math.max(5,h*.66)),K.P(-.36,.10,Math.max(5,h*.66))],'#89999b',true);
    K.box(-.30,.30,.06,.36,0,Math.max(5,h*.30),'#d5dede',{win:{gx:6,gy:5,ww:3,wh:3}});
    for(const u of [-.20,0,.20]) { K.cyl(u,.10,3,1,Math.max(4,h*.18),'#506c78'); K.ell(u,.10,Math.max(4,h*.18)+1,3,'#c2d4d7','#eef4ef'); }
    K.line(-.42,.22,1,.42,.22,1,'#e3ebe7',1.2);
  },
  battery_storage(K,d,h) {
    K.flat([[-.47,-.42],[.47,-.42],[.47,.42],[-.47,.42]],0,'#b7c5c7');
    for(let row=0;row<2;row++) for(let j=0;j<3;j++) {
      const u=-.36+j*.25,w=-.24+row*.42,H=Math.max(5,h*.56);
      K.box(u,u+.19,w,w+.17,0,H,'#94a8b0');
      K.box(u+.025,u+.165,w+.17,w+.19,H,1.8,'#5f7a85');
      K.box(u+.07,u+.115,w+.195,w+.22,H*.42,H*.14,'#e7d179');
      K.line(u+.09,w+.22,H*.58,u+.09,w+.22,H*.74,'#e7d179',1);
    }
    K.box(-.35,.35,-.32,-.25,Math.max(5,h*.56),3,'#637d88');
  },
  desalination_plant(K,d,h) {
    K.box(-.43,-.02,-.30,.23,0,Math.max(7,h*.46),'#d6e1e1',{win:{gx:8,gy:7,ww:3,wh:3,lit:'rgba(155,220,232,.96)'}});
    for(const [u,w,r] of [[.17,-.22,7],[.34,-.16,5],[.18,.20,6]]) {
      K.cyl(u,w,r,0,Math.max(4,h*.28),'#c4d7d9',{top:'#e5efec'});
      K.ell(u,w,Math.max(4,h*.28),r,'#75b6c1','#e6f0ed');
      K.ell(u,w,Math.max(4,h*.28)+.4,r*.56,'#d8f0ee');
    }
    K.line(-.08,.25,2,.31,.25,2,'#5b8f9f',2);
    K.line(.31,.25,2,.31,.25,Math.max(4,h*.52),'#5b8f9f',2);
    K.box(-.08,.08,.26,.32,Math.max(4,h*.52),3,'#5c9cab');
  },
  sewage_plant(K,d,h) {
    K.box(-.42,-.12,-.28,.24,0,Math.max(5,h*.32),'#b8c8c7',{win:{gx:8,gy:8,ww:3,wh:3}});
    for(const [u,w,r] of [[.14,-.20,9],[.36,.03,7],[.12,.25,6]]) {
      K.cyl(u,w,r,0,Math.max(2,h*.12),'#9aafb0',{top:'#6b9fa6'});
      K.ell(u,w,Math.max(2,h*.12)+.4,r,'#78b0b7','#e2ece9');
      K.ell(u,w,Math.max(2,h*.12)+.6,r*.63,'#b6d7d3');
      K.line(u-r*.7,w,Math.max(3,h*.12)+1,u+r*.7,w,Math.max(3,h*.12)+1,'#dce7e3',.75);
    }
    K.line(-.10,.3,1,.40,.3,1,'#8b9da1',2);
  },
  smart_grid_station(K,d,h) {
    K.box(-.39,.03,-.27,.27,0,Math.max(5,h*.36),'#d5e0e0',{win:{gx:6,gy:6,ww:3,wh:3,lit:'rgba(160,222,236,.94)'}});
    K.box(-.42,.06,-.30,.30,Math.max(5,h*.36),2,'#6f97a5');
    for(const u of [.15,.28,.41]) {
      K.line(u,-.26,1,u,-.26,Math.max(6,h*.80),'#80959d',1.5);
      K.line(u-.05,-.26,Math.max(6,h*.80)*.72,u+.05,-.26,Math.max(6,h*.80)*.72,'#80959d',1.2);
      K.dot(u,-.26,Math.max(6,h*.80),1.6,'#e3c76c');
    }
    K.line(.15,-.26,h*.58,.28,-.26,h*.58,'#c2d5d8',.8);
    K.line(.28,-.26,h*.58,.41,-.26,h*.58,'#c2d5d8',.8);
  },
  district_heating(K,d,h) {
    K.box(-.43,.04,-.30,.27,0,Math.max(7,h*.45),'#c6d2d0',{win:{gx:9,gy:8,ww:3,wh:3}});
    K.gable(-.45,.06,-.33,.30,Math.max(7,h*.45),Math.max(3,h*.14),'#8d9da1','u');
    for(const [u,w,r] of [[.18,-.20,4],[.35,-.20,4.5]]) {
      K.cyl(u,w,r,Math.max(4,h*.45),Math.max(6,h*.35),'#d0d9d8',{bands:['#bb6d51','#dce2de']});
      K.line(u,w,Math.max(4,h*.45)+Math.max(6,h*.35),u,w,Math.max(4,h*.45)+Math.max(6,h*.35)+3,'#dbe4e1',1);
    }
    K.line(-.10,.18,2,.35,.18,2,'#bc6b53',2.4);
    K.line(.35,.18,2,.35,.18,Math.max(4,h*.36),'#bc6b53',2.4);
  },
  hydrogen_plant(K,d,h) {
    K.box(-.42,-.12,-.27,.22,0,Math.max(6,h*.38),'#c3d9d6',{win:{gx:8,gy:6,ww:3,wh:3,lit:'rgba(161,230,230,.94)'}});
    for(const [u,w,r] of [[.12,-.2,6],[.30,-.22,5],[.26,.12,7]]) {
      K.cyl(u,w,r,0,Math.max(5,h*.46),'#d4e4e0',{top:'#74bdbb'});
      K.ell(u,w,Math.max(5,h*.46),r,'#e4f3ec','#8dc9c4');
      K.line(u,w,Math.max(5,h*.46),u,w,Math.max(5,h*.46)+2,'#e6f3ec',1);
    }
    K.line(-.10,.2,4,.25,.2,4,'#3f9da1',2);
    K.line(.25,.2,4,.25,.2,Math.max(5,h*.44),'#3f9da1',2);
    K.dot(.25,.2,Math.max(5,h*.44)+2,1.6,'#e1cb75');
  },
  waste_to_energy(K,d,h) {
    K.box(-.43,.10,-.30,.29,0,Math.max(6,h*.42),'#aebbb8',{win:{gx:9,gy:8,ww:3,wh:3,lit:'rgba(255,214,149,.9)'}});
    K.box(-.45,.12,-.33,.32,Math.max(6,h*.42),2,'#5c7078');
    K.cyl(.28,-.20,5,Math.max(6,h*.42),Math.max(7,h*.35),'#9aadb2',{bands:['#f0eee6','#c65e4e']});
    K.cyl(.39,.02,4,Math.max(6,h*.42),Math.max(5,h*.29),'#8e9fa4',{bands:['#f0eee6','#c65e4e']});
    K.box(-.30,-.06,.29,.34,2,Math.max(4,h*.20),'#e5b85f');
    K.smoke(.28,-.20,Math.max(6,h*.42)+Math.max(7,h*.35));
  },
  rooftop_solar_farm(K,d,h) {
    K.box(-.44,.44,-.35,.35,0,Math.max(5,h*.42),'#d3d9d5');
    K.box(-.46,.46,-.37,.37,Math.max(5,h*.42),2.1,'#8b9ca1');
    for(let row=0;row<3;row++) for(let j=0;j<4;j++) {
      const u=-.34+j*.22,w=-.25+row*.23,z=Math.max(5,h*.42)+2.3;
      K.poly([K.P(u,w,z+2),K.P(u+.16,w,z+2),K.P(u+.18,w+.12,z),K.P(u+.02,w+.12,z)],'#285784',true);
      K.line(u+.08,w,z+1,u+.10,w+.12,z,'rgba(209,233,247,.82)',.65);
      K.line(u,w+.06,z+1,u+.16,w+.06,z+1,'rgba(209,233,247,.62)',.65);
    }
    K.box(.31,.40,-.30,-.22,0,Math.max(3,h*.25),'#899ba0');
  },
  water_recycling_plant(K,d,h) {
    K.box(-.42,-.12,-.30,.18,0,Math.max(5,h*.34),'#d0dcdc',{win:{gx:7,gy:6,ww:3,wh:3}});
    for(const [u,w,r] of [[.13,-.20,7],[.34,-.13,6],[.22,.19,8]]) {
      K.cyl(u,w,r,0,Math.max(3,h*.20),'#b7d3d4',{top:'#75b2b8'});
      K.ell(u,w,Math.max(3,h*.20)+.5,r,'#67b4bf','#e2f0e8');
      K.ell(u,w,Math.max(3,h*.20)+1,r*.52,'#d6f0ec');
    }
    K.line(-.08,.27,2,.34,.27,2,'#5597a3',2.3);
    K.line(.34,.27,2,.34,.27,Math.max(4,h*.46),'#5597a3',2.3);
  },
  pumped_storage(K,d,h) {
    K.flat([[-.46,-.40],[.00,-.46],[.06,-.06],[-.42,.00]],1,'#83b9cc');
    K.flat([[.02,.02],[.46,.04],[.42,.44],[.00,.40]],1,'#83b9cc');
    K.box(-.32,.00,-.28,.02,0,Math.max(5,h*.30),'#7b8f96');
    K.box(.04,.34,-.08,.27,0,Math.max(7,h*.48),'#d3dddc',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.cyl(.36,.26,5,0,Math.max(5,h*.40),'#98acb1',{top:'#dfe9e4'});
    K.line(-.02,-.04,4,.15,.08,4,'#6b9ba9',2.6);
    K.line(.15,.08,4,.15,.08,Math.max(6,h*.66),'#6b9ba9',2.6);
    K.line(.15,.08,Math.max(6,h*.66),.38,.22,Math.max(6,h*.66),'#6b9ba9',2.6);
  },
  micro_reactor(K,d,h) {
    K.box(-.38,.08,-.28,.22,0,Math.max(6,h*.40),'#d8dfe0',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.dome(.25,-.08,12,Math.max(4,h*.28),'#dfe9eb');
    K.dome(.25,-.08,8,Math.max(4,h*.28),'#afc9d2');
    K.box(.16,.35,.07,.24,0,Math.max(4,h*.26),'#b7c6cb');
    K.box(.18,.33,.09,.22,Math.max(4,h*.26),2,'#d9e4e5');
    K.line(.08,.20,2,.28,.20,2,'#8ba5ae',1.3);
  },
  flood_control(K,d,h) {
    K.box(-.40,.04,-.28,.25,0,Math.max(5,h*.34),'#c5d3d5',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.cyl(.20,-.17,7,0,Math.max(4,h*.35),'#9fb4ba',{top:'#d5e6e4'});
    K.cyl(.36,.08,5,0,Math.max(4,h*.28),'#7898a4',{top:'#b7d3d7'});
    K.line(-.08,.24,2,.36,.24,2,'#4f899b',2.3);
    K.line(.36,.24,2,.36,.24,Math.max(5,h*.60),'#4f899b',2.3);
    K.box(-.38,-.23,.25,.31,1,Math.max(3,h*.22),'#d2e2df');
  },
  rain_harvesting(K,d,h) {
    K.box(-.40,-.08,-.27,.23,0,Math.max(5,h*.38),'#d5dfd9',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.gable(-.42,-.06,-.29,.25,Math.max(5,h*.38),Math.max(3,h*.13),'#749c9c','u');
    K.cyl(.15,-.18,8,0,Math.max(4,h*.42),'#91b5be',{top:'#cbe3e0'});
    K.cyl(.34,.10,6,0,Math.max(4,h*.32),'#739ca9',{top:'#c6e0e0'});
    K.line(-.05,.20,4,.15,.20,4,'#508c9b',2);
    K.line(.15,.20,4,.15,.20,Math.max(4,h*.40),'#508c9b',2);
  },
  marine_energy(K,d,h) {
    K.flat([[-.48,-.42],[.48,-.42],[.48,.44],[-.48,.44]],0,'#73a9bf');
    for(const [u,w] of [[-.28,-.16],[.06,-.05],[.33,.16]]) {
      K.cyl(u,w,4,1,Math.max(5,h*.42),'#718e9a',{top:'#c9d8d7'});
      K.line(u,w,Math.max(5,h*.42),u,w,Math.max(5,h*.42)+4,'#d9e7e3',1.2);
      K.rotor(u,w,Math.max(7,h*.70),7,.0012);
      K.ell(u,w,1,7,'rgba(224,247,248,.38)','rgba(242,252,250,.42)');
    }
  },
  food_factory(K,d,h) {
    K.box(-.43,.18,-.32,.28,0,Math.max(7,h*.52),'#d2b68b',{win:{gx:9,gy:8,ww:3,wh:3}});
    K.gable(-.45,.20,-.35,.31,Math.max(7,h*.52),Math.max(4,h*.19),'#947e66','u');
    K.cyl(.29,-.20,5,Math.max(4,h*.52),Math.max(4,h*.25),'#e1d9c8',{top:'#f1e9d5'});
    K.cyl(.36,.06,4,0,Math.max(4,h*.32),'#bfaf8c',{top:'#eee5ce'});
    for(const u of [-.30,-.08,.14]) K.box(u,u+.12,.28,.33,1,Math.max(3,h*.20),'#9db4b5');
  },
  biotech_lab(K,d,h) {
    K.box(-.38,.15,-.29,.24,0,Math.max(8,h*.58),'#c7d8df',{win:{gx:5,gy:6,ww:3,wh:4,lit:'rgba(175,226,239,.97)'}});
    K.box(-.02,.37,-.20,.31,0,Math.max(6,h*.42),'#e3e9e5',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(-.41,.18,-.32,.27,Math.max(8,h*.58),2.2,'#6c9ea8');
    K.cyl(.29,-.24,4,0,Math.max(5,h*.43),'#b9d6d8',{top:'#f2f6ef'});
    K.cyl(.32,.10,5,0,Math.max(4,h*.34),'#91bec5',{top:'#e3f1ed'});
    K.line(.08,.27,1,.40,.27,1,'#7fabb2',1.1);
  },
  ev_factory(K,d,h) {
    K.box(-.44,.23,-.31,.30,0,Math.max(7,h*.48),'#aabec5');
    K.gable(-.46,.25,-.34,.33,Math.max(7,h*.48),Math.max(3,h*.15),'#6c8793','u');
    K.box(-.42,.22,.30,.34,2,Math.max(4,h*.30),'#526b78');
    for(const u of [-.30,-.03,.24]) {
      K.box(u,u+.14,.33,.38,1,Math.max(3,h*.23),'#d9e3e1');
      K.box(u+.02,u+.12,.38,.40,2,Math.max(3,h*.18),'#b3d4dc');
      K.ell(u+.03,.38,1,1.8,'#2d414a'); K.ell(u+.12,.38,1,1.8,'#2d414a');
    }
    K.line(-.28,-.10,Math.max(7,h*.48)+4,.31,-.10,Math.max(7,h*.48)+4,'#cfab55',1.1);
  },
  chip_fab(K,d,h) {
    K.box(-.43,.23,-.31,.27,0,Math.max(7,h*.54),'#dfe8e7',{win:{gx:5,gy:6,ww:3,wh:3,lit:'rgba(176,226,244,.98)'}});
    K.box(-.45,.25,-.33,.29,Math.max(7,h*.54),2,'#7b9eae');
    K.box(-.26,.02,-.18,.12,Math.max(7,h*.54)+2,Math.max(3,h*.18),'#a7cbd8');
    K.box(.08,.30,-.23,.23,0,Math.max(5,h*.36),'#afc2c9');
    for(const u of [-.30,-.10,.10,.30]) K.line(u,.28,2,u,.28,Math.max(5,h*.36),'#e3eceb',.7);
    K.cyl(.34,-.21,4,Math.max(7,h*.54),Math.max(4,h*.22),'#91a7b1',{top:'#d5e0e1'});
  },
  robotics_warehouse(K,d,h) {
    K.box(-.44,.16,-.32,.30,0,Math.max(7,h*.47),'#b8c5c8');
    K.gable(-.46,.18,-.35,.33,Math.max(7,h*.47),Math.max(4,h*.16),'#718994','u');
    for(const u of [-.33,-.13,.07]) K.box(u,u+.15,.30,.35,1,Math.max(4,h*.28),['#dfad58','#548ba0','#8caaa3'][(Math.round(u*100)+40)%3]);
    K.line(.20,-.20,2,.20,-.20,Math.max(4,h*.45),'#e0b45c',2);
    K.line(.20,-.20,Math.max(4,h*.45),.37,-.10,Math.max(4,h*.45),'#e0b45c',2);
    K.line(.37,-.10,Math.max(4,h*.45),.37,-.10,Math.max(4,h*.32),'#4c5d65',1.3);
  },
  cold_storage(K,d,h) {
    K.box(-.43,.38,-.32,.31,0,Math.max(7,h*.46),'#e4edef');
    K.box(-.45,.40,-.34,.33,Math.max(7,h*.46),2,'#8fb3c4');
    for(const u of [-.30,-.10,.10,.30]) {
      K.box(u-.055,u+.055,-.35,-.31,Math.max(2,h*.12),Math.max(3,h*.25),'#a4bdc4');
      K.line(u-.05,-.36,Math.max(3,h*.25),u+.05,-.36,Math.max(3,h*.25),'#f2f6f2',.75);
    }
    K.cyl(.31,-.20,4,Math.max(7,h*.46),Math.max(4,h*.16),'#9cb5be');
    K.line(-.40,.28,3,.34,.28,3,'#718b97',1);
  },
  eco_factory(K,d,h) {
    K.box(-.43,.17,-.30,.28,0,Math.max(6,h*.48),'#b4cfc0',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.gable(-.45,.19,-.33,.31,Math.max(6,h*.48),Math.max(3,h*.15),'#6e9b82','u');
    K.box(-.39,.13,.28,.32,2,Math.max(4,h*.26),'#6ea989');
    for(let z=5;z<h*.42;z+=7) { K.flat([[-.38,.31],[.12,.31],[.12,.34],[-.38,.34]],z,'#83bb8a'); K.tree(-.30,.33,z,2); K.tree(.03,.33,z,2); }
    K.cyl(.31,-.20,4,0,Math.max(4,h*.32),'#c2dad0',{top:'#e7f0df'});
  },
  paper_mill(K,d,h) {
    K.box(-.44,.16,-.31,.30,0,Math.max(7,h*.46),'#d1c2aa');
    for(let i=0;i<3;i++) K.gable(-.44+i*.20,-.27+i*.20,-.34,.32,Math.max(7,h*.46),Math.max(3,h*.14),i%2?'#9a907d':'#b6a58d','u');
    K.cyl(.28,-.22,5,Math.max(4,h*.46),Math.max(4,h*.20),'#8f9c9c',{top:'#e0e3dc'});
    for(const u of [-.25,-.02,.21]) K.ell(u,.31,1,3.3,'#d1bda1','#8c8172');
    K.box(.27,.38,.12,.28,0,Math.max(4,h*.33),'#ad9f8b');
  },
  beverage_brewery(K,d,h) {
    K.box(-.43,.00,-.30,.26,0,Math.max(6,h*.43),'#b9c4b8',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.gable(-.45,.02,-.32,.28,Math.max(6,h*.43),Math.max(3,h*.13),'#847c58','u');
    for(const [u,w,r,hh] of [[.15,-.18,6,h*.42],[.34,-.15,5,h*.34],[.20,.17,7,h*.27]]) {
      K.cyl(u,w,r,0,Math.max(4,hh),'#b7a36c',{top:'#dfd3a1'}); K.line(u-r*.7,w,hh*.78,u+r*.7,w,hh*.78,'#e9ddb8',.9);
    }
    K.box(-.35,-.14,.26,.31,2,Math.max(3,h*.18),'#765740');
    K.dot(-.25,.31,Math.max(4,h*.24),1.6,'#f0d184');
  },
  textile_mill(K,d,h) {
    K.box(-.43,.26,-.31,.29,0,Math.max(6,h*.46),'#d0c5c6');
    K.gable(-.45,.28,-.34,.32,Math.max(6,h*.46),Math.max(3,h*.14),'#8d7d88','u');
    for(let i=0;i<4;i++) {
      const u=-.32+i*.19;
      K.cyl(u,.31,3.5,1,Math.max(4,h*.28),['#be879a','#8ba9c8','#d2af79','#9bb79c'][i],{top:'#e8dfdc'});
      K.line(u,.31,Math.max(4,h*.28)+1,u,.31,Math.max(4,h*.28)+4,'#f3e8e3',.8);
    }
    K.cyl(.34,-.18,4,Math.max(4,h*.46),Math.max(3,h*.17),'#978995');
  },
  shipyard(K,d,h) {
    K.flat([[-.48,-.42],[.48,-.42],[.48,.44],[-.48,.44]],0,'#7ca9b9');
    K.flat([[-.47,-.30],[.18,-.30],[.40,.38],[-.32,.38]],1,'#9faeaf');
    K.poly([K.P(-.35,-.12,2),K.P(.34,-.12,2),K.P(.27,.18,2),K.P(-.27,.18,2)],'#344e60',true);
    K.poly([K.P(-.24,-.12,3),K.P(.20,-.12,3),K.P(.12,.12,3),K.P(-.15,.12,3)],'#d6dfe0',true);
    K.box(.28,.34,-.27,.18,0,Math.max(7,h*.64),'#cc9a4d');
    K.line(.31,-.24,Math.max(7,h*.64),.31,-.24,Math.max(7,h*.64)+5,'#d5a555',1.5);
    K.line(.31,-.24,Math.max(7,h*.64)+5,.43,-.24,Math.max(7,h*.64)+5,'#d5a555',1.5);
    K.line(.41,-.24,Math.max(7,h*.64)+5,.41,-.24,Math.max(4,h*.35),'#526776',1.3);
  },
  aerospace_plant(K,d,h) {
    K.box(-.43,.30,-.32,.30,0,Math.max(7,h*.48),'#c9d3d9');
    K.gable(-.46,.33,-.35,.33,Math.max(7,h*.48),Math.max(5,h*.28),'#7d8d9c','u');
    K.box(-.37,.24,.30,.34,2,Math.max(4,h*.26),'#869aaa');
    K.poly([K.P(-.25,-.05,2),K.P(.18,-.05,2),K.P(.33,.02,2),K.P(.18,.08,2),K.P(-.25,.08,2)],'#edf0ea',true);
    K.poly([K.P(-.02,-.14,2),K.P(.07,-.14,2),K.P(.02,.12,2),K.P(-.08,.10,2)],'#d0d9df',true);
    K.cyl(.36,-.20,3.5,Math.max(7,h*.48),Math.max(4,h*.18),'#7f93a0',{top:'#dbe5e6'});
  },
  data_farm(K,d,h) {
    K.box(-.43,.42,-.33,.32,0,Math.max(7,h*.45),'#7d9cae');
    K.box(-.46,.45,-.36,.35,Math.max(7,h*.45),2,'#4c6d86');
    for(const u of [-.35,-.16,.03,.22]) {
      K.box(u,u+.12,-.31,-.23,2,Math.max(4,h*.34),'#a4b8c2');
      K.box(u+.02,u+.10,-.31,-.23,Math.max(4,h*.34),1,'#d5e2e5');
      K.line(u+.06,-.34,3,u+.06,-.34,Math.max(5,h*.39),'#55bdd1',.7);
    }
    K.cyl(.37,.12,4,Math.max(7,h*.45),Math.max(4,h*.16),'#8ba3af');
    K.ell(.37,.12,Math.max(7,h*.45)+Math.max(4,h*.16),4,'#d7e3e5','#8299a4');
  },
  research_park(K,d,h) {
    K.box(-.42,-.12,-.28,.20,0,Math.max(6,h*.41),'#c8dbd9',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.06,.30,-.25,.27,0,Math.max(8,h*.58),'#a9c7ca',{win:{gx:5,gy:5,ww:3,wh:3,lit:'rgba(186,232,235,.94)'}});
    K.box(.18,.42,.12,.32,0,Math.max(5,h*.37),'#d8e4df',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.flat([[-.17,.02],[.21,.02],[.21,-.07],[-.17,-.07]],Math.max(6,h*.41),'#7097a2');
    K.tree(-.34,.34,0,4); K.tree(.35,.34,0,4);
  },
  cargo_depot(K,d,h) {
    K.box(-.43,.26,-.31,.31,0,Math.max(6,h*.42),'#c0c9c7');
    K.gable(-.45,.28,-.34,.34,Math.max(6,h*.42),Math.max(3,h*.14),'#9b886e','u');
    for(const u of [-.33,-.14,.05]) {
      K.box(u,u+.15,.31,.37,1,Math.max(3,h*.25),'#657b85');
      K.box(u+.02,u+.13,.37,.40,2,Math.max(3,h*.21),'#e0e7e2');
    }
    K.box(.28,.43,-.18,.04,1,Math.max(4,h*.24),'#9bacae');
    K.poly([K.P(.24,.03,1),K.P(.43,.03,1),K.P(.40,.22,1),K.P(.27,.22,1)],'#5f8294',true);
    K.ell(.29,.20,1,2,'#33434b'); K.ell(.39,.20,1,2,'#33434b');
  },
  packaging_plant(K,d,h) {
    K.box(-.42,.22,-.31,.29,0,Math.max(6,h*.43),'#cbbda0');
    K.gable(-.44,.24,-.34,.32,Math.max(6,h*.43),Math.max(3,h*.14),'#9f9279','u');
    for(let i=0;i<3;i++) {
      const u=-.30+i*.20;
      K.box(u,u+.14,.30,.35,1,Math.max(3,h*.18),['#c49a5b','#b77b68','#8fae9b'][i]);
      K.line(u+.02,.35,Math.max(3,h*.18)+1,u+.12,.35,Math.max(3,h*.18)+1,'#f1e4ca',.7);
    }
    K.line(-.16,.17,3,.30,.17,3,'#d5a957',1.6);
    K.box(.23,.37,-.20,.05,0,Math.max(4,h*.26),'#d2c3a9');
  },
  cottage(K,d,h) {
    const H=Math.max(6,h*.54);
    K.box(-.34,.30,-.28,.28,0,H,'#e3d1ad',{win:{gx:10,gy:8,top:2,bot:2}});
    K.gable(-.39,.35,-.32,.32,H,Math.max(5,h*.40),'#a64d43','u');
    K.box(-.08,.10,.27,.42,0,H*.42,'#845e43');
    K.decalL(-.23,-.10,.281,2,Math.max(4,H*.46),'#8bc3d3');
    K.cyl(-.24,-.20,2.5,H+2,Math.max(3,h*.15),'#8b7565');
    K.tree(-.41,.34,0,5); K.tree(.38,-.32,0,4);
  },
  duplex(K,d,h) {
    const H=Math.max(7,h*.60);
    for(const [u,col,roof] of [[-.20,'#dfc7a3','#aa5e4f'],[.19,'#c8d3c9','#6d8790']]) {
      K.box(u-.20,u+.20,-.28,.28,0,H,col,{win:{gx:7,gy:7,top:2}});
      K.gable(u-.23,u+.23,-.32,.32,H,Math.max(4,h*.30),roof,'u');
      K.box(u-.045,u+.045,.28,.34,0,H*.56,'#8b6551');
      K.decalL(u-.14,u-.06,.282,H*.42,H*.65,'#88b7c5');
      K.decalR(u+.10,-.20,.02,H*.42,H*.65,'#8ab8c3');
    }
    K.box(-.04,.04,.30,.37,0,Math.max(3,H*.36),'#b39b7b');
    K.tree(-.40,.34,0,4); K.tree(.41,.34,0,4);
  },
  row_house(K,d,h) {
    const H=Math.max(8,h*.55), colors=['#d27e68','#d8bc88','#84a9ac','#c48b9f'];
    for(let i=0;i<4;i++) {
      const u=-.38+i*.20;
      K.box(u,u+.19,-.29,.28,0,H,colors[i],{win:{gx:6,gy:7,ww:3,wh:4}});
      K.gable(u-.02,u+.21,-.32,.31,H,Math.max(4,h*.29),i%2?'#777d89':'#a35d4d','u');
      K.box(u+.06,u+.12,.28,.34,0,H*.55,'#815b48');
      K.line(u+.01,.34,2,u+.17,.34,2,'#f7e7d5',.7);
    }
  },
  courtyard_homes(K,d,h) {
    K.box(-.43,-.19,-.31,.30,0,Math.max(6,h*.48),'#c9b18f',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(.19,.43,-.31,.30,0,Math.max(6,h*.48),'#c9b18f',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.19,.19,-.31,-.12,0,Math.max(5,h*.35),'#d7c4a3');
    K.box(-.43,.43,-.34,-.27,Math.max(6,h*.48),2,'#9f8d75');
    K.flat([[-.17,-.09],[.17,-.09],[.25,.20],[-.25,.20]],1,'#8db77a');
    K.flat([[-.06,-.20],[.06,-.20],[.06,.26],[-.06,.26]],1,'#e8dfca');
    K.tree(-.10,.03,1,4); K.tree(.13,.08,1,4);
  },
  eco_village(K,d,h) {
    const houses=[[-.25,-.20,.72],[-.05,.12,.9],[.27,-.03,.65]];
    for(let i=0;i<houses.length;i++) {
      const [u,w,sc]=houses[i], H=Math.max(4,h*.34*sc);
      K.box(u-.14,u+.14,w-.12,w+.12,0,H,['#d9d6b9','#c1d7c7','#d7c3a9'][i],{win:{gx:8,gy:7,ww:3,wh:3}});
      K.gable(u-.16,u+.16,w-.14,w+.14,H,Math.max(3,h*.20),'#629d72','u');
      K.box(u-.025,u+.025,w+.12,w+.16,0,H*.56,'#896a51');
      K.tree(u-.16,w+.12,0,3.8);
      K.flat([[u-.10,w-.10],[u+.09,w-.10],[u+.09,w-.06],[u-.10,w-.06]],H*.72,'#8dc995');
    }
    K.flat([[-.45,-.36],[.42,-.35],[.36,.36],[-.40,.38]],.5,'#c4d6b2');
  },
  suburban_villa(K,d,h) {
    const H=Math.max(7,h*.58);
    K.box(-.39,.08,-.31,.29,0,H,'#e5d1b4',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.gable(-.43,.11,-.35,.33,H,Math.max(5,h*.25),'#805849','u');
    K.box(.08,.36,-.20,.24,0,H*.72,'#d4c4a9',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(.05,.39,-.23,.27,H*.72,Math.max(4,h*.20),'#a05f50','w');
    K.box(-.12,.02,.29,.39,0,H*.45,'#a37c5c');
    K.box(-.28,-.20,-.34,-.28,H*.74,4,'#6e7e85');
    K.tree(-.43,.36,0,5); K.tree(.42,.34,0,5);
  },
  garden_apartment(K,d,h) {
    const H=Math.max(10,h*.68);
    K.box(-.39,-.02,-.29,.29,0,H,'#d0ded5',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(.05,.39,-.27,.29,0,H*.76,'#b5cec3',{win:{gx:6,gy:6,ww:3,wh:3}});
    for(let z=9;z<H;z+=12) {
      K.box(-.40,-.01,.27,.34,z,1.2,'#5ca87e');
      K.box(.04,.40,.27,.34,z*.76,1.2,'#5ca87e');
      K.tree(-.28,.30,z+1,2); K.tree(.27,.30,z*.76+1,2);
    }
    K.box(-.10,.12,-.34,-.28,H,2,'#82b796');
    K.dot(.03,0,H+4,2,'#dbe7d9');
  },
  tower_block(K,d,h) {
    const H=Math.min(100,h*1.04);
    K.box(-.37,.37,-.31,.31,0,H,'#adb9c3',{win:{gx:5.5,gy:6,ww:2.7,wh:3.4}});
    for(let z=11;z<H-2;z+=12) {
      K.box(-.40,.40,.30,.355,z,1,'#8195a0');
      K.line(-.39,.355,z+3,.39,.355,z+3,'#e2e9e9',.7);
      K.box(-.05,.17,.31,.39,z+1,4,'#7e969f');
      for(const u of [-.30,-.12,.10,.28]) K.line(u,.39,z+1,u,.39,z+4,'#dbe5e5',.5);
    }
    K.box(-.24,.24,-.20,.20,H,3,'#8b9ca8');
    K.box(-.16,.16,-.14,.14,H+3,2,'#bac6cb');
  },
  waterfront_condo(K,d,h) {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#86b9cc');
    K.box(-.36,.33,-.29,.29,0,Math.min(75,h*1.03),'#8ab7ca',{win:{gx:5,gy:6,ww:3,wh:3,lit:'rgba(208,236,246,.96)'}});
    for(let z=9;z<h;z+=10) {
      K.box(-.39,.36,.29,.36,z,1.1,'#7b9da9');
      K.line(-.34,.36,z+3,.34,.36,z+3,'#eef4f1',.7);
      K.line(-.31,.365,z,.31,.365,z,'#dfeaec',.55);
    }
    K.box(-.20,.19,-.20,.19,h,2.2,'#d8e5e7');
    K.tree(-.4,.34,0,3.8); K.tree(.40,.34,0,3.8);
  },
  student_dorm(K,d,h) {
    const H=Math.max(9,h*.66);
    K.box(-.43,-.10,-.28,.29,0,H,'#c6d5df',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.06,.37,-.18,.30,0,H*.82,'#94aabd',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.flat([[-.43,-.31],[.39,-.31],[.39,.31],[-.43,.31]],H, '#7c929f');
    K.box(-.10,.10,.30,.39,0,H*.38,'#dce6e4');
    K.tree(-.39,.35,0,4); K.tree(.38,.34,0,4);
    K.box(-.15,.15,-.12,.12,H,2,'#b9c6c7');
  },
  senior_residence(K,d,h) {
    const H=Math.max(6,h*.48);
    K.box(-.43,-.13,-.30,.26,0,H,'#e2d2bd',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.09,.43,-.30,.26,0,H,'#d0c4ae',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.12,.12,-.05,.23,0,H*.72,'#d9c8af',{win:{gx:6,gy:7,ww:3,wh:3}});
    K.gable(-.45,-.11,-.33,.29,H,Math.max(3,h*.12),'#8d8172','u');
    K.gable(.10,.45,-.33,.29,H,Math.max(3,h*.12),'#8d8172','u');
    K.flat([[-.11,-.02],[.11,-.02],[.20,.28],[-.20,.28]],1,'#91b981');
    K.tree(-.05,.14,1,3.5); K.tree(.10,.16,1,3.5);
  },
  co_living(K,d,h) {
    const H=Math.max(8,h*.63);
    K.box(-.39,.34,-.30,.28,0,H,'#bad4d0',{win:{gx:5.8,gy:6,ww:3,wh:3}});
    K.box(-.30,.23,-.33,.31,H,2,'#759ba1');
    for(let z=9;z<H;z+=11) {
      K.box(-.41,-.20,.27,.37,z,2,'#6e9e91');
      K.box(-.06,.15,-.31,-.25,z+2,1.4,'#85aca8');
      K.box(.19,.36,.27,.36,z,1.7,'#8fc6a2');
    }
    K.box(-.04,.16,.29,.40,0,H*.36,'#8da9a3');
    K.box(-.05,.17,-.15,.12,H,2,'#d8e7de');
  },
  public_housing(K,d,h) {
    const H=Math.max(9,h*.65);
    K.box(-.40,.40,-.30,.30,0,H,'#b0b8c1',{win:{gx:6,gy:6,ww:3,wh:3}});
    for(let z=8;z<H-1;z+=9) {
      K.box(-.41,.41,.30,.35,z,1.2,'#8796a1');
      for(const u of [-.29,-.05,.19]) {
        K.box(u-.055,u+.055,.34,.39,z+1,4,'#687f8c');
        K.line(u-.06,.39,z+4,u+.06,.39,z+4,'#e1e8e5',.7);
      }
    }
    K.box(-.12,.12,.30,.39,0,H*.36,'#c8d2d1');
    K.tree(-.43,.34,0,3.6); K.tree(.42,.34,0,3.6);
  },
  hillside_home(K,d,h) {
    K.flat([[-.48,-.38],[.45,-.40],[.48,.42],[-.45,.44]],0,'#9caa80');
    K.box(-.35,.12,-.28,.29,3,Math.max(6,h*.44),'#d5c3a4',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(-.39,.16,-.32,.33,3+Math.max(6,h*.44),Math.max(4,h*.25),'#7f6855','u');
    K.box(.12,.37,-.18,.23,0,Math.max(4,h*.28),'#b9a98d');
    K.gable(.09,.4,-.22,.27,Math.max(4,h*.28),Math.max(3,h*.15),'#9d6b54','w');
    K.flat([[-.46,.29],[.43,.29],[.36,.43],[-.39,.43]],2,'#b6a58b');
    K.tree(-.42,.31,0,4.5); K.tree(.41,-.31,0,4.5);
  },
  manor(K,d,h) {
    const H=Math.max(10,h*.62);
    K.box(-.41,.18,-.31,.29,0,H,'#e3d0ad',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(-.44,.21,-.34,.32,H,Math.max(5,h*.26),'#73564b','u');
    K.box(-.06,.32,-.21,.21,0,H*.77,'#d3bea0',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(-.09,.35,-.24,.24,H*.77,Math.max(4,h*.21),'#8a5e4b','w');
    K.box(-.02,.12,.29,.38,0,H*.43,'#9e7a5e');
    K.cyl(-.30,-.23,3,H,Math.max(4,h*.15),'#9b8c7d');
    K.cone(-.30,-.23,4,H+Math.max(4,h*.15),Math.max(4,h*.17),'#765e53');
    K.tree(-.44,.36,0,5); K.tree(.41,.34,0,5);
    K.flat([[-.12,.36],[.14,.36],[.14,.43],[-.12,.43]],1,'#cbbda5');
  },
  tiny_home(K,d,h) {
    K.box(-.29,.25,-.22,.23,0,Math.max(5,h*.55),'#d5d0bd',{win:{gx:9,gy:7,ww:3,wh:3}});
    K.gable(-.34,.30,-.26,.27,Math.max(5,h*.55),Math.max(3,h*.29),'#668f83','u');
    K.box(-.08,.02,.23,.28,0,Math.max(2,h*.30),'#8e7356');
    K.flat([[-.22,-.13],[.12,-.13],[.09,.04],[-.25,.04]],Math.max(5,h*.55)+2,'#2e5474');
    K.line(-.15,-.09,.5,.04,-.09,.5,'#b6d4e0',.8);
    K.tree(-.37,.28,0,3.5);
  },
  farmhouse(K,d,h) {
    const H=Math.max(6,h*.49);
    K.box(-.35,.17,-.28,.28,0,H,'#c5a078',{win:{gx:9,gy:8,ww:3,wh:3}});
    K.gable(-.40,.22,-.32,.32,H,Math.max(4,h*.26),'#9a5d4a','u');
    K.box(.19,.42,-.23,.25,0,Math.max(5,h*.41),'#a75e49');
    K.gable(.16,.45,-.26,.28,Math.max(5,h*.41),Math.max(4,h*.20),'#774b3e','w');
    K.cyl(-.26,-.20,4,0,Math.max(4,h*.34),'#9e8262',{top:'#cdbb98'});
    K.tree(-.43,.34,0,4.5); K.flat([[.2,.25],[.42,.25],[.42,.38],[.2,.38]],1,'#d7c7aa');
  },
  loft_apartment(K,d,h) {
    K.box(-.41,.37,-.30,.30,0,Math.max(8,h*.62),'#9e9a92');
    K.box(-.44,.40,-.33,.33,Math.max(8,h*.62),2,'#766f68');
    for(let z=7;z<h*.61;z+=9) {
      K.line(-.39,.31,z,.35,.31,z,'#d4c9b6',.7);
      for(const u of [-.30,-.09,.12,.30]) K.box(u-.035,u+.035,.31,.34,z+1,4,'#5d6f78');
    }
    K.cyl(.31,-.22,4,Math.max(8,h*.62),Math.max(4,h*.16),'#7d7d78');
    K.box(-.27,-.18,-.35,-.29,Math.max(8,h*.62)+2,3,'#e0d8c8');
  },
  micro_apartments(K,d,h) {
    const H=Math.min(92,h*1.08);
    K.box(-.28,.28,-.25,.25,0,H,'#aabac0',{win:{gx:5,gy:5,ww:3,wh:3}});
    K.box(-.31,.31,-.28,.28,H-2,2,'#7b939d');
    for(let z=7;z<H-2;z+=8) {
      K.box(-.31,.31,.25,.31,z,1,'#819da7');
      K.box(-.26,-.12,.30,.35,z+1,3.7,'#7997a4');
      K.box(-.05,.09,.30,.35,z+1,3.7,'#d6e4e3');
      K.box(.13,.27,.30,.35,z+1,3.7,'#7997a4');
    }
    K.box(-.08,.08,-.07,.07,H,Math.max(2,h*.08),'#879ba5');
  },
  luxury_penthouse(K,d,h) {
    const H=Math.min(100,h*1.03);
    K.box(-.37,.37,-.31,.31,0,H*.56,'#c4b49b',{win:{gx:5.5,gy:6,ww:3,wh:3,lit:'rgba(255,235,191,.92)'}});
    K.box(-.29,.30,-.25,.25,H*.56,H*.21,'#d9c8a9',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(-.20,.20,-.18,.18,H*.77,H*.19,'#e7d9bc',{win:{gx:4.5,gy:5,ww:3,wh:3}});
    K.flat([[-.27,-.22],[.27,-.22],[.27,.22],[-.27,.22]],H*.96,'#739eae');
    K.flat([[-.23,-.18],[.22,-.18],[.22,.18],[-.23,.18]],H*.965,'#7fc5d3');
    for(const u of [-.31,.31]) { K.box(u-.025,u+.025,-.30,.30,H*.57,3,'#e5e8dc'); K.tree(u,.31,H*.57,2.3); }
    K.box(-.13,.13,-.12,.12,H,2,'#a6b3b5');
  },
  cafe(K,d,h) {
    // Street-front café: broad glazing, striped canopy, hanging blade sign, tiny sidewalk tables.
    const H=Math.max(6,h*.60);
    K.box(-.42,.34,-.29,.28,0,H,'#cbb49b',{win:{gx:6,gy:7,ww:4,wh:4,lit:'rgba(255,221,163,.95)'}});
    K.box(-.45,.36,-.32,.31,H,1.8,'#5a665d');
    K.gable(-.45,.36,-.32,.31,H+1.5,Math.max(3,h*.15),'#5c554d','u');
    K.box(-.43,.35,.29,.36,H*.42,1.2,'#e8d8c0');
    for(let i=0;i<7;i++) K.flat([[ -.42+i*.11,.292],[ -.36+i*.11,.292],[ -.36+i*.11,.309],[ -.42+i*.11,.309]],H*.42+1.2,i%2?'#b35e4f':'#f5e7cf');
    K.box(-.14,.06,.28,.32,0,H*.76,'#4e3b31');
    // Door glazing, brass handle and slim frame make the entrance read as a real shopfront.
    K.box(-.115,.035,.315,.325,1,H*.69,'#78b6c8');
    K.line(-.04,.326,1,-.04,.326,H*.68,'rgba(245,250,247,.8)',.7);
    K.line(.025,.326,H*.24,.025,.326,H*.31,'#d9b66b',1.1);
    K.box(-.39,-.20,-.34,-.29,H*.66,3,'#f6e5c4');
    K.box(-.37,-.22,-.35,-.285,H*.66+3,1.1,'#9a6448');
    K.box(.34,.41,.03,.12,H*.55,4,'#685147');
    K.box(.34,.41,.03,.12,H*.55+4,1.2,'#ead6a7');
    K.dot(.375,.075,H*.55+6,1.3,'#e9c56d');
    for(const [u,w] of [[-.23,.39],[.20,.39]]) {
      K.cyl(u,w,4,0,1.5,'#6b584b',{top:'#d9c9ad'});
      K.line(u,w,0,u,w,0,'#4d3f34',1);
      K.line(u-.08,w-.08,0,u+.08,w+.08,0,'#695447',.8);
      K.ell(u,w,1.6,1.8,'#f5efe1');
    }
    K.tree(-.42,.35,0,3.8); K.tree(.40,.34,0,3.8);
    K.dot(-.28,.33,H+3,1.4,'#f2ce76');
  },
  bakery(K,d,h) {
    const H=Math.max(6,h*.58);
    K.box(-.41,.31,-.28,.28,0,H,'#e2c99a',{win:{gx:7,gy:7,ww:3.5,wh:3.5,lit:'rgba(255,225,159,.95)'}});
    K.gable(-.44,.34,-.31,.31,H,Math.max(4,h*.30),'#a45f4c','u');
    K.box(-.42,.32,.29,.35,H*.40,1,'#f5ead5');
    for(let i=0;i<6;i++) K.flat([[-.41+i*.12,.291],[-.35+i*.12,.291],[-.35+i*.12,.307],[-.41+i*.12,.307]],H*.40+1,i%2?'#e7c06d':'#fff0d7');
    K.cyl(.30,-.19,3.5,H,Math.max(3,h*.19),'#927767',{top:'#c9b7a0'});
    K.ell(-.16,.32,H*.58,3,'#d89c45','#f5dfb1'); K.ell(-.07,.32,H*.62,2.2,'#d89c45');
    K.box(-.12,.04,.28,.35,0,H*.75,'#8c5f47');
    K.dot(.02,.33,H*.79,1.5,'#f7d47d');
  },
  restaurant(K,d,h) {
    const H=Math.max(7,h*.58);
    K.box(-.42,.14,-.30,.29,0,H,'#d9b79c',{win:{gx:6,gy:6,ww:4,wh:4,lit:'rgba(255,216,161,.95)'}});
    K.box(-.45,.17,-.33,.32,H,2,'#785349');
    K.gable(-.46,.19,-.35,.34,H+2,Math.max(4,h*.22),'#994e41','u');
    K.box(.18,.42,-.23,.24,0,H*.43,'#b67f5e');
    K.flat([[.12,-.24],[.45,-.24],[.45,.30],[.12,.30]],1,'#9a8269');
    K.box(.13,.44,-.24,.31,H*.43,1.6,'#d3b18b');
    for(const u of [.19,.35]) { K.line(u,-.20,1,u,-.20,H*.44,'#77604c',1.1); K.line(u,.26,1,u,.26,H*.44,'#77604c',1.1); }
    for(const [u,w] of [[.22,.00],[.36,.10]]) { K.cyl(u,w,3.2,1,1.6,'#78614d',{top:'#e8dac0'}); K.line(u-.05,w-.03,0,u+.05,w+.03,0,'#765842',.7); }
    K.box(-.10,.08,.29,.34,0,H*.74,'#714939');
    K.dot(-.01,.34,H*.77,1.6,'#edc56f');
  },
  supermarket(K,d,h) {
    const H=Math.max(6,h*.50);
    K.box(-.45,.43,-.33,.31,0,H,'#d9e0d8',{win:{gx:5.5,gy:7,ww:4,wh:3,lit:'rgba(183,224,230,.94)'}});
    K.box(-.47,.45,-.35,.33,H,2,'#647f8e');
    K.box(-.25,.25,.31,.38,0,H*.70,'#92c5c7');
    K.box(-.28,.28,.36,.40,H*.70,2,'#f4f0df');
    for(let i=0;i<5;i++) K.box(-.22+i*.09,-.18+i*.09,.40,.42,H*.70+2,2,i%2?'#d9ab54':'#6ea49c');
    for(const u of [-.24,.02,.28]) {
      K.line(u,.42,1,u,.42,4,'#758a8b',.7);
      K.line(u-.04,.43,1,u+.04,.43,1,'#758a8b',.7);
    }
    K.box(-.1,.1,-.10,.10,H,2,'#94a6a8');
  },
  department_store(K,d,h) {
    const H=Math.min(68,h*1.10);
    K.box(-.44,.44,-.33,.33,0,H,'#bdafc4',{win:{gx:5.5,gy:7,ww:3.5,wh:3.5,lit:'rgba(255,230,190,.92)'}});
    for(let z=7;z<H-1;z+=9) {
      K.box(-.45,.45,.32,.36,z,1.2,'#eee1d3');
      K.line(-.40,.36,z+2,.40,.36,z+2,'#d9c9d2',.65);
    }
    K.box(-.18,.18,.33,.40,1,H*.30,'#d9c1a7');
    K.box(-.10,.10,.40,.44,H*.30+2,3,'#c4a4bc');
    K.box(-.38,-.22,-.37,-.32,H*.50,7,'#f2e6d5');
    K.dot(-.30,-.345,H*.50+3.5,1.4,'#d5ad5b');
    K.box(-.15,.15,-.35,-.29,H,2.4,'#8e8099');
  },
  business_park(K,d,h) {
    K.box(-.42,-.12,-.29,.22,0,Math.max(6,h*.44),'#79aeb7',{win:{gx:5.5,gy:6,ww:3,wh:3}});
    K.box(-.08,.23,-.25,.28,0,Math.max(8,h*.62),'#91c0c5',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(.26,.43,-.20,.27,0,Math.max(5,h*.36),'#cbd9d8',{win:{gx:6,gy:7,ww:3,wh:3}});
    K.flat([[-.16,-.02],[.30,-.02],[.30,-.12],[-.16,-.12]],Math.max(6,h*.44),'#779fa9');
    K.flat([[-.45,-.39],[.44,-.39],[.44,.40],[-.45,.40]],0,'#c8d2c7');
    K.tree(-.34,.32,0,4); K.tree(.37,.34,0,4);
    K.box(-.03,.03,-.06,.06,0,Math.max(3,h*.32),'#b5c7bd');
  },
  business_hotel(K,d,h) {
    const H=Math.min(84,h*1.1);
    K.box(-.34,.34,-.29,.29,0,H,'#9ab2c0',{win:{gx:5.5,gy:6,ww:3,wh:3,lit:'rgba(255,231,189,.93)'}});
    K.box(-.38,.38,-.33,.33,H-3,3,'#d0d9d5');
    for(let z=9;z<H-4;z+=10) K.line(-.34,.30,z,.34,.30,z,'rgba(244,239,217,.85)',.7);
    K.box(-.25,.25,.29,.39,0,H*.24,'#879fa8');
    K.box(-.21,.21,.34,.42,1,H*.22,'#dfe5df');
    K.box(-.16,.16,-.18,.18,H,4,'#829aa4');
    K.dot(0,0,H+5,1.8,'#e8c777');
    K.tree(-.4,.33,0,3.8); K.tree(.4,.33,0,3.8);
  },
  boutique_hotel(K,d,h) {
    const H=Math.max(8,h*.59);
    K.box(-.38,.28,-.30,.29,0,H,'#e7d0b8',{win:{gx:7,gy:7,ww:3,wh:3,lit:'rgba(255,227,186,.95)'}});
    K.gable(-.42,.32,-.34,.33,H,Math.max(4,h*.25),'#895647','u');
    K.box(-.40,.30,.29,.34,H*.44,1.4,'#f1dfc6');
    for(const u of [-.28,-.08,.12]) {
      K.box(u,u+.11,.34,.39,H*.28,1.2,'#a77857');
      K.line(u,.39,H*.28+1.2,u+.11,.39,H*.28+1.2,'#f5e9d7',.7);
    }
    K.box(-.08,.10,.29,.35,0,H*.72,'#88604b');
    K.tree(-.42,.35,0,4.5); K.tree(.38,.34,0,4);
    K.dot(-.01,.34,H*.76,1.6,'#e4ba69');
  },
  convention_centre(K,d,h) {
    K.box(-.46,.05,-.34,.30,0,Math.max(6,h*.35),'#9fb5bd',{win:{gx:5,gy:5,ww:4,wh:3}});
    K.box(.08,.44,-.31,.30,0,Math.max(6,h*.32),'#d9e3e0',{win:{gx:5,gy:5,ww:3,wh:3}});
    K.dome(-.20,-.02,12,Math.max(6,h*.35),'#8ba4b2');
    K.dome(.25,-.01,11,Math.max(6,h*.32),'#c1d4d8');
    K.box(-.45,.44,-.36,.33,Math.max(6,h*.35),2.4,'#668795');
    K.flat([[-.18,.30],[.20,.30],[.20,.40],[-.18,.40]],1,'#cbd5d2');
    K.box(-.06,.08,.33,.42,1,Math.max(4,h*.24),'#8fa7b1');
  },
  cinema(K,d,h) {
    const H=Math.max(7,h*.54);
    K.box(-.43,.42,-.31,.31,0,H,'#594f68');
    K.box(-.46,.45,-.34,.34,H,2.2,'#9b5b72');
    K.box(-.42,.42,.31,.36,H*.40,4,'#df9b68');
    K.box(-.39,.39,.34,.39,H*.40+4,1.3,'#f6d678');
    for(let i=0;i<8;i++) K.dot(-.35+i*.10,.398,H*.40+6,.9,'#fff0b0');
    K.box(-.14,.14,.30,.39,0,H*.68,'#211e2a');
    for(let i=0;i<3;i++) K.box(-.31+i*.27,-.21+i*.27,-.35,-.30,H*.70,4,['#d95d66','#4c8fc2','#e4b64d'][i]);
  },
  night_market(K,d,h) {
    K.flat([[-.48,-.42],[.48,-.42],[.48,.42],[-.48,.42]],0,'#b8c0b7');
    for(let i=0;i<4;i++) {
      const u=-.38+i*.24;
      K.box(u,u+.17,-.16,.21,0,Math.max(3,h*.25),['#ba6b4d','#6c938b','#d5ac58','#bf7d8d'][i]);
      K.flat([[u-.03,-.20],[u+.20,-.20],[u+.24,.20],[u-.07,.20]],Math.max(4,h*.25)+2,i%2?'#e9e2cd':'#a64942');
      for(let k=0;k<4;k++) K.flat([[u-.05+k*.07,-.18],[u-.01+k*.07,-.18],[u-.01+k*.07,.18],[u-.05+k*.07,.18]],Math.max(4,h*.25)+2.2,k%2?'#fff0d1':'#d18a4d');
      K.dot(u+.08,.04,Math.max(5,h*.25)+4,1.4,'#f9d574');
    }
    K.line(-.42,-.24,Math.max(4,h*.25)+5,.42,-.24,Math.max(4,h*.25)+5,'#655247',.8);
  },
  shopping_arcade(K,d,h) {
    K.box(-.40,-.12,-.30,.25,0,Math.max(7,h*.50),'#d7e7e4',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(.12,.40,-.30,.25,0,Math.max(7,h*.50),'#c6dcd9',{win:{gx:5,gy:6,ww:3,wh:3}});
    for(const u of [-.30,-.10,.10,.30]) K.box(u-.025,u+.025,-.32,.32,Math.max(7,h*.50),2,'#7fa9ae');
    K.poly([K.P(-.42,-.33,Math.max(7,h*.50)+2),K.P(.42,-.33,Math.max(7,h*.50)+2),K.P(.36,.15,Math.max(7,h*.50)+6),K.P(-.36,.15,Math.max(7,h*.50)+6)],'#8eb6bd',true);
    K.flat([[-.08,-.30],[.08,-.30],[.08,.30],[-.08,.30]],1,'#e5dcca');
    K.tree(-.43,.34,0,4); K.tree(.42,.34,0,4);
  },
  coworking_space(K,d,h) {
    const H=Math.max(8,h*.62);
    K.box(-.42,.36,-.31,.29,0,H,'#8daab5',{win:{gx:5,gy:5.5,ww:3,wh:4,lit:'rgba(189,229,238,.95)'}});
    K.box(-.46,.40,-.34,.32,H,2,'#5e7f8d');
    K.flat([[-.31,-.25],[.29,-.25],[.29,.25],[-.31,.25]],H+2,'#7fa69e');
    K.tree(-.22,-.15,H+2,2.4); K.tree(.18,-.15,H+2,2.4);
    K.box(-.16,.14,.30,.36,0,H*.38,'#b4c9ca');
    K.line(-.14,.37,H*.38,.12,.37,H*.38,'#e6ebe2',.8);
  },
  financial_tower(K,d,h) {
    const H=Math.min(105,h*1.05);
    K.box(-.37,.37,-.31,.31,0,H*.46,'#778ca7',{win:{gx:5,gy:5,ww:2.5,wh:3.5}});
    K.box(-.30,.30,-.25,.25,H*.46,H*.25,'#879eb8',{win:{gx:5,gy:5,ww:2.5,wh:3.5}});
    K.box(-.23,.23,-.19,.19,H*.71,H*.21,'#a5b7c3',{win:{gx:4.5,gy:5,ww:2.6,wh:3.4}});
    K.box(-.15,.15,-.13,.13,H*.92,H*.08,'#d4dedb');
    K.line(0,0,H,0,0,H+Math.max(6,h*.13),'#dce6e6',1.4);
    K.dot(0,0,H+Math.max(6,h*.13),2,'#f3d277');
    for(const u of [-.28,.28]) K.line(u,.31,5,u,.31,H*.41,'#d2e1e5',.7);
  },
  tech_campus(K,d,h) {
    K.box(-.44,-.13,-.30,.22,0,Math.max(8,h*.55),'#7caeb8',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.box(-.09,.25,-.27,.26,0,Math.max(10,h*.75),'#9cc9cc',{win:{gx:5,gy:5,ww:3,wh:3}});
    K.box(.29,.43,-.21,.25,0,Math.max(6,h*.40),'#d0e2df',{win:{gx:5,gy:6,ww:3,wh:3}});
    K.flat([[-.15,.12],[.32,.12],[.32,.02],[-.15,.02]],Math.max(8,h*.55),'#6f9da8');
    K.box(-.08,.14,-.22,.22,Math.max(10,h*.75),2,'#c3e0dc');
    K.line(-.35,.27,4,.35,.27,4,'#e5f1e9',.7);
    K.tree(-.37,.34,0,4); K.tree(.39,.32,0,4);
  },
  art_mall(K,d,h) {
    K.box(-.43,.05,-.31,.28,0,Math.max(6,h*.42),'#efe1cf',{win:{gx:6,gy:6,ww:4,wh:3}});
    K.box(-.18,.36,-.22,.34,Math.max(6,h*.42),Math.max(4,h*.25),'#c1a2bf',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.45,.08,-.33,.30,Math.max(6,h*.42),2,'#b18ba7');
    K.poly([K.P(-.18,-.22,h*.68),K.P(.36,-.22,h*.68),K.P(.28,.24,h*.85),K.P(-.26,.24,h*.85)],'#e7d5d0',true);
    K.ell(.21,.12,h*.86,5,'#8db1ab','#f5eadc');
    K.dot(.21,.12,h*.89,2,'#f2c98a');
  },
  rooftop_market(K,d,h) {
    const H=Math.max(6,h*.48);
    K.box(-.40,.40,-.29,.29,0,H,'#b8cbb8',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.flat([[-.44,-.34],[.44,-.34],[.44,.34],[-.44,.34]],H+1,'#78a878');
    for(let i=0;i<3;i++) {
      const u=-.31+i*.23;
      K.line(u,-.22,H+2,u,.22,H+2,'#7e6951',1.1);
      K.line(u,-.22,H+2,u,.22,H+2+4,'#7e6951',1.1);
      K.flat([[u-.10,-.22],[u+.10,-.22],[u+.15,.22],[u-.15,.22]],H+6,i%2?'#d8b471':'#bd7558');
      K.dot(u,0,H+7,1.5,'#f3d378');
    }
    K.tree(-.34,.29,H+1,3); K.tree(.33,.29,H+1,3);
    K.flat([[-.08,-.42],[.08,-.42],[.08,.42],[-.08,.42]],H+1,'#e7e0ce');
  },
  game_arcade(K,d,h) {
    const H=Math.max(7,h*.54);
    K.box(-.41,.39,-.30,.28,0,H,'#373a66',{win:{gx:5.5,gy:6,ww:3,wh:3,lit:'rgba(199,190,255,.96)'}});
    K.box(-.44,.42,-.33,.31,H,2.2,'#7f70c0');
    K.box(-.37,.37,.29,.35,H*.40,4,'#e4a0e6');
    K.box(-.34,.34,.33,.39,H*.40+4,1.2,'#e8d8f1');
    for(let i=0;i<6;i++) K.dot(-.29+i*.115,.397,H*.40+6,1,'#9ce6ee');
    K.box(-.14,.14,.29,.37,0,H*.77,'#232844');
    K.box(-.11,.11,.31,.35,2,H*.66,'#98a7dd');
  },
  daycare(K,d,h) {
    const H=Math.max(5,h*.50);
    K.box(-.38,.33,-.28,.27,0,H,'#efd2c8',{win:{gx:7,gy:7,ww:4,wh:4,lit:'rgba(255,236,183,.96)'}});
    K.gable(-.42,.37,-.32,.31,H,Math.max(4,h*.28),'#c86e61','u');
    K.box(-.12,.08,.27,.33,0,H*.72,'#9d755b');
    K.box(-.42,-.20,.28,.34,H*.43,2,'#f6e7c9');
    K.dot(-.31,.35,H*.43+4,2,'#e7b94d'); K.dot(-.24,.35,H*.43+4,2,'#6ba5b2');
    K.flat([[-.33,-.40],[.38,-.40],[.38,-.31],[-.33,-.31]],1,'#87b984');
    K.line(-.28,-.36,1,-.18,-.36,1,'#86634d',1.5);
    K.ell(-.28,-.36,1,2,'#e4b556'); K.ell(-.18,-.36,1,2,'#e4b556');
  },
  elementary_school(K,d,h) {
    const H=Math.max(8,h*.52);
    K.box(-.43,-.08,-.30,.28,0,H,'#e4d2a6',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.04,.36,-.26,.28,0,H*.78,'#d7c7a3',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.10,.10,-.12,.12,H*.78,Math.max(4,h*.20),'#b69d75');
    K.gable(-.46,-.06,-.33,.31,H,Math.max(3,h*.15),'#ad654b','u');
    K.gable(-.02,.39,-.29,.31,H*.78,Math.max(3,h*.12),'#ad654b','u');
    K.dot(0,0,H*.78+Math.max(4,h*.20)+2,2.3,'#e5c26f');
    K.flat([[-.44,-.38],[.42,-.38],[.42,-.28],[-.44,-.28]],1,'#d7d4bd');
    K.tree(-.36,.34,0,4); K.tree(.35,.34,0,4);
  },
  high_school(K,d,h) {
    K.box(-.43,-.12,-.30,.24,0,Math.max(8,h*.52),'#aabbd0',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.09,.28,-.28,.30,0,Math.max(10,h*.62),'#c3d0d8',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(.25,.43,-.23,.28,0,Math.max(5,h*.32),'#d5dadd');
    K.gable(-.45,-.10,-.33,.27,Math.max(8,h*.52),Math.max(3,h*.14),'#6f8098','u');
    K.flat([[-.12,.30],[.13,.30],[.13,.36],[-.12,.36]],Math.max(10,h*.62),'#8199ab');
    K.box(-.06,.12,.30,.36,0,Math.max(4,h*.24),'#8c9fad');
    K.line(.33,.0,0,.33,.0,Math.max(6,h*.76),'#637f8f',1);
    K.dot(.33,.0,Math.max(6,h*.76),1.5,'#d4b455');
  },
  city_library(K,d,h) {
    // Actual civic library massing: wide reading hall, glazed atrium, book-spine fins and grand steps.
    const H=Math.max(7,h*.48);
    K.box(-.45,.45,-.31,.31,0,H,'#c9bca5',{win:{gx:5.5,gy:6,ww:3.7,wh:4,lit:'rgba(198,227,230,.92)'}});
    K.box(-.40,.40,-.34,.34,H,2.1,'#a99b83');
    K.box(-.22,.22,-.35,-.24,H*.50,H*.50,'#98bfc8',{win:{gx:4.6,gy:5,ww:3,wh:3,lit:'rgba(196,235,239,.96)'}});
    K.box(-.26,.26,-.37,-.22,H*.50,2,'#7b9fa6');
    for(const u of [-.36,-.25,.25,.36]) K.box(u-.025,u+.025,.31,.35,1,H*.44,'#f0e8d6');
    for(let i=0;i<4;i++) K.flat([[-.22+i*.12,.34],[-.10+i*.12,.34],[-.10+i*.12,.44],[-.22+i*.12,.44]],1+i*.6,'#d6cbb6');
    K.flat([[-.14,.36],[.14,.36],[.20,.45],[-.20,.45]],H*.42,'#e9dfcb');
    K.box(-.08,.08,.30,.36,0,H*.64,'#b28c6b');
    K.box(-.38,.38,-.34,.34,H,1.7,'#8eaaad');
    K.tree(-.43,.35,0,3.4); K.tree(.43,.35,0,3.4);
  },
  community_center(K,d,h) {
    const H=Math.max(6,h*.48);
    K.box(-.41,.41,-.30,.29,0,H,'#d2c8b4',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(-.44,.44,-.33,.32,H,Math.max(4,h*.18),'#8c7a69','u');
    for(const u of [-.24,-.08,.08,.24]) K.box(u-.025,u+.025,.28,.32,0,H*.55,'#e9e1ce');
    K.box(-.12,.12,.30,.37,0,H*.75,'#a27b5e');
    K.flat([[-.24,.36],[.24,.36],[.24,.43],[-.24,.43]],1,'#d4c8ae');
    K.tree(-.40,.35,0,4); K.tree(.40,.34,0,4);
  },
  fire_hq(K,d,h) {
    const H=Math.max(8,h*.58);
    K.box(-.43,.30,-.30,.28,0,H,'#d8d8cf',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.45,.32,.27,.35,0,H*.66,'#a54e43');
    for(const u of [-.32,-.10,.12]) {
      K.box(u-.075,u+.075,.35,.40,1,H*.48,'#7e342d');
      K.box(u-.058,u+.058,.40,.43,2,H*.43,'#cc6e5d');
      K.line(u-.05,.43,2,u-.05,.43,H*.43,'#f1d4b5',.7);
      K.line(u+.05,.43,2,u+.05,.43,H*.43,'#f1d4b5',.7);
    }
    K.box(-.40,-.22,-.34,-.28,H*.68,Math.max(4,h*.22),'#e1d7c5');
    K.line(-.31,-.36,H*.72,-.31,-.36,H*.88,'#f1e4d1',1.3);
    K.box(.18,.36,-.15,.12,H*.55,H*.18,'#b85447');
    K.dot(.26,-.15,H*.75,2,'#e3b759');
  },
  police_hq(K,d,h) {
    const H=Math.max(8,h*.56);
    K.box(-.42,.34,-.30,.29,0,H,'#c7d0d8',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.box(-.44,.36,-.33,.32,H,2,'#617da0');
    K.box(-.12,.12,.29,.35,0,H*.68,'#738aa5');
    K.box(-.08,.08,.34,.38,1,H*.58,'#e7ebe8');
    K.dot(0,.38,H*.68+3,2.2,'#e5c66c');
    for(const u of [-.28,-.05,.18]) K.box(u-.03,u+.03,.30,.34,1,H*.45,'#93a9ba');
    K.line(.30,-.20,1,.30,-.20,H*.72,'#788ba2',1);
    K.poly([K.P(.30,-.20,H*.65),K.P(.42,-.20,H*.61),K.P(.42,-.20,H*.55),K.P(.30,-.20,H*.58)],'#5d83ad',true);
  },
  medical_center(K,d,h) {
    const H=Math.max(8,h*.62);
    K.box(-.43,-.12,-.30,.28,0,H,'#e3e8e4',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.box(-.09,.34,-.28,.30,0,H*.84,'#cddfe3',{win:{gx:5.5,gy:6,ww:3,wh:3}});
    K.box(-.15,.12,-.33,-.25,H*.70,H*.28,'#e6ebea',{win:{gx:4.5,gy:5,ww:3,wh:3}});
    K.box(-.08,.08,.30,.37,0,H*.58,'#a7c1c6');
    K.box(-.025,.025,.37,.39,H*.64,5,'#c84e4e');
    K.box(-.12,.12,.37,.39,H*.64+1.8,2,'#c84e4e');
    K.flat([[-.06,-.10],[.06,-.10],[.06,.10],[-.06,.10]],H*.99,'#dce6e3');
    K.box(-.10,.10,-.11,.11,H,2,'#cbd8d8');
  },
  science_university(K,d,h) {
    K.box(-.42,-.12,-.30,.24,0,Math.max(7,h*.50),'#c7d8dd',{win:{gx:5.5,gy:6,ww:3,wh:3}});
    K.box(-.08,.23,-.28,.28,0,Math.max(9,h*.64),'#91bac9',{win:{gx:5,gy:5.5,ww:3,wh:3}});
    K.box(.27,.43,-.22,.26,0,Math.max(5,h*.34),'#dfdfd2',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.dome(.08,-.04,8,Math.max(9,h*.64),'#d2dedb');
    K.box(-.08,.24,-.31,.31,Math.max(9,h*.64),1.8,'#6c8e9d');
    K.flat([[-.15,.20],[.27,.20],[.27,.31],[-.15,.31]],1,'#cfc8b5');
    K.tree(-.35,.34,0,4); K.tree(.36,.33,0,4);
  },
  heritage_museum(K,d,h) {
    const H=Math.max(7,h*.52);
    K.box(-.43,.43,-.31,.30,0,H,'#c5af91',{win:{gx:8,gy:7,ww:3,wh:3}});
    K.box(-.46,.46,-.34,.33,H,2.2,'#a18c72');
    K.gable(-.42,.42,-.32,.32,H+2.2,Math.max(4,h*.22),'#8a715a','u');
    for(const u of [-.32,-.16,0,.16,.32]) K.box(u-.025,u+.025,.30,.34,1,H*.62,'#ece2cc');
    K.box(-.09,.09,.33,.39,0,H*.72,'#896c55');
    K.box(-.20,.20,.34,.41,H*.73,2,'#d5c2a0');
    K.tree(-.43,.35,0,3.8); K.tree(.43,.35,0,3.8);
  },
  concert_hall(K,d,h) {
    const H=Math.max(8,h*.56);
    K.box(-.43,.43,-.31,.30,0,H,'#ada5bf');
    K.poly([K.P(-.45,-.33,H),K.P(.44,-.33,H),K.P(.36,.28,H+Math.max(4,h*.21)),K.P(-.40,.28,H+Math.max(4,h*.21))],'#e0dbe7',true);
    K.poly([K.P(-.40,.28,H+Math.max(4,h*.21)),K.P(.36,.28,H+Math.max(4,h*.21)),K.P(.28,.32,H+Math.max(4,h*.21)+2),K.P(-.33,.32,H+Math.max(4,h*.21)+2)],'#917d9e',true);
    K.box(-.30,.30,.29,.34,1,H*.48,'#6f6a83');
    K.line(-.25,.34,3,.25,.34,3,'#f0e4d1',1);
    K.dot(0,.34,H*.65,2,'#e9cd85');
  },
  art_gallery(K,d,h) {
    K.box(-.44,.02,-.31,.29,0,Math.max(6,h*.44),'#e9e4d9',{win:{gx:6,gy:6,ww:4,wh:3}});
    K.box(-.18,.38,-.21,.32,Math.max(6,h*.44),Math.max(4,h*.27),'#d3c0a1',{win:{gx:6,gy:6,ww:3,wh:3}});
    K.flat([[-.38,-.29],[.30,-.29],[.30,.27],[-.38,.27]],Math.max(6,h*.44)+Math.max(4,h*.27),'#f0e8d6');
    K.poly([K.P(-.18,-.20,h*.75),K.P(-.03,-.20,h*.75),K.P(.08,.03,h*.92),K.P(-.07,.06,h*.92)],'#a56f69',true);
    K.dot(.23,.15,h*.73,3,'#d2a85f');
    K.box(-.10,.08,.29,.37,0,H*.64,'#8c7a6b');
  },
  sports_center(K,d,h) {
    const H=Math.max(7,h*.42);
    K.box(-.43,.43,-.32,.31,0,H,'#9ab4b0');
    K.gable(-.45,.45,-.35,.34,H,Math.max(4,h*.19),'#648b8c','u');
    K.box(-.40,.4,.31,.35,1,H*.66,'#dfe8df');
    K.flat([[-.40,-.31],[.40,-.31],[.40,.28],[-.40,.28]],H,'#75a9a2');
    K.line(-.38,-.28,H+1,.38,-.28,H+1,'#e7e8d7',.8);
    K.line(0,-.28,H+1,0,.28,H+1,'#e7e8d7',.8);
    K.ell(0,0,H+1,6,'rgba(240,244,225,.15)','#e7e8d7');
    K.box(-.08,.08,.30,.38,0,H*.60,'#b5d0c8');
  },
  botanical_garden(K,d,h) {
    K.flat([[-.48,-.43],[.48,-.43],[.48,.43],[-.48,.43]],0,'#a0c68b');
    K.box(-.35,.35,-.22,.25,0,Math.max(5,h*.36),'#85b7b8');
    K.gable(-.40,.40,-.27,.30,Math.max(5,h*.36),Math.max(4,h*.30),'#b5d8d4','u');
    for(const u of [-.26,-.08,.10,.28]) K.line(u,-.23,1,u,-.23,Math.max(5,h*.36),'#e0ece4',.8);
    K.line(-.40,-.23,Math.max(5,h*.36),.40,-.23,Math.max(5,h*.36),'#e0ece4',.8);
    K.tree(-.34,.30,0,4.5); K.tree(.34,.30,0,4.5); K.tree(0,-.29,0,4);
    K.flat([[-.05,.30],[.05,.30],[.05,.42],[-.05,.42]],1,'#dcd5c3');
  },
  city_zoo(K,d,h) {
    K.flat([[-.48,-.42],[.48,-.42],[.48,.42],[-.48,.42]],0,'#a9c58c');
    K.box(-.42,-.08,-.27,.21,0,Math.max(5,h*.35),'#d8c5a4',{win:{gx:7,gy:7,ww:3,wh:3}});
    K.gable(-.45,-.05,-.30,.24,Math.max(5,h*.35),Math.max(3,h*.15),'#91735a','u');
    K.box(.02,.38,-.24,.28,0,Math.max(4,h*.28),'#b5c5b4');
    K.flat([[.05,.03],[.34,.03],[.34,.24],[.05,.24]],1,'#6b9c73');
    K.line(.06,.03,1,.34,.03,1,'#e5e2cc',1); K.line(.06,.24,1,.34,.24,1,'#e5e2cc',1);
    K.tree(.10,.08,1,3.2); K.tree(.28,.17,1,3.2);
    K.box(-.1,.1,.23,.31,0,Math.max(4,h*.25),'#c9b28b');
  },
  aquatic_center(K,d,h) {
    const H=Math.max(6,h*.42);
    K.box(-.42,.42,-.31,.30,0,H,'#bfdce0');
    K.gable(-.45,.45,-.34,.33,H,Math.max(3,h*.16),'#5c9fb9','u');
    K.flat([[-.40,-.26],[.36,-.26],[.36,.24],[-.40,.24]],1,'#4e9fc3');
    for(let i=0;i<5;i++) K.line(-.35+i*.15,-.24,1,-.35+i*.15,.22,1,'#c2edf0',.65);
    K.box(-.12,.12,.29,.34,0,H*.68,'#dceae7');
    K.box(-.08,.08,.34,.38,1,H*.48,'#7199ac');
    K.dot(.25,-.22,H+2,1.5,'#f1cf78');
  },
  observatory(K,d,h) {
    K.flat([[-.44,-.38],[.44,-.38],[.44,.38],[-.44,.38]],0,'#94a0a6');
    K.cyl(0,0,16,1,Math.max(5,h*.30),'#8d9ca5',{top:'#c4cdd0'});
    K.dome(0,0,15,Math.max(5,h*.30)+1,'#6c8298');
    K.ell(0,0,Math.max(5,h*.30)+2,11,'#7d9bb4','#dfe6e3');
    K.line(-.12,-.04,Math.max(5,h*.30)+9,.16,.08,Math.max(5,h*.30)+17,'#dfe6e5',2.5);
    K.cyl(.15,.08,2.2,Math.max(5,h*.30)+15,5,'#e5e9e4');
    K.box(-.27,.27,-.23,.23,0,Math.max(4,h*.20),'#bbbcae');
    K.tree(-.37,.30,0,3.2); K.tree(.37,.30,0,3.2);
  },
  television_tower(K,d,h) {
    const H=Math.min(110,h*1.06);
    K.box(-.10,.10,-.09,.09,0,H*.35,'#9aa9ae');
    K.box(-.16,.16,-.14,.14,H*.35,H*.30,'#8c9da7');
    K.box(-.12,.12,-.11,.11,H*.65,H*.18,'#c4d2d2');
    K.box(-.06,.06,-.06,.06,H*.83,H*.09,'#829ba8');
    K.line(-.04,-.02,0,0,0,H,'#697f8c',1.2);
    K.line(.04,-.02,0,0,0,H,'#697f8c',1.2);
    K.line(-.04,.02,0,0,0,H,'#697f8c',1.2);
    K.line(.04,.02,0,0,0,H,'#697f8c',1.2);
    K.ell(0,0,H*.52,10,'rgba(94,175,202,.18)','#a9c5cf');
    K.ell(0,0,H*.66,7,'rgba(94,175,202,.18)','#a9c5cf');
    K.dot(0,0,H+6,2,'#ed6b63');
  },
};

function genericArchitecture(K, d, h) {
  const col = d.color || '#91a5b3';
  const trim = tint(col, 0.18), dark = tint(col, -0.24);
  const win = { gx: 8, gy: 7, ww: 3.5, wh: 3.2, lit: 'rgba(255,231,167,.9)' };
  const top = Math.max(8, Math.min(h, 100));
  const arch = d.architecture || ({
    residential: ['cottage','villa','townhouse','midrise','tower','green'][Math.abs(hashId(d.id)) % 6],
    commercial: ['market','midrise','glass','tower','civic'][Math.abs(hashId(d.id)) % 5],
    industrial: ['industrial','utility','market'][Math.abs(hashId(d.id)) % 3],
    utility: ['utility','solar','industrial'][Math.abs(hashId(d.id)) % 3],
    service: ['civic','campus','dome','plaza'][Math.abs(hashId(d.id)) % 4],
    transport: ['market','glass','harbor'][Math.abs(hashId(d.id)) % 3]
  }[d.cat] || 'midrise');
  if (arch === 'cottage') {
    const bh = Math.max(6, top * .58);
    K.box(-.34,.30,-.27,.27,0,bh,tint(col,.12),{win:{gx:10,gy:8,top:2,bot:2}});
    K.gable(-.39,.35,-.31,.31,bh,Math.max(5,top*.42),col,'u');
    K.box(-.08,.10,.27,.42,0,Math.max(2,bh*.42),dark);
    K.decalL(-.23,-.10,.27,2,Math.max(5,bh*.58),'#8ec5d9');
    K.tree(-.40,.34,0,6);
  } else if (arch === 'villa') {
    const bh = Math.max(7,top*.58);
    K.box(-.38,.16,-.31,.30,0,bh,tint(col,.12),{win:{gx:9,gy:7,top:2}});
    K.gable(-.42,.20,-.35,.34,bh,Math.max(5,top*.25),dark,'u');
    K.box(.10,.40,-.20,.20,0,bh*.72,tint(col,.23),{win:{gx:8,gy:8,top:2}});
    K.gable(.07,.43,-.23,.23,bh*.72,Math.max(4,top*.22),col,'w');
    K.box(-.02,.12,.30,.42,0,bh*.5,'#8b6c55');
    K.tree(-.42,.34,0,6); K.tree(.39,-.35,0,5);
  } else if (arch === 'townhouse') {
    const bh = Math.max(8,top*.55);
    K.box(-.43,.43,-.30,.30,0,bh,tint(col,.12),{win:{gx:7,gy:7,ww:3,wh:4}});
    for(let i=0;i<4;i++){
      const u=-.32+i*.21;
      K.gable(u,u+.20,-.35,.35,bh,Math.max(4,top*.32),i%2?trim:col,'u');
      K.decalL(u+.045,u+.13,.30,1,Math.max(4,bh*.42),i%2?'#d4e4e8':'#6c4b3f');
    }
  } else if (arch === 'midrise') {
    K.box(-.37,.37,-.31,.31,0,top,col,{win});
    K.box(-.42,.42,-.35,.35,top-2,2,trim);
    K.box(-.28,.28,-.24,.24,top,Math.max(2,top*.08),dark);
    for(let z=6;z<top-4;z+=10){
      K.flat([[-.40,-.32],[.40,-.32],[.40,-.27],[-.40,-.27]],z,trim);
      K.flat([[-.40,.27],[.40,.27],[.40,.32],[-.40,.32]],z,trim);
    }
  } else if (arch === 'tower') {
    const a=Math.max(8,top*.48), b=Math.max(6,top*.31), c=Math.max(4,top-a-b);
    K.box(-.39,.39,-.32,.32,0,a,col,{win});
    K.box(-.30,.30,-.25,.25,a,b,tint(col,.12),{win:{gx:7,gy:6,ww:3,wh:3,lit:win.lit}});
    K.box(-.20,.20,-.18,.18,a+b,c,tint(col,.2),{win:{gx:6,gy:6,ww:3,wh:3,lit:win.lit}});
    K.box(-.24,.24,-.22,.22,top-2,2,trim);
    K.line(0,0,top,0,0,top+Math.max(6,top*.18),dark,1.5);
    K.dot(0,0,top+Math.max(6,top*.18),2.2,'#ffd98a');
  } else if (arch === 'glass') {
    K.box(-.36,.36,-.30,.30,0,top,col,{win:{gx:6.5,gy:6,ww:3.5,wh:4,lit:'rgba(193,236,255,.92)'}});
    K.box(-.40,.40,-.34,.34,top-2,2,trim);
    for(let u=-.30;u<=.31;u+=.15) K.line(u,-.30,1,u,-.30,top-1,'rgba(230,247,255,.7)',.7);
    K.box(-.22,.22,-.20,.20,top,Math.max(2,top*.09),dark);
    K.line(.25,-.08,top,.25,-.08,top+7,'#e7edf0',1);
  } else if (arch === 'civic') {
    K.box(-.44,.44,-.39,.39,0,4,'#c8c1b1');
    K.box(-.37,.37,-.31,.31,4,Math.max(7,top*.67),tint(col,.12),{win:{gx:10,gy:9,ww:3,wh:4}});
    for(const u of [-.27,-.09,.09,.27]) K.box(u-.025,u+.025,.31,.35,4,Math.max(7,top*.67),'#eee7d6');
    K.box(-.44,.44,-.39,.39,top*.67+4,3,trim);
    K.gable(-.41,.41,-.36,.36,top*.67+7,Math.max(4,top*.22),dark,'u');
    K.box(-.09,.09,.34,.43,0,Math.max(5,top*.28),'#a87960');
  } else if (arch === 'market') {
    const bh=Math.max(5,top*.58);
    K.box(-.42,.42,-.34,.34,0,bh,tint(col,.14),{win:{gx:10,gy:8,top:Math.max(2,bh*.2),lit:'rgba(255,229,166,.92)'}});
    K.box(-.46,.46,-.38,.38,bh-1,2.3,trim);
    for(let i=0;i<7;i++) K.decalL(-.40+i*.115,-.30+i*.115,.34,bh*.38,bh*.38+3.5,i%2? '#f8eee0':col);
    K.box(-.12,.12,.34,.41,0,bh*.75,dark);
    K.box(-.05,.25,-.42,-.34,bh*.56,bh*.06,'#f5d68e');
  } else if (arch === 'industrial') {
    const bh=Math.max(7,top*.52);
    K.box(-.43,.22,-.34,.31,0,bh,col,{win:{gx:10,gy:8,ww:3,wh:3}});
    K.gable(-.46,.25,-.37,.34,bh,Math.max(4,top*.25),dark,'u');
    K.box(.25,.43,-.25,.28,0,Math.max(4,bh*.8),trim);
    for(let i=0;i<3;i++) K.box(-.35+i*.20,-.23+i*.20,.31,.35,1,Math.max(4,bh*.36),'#d5dce0');
    K.cyl(.33,-.22,3.5,bh*.8,Math.max(4,top*.24),dark,{top:trim});
  } else if (arch === 'utility') {
    K.box(-.38,.08,-.31,.27,0,Math.max(8,top*.67),col,{win:{gx:11,gy:8,ww:3,wh:3}});
    K.box(-.42,.12,-.35,.31,top*.67,2.4,trim);
    K.cyl(.24,-.20,8,0,Math.max(8,top*.58),trim,{bands:[col,tint(col,.15)]});
    K.cyl(.24,.20,6,0,Math.max(6,top*.43),col,{top:trim});
    K.line(-.25,.25,4,-.05,.25,4,'#d8e3e7',2);
    K.dot(.10,.25,6,2.5,'#f1cb7b');
  } else if (arch === 'campus') {
    K.flat([[-.47,-.43],[.45,-.44],[.47,.42],[-.44,.46]],0,'#c7d0c6');
    K.box(-.40,-.06,-.30,.24,0,Math.max(7,top*.65),col,{win:{gx:8,gy:8}});
    K.box(.00,.36,-.27,.24,0,Math.max(9,top*.82),trim,{win:{gx:8,gy:7}});
    K.box(-.08,.18,.20,.39,0,Math.max(6,top*.45),tint(col,.18),{win:{gx:7,gy:7}});
    K.flat([[-.09,.18],[.17,.18],[.17,.29],[-.09,.29]],1,'#e9dfca');
    K.tree(-.39,.36,0,5); K.tree(.39,.34,0,5);
  } else if (arch === 'dome') {
    K.box(-.40,.40,-.34,.34,0,Math.max(8,top*.56),col,{win:{gx:10,gy:8}});
    K.box(-.45,.45,-.39,.39,top*.56,3,trim);
    K.dome(0,0,14,top*.56,shade(col,.23));
    K.box(-.12,.12,.34,.42,0,Math.max(4,top*.24),dark);
    K.dot(0,0,top*.56+10,2,'#f4d9a3');
  } else if (arch === 'stadium') {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#b8c4bd');
    K.ell(0,0,2,17,trim,'rgba(255,255,255,.35)');
    K.ell(0,0,4,13,'#354d58','#d9e0dd');
    K.ell(0,0,6,10,col,'rgba(255,255,255,.45)');
    K.ell(0,0,8,6,'#6cbd8d','rgba(235,246,233,.65)');
    K.box(-.40,-.18,.22,.37,0,Math.max(4,top*.34),trim);
    K.box(.18,.40,.22,.37,0,Math.max(4,top*.34),col);
    K.dot(0,0,10,2,'#f7e2a0');
  } else if (arch === 'plaza') {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#c7d5c2');
    K.flat([[-.06,-.46],[.06,-.46],[.06,.46],[-.06,.46]],.4,'#e5dfd2');
    K.flat([[-.46,-.06],[.46,-.06],[.46,.06],[-.46,.06]],.4,'#e5dfd2');
    K.cyl(0,0,9,0,2,'#8ab9c6'); K.ell(0,0,3,9,'#79c6d0','#eaf8ed');
    K.line(0,0,3,0,0,Math.max(6,top*.7),'#e7f7f8',1.5);
    for(const [u,w] of [[-.32,-.28],[.32,-.28],[-.32,.28],[.32,.28]]) K.tree(u,w,0,5);
  } else if (arch === 'spire') {
    K.box(-.28,.28,-.24,.24,0,Math.max(6,top*.24),trim);
    K.box(-.20,.20,-.18,.18,top*.24,Math.max(8,top*.45),col,{win:{gx:7,gy:8,ww:3,wh:3}});
    K.box(-.14,.14,-.13,.13,top*.69,Math.max(5,top*.15),dark);
    K.cone(0,0,7,top*.84,Math.max(8,top*.18),trim);
    K.line(0,0,top,0,0,top+Math.max(6,top*.15),'#dbe7ed',1.2);
    K.dot(0,0,top+Math.max(6,top*.15),2,'#ffd166');
  } else if (arch === 'harbor') {
    K.flat([[-.48,-.44],[.48,-.44],[.48,.44],[-.48,.44]],0,'#b8c5c9');
    K.box(-.42,.03,-.34,-.02,0,Math.max(8,top*.58),'#d4dfe4',{win});
    K.box(.08,.40,-.34,.26,0,Math.max(5,top*.36),trim);
    K.line(-.12,.23,4,-.12,.23,top+8,'#d6a35c',2);
    K.line(-.12,.23,top+8,.37,.23,top+8,'#d6a35c',2);
    K.line(.27,.23,top+8,.27,.23,Math.max(5,top*.3),'#5b6871',1.5);
    K.box(.22,.32,.18,.28,Math.max(5,top*.3),4,'#db6e5e');
  } else if (arch === 'green') {
    K.box(-.35,.35,-.29,.29,0,top,col,{win:{gx:7,gy:7,lit:'rgba(255,237,174,.9)'}});
    for(let z=8;z<top;z+=12){
      K.flat([[-.39,-.32],[.39,-.32],[.39,-.26],[-.39,-.26]],z,'#55a87b');
      K.flat([[-.39,.26],[.39,.26],[.39,.32],[-.39,.32]],z+2,'#7acb9b');
    }
    K.flat([[-.35,-.29],[.35,-.29],[.35,.29],[-.35,.29]],top,'#8dcf9b');
    K.tree(-.40,.35,0,5); K.tree(.40,.32,0,5);
  } else if (arch === 'solar') {
    K.box(-.44,.44,-.44,.44,0,1.5,'#a9b3bc');
    for(const [u,w] of [[-.23,-.23],[.23,-.23],[-.23,.23],[.23,.23]]){
      const pts=[[u-.17,w-.17,4],[u+.17,w-.17,4],[u+.17,w+.17,2],[u-.17,w+.17,2]].map(p=>K.P(...p));
      K.poly(pts,'#244b7a','rgba(230,242,255,.5)');
      K.g.strokeStyle='rgba(202,231,255,.6)';K.g.lineWidth=.7;K.g.beginPath();K.g.moveTo(...pts[0]);K.g.lineTo(...pts[2]);K.g.moveTo(...pts[1]);K.g.lineTo(...pts[3]);K.g.stroke();
    }
    K.box(.32,.42,-.42,-.32,1.5,Math.max(3,top*.45),trim);
  } else {
    K.box(-.4,.4,-.34,.34,0,top,col,{win});
  }

  // 精修層：在基本體塊之外補上樓板、金屬收邊、陽台與屋頂設備，讓輪廓不再像簡單方盒。
  if (arch === 'midrise') {
    for (let z = 9; z < top - 2; z += 10) {
      K.line(-.35,.314,z,.35,.314,z,'rgba(235,245,248,.48)',.7);
      K.line(.374,-.29,z,.374,.29,z,'rgba(235,245,248,.34)',.7);
    }
    K.line(-.34,.314,2,-.34,.314,top-1,'rgba(238,246,248,.35)',.8);
    K.line(.34,.314,2,.34,.314,top-1,'rgba(238,246,248,.35)',.8);
    if (d.cat === 'residential') {
      for (let z = 10; z < Math.min(top - 3, 43); z += 13) {
        K.box(-.29,.29,.29,.385,z,1,'#718991');
        K.line(-.28,.385,z+3,.28,.385,z+3,'#e4eeee',.8);
        for (const u of [-.25,0,.25]) K.line(u,.385,z+1,u,.385,z+3,'#dbe7e9',.55);
      }
    } else {
      K.box(-.13,.13,-.11,.11,top,Math.max(1.8,top*.055),dark);
      K.box(-.08,.08,-.07,.07,top+Math.max(1.8,top*.055),Math.max(1.5,top*.035),trim);
    }
  } else if (arch === 'tower') {
    for (let z = 10; z < Math.min(top * .47, 43); z += 13) {
      if (d.cat === 'residential') {
        K.box(-.30,.30,.30,.385,z,1,'#7b9298');
        K.line(-.29,.385,z+3,.29,.385,z+3,'#e8f1ef',.8);
        for (const u of [-.25,0,.25]) K.line(u,.385,z+1,u,.385,z+3,'#d7e5e6',.55);
      } else {
        K.line(-.35,.323,z,.35,.323,z,'rgba(242,248,249,.5)',.7);
        K.line(.392,-.29,z,.392,.29,z,'rgba(242,248,249,.34)',.7);
      }
    }
    K.box(-.13,.13,-.11,.11,top,Math.max(2,top*.045),trim);
  } else if (arch === 'glass') {
    for (const u of [-.27,-.09,.09,.27]) {
      K.line(u,.302,2,u,.302,top-1,'rgba(235,249,255,.56)',.8);
      K.line(.362,u,2,.362,u,top-1,'rgba(235,249,255,.36)',.75);
    }
    for (let z = 12; z < top - 2; z += 14) {
      K.line(-.33,.302,z,.33,.302,z,'rgba(222,244,251,.38)',.65);
      K.line(.362,-.27,z,.362,.27,z,'rgba(222,244,251,.3)',.65);
    }
    K.box(-.18,.18,-.15,.15,top,Math.max(2,top*.07),dark);
    K.line(-.16,0,top+Math.max(2,top*.07),.16,0,top+Math.max(2,top*.07),'#d7edf2',.7);
  } else if (arch === 'green') {
    for (let z = 10; z < top - 2; z += 12) {
      K.box(-.32,.32,.27,.355,z,1,'#6fae8a');
      K.line(-.30,.355,z+2.8,.30,.355,z+2.8,'#d8f0df',.65);
      K.tree(-.29,.32,z+1,1.8); K.tree(.29,.32,z+1,1.8);
    }
    K.box(-.37,.37,-.30,.30,top,1.6,'#7fbd8e');
  } else if (arch === 'civic') {
    for (const u of [-.34,.34]) K.line(u,.392,4,u,.392,Math.max(5,top*.67)+3,'rgba(249,244,229,.58)',1.1);
    K.box(-.12,.12,.36,.43,1,Math.max(2,top*.12),'#8b6b56');
  } else if (arch === 'market') {
    const bh = Math.max(5,top*.58);
    K.box(-.34,.34,.32,.415,bh*.43,1.1,'#d89c58',{top:'#f5cb83'});
    for (const u of [-.30,-.10,.10,.30]) K.line(u,.415,bh*.43+1.1,u,.415,bh*.43+4,'#f5e6cb',.75);
  } else if (arch === 'industrial') {
    const bh = Math.max(7,top*.52);
    K.line(-.40,.312,3,.19,.312,3,'rgba(228,237,239,.54)',.8);
    K.line(-.40,.312,bh*.50,.19,.312,bh*.50,'rgba(228,237,239,.36)',.65);
    K.box(-.10,.10,.31,.39,Math.max(3,bh*.22),Math.max(1.5,bh*.045),'#e3e8e9');
  } else if (arch === 'dome') {
    K.line(-.28,.342,4,.28,.342,4,'rgba(238,246,249,.42)',.65);
    for (const u of [-.24,-.08,.08,.24]) K.line(u,.342,5,u,.342,top*.53,'rgba(235,246,249,.45)',.65);
  } else if (arch === 'spire') {
    K.line(-.18,.242,top*.24,.18,.242,top*.24,'rgba(236,245,248,.56)',.8);
    K.dot(0,0,top+Math.max(6,top*.15),1.2,'#f7c96d');
  } else if (arch === 'cottage' || arch === 'villa' || arch === 'townhouse') {
    // 屋頂與門窗加一圈暖色收邊，近景時能看出木作或石材層次。
    K.line(-.31,.272,2,.31,.272,2,'rgba(255,246,224,.6)',.65);
    K.dot(.16,.285,Math.max(4,top*.22),1.05,'#f4d38d');
  }
}
function hashId(value) {
  let h=2166136261;
  for(const ch of String(value||'')) { h ^= ch.charCodeAt(0); h=Math.imul(h,16777619); }
  return h|0;
}

const scratch = document.createElement('canvas'); scratch.width = TW; scratch.height = 400;   // 先量出最高點的測量用畫布
function makeBlock(d, v) {
  const tall = (d.cat === 'residential' || d.cat === 'commercial') && d.h >= 14;
  const h = tall ? Math.round(d.h * [0.92, 1, 1.12][v]) : d.h;
  const shape = SHAPES[d.id] || SIGNATURE_SHAPES[d.id] || genericArchitecture;
  const probe = makeKit(scratch.getContext('2d'), TW / 2, 300, v);
  shape(probe, d, h);
  const top = Math.ceil(probe.maxZ);
  const c = document.createElement('canvas'); c.width = TW; c.height = TH + top + PAD;
  const K = makeKit(c.getContext('2d'), TW / 2, c.height - TH / 2, v);
  K.shadow(); K.landscape(d); shape(K, d, h);
  c.top = top; c.smokes = K.smokes; c.rotors = K.rotors;
  return c;
}
window.CityShapes = { makeBlock, shade };
})();
