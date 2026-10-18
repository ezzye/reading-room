import {libraryPublication} from './library-publications.mjs';
import {normalizeNewsBankDate} from './newsbank-http.mjs';
import {libraryRecordRequest,validateLibraryRecordArticle} from './library-record-contract.mjs';

const style={fontFamily:'RET-Tinos, Georgia, serif',fontSize:'20px',fontWeight:'400',lineHeight:'30px',marginBottom:'24px'};
/** No fetching, generated prose, inferred publisher URL or replacement media. */
export function buildLibraryRecordCapture({selected,article}={}){
 const choice=libraryRecordRequest(selected),source=validateLibraryRecordArticle(article,choice,normalizeNewsBankDate),paper=libraryPublication(choice.publisher),width=664;
 return {
  schema:'ret-capture/v1',url:source.libraryURL,title:source.title,publisher:paper.name+' · Camden NewsBank text edition',byline:source.byline,date:source.date,standfirst:'',capturedAt:'',
  viewport:{width:1440,height:900,devicePixelRatio:1},articleRect:{x:0,y:0,width,height:0},
  design:{bodyBackground:'#f4f1ed',articleBackground:'#fff',bodyStyle:{...style},headlineStyle:{...style,fontSize:'48px',fontWeight:'700',lineHeight:'52px'}},fonts:[],
  blocks:source.paragraphs.map((text,index)=>({id:'B'+(index+1),type:'paragraph',text,style:{...style},rect:{x:0,y:0,width,height:0}})),
  presentation:{method:'library-text',extractorRevision:1,brandColor:paper.color,message:'Selected Camden NewsBank text record in its supplied paragraph order. The library record is the source; no matching public newspaper URL was established. Reading Room uses an approximate newspaper layout. The text record supplies no original photographs, video or measured publisher styling. No replacement media or positions were invented.'},
  diagnostics:{libraryRecordEdition:true,libraryTextEdition:true,presentationApproximate:true,libraryURL:source.libraryURL,libraryTitle:source.title,publisherCaptureMatched:false,publisherTextCoverage:0,paywallDetected:false,completeNotCertified:true}
 };
}
