import {parseHTML} from 'linkedom/worker';
import {extractNewspaper,publisherFor} from './newspaper-core.mjs';
import {mediaURL} from './capture-core.mjs';

export const NPR_CLEANUP_REVISION=1;
const stages=new Set(['saved_edition','public_request','public_response','source_identity','public_extraction','related_boundary','caption_association','retained_comparison','internal']);
const reasons=new Set(['invalid_saved_edition','profile_revision_unavailable','duplicate_block_id','article_root_mismatch','canonical_mismatch','headline_mismatch','public_extraction_refused','related_card_boundary_mismatch','ambiguous_related_block','no_related_blocks_matched','ambiguous_caption','retained_block_count_mismatch','retained_text_mismatch','retained_media_mismatch','retained_order_mismatch','http_denied','http_error','http_redirect','redirect_identity_mismatch','timeout','network_unavailable','unsupported_content_type','response_too_large','empty_response','response_read_failed','unclassified']);
const countKeys=new Set(['savedBlocks','freshBlocks','retainedBlocks','removedBlocks','relatedCards','relatedImageCandidates','matchedRelatedImages','matchedRelatedHeadings','relocatedCaptions','unverifiedAttributions']);
export class SourceCleanupFailure extends Error {
 constructor(stage,reason,details={}){super(reasons.has(reason)?reason:'unclassified');this.diagnostic=Object.freeze({stage:stages.has(stage)?stage:'internal',reason:reasons.has(reason)?reason:'unclassified',...(Number.isInteger(details.httpStatus)&&details.httpStatus>=100&&details.httpStatus<=599?{httpStatus:details.httpStatus}:{}),...Object.fromEntries(Object.entries(details).filter(([key,value])=>countKeys.has(key)&&Number.isInteger(value)&&value>=0&&value<=700))});}
}
export function sourceCleanupDiagnostic(error){const raw=error instanceof SourceCleanupFailure&&error.diagnostic&&typeof error.diagnostic==='object'?error.diagnostic:{};return {...new SourceCleanupFailure(raw.stage,raw.reason,raw).diagnostic};}
const fail=(stage,reason,details)=>{throw new SourceCleanupFailure(stage,reason,details);};
const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
export function nprCleanupIdentity(raw){try{const url=new URL(raw);if(url.protocol!=='https:'||!['npr.org','www.npr.org'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash||!/^\/\d{4}\/\d{2}\/\d{2}\/nx-s1-\d+\/[a-z0-9-]+\/?$/i.test(url.pathname))return '';return 'npr.org'+url.pathname.replace(/\/$/,'');}catch{return '';}}
function imageCandidates(img,base){
 const urls=new Set(),add=raw=>{try{const url=mediaURL(new URL(raw,base).href);if(url)urls.add(url);}catch{}};
 for(const name of ['src','data-src','data-original'])if(img.getAttribute(name))add(img.getAttribute(name));
 for(const node of [img,...img.closest('picture')?.querySelectorAll('source')||[]])for(const name of ['srcset','data-srcset']){
  const value=node.getAttribute(name)||'';for(const match of value.matchAll(/(?:^|,\s*)(\S+)\s+\d+(?:\.\d+)?[wx](?=\s*(?:,|$))/g))add(match[1]);
 }
 return urls;
}
const signature=block=>JSON.stringify([block.type,clean(block.text),clean(block.url),clean(block.poster),block.level||null]);
export function proposeNPRSourceCleanup(document,html,url){
 const capture=document?.capture,target=nprCleanupIdentity(url),profile=publisherFor(url);
 if(!target||nprCleanupIdentity(capture?.url)!==target||document.kind!=='rendered-capture-v1'||capture?.presentation?.method!=='public-url'||capture?.diagnostics?.libraryTextEdition||!Array.isArray(capture.blocks)||!Array.isArray(document.annotations))fail('saved_edition','invalid_saved_edition');
 if(profile.host!=='npr.org'||!String(profile.excludeSelector||'').split(',').some(selector=>selector.trim()==='.bucketwrap.internallink')||Number(profile.extractorRevision)<4)fail('saved_edition','profile_revision_unavailable');
 const ids=new Set();for(const block of capture.blocks){if(!block?.id||ids.has(block.id))fail('saved_edition','duplicate_block_id');ids.add(block.id);}
 const {document:source}=parseHTML(html),roots=[...source.querySelectorAll('#storytext.storytext')];if(roots.length!==1)fail('source_identity','article_root_mismatch');
 const canonical=[...source.querySelectorAll('link[rel~="canonical"],meta[property="og:url"]')];if(!canonical.length||canonical.some(node=>{try{return nprCleanupIdentity(new URL(node.getAttribute(node.tagName==='LINK'?'href':'content')||'',url).href)!==target;}catch{return true;}}))fail('source_identity','canonical_mismatch');
 // The fixed public extractor enforces ordinary visible article eligibility.
 let fresh;try{fresh=extractNewspaper(html,url);}catch{fail('public_extraction','public_extraction_refused');}if(nprCleanupIdentity(fresh.url)!==target)fail('source_identity','canonical_mismatch');if(!clean(fresh.title)||clean(fresh.title)!==clean(capture.title))fail('source_identity','headline_mismatch');
 const root=roots[0],cards=[...root.querySelectorAll('.bucketwrap.internallink')];if(!cards.length||cards.length>12)fail('related_boundary','related_card_boundary_mismatch');
 const headings=new Set(),images=new Set();for(const card of cards){
  if(card.querySelector('p,blockquote,video,iframe'))fail('related_boundary','related_card_boundary_mismatch');
  for(const heading of card.querySelectorAll('h2,h3,h4'))if(clean(heading.textContent))headings.add(clean(heading.textContent));
  for(const img of card.querySelectorAll('img'))for(const candidate of imageCandidates(img,url))images.add(candidate);
 }
 const removedIds=new Set();for(const block of capture.blocks){
  const candidate=block.type==='heading'&&headings.has(clean(block.text))||block.type==='figure'&&images.has(mediaURL(block.url));if(!candidate)continue;
  if(fresh.blocks.some(next=>signature(next)===signature(block)))fail('related_boundary','ambiguous_related_block');removedIds.add(block.id);
 }
 if(!removedIds.size)fail('related_boundary','no_related_blocks_matched',{relatedCards:cards.length,relatedImageCandidates:images.size});
 // Attribution is copied only from one exact matching retained photo wrapper;
 // source order, image URLs and all prose stay attached to their original IDs.
 const photos=[...root.querySelectorAll('.bucketwrap.image')].filter(node=>!node.closest('.bucketwrap.internallink'));
 const updatedAttributionIds=[],unverifiedAttributionIds=[],relocatedCaptionIds=[],metadataById=new Map();
 const captionTexts=photos.flatMap(wrapper=>[...wrapper.querySelectorAll(':scope > .credit-caption .caption p')].map(node=>clean(node.textContent)));
 for(const block of capture.blocks){
  if(removedIds.has(block.id)||block.type!=='figure')continue;
  const matches=photos.flatMap(wrapper=>[...wrapper.querySelectorAll('img')].filter(img=>imageCandidates(img,url).has(mediaURL(block.url))));
  const sameSaved=capture.blocks.filter(candidate=>candidate.type==='figure'&&mediaURL(candidate.url)===mediaURL(block.url));
  if(matches.length!==1||sameSaved.length!==1||typeof profile.imageMetadata!=='function'){unverifiedAttributionIds.push(block.id);continue;}
  const metadata=profile.imageMetadata(matches[0]),caption=clean(metadata?.caption),credit=clean(metadata?.credit);
  if(!caption||caption.length>1500||!credit||credit.length>500||/[<>]/.test(caption+credit)){unverifiedAttributionIds.push(block.id);continue;}
  metadataById.set(block.id,{caption,credit});
  const paragraphs=[...matches[0].closest('.bucketwrap.image').querySelectorAll(':scope > .credit-caption .caption p')];
  if(paragraphs.length!==1)continue;
  const rawCaption=clean(paragraphs[0].textContent),old=capture.blocks.filter(candidate=>candidate.type==='paragraph'&&clean(candidate.text)===rawCaption);
  if(old.length>1||old.length&&captionTexts.filter(value=>value===rawCaption).length!==1)fail('caption_association','ambiguous_caption');
  if(old.length===1){removedIds.add(old[0].id);relocatedCaptionIds.push(old[0].id);}
 }
 const retained=capture.blocks.filter(block=>!removedIds.has(block.id));
 const counts={savedBlocks:capture.blocks.length,freshBlocks:fresh.blocks.length,retainedBlocks:retained.length,removedBlocks:removedIds.size,relatedCards:cards.length,relatedImageCandidates:images.size,matchedRelatedImages:capture.blocks.filter(block=>block.type==='figure'&&removedIds.has(block.id)).length,matchedRelatedHeadings:capture.blocks.filter(block=>block.type==='heading'&&removedIds.has(block.id)).length,relocatedCaptions:relocatedCaptionIds.length,unverifiedAttributions:unverifiedAttributionIds.length};
 if(retained.length!==fresh.blocks.length)fail('retained_comparison','retained_block_count_mismatch',counts);
 const mismatch=retained.findIndex((block,index)=>signature(block)!==signature(fresh.blocks[index]));
 if(mismatch>=0){const old=retained[mismatch],next=fresh.blocks[mismatch];fail('retained_comparison',old.type!==next.type?'retained_order_mismatch':['figure','video'].includes(old.type)?'retained_media_mismatch':'retained_text_mismatch',counts);}
 const blocks=retained.map(block=>{
  if(block.type!=='figure')return block;
  const metadata=metadataById.get(block.id);if(!metadata)return block;const {caption,credit}=metadata;
  if(caption===clean(block.caption)&&credit===clean(block.credit))return block;
  updatedAttributionIds.push(block.id);return {...block,caption,credit};
 });
 return {blocks,removedIds,annotations:document.annotations.filter(annotation=>!removedIds.has(annotation.blockId)),extractorRevision:Number(profile.extractorRevision),basis:'exact-public-url-canonical-and-headline; observed-related-card-headings-and-image-urls; exact-source-photo-caption-relocation; every-retained-block-matched-in-order',updatedAttributionIds,unverifiedAttributionIds,relocatedCaptionIds};
}
