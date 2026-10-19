import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {createNewsBankHTTPClient,TELEGRAPH_ENTRY,normalizeNewsBankDate} from './newsbank-http.mjs';
import {PUBLICATION_SEARCH_KEYS,publicationSearchQuery,publicationLabel,publicationEvidence,publicationSearchPage,sanitizePublicationSearch,sanitizePublicationSearchStatus} from './newsbank-publications.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {librarySettingsAPI} from './library-server.ts';
import {sealLibrary} from './library-vault.mjs';
import {handler} from '../server-library/handler.mjs';

const origin='https://reader.example',title='A fictional report about local college funding',query={publication:'herald',title};
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'synthetic-session',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const searchForm='<form action="/apps/news/search" method="GET"><input id="edit-val-base-0" name="query"><select name="fld-base-0"><option value="TX">All Text</option><option value="TI">Title</option></select><input type="hidden" name="p" value="UKNB"><input type="hidden" name="form-token" value="PRIVATE-FORM-VALUE"></form>';
const hit=(id,publication='The Herald (Glasgow, Scotland)',extra='')=>`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/${id}">${title}</a></h3><ul><li>October 18, 2026</li><li>${publication}</li></ul><p>PRIVATE ARTICLE SNIPPET MUST NOT CROSS</p>${extra}</div>`;
const resultPage=hit('ABCDEF')+hit('DEADBEEF','The New York Times')+'<div class="search-hits__hit"><h3><a href="https://attacker.example/steal">Invalid result destination</a></h3></div><a rel="next" href="/apps/news/search?page=2">Next</a>';
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'content-type':'text/html',...headers}});
function provider(results=resultPage){const calls=[];return {calls,fetch:async(raw,init={})=>{calls.push({raw,init});const url=new URL(raw);assert.equal(url.origin,'https://infoweb.newsbank.com');assert.equal(init.headers.get('cookie'),'nb=synthetic-session');if(url.pathname==='/apps/news/')return html(searchForm);if(url.pathname==='/apps/news/search'){assert.equal(url.searchParams.get('query'),'"'+title+'"');assert.equal(url.searchParams.get('fld-base-0'),'TI');return html(results);}throw Error('An article or other route was unexpectedly requested.');}};}
const metadata=()=>({status:'metadata',schema:'newsbank-publications/v1',requested:query,pageCount:1,inspectedCount:1,rejectedLinkCount:0,truncated:false,results:[{title,date:'2026-10-18',publication:'The Herald (Glasgow, Scotland)',libraryURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABCDEF'}],fullTextVerified:false,articleAccepted:false});

test('publication queries are fixed and bounded; arbitrary URLs and malformed publications are rejected',()=>{
 assert.deepEqual(publicationSearchQuery(query),query);
 for(const bad of [{...query,publication:'all'},{...query,publication:'https://attacker.example'},{...query,url:'https://attacker.example'},{...query,title:'x'},{...query,title:'A headline https://example.org/'},{...query,title:'A headline <script>bad</script>'},{...query,title:'x'.repeat(401)}])assert.throws(()=>publicationSearchQuery(bad),/invalid_publication_query/);
 assert.equal(publicationLabel('The National Post'),'');assert.equal(publicationLabel('International Herald Tribune'),'');
 assert.equal(publicationLabel('Publication: The Scotsman (Edinburgh, Scotland)'),'The Scotsman (Edinburgh, Scotland)');
 for(const publication of ['observer','express','ft','morning-star','irish-times','irish-independent','irish-examiner'])assert.equal(publicationSearchQuery({...query,publication}).publication,publication);
 for(const label of ['The Observer','Daily Express','Sunday Express','Financial Times','Morning Star'])assert.equal(publicationLabel(label),label);
 assert.equal(publicationLabel('Daily Express Tribune'),'');assert.equal(publicationLabel('Morning Star News Weekly'),'');
});

test('metadata search accepts the observed easy-search route and classifies a login redirect without fetching it',async()=>{
 const calls=[];const client=createNewsBankHTTPClient({fetch:async(raw)=>{calls.push(raw);const url=new URL(raw);if(url.pathname==='/apps/news/')return html('',302,{location:'/apps/news/easy-search?p=UKNB'});if(url.pathname==='/apps/news/easy-search'&&!url.searchParams.has('query'))return html(searchForm.replace('/apps/news/search','/apps/news/easy-search'));if(url.pathname==='/apps/news/easy-search')return html(resultPage);throw Error('Unexpected route');}});client.restoreSession(session);
 assert.equal((await client.searchPublications(query)).status,'metadata');assert.equal(calls.length,3);assert(calls.every(raw=>!String(raw).includes('document-view')));
 let loginCalls=0;const expired=createNewsBankHTTPClient({fetch:async()=>{loginCalls++;return html('',302,{location:'https://arthur.newsbank.com/library-card?d=PRIVATE'});}});expired.restoreSession(session);
 assert.deepEqual(await expired.searchPublications(query),{status:'login_required',stage:'entry',reasonCode:'session_expired'});assert.equal(loginCalls,1);
});

test('observed InfoWeb authentication routes classify the session before any login page is fetched',async()=>{
 for(const path of ['/apps/news/user/login','/apps/news/user/librarycard']){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return html('',302,{location:path+'?destination=easy-search%3Fp%3DUKNB&session=PRIVATE'});}});client.restoreSession(session);
  const result=await client.searchPublications(query);assert.deepEqual(result,{status:'login_required',stage:'entry',reasonCode:'session_expired'});assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|destination|user\/login|librarycard|\?/);
 }
});

test('the observed ordinary results route returns first-page metadata without following Next',async()=>{
 const calls=[];const client=createNewsBankHTTPClient({fetch:async(raw,options)=>{calls.push(raw);const url=new URL(raw);if(url.pathname==='/apps/news/')return html(searchForm.replace('/apps/news/search','/apps/news/results?p=UKNB'));
  assert.equal(url.pathname,'/apps/news/results');assert.equal(options.method,'GET');assert.equal(url.searchParams.get('query'),'"'+title+'"');assert.equal(url.searchParams.get('p'),'UKNB');return html(resultPage);}});client.restoreSession(session);
 const result=await client.searchPublications(query);assert.equal(result.status,'metadata');assert.equal(result.pageCount,1);assert.equal(result.truncated,true);assert.equal(calls.length,2);assert.deepEqual(result.publications,['The Herald (Glasgow, Scotland)','The New York Times']);
});

test('metadata search refuses document references, cross-collection destinations and unknown routes before fetch',async()=>{
 for(const target of ['/apps/news/results?docref=news/ABCDEF','/apps/news/results?DOCREF=news/ABCDEF','/apps/news/results?p=OTHER','/apps/news/results?p=UKNB&p=OTHER','/apps/news/results?P=OTHER','/apps/news/changed-route?p=UKNB']){
  for(const asForm of [false,true]){
   let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return asForm?html(searchForm.replace('/apps/news/search',target.replaceAll('&','&amp;'))):html('',302,{location:target});}});client.restoreSession(session);
   const result=await client.searchPublications(query);assert.equal(result.status,'needs_interaction');assert.equal(result.reasonCode,asForm?'destination_changed':'route_changed');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/ABCDEF|OTHER|docref|\?/i);
  }
 }
 for(const field of ['<input name="docref" value="news/ABCDEF">','<input name="p" value="OTHER">']){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return html(searchForm.replace('method="GET"','method="POST"').replace('<input type="hidden" name="p" value="UKNB">',field));}});client.restoreSession(session);
  assert.equal((await client.searchPublications(query)).reasonCode,'destination_changed');assert.equal(calls,1);
 }
});

test('one ordinary headline search returns first-page source labels without opening documents or following Next',async()=>{
 const fixture=provider(),client=createNewsBankHTTPClient({fetch:fixture.fetch});client.restoreSession(session);
 const result=await client.searchPublications(query);
 assert.equal(result.status,'metadata');assert.equal(result.pageCount,1);assert.equal(result.inspectedCount,3);assert.equal(result.rejectedLinkCount,1);assert.equal(result.truncated,true);
 assert.deepEqual(result.publications,['The Herald (Glasgow, Scotland)','The New York Times']);assert.equal(result.results[0].date,'2026-10-18');
 assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.equal(fixture.calls.length,2);
 assert.equal(fixture.calls[0].raw,TELEGRAPH_ENTRY);assert(fixture.calls.every(call=>!String(call.raw).includes('document-view')));
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|snippet|cookie|session|form-token|paragraphs/);
});

test('an absent session makes no request; invalid query makes no request; expired session is not reauthenticated',async()=>{
 let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;throw Error('No network expected');}});
 assert.deepEqual(await client.searchPublications(query),{status:'login_required',stage:'session',reasonCode:'session_expired'});
 await assert.rejects(()=>client.searchPublications({...query,url:'https://attacker.example'}),/invalid_publication_query/);
 client.restoreSession({...session,cookies:session.cookies.map(cookie=>({...cookie,expires:Date.now()-1}))});
 assert.deepEqual(await client.searchPublications(query),{status:'login_required',stage:'session',reasonCode:'session_expired'});assert.equal(calls,0);
});

test('search challenges, article redirects and hostile form actions stop before any document fetch',async()=>{
 for(const [content,stage,reasonCode] of [[html('<html><body><h1>Verify you are human</h1></body></html>'),'entry','entry_needs_interaction'],[html('',302,{location:'/apps/news/document-view?p=UKNB&docref=news/ABCDEF'}),'route','route_changed'],[html(searchForm.replace('/apps/news/search','https://attacker.example/search')),'form','destination_changed']]){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return content.clone();}});client.restoreSession(session);
  assert.deepEqual(await client.searchPublications(query),{status:'needs_interaction',stage,reasonCode,...(stage==='route'?{observedPath:'/apps/news/document-view'}:{})});assert.equal(calls,1);
 }
 const fixture=provider('<p>No search results found.</p>'),client=createNewsBankHTTPClient({fetch:fixture.fetch});client.restoreSession(session);
 const empty=await client.searchPublications(query);assert.equal(empty.status,'metadata');assert.deepEqual(empty.publications,[]);assert.equal(empty.inspectedCount,0);
});

test('metadata reconstruction refuses hidden text, credential fields, malformed source URLs and unverifiable labels',()=>{
 const base=metadata();assert.equal(sanitizePublicationSearch(base).articleAccepted,false);
 for(const bad of [{...base,session},{...base,paragraphs:['PRIVATE']},{...base,pageCount:2},{...base,articleAccepted:true},{...base,results:[null]},{...base,results:[{...base.results[0],snippet:'PRIVATE'}]},{...base,results:[{...base.results[0],libraryURL:'https://attacker.example/document'}]},{...base,results:[{...base.results[0],publication:'The National Post'}]}])assert.equal(sanitizePublicationSearch(bad),null);
});

test('signed metadata handler requires a session and never accepts credentials or URL input',async()=>{
 let calls=0;const noFetch={fetch:async()=>{calls++;throw Error('No fetch expected');}};
 assert.deepEqual(await handler({action:'search-publications',...query},noFetch),{status:'login_required',stage:'session',reasonCode:'session_expired'});
 assert.equal((await handler({action:'search-publications',...query,session,url:'https://attacker.example'},noFetch)).code,'invalid_publication_query');
 assert.equal((await handler({action:'search-publications',...query,session,cardNumber:'PRIVATE-CARD'},noFetch)).code,'invalid_publication_query');assert.equal(calls,0);
 const fixture=provider(),result=await handler({action:'search-publications',...query,session},{fetch:fixture.fetch});
 assert.equal(result.status,'metadata');assert.equal(fixture.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|session|cookies|cardNumber|paragraphs/);
});

test('signed transport sends only existing session plus bounded query and rejects body-bearing responses',async()=>{
 const config={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-not-real-secret-1234567890'};
 const client=runtimeLibraryClient(config,async(_url,init)=>{const sent=JSON.parse(init.body);assert.deepEqual(Object.keys(sent).sort(),['action','publication','session','title']);assert.equal(sent.action,'search-publications');assert.doesNotMatch(init.body,/PRIVATE-CARD|libraryName|cardNumber/);return Response.json(metadata());},{libraryName:'PRIVATE-LIBRARY',cardNumber:'PRIVATE-CARD'});
 client.restoreSession(session);assert.equal((await client.searchPublications(query)).status,'metadata');
 const hostile=runtimeLibraryClient(config,async()=>Response.json({...metadata(),paragraphs:['PRIVATE']}));hostile.restoreSession(session);await assert.rejects(()=>hostile.searchPublications(query),/metadata response was invalid/);
});

const vault='67'.repeat(32),ownerEmail='owner@example.org',ownerId='owner-member',room='owner-room';
function database(){const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE education_counters(key TEXT PRIMARY KEY,n INTEGER);CREATE TABLE rr_library_connections(id TEXT PRIMARY KEY,encrypted TEXT,state TEXT,checked_at TEXT,last_error TEXT);CREATE TABLE rr_members(id TEXT PRIMARY KEY,role TEXT,revoked_at TEXT);CREATE TABLE rr_rooms(id TEXT PRIMARY KEY,name TEXT,owner_id TEXT,created_at TEXT,moderation TEXT);CREATE TABLE rr_room_members(room_id TEXT,member_id TEXT,role TEXT,revoked_at TEXT);INSERT INTO rr_members VALUES('${ownerId}','owner',NULL);INSERT INTO rr_rooms VALUES('${room}','Fictional room','${ownerId}','2026-10-18','open');INSERT INTO rr_room_members VALUES('${room}','${ownerId}','owner',NULL);`);return {sql,prepare(query){const statement=sql.prepare(query);return {bind(...args){return {first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>statement.run(...args)};}};}};}
const config=DB=>({DB,READER_OWNER_EMAIL:ownerEmail,RR_LIBRARY_VAULT_KEY:vault});
const request=(data,headers={})=>new Request(origin+'/api/library-settings',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Reading-Room':'1','oai-authenticated-user-email':ownerEmail,'x-rr-room-id':room,'x-ret-member-id':ownerId,...headers},body:JSON.stringify(data)});
async function savedAccount(DB,snapshot=session){DB.sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden:'+room,await sealLibrary(vault,{libraryName:'Synthetic library',cardNumber:'PRIVATE-CARD',session:snapshot}),'connected',new Date().toISOString(),'');}

test('owner API requires current room, same origin, owner membership, encrypted account and existing session',async()=>{
 const DB=database();let calls=0;const noFetch=async()=>{calls++;throw Error('No network expected');};const data={action:'search-publications',...query};
 assert.equal((await librarySettingsAPI(request(data,{Origin:'https://attacker.example'}),config(DB),noFetch)).status,403);
 assert.equal((await librarySettingsAPI(request(data,{'x-rr-room-id':''}),config(DB),noFetch)).status,401);
 assert.equal((await librarySettingsAPI(request(data,{'x-ret-member-id':'someone-else'}),config(DB),noFetch)).status,403);
 assert.equal((await librarySettingsAPI(request(data),config(DB),noFetch)).status,409);await savedAccount(DB,null);
 assert.equal((await librarySettingsAPI(request(data),config(DB),noFetch)).status,409);
 assert.equal((await librarySettingsAPI(request({...data,publication:'arbitrary'}),config(DB),noFetch)).status,400);
 assert.equal((await librarySettingsAPI(request({...data,url:'https://attacker.example'}),config(DB),noFetch)).status,400);assert.equal(calls,0);
});

test('owner API preserves ciphertext and existing metadata counts while allowing up to 48 bounded checks',async()=>{
 const DB=database();await savedAccount(DB);const encrypted=DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,fixture=provider();
 const response=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),fixture.fetch);assert.equal(response.status,200);const value=await response.json();assert.equal(value.status,'metadata');assert.equal(value.articleAccepted,false);
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE|cookies|cardNumber|session|paragraphs/);assert.equal(DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,encrypted);
 const counter='library-publication-metadata:camden:'+room+':'+new Date().toISOString().slice(0,10);
 DB.sql.prepare('UPDATE education_counters SET n=12 WHERE key=?').run(counter);assert.equal((await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),fixture.fetch)).status,200);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,13);
 DB.sql.prepare('UPDATE education_counters SET n=47 WHERE key=?').run(counter);assert.equal((await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),fixture.fetch)).status,200);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,48);
 const before=fixture.calls.length,blocked=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),fixture.fetch);assert.equal(blocked.status,429);assert.match((await blocked.json()).error,/48 publication metadata checks/);assert.equal(fixture.calls.length,before);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,48);
});

test('owner operator form is collapsed, bounded and displays labels using text nodes without article opening',()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8'),{document}=parseHTML(html);
 assert.equal(document.querySelector('details').hasAttribute('open'),false);assert.equal(document.getElementById('headline').getAttribute('maxlength'),'400');
 const script=document.querySelector('script').textContent;new vm.Script(script);assert.match(script,/action:'search-publications'/);assert.match(script,/textContent=label/);assert.doesNotMatch(script,/innerHTML|cardNumber|document-view|window\.open/);
});

test('operator form preserves the explicit room on its request/navigation and shows bounded result identity metadata',async()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8'),{document,window}=parseHTML(html);let target='',payload;
 Object.defineProperty(document.getElementById('publication'),'value',{value:'observer'});document.getElementById('headline').value=title;
 const context=vm.createContext({document,window:{location:{href:origin+'/library-coverage?room=another-room'}},URL,URLSearchParams,fetch:async(url,options)=>{target=url;payload=JSON.parse(options.body);return Response.json(metadata());}});
 vm.runInContext(document.querySelector('script').textContent,context);
 assert.equal(document.getElementById('room-back').getAttribute('href'),'/study?room=another-room');assert.equal(document.getElementById('room-settings').getAttribute('href'),'/library-settings?room=another-room');
 document.getElementById('coverage-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(target,'/api/library-settings?room=another-room');assert.equal(payload.publication,'observer');assert.equal(document.querySelectorAll('tbody tr').length,1);assert.equal(document.querySelectorAll('tbody td').length,5);
 assert.match(document.querySelector('tbody').textContent,/fictional report|2026-10-18|The Herald|docref=news/);assert.equal(document.querySelectorAll('#coverage-results a').length,0);
});

test('owner UI shows unverified literal candidates and exports only fixed metadata fields without room or account data',async()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8'),{document,window}=parseHTML(html),label='Herald, The: Web Edition Articles (Glasgow, Scotland)';
 const response={...metadata(),session:'PRIVATE-SESSION',account:'PRIVATE-ACCOUNT',body:'PRIVATE-BODY',results:[{...metadata().results[0],publication:'',snippet:'PRIVATE-SNIPPET',publicationEvidence:{basis:'visible-result-metadata-only',namedFieldCount:0,listItemCount:2,labelledItemCount:0,session:'PRIVATE-EVIDENCE',labels:[{context:'unlabelled-publication-candidate',label,body:'PRIVATE-FIELD'}]}}]};
 Object.defineProperty(document.getElementById('publication'),'value',{value:'herald'});document.getElementById('headline').value=title;
 let download,createdBlob;const timers=[];class DownloadURL extends URL{static createObjectURL(file){createdBlob=file;return 'blob:synthetic';}static revokeObjectURL(){}}
 const make=document.createElement.bind(document);document.createElement=tag=>{const node=make(tag);if(tag==='a')node.click=()=>{download={href:node.href,name:node.download};};return node;};
 vm.runInContext(document.querySelector('script').textContent,vm.createContext({document,window:{location:{href:origin+'/library-coverage?room=PRIVATE-ROOM'}},URL:DownloadURL,URLSearchParams,Blob,setTimeout:callback=>timers.push(callback),fetch:async()=>Response.json(response)}));
 document.getElementById('coverage-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.match(document.querySelector('tbody td:last-child').textContent,/Herald, The: Web Edition Articles.*unverified/);assert.equal(document.getElementById('coverage-export').hidden,false);
 const exported=document.getElementById('coverage-json').value,value=JSON.parse(exported);assert.equal(value.fullTextVerified,false);assert.equal(value.articleAccepted,false);assert.equal(value.results[0].publication,'');assert.equal(value.results[0].publicationEvidence.labels[0].label,label);assert.doesNotMatch(exported,/PRIVATE|session|account|snippet|body|room=/i);
 document.getElementById('coverage-save').dispatchEvent(new window.Event('click'));assert.deepEqual(download,{href:'blob:synthetic',name:'reading-room-library-metadata.json'});assert.equal(await createdBlob.text(),exported);assert.match(document.getElementById('coverage-save-status').textContent,/Download requested/);for(const callback of timers)callback();
});

test('failure diagnostics expose only fixed stage/status enums and no provider payload',async()=>{
 const raw={status:'needs_interaction',stage:'form',reasonCode:'form_missing',session:'PRIVATE',body:'PRIVATE HTML'};
 assert.deepEqual(sanitizePublicationSearchStatus(raw),{status:'needs_interaction',stage:'form',reasonCode:'form_missing'});
 for(const bad of [{...raw,stage:'PRIVATE-URL'},{...raw,reasonCode:'PRIVATE response text'},{...raw,status:'login_required'}])assert.equal(sanitizePublicationSearchStatus(bad),null);
 const pathState={status:'needs_interaction',stage:'route',reasonCode:'route_changed',observedPath:'/apps/news/advanced-search'};
 assert.deepEqual(sanitizePublicationSearchStatus({...pathState,session:'PRIVATE',body:'PRIVATE'}),pathState);
 for(const observedPath of ['/apps/news/advanced-search?card=PRIVATE','/apps/news/advanced-search#session','https://infoweb.newsbank.com/apps/news/search','/library-card','/apps/news/UPPER','/apps/news/'+('a'.repeat(41))])assert.equal(sanitizePublicationSearchStatus({...pathState,observedPath}),null);
 const missing=provider('<div>Different results markup</div>'),client=createNewsBankHTTPClient({fetch:missing.fetch});client.restoreSession(session);
 assert.deepEqual(await client.searchPublications(query),{status:'needs_interaction',stage:'results',reasonCode:'results_changed'});
 const formClient=createNewsBankHTTPClient({fetch:async()=>html('<h1>Ordinary entry without a search form</h1>')});formClient.restoreSession(session);
 assert.deepEqual(await formClient.searchPublications(query),{status:'needs_interaction',stage:'form',reasonCode:'form_missing'});
});

test('rejected same-host metadata paths are observed without fetching destinations or exposing query values',async()=>{
 for(const asForm of [false,true]){
  let calls=0;const fetcher=async()=>{calls++;return asForm?html(searchForm.replace('/apps/news/search','/apps/news/advanced-search?session=PRIVATE')):html('',302,{location:'/apps/news/advanced-search?session=PRIVATE&card=PRIVATE'});};
  const result=await handler({action:'search-publications',...query,session},{fetch:fetcher});
  assert.equal(result.observedPath,'/apps/news/advanced-search');assert.equal(result.reasonCode,asForm?'destination_changed':'route_changed');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|\?|card=|session=/);
 }
 const DB=database();await savedAccount(DB);let calls=0;
 const response=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),async()=>{calls++;return html('',302,{location:'/apps/news/advanced-search?token=PRIVATE'});});
 assert.equal((await response.json()).observedPath,'/apps/news/advanced-search');assert.equal(calls,1);
});

test('owner metadata action refreshes its existing account after the observed InfoWeb login redirect',async()=>{
 const DB=database();await savedAccount(DB);
 const before=DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted;let posts=0,searches=0;
 const fetcher=async(raw,init)=>{const url=new URL(raw);assert(['arthur.newsbank.com','infoweb.newsbank.com'].includes(url.hostname));
  if(url.pathname==='/apps/news/browse-multi')return init.headers.get('cookie')==='nb=refreshed'?html(searchForm):html('',302,{location:'https://arthur.newsbank.com/'});
  if(url.hostname==='arthur.newsbank.com'&&url.pathname==='/')return html('<a href="/library-card?d=collection">Log in with library credentials</a>');
  if(url.pathname==='/library-card')return html('<form action="/login-libcard" method="POST"><input name="library"><input name="card"><input type="hidden" name="d" value="collection"></form>');
  if(url.pathname==='/login-libcard'){posts++;assert.equal(init.body.get('card'),'PRIVATE-CARD');return html('',302,{location:'https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB','set-cookie':'nb=refreshed; Domain=.newsbank.com; Path=/; Secure'});}
  if(url.pathname==='/apps/news/')return posts?html(searchForm):html('',302,{location:'/apps/news/user/login?destination=easy-search%3Fp%3DUKNB'});
  if(url.pathname==='/apps/news/search'){searches++;return html(resultPage);}
  throw Error('Unexpected route');
 };
 const response=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),fetcher);
 assert.equal(response.status,200);assert.equal((await response.json()).status,'metadata');assert.equal(posts,1);assert.equal(searches,1);assert.notEqual(DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,before);
 const guards=DB.sql.prepare('SELECT key,n FROM education_counters').all();assert.equal(guards.find(row=>row.key.startsWith('library-login:')).n,1);assert.equal(guards.find(row=>row.key.startsWith('library-publication-metadata:')).n,1);
});

test('metadata challenges never trigger account login or overwrite the encrypted connection',async()=>{
 const DB=database();await savedAccount(DB);const before=DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted;let calls=0;
 const response=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),async(_url,init)=>{calls++;assert.equal(init.method,'GET');return html('<html><body><h1>Verify you are human</h1></body></html>');});
 const data=await response.json();assert.equal(data.status,'needs_interaction');assert.equal(data.stage,'entry');assert.equal(data.reasonCode,'entry_needs_interaction');assert.equal(calls,1);assert.equal(DB.sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,before);assert.equal(DB.sql.prepare("SELECT COUNT(*) AS n FROM education_counters WHERE key LIKE 'library-login:%'").get().n,0);
});

test('metadata refresh cannot exceed the existing ten-login daily guard',async()=>{
 const DB=database();await savedAccount(DB,{...session,cookies:session.cookies.map(cookie=>({...cookie,expires:Date.now()-1000}))});
 DB.sql.prepare('INSERT INTO education_counters(key,n) VALUES(?,10)').run('library-login:camden:'+room+':'+new Date().toISOString().slice(0,10));let calls=0;
 const response=await librarySettingsAPI(request({action:'search-publications',...query}),config(DB),async()=>{calls++;throw Error('Login quota must stop the network');});
 assert.equal(response.status,429);assert.equal((await response.json()).reasonCode,'session_expired');assert.equal(calls,0);
});

test('owner UI renders the bounded failure stage/code without returning source data',async()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8'),{document,window}=parseHTML(html);
 Object.defineProperty(document.getElementById('publication'),'value',{value:'observer'});document.getElementById('headline').value=title;
 vm.runInContext(document.querySelector('script').textContent,vm.createContext({document,window:{location:{href:origin+'/library-coverage'}},URL,URLSearchParams,fetch:async()=>Response.json({status:'needs_interaction',stage:'route',reasonCode:'route_changed',observedPath:'/apps/news/advanced-search',reason:'The search route changed.'})}));
 document.getElementById('coverage-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.match(document.getElementById('coverage-status').textContent,/Stage: route.*Code: route_changed.*Observed path: \/apps\/news\/advanced-search/);
});

test('publication evidence preserves known Observer title/date/link without inferring its missing source label',()=>{
 const knownTitle='Children’s commissioner declares ‘state of emergency’ on young people’s lives';
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/1AB540A9361A0190">${knownTitle}</a></h3><ul><li>October 18, 2026</li></ul><p>PRIVATE SOURCE SNIPPET</p></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'observer',title:knownTitle},normalizeNewsBankDate);
 assert.equal(result.results[0].publication,'');assert.equal(result.results[0].date,'2026-10-18');assert.match(result.results[0].libraryURL,/1AB540A9361A0190/);assert.deepEqual(result.results[0].publicationEvidence,{basis:'visible-result-metadata-only',namedFieldCount:0,listItemCount:1,labelledItemCount:0,labels:[],metadataItems:[{context:'unverified-metadata-item',label:'October 18, 2026'}]});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SNIPPET/);assert.equal(result.fullTextVerified,false);
});

test('dedicated publication diagnostics retain literal labels without adding aliases or copying unlabelled metadata',()=>{
 // Synthetic field spelling demonstrates evidence handling; it is not a claim
 // about the live Observer record's still-unknown publication markup.
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><span class="search-hits__source">Observer, The (London, England)</span><ul><li>October 18, 2026</li><li>PRIVATE UNLABELLED CONTENT</li><li>Source: Example Daily (Sample City)</li></ul><p>PRIVATE ARTICLE SNIPPET</p><span class="search-hits__publication" hidden>PRIVATE HIDDEN SOURCE</span></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,query,normalizeNewsBankDate),row=result.results[0];
 assert.equal(row.publication,'');assert.equal(publicationLabel('Observer, The (London, England)'),'');assert.deepEqual(row.publicationEvidence.labels,[{context:'source-class',label:'Observer, The (London, England)'},{context:'labelled-source',label:'Example Daily (Sample City)'}]);assert.equal(row.publicationEvidence.namedFieldCount,1);assert.equal(row.publicationEvidence.listItemCount,3);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|UNLABELLED|SNIPPET|HIDDEN/);
 const base=metadata();for(const publicationEvidence of [{...row.publicationEvidence,session:'PRIVATE'},{...row.publicationEvidence,labels:[{context:'arbitrary-html',label:'Example Daily'}]},{...row.publicationEvidence,labels:[{context:'source-class',label:'https://secret.example'}]},{...row.publicationEvidence,labels:[{context:'source-class',label:'PRIVATE CARD123'}]}])assert.equal(sanitizePublicationSearch({...base,results:[{...base.results[0],publicationEvidence}]}),null);
});

test('unlabelled diagnostic candidates need a known literal publication prefix and never become publication proof',()=>{
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul><li>October 18, 2026</li><li>Observer, The (London, England)</li><li>Unrelated literal label</li><li>Observer, The (London, England) PRIVATE CARD</li><li>Observer 123</li><li>Observer https://example.org</li></ul></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'observer',title},normalizeNewsBankDate),row=result.results[0];
 assert.equal(row.publication,'');assert.deepEqual(result.publications,[]);assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.deepEqual(row.publicationEvidence.labels,[{context:'unlabelled-publication-candidate',label:'Observer, The (London, England)'}]);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|CARD|example\.org/);assert.deepEqual(row.publicationEvidence.metadataFields,[{context:'unlabelled-metadata-field',label:'Observer, The (London, England)'},{context:'unlabelled-metadata-field',label:'Unrelated literal label'}]);
 const invalid={...metadata(),results:[{...metadata().results[0],publicationEvidence:{...row.publicationEvidence,labels:[{context:'unlabelled-publication-candidate',label:'Unregistered Publisher'}]}}]};assert.equal(sanitizePublicationSearch(invalid),null);
});

test('registered canonical or article-reversed publication candidates remain literal and unverified',()=>{
 for(const [publication,name] of Object.entries(PUBLICATION_SEARCH_KEYS)){
  const canonical=name.split(' / ')[0].split(' (')[0],label=(canonical.startsWith('The ')?canonical.slice(4)+', The':canonical)+': Web Edition Articles (Sample City)';
  const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul><li>${label}</li><li>October 18, 2026</li></ul></div>`),hit=document.querySelector('.search-hits__hit');
  const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication,title},normalizeNewsBankDate),row=result.results[0];
  assert.deepEqual(publicationEvidence(hit).labels,[{context:'unlabelled-publication-candidate',label}],publication);assert.equal(row.publication,'');assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.equal(sanitizePublicationSearch(result).results[0].publicationEvidence.labels[0].label,label);
 }
});

test('publication diagnostics use visible attribute metadata and omit hidden fields and false prefix matches',()=>{
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><span data-publication="Herald, The (Glasgow, Scotland)"></span><span class="search-hits__publication" hidden>The New York Times</span><ul><li hidden>October 17, 2026</li><li>October 18, 2026</li><li>Heraldry Society</li><li>Herald, The PRIVATE TOKEN</li></ul></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,query,normalizeNewsBankDate),row=result.results[0];assert.equal(row.date,'2026-10-18');assert.equal(row.publication,'');assert.deepEqual(row.publicationEvidence.labels,[{context:'data-publication',label:'Herald, The (Glasgow, Scotland)'}]);assert.doesNotMatch(JSON.stringify(result),/New York|PRIVATE|TOKEN/);assert.deepEqual(row.publicationEvidence.metadataFields,[{context:'unlabelled-metadata-field',label:'Heraldry Society'}]);
});

test('the registered Express family prefix reveals an unverified literal candidate without adding a source alias',()=>{
 const label='Express: Web Edition Articles (Sample City)',{document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul><li>${label}</li><li>October 18, 2026</li></ul></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'express',title},normalizeNewsBankDate);assert.equal(publicationLabel(label),'');assert.equal(result.results[0].publication,'');assert.deepEqual(result.publications,[]);assert.deepEqual(result.results[0].publicationEvidence.labels,[{context:'unlabelled-publication-candidate',label}]);assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);
});

test('unlabelled literal metadata fields expose at most four visible field strings without certifying their publication',()=>{
 const values=['Sample Reporter','Daily Edition (Sample City)','A Public Bibliographic Label','Regional News Service','Fifth Literal Field'];
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul>${values.map(value=>'<li>'+value+'</li>').join('')}<li>October 18, 2026</li><li>PRIVATE ACCOUNT</li><li>Source https://example.org</li><li><p>Paragraph content excluded</p></li><li><form>Form content excluded</form></li><li hidden>Hidden field excluded</li><li style="display:none">Other hidden field</li></ul><p>ARTICLE PROSE EXCLUDED</p></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'express',title},normalizeNewsBankDate),row=result.results[0];assert.deepEqual(row.publicationEvidence.metadataFields,values.slice(0,4).map(label=>({context:'unlabelled-metadata-field',label})));assert.deepEqual(row.publicationEvidence.labels,[]);assert.equal(row.publication,'');assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.doesNotMatch(JSON.stringify(result),/Fifth|PRIVATE|ACCOUNT|example\.org|Paragraph|Form content|Hidden|hidden|ARTICLE PROSE/);
 const invalid={...metadata(),results:[{...metadata().results[0],publicationEvidence:{...row.publicationEvidence,metadataFields:[{context:'unlabelled-metadata-field',label:'PRIVATE TOKEN'}]}}]};assert.equal(sanitizePublicationSearch(invalid),null);
});

test('unverified metadataItems retain visible date, word count, public byline and qualified punctuation without matching a publication',()=>{
 const values=['October 18, 2026','482 Words','JJ Anisiobi','Express: Web Edition Articles | London / England (Online)'];
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul>${values.map(value=>'<li>'+value+'</li>').join('')}<li>Fifth field</li></ul></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'express',title},normalizeNewsBankDate),e=result.results[0].publicationEvidence;assert.deepEqual(e.metadataItems,values.map(label=>({context:'unverified-metadata-item',label})));assert.equal(result.results[0].publication,'');assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.deepEqual(result.publications,[]);assert.equal(sanitizePublicationSearch(result).results[0].publicationEvidence.metadataItems[3].label,values[3]);
});

test('unverified metadataItems exclude paragraphs, controls, hidden descendants and sensitive bibliography payloads',()=>{
 const forbidden=['12345678','Source https://example.org','name@example.org','Account reader','Card 12345','Borrower CAM12345','Cookie abc','TOKEN short','PIN 1234','Password short','Private label'];
 const {document}=parseHTML(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><ul>${forbidden.map(value=>'<li>'+value+'</li>').join('')}<li><p>Paragraph prose</p></li><li><form>Form prose</form></li><li><input value="Control secret">Input text</li><li><select><option>Option text</option></select></li><li hidden>Hidden item</li><li>Public Reporter<span hidden>PRIVATE HIDDEN PAYLOAD</span></li></ul></div>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,query,normalizeNewsBankDate);assert.deepEqual(result.results[0].publicationEvidence.metadataItems,[{context:'unverified-metadata-item',label:'Public Reporter'}]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE HIDDEN|12345678|CAM12345|Paragraph prose|Form prose|Input text|Option text|Hidden item|example\.org/);
 const base=metadata(),e={basis:'visible-result-metadata-only',namedFieldCount:0,listItemCount:1,labelledItemCount:0,labels:[],metadataItems:[{context:'unverified-metadata-item',label:'October 18, 2026'}]};
 for(const metadataItems of [[{context:'unverified-metadata-item',label:'12345678'}],[{context:'unverified-metadata-item',label:'Public Reporter',body:'PRIVATE'}],[{context:'source-class',label:'Public Reporter'}],Array(5).fill(e.metadataItems[0])])assert.equal(sanitizePublicationSearch({...base,results:[{...base.results[0],publicationEvidence:{...e,metadataItems}}]}),null);
});


test('article search-hit wrappers retain only hit-scoped visible UL bibliography, excluding nested body, article and forms',()=>{
 const values=['October 18, 2026','482 Words','JJ Anisiobi','Express: Web Edition Articles | London / England (Online)'];
 const {document}=parseHTML(`<article class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">${title}</a></h3><div class="document-view__body--ascii"><ul><li>Body reporting excluded</li></ul></div><article><ul><li>Nested reporting excluded</li></ul></article><form><ul><li>Form label excluded</li></ul></form><ul>${values.map(value=>'<li>'+value+'</li>').join('')}<li><p>Paragraph reporting excluded</p></li><li><input value="PRIVATE_CONTROL">Control label excluded</li></ul></article>`);
 const result=publicationSearchPage(document,TELEGRAPH_ENTRY,{publication:'express',title},normalizeNewsBankDate),e=result.results[0].publicationEvidence;
 assert.deepEqual(e.metadataItems,values.map(label=>({context:'unverified-metadata-item',label})));
 assert.equal(result.results[0].publication,'');assert.deepEqual(result.publications,[]);assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);
 assert.doesNotMatch(JSON.stringify(e),/reporting|Form label|Control label|PRIVATE/);
 for(const wrapper of ['form','div class="document-view__body--ascii"']){
  const close=wrapper.startsWith('div')?'div':wrapper;
  const {document:excluded}=parseHTML(`<${wrapper}><article class="search-hits__hit"><ul><li>Public Reporter</li></ul></article></${close}>`);
  assert.equal(publicationEvidence(excluded.querySelector('article')).metadataItems,undefined);
 }
});
