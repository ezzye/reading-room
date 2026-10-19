import {parseHTML} from 'linkedom/worker';
import {publisherFor} from './newspaper-core.mjs';
import {libraryArticle} from './library-article-url.mjs';
import {articleIdentity} from './article-media.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';

const MAX_BYTES=2_000_000,MAX_REQUESTS=3;
const locators=new WeakMap();
const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
// Only the actual public fetch below can create this capability. Parser output,
// saved HTML, JSON and client flags never establish a publisher/library locator.
export function publicLibraryLocatorMetadata(capability){return capability&&typeof capability==='object'?locators.get(capability)?.metadata||null:null;}
export function publicLibraryLocatorMedia(capability){return capability&&typeof capability==='object'?locators.get(capability)?.media||null:null;}
function attestPublicLocator(capture,descriptor,preview,checkedAt){
 const libraryURL=diagnosticDocumentURL(capture?.diagnostics?.libraryURL),actualLibraryTitle=typeof capture?.title==='string'?capture.title.normalize('NFC').replace(/\s+/gu,' ').trim():'';
 if(descriptor.key!=='observer'||preview.state!=='available'||!libraryURL||capture.diagnostics.libraryURL!==libraryURL||!actualLibraryTitle||actualLibraryTitle.length>600)return null;
 const capability=Object.freeze(Object.create(null)),metadata=Object.freeze({publicURL:descriptor.url,publisherKey:'observer',actualLibraryTitle,libraryURL,checkedAt,basis:'exact-library-article-public-head/v1'}),media=immutable(JSON.parse(JSON.stringify({blocks:preview.blocks,receipts:preview.receipts})));
 locators.set(capability,{metadata,media});return capability;
}
const clean=(value,max)=>String(value||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const headlineText=value=>clean(value,600).split(/\s+-\s+/)[0].replace(/\s+[|–—]\s+(?:The\s+)?(?:Observer|Times|Sunday Times|Telegraph)\b.*$/i,'');
const headline=value=>headlineText(value).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const titleStopWords=new Set(['a','an','the','and','or','of','on','in','at','to','for','from','by','as','is','are','was','were','with']);
const contentWords=value=>value.split(' ').filter(word=>/^\p{L}/u.test(word)&&!titleStopWords.has(word));
function observerTruncatedHeadlines(target,expected,pageTitles,ogTitles,twitterTitles,hasCanonical,hasOGURL){
 if(target.key!=='observer'||!hasCanonical||!hasOGURL||pageTitles.length!==1||!ogTitles.length||!twitterTitles.length)return false;
 const variants=[...pageTitles,...ogTitles,...twitterTitles],prefixes=[];
 for(const value of variants){const text=headlineText(value),match=text.match(/^([\s\S]*?\S)\s*(?:\.{3}|…)\s*$/);if(!match)return false;const prefix=headline(match[1]);if(prefix.length<35||contentWords(prefix).length<5||!expected.startsWith(prefix+' '))return false;prefixes.push(prefix);}
 if(new Set(prefixes).size!==1)return false;
 // The public head actually truncates every title for this Observer article.
 // Its complete canonical article slug must independently equal the complete
 // library headline; no short-prefix or fuzzy story substitution is allowed.
 const slug=new URL(target.url).pathname.split('/').filter(Boolean).at(-1)||'';
 return headline(slug.replaceAll('-',' '))===expected;
}

// Library publication registration does not register a public prose adapter.
// Existing public-profile media discovery retains its established route.
export function publicMediaDescriptor(raw){
 try{const paper=publisherFor(raw);return {name:paper.name,host:paper.host,url:paper.url,mode:'public-profile'};}
 catch(error){const paper=libraryArticle(raw);return {key:paper.key,name:paper.name,host:paper.host,url:paper.url,mode:'library-public-metadata'};}
}
function mediaReference(raw,base){
 try{const url=new URL(raw,base);if(!raw||url.href.length>2048||[...url.searchParams.keys()].some(key=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(key)))return '';return mediaURL(url.href);}catch{return '';}
}
function stableID(type,url){let hash=2166136261;for(const ch of type+':'+url)hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;return 'public-preview-'+type+'-'+hash.toString(16).padStart(8,'0');}
const refusal=(state,reasonCode)=>({state,reasonCode,blocks:[],receipts:[]});

/** Parse public head metadata only. No body prose, JSON state or body-media walk. */
export function libraryPublicPreview(capture,source){
 let target,actual;
 try{target=publicMediaDescriptor(capture?.url);actual=publicMediaDescriptor(source?.url);}catch{return refusal('unavailable','invalid_url');}
 if(target.mode!=='library-public-metadata'||actual.mode!==target.mode||articleIdentity(target.url)!==articleIdentity(actual.url))return refusal('unavailable','identity_mismatch');
 if(typeof source?.html!=='string'||!source.html||new TextEncoder().encode(source.html).byteLength>MAX_BYTES)return refusal('unavailable','invalid_source');
 const {document}=parseHTML(source.html),head=document.head;
 if(!head)return refusal('unavailable','identity_mismatch');
 const headNodes=selector=>[...head.querySelectorAll(selector)].filter(node=>node.parentElement===head);
 const pageTitles=headNodes('title').map(node=>clean(node.textContent,600)).filter(Boolean),pageTitle=pageTitles[0]||clean(document.title,400);
 if(/^(?:just a moment|attention required|access denied|security check|verify (?:that )?you are human)/i.test(pageTitle)||document.querySelector('form[action*="challenge"],form[id*="challenge"],iframe[src*="captcha"],[data-awswaf-token],[data-captcha]'))return refusal('blocked','challenge');
 const identities=headNodes('link[rel~="canonical"],meta[property="og:url"]');
 if(!identities.length)return refusal('unavailable','identity_mismatch');
 for(const node of identities){try{const raw=node.getAttribute(node.tagName==='LINK'?'href':'content');if(!raw?.trim())throw Error('missing');const identity=publicMediaDescriptor(new URL(raw,source.url).href);if(identity.mode!==target.mode||articleIdentity(identity.url)!==articleIdentity(target.url))return refusal('unavailable','identity_mismatch');}catch{return refusal('unavailable','identity_mismatch');}}
 const ogTitles=headNodes('meta[property="og:title"]').map(node=>node.getAttribute('content')||'').filter(Boolean),twitterTitles=headNodes('meta[name="twitter:title"]').map(node=>node.getAttribute('content')||'').filter(Boolean),titles=[...ogTitles,...twitterTitles],expected=headline(capture.title);
 const exactTitles=titles.length&&[...titles,...pageTitles].every(title=>headline(title)===expected),truncated=observerTruncatedHeadlines(target,expected,pageTitles,ogTitles,twitterTitles,headNodes('link[rel~="canonical"]').length>0,headNodes('meta[property="og:url"]').length>0);
 if(expected.length<15||!exactTitles&&!truncated)return refusal('unavailable','headline_mismatch');
 const blocks=[],receipts=[],seen=new Set((capture.blocks||[]).filter(block=>['figure','video'].includes(block.type)).map(block=>block.type==='video'?videoEmbed(block.url):mediaURL(block.url)));
 const add=(type,url,basis,caption)=>{if(!url||seen.has(url))return;seen.add(url);const id=stableID(type,url),provenance={sourceURL:target.url,basis,placement:'approximate',originalPlacementVerified:false};blocks.push({id,type,url,caption,credit:target.name+' · '+(type==='figure'?'public article preview thumbnail':'public article player reference')+' · Original position not verified',poster:'',aspectRatio:16/9,style:{},rect:{x:0,y:0,width:660,height:type==='figure'?370:371},...provenance});receipts.push({id,type,url,...provenance});};
 const alt=clean(headNodes('meta[property="og:image:alt"],meta[name="twitter:image:alt"]')[0]?.getAttribute('content'),400);
 for(const node of headNodes('meta[property="og:image"],meta[property="og:image:url"],meta[name="twitter:image"],meta[name="twitter:image:src"]')){const url=mediaReference(node.getAttribute('content'),source.url);if(url){add('figure',url,'exact-article-public-preview-thumbnail','Publisher public-preview thumbnail'+(alt?': '+alt:''));break;}}
 for(const node of headNodes('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player"]')){if(blocks.filter(block=>block.type==='video').length>=3)break;add('video',videoEmbed(mediaReference(node.getAttribute('content'),source.url)),'exact-article-public-player-metadata','Original public player reference; playback not confirmed');}
 return {state:'available',reasonCode:blocks.length?'public_metadata':'no_public_media',blocks,receipts};
}
async function discard(response){try{await response.body?.cancel();}catch{}}
async function boundedHTML(response){
 if(Number(response.headers.get('content-length'))>MAX_BYTES){await discard(response);throw Error('response_too_large');}
 if(!response.body)throw Error('empty_response');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_BYTES)throw Error('response_too_large');chunks.push(part.value);}}finally{try{await reader.cancel();}catch{}}
 if(!length)throw Error('empty_response');const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(data);
}

/** One ordinary public route; a denial/challenge has no alternate-source retry.
 * @returns {Promise<{blocks: ReturnType<typeof libraryPublicPreview>['blocks'], receipts: ReturnType<typeof libraryPublicPreview>['receipts'], attempts: Array<{sourceURL:string,state:string,sourceType:string,reasonCode:string,httpStatus:number|null,imageReferences:number,videoReferences:number}>, checkedAt:string, locatorAttestation?:object}>}
 */
export async function collectLibraryPublicMedia(capture,fetcher=globalThis.fetch,initial){
 const checkedAt=new Date().toISOString();let descriptor,httpStatus=null;
 const result=preview=>({blocks:preview.blocks,receipts:preview.receipts,attempts:[{sourceURL:descriptor?.url||'',state:preview.state==='available'?'checked':preview.state,sourceType:'library-public-metadata',reasonCode:preview.reasonCode,httpStatus,imageReferences:preview.blocks.filter(block=>block.type==='figure').length,videoReferences:preview.blocks.filter(block=>block.type==='video').length}],checkedAt});
 try{descriptor=publicMediaDescriptor(capture?.url);if(descriptor.mode!=='library-public-metadata')return result(refusal('unavailable','invalid_url'));}catch{return result(refusal('unavailable','invalid_url'));}
 if(initial)return result(libraryPublicPreview(capture,initial));
 let current=descriptor.url;
 try{for(let count=0;count<MAX_REQUESTS;count++){
  const response=await fetcher(current,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'ReadEveryThing/1.0 (public article reader)'},signal:AbortSignal.timeout(18_000)});httpStatus=response.status;
  if(httpStatus>=300&&httpStatus<400){const location=response.headers.get('location');await discard(response);if(!location)return result(refusal('blocked','redirect_mismatch'));let nextURL;try{nextURL=new URL(location,current);const next=publicMediaDescriptor(nextURL.href);if(next.mode!==descriptor.mode||articleIdentity(next.url)!==articleIdentity(descriptor.url))throw Error('mismatch');nextURL.search='';nextURL.hash='';}catch{return result(refusal('blocked','redirect_mismatch'));}if(count===MAX_REQUESTS-1)return result(refusal('unavailable','redirect_limit'));current=nextURL.href;continue;}
  if(!response.ok){await discard(response);return result(refusal('blocked','http_denied'));}
  if(!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){await discard(response);return result(refusal('unavailable','unsupported_content'));}
  const preview=libraryPublicPreview(capture,{url:current,html:await boundedHTML(response)}),collected=result(preview),capability=attestPublicLocator(capture,descriptor,preview,checkedAt);
  if(capability)Object.defineProperty(collected,'locatorAttestation',{value:capability,enumerable:false});
  return collected;
 }}catch(error){return result(refusal('unavailable',['response_too_large','empty_response'].includes(error?.message)?error.message:['AbortError','TimeoutError'].includes(error?.name)?'timed_out':'request_failed'));}
 return result(refusal('unavailable','redirect_limit'));
}
