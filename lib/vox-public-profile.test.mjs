import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom/worker';
import {VOX_BODY,VOX_PUBLIC_PROFILE,assertVoxPublicEligibility,voxImageMetadata} from './vox-public-profile.mjs';

const prose='A fictional community group met to discuss an ordinary local proposal, compare several practical options, and prepare questions for a later public meeting. ';
const html=({rootClass='duet--layout--entry-body',bodyClass='duet--article--article-body-component',extra='',paragraphs=6}={})=>`<main class="${rootClass}"><h1>Fictional local proposal raises practical questions</h1><p>A short fictional standfirst.</p><figure class="duet--layout--entry-image"><img src="https://images.example.org/fictional.jpg"><figcaption class="duet--media--caption">A fictional scene. <cite>Example photographer</cite></figcaption></figure><div id="zephr-anchor">${Array.from({length:paragraphs},(_,i)=>`<div class="${bodyClass}"><p>${prose.repeat(i===0?8:5)}</p></div>`).join('')}</div>${extra}</main>`;
const check=source=>{const {document}=parseHTML(source);const isHidden=node=>node.hasAttribute('data-hidden')||Boolean(node.closest('[data-hidden]'));const styles=node=>Object.fromEntries((node.getAttribute('style')||'').split(';').map(x=>x.split(':').map(y=>y.trim())).filter(x=>x.length===2));assertVoxPublicEligibility(document,{isHidden,styles});return document;};

test('Vox profile requires one visible entry body and enough unclamped article text',()=>{
 assert.equal(VOX_PUBLIC_PROFILE.body,VOX_BODY);assert.equal(VOX_PUBLIC_PROFILE.strictBody,true);assert(Object.isFrozen(VOX_PUBLIC_PROFILE));
 assert.doesNotThrow(()=>check(html()));
 for(const source of [html({rootClass:'preview'}),html({bodyClass:'preview-body'}),html({paragraphs:1})])assert.throws(()=>check(source),/complete, visible public Vox article/);
});

test('Vox eligibility refuses hidden, clamped, blurred and subscription-prompt content',()=>{
 assert.throws(()=>check(html().replace('class="duet--layout--entry-body"','class="duet--layout--entry-body" data-hidden')),/complete, visible public Vox article/);
 assert.throws(()=>check(html().replace('<div id="zephr-anchor">','<div id="zephr-anchor" style="-webkit-line-clamp: 2">')),/complete, visible public Vox article/);
 assert.throws(()=>check(html().replace('<div id="zephr-anchor">','<div id="zephr-anchor" style="filter: blur(3px)">')),/complete, visible public Vox article/);
 assert.throws(()=>check(html({extra:'<div class="duet--article--article-body-component"><p>Subscribe to access this article.</p></div>'})),/complete, visible public Vox article/);
});

test('Vox lead image caption and photographer credit come from the visible figure',()=>{
 const {document}=parseHTML(html()),img=document.querySelector('img'),metadata=voxImageMetadata(img);
 assert.equal(metadata.caption,'A fictional scene. Example photographer');assert.equal(metadata.credit,'Example photographer');
 assert.deepEqual(voxImageMetadata(document.createElement('img')),{});
});
