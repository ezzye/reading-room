// Vox public article markup observed 24 October 2026. Eligibility is limited
// to one visible entry body with substantial ordinary article text.
export const VOX_BODY='.duet--layout--entry-body';
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const refuse=()=>{throw Error('The source does not establish a complete, visible public Vox article. Use a reviewed capture of the readable original.');};
const prompt=/subscribe to (?:read|continue)|unlock (?:this|the) article|already a subscriber|this (?:article|content) is (?:only )?for subscribers|sign in to (?:read|continue)|(?:reached|used) (?:the |your )?free (?:article )?limit|subscribe to access/i;
function constrained(node,styles){for(let n=node;n?.getAttribute;n=n.parentElement){const s=styles(n)||{},clamp=s['-webkit-line-clamp']||s['line-clamp'];if(clamp&&!/^(?:none|unset|initial|0)$/i.test(clamp)||/blur\(/i.test(s.filter||'')||s['clip-path']&&s['clip-path']!=='none'||/ellipsis/i.test(s['text-overflow']||'')||/hidden|clip/.test([s.overflow,s['overflow-y']].join(' '))&&[s.height,s['max-height']].some(value=>value&&!/^(?:auto|none|unset|initial)$/i.test(value)))return true;}return false;}
export function assertVoxPublicEligibility(document,{isHidden,styles}={}){
 if(typeof isHidden!=='function'||typeof styles!=='function')refuse();
 const roots=[...document.querySelectorAll(VOX_BODY)],h1s=[...document.querySelectorAll('h1')];if(roots.length!==1||h1s.length!==1)refuse();
 const root=roots[0],components=[...root.querySelectorAll('#zephr-anchor .duet--article--article-body-component')],h1=h1s[0];
 if(isHidden(root)||isHidden(h1)||!text(h1)||components.length<3||components.some(isHidden)||constrained(root,styles)||components.some(node=>constrained(node,styles)))refuse();
 const paragraphs=components.flatMap(node=>[...node.querySelectorAll('p')]).filter(node=>!isHidden(node));
 if(paragraphs.length<5||paragraphs.some(node=>constrained(node,styles))||paragraphs.reduce((count,node)=>count+text(node).split(/\s+/).filter(Boolean).length,0)<160||prompt.test(text(root)))refuse();
}
export function voxImageMetadata(img){const figure=img.closest('.duet--layout--entry-image');if(!figure)return {};const caption=figure.querySelector('.duet--media--caption');return {caption:text(caption),credit:text(caption?.querySelector('cite'))};}
export const VOX_PUBLIC_PROFILE=Object.freeze({name:'Vox',color:'#e85d3f',serif:'Georgia, serif',body:VOX_BODY,strictBody:true,titleSelector:'h1',standfirstSelector:'h1 + p',publicEligibility:assertVoxPublicEligibility,imageMetadata:voxImageMetadata,extractorRevision:1});
