import {timesURL,COLLECTION} from '../extension-library/library-core.mjs';

export const OBSERVER_PUBLICATION_LABEL='Observer, The: Web Edition Articles (London, England)';
export const HERALD_PUBLICATION_LABEL='Herald, The: Web Edition Articles (Glasgow, Scotland)';
export const NATIONAL_PUBLICATION_LABEL='National, The (Scotland)';
export const UKNB_SEARCH_ENTRY='https://infoweb.newsbank.com/apps/news/?p=UKNB';
const freeze=value=>{for(const item of Object.values(value))if(item&&typeof item==='object')freeze(item);return Object.freeze(value);};
// The two legacy policies retain their existing behaviour rather than inventing
// exact observed aliases. Every newly enabled family needs a qualified label.
export const LIBRARY_PUBLICATIONS=freeze({
 times:{key:'times',name:'The Times',hosts:['thetimes.com'],color:'#171717',proofMode:'legacy-times',observedLabels:[],canonicalLabels:['The Times (Camden NewsBank text edition)'],searchEntry:COLLECTION,datePolicy:'exact',strictPublication:false,requireDate:false,urlHintMinimumScore:.72,urlHintApostropheLoss:false},
 telegraph:{key:'telegraph',name:'The Telegraph',hosts:['telegraph.co.uk'],color:'#00635a',proofMode:'legacy-telegraph',observedLabels:[],canonicalLabels:['The Daily Telegraph (London, UK) (Camden NewsBank text edition)','The Sunday Telegraph (London, UK) (Camden NewsBank text edition)'],searchEntry:UKNB_SEARCH_ENTRY,datePolicy:'exact-or-next-day',strictPublication:false,requireDate:false,urlHintMinimumScore:.72,urlHintApostropheLoss:false},
 observer:{key:'observer',name:'The Observer',hosts:['observer.co.uk'],color:'#17332f',proofMode:'exact-bibliographic',observedLabels:[OBSERVER_PUBLICATION_LABEL],canonicalLabels:[OBSERVER_PUBLICATION_LABEL],searchEntry:UKNB_SEARCH_ENTRY,datePolicy:'exact',strictPublication:true,requireDate:true,urlHintMinimumScore:.85,urlHintApostropheLoss:true,evidence:{basis:'owner-observed-native-UKNB-result',observedAt:'2026-10-18',docref:'news/1AB540A9361A0190'}},
 herald:{key:'herald',name:'The Herald',hosts:['heraldscotland.com'],color:'#171717',proofMode:'exact-bibliographic',observedLabels:[HERALD_PUBLICATION_LABEL],canonicalLabels:[HERALD_PUBLICATION_LABEL],searchEntry:UKNB_SEARCH_ENTRY,datePolicy:'exact',strictPublication:true,requireDate:true,urlHintMinimumScore:.85,urlHintApostropheLoss:false,urlPattern:'numeric-news',urlIntakeEnabled:false,evidence:{basis:'owner-observed-native-UKNB-result',observedAt:'2026-10-18',docref:'news/1AB517C54580F368'}},
 national:{key:'national',name:'The National',hosts:['thenational.scot'],color:'#171717',proofMode:'exact-bibliographic',observedLabels:[NATIONAL_PUBLICATION_LABEL],canonicalLabels:[NATIONAL_PUBLICATION_LABEL],searchEntry:UKNB_SEARCH_ENTRY,datePolicy:'exact',strictPublication:true,requireDate:true,urlHintMinimumScore:.85,urlHintApostropheLoss:false,urlPattern:'numeric-news',urlIntakeEnabled:false,evidence:{basis:'owner-observed-native-UKNB-result',observedAt:'2026-10-18',docref:'news/1AB52B39B15AA0D8'}}
});
export function libraryPublication(key){return typeof key==='string'&&Object.hasOwn(LIBRARY_PUBLICATIONS,key)?LIBRARY_PUBLICATIONS[key]:null;}
export const publicationFieldValue=value=>typeof value==='string'?value.replace(/^\s*(?:Publication|Source)\s*:\s*/i,'').replace(/\s+/g,' ').trim():'';
export function knownLibraryPublicationLabel(value){const label=publicationFieldValue(value);for(const paper of Object.values(LIBRARY_PUBLICATIONS))if(paper.observedLabels.includes(label))return {key:paper.key,label};return null;}
export function libraryPublicationForURL(raw){
 const u=new URL(raw),host=u.hostname.replace(/^www\./,'');
 const paper=Object.values(LIBRARY_PUBLICATIONS).find(value=>value.hosts.includes(host));
 if(paper?.key==='times')return {key:paper.key,name:paper.name,host,url:timesURL(raw),color:paper.color};
 if(paper?.key==='observer'){
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/^\/news\/(?:[a-z0-9-]+\/)+article\/[a-z0-9-]+\/?$/i.test(u.pathname)||[...u.searchParams.keys()].some(key=>/token|auth|password|pin|session|credential|secret|key/i.test(key)))throw Error('Only an ordinary Observer article URL can be searched in Camden.');
  u.hostname=host;u.search='';u.hash='';return {key:paper.key,name:paper.name,host,url:u.href.replace(/\/$/,''),color:paper.color};
 }
 if(paper?.urlPattern==='numeric-news'){
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/^\/news\/\d+\.[a-z0-9-]+\/?$/i.test(u.pathname)||[...u.searchParams.keys()].some(key=>/token|auth|password|pin|session|credential|secret|key/i.test(key)))throw Error('Only an ordinary registered newspaper article URL can be identified.');
  u.hostname=host;u.search='';u.hash='';return {key:paper.key,name:paper.name,host,url:u.href.replace(/\/$/,''),color:paper.color};
 }
 if(paper?.key!=='telegraph'||u.protocol!=='https:'||u.username||u.password||u.port||!/^\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/i.test(u.pathname))throw Error('Only ordinary Times or Telegraph article URLs can be searched in Camden.');
 u.hostname=host;u.search='';u.hash='';return {key:paper.key,name:paper.name,host,url:u.href,color:paper.color};
}
export function matchesLibraryPublication(value,key){
 const paper=libraryPublication(key),text=String(value||'');if(!paper)return false;
 if(paper.proofMode==='exact-bibliographic')return paper.observedLabels.includes(text.replace(/\s+/g,' ').trim());
 if(paper.proofMode==='legacy-times')return /Times/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits)/i.test(text);
 return /Telegraph/i.test(text)&&!/(?:Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton)/i.test(text)&&/(?:Daily Telegraph|Sunday Telegraph|London|Camden NewsBank)/i.test(text);
}
export function proveLibraryPublication(raw,key){
 const paper=libraryPublication(key);if(!paper)return '';
 const text=String(raw||'').replace(/Author\/Byline:\s*[\s\S]*?(?=\d+\s+Words|Readability|Publication:|Source:|$)/i,' ');
 if(paper.proofMode==='exact-bibliographic'){const label=publicationFieldValue(text);return paper.observedLabels.includes(label)?label:'';}
 if(paper.proofMode==='legacy-times')return /\b(?:The )?(?:Sunday )?Times\b/i.test(text)&&!/(?:New York|Financial|Irish|Canberra|Straits|Telegraph)/i.test(text)?paper.canonicalLabels[0]:'';
 if(/Coventry|Belfast|Derby|Dundee|Sydney|Australia|Macon|Alton/i.test(text)||!/\bLondon\b/i.test(text))return '';
 if(/\b(?:The\s+)?Sunday Telegraph\b/i.test(text))return paper.canonicalLabels[1];
 return /\b(?:The\s+)?Daily Telegraph\b/i.test(text)?paper.canonicalLabels[0]:'';
}
