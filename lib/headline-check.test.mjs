import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {headlineEvidence,validateHeadlineCheck,HEADLINE_CHECK_REPAIR_PROMPT} from './headline-check.mjs';
import {headlineCheckAPI} from './headline-check-service.ts';
import {addHeadlinePassageAnchors} from './headline-check-view.mjs';
import {memberAuthAPI,memberAuthGate,roomsAPI} from './member-auth.ts';
import {DEFAULT_ROOM_ID} from './rooms.ts';

const origin='https://reader.example',ownerEmail='owner@example.org',now=Date.now();
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();
const id='a'.repeat(48),headline='Council says river scheme is already transforming the town';
const paragraph=n=>Array.from({length:46},(_,i)=>`report${n}_${i}`).join(' ');

function document(extra={}){return {kind:'rendered-capture-v1',capture:{schema:'ret-capture/v1',url:'https://news.example/river',title:headline+' - Residents question the timetable',standfirst:'The project has started, but several promised stages remain unfinished.',presentation:{method:'library-text'},diagnostics:{completeNotCertified:true},blocks:[{id:'B1',type:'paragraph',text:paragraph(1)},{id:'AD',type:'ad',text:'Buy this product now'},{id:'B2',type:'quote',text:paragraph(2)},{id:'IMG',type:'figure',caption:'A caption that must not be assessed'}]},annotations:[{blockId:'B1',comment:'Private AI annotation'}],privateNote:'never send',...extra};}
function page(doc=document()){return {id,sourceURL:'https://news.example/river',comment:'A reader comment',document:doc};}
function validRaw(evidence){return {summary:'The headline is partly supported, while its claim of completed transformation is broader than the retained reporting.',findings:[{headlinePhrase:'already transforming the town',assessment:'qualified',explanation:'The passages describe work beginning and record uncertainty about completion.',support:[{blockId:'B1',excerpt:evidence.blocks[0].text.slice(0,80)}]}],limitations:['The retained capture is not certified complete.']};}

test('headline evidence keeps only original prose and splits a library headline from its deck',()=>{
 const result=headlineEvidence(page());assert.equal(result.available,true);assert.equal(result.title,headline);assert.equal(result.standfirst,'Residents question the timetable');assert.deepEqual(result.blocks.map(x=>x.id),['B1','B2']);assert.equal(JSON.stringify(result).includes('Buy this product'),false);assert.equal(JSON.stringify(result).includes('caption'),false);assert.equal(JSON.stringify(result).includes('annotation'),false);assert(result.limitations.some(x=>/complete/i.test(x)));
});

test('generated, short, access-warning and oversized editions are unavailable',()=>{
 const generated=headlineEvidence(page({kind:'library-study-v1',facts:[{text:paragraph(1)}]}));assert.equal(generated.available,false);
 const short=document();short.capture.blocks=[{id:'B1',type:'paragraph',text:'Too little text.'},{id:'B2',type:'quote',text:'Still too little.'}];assert.equal(headlineEvidence(page(short)).available,false);
 const warned=document();warned.capture.diagnostics.paywallDetected=true;assert.equal(headlineEvidence(page(warned)).available,false);
 const huge=document();huge.capture.blocks=[{id:'B1',type:'paragraph',text:'word '.repeat(5000)},{id:'B2',type:'paragraph',text:'word '.repeat(5000)}];assert.equal(headlineEvidence(page(huge)).available,false);
});

test('validation replaces checked excerpts with passage ids and rejects malformed or invented support',()=>{
 const evidence=headlineEvidence(page()),check=validateHeadlineCheck(validRaw(evidence),evidence);assert.deepEqual(check.findings[0].support,undefined);assert.deepEqual(check.findings[0].passageIds,['B1']);assert.equal(JSON.stringify(check).includes(evidence.blocks[0].text.slice(0,80)),false);
 for(const mutate of [x=>{x.findings=[]},x=>{x.findings[0].assessment='true'},x=>{x.findings[0].headlinePhrase='words absent from headline'},x=>{x.findings[0].support[0].blockId='UNKNOWN'},x=>{x.findings[0].support[0].excerpt='fabricated evidence passage of sufficient length'},x=>{x.findings[0].support[0].excerpt='short'}]){const raw=structuredClone(validRaw(evidence));mutate(raw);assert.throws(()=>validateHeadlineCheck(raw,evidence));}
});

test('passage aliases preserve source ids and refuse ambiguous text matches',()=>{
 const {document:d}=parseHTML('<html><body><div class="source-block"><p id="original">Exact\n passage text</p></div><div class="source-block"><p>Repeated text</p><p>Repeated text</p></div></body></html>');addHeadlinePassageAnchors(d,[{id:'P1',text:'Exact passage text'},{id:'P2',text:'Repeated text'}]);
 assert.equal(d.getElementById('original').id,'original');assert.equal(d.getElementById('P1').parentElement.id,'original');assert.equal(d.getElementById('P2'),null);
});

test('all saved critical-edition evidence passages receive resolvable aliases',()=>{
 const critical=JSON.parse(readFileSync(new URL('./critical-evidence.json',import.meta.url),'utf8')),template=readFileSync(new URL('./critical-times.html',import.meta.url),'utf8'),{document:d}=parseHTML(template);addHeadlinePassageAnchors(d,critical.blocks);
 assert.equal(critical.blocks.length,2);assert.deepEqual(critical.blocks.filter(block=>!d.getElementById(block.id)).map(block=>block.id),[]);
});

function database(){const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));return {sql,async batch(statements){sql.exec('BEGIN');try{const out=statements.map(x=>x._run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){const statement=sql.prepare(query),wrap=args=>({_run:()=>({meta:{changes:Number(statement.run(...args).changes)}}),first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};}
const config=(DB,extra={})=>({DB,READER_OWNER_EMAIL:ownerEmail,DEEPSEEK_API_KEY:'test-key',...extra});
function raw(path,method='GET',body,cookie='',headers={}){return new Request(origin+path,{method,headers:{Origin:origin,'X-Reading-Room':'1',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});}
function cookies(response,previous=''){const jar=new Map(previous.split(';').filter(Boolean).map(x=>x.trim().split('=')));for(const line of response.headers.getSetCookie()){const [key,value]=line.split(';')[0].split('=');if(value)jar.set(key,value);else jar.delete(key);}return [...jar].map(([k,v])=>k+'='+v).join('; ');}
async function bootstrap(DB){const r=await memberAuthAPI(raw('/api/member-auth?action=bootstrap','POST',{},'',{'oai-authenticated-user-email':ownerEmail}),config(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now);assert.equal(r.status,201);return cookies(r);}
async function createRoom(DB,cookie){const r=await roomsAPI(raw('/api/rooms','POST',{action:'create',name:'Other'},cookie),config(DB),now);assert.equal(r.status,201);return {cookie:cookies(r,cookie),id:(await r.json()).room.id};}
async function gated(DB,cookie,body={id},headers={},path='/api/headline-check'){const r=await memberAuthGate(raw(path,'POST',body,cookie,headers),config(DB),now);assert(r instanceof Request);return r;}
function addPage(DB,roomId=DEFAULT_ROOM_ID,pageId=id,doc=document()){const owner=DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(roomId).owner_id;DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,comment,created_at) VALUES(?,?,?,?,?,?,?)').run(pageId,'headline:'+pageId,'https://news.example/river',headline,JSON.stringify(doc),'Keep this comment',new Date(now).toISOString());DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomId,pageId,owner,new Date(now).toISOString());return doc;}
const readDoc=(DB,pageId=id)=>JSON.parse(DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(pageId).document);
function provider(options={}){const calls=[];let release=options.release;return {calls,fetcher:async(url,init)=>{calls.push({url,input:JSON.parse(init.body)});if(release)await release;if(options.response)return options.response();const evidence={title:headline,blocks:[{id:'B1',text:paragraph(1)},{id:'B2',text:paragraph(2)}]};return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(validRaw(evidence))}}]});}};}
function providerSequence(results){const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url,input:JSON.parse(init.body)});const next=results.shift();return typeof next==='function'?next():Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(next)}}]});}};}

test('service denies missing sessions, foreign-room articles and cross-origin writes before provider work',async()=>{
 const DB=database(),owner=await bootstrap(DB),other=await createRoom(DB,owner),foreign='b'.repeat(48);addPage(DB,other.id,foreign);const p=provider();
 assert.equal((await headlineCheckAPI(raw('/api/headline-check','POST',{id}),config(DB),p.fetcher)).status,401);
 assert.equal((await headlineCheckAPI(await gated(DB,owner,{id:foreign}),config(DB),p.fetcher)).status,404);
 assert.equal((await headlineCheckAPI(await gated(DB,owner,{id},{Origin:'https://attacker.example'}),config(DB),p.fetcher)).status,403);assert.equal(p.calls.length,0);
});

test('revoked room membership is rejected by the session gate before provider work',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const p=provider(),member=DB.sql.prepare('SELECT member_id FROM rr_sessions WHERE revoked_at IS NULL').get().member_id;DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run(new Date(now).toISOString(),DEFAULT_ROOM_ID,member);
 const denied=await memberAuthGate(raw('/api/headline-check','POST',{id},owner),config(DB),now);assert(denied instanceof Response);assert.equal(denied.status,401);assert.equal(p.calls.length,0);
});

test('service bounds requests and returns unavailable editions without provider work',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB,DEFAULT_ROOM_ID,id,{kind:'library-study-v1',facts:[]});const p=provider();
 const unavailable=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher);assert.equal(unavailable.status,200);assert.equal((await unavailable.json()).available,false);
 assert.equal((await headlineCheckAPI(await gated(DB,owner,{id:'bad'}),config(DB),p.fetcher)).status,404);
 assert.equal((await headlineCheckAPI(await gated(DB,owner,JSON.stringify({id,extra:'x'.repeat(9000)})),config(DB),p.fetcher)).status,413);assert.equal(p.calls.length,0);
});

test('provider receives original headline evidence only; result is cached without changing source or annotations',async()=>{
 const DB=database(),owner=await bootstrap(DB),before=addPage(DB),p=provider(),request=()=>gated(DB,owner);
 let response=await headlineCheckAPI(await request(),config(DB),p.fetcher),result=await response.json();assert.equal(response.status,200);assert.equal(result.available,true);assert.equal(result.cached,false);assert.deepEqual(result.check.findings[0].passageIds,['B1']);assert.equal(p.calls.length,1);
 const payload=p.calls[0].input.messages.at(-1).content;assert.match(payload,/report1_0/);for(const forbidden of ['Private AI annotation','A reader comment','never send','https://news.example'])assert.doesNotMatch(payload,new RegExp(forbidden));
 const after=readDoc(DB);assert.deepEqual(after.capture,before.capture);assert.deepEqual(after.annotations,before.annotations);assert.equal(after.privateNote,before.privateNote);assert(after.headlineCheck.fingerprint);assert.equal(JSON.stringify(after.headlineCheck).includes('report1_0 report1_1'),false);
 response=await headlineCheckAPI(await request(),config(DB),p.fetcher);result=await response.json();assert.equal(result.cached,true);assert.equal(p.calls.length,1);
});

test('one headline-phrase validation failure gets one bounded retry with identical evidence',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const evidence=headlineEvidence(page()),bad={...validRaw(evidence),summary:'MODEL_OUTPUT_SENTINEL should not be retained or repeated.',findings:[{...validRaw(evidence).findings[0],headlinePhrase:'Residents question the timetable'}]},p=providerSequence([bad,validRaw(evidence)]);
 const response=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher),result=await response.json(),day=new Date().toISOString().slice(0,10);
 assert.equal(response.status,200);assert.equal(result.available,true);assert.equal(p.calls.length,2);
 assert.equal(p.calls[0].input.messages.at(-1).content,p.calls[1].input.messages.at(-1).content);assert.equal(p.calls[1].input.messages[1].content,HEADLINE_CHECK_REPAIR_PROMPT);assert.doesNotMatch(JSON.stringify(p.calls[1].input),/MODEL_OUTPUT_SENTINEL/);
 assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get('room-headline:'+DEFAULT_ROOM_ID+':'+day).n,1);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get('headline-global:'+day).n,1);assert(readDoc(DB).headlineCheck);
});

test('a second unknown headline phrase fails closed after two calls with no cache',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const evidence=headlineEvidence(page()),bad={...validRaw(evidence),findings:[{...validRaw(evidence).findings[0],headlinePhrase:'Residents question the timetable'}]},p=providerSequence([bad,bad]);
 const response=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher),result=await response.json();
 assert.equal(response.status,502);assert.equal(result.diagnostic,'unknown_headline_phrase');assert.equal(p.calls.length,2);assert.equal(readDoc(DB).headlineCheck,undefined);
});

test('the combined provider deadline prevents starting a retry after 70 seconds',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const evidence=headlineEvidence(page()),bad={...validRaw(evidence),findings:[{...validRaw(evidence).findings[0],headlinePhrase:'Residents question the timetable'}]},p=providerSequence([bad,validRaw(evidence)]),originalNow=Date.now;let fakeNow=originalNow();
 Date.now=()=>fakeNow;let response;try{response=await headlineCheckAPI(await gated(DB,owner),config(DB),async(...args)=>{const result=await p.fetcher(...args);fakeNow+=70001;return result;});}finally{Date.now=originalNow;}
 const result=await response.json();assert.equal(response.status,502);assert.equal(result.diagnostic,'retry_deadline_exceeded');assert.equal(p.calls.length,1);assert.equal(readDoc(DB).headlineCheck,undefined);
});

test('other validation failures do not trigger a retry',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const evidence=headlineEvidence(page()),bad={...validRaw(evidence),findings:[{...validRaw(evidence).findings[0],support:[]}]},p=providerSequence([bad,validRaw(evidence)]);
 const response=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher),result=await response.json();
 assert.equal(response.status,502);assert.equal(result.diagnostic,'missing_support');assert.equal(p.calls.length,1);assert.equal(readDoc(DB).headlineCheck,undefined);
});

test('changing retained source text invalidates the cached check',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const p=provider(),request=()=>gated(DB,owner);assert.equal((await headlineCheckAPI(await request(),config(DB),p.fetcher)).status,200);const changed=readDoc(DB);changed.capture.blocks.find(x=>x.id==='B2').text+=' A newly retained sentence changes the evidence.';DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(changed),id);
 const response=await headlineCheckAPI(await request(),config(DB),p.fetcher),result=await response.json();assert.equal(response.status,200);assert.equal(result.cached,false);assert.equal(p.calls.length,2);assert.notEqual(readDoc(DB).headlineCheck.fingerprint,changed.headlineCheck.fingerprint);
});

test('missing key, exhausted cap, provider failure and invalid support fail closed',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);let p=provider();assert.equal((await headlineCheckAPI(await gated(DB,owner),config(DB,{DEEPSEEK_API_KEY:''}),p.fetcher)).status,503);assert.equal(p.calls.length,0);
 DB.sql.prepare('INSERT INTO education_counters(key,n) VALUES(?,20)').run('room-headline:'+DEFAULT_ROOM_ID+':'+new Date().toISOString().slice(0,10));assert.equal((await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher)).status,429);assert.equal(p.calls.length,0);DB.sql.prepare('DELETE FROM education_counters').run();
 p=provider({response:()=>new Response('private provider detail',{status:503})});let r=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher),diagnostic=await r.json();assert.equal(r.status,502);assert.equal(diagnostic.diagnostic,'provider_failed');assert.doesNotMatch(JSON.stringify(diagnostic),/private provider detail/);
 p=provider({response:()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...validRaw(headlineEvidence(page())),findings:[{...validRaw(headlineEvidence(page())).findings[0],support:[{blockId:'B1',excerpt:'fabricated evidence passage that is not present in the source'}]}]})}}]})});const warnings=[],originalWarn=console.warn;console.warn=(...args)=>warnings.push(args);try{r=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher);}finally{console.warn=originalWarn;}diagnostic=await r.json();assert.equal(r.status,502);assert.equal(diagnostic.diagnostic,'unverified_support');assert.equal(readDoc(DB).headlineCheck,undefined);assert.equal(warnings.length,1);assert.equal(warnings[0][0],'RR_HEADLINE_CHECK_FAILED');assert.deepEqual(JSON.parse(warnings[0][1]),{stage:'validation',code:'unverified_support'});assert.doesNotMatch(warnings[0][1],/report1_|fabricated|news\.example/i);
});

test('a global cap rejection does not consume the room allowance',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const day=new Date().toISOString().slice(0,10),roomKey='room-headline:'+DEFAULT_ROOM_ID+':'+day;DB.sql.prepare('INSERT INTO education_counters(key,n) VALUES(?,100)').run('headline-global:'+day);const p=provider(),response=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher);
 assert.equal(response.status,429);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(roomKey).n,0);assert.equal(p.calls.length,0);
});

test('non-stop and malformed provider output are rejected with safe fixed diagnostics and no cache',async()=>{
 for(const [response,code] of [[()=>Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(validRaw(headlineEvidence(page())))}}]}),'provider_incomplete'],[()=>Response.json({choices:[{finish_reason:'stop',message:{content:'not json'}}]}),'provider_json_invalid']]){const DB=database(),owner=await bootstrap(DB);addPage(DB);const p=provider({response}),result=await headlineCheckAPI(await gated(DB,owner),config(DB),p.fetcher),body=await result.json();assert.equal(result.status,502);assert.equal(body.diagnostic,code);assert.deepEqual(Object.keys(body).sort(),['diagnostic','error']);assert.equal(readDoc(DB).headlineCheck,undefined);}
});

test('saving a completed check merges with media and annotations added during the provider call',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);const base=provider(),fetcher=async(...args)=>{const current=readDoc(DB);current.capture.blocks.push({id:'MEDIA',type:'figure',url:'https://images.example/media.jpg',caption:'Added concurrently'});current.annotations.push({blockId:'B2',comment:'Added concurrently'});DB.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(current),id);return base.fetcher(...args);};
 const response=await headlineCheckAPI(await gated(DB,owner),config(DB),fetcher),after=readDoc(DB);assert.equal(response.status,200);assert(after.headlineCheck);assert.equal(after.capture.blocks.at(-1).id,'MEDIA');assert.equal(after.annotations.at(-1).comment,'Added concurrently');
});

test('concurrent requests hold one article lock and make one provider call',async()=>{
 const DB=database(),owner=await bootstrap(DB);addPage(DB);let release;const wait=new Promise(resolve=>release=resolve),p=provider({release:wait}),request=()=>gated(DB,owner);
 const first=headlineCheckAPI(await request(),config(DB),p.fetcher);while(p.calls.length===0)await new Promise(resolve=>setTimeout(resolve,1));const second=await headlineCheckAPI(await request(),config(DB),p.fetcher);assert.equal(second.status,409);assert.equal(p.calls.length,1);release();assert.equal((await first).status,200);assert.equal(p.calls.length,1);assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM education_counters WHERE key LIKE 'headline-lock:%'").get().n,0);
});
