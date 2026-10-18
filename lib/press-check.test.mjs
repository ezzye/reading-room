import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {webcrypto} from 'node:crypto';
const html=readFileSync(new URL('./press-check.html',import.meta.url),'utf8');
const script=readFileSync(new URL('./press-check.mjs',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness({count=12,failAt=-1,holdFirst=false,signedOut=false,extraApproved=0}={}){
 const families=Array.from({length:count},(_,i)=>({family:'Test paper '+i,stories:[{title:i===0?'<img src=x onerror=alert(1)>':'Synthetic headline '+i,url:'https://news'+i+'.example/story/report-'+i}],error:null}));
 const selection={label:'Synthetic press check',families,room:{id:'one',name:'Private test room'}};
 const {window}=parseHTML(html.replace('<!-- PRESS_CHECK_SOURCES -->',JSON.stringify(selection).replace(/</g,'\\u003c'))),document=window.document,calls=[];
 let run=null,release;
 const gate=new Promise(resolve=>release=resolve);
 const fetch=async(path,options={})=>{
  const actualPath=path;path=new URL(path,'https://reader.example').pathname;const body=options.body?JSON.parse(options.body):null;calls.push({path,actualPath,body,options});
  if(signedOut)return {ok:false,status:401,json:async()=>({error:'Sign in to this private room.'})};
  if(path==='/api/room/press-audit'&&body){run={id:'run-one',label:selection.label,entries:body.urls.map((s,i)=>({id:'e'+i,url:s.url,sourceHeadline:s.sourceHeadline,status:'approved'})).concat(Array.from({length:extraApproved},(_,i)=>({id:'deferred'+i,url:'https://deferred.example/news/local-story-'+i,sourceHeadline:'Deferred local headline',status:'approved'})))};return {ok:true,json:async()=>({run})};}
  if(path.startsWith('/api/room/press-audit'))return {ok:true,json:async()=>({runs:run?[structuredClone(run)]:[]})};
  if(path==='/api/room-articles'){
   const entry=run.entries.find(e=>e.id===body.auditEntryId);entry.status='claimed';
   if(holdFirst&&entry.id==='e0')await gate;
   if(entry.id==='e'+failAt){entry.status='failed';entry.error='The source refused this request.';return {ok:false,status:422,json:async()=>({error:entry.error})};}
   entry.status='saved';entry.href='/read/'+'a'.repeat(48)+'?room=one';entry.summary={paragraphCount:7,imageCount:2,videoCount:1,annotationCount:4};return {ok:true,json:async()=>({href:entry.href})};
  }
  throw Error('Unexpected request');
 };
 const context=vm.createContext({document,fetch,location:{origin:'https://reader.example',assign(){}},URL,Blob,Map,crypto:webcrypto,setTimeout,structuredClone,JSON,Number,encodeURIComponent});
 vm.runInContext(script,context);
 const click=id=>document.getElementById(id).dispatchEvent(new window.Event('click'));
 return {document,calls,click,release,run:()=>run};
}
test('press check displays source metadata as text and creates no run on load',async()=>{
 const h=harness();await flush();assert.equal(h.calls.length,1);assert.ok(h.calls.every(x=>new URL(x.actualPath,'https://reader.example').searchParams.get('room')==='one'));assert.equal(h.document.querySelectorAll('tbody tr').length,12);assert.equal(h.document.querySelector('tbody img'),null);assert.match(h.document.querySelector('tbody').textContent,/<img src=x/);assert.equal(h.document.getElementById('first-ten').disabled,true);
});
test('owner controls import the first ten once, preserve failures and continue only approved sources',async()=>{
 const h=harness({failAt:3});await flush();h.click('create');await flush();assert.equal(h.calls.filter(x=>x.path==='/api/room-articles').length,0);h.click('first-ten');for(let n=0;n<4;n++)await flush();
 const imports=h.calls.filter(x=>x.path==='/api/room-articles');assert.equal(imports.length,10);assert.equal(new Set(imports.map(x=>x.body.auditEntryId)).size,10);assert.ok(imports.every(x=>x.body.auditRunId==='run-one'&&x.body.tryOriginal));assert.match(h.document.getElementById('results').textContent,/source refused/);assert.match(h.document.getElementById('results').textContent,/2 image references/);assert.equal(h.document.getElementById('continue').disabled,false);
 h.click('continue');for(let n=0;n<4;n++)await flush();assert.equal(h.calls.filter(x=>x.path==='/api/room-articles').length,12);assert.equal(h.document.getElementById('continue').disabled,true);
});
test('pause does not start another source after the active request completes',async()=>{
 const h=harness({holdFirst:true});await flush();h.click('create');await flush();h.click('continue');await flush();h.click('pause');h.release();for(let n=0;n<4;n++)await flush();assert.equal(h.calls.filter(x=>x.path==='/api/room-articles').length,1);assert.match(h.document.getElementById('status').textContent,/Paused/);
});
test('signed-out check reports the authentication failure and does not register or import',async()=>{
 const h=harness({signedOut:true});await flush();assert.match(h.document.getElementById('status').textContent,/Sign in/);assert.ok(h.calls.every(x=>!x.body));assert.equal(h.document.querySelectorAll('a[href^="/read/"]').length,0);
});

test('a narrowed selection leaves previously approved local sources unattempted',async()=>{
 const h=harness({count:2,extraApproved:2});await flush();h.click('create');await flush();h.click('continue');for(let n=0;n<4;n++)await flush();
 const imports=h.calls.filter(x=>x.path==='/api/room-articles');assert.equal(imports.length,2);assert.ok(imports.every(x=>!x.body.url.includes('deferred.example')));assert.equal(h.run().entries.filter(x=>x.id.startsWith('deferred')&&x.status==='approved').length,2);assert.equal(h.document.getElementById('continue').disabled,true);assert.match(h.document.getElementById('progress').textContent,/2 of 2/);
});
