import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom/worker';
import {normalizeCapture} from './capture-core.mjs';
import {extractNewspaper} from './newspaper-core.mjs';
import {VOX_BODY,VOX_PUBLIC_PROFILE,assertVoxPublicEligibility,voxImageMetadata} from './vox-public-profile.mjs';

const sourceURL='https://www.vox.com/future-perfect/fictional-public-story';
const prose=(index)=>`Fictional paragraph ${index}: a community group compared practical options for an ordinary local proposal, recorded questions for a public meeting, and considered how different residents might be affected by each choice.`;
const component=(index,content=prose(index),style='')=>`<div class="duet--article--article-body-component"${style?` style="${style}"`:''}><p>${content}</p></div>`;
const fixture=({rootClass='duet--layout--entry-body',componentClass='duet--article--article-body-component',paragraphs=6,extra='',bodyStyle=''}={})=>{
 const parts=Array.from({length:paragraphs},(_,i)=>component(i+1,prose(i+1)).replaceAll('duet--article--article-body-component',componentClass));
 const image='<figure class="duet--layout--entry-image"><img width="1200" src="https://images.example.org/scene-800.jpg" srcset="https://images.example.org/scene-800.jpg 800w, https://images.example.org/scene-1200.jpg 1200w"><figcaption class="duet--media--caption">A fictional scene. <cite>Example photographer</cite></figcaption></figure>';
 parts.splice(Math.min(3,parts.length),0,image);
 const body=parts.join('');
 const publicMarker='<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":true}</script>';
 return `${publicMarker}<main class="${rootClass}"${bodyStyle?` style="${bodyStyle}"`:''}><h1>Fictional local proposal raises practical questions</h1><p>A short fictional standfirst.</p><div class="duet--byline"><img class="author-avatar" width="240" src="https://images.example.org/avatar.jpg"><span>Example Reporter</span></div><div id="zephr-anchor">${body}<div class="related-stories"><p>Related promo text should not enter the article.</p></div>${extra}</div><footer><p>Footer text should not enter the article.</p></footer></main>`;
};
const check=source=>{
 const {document}=parseHTML(source);
 const isHidden=node=>node.hasAttribute('data-hidden')||Boolean(node.closest('[data-hidden]'));
 const styles=node=>Object.fromEntries((node.getAttribute('style')||'').split(';').map(x=>x.split(':').map(y=>y.trim())).filter(x=>x.length===2));
 assertVoxPublicEligibility(document,{isHidden,styles});
 return document;
};

test('Vox profile requires one visible entry body and enough unclamped article text',()=>{
 assert.equal(VOX_PUBLIC_PROFILE.body,VOX_BODY);assert.equal(VOX_PUBLIC_PROFILE.strictBody,true);assert.equal(VOX_PUBLIC_PROFILE.extractorRevision,2);assert(Object.isFrozen(VOX_PUBLIC_PROFILE));
 assert.doesNotThrow(()=>check(fixture()));
 for(const source of [fixture({rootClass:'preview'}),fixture({componentClass:'preview-body'}),fixture({paragraphs:1})])assert.throws(()=>check(source),/complete, visible public Vox article/);
});

test('Vox extraction keeps source order and visible figure details while excluding page furniture',()=>{
 const capture=extractNewspaper(fixture(),sourceURL),content=capture.blocks.filter(block=>block.type==='paragraph'||block.type==='figure');
 assert.deepEqual(content.map(block=>block.type),['paragraph','paragraph','paragraph','figure','paragraph','paragraph','paragraph']);
 assert.match(content[0].text,/Fictional paragraph 1/);assert.match(content[2].text,/Fictional paragraph 3/);assert.match(content[4].text,/Fictional paragraph 4/);
 assert.equal(content[3].url,'https://images.example.org/scene-1200.jpg');assert.equal(content[3].caption,'A fictional scene. Example photographer');assert.equal(content[3].credit,'Example photographer');
 assert.equal(capture.url,'https://vox.com/future-perfect/fictional-public-story');assert.equal(capture.publisher,'Vox');assert.equal(capture.presentation.extractorRevision,2);
 assert.equal(capture.blocks.some(block=>/Related promo|Footer text|Example Reporter/.test(block.text||block.caption||'')),false);
 assert.equal(capture.blocks.some(block=>block.url==='https://images.example.org/avatar.jpg'),false);
 const normalized=normalizeCapture(capture);assert.equal(normalized.presentation.extractorRevision,2);assert.equal(normalized.blocks.find(block=>block.type==='figure').url,'https://images.example.org/scene-1200.jpg');
});

test('Vox image caption and photographer credit come from the visible figure',()=>{
 const {document}=parseHTML(fixture()),img=document.querySelector('.duet--layout--entry-image img'),metadata=voxImageMetadata(img);
 assert.equal(metadata.caption,'A fictional scene. Example photographer');assert.equal(metadata.credit,'Example photographer');
 assert.deepEqual(voxImageMetadata(document.createElement('img')),{});
});

test('Vox eligibility accepts an ordinary public-access marker and refuses subscription markers',()=>{
 assert.doesNotThrow(()=>extractNewspaper(fixture(),sourceURL));
 const falseMarker=fixture().replace('"isAccessibleForFree":true','"isAccessibleForFree":false');
 assert.throws(()=>extractNewspaper(falseMarker,sourceURL),/subscription-only/);
});

test('Vox eligibility refuses hidden, clamped, blurred, prompted and incomplete content',()=>{
 assert.throws(()=>extractNewspaper(fixture({bodyStyle:'display:none'}),sourceURL),/complete, visible public Vox article/);
 assert.throws(()=>extractNewspaper(fixture({bodyStyle:'-webkit-line-clamp:2'}),sourceURL),/complete, visible public Vox article/);
 assert.throws(()=>extractNewspaper(fixture({bodyStyle:'filter:blur(3px)'}),sourceURL),/complete, visible public Vox article/);
 assert.throws(()=>extractNewspaper(fixture({extra:'<div class="duet--article--article-body-component"><p>Subscribe to access this article.</p></div>'}),sourceURL),/complete, visible public Vox article/);
 assert.throws(()=>extractNewspaper(fixture({paragraphs:1}),sourceURL),/complete, visible public Vox article/);
});
