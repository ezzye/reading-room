import {headlineEvidence,validateHeadlineCheck,HEADLINE_CHECK_PROMPT,HEADLINE_CHECK_REPAIR_PROMPT,HEADLINE_CHECK_REVISION} from './headline-check.mjs';
import criticalEvidence from './critical-evidence.json' with {type:'json'};
import {loadPage,providerCall} from './education-service.ts';
import {requireRoom,accessiblePage} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import type {Config} from './education-service.ts';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
async function inputBody(r:Request){
 if(Number(r.headers.get('content-length')||0)>1000)throw Error('Request too large.');
 if(!r.body)throw Error('Empty request.');
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>1000){await reader.cancel();throw Error('Request too large.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
async function fingerprint(evidence:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({revision:HEADLINE_CHECK_REVISION,evidence}))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const cached=(page:any,hash:string)=>page?.document?.headlineCheck?.fingerprint===hash?page.document.headlineCheck:null;

export async function headlineCheckAPI(r:Request,c:Config,fetcher:typeof fetch=fetch):Promise<Response>{
 let lock='',lease=0,failureCode='internal',failureStage='request';
 try{
  if(r.method!=='POST')return json({error:'Method not allowed.'},405);
  if(!sameOrigin(r))return json({error:'Use the headline check in Reading Room.'},403);
  const room=await requireRoom(r,c);let input:any;
  try{input=await inputBody(r);}catch(e){return json({error:'Invalid headline-check request.'},e instanceof Error&&e.message==='Request too large.'?413:400);}
  if(typeof input?.id!=='string'||!/^([a-f0-9]{48})$/.test(input.id)||!await accessiblePage(r,c,input.id))return json({error:'Article not found in this room.'},404);
  let page=await loadPage(c.DB,input.id);if(!page)return json({error:'Article not found.'},404);
  const evidence=headlineEvidence(page,criticalEvidence);if(!evidence.available)return json(evidence);
  const hash=await fingerprint(evidence);let previous=cached(page,hash);
  if(previous)return json({available:true,check:previous.check,cached:true,generatedAt:previous.generatedAt});
  const rawKey=c.DEEPSEEK_API_KEY||c['DEEPSEEK-API-KEY'],key=typeof rawKey==='string'?rawKey.trim():'';
  if(!key)return json({error:'The AI headline check is unavailable. You can still read and discuss the article.'},503);
  lock='headline-lock:'+room.id+':'+input.id+':'+hash;lease=Date.now();
  const claimed=await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET n=excluded.n WHERE n<? RETURNING n').bind(lock,lease,lease-120000).first();
  if(!claimed){lock='';return json({error:'This headline is already being checked. Please try again shortly.'},409);}
  page=await loadPage(c.DB,input.id);previous=cached(page,hash);
  if(previous)return json({available:true,check:previous.check,cached:true,generatedAt:previous.generatedAt});
  const day=new Date().toISOString().slice(0,10);
  const roomCounter='room-headline:'+room.id+':'+day;
  const reserve=(counter:string,limit:number)=>c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<? RETURNING n').bind(counter,limit).first();
  const capped=()=>json({error:'Today’s AI headline checks have been used. The article remains available; try again tomorrow.'},429);
  if(!await reserve(roomCounter,20))return capped();
  if(!await reserve('headline-global:'+day,100)){
   await c.DB.prepare('UPDATE education_counters SET n=n-1 WHERE key=? AND n>0').bind(roomCounter).run();
   return capped();
  }
  const providerDeadline=Date.now()+70000;
  const deadlineFetcher:typeof fetch=async(input,init={})=>{
   const remaining=providerDeadline-Date.now();if(remaining<=0)throw Error('Provider deadline exceeded.');
   const signals:AbortSignal[]=[AbortSignal.timeout(remaining)];if(init.signal)signals.push(init.signal);
   return fetcher(input,{...init,signal:AbortSignal.any(signals)});
  };
  let result:any,check:any;
  for(let attempt=0;attempt<2;attempt++){
   if(Date.now()>=providerDeadline){failureStage='provider';failureCode='retry_deadline_exceeded';throw Error('Provider deadline exceeded.');}
   failureStage='provider';failureCode='provider_failed';
   const messages=[{role:'system',content:HEADLINE_CHECK_PROMPT},...(attempt===1?[{role:'system',content:HEADLINE_CHECK_REPAIR_PROMPT}]:[]),{role:'user',content:JSON.stringify(evidence)}];
   result=await providerCall(key,'/chat/completions',{model:'deepseek-flash',thinking:{type:'disabled'},temperature:0.1,max_tokens:1600,response_format:{type:'json_object'},messages},deadlineFetcher);
   if(result.choices?.[0]?.finish_reason!=='stop'){failureCode='provider_incomplete';throw Error('Unfinished comparison.');}
   failureStage='parse';failureCode='provider_json_invalid';
   let parsed:unknown;
   try{parsed=JSON.parse(result.choices[0].message.content);}catch{throw Error('Invalid comparison JSON.');}
   failureStage='validation';failureCode='provider_validation_failed';
   try{check=validateHeadlineCheck(parsed,evidence);break;}catch(error){
    const known=['invalid_shape','invalid_prose','unknown_headline_phrase','missing_support','unverified_support'];
    const code=error&&typeof error==='object'&&'validationCode' in error&&typeof error.validationCode==='string'?error.validationCode:'';
    failureCode=known.includes(code)?code:'validation_failed';
    if(code==='unknown_headline_phrase'&&attempt===0){if(Date.now()>=providerDeadline){failureStage='provider';failureCode='retry_deadline_exceeded';throw Error('Provider deadline exceeded.');}continue;}
    throw Error('Invalid comparison result.');
   }
  }
  failureStage='save';failureCode='save_failed';
  const generatedAt=new Date().toISOString();
  const record={fingerprint:hash,check,generatedAt,model:String(result.model||'deepseek-flash').slice(0,100)};
  // Merge only into the latest unchanged evidence; concurrent media/comments must survive.
  for(let attempt=0;attempt<2;attempt++){
   const latest=await loadPage(c.DB,input.id);
   if(!latest||!await accessiblePage(r,c,input.id))return json({error:'The article is no longer available in this room.'},404);
   if(await fingerprint(headlineEvidence(latest,criticalEvidence))!==hash)return json({error:'The saved article changed during this check. Reopen it and try again.'},409);
   const before=JSON.stringify(latest.document),document={...latest.document,headlineCheck:record};
   const saved=await c.DB.prepare('UPDATE education_pages SET document=? WHERE id=? AND document=? AND EXISTS (SELECT 1 FROM rr_room_articles a WHERE a.page_id=education_pages.id AND a.room_id=?)').bind(JSON.stringify(document),input.id,before,room.id).run();
   if(saved.meta?.changes)return json({available:true,check,cached:false,generatedAt});
  }
  return json({error:'The article changed while the comparison was saved. Please try again.'},409);
 }catch(e){
  if(e instanceof Response)return e;
  console.warn('RR_HEADLINE_CHECK_FAILED',JSON.stringify({stage:failureStage,code:failureCode}));
  return json({error:'The AI headline check could not produce a supported result. The article is unchanged; you can try again.',diagnostic:failureCode},502);
 }finally{
  if(lock)try{await c.DB.prepare('DELETE FROM education_counters WHERE key=? AND n=?').bind(lock,lease).run();}catch{/* A stale lease expires after two minutes. */}
 }
}
