import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {webcrypto} from 'node:crypto';
import {CAMDEN_RESOURCES} from './camden-resources.mjs';

const origin='https://reader.example',room='room-private-uuid',id='a'.repeat(48);
const html=readFileSync(new URL('./camden-resources.html',import.meta.url),'utf8');
const script=readFileSync(new URL('./camden-resources-client.mjs',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function mount({search='',searchResults=[],saveResult={id,href:'/read/'+id+'?room='+room},searchGate=null,resources=CAMDEN_RESOURCES}={}){
 const {document,window}=parseHTML(html),calls=[],navigations=[];
 let selectedValue='';Object.defineProperty(document.getElementById('resource'),'value',{configurable:true,get(){return selectedValue;},set(value){selectedValue=String(value);}});
 let fetchSearchCount=0;
 const location={origin,search,assign(value){navigations.push(value);}};
 async function fetch(path,options={}){
  const body=options.body?JSON.parse(options.body):null;calls.push({path,options,body});
  if(options.method==='POST'&&body?.action==='search'){
   const at=fetchSearchCount++,rows=Array.isArray(searchResults[0])?searchResults[Math.min(at,searchResults.length-1)]:searchResults;
   if(searchGate)await searchGate({body,at});
   return Response.json({results:rows,searchUsage:{limit:30,used:1,remaining:29}});
  }
  if(options.method==='POST'&&body?.action==='save')return Response.json(saveResult);
  return Response.json({resources,room:{id:room,name:'Private family room',role:'member'}});
 }
 vm.runInContext(script,vm.createContext({document,window,location,fetch,crypto:webcrypto,URL,URLSearchParams,Intl}));
 return {document,window,calls,navigations};
}
const submit=(h,id)=>h.document.getElementById(id).dispatchEvent(new h.window.Event('submit',{cancelable:true}));
const change=(h,id)=>h.document.getElementById(id).dispatchEvent(new h.window.Event('change'));

test('catalogue is grouped by category and directory selection launches the selected provider',async()=>{
 const h=mount();await flush();const select=h.document.getElementById('resource'),groups=[...select.querySelectorAll('optgroup')];
 assert.equal(select.querySelectorAll('option').length,CAMDEN_RESOURCES.length);assert.equal(groups.length,new Set(CAMDEN_RESOURCES.map(row=>row.category)).size);
 assert.equal(h.document.getElementById('directory').children.length,CAMDEN_RESOURCES.length);
 const cobra=CAMDEN_RESOURCES.find(row=>row.id==='cobra'),button=[...h.document.getElementById('directory').children].find(row=>row.textContent===cobra.name);
 button.dispatchEvent(new h.window.Event('click'));assert.equal(select.value,'cobra');assert.equal(h.document.getElementById('resource-description').textContent,cobra.description);
 const open=h.document.getElementById('open-resource');assert.equal(open.href,cobra.entryURL);assert.equal(open.target,'_blank');assert.equal(open.rel,'noreferrer');
});

test('public search renders safe text and excludes cross-provider and spoofed-resource results',async()=>{
 const h=mount({searchResults:[
  {resourceId:'cobra',title:'<img src=x onerror=alert(1)>',url:'https://camden.cobwebinfo.com/resource/example'},
  {resourceId:'britannica',title:'Wrong resource',url:'https://camden.cobwebinfo.com/resource/wrong'},
  {resourceId:'cobra',title:'Wrong host',url:'https://attacker.example/result'}
 ]});await flush();const select=h.document.getElementById('resource');select.value='cobra';change(h,'resource');
 h.document.getElementById('query').value='business plans';submit(h,'search-form');await flush();
 const cards=h.document.querySelectorAll('#results .result');assert.equal(cards.length,1);assert.equal(cards[0].querySelector('h3').textContent,'<img src=x onerror=alert(1)>');assert.equal(cards[0].querySelector('img'),null);assert.equal(cards[0].querySelector('a').href,'https://camden.cobwebinfo.com/resource/example');
});

test('adding a result saves through the API and opens the private room reading page',async()=>{
 const h=mount({searchResults:[{resourceId:'cobra',title:'Local business plan',url:'https://camden.cobwebinfo.com/resource/plan'}]});await flush();const select=h.document.getElementById('resource');select.value='cobra';change(h,'resource');
 h.document.getElementById('query').value='local business';submit(h,'search-form');await flush();h.document.querySelector('#results button').dispatchEvent(new h.window.Event('click'));await flush();
 const save=h.calls.find(call=>call.body?.action==='save');assert.deepEqual(save.body,{action:'save',resourceId:'cobra',title:'Local business plan',url:'https://camden.cobwebinfo.com/resource/plan'});
 assert.equal(save.options.headers['X-Reading-Room'],'1');assert.deepEqual(h.navigations,['/read/'+id+'?room='+room]);
});

test('stale search responses are ignored after the selected resource or query changes',async()=>{
 for(const changeKind of ['resource','query']){
  let release;const gate=new Promise(resolve=>{release=resolve;}),h=mount({searchResults:[{resourceId:'cobra',title:'Late result',url:'https://camden.cobwebinfo.com/late'}],searchGate:()=>gate});await flush();
  const select=h.document.getElementById('resource');select.value='cobra';change(h,'resource');h.document.getElementById('query').value='first search';submit(h,'search-form');await flush();
  if(changeKind==='resource'){select.value='britannica';change(h,'resource');}else{const query=h.document.getElementById('query');query.value='changed search';query.dispatchEvent(new h.window.Event('input'));}
  release();await flush();await flush();assert.equal(h.document.querySelectorAll('#results .result').length,0,changeKind);
 }
});

test('incoming reading URLs and titles are review-only and never auto-save',async()=>{
 const incoming='https://camden.cobwebinfo.com/resource/plan';
 const h=mount({search:'?room='+room+'&resource=cobra&url='+encodeURIComponent(incoming)+'&title='+encodeURIComponent('Family business plan')});await flush();
 assert.equal(h.document.getElementById('resource').value,'cobra');assert.equal(h.document.getElementById('reading-url').value,incoming);assert.equal(h.document.getElementById('reading-title').value,'Family business plan');assert.match(h.document.getElementById('save-status').textContent,/Review/);
 assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(h.navigations.length,0);
});
