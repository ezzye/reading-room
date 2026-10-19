import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';

const html=readFileSync(new URL('./room-shell.html',import.meta.url),'utf8'),script=readFileSync(new URL('./room-reader-shell.mjs',import.meta.url),'utf8');
const observed={
 times:'https://www.thetimes.com/world/europe/article/france-protests-paris-students-cost-of-living-latest-news-dbdlgf98v',
 telegraph:'https://www.telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/',
 observer:'https://observer.co.uk/news/national/article/childrens-commissioner-declares-state-of-emergency-on-young-peoples-lives',
 herald:'https://www.heraldscotland.com/news/26644107.watched-bbc-scotland-night-got-sense-doom/',
 national:'https://www.thenational.scot/news/26647064.jenny-gilruth-pledges-work-bus-companies-mcgills/',
 'irish-times':'https://www.irishtimes.com/politics/2026/10/18/taoiseach-rejects-michael-olearys-view-that-he-would-buckle-to-public-sector-unions/',
 express:'https://www.express.co.uk/showbiz/tv-radio/2258269/strictly-star-forced-leave-bbc-show-immediately'
};
const rows=[{choiceId:'a'.repeat(48),title:'Actual library headline — retain the whole source title',date:'2025-10-18',publication:'Observer, The: Web Edition Articles (London, England)'},{choiceId:'b'.repeat(48),title:'Another actual library record with its own title',date:'2026-10-18',publication:'Observer, The: Web Edition Articles (London, England)'}];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function settle(){await tick();await tick();}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function harness({results=rows,searchError=null,articleGate=null,searchGate=null,failure={error:'A source headline is needed.',needsHeadline:true}}={}){
 const {window}=parseHTML(html),document=window.document,calls=[];let focused='',room='one';
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};}
 for(const element of document.querySelectorAll('input,select,button'))element.focus=()=>{focused=element.id;};
 const createElement=document.createElement.bind(document);document.createElement=(...args)=>{const element=createElement(...args);element.focus=()=>{focused=element.id;};return element;};
 const location={origin:'https://reader.example',pathname:'/study',search:'',assigned:'',assign(value){this.assigned=value;}},history={replaceState(){}};
 const fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({path,body,options});let value;
  if(path==='/api/rooms'){if(body?.action==='switch')room=body.roomId;value={rooms:[{id:'one',name:'Family room',role:'owner'},{id:'two',name:'Other room',role:'member'}],activeRoom:{id:room,name:room==='one'?'Family room':'Other room',role:'owner'},member:{id:'member-one',displayName:'Reader'}};}
  else if(path.startsWith('/api/room-usage'))value={usage:null};
  else if(path==='/api/room-articles'&&options.method==='POST'){if(articleGate)await (typeof articleGate==='function'?articleGate(body):articleGate);return {ok:false,status:422,json:async()=>failure};}
  else if(path==='/api/room-articles')value={articles:[]};
  else if(path.startsWith('/api/library-search/import?'))value={cached:true,href:'/read/existing?room='+room};
  else if(path.startsWith('/api/library-search?')){if(searchGate)await searchGate;if(searchError)return {ok:false,status:503,json:async()=>({error:searchError})};value={source:'camden',results};}
  else throw Error('Unexpected request: '+path);
  return {ok:true,status:200,json:async()=>value};
 };
 const context=vm.createContext({document,navigator:{userAgent:'iPhone'},location,history,fetch,crypto:webcrypto,URL,URLSearchParams,Intl,setTimeout,addEventListener(){}});vm.runInContext(script,context);
 return {document,window,context,calls,location,get focused(){return focused;}};
}
function click(h,id){h.document.getElementById(id).dispatchEvent(new h.window.Event('click'));}
function submit(h,id){h.document.getElementById(id).dispatchEvent(new h.window.Event('submit',{cancelable:true}));}
function attempt(h,url){click(h,'add-open');h.document.getElementById('article-url').value=url;submit(h,'url-form');}
const searches=h=>h.calls.filter(call=>call.path.startsWith('/api/library-search?'));

test('only the seven registered exact article hosts yield bounded literal slug words, excluding record IDs and query text',async()=>{
 const h=harness();await settle();
 for(const [publisher,url]of Object.entries(observed)){const value=JSON.parse(vm.runInContext('JSON.stringify(libraryRecoveryFromURL('+JSON.stringify(url+'?utm_source=NOT_QUERY_WORDS')+'))',h.context));assert.equal(value.publisher,publisher);assert(value.query.length<=240);assert(value.query.split(' ').length>=5);assert.doesNotMatch(value.query,/NOT_QUERY|dbdlgf98v|26644107|26647064|2258269|2026\/10/i);}
 for(const url of ['http://observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending','https://observer.co.uk.evil.example/news/national/article/'+ 'word-'.repeat(6)+'ending','https://other.observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending','https://user:password@observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending',observed.observer+'?session=PRIVATE',observed.observer+'#PRIVATE',observed.observer.replace('/news/','/archive/'),'https://observer.co.uk/news/national/article/short-title','https://www.irishtimes.com/politics/','https://express.co.uk/news/politics/2257606/',observed.observer.replace('childrens','childrens%2Fprivate'),observed.observer.replace('childrens','a1b2c3d4e5'),observed.observer+'-'+ 'word-'.repeat(80)+'ending'])assert.equal(vm.runInContext('libraryRecoveryFromURL('+JSON.stringify(url)+')',h.context),null,url);
 assert.equal(searches(h).length,0);
});

test('needsHeadline triggers one room-scoped metadata search with editable words; exact dated choices require an explicit click',async()=>{
 const h=harness();await settle();attempt(h,observed.observer);await settle();
 assert.equal(searches(h).length,1,JSON.stringify({calls:h.calls,status:h.document.getElementById('add-status').textContent,debug:vm.runInContext('({headlineSearchRequest,urlArticleRequest,room:state.activeRoom?.id})',h.context)}));assert.deepEqual(searches(h)[0].body,{publisher:'observer',query:'childrens commissioner declares state of emergency on young peoples lives'});assert.equal(searches(h)[0].path,'/api/library-search?room=one');
 assert.equal(h.document.getElementById('article-url').value,observed.observer);assert.equal(h.document.getElementById('source-headline').dataset.url,observed.observer);assert.equal(h.document.getElementById('search-tab').getAttribute('aria-selected'),'true');assert.equal(h.focused,'headline');assert.equal(h.document.getElementById('headline').hasAttribute('readonly'),false);
 const choices=[...h.document.querySelectorAll('.library-result')];assert.equal(choices.length,2);assert.equal(choices[0].querySelector('strong').textContent,rows[0].title);assert.match(choices[0].querySelector('small').textContent,/2025/);assert.match(choices[0].querySelector('small').textContent,/Observer, The: Web Edition Articles/);assert.equal(h.calls.some(call=>call.path.includes('/import')),false);assert.equal(h.location.assigned,'');
 choices[1].dispatchEvent(new h.window.Event('click'));await settle();const imported=h.calls.find(call=>call.path.startsWith('/api/library-search/import?'));assert.equal(imported.path,'/api/library-search/import?room=one');assert.deepEqual(Object.keys(imported.body).sort(),['choiceId','requestId']);assert.equal(imported.body.choiceId,rows[1].choiceId);assert.equal(JSON.stringify(imported.body).includes(observed.observer),false);assert.equal(h.location.assigned,'/read/existing?room=one');assert.equal(h.calls.filter(call=>call.path==='/api/room-articles'&&call.body).length,1);
});

test('each registered URL recovery uses its exact Camden publisher and never a web search or automatic import',async()=>{
 for(const [publisher,url]of Object.entries(observed)){const h=harness();await settle();attempt(h,url);await settle();assert.equal(searches(h).length,1,publisher);assert.equal(searches(h)[0].body.publisher,publisher);assert.deepEqual(Object.keys(searches(h)[0].body).sort(),['publisher','query']);assert.equal(h.calls.some(call=>call.path==='/api/article-search'||call.path.includes('/import')),false);assert.equal(h.document.getElementById('article-url').value,url);}
});

test('zero results or search failure restores contextual manual recovery without looping or importing',async()=>{
 for(const options of [{results:[]},{searchError:'The library service is busy.'}]){const h=harness(options);await settle();attempt(h,observed.herald);await settle();assert.equal(searches(h).length,1);assert.equal(h.document.getElementById('url-tab').getAttribute('aria-selected'),'true');assert.equal(h.document.getElementById('article-url').value,observed.herald);assert.equal(h.focused,'source-headline');assert.match(h.document.getElementById('add-status').textContent,/Paste the newspaper’s headline/);assert.equal(h.document.getElementById('source-headline').value,'');assert.equal(h.calls.some(call=>call.path.includes('/import')),false);await settle();assert.equal(searches(h).length,1);}
});

test('unusable URL, supplied source headline, and errors without needsHeadline retain existing recovery and do not search',async()=>{
 for(const [url,failure]of [['https://observer.co.uk/news/national/article/short-title',{error:'Need headline.',needsHeadline:true}],[observed.observer,{error:'Unrelated import error.'}]]){const h=harness({failure});await settle();attempt(h,url);await settle();assert.equal(searches(h).length,0);if(failure.needsHeadline)assert.equal(h.focused,'source-headline');else assert.equal(h.document.getElementById('add-status').textContent,failure.error);}
 const h=harness();await settle();click(h,'add-open');h.document.getElementById('article-url').value=observed.observer;vm.runInContext('showSourceHeadline('+JSON.stringify(observed.observer)+',"The exact newspaper headline supplied by the reader")',h.context);submit(h,'url-form');await settle();assert.equal(searches(h).length,0);assert.equal(h.calls.find(call=>call.path==='/api/room-articles'&&call.body).body.sourceHeadline,'The exact newspaper headline supplied by the reader');assert.equal(h.focused,'source-headline');
});

test('a late URL failure cannot replace a newly entered URL, reopened dialog, manual search or another room',async()=>{
 for(const action of ['url','reopen','room','search']){const gate=deferred(),h=harness({articleGate:gate.promise});await settle();attempt(h,observed.observer);await tick();if(action==='url')h.document.getElementById('article-url').value=observed.express;if(action==='reopen'){h.document.getElementById('add-dialog').close();click(h,'add-open');}if(action==='room'){click(h,'room-open');h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click'));await settle();}if(action==='search'){click(h,'search-tab');h.document.getElementById('headline').value='Reader chosen search';}
  gate.resolve();await settle();assert.equal(searches(h).length,0,action);assert.equal(h.document.getElementById('source-headline'),null,action);if(action==='url')assert.equal(h.document.getElementById('article-url').value,observed.express);}
});

test('late automatic search results cannot appear after room, original URL, query, publisher or dialog changes',async()=>{
 for(const action of ['room','url','query','publisher','close','reopen','tab']){const gate=deferred(),h=harness({searchGate:gate.promise});await settle();attempt(h,observed.observer);await settle();assert.equal(searches(h).length,1);if(action==='room'){click(h,'room-open');h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click'));await settle();}if(action==='url')h.document.getElementById('article-url').value=observed.express;if(action==='query')h.document.getElementById('headline').value='Different editable research words';if(action==='publisher')h.document.querySelector('#publisher option[value=times]').selected=true;if(action==='close'||action==='reopen')h.document.getElementById('add-dialog').close();if(action==='reopen')click(h,'add-open');if(action==='tab')click(h,'url-tab');gate.resolve();await settle();assert.equal(h.document.querySelectorAll('.library-result').length,0,action);assert.equal(h.calls.some(call=>call.path.includes('/import')),false,action);assert.equal(searches(h).length,1,action);}
});

test('an older URL attempt cannot unlock a newer pending request; reopening Add resets its URL button',async()=>{
 const gates=[deferred(),deferred()];let calls=0;const h=harness({articleGate:()=>gates[calls++].promise,failure:{error:'The source could not be read.'}});await settle();attempt(h,observed.observer);await tick();h.document.getElementById('article-url').value=observed.express;submit(h,'url-form');await tick();gates[0].resolve();await settle();assert.equal(h.document.getElementById('url-submit').disabled,true);assert.equal(h.document.getElementById('url-submit').getAttribute('aria-busy'),'true');assert.equal(searches(h).length,0);gates[1].resolve();await settle();assert.equal(h.document.getElementById('url-submit').disabled,false);
 const pending=deferred(),reopened=harness({articleGate:pending.promise});await settle();attempt(reopened,observed.observer);await tick();assert.equal(reopened.document.getElementById('url-submit').disabled,true);reopened.document.getElementById('add-dialog').close();click(reopened,'add-open');assert.equal(reopened.document.getElementById('url-submit').disabled,false);pending.resolve();await settle();assert.equal(searches(reopened).length,0);assert.equal(reopened.document.getElementById('source-headline'),null);
});
