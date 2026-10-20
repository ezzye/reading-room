import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {libraryURLDiscoveryQuery} from './library-url-selection.mjs';

const html=readFileSync(new URL('./room-shell.html',import.meta.url),'utf8'),script=readFileSync(new URL('./room-reader-shell.mjs',import.meta.url),'utf8');
const observed={
 times:'https://www.thetimes.com/world/europe/article/france-protests-paris-students-cost-of-living-latest-news-dbdlgf98v',
 telegraph:'https://www.telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/',
 observer:'https://observer.co.uk/news/national/article/childrens-commissioner-declares-state-of-emergency-on-young-peoples-lives',
 herald:'https://www.heraldscotland.com/news/26644107.watched-bbc-scotland-night-got-sense-doom/',
 national:'https://www.thenational.scot/news/26647064.jenny-gilruth-pledges-work-bus-companies-mcgills/',
 'irish-times':'https://www.irishtimes.com/politics/2026/10/18/taoiseach-rejects-michael-olearys-view-that-he-would-buckle-to-public-sector-unions/',
 express:'https://www.express.co.uk/showbiz/tv-radio/2258269/strictly-star-forced-leave-bbc-show-immediately',
 record:'https://www.dailyrecord.co.uk/news/scottish-news/notorious-gangster-molls-behind-scotlands-37775755',
 sundaypost:'https://www.sundaypost.com/fp/police-quietly-shelve-plan-for-independent-review-of-all-rogue-officers/'
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
  else if(path==='/api/article-search')value={results:[]};
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

test('only registered exact article hosts yield bounded literal slug words, excluding record IDs and query text',async()=>{
 const h=harness();await settle();
 for(const [publisher,url]of Object.entries(observed).filter(([key])=>!['record','sundaypost'].includes(key))){const value=JSON.parse(vm.runInContext('JSON.stringify(libraryRecoveryFromURL('+JSON.stringify(url+'?utm_source=NOT_QUERY_WORDS')+'))',h.context));assert.equal(value.publisher,publisher);assert(value.query.length<=240);if(publisher==='telegraph')assert.equal(value.query.split(' ').length,3);else assert(value.query.split(' ').length>=5);assert.doesNotMatch(value.query,/NOT_QUERY|dbdlgf98v|26644107|26647064|2258269|2026\/10/i);}
 for(const url of ['http://observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending','https://observer.co.uk.evil.example/news/national/article/'+ 'word-'.repeat(6)+'ending','https://other.observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending','https://user:password'+'@observer.co.uk/news/national/article/'+ 'word-'.repeat(6)+'ending',observed.observer+'?session=PRIVATE',observed.observer+'#PRIVATE',observed.observer.replace('/news/','/archive/'),'https://observer.co.uk/news/national/article/short-title','https://www.irishtimes.com/politics/','https://express.co.uk/news/politics/2257606/',observed.observer.replace('childrens','childrens%2Fprivate'),observed.observer.replace('childrens','a1b2c3d4e5'),observed.observer+'-'+ 'word-'.repeat(80)+'ending'])assert.equal(vm.runInContext('libraryRecoveryFromURL('+JSON.stringify(url)+')',h.context),null,url);
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
 for(const [publisher,url]of Object.entries(observed).filter(([key])=>!['record','sundaypost'].includes(key))){const h=harness();await settle();attempt(h,url);await settle();assert.equal(searches(h).length,1,publisher);assert.equal(searches(h)[0].body.publisher,publisher);assert.deepEqual(Object.keys(searches(h)[0].body).sort(),['publisher','query']);assert.equal(h.calls.some(call=>call.path==='/api/article-search'||call.path.includes('/import')),false);assert.equal(h.document.getElementById('article-url').value,url);}
});

test('zero results or search failure restores contextual manual recovery without looping or importing',async()=>{
 for(const options of [{results:[]},{searchError:'The library service is busy.'}]){const h=harness(options);await settle();attempt(h,observed.herald);await settle();assert.equal(searches(h).length,1);assert.equal(h.document.getElementById('url-tab').getAttribute('aria-selected'),'true');assert.equal(h.document.getElementById('article-url').value,observed.herald);assert.equal(h.focused,'source-headline');assert.match(h.document.getElementById('add-status').textContent,/Paste the newspaper’s headline/);assert.equal(h.document.getElementById('source-headline').value,'');assert.equal(h.calls.some(call=>call.path.includes('/import')),false);await settle();assert.equal(searches(h).length,1);}
});

test('selected-only URL recovery opens one exact-publication metadata search, including a reader supplied headline',async()=>{
 for(const publisher of ['herald','national','irish-times','express']){
  const h=harness({failure:{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:publisher}});await settle();attempt(h,observed[publisher]);await settle();assert.equal(searches(h).length,1,publisher);assert.equal(searches(h)[0].body.publisher,publisher);assert.equal(h.document.getElementById('article-url').value,observed[publisher]);assert.equal(h.calls.some(call=>call.path.includes('/import')),false);assert.equal(h.location.assigned,'');
 }
 const title='A separately supplied headline about the community bus plans',h=harness({failure:{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:'herald'}});await settle();click(h,'add-open');h.document.getElementById('article-url').value=observed.herald;vm.runInContext('showSourceHeadline('+JSON.stringify(observed.herald)+','+JSON.stringify(title)+')',h.context);submit(h,'url-form');await settle();assert.equal(searches(h).length,1);assert.deepEqual(searches(h)[0].body,{publisher:'herald',query:title});assert.equal(h.calls.some(call=>call.path.includes('/import')),false);
});

test('selected-only short URL words focus an empty editable query instead of guessing a headline',async()=>{
 const url='https://www.heraldscotland.com/news/26644107.short-title/',h=harness({failure:{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:'herald'}});await settle();attempt(h,url);await settle();assert.equal(searches(h).length,0);assert.equal(h.document.getElementById('search-tab').getAttribute('aria-selected'),'true');assert.equal(h.document.getElementById('publisher').value,'herald');assert.equal(h.document.getElementById('headline').value,'');assert.equal(h.focused,'headline');assert.equal(h.document.getElementById('article-url').value,url);assert.match(h.document.getElementById('add-status').textContent,/Enter a few words/);assert.equal(h.calls.some(call=>call.path.includes('/import')),false);
});

test('a missing or mismatched publisher hint cannot redirect URL recovery to another paper',async()=>{
 for(const libraryPublisher of [undefined,'','telegraph','unknown']){const h=harness({failure:{error:'Selection unavailable.',needsLibrarySearch:true,libraryPublisher}});await settle();attempt(h,observed.herald);await settle();assert.equal(searches(h).length,0,String(libraryPublisher));assert.equal(h.document.getElementById('add-status').textContent,'Selection unavailable.');assert.equal(h.document.getElementById('article-url').value,observed.herald);}
});

test('a late selection response preserves a newer source-headline edit and waits for explicit resubmission',async()=>{
 const gate=deferred(),h=harness({articleGate:gate.promise,failure:{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:'herald'}});await settle();click(h,'add-open');h.document.getElementById('article-url').value=observed.herald;vm.runInContext('showSourceHeadline('+JSON.stringify(observed.herald)+',"The earlier headline about local bus services")',h.context);submit(h,'url-form');await tick();
 const corrected='The corrected headline about transport across Scotland';h.document.getElementById('source-headline').value=corrected;gate.resolve();await settle();assert.equal(searches(h).length,0);assert.equal(h.document.getElementById('source-headline').value,corrected);assert.equal(h.document.getElementById('article-url').value,observed.herald);assert.equal(h.document.getElementById('url-tab').getAttribute('aria-selected'),'true');assert.equal(h.document.getElementById('url-submit').disabled,false);assert.match(h.document.getElementById('add-status').textContent,/Headline changed/);assert.equal(h.calls.some(call=>call.path.includes('/import')),false);
 submit(h,'url-form');await settle();assert.equal(searches(h).length,1);assert.deepEqual(searches(h)[0].body,{publisher:'herald',query:corrected});
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


test('Record and Sunday Post preserve public manual searches and require an exact server hint before library recovery',async()=>{
 for(const publisher of ['record','sundaypost']){
  const h=harness();await settle();const option=h.document.querySelector('#publisher option[value="'+publisher+'"]');assert.equal(option.hasAttribute('data-library-fallback'),true);assert.equal(option.hasAttribute('data-library-search'),false);assert.equal(vm.runInContext('libraryRecoveryFromURL('+JSON.stringify(observed[publisher])+')',h.context),null);
  click(h,'add-open');click(h,'search-tab');option.selected=true;for(const query of ['A public newspaper headline search',observed[publisher]]){h.document.getElementById('headline').value=query;submit(h,'search-form');await settle();}assert.equal(h.calls.filter(call=>call.path==='/api/article-search').length,2);assert.equal(searches(h).length,0);
  const noHint=harness();await settle();attempt(noHint,observed[publisher]);await settle();assert.equal(searches(noHint).length,0);
  const matched=harness({failure:{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:publisher}});await settle();attempt(matched,observed[publisher]+'?utm_source=IGNORED_QUERY');await settle();assert.equal(searches(matched).length,1);assert.equal(searches(matched)[0].body.publisher,publisher);assert.doesNotMatch(searches(matched)[0].body.query,/37775755|IGNORED_QUERY/);assert.equal(matched.calls.some(call=>call.path==='/api/article-search'||call.path.includes('/import')),false);assert.equal(matched.document.querySelectorAll('.library-result').length,2);assert.equal(matched.location.assigned,'');assert.equal(matched.document.getElementById('headline').hasAttribute('readonly'),false);
  const wrong=harness({failure:{error:'Unmatched library hint.',needsLibrarySearch:true,libraryPublisher:publisher==='record'?'sundaypost':'record'}});await settle();attempt(wrong,observed[publisher]);await settle();assert.equal(searches(wrong).length,0);
 }
});

test('force-library remains internal to an exact marked URL hint and current recovery context',async()=>{
 for(const change of ["{forceLibrary:true}","{forceLibrary:true,expectedPublisher:'record',expectedURL:"+JSON.stringify(observed.sundaypost)+",recoveryCurrent:()=>true}","{forceLibrary:true,expectedPublisher:'record',expectedURL:"+JSON.stringify(observed.record)+",recoveryCurrent:()=>false}","{forceLibrary:true,expectedPublisher:'guardian',expectedURL:"+JSON.stringify(observed.record)+",recoveryCurrent:()=>true}"]){const h=harness();await settle();h.document.querySelector('#publisher option[value=record]').selected=true;h.document.getElementById('headline').value='Words from the headline for a metadata search';await vm.runInContext('search({preventDefault(){}},'+change+')',h.context);assert.equal(searches(h).length,0);assert.equal(h.calls.filter(call=>call.path==='/api/article-search').length,0);}
});

test('P&J and News Letter use existing library search choices without inventing URL shapes',async()=>{
 for(const publisher of ['press-and-journal','news-letter']){const h=harness();await settle();const option=h.document.querySelector('#publisher option[value="'+publisher+'"]');assert(option);assert.equal(option.hasAttribute('data-library-search'),true);click(h,'add-open');click(h,'search-tab');option.selected=true;h.document.getElementById('headline').value='Words from a known newspaper headline';submit(h,'search-form');await settle();assert.equal(searches(h).length,1);assert.equal(searches(h)[0].body.publisher,publisher);assert.equal(h.calls.some(call=>call.path==='/api/article-search'||call.path.includes('/import')),false);}
});

test('Record fallback retains the room, URL and source-headline race guards',async()=>{
 for(const change of ['room','url','headline']){const gate=deferred(),h=harness({articleGate:gate.promise,failure:{error:'Choose a Camden article.',needsLibrarySearch:true,libraryPublisher:'record'}});await settle();click(h,'add-open');h.document.getElementById('article-url').value=observed.record;vm.runInContext('showSourceHeadline('+JSON.stringify(observed.record)+',"The original newspaper headline supplied for matching")',h.context);submit(h,'url-form');await tick();if(change==='room'){click(h,'room-open');h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click'));await settle();}if(change==='url')h.document.getElementById('article-url').value=observed.sundaypost;if(change==='headline')h.document.getElementById('source-headline').value='The newly corrected newspaper headline';gate.resolve();await settle();assert.equal(searches(h).length,0,change);assert.equal(h.calls.some(call=>call.path.includes('/import')),false,change);if(change==='headline')assert.match(h.document.getElementById('source-headline').value,/newly corrected/);}
});


test('fallback URL syntax stays exact and a short Record slug waits for reader words',async()=>{
 const h=harness();await settle();for(const publisher of ['record','sundaypost']){const value=JSON.parse(vm.runInContext('JSON.stringify(libraryRecoveryFromURL('+JSON.stringify(observed[publisher])+',true,'+JSON.stringify(publisher)+'))',h.context));assert.equal(value.publisher,publisher);for(const url of [observed[publisher].replace('https:','http:'),observed[publisher].replace('www.','other.'),observed[publisher].replace('.co.uk/','.co.uk.evil.example/').replace('.com/','.com.evil.example/'),observed[publisher]+'?session=PRIVATE',observed[publisher]+'#PRIVATE',observed[publisher].replace('www.','user:password@www.')])assert.equal(vm.runInContext('libraryRecoveryFromURL('+JSON.stringify(url)+',true,'+JSON.stringify(publisher)+')',h.context),null,url);}
 const short='https://www.dailyrecord.co.uk/news/scottish-news/short-title-37775755',s=harness({failure:{error:'Choose a Camden article.',needsLibrarySearch:true,libraryPublisher:'record'}});await settle();attempt(s,short);await settle();assert.equal(searches(s).length,0);assert.equal(s.document.getElementById('article-url').value,short);assert.equal(s.document.getElementById('url-tab').getAttribute('aria-selected'),'true');assert.equal(s.focused,'source-headline');assert.match(s.document.getElementById('add-status').textContent,/Paste the newspaper’s headline/);const supplied='The exact newspaper headline supplied after a short URL';s.document.getElementById('source-headline').value=supplied;submit(s,'url-form');await settle();assert.equal(searches(s).length,1);assert.deepEqual(searches(s)[0].body,{publisher:'record',query:supplied});assert.equal(s.calls.some(call=>call.path==='/api/article-search'||call.path.includes('/import')),false);
});


test('matching Record/SP fallback queries mirror three distinct literal terms and keep supplied headlines exact',async()=>{
 const h=harness();await settle();const cases=[observed.record,observed.sundaypost,observed.record.replace('notorious-gangster-molls-behind-scotlands','the-police-police-and-the-courts-review'),observed.record.replace('notorious-gangster-molls-behind-scotlands','a9-road-safety-review'),observed.record.replace('notorious-gangster-molls-behind-scotlands','the-police-and-the-police'),observed.record.replace('notorious-gangster-molls-behind-scotlands','a'.repeat(100)+'-'+'b'.repeat(100)+'-'+'c'.repeat(50))];
 for(const url of cases){const publisher=url.includes('sundaypost')?'sundaypost':'record',value=JSON.parse(vm.runInContext('JSON.stringify(libraryRecoveryFromURL('+JSON.stringify(url)+',true,'+JSON.stringify(publisher)+'))',h.context));assert.equal(value.publisher,publisher);assert.equal(value.query,libraryURLDiscoveryQuery(url));assert(value.query.length<=240);assert.equal(vm.runInContext('libraryRecoveryFromURL('+JSON.stringify(url)+')',h.context),null);}
 for(const [publisher,query]of [['record','notorious gangster molls'],['sundaypost','police quietly shelve']]){const h=harness({failure:{error:'Choose a Camden article.',needsLibrarySearch:true,libraryPublisher:publisher}});await settle();attempt(h,observed[publisher]+'?utm_source=PRIVATE_QUERY');await settle();assert.equal(searches(h).length,1);assert.deepEqual(searches(h)[0].body,{publisher,query});assert.equal(h.document.getElementById('headline').value,query);assert.equal(h.calls.some(call=>call.path.includes('/import')||call.path==='/api/article-search'),false);assert.equal(h.document.querySelectorAll('.library-result').length,2);assert.equal(h.location.assigned,'');}
 const supplied="Notorious gangster molls behind Scotland's top cons: a supplied exact headline",r=harness({failure:{error:'Choose a Camden article.',needsLibrarySearch:true,libraryPublisher:'record'}});await settle();click(r,'add-open');r.document.getElementById('article-url').value=observed.record;vm.runInContext('showSourceHeadline('+JSON.stringify(observed.record)+','+JSON.stringify(supplied)+')',r.context);submit(r,'url-form');await settle();assert.equal(searches(r).length,1);assert.deepEqual(searches(r)[0].body,{publisher:'record',query:supplied});assert.equal(r.calls.some(call=>call.path.includes('/import')),false);
});
