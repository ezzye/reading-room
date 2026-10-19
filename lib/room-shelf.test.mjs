import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {memberAuthAPI,memberAuthGate,roomsAPI} from './member-auth.ts';
import {roomArticlesAPI} from './room-articles.ts';
import {roomDiscussionAPI} from './room-discussion.ts';
import {roomLinksAPI,resolveRoomLink} from './short-links.ts';
import {DEFAULT_ROOM_ID,accessiblePage} from './rooms.ts';
import {updateRoomArticleArchive} from './room-shelf.ts';

const origin='https://reader.example',now=Date.parse('2026-10-19T18:00:00Z'),ownerEmail='owner@example.org';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {sql,async batch(items){sql.exec('BEGIN');try{const values=items.map(i=>i._run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){const s=sql.prepare(query),wrap=args=>({_run:()=>({meta:{changes:Number(s.run(...args).changes)}}),first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}};}
function raw(path,method='GET',body,cookie='',headers={}){return new Request(origin+path,{method,headers:{Origin:origin,'X-Reading-Room':'1',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});}
function jar(response,old=''){const values=new Map(old.split(';').filter(Boolean).map(p=>p.trim().split('=')));for(const line of response.headers.getSetCookie()){const [key,value]=line.split(';')[0].split('=');value?values.set(key,value):values.delete(key);}return [...values].map(([k,v])=>k+'='+v).join('; ');}
async function setup(){const DB=database(),c={DB,READER_OWNER_EMAIL:ownerEmail};const boot=await memberAuthAPI(raw('/api/member-auth?action=bootstrap','POST',{},'',{'oai-authenticated-user-email':ownerEmail}),{...c,RR_TRUST_SITES_BOOTSTRAP:'1'},now);assert.equal(boot.status,201);const owner=jar(boot);const invited=await memberAuthAPI(raw('/api/member-auth?action=invite','POST',{},owner),c,now),token=new URLSearchParams(new URL((await invited.json()).url).hash.slice(1)).get('invite');const joined=await memberAuthAPI(raw('/api/member-auth?action=accept','POST',{token,displayName:'Reader'}),c,now),member=jar(joined),memberId=(await joined.json()).member.id;const other=await roomsAPI(raw('/api/rooms','POST',{action:'create',name:'Other room'},owner),c,now),otherRoom=(await other.json()).room.id,otherCookie=jar(other,owner);return {DB,c,owner,member,memberId,otherRoom,otherCookie};}
async function gated(h,cookie,path,method='GET',body,headers={}){const r=await memberAuthGate(raw(path,method,body,cookie,headers),h.c,now);assert(r instanceof Request,'request must pass actual session gate');return r;}
async function shelf(h,cookie=h.owner,query=''){const response=await roomArticlesAPI(await gated(h,cookie,'/api/room-articles'+query),h.c);return {response,data:await response.json()};}
async function mutate(h,action,id,cookie=h.owner,headers={}){return roomArticlesAPI(await gated(h,cookie,'/api/room-articles','POST',{action,id},headers),h.c);}
const pid=i=>i.toString(16).padStart(48,'0');
function seed(h,room,id,added=new Date(now).toISOString(),source='https://example.org/article/'+id){const document=JSON.stringify({kind:'rendered-capture-v1',capture:{title:'Fictional article '+id,publisher:'Example paper',blocks:[{id:'B1',type:'paragraph',text:'Fictional study prose.'},{id:'B2',type:'figure',url:'https://images.example.org/study.jpg'},{id:'B3',type:'video',url:'https://www.youtube.com/embed/abcdefghijk'}]},annotations:[{blockId:'B1',title:'Test critique',comment:'Check the evidence.'}]});h.DB.sql.prepare('INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES(?,?,?,?,?,?)').run(id,'synthetic:'+id,source,'Fictional article '+id,document,added);const owner=h.DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(room).owner_id;h.DB.sql.prepare('INSERT INTO rr_room_articles(room_id,page_id,added_by,created_at) VALUES(?,?,?,?)').run(room,id,owner,added);return document;}
function comment(h,id,page,member,parent=null,status='approved'){const stamp=new Date(now).toISOString();h.DB.sql.prepare('INSERT INTO rr_room_comments(id,room_id,page_id,member_id,parent_id,request_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,DEFAULT_ROOM_ID,page,member,parent,id,'A preserved discussion '+id,status,stamp,stamp);}

test('archive and restore preserve edition, media, critique, threaded comments, invitations and private links',async()=>{
 const h=await setup(),id=pid(1),original=seed(h,DEFAULT_ROOM_ID,id),ownerId=h.DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(DEFAULT_ROOM_ID).owner_id;
 const parentId=crypto.randomUUID(),replyId=crypto.randomUUID();comment(h,parentId,id,ownerId);comment(h,replyId,id,h.memberId,parentId);
 const comments=h.DB.sql.prepare('SELECT * FROM rr_room_comments ORDER BY id').all(),association=h.DB.sql.prepare('SELECT * FROM rr_room_articles').get();
 const link=await roomLinksAPI(await gated(h,h.owner,'/api/room-links','POST',{id,roomId:DEFAULT_ROOM_ID}),h.c,now),{path}=await link.json();
 const invite=await memberAuthAPI(raw('/api/member-auth?action=invite','POST',{articleId:id},h.owner),h.c,now);assert.equal(invite.status,201);const invitations=h.DB.sql.prepare('SELECT * FROM rr_invites').all();
 assert.deepEqual((await shelf(h)).data.counts,{active:1,archived:0});
 assert.equal((await mutate(h,'archive',id)).status,200);assert.equal((await mutate(h,'archive',id)).status,200,'retry is idempotent');
 const active=await shelf(h),archived=await shelf(h,h.member,'?view=archived');assert.equal(active.data.articles.length,0);assert.deepEqual(active.data.counts,{active:0,archived:1});assert.equal(archived.data.articles[0].id,id);assert.equal(archived.data.articles[0].commentCount,2);assert.equal(archived.data.canArchive,false);
 assert.equal(await accessiblePage(await gated(h,h.member,'/read/'+id),h.c,id),true);
 const resolved=await resolveRoomLink(raw(path,'GET',undefined,h.member),h.c,now);assert.equal(resolved.status,302);assert.match(resolved.headers.get('location'),new RegExp('/read/'+id));
 const discussion=await roomDiscussionAPI(await gated(h,h.member,'/api/room-discussion?page='+id),h.c);assert.equal(discussion.status,200);assert.equal((await discussion.json()).comments.length,2);
 const newReply=await roomDiscussionAPI(await gated(h,h.member,'/api/room-discussion','POST',{action:'post',pageId:id,parentId,requestId:crypto.randomUUID(),text:'A new reply while this article is archived.'}),h.c);assert.equal(newReply.status,201);const newReplyId=(await newReply.json()).id;
 assert.equal((await mutate(h,'restore',id)).status,200);assert.equal((await mutate(h,'restore',id)).status,200);
 assert.deepEqual((await shelf(h)).data.counts,{active:1,archived:0});assert.equal((await shelf(h)).data.articles[0].id,id);
 assert.equal(h.DB.sql.prepare('SELECT document FROM education_pages WHERE id=?').get(id).document,original);assert.deepEqual(h.DB.sql.prepare('SELECT * FROM rr_room_comments WHERE id IN (?,?) ORDER BY id').all(parentId,replyId),comments);assert.equal(h.DB.sql.prepare('SELECT parent_id FROM rr_room_comments WHERE id=?').get(newReplyId).parent_id,parentId);assert.deepEqual(h.DB.sql.prepare('SELECT * FROM rr_room_articles').get(),association);assert.deepEqual(h.DB.sql.prepare('SELECT * FROM rr_invites').all(),invitations);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM rr_article_links').get().n,1);
});

test('owner-only archive and restore reject members, forged roles, other rooms, invalid IDs and cross-origin writes',async()=>{
 const h=await setup(),id=pid(1),other=pid(2);seed(h,DEFAULT_ROOM_ID,id);seed(h,h.otherRoom,other);
 for(const action of ['archive','restore']){assert.equal((await mutate(h,action,id,h.member,{'x-ret-member-role':'owner'})).status,403);assert.equal((await mutate(h,action,other)).status,404);assert.equal((await mutate(h,action,id,h.otherCookie)).status,404);assert.equal((await mutate(h,action,'bad')).status,400);assert.equal((await mutate(h,action,id,h.owner,{Origin:'https://evil.example'})).status,403);}
 assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM rr_room_article_archive').get().n,0);
 assert.equal((await mutate(h,'archive',other,h.otherCookie)).status,200);assert.equal((await shelf(h)).data.counts.archived,0);assert.equal((await shelf(h,h.otherCookie,'?view=archived')).data.articles[0].id,other);
 h.DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run(new Date(now).toISOString(),DEFAULT_ROOM_ID,h.memberId);const denied=await memberAuthGate(raw('/api/room-articles?view=archived','GET',undefined,h.member),h.c,now);assert.equal(denied.status,401);
});

test('stable cursor pagination reaches every article beyond 100 even with identical dates and duplicate source URLs',async()=>{
 const h=await setup();for(let i=1;i<=157;i++)seed(h,DEFAULT_ROOM_ID,pid(i),new Date(now).toISOString(),'https://example.org/same-source');
 let cursor=null,ids=[],pages=0;do{const {response,data}=await shelf(h,h.owner,cursor?'?cursor='+encodeURIComponent(cursor):'');assert.equal(response.status,200);assert.equal(data.counts.active,157);assert.equal(data.page.limit,50);assert(data.articles.length<=50);ids.push(...data.articles.map(a=>a.id));cursor=data.page.nextCursor;pages++;}while(cursor);
 assert.equal(pages,4);assert.equal(ids.length,157);assert.equal(new Set(ids).size,157);assert.equal(ids[0],pid(157));assert.equal(ids.at(-1),pid(1));
 const first=(await shelf(h)).data;seed(h,DEFAULT_ROOM_ID,pid(158),new Date(now+1000).toISOString());const second=(await shelf(h,h.owner,'?cursor='+encodeURIComponent(first.page.nextCursor))).data;assert.deepEqual(second.articles.map(a=>a.id),ids.slice(50,100));
 for(const query of ['?view=bad','?cursor=bad','?limit=0','?limit=-1','?limit=101','?limit=2x','?cursor='])assert.equal((await shelf(h,h.owner,query)).response.status,400);
 assert.equal((await shelf(h,h.owner,'?view=archived&cursor='+encodeURIComponent(first.page.nextCursor))).response.status,400);assert.equal((await shelf(h,h.otherCookie,'?cursor='+encodeURIComponent(first.page.nextCursor))).response.status,400);
});

test('archived pagination, empty views and restoration retain original shelf order without reimport',async()=>{
 const h=await setup(),ownerId=h.DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(DEFAULT_ROOM_ID).owner_id,room={id:DEFAULT_ROOM_ID,member_id:ownerId,role:'owner'};
 assert.deepEqual((await shelf(h,h.member,'?view=archived')).data.counts,{active:0,archived:0});
 for(let i=1;i<=103;i++){seed(h,DEFAULT_ROOM_ID,pid(i),new Date(now+i*1000).toISOString());await updateRoomArticleArchive(h.c,room,'archive',pid(i),now+i*1000);}
 let cursor=null,ids=[];do{const {data}=await shelf(h,h.member,'?view=archived'+(cursor?'&cursor='+encodeURIComponent(cursor):''));ids.push(...data.articles.map(a=>a.id));cursor=data.page.nextCursor;}while(cursor);assert.equal(ids.length,103);assert.equal(new Set(ids).size,103);
 await mutate(h,'restore',pid(2));await mutate(h,'restore',pid(1));assert.deepEqual((await shelf(h)).data.articles.map(a=>a.id),[pid(2),pid(1)]);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM education_pages').get().n,103);
});


test('ownership revoked after authorization cannot change archive state at write time',async()=>{
 const h=await setup(),id=pid(1);seed(h,DEFAULT_ROOM_ID,id);const ownerId=h.DB.sql.prepare('SELECT owner_id FROM rr_rooms WHERE id=?').get(DEFAULT_ROOM_ID).owner_id,stale={id:DEFAULT_ROOM_ID,member_id:ownerId,role:'owner'};
 h.DB.sql.prepare('UPDATE rr_room_members SET revoked_at=? WHERE room_id=? AND member_id=?').run(new Date(now).toISOString(),DEFAULT_ROOM_ID,ownerId);
 await assert.rejects(()=>updateRoomArticleArchive(h.c,stale,'archive',id),error=>error instanceof Response&&error.status===404);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM rr_room_article_archive').get().n,0);
});
