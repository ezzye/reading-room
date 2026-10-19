import {libraryPublication} from './library-publications.mjs';
import {SCOTSMAN_CATALOGUE_NAME} from './newsbank-source-search.mjs';

const excluded='script,style,noscript,template,form,input,select,textarea,button,label[for],iframe,object,embed,.document-view__body--ascii,[hidden],[inert],[aria-hidden="true"]';
const tags=new Set(['DIV','P','SPAN','A','STRONG','B','EM','I','SMALL','CITE','LABEL','UL','OL','LI','DL','DT','DD','H1','H2','H3','H4','SECTION','HEADER','MAIN','BODY','TABLE','TBODY','TR','TD','TH','BR']);
const displayNames=new Set(['The Scotsman','Scotsman, The','Scotsman','Scotland on Sunday']);
const publicLocations=new Set(['Edinburgh, Scotland','Glasgow, Scotland','Aberdeen, Scotland','Dundee, Scotland','Inverness, Scotland','Scotland','London, England','England','Cardiff, Wales','Wales','Belfast, Northern Ireland','Northern Ireland','United Kingdom','UK']);
const safeClass=value=>/^[A-Za-z_-]{1,64}$/.test(value)&&!/[a-z]{32,}|[a-f]{12,}|private|secret|password|passcode|token|cookie|session|borrower|account|credential|authorization|bearer|csrf|nonce|email|login/i.test(value);
function visible(node){for(let parent=node;parent?.getAttribute;parent=parent.parentElement)if(parent.matches(excluded)||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i.test(parent.getAttribute('style')||''))return false;return true;}
const tag=node=>tags.has(node?.tagName)?node.tagName.toLowerCase():'other';
function describe(node,root,meta){const raw=(node.getAttribute('class')||'').split(/\s+/).filter(Boolean),classes=[...new Set(raw.slice(0,16).filter(safeClass))].slice(0,4);return {tag:tag(node),classes,redactedClasses:Math.min(1000,raw.length-classes.length),role:node===meta?'metadata':node===root?'ascii-root':node===root?.parentElement?'document-parent':'other'};}
function qualifiedScotsman(value){const match=value.match(/^(?:(?:The )?Scotsman(?:, The)?|Scotland on Sunday)(?:: Web Edition Articles)? \(([^()]+)\)$/);return Boolean(match&&publicLocations.has(match[1]));}
// Private diagnostic only. These labels and paths never enter source proof,
// aliases, article matching or capture content.
export function bibliographyStructure(root,meta,publisher){
 const policy=libraryPublication(publisher),result={schema:'newsbank-bibliography-structure/v1',rootAncestors:[],metadataChildren:[],labelHits:[],elementsInspected:0,truncated:false};if(!root||!policy)return result;
 for(let node=root.parentElement;node&&result.rootAncestors.length<4;node=node.parentElement)result.rootAncestors.push(describe(node,root,meta));
 if(meta)for(const child of [...meta.children].slice(0,12))result.metadataChildren.push({...describe(child,root,meta),childTags:[...child.children].slice(0,8).map(tag)});
 if(meta?.children.length>12)result.truncated=true;
 const candidates=[],registered=new Set(policy.observedLabels),scan=(container,scope,max)=>{
  const nodes=[container,...container.querySelectorAll('*')];if(nodes.length>max)result.truncated=true;
  for(const node of nodes.slice(0,max)){result.elementsInspected=Math.min(2000,result.elementsInspected+1);if(!visible(node)||node.querySelector(excluded)||!tags.has(node.tagName)||node.tagName==='BODY')continue;
   const label=(node.textContent||'').normalize('NFC').replace(/\s+/g,' ').trim();if(!label||label.length>150)continue;
   const basis=registered.has(label)?'exact-registered-label':publisher==='scotsman'&&displayNames.has(label)?'public-display-name':publisher==='scotsman'&&scope==='ascii'&&label===SCOTSMAN_CATALOGUE_NAME?'catalogue-family-name':publisher==='scotsman'&&scope==='ascii'&&qualifiedScotsman(label)?'qualified-publication-candidate':'';
   if(!basis)continue;candidates.push({node,label,basis,scope});if(candidates.length>=32){result.truncated=true;break;}
  }
 };
 scan(root,'ascii',1000);
 if(root.parentElement)for(const sibling of root.parentElement.children){if(sibling===root||result.elementsInspected>=2000)continue;scan(sibling,'parent-sibling',Math.min(250,2000-result.elementsInspected));}
 const priority={'exact-registered-label':0,'qualified-publication-candidate':1,'catalogue-family-name':2,'public-display-name':3};
 const leaf=candidates.filter(hit=>!candidates.some(other=>other!==hit&&hit.node.contains(other.node)&&hit.label===other.label)&&!(hit.basis==='public-display-name'&&candidates.some(other=>other!==hit&&other.basis!=='public-display-name'&&other.node.contains(hit.node))));
 leaf.sort((a,b)=>priority[a.basis]-priority[b.basis]);if(leaf.length>8)result.truncated=true;
 for(const hit of leaf.slice(0,8)){const ancestors=[];for(let node=hit.node.parentElement;node&&ancestors.length<4;node=node.parentElement){ancestors.push(describe(node,root,meta));if(node===root.parentElement)break;}result.labelHits.push({scope:hit.scope,basis:hit.basis,label:hit.label,node:describe(hit.node,root,meta),ancestors});}
 const size=()=>new TextEncoder().encode(JSON.stringify(result)).byteLength;
 while(size()>8000&&result.labelHits.length){result.labelHits.pop();result.truncated=true;}
 while(size()>8000&&result.metadataChildren.length){result.metadataChildren.pop();result.truncated=true;}
 return result;
}
