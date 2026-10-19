import {createNewsBankHTTPClient} from '../lib/newsbank-http.mjs';
import {sanitizeMatchDiagnostic} from '../lib/newsbank-match-diagnostic.mjs';
import {libraryPublication} from '../lib/library-publications.mjs';
import {publicationSearchQuery,sanitizePublicationSearch,sanitizePublicationSearchStatus} from '../lib/newsbank-publications.mjs';
import {librarySearchQuery,sanitizeLibrarySearch} from '../lib/library-search-contract.mjs';
import {libraryRecordRequest} from '../lib/library-record-contract.mjs';
import {sanitizeNativeSources} from '../lib/newsbank-native-sources.mjs';
import {sanitizeSourceSearchInspection} from '../lib/newsbank-source-search.mjs';
import {publisherPreview} from './publisher-preview.mjs';
import {publisherRender} from './publisher-render.mjs';

const MAX_EVENT_BYTES=30_000,MAX_OUTPUT_BYTES=30_000,MAX_ARTICLE_CHARS=18_000;
const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
function response(value){return jsonBytes(value)<=MAX_OUTPUT_BYTES?value:{status:'error',code:'response_too_large'};}
function boundedText(value,max){return typeof value==='string'&&value.length<=max?value:null;}
function credentials(event){
 const libraryName=boundedText(event.libraryName,160),cardNumber=boundedText(event.cardNumber,200);
 if(!libraryName?.trim()||!cardNumber?.trim())throw new Error('missing_credentials');
 return {libraryName:libraryName.trim(),cardNumber};
}
function articleResult(article){
 if(!article||!Array.isArray(article.paragraphs)||article.paragraphs.length<3||article.paragraphs.length>100)throw new Error('invalid_article');
 let sourceURL;try{sourceURL=new URL(article.libraryURL);}catch{throw new Error('invalid_article');}
 const docref=sourceURL.searchParams.get('docref');
 if(sourceURL.origin!=='https://infoweb.newsbank.com'||sourceURL.pathname!=='/apps/news/document-view'||sourceURL.searchParams.get('p')!=='UKNB'||!/^news\/[A-F0-9]+$/.test(docref||''))throw new Error('invalid_article');
 const libraryURL=new URL('https://infoweb.newsbank.com/apps/news/document-view');libraryURL.searchParams.set('p','UKNB');libraryURL.searchParams.set('docref',docref);
 const strings=[article.title,article.byline||'',article.date||'',article.publication||'',...article.paragraphs];
 if(strings.some(x=>typeof x!=='string')||strings.reduce((n,x)=>n+x.length,0)>MAX_ARTICLE_CHARS||strings.some(x=>x.length>6000))throw new Error('article_too_large');
 return {title:article.title,byline:article.byline||'',date:article.date||'',publication:article.publication||'',libraryURL:libraryURL.href,paragraphs:article.paragraphs};
}
export async function handler(event,context={}){
 try{
  if(!event||typeof event!=='object'||Array.isArray(event)||jsonBytes(event)>MAX_EVENT_BYTES)return response({status:'error',code:'request_too_large'});
  const fetcher=context.fetch||globalThis.fetch;if(typeof fetcher!=='function')return response({status:'error',code:'unavailable'});
  if(event.action==='publisher-preview')return response(await publisherPreview(event,{fetch:fetcher}));
  if(event.action==='publisher-render')return response(await publisherRender(event));
  if(event.action==='probe')return response(await createNewsBankHTTPClient({fetch:fetcher}).probe());
  if(event.action==='inspect-native-sources'){
   if(Object.keys(event).some(key=>!['action','session'].includes(key)))return response({status:'error',code:'invalid_native_sources'});
   if(!event.session)return response({status:'login_required',stage:'session',reasonCode:'session_expired'});
   const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(event.session);return response(sanitizeNativeSources(await client.inspectNativeSources())||{status:'error',code:'invalid_native_sources'});
  }
  if(event.action==='inspect-source-search'){
   if(Object.keys(event).some(key=>!['action','session'].includes(key)))return response({status:'error',code:'invalid_source_search'});
   const client=createNewsBankHTTPClient({fetch:fetcher});if(event.session)client.restoreSession(event.session);return response(sanitizeSourceSearchInspection(await client.inspectSourceSearch())||{status:'error',code:'invalid_source_search'});
  }
  if(event.action==='library-search'){
   if(Object.keys(event).some(key=>!['action','publisher','query','session'].includes(key)))return response({status:'error',code:'invalid_library_search'});
   const query=librarySearchQuery({publisher:event.publisher,query:event.query});
   if(!event.session)return response({status:'login_required',stage:'session',reasonCode:'session_expired'});
   const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(event.session);
   const result=await client.searchLibrary(query);
   return response(result.status==='library-search'?sanitizeLibrarySearch(result)||{status:'error',code:'invalid_library_metadata'}:sanitizePublicationSearchStatus(result)||{status:'error',code:'invalid_library_metadata'});
  }
  if(event.action==='library-record'){
   if(Object.keys(event).some(key=>!['action','publisher','libraryURL','title','date','publication','session'].includes(key)))return response({status:'error',code:'invalid_library_record'});
   const selected=libraryRecordRequest({publisher:event.publisher,libraryURL:event.libraryURL,title:event.title,date:event.date,publication:event.publication});
   if(!event.session)return response({status:'login_required'});
   const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(event.session);const result=await client.fetchLibraryRecord(selected);
   if(result.status==='found')return response({status:'found',article:articleResult(result.article),session:client.serializeSession()});
   return response(result.status==='not_found'?{status:'not_found',reasonCode:'record_mismatch'}:{status:result.status});
  }
  if(event.action==='search-publications'){
   if(Object.keys(event).some(key=>!['action','publication','title','session'].includes(key)))return response({status:'error',code:'invalid_publication_query'});
   const query=publicationSearchQuery({publication:event.publication,title:event.title});
   if(!event.session)return response({status:'login_required',stage:'session',reasonCode:'session_expired'});
   const client=createNewsBankHTTPClient({fetch:fetcher});client.restoreSession(event.session);
   const result=await client.searchPublications(query);
   if(result.status==='metadata'){const clean=sanitizePublicationSearch(result);return response(clean||{status:'error',code:'invalid_publication_metadata'});}
   return response(sanitizePublicationSearchStatus(result)||{status:'needs_interaction',stage:'results',reasonCode:'results_changed'});
  }
  if(event.action==='connect'){
   const account=credentials(event),client=createNewsBankHTTPClient({fetch:fetcher});
   const result=await client.login(account);
   if(result.status!=='authenticated')return response({status:result.status,reason:result.reason||'NewsBank sign-in was not confirmed.'});
   return response({status:'authenticated',session:client.serializeSession()});
  }
  if(event.action==='lookup'){
   const account=credentials(event);const publisher=event.publisher===undefined?'times':event.publisher;if(!libraryPublication(publisher)||libraryPublication(publisher).urlIntakeEnabled===false)return response({status:'error',code:'invalid_publisher'});if(typeof event.title!=='string'||!event.title.trim()||event.title.length>400)return response({status:'error',code:'invalid_title'});
   const client=createNewsBankHTTPClient({fetch:fetcher});if(event.session)client.restoreSession(event.session);
   const lookup={title:event.title,date:typeof event.date==='string'?event.date:'',publisher,urlWordsHint:event.urlWordsHint===true};
   let result=await client.lookup(lookup);
   if(result.status==='login_required'){
    const auth=await client.login(account);if(auth.status!=='authenticated')return response({status:auth.status,reason:auth.reason||'NewsBank sign-in was not confirmed.'});
    result=await client.lookup(lookup);
   }
   if(result.status!=='found'){const out={status:result.status,reason:result.reason||''};if(result.status==='not_found'){const diagnostic=sanitizeMatchDiagnostic(result.diagnostic,{bibliography:true});if(diagnostic)out.diagnostic=diagnostic;}return response(out);}
   const article=articleResult(result.article),session=client.serializeSession(),out={status:'found',article,session};
   return response(out);
  }
  return response({status:'error',code:'unsupported_action'});
 }catch(e){
  if(e?.code==='newsbank_http_status'&&Number.isInteger(e.httpStatus)&&e.httpStatus>=400&&e.httpStatus<=599)return response({status:'blocked',httpStatus:e.httpStatus});
  const code=['invalid_library_search','invalid_library_record','invalid_publication_query','invalid_article','article_too_large','missing_credentials'].includes(e?.message)?e.message:'upstream_failure';
  return response({status:'error',code});
 }
}
