// node server/storage-test.js — 用本機假的 Upstash REST 伺服器驗證雲端存檔（不連網路）
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { createStorage } = require('./storage');

(async () => {
  const db = new Map(); let fail = false;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', d => (body += d)); req.on('end', () => {
      if (req.headers.authorization !== 'Bearer tok123') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Unauthorized' })); }
      if (fail) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'boom' })); }
      const [c, k, v] = JSON.parse(body);
      if (c === 'SET') { db.set(k, v); return res.end(JSON.stringify({ result: 'OK' })); }
      if (c === 'GET') return res.end(JSON.stringify({ result: db.has(k) ? db.get(k) : null }));
      if (c === 'DEL') { let n = 0; for (const key of [k, v, ...JSON.parse(body).slice(3)]) if (key && db.delete(key)) n++; return res.end(JSON.stringify({ result: n })); }
      res.statusCode = 400; res.end(JSON.stringify({ error: 'bad cmd' }));
    });
  });
  await new Promise(r => srv.listen(0, r));
  const env = { UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${srv.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'tok123' };

  const st = createStorage(env);
  assert.strictEqual(st.kind, 'upstash');
  assert.strictEqual(await st.load(), null, '沒有存檔 → null（全新世界）');
  const world = { players: [{ id: 'a', name: '小明' }], chunks: [{ cx: 0, cy: 0 }] };
  await st.save(JSON.stringify(world));
  assert.deepStrictEqual(await st.load(), world, '雲端存檔往返（含中文）');
  const accounts = { alice: { username: 'Alice', salt: 's', hash: 'h', token: 't' } };
  await st.saveAccounts(JSON.stringify(accounts));
  assert.deepStrictEqual(await st.loadAccounts(), accounts, '雲端帳號存檔往返');
  await st.reset();
  assert.strictEqual(await st.load(), null, '重設後雲端世界存檔被清除');
  assert.deepStrictEqual(await st.loadAccounts(), {}, '重設後雲端帳號存檔被清除');
  await st.save(JSON.stringify(world));
  fail = true;
  await assert.rejects(() => st.load(), /boom/, '雲端壞掉時要丟錯，不能當成全新世界');
  fail = false;
  await assert.rejects(() => createStorage({ ...env, UPSTASH_REDIS_REST_TOKEN: 'bad' }).load(), /Unauthorized/, '金鑰錯誤要丟錯');
  assert(st.delayFor(0) >= 60000 && st.delayFor(1e6) > st.delayFor(1e5), '世界越大，存檔間隔越長');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  const legacy = path.join(dir, 'old-server-world.json');
  fs.writeFileSync(legacy, JSON.stringify({ players: [{ id: 'legacy' }] }));                  // 舊版放在 server\world.json 的存檔
  const fs1 = createStorage({ DATA_DIR: path.join(dir, 'data'), BACKUP_EVERY_MS: '0', BACKUP_KEEP: '3' }, undefined, legacy);
  assert.deepStrictEqual(await fs1.load(), { players: [{ id: 'legacy' }] }, '舊位置的存檔會自動搬到新位置');
  await fs1.saveAccounts(JSON.stringify({ bob: { username: 'Bob' } }));
  assert.deepStrictEqual(await fs1.loadAccounts(), { bob: { username: 'Bob' } }, '本機帳號存檔往返');
  fs.unlinkSync(fs1.file);
  assert.strictEqual(fs1.kind, 'file'); assert.strictEqual(await fs1.load(), null);
  assert(fs1.dir.startsWith(path.join(dir, 'data')), '存檔位置可用 DATA_DIR 指定');
  await fs1.save(JSON.stringify(world)); assert.deepStrictEqual(await fs1.load(), world, '檔案存檔往返');
  for (let i = 0; i < 6; i++) { await fs1.save(JSON.stringify({ v: i })); await new Promise(r => setTimeout(r, 5)); }
  const bk = fs.readdirSync(path.join(fs1.dir, 'backups')).filter(f => f.startsWith('world-'));
  assert.strictEqual(bk.length, 3, '備份只保留最近 3 份（這裡設定的上限），實際 ' + bk.length);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fs1.file, 'utf8')), { v: 5 }, '最新存檔是最後一次');
  fs.writeFileSync(fs1.file, '{壞掉的');
  assert.strictEqual(await fs1.load(), null, '存檔損毀 → 備份並從全新世界開始');
  assert(fs.readdirSync(fs1.dir).some(f => f.includes('corrupt')), '損毀的存檔有備份');
  assert(/city-mmo-data/.test(require('./storage').dataDir({})), '預設存檔位置在使用者資料夾的 city-mmo-data（專案資料夾外面）');

  srv.close(); console.log('storage tests passed');
})().catch(e => { console.error(e); process.exit(1); });
