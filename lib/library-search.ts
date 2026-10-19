import {isLibraryServiceBusyError,libraryServiceBusyResponse} from './library-service-busy.mjs';
import {requireRoom} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {libraryPublication} from './library-publications.mjs';
import {librarySearchQuery,sanitizeLibrarySearch} from './library-search-contract.mjs';
import {libraryServerConfigured,searchRoomLibraryMetadata} from './library-server.ts';
import type {Config} from './education-service.ts';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
const opaqueID=()=>[...crypto.getRandomValues(new Uint8Array(24))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const CHOICE_LIFETIME=30*60*1000;
type Choice={id:string,room_id:string,member_id:string,publisher_key:string,title:string,source_date:string,publication:string,library_url:string,created_at:string,expires_at:string};
async function readQuery(r:Request){
 if(!r.body||Number(r.headers.get('content-length')||0)>2048)throw Error('invalid_library_search');
 const reader=r.body.getReader(),decoder=new TextDecoder();let size=0,text='';
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>2048)throw Error('invalid_library_search');text+=decoder.decode(next.value,{stream:true});}return librarySearchQuery(JSON.parse(text+decoder.decode()));}finally{await reader.cancel();}
}
// Selection tokens are useful only inside the originating room and membership.
// Stage two may consume this metadata, then must refetch/recheck the exact record.
export async function librarySearchChoice(r:Request,c:Config,id:unknown,time=Date.now()):Promise<Choice|null>{
 const room=await requireRoom(r,c);if(typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id))return null;
 const row=await c.DB.prepare('SELECT * FROM rr_library_search_choices WHERE id=? AND room_id=? AND member_id=? AND expires_at>?').bind(id,room.id,room.member_id,new Date(time).toISOString()).first<Choice>();
 if(!row||!libraryPublication(row.publisher_key))return null;
 const checked=sanitizeLibrarySearch({status:'library-search',schema:'newsbank-library-search/v1',requested:{publisher:row.publisher_key,query:'stored metadata'},pageCount:1,inspectedCount:1,truncated:false,results:[{title:row.title,date:row.source_date,publication:row.publication,libraryURL:row.library_url}],fullTextVerified:false,articleAccepted:false});
 return checked?row:null;
}
export async function librarySearchAPI(r:Request,c:Config,fetcher:typeof fetch=fetch,time=Date.now(),internal:{search?:typeof searchRoomLibraryMetadata}={}){
 try{
  const room=await requireRoom(r,c);
  if(r.method!=='POST')return json({error:'Use the library search form.'},405);
  if(!sameOrigin(r))return json({error:'Use Reading Room to search Camden.'},403);
  let input;try{input=await readQuery(r);}catch{return json({error:'Choose a library newspaper and enter at least two words, up to 240 characters.'},400);}
  c={...c,RR_ACTIVE_ROOM_ID:room.id};
  if(!await libraryServerConfigured(c))return json({error:'Ask this room’s owner to connect Camden Library.'},409);
  const stamp=new Date(time).toISOString(),counter='library-headline-search:'+room.id+':'+stamp.slice(0,10);
  if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<30 RETURNING n').bind(counter).first())return json({error:'Today’s 30 Camden searches for this room have been used. Saved articles remain available.'},429);
  const raw=await (internal.search||searchRoomLibraryMetadata)(c,input,fetcher),result=sanitizeLibrarySearch(raw);
  if(!result||result.requested.publisher!==input.publisher||result.requested.query!==input.query)return json({error:'Camden search could not return verified newspaper metadata. Try again later.'},502);
  await requireRoom(r,c); // Membership may have been revoked during the lookup.
  await c.DB.prepare('DELETE FROM rr_library_search_choices WHERE room_id=? AND expires_at<=?').bind(room.id,stamp).run();
  const expiresAt=new Date(time+CHOICE_LIFETIME).toISOString(),choices=[];
  for(const row of result.results){
   const id=opaqueID();await c.DB.prepare('INSERT INTO rr_library_search_choices(id,room_id,member_id,publisher_key,title,source_date,publication,library_url,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,room.id,room.member_id,input.publisher,row.title,row.date,row.publication,row.libraryURL,stamp,expiresAt).run();
   choices.push({choiceId:id,title:row.title,date:row.date,publication:row.publication,publisher:input.publisher,source:'Camden',expiresAt});
  }
  return json({source:'camden',publisher:input.publisher,publisherName:libraryPublication(input.publisher)!.name,results:choices,inspectedCount:result.inspectedCount,truncated:result.truncated,fullTextVerified:false,articleAccepted:false});
 }catch(error){if(isLibraryServiceBusyError(error))return libraryServiceBusyResponse();if(error instanceof Response)return error;return json({error:'Camden search is unavailable. Try again or ask this room’s owner to check the library connection.'},502);}
}
