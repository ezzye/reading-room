import {createNewsBankHTTPClient,normalizeNewsBankDate} from './newsbank-http.mjs';
import {openLibrary} from './library-vault.mjs';
import {publicationSearchQuery,sanitizePublicationSearch,sanitizePublicationSearchStatus} from './newsbank-publications.mjs';
import {librarySearchQuery,sanitizeLibrarySearch} from './library-search-contract.mjs';
import {libraryRecordRequest,validateLibraryRecordArticle} from './library-record-contract.mjs';
import {sanitizeNativeSources} from './newsbank-native-sources.mjs';
import {LibraryServiceBusyError} from './library-service-busy.mjs';
import {sanitizeSourceSearchInspection} from './newsbank-source-search.mjs';
const utf8=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(s)));
async function hmac(key,text){const k=await crypto.subtle.importKey('raw',typeof key==='string'?utf8.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,utf8.encode(text));}
export async function signLibraryInvocation({region,functionName,accessKeyId,secretAccessKey,payload,time=new Date()}){
 if(region!=='eu-west-1'||functionName!=='reading-room-library'||!/^AKIA[A-Z0-9]{16}$/.test(accessKeyId||'')||typeof secretAccessKey!=='string'||secretAccessKey.length<30)throw Error('The private library service is not configured correctly.');
 const host='lambda.'+region+'.amazonaws.com',path='/2015-03-31/functions/'+functionName+'/invocations',date=time.toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),hash=await digest(payload);
 const headers={'Content-Type':'application/json','Host':host,'X-Amz-Date':date,'X-Amz-Content-Sha256':hash};
 const signed='content-type;host;x-amz-content-sha256;x-amz-date',canonical=['POST',path,'','content-type:application/json\nhost:'+host+'\nx-amz-content-sha256:'+hash+'\nx-amz-date:'+date+'\n',signed,hash].join('\n');
 const scope=day+'/'+region+'/lambda/aws4_request',signing=await hmac(await hmac(await hmac(await hmac('AWS4'+secretAccessKey,day),region),'lambda'),'aws4_request');
 const signature=hex(await hmac(signing,'AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+await digest(canonical)));
 headers.Authorization='AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signed+', Signature='+signature;
 return {url:'https://'+host+path,headers};
}
async function jsonBounded(r){if(!r.body)throw Error('The private library service returned an empty response.');const rd=r.body.getReader();let size=0,text='';const dec=new TextDecoder();try{for(;;){const x=await rd.read();if(x.done)break;size+=x.value.length;if(size>100000)throw Error('The private library service response is too large.');text+=dec.decode(x.value,{stream:true});}return JSON.parse(text+dec.decode());}finally{await rd.cancel();}}
// AWS Invoke429 is rejected before Lambda accepts the invocation. Never retry
// accepted function errors, denials, server failures or ambiguous network errors.
export async function throttledLibraryInvocation(send,{wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)),now=()=>performance.now(),random=Math.random,executionTimeoutMs=95000}={}){
 const delays=[1000,2000,4000,6000,7000],started=now(),executionLimit=Math.max(1,Math.min(95000,executionTimeoutMs));let waited=0;
 const elapsed=()=>Math.max(0,waited,now()-started);
 for(let attempt=0;;attempt++){
  // Admission may wait20s. Each accepted execution retains its previous time
  // allowance; the private request remains bounded to115s in total.
  if(attempt&&elapsed()>20000)throw new LibraryServiceBusyError();
  const response=await send(AbortSignal.timeout(Math.max(1,Math.min(executionLimit,20000+executionLimit-elapsed()))));
  if(response.status!==429||response.headers.has('x-amz-function-error'))return response;
  try{await response.body?.cancel();}catch{}
  const remaining=20000-elapsed();if(attempt>=delays.length||remaining<=0)throw new LibraryServiceBusyError();
  const sample=random(),jitter=Number.isFinite(sample)?Math.max(0,Math.min(1,sample)):1,delay=Math.min(remaining,Math.round(delays[attempt]*(.8+.2*jitter)));
  await wait(delay);waited+=delay;
 }
}
/** @param {Record<string, any>} config
 * @param {typeof fetch} fetcher
 * @param {{libraryName:string,cardNumber:string}|null} credentials
 * @param {{wait?:(milliseconds:number)=>Promise<void>,now?:()=>number,random?:()=>number}} admission */
export function runtimeLibraryClient(config,fetcher=globalThis.fetch,credentials=null,admission={}){
 if(!config.RR_LIBRARY_AWS_FUNCTION)return createNewsBankHTTPClient({fetch:fetcher});
 let session=null,account=credentials;
 function restoreSession(value){const check=createNewsBankHTTPClient({fetch:fetcher});check.restoreSession(value);session=check.serializeSession();}
 async function invoke(action,input={}){
  const payload=JSON.stringify({action,...input,session});if(utf8.encode(payload).length>30000)throw Error('The private library request is too large.');
  const invoker=config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED?await openLibrary(config.RR_LIBRARY_VAULT_KEY,config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED,'aws-library-invoker-v1'):{accessKeyId:config.RR_LIBRARY_AWS_ACCESS_KEY_ID,secretAccessKey:config.RR_LIBRARY_AWS_SECRET_ACCESS_KEY};
  const signed=await signLibraryInvocation({region:config.RR_LIBRARY_AWS_REGION,functionName:config.RR_LIBRARY_AWS_FUNCTION,accessKeyId:invoker.accessKeyId,secretAccessKey:invoker.secretAccessKey,payload});
  const invocation={method:'POST',headers:signed.headers,body:payload,redirect:'manual'};
  const r=await throttledLibraryInvocation(signal=>fetcher(signed.url,{...invocation,signal}),admission);
  if(!r.ok||r.headers.has('x-amz-function-error'))throw Error('The private library service is unavailable (HTTP '+r.status+').');
  const value=await jsonBounded(r);
  if(action==='inspect-native-sources'||action==='inspect-source-search'){
   if(value.status==='blocked'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)throw Error('NewsBank returned HTTP '+value.httpStatus+'.');
   const clean=action==='inspect-source-search'?sanitizeSourceSearchInspection(value):sanitizeNativeSources(value);if(!clean)throw Error('The native library metadata response was invalid.');return clean;
  }
  if(action==='search-publications'||action==='library-search'){
   if(value.status==='blocked'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)throw Error('NewsBank returned HTTP '+value.httpStatus+'.');
   if(['login_required','needs_interaction'].includes(value.status)){const diagnostic=sanitizePublicationSearchStatus(value);if(!diagnostic)throw Error('The private library metadata status was invalid.');return diagnostic;}
   const clean=action==='library-search'?sanitizeLibrarySearch(value):sanitizePublicationSearch(value);if(!clean||action==='library-search'&&JSON.stringify(clean.requested)!==JSON.stringify(input))throw Error('The private library metadata response was invalid.');return clean;
  }
  if(action==='library-record'){
   if(value.status==='blocked'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)throw Error('NewsBank returned HTTP '+value.httpStatus+'.');
   if(value.status==='found'){const article=validateLibraryRecordArticle(value.article,input,normalizeNewsBankDate);if(value.session)restoreSession(value.session);return {status:'found',article};}
   if(['login_required','needs_interaction'].includes(value.status))return {status:value.status};
   if(value.status==='not_found'&&value.reasonCode==='record_mismatch')return {status:'not_found',reasonCode:'record_mismatch'};
   throw Error('The selected library record response was invalid.');
  }
  if(value.session)restoreSession(value.session);
  if(value.status==='blocked'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)throw Error('NewsBank returned HTTP '+value.httpStatus+'.');
  if(!['authenticated','found','rejected','login_required','needs_interaction','not_found','error','available'].includes(value.status))throw Error('The private library service returned an unrecognised result.');
  if(value.status==='error')throw Error('The private library service could not complete the request.');
  return value;
 }
 return {restoreSession,serializeSession:()=>session,
  async login(value){account=value;return invoke('connect',{libraryName:value.libraryName,cardNumber:value.cardNumber});},
  async searchPublications(input){return invoke('search-publications',publicationSearchQuery(input));},
  async searchLibrary(input){return invoke('library-search',librarySearchQuery(input));},
  async fetchLibraryRecord(input){return invoke('library-record',libraryRecordRequest(input));},
  async inspectNativeSources(){return invoke('inspect-native-sources');},
  async inspectSourceSearch(){return invoke('inspect-source-search');},
  async lookup(meta){return invoke('lookup',{...meta,...(account?{libraryName:account.libraryName,cardNumber:account.cardNumber}:{})});}
 };
}

// Public metadata only. This action deliberately never uses the account/session
// wrapper above: a newspaper URL is the entire Lambda request payload.
import {sourceURL} from './education-core.mjs';
import {libraryArticle} from './library-article-url.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
export const PUBLISHER_PREVIEW_REASON_CODES=Object.freeze(['public_metadata','no_public_media','invalid_request','invalid_url','redirect_mismatch','redirect_limit','http_denied','challenge','unsupported_content','response_too_large','empty_response','identity_mismatch','headline_missing','timed_out','request_failed']);
const previewBases=new Set(['exact-article-visible-media','exact-article-public-metadata','exact-article-public-content-link']);
function previewArticle(raw){const safe=sourceURL(raw),input=new URL(safe);if([...input.searchParams.keys()].some(k=>/signature|credential|expires|policy|key/i.test(k)))throw Error('Use an ordinary public Telegraph article URL.');const article=libraryArticle(safe);if(article.key!=='telegraph')throw Error('Publisher preview supports ordinary Telegraph article URLs only.');return sourceURL(article.url);}
const previewText=(value,max)=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
function previewMedia(raw){if(typeof raw!=='string'||raw.length>2048)return '';try{const u=new URL(raw);if(u.hostname.includes(':')||[...u.searchParams.keys()].some(k=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k)))return '';return mediaURL(raw);}catch{return '';}}
function previewID(type,url){let hash=2166136261;for(const ch of type+':'+url)hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;return 'media-'+type+'-'+hash.toString(16).padStart(8,'0');}
export function validatePublisherPreview(value,url){
 const target=previewArticle(url),invalid=()=>{throw Error('The publisher preview response was invalid.');};
 if(!value||value.status!=='publisher-preview'||!['available','blocked','unavailable'].includes(value.state)||['html','content','body','text','session','account','cardNumber','cookies'].some(k=>Object.hasOwn(value,k)))return invalid();
 if(previewArticle(value.sourceURL)!==target||typeof value.title!=='string'||value.title.length>400||typeof value.date!=='string'||value.date&&!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))||!Array.isArray(value.blocks)||value.blocks.length>6||!Array.isArray(value.receipts)||value.receipts.length>6||!(value.httpStatus===null||Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)||!PUBLISHER_PREVIEW_REASON_CODES.includes(value.reasonCode))return invalid();
 if(value.state!=='available'&&(value.blocks.length||value.receipts.length))return invalid();
 const seen=new Set(),blocks=[];let images=0,videos=0;
 for(const b of value.blocks){
  if(!b||!['figure','video'].includes(b.type)||b.text||b.html||b.body||!previewBases.has(b.basis)||previewArticle(b.sourceURL)!==target||b.placement!=='approximate'||b.originalPlacementVerified!==false||typeof b.caption!=='string'||b.caption.length>500||typeof b.credit!=='string'||b.credit.length>200)return invalid();
  const safe=previewMedia(b.url),media=b.type==='video'?videoEmbed(safe):safe,poster=b.poster?previewMedia(b.poster):'';if(!media||b.poster&&!poster)return invalid();
  if(b.type==='figure'?++images>6:++videos>3)return invalid();if(seen.has(media))return invalid();seen.add(media);
  const receipt=value.receipts.find(r=>r?.id===b.id&&r.type===b.type&&r.url===b.url);if(!receipt||previewArticle(receipt.sourceURL)!==target||receipt.basis!==b.basis||receipt.placement!=='approximate'||receipt.originalPlacementVerified!==false)return invalid();
  blocks.push({id:previewID(b.type,media),type:b.type,url:media,caption:previewText(b.caption,500),credit:previewText(b.credit,200),poster,aspectRatio:16/9,style:{},rect:{x:0,y:0,width:660,height:b.type==='figure'?440:371},sourceURL:target,basis:b.basis,placement:'approximate',originalPlacementVerified:false});
 }
 if(value.receipts.length!==blocks.length)return invalid();
 return {status:'publisher-preview',state:value.state,sourceURL:target,title:previewText(value.title,400),date:value.date,checkedAt:value.checkedAt,blocks,receipts:blocks.map(({id,type,url,sourceURL,basis,placement,originalPlacementVerified})=>({id,type,url,sourceURL,basis,placement,originalPlacementVerified})),httpStatus:value.httpStatus,reasonCode:value.reasonCode};
}
/** Invoke the existing signed private service with no library account or cookies. */
export async function fetchPublisherPreview(config,url,fetcher=globalThis.fetch){
 const target=previewArticle(url),payload=JSON.stringify({action:'publisher-preview',url:target});
 const invoker=config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED?await openLibrary(config.RR_LIBRARY_VAULT_KEY,config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED,'aws-library-invoker-v1'):{accessKeyId:config.RR_LIBRARY_AWS_ACCESS_KEY_ID,secretAccessKey:config.RR_LIBRARY_AWS_SECRET_ACCESS_KEY};
 const signed=await signLibraryInvocation({region:config.RR_LIBRARY_AWS_REGION,functionName:config.RR_LIBRARY_AWS_FUNCTION,accessKeyId:invoker.accessKeyId,secretAccessKey:invoker.secretAccessKey,payload});
 const invocation={method:'POST',headers:signed.headers,body:payload,credentials:'omit',redirect:'manual'};
 const response=await throttledLibraryInvocation(signal=>fetcher(signed.url,{...invocation,signal}),{executionTimeoutMs:45000});
 if(!response.ok||response.headers.has('x-amz-function-error'))throw Error('The public publisher preview service is unavailable.');
 return validatePublisherPreview(await jsonBounded(response),target);
}
