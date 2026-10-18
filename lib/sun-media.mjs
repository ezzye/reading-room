import {mediaURL} from './capture-core.mjs';
export const SUN_IMAGE_REVISION=3;

export function isBrokenSunImageURL(raw,articleURL){
 try{
  const article=new URL(articleURL),image=new URL(raw),host=article.hostname.replace(/^www\./,'');
  if(host!=='thesun.co.uk'||article.protocol!=='https:'||image.protocol!=='https:'||image.username||image.password||image.port||image.hostname.replace(/^www\./,'')!==host||image.search||image.hash)return false;
  const path=article.pathname.replace(/\/+$/,''),parent=path.slice(0,path.lastIndexOf('/'));
  return [path+'/',parent+'/'].some(prefix=>image.pathname.startsWith(prefix)&&/^\d{1,5}&quality=\d{1,3}&strip=all$/.test(image.pathname.slice(prefix.length)));
 }catch{return false;}
}
export function needsSunImageRepair(capture){return capture?.presentation?.method==='public-url'&&capture?.diagnostics?.libraryTextEdition!==true&&Array.isArray(capture.blocks)&&capture.blocks.some(block=>block.type==='figure'&&isBrokenSunImageURL(block.url,capture.url));}
export function validSunPublisherImage(raw){try{const url=new URL(raw);return url.hostname.replace(/^www\./,'')==='thesun.co.uk'&&url.pathname.startsWith('/wp-content/uploads/')&&/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)&&mediaURL(raw)===raw;}catch{return false;}}

// Sun article markup supplies a usable image URL directly on the img. Its
// WordPress srcset URLs also contain literal commas in resize=width,height,
// so splitting srcset on every comma corrupts those URLs into page links.
function imageURL(raw,base){
 if(typeof raw!=='string'||!raw.trim()||/[\u0000-\u0020]/.test(raw.trim()))return '';
 try{const url=new URL(raw.trim(),base);if(!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname))return '';return mediaURL(url.href);}catch{return '';}
}

export function sunImageURL(image,base){
 for(const name of ['data-src','data-original','src']){const direct=imageURL(image.getAttribute(name),base);if(direct)return direct;}
 const source=image.getAttribute('srcset')||image.getAttribute('data-srcset')||'';
 const valid=[];
 // A candidate ends after its width/density descriptor. Literal commas inside
 // its URL are retained, including resize=width,height query values.
 for(const match of source.matchAll(/(?:^|,\s*)(\S+)\s+(\d+(?:\.\d+)?)([wx])(?=\s*(?:,|$))/gi)){
  const url=imageURL(match[1],base);if(url)valid.push({url,width:match[3].toLowerCase()==='w'?Number(match[2]):0});
 }
 if(!valid.length){const single=imageURL(source.trim(),base);if(single)return single;}
 // The direct img source is preferred. This fallback uses only a URL actually
 // supplied in srcset, without rewriting its resize query or fetch destination.
 return valid.filter(candidate=>candidate.width<=1600).sort((a,b)=>b.width-a.width)[0]?.url||valid[0]?.url||'';
}
