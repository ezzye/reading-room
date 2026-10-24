import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchVoxFeedCapture,VOX_FEED_URL} from './vox-public-feed.mjs';

const articleURL='https://www.vox.com/future-perfect/fictional-feed-story?utm_source=fixture';
const publicURL='https://vox.com/future-perfect/fictional-feed-story';
const long=(label)=>`${label}: a fictional community considered several practical choices for a local project, gathered views from residents, compared the likely effects of each option, and prepared questions for a public discussion. These observations describe an invented example and do not refer to a real person, place, or event.`;
const cdata=value=>'<![CDATA['+String(value).replace(/\]\]>/g,']]]]><![CDATA[>')+']]>';
const entry=({href=articleURL,title='A fictional &amp; encoded title &#8217; for readers',contentType='html',content,summary='',authors=['Example Reporter'],published='2026-10-24T12:00:00Z'}={})=>{
 const author=authors.map(name=>`<author><name>${name}</name></author>`).join('');
 const body=contentType==='xhtml'?`<content type="xhtml">${content}</content>`:`<content type="${contentType}">${cdata(content)}</content>`;
 return `<entry>${author}<title type="html">${cdata(title)}</title><link rel="alternate" type="text/html" href="${href}"/><id>https://www.vox.com/?p=fixture</id><published>${published}</published>${summary?`<summary type="html">${cdata(summary)}</summary>`:''}${body}</entry>`;
};
const feed=(entries,{id=VOX_FEED_URL,self=VOX_FEED_URL,namespace='http://www.w3.org/2005/Atom'}={})=>`<?xml version="1.0"?><feed xmlns="${namespace}"><title type="text">Vox</title><id>${id}</id><link rel="self" type="application/atom+xml" href="${self}"/>${entries}</feed>`;
const html=`<p>Short source paragraph.</p><figure><img src="https://images.example.org/scene.jpg" alt="Fictional scene" data-portal-copyright="Example Photographer"><figcaption>A fictional scene described in the feed. <cite>Example Photographer</cite></figcaption></figure><figure><img src="http://127.0.0.1/private.jpg" alt="Unsafe image"></figure><h2>Questions for discussion</h2><blockquote><p>${long('Quoted example')}</p></blockquote><p>${long('Paragraph two')}</p><p>${long('Paragraph three')}</p><p>${long('Paragraph four')}</p><div class="wp-block-post-author"><img src="https://images.example.org/author-avatar.jpg" class="avatar"><p>Author card copy must be excluded.</p></div><div class="related-stories"><p>Related promotion must be excluded.</p></div><div class="newsletter-promo"><p>Newsletter copy must be excluded.</p></div><footer><p>Footer copy must be excluded.</p></footer><nav><p>Navigation copy must be excluded.</p></nav><div hidden><p>Hidden copy must be excluded.</p></div><form><p>Form copy must be excluded.</p></form><iframe src="https://www.youtube.com/embed/AbCdEfGh123" title="Fictional source video"></iframe><iframe src="https://open.spotify.com/embed/show/0xv3qPaQ9tu0l5zyz7AQkx" title="Unsupported player"></iframe>`;
const response=(body,{status=200,type='application/xml; charset=UTF-8',length}={})=>new Response(body,{status,headers:{'Content-Type':type,...(length?{'Content-Length':String(length)}:{})}});
const fetcherFor=(body,options={})=>async(url,init)=>{
 assert.equal(url,VOX_FEED_URL);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers['User-Agent'],'ReadEveryThing/1.0 (public article reader)');
 return response(body,options);
};

test('Vox public feed binds to the exact canonical Vox path and returns source-order media and metadata',async()=>{
 let calls=0;const xml=feed(entry({content:html,summary:'Summary text is never imported.',authors:['Example Reporter','Another Example']}));
 const capture=await fetchVoxFeedCapture(articleURL,async(url,init)=>{calls++;return fetcherFor(xml)(url,init);});
 assert.equal(calls,1);assert.equal(capture.url,publicURL);assert.equal(capture.title,'A fictional & encoded title ’ for readers');assert.equal(capture.publisher,'Vox');assert.equal(capture.byline,'Example Reporter, Another Example');assert.equal(capture.date,'2026-10-24T12:00:00Z');
 assert.deepEqual(capture.blocks.filter(block=>['paragraph','figure','heading','quote','video'].includes(block.type)).map(block=>block.type),['paragraph','figure','heading','quote','paragraph','paragraph','paragraph','video']);
 const image=capture.blocks.find(block=>block.type==='figure');assert.equal(image.url,'https://images.example.org/scene.jpg');assert.equal(image.caption,'A fictional scene described in the feed. Example Photographer');assert.equal(image.credit,'Example Photographer');
 assert.equal(capture.blocks.filter(block=>block.type==='paragraph')[0].text,'Short source paragraph.');
 assert.equal(capture.blocks.some(block=>/Summary text|Author card|Related promotion|Newsletter copy|Footer copy|Navigation copy|Hidden copy|Form copy|Unsupported player/.test(block.text||block.caption||'')),false);
 assert.equal(capture.blocks.some(block=>block.url==='https://images.example.org/author-avatar.jpg'),false);
 assert.equal(capture.blocks.some(block=>block.url?.includes('127.0.0.1')),false);
 assert.equal(capture.blocks.filter(block=>block.type==='video').length,1);assert.equal(capture.blocks.find(block=>block.type==='video').url,'https://www.youtube-nocookie.com/embed/AbCdEfGh123');
 assert.equal(capture.presentation.method,'public-feed');assert.equal(capture.presentation.extractorRevision,2);assert.equal(capture.presentation.brandColor,'#e85d3f');assert.equal(capture.diagnostics.publisherFeedURL,VOX_FEED_URL);
});

test('Vox feed matches apex and www hosts by normalized path and ignores tracking parameters',async()=>{
 const xml=feed(entry({href:'https://www.vox.com/future-perfect/fictional-feed-story/?utm_source=feed',content:html}));
 const capture=await fetchVoxFeedCapture('https://vox.com/future-perfect/fictional-feed-story?utm_campaign=elsewhere',fetcherFor(xml));
 assert.equal(capture.url,publicURL);
 assert.equal(await fetchVoxFeedCapture('https://vox.com/future-perfect/a-different-story',fetcherFor(xml)),null);
 await assert.rejects(fetchVoxFeedCapture('https://vox.com/future-perfect/fictional-feed-story?account=private',fetcherFor(xml)));
});

test('Vox feed refuses duplicate matching entries and duplicate matching alternate links',async()=>{
 const one=entry({content:html});
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(one+one))),/duplicate article entries/);
 const duplicate=one.replace('</entry>',`<link rel="alternate" type="text/html" href="${publicURL}"/></entry>`);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(duplicate))),/more than one matching article link/);
});

test('Vox feed requires real HTML or XHTML content and refuses preview material',async()=>{
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:'',contentType:'summary'})))),/complete readable story/);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:`<p>${long('One')}</p><p>${long('Two')}</p><p>${long('Three')}</p><p>Continue reading to unlock this article.</p>`})))),/complete readable story/);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:`<p>${long('One')}</p><p>${long('Two')}</p><p>${long('Three')}</p><div class="paywall">Preview only</div>`})))),/complete readable story/);
});

test('Vox feed preserves ordered and unordered list items in their original positions',async()=>{
 const listHTML=`<p>${long('Opening')}</p><ol start="3"><li><p>First fictional safety step: review the plan before acting.</p></li><li value="9"><p>Second fictional safety step: update trusted software.</p><ol><li>Nested fictional reminder: check recovery options.</li></ol></li><li><p>Third fictional safety step: keep a separate backup.</p></li></ol><ul><li>Final fictional reminder: ask a trusted person when uncertain.</li></ul><p>${long('Closing one')}</p><p>${long('Closing two')}</p>`;
 const capture=await fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:listHTML}))));
 assert.deepEqual(capture.blocks.filter(block=>block.type==='paragraph').map(block=>block.text),[
  long('Opening'),'3. First fictional safety step: review the plan before acting.','9. Second fictional safety step: update trusted software.','1. Nested fictional reminder: check recovery options.','10. Third fictional safety step: keep a separate backup.','• Final fictional reminder: ask a trusted person when uncertain.',long('Closing one'),long('Closing two')
 ]);
});

test('Vox XHTML feed content and short paragraphs are safely converted',async()=>{
 const xhtml='<div xmlns="http://www.w3.org/1999/xhtml"><p>Yes.</p><figure><img src="https://images.example.org/xhtml.jpg"/><figcaption>XHTML image <cite>Example Credit</cite></figcaption></figure>'+['One','Two','Three','Four'].map(label=>`<p>${long(label)}</p>`).join('')+'</div>';
 const capture=await fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({contentType:'xhtml',content:xhtml}))));
 assert.equal(capture.blocks[0].text,'Yes.');assert.equal(capture.blocks[1].type,'figure');assert.equal(capture.blocks[1].url,'https://images.example.org/xhtml.jpg');assert.equal(capture.blocks[1].credit,'Example Credit');
});

test('Vox feed refuses unsafe URLs, untrusted feeds, XML entities, redirects and oversized responses',async()=>{
 const userinfo=new URL('https://vox.com/story');userinfo.username='user';
 for(const raw of ['http://vox.com/story','https://evil.example/story',userinfo.href,'https://vox.com:8443/story'])await assert.rejects(fetchVoxFeedCapture(raw,fetcherFor(feed(entry({content:html})))));
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:html}),{id:'https://evil.example/feed'}))),/complete readable story/);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+feed(entry({content:html})))));
 const tooMany=Array.from({length:31},(_,index)=>entry({href:`https://www.vox.com/other/story-${index}`,content:'<p>Unmatched story.</p>'})).join('');
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(tooMany))),/complete readable story/);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:html})),{status:302,type:'application/xml',length:0})),/temporarily unavailable/);
 await assert.rejects(fetchVoxFeedCapture(articleURL,fetcherFor(feed(entry({content:html})),{length:1_000_001})),/complete readable story/);
});

test('Vox feed imports only the fixed public endpoint and never mutates caller input',async()=>{
 const raw=Object.freeze('https://www.vox.com/future-perfect/fictional-feed-story?utm_source=fixture');
 let calls=0;const xml=feed(entry({content:html}));
 const capture=await fetchVoxFeedCapture(raw,async(url,init)=>{calls++;assert.equal(url,VOX_FEED_URL);assert.equal(url,'https://www.vox.com/rss/index.xml');return fetcherFor(xml)(url,init);});
 assert.equal(calls,1);assert.equal(raw,'https://www.vox.com/future-perfect/fictional-feed-story?utm_source=fixture');assert.equal(capture.url,publicURL);
});
