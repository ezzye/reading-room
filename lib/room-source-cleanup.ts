import {parseHTML} from 'linkedom/worker';
import {extractNewspaper,publisherFor} from './newspaper-core.mjs';
import {requireRoom,accessiblePage} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {roomBody} from './room-articles.ts';
import type {Config} from './education-service.ts';
import {verifiedSourceCleanup} from './verified-source-cleanup.mjs';
import {proposeNPRSourceCleanup,nprCleanupIdentity,NPR_CLEANUP_REVISION,SourceCleanupFailure,sourceCleanupDiagnostic} from './npr-source-cleanup.mjs';

export const SOURCE_CLEANUP_REVISION=3;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const normalized=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
function identity(raw:unknown){try{const url=new URL(String(raw));if(url.protocol!=='https:'||!['express.co.uk','www.express.co.uk'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash||!/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d+\/[a-z0-9-]+\/?$/i.test(url.pathname))return '';return 'express.co.uk'+url.pathname.replace(/\/$/,'');}catch{return '';}}
const savedIdentity=(raw:unknown)=>identity(raw)||nprCleanupIdentity(raw);
const signature=(block:any)=>JSON.stringify([block.type,...['text','url','poster','caption','credit'].map(key=>normalized(block[key])),block.level||null]);
function proposedCleanup(document:any,html:string,url:string){
 const capture=document?.capture,target=identity(url);if(!target||identity(capture?.url)!==target||document.kind!=='rendered-capture-v1'||capture?.presentation?.method!=='public-url'||capture?.diagnostics?.libraryTextEdition||!Array.isArray(capture.blocks)||!Array.isArray(document.annotations))throw Error('unsupported');
 const profile=publisherFor(url);if(profile.host!=='express.co.uk'||profile.excludeSelector!=='.newsletter-pure'||Number(profile.extractorRevision)<3)throw Error('extractor');
 // The sole observed consent paragraph is inside this exact newsletter boundary.
 // Text alone never identifies article prose as disposable boilerplate.
 const {document:source}=parseHTML(html),containers=[...source.querySelectorAll('#singleArticle.single-article.article-body.regular > article#article-body .newsletter-pure')];
 if(containers.length!==1||containers[0].querySelectorAll('p').length!==1)throw Error('boundary');
 const paragraph=containers[0].querySelector(':scope > div.t.cc > p'),consent=normalized(paragraph?.textContent);
 if(!paragraph||consent.length!==263||!consent.startsWith('You agree you are 18 or over. We use your sign-up'))throw Error('boundary');
 for(const node of source.querySelectorAll('link[rel~="canonical"],meta[property="og:url"]')){const value=node.getAttribute(node.tagName==='LINK'?'href':'content');if(!value||identity(new URL(value,url).href)!==target)throw Error('identity');}
 const fresh=extractNewspaper(html,url);if(identity(fresh.url)!==target||!normalized(fresh.title)||normalized(fresh.title)!==normalized(capture.title))throw Error('identity');
 const removed=capture.blocks.filter((block:any)=>block.type==='paragraph'&&normalized(block.text)===consent);
 if(removed.length!==1||!removed[0].id||capture.blocks.some((block:any,index:number)=>!block.id||capture.blocks.findIndex((candidate:any)=>candidate.id===block.id)!==index))throw Error('boundary');
 const blocks=capture.blocks.filter((block:any)=>block!==removed[0]);
 // Compare every retained semantic block in order, including all media refs,
 // captions and headings. Retain original objects, IDs, layout and metadata.
 if(blocks.length!==fresh.blocks.length||blocks.some((block:any,index:number)=>signature(block)!==signature(fresh.blocks[index])))throw Error('changed');
 const removedIds=new Set(removed.map((block:any)=>block.id));
 return {blocks,removedIds,annotations:document.annotations.filter((annotation:any)=>!removedIds.has(annotation.blockId)),extractorRevision:Number(profile.extractorRevision)};
}
// One ordinary request, with at most one same-identity NPR canonical redirect.
// Denials and challenges have no alternate provider, account or other fallback.
async function publicSource(url:string,fetcher:typeof fetch){
 const requestOnce=async(address:string)=>{try{return await fetcher(address,{redirect:'manual',credentials:'omit',headers:{Accept:'text/html','User-Agent':'ReadEveryThing/1.0 (public article reader)'},signal:AbortSignal.timeout(18000)});}catch(error){throw new SourceCleanupFailure('public_request',error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'timeout':'network_unavailable');}};
 let response=await requestOnce(url);
 if(response.status>=300&&response.status<400){
  if(!nprCleanupIdentity(url))throw new SourceCleanupFailure('public_response','http_redirect',{httpStatus:response.status});
  const location=response.headers.get('Location');let next:URL|undefined;try{if(location&&location.length<=2048)next=new URL(location,url);}catch{}
  if(![301,302,303,307,308].includes(response.status)||!next||nprCleanupIdentity(next.href)!==nprCleanupIdentity(url)||next.pathname!==new URL(url).pathname)throw new SourceCleanupFailure('public_response','redirect_identity_mismatch',{httpStatus:response.status});
  try{await response.body?.cancel();}catch{}
  response=await requestOnce(next.href);
  if(response.status>=300&&response.status<400)throw new SourceCleanupFailure('public_response','http_redirect',{httpStatus:response.status});
 }
 if(!response.ok)throw new SourceCleanupFailure('public_response',[401,402,403].includes(response.status)?'http_denied':'http_error',{httpStatus:response.status});
 if(!/(?:text\/html|application\/xhtml)/i.test(response.headers.get('content-type')||''))throw new SourceCleanupFailure('public_response','unsupported_content_type');
 if(Number(response.headers.get('content-length'))>4_000_000)throw new SourceCleanupFailure('public_response','response_too_large');if(!response.body)throw new SourceCleanupFailure('public_response','empty_response');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4_000_000)throw new SourceCleanupFailure('public_response','response_too_large');chunks.push(part.value);}}catch(error){throw error instanceof SourceCleanupFailure?error:new SourceCleanupFailure('public_response','response_read_failed');}finally{try{await reader.cancel();}catch{}}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
function diagnosticMessage(diagnostic:ReturnType<typeof sourceCleanupDiagnostic>){
 const reason=diagnostic.reason,status='httpStatus' in diagnostic?` (HTTP ${diagnostic.httpStatus})`:'';
 const messages:Record<string,string>={http_redirect:'The publisher redirected beyond the permitted source check; no further request was made.',redirect_identity_mismatch:'The publisher redirect did not match this exact public article; it was not followed.',http_denied:'The publisher denied this public request.',http_error:'The publisher returned an unavailable response.',timeout:'The public request timed out.',network_unavailable:'The public request could not be completed.',unsupported_content_type:'The public response was not article HTML.',response_too_large:'The public response exceeded the reading limit.',empty_response:'The public response was empty.',response_read_failed:'The public response could not be read.',profile_revision_unavailable:'The required source cleanup profile is unavailable.',article_root_mismatch:'The public article boundary did not match.',canonical_mismatch:'The public article URL did not match.',headline_mismatch:'The public article headline did not match.',public_extraction_refused:'The public response did not pass the article eligibility checks.',related_card_boundary_mismatch:'The source related-card boundary could not be verified.',ambiguous_related_block:'A proposed related-card removal also matched retained reporting.',no_related_blocks_matched:'No saved related-card blocks matched the current source.',ambiguous_caption:'A source caption could not be associated uniquely.',retained_block_count_mismatch:'The number of retained source blocks did not match.',retained_text_mismatch:'Retained reporting text did not match.',retained_media_mismatch:'A retained image or video reference did not match.',retained_order_mismatch:'Retained source blocks were in a different order.'};
 return (messages[reason]||'The source cleanup comparison could not be verified.')+status+' Saved content was kept.';
}
export async function roomSourceCleanupAPI(request:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(request,c);if(room.role!=='owner'||room.owner_id!==room.member_id)return json({error:'Only this room’s owner can check source cleanup.'},403);
  if(request.method!=='POST')return json({error:'Use the source cleanup control.'},405);if(!sameOrigin(request))return json({error:'Use Reading Room to check source cleanup.'},403);
  let input;try{input=await roomBody(request,1000);}catch{return json({error:'Use the saved article cleanup control.'},400);}
  if(Object.keys(input).some(key=>key!=='id')||!/^[a-f0-9]{48}$/.test(input.id||''))return json({error:'Choose one saved article.'},400);
  if(!await accessiblePage(request,c,input.id))return json({error:'Article not found in this room.'},404);
  const row=await c.DB.prepare('SELECT source_url,document FROM education_pages WHERE id=?').bind(input.id).first<{source_url:string;document:string}>();if(!row)return json({error:'Article not found.'},404);
  const document=JSON.parse(row.document),capture=document.capture;
  if(!savedIdentity(row.source_url)||savedIdentity(capture?.url)!==savedIdentity(row.source_url)||document.kind!=='rendered-capture-v1'||capture?.presentation?.method!=='public-url'||capture?.diagnostics?.libraryTextEdition)return json({error:'This cleanup only checks existing public Express or NPR editions.'},409);
  const npr=Boolean(nprCleanupIdentity(capture.url));
  if(document.sourceCleanup?.revision<=SOURCE_CLEANUP_REVISION&&document.sourceCleanup?.status==='cleaned')return json({cached:true,removed:0,message:'This edition’s verified source cleanup is already saved.'});
  const verified=await verifiedSourceCleanup(capture,row.source_url);
  if(verified.known&&!verified.blockId)return json({error:'This edition does not match the verified newsletter snapshot. Saved content was kept; no publisher request was made.'},409);
  const key='source-cleanup:'+input.id+':'+new Date().toISOString().slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<2 RETURNING n').bind(key).first())return json({error:'Today’s two source cleanup checks for this edition have been used. Saved content was kept.'},429);
  let proposed:any;try{if(verified.blockId){if(!Array.isArray(document.annotations))throw Error();const removedIds=new Set([verified.blockId]);proposed={blocks:capture.blocks.filter((block:any)=>!removedIds.has(block.id)),removedIds,annotations:document.annotations.filter((annotation:any)=>!removedIds.has(annotation.blockId)),extractorRevision:3};}else{const html=await publicSource(capture.url,fetcher);proposed=npr?proposeNPRSourceCleanup(document,html,capture.url):proposedCleanup(document,html,capture.url);}}catch(error){const cleanupDiagnostic=sourceCleanupDiagnostic(error);return json({error:diagnosticMessage(cleanupDiagnostic),cleanupDiagnostic},409);}
  const receipt={revision:SOURCE_CLEANUP_REVISION,status:'cleaned',checkedAt:new Date().toISOString(),sourceURL:capture.url,extractorRevision:proposed.extractorRevision,basis:verified.blockId?'observed-snapshot-proof':proposed.basis||'exact-public-url-and-headline; exact-observed-newsletter-boundary-text; all-retained-blocks-and-media-matched-in-order',...(verified.proof?{proof:verified.proof,publisherRequested:false}:{}),...(npr?{nprRevision:NPR_CLEANUP_REVISION,updatedAttributionIds:proposed.updatedAttributionIds,unverifiedAttributionIds:proposed.unverifiedAttributionIds,relocatedCaptionIds:proposed.relocatedCaptionIds}:{}),removedBlockIds:[...proposed.removedIds],removedAnnotations:document.annotations.length-proposed.annotations.length};
  const next={...document,capture:{...capture,blocks:proposed.blocks},annotations:proposed.annotations,sourceCleanup:receipt};
  const result=await c.DB.prepare(`UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS
   (SELECT 1 FROM rr_room_articles a JOIN rr_room_members rm ON rm.room_id=a.room_id JOIN rr_members m ON m.id=rm.member_id JOIN rr_rooms r ON r.id=a.room_id
    WHERE a.page_id=education_pages.id AND a.room_id=? AND rm.member_id=? AND rm.role='owner' AND r.owner_id=rm.member_id AND rm.revoked_at IS NULL AND m.revoked_at IS NULL)`)
   .bind(JSON.stringify(next),input.id,row.document,room.id,room.member_id).run();
  if(!result.meta?.changes)return json({error:'This edition or room access changed. Reload before checking again.'},409);
  return json({removed:proposed.removedIds.size,removedAnnotations:receipt.removedAnnotations,...(npr?{updatedAttribution:proposed.updatedAttributionIds.length,relocatedCaptions:proposed.relocatedCaptionIds.length,unverifiedAttribution:proposed.unverifiedAttributionIds.length}:{}),href:'/read/'+input.id+'?room='+room.id,message:npr?`Verified related-card blocks were removed and ${proposed.relocatedCaptionIds.length} source captions were moved beside their exact photos. ${proposed.updatedAttributionIds.length} photo attributions were updated; ${proposed.unverifiedAttributionIds.length} were left unchanged. Reporting, retained IDs and discussion were kept.`:'The verified newsletter paragraph and its attached AI commentary were removed. All other saved content and discussion were kept.'});
 }catch(error){return error instanceof Response?error:json({error:'Source cleanup is unavailable. Saved content was kept.'},503);}
}
