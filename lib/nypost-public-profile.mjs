// Two ordinary New York Post article responses observed 19 October 2026.
// Only this visible, explicitly non-exclusive structure is registered.
export const NYPOST_BODY='article.single.single--article.single--exclusive-article-disabled .single__content.entry-content';
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const refuse=()=>{throw Error('The source does not establish a complete, visible public New York Post article. Use a reviewed capture of the readable original.');};
const prompt=/subscribe to (?:read|continue)|unlock (?:this|the) article|already a subscriber|this (?:article|content) is (?:only )?for subscribers|sign in to (?:read|continue)|(?:reached|used) (?:the |your )?free (?:article )?limit/i;
function constrained(node,styles){for(let n=node;n?.getAttribute;n=n.parentElement){const s=styles(n)||{},clamp=s['-webkit-line-clamp']||s['line-clamp'];if(clamp&&!/^(?:none|unset|initial|0)$/i.test(clamp)||/blur\(/i.test(s.filter||'')||s['clip-path']&&s['clip-path']!=='none'||/ellipsis/i.test(s['text-overflow']||'')||/hidden|clip/.test([s.overflow,s['overflow-y']].join(' '))&&[s.height,s['max-height']].some(value=>value&&!/^(?:auto|none|unset|initial)$/i.test(value)))return true;}return false;}
export function assertNYPostPublicEligibility(document,{isHidden,styles}={}){
 if(typeof isHidden!=='function'||typeof styles!=='function')refuse();
 const roots=[...document.querySelectorAll(NYPOST_BODY)],articles=[...document.querySelectorAll('article.single.single--article')];if(roots.length!==1||articles.length!==1)refuse();
 const root=roots[0],article=articles[0],h1=article.querySelector('.article-header h1');
 if(!article.matches('.single--exclusive-article-disabled')||article.matches('.single--exclusive-article,[data-paywall="true"],[data-access-level="subscriber"]')||article.querySelector('.entry-content-exclusive-covered,.entry-content-exclusive,.paywall,[data-testid="paywall"],[data-paywall="true"]')||isHidden(root)||!h1||isHidden(h1)||!text(h1)||constrained(root,styles))refuse();
 const paragraphs=[...root.querySelectorAll('p')].filter(node=>!isHidden(node)&&!node.closest('figcaption'));
 if(paragraphs.length<5||paragraphs.some(node=>constrained(node,styles))||paragraphs.reduce((count,node)=>count+text(node).split(/\s+/).filter(Boolean).length,0)<160||prompt.test(text(root)))refuse();
}
export function nypostImageMetadata(img){const figure=img.closest('figure.wp-block-image');if(!figure)return {};const caption=figure.querySelector('figcaption')?.cloneNode(true);for(const node of caption?.querySelectorAll('.credit,button,[hidden],[aria-hidden="true"]')||[])node.remove();return {caption:text(caption),credit:text(figure.querySelector('figcaption .credit'))};}
// Source CSS declarations are evidence, not rendered measurements. No stylesheet
// URL or font file is fetched; only typography and width declarations survive.
export function nypostSourceStyleMetadata(document,{root,h1,styles}={}){
 const css=[...document.querySelectorAll('style')].map(node=>node.textContent).join('\n').slice(0,1500000),variables={};for(const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g))variables[match[1]]=match[2].trim();
 const fontVariables=Object.entries(variables).filter(([key,value])=>/font/.test(key)&&/family|default$|accent$|headline|body-content-size|body-size/.test(key)&&value.length<240&&!/url\(|[<>]/i.test(value)).slice(0,16).map(([name,value])=>({name,value}));
 const targets=[root,h1];for(let node=root?.parentElement;node&&targets.length<8;node=node.parentElement)targets.push(node);const columnWidthDeclarations=[];
 for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(columnWidthDeclarations.length>=12)break;const selector=match[1].trim();if(selector.length>500||selector.startsWith('@')||/::/.test(selector))continue;let matches=false;for(const part of selector.split(','))try{if(targets.some(node=>node?.matches(part.trim())))matches=true;}catch{}if(!matches)continue;for(const declaration of match[2].split(';')){const at=declaration.indexOf(':'),property=declaration.slice(0,at).trim(),value=declaration.slice(at+1).trim();if(at>0&&['width','max-width','grid-template-columns'].includes(property)&&value.length<240&&!/url\(|[<>]/i.test(value))columnWidthDeclarations.push({selector:selector.slice(0,240),property,value});if(columnWidthDeclarations.length>=12)break;}}
 const first=[...(root?.querySelectorAll('p')||[])][0];return {basis:'embedded-css-declarations-only',renderedMeasurement:false,fontFilesBundled:false,bodyFontFamily:styles?.(first)?.['font-family']||'',headlineFontFamily:styles?.(h1)?.['font-family']||'',fontVariables,columnWidthDeclarations};
}
export const NYPOST_PUBLIC_PROFILE=Object.freeze({name:'New York Post',color:'#c00',serif:'Arial, sans-serif',body:NYPOST_BODY,strictBody:true,titleSelector:'article.single.single--article .article-header h1',bylineSelector:'article.single.single--article .article-header .byline',publicEligibility:assertNYPostPublicEligibility,imageMetadata:nypostImageMetadata,sourceParagraphTypography:true,sourceStyleMetadata:nypostSourceStyleMetadata,extractorRevision:1});
