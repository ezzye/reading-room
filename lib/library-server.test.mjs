import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {librarySettingsAPI,lookupNewsBankSource,timesMetadata,libraryMetadata} from './library-server.ts';
import {openLibrary} from './library-vault.mjs';

const origin='https://reader.example',owner='owner@example.org',vaultKey='47'.repeat(32);
const timesURL='https://thetimes.com/fictional/story/article/synthetic-times-headline-abcdefghi';
const title='A fictional Times headline about community gardens';
const collection='https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB&t=favorite%3ALSTBLETW%21The%20London%20Times%20Collection';
const libraryLink='<a href="/library-card?d=collection">Log in with library credentials</a>';
const loginPage='<html><head><title>NewsBank InfoWeb | Login</title><meta http-equiv="Content-Security-Policy" content="connect-src https://*.awswaf.com"></head><body>'+libraryLink+'</body></html>';
const loginForm='<form action="/login-libcard" method="POST" enctype="multipart/form-data"><input name="library"><input name="card"><input type="hidden" name="d" value="collection"></form>';
const searchPage='<form action="/apps/news/search" method="GET"><input id="edit-val-base-0" name="query"><input type="hidden" name="p" value="UKNB"></form>';
const article=`<div id="document-view--ascii"><h1>${title}</h1><div class="document-view__meta">Author/Byline: Synthetic Author 8 Words The Times October 17, 2026</div><div class="document-view__body--ascii">${Array.from({length:4},(_,i)=>`<p>Synthetic article paragraph ${i+1} contains fictional text for server integration testing only.</p>`).join('')}</div></div>`;
const html=(text,status=200,headers={})=>new Response(status>=300&&status<400?null:text,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
function db(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_kind_onslaught.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../drizzle/0001_overrated_the_leader.sql',import.meta.url),'utf8'));return {sql,prepare(q){const s=sql.prepare(q);return {bind(...a){return {first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)}),run:async()=>s.run(...a)}},first:async()=>s.get()||null,all:async()=>({results:s.all()}),run:async()=>s.run()};}};}
function config(DB,extra={}){return {DB,READER_OWNER_EMAIL:owner,RR_LIBRARY_VAULT_KEY:vaultKey,DEEPSEEK_API_KEY:'synthetic-deepseek-key',...extra};}
function request(method='GET',body,headers={}){return new Request(origin+'/api/library-settings',{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
const ownerHeaders={'oai-authenticated-user-email':owner,Origin:origin,'X-Reading-Room':'1','Content-Type':'application/json'};
function provider({publicPage=true,searchResults=true,credentials='synthetic-card-123'}={}){
 const calls=[];let posts=0;
 const fetcher=async(url,init={})=>{
  calls.push({url,init});const u=new URL(url);
  if(u.hostname==='thetimes.com')return publicPage?html(`<html><head><meta property="article:published_time" content="2026-10-17T09:00:00Z"></head><body><h1>${title}</h1></body></html>`):new Response('unavailable',{status:503,headers:{'content-type':'text/html'}});
  if(u.hostname==='api.deepseek.com')return Response.json({results:[{url:timesURL,title}]});
  if(u.hostname==='arthur.newsbank.com'){
   if(u.pathname==='/')return html(loginPage);
   if(u.pathname==='/library-card')return html(loginForm);
   if(u.pathname==='/login-libcard'){posts++;assert.equal(init.method,'POST');assert.ok(init.body instanceof FormData);assert.equal(init.body.get('card'),credentials);return html('',302,{location:collection,'set-cookie':'nb-session=synthetic; Domain=.newsbank.com; Path=/; Secure'});}
  }
  if(u.hostname==='infoweb.newsbank.com'){
   if(u.pathname==='/apps/news/browse-multi')return init.headers?.get?.('cookie')?.includes('nb-session=synthetic')?html(searchPage):html('',302,{location:'https://arthur.newsbank.com/?d=collection'});
   if(u.pathname==='/apps/news/search')return searchResults?html(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF1234">${title}</a></h3><ul><li>October 17, 2026</li></ul></div>`):html('<div class="search-hits__hit"><h3><a href="https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&amp;docref=news/DEADBEEF">${title}</a></h3></div>');
   if(u.pathname==='/apps/news/document-view')return html(article);
  }
  throw new Error('Unexpected synthetic fetch '+u.href);
 };
 return {fetcher,calls,postCount:()=>posts};
}

async function connect(DB,p){const response=await librarySettingsAPI(request('POST',{action:'connect',consent:true,cardNumber:'synthetic-card-123'},ownerHeaders),config(DB),p.fetcher);return response;}
function savedPage(DB,document,pageTitle='Independent AI page title',createdAt='2026-10-17T10:00:00Z'){
 const id=crypto.randomUUID();DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES (?,?,?,?,?,?)').run(id,id,timesURL,pageTitle,JSON.stringify(document),createdAt);
}

test('owner setup is same-origin, consent gated, and never posts without a vault key',async()=>{
 const DB=db(),p=provider();
 assert.equal((await librarySettingsAPI(request('POST',{action:'connect',consent:true,cardNumber:'synthetic-card-123'},{...ownerHeaders,'oai-authenticated-user-email':'other@example.org'}),config(DB),p.fetcher)).status,403);
 assert.equal((await librarySettingsAPI(request('POST',{action:'connect',consent:true,cardNumber:'synthetic-card-123'},{...ownerHeaders,Origin:'https://attacker.example'}),config(DB),p.fetcher)).status,403);
 assert.equal((await librarySettingsAPI(request('POST',{action:'connect',consent:true,cardNumber:'synthetic-card-123'},ownerHeaders),config(DB,{RR_LIBRARY_VAULT_KEY:''}),p.fetcher)).status,503);
 assert.equal((await librarySettingsAPI(request('POST',{action:'connect',consent:false,cardNumber:'synthetic-card-123'},ownerHeaders),config(DB),p.fetcher)).status,400);
 assert.equal(p.postCount(),0);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_library_connections').get().n,0);
});

test('connect stores ciphertext and settings never disclose card details or cookies',async()=>{
 const DB=db(),p=provider(),response=await connect(DB,p);assert.equal(response.status,200);assert.deepEqual(await response.json(),{connected:true,desktopRequired:false});assert.equal(p.postCount(),1);
 const row=DB.sql.prepare("SELECT encrypted,state FROM rr_library_connections WHERE id='camden'").get();assert.equal(row.state,'connected');assert.doesNotMatch(row.encrypted,/synthetic-card-123|nb-session|synthetic/);
 const settings=await librarySettingsAPI(request('GET',undefined,ownerHeaders),config(DB),p.fetcher),text=await settings.text();assert.equal(settings.status,200);assert.match(text,/"configured":true/);assert.doesNotMatch(text,/synthetic-card-123|nb-session|cookies|cardNumber/);
});

test('lookup reuses the persisted encrypted NewsBank session',async()=>{
 const DB=db(),p=provider();assert.equal((await connect(DB,p)).status,200);const posts=p.postCount(),result=await lookupNewsBankSource(timesURL,config(DB),p.fetcher);
 assert.equal(result.title,title);assert.equal(result.originalTitle,title);assert.equal(result.originalURL,timesURL);assert.equal(result.paragraphs.length,4);assert.equal(p.postCount(),posts);
 assert.equal(p.calls.filter(x=>new URL(x.url).hostname==='infoweb.newsbank.com').some(x=>x.init.headers?.get?.('cookie')?.includes('nb-session=synthetic')),true);
});

test('expired saved session performs one ordinary reauthentication and refreshes expiry',async()=>{
 const DB=db(),p=provider();await connect(DB,p);const row=DB.sql.prepare("SELECT encrypted FROM rr_library_connections WHERE id='camden'").get(),saved=await openLibrary(vaultKey,row.encrypted);
 saved.session.cookies=saved.session.cookies.map(c=>({...c,expires:Date.now()-10_000}));const {sealLibrary}=await import('./library-vault.mjs');DB.sql.prepare("UPDATE rr_library_connections SET encrypted=? WHERE id='camden'").run(await sealLibrary(vaultKey,saved));
 const before=p.postCount(),result=await lookupNewsBankSource(timesURL,config(DB),p.fetcher);assert.equal(result.title,title);assert.equal(p.postCount()-before,1);
});

test('publisher metadata wins; public-search fallback requires the exact Times URL',async()=>{
 const DB=db(),exact=provider(),meta=await timesMetadata(timesURL,config(DB),exact.fetcher);assert.equal(meta.title,title);assert.equal(meta.date,'2026-10-17');assert.equal(meta.basis,'publisher headline');
 const fallback=provider({publicPage:false}),found=await timesMetadata(timesURL,config(DB),fallback.fetcher);assert.equal(found.title,title);assert.equal(found.basis,'exact-URL public search headline');
 const wrong=provider({publicPage:false});wrong.fetcher=async(url,init)=>{if(new URL(url).hostname==='api.deepseek.com')return Response.json({results:[{url:timesURL.replace('abcdefghi','123456789'),title}]});return fallback.fetcher(url,init);};
 await assert.rejects(()=>timesMetadata(timesURL,config(DB),wrong.fetcher),/headline could not be verified/);
 await assert.rejects(()=>timesMetadata('https://example.org/article',config(DB),exact.fetcher),/Only ordinary Times article URLs/);
});

test('AI educational page titles never identify the original Times reporting',async()=>{
 const DB=db(),p=provider();savedPage(DB,{title:'An independently generated education topic',facts:[],sources:[]},'An independently generated education topic');
 const meta=await timesMetadata(timesURL,config(DB),p.fetcher);assert.equal(meta.title,title);assert.equal(meta.date,'2026-10-17');assert.equal(meta.basis,'publisher headline');
 assert(p.calls.some(x=>new URL(x.url).hostname==='thetimes.com'));
});

test('stored library capture uses its source headline boundary and retains the known date',async()=>{
 const DB=db(),sourceHeadline='A fictional Times headline about community gardens',subtitle='A standfirst supplied separately by the library';
 savedPage(DB,{kind:'rendered-capture-v1',capture:{url:timesURL,title:sourceHeadline+' - '+subtitle,date:'October 17, 2026',presentation:{method:'library-text'},diagnostics:{libraryTextEdition:true,libraryURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABCDEF1234'}}},'This table title must not become the source headline');
 savedPage(DB,{title:'A newer AI education title',facts:[]},'A newer AI education title','2026-10-17T11:00:00Z');
 const meta=await timesMetadata(timesURL,config(DB),async()=>{throw Error('Stored source metadata should avoid network requests');});
 assert.deepEqual(meta,{title:sourceHeadline,date:'2026-10-17',basis:'previously matched edition'});
});

test('legacy library studies use verified source metadata rather than their generated title',async()=>{
 const DB=db();savedPage(DB,{kind:'library-study-v1',title:'An AI generated study title',source:{originalURL:timesURL,title:title+' - A library standfirst',date:'17 Oct 2026',url:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABCDEF1234'}},'An AI generated study title');
 assert.deepEqual(await timesMetadata(timesURL,config(DB),async()=>{throw Error('No network expected');}),{title,date:'2026-10-17',basis:'previously matched edition'});
});

test('a stored capture with a different source identity cannot prevent publisher verification',async()=>{
 const DB=db(),p=provider();savedPage(DB,{kind:'rendered-capture-v1',capture:{url:timesURL.replace('abcdefghi','123456789'),title:'A different article about another community',date:'2026-10-16'}});
 const meta=await timesMetadata(timesURL,config(DB),p.fetcher);assert.equal(meta.title,title);assert.equal(meta.basis,'publisher headline');
});

test('an unverified headline cannot trigger a NewsBank substitution',async()=>{
 const DB=db(),p=provider();await connect(DB,p);const otherURL=timesURL.replace('abcdefghi','123456789');
 const originalFetch=p.fetcher;p.fetcher=async(url,init)=>{p.calls.push({url,init});if(new URL(url).hostname==='thetimes.com')return new Response('unavailable',{status:503,headers:{'content-type':'text/html'}});if(new URL(url).hostname==='api.deepseek.com')return Response.json({results:[{url:otherURL,title}]});return originalFetch(url,init);};
 const before=p.calls.filter(x=>new URL(x.url).hostname==='infoweb.newsbank.com').length;
 await assert.rejects(()=>lookupNewsBankSource(timesURL,config(DB),p.fetcher),/headline could not be verified/);
 assert.equal(p.calls.filter(x=>new URL(x.url).hostname==='infoweb.newsbank.com').length,before);
});

 test('Telegraph HTTP402 uses exact public search metadata then the general Camden collection',async()=>{
 const DB=db(),p=provider();await connect(DB,p);const url='https://telegraph.co.uk/world-news/2026/10/17/fictional-historic-clock-tower-protests/';const headline='A fictional historic clock tower falls during protests';
 const original=p.fetcher;let general=0;
 const fetcher=async(address,init)=>{const u=new URL(address);if(u.hostname==='telegraph.co.uk')return new Response('Payment required',{status:402,headers:{'content-type':'text/html'}});if(u.hostname==='api.deepseek.com')return Response.json({results:[{url,title:headline}]});if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/'){general++;return html(searchPage);}if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/search')return html(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF1234">${headline}</a></h3><ul><li>The Daily Telegraph (London, England) October 17, 2026</li></ul></div>`);if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/document-view')return html(article.replaceAll(title,headline).replace('The Times October','The Daily Telegraph (London, England) October'));return original(address,init);};
 const metadata=await libraryMetadata(url,config(DB),fetcher);assert.equal(metadata.title,headline);assert.equal(metadata.date,'2026-10-17');
 const result=await lookupNewsBankSource(url,config(DB),fetcher);assert.equal(result.originalURL,url);assert.match(result.publication,/Telegraph/);assert.equal(result.title,headline);assert.equal(general,1);
});

const telegraphMetadataURL='https://telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/';
const telegraphMetadataTitle='Historic clock tower falls as France burns on day of violent protests';
test('public fetch uses only exact-URL title metadata, strips publisher suffix, and needs no index query',async()=>{
 const DB=db(),calls=[];const result=await libraryMetadata(telegraphMetadataURL,config(DB),async(url,init)=>{calls.push(url);if(!url.includes('api.deepseek.com'))return html('Access Issue Help',402);assert.match(url,/tools\/fetch$/);assert.deepEqual(JSON.parse(init.body),{url:telegraphMetadataURL});return Response.json({url:telegraphMetadataURL.replace('https://','https://www.').replace(/\/$/,''),title:telegraphMetadataTitle+' - The Telegraph',content:'Never consume this body or treat it as article reporting.'});});
 assert.equal(result.title,telegraphMetadataTitle);assert.equal(result.date,'2026-10-17');assert.equal(result.basis,'exact-URL public fetch headline');assert.equal(calls.filter(x=>x.includes('api.deepseek.com')).length,1);assert.equal(result.content,undefined);
});
test('missing or changed fetch identity cannot verify a headline; bounded index fallback preserves the long slug ending',async()=>{
 for(const fetchedURL of [undefined,telegraphMetadataURL.replace('mass-protests','different-report')]){
  const DB=db(),queries=[];const result=await libraryMetadata(telegraphMetadataURL,config(DB),async(url,init)=>{if(!url.includes('api.deepseek.com'))return html('Access Issue Help',402);if(url.endsWith('/fetch'))return Response.json({url:fetchedURL,title:'An unrelated but plausible source headline'});queries.push(JSON.parse(init.body).query);return Response.json({results:queries.length===1?[]:[{url:telegraphMetadataURL.replace('https://','https://www.').replace(/\/$/,''),title:telegraphMetadataTitle+' | Telegraph'}]});});
  assert.equal(result.title,telegraphMetadataTitle);assert.equal(queries.length,2);for(const query of queries){assert.ok(query.length<=128);assert.match(query,/mass protests$/);}
 }
});
test('unavailable metadata returns a structured headline-needed error and never accepts a slug or access-error title',async()=>{
 const DB=db(),calls=[];await assert.rejects(()=>libraryMetadata(telegraphMetadataURL,config(DB),async(url,init)=>{calls.push(url);if(!url.includes('api.deepseek.com'))return html('<h1>Access Issue Help</h1>');if(url.endsWith('/fetch'))return Response.json({url:telegraphMetadataURL,title:'Access Issue Help'});return Response.json({results:[{url:telegraphMetadataURL.replace('mass-protests','other-story'),title:telegraphMetadataTitle}]});}),error=>error.code==='headline_unverified'&&error.needsHeadline===true&&Array.isArray(error.metadataAttempts));assert.equal(calls.filter(x=>x.endsWith('/fetch')).length,1);assert.equal(calls.filter(x=>x.endsWith('/search')).length,2);
});
test('reader headline hint avoids public-network calls but remains explicitly unverified metadata',async()=>{
 const DB=db();const meta=await libraryMetadata(telegraphMetadataURL,config(DB),async()=>{throw Error('No public call expected');},telegraphMetadataTitle);assert.equal(meta.title,telegraphMetadataTitle);assert.equal(meta.basis,'reader-supplied headline; library match required');assert.equal(meta.date,'2026-10-17');
});
test('a wrong reader hint fails the final library match instead of substituting an article',async()=>{
 const DB=db(),p=provider();await connect(DB,p);const before=p.calls.length;await assert.rejects(()=>lookupNewsBankSource(timesURL,config(DB),p.fetcher,'Completely unrelated football results during another season'),/unambiguous|matching|same/i);assert.equal(p.calls.slice(before).some(x=>new URL(x.url).hostname==='thetimes.com'||new URL(x.url).hostname==='api.deepseek.com'),false);
});
