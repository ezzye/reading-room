import test from 'node:test';import assert from 'node:assert/strict';import {publicHTML,extractNewspaper,publisherFor,PAPERS} from './newspaper-core.mjs';import {renderCapture} from './capture-core.mjs';
import {para,fixture} from './newspaper-fixture.mjs';
test('HTML import preserves ordered article/media, ignores hidden prose and never imports source scripts',()=>{const c=extractNewspaper(fixture,'https://www.theguardian.com/fictional-story');assert.equal(c.title,'A fictional community report');assert.deepEqual(c.blocks.map(b=>b.type),['paragraph','figure','paragraph','video','heading','paragraph']);assert.equal(c.blocks[0].text,para);assert.equal(c.diagnostics.videoCount,1);assert.equal(c.presentation.method,'public-url');const html=renderCapture({id:'a'.repeat(48),document:{kind:'rendered-capture-v1',capture:c,annotations:[]}});assert.doesNotMatch(html,/PRIVATE HIDDEN|MORE HIDDEN|Do not import|unrelated recommended|recommendation.jpg|exfiltrate|evil.example/);assert.match(html,/approximate publisher styling/);assert.match(html,/external styles, exact fonts/);assert.equal(c.design.headlineStyle.fontSize,'48px');});
test('paywall, challenge, teaser and unsupported-host fail honestly without hidden article JSON',()=>{for(const html of [fixture.replace('</head>','<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false,"articleBody":"FULL SECRET ARTICLE"}</script></head>'),fixture.replace('<p>'+para+'</p>','<p>Subscribe to continue reading this article.</p>'),fixture.replace('<title>Community report','<title>Just a moment')])assert.throws(()=>extractNewspaper(html,'https://theguardian.com/test'));assert.throws(()=>publisherFor('https://theguardian.com.evil.example/article'));assert.throws(()=>publisherFor('https://evil.theguardian.com/article'));assert.throws(()=>extractNewspaper('<article><h1>Teaser</h1><p>Preview.</p></article>','https://theguardian.com/test'));});
test('public fetch strips cookies and refuses redirects to local hosts or another publisher',async()=>{let n=0;await assert.rejects(publicHTML('https://theguardian.com/test',async(url,init)=>{n++;assert.equal(init.headers.Cookie,undefined);assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}));assert.equal(n,1);n=0;await assert.rejects(publicHTML('https://theguardian.com/test',async()=>{n++;return new Response(null,{status:302,headers:{location:'https://dawn.com/story'}});}));assert.equal(n,1);});
test('fetch requires HTML and enforces declared and streamed response limits',async()=>{await assert.rejects(publicHTML('https://theguardian.com/test',async()=>new Response('x',{headers:{'Content-Type':'application/json'}})));await assert.rejects(publicHTML('https://theguardian.com/test',async()=>new Response('x',{headers:{'Content-Type':'text/html','Content-Length':'4000001'}})));const good=await publicHTML('https://theguardian.com/test',async()=>new Response(fixture,{headers:{'Content-Type':'text/html'}}));assert.equal(good.html,fixture);});
test('embedded CSS contributes source font names and hidden content is excluded',()=>{const html=fixture.replace('</head>','<style>h1{font-family:"Source Headline",serif;font-size:42px}.secret{display:none}p{font-family:Arial,sans-serif;font-size:18px}</style></head>').replace('<h1 style="font-size:48px">','<h1>').replace('<p hidden>','<p class="secret">');const c=extractNewspaper(html,'https://theguardian.com/fictional');assert.match(c.design.headlineStyle.fontFamily,/Source Headline/);assert.equal(c.design.headlineStyle.fontSize,'42px');assert.doesNotMatch(JSON.stringify(c.blocks),/PRIVATE HIDDEN TEXT/);assert.equal(c.blocks[0].style.fontSize,'18px');});
test('safe direct video and metadata embeds are retained; unknown players are not invented',()=>{const html=fixture.replace('</article>','<video src="https://media.example.org/report.mp4" poster="https://images.example.org/video.jpg"></video></article>').replace('</head>','<script type="application/ld+json">{"@type":"NewsArticle","video":{"@type":"VideoObject","embedUrl":"https://player.vimeo.com/video/123456"}}</script></head>');const c=extractNewspaper(html,'https://theguardian.com/fictional');assert.ok(c.blocks.some(x=>x.url==='https://media.example.org/report.mp4'));assert.ok(c.blocks.some(x=>x.url==='https://player.vimeo.com/video/123456'));});
test('Guardian self-hosted island imports its public MP4 once and preserves the source position/aspect',()=>{const props={sources:[{src:'https://uploads.guim.co.uk/example-480.mp4',mimeType:'video/mp4',height:384},{src:'https://uploads.guim.co.uk/example-720.mp4',mimeType:'video/mp4',height:720},{src:'https://evil.example/stolen.mp4',mimeType:'video/mp4',height:1080}],aspectRatio:1.25,fallbackImage:'https://uploads.guim.co.uk/poster.jpg',caption:'Original clip'};const json=JSON.stringify(props).replace(/"/g,'&quot;');const html=fixture.replace('<h2>What happens next?</h2>',`<gu-island name="SelfHostedVideo" props="${json}"><img src="https://uploads.guim.co.uk/poster.jpg" width="900"><video></video></gu-island><h2>What happens next?</h2>`);const c=extractNewspaper(html,'https://theguardian.com/news/test?CMP=Share_AndroidApp_Other');const videos=c.blocks.filter(x=>x.type==='video');assert.equal(videos.length,2);assert.equal(videos[1].url,'https://uploads.guim.co.uk/example-720.mp4');assert.equal(videos[1].aspectRatio,1.25);assert.equal(c.presentation.extractorRevision,3);assert.doesNotMatch(c.url,/CMP=/);assert.equal(c.blocks.filter(x=>x.type==='figure').length,1);});
test('Guardian lead media rendered after body in source DOM is restored ahead of the prose',()=>{const html=fixture.replace('</article>','<figure><img width="900" src="https://images.example.org/lead.jpg"><figcaption>Lead photo</figcaption></figure></article>');const c=extractNewspaper(html,'https://theguardian.com/news/test');assert.equal(c.blocks[0].url,'https://images.example.org/lead.jpg');});
test('BBC article excludes related cards, newsletter artwork and publication labels from story prose',()=>{const source=fixture.replace('</article>','<p>Published16 October 2026</p><figure><img width="1600" src="https://ichef.bbci.co.uk/newsletter.png" alt="A green promotional banner: news in your inbox"></figure><div data-testid="topic-list"><h2>Related topics</h2></div><div data-block="promoList"><h2>More on this story</h2><p>A recommendation that is not part of the report.</p></div></article>');const c=extractNewspaper(source,'https://www.bbc.co.uk/news/articles/test');assert.equal(c.presentation.extractorRevision,4);assert.doesNotMatch(JSON.stringify(c.blocks),/Related topics|More on this story|newsletter.png|Published16|recommendation that/);assert.equal(c.diagnostics.paragraphCount,3);});

test('BBC percentage reset and inactive responsive CSS cannot turn body text into 88px type',()=>{
 const source=fixture.replace('</head>','<style>p{margin:0;font-size:100%;font:inherit} @media(min-width:9000px){p{font-size:88px;line-height:14px}} @supports(display:unknown){p{font-size:70px}} h2{font-size:36px;line-height:42px}</style></head>');
 const c=extractNewspaper(source,'https://bbc.co.uk/news/articles/fixture');for(const block of c.blocks.filter(x=>x.type==='paragraph')){assert.equal(block.style.fontSize,'20px');assert.ok(parseFloat(block.style.lineHeight)>=27);}const heading=c.blocks.find(x=>x.type==='heading');assert.equal(heading.style.fontSize,'36px');assert.equal(heading.style.lineHeight,'42px');assert.equal(c.design.headlineStyle.fontSize,'48px');
});
test('relative sizes are resolved as units and unsupported fluid hints use readable defaults',()=>{
 for(const [css,expected] of [['p{font-size:1.125rem;line-height:150%}','18px'],['p{font-size:1.1em;line-height:1.5}','22px'],['p{font-size:clamp(14px,4vw,90px);line-height:calc(1em + 4px)}','20px'],['p{font-size:20px;line-height:14px}','20px']]){
 const c=extractNewspaper(fixture.replace('</head>','<style>'+css+'</style></head>'),'https://bbc.com/news/articles/fixture');const style=c.blocks[0].style;assert.equal(style.fontSize,expected);assert.ok(parseFloat(style.lineHeight)>=parseFloat(style.fontSize)*1.35);
 }
});
test('every supported publisher gets role-specific readable source typography',()=>{
 for(const host of Object.keys(PAPERS)){
 let source=fixture.replace('</head>','<style>p{font-size:88px;line-height:14px}h2{font-size:40px;line-height:46px}</style></head>');
 if(PAPERS[host].reachMedia)source=source.replace('<article>','<article id="article-body" data-testid="body">');
 if(host==='thesun.co.uk')source=source.replace('class="article-body"','class="single__content article__content"');
 if(host.startsWith('dailymail.'))source=source.replace('<div class="article-body">','<div id="js-article-text" class="article-text"><div itemprop="articleBody">').replace('</article>','</div></article>');
 if(host==='inews.co.uk')source=source.replace('<div class="article-body">','<div id="content" class="inews__post-content entry-content article-content">');
 if(host==='cityam.com')source=source.replace('<article>','<article class="content-container content-container__single">');
 if(host==='express.co.uk')source=source.replace('<div class="article-body">','<div id="singleArticle" class="single-article article-body regular"><article id="article-body">').replace('</div></article>','</article></div></article>');
 if(host==='independent.ie')source=source.replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":"True"}</script></head>').replace('<div class="article-body">','<section data-testid="article-body">').replace('</div></article>','</section></article>');
 if(host==='npr.org')source=source.replace('<div class="article-body">','<div id="storytext" class="storytext">');
 if(host==='nypost.com')source=source.replace('<article>','<article class="single single--article single--exclusive-article-disabled">').replace('<h1 style="font-size:48px">','<header class="article-header"><h1 style="font-size:48px">').replace('</h1>','</h1></header>').replace('<div class="article-body">','<div class="single__content entry-content">').replace('<h2>','<p>'+para+' A fourth synthetic paragraph.</p><p>'+para+' A fifth synthetic paragraph.</p><h2>');
 if(host==='sundaypost.com')source=source.replace('<div class="article-body">','<div class="entry-content" itemprop="articleBody"><div class="cms clearfix">').replace('</article>','</div></article>');
 if(host==='narratively.com')source=source.replace('<h1 style="font-size:48px">','<h1 class="post-title" style="font-size:48px">').replace('<p class="standfirst">A fictional demonstration.</p>','<h3 class="subtitle">A fictional demonstration.</h3>').replace('<div class="article-body">','<div class="available-content"><div class="body markup">').replace('<h2>What happens next?</h2>','<p>'+para+' A distinct additional section.</p><h2>What happens next?</h2>').replace('</div></article>','</div></div></article>');
 if(host==='vox.com')source='<!doctype html><html><head><title>Vox fixture</title><meta name="author" content="Test reporter"><style>p{font-size:88px;line-height:14px}h2{font-size:40px;line-height:46px}</style></head><body><main class="duet--layout--entry-body"><h1>A fictional community report</h1><p>A fictional demonstration.</p><figure class="duet--layout--entry-image"><img width="800" src="https://images.example.org/story.jpg"><figcaption class="duet--media--caption">The hall.</figcaption></figure><div id="zephr-anchor">'+Array.from({length:5},(_,i)=>'<div class="duet--article--article-body-component"><p>Section '+i+'. '+para+'</p></div>').join('')+'<div class="duet--article--article-body-component"><h2>What happens next?</h2></div></div></main></body></html>';
 let c;try{c=extractNewspaper(source,'https://'+host+'/fixture');}catch(error){throw new Error(host+': '+error.message);}
 for(const block of c.blocks.filter(x=>['paragraph','quote'].includes(x.type))){const size=parseFloat(block.style.fontSize);assert.ok(size>=16&&size<=26,host);assert.ok(parseFloat(block.style.lineHeight)>=size*1.35,host);}
 assert.equal(c.blocks.find(x=>x.type==='heading').style.fontSize,'40px',host);
 }
});

test('Hindustan article list retains sibling artContent segments and a short concluding paragraph',()=>{
 const source='<!doctype html><html><head><title>Fixture</title></head><body><h1>Original article heading</h1><div class="articleDetail"><div class="listElements"><div class="artContent"><p class="content">'+para+'</p></div><div class="artContent"><p class="content">'+para+' A second independently marked segment remains in source order.</p></div><div class="artContent"><p class="content">'+para+' This is the final long segment.</p><p class="content">Not India.</p></div><div class="related-stories"><p>Unrelated recommended content.</p></div></div></div><script type="application/json">{"articleBody":"NEVER IMPORT HIDDEN STATE"}</script></body></html>';
 const c=extractNewspaper(source,'https://hindustantimes.com/india-news/fixture.html');assert.equal(c.blocks.filter(b=>b.type==='paragraph').length,4);assert.equal(c.blocks.at(-1).text,'Not India.');assert.match(c.blocks[1].text,/second independently/);assert.doesNotMatch(JSON.stringify(c.blocks),/Unrelated|HIDDEN STATE/);
});
test('Indian Express hidden premium markup does not turn a public preview into a full article',()=>{
 const source='<html><h1>Original article heading</h1><div class="story_details"><p>A short ordinary preview paragraph stays public.</p><div class="ie-premium-content-block paywall" style="display:none"><p>'+para.repeat(5)+'</p></div></div></html>';
 assert.throws(()=>extractNewspaper(source,'https://indianexpress.com/article/fixture/'),/short preview/);
});

test('Mirror uses the observed bounded article root and preserves sibling photo captions without copying related cards',()=>{
 const source=fixture.replace('<article>','<article id="article-body" data-testid="body">').replace('<figure><img src="https://images.example.org/story.jpg" alt="Community hall" width="800"><figcaption>The hall.</figcaption></figure>','<button class="SlideViewerButton_slide-viewer-button__fixture"><div data-testid="imageembed-42"><figure><img src="https://images.example.org/story.jpg" alt="Community hall" width="800"></figure><div class="ImageCaption_caption__fixture"><p>The community hall (Image: Example Photographer)</p></div></div></button>').replace('</article>','<div data-testid="related-articles"><p>Unrelated Mirror recommendation</p><img src="https://images.example.org/related.jpg"></div></article>');
 const c=extractNewspaper(source,'https://www.mirror.co.uk/news/fixture-12345');
 assert.equal(c.publisher,'Daily Mirror');assert.equal(c.diagnostics.imageCount,1);assert.match(c.blocks.find(b=>b.type==='figure').caption,/Example Photographer/);assert.equal(c.blocks.filter(b=>b.type==='paragraph').length,3);assert.doesNotMatch(JSON.stringify(c.blocks),/Unrelated Mirror|related.jpg|PRIVATE HIDDEN/);
});

test('Sun ignores newsletter signup and recommended-story modules while retaining ordinary media and prose',()=>{
 const source=fixture.replace('class="article-body"','class="single__content article__content"').replace('</article>','</article>').replace('<h2>What happens next?</h2>','<div class="inline-module--newsletter"><h2>Subscribe to continue</h2><p>Newsletter-only subscription prompt.</p><img src="https://images.example.org/newsletter-banner.jpg"></div><div class="article-readmore article-readmore--recommended-stories"><p>Unrelated Sun recommendation.</p></div><h2>What happens next?</h2>');
 const c=extractNewspaper(source,'https://www.thesun.co.uk/news/12345/fixture/');
 assert.equal(c.publisher,'The Sun');assert.equal(c.diagnostics.imageCount,1);assert.equal(c.diagnostics.videoCount,1);assert.equal(c.diagnostics.paragraphCount,3);assert.doesNotMatch(JSON.stringify(c.blocks),/Newsletter-only|newsletter-banner|Unrelated Sun|Subscribe to continue/);
});

test('Sun article import retains supplied photograph URLs when responsive sizes contain commas',()=>{
 const source=fixture.replace('class="article-body"','class="single__content article__content"').replace('src="https://images.example.org/story.jpg"','src="https://www.thesun.co.uk/wp-content/uploads/fixture.jpg?w=960" srcset="https://www.thesun.co.uk/wp-content/uploads/fixture.jpg?resize=300,208&amp;quality=90 300w, https://www.thesun.co.uk/wp-content/uploads/fixture.jpg?resize=960,666&amp;quality=90 960w"');
 const capture=extractNewspaper(source,'https://www.thesun.co.uk/news/12345/fixture/');
 assert.equal(capture.blocks.find(block=>block.type==='figure').url,'https://www.thesun.co.uk/wp-content/uploads/fixture.jpg?w=960');
 assert.equal(capture.blocks.filter(block=>block.type==='paragraph').length,3);
});

test('Mirror and Sun never widen missing article selectors and retain real access-gate rejection',()=>{
 for(const [host,adapt] of [['mirror.co.uk',s=>s.replace('<article>','<article id="article-body" data-testid="body">')],['thesun.co.uk',s=>s.replace('class="article-body"','class="single__content article__content"')]]){
  assert.throws(()=>extractNewspaper(fixture,'https://'+host+'/fixture'),/readable article markup/);
  assert.throws(()=>extractNewspaper(adapt(fixture).replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>'),'https://'+host+'/fixture'),/subscription-only/);
  assert.throws(()=>extractNewspaper(adapt(fixture).replace('<h2>What happens next?</h2>','<p>Subscribe to continue reading this article.</p>'),'https://'+host+'/fixture'),/subscription prompt/);
 }
});


test('Mirror gallery media exception retains CSS and explicit hidden protection and excludes other button controls',()=>{
 for(const wrapper of ['<button class="SlideViewerButton_slide-viewer-button__fixture" hidden>','<button class="SlideViewerButton_slide-viewer-button__fixture" style="display:none">','<button class="ordinary-control">']){
 const source=fixture.replace('<article>','<article id="article-body" data-testid="body">').replace('<figure>',wrapper+'<figure>').replace('</figure>','</figure></button>');
 const c=extractNewspaper(source,'https://mirror.co.uk/news/fixture-12345');assert.equal(c.diagnostics.imageCount,0);
 }
});

const mailFixture=()=>fixture.replace('<title>Community report</title>','<title>A fictional Daily Mail story | Daily Mail Online</title>').replace('<h1 style="font-size:48px">A fictional community report</h1>','<h1>News</h1>').replace('<div class="article-body">','<div id="js-article-text" class="article-text"><div itemprop="articleBody">').replace('</article>','</div></article>');
test('Daily Mail selects article metadata headline over navigation and keeps strict prose/photo captions',()=>{
 const source=mailFixture().replace('<figure><img src="https://images.example.org/story.jpg" alt="Community hall" width="800"><figcaption>The hall.</figcaption></figure>','<div class="artSplitter mol-img-group"><img src="https://images.example.org/story.jpg" width="800"><p class="imageCaption">A fictional photo caption with its source credit.</p></div>');
 const c=extractNewspaper(source,'https://www.dailymail.com/news/article-12345/fictional-story.html');
 assert.equal(c.title,'A fictional Daily Mail story');assert.equal(c.publisher,'Daily Mail');assert.equal(c.diagnostics.paragraphCount,3);assert.equal(c.diagnostics.imageCount,1);assert.match(c.blocks.find(b=>b.type==='figure').caption,/source credit/);assert.doesNotMatch(JSON.stringify(c.blocks),/PRIVATE HIDDEN|MORE HIDDEN|recommended story/);
 const headed=source.replace('<div itemprop="articleBody">','<h2>Visible article heading takes precedence</h2><div itemprop="articleBody">');assert.equal(extractNewspaper(headed,'https://dailymail.com/news/article-12345/fixture.html').title,'Visible article heading takes precedence');
});
test('Daily Mail never widens missing body boundaries and rejects premium or hidden article content',()=>{
 const url='https://dailymail.com/news/article-12345/fixture.html';
 assert.throws(()=>extractNewspaper(fixture,url),/readable article markup/);
 assert.throws(()=>extractNewspaper(mailFixture().replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>'),url),/subscription-only/);
 assert.throws(()=>extractNewspaper(mailFixture().replace('<div itemprop="articleBody">','<div itemprop="articleBody" style="display:none">'),url),/readable article markup/);
 assert.throws(()=>extractNewspaper(mailFixture().replace('<h2>What happens next?</h2>','<p>Subscribe to continue reading this article.</p>'),url),/subscription prompt/);
});
test('Daily Mail normal fetch follows only the two explicit publisher domain aliases without cookies',async()=>{
 const calls=[];const result=await publicHTML('https://www.dailymail.co.uk/news/article-12345/fixture.html',async(url,options)=>{calls.push({url,options});assert.equal(options.headers.Cookie,undefined);return calls.length===1?new Response(null,{status:301,headers:{Location:'https://www.dailymail.com/news/article-12345/fixture.html'}}):new Response(mailFixture(),{headers:{'Content-Type':'text/html'}});});
 assert.equal(calls.length,2);assert.equal(new URL(result.url).hostname,'www.dailymail.com');
 await assert.rejects(()=>publicHTML('https://dailymail.co.uk/news/article-12345/fixture.html',async()=>new Response(null,{status:301,headers:{Location:'https://attacker.example/news/article-12345/fixture.html'}})),/not supported|different publisher/);
});

test('Star and Record use the observed strict Reach article body and retain lead-gallery captions',()=>{
 for(const host of ['dailystar.co.uk','dailyrecord.co.uk']){
 const source=fixture.replace('<article>','<article id="article-body" data-testid="body">').replace('<figure><img src="https://images.example.org/story.jpg" alt="Community hall" width="800"><figcaption>The hall.</figcaption></figure>','<button class="SlideViewerButton_slide-viewer-button__fixture"><div data-testid="leadimage"><figure><img src="https://images.example.org/story.jpg" width="800"></figure><figcaption class="ImageCaption_caption__fixture"><p>Lead photograph</p><cite>Example photographer</cite></figcaption></div></button>').replace('</article>','<div data-testid="related-articles"><p>Unrelated Reach recommendation.</p><img src="https://images.example.org/related.jpg"></div></article>');
 const c=extractNewspaper(source,'https://'+host+'/news/fixture-12345');assert.equal(c.publisher,host==='dailystar.co.uk'?'Daily Star':'Daily Record');assert.equal(c.diagnostics.paragraphCount,3);assert.equal(c.diagnostics.imageCount,1);assert.match(c.blocks.find(b=>b.type==='figure').caption,/Lead photograph.*Example photographer/);assert.doesNotMatch(JSON.stringify(c.blocks),/Unrelated Reach|related.jpg|PRIVATE HIDDEN/);
 }
});
test('new Reach profiles refuse missing bodies, real access gates and hidden gallery media',()=>{
 for(const host of ['dailystar.co.uk','dailyrecord.co.uk']){
 const url='https://'+host+'/news/fixture-12345',source=fixture.replace('<article>','<article id="article-body" data-testid="body">');
 assert.throws(()=>extractNewspaper(fixture,url),/readable article markup/);assert.throws(()=>extractNewspaper(source.replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>'),url),/subscription-only/);assert.throws(()=>extractNewspaper(source.replace('<h2>What happens next?</h2>','<p>Subscribe to continue reading this article.</p>'),url),/subscription prompt/);
 const hidden=extractNewspaper(source.replace('<figure>','<button class="SlideViewerButton_slide-viewer-button__fixture" hidden><figure>').replace('</figure>','</figure></button>'),url);assert.equal(hidden.diagnostics.imageCount,0);
 }
});
test('shared Reach markup does not permit redirects between distinct newspaper publishers',async()=>{
 await assert.rejects(()=>publicHTML('https://www.dailystar.co.uk/news/fixture-12345',async()=>new Response(null,{status:302,headers:{Location:'https://www.dailyrecord.co.uk/news/fixture-12345'}})),/different publisher/);
});

test('registered Express adapter accepts only visible regular prose and rejects nested mixed-case paid flags and CSS clipping',()=>{
 const source=fixture.replace('<div class="article-body">','<div id="singleArticle" class="single-article article-body regular"><article id="article-body"><div class="p402_premium">').replace('</div></article>','</div></article></div></article>');
 assert.ok(extractNewspaper(source,'https://express.co.uk/news/public-fixture').blocks.filter(b=>b.type==='paragraph').length>=3);
 for(const flags of ['false','FALSE',' False '])assert.throws(()=>extractNewspaper(source.replace('</head>',`<script type="application/ld+json">{"@type":"NewsArticle","hasPart":{"isAccessibleForFree":${JSON.stringify(flags)}}}</script></head>`),'https://express.co.uk/news/public-fixture'));
 for(const style of ['#article-body{max-height:50px;overflow:hidden}','#article-body p{-webkit-line-clamp:2}','#article-body{filter:blur(3px)}'])assert.throws(()=>extractNewspaper(source.replace('</head>','<style>'+style+'</style></head>'),'https://express.co.uk/news/public-fixture'));
});
