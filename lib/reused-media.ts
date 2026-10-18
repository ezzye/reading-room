import type {Config} from './education-service.ts';
import {safeURLMatch} from './article-matching.mjs';
import {mediaURL,videoEmbed} from './capture-core.mjs';
const roomFor=(config:Config)=>typeof config.RR_ACTIVE_ROOM_ID==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(config.RR_ACTIVE_ROOM_ID)?config.RR_ACTIVE_ROOM_ID:'';
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
function safeMedia(value:unknown){if(typeof value!=='string'||value.length>4096)return '';try{const u=new URL(value);if(u.hostname.includes(':')||[...u.searchParams.keys()].some(k=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k))||!mediaURL(value))return '';u.hash='';return u.href;}catch{return '';}}
const key=(block:any)=>block.type+':'+(block.type==='video'?videoEmbed(block.url):mediaURL(block.url));
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');}
/** Local, exact-article reuse only. The caller supplies a room already authorised by the gate. */
export async function reuseSavedArticleMedia(capture:any,config:Config,excludeId=''){
 const room=roomFor(config);if(!room||!Array.isArray(capture?.blocks)||!safeURLMatch(capture.url,capture.url))return capture;
 const rows=await config.DB.prepare('SELECT p.id,p.source_url FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=? ORDER BY a.created_at DESC,p.id DESC LIMIT 1000').bind(room).all<{id:string,source_url:string}>();
 const candidates=(rows.results||[]).filter(row=>row.id!==excludeId&&safeURLMatch(capture.url,row.source_url)).slice(0,20);
 const seen=new Set(capture.blocks.filter((b:any)=>['figure','video'].includes(b.type)).map(key));const ids=new Set(capture.blocks.map((b:any)=>b.id));const retained:any[]=[];
 for(const candidate of candidates){
  const row=await config.DB.prepare('SELECT document FROM education_pages WHERE id=?').bind(candidate.id).first<{document:string}>();let source:any;try{source=JSON.parse(row?.document||'').capture;}catch{continue;}
  if(!Array.isArray(source?.blocks)||!safeURLMatch(capture.url,source.url))continue;
  for(const block of source.blocks){
   if(!['figure','video'].includes(block?.type)||retained.length>=20||capture.blocks.length+retained.length>=699)continue;
   const original=safeMedia(block.url),poster=block.poster?safeMedia(block.poster):'';if(!original||block.poster&&!poster)continue;
   const url=block.type==='video'?videoEmbed(original):original;if(!url)continue;const identity=key({...block,url});if(seen.has(identity))continue;seen.add(identity);
   let id=/^[A-Za-z0-9_-]{1,100}$/.test(block.id||'')?block.id:'reused-media-'+await digest(identity);if(ids.has(id))id='reused-media-'+await digest(identity);const base=id;let suffix=1;while(ids.has(id))id=base+'-'+suffix++;ids.add(id);
   retained.push({id,type:block.type,url,poster,caption:clean(block.caption,1500),credit:clean(block.credit,500),aspectRatio:typeof block.aspectRatio==='number'&&block.aspectRatio>=0.5&&block.aspectRatio<=3?block.aspectRatio:16/9,style:block.style&&typeof block.style==='object'?block.style:{},rect:{width:660,height:0},...(typeof block.basis==='string'?{basis:clean(block.basis,100)}:{}),...(block.provenance&&typeof block.provenance==='object'?{provenance:JSON.parse(JSON.stringify(block.provenance))}:{}),reuse:{basis:'same-room-exact-article',originalPositionVerified:false}});
  }
 }
 if(!retained.length)return capture;
 let heading='reused-media-heading',suffix=1;while(ids.has(heading))heading='reused-media-heading-'+suffix++;
 const blocks=[...capture.blocks,{id:heading,type:'heading',level:2,text:'Previously saved source media · position not verified',style:{},rect:{width:660,height:60}},...retained];
 return {...capture,blocks,diagnostics:{...capture.diagnostics,imageCount:blocks.filter((b:any)=>b.type==='figure').length,videoCount:blocks.filter((b:any)=>b.type==='video').length}};
}
/** Run after captureAPI normalization so original provenance and media IDs survive intact. */
export async function retainRoomMediaOnSavedCapture(config:Config,id:string){
 const room=roomFor(config);if(!room||!/^[a-f0-9]{48}$/.test(id))return {added:0};
 const row=await config.DB.prepare('SELECT p.document FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE p.id=? AND a.room_id=?').bind(id,room).first<{document:string}>();if(!row)return {added:0};
 let document:any;try{document=JSON.parse(row.document);}catch{return {added:0};}const capture=await reuseSavedArticleMedia(document.capture,config,id);if(capture===document.capture)return {added:0};
 const result=await config.DB.prepare('UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS(SELECT 1 FROM rr_room_articles a WHERE a.page_id=education_pages.id AND a.room_id=?)').bind(JSON.stringify({...document,capture}),id,row.document,room).run();return {added:result.meta?.changes?capture.blocks.length-document.capture.blocks.length-1:0};
}
