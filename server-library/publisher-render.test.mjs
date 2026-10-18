import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseHTML} from 'linkedom/worker';
import {publisherRender,readRenderedPreview,renderRequestAllowed} from './publisher-render.mjs';
import {verifyPackFile,launchPublicBrowser} from './render-runtime/runtime.mjs';

const url='https://telegraph.co.uk/world-news/2026/10/17/a-fictional-river-walk-opens';
const title='A fictional river walk opens for the community',target='telegraph.co.uk/world-news/2026/10/17/a-fictional-river-walk-opens';
const request=(changes={})=>({url,method:'GET',type:'document',navigation:true,mainFrame:true,...changes});
const event=(changes={})=>({action:'publisher-render',url,...changes});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fake({status=200,snapshot,go}={}){
 const calls=[],frame={},page=new EventEmitter(),cdp=new EventEmitter();let closes=0,cleanups=0,evaluations=0;
 const response={status:()=>status,headers:()=>({'content-type':'text/html'}),request:()=>({isNavigationRequest:()=>true,frame:()=>frame})};
 function network(changes={}){const raw=request(changes),item={continued:null,aborted:false,url:()=>raw.url,method:()=>raw.method,resourceType:()=>raw.type,isNavigationRequest:()=>raw.navigation,frame:()=>raw.mainFrame?frame:{},headers:()=>({cookie:'synthetic-cookie',Authorization:'synthetic-auth','user-agent':'HeadlessChrome/153','sec-ch-ua':'default hints'}),isInterceptResolutionHandled:()=>false,abort:async()=>{item.aborted=true;},continue:async value=>{item.continued=value;}};page.emit('request',item);return item;}
 for(const name of ['setBypassServiceWorker','setCacheEnabled','setRequestInterception','evaluateOnNewDocument'])page[name]=async value=>{calls.push([name,value]);};
 page.mainFrame=()=>frame;page.createCDPSession=async()=>cdp;
 cdp.send=async(name,value)=>{calls.push([name,value]);};
 page.close=async()=>{closes++;};
 page.waitForNetworkIdle=async()=>{};
 page.evaluate=async fn=>{evaluations++;assert.equal(fn,readRenderedPreview);return snapshot||{challenge:false,url,title,date:'2026-10-17',identity:[{kind:'canonical',value:url}],metadata:[],media:[{tag:'IFRAME',url:'https://www.youtube.com/watch?v=AbCdEfGh123',poster:'',caption:'A visible public video',credit:''}]};};
 page.goto=async(address,options)=>{calls.push(['goto',address,options]);network();await turn();page.emit('response',response);if(go)await go({page,cdp,network});await turn();return response;};
 const context={newPage:async()=>page,close:async()=>{calls.push(['context-close']);}};
 const browser={defaultBrowserContext:()=>{calls.push(['fresh-default-context']);return context;},close:async()=>{calls.push(['browser-close']);},process:()=>null};
 const launchBrowser=async options=>{calls.push(['launch',options]);return{browser,cleanup:async()=>{cleanups++;}};};
 return {launchBrowser,calls,page,cdp,network,response,get closes(){return closes;},get cleanups(){return cleanups;},get evaluations(){return evaluations;}};
}

test('invalid requests and credentials never launch a browser',async()=>{
 let launches=0;const launchBrowser=async()=>{launches++;throw Error('No browser expected');};
 for(const field of ['cardNumber','libraryName','session','credentials','headers'])assert.equal((await publisherRender(event({[field]:'private'}),{launchBrowser})).reasonCode,'invalid_request');
 for(const address of ['https://telegraph.co.uk/','https://localhost/world-news/2026/10/17/a-story','http://telegraph.co.uk/world-news/2026/10/17/a-story','https://telegraph.co.uk/world-news/2026/02/30/a-story'])assert.equal((await publisherRender(event({url:address}),{launchBrowser})).reasonCode,'invalid_url');
 assert.equal(launches,0);
});

test('request containment only permits exact public navigation and approved GET static assets',()=>{
 assert.equal(renderRequestAllowed(request(),target),true);
 assert.equal(renderRequestAllowed(request({url:url.replace('https://','https://www.')}),target),true);
 assert.equal(renderRequestAllowed(request({url:'https://static.telegraph.co.uk/assets/app.js',type:'script',navigation:false}),target),true);
 for(const changes of [{method:'POST'},{url:'http://169.254.169.254/latest/meta-data'},{url:'https://attacker.example/app.js',type:'script',navigation:false},{url:'https://telegraph.co.uk/account'},{url:url+'?session=private'},{mainFrame:false},{type:'media',navigation:false},{type:'fetch',navigation:false},{type:'xhr',navigation:false},{type:'websocket',navigation:false},{url:'https://static.telegraph.co.uk/tracking/pixel.gif',type:'image',navigation:false}])assert.equal(renderRequestAllowed(request(changes),target),false);
});

test('one normal rendered visit uses a fresh context and returns only the public media contract',async()=>{
 const f=fake();const result=await publisherRender(event(),{launchBrowser:f.launchBrowser});
 assert.equal(result.status,'publisher-preview');assert.equal(result.state,'available');assert.equal(result.title,title);assert.equal(result.blocks.length,1);assert.equal(result.blocks[0].type,'video');
 assert.equal(f.calls.filter(x=>x[0]==='goto').length,1);assert.equal(f.calls.filter(x=>x[0]==='fresh-default-context').length,1);assert.equal(f.cleanups,1);assert(f.calls.some(x=>x[0]==='browser-close'));
 assert(f.calls.some(x=>x[0]==='evaluateOnNewDocument'));assert(f.calls.some(x=>x[0]==='Network.setBlockedURLs'));
 assert.equal(JSON.stringify(f.calls).includes('setUserAgent'),false);assert.equal(JSON.stringify(f.calls).includes('synthetic-cookie'),false);
});

test('cookie and authorization headers are removed while default UA and hints are retained',async()=>{
 let item;const f=fake({go:async({network})=>{item=network({url:'https://static.telegraph.co.uk/a.js',type:'script',navigation:false});await turn();}});
 await publisherRender(event(),{launchBrowser:f.launchBrowser});assert.ok(item.continued);const headers=item.continued.headers;
 assert.equal(Object.keys(headers).some(key=>/cookie|authorization/i.test(key)),false);assert.equal(headers['user-agent'],'HeadlessChrome/153');assert.equal(headers['sec-ch-ua'],'default hints');
});

test('non-success navigation stops before evaluating visible media and closes the browser',async()=>{
 const f=fake({status:402}),result=await publisherRender(event(),{launchBrowser:f.launchBrowser});
 assert.equal(result.state,'blocked');assert.equal(result.httpStatus,402);assert.equal(result.reasonCode,'http_denied');assert.equal(f.evaluations,0);assert.deepEqual(result.blocks,[]);assert.equal(f.cleanups,1);
});

test('challenge and wrong-article DOM snapshots remain blocked or unavailable without media',async()=>{
 for(const [snapshot,reason] of [[{challenge:true},'challenge'],[{challenge:false,url:url+'-different',title},'identity_mismatch'],[{challenge:false,url,title,identity:[{kind:'canonical',value:'https://telegraph.co.uk/'}],metadata:[],media:[]},'identity_mismatch']]){
  const f=fake({snapshot}),result=await publisherRender(event(),{launchBrowser:f.launchBrowser});assert.equal(result.reasonCode,reason);assert.deepEqual(result.blocks,[]);assert.equal(f.cleanups,1);
 }
});

test('resource and navigation limits close the page without extracting content',async()=>{
 const cases=[['response_too_large',async({cdp})=>cdp.emit('Network.dataReceived',{dataLength:20_000_001})],['request_failed',async({network})=>{for(let n=0;n<40;n++)network({url:'https://static.telegraph.co.uk/a'+n+'.jpg',type:'image',navigation:false});await turn();}],['redirect_limit',async({network})=>{for(let n=0;n<3;n++)network();await turn();}]];
 for(const [reason,go] of cases){const f=fake({go}),result=await publisherRender(event(),{launchBrowser:f.launchBrowser});assert.equal(result.reasonCode,reason);assert.equal(f.evaluations,0);assert(f.closes>=1);assert.equal(f.cleanups,1);}
});

test('cross-publisher main navigation is aborted and never evaluated',async()=>{
 let rejected;const f=fake({go:async({network})=>{rejected=network({url:'https://attacker.example/'});await turn();}});
 const result=await publisherRender(event(),{launchBrowser:f.launchBrowser});assert.equal(result.reasonCode,'redirect_mismatch');assert.equal(rejected.aborted,true);assert.equal(f.evaluations,0);
});

test('deadline closes an owned browser even if a later operation has not settled',async()=>{
 const f=fake();f.page.goto=async()=>new Promise(()=>{});
 const result=await publisherRender(event(),{launchBrowser:f.launchBrowser,budgetMs:2005});
 assert.equal(result.reasonCode,'timed_out');assert(f.calls.some(x=>x[0]==='browser-close'));assert.equal(f.cleanups,1);
});

test('a launcher settling after the deadline still closes its late browser',async()=>{
 const f=fake();let release;const pending=new Promise(resolve=>{release=resolve;});
 const result=await publisherRender(event(),{launchBrowser:()=>pending,budgetMs:2005});assert.equal(result.reasonCode,'timed_out');
 release(await f.launchBrowser({}));await turn();await turn();assert(f.calls.some(x=>x[0]==='browser-close'));assert.equal(f.cleanups,1);assert.equal(f.evaluations,0);
});

test('renderer failures log a bounded stage and safe code without changing the output contract',async()=>{
 const lines=[];const result=await publisherRender(event(),{launchBrowser:async()=>{throw Object.assign(Error('PRIVATE URL https://private.example/?token=private'),{code:'ENOENT'});},log:line=>lines.push(line)});
 assert.equal(result.state,'unavailable');assert.equal(result.reasonCode,'request_failed');assert.equal(result.httpStatus,null);assert(lines.some(line=>line.includes('ENOENT')));assert.doesNotMatch(lines.join('\n'),/PRIVATE|https:|token=private/);
 assert.deepEqual(Object.keys(result).sort(),['blocks','checkedAt','date','httpStatus','reasonCode','receipts','sourceURL','state','status','title']);
});

test('browser-side snapshot only returns visible media/head metadata, no body prose or hidden state',()=>{
 const parsed=parseHTML('<html><head><link rel="canonical" href="'+url+'"><meta property="og:title" content="'+title+'"><script type="application/ld+json">{"articleBody":"PRIVATE JSON","video":"https://example.org/private.mp4"}</script></head><body><article><h1>'+title+'<span hidden>PRIVATE HIDDEN TITLE</span></h1><p>PRIVATE BODY PROSE</p><iframe src="https://www.youtube.com/watch?v=AbCdEfGh123" title="Visible player"></iframe><div hidden><img src="https://example.org/hidden.jpg"></div><aside><img src="https://example.org/related.jpg"></aside></article></body></html>');
 const originals={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 try{
  globalThis.document=parsed.document;globalThis.location={href:url};globalThis.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',filter:'none'});
  for(const node of parsed.document.querySelectorAll('*'))node.getBoundingClientRect=()=>({width:100,height:100});
  const snapshot=readRenderedPreview();assert.equal(snapshot.media.length,1);assert.equal(snapshot.media[0].tag,'IFRAME');assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE|hidden.jpg|related.jpg|articleBody/);
 }finally{for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('archive integrity check fails before extraction and local runtime cannot start on this host',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'rr-render-synthetic-'));try{
  const file=join(folder,'synthetic.txt'),text='Synthetic integrity test, not a browser archive';await writeFile(file,text);
  const manifest={bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};
  assert.equal(await verifyPackFile(file,manifest),true);await assert.rejects(verifyPackFile(file,{...manifest,sha256:'0'.repeat(64)}),/pack_integrity/);await assert.rejects(verifyPackFile(file,{...manifest,bytes:1}),/pack_integrity/);
 }finally{await rm(folder,{recursive:true,force:true});}
 if(process.platform!=='linux'||process.arch!=='arm64'||process.env.AWS_LAMBDA_FUNCTION_NAME!=='reading-room-library')await assert.rejects(launchPublicBrowser(),/render_runtime_unavailable/);
});
