import {catalogueMetadataText,catalogueSourceName,catalogueSourceBrowseURL} from './newsbank-catalogue-sources.mjs';
import {cataloguePropsEvidence} from './newsbank-catalogue-props.mjs';
import {nativeSourceURL} from './newsbank-native-sources.mjs';
import {searchOptionMetadata} from './newsbank-match-diagnostic.mjs';

export const SCOTSMAN_CATALOGUE_NAME='Scotsman, The/Scotland on Sunday (Scotland)';
// This catalogue policy is separate from full-text publication proof. Add a
// family only after its exact native Text source name has been observed.
export const SOURCE_SEARCH_POLICIES=Object.freeze({
 scotsman:Object.freeze({publisher:'scotsman',catalogueName:SCOTSMAN_CATALOGUE_NAME,format:'Text',selectedSearchEnabled:true}),
 'press-and-journal':Object.freeze({publisher:'press-and-journal',catalogueName:'Press & Journal, The (Aberdeen, Scotland)',format:'Text',selectedSearchEnabled:true}),
 record:Object.freeze({publisher:'record',catalogueName:'Daily Record, The / Sunday Mail: Web Edition Articles (Scotland)',format:'Text',selectedSearchEnabled:true}),
 'news-letter':Object.freeze({publisher:'news-letter',catalogueName:'News Letter (Belfast, Northern Ireland)',format:'Text',selectedSearchEnabled:true}),
 sundaypost:Object.freeze({publisher:'sundaypost',catalogueName:'Sunday Post, The (Dundee, Scotland)',format:'Text',selectedSearchEnabled:true})
});
export const sourceSearchPolicy=key=>typeof key==='string'&&Object.hasOwn(SOURCE_SEARCH_POLICIES,key)?SOURCE_SEARCH_POLICIES[key]:null;
export const SOURCE_LIST_URL='https://infoweb.newsbank.com/apps/news/source-list?p=UKNB';
const SCHEMA='newsbank-source-search/v1',ORIGIN='https://infoweb.newsbank.com';
const reasons=new Set(['session_expired','source_list_needs_interaction','catalogue_unavailable','source_not_unique','source_link_unavailable','browse_needs_interaction','route_changed']);
const nameSafe=value=>typeof value==='string'&&/^[a-z_][a-z0-9_.:\[\]-]{0,63}$/i.test(value)&&!/[a-f0-9]{12,}|[a-z0-9_-]{32,}|token|auth|password|passcode|pin|session|credential|secret|cookie|card|borrower|account|email|user|login|logout|destination|redirect|return|docref|document|url|csrf|nonce|state|build|key|signature|policy|access|bearer|code|ticket/i.test(value);
const object=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
const flags=(sourceListOpened=false,sourceBrowseOpened=false)=>({sourceListOpened,sourceBrowseOpened,articleOpened:false,searchSubmitted:false,followedNext:false});
export function sourceSearchInspectionStatus(status,stage,reasonCode,opened={}){return {status,schema:SCHEMA,stage,reasonCode,...flags(opened.sourceListOpened===true,opened.sourceBrowseOpened===true)};}
export function sourceSearchBrowseIdentity(raw,publisher='scotsman'){
 const policy=sourceSearchPolicy(publisher);if(!policy)return '';
 const safe=catalogueSourceBrowseURL(raw,policy.catalogueName);if(!safe)return '';
 const url=new URL(safe);if(url.pathname!=='/apps/news/browse-pub'||url.searchParams.get('action')!=='browse'||[...url.searchParams].length!==3)return '';
 const canonical=new URL(ORIGIN+'/apps/news/browse-pub');for(const key of ['p','t','action'])canonical.searchParams.set(key,url.searchParams.get(key));return canonical.href;
}
export function selectSourceSearchCatalogue(document,publisher='scotsman'){
 const policy=sourceSearchPolicy(publisher);if(!policy)return {reasonCode:'catalogue_unavailable'};
 const matches=[];const catalogue=cataloguePropsEvidence(document,SOURCE_LIST_URL,source=>{if(source.name===policy.catalogueName&&source.format===policy.format&&matches.length<2)matches.push(structuredClone(source));});
 if(catalogue?.state!=='observed'||catalogue.sourceDescriptors?.state!=='observed')return {reasonCode:'catalogue_unavailable'};
 if(matches.length!==1)return {reasonCode:'source_not_unique'};
 const source=matches[0];if(source.browse.status!=='available'||!sourceSearchBrowseIdentity(source.browse.url,publisher))return {reasonCode:'source_link_unavailable'};
 return {source:{name:source.name,dates:source.dates,location:source.location,format:'Text',browseURL:source.browse.url}};
}
function visible(node){for(let p=node;p?.getAttribute;p=p.parentElement)if(p.matches('article,#document-view--ascii,.document-view__body--ascii,script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(p.getAttribute('style')||''))return false;return true;}
function formAction(raw,expectedT){
 let url;try{url=new URL(raw);}catch{return null;}
 // Only the exact freshly selected public bibliography filter may bypass
 // generic opacity heuristics. Every other value and destination still goes
 // through the existing native-URL guard; unknown values are never exported.
 const probe=new URL(url.href);for(const [name,value]of url.searchParams)if(['t','t[]'].includes(name)&&value===expectedT)probe.searchParams.set(name,'pubname:PUBLICSOURCE');
 if(!nativeSourceURL(probe.href))return null;const safe=url.href;if(!['/apps/news/','/apps/news/easy-search','/apps/news/search','/apps/news/results','/apps/news/browse-pub'].includes(url.pathname))return null;
 const queryKeys=[...url.searchParams.keys()];if(queryKeys.length>10||new Set(queryKeys).size!==queryKeys.length||queryKeys.some(key=>!nameSafe(key)))return null;
 const known=[...url.searchParams].every(([name,value])=>name==='p'&&value==='UKNB'||['t','t[]'].includes(name)&&value===expectedT||name==='action'&&value==='browse');return {actionPath:url.pathname,actionURL:known?safe:'',queryKeys};
}
function formControls(form){
 const out=[];for(const node of form.querySelectorAll('input,select,textarea,button')){if(out.length>=20)break;const tag=node.tagName.toLowerCase(),rawName=node.getAttribute('name')||'',rawID=node.id||'',name=nameSafe(rawName)?rawName:'',id=nameSafe(rawID)?rawID:'';if(!name&&!id)continue;
  const rawType=tag==='select'?(node.hasAttribute('multiple')?'select-multiple':'select-one'):tag==='textarea'?'textarea':(node.getAttribute('type')||'text').toLowerCase(),type=['hidden','text','search','radio','checkbox','select-one','select-multiple','textarea','submit'].includes(rawType)?rawType:'other',options=[];
  if(tag==='select')for(const option of [...node.querySelectorAll('option')].slice(0,12)){if(!visible(option)||option.querySelector('script,style,form'))continue;const item=searchOptionMetadata(option.getAttribute('value')||'',(option.textContent||'').replace(/\s+/g,' ').trim());if(item)options.push(item);}
  out.push({name,id,tag,type,visibility:type==='hidden'||!visible(node)?'hidden':'visible',disabled:node.hasAttribute('disabled'),options});
 }return out;
}
function sourceBinding(name,value,t){return name==='p'&&value==='UKNB'||['t','t[]'].includes(name)&&value===t||name==='action'&&value==='browse'?{name,value,context:'native-source-binding'}:null;}
function control(raw){
 if(!object(raw,['name','id','tag','type','visibility','disabled','options'])||!['input','select','textarea','button'].includes(raw.tag)||!['hidden','text','search','radio','checkbox','select-one','select-multiple','textarea','submit','other'].includes(raw.type)||!['visible','hidden'].includes(raw.visibility)||typeof raw.disabled!=='boolean'||!Array.isArray(raw.options)||raw.options.length>12||raw.name!==''&&!nameSafe(raw.name)||raw.id!==''&&!nameSafe(raw.id)||!raw.name&&!raw.id)return null;
 const options=[];for(const option of raw.options){const clean=searchOptionMetadata(option?.value,option?.label);if(!clean||!object(option,['label','value']))return null;options.push(clean);}return {name:raw.name,id:raw.id,tag:raw.tag,type:raw.type,visibility:raw.visibility,disabled:raw.disabled,options};
}
export function sourceSearchInspection(document,source){
 const t=new URL(source.browseURL).searchParams.get('t'),forms=[];let matchingSourceBindings=0,conflictingSourceBindings=0;const headings=[];
 for(const node of document.querySelectorAll('h1,h2')){if(!visible(node))continue;const copy=node.cloneNode(true);for(const child of copy.querySelectorAll('script,style,form,[hidden],[inert],[aria-hidden="true"]'))child.remove();const name=catalogueSourceName((copy.textContent||'').replace(/\s+/g,' ').trim());if(name)headings.push(name);}
 for(const form of document.querySelectorAll('form')){
  if(forms.length>=3)break;if(!visible(form))continue;let action;try{action=formAction(new URL(form.getAttribute('action')||'',source.browseURL).href,t);}catch{continue;}const method=(form.getAttribute('method')||'GET').toUpperCase();if(!action||!['GET','POST'].includes(method))continue;
  const controls=formControls(form),sourceBindings=[];
  for(const element of [...form.querySelectorAll('input,select,textarea')].slice(0,200)){const name=element.getAttribute('name'),type=element.getAttribute('type')||'';if(element.hasAttribute('disabled')||!['p','t','t[]','action'].includes(name)||/^(?:submit|button|reset|image|file)$/i.test(type)||/^(?:checkbox|radio)$/i.test(type)&&!element.checked)continue;const value=element.value??element.textContent??'';if(['t','t[]'].includes(name)){if(value===t)matchingSourceBindings=Math.min(60,matchingSourceBindings+1);else conflictingSourceBindings=Math.min(60,conflictingSourceBindings+1);}else if(name==='p'&&value!=='UKNB')conflictingSourceBindings=Math.min(60,conflictingSourceBindings+1);const binding=sourceBinding(name,value,t);if(binding&&sourceBindings.length<20)sourceBindings.push(binding);}
  forms.push({method,...action,controls,sourceBindings});
 }
 const result={status:'source-search-inspection',schema:SCHEMA,source,page:{path:'/apps/news/browse-pub',sourceHeading:headings.some(name=>name!==source.name)?'conflicting':headings.includes(source.name)?'observed':'missing',matchingSourceBindings,conflictingSourceBindings,forms},...flags(true,true)};
 return sanitizeSourceSearchInspection(result);
}
export function sanitizeSourceSearchInspection(raw){
 if(!raw||raw.schema!==SCHEMA||raw.articleOpened!==false||raw.searchSubmitted!==false||raw.followedNext!==false||typeof raw.sourceListOpened!=='boolean'||typeof raw.sourceBrowseOpened!=='boolean'||raw.sourceBrowseOpened&&!raw.sourceListOpened)return null;
 const flagKeys=['sourceListOpened','sourceBrowseOpened','articleOpened','searchSubmitted','followedNext'];
 if(['login_required','needs_interaction'].includes(raw.status)){
  const stageReasons={session:['session_expired'],'source-list':['session_expired','source_list_needs_interaction','catalogue_unavailable','source_not_unique','source_link_unavailable','route_changed'],'source-browse':['session_expired','browse_needs_interaction','route_changed']};
  return object(raw,['status','schema','stage','reasonCode',...flagKeys])&&stageReasons[raw.stage]?.includes(raw.reasonCode)&&reasons.has(raw.reasonCode)&&(raw.status==='login_required')===(raw.reasonCode==='session_expired')&&(raw.stage!=='session'||!raw.sourceListOpened&&!raw.sourceBrowseOpened)&&(raw.stage!=='source-list'||!raw.sourceBrowseOpened)&&(raw.stage!=='source-browse'||raw.sourceListOpened)?sourceSearchInspectionStatus(raw.status,raw.stage,raw.reasonCode,raw):null;
 }
 if(raw.status!=='source-search-inspection'||!object(raw,['status','schema','source','page',...flagKeys])||!raw.sourceListOpened||!raw.sourceBrowseOpened)return null;
 const source=raw.source;if(!object(source,['name','dates','location','format','browseURL'])||source.name!==SCOTSMAN_CATALOGUE_NAME||source.format!=='Text'||!sourceSearchBrowseIdentity(source.browseURL)||catalogueMetadataText(source.dates,160)!==source.dates||catalogueMetadataText(source.location,100)!==source.location)return null;
 const p=raw.page;if(!object(p,['path','sourceHeading','matchingSourceBindings','conflictingSourceBindings','forms'])||p.path!=='/apps/news/browse-pub'||!['observed','missing','conflicting'].includes(p.sourceHeading)||!integer(p.matchingSourceBindings,60)||!integer(p.conflictingSourceBindings,60)||!Array.isArray(p.forms)||p.forms.length>3)return null;
 const t=new URL(source.browseURL).searchParams.get('t'),forms=[];for(const form of p.forms){
  if(!object(form,['method','actionPath','actionURL','queryKeys','controls','sourceBindings'])||!['GET','POST'].includes(form.method)||!Array.isArray(form.queryKeys)||form.queryKeys.length>10||new Set(form.queryKeys).size!==form.queryKeys.length||form.queryKeys.some(key=>!nameSafe(key))||!Array.isArray(form.controls)||form.controls.length>20||!Array.isArray(form.sourceBindings)||form.sourceBindings.length>20)return null;
  const path=formAction(ORIGIN+form.actionPath,t);if(!path||path.actionPath!==form.actionPath)return null;if(form.actionURL!==''){const action=formAction(form.actionURL,t);if(!action||action.actionURL!==form.actionURL||action.actionPath!==form.actionPath||JSON.stringify(action.queryKeys)!==JSON.stringify(form.queryKeys))return null;}
  const controls=form.controls.map(control);if(controls.some(value=>!value))return null;const sourceBindings=[];for(const binding of form.sourceBindings){if(!object(binding,['name','value','context'])||binding.context!=='native-source-binding'||!sourceBinding(binding.name,binding.value,t))return null;sourceBindings.push({name:binding.name,value:binding.value,context:'native-source-binding'});}forms.push({method:form.method,actionPath:form.actionPath,actionURL:form.actionURL,queryKeys:[...form.queryKeys],controls,sourceBindings});
 }
 const clean={status:'source-search-inspection',schema:SCHEMA,source:{name:source.name,dates:source.dates,location:source.location,format:'Text',browseURL:source.browseURL},page:{path:p.path,sourceHeading:p.sourceHeading,matchingSourceBindings:p.matchingSourceBindings,conflictingSourceBindings:p.conflictingSourceBindings,forms},...flags(true,true)};return new TextEncoder().encode(JSON.stringify(clean)).byteLength<=12000?clean:null;
}
