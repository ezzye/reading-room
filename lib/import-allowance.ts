import {requireRoom,roomId,roomMemberId} from './rooms.ts';
import {readerSession,tokenHash,authorTable} from './edition-access.ts';
import {isOwner} from './education-service.ts';
import {resourceURL} from './resource-service.ts';
import type {Config} from './education-service.ts';

export const URL_IMPORT_LIMIT=30;
export const SOURCE_REQUEST_LIMIT=90;
export const STUDY_RESERVATION_MS=15*60*1000;
export const urlImportCounterKey=(time=Date.now())=>'url-fetch:'+new Date(time).toISOString().slice(0,10);
export function nextUTCImportReset(time=Date.now()){const date=new Date(time);return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString();}
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'};
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...privateHeaders,...extra}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ready=new WeakMap<Config['DB'],Promise<void>>();
async function schema(c:Config,time=Date.now()){
 let pending=ready.get(c.DB);if(!pending){pending=(async()=>{
  await c.DB.prepare("CREATE TABLE IF NOT EXISTS rr_study_import_transition_v1(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,history_basis TEXT NOT NULL)").run();
  await c.DB.prepare("CREATE TABLE IF NOT EXISTS rr_study_imports_v1(id TEXT PRIMARY KEY,day TEXT NOT NULL,namespace TEXT NOT NULL,principal TEXT NOT NULL,request_id TEXT NOT NULL,source_url TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','completed','released','expired')),reserved_at TEXT NOT NULL,expires_at INTEGER NOT NULL,finished_at TEXT,page_id TEXT,UNIQUE(principal,request_id))").run();
  await c.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS rr_study_import_active_source_v1 ON rr_study_imports_v1(day,namespace,source_url) WHERE state='reserved'").run();
  await c.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS rr_study_import_completed_page_v1 ON rr_study_imports_v1(page_id) WHERE state='completed'").run();
  await c.DB.prepare("CREATE INDEX IF NOT EXISTS rr_study_import_day_v1 ON rr_study_imports_v1(day,state,expires_at)").run();
  // Legacy url-fetch rows mix failed and successful attempts. They remain intact
  // as the separate request guard; none are invented as completed editions.
  await c.DB.prepare("INSERT OR IGNORE INTO rr_study_import_transition_v1(id,started_at,history_basis) VALUES('completed-editions-v1',?,'legacy-attempts-cannot-identify-completed-editions')").bind(new Date(time).toISOString()).run();
 })();ready.set(c.DB,pending);pending.catch(()=>ready.delete(c.DB));}await pending;
}
export async function readURLImportUsage(c:Config,time=Date.now()){
 await schema(c,time);const day=new Date(time).toISOString().slice(0,10);
 const row=await c.DB.prepare("SELECT COALESCE(SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END),0) AS used,COALESCE(SUM(CASE WHEN state='reserved' AND expires_at>? THEN 1 ELSE 0 END),0) AS pending FROM rr_study_imports_v1 WHERE day=?").bind(time,day).first<{used:number;pending:number}>();
 const transition=await c.DB.prepare("SELECT started_at FROM rr_study_import_transition_v1 WHERE id='completed-editions-v1'").first<{started_at:string}>(),used=Number(row?.used||0),pending=Number(row?.pending||0),started=transition?.started_at||null;
 return {limit:URL_IMPORT_LIMIT,used,remaining:Math.max(0,URL_IMPORT_LIMIT-used),pending,available:Math.max(0,URL_IMPORT_LIMIT-used-pending),resetsAt:nextUTCImportReset(time),scope:'reading-room-service' as const,failedAttemptsCount:false as const,trackingSince:started,historyStatus:started&&started.slice(0,10)===day?'earlier-completions-unavailable':'complete-for-utc-day'};
}
// This existing attempt counter is retained as a separate network abuse guard.
// It never determines the completed-edition allowance or implies paid credits.
export async function reserveURLImportAttempt(c:Config,time=Date.now()){
 return Boolean(await c.DB.prepare('INSERT INTO education_counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n').bind(urlImportCounterKey(time),SOURCE_REQUEST_LIMIT).first());
}
export function importRetryAfter(time=Date.now()){return String(Math.max(1,Math.ceil((Date.parse(nextUTCImportReset(time))-time)/1000)));}
function resetUK(resetsAt:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(resetsAt));}
export function dailyImportLimitMessage(resetsAt:string){return `All ${URL_IMPORT_LIMIT} completed study editions for this Reading Room service have been used today across its newspapers, rooms and members. Failed imports and opening saved articles do not use this allowance. Resets ${resetUK(resetsAt)} UK time (midnight UTC).`;}
export async function sourceRequestGuardResponse(c:Config,time=Date.now()){return json({error:`The separate daily protection limit of ${SOURCE_REQUEST_LIMIT} source requests has been reached. Failed imports do not use your ${URL_IMPORT_LIMIT}-edition study allowance; this protection still limits repeated network requests. Saved articles remain available.`,errorCode:'source_request_guard',usage:await readURLImportUsage(c,time),costGuard:{kind:'source-requests',limit:SOURCE_REQUEST_LIMIT,resetsAt:nextUTCImportReset(time)}},429,{'Retry-After':importRetryAfter(time)});}

declare const reservationBrand:unique symbol;
export type StudyImportReservation={readonly [reservationBrand]:true};
type ReservationState={DB:Config['DB'];id:string;day:string;namespace:string;principal:string;requestId:string;sourceURL:string;roomId:string|null;memberId:string|null;sessionHash:string;owner:boolean;used:boolean};
const reservations=new WeakMap<StudyImportReservation,ReservationState>();
async function identity(request:Request,c:Config){
 if(roomId(request)){const room=await requireRoom(request,c);return {namespace:'room:'+room.id,principal:'member:'+room.member_id,roomId:room.id,memberId:room.member_id,sessionHash:'',owner:false};}
 if(isOwner(request,c))return {namespace:'legacy-owner',principal:'legacy-owner',roomId:null,memberId:null,sessionHash:'',owner:true};
 const token=readerSession(request);if(!token)throw json({error:'Sign in before preparing a study edition.'},401);const hash=await tokenHash(token);return {namespace:'reader:'+hash,principal:'reader:'+hash,roomId:null,memberId:null,sessionHash:hash,owner:false};
}
export async function reserveStudyImport(request:Request,c:Config,url:string,requestId:string,time=Date.now()):Promise<{reservation?:StudyImportReservation;response?:Response}>{
 if(!UUID.test(requestId))return {response:json({error:'Include a valid request identity.'},400)};
 await schema(c,time);if(!c.DB.batch)throw Error('Transactional import accounting is unavailable.');
 const who=await identity(request,c),day=new Date(time).toISOString().slice(0,10),sourceURL=resourceURL(url),id=crypto.randomUUID(),timestamp=new Date(time).toISOString(),expires=Math.min(time+STUDY_RESERVATION_MS,Date.parse(nextUTCImportReset(time)));
 await c.DB.batch([
  c.DB.prepare("UPDATE rr_study_imports_v1 SET state='expired',finished_at=? WHERE state='reserved' AND expires_at<=?").bind(timestamp,time),
  c.DB.prepare("INSERT OR IGNORE INTO rr_study_imports_v1(id,day,namespace,principal,request_id,source_url,state,reserved_at,expires_at) SELECT ?,?,?,?,?,?,'reserved',?,? WHERE (SELECT COUNT(*) FROM rr_study_imports_v1 WHERE day=? AND (state='completed' OR (state='reserved' AND expires_at>?)))<?").bind(id,day,who.namespace,who.principal,requestId,sourceURL,timestamp,expires,day,time,URL_IMPORT_LIMIT)
 ]);
 const row=await c.DB.prepare('SELECT id,state,page_id,source_url FROM rr_study_imports_v1 WHERE id=?').bind(id).first<any>();
 if(!row){
  const duplicate=await c.DB.prepare("SELECT state,source_url FROM rr_study_imports_v1 WHERE (principal=? AND request_id=?) OR (day=? AND namespace=? AND source_url=? AND state='reserved' AND expires_at>?) LIMIT 1").bind(who.principal,requestId,day,who.namespace,sourceURL,time).first<any>();
  if(duplicate)return {response:json({error:duplicate.source_url===sourceURL?'This article request is already being prepared or has already finished. Reload to open the saved edition, or use a new request to try again.':'This request identity belongs to a different article. Reload and try again.',errorCode:'import_in_progress',usage:await readURLImportUsage(c,time)},409,{'Retry-After':'15'})};
  const usage=await readURLImportUsage(c,time);return {response:json({error:usage.used>=URL_IMPORT_LIMIT?dailyImportLimitMessage(usage.resetsAt):'The available study-edition slots are currently being prepared. They are not charged until saved; try again when those requests finish or expire.',errorCode:usage.used>=URL_IMPORT_LIMIT?'daily_import_limit':'imports_pending',usage},429,{'Retry-After':usage.used>=URL_IMPORT_LIMIT?importRetryAfter(time):'15'})};
 }
 const reservation=Object.freeze({}) as StudyImportReservation;reservations.set(reservation,{DB:c.DB,id,day,...who,requestId,sourceURL,used:false});return {reservation};
}
export async function releaseStudyImport(reservation:StudyImportReservation|undefined,time=Date.now()){
 if(!reservation)return;const state=reservations.get(reservation);if(!state)return;reservations.delete(reservation);
 await state.DB.prepare("UPDATE rr_study_imports_v1 SET state='released',finished_at=? WHERE id=? AND state='reserved'").bind(new Date(time).toISOString(),state.id).run();
}
export async function assertStudyImport(reservation:StudyImportReservation,request:Request,c:Config,requestId:string,time=Date.now()){
 const state=reservations.get(reservation);if(!state||state.used||state.DB!==c.DB||state.requestId!==requestId||roomId(request)!==state.roomId||roomMemberId(request)!==state.memberId)throw json({error:'The study-edition reservation does not match this request.',errorCode:'import_reservation_invalid'},409);
 const who=await identity(request,c);if(who.principal!==state.principal||who.namespace!==state.namespace)throw json({error:'The study-edition reservation does not match this request.',errorCode:'import_reservation_invalid'},409);
 if(!await c.DB.prepare("SELECT 1 AS active FROM rr_study_imports_v1 WHERE id=? AND state='reserved' AND expires_at>?").bind(state.id,time).first())throw json({error:'The pending reservation expired before saving. No study-edition allowance was charged. Try again.',errorCode:'import_reservation_expired',usage:await readURLImportUsage(c,time)},409);
 return state;
}
export async function saveStudyImport(reservation:StudyImportReservation,request:Request,c:Config,page:{id:string;sourceHash:string;sourceURL:string;title:string;document:string;createdAt:string},requestId:string,time=Date.now()){
 const state=await assertStudyImport(reservation,request,c,requestId,time);state.used=true;
 if(!c.DB.batch)throw Error('Transactional import accounting is unavailable.');if(state.sessionHash)await authorTable(c);
 const gate="EXISTS (SELECT 1 FROM rr_study_imports_v1 q WHERE q.id=? AND q.state='reserved' AND q.expires_at>? AND q.day=?)",gateArgs=[state.id,time,state.day];
 const memberGate=state.roomId?" AND EXISTS (SELECT 1 FROM rr_room_members rm JOIN rr_members m ON m.id=rm.member_id WHERE rm.room_id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL)":'',memberArgs=state.roomId?[state.roomId,state.memberId]:[];
 const statements=[c.DB.prepare(`INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}${memberGate} ON CONFLICT(source_hash) DO NOTHING`).bind(page.id,page.sourceHash,page.sourceURL,page.title,page.document,page.createdAt,...gateArgs,...memberArgs)];
 if(state.roomId)statements.push(c.DB.prepare(`INSERT OR IGNORE INTO rr_room_articles(room_id,page_id,added_by,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM education_pages WHERE id=?) AND ${gate}${memberGate}`).bind(state.roomId,page.id,state.memberId,page.createdAt,page.id,...gateArgs,...memberArgs));
 else if(state.sessionHash)statements.push(c.DB.prepare(`INSERT OR IGNORE INTO ret_edition_authors(page_id,session_hash,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM education_pages WHERE id=?) AND ${gate}`).bind(page.id,state.sessionHash,page.createdAt,page.id,...gateArgs));
 statements.push(c.DB.prepare(`UPDATE rr_study_imports_v1 SET state='completed',finished_at=?,page_id=? WHERE id=? AND state='reserved' AND expires_at>? AND EXISTS (SELECT 1 FROM education_pages WHERE id=?)`).bind(new Date(time).toISOString(),page.id,state.id,time,page.id));
 statements.push(c.DB.prepare("UPDATE rr_study_imports_v1 SET state='released',finished_at=? WHERE id=? AND state='reserved'").bind(new Date(time).toISOString(),state.id));
 await c.DB.batch(statements);
 const saved=await c.DB.prepare('SELECT id FROM education_pages WHERE source_hash=?').bind(page.sourceHash).first<{id:string}>();
 if(!saved)throw json({error:'The pending reservation expired before saving. No study-edition allowance was charged. Try again.',errorCode:'import_reservation_expired',usage:await readURLImportUsage(c,time)},409);
 return {id:saved.id,cached:saved.id!==page.id};
}
export async function roomUsageAPI(request:Request,c:Config,time=Date.now()){
 try{
  await requireRoom(request,c);
  if(request.method!=='GET')return json({error:'Use the room usage display.'},405);
  const origin=new URL(request.url).origin,from=request.headers.get('Origin'),referer=request.headers.get('Referer');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||from&&from!==origin)return json({error:'Use Reading Room to check import usage.'},403);
  if(referer){try{if(new URL(referer).origin!==origin)return json({error:'Use Reading Room to check import usage.'},403);}catch{return json({error:'Use Reading Room to check import usage.'},403);}}
  return json({usage:await readURLImportUsage(c,time)});
 }catch(error){if(error instanceof Response){const headers=new Headers(error.headers);for(const [key,value] of Object.entries(privateHeaders))headers.set(key,value);return new Response(error.body,{status:error.status,headers});}return json({error:'Import usage is unavailable.'},503);}
}
