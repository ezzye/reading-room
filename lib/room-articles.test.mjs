import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { memberAuthAPI, memberAuthGate, roomsAPI } from './member-auth.ts';
import { roomArticlesAPI, articleSearchAPI } from './room-articles.ts';
import { librarySettingsAPI } from './library-server.ts';
import { sealLibrary } from './library-vault.mjs';
import { accessiblePage, DEFAULT_ROOM_ID } from './rooms.ts';
import { fixture } from './newspaper-fixture.mjs';

const origin = 'https://reader.example';
const ownerEmail = 'owner@example.org';
const now = Date.now();
const vaultKey = '47'.repeat(32);
const articleURL = 'https://theguardian.com/fictional/room-story';
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of migrations) sql.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  return { sql, async batch(statements) { sql.exec('BEGIN'); try { const results = statements.map(statement => statement._run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }, prepare(query) { const statement = sql.prepare(query); const wrap = args => ({ _run: () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }), first: async () => statement.get(...args) || null, all: async () => ({ results: statement.all(...args) }), run: async () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }) }); return { ...wrap([]), bind(...args) { return wrap(args); } }; } };
}
function config(DB, extra = {}) { return { DB, READER_OWNER_EMAIL: ownerEmail, DEEPSEEK_API_KEY: 'synthetic-key', RR_LIBRARY_VAULT_KEY: vaultKey, ...extra }; }
function raw(path, method = 'GET', body, cookie = '', headers = {}) { return new Request(origin + path, { method, headers: { Origin: origin, 'X-Reading-Room': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); }
function cookies(response, previous = '') { const jar = new Map(previous.split(';').filter(Boolean).map(part => part.trim().split('='))); for (const line of response.headers.getSetCookie()) { const [key, value] = line.split(';')[0].split('='); value ? jar.set(key, value) : jar.delete(key); } return [...jar].map(([key, value]) => key + '=' + value).join('; '); }
async function bootstrap(DB) { const response = await memberAuthAPI(raw('/api/member-auth?action=bootstrap', 'POST', {}, '', { 'oai-authenticated-user-email': ownerEmail }), config(DB, { RR_TRUST_SITES_BOOTSTRAP: '1' }), now); assert.equal(response.status, 201); return cookies(response); }
async function join(DB, owner) { const invite = await memberAuthAPI(raw('/api/member-auth?action=invite', 'POST', { purpose: 'member' }, owner), config(DB), now); assert.equal(invite.status, 201); const { url } = await invite.json(); const token = new URLSearchParams(new URL(url).hash.slice(1)).get('invite'); const accepted = await memberAuthAPI(raw('/api/member-auth?action=accept', 'POST', { token, displayName: 'Reader' }), config(DB), now); assert.equal(accepted.status, 201); return cookies(accepted); }
async function room(DB, cookie, name) { const response = await roomsAPI(raw('/api/rooms', 'POST', { action: 'create', name }, cookie), config(DB), now); assert.equal(response.status, 201); return { cookie: cookies(response, cookie), id: (await response.json()).room.id }; }
async function gated(DB, cookie, path, method = 'GET', body, headers = {}) { const request = await memberAuthGate(raw(path, method, body, cookie, headers), config(DB), now); assert(request instanceof Request, `${path} must pass session gate`); assert(request.headers.get('x-ret-member-id')); assert(request.headers.get('x-rr-room-id')); return request; }
function addPage(DB, roomId, id, title, url, image = '') {
  const document = JSON.stringify({ kind: 'rendered-capture-v1', capture: { publisher: 'The Guardian', blocks: image ? [{ type: 'figure', url: image }] : [] } });
  DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id, 'capture:' + id, url, title, document, new Date(now).toISOString());
  const owner = DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(roomId).owner_id;
  DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomId, id, owner, new Date(now).toISOString());
}
function provider() {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://api.deepseek.com/chat/completions') return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ annotations: [{ blockId: 'B1', title: 'Sequence', comment: 'Consider how the writer leads with the meeting.', question: 'Which perspective is foregrounded?' }, { blockId: 'B3', title: 'Evidence', comment: 'The passage offers a viewpoint for comparison.', question: 'What more would you want to ask?' }] }) } }] });
    if (url === 'https://api.deepseek.com/v1/tools/search') return Response.json({ results: [
      { url: 'https://www.thetimes.com/uk/article/real-article-abcdefghi', title: '<img src=x onerror=alert(1)>' },
      { url: 'https://www.theguardian.com/uk-news/another', title: 'Other paper' },
      { url: 'https://google.com/url?q=https://www.thetimes.com/uk/article/wrapper', title: 'Search wrapper' },
      { url: 'javascript:alert(1)', title: 'Unsafe URL' },
    ] });
    return new Response(fixture, { headers: { 'Content-Type': 'text/html' } });
  };
  return { fetcher, calls };
}

// This covers the API with the same headers the worker mints from a real session.
test('shelves, article reads and removals stay inside the selected room', async () => {
  const DB = database(), owner = await bootstrap(DB), member = await join(DB, owner), second = await room(DB, owner, 'Other room');
  const firstId = 'a'.repeat(48), secondId = 'b'.repeat(48);
  addPage(DB, DEFAULT_ROOM_ID, firstId, 'Private family headline', 'https://theguardian.com/family', 'https://images.example.org/family.jpg');
  addPage(DB, second.id, secondId, 'Private club headline', 'https://theguardian.com/club', 'https://images.example.org/club.jpg');
  const first = await gated(DB, owner, '/api/room-articles'), other = await gated(DB, second.cookie, '/api/room-articles');
  const a = await (await roomArticlesAPI(first, config(DB))).json(), b = await (await roomArticlesAPI(other, config(DB))).json();
  assert.deepEqual(a.articles.map(x => x.id), [firstId]); assert.deepEqual(b.articles.map(x => x.id), [secondId]);
  assert.equal(JSON.stringify(a).includes('Private club headline'), false); assert.equal(JSON.stringify(a).includes('club.jpg'), false);
  assert.equal(JSON.stringify(b).includes('Private family headline'), false); assert.equal(JSON.stringify(b).includes('family.jpg'), false);
  assert.equal(await accessiblePage(first, config(DB), secondId), false);
  assert.equal(await accessiblePage(other, config(DB), firstId), false);
  const memberRequest = await gated(DB, member, '/api/room-articles');
  assert.equal(memberRequest.headers.get('x-ret-member-role'), 'member');
  assert.equal(memberRequest.headers.get('oai-authenticated-user-email'), null);
  const memberShelf = await (await roomArticlesAPI(memberRequest, config(DB))).json();
  assert.deepEqual(memberShelf.articles.map(x => x.id), [firstId]);
  assert.equal(JSON.stringify(memberShelf).includes('Private club headline'), false);
  const outside = await memberAuthGate(raw('/api/room-articles?room=' + second.id, 'GET', undefined, member, { 'x-rr-room-id': second.id, 'x-ret-member-role': 'owner' }), config(DB), now);
  assert(outside instanceof Response); assert.equal(outside.status, 401);
  const remove = await gated(DB, second.cookie, '/api/room-articles', 'POST', { action: 'remove', id: firstId });
  assert.equal((await roomArticlesAPI(remove, config(DB))).status, 404);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_room_articles WHERE page_id=?').get(firstId).n, 1);
});

test('same URL imports independently in two rooms while each room caches its own copy', async () => {
  const DB = database(), owner = await bootstrap(DB), second = await room(DB, owner, 'Other room'), p = provider();
  async function importURL(cookie) { const request = await gated(DB, cookie, '/api/room-articles', 'POST', { url: articleURL, requestId: crypto.randomUUID() }); const response = await roomArticlesAPI(request, config(DB), p.fetcher); return { status: response.status, data: await response.json() }; }
  const first = await importURL(owner); assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.cached, false);
  const firstAgain = await importURL(owner); assert.equal(firstAgain.status, 200); assert.equal(firstAgain.data.id, first.data.id); assert.equal(firstAgain.data.cached, true);
  const other = await importURL(second.cookie); assert.equal(other.status, 200, JSON.stringify(other.data)); assert.notEqual(other.data.id, first.data.id); assert.equal(other.data.cached, false);
  assert.equal(other.data.href, '/read/' + other.data.id + '?room=' + second.id);
  assert.equal(p.calls.filter(call => call.url === articleURL).length, 2);
  assert.equal(p.calls.filter(call => call.url === 'https://api.deepseek.com/chat/completions').length, 2);
  const hashes = DB.sql.prepare('SELECT source_hash FROM education_pages WHERE id IN (?,?)').all(first.data.id, other.data.id).map(x => x.source_hash);
  assert.equal(new Set(hashes).size, 2);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_room_articles').get().n, 2);
});

test('headline search returns direct links only from the requested newspaper as JSON', async () => {
  const DB = database(), owner = await bootstrap(DB), p = provider();
  const request = await gated(DB, owner, '/api/article-search', 'POST', { publisher: 'times', headline: 'Test headline' });
  const response = await articleSearchAPI(request, config(DB), p.fetcher), data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].url, 'https://thetimes.com/uk/article/real-article-abcdefghi');
  assert.equal(data.results[0].publisher, 'The Times');
  assert.equal(data.results[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(data.results[0].image, '');
  assert.equal(p.calls.find(call => call.url.includes('/tools/search')).options.body.includes('site:thetimes.com'), true);
});

test('library settings and disconnect are scoped to the current room without revealing the card', async () => {
  const DB = database(), owner = await bootstrap(DB), second = await room(DB, owner, 'Other room');
  const encrypted = await sealLibrary(vaultKey, { libraryName: 'CamdenLibraries', cardNumber: 'synthetic-card-123', session: null });
  DB.sql.prepare('INSERT INTO rr_library_connections(id,encrypted,state,checked_at,last_error) VALUES(?,?,?,?,?)').run('camden', encrypted, 'connected', new Date(now).toISOString(), '');
  const fresh = await gated(DB, second.cookie, '/api/library-settings');
  const freshResponse = await librarySettingsAPI(fresh, config(DB)); const freshText = await freshResponse.text();
  assert.equal(freshResponse.status, 200); assert.equal(JSON.parse(freshText).configured, false);
  assert.doesNotMatch(freshText, /synthetic-card-123|PIN|cardNumber|encrypted/i);
  const disconnect = await gated(DB, second.cookie, '/api/library-settings', 'POST', { action: 'disconnect' });
  assert.equal((await librarySettingsAPI(disconnect, config(DB))).status, 200);
  assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rr_library_connections WHERE id='camden'").get().n, 1);
  const original = await gated(DB, owner, '/api/library-settings'); const originalText = await (await librarySettingsAPI(original, config(DB))).text();
  assert.equal(JSON.parse(originalText).configured, true); assert.doesNotMatch(originalText, /synthetic-card-123|PIN|cardNumber|encrypted/i);
});

test('the shelf groups older captures by article URL and shortens library-only metadata', async () => {
  const DB=database(),owner=await bootstrap(DB),first='d'.repeat(48),second='e'.repeat(48),url='https://thetimes.com/uk/article/fictional-garden-abcdefghi';
  addPage(DB,DEFAULT_ROOM_ID,first,'A fictional garden headline - A long library standfirst',url);
  addPage(DB,DEFAULT_ROOM_ID,second,'An older capture of the same article',url+'?CMP=Share_AndroidApp_Other');
  DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify({kind:'rendered-capture-v1',capture:{publisher:'The Times (Camden NewsBank text edition) · Camden NewsBank text edition',presentation:{method:'library-text'},blocks:[]}}),first);
  DB.sql.prepare('UPDATE rr_room_articles SET created_at=? WHERE page_id=?').run('2000-01-01T00:00:00Z',second);
  const result=await roomArticlesAPI(await gated(DB,owner,'/api/room-articles'),config(DB));const data=await result.json();
  assert.equal(data.articles.length,1);assert.equal(data.articles[0].id,first);assert.equal(data.articles[0].title,'A fictional garden headline');assert.equal(data.articles[0].publisher,'The Times');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,2);
});
