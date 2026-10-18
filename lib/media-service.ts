import {publicHTML,publisherFor,extractNewspaper} from './newspaper-core.mjs';
import {discoverArticleMedia,articleIdentity,mediaSourceSummary} from './article-media.mjs';
import {providerCall,loadPage} from './education-service.ts';
import type {Config} from './education-service.ts';
import {requireRoom,accessiblePage} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {fetchPublisherPreview,validatePublisherPreview} from './library-transport.mjs';
import {rankMatches} from '../extension-library/library-core.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
import {SUN_IMAGE_REVISION,needsSunImageRepair,isBrokenSunImageURL,validSunPublisherImage} from './sun-media.mjs';
import {parseHTML} from 'linkedom/worker';
import {verifiedPublicMedia,VERIFIED_PUBLIC_MEDIA_REVISION} from './verified-public-media.mjs';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export const MEDIA_DISCOVERY_REVISION=3;
export function mediaDiscoveryCached(previous:{checkedAt?:string,added?:number,extractorRevision?:number}|undefined,now=Date.now()){const age=now-Date.parse(previous?.checkedAt||'');return age>=0&&age<86400000&&(Number(previous?.added||0)>0||previous?.extractorRevision===MEDIA_DISCOVERY_REVISION);}
export function mediaCheckTelemetry(capture:{url:string},result:{added?:number,extractorRevision?:number,attempts?:unknown[]}){
 const count=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(4_000_000,Math.round(n))):null;
 const types=new Set(['public-html','supplied-public-html','provider-fetch','publisher-preview','verified-public-index']),states=new Set(['checked','unavailable','index-checked','index-unavailable','content-unavailable','identity-mismatch','blocked']);
 return {publisher:publisherFor(capture.url).host,revision:count(result.extractorRevision),added:count(result.added),checks:(Array.isArray(result.attempts)?result.attempts:[]).slice(0,8).map(raw=>{const a=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};return {type:types.has(String(a.sourceType))?a.sourceType:'index',state:states.has(String(a.state))?a.state:'unknown',characters:count(a.contentCharacters),images:count(a.imageReferences),videos:count(a.videoReferences)};})};
}
export function mediaAvailabilityMessage(document:any){
 const blocks=Array.isArray(document?.capture?.blocks)?document.capture.blocks:[],images=blocks.some((b:any)=>b.type==='figure'&&b.url),videos=blocks.some((b:any)=>b.type==='video'&&b.url),check=document?.mediaDiscovery;
 if(images||videos){const saved=images&&videos?'Saved images and source video links are available.':videos?'Source video links are saved.':'Source image links are saved.';return saved+(check?.checkedAt&&!check.added?' The latest automatic check added no more media.':'');}
 return check?.checkedAt?'The latest automatic check could not obtain public media. Open the original article for images and video.':'Images and video will be checked against public sources.';
}
const library=(capture:any)=>capture?.presentation?.method==='library-text'||capture?.diagnostics?.libraryTextEdition;
const headlineIdentity=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim():'';
function figureCaptionIdentity(value:unknown){const caption=headlineIdentity(value);return !caption||/^(?:(?:source|article|original|generic|unavailable|missing)\s+)*(?:image|photo|picture|photograph)(?:\s+\d+)?$/.test(caption)||/^(?:credit|credits|copyright)\b/.test(caption)?'':caption;}
function sunRepairCached(previous:any){const age=Date.now()-Date.parse(previous?.checkedAt||'');return previous?.parserRevision===SUN_IMAGE_REVISION&&age>=0&&age<86400000;}
export function sunImageRepairMessage(status:string,replaced=0,unresolved=0){return status==='partial'?`${replaced} source image links repaired; ${unresolved} could not be verified. Reload to view the repaired images.`:status==='repaired'?`${replaced} source image links repaired. Reload to view them.`:status==='identity-mismatch'?'The public article identity or headline changed. Saved text and images were kept.':status==='figure-count-mismatch'?'The public article image count changed. Saved text and images were kept.':status==='figure-identity-mismatch'?'The public image captions or order could not be matched. Saved text and images were kept.':status==='blocked'?'The publisher refused this public media check. Saved text and images were kept.':'Public source image repair was unavailable. Saved text and images were kept.';}
async function repairSunImages(page:any,room:any,c:Config,fetcher:typeof fetch){
 const before=JSON.stringify(page.document),capture=page.document.capture,figures=capture.blocks.filter((block:any)=>block.type==='figure');
 let status='unavailable',replaced=0,blocks=capture.blocks,repairedIds:string[]=[];let unresolvedIds:string[]=figures.filter((block:any)=>isBrokenSunImageURL(block.url,capture.url)).map((block:any)=>block.id);
 try{
  // One existing public-HTML request path only. Denial has no provider, proxy,
  // homepage, credential, referrer or alternate-source fallback.
  const source=await publicHTML(capture.url,fetcher);
  const {document:sourceDocument}=parseHTML(source.html),identities=[...sourceDocument.querySelectorAll('link[rel~="canonical"],meta[property="og:url"]')].map(node=>{try{return articleIdentity(new URL(node.getAttribute(node.tagName==='LINK'?'href':'content')||'',source.url).href);}catch{return '';}}).filter(Boolean);
  if(articleIdentity(source.url)!==articleIdentity(capture.url)||identities.some(identity=>identity!==articleIdentity(capture.url)))status='identity-mismatch';
  else{
   const fresh=extractNewspaper(source.html,source.url),next=fresh.blocks.filter((block:any)=>block.type==='figure');
   if(articleIdentity(fresh.url)!==articleIdentity(capture.url)||!headlineIdentity(fresh.title)||headlineIdentity(fresh.title)!==headlineIdentity(capture.title))status='identity-mismatch';
   else{
    const matched=new Map<any,string>(),used=new Set<number>(),oldCaptions=new Map<string,number>();
    for(const block of figures){const caption=figureCaptionIdentity(block.caption);if(caption)oldCaptions.set(caption,(oldCaptions.get(caption)||0)+1);}
    for(const block of figures){
     if(!isBrokenSunImageURL(block.url,capture.url))continue;
     const caption=figureCaptionIdentity(block.caption),matches=caption&&oldCaptions.get(caption)===1?next.map((candidate:any,index:number)=>({candidate,index})).filter((entry:any)=>figureCaptionIdentity(entry.candidate.caption)===caption):[];
     if(matches.length!==1||used.has(matches[0].index)||!validSunPublisherImage(matches[0].candidate.url))continue;
     used.add(matches[0].index);matched.set(block,matches[0].candidate.url);
    }
    if(matched.size){unresolvedIds=figures.filter((block:any)=>isBrokenSunImageURL(block.url,capture.url)&&!matched.has(block)).map((block:any)=>block.id);repairedIds=[...matched.keys()].map((block:any)=>block.id);status=unresolvedIds.length?'partial':'repaired';replaced=matched.size;blocks=capture.blocks.map((block:any)=>matched.has(block)?{...block,url:matched.get(block)}:block);}
    else status='figure-identity-mismatch';
   }
  }
 }catch(error){replaced=0;const message=error instanceof Error?error.message:'';status=/^The newspaper did not make this page available to RET \(HTTP (?:402|403)\)\./.test(message)?'blocked':'unavailable';}
 const repair={checkedAt:new Date().toISOString(),parserRevision:SUN_IMAGE_REVISION,status,replaced,unresolvedCount:unresolvedIds.length,unresolvedIds,sourceURL:capture.url,figureCount:figures.length,basis:'exact-article-url-and-headline; unique-nonempty-caption-match; generic-captions-excluded; one-to-one; saved-block-order-preserved',...(repairedIds.length?{blockIds:repairedIds}:{})};
 const document={...page.document,capture:repairedIds.length?{...capture,blocks}:capture,sunImageRepair:repair};
 const updated=await c.DB.prepare('UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS (SELECT 1 FROM rr_room_articles a WHERE a.page_id=education_pages.id AND a.room_id=?)').bind(JSON.stringify(document),page.id,before,room.id).run();
 if(!updated.meta?.changes)return json({added:0,repaired:0,message:'Another reader updated this edition. Reload before checking its images.'});
 return json({added:0,repaired:repairedIds.length?replaced:0,unresolved:unresolvedIds.length,repairStatus:status,message:sunImageRepairMessage(status,replaced,unresolvedIds.length)});
}

// The library supplies prose. These independent public checks supply only media;
// no search snippet, hidden body or unrelated footage becomes article text.
export async function collectArticleMedia(capture:any,c:Config,fetcher:typeof fetch=fetch,initial?:{url:string,html:string},publisherPreview?:unknown){
 const p=publisherFor(capture.url),home='https://www.'+p.host+'/',sources:any[]=[],attempts:any[]=[];
 const verified=verifiedPublicMedia(capture);
 if(verified.matched)return {...verified,attempts:[{sourceURL:capture.url,state:'checked',sourceType:'verified-public-index',imageReferences:1,videoReferences:0,catalogueRevision:VERIFIED_PUBLIC_MEDIA_REVISION}],checkedAt:new Date().toISOString()};
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
  const verified=verifiedPublicMedia(capture,page.sourceURL),verifiedMissing=verified.blocks.length>0;
  if(verifiedPublicMedia(capture).matched&&!verified.matched)return json({added:0,message:'The saved source identity does not match this verified public image.'});
  const sunRepair=needsSunImageRepair(capture);
  if(sunRepair&&articleIdentity(page.sourceURL)!==articleIdentity(capture.url))return json({added:0,repaired:0,repairStatus:'identity-mismatch',message:sunImageRepairMessage('identity-mismatch')});
  if(!library(capture)&&!sunRepair)return json({added:0,...(page.document.sunImageRepair?.status==='repaired'?{cached:true,repaired:0}:{}),message:'Source media are already retained from the readable article.'});
  if(sunRepair&&sunRepairCached(page.document.sunImageRepair))return json({added:0,repaired:0,unresolved:page.document.sunImageRepair.unresolvedCount||0,cached:true,repairStatus:page.document.sunImageRepair.status,message:sunImageRepairMessage(page.document.sunImageRepair.status,page.document.sunImageRepair.replaced,page.document.sunImageRepair.unresolvedCount)});
  const previous=page.document.mediaDiscovery;
  if(!sunRepair&&!verifiedMissing&&mediaDiscoveryCached(previous)){if(!previous.added)console.info('RR_MEDIA_CHECK',JSON.stringify(mediaCheckTelemetry(capture,previous)));return json({added:0,cached:true,message:mediaAvailabilityMessage(page.document)});}
  const slot='room-media:'+room.id+':'+new Date().toISOString().slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<20 RETURNING n').bind(slot).first())return json({added:0,message:'Today’s media checks are used. The article remains readable.'});
  if(sunRepair)return repairSunImages(page,room,c,fetcher);
  const before=JSON.stringify(page.document),result=await collectArticleMedia(capture,c,fetcher,undefined,options?.publisherPreview);
  console.info('RR_MEDIA_CHECK',JSON.stringify(mediaCheckTelemetry(capture,{...result,added:result.blocks.length,extractorRevision:MEDIA_DISCOVERY_REVISION})));
  const blocks=result.blocks.map((block:any)=>block.basis==='exact-article-public-index-thumbnail'?block:({...block,credit:[block.credit||capture.publisher,block.basis==='exact-article-front-page-card'?'Publisher front-page image':'Public source media','Original position not verified'].filter(Boolean).join(' · ')}));
  const previousReceipts=verified.matched&&Array.isArray(previous?.receipts)?previous.receipts:[],previousAttempts=verified.matched&&Array.isArray(previous?.attempts)?previous.attempts:[];
  const heading=verified.matched&&capture.blocks.some((block:any)=>block.id==='discovered-media-heading')?[]:[{id:'discovered-media-heading',type:'heading',level:2,text:'Images & video',style:{},rect:{width:660,height:60}}];
  const document={...page.document,capture:{...capture,diagnostics:{...capture.diagnostics,imageCount:capture.blocks.filter((b:any)=>b.type==='figure').length+blocks.filter((b:any)=>b.type==='figure').length,videoCount:capture.blocks.filter((b:any)=>b.type==='video').length+blocks.filter((b:any)=>b.type==='video').length},blocks:[...capture.blocks,...(blocks.length?[...heading,...blocks]:[])]},mediaDiscovery:{checkedAt:result.checkedAt,extractorRevision:MEDIA_DISCOVERY_REVISION,added:blocks.length,...(verified.matched?{catalogueRevision:VERIFIED_PUBLIC_MEDIA_REVISION}:{}),receipts:[...previousReceipts,...result.receipts],attempts:[...previousAttempts,...result.attempts]}};
  const updated=await c.DB.prepare('UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS (SELECT 1 FROM rr_room_articles a WHERE a.page_id=education_pages.id AND a.room_id=?)').bind(JSON.stringify(document),input.id,before,room.id).run();
  const added=updated.meta?.changes?blocks.length:0;return json({added,message:added?'Matched public source media added.':blocks.length?'Another reader updated this edition. Reload to see its media.':mediaAvailabilityMessage(document)});
 }catch(error){if(error instanceof Response)return error;return json({error:'The media check is unavailable. The article remains readable.'},502);}
}
