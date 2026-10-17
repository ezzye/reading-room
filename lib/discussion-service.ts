import {roomId} from './rooms.ts';
import {isEditionAuthor} from './edition-access.ts';
import {resolveShared,isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
const hex48=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{48}$/.test(x);
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
async function ensure(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS ret_discussion_comments (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, request_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','hidden')), created_at TEXT NOT NULL, UNIQUE(page_id,request_id))`).run();await db.prepare('CREATE INDEX IF NOT EXISTS ret_discussion_page_status ON ret_discussion_comments(page_id,status,created_at)').run();}
async function readBody(r:Request){const size=Number(r.headers.get('content-length')||0);if(size>6000)throw Error('Request too large.');if(!r.body)throw Error('Request body is empty.');const rd=r.body.getReader(),parts:Uint8Array[]=[];let n=0;try{for(;;){const x=await rd.read();if(x.done)break;n+=x.value.byteLength;if(n>6000){await rd.cancel();throw Error('Request too large.');}parts.push(x.value);}}finally{rd.releaseLock();}const bytes=new Uint8Array(n);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));}
function sameOrigin(r:Request){return r.headers.get('X-Reading-Room')==='1'&&r.headers.get('Sec-Fetch-Site')!=='cross-site'&&r.headers.get('Origin')===new URL(r.url).origin;}
const random=()=>[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function discussionAPI(r:Request,c:Config){
 if(roomId(r))return json({error:'Open the article in your room to discuss it.'},410);
 try{
  await ensure(c.DB);
  if(r.method==='GET'){
   const u=new URL(r.url),token=u.searchParams.get('token'),page=u.searchParams.get('page');
   if(token){if(!hex48(token))return json({error:'Sharing link not found.'},404);const shared=await resolveShared(c.DB,token);if(shared.status!==200||!shared.page)return json({error:shared.message},shared.status);const rows=await c.DB.prepare("SELECT id,name,text,created_at AS createdAt FROM ret_discussion_comments WHERE page_id=? AND status='approved' ORDER BY created_at LIMIT 100").bind(shared.page.id).all();return json({comments:rows.results});}
   if(page){if(!isOwner(r,c)&&!await isEditionAuthor(r,c,page))return json({error:'Open the edition in the browser that created it to review comments.'},401);if(!hex48(page))return json({error:'Page not found.'},404);const exists=await c.DB.prepare('SELECT id FROM education_pages WHERE id=?').bind(page).first();if(!exists)return json({error:'Page not found.'},404);const rows=await c.DB.prepare('SELECT id,name,text,status,created_at AS createdAt FROM ret_discussion_comments WHERE page_id=? ORDER BY created_at LIMIT 500').bind(page).all();return json({comments:rows.results});}
   return json({error:'Supply a share token or owner page ID.'},400);
  }
  if(r.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(r))return json({error:'Use the same-origin discussion controls.'},403);
  let data:any;try{data=await readBody(r);}catch(e){return json({error:e instanceof Error?e.message:'Invalid request.'},400);}
  if(data?.action==='approve'||data?.action==='hide'){
   if(!isOwner(r,c)&&!await isEditionAuthor(r,c,data.pageId))return json({error:'Only the edition creator can moderate these comments.'},401);
   if(!hex48(data.pageId)||!hex48(data.commentId))return json({error:'Page or comment not found.'},404);
   const exists=await c.DB.prepare('SELECT id FROM education_pages WHERE id=?').bind(data.pageId).first();if(!exists)return json({error:'Page not found.'},404);
   const result=await c.DB.prepare('UPDATE ret_discussion_comments SET status=? WHERE id=? AND page_id=?').bind(data.action==='approve'?'approved':'hidden',data.commentId,data.pageId).run();if(!result.meta?.changes)return json({error:'Comment not found.'},404);return json({updated:true});
  }
  if(typeof data?.website!=='string'||data.website.length>0)return json({pending:true},202);
  if(!hex48(data.token)||!uuid(data.requestId))return json({error:'Use a valid sharing link and request ID.'},400);
  const shared=await resolveShared(c.DB,data.token);if(shared.status!==200||!shared.page)return json({error:shared.message},shared.status);
  const name=typeof data.name==='string'?data.name.trim():'',text=typeof data.text==='string'?data.text.trim():'';
  if(name.length>60||text.length<20||text.length>1500)return json({error:'Name is limited to 60 characters; comments must be 20–1,500 characters.'},400);
  const pageId=shared.page.id,existing=await c.DB.prepare('SELECT id,status FROM ret_discussion_comments WHERE page_id=? AND request_id=?').bind(pageId,data.requestId).first();if(existing)return json({accepted:true,pending:existing.status==='pending'});
  const slot='discussion:'+pageId+':'+Math.floor(Date.now()/600000);
  const reservation=await c.DB.prepare('INSERT INTO education_counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<10 RETURNING n').bind(slot).first();if(!reservation)return json({error:'This page has reached ten new comments in this ten-minute window. Try later.'},429);
  const id=random(),createdAt=new Date().toISOString();try{await c.DB.prepare("INSERT INTO ret_discussion_comments (id,page_id,request_id,name,text,status,created_at) VALUES (?,?,?,?,?,'pending',?)").bind(id,pageId,data.requestId,name||'Reader',text,createdAt).run();}catch{await c.DB.prepare('UPDATE education_counters SET n=MAX(0,n-1) WHERE key=?').bind(slot).run();const retry=await c.DB.prepare('SELECT status FROM ret_discussion_comments WHERE page_id=? AND request_id=?').bind(pageId,data.requestId).first();if(retry)return json({accepted:true,pending:retry.status==='pending'});throw Error('Comment could not be saved.');}
  return json({accepted:true,pending:true},201);
 }catch{return json({error:'Discussion is temporarily unavailable.'},503);}
}
