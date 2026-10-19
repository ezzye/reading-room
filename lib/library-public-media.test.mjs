import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMediaDescriptor,libraryPublicPreview,collectLibraryPublicMedia,publicLibraryLocatorMetadata,publicLibraryLocatorMedia} from './library-public-media.mjs';
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

const libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABCDEF';
test('only an actual successful public fetch mints an opaque exact-library locator; supplied parser evidence and JSON cannot',async()=>{
 const verified={...capture,diagnostics:{libraryURL}},fetcher=async()=>new Response(html(),{headers:{'Content-Type':'text/html'}}),result=await collectLibraryPublicMedia(verified,fetcher),cap=result.locatorAttestation;
 assert(cap);assert(Object.isFrozen(cap));assert.deepEqual(Object.keys(cap),[]);assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result)),'locatorAttestation'),false);
 assert.deepEqual(publicLibraryLocatorMetadata(cap),{publicURL:url,publisherKey:'observer',actualLibraryTitle:capture.title,libraryURL,checkedAt:result.checkedAt,basis:'exact-library-article-public-head/v1'});
 assert.equal(publicLibraryLocatorMedia(cap).blocks[0].url,image);
 for(const forged of [null,undefined,{},JSON.parse(JSON.stringify(cap)),{publicURL:url,publisherKey:'observer',actualLibraryTitle:capture.title,libraryURL},libraryPublicPreview(verified,{url,html:html()})]){assert.equal(publicLibraryLocatorMetadata(forged),null);assert.equal(publicLibraryLocatorMedia(forged),null);}
 const supplied=await collectLibraryPublicMedia(verified,async()=>{throw Error('No fetch allowed');},{url,html:html()});assert.equal(supplied.locatorAttestation,undefined);
 for(const invalid of [capture,{...verified,diagnostics:{libraryURL:libraryURL+'&session=secret'}},{...verified,diagnostics:{libraryURL:'https://example.org/a'}}])assert.equal((await collectLibraryPublicMedia(invalid,fetcher)).locatorAttestation,undefined);
});
test('attested media is a deeply frozen snapshot, unaffected by mutations of returned parser arrays',async()=>{
 const result=await collectLibraryPublicMedia({...capture,diagnostics:{libraryURL}},async()=>new Response(html(),{headers:{'Content-Type':'text/html'}})),cap=result.locatorAttestation,media=publicLibraryLocatorMedia(cap),meta=publicLibraryLocatorMetadata(cap);
 assert(Object.isFrozen(meta));assert(Object.isFrozen(media));assert(Object.isFrozen(media.blocks));assert(Object.isFrozen(media.blocks[0]));assert(Object.isFrozen(media.blocks[0].rect));assert(Object.isFrozen(media.receipts[0]));
 result.blocks[0].url='https://images.example.org/unverified.jpg';result.receipts.length=0;
 assert.equal(media.blocks[0].url,image);assert.equal(media.receipts.length,1);assert.throws(()=>{media.blocks[0].url='https://images.example.org/changed.jpg';},TypeError);
});
test('denial, challenge, identity/headline refusal and non-Observer routes never mint a locator or retry',async()=>{
 const verified={...capture,diagnostics:{libraryURL}};
 for(const response of [()=>new Response('PRIVATE-DENIED',{status:403}),()=>new Response(html({canonical:url+'-other'}),{headers:{'Content-Type':'text/html'}}),()=>new Response(html({headline:'Unrelated fictional headline'}),{headers:{'Content-Type':'text/html'}}),()=>new Response(html().replace('<title>'+title,'<title>Just a moment'),{headers:{'Content-Type':'text/html'}}),()=>new Response(html().replace('<title>'+title+'</title>','<title>A contradictory fictional story title</title>'),{headers:{'Content-Type':'text/html'}})]){let calls=0;const result=await collectLibraryPublicMedia(verified,async()=>{calls++;return response();});assert.equal(calls,1);assert.equal(result.locatorAttestation,undefined);assert.equal(result.blocks.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-DENIED/);}
 let calls=0;const other=await collectLibraryPublicMedia({...verified,url:'https://telegraph.co.uk/news/2026/10/18/fictional-community/'},async()=>{calls++;throw Error('No additional route');});assert.equal(calls,0);assert.equal(other.locatorAttestation,undefined);
});
test('verified head identity can mint a locator without adding duplicate or absent public media',async()=>{
 for(const saved of [{...capture,blocks:[...capture.blocks,{id:'image',type:'figure',url:image}]},capture]){const result=await collectLibraryPublicMedia({...saved,diagnostics:{libraryURL}},async()=>new Response(html({photo:saved===capture?'':image}),{headers:{'Content-Type':'text/html'}}));assert(result.locatorAttestation);assert.deepEqual(publicLibraryLocatorMedia(result.locatorAttestation),{blocks:[],receipts:[]});}
});

const complete='Fictional children’s commissioner declares state of emergency on young people’s lives';
const truncation='Fictional children’s commissioner declares state of emergency on ...';
const truncatedURL='https://observer.co.uk/news/national/article/fictional-childrens-commissioner-declares-state-of-emergency-on-young-peoples-lives';
function truncatedHead({sourceURL=truncatedURL,pageTitle=truncation,ogTitle=truncation,twitterTitle=truncation,extra='',canonical=true,ogURL=true}={}){return '<!doctype html><html><head><title>'+pageTitle+'</title>'+(canonical?'<link rel="canonical" href="'+sourceURL+'">':'')+(ogURL?'<meta property="og:url" content="'+sourceURL+'">':'')+'<meta property="og:title" content="'+ogTitle+'"><meta name="twitter:title" content="'+twitterTitle+'"><meta property="og:image" content="'+image+'">'+extra+'</head><body><h1>'+complete+'</h1><script type="application/ld+json">{"articleBody":"PRIVATE BODY STATE"}</script></body></html>';}
test('identical substantial explicit Observer head truncations match only when complete library headline equals the complete canonical slug',()=>{
 const saved={url:truncatedURL,title:complete+' - Retained library standfirst.',blocks:capture.blocks},before=JSON.stringify(saved),result=libraryPublicPreview(saved,{url:truncatedURL,html:truncatedHead()});
 assert.equal(result.state,'available');assert.equal(result.blocks.length,1);assert.equal(result.blocks[0].url,image);assert.equal(result.blocks[0].basis,'exact-article-public-preview-thumbnail');assert.equal(result.blocks[0].originalPlacementVerified,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE BODY STATE|articleBody/);assert.equal(JSON.stringify(saved),before);
 assert.equal(libraryPublicPreview(saved,{url:truncatedURL,html:truncatedHead({pageTitle:truncation.replace('...','…'),twitterTitle:truncation.replace('...','…')})}).blocks.length,1);
});
test('truncated public titles never admit wrong full suffixes, numeric changes, incomplete canonical proof or contradictory variants',()=>{
 const saved={url:truncatedURL,title:complete,blocks:[]};
 for(const source of [truncatedHead({twitterTitle:truncation.replace('emergency','crisis')}),truncatedHead({ogTitle:'Fictional children’s commissioner declares a different emergency ...'}),truncatedHead({pageTitle:'A separate marketing headline ...'}),truncatedHead({ogTitle:truncation.replace('...','')}),truncatedHead({canonical:false}),truncatedHead({ogURL:false}),truncatedHead({sourceURL:truncatedURL+'-another'}),truncatedHead({extra:'<meta property="og:title" content="An unrelated reporting headline">'})])assert.equal(libraryPublicPreview(saved,{url:truncatedURL,html:source}).blocks.length,0);
 for(const title of [complete.replace('young people’s lives','other people’s lives'),complete+' 2027',complete.replace('emergency','emergency 2')])assert.equal(libraryPublicPreview({...saved,title},{url:truncatedURL,html:truncatedHead()}).blocks.length,0);
 for(const short of ['Fictional children’s ...','Fictional children’s commissioner declares ...','2026 2027 2028 2029 2030 ...'])assert.equal(libraryPublicPreview(saved,{url:truncatedURL,html:truncatedHead({pageTitle:short,ogTitle:short,twitterTitle:short})}).blocks.length,0);
});
test('truncation exception needs all three direct-head variants and never applies to another publisher or a full-title/body fallback',()=>{
 const saved={url:truncatedURL,title:complete,blocks:[]};
 for(const source of [truncatedHead().replace(/<title>.*?<\/title>/,''),truncatedHead().replace(/<meta name="twitter:title"[^>]*>/,''),truncatedHead({ogTitle:complete}),truncatedHead({pageTitle:'Unrelated full title',ogTitle:'Unrelated full title',twitterTitle:'Unrelated full title'})])assert.equal(libraryPublicPreview(saved,{url:truncatedURL,html:source}).blocks.length,0);
 const other='https://telegraph.co.uk/news/2026/10/18/fictional-childrens-commissioner-declares-state-of-emergency-on-young-peoples-lives/';assert.equal(libraryPublicPreview({...saved,url:other},{url:other,html:truncatedHead({sourceURL:other})}).blocks.length,0);
});
