import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {librarySettingsAPI} from './library-server.ts';
import {sealLibrary,openLibrary} from './library-vault.mjs';

const origin='https://reader.example',email='owner@example.org',room='owner-room',vault='67'.repeat(32),session={schema:'newsbank-http-session/v1',cookies:[{name:'nb',value:'PRIVATE-COOKIE',domain:'newsbank.com',hostOnly:false,path:'/',secure:true,expires:null}]};
const metadata=()=>({status:'native-sources',schema:'newsbank-native-sources/v1',fixedQuery:'Jason Arday',pages:[{stage:'entry',path:'/apps/news/',links:[{label:'All sources',url:'https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB',path:'/apps/news/browse-multi',queryKeys:['p'],context:'source-list'}],forms:[]},{stage:'results',path:'/apps/news/results',links:[],forms:[]}],articleOpened:false,followedSourceLinks:false});
function setup(){const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE education_counters(key TEXT PRIMARY KEY,n INTEGER);CREATE TABLE rr_library_connections(id TEXT PRIMARY KEY,encrypted TEXT,state TEXT,checked_at TEXT,last_error TEXT);CREATE TABLE rr_members(id TEXT PRIMARY KEY,role TEXT,revoked_at TEXT);CREATE TABLE rr_rooms(id TEXT PRIMARY KEY,name TEXT,owner_id TEXT,created_at TEXT,moderation TEXT);CREATE TABLE rr_room_members(room_id TEXT,member_id TEXT,role TEXT,revoked_at TEXT);INSERT INTO rr_members VALUES('owner','owner',NULL);INSERT INTO rr_members VALUES('member','member',NULL);INSERT INTO rr_rooms VALUES('${room}','Fictional room','owner','2026-10-19','open');INSERT INTO rr_room_members VALUES('${room}','owner','owner',NULL);INSERT INTO rr_room_members VALUES('${room}','member','member',NULL);`);const DB={prepare(query){const statement=sql.prepare(query);return {bind(...args){return {first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>statement.run(...args)};}};}};return {sql,c:{DB,READER_OWNER_EMAIL:email,RR_LIBRARY_VAULT_KEY:vault,RR_LIBRARY_AWS_FUNCTION:'reading-room-library',RR_LIBRARY_AWS_REGION:'eu-west-1',RR_LIBRARY_AWS_ACCESS_KEY_ID:'AKIA'+'A'.repeat(16),RR_LIBRARY_AWS_SECRET_ACCESS_KEY:'synthetic-private-test-secret-123456789'}};}
async function account(sql,snapshot=session){sql.prepare('INSERT INTO rr_library_connections VALUES(?,?,?,?,?)').run('camden:'+room,await sealLibrary(vault,{libraryName:'CamdenLibraries',cardNumber:'PRIVATE-CARD',session:snapshot}),'connected',new Date().toISOString(),'');}
function request(extra={},headers={}){return new Request(origin+'/api/library-settings?room='+room,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Reading-Room':'1','oai-authenticated-user-email':email,'x-rr-room-id':room,'x-ret-member-id':'owner',...headers},body:JSON.stringify({action:'inspect-native-sources',...extra})});}

test('source inspection requires current owner, same origin, an existing encrypted session and no supplied query or URL',async()=>{
 const {sql,c}=setup();let calls=0;const never=async()=>{calls++;throw Error('No network expected');};
 for(const [r,status] of [[request({}, {Origin:'https://attacker.example'}),403],[request({}, {'x-ret-member-id':'member'}),403],[request({}, {'x-rr-room-id':''}),401],[request({query:'Different topic'}),400],[request({url:'https://attacker.example'}),400],[request(),409]])assert.equal((await librarySettingsAPI(r,c,never)).status,status);
 await account(sql,null);assert.equal((await librarySettingsAPI(request(),c,never)).status,409);assert.equal(calls,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_counters').get().n,0);
});

test('owner inspection returns only safe source metadata and preserves a twelve-check room counter without resetting history',async()=>{
 const {sql,c}=setup();await account(sql);const before=sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,counter='library-native-sources:camden:'+room+':'+new Date().toISOString().slice(0,10);sql.prepare('INSERT INTO education_counters VALUES(?,11)').run(counter);let calls=0;
 const fetcher=async(_url,options)=>{calls++;const event=JSON.parse(options.body);assert.deepEqual(Object.keys(event).sort(),['action','session']);assert.equal(event.action,'inspect-native-sources');assert.equal(event.session.cookies[0].value,'PRIVATE-COOKIE');return Response.json(metadata());};
 const response=await librarySettingsAPI(request(),c,fetcher),body=await response.json();assert.equal(response.status,200);assert.equal(body.status,'native-sources');assert.equal(body.articleOpened,false);assert.equal(body.followedSourceLinks,false);assert.equal(body.pages.length,2);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,12);assert.equal(sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,before);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|cookies|cardNumber|paragraphs|room=/);
 assert.equal((await librarySettingsAPI(request(),c,fetcher)).status,429);assert.equal(calls,1);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,12);
});

test('a stored previous five-check balance advances to six without a new counter or reset',async()=>{
 const {sql,c}=setup();await account(sql);const counter='library-native-sources:camden:'+room+':'+new Date().toISOString().slice(0,10);sql.prepare('INSERT INTO education_counters VALUES(?,5)').run(counter);let calls=0;
 const response=await librarySettingsAPI(request(),c,async()=>{calls++;return Response.json(metadata());});assert.equal(response.status,200);assert.equal(calls,1);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(counter).n,6);assert.equal(sql.prepare("SELECT COUNT(*) n FROM education_counters WHERE key LIKE 'library-native-sources:%'").get().n,1);
});

test('native inspection refreshes only an expired existing session under the unchanged login guard',async()=>{
 const {sql,c}=setup();await account(sql);const actions=[],refreshed={...session,cookies:session.cookies.map(cookie=>({...cookie,value:'REFRESHED-COOKIE'}))};
 const fetcher=async(_url,options)=>{const event=JSON.parse(options.body);actions.push(event.action);if(event.action==='connect'){assert.equal(event.cardNumber,'PRIVATE-CARD');return Response.json({status:'authenticated',session:refreshed});}assert.deepEqual(Object.keys(event).sort(),['action','session']);return Response.json(actions.length===1?{status:'login_required',stage:'entry',reasonCode:'session_expired'}:metadata());};
 const response=await librarySettingsAPI(request(),c,fetcher);assert.equal(response.status,200);assert.equal((await response.json()).status,'native-sources');assert.deepEqual(actions,['inspect-native-sources','connect','inspect-native-sources']);const saved=await openLibrary(vault,sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted);assert.equal(saved.session.cookies[0].value,'REFRESHED-COOKIE');assert.equal(sql.prepare("SELECT n FROM education_counters WHERE key LIKE 'library-login:%'").get().n,1);
});

test('native inspection cannot exceed the existing ten-login guard or reset its count',async()=>{
 const {sql,c}=setup();await account(sql);const key='library-login:camden:'+room+':'+new Date().toISOString().slice(0,10);sql.prepare('INSERT INTO education_counters VALUES(?,10)').run(key);let calls=0;
 const response=await librarySettingsAPI(request(),c,async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).action,'inspect-native-sources');return Response.json({status:'login_required',stage:'entry',reasonCode:'session_expired'});});assert.equal(response.status,429);assert.equal((await response.json()).reasonCode,'session_expired');assert.equal(calls,1);assert.equal(sql.prepare('SELECT n FROM education_counters WHERE key=?').get(key).n,10);
});

test('challenges, malformed metadata and owner revocation disclose no source payload and cannot refresh an account',async()=>{
 for(const failure of ['challenge','malformed','revoked']){const {sql,c}=setup();await account(sql);const before=sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted;let calls=0;const response=await librarySettingsAPI(request(),c,async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).action,'inspect-native-sources');if(failure==='challenge')return Response.json({status:'needs_interaction',stage:'entry',reasonCode:'entry_needs_interaction'});if(failure==='revoked')sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE member_id=?').run('2026-10-19','owner');return Response.json(failure==='malformed'?{...metadata(),body:'PRIVATE-PROSE'}:metadata());});assert.equal(response.status,failure==='revoked'?403:failure==='malformed'?502:200);const text=await response.text();assert.doesNotMatch(text,/PRIVATE|PROSE|All sources/);assert.equal(calls,1);assert.equal(sql.prepare('SELECT encrypted FROM rr_library_connections').get().encrypted,before);assert.equal(sql.prepare("SELECT COUNT(*) n FROM education_counters WHERE key LIKE 'library-login:%'").get().n,0);}
});

test('collapsed owner utility uses the explicit room and shows only fixed native source metadata as text',async()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8'),{document,window}=parseHTML(html),calls=[];assert.equal(document.getElementById('native-source-panel').hasAttribute('open'),false);
 const value={...metadata(),account:'PRIVATE-ACCOUNT',room:'PRIVATE-ROOM',pages:metadata().pages.map(page=>({...page,body:'PRIVATE-BODY'}))};
 vm.runInContext(document.querySelector('script').textContent,vm.createContext({document,window:{location:{href:origin+'/library-coverage?room=selected-room'}},URL,URLSearchParams,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json(value);}}));document.getElementById('native-source-submit').dispatchEvent(new window.Event('click'));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[{url:'/api/library-settings?room=selected-room',body:{action:'inspect-native-sources'}}]);assert.match(document.getElementById('native-source-results').textContent,/All sources/);assert.equal(document.querySelectorAll('#native-source-results a').length,0);const exported=document.getElementById('native-source-json').value;assert.equal(JSON.parse(exported).articleOpened,false);assert.doesNotMatch(exported,/PRIVATE|account|body|selected-room/i);assert.equal(document.getElementById('native-source-export').hidden,false);
});

test('owner utility reports an observed A–Z list honestly and projects three pages and bounded source rows',async()=>{
 const html=readFileSync(new URL('./library-coverage.html',import.meta.url),'utf8');
 for(const opened of [false,true]){
  const {document,window}=parseHTML(html),value=metadata();value.sourceListOpened=opened;value.metadataTruncated=opened;
  if(opened)value.pages.splice(1,0,{stage:'source-list',path:'/apps/news/source-list',links:[],forms:[],sourceRows:[{label:'Financial Times',url:'https://infoweb.newsbank.com/apps/news/results?p=UKNB&t=pubname%3AFinancial%20Times',fields:[{name:'Coverage',value:'Current text',body:'PRIVATE-FIELD'}],body:'PRIVATE-ROW'}]});
  vm.runInContext(document.querySelector('script').textContent,vm.createContext({document,window:{location:{href:origin+'/library-coverage?room=selected-room'}},URL,URLSearchParams,fetch:async()=>Response.json(value)}));document.getElementById('native-source-submit').dispatchEvent(new window.Event('click'));await new Promise(resolve=>setImmediate(resolve));
  const status=document.getElementById('native-source-status').textContent,exported=document.getElementById('native-source-json').value,result=JSON.parse(exported);assert.equal(result.sourceListOpened,opened);assert.equal(result.metadataTruncated,opened);assert.equal(result.pages.length,opened?3:2);assert.equal(result.articleOpened,false);assert.equal(result.followedSourceLinks,false);assert.match(status,/No article or publication browse page was opened/);assert.doesNotMatch(status,/no article or source-list link opened/);assert.doesNotMatch(exported,/PRIVATE|body/);
  if(opened){assert.match(status,/observed A–Z source list was read/);assert.equal(result.pages[1].sourceRows[0].fields[0].value,'Current text');assert.match(document.getElementById('native-source-results').textContent,/Financial Times.*Coverage: Current text/);}else assert.match(status,/No A–Z source-list page was opened/);
 }
});

test('owner inspection preserves the new bounded source-list failure stage without claiming that no list was read',async()=>{
 const {sql,c}=setup();await account(sql);const response=await librarySettingsAPI(request(),c,async()=>Response.json({status:'needs_interaction',stage:'source-list',reasonCode:'entry_needs_interaction'})),result=await response.json();assert.equal(response.status,200);assert.equal(result.stage,'source-list');assert.equal(result.reasonCode,'entry_needs_interaction');assert.match(result.reason,/No article or publication browse page/);assert.doesNotMatch(result.reason,/source-list link was opened/);
});
