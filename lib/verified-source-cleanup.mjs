// One manually observed public newsletter boundary, corroborated against the
// saved paragraph by its normalized SHA-256. This is snapshot evidence, not a
// statement that today's publisher response was fetched or remained unchanged.
export const VERIFIED_SOURCE_CLEANUP=Object.freeze({
 sourceURL:'https://www.express.co.uk/showbiz/tv-radio/2258269/strictly-star-forced-leave-bbc-show-immediately',
 headline:'Strictly star forced to leave BBC show immediately as they issue emotional statement',
 paragraphSHA256:'29378162248b808b9d89d26ab053b506a195248fa067fb384145d816963759c4',
 paragraphLength:263,
 observedAt:'2026-10-18T22:03:09.312Z',
 sourceSelector:'#singleArticle.single-article.article-body.regular > article#article-body .newsletter-pure > div.t.cc > p',
 evidence:'express-newsletter-exclusion-evidence/v1'
});
export const normalizeCleanupText=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
function identity(raw){try{const url=new URL(raw);if(url.protocol!=='https:'||!['express.co.uk','www.express.co.uk'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash)return '';return 'express.co.uk'+url.pathname.replace(/\/$/,'');}catch{return '';}}
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
// The optional proof supports isolated synthetic unit tests. The application
// calls this with two arguments; no request field can supply or replace proof.
export async function verifiedSourceCleanup(capture,sourceURL,proof=VERIFIED_SOURCE_CLEANUP){
 const target=identity(proof.sourceURL);
 if(identity(sourceURL)!==target&&identity(capture?.url)!==target)return {known:false};
 if(identity(sourceURL)!==target||identity(capture?.url)!==target||normalizeCleanupText(capture?.title)!==proof.headline||capture?.presentation?.method!=='public-url'||capture?.diagnostics?.libraryTextEdition||!Array.isArray(capture?.blocks))return {known:true};
 const ids=new Set(),matches=[];for(const block of capture.blocks){
  if(typeof block?.id!=='string'||!block.id||ids.has(block.id))return {known:true};ids.add(block.id);
  if(block.type!=='paragraph')continue;const text=normalizeCleanupText(block.text);
  if(text.length===proof.paragraphLength&&await digest(text)===proof.paragraphSHA256)matches.push(block);
 }
 if(matches.length!==1)return {known:true};
 return {known:true,blockId:matches[0].id,proof};
}
