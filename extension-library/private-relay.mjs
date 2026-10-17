import {RET_ORIGINS} from './library-core.mjs';

// Runs in Chrome's isolated extension world on an ordinary signed-in RET tab.
// Normal first-party cookies reach the private hosting gateway; they are never
// read, returned, exported or stored by the extension. No hosting bypass key.
export async function privateRequest(origin, token, data) {
 const allowed=['https://reader.example.org','https://dayofflondon.com'];
 if(!allowed.includes(origin)||location.origin!==origin||!['activate','next','complete','fail'].includes(data?.action))return {error:'Use the recognised RET connector setup tab.'};
 try{
  const r=await fetch('/api/library-connector',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-Reading-Room':'1',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(110000)});
  if(!r.headers.get('Content-Type')?.includes('application/json'))return {error:'Open RET connector setup in Chrome and sign in as the owner. Keep that tab open.'};
  const result=await r.json();return r.ok?{result}:{error:result.error||'The private RET service is unavailable.'};
 }catch{return {error:'The private RET connection failed. Open connector setup in Chrome and check your sign-in.'};}
}

export async function relayAPI(browser,settings,data){
 if(!RET_ORIGINS.includes(settings.origin)||!['activate','next','complete','fail'].includes(data?.action))throw Error('Invalid RET connector request.');
 let tabs=await browser.tabs.query({url:settings.origin+'/*'});
 let tab=tabs.find(t=>{try{return new URL(t.url).pathname==='/library-connector';}catch{return false;}})||tabs[0];
 if(!tab){tab=await browser.tabs.create({url:settings.origin+'/library-connector',active:false});for(let n=0;n<50;n++){const t=await browser.tabs.get(tab.id);if(t.status==='complete')break;await new Promise(r=>setTimeout(r,300));}}
 const [response]=await browser.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:privateRequest,args:[settings.origin,settings.token||'',data]});
 if(response?.result?.error)throw Error(response.result.error);
 if(!response?.result?.result)throw Error('Open RET connector setup in Chrome and sign in as the owner.');
 return response.result.result;
}
