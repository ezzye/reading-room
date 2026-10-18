import {LIBRARY_PUBLICATIONS,proveLibraryPublication,publicationFieldValue} from './library-publications.mjs';
import {publicationLabel} from './newsbank-publications.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';
import {librarySearchQuery,sanitizeLibrarySearch} from './library-search-contract.mjs';

const visible=element=>{for(let node=element;node?.getAttribute;node=node.parentElement)if(node.matches('[hidden],[inert],[aria-hidden="true"],script,style,noscript,template,form')||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(node.getAttribute('style')||''))return false;return true;};
function metadataText(element,max=400){if(!element||!visible(element))return '';const copy=element.cloneNode(true);for(const node of copy.querySelectorAll('script,style,noscript,template,form,input,textarea,button,p,[hidden],[inert],[aria-hidden="true"]'))node.remove();for(const node of copy.querySelectorAll('[style]'))if(!visible(node))node.remove();return (copy.textContent||'').replace(/\s+/g,' ').trim().slice(0,max);}
export function librarySearchTerms(input){const {query}=librarySearchQuery(input);return (query.match(/\p{L}[\p{L}\p{N}’'-]*/gu)||[]).map(word=>'"'+word+'"').join(' AND ');}
function sourceField(hit,publisher){
 const recognized=value=>publicationLabel(value)||Object.keys(LIBRARY_PUBLICATIONS).some(key=>proveLibraryPublication(value,key));
 const named=[...hit.querySelectorAll('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]')].filter(visible),items=[...hit.querySelectorAll('ul li')].filter(visible),fields=[];
 for(const node of [...new Set([...named,...items])]){
  if(node.querySelector('article,form,input,textarea,h1,h2,h3'))continue;
  const raw=node.getAttribute('data-publication')||metadataText(node,1000),value=publicationFieldValue(raw);
  const explicit=named.includes(node)||/^(?:Publication|Source)\s*:/i.test(raw);
  if(value&&(explicit||recognized(value)))fields.push({value,explicit});
 }
 const matches=[...new Set(fields.filter(field=>proveLibraryPublication(field.value,publisher)).map(field=>field.value))];
 if(matches.length!==1||fields.some(field=>!proveLibraryPublication(field.value,publisher)&&(field.explicit||recognized(field.value))))return '';
 return matches[0];
}
// Inspect only native result metadata. Neither snippets, documents nor Next links
// are fetched or copied by this operation.
export function librarySearchPage(document,base,input,normalizeDate){
 const requested=librarySearchQuery(input),hits=[...document.querySelectorAll('[id^="search-hits__hit--"],.search-hits__hit')].filter(visible),rows=new Map(),conflicts=new Set();
 for(const hit of hits.slice(0,20)){
  const anchor=hit.querySelector('h3 a,h2 a'),libraryURL=anchor&&visible(anchor)?diagnosticDocumentURL(anchor.getAttribute('href')||'',base):'';
  const title=metadataText(anchor).replace(/^Go to the document viewer for\s*/i,'').trim(),publication=sourceField(hit,requested.publisher),date=[...hit.querySelectorAll('ul li')].filter(visible).map(item=>normalizeDate(metadataText(item,300))).find(Boolean)||'';
  if(!libraryURL||!title||!publication||!date)continue;
  const row={title,date,publication,libraryURL},prior=rows.get(libraryURL);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(row)){conflicts.add(libraryURL);continue;}rows.set(libraryURL,row);
 }
 return sanitizeLibrarySearch({status:'library-search',schema:'newsbank-library-search/v1',requested,pageCount:1,inspectedCount:Math.min(hits.length,20),truncated:hits.length>20||Boolean(document.querySelector('a[rel~="next"],.pager__item--next a,.pagination .next a')),results:[...rows.values()].filter(row=>!conflicts.has(row.libraryURL)),fullTextVerified:false,articleAccepted:false});
}
