import test from 'node:test';
import assert from 'node:assert/strict';
import {articleIdentity, discoverArticleMedia, mediaSourceSummary} from './article-media.mjs';

const url = 'https://www.example.org/news/the-river-walk';
const title = 'A new walk beside the river';
const capture = (changes = {}) => ({url, title, standfirst: 'Volunteers share their findings.', blocks: [{id: 'B1', type: 'paragraph', text: 'Existing library text.'}], ...changes});
const source = (html, changes = {}) => ({url, title, html, kind: 'article', ...changes});
const discover = (html, changes = {}) => discoverArticleMedia(capture(), [source(html, changes)]);
const image = '<figure><img src="/media/walk.jpg" alt="River walk"><figcaption>The northern route. <span class="credit">Mara Bell</span></figcaption></figure>';

test('changed headline needs exact canonical identity; preserves provenance and caption credit', () => {
  const html = '<link rel="canonical" href="'+url+'"><article><h1>The route has reopened</h1>'+image+'</article>';
  const result = discover(html);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].url, 'https://www.example.org/media/walk.jpg');
  assert.equal(result.blocks[0].credit, 'Mara Bell');
  assert.match(result.blocks[0].caption, /The northern route/);
  assert.equal(result.blocks[0].basis, 'exact-article-visible-media');
  assert.equal(result.blocks[0].placement, 'approximate');
  assert.equal(result.receipts[0].originalPlacementVerified, false);
  assert.equal(discover('<article><h1>The route has reopened</h1>'+image+'</article>').blocks.length, 0);
});

test('generic banners, wrong canonical identities and non-article source URLs are rejected', () => {
  assert.equal(discover('<link rel="canonical" href="https://www.example.org/"><meta property="og:image" content="/banner.jpg"><h1>'+title+'</h1>').blocks.length, 0);
  assert.equal(discover('<meta property="og:image" content="/banner.jpg"><h1>Read our latest news</h1>').blocks.length, 0);
  assert.equal(discover('<link rel="canonical" href="'+url+'">'+image, {url: 'https://www.example.org/'}).blocks.length, 0);
});

test('exact front-page cards supply only their own media', () => {
  const html = '<body><img src="/banner.jpg"><main><div class="card"><img src="/walk.jpg"><a href="/news/the-river-walk">Current title</a></div><div class="card"><img src="/other.jpg"><a href="/news/other">Other story</a></div></main></body>';
  const result = discover(html, {url: 'https://www.example.org/', kind: 'front-page'});
  assert.deepEqual(result.blocks.map(b => b.url), ['https://www.example.org/walk.jpg']);
  assert.equal(result.receipts[0].basis, 'exact-article-front-page-card');
});

test('front-page discovery never falls back to whole body or unrelated cards', () => {
  const html = '<body><a href="/news/the-river-walk">Exact story without an image</a><article><img src="/other.jpg"><a href="/news/other">Other story</a></article></body>';
  assert.equal(discover(html, {url: 'https://www.example.org/', kind: 'front-page'}).blocks.length, 0);
  assert.equal(discover('<div><a href="/news/the-river-walk">Exact story</a><div><img src="/other.jpg"><a href="/news/other">Other story</a></div></div>', {url: 'https://www.example.org/', kind: 'front-page'}).blocks.length, 0);
});

test('signed/private images and unsupported embeds are rejected while safe videos normalize', () => {
  const html = '<h1>'+title+'</h1><article><img src="https://cdn.example.org/a.jpg?X-Amz-Signature=private"><img src="https://user:pass@example.org/a.jpg"><img src="http://cdn.example.org/a.jpg"><img src="https://127.0.0.1/a.jpg"><iframe src="https://evil.example.org/player"></iframe><iframe src="https://www.youtube.com/watch?v=AbCdEfGh123"></iframe><video src="/clips/walk.mp4" poster="/poster.jpg"></video></article>';
  const result = discover(html);
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map(b => b.url), ['https://www.youtube-nocookie.com/embed/AbCdEfGh123', 'https://www.example.org/clips/walk.mp4']);
  assert.equal(result.blocks[1].poster, 'https://www.example.org/poster.jpg');
});

test('exact-article public markdown accepts explicit images and video links only', () => {
  const content = '![The river](https://cdn.example.org/river.jpg)\n[Video](https://youtu.be/AbCdEfGh123)\n[Other story](https://other.example.org/news)';
  const sources = [{url, kind: 'web', title, content}];
  const result = discoverArticleMedia(capture(), sources);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].caption, 'The river');
  assert.equal(result.blocks[0].basis, 'exact-article-public-content-link');
  assert.equal(discoverArticleMedia(capture(), [{...sources[0], url: 'https://social.example.org/post'}]).blocks.length, 0);
});

test('deduplicates existing and discovered media without changing capture or block IDs', () => {
  const original = capture({blocks: [{id: 'B4', type: 'figure', url: 'https://www.example.org/media/walk.jpg'}]});
  const before = JSON.stringify(original);
  const html = '<h1>'+title+'</h1><meta property="og:image" content="/media/walk.jpg"><article>'+image+'<img src="/another.jpg"><img src="/another.jpg"></article>';
  const result = discoverArticleMedia(original, [source(html), source(html)]);
  assert.equal(result.blocks.length, 1);
  assert.equal(JSON.stringify(original), before);
  assert.match(result.blocks[0].id, /^media-figure-/);
  assert.equal(result.blocks[0].id, discoverArticleMedia(capture(), [source('<h1>'+title+'</h1><article><img src="/another.jpg"></article>')]).blocks[0].id);
});

test('ignores hidden media, hidden JSON state and unrelated recommendations', () => {
  const html = '<style>.secret{display:none}</style><article><h1>'+title+'</h1><div hidden>'+image+'</div><div class="secret"><img src="/secret.jpg"></div><div style="visibility:hidden"><img src="/hidden.jpg"></div><script type="application/ld+json">{"image":"https://www.example.org/state.jpg"}</script><aside><img src="/related.jpg"></aside><div class="related-stories"><img src="/other.jpg"></div><figure><img src="/visible.jpg"></figure></article>';
  assert.deepEqual(discover(html).blocks.map(b => b.url), ['https://www.example.org/visible.jpg']);
});

test('public metadata supports safe player URLs and marks placement approximate', () => {
  const result = discover('<meta property="og:url" content="'+url+'"><meta property="og:image" content="/lead.jpg"><meta property="og:image:alt" content="The public lead image"><meta name="twitter:player" content="https://vimeo.com/123456"><meta property="og:video" content="https://evil.example.org/embed">');
  assert.deepEqual(result.blocks.map(b => b.type), ['figure', 'video']);
  assert.equal(result.blocks[0].caption, 'The public lead image');
  assert.ok(result.receipts.every(r => r.placement === 'approximate' && r.basis === 'exact-article-public-metadata'));
});

test('headline punctuation and library standfirst suffix normalize conservatively', () => {
  assert.equal(discoverArticleMedia(capture({title: title + '; Volunteers share their findings.'}), [source('<h1>A new walk beside the river!</h1><article>'+image+'</article>')]).blocks.length, 1);
  assert.equal(discover('<h1>A new walk beside the river is disputed</h1><article>'+image+'</article>').blocks.length, 0);
  assert.equal(articleIdentity('https://example.org/news/the-river-walk/?utm_source=feed'), articleIdentity(url));
});

test('bounds discovery to six images and three videos', () => {
  const html = '<h1>'+title+'</h1><article>'+Array.from({length: 12}, (_, i) => '<img src="/photo'+i+'.jpg">').join('')+Array.from({length: 8}, (_, i) => '<video src="/video'+i+'.mp4"></video>').join('')+'</article>';
  const result = discover(html);
  assert.equal(result.blocks.filter(b => b.type === 'figure').length, 6);
  assert.equal(result.blocks.filter(b => b.type === 'video').length, 3);
});

test('front-page markdown requires a nested linked-image card for the exact article', () => {
  const content = '[![River view](/river.jpg)](/news/the-river-walk)\n[![Other story](/other.jpg)](/news/other)\n![Unlinked photo](/loose.jpg)\n[Exact article](/news/the-river-walk)\n`[![Example](/code.jpg)](/news/the-river-walk)`';
  const result = discoverArticleMedia(capture(), [{url: 'https://www.example.org/', kind: 'front-page', content}]);
  assert.deepEqual(result.blocks.map(b => b.url), ['https://www.example.org/river.jpg']);
  assert.equal(result.blocks[0].caption, 'River view');
  assert.equal(result.blocks[0].basis, 'exact-article-front-page-card');
});

test('absent media URLs and posters never resolve to the article page', () => {
  const result = discover('<h1>'+title+'</h1><article><img><iframe></iframe><video></video><video src="/walk.mp4"></video></article>');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].poster, '');
});

test('tracking removal cannot conceal a following signed credential parameter', () => {
  const result = discover('<h1>'+title+'</h1><article><img src="https://cdn.example.org/photo.jpg?utm_source=feed&amp;token=private"><iframe src="https://www.youtube.com/watch?v=AbCdEfGh123&amp;utm_source=feed&amp;signature=private"></iframe></article>');
  assert.equal(result.blocks.length, 0);
});

test('bounded front-page card ignores empty player and hash controls but keeps competing stories out', () => {
  const card = '<div data-testid="lead-article"><a href=""><img src="/lead.gif"></a><a href="#play">Play</a><div><a href="/news/the-river-walk">Current headline</a></div></div>';
  const result = discover(card, {url: 'https://www.example.org/', kind: 'front-page'});
  assert.deepEqual(result.blocks.map(b => b.url), ['https://www.example.org/lead.gif']);
  assert.equal(discover(card.replace('#play','/news/other'), {url: 'https://www.example.org/', kind: 'front-page'}).blocks.length, 0);
});


test('media evidence counts distinguish public HTML metadata from stripped provider content', () => {
  const metadata=mediaSourceSummary({html:'<meta property="og:image" content="/photo.jpg"><script type="application/ld+json">{"image":"/hidden.jpg"}</script>'});
  assert.equal(metadata.imageReferences,1);assert.equal(metadata.videoReferences,0);
  const stripped=mediaSourceSummary({content:'A plain public article extract without image links.'});
  assert.equal(stripped.imageReferences,0);assert.equal(stripped.videoReferences,0);
  assert.equal(mediaSourceSummary({content:'![Public image](https://cdn.example.org/p.jpg)'}).imageReferences,1);
});
