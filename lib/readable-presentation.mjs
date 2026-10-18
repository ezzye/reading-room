// Public HTML CSS is a hint, not a measured browser style. Never alter Page Lens captures.
function px(value,fallback){const match=typeof value==='string'&&value.trim().match(/^(\d+(?:\.\d+)?)px$/i);return match?Number(match[1]):fallback;}
export function readableSourceStyle(style={},role='body'){
 const limits={body:[16,26,20,1.35,1.9],heading:[22,48,28,1.15,1.6],headline:[28,72,46,1.08,1.5],standfirst:[20,30,24,1.3,1.8]};
 const [minimum,maximum,fallback,minLine,maxLine]=limits[role]||limits.body;
 const size=px(style.fontSize,fallback),fontSize=size>=minimum&&size<=maximum?size:fallback;
 const line=px(style.lineHeight,fontSize*1.5),lineHeight=Math.min(fontSize*maxLine,Math.max(fontSize*minLine,line));
 return {...style,fontSize:fontSize+'px',lineHeight:Math.round(lineHeight*100)/100+'px',...(role==='body'?{letterSpacing:'0px',marginBottom:Math.max(16,Math.min(40,px(style.marginBottom,24)))+'px'}:{})};
}
export function sanitizePublicCapturePresentation(capture){
 if(capture?.presentation?.method!=='public-url')return capture;
 const result=structuredClone(capture);
 result.design={...result.design,bodyStyle:readableSourceStyle(result.design?.bodyStyle),headlineStyle:readableSourceStyle(result.design?.headlineStyle,'headline'),standfirstStyle:readableSourceStyle(result.design?.standfirstStyle,'standfirst')};
 result.blocks=(result.blocks||[]).map(block=>['paragraph','quote','heading'].includes(block.type)?{...block,style:readableSourceStyle(block.style,block.type==='heading'?'heading':'body')}:block);
 return result;
}
