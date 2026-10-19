import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {runtimeLibraryClient} from './library-transport.mjs';
import {handler} from '../server-library/handler.mjs';
import {libraryRecordRequest} from './library-record-contract.mjs';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {normalizeCapture} from './capture-core.mjs';
import {createLibraryPageProof,libraryPageProofMetadata,savedLibraryReceiptMatches} from './library-page-proof.mjs';
import {roomVerifiedLibraryRecord} from './library-page-index.ts';
import {proveLibraryPublication} from './library-publications.mjs';

const family='Scotsman, The/Scotland on Sunday (Scotland)',daily='Scotsman, The (Edinburgh, Scotland)',sunday='Scotland on Sunday (Edinburgh, Scotland)';
const title='Synthetic archive volunteers discuss regional transport',date='2026-10-18',libraryURL='https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news%2FC0FFEE';
const paragraphs=Array.from({length:3},(_,index)=>'Synthetic paragraph '+index+'. '+'The fictional archive group considered transport evidence in the supplied order and invited readers to discuss different views. '.repeat(3));
const selected=publication=>({publisher:'scotsman',title,date,publication,libraryURL});
const session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const aws={RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-test-secret-only-not-real-12345'};
// Live-shaped dedicated upper publication metadata; all prose is synthetic.
const documentHTML=({publication=family,headline=title,sourceDate=date,sourceAttributes='',extraSource=''}={})=>'<div id="document-view--ascii"><div class="document-view__meta--upper"><div class="document-view__meta__item--publication"><span class="source" '+sourceAttributes+'>'+publication+'</span></div>'+extraSource+'</div><h1>'+headline+'</h1><div class="document-view__meta"><p>'+sourceDate+'</p><p>Author/Byline: Synthetic Reporter 1000 Words</p></div><div class="document-view__body--ascii">'+paragraphs.map(value=>'<p>'+value+'</p>').join('')+'</div></div>';
function clientFor(html=documentHTML()){
 let calls=0;const fetcher=async(raw,options={})=>{calls++;assert.equal(raw,libraryURL);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return new Response(html,{headers:{'content-type':'text/html'}});};
 const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(session);return {client,fetcher,calls:()=>calls};
}
async function verified(publication=sunday){const f=clientFor(),result=await f.client.fetchLibraryRecord(selected(publication));assert.equal(result.status,'found',JSON.stringify(result));return result.article;}
function cache(article,publication=sunday){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const stamp='2026-10-19T00:00:00.000Z',pageId='a'.repeat(48);sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run('owner','Synthetic Owner','owner',stamp);
 for(const room of ['room-one','room-two']){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(room,room,'owner',stamp);sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(room,'owner','owner',stamp);}
 const capture=normalizeCapture(buildLibraryRecordCapture({selected:selected(publication),article}),{validatedLibraryRecordURL:libraryURL}),document={kind:'rendered-capture-v1',capture,annotations:[],discussion:'Preserve the existing discussion'};
 const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {first:async()=>statement.get(...args)||null};}};}};
 sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(pageId,'synthetic-family-record',libraryURL,title,JSON.stringify(document),stamp);sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run('room-one',pageId,'owner',stamp);
 const request=room=>new Request('https://reader.example/read/'+pageId+'?room='+room,{headers:{'x-rr-room-id':room,'x-ret-member-id':'owner'}});
 return {sql,c:{DB},pageId,document,request,async receipt(){const proof=await createLibraryPageProof({publisher:'scotsman',article}),meta=libraryPageProofMetadata(proof);sql.prepare('INSERT INTO rr_verified_library_pages(room_id,page_id,library_url,publisher_key,publication,source_title,source_date,paragraph_fingerprint,proof_revision,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('room-one',pageId,meta.libraryURL,meta.publisherKey,meta.publication,meta.title,meta.date,meta.paragraphFingerprint,meta.schema,stamp);return meta;}};
}

test('combined document family is directional and preserved through signed record validation, capture and exact page proof',async()=>{
 assert.equal(proveLibraryPublication(family,'scotsman'),'','a document-only family label cannot become a search-result alias');assert.throws(()=>libraryRecordRequest(selected(family)),/invalid_library_record/);
 for(const publication of [daily,sunday]){const f=clientFor(),remote=runtimeLibraryClient(aws,async(_url,options)=>Response.json(await handler(JSON.parse(options.body),{fetch:f.fetcher})));remote.restoreSession(session);const result=await remote.fetchLibraryRecord(selected(publication));assert.equal(result.status,'found');assert.equal(result.article.publication,family);assert.equal(f.calls(),1);const saved=cache(result.article,publication),meta=await saved.receipt();assert.equal(meta.publication,family);assert.equal(await savedLibraryReceiptMatches(saved.document,meta),true);assert.equal(saved.document.capture.url,libraryURL);assert.deepEqual(saved.document.capture.blocks.map(block=>block.text),paragraphs.map(value=>value.trim()));assert.doesNotMatch(JSON.stringify(saved.document),/originalURL|scotsman\.com/);}
});

test('a combined family source cannot excuse changed document identity, date, title, hidden or conflicting publication metadata',async()=>{
 const variants=[documentHTML({headline:'Another synthetic article headline'}),documentHTML({sourceDate:'2026-10-17'}),documentHTML({publication:daily}),documentHTML({publication:'Scotsman, The/Scotland on Sunday (England)'}),documentHTML({publication:'Scotland on Sunday'}),documentHTML({sourceAttributes:'hidden'}),documentHTML({extraSource:'<div class="document-view__meta__item--publication"><span class="source">The Guardian</span></div>'}),documentHTML({extraSource:'<div class="document-view__meta__item--publication"><span class="source">'+family+'</span></div>'}),documentHTML({publication:'Unverified native publication',extraSource:'<h2>'+family+'</h2>'})];
 for(const html of variants){const f=clientFor(html),out=await f.client.fetchLibraryRecord(selected(sunday));assert.deepEqual(out,{status:'not_found',reasonCode:'record_mismatch'});assert.equal(f.calls(),1);}
});

test('cached combined-family receipts reuse only the same room, document, exact date, title and unchanged ordered body',async()=>{
 const article=await verified(),saved=cache(article),meta=await saved.receipt(),request=saved.request('room-one');assert.equal((await roomVerifiedLibraryRecord(request,saved.c,libraryURL,selected(sunday))).id,saved.pageId);assert.equal((await roomVerifiedLibraryRecord(request,saved.c,libraryURL,selected(daily))).id,saved.pageId);
 for(const changed of [{...selected(sunday),date:'2026-10-17'},{...selected(sunday),title:'Changed synthetic title'},{...selected(sunday),publication:family},{...selected(sunday),publisher:'observer'}])assert.equal(await roomVerifiedLibraryRecord(request,saved.c,libraryURL,changed),null);
 assert.equal(await roomVerifiedLibraryRecord(saved.request('room-two'),saved.c,libraryURL,selected(sunday)),null);assert.equal(await roomVerifiedLibraryRecord(request,saved.c,libraryURL.replace('C0FFEE','DEAD123'),selected(sunday)),null);assert.equal(saved.sql.prepare('SELECT COUNT(*) n FROM rr_article_source_aliases').get().n,0);
 const changed=structuredClone(saved.document);changed.capture.blocks[0].text+=' Changed source paragraph.';assert.equal(await savedLibraryReceiptMatches(changed,meta),false);saved.sql.prepare('UPDATE education_pages SET document=? WHERE id=?').run(JSON.stringify(changed),saved.pageId);assert.equal(await roomVerifiedLibraryRecord(request,saved.c,libraryURL,selected(sunday)),null);
});

test('an explicit daily document receipt never substitutes for a Sunday selected record',async()=>{
 const f=clientFor(documentHTML({publication:daily})),out=await f.client.fetchLibraryRecord(selected(daily));assert.equal(out.status,'found');const saved=cache(out.article,daily),meta=await saved.receipt();assert.equal(meta.publication,daily);assert.equal(await roomVerifiedLibraryRecord(saved.request('room-one'),saved.c,libraryURL,selected(sunday)),null);
});
