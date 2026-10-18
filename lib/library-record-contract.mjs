import {headline} from '../extension-library/library-core.mjs';
import {libraryPublication,proveLibraryPublication} from './library-publications.mjs';
import {diagnosticDocumentURL} from './newsbank-match-diagnostic.mjs';
const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(value)?value.replace(/\s+/g,' ').trim():'';
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const selectedLibraryTitle=value=>headline(value).split(/\s+-\s+/)[0].replace(/\s+/g,' ').trim();
// Only server-held, room/member-bound metadata choices should supply this input.
// A library record remains the source when no publisher article URL is proved.
export function libraryRecordRequest(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['publisher','libraryURL','title','date','publication'].includes(key))||!libraryPublication(raw.publisher))throw Error('invalid_library_record');
 const libraryURL=diagnosticDocumentURL(raw.libraryURL),title=plain(raw.title,400),publication=plain(raw.publication,200);
 if(!libraryURL||raw.libraryURL!==libraryURL||title.length<5||!validDate(raw.date)||!proveLibraryPublication(publication,raw.publisher))throw Error('invalid_library_record');
 return {publisher:raw.publisher,libraryURL,title,date:raw.date,publication};
}
export function validateLibraryRecordArticle(raw,input,normalizeDate){
 const selected=libraryRecordRequest(input),invalid=()=>{throw Error('The selected library record could not be verified.');};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['title','byline','date','publication','libraryURL','paragraphs'].includes(key)))return invalid();
 if(typeof raw.title!=='string'||raw.title.length>600||selectedLibraryTitle(raw.title)!==selectedLibraryTitle(selected.title)||typeof raw.byline!=='string'||raw.byline.length>500||typeof raw.date!=='string'||raw.date.length>100||normalizeDate(raw.date)!==selected.date||typeof raw.publication!=='string'||raw.publication!==proveLibraryPublication(selected.publication,selected.publisher)||raw.libraryURL!==selected.libraryURL||!Array.isArray(raw.paragraphs)||raw.paragraphs.length<3||raw.paragraphs.length>100||raw.paragraphs.some(value=>typeof value!=='string'||!value.trim()||value.length>6000)||[raw.title,raw.byline,raw.date,raw.publication,...raw.paragraphs].reduce((sum,value)=>sum+value.length,0)>18000)return invalid();
 return {title:raw.title,byline:raw.byline,date:raw.date,publication:raw.publication,libraryURL:selected.libraryURL,paragraphs:[...raw.paragraphs]};
}
