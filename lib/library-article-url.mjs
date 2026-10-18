import {timesURL} from '../extension-library/library-core.mjs';
export function libraryArticle(raw){
 const u=new URL(raw),host=u.hostname.replace(/^www\./,'');
 if(host==='thetimes.com')return {key:'times',name:'The Times',host,url:timesURL(raw),color:'#171717'};
 if(u.protocol!=='https:'||host!=='telegraph.co.uk'||u.username||u.password||u.port||!/^\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/i.test(u.pathname))throw Error('Only ordinary Times or Telegraph article URLs can be searched in Camden.');
 u.hostname=host;u.search='';u.hash='';return {key:'telegraph',name:'The Telegraph',host,url:u.href,color:'#00635a'};
}
export function matchesLibraryPublication(value,key){
 const text=String(value||'');
 if(key==='times')return /Times/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits)/i.test(text);
 return /Telegraph/i.test(text)&&!/(?:Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton)/i.test(text)&&/(?:Daily Telegraph|Sunday Telegraph|London|Camden NewsBank)/i.test(text);
}
