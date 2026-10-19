import {roomId,DEFAULT_ROOM_ID,requireRoom} from './rooms.ts';
import {parseHTML} from 'linkedom';
import {runtimeLibraryClient,validatePublisherPreview} from './library-transport.mjs';
import {normalizeNewsBankDate} from './newsbank-http.mjs';
import {sealLibrary,openLibrary} from './library-vault.mjs';
import {timesURL,headline,terms,rankMatches} from '../extension-library/library-core.mjs';
import {publicHTML} from './newspaper-core.mjs';
import {libraryArticle} from './library-article-url.mjs';
import {providerCall,isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';
import {sameOrigin} from './edition-access.ts';
import {cleanPublisherHeadline} from './publisher-headline.mjs';
import {sanitizeMatchDiagnostic} from './newsbank-match-diagnostic.mjs';
import {spendPressAuditStage} from './press-audit.ts';
import type {PressAuditAllowance} from './press-audit.ts';
import {publicationSearchQuery,sanitizePublicationSearch,sanitizePublicationSearchStatus} from './newsbank-publications.mjs';
import {sanitizeNativeSources} from './newsbank-native-sources.mjs';
const now=()=>new Date().toISOString();
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function connectionId(c:Config){const id=typeof c.RR_ACTIVE_ROOM_ID==='string'?c.RR_ACTIVE_ROOM_ID:DEFAULT_ROOM_ID;return id===DEFAULT_ROOM_ID?'camden':'camden:'+id;}
type SavedAccount={libraryName:string,cardNumber:string,session:unknown};
async function stored(c:Config){return c.DB.prepare("SELECT encrypted,state,checked_at AS checkedAt,last_error AS lastError FROM rr_library_connections WHERE id=?").bind(connectionId(c)).first<any>();}
async function save(c:Config,account:SavedAccount,state='connected',error=''){
 const encrypted=await sealLibrary(c.RR_LIBRARY_VAULT_KEY,account);
 await c.DB.prepare("INSERT INTO rr_library_connections(id,encrypted,state,checked_at,last_error) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,state=excluded.state,checked_at=excluded.checked_at,last_error=excluded.last_error").bind(connectionId(c),encrypted,state,now(),error).run();
}
async function slot(c:Config,key:string,limit:number){return c.DB.prepare('INSERT INTO education_counters(key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n').bind(key+':'+now().slice(0,10),limit).first();}
function accountValue(raw:any):SavedAccount{if(!raw||typeof raw.libraryName!=='string'||raw.libraryName.length>160||typeof raw.cardNumber!=='string'||!raw.cardNumber.trim()||raw.cardNumber.length>200)throw Error('The saved library connection could not be read.');return raw;}
async function body(r:Request){if(!r.body)throw Error('Use the library connection form.');const reader=r.body.getReader();let size=0,text='';const dec=new TextDecoder();try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2048)throw Error('The library connection form is too large.');text+=dec.decode(x.value,{stream:true});}return JSON.parse(text+dec.decode());}finally{await reader.cancel();}}
export async function libraryServerConfigured(c:Config){return Boolean(c.RR_LIBRARY_VAULT_KEY&&await stored(c));}
// Called only after the room API verifies the requesting member and query quota.
// Credentials and session remain in the existing encrypted server connection.
export async function searchRoomLibraryMetadata(c:Config,input:{publisher:string,query:string},fetcher:typeof fetch=fetch){
 const row=await stored(c);if(!row||!c.RR_LIBRARY_VAULT_KEY)throw Error('Library connection unavailable.');
 const account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted)),client=runtimeLibraryClient(c,fetcher,account);
 if(account.session)client.restoreSession(account.session);
 if(typeof client.searchLibrary!=='function')throw Error('Library search is not ready.');
 let result=await client.searchLibrary(input);
 if(result.status==='login_required'){
  if(!await slot(c,'library-login:'+connectionId(c),10))throw Error('Library sign-in limit reached.');
  const auth=await client.login(account);if(auth.status!=='authenticated')throw Error('Library connection needs attention.');
  account.session=client.serializeSession();await save(c,account);result=await client.searchLibrary(input);
 }
 if(result.status==='library-search'){account.session=client.serializeSession();await save(c,account);}
 return result;
}
export async function fetchRoomLibraryRecord(c:Config,input:{publisher:string,libraryURL:string,title:string,date:string,publication:string},fetcher:typeof fetch=fetch){
 const row=await stored(c);if(!row||!c.RR_LIBRARY_VAULT_KEY)throw Error('Library connection unavailable.');
 const account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted)),client=runtimeLibraryClient(c,fetcher,account);
 if(account.session)client.restoreSession(account.session);
 if(typeof client.fetchLibraryRecord!=='function')throw Error('Library record selection is not ready.');
 let result=await client.fetchLibraryRecord(input);
 if(result.status==='login_required'){
  if(!await slot(c,'library-login:'+connectionId(c),10))throw Error('Library sign-in limit reached.');
  const auth=await client.login(account);if(auth.status!=='authenticated')throw Error('Library connection needs attention.');
  account.session=client.serializeSession();await save(c,account);result=await client.fetchLibraryRecord(input);
 }
 account.session=client.serializeSession();await save(c,account);return result;
}
export async function librarySettingsAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 if(roomId(r))c={...c,RR_ACTIVE_ROOM_ID:roomId(r)};
 let stage='access';
 try{
  if(!isOwner(r,c))return json({error:'Only the room owner can manage the library connection.'},403);
  if(r.method==='GET'){const row=await stored(c);return json({configured:Boolean(row),encryptionReady:Boolean(c.RR_LIBRARY_VAULT_KEY),state:row?.state||'not-connected',checkedAt:row?.checkedAt||null,message:row?.lastError||'',desktopRequired:false});}
  if(r.method!=='POST')return json({error:'Use the library connection controls.'},405);
  if(!sameOrigin(r))return json({error:'Use the same-origin library connection form.'},403);
  stage='form';const data=await body(r);
  if(data.action==='inspect-native-sources'){
   stage='native-sources';
   const room=await requireRoom(r,c);if(room.role!=='owner'||room.owner_id!==room.member_id)return json({error:'Only this room’s owner can inspect its library source lists.'},403);
   if(Object.keys(data).some(key=>key!=='action'))return json({error:'Use the fixed library source inspection control. It does not accept queries or URLs.'},400);
   const row=await stored(c);if(!row||!c.RR_LIBRARY_VAULT_KEY)return json({error:'Connect Camden in this room before inspecting source lists.'},409);
   const account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted));
   if(!account.session||!Array.isArray((account.session as any).cookies)||!(account.session as any).cookies.length)return json({error:'Reconnect Camden before inspecting source lists.'},409);
   const client=runtimeLibraryClient(c,fetcher,account);client.restoreSession(account.session);
   if(!await slot(c,'library-native-sources:'+connectionId(c),5))return json({error:'Today’s five library source-list inspections for this room have been used.'},429);
   let result=await client.inspectNativeSources();
   if(result.status==='login_required'){
    if(!await slot(c,'library-login:'+connectionId(c),10))return json({error:'Today’s library sign-in limit has been used.',status:'login_required',stage:'session',reasonCode:'session_expired'},429);
    const auth=await client.login(account);if(auth.status!=='authenticated')return json({status:auth.status==='needs_interaction'?'needs_interaction':'login_required',stage:'session',reasonCode:auth.status==='needs_interaction'?'entry_needs_interaction':'session_expired',reason:'The existing Camden connection needs attention. No article or publication browse page was opened.'});
    account.session=client.serializeSession();await save(c,account);result=await client.inspectNativeSources();
   }
   const current=await requireRoom(r,c);if(current.role!=='owner'||current.owner_id!==current.member_id)return json({error:'Owner access to this room is required.'},403);
   if(result.status==='native-sources'){const clean=sanitizeNativeSources(result);if(!clean)return json({error:'The native source metadata response was invalid.'},502);return json(clean);}
   const diagnostic=sanitizeNativeSources(result);if(!diagnostic||diagnostic.status==='native-sources')return json({error:'The native source inspection status was invalid.'},502);
   return json({...diagnostic,reason:'The ordinary NewsBank source controls need attention. No article or publication browse page was opened.'});
  }
  if(data.action==='search-publications'){
   stage='publication-metadata';
   const room=await requireRoom(r,c);if(room.role!=='owner'||room.owner_id!==room.member_id)return json({error:'Only this room’s owner can check library publication metadata.'},403);
   let query;try{if(Object.keys(data).some(key=>!['action','publication','title'].includes(key)))throw Error();query=publicationSearchQuery({publication:data.publication,title:data.title});}catch{return json({error:'Choose a supported publication and a bounded headline. This diagnostic does not accept URLs.'},400);}
   const row=await stored(c);if(!row||!c.RR_LIBRARY_VAULT_KEY)return json({error:'Connect Camden in this room before checking publication metadata.'},409);
   const account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted));
   if(!account.session||!Array.isArray((account.session as any).cookies)||!(account.session as any).cookies.length)return json({error:'Reconnect Camden before checking publication metadata.'},409);
   const client=runtimeLibraryClient(c,fetcher,account);client.restoreSession(account.session);
   if(!await slot(c,'library-publication-metadata:'+connectionId(c),48))return json({error:'Today’s 48 publication metadata checks for this room have been used.'},429);
   let result=await client.searchPublications(query);
   if(result.status==='login_required'){
    if(!await slot(c,'library-login:'+connectionId(c),10))return json({error:'Today’s library sign-in limit has been used.',status:'login_required',stage:'session',reasonCode:'session_expired'},429);
    const auth=await client.login(account);
    if(auth.status!=='authenticated')return json({status:auth.status==='needs_interaction'?'needs_interaction':'login_required',stage:'session',reasonCode:auth.status==='needs_interaction'?'entry_needs_interaction':'session_expired',reason:'The existing Camden connection needs attention. No article was opened or accepted.'});
    account.session=client.serializeSession();await save(c,account);
    result=await client.searchPublications(query);
   }
   if(result.status==='metadata'){const clean=sanitizePublicationSearch(result);if(!clean)return json({error:'The library metadata response was invalid.'},502);return json(clean);}
   const diagnostic=sanitizePublicationSearchStatus(result);if(!diagnostic)return json({error:'The library metadata status was invalid.'},502);
   const reasons={entry_needs_interaction:'NewsBank presented a browser check or interaction page.',session_expired:'The saved NewsBank session needs reconnecting.',form_missing:'The ordinary NewsBank search form was not present.',destination_changed:'The NewsBank search form destination or controls changed.',results_changed:'The returned page was not ordinary search results.',route_changed:'NewsBank redirected outside the permitted search routes.'};
   return json({...diagnostic,reason:reasons[diagnostic.reasonCode as keyof typeof reasons]+' No article was opened or accepted.'});
  }
  if(data.action==='check-match'){
   stage='match-check';
   const publisher=libraryArticle(data.url),title=usableTitle(data.title);
   if(!title||terms(title).length<3)return json({error:'Enter the article’s headline.'},400);
   const row=await stored(c);if(!row)return json({error:'Connect Camden before checking an article.'},409);
   if(!await slot(c,'library-match-check:'+connectionId(c),20))return json({error:'Today’s twenty owner match checks have been used.'},429);
   const account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted)),client=runtimeLibraryClient(c,fetcher,account);
   if(account.session)client.restoreSession(account.session);
   const date=publisher.key==='telegraph'?normalizeNewsBankDate(new URL(publisher.url).pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1]||''):'';
   const urlWords=new URL(publisher.url).pathname.split('/').filter(Boolean).at(-1)!.replaceAll('-',' ');
   const metadata={title,date,publisher:publisher.key,urlWordsHint:publisher.key==='telegraph'&&title.toLowerCase()===urlWords&&terms(urlWords).length>=5};let result=await client.lookup(metadata);
   if(result.status==='login_required'){
    if(!await slot(c,'library-login:'+connectionId(c),10))return json({error:'Today’s library sign-in limit has been used.'},429);
    const auth=await client.login(account);if(auth.status!=='authenticated')return json({error:'Reconnect Camden to check this article.'},409);
    result=await client.lookup(metadata);
   }
   account.session=client.serializeSession();await save(c,account,result.status==='not_found'||result.status==='found'?'connected':'needs-attention');
   if(result.status==='found')return json({status:'found',match:{title:String(result.article.title).slice(0,400),date:String(result.article.date).slice(0,100),publication:String(result.article.publication).slice(0,200),paragraphCount:result.article.paragraphs.length}});
   return json({status:result.status,reason:result.status==='not_found'?'No unambiguous library match was found.':'The library connection needs attention.',diagnostic:sanitizeMatchDiagnostic(result.diagnostic,{bibliography:true})});
  }
  if(data.action==='disconnect'){await c.DB.prepare("DELETE FROM rr_library_connections WHERE id=?").bind(connectionId(c)).run();return json({disconnected:true});}
  if(data.action!=='connect'||data.consent!==true)return json({error:'Review and confirm where your card will be used.'},400);
  if(!c.RR_LIBRARY_VAULT_KEY)return json({error:'The server encryption setting must be ready before connecting a card.'},503);
  const account=accountValue({libraryName:'CamdenLibraries',cardNumber:data.cardNumber?.trim(),session:null});
  stage='sign-in-limit';if(!await slot(c,'library-login:'+connectionId(c),10))return json({error:'Today’s ten library sign-in attempts have been used. Try tomorrow (UTC).'},429);
  stage='provider-sign-in';
  const client=runtimeLibraryClient(c,fetcher,account);const result=await client.login(account);
  if(result.status!=='authenticated')return json({error:result.reason||'NewsBank did not accept this sign-in. No new connection was saved.',state:result.status},422);
  stage='encrypted-storage';account.session=client.serializeSession();await save(c,account);return json({connected:true,desktopRequired:false});
 }catch(e){
  if(e instanceof Response)return e;
  const message=e instanceof Error?e.message:'';
  // Provider/client errors are fixed local messages, never response bodies,
  // form values, cookies or credential-bearing URLs.
  const safe=/^(?:NewsBank (?:returned|redirected|requested|did not|library)|The NewsBank (?:request|page)|The server encryption|The library connection form)/.test(message)?message:'';
  console.error('Reading Room library setup failed',JSON.stringify({stage,type:e instanceof Error?e.name:'unknown',message:safe||'Unclassified local error'}));
  return json({error:'The library connection could not be updated. '+(safe||'Try again or reconnect. Your card was not exposed.')},502);
 }
}
function usableTitle(raw:unknown){if(typeof raw!=='string')return '';const value=cleanPublisherHeadline(headline(raw.replace(/<[^>]*>/g,' '))).replace(/\s+[|–—-]\s+(?:The\s+)?(?:(?:Daily|Sunday)\s+)?Telegraph(?:\s+.*)?$/i,'').trim();return value.length>=15&&value.length<=400&&!/^(?:verifying|verify |just a moment|access (?:denied|issue|error)|sign.?in|subscribe|error|not found|payment required|robot check|enable javascript)/i.test(value)?value:'';}
function metadataIdentity(raw:unknown){try{return libraryArticle(String(raw)).url.replace(/\/$/,'');}catch{return '';}}
export function libraryMetadataQueries(raw:string){
 const publisher=libraryArticle(raw),url=new URL(publisher.url),slug=url.pathname.split('/').filter(Boolean).at(-1)!.replace(/-[a-z0-9]{9}$/i,publisher.key==='times'?'':'$&').replaceAll('-',' '),prefix='site:'+publisher.host+' ',available=128-prefix.length;
 const words=slug.split(/\s+/),date=url.pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1].replaceAll('/','-')||'';
 const fit=(phrase:string)=>{if(phrase.length<=available)return prefix+phrase;const head=phrase.slice(0,Math.floor(available/2)).replace(/\s+\S*$/,''),tail=phrase.slice(-(available-head.length-1)).replace(/^\S*\s+/,'');return prefix+head+' '+tail;};
 return [...new Set([fit(slug),fit([date,...words.slice(-6)].filter(Boolean).join(' '))])];
}
export async function timesMetadata(url:string,c:Config,fetcher:typeof fetch){return libraryMetadata(timesURL(url),c,fetcher);}
export async function libraryMetadata(url:string,c:Config,fetcher:typeof fetch,headlineHint='',publisherPreview?:unknown){
 const publisher=libraryArticle(url);url=publisher.url;const pathDate=publisher.key==='telegraph'?new URL(url).pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1].replaceAll('/','-')||'':'';const other=new URL(url);other.hostname='www.'+publisher.host;
 // The page title may be an AI synthesis. Only stored source metadata can
 // identify reporting; do not send an educational page's title to NewsBank.
 const saved=await c.DB.prepare(`SELECT
  json_extract(document,'$.kind') AS kind,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.url') ELSE json_extract(document,'$.source.originalURL') END AS sourceURL,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.title') ELSE json_extract(document,'$.source.title') END AS sourceTitle,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.date') ELSE json_extract(document,'$.source.date') END AS sourceDate,
  json_extract(document,'$.capture.diagnostics.readerHeadlineHint') AS readerHeadlineHint,
  json_extract(document,'$.capture.diagnostics.urlWordsHint') AS urlWordsHint,
  CASE WHEN json_extract(document,'$.kind')='library-study-v1' OR json_extract(document,'$.capture.presentation.method')='library-text' OR json_extract(document,'$.capture.diagnostics.libraryTextEdition')=1 THEN 1 ELSE 0 END AS libraryEdition,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.diagnostics.libraryURL') ELSE json_extract(document,'$.source.url') END AS libraryURL
  FROM education_pages p ${c.RR_ACTIVE_ROOM_ID?'JOIN rr_room_articles a ON a.page_id=p.id':''} WHERE source_url IN (?,?) ${c.RR_ACTIVE_ROOM_ID?'AND a.room_id=?':''} AND json_extract(document,'$.kind') IN ('rendered-capture-v1','library-study-v1') ORDER BY p.created_at DESC LIMIT 5`).bind(...(c.RR_ACTIVE_ROOM_ID?[url,other.href,c.RR_ACTIVE_ROOM_ID]:[url,other.href])).all();
 for(const source of (saved.results||[]) as any[]){
  try{
   if(metadataIdentity(source.sourceURL)!==metadataIdentity(url))continue;
   if(source.libraryEdition){const record=new URL(source.libraryURL);if(record.origin!=='https://infoweb.newsbank.com'||record.pathname!=='/apps/news/document-view'||record.searchParams.get('p')!=='UKNB'||!/^news\/[A-F0-9]+$/.test(record.searchParams.get('docref')||''))continue;}
   // NewsBank puts the standfirst after a spaced hyphen. Apply the same
   // headline boundary used for candidates, only to a verified library source.
   const title=usableTitle(source.libraryEdition&&typeof source.sourceTitle==='string'?source.sourceTitle.split(/\s+-\s+/)[0]:source.sourceTitle);
   if(title)return {title,date:source.urlWordsHint&&publisher.key==='telegraph'?pathDate:normalizeNewsBankDate(source.sourceDate),basis:source.urlWordsHint?'URL words; previously matched library record':source.readerHeadlineHint?'reader-supplied headline; previously matched library record':'previously matched edition'};
  }catch{/* Invalid stored source identity cannot replace publisher metadata. */}
 }
 const hint=typeof headlineHint==='string'&&headlineHint.length<=400&&!/[<>]|https?:\/\//i.test(headlineHint)?usableTitle(headlineHint):'';
 if(hint&&terms(hint).length>=3)return {title:hint,date:pathDate,basis:'reader-supplied headline; library match required'};
 let preview:any;
 if(publisher.key==='telegraph'&&publisherPreview!==undefined){try{preview=validatePublisherPreview(publisherPreview,url);}catch{/* Invalid prefetched metadata cannot identify an article. */}}
 const previewTitle=preview?.state==='available'?usableTitle(preview.title):'';
 if(previewTitle)return {title:previewTitle,date:normalizeNewsBankDate(preview.date)||pathDate,basis:'server public-preview headline'};
 if(!preview)try{const page=await publicHTML(url,fetcher);const {document:d}=parseHTML(page.html);const title=metadataIdentity(page.url)===metadataIdentity(url)&&(usableTitle(d.querySelector('h1')?.textContent)||usableTitle(d.querySelector('meta[property="og:title"]')?.getAttribute('content'))||usableTitle(d.title));if(title)return {title,date:d.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.slice(0,10)||pathDate,basis:'publisher headline'};}catch{/* A challenge or access error is never bypassed. Public search metadata can still identify the URL. */}
 const urlWords=new URL(url).pathname.split('/').filter(Boolean).at(-1)!.replaceAll('-',' ');
 // Observer has a library-only adapter. A substantial literal URL slug may
 // identify a search, but only strict same-publication library matching can
 // accept it. Do not send its page to a public-body capture adapter.
 if(publisher.key==='observer'&&urlWords.length<=240&&terms(urlWords).length>=5)return {title:urlWords,date:'',basis:'URL words; library match required'};
 const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'],attempts:string[]=[];
 if(typeof key==='string'&&key.trim()){
  // Metadata only: no fetched content/body is read, retained or sent to NewsBank.
  if(!preview)try{const result:any=await providerCall(key.trim(),'/v1/tools/fetch',{url},fetcher);const title=usableTitle(result?.title);
   if(metadataIdentity(result?.url)===metadataIdentity(url)&&title)return {title,date:pathDate,basis:'exact-URL public fetch headline'};
   attempts.push('public fetch did not return a usable title with the exact source URL');
  }catch{attempts.push('public metadata fetch unavailable');}
  for(const query of libraryMetadataQueries(url)){
   try{const result:any=await providerCall(key.trim(),'/v1/tools/search',{query,count:5,need_content:false},fetcher);
    for(const candidate of Array.isArray(result?.results)?result.results:[]){if(metadataIdentity(candidate?.url)===metadataIdentity(url)){const title=usableTitle(candidate?.title);if(title)return {title,date:pathDate,basis:'exact-URL public search headline'};}}
    attempts.push('public index returned no usable exact-URL title');
   }catch{attempts.push('public index unavailable');}
  }
 }else attempts.push('public metadata provider is not configured');
 // URL words are search hints, never an independently observed web headline.
 // A stricter title/date check is required after the library document is fetched.
 if(publisher.key==='telegraph'&&pathDate&&normalizeNewsBankDate(pathDate)&&urlWords.length<=240&&terms(urlWords).length>=5)return {title:urlWords,date:pathDate,basis:'URL words; library match required'};
 throw Object.assign(Error(publisher.name+' headline could not be verified for this URL. Supply the original headline for review. No library article was substituted.'),{code:'headline_unverified',needsHeadline:true,metadataAttempts:attempts});
}
export async function lookupNewsBankSource(rawURL:string,c:Config,fetcher:typeof fetch=fetch,headlineHint='',publisherPreview?:unknown,internal:{auditAllowance?:PressAuditAllowance}={}){
 const publisher=libraryArticle(rawURL),originalURL=publisher.url,row=await stored(c);if(!row)throw Error('The room owner has not connected Camden for server lookup yet.');
 if(row.state==='needs-attention'&&Date.now()-Date.parse(row.checkedAt)<90000)throw Error('The library connection needs the owner’s attention. Open Library connection.');
 if(!await spendPressAuditStage(internal.auditAllowance,'library',c,originalURL)&&!await slot(c,'library-lookup:'+connectionId(c),90))throw Error('Today’s separate protection limit of 90 library lookup requests has been reached. Failed requests count here; your study-edition allowance counts completed saves. Saved editions remain available. Resets at midnight UTC.');
 const metadata=await libraryMetadata(originalURL,c,fetcher,headlineHint,publisherPreview),meta={...metadata,publisher:publisher.key,urlWordsHint:metadata.basis.startsWith('URL words')},account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted));
 const client=runtimeLibraryClient(c,fetcher,account);if(account.session)client.restoreSession(account.session);
 let result=await client.lookup(meta);
 if(result.status==='login_required'){
  if(!await slot(c,'library-login:'+connectionId(c),10))throw Error('Today’s library sign-in limit has been used. Try tomorrow (UTC).');
  const auth=await client.login(account);if(auth.status!=='authenticated'){await save(c,account,'needs-attention',auth.reason||'Library sign-in needs attention.');throw Error('The library sign-in needs attention. The owner can reconnect from a phone.');}
  result=await client.lookup(meta);
 }
 account.session=client.serializeSession();
 if(result.status!=='found'){const error=result.reason||'No matching library article was found.';await save(c,account,result.status==='not_found'?'connected':'needs-attention',error);throw Object.assign(Error(error),metadata.basis.startsWith('URL words')&&result.status==='not_found'?{code:'headline_unverified',needsHeadline:true}:{});}
 const urlWordsHint=metadata.basis.startsWith('URL words');
 if(urlWordsHint){
  // Newspaper URL slugs omit apostrophes: “Cambridge’s” becomes “cambridges”.
  // Compare that punctuation loss without lowering the stricter score threshold.
  const urlText=(value:string)=>value.replace(/[’']/g,'');
  const score=rankMatches(urlText(meta.title),[{title:urlText(result.article.title),date:normalizeNewsBankDate(result.article.date)}],meta.date,{allowNextDayPublication:publisher.key==='telegraph'})[0]?.score||0;
  if(!normalizeNewsBankDate(result.article.date)||score<0.85){await save(c,account);throw Object.assign(Error('The URL words did not closely match the returned library headline and date. Paste the original newspaper headline to check it. No article was substituted.'),{code:'headline_unverified',needsHeadline:true});}
 }
 await save(c,account);
 return {...result.article,originalURL,originalTitle:meta.title,metadataBasis:metadata.basis,readerHeadlineHint:metadata.basis.startsWith('reader-supplied headline'),urlWordsHint};
}
