// Pure matching over an already room-filtered shelf. Fuzzy matches always need reader review.
import { sourceURL } from './education-core.mjs';
import { mediaURL } from './capture-core.mjs';
const publishers = {
 'thetimes.com':'The Times','theguardian.com':'The Guardian','bbc.co.uk':'BBC News','bbc.com':'BBC News',
 'standard.co.uk':'The Standard','independent.co.uk':'The Independent','metro.co.uk':'Metro','dawn.com':'Dawn',
 'indianexpress.com':'The Indian Express','irishexaminer.com':'Irish Examiner','hindustantimes.com':'Hindustan Times',
 'straitstimes.com':'The Straits Times','dailymaverick.co.za':'Daily Maverick','telegraph.co.uk':'The Telegraph','mirror.co.uk':'Daily Mirror','thesun.co.uk':'The Sun','dailymail.com':'Daily Mail','dailymail.co.uk':'Daily Mail','nytimes.com':'The New York Times',
};
const stop = new Set('a an the as at by for from in is it of on to with and or after before amid over under into out news article world uk us say says said new latest live report reports update updates'.split(' '));
function safe(raw) {
 try {
  // Validate before the shared helpers remove any tracking keys.
  const input=new URL(raw);
  if([...input.searchParams.keys()].some(k=>/token|auth|session|signature|password|secret|key|credential|expires|policy|pin|borrower/i.test(k)))return null;
  const url=new URL(sourceURL(raw));
  if(!mediaURL(url.href)||!publishers[url.hostname])return null;
  return url;
 } catch{return null;}
}
const timesID=u=>u?.hostname==='thetimes.com'&&u.pathname.includes('/article/')?u.pathname.match(/-([a-z0-9]{9})$/i)?.[1].toLowerCase()||'':'';
function date(u) {
 const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
 const found=u?.pathname.match(/(?:^|\/)(20\d{2})[/-](\d{1,2}|[a-z]{3})[/-](\d{1,2})(?:\/|-|$)/i);
 return found?[found[1],months[found[2].toLowerCase()]||found[2].padStart(2,'0'),found[3].padStart(2,'0')].join('-'):'';
}
const conflict=(a,b)=>Boolean(date(a)&&date(b)&&date(a)!==date(b));
function exact(a,b) {
 if(a.hostname!==b.hostname||conflict(a,b))return '';
 const x=timesID(a), y=timesID(b);
 if(x&&y)return x===y?'publisher-article-id':'';
 return a.href===b.href?'canonical-url':'';
}
/** True only for strong URL identity, never for fuzzy headline or slug similarity. */
export function safeURLMatch(input,candidate) {
 const a=safe(input),b=safe(candidate);return Boolean(a&&b&&exact(a,b));
}
function terms(text) {
 return new Set((String(text||'').slice(0,1500).normalize('NFKC').toLowerCase().match(/[\p{L}]+/gu)||[]).map(word=>{
  if(/^(burned|burnt|burning)$/.test(word))return 'burn';
  if(word.length>5&&word.endsWith('ies'))return word.slice(0,-3)+'y';
  if(word.length>4&&word.endsWith('s')&&!word.endsWith('ss'))return word.slice(0,-1);
  return word;
 }).filter(word=>word.length>2&&!stop.has(word)));
}
function slug(u) {try{return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||'').replace(/\.(html?|php)$/i,'').replace(/-[a-z0-9]{9,}$/i,'');}catch{return '';}}
function similarity(a,b) {const overlap=[...a].filter(x=>b.has(x)).length;return {score:a.size+b.size?2*overlap/(a.size+b.size):0,overlap};}
function publisherAllows(input,u) {
 if(!input||input==='all')return true;
 const value=String(input).toLowerCase().trim();return [u.hostname,u.hostname.split('.')[0].replace(/^the/,''),publishers[u.hostname].toLowerCase(),publishers[u.hostname].toLowerCase().replace(/^the /,'').replace(/ news$/,'')].includes(value);
}
/** Returns up to five shelf rows plus score, basis, auto and ambiguity evidence. */
export function rankSavedArticles({url,headline,publisher}={},rows=[]) {
 const supplied=Boolean(url), input=supplied?safe(url):null;
 if(supplied&&!input)return [];
 const query=terms(headline|| (input?slug(input):''));
 const matches=[];
 for(const row of rows) {
  const target=safe(row.sourceURL||row.source_url||row.url);
  if(!target||!publisherAllows(publisher,target)||input&&(input.hostname!==target.hostname||conflict(input,target)))continue;
  const basis=input?exact(input,target):'';
  if(basis){matches.push({...row,score:1,basis,auto:true});continue;}
  const title=similarity(query,terms(row.title||row.headline));
  const path=similarity(query,terms(slug(target)));
  const best=title.score>=path.score?{...title,basis:'headline-similarity'}:{...path,basis:'url-slug-similarity'};
  if(best.score<0.65||best.overlap<3)continue;
  matches.push({...row,score:Number(best.score.toFixed(4)),basis:best.basis,auto:false});
 }
 matches.sort((a,b)=>Number(b.auto)-Number(a.auto)||b.score-a.score||String(a.id||a.sourceURL||a.url).localeCompare(String(b.id||b.sourceURL||b.url)));
 const strong=matches.filter(x=>x.auto).length;
 const fuzzyAmbiguous=!strong&&matches.length>1&&matches[0].score-matches[1].score<=0.1;
 return matches.slice(0,5).map(match=>({...match,auto:match.auto&&strong===1,ambiguous:strong>1||fuzzyAmbiguous}));
}
