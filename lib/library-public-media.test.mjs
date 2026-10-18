import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMediaDescriptor,libraryPublicPreview,collectLibraryPublicMedia} from './library-public-media.mjs';
import {publisherFor,extractNewspaper} from './newspaper-core.mjs';
const url='https://observer.co.uk/news/national/article/fictional-community-compares-river-crossings';
const title='Fictional community compares river crossings';
const capture={url,title:title+' - Retained library standfirst.',blocks:[{id:'B1',type:'paragraph',text:'Retained synthetic library paragraph.'}]};
const image='https://images.example.org/public-preview.jpg';
const html=({canonical=url,headline=title,photo=image,extra='',body=''}={})=>'<!doctype html><html><head><title>'+title+'</title><link rel="canonical" href="'+canonical+'"><meta property="og:url" content="'+canonical+'"><meta property="og:title" content="'+headline+'"><meta property="og:image" content="'+photo+'"><meta property="og:image:alt" content="Synthetic river preview">'+extra+'</head><body><h1>'+title+'</h1>'+body+'</body></html>';
test('media-only descriptor registers no public Observer prose adapter and keeps existing public profiles',()=>{
 assert.equal(publicMediaDescriptor(url).mode,'library-public-metadata');assert.equal(publicMediaDescriptor(url).host,'observer.co.uk');
 assert.throws(()=>publisherFor(url));assert.throws(()=>extractNewspaper(html(),url));
 for(const input of ['https://thetimes.com/uk/article/fictional-garden-abcdefghi','https://telegraph.co.uk/news/2026/10/18/fictional-community/'])assert.equal(publicMediaDescriptor(input).mode,'public-profile');
 for(const input of ['https://evil.observer.co.uk/news/national/article/fictional-community','http://observer.co.uk/news/national/article/fictional-community',url+'?session=secret','https://localhost/news/national/article/fictional-community'])assert.throws(()=>publicMediaDescriptor(input));
});
test('exact canonical and same headline public metadata supply labelled thumbnail and safe original player only',()=>{
 const before=JSON.stringify(capture),result=libraryPublicPreview(capture,{url,html:html({extra:'<meta name="twitter:image" content="'+image+'"><meta name="twitter:player" content="https://www.youtube.com/watch?v=abcdefghijk">',body:'<script type="application/ld+json">{"isAccessibleForFree":false,"articleBody":"PAID_BODY_SENTINEL","image":"https://images.example.org/hidden-paid.jpg"}</script><div data-access="paid"><p>PAID_BODY_SENTINEL</p><img src="https://images.example.org/body-paid.jpg"></div><aside><img src="https://images.example.org/related.jpg"></aside>'})});
 assert.equal(result.state,'available');assert.equal(result.blocks.length,2);assert.equal(result.blocks[0].url,image);assert.equal(result.blocks[0].basis,'exact-article-public-preview-thumbnail');assert.match(result.blocks[0].caption,/public-preview thumbnail/);assert.equal(result.blocks[0].originalPlacementVerified,false);assert.equal(result.blocks[1].url,'https://www.youtube-nocookie.com/embed/abcdefghijk');assert.equal(result.blocks[1].basis,'exact-article-public-player-metadata');assert.deepEqual(result.receipts.map(x=>x.sourceURL),[url,url]);assert.doesNotMatch(JSON.stringify(result),/PAID_BODY|hidden-paid|body-paid|related\.jpg|isAccessibleForFree/);assert.equal(JSON.stringify(capture),before);
});
test('headline/canonical absence, wrong identities and hidden template metadata never establish a match',()=>{
 for(const source of [{url,html:html({headline:'A wholly unrelated election article'})},{url,html:html({canonical:url+'-other'})},{url:url+'-other',html:html()},{url,html:html().replace(/<link[^>]*>|<meta property="og:url"[^>]*>/g,'')},{url,html:html().replace('</head>','<meta name="twitter:title" content="Another unrelated title"></head>')}])assert.equal(libraryPublicPreview(capture,source).blocks.length,0);
 const template='<!doctype html><html><head><template><link rel="canonical" href="'+url+'"><meta property="og:title" content="'+title+'"><meta property="og:image" content="'+image+'"></template></head><body></body></html>';assert.equal(libraryPublicPreview(capture,{url,html:template}).blocks.length,0);
});
test('unsafe signed assets, arbitrary players and body-only media are omitted; existing thumbnail deduplicates',()=>{
 for(const photo of [image+'?token=secret',image+'?pin=secret','https://127.0.0.1/photo.jpg','https://assets.internal/photo.jpg'])assert.equal(libraryPublicPreview(capture,{url,html:html({photo,extra:'<meta name="twitter:player" content="https://evil.example.org/arbitrary-player">',body:'<img src="'+image+'">'})}).blocks.length,0);
 assert.equal(libraryPublicPreview({...capture,blocks:[...capture.blocks,{type:'figure',url:image}]},{url,html:html()}).blocks.length,0);
});
test('one credential-free ordinary fetch supplies metadata; no providers, body fetches or alternate denial route',async()=>{
 const calls=[],result=await collectLibraryPublicMedia(capture,async(address,options)=>{calls.push(address);assert.equal(address,url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.referrerPolicy,'no-referrer');const headers=new Headers(options.headers);assert.equal(headers.has('cookie'),false);assert.equal(headers.has('authorization'),false);return new Response(html(),{headers:{'Content-Type':'text/html'}});});assert.deepEqual(calls,[url]);assert.equal(result.blocks.length,1);assert.equal(result.attempts[0].sourceType,'library-public-metadata');assert.equal(result.attempts[0].imageReferences,1);
 for(const status of [401,402,403,429]){let n=0;const denied=await collectLibraryPublicMedia(capture,async()=>{n++;return new Response('PRIVATE_DENIAL_SENTINEL',{status});});assert.equal(n,1);assert.equal(denied.blocks.length,0);assert.equal(denied.attempts[0].state,'blocked');assert.equal(denied.attempts[0].httpStatus,status);assert.doesNotMatch(JSON.stringify(denied),/PRIVATE_DENIAL/);}
 const challenge=await collectLibraryPublicMedia(capture,async()=>new Response(html().replace('<title>'+title,'<title>Verify you are human'),{headers:{'Content-Type':'text/html'}}));assert.equal(challenge.attempts[0].reasonCode,'challenge');
});
test('only same-article ordinary redirects are followed; oversized and supplied evidence stay bounded',async()=>{
 const calls=[];const redirected=await collectLibraryPublicMedia(capture,async address=>{calls.push(address);return calls.length===1?new Response(null,{status:301,headers:{Location:url.replace('https://','https://www.')}}):new Response(html(),{headers:{'Content-Type':'text/html'}});});assert.equal(calls.length,2);assert.match(calls[1],/^https:\/\/www\.observer/);assert.equal(redirected.blocks.length,1);
 let callsDenied=0;const denied=await collectLibraryPublicMedia(capture,async()=>{callsDenied++;return new Response(null,{status:302,headers:{Location:'https://evil.example.org/not-the-article'}});});assert.equal(callsDenied,1);assert.equal(denied.attempts[0].reasonCode,'redirect_mismatch');
 const oversized=await collectLibraryPublicMedia(capture,async()=>new Response('x',{headers:{'Content-Type':'text/html','Content-Length':'2000001'}}));assert.equal(oversized.attempts[0].reasonCode,'response_too_large');
 const supplied=await collectLibraryPublicMedia(capture,async()=>{throw Error('Supplied evidence must not refetch');},{url,html:html()});assert.equal(supplied.blocks.length,1);
});
