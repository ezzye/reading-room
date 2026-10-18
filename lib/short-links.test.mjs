import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { roomLinksAPI, resolveRoomLink } from './short-links.ts';
const origin='https://reader.example', page='a'.repeat(48), other='b'.repeat(48), room='room-a', second='room-b', now=Date.now();
async function setup() {
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={prepare(query){const s=sql.prepare(query);const wrap=args=>({first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};
 const stamp=new Date(now).toISOString(), expiry=new Date(now+86400000).toISOString();
 const tokens={};
 for(const [id,role] of [['owner','owner'],['member','member'],['outsider','member']]){
 sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,stamp);
 const token=crypto.getRandomValues(new Uint8Array(32));tokens[id]=Buffer.from(token).toString('hex');const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens[id]))).toString('hex');
 sql.prepare('INSERT INTO rr_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)').run(hash,id,stamp,expiry);
 }
 for(const id of [room,second])sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(id,id,'owner',stamp);
 for(const [r,m,role] of [[room,'owner','owner'],[second,'owner','owner'],[room,'member','member'],[second,'outsider','member']])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(r,m,role,stamp);
 for(const [r,p] of [[room,page],[second,other]]){sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(p,p,'https://example.org/'+p,'Private headline','Private body',stamp);sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(r,p,'owner',stamp);}
 const req=(path,member='owner',body)=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:'__Host-rr_session='+tokens[member]+'; __Host-rr_room='+second,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 return {sql,env:{DB},req};
}

test('short paths are stable, same-origin and retain target membership across active-room changes',async()=>{
 const {sql,env,req}=await setup();
 const first=await roomLinksAPI(req('/api/room-links','owner',{id:page,roomId:room}),env,now);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'private, no-store');const {path}=await first.json();assert.match(path,/^\/r\/[A-Za-z0-9_-]{16}$/);
 const repeat=await roomLinksAPI(req('/api/room-links','member',{id:page,roomId:room}),env,now);assert.equal((await repeat.json()).path,path);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_links').get().n,1);
 const resolved=await resolveRoomLink(req(path+'?room=evil&next=https://evil.example','member'),env,now);assert.equal(resolved.status,302);assert.equal(resolved.headers.get('location'),'/read/'+page+'?room='+room);assert.equal(await resolved.text(),'');assert.equal(resolved.headers.get('cache-control'),'private, no-store');
 const changedHost=new Request('https://custom.example'+path,{headers:{Cookie:req(path).headers.get('cookie')}});assert.equal((await resolveRoomLink(changedHost,env,now)).headers.get('location'),'/read/'+page+'?room='+room);
});

test('creation and resolution reject outsiders, spoofed headers, revoked members and removed targets',async()=>{
 const {sql,env,req}=await setup();const {path}=await (await roomLinksAPI(req('/api/room-links','owner',{id:page,roomId:room}),env,now)).json();
 for(const body of [{id:page,roomId:room},{id:other,roomId:room}])assert.equal((await roomLinksAPI(req('/api/room-links','outsider',body),env,now)).status,404);
 const spoof=req(path,'outsider');spoof.headers.set('x-ret-member-id','owner');spoof.headers.set('x-rr-room-id',room);assert.equal((await resolveRoomLink(spoof,env,now)).status,404);
 sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE member_id=? AND room_id=?').run(new Date(now).toISOString(),'member',room);assert.equal((await resolveRoomLink(req(path,'member'),env,now)).status,404);
 sql.prepare('UPDATE rr_sessions SET revoked_at=? WHERE member_id=?').run(new Date(now).toISOString(),'outsider');const signedOut=await resolveRoomLink(req(path+'?next=https://evil.example','outsider'),env,now);assert.equal(signedOut.status,302);assert.equal(signedOut.headers.get('location'),'/room?next='+encodeURIComponent(path));
 sql.prepare('DELETE FROM rr_room_articles WHERE room_id=? AND page_id=?').run(room,page);assert.equal((await resolveRoomLink(req(path),env,now)).status,404);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_article_links').get().n,0);
});

test('sign-in, CSRF, input bounds, method and global revocation checks apply',async()=>{
 const {sql,env,req}=await setup();const body={id:page,roomId:room};
 const signedOut=req('/api/room-links','owner',body);signedOut.headers.delete('cookie');assert.equal((await roomLinksAPI(signedOut,env,now)).status,401);
 const csrf=req('/api/room-links','owner',body);csrf.headers.set('origin','https://evil.example');assert.equal((await roomLinksAPI(csrf,env,now)).status,403);
 assert.equal((await roomLinksAPI(req('/api/room-links'),env,now)).status,405);
 assert.equal((await roomLinksAPI(req('/api/room-links','owner',{...body,junk:'x'.repeat(1025)}),env,now)).status,400);
 assert.equal((await resolveRoomLink(req('/r/invalid'),env,now)).status,404);
 const {path}=await (await roomLinksAPI(req('/api/room-links','owner',body),env,now)).json();sql.prepare('UPDATE rr_members SET revoked_at=? WHERE id=?').run(new Date(now).toISOString(),'owner');assert.equal((await resolveRoomLink(req(path),env,now)).status,302);
});
