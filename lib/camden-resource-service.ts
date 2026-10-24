import {requireRoom} from './rooms.ts';
import {sameOrigin,tokenHash} from './edition-access.ts';
import {providerCall} from './education-service.ts';
import type {Config} from './education-service.ts';
import {CAMDEN_RESOURCES,camdenResource,referenceURL,REFERENCE_KIND} from './camden-resources.mjs';
const SEARCH_LIMIT=30;
function searchUsage(used:number,time=Date.now()){
 const date=new Date(time),count=Number.isInteger(used)&&used>0?Math.min(used,SEARCH_LIMIT):0;
 return {limit:SEARCH_LIMIT,used:count,remaining:SEARCH_LIMIT-count,resetsAt:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString(),scope:'room',failedAttemptsCount:true};
}
export {CAMDEN_RESOURCES,camdenResource,referenceURL,REFERENCE_KIND};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
async function readBody(r:Request){if(!r.body||Number(r.headers.get('content-length')||0)>5000)throw Error('invalid_body');const reader=r.body.getReader(),decoder=new TextDecoder();let size=0,text='';try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>5000)throw Error('invalid_body');text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel();}}
const opaque=()=>[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');
function safeTitle(value:unknown){if(typeof value!=='string')return '';return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);}
export async function camdenResourcesAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(r,c);
  if(r.method==='GET')return json({resources:CAMDEN_RESOURCES,room:{id:room.id,name:room.name,role:room.role}});
  if(r.method!=='POST')return json({error:'Use the Camden resources panel.'},405);
  if(!sameOrigin(r))return json({error:'Use Reading Room to open a resource.'},403);
  let input:any;try{input=await readBody(r);}catch{return json({error:'The resource request is invalid.'},400);}
  const resource=camdenResource(input?.resourceId);if(!resource)return json({error:'Choose a listed resource.'},400);
  if(input.action==='search'){
   if(Object.keys(input).some(key=>!['action','resourceId','query'].includes(key)))return json({error:'The resource request is invalid.'},400);
   const rawQuery=typeof input.query==='string'?input.query.trim().replace(/\s+/g,' '):'';
   if(rawQuery.length<3||/[<>\u0000-\u001f]/.test(rawQuery))return json({error:'Enter at least 3 characters.'},400);
   const prefix='site:'+resource.searchHost+' ',available=128-prefix.length;
   const query=rawQuery.length<=available?rawQuery:rawQuery.slice(0,available+1).replace(/\s+\S*$/,'').trim();
   if(query.length<3||query.length>available)return json({error:'Use a shorter search phrase.'},400);
   const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'];if(typeof key!=='string'||!key.trim())return json({error:'Resource search is unavailable.'},503);
   const stamp=new Date().toISOString(),counter='room-search:'+room.id+':'+stamp.slice(0,10);
   const used=await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<30 RETURNING n').bind(counter).first<{n:number}>();
   const getUsage=()=>searchUsage(used?.n||SEARCH_LIMIT,Date.now()),initialUsage=getUsage();
   if(!used)return json({error:'Today’s shared room search allowance has been used. Try after midnight UTC.',searchUsage:initialUsage},429);
   const result:any=await providerCall(key.trim(),'/v1/tools/search',{query:prefix+query,count:6,need_content:false},fetcher);
   if(!result||typeof result!=='object'||!Array.isArray(result.results)||result.results.some((row:any)=>!row||typeof row!=='object'||typeof row.url!=='string'||row.url.length>2000||typeof row.title!=='string'||row.title.length>5000))throw Error('Malformed search response.');
   const rows=result.results,seen=new Set<string>(),results=[];
   for(const row of rows){if(results.length>=6)break;let url:string;try{url=referenceURL(row?.url,resource.id);}catch{continue;}const title=safeTitle(row?.title);if(!title||seen.has(url))continue;seen.add(url);results.push({resourceId:resource.id,title,url});}
   return json({results,room:{id:room.id,name:room.name,role:room.role},searchUsage:getUsage()});
  }
  if(input.action==='save'){
   if(Object.keys(input).some(key=>!['action','resourceId','title','url'].includes(key)))return json({error:'The resource request is invalid.'},400);
   const title=safeTitle(input.title);if(!title||typeof input.url!=='string'||input.url.length>2000)return json({error:'Choose a titled result from this provider.'},400);
   let url:string;try{url=referenceURL(input.url,resource.id);}catch{return json({error:'Use a permanent reading link from the selected provider, without sign-in, account or sharing codes.'},400);}
   const sourceHash='rr-reference:'+await tokenHash(room.id+'|'+resource.id+'|'+url),createdAt=new Date().toISOString();
   const existing=await c.DB.prepare('SELECT p.id FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=? AND p.source_hash=? LIMIT 1').bind(room.id,sourceHash).first<{id:string}>();
   if(existing)return json({id:existing.id,href:'/read/'+existing.id+'?room='+room.id,cached:true});
   const id=opaque(),document=JSON.stringify({kind:REFERENCE_KIND,resourceId:resource.id,title,url});
   if(!c.DB.batch)throw Error('Room reference storage is unavailable.');
   await c.DB.batch([
    c.DB.prepare('INSERT OR IGNORE INTO education_pages(id,source_hash,source_url,title,document,created_at) VALUES (?,?,?,?,?,?)').bind(id,sourceHash,url,title,document,createdAt),
    c.DB.prepare('INSERT OR IGNORE INTO rr_room_articles(room_id,page_id,added_by,created_at) SELECT ?,id,?,? FROM education_pages WHERE source_hash=?').bind(room.id,room.member_id,createdAt,sourceHash)
   ]);
   const saved=await c.DB.prepare('SELECT p.id FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=? AND p.source_hash=? LIMIT 1').bind(room.id,sourceHash).first<{id:string}>();
   if(!saved)throw Error('Room reference could not be saved.');
   return json({id:saved.id,href:'/read/'+saved.id+'?room='+room.id,cached:saved.id!==id});
  }
  return json({error:'Choose search or save.'},400);
 }catch(e){if(e instanceof Response)return e;return json({error:'Camden resources are temporarily unavailable.'},503);}
}
