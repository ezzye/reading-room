import {isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';
import {sameOrigin} from './edition-access.ts';

export const PRIVATE_ASSET_CHUNK_BYTES = 128 * 1024;
export const PRIVATE_ASSET_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 80;
const NAME = /^[A-Za-z0-9._-]{1,120}$/;
const MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp', 'font/woff2']);
const NO_STORE = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:NO_STORE});
type AssetRow={name:string,upload_id:string,mime:string,size:number,parts:number,sha256:string,ready:number,created_at:string};
type PartRow={part:number,content:string};
type Statement={bind(...args:unknown[]):Statement,first<T=Record<string,unknown>>():Promise<T|null>,all<T=Record<string,unknown>>():Promise<{results?:T[]}>,run():Promise<{meta?:{changes?:number}}>};
type AssetConfig=Config & {DB:{prepare(sql:string):Statement}};

function authorizedMember(request:Request,config:AssetConfig){
  // The Worker gate removes client-supplied x-ret-member-id before minting this value.
  return isOwner(request,config)||/^[a-f0-9-]{36}$/i.test(request.headers.get('x-ret-member-id')||'');
}
async function readJSON(request:Request,max=200_000):Promise<Record<string,any>|null>{
  const declared=Number(request.headers.get('content-length')||0);if(declared>max||!request.body)return null;
  const reader=request.body.getReader();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max){await reader.cancel();return null;}text+=decoder.decode(item.value,{stream:true});}text+=decoder.decode();const value=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
  catch{try{await reader.cancel();}catch{}return null;}finally{reader.releaseLock();}
}
function assetName(value:unknown){return typeof value==='string'&&NAME.test(value)?value:'';}
function decodePart(value:unknown):Uint8Array|null{
  if(typeof value!=='string'||value.length>Math.ceil(PRIVATE_ASSET_CHUNK_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return null;
  try{const binary=atob(value),out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;}catch{return null;}
}
async function rowFor(config:AssetConfig,name:string,uploadId?:string){
  return config.DB.prepare(`SELECT name,upload_id,mime,size,parts,sha256,ready,created_at FROM rr_private_assets WHERE name=?${uploadId?' AND upload_id=?':''}`)
    .bind(...(uploadId?[name,uploadId]:[name])).first<AssetRow>();
}

/** Owner-only metadata and bounded chunk upload API. DDL is intentionally managed by migrations. */
export async function privateAssetsAPI(request:Request,config:AssetConfig):Promise<Response>{
  if(!isOwner(request,config))return json({error:'Owner access required.'},403);
  if(request.method==='GET'){
    const result=await config.DB.prepare('SELECT name,mime,size,parts,sha256,ready,created_at AS createdAt FROM rr_private_assets ORDER BY name').all();
    return json({assets:result.results||[]});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(request))return json({error:'Same-origin owner request required.'},403);
  const data=await readJSON(request);if(!data)return json({error:'Invalid or oversized request.'},400);
  if(data.action==='begin'){
    const name=assetName(data.name),mime=typeof data.mime==='string'?data.mime:'',size=Number(data.size),sha256=typeof data.sha256==='string'?data.sha256.toLowerCase():'';
    if(!name||!MIME.has(mime)||!Number.isSafeInteger(size)||size<1||size>PRIVATE_ASSET_MAX_BYTES||!/[a-f0-9]{64}/.test(sha256)||sha256.length!==64)return json({error:'Use a supported file with a valid name, size and SHA-256 digest.'},400);
    const parts=Math.ceil(size/PRIVATE_ASSET_CHUNK_BYTES);if(parts>MAX_PARTS)return json({error:'The file has too many upload parts.'},400);
    const uploadId=crypto.randomUUID();
    try{await config.DB.prepare('INSERT INTO rr_private_assets(name,upload_id,mime,size,parts,sha256,ready,created_at) VALUES(?,?,?,?,?,?,0,?)').bind(name,uploadId,mime,size,parts,sha256,new Date().toISOString()).run();}
    catch{
      const existing=await rowFor(config,name);
      if(existing?.ready===0&&existing.mime===mime&&existing.size===size&&existing.sha256===sha256)return json({uploadId:existing.upload_id,parts:existing.parts,chunkBytes:PRIVATE_ASSET_CHUNK_BYTES,resumed:true});
      return json({error:existing?.ready===1?'An asset with this name already exists; uploads cannot overwrite stored assets.':'A different incomplete upload already uses this name.'},409);
    }
    return json({uploadId,parts,chunkBytes:PRIVATE_ASSET_CHUNK_BYTES},201);
  }
  if(data.action==='part'){
    const name=assetName(data.name),uploadId=typeof data.uploadId==='string'&&/^[a-f0-9-]{36}$/i.test(data.uploadId)?data.uploadId:'',part=Number(data.part),bytes=decodePart(data.content);
    if(!name||!uploadId||!Number.isInteger(part)||!bytes)return json({error:'Invalid asset part.'},400);
    const asset=await rowFor(config,name,uploadId);if(!asset||asset.ready!==0)return json({error:'Upload not found or already complete.'},404);
    if(part<0||part>=asset.parts)return json({error:'Part index is outside this upload.'},400);
    const expected=Math.min(PRIVATE_ASSET_CHUNK_BYTES,asset.size-part*PRIVATE_ASSET_CHUNK_BYTES);
    if(bytes.byteLength!==expected)return json({error:'Part size does not match the upload plan.'},400);
    await config.DB.prepare('INSERT INTO rr_private_asset_parts(upload_id,part,content) VALUES(?,?,?) ON CONFLICT(upload_id,part) DO UPDATE SET content=excluded.content').bind(uploadId,part,data.content).run();
    return json({part,receivedBytes:bytes.byteLength});
  }
  if(data.action==='complete'){
    const name=assetName(data.name),uploadId=typeof data.uploadId==='string'&&/^[a-f0-9-]{36}$/i.test(data.uploadId)?data.uploadId:'';
    if(!name||!uploadId)return json({error:'Invalid upload.'},400);
    const asset=await rowFor(config,name,uploadId);if(!asset||asset.ready!==0)return json({error:'Upload not found or already complete.'},404);
    const result=await config.DB.prepare('SELECT part,content FROM rr_private_asset_parts WHERE upload_id=? ORDER BY part').bind(uploadId).all<PartRow>();
    const rows=result.results||[];if(rows.length!==asset.parts||rows.some((row,i)=>row.part!==i))return json({error:'Some upload parts are missing. Send all parts and try again.'},409);
    const chunks:Uint8Array[]=[];let total=0;for(const row of rows){const bytes=decodePart(row.content);if(!bytes)return json({error:'An upload part is invalid.'},422);chunks.push(bytes);total+=bytes.byteLength;}
    if(total!==asset.size)return json({error:'Uploaded size does not match the declared file size.'},422);
    const content=new Uint8Array(total);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(digest!==asset.sha256)return json({error:'SHA-256 did not match. Upload the file again.'},422);
    const updated=await config.DB.prepare('UPDATE rr_private_assets SET ready=1 WHERE name=? AND upload_id=? AND ready=0 AND sha256=? AND size=?').bind(name,uploadId,digest,total).run();
    if((updated.meta?.changes||0)!==1)return json({error:'Upload changed before it could be completed.'},409);
    return json({ready:true,name,mime:asset.mime,size:asset.size,parts:asset.parts,sha256:digest});
  }
  return json({error:'Unknown asset action.'},404);
}

/** Authenticated room member read path; unready or unknown uploads are indistinguishable. */
export async function privateAssetResponse(request:Request,nameInput:string,config:AssetConfig):Promise<Response>{
  const headers=new Headers({...NO_STORE,'Content-Security-Policy':"default-src 'none'; sandbox; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",'X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin'});
  if(!authorizedMember(request,config))return new Response('Not found',{status:404,headers});
  if(request.method!=='GET'&&request.method!=='HEAD'){headers.set('Allow','GET, HEAD');return new Response('Method not allowed',{status:405,headers});}
  const name=assetName(nameInput);if(!name)return new Response('Not found',{status:404,headers});
  const asset=await rowFor(config,name);if(!asset||asset.ready!==1)return new Response('Not found',{status:404,headers});
  const result=await config.DB.prepare('SELECT part,content FROM rr_private_asset_parts WHERE upload_id=? ORDER BY part').bind(asset.upload_id).all<PartRow>();
  const rows=result.results||[];if(rows.length!==asset.parts||rows.some((row,i)=>row.part!==i))return new Response('Asset unavailable',{status:503,headers});
  const chunks:Uint8Array[]=[];let total=0;for(const row of rows){const bytes=decodePart(row.content);if(!bytes)return new Response('Asset unavailable',{status:503,headers});chunks.push(bytes);total+=bytes.byteLength;}
  if(total!==asset.size)return new Response('Asset unavailable',{status:503,headers});
  const content=new Uint8Array(total);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==asset.sha256)return new Response('Asset unavailable',{status:503,headers});
  headers.set('Content-Type',asset.mime);headers.set('Content-Length',String(asset.size));headers.set('Content-Disposition',`inline; filename="${name}"`);
  return new Response(request.method==='HEAD'?null:content,{status:200,headers});
}
