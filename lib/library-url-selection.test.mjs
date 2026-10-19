import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {selectedLibraryURL,libraryURLDiscoveryQuery} from './library-url-selection.mjs';
import {articleAPI} from './article-service.ts';
import {roomArticlesAPI} from './room-articles.ts';
import {readURLImportUsage,urlImportCounterKey} from './import-allowance.ts';

const origin='https://reader.example',room='family-room';
const urls={
 herald:'https://www.heraldscotland.com/news/26644107.watched-bbc-scotland-night-got-sense-doom/',
 national:'https://www.thenational.scot/news/26647064.jenny-gilruth-pledges-work-bus-companies-mcgills/',
 'irish-times':'https://www.irishtimes.com/politics/2026/10/18/taoiseach-rejects-michael-olearys-view-that-he-would-buckle-to-public-sector-unions/',
 express:'https://www.express.co.uk/showbiz/tv-radio/2258269/strictly-star-forced-leave-bbc-show-immediately',
 record:'https://www.dailyrecord.co.uk/news/scottish-news/notorious-gangster-molls-behind-scotlands-37775755',
 sundaypost:'https://www.sundaypost.com/fp/police-quietly-shelve-plan-for-independent-review-of-all-rogue-officers/'
};
function setup({connected=true}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const id of ['owner','reader'])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,id==='owner'?'owner':'member','2026-10-19');
 sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(room,'Family room','owner','2026-10-19');for(const id of ['owner','reader'])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(room,id,id==='owner'?'owner':'member','2026-10-19');
 if(connected)sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden:'+room,'ENCRYPTED-ACCOUNT-NOT-READ','connected','2026-10-19','');
 const DB={async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s._run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){const s=sql.prepare(query),wrap=args=>({_run:()=>({meta:{changes:Number(s.run(...args).changes)}}),first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 return {sql,c:{DB,RR_LIBRARY_VAULT_KEY:'SYNTHETIC-VAULT-CONFIGURED',DEEPSEEK_API_KEY:'SYNTHETIC-PROVIDER'}};
}
function request(url,{route='/api/articles',roomHeader=room,member='reader',extra={},source=origin}={}){return new Request(origin+route+'?room='+room,{method:'POST',headers:{Origin:source,'Content-Type':'application/json','X-Reading-Room':'1',...(roomHeader?{'x-rr-room-id':roomHeader}:{}),...(member?{'x-ret-member-id':member}:{})},body:JSON.stringify({url,requestId:crypto.randomUUID(),...extra})});}

test('only current selected-only publication article paths identify metadata recovery; query values never become words',()=>{
 for(const [key,url]of Object.entries(urls)){assert.equal(selectedLibraryURL(url),key);assert.equal(selectedLibraryURL(url+'?CMP=Share_AndroidApp_Other'),key);}
 for(const url of ['https://www.thetimes.com/world/europe/article/example-title-dbdlgf98v','https://www.telegraph.co.uk/politics/2026/10/18/example-story/','https://observer.co.uk/news/national/article/example-story',urls.herald.replace('https:','http:'),urls.herald.replace('www.','news.'),urls.herald.replace('heraldscotland.com','heraldscotland.com.evil.test'),urls.herald.replace('/news/','/account/'),urls.national.replace('/news/','/topics/'),urls['irish-times'].replace('/2026/10/18/','/authors/'),urls.express.replace('/2258269/','/newsletters/'),urls.herald+'#private',urls.herald+'?session=private',urls.herald+'?api_key=private',urls.herald.replace('www.','reader:password@www.'),urls.herald.replace('.com/','.com:8443/'),urls.herald.replace('watched','watched%2Fhidden'),'',null])assert.equal(selectedLibraryURL(url),'',String(url));
});

test('a connected private reader gets selection metadata for an unsupported registered URL without a source fetch, account read or completed-edition charge',async()=>{
 for(const [publisher,url]of Object.entries(urls).filter(([key])=>!['express','record','sundaypost'].includes(key))){
  const h=setup();let calls=0;const response=await articleAPI(request(url),h.c,async()=>{calls++;throw Error('Unexpected source request');}),value=await response.json();
  assert.equal(response.status,422,JSON.stringify(value));assert.deepEqual(value,{error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:publisher});assert.equal(calls,0);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM education_pages').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM education_counters').get().n,0);const usage=await readURLImportUsage(h.c);assert.equal(usage.used,0);assert.equal(usage.pending,0);assert.doesNotMatch(JSON.stringify(value),/ENCRYPTED|SYNTHETIC|cookie|cardNumber|paragraph/);
 }
});

test('a declined public Express, Record or Sunday Post request offers choices after one source attempt and charges no edition',async()=>{
 for(const key of ['express','record','sundaypost']){const h=setup(),calls=[];const response=await articleAPI(request(urls[key]),h.c,async url=>{calls.push(String(url));return new Response('Publisher unavailable',{status:403});}),value=await response.json();
 assert.equal(response.status,422,JSON.stringify(value));assert.equal(value.needsLibrarySearch,true);assert.equal(value.libraryPublisher,key);assert.equal(calls.length,1);assert.equal(new URL(calls[0]).hostname.replace(/^www\./,''),new URL(urls[key]).hostname.replace(/^www\./,''));assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM education_pages').get().n,0);const usage=await readURLImportUsage(h.c);assert.equal(usage.used,0);assert.equal(usage.pending,0);assert.equal(h.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(urlImportCounterKey()).n,1);}
});

test('room API retains the exact validated publisher hint, but does not create an article or publisher alias',async()=>{
 const h=setup(),response=await roomArticlesAPI(request(urls.herald,{route:'/api/room-articles'}),h.c,async()=>{throw Error('No source fetch');}),value=await response.json();
 assert.equal(response.status,422,JSON.stringify(value));assert.equal(value.needsLibrarySearch,true);assert.equal(value.libraryPublisher,'herald');assert.equal(Object.hasOwn(value,'href'),false);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM rr_room_articles').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM rr_article_source_aliases').get().n,0);
});

test('no connection, anonymous/cross-origin use, HTML, refresh and malformed request IDs cannot request selection recovery',async()=>{
 for(const options of [{connected:false},{member:''},{source:'https://foreign.test'},{roomHeader:''},{extra:{html:''}},{extra:{html:'<p>Saved page</p>'}},{extra:{action:'library-refresh'}},{extra:{requestId:'invalid'}}]){
  const h=setup(options),response=await articleAPI(request(urls.herald,options),h.c,async()=>{throw Error('No source fetch');}),value=await response.json();assert.notEqual(response.status,200);assert.equal(Object.hasOwn(value,'needsLibrarySearch'),false,JSON.stringify(options));assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM education_pages').get().n,0);
 }
});

test('new selected-choice URL shapes exclude sections without an article slug/id and never identify unknown P&J or News Letter paths',()=>{
 for(const url of [urls.record.replace('-37775755',''),urls.record.replace('/news/','/sport/'),urls.record.replace('-37775755','-12345'),urls.record.replace('-37775755','-1234567890123'),urls.sundaypost.replace('/fp/','/news/'),'https://www.pressandjournal.co.uk/example/unknown/article/','https://www.newsletter.co.uk/example-story-1234567'])assert.equal(selectedLibraryURL(url),'',url);
});

test('Record and Sunday Post discovery uses three distinct literal non-stopwords without treating URL words as a match',()=>{
 assert.equal(libraryURLDiscoveryQuery(urls.record),'notorious gangster molls');assert.equal(libraryURLDiscoveryQuery(urls.sundaypost),'police quietly shelve');
 assert.equal(libraryURLDiscoveryQuery(urls.record+'?headline=makeup&source=PRIVATE_QUERY'),'notorious gangster molls');
 assert.equal(libraryURLDiscoveryQuery(urls.record.replace('notorious-gangster-molls-behind-scotlands','the-police-police-and-the-courts-review')),'police courts review');
 assert.equal(libraryURLDiscoveryQuery(urls.record.replace('notorious-gangster-molls-behind-scotlands','a9-road-safety-review')),'a9 road safety');
 const longWords=[...'xyz'].map(letter=>letter.repeat(79)).join('-');assert.equal(libraryURLDiscoveryQuery(urls.sundaypost.replace('police-quietly-shelve-plan-for-independent-review-of-all-rogue-officers',longWords)).length,239);
 assert.equal(libraryURLDiscoveryQuery(urls.sundaypost.replace('police-quietly-shelve-plan-for-independent-review-of-all-rogue-officers',[...'xyz'].map(letter=>letter.repeat(80)).join('-'))),'');
 for(const [key,url]of Object.entries(urls).filter(([key])=>!['record','sundaypost'].includes(key)))assert.equal(libraryURLDiscoveryQuery(url),'',key);
});

test('short or unsafe discovery slugs and unvalidated URLs do not invent replacement search words',()=>{
 for(const raw of [urls.record.replace('notorious-gangster-molls-behind-scotlands','the-police-and-the-police'),urls.record.replace('notorious-gangster-molls-behind-scotlands','ab-cd'),urls.record.replace('notorious-gangster-molls-behind-scotlands','first-second-a1b2c3d4-third'),urls.sundaypost.replace('police-quietly-shelve-plan-for-independent-review-of-all-rogue-officers','first-second-12345678-third'),urls.record.replace('notorious','notorious%2Fprivate'),urls.record.replace('https:','http:'),urls.record.replace('dailyrecord.co.uk','dailyrecord.co.uk.evil.test'),urls.record+'?session=private',urls.record+'#private','not a URL',null])assert.equal(libraryURLDiscoveryQuery(raw),'',String(raw));
});
