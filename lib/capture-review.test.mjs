import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {parseHTML} from 'linkedom';
const extension=new URL('../extension-page-lens/',import.meta.url);
const nonce='a'.repeat(48),origin='https://dayofflondon.com';
const prose='This original fixture contains readable article paragraphs for the review screen. It deliberately contains enough words to exercise the import threshold and lets a reader review text before an explicit import. No capture should be sent to a server merely because the extension supplied its reviewed payload. ';
const capture={schema:'ret-capture/v1',url:'https://telegraph.co.uk/fixture',title:'Fixture headline',blocks:[{type:'paragraph',text:prose},{type:'paragraph',text:prose}],diagnostics:{}};
function harness(){
 const html=readFileSync(new URL('./capture-review.html',import.meta.url),'utf8'),{window,document}=parseHTML(html);let record={capture,nonce,expiresAt:Date.now()+600000},calls=0,removed=0;
 const context={document,window,URL,CustomEvent:window.CustomEvent,location:{href:origin+'/capture-review?captureNonce='+nonce,origin,pathname:'/capture-review',protocol:'https:',hostname:'dayofflondon.com',assign(){}},chrome:{storage:{local:{get:async()=>({retReviewedCapture:record}),remove:async()=>{record=null;removed++;}}}},crypto,fetch:async()=>{calls++;return Response.json({href:'/read/'+'f'.repeat(48)+'?room=room1'});}};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);vm.runInContext(readFileSync(new URL('handoff.js',extension),'utf8'),context);return {window,document,calls:()=>calls,removed:()=>removed};
}
test('nonce handoff loads visible review with no upload until explicit confirmation and Import',async()=>{
 const h=harness();h.window.dispatchEvent(new h.window.CustomEvent('ret-capture-ready',{detail:{nonce:'b'.repeat(48),capture}}));assert.equal(h.document.getElementById('review').hidden,true);
 h.document.getElementById('receive').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.removed(),1);assert.equal(h.calls(),0);assert.equal(h.document.getElementById('title').textContent,capture.title);assert.equal(h.document.getElementById('review').hidden,false);assert.equal(h.document.getElementById('import').disabled,true);
 h.document.getElementById('confirm').checked=true;h.document.getElementById('confirm').onchange();await h.document.getElementById('import').onclick();assert.equal(h.calls(),1);
});
test('extension update retains its original permissions and opens the room review route',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',extension),'utf8'));assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.version,'0.1.3');assert.ok(manifest.content_scripts[0].matches.includes(origin+'/capture-review*'));assert.match(readFileSync(new URL('popup.js',extension),'utf8'),/reader\.example\.org\/capture-review/);
});
