import {sessionMember,MEMBER_SESSION_COOKIE} from './member-auth.ts';
import {memberRoom} from './rooms.ts';
import {sameOrigin,tokenHash} from './edition-access.ts';
import {sourceURL} from './education-core.mjs';
import {safeURLMatch} from './article-matching.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
import {roomBody} from './room-articles.ts';
import type {Config} from './education-service.ts';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const random=(n=32)=>[...crypto.getRandomValues(new Uint8Array(n))].map(x=>x.toString(16).padStart(2,'0')).join('');
const iso=(n:number)=>new Date(n).toISOString();
const clean=(x:unknown,max:number)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const originOK=(value:string)=>/^chrome-extension:\/\/[a-p]{32}$/.test(value);
type LensSession={id:string,room_id:string,member_id:string,article_url:string,expires_at:string,pair_expires_at:string,paired_at:string|null,extension_origin:string|null};
// Every capability operation rechecks the original browser session and room owner membership.
const live=`SELECT l.* FROM rr_page_lens_sessions l JOIN rr_sessions s ON s.token_hash=l.session_hash
 JOIN rr_members m ON m.id=l.member_id JOIN rr_room_members rm ON rm.member_id=l.member_id AND rm.room_id=l.room_id
 WHERE l.revoked_at IS NULL AND l.expires_at>? AND s.revoked_at IS NULL AND s.expires_at>? AND m.revoked_at IS NULL AND rm.revoked_at IS NULL AND rm.role='owner'`;
export async function pageLensOwner(request:Request,config:Config){
 const member=await sessionMember(request,config);if(!member)throw json({error:'Sign in as this room’s owner.'},401);
 const room=await memberRoom(request,config,member.id);if(!room||room.role!=='owner')throw json({error:'Room owner access is required.'},403);
 const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(MEMBER_SESSION_COOKIE+'='))?.slice(MEMBER_SESSION_COOKIE.length+1)||'';
 return {member,room,sessionHash:await tokenHash(raw)};
}
function publicURL(value:unknown){if(typeof value!=='string')throw Error();const url=sourceURL(value);if(!safeURLMatch(url,url))throw Error();return url;}
function safeMedia(value:unknown){if(typeof value!=='string'||value.length>4096)return '';try{const u=new URL(value);if(u.hostname.includes(':')||[...u.searchParams.keys()].some(k=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k)))return '';return mediaURL(value);}catch{return '';}}
function mediaResult(input:any,url:string){
 if(input?.schema!=='ret-media/v1'||input.diagnostics?.visibleOnly!==true||input.blocks||input.body||input.text||!Array.isArray(input.media)||input.media.length<1||input.media.length>20||publicURL(input.url)!==url||!Number.isFinite(Date.parse(input.capturedAt)))throw Error();
 const width=Number(input.viewport?.width),height=Number(input.viewport?.height);if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>10000||height>10000)throw Error();
 const media=input.media.map((item:any)=>{if(!item||!['figure','video'].includes(item.type)||item.text||item.body)throw Error();const original=safeMedia(item.url),poster=item.poster?safeMedia(item.poster):'';if(!original||item.poster&&!poster)throw Error();const supported=item.type==='video'?videoEmbed(original):original;if(!supported&&!poster)throw Error();const rect=Object.fromEntries(['x','y','width','height'].map(k=>[k,typeof item.rect?.[k]==='number'&&Number.isFinite(item.rect[k])?Math.max(0,Math.min(100000,item.rect[k])):0]));return {type:supported?item.type:'figure',url:supported||poster,poster:supported?poster:'',caption:clean(item.caption,1500)+(supported?'':' · Poster only; source player unsupported.'),credit:clean(item.credit,500),rect};});
 return {schema:'ret-media/v1',url,title:clean(input.title,600),capturedAt:iso(Date.parse(input.capturedAt)),viewport:{width,height},media,diagnostics:{visibleOnly:true,...(input.diagnostics.viewportBasis==='rendered-enabled-tab'&&input.diagnostics.osFocusVerified===false?{viewportBasis:'rendered-enabled-tab',osFocusVerified:false}:{})}};
}
export async function pageLensAPI(request:Request,config:Config,now=Date.now()):Promise<Response>{
 try{
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
  let body:any={};if(request.method==='POST')body=await roomBody(request,262144);
  const bearer=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(body.action==='pair'||bearer){
   const origin=request.headers.get('origin')||'';if(!originOK(origin))return json({error:'An explicitly paired Page Lens extension is required.'},403);
   if(body.action==='pair'){
    if(request.method!=='POST'||! /^[a-f0-9]{64}$/.test(body.pairingCode||'')||!/^\d+\.\d+\.\d+$/.test(body.extensionVersion||''))return json({error:'Invalid pairing request.'},400);
    const row=await config.DB.prepare(live+' AND l.pair_hash=? AND l.paired_at IS NULL AND l.pair_expires_at>?').bind(iso(now),iso(now),await tokenHash(body.pairingCode),iso(now)).first<LensSession>();
    if(!row||publicURL(body.articleURL)!==row.article_url)return json({error:'This pairing is unavailable or targets a different article.'},410);
    const token=random();const updated=await config.DB.prepare('UPDATE rr_page_lens_sessions SET token_hash=?,extension_origin=?,paired_at=? WHERE id=? AND paired_at IS NULL AND pair_expires_at>? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM rr_sessions s JOIN rr_members m ON m.id=s.member_id JOIN rr_room_members rm ON rm.member_id=m.id WHERE s.token_hash=rr_page_lens_sessions.session_hash AND s.revoked_at IS NULL AND s.expires_at>? AND m.revoked_at IS NULL AND rm.room_id=rr_page_lens_sessions.room_id AND rm.role=\'owner\' AND rm.revoked_at IS NULL)').bind(await tokenHash(token),origin,iso(now),row.id,iso(now),iso(now)).run();
    if(!updated.meta?.changes)return json({error:'Pairing already used.'},410);
    return json({sessionId:row.id,token,articleURL:row.article_url,expiresAt:row.expires_at,pollSeconds:30});
   }
   const session=await config.DB.prepare(live+' AND l.token_hash=? AND l.extension_origin=?').bind(iso(now),iso(now),await tokenHash(bearer!),origin).first<LensSession>();
   if(!session)return json({error:'Capture permission has expired or was revoked.'},410);
   if(request.method==='GET'||(request.method==='POST'&&body.action==='poll')){
    const command=await config.DB.prepare(`UPDATE rr_page_lens_commands SET state='claimed' WHERE id=(SELECT id FROM rr_page_lens_commands WHERE session_id=? AND state='waiting' AND expires_at>? ORDER BY created_at LIMIT 1) AND state='waiting' AND EXISTS (${live.replace('SELECT l.*','SELECT 1')} AND l.id=rr_page_lens_commands.session_id) RETURNING id`).bind(session.id,iso(now),iso(now),iso(now)).first<{id:string}>();
    return json({sessionId:session.id,articleURL:session.article_url,expiresAt:session.expires_at,command:command?{id:command.id,action:'capture-visible-media'}:null});
   }
   if(body.sessionId!==session.id)return json({error:'This is a different capture session.'},403);
   if(body.action==='stop'){await config.DB.prepare('UPDATE rr_page_lens_sessions SET revoked_at=? WHERE id=?').bind(iso(now),session.id).run();return json({stopped:true});}
   const states=['source-not-active','url-changed','capture-empty','capture-failed'];
   if(!['result','status'].includes(body.action)||! /^[a-f0-9]{32}$/.test(body.commandId||'')||body.action==='status'&&!states.includes(body.state))return json({error:'Only the fixed visible-media response is accepted.'},400);
   let capture;try{if(body.action==='result')capture=mediaResult(body.capture,session.article_url);}catch{return json({error:'Only bounded visible-media references for the paired article are accepted.'},400);}
   const state=body.action==='result'?'result':body.state;
   const completed=await config.DB.prepare(`UPDATE rr_page_lens_commands SET state=?,capture=?,completed_at=? WHERE id=? AND session_id=? AND state='claimed' AND expires_at>? AND EXISTS (${live.replace('SELECT l.*','SELECT 1')} AND l.id=rr_page_lens_commands.session_id)`).bind(state,capture?JSON.stringify(capture):null,iso(now),body.commandId,session.id,iso(now),iso(now),iso(now)).run();
   return completed.meta?.changes?json({staged:true,reviewRequired:true}):json({error:'This capture response expired or was already consumed.'},410);
  }
  const owner=await pageLensOwner(request,config);
  if(request.method==='POST'&&!sameOrigin(request))return json({error:'Use this Reading Room page.'},403);
  const id=request.method==='GET'?new URL(request.url).searchParams.get('sessionId'):body.sessionId;
  if(request.method==='POST'&&body.action==='create'){
   let url;try{url=publicURL(body.articleURL||body.url);}catch{return json({error:'Choose a supported public newspaper article URL.'},400);}
   await config.DB.prepare('DELETE FROM rr_page_lens_sessions WHERE expires_at<=?').bind(iso(now)).run();
   const count=await config.DB.prepare('SELECT COUNT(*) n FROM rr_page_lens_sessions WHERE room_id=? AND revoked_at IS NULL').bind(owner.room.id).first<{n:number}>();if(Number(count?.n)>=3)return json({error:'Stop an existing connection before enabling another tab.'},429);
   const sessionId=random(16),pairingCode=random(),expiresAt=iso(now+600000),pairExpiresAt=iso(now+90000);
   const created=await config.DB.prepare(`INSERT INTO rr_page_lens_sessions(id,pair_hash,session_hash,room_id,member_id,article_url,created_at,pair_expires_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM rr_page_lens_sessions WHERE room_id=? AND revoked_at IS NULL AND expires_at>?)<3 AND EXISTS (SELECT 1 FROM rr_sessions s JOIN rr_members m ON m.id=s.member_id JOIN rr_room_members rm ON rm.member_id=m.id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.revoked_at IS NULL AND rm.room_id=? AND rm.role='owner' AND rm.revoked_at IS NULL)`).bind(sessionId,await tokenHash(pairingCode),owner.sessionHash,owner.room.id,owner.member.id,url,iso(now),pairExpiresAt,expiresAt,owner.room.id,iso(now),owner.sessionHash,iso(now),owner.room.id).run();
   if(!created.meta?.changes)return json({error:'Connection limit or owner access changed.'},409);
   return json({sessionId,pairingCode,articleURL:url,pairExpiresAt,expiresAt},201);
  }
  if(request.method==='GET'&&!id){const sessions=await config.DB.prepare(live+' AND l.room_id=? AND l.member_id=? ORDER BY l.created_at DESC').bind(iso(now),iso(now),owner.room.id,owner.member.id).all<LensSession>();return json({sessions:(sessions.results||[]).map(row=>({sessionId:row.id,articleURL:row.article_url,paired:!!row.paired_at,expiresAt:row.expires_at}))});}
  if(! /^[a-f0-9]{32}$/.test(id||''))return json({error:'Choose a capture connection.'},400);
  const session=await config.DB.prepare(live+' AND l.id=? AND l.room_id=? AND l.member_id=?').bind(iso(now),iso(now),id,owner.room.id,owner.member.id).first<LensSession>();if(!session)return json({error:'This room capture connection is unavailable.'},404);
  if(request.method==='GET'){
   const last=await config.DB.prepare('SELECT id,state,expires_at,capture FROM rr_page_lens_commands WHERE session_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(id).first<{id:string,state:string,expires_at:string,capture:string|null}>();
   return json({sessionId:session.id,articleURL:session.article_url,paired:!!session.paired_at,expiresAt:session.expires_at,command:last?{id:last.id,state:['waiting','claimed'].includes(last.state)&&last.expires_at<=iso(now)?'expired':last.state,capture:last.capture?JSON.parse(last.capture):null}:null});
  }
  if(body.action==='stop'){await config.DB.prepare('UPDATE rr_page_lens_sessions SET revoked_at=? WHERE id=?').bind(iso(now),id).run();return json({stopped:true});}
  if(body.action!=='request'||!session.paired_at)return json({error:'Pair this tab before requesting visible media.'},400);
  const commandId=random(16);const inserted=await config.DB.prepare("INSERT INTO rr_page_lens_commands(id,session_id,state,created_at,expires_at) SELECT ?,?,'waiting',?,? WHERE NOT EXISTS(SELECT 1 FROM rr_page_lens_commands WHERE session_id=? AND state IN ('waiting','claimed') AND expires_at>?) AND (SELECT COUNT(*) FROM rr_page_lens_commands WHERE session_id=?)<20").bind(commandId,id,iso(now),iso(Math.min(now+90000,Date.parse(session.expires_at))),id,iso(now),id).run();
  return inserted.meta?.changes?json({commandId,state:'waiting',reviewRequired:true},201):json({error:'A request is pending or this connection reached its twenty-request limit.'},409);
 }catch(error){if(error instanceof Response)return error;return json({error:'Page Lens connection is unavailable.'},400);}
}
