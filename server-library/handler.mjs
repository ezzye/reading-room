import {createNewsBankHTTPClient} from '../lib/newsbank-http.mjs';

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
  if(event.action==='probe')return response(await createNewsBankHTTPClient({fetch:fetcher}).probe());
  if(event.action==='connect'){
   const account=credentials(event),client=createNewsBankHTTPClient({fetch:fetcher});
   const result=await client.login(account);
   if(result.status!=='authenticated')return response({status:result.status,reason:result.reason||'NewsBank sign-in was not confirmed.'});
   return response({status:'authenticated',session:client.serializeSession()});
  }
  if(event.action==='lookup'){
   const account=credentials(event);const publisher=event.publisher===undefined?'times':event.publisher;if(!['times','telegraph'].includes(publisher))return response({status:'error',code:'invalid_publisher'});if(typeof event.title!=='string'||!event.title.trim()||event.title.length>400)return response({status:'error',code:'invalid_title'});
   const client=createNewsBankHTTPClient({fetch:fetcher});if(event.session)client.restoreSession(event.session);
   let result=await client.lookup({title:event.title,date:typeof event.date==='string'?event.date:'',publisher});
   if(result.status==='login_required'){
    const auth=await client.login(account);if(auth.status!=='authenticated')return response({status:auth.status,reason:auth.reason||'NewsBank sign-in was not confirmed.'});
    result=await client.lookup({title:event.title,date:typeof event.date==='string'?event.date:'',publisher});
   }
   if(result.status!=='found')return response({status:result.status,reason:result.reason||''});
   const article=articleResult(result.article),session=client.serializeSession(),out={status:'found',article,session};
   return response(out);
  }
  return response({status:'error',code:'unsupported_action'});
 }catch(e){
  if(e?.code==='newsbank_http_status'&&Number.isInteger(e.httpStatus)&&e.httpStatus>=400&&e.httpStatus<=599)return response({status:'blocked',httpStatus:e.httpStatus});
  const code=e?.message==='invalid_article'?'invalid_article':e?.message==='article_too_large'?'article_too_large':e?.message==='missing_credentials'?'missing_credentials':'upstream_failure';
  return response({status:'error',code});
 }
}
