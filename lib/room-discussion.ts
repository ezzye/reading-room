import {accessiblePage, requireRoom} from './rooms.ts';
import type {MemberAuthEnv} from './member-auth.ts';

type DBRow = {id:string;room_id:string;page_id:string;member_id:string;parent_id:string|null;request_id:string;body:string;status:'pending'|'approved'|'hidden';created_at:string;updated_at:string;display_name:string};
type Config = MemberAuthEnv;
const PAGE_RE=/^[a-f0-9]{48}$/;
const ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMMENTS=300;
const MAX_DEPTH=6;
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
const error=(message:string,status:number)=>response({error:message},status);

function sameOrigin(r:Request){
  if(r.headers.get('X-Reading-Room')!=='1'||r.headers.get('Sec-Fetch-Site')==='cross-site')return false;
  try{return r.headers.get('Origin')===new URL(r.url).origin;}catch{return false;}
}
async function readBody(r:Request){
  if(Number(r.headers.get('content-length')||0)>8000||!r.body)throw Error('Invalid request body.');
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>8000){await reader.cancel();throw Error('Request too large.');}chunks.push(next.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const value=JSON.parse(new TextDecoder().decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid request body.');
  return value as Record<string,unknown>;
}
function cleanText(value:unknown){return typeof value==='string'?value.trim():'';}

async function list(r:Request,c:Config,pageId:string,room:Awaited<ReturnType<typeof requireRoom>>){
  const rows=(await c.DB.prepare(`SELECT c.*,m.display_name FROM rr_room_comments c
    JOIN rr_members m ON m.id=c.member_id WHERE c.room_id=? AND c.page_id=?
    ORDER BY c.created_at,c.id LIMIT ?`).bind(room.id,pageId,MAX_COMMENTS+1).all<DBRow>()).results||[];
  if(rows.length>MAX_COMMENTS)return error('This discussion is full.',409);
  // Show only rows whose whole ancestry is visible. Hiding a parent cannot expose its text
  // or leave a child looking like a top-level comment to another member.
  const byId=new Map(rows.map(row=>[row.id,row]));
  const visible=(row:DBRow):boolean=>{
    let current:DBRow|undefined=row;const seen=new Set<string>();
    for(let depth=0;current&&depth<=MAX_DEPTH;depth++){
      if(seen.has(current.id))return false;seen.add(current.id);
      if(room.role!=='owner'&&current.status!=='approved'&&current.member_id!==room.member_id)return false;
      if(current.status==='hidden'&&room.role!=='owner')return false;
      if(!current.parent_id)return true;
      current=byId.get(current.parent_id);
    }
    return false;
  };
  return response({moderation:room.moderation,role:room.role,comments:rows.filter(visible).map(row=>({
    id:row.id,parentId:row.parent_id,name:row.display_name||'Room member',text:row.body,
    status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
    canEdit:row.member_id===room.member_id&&row.status!=='hidden',
    canModerate:room.role==='owner'
  }))});
}

async function approvedParent(c:Config,roomId:string,pageId:string,parentId:string){
  let id:string|null=parentId;
  for(let depth=1;id&&depth<=MAX_DEPTH;depth++){
    const parent: {id:string;parent_id:string|null;status:string}|null=await c.DB.prepare('SELECT id,parent_id,status FROM rr_room_comments WHERE id=? AND room_id=? AND page_id=?')
      .bind(id,roomId,pageId).first<{id:string;parent_id:string|null;status:string}>();
    if(!parent||parent.status!=='approved')return null;
    if(!parent.parent_id)return depth;
    id=parent.parent_id;
  }
  return null;
}

export async function roomDiscussionAPI(r:Request,c:Config):Promise<Response>{
  try{
    if(r.method!=='GET'&&r.method!=='POST')return error('Method not allowed.',405);
    if(r.method==='POST'&&!sameOrigin(r))return error('Use the room discussion controls.',403);
    const room=await requireRoom(r,c);
    let data:Record<string,unknown>={};
    if(r.method==='POST')try{data=await readBody(r);}catch{return error('Invalid request body.',400);}
    const pageId=r.method==='GET'?new URL(r.url).searchParams.get('page'):data.pageId;
    if(typeof pageId!=='string'||!PAGE_RE.test(pageId))return error('Article not found.',404);
    if(!await accessiblePage(r,c,pageId))return error('Article not found in this room.',404);
    if(r.method==='GET')return list(r,c,pageId,room);

    const action=data.action;
    if(action==='post'){
      const text=cleanText(data.text),requestId=data.requestId,parentId=data.parentId??null;
      if(text.length<2||text.length>1500)return error('Use 2 to 1,500 characters.',400);
      if(typeof requestId!=='string'||!ID_RE.test(requestId))return error('Invalid request ID.',400);
      if(parentId!==null&&(typeof parentId!=='string'||!ID_RE.test(parentId)))return error('Invalid reply target.',400);
      const previous=await c.DB.prepare('SELECT id,status,page_id FROM rr_room_comments WHERE room_id=? AND member_id=? AND request_id=?')
        .bind(room.id,room.member_id,requestId).first<{id:string;status:string;page_id:string}>();
      if(previous)return previous.page_id===pageId?response({id:previous.id,pending:previous.status==='pending'}):error('Request ID belongs to another article.',409);
      if(parentId){const depth=await approvedParent(c,room.id,pageId,parentId);if(!depth)return error('Reply to an approved comment in this article.',400);if(depth>=MAX_DEPTH)return error('This reply chain is full. Start a new comment.',400);}
      const count=await c.DB.prepare('SELECT COUNT(*) AS n FROM rr_room_comments WHERE room_id=? AND page_id=?').bind(room.id,pageId).first<{n:number}>();
      if(Number(count?.n||0)>=MAX_COMMENTS)return error('This discussion is full.',429);
      const since=new Date(Date.now()-60*60*1000).toISOString();
      const recent=await c.DB.prepare('SELECT COUNT(*) AS n FROM rr_room_comments WHERE room_id=? AND member_id=? AND created_at>=?')
        .bind(room.id,room.member_id,since).first<{n:number}>();
      if(Number(recent?.n||0)>=12)return error('You have reached the hourly comment limit. Try later.',429);
      const id=crypto.randomUUID(),now=new Date().toISOString(),status=room.role==='owner'||room.moderation==='open'?'approved':'pending';
      try{await c.DB.prepare(`INSERT INTO rr_room_comments
        (id,room_id,page_id,member_id,parent_id,request_id,body,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,room.id,pageId,room.member_id,parentId,requestId,text,status,now,now).run();}
      catch(ex){
        const retry=await c.DB.prepare('SELECT id,status,page_id FROM rr_room_comments WHERE room_id=? AND member_id=? AND request_id=?')
          .bind(room.id,room.member_id,requestId).first<{id:string;status:string;page_id:string}>();
        if(retry)return retry.page_id===pageId?response({id:retry.id,pending:retry.status==='pending'}):error('Request ID belongs to another article.',409);
        throw ex;
      }
      return response({id,pending:status==='pending'},201);
    }
    const commentId=data.commentId;
    if(typeof commentId!=='string'||!ID_RE.test(commentId))return error('Comment not found.',404);
    const comment=await c.DB.prepare('SELECT id,member_id,status,parent_id FROM rr_room_comments WHERE id=? AND room_id=? AND page_id=?')
      .bind(commentId,room.id,pageId).first<{id:string;member_id:string;status:string;parent_id:string|null}>();
    if(!comment)return error('Comment not found.',404);
    const now=new Date().toISOString();
    if(action==='edit'||action==='delete'){
      if(comment.member_id!==room.member_id)return error('You can change only your own comments.',403);
      if(comment.status==='hidden')return error('This comment is hidden.',409);
      if(action==='delete'){
        await c.DB.prepare("UPDATE rr_room_comments SET status='hidden',updated_at=? WHERE id=? AND room_id=? AND page_id=? AND member_id=?")
          .bind(now,commentId,room.id,pageId,room.member_id).run();
        return response({updated:true});
      }
      const text=cleanText(data.text);
      if(text.length<2||text.length>1500)return error('Use 2 to 1,500 characters.',400);
      const status=room.role==='owner'||room.moderation==='open'?'approved':'pending';
      await c.DB.prepare('UPDATE rr_room_comments SET body=?,status=?,updated_at=? WHERE id=? AND room_id=? AND page_id=? AND member_id=?')
        .bind(text,status,now,commentId,room.id,pageId,room.member_id).run();
      return response({updated:true,pending:status==='pending'});
    }
    if(action==='approve'||action==='hide'){
      if(room.role!=='owner')return error('Only the room owner can moderate comments.',403);
      if(action==='approve'&&comment.parent_id&&!await approvedParent(c,room.id,pageId,comment.parent_id))return error('Approve the parent first.',409);
      await c.DB.prepare('UPDATE rr_room_comments SET status=?,updated_at=? WHERE id=? AND room_id=? AND page_id=?')
        .bind(action==='approve'?'approved':'hidden',now,commentId,room.id,pageId).run();
      return response({updated:true});
    }
    return error('Unknown discussion action.',400);
  }catch(ex){
    if(ex instanceof Response)return ex;
    return error('Discussion is temporarily unavailable.',503);
  }
}
