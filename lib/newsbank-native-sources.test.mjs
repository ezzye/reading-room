import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {nativeSourceURL,inspectNativeSourcePage,sanitizeNativeSources,NATIVE_SOURCE_QUERY} from './newsbank-native-sources.mjs';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {handler} from '../server-library/handler.mjs';
const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const form='<form method="GET" action="/apps/news/results?p=UKNB"><input id="edit-val-base-0" name="val-base-0"><input type="hidden" name="fld-base-0" value="AllText"><input name="p" value="UKNB"><input name="session" value="PRIVATE-SESSION"><input name="cardNumber" value="PRIVATE-CARD"><input name="form_build_id" value="PRIVATE-BUILD"><select name="source"><option value="SRC1">Financial Times</option><option value="PRIVATE-COOKIE">PRIVATE secret field</option></select><select name="sort"><option value="date">Newest</option></select></form>';
const navigation='<a href="/apps/news/source-list?p=UKNB">Source List</a><a href="#sources">Sources</a><a href="/apps/news/browse-pub?p=UKNB&amp;t=pubname:ABCDEF!Financial%20Times">Financial Times</a>';
const results='<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF">PRIVATE ARTICLE HEADLINE</a></h3><ul><li class="search-hits__source"><a href="/apps/news/browse-pub?p=UKNB&amp;t=pubname:AB12!Financial%20Times">Financial Times</a></li></ul><p>PRIVATE SOURCE PROSE</p></div><a rel="next" href="/apps/news/results?p=UKNB&amp;page=2">Next</a>'+navigation;
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'Content-Type':'text/html',...headers}});
function fixture(content=results){const calls=[];const fetcher=async(raw,options)=>{calls.push(raw);assert.equal(options.redirect,'manual');const url=new URL(raw);if(url.pathname==='/apps/news/')return html(navigation+form);assert.equal(url.pathname,'/apps/news/results');assert.equal(url.searchParams.get('val-base-0'),'"Jason" AND "Arday"');assert.equal(url.searchParams.get('fld-base-0'),'AllText');assert.equal(url.searchParams.getAll('p').length,1);return html(content);};const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {client,calls,fetcher};}
const aws={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-test-secret-only-not-real-12345'};

test('native source inspection reads only ENTRY and one fixed topic result while preserving actual native controls',async()=>{
 const f=fixture(),result=await f.client.inspectNativeSources();assert.equal(result.status,'native-sources');assert.equal(result.fixedQuery,NATIVE_SOURCE_QUERY);assert.equal(f.calls.length,2);assert.deepEqual(result.pages.map(page=>page.stage),['entry','results']);assert(result.pages[0].links.some(link=>link.path==='/apps/news/source-list'));assert(result.pages[1].links.some(link=>link.context==='source-field'&&link.label==='Financial Times'));assert.equal(result.articleOpened,false);assert.equal(result.followedSourceLinks,false);
 const controls=result.pages[0].forms[0].controls;assert(controls.some(control=>control.name==='fld-base-0'&&control.visibility==='hidden'));assert(controls.some(control=>control.options.some(option=>option.label==='Newest')));assert(controls.some(control=>control.options.some(option=>option.label==='Financial Times')));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|AllText|COOKIE|cardNumber|session|form_build_id|article headline|source prose/i);assert(f.calls.every(url=>!url.includes('document-view')&&!url.includes('browse-pub')&&!url.includes('source-list')&&!url.includes('page=2')));
});

test('safe native URLs retain observed source paths and public keys while denying accounts, documents, credentials and secret values',()=>{
 assert.equal(nativeSourceURL('/apps/news/results?p=UKNB',entry),'https://infoweb.newsbank.com/apps/news/results?p=UKNB');assert(nativeSourceURL('#sources',entry));
 for(const raw of ['https://attacker.example/apps/news/source-list?p=UKNB','https://user:pass@infoweb.newsbank.com/apps/news/source-list?p=UKNB','/apps/news/document-view?p=UKNB&docref=news/ABCDEF','/apps/news/user/login?p=UKNB','/apps/news/source-list?p=OTHER','/apps/news/source-list?P=UKNB','/apps/news/source-list?p=UKNB&session=PRIVATE','/apps/news/source-list?p=UKNB&api_key=short-secret','/apps/news/source-list?p=UKNB&signature=short-secret','/apps/news/source-list?p=UKNB&card=123456789123','/apps/news/source-list?p=UKNB&t='+ 'x'.repeat(32),'/apps/news/source-list?p=UKNB&t=a%40private.example','#session-private'])assert.equal(nativeSourceURL(raw,entry),'');
});

test('extraction omits hidden links, article prose, unsafe anchor destinations and form secret values',()=>{
 const {document}=parseHTML(navigation+'<a hidden href="/apps/news/source-list">Hidden sources</a><p><a href="/apps/news/source-list">Source List private prose</a></p><a href="/apps/news/source-list?token=PRIVATE">Sources</a>'+form);
 const page=inspectNativeSourcePage(document,entry,'entry'),safe=sanitizeNativeSources({status:'native-sources',schema:'newsbank-native-sources/v1',fixedQuery:NATIVE_SOURCE_QUERY,pages:[page],articleOpened:false,followedSourceLinks:false});assert(safe);assert.equal(safe.pages[0].links.length,3);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|hidden sources|private prose|cardNumber|form_build_id|session/i);
});

test('no session, invalid private actions, login routes and challenges stop with fixed stages before further requests',async()=>{
 let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;throw Error('No request');}});assert.deepEqual(await client.inspectNativeSources(),{status:'login_required',stage:'session',reasonCode:'session_expired'});assert.equal(calls,0);
 for(const [response,status,reasonCode] of [[html('',302,{location:'/apps/news/user/login?session=PRIVATE'}),'login_required','session_expired'],[html('<html><body><h1>Verify you are human</h1></body></html>'),'needs_interaction','entry_needs_interaction'],[html('',302,{location:'/apps/news/document-view?p=UKNB&docref=news/ABCDEF'}),'needs_interaction','route_changed']]){
  let count=0;const probe=createNewsBankHTTPClient({fetch:async()=>{count++;return response.clone();}});probe.restoreSession(session);const result=await probe.inspectNativeSources();assert.equal(result.status,status);assert.equal(result.reasonCode,reasonCode);assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|ABCDEF/);
 }
 const denied=await handler({action:'inspect-native-sources',session,query:'Other topic'},{fetch:async()=>{calls++;throw Error('No fetch');}});assert.equal(denied.code,'invalid_native_sources');assert.equal(calls,0);
});

test('signed native inspection carries only the existing session and reconstructs bounded metadata across handler and transport',async()=>{
 const f=fixture(),client=runtimeLibraryClient(aws,async(_url,options)=>{const input=JSON.parse(options.body);assert.deepEqual(Object.keys(input).sort(),['action','session']);assert.equal(input.action,'inspect-native-sources');return Response.json(await handler(input,{fetch:f.fetcher}));});client.restoreSession(session);const result=await client.inspectNativeSources();assert.equal(result.status,'native-sources');assert.equal(f.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|cookies|cardNumber|paragraphs|body|html/);
 const hostile={...result,session};await assert.rejects(runtimeLibraryClient(aws,async()=>Response.json(hostile)).inspectNativeSources(),/metadata response was invalid/);
});

test('81 reads only the actually observed exact A-ZSourceList before the one topic search and returns source-row coverage metadata',async()=>{
 const calls=[],listURL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
 const sourceList='<form action="/apps/news/source-list?p=UKNB"><table><thead><tr><th>Source</th><th>Format</th><th>Coverage</th></tr></thead><tbody><tr><td><a href="/apps/news/browse-pub?p=UKNB&amp;t=pubname:FT01!Financial%20Times">Financial Times (London, England)</a></td><td>Text</td><td>1990 - Current</td></tr><tr><td><a href="/apps/news/browse-pub?p=UKNB&amp;t=pubname:MS01!Morning%20Star">Morning Star (London, England)</a></td><td>Text</td><td>2000 - Current</td></tr></tbody></table></form>'+form;
 const client=createNewsBankHTTPClient({fetch:async(raw)=>{calls.push(raw);const url=new URL(raw);if(url.pathname==='/apps/news/')return html('<a href="/apps/news/source-list?p=UKNB">A-Z Source List</a>'+form);if(url.pathname==='/apps/news/source-list')return html(sourceList);assert.equal(url.pathname,'/apps/news/results');return html(results);}});client.restoreSession(session);
 const result=await client.inspectNativeSources();assert.deepEqual(calls.map(raw=>new URL(raw).pathname),['/apps/news/','/apps/news/source-list','/apps/news/results']);assert.equal(calls[1],listURL);assert.equal(result.sourceListOpened,true);assert.deepEqual(result.pages.map(page=>page.stage),['entry','source-list','results']);assert.deepEqual(result.pages[1].sourceRows[0],{label:'Financial Times (London, England)',url:'https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t=pubname:FT01!Financial%20Times',fields:[{name:'Source',value:'Financial Times (London, England)'},{name:'Format',value:'Text'},{name:'Coverage',value:'1990 - Current'}]});assert.equal(result.followedSourceLinks,false);assert.equal(result.articleOpened,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|paragraphs|article headline/i);
});

test('only the visible exact observed SourceList identity may be read; redirects to browse, documents or different query never fetch targets',async()=>{
 for(const href of ['/apps/news/source-list?p=OTHER','/apps/news/source-list?p=UKNB&folder=other','https://attacker.example/apps/news/source-list?p=UKNB']){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async(raw)=>{calls++;return html(new URL(raw).pathname==='/apps/news/'?'<a href="'+href+'">A-Z Source List</a>'+form:results);}});client.restoreSession(session);const result=await client.inspectNativeSources();assert.equal(result.sourceListOpened,false);assert.equal(calls,2);
 }
 for(const location of ['/apps/news/browse-pub?p=UKNB&t=pubname:FT01!Financial%20Times','/apps/news/document-view?p=UKNB&docref=news/ABCDEF','/apps/news/source-list?p=UKNB&session=PRIVATE']){
  const calls=[];const client=createNewsBankHTTPClient({fetch:async(raw)=>{calls.push(raw);return calls.length===1?html('<a href="/apps/news/source-list?p=UKNB">A-Z Source List</a>'+form):html('',302,{location});}});client.restoreSession(session);const result=await client.inspectNativeSources();assert.deepEqual(result,{status:'needs_interaction',stage:'source-list',reasonCode:'route_changed'});assert.equal(calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|ABCDEF|pubname/);
 }
});

test('paper source links outrank caps without saved-folder, terms, year, location or type facets',()=>{
 const facets=['year:2026!2026','stp:Newspaper!Newspaper','country:Scotland!Scotland'].flatMap((value,index)=>Array.from({length:12},()=>'<li><a href="/apps/news/results?p=UKNB&amp;t='+encodeURIComponent(value)+'">Facet '+index+'</a></li>')).join('');
 const saved='<ul><li><a href="/apps/news/my-folder?p=UKNB">My Saved Articles</a></li><li><a href="/apps/news/terms-of-use?p=UKNB">Terms of Use</a></li></ul>';
 const papers=Array.from({length:30},(_,index)=>'<li class="search-hits__source"><a href="/apps/news/results?p=UKNB&amp;t=pubname:P'+index+'!Local">Local Gazette '+index+'</a></li>').join('')+'<li><a href="/apps/news/results?p=UKNB&amp;t=pubname:TEL01!Telegraph">Daily Telegraph (London, England)</a></li>';
 const page=inspectNativeSourcePage(parseHTML(saved+'<ul>'+facets+papers+'</ul>').document,'https://infoweb.newsbank.com/apps/news/results?p=UKNB','results');assert.equal(page.links.length,24);assert.equal(page.links[0].label,'Daily Telegraph (London, England)');assert.doesNotMatch(JSON.stringify(page),/My Saved|Terms of Use|year%3A|stp%3A|country%3A/);
});
