// Reconstruct metadata only. Unknown fields, HTML, prose, cookies and account data
// are never copied from the provider/client result into this fixed contract.
import {OBSERVER_PUBLICATION_LABEL} from './library-article-url.mjs';
const SCHEMA='newsbank-match-diagnostic/v1';
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u001f]/.test(value)?value.trim():'';
const count=(value,max=1000)=>Number.isInteger(value)&&value>=0?Math.min(value,max):0;
const score=value=>typeof value==='number'&&Number.isFinite(value)&&value>=-1&&value<=1?Number(value.toFixed(4)):0;
export const searchSelectName=name=>typeof name==='string'&&/^(?:fld-base-\d{1,2}|field|search-field|search_field|sort|sortby|sort_by|sort-by|sortorder|sort_order)$/.test(name);
export const searchControlName=name=>searchSelectName(name)||typeof name==='string'&&/^(?:val-base-\d{1,2}|query)$/.test(name);
export const searchControlID=id=>typeof id==='string'&&/^edit-(?:fld|val)-base-\d{1,2}(?:--\d{1,2})?$/.test(id);
const visibility=value=>value==='hidden'?'hidden':'visible';
export function searchOptionMetadata(value,label){
 const name=text(label,80).replace(/\s+/g,' '),code=text(value,64);
 if(!/^(?:all text|alltext|headline|title|headline\s*\/\s*title|title\s*\/\s*headline|author|byline|source|publication|date|most recent|newest(?: first)?|oldest(?: first)?|earliest(?: first)?|relevance|best match(?:es)?|date\s*\((?:newest|oldest|most recent) first\))$/i.test(name)||!/^[A-Za-z0-9_.:-]{1,64}$/.test(code)||/secret|token|cookie|bearer|session|password|card|pin/i.test(code)||/^[A-Fa-f0-9]{24,}$|^[A-Za-z0-9_-]{32,}$/.test(code))return null;
 return {value:code,label:name};
}
function formEvidence(raw){
 const selects=[];for(const item of (Array.isArray(raw?.selects)?raw.selects:[]).slice(0,12)){if(!searchSelectName(item?.name))continue;const options=(Array.isArray(item.options)?item.options:[]).slice(0,12).map(o=>searchOptionMetadata(o?.value,o?.label)).filter(Boolean);selects.push({name:item.name,kind:/^sort/.test(item.name)?'sort':'search-field',tag:'select',type:item.type==='select-multiple'?'select-multiple':'select-one',visibility:visibility(item.visibility),disabled:item.disabled===true,options});}
 const controls=[];for(const item of (Array.isArray(raw?.controls)?raw.controls:[]).slice(0,12)){if(!searchControlName(item?.name)&&!searchControlID(item?.id))continue;if(!['input','select','textarea'].includes(item.tag))continue;controls.push({name:searchControlName(item.name)?item.name:'',id:searchControlID(item.id)?item.id:'',tag:item.tag,type:['hidden','text','search','radio','checkbox','select-one','select-multiple','textarea'].includes(item.type)?item.type:'other',visibility:visibility(item.visibility),disabled:item.disabled===true});}
 let headlineSelection=null;const selected=raw?.headlineSelection,option=searchOptionMetadata(selected?.value,selected?.label);if(selected?.name==='fld-base-0'&&option&&/^(?:headline|title)$/i.test(option.label)&&selects.some(s=>s.name===selected.name&&s.visibility==='visible'&&!s.disabled&&s.options.some(o=>o.value===option.value&&o.label===option.label)))headlineSelection={name:selected.name,...option};
 return {visibilityBasis:'markup-only',totalControls:count(raw?.totalControls),totalSelects:count(raw?.totalSelects),controls,selects,headlineSelection};
}
function date(value){const clean=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(clean))return '';const time=Date.parse(clean+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===clean?clean:'';}
export function diagnosticDocumentURL(raw,base){
 let u;try{u=new URL(raw,base);}catch{return '';}
 if(u.protocol!=='https:'||u.hostname!=='infoweb.newsbank.com'||u.port&&u.port!=='443'||u.username||u.password||u.pathname!=='/apps/news/document-view'||u.searchParams.getAll('p').length!==1||u.searchParams.get('p')!=='UKNB'||u.searchParams.getAll('docref').length!==1||!/^news\/[A-F0-9]{1,64}$/.test(u.searchParams.get('docref')||''))return '';
 const clean=new URL('https://infoweb.newsbank.com/apps/news/document-view');clean.searchParams.set('p','UKNB');clean.searchParams.set('docref',u.searchParams.get('docref'));return clean.href;
}
function candidate(raw,publisher){
 if(!raw||typeof raw!=='object')return null;const libraryURL=diagnosticDocumentURL(raw.libraryURL),title=text(raw.title,400);if(!libraryURL||!title)return null;
 const label=text(raw.publication,200),verifiedLabels=publisher==='times'?['The Times (Camden NewsBank text edition)']:publisher==='observer'?[OBSERVER_PUBLICATION_LABEL]:['The Daily Telegraph (London, UK) (Camden NewsBank text edition)','The Sunday Telegraph (London, UK) (Camden NewsBank text edition)'];
 const publication=verifiedLabels.includes(label)||/^(?:The )?(?:New York Times|Financial Times|Irish Times|Canberra Times|Straits Times|(?:Daily |Sunday )?Telegraph(?: \((?:London, (?:England|UK)|Sydney, Australia)\))?|(?:Belfast|Coventry|Derby|Dundee|Macon|Alton) Telegraph|(?:Sunday )?Times|Guardian|Independent|Daily Mail|Daily Mirror|Observer|Evening Standard)$/i.test(label)?label:'';
 const proof=raw.sourceProof;const sourceProof=publisher==='observer'&&proof&&typeof proof==='object'?{sourceProof:{metadataPresent:proof.metadataPresent===true,structuredFields:count(proof.structuredFields,100),directTextNodes:count(proof.directTextNodes,100),brLines:count(proof.brLines,100),exactLabelFields:count(proof.exactLabelFields,100),conflictingSourceFields:count(proof.conflictingSourceFields,100),expectedLiteralPresent:proof.expectedLiteralPresent===true}}:{};
 return {title,date:date(raw.date),publication,publicationVerification:raw.publicationVerification==='verified'&&verifiedLabels.includes(publication)?'verified':'unverified',libraryURL,headlineScore:score(raw.headlineScore),score:score(raw.score),eligible:raw.eligible===true,...sourceProof};
}
export function sanitizeMatchDiagnostic(raw){
 if(!raw||typeof raw!=='object'||raw.schema!==SCHEMA||!['times','telegraph','observer'].includes(raw.publisher))return null;
 const out={schema:SCHEMA,publisher:raw.publisher,requested:{title:text(raw.requested?.title,400),date:date(raw.requested?.date)},datePolicy:raw.publisher==='telegraph'?'exact-or-next-day':'exact',stage:raw.stage==='document'?'document':'search',queries:[]};
 if(raw.form)out.form=formEvidence(raw.form);
 for(const item of (Array.isArray(raw.queries)?raw.queries:[]).slice(0,2)){
  if(!item||typeof item!=='object')continue;
  const query={query:text(item.query,420),totalResults:count(item.totalResults),inspectedCount:count(item.inspectedCount,60),eligibleCount:count(item.eligibleCount,60),rejectedPublicationCount:count(item.rejectedPublicationCount,60),rejectedLinkCount:count(item.rejectedLinkCount,60),pageCount:count(item.pageCount,3),pagingStop:['no_next','unapproved_next','page_limit','loop','matched'].includes(item.pagingStop)?item.pagingStop:'no_next',truncated:item.truncated===true,candidates:(Array.isArray(item.candidates)?item.candidates:[]).slice(0,5).map(value=>candidate(value,raw.publisher)).filter(Boolean)};
  if(item.resultPage)query.resultPage={hasNext:item.resultPage.hasNext===true,resultCount:Number.isInteger(item.resultPage.resultCount)&&item.resultPage.resultCount>=0?Math.min(item.resultPage.resultCount,10_000_000):null};out.queries.push(query);
 }
 if(raw.stage==='document'){const document=candidate(raw.document,raw.publisher);if(document)out.document=document;}
 return out;
}
