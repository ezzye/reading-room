import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {librarySearchAPI} from './library-search.ts';
import {libraryRecordImportAPI} from './library-record-import.ts';
import {captureAPI} from './capture-service.ts';
import {sealLibrary} from './library-vault.mjs';
import {readURLImportUsage} from './import-allowance.ts';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
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
function provider({badAI=false,badRecord=false}={}){
 const calls=[];const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
 return {calls,fetch:async(raw,options={})=>{calls.push(String(raw));const url=new URL(raw);
  if(url.hostname==='api.deepseek.com'){assert.equal(url.pathname,'/chat/completions');if(badAI)return new Response('{}',{status:503});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({annotations:[{blockId:'B1',title:'Sequence',comment:'Consider how the writer introduces the participants.',question:'What other perspective would help?'},{blockId:'B3',title:'Evidence',comment:'Compare the emphasis and order in this passage.',question:'Which source would you examine next?'}]})}}]});}
  assert.equal(url.origin,'https://infoweb.newsbank.com');assert.equal(options.headers.get('cookie'),'nb=PRIVATE-COOKIE');
  if(url.pathname==='/apps/news/')return html('<form action="/apps/news/results?p=UKNB"><input name="query" id="edit-val-base-0"><select name="fld-base-0"><option value="TI">Headline</option></select><input name="p" value="UKNB"></form>');
  if(url.pathname==='/apps/news/results'){assert.equal(url.searchParams.get('query'),'"Jason" AND "Arday"');return html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">'+title+'</a></h3><ul><li>October 18, 2026</li><li>'+publication+'</li></ul><p>PRIVATE-SNIPPET</p></div>');}
  if(url.pathname==='/apps/news/document-view')return html('<div id="document-view--ascii"><h1>'+(badRecord?'A different fictional newspaper headline':title)+'</h1><div class="document-view__meta"><span>October 18, 2026 | </span><span>'+publication+'</span><span> Author/Byline: Synthetic Reporter 1000 Words</span></div><div class="document-view__body--ascii">'+paragraphs.map(p=>'<p>'+p+'</p>').join('')+'</div></div>');
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
