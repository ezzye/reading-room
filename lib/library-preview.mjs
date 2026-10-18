import {parseHTML} from 'linkedom/worker';
import {mediaURL} from './capture-core.mjs';
import {publicMediaDescriptor,libraryPublicPreview} from './library-public-media.mjs';

// Only public metadata from the same article can enrich a library text edition.
// A cover image is not evidence that publisher body text or video was retrieved.
export function addLibraryPreview(capture,source){
 if(!source?.html||!source?.url||capture.blocks.some(b=>b.type==='figure'))return capture;
 try{
  if(publicMediaDescriptor(capture.url).mode==='library-public-metadata'){
   const preview=libraryPublicPreview(capture,source);
   return preview.state==='available'&&preview.blocks.length?{...capture,blocks:[...preview.blocks,...capture.blocks]}:capture;
  }
  const expected=new URL(capture.url),actual=new URL(source.url);
  const host=u=>u.hostname.replace(/^www\./,'');
  if(host(expected)!==host(actual)||expected.pathname!==actual.pathname)return capture;
  const {document}=parseHTML(source.html),meta=selector=>document.querySelector(selector)?.getAttribute('content')||'';
  const title=meta('meta[property="og:title"]')||document.querySelector('h1')?.textContent||'';
  const normalize=s=>s.toLowerCase().replace(/\s*[-|]\s*the (?:sunday )?times.*$/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const a=normalize(capture.title),b=normalize(title);
  if(b.length<15||!(a===b||a.startsWith(b+' ')||b.startsWith(a+' ')))return capture;
  const url=mediaURL(meta('meta[property="og:image"]')||meta('meta[name="twitter:image"]'));if(!url)return capture;
  const caption=(meta('meta[property="og:image:alt"]')||'Publisher preview image').slice(0,500);
  return {...capture,blocks:[{id:'preview-image',type:'figure',url,caption,credit:capture.publisher+' · public article preview',style:{},rect:{width:660,height:370}},...capture.blocks]};
 }catch{return capture;}
}
