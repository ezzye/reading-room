import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL as publication} from './library-publications.mjs';

const url='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABC123',selected={publisher:'scotsman',title:'Synthetic private archive meeting headline',date:'2026-10-18',publication,libraryURL:url};
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const paragraphs=['PRIVATE-PROSE-ONE','PRIVATE-PROSE-TWO','PRIVATE-PROSE-THREE'];
const article=({title=selected.title,date=selected.date,source=publication,text=paragraphs}={})=>'<div id="document-view--ascii"><h1>'+title+'</h1><div class="document-view__meta"><p>'+date+'</p><p>Publication: '+source+'</p><p>Author/Byline: PRIVATE-AUTHOR 1000 Words</p></div><div class="document-view__body--ascii">'+text.map(value=>'<p>'+value+'</p>').join('')+'</div></div>';
async function inspect(body,{redirect=false}={}){
 const logs=[],calls=[],old=console.info;console.info=(...args)=>logs.push(args);
 try{const client=createNewsBankHTTPClient({fetch:async(raw)=>{calls.push(raw);return redirect&&calls.length===1?new Response(null,{status:302,headers:{location:url.replace('news%2F','news/')}}):new Response(body,{headers:{'content-type':'text/html'}});}});client.restoreSession(session);return {result:await client.fetchLibraryRecord(selected),logs,calls};}finally{console.info=old;}
}
const receipt=value=>{assert.equal(value.logs.length,1);assert.equal(value.logs[0][0],'rr_newsbank_selected_record');const data=JSON.parse(value.logs[0][1]);assert.equal(data.schema,'newsbank-selected-record-check/v1');assert.equal(data.publisher,'scotsman');assert.doesNotMatch(JSON.stringify(data),/PRIVATE|ABC123|Synthetic|archive|2026-10-18|news%|https|publicationContext|conflictingPublications|paragraphs|cookie|session/);return data;};

test('selected record extraction refusal logs only fixed reason and picked source counts without changing the public response',async()=>{
 const missing=await inspect('<p>PRIVATE-UNREADABLE-PAGE</p>'),first=receipt(missing);assert.deepEqual(missing.result,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(first.phase,'extraction');assert.equal(first.reasonCode,'document_text_unavailable');assert.equal(first.paragraphCount,0);
 const wrong=await inspect(article({source:'Publication: PRIVATE-OTHER-SOURCE'})),data=receipt(wrong);assert.equal(data.reasonCode,'document_publication_mismatch');assert.equal(data.phase,'extraction');assert.equal(data.titleMatches,true);assert.equal(data.dateMatches,true);assert.equal(data.publicationMatches,false);assert.equal(data.paragraphCount,3);assert(data.sourceProof);assert(Object.values(data.sourceProof).every(value=>Number.isInteger(value)&&value>=0));
});

test('selected validation diagnostics distinguish identity fields and bounded text limits without logging their values',async()=>{
 for(const [options,key]of [[{title:'A different private headline'},'titleMatches'],[{date:'2026-10-17'},'dateMatches']]){const found=await inspect(article(options)),data=receipt(found);assert.equal(data.phase,'validation');assert.equal(data.reasonCode,'selected_record_mismatch');assert.equal(data[key],false);assert.equal(data.paragraphCount,3);assert(data.totalStringLength>0);assert.equal(found.calls.length,1);}
 const long=await inspect(article({text:Array.from({length:101},()=> 'PRIVATE-PROSE')})),data=receipt(long);assert.equal(data.phase,'validation');assert.equal(data.paragraphCount,101);assert.equal(data.titleMatches,true);assert.equal(data.dateMatches,true);assert.equal(data.publicationMatches,true);assert.equal(data.urlMatches,true);assert.equal(data.canonicalURLMatches,true);
 const canonical=await inspect(article(),{redirect:true}),urlData=receipt(canonical);assert.equal(urlData.urlMatches,false);assert.equal(urlData.canonicalURLMatches,true);assert.equal(canonical.calls.length,2);assert.equal(canonical.result.status,'not_found','diagnostics do not relax exact record validation');
});

test('a fully verified selected record produces no diagnostic event',async()=>{const found=await inspect(article());assert.equal(found.result.status,'found');assert.deepEqual(found.logs,[]);assert.equal(found.calls.length,1);});

test('publication refusal structural flags distinguish whole-document wrapper forms without relaxing their proof guard',async()=>{
 const wrapped=await inspect('<form action="/PRIVATE-ACTION" id="PRIVATE-ID"><input type="hidden" name="PRIVATE-NAME" value="PRIVATE-VALUE"><input type="password" value="PRIVATE-PASSWORD"><button>PRIVATE-BUTTON</button>'+article()+'</form>'),data=receipt(wrapped);assert.equal(wrapped.result.status,'not_found');assert.equal(data.phase,'extraction');assert.deepEqual(data.metadataStructure,{metaPresent:true,metaVisible:true,metaInForm:true,metaInert:false,metaInBody:false,metadataChildElementCount:3,metadataDirectTextCount:0,visibleMetadataLiteralCount:1,formContainsDocument:true,formActiveControls:{hidden:1,text:0,password:1,choice:0,submit:1,file:0,other:0}});assert.equal(data.sourceProof.expectedLiteralCount,0);
 const hidden=await inspect(article().replace('class="document-view__meta"','hidden class="document-view__meta"')),hiddenData=receipt(hidden);assert.equal(hiddenData.metadataStructure.metaVisible,false);assert.equal(hiddenData.metadataStructure.visibleMetadataLiteralCount,0);
 const inert=await inspect('<div inert>'+article()+'</div>'),inertData=receipt(inert);assert.equal(inertData.metadataStructure.metaInert,true);assert.equal(inertData.metadataStructure.visibleMetadataLiteralCount,0);
});

test('nearby public publication labels remain diagnostic observations and cannot replace document publication proof',async()=>{
 const body='<!doctype html><html><body><main class="document-view"><header class="private-account"><span>Scotland on Sunday</span></header>'+article({source:'PRIVATE-UNKNOWN-SOURCE'}).replace('<div class="document-view__body--ascii">','<div class="document-view__source"><span>'+publication+'</span></div><div class="document-view__body--ascii">')+'</main></body></html>';
 const found=await inspect(body),data=receipt(found);assert.deepEqual(found.result,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(data.publicationMatches,false);assert.equal(data.sourceProof.expectedLiteralCount,0);assert.equal(data.bibliographyStructure.rootAncestors[0].role,'document-parent');assert.deepEqual(data.bibliographyStructure.labelHits.map(hit=>[hit.scope,hit.basis]),[['ascii','exact-registered-label'],['parent-sibling','public-display-name']]);assert.doesNotMatch(JSON.stringify(data),/private-account|UNKNOWN-SOURCE|PRIVATE-PROSE/);
});
