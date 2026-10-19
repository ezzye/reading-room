import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { memberAuthAPI, memberAuthGate, isPublicMemberAuthPath, safeMemberNextPath } from './member-auth.ts';

const origin='https://reader.example',ownerEmail='owner@example.org',now=Date.parse('2026-10-17T12:00:00.000Z');
function db(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sql,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s._run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}},prepare(q){const s=sql.prepare(q);const wrap=a=>({_run:()=>({success:true,meta:{changes:Number(s.run(...a).changes)}}),first:async()=>s.get(...a)||null,all:async()=>({results:s.all(...a)}),run:async()=>({success:true,meta:{changes:Number(s.run(...a).changes)}})});return {...wrap([]),bind(...a){return wrap(a)}}}}}

function env(DB,extra={}){return {DB,READER_OWNER_EMAIL:ownerEmail,...extra};}
function req(action,method='GET',body,options={}){const headers={Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(options.cookie?{Cookie:options.cookie}:{}),...(options.headers||{})};return new Request(`${origin}/api/member-auth?action=${action}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}
async function body(response){return response.json();}
async function bootstrap(DB){const response=await memberAuthAPI(req('bootstrap','POST',{}, {headers:{'oai-authenticated-user-email':ownerEmail}}),env(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now);assert.equal(response.status,201);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);return cookie.split(';')[0];}
async function invite(DB,cookie,purpose='member'){const response=await memberAuthAPI(req('invite','POST',{purpose}, {cookie}),env(DB),now);assert.equal(response.status,201);return new URLSearchParams(new URL((await body(response)).url).hash.slice(1)).get('invite');}
test('first owner bootstrap requires the explicit flag, matching identity, and same origin, then OAI headers stop authenticating',async()=>{const DB=db();assert.equal((await memberAuthAPI(req('bootstrap','POST',{}, {headers:{'oai-authenticated-user-email':ownerEmail}}),env(DB),now)).status,401);assert.equal((await memberAuthAPI(req('bootstrap','POST',{}, {headers:{'oai-authenticated-user-email':'attacker@example.org'}}),env(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now)).status,401);assert.equal((await memberAuthAPI(req('bootstrap','POST',{}, {headers:{Origin:'https://evil.example','oai-authenticated-user-email':ownerEmail}}),env(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now)).status,403);const cookie=await bootstrap(DB);const again=await memberAuthAPI(req('bootstrap','POST',{}, {headers:{'oai-authenticated-user-email':ownerEmail}}),env(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now);assert.equal(again.status,401);assert.equal((await memberAuthAPI(req('session','GET',undefined,{headers:{'oai-authenticated-user-email':ownerEmail}}),env(DB,{RR_TRUST_SITES_BOOTSTRAP:'1'}),now)).status,401);assert.match(cookie,/^__Host-rr_session=[a-f0-9]{64}$/);});
test('one-use invite creates a member and a 90-day secure opaque session',async()=>{const DB=db(),owner=await bootstrap(DB),token=await invite(DB,owner);const response=await memberAuthAPI(req('accept','POST',{token,displayName:'Daughter',purpose:'device',role:'owner'}),env(DB),now);assert.equal(response.status,201);const data=await body(response);assert.equal(data.member.role,'member');assert.equal(data.member.displayName,'Daughter');assert.equal(Date.parse(data.expiresAt)-now,90*86400000);for(const attr of ['HttpOnly','Secure','SameSite=Lax'])assert(response.headers.get('set-cookie').includes(attr));const retry=await memberAuthAPI(req('accept','POST',{token,displayName:'Second device'}),env(DB),now);assert.equal(retry.status,410);});
test('parallel attempts to consume the same invitation create only one member and session',async()=>{const DB=db(),owner=await bootstrap(DB),token=await invite(DB,owner);const results=await Promise.all([memberAuthAPI(req('accept','POST',{token,displayName:'Daughter'}),env(DB),now),memberAuthAPI(req('accept','POST',{token,displayName:'Other'}),env(DB),now)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,410]);assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rr_members WHERE role='member'").get().n,1);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_sessions').get().n,2);});
test('expired invitations and cross-origin writes are rejected',async()=>{const DB=db(),owner=await bootstrap(DB),token=await invite(DB,owner);DB.sql.prepare('UPDATE rr_invites SET expires_at=?').run(new Date(now-1).toISOString());assert.equal((await memberAuthAPI(req('accept','POST',{token,displayName:'Daughter'}),env(DB),now)).status,410);const DB2=db(),owner2=await bootstrap(DB2),token2=await invite(DB2,owner2);assert.equal((await memberAuthAPI(req('accept','POST',{token:token2,displayName:'Daughter'},{headers:{Origin:'https://evil.example'}}),env(DB2),now)).status,403);});
test('session expiry and member revocation invalidate access and member cannot manage other users',async()=>{const DB=db(),owner=await bootstrap(DB),token=await invite(DB,owner),accepted=await memberAuthAPI(req('accept','POST',{token,displayName:'Daughter'}),env(DB),now),memberCookie=accepted.headers.get('set-cookie').split(';')[0];assert.equal((await memberAuthAPI(req('admin'),env(DB),now)).status,401);assert.equal((await memberAuthAPI(req('invite','POST',{}, {cookie:memberCookie}),env(DB),now)).status,403);assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:memberCookie}}),env(DB),now+90*86400000+1)).status,401);const listed=await memberAuthAPI(req('admin','GET',undefined,{cookie:owner}),env(DB),now),member=(await body(listed)).members.find(x=>x.role==='member');assert(member);assert.deepEqual(await body(await memberAuthAPI(req('revoke-member','POST',{memberId:member.id},{cookie:owner}),env(DB),now)),{revoked:true});assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:memberCookie}}),env(DB),now)).status,401);});
test('gate rejects private paths, allows only the auth shell, strips forged OAI identity, and mints owner identity from session',async()=>{const DB=db();assert.equal(isPublicMemberAuthPath('/room'),true);assert.equal(isPublicMemberAuthPath('/api/member-auth'),true);assert.equal(isPublicMemberAuthPath('/api/articles'),false);assert.equal((await memberAuthGate(new Request(origin+'/api/articles'),env(DB),now)).status,401);const owner=await bootstrap(DB);const ownerRequest=await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:owner,'oai-authenticated-user-email':'attacker@example.org','oai-authenticated-user-id':'spoofed'}}),env(DB),now);assert(ownerRequest instanceof Request);assert.equal(ownerRequest.headers.get('oai-authenticated-user-email'),ownerEmail);assert.equal(ownerRequest.headers.get('oai-authenticated-user-id'),null);});
test('safe return paths preserve bounded same-origin path and query while rejecting open redirects',async()=>{assert.equal(safeMemberNextPath('/capture?source=invite'),'/capture?source=invite');for(const bad of [null,'','//evil.example/a','///evil.example','https://evil.example/','javascript:alert(1)','/\\evil.example','/%5c%5cevil.example','/room','/api/member-auth','/'.padEnd(1025,'a'),'/capture#fragment'])assert.equal(safeMemberNextPath(bad),'/capture');const DB=db(),response=await memberAuthGate(new Request(origin+'/capture?story=one&view=source#ignored'),env(DB),now);assert.equal(response.status,302);const target=new URL(response.headers.get('Location'));assert.equal(target.pathname,'/room');assert.equal(target.searchParams.get('next'),'/capture?story=one&view=source');assert.equal(target.hash,'');});
test('room owners cannot globally revoke another member session',async()=>{const DB=db(),owner=await bootstrap(DB),token=await invite(DB,owner),accepted=await memberAuthAPI(req('accept','POST',{token,displayName:'Daughter'}),env(DB),now),memberCookie=accepted.headers.get('set-cookie').split(';')[0],memberId=(await body(await memberAuthAPI(req('session','GET',undefined,{cookie:memberCookie}),env(DB),now))).member.id,sessionId=DB.sql.prepare('SELECT token_hash FROM rr_sessions WHERE member_id=?').get(memberId).token_hash;assert.deepEqual(await body(await memberAuthAPI(req('revoke-session','POST',{sessionId},{cookie:owner}),env(DB),now)),{revoked:false});assert((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:memberCookie}}),env(DB),now)) instanceof Request);});


test('owner device invitation adds a second owner session without creating another member',async()=>{const DB=db(),ownerCookie=await bootstrap(DB),token=await invite(DB,ownerCookie,'device'),accepted=await memberAuthAPI(req('accept','POST',{token,deviceLabel:'Owner phone'}),env(DB),now);assert.equal(accepted.status,201);const data=await body(accepted),phoneCookie=accepted.headers.get('set-cookie').split(';')[0];assert.equal(data.member.role,'owner');assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rr_members WHERE role='owner'").get().n,1);assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rr_sessions WHERE member_id=(SELECT id FROM rr_members WHERE role='owner')").get().n,2);const listed=await body(await memberAuthAPI(req('admin','GET',undefined,{cookie:phoneCookie}),env(DB),now));assert(listed.sessions.some(x=>x.device_label==='Owner phone'));});

test('owner can revoke an old owner device from a new one while the current session cannot revoke itself',async()=>{const DB=db(),oldCookie=await bootstrap(DB),token=await invite(DB,oldCookie,'device'),accepted=await memberAuthAPI(req('accept','POST',{token,deviceLabel:'Current phone'}),env(DB),now),currentCookie=accepted.headers.get('set-cookie').split(';')[0],listed=await body(await memberAuthAPI(req('admin','GET',undefined,{cookie:currentCookie}),env(DB),now)),old=listed.sessions.find(x=>x.device_label==="Owner's first device"),current=listed.sessions.find(x=>x.device_label==='Current phone');assert(old?.sessionId&&current?.sessionId);assert.deepEqual(await body(await memberAuthAPI(req('revoke-session','POST',{sessionId:old.sessionId},{cookie:currentCookie}),env(DB),now)),{revoked:true});assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:oldCookie}}),env(DB),now)).status,401);assert.deepEqual(await body(await memberAuthAPI(req('revoke-session','POST',{sessionId:current.sessionId},{cookie:currentCookie}),env(DB),now)),{revoked:false,reason:'current-device'});assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:currentCookie}}),env(DB),now)) instanceof Request,true);});

async function reader(DB,owner){const token=await invite(DB,owner),r=await memberAuthAPI(req('accept','POST',{token,displayName:'Study reader'},{cookie:''}),env(DB),now);assert.equal(r.status,201);return{cookie:r.headers.get('set-cookie').split(';')[0],member:(await r.json()).member};}
async function deviceLink(DB,cookie,at=now,extra={}){const r=await memberAuthAPI(req('device-invite','POST',extra,{cookie}),env(DB),at);assert.equal(r.status,201);const data=await r.json();return{...data,token:new URLSearchParams(new URL(data.url).hash.slice(1)).get('invite')};}

test('owners and invited readers connect phone and laptop as the same identity without upgrading roles',async()=>{
 for(const role of ['owner','member']){
  const DB=db(),owner=await bootstrap(DB),person=role==='owner'?{cookie:owner,member:(await body(await memberAuthAPI(req('session','GET',undefined,{cookie:owner}),env(DB),now))).member}:await reader(DB,owner),before=DB.sql.prepare('SELECT COUNT(*) n FROM rr_members').get().n;
  const link=await deviceLink(DB,person.cookie,now,{memberId:'forged-owner',role:'owner',purpose:'member'});assert.equal(Date.parse(link.expiresAt)-now,600000);assert.equal(link.role,role);assert.equal(DB.sql.prepare('SELECT token_hash FROM rr_invites WHERE purpose=?').get('device').token_hash===link.token,false);
  const accepted=await memberAuthAPI(req('accept','POST',{token:link.token,deviceLabel:'My laptop',role:'owner'}),env(DB),now);assert.equal(accepted.status,201);const data=await accepted.json(),cookie=accepted.headers.get('set-cookie').split(';')[0];assert.equal(data.member.id,person.member.id);assert.equal(data.member.role,role);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_members').get().n,before);
  assert.equal((await memberAuthAPI(req('admin','GET',undefined,{cookie}),env(DB),now)).status,role==='owner'?200:403);
  assert.equal((await memberAuthAPI(req('accept','POST',{token:link.token,deviceLabel:'Replay'}),env(DB),now)).status,410);
  const back=await deviceLink(DB,cookie);const phone=await memberAuthAPI(req('accept','POST',{token:back.token,deviceLabel:'My phone'}),env(DB),now);assert.equal(phone.status,201);assert.equal((await phone.json()).member.id,person.member.id);
 }
});

test('self-device links reject missing authorization, cross-site requests, expiry and revoked membership',async()=>{
 const DB=db(),owner=await bootstrap(DB),person=await reader(DB,owner);
 assert.equal((await memberAuthAPI(req('device-invite','POST',{}),env(DB),now)).status,401);
 assert.equal((await memberAuthAPI(req('device-invite','POST',{}, {cookie:person.cookie,headers:{Origin:'https://evil.example'}}),env(DB),now)).status,403);
 const expired=await deviceLink(DB,person.cookie);assert.equal((await memberAuthAPI(req('accept','POST',{token:expired.token,deviceLabel:'Expired'}),env(DB),now+600001)).status,410);
 const link=await deviceLink(DB,person.cookie);DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE member_id=?').run(new Date(now).toISOString(),person.member.id);
 assert.equal((await memberAuthAPI(req('accept','POST',{token:link.token,deviceLabel:'Revoked'}),env(DB),now)).status,410);
 assert.equal((await memberAuthAPI(req('device-invite','POST',{}, {cookie:person.cookie}),env(DB),now)).status,403);
});

test('device lists and sign-out controls expose and affect only the current person',async()=>{
 const DB=db(),owner=await bootstrap(DB),person=await reader(DB,owner),link=await deviceLink(DB,person.cookie),accepted=await memberAuthAPI(req('accept','POST',{token:link.token,deviceLabel:'My laptop'}),env(DB),now),laptop=accepted.headers.get('set-cookie').split(';')[0];
 const listed=await body(await memberAuthAPI(req('devices','GET',undefined,{cookie:person.cookie}),env(DB),now));assert.equal(listed.devices.length,2);assert.equal(listed.devices.filter(d=>d.current).length,1);assert(!JSON.stringify(listed).includes("Owner's first device"));assert(!JSON.stringify(listed).includes(laptop.split('=')[1]));
 const ownerId=(await body(await memberAuthAPI(req('devices','GET',undefined,{cookie:owner}),env(DB),now))).devices[0].sessionId;
 assert.deepEqual(await body(await memberAuthAPI(req('revoke-device','POST',{sessionId:ownerId},{cookie:person.cookie}),env(DB),now)),{revoked:false});
 const current=listed.devices.find(d=>d.current),other=listed.devices.find(d=>!d.current);
 assert.deepEqual(await body(await memberAuthAPI(req('revoke-device','POST',{sessionId:current.sessionId},{cookie:person.cookie}),env(DB),now)),{revoked:false,reason:'current-device'});
 assert.deepEqual(await body(await memberAuthAPI(req('revoke-device','POST',{sessionId:other.sessionId},{cookie:person.cookie}),env(DB),now)),{revoked:true});
 assert.equal((await memberAuthAPI(req('session','GET',undefined,{cookie:laptop}),env(DB),now)).status,401);assert.equal((await memberAuthAPI(req('session','GET',undefined,{cookie:owner}),env(DB),now)).status,200);
});

test('new self-device links are bounded and cannot target another existing person',async()=>{
 const DB=db(),owner=await bootstrap(DB),person=await reader(DB,owner);for(let i=0;i<5;i++)await deviceLink(DB,person.cookie);
 assert.equal((await memberAuthAPI(req('device-invite','POST',{}, {cookie:person.cookie}),env(DB),now)).status,429);
 const invalid=await deviceLink(DB,owner),hash=DB.sql.prepare('SELECT token_hash FROM rr_invites WHERE created_by=(SELECT id FROM rr_members WHERE role=?) AND purpose=?').get('owner','device').token_hash;
 DB.sql.prepare('UPDATE rr_invites SET member_id=? WHERE token_hash=?').run(person.member.id,hash);
 assert.equal((await memberAuthAPI(req('accept','POST',{token:invalid.token,deviceLabel:'Wrong identity'}),env(DB),now)).status,410);
});

test('an invited reader can recover their own account without becoming owner or signing out anyone else',async()=>{
 const DB=db(),owner=await bootstrap(DB),person=await reader(DB,owner),link=await deviceLink(DB,person.cookie),device=await memberAuthAPI(req('accept','POST',{token:link.token,deviceLabel:'Old laptop'}),env(DB),now),oldLaptop=device.headers.get('set-cookie').split(';')[0];
 const response=await memberAuthAPI(req('recovery-create','POST',{}, {cookie:person.cookie}),env(DB),now);assert.equal(response.status,201);const recovery=await response.json(),token=new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recover');assert.equal(Date.parse(recovery.expiresAt)-now,90*86400000);
 const restored=await memberAuthAPI(req('recover','POST',{token,deviceLabel:'Replacement phone'}),env(DB),now);assert.equal(restored.status,201);const member=(await restored.json()).member,cookie=restored.headers.get('set-cookie').split(';')[0];assert.equal(member.id,person.member.id);assert.equal(member.role,'member');assert.equal((await memberAuthAPI(req('admin','GET',undefined,{cookie}),env(DB),now)).status,403);
 for(const old of [person.cookie,oldLaptop])assert.equal((await memberAuthAPI(req('session','GET',undefined,{cookie:old}),env(DB),now)).status,401);
 assert.equal((await memberAuthAPI(req('session','GET',undefined,{cookie:owner}),env(DB),now)).status,200);assert.equal((await memberAuthAPI(req('recover','POST',{token,deviceLabel:'Replay'}),env(DB),now)).status,410);
});

test('owner recovery link is hashed, one-use, and expires after 90 days',async()=>{const DB=db(),ownerCookie=await bootstrap(DB),first=await body(await memberAuthAPI(req('recovery-create','POST',{}, {cookie:ownerCookie}),env(DB),now)),firstToken=new URLSearchParams(new URL(first.url).hash.slice(1)).get('recover');assert(firstToken);assert.equal(Date.parse(first.expiresAt)-now,90*86400000);assert.equal(DB.sql.prepare('SELECT token_hash FROM rr_recovery_codes').get().token_hash===firstToken,false);const second=await body(await memberAuthAPI(req('recovery-create','POST',{}, {cookie:ownerCookie}),env(DB),now)),secondToken=new URLSearchParams(new URL(second.url).hash.slice(1)).get('recover');assert.equal((await memberAuthAPI(req('recover','POST',{token:firstToken,deviceLabel:'Recovery device'}),env(DB),now)).status,410);DB.sql.prepare('UPDATE rr_recovery_codes SET expires_at=? WHERE used_at IS NULL').run(new Date(now-1).toISOString());assert.equal((await memberAuthAPI(req('recover','POST',{token:secondToken,deviceLabel:'Expired device'}),env(DB),now)).status,410);const third=await body(await memberAuthAPI(req('recovery-create','POST',{}, {cookie:ownerCookie}),env(DB),now)),thirdToken=new URLSearchParams(new URL(third.url).hash.slice(1)).get('recover'),recovered=await memberAuthAPI(req('recover','POST',{token:thirdToken,deviceLabel:'Recovery device'}),env(DB),now);assert.equal(recovered.status,201);assert.equal((await body(recovered)).member.role,'owner');assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rr_members WHERE role='owner'").get().n,1);assert.equal((await memberAuthAPI(req('recover','POST',{token:thirdToken,deviceLabel:'Second try'}),env(DB),now)).status,410);});
test('recovery closes old owner sessions and outstanding owner-device links',async()=>{const DB=db(),oldOwnerCookie=await bootstrap(DB),deviceToken=await invite(DB,oldOwnerCookie,'device'),device=await memberAuthAPI(req('accept','POST',{token:deviceToken,deviceLabel:'Previously signed in phone'}),env(DB),now),deviceCookie=device.headers.get('set-cookie').split(';')[0],pendingDeviceToken=await invite(DB,oldOwnerCookie,'device'),recovery=await body(await memberAuthAPI(req('recovery-create','POST',{}, {cookie:oldOwnerCookie}),env(DB),now)),recoveryToken=new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recover'),restored=await memberAuthAPI(req('recover','POST',{token:recoveryToken,deviceLabel:'Recovered phone'}),env(DB),now),newOwnerCookie=restored.headers.get('set-cookie').split(';')[0];assert.equal(restored.status,201);assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:oldOwnerCookie}}),env(DB),now)).status,401);assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:deviceCookie}}),env(DB),now)).status,401);assert.equal((await memberAuthAPI(req('accept','POST',{token:pendingDeviceToken,deviceLabel:'Stolen device'}),env(DB),now)).status,410);assert.equal((await memberAuthGate(new Request(origin+'/api/articles',{headers:{Cookie:newOwnerCookie}}),env(DB),now)) instanceof Request,true);});

test('active invites are capped at 100 and owner actions purge expired records',async()=>{const DB=db(),owner=await bootstrap(DB);for(let i=0;i<100;i++){const result=await memberAuthAPI(req('invite','POST',{purpose:'member'}, {cookie:owner}),env(DB),now);assert.equal(result.status,201)}assert.equal((await memberAuthAPI(req('invite','POST',{}, {cookie:owner}),env(DB),now)).status,429);DB.sql.prepare('UPDATE rr_invites SET expires_at=? WHERE used_at IS NULL').run(new Date(now-1).toISOString());const created=await memberAuthAPI(req('invite','POST',{}, {cookie:owner}),env(DB),now);assert.equal(created.status,201);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM rr_invites').get().n,1);});

test('JSON request parsing stops and cancels a streaming body above 4096 bytes',async()=>{const DB=db();let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(5000))},cancel(){cancelled=true}});const request=new Request(origin+'/api/member-auth?action=accept',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:stream,duplex:'half'});const response=await memberAuthAPI(request,env(DB),now);assert.equal(response.status,400);assert.equal(cancelled,true)});

test("only fixed generic brand and install assets are public",async()=>{const {isPublicMemberAuthPath}=await import("./member-auth.ts");for(const path of ["/favicon.svg","/reading-room-logo.svg","/icon-192.png","/icon-512.png","/manifest.webmanifest","/sw.js"])assert.equal(isPublicMemberAuthPath(path),true);for(const path of ["/critical-assets/private.jpg","/api/room-media","/read/abc","/assets/article.html","/ret-corpus.json"])assert.equal(isPublicMemberAuthPath(path),false);});

test('only the two exact approved guide assets bypass member authentication',async()=>{
 for(const path of ['/reading-room-guide.mp4','/reading-room-guide.jpg'])assert.equal(isPublicMemberAuthPath(path),true,path);
 for(const path of ['/reading-room-guide-private.mp4','/reading-room-guide.mp4/extra','/reading-room-guide.jpg.bak','/Reading-room-guide.mp4','/assets/reading-room-guide.mp4','/critical-assets/reading-room-guide.jpg','/private-assets/reading-room-guide.mp4','/api/room-media']){
  assert.equal(isPublicMemberAuthPath(path),false,path);
  const response=await memberAuthGate(new Request(origin+path),env(db()),now);
  assert(response instanceof Response,path);
  assert.equal(response.status,path.startsWith('/api/')?401:302,path);
 }
});

async function authShell(next,fragment='invite=synthetic-invite',returned='/capture'){
 const {parseHTML}=await import('linkedom/worker');const {runInNewContext}=await import('node:vm');
 const html=readFileSync(new URL('./member-auth.html',import.meta.url),'utf8'),{document}=parseHTML(html),redirects=[],historyCalls=[];
 const location={origin,pathname:'/room',search:'?next='+encodeURIComponent(next),hash:fragment?'#'+fragment:'',replace:value=>redirects.push(value)};
 const context={document,location,URL,URLSearchParams,history:{replaceState:(_a,_b,value)=>historyCalls.push(value)},addEventListener(){},fetch:async()=>({ok:true,json:async()=>({nextPath:returned,member:{displayName:'Reader'}})})};
 runInNewContext(document.querySelector('script').textContent.replace(/start\(\);\s*$/,''),context);
 return {context,document,redirects,historyCalls};
}
test('server and access-shell return-path checks preserve a shared study query and reject redirects',async()=>{
 const article='https://www.telegraph.co.uk/world-news/2026/10/17/fictional-river-archive/';
 const next='/study?url='+encodeURIComponent(article)+'&title='+encodeURIComponent('Fictional river archive opens a new walking route');
 const shell=await authShell(next);assert.equal(shell.context.safeNext(next),next);assert.equal(safeMemberNextPath(next),next);
 const DB=db(),response=await memberAuthGate(new Request(origin+next),env(DB),now);assert.equal(new URL(response.headers.get('location')).searchParams.get('next'),next);
 for(const input of ['//evil.example/a','https://evil.example/a','/\\evil.example','/%5c%5cevil.example','/room?next=/study','/api/member-auth?action=accept','/study#invite=secret','/study?url=%E0%A4%A','/'.padEnd(1025,'a')]){assert.equal(shell.context.safeNext(input),'/capture');assert.equal(safeMemberNextPath(input),'/capture');}
});
test('ordinary invitation, owner-device and recovery defaults retain the requested study envelope',async()=>{
 const next='/study?article='+encodeURIComponent('eyJ1cmwiOiJodHRwczovL2V4YW1wbGUub3JnL2ZpY3Rpb25hbCIsInRpdGxlIjoiRmljdGlvbmFsIHJpdmVyIGFyY2hpdmUifQ');
 for(const fragment of ['invite=synthetic&purpose=member','invite=synthetic&purpose=device','recover=synthetic']){
  const shell=await authShell(next,fragment);await shell.context.start();shell.document.getElementById('display-name').value='Reader device';await shell.document.getElementById('join-button').onclick();assert.deepEqual(shell.redirects,[next]);assert.equal(shell.historyCalls.length,1);assert.equal(shell.historyCalls[0].includes('#'),false);
 }
});
test('article-bound invitation destination wins over pending shared intake; unsafe replies cannot redirect externally',async()=>{
 const next='/study?article=synthetic-envelope',article='/read/'+'a'.repeat(48)+'?room=00000000-0000-4000-8000-000000000001';
 for(const [reply,expected] of [[article,article],['https://evil.example/a',next],['//evil.example/a',next],['/room?next=//evil.example',next]]){
  const shell=await authShell(next,'invite=synthetic&purpose=member',reply);await shell.context.start();await shell.document.getElementById('join-button').onclick();assert.deepEqual(shell.redirects,[expected]);
 }
 const empty=await authShell('//evil.example','invite=synthetic','/capture');await empty.context.start();await empty.document.getElementById('join-button').onclick();assert.deepEqual(empty.redirects,['/study']);
});

test('signed-out private-link entry connects known Reading Room origins on the current origin',async()=>{
 const next='/study?paper=times',shell=await authShell(next,''),token='a'.repeat(64);
 for(const host of ['https://dayofflondon.com','https://www.dayofflondon.com','https://reader.example.org',origin]){
  const target=shell.context.connectionDestination(host+'/room#invite='+token+'&purpose=device');
  const parsed=new URL(target,origin);assert.equal(parsed.origin,origin);assert.equal(parsed.pathname,'/room');assert.equal(parsed.searchParams.get('next'),next);assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('invite'),token);
 }
 const recovery=new URL(shell.context.connectionDestination('https://dayofflondon.com/room#recover='+token),origin);
 assert.equal(new URLSearchParams(recovery.hash.slice(1)).get('recover'),token);
 const privateArticle='/read/'+'c'.repeat(48)+'?room=room-one',link='https://dayofflondon.com/room?next='+encodeURIComponent(privateArticle)+'#invite='+token;
 assert.equal(new URL(shell.context.connectionDestination(link),origin).searchParams.get('next'),privateArticle);
});

test('private-link entry rejects unknown origins, mixed credentials and external return paths',async()=>{
 const shell=await authShell('/study',''),token='b'.repeat(64);
 for(const value of ['', 'https://evil.example/room#invite='+token,'http://dayofflondon.com/room#invite='+token,'https://dayofflondon.com.evil.example/room#invite='+token,'https://user:pass'+'@dayofflondon.com/room#invite='+token,'https://dayofflondon.com:444/room#invite='+token,'https://dayofflondon.com/study#invite='+token,'https://dayofflondon.com/room#invite=short','https://dayofflondon.com/room#invite='+token+'&recover='+token,'https://dayofflondon.com/room#invite='+token+'&invite='+token,'https://dayofflondon.com/room#invite='+token+'&purpose=owner','https://dayofflondon.com/room#invite='+token+'&purpose=device&purpose=member'])assert.throws(()=>shell.context.connectionDestination(value));
 const safe=new URL(shell.context.connectionDestination('https://dayofflondon.com/room?next=https://evil.example/#invite='+token),origin);
 assert.equal(safe.origin,origin);assert.equal(safe.searchParams.get('next'),'/capture');
});

test('public welcome does not expose private shelves, articles, media or owner settings', async()=>{
 assert.equal(isPublicMemberAuthPath('/'),true);
 for(const path of ['/study','/read/example','/api/room-articles','/api/rooms','/api/library-settings','/library-settings','/critical-assets/photo.jpg','//','/index.html']) {
  assert.equal(isPublicMemberAuthPath(path),false,path);
  const response=await memberAuthGate(new Request(origin+path),env(db()),now);
  assert(response instanceof Response,path);
  assert.equal(response.status,path.startsWith('/api/')?401:302,path);
 }
});
