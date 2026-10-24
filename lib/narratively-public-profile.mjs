// Narratively's public Substack-style article structure observed 24 October 2026.
export const NARRATIVELY_BODY='.available-content .body.markup';
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const refuse=()=>{throw Error('The source does not establish a complete, visible public Narratively article. Use a reviewed capture of the readable original.');};
const prompt=/subscribe to (?:read|continue|access)|unlock (?:this|the) (?:article|post)|already a subscriber|for paying subscribers|paid subscribers only|sign in to (?:read|continue)|free preview|continue reading with a subscription/i;
function constrained(node,styles){for(let n=node;n?.getAttribute;n=n.parentElement){const s=styles(n)||{},clamp=s['-webkit-line-clamp']||s['line-clamp'];if(clamp&&!/^(?:none|unset|initial|0)$/i.test(clamp)||/blur\(/i.test(s.filter||'')||s['clip-path']&&s['clip-path']!=='none'||/ellipsis/i.test(s['text-overflow']||'')||/hidden|clip/.test([s.overflow,s['overflow-y']].join(' '))&&[s.height,s['max-height']].some(value=>value&&!/^(?:auto|none|unset|initial)$/i.test(value)))return true;}return false;}
export function assertNarrativelyPublicEligibility(document,{isHidden,styles}={}){
 if(typeof isHidden!=='function'||typeof styles!=='function')refuse();
 const roots=[...document.querySelectorAll(NARRATIVELY_BODY)],titles=[...document.querySelectorAll('h1.post-title')];if(roots.length!==1||titles.length!==1)refuse();
 const root=roots[0],title=titles[0],available=root.closest('.available-content');
 if(!available||isHidden(root)||isHidden(title)||!text(title)||root.matches('.paywall,.subscriber-only,[data-paywall="true"],[data-access-level="subscriber"]')||root.querySelector('.paywall,.paywall-overlay,.subscription-required,.subscribe-gate,[data-paywall="true"],[data-access-level="subscriber"]')||constrained(root,styles))refuse();
 const paragraphs=[...root.querySelectorAll('p')].filter(node=>!isHidden(node));
 if(paragraphs.length<3||paragraphs.some(node=>constrained(node,styles))||paragraphs.reduce((count,node)=>count+text(node).split(/\s+/).filter(Boolean).length,0)<160||prompt.test(text(root)))refuse();
}
export function narrativelyImageMetadata(img){const figure=img.closest('figure');if(!figure)return {};const caption=figure.querySelector('figcaption'),credit=caption?.querySelector('cite,.credit,[itemprop="creditText"]');return {caption:text(caption),credit:text(credit)};}
export const NARRATIVELY_PUBLIC_PROFILE=Object.freeze({name:'Narratively',color:'#282828',serif:'Georgia, serif',body:NARRATIVELY_BODY,strictBody:true,preferImageSrc:true,preserveShortParagraphs:true,titleSelector:'h1.post-title',standfirstSelector:'h3.subtitle',dateSelector:'time',publicEligibility:assertNarrativelyPublicEligibility,imageMetadata:narrativelyImageMetadata,extractorRevision:1});
