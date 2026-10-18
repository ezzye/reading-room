import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {librarySearchAPI,librarySearchChoice} from './library-search.ts';
import {librarySearchQuery,sanitizeLibrarySearch} from './library-search-contract.mjs';

const origin='https://reader.example',time=Date.parse('2026-10-19T10:00:00Z'),input={publisher:'observer',query:'Jason Arday'};
const publication='Observer, The: Web Edition Articles (London, England)';
const metadata=()=>({status:'library-search',schema:'newsbank-library-search/v1',requested:input,pageCount:1,inspectedCount:1,truncated:false,results:[{title:'Fictional interview with a university researcher',date:'2026-10-18',publication,libraryURL:'https://infoweb.newsbank.com/apps/news/document-view?p=UKNB&docref=news/ABCDEF'}],fullTextVerified:false,articleAccepted:false});
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const [id,role] of [['owner','owner'],['member','member'],['other','member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,'2026-10-19');
 for(const room of ['room-one','room-two']){sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(room,room,'owner','2026-10-19');for(const member of ['owner','member','other'])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(room,member,member==='owner'?'owner':'member','2026-10-19');sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden:'+room,'SYNTHETIC-ENCRYPTED-ACCOUNT','connected','2026-10-19','');}
 const DB={prepare(query){const s=sql.prepare(query),wrap=args=>({first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 return {sql,c:{DB,RR_LIBRARY_VAULT_KEY:'67'.repeat(32)}};
}
function request(data=input,{room='room-one',member='member',source=origin,method='POST'}={}){return new Request(origin+'/api/library-search?room='+room,{method,headers:{Origin:source,'X-Reading-Room':'1','Content-Type':'application/json','x-rr-room-id':room,'x-ret-member-id':member},...(method==='POST'?{body:JSON.stringify(data)}:{})});}
const noNetwork=async()=>{throw Error('No network calls expected');};

test('library search accepts short subject queries only for registered papers and refuses body-bearing or unverified metadata',()=>{
 assert.deepEqual(librarySearchQuery(input),input);
 for(const bad of [{...input,query:'Jason'},{...input,query:'https://example.org Jason'},{...input,query:'x'.repeat(241)},{...input,publisher:'guardian'},{...input,url:'https://example.org'},{...input,query:'<p>Jason Arday</p>'}])assert.throws(()=>librarySearchQuery(bad));
 assert.equal(sanitizeLibrarySearch(metadata()).results.length,1);
 for(const bad of [{...metadata(),body:'PRIVATE'},{...metadata(),pageCount:2},{...metadata(),results:[{...metadata().results[0],publication:'The Guardian'}]},{...metadata(),results:[{...metadata().results[0],date:'2026-02-31'}]},{...metadata(),results:[{...metadata().results[0],snippet:'PRIVATE'}]},{...metadata(),results:[{...metadata().results[0],libraryURL:'https://attacker.example/steal'}]}])assert.equal(sanitizeLibrarySearch(bad),null);
});

test('library metadata choices retain exact source identity for 30 minutes and stay private to their room and member',async()=>{
 const {sql,c}=setup();let calls=0;
 const response=await librarySearchAPI(request(),c,noNetwork,time,{search:async(config,query)=>{calls++;assert.equal(config.RR_ACTIVE_ROOM_ID,'room-one');assert.deepEqual(query,input);return metadata();}}),body=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(body.articleAccepted,false);assert.equal(body.fullTextVerified,false);assert.equal(body.results[0].source,'Camden');assert.match(body.results[0].choiceId,/^[a-f0-9]{48}$/);assert.doesNotMatch(JSON.stringify(body),/ABCDEF|ENCRYPTED|library_url|cookies|cardNumber|paragraphs|room-one/);
 const id=body.results[0].choiceId,choice=await librarySearchChoice(request(),c,id,time);assert.equal(new URL(choice.library_url).searchParams.get('docref'),'news/ABCDEF');assert.equal(Date.parse(choice.expires_at)-time,30*60*1000);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,0);
 assert.equal(await librarySearchChoice(request(input,{room:'room-two'}),c,id,time),null);assert.equal(await librarySearchChoice(request(input,{member:'other'}),c,id,time),null);assert.equal(await librarySearchChoice(request(),c,id,time+30*60*1000),null);
 sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run('2026-10-19','room-one','member');await assert.rejects(()=>librarySearchChoice(request(),c,id,time),error=>error instanceof Response&&error.status===403);
});

test('library search checks membership, same origin, input and room account before calling the bridge',async()=>{
 const {sql,c}=setup();let calls=0;const search=async()=>{calls++;return metadata();};
 for(const [r,status] of [[request(input,{source:'https://attacker.example'}),403],[request(input,{member:'outsider'}),403],[request(input,{member:''}),401],[request(input,{method:'GET'}),405],[request({...input,query:'single'}),400],[request({...input,publisher:'guardian'}),400]])assert.equal((await librarySearchAPI(r,c,noNetwork,time,{search})).status,status);
 sql.prepare('DELETE FROM rr_library_connections WHERE id=?').run('camden:room-one');assert.equal((await librarySearchAPI(request(),c,noNetwork,time,{search})).status,409);assert.equal(calls,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0);
});

test('the 30-query room guard preserves existing counts, is shared by members and stops source calls',async()=>{
 const {sql,c}=setup(),key='library-headline-search:room-one:2026-10-19';sql.prepare('INSERT INTO education_counters VALUES(?,28)').run(key);let calls=0;const search=async()=>{calls++;return metadata();};
 assert.equal((await librarySearchAPI(request(),c,noNetwork,time,{search})).status,200);assert.equal((await librarySearchAPI(request(input,{member:'other'}),c,noNetwork,time,{search})).status,200);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(key).n,30);
 assert.equal((await librarySearchAPI(request(),c,noNetwork,time,{search})).status,429);assert.equal(calls,2);assert.equal((await librarySearchAPI(request(input,{room:'room-two'}),c,noNetwork,time,{search})).status,200);
});

test('revocation during a search and hostile bridge metadata cannot create a selectable record',async()=>{
 for(const revoke of [true,false]){
  const {sql,c}=setup(),response=await librarySearchAPI(request(),c,noNetwork,time,{search:async()=>{if(revoke){sql.prepare('UPDATE rr_members SET revoked_at=? WHERE id=?').run('2026-10-19','member');return metadata();}return {...metadata(),session:'PRIVATE-SESSION',paragraphs:['PRIVATE-PROSE']};}});
  assert.equal(response.status,revoke?403:502);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_library_search_choices').get().n,0);assert.doesNotMatch(await response.text(),/PRIVATE|SESSION|PROSE/);
 }
});
