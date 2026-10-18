import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom/worker';
import {assertIrishIndependentPublicEligibility, IRELAND_PUBLIC_PROFILES} from './ireland-public-profiles.mjs';
import {extractNewspaper, publisherFor} from './newspaper-core.mjs';

// Synthetic prose only. Public access values mirror the observed pair's metadata.
const prose = [1,2,3,4].map(index => `<p>Synthetic section ${index}. ${'A fictional community group reviews its plans, discusses the available choices and records a practical decision for everyone to consider. '.repeat(4)}</p>`).join('');
function fixture(access = 'True', body = prose) {
  const metadata = access === undefined ? '' : `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',isAccessibleForFree:access})}</script>`;
  return `<html><head>${metadata}</head><body><article><section data-testid="article-body">${body}</section></article></body></html>`;
}
function check(html, rootStyle = {}) {
  const {document} = parseHTML(html);
  const styles = node => {
    const result = node.matches('[data-testid="article-body"]') ? {...rootStyle} : {};
    for (const raw of (node.getAttribute('style') || '').split(';')) { const i = raw.indexOf(':'); if (i > 0) result[raw.slice(0,i).trim()] = raw.slice(i+1).trim(); }
    return result;
  };
  const isHidden = node => {
    for (let n = node; n?.getAttribute; n = n.parentElement) { const s = styles(n); if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true' || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true; }
    return false;
  };
  return assertIrishIndependentPublicEligibility(document,{isHidden,styles});
}
test('Irish Independent accepts the observed explicit True public-access pattern in a strict visible body', () => {
  for (const flag of [true,'True','true','TRUE']) assert.ok(check(fixture(flag)).wordCount >= 160);
  assert.equal(IRELAND_PUBLIC_PROFILES['independent.ie'].strictBody,true);
});
test('capitalised False paid metadata and missing or conflicting public grants fail closed', () => {
  for (const flag of [false,'False','false','FALSE',null,'unknown']) assert.throws(() => check(fixture(flag)),/does not establish/);
  assert.throws(() => check(fixture().replace(/<script[^>]*>.*?<\/script>/,'')),/does not establish/);
  assert.throws(() => check(fixture().replace('</head>','<script type="application/ld+json">{"isAccessibleForFree":"False"}</script></head>')),/does not establish/);
});
test('Irish Independent rejects inline paywalls, hidden/clipped bodies, previews and generic fallback articles', () => {
  for (const html of [
    fixture('True',prose+'<div data-testid="paywall-position-inline-paywall">Access required</div>'),
    fixture('True',prose+'<div>Subscribe to continue reading this article.</div>'),
    fixture().replace('data-testid="article-body"','data-testid="article-body" hidden'),
    fixture().replace('<section data-testid="article-body">','<section>'),
    fixture('True','<p>A short ordinary preview.</p>')
  ]) assert.throws(() => check(html),/does not establish/);
  for (const style of [{'line-clamp':'3'},{filter:'blur(4px)'},{'max-height':'300px',overflow:'hidden'},{display:'none'},{'clip-path':'inset(0 0 50% 0)'}]) assert.throws(() => check(fixture(),style),/does not establish/);
  const {document} = parseHTML(fixture());
  assert.throws(() => assertIrishIndependentPublicEligibility(document),/does not establish/);
});
test('existing Irish Examiner support retains the observed selected-pair subscription refusal', () => {
  assert.equal(publisherFor('https://www.irishexaminer.com/news/arid-41925776.html').name,'Irish Examiner');
  for (const url of ['https://www.irishexaminer.com/news/arid-41925776.html','https://www.irishexaminer.com/sport/gaa/arid-41925779.html']) {
    assert.throws(() => extractNewspaper(fixture(false),url),/subscription-only/);
  }
});
