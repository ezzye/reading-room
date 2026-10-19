import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';
import {EXPRESS_PUBLICATION_LABEL} from './library-publications.mjs';
export const PUBLICATION_SEARCH_REASONS=Object.freeze(['entry_needs_interaction','session_expired','form_missing','destination_changed','results_changed','route_changed']);
export const PUBLICATION_SEARCH_STAGES=Object.freeze(['session','entry','form','results','route']);
export const publicationObservedPath=value=>typeof value==='string'&&/^\/apps\/news\/[a-z-]{0,40}$/.test(value)?value:'';
export function sanitizePublicationSearchStatus(raw){
  if(!raw||!['login_required','needs_interaction'].includes(raw.status)||!PUBLICATION_SEARCH_REASONS.includes(raw.reasonCode)||!PUBLICATION_SEARCH_STAGES.includes(raw.stage)||raw.status==='login_required'&&raw.reasonCode!=='session_expired'||raw.status==='needs_interaction'&&raw.reasonCode==='session_expired')return null;
  if(Object.hasOwn(raw,'observedPath')&&(!['destination_changed','route_changed'].includes(raw.reasonCode)||!publicationObservedPath(raw.observedPath)))return null;
  return {status:raw.status,stage:raw.stage,reasonCode:raw.reasonCode,...(raw.observedPath?{observedPath:raw.observedPath}:{})};
}

// Search labels are metadata evidence only. They never extend the separate
// publication registry proof required to accept full text.
export const PUBLICATION_SEARCH_KEYS = Object.freeze({
  times:'The Times', telegraph:'The Telegraph (London)', scotsman:'The Scotsman',
  herald:'The Herald (Scotland)', national:'The National (Scotland)',
  'press-and-journal':'Press and Journal', courier:'The Courier (Scotland)',
  'belfast-telegraph':'Belfast Telegraph', 'irish-news':'The Irish News',
  'news-letter':'News Letter', nytimes:'The New York Times',
  'washington-post':'The Washington Post', 'wall-street-journal':'The Wall Street Journal',
  'usa-today':'USA Today',
  observer:'The Observer', express:'Daily Express / Sunday Express',
  ft:'Financial Times', 'morning-star':'Morning Star',
  'irish-times':'The Irish Times','irish-independent':'Irish Independent','irish-examiner':'Irish Examiner',
});
export function publicationSearchQuery(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['publication','title'].includes(key))||!Object.hasOwn(PUBLICATION_SEARCH_KEYS,raw.publication))throw Error('invalid_publication_query');
  if(typeof raw.title!=='string'||raw.title.length<15||raw.title.length>400||/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(raw.title))throw Error('invalid_publication_query');
  const title=raw.title.replace(/\s+/g,' ').trim();if(title.split(/\s+/).length<3)throw Error('invalid_publication_query');
  return {publication:raw.publication,title};
}
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(value)?value.replace(/\s+/g,' ').trim():'';
function visible(el){for(let node=el;node?.getAttribute;node=node.parentElement)if(node.matches('[hidden],[inert],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(node.getAttribute('style')||''))return false;return true;}
function metadataText(el,max=400){if(!el)return '';const copy=el.cloneNode(true);for(const node of copy.querySelectorAll('script,style,noscript,template,p,[hidden],[aria-hidden="true"]'))node.remove();for(const node of [...copy.querySelectorAll('*')])if(!visible(node))node.remove();return (copy.textContent||'').replace(/\s+/g,' ').trim().slice(0,max);}
const PUBLICATION_FIELD_CONTEXTS=new Set(['data-publication','source-class','publication-class','labelled-source','labelled-publication','unlabelled-publication-candidate']);
// Diagnostic prefixes use only registered title names. The optional leading
// article is already recognised by publicationLabel; it is not a new match alias.
const PUBLICATION_FIELD_PREFIXES=[...new Set([...Object.values(PUBLICATION_SEARCH_KEYS).flatMap(label=>label.split(' / ')).flatMap(label=>{const title=label.split(' (')[0];return title.startsWith('The ')?[title,title.slice(4),title.slice(4)+', The']:[title];}),'Express'])];
const knownPublicationFieldPrefix=label=>PUBLICATION_FIELD_PREFIXES.some(prefix=>label===prefix||label.startsWith(prefix)&&/^[ ,(:;]/.test(label.slice(prefix.length)));
function literalPublicationField(raw){
  const value=text(raw,160);
  if(value===EXPRESS_PUBLICATION_LABEL)return value;
  if(!value||!/^\p{L}[\p{L} .,'’&():;-]{1,159}$/u.test(value)||value.split(/\s+/).length>16||/\b(?:private|secret|password|token|cookie|session|borrower|account|card|pin)\b/i.test(value))return '';
  return value;
}
// Separate unverified bibliography only. This never enters publicationLabel,
// source registration, title matching or full-text acceptance.
function metadataItem(raw){const value=text(raw,240);return value&&!/https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{8,}|\b(?:private|secret|password|passcode|token|cookie|session|borrower|account|card|pin|credential|authorization|bearer)\b/i.test(value)?value:'';}
function metadataItemContext(node,hit){
  if(!hit.matches('[id^="search-hits__hit--"],.search-hits__hit')||hit.closest('form,.document-view__body--ascii'))return false;
  // The result itself can be an article element; only containers inside that
  // observed hit boundary exclude bibliography. Nested article prose stays out.
  for(let parent=node;parent&&parent!==hit;parent=parent.parentElement)if(parent.matches('article,form,.document-view__body--ascii'))return false;
  return hit.contains(node);
}
// Catalogue cells are unverified public source-label evidence only. This does
// not extend publicationLabel, registry aliases or full-text acceptance.
export function unverifiedCataloguePublicationLabel(raw){
  const label=literalPublicationField(raw);
  return label&&knownPublicationFieldPrefix(label)&&/\([\p{L} .,'’&-]{2,80},\s*[\p{L} .,'’&-]{2,80}\)$/u.test(label)?label:'';
}
export function publicationEvidence(hit){
  const named=[...hit.querySelectorAll('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]')].filter(visible),items=[...hit.querySelectorAll('ul li')].filter(visible),labels=[],metadataFields=[],metadataItems=[];
  const add=(context,raw)=>{const label=literalPublicationField(raw);if(label&&labels.length<2&&!labels.some(item=>item.context===context&&item.label===label))labels.push({context,label});};
  for(const node of named.slice(0,4)){
    if(!['A','DIV','SPAN','P','LI','DT','DD','TD'].includes(node.tagName)||node.querySelector('article,form,input,textarea,h1,h2,h3'))continue;
    const context=node.hasAttribute('data-publication')?'data-publication':node.classList.contains('search-hits__source')?'source-class':'publication-class';
    add(context,node.getAttribute('data-publication')||metadataText(node,500));
  }
  let labelledItems=0;
  for(const node of items.slice(0,20)){
    if(!metadataItemContext(node,hit))continue;
    const raw=metadataText(node,500),match=raw.match(/^(Publication|Source)\s*:\s*(.+)$/i);
    if(metadataItems.length<4&&!node.querySelector('p,article,form,input,select,textarea,button,h1,h2,h3,ul,ol')){const label=metadataItem(raw);if(label&&!metadataItems.some(item=>item.label===label))metadataItems.push({context:'unverified-metadata-item',label});}
    if(match){labelledItems++;add(match[1].toLowerCase()==='source'?'labelled-source':'labelled-publication',match[2]);}
    else{const label=literalPublicationField(raw);if(label&&knownPublicationFieldPrefix(label))add('unlabelled-publication-candidate',label);if(label&&metadataFields.length<4&&!node.querySelector('p,article,form,input,select,textarea,button,h1,h2,h3')&&!metadataFields.some(field=>field.label===label))metadataFields.push({context:'unlabelled-metadata-field',label});}
  }
  return {basis:'visible-result-metadata-only',namedFieldCount:Math.min(named.length,20),listItemCount:Math.min(items.length,20),labelledItemCount:Math.min(labelledItems,20),labels,...(metadataFields.length?{metadataFields}:{}),...(metadataItems.length?{metadataItems}:{})};
}
function cleanPublicationFieldEvidence(raw){
  if(!raw||raw.basis!=='visible-result-metadata-only'||Object.keys(raw).some(key=>!['basis','namedFieldCount','listItemCount','labelledItemCount','labels','metadataFields','metadataItems'].includes(key))||['namedFieldCount','listItemCount','labelledItemCount'].some(key=>!Number.isInteger(raw[key])||raw[key]<0||raw[key]>20)||!Array.isArray(raw.labels)||raw.labels.length>2)return null;
  const labels=[];for(const item of raw.labels){if(!item||!PUBLICATION_FIELD_CONTEXTS.has(item.context)||literalPublicationField(item.label)!==item.label||item.context==='unlabelled-publication-candidate'&&!knownPublicationFieldPrefix(item.label))return null;labels.push({context:item.context,label:item.label});}
  const metadataFields=[];if(Object.hasOwn(raw,'metadataFields')){if(!Array.isArray(raw.metadataFields)||raw.metadataFields.length>4)return null;for(const field of raw.metadataFields){if(!field||Object.keys(field).some(key=>!['context','label'].includes(key))||field.context!=='unlabelled-metadata-field'||literalPublicationField(field.label)!==field.label)return null;metadataFields.push({context:'unlabelled-metadata-field',label:field.label});}}
  const metadataItems=[];if(Object.hasOwn(raw,'metadataItems')){if(!Array.isArray(raw.metadataItems)||raw.metadataItems.length>4)return null;for(const item of raw.metadataItems){if(!item||Object.keys(item).some(key=>!['context','label'].includes(key))||item.context!=='unverified-metadata-item'||!metadataItem(item.label)||metadataItem(item.label)!==item.label)return null;metadataItems.push({context:'unverified-metadata-item',label:item.label});}}
  return {basis:'visible-result-metadata-only',namedFieldCount:raw.namedFieldCount,listItemCount:raw.listItemCount,labelledItemCount:raw.labelledItemCount,labels,...(metadataFields.length?{metadataFields}:{}),...(metadataItems.length?{metadataItems}:{})};
}
export function publicationLabel(raw) {
  const clean=text(raw,1000);if(!clean)return '';
  const labelled=clean.replace(/^(?:Publication|Source)\s*:\s*/i,'');
  const match=labelled.match(/^(?:The\s+)?(?:New York Times|Washington Post|Wall Street Journal|USA Today|Scotsman|Scotland on Sunday|Herald on Sunday|Sunday Herald|Herald|National|Press\s*(?:and|&)\s*Journal|Sunday Post|Courier(?:\s+and\s+Advertiser)?|Belfast Telegraph|Sunday Life|Irish News|News Letter|Newsletter|Financial Times|Irish Times|(?:Daily |Sunday )?Telegraph|(?:Sunday )?Times|Guardian|Independent|Daily Mail|Daily Mirror|Daily Express|Sunday Express|Morning Star|Observer|Evening Standard)\b(?:\s*\([A-Za-z .,'-]{2,80}\))?(?=$|\s*(?:[|·]|,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4})\b))/i);
  return match?.[0]?.slice(0,200)||'';
}
export function publicationSearchPage(document,base,query,normalizeDate) {
  const hits=[...document.querySelectorAll('[id^="search-hits__hit--"],.search-hits__hit')].filter(visible),results=[];let rejectedLinkCount=0;
  for(const hit of hits.slice(0,20)){
    const anchor=hit.querySelector('h3 a,h2 a');if(!anchor||!visible(anchor))continue;
    const libraryURL=diagnosticDocumentURL(anchor.getAttribute('href')||'',base);if(!libraryURL){rejectedLinkCount++;continue;}
    const title=metadataText(anchor).replace(/^Go to the document viewer for\s*/i,'').trim();if(!title)continue;
    const named=[...hit.querySelectorAll('[data-publication],.search-hits__source,.search-hits__publication,[class*="publication"]')].find(visible);
    const list=[...hit.querySelectorAll('ul li')].filter(visible).map(item=>metadataText(item,300));
    const publication=named?publicationLabel(named.getAttribute('data-publication')||metadataText(named,1000)):list.map(publicationLabel).find(Boolean)||'';
    results.push({title,date:normalizeDate(list.join(' ').slice(0,300)),publication,libraryURL,publicationEvidence:publicationEvidence(hit)});
  }
  return sanitizePublicationSearch({status:'metadata',schema:'newsbank-publications/v1',requested:query,pageCount:1,inspectedCount:Math.min(hits.length,20),rejectedLinkCount,truncated:hits.length>20||Boolean(document.querySelector('a[rel~="next"],.pager__item--next a,.pagination .next a')),results,fullTextVerified:false,articleAccepted:false});
}
export function sanitizePublicationSearch(raw) {
  if(!raw||raw.status!=='metadata'||raw.schema!=='newsbank-publications/v1'||['session','cookies','account','cardNumber','libraryName','html','body','paragraphs','content'].some(key=>Object.hasOwn(raw,key)))return null;
  let requested;try{requested=publicationSearchQuery(raw.requested);}catch{return null;}
  if(raw.pageCount!==1||!Number.isInteger(raw.inspectedCount)||raw.inspectedCount<0||raw.inspectedCount>20||!Number.isInteger(raw.rejectedLinkCount)||raw.rejectedLinkCount<0||raw.rejectedLinkCount>20||!Array.isArray(raw.results)||raw.results.length>20||raw.fullTextVerified!==false||raw.articleAccepted!==false)return null;
  const results=[];for(const candidate of raw.results){
    if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return null;
    const title=text(candidate?.title,400),libraryURL=diagnosticDocumentURL(candidate?.libraryURL),publication=publicationLabel(candidate?.publication||'');
    if(!title||!libraryURL||candidate?.publication&&publication!==candidate.publication||['paragraphs','body','html','content','snippet','session','cookies'].some(key=>Object.hasOwn(candidate,key)))return null;
    const date=text(candidate.date,10);if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))return null;
    const publicationEvidence=Object.hasOwn(candidate,'publicationEvidence')?cleanPublicationFieldEvidence(candidate.publicationEvidence):undefined;if(Object.hasOwn(candidate,'publicationEvidence')&&!publicationEvidence)return null;
    results.push({title,date,publication,libraryURL,...(publicationEvidence?{publicationEvidence}:{})});
  }
  return {status:'metadata',schema:'newsbank-publications/v1',requested,pageCount:1,inspectedCount:raw.inspectedCount,rejectedLinkCount:raw.rejectedLinkCount,truncated:raw.truncated===true,publications:[...new Set(results.map(row=>row.publication).filter(Boolean))],results,fullTextVerified:false,articleAccepted:false};
}
