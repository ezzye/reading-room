import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {PAPERS} from './newspaper-core.mjs';
import {roomArticlesAPI} from './room-articles.ts';
import {roomDiscussionAPI} from './room-discussion.ts';
import {VOX_FEED_URL} from './vox-public-feed.mjs';

registerHooks({load(url,context,next){if(url.endsWith('/critical-times.html?raw'))return {format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(url),'utf8')),shortCircuit:true};return next(url,context);}});
const {roomReader}=await import('./room-reader.ts');

const origin='https://reader.example',owner='vox-test-owner',member='vox-test-member',roomA='vox-room-a',roomB='vox-room-b';
const articleURL='https://www.vox.com/future-perfect/fictional-room-feed-story';
const canonicalURL='https://vox.com/future-perfect/fictional-room-feed-story';
const missingURL='https://www.vox.com/future-perfect/fictional-restricted-story';
const canonicalMissingURL='https://vox.com/future-perfect/fictional-restricted-story';
const now='2026-10-24T12:00:00.000Z';
const atom='http://www.w3.org/2005/Atom';
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();

function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of migrations)sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const [id,role] of [[owner,'owner'],[member,'member']])sql.prepare('INSERT INTO rr_members(id,display_name,role,created_at) VALUES(?,?,?,?)').run(id,id===owner?'Room owner':'Room member',role,now);
 for(const id of [roomA,roomB]){
  sql.prepare('INSERT INTO rr_rooms(id,name,owner_id,created_at,moderation) VALUES(?,?,?,?,?)').run(id,id,owner,now,'open');
  for(const [memberId,role] of [[owner,'owner'],[member,'member']])sql.prepare('INSERT INTO rr_room_members(room_id,member_id,role,joined_at) VALUES(?,?,?,?)').run(id,memberId,role,now);
 }
 const DB={
  async batch(items){sql.exec('BEGIN');try{const results=items.map(item=>item._run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}},
  prepare(query){const statement=sql.prepare(query),wrap=args=>({_run:()=>({success:true,meta:{changes:Number(statement.run(...args).changes)}}),first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({success:true,meta:{changes:Number(statement.run(...args).changes)}})});return {...wrap([]),bind(...args){return wrap(args);}};}
 };
 return {sql,DB};
}
const config=DB=>({DB,DEEPSEEK_API_KEY:'synthetic-key'});
function request(path,room,memberId,method='GET',body){return new Request(origin+path,{method,headers:{Origin:origin,'X-Reading-Room':'1','Sec-Fetch-Site':'same-origin','x-rr-room-id':room,'x-ret-member-id':memberId,'x-ret-member-role':memberId===owner?'owner':'member',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
const long=label=>`${label}: this fictional example describes a community comparing several possible approaches to an invented local question. Residents identify practical constraints, explain which outcomes matter to them, and consider how different choices could affect people in distinct situations. The account is synthetic, contains no real people or events, and is supplied only to exercise the private reading-room workflow. Readers can discuss the order of ideas, the kinds of evidence that would help, and what questions remain open.`;
const articleHTML=`<p>${long('Opening paragraph')}</p><figure><img src="https://images.example.org/fictional-vox-scene.jpg" alt="A fictional town meeting"><figcaption>A fictional town meeting. <cite>Example Photographer</cite></figcaption></figure><h2>Questions for discussion</h2>${['Second paragraph','Third paragraph','Fourth paragraph','Fifth paragraph','Sixth paragraph'].map(label=>`<p>${long(label)}</p>`).join('')}`;
const cdata=value=>'<![CDATA['+String(value).replace(/\]\]>/g,']]]]><![CDATA[>')+']]>';
const atomEntry=(href,content=articleHTML)=>`<entry><author><name>Example Reporter</name></author><title type="text">A fictional Vox feed article for Reading Room</title><link rel="alternate" type="text/html" href="${href}"/><id>https://www.vox.com/?p=fictional-room-feed-story</id><published>2026-10-24T10:30:00Z</published><content type="html">${cdata(content)}</content></entry>`;
const feedXML=(entries)=>`<?xml version="1.0"?><feed xmlns="${atom}"><title type="text">Vox</title><id>${VOX_FEED_URL}</id><link rel="self" type="application/atom+xml" href="${VOX_FEED_URL}"/>${entries}</feed>`;
const xmlResponse=xml=>new Response(xml,{status:200,headers:{'Content-Type':'application/atom+xml; charset=utf-8'}});
const paidHTML='<!doctype html><html><head><title>A fictional Vox restricted article</title><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><article><h1>A fictional Vox restricted article</h1><p>Subscribe to continue reading this article.</p></article></body></html>';

test('Vox feed creates a private room edition with feed provenance, commentary, and isolated discussion',async()=>{
 const {sql,DB}=database(),c=config(DB),calls=[],feed=feedXML(atomEntry(articleURL));
 // Allow the ordinary public-HTML fallback to run in the negative case below.
 PAPERS['vox.com']={name:'Vox',color:'#e85d3f',serif:'Georgia, serif',body:'article'};
 let sentBlocks=[];
 const fetcher=async(url,init={})=>{
  calls.push({url,init});
  if(url===VOX_FEED_URL){assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers['User-Agent'],'ReadEveryThing/1.0 (public article reader)');assert.equal(init.headers.Cookie,undefined);return xmlResponse(feed);}
  if(url==='https://api.deepseek.com/chat/completions'){
   const payload=JSON.parse(init.body),sent=JSON.parse(payload.messages[1].content);sentBlocks=sent.blocks;
   const paragraphs=sentBlocks.filter(block=>block.type==='paragraph');assert(paragraphs.length>=6);assert(paragraphs.every(block=>block.id));
   return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({annotations:[
    {blockId:paragraphs[0].id,title:'Order of ideas',comment:'The opening establishes a frame before the later examples arrive. A reader can consider how that sequence shapes the questions that follow.',question:'What other order might make the choices easier to compare?'},
    {blockId:paragraphs[2].id,title:'Evidence to seek',comment:'The passage invites readers to think about which kinds of evidence would help weigh the alternatives.',question:'What information would you want before forming a view?'}
   ]})}}]});
  }
  if(url===canonicalURL||url===canonicalMissingURL){assert.equal(init.headers.Cookie,undefined);return new Response(paidHTML,{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  throw Error('Unexpected network destination: '+url);
 };

 const add=request('/api/room-articles',roomA,member,'POST',{url:articleURL,requestId:crypto.randomUUID()});
 const response=await roomArticlesAPI(add,c,fetcher),added=await response.json();
 assert.equal(response.status,200,JSON.stringify(added));assert.equal(added.cached,false);assert.equal(added.href,'/read/'+added.id+'?room='+roomA);
 assert.equal(calls.filter(call=>call.url===articleURL||call.url===canonicalURL).length,0,'an exact feed match must never fetch the article webpage');
 assert.equal(calls.filter(call=>call.url===VOX_FEED_URL).length,1);assert.equal(calls.filter(call=>call.url==='https://api.deepseek.com/chat/completions').length,1);
 const row=sql.prepare('SELECT * FROM education_pages WHERE id=?').get(added.id),saved=JSON.parse(row.document),capture=saved.capture;
 assert.equal(row.source_url,canonicalURL);assert.equal(row.title,capture.title);assert.equal(saved.kind,'rendered-capture-v1');assert.equal(capture.presentation.method,'public-feed');assert.equal(capture.diagnostics.publisherFeedURL,VOX_FEED_URL);
 assert(capture.blocks.some(block=>block.type==='figure'&&block.url==='https://images.example.org/fictional-vox-scene.jpg'));
 assert.equal(saved.annotations.length,2);assert(saved.annotations.every(note=>sentBlocks.some(block=>block.id===note.blockId)));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles WHERE room_id=? AND page_id=?').get(roomA,added.id).n,1);

 const read=await roomReader(request('/read/'+added.id,roomA,member),c);assert.equal(read.status,200);const readHTML=await read.text();
 assert.match(readHTML,/id="rr-feed-edition"[^>]*>Vox public RSS edition/);assert.match(readHTML,/Vox public RSS edition\. Text and available images come from the article published in Vox’s public feed/);assert.match(readHTML,/https:\/\/www\.vox\.com\/rss\/index\.xml/);
 const details=[...readHTML.matchAll(/<details\b[^>]*class="[^"]*ai-disclosure[^"]*"[^>]*>/g)].map(match=>match[0]);assert.equal(details.length,2);assert(details.every(markup=>!/\bopen(?:\s|=|>)/i.test(markup)),'commentary disclosures start closed');
 assert.equal((await roomReader(request('/read/'+added.id,roomB,member),c)).status,404,'another room cannot read this edition');

 const root=await roomDiscussionAPI(request('/api/room-discussion?page='+added.id+'&room='+roomA,roomA,member,'POST',{pageId:added.id,action:'post',requestId:crypto.randomUUID(),text:'Let us compare what evidence each option would need.'}),c);
 assert.equal(root.status,201);const rootNote=await root.json();assert.equal(rootNote.pending,false);
 const reply=await roomDiscussionAPI(request('/api/room-discussion?page='+added.id+'&room='+roomA,roomA,owner,'POST',{pageId:added.id,action:'post',requestId:crypto.randomUUID(),parentId:rootNote.id,text:'A useful next step is to separate observed outcomes from expectations.'}),c);
 assert.equal(reply.status,201);const replyNote=await reply.json();assert.equal(replyNote.pending,false);
 const thread=await roomDiscussionAPI(request('/api/room-discussion?page='+added.id+'&room='+roomA,roomA,member),c),comments=(await thread.json()).comments;
 assert.equal(comments.length,2);assert.equal(comments.find(comment=>comment.id===replyNote.id).parentId,rootNote.id);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_comments WHERE room_id=? AND page_id=?').get(roomA,added.id).n,2);
 assert.equal((await roomDiscussionAPI(request('/api/room-discussion?page='+added.id+'&room='+roomB,roomB,member),c)).status,404);

 const commentaryCalls=calls.filter(call=>call.url==='https://api.deepseek.com/chat/completions').length;
 const failed=await roomArticlesAPI(request('/api/room-articles',roomA,member,'POST',{url:missingURL,requestId:crypto.randomUUID()}),c,fetcher),failure=await failed.json();
 assert.equal(failed.status,422,JSON.stringify(failure));assert.equal(sql.prepare('SELECT COUNT(*) n FROM education_pages WHERE source_url=?').get(missingURL).n,0);
 assert.equal(calls.filter(call=>call.url===canonicalMissingURL).length,1,'an absent feed entry may try the ordinary public page exactly once');
 assert.equal(calls.filter(call=>call.url==='https://api.deepseek.com/chat/completions').length,commentaryCalls,'a refused paid page gets no commentary request');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM rr_room_articles WHERE room_id=?').get(roomA).n,1);
});
