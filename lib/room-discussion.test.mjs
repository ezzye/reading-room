import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {roomDiscussionAPI} from './room-discussion.ts';
import {withRoomDiscussion} from './room-discussion-view.mjs';

const roomA='room-a',roomB='room-b',pageA='a'.repeat(48),pageB='b'.repeat(48);
const now='2026-10-18T12:00:00.000Z';
const uuid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const n of ['0000_kind_onslaught','0001_overrated_the_leader','0002_sturdy_sally_floyd','0003_concerned_justin_hammer'])sql.exec(readFileSync(new URL(`../drizzle/${n}.sql`,import.meta.url),'utf8'));
  for(const [id,role] of [['owner','owner'],['alice','member'],['bob','member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id==='owner'?'Room owner':id==='alice'?'Alice':'Bob',role,now);
  for(const [id,moderation] of [[roomA,'approval'],[roomB,'open']]){
    sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at,moderation) VALUES(?,?,?,?,?)').run(id,id,'owner',now,moderation);
    for(const member of ['owner','alice','bob'])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,member,member==='owner'?'owner':'member',now);
  }
  for(const page of [pageA,pageB])sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(page,page,'https://example.org/'+page,'Synthetic article','{}',now);
  sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomA,pageA,'owner',now);
  sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomB,pageA,'owner',now);
  sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(roomB,pageB,'owner',now);
  const DB={prepare(q){const statement=sql.prepare(q);const bound=(values=[])=>({first:async()=>statement.get(...values)||null,all:async()=>({results:statement.all(...values)}),run:async()=>({meta:{changes:Number(statement.run(...values).changes)}})});return {...bound(),bind:(...values)=>bound(values)};}};
  return {sql,DB};
}
function req(member,room,page,body,extra={}){
  const method=body?'POST':'GET';
  return new Request(`https://reader.example/api/room-discussion?page=${page}&room=${room}`,{method,headers:{'x-ret-member-id':member,'x-rr-room-id':room,'x-ret-member-role':member==='owner'?'owner':'member',...(body?{'Origin':'https://reader.example','X-Reading-Room':'1','Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify({pageId:page,...body})}:{})});
}
const post=(i,text='A clear point about this synthetic article.',parentId=null)=>({action:'post',requestId:uuid(i),text,parentId});
async function call(c,member,room,page,body,extra){return roomDiscussionAPI(req(member,room,page,body,extra),c);}
async function comments(c,member,room,page){return (await(await call(c,member,room,page)).json()).comments;}

test('room article access and reply parents are checked in the selected room',async()=>{
  const {DB}=fixture(),c={DB};
  assert.equal((await call(c,'alice',roomA,pageB)).status,404);
  const first=await(await call(c,'alice',roomA,pageA,post(1))).json();
  assert.equal((await call(c,'bob',roomB,pageA,post(2,'A cross-room reply',first.id))).status,400);
  assert.equal((await call(c,'alice',roomA,pageB,post(3))).status,404);
  assert.equal((await call(c,'alice',roomA,pageA,{action:'edit',commentId:uuid(99),text:'Changed'})).status,404);
  assert.deepEqual(await comments(c,'bob',roomB,pageA),[]);
});

test('approval, member visibility, and hiding a parent keep the whole thread private',async()=>{
  const {DB}=fixture(),c={DB};
  const root=await(await call(c,'alice',roomA,pageA,post(10))).json();
  assert.equal(root.pending,true);
  assert.equal((await comments(c,'alice',roomA,pageA))[0].status,'pending');
  assert.deepEqual(await comments(c,'bob',roomA,pageA),[]);
  assert.equal((await comments(c,'owner',roomA,pageA))[0].name,'Alice');
  assert.equal((await call(c,'bob',roomA,pageA,{action:'approve',commentId:root.id})).status,403);
  assert.equal((await call(c,'owner',roomA,pageA,{action:'approve',commentId:root.id})).status,200);
  const child=await(await call(c,'bob',roomA,pageA,post(11,'I see another angle.',root.id))).json();
  assert.equal(child.pending,true);
  assert.equal((await call(c,'owner',roomA,pageA,{action:'approve',commentId:child.id})).status,200);
  assert.equal((await comments(c,'alice',roomA,pageA)).length,2);
  await call(c,'owner',roomA,pageA,{action:'hide',commentId:root.id});
  assert.deepEqual(await comments(c,'alice',roomA,pageA),[]);
  assert.equal((await comments(c,'owner',roomA,pageA)).length,2);
  assert.equal((await call(c,'bob',roomA,pageA,post(12,'Reply after hiding',root.id))).status,400);
});

test('authors control only their comments; text stays plain and writes require same origin',async()=>{
  const {DB}=fixture(),c={DB};
  const injection='<img src=x onerror=alert(1)> SELECT * FROM rr_room_comments';
  assert.equal((await call(c,'alice',roomB,pageA,post(20,injection),{Origin:'https://evil.example'})).status,403);
  const made=await(await call(c,'alice',roomB,pageA,post(20,injection))).json();
  assert.equal(made.pending,false);
  assert.equal((await call(c,'alice',roomB,pageA,post(20,injection))).status,200);
  assert.equal((await call(c,'alice',roomB,pageB,post(20,injection))).status,409);
  assert.equal((await comments(c,'bob',roomB,pageA))[0].text,injection);
  assert.equal((await call(c,'bob',roomB,pageA,{action:'edit',commentId:made.id,text:'Rewritten'})).status,403);
  assert.equal((await call(c,'bob',roomB,pageA,{action:'delete',commentId:made.id})).status,403);
  assert.equal((await call(c,'alice',roomB,pageB,{action:'edit',commentId:made.id,text:'Rewritten'})).status,404);
  assert.equal((await call(c,'alice',roomB,pageA,{action:'edit',commentId:made.id,text:'A revised point'})).status,200);
  assert.equal((await comments(c,'bob',roomB,pageA))[0].text,'A revised point');
  const html=withRoomDiscussion('<html><body><article>Original text</article></body></html>',{id:pageA},{roomId:roomB});
  assert.match(html,/<article>Original text<\/article>/);
  assert.match(html,/textContent=row\.text/);
  assert.doesNotMatch(html,/<img src=x onerror/);
  const embedded=html.match(/<script id="ret-room-discussion-script">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded);new Script(embedded);
});

test('a revoked room membership cannot read or change its old comments',async()=>{
  const {DB,sql}=fixture(),c={DB};
  const made=await(await call(c,'alice',roomB,pageA,post(30))).json();
  sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run(now,roomB,'alice');
  assert.equal((await call(c,'alice',roomB,pageA)).status,403);
  assert.equal((await call(c,'alice',roomB,pageA,{action:'edit',commentId:made.id,text:'Changed'})).status,403);
});
