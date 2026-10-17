import {createNewsBankHTTPClient} from './newsbank-http.mjs';
import {openLibrary} from './library-vault.mjs';
const utf8=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(s)));
async function hmac(key,text){const k=await crypto.subtle.importKey('raw',typeof key==='string'?utf8.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,utf8.encode(text));}
export async function signLibraryInvocation({region,functionName,accessKeyId,secretAccessKey,payload,time=new Date()}){
 if(region!=='eu-west-1'||functionName!=='reading-room-library'||!/^AKIA[A-Z0-9]{16}$/.test(accessKeyId||'')||typeof secretAccessKey!=='string'||secretAccessKey.length<30)throw Error('The private library service is not configured correctly.');
 const host='lambda.'+region+'.amazonaws.com',path='/2015-03-31/functions/'+functionName+'/invocations',date=time.toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),hash=await digest(payload);
 const headers={'Content-Type':'application/json','Host':host,'X-Amz-Date':date,'X-Amz-Content-Sha256':hash};
 const signed='content-type;host;x-amz-content-sha256;x-amz-date',canonical=['POST',path,'','content-type:application/json\nhost:'+host+'\nx-amz-content-sha256:'+hash+'\nx-amz-date:'+date+'\n',signed,hash].join('\n');
 const scope=day+'/'+region+'/lambda/aws4_request',signing=await hmac(await hmac(await hmac(await hmac('AWS4'+secretAccessKey,day),region),'lambda'),'aws4_request');
 const signature=hex(await hmac(signing,'AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+await digest(canonical)));
 headers.Authorization='AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signed+', Signature='+signature;
 return {url:'https://'+host+path,headers};
}
async function jsonBounded(r){if(!r.body)throw Error('The private library service returned an empty response.');const rd=r.body.getReader();let size=0,text='';const dec=new TextDecoder();try{for(;;){const x=await rd.read();if(x.done)break;size+=x.value.length;if(size>100000)throw Error('The private library service response is too large.');text+=dec.decode(x.value,{stream:true});}return JSON.parse(text+dec.decode());}finally{await rd.cancel();}}
/** @param {Record<string, any>} config
 * @param {typeof fetch} fetcher
 * @param {{libraryName:string,cardNumber:string}|null} credentials */
export function runtimeLibraryClient(config,fetcher=globalThis.fetch,credentials=null){
 if(!config.RR_LIBRARY_AWS_FUNCTION)return createNewsBankHTTPClient({fetch:fetcher});
 let session=null,account=credentials;
 function restoreSession(value){const check=createNewsBankHTTPClient({fetch:fetcher});check.restoreSession(value);session=check.serializeSession();}
 async function invoke(action,input={}){
  const payload=JSON.stringify({action,...input,session});if(utf8.encode(payload).length>30000)throw Error('The private library request is too large.');
  const invoker=config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED?await openLibrary(config.RR_LIBRARY_VAULT_KEY,config.RR_LIBRARY_AWS_INVOKER_ENCRYPTED,'aws-library-invoker-v1'):{accessKeyId:config.RR_LIBRARY_AWS_ACCESS_KEY_ID,secretAccessKey:config.RR_LIBRARY_AWS_SECRET_ACCESS_KEY};
  const signed=await signLibraryInvocation({region:config.RR_LIBRARY_AWS_REGION,functionName:config.RR_LIBRARY_AWS_FUNCTION,accessKeyId:invoker.accessKeyId,secretAccessKey:invoker.secretAccessKey,payload});
  const r=await fetcher(signed.url,{method:'POST',headers:signed.headers,body:payload,redirect:'manual',signal:AbortSignal.timeout(95000)});
  if(!r.ok||r.headers.get('x-amz-function-error'))throw Error('The private library service is unavailable (HTTP '+r.status+').');
  const value=await jsonBounded(r);if(value.session)restoreSession(value.session);
  if(value.status==='blocked'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)throw Error('NewsBank returned HTTP '+value.httpStatus+'.');
  if(!['authenticated','found','rejected','login_required','needs_interaction','not_found','error','available'].includes(value.status))throw Error('The private library service returned an unrecognised result.');
  if(value.status==='error')throw Error('The private library service could not complete the request.');
  return value;
 }
 return {restoreSession,serializeSession:()=>session,
  async login(value){account=value;return invoke('connect',{libraryName:value.libraryName,cardNumber:value.cardNumber});},
  async lookup(meta){return invoke('lookup',{...meta,...(account?{libraryName:account.libraryName,cardNumber:account.cardNumber}:{})});}
 };
}
