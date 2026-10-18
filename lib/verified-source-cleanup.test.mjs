import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSourceCleanup,VERIFIED_SOURCE_CLEANUP,normalizeCleanupText} from './verified-source-cleanup.mjs';
const text='A synthetic newsletter paragraph used only by the isolated unit test.';
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const capture=()=>({url:VERIFIED_SOURCE_CLEANUP.sourceURL,title:VERIFIED_SOURCE_CLEANUP.headline,presentation:{method:'public-url'},blocks:[{id:'keep',type:'paragraph',text:'Keep all reporting.'},{id:'remove',type:'paragraph',text},{id:'image',type:'figure',url:'https://example.org/photo.jpg',caption:'Keep image'}]});
test('exact synthetic snapshot proof selects one paragraph without changing any input or retrieving a source',async()=>{const value=capture(),before=structuredClone(value),proof={...VERIFIED_SOURCE_CLEANUP,paragraphLength:text.length,paragraphSHA256:await hash(text)};const result=await verifiedSourceCleanup(value,value.url,proof);assert.equal(result.known,true);assert.equal(result.blockId,'remove');assert.deepEqual(result.proof,proof);assert.deepEqual(value,before);assert.equal((await verifiedSourceCleanup(value,value.url,proof)).blockId,'remove');assert.equal(normalizeCleanupText('  one\n  two  '),'one two');});
test('changed text/hash, title, source URL, capture URL, duplicate paragraph/ID and library editions cannot match',async()=>{const proof={...VERIFIED_SOURCE_CLEANUP,paragraphLength:text.length,paragraphSHA256:await hash(text)};
 for(const mutate of [value=>value.blocks[1].text+='!',value=>value.title+=' changed',value=>value.url=value.url.replace('2258269','2258270'),value=>value.blocks.push({...value.blocks[1],id:'second'}),value=>value.blocks.push({...value.blocks[0]}),value=>value.presentation.method='library-text']){const value=capture();mutate(value);assert.equal((await verifiedSourceCleanup(value,VERIFIED_SOURCE_CLEANUP.sourceURL,proof)).blockId,undefined);}
 assert.equal((await verifiedSourceCleanup(capture(),VERIFIED_SOURCE_CLEANUP.sourceURL.replace('2258269','2258270'),proof)).blockId,undefined);
 assert.equal((await verifiedSourceCleanup(capture(),VERIFIED_SOURCE_CLEANUP.sourceURL,{...proof,paragraphSHA256:'0'.repeat(64)})).blockId,undefined);
 // Production's fixed fingerprint does not accept our synthetic paragraph.
 assert.equal((await verifiedSourceCleanup(capture(),VERIFIED_SOURCE_CLEANUP.sourceURL)).blockId,undefined);
});
