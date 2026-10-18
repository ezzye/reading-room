import {publicHTML,publisherFor} from './newspaper-core.mjs';
import {discoverArticleMedia,articleIdentity,mediaSourceSummary} from './article-media.mjs';
import {providerCall,loadPage} from './education-service.ts';
import type {Config} from './education-service.ts';
import {requireRoom,accessiblePage} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {fetchPublisherPreview,validatePublisherPreview} from './library-transport.mjs';
import {rankMatches} from '../extension-library/library-core.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export const MEDIA_DISCOVERY_REVISION=3;
export function mediaDiscoveryCached(previous:{checkedAt?:string,added?:number,extractorRevision?:number}|undefined,now=Date.now()){const age=now-Date.parse(previous?.checkedAt||'');return age>=0&&age<86400000&&(Number(previous?.added||0)>0||previous?.extractorRevision===MEDIA_DISCOVERY_REVISION);}
export function mediaCheckTelemetry(capture:{url:string},result:{added?:number,extractorRevision?:number,attempts?:unknown[]}){
 const count=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(4_000_000,Math.round(n))):null;
 const types=new Set(['public-html','supplied-public-html','provider-fetch','publisher-preview']),states=new Set(['checked','unavailable','index-checked','index-unavailable','content-unavailable','identity-mismatch','blocked']);
 return {publisher:publisherFor(capture.url).host,revision:count(result.extractorRevision),added:count(result.added),checks:(Array.isArray(result.attempts)?result.attempts:[]).slice(0,8).map(raw=>{const a=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};return {type:types.has(String(a.sourceType))?a.sourceType:'index',state:states.has(String(a.state))?a.state:'unknown',characters:count(a.contentCharacters),images:count(a.imageReferences),videos:count(a.videoReferences)};})};
}
export function mediaAvailabilityMessage(document:any){
 const blocks=Array.isArray(document?.capture?.blocks)?document.capture.blocks:[],images=blocks.some((b:any)=>b.type==='figure'&&b.url),videos=blocks.some((b:any)=>b.type==='video'&&b.url),check=document?.mediaDiscovery;
 if(images||videos){const saved=images&&videos?'Saved images and source video links are available.':videos?'Source video links are saved.':'Source image links are saved.';return saved+(check?.checkedAt&&!check.added?' The latest automatic check added no more media.':'');}
 return check?.checkedAt?'The latest automatic check could not obtain public media. Open the original article for images and video.':'Images and video will be checked against public sources.';
}
const library=(capture:any)=>capture?.presentation?.method==='library-text'||capture?.diagnostics?.libraryTextEdition;

// The library supplies prose. These independent public checks supply only media;
// no search snippet, hidden body or unrelated footage becomes article text.
export async function collectArticleMedia(capture:any,c:Config,fetcher:typeof fetch=fetch,initial?:{url:string,html:string},publisherPreview?:unknown){
 const p=publisherFor(capture.url),home='https://www.'+p.host+'/',sources:any[]=[],attempts:any[]=[];
 if(p.host==='telegraph.co.uk'&&(c.RR_LIBRARY_AWS_FUNCTION||publisherPreview)){
  // The configured preview service is the sole public fetch for this source;
  // a denial is a terminal outcome, never a reason to retry through providers.
  try{
   const preview=publisherPreview?validatePublisherPreview(publisherPreview,capture.url):await fetchPublisherPreview(c,capture.url,fetcher);
   if(preview.state!=='available')return {blocks:[],receipts:[],attempts:[{sourceURL:capture.url,state:preview.state==='blocked'?'blocked':'unavailable',sourceType:'publisher-preview',httpStatus:preview.httpStatus,reasonCode:preview.reasonCode}],checkedAt:preview.checkedAt};
   const original=String(capture.title||'').split(/\s+-\s+/)[0],match=rankMatches(original,[{title:preview.title}])[0];
   if(!match||match.score<.72)return {blocks:[],receipts:[],attempts:[{sourceURL:capture.url,state:'identity-mismatch',sourceType:'publisher-preview',reasonCode:'headline_mismatch'}],checkedAt:preview.checkedAt};
   const seen=new Set((capture.blocks||[]).filter((b:any)=>['figure','video'].includes(b.type)).map((b:any)=>b.type==='video'?videoEmbed(b.url):mediaURL(b.url)));
   const blocks=preview.blocks.filter((b:any)=>!seen.has(b.url)),ids=new Set(blocks.map((b:any)=>b.id));
   return {blocks,receipts:preview.receipts.filter((r:any)=>ids.has(r.id)),attempts:[{sourceURL:preview.sourceURL,state:'checked',sourceType:'publisher-preview',httpStatus:preview.httpStatus,reasonCode:preview.reasonCode,imageReferences:preview.blocks.filter((b:any)=>b.type==='figure').length,videoReferences:preview.blocks.filter((b:any)=>b.type==='video').length}],checkedAt:preview.checkedAt};
  }catch{return {blocks:[],receipts:[],attempts:[{sourceURL:capture.url,state:'unavailable',sourceType:'publisher-preview',reasonCode:'preview_unavailable'}],checkedAt:new Date().toISOString()};}
 }

 if(initial){sources.push({...initial,kind:'article'});attempts.push({sourceURL:initial.url,state:'checked',sourceType:'supplied-public-html',...mediaSourceSummary(initial)});}
 const addresses=[...(initial?[]:[capture.url]),home];
 await Promise.all(addresses.map(async address=>{try{const source=await publicHTML(address,fetcher);sources.push({...source,kind:address===home?'front-page':'article'});attempts.push({sourceURL:address,state:'checked',sourceType:'public-html',...mediaSourceSummary(source)});}catch{attempts.push({sourceURL:address,state:'unavailable',sourceType:'public-html'});}}));
 const rank=(source:any)=>source.kind==='article'?0:source.kind==='web'?1:2;
 sources.sort((a,b)=>rank(a)-rank(b)||a.url.localeCompare(b.url));
 let found=discoverArticleMedia(capture,sources);
 const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'];
 if((!found.blocks.some((b:any)=>b.type==='video')&&!capture.blocks.some((b:any)=>b.type==='video'))&&typeof key==='string'&&key.trim()){
  // One index query and at most two public metadata fetches. Only the exact
  // publisher article and its homepage can contribute evidence.
  try{const search:any=await providerCall(key.trim(),'/v1/tools/search',{query:('site:'+p.host+' '+String(capture.title).split(/\s+-\s+/)[0]).slice(0,128),count:4,need_content:false},fetcher);
   attempts.push({sourceURL:capture.url,state:Array.isArray(search.results)?'index-checked':'index-unavailable'});
   for(const candidate of Array.isArray(search.results)?search.results:[]){if(articleIdentity(candidate.url)!==articleIdentity(capture.url))continue;if(typeof candidate.content==='string')sources.push({url:capture.url,title:candidate.title,content:candidate.content,kind:'web'});}
  }catch{attempts.push({sourceURL:capture.url,state:'index-unavailable'});}
  await Promise.all([capture.url,home].map(async address=>{try{const result:any=await providerCall(key.trim(),'/v1/tools/fetch',{url:address},fetcher);
   const matched=!result.url||articleIdentity(result.url)===articleIdentity(address),readable=typeof result.content==='string'&&!/^(?:verifying|access denied|just a moment|subscribe|sign.?in)/i.test(result.title||'');
   if(matched&&readable){const source={url:address,title:result.title,content:result.content,kind:address===home?'front-page':'web'};sources.push(source);attempts.push({sourceURL:address,state:'checked',sourceType:'provider-fetch',...mediaSourceSummary(source)});}
   else attempts.push({sourceURL:address,state:matched?'content-unavailable':'identity-mismatch',sourceType:'provider-fetch'});
  }catch{attempts.push({sourceURL:address,state:'unavailable',sourceType:'provider-fetch'});/* Missing public metadata does not invalidate the library text. */}}));
  sources.sort((a,b)=>rank(a)-rank(b)||a.url.localeCompare(b.url));
  found=discoverArticleMedia(capture,sources);
 }
 return {...found,attempts,checkedAt:new Date().toISOString()};
}
export async function roomMediaAPI(r:Request,c:Config,fetcher:typeof fetch=fetch,options?:{publisherPreview?:unknown}){
 try{
  const room=await requireRoom(r,c);if(r.method!=='POST')return json({error:'Use the reader.'},405);if(!sameOrigin(r))return json({error:'Use Reading Room to check article media.'},403);
  if(Number(r.headers.get('content-length')||0)>3000)return json({error:'Invalid request.'},413);
  if(!r.body)return json({error:'Invalid request.'},400);const reader=r.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>3000)return json({error:'Invalid request.'},413);chunks.push(part.value);}}finally{await reader.cancel();}const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}let input;try{input=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid request.'},400);}
  if(!/^[a-f0-9]{48}$/.test(input.id||'')||!await accessiblePage(r,c,input.id))return json({error:'Article not found in this room.'},404);
  const page=await loadPage(c.DB,input.id);if(!page)return json({error:'Article not found.'},404);const capture=page.document?.capture;
  if(!library(capture))return json({added:0,message:'Source media are already retained from the readable article.'});
  const previous=page.document.mediaDiscovery;
  if(mediaDiscoveryCached(previous)){if(!previous.added)console.info('RR_MEDIA_CHECK',JSON.stringify(mediaCheckTelemetry(capture,previous)));return json({added:0,cached:true,message:mediaAvailabilityMessage(page.document)});}
  const slot='room-media:'+room.id+':'+new Date().toISOString().slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<20 RETURNING n').bind(slot).first())return json({added:0,message:'Today’s media checks are used. The article remains readable.'});
  const before=JSON.stringify(page.document),result=await collectArticleMedia(capture,c,fetcher,undefined,options?.publisherPreview);
  console.info('RR_MEDIA_CHECK',JSON.stringify(mediaCheckTelemetry(capture,{...result,added:result.blocks.length,extractorRevision:MEDIA_DISCOVERY_REVISION})));
  const blocks=result.blocks.map((block:any)=>({...block,credit:[block.credit||capture.publisher,block.basis==='exact-article-front-page-card'?'Publisher front-page image':'Public source media','Original position not verified'].filter(Boolean).join(' · ')}));
  const document={...page.document,capture:{...capture,diagnostics:{...capture.diagnostics,imageCount:capture.blocks.filter((b:any)=>b.type==='figure').length+blocks.filter((b:any)=>b.type==='figure').length,videoCount:capture.blocks.filter((b:any)=>b.type==='video').length+blocks.filter((b:any)=>b.type==='video').length},blocks:[...capture.blocks,...(blocks.length?[{id:'discovered-media-heading',type:'heading',level:2,text:'Images & video',style:{},rect:{width:660,height:60}},...blocks]:[])]},mediaDiscovery:{checkedAt:result.checkedAt,extractorRevision:MEDIA_DISCOVERY_REVISION,added:blocks.length,receipts:result.receipts,attempts:result.attempts}};
  const updated=await c.DB.prepare('UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS (SELECT 1 FROM rr_room_articles a WHERE a.page_id=education_pages.id AND a.room_id=?)').bind(JSON.stringify(document),input.id,before,room.id).run();
  const added=updated.meta?.changes?blocks.length:0;return json({added,message:added?'Matched public source media added.':blocks.length?'Another reader updated this edition. Reload to see its media.':mediaAvailabilityMessage(document)});
 }catch(error){if(error instanceof Response)return error;return json({error:'The media check is unavailable. The article remains readable.'},502);}
}
