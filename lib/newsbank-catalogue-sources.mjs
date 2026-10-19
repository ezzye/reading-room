import {parseHTML} from 'linkedom';
import {PUBLICATION_SEARCH_KEYS} from './newsbank-publications.mjs';

const SCHEMA='newsbank-catalogue-sources/v1',ORIGIN='https://infoweb.newsbank.com';
const privateText=/https?:|www\.|@|[\u0000-\u001f\u007f]|\d{8,}|[a-f0-9]{12,}|[a-z0-9_-]{32,}|\b(?:private|secret|password|passcode|token|cookie|session|borrower|account|card|pin|credential|authorization|bearer|csrf|nonce)\b/i;
const normalize=value=>typeof value==='string'?value.normalize('NFC').replace(/\s+/g,' ').trim():'';
const catalogueOnlyNames=['The Daily Telegraph','The Sunday Telegraph','The Sunday Times','Scotland on Sunday','Express, The/The Express on Sunday','Daily Record','The Sunday Mail','The Sunday Post','The Sunday Herald','Herald on Sunday','The Sunday Life','The Daily Mail','The Mail on Sunday','The Daily Mirror','The Sunday Mirror','The Sun','The Sun on Sunday','Daily Star','Daily Star Sunday','The Guardian','The Independent','The Independent on Sunday','Evening Standard','The Standard','The i Paper','The i','i Paper','Metro','The Metro','The New York Post','The Los Angeles Times','NPR','National Public Radio',
 // Exact owner-observed v88 catalogue names only; no full-text registration.
 'Daily Record, The / Sunday Mail','Press & Journal, The','Scotsman, The/Scotland on Sunday','Daily Telegraph, The/The Sunday Telegraph'];
export const CATALOGUE_SOURCE_NAMES=Object.freeze([...new Set([...Object.values(PUBLICATION_SEARCH_KEYS).flatMap(value=>value.split(' / ')),...catalogueOnlyNames].flatMap(value=>{const name=value.split(' (')[0];return name.startsWith('The ')?[name,name.slice(4),name.slice(4)+', The']:[name];}))]);
const names=new Set(CATALOGUE_SOURCE_NAMES.map(value=>value.toLowerCase()));
export const catalogueSourcePriority=name=>/Financial Times|Morning Star/i.test(name)||/^(?:the )?ft(?:\.com)?(?=$|[ .,:;(\/-])/i.test(name)?0:/Scotsman|Scotland on Sunday|Herald|National|Press (?:and|&) Journal|Courier|Irish|Belfast|Express|News Letter|Daily Record|Sunday Mail|Sunday Post|Sunday Life|New York|Washington Post|Wall Street Journal|USA Today|Los Angeles Times|\bNPR\b|National Public Radio/i.test(name)?1:2;
export function catalogueSourceName(raw){
 const value=normalize(raw);if(!value||value.length>160||privateText.test(value)||!/^\p{L}[\p{L} .,'’&():;\/-]*$/u.test(value))return '';
 let name=value;const location=name.match(/\s+\([\p{L} .,'’&-]{2,100}\)$/u);if(location)name=name.slice(0,-location[0].length);
 const pieces=name.split(':').map(value=>value.trim());if(pieces.length>4||pieces.slice(1).some(value=>!['Web Edition Articles','Blogs','Archive'].includes(value)))return '';
 return names.has(pieces[0].toLowerCase())?value:'';
}
// Research candidates deliberately do not enter the source-name whitelist,
// article matching or the independently verified publication registry.
export function catalogueVariantName(raw){
 const value=normalize(raw);if(!value||value.length>160||value.split(/\s+/).length>18||privateText.test(value)||!/^\p{L}[\p{L}\p{N} .,'’&():;\/-]*$/u.test(value)||catalogueSourceName(value))return '';
 return /^(?:the )?(?:(?:financial times|ft(?:\.com)?)|(?:(?:daily|sunday) )?telegraph|scotsman|morning star|belfast|irish|press (?:and|&) journal|courier|(?:daily )?record)(?=$|[ .,:;(\/-])/i.test(value)?value:'';
}
// Small inert formatting fragments only. Never strip scripts, links, forms,
// hidden or arbitrary elements into apparently safe metadata.
export function catalogueMetadataText(raw,max=100){
 if(typeof raw!=='string'||raw.length>2048)return '';
 let value=raw;
 if(/[<>]/.test(raw)){
  const {document}=parseHTML('<html><body><div id="catalogue-metadata">'+raw+'</div></body></html>'),root=document.getElementById('catalogue-metadata');
  if(!root||document.body.children.length!==1||root.parentElement!==document.body)return '';
  for(const node of root.querySelectorAll('*')){
   if(!['SPAN','B','STRONG','I','EM','BR'].includes(node.tagName))return '';
   for(const attribute of node.attributes)if(attribute.name!=='class'||!/^[a-z0-9 _-]{0,100}$/i.test(attribute.value)||/hidden|invisible|sr-only|private|account|session|token/i.test(attribute.value))return '';
   if(node.tagName==='BR')node.replaceWith(document.createTextNode(' '));
  }
  value=root.textContent;
 }
 value=normalize(value);return value.length<=max&&!privateText.test(value)&&/^[\p{L}\p{N} .,'’&():;\/%+–—-]*$/u.test(value)?value:'';
}
export function catalogueSourceColumns(columns){
 const headers=['Source Name','Step','Dates','Location','Type','Format','Language'];
 return Array.isArray(columns)&&columns.length===7&&columns.every((value,index)=>value?.index===index&&value.title===headers[index]&&value.type===(index===0?'link':'string')&&value.visible===(index!==1)&&value.searchable===(index!==1)&&value.sortable===(index!==1))&&columns[0].id==='label'&&columns[1].id==='step';
}
const templateReasons=new Set(['safe_native_source_template','template_missing','template_invalid','template_placeholder_invalid','template_url_invalid','template_route_unapproved','template_query_unapproved']);
const browseReasons=new Set(['native_source_url','template_unavailable','row_shape_changed','source_identity_unavailable','unsafe_row_reference','url_unavailable']);
const unavailableTemplate=reasonCode=>({status:'unavailable',reasonCode,path:'',queryKeys:[],placeholderIndices:[]});
const unavailableBrowse=reasonCode=>({status:'unavailable',reasonCode,url:''});
const paths=new Set(['/apps/news/','/apps/news/results','/apps/news/browse-pub']);
const diagnosticPath=value=>typeof value==='string'&&/^\/apps\/news\/(?:[a-z-]{1,40}\/?){0,1}$/.test(value)&&!/[a-f0-9]{12,}|[a-z0-9_-]{32,}/i.test(value)&&!/document|login|logout|account|user|librarycard|library-card|session|checkout|subscribe|my-folder|terms|privacy/.test(value);
const privateQuery=/token|auth|password|passcode|pin|session|credential|secret|cookie|card|borrower|account|email|user|login|logout|destination|redirect|return|docref|document|url|csrf|nonce|state|build|key|signature|policy|access|bearer|code|ticket|utm_|fbclid|gclid/i;
const diagnosticQueryKey=value=>typeof value==='string'&&/^[a-z][a-z0-9_.:\[\]-]{0,63}$/i.test(value)&&!/[a-f0-9]{12,}|[a-z0-9_-]{32,}/i.test(value)&&!privateQuery.test(value);
const tShapes=new Set(['literal-pubname-id','literal-pubname-id-name','row-source-reference','other']);
const referenceFailures=new Set(['none','encoding','credential-marker','source-name-mismatch','invalid-reference','url-unavailable']);
const credentialMarker=/private|secret|password|passcode|token|cookie|session|borrower|account|card|pin|credential|authorization|bearer|csrf|nonce|signature|api.?key/i;
function publicationReference(value,name){
 if(typeof value!=='string'||value.length>512)return {failureCode:'invalid-reference'};
 const match=value.match(/^pubname:([a-z0-9][a-z0-9_.-]{0,79})(?:!([\s\S]*))?$/i);if(!match)return {failureCode:'invalid-reference'};
 const hasName=match[2]!==undefined,receipt={namespace:'pubname',identifierKind:/^[a-f0-9]+$/i.test(match[1])?'hex':'alphanumeric',identifierLength:match[1].length,hasName,nameEncoding:hasName?'literal':'none',failureCode:'none'};
 let failureCode='none';
 if(/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]|https?:|www\.|@/i.test(value))failureCode='invalid-reference';
 else if(credentialMarker.test(match[1]))failureCode='credential-marker';
 else if(hasName&&(!match[2]||catalogueSourceName(match[2])!==name)){
  // Native result links visibly retain one form-encoded publication name
  // inside the Step reference. Decode that suffix once for equality only;
  // retain the original reference when rendering the observed template.
  if(!/[%+]/.test(match[2]))failureCode='source-name-mismatch';
  else{receipt.nameEncoding='form-encoded';let decoded;try{decoded=decodeURIComponent(match[2].replace(/\+/g,' '));}catch{failureCode='encoding';}
   if(failureCode==='none'&&/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]|https?:|www\.|@/i.test(decoded))failureCode='invalid-reference';
   if(failureCode==='none'&&(!decoded||catalogueSourceName(decoded)!==name))failureCode='source-name-mismatch';}
 }
 return {valid:failureCode==='none',value,referenceStructure:{...receipt,failureCode},failureCode};
}
export function sanitizeCatalogueReferenceStructure(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==6||Object.keys(raw).some(key=>!['namespace','identifierKind','identifierLength','hasName','nameEncoding','failureCode'].includes(key))||raw.namespace!=='pubname'||!['hex','alphanumeric'].includes(raw.identifierKind)||!Number.isInteger(raw.identifierLength)||raw.identifierLength<1||raw.identifierLength>80||typeof raw.hasName!=='boolean'||!['none','literal','form-encoded'].includes(raw.nameEncoding)||raw.hasName===(raw.nameEncoding==='none')||!referenceFailures.has(raw.failureCode))return null;
 return {namespace:'pubname',identifierKind:raw.identifierKind,identifierLength:raw.identifierLength,hasName:raw.hasName,nameEncoding:raw.nameEncoding,failureCode:raw.failureCode};
}
function valueStructure(value){const token='__(?:0|[1-6])__';return {tShape:new RegExp('^pubname:'+token+'$').test(value)?'literal-pubname-id':new RegExp('^pubname:'+token+'!'+token+'$').test(value)?'literal-pubname-id-name':new RegExp('^'+token+'(?:!'+token+')?$').test(value)?'row-source-reference':'other',hasLiteralPublicationPrefix:value.startsWith('pubname:'),hasLiteralNameSeparator:value.includes('!')};}
function templateStructure(raw,indices){
 let url;try{url=new URL(raw,ORIGIN+'/apps/news/source-list?p=UKNB');}catch{return {reasonCode:'template_url_invalid'};}
 if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.href.length>2048)return {reasonCode:'template_url_invalid'};
 if(!diagnosticPath(url.pathname))return {reasonCode:'template_route_unapproved'};
 const queryKeys=[...url.searchParams.keys()];if(queryKeys.length>10||new Set(queryKeys).size!==queryKeys.length||queryKeys.some(key=>!diagnosticQueryKey(key))||url.searchParams.getAll('p').length!==1||url.searchParams.get('p')!=='UKNB')return {reasonCode:'template_query_unapproved'};
 return {evidence:{status:'observed',reasonCode:'template_query_unapproved',path:url.pathname,queryKeys,placeholderIndices:indices.sort((a,b)=>a-b),valueStructure:{...valueStructure(url.searchParams.get('t')||''),...(url.searchParams.has('action')?{actionIsBrowse:url.searchParams.get('action')==='browse'}:{})}},url};
}
function nativeBrowse(raw,name){
 let url;try{url=new URL(raw,ORIGIN+'/apps/news/source-list?p=UKNB');}catch{return {reasonCode:'template_url_invalid'};}
 if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.href.length>2048||!paths.has(url.pathname))return {reasonCode:paths.has(url.pathname)?'template_url_invalid':'template_route_unapproved'};
 const rowReference=url.pathname==='/apps/news/browse-pub'&&[...url.searchParams].length===3&&url.searchParams.getAll('action').length===1&&url.searchParams.get('action')==='browse'&&[...url.searchParams.keys()].every(key=>['p','t','action'].includes(key));
 const legacy=[...url.searchParams].length===2&&[...url.searchParams.keys()].every(key=>['p','t'].includes(key));
 if(!rowReference&&!legacy||url.searchParams.getAll('p').length!==1||url.searchParams.get('p')!=='UKNB'||url.searchParams.getAll('t').length!==1||!url.searchParams.get('t')?.startsWith('pubname:'))return {reasonCode:'template_query_unapproved'};
 if(rowReference?!publicationReference(url.searchParams.get('t'),name).valid:privateText.test(url.searchParams.get('t'))||/[<>]|[a-z0-9_-]{32,}/i.test(url.searchParams.get('t')))return {reasonCode:'template_query_unapproved'};
 return {url,rowReference};
}
export function catalogueSourceBrowseURL(raw,name){
 if(typeof raw!=='string'||!raw||raw.length>2048||typeof name!=='string'||catalogueSourceName(name)!==name)return '';
 const result=nativeBrowse(raw,name);if(!result.url)return '';if(result.rowReference)return result.url.href;const match=result.url.searchParams.get('t').match(/^pubname:([a-z0-9_.:-]{1,80})!(.+)$/i);
 return match&&normalize(match[2])===name?result.url.href:'';
}
export function catalogueLinkTemplate(raw){
 if(raw===undefined)return {evidence:unavailableTemplate('template_missing'),template:null};
 if(typeof raw!=='string'||!raw||raw.length>2048||/[<>\u0000-\u001f\u007f]/.test(raw))return {evidence:unavailableTemplate('template_invalid'),template:null};
 const indices=[...new Set([...raw.matchAll(/__(\d+)__/g)].map(match=>Number(match[1])))];
 if(!indices.length||indices.length>7||indices.some(index=>index>6)||raw.replace(/__(?:0|[1-6])__/g,'').includes('__'))return {evidence:unavailableTemplate('template_placeholder_invalid'),template:null};
 const structure=templateStructure(raw,indices);if(!structure.evidence)return {evidence:unavailableTemplate(structure.reasonCode),template:null};
 const observed=structure.url;
 // v88 observed exactly one Step-column reference plus the fixed native
 // browse action. The row itself must supply the publication identifier.
 if(observed.pathname==='/apps/news/browse-pub'&&[...observed.searchParams].length===3&&observed.searchParams.get('action')==='browse'&&observed.searchParams.get('t')==='__1__'&&indices.length===1&&indices[0]===1&&[...observed.searchParams.keys()].every(key=>['p','t','action'].includes(key)))return {evidence:{...structure.evidence,reasonCode:'safe_native_source_template'},template:raw,rowReference:true};
 const probe=raw.replace(/__(\d+)__/g,(_,index)=>encodeURIComponent('field-'+index)),result=nativeBrowse(probe);
 if(!result.url)return {evidence:{...structure.evidence,reasonCode:result.reasonCode},template:null};
 // The known normal source link carries its source identifier and literal
 // source name. Other link shapes remain observations only, never guessed.
 if(!/^pubname:[a-z0-9_.:-]+!.+$/i.test(result.url.searchParams.get('t')))return {evidence:structure.evidence,template:null};
 return {evidence:{status:'observed',reasonCode:'safe_native_source_template',path:result.url.pathname,queryKeys:[...result.url.searchParams.keys()],placeholderIndices:indices.sort((a,b)=>a-b)},template:raw};
}
export function catalogueRowBrowse(link,row,name){
 if(!link?.template)return unavailableBrowse('template_unavailable');if(!Array.isArray(row)||row.length!==7)return unavailableBrowse('row_shape_changed');if(catalogueSourceName(name)!==name)return unavailableBrowse('source_identity_unavailable');
 if(link.rowReference){
  if(catalogueSourceName(catalogueMetadataText(row[0],160))!==name)return unavailableBrowse('source_identity_unavailable');
  const reference=publicationReference(row[1],name);if(!reference.valid)return {...unavailableBrowse('unsafe_row_reference'),...(reference.referenceStructure?{referenceStructure:reference.referenceStructure}:{})};
  // Only the actual publication identifier in the known pubname namespace is
  // exempt from generic opacity heuristics. Names, other values and routes
  // retain their normal guards; no identifier decoding or synthesis, and the
  // original Step is preserved after name-only comparison.
  const raw=link.template.replace(/__1__/g,()=>encodeURIComponent(reference.value)),url=catalogueSourceBrowseURL(raw,name);
  return url?{status:'available',reasonCode:'native_source_url',url,referenceStructure:reference.referenceStructure}:{...unavailableBrowse('url_unavailable'),referenceStructure:{...reference.referenceStructure,failureCode:'url-unavailable'}};
 }
 let unsafe=false;const raw=link.template.replace(/__(\d+)__/g,(_,index)=>{const value=row[Number(index)];if(typeof value!=='string'||value.length>512||!value||/[<>%\u0000-\u001f\u007f]|https?:|www\.|@/i.test(value)||privateText.test(value)){unsafe=true;return ''; }return encodeURIComponent(value);});
 if(unsafe)return unavailableBrowse('unsafe_row_reference');const url=catalogueSourceBrowseURL(raw,name);return url?{status:'available',reasonCode:'native_source_url',url}:unavailableBrowse('url_unavailable');
}
export function emptyCatalogueSources(){return {schema:SCHEMA,state:'unavailable',reasonCode:'source_columns_changed',rowsInspected:0,descriptorsTruncated:false,linkTemplate:unavailableTemplate('template_missing'),sources:[]};}
export function catalogueSources(columns,link){return catalogueSourceColumns(columns)?{schema:SCHEMA,state:'observed',reasonCode:'source_columns_matched',rowsInspected:0,descriptorsTruncated:false,linkTemplate:link.evidence,sources:[],variantCandidates:[],variantCandidatesTruncated:false}:emptyCatalogueSources();}
const object=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
export function sanitizeCatalogueSources(raw,columns,rowCount){
 const hasVariants=raw&&Object.hasOwn(raw,'variantCandidates'),baseKeys=['schema','state','reasonCode','rowsInspected','descriptorsTruncated','linkTemplate','sources'];
 if(!object(raw,hasVariants?[...baseKeys,'variantCandidates','variantCandidatesTruncated']:baseKeys)||raw.schema!==SCHEMA||!['observed','unavailable'].includes(raw.state)||!['source_columns_matched','source_columns_changed'].includes(raw.reasonCode)||!integer(raw.rowsInspected,3000)||typeof raw.descriptorsTruncated!=='boolean'||!Array.isArray(raw.sources)||raw.sources.length>40||!integer(rowCount,3000)||hasVariants&&(!Array.isArray(raw.variantCandidates)||raw.variantCandidates.length>24||typeof raw.variantCandidatesTruncated!=='boolean'))return null;
 const t=raw.linkTemplate,hasStructure=t&&Object.hasOwn(t,'valueStructure');if(!object(t,hasStructure?['status','reasonCode','path','queryKeys','placeholderIndices','valueStructure']:['status','reasonCode','path','queryKeys','placeholderIndices'])||!['observed','unavailable'].includes(t.status)||!templateReasons.has(t.reasonCode)||!Array.isArray(t.queryKeys)||!Array.isArray(t.placeholderIndices))return null;
 const hasAction=hasStructure&&Object.hasOwn(t.valueStructure,'actionIsBrowse');if(hasStructure&&(!object(t.valueStructure,hasAction?['tShape','hasLiteralPublicationPrefix','hasLiteralNameSeparator','actionIsBrowse']:['tShape','hasLiteralPublicationPrefix','hasLiteralNameSeparator'])||!tShapes.has(t.valueStructure.tShape)||typeof t.valueStructure.hasLiteralPublicationPrefix!=='boolean'||typeof t.valueStructure.hasLiteralNameSeparator!=='boolean'||hasAction&&typeof t.valueStructure.actionIsBrowse!=='boolean'))return null;
 const safeLegacy=t.queryKeys.length===2&&t.queryKeys.includes('p')&&t.queryKeys.includes('t')&&!hasAction;
 const safeRowReference=t.path==='/apps/news/browse-pub'&&t.queryKeys.length===3&&t.queryKeys.includes('p')&&t.queryKeys.includes('t')&&t.queryKeys.includes('action')&&t.placeholderIndices.length===1&&t.placeholderIndices[0]===1&&hasAction&&t.valueStructure.actionIsBrowse===true&&t.valueStructure.tShape==='row-source-reference'&&!t.valueStructure.hasLiteralPublicationPrefix&&!t.valueStructure.hasLiteralNameSeparator;
 if(t.status==='unavailable'?(t.reasonCode==='safe_native_source_template'||t.path!==''||t.queryKeys.length||t.placeholderIndices.length||hasStructure):(!diagnosticPath(t.path)||!['safe_native_source_template','template_query_unapproved','template_route_unapproved'].includes(t.reasonCode)||t.queryKeys.length>10||new Set(t.queryKeys).size!==t.queryKeys.length||t.queryKeys.some(key=>!diagnosticQueryKey(key))||!t.queryKeys.includes('p')||!t.placeholderIndices.length||t.placeholderIndices.length>7||t.placeholderIndices.some((value,index)=>!integer(value,6)||index&&value<=t.placeholderIndices[index-1])||hasAction&&!t.queryKeys.includes('action')||t.reasonCode==='safe_native_source_template'&&(!paths.has(t.path)||!safeLegacy&&!safeRowReference)||t.reasonCode!=='safe_native_source_template'&&!hasStructure))return null;
 if(raw.state==='unavailable')return raw.reasonCode==='source_columns_changed'&&!raw.rowsInspected&&!raw.descriptorsTruncated&&!raw.sources.length&&t.status==='unavailable'&&t.reasonCode==='template_missing'&&!hasVariants?emptyCatalogueSources():null;
 if(raw.reasonCode!=='source_columns_matched'||!catalogueSourceColumns(columns)||raw.rowsInspected!==rowCount)return null;
 const seen=new Set(),sources=[];for(const source of raw.sources){
  if(!object(source,['rowIndex','name','dates','location','type','format','language','context','browse'])||!integer(source.rowIndex,rowCount-1)||seen.has(source.rowIndex)||source.context!=='unverified-catalogue-source'||!source.name||catalogueSourceName(source.name)!==source.name||catalogueMetadataText(source.dates,160)!==source.dates||['location','type','format','language'].some(key=>catalogueMetadataText(source[key],100)!==source[key]))return null;
  const b=source.browse,hasReference=b&&Object.hasOwn(b,'referenceStructure'),reference=hasReference?sanitizeCatalogueReferenceStructure(b.referenceStructure):null;if(!object(b,hasReference?['status','reasonCode','url','referenceStructure']:['status','reasonCode','url'])||!['available','unavailable'].includes(b.status)||!browseReasons.has(b.reasonCode)||(b.status==='available'?(!b.url||b.reasonCode!=='native_source_url'||t.status!=='observed'||t.reasonCode!=='safe_native_source_template'||catalogueSourceBrowseURL(b.url,source.name)!==b.url):(b.reasonCode==='native_source_url'||b.url!==''))||hasReference&&(!reference||!safeRowReference||b.status==='available'&&JSON.stringify(reference)!==JSON.stringify(publicationReference(new URL(b.url).searchParams.get('t'),source.name).referenceStructure)||b.status==='unavailable'&&reference.failureCode==='none'))return null;
  seen.add(source.rowIndex);sources.push({rowIndex:source.rowIndex,name:source.name,dates:source.dates,location:source.location,type:source.type,format:source.format,language:source.language,context:'unverified-catalogue-source',browse:{status:b.status,reasonCode:b.reasonCode,url:b.url,...(reference?{referenceStructure:reference}:{})}});
 }
 const variantCandidates=[];if(hasVariants)for(const candidate of raw.variantCandidates){if(!object(candidate,['rowIndex','name','dates','location','format','context'])||!integer(candidate.rowIndex,rowCount-1)||seen.has(candidate.rowIndex)||candidate.context!=='unverified-catalogue-variant'||!candidate.name||catalogueVariantName(candidate.name)!==candidate.name||catalogueMetadataText(candidate.dates,160)!==candidate.dates||catalogueMetadataText(candidate.location,100)!==candidate.location||catalogueMetadataText(candidate.format,100)!==candidate.format)return null;seen.add(candidate.rowIndex);variantCandidates.push({rowIndex:candidate.rowIndex,name:candidate.name,dates:candidate.dates,location:candidate.location,format:candidate.format,context:'unverified-catalogue-variant'});}
 return {schema:SCHEMA,state:'observed',reasonCode:'source_columns_matched',rowsInspected:raw.rowsInspected,descriptorsTruncated:raw.descriptorsTruncated,linkTemplate:{status:t.status,reasonCode:t.reasonCode,path:t.path,queryKeys:[...t.queryKeys],placeholderIndices:[...t.placeholderIndices],...(hasStructure?{valueStructure:{tShape:t.valueStructure.tShape,hasLiteralPublicationPrefix:t.valueStructure.hasLiteralPublicationPrefix,hasLiteralNameSeparator:t.valueStructure.hasLiteralNameSeparator,...(hasAction?{actionIsBrowse:t.valueStructure.actionIsBrowse}:{})}}:{})},sources,...(hasVariants?{variantCandidates,variantCandidatesTruncated:raw.variantCandidatesTruncated}:{})};
}
