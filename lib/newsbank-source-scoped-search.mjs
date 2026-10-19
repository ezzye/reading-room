import {SOURCE_SEARCH_POLICIES,sourceSearchPolicy,sourceSearchBrowseIdentity} from './newsbank-source-search.mjs';
import {catalogueSourceName} from './newsbank-catalogue-sources.mjs';

// This is a metadata-only native-form policy, not a publication/full-text alias.
export const sourceScopedPublication=key=>Boolean(sourceSearchPolicy(key));
export const sourceScopedLibraryPublication=key=>sourceSearchPolicy(key)?.selectedSearchEnabled===true;
export function sourceScopedSearchTerms(title){
 if(typeof title!=='string'||title.length>400||/[<>\u0000-\u001f\u007f]/.test(title))throw Error('invalid_scoped_query');
 const words=title.match(/\p{L}[\p{L}\p{N}’'-]*/gu)||[];if(words.length<2||words.length>60)throw Error('invalid_scoped_query');
 return words.map(word=>'"'+word+'"').join(' AND ');
}
const ORIGIN='https://infoweb.newsbank.com';
const FORM_FIELDS=new Set(['p','t','t[]','fld-base-0','hide_duplicates','sort','maxresults','val-base-0','form_id','form_build_id','form_token']);
const RESERVED_NATIVE_FIELD=/docref|document|destination|redirect|return|url|source|publication|publisher|product|collection|^action$|^(?:p|t)(?:$|[\d_.:\[\]-])/i;
const inputType=node=>(node.getAttribute('type')||'text').toLowerCase();
function visible(node){for(let p=node;p?.getAttribute;p=p.parentElement)if(p.matches('article,#document-view--ascii,.document-view__body--ascii,script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]')||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(p.getAttribute('style')||''))return false;return true;}
const sourcePolicy=source=>Object.values(SOURCE_SEARCH_POLICIES).find(policy=>source?.name===policy.catalogueName&&source.format===policy.format);
const sourceIdentity=(url,source)=>sourceSearchBrowseIdentity(url,sourcePolicy(source)?.publisher||'');
function selectedSource(source){return sourcePolicy(source)&&sourceIdentity(source.browseURL,source);}
function successful(node){return !node.hasAttribute('disabled')&&!node.disabled&&!/^(?:submit|button|reset|image|file)$/i.test(inputType(node))&&(!/^(?:checkbox|radio)$/i.test(inputType(node))||node.checked||node.hasAttribute('checked'));}
function diagnosticFieldName(name){return /^[a-z_][a-z0-9_.:\[\]-]{0,63}$/i.test(name)&&!/[0-9]{8,}|[a-f0-9]{12,}|[a-z0-9_-]{32,}/i.test(name)?name:'redacted';}
const PUBLIC_DEFAULTS=new Set(['fld-base-0','hide_duplicates','sort','maxresults']);
const PUBLIC_CONTEXT_KEYS=new Set(['p','t','action',...PUBLIC_DEFAULTS]);
function flatJSONFields(text){
 const string=/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-f]{4}))*"/iy,entries=[];let i=0;const ws=()=>{while(/[ \t\r\n]/.test(text[i]||'')&&i<text.length)i++;},read=()=>{ws();string.lastIndex=i;const match=string.exec(text);if(!match)throw Error('invalid');i=string.lastIndex;return match[0];};
 ws();if(text[i++]!=='{')throw Error('invalid');ws();if(text[i]==='}'){i++;ws();if(i!==text.length)throw Error('invalid');return entries;}
 for(;;){const key=JSON.parse(read());ws();if(text[i++]!==':')throw Error('invalid');const rawValue=read();entries.push([key,PUBLIC_CONTEXT_KEYS.has(key)?JSON.parse(rawValue):undefined]);if(entries.length>40)throw Error('invalid');ws();const next=text[i++];if(next==='}')break;if(next!==',')throw Error('invalid');}
 ws();if(i!==text.length)throw Error('invalid');return entries;
}
export function sourceScopedURLParams(value,source,fields){
 const evidence={shape:'other',keys:[],redactedKeyCount:0,duplicateKeys:false,pMatches:false,tMatches:false,actionPresent:false,actionMatches:false,defaultsMatch:false};
 const result=valid=>({valid,evidence});if(typeof value!=='string'||value.length>8192||/[\u0000-\u001f\u007f]/.test(value)||!selectedSource(source))return result(false);
 const text=value.trim();let entries=[];
 try{
  if(text.startsWith('{')){evidence.shape='json';entries=flatJSONFields(text);}
  else{
   let query=text;if(/^https?:\/\//i.test(text)||text.startsWith('/')){evidence.shape='native-url';const url=new URL(text,source.browseURL);if(url.origin!==ORIGIN||url.username||url.password||text.includes('#')||url.pathname!=='/apps/news/browse-pub')return result(false);query=url.search.slice(1);}else if(text.includes('=')){evidence.shape='querystring';query=text.replace(/^\?/,'');}else return result(false);
   // One normal form decode only. Invalid escapes and UTF-8 never become
   // replacement characters or a second decoding attempt.
   if(/%(?![0-9a-f]{2})/i.test(query))return result(false);
   for(const pair of query.split('&')){if(!pair||!pair.includes('='))return result(false);const at=pair.indexOf('='),name=decodeURIComponent(pair.slice(0,at).replace(/\+/g,' '));entries.push([name,PUBLIC_CONTEXT_KEYS.has(name)?decodeURIComponent(pair.slice(at+1).replace(/\+/g,' ')):undefined]);if(entries.length>40)return result(false);}
  }
 }catch{return result(false);}
 const names=entries.map(([name])=>name);evidence.duplicateKeys=new Set(names).size!==names.length;
 for(const name of [...new Set(names)].slice(0,12)){const safe=diagnosticFieldName(name);if(safe==='redacted')evidence.redactedKeyCount++;else evidence.keys.push(safe);}
 const exact=(name,expected)=>entries.filter(([key])=>key===name).length===1&&entries.find(([key])=>key===name)[1]===expected;
 evidence.pMatches=exact('p','UKNB');evidence.tMatches=exact('t',new URL(source.browseURL).searchParams.get('t'));evidence.actionPresent=names.includes('action');evidence.actionMatches=exact('action','browse');
 evidence.defaultsMatch=entries.filter(([name])=>!['p','t','action'].includes(name)).every(([name,current])=>PUBLIC_DEFAULTS.has(name)&&fields.filter(([key])=>key===name).length===1&&fields.find(([key])=>key===name)[1]===current);
 return result(entries.length<=7&&!evidence.duplicateKeys&&evidence.pMatches&&evidence.tMatches&&(!evidence.actionPresent||evidence.actionMatches)&&evidence.defaultsMatch);
}
function fieldsFor(form,firstFailure,source){
 const fields=[],contexts=[];let bytes=0;for(const node of form.querySelectorAll('input,select,textarea')){
  const reject=reason=>{const type=node.tagName==='SELECT'?(node.hasAttribute('multiple')?'select-multiple':'select-one'):node.tagName==='TEXTAREA'?'textarea':inputType(node);if(firstFailure)Object.assign(firstFailure,{reason,tag:['INPUT','SELECT','TEXTAREA'].includes(node.tagName)?node.tagName.toLowerCase():'other',type:['hidden','text','search','checkbox','radio','password','file','submit','button','reset','image','select-one','select-multiple','textarea'].includes(type)?type:'other',name:diagnosticFieldName(node.getAttribute('name')||'')});return null;};
  if(node.tagName==='INPUT'&&inputType(node)==='file'&&!node.disabled&&!node.hasAttribute('disabled'))return reject('file_control');
  if(!successful(node))continue;const name=node.getAttribute('name');if(!name)continue;
  const value=String(node.value??node.getAttribute('value')??'');
  // Native hidden state may round-trip unchanged only to this exact verified
  // form. It cannot add source/product or destination semantics, appear in
  // result URLs, or leave this internal form plan in a response or log.
  if(node.tagName!=='INPUT')return reject('unsupported_tag');
  if(!['hidden','text','search','checkbox','radio'].includes(inputType(node)))return reject('unsupported_type');
  if(node.hasAttribute('form')&&(!form.id||node.getAttribute('form')!==form.id))return reject('form_association');
  if(!FORM_FIELDS.has(name)){
   if(inputType(node)!=='hidden')return reject('unknown_visible_control');
   if(!/^[a-z_][a-z0-9_.:\[\]-]{0,63}$/i.test(name))return reject('unsafe_native_name');
   if(name==='r-urlparams')contexts.push({node,value});
   else{if(RESERVED_NATIVE_FIELD.test(name))return reject('reserved_native_name');if(!/^[\x20-\x7e]*$/.test(value))return reject('non_ascii_native_value');}
  }
  bytes+=new TextEncoder().encode(name+value).byteLength;
  if(value.length>8192)return reject('value_too_long');
  if(bytes>24000)return reject('total_too_large');
  if(fields.length>=40)return reject('too_many_fields');
  if(/[\u0000\r\n]/.test(value))return reject('value_control');
  fields.push([name,value]);
 }
 for(const {node,value}of contexts){const context=sourceScopedURLParams(value,source,fields);if(contexts.length!==1||!context.valid){if(firstFailure)Object.assign(firstFailure,{reason:'urlparams_context',tag:'input',type:'hidden',name:'r-urlparams',context:context.evidence});return null;}}
 return fields;
}
function fieldsBound(fields,t,{requireSource=true}={}){
 const sources=fields.filter(([name])=>['t','t[]'].includes(name)),products=fields.filter(([name])=>name==='p');
 if(fields.some(([name])=>/^(?:p|t|t\[\]|action)$/i.test(name)&&!['p','t','t[]','action'].includes(name)))return false;
 if(products.some(([,value])=>value!=='UKNB')||products.length>1||sources.some(([,value])=>value!==t)||sources.length>1||fields.some(([name,value])=>name==='action'&&value!=='browse'))return false;
 return !requireSource||products.length===1&&sources.length===1;
}
function scopedPageEvidence(document,source){
 if(!selectedSource(source))return null;const headings=[];let conflictingSourceBindings=0;
 for(const node of document.querySelectorAll('h1,h2'))if(visible(node)){const copy=node.cloneNode(true);for(const child of copy.querySelectorAll('script,style,form,[hidden],[inert],[aria-hidden="true"]'))child.remove();const name=catalogueSourceName((copy.textContent||'').replace(/\s+/g,' ').trim());if(name)headings.push(name);}
 const t=new URL(source.browseURL).searchParams.get('t');for(const form of document.querySelectorAll('form'))if(visible(form))for(const node of form.querySelectorAll('input,select,textarea'))if(successful(node)){const name=node.getAttribute('name'),value=String(node.value??node.textContent??'');if(['t','t[]'].includes(name)&&value!==t||name==='p'&&value!=='UKNB')conflictingSourceBindings=Math.min(60,conflictingSourceBindings+1);}
 return {sourceHeading:headings.some(name=>name!==source.name)?'conflicting':headings.includes(source.name)?'observed':'missing',conflictingSourceBindings};
}
export function sourceScopedSearchFormCheck(document,source){
 const forms=[...document.querySelectorAll('form')],queryFields=[...document.querySelectorAll('input[name="val-base-0"]')].filter(visible),bounded=n=>Math.min(n,1000);
 const sameSourceForms=selectedSource(source)?forms.filter(form=>{try{return visible(form)&&(form.getAttribute('method')||'GET').toUpperCase()==='POST'&&sourceIdentity(new URL(form.getAttribute('action')||'',source.browseURL).href,source)===sourceIdentity(source.browseURL,source);}catch{return false;}}):[];
 const diagnostic={schema:'newsbank-source-form-check/v1',check:'selected_source',sourceHeading:'unavailable',formCount:bounded(forms.length),visibleQueryFields:bounded(queryFields.length),eligibleQueryFields:bounded(queryFields.filter(field=>['text','search'].includes(inputType(field))&&successful(field)).length),sameSourcePOSTForms:bounded(sameSourceForms.length),candidateQueryFields:bounded(queryFields.filter(field=>sameSourceForms.includes(field.closest('form'))).length),successfulFieldCount:0,unknownFieldCount:0,productFieldCount:0,sourceFieldCount:0,defaultFieldCount:0,fldValueState:'unknown',firstFieldFailure:{reason:'none',tag:'none',type:'none',name:''}};
 const fail=check=>({plan:null,diagnostic:{...diagnostic,check}});
 if(!selectedSource(source))return fail('selected_source');
 const receipt=scopedPageEvidence(document,source);diagnostic.sourceHeading=receipt?.sourceHeading||'unavailable';if(receipt?.sourceHeading!=='observed'||receipt.conflictingSourceBindings)return fail('heading_or_conflict');
 if(queryFields.length!==1)return fail('global_query_count');const field=queryFields[0],form=field.closest('form');
 if(!form||!visible(form))return fail('query_form');
 if(field.id!=='edit-val-base-0'||!['text','search'].includes(inputType(field))||!successful(field))return fail('query_identity');
 if((form.getAttribute('method')||'GET').toUpperCase()!=='POST')return fail('form_method');
 let destination;try{destination=new URL(form.getAttribute('action')||'',source.browseURL).href;}catch{return fail('form_destination');}
 if(sourceIdentity(destination,source)!==sourceIdentity(source.browseURL,source))return fail('form_destination');
 const controls=[...form.querySelectorAll('input,select,textarea')].filter(node=>successful(node)&&node.getAttribute('name'));
 diagnostic.successfulFieldCount=bounded(controls.length);diagnostic.unknownFieldCount=bounded(controls.filter(node=>!FORM_FIELDS.has(node.getAttribute('name'))).length);diagnostic.productFieldCount=bounded(controls.filter(node=>node.getAttribute('name')==='p').length);diagnostic.sourceFieldCount=bounded(controls.filter(node=>['t','t[]'].includes(node.getAttribute('name'))).length);
 const defaultField=[...form.querySelectorAll('[name="fld-base-0"]')];diagnostic.defaultFieldCount=bounded(defaultField.length);if(!defaultField.length)diagnostic.fldValueState='missing';else if(defaultField.length===1){const length=String(defaultField[0].value??defaultField[0].getAttribute('value')??'').length;diagnostic.fldValueState=length===0?'empty':length<=160?'bounded':'oversize';}
 const fields=fieldsFor(form,diagnostic.firstFieldFailure,source),t=new URL(source.browseURL).searchParams.get('t');if(!fields)return fail('successful_fields');
 if(!fieldsBound(fields,t))return fail('source_binding');
 if(fields.filter(([name])=>name==='val-base-0').length!==1||fields.filter(([name])=>name==='fld-base-0').length!==1)return fail('field_count');
 if(defaultField.length!==1||inputType(defaultField[0])!=='hidden'||!successful(defaultField[0])||!fields.find(([name,value])=>name==='fld-base-0'&&value.length>0&&value.length<=160))return fail('default_field');
 return {plan:{destination,fields},diagnostic:{...diagnostic,check:'accepted'}};
}
export function sourceScopedSearchForm(document,source){return sourceScopedSearchFormCheck(document,source).plan;}
// A returned Location is native evidence. Only one ordinary results redirect
// may retain the exact submitted query, collection, source and known defaults.
export function sourceScopedRedirectURL(raw,source,fields){
 if(!selectedSource(source)||!Array.isArray(fields))return '';
 let url;try{url=new URL(raw,source.browseURL);}catch{return '';}
 if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.pathname!=='/apps/news/results'||url.href.length>8192)return '';
 const allowed=new Set(['p','t','t[]','action','val-base-0','fld-base-0','hide_duplicates','sort','maxresults']),entries=[...url.searchParams];
 if(entries.length>12||new Set(entries.map(([name])=>name)).size!==entries.length||entries.some(([name,value])=>!allowed.has(name)||!fields.some(([postedName,postedValue])=>postedName===name&&postedValue===value)))return '';
 const query=fields.filter(([name])=>name==='val-base-0');if(query.length!==1||url.searchParams.get('val-base-0')!==query[0][1]||!fieldsBound(entries,new URL(source.browseURL).searchParams.get('t')))return '';
 return url.href;
}
export function sourceScopedResultsMatch(document,source,rawURL,fields){
 if(!selectedSource(source)||sourceIdentity(rawURL,source)!==sourceIdentity(source.browseURL,source)&&!sourceScopedRedirectURL(rawURL,source,fields))return false;
 const receipt=scopedPageEvidence(document,source);if(!receipt||receipt.sourceHeading==='conflicting'||receipt.conflictingSourceBindings)return false;
 // Facets may contain unchecked alternatives. Only successful public source
 // controls are relevant; any active conflicting source/product stops output.
 for(const form of document.querySelectorAll('form')){if(!visible(form))continue;const bindings=[];for(const node of form.querySelectorAll('input,select,textarea')){if(!successful(node))continue;const name=node.getAttribute('name')||'';if(/^(?:p|t|t\[\]|action)$/i.test(name))bindings.push([name,String(node.value??node.textContent??'')]);}if(!fieldsBound(bindings,new URL(source.browseURL).searchParams.get('t'),{requireSource:false}))return false;}
 return true;
}
