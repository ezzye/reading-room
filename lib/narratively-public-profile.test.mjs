import test from 'node:test';
import assert from 'node:assert/strict';
import {extractNewspaper,publisherFor} from './newspaper-core.mjs';
import {NARRATIVELY_BODY,NARRATIVELY_PUBLIC_PROFILE} from './narratively-public-profile.mjs';
import {VOX_PUBLIC_PROFILE} from './vox-public-profile.mjs';

const nurl='https://www.narratively.com/p/synthetic-public-essay',vurl='https://www.vox.com/first-person/synthetic-public-essay';
const paragraph=label=>label+' '+('A fictional writer describes an ordinary community project, weighs several practical choices, and explains why careful questions matter before people make a decision. '.repeat(3));
const article=()=>Array.from({length:5},(_,i)=>`<p>${paragraph('Synthetic section '+i)}</p>`).join('');
const nhtml=({body=article(),extra='',json=false}={})=>`<!doctype html><html><head><title>Synthetic Narratively essay</title><meta name="author" content="Synthetic Author"><meta property="article:published_time" content="2026-10-20T12:00:00Z">${json?'<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>':''}</head><body><h1 class="post-title">A synthetic essay about practical choices</h1><h3 class="subtitle">A short fictional standfirst.</h3><div class="available-content"><div class="body markup">${body}</div></div>${extra}<footer><p>Fictional unrelated footer recommendation.</p></footer></body></html>`;
const vhtml=({body=article(),extra='',json=false}={})=>`<!doctype html><html><head><title>Synthetic Vox essay</title><meta name="author" content="Synthetic Vox Author"><meta property="article:published_time" content="2026-10-20T12:00:00Z">${json?'<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>':''}</head><body><main class="duet--layout--entry-body"><h1>A synthetic Vox essay</h1><p>A short fictional standfirst.</p><figure class="duet--layout--entry-image"><img src="https://images.example.org/vox.jpg"><figcaption class="duet--media--caption">A fictional image. <cite>Example credit</cite></figcaption></figure><div id="zephr-anchor">${Array.from({length:5},(_,i)=>`<div class="duet--article--article-body-component"><p>${paragraph('Vox section '+i)}</p></div>`).join('')}${body}${extra}</div></main><footer><p>Fictional unrelated footer recommendation.</p></footer></body></html>`;

test('Narratively profile extracts the observed strict article, metadata, standfirst and figure credit only',()=>{
 assert.equal(NARRATIVELY_PUBLIC_PROFILE.body,NARRATIVELY_BODY);assert.equal(NARRATIVELY_PUBLIC_PROFILE.strictBody,true);assert.equal(publisherFor(nurl).name,'Narratively');
 const figure='<figure><img src="https://images.example.org/essay.jpg"><figcaption>A fictional illustration. <cite>Synthetic illustrator</cite></figcaption></figure>',capture=extractNewspaper(nhtml({body:article()+figure,extra:'<aside><p>Outside recommendation excluded.</p></aside>'}),nurl);
 assert.equal(capture.title,'A synthetic essay about practical choices');assert.equal(capture.byline,'Synthetic Author');assert.equal(capture.date,'2026-10-20T12:00:00Z');assert.equal(capture.standfirst,'A short fictional standfirst.');assert.equal(capture.diagnostics.imageCount,1);assert.equal(capture.blocks.find(x=>x.type==='figure').credit,'Synthetic illustrator');assert.doesNotMatch(JSON.stringify(capture.blocks),/Outside recommendation|unrelated footer/);
});

test('Narratively rejects hidden, clamped, short, paywalled and false-free-metadata pages',()=>{
 const cases=[nhtml({body:'<div hidden>'+article()+'</div>'}),nhtml({body:'<div style="max-height:40px;overflow:hidden">'+article()+'</div>'}),nhtml({body:'<p>A short synthetic preview.</p>'}),nhtml({body:article()+'<p>Subscribe to access this post.</p>'}),nhtml({body:article(),json:true})];
 for(const source of cases)assert.throws(()=>extractNewspaper(source,nurl),/complete, visible public Narratively article|subscription-only|short preview/);
});

test('Vox profile extracts its standfirst and credited visible lead image while keeping outside furniture out',()=>{
 assert.equal(VOX_PUBLIC_PROFILE.standfirstSelector,'h1 + p');assert.equal(publisherFor(vurl).name,'Vox');const capture=extractNewspaper(vhtml(),vurl);
 assert.equal(capture.standfirst,'A short fictional standfirst.');assert.equal(capture.byline,'Synthetic Vox Author');assert.equal(capture.date,'2026-10-20T12:00:00Z');assert.equal(capture.blocks.find(x=>x.type==='figure').credit,'Example credit');assert.doesNotMatch(JSON.stringify(capture.blocks),/unrelated footer/);
 assert.throws(()=>extractNewspaper(vhtml({json:true}),vurl),/subscription-only/);
});


test('Narratively keeps the visible publication date when the source supplies no machine datetime',()=>{
 const source=nhtml().replace('<meta property="article:published_time" content="2026-10-20T12:00:00Z">','').replace('<h3 class="subtitle">','<time>Mar 07, 2016</time><h3 class="subtitle">');
 assert.equal(extractNewspaper(source,nurl).date,'Mar 07, 2016');
});
