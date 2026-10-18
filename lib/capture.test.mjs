import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_KIND, cleanStyle, mediaURL, normalizeCapture, renderCapture,
  validateAnnotations, videoEmbed,
} from './capture-core.mjs';

const articleText = [
  'Mara Bell opened the fictional city archive before dawn. She compared three paper maps with notes from local volunteers and marked each route in pencil. The team recorded bridge closures, bus diversions, and safe crossings before the public walk began. Every observation remained attached to its date and source.',
  'At noon, the group tested the northern path beside the river. Rain softened the ground, so organizers moved two signs and updated the printed guide. No participant was asked to cross the construction zone. The trial ended at the library, where visitors could leave comments and suggest corrections for a later edition.',
].join(' ');
const fixture = (overrides = {}) => ({
  schema: 'ret-capture/v1', url: 'https://example.org/reports/river-walk',
  title: 'A fictional walk beside the river', publisher: 'Example Gazette',
  byline: 'Mara Bell', date: '2026-01-01', standfirst: 'A fictional report.',
  viewport: { width: 320, height: 720, devicePixelRatio: 2 },
  articleRect: { x: 0, y: 80, width: 320, height: 2400 },
  design: { headlineStyle: {}, bodyStyle: {} }, fonts: [],
  blocks: [
    { id: 'source-dom-17', type: 'paragraph', text: articleText.slice(0, articleText.indexOf(' At noon')) },
    { id: 'source-dom-18', type: 'paragraph', text: articleText.slice(articleText.indexOf('At noon')) },
  ], diagnostics: {}, ...overrides,
});

test('rejects invalid schema, private URLs, and insufficient readable text', () => {
  assert.throws(() => normalizeCapture({ ...fixture(), schema: 'other' }), /RET Page Lens/);
  assert.throws(() => normalizeCapture(fixture({ url: 'https://127.0.0.1/private' })), /public HTTPS/);
  assert.throws(() => normalizeCapture(fixture({ url: 'https://user:pass@example.org/a' })), /public HTTPS/);
  assert.throws(() => normalizeCapture(fixture({ blocks: [{ type: 'paragraph', text: 'Short text.' }] })), /too little readable/);
});

test('a selected library record keeps its actual source identity and library link label',()=>{
 const url='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABCDEF',diagnostics={libraryTextEdition:true,libraryRecordEdition:true,libraryURL:url};
 const c=normalizeCapture(fixture({url,publisher:'The Observer · Camden NewsBank text edition',presentation:{method:'library-text'},diagnostics}),{validatedLibraryRecordURL:url});
 assert.equal(c.url,url);assert.equal(c.diagnostics.libraryRecordEdition,true);
 const html=renderCapture({id:'a'.repeat(48),document:{kind:CAPTURE_KIND,capture:c,annotations:[]}});assert.match(html,/Open library record ↗/);assert.doesNotMatch(html,/Open original newspaper ↗/);
 assert.throws(()=>normalizeCapture(fixture({url,presentation:{method:'library-text'},diagnostics})),/original newspaper URL/);
 assert.throws(()=>normalizeCapture(fixture({url:'https://example.org/public-article',presentation:{method:'library-text'},diagnostics}),{validatedLibraryRecordURL:url}),/identity/);
 for(const override of [{diagnostics:{...diagnostics,libraryURL:url.replace('ABCDEF','DEADBEEF')}},{presentation:{method:'public-url'}}])assert.throws(()=>normalizeCapture(fixture({url,presentation:{method:'library-text'},diagnostics,...override}),{validatedLibraryRecordURL:url}),/identity/);
 for(const hostile of [url+'&session=PRIVATE',url.replace('p=UKNB','p=OTHER'),url.replace('infoweb.newsbank.com','attacker.example'),url.replace('/document-view','/results')])assert.throws(()=>normalizeCapture(fixture({url:hostile,presentation:{method:'library-text'},diagnostics:{...diagnostics,libraryURL:hostile}}),{validatedLibraryRecordURL:hostile}));
});

test('normalizes typed blocks, drops unknown types, and replaces source DOM IDs', () => {
  const c = normalizeCapture(fixture({ blocks: [
    { id: 'p-99', type: 'paragraph', text: articleText.slice(0, 160) },
    { id: 'script-node', type: 'script', text: 'alert(1)' },
    { id: 'q-3', type: 'quote', text: articleText.slice(160) },
    { id: 'h-4', type: 'heading', level: 3, text: 'Field notes' },
  ] }));
  assert.deepEqual(c.blocks.map(b => [b.id, b.type]), [['B1','paragraph'],['B2','quote'],['B3','heading']]);
  assert.equal(c.blocks[2].level, 3);
});

test('renders escaped text, omits unknown markup, and sanitizes style declarations', () => {
  const c = normalizeCapture(fixture({ blocks: [
    { type: 'paragraph', text: articleText.slice(0, 155) + ' <script>alert(1)</script>', style: { fontFamily: 'url(javascript:alert(1))', color: 'red; background:url(https://evil.test)' } },
    { type: 'paragraph', text: articleText.slice(155) },
    { type: 'unknown-html', text: '<img src=x onerror=alert(1)>' },
  ] }));
  const html = renderCapture({ id: 'a'.repeat(48), kind: CAPTURE_KIND, document: { kind: CAPTURE_KIND, capture: c, annotations: [] } });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(cleanStyle({ fontFamily: 'url(javascript:alert(1))' }).fontFamily, /url\s*\(/i);
  assert.doesNotMatch(cleanStyle({ color: 'red; background:url(https://evil.test)' }).color, /background|url/i);
});

test('rejects unknown annotation block IDs and copied source runs of 12 words', () => {
  const c = normalizeCapture(fixture());
  const note = (blockId, comment = 'A separate observation invites readers to inspect the evidence.') => ({ blockId, title: 'Reading the evidence', comment, question: 'What would you compare?' });
  assert.throws(() => validateAnnotations({ annotations: [note('missing'), note('B1')] }, c), /invalid passage reference/);
  const copied = articleText.split(/\s+/).slice(0, 12).join(' ');
  assert.throws(() => validateAnnotations({ annotations: [note('B1', copied), note('B2')] }, c), /quoted too much/);
});

test('accepts supported exact video identities and rejects signed media URLs', () => {
  const yt = 'https://www.youtube.com/watch?v=AbCdEfGh123';
  assert.equal(videoEmbed(yt), 'https://www.youtube-nocookie.com/embed/AbCdEfGh123');
  const bc = 'https://players.brightcove.net/1234567890001/synthetic_default/index.html?videoId=1234567890123';
  assert.equal(videoEmbed(bc), bc);
  assert.equal(videoEmbed(bc + '&signature=secret'), '');
  assert.equal(mediaURL('https://cdn.example.org/photo.jpg?X-Amz-Signature=secret'), '');
});

test('renders exact video identity as click-to-load with owner controls gated', () => {
  const c = normalizeCapture(fixture({ blocks: [
    { type: 'paragraph', text: articleText.slice(0, 160) },
    { type: 'video', url: 'https://players.brightcove.net/1234567890001/synthetic_default/index.html?videoId=1234567890123' },
    { type: 'paragraph', text: articleText.slice(160) },
  ] }));
  const anonymous = renderCapture({ id: 'a'.repeat(48), kind: CAPTURE_KIND, document: { kind: CAPTURE_KIND, capture: c, annotations: [] } });
  assert.match(anonymous, /data-video="https:\/\/players\.brightcove\.net\/1234567890001\/synthetic_default\/index\.html\?videoId=1234567890123"/);
  assert.doesNotMatch(anonymous, /<iframe/);
  assert.doesNotMatch(anonymous, /Create sharing link/);
  const owner = renderCapture({ id: 'a'.repeat(48), kind: CAPTURE_KIND, document: { kind: CAPTURE_KIND, capture: c, annotations: [] } }, { owner: true });
  assert.match(owner, /Create sharing link/);
});

test('keeps a narrow captured story width rather than imposing a wider desktop minimum', () => {
  const c = normalizeCapture(fixture());
  const html = renderCapture({ id: 'a'.repeat(48), kind: CAPTURE_KIND, document: { kind: CAPTURE_KIND, capture: c, annotations: [] } });
  assert.equal(c.articleRect.width, 320);
  assert.match(html, /--story-width:320px/);
  const annotated = renderCapture({ id: 'a'.repeat(48), document: { kind: CAPTURE_KIND, capture: c, annotations: [{blockId:'B1',title:'Framing',comment:'Consider the evidence.',question:'What is missing?'}] } });
  assert.match(annotated, /<details class="ai-disclosure"><summary>AI commentary<\/summary>/);
  assert.doesNotMatch(annotated, /<details class="ai-disclosure"[^>]*\bopen/);
  assert.match(annotated, /<em>What is missing\?<\/em><\/p><\/details><\/aside>/);


});

 test('render scripts compile and reject script-bearing page identifiers',()=>{const capture=normalizeCapture(fixture());const page={id:'a'.repeat(48),document:{kind:CAPTURE_KIND,capture,annotations:[]}};for(const owner of [false,true]){const html=renderCapture(page,{owner});for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(match[1]));}assert.throws(()=>renderCapture({...page,id:'</script><script>alert(1)</script>'},{owner:true}),/Invalid page ID/);});

// Query cleanup must not skip a credential following a removed tracking key.
test('tracking cleanup never admits a signed private media URL',async()=>{const {mediaURL}=await import('./capture-core.mjs');assert.equal(mediaURL('https://images.example.org/pic.jpg?utm_source=share&token=private'),'');assert.equal(mediaURL('https://images.example.org/pic.jpg?utm_source=share&width=800'),'https://images.example.org/pic.jpg?width=800');});
