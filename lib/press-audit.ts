import {requireRoom,roomId,roomMemberId,DEFAULT_ROOM_ID} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {resourceURL} from './resource-service.ts';
import type {Config} from './education-service.ts';

// This allowance is a finite owner audit, separate from normal import counters.
// Exact host names only; a registration is not a promise of a working adapter.
export const PRESS_AUDIT_HOSTS=new Set([
 'theguardian.com','thetimes.com','telegraph.co.uk','independent.co.uk',
 'standard.co.uk','metro.co.uk','mirror.co.uk','thesun.co.uk','dailymail.co.uk',
 'dailymail.com','dailystar.co.uk','dailyrecord.co.uk','express.co.uk',
 'inews.co.uk','ft.com','observer.co.uk','heraldscotland.com','thenational.scot',
 'scotsman.com','pressandjournal.co.uk','thecourier.co.uk','yorkshirepost.co.uk',
 'belfasttelegraph.co.uk','irishnews.com','newsletter.co.uk','walesonline.co.uk',
 'morningstaronline.co.uk','sundaypost.com','dailypost.co.uk','cityam.com',
 'manchestereveningnews.co.uk','liverpoolecho.co.uk','birminghammail.co.uk',
 'bristolpost.co.uk','thenorthernecho.co.uk'
]);
export const PRESS_AUDIT_LIMIT=96;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
function failure(message:string,status=400):never{throw json({error:message},status);}
export function pressAuditURL(raw:unknown){
 if(typeof raw!=='string')throw Error('Use an exact public newspaper article URL.');
 const url=resourceURL(raw),u=new URL(url),parts=u.pathname.split('/').filter(Boolean);
 const singleSlug=u.hostname==='cityam.com'&&parts.length===1&&/^[a-z0-9]+(?:-[a-z0-9]+){3,}$/i.test(parts[0])&&parts[0].length>=24;
 if(!PRESS_AUDIT_HOSTS.has(u.hostname)||u.search||parts.length<2&&!singleSlug||!parts.length||parts.at(-1)!.length<8||parts.some(part=>/^(?:account|accounts|login|log-in|signin|sign-in|subscribe|subscriptions?|search|tags?|topics?|authors?|newsletters?)$/i.test(part))||/^(?:news|sport|sports|politics|business|opinion|world|uk|latest|index\.html?)$/i.test(parts.at(-1)!))throw Error('Use an exact article link from a listed UK newspaper, without access or search parameters.');
 return url;
}
async function owner(request:Request,c:Config){
 const room=await requireRoom(request,c);
 const operator=await c.DB.prepare("SELECT 1 AS allowed FROM rr_members WHERE id=? AND role='owner' AND revoked_at IS NULL").bind(room.member_id).first();
 if(room.role!=='owner'||room.owner_id!==room.member_id||!operator)failure('Only the instance owner can run a press check in their own room.',403);return room;
}
async function schema(c:Config){
 await c.DB.prepare(`CREATE TABLE IF NOT EXISTS rr_press_audit_runs(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,owner_id TEXT NOT NULL,day TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',entry_limit INTEGER NOT NULL CHECK(entry_limit BETWEEN 1 AND 96),UNIQUE(room_id,day))`).run();
 await c.DB.prepare(`CREATE TABLE IF NOT EXISTS rr_press_audit_entries(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,url TEXT NOT NULL,host TEXT NOT NULL,source_headline TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'approved',request_id TEXT,claimed_at TEXT,finished_at TEXT,http_status INTEGER,page_id TEXT,error_code TEXT,UNIQUE(run_id,url),UNIQUE(run_id,request_id),FOREIGN KEY(run_id) REFERENCES rr_press_audit_runs(id) ON DELETE CASCADE)`).run();
 await c.DB.prepare('CREATE INDEX IF NOT EXISTS rr_press_audit_room ON rr_press_audit_runs(room_id,created_at)').run();
}
async function body(request:Request){
 if(Number(request.headers.get('content-length')||0)>120000||!request.body)failure('The press-check manifest is too large or empty.');
 const reader=request.body.getReader(),decoder=new TextDecoder();let size=0,raw='';
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>120000)failure('The press-check manifest is too large.',413);raw+=decoder.decode(part.value,{stream:true});}try{const value=JSON.parse(raw+decoder.decode());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{failure('Use a valid press-check manifest.');}}finally{await reader.cancel();}
}
const receiptErrors={
 import_failed:'The existing importer could not prepare this article. Open the original or review a readable-page capture.',
 subscription_only:'The source identifies this article as subscription-only. Use the readable original and a reviewed capture.',
 gated_unverified:'An access gate or premium marker was observed. Public eligibility has not been verified.',
 browser_check:'The source requires a browser security check. Open the original; this attempt did not bypass it.',
 short_preview:'Only a short preview was available. A complete readable article was not verified.',
 publisher_denied:'The publisher refused this request (HTTP 402 or 403). This attempt stopped at the refusal.',
 headline_required:'The original headline needs review before the article or a library match can be accepted.',
 library_no_match:'The library did not verify one unambiguous article match. No article was substituted.',
 commentary_unavailable:'The commentary provider was unavailable or returned incomplete commentary. The article was not saved.',
 unsupported_publisher:'This newspaper has no direct import adapter yet. Use a reviewed readable-page capture.',
 incomplete_result:'The importer returned no accessible saved article.',
 interrupted:'This attempt was interrupted. Its reservation has been spent.'
} as const;
export type PressAuditErrorCode=keyof typeof receiptErrors;
function knownErrorCode(raw:unknown):PressAuditErrorCode|null{return typeof raw==='string'&&Object.hasOwn(receiptErrors,raw)?raw as PressAuditErrorCode:null;}
const sourceErrors:ReadonlyArray<readonly [PressAuditErrorCode,readonly string[]]>=[
 ['subscription_only',[
  'This article is marked as subscription-only. Open the readable original and import a reviewed Page Lens capture.',
  'The source contains a subscription prompt. RET will not treat it as a complete article. Use a reviewed capture of the page you can read.'
 ]],
 ['gated_unverified',['The source marks this article as gated. Public eligibility has not been verified.']],
 ['browser_check',['The newspaper requires a browser check. Open the original in your browser.','NewsBank presented a browser security check.']],
 ['short_preview',['Only a short preview was found. Use a reviewed capture of the complete readable page.']],
 ['publisher_denied',[402,403].map(status=>'The newspaper did not make this page available to RET (HTTP '+status+'). Use a reviewed readable-page capture.')],
 ['headline_required',[
  'No article headline was found. Use Page Lens on the readable original.',
  'The original Times headline could not be read.',
  ...['The Times','The Telegraph'].map(name=>name+' headline could not be verified for this URL. Supply the original headline for review. No library article was substituted.')
 ]],
 ['library_no_match',[
  'The library search did not find one unambiguous headline match. No article was substituted.',
  'NewsBank returned no matching articles for the headline queries.',
  'No matching NewsBank article was found.',
  'No matching library article was found.',
  'The URL words did not closely match the returned library headline and date. Paste the original newspaper headline to check it. No article was substituted.',
  'The NewsBank record publication did not verify the requested Times article.',
  'The NewsBank record publication did not verify the requested London Telegraph article.'
 ]],
 ['commentary_unavailable',[
  'DeepSeek is not configured on this server yet.',
  'DeepSeek did not finish the commentary. The capture was not saved.',
  'DeepSeek returned incomplete or invalid commentary. The capture was not saved.',
  'DeepSeek commentary is unavailable. The capture was not saved.'
 ]],
 ['unsupported_publisher',['This newspaper is not supported for direct URL import yet. Use a reviewed Page Lens capture instead.']]
];
// Match complete local messages only. A provider body or source passage can
// never become receipt text, even if it contains these words or HTML.
export function classifyPressAuditFailure(raw:unknown,needsHeadline=false){
 const matched=typeof raw==='string'&&raw.length<=800?sourceErrors.find(([,messages])=>messages.includes(raw)):undefined;
 const errorCode:PressAuditErrorCode=matched?.[0]||(needsHeadline===true?'headline_required':'import_failed');
 return {errorCode,error:receiptErrors[errorCode]};
}
async function globalAllowance(c:Config,time:number){const row:any=await c.DB.prepare('SELECT COALESCE(SUM(entry_limit),0) AS reserved FROM rr_press_audit_runs WHERE day=?').bind(new Date(time).toISOString().slice(0,10)).first();const reserved=Number(row?.reserved||0);return {globalLimit:PRESS_AUDIT_LIMIT,globalReserved:reserved,globalRemaining:Math.max(0,PRESS_AUDIT_LIMIT-reserved)};}
async function view(c:Config,run:any,time=Date.now()){
 const rows=await c.DB.prepare('SELECT e.*,p.document FROM rr_press_audit_entries e LEFT JOIN rr_room_articles a ON a.page_id=e.page_id AND a.room_id=? LEFT JOIN education_pages p ON p.id=a.page_id WHERE e.run_id=? ORDER BY e.ordinal').bind(run.room_id,run.id).all();
 const entries=(rows.results||[]).map((row:any)=>{
  let summary=null;if(row.document)try{const doc=JSON.parse(row.document),blocks=Array.isArray(doc.capture?.blocks)?doc.capture.blocks:[];summary={paragraphCount:blocks.filter((block:any)=>block.type==='paragraph').length,imageCount:blocks.filter((block:any)=>block.type==='figure').length,videoCount:blocks.filter((block:any)=>block.type==='video').length,annotationCount:Array.isArray(doc.annotations)?doc.annotations.length:0};}catch{/* Counts only; source prose is never part of a receipt. */}
  const interrupted=row.status==='claimed'&&Date.parse(run.expires_at)<=time;
  const errorCode=interrupted?'interrupted':knownErrorCode(row.error_code)||(row.error_code?'import_failed':null);
  return {id:row.id,url:row.url,sourceHeadline:row.source_headline,status:interrupted?'interrupted':row.status,requestId:row.request_id||null,claimedAt:row.claimed_at||null,finishedAt:row.finished_at||null,httpStatus:row.http_status||null,pageId:row.page_id||null,href:row.page_id&&row.document?'/read/'+row.page_id+'?room='+run.room_id:null,summary,errorCode,error:errorCode?receiptErrors[errorCode]:null};
 });
 return {id:run.id,label:run.label,createdAt:run.created_at,expiresAt:run.expires_at,status:Date.parse(run.expires_at)<=time?'expired':run.status,limit:run.entry_limit,used:entries.filter(e=>e.status!=='approved').length,pending:entries.filter(e=>e.status==='approved').length,entries};
}
export async function pressAuditAPI(request:Request,c:Config,time=Date.now()){
 try{
  const room=await owner(request,c);
  if(request.method!=='GET'&&request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(request.method==='POST'&&!sameOrigin(request))return json({error:'Use the room’s press-check controls.'},403);
  await schema(c);
  if(request.method==='GET'){
   const runId=new URL(request.url).searchParams.get('run');if(runId&&!UUID.test(runId))return json({error:'Press check not found.'},404);
   const found=runId?await c.DB.prepare('SELECT * FROM rr_press_audit_runs WHERE room_id=? AND owner_id=? AND id=?').bind(room.id,room.member_id,runId).all():await c.DB.prepare('SELECT * FROM rr_press_audit_runs WHERE room_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 10').bind(room.id,room.member_id).all();
   if(runId&&!found.results?.length)return json({error:'Press check not found.'},404);
   return json({runs:await Promise.all((found.results||[]).map(run=>view(c,run,time))),maxEntries:PRESS_AUDIT_LIMIT,maxPerHost:2,expiresAfterHours:24,...await globalAllowance(c,time),normalLimitsUnchanged:true});
  }
  const data=await body(request);
  if(!Array.isArray(data.urls)||!data.urls.length||data.urls.length>PRESS_AUDIT_LIMIT)return json({error:'Approve between 1 and 96 exact article URLs.'},400);
  const hosts=new Map<string,number>(),seen=new Set<string>();
  const entries=data.urls.map((entry:any,index:number)=>{
   const url=pressAuditURL(typeof entry==='string'?entry:entry?.url),host=new URL(url).hostname;
   if(seen.has(url))throw Error('Each approved article URL must be unique.');seen.add(url);
   const count=(hosts.get(host)||0)+1;hosts.set(host,count);if(count>2)throw Error('Approve at most two articles per newspaper hostname (www is the same hostname).');
   const title=typeof entry==='string'?'':entry.sourceHeadline;
   if(title!==undefined&&(typeof title!=='string'||title.length>400||/[<>\u0000-\u001f]|https?:\/\//i.test(title)))throw Error('Use a plain source headline of up to 400 characters.');
   return {id:crypto.randomUUID(),url,host,headline:title?.trim()||'',ordinal:index};
  });
  if(data.label!==undefined&&(typeof data.label!=='string'||data.label.length>100||/[<>\u0000-\u001f]/.test(data.label)))return json({error:'Use a plain press-check label of up to 100 characters.'},400);
  if(!c.DB.batch)return json({error:'Transactional press-check storage is unavailable.'},503);
  const id=crypto.randomUUID(),created=new Date(time).toISOString(),expires=new Date(time+86400000).toISOString(),day=created.slice(0,10),label=data.label?.trim()||'Private newspaper press check';
  await c.DB.batch([
   c.DB.prepare(`INSERT OR IGNORE INTO rr_press_audit_runs(id,room_id,owner_id,day,label,created_at,expires_at,entry_limit) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM rr_press_audit_runs WHERE room_id=? AND status='active' AND expires_at>?) AND (SELECT COALESCE(SUM(entry_limit),0) FROM rr_press_audit_runs WHERE day=?)+?<=96`).bind(id,room.id,room.member_id,day,label,created,expires,entries.length,room.id,created,day,entries.length),
   ...entries.map((entry:any)=>c.DB.prepare('INSERT INTO rr_press_audit_entries(id,run_id,ordinal,url,host,source_headline) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rr_press_audit_runs WHERE id=? AND room_id=? AND owner_id=?)').bind(entry.id,id,entry.ordinal,entry.url,entry.host,entry.headline,id,room.id,room.member_id))
  ]);
  const run=await c.DB.prepare('SELECT * FROM rr_press_audit_runs WHERE id=? AND room_id=? AND owner_id=?').bind(id,room.id,room.member_id).first();
  if(!run)return json({error:'This room already has an active press check, has used its one press check for this UTC day, or the instance’s 96 reserved articles for today are used.'},409);
  return json({run:await view(c,run,time),...await globalAllowance(c,time),normalLimitsUnchanged:true},201);
 }catch(error){if(error instanceof Response)return error;return json({error:error instanceof Error&&/^(?:Use |Approve |Each )/.test(error.message)?error.message:'The private press check could not be updated.'},400);}
}

declare const allowanceBrand:unique symbol;
export type PressAuditAllowance={readonly [allowanceBrand]:true};
type Stage='article'|'capture'|'library';
type AllowanceState={DB:Config['DB'];runId:string;entryId:string;roomId:string;ownerId:string;url:string;requestId:string;sourceHeadline:string;stages:Set<Stage>};
const allowances=new WeakMap<PressAuditAllowance,AllowanceState>();
export async function claimPressAuditEntry(request:Request,c:Config,input:{runId:unknown;entryId:unknown;url:unknown;requestId:unknown},time=Date.now()){
 const room=await owner(request,c);if(!sameOrigin(request))failure('Use the room’s press-check controls.',403);
 if(typeof input.runId!=='string'||!UUID.test(input.runId)||typeof input.entryId!=='string'||!UUID.test(input.entryId)||typeof input.requestId!=='string'||!UUID.test(input.requestId))failure('Include a valid press-check run, article and request identity.');
 let url:string;try{url=pressAuditURL(input.url);}catch{failure('Use the exact article URL approved for this press check.');}
 await schema(c);const timestamp=new Date(time).toISOString();
 const entry:any=await c.DB.prepare(`UPDATE rr_press_audit_entries SET status='claimed',request_id=?,claimed_at=? WHERE id=? AND run_id=? AND url=? AND status='approved' AND NOT EXISTS (SELECT 1 FROM rr_press_audit_entries WHERE run_id=? AND request_id=?) AND EXISTS (SELECT 1 FROM rr_press_audit_runs r WHERE r.id=run_id AND r.room_id=? AND r.owner_id=? AND r.status='active' AND r.expires_at>?) RETURNING source_headline`).bind(input.requestId,timestamp,input.entryId,input.runId,url,input.runId,input.requestId,room.id,room.member_id,timestamp).first();
 if(!entry)failure('This press-check entry is unavailable, expired or already attempted.',409);
 const allowance=Object.freeze({}) as PressAuditAllowance;
 allowances.set(allowance,{DB:c.DB,runId:input.runId,entryId:input.entryId,roomId:room.id,ownerId:room.member_id,url,requestId:input.requestId,sourceHeadline:entry.source_headline,stages:new Set()});
 return {allowance,sourceHeadline:entry.source_headline};
}
// Only an object minted after the atomic database claim is recognised. JSON and
// headers cannot mint this context. Each downstream stage may spend it once.
export async function spendPressAuditStage(allowance:PressAuditAllowance|undefined,stage:Stage,c:Config,url:string,requestId?:string,request?:Request){
 if(!allowance)return false;const state=allowances.get(allowance);
 const libraryRoom=typeof c.RR_ACTIVE_ROOM_ID==='string'?c.RR_ACTIVE_ROOM_ID:DEFAULT_ROOM_ID;
 if(!state||state.DB!==c.DB||state.stages.has(stage)||pressAuditURL(url)!==state.url||requestId!==undefined&&requestId!==state.requestId||request&&(roomId(request)!==state.roomId||roomMemberId(request)!==state.ownerId)||c.RR_ACTIVE_ROOM_ID&&c.RR_ACTIVE_ROOM_ID!==state.roomId||stage==='library'&&libraryRoom!==state.roomId)throw Error('The press-check reservation does not match this source request.');
 state.stages.add(stage);
 const row=await c.DB.prepare(`SELECT 1 AS valid FROM rr_press_audit_entries e JOIN rr_press_audit_runs r ON r.id=e.run_id JOIN rr_rooms room ON room.id=r.room_id AND room.owner_id=r.owner_id JOIN rr_room_members rm ON rm.room_id=room.id AND rm.member_id=r.owner_id AND rm.role='owner' AND rm.revoked_at IS NULL JOIN rr_members m ON m.id=r.owner_id AND m.role='owner' AND m.revoked_at IS NULL WHERE e.id=? AND e.run_id=? AND e.url=? AND e.request_id=? AND e.status='claimed' AND r.room_id=? AND r.owner_id=? AND r.status='active' AND r.expires_at>?`).bind(state.entryId,state.runId,state.url,state.requestId,state.roomId,state.ownerId,new Date().toISOString()).first();
 if(!row)throw Error('This press-check reservation has expired or ended.');return true;
}
export async function finishPressAuditEntry(allowance:PressAuditAllowance,response:{ok:boolean;status:number;id?:string;cached?:boolean;needsHeadline?:boolean;unsupported?:boolean;errorCode?:PressAuditErrorCode}){
 const state=allowances.get(allowance);if(!state)return;allowances.delete(allowance);
 const id=response.ok&&typeof response.id==='string'&&/^[a-f0-9]{48}$/.test(response.id)?response.id:null;
 const status=id?(response.cached?'cached':'saved'):'failed',error=id?null:knownErrorCode(response.errorCode)||(response.unsupported?'unsupported_publisher':response.needsHeadline?'headline_required':response.ok?'incomplete_result':'import_failed');
 await state.DB.prepare("UPDATE rr_press_audit_entries SET status=?,finished_at=?,http_status=?,page_id=?,error_code=? WHERE id=? AND run_id=? AND request_id=? AND status='claimed'").bind(status,new Date().toISOString(),response.status,id,error,state.entryId,state.runId,state.requestId).run();
 await state.DB.prepare("UPDATE rr_press_audit_runs SET status='complete' WHERE id=? AND NOT EXISTS (SELECT 1 FROM rr_press_audit_entries WHERE run_id=? AND status IN ('approved','claimed'))").bind(state.runId,state.runId).run();
}
