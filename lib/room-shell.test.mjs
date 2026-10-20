import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('./room-shell.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./room-reader-shell.mjs', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ articles = [], role = 'owner', search = '', origin = 'https://reader.example', unauthenticated = false, importFailure = null, importFailureAlways = false, importUsage = null, roomLoadGate = null, initialUsageGate = null, libraryResults = null, librarySearchGate = null, searchAllowances = null, librarySearchFailure = null, invitationRequests = [], pendingRequestGate = null, shelfPages = null, shelfGate = null, shelfActionFailure = null, shelfActionGate = null } = {}) {
  const { window } = parseHTML(html);
  const document = window.document;
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  }
  const calls = [];
  let librarySearchCount=0;
  const roomOne = { id: 'one', name: 'Family room', role, moderation: 'open' };
  const roomTwo = { id: 'two', name: 'Book club', role: 'member', moderation: 'approval' };
  let active = roomOne;
  let shelf = [...articles];
  async function fetch(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, options, body });
    if (unauthenticated) return { ok: false, status: 401, json: async () => ({ error: 'Sign in.' }) };
    let value;
    if (path === '/api/rooms' && options.method === 'POST') {
      if (body.action === 'switch') active = roomTwo;
      value = { room: active };
    } else if (path === '/api/rooms') {if(roomLoadGate)await roomLoadGate;value = { rooms: [roomOne, roomTwo], activeRoom: active, member: { id: 'm1', displayName: 'Owner', role } };}
    else if (path.startsWith('/api/member-auth?action=invitation-requests')) { if (pendingRequestGate) await pendingRequestGate; value = { enabled: true, requests: invitationRequests }; }
    else if (path.startsWith('/api/member-auth?action=review-invitation-request')) { value = { name: 'Reader', email: 'reader@example.org', invitation: { url: 'https://reader.example/room#invite=' + 'a'.repeat(64) + '&purpose=member', expiresAt: '2026-10-26T00:00:00.000Z' } }; }
    else if (path.startsWith('/api/room-usage')) {if(path==='/api/room-usage'&&initialUsageGate)await initialUsageGate;value = { usage: importUsage, searchAllowances };}
    else if (path.startsWith('/api/room-articles') && options.method === 'POST') {
      if(body.action==='archive'||body.action==='restore'){
        if(shelfActionGate)await shelfActionGate(body);
        if(shelfActionFailure)return {ok:false,status:500,json:async()=>({error:shelfActionFailure})};
        const item=shelf.find(article=>article.id===body.id);if(item)item.archivedAt=body.action==='archive'?'2026-10-19T12:00:00Z':null;
        value={ok:true};
      }else{
        if(importFailure&&(importFailureAlways||!body.sourceHeadline))return {ok:false,status:422,json:async()=>importFailure};
        shelf = [{ id: 'added', title: 'Added article', sourceURL: body.url, publisher: 'News', createdAt: '2026-10-18T00:00:00Z', commentCount: 0 }, ...shelf];
        value = { id: 'added', href: '/read/added', cached: false };
      }
    } else if (path.startsWith('/api/room-articles')) {
      if(shelfGate)await shelfGate(path);
      const parsed=new URL(path,'https://reader.example'),view=parsed.searchParams.get('view')||'active',cursor=parsed.searchParams.get('cursor');
      if(shelfPages)value=shelfPages[cursor||'initial']||{articles:[],room:active,view,counts:{active:0,archived:0},canArchive:role==='owner',page:{nextCursor:null,hasMore:false,limit:50}};
      else{const selected=shelf.filter(article=>view==='archived'?!!article.archivedAt:!article.archivedAt);value={articles:selected,room:active,view,counts:{active:shelf.filter(article=>!article.archivedAt).length,archived:shelf.filter(article=>!!article.archivedAt).length},canArchive:role==='owner',page:{nextCursor:null,hasMore:false,limit:50}};}
    }
    else if(path.startsWith('/api/library-search/import?')){shelf=[{id:'library-added',title:'Library headline',sourceURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABCDEF',publisher:'The Observer',createdAt:'2026-10-19'},...shelf];value={id:'library-added',href:'/read/libraryadded?room='+active.id,cached:false};}
    else if(path.startsWith('/api/library-search?')){if(librarySearchGate)await librarySearchGate;if(librarySearchFailure){if(searchAllowances){searchAllowances.library.remaining--;searchAllowances.library.used++;}return {ok:false,status:502,json:async()=>librarySearchFailure};}const results=Array.isArray(libraryResults?.[0])?libraryResults[Math.min(librarySearchCount,libraryResults.length-1)]:libraryResults;librarySearchCount++;value={source:'camden',results:results||[{choiceId:'a'.repeat(48),title:'A fictional interview with a university researcher',date:'2026-10-18',publication:'The Times (London, England)',source:'Camden'}]};}
    else if (path === '/api/article-search') value = { results: [{ url: 'https://news.example/search-result', title: 'Found headline', publisher: 'The Times' }] };
    else value = { members: [] };
    return { ok: true, status: 200, json: async () => value };
  }
  const location = { search, pathname: '/study', origin, hostname: new URL(origin).hostname, assigned: '', assign(value) { this.assigned = value; } };
  const history = { replaced: '', replaceState(_state, _title, value) { this.replaced = value; } };
  const context = vm.createContext({ document, navigator: { userAgent: 'iPhone', clipboard: { writeText: async () => {} } }, location, history, fetch, crypto: webcrypto, URL, URLSearchParams, Intl, setTimeout, addEventListener() {} });
  vm.runInContext(script, context);
  return { document, calls, window, location, history };
}

function click(h, id) { h.document.getElementById(id).dispatchEvent(new h.window.Event('click')); }
function submit(h, id) { const event = new h.window.Event('submit', { cancelable: true }); Object.defineProperty(event, 'submitter', { value: h.document.querySelector('#' + id + ' button[type=submit]') }); h.document.getElementById(id).dispatchEvent(event); }

test('account offers cross-device access and keeps bookmark and install guidance out of the main shelf', async () => {
  const h = harness();
  const account = h.document.getElementById('account-dialog');
  const connect = account.querySelector('a[href="/room?next=/study#devices"]');
  assert.equal(connect.textContent, 'Connect another device');
  assert.equal(account.querySelector('a[href="/room?next=/study"]').textContent, 'Manage your account');
  const details = account.querySelector('details');
  assert.equal(details.querySelector('summary').textContent, 'Keep Reading Room on this device');
  assert.match(details.textContent, /⌘ D/);
  assert.match(details.textContent, /Ctrl D/);
  assert.match(details.textContent, /Add to Home Screen/);
  assert.match(details.textContent, /recovery link/);
  assert.equal(details.querySelector('#account-install').textContent, 'Install or add to this device');
  assert.equal(h.document.querySelector('main').contains(details), false, 'device help stays in the account sheet');
  const address = details.querySelector('#account-room-address');
  assert.equal(address.href, 'https://reader.example/study');
  assert.equal(address.textContent, 'reader.example/study');
  click(h, 'member-open');
  click(h, 'account-install');
  assert.equal(account.open, false);
  assert.equal(h.document.getElementById('install-dialog').open, true, 'account CTA uses the existing install dialog');
  const custom = harness({ origin: 'https://www.dayofflondon.com' });
  await flush();
  assert.equal(custom.document.getElementById('account-room-address').href, 'https://dayofflondon.com/study');
  assert.equal(custom.document.getElementById('account-room-address').textContent, 'dayofflondon.com/study');
  const legacy = harness({ origin: 'https://legacy.reader.example.org' });
  assert.equal(legacy.document.getElementById('account-room-address').href, 'https://dayofflondon.com/study');
});

test('shelf renders article metadata as text and never loads an unsafe image URL', async () => {
  const h = harness({ articles: [{ id: 'a', title: '<img src=x onerror=alert(1)>', publisher: 'The Times', image: 'javascript:alert(1)', sourceURL: 'https://news.example/a', createdAt: '2026-10-18T00:00:00Z', commentCount: 2 }] });
  await flush();
  assert.equal(h.document.querySelector('.article h3').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.document.querySelector('.article img'), null);
  assert.equal(h.document.querySelector('.article').getAttribute('href'), '/read/a?room=one');
  assert.equal(h.document.querySelector('.article-footer').textContent.includes('2 comments'), true);
  assert.equal(h.document.getElementById('people-open').hidden, false);
});

test('empty room, link add, search selection and room switch use the intended API', async () => {
  const h = harness({ role: 'member' });
  await flush();
  assert.equal(h.document.getElementById('empty').hidden, false);
  assert.equal(h.document.getElementById('people-open').hidden, true);
  click(h, 'room-open');
  assert.equal(h.document.getElementById('create-room-wrap').hidden, false);
  h.document.getElementById('rooms-dialog').close();
  click(h, 'empty-add');
  assert.equal(h.document.getElementById('add-dialog').open, true);
  h.document.getElementById('article-url').value = 'https://news.example/story';
  submit(h, 'url-form'); await flush(); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/room-articles' && c.options.method === 'POST').body.url, 'https://news.example/story');
  assert.equal(h.document.querySelectorAll('.article').length, 1);
  assert.equal(h.location.assigned,'/read/added');
  click(h, 'add-open'); click(h, 'search-tab');
  h.document.querySelector('#publisher option[value=guardian]').selected = true;
  h.document.getElementById('headline').value = 'A headline';
  submit(h, 'search-form'); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/article-search').body.publisher, 'guardian');
  h.document.querySelector('.result-item').dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.filter(c => c.path === '/api/room-articles' && c.options.method === 'POST').length, 2);
  assert.equal(h.calls.filter(c => c.path === '/api/room-articles' && c.options.method === 'POST')[1].body.sourceHeadline,'Found headline');
  click(h, 'room-open');
  h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/rooms' && c.body?.action === 'switch').body.roomId, 'two');
  assert.equal(h.document.getElementById('room-name').textContent, 'Book club');
});

test('registered library papers search Camden in the selected room and import only an opaque selected choice',async()=>{
 for(const publisher of ['times','telegraph','observer','scotsman','herald','national','irish-times','express']){
  const h=harness();await flush();click(h,'add-open');click(h,'search-tab');h.document.querySelector('#publisher option[value='+publisher+']').selected=true;h.document.getElementById('headline').value='Jason Arday';submit(h,'search-form');await flush();
  const search=h.calls.find(call=>call.path==='/api/library-search?room=one');assert.deepEqual(search.body,{publisher,query:'Jason Arday'});assert.equal(h.calls.some(call=>call.path==='/api/article-search'),false);assert.match(h.document.querySelector('.library-result').textContent,/Camden.*The Times.*18 Oct|Camden.*The Times.*Oct 18/);
  h.document.querySelector('.library-result').dispatchEvent(new h.window.Event('click'));await flush();await flush();
  const imported=h.calls.find(call=>call.path==='/api/library-search/import?room=one');assert.deepEqual(Object.keys(imported.body).sort(),['choiceId','requestId']);assert.equal(imported.body.choiceId,'a'.repeat(48));assert.match(imported.body.requestId,/^[a-f0-9-]{36}$/);assert.equal(h.location.assigned,'/read/libraryadded?room=one');
 }
});

test('Camden metadata results are escaped and a late response cannot appear after a room switch',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),h=harness({librarySearchGate:gate,libraryResults:[{choiceId:'b'.repeat(48),title:'<img src=x onerror=alert(1)>',date:'2026-10-18',publication:'The Observer'}]});await flush();click(h,'add-open');click(h,'search-tab');h.document.querySelector('#publisher option[value=observer]').selected=true;h.document.getElementById('headline').value='Jason Arday';submit(h,'search-form');await flush();
 click(h,'room-open');h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click'));await flush();await flush();release();await flush();
 assert.equal(h.document.getElementById('room-name').textContent,'Book club');assert.equal(h.document.querySelectorAll('.library-result').length,0);assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import')),false);
 const shown=harness({libraryResults:[{choiceId:'b'.repeat(48),title:'<img src=x onerror=alert(1)>',date:'2026-10-18',publication:'The Observer'}]});await flush();click(shown,'add-open');click(shown,'search-tab');shown.document.querySelector('#publisher option[value=observer]').selected=true;shown.document.getElementById('headline').value='Jason Arday';submit(shown,'search-form');await flush();assert.equal(shown.document.querySelector('.library-result strong').textContent,'<img src=x onerror=alert(1)>');assert.equal(shown.document.querySelector('.library-result img'),null);
});

test('an unavailable public headline reveals one contextual field and retries the same URL with the supplied headline',async()=>{
 const h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true}});await flush();click(h,'add-open');
 assert.equal(h.document.getElementById('source-headline'),null);
 h.document.getElementById('article-url').value='https://news.example/story';submit(h,'url-form');await flush();
 const input=h.document.getElementById('source-headline');assert.ok(input);assert.equal(h.document.getElementById('add-status').textContent,'Paste the newspaper’s headline to check Camden.');
 input.value='A verified fictional newspaper headline';submit(h,'url-form');await flush();await flush();
 const retries=h.calls.filter(c=>c.path==='/api/room-articles'&&c.options.method==='POST');assert.equal(retries.length,2);assert.equal(retries[1].body.url,'https://news.example/story');assert.equal(retries[1].body.sourceHeadline,input.value);assert.equal(h.document.getElementById('source-headline'),null);
});

test('a headline from a failed URL is never sent for a different link',async()=>{
 const h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true}});await flush();click(h,'add-open');
 h.document.getElementById('article-url').value='https://news.example/first';submit(h,'url-form');await flush();h.document.getElementById('source-headline').value='First story headline only';
 h.document.getElementById('article-url').value='https://news.example/second';submit(h,'url-form');await flush();
 const retries=h.calls.filter(c=>c.path==='/api/room-articles'&&c.options.method==='POST');assert.equal(retries[1].body.sourceHeadline,'');assert.equal(h.document.getElementById('source-headline').value,'');
});
test('a Telegraph URL offers a short Camden search from its first three distinctive slug words and waits for a choice',async()=>{
 const h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true}}),url='https://www.telegraph.co.uk/news/2026/10/19/university-cambridge-review-all-hr-procedures-jason-arday/?campaign=private-value';await flush();click(h,'add-open');h.document.getElementById('article-url').value=url;submit(h,'url-form');await flush();await flush();
 const request=h.calls.find(call=>call.path==='/api/library-search?room=one');assert.deepEqual(request.body,{publisher:'telegraph',query:'university cambridge review'});assert.equal(JSON.stringify(request).includes('private-value'),false);assert.equal(h.document.querySelectorAll('.library-result').length,1);assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import?')),false);assert.equal(h.calls.filter(call=>call.path==='/api/room-articles'&&call.options.method==='POST').length,1);
 h.document.querySelector('.library-result').click();await flush();assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import?')),true);
});
test('an empty first Telegraph search gets one shifted three-word Camden attempt',async()=>{
 const candidate={choiceId:'c'.repeat(48),title:'Cambridge reviews HR procedures',date:'2026-10-18',publication:'The Telegraph'},h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true},libraryResults:[[],[candidate]]}),url='https://www.telegraph.co.uk/news/2026/10/19/university-cambridge-review-all-hr-procedures-jason-arday';await flush();click(h,'add-open');h.document.getElementById('article-url').value=url;submit(h,'url-form');await flush();await flush();
 const searches=h.calls.filter(call=>call.path==='/api/library-search?room=one');assert.deepEqual(searches.map(call=>call.body.query),['university cambridge review','cambridge review hr procedures']);assert.equal(h.document.querySelectorAll('.library-result').length,1);assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import?')),false);
});
test('failed or typed-headline Telegraph searches do not run the shifted attempt',async()=>{
 const url='https://www.telegraph.co.uk/news/2026/10/19/university-cambridge-review-all-hr-procedures-jason-arday',failed=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true},librarySearchFailure:{error:'Camden unavailable.'}});await flush();click(failed,'add-open');failed.document.getElementById('article-url').value=url;submit(failed,'url-form');await flush();await flush();assert.equal(failed.calls.filter(call=>call.path==='/api/library-search?room=one').length,1);
 const typed=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true},importFailureAlways:true,libraryResults:[[],[{choiceId:'d'.repeat(48),title:'Cambridge review',date:'2026-10-18',publication:'The Telegraph'}],[]]});await flush();click(typed,'add-open');typed.document.getElementById('article-url').value=url;submit(typed,'url-form');await flush();typed.document.getElementById('source-headline').value='Cambridge to review all HR procedures';submit(typed,'url-form');await flush();await flush();const searches=typed.calls.filter(call=>call.path==='/api/library-search?room=one');assert.deepEqual(searches.map(call=>call.body.query),['university cambridge review','cambridge review hr procedures','Cambridge to review all HR procedures']);
});
test('a supplied headline that still needs verification searches same-paper Camden candidates using that exact headline',async()=>{
 const h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true},importFailureAlways:true}),url='https://www.telegraph.co.uk/news/2026/10/19/university-cambridge-review-all-hr-procedures-jason-arday';await flush();click(h,'add-open');h.document.getElementById('article-url').value=url;submit(h,'url-form');await flush();
 const input=h.document.getElementById('source-headline');input.value='Cambridge to review all HR procedures';submit(h,'url-form');await flush();await flush();
 const searches=h.calls.filter(call=>call.path==='/api/library-search?room=one');assert.equal(searches.at(-1).body.publisher,'telegraph');assert.equal(searches.at(-1).body.query,'Cambridge to review all HR procedures');assert.equal(h.document.querySelectorAll('.library-result').length,1);assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import?')),false);
});
test('a late Telegraph recovery response is discarded after the URL changes',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),h=harness({importFailure:{error:'Headline could not be verified.',needsHeadline:true},librarySearchGate:gate}),url='https://www.telegraph.co.uk/news/2026/10/19/university-cambridge-review-all-hr-procedures-jason-arday';await flush();click(h,'add-open');h.document.getElementById('article-url').value=url;submit(h,'url-form');await flush();await flush();h.document.getElementById('article-url').value='https://news.example/another-story';release();await flush();assert.equal(h.document.querySelectorAll('.library-result').length,0);assert.equal(h.calls.some(call=>call.path.startsWith('/api/library-search/import?')),false);
});
test('Observer is selectable and its unresolved library match reveals the existing headline recovery field',async()=>{
 const h=harness({importFailure:{error:'No unambiguous library headline match.',needsHeadline:true}}),url='https://observer.co.uk/news/national/article/short-title';await flush();click(h,'add-open');
 assert.equal(h.document.querySelector('#publisher option[value="observer"]').textContent,'The Observer');
 h.document.getElementById('article-url').value=url;submit(h,'url-form');await flush();
 const headline=h.document.getElementById('source-headline');assert.ok(headline);headline.value='A fictional Observer headline about local volunteers';submit(h,'url-form');await flush();await flush();
 const requests=h.calls.filter(call=>call.path==='/api/room-articles'&&call.options.method==='POST');assert.equal(requests[1].body.url,url);assert.equal(requests[1].body.sourceHeadline,headline.value);
});

test('Android shared title and URL are reviewed together and successful import opens the exact result',async()=>{
 const url='https://news.example/shared-story',title='A fictional clock tower falls during protests',h=harness({search:'?url='+encodeURIComponent(url)+'&title='+encodeURIComponent(title)});await flush();await flush();
 assert.equal(h.document.getElementById('add-dialog').open,true);assert.equal(h.document.getElementById('article-url').value,url);assert.equal(h.document.getElementById('source-headline').value,title);
 submit(h,'url-form');await flush();await flush();const call=h.calls.find(c=>c.path==='/api/room-articles'&&c.options.method==='POST');assert.equal(call.body.url,url);assert.equal(call.body.sourceHeadline,title);assert.equal(h.location.assigned,'/read/added');
});

test('a single shared article parameter keeps its headline attached and rejects unsafe or oversized input',async()=>{
 const url='https://news.example/fictional-story',title='A fictional clock tower falls during protests';
 const h=harness({search:'?article='+encodeURIComponent(JSON.stringify({url,title}))});await flush();await flush();
 assert.equal(h.document.getElementById('article-url').value,url);assert.equal(h.document.getElementById('source-headline').value,title);
 submit(h,'url-form');await flush();await flush();assert.equal(h.calls.find(c=>c.path==='/api/room-articles'&&c.options.method==='POST').body.sourceHeadline,title);
 for(const item of [{url:'javascript:alert(1)',title},{url:'https://news.example/'+ 'x'.repeat(2048),title}]){
  const bad=harness({search:'?article='+encodeURIComponent(JSON.stringify(item))});await flush();assert.equal(bad.document.getElementById('add-dialog').open,undefined);assert.equal(bad.calls.some(c=>c.options.method==='POST'),false);
 }
 const unsafe=harness({search:'?article='+encodeURIComponent(JSON.stringify({url,title:'<img src=x onerror=alert(1)>'}))});await flush();await flush();
 assert.equal(unsafe.document.getElementById('article-url').value,url);assert.equal(unsafe.document.getElementById('source-headline'),null);
});

test('article shelf link selects its room before loading and clears the room URL parameter', async () => {
  const h = harness({ search: '?room=two' });
  await flush(); await flush();
  assert.equal(h.calls[0].path, '/api/rooms');
  assert.deepEqual(h.calls[0].body, { action: 'switch', roomId: 'two' });
  assert.equal(h.calls[1].path, '/api/rooms');
  assert.equal(h.document.getElementById('room-name').textContent, 'Book club');
  assert.equal(h.history.replaced, '/study');
  const signedOut = harness({ search: '?room=two', unauthenticated: true });
  await flush();
  assert.equal(signedOut.calls.length, 1);
  assert.equal(signedOut.location.assigned, '/room?next=' + encodeURIComponent('/study?room=two'));
});

test('sign-in continuation preserves a shared article and its attached headline',async()=>{
 const search='?article='+encodeURIComponent(JSON.stringify({url:'https://news.example/story',title:'A fictional headline to study privately'}));
 const h=harness({search,unauthenticated:true});await flush();
 assert.equal(new URL(h.location.assigned,h.location.origin).searchParams.get('next'),'/study'+search);
});

test('newspaper filter narrows the local shelf without changing or fetching articles',async()=>{
 const articles=[{id:'a',title:'First report',publisher:'The Guardian'},{id:'b',title:'Second report',publisher:'The Guardian'},{id:'c',title:'Third report',publisher:'The Sun'}].map(x=>({...x,sourceURL:'https://news.example/'+x.id,createdAt:'2026-10-18T00:00:00Z'}));
 const h=harness({articles});await flush();const before=h.calls.length,selector=h.document.getElementById('shelf-paper');
 assert.equal(h.document.getElementById('shelf-filter-wrap').hidden,false);
 selector.querySelector('option[value="The Guardian"]').selected=true;selector.dispatchEvent(new h.window.Event('change'));
 assert.equal(h.document.querySelectorAll('.article').length,2);assert.match(h.document.getElementById('article-count').textContent,/Showing 3 of 3 · 2 in The Guardian/);assert.equal(h.calls.length,before);
 selector.querySelector('option[value=""]').selected=true;selector.dispatchEvent(new h.window.Event('change'));assert.equal(h.document.querySelectorAll('.article').length,3);assert.equal(h.calls.length,before);
});

test('owner can archive and restore from either view with a one-tap Undo',async()=>{
 const h=harness({articles:[{id:'a1',title:'A story to keep',publisher:'The Times',sourceURL:'https://news.example/a1',createdAt:'2026-10-18',commentCount:0}]});await flush();
 assert.equal(h.document.querySelector('.article-actions button').textContent,'Archive');
 click(h,'archived-shelf-tab');await flush();assert.equal(h.document.querySelectorAll('.article-card').length,0);assert.equal(h.document.querySelector('#empty h3').textContent,'Nothing archived yet');
 click(h,'active-shelf-tab');await flush();h.document.querySelector('.article-actions button').click();await flush();
 assert.equal(h.document.querySelectorAll('.article-card').length,0);assert.equal(h.document.querySelector('#undo-status button').textContent,'Undo');
 click(h,'archived-shelf-tab');await flush();assert.equal(h.document.querySelector('.article-actions button').textContent,'Restore');h.document.querySelector('.article-actions button').click();await flush();
 assert.equal(h.document.querySelectorAll('.article-card').length,0);h.document.querySelector('#undo-status button').click();await flush();
 const actions=h.calls.filter(call=>call.options.method==='POST'&&call.body?.action).map(call=>call.body.action);assert.deepEqual(actions,['archive','restore','archive']);
 assert.equal(h.document.getElementById('page-status').textContent,'Restore undone.');
 assert.equal(h.calls.filter(call=>call.options.method==='POST'&&call.body?.action).every(call=>call.path==='/api/room-articles?room=one'),true);
});

test('rapid archive taps serialize mutations and send the captured room',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=harness({articles:[{id:'first',title:'First story'},{id:'second',title:'Second story'}],shelfActionGate:()=>gate});await flush();
 const buttons=h.document.querySelectorAll('.article-actions button');buttons[0].click();buttons[1].click();
 assert.equal(h.document.querySelectorAll('.article-actions button')[1].disabled,true);assert.equal(h.calls.filter(call=>call.options.method==='POST'&&call.body?.action==='archive').length,1);
 assert.equal(h.calls.find(call=>call.options.method==='POST'&&call.body?.action==='archive').path,'/api/room-articles?room=one');
 release();await flush();assert.equal(h.document.querySelectorAll('.article-card').length,1);assert.equal(h.document.querySelector('.article h3').textContent,'Second story');
});

test('members can browse archived articles but never see archive or restore controls',async()=>{
 const h=harness({role:'member',articles:[{id:'old',title:'Archived story',archivedAt:'2026-10-19T10:00:00Z',sourceURL:'https://news.example/old'}]});await flush();
 assert.equal(h.document.querySelectorAll('.article-actions').length,0);click(h,'archived-shelf-tab');await flush();
 assert.equal(h.document.querySelector('.article h3').textContent,'Archived story');assert.equal(h.document.querySelectorAll('.article-actions').length,0);
 assert.equal(h.calls.some(call=>call.options.method==='POST'&&['archive','restore'].includes(call.body?.action)),false);
});

test('opaque cursor pages append and deduplicate articles past one hundred',async()=>{
 const first=Array.from({length:50},(_,i)=>({id:`a${i}`,title:`Story ${i}`,publisher:'News'}));
 const second=[first[49],...Array.from({length:59},(_,i)=>({id:`b${i}`,title:`More ${i}`,publisher:'News'}))];
 const pages={initial:{articles:first,room:{id:'one',name:'Family room',role:'owner'},counts:{active:110,archived:0},page:{nextCursor:'opaque/+cursor==',hasMore:true,limit:50}},'opaque/+cursor==':{articles:second,room:{id:'one',name:'Family room',role:'owner'},counts:{active:110,archived:0},page:{nextCursor:null,hasMore:false,limit:50}}};
 const h=harness({shelfPages:pages});await flush();assert.equal(h.document.querySelectorAll('.article-card').length,50);assert.match(h.document.getElementById('article-count').textContent,/Showing 50 of 110/);
 click(h,'show-more');await flush();assert.equal(h.document.querySelectorAll('.article-card').length,109);assert.match(h.document.getElementById('article-count').textContent,/Showing 109 of 110/);
 assert.equal(h.calls.some(call=>call.path.includes('cursor=opaque%2F%2Bcursor%3D%3D')),true);
});

test('late archived response after a view switch cannot replace the active shelf',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=harness({articles:[{id:'active',title:'Active story'}],shelfGate:path=>path.includes('view=archived')?gate:undefined,shelfPages:{initial:{articles:[{id:'active',title:'Active story'}],room:{id:'one',name:'Family room',role:'owner'},counts:{active:1,archived:1},page:{nextCursor:null,hasMore:false,limit:50}},archived:{articles:[{id:'old',title:'Late archived story',archivedAt:'2026-10-19'}],room:{id:'one',name:'Family room',role:'owner'},counts:{active:1,archived:1},page:{nextCursor:null,hasMore:false,limit:50}}}});await flush();
 click(h,'archived-shelf-tab');await flush();click(h,'active-shelf-tab');await flush();release();await flush();
 assert.equal(h.document.querySelector('.article h3').textContent,'Active story');assert.equal(h.document.getElementById('active-shelf-tab').getAttribute('aria-selected'),'true');
});

test('a late shelf result cannot cross a room switch',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=harness({articles:[{id:'active',title:'Current room story'}],shelfGate:path=>path.includes('view=archived')?gate:undefined});await flush();
 click(h,'archived-shelf-tab');await flush();click(h,'room-open');h.document.querySelectorAll('.room-item')[1].click();await flush();await flush();release();await flush();
 assert.equal(h.document.querySelector('.article h3').textContent,'Current room story');assert.equal(h.document.getElementById('active-shelf-tab').getAttribute('aria-selected'),'true');
});

test('failed next page keeps loaded articles and shows a retryable error',async()=>{
 const items=Array.from({length:2},(_,i)=>({id:`keep${i}`,title:`Keep ${i}`}));
 const h=harness({shelfPages:{initial:{articles:items,room:{id:'one',name:'Family room',role:'owner'},counts:{active:5,archived:0},page:{nextCursor:'next',hasMore:true,limit:50}}},shelfGate:path=>path.includes('cursor=')?Promise.reject(new Error('Page unavailable')):undefined});await flush();
 click(h,'show-more');await flush();assert.equal(h.document.querySelectorAll('.article-card').length,2);assert.equal(h.document.getElementById('page-status').textContent,'Page unavailable');assert.equal(h.document.getElementById('show-more').hidden,false);
});

test('add dialog explains shared new-import allowance before another request and keeps saved lookup usable',async()=>{
 const usage={limit:30,used:30,remaining:0,resetsAt:'2026-10-19T00:00:00Z',scope:'reading-room-service',failedAttemptsCount:false};
 const h=harness({importUsage:usage});await flush();click(h,'add-open');await flush();
 assert.equal(h.document.getElementById('import-allowance').hidden,false);
 assert.match(h.document.getElementById('import-allowance-summary').textContent,/0 of 30 left today/);
 assert.match(h.document.getElementById('import-allowance-summary').textContent,/19 Oct.*01:00.*UK time/);
 assert.match(h.document.getElementById('import-allowance').textContent,/all members, rooms and newspapers/);
 assert.match(h.document.getElementById('import-allowance').textContent,/Failed imports and opening saved articles do not use it/);
 assert.equal(h.document.getElementById('url-submit').disabled,false,'a saved URL may still open');
 assert.ok(h.calls.some(call=>call.path==='/api/room-usage?room=one'&&!call.options.method));
 assert.equal(h.calls.some(call=>call.path==='/api/room-articles'&&call.options.method==='POST'),false);
});
test('daily import refusal refreshes the meter without inventing a newspaper-specific quota',async()=>{
 const usage={limit:30,used:30,remaining:0,resetsAt:'2026-10-19T00:00:00Z',scope:'reading-room-service',failedAttemptsCount:false};
 const h=harness({importFailure:{error:'The shared allowance is used. Saved articles remain readable.',errorCode:'daily_import_limit',usage}});
 await flush();click(h,'add-open');await flush();assert.equal(h.document.getElementById('import-allowance').hidden,true);
 h.document.getElementById('article-url').value='https://news.example/new-article';submit(h,'url-form');await flush();
 assert.equal(h.document.getElementById('import-allowance').hidden,false);
 assert.match(h.document.getElementById('import-allowance-summary').textContent,/0 of 30/);
 assert.match(h.document.getElementById('add-status').textContent,/shared allowance/);
 assert.equal(h.document.getElementById('source-headline'),null);
});

test('owner People queue shows pending request safely and prepares a personal email invitation',async()=>{
 const request={id:'12345678-1234-4123-8123-123456789abc',name:'<img src=x onerror=alert(1)>',email:'reader@example.org',message:'<script>note</script>',status:'pending'};
 const h=harness({invitationRequests:[request]});await flush();click(h,'people-open');await flush();await flush();
 assert.match(h.document.getElementById('people-open').textContent,/1 request/);
 assert.equal(h.document.getElementById('invitation-requests-section').hidden,false);
 const row=h.document.querySelector('#invitation-requests-list .member-item');
 assert.equal(row.querySelector('img,script'),null);
 assert.equal(row.querySelector('strong').textContent,request.name);
 assert.equal(row.querySelector('p').textContent,request.message);
 row.querySelector('button').dispatchEvent(new h.window.Event('click'));await flush();await flush();
 const review=h.calls.find(call=>call.path.startsWith('/api/member-auth?action=review-invitation-request'));
 assert.deepEqual(review.body,{id:request.id,decision:'prepare'});
 const token='a'.repeat(64);
 assert.equal(h.document.getElementById('invite-link').textContent,'https://reader.example/room#invite='+token+'&purpose=member');
 const mail=h.document.getElementById('email-invite');
 assert.equal(mail.hidden,false);assert.match(mail.getAttribute('href'),/^mailto:/);assert.match(mail.getAttribute('href'),/reader(%40|@)example\.org/);
 assert.match(decodeURIComponent(mail.getAttribute('href')),new RegExp(token));
});

test('regular members never request the owner invitation queue',async()=>{
 const h=harness({role:'member',invitationRequests:[{id:'12345678-1234-4123-8123-123456789abc',name:'Private reader',email:'reader@example.org',message:'Private note',status:'pending'}]});await flush();
 assert.equal(h.document.getElementById('people-open').hidden,true);
 assert.equal(h.calls.some(call=>call.path.startsWith('/api/member-auth?action=invitation-requests')),false);
 assert.equal(h.calls.some(call=>call.path.startsWith('/api/member-auth?action=review-invitation-request')),false);
});

test('opening Add before the shelf loads still refreshes allowance for the resolved room',async()=>{
 let ready,usageReady;const roomLoadGate=new Promise(resolve=>ready=resolve),initialUsageGate=new Promise(resolve=>usageReady=resolve);
 const h=harness({roomLoadGate,initialUsageGate,importUsage:{limit:30,used:30,remaining:0,resetsAt:'2026-10-19T00:00:00Z'}});
 click(h,'add-open');assert.equal(h.document.getElementById('add-dialog').open,true);ready();await flush();await flush();
 assert.ok(h.calls.some(call=>call.path==='/api/room-usage?room=one'));
 assert.equal(h.document.getElementById('import-allowance').hidden,false);usageReady();await flush();
 assert.match(h.document.getElementById('import-allowance-summary').textContent,/0 of 30/);
});


test('pending study editions and the honest first-day transition are explained without charging failures',async()=>{
 const h=harness({importUsage:{limit:30,used:2,remaining:28,pending:3,available:25,resetsAt:'2026-10-19T00:00:00Z',failedAttemptsCount:false,historyStatus:'earlier-completions-unavailable'}});await flush();click(h,'add-open');await flush();
 assert.match(h.document.getElementById('import-allowance-summary').textContent,/28 of 30.*3 being prepared/);
 assert.equal(h.document.getElementById('import-allowance-transition').hidden,false);
 assert.match(h.document.getElementById('import-allowance-transition').textContent,/Earlier attempts were kept separately/);
});

test('library search dates retain the year for other UTC years so archive results stay distinct',async()=>{
 const current=new Date().getUTCFullYear(),prior=current-1,h=harness({libraryResults:[{choiceId:'c'.repeat(48),title:'A synthetic archive interview',date:prior+'-12-23',publication:'The Irish Times'},{choiceId:'d'.repeat(48),title:'A synthetic current interview',date:current+'-10-18',publication:'The Irish Times'}]});await flush();click(h,'add-open');click(h,'search-tab');h.document.querySelector('#publisher option[value="irish-times"]').selected=true;h.document.getElementById('headline').value='Jason Arday';submit(h,'search-form');await flush();const results=h.document.querySelectorAll('.library-result small');assert.match(results[0].textContent,new RegExp(String(prior)));assert.doesNotMatch(results[1].textContent,new RegExp(String(current)));assert.match(results[0].textContent,/23 Dec|Dec 23/);assert.match(results[1].textContent,/18 Oct|Oct 18/);
});


test('headline search allowance is visible before searching and refreshed after a failed attempt',async()=>{
 const usage={limit:30,used:26,remaining:4,resetsAt:'2026-10-20T00:00:00Z',scope:'room',failedAttemptsCount:true},allowances={library:{...usage},web:{...usage,used:0,remaining:30}};
 const h=harness({searchAllowances:allowances,librarySearchFailure:{error:'Camden news service is temporarily unavailable.',errorCode:'library_source_unavailable'}});await flush();click(h,'add-open');click(h,'search-tab');await flush();
 const counter=h.document.getElementById('search-allowance');assert.equal(counter.hidden,false);assert.match(counter.textContent,/Library 4 of 30; web 30 of 30/);assert.match(counter.textContent,/Shared by this room.*including failures.*20 Oct.*01:00.*UK time/);
 h.document.querySelector('#publisher option[value=telegraph]').selected=true;h.document.getElementById('headline').value='France imposes curfews to contain riots';submit(h,'search-form');await flush();await flush();
 assert.match(h.document.getElementById('add-status').textContent,/temporarily unavailable/);assert.match(counter.textContent,/Library 3 of 30/);assert.equal(h.calls.filter(call=>call.path.startsWith('/api/library-search?')).length,1);
});
