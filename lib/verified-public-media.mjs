import {articleIdentity} from './article-media.mjs';
import {mediaURL} from './capture-core.mjs';

export const VERIFIED_PUBLIC_MEDIA_REVISION=1;
const articleURL='https://www.telegraph.co.uk/world-news/2026/10/17/students-tear-gassed-hit-batons-france-braces-mass-protests/';
const headline='Historic clock tower falls as France burns on day of violent protests';
const imageURL='https://cf.eip.telegraph.co.uk/store/vid-media/63855445-e30c-46e3-8cb9-5bf8c8df7b8d/thumbnail.jpg';
const queryURL='https://www.google.com/search?q=%22Historic+clock+tower+falls%22+Telegraph&udm=2';
const normalize=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim():'';

// One manually observed public Google Images result, recorded on 18 October
// 2026: its displayed, loaded publisher thumbnail linked this exact article.
// This is a fixed evidence catalogue, not a Google Images lookup or API.
export function verifiedPublicMedia(capture,sourceURL=capture?.url){
 const title=typeof capture?.title==='string'?capture.title.split(/\s+-\s+/)[0]:'';
 const matched=articleIdentity(capture?.url)===articleIdentity(articleURL)&&articleIdentity(sourceURL)===articleIdentity(articleURL)&&normalize(title)===normalize(headline);
 if(!matched)return {matched:false,blocks:[],receipts:[]};
 if((capture.blocks||[]).some(block=>block.type==='figure'&&mediaURL(block.url)===imageURL))return {matched:true,blocks:[],receipts:[]};
 const provenance={sourceURL:articleURL,basis:'exact-article-public-index-thumbnail',placement:'approximate',originalPlacementVerified:false,observedAt:'2026-10-18',indexURL:queryURL,indexDisplayTitle:'France protests: Historic clock tower in Limoges falls',catalogueRevision:VERIFIED_PUBLIC_MEDIA_REVISION};
 const block={id:'verified-telegraph-limoges-thumbnail-20261018',type:'figure',url:imageURL,caption:'Limoges clock-tower fire — publisher video thumbnail',credit:'The Telegraph · video thumbnail · found through Google Images; original position not verified',style:{},rect:{x:0,y:0,width:660,height:371},...provenance};
 return {matched:true,blocks:[block],receipts:[{id:block.id,type:block.type,url:imageURL,...provenance}]};
}
export function hasMissingVerifiedPublicMedia(capture,sourceURL=capture?.url){return verifiedPublicMedia(capture,sourceURL).blocks.length>0;}
