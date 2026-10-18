import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {memberAuthAPI,memberAuthGate,roomsAPI} from './member-auth.ts';
import {DEFAULT_ROOM_ID} from './rooms.ts';
import {roomMediaAPI,collectArticleMedia,mediaCheckTelemetry,mediaAvailabilityMessage} from './media-service.ts';
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
  assert.equal(result.added, 1); assert.equal(read(DB,id).mediaDiscovery.extractorRevision, 3);
  const {mediaDiscoveryCached} = await import('./media-service.ts');
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:0}),false);assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:0,extractorRevision:2}),false);
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:0,extractorRevision:3}),true);
  assert.equal(mediaDiscoveryCached({checkedAt:new Date().toISOString(),added:1}),true);
  assert.equal(mediaDiscoveryCached({checkedAt:'2099-01-01',added:0,extractorRevision:2}),false);
});

import {discoverArticleMedia} from './article-media.mjs';
const previewConfig={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'example-test-secret-only-not-a-real-key-1234',DEEPSEEK_API_KEY:'must-not-be-used'};
function telegraphPreview(url,sourceTitle='Fictional community compares river crossings'){return {status:'publisher-preview',state:'available',sourceURL:url,title:sourceTitle,date:'2026-10-18',checkedAt:new Date().toISOString(),...discoverArticleMedia({url,title:sourceTitle,blocks:[]},[{url,html:'<link rel="canonical" href="'+url+'"><meta property="og:video" content="https://cf-particle-html.eip.telegraph.co.uk/community/player.html?clip='+new URL(url).pathname.split('/').filter(Boolean).at(-1)+'"><meta property="og:image" content="https://images.example.org/community.jpg">'}]),httpStatus:200,reasonCode:'public_metadata'};}
test('configured Telegraph automatic media uses URL-only AWS preview without Mac/account or duplicate public/provider fetches',async()=>{for(const slug of ['fictional-community-river','fictional-second-crossing']){const url='https://telegraph.co.uk/news/2026/10/18/'+slug+'/',calls=[],capture={url,title:'Fictional community compares river crossings - A library standfirst.',blocks:[{id:'B1',type:'paragraph',text:'Retained library prose.'}]},before=JSON.stringify(capture);const result=await collectArticleMedia(capture,config(null,previewConfig),async(address,init)=>{calls.push(address);assert.equal(address,'https://lambda.eu-west-1.amazonaws.com/2015-03-31/functions/reading-room-library/invocations');assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(),['action','url']);return Response.json(telegraphPreview(url));});assert.equal(calls.length,1);assert.equal(result.blocks.filter(b=>b.type==='video').length,1);assert.match(result.blocks.find(b=>b.type==='video').url,new RegExp(slug));assert.equal(JSON.stringify(capture),before);assert.equal(result.attempts[0].sourceType,'publisher-preview');}});
test('hard denied Telegraph preview is terminal with clear fixed attempts and no alternate source retry',async()=>{const url='https://telegraph.co.uk/news/2026/10/18/fictional-community-river/',capture={url,title:'Fictional community compares river crossings',blocks:[]};for(const code of [402,403]){let calls=0;const result=await collectArticleMedia(capture,config(null,previewConfig),async()=>{calls++;return Response.json({...telegraphPreview(url),state:'blocked',blocks:[],receipts:[],httpStatus:code,reasonCode:'http_denied'});});assert.equal(calls,1);assert.equal(result.blocks.length,0);assert.equal(result.attempts[0].state,'blocked');assert.equal(result.attempts[0].httpStatus,code);}});
test('exact URL cannot substitute an unrelated headline; prefetched preview avoids another invocation and deduplicates',async()=>{const url='https://telegraph.co.uk/news/2026/10/18/fictional-community-river/',preview=telegraphPreview(url),capture={url,title:'Fictional community compares river crossings',blocks:[preview.blocks[0]]};const never=async()=>{throw Error('Prefetched evidence must not fetch');};const matched=await collectArticleMedia(capture,config(null,previewConfig),never,undefined,preview);assert.equal(matched.blocks.length,1);const wrong=await collectArticleMedia({...capture,title:'Unrelated election opinion and new cabinet policy'},config(null,previewConfig),never,undefined,preview);assert.equal(wrong.blocks.length,0);assert.equal(wrong.attempts[0].state,'identity-mismatch');const invalid=await collectArticleMedia(capture,config(null,previewConfig),never,undefined,{...preview,sourceURL:'https://telegraph.co.uk/news/2026/10/18/different/'});assert.equal(invalid.blocks.length,0);assert.equal(invalid.attempts[0].state,'unavailable');});

test('internal prefetched room media adds validated media once while HTTP body cannot select evidence',async()=>{const DB=database(),owner=await bootstrap(DB),url='https://telegraph.co.uk/news/2026/10/18/fictional-community-river/',preview=telegraphPreview(url);function saved(id){addPage(DB,DEFAULT_ROOM_ID,id);const doc=read(DB,id);doc.capture.url=url;doc.capture.title=preview.title;DB.sql.prepare('UPDATE education_pages SET source_url=?,document=? WHERE id=?').run(url,JSON.stringify(doc),id);return doc;}const first='8'.repeat(48),before=saved(first);const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id:first}),config(DB,previewConfig),async()=>{throw Error('Prefetched preview must not invoke again');},{publisherPreview:preview});assert.equal((await response.json()).added,2);const after=read(DB,first);assert.equal(after.capture.blocks[0].text,before.capture.blocks[0].text);assert.deepEqual(after.annotations,before.annotations);const second='7'.repeat(48);saved(second);let calls=0;const denied=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id:second,publisherPreview:preview}),config(DB,previewConfig),async()=>{calls++;return Response.json({...preview,state:'blocked',reasonCode:'http_denied',httpStatus:403,blocks:[],receipts:[]});});assert.equal((await denied.json()).added,0);assert.equal(calls,1);assert.equal(read(DB,second).capture.blocks.some(b=>b.type==='video'),false);});

test('saved video availability survives a blocked latest check without implying playback is verified',()=>{const document={capture:{blocks:[{type:'video',url:'https://cf-particle-html.eip.telegraph.co.uk/fictional-community/player.html'}]},mediaDiscovery:{checkedAt:new Date().toISOString(),added:0,attempts:[{state:'blocked'}]}};assert.match(mediaAvailabilityMessage(document),/Source video links are saved/);assert.match(mediaAvailabilityMessage(document),/latest automatic check added no more media/);assert.doesNotMatch(mediaAvailabilityMessage(document),/Chrome|no matching|will play|did not supply/);assert.match(mediaAvailabilityMessage({...document,capture:{blocks:[]}}),/could not obtain public media/);assert.match(mediaAvailabilityMessage({...document,mediaDiscovery:{checkedAt:new Date().toISOString(),added:1}}),/Source video links are saved/);assert.doesNotMatch(mediaAvailabilityMessage({...document,mediaDiscovery:{checkedAt:new Date().toISOString(),added:1}}),/added no more/);});
test('cached no-add media response reports retained source video instead of absent media',async()=>{const DB=database(),owner=await bootstrap(DB),id='6'.repeat(48);const original=addPage(DB,DEFAULT_ROOM_ID,id,{mediaDiscovery:{checkedAt:new Date().toISOString(),extractorRevision:3,added:0,attempts:[{state:'blocked',sourceType:'publisher-preview'}]}});original.capture.blocks.push({id:'saved-video',type:'video',url:'https://cf-particle-html.eip.telegraph.co.uk/fictional-community/player.html'});DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(original),id);const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>{throw Error('Cached result must not fetch');});const result=await response.json();assert.equal(result.cached,true);assert.match(result.message,/Source video links are saved/);assert.match(result.message,/added no more media/);assert.deepEqual(read(DB,id),original);});
test('fresh check adding nothing reports retained media and public-added success wording remains',async()=>{const DB=database(),owner=await bootstrap(DB),id='5'.repeat(48),original=addPage(DB,DEFAULT_ROOM_ID,id);original.capture.blocks.push({id:'saved-video',type:'video',url:'https://cf-particle-html.eip.telegraph.co.uk/fictional-community/player.html'});DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(original),id);const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>new Response('',{status:403}));const result=await response.json();assert.equal(result.added,0);assert.match(result.message,/Source video links are saved/);assert.match(result.message,/added no more media/);const next='4'.repeat(48);addPage(DB,DEFAULT_ROOM_ID,next);const added=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id:next}),config(DB),publisher().fetcher);assert.equal((await added.json()).message,'Matched public source media added.');});
