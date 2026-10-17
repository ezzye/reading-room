import {isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';
import {randomToken,tokenHash,sameOrigin} from './edition-access.ts';
import {resourceURL} from './resource-service.ts';
import {shareURL} from './app-origin.mjs';
import {timesURL} from '../extension-library/library-core.mjs';
import {validateLibrarySource} from './library-study.mjs';
import {buildLibraryCapture} from './library-capture.mjs';
import {captureAPI} from './capture-service.ts';
import {libraryServerConfigured} from './library-server.ts';
const now=()=>new Date().toISOString();
function json(r:Request,data:unknown,status=200){const origin=r.headers.get('Origin')||'',headers:Record<string,string>={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};if(/^chrome-extension:\/\/[a-p]{32}$/.test(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='Content-Type, Authorization';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}return Response.json(data,{status,headers});}
export async function libraryTables(c:Config){for(const q of [
 'CREATE TABLE IF NOT EXISTS ret_library_connectors (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_seen TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)',
 'CREATE TABLE IF NOT EXISTS ret_library_pairing (code_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS ret_library_jobs (id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,message_id INTEGER NOT NULL,url TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,connector_id TEXT,lease_hash TEXT,lease_until TEXT,error TEXT,UNIQUE(thread_id,message_id))'
 ])await c.DB.prepare(q).run();}
export async function queueLibrary(c:Config,row:any,messageId:number){
 try{timesURL(row.url);}catch{return false;}
 // Once the owner has moved to the server connection, never silently fall back
 // to a desktop connector and hide a phone-only retrieval failure.
 if(await libraryServerConfigured(c))return false;
 await libraryTables(c);
 const connected=await c.DB.prepare('SELECT id FROM ret_library_connectors WHERE enabled=1 AND expires_at>? LIMIT 1').bind(now()).first();if(!connected)return false;
 const inFlight=await c.DB.prepare("SELECT id FROM ret_library_jobs WHERE thread_id=? AND state IN ('queued','leased','processing') AND expires_at>? LIMIT 1").bind(row.id,now()).first();if(inFlight)return true;
 const existing:any=await c.DB.prepare('SELECT id,state FROM ret_library_jobs WHERE thread_id=? AND message_id=?').bind(row.id,messageId).first();if(existing)return ['queued','leased'].includes(existing.state);
 await c.DB.prepare("INSERT OR IGNORE INTO ret_library_jobs(id,thread_id,message_id,url,state,created_at,expires_at) VALUES (?,?,?,?,'queued',?,?)").bind(randomToken(),row.id,messageId,resourceURL(row.url),now(),new Date(Date.now()+86400000).toISOString()).run();return true;
}
async function read(r:Request){if(Number(r.headers.get('content-length')||0)>1048576)throw Error('Request too large.');if(!r.body)throw Error('Empty request.');let n=0,parts:Uint8Array[]=[];const rd=r.body.getReader();try{for(;;){const x=await rd.read();if(x.done)break;n+=x.value.length;if(n>1048576){await rd.cancel();throw Error('Request too large.');}parts.push(x.value);}}finally{rd.releaseLock();}const bytes=new Uint8Array(n);let at=0;for(const b of parts){bytes.set(b,at);at+=b.length;}return JSON.parse(new TextDecoder().decode(bytes));}
const validToken=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{48}$/.test(s);
export async function libraryAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 if(r.method==='OPTIONS')return json(r,{});
 try{
  await libraryTables(c);
  if(r.method==='GET'){
   if(!isOwner(r,c))return json(r,{error:'Owner sign-in is required to manage the connector.'},401);
   const rows=await c.DB.prepare('SELECT id,created_at AS createdAt,expires_at AS expiresAt,last_seen AS lastSeen,enabled FROM ret_library_connectors ORDER BY created_at DESC LIMIT 10').all();return json(r,{connectors:rows.results});
  }
  if(r.method!=='POST')return json(r,{error:'Method not allowed.'},405);
  const data=await read(r);
  if(data.action==='status'){const active:any=await c.DB.prepare('SELECT last_seen FROM ret_library_connectors WHERE enabled=1 AND expires_at>? ORDER BY last_seen DESC LIMIT 1').bind(now()).first();return json(r,{paired:Boolean(active),online:Boolean(active&&Date.now()-Date.parse(active.last_seen)<180000)});}
  if(data.action==='pair'||data.action==='revoke'){
   if(!isOwner(r,c)||!sameOrigin(r))return json(r,{error:'Use the owner’s connector controls in RET.'},403);
   if(data.action==='revoke'){await c.DB.prepare('UPDATE ret_library_connectors SET enabled=0').run();await c.DB.prepare('UPDATE ret_library_pairing SET used=1').run();return json(r,{revoked:true});}
   const code=randomToken().slice(0,24);await c.DB.prepare('DELETE FROM ret_library_pairing WHERE expires_at<=? OR used=1').bind(now()).run();await c.DB.prepare('INSERT INTO ret_library_pairing(code_hash,expires_at) VALUES (?,?)').bind(await tokenHash(code),new Date(Date.now()+600000).toISOString()).run();return json(r,{code,expiresInMinutes:10});
  }
  // All processing now passes through the owner's signed-in RET tab. A copied
  // connector token alone, or another study-group member's session, is insufficient.
  if(!isOwner(r,c)||!sameOrigin(r))return json(r,{error:'Open RET connector setup in Chrome and sign in as the owner.'},403);
  if(data.action==='activate'){
   if(typeof data.code!=='string'||!/^[a-f0-9]{24}$/.test(data.code))return json(r,{error:'Use an unexpired owner pairing code.'},403);
   const used=await c.DB.prepare('UPDATE ret_library_pairing SET used=1 WHERE code_hash=? AND used=0 AND expires_at>? RETURNING code_hash').bind(await tokenHash(data.code),now()).first();if(!used)return json(r,{error:'The pairing code is expired or already used.'},403);
   const count:any=await c.DB.prepare('SELECT COUNT(*) n FROM ret_library_connectors WHERE enabled=1 AND expires_at>?').bind(now()).first();if(count.n>=2)return json(r,{error:'Revoke existing connectors before pairing another.'},409);
   const token=randomToken(),id=randomToken(),expiresAt=new Date(Date.now()+30*86400000).toISOString();await c.DB.prepare('INSERT INTO ret_library_connectors(id,token_hash,created_at,expires_at,last_seen) VALUES (?,?,?,?,?)').bind(id,await tokenHash(token),now(),expiresAt,now()).run();return json(r,{token,id,expiresAt});
  }
  const token=r.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];if(!token)return json(r,{error:'Connector authentication required.'},401);
  const connector:any=await c.DB.prepare('SELECT id FROM ret_library_connectors WHERE token_hash=? AND enabled=1 AND expires_at>?').bind(await tokenHash(token),now()).first();if(!connector)return json(r,{error:'This connector was revoked or expired. Pair it again.'},401);
  await c.DB.prepare('UPDATE ret_library_connectors SET last_seen=? WHERE id=?').bind(now(),connector.id).run();
  if(data.action==='next'){
   const expired=await c.DB.prepare("SELECT id,thread_id FROM ret_library_jobs WHERE state IN ('leased','processing') AND lease_until<=? LIMIT 10").bind(now()).all();for(const x of expired.results as any[]){const changed=await c.DB.prepare("UPDATE ret_library_jobs SET state='failed',error='Interrupted' WHERE id=? AND state IN ('leased','processing') RETURNING id").bind(x.id).first();if(changed)await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) VALUES (?,'owner',?,?)").bind(x.thread_id,'RET system: Automatic library lookup stopped. The owner connector was interrupted. Send a new question to retry.',now()).run();}
   const job:any=await c.DB.prepare("SELECT j.id,j.url FROM ret_library_jobs j JOIN ret_requests r ON r.id=j.thread_id WHERE j.state='queued' AND j.expires_at>? AND r.expires_at>? ORDER BY j.created_at LIMIT 1").bind(now(),now()).first();if(!job)return json(r,{job:null});
   const lease=randomToken(),until=new Date(Date.now()+5*60000).toISOString();const claimed=await c.DB.prepare("UPDATE ret_library_jobs SET state='leased',connector_id=?,lease_hash=?,lease_until=? WHERE id=? AND state='queued' RETURNING id").bind(connector.id,await tokenHash(lease),until,job.id).first();return json(r,{job:claimed?{id:job.id,url:job.url,lease,leaseUntil:until}:null});
  }
  if(!['complete','fail'].includes(data.action)||!validToken(data.id)||!validToken(data.lease))return json(r,{error:'Invalid connector action.'},400);
  const job:any=await c.DB.prepare("SELECT * FROM ret_library_jobs WHERE id=? AND connector_id=? AND lease_hash=? AND state IN ('leased','processing') AND lease_until>?").bind(data.id,connector.id,await tokenHash(data.lease),now()).first();if(!job)return json(r,{error:'That job lease expired or was completed.'},409);
  if(data.action==='fail'){
   const safe=['login','not-found','ambiguous','unavailable'].includes(data.reason)?data.reason:'unavailable',message=safe==='login'?'The owner’s Camden library session needs sign-in again.':safe==='ambiguous'?'No unambiguous library match was found.':safe==='not-found'?'No matching readable library article was found.':'The library lookup could not finish. No edition was delivered.';
   await c.DB.prepare("UPDATE ret_library_jobs SET state='failed',error=? WHERE id=?").bind(message,job.id).run();await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) VALUES (?,'owner',?,?)").bind(job.thread_id,'RET system: Automatic library lookup stopped. '+message,now()).run();return json(r,{failed:true,message});
  }
  if(job.state!=='leased')return json(r,{error:'This library study is already being prepared.'},409);
  const source=validateLibrarySource(data.source,job),capture=buildLibraryCapture(source,data.publisherCapture);
  const claimed=await c.DB.prepare("UPDATE ret_library_jobs SET state='processing' WHERE id=? AND state='leased' RETURNING id").bind(job.id).first();if(!claimed)return json(r,{error:'This library edition is already being prepared.'},409);
  // Reuse the full capture pipeline: original passages stay separate from AI
  // annotations. Authentication is retained from the verified owner request.
  const headers=new Headers(r.headers);headers.delete('content-length');headers.delete('authorization');
  const prepared=await captureAPI(new Request(new URL('/api/captures',r.url),{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),capture})}),c,fetcher);
  const edition:any=await prepared.json();if(!prepared.ok||!edition.id)throw Error(edition.error||'The reading edition could not be prepared.');
  const saved={id:edition.id},createdAt=now();
  const requestId='library-'+job.id;let shared:any=await c.DB.prepare('SELECT token FROM education_shares WHERE page_id=? AND request_id=?').bind(saved.id,requestId).first();if(!shared){shared=await c.DB.prepare('INSERT INTO education_shares(token,page_id,request_id,day,expires_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM education_shares WHERE page_id=? AND day=?)<15 RETURNING token').bind(randomToken(),saved.id,requestId,createdAt.slice(0,10),new Date(Date.now()+7*86400000).toISOString(),saved.id,createdAt.slice(0,10)).first();}if(!shared)throw Error('The fifteen new sharing links for this page have been used today.');
  await c.DB.prepare('UPDATE ret_requests SET share_token=? WHERE id=?').bind(shared.token,job.thread_id).run();await c.DB.prepare("UPDATE ret_library_jobs SET state='done',error=NULL WHERE id=?").bind(job.id).run();
  await c.DB.prepare("INSERT INTO ret_request_messages(request_id,role,message,created_at) VALUES (?,'owner',?,?)").bind(job.thread_id,'RET automatically matched a Camden record and prepared a private reading edition with collapsed AI commentary. The edition identifies its source and presentation limits. Library account details stay in the owner’s browser.',now()).run();
  // Generation and answering are separate requests. Once the edition is
  // committed, an answer failure must never turn delivery into a failed lookup.
  // The reader's next poll resumes its source-blocked question from this exact
  // completed job, avoiding one long Worker request and its subrequest budget.
  return json(r,{completed:true,answered:false,answerPending:true,shareURL:shareURL(shared.token,r.url)});
 }catch(e){const message=e instanceof Error?e.message:'';return json(r,{error:/^(?:The |No |Only |Article |Library |A study|DeepSeek|Today|This |Request |Empty)/.test(message)?message:'The library connector could not finish. Check its status in the owner’s Chrome.'},502);}
}
