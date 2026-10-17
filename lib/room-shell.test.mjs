import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('./room-shell.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./room-reader-shell.mjs', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ articles = [], role = 'owner', search = '', unauthenticated = false } = {}) {
  const { window } = parseHTML(html);
  const document = window.document;
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  }
  const calls = [];
  const roomOne = { id: 'one', name: 'Family room', role, moderation: 'open' };
  const roomTwo = { id: 'two', name: 'Book club', role: 'member', moderation: 'approval' };
  let active = roomOne;
  let shelf = [...articles];
  async function fetch(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, options, body });
    if (unauthenticated) return { ok: false, status: 401, json: async () => ({ error: 'Sign in.' }) };
    let value;
    if (path === '/api/rooms' && options.method === 'POST') {
      if (body.action === 'switch') active = roomTwo;
      value = { room: active };
    } else if (path === '/api/rooms') value = { rooms: [roomOne, roomTwo], activeRoom: active, member: { id: 'm1', displayName: 'Owner', role } };
    else if (path === '/api/room-articles' && options.method === 'POST') {
      shelf = [{ id: 'added', title: 'Added article', sourceURL: body.url, publisher: 'News', createdAt: '2026-10-18T00:00:00Z', commentCount: 0 }, ...shelf];
      value = { id: 'added', href: '/read/added', cached: false };
    } else if (path === '/api/room-articles') value = { articles: shelf, room: active };
    else if (path === '/api/article-search') value = { results: [{ url: 'https://news.example/search-result', title: 'Found headline', publisher: 'The Times' }] };
    else value = { members: [] };
    return { ok: true, status: 200, json: async () => value };
  }
  const location = { search, pathname: '/study', origin: 'https://reader.example', assigned: '', assign(value) { this.assigned = value; } };
  const history = { replaced: '', replaceState(_state, _title, value) { this.replaced = value; } };
  const context = vm.createContext({ document, navigator: { userAgent: 'iPhone', clipboard: { writeText: async () => {} } }, location, history, fetch, crypto: webcrypto, URL, URLSearchParams, Intl, setTimeout, addEventListener() {} });
  vm.runInContext(script, context);
  return { document, calls, window, location, history };
}

function click(h, id) { h.document.getElementById(id).dispatchEvent(new h.window.Event('click')); }
function submit(h, id) { const event = new h.window.Event('submit', { cancelable: true }); Object.defineProperty(event, 'submitter', { value: h.document.querySelector('#' + id + ' button[type=submit]') }); h.document.getElementById(id).dispatchEvent(event); }

test('shelf renders article metadata as text and never loads an unsafe image URL', async () => {
  const h = harness({ articles: [{ id: 'a', title: '<img src=x onerror=alert(1)>', publisher: 'The Times', image: 'javascript:alert(1)', sourceURL: 'https://news.example/a', createdAt: '2026-10-18T00:00:00Z', commentCount: 2 }] });
  await flush();
  assert.equal(h.document.querySelector('.article h3').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.document.querySelector('.article img'), null);
  assert.equal(h.document.querySelector('.article').getAttribute('href'), '/read/a?room=one');
  assert.equal(h.document.querySelector('.article-footer').textContent.includes('2 comments'), true);
  assert.equal(h.document.getElementById('people-open').hidden, false);
});

test('empty room, link add, search selection and room switch use the intended API', async () => {
  const h = harness({ role: 'member' });
  await flush();
  assert.equal(h.document.getElementById('empty').hidden, false);
  assert.equal(h.document.getElementById('people-open').hidden, true);
  click(h, 'room-open');
  assert.equal(h.document.getElementById('create-room-wrap').hidden, false);
  h.document.getElementById('rooms-dialog').close();
  click(h, 'empty-add');
  assert.equal(h.document.getElementById('add-dialog').open, true);
  h.document.getElementById('article-url').value = 'https://news.example/story';
  submit(h, 'url-form'); await flush(); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/room-articles' && c.options.method === 'POST').body.url, 'https://news.example/story');
  assert.equal(h.document.querySelectorAll('.article').length, 1);
  click(h, 'add-open'); click(h, 'search-tab');
  h.document.querySelector('#publisher option[value=times]').selected = true;
  h.document.getElementById('headline').value = 'A headline';
  submit(h, 'search-form'); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/article-search').body.publisher, 'times');
  h.document.querySelector('.result-item').dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.filter(c => c.path === '/api/room-articles' && c.options.method === 'POST').length, 2);
  click(h, 'room-open');
  h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/rooms' && c.body?.action === 'switch').body.roomId, 'two');
  assert.equal(h.document.getElementById('room-name').textContent, 'Book club');
});

test('article shelf link selects its room before loading and clears the room URL parameter', async () => {
  const h = harness({ search: '?room=two' });
  await flush(); await flush();
  assert.equal(h.calls[0].path, '/api/rooms');
  assert.deepEqual(h.calls[0].body, { action: 'switch', roomId: 'two' });
  assert.equal(h.calls[1].path, '/api/rooms');
  assert.equal(h.document.getElementById('room-name').textContent, 'Book club');
  assert.equal(h.history.replaced, '/study');
  const signedOut = harness({ search: '?room=two', unauthenticated: true });
  await flush();
  assert.equal(signedOut.calls.length, 1);
  assert.equal(signedOut.location.assigned, '/room?next=/study');
});
