/* Fixed-command, short-lived capture bridge. Never receives JavaScript. */
importScripts('media-capture.js');
const BRIDGE_META='retMediaBridgeStatus';
const BRIDGE_KEY='retMediaBridge',BRIDGE_ALARM='ret-media-bridge';
const BRIDGE_ORIGINS=new Set(['https://reader.example.org','https://dayofflondon.com']);
let bridgeBusy=false;
function bridgeURL(raw){try{if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020]/.test(raw))return '';const u=new URL(raw),h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||u.port||!h.includes('.')||h.includes(':')||/^[\d.]+$/.test(h)||/\.(?:local|localhost|internal|test|invalid)$/.test(h)||/(?:newsbank\.com|gale\.com|pressreader\.com)$/.test(h))return '';for(const k of [...u.searchParams.keys()]){if(/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k))return '';if(/^(?:utm_|fbclid$|gclid$|ref$|share$|cmp$)/i.test(k))u.searchParams.delete(k);}u.hash='';u.searchParams.sort();u.hostname=h.replace(/^www\./,'');if(u.pathname!=='/')u.pathname=u.pathname.replace(/\/+$/,'');return u.href;}catch{return '';}}
function bridgeSame(a,b){return !!a&&!!b&&a.nonce===b.nonce&&a.token===b.token&&a.sessionId===b.sessionId&&a.tabId===b.tabId;}

async function bridgeSession(){return (await chrome.storage.session.get(BRIDGE_KEY))[BRIDGE_KEY]||null;}
async function bridgeStore(s){await chrome.storage.session.set({[BRIDGE_KEY]:s});}
async function bridgeAPI(s,action,data={}){if(!BRIDGE_ORIGINS.has(s.origin))throw Error('Unapproved Reading Room origin.');const headers={'Content-Type':'application/json'};if(s.token)headers.Authorization='Bearer '+s.token;const r=await fetch(s.origin+'/api/page-lens',{method:'POST',headers,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000),body:JSON.stringify({action,...data})});const text=await r.text();if(text.length>16000)throw Error('Invalid connection response.');let result;try{result=JSON.parse(text);}catch{throw Error('Reading Room connection unavailable.');}if(!r.ok){const e=Error('Reading Room did not accept the connection.');e.httpStatus=r.status;e.endConnection=[401,403,410].includes(r.status);throw e;}return result;}
async function bridgeDiagnostic(patch){const allowed={};for(const key of ['lastPollAt','lastSuccessAt'])if(Number.isFinite(patch[key]))allowed[key]=patch[key];if(['waiting','checking','paired','source-not-active','capture-empty','capture-failed','sent-for-review','expired','stopped','network-error','invalid-response','api-rejected'].includes(patch.status))allowed.status=patch.status;if(Number.isInteger(patch.httpStatus)&&patch.httpStatus>=100&&patch.httpStatus<=599)allowed.httpStatus=patch.httpStatus;const old=(await chrome.storage.session.get(BRIDGE_META))[BRIDGE_META]||{};await chrome.storage.session.set({[BRIDGE_META]:{...old,...allowed}});}
async function bridgeEnsureAlarm(){const s=await bridgeSession();if(!s)return false;if(s.expiresAt<=Date.now()){await bridgeDiagnostic({status:'expired'});await bridgeStop(true,false);return false;}if(!await chrome.alarms.get(BRIDGE_ALARM))await chrome.alarms.create(BRIDGE_ALARM,{delayInMinutes:.5,periodInMinutes:.5});return true;}
async function bridgeStatus(){await bridgeEnsureAlarm();const s=await bridgeSession(),diagnostics=(await chrome.storage.session.get(BRIDGE_META))[BRIDGE_META]||{};return {state:s?.state||'stopped',expiresAt:s?.expiresAt,lastResult:s?.lastResult,diagnostics};}
async function bridgeStop(notify=true,record=true){const s=await bridgeSession();await chrome.storage.session.remove(BRIDGE_KEY);await chrome.alarms.clear(BRIDGE_ALARM);if(record)await bridgeDiagnostic({status:'stopped'});if(s?.token&&notify)try{await bridgeAPI(s,'stop',{sessionId:s.sessionId});}catch{/* Local authority has already ended. */}}
async function bridgeBegin(origin,tab){const existing=await bridgeSession();if(existing&&existing.expiresAt>Date.now()&&['pairing','enabled'].includes(existing.state)){if(existing.origin===origin&&existing.tabId===tab?.id&&existing.articleURL===bridgeURL(tab?.url)){await bridgeEnsureAlarm();return {state:existing.state,expiresAt:existing.expiresAt};}throw Error('Stop the current connection before enabling another tab.');}if(!BRIDGE_ORIGINS.has(origin))throw Error('Choose an approved Reading Room.');const articleURL=bridgeURL(tab?.url);if(!tab?.id||!articleURL||BRIDGE_ORIGINS.has(new URL(articleURL).origin))throw Error('Open the newspaper article and enable that tab.');if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw Error('Reading Room host permission has not been granted.');await bridgeStop();await chrome.storage.session.remove(BRIDGE_META);const nonce=[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');const s={origin,tabId:tab.id,windowId:tab.windowId,articleURL,nonce,expiresAt:Date.now()+90000,state:'pairing'};await bridgeStore(s);const target=new URL(origin+'/page-lens-connect');target.searchParams.set('articleURL',articleURL);target.searchParams.set('nonce',nonce);target.searchParams.set('extensionVersion','0.2.2');const connect=await chrome.tabs.create({url:target.href});const live=await bridgeSession();if(!bridgeSame(live,s))throw Error('Connection stopped.');s.connectionTabId=connect.id;await bridgeStore(s);await chrome.alarms.create(BRIDGE_ALARM,{delayInMinutes:.5,periodInMinutes:.5});return {state:s.state,expiresAt:s.expiresAt};}
async function bridgePair(message,sender){const s=await bridgeSession();let source;try{source=new URL(sender.url);}catch{throw Error('Unrecognized connection page.');}if(sender.id!==chrome.runtime.id||!s||s.state!=='pairing'||s.expiresAt<=Date.now()||sender.tab?.id!==s.connectionTabId||source.origin!==s.origin||source.pathname!=='/page-lens-connect'||source.searchParams.get('nonce')!==s.nonce||message.nonce!==s.nonce||!/^[a-f0-9]{64}$/.test(message.pairingCode||'')||!/^[a-f0-9]{32}$/.test(message.sessionId||''))throw Error('Connection request expired or did not match.');const result=await bridgeAPI(s,'pair',{pairingCode:message.pairingCode,articleURL:s.articleURL,extensionVersion:'0.2.2'});const expiresAt=typeof result.expiresAt==='number'?result.expiresAt:Date.parse(result.expiresAt);if(result.sessionId!==message.sessionId||!/^[a-f0-9]{64}$/.test(result.token||'')||bridgeURL(result.articleURL)!==s.articleURL||!(expiresAt>Date.now()&&expiresAt<=Date.now()+600000))throw Error('Invalid scoped connection response.');const live=await bridgeSession();if(!bridgeSame(live,s)){try{await bridgeAPI({...s,token:result.token},'stop',{sessionId:result.sessionId});}catch{}throw Error('Connection stopped.');}await bridgeStore({...s,token:result.token,sessionId:result.sessionId,expiresAt,state:'enabled',nonce:undefined});await bridgeDiagnostic({status:'paired'});await bridgeEnsureAlarm();await bridgePoll();return {sessionId:result.sessionId,expiresAt};}
async function bridgePoll(){
 if(bridgeBusy)return;bridgeBusy=true;
 try{
  const s=await bridgeSession();if(!s)return;
  if(s.expiresAt<=Date.now()){await bridgeDiagnostic({status:'expired'});await bridgeStop(true,false);return;}
  if(s.state!=='enabled')return;
  await bridgeDiagnostic({lastPollAt:Date.now(),status:'checking'});
  const result=await bridgeAPI(s,'poll');
  if(result.sessionId!==s.sessionId||bridgeURL(result.articleURL)!==s.articleURL){await bridgeDiagnostic({status:'invalid-response'});await bridgeStop(true,false);return;}
  if(!bridgeSame(await bridgeSession(),s))return;
  await bridgeDiagnostic({lastSuccessAt:Date.now(),status:'waiting',httpStatus:200});
  const command=result.command;if(!command)return;
  if(command.action!=='capture-visible-media'||!/^[a-f0-9]{32}$/.test(command.id||'')||command.id===s.lastCommandId)return;
  let tab,active,window;
  try{tab=await chrome.tabs.get(s.tabId);[active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});window=await chrome.windows.get(s.windowId);}catch{await bridgeStop();return;}
  if(bridgeURL(tab.url)!==s.articleURL){await bridgeStop();return;}
  const status=async state=>{await bridgeAPI(s,'status',{sessionId:s.sessionId,commandId:command.id,state});await bridgeDiagnostic({status:state});};
  if(!tab.active||active?.id!==s.tabId||tab.windowId!==s.windowId||!window.focused||window.state==='minimized'){await status('source-not-active');return;}
  if(!bridgeSame(await bridgeSession(),s))return;
  await bridgeStore({...s,lastCommandId:command.id});if(!bridgeSame(await bridgeSession(),s))return;
  let capture;
  try{const [{result:c}]=await chrome.scripting.executeScript({target:{tabId:s.tabId},world:'ISOLATED',func:extractMedia});capture=c;}catch{await status('capture-failed');return;}
  const current=await bridgeSession();if(!bridgeSame(current,s)||current.expiresAt<=Date.now())return;
  const nowTab=await chrome.tabs.get(s.tabId),[nowActive]=await chrome.tabs.query({active:true,lastFocusedWindow:true}),nowWindow=await chrome.windows.get(s.windowId);
  if(!nowTab.active||nowActive?.id!==s.tabId||!nowWindow.focused||nowWindow.state==='minimized'||nowTab.windowId!==s.windowId||bridgeURL(nowTab.url)!==s.articleURL||capture?.schema!=='ret-media/v1'||bridgeURL(capture.url)!==s.articleURL||!Array.isArray(capture.media)||capture.media.length>20||JSON.stringify(capture).length>250000){await status('capture-failed');return;}
  if(!capture.media.length){await status('capture-empty');return;}
  await bridgeAPI(s,'result',{sessionId:s.sessionId,commandId:command.id,capture});
  const final=await bridgeSession();if(!bridgeSame(final,s))return;
  await bridgeStore({...final,lastCommandId:command.id,lastResult:'Media sent to private review; nothing imported.'});await bridgeDiagnostic({status:'sent-for-review'});
 }catch(error){await bridgeDiagnostic({status:error.httpStatus?'api-rejected':'network-error',...(error.httpStatus?{httpStatus:error.httpStatus}:{})});if(error.endConnection)await bridgeStop(false,false);}
 finally{bridgeBusy=false;}
}

chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===BRIDGE_ALARM)bridgePoll();});
chrome.tabs.onRemoved.addListener(id=>{bridgeSession().then(s=>{if(s&&(id===s.tabId||s.state==='pairing'&&id===s.connectionTabId))bridgeStop();});});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url)bridgeSession().then(s=>{if(s&&id===s.tabId&&bridgeURL(change.url)!==s.articleURL)bridgeStop();});});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');let task;if(message?.type==='ret-page-lens-pair')task=bridgePair(message,sender);else if(popup&&message?.type==='ret-page-lens-begin')task=(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return bridgeBegin(message.origin,tab);})();else if(popup&&message?.type==='ret-page-lens-stop')task=bridgeStop().then(()=>({state:'stopped'}));else if(popup&&message?.type==='ret-page-lens-status')task=bridgeStatus();else if(popup&&message?.type==='ret-page-lens-check')task=(async()=>{await bridgeEnsureAlarm();await bridgePoll();return bridgeStatus();})();else return false;task.then(result=>reply({ok:true,...result})).catch(()=>reply({ok:false,message:'Connection unavailable or expired. Enable the source tab again.'}));return true;});

// Chrome can clear alarms; repair only an already enabled, unexpired local session.
const bridgeStartup=bridgeEnsureAlarm().catch(()=>{});
