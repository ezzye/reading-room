import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMatches,chooseMatch} from '../extension-library/library-core.mjs';
import {createNewsBankHTTPClient,extractDocument,normalizeNewsBankDate} from './newsbank-http.mjs';
import {sanitizeMatchDiagnostic,diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';

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
 const result=await client.lookup({title,date:'2026-10-18',publisher:'telegraph'});assert.equal(result.status,'found');assert.deepEqual(queries,['"Israel has no automatic right to exist, Polanski suggests"','"israel" AND "automatic" AND "right" AND "exist" AND "polanski"']);assert.equal(result.article.title,title);
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

test('next-day publication tolerance is explicit, bounded and keeps headline strength and ambiguity limits',()=>{const title='Fictional volunteers inspect river crossings',url='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123',next={title,url,date:'2026-08-06'},options={allowNextDayPublication:true};assert.equal(rankMatches(title,[next],'2026-08-05')[0].score,.65);assert.equal(rankMatches(title,[next],'2026-08-05',options)[0].score,.92);assert.equal(chooseMatch(title,[next],'2026-08-05',options).url,url);assert.throws(()=>chooseMatch(title,[next],'2026-08-05'),/unambiguous/);for(const date of ['2026-08-04','2026-08-07','2027-08-06','2026-02-30'])assert.throws(()=>chooseMatch(title,[{...next,date}],'2026-08-05',options),/unambiguous/);assert.throws(()=>chooseMatch(title,[next,{...next,url:url.replace('ABC123','DEF456')}],'2026-08-05',options),/unambiguous/);assert.throws(()=>chooseMatch(title,[next,{...next,date:'2026-08-05',url:url.replace('ABC123','DEF456')}],'2026-08-05',options),/unambiguous/);assert.throws(()=>chooseMatch(title,[{...next,title:'Completely unrelated election cabinet policy'}],'2026-08-05',options),/unambiguous/);});
test('Telegraph verifies a next-day print result and fetched document while Times remains strict',async()=>{const title='Did Zombie tag take over London streets?',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';for(const publisher of ['telegraph','times']){const publication=publisher==='telegraph'?'Daily Telegraph (London, England)':'The Times',result='<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">'+title+'</a></h3><ul><li>'+publication+' June 6, 2024</li></ul></div>',{client,calls}=clientFor({[publisher==='telegraph'?entry:collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(result),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('The Times June 5, 2024',publication+' June 6, 2024'))});const found=await client.lookup({title,date:'2024-06-05',publisher});assert.equal(found.status,publisher==='telegraph'?'found':'not_found');assert.equal(calls.some(c=>new URL(c.url).pathname==='/apps/news/document-view'),publisher==='telegraph');if(publisher==='telegraph'){assert.equal(normalizeNewsBankDate(found.article.date),'2024-06-06');assert.match(found.article.publication,/Daily Telegraph.*London/);}}});
test('Telegraph next-day tolerance never admits two-day/year results or a wrong fetched document date/publication',async()=>{const title='Did Zombie tag take over London streets?',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',hit=(id,date)=>'<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/'+id+'">'+title+'</a></h3><ul><li>Daily Telegraph (London, England) '+date+'</li></ul></div>';for(const [results,documentDate,publication,opened] of [[hit('ABC123','June 7, 2024'),'June 7, 2024','Daily Telegraph (London, England)',false],[hit('ABC123','June 6, 2025'),'June 6, 2025','Daily Telegraph (London, England)',false],[hit('ABC123','June 6, 2024')+hit('DEF456','June 6, 2024'),'June 6, 2024','Daily Telegraph (London, England)',false],[hit('ABC123','June 6, 2024'),'June 7, 2024','Daily Telegraph (London, England)',true],[hit('ABC123','June 6, 2024'),'June 6, 2024','Belfast Telegraph',true]]){const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(results),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('The Times June 5, 2024',publication+' '+documentDate))});assert.equal((await client.lookup({title,date:'2024-06-05',publisher:'telegraph'})).status,'not_found');assert.equal(calls.some(c=>new URL(c.url).pathname==='/apps/news/document-view'),opened);}});

test('not_found diagnostics distinguish date, publication and ambiguous headline candidates without snippets',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 const hit=(id,publication,date)=>`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/${id}&amp;token=NEVER_RETURN_TOKEN">${title}</a></h3><ul><li>${publication}</li><li>${date}</li></ul><p>NEVER_RETURN_EXCERPT</p><script>NEVER_RETURN_SCRIPT</script></div>`;
 const body=hit('ABC123','Daily Telegraph (London, England)','August 6, 2026')+hit('DEF456','Daily Telegraph (London, England)','August 6, 2026')+hit('BAD123','Belfast Telegraph','August 5, 2026')+hit('FED123','Daily Telegraph (London, England)','August 8, 2026');
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(body)}),result=await client.lookup({title,date:'2026-08-05',publisher:'telegraph'});
 assert.equal(result.status,'not_found');assert.match(result.reason,/unambiguous/);const d=result.diagnostic;assert.equal(d.stage,'search');assert.equal(d.datePolicy,'exact-or-next-day');assert.equal(d.queries.length,2);
 const q=d.queries[0];assert.equal(q.totalResults,4);assert.equal(q.eligibleCount,3);assert.equal(q.rejectedPublicationCount,1);assert.equal(q.rejectedLinkCount,0);
 const next=q.candidates.find(c=>c.libraryURL.endsWith('ABC123'));assert.equal(next.score,.92);assert.equal(next.headlineScore,1);assert.equal(next.date,'2026-08-06');assert.equal(next.publicationVerification,'verified');
 const wrong=q.candidates.find(c=>c.libraryURL.endsWith('BAD123'));assert.equal(wrong.publication,'Belfast Telegraph');assert.equal(wrong.publicationVerification,'unverified');assert.equal(wrong.eligible,false);
 assert.equal(q.candidates.find(c=>c.libraryURL.endsWith('FED123')).score,.65);assert.equal(calls.some(c=>new URL(c.url).pathname==='/apps/news/document-view'),false);
 assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|paragraphs|cookies|session|<|>/);
});

test('not_found diagnostics are bounded and refuse spoofed or non-UKNB result links before fetching',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',bad=['https://attacker.example/apps/news/document-view?p=UKNB&docref=news/ABC123','https://infoweb.newsbank.com.evil.example/apps/news/document-view?p=UKNB&docref=news/ABC123','https://arthur.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123','https://infoweb.newsbank.com/apps/news/document-view?p=OTHER&docref=news/ABC123','https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&p=OTHER&docref=news/ABC123','https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123&docref=news/DEF456','https://u:secret@infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123','https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=private/ABC123'];
 for(const url of bad)assert.equal(diagnosticDocumentURL(url),'');
 const hit=(url,i)=>`<div class="search-hits__hit"><h3><a href="${url.replace(/&/g,'&amp;')}">${title}</a></h3><ul><li>Daily Telegraph (London, England)</li><li>August 8, 2026</li></ul><p>NEVER_RETURN_PARAGRAPH_${i}</p></div>`;
 const valid=Array.from({length:18},(_,i)=>'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/'+(1000+i).toString(16).toUpperCase());
 const {client,calls}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html([...bad.slice(0,2),...valid,bad[2]].map(hit).join(''))});
 const result=await client.lookup({title,date:'2026-08-05',publisher:'telegraph'}),q=result.diagnostic.queries[0];assert.equal(result.status,'not_found');assert.equal(q.totalResults,21);assert.equal(q.inspectedCount,20);assert.equal(q.rejectedLinkCount,2);assert.equal(q.truncated,true);assert.equal(q.candidates.length,5);assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(result),/attacker|evil|NEVER_RETURN|secret/);
});

test('fetched-document rejection returns only safe observed document metadata',async()=>{
 const title='Did Zombie tag take over London streets?',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',hit=`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">${title}</a></h3><ul><li>June 5, 2024</li></ul></div>`;
 const {client}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(hit),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('The Times','Belfast Telegraph').replace('First paragraph of synthetic text.','NEVER_RETURN_DOCUMENT_SECRET'))});
 const result=await client.lookup({title,date:'2024-06-05',publisher:'telegraph'});assert.equal(result.status,'not_found');assert.equal(result.diagnostic.stage,'document');assert.equal(result.diagnostic.document.publication,'Belfast Telegraph');assert.equal(result.diagnostic.document.publicationVerification,'unverified');assert.equal(result.diagnostic.document.date,'2024-06-05');assert.equal(result.diagnostic.queries[0].candidates[0].publicationVerification,'unverified');assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|paragraphs|Alex Reporter/);
});

test('shared diagnostic sanitizer reconstructs fixed bounded metadata and cannot certify unknown sources',()=>{
 const candidate={title:'Fictional volunteers inspect river crossings',date:'2026-08-06',publication:'NEVER_RETURN_PUBLICATION_PROSE',publicationVerification:'verified',libraryURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123&cookie=NEVER_RETURN_COOKIE',score:.92,headlineScore:1,eligible:true,paragraphs:['NEVER_RETURN_BODY'],session:{token:'NEVER_RETURN_SESSION'}},raw={schema:'newsbank-match-diagnostic/v1',publisher:'telegraph',requested:{title:candidate.title,date:'2026-08-05',card:'NEVER_RETURN_CARD'},stage:'search',queries:Array.from({length:10},()=>({query:'"fictional" "volunteers" "inspect"',totalResults:10000,inspectedCount:10000,eligibleCount:10000,rejectedLinkCount:10000,rejectedPublicationCount:10000,candidates:Array.from({length:10},()=>candidate),html:'NEVER_RETURN_HTML'})),cookies:['NEVER_RETURN_COOKIE']};
 const safe=sanitizeMatchDiagnostic(raw);assert.equal(safe.queries.length,2);assert.equal(safe.queries[0].candidates.length,5);assert.equal(safe.queries[0].totalResults,1000);assert.equal(safe.queries[0].inspectedCount,60);assert.equal(safe.queries[0].candidates[0].publication,'');assert.equal(safe.queries[0].candidates[0].publicationVerification,'unverified');assert.doesNotMatch(JSON.stringify(safe),/NEVER_RETURN|paragraphs|cookies|session|html/);assert.equal(sanitizeMatchDiagnostic({schema:'wrong',publisher:'times'}),null);assert(JSON.stringify(safe).length<15000);
});

test('an observed ordinary Headline option scopes full-title search before the distinctive fallback',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',queries=[],form=searchPage.replace('</form>','<select name="fld-base-0"><option value="alltext" selected>All Text</option><option value="observed_TI9">Headline</option></select><input type="hidden" name="csrf" value="NEVER_RETURN_CSRF"></form>');
 const hit=`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">${title}</a></h3><ul><li>Daily Telegraph (London, England) July 25, 2026</li></ul></div>`;
 const {client,calls}=clientFor({[entry]:html(form),'https://infoweb.newsbank.com/apps/news/search':({url})=>{const u=new URL(url);assert.equal(u.searchParams.get('fld-base-0'),'observed_TI9');assert.equal(u.searchParams.getAll('fld-base-0').length,1);assert.equal(u.searchParams.get('csrf'),'NEVER_RETURN_CSRF');queries.push(u.searchParams.get('query'));return html(queries.length===1?'<p>No results found.</p>':hit);},'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('Did Zombie tag take over London streets?',title).replace('The Times June 5, 2024','Daily Telegraph (London, England) July 25, 2026'))});
 const result=await client.lookup({title,date:'2026-07-24',publisher:'telegraph'});assert.equal(result.status,'found');assert.deepEqual(queries,['"Fictional volunteers inspect river crossings"','"fictional" AND "volunteers" AND "inspect" AND "river" AND "crossings"']);assert.equal(calls.length,4);assert.equal('diagnostic' in result,false);
});

test('form evidence contains only observed public search options, sort choices and pagination counts',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',form=searchPage.replace('</form>','<select name="fld-base-0"><option value="alltext" selected>All Text</option><option value="ti">Title</option><option value="au">Author</option><option value="secret_token">Source</option><option value="private">NEVER_RETURN_LABEL_PROSE</option></select><select name="sort"><option value="YMD_date:D">Date (newest first)</option><option value="relevance">Relevance</option></select><select name="private_account"><option value="NEVER_RETURN_ACCOUNT">Title</option></select><input type="hidden" name="csrf" value="NEVER_RETURN_CSRF"></form>'),body=`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABC123">${title}</a></h3><ul><li>Daily Telegraph (London, England) October 16, 2026</li></ul><p>NEVER_RETURN_EXCERPT</p></div><div role="status">Showing 1-20 of 14,721 results</div><li class="pager__item--next"><a href="/apps/news/search?csrf=NEVER_RETURN_PAGE_TOKEN">Next</a></li>`;
 const {client}=clientFor({[entry]:html(form),'https://infoweb.newsbank.com/apps/news/search':html(body)}),result=await client.lookup({title,date:'2026-07-24',publisher:'telegraph'}),d=result.diagnostic;
 assert.equal(result.status,'not_found');assert.deepEqual(d.form.headlineSelection,{name:'fld-base-0',value:'ti',label:'Title'});assert.deepEqual(d.form.selects[0].options,[{value:'alltext',label:'All Text'},{value:'ti',label:'Title'},{value:'au',label:'Author'}]);assert.deepEqual(d.form.selects[1],{name:'sort',kind:'sort',tag:'select',type:'select-one',visibility:'visible',disabled:false,options:[{value:'YMD_date:D',label:'Date (newest first)'},{value:'relevance',label:'Relevance'}]});assert.equal(d.form.selects.length,2);assert.deepEqual(d.queries[0].resultPage,{hasNext:true,resultCount:14721});assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|secret_token|private_account|csrf|paragraphs|<|>/);
});

test('hidden, disabled, ambiguous or unrelated title controls never enable an automatic field override',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
 for(const control of ['<select name="fld-base-0" hidden><option value="ti">Title</option></select>','<select name="fld-base-0"><option value="alltext" selected>All Text</option><option value="ti" disabled>Title</option></select>','<select name="fld-base-0"><option value="alltext" selected>All Text</option><option value="ti">Title</option><option value="hl">Headline</option></select>','<select name="private_account"><option value="ti">Title</option></select>','<input type="hidden" name="fld-base-0" value="alltext"><select name="fld-base-0"><option value="ti">Title</option></select>']){
  const queries=[],{client}=clientFor({[entry]:html(searchPage.replace('</form>',control+'</form>')),'https://infoweb.newsbank.com/apps/news/search':({url})=>{queries.push(new URL(url).searchParams.get('query'));return html('<p>No results found.</p><div hidden><li class="pager__item--next"><a href="/private">Next</a></li><div role="status">999 results</div></div>');}}),result=await client.lookup({title,publisher:'telegraph'});
  assert.equal(result.status,'not_found');assert.equal(result.diagnostic.form.headlineSelection,null);assert.deepEqual(queries,['"Fictional volunteers inspect river crossings"','"fictional" AND "volunteers" AND "inspect" AND "river" AND "crossings"']);assert.deepEqual(result.diagnostic.queries[0].resultPage,{hasNext:false,resultCount:null});
 }
});

test('hidden native search selects and hidden field descriptors are visible in evidence without values or overrides',async()=>{
 const title='Fictional volunteers inspect river crossings',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',form=searchPage.replace('</form>','<div style="display:none"><select id="edit-fld-base-0" name="fld-base-0"><option value="alltext" selected>All Text</option><option value="TI_OBSERVED">Title</option></select></div><input type="hidden" id="edit-fld-base-1" name="fld-base-1" value="NEVER_RETURN_HIDDEN_FIELD"><input type="hidden" name="csrf" value="NEVER_RETURN_TOKEN"><select name="unknown_provider_control"><option value="NEVER_RETURN_UNKNOWN">Title</option></select></form>'),queries=[];
 const {client}=clientFor({[entry]:html(form),'https://infoweb.newsbank.com/apps/news/search':({url})=>{const u=new URL(url);queries.push(u.searchParams.get('query'));assert.equal(u.searchParams.get('fld-base-0'),'alltext');return html('<p>No results found.</p>');}}),result=await client.lookup({title,publisher:'telegraph'}),f=result.diagnostic.form;
 assert.equal(f.visibilityBasis,'markup-only');assert.equal(f.totalSelects,2);assert.equal(f.totalControls,6);assert.equal(f.headlineSelection,null);assert.equal(f.selects.length,1);assert.equal(f.selects[0].visibility,'hidden');assert.deepEqual(f.selects[0].options,[{value:'alltext',label:'All Text'},{value:'TI_OBSERVED',label:'Title'}]);assert.deepEqual(f.controls.find(c=>c.name==='fld-base-1'),{name:'fld-base-1',id:'edit-fld-base-1',tag:'input',type:'hidden',visibility:'hidden',disabled:false});assert.deepEqual(queries,['"Fictional volunteers inspect river crossings"','"fictional" AND "volunteers" AND "inspect" AND "river" AND "crossings"']);assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|csrf|unknown_provider/);
});

test('Times keeps its existing term query when no visible unique headline field is observed',async()=>{
 const title='Fictional volunteers inspect river crossings',queries=[],{client}=clientFor({[collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{queries.push(new URL(url).searchParams.get('query'));return html('<p>No results found.</p>');}}),result=await client.lookup({title,publisher:'times'});assert.equal(result.status,'not_found');assert.deepEqual(queries,['"fictional" "volunteers" "inspect"']);assert.equal(result.diagnostic.form.totalSelects,0);assert.equal(result.diagnostic.form.controls[0].name,'query');
});

test('Telegraph AllText fallback retains up to twelve distinct headline terms rather than a broad three-word subset',async()=>{
 const title='Fictional university professor disputes controversial plagiarism allegations following independent academic review during summer publication debate',entry='https://infoweb.newsbank.com/apps/news/?p=UKNB',queries=[],{client}=clientFor({[entry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{queries.push(new URL(url).searchParams.get('query'));return html('<p>No results found.</p>');}}),result=await client.lookup({title,publisher:'telegraph'});
 assert.equal(result.status,'not_found');assert.equal(queries[0],'"'+title+'"');assert.deepEqual(queries[1].split(' AND '),['"fictional"','"university"','"professor"','"disputes"','"controversial"','"plagiarism"','"allegations"','"following"','"independent"','"academic"','"review"','"during"']);assert.equal(queries.length,2);assert(queries.every(q=>q.length<=420));assert.equal(result.diagnostic.form.headlineSelection,null);
});

const pagingTitle='Fictional volunteers inspect local river crossings',pagingEntry='https://infoweb.newsbank.com/apps/news/?p=UKNB';
const pagingHit=(id,title=pagingTitle,date='June 5, 2024')=>`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/${id}">${title}</a></h3><ul><li>Daily Telegraph (London, England) ${date}</li></ul><p>NEVER_RETURN_PAGED_EXCERPT</p></div>`;
const pagingNext=url=>`<a rel="next" href="${url.replace(/&/g,'&amp;')}">Next page</a>`;

test('native observed Next uses GET after a normal POST, deduplicates records and stops at a strict page-two match',async()=>{
 const weak='Unrelated traffic planning cabinet announcement',doc=article.replace('Did Zombie tag take over London streets?',pagingTitle).replace('The Times','Daily Telegraph (London, England)');
 const {client,calls}=clientFor({[pagingEntry]:html(searchPage.replace('method="GET"','method="POST"')),'https://infoweb.newsbank.com/apps/news/search':({url,options})=>{const u=new URL(url);if(!u.searchParams.has('cursor')){assert.equal(options.method,'POST');assert.equal(options.body.get('query'),'"'+pagingTitle+'"');return html(pagingHit('ABC123',weak)+pagingNext('/apps/news/search?p=UKNB&cursor=two'));}assert.equal(u.searchParams.get('cursor'),'two');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return html(pagingHit('ABC123',weak)+pagingHit('DEF456')+pagingNext('/apps/news/search?p=UKNB&cursor=three'));},'https://infoweb.newsbank.com/apps/news/document-view':({url})=>{assert.equal(new URL(url).searchParams.get('docref'),'news/DEF456');return html(doc);}});
 const result=await client.lookup({title:pagingTitle,date:'2024-06-05',publisher:'telegraph'});assert.equal(result.status,'found');assert.equal(result.article.title,pagingTitle);assert.equal(calls.length,4);assert.equal(calls.some(c=>new URL(c.url).searchParams.get('cursor')==='three'),false);
});

test('Next links cannot leave the exact approved search scope or open a document or authentication URL',async()=>{
 const bad=['https://evil.example/apps/news/search?page=2','https://infoweb.newsbank.com.evil.example/apps/news/search?page=2','https://user:secret@infoweb.newsbank.com/apps/news/search?page=2','http://infoweb.newsbank.com/apps/news/search?page=2','https://arthur.newsbank.com/library-card','/apps/news/document-view?p=UKNB&docref=news/ABC123','/apps/news/search?p=OTHER&page=2','/apps/news/search?p=UKNB&docref=news/ABC123','javascript:alert(1)'];
 for(const next of bad){const {client,calls}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext(next))}),result=await client.lookup({title:pagingTitle,date:'2024-06-05',publisher:'telegraph'});assert.equal(result.status,'not_found');assert.equal(calls.length,3);assert(result.diagnostic.queries.every(q=>q.pageCount===1&&q.pagingStop==='unapproved_next'&&q.truncated));assert.doesNotMatch(JSON.stringify(result),/evil\.example|user:secret|alert\(|cursor|NEVER_RETURN/);}
});

test('pagination loops stop without replaying visited pages and canonical duplicate records count only once',async()=>{
 const first=new Map(),{client,calls}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{const u=new URL(url),query=u.searchParams.get('query');if(!u.searchParams.has('cursor')){first.set(query,url);return html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext('/apps/news/search?p=UKNB&cursor=two&query='+encodeURIComponent(query)));}return html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext(first.get(query)));}}),result=await client.lookup({title:pagingTitle,date:'2024-06-05',publisher:'telegraph'});
 assert.equal(result.status,'not_found');assert.equal(calls.length,5);for(const q of result.diagnostic.queries){assert.equal(q.pageCount,2);assert.equal(q.inspectedCount,2);assert.equal(q.eligibleCount,1);assert.equal(q.candidates.length,1);assert.equal(q.pagingStop,'loop');assert.equal(q.truncated,true);}assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|cursor/);
});

test('pagination is bounded to three pages and sixty inspected hits per query without guessing a fourth page',async()=>{
 const {client,calls}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{const u=new URL(url),page=Number(u.searchParams.get('cursor')||0);assert(page<3);return html(Array.from({length:20},(_,i)=>pagingHit((1000+page*20+i).toString(16).toUpperCase(),pagingTitle,'June 1, 2024')).join('')+'<div role="status">200 results</div>'+pagingNext('/apps/news/search?p=UKNB&cursor='+(page+1)));}}),result=await client.lookup({title:pagingTitle,date:'2024-06-05',publisher:'telegraph'});
 assert.equal(result.status,'not_found');assert.equal(calls.length,7);assert.equal(result.diagnostic.queries.length,2);for(const q of result.diagnostic.queries){assert.equal(q.pageCount,3);assert.equal(q.inspectedCount,60);assert.equal(q.totalResults,60);assert.equal(q.eligibleCount,60);assert.equal(q.candidates.length,5);assert.equal(q.pagingStop,'page_limit');assert.equal(q.truncated,true);assert.equal(q.resultPage.resultCount,200);}assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|cursor/);
});

test('pagination redirects cannot leave the same ordinary search path and final record checks remain mandatory',async()=>{
 const {client,calls}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>new URL(url).searchParams.has('cursor')?html('',302,{location:'/apps/news/document-view?p=UKNB&docref=news/ABC123'}):html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext('/apps/news/search?p=UKNB&cursor=two'))}),result=await client.lookup({title:pagingTitle,publisher:'telegraph'});assert.equal(result.status,'needs_interaction');assert.equal(calls.length,3);assert.equal(calls.some(c=>new URL(c.url).pathname==='/apps/news/document-view'),false);
 const second=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>new URL(url).searchParams.has('cursor')?html(pagingHit('DEF456')):html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext('/apps/news/search?p=UKNB&cursor=two')),'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('Did Zombie tag take over London streets?',pagingTitle).replace('The Times','Belfast Telegraph'))}),rejected=await second.client.lookup({title:pagingTitle,date:'2024-06-05',publisher:'telegraph'});assert.equal(rejected.status,'not_found');assert.match(rejected.reason,/publication did not verify/);assert.equal(rejected.diagnostic.stage,'document');assert.equal(rejected.diagnostic.queries[0].pageCount,2);assert.doesNotMatch(JSON.stringify(rejected),/First paragraph|NEVER_RETURN/);
});

test('a pagination redirect back to an inspected URL is refused before that page is fetched again',async()=>{
 let first='';const {client,calls}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{if(new URL(url).searchParams.has('cursor'))return html('',302,{location:first});first=url;return html(pagingHit('ABC123','Unrelated traffic planning cabinet announcement')+pagingNext('/apps/news/search?p=UKNB&cursor=two'));}}),result=await client.lookup({title:pagingTitle,publisher:'telegraph'});assert.equal(result.status,'not_found');assert.equal(calls.length,5);assert(result.diagnostic.queries.every(q=>q.pageCount===1&&q.pagingStop==='loop'&&q.truncated));
});

test('only a qualifying literal URL-word hint uses an ordered quoted tail instead of the generic AND fallback',async()=>{
 for(const [publisher,title,hint,tail] of [['telegraph','Cambridges diversity poster boy in plagiarism row',true,true],['telegraph','Cambridges diversity poster boy in plagiarism row',false,false],['telegraph','Cambridges diversity poster boy in plagiarism row','true',false],['telegraph','Cambridge diversity poster boy in plagiarism row',true,false],['telegraph','Cambridges diversity poster boy plagiarism',true,false],['times','Cambridges diversity poster boy in plagiarism row',true,false]]){
  const queries=[],{client}=clientFor({[publisher==='telegraph'?pagingEntry:collection]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{queries.push(new URL(url).searchParams.get('query'));return html('<p>No results found.</p>');}});const result=await client.lookup({title,publisher,urlWordsHint:hint});if(publisher==='times'){assert.deepEqual(queries,['"cambridges" "diversity" "poster"']);continue;}assert.equal(queries[0],'"'+title+'"');assert.equal(queries[1].includes(' AND '),!tail);if(tail)assert.equal(queries[1],'"diversity poster boy in plagiarism row"');assert.equal(queries.length,2);assert.equal(result.diagnostic.requested.title,title);
 }
});

test('URL-word tail phrase keeps stopwords and order while final matching still uses the original full title',async()=>{
 const title='Cambridges diversity poster boy in plagiarism row',observed='Cambridge’s diversity poster boy in plagiarism row',queries=[],{client}=clientFor({[pagingEntry]:html(searchPage),'https://infoweb.newsbank.com/apps/news/search':({url})=>{queries.push(new URL(url).searchParams.get('query'));return html(queries.length===1?'<p>No results found.</p>':pagingHit('ABC123',observed));},'https://infoweb.newsbank.com/apps/news/document-view':html(article.replace('Did Zombie tag take over London streets?',observed).replace('The Times','Daily Telegraph (London, England)'))}),result=await client.lookup({title,date:'2024-06-05',publisher:'telegraph',urlWordsHint:true});
 assert.deepEqual(queries,['"Cambridges diversity poster boy in plagiarism row"','"diversity poster boy in plagiarism row"']);assert.equal(result.status,'found');assert.equal(result.article.title,observed);assert.equal(rankMatches(title,[{title:observed}])[0].score,10/12);
});
