let latest=null;
const $=id=>document.getElementById(id);
async function capturePage(mediaOnly=false){
  $('status').textContent=mediaOnly?'Reading visible article media…':'Reading visible rendered content…';
  $('capture').disabled=true;$('capture-media').disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id)throw Error('No active tab.');
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:mediaOnly?extractMedia:extractArticle});
    if(mediaOnly?!result?.media?.length:!result?.blocks?.length){const unknown=result?.diagnostics?.unsupportedPlayerCount;throw Error(mediaOnly?(unknown?'Visible player unsupported ('+unknown+'). '+(result.diagnostics.unsupportedPlayerHosts||[]).join(', '):'No unobscured article media is visible. Bring most of the image or player into view and try again.'):'No readable article content was found.');}
    latest=result;$('download').disabled=false;$('send').disabled=false;
    const d=result.diagnostics;$('status').textContent=result.title||'Untitled article';$('review').hidden=false;
    $('review').textContent=mediaOnly?`Media only · ${d.imageCount} images · ${d.videoCount} videos. No article paragraphs captured. Only substantially visible media in this viewport is included; playback and original placement are not certified.`:`${d.wordCount} words · ${d.paragraphCount} paragraphs · ${d.imageCount} images · ${d.videoCount} videos${d.paywallDetected?' · access-related markup found; it may be inactive':''}. Fidelity varies by page; completeNotCertified is always true.`;
  }catch(e){$('status').textContent=e.message||'Capture failed.';latest=null;$('download').disabled=true;$('send').disabled=true;$('review').hidden=true;}
  finally{$('capture').disabled=false;$('capture-media').disabled=false;}
}
$('capture').addEventListener('click',()=>capturePage(false));
$('capture-media').addEventListener('click',()=>capturePage(true));
$('download').addEventListener('click',()=>{if(!latest)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}));a.download=latest.schema==='ret-media/v1'?'reading-room-media.json':'ret-capture.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
 $('send').addEventListener('click',async()=>{if(!latest)return;const nonce=crypto.getRandomValues(new Uint8Array(24)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');const url=new URL('https://reader.example.org/capture-review');url.searchParams.set('from','extension');url.searchParams.set('captureNonce',nonce);await chrome.storage.local.set({retReviewedCapture:{capture:latest,nonce,expiresAt:Date.now()+600000}});await chrome.tabs.create({url:url.href});});

function extractArticle(){
 const norm=s=>(s||'').replace(/\s+/g,' ').trim();
 const shown=e=>{if(!e||!e.getBoundingClientRect)return false;const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return false;for(let p=e;p;p=p.parentElement){const st=getComputedStyle(p);if(st.display==='none'||st.visibility==='hidden'||st.visibility==='collapse'||Number(st.opacity)<.05||/blur\((?!0px)/i.test(st.filter)||st.contentVisibility==='hidden'||parseInt(st.webkitLineClamp,10)>0||p.hidden||p.getAttribute('aria-hidden')==='true')return false;if(p!==e){const pr=p.getBoundingClientRect();if(['hidden','clip'].includes(st.overflowY)&&(r.top<pr.top-1||r.bottom>pr.bottom+1))return false;if(['hidden','clip'].includes(st.overflowX)&&(r.left<pr.left-1||r.right>pr.right+1))return false;}}return true;};
 const visible=e=>shown(e)&&!e.closest('script,style,noscript,template,nav,footer,aside,[role="dialog"],[aria-modal="true"],form,.comments,.related-articles,.related-stories,.newsletter,[data-component="related-articles"]');
 const css=e=>{const s=getComputedStyle(e);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,fontStyle:s.fontStyle,letterSpacing:s.letterSpacing,textAlign:s.textAlign,color:s.color,marginTop:s.marginTop,marginBottom:s.marginBottom}};
 const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x+scrollX),y:Math.round(r.y+scrollY),width:Math.round(r.width),height:Math.round(r.height)}};
 const clean=u=>{try{const x=new URL(u,location.href);if(x.protocol!=='https:')return '';if(x.username||x.password)return '';x.hash='';for(const k of [...x.searchParams.keys()]){if(/token|signature|auth|secret|password|key|expires|policy|credential/i.test(k))return '';if(/^(?:utm_|fbclid|gclid|ref$)/i.test(k))x.searchParams.delete(k);}return x.href}catch{return ''}};
 const candidates=[...document.querySelectorAll('article,main,[itemprop="articleBody"],.article-body,.story-body,.article-content,.paywall')].filter(visible);
 const score=e=>{const t=norm(e.innerText),p=e.querySelectorAll('p').length;return Math.min(t.length,15000)+p*250+(e.matches('article,[itemprop="articleBody"],.article-body,.story-body')?1200:0)};
 let root=candidates.sort((a,b)=>score(b)-score(a))[0]; if(!root){root=[...document.querySelectorAll('body')].find(visible);}
 if(!root) return null;
 // Prefer a focused article subtree within a broad main/body container.
 const nested=[...root.querySelectorAll('article,[itemprop="articleBody"],.article-body,.story-body,.article-content')].filter(visible).sort((a,b)=>score(b)-score(a))[0];if(nested&&score(nested)>score(root)*.45)root=nested;
 const rootRect=root.getBoundingClientRect(), blocker=[...document.querySelectorAll('body *')].find(e=>{if(!shown(e)||e===root)return false;const s=getComputedStyle(e);if(!['fixed','sticky'].includes(s.position)&&!e.matches('[role="dialog"],[aria-modal="true"]'))return false;const r=e.getBoundingClientRect();if(r.width<innerWidth*.55||r.height<36||r.bottom<=rootRect.top||r.top>=rootRect.bottom)return false;return /subscribe|sign\s*in|log\s*in|subscriber|continue reading|unlock (the )?article|access this article|meter limit/i.test(norm(e.innerText).slice(0,1200));});
 if(blocker)throw Error('A visible sign-in, subscription, or access overlay blocks the article. Capture is paused until you can read the page.');
 const rawTitle=norm(root.querySelector('h1')?.innerText||document.querySelector('h1')?.innerText||document.title);
 const dek=root.querySelector('header h2,.standfirst,.article__standfirst,[data-testid="standfirst"],.headline-sub')||[...root.querySelectorAll('h2')].find(e=>visible(e)&&e.getBoundingClientRect().top<(root.querySelector('.entry-content')?.getBoundingClientRect().top||0));
 const focused=root.querySelector('.entry-content,[itemprop="articleBody"],[data-testid="article-body"]');
 const paywall=!!document.querySelector('[class*="paywall"],[id*="paywall"],[class*="meter"],[class*="subscriber-only"]');
 const elems=[...root.querySelectorAll('h1,h2,h3,h4,p,blockquote,figure,img,video,iframe,[data-video-id],.inline-article-ad,[data-testid="ad-slot"]')].filter(e=>(!focused||focused.contains(e)||((e.matches('video,iframe,[data-video-id]'))&&Boolean(e.compareDocumentPosition(focused)&Node.DOCUMENT_POSITION_FOLLOWING)))&&visible(e)&&!(e.tagName==='P'&&e.closest('blockquote,figure'))&&!(e.tagName==='IMG'&&e.closest('figure,video-js,[data-video-id]'))&&(!e.closest('.inline-article-ad')||e.matches('.inline-article-ad')));
 const blocks=[];const seenVideos=new Set();let seq=0;
 for(const e of elems){
  const tag=e.tagName.toLowerCase(), st=css(e), rc=rect(e);if(tag==='h1'||e===dek)continue;if(rc.width<3||rc.height<3)continue;
  let b=null;
  if(e.matches('.inline-article-ad,[data-testid="ad-slot"]'))b={type:'ad',text:'Advertisement position',style:st,rect:rc};
  else if(/^h[1-4]$/.test(tag)){const text=norm(e.innerText);if(text)b={type:'heading',text,level:Number(tag[1]),style:st,rect:rc};}
  else if(tag==='p'){const text=norm(e.innerText);if(text===rawTitle)continue;if(text)b={type:'paragraph',text,style:st,rect:rc};}
  else if(tag==='blockquote'){const text=norm(e.innerText);if(text)b={type:'quote',text,style:st,rect:rc};}
  else if(tag==='figure'||tag==='img'){const img=tag==='img'?e:e.querySelector('img');if(img&&visible(img)){const url=clean(img.currentSrc||img.src);if(url){const cap=norm((tag==='figure'?e.querySelector('figcaption')?.innerText:'')||img.getAttribute('alt'));b={type:'figure',url,caption:cap||undefined,credit:norm(img.getAttribute('data-credit')||img.getAttribute('credit'))||undefined,style:st,rect:rect(img)};}}}
  else if(e.hasAttribute('data-video-id')){const id=e.getAttribute('data-video-id'),acct=e.getAttribute('data-account'),player=e.getAttribute('data-player');if(/^\d+$/.test(id||'')&&/^\d+$/.test(acct||'')&&/^[\w-]+$/.test(player||''))b={type:'video',url:`https://players.brightcove.net/${acct}/${player.replace(/_default$/,'')}_default/index.html?videoId=${id}`,poster:clean(e.getAttribute('poster')||e.querySelector('video')?.poster||getComputedStyle(e.querySelector('.vjs-poster')||e).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]||''),style:st,rect:rc};}
  else if(tag==='video'){const src=clean(e.currentSrc||e.getAttribute('src')||e.querySelector('source')?.src||'');const poster=clean(e.poster||'');if(src||poster)b={type:'video',url:src||undefined,poster:poster||undefined,caption:norm(e.getAttribute('aria-label')||e.getAttribute('title'))||undefined,style:st,rect:rc};}
  else if(tag==='iframe'){const src=clean(e.src);if(src&&/(youtube\.com|youtu\.be|vimeo\.com|brightcove\.net)/i.test(src))b={type:'video',url:src,caption:norm(e.title),style:st,rect:rc};}
  if(b&&b.type==='video'){if(seenVideos.has(b.url))continue;seenVideos.add(b.url);}
  if(b){b.id=`b${++seq}`;blocks.push(b);}
 }
 const wordCount=blocks.reduce((n,b)=>n+(b.text?b.text.split(/\s+/).length:0),0), paragraphs=blocks.filter(b=>b.type==='paragraph').length,ys=blocks.map(b=>b.rect.y),ends=blocks.map(b=>b.rect.y+b.rect.height),captureSpanHeight=ys.length?Math.max(...ends)-Math.min(...ys):0,rootHeight=Math.round(rootRect.height);
 const articleStyle=css(root),bodyStyle=css(document.body),fonts=[...new Set(blocks.map(b=>b.style.fontFamily).filter(Boolean))].map(family=>{let loaded=false;try{loaded=document.fonts.check('16px '+JSON.stringify(family.split(',')[0].replace(/[\"\']/g,'')));}catch{}return {family,loaded};});
 const meta=n=>norm(document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.content);
 return {schema:'ret-capture/v1',url:clean(location.href),title:rawTitle,publisher:meta('og:site_name')||location.hostname,byline:meta('author')||norm(document.querySelector('[rel="author"],.byline,[class*="author"]')?.innerText),date:meta('article:published_time')||meta('date'),standfirst:(dek&&visible(dek)?norm(dek.innerText):'')||meta('description'),capturedAt:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},articleRect:(()=>{const ps=blocks.filter(b=>b.type==='paragraph'&&b.text.length>100).map(b=>b.rect);const r=ps.length?ps.sort((a,b)=>a.width-b.width)[Math.floor(ps.length/2)]:rect(root);return{x:r.x,y:r.y,width:r.width}})(),design:{bodyBackground:bodyStyle.color?getComputedStyle(document.body).backgroundColor:'transparent',articleBackground:getComputedStyle(root).backgroundColor,headlineStyle:css(root.querySelector('h1')||document.querySelector('h1')),bodyStyle:articleStyle,standfirstStyle:dek&&visible(dek)?css(dek):{}},fonts,blocks,diagnostics:{wordCount,paragraphCount:paragraphs,imageCount:blocks.filter(b=>b.type==='figure').length,videoCount:blocks.filter(b=>b.type==='video').length,paywallDetected:paywall,captureSpanHeight,rootHeight,viewportScreens:innerHeight?Math.round((captureSpanHeight/innerHeight)*100)/100:0,completeNotCertified:true}};
}

// Serialized by chrome.scripting: keep this function independent and read-only.
