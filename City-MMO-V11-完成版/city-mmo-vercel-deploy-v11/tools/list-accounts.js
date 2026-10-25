// 列出存檔裡所有帳號與「帳號代碼」，用來找回遺失的城市。
// 用法：node tools/list-accounts.js            （自動尋找存檔）
//       node tools/list-accounts.js 某個存檔.json （指定檔案，例如 backups 裡的備份）
const fs = require('fs'), path = require('path');
const { dataFile } = require('../server/storage');

const candidates = process.argv[2] ? [process.argv[2]] : [dataFile(process.env), path.join(__dirname, '../server/world.json')];
const file = candidates.find(f => fs.existsSync(f));
if (!file) { console.error('找不到存檔。找過這些位置：\n  ' + candidates.join('\n  ')); process.exit(1); }
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const land = {};
for (const c of j.chunks) land[c.owner] = (land[c.owner] || 0) + 1;
const rows = j.players.map(p => ({ 城市名稱: p.name, 帳號代碼: p.token, 領地: land[p.id] || 0, 最高人口: Math.floor(p.peakPop || 0), 資金: Math.floor(p.money) }))
  .sort((a, b) => b.最高人口 - a.最高人口 || b.領地 - a.領地);
console.log('存檔：' + file + '\n共 ' + rows.length + ' 個帳號（帳號代碼等同密碼，請不要公開）：');
console.table(rows);
console.log('找回方法：進遊戲 → 左上角「帳號」按鈕 → 把該行的帳號代碼貼上 → 確定。');
