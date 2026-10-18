// NPR is a US news-site comparator, not a newspaper. Two ordinary public
// article responses observed on 18 October 2026 used this exact visible root.
// No new US newspaper profile was justified: observed newspaper requests were
// refused or explicitly subscription-only. Existing NYT support is unchanged.
// Named typography follows an owner-observed public rendering. Font binaries
// are not supplied; named faces fall back to the listed device fonts.
export function nprImageMetadata(img) {
  const wrapper=img.closest('.bucketwrap.image');
  if(!wrapper||wrapper.matches('.internallink'))return {};
  const node=wrapper.querySelector('.credit-caption .caption p')?.cloneNode(true);
  for(const control of node?.querySelectorAll('.credit,.hide-caption,button,.toggle-caption')||[])control.remove();
  const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
  return {caption:text(node),credit:text(wrapper.querySelector('.credit-caption > .credit, .credit-caption .caption .credit'))};
}
export const US_PUBLIC_PROFILES = Object.freeze({
  'npr.org': Object.freeze({
    name: 'NPR',
    color: '#17332f',
    serif: 'Georgia, serif',
    body: '#storytext.storytext',
    strictBody: true,
    excludeSelector: '.bucketwrap.internallink',
    mediaCaptionSelector: '.bucketwrap.image .credit-caption',
    imageMetadata: nprImageMetadata,
    extractorRevision: 4,
    headlineStyle: Object.freeze({fontFamily:'NPRSans, Helvetica, Arial, sans-serif',fontSize:'32px',lineHeight:'40px',fontWeight:'700'}),
    bodyStyle: Object.freeze({fontFamily:'NPRSerif, Georgia, serif',fontSize:'18px',lineHeight:'27px'}),
  }),
});
