import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {URL_IMPORT_LIMIT,urlImportCounterKey,nextUTCImportReset,readURLImportUsage,reserveURLImportAttempt,importRetryAfter,dailyImportLimitMessage,roomUsageAPI} from './import-allowance.ts';
import {articleAPI} from './article-service.ts';
import {roomArticlesAPI} from './room-articles.ts';
import {DEFAULT_ROOM_ID} from './rooms.ts';
const origin='https://reader.example',owner='owner-private',member='reader-private',foreign='unshared-room-private';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={sql,prepare(query){const statement=sql.prepare(query),wrap=args=>({first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 const created=new Date().toISOString();for(const [id,role] of [[owner,'owner'],[member,'member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,created);
 for(const id of [DEFAULT_ROOM_ID,foreign]){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(id,id,owner,created);sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,owner,'owner',created);}
 sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(DEFAULT_ROOM_ID,member,'member',created);return DB;
}
const config=DB=>({DB,DEEPSEEK_API_KEY:'private-key-must-not-appear'});
function request(path='/api/room-usage',body,options={}){return new Request(origin+path,{method:options.method||(body===undefined?'GET':'POST'),headers:{Origin:origin,'X-Reading-Room':'1','Content-Type':'application/json',...(options.unauthenticated?{}:{'x-rr-room-id':options.room||DEFAULT_ROOM_ID,'x-ret-member-id':options.member||owner,'x-ret-member-role':'owner'}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function addCachedPage(DB,url){const id='a'.repeat(48),doc={kind:'rendered-capture-v1',capture:{url,title:'A saved source headline',presentation:{method:'public-url',extractorRevision:3},blocks:[]}};DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id,'capture:saved',url,'A saved source headline',JSON.stringify(doc),new Date().toISOString());DB.sql.prepare('INSERT INTO rr_room_articles VALUES(?,?,?,?)').run(DEFAULT_ROOM_ID,id,owner,new Date().toISOString());return id;}

test('usage GET is authenticated, private, read-only and returns only aggregate service usage',async()=>{
 const DB=database(),time=Date.UTC(2026,9,18,20),c=config(DB);DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run('private-history-key:other-room',731);
 let response=await roomUsageAPI(request(),c,time),data=await response.json();assert.equal(response.status,200);assert.deepEqual(data,{usage:{limit:30,used:0,remaining:30,resetsAt:'2026-10-19T00:00:00.000Z',scope:'reading-room-service',failedAttemptsCount:true}});assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,1);
 for(const [name,value] of [['cache-control','private, no-store'],['referrer-policy','no-referrer'],['x-content-type-options','nosniff'],['vary','Cookie']])assert.equal(response.headers.get(name),value);
 DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run(urlImportCounterKey(time),30);const before=DB.sql.prepare('SELECT * FROM education_counters ORDER BY key').all();
 response=await roomUsageAPI(request('/api/room-usage',undefined,{member}),c,time);data=await response.json();assert.equal(data.usage.used,30);assert.equal(data.usage.remaining,0);assert.deepEqual(Object.keys(data),['usage']);assert.deepEqual(Object.keys(data.usage).sort(),['failedAttemptsCount','limit','remaining','resetsAt','scope','used'].sort());assert.doesNotMatch(JSON.stringify(data),/private|url-fetch|history|other-room|card|cookie|credential/i);assert.deepEqual(DB.sql.prepare('SELECT * FROM education_counters ORDER BY key').all(),before);
});

test('unauthenticated, cross-room and cross-site usage requests disclose no counters',async()=>{
 const DB=database(),c=config(DB);DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run(urlImportCounterKey(),30);
 for(const [options,status] of [[{unauthenticated:true},401],[{member,room:foreign},403],[{headers:{Origin:'https://evil.example'}},403],[{headers:{'Sec-Fetch-Site':'cross-site'}},403],[{headers:{Referer:'https://evil.example/private'}},403],[{method:'POST'},405]]){const response=await roomUsageAPI(request('/api/room-usage',undefined,options),c);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(await response.text(),/"used"|"remaining"|url-fetch|private-key/);}
 assert.equal(DB.sql.prepare('SELECT n FROM education_counters').get().n,30);
});

test('UTC reset, counter keys and Retry-After are independent of UK daylight saving',()=>{
 const before=Date.parse('2026-10-18T23:59:59.999Z'),after=Date.parse('2026-10-19T00:00:00.000Z');assert.equal(URL_IMPORT_LIMIT,30);assert.equal(urlImportCounterKey(before),'url-fetch:2026-10-18');assert.equal(nextUTCImportReset(before),'2026-10-19T00:00:00.000Z');assert.equal(importRetryAfter(before),'1');assert.equal(urlImportCounterKey(after),'url-fetch:2026-10-19');assert.equal(nextUTCImportReset(after),'2026-10-20T00:00:00.000Z');assert.equal(importRetryAfter(after),'86400');assert.equal(nextUTCImportReset(Date.parse('2028-02-29T23:59:59Z')),'2028-03-01T00:00:00.000Z');
 const summer=dailyImportLimitMessage('2026-10-19T00:00:00.000Z'),winter=dailyImportLimitMessage('2026-10-26T00:00:00.000Z');assert.match(summer,/01:00/);assert.match(winter,/00:00/);assert.match(summer,/newspapers, rooms and members/);assert.match(summer,/Failed imports count/);assert.match(summer,/opening saved articles does not/);assert.match(summer,/UK time \(midnight UTC\)/);
});

test('shared reservation preserves the existing 30-attempt cap and a new UTC day uses its own row',async()=>{
 const DB=database(),c=config(DB),time=Date.parse('2026-10-18T23:59:59Z');const results=await Promise.all(Array.from({length:31},()=>reserveURLImportAttempt(c,time)));assert.equal(results.filter(Boolean).length,30);assert.equal((await readURLImportUsage(c,time)).used,30);assert.equal(await reserveURLImportAttempt(c,time),false);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(urlImportCounterKey(time)).n,30);
 const next=time+1000;assert.equal((await readURLImportUsage(c,next)).used,0);assert.equal(await reserveURLImportAttempt(c,next),true);assert.equal((await readURLImportUsage(c,next)).used,1);assert.equal((await readURLImportUsage(c,time)).used,30);
});

test('cached article lookup stays before reservation, while the limit blocks all source/provider calls',async()=>{
 const DB=database(),c=config(DB),url='https://theguardian.com/uk-news/cached-community-story',id=addCachedPage(DB,url);DB.sql.prepare('INSERT INTO education_counters VALUES(?,?)').run(urlImportCounterKey(),30);let calls=0;const never=async()=>{calls++;throw Error('No source or provider call permitted');};
 const cached=await articleAPI(request('/api/articles',{url,requestId:crypto.randomUUID()}),c,never);assert.equal(cached.status,200);assert.equal((await cached.json()).href,'/read/'+id+'?room='+DEFAULT_ROOM_ID);assert.equal(calls,0);
 const blocked=await articleAPI(request('/api/articles',{url:'https://theguardian.com/world/2026/oct/18/an-unrelated-current-headline',requestId:crypto.randomUUID()}),c,never),value=await blocked.json();assert.equal(blocked.status,429);assert.equal(value.errorCode,'daily_import_limit');assert.equal(value.usage.used,30);assert.equal(value.usage.remaining,0);assert(Number(blocked.headers.get('retry-after'))>=1);assert(Number(blocked.headers.get('retry-after'))<=86400);assert.equal(calls,0);assert.equal(DB.sql.prepare('SELECT n FROM education_counters WHERE key=?').get(urlImportCounterKey()).n,30);
 const forwarded=await roomArticlesAPI(request('/api/room-articles',{url:'https://theguardian.com/world/2026/oct/18/an-unrelated-current-headline',requestId:crypto.randomUUID(),tryOriginal:true}),c,never),detail=await forwarded.json();assert.equal(forwarded.status,429);assert.equal(detail.errorCode,'daily_import_limit');assert.deepEqual(detail.usage,value.usage);assert(Number(forwarded.headers.get('retry-after'))>=1);assert.equal(calls,0);
});

test('a failed new source attempt is visible in usage without claiming a saved article',async()=>{
 const DB=database(),c=config(DB);let calls=0;const response=await articleAPI(request('/api/articles',{url:'https://theguardian.com/world/2026/oct/18/fictional-denied-source',requestId:crypto.randomUUID()}),c,async()=>{calls++;return new Response('Denied',{status:403});});assert.equal(response.status,422);assert.equal(calls,1);const usage=await (await roomUsageAPI(request(),c)).json();assert.equal(usage.usage.used,1);assert.equal(usage.usage.remaining,29);assert.equal(usage.usage.failedAttemptsCount,true);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);
});
