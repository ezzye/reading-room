import {roomId,DEFAULT_ROOM_ID} from './rooms.ts';
import {parseHTML} from 'linkedom';
import {runtimeLibraryClient} from './library-transport.mjs';
import {normalizeNewsBankDate} from './newsbank-http.mjs';
import {sealLibrary,openLibrary} from './library-vault.mjs';
import {timesURL,headline} from '../extension-library/library-core.mjs';
import {publicHTML} from './newspaper-core.mjs';
import {providerCall,isOwner} from './education-service.ts';
import type {Config} from './education-service.ts';
import {sameOrigin} from './edition-access.ts';
const now=()=>new Date().toISOString();
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function connectionId(c:Config){const id=typeof c.RR_ACTIVE_ROOM_ID==='string'?c.RR_ACTIVE_ROOM_ID:DEFAULT_ROOM_ID;return id===DEFAULT_ROOM_ID?'camden':'camden:'+id;}
type SavedAccount={libraryName:string,cardNumber:string,session:unknown};
async function stored(c:Config){return c.DB.prepare("SELECT encrypted,state,checked_at AS checkedAt,last_error AS lastError FROM rr_library_connections WHERE id=?").bind(connectionId(c)).first<any>();}
async function save(c:Config,account:SavedAccount,state='connected',error=''){
 const encrypted=await sealLibrary(c.RR_LIBRARY_VAULT_KEY,account);
 await c.DB.prepare("INSERT INTO rr_library_connections(id,encrypted,state,checked_at,last_error) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,state=excluded.state,checked_at=excluded.checked_at,last_error=excluded.last_error").bind(connectionId(c),encrypted,state,now(),error).run();
}
async function slot(c:Config,key:string,limit:number){return c.DB.prepare('INSERT INTO education_counters(key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n').bind(key+':'+now().slice(0,10),limit).first();}
function accountValue(raw:any):SavedAccount{if(!raw||typeof raw.libraryName!=='string'||raw.libraryName.length>160||typeof raw.cardNumber!=='string'||!raw.cardNumber.trim()||raw.cardNumber.length>200)throw Error('The saved library connection could not be read.');return raw;}
async function body(r:Request){if(!r.body)throw Error('Use the library connection form.');const reader=r.body.getReader();let size=0,text='';const dec=new TextDecoder();try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2048)throw Error('The library connection form is too large.');text+=dec.decode(x.value,{stream:true});}return JSON.parse(text+dec.decode());}finally{await reader.cancel();}}
export async function libraryServerConfigured(c:Config){return Boolean(c.RR_LIBRARY_VAULT_KEY&&await stored(c));}
export async function librarySettingsAPI(r:Request,c:Config,fetcher:typeof fetch=fetch){
 if(roomId(r))c={...c,RR_ACTIVE_ROOM_ID:roomId(r)};
 let stage='access';
 try{
  if(!isOwner(r,c))return json({error:'Only the room owner can manage the library connection.'},403);
  if(r.method==='GET'){const row=await stored(c);return json({configured:Boolean(row),encryptionReady:Boolean(c.RR_LIBRARY_VAULT_KEY),state:row?.state||'not-connected',checkedAt:row?.checkedAt||null,message:row?.lastError||'',desktopRequired:false});}
  if(r.method!=='POST')return json({error:'Use the library connection controls.'},405);
  if(!sameOrigin(r))return json({error:'Use the same-origin library connection form.'},403);
  stage='form';const data=await body(r);
  if(data.action==='disconnect'){await c.DB.prepare("DELETE FROM rr_library_connections WHERE id=?").bind(connectionId(c)).run();return json({disconnected:true});}
  if(data.action!=='connect'||data.consent!==true)return json({error:'Review and confirm where your card will be used.'},400);
  if(!c.RR_LIBRARY_VAULT_KEY)return json({error:'The server encryption setting must be ready before connecting a card.'},503);
  const account=accountValue({libraryName:'CamdenLibraries',cardNumber:data.cardNumber?.trim(),session:null});
  stage='sign-in-limit';if(!await slot(c,'library-login:'+connectionId(c),10))return json({error:'Today’s ten library sign-in attempts have been used. Try tomorrow (UTC).'},429);
  stage='provider-sign-in';
  const client=runtimeLibraryClient(c,fetcher,account);const result=await client.login(account);
  if(result.status!=='authenticated')return json({error:result.reason||'NewsBank did not accept this sign-in. No new connection was saved.',state:result.status},422);
  stage='encrypted-storage';account.session=client.serializeSession();await save(c,account);return json({connected:true,desktopRequired:false});
 }catch(e){
  const message=e instanceof Error?e.message:'';
  // Provider/client errors are fixed local messages, never response bodies,
  // form values, cookies or credential-bearing URLs.
  const safe=/^(?:NewsBank (?:returned|redirected|requested|did not|library)|The NewsBank (?:request|page)|The server encryption|The library connection form)/.test(message)?message:'';
  console.error('Reading Room library setup failed',JSON.stringify({stage,type:e instanceof Error?e.name:'unknown',message:safe||'Unclassified local error'}));
  return json({error:'The library connection could not be updated. '+(safe||'Try again or reconnect. Your card was not exposed.')},502);
 }
}
function usableTitle(raw:unknown){if(typeof raw!=='string')return '';const value=headline(raw.replace(/<[^>]*>/g,' ')).trim();return value.length>=15&&value.length<=400&&!/^(?:verifying|verify |just a moment|access denied|sign.?in|subscribe|error|not found)/i.test(value)?value:'';}
export async function timesMetadata(url:string,c:Config,fetcher:typeof fetch){
 url=timesURL(url);const other=new URL(url);other.hostname='www.thetimes.com';
 // The page title may be an AI synthesis. Only stored source metadata can
 // identify reporting; do not send an educational page's title to NewsBank.
 const saved=await c.DB.prepare(`SELECT
  json_extract(document,'$.kind') AS kind,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.url') ELSE json_extract(document,'$.source.originalURL') END AS sourceURL,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.title') ELSE json_extract(document,'$.source.title') END AS sourceTitle,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.date') ELSE json_extract(document,'$.source.date') END AS sourceDate,
  CASE WHEN json_extract(document,'$.kind')='library-study-v1' OR json_extract(document,'$.capture.presentation.method')='library-text' OR json_extract(document,'$.capture.diagnostics.libraryTextEdition')=1 THEN 1 ELSE 0 END AS libraryEdition,
  CASE WHEN json_extract(document,'$.kind')='rendered-capture-v1' THEN json_extract(document,'$.capture.diagnostics.libraryURL') ELSE json_extract(document,'$.source.url') END AS libraryURL
  FROM education_pages p ${c.RR_ACTIVE_ROOM_ID?'JOIN rr_room_articles a ON a.page_id=p.id':''} WHERE source_url IN (?,?) ${c.RR_ACTIVE_ROOM_ID?'AND a.room_id=?':''} AND json_extract(document,'$.kind') IN ('rendered-capture-v1','library-study-v1') ORDER BY p.created_at DESC LIMIT 5`).bind(...(c.RR_ACTIVE_ROOM_ID?[url,other.href,c.RR_ACTIVE_ROOM_ID]:[url,other.href])).all();
 for(const source of (saved.results||[]) as any[]){
  try{
   if(timesURL(source.sourceURL)!==url)continue;
   if(source.libraryEdition){const record=new URL(source.libraryURL);if(record.origin!=='https://infoweb.newsbank.com'||record.pathname!=='/apps/news/document-view'||record.searchParams.get('p')!=='UKNB'||!/^news\/[A-F0-9]+$/.test(record.searchParams.get('docref')||''))continue;}
   // NewsBank puts the standfirst after a spaced hyphen. Apply the same
   // headline boundary used for candidates, only to a verified library source.
   const title=usableTitle(source.libraryEdition&&typeof source.sourceTitle==='string'?source.sourceTitle.split(/\s+-\s+/)[0]:source.sourceTitle);
   if(title)return {title,date:normalizeNewsBankDate(source.sourceDate),basis:'previously matched edition'};
  }catch{/* Invalid stored source identity cannot replace publisher metadata. */}
 }
 try{const page=await publicHTML(url,fetcher);const {document:d}=parseHTML(page.html);const title=usableTitle(d.querySelector('h1')?.textContent)||usableTitle(d.querySelector('meta[property="og:title"]')?.getAttribute('content'))||usableTitle(d.title);if(title)return {title,date:d.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.slice(0,10)||'',basis:'publisher headline'};}catch{/* A challenge or access error is never bypassed. Public search metadata can still identify the URL. */}
 const key=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'];if(typeof key==='string'&&key.trim()){
  const result=await providerCall(key.trim(),'/v1/tools/search',{query:('site:thetimes.com '+new URL(url).pathname.split('/').at(-1)!.replace(/-[a-z0-9]{9}$/i,'').replace(/-/g,' ')).slice(0,128),count:5,need_content:false},fetcher);
  for(const candidate of Array.isArray(result.results)?result.results:[]){try{if(timesURL(candidate.url)===url&&usableTitle(candidate.title))return {title:usableTitle(candidate.title),date:'',basis:'exact-URL public search headline'};}catch{}}
 }
 throw Error('The Times headline could not be verified for this URL. No library article was substituted.');
}
export async function lookupNewsBankSource(rawURL:string,c:Config,fetcher:typeof fetch=fetch){
 const originalURL=timesURL(rawURL),row=await stored(c);if(!row)throw Error('The room owner has not connected Camden for server lookup yet.');
 if(row.state==='needs-attention'&&Date.now()-Date.parse(row.checkedAt)<90000)throw Error('The library connection needs the owner’s attention. Open Library connection.');
 if(!await slot(c,'library-lookup:'+connectionId(c),30))throw Error('Today’s thirty library lookups have been used. Saved editions remain available.');
 const meta=await timesMetadata(originalURL,c,fetcher),account=accountValue(await openLibrary(c.RR_LIBRARY_VAULT_KEY,row.encrypted));
 const client=runtimeLibraryClient(c,fetcher,account);if(account.session)client.restoreSession(account.session);
 let result=await client.lookup(meta);
 if(result.status==='login_required'){
  if(!await slot(c,'library-login:'+connectionId(c),10))throw Error('Today’s library sign-in limit has been used. Try tomorrow (UTC).');
  const auth=await client.login(account);if(auth.status!=='authenticated'){await save(c,account,'needs-attention',auth.reason||'Library sign-in needs attention.');throw Error('The library sign-in needs attention. The owner can reconnect from a phone.');}
  result=await client.lookup(meta);
 }
 account.session=client.serializeSession();
 if(result.status!=='found'){const error=result.reason||'No matching library article was found.';await save(c,account,result.status==='not_found'?'connected':'needs-attention',error);throw Error(error);}
 await save(c,account);
 return {...result.article,originalURL,originalTitle:meta.title};
}
