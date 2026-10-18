import {libraryArticle} from '../lib/library-article-url.mjs';
import {articleIdentity} from '../lib/article-media.mjs';
import {publisherPreview} from './publisher-preview.mjs';
import {normalizeNewsBankDate} from '../lib/newsbank-http.mjs';
import {logRenderStage} from './render-runtime/diagnostics.mjs';

const MAX_REQUESTS=40,MAX_RESOURCE_BYTES=20_000_000,MAX_NAVIGATIONS=3;
const HOSTS=new Set(['telegraph.co.uk','www.telegraph.co.uk','static.telegraph.co.uk']);
const TYPES=new Set(['script','stylesheet','image','font']);
const escape=value=>String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean=(value,max)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const remaining=deadline=>Math.max(1,deadline-Date.now());

export function renderRequestAllowed({url,method,type,navigation,mainFrame},target){
 if(method!=='GET')return false;
 let parsed;try{parsed=new URL(url);}catch{return false;}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!HOSTS.has(parsed.hostname)||[...parsed.searchParams.keys()].some(key=>/token|auth|session|signature|password|secret|credential|policy/i.test(key)))return false;
 if(navigation||type==='document'){
  if(!mainFrame)return false;
  try{return libraryArticle(parsed.href).key==='telegraph'&&articleIdentity(parsed.href)===target;}catch{return false;}
 }
 // No frames, streaming, XHR/fetch, WebSocket, workers, tracking beacons or
 // non-publisher resources. No script or other method is supplied by a caller.
 return TYPES.has(type)&&!/(?:^|\/)(?:analytics|tracking|beacon|advertising)(?:\/|\.|$)/i.test(parsed.pathname);
}

/** Fixed read-only browser-side code. No article prose/state/scripts are returned. */
export function readRenderedPreview(){
 const clean=(value,max)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
 const attr=(node,name)=>node?.getAttribute(name)||'';
 const visible=node=>{
  if(!node?.getBoundingClientRect)return false;
  for(let n=node;n?.getAttribute;n=n.parentElement){
   const style=getComputedStyle(n);
   if(n.hasAttribute('hidden')||attr(n,'aria-hidden')==='true'||style.display==='none'||['hidden','collapse'].includes(style.visibility)||Number(style.opacity)===0||style.contentVisibility==='hidden'||/blur\(/i.test(style.filter||''))return false;
  }
  const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;
 };
 const unrelated=node=>node.closest('aside,nav,footer,[class*="related"],[class*="recommend"],[class*="paywall"],[class*="premium-content"],[data-access="paid"]');
 const label=(node,max)=>{
  if(!node)return '';const walker=document.createTreeWalker(node,4);let text='',visited=0,current;
  while((current=walker.nextNode())&&visited++<5000){const parent=current.parentElement;if(parent&&visible(parent)&&!parent.closest('script,style,template,noscript'))text+=' '+current.nodeValue;if(text.length>=max)break;}
  return clean(text,max);
 };
 const checks=[document.title,...[...document.querySelectorAll('h1,h2,[role="alert"],#challenge-running,.cf-browser-verification')].filter(visible).slice(0,20).map(node=>label(node,300))].join(' ');
 const challenge=/captcha|robot check|verify (?:that )?you are human|access denied|unusual traffic|just a moment|attention required/i.test(checks)||Boolean(document.querySelector('form[action*="challenge"],form[action*="captcha"],[data-awswaf-token],[data-captcha]'));
 if(challenge)return {challenge:true};
 const h1=[...document.querySelectorAll('h1')].find(node=>visible(node)&&!unrelated(node));
 const title=clean(label(h1,400)||attr(document.querySelector('meta[property="og:title"]'),'content'),400);
 const identity=[...document.querySelectorAll('link[rel~="canonical"],meta[property="og:url"]')].slice(0,8).map(node=>({kind:node.tagName==='LINK'?'canonical':'og:url',value:clean(attr(node,node.tagName==='LINK'?'href':'content'),2048)}));
 const metadata=[...document.querySelectorAll('meta[property],meta[name]')].filter(node=>/^(?:og:image(?::url)?|og:image:alt|twitter:image(?::src)?|og:video(?::url|:secure_url)?|twitter:player)$/i.test(attr(node,'property')||attr(node,'name'))).slice(0,20).map(node=>({key:clean(attr(node,'property')||attr(node,'name'),80),value:clean(attr(node,'content'),2048)}));
 const scope=h1?.closest('article')||(document.querySelectorAll('article').length===1?document.querySelector('article'):null);
 const media=[];
 if(scope)for(const node of scope.querySelectorAll('img,iframe,video')){
  if(media.length>=12)break;
  if(!visible(node)||unrelated(node))continue;
  const figure=node.closest('figure'),caption=figure?.querySelector('figcaption'),credit=figure?.querySelector('[class*="credit"],[class*="copyright"]');
  media.push({tag:node.tagName,url:clean(attr(node,'src')||attr(node,'data-src')||(node.tagName==='VIDEO'?attr(node.querySelector('source'),'src'):''),2048),poster:clean(attr(node,'poster'),2048),caption:clean(caption&&visible(caption)?label(caption,500):attr(node,'alt')||attr(node,'title'),500),credit:clean(credit&&visible(credit)?label(credit,200):'',200)});
 }
 return {challenge:false,url:location.href,title,date:clean(attr(document.querySelector('meta[property="article:published_time"],meta[name="date"]'),'content'),100),identity,metadata,media};
}

function snapshotHTML(snapshot){
 const head=[...(snapshot.identity||[]).map(item=>item.kind==='canonical'?'<link rel="canonical" href="'+escape(item.value)+'">':'<meta property="og:url" content="'+escape(item.value)+'">'),...(snapshot.metadata||[]).map(item=>'<meta property="'+escape(item.key)+'" content="'+escape(item.value)+'">'),'<meta property="article:published_time" content="'+escape(snapshot.date)+'">'].join('');
 const media=(snapshot.media||[]).map(item=>{
  const tag=['IMG','IFRAME','VIDEO'].includes(item.tag)?item.tag.toLowerCase():'';if(!tag)return '';
  return '<figure><'+tag+' src="'+escape(item.url)+'"'+(tag==='video'?' poster="'+escape(item.poster)+'"':'')+' title="'+escape(item.caption)+'" alt="'+escape(item.caption)+'">'+(tag==='img'?'':'</'+tag+'>')+'<figcaption>'+escape(item.caption)+'<span class="credit">'+escape(item.credit)+'</span></figcaption></figure>';
 }).join('');
 return '<!doctype html><html><head>'+head+'</head><body><article><h1>'+escape(snapshot.title)+'</h1>'+media+'</article></body></html>';
}

async function defaultLauncher(options){const {launchPublicBrowser}=await import('./render-runtime/runtime.mjs');return launchPublicBrowser(options);}
async function boundedClose(work,milliseconds){let timer;try{await Promise.race([Promise.resolve().then(work),new Promise(resolve=>{timer=setTimeout(resolve,milliseconds);})]);}catch{}finally{clearTimeout(timer);}}

export async function publisherRender(event,{launchBrowser=defaultLauncher,budgetMs=30_000,log}={}){
 const checkedAt=new Date().toISOString();let sourceURL='',httpStatus=null,owned,context,page,cdp,stop=null,timer;
 let stage='render-start';const report=next=>{stage=next;logRenderStage(stage,undefined,log);};report('render-start');
 const result=(state,reasonCode)=>({status:'publisher-preview',state,sourceURL,title:'',date:'',checkedAt,blocks:[],receipts:[],httpStatus,reasonCode});
 if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).length!==2||event.action!=='publisher-render'||!Object.hasOwn(event,'url'))return result('unavailable','invalid_request');
 let target;
 try{const article=libraryArticle(event.url);if(article.key!=='telegraph'||typeof event.url!=='string'||event.url.length>2048||!normalizeNewsBankDate(new URL(article.url).pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1]||''))throw Error('invalid');sourceURL=article.url;target=articleIdentity(sourceURL);}catch{return result('unavailable','invalid_url');}
 const deadline=Date.now()+Math.max(1,budgetMs-2_000);
 const fail=(state,reasonCode)=>{if(!stop){stop={state,reasonCode};logRenderStage('render-stop',{code:reasonCode},log);if(page)void page.close().catch(()=>{});}};
 const work=async()=>{
  owned=await launchBrowser({deadline,log});if(stop||Date.now()>=deadline){
   fail('unavailable','timed_out');
   // A cold-start launcher may settle after the deadline race has returned.
   // It must close its own late browser rather than leave a warm process alive.
   await boundedClose(()=>owned.browser.close(),1000);const lateChild=owned.browser.process?.();if(lateChild&&lateChild.exitCode===null){try{lateChild.kill('SIGKILL');}catch{}}
   await boundedClose(()=>owned.cleanup?.(),400);return;
  }
  // A new disposable browser/profile gives a clean default context. Serverless
  // Chromium single-process mode does not reliably support incognito contexts.
  // This is the sole context choice, never a fallback to an existing profile.
  report('context-create');context=owned.browser.defaultBrowserContext();page=await context.newPage();report('context-ready');
  report('network-setup');
  await page.setBypassServiceWorker(true);await page.setCacheEnabled(false);await page.setRequestInterception(true);
  // These explicit containment limits are not fingerprint/UA spoofing. They
  // prevent alternate network targets escaping page request interception.
  await page.evaluateOnNewDocument(()=>{
   for(const name of ['Worker','SharedWorker','WebSocket','EventSource','RTCPeerConnection','webkitRTCPeerConnection','WebTransport']){
    try{Object.defineProperty(globalThis,name,{configurable:false,writable:false,value:class{constructor(){throw new DOMException('Public preview network limit','SecurityError');}}});}catch{}
   }
   try{Object.defineProperty(globalThis,'open',{configurable:false,writable:false,value:()=>null});}catch{}
  });
  cdp=await page.createCDPSession();await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs',{urls:['http://*','ws://*','wss://*','file://*','ftp://*']});
  let requests=0,navigations=0,resourceBytes=0;
  page.on('popup',popup=>{void popup.close().catch(()=>{});});
  page.on('request',request=>{void(async()=>{
   if(request.isInterceptResolutionHandled?.())return;
   if(stop){await request.abort();return;}
   if(++requests>MAX_REQUESTS){fail('unavailable','request_failed');await request.abort();return;}
   const navigation=request.isNavigationRequest(),mainFrame=request.frame()===page.mainFrame();
   if(navigation&&mainFrame&&++navigations>MAX_NAVIGATIONS){fail('unavailable','redirect_limit');await request.abort();return;}
   if(!renderRequestAllowed({url:request.url(),method:request.method(),type:request.resourceType(),navigation,mainFrame},target)){
    if(navigation&&mainFrame)fail('blocked','redirect_mismatch');await request.abort();return;
   }
   const headers=Object.fromEntries(Object.entries(request.headers()).filter(([name])=>!/(?:^|-)cookie2?$|^authorization$|^proxy-authorization$/i.test(name)));
   await request.continue({headers});
  })().catch(()=>fail('unavailable','request_failed'));});
  page.on('response',response=>{
   const request=response.request();if(request.isNavigationRequest()&&request.frame()===page.mainFrame()){
    httpStatus=response.status();if(httpStatus<200||httpStatus>=400)fail('blocked','http_denied');
   }
  });
  cdp.on('Network.dataReceived',event=>{resourceBytes+=Math.max(Number(event.encodedDataLength)||0,Number(event.dataLength)||0);if(resourceBytes>MAX_RESOURCE_BYTES)fail('unavailable','response_too_large');});
  report('navigation');const response=await page.goto(sourceURL,{waitUntil:'domcontentloaded',timeout:Math.min(20_000,remaining(deadline))});report('navigation-complete');
  if(stop)return;
  if(!response){fail('unavailable','empty_response');return;}
  httpStatus=response.status();if(httpStatus<200||httpStatus>=300){fail('blocked','http_denied');return;}
  if(!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers()['content-type']||'')){fail('unavailable','unsupported_content');return;}
  try{await page.waitForNetworkIdle({idleTime:400,timeout:Math.min(3_000,remaining(deadline))});}catch{/* No retries or page interaction follow a busy public page. */}
  if(stop||Date.now()>=deadline){if(!stop)fail('unavailable','timed_out');return;}
  report('snapshot');const snapshot=await page.evaluate(readRenderedPreview);report('snapshot-ready');if(stop)return;
  if(snapshot?.challenge){fail('blocked','challenge');return;}
  if(!snapshot||articleIdentity(snapshot.url)!==target){fail('unavailable','identity_mismatch');return;}
  const synthetic=snapshotHTML(snapshot);
  const preview=await publisherPreview({action:'publisher-preview',url:sourceURL},{fetch:async()=>new Response(synthetic,{headers:{'Content-Type':'text/html'}})});
  preview.checkedAt=checkedAt;preview.httpStatus=httpStatus;return preview;
 };
 try{
  const answer=await Promise.race([work(),new Promise(resolve=>{timer=setTimeout(()=>{fail('unavailable','timed_out');resolve(null);},remaining(deadline));})]);
  return answer||result(stop?.state||'unavailable',stop?.reasonCode||'request_failed');
 }catch(error){logRenderStage(stage,error,log);return result(stop?.state||'unavailable',stop?.reasonCode||(['TimeoutError','AbortError'].includes(error?.name)?'timed_out':'request_failed'));}
 finally{
  clearTimeout(timer);report('render-close');await boundedClose(()=>owned?.browser.close(),1000);
  const child=owned?.browser.process?.();if(child&&child.exitCode===null){try{child.kill('SIGKILL');}catch{}}
  await boundedClose(()=>owned?.cleanup?.(),400);
 }
}
