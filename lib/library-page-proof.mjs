import {libraryPublication,libraryPublicationForURL,proveLibraryPublication} from './library-publications.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';
import {normalizeNewsBankDate} from './newsbank-http.mjs';

const SCHEMA='rr-library-page-proof/v1',proofs=new WeakMap();
const normalize=value=>typeof value==='string'?value.normalize('NFC').replace(/\s+/gu,' ').trim():'';
const fields=['schema','publisherKey','libraryURL','title','date','publication','paragraphFingerprint'];
const invalid=()=>{throw Error('The verified library source could not provide an exact page proof.');};
function paragraphs(raw){
 if(!Array.isArray(raw)||raw.length<3||raw.length>100)return invalid();
 let size=0;const normalized=raw.map(value=>{if(typeof value!=='string'||value.length>6000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))return invalid();const clean=normalize(value);if(!clean)return invalid();size+=clean.length;return clean;});
 if(size>30000)return invalid();return normalized;
}
/** Whitespace and Unicode canonical composition are the only prose changes. */
export async function libraryParagraphFingerprint(raw){
 const body=JSON.stringify(paragraphs(raw)),bytes=new TextEncoder().encode('rr-library-paragraphs/v1\u0000'+body),digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function validateLibraryPageProofMetadata(raw){
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==fields.length||Object.keys(raw).some(key=>!fields.includes(key))||raw.schema!==SCHEMA)return null;
  const paper=libraryPublication(raw.publisherKey),libraryURL=diagnosticDocumentURL(raw.libraryURL),title=normalize(raw.title),date=normalizeNewsBankDate(raw.date),publication=paper?proveLibraryPublication(raw.publication,paper.key):'';
  if(!paper||!libraryURL||raw.libraryURL!==libraryURL||!title||title.length>600||raw.title!==title||/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(title)||!date||raw.date!==date||!publication||raw.publication!==publication||!paper.canonicalLabels.includes(publication)||typeof raw.paragraphFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.paragraphFingerprint))return null;
  return Object.freeze({schema:SCHEMA,publisherKey:paper.key,libraryURL,title,date,publication,paragraphFingerprint:raw.paragraphFingerprint});
 }catch{return null;}
}
/** Only an already verified server lookup/selection may call this constructor.
 * Room/request scope and atomic receipt persistence belong to the server caller.
 * No client assertion or capture flag supplies this capability. */
export async function createLibraryPageProof(input){
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['publisher','article'].includes(key)))return invalid();
  const paper=libraryPublication(input.publisher),article=input.article;
  if(!paper||!article||typeof article!=='object'||Array.isArray(article)||Object.keys(article).some(key=>!['title','byline','date','publication','libraryURL','paragraphs'].includes(key))||typeof article.title!=='string'||article.title.length>600||typeof article.byline!=='string'||article.byline.length>500||typeof article.date!=='string'||article.date.length>100||typeof article.publication!=='string'||article.publication.length>250)return invalid();
  const metadata=validateLibraryPageProofMetadata({schema:SCHEMA,publisherKey:paper.key,libraryURL:diagnosticDocumentURL(article.libraryURL),title:normalize(article.title),date:normalizeNewsBankDate(article.date),publication:proveLibraryPublication(article.publication,paper.key),paragraphFingerprint:await libraryParagraphFingerprint(article.paragraphs)});
  if(!metadata)return invalid();const proof=Object.freeze(Object.create(null));proofs.set(proof,metadata);return proof;
 }catch{return invalid();}
}
export function libraryPageProofMetadata(proof){return proof&&typeof proof==='object'?proofs.get(proof)||null:null;}

function capturedParagraphs(document,metadata){
 if(!document||document.kind!=='rendered-capture-v1')return null;
 const capture=document.capture,paper=libraryPublication(metadata.publisherKey);
 if(!capture||capture.schema!=='ret-capture/v1'||capture.presentation?.method!=='library-text'||capture.diagnostics?.libraryTextEdition!==true||diagnosticDocumentURL(capture.diagnostics?.libraryURL)!==metadata.libraryURL||normalize(capture.title)!==metadata.title||normalizeNewsBankDate(capture.date)!==metadata.date||normalize(capture.publisher)!==paper.name+' · Camden NewsBank text edition'||!Array.isArray(capture.blocks)||capture.blocks.length>700)return null;
 const recordURL=diagnosticDocumentURL(capture.url);
 if(recordURL){if(recordURL!==metadata.libraryURL||capture.diagnostics.libraryRecordEdition!==true)return null;}
 else{let source;try{source=libraryPublicationForURL(capture.url);}catch{return null;}if(source.key!==metadata.publisherKey)return null;}
 const body=[];
 for(const block of capture.blocks){
  if(!block||typeof block!=='object')return null;
  if(block.type==='paragraph'){body.push(block.text);continue;}
  // Media may have been appended after the original library-text save. It does
  // not change paragraph equality; any additional prose-bearing block refuses.
  if(!['figure','video'].includes(block.type)||Object.hasOwn(block,'text')&&block.text!==''&&block.text!==null&&block.text!==undefined)return null;
 }
 return body;
}
/** Metadata input here must come from a trusted stored receipt, never JSON body. */
export async function savedLibraryReceiptMatches(document,raw){
 try{const metadata=validateLibraryPageProofMetadata(raw);if(!metadata)return false;const body=capturedParagraphs(document,metadata);return Boolean(body)&&await libraryParagraphFingerprint(body)===metadata.paragraphFingerprint;}catch{return false;}
}
export async function savedLibraryPageMatches(document,proof){const metadata=libraryPageProofMetadata(proof);return metadata?await savedLibraryReceiptMatches(document,metadata):false;}
