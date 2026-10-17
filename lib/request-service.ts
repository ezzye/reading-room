import {shareURL,sameRETOrigin} from './app-origin.mjs';
import {prepareConversation} from './conversation-ai.ts';
import {resourceURL} from './resource-service.ts';
import {isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
const hex48=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{48}$/.test(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const tokenHash=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x=>x.toString(16).padStart(2,'0')).join('');
const MAX_BODY=4096, MAX_MESSAGES=12, TTL=7*86400000;
type ConversationRow={id:string,url:string,question:string,createdAt:string,expiresAt:string,status:'open'|'answered',shareToken:string|null};
type MessageRow={requestId:string,role:'reader'|'owner',message:string,createdAt:string};
async function ensure(db:D1Database){
 await db.prepare("CREATE TABLE IF NOT EXISTS ret_requests (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, url TEXT NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')), share_token TEXT)").run();
 await db.prepare("CREATE TABLE IF NOT EXISTS ret_request_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES ret_requests(id), role TEXT NOT NULL CHECK(role IN ('reader','owner')), message TEXT NOT NULL, created_at TEXT NOT NULL)").run();
 await db.prepare('CREATE INDEX IF NOT EXISTS ret_requests_open_created ON ret_requests(status,created_at)').run();
 await db.prepare('CREATE INDEX IF NOT EXISTS ret_request_messages_thread ON ret_request_messages(request_id,id)').run();
}
async function readBody(r:Request){
 const length=Number(r.headers.get('content-length')||0);if(length>MAX_BODY)throw Error('Request body is too large.');if(!r.body)throw Error('Request body is empty.');
 const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>MAX_BODY){await reader.cancel();throw Error('Request body is too large.');}parts.push(chunk.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
function sameOrigin(r:Request){return r.headers.get('X-Reading-Room')==='1'&&r.headers.get('Sec-Fetch-Site')!=='cross-site'&&r.headers.get('Origin')===new URL(r.url).origin;}
const utcDay=()=>new Date().toISOString().slice(0,10);
async function thread(db:D1Database,id:string){const rows=await db.prepare('SELECT role,message,created_at AS createdAt FROM ret_request_messages WHERE request_id=? ORDER BY id').bind(id).all();return rows.results;}

export async function requestAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  await ensure(c.DB);
  if(r.method==='GET'){
   const ownerURL=new URL(r.url),ownerId=ownerURL.searchParams.get('id');
   if(!isOwner(r,c))return json({error:'Sign in as the owner to review requests.'},401);
   if(ownerId){if(!hex48(ownerId))return json({error:'Request not found.'},404);const row=await c.DB.prepare('SELECT id,url,question,created_at AS createdAt,expires_at AS expiresAt,status,share_token AS shareToken FROM ret_requests WHERE id=? AND expires_at>?').bind(ownerId,new Date().toISOString()).first() as ConversationRow|null;if(!row)return json({error:'Request not found or expired.'},404);return json({conversation:{id:row.id,url:row.url,question:row.question,createdAt:row.createdAt,expiresAt:row.expiresAt,status:row.status,shareURL:row.shareToken?shareURL(row.shareToken,r.url):null},messages:await thread(c.DB,row.id)});}
   const rows=await c.DB.prepare("SELECT id,url,question,created_at AS createdAt,expires_at AS expiresAt,status,share_token AS shareToken FROM ret_requests WHERE "+(ownerURL.searchParams.get('all')==='1'?'':"status='open' AND ")+"expires_at>? ORDER BY created_at DESC LIMIT 50").bind(new Date().toISOString()).all();
   const requests=rows.results as ConversationRow[],ids=requests.map(x=>x.id),byId=new Map<string,Omit<MessageRow,'requestId'>[]>();if(ids.length){const marks=ids.map(()=>'?').join(',');const messages=await c.DB.prepare(`SELECT request_id AS requestId,role,message,created_at AS createdAt FROM ret_request_messages WHERE request_id IN (${marks}) ORDER BY id`).bind(...ids).all();for(const m of messages.results as MessageRow[]){const list=byId.get(m.requestId)||[];list.push({role:m.role,message:m.message,createdAt:m.createdAt});byId.set(m.requestId,list);}}
   return json({requests:requests.map(x=>({id:x.id,url:x.url,question:x.question,createdAt:x.createdAt,expiresAt:x.expiresAt,status:x.status,shareURL:x.shareToken?shareURL(x.shareToken,r.url):null,messages:byId.get(x.id)||[]}))});
  }
  if(r.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(r))return json({error:'Use the same-origin request controls.'},403);
  let data:Record<string,unknown>;try{const parsed=await readBody(r);data=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};}catch(e){const msg=e instanceof Error?e.message:'Invalid request body.';return json({error:msg},msg==='Request body is too large.'?413:400);}
  if(data?.action==='prepare'){if(!hex48(data.token))return json({error:'Conversation not found.'},404);return await prepareConversation(r,c,await tokenHash(data.token),fetcher);}
  if(data?.action==='read'){
   if(!hex48(data.token))return json({error:'Conversation not found.'},404);const hash=await tokenHash(data.token),row=await c.DB.prepare('SELECT id,url,question,created_at AS createdAt,expires_at AS expiresAt,status,share_token AS shareToken FROM ret_requests WHERE token_hash=? AND expires_at>?').bind(hash,new Date().toISOString()).first() as ConversationRow|null;if(!row)return json({error:'Conversation not found or expired.'},404);const messages=await thread(c.DB,row.id) as any[];return json({conversation:{id:row.id,url:row.url,question:row.question,createdAt:row.createdAt,expiresAt:row.expiresAt,status:row.status,shareURL:row.shareToken?shareURL(row.shareToken,r.url):null},messages,answerPending:Boolean(row.shareToken&&messages.at(-1)?.message?.startsWith('RET automatically matched a Camden record'))});
  }
  if(data?.action==='reply'){
   if(!isOwner(r,c))return json({error:'Sign in as the owner to reply.'},401);
   if(!hex48(data.id))return json({error:'Request not found.'},404);const message=typeof data.message==='string'?data.message.trim():'';if(!message||message.length>1600)return json({error:'Reply must be 1–1,600 characters.'},400);
   let shareToken:string|null=null;if(data.shareURL!==undefined&&data.shareURL!==null&&data.shareURL!==''){
    if(typeof data.shareURL!=='string')return json({error:'Use an active Read EveryThing sharing link.'},400);
    let u:URL;try{u=new URL(data.shareURL,r.url);}catch{return json({error:'Use an active Read EveryThing sharing link.'},400);}
    const match=sameRETOrigin(u.href,r.url)?u.pathname.match(/^\/s\/([a-f0-9]{48})$/):null;
    if(!match||u.search||u.hash)return json({error:'Use an active Read EveryThing sharing link.'},400);shareToken=match[1];
   }
   const row=await c.DB.prepare('SELECT id,url,token_hash AS tokenHash FROM ret_requests WHERE id=? AND expires_at>?').bind(data.id,new Date().toISOString()).first() as {id:string,url:string,tokenHash:string}|null;if(!row)return json({error:'Active request not found.'},404);
   if(shareToken){const active:any=await c.DB.prepare('SELECT s.token,p.source_url AS sourceURL FROM education_shares s JOIN education_pages p ON p.id=s.page_id WHERE s.token=? AND s.revoked=0 AND s.expires_at>?').bind(shareToken,new Date().toISOString()).first();if(!active)return json({error:'That sharing link is expired, revoked, or unavailable.'},400);if(data.fulfill===true&&resourceURL(active.sourceURL)!==resourceURL(row.url))return json({error:'To complete this request, attach a RET edition for the same original article URL.'},400);}
   if(data.fulfill===true&&!shareToken)return json({error:'Attach an active RET sharing link to complete this request.'},400);
   const now=new Date().toISOString(),insert=await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) SELECT ?, 'owner', ?, ? WHERE (SELECT COUNT(*) FROM ret_request_messages WHERE request_id=?)<?").bind(data.id,message,now,data.id,MAX_MESSAGES).run();if(!insert.meta?.changes)return json({error:'This conversation has reached its message limit.'},409);await c.DB.prepare("UPDATE ret_requests SET status='answered',share_token=? WHERE id=?").bind(shareToken,data.id).run();if(data.fulfill===true){const prepared=await prepareConversation(r,c,row.tokenHash,fetcher,true);const outcome=await prepared.json() as any;return json({replied:true,automated:outcome.prepared===true,needsReview:outcome.prepared!==true,shareURL:shareToken?shareURL(shareToken,r.url):null,message:outcome.message||outcome.error||null});}return json({replied:true,shareURL:shareToken?shareURL(shareToken,r.url):null});
  }
  if(data?.action==='followup'||(data?.action===undefined&&data?.token!==undefined&&data?.message!==undefined)){
   if(!hex48(data.token))return json({error:'Conversation not found.'},404);const msg=typeof data.message==='string'?data.message.trim():'';if(!msg||msg.length>800)return json({error:'Message must be 1–800 characters.'},400);
   const hash=await tokenHash(data.token),row=await c.DB.prepare("SELECT id FROM ret_requests WHERE token_hash=? AND expires_at>?").bind(hash,new Date().toISOString()).first() as {id:string}|null;if(!row)return json({error:'Open conversation not found or expired.'},404);
   const insert=await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) SELECT ?, 'reader', ?, ? WHERE (SELECT COUNT(*) FROM ret_request_messages WHERE request_id=?)<?").bind(row.id,msg,new Date().toISOString(),row.id,MAX_MESSAGES).run();if(!insert.meta?.changes)return json({error:'This conversation has reached its message limit.'},409);await c.DB.prepare("UPDATE ret_requests SET status='open' WHERE id=?").bind(row.id).run();return json({sent:true,messages:await thread(c.DB,row.id)},201);
  }
  if(data?.action!==undefined&&data.action!=='create')return json({error:'Unknown request action.'},400);
  if(!uuid(data?.requestId))return json({error:'Use a valid request ID.'},400);
  if(!hex48(data.token))return json({error:'Use a valid 48-character conversation token.'},400);
  let url:string;try{if(typeof data.url!=='string')throw Error('Use a public article URL.');url=resourceURL(data.url);}catch(e){return json({error:e instanceof Error?e.message:'Use a public article URL.'},400);}
  const question=typeof data.question==='string'?data.question.trim():'';if(question.length<20||question.length>800)return json({error:'Question must be 20–800 characters.'},400);
  // Remove only expired temporary conversation data when a new request arrives.
  const cutoff=new Date().toISOString();await c.DB.prepare('CREATE TABLE IF NOT EXISTS ret_conversation_jobs (thread_id TEXT NOT NULL,message_id INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(thread_id,message_id))').run();await c.DB.prepare('DELETE FROM ret_conversation_jobs WHERE thread_id IN (SELECT id FROM ret_requests WHERE expires_at<=?)').bind(cutoff).run();await c.DB.prepare('DELETE FROM ret_request_messages WHERE request_id IN (SELECT id FROM ret_requests WHERE expires_at<=?)').bind(cutoff).run();await c.DB.prepare('DELETE FROM ret_requests WHERE expires_at<=?').bind(cutoff).run();
  const token=data.token,hash=await tokenHash(token),existing=await c.DB.prepare('SELECT id,token_hash AS tokenHash,url,question,created_at AS createdAt,expires_at AS expiresAt FROM ret_requests WHERE request_id=?').bind(data.requestId).first() as Pick<ConversationRow,'id'|'url'|'question'|'createdAt'|'expiresAt'>&{tokenHash:string}|null;
  if(existing){if(existing.tokenHash!==hash||existing.url!==url||existing.question!==question)return json({error:'That request ID is already in use with different request details.'},409);return json({created:true,id:existing.id,url:existing.url,question:existing.question,createdAt:existing.createdAt,expiresAt:existing.expiresAt},200);}
  const now=new Date(),createdAt=now.toISOString(),expiresAt=new Date(now.getTime()+TTL).toISOString(),alternate=new URL(url);alternate.hostname='www.'+alternate.hostname;const cached=await c.DB.prepare("SELECT s.token FROM education_pages p JOIN education_shares s ON s.page_id=p.id WHERE p.source_url IN (?,?) AND s.revoked=0 AND s.expires_at>? AND (json_extract(p.document,'$.capture.presentation.method') IS NULL OR json_extract(p.document,'$.capture.presentation.method')='library-text' OR json_extract(p.document,'$.capture.presentation.extractorRevision')>=CASE WHEN p.source_url LIKE 'https://theguardian.com/%' OR p.source_url LIKE 'https://www.theguardian.com/%' THEN 3 WHEN p.source_url LIKE 'https://%bbc.%/%' THEN 4 ELSE 2 END) ORDER BY p.created_at DESC,s.expires_at DESC LIMIT 1").bind(url,alternate.href,createdAt).first() as {token:string}|null;
  const slot='request:'+utcDay();const reservation=await c.DB.prepare('INSERT INTO education_counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<15 RETURNING n').bind(slot).first();if(!reservation)return json({error:'The fifteen new requests allowed today have been used. Try tomorrow (UTC).'},429);
  const id=random();
  try{await c.DB.prepare("INSERT INTO ret_requests(id,request_id,token_hash,url,question,created_at,expires_at,status,share_token) VALUES (?,?,?,?,?,?,?, ?, ?)").bind(id,data.requestId,hash,url,question,createdAt,expiresAt,cached?'answered':'open',cached?.token||null).run();await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) VALUES (?, 'reader', ?, ?)").bind(id,question,createdAt).run();if(cached)await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) VALUES (?, 'owner', ?, ?)").bind(id,'RET automatically found a current shared edition for this article. Open it here; RET AI can answer your question from that edition. An owner can also join the conversation.',createdAt).run();}
  catch{await c.DB.prepare('UPDATE education_counters SET n=MAX(0,n-1) WHERE key=?').bind(slot).run();const retry=await c.DB.prepare('SELECT id,token_hash AS tokenHash,url,question,created_at AS createdAt,expires_at AS expiresAt FROM ret_requests WHERE request_id=?').bind(data.requestId).first() as Pick<ConversationRow,'id'|'url'|'question'|'createdAt'|'expiresAt'>|null;if(retry){const safe=retry as typeof retry&{tokenHash:string};if(safe.tokenHash!==hash||safe.url!==url||safe.question!==question)return json({error:'That request ID is already in use with different request details.'},409);return json({created:true,id:safe.id,url:safe.url,question:safe.question,createdAt:safe.createdAt,expiresAt:safe.expiresAt},200);}throw Error('Request could not be saved.');}
  return json({created:true,id,token,url,question,createdAt,expiresAt,cached:Boolean(cached),shareURL:cached?shareURL(cached.token,r.url):null},201);
 }catch{return json({error:'The request service is temporarily unavailable.'},503);}
}
