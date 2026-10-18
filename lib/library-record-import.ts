import {requireRoom,accessiblePage} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {librarySearchChoice} from './library-search.ts';
import {fetchRoomLibraryRecord,libraryServerConfigured} from './library-server.ts';
import {buildLibraryRecordCapture} from './library-record-capture.mjs';
import {captureAPI} from './capture-service.ts';
import {reserveStudyImport,reserveURLImportAttempt,releaseStudyImport,sourceRequestGuardResponse} from './import-allowance.ts';
import type {StudyImportReservation} from './import-allowance.ts';
import type {Config} from './education-service.ts';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
async function selection(r:Request){
 if(!r.body||Number(r.headers.get('content-length')||0)>1024)throw Error();
 const reader=r.body.getReader(),decoder=new TextDecoder();let size=0,text='';try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1024)throw Error();text+=decoder.decode(next.value,{stream:true});}const raw=JSON.parse(text+decoder.decode());if(!raw||Object.keys(raw).some(key=>!['choiceId','requestId'].includes(key))||!/^[a-f0-9]{48}$/.test(raw.choiceId||'')||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.requestId||''))throw Error();return raw;}finally{await reader.cancel();}
}
export async function libraryRecordImportAPI(r:Request,c:Config,fetcher:typeof fetch=fetch,internal:{record?:typeof fetchRoomLibraryRecord}={}){
 let reservation:StudyImportReservation|undefined;
 try{
  const room=await requireRoom(r,c);
  if(r.method!=='POST')return json({error:'Choose a Camden search result.'},405);
  if(!sameOrigin(r))return json({error:'Use Reading Room to add this library record.'},403);
  let data;try{data=await selection(r);}catch{return json({error:'Choose a current Camden result and try again.'},400);}
  const choice=await librarySearchChoice(r,c,data.choiceId);if(!choice)return json({error:'This Camden search result has expired or is unavailable. Search again.'},410);
  c={...c,RR_ACTIVE_ROOM_ID:room.id};
  const alternate=choice.library_url.replace('news%2F','news/');
  const cached=await c.DB.prepare('SELECT p.id FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? AND p.source_url IN (?,?) ORDER BY p.created_at DESC LIMIT 1').bind(room.id,choice.library_url,alternate).first<{id:string}>();
  if(cached)return json({id:cached.id,href:'/read/'+cached.id+'?room='+room.id,cached:true});
  if(!await libraryServerConfigured(c))return json({error:'Ask this room’s owner to connect Camden Library.'},409);
  const pending=await reserveStudyImport(r,c,choice.library_url,data.requestId,Date.now(),{validatedLibraryRecordURL:choice.library_url});if(pending.response)return pending.response;reservation=pending.reservation;
  if(!await reserveURLImportAttempt(c))return sourceRequestGuardResponse(c);
  const selected={publisher:choice.publisher_key,libraryURL:choice.library_url,title:choice.title,date:choice.source_date,publication:choice.publication};
  const result=await (internal.record||fetchRoomLibraryRecord)(c,selected,fetcher);
  if(result.status!=='found')return json({error:'The selected Camden record could not be verified. Search again or choose another result.'},422);
  const capture=buildLibraryRecordCapture({selected,article:result.article});
  const headers=new Headers(r.headers);headers.delete('content-length');
  const response=await captureAPI(new Request(new URL('/api/capture',r.url),{method:'POST',headers,body:JSON.stringify({capture,requestId:data.requestId})}),c,fetcher,{studyReservation:reservation,validatedLibraryRecordURL:selected.libraryURL});
  if(!response.ok)return response;
  const saved=await response.json() as {id?:string,cached?:boolean};if(!saved.id||!await accessiblePage(r,c,saved.id))return json({error:'The library edition was not added to this room.'},502);
  return json({id:saved.id,href:'/read/'+saved.id+'?room='+room.id,cached:Boolean(saved.cached)});
 }catch(error){if(error instanceof Response)return error;return json({error:'The library edition could not be prepared. No article was substituted.'},502);}
 finally{if(reservation)try{await releaseStudyImport(reservation);}catch{console.warn('RR_LIBRARY_IMPORT_RELEASE_UNAVAILABLE');}}
}
