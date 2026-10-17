import {requireRoom,accessiblePage} from './rooms.ts';
import {articleAPI} from './article-service.ts';
import {loadPage,providerCall} from './education-service.ts';
import type {Config} from './education-service.ts';
import {resourceURL} from './resource-service.ts';
import {mediaURL} from './capture-core.mjs';
import {sameOrigin} from './edition-access.ts';

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
  const forwardedHeaders=new Headers(r.headers);forwardedHeaders.delete('content-length');
  const result=await articleAPI(new Request(new URL('/api/articles',r.url),{method:'POST',headers:forwardedHeaders,body:JSON.stringify({url,requestId:data.requestId||crypto.randomUUID()})}),c,fetcher);
  const value=await result.json() as any;if(!result.ok)return json({error:value.error||'This article could not be opened.'},result.status);
  let id=value.id;if(!id&&typeof value.href==='string'){const match=value.href.match(/\/(?:preview|read)\/([a-f0-9]{48})/);id=match?.[1];}
  if(!id||!await accessiblePage(r,c,id))return json({error:'The article was not added to this room.'},502);
  return json({id,href:'/read/'+id+'?room='+room.id,cached:Boolean(value.cached)});
 }catch(error){if(error instanceof Response)return error;return json({error:'The article could not be added. Please try again.'},502);}
}

const publishers:Record<string,{name:string,domains:string[]}>= {
 times:{name:'The Times',domains:['thetimes.com']},guardian:{name:'The Guardian',domains:['theguardian.com']},bbc:{name:'BBC News',domains:['bbc.co.uk','bbc.com']},independent:{name:'The Independent',domains:['independent.co.uk']},telegraph:{name:'The Telegraph',domains:['telegraph.co.uk']},standard:{name:'The Standard',domains:['standard.co.uk']},metro:{name:'Metro',domains:['metro.co.uk']},nytimes:{name:'The New York Times',domains:['nytimes.com']},dawn:{name:'Dawn',domains:['dawn.com']}
};
export async function articleSearchAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(r,c);if(r.method!=='POST')return json({error:'Method not allowed.'},405);if(!sameOrigin(r))return json({error:'Use the article search.'},403);
  const data=await roomBody(r),headline=typeof data.headline==='string'?data.headline.trim():'';
  if(headline.length<4||headline.length>180)return json({error:'Enter at least four characters from the headline.'},400);
  const choice=String(data.publisher||'all').toLowerCase();const publisher=publishers[choice]||Object.values(publishers).find(p=>p.name.toLowerCase()===choice);
  if(choice!=='all'&&!publisher)return json({error:'Choose a newspaper.'},400);
  const saved=await c.DB.prepare('SELECT p.id,p.title,p.source_url,p.document,p.created_at FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? AND p.title LIKE ? ESCAPE \'\\\' ORDER BY a.created_at DESC LIMIT 10').bind(room.id,'%'+headline.replace(/[\\%_]/g,'\\$&')+'%').all();
  const results:any[]=(saved.results||[]).map((row:any)=>({...shelfMetadata(row),url:row.source_url,saved:true})).filter((row:any)=>!publisher||publisher.domains.some(d=>new URL(row.url).hostname.replace(/^www\./,'')===d));
  const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'];if(typeof key!=='string'||!key.trim())return results.length?json({results}):json({error:'Headline search is unavailable. Paste the article URL instead.'},503);
  const slot='room-search:'+room.id+':'+new Date().toISOString().slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<30 RETURNING n').bind(slot).first())return results.length?json({results}):json({error:'Today’s search limit has been reached. Paste a URL or choose a saved article.'},429);
  const query=(publisher?'site:'+publisher.domains[0]+' ':'')+headline;
  let found:any;try{found=await providerCall(key.trim(),'/v1/tools/search',{query:query.slice(0,128),count:8,need_content:false},fetcher);}catch{return results.length?json({results}):json({error:'Headline search is unavailable. Paste the article URL instead.'},502);}
  for(const candidate of Array.isArray(found.results)?found.results:[]){
   try{const url=resourceURL(candidate.url),host=new URL(url).hostname.replace(/^(?:www|m|amp)\./,'');const allowed=publisher?publisher.domains.includes(host):Object.values(publishers).some(p=>p.domains.includes(host));if(!allowed||results.some(row=>row.url===url)||typeof candidate.title!=='string')continue;
    results.push({title:candidate.title.slice(0,300),url,publisher:publisher?.name||Object.values(publishers).find(p=>p.domains.includes(host))?.name||host,image:'',saved:false});
   }catch{}
  }
  return json({results:results.slice(0,8)});
 }catch(error){if(error instanceof Response)return error;return json({error:'Search could not be completed.'},502);}
}
