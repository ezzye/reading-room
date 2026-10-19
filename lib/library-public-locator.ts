import type {Config} from './education-service.ts';
import {requireRoom} from './rooms.ts';
import {sameOrigin} from './edition-access.ts';
import {libraryPublicationForURL} from './library-publications.mjs';
import {savedLibraryReceiptMatches} from './library-page-proof.mjs';
import {collectLibraryPublicMedia,publicLibraryLocatorMetadata} from './library-public-media.mjs';
import {assertRoomLibraryProof,attachVerifiedPublicLocator} from './library-page-index.ts';

const unchanged={attached:false,aliasAttached:false,mediaAdded:0};
/** Internal intake coordinator. The sole caller is the Observer library-only
 * branch, which skipped the public prose fetch before making any request. */
export async function attachObserverLibraryMedia(request:Request,c:Config,input:{boundLibraryProof:object;requestId:string;pageId:string;publicURL:string},fetcher:typeof fetch=fetch){
 if(request.method!=='POST'||!sameOrigin(request))return unchanged;
 const room=await requireRoom(request,c),proof=await assertRoomLibraryProof(request,c,input.boundLibraryProof,input.requestId);
 let paper;try{paper=libraryPublicationForURL(input.publicURL);}catch{return unchanged;}
 if(proof.publisherKey!=='observer'||paper?.key!=='observer'||!/^[a-f0-9]{48}$/.test(input.pageId))return unchanged;
 const page:any=await c.DB.prepare('SELECT p.document FROM education_pages p JOIN rr_room_articles a ON a.page_id=p.id WHERE a.room_id=? AND p.id=?').bind(room.id,input.pageId).first();
 let document;try{document=JSON.parse(page?.document);}catch{return unchanged;}
 if(!await savedLibraryReceiptMatches(document,proof))return unchanged;
 // This shares the existing media-check allowance; it is neither an import nor
 // a commentary request. Refusals consume this bounded check, never a retry.
 const slot='room-media:'+room.id+':'+new Date().toISOString().slice(0,10);
 if(!await c.DB.prepare('INSERT INTO education_counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n=n+1 WHERE n<20 RETURNING n').bind(slot).first())return unchanged;
 // A transient public locator supplies head metadata only. The saved capture's
 // actual NewsBank URL, text, annotations and discussion are never rewritten.
 const capture={...document.capture,url:paper.url,title:proof.title,diagnostics:{...document.capture.diagnostics,libraryURL:proof.libraryURL}},collected=await collectLibraryPublicMedia(capture,fetcher),locatorAttestation=collected.locatorAttestation;
 if(!locatorAttestation||!publicLibraryLocatorMetadata(locatorAttestation))return unchanged;
 return attachVerifiedPublicLocator(request,c,{boundLibraryProof:input.boundLibraryProof,requestId:input.requestId,pageId:input.pageId,locatorAttestation});
}
