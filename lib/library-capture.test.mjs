import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLibraryCapture} from './library-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';

const title='Fictional river archive opens a new walking route';
const originalURL='https://www.thetimes.com/world/europe/article/fictional-river-archive-walking-route-abc123def';
const paragraphs=[
 'Mara Bell opened the fictional city archive before dawn. She compared three paper maps with notes from local volunteers and marked each route in pencil. The team recorded bridge closures, bus diversions, and safe crossings before the public walk began. Every observation remained attached to its date and source. The group described this as a practice exercise rather than a survey of an actual town.',
 'At noon, the fictional group tested the northern path beside the river. Rain softened the ground, so organizers moved two signs and updated the printed guide. No participant was asked to cross the construction zone. The trial ended at the library, where visitors could leave comments and suggest corrections for a later edition. Each recorded change remained a proposal until another volunteer checked the route.',
 'In the evening, a second fictional team examined the eastern crossing and compared the latest notes with the original plan. They agreed to preserve the paper copies alongside the digital record. Their final meeting considered lighting, accessibility, and the need to mark temporary restrictions clearly. These invented observations form a synthetic test article and do not describe a real event or any actual people.',
];
const source=(extra={})=>({originalURL,originalTitle:title,title,byline:'Mara Bell',date:'17 October 2026',publication:'The Times',libraryURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABC123&auth=discard-me&session=discard-me',paragraphs,...extra});
const publisher=(extra={})=>({schema:'ret-capture/v1',url:originalURL,title,publisher:'The Times',byline:'Mara Bell',date:'17 October 2026',capturedAt:'2026-10-17T12:00:00Z',viewport:{width:1280,height:900},articleRect:{width:620},design:{bodyStyle:{fontFamily:'Observed Serif',fontSize:'22px'},headlineStyle:{fontFamily:'Observed Headline',fontSize:'46px'}},blocks:paragraphs.flatMap((text,i)=>[{type:'paragraph',text,style:{fontFamily:'Observed Serif',fontSize:'22px'}},...(i===0?[{type:'figure',url:'https://images.example.org/fictional-river.jpg',caption:'Synthetic fixture photograph'},{type:'video',url:'https://www.youtube.com/watch?v=AbCdEfGh123'}]:[])]),diagnostics:{paywallDetected:false},...extra});

test('retains every full library paragraph in order without generated replacements',()=>{
 const raw=buildLibraryCapture(source());
 assert.deepEqual(raw.blocks.map(b=>b.text),paragraphs);
 assert.deepEqual(raw.blocks.map(b=>b.id),['B1','B2','B3']);
 const capture=normalizeCapture(raw);
 assert.deepEqual(capture.blocks.map(b=>b.text),paragraphs);
 assert.equal(capture.diagnostics.paragraphCount,paragraphs.length);
 assert.equal(capture.url,originalURL.replace('www.',''));
});

test('records text-edition approximation and only a clean library document identity',()=>{
 const raw=buildLibraryCapture(source());
 assert.match(raw.publisher,/Camden NewsBank text edition/);
 assert.equal(raw.presentation.method,'library-text');
 assert.match(raw.presentation.message,/approximate.*no original publisher viewport or font was measured/);
 assert.match(raw.presentation.message,/does not supply original photographs, video or page design/);
 assert.equal(raw.presentation.libraryURL,'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABC123');
 assert.doesNotMatch(JSON.stringify(raw),/discard-me|auth=|session=/);
 assert.equal(raw.diagnostics.presentationApproximate,true);
 assert.deepEqual(raw.fonts,[]);
 assert.ok(raw.blocks.every(b=>b.type==='paragraph'));
});

test('a reader-supplied headline remains labelled after capture normalization',()=>{
 const capture=normalizeCapture(buildLibraryCapture(source({readerHeadlineHint:true})));
 assert.equal(capture.diagnostics.readerHeadlineHint,true);
 assert.match(capture.presentation.message,/reader-supplied headline/);
 assert.match(capture.presentation.message,/not independently verified/);
});

test('prefers a matched complete publisher capture and preserves observed media order and styles',()=>{
 const raw=buildLibraryCapture(source(),publisher());
 assert.equal(raw.diagnostics.publisherCaptureMatched,true);
 assert.equal(raw.diagnostics.publisherTextCoverage,1);
 assert.equal(raw.diagnostics.libraryTextEdition,false);
 assert.deepEqual(raw.blocks.map(b=>b.type),['paragraph','figure','video','paragraph','paragraph']);
 assert.equal(raw.blocks[1].url,'https://images.example.org/fictional-river.jpg');
 assert.equal(raw.blocks[2].url,'https://www.youtube-nocookie.com/embed/AbCdEfGh123');
 assert.match(raw.blocks[0].style.fontFamily,/Observed Serif/);
 assert.equal(raw.articleRect.width,620);
 assert.equal(raw.capturedAt,'2026-10-17T12:00:00Z');
 assert.equal(raw.presentation,null);
});

test('rejects media and presentation from a different publisher article URL',()=>{
 const raw=buildLibraryCapture(source(),publisher({url:originalURL.replace('abc123def','xyz987uvw')}));
 assert.equal(raw.diagnostics.publisherCaptureMatched,false);
 assert.ok(raw.blocks.every(b=>b.type==='paragraph'));
 assert.doesNotMatch(JSON.stringify(raw),/fictional-river\.jpg|Observed Serif/);
});

test('rejects a different headline even when the URL and paragraphs were supplied',()=>{
 const raw=buildLibraryCapture(source(),publisher({title:'Fictional mountain orchestra performs a winter concert'}));
 assert.equal(raw.presentation.method,'library-text');
 assert.ok(raw.blocks.every(b=>b.type==='paragraph'));
});

test('does not substitute a readable short preview for the full library text',()=>{
 const raw=buildLibraryCapture(source(),publisher({blocks:publisher().blocks.slice(0,4)}));
 assert.equal(raw.presentation.method,'library-text');
 assert.deepEqual(raw.blocks.map(b=>b.text),paragraphs);
 assert.ok(raw.blocks.every(b=>b.type==='paragraph'));
});

test('requires source paragraph coverage in order, not a bag of matching words',()=>{
 const reverse=publisher({blocks:[...paragraphs].reverse().map(text=>({type:'paragraph',text}))});
 assert.equal(buildLibraryCapture(source(),reverse).presentation.method,'library-text');
 const bag=publisher({blocks:paragraphs.map(text=>({type:'paragraph',text:text.split(' ').reverse().join(' ')}))});
 assert.equal(buildLibraryCapture(source(),bag).presentation.method,'library-text');
});

test('does not use a publisher capture that reported an access overlay',()=>{
 const raw=buildLibraryCapture(source(),publisher({diagnostics:{paywallDetected:true,accessBlocked:true}}));
 assert.equal(raw.presentation.method,'library-text');
 assert.equal(raw.diagnostics.publisherCaptureMatched,false);
});

test('retains bounded source validation and does not mutate either input',()=>{
 assert.throws(()=>buildLibraryCapture(source({paragraphs:['Too short.']})),/readable library article/);
 assert.throws(()=>buildLibraryCapture(source({libraryURL:'https://elsewhere.example.org/document?docref=news/ABC123'})),/not recognised/);
 assert.throws(()=>buildLibraryCapture(source({originalURL:'https://example.org/private'})),/ordinary Times(?: or Telegraph)? article/);
 const input=source(),capture=publisher(),before=JSON.stringify({input,capture});
 buildLibraryCapture(input,capture);
 assert.equal(JSON.stringify({input,capture}),before);
});

test('inactive access markup is not confused with a visible blocker after complete source matching',()=>{const c=buildLibraryCapture(source(),publisher({diagnostics:{paywallDetected:true}}));assert.equal(c.diagnostics.publisherCaptureMatched,true);assert.equal(c.diagnostics.publisherTextCoverage,1);});
test('even a short missing source paragraph retains the full library edition',()=>{const all=[...paragraphs,'A brief final synthetic correction stays part of the source.'];const c=buildLibraryCapture(source({paragraphs:all}),publisher());assert.equal(c.presentation.method,'library-text');assert.deepEqual(c.blocks.map(b=>b.text),all);});

test('library image captions can match retained publisher figure captions in source order',()=>{const c=buildLibraryCapture(source({paragraphs:[paragraphs[0],'Synthetic fixture photograph',...paragraphs.slice(1)]}),publisher());assert.equal(c.diagnostics.publisherCaptureMatched,true);assert.equal(c.diagnostics.publisherTextCoverage,1);assert.equal(c.blocks[1].type,'figure');});

test('URL-word matching provenance survives capture normalization without claiming a measured web headline',()=>{
 const capture=normalizeCapture(buildLibraryCapture(source({urlWordsHint:true})));
 assert.equal(capture.diagnostics.urlWordsHint,true);assert.equal(capture.diagnostics.readerHeadlineHint,false);assert.match(capture.presentation.message,/words in the URL/);assert.match(capture.presentation.message,/not independently observed/);
});
