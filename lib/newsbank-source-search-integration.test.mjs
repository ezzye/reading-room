import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {handler} from '../server-library/handler.mjs';

const sourceName='Scotsman, The/Scotland on Sunday (Scotland)';
const listURL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
const browseURL='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t=pubname%3ASCOTEST&action=browse';
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const aws={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-test-secret-only-not-real-12345'};
const columns=()=>['Source Name','Step','Dates','Location','Type','Format','Language'].map((title,index)=>({id:index===0?'label':index===1?'step':String(index),title,type:index===0?'link':'string',visible:Number(index!==1),searchable:Number(index!==1),sortable:Number(index!==1),...(index===0?{template:'/apps/news/browse-pub?p=UKNB&t=__1__&action=browse'}:{})}));
const row=(step='pubname:SCOTEST',format='Text',name=sourceName)=>[name,step,'1998 - Current','Scotland - Edinburgh','Newspaper',format,'English'];
const listing=(rows=[row()],cols=columns())=>'<div id="scotsman-source-test" class="nbcore-react-browse-container"></div><script>jQuery.extend(Drupal.settings,'+JSON.stringify({'nbcore_react_browse__scotsman-source-test':{config:{session:'PRIVATE-CONFIG'},cols,rows},account:'PRIVATE-ACCOUNT'}).replaceAll('<','\\u003c').replaceAll('>','\\u003e')+');</script>';
const sourceForm=(t='pubname:SCOTEST',extra='')=>'<h1>'+sourceName+'</h1><form method="GET" action="/apps/news/results?p=UKNB"><input id="edit-val-base-0" name="val-base-0" value="PRIVATE-QUERY"><select id="edit-fld-base-0" name="fld-base-0"><option value="AllText">All Text</option><option value="TI">Headline</option></select><input type="hidden" name="p" value="UKNB"><input type="hidden" name="t" value="'+t+'"><input type="hidden" name="action" value="browse"><input type="hidden" name="native-token" value="PRIVATE-NONCE"><input type="hidden" name="form_build_id" value="PRIVATE-BUILD"><input type="text" name="unexpected" value="PRIVATE-UNEXPECTED">'+extra+'</form><a rel="next" href="/apps/news/browse-pub?p=UKNB&amp;t=pubname:SCOTEST&amp;action=browse&amp;page=2">Next</a><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Document</a><article><p>PRIVATE ARTICLE PROSE must never become form evidence.</p></article>';
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'Content-Type':'text/html',...headers}});
function fixture({rows=[row()],cols=columns(),browse=sourceForm(),browseResponse=null,listResponse=null,expectedBrowseURL=browseURL}={}){
 const calls=[],fetcher=async(raw,options={})=>{calls.push({url:raw,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);assert.equal(new URL(raw).origin,'https://infoweb.newsbank.com');if(raw===listURL)return listResponse?listResponse.clone():html(listing(rows,cols));assert.equal(raw,expectedBrowseURL,'only the fresh computed exact browse identity may be fetched');return browseResponse?browseResponse.clone():html(browse);};
 const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {client,fetcher,calls};
}
function assertMetadata(result){assert.equal(result.status,'source-search-inspection');assert.equal(result.schema,'newsbank-source-search/v1');assert.equal(result.source.name,sourceName);assert.equal(result.source.format,'Text');assert.equal(result.source.browseURL,browseURL);assert.equal(result.page.path,'/apps/news/browse-pub');assert.equal(result.sourceListOpened,true);assert.equal(result.sourceBrowseOpened,true);assert.equal(result.articleOpened,false);assert.equal(result.searchSubmitted,false);assert.equal(result.followedNext,false);assert(new TextEncoder().encode(JSON.stringify(result)).byteLength<=12000);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|paragraphs|snippet|cookie|"rows"\s*:\s*\[|"config"|"template"|docref|ABC123/);}

test('fresh unique Scotsman text catalogue identity permits exactly one metadata-only source browse GET and no query submission',async()=>{
 const f=fixture({rows:[row('pubname:IMAGE','Image'),row()]}),result=await f.client.inspectSourceSearch();assertMetadata(result);assert.deepEqual(f.calls.map(call=>call.url),[listURL,browseURL]);assert(result.page.matchingSourceBindings>=1);assert.equal(result.page.conflictingSourceBindings,0);assert(Array.isArray(result.page.forms));assert(result.page.forms.length>=1);assert.match(JSON.stringify(result.page.forms),/Headline/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-QUERY|PRIVATE-NONCE|PRIVATE-BUILD|PRIVATE-UNEXPECTED/);
});

test('signed source-form inspection accepts only action and encrypted-session payload and revalidates fixed metadata after transport',async()=>{
 const f=fixture(),events=[],remote=runtimeLibraryClient(aws,async(_raw,options)=>{const event=JSON.parse(options.body);events.push(event);assert.deepEqual(Object.keys(event).sort(),['action','session']);assert.equal(event.action,'inspect-source-search');return Response.json(await handler(event,{fetch:f.fetcher}));});remote.restoreSession(session);const result=await remote.inspectSourceSearch();assertMetadata(result);assert.equal(events.length,1);assert.equal(f.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|cardNumber|libraryName/);
 for(const value of [{...result,body:'PRIVATE-BODY'},{...result,searchSubmitted:true},{...result,source:{...result.source,browseURL:'https://attacker.example/private'}}]){const forged=runtimeLibraryClient(aws,async()=>Response.json(value));forged.restoreSession(session);await assert.rejects(()=>forged.inspectSourceSearch());}
});

test('missing session and arbitrary client query, URL, source, publisher or credential inputs never start a source inspection',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('No network is permitted in this test.');},client=createNewsBankHTTPClient({fetch:fetcher});assert.equal((await client.inspectSourceSearch()).status,'login_required');assert.equal((await handler({action:'inspect-source-search'},{fetch:fetcher})).status,'login_required');
 for(const extra of [{query:'Jason Arday'},{url:browseURL},{source:'guardian'},{publisher:'scotsman'},{cardNumber:'PRIVATE-CARD'},{libraryName:'PRIVATE-LIBRARY'},{body:'PRIVATE-PROSE'}]){const result=await handler({action:'inspect-source-search',session,...extra},{fetch:fetcher});assert.equal(result.status,'error');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|Jason|guardian|browse-pub/);}assert.equal(calls,0);
});

test('ambiguous text rows, absent text or changed source-column identity never choose the first row or browse another source',async()=>{
 const changed=columns();changed[0].title='Publication';for(const options of [{rows:[row(),row('pubname:SCOTEST2')]},{rows:[row('pubname:IMAGE','Image')]},{rows:[row('pubname:OTHER','Text','The Scotsman')]},{cols:changed}]){const f=fixture(options),result=await f.client.inspectSourceSearch();assert.equal(result.status,'needs_interaction');assert.equal(f.calls.length,1);assert.equal(result.sourceBrowseOpened,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|pubname|SCOTEST2|IMAGE|OTHER/);}
});

test('browse redirects to a different source, collection, document or query stop before any redirected target is fetched',async()=>{
 for(const location of [browseURL,browseURL.replace('SCOTEST','OTHER'),browseURL.replace('p=UKNB','p=OTHER'),'/apps/news/document-view?p=UKNB&docref=news/ABC123',browseURL+'&page=2','/apps/news/results?p=UKNB']){const f=fixture({browseResponse:html('',302,{location})}),result=await f.client.inspectSourceSearch();assert.equal(result.status,'needs_interaction');assert.equal(f.calls.length,2);assert.equal(result.searchSubmitted,false);assert.equal(result.articleOpened,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|ABC123|OTHER|docref/);}
 const login=fixture({browseResponse:html('',302,{location:'/apps/news/user/login?session=PRIVATE'})}),result=await login.client.inspectSourceSearch();assert.equal(result.status,'login_required');assert.equal(login.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('conflicting source bindings remain diagnostics and do not export unexpected source values or unlock a search',async()=>{
 const f=fixture({browse:sourceForm('pubname:OTHER')}),result=await f.client.inspectSourceSearch();assertMetadata(result);assert(result.page.conflictingSourceBindings>=1);assert.equal(f.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/pubname:OTHER|pubname%3AOTHER/);
});

test('a redirected source list is not retried or replaced with a different metadata route',async()=>{
 for(const location of [listURL,'/apps/news/results?p=UKNB','/apps/news/source-list?p=OTHER']){const f=fixture({listResponse:html('',302,{location})}),result=await f.client.inspectSourceSearch();assert.equal(result.status,'needs_interaction');assert.equal(f.calls.length,1);assert.equal(result.sourceBrowseOpened,false);assert.equal(result.searchSubmitted,false);assert.equal(result.articleOpened,false);}
});

test('large source-form metadata stays within12KB and never serializes unapproved form values or source page prose',async()=>{
 const extra=Array.from({length:90},(_,i)=>'<input name="field-'+i+'" value="PRIVATE-FIELD-'+i+'"><select name="select-'+i+'"><option value="PRIVATE-OPTION-'+i+'">PRIVATE OPTION '+i+'</option></select>').join(''),f=fixture({browse:sourceForm('pubname:SCOTEST',extra)}),result=await f.client.inspectSourceSearch();assertMetadata(result);assert.equal(f.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|OPTION|FIELD/);
});

test('opaque public bibliography identifiers work only inside the fresh pubname source reference and cannot admit credentials or changed source names',async()=>{
 const encodedName=new URLSearchParams({name:sourceName}).toString().slice(5);
 for(const reference of ['pubname:AB12CD34EF56AB78','pubname:123456789012','pubname:'+('Q'.repeat(40)),'pubname:SCOTEST!'+sourceName,'pubname:SCOTEST!'+encodedName]){const expected='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t='+encodeURIComponent(reference)+'&action=browse';const f=fixture({rows:[row(reference)],browse:sourceForm(reference),expectedBrowseURL:expected}),result=await f.client.inspectSourceSearch();assert.equal(result.status,'source-search-inspection');assert.equal(result.source.browseURL,expected);assert.equal(result.page.matchingSourceBindings,1);assert.equal(result.page.conflictingSourceBindings,0);assert.equal(result.articleOpened,false);assert.equal(result.searchSubmitted,false);assert.equal(f.calls.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|paragraphs|"rows"\s*:\s*\[|"config"/);}
 for(const reference of ['session:AB12CD34EF56AB78','pubname:secret-token','pubname:AB12CD34EF56AB78%25','pubname:AB12CD34EF56AB78!The Wrong Newspaper','pubname:https://attacker.example','pubname:AB12CD34EF56AB78&token=PRIVATE','pubname:SCOTEST!'+encodeURIComponent(encodedName),'pubname:SCOTEST!'+encodedName+'&session=PRIVATE','pubname:SCOTEST!'+new URLSearchParams({name:'The Wrong Newspaper'}).toString().slice(5)]){const f=fixture({rows:[row(reference)]}),result=await f.client.inspectSourceSearch();assert.equal(result.status,'needs_interaction');assert.equal(f.calls.length,1);assert.equal(result.sourceBrowseOpened,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|AB12CD34EF56AB78|secret-token|attacker|Wrong Newspaper/);}
});
