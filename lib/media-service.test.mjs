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

import {extractNewspaper} from './newspaper-core.mjs';
import {fixture} from './newspaper-fixture.mjs';
import {needsSunImageRepair} from './sun-media.mjs';
const sunURL='https://www.thesun.co.uk/news/12345678/fictional-story',sunPhoto='https://www.thesun.co.uk/wp-content/uploads/2026/10/synthetic-photo.jpg';
function sunHTML({headline='A fictional community report',second=true}={}){return fixture.replace('class="article-body"','class="single__content article__content"').replace('A fictional community report',headline).replace('src="https://images.example.org/story.jpg"','src="'+sunPhoto+'?w=960" srcset="'+sunPhoto+'?resize=300,208&amp;quality=90&amp;strip=all 300w, '+sunPhoto+'?resize=1024,708&amp;quality=90&amp;strip=all 1024w"').replace('</figure>', '</figure>'+(second?'<figure><img src="'+sunPhoto.replace('.jpg','-second.jpg')+'?w=960" width="960"><figcaption>Second synthetic source image.</figcaption></figure>':''));}
function addSunPage(DB,roomId,id,{method='public-url',second=true}={}){
 const capture=extractNewspaper(sunHTML({second}),sunURL);capture.presentation.method=method;const first=capture.blocks.find(b=>b.type==='figure');first.url=sunURL+'/208&quality=90&strip=all';
 const document=addPage(DB,roomId,id,{capture,annotations:[{blockId:capture.blocks[0].id,title:'Retained critique title',comment:'Retained critique sentinel',question:'Retained question?'}],model:'retained-model',usage:{prompt_tokens:123}});
 DB.sql.prepare('UPDATE education_pages SET source_url=?,title=?,comment=? WHERE id=?').run(sunURL,capture.title,'Owner comment sentinel',id);
 return document;
}

test('Sun repair replaces only diagnosed corrupt image URLs and preserves blocks, critique, comments and identity',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='c'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id),memberId=DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(DEFAULT_ROOM_ID).owner_id;
 DB.sql.prepare('INSERT INTO rr_room_comments(id,room_id,page_id,member_id,parent_id,request_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('sun-comment',DEFAULT_ROOM_ID,id,memberId,null,'sun-comment-request','Room comment sentinel','approved',new Date().toISOString(),new Date().toISOString());
 const comments=DB.sql.prepare('SELECT * FROM rr_room_comments').all(),metadata=DB.sql.prepare('SELECT source_hash,source_url,title,comment FROM education_pages WHERE id=?').get(id),calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(new URL(url).hostname,'thesun.co.uk');assert.equal(new URL(url).pathname,new URL(sunURL).pathname);assert.equal(new Headers(options.headers).has('cookie'),false);assert.equal(new Headers(options.headers).has('authorization'),false);return new Response(sunHTML(),{headers:{'content-type':'text/html'}});};
 const request=()=>gated(DB,owner,'/api/room-media','POST',{id});const response=await roomMediaAPI(await request(),config(DB,{DEEPSEEK_API_KEY:'must-not-call-provider'}),fetcher),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.repaired,1);assert.equal(result.added,0);assert.equal(result.repairStatus,'repaired');assert.equal(calls.length,1);
 const after=read(DB,id),expected=structuredClone(before);expected.capture.blocks.find(b=>b.type==='figure').url=sunPhoto+'?w=960';
 assert.deepEqual(after.capture,expected.capture);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.model,before.model);assert.deepEqual(after.usage,before.usage);assert.deepEqual(DB.sql.prepare('SELECT * FROM rr_room_comments').all(),comments);assert.deepEqual(DB.sql.prepare('SELECT source_hash,source_url,title,comment FROM education_pages WHERE id=?').get(id),metadata);
 assert.equal(after.sunImageRepair.parserRevision,3);assert.equal(after.sunImageRepair.replaced,1);assert.equal(after.sunImageRepair.figureCount,2);assert.deepEqual(after.sunImageRepair.blockIds,[before.capture.blocks.find(b=>b.type==='figure').id]);assert.equal(needsSunImageRepair(after.capture),false);
 const cached=await (await roomMediaAPI(await request(),config(DB),fetcher)).json();assert.equal(cached.cached,true);assert.equal(cached.repaired,0);assert.equal(calls.length,1);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n,1);
});

test('Sun repair refuses cross-room and cross-origin requests before a public fetch',async()=>{
 const DB=database(),owner=await bootstrap(DB),other=await room(DB,owner,'Other room'),id='d'.repeat(48),before=addSunPage(DB,other.id,id);let calls=0;const fetcher=async()=>{calls++;throw Error('No source request permitted');};
 assert.equal((await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),fetcher)).status,404);
 const gatedRequest=await gated(DB,other.cookie,'/api/room-media','POST',{id},{Origin:'https://evil.example'});assert.equal((await roomMediaAPI(gatedRequest,config(DB),fetcher)).status,403);assert.equal(calls,0);assert.deepEqual(read(DB,id),before);
});

test('Sun denial, headline mismatch, caption mismatch and gated content keep all retained article fields; negative repeats cache',async()=>{
 const cases=[
  {status:'blocked',response:()=>new Response('Denied',{status:403})},
  {status:'identity-mismatch',response:()=>new Response(sunHTML({headline:'An unrelated synthetic headline'}),{headers:{'content-type':'text/html'}})},
  {status:'identity-mismatch',response:()=>new Response('<link rel="canonical" href="https://www.thesun.co.uk/news/87654321/different-story/">'+sunHTML(),{headers:{'content-type':'text/html'}})},
  {status:'figure-identity-mismatch',response:()=>new Response(sunHTML().replace('The hall.','A changed image caption.'),{headers:{'content-type':'text/html'}})},
  {status:'unavailable',response:()=>new Response(sunHTML().replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>'),{headers:{'content-type':'text/html'}})},
  {status:'unavailable',response:()=>{throw Error('private-source-sentinel cardNumber=private-card');}}
 ];
 for(const item of cases){const DB=database(),owner=await bootstrap(DB),id='e'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id);let calls=0;const fetcher=async()=>{calls++;return item.response();},request=()=>gated(DB,owner,'/api/room-media','POST',{id});
  const response=await roomMediaAPI(await request(),config(DB,{DEEPSEEK_API_KEY:'must-not-call-provider'}),fetcher),result=await response.json();assert.equal(result.repaired,0);assert.equal(result.repairStatus,item.status);assert.equal(calls,1);
  const after=read(DB,id);assert.deepEqual(after.capture,before.capture);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.sunImageRepair.status,item.status);assert.doesNotMatch(JSON.stringify(after.sunImageRepair)+JSON.stringify(result),/private-source-sentinel|private-card|isAccessibleForFree/);
  const cached=await (await roomMediaAPI(await request(),config(DB),fetcher)).json();assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n,1);
 }
});

test('Sun public source redirect to a different article cannot replace image URLs',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='f'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id);let calls=0;
 const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>{calls++;return calls===1?new Response(null,{status:302,headers:{location:'https://www.thesun.co.uk/news/87654321/different-story/'}}):new Response(sunHTML(),{headers:{'content-type':'text/html'}});});
 assert.equal((await response.json()).repairStatus,'identity-mismatch');assert.equal(calls,2);assert.deepEqual(read(DB,id).capture,before.capture);
});

test('Sun repair uses existing media limit and compare-and-swap to preserve a concurrent document edit',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='1'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id),counter='room-media:'+DEFAULT_ROOM_ID+':'+new Date().toISOString().slice(0,10);DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run(counter,20);let calls=0;const request=()=>gated(DB,owner,'/api/room-media','POST',{id});
 const capped=await (await roomMediaAPI(await request(),config(DB),async()=>{calls++;throw Error();})).json();assert.match(capped.message,/media checks are used/);assert.equal(calls,0);assert.deepEqual(read(DB,id),before);
 DB.sql.prepare('UPDATE education_counters SET n=0 WHERE key=?').run(counter);const concurrent=structuredClone(before);concurrent.annotations.push({blockId:'B1',title:'Concurrent review',comment:'Do not overwrite this edit.'});
 const result=await (await roomMediaAPI(await request(),config(DB),async()=>{calls++;DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(concurrent),id);return new Response(sunHTML(),{headers:{'content-type':'text/html'}});})).json();assert.equal(result.repaired,0);assert.match(result.message,/Another reader updated/);assert.deepEqual(read(DB,id),concurrent);assert.equal(calls,1);
});

test('Sun repair does not widen non-Sun, saved-HTML or healthy public captures',async()=>{
 const DB=database(),owner=await bootstrap(DB);let calls=0;
 for(const [id,setup] of [['2'.repeat(48),()=>addSunPage(DB,DEFAULT_ROOM_ID,'2'.repeat(48),{method:'saved-html'})],['3'.repeat(48),()=>{const doc=addSunPage(DB,DEFAULT_ROOM_ID,'3'.repeat(48));doc.capture.url='https://theguardian.com/news/fictional-story';DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(doc),'3'.repeat(48));return doc;}],['4'.repeat(48),()=>{const doc=addSunPage(DB,DEFAULT_ROOM_ID,'4'.repeat(48));doc.capture.blocks.find(b=>b.type==='figure').url=sunPhoto;DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(doc),'4'.repeat(48));return doc;}]]){const before=setup();const result=await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>{calls++;throw Error('No new fetch expected');})).json();assert.equal(result.added,0);assert.equal(calls,0);assert.deepEqual(read(DB,id),before);}
});

test('room source details expose the bounded Sun repair action and omit laptop capture links',()=>{
 const source=readFileSync(new URL('./room-reader.ts',import.meta.url),'utf8');assert.match(source,/needsSunImageRepair/);assert.match(source,/Repair source images/);assert.match(source,/result\.added\|\|result\.repaired/);assert.doesNotMatch(source,/Capture from Chrome|page-lens-connect/);
});

const indexedTelegraphURL='https://www.telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/',indexedTelegraphTitle='Historic clock tower falls as France burns on day of violent protests';
function addIndexedTelegraphPage(DB,id,changes={}){const oldMedia={id:'saved-old-media',type:'video',url:'https://cf-particle-html.eip.telegraph.co.uk/fictional-community/player.html',caption:'Retained source video'};const doc=addPage(DB,DEFAULT_ROOM_ID,id,{mediaDiscovery:{checkedAt:new Date().toISOString(),extractorRevision:3,added:0,receipts:[{id:oldMedia.id,basis:'retained-public-proof'}],attempts:[{state:'blocked',sourceType:'publisher-preview'}]}});doc.capture.url=indexedTelegraphURL;doc.capture.title=indexedTelegraphTitle+' - Retained library deck.';doc.capture.publisher='The Telegraph';doc.capture.blocks.push({id:'discovered-media-heading',type:'heading',text:'Images & video'},oldMedia);Object.assign(doc.capture,changes);DB.sql.prepare('UPDATE education_pages SET source_url=?,title=?,document=?,comment=? WHERE id=?').run(indexedTelegraphURL,indexedTelegraphTitle,JSON.stringify(doc),'Retained owner comment sentinel',id);return doc;}

test('verified Telegraph thumbnail bypasses only its missing-item cache and appends once with no external request',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='5'.repeat(48),before=addIndexedTelegraphPage(DB,id),metadata=DB.sql.prepare('SELECT source_hash,source_url,title,comment FROM education_pages WHERE id=?').get(id);let calls=0;const never=async()=>{calls++;throw Error('No publisher, Google, provider or CDN fetch permitted');};
 const fresh=await collectArticleMedia(before.capture,config(DB,previewConfig),never);assert.equal(fresh.blocks.length,1);assert.equal(fresh.attempts[0].sourceType,'verified-public-index');assert.equal(calls,0);
 const request=()=>gated(DB,owner,'/api/room-media','POST',{id}),response=await roomMediaAPI(await request(),config(DB,previewConfig),never),result=await response.json();assert.equal(response.status,200);assert.equal(result.added,1);assert.equal(calls,0);
 const after=read(DB,id);assert.deepEqual(after.capture.blocks.slice(0,before.capture.blocks.length),before.capture.blocks);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.capture.blocks.filter(b=>b.id==='discovered-media-heading').length,1);assert.equal(after.capture.blocks.at(-1).basis,'exact-article-public-index-thumbnail');assert.equal(after.capture.blocks.at(-1).originalPlacementVerified,false);assert.equal(after.mediaDiscovery.receipts[0].basis,'retained-public-proof');assert.equal(after.mediaDiscovery.receipts.at(-1).indexURL,'https://www.google.com/search?q=%22Historic+clock+tower+falls%22+Telegraph&udm=2');assert.deepEqual(DB.sql.prepare('SELECT source_hash,source_url,title,comment FROM education_pages WHERE id=?').get(id),metadata);
 const cached=await (await roomMediaAPI(await request(),config(DB,previewConfig),never)).json();assert.equal(cached.cached,true);assert.equal(cached.added,0);assert.equal(calls,0);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n,1);assert.equal((await collectArticleMedia(after.capture,config(DB,previewConfig),never)).blocks.length,0);assert.equal(calls,0);
});

test('wrong headline, source identity and foreign room never receive the curated Telegraph thumbnail',async()=>{
 const DB=database(),owner=await bootstrap(DB),other=await room(DB,owner,'Foreign room');let calls=0;const never=async()=>{calls++;throw Error('No fetch expected for cached mismatch');};
 for(const [id,changes] of [['6'.repeat(48),{title:'Unrelated headline'}],['7'.repeat(48),{url:indexedTelegraphURL.replace('mass-protests','different-story')}]]){const before=addIndexedTelegraphPage(DB,id,changes),response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB,previewConfig),never);assert.equal((await response.json()).cached,true);assert.deepEqual(read(DB,id),before);}
 const id='8'.repeat(48),before=addIndexedTelegraphPage(DB,id);assert.equal((await roomMediaAPI(await gated(DB,other.cookie,'/api/room-media','POST',{id}),config(DB,previewConfig),never)).status,404);assert.deepEqual(read(DB,id),before);
 DB.sql.prepare('UPDATE education_pages SET source_url=? WHERE id=?').run('https://telegraph.co.uk/other-story/',id);const mismatch=await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB,previewConfig),never)).json();assert.equal(mismatch.added,0);assert.match(mismatch.message,/source identity/);assert.equal(calls,0);
});

test('Sun revision2 tolerates changed image count and source reordering only through unique caption matches',async()=>{
 for(const mode of ['removed-other-image','reordered']){const DB=database(),owner=await bootstrap(DB),id='9'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id);before.sunImageRepair={checkedAt:new Date().toISOString(),parserRevision:1,status:'figure-count-mismatch',replaced:0};DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(before),id);let html=sunHTML({second:mode!=='removed-other-image'});if(mode==='reordered'){const figures=html.match(/<figure>[\s\S]*?<\/figure>/g);html=html.replace(figures[0],'REORDERED_FIRST_FIGURE').replace(figures[1],figures[0]).replace('REORDERED_FIRST_FIGURE',figures[1]);}let calls=0;const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>{calls++;return new Response(html,{headers:{'content-type':'text/html'}});});const result=await response.json();assert.equal(result.repaired,1,mode);assert.equal(calls,1);const after=read(DB,id),expected=structuredClone(before.capture);expected.blocks.find(b=>b.type==='figure').url=sunPhoto+'?w=960';assert.deepEqual(after.capture,expected);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.sunImageRepair.parserRevision,3);assert.match(after.sunImageRepair.basis,/unique-nonempty-caption-match/);}
});

test('Sun revision2 rejects ambiguous captions and empty saved captions without partial replacement',async()=>{
 for(const mode of ['ambiguous-fresh','empty-old','duplicate-old']){const DB=database(),owner=await bootstrap(DB),id='a'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id);let html=sunHTML();if(mode==='ambiguous-fresh')html=html.replace('Second synthetic source image.','The hall.');if(mode==='empty-old')before.capture.blocks.find(b=>b.type==='figure').caption='';if(mode==='duplicate-old'){const figures=before.capture.blocks.filter(b=>b.type==='figure');figures[1].caption=figures[0].caption;figures[1].url=sunURL+'/708&quality=90&strip=all';}DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(before),id);const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>new Response(html,{headers:{'content-type':'text/html'}}));assert.equal((await response.json()).repairStatus,'figure-identity-mismatch',mode);assert.deepEqual(read(DB,id).capture,before.capture);}
});

test('Sun partial repair fixes two uniquely captioned images and retains a generic unmatched third image',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='b'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id),figures=before.capture.blocks.filter(b=>b.type==='figure');figures[1].url=sunURL+'/708&quality=90&strip=all';before.capture.blocks.push({id:'unverified-old-figure',type:'figure',url:sunURL+'/35&quality=90&strip=all',caption:'Source article image',credit:'',style:{},rect:{width:660,height:400}});before.sunImageRepair={parserRevision:2,checkedAt:new Date().toISOString(),status:'figure-identity-mismatch',replaced:0};DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(before),id);let calls=0;const request=()=>gated(DB,owner,'/api/room-media','POST',{id}),fetcher=async()=>{calls++;return new Response(sunHTML(),{headers:{'content-type':'text/html'}});};
 const result=await (await roomMediaAPI(await request(),config(DB),fetcher)).json();assert.equal(result.repaired,2);assert.equal(result.unresolved,1);assert.equal(result.repairStatus,'partial');assert.match(result.message,/2 source image links repaired; 1 could not be verified/);assert.equal(calls,1);
 const after=read(DB,id),expected=structuredClone(before.capture);expected.blocks.find(b=>b.id===figures[0].id).url=sunPhoto+'?w=960';expected.blocks.find(b=>b.id===figures[1].id).url=sunPhoto.replace('.jpg','-second.jpg')+'?w=960';assert.deepEqual(after.capture,expected);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.sunImageRepair.parserRevision,3);assert.deepEqual(after.sunImageRepair.unresolvedIds,['unverified-old-figure']);assert.equal(after.sunImageRepair.unresolvedCount,1);assert.deepEqual(after.sunImageRepair.blockIds,figures.map(b=>b.id));
 const cached=await (await roomMediaAPI(await request(),config(DB),fetcher)).json();assert.equal(cached.cached,true);assert.equal(cached.repaired,0);assert.equal(cached.unresolved,1);assert.equal(calls,1);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n,1);
});

test('Sun partial repair never replaces an ambiguous or changed-caption image while repairing an independent match',async()=>{
 for(const mode of ['changed-caption','ambiguous-caption']){const DB=database(),owner=await bootstrap(DB),id='c'.repeat(48),before=addSunPage(DB,DEFAULT_ROOM_ID,id),figures=before.capture.blocks.filter(b=>b.type==='figure');figures[1].url=sunURL+'/708&quality=90&strip=all';DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(before),id);let html=sunHTML();if(mode==='changed-caption')html=html.replace('Second synthetic source image.','A changed caption with no matching saved identity.');else html=html.replace('</div></article>','<figure><img src="'+sunPhoto.replace('.jpg','-duplicate.jpg')+'" width="960"><figcaption>Second synthetic source image.</figcaption></figure></div></article>');
  const result=await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),async()=>new Response(html,{headers:{'content-type':'text/html'}}))).json();assert.equal(result.repaired,1,mode);assert.equal(result.unresolved,1);assert.equal(result.repairStatus,'partial');const after=read(DB,id),expected=structuredClone(before.capture);expected.blocks.find(b=>b.id===figures[0].id).url=sunPhoto+'?w=960';assert.deepEqual(after.capture,expected);assert.equal(after.capture.blocks.find(b=>b.id===figures[1].id).url,figures[1].url);assert.deepEqual(after.sunImageRepair.unresolvedIds,[figures[1].id]);
 }
});

const observerMediaURL='https://observer.co.uk/news/national/article/fictional-community-compares-river-crossings',observerMediaTitle='Fictional community compares river crossings';
const observerMediaHTML='<!doctype html><html><head><link rel="canonical" href="'+observerMediaURL+'"><meta property="og:title" content="'+observerMediaTitle+'"><meta property="og:image" content="https://images.example.org/observer-preview.jpg"></head><body><script type="application/ld+json">{"isAccessibleForFree":false,"articleBody":"PAID_OBSERVER_SENTINEL"}</script><article><p>PAID_OBSERVER_SENTINEL</p><img src="https://images.example.org/paid-observer-body.jpg"></article></body></html>';
function addObserverMediaPage(DB,id){const doc=addPage(DB,DEFAULT_ROOM_ID,id);doc.capture.url=observerMediaURL;doc.capture.title=observerMediaTitle;doc.capture.publisher='The Observer · Camden NewsBank text edition';DB.sql.prepare('UPDATE education_pages SET source_url=?,title=?,document=? WHERE id=?').run(observerMediaURL,observerMediaTitle,JSON.stringify(doc),id);return doc;}
test('Observer library-only media appends one labelled public thumbnail without changing prose, AI or source identity; repeats cache',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='9'.repeat(48),before=addObserverMediaPage(DB,id),metadata=DB.sql.prepare('SELECT source_hash,source_url,title FROM education_pages WHERE id=?').get(id);let calls=0;
 const fetcher=async(address,options)=>{calls++;assert.equal(address,observerMediaURL);assert.equal(new Headers(options.headers).has('cookie'),false);return new Response(observerMediaHTML,{headers:{'Content-Type':'text/html'}});};
 const response=await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB,{DEEPSEEK_API_KEY:'no-provider-fallback'}),fetcher);assert.equal(response.status,200);assert.equal((await response.json()).added,1);assert.equal(calls,1);
 const after=read(DB,id);assert.deepEqual(after.capture.blocks.slice(0,before.capture.blocks.length),before.capture.blocks);assert.deepEqual(after.annotations,before.annotations);assert.deepEqual(DB.sql.prepare('SELECT source_hash,source_url,title FROM education_pages WHERE id=?').get(id),metadata);assert.equal(after.capture.blocks.at(-1).basis,'exact-article-public-preview-thumbnail');assert.match(after.capture.blocks.at(-1).credit,/public article preview thumbnail/);assert.equal(after.mediaDiscovery.receipts[0].sourceURL,observerMediaURL);assert.doesNotMatch(JSON.stringify(after),/PAID_OBSERVER|paid-observer-body/);
 const telemetry=mediaCheckTelemetry(after.capture,after.mediaDiscovery);assert.equal(telemetry.publisher,'observer.co.uk');assert.equal(telemetry.checks[0].type,'library-public-metadata');
 const cached=await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),fetcher)).json();assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key LIKE ?').get('room-media:%').n,1);
});
test('Observer refusal stops once and caches safely; stored source mismatch stops before any request',async()=>{
 const DB=database(),owner=await bootstrap(DB),id='8'.repeat(48),before=addObserverMediaPage(DB,id);let calls=0;const fetcher=async()=>{calls++;return new Response('PRIVATE_DENIAL_SENTINEL',{status:403});};
 assert.equal((await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB,{DEEPSEEK_API_KEY:'no-provider-fallback'}),fetcher)).json()).added,0);assert.equal(calls,1);const after=read(DB,id);assert.deepEqual(after.capture,before.capture);assert.equal(after.mediaDiscovery.attempts[0].state,'blocked');assert.doesNotMatch(JSON.stringify(after),/PRIVATE_DENIAL/);
 assert.equal((await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id}),config(DB),fetcher)).json()).cached,true);assert.equal(calls,1);
 const next='7'.repeat(48);addObserverMediaPage(DB,next);DB.sql.prepare('UPDATE education_pages SET source_url=? WHERE id=?').run(observerMediaURL+'-different',next);const mismatch=await (await roomMediaAPI(await gated(DB,owner,'/api/room-media','POST',{id:next}),config(DB),fetcher)).json();assert.equal(mismatch.added,0);assert.match(mismatch.message,/identity does not match/);assert.equal(calls,1);
});
