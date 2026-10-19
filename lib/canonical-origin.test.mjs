import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {canonicalOrigin,shareURL} from './app-origin.mjs';
import {withDiscussion} from './discussion-view.mjs';

test('production origin mapping is exact and leaves unrelated, local and nonstandard origins alone',()=>{
 for(const origin of ['https://dayofflondon.com','https://www.dayofflondon.com','https://legacy.reader.example.org'])assert.equal(shareURL('a',origin+'/study'),'https://dayofflondon.com/s/a');
 for(const origin of ['http://localhost:3000','https://reader.example','https://dayofflondon.com.evil.example','https://dayofflondon.com:444','http://dayofflondon.com','https://another.chatgpt.site'])assert.equal(canonicalOrigin(origin+'/study'),origin);
});
test('embedded discussion and conversation sharing still run without module dependencies',()=>{
 const html=withDiscussion('<html><body></body></html>',{id:'a'.repeat(48)},{token:'b'.repeat(48)});
 const js=html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1],match=js.match(/const canonicalOrigin=(.*?);const config=/s);assert(match);
 const canonical=vm.runInNewContext('('+match[1]+')',{URL});assert.equal(canonical('https://legacy.reader.example.org/study'),'https://dayofflondon.com');
 const capture=readFileSync(new URL('./capture-studio.html',import.meta.url),'utf8'),appOrigin=capture.match(/function appOrigin\(\)\{[^}]+\}/)[0];
 assert.equal(vm.runInNewContext(appOrigin+';appOrigin()',{location:{origin:'https://legacy.reader.example.org'}}),'https://dayofflondon.com');
 const reader=readFileSync(new URL('./room-reader.ts',import.meta.url),'utf8');assert.match(reader,/shareOrigin:canonicalOrigin\(r.url\)/);assert.match(reader,/new URL\(d.path,c.shareOrigin\).href/);
});
