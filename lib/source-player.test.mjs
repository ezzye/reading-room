import test from 'node:test';
import assert from 'node:assert/strict';
import {videoEmbed,normalizeCapture,renderCapture,captureHeaders,CAPTURE_KIND} from './capture-core.mjs';
const host='cf-particle-html.eip.telegraph.co.uk';
const player='https://'+host+'/fictional-player/visible-frame.html?article=fixture&mode=inline&utm_source=fixture';
const text='This fictional community article describes an invented local meeting and the questions asked by the participants. The synthetic passage has enough ordinary words to exercise source capture validation without copying any reporting. Readers compare the different options and discuss a second perspective in the original supplied order. ';
test('exact Telegraph source iframe URL retains observed path and query through capture and rendered player reference',()=>{
 assert.equal(videoEmbed(player),player);
 const capture=normalizeCapture({schema:'ret-capture/v1',url:'https://telegraph.co.uk/news/fictional-fixture/',title:'A fictional source-player fixture',blocks:[{type:'paragraph',text},{type:'video',url:player,caption:'Visible player reference'},{type:'paragraph',text}]});
 assert.equal(capture.blocks.find(b=>b.type==='video').url,player);
 const html=renderCapture({id:'f'.repeat(48),document:{kind:CAPTURE_KIND,capture,annotations:[]}});
 assert.match(html,/data-video="https:\/\/cf-particle-html\.eip\.telegraph\.co\.uk\/fictional-player\/visible-frame\.html\?article=fixture&amp;mode=inline&amp;utm_source=fixture"/);
 assert.match(html,/playback is not confirmed/);
 const policy=captureHeaders['Content-Security-Policy'];assert.match(policy,/frame-src https:\/\/cf-particle-html\.eip\.telegraph\.co\.uk /);assert.doesNotMatch(policy,/frame-src[^;]*\*/);
});
test('Telegraph iframe acceptance rejects spoofed hosts, root paths, unsafe schemes and access-bearing URLs',()=>{
 const invalid=[
  'https://'+host+'/', 'https://'+host, 'https://'+host+'/./',
  'http://'+host+'/fixture', 'javascript:alert(1)', 'data:text/html,fixture',
  'https://www.'+host+'/fixture','https://'+host+'.evil.example/fixture','https://evil.'+host+'/fixture',
  'https://user:pass@'+host+'/fixture','https://'+host+':8443/fixture',
  'https://127.0.0.1/fixture','https://player.internal/fixture',
  ...['token','auth','session','signature','password','secret','api_key','credential','expires','policy','pin','borrower'].map(key=>'https://'+host+'/fixture?utm_source=x&'+key+'=private'),
 ];
 for(const value of invalid)assert.equal(videoEmbed(value),'',value);
 assert.equal(videoEmbed('https://'+host+'/fixture?mode=inline#section'),'https://'+host+'/fixture?mode=inline');
 assert.equal(videoEmbed('https://other-player.example.org/fixture'),'');
});
