import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { memberAuthAPI, memberAuthGate, roomsAPI } from './member-auth.ts';
import {roomCaptureAPI} from './room-capture.ts';
import {extractNewspaper} from './newspaper-core.mjs';
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
async function room(DB, cookie, name) { const response = await roomsAPI(raw('/api/rooms', 'POST', { action: 'create', name }, cookie), config(DB), now); assert.equal(response.status, 201); return { cookie: cookies(response, cookie), id: (await response.json()).room.id }; }
async function gated(DB, cookie, path, method = 'GET', body, headers = {}) { const request = await memberAuthGate(raw(path, method, body, cookie, headers), config(DB), now); assert(request instanceof Request, `${path} must pass session gate`); assert(request.headers.get('x-ret-member-id')); assert(request.headers.get('x-rr-room-id')); return request; }
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


test('review capture imports only into the selected nondefault room and cannot leak to another room',async()=>{
 const DB=database(),owner=await bootstrap(DB),second=await room(DB,owner,'Capture room'),p=provider(),capture=extractNewspaper(fixture,articleURL);
 const response=await roomCaptureAPI(await gated(DB,second.cookie,'/api/room-capture','POST',{capture,requestId:crypto.randomUUID()}),config(DB),p.fetcher),data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.href,'/read/'+data.id+'?room='+second.id);assert.equal(await accessiblePage(await gated(DB,owner,'/api/room-articles'),config(DB),data.id),false);assert.equal(await accessiblePage(await gated(DB,second.cookie,'/api/room-articles'),config(DB),data.id),true);
});
test('capture imports reject absent room, cross-origin writes, short previews and explicit access gates without provider use',async()=>{
 const DB=database(),owner=await bootstrap(DB);let calls=0;const fetcher=async()=>{calls++;throw Error('No call expected');};const capture=extractNewspaper(fixture,articleURL);
 assert.equal((await roomCaptureAPI(raw('/api/room-capture','POST',{}),config(DB),fetcher)).status,401);
 for(const [value,headers,status] of [[capture,{Origin:'https://evil.example'},403],[{...capture,blocks:[{type:'paragraph',text:'Preview only'}]}, {},400],[{...capture,diagnostics:{accessBlocked:true}}, {},400],[{...capture,blocks:[{type:'paragraph',text:'Subscribe to continue reading this article'}]}, {},400]]){
 const request=await gated(DB,owner,'/api/room-capture','POST',{capture:value,requestId:crypto.randomUUID()},headers);assert.equal((await roomCaptureAPI(request,config(DB),fetcher)).status,status);
 }assert.equal(calls,0);
});

const mediaCapture=(extra={})=>({schema:'ret-media/v1',url:articleURL,title:'Visible media fixture',capturedAt:new Date(now).toISOString(),viewport:{width:1200,height:800},media:[{type:'figure',url:'https://images.example.org/fixture.jpg',caption:'<b>Original caption</b>',credit:'Example photographer',rect:{x:10,y:200,width:600,height:400}},{type:'video',url:'https://youtu.be/AbCdEfGh123',poster:'https://images.example.org/poster.jpg'}],diagnostics:{visibleOnly:true},...extra});
function savedArticle(DB,roomId,id='c'.repeat(48),url=articleURL){
 const document={kind:'rendered-capture-v1',capture:extractNewspaper(fixture,url),annotations:[{blockId:'B1',comment:'Preserved annotation'}],mediaDiscovery:{checkedAt:'old',added:0}};
 const owner=DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(roomId).owner_id;
 DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,comment,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'hash-'+id,url,'Original stored title',JSON.stringify(document),'Preserved comment',new Date(now).toISOString());
 DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomId,id,owner,new Date(now).toISOString());return {id,document};
}
test('reviewed media appends only to exact saved room article, deduplicates, and preserves source identity',async()=>{
 const DB=database(),owner=await bootstrap(DB),second=await room(DB,owner,'Other room'),saved=savedArticle(DB,DEFAULT_ROOM_ID),before=DB.sql.prepare('SELECT * FROM education_pages WHERE id=?').get(saved.id);let calls=0;const fetcher=async()=>{calls++;throw Error('No provider or publisher call');};
 const request=()=>gated(DB,owner,'/api/room-capture','POST',{action:'media',capture:mediaCapture()});
 const response=await roomCaptureAPI(await request(),config(DB),fetcher),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.added,2);assert.equal(data.href,'/read/'+saved.id+'?room='+DEFAULT_ROOM_ID);
 const row=DB.sql.prepare('SELECT * FROM education_pages WHERE id=?').get(saved.id),document=JSON.parse(row.document);for(const key of ['id','source_hash','source_url','title','comment','created_at'])assert.equal(row[key],before[key]);assert.deepEqual(document.annotations,saved.document.annotations);assert.deepEqual(document.mediaDiscovery,saved.document.mediaDiscovery);assert.deepEqual(document.capture.blocks.slice(0,saved.document.capture.blocks.length),saved.document.capture.blocks);assert.equal(document.capture.title,saved.document.capture.title);
 const added=document.capture.blocks.slice(-2);assert.equal(added[0].provenance.basis,'measured-visible-browser-media');assert.equal(added[0].provenance.originalPositionVerified,false);assert.equal(added[0].caption,'<b>Original caption</b>');assert.equal(added[1].url,'https://www.youtube-nocookie.com/embed/AbCdEfGh123');assert.equal(new Set(document.capture.blocks.map(b=>b.id)).size,document.capture.blocks.length);
 const repeat=await roomCaptureAPI(await request(),config(DB),fetcher);assert.equal((await repeat.json()).added,0);assert.equal(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document,row.document);
 const outside=await roomCaptureAPI(await gated(DB,second.cookie,'/api/room-capture','POST',{action:'media',capture:mediaCapture()}),config(DB),fetcher);assert.equal(outside.status,404);assert.equal(calls,0);
});
test('media import refuses unsafe URLs, unknown prose, missing targets and ambiguous editions',async()=>{
 const DB=database(),owner=await bootstrap(DB);savedArticle(DB,DEFAULT_ROOM_ID);
 const attempt=async capture=>roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture}),config(DB));
 for(const url of ['javascript:alert(1)','data:image/png;base64,a','https://user:pass@images.example.org/a.jpg','https://127.0.0.1/a.jpg','https://private.internal/a.jpg','https://images.example.org/a.jpg?utm_source=x&token=secret','https://[::ffff:127.0.0.1]/a.jpg'])assert.equal((await attempt(mediaCapture({media:[{type:'figure',url}]}))).status,400,url);
 for(const capture of [mediaCapture({blocks:[{type:'paragraph',text:'Do not import prose'}]}),mediaCapture({diagnostics:{visibleOnly:false}}),mediaCapture({media:Array.from({length:21},()=>({type:'figure',url:'https://images.example.org/a.jpg'}))}),mediaCapture({url:'https://theguardian.com/other-story'}),mediaCapture({url:'https://theguardian.com.evil.example/fictional/room-story'})])assert.ok([400,404].includes((await attempt(capture)).status));
 const cross=await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture:mediaCapture()},{Origin:'https://evil.example'}),config(DB));assert.equal(cross.status,403);
 assert.equal((await roomCaptureAPI(raw('/api/room-capture','POST',{action:'media',capture:mediaCapture()}),config(DB))).status,401);
 savedArticle(DB,DEFAULT_ROOM_ID,'d'.repeat(48));assert.equal((await attempt(mediaCapture())).status,409);
});
test('Times changed slug identity works and unsupported players retain only a labelled safe poster',async()=>{
 const DB=database(),owner=await bootstrap(DB),url='https://thetimes.com/uk/article/original-slug-abc123def';savedArticle(DB,DEFAULT_ROOM_ID,'e'.repeat(48),url);
 const capture=mediaCapture({url:'https://www.thetimes.com/world/article/changed-slug-abc123def',media:[{type:'video',url:'https://player.example.org/unsupported',poster:'https://images.example.org/visible-poster.jpg'}]});
 const response=await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture}),config(DB));assert.equal(response.status,200);const doc=JSON.parse(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get('e'.repeat(48)).document);const last=doc.capture.blocks.at(-1);assert.equal(last.type,'figure');assert.match(last.caption,/Poster only.*not supported/);assert.equal(last.url,'https://images.example.org/visible-poster.jpg');
 capture.url=capture.url.replace('abc123def','xyz987uvw');assert.equal((await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture}),config(DB))).status,404);
 const oversized=await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture:mediaCapture(),junk:'x'.repeat(1048577)}),config(DB));assert.equal(oversized.status,413);
});
test('revoked room membership and concurrent document changes prevent media writes',async()=>{
 const DB=database(),owner=await bootstrap(DB),saved=savedArticle(DB,DEFAULT_ROOM_ID),input={action:'media',capture:mediaCapture()};
 const request=await gated(DB,owner,'/api/room-capture','POST',input);
 DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=?').run(new Date(now).toISOString(),DEFAULT_ROOM_ID);
 assert.equal((await roomCaptureAPI(request,config(DB))).status,403);
 DB.sql.prepare('UPDATE rr_room_members SET revoked_at=NULL WHERE room_id=?').run(DEFAULT_ROOM_ID);
 const original=DB.prepare.bind(DB);DB.prepare=query=>{const statement=original(query);if(!query.startsWith('UPDATE education_pages SET document='))return statement;return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,run:async()=>{DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify({...saved.document,concurrentReview:'Preserved'}),saved.id);return bound.run();}};}};};
 const conflict=await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',input),config(DB));assert.equal(conflict.status,409);const stored=JSON.parse(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document);assert.equal(stored.concurrentReview,'Preserved');assert.deepEqual(stored.capture.blocks,saved.document.capture.blocks);
});
test('import preserves rendered article viewport provenance without claiming physical-screen focus',async()=>{for(const remote of [true,false]){const DB=database(),owner=await bootstrap(DB),saved=savedArticle(DB,DEFAULT_ROOM_ID);const diagnostics=remote?{visibleOnly:true,viewportBasis:'rendered-enabled-tab',osFocusVerified:false}:{visibleOnly:true};const response=await roomCaptureAPI(await gated(DB,owner,'/api/room-capture','POST',{action:'media',capture:mediaCapture({diagnostics})}),config(DB));assert.equal(response.status,200);const doc=JSON.parse(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document);const provenance=doc.capture.blocks.at(-1).provenance;assert.equal(provenance.viewportBasis,remote?'rendered-enabled-tab':'manually-reviewed-rendered-viewport');assert.equal(provenance.osFocusVerified,false);assert.equal(provenance.originalPositionVerified,false);assert.deepEqual(doc.capture.blocks.slice(0,saved.document.capture.blocks.length),saved.document.capture.blocks);}});
