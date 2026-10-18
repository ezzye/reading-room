import {requireRoom,accessiblePage} from './rooms.ts';
import {roomBody} from './room-articles.ts';
import {captureAPI} from './capture-service.ts';
import {sameOrigin} from './edition-access.ts';
import {safeURLMatch} from './article-matching.mjs';
import {sourceURL} from './education-core.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
import type {Config} from './education-service.ts';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
export async function roomCaptureAPI(request:Request,config:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(request,config);
  if(request.method!=='POST')return Response.json({error:'Method not allowed.'},{status:405,headers});
  let input:any;try{input=await roomBody(request.clone() as unknown as Request,1048576);}catch(error){if(error instanceof Response)return error;return Response.json({error:'Use a reviewed capture JSON file.'},{status:400,headers});}
  if(!sameOrigin(request))return Response.json({error:'Use Reading Room to import this capture.'},{status:403,headers});
  if(input.action==='media')return await appendReviewedMedia(input.capture,room,config);
  if(input.capture?.schema==='ret-media/v1')return Response.json({error:'Choose the media import action.'},{status:400,headers});
  const prose=Array.isArray(input.capture?.blocks)?input.capture.blocks.filter((block:any)=>['paragraph','quote'].includes(block?.type)).map((block:any)=>typeof block.text==='string'?block.text:'').join(' '):'';
  if(input.capture?.diagnostics?.accessBlocked||/subscribe to (?:continue|read)|sign in to continue|unlock (?:this|the) article/i.test(prose))return Response.json({error:'This capture appears to contain an access gate. Open a readable full article first.'},{status:400,headers});
  const response=await captureAPI(request,config,fetcher);
  if(!response.ok)return response;
  const data=await response.json() as {id?:string,cached?:boolean};
  if(!data.id||!await accessiblePage(request,config,data.id))return Response.json({error:'Capture was not added to this room.'},{status:502,headers});
  return Response.json({...data,href:'/read/'+data.id+'?room='+room.id},{headers});
 }catch(error){if(error instanceof Response)return error;return Response.json({error:'Capture could not be imported.'},{status:502,headers});}
}

const mediaReply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
function publicMedia(raw:unknown){
 if(typeof raw!=='string'||raw.length>4096)return '';
 try{const u=new URL(raw);if(u.hostname.includes(':')||[...u.searchParams.keys()].some(k=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k)))return '';return mediaURL(raw);}catch{return '';}
}
function measuredRect(raw:any){const field=(k:string,max:number)=>typeof raw?.[k]==='number'&&Number.isFinite(raw[k])?Math.max(0,Math.min(max,raw[k])):0;return {x:field('x',10000),y:field('y',100000),width:field('width',5000),height:field('height',10000)};}
async function appendReviewedMedia(input:any,room:Awaited<ReturnType<typeof requireRoom>>,config:Config){
 if(input?.schema!=='ret-media/v1'||input.diagnostics?.visibleOnly!==true||input.diagnostics?.accessBlocked||!Array.isArray(input.media)||input.media.length<1||input.media.length>20||input.blocks||input.text||input.body)return mediaReply({error:'Use a visible media-only capture with one to twenty items.'},400);
 let source:string;try{source=sourceURL(input.url);if(!safeURLMatch(source,source))throw Error();}catch{return mediaReply({error:'Use the exact public newspaper article URL.'},400);}
 const capturedAt=clean(input.capturedAt,50);if(!Number.isFinite(Date.parse(capturedAt)))return mediaReply({error:'The media capture needs its capture time.'},400);
 const width=Number(input.viewport?.width),height=Number(input.viewport?.height);if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>10000||height>10000)return mediaReply({error:'The media capture needs its visible viewport.'},400);
 const viewport={width,height},incoming:any[]=[];
 for(const item of input.media){
  if(!item||!['figure','video'].includes(item.type)||item.text||item.body)return mediaReply({error:'Media captures accept images and supported video links only.'},400);
  const url=publicMedia(item.url),poster=item.poster?publicMedia(item.poster):'';if(!url||item.poster&&!poster)return mediaReply({error:'A media link is unsafe or contains private access details.'},400);
  let type=item.type,target=type==='video'?videoEmbed(url):url,caption=clean(item.caption,1500);
  if(!target){if(!poster)return mediaReply({error:'That video player is not supported. Capture a visible poster image instead.'},400);type='figure';target=poster;caption=[caption,'Poster only; source video player is not supported.'].filter(Boolean).join(' · ');}
  incoming.push({type,url:target,poster:type==='video'?poster:'',caption,credit:clean(item.credit,500),style:{},rect:{width:660,height:0},basis:'measured-visible-browser-media',provenance:{basis:'measured-visible-browser-media',sourceURL:source,capturedAt,viewport,rect:measuredRect(item.rect),originalPositionVerified:false,viewportBasis:input.diagnostics.viewportBasis==='rendered-enabled-tab'&&input.diagnostics.osFocusVerified===false?'rendered-enabled-tab':'manually-reviewed-rendered-viewport',osFocusVerified:false}});
 }
 const rows=await config.DB.prepare('SELECT p.id,p.source_url FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=?').bind(room.id).all<{id:string,source_url:string}>();
 const matches=(rows.results||[]).filter(row=>safeURLMatch(source,row.source_url));
 if(matches.length!==1)return mediaReply({error:matches.length?'More than one saved edition matches this URL. Choose one clear edition first.':'Save this exact article in the current room before adding its media.'},matches.length?409:404);
 const id=matches[0].id,row=await config.DB.prepare('SELECT document FROM education_pages WHERE id=?').bind(id).first<{document:string}>();
 if(!row)return mediaReply({error:'The saved article is unavailable.'},404);
 let doc:any;try{doc=JSON.parse(row.document);}catch{return mediaReply({error:'The saved edition cannot accept media.'},409);}
 const capture=doc.capture;if(!Array.isArray(capture?.blocks)||!safeURLMatch(source,capture.url))return mediaReply({error:'The capture does not match this saved edition.'},409);
 const seen=new Set(capture.blocks.filter((b:any)=>['figure','video'].includes(b.type)).map((b:any)=>b.type+':'+(b.type==='video'?videoEmbed(b.url):publicMedia(b.url))));
 const ids=new Set(capture.blocks.map((b:any)=>b.id)),added:any[]=[];
 for(const item of incoming){const key=item.type+':'+item.url;if(seen.has(key))continue;seen.add(key);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const prefix='browser-media-'+[...new Uint8Array(digest)].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');let blockId=prefix,index=1;while(ids.has(blockId))blockId=prefix+'-'+index++;ids.add(blockId);added.push({...item,id:blockId});}
 const href='/read/'+id+'?room='+room.id;
 if(!added.length)return mediaReply({id,href,added:0,cached:true});
 let heading='browser-media-heading',index=1;while(ids.has(heading))heading='browser-media-heading-'+index++;
 const blocks=[...capture.blocks,...(capture.blocks.some((b:any)=>b.basis==='measured-visible-browser-media')?[]:[{id:heading,type:'heading',level:2,text:'Captured images & video',style:{},rect:{width:660,height:60}}]),...added];
 const document={...doc,capture:{...capture,blocks,diagnostics:{...capture.diagnostics,imageCount:blocks.filter((b:any)=>b.type==='figure').length,videoCount:blocks.filter((b:any)=>b.type==='video').length}}};
 const result=await config.DB.prepare(`UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS
  (SELECT 1 FROM rr_room_articles a JOIN rr_room_members rm ON rm.room_id=a.room_id JOIN rr_members m ON m.id=rm.member_id
   WHERE a.page_id=education_pages.id AND a.room_id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL)`)
  .bind(JSON.stringify(document),id,row.document,room.id,room.member_id).run();
 if(!result.meta?.changes)return mediaReply({error:'This edition or room access changed. Reload before importing again.'},409);
 return mediaReply({id,href,added:added.length,images:added.filter(b=>b.type==='figure').length,videos:added.filter(b=>b.type==='video').length});
}
