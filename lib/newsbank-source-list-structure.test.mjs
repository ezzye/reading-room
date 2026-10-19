import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {inspectSourceListStructure,sanitizeSourceListStructure} from './newsbank-source-list-structure.mjs';
import {nativeSourceURL,inspectNativeSourcePage,sanitizeNativeSources,NATIVE_SOURCE_QUERY} from './newsbank-native-sources.mjs';
const base='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
const inspect=html=>inspectSourceListStructure(parseHTML(html).document,base,nativeSourceURL);
test('source-list structure exposes synthetic outside-form controls, non-row containers and actual endpoint attributes without reading values or scripts',()=>{
 const result=inspect('<html><head><script src="/sites/default/files/js/source-list.js?lang=en"></script><script>PRIVATE_INLINE_ACCOUNT</script></head><body><section id="source-list" class="source-catalogue wrapper"><div class="source-list-items" data-ajax-url="/apps/news/source-data?p=UKNB"><label for="source-filter">Source name</label><input id="source-filter" name="source-filter" value="PRIVATE_TYPED_QUERY"><table><tr><td>PRIVATE_TABLE_TEXT</td></tr></table></div></section><form id="source-search"><input name="source-account" value="PRIVATE_CARD"><select name="frequency"><option>PRIVATE_ALERT</option></select></form><aside class="saved-sources"><div id="source-saved-records">PRIVATE_SAVED</div></aside></body></html>');
 assert.equal(result.schema,'newsbank-source-list-structure/v1');assert.deepEqual(result.tableCounts,{tables:1,rows:1,cells:1});assert(result.containers.some(row=>row.id==='source-list'));assert.deepEqual(result.controls,[{tag:'input',type:'text',name:'source-filter',id:'source-filter',label:'Source name'}]);assert.deepEqual(result.scriptURLs,['https://infoweb.newsbank.com/sites/default/files/js/source-list.js?lang=en']);assert.deepEqual(result.endpoints,[{attribute:'data-ajax-url',url:'https://infoweb.newsbank.com/apps/news/source-data?p=UKNB'}]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|value|frequency|saved|account|inline/i);
});
test('hidden CSS, article contexts, personal controls and unsafe script/endpoint identities supply no diagnostic evidence',()=>{
 const result=inspect('<style>.concealed{display:none}</style><div id="source-list"><div class="source-concealed concealed" data-source-url="/apps/news/source-hidden?p=UKNB"><input name="source-hidden"></div><article><div id="source-article"><input name="source-body"><script src="/js/article.js"></script></div></article><div id="source-list-aabbccddeeff001122"><input type="password" name="source-password" value="PRIVATE_PASSWORD"></div><input name="source-session" aria-label="Source PRIVATE_PERSON"><script src="https://attacker.example/js/source-list.js"></script><script src="/js/source-list.js?token=PRIVATE"></script><script src="/apps/news/account.js"></script><div class="source-list-items" data-endpoint="/apps/news/document-view?p=UKNB&amp;docref=news/ABCDEF" data-source-url="/apps/news/source-data?p=UKNB&amp;card=PRIVATE" data-ajax-url="{&quot;body&quot;:&quot;PRIVATE_STATE&quot;}"></div><template><div id="source-template"></div></template></div>');
 assert.equal(result.controls.length,0);assert.equal(result.scriptURLs.length,0);assert.equal(result.endpoints.length,0);assert.doesNotMatch(JSON.stringify(result),/concealed|source-article|source-body|aabbcc|PRIVATE|source-template|ABCDEF|attacker/);
 for(const route of [base+'&page=2',base.replace('/source-list','/results'),base.replace('/source-list','/document-view'),base.replace('infoweb.newsbank.com','attacker.example')])assert.equal(inspectSourceListStructure(parseHTML('<div id="source-list"></div>').document,route,nativeSourceURL),null);
});
test('fixed sanitizer bounds reject payload fields and never forward opaque IDs or unknown attributes',()=>{
 const page=inspect('<div id="source-list"></div>');
 for(const key of ['body','html','values','cookies','account','cardNumber','session','inlineJS'])assert.equal(sanitizeSourceListStructure({...page,[key]:'PRIVATE'},nativeSourceURL),null);
 const result=sanitizeSourceListStructure({...page,containers:Array.from({length:40},()=>({tag:'div',id:'source-list',classes:['source-list','source-secret','source-'+ 'a'.repeat(32)],childElements:Infinity,descendantElements:-1,tables:100000,rows:2,body:'PRIVATE'})),controls:Array.from({length:30},()=>({tag:'input',type:'search',name:'source-filter',id:'source-filter',label:'Filter sources',value:'PRIVATE',options:['PRIVATE']})),scriptURLs:Array.from({length:20},(_,i)=>'https://infoweb.newsbank.com/js/source-'+i+'.js'),endpoints:Array.from({length:20},()=>({attribute:'data-source-url',url:'/apps/news/source-data?p=UKNB'}))},nativeSourceURL);
 assert.equal(result.containers.length,30);assert.equal(result.controls.length,20);assert.equal(result.scriptURLs.length,20);assert.equal(result.endpoints.length,0);assert.equal(result.containers[0].tables,10000);assert.equal(result.containers[0].childElements,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|secret|a{32}|options|body|value/i);
});
test('native source page integrates structure only on the exact source list and excludes all source-list forms',()=>{
 const {document}=parseHTML('<div id="source-list"><input name="source-filter" aria-label="Filter sources"></div><form><input name="source-filter" value="PRIVATE"><select name="frequency"></select></form>');
 const page=inspectNativeSourcePage(document,base,'source-list');assert.equal(page.forms.length,0);assert.equal(page.structure.controls.length,1);
 const raw={status:'native-sources',schema:'newsbank-native-sources/v1',fixedQuery:NATIVE_SOURCE_QUERY,pages:[page],sourceListOpened:true,articleOpened:false,followedSourceLinks:false};const result=sanitizeNativeSources(raw);assert(result);assert.equal(result.pages[0].structure.controls.length,1);assert.equal(sanitizeNativeSources({...raw,pages:[{...page,structure:{...page.structure,body:'PRIVATE'}}]}),null);assert.equal(sanitizeNativeSources({...raw,pages:[{...page,stage:'entry',path:'/apps/news/'}]}),null);
 const other=inspectNativeSourcePage(document,'https://infoweb.newsbank.com/apps/news/results?p=UKNB','results');assert.equal(other.structure,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|values|frequency/);
});

test('same-host static script paths outside the former directory list are observed with fixed omission counts only',()=>{
 const result=inspect('<html><head><script src="/static/js/source-browse.abcd1234.js?v=20261019"></script><script src="/bundles/source-browse.js?ver=2.4.1"></script><script src="https://assets.example.org/react.js?session=PRIVATE_EXTERNAL"></script><script src="/js/loader.php"></script><script src="/js/source.js?include=PRIVATE_STATE"></script><script src="/js/account.js"></script><script src="/js/hidden.js" hidden></script><script>PRIVATE_INLINE</script></head><body><div class="nbcore-react-browse-container"></div></body></html>');
 assert.deepEqual(result.scriptURLs,['https://infoweb.newsbank.com/static/js/source-browse.abcd1234.js?v=20261019','https://infoweb.newsbank.com/bundles/source-browse.js?ver=2.4.1']);
 assert.deepEqual(result.scriptObservations,{total:7,inspected:7,reasons:{sameOriginAccepted:2,externalOrigin:1,nonStaticPath:1,unsafeQuery:1,sensitivePath:1,invalidReference:0,hiddenOrExcluded:1},truncated:false});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|assets\.example|include|loader\.php|account\.js|hidden\.js/);
});
test('script summaries are bounded fixed enums and do not establish observed API routes or fetch script contents',()=>{
 const page=inspect(Array.from({length:130},(_,i)=>'<script src="/static/source-'+i+'.js"></script>').join(''));assert.equal(page.scriptURLs.length,24);assert.equal(page.scriptObservations.inspected,120);assert.equal(page.scriptObservations.total,130);assert.equal(page.scriptObservations.truncated,true);assert.equal(page.endpoints.length,0);
 const clean=sanitizeSourceListStructure({...page,scriptObservations:{...page.scriptObservations,body:'PRIVATE_BODY',reasons:{...page.scriptObservations.reasons,arbitraryQuery:'PRIVATE_QUERY'}}},nativeSourceURL);assert(clean);assert.doesNotMatch(JSON.stringify(clean),/PRIVATE|body|arbitraryQuery/);
 assert.equal(sanitizeSourceListStructure({...page,scriptObservations:{...page.scriptObservations,inspected:121}},nativeSourceURL),null);
});


test('script URL queries permit only numeric asset versions or short locale codes, never arbitrary keys or values',()=>{
 const result=inspect('<script src="/static/one.js?v=opaquevalue"></script><script src="/static/two.js?theme=custom"></script><script src="/static/three.js?locale=en-GB"></script><script src="/static/four.js?ver=2.4.1&amp;session=PRIVATE_TOKEN"></script>');
 assert.deepEqual(result.scriptURLs,['https://infoweb.newsbank.com/static/three.js?locale=en-GB']);assert.equal(result.scriptObservations.reasons.unsafeQuery,3);assert.equal(result.scriptObservations.reasons.sameOriginAccepted,1);assert.doesNotMatch(JSON.stringify(result),/opaquevalue|theme=|custom|PRIVATE_TOKEN|session=/);
});


test('twenty-one accepted static references survive the bounded source-list sanitizer without path priorities',()=>{
 const urls=Array.from({length:21},(_,i)=>'https://infoweb.newsbank.com/static/synthetic-dependency-'+i+'.js?v=1.2.3');
 const {document}=parseHTML(urls.map(url=>'<script src="'+url+'"></script>').join('')+'<script src="/static/rejected.js?session=PRIVATE_TOKEN"></script>');
 const page=inspectNativeSourcePage(document,base,'source-list'),result=sanitizeNativeSources({status:'native-sources',schema:'newsbank-native-sources/v1',fixedQuery:NATIVE_SOURCE_QUERY,pages:[page],sourceListOpened:true,articleOpened:false,followedSourceLinks:false});
 assert.deepEqual(result.pages[0].structure.scriptURLs,urls);assert.equal(result.pages[0].structure.truncated,false);assert.equal(result.pages[0].structure.scriptObservations.reasons.sameOriginAccepted,21);assert.equal(result.pages[0].structure.scriptObservations.reasons.unsafeQuery,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOKEN|rejected\.js|session=/);
});
