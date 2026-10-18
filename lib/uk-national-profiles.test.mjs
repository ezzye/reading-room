import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPERS, extractNewspaper} from './newspaper-core.mjs';
import {UK_NATIONAL_PROFILES} from './uk-national-profiles.mjs';

// Entirely synthetic prose: never a publisher article fixture.
const paragraph = n => `Synthetic section ${n}. ` +
  'Neighbours met at the fictional community centre to discuss a shared garden. ' +
  'Each volunteer described a practical task and agreed when to return. ' +
  'The group recorded its decisions so that everyone could review the plan. ' +
  'A second meeting will consider the remaining questions and welcome more ideas.';
const paragraphs = [1, 2, 3, 4].map(n => `<p>${paragraph(n)}</p>`).join('');
const roots = {
  'inews.co.uk': content => `<article><div id="content" class="inews__post-content entry-content article-content">${content}</div></article>`,
  'cityam.com': content => `<article class="content-container content-container__single">${content}</article>`,
  'express.co.uk': content => `<div id="singleArticle" class="single-article article-body regular"><article id="article-body">${content}</article></div>`
};
const page = (body, head = '') => `<!doctype html><html><head><title>Synthetic public report</title>${head}</head><body><h1>Synthetic public report</h1><main>${body}<p>OUTSIDE BODY: unrelated page furniture.</p></main></body></html>`;

function withProfiles(run) {
  const previous = new Map(Object.keys(UK_NATIONAL_PROFILES).map(host => [host, PAPERS[host]]));
  Object.assign(PAPERS, UK_NATIONAL_PROFILES);
  try { run(); }
  finally {
    for (const [host, profile] of previous) {
      if (profile) PAPERS[host] = profile;
      else delete PAPERS[host];
    }
  }
}

test('new national profiles use only their observed explicit article container', () => withProfiles(() => {
  for (const [host, wrap] of Object.entries(roots)) {
    const capture = extractNewspaper(page(wrap(paragraphs)), `https://${host}/synthetic-report`);
    assert.equal(capture.publisher, UK_NATIONAL_PROFILES[host].name);
    assert.equal(capture.diagnostics.paragraphCount, 4);
    assert.doesNotMatch(JSON.stringify(capture.blocks), /OUTSIDE BODY/);
    assert.throws(() => extractNewspaper(page(`<article>${paragraphs}</article>`), `https://${host}/synthetic-report`), /readable article markup/);
  }
}));

test('new national profiles reject subscriber gates, hidden bodies and hidden JSON substitutes', () => withProfiles(() => {
  for (const [host, wrap] of Object.entries(roots)) {
    const url = `https://${host}/synthetic-report`;
    assert.throws(() => extractNewspaper(page(wrap(paragraphs), '<script type="application/ld+json">{"isAccessibleForFree":false}</script>'), url), /subscription-only/);
    assert.throws(() => extractNewspaper(page(wrap(paragraphs + '<p>Subscribe to continue reading this article.</p>')), url), /subscription prompt/);
    assert.throws(() => extractNewspaper(page(`<div hidden>${wrap(paragraphs)}</div>`), url), /readable article markup/);
    assert.throws(() => extractNewspaper(page(`<article>${paragraphs}</article>`, `<script type="application/ld+json">${JSON.stringify({articleBody: paragraph(9).repeat(10)})}</script>`), url), /readable article markup/);
    const capture = extractNewspaper(page(wrap(paragraphs + '<div class="synthetic-hidden"><p>HIDDEN SYNTHETIC CONTENT</p></div>'), '<style>.synthetic-hidden{display:none}</style>'), url);
    assert.doesNotMatch(JSON.stringify(capture.blocks), /HIDDEN SYNTHETIC CONTENT/);
    assert.throws(() => extractNewspaper(page(wrap('<p>A short public preview.</p>')), url), /short preview/);
  }
}));

test('Express premium marker is refused even when article prose is present in markup', () => withProfiles(() => {
  assert.throws(() => extractNewspaper(page(roots['express.co.uk'](paragraphs).replace('article-body regular','article-body regular p402_premium')), 'https://express.co.uk/news/example-report'), /marks this article as gated/);
}));
