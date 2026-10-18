import {parseHTML} from 'linkedom/worker';
import {libraryArticle} from '../lib/library-article-url.mjs';
import {articleIdentity,discoverArticleMedia} from '../lib/article-media.mjs';
import {normalizeNewsBankDate} from '../lib/newsbank-http.mjs';

const MAX_BYTES=2_000_000,MAX_OUTPUT_BYTES=30_000,MAX_REQUESTS=3;
const USER_AGENT='ReadEveryThing/1.0 (public article reader)';
const clean=(value,max)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const badStyle=style=>/display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|content-visibility\s*:\s*hidden|filter\s*:[^;]*blur\(/i.test(style);
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const PREVIEW_REASON_CODES=Object.freeze(['public_metadata','no_public_media','invalid_request','invalid_url','redirect_mismatch','redirect_limit','http_denied','challenge','unsupported_content','response_too_large','empty_response','identity_mismatch','headline_missing','timed_out','request_failed']);

function publicArticleURL(raw,base){
 if(typeof raw!=='string'||!raw.trim()||raw.length>2048)throw Error('invalid_url');
 const url=new URL(raw,base),article=libraryArticle(url.href);
 if(article.key!=='telegraph'||!normalizeNewsBankDate(url.pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1]||''))throw Error('invalid_url');
 // URL credentials and ports were rejected by libraryArticle. No query, hash,
 // session or tracking value is ever sent to the publisher or returned.
 url.search='';url.hash='';return {requestURL:url.href,sourceURL:article.url,identity:articleIdentity(article.url)};
}
const hidden=node=>{
 for(let parent=node;parent?.getAttribute;parent=parent.parentElement){
  if(parent.hasAttribute('hidden')||parent.getAttribute('aria-hidden')==='true'||badStyle(parent.getAttribute('style')||''))return true;
 }
 return false;
};
function visibility(document){
 const selectors=[];
 for(const style of document.querySelectorAll('style'))for(const match of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g)){
  if(badStyle(match[2]))selectors.push(...match[1].split(',').map(value=>value.trim()));
 }
 return node=>{
  if(hidden(node))return false;
  for(let parent=node;parent?.matches;parent=parent.parentElement)for(const selector of selectors){try{if(parent.matches(selector))return false;}catch{/* Unsupported CSS is not executed. */}}
  return true;
 };
}
function visibleText(node,visible){
 if(!node)return '';
 if(node.nodeType===3)return node.nodeValue||'';
 if(node.nodeType!==1||/^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK)$/.test(node.tagName)||!visible(node))return '';
 return [...node.childNodes].map(child=>visibleText(child,visible)).join(' ');
}
function challenged(document,visible){
 const text=visibleText(document.body,visible),title=clean(document.title,200);
 if(/^(?:just a moment|attention required|access denied|security check|verify (?:that )?you are human)/i.test(title)||/captcha|robot check|verify (?:that )?you are human|access denied|unusual traffic/i.test(text))return true;
 return [...document.querySelectorAll('form,iframe,input,[data-awswaf-token],[data-captcha]')].some(node=>{
  const tag=node.tagName,attributes=['id','class','name','src','action'].map(key=>node.getAttribute(key)||'').join(' ');
  return (tag==='FORM'&&/challenge|captcha/i.test(attributes))||(tag==='IFRAME'&&/captcha/i.test(attributes))||(tag==='INPUT'&&/captcha/i.test(attributes))||node.hasAttribute('data-awswaf-token')||node.hasAttribute('data-captcha');
 });
}
async function boundedHTML(response){
 if(Number(response.headers.get('content-length'))>MAX_BYTES){await discard(response);throw Error('response_too_large');}
 if(!response.body)throw Error('empty_response');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_BYTES)throw Error('response_too_large');chunks.push(part.value);}}
 finally{try{await reader.cancel();}catch{}}
 if(!length)throw Error('empty_response');
 const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder().decode(data);
}
async function discard(response){try{await response.body?.cancel();}catch{}}

/** A normal public request only. Library credentials and sessions are forbidden. */
export async function publisherPreview(event,{fetch:fetcher=globalThis.fetch}={}){
 const checkedAt=new Date().toISOString();let sourceURL='',title='',date='',httpStatus=null;
 const result=(state,reasonCode,blocks=[],receipts=[])=>{
  const value={status:'publisher-preview',state,sourceURL,title,date,checkedAt,blocks,receipts,httpStatus,reasonCode};
  // Long but otherwise safe CDN addresses cannot grow the synchronous result.
  while(bytes(value)>MAX_OUTPUT_BYTES&&value.blocks.length){value.blocks.pop();value.receipts.pop();}
  return value;
 };
 if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).length!==2||event.action!=='publisher-preview'||!Object.hasOwn(event,'url'))return result('unavailable','invalid_request');
 let current,target;
 try{current=publicArticleURL(event.url);sourceURL=current.sourceURL;target=current.identity;}catch{return result('unavailable','invalid_url');}
 if(typeof fetcher!=='function')return result('unavailable','request_failed');
 try{
  for(let count=0;count<MAX_REQUESTS;count++){
   const response=await fetcher(current.requestURL,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'text/html,application/xhtml+xml','User-Agent':USER_AGENT},signal:AbortSignal.timeout(18_000)});
   httpStatus=response.status;
   if(httpStatus>=300&&httpStatus<400){
    const location=response.headers.get('location');await discard(response);
    let next;try{next=publicArticleURL(location,current.requestURL);if(next.identity!==target)throw Error('mismatch');}catch{return result('blocked','redirect_mismatch');}
    if(count===MAX_REQUESTS-1)return result('unavailable','redirect_limit');
    current=next;continue;
   }
   if(!response.ok){await discard(response);return result('blocked','http_denied');}
   if(!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){await discard(response);return result('unavailable','unsupported_content');}
   const html=await boundedHTML(response),{document}=parseHTML(html),visible=visibility(document);
   if(challenged(document,visible))return result('blocked','challenge');
   const identities=[...document.querySelectorAll('link[rel~="canonical"],meta[property="og:url"]')];
   for(const node of identities){
    try{if(publicArticleURL(node.getAttribute(node.tagName==='LINK'?'href':'content')||'',current.requestURL).identity!==target)throw Error('mismatch');}
    catch{return result('unavailable','identity_mismatch');}
   }
   const h1=[...document.querySelectorAll('h1')].find(visible);
   title=clean(visibleText(h1,visible)||document.querySelector('meta[property="og:title"]')?.getAttribute('content'),400);
   if(title.length<15||/^(?:sign.?in|subscribe|error|not found|verifying|verify )/i.test(title)){title='';return result('unavailable','headline_missing');}
   date=normalizeNewsBankDate(document.querySelector('meta[property="article:published_time"],meta[name="date"]')?.getAttribute('content'))||normalizeNewsBankDate(new URL(sourceURL).pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1]||'');
   // Discovery accepts explicit visible media and OG/player metadata only. It
   // never reads JSON-LD articleBody, hidden state, source scripts or prose.
   const found=discoverArticleMedia({url:sourceURL,title,blocks:[]},[{url:current.requestURL,title,html,kind:'article'}]);
   const blocks=found.blocks.filter(block=>block.url.length<=2048&&(!block.poster||block.poster.length<=2048)).slice(0,6).map(block=>({...block,caption:clean(block.caption,500),credit:clean(block.credit,200),sourceURL}));
   const receipts=blocks.map(({id,type,url,basis,placement,originalPlacementVerified})=>({id,type,url,sourceURL,basis,placement,originalPlacementVerified}));
   return result('available',blocks.length?'public_metadata':'no_public_media',blocks,receipts);
  }
  return result('unavailable','redirect_limit');
 }catch(error){
  const reasonCode=['response_too_large','empty_response'].includes(error?.message)?error.message:['TimeoutError','AbortError'].includes(error?.name)?'timed_out':'request_failed';
  return result('unavailable',reasonCode);
 }
}
