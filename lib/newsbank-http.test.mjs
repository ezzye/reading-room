import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsBankHTTPClient,extractDocument,normalizeNewsBankDate} from './newsbank-http.mjs';

const collection='https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB&t=favorite%3ALSTBLETW%21The%20London%20Times%20Collection';
const loginLink='<a href="/library-card?d=target">Log in with library credentials</a>';
const libraryForm='<form id="myForm" action="/login-libcard" method="POST" enctype="multipart/form-data"><input name="library" id="library"><input name="card" id="card"><input type="hidden" name="d" value="encoded-destination"><button>Sign in</button></form>';
const searchPage='<title>NewsBank Search</title><form action="/apps/news/search" method="GET"><input id="edit-val-base-0" name="query"><input type="hidden" name="p" value="UKNB"></form>';
const article=`<div id="document-view--ascii"><h1>Did Zombie tag take over London streets?</h1><div class="document-view__meta">Author/Byline: Alex Reporter 12 Words The Times June 5, 2024</div><div class="document-view__body--ascii"><p>First paragraph of synthetic text.</p>\n<p>Second paragraph of synthetic text.</p>\n<p>Third paragraph of synthetic text.</p></div></div>`;
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
function clientFor(routes){const calls=[];const client=createNewsBankHTTPClient({timeoutMs:200,maxBodyBytes:20_000,fetch:async(url,options)=>{calls.push({url,options});const key=new URL(url).origin+new URL(url).pathname;const route=routes[key]||routes[url];if(!route)throw new Error('unexpected synthetic request '+url);return typeof route==='function'?route({url,options,calls}):route.clone();}});return {client,calls};}

test('probe follows ordinary redirects and the library link, validates the form, and never submits credentials',async()=>{
 const {client,calls}=clientFor({
  [collection]:html('',302,{location:'https://arthur.newsbank.com/?d=private-target','set-cookie':'pre=private-cookie; Domain=.newsbank.com; Path=/; Secure'}),
  'https://arthur.newsbank.com/':({options})=>{assert.equal(options.headers.get('cookie'),'pre=private-cookie');return html('<html><body><a href="/library-card?d=private-target">Log in with library credentials</a></body></html>');},
  'https://arthur.newsbank.com/library-card':html(libraryForm),
 });
 const result=await client.probe();
 assert.deepEqual(result,{status:'available',httpStatus:200,loginForm:true});
 assert.equal(calls.length,3);assert(calls.every(({options})=>options.method==='GET'&&options.body===undefined&&options.redirect==='manual'));
 assert.deepEqual(Object.keys(result).sort(),['httpStatus','loginForm','status']);
 assert.doesNotMatch(JSON.stringify(result),/private-target|private-cookie|encoded-destination|<form/);
});

test('probe classifies a downstream HTTP 403 instead of treating its initial redirect as success',async()=>{
 const {client,calls}=clientFor({
  [collection]:html('',302,{location:'https://arthur.newsbank.com/?d=private-target'}),
  'https://arthur.newsbank.com/':html('<html><body>Private denial detail</body></html>',403),
 });
 assert.deepEqual(await client.probe(),{status:'blocked',httpStatus:403});
 assert.equal(calls.length,2);assert(calls.every(({options})=>options.method==='GET'));
});

test('probe requires all observed library fields and a POST destination without submitting the form',async()=>{
 for(const form of [
  '<form action="/login-libcard" method="POST"><input name="library"><input name="card"></form>',
  '<form action="/login-libcard" method="POST"><input name="library"><input name="barcode"><input name="d"></form>',
  '<form action="/login-libcard" method="GET"><input name="library"><input name="card"><input name="d"></form>',
  '<form action="https://attacker.example/login-libcard" method="POST"><input name="library"><input name="card"><input name="d"></form>',
 ]){
  const {client,calls}=clientFor({[collection]:html('',302,{location:'https://arthur.newsbank.com/library-card?d=private-target'}),'https://arthur.newsbank.com/library-card':html(form)});
  assert.deepEqual(await client.probe(),{status:'needs_interaction',httpStatus:200});
  assert(calls.every(({options})=>options.method==='GET'&&options.body===undefined));
 }
});

test('probe keeps challenge, host, redirect and body boundaries',async()=>{
 const challenge=clientFor({[collection]:html('<html><body><h1>Verify you are human</h1></body></html>')});
 assert.deepEqual(await challenge.client.probe(),{status:'needs_interaction',httpStatus:200});assert.equal(challenge.calls.length,1);
 const outside=clientFor({[collection]:html('',302,{location:'https://attacker.example/?private=target'})});
 assert.deepEqual(await outside.client.probe(),{status:'unavailable'});assert.equal(outside.calls.length,1);
 const loop=clientFor({[collection]:()=>html('',302,{location:collection})});
 assert.deepEqual(await loop.client.probe(),{status:'unavailable'});assert.equal(loop.calls.length,9);
 const oversized=clientFor({[collection]:html('x'.repeat(21_000),200,{'content-length':'21000'})});
 assert.deepEqual(await oversized.client.probe(),{status:'unavailable'});
});

test('uses the observed library-card multipart contract and follows only NewsBank redirects',async()=>{
 let collectionVisits=0;
 const routes={
  'https://infoweb.newsbank.com/apps/news/browse-multi':()=>html(searchPage),
  'https://arthur.newsbank.com/':html('<html><head><meta http-equiv="Content-Security-Policy" content="connect-src https://*.awswaf.com; script-src https://*.awswaf.com"></head><body>'+loginLink+'</body></html>',200,{'set-cookie':'pre=one; Path=/; Secure'}),
  'https://arthur.newsbank.com/library-card':html(libraryForm),
  'https://arthur.newsbank.com/login-libcard':({options})=>{assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.ok(options.body instanceof FormData);assert.equal(options.body.get('library'),'Camden Libraries');assert.equal(options.body.get('card'),'synthetic-card-123');assert.equal(options.body.get('d'),'encoded-destination');return html('<title>Search</title>',302,{location:collection,'set-cookie':'session=synthetic; Domain=.newsbank.com; Path=/; Secure'});},
 };
 routes['https://infoweb.newsbank.com/apps/news/browse-multi']=({options})=>{if(++collectionVisits===1)return html('',302,{location:'https://arthur.newsbank.com/?d=collection'});assert.equal(options.headers.get('cookie'),'session=synthetic');return html(searchPage);};
 const {client,calls}=clientFor(routes);assert.deepEqual(await client.login({libraryName:'Camden Libraries',cardNumber:'synthetic-card-123'}),{status:'authenticated'});assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
 const snapshot=client.serializeSession();assert.equal(snapshot.cookies.length,2);assert.equal(snapshot.schema,'newsbank-http-session/v1');
});

test('searches the Times collection and extracts only the visible ASCII document body',async()=>{
 const routes={
  [collection]:html(searchPage),
  'https://infoweb.newsbank.com/apps/news/search':html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3><ul><li>June 5, 2024</li></ul></div>'),
  'https://infoweb.newsbank.com/apps/news/document-view':html(article),
 };
 const {client,calls}=clientFor(routes),result=await client.lookup({title:'Did Zombie tag take over London streets?',date:'2024-06-05'});
 assert.equal(result.status,'found');assert.equal(result.article.publication,'The Times (Camden NewsBank text edition)');assert.equal(result.article.paragraphs.length,3);assert.match(calls.find(x=>x.url.includes('/apps/news/search')).url,/query=/);
});

test('normalizes source and result date formats before matching',async()=>{
 assert.equal(normalizeNewsBankDate('2026-10-17'),'2026-10-17');
 assert.equal(normalizeNewsBankDate('Saturday, October 17, 2026'),'2026-10-17');
 assert.equal(normalizeNewsBankDate('17 Oct 2026'),'2026-10-17');
 const resultHTML='<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3><ul><li>Saturday, October 17, 2026</li></ul></div>';
 const routes={[collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(resultHTML),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('June 5, 2024','October 17, 2026'))};
 const {client}=clientFor(routes),result=await client.lookup({title:'Did Zombie tag take over London streets?',date:'2026-10-17'});
 assert.equal(result.status,'found');assert.equal(result.article.date,'October 17, 2026');
});

test('rejects an explicit different date and leaves unknown dates empty',async()=>{
 const resultHTML='<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3><ul><li>October 16, 2026</li></ul></div>';
 const routes={[collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(resultHTML),'https://infoweb.newsbank.com/apps/news/document-view':html(article)};
 const {client}=clientFor(routes);assert.equal((await client.lookup({title:'Did Zombie tag take over London streets?',date:'2026-10-17'})).status,'not_found');
 assert.equal(normalizeNewsBankDate('date unavailable'),'');assert.equal(normalizeNewsBankDate('2026-02-30'),'');
 const unknownDoc=extractDocument(article.replace('June 5, 2024',''),'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123');
 assert.equal(unknownDoc.date,'');
 const unknownResultHTML='<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3></div>';
 const unknownRoutes={[collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(unknownResultHTML),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('June 5, 2024',''))};
 const unknownClient=clientFor(unknownRoutes).client,unknown=await unknownClient.lookup({title:'Did Zombie tag take over London streets?',date:'date unavailable'});
 assert.equal(unknown.status,'found');assert.equal(unknown.article.date,'');
});

test('returns interaction required for a challenge or a browser-only search UI',async()=>{
 const challengeClient=clientFor({[collection]:html('<html><head><title>NewsBank</title></head><body><h1>Verify you are human</h1></body></html>')}).client;
 assert.equal((await challengeClient.lookup({title:'A sufficiently useful Times headline'})).status,'needs_interaction');
 const jsOnly=clientFor({[collection]:html('<title>NewsBank</title><div id="__next"></div>')}).client;
 assert.match((await jsOnly.lookup({title:'A sufficiently useful Times headline'})).reason,/browser interface/);
});

test('does not share host-only cookies and deletes Max-Age=0 cookies',async()=>{
 let collectionGets=0;const routes={
  'https://infoweb.newsbank.com/apps/news/browse-multi':({options})=>{
   if(++collectionGets===1)return html('',302,{location:'https://arthur.newsbank.com/bootstrap'});
   assert.equal(options.headers.get('cookie'),null);return html('<html><body><div id="__next"></div></body></html>');
  },
  'https://arthur.newsbank.com/bootstrap':html('',302,{location:'https://arthur.newsbank.com/clear','set-cookie':'sid=old; Path=/; Secure'}),
  'https://arthur.newsbank.com/clear':({options})=>{assert.equal(options.headers.get('cookie'),'sid=old');return html('',302,{location:collection,'set-cookie':'sid=; Max-Age=0; Path=/; Secure'});},
 };
 const {client}=clientFor(routes);assert.equal((await client.lookup({title:'A sufficiently useful Times headline'})).status,'needs_interaction');assert.deepEqual(client.serializeSession().cookies,[]);
});

test('honors positive Max-Age and shares only an explicit parent-domain cookie',async()=>{
 let collectionGets=0;const routes={
  'https://infoweb.newsbank.com/apps/news/browse-multi':({options})=>{
   if(++collectionGets===1)return html('',302,{location:'https://arthur.newsbank.com/set'});
   assert.equal(options.headers.get('cookie'),'shared=synthetic');return html('<html><body><div id="__next"></div></body></html>');
  },
  'https://arthur.newsbank.com/set':html('',302,{location:collection,'set-cookie':'shared=synthetic; Max-Age=60; Domain=.newsbank.com; Path=/; Secure'}),
 };
 const {client}=clientFor(routes);await client.lookup({title:'A sufficiently useful Times headline'});
 const cookie=client.serializeSession().cookies[0];assert.equal(cookie.hostOnly,false);assert.ok(cookie.expires>Date.now());assert.ok(cookie.expires<=Date.now()+61_000);
});

test('rejects redirects outside NewsBank and oversized pages',async()=>{
 const outside=clientFor({[collection]:html('',302,{location:'https://attacker.example/collect'})}).client;
 await assert.rejects(()=>outside.lookup({title:'A sufficiently useful Times headline'}),/outside its approved HTTPS hosts/);
 const oversized=clientFor({[collection]:html('<html><body>'+'x'.repeat(21_000)+'</body></html>',200,{'content-length':'21000'})}).client;
 await assert.rejects(()=>oversized.lookup({title:'A sufficiently useful Times headline'}),/larger than this lookup allows/);
});

test('does not submit if the provider changes the observed login fields',async()=>{
 let posts=0;const c=clientFor({
  [collection]:html(loginLink,302,{location:'https://arthur.newsbank.com/'}),
  'https://arthur.newsbank.com/':html(loginLink),
  'https://arthur.newsbank.com/library-card':html('<form action="/login-libcard" method="POST"><input name="library"><input name="barcode"><input name="d"></form>'),
  'https://arthur.newsbank.com/login-libcard':()=>{posts++;return html('');},
 }).client;
 await assert.rejects(()=>c.login({libraryName:'Camden',cardNumber:'synthetic'}),/fields changed/);assert.equal(posts,0);
});

test('session import accepts only scoped NewsBank cookies',()=>{
 const c=createNewsBankHTTPClient({fetch:async()=>html('')});
 assert.throws(()=>c.restoreSession({schema:'newsbank-http-session/v1',cookies:[{name:'x',value:'1',domain:'attacker.example',path:'/'}]}),/not recognised/);
 c.restoreSession({schema:'newsbank-http-session/v1',cookies:[{name:'sid',value:'synthetic',domain:'arthur.newsbank.com',path:'/',secure:true}]});
 assert.equal(c.serializeSession().cookies[0].domain,'arthur.newsbank.com');
});

test('rejects incomplete or non-Times article markup',()=>{
 assert.throws(()=>extractDocument('<div id="document-view--ascii"><h1>Headline</h1></div>','https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123'),/no readable text article/);
});

test('preserves ordered text from line-break and div-based NewsBank layouts',()=>{
 const head='<div id="document-view--ascii"><h1>Did Zombie tag take over London streets?</h1><div class="document-view__meta">Author/Byline: Alex Reporter 12 Words The Times October 17, 2026</div>';
 const tail='</div>';
 const oneParagraph=head+'<div class="document-view__body--ascii"><p>First paragraph of synthetic text.<br><br>Second paragraph of synthetic text.<br>Third paragraph of synthetic text.</p></div>'+tail;
 const divBlocks=head+'<div class="document-view__body--ascii"><div>First paragraph of synthetic text.</div><div><span>Second paragraph</span> of synthetic text.</div><div>Third paragraph of synthetic text.</div></div>'+tail;
 const url='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123';
 assert.deepEqual(extractDocument(oneParagraph,url).paragraphs,['First paragraph of synthetic text.','Second paragraph of synthetic text.','Third paragraph of synthetic text.']);
 assert.deepEqual(extractDocument(divBlocks,url).paragraphs,['First paragraph of synthetic text.','Second paragraph of synthetic text.','Third paragraph of synthetic text.']);
});

test('Telegraph submits the observed general collection ordinary form and filters publication before fetching',async()=>{
 const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const hit=(id,publication)=>`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/${id}">Did Zombie tag take over London streets?</a></h3><ul><li>${publication}</li><li>June 5, 2024</li></ul></div>`;
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(hit('BAD123','Belfast Telegraph')+hit('ABC123','Daily Telegraph (London, England)')),'https://infoweb.newsbank.com/apps/news/document-view':({url})=>{assert.equal(new URL(url).searchParams.get('docref'),'news/ABC123');return html(article.replace('The Times','Daily Telegraph (London, England)'));}});
 const result=await client.lookup({title:'Did Zombie tag take over London streets?',date:'2024-06-05',publisher:'telegraph'});
 assert.equal(result.status,'found');assert.match(result.article.publication,/Daily Telegraph.*London, UK/);
 assert.equal(calls[0].url,entry);assert.equal(calls.length,3);assert.equal(calls[1].options.method,'GET');assert.match(calls[1].url,/query=/);
});

test('Telegraph requires explicit London publication proof and rejects other Telegraph editions and Times',()=>{
 const url='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123';
 for(const publication of ['The Times','Coventry Telegraph','Belfast Telegraph','Daily Telegraph (Sydney, Australia)','Daily Telegraph','Sunday Telegraph','London Observer','Telegraph (London, England)']){
  assert.throws(()=>extractDocument(article.replace('The Times',publication),url,'telegraph'),/publication did not verify/);
 }
 assert.match(extractDocument(article.replace('The Times','Sunday Telegraph (London, England)'),url,'telegraph').publication,/Sunday Telegraph.*London, UK/);
 assert.throws(()=>extractDocument(article.replace('The Times','Daily Telegraph (London, England)'),url),/publication did not verify/);
});

test('Telegraph refuses wrong-publication results before opening a document',async()=>{
 const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3><ul><li>The Times June 5, 2024</li></ul></div>')});
 assert.equal((await client.lookup({title:'Did Zombie tag take over London streets?',publisher:'telegraph'})).status,'not_found');
 assert.equal(calls.length,3);
});

test('Telegraph verifies the fetched record when result publication is unavailable',async()=>{
 const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html('<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">Did Zombie tag take over London streets?</a></h3><ul><li>June 5, 2024</li></ul></div>'),'https://infoweb.newsbank.com/apps/news/document-view':html(article)});
 const result=await client.lookup({title:'Did Zombie tag take over London streets?',publisher:'telegraph'});
 assert.equal(result.status,'not_found');assert.match(result.reason,/publication did not verify/);assert.equal(calls.length,3);
});

test('Telegraph preserves ambiguity rejection and invalid publisher never issues a request',async()=>{
 const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const hit=id=>'<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/'+id+'">Did Zombie tag take over London streets?</a></h3><ul><li>Daily Telegraph (London, England) June 5, 2024</li></ul></div>';
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(hit('ABC123')+hit('DEF456'))});
 await assert.rejects(()=>client.lookup({title:'Did Zombie tag take over London streets?',publisher:'belfast'}),/publisher/);assert.equal(calls.length,0);
 assert.equal((await client.lookup({title:'Did Zombie tag take over London streets?',publisher:'telegraph'})).status,'not_found');assert.equal(calls.length,3);
});

test('Telegraph retries an explicit empty result once using the distinctive ending and verifies the final record',async()=>{
 const title='Israel has no automatic right to exist, Polanski suggests',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',queries=[];
 const {client}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{const u=new URL(url);assert.equal(u.searchParams.getAll('query').length,1);queries.push(u.searchParams.get('query'));return html(queries.length===1?'<p>No results found.</p>':'<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">'+title+'</a></h3><ul><li>Sunday Telegraph (London, England) October 18, 2026</li></ul></div>');},'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('Did Zombie tag take over London streets?',title).replace('The Times June 5, 2024','Sunday Telegraph (London, England) October 18, 2026'))});
 const result=await client.lookup({title,date:'2026-10-18',publisher:'telegraph'});assert.equal(result.status,'found');assert.deepEqual(queries,['"israel" "automatic" "right"','"israel" "exist" "polanski"']);assert.equal(result.article.title,title);
});
test('empty-result classification requires an ordinary visible marker and never guesses unavailable content',async()=>{
 const entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',title='Israel has no automatic right to exist, Polanski suggests';
 for(const [body,status,requests] of [['<p>No results found</p>','not_found',3],['<script>{"message":"No results found"}</script>','needs_interaction',2],['<div hidden><p>No results found</p></div>','needs_interaction',2],['<div id="app"></div>','needs_interaction',2]]){
  const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(body)});assert.equal((await client.lookup({title,publisher:'telegraph'})).status,status);assert.equal(calls.length,requests);
 }
});
test('Telegraph fallback still rejects wrong dates and duplicate equally matching candidates',async()=>{
 const title='Israel has no automatic right to exist, Polanski suggests',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const hit=(id,date)=>'<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/'+id+'">'+title+'</a></h3><ul><li>Sunday Telegraph (London, England) '+date+'</li></ul></div>';
 for(const body of [hit('ABC123','October 17, 2026'),hit('ABC123','October 18, 2026')+hit('DEF456','October 18, 2026')]){
  const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(body)});assert.equal((await client.lookup({title,date:'2026-10-18',publisher:'telegraph'})).status,'not_found');assert.equal(calls.length,3);assert.equal(calls.some(c=>new URL(c.url).pathname==='/apps/news/document-view'),false);
 }
});
