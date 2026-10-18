import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPublicMedia,hasMissingVerifiedPublicMedia} from './verified-public-media.mjs';
const url='https://www.telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/';
const title='Historic clock tower falls as France burns on day of violent protests';
const capture=extra=>({url,title,blocks:[{id:'B1',type:'paragraph',text:'Retained private source text sentinel.'}],...extra});
test('one observed exact-article index thumbnail has fixed public provenance without source prose',()=>{
 const original=capture(),before=JSON.stringify(original),result=verifiedPublicMedia(original);assert.equal(result.matched,true);assert.equal(result.blocks.length,1);assert.equal(JSON.stringify(original),before);const block=result.blocks[0];
 assert.equal(block.url,'https://cf.eip.telegraph.co.uk/store/vid-media/63855445-e30c-46e3-8cb9-5bf8c8df7b8d/thumbnail.jpg');assert.equal(block.basis,'exact-article-public-index-thumbnail');assert.equal(block.originalPlacementVerified,false);assert.equal(block.observedAt,'2026-10-18');assert.equal(block.indexURL,'https://www.google.com/search?q=%22Historic+clock+tower+falls%22+Telegraph&udm=2');assert.match(block.credit,/video thumbnail.*found through Google Images/);assert.equal(result.receipts[0].sourceURL,url);assert.doesNotMatch(JSON.stringify(result),/Retained private source text sentinel|api_key|cookie|automatically searched/i);
});
test('fixed index proof requires exact source URL and headline and accepts a library deck suffix',()=>{
 assert.equal(hasMissingVerifiedPublicMedia(capture({title:title+' - A retained library deck.'})),true);
 assert.equal(hasMissingVerifiedPublicMedia(capture({url:url.replace('www.','').replace(/\/$/,'')})),true);
 for(const changes of [{url:url.replace('mass-protests','different-story')},{url:'https://telegraph.co.uk/other'},{title:'An unrelated synthetic headline'},{title:title+' unrelated added claim'},{url:url+'?token=private'}])assert.equal(verifiedPublicMedia(capture(changes)).matched,false);
 assert.equal(verifiedPublicMedia(capture(),'https://telegraph.co.uk/different-source/').matched,false);
});
test('an existing exact thumbnail is never duplicated and needs no new check',()=>{
 const result=verifiedPublicMedia(capture()),original=capture({blocks:[...capture().blocks,result.blocks[0]]});assert.equal(hasMissingVerifiedPublicMedia(original),false);assert.equal(verifiedPublicMedia(original).matched,true);assert.deepEqual(verifiedPublicMedia(original).blocks,[]);assert.deepEqual(verifiedPublicMedia(original).receipts,[]);
});
