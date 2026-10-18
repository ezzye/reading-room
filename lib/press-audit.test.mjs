import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pressAuditAPI,pressAuditURL,PRESS_AUDIT_HOSTS,classifyPressAuditFailure,claimPressAuditEntry,spendPressAuditStage,finishPressAuditEntry} from './press-audit.ts';
import {PAPERS} from './newspaper-core.mjs';
import {roomArticlesAPI} from './room-articles.ts';
import {lookupNewsBankSource} from './library-server.ts';
import {sealLibrary} from './library-vault.mjs';
import {DEFAULT_ROOM_ID} from './rooms.ts';
import {fixture} from './newspaper-fixture.mjs';
const origin='https://reader.example',owner='owner-a',member='member-a',otherRoom='room-b',now=Date.now(),vaultKey='47'.repeat(32);
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={sql,async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s._run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}},prepare(query){const statement=sql.prepare(query),wrap=args=>({_run:()=>({success:true,meta:{changes:Number(statement.run(...args).changes)}}),first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({success:true,meta:{changes:Number(statement.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 for(const [id,role] of [[owner,'owner'],[member,'member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,new Date(now).toISOString());
 for(const id of [DEFAULT_ROOM_ID,otherRoom]){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(id,id,owner,new Date(now).toISOString());sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,owner,'owner',new Date(now).toISOString());}
 sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(DEFAULT_ROOM_ID,member,'member',new Date(now).toISOString());return DB;
}
const config=DB=>({DB,DEEPSEEK_API_KEY:'synthetic-key',RR_LIBRARY_VAULT_KEY:vaultKey});
function request(body,options={}){return new Request(origin+(options.path||'/api/room/press-audit'),{method:options.method||'POST',headers:{Origin:origin,'X-Reading-Room':'1','Content-Type':'application/json','x-rr-room-id':options.room||DEFAULT_ROOM_ID,'x-ret-member-id':options.member||owner,'x-ret-member-role':'owner',...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const article=(slug='fictional-community-headline')=>'https://theguardian.com/uk-news/'+slug;
async function create(DB,urls=[article()],options={}){const response=await pressAuditAPI(request({urls,label:'Synthetic bounded audit'},options),config(DB),options.time||now),data=await response.json();return {response,data,run:data.run};}
async function add(DB,run,entry,fetcher,overrides={}){return roomArticlesAPI(request({url:entry.url,requestId:crypto.randomUUID(),auditRunId:run.id,auditEntryId:entry.id,...overrides},{path:'/api/room-articles'}),config(DB),fetcher);}
function provider(){let sources=0,ai=0;return {counts:()=>({sources,ai}),fetcher:async(url)=>{if(url==='https://api.deepseek.com/chat/completions'){ai++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({annotations:[{blockId:'B1',title:'Sequence',comment:'Consider the order in which the writer presents the setting.',question:'Which perspective receives attention?'},{blockId:'B3',title:'Evidence',comment:'Compare the way these details support the passage.',question:'What additional evidence would help?'}]})}}]});}sources++;return new Response(fixture,{headers:{'content-type':'text/html'}});}};}

test('manifest validates exact known article URLs, canonical duplicates, two per host and 96 ceiling',async()=>{
 assert.equal(pressAuditURL('https://www.theguardian.com/uk-news/fictional-story?utm_source=x#top'),article('fictional-story'));
 for(const url of [undefined,null,'','https://theguardian.com/','https://theguardian.com/news','https://theguardian.com/news/politics','https://theguardian.com/search/fictional-story','https://evil.theguardian.com/news/fictional-story','https://theguardian.com.evil.example/news/fictional-story','https://unlisted.example.org/news/fictional-story','http://theguardian.com/news/fictional-story','https://theguardian.com/news/fictional-story?token=secret','https://theguardian.com/news/fictional-story?redirect=elsewhere'])assert.throws(()=>pressAuditURL(url),undefined,String(url));
 for(const urls of [[],Array(97).fill(article()),[article(),article()+'?utm_campaign=copy'],[article('first-story'),article('second-story'),article('third-story')]]){const DB=database(),created=await create(DB,urls);assert.equal(created.response.status,400);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_press_audit_runs').get().n,0);}
 const DB=database(),{response,run}=await create(DB,[article('first-story'),article('second-story'),'https://express.co.uk/news/fictional-story']);assert.equal(response.status,201);assert.equal(run.limit,3);assert.equal(run.pending,3);assert.equal(Date.parse(run.expiresAt)-Date.parse(run.createdAt),86400000);
});

test('only the selected room owner may create, inspect or claim; same-origin checks remain required',async()=>{
 const DB=database();assert.equal((await create(DB,[article()],{member})).response.status,403);
 DB.sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run('member-owned','Member owned room',member,new Date().toISOString());DB.sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run('member-owned',member,'owner',new Date().toISOString());
 assert.equal((await create(DB,[article()],{member,room:'member-owned'})).response.status,403);
 assert.equal((await pressAuditAPI(request(undefined,{method:'GET',member,room:'member-owned'}),config(DB))).status,403);
 assert.equal((await create(DB,[article()],{headers:{Origin:'https://evil.example'}})).response.status,403);
 const {run}=await create(DB);assert(run);
 assert.equal((await pressAuditAPI(request(undefined,{method:'GET',member}),config(DB))).status,403);
 assert.equal((await pressAuditAPI(request(undefined,{method:'GET',room:otherRoom,path:'/api/room/press-audit?run='+run.id}),config(DB))).status,404);
 const params={runId:run.id,entryId:run.entries[0].id,url:run.entries[0].url,requestId:crypto.randomUUID()};
 for(const options of [{member},{room:otherRoom},{headers:{Origin:'https://evil.example'}}])await assert.rejects(claimPressAuditEntry(request({},options),config(DB),params),e=>e instanceof Response&&[403,409].includes(e.status));
 assert.equal(DB.sql.prepare('SELECT status FROM rr_press_audit_entries').get().status,'approved');
 DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE member_id=?').run(new Date().toISOString(),owner);
 assert.equal((await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).status,403);
});

test('the instance owner cannot multiply the global 96 reserved articles across rooms',async()=>{
 const DB=database(),urls=[...PRESS_AUDIT_HOSTS].slice(0,25).flatMap(host=>[1,2].map(n=>'https://'+host+'/news/fictional-audit-story-'+n));
 const a=await create(DB,urls);assert.equal(a.response.status,201);assert.equal(a.data.globalReserved,50);assert.equal(a.data.globalRemaining,46);
 DB.sql.prepare("UPDATE rr_press_audit_runs SET status='complete' WHERE id=?").run(a.run.id);
 const rejected=await create(DB,urls.slice(0,48),{room:otherRoom});assert.equal(rejected.response.status,409);
 const b=await create(DB,urls.slice(0,46),{room:otherRoom});assert.equal(b.response.status,201);assert.equal(b.data.globalReserved,96);assert.equal(b.data.globalRemaining,0);
 assert.equal(DB.sql.prepare('SELECT SUM(entry_limit) n FROM rr_press_audit_runs').get().n,96);
 const status=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(status.globalReserved,96);assert.equal(status.globalRemaining,0);
 assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0);
});

test('one run per room UTC day and a single active 24-hour run are enforced transactionally',async()=>{
 const DB=database(),day=Date.UTC(2026,9,18,23,50);const a=await create(DB,[article()],{time:day});assert.equal(a.response.status,201);
 const simultaneous=await Promise.all([create(DB,[article('other-story')],{time:day}),create(DB,[article('other-story-two')],{time:day})]);assert.deepEqual(simultaneous.map(x=>x.response.status),[409,409]);
 assert.equal((await create(DB,[article()],{time:day+20*60000})).response.status,409);
 DB.sql.prepare("UPDATE rr_press_audit_runs SET status='complete'").run();
 assert.equal((await create(DB,[article()],{time:day+60000})).response.status,409);
 assert.equal((await create(DB,[article()],{time:day+20*60000})).response.status,201);
 assert.equal((await create(DB,[article()],{room:otherRoom,time:day})).response.status,201);
 assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_press_audit_runs').get().n,3);
});

test('atomic single-use claims bind URL, owner, request identity and in-memory downstream stages',async()=>{
 const DB=database(),{run}=await create(DB,[article('first-story'),article('second-story')]),entry=run.entries[0],requestId=crypto.randomUUID(),params={runId:run.id,entryId:entry.id,url:entry.url,requestId};
 await assert.rejects(claimPressAuditEntry(request({}),config(DB),{...params,url:article('unapproved-story')}),e=>e.status===409);
 const results=await Promise.allSettled([claimPressAuditEntry(request({}),config(DB),params),claimPressAuditEntry(request({}),config(DB),params)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 await assert.rejects(claimPressAuditEntry(request({}),config(DB),{...params,entryId:run.entries[1].id,url:run.entries[1].url}),e=>e.status===409);
 const allowance=results.find(x=>x.status==='fulfilled').value.allowance;
 await assert.rejects(spendPressAuditStage({},'article',config(DB),entry.url,requestId,request({})),/does not match/);
 await assert.rejects(spendPressAuditStage(allowance,'article',config(DB),entry.url,crypto.randomUUID(),request({})),/does not match/);
 assert.equal(await spendPressAuditStage(allowance,'article',config(DB),entry.url,requestId,request({})),true);
 await assert.rejects(spendPressAuditStage(allowance,'article',config(DB),entry.url,requestId,request({})),/does not match/);
 await finishPressAuditEntry(allowance,{ok:false,status:422});
 await assert.rejects(spendPressAuditStage(allowance,'capture',config(DB),entry.url,requestId,request({})),/does not match/);
 assert.equal(DB.sql.prepare('SELECT status FROM rr_press_audit_entries WHERE id=?').get(entry.id).status,'failed');
});

test('expiry prevents external work and unfinished claims are shown as interrupted',async()=>{
 const DB=database(),{run}=await create(DB,[article('first-story'),article('second-story')]);
 const params={runId:run.id,entryId:run.entries[0].id,url:run.entries[0].url,requestId:crypto.randomUUID()},claimed=await claimPressAuditEntry(request({}),config(DB),params);
 DB.sql.prepare('UPDATE rr_press_audit_runs SET expires_at=?').run(new Date(now-1000).toISOString());
 await assert.rejects(spendPressAuditStage(claimed.allowance,'article',config(DB),params.url,params.requestId,request({})),/expired/);
 let calls=0;const response=await add(DB,run,run.entries[1],async()=>{calls++;throw Error('Must not fetch');});assert.equal(response.status,409);assert.equal(calls,0);
 const status=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(status.runs[0].status,'expired');assert.equal(status.runs[0].entries[0].status,'interrupted');
});

test('bounded owner import works with exhausted normal caps; normal/fake audit requests remain capped',async()=>{
 const DB=database(),day=new Date().toISOString().slice(0,10),p=provider();for(const [key,n] of [['url-fetch:',90],['capture:',90],['library-lookup:camden:',30]])DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run(key+day,n);
 const before=DB.sql.prepare('SELECT * FROM education_counters ORDER BY key').all(),{run}=await create(DB,[{url:article('first-story'),sourceHeadline:'A fictional community headline'},{url:article('second-story')}]);
 const response=await add(DB,run,run.entries[0],p.fetcher),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.match(value.href,/^\/read\/[a-f0-9]{48}\?room=/);assert.deepEqual(p.counts(),{sources:1,ai:1});
 assert.deepEqual(DB.sql.prepare('SELECT * FROM education_counters ORDER BY key').all(),before);
 const duplicate=await add(DB,run,run.entries[0],p.fetcher);assert.equal(duplicate.status,409);assert.deepEqual(p.counts(),{sources:1,ai:1});
 const normal=await roomArticlesAPI(request({url:article('not-approved-third-story'),requestId:crypto.randomUUID(),tryOriginal:true,audit:true,auditAllowance:true},{path:'/api/room-articles',headers:{'x-press-audit':'1'}}),config(DB),p.fetcher);assert.equal(normal.status,429);assert.deepEqual(p.counts(),{sources:1,ai:1});
 const saved=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json(),receipt=saved.runs[0].entries[0];assert.equal(receipt.status,'saved');assert.equal(receipt.pageId,value.id);assert.equal(receipt.summary.annotationCount,2);assert(receipt.summary.paragraphCount>0);assert.doesNotMatch(JSON.stringify(saved),/Fictional paragraph|synthetic-key|cardNumber|encrypted|prompt_tokens|blocks|document/);
});

test('cache hits spend exactly one entry and return room-scoped count receipts without provider calls',async()=>{
 const DB=database(),url=article('cached-fictional-story'),id='a'.repeat(48),doc={kind:'rendered-capture-v1',capture:{url,title:'Synthetic title',blocks:[{type:'paragraph',text:'Private source prose sentinel'},{type:'figure',url:'https://images.example.org/private.jpg'}]},annotations:[{comment:'Private annotation sentinel'}]};
 DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id,'capture:cached',url,'Synthetic title',JSON.stringify(doc),new Date().toISOString());DB.sql.prepare('INSERT INTO rr_room_articles VALUES(?,?,?,?)').run(DEFAULT_ROOM_ID,id,owner,new Date().toISOString());
 const {run}=await create(DB,[url]);let calls=0;const response=await add(DB,run,run.entries[0],async()=>{calls++;throw Error();});assert.equal(response.status,200);assert.equal((await response.json()).cached,true);assert.equal(calls,0);
 const status=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(status.runs[0].status,'complete');assert.equal(status.runs[0].used,1);assert.equal(status.runs[0].entries[0].status,'cached');assert.deepEqual(status.runs[0].entries[0].summary,{paragraphCount:1,imageCount:1,videoCount:0,annotationCount:1});assert.doesNotMatch(JSON.stringify(status),/Private source prose sentinel|Private annotation sentinel|private\.jpg/);
 assert.equal((await add(DB,run,run.entries[0],async()=>{calls++;})).status,409);assert.equal(calls,0);
});

test('known unsupported publisher records a spent failed receipt without external fetch',async()=>{
 const DB=database(),host=[...PRESS_AUDIT_HOSTS].find(host=>!PAPERS[host]);assert(host,'At least one registered host has no import adapter');const {run}=await create(DB,['https://'+host+'/news/fictional-community-story']);let calls=0;const response=await add(DB,run,run.entries[0],async()=>{calls++;throw Error();});assert.equal(response.status,422);assert.equal(calls,0);const result=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(result.runs[0].entries[0].status,'failed');assert.match(result.runs[0].entries[0].error,/no direct import adapter/);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0);
});

test('a finite library stage uses its reservation while normal library lookups remain capped',async()=>{
 const DB=database(),day=new Date().toISOString().slice(0,10),url='https://thetimes.com/uk/article/fictional-community-gardens-abcdefghi',title='A fictional Times headline about community gardens';
 DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run('library-lookup:camden:'+day,30);
 const encrypted=await sealLibrary(vaultKey,{libraryName:'CamdenLibraries',cardNumber:'synthetic-card-private',session:null});DB.sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden',encrypted,'connected',new Date().toISOString(),'');
 const {run}=await create(DB,[{url,sourceHeadline:title}]),claimed=await claimPressAuditEntry(request({}),config(DB),{runId:run.id,entryId:run.entries[0].id,url,requestId:crypto.randomUUID()});let calls=0;
 const html=text=>new Response(text,{headers:{'content-type':'text/html'}}),fetcher=async(address)=>{calls++;const u=new URL(address);if(u.hostname==='infoweb.newsbank.com'&&['/apps/news/','/apps/news/browse-multi'].includes(u.pathname))return html('<form action="/apps/news/search"><input id="edit-val-base-0" name="query"><input name="p" value="UKNB"></form>');if(u.pathname==='/apps/news/search')return html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF1234">'+title+'</a></h3><ul>The Times October 17, 2026</ul></div>');if(u.pathname==='/apps/news/document-view')return html('<div id="document-view--ascii"><h1>'+title+'</h1><div class="document-view__meta">Author/Byline: Synthetic Reporter 20 Words The Times October 17, 2026</div><div class="document-view__body--ascii">'+Array.from({length:4},(_,i)=>'<p>Synthetic article paragraph '+i+' contains fictional source text only.</p>').join('')+'</div></div>');throw Error('Unexpected synthetic destination');};
 const source=await lookupNewsBankSource(url,config(DB),fetcher,title,undefined,{auditAllowance:claimed.allowance});assert.equal(source.originalURL,url);assert.equal(source.title,title);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get('library-lookup:camden:'+day).n,30);assert(calls>0);
 const count=calls;await assert.rejects(lookupNewsBankSource(url,config(DB),fetcher,title,undefined,{auditAllowance:claimed.allowance}),/does not match/);assert.equal(calls,count);await assert.rejects(lookupNewsBankSource(url,config(DB),fetcher,title),/thirty library lookups/);assert.equal(calls,count);
});

test('strict failure classification returns only fixed codes/text and ignores source prose or malicious additions',()=>{
 const cases=[
  ['This article is marked as subscription-only. Open the readable original and import a reviewed Page Lens capture.','subscription_only'],
  ['The source contains a subscription prompt. RET will not treat it as a complete article. Use a reviewed capture of the page you can read.','subscription_only'],
  ['The source marks this article as gated. Public eligibility has not been verified.','gated_unverified'],
  ['The newspaper requires a browser check. Open the original in your browser.','browser_check'],
  ['Only a short preview was found. Use a reviewed capture of the complete readable page.','short_preview'],
  ...[402,403].map(status=>['The newspaper did not make this page available to RET (HTTP '+status+'). Use a reviewed readable-page capture.','publisher_denied']),
  ['No article headline was found. Use Page Lens on the readable original.','headline_required'],
  ['The Times headline could not be verified for this URL. Supply the original headline for review. No library article was substituted.','headline_required'],
  ['The library search did not find one unambiguous headline match. No article was substituted.','library_no_match'],
  ['The URL words did not closely match the returned library headline and date. Paste the original newspaper headline to check it. No article was substituted.','library_no_match'],
  ['DeepSeek did not finish the commentary. The capture was not saved.','commentary_unavailable'],
  ['DeepSeek commentary is unavailable. The capture was not saved.','commentary_unavailable']
 ];
 for(const [message,code] of cases){assert.equal(classifyPressAuditFailure(message).errorCode,code);const contaminated=classifyPressAuditFailure(message+' <script>private-source-sentinel</script>');assert.equal(contaminated.errorCode,'import_failed');assert.doesNotMatch(contaminated.error,/script|private-source-sentinel/);}
 for(const raw of [null,undefined,{},[],{error:cases[0][0]},'subscription-only: private-source-sentinel','cardNumber=secret-value Cookie=private-value','x'.repeat(10000)]){const result=classifyPressAuditFailure(raw);assert.equal(result.errorCode,'import_failed');assert.doesNotMatch(JSON.stringify(result),/private-source-sentinel|secret-value|private-value/);}
 assert.equal(classifyPressAuditFailure('arbitrary source prose',true).errorCode,'headline_required');
});

test('future failed audit entries persist fixed source outcomes without retrying or exposing arbitrary errors',async()=>{
 const cases=[
  {code:'subscription_only',html:'<script type="application/ld+json">{"isAccessibleForFree":false}</script>'},
  {code:'browser_check',html:'<title>Just a moment</title>'},
  {code:'short_preview',html:'<article><h1>A synthetic community headline</h1><p>This fictional article contains only a short synthetic preview for this test.</p></article>'},
  {code:'headline_required',html:'<article><p>This fictional source contains no headline.</p></article>'},
  {code:'publisher_denied',http:403},
  {code:'commentary_unavailable',html:fixture,providerBad:true},
  {code:'import_failed',throws:'private-source-sentinel cardNumber=private-card Cookie=private-session'}
 ];
 for(const item of cases){
  const DB=database(),{run}=await create(DB,[article('fictional-'+item.code+'-story')]);let calls=0;
  const response=await add(DB,run,run.entries[0],async url=>{calls++;if(item.throws)throw Error(item.throws);if(url==='https://api.deepseek.com/chat/completions'){assert(item.providerBad);return Response.json({choices:[{finish_reason:'length'}]});}return new Response(item.html||'Denied',{status:item.http||200,headers:{'content-type':'text/html'}});});
  assert(!response.ok);const immediate=await response.json();assert.equal(immediate.errorCode,item.code);assert.doesNotMatch(JSON.stringify(immediate),/private-source-sentinel|private-card|private-session/);
  const saved=DB.sql.prepare('SELECT error_code,status FROM rr_press_audit_entries').get();assert.equal(saved.error_code,item.code);assert.equal(saved.status,'failed');
  const result=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(result.runs[0].entries[0].errorCode,item.code);assert.doesNotMatch(JSON.stringify(result),/private-source-sentinel|private-card|private-session|isAccessibleForFree/);
  const before=calls;assert.equal((await add(DB,run,run.entries[0],async()=>{calls++;throw Error('No retry');})).status,409);assert.equal(calls,before);
 }
});

test('new classifications do not rewrite earlier generic receipts; unknown stored codes are never reflected',async()=>{
 const DB=database(),{run}=await create(DB,[article('earlier-generic-story'),article('future-specific-story')]);
 for(const [index,errorCode] of [[0,undefined],[1,'gated_unverified']]){const entry=run.entries[index],claimed=await claimPressAuditEntry(request({}),config(DB),{runId:run.id,entryId:entry.id,url:entry.url,requestId:crypto.randomUUID()});await finishPressAuditEntry(claimed.allowance,{ok:false,status:422,errorCode});}
 let result=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(result.runs[0].entries[0].errorCode,'import_failed');assert.equal(result.runs[0].entries[1].errorCode,'gated_unverified');
 DB.sql.prepare('UPDATE rr_press_audit_entries SET error_code=? WHERE id=?').run('<script>private-source-sentinel</script>',run.entries[1].id);
 result=await (await pressAuditAPI(request(undefined,{method:'GET'}),config(DB))).json();assert.equal(result.runs[0].entries[1].errorCode,'import_failed');assert.doesNotMatch(JSON.stringify(result),/private-source-sentinel|script/);
});
