const $ = id => document.getElementById(id);
const state = { rooms: [], activeRoom: null, member: null, articles: [], installPrompt: null };
const authHeaders = { 'X-Reading-Room': '1' };
function status(id, message = '') { $(id).textContent = message; }
function open(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function close(id) { $(id).close(); }
function safeHttp(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function shortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date); }
function readableError(data, fallback) { return typeof data?.error === 'string' ? data.error : fallback; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...authHeaders, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401) { location.assign('/room?next=/study'); throw new Error('Please sign in to continue.'); }
  if (!response.ok) throw new Error(readableError(data, 'Please try again.'));
  return data;
}
function post(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
function setBusy(button, busy) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
function articleCard(article) {
  const a = document.createElement('a'); a.className = 'article'; a.href = '/read/' + encodeURIComponent(article.id) + (state.activeRoom?.id ? '?room=' + encodeURIComponent(state.activeRoom.id) : '');
  const image = safeHttp(article.image);
  if (image) { const img = document.createElement('img'); img.className = 'article-image'; img.src = image; img.loading = 'lazy'; img.alt = ''; img.referrerPolicy = 'no-referrer'; a.append(img); }
  const body = document.createElement('div'); body.className = 'article-body';
  const source = document.createElement('div'); source.className = 'article-source'; source.textContent = article.publisher || (safeHttp(article.sourceURL) ? new URL(article.sourceURL).hostname.replace(/^www\./, '') : 'Article');
  const title = document.createElement('h3'); title.textContent = article.title || 'Untitled article';
  const footer = document.createElement('div'); footer.className = 'article-footer';
  const date = document.createElement('span'); date.textContent = shortDate(article.createdAt);
  const comments = document.createElement('span'); const n = Number(article.commentCount) || 0; comments.textContent = n + (n === 1 ? ' comment' : ' comments');
  footer.append(date, comments); body.append(source, title, footer); a.append(body); return a;
}
function drawShelf() {
  $('cards').replaceChildren(...state.articles.map(articleCard));
  $('cards').hidden = !state.articles.length;
  $('empty').hidden = !!state.articles.length;
  $('article-count').textContent = state.articles.length ? '· ' + state.articles.length : '';
}
function applyRoom() {
  const room = state.activeRoom;
  $('room-name').textContent = room?.name || 'Reading Room';
  $('people-open').hidden = room?.role !== 'owner';
  $('owner-settings').hidden = room?.role !== 'owner';
  $('create-room-wrap').hidden = !state.member;
  $('rename-name').value = room?.name || '';
  $('moderation').value = room?.moderation === 'approval' ? 'approval' : 'open';
  $('account-name').textContent = state.member?.displayName || state.member?.display_name || 'Signed in';
}
async function load() {
  status('page-status');
  try {
    const rooms = await api('/api/rooms');
    state.rooms = Array.isArray(rooms.rooms) ? rooms.rooms : [];
    state.activeRoom = rooms.activeRoom || null;
    state.member = rooms.member || null;
    applyRoom();
    if (!state.activeRoom) { state.articles = []; drawShelf(); status('page-status', 'Choose or create a room to begin.'); return; }
    const shelf = await api('/api/room-articles');
    state.articles = Array.isArray(shelf.articles) ? shelf.articles : [];
    if (shelf.room) state.activeRoom = { ...state.activeRoom, ...shelf.room };
    applyRoom(); drawShelf();
  } catch (error) {
    $('cards').replaceChildren(); $('cards').hidden = true; $('empty').hidden = true;
    status('page-status', error.message || 'Could not load the room.');
  }
}
function setAddTab(tab) {
  const url = tab === 'url';
  $('url-tab').setAttribute('aria-selected', String(url));
  $('search-tab').setAttribute('aria-selected', String(!url));
  $('url-panel').hidden = !url; $('search-panel').hidden = url;
  status('add-status');
  (url ? $('article-url') : $('publisher')).focus();
}
function openAdd() { open('add-dialog'); setAddTab('url'); }
async function addArticle(url, button) {
  const safe = safeHttp(url);
  if (!safe) { status('add-status', 'Enter an http or https article link.'); return; }
  setBusy(button, true); status('add-status', 'Adding article…');
  try {
    const result = await post('/api/room-articles', { url: safe, requestId: crypto.randomUUID() });
    close('add-dialog');
    await load();
    status('page-status', result.cached ? 'Article is already on the shelf.' : 'Article added to the shelf.');
    $('article-url').value = '';
  } catch (error) { status('add-status', error.message); }
  finally { setBusy(button, false); }
}
function searchResult(result) {
  const url = safeHttp(result.url);
  if (!url) return null;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'result-item';
  const title = document.createElement('strong'); title.textContent = result.title || url;
  const source = document.createElement('small'); source.textContent = result.publisher || new URL(url).hostname;
  button.append(title, source);
  button.addEventListener('click', () => addArticle(url, button));
  return button;
}
async function search(event) {
  event.preventDefault();
  const button = $('search-submit'); setBusy(button, true); status('add-status', 'Searching…'); $('search-results').replaceChildren();
  try {
    const data = await post('/api/article-search', { publisher: $('publisher').value, headline: $('headline').value.trim() });
    const results = (Array.isArray(data.results) ? data.results : []).map(searchResult).filter(Boolean);
    $('search-results').replaceChildren(...results);
    status('add-status', results.length ? 'Choose an article to add.' : 'No articles found. Try different words or paste a link.');
  } catch (error) { status('add-status', error.message); }
  finally { setBusy(button, false); }
}
function drawRooms() {
  $('room-list').replaceChildren();
  for (const room of state.rooms) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'room-item' + (room.id === state.activeRoom?.id ? ' active' : '');
    const title = document.createElement('strong'); title.textContent = room.name;
    const meta = document.createElement('small'); meta.textContent = room.role === 'owner' ? 'Owner' : 'Member';
    item.append(title, meta);
    item.addEventListener('click', async () => { if (room.id === state.activeRoom?.id) { close('rooms-dialog'); return; } setBusy(item, true); try { await post('/api/rooms', { action: 'switch', roomId: room.id }); close('rooms-dialog'); await load(); } catch (error) { status('rooms-status', error.message); } finally { setBusy(item, false); } });
    $('room-list').append(item);
  }
  if (!state.rooms.length) status('rooms-status', 'No rooms yet. Make one below.');
}
function openRooms() { drawRooms(); status('rooms-status'); open('rooms-dialog'); }
async function loadPeople() {
  $('people-list').replaceChildren(); status('people-status', 'Loading members…');
  try {
    const data = await api('/api/member-auth?action=admin');
    const members = Array.isArray(data.members) ? data.members : [];
    for (const member of members) {
      if (member.revoked_at || member.revokedAt) continue;
      const row = document.createElement('div'); row.className = 'member-item split';
      const text = document.createElement('div'); const name = document.createElement('strong'); name.textContent = member.displayName || member.display_name || 'Member';
      const role = document.createElement('small'); role.textContent = member.role === 'owner' ? 'Owner' : 'Member'; text.append(name, role); row.append(text);
      if (member.role !== 'owner') {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'small-btn danger'; revoke.textContent = 'Remove'; let armed = false;
        revoke.addEventListener('click', async () => { if (!armed) { armed = true; revoke.textContent = 'Confirm remove'; return; } setBusy(revoke, true); try { await post('/api/member-auth?action=revoke-member', { memberId: member.id }); await loadPeople(); status('people-status', 'Member removed.'); } catch (error) { status('people-status', error.message); setBusy(revoke, false); } }); row.append(revoke);
      }
      $('people-list').append(row);
    }
    status('people-status', members.length ? '' : 'No members yet.');
  } catch (error) { status('people-status', error.message); }
}
function openPeople() { if (state.activeRoom?.role !== 'owner') return; $('invite-wrap').hidden = true; open('people-dialog'); loadPeople(); }
function showInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  $('install-button').hidden = !state.installPrompt;
  $('install-steps').hidden = !!state.installPrompt;
  if (!state.installPrompt) $('install-steps').textContent = ios ? 'In Safari, tap Share, then Add to Home Screen.' : 'Open your browser menu and choose Install app or Add to Home screen.';
  open('install-dialog');
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
$('add-open').addEventListener('click', openAdd); $('empty-add').addEventListener('click', openAdd);
$('url-tab').addEventListener('click', () => setAddTab('url')); $('search-tab').addEventListener('click', () => setAddTab('search'));
$('url-form').addEventListener('submit', event => { event.preventDefault(); addArticle($('article-url').value.trim(), $('url-submit')); });
$('search-form').addEventListener('submit', search);
$('room-open').addEventListener('click', openRooms); $('menu-rooms').addEventListener('click', () => { close('menu-dialog'); openRooms(); });
$('people-open').addEventListener('click', openPeople); $('menu-open').addEventListener('click', () => open('menu-dialog'));
$('member-open').addEventListener('click', () => open('account-dialog'));
$('menu-install').addEventListener('click', () => { close('menu-dialog'); showInstall(); });
$('create-room-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await post('/api/rooms', { action: 'create', name: $('create-room-name').value.trim() }); close('rooms-dialog'); $('create-room-name').value = ''; await load(); } catch (error) { status('rooms-status', error.message); } finally { setBusy(button, false); } });
$('rename-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await post('/api/rooms', { action: 'rename', name: $('rename-name').value.trim() }); await load(); status('menu-status', 'Room name saved.'); } catch (error) { status('menu-status', error.message); } finally { setBusy(button, false); } });
$('moderation').addEventListener('change', async event => { const select = event.currentTarget; select.disabled = true; try { await post('/api/rooms', { action: 'moderation', moderation: select.value }); status('menu-status', 'Comment setting saved.'); } catch (error) { status('menu-status', error.message); } finally { select.disabled = false; } });
$('invite-button').addEventListener('click', async () => { const button = $('invite-button'); setBusy(button, true); try { const result = await post('/api/member-auth?action=invite', { purpose: 'member' }); $('invite-link').textContent = result.url; $('invite-wrap').hidden = false; status('people-status', 'Invitation ready to share.'); } catch (error) { status('people-status', error.message); } finally { setBusy(button, false); } });
$('copy-invite').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('invite-link').textContent); status('people-status', 'Link copied.'); } catch { status('people-status', 'Select the link above to copy it.'); } });
$('share-invite').addEventListener('click', async () => { if (!navigator.share) { status('people-status', 'Select and copy the link above to share it.'); return; } try { await navigator.share({ title: 'Reading Room invitation', url: $('invite-link').textContent }); } catch {} });
$('install-button').addEventListener('click', async () => { const prompt = state.installPrompt; if (!prompt) return; state.installPrompt = null; close('install-dialog'); await prompt.prompt(); });
addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
async function start() {
  const params = new URLSearchParams(location.search);
  const requestedRoom = params.get('room');
  if (requestedRoom) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestedRoom)) { $('cards').replaceChildren(); status('page-status', 'That room link is invalid.'); return; }
    try {
      await post('/api/rooms', { action: 'switch', roomId: requestedRoom });
      params.delete('room');
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params.toString() : ''));
    } catch (error) { $('cards').replaceChildren(); status('page-status', error.message); return; }
  }
  await load();
  const shared = params.get('url') || (params.get('text') || '').match(/https?:\/\/\S+/)?.[0];
  if (params.get('action') === 'add' || shared) { openAdd(); if (shared) $('article-url').value = shared; }
}
start();
