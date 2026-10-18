import {US_PUBLIC_PROFILES} from './us-public-profiles.mjs';
// Public HTML CSS is a hint, not a measured browser style. Never alter Page Lens captures.
function px(value,fallback){const match=typeof value==='string'&&value.trim().match(/^(\d+(?:\.\d+)?)px$/i);return match?Number(match[1]):fallback;}
function channels(value){
 const names={white:'#ffffff',black:'#000000',transparent:'#00000000',gray:'#808080',grey:'#808080',red:'#ff0000',blue:'#0000ff',green:'#008000',navy:'#000080'};
 const raw=String(value||'').trim().toLowerCase(),v=names[raw]||raw;
 if(/^#[a-f\d]{3,4}$/i.test(v)){const c=[...v.slice(1)].map(x=>parseInt(x+x,16));return [...c.slice(0,3),c.length===4?c[3]/255:1];}
 if(/^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(v)){const c=v.slice(1).match(/../g).map(x=>parseInt(x,16));return [...c.slice(0,3),c.length===4?c[3]/255:1];}
 const rgb=v.match(/^rgba?\(([^)]+)\)$/);if(rgb){const p=rgb[1].split(/[,\s]+/).filter(Boolean);if(p.length<3||p.length>4)return null;const c=p.slice(0,3).map(x=>Number.parseFloat(x)*(x.endsWith('%')?2.55:1));const alpha=p[3]===undefined?1:Number.parseFloat(p[3])*(p[3].endsWith('%')?.01:1);if([...c,alpha].every(Number.isFinite)&&c.every(x=>x>=0&&x<=255)&&alpha>=0&&alpha<=1)return [...c,alpha];}
 return null;
}
function luminance(rgb){return rgb.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);}
function readableColor(value,background){
 const rawBackground=channels(background)||[255,255,255,1],bg=rawBackground.slice(0,3).map(x=>x*rawBackground[3]+255*(1-rawBackground[3]));
 const raw=channels(value),fallback=luminance(bg)>.179?'#171717':'#ffffff';
 if(!raw)return fallback;
 const foreground=raw.slice(0,3).map((x,i)=>x*raw[3]+bg[i]*(1-raw[3])),a=luminance(foreground),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 return ratio>=4.5?value:fallback;
}
export function readableSourceStyle(style={},role='body',background='#ffffff'){
 const limits={body:[16,26,20,1.35,1.9],heading:[22,48,28,1.15,1.6],headline:[28,72,46,1.08,1.5],standfirst:[20,30,24,1.3,1.8]};
 const [minimum,maximum,fallback,minLine,maxLine]=limits[role]||limits.body;
 const size=px(style.fontSize,fallback),fontSize=size>=minimum&&size<=maximum?size:fallback;
 const line=px(style.lineHeight,fontSize*1.5),lineHeight=Math.min(fontSize*maxLine,Math.max(fontSize*minLine,line));
 return {...style,color:readableColor(style.color,background),fontSize:fontSize+'px',lineHeight:Math.round(lineHeight*100)/100+'px',...(role==='body'?{letterSpacing:'0px',marginBottom:Math.max(16,Math.min(40,px(style.marginBottom,24)))+'px'}:{})};
}
export function sanitizePublicCapturePresentation(capture){
 if(capture?.presentation?.method!=='public-url'||capture?.diagnostics?.libraryTextEdition)return capture;
 const result=structuredClone(capture);
 const paper=result.design?.articleBackground||'#ffffff';
 let roleProfile=null;try{const u=new URL(result.url);if(u.protocol==='https:'&&!u.username&&!u.password)roleProfile=US_PUBLIC_PROFILES[u.hostname.replace(/^www\./,'')];}catch{}
 const bodyRole=roleProfile?.bodyStyle||{},headlineRole=roleProfile?.headlineStyle||{};
 result.design={...result.design,bodyStyle:readableSourceStyle({...result.design?.bodyStyle,...bodyRole},'body',paper),headlineStyle:readableSourceStyle({...result.design?.headlineStyle,...headlineRole},'headline',paper),standfirstStyle:readableSourceStyle(result.design?.standfirstStyle,'standfirst',paper)};
 result.blocks=(result.blocks||[]).map(block=>['paragraph','quote','heading'].includes(block.type)?{...block,style:readableSourceStyle({...block.style,...(block.type==='heading'?{}:bodyRole)},block.type==='heading'?'heading':'body',paper)}:block);
 return result;
}
