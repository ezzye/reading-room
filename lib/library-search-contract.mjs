import {libraryPublication,proveLibraryPublication} from './library-publications.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';

const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(value)?value.replace(/\s+/g,' ').trim():'';
export function librarySearchQuery(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['publisher','query'].includes(key))||!libraryPublication(raw.publisher))throw Error('invalid_library_search');
 const query=plain(raw.query,240);if(!query||query.length<4||(query.match(/\p{L}[\p{L}\p{N}’'-]*/gu)||[]).length<2)throw Error('invalid_library_search');
 return {publisher:raw.publisher,query};
}
function validDate(raw){return typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw)&&Number.isFinite(Date.parse(raw+'T00:00:00Z'))&&new Date(raw+'T00:00:00Z').toISOString().slice(0,10)===raw;}
// Strict metadata contract shared by the signed transport and room API.
// Publication proof applies only to source metadata, never full-text access.
export function sanitizeLibrarySearch(raw){
 if(!raw||raw.status!=='library-search'||raw.schema!=='newsbank-library-search/v1'||['session','cookies','account','cardNumber','html','body','paragraphs','content'].some(key=>Object.hasOwn(raw,key)))return null;
 let requested;try{requested=librarySearchQuery(raw.requested);}catch{return null;}
 if(raw.pageCount!==1||!Number.isInteger(raw.inspectedCount)||raw.inspectedCount<0||raw.inspectedCount>20||!Array.isArray(raw.results)||raw.results.length>20||raw.fullTextVerified!==false||raw.articleAccepted!==false)return null;
 const results=[],seen=new Set();
 for(const row of raw.results){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['title','date','publication','libraryURL'].includes(key)))return null;
  const title=plain(row.title,400),publication=plain(row.publication,200),libraryURL=diagnosticDocumentURL(row.libraryURL);
  if(title.length<5||!validDate(row.date)||!publication||!proveLibraryPublication(publication,requested.publisher)||!libraryURL)return null;
  if(seen.has(libraryURL))continue;seen.add(libraryURL);results.push({title,date:row.date,publication,libraryURL});
 }
 return {status:'library-search',schema:'newsbank-library-search/v1',requested,pageCount:1,inspectedCount:raw.inspectedCount,truncated:raw.truncated===true,results,fullTextVerified:false,articleAccepted:false};
}
