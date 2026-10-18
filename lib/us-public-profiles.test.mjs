import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {PAPERS, extractNewspaper, publicHTML} from './newspaper-core.mjs';
import {US_PUBLIC_PROFILES} from './us-public-profiles.mjs';

// Register only inside this test process; the application integration is separate.
const previous = new Map(Object.keys(US_PUBLIC_PROFILES).map(host => [host, PAPERS[host]]));
Object.assign(PAPERS, US_PUBLIC_PROFILES);
after(() => {
  for (const [host, profile] of previous) {
    if (profile) PAPERS[host] = profile;
    else delete PAPERS[host];
  }
});

const sourceURL = 'https://www.npr.org/2026/10/18/nx-s1-1234567/fictional-report';
const paragraph = label => `${label} ${'The fictional neighbourhood group met to discuss a proposal and record questions that residents wanted answered at a later public meeting. '.repeat(4)}`;
const body = `<p>${paragraph('First')}</p><p>${paragraph('Second')}</p><p>${paragraph('Third')}</p>`;
const document = content => `<!doctype html><html><head><title>A fictional NPR report</title></head><body><h1>A fictional NPR report</h1><article>${content}</article></body></html>`;
const story = content => `<div id="storytext" class="storytext storylocation linkLocation">${content}</div>`;

test('the US map adds only the public NPR news comparator with a fixed strict boundary', () => {
  assert.deepEqual(Object.keys(US_PUBLIC_PROFILES), ['npr.org']);
  assert.ok(Object.isFrozen(US_PUBLIC_PROFILES));
  assert.ok(Object.isFrozen(US_PUBLIC_PROFILES['npr.org']));
  assert.equal(US_PUBLIC_PROFILES['npr.org'].strictBody, true);
  assert.equal(US_PUBLIC_PROFILES['npr.org'].body, '#storytext.storytext');
  for (const host of ['nytimes.com','washingtonpost.com','wsj.com','usatoday.com','apnews.com']) assert.equal(US_PUBLIC_PROFILES[host], undefined);
});

test('NPR retains visible source-order prose, ordinary figure captions and reference counts', () => {
  const figure = '<figure><img width="1000" src="https://images.example.org/public-photo.jpg"><figcaption>A fictional photograph with its source credit.</figcaption></figure>';
  const capture = extractNewspaper(document(story(body.replace('<p>Second', figure + '<p>Second'))), sourceURL);
  assert.equal(capture.publisher, 'NPR');
  assert.equal(capture.diagnostics.paragraphCount, 3);
  assert.equal(capture.diagnostics.imageCount, 1);
  assert.equal(capture.diagnostics.videoCount, 0);
  assert.equal(capture.diagnostics.completeNotCertified, true);
  assert.match(capture.blocks[0].text, /^First/);
  assert.equal(capture.blocks[1].url, 'https://images.example.org/public-photo.jpg');
  assert.match(capture.blocks[1].caption, /source credit/);
  assert.match(capture.blocks.at(-1).text, /^Third/);
});

test('NPR does not widen missing or partial roots to generic articles or copied page furniture', () => {
  for (const content of [body, `<main>${body}</main>`, `<div id="storytext">${body}</div>`, `<div class="storytext">${body}</div>`]) {
    assert.throws(() => extractNewspaper(document(content), sourceURL), /readable article markup/);
  }
  const source = document(story(body + '<aside><p>Unrelated sidebar report that is outside the source article.</p><img width="900" src="https://images.example.org/recommendation.jpg"></aside>'));
  const capture = extractNewspaper(source, sourceURL);
  assert.equal(capture.diagnostics.paragraphCount, 3);
  assert.equal(capture.diagnostics.imageCount, 0);
  assert.doesNotMatch(JSON.stringify(capture.blocks), /Unrelated|recommendation/);
});

test('subscription flags, visible prompts and browser challenges are refused', () => {
  for (const accessible of [false, 'false']) {
    const source = document(story(body)).replace('</head>', `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',isAccessibleForFree:accessible})}</script></head>`);
    assert.throws(() => extractNewspaper(source, sourceURL), /subscription-only/);
  }
  assert.throws(() => extractNewspaper(document(story('<p>Subscribe to continue reading this article.</p>' + body)), sourceURL), /subscription prompt/);
  assert.throws(() => extractNewspaper(document(story(body)).replace('<title>A fictional NPR report</title>', '<title>Verify you are human</title>'), sourceURL), /browser check/);
});

test('hidden markup and JSON article bodies cannot make a public preview complete', () => {
  const preview = '<p>A short public preview does not establish a complete source article.</p>';
  const hiddenJSON = `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',articleBody:paragraph('HIDDEN STATE').repeat(5)})}</script>`;
  assert.throws(() => extractNewspaper(document(story(preview) + hiddenJSON), sourceURL), /short preview/);
  for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"']) {
    assert.throws(() => extractNewspaper(document(story(preview + `<div ${hidden}>${body}</div>`)), sourceURL), /short preview/);
  }
  const cssHidden = document(story(preview + `<div class="withheld">${body}</div>`)).replace('</head>', '<style>.withheld{display:none}</style></head>');
  assert.throws(() => extractNewspaper(cssHidden, sourceURL), /short preview/);
});

test('NPR public requests cannot cross into another newspaper publisher after a redirect', async () => {
  let calls = 0;
  await assert.rejects(() => publicHTML(sourceURL, async () => {
    calls++;
    return new Response(null, {status:302, headers:{Location:'https://www.nytimes.com/2026/10/18/world/fictional.html'}});
  }), /different publisher/);
  assert.equal(calls, 1);
});

test('NPR excludes only inline related cards, relocates photo caption/credit and uses measured role fallbacks',()=>{
  const image='<div class="bucketwrap image large"><div class="imagewrap"><picture><img width="1100" src="https://images.example.org/report-photo.jpg"></picture></div><div class="credit-caption"><div class="caption-wrap"><div class="caption"><p>Synthetic photograph caption. <b class="credit">Example Photographer/Agency</b><b class="hide-caption">hide caption</b></p></div><button class="toggle-caption">toggle caption i</button></div><span class="credit">Example Photographer/Agency</span></div></div>';
  const card='<div id="resnx-s1-synthetic-100" class="bucketwrap internallink insettwocolumn inset2col"><div class="bucket img"><a class="imagewrap"><picture><img width="600" src="https://images.example.org/related-card.jpg"></picture></a></div><h3>SYNTHETIC RELATED CATEGORY</h3><h2>SYNTHETIC RELATED HEADLINE</h2></div>';
  const source=document(story(body.replace('<p>Second',image+card+'<h2>Ordinary reporting section</h2><p>Second')));
  const capture=extractNewspaper(source,sourceURL),figure=capture.blocks.find(b=>b.type==='figure');
  assert.equal(capture.diagnostics.imageCount,1);assert.equal(capture.diagnostics.paragraphCount,3);
  assert.equal(figure.caption,'Synthetic photograph caption.');assert.equal(figure.credit,'Example Photographer/Agency');
  assert.doesNotMatch(JSON.stringify(capture.blocks),/SYNTHETIC RELATED|related-card|hide caption|toggle caption/);
  assert(capture.blocks.some(b=>b.type==='heading'&&b.text==='Ordinary reporting section'));
  assert.equal(capture.design.headlineStyle.fontSize,'32px');assert.equal(capture.design.headlineStyle.lineHeight,'40px');
  assert.equal(capture.design.headlineStyle.fontFamily,'NPRSans, Helvetica, Arial, sans-serif');
  assert.equal(capture.design.bodyStyle.fontSize,'18px');assert.equal(capture.design.bodyStyle.lineHeight,'27px');
  assert.equal(capture.blocks[0].style.fontFamily,'NPRSerif, Georgia, serif');
});
