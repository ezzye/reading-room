import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const root=new URL('../extension-page-lens/',import.meta.url),popup=readFileSync(new URL('popup.js',root),'utf8');
const mediaSource=readFileSync(new URL('media-capture.js',root),'utf8');
const extractor=mediaSource.slice(mediaSource.indexOf('function extractMedia(){'));
function capture(markup,{hit,styles={},configure=()=>{},url='https://publisher.example.org/story'}={}){
 const {document}=parseHTML('<html><head><title>Fixture story</title></head><body>'+markup+'</body></html>');
 for(const n of document.querySelectorAll('*'))n.getBoundingClientRect=()=>{const v=(n.getAttribute('data-box')||'0,0,1000,800').split(',').map(Number);return {x:v[0],y:v[1],left:v[0],top:v[1],width:v[2],height:v[3],right:v[0]+v[2],bottom:v[1]+v[3]};};
 document.elementFromPoint=(x,y)=>{if(hit)return hit(document,x,y);return [...document.querySelectorAll('[data-box]')].filter(n=>{const r=n.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}).at(-1)||document.body;};
 configure(document);
 const context={document,location:new URL(url),URL,Date,innerWidth:1000,innerHeight:800,scrollX:0,scrollY:50,devicePixelRatio:2,getComputedStyle:n=>({display:'block',visibility:'visible',opacity:'1',filter:'none',contentVisibility:'visible',clipPath:'none',webkitLineClamp:'none',overflowX:'visible',overflowY:'visible',...styles[n.id],...Object.fromEntries((n.getAttribute('style')||'').split(';').filter(Boolean).map(x=>{const [k,v]=x.split(':');return [k.replace(/-([a-z])/g,(_,a)=>a.toUpperCase()),v];}))})};
 vm.createContext(context);vm.runInContext(extractor+';globalThis.result=extractMedia();',context);return JSON.parse(JSON.stringify(context.result));
}
const img='<figure><img id="image" data-box="100,150,600,300" src="https://cdn.example.org/photo.jpg" alt="Visible photo"><figcaption data-box="100,450,600,30">A source caption <small class="credit">Photographer</small></figcaption></figure>';
const article=body=>'<article><h1 data-box="100,20,600,60">Fixture article heading</h1>'+body+'</article>';
test('isolated media function captures current rendered media, captions and rectangles with no prose/state',()=>{
 const result=capture(article(img+'<p>ARTICLE PROSE MUST NOT BE CAPTURED.</p><script type="application/json">{"image":"https://cdn.example.org/state.jpg"}</script>'));
 assert.equal(result.schema,'ret-media/v1');assert.equal(result.media.length,1);assert.equal(result.media[0].caption,'A source caption Photographer');assert.equal(result.media[0].credit,'Photographer');assert.equal(result.media[0].rect.y,200);assert.equal(result.diagnostics.visibleOnly,true);assert.doesNotMatch(JSON.stringify(result),/ARTICLE PROSE|state.jpg|blocks/);
 assert.doesNotMatch(extractor,/fetch\(|chrome\.|document\.cookie|JSON\.parse|eval\(|createElement|remove\(/);
});
test('hidden, clipped, blurred, inert, dialog, related and ad media stay excluded',()=>{
 for(const wrapper of ['<div hidden>','<div inert>','<div aria-hidden="true">','<div role="dialog">','<aside>','<div class="related-stories">','<div class="advertisement">','<div style="display:none">','<div style="filter:blur(5px)">','<div style="clip-path:inset(1px)">','<div data-box="0,0,200,100" style="overflow-y:hidden">'])assert.equal(capture(article(wrapper+img+'</div>')).media.length,0,wrapper);
});
test('viewport boundaries and overlay hit tests prevent capturing covered or offscreen media',()=>{
 assert.equal(capture(article(img),{hit:d=>d.body}).media.length,0);
 assert.equal(capture(article(img),{hit:(d,x)=>x>500?d.body:d.querySelector('#image')}).media.length,1);
 const partial=capture(article(img.replace('100,150,600,300','100,650,600,300')));assert.equal(partial.media.length,1);assert.equal(partial.diagnostics.partialViewportMediaCount,1);
 assert.equal(capture(article(img.replace('100,150,600,300','100,790,600,300'))).media.length,0);
 assert.equal(capture(article(img.replace('100,150,600,300','-50,150,600,300'))).media.length,1);
});
test('article scope never widens to body or another story card',()=>{
 assert.equal(capture('<h1 data-box="10,10,500,60">Headline</h1>'+img).media.length,0);
 assert.equal(capture(article('<article><h1>Other story</h1>'+img+'</article>')).media.length,0);
 assert.equal(capture('<nav>'+img+'</nav>'+article('')).media.length,0);
});
test('safe public URLs reject credentials, private hosts and signed parameters, including after tracking keys',()=>{
 for(const url of ['http://cdn.example.org/a.jpg','https://u:p@cdn.example.org/a.jpg','https://127.0.0.1/a.jpg','https://local.internal/a.jpg','https://cdn.example.org/a.jpg?utm_source=x&token=private','https://cdn.example.org:444/a.jpg','https://[::ffff:127.0.0.1]/a.jpg','https://cdn.example.org/a.jpg?pin=1234','https://cdn.example.org/a.jpg?borrower=private'])assert.equal(capture(article(img.replace('https://cdn.example.org/photo.jpg',url))).media.length,0,url);
 assert.throws(()=>capture(article(img),{url:'https://127.0.0.1/private'}),/public HTTPS/);
});
test('supported visible players normalize safely and unknown players are reported without guessed URLs',()=>{
 const markup='<iframe data-box="50,100,400,225" src="https://www.youtube.com/watch?v=AbCdEfGh123"></iframe><iframe data-box="500,100,400,225" src="https://player.example.org/embed/123"></iframe>';
 const result=capture(article(markup));assert.equal(result.media.length,1);assert.equal(result.media[0].url,'https://www.youtube-nocookie.com/embed/AbCdEfGh123');assert.equal(result.diagnostics.unsupportedPlayerCount,1);assert.deepEqual(result.diagnostics.unsupportedPlayerHosts,['player.example.org']);
 const bc=capture(article('<video-js data-box="100,150,600,300" data-video-id="123456789" data-account="5436121856001" data-player="TkNT2u3xG"></video-js>'));assert.match(bc.media[0].url,/players.brightcove.net\/5436121856001\/TkNT2u3xG_default\/index.html\?videoId=123456789/);
 const direct=capture(article('<video data-box="100,150,600,300" src="https://cdn.example.org/clip.mp4"></video>'));assert.equal(direct.media[0].type,'video');
});
test('the observed Telegraph source player keeps its public iframe URL and rejects lookalike hosts or credentials',()=>{
 const url='https://cf-particle-html.eip.telegraph.co.uk/player/fictional.html?article=fixture';
 const result=capture(article('<iframe data-box="100,150,600,300" src="'+url+'"></iframe>'));
 assert.equal(result.media.length,1);assert.equal(result.media[0].type,'video');assert.equal(result.media[0].url,url);
 for(const unsafe of [url.replace('.co.uk','.co.uk.evil.example'),url+'&token=private','https://cf-particle-html.eip.telegraph.co.uk/']){
  const blocked=capture(article('<iframe data-box="100,150,600,300" src="'+unsafe+'"></iframe>'));assert.equal(blocked.media.length,0);
 }
});
test('capture caps at twenty and never copies text from popup-independent source state',()=>{
 const images=Array.from({length:25},(_,i)=>'<img data-box="'+(20+i%5*180)+','+(100+Math.floor(i/5)*110)+',120,70" src="https://cdn.example.org/photo'+i+'.jpg">').join('');const result=capture(article(images));assert.equal(result.media.length,20);
 // Identical overlapping images beyond the hit-tested top surface are excluded.
 const duplicates=capture(article(img+img));assert.equal(duplicates.media.length,1);
});
test('manifest explicitly declares scoped bridge permissions and media download/schema handoff are explicit',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));assert.equal(manifest.version,'0.2.3');assert.deepEqual(manifest.permissions,['activeTab','scripting','storage','alarms']);assert.deepEqual(manifest.host_permissions,['https://reader.example.org/*']);assert.deepEqual(manifest.optional_host_permissions,['https://dayofflondon.com/*']);assert.match(popup,/world:'ISOLATED'/);assert.match(popup,/reading-room-media\.json/);assert.match(readFileSync(new URL('handoff.js',root),'utf8'),/\['ret-capture\/v1','ret-media\/v1'\]/);
});

test('visible preview survives an inactive paywall marker while an unknown visible poster stays a labeled figure',()=>{
 assert.equal(capture(article('<div class="paywall">'+img+'</div>')).media.length,1);
 const poster=capture(article('<video-js data-box="100,150,600,300" data-video-id="unknown"><div id="poster" class="vjs-poster" data-box="100,150,600,300"></div></video-js>'),{styles:{poster:{backgroundImage:'url("https://cdn.example.org/poster.jpg")'}}});
 assert.equal(poster.media[0].type,'figure');assert.equal(poster.media[0].url,'https://cdn.example.org/poster.jpg');assert.match(poster.media[0].caption,/Visible poster; player unsupported/);assert.equal(poster.diagnostics.unsupportedPlayerCount,1);
 const notVisible=capture(article('<video-js data-box="100,150,600,300" data-video-id="unknown"><div id="poster" class="vjs-poster" data-box="100,150,600,300" hidden></div></video-js>'),{styles:{poster:{backgroundImage:'url("https://cdn.example.org/poster.jpg")'}}});assert.equal(notVisible.media.length,0);
});
test('cross-origin frame content and CSP-protected internals are never inspected',()=>{
 const result=capture(article('<iframe data-box="100,150,600,300" src="https://player.vimeo.com/video/12345"></iframe>'),{configure:d=>{for(const key of ['contentWindow','contentDocument'])Object.defineProperty(d.querySelector('iframe'),key,{get(){throw Error('CSP/cross-origin internals are inaccessible');}});}});
 assert.equal(result.media[0].url,'https://player.vimeo.com/video/12345');
});
test('media nonce handoff remains one-use and rejects expired or unknown schemas',async()=>{
 const nonce='a'.repeat(48),script=readFileSync(new URL('handoff.js',root),'utf8');
 for(const [schema,expired,expected] of [['ret-media/v1',false,1],['ret-capture/v1',false,1],['other',false,0],['ret-media/v1',true,0]]){
  const {window}=parseHTML('<html></html>');let removed=0,delivered=0;const record={nonce,expiresAt:Date.now()+(expired?-1000:600000),capture:{schema,url:'https://publisher.example.org/story',media:[]}};
  window.addEventListener('ret-capture-ready',()=>delivered++);
  const context={window,URL,Date,CustomEvent:window.CustomEvent,location:{href:'https://dayofflondon.com/capture-review?captureNonce='+nonce,origin:'https://dayofflondon.com',pathname:'/capture-review',protocol:'https:',hostname:'dayofflondon.com'},chrome:{storage:{local:{get:async()=>({retReviewedCapture:record}),remove:async()=>{removed++;}}}}};vm.runInNewContext(script,context);
  window.dispatchEvent(new window.CustomEvent('ret-request-capture',{detail:{nonce}}));await new Promise(resolve=>setImmediate(resolve));window.dispatchEvent(new window.CustomEvent('ret-request-capture',{detail:{nonce}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(delivered,expected);assert.equal(removed,expected);
 }
});


test('article headline takes precedence over an earlier site masthead heading',()=>{
 const result=capture('<header><h1 data-box="0,0,900,40">Website masthead</h1></header>'+article(img));assert.equal(result.title,'Fixture article heading');assert.equal(result.media.length,1);
});

test('a hidden document cannot provide a rendered viewport capture',()=>{let reads=0;assert.throws(()=>capture('<article><h1>Story</h1></article>',{configure:document=>Object.defineProperty(document,'visibilityState',{get:()=>++reads===1?'visible':'hidden'})}),/Keep the source tab visible/);assert.throws(()=>capture('<article><h1>Story</h1><figure><img src="https://images.example.org/a.jpg" data-box="10,10,600,300"></figure></article>',{configure:document=>Object.defineProperty(document,'visibilityState',{value:'hidden'})}),/Keep the source tab visible/);});
