import {parseHTML} from 'linkedom';
import {COLLECTION,chooseMatch,searchQuery,headline,terms} from '../extension-library/library-core.mjs';

// A narrow server-side client for NewsBank's ordinary Camden library-card form.
// It deliberately does not execute provider scripts, solve challenges, or act as a proxy.
const HOSTS=new Set(['arthur.newsbank.com','infoweb.newsbank.com']);
const COOKIE_DOMAINS=new Set([...HOSTS,'newsbank.com']);
const ORIGINS=new Set([...HOSTS].map(host=>'https://'+host));
const ENTRY=new URL(COLLECTION);
export const TELEGRAPH_ENTRY='https://infoweb.newsbank.com/apps/news/?p=UKNB';
function publisherKey(value='times'){if(!['times','telegraph'].includes(value))throw new Error('The NewsBank publisher was not recognised.');return value;}
function lookupQueries(title,publisher){
 const first=searchQuery(headline(title));if(publisher!=='telegraph')return [first];
 const distinctive=terms(headline(title)).filter(term=>! /^(?:says|said|suggests|warns|claims)$/.test(term));
 const fallback=[...new Set([distinctive[0],...distinctive.slice(-2)])].filter(Boolean).map(term=>'"'+term+'"').join(' ');
 return [...new Set([first,...(distinctive.length>=3?[fallback]:[])])];
}
function ordinaryNoResults(document){return [...document.querySelectorAll('h1,h2,h3,p,[role="status"],.view-empty,[class*="no-results"]')].some(element=>{for(let parent=element;parent;parent=parent.parentElement){if(parent.matches?.('script,style,[hidden],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(parent.getAttribute?.('style')||''))return false;}return /\bno (?:search )?results(?: found)?\b|\bno matching (?:articles|results)\b/i.test(element.textContent||'');});}
function publicationProof(raw,publisher){
 const text=String(raw||'').replace(/Author\/Byline:\s*[\s\S]*?(?=\d+\s+Words|Readability|Publication:|Source:|$)/i,' ');
 if(publisher==='times')return /\b(?:The )?(?:Sunday )?Times\b/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits|Telegraph)/i.test(text)?'The Times (Camden NewsBank text edition)':'';
 if(/Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton/i.test(text)||!/\bLondon\b/i.test(text))return '';
 if(/\b(?:The\s+)?Sunday Telegraph\b/i.test(text))return 'The Sunday Telegraph (London, UK) (Camden NewsBank text edition)';
 return /\b(?:The\s+)?Daily Telegraph\b/i.test(text)?'The Daily Telegraph (London, UK) (Camden NewsBank text edition)':'';
}
function resultPublication(el){const named=el.querySelector('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]');if(named)return named.getAttribute('data-publication')||named.textContent||'';const text=el.querySelector('ul')?.textContent||'';return /Publication:|Source:|Telegraph|Times|Gazette|Guardian|Independent|Mail|Mirror|Observer|Standard|Herald|Express/i.test(text)?text:'';}
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
 async function request(raw,{method='GET',body,headers={},allowStatus=false}={}){
  let url=safeURL(raw,ENTRY),verb=method,content=body;
  for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
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
 async function lookup({title,date='',publisher='times'}={}){
  publisher=publisherKey(publisher);
  if(typeof title!=='string'||!title.trim()||title.length>400)throw new Error('A newspaper headline is required for the NewsBank lookup.');
  const queries=lookupQueries(title,publisher),page=await request(publisher==='telegraph'?TELEGRAPH_ENTRY:COLLECTION);
  if(challenge(page.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(page.html,new URL(page.url)))return {status:'login_required'};
  const {document}=parseHTML(page.html),field=document.querySelector('input[id^="edit-val-base-0"]');
  if(!field)return {status:'needs_interaction',reason:'NewsBank search needs its browser interface; no ordinary server-rendered search form was available.'};
  const form=field.closest('form');if(!form)return {status:'needs_interaction',reason:'NewsBank search form could not be submitted as an ordinary HTML form.'};
  const destination=safeURL(form.getAttribute('action')||'',page.url);if(!HOSTS.has(destination.hostname))throw new Error('NewsBank search form destination was not recognised.');
  const method=(form.getAttribute('method')||'GET').toUpperCase();if(!['GET','POST'].includes(method))return {status:'needs_interaction',reason:'NewsBank search form uses a method this client cannot submit.'};
  const normalizedDate=normalizeNewsBankDate(date);let match,lastFailure;
  for(const q of queries){
   const data=new FormData();let found=false;for(const [n,v] of successfulFields(form)){if(n===field.getAttribute('name')){data.append(n,q);found=true;}else data.append(n,v);}if(!found)return {status:'needs_interaction',reason:'NewsBank search form changed; no query was submitted.'};
   const action=new URL(destination.href);if(method==='GET')for(const [name,value] of data.entries())action.searchParams.append(name,String(value));
   const result=await request(action.href,{method,body:method==='GET'?undefined:data});
   if(challenge(result.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
   if(isLogin(result.html,new URL(result.url)))return {status:'login_required'};
   const {document:rd}=parseHTML(result.html),results=[...rd.querySelectorAll('[id^="search-hits__hit--"],.search-hits__hit')].slice(0,20).map(el=>{const a=el.querySelector('h3 a,h2 a');return a?{title:(a.textContent||'').replace(/^Go to the document viewer for\s*/i,'').trim(),url:safeURL(a.getAttribute('href')||'',result.url).href,date:el.querySelector('ul')?.textContent?.slice(0,300)||'',publication:resultPublication(el)}:null;}).filter(Boolean);
   if(!results.length){lastFailure=ordinaryNoResults(rd)?{status:'not_found',reason:'NewsBank returned no matching articles for the headline queries.'}:{status:'needs_interaction',reason:'NewsBank did not return ordinary HTML search results; browser-based search may be required.'};if(lastFailure.status==='needs_interaction')return lastFailure;continue;}
   const normalizedResults=results.filter(r=>!r.publication||Boolean(publicationProof(r.publication,publisher))).map(r=>({...r,date:normalizeNewsBankDate(r.date)}));
   try{match=chooseMatch(title,normalizedResults,normalizedDate);break;}catch(error){lastFailure={status:'not_found',reason:error.message};}
  }
  if(!match)return lastFailure||{status:'not_found',reason:'No matching NewsBank article was found.'};
  const articlePage=await request(match.url);if(challenge(articlePage.html))return {status:'needs_interaction',reason:'NewsBank presented a browser security check.'};
  if(isLogin(articlePage.html,new URL(articlePage.url)))return {status:'login_required'};
  let article;try{article=extractDocument(articlePage.html,articlePage.url,publisher);}catch(error){return {status:'not_found',reason:error.message};}
  try{chooseMatch(title,[{title:article.title,url:article.libraryURL,date:normalizeNewsBankDate(article.date)}],normalizedDate);}catch(error){return {status:'not_found',reason:error.message};}
  return {status:'found',article};
 }
 function serializeSession(){return {schema:'newsbank-http-session/v1',cookies:[...cookies.values()].map(c=>({name:c.name,value:c.value,domain:c.domain,hostOnly:c.hostOnly,path:c.path,secure:c.secure,expires:c.expires}))};}
 function restoreSession(snapshot){if(!snapshot||snapshot.schema!=='newsbank-http-session/v1'||!Array.isArray(snapshot.cookies)||snapshot.cookies.length>MAX_COOKIES)throw new Error('NewsBank session data was not recognised.');cookies.clear();let bytes=0;for(const raw of snapshot.cookies){if(!raw||!COOKIE_DOMAINS.has(raw.domain)||!/^\//.test(raw.path)||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(raw.name)||typeof raw.value!=='string'||/[\r\n;]/.test(raw.value))throw new Error('NewsBank session data was not recognised.');bytes+=raw.name.length+raw.value.length;if(bytes>MAX_COOKIE_BYTES)throw new Error('NewsBank session data is too large.');if(raw.expires!==null&&raw.expires!==undefined&&raw.expires<=Date.now())continue;cookies.set(raw.domain+'\n'+raw.path+'\n'+raw.name,{name:raw.name,value:raw.value,domain:raw.domain,hostOnly:raw.hostOnly!==false,path:raw.path,secure:raw.secure===true,expires:Number.isFinite(raw.expires)?raw.expires:null});}}
 return {probe,login,lookup,serializeSession,restoreSession};
}

// Matches the existing extension's visible document-view parser contract.
export function extractDocument(html,rawURL,expectedPublisher='times'){
 expectedPublisher=publisherKey(expectedPublisher);
 const {document:d}=parseHTML(html),root=d.querySelector('#document-view--ascii');if(!root)throw new Error('NewsBank returned no readable text article.');
 const meta=root.querySelector('.document-view__meta')?.textContent||'',body=root.querySelector('.document-view__body--ascii');if(!body)throw new Error('NewsBank returned no readable text article.');
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
 const byline=meta.match(/Author\/Byline:\s*([\s\S]*?)(?=\d+\s+Words|Readability|$)/i)?.[1]?.trim()||'',date=meta.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/)?.[0]||'',publication=publicationProof(meta,expectedPublisher);
 if(!publication)throw new Error('The NewsBank record publication did not verify the requested '+(expectedPublisher==='times'?'Times':'London Telegraph')+' article.');
 return {title,byline,date,publication,paragraphs,libraryURL:safeURL(rawURL,ENTRY).href};
}
