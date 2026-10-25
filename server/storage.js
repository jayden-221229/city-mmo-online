// 世界與帳號存檔的儲存位置：
//   1. 設了 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN → 世界與帳號都存到 Upstash，適合沒有持久磁碟的主機。
//   2. 否則存成本機檔案：預設放在「使用者資料夾\city-mmo-data」內（專案資料夾外面！
//      這樣換新版、刪掉或重新解壓縮專案資料夾，都不會弄丟紀錄）。可用環境變數 DATA_DIR 指定別的位置。
//      同一個資料夾的 backups\ 會自動保留最近的備份。
// 不依賴任何套件：雲端版直接用 Node 內建的 fetch 呼叫 Upstash 的 REST API。
const fs = require('fs'), path = require('path'), os = require('os');

const dataDir = (env = process.env) => env.DATA_DIR || path.join(os.homedir(), 'city-mmo-data');
const dataFile = (env = process.env) => path.join(dataDir(env), 'world.json');

function createStorage(env = process.env, fetchFn = globalThis.fetch, legacyFile = path.join(__dirname, 'world.json')) {
  const url = env.UPSTASH_REDIS_REST_URL || env.mmo_KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.mmo_KV_REST_API_TOKEN;
  // Vercel 的函式檔案系統不可當永久存檔；未設 Upstash 時回傳明確錯誤後端，避免啟動時嘗試建立本機資料夾。
  if (env.VERCEL && !(url && token)) {
    const missing = () => Promise.reject(new Error('Vercel 部署必須設定 UPSTASH_REDIS_REST_URL 與 UPSTASH_REDIS_REST_TOKEN。'));
    return { kind: 'missing-upstash', async reset() { return missing(); }, async load() { return missing(); }, async save() { return missing(); }, async loadAccounts() { return missing(); }, async saveAccounts() { return missing(); }, delayFor() { return 60000; } };
  }
  if (url && token) {
    const key = env.SAVE_KEY || 'city-mmo:world';
    const accountsKey = env.ACCOUNTS_KEY || 'city-mmo:accounts';
    const cmd = async arr => {                                  // Upstash REST：POST 一個 JSON 陣列 = 一個 Redis 指令
      const r = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      return j.result;
    };
    return {
      kind: 'upstash',
      async reset() { await cmd(['DEL', key, accountsKey]); },
      async load() { const s = await cmd(['GET', key]); if (s) return JSON.parse(s); const seedFile = path.join(__dirname, 'restore-seed-world.json'); if (fs.existsSync(seedFile)) { const seed = await fs.promises.readFile(seedFile, 'utf8'); await cmd(['SET', key, seed]); return JSON.parse(seed); } return null; },   // 只在雲端世界鍵為空時匯入附帶的舊存檔；絕不覆蓋既有 Redis 世界
      async save(str) { await cmd(['SET', key, str]); },
      async loadAccounts() { const s = await cmd(['GET', accountsKey]); return s ? JSON.parse(s) : {}; },
      async saveAccounts(str) { await cmd(['SET', accountsKey, str]); },
      // 免費額度：每月 500K 指令、10GB 頻寬 → 至少每 60 秒存一次，世界越大間隔越長（約每秒 1.9KB 以內）
      delayFor(size) { return Math.max(60000, Math.ceil(size / 1900) * 1000); },
    };
  }
  const dir = dataDir(env), file = path.join(dir, 'world.json'), accountsFile = path.join(dir, 'accounts.json'), bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  if (!fs.existsSync(file) && legacyFile && fs.existsSync(legacyFile)) {   // 舊版把存檔放在 server\world.json：搬到新位置
    fs.copyFileSync(legacyFile, file); console.log('已把舊存檔搬到新位置：', file);
  }
  const backupEvery = env.BACKUP_EVERY_MS != null ? Number(env.BACKUP_EVERY_MS) : 10 * 60 * 1000, keep = Number(env.BACKUP_KEEP || 24);
  let lastBackup = 0;
  async function backup() {                                     // 覆蓋存檔前，先把「目前這份好的存檔」備份起來（每 10 分鐘一份，保留最近 24 份）
    if (Date.now() - lastBackup < backupEvery || !fs.existsSync(file)) return;
    lastBackup = Date.now();
    await fs.promises.copyFile(file, path.join(bdir, `world-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const all = (await fs.promises.readdir(bdir)).filter(f => /^world-.*\.json$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - keep))) await fs.promises.unlink(path.join(bdir, f)).catch(() => {});
  }
  return {
    kind: 'file', file, dir, accountsFile,
    async reset() {
      // One-time hard reset: remove the active save, temporary save, backups,
      // and legacy project save so it cannot be migrated back on next start.
      await fs.promises.rm(file, { force: true });
      await fs.promises.rm(file + '.tmp', { force: true });
      await fs.promises.rm(accountsFile, { force: true });
      await fs.promises.rm(accountsFile + '.tmp', { force: true });
      await fs.promises.rm(bdir, { recursive: true, force: true });
      await fs.promises.mkdir(bdir, { recursive: true });
      if (legacyFile) await fs.promises.rm(legacyFile, { force: true });
    },
    async loadAccounts() {
      let text;
      try { text = await fs.promises.readFile(accountsFile, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
      return JSON.parse(text);
    },
    async saveAccounts(str) {
      const tmp = accountsFile + '.tmp';
      await fs.promises.writeFile(tmp, str, { mode: 0o600 });
      await fs.promises.rename(tmp, accountsFile);
    },
    async load() {
      let text;
      try { text = await fs.promises.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      try { return JSON.parse(text); } catch (e) {                // 存檔損毀：備份起來，從全新世界開始，而不是讓伺服器卡死
        const bak = file.replace(/\.json$/, '') + '.corrupt-' + Date.now() + '.json';
        await fs.promises.rename(file, bak); console.error('存檔損毀，已備份為', bak); return null;
      }
    },
    async save(str) {
      await backup();
      await fs.promises.writeFile(file + '.tmp', str); await fs.promises.rename(file + '.tmp', file);      // 先寫暫存再換名，避免寫到一半斷電
    },
    delayFor() { return 30000; },
  };
}
module.exports = { createStorage, dataDir, dataFile };
