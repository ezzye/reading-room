import {requireRoom} from './rooms.ts';
import type {Config} from './education-service.ts';

export const URL_IMPORT_LIMIT=30;
export const urlImportCounterKey=(time=Date.now())=>'url-fetch:'+new Date(time).toISOString().slice(0,10);
export function nextUTCImportReset(time=Date.now()){const date=new Date(time);return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString();}
export async function readURLImportUsage(c:Config,time=Date.now()){
 const row=await c.DB.prepare('SELECT n FROM education_counters WHERE key=?').bind(urlImportCounterKey(time)).first<{n:number}>(),value=Number(row?.n||0),used=Number.isFinite(value)?Math.max(0,Math.floor(value)):0;
 return {limit:URL_IMPORT_LIMIT,used,remaining:Math.max(0,URL_IMPORT_LIMIT-used),resetsAt:nextUTCImportReset(time),scope:'reading-room-service' as const,failedAttemptsCount:true as const};
}
export async function reserveURLImportAttempt(c:Config,time=Date.now()){
 return Boolean(await c.DB.prepare('INSERT INTO education_counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n').bind(urlImportCounterKey(time),URL_IMPORT_LIMIT).first());
}
export function importRetryAfter(time=Date.now()){return String(Math.max(1,Math.ceil((Date.parse(nextUTCImportReset(time))-time)/1000)));}
export function dailyImportLimitMessage(resetsAt:string){
 const ukTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(resetsAt));
 return `All ${URL_IMPORT_LIMIT} daily URL/import attempts for this Reading Room service have been used across its newspapers, rooms and members. Failed imports count; opening saved articles does not. Resets ${ukTime} UK time (midnight UTC).`;
}
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders});
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
