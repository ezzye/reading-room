import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryPageProof,libraryPageProofMetadata,validateLibraryPageProofMetadata,libraryParagraphFingerprint,savedLibraryPageMatches,savedLibraryReceiptMatches} from './library-page-proof.mjs';
import {libraryPublication,OBSERVER_PUBLICATION_LABEL,HERALD_PUBLICATION_LABEL,NATIONAL_PUBLICATION_LABEL} from './library-publications.mjs';
import {buildLibraryCapture} from './library-capture.mjs';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';

const title='Fictional café archive volunteers compare regional plans - A complete source deck';
const libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FABC123';
const paragraphs=['The fictional café archive held an imaginary meeting. '.repeat(5),'Volunteers compared regional plans in their supplied order. '.repeat(5),'Residents asked a final set of synthetic questions for this fixture. '.repeat(5)];
const source=(extra={})=>({title,byline:'Synthetic Reporter',date:'October 18, 2026',publication:OBSERVER_PUBLICATION_LABEL,libraryURL,paragraphs,...extra});
const publisherURL='https://observer.co.uk/news/national/article/fictional-cafe-archive-volunteers-compare-regional-plans';
function normal(article=source(),url=publisherURL){return {kind:'rendered-capture-v1',capture:normalizeCapture(buildLibraryCapture({...article,originalURL:url,originalTitle:article.title})),annotations:[{blockId:'B1',title:'Synthetic note',comment:'Independent commentary',question:'Discuss this fixture.'}],comment:'Reader discussion preserved'};}
function selected(article=source(),publisher='observer'){const choice={publisher,title:article.title,date:'2026-10-18',publication:article.publication,libraryURL:article.libraryURL};return {kind:'rendered-capture-v1',capture:normalizeCapture(buildLibraryRecordCapture({selected:choice,article}),{validatedLibraryRecordURL:libraryURL}),annotations:[{blockId:'B2',title:'Synthetic note',comment:'Independent commentary',question:'Discuss.'}]};}

test('capability is opaque, immutable, unforgeable by JSON or flags, and exposes only fixed metadata plus fingerprint',async()=>{
 const article=source(),proof=await createLibraryPageProof({publisher:'observer',article}),metadata=libraryPageProofMetadata(proof);
 assert(Object.isFrozen(proof));assert(Object.isFrozen(metadata));assert.deepEqual(Object.keys(proof),[]);assert.equal(JSON.stringify(proof),'{}');assert.equal(metadata.title,title);assert.equal(metadata.date,'2026-10-18');assert.equal(metadata.libraryURL,libraryURL);assert.match(metadata.paragraphFingerprint,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(metadata),/fictional café archive held|paragraphs|byline|cookie|cardNumber|account/);
 for(const fake of [{},JSON.parse(JSON.stringify(proof)),metadata,{verified:true,libraryTextEdition:true,metadata},Object.create(proof),null])assert.equal(libraryPageProofMetadata(fake),null);
 assert.equal(await savedLibraryPageMatches(normal(),metadata),false);assert.deepEqual(validateLibraryPageProofMetadata(JSON.parse(JSON.stringify(metadata))),metadata);assert.deepEqual(article,source());
});

test('full ordered paragraphs normalize only NFC and whitespace while preserving punctuation, case, count and boundaries',async()=>{
 const fingerprint=await libraryParagraphFingerprint(paragraphs),equivalent=paragraphs.map(text=>text.normalize('NFD').replaceAll(' ','\t \n'));
 assert.equal(await libraryParagraphFingerprint(equivalent),fingerprint);
 for(const changed of [[paragraphs[1],paragraphs[0],paragraphs[2]],[...paragraphs,paragraphs[2]],paragraphs.map((text,index)=>index?text:text.replace('café','cafe')),paragraphs.map((text,index)=>index?text:text.toLowerCase()),paragraphs.map((text,index)=>index?text:text.replace('meeting.','meeting!')),[paragraphs[0]+' '+paragraphs[1],paragraphs[2],'Extra paragraph']])assert.notEqual(await libraryParagraphFingerprint(changed),fingerprint);
 await assert.rejects(libraryParagraphFingerprint(paragraphs.slice(0,2)),/exact page proof/);
});

test('normal and selected editions of the same verified record match without mutating IDs, media, annotations or discussion',async()=>{
 const proof=await createLibraryPageProof({publisher:'observer',article:source()}),ordinary=normal(),record=selected();ordinary.capture.blocks.splice(1,0,{id:'MEDIA1',type:'figure',url:'https://images.example.org/fixture.jpg',caption:'Fixture media',credit:'Synthetic credit'});const before=JSON.stringify(ordinary),recordBefore=JSON.stringify(record);
 assert.equal(await savedLibraryPageMatches(ordinary,proof),true);assert.equal(await savedLibraryPageMatches(record,proof),true);assert.equal(await savedLibraryReceiptMatches(record,libraryPageProofMetadata(proof)),true);assert.equal(JSON.stringify(ordinary),before);assert.equal(JSON.stringify(record),recordBefore);
 const whitespace=structuredClone(ordinary);whitespace.capture.title=title.normalize('NFD').replaceAll(' ',' \n ');whitespace.capture.blocks.filter(block=>block.type==='paragraph').forEach(block=>{block.text=block.text.normalize('NFD').replaceAll(' ','\t ');});assert.equal(await savedLibraryPageMatches(whitespace,proof),true);
});

test('saved-page mismatch refuses wrong source, title/deck, actual date, family, provenance and all altered paragraphs',async()=>{
 const proof=await createLibraryPageProof({publisher:'observer',article:source()}),base=normal();
 const changes=[doc=>{doc.capture.title=title.split(' - ')[0];},doc=>{doc.capture.title+=' changed';},doc=>{doc.capture.date='October 19, 2026';},doc=>{doc.capture.diagnostics.libraryURL=libraryURL.replace('ABC123','DEF456');},doc=>{doc.capture.publisher='The Herald · Camden NewsBank text edition';},doc=>{doc.capture.presentation.method='public-url';},doc=>{doc.capture.diagnostics.libraryTextEdition=false;},doc=>{doc.capture.url='https://observer.co.uk.attacker.example/news/national/article/fixture';},doc=>{doc.capture.blocks[0].text+=' Changed reporting.';},doc=>{doc.capture.blocks.reverse();},doc=>{doc.capture.blocks.pop();},doc=>{doc.capture.blocks.push({...doc.capture.blocks[0],id:'EXTRA'});},doc=>{doc.capture.blocks[0].type='quote';},doc=>{doc.capture.blocks.push({type:'heading',text:'Extra source text'});},doc=>{doc.capture.blocks.push({type:'figure',text:'Hidden extra prose',url:'https://images.example.org/a.jpg'});}];
 for(const change of changes){const doc=structuredClone(base);change(doc);assert.equal(await savedLibraryPageMatches(doc,proof),false);}
 const record=selected();record.capture.url=libraryURL.replace('ABC123','DEF456');assert.equal(await savedLibraryPageMatches(record,proof),false);assert.equal(await savedLibraryPageMatches({...base,kind:'library-study-v1'},proof),false);
});

test('constructor rejects malformed metadata, unsupported papers, wrong publication, unavailable dates and asserted verification flags',async()=>{
 for(const input of [{publisher:'guardian',article:source()},{publisher:'observer',article:source({publication:'The Observer'})},{publisher:'observer',article:source({date:''})},{publisher:'observer',article:source({libraryURL:libraryURL.replace('p=UKNB','p=OTHER')})},{publisher:'observer',article:source({libraryURL:'https://attacker.example/document'})},{publisher:'observer',article:source({paragraphs:[paragraphs[0]]})},{publisher:'observer',article:{...source(),verified:true}},{publisher:'observer',article:source(),verified:true}])await assert.rejects(createLibraryPageProof(input),/exact page proof/);
 const proof=await createLibraryPageProof({publisher:'observer',article:source({libraryURL:libraryURL+'&session=PRIVATE-SESSION&card=PRIVATE-CARD'})});assert.equal(libraryPageProofMetadata(proof).libraryURL,libraryURL);assert.doesNotMatch(JSON.stringify(libraryPageProofMetadata(proof)),/PRIVATE|session|card/);
});

test('trusted receipt metadata validation fails closed on unknown fields, publication changes, bad fingerprints and noncanonical identities',async()=>{
 const metadata=libraryPageProofMetadata(await createLibraryPageProof({publisher:'observer',article:source()}));
 for(const bad of [{...metadata,paragraphs},{...metadata,cookie:'PRIVATE'},{...metadata,schema:'other'},{...metadata,publisherKey:'herald'},{...metadata,publication:'The Guardian'},{...metadata,title:title+' '},{...metadata,date:'2026-02-30'},{...metadata,libraryURL:libraryURL+'&session=private'},{...metadata,paragraphFingerprint:'f'.repeat(63)},{...metadata,paragraphFingerprint:'F'.repeat(64)}]){assert.equal(validateLibraryPageProofMetadata(bad),null);assert.equal(await savedLibraryReceiptMatches(normal(),bad),false);}
});

test('all registered exact source families receive independent capabilities and cannot alias another family',async()=>{
 for(const [publisher,publication] of [['times','The Times (Camden NewsBank text edition)'],['telegraph','The Daily Telegraph (London, UK) (Camden NewsBank text edition)'],['observer',OBSERVER_PUBLICATION_LABEL],['herald',HERALD_PUBLICATION_LABEL],['national',NATIONAL_PUBLICATION_LABEL]]){
  const article=source({publication}),proof=await createLibraryPageProof({publisher,article}),doc=selected(article,publisher);assert.equal(libraryPageProofMetadata(proof).publisherKey,publisher);assert.equal(await savedLibraryPageMatches(doc,proof),true);doc.capture.publisher=libraryPublication(publisher==='observer'?'herald':'observer').name+' · Camden NewsBank text edition';assert.equal(await savedLibraryPageMatches(doc,proof),false);
 }
});
