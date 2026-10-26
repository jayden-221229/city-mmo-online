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
    if (edge) { g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.22)'; g.stroke(); }
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

  K.windows = (u0, u1, w0, w1, z0, hh, o = {}) => {          // 兩個可見牆面上的窗戶（斜切變換後畫矩形）
    const gx = o.gx || 8, gy = o.gy || 7, ww = o.ww || 4, wh = o.wh || 3, lit = o.lit || LIT;
    const faces = [[P(u0, w1, z0 + hh), (u1 - u0) * 32, 0.5], [P(u1, w1, z0 + hh), (w1 - w0) * 32, -0.5]];
    for (const [[x, y], wd, sk] of faces) {
      g.save(); g.transform(1, sk, 0, 1, x, y);
      for (let yy = (o.top == null ? 4 : o.top) + v; yy < hh - (o.bot == null ? 3 : o.bot); yy += gy)
        for (let xx = 4; xx < wd - 5; xx += gx) { g.fillStyle = (xx + yy * 3 + v) % 5 === 0 ? 'rgba(40,50,70,.5)' : lit; g.fillRect(xx, yy, ww, wh); }
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
  const shape = SHAPES[d.id] || genericArchitecture;
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
