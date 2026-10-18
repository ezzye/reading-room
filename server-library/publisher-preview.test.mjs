import test from 'node:test';
import assert from 'node:assert/strict';
import {publisherPreview,PREVIEW_REASON_CODES} from './publisher-preview.mjs';
import {handler} from './handler.mjs';

const url='https://telegraph.co.uk/world-news/2026/10/17/a-fictional-river-walk-opens';
const title='A fictional river walk opens for the community';
const html=(body,head='')=>'<!doctype html><html><head>'+head+'</head><body>'+body+'</body></html>';
const page=(body,status=200,headers={})=>new Response(status>=300&&status<400?null:body,{status,headers:{'Content-Type':'text/html; charset=utf-8',...headers}});
const event=(changes={})=>({action:'publisher-preview',url,...changes});
const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

test('preview rejects credentials and every non-contract field before any request',async()=>{
 let requests=0;const fetch=async()=>{requests++;throw Error('No request expected');};
 for(const field of ['cardNumber','libraryName','session','credentials','headers','cookie','title']){
  const result=await publisherPreview(event({[field]:'synthetic-private-value'}),{fetch});
  assert.equal(result.state,'unavailable');assert.equal(result.reasonCode,'invalid_request');assert.deepEqual(result.blocks,[]);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private-value/);
 }
 assert.equal(requests,0);
});

test('preview only accepts real HTTPS Telegraph dated article paths',async()=>{
 let requests=0;const fetch=async()=>{requests++;throw Error('No request expected');};
 for(const address of ['http://telegraph.co.uk/world-news/2026/10/17/a-story','https://127.0.0.1/world-news/2026/10/17/a-story','https://telegraph.co.uk.attacker.example/world-news/2026/10/17/a-story','https://user:pass@telegraph.co.uk/world-news/2026/10/17/a-story','https://telegraph.co.uk:444/world-news/2026/10/17/a-story','https://www.telegraph.co.uk/','https://www.thetimes.com/world/article/example-abcdefghi','https://telegraph.co.uk/world-news/2026/02/30/a-story']){
  const result=await publisherPreview(event({url:address}),{fetch});assert.equal(result.reasonCode,'invalid_url');assert.equal(result.sourceURL,'');
 }
 assert.equal(requests,0);
});

test('normal same-article www redirect sends only product headers and never adopts cookies',async()=>{
 const calls=[];
 const fetch=async(address,options)=>{
  calls.push({address,options});assert.equal(new URL(address).search,'');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  assert.equal(options.headers['User-Agent'],'ReadEveryThing/1.0 (public article reader)');assert.equal(new Headers(options.headers).has('Cookie'),false);assert.equal(new Headers(options.headers).has('Authorization'),false);
  assert(options.signal instanceof AbortSignal);
  return calls.length===1?page('',301,{Location:url.replace('https://','https://www.')+'/?session=discarded','Set-Cookie':'publisher=not-adopted; Secure; Path=/'}):page(html('<article><h1>'+title+'</h1><img src="/photo.jpg" alt="Public photograph"></article>','<link rel="canonical" href="'+url+'"><meta property="article:published_time" content="2026-10-17T09:30:00Z">'));
 };
 const result=await publisherPreview(event({url:url+'?CMP=share'}),{fetch});
 assert.equal(calls.length,2);assert.equal(result.state,'available');assert.equal(result.title,title);assert.equal(result.date,'2026-10-17');assert.equal(result.sourceURL,url);assert.equal(result.blocks.length,1);
 assert.doesNotMatch(JSON.stringify(result),/session=|not-adopted|Set-Cookie/);
});

test('redirects may not change host, article identity, scheme, port or credentials',async()=>{
 for(const destination of ['https://attacker.example/'+new URL(url).pathname,'https://telegraph.co.uk/','https://telegraph.co.uk/world-news/2026/10/17/a-different-story','http://telegraph.co.uk'+new URL(url).pathname,'https://telegraph.co.uk:444'+new URL(url).pathname,'https://user:pass@telegraph.co.uk'+new URL(url).pathname]){
  let requests=0;const result=await publisherPreview(event(),{fetch:async()=>{requests++;return page('',302,{Location:destination});}});
  assert.equal(requests,1);assert.equal(result.state,'blocked');assert.equal(result.reasonCode,'redirect_mismatch');assert.deepEqual(result.blocks,[]);
 }
});

test('redirect loops stop after three network requests',async()=>{
 let requests=0;const result=await publisherPreview(event(),{fetch:async()=>{requests++;return page('',302,{Location:url});}});
 assert.equal(requests,3);assert.equal(result.reasonCode,'redirect_limit');
});

test('non-success responses are discarded without inspecting their purported metadata',async()=>{
 for(const status of [402,403,429,503]){
  let discarded=0;const response={status,ok:false,headers:new Headers({'content-type':'text/html'}),body:{cancel:async()=>{discarded++;},getReader:()=>{throw Error('Denial bodies must not be read');}}};
  const result=await publisherPreview(event(),{fetch:async()=>response});
  assert.equal(result.state,'blocked');assert.equal(result.reasonCode,'http_denied');assert.equal(result.httpStatus,status);assert.equal(result.title,'');assert.deepEqual(result.blocks,[]);assert.equal(discarded,1);
 }
});

test('declared and streamed bodies are bounded and cancelled',async()=>{
 let cancelled=0;
 const declared={status:200,ok:true,headers:new Headers({'content-type':'text/html','content-length':'2000001'}),body:{cancel:async()=>{cancelled++;},getReader:()=>{throw Error('Oversized bodies must not be read');}}};
 assert.equal((await publisherPreview(event(),{fetch:async()=>declared})).reasonCode,'response_too_large');assert.equal(cancelled,1);
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1_100_000));controller.enqueue(new Uint8Array(1_100_000));},cancel(){cancelled++;}});
 const result=await publisherPreview(event(),{fetch:async()=>new Response(stream,{headers:{'content-type':'text/html'}})});
 assert.equal(result.reasonCode,'response_too_large');assert.equal(cancelled,2);assert.equal(result.title,'');
});

test('challenge responses stop before media or headline discovery',async()=>{
 const result=await publisherPreview(event(),{fetch:async()=>page(html('<h1>'+title+'</h1><p>Verify you are human</p>','<meta property="og:image" content="https://cdn.example.org/should-not-leave.jpg">'))});
 assert.equal(result.state,'blocked');assert.equal(result.reasonCode,'challenge');assert.equal(result.title,'');assert.deepEqual(result.blocks,[]);
});

test('a paid article preview returns public media only, never hidden article body or state',async()=>{
 const body='<article><h1>'+title+'</h1><figure><img src="https://cdn.example.org/public-photo.jpg" alt="A public image"><figcaption>Public caption</figcaption></figure><div class="paywall"><p>PRIVATE ARTICLE PROSE</p><video src="https://cdn.example.org/private.mp4"></video></div><div class="secret"><img src="https://cdn.example.org/hidden.jpg"></div><aside><img src="https://cdn.example.org/related.jpg"></aside></article>';
 const head='<link rel="canonical" href="'+url+'"><style>.secret{display:none}</style><meta property="og:video" content="https://www.youtube.com/watch?v=AbCdEfGh123"><script type="application/ld+json">{"isAccessibleForFree":false,"articleBody":"PRIVATE JSON BODY","image":"https://cdn.example.org/state.jpg","video":{"contentUrl":"https://cdn.example.org/state.mp4"}}</script><script>const note="captcha AWS WAF code only";</script>';
 const result=await publisherPreview(event(),{fetch:async()=>page(html(body,head))});
 assert.equal(result.state,'available');assert.equal(result.reasonCode,'public_metadata');assert.equal(result.title,title);assert.equal(result.date,'2026-10-17');
 assert.deepEqual(result.blocks.map(block=>block.type),['figure','video']);assert.equal(result.blocks[1].url,'https://www.youtube-nocookie.com/embed/AbCdEfGh123');
 assert(result.blocks.every(block=>block.sourceURL===url&&block.placement==='approximate'&&block.originalPlacementVerified===false));
 assert.equal(result.receipts.length,result.blocks.length);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|hidden.jpg|related.jpg|state.jpg|state.mp4|private.mp4|captcha|articleBody|<script/);
});

test('canonical or OG identity disagreement refuses all metadata',async()=>{
 for(const identity of ['<link rel="canonical" href="https://www.telegraph.co.uk/">','<meta property="og:url" content="https://telegraph.co.uk/world-news/2026/10/17/other">']){
  const result=await publisherPreview(event(),{fetch:async()=>page(html('<h1>'+title+'</h1>',identity+'<meta property="og:image" content="/wrong.jpg">'))});
  assert.equal(result.reasonCode,'identity_mismatch');assert.equal(result.title,'');assert.deepEqual(result.blocks,[]);
 }
});

test('hidden headline text cannot identify a page and OG title is a public fallback',async()=>{
 const hidden='<article><h1 class="secret">PRIVATE HIDDEN HEADLINE</h1><p>PRIVATE PROSE</p></article>';
 const head='<style>.secret{display:none}</style><link rel="canonical" href="'+url+'">';
 assert.equal((await publisherPreview(event(),{fetch:async()=>page(html(hidden,head))})).reasonCode,'headline_missing');
 const result=await publisherPreview(event(),{fetch:async()=>page(html(hidden,head+'<meta property="og:title" content="'+title+'">'))});
 assert.equal(result.state,'available');assert.equal(result.title,title);assert.equal(result.reasonCode,'no_public_media');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('result is bounded to six safe items and thirty kilobytes with paired receipts',async()=>{
 const longURL='https://cdn.example.org/'+('a'.repeat(1900));
 const media=Array.from({length:12},(_,i)=>'<figure><img src="'+longURL+i+'.jpg"><figcaption>'+('caption '.repeat(200))+'</figcaption></figure>').join('');
 const result=await publisherPreview(event(),{fetch:async()=>page(html('<article><h1>'+title+'</h1>'+media+'</article>','<link rel="canonical" href="'+url+'">'))});
 assert.equal(result.state,'available');assert(result.blocks.length<=6);assert.equal(result.blocks.length,result.receipts.length);assert(byteLength(result)<=30_000);assert(result.blocks.every(block=>block.caption.length<=500&&block.credit.length<=200&&block.url.length<=2048));
 assert(result.blocks.every((block,i)=>block.id===result.receipts[i].id&&block.url===result.receipts[i].url));
});

test('timeouts and unsupported types return fixed reason codes without diagnostics',async()=>{
 const timeout=await publisherPreview(event(),{fetch:async()=>{throw new DOMException('PRIVATE NETWORK DIAGNOSTIC','TimeoutError');}});
 assert.equal(timeout.reasonCode,'timed_out');assert.doesNotMatch(JSON.stringify(timeout),/PRIVATE/);
 const wrong=await publisherPreview(event(),{fetch:async()=>new Response('private',{headers:{'content-type':'application/json'}})});
 assert.equal(wrong.reasonCode,'unsupported_content');
 assert(PREVIEW_REASON_CODES.includes(timeout.reasonCode)&&PREVIEW_REASON_CODES.includes(wrong.reasonCode));
});

test('Lambda dispatch preserves the preview contract and rejects library fields before fetching',async()=>{
 const success=await handler(event(),{fetch:async()=>page(html('<h1>'+title+'</h1>'))});
 assert.equal(success.status,'publisher-preview');assert.equal(success.state,'available');assert(byteLength(success)<=30_000);
 let requests=0;const rejected=await handler(event({session:{cookies:[]}}),{fetch:async()=>{requests++;throw Error('No request expected');}});
 assert.equal(rejected.status,'publisher-preview');assert.equal(rejected.reasonCode,'invalid_request');assert.equal(requests,0);
});
