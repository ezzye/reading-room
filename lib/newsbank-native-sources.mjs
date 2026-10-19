import {PUBLICATION_SEARCH_KEYS,sanitizePublicationSearchStatus} from './newsbank-publications.mjs';
import {searchOptionMetadata} from './newsbank-match-diagnostic.mjs';
import {inspectSourceListStructure,sanitizeSourceListStructure} from './newsbank-source-list-structure.mjs';
import {cataloguePropsEvidence,sanitizeCatalogueProps} from './newsbank-catalogue-props.mjs';
export const NATIVE_SOURCE_QUERY='Jason Arday';
const SCHEMA='newsbank-native-sources/v1',STAGES=new Set(['entry','source-list','results']);
const privateName=/token|auth|password|passcode|pin|session|credential|secret|cookie|card|borrower|account|email|user|login|logout|destination|redirect|return|docref|document|url|csrf|nonce|state|build|key|signature|policy|access|bearer|code|ticket|utm_|fbclid|gclid/i;
const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(value)?value.replace(/\s+/g,' ').trim():'';
const publicValue=value=>typeof value==='string'&&value.length<=512&&!/[<>\u0000-\u001f\u007f]|https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[A-Za-z0-9_-]{32,}|\d{12,}|\b(?:password|passcode|bearer|credential|secret|cookie|session|borrower)\b/i.test(value);
export function nativeSourceURL(raw,base){
 let url;try{url=new URL(raw,base);}catch{return '';}
 if(url.origin!=='https://infoweb.newsbank.com'||url.username||url.password||url.hash&&!/^#(?:sources?|browse)[a-z0-9_-]{0,40}$/i.test(url.hash)||!/^\/apps\/news\/(?:[a-z0-9-]+\/?)?$/i.test(url.pathname)||/document|user|login|logout|account|librarycard|library-card|session|checkout|subscribe|my-folder|terms-of-use|privacy/i.test(url.pathname)||url.href.length>2048||[...url.searchParams].length>10)return '';
 for(const [name,value] of url.searchParams)if(!/^[a-z][a-z0-9_.:\[\]-]{0,63}$/i.test(name)||privateName.test(name)||!publicValue(value))return '';
 if(url.searchParams.has('p')&&(url.searchParams.getAll('p').length!==1||url.searchParams.get('p')!=='UKNB')||[...url.searchParams.keys()].some(key=>key.toLowerCase()==='p'&&key!=='p'))return '';
 return url.href;
}
const visible=element=>{for(let node=element;node?.getAttribute;node=node.parentElement)if(node.matches('script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(node.getAttribute('style')||''))return false;return true;};
function labelText(element,max=160){if(!element||!visible(element))return '';const copy=element.cloneNode(true);for(const node of copy.querySelectorAll('script,style,noscript,template,input,textarea,button,p,[hidden],[inert],[aria-hidden="true"]'))node.remove();return plain((copy.textContent||'').replace(/\s+/g,' ').trim(),max);}
const papers=[...new Set(Object.values(PUBLICATION_SEARCH_KEYS).flatMap(value=>value.split(' / ')).flatMap(value=>{const name=value.split(' (')[0];return name.startsWith('The ')?[name,name.slice(4),name.slice(4)+', The']:[name];}))];
const sourceLabel=value=>Boolean(value)&&(/^(?:[a-z][-–]\s*z\s+)?(?:all\s+)?(?:source(?:s| list| names?| types?)?|publication(?:s| list)?|browse(?:\b.*)?|all databases|change databases|more search options|advanced search|new search)$/i.test(value)||papers.some(name=>value===name||value.startsWith(name)&&/^[ ,(:;]/.test(value.slice(name.length))));
const targetPaper=value=>/Financial Times|Morning Star|(?:Daily|Sunday) Express|Scotsman|Scotland on Sunday|Herald|National|Press (?:and|&) Journal|Courier|Irish News|Belfast Telegraph|News Letter|Newsletter|Observer|Telegraph|Times/i.test(value);
export function observedNativeSourceListURL(document,base){
 const found=[];for(const anchor of document.querySelectorAll('a[href]')){if(!visible(anchor)||!/^A[-–]Z Source List$/i.test(labelText(anchor)))continue;const url=nativeSourceURL(anchor.getAttribute('href'),base);if(url&&exactNativeSourceListURL(url))found.push(url);}return [...new Set(found)].length===1?found[0]:'';
}
export function exactNativeSourceListURL(raw){try{const url=new URL(raw);return url.origin==='https://infoweb.newsbank.com'&&!url.username&&!url.password&&!url.hash&&url.pathname==='/apps/news/source-list'&&[...url.searchParams].length===1&&url.searchParams.get('p')==='UKNB';}catch{return false;}}
const safeName=value=>typeof value==='string'&&/^[a-z_][a-z0-9_.:\[\]-]{0,63}$/i.test(value)&&!privateName.test(value)?value:'';
const controlTypes=new Set(['hidden','text','search','radio','checkbox','select-one','select-multiple','textarea','submit']);
function option(raw){
 const ordinary=searchOptionMetadata(raw.value,raw.label);if(ordinary)return ordinary;
 const label=plain(raw.label,160),value=plain(raw.value,80);
 return sourceLabel(label)&&value&&publicValue(value)&&!privateName.test(value)?{label,value}:null;
}
function control(raw){
 if(!raw||!['input','select','textarea','button'].includes(raw.tag))return null;
 const name=safeName(raw.name),id=safeName(raw.id);if(!name&&!id)return null;
 const options=(Array.isArray(raw.options)?raw.options:[]).slice(0,12).map(option).filter(Boolean);
 return {name,id,tag:raw.tag,type:controlTypes.has(raw.type)?raw.type:'other',visibility:raw.visibility==='hidden'?'hidden':'visible',disabled:raw.disabled===true,options};
}
function link(raw){
 if(!raw||!['navigation','source-field','source-list'].includes(raw.context))return null;
 const label=plain(raw.label,160),url=nativeSourceURL(raw.url);if(!label||!url||!sourceLabel(label)&&raw.context==='navigation')return null;
 if(!/^[\p{L}\p{N} .,'’&():;\/-]{1,160}$/u.test(label)||/\b(?:private|secret|password|token|cookie|session|borrower|account|card|pin)\b/i.test(label))return null;
 const parsed=new URL(url),filters=parsed.searchParams.getAll('t');
 if(filters.some(value=>value&&!value.startsWith('pubname:'))||/\b(?:My Saved|Terms of Use)\b/i.test(label))return null;
 if(parsed.pathname==='/apps/news/results'&&!filters.some(value=>value.startsWith('pubname:')))return null;
 return {label,url,path:parsed.pathname,queryKeys:[...new Set(parsed.searchParams.keys())].slice(0,10),context:raw.context};
}
function sourceRow(raw){
 const candidate=link({...raw,context:'source-list'});if(!candidate||!new URL(candidate.url).searchParams.getAll('t').some(value=>value.startsWith('pubname:')))return null;
 const fields=[];for(const field of (Array.isArray(raw.fields)?raw.fields:[]).slice(0,6)){const name=plain(field?.name,80),value=plain(field?.value,160);if(value&&publicValue(value)&&!privateName.test(name))fields.push({name,value});}
 return {label:candidate.label,url:candidate.url,fields};
}
function page(raw){
 if(!raw||!STAGES.has(raw.stage)||typeof raw.path!=='string'||!nativeSourceURL('https://infoweb.newsbank.com'+raw.path)||!Array.isArray(raw.links)||!Array.isArray(raw.forms))return null;
 const links=raw.links.slice(0,24).map(link).filter(Boolean),forms=[];
 for(const value of raw.forms.slice(0,3)){
  const actionURL=nativeSourceURL(value?.actionURL);if(!actionURL||!['GET','POST'].includes(value.method)||!Array.isArray(value.controls))continue;
  forms.push({method:value.method,actionURL,actionPath:new URL(actionURL).pathname,controls:value.controls.slice(0,20).map(control).filter(Boolean)});
 }
 const sourceRows=raw.stage==='source-list'?(Array.isArray(raw.sourceRows)?raw.sourceRows:[]).slice(0,24).map(sourceRow).filter(Boolean):[];
 const structure=raw.stage==='source-list'&&raw.path==='/apps/news/source-list'&&raw.structure!==undefined?sanitizeSourceListStructure(raw.structure,nativeSourceURL):null;if(raw.structure!==undefined&&!structure)return null;
 if(structure)for(const container of structure.containers)if(container.classes.includes('nbcore-react-browse-container'))container.id='';
 const catalogue=raw.stage==='source-list'&&raw.path==='/apps/news/source-list'&&raw.catalogue!==undefined?sanitizeCatalogueProps(raw.catalogue):null;if(raw.catalogue!==undefined&&!catalogue)return null;
 return {stage:raw.stage,path:raw.path,links,forms,...(raw.stage==='source-list'?{sourceRows,...(structure?{structure}:{}),...(catalogue?{catalogue}:{})}:{})};
}
export function sanitizeNativeSources(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 if(raw.status!=='native-sources'){if(raw.stage==='source-list'&&['login_required','needs_interaction'].includes(raw.status)&&['session_expired','entry_needs_interaction','route_changed'].includes(raw.reasonCode))return {status:raw.status,stage:'source-list',reasonCode:raw.reasonCode};return sanitizePublicationSearchStatus(raw);}
 if(raw.schema!==SCHEMA||raw.fixedQuery!==NATIVE_SOURCE_QUERY||raw.articleOpened!==false||raw.followedSourceLinks!==false||!Array.isArray(raw.pages)||raw.pages.length<1||raw.pages.length>3||['session','cookies','account','cardNumber','libraryName','body','html','paragraphs','content'].some(key=>Object.hasOwn(raw,key)))return null;
 const pages=raw.pages.map(page);if(pages.some(value=>!value)||new Set(pages.map(value=>value.stage)).size!==pages.length)return null;
 if(raw.sourceListOpened===true&&!pages.some(value=>value.stage==='source-list'))return null;
 const clean={status:'native-sources',schema:SCHEMA,fixedQuery:NATIVE_SOURCE_QUERY,pages,sourceListOpened:raw.sourceListOpened===true,articleOpened:false,followedSourceLinks:false,metadataTruncated:raw.metadataTruncated===true||pages.some(page=>page.catalogue?.candidatesTruncated||page.catalogue?.sourceDescriptors?.descriptorsTruncated||page.catalogue?.sourceDescriptors?.variantCandidatesTruncated)};
 while(new TextEncoder().encode(JSON.stringify(clean)).byteLength>28000){
  let reduced=false;for(const value of [...pages].reverse()){if(value.links.length>4){value.links.pop();reduced=true;break;}const form=value.forms.find(form=>form.controls.length>8);if(form){form.controls.pop();reduced=true;break;}const control=value.forms.flatMap(form=>form.controls).find(control=>control.options.length>4);if(control){control.options.pop();reduced=true;break;}const row=value.sourceRows?.find(row=>row.fields.length>2);if(row){row.fields.pop();reduced=true;break;}if(value.sourceRows?.length>4){value.sourceRows.pop();reduced=true;break;}if(value.forms.length>1){value.forms.pop();reduced=true;break;}}
  if(!reduced)for(const value of pages){if(!value.structure)continue;for(const key of ['endpoints','staticAssetPaths','scriptURLs','containers','controls'])if(value.structure[key]?.length>2){value.structure[key].pop();value.structure.truncated=true;reduced=true;break;}if(reduced)break;}
  if(!reduced)for(const value of pages){const descriptors=value.catalogue?.sourceDescriptors;if(descriptors?.variantCandidates?.length){descriptors.variantCandidates.pop();descriptors.variantCandidatesTruncated=true;reduced=true;break;}if(descriptors?.sources.length>1){descriptors.sources.pop();descriptors.descriptorsTruncated=true;reduced=true;break;}}
  if(!reduced)return null;clean.metadataTruncated=true;
 }
 return clean;
}
export function inspectNativeSourcePage(document,base,stage){
 const links=[],sourceRows=[];
 for(const anchor of document.querySelectorAll('a[href]')){
  if(!visible(anchor)||anchor.closest('.document-view__body--ascii,article'))continue;
  const label=labelText(anchor),url=nativeSourceURL(anchor.getAttribute('href'),base);if(!label||!url)continue;
  if(anchor.closest('form,p')&&!(stage==='source-list'&&new URL(url).searchParams.getAll('t').some(value=>value.startsWith('pubname:'))))continue;
  const context=anchor.closest('[data-publication],.search-hits__source,.search-hits__publication,ul li')?'source-field':anchor.closest('[class*="source-list"],[id*="source-list"]')?'source-list':'navigation';
  const candidate=link({label,url,context});if(candidate&&!links.some(value=>value.url===candidate.url&&value.label===candidate.label))links.push(candidate);
  if(stage==='source-list'&&candidate){const row=anchor.closest('tr');if(row){const headers=[...(row.closest('table')?.querySelectorAll('thead th')||[])].map(node=>labelText(node,80)),fields=[...row.querySelectorAll('td')].slice(0,6).map((node,index)=>({name:headers[index]||'',value:labelText(node,160)}));const metadata=sourceRow({label,url,fields});if(metadata&&!sourceRows.some(value=>value.url===metadata.url))sourceRows.push(metadata);}}
 }
 const forms=[];
 for(const form of stage==='source-list'?[]:document.querySelectorAll('form')){
  if(forms.length>=3)break;const actionURL=nativeSourceURL(form.getAttribute('action')||'',base);if(!actionURL)continue;
  const controls=[];
  for(const element of form.querySelectorAll('input,select,textarea,button')){
   if(controls.length>=20)break;const tag=element.tagName.toLowerCase(),type=tag==='select'?(element.hasAttribute('multiple')?'select-multiple':'select-one'):tag==='textarea'?'textarea':(element.getAttribute('type')||'text').toLowerCase();
   const item=control({name:element.getAttribute('name'),id:element.id,tag,type,visibility:type==='hidden'||!visible(element)?'hidden':'visible',disabled:element.hasAttribute('disabled'),options:tag==='select'?[...element.querySelectorAll('option')].filter(visible).slice(0,12).map(element=>({label:labelText(element),value:element.getAttribute('value')||''})):[]});if(item)controls.push(item);
  }
  forms.push({method:(form.getAttribute('method')||'GET').toUpperCase(),actionURL,controls});
 }
 const priority=value=>new URL(value.url).pathname==='/apps/news/source-list'?0:targetPaper(value.label)?1:2;
 links.sort((a,b)=>priority(a)-priority(b));sourceRows.sort((a,b)=>Number(targetPaper(b.label))-Number(targetPaper(a.label)));
 const structure=stage==='source-list'?inspectSourceListStructure(document,base,nativeSourceURL):null;
 const catalogue=stage==='source-list'?cataloguePropsEvidence(document,base):null;
 return page({stage,path:new URL(base).pathname,links:links.slice(0,24),forms,sourceRows:sourceRows.slice(0,24),...(structure?{structure}:{}),...(catalogue?{catalogue}:{})});
}
