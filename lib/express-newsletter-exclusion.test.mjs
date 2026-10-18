import test from 'node:test';
import assert from 'node:assert/strict';
import {extractNewspaper,publisherFor} from './newspaper-core.mjs';

// Synthetic article and signup copy only. The container shape matches the
// ordinary source observation, without retaining publisher reporting.
const url='https://www.express.co.uk/showbiz/tv-radio/2258269/strictly-star-forced-leave-bbc-show-immediately';
const paragraph=index=>`Synthetic report section ${index}. ${'Residents considered a fictional shared garden, discussed the choices and recorded a practical decision for the next community meeting. '.repeat(4)}${index===2?' The report also discusses newsletter privacy rules for residents aged 18 or over.':''}`;
const signup=`<div class="newsletter-pure"><div class="t cc"><var>Synthetic newsletter</var><input><div>Signup field</div><button>Sign up</button><span></span><span></span><p>SYNTHETIC_PROMO_PRIVACY: You agree you are 18 or over. Synthetic signup terms apply. <u>Consent information</u> <a href="https://example.org/privacy">Privacy policy</a></p><img width="900" src="https://images.example.org/newsletter-banner.jpg"></div></div>`;
const page=body=>`<!doctype html><html><head><title>Synthetic public report</title></head><body><h1>Synthetic public report</h1><div id="singleArticle" class="single-article article-body regular"><article id="article-body"><div class="ctx_content p402_premium"><div class="clearfix hR new-style">${body}</div></div></article></div></body></html>`;

test('Express drops only the observed newsletter subtree and retains similarly worded reporting and media',()=>{
  assert.equal(publisherFor(url).excludeSelector,'.newsletter-pure');
  const source=page(`<p>${paragraph(1)}</p><figure><img width="900" src="https://images.example.org/report.jpg"><figcaption>Synthetic reporting image</figcaption></figure><p>${paragraph(2)}</p>${signup}<p>${paragraph(3)}</p><p>${paragraph(4)}</p>`);
  const capture=extractNewspaper(source,url),paragraphs=capture.blocks.filter(block=>block.type==='paragraph');
  assert.equal(paragraphs.length,4);
  assert.deepEqual(paragraphs.map(block=>block.text),[1,2,3,4].map(index=>paragraph(index).replace(/\s+/g,' ').trim()));
  assert.match(paragraphs[1].text,/newsletter privacy rules.*18 or over/);
  assert.equal(capture.diagnostics.imageCount,1);
  assert.equal(capture.blocks.find(block=>block.type==='figure').url,'https://images.example.org/report.jpg');
  assert.doesNotMatch(JSON.stringify(capture.blocks),/SYNTHETIC_PROMO_PRIVACY|newsletter-banner|Synthetic signup terms/);
  assert.equal(capture.url,publisherFor(url).url);
});

test('newsletter copy cannot make a short public preview pass the article threshold',()=>{
  const oversizedSignup=signup.replace('Synthetic signup terms apply.',paragraph(9).repeat(3));
  assert.throws(()=>extractNewspaper(page('<p>A short ordinary report preview.</p>'+oversizedSignup),url),/short preview|does not establish/);
});
