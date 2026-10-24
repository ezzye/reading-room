import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseHTML} from 'linkedom/worker';
import {normalizeCapture,mediaURL,videoEmbed} from './capture-core.mjs';
import {sourceURL,words} from './education-core.mjs';

export const VOX_FEED_URL='https://www.vox.com/rss/index.xml';
const ATOM='http://www.w3.org/2005/Atom';
const MAX_BYTES=1_000_000,MAX_ENTRIES=30;
const USER_AGENT='ReadEveryThing/1.0 (public article reader)';
const blockedSelectors='script,style,noscript,template,head,form,nav,aside,button,footer,header,[hidden],[inert],[aria-hidden="true"],[role="dialog"],[class*="related" i],[id*="related" i],[class*="recommend" i],[class*="newsletter" i],[class*="promo" i],[class*="paywall" i],[data-access="paid"],[class*="author-avatar" i],[class*="avatar" i],[class*="byline" i],[class*="author" i],[class*="social" i],[class*="share" i],[class*="advert" i],[class*="tracking" i],[class*="footer" i]';
const REFUSAL='Vox could not match a complete readable story in its public feed. Try again or choose another public Vox story.';
const refused=()=>new Error(REFUSAL);
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const list=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const plain=value=>typeof value==='string'?value:typeof value?.['#cdata']==='string'?value['#cdata']:typeof value?.['#text']==='string'?value['#text']:'';
const atomParser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',cdataPropName:'#cdata',textNodeName:'#text',trimValues:false,processEntities:true});
const orderedParser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',preserveOrder:true,cdataPropName:'#cdata',textNodeName:'#text',trimValues:false,processEntities:true});

function publicVoxURL(raw){
 if(typeof raw!=='string'||raw.length>2048)throw refused();
 let parsed,cleaned;
 try{parsed=new URL(raw);cleaned=sourceURL(raw);}catch{throw refused();}
 if(parsed.protocol!=='https:'||!['vox.com','www.vox.com'].includes(parsed.hostname.toLowerCase())||parsed.username||parsed.password||parsed.port)throw refused();
 if([...parsed.searchParams.keys()].some(key=>!/^utm_[\w-]+$/i.test(key)&&!['fbclid','gclid'].includes(key.toLowerCase())))throw refused();
 return cleaned;
}
function canonicalArticle(raw){
 try{
  const url=new URL(raw);
  if(url.protocol!=='https:'||!['vox.com','www.vox.com'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port) return '';
  if([...url.searchParams.keys()].some(key=>!/^utm_[\w-]+$/i.test(key)&&!['fbclid','gclid'].includes(key.toLowerCase())))return '';
  return url.pathname.replace(/\/+$/,'')||'/';
 }catch{return '';}
}
function xmlSafely(xml){
 if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw refused();
 const outsideCdata=xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,'');
 for(const match of outsideCdata.matchAll(/&([A-Za-z][\w.-]*);/g))if(!['amp','lt','gt','quot','apos'].includes(match[1]))throw refused();
 const valid=XMLValidator.validate(xml,{allowBooleanAttributes:false});if(valid!==true)throw refused();
 let parsed;try{parsed=atomParser.parse(xml);}catch{throw refused();}
 const feed=parsed?.feed;
 if(!feed||feed['@_xmlns']!==ATOM||plain(feed.id)!==VOX_FEED_URL||textHTML(plain(feed.title))!=='Vox')throw refused();
 const self=list(feed.link).filter(link=>link?.['@_rel']==='self'&&link?.['@_type']==='application/atom+xml'&&link?.['@_href']===VOX_FEED_URL);
 if(self.length!==1)throw refused();
 const entries=list(feed.entry);if(!entries.length||entries.length>MAX_ENTRIES)throw refused();
 const orderedRoot=orderedParser.parse(xml),orderedFeed=orderedRoot.find(node=>node?.feed)?.feed||[],orderedEntries=orderedFeed.filter(node=>node?.entry).map(node=>node.entry);
 if(orderedEntries.length!==entries.length)throw refused();
 return {entries,orderedEntries};
}
function orderedHTML(nodes){
 const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 return nodes.map(node=>{
  if(!node||typeof node!=='object')return '';
  if(typeof node['#text']==='string')return escape(node['#text']);
  if(typeof node['#cdata']==='string')return escape(node['#cdata']);
  let output='';
  for(const [tag,children] of Object.entries(node)){
   if(tag===':@'||tag.startsWith('#'))continue;
   const attrs=node[':@']||{},serialized=Object.entries(attrs).filter(([name])=>name.startsWith('@_')).map(([name,value])=>' '+name.slice(2)+'="'+escape(value)+'"').join('');
   output+='<'+tag+serialized+'>'+(voidTags.has(tag.toLowerCase())?'':orderedHTML(Array.isArray(children)?children:[]))+(voidTags.has(tag.toLowerCase())?'':'</'+tag+'>');
  }
  return output;
 }).join('');
}
function orderedChild(entry,name){return entry.find(node=>Object.hasOwn(node||{},name))?.[name]||[];}
function htmlContent(entry,orderedEntry){
 const content=entry?.content,type=content?.['@_type'];
 if(!content||!['html','xhtml'].includes(type))throw refused();
 if(type==='html')return plain(content);
 const orderedContent=orderedChild(orderedEntry,'content');
 return orderedHTML(orderedContent);
}
function textHTML(value){
 const {document}=parseHTML('<!doctype html><div id="vox-title">'+String(value||'')+'</div>');
 const root=document.querySelector('#vox-title');
 for(const node of root?.querySelectorAll('script,style,template')||[])node.remove();
 return text(root);
}
function isExcluded(node){
 for(let parent=node;parent?.getAttribute;parent=parent.parentElement){
  if(parent.matches(blockedSelectors))return true;
  const style=parent.getAttribute('style')||'';
  if(/display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|content-visibility\s*:\s*hidden|filter\s*:[^;]*blur\(/i.test(style))return true;
 }
 return false;
}
const prompt=/subscribe to (?:read|continue|access)|unlock (?:this|the) (?:article|story)|sign in to (?:read|continue)|continue reading|keep reading|free preview|preview only|members-only|subscriber-only|already a subscriber|this (?:article|story|content) is (?:only )?for subscribers/i;
function safeImageURL(img){
 const direct=img.getAttribute('src')||img.getAttribute('data-src')||img.getAttribute('data-original')||'';
 if(direct)return mediaURL(direct);
 const srcset=img.getAttribute('srcset')||img.getAttribute('data-srcset')||'';
 for(const candidate of srcset.split(',').map(value=>value.trim()).reverse()){
  const url=candidate.split(/\s+/)[0];if(url&&mediaURL(url))return mediaURL(url);
 }
 return '';
}
function imageBlock(figure,img){
 const captionNode=figure.querySelector('figcaption'),cite=captionNode?.querySelector('cite,[class*="credit" i],[class*="copyright" i]');
 const credit=text(cite)||text({textContent:img.getAttribute('data-portal-copyright')||img.getAttribute('data-credit')||''});
 const caption=text(captionNode)||img.getAttribute('data-caption')||img.getAttribute('alt')||'';
 return {type:'figure',url:safeImageURL(img),caption,credit};
}
function listItemText(node){
 const copy=node.cloneNode(true);for(const nested of copy.querySelectorAll('ol,ul'))nested.remove();return text(copy);
}
function listPrefix(node){
 const parent=node.parentElement;if(parent?.tagName!=='OL')return '• ';
 const items=[...parent.children].filter(child=>child.tagName==='LI'),reversed=parent.hasAttribute('reversed'),step=reversed?-1:1;
 const explicitStart=Number.parseInt(parent.getAttribute('start')||'',10),start=Number.isFinite(explicitStart)?explicitStart:reversed?items.length:1;
 let number=start;
 for(const item of items){const explicit=Number.parseInt(item.getAttribute('value')||'',10);if(Number.isFinite(explicit))number=explicit;if(item===node)return number+'. ';number+=step;}
 return start+'. ';
}
function extractBlocks(html){
 const {document}=parseHTML('<!doctype html><html><body>'+html+'</body></html>'),body=document.body;
 if(body.querySelector('[data-access="paid"],[class*="paywall" i],[class*="premium-content" i]'))throw refused();
 for(const node of body.querySelectorAll('p,h2,h3,h4,blockquote,li'))if(!isExcluded(node)&&prompt.test(node.tagName==='LI'?listItemText(node):text(node)))throw refused();
 for(const node of [...body.querySelectorAll(blockedSelectors)])node.remove();
 const blocks=[],seen=new Set();
 const add=block=>{if(!block||!block.text&&!block.url)return;const key=block.type+':'+(block.url||block.text);if(seen.has(key))return;seen.add(key);blocks.push(block);};
 for(const node of body.querySelectorAll('p,h2,h3,h4,blockquote,li,figure,img,video,iframe')){
  if(isExcluded(node)||node.closest('figcaption'))continue;
  if(node.matches('p,h2,h3,h4,blockquote')){
   if(node.closest('blockquote')&&node.tagName!=='BLOCKQUOTE'||node.closest('figure')||node.closest('li'))continue;
   const value=text(node);if(!value||prompt.test(value))continue;
   add({type:/^H[234]$/.test(node.tagName)?'heading':node.tagName==='BLOCKQUOTE'?'quote':'paragraph',text:value,level:2});continue;
  }
  if(node.tagName==='LI'){
   const value=listItemText(node);if(!value)continue;
   add({type:'paragraph',text:listPrefix(node)+value,level:2});continue;
  }
  if(node.tagName==='FIGURE'){
   const img=node.querySelector('img');
   if(img){const block=imageBlock(node,img);if(block.url)add(block);continue;}
   const frame=node.querySelector('iframe,video,source,a[href]');
   if(frame){const url=videoEmbed(frame.getAttribute('src')||frame.getAttribute('href')||'');if(url)add({type:'video',url,caption:text(node.querySelector('figcaption'))||'Original article video'});}
   continue;
  }
  if(node.tagName==='IMG'){
   if(node.closest('figure')||/avatar|logo|icon|pixel/i.test(node.getAttribute('class')||''))continue;
   const block=imageBlock(node.parentElement?.tagName==='PICTURE'?node.parentElement:node,node);if(block.url)add(block);continue;
  }
  if(node.tagName==='VIDEO'||node.tagName==='IFRAME'){
   const source=node.getAttribute('src')||node.querySelector('source')?.getAttribute('src')||'';
   const url=videoEmbed(source);if(url)add({type:'video',url,caption:node.getAttribute('title')||'Original article video'});
  }
 }
 const prose=blocks.filter(block=>['paragraph','quote'].includes(block.type)).map(block=>block.text);
 if(prose.length<3||words(prose.join(' ')).length<160||prose.some(value=>prompt.test(value)))throw refused();
 return blocks;
}
function entryMatch(entry,path){
 const matches=list(entry.link).filter(link=>link?.['@_rel']==='alternate'&&link?.['@_type']==='text/html'&&canonicalArticle(link?.['@_href'])===path);
 return matches.length;
}
function captureFromEntry(entry,orderedEntry,raw){
 const title=textHTML(plain(entry.title));if(!title||prompt.test(title))throw refused();
 const blocks=extractBlocks(htmlContent(entry,orderedEntry));
 const authors=list(entry.author).map(author=>textHTML(plain(author?.name))).filter(Boolean);
 const date=plain(entry.published)||plain(entry.updated);
 const url=sourceURL(raw);
 const capture=normalizeCapture({schema:'ret-capture/v1',url,title,publisher:'Vox',byline:[...new Set(authors)].join(', '),date,standfirst:'',capturedAt:new Date().toISOString(),viewport:{width:1440,height:900},articleRect:{width:660},design:{bodyBackground:'#f4f1ed',articleBackground:'#fff',headlineStyle:{fontFamily:'Georgia, serif',fontSize:'46px',fontWeight:'700',lineHeight:'50px'},bodyStyle:{fontFamily:'Georgia, serif',fontSize:'20px',lineHeight:'30px'}},blocks,presentation:{method:'public-feed',extractorRevision:2,brandColor:'#e85d3f',styleEvidence:'publisher-feed',message:'Vox public RSS edition; article markup was supplied in the publisher feed, with approximate Vox styling.'},diagnostics:{}});
 capture.diagnostics.publisherFeedURL=VOX_FEED_URL;
 return capture;
}

async function boundedBody(response){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES){try{await response.body?.cancel();}catch{}throw refused();}
 if(!response.body)throw refused();
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)throw refused();parts.push(part.value);}}
 finally{try{await reader.cancel();}catch{}}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function fetchVoxFeedCapture(raw,fetcher=fetch){
 const publicURL=publicVoxURL(raw),path=canonicalArticle(publicURL);
 if(typeof fetcher!=='function')throw refused();
 let response;
 try{response=await fetcher(VOX_FEED_URL,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/atom+xml, application/xml, text/xml','User-Agent':USER_AGENT},signal:AbortSignal.timeout(18_000)});}
 catch{throw new Error('Vox public feed is temporarily unavailable. Try again or choose another public story.');}
 if(response.status!==200){try{await response.body?.cancel();}catch{}throw new Error('Vox public feed is temporarily unavailable. Try again or choose another public story.');}
 if(!/^(?:application\/(?:atom\+)?xml|text\/xml)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){try{await response.body?.cancel();}catch{}throw refused();}
 let xml;try{xml=await boundedBody(response);}catch(error){if(error instanceof Error&&error.message===REFUSAL)throw error;throw refused();}
 const {entries,orderedEntries}=xmlSafely(xml);let match=null,orderedMatch=null,count=0;
 for(let index=0;index<entries.length;index++){const entry=entries[index],matches=entryMatch(entry,path);if(matches>1)throw new Error('The Vox feed contains more than one matching article link. Try again or choose another public story.');if(matches===1){count++;match=entry;orderedMatch=orderedEntries[index];}}
 if(!count)return null;
 if(count!==1)throw new Error('The Vox feed contains duplicate article entries. Try again or choose another public story.');
 return captureFromEntry(match,orderedMatch,publicURL);
}
