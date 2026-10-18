import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient,normalizeNewsBankDate} from './newsbank-http.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {handler} from '../server-library/handler.mjs';
import {OBSERVER_PUBLICATION_LABEL as label,HERALD_PUBLICATION_LABEL,NATIONAL_PUBLICATION_LABEL,proveLibraryPublication} from './library-publications.mjs';
import {librarySearchTerms} from './newsbank-library-search.mjs';
import {libraryRecordRequest,validateLibraryRecordArticle} from './library-record-contract.mjs';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';
const query={publisher:'observer',query:'archive funding'},title='Fictional archive volunteers discuss regional funding plans';
const libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABC123';
const selected={publisher:'observer',libraryURL,title,date:'2026-10-18',publication:label};
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const form='<form action="/apps/news/results?p=UKNB" method="GET"><input name="query" id="edit-val-base-0"><select name="fld-base-0"><option value="TI">Headline</option></select><input name="p" value="UKNB"><input name="native-token" value="PRIVATE-FORM"></form>';
const hit=(publication=label,headline=title,date='October 18, 2026',ref='ABC123',extra='')=>'<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/'+ref+'">'+headline+'</a></h3><ul><li>'+date+'</li><li>Synthetic Reporter</li><li>'+publication+'</li>'+extra+'</ul><p>PRIVATE-SNIPPET</p></div>';
const paragraphs=Array.from({length:3},(_,i)=>'Synthetic record paragraph '+i+'. '+'This fictional meeting discussed the archive with local residents and asked questions about future funding. '.repeat(3));
const article=(publication=label,headline=title,date='October 18, 2026')=>'<div id="document-view--ascii"><h1>'+headline+'</h1><div class="document-view__meta"><span>'+date+' | </span><span>'+publication+'</span><span> Author/Byline: Synthetic Reporter 1000 Words</span></div><div class="document-view__body--ascii">'+paragraphs.map(p=>'<p>'+p+'</p>').join('')+'</div></div>';
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'Content-Type':'text/html',...headers}});
function fixture(results=hit(),body=article()){
 const calls=[];const fetcher=async(raw,options={})=>{calls.push(raw);const url=new URL(raw);assert.equal(url.origin,'https://infoweb.newsbank.com');assert.equal(options.redirect,'manual');if(url.pathname==='/apps/news/')return html(form);if(url.pathname==='/apps/news/results'){assert.equal(url.searchParams.get('query'),'"archive" AND "funding"');assert.equal(url.searchParams.get('fld-base-0'),'TI');assert.equal(url.searchParams.getAll('p').length,1);return html(results);}if(url.pathname==='/apps/news/document-view')return html(body);throw Error('Unexpected synthetic request');};
 const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {client,fetcher,calls};
}
const aws={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-test-secret-only-not-real-12345'};

test('two-word topics use literal quoted words and strict metadata search never opens documents or Next',async()=>{
 assert.equal(librarySearchTerms({...query,query:'archive OR funding'}),'"archive" AND "OR" AND "funding"');
 const f=fixture(hit()+'<a rel="next" href="/apps/news/results?page=2">Next</a>'),result=await f.client.searchLibrary(query);
 assert.equal(result.status,'library-search');assert.equal(result.pageCount,1);assert.equal(result.truncated,true);assert.deepEqual(result.results,[{title,date:'2026-10-18',publication:label,libraryURL}]);assert.equal(f.calls.length,2);
 assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|paragraphs|snippet|cookies/);
});

test('only dated visible exact-publication results survive; conflicting metadata and ambiguous duplicate records are excluded',async()=>{
 const f=fixture(hit()+hit('The Guardian',title,undefined,'DEF456')+hit(label,title,'No date','EEE999')+hit('<span hidden>'+label+'</span>',title,undefined,'AAA111')+hit(label,title,undefined,'BBB222','<li>Source: The Guardian</li>')+hit(label,title,undefined,'CCC333')+hit(label,'Different synthetic record headline',undefined,'CCC333'));
 const result=await f.client.searchLibrary(query);assert.deepEqual(result.results,[{title,date:'2026-10-18',publication:label,libraryURL}]);assert.equal(f.calls.length,2);
});

test('search is bounded to twenty inspected rows and supports only registered publication policies',async()=>{
 for(const [publisher,publication] of [['times','The Times (London, England)'],['telegraph','The Daily Telegraph (London, UK)'],['observer',label]]){
  const f=fixture(Array.from({length:24},(_,i)=>hit(publication,title,undefined,(i+1).toString(16).toUpperCase())).join(''));
  const result=await f.client.searchLibrary({...query,publisher});assert.equal(result.results.length,20);assert.equal(result.inspectedCount,20);assert.equal(result.truncated,true);assert(result.results.every(row=>proveLibraryPublication(row.publication,publisher)));
 }
 let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;throw Error('No network');}});
 assert.equal((await client.searchLibrary(query)).status,'login_required');
 for(const bad of [{...query,publisher:'guardian'},{...query,query:'one'},{...query,query:'two words https://example.org'},{...query,url:libraryURL}])await assert.rejects(client.searchLibrary(bad),/invalid_library_search/);
 assert.equal(calls,0);
});

test('metadata challenges, login redirects and document/path destinations stop before their target is fetched',async()=>{
 for(const [result,status,reasonCode] of [[html('<html><body><h1>Verify you are human</h1></body></html>'),'needs_interaction','entry_needs_interaction'],[html('',302,{location:'/apps/news/user/login?session=PRIVATE'}),'login_required','session_expired'],[html('',302,{location:libraryURL}),'needs_interaction','route_changed'],[html(form.replace('/apps/news/results?p=UKNB','/apps/news/document-view?p=UKNB&amp;docref=news/ABC123')),'needs_interaction','destination_changed']]){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return result.clone();}});client.restoreSession(session);const out=await client.searchLibrary(query);assert.equal(out.status,status);assert.equal(out.reasonCode,reasonCode);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|ABC123/);
 }
});

test('selected record requires canonical server-held metadata before any request and independently verifies source title/date/publication',async()=>{
 const f=fixture(),result=await f.client.fetchLibraryRecord(selected);assert.equal(result.status,'found');assert.deepEqual(f.calls,[libraryURL]);assert.deepEqual(result.article.paragraphs,paragraphs.map(p=>p.trim()));
 for(const body of [article('The Guardian'),article(label,'A different fictional archive headline'),article(label,title,'October 19, 2026')]){const denied=fixture(hit(),body),out=await denied.client.fetchLibraryRecord(selected);assert.deepEqual(out,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(denied.calls.length,1);}
 let calls=0;const blocked=createNewsBankHTTPClient({fetch:async()=>{calls++;throw Error('No network');}});blocked.restoreSession(session);
 for(const bad of [{...selected,libraryURL:libraryURL+'&session=private'},{...selected,publication:'The Guardian'},{...selected,date:'2026-02-30'},{...selected,libraryURL:'https://attacker.example/document'},{...selected,originalURL:'https://observer.co.uk/guessed'}])await assert.rejects(blocked.fetchLibraryRecord(bad),/invalid_library_record/);
 assert.equal(calls,0);
});

test('selected-record redirects cannot fetch a different document, path, collection, extra query or login page',async()=>{
 for(const location of [libraryURL.replace('ABC123','DEF456'),'/apps/news/results?p=UKNB',libraryURL.replace('p=UKNB','p=OTHER'),libraryURL+'&action=changed','/apps/news/user/login?session=PRIVATE']){
  let calls=0;const client=createNewsBankHTTPClient({fetch:async()=>{calls++;return html('',302,{location});}});client.restoreSession(session);const result=await client.fetchLibraryRecord(selected);assert.equal(result.status,location.includes('/user/login')?'login_required':'not_found');assert.equal(calls,1);
 }
});

test('signed metadata and selected-record actions never accept credentials, article bodies or arbitrary actions',async()=>{
 let calls=0;const noFetch={fetch:async()=>{calls++;throw Error('No network');}};
 assert.equal((await handler({action:'library-search',...query},noFetch)).status,'login_required');
 assert.equal((await handler({action:'library-record',...selected},noFetch)).status,'login_required');
 for(const action of ['library-search','library-record']){const input=action==='library-search'?query:selected;assert.equal((await handler({action,...input,session,cardNumber:'PRIVATE-CARD'},noFetch)).status,'error');}
 assert.equal(calls,0);
 const f=fixture(),remote=runtimeLibraryClient(aws,async(_raw,options)=>{const event=JSON.parse(options.body);assert.equal(Object.hasOwn(event,'cardNumber'),false);assert.equal(Object.hasOwn(event,'libraryName'),false);return Response.json(await handler(event,{fetch:f.fetcher}));});remote.restoreSession(session);
 assert.equal((await remote.searchLibrary(query)).status,'library-search');const found=await remote.fetchLibraryRecord(selected);assert.equal(found.status,'found');assert.deepEqual(found.article.paragraphs,paragraphs.map(p=>p.trim()));assert.equal(remote.serializeSession().schema,'newsbank-http-session/v1');
});

test('signed search rejects mismatched request identities and source prose; record output is revalidated after transport',async()=>{
 const f=fixture(),base=await f.client.searchLibrary(query);
 for(const value of [{...base,requested:{...query,query:'different topic'}},{...base,body:'PRIVATE'},{...base,results:[{...base.results[0],snippet:'PRIVATE'}]}])await assert.rejects(runtimeLibraryClient(aws,async()=>Response.json(value)).searchLibrary(query),/metadata response was invalid/);
 const found=await f.client.fetchLibraryRecord(selected);for(const article of [{...found.article,title:'Changed title'},{...found.article,libraryURL:libraryURL.replace('ABC123','DEF456')},{...found.article,publication:'The Guardian'}])await assert.rejects(runtimeLibraryClient(aws,async()=>Response.json({status:'found',article})).fetchLibraryRecord(selected),/could not be verified/);
});

test('library record capture preserves all paragraphs, exact actual source and provenance without guessing a publisher link or media',async()=>{
 const result=await fixture().client.fetchLibraryRecord(selected),capture=buildLibraryRecordCapture({selected,article:result.article}),normalized=normalizeCapture(capture,{validatedLibraryRecordURL:selected.libraryURL});
 assert.equal(capture.url,libraryURL);assert.deepEqual(capture.blocks.map(block=>block.text),paragraphs.map(p=>p.trim()));assert(capture.blocks.every(block=>block.type==='paragraph'));assert.deepEqual(capture.fonts,[]);assert.equal(normalized.diagnostics.libraryRecordEdition,true);assert.equal(normalized.diagnostics.libraryTextEdition,true);assert.equal(normalized.diagnostics.libraryURL,libraryURL);assert.equal(normalized.publisher,'The Observer · Camden NewsBank text edition');assert.doesNotMatch(JSON.stringify(capture),/originalURL|observer\.co\.uk/);
 assert.throws(()=>buildLibraryRecordCapture({selected:{...selected,date:'2026-10-19'},article:result.article}),/could not be verified/);
 assert.equal(libraryRecordRequest(selected).libraryURL,libraryURL);assert.equal(validateLibraryRecordArticle(result.article,selected,normalizeNewsBankDate).libraryURL,libraryURL);
});

test('observed Herald and National labels require independent exact document proof and remain unavailable to automatic URL lookup',async()=>{
 for(const [publisher,publication] of [['herald',HERALD_PUBLICATION_LABEL],['national',NATIONAL_PUBLICATION_LABEL]]){
  const f=fixture(hit(publication),article(publication)),metadata=await f.client.searchLibrary({...query,publisher});assert.equal(metadata.results.length,1);assert.equal(metadata.results[0].publication,publication);
  const choice={publisher,...metadata.results[0]},result=await f.client.fetchLibraryRecord(choice);assert.equal(result.status,'found');assert.equal(result.article.publication,publication);
  const wrong=fixture(hit(publication),article(label));assert.deepEqual(await wrong.client.fetchLibraryRecord(choice),{status:'not_found',reasonCode:'record_mismatch'});
  const conflicting=fixture(hit(publication),article(publication).replace('</span><span> Author/Byline:','</span><span>'+label+'</span><span> Author/Byline:'));assert.deepEqual(await conflicting.client.fetchLibraryRecord(choice),{status:'not_found',reasonCode:'record_mismatch'});
  const conflictedResult=fixture(hit(publication,title,undefined,'ABC123','<li>'+label+'</li>'));assert.deepEqual((await conflictedResult.client.searchLibrary({...query,publisher})).results,[]);
  const hidden=fixture(hit(publication),article('<span hidden>'+publication+'</span>'));assert.deepEqual(await hidden.client.fetchLibraryRecord(choice),{status:'not_found',reasonCode:'record_mismatch'});
  const noLookup=fixture();await assert.rejects(noLookup.client.lookup({publisher,title}),/selected library records only/);assert.equal(noLookup.calls.length,0);
 }
});
