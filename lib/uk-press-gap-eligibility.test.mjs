import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom/worker';
import {assertExpressPublicEligibility, UK_PRESS_GAP_PROFILES} from './uk-press-gap-eligibility.mjs';

// Synthetic prose only; these fixtures contain no publisher reporting.
const paragraph = index => `<p>Synthetic section ${index}. ${'A fictional neighbourhood group reviews its shared garden plans and records a practical decision for the next meeting. '.repeat(4)}</p>`;
const prose = [1, 2, 3, 4].map(paragraph).join('');
const fixture = (content = prose, extra = '') => `<html><head>${extra}</head><body><div id="singleArticle" class="single-article article-body regular"><article id="article-body"><div class="ctx_content p402_premium">${content}</div></article></div></body></html>`;
function evidence(html, overrides = new Map()) {
  const {document} = parseHTML(html);
  const styles = node => {
    const value = {...overrides.get(node.id || node.getAttribute('class'))};
    for (const declaration of (node.getAttribute('style') || '').split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0) value[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
    }
    return value;
  };
  const isHidden = node => {
    for (let current = node; current?.getAttribute; current = current.parentElement) {
      const style = styles(current);
      if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    }
    return false;
  };
  return {document, options: {styles, isHidden}};
}
const check = (html, overrides) => { const {document, options} = evidence(html, overrides); return assertExpressPublicEligibility(document, options); };

test('visible substantive regular article is eligible despite a generic p402 wrapper', () => {
  const result = check(fixture());
  assert.equal(result.paragraphCount, 4);
  assert.ok(result.wordCount >= 160);
  assert.equal(UK_PRESS_GAP_PROFILES['express.co.uk'].strictBody, true);
  assert.match(UK_PRESS_GAP_PROFILES['express.co.uk'].body, /\.regular/);
});

test('paid and ambiguous regular fixtures never receive eligibility', () => {
  for (const value of [false, 'false']) {
    assert.throws(() => check(fixture(prose, `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle', isAccessibleForFree:value})}</script>`)), /does not establish/);
  }
  for (const html of [
    fixture().replace('article-body regular', 'article-body premium'),
    fixture().replace('article-body regular', 'article-body regular premium'),
    fixture().replace('article-body regular', 'article-body'),
    fixture(prose + '<p>Subscribe to continue reading this article.</p>'),
    fixture(prose + '<div>Subscribe to continue reading this article.</div>'),
    fixture(prose + '<div class="paywall-overlay">Access required</div>'),
    fixture().replace('id="article-body"', 'id="article-body" hidden'),
    fixture('<p>A short ordinary preview.</p>'),
    fixture().replace('</body>', '<div id="singleArticle"></div></body>')
  ]) assert.throws(() => check(html), /does not establish/);
  const {document} = evidence(fixture());
  assert.throws(() => assertExpressPublicEligibility(document), /does not establish/);
});

test('clamped, clipped, blurred and hidden public-looking bodies are refused', () => {
  for (const style of [
    {'-webkit-line-clamp':'3'}, {'line-clamp':'2'},
    {'max-height':'300px',overflow:'hidden'}, {height:'400px','overflow-y':'clip'},
    {filter:'blur(4px)'}, {'clip-path':'inset(0 0 60% 0)'},
    {'text-overflow':'ellipsis'}, {display:'none'}, {visibility:'hidden'}, {opacity:'0'}
  ]) assert.throws(() => check(fixture(), new Map([['article-body', style]])), /does not establish/);
  assert.throws(() => check(fixture().replace('<p>', '<p style="-webkit-line-clamp:2">')), /does not establish/);
});
