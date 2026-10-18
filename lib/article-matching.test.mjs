import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSavedArticles,safeURLMatch} from './article-matching.mjs';
const title='Historic clock towers burned during violent protests';
const row=(id,url,headline=title)=>({id,sourceURL:url,title:headline});
test('new Mirror and Sun profiles support exact saved identity and reviewed fuzzy matches',()=>{
 for(const host of ['mirror.co.uk','thesun.co.uk']){
  const url='https://'+host+'/news/2026/10/18/historic-clock-towers-burned-violent-protests/';
  assert.equal(safeURLMatch(url,url),true);
  const results=rankSavedArticles({headline:'Historic clock towers burnt during violent protests',publisher:host},[row('same',url),row('other','https://unrelated.example/news',title)]);
  assert.equal(results.length,1);assert.equal(results[0].auto,false);assert.equal(results[0].id,'same');
 }
});
test('twelve publisher URL profiles retain exact canonical identity',()=>{
 const urls=[
 'https://thetimes.com/uk/article/synthetic-garden-headline-abc123def',
 'https://theguardian.com/world/2026/oct/18/synthetic-garden-headline',
 'https://bbc.co.uk/news/articles/c123456789ab',
 'https://standard.co.uk/news/uk/synthetic-garden-headline-b1234567.html',
 'https://independent.co.uk/news/uk/synthetic-garden-headline-b1234567.html',
 'https://metro.co.uk/2026/10/18/synthetic-garden-headline-12345678/',
 'https://dawn.com/news/1234567',
 'https://indianexpress.com/article/world/synthetic-garden-headline-12345678/',
 'https://irishexaminer.com/news/arid-12345678.html',
 'https://hindustantimes.com/world-news/synthetic-garden-headline-101234567890123.html',
 'https://straitstimes.com/world/synthetic-garden-headline',
 'https://dailymaverick.co.za/article/2026-10-18-synthetic-garden-headline/',
 ];
 for(const url of urls){const decorated=url.replace('https://','https://www.')+'?utm_source=synthetic&CMP=Share#section';assert.equal(safeURLMatch(decorated,url),true,url);const result=rankSavedArticles({url:decorated},[row('one',url)]);assert.equal(result[0].auto,true,url);}
});
test('Times IDs survive changed slugs but different IDs never auto-route',()=>{
 const a='https://thetimes.com/uk/article/historic-clock-towers-burned-abc123def';
 const b='https://thetimes.com/world/article/renamed-synthetic-story-abc123def';
 const c='https://thetimes.com/uk/article/historic-clock-towers-burned-xyz987uvw';
 assert.equal(safeURLMatch(a,b),true);assert.equal(safeURLMatch(a,c),false);
 assert.equal(rankSavedArticles({url:a},[row('b',b)])[0].basis,'publisher-article-id');
 const result=rankSavedArticles({url:a,headline:title},[row('c',c)]);assert.equal(result.length,1);assert.equal(result[0].auto,false);
});
test('reordering, basic stemming and three distinctive terms produce review candidates',()=>{
 const saved=row('one','https://telegraph.co.uk/world-news/2026/10/18/synthetic-clock-towers-burned-protests/');
 const result=rankSavedArticles({headline:'Violent protest during historic clock tower burnt'},[saved]);assert.equal(result.length,1);assert.equal(result[0].auto,false);assert.ok(result[0].score>=0.65);
 assert.deepEqual(rankSavedArticles({headline:'clock tower'},[saved]),[]);
});
test('same event is ambiguous, fuzzy URLs stay on the supplied domain and dates cannot conflict',()=>{
 const a=row('a','https://telegraph.co.uk/world/2026/10/18/historic-clock-towers-burned-violent-protests');
 const b=row('b','https://telegraph.co.uk/world/2026/10/18/violent-protests-historic-clock-towers-burned');
 const result=rankSavedArticles({headline:title},[a,b]);assert.equal(result.length,2);assert.ok(result.every(x=>x.ambiguous&&!x.auto));
 assert.deepEqual(rankSavedArticles({url:a.sourceURL,headline:title},[row('cross','https://theguardian.com/world/2026/oct/18/historic-clock-towers-burned-violent-protests')]),[]);
 assert.deepEqual(rankSavedArticles({url:a.sourceURL,headline:title},[row('dated',b.sourceURL.replace('/18/','/17/'))]),[]);
 assert.equal(safeURLMatch(a.sourceURL,b.sourceURL.replace('/18/','/17/')),false);
});
test('wrappers, scripts, credentials and mismatched publishers are rejected and results capped',()=>{
 const saved=row('a','https://theguardian.com/world/2026/oct/18/historic-clock-towers-burned-violent-protests');
 for(const url of ['javascript:alert(1)','https://google.com/url?q='+encodeURIComponent(saved.sourceURL),saved.sourceURL+'?utm_source=x&token=private','https://theguardian.com.evil.example/story']){assert.equal(safeURLMatch(url,url),false);assert.deepEqual(rankSavedArticles({url,headline:title},[saved]),[]);}
 assert.deepEqual(rankSavedArticles({headline:title,publisher:'The Times'},[saved]),[]);
 assert.equal(rankSavedArticles({headline:title},Array.from({length:9},(_,i)=>({...saved,id:String(i)}))).length,5);
 const duplicates=rankSavedArticles({url:saved.sourceURL},[{...saved,id:'a'},{...saved,id:'b'}]);assert.ok(duplicates.every(x=>x.ambiguous&&!x.auto));
});
