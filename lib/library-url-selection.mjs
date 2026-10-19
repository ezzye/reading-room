import {libraryPublication} from './library-publications.mjs';

// Identification for a human-selected metadata search only. This never
// authorises URL-to-record matching, imports, or a publisher URL alias.
const paths={
 herald:/^\/news\/\d{6,12}\.[a-z0-9-]+\/?$/i,
 national:/^\/news\/\d{6,12}\.[a-z0-9-]+\/?$/i,
 'irish-times':/^\/(?:[a-z0-9-]+\/)+\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/i,
 express:/^\/(?:[a-z0-9-]+\/){1,3}\d{5,12}\/[a-z0-9-]+\/?$/i,
 record:/^\/news\/[a-z0-9-]+\/[a-z0-9-]+-\d{6,12}\/?$/i,
 sundaypost:/^\/fp\/[a-z0-9-]+\/?$/i
};
export function selectedLibraryURL(raw){
 if(typeof raw!=='string'||raw.length>2048)return '';
 let url;try{url=new URL(raw);}catch{return '';}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||[...url.searchParams.keys()].some(key=>/token|auth|password|passcode|pin|session|credential|secret|key|signature|bearer|card|cookie|borrower|account|email|login|redirect|destination|ticket|nonce|csrf|(?:^|_)code/i.test(key)))return '';
 const host=url.hostname.replace(/^www\./,'');
 for(const [key,path]of Object.entries(paths)){const paper=libraryPublication(key);if(paper?.urlIntakeEnabled===false&&paper.hosts.includes(host)&&path.test(url.pathname))return key;}
 return '';
}

const discoveryStopwords=new Set('a all an and are as at be been being behind but by can could did do does for from had has have he her hers him his how i if in into is it its may might more most must no nor not of on or our out over she should so some than that the their them then there these they this those through to too under up us was we were what when where which who why will with without would you your'.split(' '));
// A literal keyword search for reader-chosen metadata, never a match or alias.
// Slugs can omit apostrophes and truncate a headline, so requiring every slug
// word would hide a valid result. Only these two explicit fallback families use
// this shorter initial query; supplied headlines are handled by the caller.
export function libraryURLDiscoveryQuery(raw){
 const publisher=selectedLibraryURL(raw);if(!['record','sundaypost'].includes(publisher))return '';
 const url=new URL(raw),last=url.pathname.split('/').filter(Boolean).at(-1),slug=publisher==='record'?last.replace(/-\d{6,12}$/,''):last;
 if(!slug||slug.length>300)return '';
 const words=slug.toLowerCase().split('-');if(words.some(word=>!word||/^\d{6,}$/.test(word)||/^(?=.*[a-z])(?=.*\d)[a-z\d]{8,}$/.test(word)))return '';
 const distinct=[...new Set(words.filter(word=>/^[a-z][a-z0-9]{1,}$/.test(word)&&!discoveryStopwords.has(word)))];
 const query=distinct.slice(0,3).join(' ');return distinct.length>=3&&query.length<=240?query:'';
}
