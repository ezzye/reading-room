import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {roomArticlesAPI,shelfMetadata} from './room-articles.ts';
import {memberAuthGate,isPublicMemberAuthPath} from './member-auth.ts';
registerHooks({load(url,context,next){if(url.endsWith('/critical-times.html?raw'))return {format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(url),'utf8')),shortCircuit:true};return next(url,context);}});
const {roomReader}=await import('./room-reader.ts');
import {camdenResourcesAPI,camdenResource,referenceURL,REFERENCE_KIND} from './camden-resource-service.ts';

const origin='https://reader.example',owner='owner-id',member='member-id',roomA='room-a',roomB='room-b';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const [id,role] of [[owner,'owner'],[member,'member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,new Date().toISOString());
 for(const id of [roomA,roomB]){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at,moderation) VALUES(?,?,?,?,?)').run(id,id,owner,new Date().toISOString(),'open');sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,owner,'owner',new Date().toISOString());sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,member,'member',new Date().toISOString());}
 return {sql,async batch(items){sql.exec('BEGIN');try{const out=items.map(x=>x._run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){const s=sql.prepare(q),wrap=args=>({_run:()=>({success:true,meta:{changes:Number(s.run(...args).changes)}}),first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({success:true,meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
}
function config(DB){return {DB,DEEPSEEK_API_KEY:'synthetic'};}
function req(path,room=roomA,memberId=owner,method='GET',body,headers={}){return new Request(origin+path,{method,headers:{Origin:origin,'X-Reading-Room':'1','x-rr-room-id':room,'x-ret-member-id':memberId,'x-ret-member-role':memberId===owner?'owner':'member',...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});}
const post=(room,memberId,body,headers={})=>req('/api/camden-resources',room,memberId,'POST',body,headers);
function searchProvider(calls,fail=false){return async(url,options)=>{calls.push({url,options});if(fail) return Response.json({error:'private provider payload must not leak'}, {status:502});return Response.json({results:[
 {url:'https://camden.cobwebinfo.com/resource/Example',title:'Example entry'},
 {url:'https://attacker.example/collect',title:'Spoofed result'},
 {url:'http://camden.cobwebinfo.com/insecure',title:'Insecure'},
 {url:'https://camden.cobwebinfo.com/resource/Example#fragment',title:'Duplicate'},
 {url:'javascript:alert(1)',title:'Unsafe'}
]});};}

test('catalogue and referenceURL restrict saved references to listed HTTPS provider hosts',()=>{
 assert.equal(camdenResource('britannica').searchHost,'library.eb.co.uk');
 assert.equal(referenceURL('https://library.eb.co.uk/article/example?utm_source=x#entry','britannica'),'https://library.eb.co.uk/article/example');
 for(const raw of ['http://library.eb.co.uk/a','https://user:pw@library.eb.co.uk/a','https://library.eb.co.uk.evil.test/a','https://evil.test/a','javascript:alert(1)','https://library.eb.co.uk/login'])assert.throws(()=>referenceURL(raw,'britannica'));
 assert.throws(()=>referenceURL('https://camden.cobwebinfo.com/a','britannica'));
});
test('GET needs authenticated room membership and returns room-scoped catalogue context',async()=>{
 const DB=database();let r=await camdenResourcesAPI(req('/api/camden-resources',roomA,'nobody'),config(DB));assert.equal(r.status,403);
 r=await camdenResourcesAPI(req('/api/camden-resources',roomA,member),config(DB));const d=await r.json();assert.equal(d.room.id,roomA);assert.equal(d.room.role,'member');assert.equal(d.resources.length,22);
});
test('search sends a bounded metadata-only query, filters all non-provider URLs, and keeps quota per room',async()=>{
 const DB=database(),calls=[],run=searchProvider(calls),body={action:'search',resourceId:'cobra',query:'  family   history  '};
 let r=await camdenResourcesAPI(post(roomA,member,body),config(DB),run),d=await r.json();assert.equal(r.status,200);assert.equal(d.results.length,1);assert.equal(d.results[0].url,'https://camden.cobwebinfo.com/resource/Example');assert.equal(d.room.id,roomA);
 const sent=JSON.parse(calls[0].options.body);assert.equal(sent.query,'site:camden.cobwebinfo.com family history');assert(sent.query.length<=128);assert.equal(sent.count,6);assert.equal(sent.need_content,false);assert.equal(calls[0].options.redirect,'manual');assert.equal(DB.sql.prepare('SELECT n FROM education_counters').get().n,1);assert.equal(DB.sql.prepare('SELECT key FROM education_counters').get().key.startsWith('room-search:'+roomA+':'),true);assert.equal(d.searchUsage.used,1);
 r=await camdenResourcesAPI(post(roomB,member,body),config(DB),run);assert.equal(r.status,200);assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM education_counters').get().n,2);
});
test('search blocks cross-origin, invalid inputs and hides provider failure details',async()=>{
 const DB=database(),calls=[];assert.equal((await camdenResourcesAPI(post(roomA,member,{action:'search',resourceId:'cobra',query:'history'},{Origin:'https://evil.example'}),config(DB),searchProvider(calls))).status,403);
 assert.equal((await camdenResourcesAPI(post(roomA,member,{action:'search',resourceId:'cobra',query:'hi'}),config(DB),searchProvider(calls))).status,400);assert.equal(calls.length,0);
 const r=await camdenResourcesAPI(post(roomA,member,{action:'search',resourceId:'cobra',query:'history'}),config(DB),searchProvider(calls,true));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private provider payload/);
});
test('long search text is trimmed on a word boundary; valid empty and malformed replies differ',async()=>{
 const DB=database(),calls=[],query=Array.from({length:35},(_,i)=>'word'+i).join(' ');
 const reply=await camdenResourcesAPI(post(roomA,member,{action:'search',resourceId:'cobra',query}),config(DB),searchProvider(calls));assert.equal(reply.status,200);
 const sent=JSON.parse(calls[0].options.body).query;assert(sent.length<=128);assert.match(sent,/(?:^|\s)word\d+$/);assert(!sent.endsWith('word34'));
 const empty=await camdenResourcesAPI(post(roomB,member,{action:'search',resourceId:'cobra',query:'history'}),config(DB),async()=>Response.json({results:[]}));assert.equal(empty.status,200);assert.deepEqual((await empty.json()).results,[]);
 const malformed=await camdenResourcesAPI(post(roomB,member,{action:'search',resourceId:'cobra',query:'another search'}),config(DB),async()=>Response.json({results:[{title:'No URL'}]}));assert.equal(malformed.status,503);assert.doesNotMatch(await malformed.text(),/No URL/);
});
test('save creates a link-only private page, deduplicates within room and leaves discussion rows intact',async()=>{
 const DB=database(),data={action:'save',resourceId:'cobra',title:'Example entry',url:'https://camden.cobwebinfo.com/resource/Example?utm_campaign=x'};
 DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run('c'.repeat(48),'existing-page','https://example.org/family','Family article','{}',new Date().toISOString());
 DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomA,'c'.repeat(48),owner,new Date().toISOString());
 DB.sql.prepare('INSERT INTO rr_room_comments(id,room_id,page_id,member_id,parent_id,request_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('comment-id',roomA,'c'.repeat(48),member,null,'comment-request','A family reply.','approved',new Date().toISOString(),new Date().toISOString());
 let r=await camdenResourcesAPI(post(roomA,member,data),config(DB)),a=await r.json();assert.equal(r.status,200);assert.match(a.id,/^[a-f0-9]{48}$/);assert.equal(a.href,'/read/'+a.id+'?room='+roomA);assert.equal(a.cached,false);
 const page=DB.sql.prepare('SELECT * FROM education_pages WHERE id=?').get(a.id),doc=JSON.parse(page.document);assert.equal(doc.kind,REFERENCE_KIND);assert.deepEqual(Object.keys(doc).sort(),['kind','resourceId','title','url']);assert.equal(page.source_url,'https://camden.cobwebinfo.com/resource/Example');assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM rr_room_articles WHERE room_id=? AND page_id=?').get(roomA,a.id).n,1);
 r=await camdenResourcesAPI(post(roomA,member,data),config(DB));const duplicate=await r.json();assert.equal(duplicate.id,a.id);assert.equal(duplicate.cached,true);
 r=await camdenResourcesAPI(post(roomB,member,data),config(DB));const other=await r.json();assert.notEqual(other.id,a.id);assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM education_pages').get().n,3);
 const comment=DB.sql.prepare('SELECT body,status FROM rr_room_comments WHERE id=?').get('comment-id');assert.equal(comment.body,'A family reply.');assert.equal(comment.status,'approved');assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM rr_room_articles WHERE room_id=?').get(roomA).n,2);
});
test('save rejects untrusted URLs, arbitrary metadata and oversized request bodies',async()=>{
 const DB=database();for(const url of ['https://evil.example/a','http://library.eb.co.uk/a','javascript:alert(1)']){const r=await camdenResourcesAPI(post(roomA,member,{action:'save',resourceId:'britannica',title:'Injected',url}),config(DB));assert.equal(r.status,400);}
 assert.equal((await camdenResourcesAPI(post(roomA,member,{action:'save',resourceId:'britannica',title:'x',url:'https://library.eb.co.uk/article',html:'private copy'}),config(DB))).status,400);
 const oversized=new Request(origin+'/api/camden-resources',{method:'POST',headers:{Origin:origin,'X-Reading-Room':'1','x-rr-room-id':roomA,'x-ret-member-id':owner,'Content-Type':'application/json','Content-Length':'5001'},body:JSON.stringify({action:'search',resourceId:'britannica',query:'x'.repeat(6000)})});assert.equal((await camdenResourcesAPI(oversized,config(DB))).status,400);
});
test('database failures return only a fixed safe error',async()=>{
 const DB=database();DB.batch=async()=>{throw Error('synthetic private database detail');};
 const r=await camdenResourcesAPI(post(roomA,member,{action:'save',resourceId:'cobra',title:'Example',url:'https://camden.cobwebinfo.com/example'}),config(DB));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/synthetic private database detail/);
});


test('reference page reads, archive and restore reuse room protection and preserve its discussion',async()=>{
 const DB=database(),data={action:'save',resourceId:'odnb',title:'A reference biography',url:'https://www.oxforddnb.com/view/10.1093/ref:odnb/12345'};
 const saved=await (await camdenResourcesAPI(post(roomA,member,data),config(DB))).json();
 const page=DB.sql.prepare('SELECT * FROM education_pages WHERE id=?').get(saved.id);assert.equal(shelfMetadata(page).publisher,'Oxford Dictionary of National Biography');
 const stamp=new Date().toISOString();DB.sql.prepare('INSERT INTO rr_room_comments(id,room_id,page_id,member_id,parent_id,request_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('reference-comment',roomA,saved.id,member,null,'reference-reply','Compare this biography with the newspaper.','approved',stamp,stamp);
 const read=await roomReader(req('/read/'+saved.id,roomA,member),config(DB));assert.equal(read.status,200);const html=await read.text();assert.match(html,/Open reading at Oxford Dictionary of National Biography/);assert.match(html,/ret-room-discussion/);assert.doesNotMatch(html,/AI headline-versus-article check|id="rr-check-media"/);
 assert.equal((await roomReader(req('/read/'+saved.id,roomB,member),config(DB))).status,404);
 assert.equal((await roomArticlesAPI(post(roomA,member,{action:'archive',id:saved.id}),config(DB))).status,403);
 assert.equal((await roomArticlesAPI(post(roomA,owner,{action:'archive',id:saved.id}),config(DB))).status,200);
 assert(DB.sql.prepare('SELECT archived_at FROM rr_room_article_archive WHERE page_id=?').get(saved.id).archived_at);
 const duplicate=await (await camdenResourcesAPI(post(roomA,member,data),config(DB))).json();assert.equal(duplicate.id,saved.id);assert(DB.sql.prepare('SELECT archived_at FROM rr_room_article_archive WHERE page_id=?').get(saved.id).archived_at,'duplicate must not restore');
 assert.equal((await roomArticlesAPI(post(roomA,owner,{action:'restore',id:saved.id}),config(DB))).status,200);
 assert.equal(DB.sql.prepare('SELECT archived_at FROM rr_room_article_archive WHERE page_id=?').get(saved.id),undefined);assert.equal(DB.sql.prepare('SELECT body FROM rr_room_comments WHERE id=?').get('reference-comment').body,'Compare this biography with the newspaper.');
 assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0,'reading links use no AI or search allowance');
});
test('ordinary Add reviews a supported reference URL without article ingestion or provider calls',async()=>{
 const DB=database();let calls=0;const response=await roomArticlesAPI(post(roomA,member,{url:'https://www.oed.com/dictionary/education_n?utm_source=test',sourceHeadline:'Education'}),config(DB),async()=>{calls++;throw Error('unexpected source fetch');});assert.equal(response.status,200);const result=await response.json();assert.equal(result.needsReference,true);const next=new URL(result.href,origin);assert.equal(next.pathname,'/library');assert.equal(next.searchParams.get('resource'),'oed');assert.equal(next.searchParams.get('room'),roomA);assert.equal(next.searchParams.get('title'),'Education');assert.equal(next.searchParams.get('url'),'https://oed.com/dictionary/education_n');assert.equal(calls,0);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);
});
test('library routes are private to normal room membership sessions',async()=>{
 const DB=database();for(const path of ['/library','/api/library-resources']){assert.equal(isPublicMemberAuthPath(path),false);const response=await memberAuthGate(new Request(origin+path),config(DB));assert(response instanceof Response);assert(path.startsWith('/api')?response.status===401:response.status===302||response.status===303);}
});
