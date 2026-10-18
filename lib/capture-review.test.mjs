import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {parseHTML} from 'linkedom';
const extension=new URL('../extension-page-lens/',import.meta.url);
const nonce='a'.repeat(48),origin='https://dayofflondon.com';
const prose='This original fixture contains readable article paragraphs for the review screen. It deliberately contains enough words to exercise the import threshold and lets a reader review text before an explicit import. No capture should be sent to a server merely because the extension supplied its reviewed payload. ';
const capture={schema:'ret-capture/v1',url:'https://telegraph.co.uk/fixture',title:'Fixture headline',blocks:[{type:'paragraph',text:prose},{type:'paragraph',text:prose}],diagnostics:{}};
function harness(value=capture,href='/read/'+'f'.repeat(48)+'?room=room1'){
 const html=readFileSync(new URL('./capture-review.html',import.meta.url),'utf8'),{window,document}=parseHTML(html);let record={capture:value,nonce,expiresAt:Date.now()+600000},calls=0,removed=0;const posts=[],destinations=[];
 const context={document,window,URL,CustomEvent:window.CustomEvent,location:{href:origin+'/capture-review?captureNonce='+nonce,origin,pathname:'/capture-review',protocol:'https:',hostname:'dayofflondon.com',assign(value){destinations.push(value)}},chrome:{storage:{local:{get:async()=>({retReviewedCapture:record}),remove:async()=>{record=null;removed++;}}}},crypto,fetch:async(_url,options)=>{calls++;posts.push(JSON.parse(options.body));return Response.json({href});}};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);vm.runInContext(readFileSync(new URL('handoff.js',extension),'utf8'),context);return {window,document,posts,destinations,calls:()=>calls,removed:()=>removed};
}
test('nonce handoff loads visible review with no upload until explicit confirmation and Import',async()=>{
 const h=harness();h.window.dispatchEvent(new h.window.CustomEvent('ret-capture-ready',{detail:{nonce:'b'.repeat(48),capture}}));assert.equal(h.document.getElementById('review').hidden,true);
 h.document.getElementById('receive').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.removed(),1);assert.equal(h.calls(),0);assert.equal(h.document.getElementById('title').textContent,capture.title);assert.equal(h.document.getElementById('review').hidden,false);assert.equal(h.document.getElementById('import').disabled,true);
 h.document.getElementById('confirm').checked=true;h.document.getElementById('confirm').onchange();await h.document.getElementById('import').onclick();assert.equal(h.calls(),1);
});
test('extension update declares its scoped bridge permissions and opens the room review route',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',extension),'utf8'));assert.deepEqual(manifest.permissions,['activeTab','scripting','storage','alarms']);assert.deepEqual(manifest.host_permissions,['https://reader.example.org/*']);assert.equal(manifest.version,'0.2.0');assert.ok(manifest.content_scripts[0].matches.includes(origin+'/capture-review*'));assert.match(readFileSync(new URL('popup.js',extension),'utf8'),/reader\.example\.org\/capture-review/);
});

const media={schema:'ret-media/v1',url:'https://telegraph.co.uk/fixture',title:'Visible article media',capturedAt:new Date().toISOString(),viewport:{width:1200,height:800},media:[{type:'figure',url:'https://images.example.org/visible.jpg',caption:'A visible caption'},{type:'video',url:'https://youtu.be/AbCdEfGh123'}],diagnostics:{visibleOnly:true}};
test('media-only review labels counts and appends only after explicit confirmation and import',async()=>{
 const h=harness(media);h.document.getElementById('receive').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.removed(),1);
 assert.match(h.document.getElementById('counts').textContent,/Media only.*1 images.*1 videos/);assert.match(h.document.getElementById('import-note').textContent,/No text is sent/);assert.equal(h.calls(),0);await h.document.getElementById('import').onclick();assert.equal(h.calls(),0);
 h.document.getElementById('confirm').checked=true;h.document.getElementById('confirm').onchange();await h.document.getElementById('import').onclick();assert.equal(h.calls(),1);assert.equal(h.posts[0].action,'media');assert.equal(h.posts[0].capture.schema,'ret-media/v1');assert.deepEqual(h.destinations,['/read/'+'f'.repeat(48)+'?room=room1']);
});
test('media review rejects an invalid schema or nonce and never follows an external import destination',async()=>{
 const h=harness(media);h.window.dispatchEvent(new h.window.CustomEvent('ret-capture-ready',{detail:{nonce:'b'.repeat(48),capture:media}}));assert.equal(h.document.getElementById('review').hidden,true);
 h.window.dispatchEvent(new h.window.CustomEvent('ret-capture-ready',{detail:{nonce,capture:{...media,diagnostics:{visibleOnly:false}}}}));assert.equal(h.document.getElementById('review').hidden,true);assert.equal(h.calls(),0);
 const external=harness(media,'https://evil.example/read/a');external.window.dispatchEvent(new external.window.CustomEvent('ret-capture-ready',{detail:{nonce,capture:media}}));external.document.getElementById('confirm').checked=true;external.document.getElementById('confirm').onchange();await external.document.getElementById('import').onclick();assert.deepEqual(external.destinations,[]);assert.match(external.document.getElementById('status').textContent,/unexpected destination/);
});
