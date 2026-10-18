import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
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

function edition(url=player){const capture=normalizeCapture({schema:'ret-capture/v1',url:'https://telegraph.co.uk/news/fictional-fixture/',title:'A fictional source-player fixture',blocks:[{type:'paragraph',text},{type:'video',url,caption:'Original visible caption <fixture>',credit:'Example source photographer',poster:'https://images.example.org/visible-poster.jpg'},{type:'paragraph',text}]});capture.blocks[1].provenance={basis:'measured-visible-browser-media',viewportBasis:'rendered-enabled-tab',osFocusVerified:false};return {id:'f'.repeat(48),document:{kind:CAPTURE_KIND,capture,annotations:[{blockId:'B2',title:'Separate interpretation',comment:'A fictional independent observation.',question:'What does this clip establish?'}]}};}
test('Telegraph uses exact ordinary source link first and a closed optional embedded player, retaining context',()=>{const page=edition(),before=JSON.stringify(page),{document}=parseHTML(renderCapture(page));const figure=document.querySelector('.video-source'),primary=figure.querySelector('a.watch-source-video'),option=figure.querySelector('details.embedded-player-option');assert.equal(primary.getAttribute('href'),player);assert.equal(primary.textContent,'Watch video on Telegraph ↗');assert.equal(primary.getAttribute('target'),'_blank');assert.equal(primary.getAttribute('rel'),'noopener noreferrer');assert.equal(option.hasAttribute('open'),false);assert.equal(option.querySelector('summary').textContent,'Try embedded player');assert.equal(option.querySelector('button.load-video').getAttribute('data-video'),player);assert.equal(figure.querySelector('iframe'),null);assert.match(figure.querySelector('figcaption').textContent,/Original visible caption <fixture>/);assert.match(figure.querySelector('figcaption').textContent,/Example source photographer/);assert.match(document.querySelector('#B2 .annotation').textContent,/Separate interpretation/);assert.equal(JSON.stringify(page),before);});
test('optional Telegraph loader still creates the exact iframe only on click and keeps the working source link',async()=>{const {document}=parseHTML(renderCapture(edition()));document.fonts={ready:Promise.resolve()};const script=[...document.querySelectorAll('script')].find(x=>x.textContent.includes("querySelectorAll('.load-video')"));vm.runInNewContext(script.textContent,{document});const option=document.querySelector('.embedded-player-option'),button=option.querySelector('.load-video');assert.equal(document.querySelector('iframe'),null);option.setAttribute('open','');button.onclick();const frame=option.querySelector('iframe');assert.equal(frame.getAttribute('src'),player);assert.equal(frame.getAttribute('sandbox'),null);assert.equal(document.querySelector('.watch-source-video').getAttribute('href'),player);assert.match(document.querySelector('figcaption').textContent,/Original visible caption/);await Promise.resolve();});
test('other providers and direct video retain their existing primary loader without Telegraph disclosure',()=>{for(const url of ['https://www.youtube-nocookie.com/embed/AbCdEfGh123','https://players.brightcove.net/5436121856001/TkNT2u3xG_default/index.html?videoId=6406965714112','https://images.example.org/fixture.mp4']){const {document}=parseHTML(renderCapture(edition(url))),figure=document.querySelector('.video-source');assert.equal(figure.querySelector('.watch-source-video'),null);assert.equal(figure.querySelector('.embedded-player-option'),null);assert.equal(figure.querySelector('.load-video').parentElement,figure);assert.equal(figure.querySelector('.load-video').getAttribute('data-video'),url);assert.equal(figure.querySelector('figcaption a').getAttribute('href'),url);}});
