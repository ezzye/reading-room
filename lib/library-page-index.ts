import {requireRoom,roomId} from './rooms.ts';
import {libraryPublicationForURL,libraryDocumentPublicationMatchesSelection} from './library-publications.mjs';
import {sameOrigin} from './edition-access.ts';
import {mediaURL,videoEmbed} from './capture-core.mjs';
import {publicLibraryLocatorMetadata,publicLibraryLocatorMedia} from './library-public-media.mjs';
import {selectedLibraryTitle} from './library-record-contract.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';
import {libraryPageProofMetadata,savedLibraryPageMatches,savedLibraryReceiptMatches} from './library-page-proof.mjs';
import type {Config} from './education-service.ts';

const conflict=()=>Response.json({error:'This library record is already being prepared, or its saved identity changed. Reload and try again.',errorCode:'import_in_progress'},{status:409,headers:{'Cache-Control':'private, no-store','Retry-After':'15'}});
type Page={id:string;document:string;title?:string;created_at?:string};
type Claim={DB:Config['DB'];id:string;room:string;url:string};
const claims=new WeakMap<object,Claim>();
const boundProofs=new WeakMap<object,{DB:Config['DB'];room:string;member:string;requestId:string;proof:object;claimId?:string;publisherURL?:string;requestedPublisherURL?:string}>();
export async function bindRoomLibraryProof(request:Request,c:Config,proof:object,requestId:string,verifiedPublisherURL?:string,requestedPublisherURL=verifiedPublisherURL){const room=await requireRoom(request,c);if(!libraryPageProofMetadata(proof)||!requestId)throw conflict();const meta=libraryPageProofMetadata(proof),url=publisherURL(verifiedPublisherURL,meta.publisherKey);const requested=publisherURL(requestedPublisherURL,meta.publisherKey);if(verifiedPublisherURL&&!url||requestedPublisherURL&&!requested)throw conflict();const bound=Object.freeze({});boundProofs.set(bound,{DB:c.DB,room:room.id,member:room.member_id,requestId,proof,publisherURL:url||undefined,requestedPublisherURL:requested||undefined});return bound;}
async function roomProof(request:Request,c:Config,bound:object,requestId?:string){const room=await requireRoom(request,c),state=boundProofs.get(bound);if(!state||state.DB!==c.DB||state.room!==room.id||state.member!==room.member_id||requestId!==undefined&&state.requestId!==requestId)throw conflict();return state.proof;}
export async function assertRoomLibraryProof(request:Request,c:Config,bound:object,requestId:string){return libraryPageProofMetadata(await roomProof(request,c,bound,requestId));}
function publisherURL(raw:string|undefined,publisher:string){if(!raw)return null;try{const p=libraryPublicationForURL(raw);return p?.key===publisher?p.url:null;}catch{return null;}}
function parsed(document:unknown){try{return typeof document==='string'?JSON.parse(document):null;}catch{return null;}}
function metadata(row:any){return {schema:row.proof_revision,publisherKey:row.publisher_key,libraryURL:row.library_url,title:row.source_title,date:row.source_date,publication:row.publication,paragraphFingerprint:row.paragraph_fingerprint};}
// An exact library record does not establish ownership of an arbitrary web URL.
// Only a freshly observed exact-URL headline can supply a reusable publisher locator.
export function verifiedLibraryPublisherLocator(source:any){
 const bases=['publisher headline','server public-preview headline','exact-URL public fetch headline','exact-URL public search headline'];
 if(!source||source.readerHeadlineHint!==false||source.urlWordsHint!==false||!bases.includes(source.metadataBasis)||typeof source.originalTitle!=='string'||typeof source.title!=='string')return undefined;
 const normalize=(value:string)=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
 if(normalize(source.originalTitle)!==normalize(selectedLibraryTitle(source.title)))return undefined;
 try{return libraryPublicationForURL(source.originalURL).url;}catch{return undefined;}
}
function memberGate(){return "EXISTS (SELECT 1 FROM rr_room_members rm JOIN rr_members m ON m.id=rm.member_id WHERE rm.room_id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL)";}
export async function roomLibraryAlias(request:Request,c:Config,rawURL:string){
 if(!roomId(request))return null;const room=await requireRoom(request,c);let url;try{url=libraryPublicationForURL(rawURL)?.url;}catch{}if(!url)return null;
 const row:any=await c.DB.prepare('SELECT p.id,p.title,p.document,p.created_at,v.* FROM rr_article_source_aliases x JOIN rr_verified_library_pages v ON v.room_id=x.room_id AND v.page_id=x.page_id JOIN rr_room_articles a ON a.room_id=v.room_id AND a.page_id=v.page_id JOIN education_pages p ON p.id=a.page_id WHERE x.room_id=? AND x.publisher_url=?').bind(room.id,url).first();
 if(!row||libraryPublicationForURL(url)?.key!==row.publisher_key||!await savedLibraryReceiptMatches(parsed(row.document),metadata(row)))return null;await requireRoom(request,c);return {id:row.id,title:row.title,created_at:row.created_at};
}
export async function roomVerifiedLibraryRecord(request:Request,c:Config,libraryURL:string,selected?:{publisher:string;title:string;date:string;publication:string}){
 const room=await requireRoom(request,c);if(diagnosticDocumentURL(libraryURL)!==libraryURL)return null;
 const row:any=await c.DB.prepare('SELECT p.id,p.title,p.document,p.created_at,v.* FROM rr_verified_library_pages v JOIN rr_room_articles a ON a.room_id=v.room_id AND a.page_id=v.page_id JOIN education_pages p ON p.id=a.page_id WHERE v.room_id=? AND v.library_url=?').bind(room.id,libraryURL).first();
 if(!row||!await savedLibraryReceiptMatches(parsed(row.document),metadata(row))||selected&&(row.publisher_key!==selected.publisher||row.source_date!==selected.date||!libraryDocumentPublicationMatchesSelection(row.publication,selected.publication,selected.publisher)||selectedLibraryTitle(row.source_title)!==selectedLibraryTitle(selected.title)))return null;await requireRoom(request,c);return {id:row.id,title:row.title,created_at:row.created_at};
}
// This claim covers normal, selected and finite-audit imports without changing counters.
export async function claimRoomLibraryRecord(request:Request,c:Config,proof:object,time=Date.now()){
 const room=await requireRoom(request,c),bound=proof;proof=await roomProof(request,c,proof);const meta=libraryPageProofMetadata(proof);if(!meta)throw conflict();if(!c.DB.batch)throw Error('Transactional library identity is unavailable.');
 const id=crypto.randomUUID();await c.DB.batch([c.DB.prepare('DELETE FROM rr_library_import_claims WHERE expires_at<=?').bind(time),c.DB.prepare(`INSERT OR IGNORE INTO rr_library_import_claims(room_id,library_url,claim_id,member_id,expires_at) SELECT ?,?,?,?,? WHERE ${memberGate()}`).bind(room.id,meta.libraryURL,id,room.member_id,time+15*60*1000,room.id,room.member_id)]);
 if(!await c.DB.prepare('SELECT 1 AS active FROM rr_library_import_claims WHERE room_id=? AND library_url=? AND claim_id=?').bind(room.id,meta.libraryURL,id).first())throw conflict();
 boundProofs.get(bound)!.claimId=id;const claim=Object.freeze({});claims.set(claim,{DB:c.DB,id,room:room.id,url:meta.libraryURL});return claim;
}
export async function releaseRoomLibraryRecord(claim:object|undefined){if(!claim)return;const state=claims.get(claim);if(!state)return;claims.delete(claim);await state.DB.prepare('DELETE FROM rr_library_import_claims WHERE room_id=? AND library_url=? AND claim_id=?').bind(state.room,state.url,state.id).run();}
// Only the backend's unforgeable, freshly verified proof can prepare these writes.
export async function libraryReceiptStatements(request:Request,c:Config,page:Page,proof:object,rawPublisherURL?:string){
 const room=await requireRoom(request,c),actualProof=await roomProof(request,c,proof),meta=libraryPageProofMetadata(actualProof);if(!meta||!await savedLibraryPageMatches(parsed(page.document),actualProof))throw conflict();
 const claimId=boundProofs.get(proof)?.claimId,claimTime=Date.now();if(!claimId||!await c.DB.prepare('SELECT 1 AS active FROM rr_library_import_claims WHERE room_id=? AND library_url=? AND claim_id=? AND expires_at>?').bind(room.id,meta.libraryURL,claimId,claimTime).first())throw conflict();
 const claimGate=' AND EXISTS (SELECT 1 FROM rr_library_import_claims lc WHERE lc.room_id=? AND lc.library_url=? AND lc.claim_id=? AND lc.expires_at>?)',claimArgs=[room.id,meta.libraryURL,claimId,claimTime];
 const url=publisherURL(rawPublisherURL,meta.publisherKey);if(rawPublisherURL&&(!url||boundProofs.get(proof)?.publisherURL!==url))throw conflict();const now=new Date().toISOString();
 const statements=[c.DB.prepare(`INSERT INTO rr_verified_library_pages(room_id,page_id,library_url,publisher_key,publication,source_title,source_date,paragraph_fingerprint,proof_revision,verified_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=? AND p.id=? AND p.document=?) AND ${memberGate()}${claimGate} ON CONFLICT(room_id,page_id) DO UPDATE SET library_url=excluded.library_url,publisher_key=excluded.publisher_key,publication=excluded.publication,source_title=excluded.source_title,source_date=excluded.source_date,paragraph_fingerprint=excluded.paragraph_fingerprint,proof_revision=excluded.proof_revision,verified_at=excluded.verified_at`).bind(room.id,page.id,meta.libraryURL,meta.publisherKey,meta.publication,meta.title,meta.date,meta.paragraphFingerprint,meta.schema,now,room.id,page.id,page.document,room.id,room.member_id,...claimArgs)];
 if(url)statements.push(c.DB.prepare(`INSERT INTO rr_article_source_aliases(room_id,publisher_url,page_id,verified_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM rr_verified_library_pages v JOIN education_pages p ON p.id=v.page_id WHERE v.room_id=? AND v.page_id=? AND v.library_url=? AND p.document=?) AND ${memberGate()}${claimGate} ON CONFLICT(room_id,publisher_url) DO UPDATE SET page_id=CASE WHEN rr_article_source_aliases.page_id=excluded.page_id THEN excluded.page_id ELSE NULL END`).bind(room.id,url,page.id,now,room.id,page.id,meta.libraryURL,page.document,room.id,room.member_id,...claimArgs));
 return statements;
}
export async function reuseVerifiedLibraryPage(request:Request,c:Config,proof:object,rawPublisherURL?:string){
 const room=await requireRoom(request,c),actualProof=await roomProof(request,c,proof),meta=libraryPageProofMetadata(actualProof);if(!meta)throw conflict();
 const rows=await c.DB.prepare("SELECT p.id,p.document,p.title,p.created_at FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id WHERE a.room_id=? AND (p.source_url IN (?,?) OR json_extract(p.document,'$.capture.diagnostics.libraryURL') IN (?,?)) LIMIT 21").bind(room.id,meta.libraryURL,meta.libraryURL.replace('news%2F','news/'),meta.libraryURL,meta.libraryURL.replace('news%2F','news/')).all();
 if((rows.results||[]).length>20)throw conflict();const matches:Page[]=[];for(const row of rows.results||[])if(await savedLibraryPageMatches(parsed(row.document),actualProof))matches.push(row as Page);if(matches.length>1)throw conflict();if(!matches.length)return null;
 const page=matches[0];if(!c.DB.batch)throw Error('Transactional library identity is unavailable.');await c.DB.batch(await libraryReceiptStatements(request,c,page,proof,rawPublisherURL));
 const saved=await roomVerifiedLibraryRecord(request,c,meta.libraryURL);if(saved?.id!==page.id)throw conflict();if(rawPublisherURL&&(await roomLibraryAlias(request,c,rawPublisherURL))?.id!==page.id)throw conflict();return saved;
}
export async function saveUncountedLibraryPage(request:Request,c:Config,page:{id:string;sourceHash:string;sourceURL:string;title:string;document:string;createdAt:string},proof:object,rawPublisherURL?:string){
 const room=await requireRoom(request,c);if(!c.DB.batch)throw Error('Transactional library identity is unavailable.');const receipts=await libraryReceiptStatements(request,c,page,proof,rawPublisherURL);
 await c.DB.batch([c.DB.prepare(`INSERT INTO education_pages(id,source_hash,source_url,title,document,created_at) SELECT ?,?,?,?,?,? WHERE ${memberGate()} ON CONFLICT(source_hash) DO NOTHING`).bind(page.id,page.sourceHash,page.sourceURL,page.title,page.document,page.createdAt,room.id,room.member_id),c.DB.prepare(`INSERT OR IGNORE INTO rr_room_articles(room_id,page_id,added_by,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM education_pages WHERE id=?) AND ${memberGate()}`).bind(room.id,page.id,room.member_id,page.createdAt,page.id,room.id,room.member_id),...receipts]);
 const meta=libraryPageProofMetadata(await roomProof(request,c,proof)),saved=await roomVerifiedLibraryRecord(request,c,meta.libraryURL);if(!saved)throw conflict();return {id:saved.id,cached:saved.id!==page.id};
}

const unchangedLocator=()=>({attached:false,aliasAttached:false,mediaAdded:0});
const mediaBases=new Set(['exact-article-public-preview-thumbnail','exact-article-public-player-metadata']);
function attestedMedia(raw:any,publicURL:string){
 if(!raw||!Array.isArray(raw.blocks)||!Array.isArray(raw.receipts)||raw.blocks.length>4||raw.receipts.length!==raw.blocks.length)return null;
 const allowed=new Set(['id','type','url','caption','credit','poster','aspectRatio','style','rect','sourceURL','basis','placement','originalPlacementVerified']);
 const blocks:any[]=[],ids=new Set<string>();
 for(const block of raw.blocks){
  const url=block?.type==='video'?videoEmbed(block.url):block?.type==='figure'?mediaURL(block.url):'';
  if(!block||Object.keys(block).some(key=>!allowed.has(key))||!url||url!==block.url||typeof block.id!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(block.id)||ids.has(block.id)||block.sourceURL!==publicURL||!mediaBases.has(block.basis)||block.placement!=='approximate'||block.originalPlacementVerified!==false||typeof block.caption!=='string'||block.caption.length>1500||typeof block.credit!=='string'||block.credit.length>500||block.poster!==''&&mediaURL(block.poster)!==block.poster||!Number.isFinite(block.aspectRatio)||block.aspectRatio<.5||block.aspectRatio>3||!block.style||Object.keys(block.style).length||!block.rect||Object.values(block.rect).some(value=>!Number.isFinite(value)))return null;
  const receipt=raw.receipts.filter((value:any)=>value?.id===block.id);if(receipt.length!==1||receipt[0].type!==block.type||receipt[0].url!==url||receipt[0].sourceURL!==publicURL||receipt[0].basis!==block.basis||receipt[0].placement!=='approximate'||receipt[0].originalPlacementVerified!==false)return null;
  ids.add(block.id);blocks.push({...block,style:{},rect:{...block.rect}});
 }
 return {blocks,receipts:raw.receipts.map((value:any)=>({id:value.id,type:value.type,url:value.url,sourceURL:publicURL,basis:value.basis,placement:'approximate',originalPlacementVerified:false}))};
}
/** Internal only: both capabilities originate from server verification, never JSON. */
export async function attachVerifiedPublicLocator(request:Request,c:Config,input:{boundLibraryProof:object;requestId:string;pageId:string;locatorAttestation:object}){
 const room=await requireRoom(request,c);if(request.method!=='POST'||!sameOrigin(request)||!c.DB.batch||!/^[a-f0-9]{48}$/.test(input?.pageId||''))return unchangedLocator();
 try{
  const proof=await roomProof(request,c,input.boundLibraryProof,input.requestId),meta=libraryPageProofMetadata(proof),locator=publicLibraryLocatorMetadata(input.locatorAttestation),rawMedia=publicLibraryLocatorMedia(input.locatorAttestation),now=Date.now();
  const locatorTime=Date.parse(locator?.checkedAt||''),age=now-locatorTime;
  if(!meta||meta.publisherKey!=='observer'||!locator||locator.publisherKey!=='observer'||locator.publisherKey!==meta.publisherKey||locator.libraryURL!==meta.libraryURL||locator.actualLibraryTitle.normalize('NFC').replace(/\s+/gu,' ').trim()!==meta.title||locator.basis!=='exact-library-article-public-head/v1'||!Number.isFinite(locatorTime)||age<0||age>5*60*1000||publisherURL(locator.publicURL,meta.publisherKey)!==locator.publicURL)return unchangedLocator();
  const media=attestedMedia(rawMedia,locator.publicURL);if(!media)return unchangedLocator();
  const row:any=await c.DB.prepare('SELECT p.id,p.source_url,p.document,v.* FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id JOIN rr_verified_library_pages v ON v.room_id=a.room_id AND v.page_id=a.page_id WHERE a.room_id=? AND p.id=?').bind(room.id,input.pageId).first();
  const document=parsed(row?.document);if(!row||Object.keys(meta).some(key=>metadata(row)[key as keyof ReturnType<typeof metadata>]!==meta[key])||!await savedLibraryPageMatches(document,proof)||!await savedLibraryReceiptMatches(document,metadata(row))||row.source_url!==document.capture.url)return unchangedLocator();
  const state=boundProofs.get(input.boundLibraryProof),claimId=state?.claimId;if(!claimId||state.requestedPublisherURL!==locator.publicURL)return unchangedLocator();
  const capture=document.capture,existingURLs=new Set(capture.blocks.filter((block:any)=>['figure','video'].includes(block.type)).map((block:any)=>block.type==='video'?videoEmbed(block.url):mediaURL(block.url))),existingIDs=new Set(capture.blocks.map((block:any)=>block.id)),added:any[]=[];
  for(const block of media.blocks){if(existingURLs.has(block.url))continue;if(existingIDs.has(block.id))return unchangedLocator();existingURLs.add(block.url);existingIDs.add(block.id);added.push(block);}
  if(capture.blocks.length+added.length>700)return unchangedLocator();
  const addedIDs=new Set(added.map(block=>block.id)),previousReceipts=Array.isArray(document.libraryPublicLocator?.receipts)&&document.libraryPublicLocator?.publicURL===locator.publicURL?document.libraryPublicLocator.receipts.filter((value:any)=>mediaBases.has(value?.basis)&&value.sourceURL===locator.publicURL&&value.placement==='approximate'&&value.originalPlacementVerified===false&&capture.blocks.some((block:any)=>block.id===value.id&&block.type===value.type&&block.url===value.url)).slice(0,700).map((value:any)=>({id:value.id,type:value.type,url:value.url,sourceURL:value.sourceURL,basis:value.basis,placement:'approximate',originalPlacementVerified:false})):[],next={...document,capture:{...capture,blocks:[...capture.blocks,...added],diagnostics:{...capture.diagnostics,imageCount:capture.blocks.filter((block:any)=>block.type==='figure').length+added.filter(block=>block.type==='figure').length,videoCount:capture.blocks.filter((block:any)=>block.type==='video').length+added.filter(block=>block.type==='video').length}},libraryPublicLocator:{schema:'rr-library-public-locator/v1',receiptId:crypto.randomUUID(),publicURL:locator.publicURL,checkedAt:locator.checkedAt,basis:locator.basis,added:added.length,receipts:[...previousReceipts,...media.receipts.filter((value:any)=>addedIDs.has(value.id))]}};
  if(!await savedLibraryPageMatches(next,proof))return unchangedLocator();
  const after=JSON.stringify(next),receiptGate="EXISTS (SELECT 1 FROM rr_room_articles a JOIN rr_verified_library_pages v ON v.room_id=a.room_id AND v.page_id=a.page_id WHERE a.room_id=? AND a.page_id=? AND v.library_url=? AND v.publisher_key=? AND v.publication=? AND v.source_title=? AND v.source_date=? AND v.paragraph_fingerprint=? AND v.proof_revision=?)",receiptArgs=[room.id,row.id,meta.libraryURL,meta.publisherKey,meta.publication,meta.title,meta.date,meta.paragraphFingerprint,meta.schema],claimGate='EXISTS (SELECT 1 FROM rr_library_import_claims lc WHERE lc.room_id=? AND lc.library_url=? AND lc.claim_id=? AND lc.member_id=? AND lc.expires_at>?)',claimArgs=[room.id,meta.libraryURL,claimId,room.member_id,now],gate=receiptGate+' AND '+memberGate()+' AND '+claimGate,gateArgs=[...receiptArgs,room.id,room.member_id,...claimArgs];
  const result=await c.DB.batch([
   c.DB.prepare(`UPDATE education_pages SET document=? WHERE id=? AND source_url=? AND document=? AND ${gate}`).bind(after,row.id,row.source_url,row.document,...gateArgs),
   // The unique receiptId makes this gate belong only to this CAS winner.
   c.DB.prepare(`INSERT INTO rr_article_source_aliases(room_id,publisher_url,page_id,verified_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM education_pages p WHERE p.id=? AND p.source_url=? AND p.document=?) AND ${gate} ON CONFLICT(room_id,publisher_url) DO UPDATE SET page_id=CASE WHEN rr_article_source_aliases.page_id=excluded.page_id THEN excluded.page_id ELSE NULL END`).bind(room.id,locator.publicURL,row.id,new Date(now).toISOString(),row.id,row.source_url,after,...gateArgs)
  ]);
  await requireRoom(request,c);if(!result[0]?.meta?.changes||!result[1]?.meta?.changes)return unchangedLocator();
  return {attached:true,aliasAttached:true,mediaAdded:added.length};
 }catch(error){if(error instanceof Response&&[401,403].includes(error.status))throw error;return unchangedLocator();}
}
