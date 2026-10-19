const SCHEMA='newsbank-source-list-structure/v1';
const SCRIPT_URL_LIMIT=24;
const hint=/source|list|catalog(?:ue)?|publication|browse/i;
const privateWords=/private|user|account|saved|alert|folder|login|logout|password|passcode|borrower|cookie|session|credential|secret|token|card|email|csrf|nonce|signature/i;
const opaque=/[a-f0-9]{12,}|[a-z0-9_-]{32,}|\d{6,}/i;
const token=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/i.test(value)&&!privateWords.test(value)&&!opaque.test(value)?value:'';
const identifier=value=>token(value)&&(hint.test(value)||/search|filter|sort|table|grid|letter|page|^query$/i.test(value))?value:'';
const classes=value=>(Array.isArray(value)?value:[]).map(token).filter(value=>value&&(hint.test(value)||/^(?:container|wrapper|row|col|clearfix|view|views|js)(?:[-_]|$)/i.test(value))).slice(0,8);
const tags=new Set(['div','section','nav','ul','ol','table','thead','tbody','tr','dl','fieldset','span']);
const count=(value,max=10000)=>Number.isInteger(value)&&value>=0?Math.min(value,max):0;
const label=value=>typeof value==='string'&&value.length<=100&&/^[a-z -]+$/i.test(value)&&value.trim().split(/[ -]+/).every(word=>/^(?:sources?|publications?|names?|filter|search|browse|catalogue|catalog|find|by|all|types?|titles?|sort|order|ascending|descending|country|countries|regions?|languages?|formats?|dates?|from|to|show|per|page|rows|go|apply|clear|reset|select|choose|letter|starts|with)$/i.test(word))?value.replace(/\s+/g,' ').trim():'';
const attrs=new Set(['data-ajax-url','data-source-url','data-sources-url','data-source-list-url','data-catalog-url','data-catalogue-url','data-endpoint']);
const exact=raw=>{try{const u=new URL(raw);return u.origin==='https://infoweb.newsbank.com'&&!u.username&&!u.password&&!u.hash&&u.pathname==='/apps/news/source-list'&&[...u.searchParams].length===1&&u.searchParams.get('p')==='UKNB';}catch{return false;}};
const scriptReasons=['sameOriginAccepted','externalOrigin','nonStaticPath','unsafeQuery','sensitivePath','invalidReference','hiddenOrExcluded'];
function scriptDecision(raw,base){
 if(typeof raw!=='string'||!raw||raw.length>2000||/[\u0000-\u0020\u007f]/.test(raw))return {reason:'invalidReference',url:''};
 let u;try{u=new URL(raw,base);}catch{return {reason:'invalidReference',url:''};}
 if(u.origin!=='https://infoweb.newsbank.com')return {reason:'externalOrigin',url:''};
 if(u.username||u.password||u.hash||u.href.length>1500)return {reason:'invalidReference',url:''};
 if(!/^\/[a-z0-9_./-]+\.js$/i.test(u.pathname))return {reason:'nonStaticPath',url:''};
 if(privateWords.test(u.pathname))return {reason:'sensitivePath',url:''};
 for(const [key,value]of u.searchParams)if(!(/^(?:v|ver|version)$/.test(key)&&/^\d{1,8}(?:[._-]\d{1,4}){0,3}$/.test(value)||/^(?:lang|language|locale)$/.test(key)&&/^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(value)))return {reason:'unsafeQuery',url:''};
 return {reason:'sameOriginAccepted',url:u.href};
}
const scriptURL=(raw,base)=>scriptDecision(raw,base).url;
function staticAssetPath(raw,base){
 if(scriptDecision(raw,base).reason!=='unsafeQuery')return null;
 const url=new URL(raw,base),queryKeyClasses={version:0,locale:0,other:0};
 for(const [key]of url.searchParams)queryKeyClasses[/^(?:v|ver|version)$/.test(key)?'version':/^(?:lang|language|locale)$/.test(key)?'locale':'other']++;
 url.search='';return {url:url.href,queryOmitted:true,queryKeyClasses};
}
function cleanStaticAssetPath(raw){
 if(raw?.queryOmitted!==true||typeof raw.url!=='string'||scriptURL(raw.url)!==raw.url)return null;
 const url=new URL(raw.url);if(url.search)return null;
 const queryKeyClasses={};for(const key of ['version','locale','other']){const value=raw.queryKeyClasses?.[key];if(!Number.isInteger(value)||value<0||value>1000)return null;queryKeyClasses[key]=value;}
 const total=Object.values(queryKeyClasses).reduce((a,b)=>a+b,0);return total>0&&total<=1000?{url:url.href,queryOmitted:true,queryKeyClasses}:null;
}

function scriptObservations(raw){if(!raw||!Number.isInteger(raw.total)||raw.total<0||!Number.isInteger(raw.inspected)||raw.inspected<0||raw.inspected>120||raw.inspected>raw.total)return null;const reasons={};for(const key of scriptReasons){const value=raw.reasons?.[key];if(!Number.isInteger(value)||value<0||value>120)return null;reasons[key]=value;}if(Object.values(reasons).reduce((a,b)=>a+b,0)!==raw.inspected)return null;return {total:Math.min(raw.total,10000),inspected:raw.inspected,reasons,truncated:raw.total>raw.inspected};}
function visibility(document){const hidden=[];for(const style of document.querySelectorAll('style'))for(const rule of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g))if(/display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|content-visibility\s*:\s*hidden/i.test(rule[2]))hidden.push(...rule[1].split(',').map(x=>x.trim()));return node=>{for(let p=node;p?.getAttribute;p=p.parentElement){if(p.matches('script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|content-visibility\s*:\s*hidden/i.test(p.getAttribute('style')||''))return false;for(const selector of hidden)try{if(p.matches(selector))return false;}catch{}}return true;};}
function context(node){for(let p=node;p?.getAttribute;p=p.parentElement){if(p.matches('form,article,.document-view__body--ascii,.search-hits__hit,[id^="search-hits__hit--"]'))return false;if(!p.matches('html,body')&&privateWords.test([p.id,p.getAttribute('class'),p.getAttribute('name')].join(' ')))return false;}return true;}
export function sanitizeSourceListStructure(raw,nativeURL){
 if(!raw||raw.schema!==SCHEMA||raw.visibilityBasis!=='markup-only'||['body','html','content','paragraphs','values','cookies','account','cardNumber','session','inlineJS'].some(key=>Object.hasOwn(raw,key)))return null;
 const containers=(Array.isArray(raw.containers)?raw.containers:[]).slice(0,30).flatMap(row=>{const id=identifier(row?.id),cl=classes(row?.classes);return tags.has(row?.tag)&&(hint.test(id)||cl.some(value=>hint.test(value)))?[{tag:row.tag,id,classes:cl,childElements:count(row.childElements),descendantElements:count(row.descendantElements),tables:count(row.tables),rows:count(row.rows)}]:[];});
 const controls=(Array.isArray(raw.controls)?raw.controls:[]).slice(0,20).flatMap(row=>{const name=identifier(row?.name),id=identifier(row?.id),text=label(row?.label);return ['input','select','textarea','button'].includes(row?.tag)&&['text','search','select-one','select-multiple','textarea','button','submit','checkbox','radio'].includes(row?.type)&&(name||id||text)?[{tag:row.tag,type:row.type,name,id,label:text}]:[];});
 const observedScripts=raw.scriptObservations===undefined?null:scriptObservations(raw.scriptObservations);if(raw.scriptObservations!==undefined&&!observedScripts)return null;
 const scriptURLs=[...new Set((Array.isArray(raw.scriptURLs)?raw.scriptURLs:[]).slice(0,SCRIPT_URL_LIMIT).map(value=>scriptURL(value)).filter(Boolean))];
 const staticAssetPaths=raw.staticAssetPaths===undefined?null:[...new Map((Array.isArray(raw.staticAssetPaths)?raw.staticAssetPaths:[]).slice(0,SCRIPT_URL_LIMIT).map(cleanStaticAssetPath).filter(Boolean).map(item=>[item.url,item])).values()];
 const endpoints=(Array.isArray(raw.endpoints)?raw.endpoints:[]).slice(0,12).flatMap(row=>{const url=attrs.has(row?.attribute)?nativeURL(row.url):'';return url&&!privateWords.test(new URL(url).pathname)?[{attribute:row.attribute,url}]:[];});
 return {schema:SCHEMA,visibilityBasis:'markup-only',tableCounts:{tables:count(raw.tableCounts?.tables),rows:count(raw.tableCounts?.rows),cells:count(raw.tableCounts?.cells)},containers,controls,scriptURLs,endpoints,...(staticAssetPaths?{staticAssetPaths}:{}),...(observedScripts?{scriptObservations:observedScripts}:{}),truncated:raw.truncated===true};
}
export function inspectSourceListStructure(document,base,nativeURL){
 if(!exact(base))return null;const visible=visibility(document),eligible=node=>context(node)&&visible(node),all=[...document.querySelectorAll('*')].slice(0,6001),containers=[],controls=[],scriptURLs=[],endpoints=[],staticAssetPaths=[];
 for(const node of all.slice(0,6000)){if(!eligible(node))continue;const tag=node.tagName.toLowerCase(),id=identifier(node.id),cl=classes((node.getAttribute('class')||'').split(/\s+/));if(containers.length<=30&&tags.has(tag)&&(hint.test(id)||cl.some(value=>hint.test(value))))containers.push({tag,id,classes:cl,childElements:[...node.children].filter(eligible).length,descendantElements:[...node.querySelectorAll('*')].filter(eligible).length,tables:[...node.querySelectorAll('table')].filter(eligible).length,rows:[...node.querySelectorAll('tr')].filter(eligible).length});
  if(controls.length<=20&&['input','select','textarea','button'].includes(tag)){const type=tag==='select'?(node.hasAttribute('multiple')?'select-multiple':'select-one'):tag==='textarea'?'textarea':node.getAttribute('type')||(tag==='button'?'button':'text');let text=label(node.getAttribute('aria-label'));if(!text&&node.id)for(const linked of document.querySelectorAll('label[for]'))if(linked.getAttribute('for')===node.id&&eligible(linked)){const copy=linked.cloneNode(true);for(const child of copy.querySelectorAll('input,select,textarea,button,script,style,[hidden]'))child.remove();text=label(copy.textContent);break;}const name=identifier(node.getAttribute('name')),controlID=identifier(node.id);if((name||controlID||text)&&type!=='hidden')controls.push({tag,type,name,id:controlID,label:text});}
  for(const attribute of attrs){const raw=node.getAttribute(attribute);if(!raw)continue;const url=nativeURL(raw,base);if(url&&!privateWords.test(new URL(url).pathname)&&endpoints.length<=12)endpoints.push({attribute,url});}
 }
 const scripts=[...document.querySelectorAll('script[src]')],observedScripts={total:scripts.length,inspected:Math.min(scripts.length,120),reasons:Object.fromEntries(scriptReasons.map(key=>[key,0]))};
 for(const node of scripts.slice(0,120)){
  const allowed=context(node)&&visible(node.parentElement)&&!node.hasAttribute('hidden')&&!node.hasAttribute('inert')&&node.getAttribute('aria-hidden')!=='true';
  const decision=allowed?scriptDecision(node.getAttribute('src'),base):{reason:'hiddenOrExcluded',url:''};observedScripts.reasons[decision.reason]++;
  if(decision.url&&scriptURLs.length<=SCRIPT_URL_LIMIT)scriptURLs.push(decision.url);
  if(decision.reason==='unsafeQuery'&&staticAssetPaths.length<=SCRIPT_URL_LIMIT){const item=staticAssetPath(node.getAttribute('src'),base);if(item&&!staticAssetPaths.some(existing=>existing.url===item.url))staticAssetPaths.push(item);}
 }
 const tables=[...document.querySelectorAll('table')].filter(eligible);return sanitizeSourceListStructure({schema:SCHEMA,visibilityBasis:'markup-only',tableCounts:{tables:tables.length,rows:tables.reduce((n,t)=>n+[...t.querySelectorAll('tr')].filter(eligible).length,0),cells:tables.reduce((n,t)=>n+[...t.querySelectorAll('th,td')].filter(eligible).length,0)},containers,controls,scriptURLs,endpoints,staticAssetPaths,scriptObservations:observedScripts,truncated:all.length>6000||document.querySelectorAll('script[src]').length>120||containers.length>30||controls.length>20||scriptURLs.length>SCRIPT_URL_LIMIT||staticAssetPaths.length>SCRIPT_URL_LIMIT||endpoints.length>12},nativeURL);
}
