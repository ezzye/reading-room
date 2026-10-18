import {timesURL} from '../extension-library/library-core.mjs';
export const OBSERVER_PUBLICATION_LABEL='Observer, The: Web Edition Articles (London, England)';
export function libraryArticle(raw){
 const u=new URL(raw),host=u.hostname.replace(/^www\./,'');
 if(host==='thetimes.com')return {key:'times',name:'The Times',host,url:timesURL(raw),color:'#171717'};
 if(host==='observer.co.uk'){
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/^\/news\/(?:[a-z0-9-]+\/)+article\/[a-z0-9-]+\/?$/i.test(u.pathname)||[...u.searchParams.keys()].some(key=>/token|auth|password|pin|session|credential|secret|key/i.test(key)))throw Error('Only an ordinary Observer article URL can be searched in Camden.');
  u.hostname=host;u.search='';u.hash='';return {key:'observer',name:'The Observer',host,url:u.href.replace(/\/$/,''),color:'#17332f'};
 }
 if(u.protocol!=='https:'||host!=='telegraph.co.uk'||u.username||u.password||u.port||!/^\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/i.test(u.pathname))throw Error('Only ordinary Times or Telegraph article URLs can be searched in Camden.');
 u.hostname=host;u.search='';u.hash='';return {key:'telegraph',name:'The Telegraph',host,url:u.href,color:'#00635a'};
}
export function matchesLibraryPublication(value,key){
 const text=String(value||'');
 if(key==='observer')return text.replace(/\s+/g,' ').trim()===OBSERVER_PUBLICATION_LABEL;
 if(key==='times')return /Times/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits)/i.test(text);
 if(key!=='telegraph')return false;
 return /Telegraph/i.test(text)&&!/(?:Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton)/i.test(text)&&/(?:Daily Telegraph|Sunday Telegraph|London|Camden NewsBank)/i.test(text);
}
