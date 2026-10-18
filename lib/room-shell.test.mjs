import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('./room-shell.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./room-reader-shell.mjs', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ articles = [], role = 'owner', search = '', unauthenticated = false, importFailure = null, importUsage = null, roomLoadGate = null, initialUsageGate = null } = {}) {
  const { window } = parseHTML(html);
  const document = window.document;
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  }
  const calls = [];
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
    } else if (path === '/api/rooms') {if(roomLoadGate)await roomLoadGate;value = { rooms: [roomOne, roomTwo], activeRoom: active, member: { id: 'm1', displayName: 'Errol', role } };}
    else if (path.startsWith('/api/room-usage')) {if(path==='/api/room-usage'&&initialUsageGate)await initialUsageGate;value = { usage: importUsage };}
    else if (path === '/api/room-articles' && options.method === 'POST') {
      if(importFailure&&!body.sourceHeadline)return {ok:false,status:422,json:async()=>importFailure};
      shelf = [{ id: 'added', title: 'Added article', sourceURL: body.url, publisher: 'News', createdAt: '2026-10-18T00:00:00Z', commentCount: 0 }, ...shelf];
      value = { id: 'added', href: '/read/added', cached: false };
    } else if (path === '/api/room-articles') value = { articles: shelf, room: active };
    else if (path === '/api/article-search') value = { results: [{ url: 'https://news.example/search-result', title: 'Found headline', publisher: 'The Times' }] };
    else value = { members: [] };
    return { ok: true, status: 200, json: async () => value };
  }
  const location = { search, pathname: '/study', origin: 'https://reader.example', assigned: '', assign(value) { this.assigned = value; } };
  const history = { replaced: '', replaceState(_state, _title, value) { this.replaced = value; } };
  const context = vm.createContext({ document, navigator: { userAgent: 'iPhone', clipboard: { writeText: async () => {} } }, location, history, fetch, crypto: webcrypto, URL, URLSearchParams, Intl, setTimeout, addEventListener() {} });
  vm.runInContext(script, context);
  return { document, calls, window, location, history };
}

function click(h, id) { h.document.getElementById(id).dispatchEvent(new h.window.Event('click')); }
function submit(h, id) { const event = new h.window.Event('submit', { cancelable: true }); Object.defineProperty(event, 'submitter', { value: h.document.querySelector('#' + id + ' button[type=submit]') }); h.document.getElementById(id).dispatchEvent(event); }

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
  h.document.querySelector('#publisher option[value=times]').selected = true;
  h.document.getElementById('headline').value = 'A headline';
  submit(h, 'search-form'); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/article-search').body.publisher, 'times');
  h.document.querySelector('.result-item').dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.filter(c => c.path === '/api/room-articles' && c.options.method === 'POST').length, 2);
  assert.equal(h.calls.filter(c => c.path === '/api/room-articles' && c.options.method === 'POST')[1].body.sourceHeadline,'Found headline');
  click(h, 'room-open');
  h.document.querySelectorAll('.room-item')[1].dispatchEvent(new h.window.Event('click')); await flush(); await flush();
  assert.equal(h.calls.find(c => c.path === '/api/rooms' && c.body?.action === 'switch').body.roomId, 'two');
  assert.equal(h.document.getElementById('room-name').textContent, 'Book club');
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
 assert.equal(h.document.querySelectorAll('.article').length,2);assert.match(h.document.getElementById('article-count').textContent,/2 of 3/);assert.equal(h.calls.length,before);
 selector.querySelector('option[value=""]').selected=true;selector.dispatchEvent(new h.window.Event('change'));assert.equal(h.document.querySelectorAll('.article').length,3);assert.equal(h.calls.length,before);
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
