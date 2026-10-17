import {normalizeCapture} from './capture-core.mjs';
import {validateLibrarySource} from './library-study.mjs';
import {words} from './education-core.mjs';
import {chooseMatch,timesURL} from '../extension-library/library-core.mjs';

const bodyStyle={fontFamily:'RET-Tinos, Georgia, serif',fontSize:'20px',fontWeight:'400',lineHeight:'30px',marginBottom:'24px'};

// Compare complete, ordered library paragraphs, not just common words. This is
// intentionally conservative: a readable publisher preview is not a full view.
function coverage(source,capture){
 const text=' '+words(capture.blocks.filter(b=>['paragraph','quote','figure','video'].includes(b.type)).map(b=>b.text||b.caption||'').join(' ')).join(' ')+' ';
 let cursor=0,matched=0,total=0;
 for(const paragraph of source.paragraphs){
  const tokens=words(paragraph),needle=' '+tokens.join(' ')+' ';total+=tokens.length;
  const at=text.indexOf(needle,cursor);
  if(at!==-1){matched+=tokens.length;cursor=at+needle.length-1;}
 }
 return total?matched/total:0;
}

function matchingPublisherCapture(source,raw){
 if(!raw)return null;
 try{
  // A matching title is not enough: retain the exact queued article identity.
  if(timesURL(raw.url)!==source.originalURL)return null;
  const capture=normalizeCapture(raw);
  // Page Lens reports access-related markup even after it becomes inactive.
  // A visible access overlay aborts extraction; an explicit blocked capture is
  // rejected here. Full ordered source coverage, not a wrapper classname,
  // determines whether this is the complete readable publisher text.
  if(raw.diagnostics?.accessBlocked===true)return null;
  chooseMatch(source.originalTitle,[{title:capture.title,url:source.libraryURL}]);
  const publisherTextCoverage=coverage(source,capture);
  if(publisherTextCoverage<1)return null;
  return {...capture,capturedAt:typeof raw.capturedAt==='string'?raw.capturedAt:'',diagnostics:{...capture.diagnostics,libraryTextEdition:false,libraryURL:source.libraryURL,libraryTitle:source.title,publisherCaptureMatched:true,publisherTextCoverage,presentationApproximate:Boolean(capture.presentation)}};
 }catch{return null;}
}

/**
 * Build bounded capture data from an already readable, matched library record.
 * This function performs no fetching and no generation. Only a sufficiently
 * complete capture of the same publisher URL can supply original media/order.
 */
export function buildLibraryCapture(input,publisherCapture=null){
 const source=validateLibrarySource(input,{url:input?.originalURL});
 const publisher=matchingPublisherCapture(source,publisherCapture);
 if(publisher)return publisher;
 const width=664;
 return {
  schema:'ret-capture/v1',url:source.originalURL,title:source.title,
  publisher:'The Times · Camden NewsBank text edition',
  byline:source.byline,date:source.date,standfirst:'',capturedAt:'',
  viewport:{width:1440,height:900,devicePixelRatio:1},
  articleRect:{x:0,y:0,width,height:0},
  design:{bodyBackground:'#f4f1ed',articleBackground:'#fff',bodyStyle:{...bodyStyle},headlineStyle:{...bodyStyle,fontSize:'48px',fontWeight:'700',lineHeight:'52px'}},
  fonts:[],
  blocks:source.paragraphs.map((text,i)=>({id:'B'+(i+1),type:'paragraph',text,style:{...bodyStyle},rect:{x:0,y:0,width,height:0}})),
  presentation:{
   method:'library-text',extractorRevision:1,brandColor:'#171717',
   message:'Camden NewsBank text edition in its supplied paragraph order. RET uses an approximate newspaper reading layout; no original publisher viewport or font was measured. The library text record does not supply original photographs, video or page design. No replacement media or media positions were invented.',
   libraryURL:source.libraryURL,originalTitle:source.originalTitle,
  },
  diagnostics:{libraryTextEdition:true,presentationApproximate:true,libraryURL:source.libraryURL,libraryTitle:source.title,publisherCaptureMatched:false,publisherTextCoverage:0,paywallDetected:false,completeNotCertified:true},
 };
}
