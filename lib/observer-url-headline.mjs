const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)?value:'';
const identity=value=>value.normalize('NFC').toLowerCase().replace(/[‘’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** A URL hint must equal the complete ordered source headline. No stemming,
 * fuzzy suffixes, dropped words or rearrangement establish this identity. */
export function observerURLHeadlineMatches(slugWords,recordTitle){
 const requested=plain(slugWords,400),source=plain(recordTitle,600).split(/\s+-\s+/)[0];
 return Boolean(requested&&source&&identity(requested)&&identity(requested)===identity(source));
}
