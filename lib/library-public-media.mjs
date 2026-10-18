import {parseHTML} from 'linkedom/worker';
import {publisherFor} from './newspaper-core.mjs';
import {libraryArticle} from './library-article-url.mjs';
import {articleIdentity} from './article-media.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';

const MAX_BYTES=2_000_000,MAX_REQUESTS=3;
const clean=(value,max)=>String(value||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const headline=value=>clean(value,600).split(/\s+-\s+/)[0].replace(/\s+[|–—]\s+(?:The\s+)?(?:Observer|Times|Sunday Times|Telegraph)\b.*$/i,'').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

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
 const pageTitle=clean(document.title,400);
 if(/^(?:just a moment|attention required|access denied|security check|verify (?:that )?you are human)/i.test(pageTitle)||document.querySelector('form[action*="challenge"],form[id*="challenge"],iframe[src*="captcha"],[data-awswaf-token],[data-captcha]'))return refusal('blocked','challenge');
 const identities=headNodes('link[rel~="canonical"],meta[property="og:url"]');
 if(!identities.length)return refusal('unavailable','identity_mismatch');
 for(const node of identities){try{const raw=node.getAttribute(node.tagName==='LINK'?'href':'content');if(!raw?.trim())throw Error('missing');const identity=publicMediaDescriptor(new URL(raw,source.url).href);if(identity.mode!==target.mode||articleIdentity(identity.url)!==articleIdentity(target.url))return refusal('unavailable','identity_mismatch');}catch{return refusal('unavailable','identity_mismatch');}}
 const titles=headNodes('meta[property="og:title"],meta[name="twitter:title"]').map(node=>node.getAttribute('content')||'').filter(Boolean),expected=headline(capture.title);
 if(expected.length<15||!titles.length||titles.some(title=>headline(title)!==expected))return refusal('unavailable','headline_mismatch');
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

/** One ordinary public route; a denial/challenge has no alternate-source retry. */
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
  return result(libraryPublicPreview(capture,{url:current,html:await boundedHTML(response)}));
 }}catch(error){return result(refusal('unavailable',['response_too_large','empty_response'].includes(error?.message)?error.message:['AbortError','TimeoutError'].includes(error?.name)?'timed_out':'request_failed'));}
 return result(refusal('unavailable','redirect_limit'));
}
