import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {libraryPublication,libraryPublicationForURL} from './library-publications.mjs';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';

// Exact names below come from observed catalogue/result metadata. References,
// headlines, dates, bylines and paragraphs in this fixture are synthetic.
const cases=[
 {key:'press-and-journal',name:'Press & Journal, The (Aberdeen, Scotland)',publication:'Press & Journal, The (Aberdeen, Scotland)',foreign:'Press & Journal, The (Dundee, Scotland)',host:'pressandjournal.co.uk'},
 {key:'news-letter',name:'News Letter (Belfast, Northern Ireland)',publication:'News Letter (Belfast, Northern Ireland)',foreign:'News Letter (Belfast, Ireland)',host:'newsletter.co.uk'},
 {key:'record',name:'Daily Record, The / Sunday Mail: Web Edition Articles (Scotland)',publication:'Daily Record, The / Sunday Mail: Web Edition Articles (Scotland)',foreign:'Daily Record, The / Sunday Mail (Glasgow, Scotland)',host:'dailyrecord.co.uk'},
 {key:'sundaypost',name:'Sunday Post, The (Dundee, Scotland)',publication:'Sunday Post, The (Dundee, Scotland)',foreign:'Sunday Post, The (Glasgow, Scotland)',host:'sundaypost.com'}
];
const listURL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB',title='Synthetic local archivists discuss transport research',date='2026-10-17';
const queryText='archive transport research',literalQuery='"archive" AND "transport" AND "research"';
const paragraphs=Array.from({length:3},(_,index)=>'Synthetic paragraph '+index+'. '+'The fictional archive group discussed local transport and asked residents to examine the evidence together. '.repeat(3));
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
const columns=()=>['Source Name','Step','Dates','Location','Type','Format','Language'].map((label,index)=>({id:index===0?'label':index===1?'step':String(index),title:label,type:index===0?'link':'string',visible:Number(index!==1),searchable:Number(index!==1),sortable:Number(index!==1),...(index===0?{template:'/apps/news/browse-pub?p=UKNB&t=__1__&action=browse'}:{})}));
function fixture(paper,{searchPublication=paper.publication,documentPublication=paper.publication,documentTitle=title,documentDate=date,extraSource='',wrongForm=false,documentRedirect='',duplicateChoice=false}={}){
 const reference='pubname:SYNTHETICSTAGED!'+new URLSearchParams({name:paper.name}).toString().slice(5),browseURL='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t='+encodeURIComponent(reference)+'&action=browse';
 const record=new URL('https://infoweb.newsbank.com/apps/news/document-view');record.searchParams.set('p','UKNB');record.searchParams.set('docref','news/C0FFEE');const libraryURL=record.href,selected={publisher:paper.key,title,date,publication:paper.publication,libraryURL};
 const listing='<div id="staged" class="nbcore-react-browse-container"></div><script>jQuery.extend(Drupal.settings,'+JSON.stringify({'nbcore_react_browse__staged':{config:{state:'PRIVATE-CONFIG'},cols:columns(),rows:[[paper.name,reference,'2000 - Current','Synthetic Location','Newspaper','Text','English']]}})+');</script>';
 const form='<h1>'+paper.name+'</h1><form method="POST" action="'+attr(browseURL)+'"><input type="hidden" name="p" value="UKNB"><input type="hidden" name="t" value="'+(wrongForm?'pubname:OTHER':reference)+'"><input type="hidden" name="fld-base-0" value="AllText"><input type="hidden" name="native_state" value="PRIVATE-STATE"><input type="text" name="val-base-0" id="edit-val-base-0"></form>';
 const hit=sourceURL=>'<div class="search-hits__hit"><h3><a href="'+attr(sourceURL)+'">'+title+'</a></h3><ul><li>'+date+'</li><li>Synthetic Reporter</li><li>'+searchPublication+'</li></ul><p>PRIVATE-SNIPPET</p></div>';
 const result='<h1>'+paper.name+'</h1>'+hit(libraryURL)+(duplicateChoice?hit(libraryURL.replace('C0FFEE','C0FFEF')):'');
 const body='<div id="document-view--ascii"><h1>'+documentTitle+'</h1><div class="document-view__meta"><p>'+documentDate+'</p><p>Publication: '+documentPublication+'</p>'+extraSource+'<p>Author/Byline: Synthetic Reporter 1000 Words</p></div><div class="document-view__body--ascii">'+paragraphs.map(value=>'<p>'+value+'</p>').join('')+'</div></div>';
 const calls=[],client=createNewsBankHTTPClient({fetch:async(raw,options={})=>{calls.push({url:raw,method:options.method});assert.equal(options.redirect,'manual');if(raw===listURL){assert.equal(options.method,'GET');return new Response(listing,{headers:{'content-type':'text/html'}});}if(raw===libraryURL){assert.equal(options.method,'GET');return documentRedirect?new Response(null,{status:302,headers:{location:documentRedirect}}):new Response(body,{headers:{'content-type':'text/html'}});}assert.equal(raw,browseURL);if(options.method==='GET')return new Response(form,{headers:{'content-type':'text/html'}});assert.equal(options.method,'POST');assert.equal(options.body.get('val-base-0'),literalQuery);assert.deepEqual(options.body.getAll('p'),['UKNB']);assert.deepEqual(options.body.getAll('t'),[reference]);assert.equal(options.body.get('fld-base-0'),'AllText');assert.equal(options.body.get('native_state'),'PRIVATE-STATE');return new Response(result,{headers:{'content-type':'text/html'}});}});client.restoreSession(session);return {client,calls,selected,browseURL,libraryURL};
}

test('newly observed staged families use source-specific choices and independently verified library-record editions',async()=>{
 for(const paper of cases){const f=fixture(paper),metadata=await f.client.searchLibrary({publisher:paper.key,query:queryText});assert.equal(metadata.status,'library-search',JSON.stringify(metadata));assert.deepEqual(metadata.results,[{title,date,publication:paper.publication,libraryURL:f.libraryURL}]);assert.equal(metadata.fullTextVerified,false);assert.equal(metadata.articleAccepted,false);assert.equal(f.calls.length,3);assert.equal(f.calls.some(call=>call.url.includes('document-view')),false);assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE|paragraphs|native_state|AllText/);const found=await f.client.fetchLibraryRecord({publisher:paper.key,...metadata.results[0]});assert.equal(found.status,'found');assert.equal(found.article.publication,paper.publication);assert.equal(f.calls.length,4);const capture=buildLibraryRecordCapture({selected:f.selected,article:found.article});assert.equal(capture.url,f.libraryURL);assert.deepEqual(capture.blocks.map(block=>block.text),paragraphs.map(value=>value.trim()));assert(capture.blocks.every(block=>block.type==='paragraph'));assert.equal(capture.diagnostics.libraryRecordEdition,true);assert.doesNotMatch(JSON.stringify(capture),/originalURL|pressandjournal\.co\.uk|newsletter\.co\.uk|dailyrecord\.co\.uk|sundaypost\.com/);}
});

test('staged family source, date, title and qualified-label mismatches cannot become accepted selected records',async()=>{
 for(const paper of cases){
  for(const changes of [{documentTitle:'Another synthetic archive headline'},{documentDate:'2026-10-18'},{documentPublication:paper.foreign},{documentPublication:'The Guardian'},{documentPublication:'<span hidden>'+paper.publication+'</span>'},{extraSource:'<p>Source: The Guardian</p>'}]){const f=fixture(paper,changes),out=await f.client.fetchLibraryRecord(f.selected);assert.deepEqual(out,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(f.calls.length,1);}
  const wrong=fixture(paper,{wrongForm:true}),blocked=await wrong.client.searchLibrary({publisher:paper.key,query:queryText});assert.equal(blocked.status,'needs_interaction');assert.equal(wrong.calls.length,2);
  const mismatched=fixture(paper,{searchPublication:paper.foreign}),metadata=await mismatched.client.searchLibrary({publisher:paper.key,query:queryText});assert.deepEqual(metadata.results,[]);assert.equal(mismatched.calls.length,3);
  const redirect=fixture(paper,{documentRedirect:'/apps/news/document-view?p=UKNB&docref=news/DEAD123'}),out=await redirect.client.fetchLibraryRecord(redirect.selected);assert.equal(out.status,'not_found');assert.equal(redirect.calls.length,1);
 }
});

test('staged families do not acquire automatic publisher-URL lookup or an inferred public source',async()=>{
 for(const paper of cases){assert.equal(libraryPublication(paper.key).urlIntakeEnabled,false);assert.throws(()=>libraryPublicationForURL('https://'+paper.host+'/news/synthetic-article'));const f=fixture(paper);await assert.rejects(f.client.lookup({publisher:paper.key,title}),/selected library records only/);assert.equal(f.calls.length,0);}
});

test('same-headline Sunday Post records stay separate unaccepted choices until a reader selects an exact record',async()=>{
 const paper=cases.find(value=>value.key==='sundaypost'),f=fixture(paper,{duplicateChoice:true}),metadata=await f.client.searchLibrary({publisher:paper.key,query:queryText});assert.equal(metadata.status,'library-search');assert.equal(metadata.results.length,2);assert.equal(metadata.results[0].title,metadata.results[1].title);assert.equal(metadata.results[0].publication,metadata.results[1].publication);assert.equal(new Set(metadata.results.map(row=>row.libraryURL)).size,2);assert.equal(metadata.fullTextVerified,false);assert.equal(metadata.articleAccepted,false);assert.equal(f.calls.length,3);assert.equal(f.calls.some(call=>call.url.includes('document-view')),false);
});
