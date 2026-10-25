// 社交與導覽介面：聊天、排行榜、全服小地圖、新手目標。透過 window.CityGame 取得遊戲狀態。
(() => {
'use strict';
const G = window.CityGame;
const { socket, players, links, hooks, view, C, B } = G;
const $ = id => document.getElementById(id);
const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

// ───────────── 全服領地（小地圖資料）─────────────
let worldChunks = [];
socket.on('world', p => { worldChunks = p.chunks; p.players.forEach(pl => players.set(pl.id, pl)); });

// ───────────── 小地圖：以目前畫面中心為中心，等角方向與主畫面一致，點擊即傳送 ─────────────
const mm = $('minimap'), mg = mm.getContext('2d'), MW = 200, MA = 8, MB = 4;      // 一個 chunk = 16×8 的菱形
let gcx = 0, gcy = 0, lastMini = 0;
const px = (u, v) => MW / 2 + (u - v) * MA, py = (u, v) => MW / 2 + (u + v) * MB;
function diamond(cx, cy, w = 1, h = 1) {
  const u = cx - gcx, v = cy - gcy;
  mg.beginPath(); mg.moveTo(px(u, v), py(u, v)); mg.lineTo(px(u + w, v), py(u + w, v));
  mg.lineTo(px(u + w, v + h), py(u + w, v + h)); mg.lineTo(px(u, v + h), py(u, v + h)); mg.closePath();
}
function drawMini(now) {
  const me = G.getMe();
  if (!me || now - lastMini < 100) return;
  lastMini = now;
  const [gx, gy] = G.toGrid(innerWidth / 2, innerHeight / 2);
  gcx = gx / C; gcy = gy / C;
  mg.setTransform(1, 0, 0, 1, 0, 0); mg.fillStyle = '#0e1a21'; mg.fillRect(0, 0, MW, MW);
  for (const [cx, cy, o] of worldChunks) {
    if (Math.abs(cx - gcx - (cy - gcy)) > 14 || Math.abs(cx - gcx + (cy - gcy)) > 28) continue;
    diamond(cx, cy); mg.fillStyle = (players.get(o) || {}).color || '#888'; mg.fill();
    mg.lineWidth = o === me.id ? 2 : 1; mg.strokeStyle = o === me.id ? '#ffd27a' : 'rgba(255,255,255,.35)'; mg.stroke();
  }
  diamond(view.cx0, view.cy0, view.cx1 - view.cx0 + 1, view.cy1 - view.cy0 + 1);   // 目前視野
  mg.lineWidth = 1.5; mg.strokeStyle = '#ffffff'; mg.stroke();
}
hooks.push(drawMini);
mm.addEventListener('pointerdown', e => {
  const r = mm.getBoundingClientRect();
  const dx = (e.clientX - r.left) * MW / r.width - MW / 2, dy = (e.clientY - r.top) * MW / r.height - MW / 2;
  G.jumpTo((gcx + (dy / MB + dx / MA) / 2) * C, (gcy + (dy / MB - dx / MA) / 2) * C);
});

// ───────────── 聊天 / 排行榜 ─────────────
const log = $('chatLog'), input = $('chatIn');
function addMsg(m) {
  const row = mk('div', null, m.sys ? 'msg sys' : 'msg');
  if (!m.sys) { const n = mk('b', m.name + '：'); n.style.color = m.color; row.appendChild(n); }
  row.appendChild(mk('span', m.text));
  log.appendChild(row);
  if (log.children.length > 80) log.children[0].remove();
  log.scrollTop = log.scrollHeight;
}
socket.on('chatlog', arr => { log.innerHTML = ''; arr.forEach(addMsg); });
socket.on('chat', addMsg);
input.addEventListener('keydown', e => {
  e.stopPropagation();                                                            // 打字時不觸發遊戲快捷鍵
  if (e.key !== 'Enter' || !input.value.trim()) return;
  socket.emit('chat', { text: input.value }, r => { if (r && r.err) G.toast('發言太快了，請稍等', true); });
  input.value = '';
});
function showPane(name) {
  const names = ['Chat', 'Board', 'Alliance', 'Ach'];
  for (const k of names) {
    const paneId = k === 'Alliance' ? 'alliancePane' : k.toLowerCase() + 'Pane';
    const tabId = k === 'Alliance' ? 'tabAlliance' : 'tab' + k;
    const pane = $(paneId), tab = $(tabId);
    if (pane) pane.style.display = k === name ? 'flex' : 'none';
    if (tab) tab.className = k === name ? 'on' : '';
  }
}

// 外交中心使用現有社交面板與 Socket.IO 事件，不載入外部程式或服務。
const socialTabs = document.querySelector('#social .tabs2');
const allianceTab = mk('button', '外交'); allianceTab.id = 'tabAlliance'; allianceTab.type = 'button';
socialTabs.insertBefore(allianceTab, $('tabAch'));
const alliancePane = mk('div', null, 'alliance-pane'); alliancePane.id = 'alliancePane';
alliancePane.style.display = 'none';
const allianceHead = mk('div', null, 'alliance-head');
allianceHead.appendChild(mk('div', '外交中心', 'alliance-title'));
allianceHead.appendChild(mk('div', '結盟後可互通道路、共享剩餘水電；盟友間也能互贈資金。', 'alliance-note'));
const allianceStats = mk('div', null, 'alliance-stats');
const statAlly = mk('div', null, 'alliance-stat'); statAlly.append(mk('small', '盟友'), mk('b', '0'));
const statIn = mk('div', null, 'alliance-stat'); statIn.append(mk('small', '收到邀請'), mk('b', '0'));
const statOut = mk('div', null, 'alliance-stat'); statOut.append(mk('small', '已送邀請'), mk('b', '0'));
allianceStats.append(statAlly, statIn, statOut); allianceHead.appendChild(allianceStats);
alliancePane.appendChild(allianceHead);
const allianceScroll = mk('div', null, 'alliance-scroll');
function makeAllianceSection(title, listId) {
  const section = mk('section', null, 'alliance-section');
  const heading = mk('h4', title, 'alliance-section-title');
  const list = mk('div', null, 'alliance-list'); list.id = listId;
  section.append(heading, list); allianceScroll.appendChild(section); return list;
}
const incomingList = makeAllianceSection('收到的邀請', 'allianceIncoming');
const outgoingList = makeAllianceSection('已送出的邀請', 'allianceOutgoing');
const alliesList = makeAllianceSection('我的盟友', 'allianceMembers');
const playerSection = mk('section', null, 'alliance-section');
const playerTitle = mk('h4', '尋找玩家', 'alliance-section-title');
const playerSearch = document.createElement('input'); playerSearch.id = 'allianceSearch'; playerSearch.type = 'search';
playerSearch.maxLength = 40; playerSearch.placeholder = '搜尋玩家名稱…'; playerSearch.autocomplete = 'off';
playerSearch.setAttribute('aria-label', '搜尋玩家名稱'); playerSearch.className = 'alliance-search';
const playerResults = mk('div', null, 'alliance-list'); playerResults.id = 'alliancePlayers';
playerSection.append(playerTitle, playerSearch, playerResults); allianceScroll.appendChild(playerSection);
alliancePane.appendChild(allianceScroll);
$('boardPane').parentNode.insertBefore(alliancePane, $('achPane'));
const allianceStyle = document.createElement('style');
allianceStyle.textContent = `
  #social .tabs2 button.on{background:rgba(97,215,205,.16);border-color:rgba(97,215,205,.42);color:#c8fff5}
  #alliancePane{flex:1;min-height:0;flex-direction:column;gap:7px;font-size:12px}
  .alliance-head{flex:0 0 auto;padding:2px 1px}
  .alliance-title{font-size:14px;font-weight:850;letter-spacing:.02em;color:#c8fff5}
  .alliance-note{font-size:11px;line-height:1.4;color:#9bb8c5;margin:3px 0 7px}
  .alliance-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
  .alliance-stat{border:1px solid rgba(150,194,211,.18);background:rgba(255,255,255,.035);border-radius:9px;padding:5px 7px;display:flex;align-items:center;justify-content:space-between;gap:4px}
  .alliance-stat small{color:#9bb8c5;font-size:10px}.alliance-stat b{font-size:14px;color:#edf7fb}
  .alliance-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 2px 3px 0;scrollbar-width:thin;scrollbar-color:#34596a transparent}
  .alliance-section{padding:6px 0;border-top:1px solid rgba(150,194,211,.16)}
  .alliance-section-title{margin:0 0 5px;color:#61d7cd;font-size:11px;font-weight:850;letter-spacing:.04em}
  .alliance-list{display:flex;flex-direction:column;gap:5px}
  .alliance-card{border:1px solid rgba(150,194,211,.16);background:rgba(4,17,25,.32);border-radius:9px;padding:7px}
  .alliance-card-top{display:flex;align-items:center;gap:7px;min-width:0}
  .alliance-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
  .alliance-name{font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .alliance-meta{font-size:10px;color:#9bb8c5;white-space:nowrap}
  .alliance-actions{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:6px}
  .alliance-actions button{font-size:11px;padding:4px 7px}
  .alliance-actions button.primary{background:rgba(97,215,205,.18);border-color:rgba(97,215,205,.48);color:#c8fff5}
  .alliance-actions button.danger{border-color:rgba(255,130,124,.42);color:#ffaaa5}
  .alliance-actions button:disabled{opacity:.45;cursor:default}
  .alliance-amount{width:75px;min-width:65px;padding:5px 6px;border:1px solid rgba(150,194,211,.28);border-radius:7px;background:#081a24;color:#edf7fb;font:inherit}
  .alliance-search{width:100%;padding:7px 9px;border:1px solid rgba(150,194,211,.3);border-radius:8px;background:#081a24;color:#edf7fb;margin:0 0 6px;font:inherit}
  .alliance-empty{color:#9bb8c5;font-size:11px;padding:7px 3px}
  #mobileSocialToggle{display:none}
  @media(max-width:960px){#mobileSocialToggle{display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;font-size:11px}#social.mobile-social-open{display:flex!important;left:10px;right:10px;bottom:150px;width:auto;height:min(43vh,370px);z-index:30}}`;
document.head.appendChild(allianceStyle);
allianceTab.onclick = () => showPane('Alliance');
$('tabChat').onclick = () => showPane('Chat');
$('tabBoard').onclick = () => showPane('Board');
$('tabAch').onclick = () => showPane('Ach');

const mobileSocialToggle = mk('button', '社交', ''); mobileSocialToggle.id = 'mobileSocialToggle'; mobileSocialToggle.type = 'button';
mobileSocialToggle.title = '開啟聊天、排行榜與外交中心'; $('hud').insertBefore(mobileSocialToggle, $('acct'));
mobileSocialToggle.addEventListener('click', () => {
  // If this panel was hidden by the new fold controls, restore it before opening/closing the mobile panel.
  if (window.CityUIFolds && typeof window.CityUIFolds.setPanel === 'function') window.CityUIFolds.setPanel('social', false);
  const panel = $('social');
  if (panel.classList.contains('mobile-social-open')) {
    panel.classList.remove('mobile-social-open'); panel.style.display = '';
    return;
  }
  panel.classList.add('mobile-social-open'); panel.style.display = 'flex';
  showPane('Alliance');
});
window.addEventListener('resize', () => {
  if (innerWidth > 960) { $('social').classList.remove('mobile-social-open'); $('social').style.display = ''; }
  else if (!$('social').classList.contains('mobile-social-open')) $('social').style.display = '';
});

// 排行榜、盟友、邀請都使用玩家 ID 作為識別，名稱僅用於顯示與搜尋。
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const DIPLO_ERR = {
  already_linked: '你們已經是盟友', already_pending: '已有結盟邀請正在等待回應',
  no_pending: '這份邀請已不存在', no_request: '這份邀請已失效', bad_request: '無法執行此操作',
  rate_limit: '操作太快了，請稍後再試', not_linked: '你們目前不是盟友', money: '資金不足',
  no_login: '請先登入', server_error: '伺服器發生錯誤'
};
let lastRows = [];
const incomingPending = new Map(), outgoingPending = new Map();
function playerName(id, fallback) {
  const p = players.get(id);
  const r = lastRows.find(row => row.id === id);
  return (p && p.name) || (r && r.name) || fallback || ('城市 ' + String(id).slice(0, 6));
}
function playerColor(id) { return (players.get(id) || lastRows.find(row => row.id === id) || {}).color || '#61d7cd'; }
function showError(res, fallback) { G.toast(DIPLO_ERR[res && res.err] || (res && res.err) || fallback || '操作失敗，請稍後再試。', true); }
function setEmpty(list, text) { list.appendChild(mk('div', text, 'alliance-empty')); }
function allianceCard(name, color, meta) {
  const card = mk('div', null, 'alliance-card');
  const top = mk('div', null, 'alliance-card-top');
  const dot = mk('i', null, 'alliance-dot'); dot.style.background = color || '#61d7cd';
  top.append(dot, mk('span', name, 'alliance-name'));
  if (meta) top.appendChild(mk('span', meta, 'alliance-meta'));
  card.appendChild(top);
  const actions = mk('div', null, 'alliance-actions'); card.appendChild(actions);
  return { card, actions };
}
function visitPlayer(id) {
  const r = lastRows.find(row => row.id === id);
  const home = r && Array.isArray(r.home) ? r.home : (worldChunks.find(chunk => chunk[2] === id) || []).slice(0, 2);
  if (!home || home.length < 2) { G.toast('目前沒有這位玩家的城市位置資料。', true); return; }
  G.jumpTo((home[0] + 0.5) * C, (home[1] + 0.5) * C);
}
function requestAlliance(id, name) {
  if (!id || (G.getMe() && id === G.getMe().id)) return;
  socket.emit('diplo:request', { to: id }, res => {
    if (res && res.ok) {
      outgoingPending.set(id, { to: id, toName: name || playerName(id) });
      renderAlliance(); renderBoard();
      G.toast('已向 ' + (name || playerName(id)) + ' 送出結盟邀請。');
    } else showError(res, '送出邀請失敗');
  });
}
function cancelAlliance(id) {
  socket.emit('diplo:cancel', { to: id }, res => {
    if (res && res.ok) {
      outgoingPending.delete(id); renderAlliance(); renderBoard();
      G.toast('已撤回結盟邀請。');
    } else showError(res, '撤回邀請失敗');
  });
}
function respondAlliance(from, accept) {
  socket.emit('diplo:respond', { from, accept: !!accept }, res => {
    if (res && res.ok) {
      incomingPending.delete(from);
      if (accept) links.add(pairKey(from, G.getMe().id));
      if (G.clearDiplomacyRequest) G.clearDiplomacyRequest(from);
      renderAlliance(); renderBoard();
      G.toast(accept ? '結盟成功：道路互通，剩餘水電共享。' : '已拒絕這份結盟邀請。');
    } else showError(res, '回覆邀請失敗');
  });
}
function unlinkAlliance(id) {
  if (!confirm('確定解除與「' + playerName(id) + '」的結盟嗎？解除後將停止道路互通與水電共享。')) return;
  socket.emit('diplo:unlink', { to: id }, res => {
    if (res && res.ok) {
      links.delete(pairKey(G.getMe().id, id)); renderAlliance(); renderBoard();
      G.toast('已解除結盟。');
    } else showError(res, '解除結盟失敗');
  });
}
function giftAlliance(id, amountInput) {
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 100000) {
    G.toast('贈款金額需為 $10 至 $100,000 的整數。', true); amountInput.focus(); return;
  }
  socket.emit('gift', { to: id, amount }, res => {
    if (res && res.ok) G.toast('已贈送 $' + amount.toLocaleString() + ' 給 ' + playerName(id) + '。');
    else showError(res, '贈款失敗');
  });
}
function renderAllianceSearch() {
  const me = G.getMe(), el = $('alliancePlayers'); if (!el) return;
  el.innerHTML = '';
  if (!me) { setEmpty(el, '登入後即可管理外交關係。'); return; }
  const term = playerSearch.value.trim().toLocaleLowerCase();
  const ranked = new Map(lastRows.map(row => [row.id, row]));
  const candidates = [...players.values()].filter(p => p.id !== me.id && !links.has(pairKey(me.id, p.id)))
    .filter(p => !term || String(p.name || '').toLocaleLowerCase().includes(term))
    .map(p => ({ ...p, row: ranked.get(p.id) }))
    .sort((a, b) => Number(!!b.row?.online) - Number(!!a.row?.online) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 12);
  if (!candidates.length) { setEmpty(el, term ? '沒有符合的玩家。' : '目前沒有其他可顯示的玩家。'); return; }
  for (const r of candidates) {
    const out = outgoingPending.has(r.id), inc = incomingPending.has(r.id);
    const item = allianceCard(r.name, r.color, r.row ? (r.row.online ? '線上' : '離線') : '玩家');
    item.actions.appendChild((() => { const b = mk('button', '前往'); b.onclick = () => visitPlayer(r.id); return b; })());
    if (out) {
      const b = mk('button', '撤回邀請', 'danger'); b.onclick = () => cancelAlliance(r.id); item.actions.appendChild(b);
    } else if (inc) {
      const b = mk('button', '回覆邀請', 'primary'); b.onclick = () => showPane('Alliance'); item.actions.appendChild(b);
    } else {
      const b = mk('button', '邀請結盟', 'primary'); b.onclick = () => requestAlliance(r.id, r.name); item.actions.appendChild(b);
    }
    el.appendChild(item.card);
  }
}
function renderAlliance() {
  const me = G.getMe(); if (!me) return;
  statAlly.querySelector('b').textContent = String([...links].filter(k => k.split('|').includes(me.id)).length);
  statIn.querySelector('b').textContent = String(incomingPending.size);
  statOut.querySelector('b').textContent = String(outgoingPending.size);

  incomingList.innerHTML = '';
  if (!incomingPending.size) setEmpty(incomingList, '沒有待處理的邀請。');
  for (const [from, request] of incomingPending) {
    const name = request.fromName || playerName(from);
    const item = allianceCard(name, playerColor(from), '等待你回覆');
    const yes = mk('button', '接受', 'primary'); yes.onclick = () => { yes.disabled = true; respondAlliance(from, true); };
    const no = mk('button', '拒絕', 'danger'); no.onclick = () => { no.disabled = true; respondAlliance(from, false); };
    item.actions.append(yes, no); incomingList.appendChild(item.card);
  }

  outgoingList.innerHTML = '';
  if (!outgoingPending.size) setEmpty(outgoingList, '沒有等待中的邀請。');
  for (const [to, request] of outgoingPending) {
    const item = allianceCard(request.toName || playerName(to), playerColor(to), '等待對方回覆');
    const go = mk('button', '前往'); go.onclick = () => visitPlayer(to);
    const cancel = mk('button', '撤回邀請', 'danger'); cancel.onclick = () => { cancel.disabled = true; cancelAlliance(to); };
    item.actions.append(go, cancel); outgoingList.appendChild(item.card);
  }

  alliesList.innerHTML = '';
  const allyIds = [...links].map(k => k.split('|')).filter(pair => pair.includes(me.id)).map(pair => pair.find(id => id !== me.id)).filter(Boolean);
  if (!allyIds.length) setEmpty(alliesList, '還沒有盟友。可在下方搜尋玩家並送出邀請。');
  for (const id of allyIds) {
    const row = lastRows.find(r => r.id === id);
    const item = allianceCard(playerName(id), playerColor(id), row ? (row.online ? '線上' : '離線') : '盟友');
    const go = mk('button', '前往'); go.onclick = () => visitPlayer(id);
    const amount = document.createElement('input'); amount.type = 'number'; amount.min = '10'; amount.max = '100000'; amount.step = '10'; amount.value = '100'; amount.className = 'alliance-amount'; amount.setAttribute('aria-label', '贈送資金金額');
    const gift = mk('button', '贈款'); gift.onclick = () => giftAlliance(id, amount);
    const unlink = mk('button', '解除結盟', 'danger'); unlink.onclick = () => unlinkAlliance(id);
    item.actions.append(go, amount, gift, unlink); alliesList.appendChild(item.card);
  }
  renderAllianceSearch();
}
function renderBoard() {
  const me = G.getMe(), el = $('boardList');
  el.innerHTML = '';
  lastRows.forEach((r, i) => {
    const mine = !!me && r.id === me.id, ally = !!me && links.has(pairKey(me.id, r.id));
    const row = mk('div', null, 'brow' + (r.online ? '' : ' off')), top = mk('div', null, 'btop');
    const dot = mk('i'); dot.style.background = r.color;
    top.append(mk('span', String(i + 1)), dot, mk('span', r.name + (mine ? '（你）' : '') + (ally ? ' 🤝' : ''), 'bname'));
    if (!mine) {
      const go = mk('button', '前往'); go.onclick = () => visitPlayer(r.id);
      top.appendChild(go);
      if (ally) {
        const al = mk('button', '解除'); al.onclick = () => unlinkAlliance(r.id); top.appendChild(al);
      } else if (outgoingPending.has(r.id)) {
        const al = mk('button', '撤回邀請'); al.onclick = () => cancelAlliance(r.id); top.appendChild(al);
      } else if (incomingPending.has(r.id)) {
        const al = mk('button', '回覆邀請'); al.onclick = () => showPane('Alliance'); top.appendChild(al);
      } else {
        const al = mk('button', '邀請結盟'); al.onclick = () => requestAlliance(r.id, r.name); top.appendChild(al);
      }
    }
    row.append(top, mk('small', `人口 ${r.pop} · ${r.chunks} 塊領地${r.online ? '' : ' · 離線'}`));
    el.appendChild(row);
  });
}
playerSearch.addEventListener('input', renderAllianceSearch);
socket.on('board', rows => { lastRows = rows; renderBoard(); renderAlliance(); });
socket.on('world', () => { renderBoard(); renderAlliance(); });
socket.on('diplo:incoming', r => { incomingPending.set(r.from, { from: r.from, fromName: r.fromName }); renderBoard(); renderAlliance(); });
socket.on('diplo:outgoing', r => { outgoingPending.set(r.to, { to: r.to, toName: r.toName }); renderBoard(); renderAlliance(); });
socket.on('diplo:outgoing-cancelled', r => { outgoingPending.delete(r.to); renderBoard(); renderAlliance(); });
socket.on('diplo:cancelled', r => {
  incomingPending.delete(r.from);
  if (G.clearDiplomacyRequest) G.clearDiplomacyRequest(r.from);
  renderBoard(); renderAlliance();
});
socket.on('diplo:responded', r => {
  const me = G.getMe();
  if (me && me.id === r.to) incomingPending.delete(r.from);
  if (me && me.id === r.from) outgoingPending.delete(r.to);
  if (r.accepted) { links.add(pairKey(r.from, r.to)); incomingPending.delete(r.from); outgoingPending.delete(r.to); }
  renderBoard(); renderAlliance();
});
socket.on('diplo:linked', ({ a, b }) => {
  links.add(pairKey(a, b)); incomingPending.delete(a); incomingPending.delete(b); outgoingPending.delete(a); outgoingPending.delete(b);
  renderBoard(); renderAlliance();
});
socket.on('diplo:unlinked', ({ a, b }) => { links.delete(pairKey(a, b)); renderBoard(); renderAlliance(); });
socket.on('diplo:denied', r => {
  const me = G.getMe();
  if (me && r.from === me.id) outgoingPending.delete(r.to);
  renderBoard(); renderAlliance();
});
G.diplomacyInit = (incoming, outgoing) => {
  incomingPending.clear(); outgoingPending.clear();
  for (const r of incoming || []) incomingPending.set(r.from, r);
  for (const r of outgoing || []) outgoingPending.set(r.to, r);
  renderBoard(); renderAlliance();
};
G.diplomacyIncoming = (from, fromName) => { incomingPending.set(from, { from, fromName }); renderBoard(); renderAlliance(); };
G.diplomacyResponded = (from, accepted) => {
  incomingPending.delete(from);
  if (accepted && G.getMe()) links.add(pairKey(from, G.getMe().id));
  renderBoard(); renderAlliance();
};
showPane('Chat');

// ───────────── 成就 / 升級 / 每日獎勵通知 ─────────────
let lastAch = null;
function renderAch(s) {
  const key = (s.ach || []).join();
  if (!s.ach || key === lastAch) return;
  lastAch = key;
  const el = $('achList'), done = new Set(s.ach), all = GameData.ACHIEVEMENTS;
  el.innerHTML = '';
  el.appendChild(mk('div', `已完成 ${done.size} / ${all.length}`, 'ahead'));
  for (const a of all) {
    const row = mk('div', null, 'arow' + (done.has(a.id) ? ' done' : ''));
    row.append(mk('b', (done.has(a.id) ? '🏆 ' : '🔒 ') + a.name), mk('small', a.desc + '　獎金 $' + a.reward.toLocaleString()));
    el.appendChild(row);
  }
}
socket.on('ach', ev => { G.sfx('ach'); G.toast(`🏆 成就達成：${ev.name}　+$${ev.reward.toLocaleString()}`, false, 5000); });
socket.on('level', ev => {
  const at = GameData.LEVELS[ev.lvl].at, names = Object.values(B).filter(d => d.unlock === at).map(d => d.name).join('、');
  G.sfx('level');
  G.toast(`🎉 城市升級為「${ev.name}」！${names ? '解鎖：' + names : ''}`, false, 8000);
});
socket.on('toast', ev => { G.sfx('coin'); G.toast(ev.text, false, 5000); });

// ───────────── 新手目標 ─────────────
const QUESTS = [
  { text: '蓋 3 間住宅（要緊鄰道路）', done: c => c.residential >= 3 },
  { text: '蓋 1 間商鋪來賺錢', done: c => c.commercial >= 1 },
  { text: '蓋一座發電廠或太陽能板', done: c => c.power >= 1 },
  { text: '擴張到 2 塊領地', done: () => G.getStats().chunks >= 2 },
  { text: '與鄰居結盟', done: () => { const me = G.getMe(); return !!me && [...links].some(l => l.split('|').includes(me.id)); } },
  { text: '人口達到 100', done: () => G.getStats().pop >= 100 },
];
function updateQuests() {
  const me = G.getMe(); if (!me) return;
  const cnt = { residential: 0, commercial: 0, power: 0 };
  for (const ch of G.chunks.values()) if (ch.owner === me.id) for (const t of ch.tiles.values()) {
    const d = B[t.type]; if (!d) continue;
    if (cnt[d.cat] != null) cnt[d.cat]++;
    if (d.supplies && d.supplies.power) cnt.power++;
  }
  const list = $('questList'); list.innerHTML = '';
  let next = true, all = true;
  for (const q of QUESTS) {
    const ok = q.done(cnt); if (!ok) all = false;
    const li = mk('li', (ok ? '✓ ' : next ? '▶ ' : '○ ') + q.text, ok ? 'done' : next ? 'next' : '');
    if (!ok) next = false;
    list.appendChild(li);
  }
  if (all) { $('questHead').style.display = 'none'; list.style.display = 'none'; }     // 目標全部完成：只保留顧問
  $('advisor').textContent = advice();
  renderAch(G.getStats());
}
function advice() {                                                               // 城市顧問：依目前數字給下一步建議
  const s = G.getStats(); if (!s || s.chunks == null) return '';
  const near = u => u.cap > 0 && u.use >= u.cap * 0.9;
  if (s.rate < 0) return '收入是負的：多蓋商業或工業，或拆掉維護費高的建築。';
  if (near(s.power)) return '電力快用完了：蓋太陽能板或發電廠。';
  if (near(s.water)) return '水快用完了：蓋水塔或淨水廠。';
  if (s.pop > 0 && s.employ < 80) return `就業率只有 ${s.employ}%：蓋商業或工業來創造工作。`;
  if (s.jobs > 0 && s.pop < s.jobs * 0.8) return '工作比居民多：蓋住宅吸引更多人口。';
  if (s.happiness < 40) return '幸福度偏低：蓋公園、警察局、醫院，或減少污染。';
  if (s.nextAt != null && s.peakPop >= s.nextAt * 0.8) {                          // 快升級了：提示會解鎖什麼
    const names = Object.values(B).filter(d => d.unlock === s.nextAt).map(d => d.name).join('、');
    return `再 ${s.nextAt - s.peakPop} 人口就升級為「${s.nextName}」，會解鎖：${names}。`;
  }
  if (s.money > s.claimCost * 3) return '資金很充裕：可以擴張領地，或找鄰居結盟了。';
  return s.pop === 0 ? '先沿著道路蓋幾間住宅，再蓋商鋪。' : '城市運作良好，繼續發展吧。';
}
setInterval(updateQuests, 500);
})();
