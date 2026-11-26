// Admin page: overview, remove or rename players, read error reports.
// Every action is checked by the server against the admin key; this page holds no secrets itself.
import { API_URL, PUBLISHABLE_KEY } from './config.js';
import { cleanNickname } from './core.js';

const $ = id => document.getElementById(id);
const KEY = 'lor.adminKey';
const getKey = () => sessionStorage.getItem(KEY) || '';

async function call(action, body = {}) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY, 'x-admin-key': getKey() },
    body: JSON.stringify({ action, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
}
const cell = (text, cls) => { const td = document.createElement('td'); if (cls) td.className = cls; if (text instanceof Node) td.append(text); else td.textContent = text; return td; };
const when = iso => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function loadSummary() {
  const s = await call('adminSummary');
  const tiles = [[s.players, 'Players'], [s.guests, 'Still guests'], [s.gamesToday, 'Games in 24 h'], [s.reminders, 'Reminders on'], [s.errors24h, 'Errors in 24 h'], [s.banned, 'Removed']];
  $('tiles').replaceChildren(...tiles.map(([v, k]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const sp = document.createElement('span'); sp.textContent = k; d.append(b, sp); return d; }));
}

async function loadPlayers(q = '') {
  const { players } = await call('adminPlayers', { q });
  $('playerCount').textContent = `${players.length} shown`;
  $('players').replaceChildren(...players.map(p => {
    const tr = document.createElement('tr'); if (p.banned) tr.className = 'banned';
    const name = document.createElement('span'); name.textContent = p.nickname;
    const tags = document.createElement('span');
    if (p.guest) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'guest'; tags.append(t); }
    if (p.banned) { const t = document.createElement('span'); t.className = 'tag bad'; t.textContent = 'removed'; tags.append(t); }
    const nameCell = document.createElement('span'); nameCell.append(name, tags);
    const actions = document.createElement('span'); actions.className = 'adm-row';
    const ban = document.createElement('button'); ban.className = 'ghost small'; ban.type = 'button';
    ban.textContent = p.banned ? 'Restore' : 'Remove';
    ban.title = p.banned ? 'Show this player on leaderboards again' : 'Hide from leaderboards and block from playing';
    ban.onclick = async () => {
      if (!p.banned && ban.dataset.armed !== '1') { ban.dataset.armed = '1'; ban.textContent = 'Tap to confirm'; return; }
      ban.disabled = true;
      try { await call('adminSetBanned', { playerId: p.id, banned: !p.banned }); await refresh(); } catch (e) { alertRow(tr, e.message); }
    };
    const ren = document.createElement('button'); ren.className = 'ghost small'; ren.type = 'button'; ren.textContent = 'Rename';
    ren.onclick = () => {
      const input = document.createElement('input'); input.className = 'field'; input.value = p.nickname; input.style.maxWidth = '160px';
      const save = document.createElement('button'); save.className = 'ghost small'; save.type = 'button'; save.textContent = 'Save';
      save.onclick = async () => {
        const c = cleanNickname(input.value);
        if (!c.ok) { alertRow(tr, c.error); return; }
        try { await call('adminRename', { playerId: p.id, nickname: c.value }); await refresh(); } catch (e) { alertRow(tr, e.message); }
      };
      actions.replaceChildren(input, save);
      input.focus();
    };
    actions.append(ren, ban);
    tr.append(cell(nameCell), cell(String(p.games)), cell(when(p.createdAt)), cell(actions));
    return tr;
  }));
}
function alertRow(tr, msg) {
  const note = document.createElement('div'); note.className = 'field-error'; note.textContent = msg;
  tr.lastChild.append(note); setTimeout(() => note.remove(), 4000);
}

async function loadErrors() {
  const { errors } = await call('adminErrors');
  $('errCount').textContent = errors.length ? `(${errors.length})` : '(none)';
  $('errors').replaceChildren(...errors.map(e => {
    const tr = document.createElement('tr');
    tr.append(cell(when(e.at)), cell(`${e.message}\n${e.url || ''} · ${e.ua || ''}${e.stack ? '\n' + e.stack : ''}`, 'adm-err'));
    return tr;
  }));
}

async function refresh() { await Promise.all([loadSummary(), loadPlayers($('searchInput').value.trim()), loadErrors()]); }

async function open() {
  try {
    await refresh();
    $('keyForm').hidden = true; $('panel').hidden = false;
  } catch (e) {
    sessionStorage.removeItem(KEY);
    $('keyError').textContent = e.status === 403 ? 'That key isn’t right.' : e.message;
    $('keyError').hidden = false;
  }
}

$('keyForm').addEventListener('submit', e => {
  e.preventDefault();
  sessionStorage.setItem(KEY, $('keyInput').value.trim());
  $('keyInput').value = '';
  open();
});
$('searchForm').addEventListener('submit', e => { e.preventDefault(); loadPlayers($('searchInput').value.trim()).catch(() => {}); });
$('signOut').addEventListener('click', () => { sessionStorage.removeItem(KEY); location.reload(); });
if (getKey()) open();
