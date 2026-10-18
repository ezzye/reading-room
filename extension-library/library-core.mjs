export const COLLECTION='https://infoweb.newsbank.com/apps/news/browse-multi?p=UKNB&t=favorite%3ALSTBLETW%21The%20London%20Times%20Collection';
export const RET_ORIGINS=['https://reader.example.org','https://dayofflondon.com'];
const stop=new Set('the and as was were with this that from for into over did does are have has had been its their his her our your latest news article live update updates times sunday down set across'.split(' '));
export function terms(s){return [...new Set(String(s).toLowerCase().replace(/burnt|burned|burning/g,'fire').replace(/\bprotests?\b/g,'protest').replace(/\bstreets?\b/g,'street').match(/[a-z][a-z0-9]+/g)||[])].filter(w=>w.length>2&&!stop.has(w));}
export function headline(s){return String(s||'').replace(/^Go to the document viewer for\s*/i,'').replace(/\s+[|–—]\s+(?:The )?(?:Sunday )?Times.*$/i,'').replace(/\s+-\s+(?:The )?(?:Sunday )?Times.*$/i,'').trim().slice(0,400);}
export function timesURL(raw){const u=new URL(raw);if(u.protocol!=='https:'||!['thetimes.com','www.thetimes.com'].includes(u.hostname)||u.username||u.password||u.port||!/^\/.+\/article\/[a-z0-9-]+-[a-z0-9]{9}$/i.test(u.pathname))throw Error('Only ordinary Times article URLs can be searched.');u.search='';u.hash='';u.hostname='thetimes.com';return u.href;}
export function searchQuery(title){const w=terms(headline(title));if(w.length<3)throw Error('The original Times headline could not be read.');return w.slice(0,3).map(x=>'"'+x+'"').join(' ');}
function nextPublicationDay(date,published){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(published))return false;const start=Date.parse(date+'T00:00:00Z'),end=Date.parse(published+'T00:00:00Z');return Number.isFinite(start)&&Number.isFinite(end)&&new Date(start).toISOString().slice(0,10)===date&&new Date(end).toISOString().slice(0,10)===published&&end-start===86400000;}
export function rankMatches(title,results,date='',options={}){
 const a=terms(headline(title));if(a.length<3)return [];
 return results.map(r=>{const candidate=String(r.title||'').split(/\s+-\s+/)[0],b=terms(candidate),same=a.filter(x=>b.includes(x)).length;let score=2*same/(a.length+b.length||1);if(date&&r.date&&!String(r.date).includes(date))score-=options.allowNextDayPublication===true&&nextPublicationDay(date,String(r.date))?0.08:0.35;return {...r,score};}).sort((x,y)=>y.score-x.score);
}
export function chooseMatch(title,results,date='',options={}){
 const r=rankMatches(title,results,date,options),best=r[0];if(!best||best.score<0.72||(r[1]&&best.score-r[1].score<0.12))throw Error('The library search did not find one unambiguous headline match. No article was substituted.');
 const u=new URL(best.url);if(u.origin!=='https://infoweb.newsbank.com'||u.pathname!=='/apps/news/document-view'||!/^news\/[A-F0-9]+$/.test(u.searchParams.get('docref')||''))throw Error('The library result link was not recognised.');return best;
}
