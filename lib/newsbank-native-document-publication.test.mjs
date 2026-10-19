import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {LIBRARY_PUBLICATIONS,SCOTSMAN_DOCUMENT_FAMILY_LABEL,SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL,OBSERVER_PUBLICATION_LABEL} from './library-publications.mjs';

const libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABCDEF',title='Synthetic regional archive volunteers inspect river plans',date='2026-10-18';
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'SYNTHETIC-PRIVATE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const sourceNode=label=>'<div class="document-view__meta--upper"><div class="document-view__meta__item--publication"><span class="source">'+label+'</span></div></div>';
const document=(upper,lower='')=>'<div id="document-view--ascii"><h1>'+title+'</h1>'+upper+'<div class="document-view__meta"><p>'+date+'</p><p>Author/Byline: Synthetic Reporter 1000 Words</p>'+lower+'</div><div class="document-view__body--ascii"><p>Synthetic first paragraph.</p><p>Synthetic second paragraph.</p><p>Synthetic third paragraph.</p></div></div>';
async function fetchRecord(publisher,publication,html){const calls=[],client=createNewsBankHTTPClient({fetch:async url=>{calls.push(url);return new Response(html,{headers:{'content-type':'text/html'}});}});client.restoreSession(session);const result=await client.fetchLibraryRecord({publisher,publication,title,date,libraryURL});assert.equal(calls.length,1);return result;}

test('the observed native upper publication field verifies each already registered strict label independently',async()=>{
 for(const paper of Object.values(LIBRARY_PUBLICATIONS).filter(paper=>paper.strictPublication))for(const label of paper.observedLabels){const result=await fetchRecord(paper.key,label,document(sourceNode(label)));assert.equal(result.status,'found',paper.key);assert.equal(result.article.publication,label);}
});

test('upper and lower bibliography publication conflicts and forbidden source locations cannot establish document proof',async()=>{
 const family=SCOTSMAN_DOCUMENT_FAMILY_LABEL,choice=SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL;
 const failures=[document(sourceNode(family),'<p>Publication: '+OBSERVER_PUBLICATION_LABEL+'</p>'),document(sourceNode(family),'<p>Publication: '+family+'</p>'),document('<form>'+sourceNode(family)+'</form>'),document('<div inert>'+sourceNode(family)+'</div>'),document(sourceNode(family).replace('class="source"','hidden class="source"')),document(sourceNode(family).replace('<span class="source">','<button><span class="source">').replace('</span>','</span></button>')),document(sourceNode(family).replace('class="document-view__meta--upper"','class="document-view__body--ascii"'))];
 const old=console.info;console.info=()=>{};try{for(const html of failures)assert.equal((await fetchRecord('scotsman',choice,html)).status,'not_found');}finally{console.info=old;}
});
