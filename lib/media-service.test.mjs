import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {memberAuthAPI,memberAuthGate,roomsAPI} from './member-auth.ts';
import {DEFAULT_ROOM_ID} from './rooms.ts';
import {roomMediaAPI,collectArticleMedia,mediaCheckTelemetry} from './media-service.ts';
const origin='https://reader.example',ownerEmail='owner@example.org',now=Date.now(),vaultKey='47'.repeat(32);
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
const articleURL='https://www.theguardian.com/fictional/river-walk',title='Volunteers inspect a new river walk';
test('media diagnostic logs retain only fixed states, publisher and bounded counts',()=>{
 const result=mediaCheckTelemetry({url:articleURL},{added:0,extractorRevision:2,attempts:[{sourceURL:'https://private.example/?token=secret',state:'checked',sourceType:'public-html',contentCharacters:42,imageReferences:2,videoReferences:0,cookie:'private-cookie',title:'Private title'},{state:'private-error-body',sourceType:'private-type',contentCharacters:Infinity,imageReferences:-4}]});
 assert.equal(result.publisher,'theguardian.com');assert.equal(result.checks[0].characters,42);assert.equal(result.checks[1].state,'unknown');assert.equal(result.checks[1].characters,null);assert.equal(result.checks[1].images,0);assert.doesNotMatch(JSON.stringify(result),/secret|cookie|token|Private|private/);
});
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of migrations) sql.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  return { sql, async batch(statements) { sql.exec('BEGIN'); try { const results = statements.map(statement => statement._run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }, prepare(query) { const statement = sql.prepare(query); const wrap = args => ({ _run: () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }), first: async () => statement.get(...args) || null, all: async () => ({ results: statement.all(...args) }), run: async () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }) }); return { ...wrap([]), bind(...args) { return wrap(args); } }; } };
}
function config(DB, extra = {}) { return { DB, READER_OWNER_EMAIL: ownerEmail, DEEPSEEK_API_KEY: '', RR_LIBRARY_VAULT_KEY: vaultKey, ...extra }; }
function raw(path, method = 'GET', body, cookie = '', headers = {}) { return new Request(origin + path, { method, headers: { Origin: origin, 'X-Reading-Room': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); }
function cookies(response, previous = '') { const jar = new Map(previous.split(';').filter(Boolean).map(part => part.trim().split('='))); for (const line of response.headers.getSetCookie()) { const [key, value] = line.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); } return [...jar].map(([key, value]) => key + '=' + value).join('; '); }
async function bootstrap(DB) { const response = await memberAuthAPI(raw('/api/member-auth?action=bootstrap', 'POST', {}, '', { 'oai-authenticated-user-email': ownerEmail }), config(DB, { RR_TRUST_SITES_BOOTSTRAP: '1' }), now); assert.equal(response.status, 201); return cookies(response); }
async function room(DB, cookie, name) { const response = await roomsAPI(raw('/api/rooms', 'POST', { action: 'create', name }, cookie), config(DB), now); assert.equal(response.status, 201); return { cookie: cookies(response, cookie), id: (await response.json()).room.id }; }
async function gated(DB, cookie, path, method = 'GET', body, headers = {}) { const request = await memberAuthGate(raw(path, method, body, cookie, headers), config(DB), now); assert(request instanceof Request, `${path} must pass session gate`); assert(request.headers.get('x-ret-member-id')); assert(request.headers.get('x-rr-room-id')); return request; }
function addPage(DB, roomId, id, extra = {}) {
  const document = {kind: 'rendered-capture-v1', capture: {url: articleURL, title, publisher: 'The Guardian', presentation: {method: 'library-text'}, diagnostics: {libraryTextEdition: true, imageCount: 0, videoCount: 0}, blocks: [{id: 'B1', type: 'paragraph', text: 'The complete retained library paragraph.'}, {id: 'B2', type: 'quote', text: 'The retained quotation.'}]}, annotations: [{blockId: 'B1', title: 'Existing annotation', comment: 'Retained commentary.'}], ...extra};
  DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id, 'capture:' + id, articleURL, title, JSON.stringify(document), new Date(now).toISOString());
  const owner = DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(roomId).owner_id;
  DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomId, id, owner, new Date(now).toISOString());
  return document;
}
const read = (DB, id) => JSON.parse(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(id).document);
function publisher() {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    return new Response(new URL(url).pathname === new URL(articleURL).pathname ? '<link rel="canonical" href="'+articleURL+'"><article><h1>Updated headline</h1><figure><img src="https://images.example.org/river.jpg"><figcaption>River route <span class="credit">Photographer</span></figcaption></figure></article>' : '<html><body>No matching cards</body></html>', {headers: {'Content-Type': 'text/html'}});
  };
  return {calls, fetcher};
}

test('media API requires a session and refuses an article outside the selected room before fetching', async () => {
  const DB = database(), owner = await bootstrap(DB), other = await room(DB, owner, 'Other room');
  const id = 'a'.repeat(48), before = addPage(DB, other.id, id), p = publisher();
  assert.equal((await roomMediaAPI(raw('/api/room-media', 'POST', {id}), config(DB), p.fetcher)).status, 401);
  const request = await gated(DB, owner, '/api/room-media', 'POST', {id});
  assert.equal((await roomMediaAPI(request, config(DB), p.fetcher)).status, 404);
  assert.equal(p.calls.length, 0);
  assert.deepEqual(read(DB, id), before);
});

test('media append retains source text, annotation references and source identity; repeat checks use cache', async () => {
  const DB = database(), owner = await bootstrap(DB), id = 'b'.repeat(48), before = addPage(DB, DEFAULT_ROOM_ID, id), p = publisher();
  const request = () => gated(DB, owner, '/api/room-media', 'POST', {id});
  const response = await roomMediaAPI(await request(), config(DB), p.fetcher);
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.added, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const after = read(DB, id);
  assert.deepEqual(after.capture.blocks.slice(0, before.capture.blocks.length), before.capture.blocks);
  assert.deepEqual(after.annotations, before.annotations);
  assert.equal(after.capture.url, before.capture.url);
  assert.match(after.capture.blocks.at(-1).id, /^media-figure-/);
  assert.match(after.capture.blocks.at(-1).credit, /Photographer/);
  assert.equal(after.mediaDiscovery.receipts[0].originalPlacementVerified, false);
  assert.deepEqual({...DB.sql.prepare('SELECT source_hash,source_url,title FROM education_pages WHERE id=?').get(id)}, {source_hash: 'capture:'+id, source_url: articleURL, title});
  const cached = await (await roomMediaAPI(await request(), config(DB), p.fetcher)).json();
  assert.equal(cached.cached, true); assert.equal(cached.added, 0); assert.equal(p.calls.length, 2);
  assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n, 1);
});

test('daily room media check cap stops network work and retains the article', async () => {
  const DB = database(), owner = await bootstrap(DB), id = 'c'.repeat(48), before = addPage(DB, DEFAULT_ROOM_ID, id), p = publisher();
  const key = 'room-media:'+DEFAULT_ROOM_ID+':'+new Date().toISOString().slice(0,10);
  DB.sql.prepare('INSERT INTO education_counters(key,n) VALUES(?,20)').run(key);
  const result = await (await roomMediaAPI(await gated(DB, owner, '/api/room-media', 'POST', {id}), config(DB), p.fetcher)).json();
  assert.equal(result.added, 0); assert.match(result.message, /Today/);
  assert.equal(p.calls.length, 0); assert.deepEqual(read(DB, id), before);
});

test('media API rejects cross-origin and oversized requests without publisher access', async () => {
  const DB = database(), owner = await bootstrap(DB), id = 'd'.repeat(48); addPage(DB, DEFAULT_ROOM_ID, id); const p = publisher();
  const wrongOrigin = await gated(DB, owner, '/api/room-media', 'POST', {id}, {Origin: 'https://other.example'});
  assert.equal((await roomMediaAPI(wrongOrigin, config(DB), p.fetcher)).status, 403);
  const oversized = await gated(DB, owner, '/api/room-media', 'POST', {id, extra: 'x'.repeat(4000)});
  assert.equal((await roomMediaAPI(oversized, config(DB), p.fetcher)).status, 413);
  assert.equal(p.calls.length, 0);
});

test('optimistic update preserves a concurrent document change', async () => {
  const DB = database(), owner = await bootstrap(DB), id = 'e'.repeat(48); addPage(DB, DEFAULT_ROOM_ID, id); const p = publisher();
  const concurrent = read(DB, id); concurrent.annotations.push({blockId: 'B2', comment: 'Saved concurrently'});
  const fetcher = async (...args) => { DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(concurrent), id); return p.fetcher(...args); };
  const result = await (await roomMediaAPI(await gated(DB, owner, '/api/room-media', 'POST', {id}), config(DB), fetcher)).json();
  assert.equal(result.added, 0); assert.deepEqual(read(DB, id), concurrent);
});

test('public fallback is bounded and sends no reader cookies or private authorization to publishers', async () => {
  const calls = [], capture = {url: articleURL, title, blocks: []};
  const fetcher = async (url, options = {}) => {
    calls.push({url, options});
    if (!url.startsWith('https://api.deepseek.com/')) return new Response('', {status: 503});
    if (url.endsWith('/search')) return Response.json({results: [{url: 'https://social.example.org/video', title, content: '![Unrelated](https://images.example.org/social.jpg)'}, {url: articleURL, title, content: '[An ordinary link](https://example.org/)'}]});
    const input = JSON.parse(options.body);
    return Response.json({url: input.url, title, content: input.url === articleURL ? '![River](https://images.example.org/river.jpg)' : '[![Home card](https://images.example.org/home.jpg)]('+articleURL+')'});
  };
  const result = await collectArticleMedia(capture, config(null, {DEEPSEEK_API_KEY: 'test-key'}), fetcher);
  assert.deepEqual(result.blocks.map(b => b.url).sort(), ['https://images.example.org/home.jpg', 'https://images.example.org/river.jpg']);
  assert.equal(calls.filter(c => c.url.endsWith('/search')).length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/fetch')).length, 2);
  const checked=result.attempts.filter(a=>a.sourceType==='provider-fetch'&&a.state==='checked');assert.equal(checked.length,2);assert(checked.every(a=>a.imageReferences===1));
  assert.equal(calls.filter(c => !c.url.startsWith('https://api.deepseek.com/')).length, 2);
  assert.equal(calls.some(c => c.url.includes('completions')), false);
  for (const call of calls.filter(c => !c.url.startsWith('https://api.deepseek.com/'))) {
    const headers = new Headers(call.options.headers);
    assert.equal(headers.has('cookie'), false); assert.equal(headers.has('authorization'), false);
    assert.equal(call.options.redirect, 'manual');
  }
});

test('a pre-revision cached no-media result can recover while a current negative result is cached', async () => {
  const DB = database(), owner = await bootstrap(DB), id = '9'.repeat(48), p = publisher();
  addPage(DB, DEFAULT_ROOM_ID, id, {mediaDiscovery: {checkedAt: new Date().toISOString(), added: 0}});
  const request = () => gated(DB, owner, '/api/room-media', 'POST', {id});
  const result = await (await roomMediaAPI(await request(), config(DB), p.fetcher)).json();
  assert.equal(result.added, 1); assert.equal(read(DB,id).mediaDiscovery.extractorRevision, 2);
  const {mediaDiscoveryCached} = await import('./media-service.ts');
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:0}),false);
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:0,extractorRevision:2}),true);
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:1}),true);
  assert.equal(mediaDiscoveryCached({checkedAt:'2099-01-01',added:0,extractorRevision:2}),false);
});
