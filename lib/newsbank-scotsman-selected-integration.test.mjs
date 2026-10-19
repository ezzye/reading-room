import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {handler} from '../server-library/handler.mjs';
import {libraryPublication,libraryPublicationForURL} from './library-publications.mjs';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';

// Qualified source labels and the catalogue identity were observed separately.
// Headlines, paragraphs and bylines below are entirely synthetic.
const sourceName='Scotsman, The/Scotland on Sunday (Scotland)';
const sourceReference='pubname:SISO!Scotsman%2C+The%2FScotland+on+Sunday+%28Scotland%29';
const labels=['Scotsman, The (Edinburgh, Scotland)','Scotland on Sunday (Edinburgh, Scotland)'];
const listURL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
const browseURL='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t='+encodeURIComponent(sourceReference)+'&action=browse';
const query={publisher:'scotsman',query:'archive bus plans'},literalQuery='"archive" AND "bus" AND "plans"';
const refs=['ABC123','DEF456'];
const recordURL=ref=>{const url=new URL('https://infoweb.newsbank.com/apps/news/document-view');url.searchParams.set('p','UKNB');url.searchParams.set('docref','news/'+ref);return url.href;};
const choices=labels.map((publication,index)=>({title:'Synthetic archive researchers discuss '+(index?'Sunday':'weekday')+' bus plans',date:index?'2026-10-18':'2026-10-17',publication,libraryURL:recordURL(refs[index])}));
const paragraphs=Array.from({length:3},(_,index)=>'Synthetic paragraph '+index+'. '+'This fictional archive meeting considered local transport research and asked residents to discuss the available evidence. '.repeat(3));
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const aws={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-test-secret-only-not-real-12345'};
const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const columns=()=>['Source Name','Step','Dates','Location','Type','Format','Language'].map((title,index)=>({id:index===0?'label':index===1?'step':String(index),title,type:index===0?'link':'string',visible:Number(index!==1),searchable:Number(index!==1),sortable:Number(index!==1),...(index===0?{template:'/apps/news/browse-pub?p=UKNB&t=__1__&action=browse'}:{})}));
const catalogue=()=>'<div id="selected-test" class="nbcore-react-browse-container"></div><script>jQuery.extend(Drupal.settings,'+JSON.stringify({'nbcore_react_browse__selected-test':{config:{account:'PRIVATE-CONFIG'},cols:columns(),rows:[[sourceName,sourceReference,'1998 - Current','Scotland - Edinburgh','Newspaper','Text','English']]}})+');</script>';
const form=()=>'<h1>'+sourceName+'</h1><form method="POST" action="'+attr(browseURL)+'"><input type="hidden" name="r-urlparams" value="'+attr(new URL(browseURL).search.slice(1))+'"><input type="hidden" name="p" value="UKNB"><input type="hidden" name="t" value="'+sourceReference+'"><input type="hidden" name="fld-base-0" value="AllText"><input type="hidden" name="sort" value="YMD_date:D"><input type="hidden" name="hide_duplicates" value="1"><input type="hidden" name="maxresults" value="20"><input type="hidden" name="form_id" value="native_source_search"><input type="hidden" name="native_state" value="PRIVATE-NATIVE-STATE"><input type="text" name="val-base-0" id="edit-val-base-0" value="PRIVATE-OLD-QUERY"><input type="submit" name="submit" value="Search"></form>';
const hit=(row=choices[0],extra='')=>'<div class="search-hits__hit"><h3><a href="'+attr(row.libraryURL)+'">'+row.title+'</a></h3><ul><li>'+row.date+'</li><li>Synthetic Reporter</li><li>'+row.publication+'</li>'+extra+'</ul><p>PRIVATE-RESULT-SNIPPET</p></div>';
const results=(content=choices.map(row=>hit(row)).join(''))=>'<h1>'+sourceName+'</h1><form><input name="p" value="UKNB"><input name="t" value="'+sourceReference+'"></form>'+content;
const article=(row=choices[0],extra='')=>'<div id="document-view--ascii"><h1>'+row.title+'</h1><div class="document-view__meta"><p>'+row.date+'</p><p>Publication: '+row.publication+'</p>'+extra+'<p>Author/Byline: Synthetic Reporter 1000 Words</p></div><div class="document-view__body--ascii">'+paragraphs.map(value=>'<p>'+value+'</p>').join('')+'</div></div>';
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'Content-Type':'text/html',...headers}});
const resultLocation=()=>{const url=new URL('https://infoweb.newsbank.com/apps/news/results');for(const [key,value]of [['p','UKNB'],['t',sourceReference],['val-base-0',literalQuery],['fld-base-0','AllText']])url.searchParams.set(key,value);return url.href;};
function fixture({listing=catalogue(),browse=form(),result=results(),documentBody,postRedirect=false,documentRedirect}={}){
 const calls=[];const fetcher=async(raw,options={})=>{calls.push({url:raw,method:options.method,body:options.body});assert.equal(new URL(raw).origin,'https://infoweb.newsbank.com');assert.equal(options.redirect,'manual');
  if(raw===listURL){assert.equal(options.method,'GET');return html(listing);}
  if(raw===browseURL&&options.method==='GET')return html(browse);
  if(raw===browseURL&&options.method==='POST'){assert.equal(options.body.get('val-base-0'),literalQuery);assert.deepEqual(options.body.getAll('p'),['UKNB']);assert.deepEqual(options.body.getAll('t'),[sourceReference]);assert.equal(options.body.get('fld-base-0'),'AllText');assert.equal(options.body.get('r-urlparams'),new URL(browseURL).search.slice(1));assert.equal(options.body.get('native_state'),'PRIVATE-NATIVE-STATE');assert.equal(options.body.has('submit'),false);return postRedirect?html('',303,{location:resultLocation()}):html(result);}
  if(raw===resultLocation()){assert.equal(options.method,'GET');assert.equal(options.body,undefined);return html(result);}
  const row=choices.find(choice=>choice.libraryURL===raw);if(row){assert.equal(options.method,'GET');assert.equal(options.body,undefined);return documentRedirect?html('',302,{location:documentRedirect}):html(documentBody??article(row));}
  throw Error('A synthetic request left the observed source or selected record.');
 };
 const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {client,fetcher,calls};
}
function assertChoices(result){assert.equal(result.status,'library-search',JSON.stringify(result));assert.equal(result.schema,'newsbank-library-search/v1');assert.deepEqual(result.requested,query);assert.equal(result.pageCount,1);assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|paragraphs|snippet|cookies|r-urlparams|native_state|AllText|browse-pub/);}

test('Scotsman choices come from the fresh source form and retain each exact observed daily or Sunday label',async()=>{
 const f=fixture(),result=await f.client.searchLibrary(query);assertChoices(result);assert.deepEqual(result.results,choices);assert.equal(f.calls.length,3);assert.equal(f.calls.some(call=>new URL(call.url).pathname==='/apps/news/'||call.url.includes('document-view')),false);assert.equal(libraryPublication('scotsman').urlIntakeEnabled,false);assert.deepEqual([...libraryPublication('scotsman').observedLabels].sort(),[...labels].sort());
 for(const row of result.results){const selected={publisher:'scotsman',...row},found=await f.client.fetchLibraryRecord(selected);assert.equal(found.status,'found');assert.equal(found.article.publication,row.publication);assert.deepEqual(found.article.paragraphs,paragraphs.map(value=>value.trim()));const capture=buildLibraryRecordCapture({selected,article:found.article}),normalized=normalizeCapture(capture,{validatedLibraryRecordURL:row.libraryURL});assert.equal(capture.url,row.libraryURL);assert.equal(capture.publisher,libraryPublication('scotsman').name+' · Camden NewsBank text edition');assert.equal(normalized.diagnostics.libraryRecordEdition,true);assert(capture.blocks.every(block=>block.type==='paragraph'));assert.deepEqual(capture.blocks.map(block=>block.text),paragraphs.map(value=>value.trim()));assert.doesNotMatch(JSON.stringify(capture),/originalURL|scotsman\.com|replaced-photo/);}
});

test('selected source search may follow one validated filtered results redirect and never document or Next links',async()=>{
 const f=fixture({postRedirect:true,result:results()+'<a rel="next" href="'+attr(resultLocation()+'&page=2')+'">Next</a>'}),result=await f.client.searchLibrary(query);assertChoices(result);assert.deepEqual(result.results,choices);assert.equal(result.truncated,true);assert.equal(f.calls.length,4);assert.equal(f.calls[3].url,resultLocation());assert.equal(f.calls.some(call=>call.url.includes('document-view')||call.url.includes('page=2')),false);
});

test('only visible exact qualified sources and dates become choices; another family, hidden fields and mixed source metadata refuse',async()=>{
 const variants=[{...choices[0],publication:'The Guardian'},{...choices[0],publication:'Scotsman, The (Glasgow, Scotland)'},{...choices[0],publication:'<span hidden>'+labels[0]+'</span>'},{...choices[0],date:'No date'}];
 const f=fixture({result:results(hit(choices[0])+variants.map(row=>hit({...row,libraryURL:recordURL('AAA'+variants.indexOf(row))})).join('')+hit({...choices[1],libraryURL:recordURL('EEE111')},'<li>Source: The Guardian</li>'))}),result=await f.client.searchLibrary(query);assertChoices(result);assert.deepEqual(result.results,[choices[0]]);assert.equal(f.calls.length,3);
 const changed=fixture({browse:form().replace('name="t" value="'+sourceReference+'"','name="t" value="pubname:OTHER"')}),out=await changed.client.searchLibrary(query);assert.equal(out.status,'needs_interaction');assert.equal(changed.calls.length,2);
});

test('selected document independently refuses a changed title, date, publication, edition, hidden source or conflicting source',async()=>{
 const selected={publisher:'scotsman',...choices[0]},wrong=[article({...choices[0],title:'A different synthetic archive headline'}),article({...choices[0],date:'2026-10-18'}),article({...choices[0],publication:'The Guardian'}),article({...choices[0],publication:labels[1]}),article({...choices[0],publication:'<span hidden>'+labels[0]+'</span>'}),article(choices[0],'<p>Source: '+labels[1]+'</p>'),article(choices[0],'<p>Source: The Guardian</p>')];
 for(const documentBody of wrong){const f=fixture({documentBody}),out=await f.client.fetchLibraryRecord(selected);assert.deepEqual(out,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(f.calls.length,1);}
 for(const documentRedirect of [recordURL('DEAD123'),choices[0].libraryURL.replace('p=UKNB','p=OTHER'),choices[0].libraryURL+'&session=PRIVATE','/apps/news/results?p=UKNB','/apps/news/user/login?session=PRIVATE']){const f=fixture({documentRedirect}),out=await f.client.fetchLibraryRecord(selected);assert.equal(out.status,documentRedirect.includes('/user/login')?'login_required':'not_found');assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|DEAD123/);}
});

test('signed selected source actions keep credentials and arbitrary source inputs out, and automatic URL lookup remains disabled',async()=>{
 const f=fixture(),remote=runtimeLibraryClient(aws,async(_url,options)=>{const event=JSON.parse(options.body);assert.equal(Object.hasOwn(event,'cardNumber'),false);assert.equal(Object.hasOwn(event,'libraryName'),false);return Response.json(await handler(event,{fetch:f.fetcher}));});remote.restoreSession(session);const result=await remote.searchLibrary(query);assertChoices(result);const selected={publisher:'scotsman',...result.results[1]},found=await remote.fetchLibraryRecord(selected);assert.equal(found.status,'found');assert.equal(found.article.publication,labels[1]);assert.equal(f.calls.length,4);
 const noLookup=fixture();await assert.rejects(noLookup.client.lookup({publisher:'scotsman',title:choices[0].title}),/selected library records only/);assert.equal(noLookup.calls.length,0);
 assert.throws(()=>libraryPublicationForURL('https://www.scotsman.com/news/politics/fictional-archive-bus-plans-1234567'));
 let calls=0;for(const extra of [{sourceURL:browseURL},{t:sourceReference},{cardNumber:'PRIVATE-CARD'},{body:'PRIVATE-BODY'}]){const out=await handler({action:'library-search',session,...query,...extra},{fetch:async()=>{calls++;throw Error('No request allowed.');}});assert.equal(out.status,'error');assert.doesNotMatch(JSON.stringify(out),/PRIVATE|SISO/);}assert.equal(calls,0);
});
