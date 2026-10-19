import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {libraryPublication,libraryPublicationForURL} from './library-publications.mjs';

// These names were observed in the native catalogue. All bibliography IDs,
// result metadata and form state in this fixture are synthetic.
const policies=[
 ['press-and-journal','Press & Journal, The (Aberdeen, Scotland)','pressandjournal.co.uk'],
 ['record','Daily Record, The / Sunday Mail: Web Edition Articles (Scotland)','dailyrecord.co.uk'],
 ['news-letter','News Letter (Belfast, Northern Ireland)','newsletter.co.uk'],
 ['sundaypost','Sunday Post, The (Dundee, Scotland)','sundaypost.com']
];
const listURL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
const columns=()=>['Source Name','Step','Dates','Location','Type','Format','Language'].map((title,index)=>({id:index===0?'label':index===1?'step':String(index),title,type:index===0?'link':'string',visible:Number(index!==1),searchable:Number(index!==1),sortable:Number(index!==1),...(index===0?{template:'/apps/news/browse-pub?p=UKNB&t=__1__&action=browse'}:{})}));
function fixture(index,{foreignCatalogue=false}={}){
 const [key,name]=policies[index],suffix=new URLSearchParams({name}).toString().slice(5),reference='pubname:SYNTHETIC'+index+'!'+suffix;
 const browseURL='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t='+encodeURIComponent(reference)+'&action=browse';
 const row=foreignCatalogue?[policies[(index+1)%policies.length][1],'pubname:SYNTHETICFOREIGN','2000 - Current','Synthetic Location','Newspaper','Text','English']:[name,reference,'2000 - Current','Synthetic Location','Newspaper','Text','English'];
 const listing='<div id="owner-test" class="nbcore-react-browse-container"></div><script>jQuery.extend(Drupal.settings,'+JSON.stringify({'nbcore_react_browse__owner-test':{config:{state:'PRIVATE-CONFIG'},cols:columns(),rows:[row]}})+');</script>';
 const form='<h1>'+name+'</h1><form method="POST" action="'+attr(browseURL)+'"><input type="hidden" name="r-urlparams" value="'+attr(JSON.stringify({p:'UKNB',t:reference}))+'"><input type="hidden" name="p" value="UKNB"><input type="hidden" name="t" value="'+reference+'"><input type="hidden" name="fld-base-0" value="AllText"><input id="edit-val-base-0" name="val-base-0" type="text"><input type="hidden" name="native_state" value="PRIVATE-NATIVE"></form>';
 const result='<h1>'+name+'</h1><div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC'+index+'">A synthetic source-scoped archive headline</a></h3><ul><li>October 19, 2026</li><li>Synthetic Result Publication</li></ul><p>PRIVATE-SNIPPET</p></div><a rel="next" href="/apps/news/document-view?p=UKNB&amp;docref=news/FFF">Next</a>';
 const calls=[],fetcher=async(raw,options={})=>{calls.push({url:raw,method:options.method});assert.equal(options.redirect,'manual');if(raw===listURL){assert.equal(options.method,'GET');return new Response(listing,{headers:{'Content-Type':'text/html'}});}assert.equal(raw,browseURL,'no source may fall back to global search or another catalogue row');if(options.method==='GET')return new Response(form,{headers:{'Content-Type':'text/html'}});assert.equal(options.method,'POST');assert.equal(options.body.get('val-base-0'),'"archive" AND "research" AND "plans"');assert.deepEqual(options.body.getAll('p'),['UKNB']);assert.deepEqual(options.body.getAll('t'),[reference]);assert.equal(options.body.get('fld-base-0'),'AllText');assert.equal(options.body.get('native_state'),'PRIVATE-NATIVE');return new Response(result,{headers:{'Content-Type':'text/html'}});};
 const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {key,client,calls,browseURL};
}

test('observed owner-only source policies bind each fresh catalogue identity without changing staged publication or URL intake permission',async()=>{
 for(let index=0;index<policies.length;index++){
  const f=fixture(index),prior=libraryPublication(f.key),snapshot=JSON.stringify(prior),result=await f.client.searchPublications({publication:f.key,title:'archive research plans'});assert.equal(result.status,'metadata',JSON.stringify(result));assert.deepEqual(f.calls.map(call=>[call.url,call.method]),[[listURL,'GET'],[f.browseURL,'GET'],[f.browseURL,'POST']]);assert.equal(result.pageCount,1);assert.equal(result.inspectedCount,1);assert.equal(result.fullTextVerified,false);assert.equal(result.articleAccepted,false);assert.equal(result.results.length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SYNTHETIC[0-9]|native_state|r-urlparams|AllText|paragraphs/);assert.equal(libraryPublication(f.key),prior);assert.equal(JSON.stringify(libraryPublication(f.key)),snapshot);assert.equal(prior?.urlIntakeEnabled??false,false);assert.throws(()=>libraryPublicationForURL('https://'+policies[index][2]+'/news/synthetic-story'));
  if(!prior){const before=f.calls.length;await assert.rejects(f.client.searchLibrary({publisher:f.key,query:'archive research'}),/invalid_library_search/);assert.equal(f.calls.length,before);}
 }
});

test('an absent intended source never borrows another family or falls back to the global result page',async()=>{
 for(let index=0;index<policies.length;index++){const f=fixture(index,{foreignCatalogue:true}),out=await f.client.searchPublications({publication:f.key,title:'archive research plans'});assert.equal(out.status,'needs_interaction');assert.equal(out.reasonCode,'destination_changed');assert.deepEqual(f.calls,[{url:listURL,method:'GET'}]);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|SYNTHETIC|pubname/);}
});
