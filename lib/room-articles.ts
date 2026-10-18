import {requireRoom,accessiblePage} from './rooms.ts';
import {articleAPI} from './article-service.ts';
import {loadPage,providerCall} from './education-service.ts';
import type {Config} from './education-service.ts';
import {resourceURL} from './resource-service.ts';
import {mediaURL} from './capture-core.mjs';
import {rankSavedArticles,safeURLMatch} from './article-matching.mjs';
import {sameOrigin} from './edition-access.ts';
import {cleanPublisherHeadline} from './publisher-headline.mjs';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
export async function roomBody(request:Request,max=5000){
 if(Number(request.headers.get('content-length')||0)>max||!request.body)throw new Response('Invalid request',{status:400});
 const reader=request.body.getReader();let size=0,text='';const decoder=new TextDecoder();
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max)throw new Response('Request too large',{status:413});text+=decoder.decode(part.value,{stream:true});}const data=JSON.parse(text+decoder.decode());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}finally{await reader.cancel();}
}
export function shelfMetadata(row:any){
 let doc:any={};try{doc=typeof row.document==='string'?JSON.parse(row.document):row.document||{};}catch{}
 const capture=doc.capture;const image=mediaURL(capture?.blocks?.find((b:any)=>b.type==='figure')?.url||capture?.blocks?.find((b:any)=>b.type==='video')?.poster||'');
 let publisher=capture?.publisher||'';try{publisher||=new URL(row.source_url||row.sourceURL).hostname.replace(/^www\./,'');}catch{}
 publisher=publisher.replace(/\s*(?:\([^)]*Camden[^)]*\)|·\s*Camden.*)/gi,'').trim();if(publisher==='thetimes.com')publisher='The Times';
 const library=capture?.presentation?.method==='library-text'||capture?.diagnostics?.libraryTextEdition;
 const title=library?String(row.title).split(/\s+-\s+/)[0]:row.title;
 return {id:row.id,title,sourceURL:row.source_url||row.sourceURL,publisher,image,createdAt:row.addedAt||row.created_at,commentCount:Number(row.commentCount||0)};
}
export async function roomArticlesAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(r,c);
  if(r.method==='GET'){
   const rows=await c.DB.prepare(`SELECT p.id,p.title,p.source_url,p.document,a.created_at AS addedAt,
    (SELECT COUNT(*) FROM rr_room_comments m WHERE m.room_id=a.room_id AND m.page_id=p.id AND (m.status='approved' OR m.member_id=? OR ?='owner')) AS commentCount
    FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? ORDER BY a.created_at DESC,p.id LIMIT 100`).bind(room.member_id,room.role,room.id).all();
   const seen=new Set<string>();const articles=(rows.results||[]).map(shelfMetadata).filter(article=>{let key=article.sourceURL;try{key=resourceURL(key);}catch{}if(seen.has(key))return false;seen.add(key);return true;});
   return json({articles,room:{id:room.id,name:room.name,role:room.role}});
  }
  if(r.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(r))return json({error:'Use Reading Room to add an article.'},403);
  const data=await roomBody(r);
  if(data.action==='remove'){
   if(room.role!=='owner')return json({error:'Only the room owner can remove articles.'},403);
   if(!await accessiblePage(r,c,data.id))return json({error:'Article not found.'},404);
   await c.DB.prepare('DELETE FROM rr_room_articles WHERE room_id=? AND page_id=?').bind(room.id,data.id).run();return json({removed:true});
  }
  let url:string;try{url=resourceURL(data.url);}catch{return json({error:'Paste an article link.'},400);}
  const alternate=new URL(url);alternate.hostname='www.'+alternate.hostname;
  const existing:any=await c.DB.prepare('SELECT p.id FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? AND p.source_url IN (?,?) ORDER BY a.created_at DESC LIMIT 1').bind(room.id,url,alternate.href).first();
  if(existing)return json({id:existing.id,href:'/read/'+existing.id+'?room='+room.id,cached:true});
  const shelf=await c.DB.prepare('SELECT p.id,p.title,p.source_url FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? ORDER BY a.created_at DESC LIMIT 100').bind(room.id).all();
  const matches=rankSavedArticles({url},shelf.results||[]);const strong=matches.find((x:any)=>x.auto);if(strong)return json({id:strong.id,href:'/read/'+strong.id+'?room='+room.id,cached:true});
  if(matches.length&&!data.tryOriginal)return json({needsChoice:true,candidates:matches.map((x:any)=>({id:x.id,title:x.title,url:x.source_url,href:'/read/'+x.id+'?room='+room.id,basis:x.basis,ambiguous:x.ambiguous})),url});
  const forwardedHeaders=new Headers(r.headers);forwardedHeaders.delete('content-length');
  const result=await articleAPI(new Request(new URL('/api/articles',r.url),{method:'POST',headers:forwardedHeaders,body:JSON.stringify({url,requestId:data.requestId||crypto.randomUUID(),sourceHeadline:data.sourceHeadline})}),c,fetcher);
  const value=await result.json() as any;if(!result.ok)return json({error:value.error||'This article could not be opened.',...(value.needsHeadline?{needsHeadline:true}:{})},result.status);
  let id=value.id;if(!id&&typeof value.href==='string'){const match=value.href.match(/\/(?:preview|read)\/([a-f0-9]{48})/);id=match?.[1];}
  if(!id||!await accessiblePage(r,c,id))return json({error:'The article was not added to this room.'},502);
  return json({id,href:'/read/'+id+'?room='+room.id,cached:Boolean(value.cached)});
 }catch(error){if(error instanceof Response)return error;return json({error:'The article could not be added. Please try again.'},502);}
}

const publishers:Record<string,{name:string,domains:string[]}>= {
 times:{name:'The Times',domains:['thetimes.com']},guardian:{name:'The Guardian',domains:['theguardian.com']},bbc:{name:'BBC News',domains:['bbc.co.uk','bbc.com']},independent:{name:'The Independent',domains:['independent.co.uk']},telegraph:{name:'The Telegraph',domains:['telegraph.co.uk']},standard:{name:'The Standard',domains:['standard.co.uk']},metro:{name:'Metro',domains:['metro.co.uk']},mirror:{name:'Daily Mirror',domains:['mirror.co.uk']},sun:{name:'The Sun',domains:['thesun.co.uk']},mail:{name:'Daily Mail',domains:['dailymail.com','dailymail.co.uk']},star:{name:'Daily Star',domains:['dailystar.co.uk']},record:{name:'Daily Record',domains:['dailyrecord.co.uk']},nytimes:{name:'The New York Times',domains:['nytimes.com']},dawn:{name:'Dawn',domains:['dawn.com']}
};
function searchHost(url:string){return new URL(url).hostname.replace(/^(?:www|m|amp)\./,'');}
function searchPublisher(url:string){const host=searchHost(url);return Object.values(publishers).find(p=>p.domains.includes(host));}
export function headlineQueries(headline:string,domain?:string){
 const prefix=domain?'site:'+domain+' ':'';const available=128-prefix.length;
 const fit=(text:string)=>{if(text.length<=available)return prefix+text;const half=Math.floor((available-1)/2);return prefix+text.slice(0,half).replace(/\s+\S*$/,'')+' '+text.slice(-(available-half-1)).replace(/^\S*\s+/,'');};
 const compact=headline.split(/\s+/).filter(word=>! /^(?:a|an|the|as|at|by|for|from|in|is|it|of|on|to|with|and|or)$/i.test(word)).join(' ');
 return [...new Set([fit(headline),fit(compact||headline)])];
}
export async function articleSearchAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(r,c);if(r.method!=='POST')return json({error:'Method not allowed.'},405);if(!sameOrigin(r))return json({error:'Use the article search.'},403);
  const data=await roomBody(r),input=typeof data.headline==='string'?data.headline.trim():'';
  if(input.length>2000)return json({error:'Use up to 200 headline characters, or paste one article link.'},400);
  const choice=String(data.publisher||'all').toLowerCase();const publisher=publishers[choice]||Object.values(publishers).find(p=>p.name.toLowerCase()===choice);
  if(choice!=='all'&&!publisher)return json({error:'Choose a newspaper.'},400);
  // A supplied link is already a candidate; it needs no paid index lookup or claim of readability.
  const links=input.match(/https?:\/\/[^\s<>]+/gi)||[];
  if(links.length){
   if(links.length!==1)return json({error:'Paste one article link at a time.'},400);
   let url:string;try{url=resourceURL(links[0]);}catch{return json({error:'Paste a public newspaper article link.'},400);}
   const actual=searchPublisher(url);if(!actual||publisher&&!publisher.domains.includes(searchHost(url)))return json({error:'Use a link from the selected newspaper.'},400);
   const title=input.replace(links[0],'').trim();if(title.length>200)return json({error:'Use up to 200 headline characters.'},400);
   return json({results:[{title:title||'Supplied article link',url,publisher:actual.name,image:'',saved:false,supplied:true}]});
  }
  const headline=input;
  if(headline.length<4||headline.length>200)return json({error:'Use 4–200 characters from the headline.'},400);
  const saved=await c.DB.prepare('SELECT p.id,p.title,p.source_url,p.document,p.created_at FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? ORDER BY a.created_at DESC LIMIT 100').bind(room.id).all();
  const rows=rankSavedArticles({headline,publisher:publisher?.domains[0]},saved.results||[]);
  const results:any[]=rows.map((row:any)=>({...shelfMetadata(row),url:row.source_url,saved:true,basis:row.basis,ambiguous:row.ambiguous}));
  const unavailable=(message:string,status:number)=>results.length?json({results,warning:message}):json({error:message},status);
  const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'];if(typeof key!=='string'||!key.trim())return unavailable('Headline search is unavailable. Paste the article URL instead.',503);
  const slot='room-search:'+room.id+':'+new Date().toISOString().slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<30 RETURNING n').bind(slot).first())return unavailable('Today’s search limit has been reached. Paste a URL or choose a saved article.',429);
  for(const query of headlineQueries(headline,publisher?.domains[0])){
   let found:any;try{found=await providerCall(key.trim(),'/v1/tools/search',{query,count:8,need_content:false},fetcher);if(!Array.isArray(found?.results))throw Error('Unexpected search response');}catch{return unavailable('Headline search is unavailable. Paste the article URL instead.',502);}
   let matches=0;
   for(const candidate of found.results){
    try{const url=resourceURL(candidate.url),actual=searchPublisher(url);if(!actual||publisher&&!publisher.domains.includes(searchHost(url))||typeof candidate.title!=='string')continue;matches++;
     if(results.some(row=>safeURLMatch(row.url,url)))continue;
     results.push({title:cleanPublisherHeadline(candidate.title).slice(0,300),url,publisher:actual.name,image:'',saved:false});
    }catch{}
   }
   if(matches)break;
  }
  return json({results:results.slice(0,8)});
 }catch(error){if(error instanceof Response)return error;return json({error:'Search could not be completed.'},502);}
}
