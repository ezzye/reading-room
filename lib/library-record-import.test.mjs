import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {librarySearchAPI} from './library-search.ts';
import {libraryRecordImportAPI} from './library-record-import.ts';
import {roomArticlesAPI} from './room-articles.ts';
import {resourceLookupAPI} from './resource-service.ts';
import {createLibraryPageProof} from './library-page-proof.mjs';
import {bindRoomLibraryProof,claimRoomLibraryRecord,releaseRoomLibraryRecord,reuseVerifiedLibraryPage,roomLibraryAlias,roomVerifiedLibraryRecord,libraryReceiptStatements,verifiedLibraryPublisherLocator} from './library-page-index.ts';
import {buildLibraryCapture} from './library-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';
import {captureAPI} from './capture-service.ts';
import {sealLibrary} from './library-vault.mjs';
import {readURLImportUsage} from './import-allowance.ts';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {attachObserverLibraryMedia} from './library-public-locator.ts';
registerHooks({load(url,context,next){if(url.endsWith('/critical-times.html?raw'))return {format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(url),'utf8')),shortCircuit:true};return next(url,context);}});
const {roomReader}=await import('./room-reader.ts');

const origin='https://reader.example',vault='67'.repeat(32),publication='Observer, The: Web Edition Articles (London, England)',title='Fictional Jason Arday interview examines archive funding';
const libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABCDEF';
const paragraphs=Array.from({length:4},(_,i)=>('Synthetic paragraph '+i+'. '+'This fictional meeting considered the local archive and invited residents to discuss its future. The writer reported different views and left room for questions about the evidence. '.repeat(2)).trim());
const article={title,byline:'Synthetic Reporter',date:'2026-10-18',publication,libraryURL,paragraphs};
const selected={publisher:'observer',libraryURL,title,date:'2026-10-18',publication};
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const [id,role] of [['owner','owner'],['member','member'],['other','member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,'2026-10-19');
 for(const room of ['room-one','room-two']){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(room,room,'owner','2026-10-19');for(const member of ['owner','member','other'])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(room,member,member==='owner'?'owner':'member','2026-10-19');}
 const DB={async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s._run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}},prepare(query){const s=sql.prepare(query),wrap=args=>({_run:()=>({meta:{changes:Number(s.run(...args).changes)}}),first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 return {sql,c:{DB,RR_LIBRARY_VAULT_KEY:vault,DEEPSEEK_API_KEY:'SYNTHETIC-PROVIDER-KEY'}};
}
function request(path,body,{room='room-one',member='member',source=origin}={}){return new Request(origin+path+'?room='+room,{method:body?'POST':'GET',headers:{Origin:source,'X-Reading-Room':'1','Content-Type':'application/json','x-rr-room-id':room,'x-ret-member-id':member},...(body?{body:JSON.stringify(body)}:{})});}
async function account(sql,room='room-one'){sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden:'+room,await sealLibrary(vault,{libraryName:'CamdenLibraries',cardNumber:'PRIVATE-CARD',session}),'connected',new Date().toISOString(),'');}
function provider({badAI=false,badRecord=false,normal=false,publicHead=false,publicStatus=200,publicImage='https://images.example.org/observer-public-preview.jpg'}={}){
 const calls=[];const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
 return {calls,fetch:async(raw,options={})=>{calls.push(String(raw));const url=new URL(raw);
  if(url.hostname==='api.deepseek.com'){assert.equal(url.pathname,'/chat/completions');if(badAI)return new Response('{}',{status:503});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({annotations:[{blockId:'B1',title:'Sequence',comment:'Consider how the writer introduces the participants.',question:'What other perspective would help?'},{blockId:'B3',title:'Evidence',comment:'Compare the emphasis and order in this passage.',question:'Which source would you examine next?'}]})}}]});}
  if(normal&&url.origin==='https://observer.co.uk'){if(publicStatus!==200)return new Response('PRIVATE-PUBLISHER-DENIAL',{status:publicStatus});return html('<html><head><title>'+title+'</title>'+(publicHead?'<link rel="canonical" href="'+url.href+'"><meta property="og:url" content="'+url.href+'"><meta property="og:title" content="'+title+'"><meta name="twitter:title" content="'+title+'"><meta property="og:image" content="'+publicImage+'">':'')+'</head><body><h1>'+title+'</h1></body></html>');}
  assert.equal(url.origin,'https://infoweb.newsbank.com');assert.equal(options.headers.get('cookie'),'nb=PRIVATE-COOKIE');
  if(url.pathname==='/apps/news/')return html('<form action="/apps/news/results?p=UKNB"><input name="query" id="edit-val-base-0"><select name="fld-base-0"><option value="TI">Headline</option></select><input name="p" value="UKNB"></form>');
  if(url.pathname==='/apps/news/results'){if(!normal)assert.equal(url.searchParams.get('query'),'"Jason" AND "Arday"');return html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">'+title+'</a></h3><ul><li>October 18, 2026</li><li>'+publication+'</li></ul><p>PRIVATE-SNIPPET</p></div>');}
  if(url.pathname==='/apps/news/document-view')return html('<div id="document-view--ascii"><h1>'+(badRecord?'A different fictional newspaper headline':title)+'</h1><div class="document-view__meta"><p>October 18, 2026 </p> <p>Publication: '+publication+' </p> <p>Author/Byline: Synthetic Reporter 1000 Words</p></div><div class="document-view__body--ascii">'+paragraphs.map(p=>'<p>'+p+'</p>').join('')+'</div></div>');
  throw Error('Unexpected synthetic route');
 }};
}
async function choice(c,fetcher,opts={}){const response=await librarySearchAPI(request('/api/library-search',{publisher:'observer',query:'Jason Arday'},opts),c,fetcher),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.results[0].choiceId;}
const importRequest=(id,opts={},extra={})=>request('/api/library-search/import',{choiceId:id,requestId:crypto.randomUUID(),...extra},opts);

test('encrypted room account connects metadata search to selected-record import, room reading and free cached reuse',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),response=await libraryRecordImportAPI(importRequest(id),c,p.fetch),saved=await response.json();
 assert.equal(response.status,200,JSON.stringify(saved));assert.equal(saved.cached,false);assert.equal(p.calls.filter(url=>url.includes('document-view')).length,1);assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,1);
 const row=sql.prepare('SELECT source_url,document FROM education_pages WHERE id=?').get(saved.id),doc=JSON.parse(row.document);assert.equal(row.source_url,libraryURL);assert.equal(doc.capture.url,libraryURL);assert.equal(doc.capture.diagnostics.libraryRecordEdition,true);assert.deepEqual(doc.capture.blocks.map(block=>block.text),paragraphs);assert.equal(doc.capture.blocks.some(block=>['figure','video'].includes(block.type)),false);assert.doesNotMatch(JSON.stringify(doc),/PRIVATE-CARD|PRIVATE-COOKIE|PRIVATE-SNIPPET|observer\.co\.uk/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles WHERE room_id=? AND page_id=?').get('room-one',saved.id).n,1);assert.deepEqual([(await readURLImportUsage(c)).used,(await readURLImportUsage(c)).pending],[1,0]);
 const reader=await roomReader(request('/read/'+saved.id,null),c),html=await reader.text();assert.equal(reader.status,200);assert.match(html,/Open library record/);assert.doesNotMatch(html,/id="rr-check-media"/);assert.match(html,/"findMedia":false/);
 const before=p.calls.length,cached=await libraryRecordImportAPI(importRequest(id),c,p.fetch),again=await cached.json();assert.equal(cached.status,200);assert.equal(again.id,saved.id);assert.equal(again.cached,true);assert.equal(p.calls.length,before);assert.equal((await readURLImportUsage(c)).used,1);
 assert.doesNotMatch(sql.prepare('SELECT encrypted FROM rr_library_connections WHERE id=?').get('camden:room-one').encrypted,/PRIVATE-CARD|PRIVATE-COOKIE/);
});

test('selected choices cannot cross rooms or members, accept replacement metadata, or survive expiry',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),before=p.calls.length;
 for(const [r,status] of [[importRequest(id,{room:'room-two'}),410],[importRequest(id,{member:'other'}),410],[importRequest(id,{source:'https://attacker.example'}),403],[importRequest(id,{}, {libraryURL}),400]])assert.equal((await libraryRecordImportAPI(r,c,p.fetch)).status,status);
 sql.prepare('UPDATE rr_library_search_choices SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),id);assert.equal((await libraryRecordImportAPI(importRequest(id),c,p.fetch)).status,410);assert.equal(p.calls.length,before);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);
});

test('a different room without its own Camden connection cannot inherit a cached private record',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json(),other='b'.repeat(48),stamp=new Date().toISOString();
 sql.prepare('INSERT INTO rr_library_search_choices VALUES(?,?,?,?,?,?,?,?,?,?)').run(other,'room-two','member','observer',title,'2026-10-18',publication,libraryURL,stamp,new Date(Date.now()+60000).toISOString());const before=p.calls.length;
 const blocked=await libraryRecordImportAPI(importRequest(other,{room:'room-two'}),c,p.fetch);assert.equal(blocked.status,409);assert.equal(p.calls.length,before);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles WHERE room_id=? AND page_id=?').get('room-two',saved.id).n,0);
});

test('record and commentary failures release reservations and never count as completed editions',async()=>{
 for(const failure of ['record','provider']){const {sql,c}=setup();await account(sql);const p=provider({badAI:failure==='provider',badRecord:failure==='record'}),id=await choice(c,p.fetch),response=await libraryRecordImportAPI(importRequest(id),c,p.fetch);assert.equal(response.ok,false);assert.deepEqual([(await readURLImportUsage(c)).used,(await readURLImportUsage(c)).pending],[0,0]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles').get().n,0);}
});

test('membership revoked after record retrieval cannot call commentary or save article access',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),before=p.calls.length;
 const response=await libraryRecordImportAPI(importRequest(id),c,p.fetch,{record:async()=>{sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run(new Date().toISOString(),'room-one','member');return {status:'found',article};}});
 assert.equal(response.status,403);assert.equal(p.calls.length,before);assert.deepEqual([(await readURLImportUsage(c)).used,(await readURLImportUsage(c)).pending],[0,0]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles').get().n,0);
});

test('thirty successful editions block a new selected-record fetch while an existing room record remains free',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json(),stamp=new Date().toISOString(),day=stamp.slice(0,10);
 for(let i=0;i<29;i++)sql.prepare('INSERT INTO rr_study_imports_v1(id,day,namespace,principal,request_id,source_url,state,reserved_at,expires_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),day,'synthetic','synthetic',crypto.randomUUID(),'https://example.org/fictional/'+i,'completed',stamp,Date.now()+60000,stamp);
 const other='c'.repeat(48);sql.prepare('INSERT INTO rr_library_search_choices VALUES(?,?,?,?,?,?,?,?,?,?)').run(other,'room-one','member','observer',title,'2026-10-18',publication,libraryURL.replace('ABCDEF','DEADBEEF'),stamp,new Date(Date.now()+60000).toISOString());const before=p.calls.length;
 const blocked=await libraryRecordImportAPI(importRequest(other),c,p.fetch),body=await blocked.json();assert.equal(blocked.status,429);assert.equal(body.errorCode,'daily_import_limit');assert.equal(body.usage.used,30);assert.equal(p.calls.length,before);
 const cached=await libraryRecordImportAPI(importRequest(id),c,p.fetch);assert.equal(cached.status,200);assert.equal((await cached.json()).id,saved.id);assert.equal(p.calls.length,before);assert.equal((await readURLImportUsage(c)).used,30);
});

test('ordinary capture JSON cannot grant itself trusted record identity with flags or a forged internal option',async()=>{
 const {sql,c}=setup(),capture=buildLibraryRecordCapture({selected,article});let calls=0;const response=await captureAPI(request('/api/capture',{capture,requestId:crypto.randomUUID(),validatedLibraryRecordURL:libraryURL}),c,async()=>{calls++;throw Error('No provider call expected');});assert.equal(response.status,400);assert.equal(calls,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);
});

const publicURL='https://observer.co.uk/news/national/article/fictional-jason-arday-interview-examines-archive-funding';
const normalRequest=(extra={})=>request('/api/room-articles',{url:publicURL,tryOriginal:true,requestId:crypto.randomUUID(),...extra});
const count=sql=>sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n;
async function comment(sql,id){sql.prepare('INSERT INTO rr_room_comments(id,room_id,page_id,member_id,request_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('discussion-one','room-one',id,'member',crypto.randomUUID(),'Synthetic existing discussion','approved','2026-10-19','2026-10-19');}
async function seedPage(sql,{id='d'.repeat(48),capture=buildLibraryCapture({...article,originalURL:publicURL,originalTitle:title}),room='room-one'}={}){const doc={kind:'rendered-capture-v1',capture:normalizeCapture(capture,{validatedLibraryRecordURL:capture.diagnostics?.libraryRecordEdition?libraryURL:undefined}),annotations:[]};sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id,'capture:'+id,capture.url,capture.title,JSON.stringify(doc),'2026-10-19');sql.prepare('INSERT INTO rr_room_articles VALUES(?,?,?,?)').run(room,id,'member','2026-10-19');return {id,doc};}
async function bound(c,source=article,opts={}){const r=request('/api/articles',{}),requestId=crypto.randomUUID(),proof=await bindRoomLibraryProof(r,c,await createLibraryPageProof({publisher:'observer',article:source}),requestId,opts.alias?publicURL:undefined,opts.candidate?publicURL:undefined),claim=await claimRoomLibraryRecord(r,c,proof);return {r,proof,claim,requestId};}

test('internal media coordinator checks origin, active room, request proof, saved body and page association before spending a media slot',async()=>{
 const {sql,c}=setup(),seeded=await seedPage(sql),foreign=await seedPage(sql,{id:'e'.repeat(48),room:'room-two'}),b=await bound(c,article,{candidate:true});let calls=0;const fetcher=async()=>{calls++;throw Error('No public request should be made');},input={boundLibraryProof:b.proof,requestId:b.requestId,pageId:seeded.id,publicURL};
 try{
  await reuseVerifiedLibraryPage(b.r,c,b.proof);
  assert.equal((await attachObserverLibraryMedia(request('/api/articles',{}, {source:'https://attacker.example'}),c,input,fetcher)).attached,false);
  for(const [r,changed,status] of [[request('/api/articles',{}, {room:'room-two'}),{},409],[b.r,{requestId:crypto.randomUUID()},409],[b.r,{boundLibraryProof:{}},409]])await assert.rejects(attachObserverLibraryMedia(r,c,{...input,...changed},fetcher),error=>error instanceof Response&&error.status===status);
  assert.equal((await attachObserverLibraryMedia(b.r,c,{...input,pageId:foreign.id},fetcher)).attached,false);
  const original=sql.prepare('SELECT document FROM education_pages WHERE id=?').get(seeded.id).document,changed=JSON.parse(original);changed.capture.blocks[1].text+=' A new sentence is not part of this proof.';sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(changed),seeded.id);assert.equal((await attachObserverLibraryMedia(b.r,c,input,fetcher)).attached,false);sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(original,seeded.id);
  sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run('2026-10-19','room-one','member');await assert.rejects(attachObserverLibraryMedia(b.r,c,input,fetcher),error=>error instanceof Response&&error.status===403);
  assert.equal(calls,0);assert.equal(sql.prepare("SELECT COUNT(*) n FROM education_counters WHERE key LIKE 'room-media:%'").get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);
 }finally{await releaseRoomLibraryRecord(b.claim);}
});

test('selected record then Observer URL hint reuses the same page and discussion without certifying the web link',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider({normal:true}),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json();await comment(sql,saved.id);
 const beforeAI=p.calls.filter(url=>url.includes('chat/completions')).length,response=await roomArticlesAPI(normalRequest(),c,p.fetch),reused=await response.json();assert.equal(response.status,200,JSON.stringify(reused));assert.equal(reused.id,saved.id);assert.equal(reused.cached,true);assert.equal(count(sql),1);assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,beforeAI);assert.equal((await readURLImportUsage(c)).used,1);assert.equal((await readURLImportUsage(c)).pending,0);assert.equal(sql.prepare('SELECT page_id FROM rr_room_comments').get().page_id,saved.id);assert.equal(sql.prepare('SELECT source_url FROM education_pages').get().source_url,libraryURL);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);
 const before=p.calls.length,again=await roomArticlesAPI(normalRequest(),c,p.fetch);assert.equal((await again.json()).id,saved.id);const lookup=await resourceLookupAPI(request('/api/resources/lookup',{url:publicURL}),c);assert.equal((await lookup.json()).found,false);assert(p.calls.length>before,'unverified URL hints need a new source check');assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,beforeAI);
});

test('fresh public-head proof attaches Observer preview to the same selected record and makes later URL opens free',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider({normal:true,publicHead:true}),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json();await comment(sql,saved.id);
 const before=JSON.parse(sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document),beforeAI=p.calls.filter(url=>url.includes('chat/completions')).length;
 const response=await roomArticlesAPI(normalRequest(),c,p.fetch),reused=await response.json();assert.equal(response.status,200,JSON.stringify(reused));assert.equal(reused.id,saved.id);assert.equal(reused.cached,true);
 const row=sql.prepare('SELECT source_url,document FROM education_pages WHERE id=?').get(saved.id),after=JSON.parse(row.document),figures=after.capture.blocks.filter(block=>block.type==='figure');
 assert.equal(row.source_url,libraryURL);assert.equal(after.capture.url,libraryURL);assert.deepEqual(after.capture.blocks.slice(0,before.capture.blocks.length),before.capture.blocks);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.capture.title,before.capture.title);assert.equal(after.capture.presentation.method,'library-text');assert.equal(after.capture.blocks.some(block=>block.type==='heading'),false);assert.equal(figures.length,1);assert.equal(figures[0].url,'https://images.example.org/observer-public-preview.jpg');assert.equal(figures[0].originalPlacementVerified,false);assert.equal(after.libraryPublicLocator.basis,'exact-library-article-public-head/v1');assert.equal(sql.prepare('SELECT body FROM rr_room_comments').get().body,'Synthetic existing discussion');
 assert.equal(count(sql),1);assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,beforeAI);assert.equal((await readURLImportUsage(c)).used,1);assert.equal((await readURLImportUsage(c)).pending,0);assert.equal(sql.prepare('SELECT page_id FROM rr_article_source_aliases').get().page_id,saved.id);assert.equal(p.calls.filter(url=>url.startsWith('https://observer.co.uk/')).length,1);
 const mediaSlot='room-media:room-one:'+new Date().toISOString().slice(0,10);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(mediaSlot).n,1);const calls=p.calls.length;
 const again=await roomArticlesAPI(normalRequest(),c,p.fetch);assert.equal((await again.json()).id,saved.id);assert.equal(p.calls.length,calls);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(mediaSlot).n,1);assert.equal((await roomLibraryAlias(request('/api/resources/lookup',{}),c,publicURL)).id,saved.id);
});

test('public denial or exhausted shared media checks keeps the reused Observer edition and discussion unchanged',async()=>{
 for(const scenario of ['denied','limit']){const {sql,c}=setup();await account(sql);const p=provider({normal:true,publicHead:true,publicStatus:scenario==='denied'?403:200}),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json();await comment(sql,saved.id);const before=sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document,slot='room-media:room-one:'+new Date().toISOString().slice(0,10);
  if(scenario==='limit')sql.prepare('INSERT INTO education_counters(key,n) VALUES(?,20)').run(slot);
  const response=await roomArticlesAPI(normalRequest(),c,p.fetch),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.id,saved.id);assert.equal(body.cached,true);assert.equal(sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document,before);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);assert.equal(p.calls.filter(url=>url.startsWith('https://observer.co.uk/')).length,scenario==='denied'?1:0);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(slot).n,scenario==='denied'?1:20);assert.equal(sql.prepare('SELECT body FROM rr_room_comments').get().body,'Synthetic existing discussion');assert.equal(count(sql),1);assert.equal((await readURLImportUsage(c)).used,1);assert.equal((await readURLImportUsage(c)).pending,0);
 }
});

test('a verified matching public head can certify the locator when it supplies no image, without inventing media',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider({normal:true,publicHead:true,publicImage:''}),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json(),before=JSON.parse(sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document);
 const response=await roomArticlesAPI(normalRequest(),c,p.fetch);assert.equal((await response.json()).id,saved.id);const after=JSON.parse(sql.prepare('SELECT document FROM education_pages WHERE id=?').get(saved.id).document);assert.deepEqual(after.capture.blocks,before.capture.blocks);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.libraryPublicLocator.added,0);assert.equal((await roomLibraryAlias(request('/api/resources/lookup',{}),c,publicURL)).id,saved.id);
});

test('normal publisher URL then selected record reuses the proof receipt without a second document or commentary call',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider({normal:true}),response=await roomArticlesAPI(normalRequest(),c,p.fetch),saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));await comment(sql,saved.id);const id=await choice(c,p.fetch),before=p.calls.length,reused=await libraryRecordImportAPI(importRequest(id),c,p.fetch);assert.equal(reused.status,200,JSON.stringify(await reused.clone().json()));assert.equal((await reused.json()).id,saved.id);assert.equal(p.calls.length,before);assert.equal(count(sql),1);assert.equal((await readURLImportUsage(c)).used,1);assert.equal(sql.prepare('SELECT source_url FROM education_pages').get().source_url,publicURL);assert.equal(sql.prepare('SELECT page_id FROM rr_room_comments').get().page_id,saved.id);
});

test('legacy normal library pages require a fresh exact document before receipt reuse and do not call commentary',async()=>{
 const {sql,c}=setup();await account(sql);const seeded=await seedPage(sql),p=provider(),id=await choice(c,p.fetch),response=await libraryRecordImportAPI(importRequest(id),c,p.fetch),saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));assert.equal(saved.id,seeded.id);assert.equal(saved.cached,true);assert.equal(count(sql),1);assert.equal(p.calls.filter(url=>url.includes('document-view')).length,1);assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,0);assert.equal((await readURLImportUsage(c)).used,0);assert.equal((await readURLImportUsage(c)).pending,0);assert.equal(sql.prepare('SELECT page_id FROM rr_verified_library_pages').get().page_id,seeded.id);
});

test('wrong full text, headline, actual date, source family or docref cannot alias a legacy page',async()=>{
 for(const change of ['text','title','date','publisher','docref']){const {sql,c}=setup(),seeded=await seedPage(sql),capture=seeded.doc.capture;if(change==='text')capture.blocks[1].text+=' Different punctuation!';if(change==='title')capture.title+=' changed';if(change==='date')capture.date='2026-10-17';if(change==='publisher')capture.publisher='The Times · Camden NewsBank text edition';if(change==='docref')capture.diagnostics.libraryURL=libraryURL.replace('ABCDEF','DEADBEEF');sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(seeded.doc),seeded.id);const b=await bound(c,article,{alias:true});try{assert.equal(await reuseVerifiedLibraryPage(b.r,c,b.proof,publicURL),null,change);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0,change);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_verified_library_pages').get().n,0,change);}finally{await releaseRoomLibraryRecord(b.claim);}}
});

test('proofs are request/room bound, claimed once and cannot be reconstructed from JSON',async()=>{
 const {sql,c}=setup(),seeded=await seedPage(sql),b=await bound(c,article,{alias:true});try{await assert.rejects(claimRoomLibraryRecord(b.r,c,b.proof),error=>error instanceof Response&&error.status===409);await assert.rejects(reuseVerifiedLibraryPage(request('/api/articles',{}, {room:'room-two'}),c,b.proof,publicURL),error=>error instanceof Response&&error.status===409);await assert.rejects(libraryReceiptStatements(b.r,c,{id:seeded.id,document:JSON.stringify(seeded.doc)},JSON.parse(JSON.stringify(b.proof)),publicURL),error=>error instanceof Response&&error.status===409);assert.equal(count(sql),1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_verified_library_pages').get().n,0);}finally{await releaseRoomLibraryRecord(b.claim);}assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_library_import_claims').get().n,0);
});

test('receipt lookup rejects body mutation, foreign rooms, revocation and removed associations',async()=>{
 const {sql,c}=setup(),seeded=await seedPage(sql),b=await bound(c,article,{alias:true});try{assert.equal((await reuseVerifiedLibraryPage(b.r,c,b.proof,publicURL)).id,seeded.id);}finally{await releaseRoomLibraryRecord(b.claim);}
 assert.equal(await roomLibraryAlias(request('/api/resources/lookup',{}, {room:'room-two'}),c,publicURL),null);assert.equal(await roomVerifiedLibraryRecord(request('/api/resources/lookup',{}, {room:'room-two'}),c,libraryURL),null);const original=JSON.stringify(seeded.doc);seeded.doc.capture.blocks[0].text+=' altered';sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(seeded.doc),seeded.id);assert.equal(await roomLibraryAlias(b.r,c,publicURL),null);assert.equal(await roomVerifiedLibraryRecord(b.r,c,libraryURL),null);sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(original,seeded.id);
 sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run('2026-10-19','room-one','member');await assert.rejects(roomLibraryAlias(b.r,c,publicURL),error=>error instanceof Response&&error.status===403);sql.prepare('UPDATE rr_room_members SET revoked_at=NULL WHERE room_id=? AND member_id=?').run('room-one','member');sql.prepare('DELETE FROM rr_room_articles WHERE room_id=? AND page_id=?').run('room-one',seeded.id);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_verified_library_pages').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);assert.equal(await roomLibraryAlias(b.r,c,publicURL),null);
});

test('expired claims and compare-and-swap document changes cannot register receipts or aliases',async()=>{
 for(const scenario of ['expired','changed']){const {sql,c}=setup(),seeded=await seedPage(sql),b=await bound(c,article,{alias:true});try{if(scenario==='expired'){sql.prepare('UPDATE rr_library_import_claims SET expires_at=0').run();await assert.rejects(reuseVerifiedLibraryPage(b.r,c,b.proof,publicURL),error=>error instanceof Response&&error.status===409);}else{const statements=await libraryReceiptStatements(b.r,c,{id:seeded.id,document:JSON.stringify(seeded.doc)},b.proof,publicURL);seeded.doc.capture.blocks[0].text+=' Changed after proof was prepared';sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(seeded.doc),seeded.id);await c.DB.batch(statements);}assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_verified_library_pages').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);}finally{await releaseRoomLibraryRecord(b.claim);}}
});

test('ambiguous pre-existing duplicate pages refuse automatic aliasing and keep both discussions separate',async()=>{
 const {sql,c}=setup();await seedPage(sql);await seedPage(sql,{id:'e'.repeat(48)});const b=await bound(c,article,{alias:true});try{await assert.rejects(reuseVerifiedLibraryPage(b.r,c,b.proof,publicURL),error=>error instanceof Response&&error.status===409);assert.equal(count(sql),2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);}finally{await releaseRoomLibraryRecord(b.claim);}
});

test('receipt failure rolls back the page, room association and completed allowance together',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider(),id=await choice(c,p.fetch),prepare=c.DB.prepare.bind(c.DB);c.DB.prepare=query=>{if(!query.startsWith('INSERT INTO rr_verified_library_pages'))return prepare(query);return {bind(){return {_run(){throw Error('Synthetic receipt persistence failure');}};}};};const response=await libraryRecordImportAPI(importRequest(id),c,p.fetch);assert.equal(response.ok,false);assert.equal(count(sql),0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_verified_library_pages').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);assert.deepEqual([(await readURLImportUsage(c)).used,(await readURLImportUsage(c)).pending],[0,0]);assert.equal(p.calls.filter(url=>url.includes('chat/completions')).length,1,'provider protection still records the real request');assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_library_import_claims').get().n,0);
});

test('reader headlines and URL hints can reuse a proved record but cannot certify arbitrary publisher locators',async()=>{
 const {sql,c}=setup();await account(sql);const p=provider({normal:true}),id=await choice(c,p.fetch),saved=await (await libraryRecordImportAPI(importRequest(id),c,p.fetch)).json(),arbitrary='https://observer.co.uk/news/national/article/arbitrary-unrelated-web-address-with-different-words';
 const response=await roomArticlesAPI(normalRequest({url:arbitrary,sourceHeadline:title}),c,p.fetch),reused=await response.json();assert.equal(response.status,200,JSON.stringify(reused));assert.equal(reused.id,saved.id);assert.equal(count(sql),1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);assert.equal(await roomLibraryAlias(request('/api/resources/lookup',{}),c,arbitrary),null);assert.equal((await readURLImportUsage(c)).used,1);
 const base={...article,originalURL:publicURL,originalTitle:title,metadataBasis:'publisher headline',readerHeadlineHint:false,urlWordsHint:false};assert.equal(verifiedLibraryPublisherLocator(base),publicURL);for(const change of [{readerHeadlineHint:true},{urlWordsHint:true},{metadataBasis:'previously matched edition'},{originalTitle:title+' different'},{readerHeadlineHint:undefined},{metadataBasis:'unknown'}])assert.equal(verifiedLibraryPublisherLocator({...base,...change}),undefined);assert.equal(verifiedLibraryPublisherLocator({...base,title:title+' - An explicit synthetic standfirst'}),publicURL);
});

test('independently observed exact-URL headline creates an alias after full record proof and later resolves without source or AI',async()=>{
 const {sql,c}=setup();await account(sql);const url='https://telegraph.co.uk/news/2026/10/18/fictional-jason-arday-interview-examines-archive-funding/',label='The Daily Telegraph (London, England)',source={...article,publication:'The Daily Telegraph (London, UK) (Camden NewsBank text edition)'},selectedTelegraph={...selected,publisher:'telegraph',publication:label};const seeded=await seedPage(sql,{capture:buildLibraryRecordCapture({selected:selectedTelegraph,article:source})});await comment(sql,seeded.id);const calls=[],html=value=>new Response(value,{headers:{'content-type':'text/html'}}),fetcher=async(raw,options)=>{calls.push(String(raw));const u=new URL(raw);if(u.hostname==='telegraph.co.uk')return html('<html><head><title>'+title+'</title></head><body><h1>'+title+'</h1></body></html>');assert.equal(u.hostname,'infoweb.newsbank.com');if(u.pathname==='/apps/news/')return html('<form action="/apps/news/results?p=UKNB"><input name="query" id="edit-val-base-0"><input name="p" value="UKNB"></form>');if(u.pathname==='/apps/news/results')return html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">'+title+'</a></h3><ul><li>October 18, 2026</li><li>'+label+'</li></ul></div>');if(u.pathname==='/apps/news/document-view')return html('<div id="document-view--ascii"><h1>'+title+'</h1><div class="document-view__meta">October 18, 2026 '+label+' Author/Byline: Synthetic Reporter 1000 Words</div><div class="document-view__body--ascii">'+paragraphs.map(p=>'<p>'+p+'</p>').join('')+'</div></div>');throw Error('Unexpected synthetic route');};
 const first=await roomArticlesAPI(request('/api/room-articles',{url,tryOriginal:true,requestId:crypto.randomUUID()}),c,fetcher),saved=await first.json();assert.equal(first.status,200,JSON.stringify(saved));assert.equal(saved.id,seeded.id);assert.equal(count(sql),1);assert.equal(sql.prepare('SELECT page_id FROM rr_article_source_aliases').get().page_id,seeded.id);assert.equal(sql.prepare('SELECT source_url FROM education_pages').get().source_url,libraryURL);assert.equal((await readURLImportUsage(c)).used,0);assert.equal(calls.filter(url=>url.includes('document-view')).length,1);const before=calls.length;
 const again=await roomArticlesAPI(request('/api/room-articles',{url,requestId:crypto.randomUUID()}),c,fetcher);assert.equal((await again.json()).id,seeded.id);const lookup=await resourceLookupAPI(request('/api/resources/lookup',{url}),c);assert.equal((await lookup.json()).href,'/read/'+seeded.id+'?room=room-one');assert.equal(calls.length,before);assert.equal(sql.prepare('SELECT page_id FROM rr_room_comments').get().page_id,seeded.id);
});
