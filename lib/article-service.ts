import {roomId,roomMemberId,DEFAULT_ROOM_ID} from './rooms.ts';
import {publicHTML,extractNewspaper,publisherFor} from './newspaper-core.mjs';
import {fetchVoxFeedCapture} from './vox-public-feed.mjs';
import {readerSession,randomToken,sameOrigin,grantEdition} from './edition-access.ts';
import {captureAPI} from './capture-service.ts';
import {isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';
import {resourceLookupAPI} from './resource-service.ts';
import {libraryServerConfigured,lookupNewsBankSource} from './library-server.ts';
import {libraryArticle} from './library-article-url.mjs';
import {buildLibraryCapture} from './library-capture.mjs';
import {addLibraryPreview} from './library-preview.mjs';
import {fetchPublisherPreview} from './library-transport.mjs';
import {roomMediaAPI} from './media-service.ts';
import {retainRoomMediaOnSavedCapture} from './reused-media.ts';
import {spendPressAuditStage} from './press-audit.ts';
import type {PressAuditAllowance} from './press-audit.ts';
import {reserveURLImportAttempt,reserveStudyImport,releaseStudyImport,rebindStudyImport,sourceRequestGuardResponse} from './import-allowance.ts';
import {createLibraryPageProof} from './library-page-proof.mjs';
import {assertRoomLibraryProof,bindRoomLibraryProof,claimRoomLibraryRecord,releaseRoomLibraryRecord,reuseVerifiedLibraryPage,verifiedLibraryPublisherLocator} from './library-page-index.ts';
import type {StudyImportReservation} from './import-allowance.ts';
import {attachObserverLibraryMedia} from './library-public-locator.ts';
import {isLibraryServiceBusyError,libraryServiceBusyResponse} from './library-service-busy.mjs';
import {selectedLibraryURL} from './library-url-selection.mjs';
const json=(data:unknown,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
export async function articleAPI(r:Request,c:Config,fetcher:typeof fetch=fetch,internal:{auditAllowance?:PressAuditAllowance}={}){
 let studyReservation:StudyImportReservation|undefined,libraryClaim:object|undefined,libraryProof:object|undefined,verifiedPublisherURL:string|undefined;
 if(roomId(r))c={...c,RR_ACTIVE_ROOM_ID:roomId(r)};
 if(r.method!=='POST')return json({error:'Use the article form.'},405);
 if(!sameOrigin(r))return json({error:'Use the RET article controls.'},403);
 let data:any;try{if(Number(r.headers.get('content-length'))>3_000_000)return json({error:'Use an HTML file smaller than 3 MB, or Page Lens.'},413);const rd=r.body?.getReader();if(!rd)return json({error:'Paste an article URL.'},400);let size=0,raw='';const decoder=new TextDecoder();try{for(;;){const x=await rd.read();if(x.done)break;size+=x.value.byteLength;if(size>3_000_000)return json({error:'Use an HTML file smaller than 3 MB, or Page Lens.'},413);raw+=decoder.decode(x.value,{stream:true});}raw+=decoder.decode();}finally{await rd.cancel();}data=JSON.parse(raw);}catch{return json({error:'The article request could not be read.'},400);}
 if(data.action==='session'){const existing=readerSession(r),token=existing||randomToken();return json({ready:Boolean(c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY']),reader:true},200,existing?{}:{'Set-Cookie':'ret_reader='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'});}
 if(!readerSession(r)&&!isOwner(r,c)&&!roomMemberId(r))return json({error:'Reload RET to start your private reader session. Allow cookies for this site.'},401);
 async function selectedLibraryRecovery(){
  if(data.html!==undefined||data.action||!roomId(r)||!/^[0-9a-f-]{36}$/i.test(data.requestId||''))return null;
  const publisher=selectedLibraryURL(data.url);if(!publisher||!await libraryServerConfigured(c))return null;
  return json({error:'Choose the matching Camden Library article.',needsLibrarySearch:true,libraryPublisher:publisher},422);
 }
 try{
  let p,libraryOnly=false;
  try{p=publisherFor(data.url);}catch(error){const recovery=await selectedLibraryRecovery();if(recovery)return recovery;let source;try{source=libraryArticle(data.url);}catch{throw error;}if(source.key!=='observer')throw error;p=source;libraryOnly=true;}
  if(libraryOnly&&data.html)return json({error:'This newspaper is available here through a matched Camden Library text edition. Paste its article link.'},422);
  const libraryRefresh=data.action==='library-refresh';
  if(libraryRefresh&&!isOwner(r,c))return json({error:'Only the room owner can refresh a library edition.'},403);
  if(!data.html&&!libraryRefresh){const lookup=await resourceLookupAPI(new Request(new URL('/api/resources/lookup',r.url),{method:'POST',headers:r.headers,body:JSON.stringify({url:p.url})}),c);if(lookup.ok){const found=await lookup.json() as any;if(found.found)return json({href:found.href,cached:true});}}
  if(!/^[0-9a-f-]{36}$/i.test(data.requestId||''))return json({error:'Reload the page and try again.'},400);
  // Reserve network fetches too, preventing anonymous URL import from becoming an unrestricted fetch service.
  const audit=await spendPressAuditStage(internal.auditAllowance,'article',c,p.url,data.requestId,r);
  if(!audit){
   const pending=await reserveStudyImport(r,c,p.url,data.requestId);if(pending.response)return pending.response;studyReservation=pending.reservation;
   if(typeof data.html!=='string'&&!await reserveURLImportAttempt(c)){await releaseStudyImport(studyReservation);studyReservation=undefined;return sourceRequestGuardResponse(c);}
  }
  let capture,publisherPreview,serverPreview;
  if(!data.html&&p.host==='vox.com')capture=await fetchVoxFeedCapture(p.url,fetcher);
  if(!data.html&&p.host==='telegraph.co.uk'&&c.RR_LIBRARY_AWS_FUNCTION&&await libraryServerConfigured(c)){
   try{serverPreview=await fetchPublisherPreview(c,p.url,fetcher);}
   catch(error){if(isLibraryServiceBusyError(error))throw error;serverPreview={status:'publisher-preview',state:'unavailable',sourceURL:p.url,title:'',date:'',checkedAt:new Date().toISOString(),blocks:[],receipts:[],httpStatus:null,reasonCode:'request_failed'};}
  }
  try{
   if(!capture){
   if(libraryOnly||libraryRefresh||serverPreview)throw Error('Use the matched library edition.');
   let source;if(typeof data.html==='string'){if(data.html.length>2_800_000)return json({error:'Use an HTML file smaller than 2.8 MB.'},413);source={html:data.html,url:p.url};}else source=await publicHTML(p.url,fetcher);
   if(!data.html)publisherPreview=source;
   capture=extractNewspaper(source.html,source.url,{method:data.html?'saved-html':'public-url'});
   }
  }catch(error){
   const recovery=await selectedLibraryRecovery();if(recovery)return recovery;
   if(data.html||!['thetimes.com','telegraph.co.uk','observer.co.uk'].includes(p.host))throw error;
   if(!await libraryServerConfigured(c))throw Error(isOwner(r,c)?'Connect Camden Library from the room menu, then try this article again.':'Ask this room’s owner to connect Camden Library, then try again.');
   const source=await lookupNewsBankSource(p.url,c,fetcher,data.sourceHeadline,serverPreview,{auditAllowance:internal.auditAllowance});
   if(roomId(r)&&!libraryRefresh){
    verifiedPublisherURL=verifiedLibraryPublisherLocator(source);
    // No metadata-only match can mint this proof: the complete verified document is required.
    try{libraryProof=await bindRoomLibraryProof(r,c,await createLibraryPageProof({publisher:libraryArticle(source.originalURL).key,article:{title:source.title,byline:source.byline,date:source.date,publication:source.publication,libraryURL:source.libraryURL,paragraphs:source.paragraphs}}),data.requestId,verifiedPublisherURL,source.originalURL);}catch(error){if(error instanceof Response)throw error;}
    if(libraryProof){
     if(studyReservation)await rebindStudyImport(studyReservation,r,c,data.requestId,(await assertRoomLibraryProof(r,c,libraryProof,data.requestId)).libraryURL);
     libraryClaim=await claimRoomLibraryRecord(r,c,libraryProof);
     const existing=await reuseVerifiedLibraryPage(r,c,libraryProof,verifiedPublisherURL);if(existing){
      // Only this branch deliberately skipped public prose retrieval before
      // fetching. A denied Times/Telegraph route never gets another attempt.
      if(libraryOnly&&p.key==='observer')try{await attachObserverLibraryMedia(r,c,{boundLibraryProof:libraryProof,requestId:data.requestId,pageId:existing.id,publicURL:p.url},fetcher);}catch(error){if(error instanceof Response&&(error.status===401||error.status===403))throw error;console.warn('RR_LIBRARY_PUBLIC_LOCATOR_UNAVAILABLE');}
      return json({id:existing.id,href:'/read/'+existing.id+'?room='+roomId(r),cached:true});
     }
    }
   }
   capture=addLibraryPreview(buildLibraryCapture(source),publisherPreview);
  }
  const headers=new Headers(r.headers);headers.delete('content-length');const create=new Request(new URL('/api/capture',r.url),{method:'POST',headers,body:JSON.stringify({capture,requestId:data.requestId})});
  const response=await captureAPI(create,c,fetcher,{auditAllowance:internal.auditAllowance,studyReservation,libraryProof,publisherURL:libraryProof?verifiedPublisherURL:undefined});
  if(response.ok&&capture.presentation?.method==='library-text'){
   const saved=await response.clone().json() as {id?:string};
   if(saved.id&&roomId(r)){
    try{await retainRoomMediaOnSavedCapture(c,saved.id);}catch{console.warn('RR_MEDIA_REUSE_UNAVAILABLE');}
    if(serverPreview){
     try{await roomMediaAPI(new Request(new URL('/api/room-media',r.url),{method:'POST',headers,body:JSON.stringify({id:saved.id})}),c,fetcher,{publisherPreview:serverPreview});}
     catch{console.warn('RR_AUTOMATIC_MEDIA_UNAVAILABLE');}
    }
   }
  }
  return response;
 }catch(e){if(e instanceof Response)return e;if(isLibraryServiceBusyError(e))return libraryServiceBusyResponse();const needsHeadline=Boolean(e&&typeof e==='object'&&'needsHeadline' in e&&e.needsHeadline===true);const message=e instanceof Error?e.message:'The source page could not be prepared.';const unavailableVox=!data.html&&typeof data.url==='string'&&/^https:\/\/(?:www\.)?vox\.com\//i.test(data.url)&&/marked as subscription-only/.test(message);return json({error:unavailableVox?'This Vox link has no readable public edition available here. Recent stories published in Vox’s public RSS feed can be imported; older or restricted web editions may be unavailable.':message,needsCapture:!needsHeadline,...(needsHeadline?{needsHeadline:true}:{})},422);}
 finally{if(libraryClaim)try{await releaseRoomLibraryRecord(libraryClaim);}catch{console.warn('RR_LIBRARY_IDENTITY_RELEASE_UNAVAILABLE');}if(studyReservation)try{await releaseStudyImport(studyReservation);}catch{console.warn('RR_STUDY_RESERVATION_RELEASE_UNAVAILABLE');}}
}
