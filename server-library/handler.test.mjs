import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from './handler.mjs';

const collection='https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB&t=favorite%3ALSTBLETW%21The%20London%20Times%20Collection';
const libraryName='CamdenLibraries',cardNumber='synthetic-card-123',title='A fictional Times headline about community gardens';
const loginPage='<html><head><title>NewsBank InfoWeb | Login</title></head><body><a href="/library-card?d=collection">Log in with library credentials</a></body></html>';
const form='<form action="/login-libcard" method="POST" enctype="multipart/form-data"><input name="library"><input name="card"><input type="hidden" name="d" value="synthetic-target"></form>';
const searchPage='<form action="/apps/news/search" method="GET"><input id="edit-val-base-0" name="query"><input type="hidden" name="p" value="UKNB"></form>';
const article=`<div id="document-view--ascii"><h1>${title}</h1><div class="document-view__meta">Author/Byline: Synthetic Reporter 8 Words The Times October 17, 2026</div><div class="document-view__body--ascii"><p>First fictional paragraph for the Lambda adapter test.</p><p>Second fictional paragraph for the Lambda adapter test.</p><p>Third fictional paragraph for the Lambda adapter test.</p></div></div>`;
const html=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
function fixture({probeStatus=200}={}){
 const calls=[];let posts=0;
 const fetch=async(url,init={})=>{
  const u=new URL(url);calls.push({url,init});
  if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/browse-multi'){
   if(probeStatus!==200&&calls.length===1)return new Response(null,{status:probeStatus});
   if(init.headers?.get?.('cookie')?.includes('nb=synthetic'))return html(searchPage);
   return html('',302,{location:'https://arthur.newsbank.com/?d=collection'});
  }
  if(u.hostname==='arthur.newsbank.com'){
   if(u.pathname==='/')return html(loginPage);
   if(u.pathname==='/library-card')return html(form);
   if(u.pathname==='/login-libcard'){
    posts++;assert.equal(init.method,'POST');assert.equal(init.body.get('library'),libraryName);assert.equal(init.body.get('card'),cardNumber);
    return html('',302,{location:collection,'set-cookie':'nb=synthetic; Domain=.newsbank.com; Path=/; Secure'});
   }
  }
  if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/search')return html(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF1234">${title}</a></h3><ul><li>October 17, 2026</li></ul></div>`);
  if(u.hostname==='infoweb.newsbank.com'&&u.pathname==='/apps/news/document-view')return html(article);
  throw new Error('Unexpected fixture URL: '+u.href);
 };
 return {fetch,calls,postCount:()=>posts};
}

test('probe makes only a normal public GET and classifies an upstream 403',async()=>{
 const f=fixture({probeStatus:403}),result=await handler({action:'probe'},{fetch:f.fetch});
 assert.deepEqual(result,{status:'blocked',httpStatus:403});assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,collection);assert.equal(f.calls[0].init.method,'GET');assert.equal(f.calls[0].init.redirect,'manual');assert.equal(f.postCount(),0);
});

test('probe confirms the ordinary login form after redirects without submitting even supplied credentials',async()=>{
 const f=fixture(),result=await handler({action:'probe',libraryName,cardNumber},{fetch:f.fetch});
 assert.deepEqual(result,{status:'available',httpStatus:200,loginForm:true});assert.equal(f.calls.length,3);assert.equal(f.postCount(),0);
 assert(f.calls.every(({init})=>init.method==='GET'&&init.body===undefined));
 assert.doesNotMatch(JSON.stringify(result),/synthetic-card|synthetic-target|cookies|session|library-card|<form/);
});

test('probe does not report availability when the redirected login destination returns 403',async()=>{
 const f=fixture(),base=f.fetch;f.fetch=async(url,init)=>new URL(url).hostname==='arthur.newsbank.com'?html('Private denial diagnostics',403):base(url,init);
 const result=await handler({action:'probe'},{fetch:f.fetch});assert.deepEqual(result,{status:'blocked',httpStatus:403});assert.equal(f.postCount(),0);
});

test('normal connect and lookup preserve only the safe provider denial status',async()=>{
 for(const action of ['connect','lookup']){
  const f=fixture({probeStatus:403}),result=await handler({action,libraryName,cardNumber,title},{fetch:f.fetch});
  assert.deepEqual(result,{status:'blocked',httpStatus:403});assert.equal(f.calls.length,1);assert.equal(f.postCount(),0);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-card|synthetic-target|cookie|session|<html/);
 }
});

test('connect uses only the ordinary library form and returns an opaque cookie session',async()=>{
 const f=fixture(),result=await handler({action:'connect',libraryName,cardNumber},{fetch:f.fetch});
 assert.equal(result.status,'authenticated');assert.equal(f.postCount(),1);assert.ok(result.session.cookies.some(c=>c.name==='nb'));
 assert.doesNotMatch(JSON.stringify(result),/synthetic-card-123/);assert(f.calls.every(c=>['arthur.newsbank.com','infoweb.newsbank.com'].includes(new URL(c.url).hostname)));
});

test('lookup reuses supplied session, ignores arbitrary URL fields, and returns bounded article plus refreshed session',async()=>{
 const f=fixture(),connected=await handler({action:'connect',libraryName,cardNumber},{fetch:f.fetch});f.calls.length=0;
 const result=await handler({action:'lookup',libraryName,cardNumber,title,date:'2026-10-17',session:connected.session,url:'https://attacker.example/private'},{fetch:f.fetch});
 assert.equal(result.status,'found');assert.equal(result.article.title,title);assert.equal(result.article.paragraphs.length,3);assert.equal(result.article.libraryURL,'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABCDEF1234');assert.ok(result.session.cookies.some(c=>c.name==='nb'));assert.equal(f.postCount(),1);
 assert(f.calls.every(c=>['arthur.newsbank.com','infoweb.newsbank.com'].includes(new URL(c.url).hostname)));
});

test('lookup performs one normal reauthentication after session expiry',async()=>{
 const f=fixture(),expired={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'expired',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:Date.now()-1000}]};
 const result=await handler({action:'lookup',libraryName,cardNumber,title,session:expired},{fetch:f.fetch});
 assert.equal(result.status,'found');assert.equal(f.postCount(),1);
});

test('oversized article text is refused without returning a partial source',async()=>{
 const f=fixture(),connected=await handler({action:'connect',libraryName,cardNumber},{fetch:f.fetch}),base=f.fetch;
 f.fetch=async(url,init)=>new URL(url).pathname==='/apps/news/document-view'
  ?html(`<div id="document-view--ascii"><h1>${title}</h1><div class="document-view__meta">The Times</div><div class="document-view__body--ascii"><p>${'Synthetic test text '.repeat(400)}</p><p>${'Synthetic test text '.repeat(400)}</p><p>${'Synthetic test text '.repeat(400)}</p></div></div>`)
  :base(url,init);
 const result=await handler({action:'lookup',libraryName,cardNumber,title,session:connected.session},{fetch:f.fetch});assert.deepEqual(result,{status:'error',code:'article_too_large'});
});

test('refuses oversized payloads, missing credentials, and unsupported actions before network access',async()=>{
 const f=fixture();assert.equal((await handler({action:'connect',libraryName,cardNumber:'x'.repeat(30_000)},{fetch:f.fetch})).code,'request_too_large');
 assert.equal((await handler({action:'connect',libraryName},{fetch:f.fetch})).code,'missing_credentials');
 assert.equal((await handler({action:'admin'},{fetch:f.fetch})).code,'unsupported_action');assert.equal(f.calls.length,0);
});

test('a NewsBank challenge remains an interaction result',async()=>{
 const f=fixture();f.fetch=async(url,init)=>{f.calls.push({url,init});return html('<html><body><h1>Verify you are human</h1></body></html>');};
 const result=await handler({action:'connect',libraryName,cardNumber},{fetch:f.fetch});assert.equal(result.status,'needs_interaction');assert.equal(f.postCount(),0);
});

test('Telegraph lookup uses general NewsBank entry and returns only verified London publication',async()=>{
 const calls=[];
 const fetch=async(url,init)=>{
  calls.push({url,init});const u=new URL(url);
  if(u.pathname==='/apps/news/')return html(searchPage);
  if(u.pathname==='/apps/news/search')return html(`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF1234">${title}</a></h3><ul><li>Daily Telegraph (London, England)</li><li>October 17, 2026</li></ul></div>`);
  if(u.pathname==='/apps/news/document-view')return html(article.replace('The Times','Daily Telegraph (London, England)'));
  throw Error('Unexpected fixture request');
 };
 const result=await handler({action:'lookup',publisher:'telegraph',libraryName,cardNumber,title,date:'2026-10-17'},{fetch});
 assert.equal(result.status,'found');assert.match(result.article.publication,/Daily Telegraph.*London, UK/);assert.equal(result.article.paragraphs.length,3);
 assert.equal(calls[0].url,'https://infoweb.newsbank.com/apps/news/?p=UKNB');assert.equal(calls.length,3);
});

test('Lambda rejects an unknown requested publisher before network access',async()=>{
 const f=fixture();const result=await handler({action:'lookup',publisher:'belfast',libraryName,cardNumber,title},{fetch:f.fetch});
 assert.deepEqual(result,{status:'error',code:'invalid_publisher'});assert.equal(f.calls.length,0);
});

test('not_found Lambda response includes bounded match metadata only and no session or article content',async()=>{
 const f=fixture(),connected=await handler({action:'connect',libraryName,cardNumber},{fetch:f.fetch}),base=f.fetch;
 f.fetch=async(url,init)=>new URL(url).pathname==='/apps/news/search'?html(Array.from({length:24},(_,i)=>`<div class="search-hits__hit"><h3><a href="/apps/news/document-view?p=UKNB&amp;docref=news/${(1000+i).toString(16).toUpperCase()}&amp;token=NEVER_RETURN_TOKEN">${title}</a></h3><ul><li>The Times October 15, 2026</li></ul><p>NEVER_RETURN_SOURCE_PARAGRAPH</p></div>`).join('')):base(url,init);
 const result=await handler({action:'lookup',libraryName,cardNumber,title,date:'2026-10-17',session:connected.session},{fetch:f.fetch});
 assert.equal(result.status,'not_found');assert.match(result.reason,/unambiguous/);assert.deepEqual(Object.keys(result).sort(),['diagnostic','reason','status']);const q=result.diagnostic.queries[0];assert.equal(q.totalResults,24);assert.equal(q.inspectedCount,20);assert.equal(q.truncated,true);assert.equal(q.candidates.length,5);assert.equal(q.candidates[0].score,.65);assert.equal(q.candidates[0].publicationVerification,'verified');assert.doesNotMatch(JSON.stringify(result),/NEVER_RETURN|synthetic-card|cookies|session|paragraphs|<|>/);assert(new TextEncoder().encode(JSON.stringify(result)).length<30000);
});

test('Lambda forwards only the literal boolean URL-word hint while retaining original ranking headline',async()=>{
 const requested='Cambridges diversity poster boy in plagiarism row';for(const hint of [true,false,'true']){const queries=[],fetch=async(url)=>new URL(url).pathname==='/apps/news/'?html(searchPage):(queries.push(new URL(url).searchParams.get('query')),html('<p>No results found.</p>')),result=await handler({action:'lookup',publisher:'telegraph',libraryName,cardNumber,title:requested,urlWordsHint:hint},{fetch});assert.equal(result.status,'not_found');assert.equal(result.diagnostic.requested.title,requested);assert.equal(queries[0],'"'+requested+'"');if(hint===true)assert.equal(queries[1],'"diversity poster boy in plagiarism row"');else assert(queries[1].startsWith('"cambridges" AND '));assert.equal(queries.length,2);}
});
