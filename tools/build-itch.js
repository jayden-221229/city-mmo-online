// 把遊戲「畫面」打包成 itch.io 可上傳的 zip（不需要安裝任何套件）。
// 用法：node tools/build-itch.js https://你的遊戲伺服器網址
// 伺服器必須另外放在可連線的主機上（itch.io 只能放網頁檔案，不能執行 Node.js）。
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const server = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+/.test(server)) {
  console.error('請提供遊戲伺服器的 https 網址，例如：\n  node tools/build-itch.js https://my-city.onrender.com\n（itch.io 是 https 頁面，瀏覽器不允許它連 http 伺服器）');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p));
const files = [];                                                       // [zip 內路徑, 內容]
files.push(['index.html', read('index.html')]);
files.push(['assets/js/config.js', Buffer.from(`window.GAME_SERVER = ${JSON.stringify(server)};\n`)]);
(function walk(dir, rel) {                                              // 將 CSS、前端 JS、共用資料及美術圖一併收進 assets
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (e.isDirectory()) walk(dir + '/' + e.name, rel + '/' + e.name);
    else if (!e.name.startsWith('.') && rel + '/' + e.name !== 'assets/js/config.js') files.push([rel + '/' + e.name, read(dir + '/' + e.name)]);
  }
})('assets', 'assets');

// ── 極簡 zip 寫入器（deflate），避免依賴任何套件 ──
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(entries) {
  const out = [], central = []; let offset = 0;
  for (const [name, data] of entries) {
    const nm = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt16LE(0x21, 12); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(nm.length, 26);
    out.push(loc, nm, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nm.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, cd, end]);
}
const outFile = path.join(root, 'city-mmo-itch.zip');
fs.writeFileSync(outFile, makeZip(files));
console.log(`已產生 ${outFile}\n共 ${files.length} 個檔案，index.html 在 zip 最外層；遊戲伺服器：${server}`);
console.log('下一步：到 itch.io 建立專案（Kind of project 選 HTML），上傳這個 zip 並勾選「在瀏覽器中執行」。');
