import {parseHTML} from 'linkedom';
import {COLLECTION,chooseMatch,rankMatches,searchQuery,headline,terms} from '../extension-library/library-core.mjs';
import {diagnosticDocumentURL,sanitizeMatchDiagnostic,searchSelectName,searchControlName,searchControlID,searchOptionMetadata} from './newsbank-match-diagnostic.mjs';
import {publicationSearchQuery,publicationSearchPage,publicationObservedPath,publicationLabel} from './newsbank-publications.mjs';
import {OBSERVER_PUBLICATION_LABEL,matchesLibraryPublication} from './library-article-url.mjs';

// A narrow server-side client for NewsBank's ordinary Camden library-card form.
// It deliberately does not execute provider scripts, solve challenges, or act as a proxy.
const HOSTS=new Set(['arthur.newsbank.com','infoweb.newsbank.com']);
const COOKIE_DOMAINS=new Set([...HOSTS,'newsbank.com']);
const ORIGINS=new Set([...HOSTS].map(host=>'https://'+host));
const METADATA_SEARCH_PATHS=new Set(['/apps/news/','/apps/news/easy-search','/apps/news/search','/apps/news/results']);
function metadataSearchURL(url){return url.origin==='https://infoweb.newsbank.com'&&METADATA_SEARCH_PATHS.has(url.pathname)&&![...url.searchParams.keys()].some(key=>key.toLowerCase()==='docref'||key.toLowerCase()==='p'&&key!=='p')&&(!url.searchParams.has('p')||url.searchParams.getAll('p').length===1&&url.searchParams.get('p')==='UKNB');}
const ENTRY=new URL(COLLECTION);
export const TELEGRAPH_ENTRY='https://infoweb.newsbank.com/apps/news/?p=UKNB';
function publisherKey(value='times'){if(!['times','telegraph','observer'].includes(value))throw new Error('The NewsBank publisher was not recognised.');return value;}
function lookupQueries(title,publisher,{urlWordsHint=false}={}){
 const first=searchQuery(headline(title));if(publisher!=='telegraph')return [first];
 const distinctive=terms(headline(title)).filter(term=>! /^(?:says|said|suggests|warns|claims)$/.test(term));
 if(urlWordsHint===true&&distinctive.length>=6&&distinctive[0].endsWith('s')){const tail=headline(title).replace(/^\S+\s+/,'');if(tail.length<=400&&terms(tail).length>=5)return [...new Set([quotedHeadline(title),quotedHeadline(tail)])];}
 const quoted=[];for(const term of distinctive.slice(0,12)){const next='"'+term+'"';if([...quoted,next].join(' AND ').length>420)break;quoted.push(next);}const fallback=quoted.join(' AND ');
 return [...new Set([quotedHeadline(title),...(distinctive.length>=3?[fallback]:[])])];
}
function quotedHeadline(title){return '"'+headline(title).replace(/["\u201c\u201d]/g,' ').replace(/\s+/g,' ').trim()+'"';}
function ordinaryNoResults(document){return [...document.querySelectorAll('h1,h2,h3,p,[role="status"],.view-empty,[class*="no-results"]')].some(element=>{for(let parent=element;parent;parent=parent.parentElement){if(parent.matches?.('script,style,[hidden],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(parent.getAttribute?.('style')||''))return false;}return /\bno (?:search )?results(?: found)?\b|\bno matching (?:articles|results)\b/i.test(element.textContent||'');});}
function publicationProof(raw,publisher){
 const text=String(raw||'').replace(/Author\/Byline:\s*[\s\S]*?(?=\d+\s+Words|Readability|Publication:|Source:|$)/i,' ');
 if(publisher==='observer'){
  const label=text.replace(/^\s*(?:Publication|Source):\s*/i,'').replace(/\s+/g,' ').trim();
  return matchesLibraryPublication(label,'observer')?OBSERVER_PUBLICATION_LABEL:'';
 }
 if(publisher==='times')return /\b(?:The )?(?:Sunday )?Times\b/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits|Telegraph)/i.test(text)?'The Times (Camden NewsBank text edition)':'';
 if(/Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton/i.test(text)||!/\bLondon\b/i.test(text))return '';
 if(/\b(?:The\s+)?Sunday Telegraph\b/i.test(text))return 'The Sunday Telegraph (London, UK) (Camden NewsBank text edition)';
 return /\b(?:The\s+)?Daily Telegraph\b/i.test(text)?'The Daily Telegraph (London, UK) (Camden NewsBank text edition)':'';
}
function resultPublication(el){const named=el.querySelector('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]');if(named)return named.getAttribute('data-publication')||named.textContent||'';const text=el.querySelector('ul')?.textContent||'';return /Publication:|Source:|Telegraph|Times|Gazette|Guardian|Independent|Mail|Mirror|Observer|Standard|Herald|Express/i.test(text)?text:'';}
// Diagnostics expose headline/source metadata, never result snippets or document prose.
function metadataText(element,max=400){if(!element)return '';const copy=element.cloneNode(true);for(const node of copy.querySelectorAll('script,style,noscript,template,p,[hidden],[aria-hidden="true"]'))node.remove();return (copy.textContent||'').replace(/\s+/g,' ').trim().slice(0,max);}
function ordinaryVisible(element){for(let parent=element;parent;parent=parent.parentElement)if(parent.hidden||parent.hasAttribute?.('hidden')||parent.getAttribute?.('aria-hidden')==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(parent.getAttribute?.('style')||''))return false;return true;}
function observerPublicationFields(root,documentRecord=false,evidence){
 if(!root||!ordinaryVisible(root)||documentRecord&&root.closest('form,[inert],.document-view__body--ascii'))return '';
 const parsedValue=raw=>String(raw||'').replace(/^\s*(?:Publication|Source)\s*:\s*/i,'').replace(/\s+/g,' ').trim();
 const representations=documentRecord?[...root.querySelectorAll('*')].filter(node=>ordinaryVisible(node)&&!node.closest('form,[inert],.document-view__body--ascii')&&matchesLibraryPublication(parsedValue(node.textContent),'observer')):[];
 const selector=documentRecord?'[data-publication],p,li,dd,dt':'[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"],ul li';
 const nodes=[...root.querySelectorAll(selector)].filter(node=>ordinaryVisible(node)&&(!documentRecord||!node.closest('form,[inert],.document-view__body--ascii')));
 if(!documentRecord&&!root.children.length&&/^(?:Publication|Source)\s*:/i.test(root.textContent||''))nodes.push(root);
 const fields=nodes.map(node=>({node,raw:node.getAttribute('data-publication')||metadataText(node,1000)})).filter(field=>!nodes.some(other=>other!==field.node&&field.node.contains(other))&&!representations.some(full=>full!==field.node&&full.contains(field.node)));
 const values=fields.map(field=>({value:field.raw.replace(/^\s*(?:Publication|Source)\s*:\s*/i,'').replace(/\s+/g,' ').trim(),explicit:field.node.hasAttribute('data-publication')||/^(?:Publication|Source)\s*:/i.test(field.raw)}));
 let directTextNodes=0,brLines=0,literalCount=0;
 if(documentRecord){
  const visible=root.cloneNode(true);for(const node of visible.querySelectorAll('script,style,noscript,template,form,input,textarea,button,.document-view__body--ascii,[hidden],[inert],[aria-hidden="true"]'))node.remove();for(const node of visible.querySelectorAll('[style]'))if(!ordinaryVisible(node))node.remove();
  literalCount=(visible.textContent||'').replace(/\s+/g,' ').trim().split(OBSERVER_PUBLICATION_LABEL).length-1;
  const add=raw=>{const value=raw.replace(/^\s*(?:Publication|Source)\s*:\s*/i,'').replace(/\s+/g,' ').trim();if(value)values.push({value,explicit:/^\s*(?:Publication|Source)\s*:/i.test(raw)});};
  for(const node of visible.childNodes)if(node.nodeType===3&&node.nodeValue?.trim()){directTextNodes++;add(node.nodeValue);}
  // Live bibliographic evidence also uses nested inline/link wrappers. Admit
  // only a descendant's complete exact label, once, inside this metadata root.
  // Ancestors representing the same single literal do not create extra proof.
  const descendants=[...visible.querySelectorAll('*')];
  const exact=descendants.filter(node=>matchesLibraryPublication(parsedValue(node.textContent),'observer'));
  if(literalCount===1&&!values.some(field=>matchesLibraryPublication(field.value,'observer')))for(const node of exact.filter(node=>!exact.some(other=>other!==node&&node.contains(other))))add(node.textContent||'');
  for(const node of descendants){if(exact.some(full=>full!==node&&full.contains(node)))continue;const raw=(node.textContent||'').replace(/\s+/g,' ').trim(),value=parsedValue(raw);if(!matchesLibraryPublication(value,'observer')&&(publicationLabel(value)||!node.children.length&&/^(?:Publication|Source)\s*:/i.test(raw))&&!values.some(field=>field.value===value))add(raw);}
  // Only actual visible BR boundaries form fallback lines. Whitespace and
  // substrings inside an aggregated bibliographic field are never split.
  if(!values.some(field=>matchesLibraryPublication(field.value,'observer'))&&visible.querySelector('br')){for(const br of visible.querySelectorAll('br'))br.replaceWith('\u0000');const lines=(visible.textContent||'').split('\u0000');brLines=lines.length;for(const line of lines)if(line.trim())add(line);}
 }
 const matches=values.filter(field=>matchesLibraryPublication(field.value,'observer'));
 const conflicts=values.filter(field=>!matchesLibraryPublication(field.value,'observer')&&(field.explicit||publicationLabel(field.value)));
 if(evidence)Object.assign(evidence,{metadataPresent:true,structuredFields:fields.length,directTextNodes,brLines,exactLabelFields:matches.length,conflictingSourceFields:conflicts.length,expectedLiteralPresent:literalCount>0});
 return matches.length===1&&literalCount<=1&&!conflicts.length?OBSERVER_PUBLICATION_LABEL:'';
}
function searchFormEvidence(form){
 const describe=control=>({name:searchControlName(control.getAttribute('name'))?control.getAttribute('name'):'',id:searchControlID(control.id)?control.id:'',tag:control.tagName.toLowerCase(),type:control.tagName==='SELECT'?(control.hasAttribute('multiple')?'select-multiple':'select-one'):control.tagName==='TEXTAREA'?'textarea':(control.getAttribute('type')||'text').toLowerCase(),visibility:control.getAttribute('type')==='hidden'||!ordinaryVisible(control)?'hidden':'visible',disabled:Boolean(control.disabled||control.hasAttribute('disabled'))});
 const controls=[...form.querySelectorAll('input,select,textarea')].filter(control=>searchControlName(control.getAttribute('name'))||searchControlID(control.id)).slice(0,12).map(describe),selects=[],automatic=[];
 for(const select of [...form.querySelectorAll('select')].filter(s=>searchSelectName(s.getAttribute('name'))).slice(0,12)){
  const descriptor=describe(select),options=[...select.querySelectorAll('option')].slice(0,12).map(o=>searchOptionMetadata(o.getAttribute('value'),metadataText(o,80))).filter(Boolean);selects.push({...descriptor,options});
  if(descriptor.name==='fld-base-0'&&descriptor.visibility==='visible'&&!descriptor.disabled){const choices=[...select.querySelectorAll('option')].filter(o=>!o.disabled&&!o.hasAttribute('disabled')&&ordinaryVisible(o)).slice(0,12).map(o=>searchOptionMetadata(o.getAttribute('value'),metadataText(o,80))).filter(o=>o&&/^(?:title|headline)$/i.test(o.label));if(choices.length===1)automatic.push({name:descriptor.name,...choices[0]});}
 }
 const unique=[...form.querySelectorAll('[name]')].filter(control=>control.getAttribute('name')==='fld-base-0').length===1;
 return {totalControls:Math.min(form.querySelectorAll('input,select,textarea').length,1000),totalSelects:Math.min(form.querySelectorAll('select').length,1000),controls,selects,headlineSelection:unique&&automatic.length===1?automatic[0]:null};
}
function nextPageLinks(document){return [...document.querySelectorAll('a[rel~="next"],.pager__item--next a,.pagination .next a,nav[aria-label*="aginat"] a')].filter(a=>ordinaryVisible(a)&&!a.hasAttribute('disabled')&&a.getAttribute('aria-disabled')!=='true'&&a.getAttribute('href')&&(/next/i.test(a.getAttribute('rel')||'')||a.closest('.pager__item--next,.next')||/^(?:next|next page|go to next page)\b/i.test((a.getAttribute('aria-label')||metadataText(a,80)).trim())));}
function resultPageEvidence(document){
 const hasNext=nextPageLinks(document).length>0;
 let resultCount=null;for(const element of document.querySelectorAll('[class*="result-count"],[class*="results-count"],.search-results__count,[role="status"]')){if(!ordinaryVisible(element))continue;const raw=metadataText(element,160),match=raw.match(/\bof\s+([\d,]+)\b|\b([\d,]+)\s+(?:search\s+)?results?\b|\bresults?\s*:\s*([\d,]+)\b/i);if(match){const n=Number((match[1]||match[2]||match[3]).replace(/,/g,''));if(Number.isSafeInteger(n)&&n>=0){resultCount=Math.min(n,10_000_000);break;}}}
 return {hasNext,resultCount};
}
function pageKey(url){const canonical=new URL(url);canonical.hash='';canonical.searchParams.sort();return canonical.href;}
function sameSearchScope(url,scope){return url.origin==='https://infoweb.newsbank.com'&&url.origin===scope.origin&&url.pathname===scope.pathname&&/^\/apps\/news\//.test(url.pathname)&&url.pathname!=='/apps/news/document-view'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(!url.searchParams.has('p')||(url.searchParams.getAll('p').length===1&&url.searchParams.get('p')==='UKNB'))&&!url.searchParams.has('docref');}
function nativeNextPage(document,base,scope){
 const links=nextPageLinks(document);if(!links.length)return {url:'',stop:'no_next'};
 const urls=[];for(const link of links){const raw=link.getAttribute('href')||'';if(raw.length>8192)return {url:'',stop:'unapproved_next'};let next;try{next=safeURL(raw,base);}catch{return {url:'',stop:'unapproved_next'};}if(!sameSearchScope(next,scope))return {url:'',stop:'unapproved_next'};urls.push(next.href);}
 const unique=[...new Map(urls.map(url=>[pageKey(url),url])).values()];return unique.length===1?{url:unique[0],stop:''}:{url:'',stop:'unapproved_next'};
}
function searchHits(document,base){
 const hits=[...document.querySelectorAll('[id^="search-hits__hit--"],.search-hits__hit')],inspected=hits.slice(0,20);let rejectedLinkCount=0;
 const results=inspected.map(el=>{const a=el.querySelector('h3 a,h2 a');if(!a)return null;const url=newsBankDocumentURL(a.getAttribute('href')||'',base);if(!url){rejectedLinkCount++;return null;}const publication=resultPublication(el),listItems=[...el.querySelectorAll('ul li')],namedSource=el.querySelector('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]');return {title:metadataText(a).replace(/^Go to the document viewer for\s*/i,'').trim(),url,date:el.querySelector('ul')?.textContent?.slice(0,300)||'',publication,observerPublication:observerPublicationFields(el),observerDate:listItems.filter(ordinaryVisible).map(li=>normalizeNewsBankDate(metadataText(li,300))).find(Boolean)||'',publicationMetadata:namedSource?publication:listItems.length?listItems.map(li=>metadataText(li,300)).join(' '):publication};}).filter(Boolean);
 return {total:hits.length,inspected:inspected.length,rejectedLinkCount,results};
}
function diagnosticPublication(raw,publisher){
 const verified=publicationProof(raw,publisher);if(verified)return {publication:verified,publicationVerification:'verified'};
 const label=String(raw||'').match(/\b(?:The\s+)?(?:New York Times|Financial Times|Irish Times|Canberra Times|Straits Times|(?:Daily |Sunday )?Telegraph(?:\s*\((?:London, (?:England|UK)|Sydney, Australia)\))?|(?:Belfast|Coventry|Derby|Dundee|Macon|Alton) Telegraph|(?:Sunday )?Times|Guardian|Independent|Daily Mail|Daily Mirror|Observer|Evening Standard)\b(?:\))?/i)?.[0]||'';
 return {publication:label.slice(0,200),publicationVerification:'unverified'};
}
export function newsBankDocumentURL(raw,base=ENTRY){
 return diagnosticDocumentURL(raw,base);
}
function diagnosticCandidate(title,result,date,options,publisher){
 const score=rankMatches(title,[result],date,options)[0]?.score||0,headlineScore=rankMatches(title,[result])[0]?.score||0;
 return {title:String(result.title||'').slice(0,400),date:normalizeNewsBankDate(result.date),...diagnosticPublication(result.observerPublication||(result.publicationMetadata??result.publication),publisher),libraryURL:newsBankDocumentURL(result.url),headlineScore:Number(headlineScore.toFixed(4)),score:Number(score.toFixed(4)),eligible:publisher==='observer'?Boolean(publicationProof(result.observerPublication||result.publication,publisher)):!result.publication||Boolean(publicationProof(result.publication,publisher))};
}
function documentDiagnostic(html,url,title,date,options,publisher){const {document}=parseHTML(html),root=document.querySelector('#document-view--ascii'),meta=metadataText(root?.querySelector('.document-view__meta'),1000),sourceProof={},result={title:metadataText(root?.querySelector('h1')),date:normalizeNewsBankDate(meta.slice(0,300)),publication:meta,observerPublication:publisher==='observer'?observerPublicationFields(root?.querySelector('.document-view__meta'),true,sourceProof):'',url};return {...diagnosticCandidate(title,result,date,options,publisher),...(publisher==='observer'?{sourceProof}:{})};}
const MAX_BODY=4_000_000,MAX_REDIRECTS=8,MAX_COOKIES=80,MAX_COOKIE_BYTES=16_384;
const LOGIN_FORM='/library-card',LOGIN_POST='/login-libcard';
const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};

export function normalizeNewsBankDate(raw){
 if(typeof raw!=='string'||raw.length>300)return '';
 const iso=raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
 const human=raw.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/)||raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,]?\s+(\d{4})\b/);
 let year,month,day;if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}else if(human){if(/^\d/.test(human[1])){day=Number(human[1]);month=MONTHS[human[2].toLowerCase()];year=Number(human[3]);}else{month=MONTHS[human[1].toLowerCase()];day=Number(human[2]);year=Number(human[3]);}}else return '';
 if(!month||year<1000||year>9999||day<1||day>31)return '';
 const date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
 return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function safeURL(raw,base){let u;try{u=new URL(raw,base);}catch{throw new Error('NewsBank returned an invalid URL.');}
 if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port&&u.port!=='443'||u.username||u.password)throw new Error('NewsBank redirected outside its approved HTTPS hosts.');
 u.hash='';return u;
}
function challenge(html){
 const {document:d}=parseHTML(html),body=d.body;if(!body)return false;
 // Ignore CSP and script/style source text: those can mention a WAF without an active challenge.
 const visible=body.cloneNode(true);
 for(const el of [...visible.querySelectorAll('script,style,noscript,template,head,meta,link,[hidden],[aria-hidden="true"]')])el.remove();
 for(const el of [...visible.querySelectorAll('*')])if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style')||''))el.remove();
 const text=visible.textContent||'';
 if(/captcha|robot check|verify (?:that )?you are human|access denied|unusual traffic/i.test(text))return true;
 return [...body.querySelectorAll('form,iframe,input,[data-awswaf-token],[data-captcha]')].some(el=>{
  const tag=el.tagName.toLowerCase(),attrs=['id','class','name','src','action'].map(n=>el.getAttribute(n)||'').join(' ');
  return (tag==='form'&&/challenge|captcha/i.test(attrs))||(tag==='iframe'&&/captcha/i.test(attrs))||(tag==='input'&&/captcha/i.test(attrs))||el.hasAttribute('data-awswaf-token')||el.hasAttribute('data-captcha');
 });
}
function isLogin(html,url){const {document:d}=parseHTML(html);let title='';try{title=d.title||'';}catch{}return url.pathname===LOGIN_FORM||/NewsBank InfoWeb\s*\|\s*Login/i.test(title)||Boolean(d.querySelector?.('form[action*="login-libcard"]'));}
function parseForm(html,actionSuffix){const {document:d}=parseHTML(html);return [...d.querySelectorAll('form')].find(f=>{try{return safeURL(f.getAttribute('action')||'',ENTRY).pathname===actionSuffix;}catch{return false;}})||null;}
function successfulFields(form){const out=[];for(const el of form.querySelectorAll('input,select,textarea')){const name=el.getAttribute('name');if(!name||el.disabled||/^(?:submit|button|reset|image|file)$/i.test(el.type||''))continue;if(/^(?:checkbox|radio)$/i.test(el.type||'')&&!el.checked)continue;out.push([name,el.value??el.textContent??'']);}return out;}
function parseCookies(headers){if(typeof headers.getSetCookie==='function')return headers.getSetCookie();const one=headers.get('set-cookie');return one?[one]:[];}
function splitCookie(line){const first=line.split(';',1)[0]||'',at=first.indexOf('=');if(at<1)return null;const name=first.slice(0,at).trim(),value=first.slice(at+1).trim();if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||/[\r\n;]/.test(value))return null;const attrs={};for(const bit of line.slice(first.length+1).split(';')){const i=bit.indexOf('=');attrs[(i<0?bit:bit.slice(0,i)).trim().toLowerCase()]=i<0?'':bit.slice(i+1).trim();}let expires=attrs.expires?Date.parse(attrs.expires):null;if(Object.hasOwn(attrs,'max-age')){const age=Number(attrs['max-age']);if(Number.isFinite(age))expires=age<=0?0:Date.now()+age*1000;}return {name,value,domain:(attrs.domain||'').replace(/^\./,'').toLowerCase(),hostOnly:!attrs.domain,path:attrs.path||'/',secure:Object.hasOwn(attrs,'secure'),expires:Number.isFinite(expires)?expires:null};}

export function createNewsBankHTTPClient({fetch:fetcher=globalThis.fetch,timeoutMs=15_000,maxBodyBytes=MAX_BODY}={}){
 if(typeof fetcher!=='function')throw new TypeError('A fetch implementation is required.');
 const cookies=new Map();
 function absorb(response,url){for(const line of parseCookies(response.headers)){const c=splitCookie(line);if(!c)continue;const domain=c.domain||url.hostname;if(!COOKIE_DOMAINS.has(domain)||!(url.hostname===domain||url.hostname.endsWith('.'+domain)))continue;const path=c.path.startsWith('/')?c.path:'/';const key=domain+'\n'+path+'\n'+c.name;if(c.expires!==null&&c.expires<=Date.now()){cookies.delete(key);continue;}cookies.set(key,{...c,domain,path});}while(cookies.size>MAX_COOKIES)cookies.delete(cookies.keys().next().value);}
 function cookieHeader(url){const now=Date.now(),path=url.pathname||'/';for(const [k,c] of cookies)if(c.expires!==null&&c.expires<=now)cookies.delete(k);return [...cookies.values()].filter(c=>(c.hostOnly?url.hostname===c.domain:(url.hostname===c.domain||url.hostname.endsWith('.'+c.domain)))&&(path===c.path||path.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))&&(!c.secure||url.protocol==='https:')).map(c=>c.name+'='+c.value).join('; ');}
 async function request(raw,{method='GET',body,headers={},allowStatus=false,searchScope,metadataOnly=false}={}){
  let url=safeURL(raw,ENTRY),verb=method,content=body;const scopedPages=new Set();
  for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
   if(metadataOnly&&(url.origin==='https://arthur.newsbank.com'||url.origin==='https://infoweb.newsbank.com'&&['/apps/news/user/login','/apps/news/user/librarycard'].includes(url.pathname)))throw Object.assign(Error('NewsBank metadata search requires its existing signed-in session.'),{code:'newsbank_metadata_login_required'});
   if(metadataOnly&&!metadataSearchURL(url))throw Object.assign(Error('NewsBank metadata search left its ordinary search route.'),{code:'newsbank_metadata_route_changed',observedPath:url.origin==='https://infoweb.newsbank.com'?publicationObservedPath(url.pathname):''});
   if(searchScope&&(!sameSearchScope(url,searchScope)||verb!=='GET'))throw Object.assign(new Error('NewsBank pagination left its ordinary search page; no other link was opened.'),{code:'newsbank_search_page_changed'});
   if(searchScope){const key=pageKey(url);if(scopedPages.has(key)||searchScope.visited?.has(key))throw Object.assign(new Error('NewsBank pagination repeated an already inspected page.'),{code:'newsbank_search_page_loop'});scopedPages.add(key);}
   const h=new Headers(headers);h.set('Accept','text/html,application/xhtml+xml');const c=cookieHeader(url);if(c)h.set('Cookie',c);
   let response;try{response=await fetcher(url.href,{method:verb,body:content,headers:h,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch(e){if(e?.name==='TimeoutError'||e?.name==='AbortError')throw new Error('NewsBank did not respond before the request timed out.');throw new Error('The NewsBank request failed.');}
   absorb(response,url);
   if(response.status>=300&&response.status<400){const loc=response.headers.get('location');if(!loc)throw new Error('NewsBank returned an incomplete redirect.');if(redirects===MAX_REDIRECTS)throw new Error('NewsBank redirected too many times.');const next=safeURL(loc,url);if([307,308].includes(response.status)&&verb!=='GET'&&verb!=='HEAD')throw new Error('NewsBank requested a credential-form replay; continue in the browser.');if([301,302,303].includes(response.status)&&verb!=='GET'&&verb!=='HEAD'){verb='GET';content=undefined;headers={};}url=next;continue;}
   if(!allowStatus&&!response.ok)throw Object.assign(new Error('NewsBank returned HTTP '+response.status+'.'),{code:'newsbank_http_status',httpStatus:response.status});
   const type=response.headers.get('content-type')||'';if(!/text\/html|application\/xhtml/i.test(type))throw new Error('NewsBank returned a page this client cannot read.');
   const len=Number(response.headers.get('content-length'));if(Number.isFinite(len)&&len>maxBodyBytes)throw new Error('The NewsBank page is larger than this lookup allows.');
   if(!response.body)throw new Error('NewsBank returned an empty page.');const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>maxBodyBytes)throw new Error('The NewsBank page is larger than this lookup allows.');parts.push(x.value);}}finally{try{await reader.cancel();}catch{}}
   const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return {html:new TextDecoder().decode(bytes),url,response};
  }
  throw new Error('NewsBank redirected too many times.');
 }
 async function libraryLoginForm(){
  let page=await request(ENTRY.href);if(challenge(page.html))return {page,result:{status:'needs_interaction',reason:'NewsBank presented a browser security check.'}};
  const {document}=parseHTML(page.html),link=[...document.querySelectorAll('a')].find(a=>/log in with library credentials/i.test(a.textContent||''));
  let form;
  const changed=message=>Object.assign(new Error(message),{code:'newsbank_login_form_changed',httpStatus:page.response.status});
  if(link){const target=safeURL(link.getAttribute('href')||'',page.url);if(target.origin!=='https://arthur.newsbank.com'||target.pathname!==LOGIN_FORM)throw changed('NewsBank library-login link did not match its ordinary form.');page=await request(target.href);if(challenge(page.html))return {page,result:{status:'needs_interaction',reason:'NewsBank presented a browser security check.'}};form=parseForm(page.html,LOGIN_POST);}
  else form=parseForm(page.html,LOGIN_POST);
  if(!form)return {page,result:{status:'needs_interaction',reason:'The ordinary NewsBank library-card form was not present in the returned page.'}};
  const fields=successfulFields(form),names=new Set(fields.map(([n])=>n));
  if(!names.has('library')||!names.has('card')||!names.has('d'))throw changed('NewsBank library form fields changed; no credentials were submitted.');
  const target=safeURL(form.getAttribute('action')||'',page.url);if(target.origin!=='https://arthur.newsbank.com'||target.pathname!==LOGIN_POST)throw changed('NewsBank library form destination was not recognised.');
  if((form.getAttribute('method')||'GET').toUpperCase()!=='POST')throw changed('NewsBank library form method changed; no credentials were submitted.');
  return {page,fields,target};
 }
 async function probe(){
  try{
   const found=await libraryLoginForm();
   return found.result?{status:'needs_interaction',httpStatus:found.page.response.status}:{status:'available',httpStatus:found.page.response.status,loginForm:true};
  }catch(error){
   if(error?.code==='newsbank_http_status'&&Number.isInteger(error.httpStatus)&&error.httpStatus>=400&&error.httpStatus<=599)return {status:'blocked',httpStatus:error.httpStatus};
   if(error?.code==='newsbank_login_form_changed')return {status:'needs_interaction',httpStatus:error.httpStatus};
   return {status:'unavailable'};
  }
 }
 async function login({libraryName,cardNumber}={}){
  if(typeof libraryName!=='string'||!libraryName.trim()||libraryName.length>160||typeof cardNumber!=='string'||!cardNumber.trim()||cardNumber.length>200)throw new Error('Enter the library name and library card number shown by the NewsBank form.');
  const found=await libraryLoginForm();if(found.result)return found.result;
  const {fields,target}=found;
  const data=new FormData();for(const [n,v] of fields){if(n==='library')data.append(n,libraryName.trim());else if(n==='card')data.append(n,cardNumber);else data.append(n,v);}
  const result=await request(target.href,{method:'POST',body:data});
  if(challenge(result.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(result.html,new URL(result.url)))return {status:'rejected',reason:'NewsBank did not accept the library sign-in. Check the details in NewsBank.'};
  // Probe the requested collection so an intermediate confirmation page is never called success.
  const check=await request(ENTRY.href);if(challenge(check.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(check.html,new URL(check.url)))return {status:'rejected',reason:'NewsBank did not establish a signed-in session.'};
  return {status:'authenticated'};
 }
 async function lookup({title,date='',publisher='times',urlWordsHint=false}={}){
  publisher=publisherKey(publisher);
  if(typeof title!=='string'||!title.trim()||title.length>400)throw new Error('A newspaper headline is required for the NewsBank lookup.');
  let queries=lookupQueries(title,publisher,{urlWordsHint});const page=await request(publisher==='times'?COLLECTION:TELEGRAPH_ENTRY);
  if(challenge(page.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(page.html,new URL(page.url)))return {status:'login_required'};
  const {document}=parseHTML(page.html),field=document.querySelector('input[id^="edit-val-base-0"]');
  if(!field)return {status:'needs_interaction',reason:'NewsBank search needs its browser interface; no ordinary server-rendered search form was available.'};
  const form=field.closest('form');if(!form)return {status:'needs_interaction',reason:'NewsBank search form could not be submitted as an ordinary HTML form.'};
  const destination=safeURL(form.getAttribute('action')||'',page.url);if(!HOSTS.has(destination.hostname))throw new Error('NewsBank search form destination was not recognised.');
  const method=(form.getAttribute('method')||'GET').toUpperCase();if(!['GET','POST'].includes(method))return {status:'needs_interaction',reason:'NewsBank search form uses a method this client cannot submit.'};
  const observedForm=searchFormEvidence(form),headlineControl=observedForm.headlineSelection;
  if(headlineControl)queries=[...new Set([quotedHeadline(title),queries.at(-1)])];
  const normalizedDate=normalizeNewsBankDate(date),matchOptions=publisher==='telegraph'?{allowNextDayPublication:true}:{},diagnostic={schema:'newsbank-match-diagnostic/v1',publisher,requested:{title:headline(title),date:normalizedDate},stage:'search',form:observedForm,queries:[]};let match,lastFailure;
  const matchTitle=value=>publisher==='observer'&&urlWordsHint?value.replace(/[’']/g,''):value;
  const selectMatch=candidates=>{const result=chooseMatch(matchTitle(title),candidates.map(candidate=>({...candidate,title:matchTitle(candidate.title)})),normalizedDate,matchOptions);if(publisher==='observer'&&urlWordsHint&&(rankMatches(matchTitle(title),[result],normalizedDate,matchOptions)[0]?.score||0)<.85)throw Error('The library search did not find one unambiguous headline match. No article was substituted.');return result;};
  if(publisher==='observer'&&date&&!normalizedDate)return {status:'not_found',reason:'The Observer publication date could not be verified.'};
  const notFound=failure=>({...failure,diagnostic:sanitizeMatchDiagnostic(diagnostic)});
  for(const q of queries){
   const data=new FormData();let found=false;for(const [n,v] of successfulFields(form)){if(n===field.getAttribute('name')){data.append(n,q);found=true;}else if(headlineControl&&n===headlineControl.name)data.append(n,headlineControl.value);else data.append(n,v);}if(!found)return {status:'needs_interaction',reason:'NewsBank search form changed; no query was submitted.'};
   const action=new URL(destination.href);if(method==='GET')for(const [name,value] of data.entries())action.searchParams.append(name,String(value));
   let result=await request(action.href,{method,body:method==='GET'?undefined:data});
   const firstURL=new URL(result.url),scope={origin:firstURL.origin,pathname:firstURL.pathname},seenPages=new Set([pageKey(firstURL)]),seenDocuments=new Set(),results=[],queryDiagnostic={query:q,totalResults:0,inspectedCount:0,eligibleCount:0,rejectedPublicationCount:0,rejectedLinkCount:0,pageCount:0,truncated:false,pagingStop:'no_next',resultPage:{hasNext:false,resultCount:null},candidates:[]};let sampledMore=false;
   diagnostic.queries.push(queryDiagnostic);
   for(let pageIndex=0;pageIndex<3;pageIndex++){
    if(challenge(result.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
    if(isLogin(result.html,new URL(result.url)))return {status:'login_required'};
    const {document:rd}=parseHTML(result.html),batch=searchHits(rd,result.url);queryDiagnostic.pageCount++;
    queryDiagnostic.totalResults=Math.min(1000,queryDiagnostic.totalResults+batch.total);queryDiagnostic.inspectedCount+=batch.inspected;queryDiagnostic.rejectedLinkCount+=batch.rejectedLinkCount;sampledMore||=batch.total>20;
    for(const candidate of batch.results)if(!seenDocuments.has(candidate.url)){seenDocuments.add(candidate.url);results.push(candidate);}
    const normalizedResults=results.filter(r=>publisher==='observer'?r.observerPublication===OBSERVER_PUBLICATION_LABEL:!r.publication||Boolean(publicationProof(r.publication,publisher))).map(r=>({...r,date:publisher==='observer'?r.observerDate:normalizeNewsBankDate(r.date)})).filter(r=>publisher!=='observer'||r.date&&(!normalizedDate||r.date===normalizedDate));
    queryDiagnostic.eligibleCount=normalizedResults.length;queryDiagnostic.rejectedPublicationCount=results.length-normalizedResults.length;queryDiagnostic.resultPage=resultPageEvidence(rd);queryDiagnostic.truncated=sampledMore||queryDiagnostic.resultPage.hasNext;
    queryDiagnostic.candidates=rankMatches(title,results.map(r=>({...r,date:normalizeNewsBankDate(r.date)})),normalizedDate,matchOptions).slice(0,5).map(r=>diagnosticCandidate(title,r,normalizedDate,matchOptions,publisher));
    if(results.length){try{match=selectMatch(normalizedResults);queryDiagnostic.pagingStop='matched';break;}catch(error){lastFailure={status:'not_found',reason:error.message};}}
    else if(queryDiagnostic.rejectedLinkCount)lastFailure={status:'not_found',reason:'The library result link was not recognised.'};
    else{lastFailure=ordinaryNoResults(rd)?{status:'not_found',reason:'NewsBank returned no matching articles for the headline queries.'}:{status:'needs_interaction',reason:'NewsBank did not return ordinary HTML search results; browser-based search may be required.'};if(lastFailure.status==='needs_interaction')return lastFailure;}
    const next=nativeNextPage(rd,result.url,scope);queryDiagnostic.pagingStop=next.stop||'page_limit';
    if(!next.url)break;
    if(queryDiagnostic.pageCount>=3){queryDiagnostic.pagingStop='page_limit';break;}
    const key=pageKey(next.url);if(seenPages.has(key)){queryDiagnostic.pagingStop='loop';break;}const visited=new Set(seenPages);seenPages.add(key);
    try{result=await request(next.url,{method:'GET',searchScope:{...scope,visited}});}catch(error){if(error?.code==='newsbank_search_page_changed')return {status:'needs_interaction',reason:error.message};if(error?.code==='newsbank_search_page_loop'){queryDiagnostic.pagingStop='loop';break;}throw error;}
    const returnedKey=pageKey(result.url);if(returnedKey!==key&&seenPages.has(returnedKey)){queryDiagnostic.pagingStop='loop';break;}seenPages.add(returnedKey);
   }
   if(match)break;
  }
  if(!match)return notFound(lastFailure||{status:'not_found',reason:'No matching NewsBank article was found.'});
  const articlePage=await request(match.url);if(challenge(articlePage.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(articlePage.html,new URL(articlePage.url)))return {status:'login_required'};
  let article;try{article=extractDocument(articlePage.html,articlePage.url,publisher);}catch(error){diagnostic.stage='document';diagnostic.document=documentDiagnostic(articlePage.html,articlePage.url,title,normalizedDate,matchOptions,publisher);return notFound({status:'not_found',reason:error.message});}
  try{if(publisher==='observer'&&(!normalizeNewsBankDate(article.date)||normalizeNewsBankDate(article.date)!==match.date))throw Error('The Observer record date did not match its search result.');selectMatch([{title:article.title,url:article.libraryURL,date:normalizeNewsBankDate(article.date)}]);}catch(error){diagnostic.stage='document';diagnostic.document=documentDiagnostic(articlePage.html,articlePage.url,title,normalizedDate,matchOptions,publisher);return notFound({status:'not_found',reason:error.message});}
  return {status:'found',article};
 }
 function serializeSession(){return {schema:'newsbank-http-session/v1',cookies:[...cookies.values()].map(c=>({name:c.name,value:c.value,domain:c.domain,hostOnly:c.hostOnly,path:c.path,secure:c.secure,expires:c.expires}))};}
 function restoreSession(snapshot){if(!snapshot||snapshot.schema!=='newsbank-http-session/v1'||!Array.isArray(snapshot.cookies)||snapshot.cookies.length>MAX_COOKIES)throw new Error('NewsBank session data was not recognised.');cookies.clear();let bytes=0;for(const raw of snapshot.cookies){if(!raw||!COOKIE_DOMAINS.has(raw.domain)||!/^\//.test(raw.path)||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(raw.name)||typeof raw.value!=='string'||/[\r\n;]/.test(raw.value))throw new Error('NewsBank session data was not recognised.');bytes+=raw.name.length+raw.value.length;if(bytes>MAX_COOKIE_BYTES)throw new Error('NewsBank session data is too large.');if(raw.expires!==null&&raw.expires!==undefined&&raw.expires<=Date.now())continue;cookies.set(raw.domain+'\n'+raw.path+'\n'+raw.name,{name:raw.name,value:raw.value,domain:raw.domain,hostOnly:raw.hostOnly!==false,path:raw.path,secure:raw.secure===true,expires:Number.isFinite(raw.expires)?raw.expires:null});}}
 async function searchPublications(input){
  const query=publicationSearchQuery(input),state=(status,stage,reasonCode,observedPath='')=>({status,stage,reasonCode,...(publicationObservedPath(observedPath)?{observedPath}:{})});let stage='entry';
  if(!cookieHeader(new URL(TELEGRAPH_ENTRY)))return state('login_required','session','session_expired');
  try{
   const page=await request(TELEGRAPH_ENTRY,{metadataOnly:true});
   if(challenge(page.html))return state('needs_interaction','entry','entry_needs_interaction');
   if(isLogin(page.html,new URL(page.url)))return state('login_required','entry','session_expired');
   stage='form';
   const {document}=parseHTML(page.html),field=document.querySelector('input[id^="edit-val-base-0"]'),form=field?.closest('form');
   if(!field||!form)return state('needs_interaction','form','form_missing');
   let destination;try{destination=safeURL(form.getAttribute('action')||'',page.url);}catch{return state('needs_interaction','form','destination_changed');}
   const method=(form.getAttribute('method')||'GET').toUpperCase();
   if(!metadataSearchURL(destination)||!['GET','POST'].includes(method))return state('needs_interaction','form','destination_changed',destination.origin==='https://infoweb.newsbank.com'?destination.pathname:'');
   const selection=searchFormEvidence(form).headlineSelection,data=new FormData();let found=false;
   for(const [name,value] of successfulFields(form)){if(name===field.getAttribute('name')){data.append(name,quotedHeadline(query.title));found=true;}else if(selection&&name===selection.name)data.append(name,selection.value);else data.append(name,value);}
   if(!found)return state('needs_interaction','form','destination_changed');
   if([...data.keys()].some(name=>name.toLowerCase()==='docref'||name.toLowerCase()==='p'&&name!=='p')||data.has('p')&&(data.getAll('p').length!==1||data.get('p')!=='UKNB'))return state('needs_interaction','form','destination_changed',destination.pathname);
   if(method==='GET')for(const [name,value] of data.entries()){if(name==='p'&&destination.searchParams.has('p'))continue;destination.searchParams.append(name,String(value));}
   stage='results';const result=await request(destination.href,{method,body:method==='GET'?undefined:data,metadataOnly:true});
   if(challenge(result.html))return state('needs_interaction','results','entry_needs_interaction');
   if(isLogin(result.html,new URL(result.url)))return state('login_required','results','session_expired');
   const {document:results}=parseHTML(result.html);
   if(!results.querySelector('[id^="search-hits__hit--"],.search-hits__hit')&&!ordinaryNoResults(results))return state('needs_interaction','results','results_changed');
   return publicationSearchPage(results,result.url,query,normalizeNewsBankDate);
  }catch(error){if(error?.code==='newsbank_metadata_login_required')return state('login_required',stage,'session_expired');if(error?.code==='newsbank_metadata_route_changed')return state('needs_interaction','route','route_changed',error.observedPath);throw error;}
 }
 return {probe,login,lookup,searchPublications,serializeSession,restoreSession};
}

// Matches the existing extension's visible document-view parser contract.
export function extractDocument(html,rawURL,expectedPublisher='times'){
 expectedPublisher=publisherKey(expectedPublisher);
 const {document:d}=parseHTML(html),root=d.querySelector('#document-view--ascii');if(!root)throw new Error('NewsBank returned no readable text article.');
 const metaNode=root.querySelector('.document-view__meta');let meta=metaNode?.textContent||'';const body=root.querySelector('.document-view__body--ascii');if(!body)throw new Error('NewsBank returned no readable text article.');
 if(expectedPublisher==='observer'){
  if(!metaNode||!ordinaryVisible(metaNode))meta='';else{const visible=metaNode.cloneNode(true);for(const node of visible.querySelectorAll('script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]'))node.remove();for(const node of visible.querySelectorAll('[style]'))if(!ordinaryVisible(node))node.remove();for(const br of visible.querySelectorAll('br'))br.replaceWith(' ');meta=visible.textContent||'';}
 }
 const blockTags=new Set(['ADDRESS','ARTICLE','BLOCKQUOTE','DD','DIV','DL','DT','H1','H2','H3','H4','H5','H6','LI','OL','P','PRE','SECTION','TABLE','TR','UL']);
 const chunks=[];const walk=node=>{
  if(node.nodeType===3){chunks.push(node.nodeValue||'');return;}
  if(node.nodeType!==1)return;
  const tag=node.tagName;if(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(tag)||node.hasAttribute('hidden')||node.getAttribute('aria-hidden')==='true')return;
  if(tag==='BR'){chunks.push('\n');return;}
  const block=blockTags.has(tag);if(block)chunks.push('\n');
  for(const child of node.childNodes)walk(child);
  if(block)chunks.push('\n');
 };
 walk(body);
 const paragraphs=chunks.join('').replace(/\r/g,'\n').replace(/\u00a0/g,' ').replace(/[\t\f\v ]+/g,' ').split(/\n+/).map(p=>p.trim()).filter(Boolean);
 const title=root.querySelector('h1')?.textContent?.trim()||'';if(!title||paragraphs.length<3)throw new Error('NewsBank article text was incomplete.');
 const byline=meta.match(/Author\/Byline:\s*([\s\S]*?)(?=\d+\s+Words|Readability|$)/i)?.[1]?.trim()||'',date=expectedPublisher==='observer'?normalizeNewsBankDate(meta):meta.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/)?.[0]||'',publication=expectedPublisher==='observer'?observerPublicationFields(metaNode,true):publicationProof(meta,expectedPublisher);
 if(!publication)throw new Error('The NewsBank record publication did not verify the requested '+(expectedPublisher==='times'?'Times':expectedPublisher==='observer'?'Observer':'London Telegraph')+' article.');
 return {title,byline,date,publication,paragraphs,libraryURL:safeURL(rawURL,ENTRY).href};
}
