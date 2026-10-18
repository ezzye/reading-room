import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {PAPERS, extractNewspaper, publicHTML} from './newspaper-core.mjs';
import {UK_PRESS_PROFILES} from './uk-press-profiles.mjs';

// This additive module can be checked before the application imports the map.
// Registration here is confined to this test process and restored afterward.
const original = new Map(Object.keys(UK_PRESS_PROFILES).map(host => [host, PAPERS[host]]));
Object.assign(PAPERS, UK_PRESS_PROFILES);
after(() => {
  for (const [host, profile] of original) {
    if (profile) PAPERS[host] = profile;
    else delete PAPERS[host];
  }
});

const reachHosts = Object.keys(UK_PRESS_PROFILES).filter(host => host !== 'sundaypost.com');
const paragraph = label => `${label} ${'The fictional neighbourhood group discussed the proposal and recorded practical questions for a later public meeting. '.repeat(4)}`;
const prose = `<p class="Paragraph_paragraph-text__fixture">${paragraph('Opening')}</p>
<p class="Paragraph_paragraph-text__fixture">${paragraph('Middle')}</p>
<p class="Paragraph_paragraph-text__fixture">${paragraph('Closing')}</p>`;
const document = body => `<!doctype html><html><head><title>Fictional local report</title></head><body>
<h1>A fictional local report</h1>${body}</body></html>`;
const reachBody = contents => `<article id="article-body" data-testid="body" class="ArticleBody_article__fixture">${contents}</article>`;
const sundayBody = contents => `<div class="entry-content long-form" itemprop="articleBody"><div class="cms clearfix">${contents}</div>
<div class="dct-cta dct-cta--subscribe"><p>A separate publication marketing message.</p></div></div>`;
const fixture = host => document(host === 'sundaypost.com' ? sundayBody(prose) : reachBody(prose));
const url = host => `https://${host}/news/fictional-report-123456/`;

test('the observed profile map is fixed, explicit and limited to justified public domains', () => {
  assert.deepEqual(Object.keys(UK_PRESS_PROFILES).sort(), [
    'birminghammail.co.uk', 'dailypost.co.uk', 'liverpoolecho.co.uk',
    'manchestereveningnews.co.uk', 'sundaypost.com', 'walesonline.co.uk',
  ]);
  assert.ok(Object.isFrozen(UK_PRESS_PROFILES));
  for (const [host, profile] of Object.entries(UK_PRESS_PROFILES)) {
    assert.ok(Object.isFrozen(profile), host);
    assert.equal(profile.strictBody, true, host);
    assert.doesNotMatch(profile.body, /(?:^|,)\s*(?:main|article)\s*(?:,|$)/, host);
  }
  assert.equal(UK_PRESS_PROFILES['dailypost.co.uk'].name, 'North Wales Live');
  assert.equal(UK_PRESS_PROFILES['birminghammail.co.uk'].name, 'Birmingham Live');
});

test('each Reach profile keeps ordinary prose and gallery captions in source order', () => {
  const lead = '<button class="SlideViewerButton_slide-viewer-button__fixture"><div data-testid="leadimage"><figure><img width="900" src="https://images.example.org/lead.jpg"></figure><figcaption class="ImageCaption_caption__fixture"><p>A fictional photograph</p><cite>Example photographer</cite></figcaption></div></button>';
  const related = '<div data-testid="related-articles"><p>Unrelated recommended report.</p><img width="900" src="https://images.example.org/related.jpg"></div>';
  for (const host of reachHosts) {
    const capture = extractNewspaper(document(reachBody(lead + prose + related)), url(host));
    assert.equal(capture.publisher, UK_PRESS_PROFILES[host].name, host);
    assert.equal(capture.diagnostics.paragraphCount, 3, host);
    assert.equal(capture.diagnostics.imageCount, 1, host);
    assert.equal(capture.blocks[0].url, 'https://images.example.org/lead.jpg', host);
    assert.match(capture.blocks[0].caption, /fictional photograph.*Example photographer/, host);
    assert.match(capture.blocks.at(-1).text, /^Closing/, host);
    assert.doesNotMatch(JSON.stringify(capture.blocks), /Unrelated|related\.jpg/, host);
  }
});

test('Sunday Post selects its observed CMS boundary without sibling marketing or page furniture', () => {
  const image = '<figure><img width="900" src="https://images.example.org/story.jpg"><figcaption>A fictional source photo.</figcaption></figure>';
  const source = document(`<main><p>Unrelated page introduction.</p>${sundayBody(prose + image)}<p>Unrelated page footer.</p></main>`);
  const capture = extractNewspaper(source, url('sundaypost.com'));
  assert.equal(capture.publisher, 'The Sunday Post');
  assert.equal(capture.diagnostics.paragraphCount, 3);
  assert.equal(capture.diagnostics.imageCount, 1);
  assert.doesNotMatch(JSON.stringify(capture.blocks), /marketing|Unrelated/);
});

test('missing or partial strict boundaries cannot widen to generic article or main content', () => {
  for (const host of Object.keys(UK_PRESS_PROFILES)) {
    for (const wrapper of [contents => `<main>${contents}</main>`, contents => `<article>${contents}</article>`]) {
      assert.throws(() => extractNewspaper(document(wrapper(prose)), url(host)), /readable article markup/, host);
    }
  }
  for (const host of reachHosts) {
    for (const attributes of ['id="article-body"', 'data-testid="body"']) {
      assert.throws(() => extractNewspaper(document(`<article ${attributes}>${prose}</article>`), url(host)), /readable article markup/, host);
    }
  }
  for (const source of [
    document(`<div class="entry-content" itemprop="articleBody">${prose}</div>`),
    document(`<div class="cms clearfix">${prose}</div>`),
  ]) assert.throws(() => extractNewspaper(source, url('sundaypost.com')), /readable article markup/);
});

test('all added profiles retain subscription metadata and visible access-prompt rejection', () => {
  for (const host of Object.keys(UK_PRESS_PROFILES)) {
    for (const accessible of [false, 'false']) {
      const subscription = `<script type="application/ld+json">${JSON.stringify({'@type': 'NewsArticle', isAccessibleForFree: accessible})}</script>`;
      assert.throws(() => extractNewspaper(fixture(host).replace('</head>', `${subscription}</head>`), url(host)), /subscription-only/, host);
    }
    const source = fixture(host).replace('Opening ', 'Subscribe to continue reading this article. Opening ');
    assert.throws(() => extractNewspaper(source, url(host)), /subscription prompt/, host);
  }
});

test('hidden body text, hidden state and previews cannot supply a complete article', () => {
  for (const host of Object.keys(UK_PRESS_PROFILES)) {
    const build = host === 'sundaypost.com' ? sundayBody : reachBody;
    const hiddenJSON = `<script type="application/ld+json">${JSON.stringify({'@type': 'NewsArticle', articleBody: paragraph('HIDDEN STATE').repeat(4)})}</script>`;
    const preview = '<p>A short public preview cannot establish a complete readable article.</p>';
    assert.throws(() => extractNewspaper(document(build(preview) + hiddenJSON), url(host)), /short preview/, host);
    for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"']) {
      assert.throws(() => extractNewspaper(document(build(preview + `<div ${hidden}>${prose}</div>`)), url(host)), /short preview/, host);
    }
    const cssHidden = document(build(preview + `<div class="withheld-prose">${prose}</div>`)).replace('</head>', '<style>.withheld-prose{display:none}</style></head>');
    assert.throws(() => extractNewspaper(cssHidden, url(host)), /short preview/, host);
  }
});

test('added newspaper domains cannot redirect into another shared-template publisher', async () => {
  const calls = [];
  await assert.rejects(() => publicHTML(url('walesonline.co.uk'), async (target, options) => {
    calls.push({target, options});
    return new Response(null, {status: 302, headers: {Location: url('dailypost.co.uk')}});
  }), /different publisher/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Cookie, undefined);
});
