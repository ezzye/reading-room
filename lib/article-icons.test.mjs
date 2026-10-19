import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom/worker';
import {ARTICLE_ICON_PROFILES,ARTICLE_ICON_PATHS,articleIconHref,withArticleIcon} from './article-icons.mjs';
import {PAPERS} from './newspaper-core.mjs';
import {LIBRARY_PUBLICATIONS} from './library-publications.mjs';
import {isPublicMemberAuthPath} from './member-auth.ts';
const page=(sourceURL,publisher='')=>({sourceURL,document:{capture:{publisher}}});

test('all registered public and library publishers have a bundled icon',()=>{
 for(const host of [...Object.keys(PAPERS),...Object.values(LIBRARY_PUBLICATIONS).flatMap(p=>p.hosts)])assert.notEqual(articleIconHref(page('https://'+host+'/article')),'/favicon.svg',host);
 for(const p of ARTICLE_ICON_PROFILES){
  const path='/publisher-icons/'+p.id+'.svg',svg=readFileSync(new URL('../public'+path,import.meta.url),'utf8');
  const {document}=parseHTML(svg);assert(document.querySelector('svg title'),path);
  assert(!/<script|<image|<foreignObject|https?:\/\//i.test(svg.replace('http://www.w3.org/2000/svg','')),path);
  assert(ARTICLE_ICON_PATHS.has(path));assert.equal(isPublicMemberAuthPath(path),true);
 }
});
test('exact source hosts select the badge even if supplied publisher text disagrees',()=>{
 assert.equal(articleIconHref(page('https://www.telegraph.co.uk/world/article','The Times')),'/publisher-icons/telegraph.svg?v=1');
 assert.equal(articleIconHref(page('https://m.bbc.com/news/a')),'/publisher-icons/bbc.svg?v=1');
 assert.equal(articleIconHref(page('https://www.dailymail.com/news/a')),articleIconHref(page('https://www.dailymail.co.uk/news/a')));
 for(const url of ['https://telegraph.co.uk.evil.example/a','https://evil.example/telegraph.co.uk','javascript:alert(1)','https://user:pass'+'@telegraph.co.uk/a'])assert.equal(articleIconHref(page(url,'The Telegraph')),'/favicon.svg');
});
test('library provider URLs use known bibliographic labels without confusing similarly named papers',()=>{
 for(const publication of Object.values(LIBRARY_PUBLICATIONS))for(const label of publication.canonicalLabels)assert.notEqual(articleIconHref(page('https://infoweb.newsbank.com/apps/news/document-view',label)),'/favicon.svg',label);
 assert.equal(articleIconHref(page('https://infoweb.newsbank.com/a','Financial Times')),'/publisher-icons/financial-times.svg?v=1');
 assert.equal(articleIconHref(page('https://infoweb.newsbank.com/a','Belfast Telegraph')),'/publisher-icons/belfast-telegraph.svg?v=1');
 assert.equal(articleIconHref(page('https://infoweb.newsbank.com/a','Unknown Times Newspaper')),'/favicon.svg');
 assert.equal(articleIconHref({document:{capture:{url:'https://www.theguardian.com/a'}}}),'/publisher-icons/guardian.svg?v=1');
});
test('one article icon replaces old tab icons without changing app-install branding or article content',()=>{
 const html='<!doctype html><html><head><title>Fictional article</title><link rel="icon" href="/old.ico"><link rel="shortcut ICON" href="/also-old.ico"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><p id="passage">Fictional source text</p><details class="ai-disclosure"><summary>AI critique</summary>Comment</details><script>const intact=true;</script></body></html>';
 const result=withArticleIcon(html,page('https://www.telegraph.co.uk/a')),{document}=parseHTML(result);
 assert.equal(document.querySelectorAll('link[rel="icon"]').length,1);assert.equal(document.querySelector('link[rel="icon"]').getAttribute('href'),'/publisher-icons/telegraph.svg?v=1');
 assert(!result.includes('/old.ico'));assert(!result.includes('/also-old.ico'));
 assert.equal(document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'),'/icon-192.png');
 assert.equal(document.querySelector('link[rel="manifest"]').getAttribute('href'),'/manifest.webmanifest');
 assert.equal(document.title,'Fictional article');assert.equal(document.getElementById('passage').textContent,'Fictional source text');assert(!document.querySelector('details').hasAttribute('open'));assert.equal(document.querySelector('script').textContent,'const intact=true;');
 assert.equal(parseHTML(withArticleIcon(result,page('https://unknown.example/a'))).document.querySelector('link[rel="icon"]').getAttribute('href'),'/favicon.svg');
});
test('only fixed badge assets are public, never article-specific or arbitrary filenames',()=>{
 for(const path of ['/publisher-icons/private.svg','/publisher-icons/telegraph.svg/extra','/publisher-icons/Telegraph.svg','/publisher-icons/../private.svg','/publisher-icons/telegraph.svg.bak','/read/abc'])assert.equal(isPublicMemberAuthPath(path),false,path);
});
