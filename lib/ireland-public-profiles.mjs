// Republic of Ireland public profile proposal, observed 18 October 2026.
// Register only with the publicEligibility hook; no paid body is a fallback.
export const IRISH_INDEPENDENT_BODY = 'article section[data-testid="article-body"]';
const fail = () => { throw Error('The Irish Independent page does not establish substantive, visible public article access. Use a reviewed capture of the readable original.'); };
const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
const prompt = /subscribe to (?:read|continue)|unlock (?:this|the) article|this (?:article|content) is (?:only )?for subscribers|sign in to (?:read|continue)|(?:reached|used) (?:the |your )?free (?:article )?limit/i;

function accessMetadata(document) {
  const values = [];
  const walk = value => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if (value.isAccessibleForFree !== undefined) values.push(value.isAccessibleForFree);
      for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
    }
  };
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(node.textContent)); } catch { /* No inferred access. */ }
  }
  return values;
}
function clipped(element, styles) {
  for (let node = element; node?.getAttribute; node = node.parentElement) {
    const style = styles(node) || {}, clamp = style['-webkit-line-clamp'] || style['line-clamp'];
    if (clamp && !/^(?:none|unset|initial|0)$/i.test(String(clamp))) return true;
    if (/blur\(/i.test(style.filter || '') || /ellipsis/i.test(style['text-overflow'] || '')) return true;
    if (style['clip-path'] && style['clip-path'] !== 'none') return true;
    const bounded = [style.height, style['max-height']].some(value => value && !/^(?:none|auto|unset|initial)$/i.test(String(value)));
    if (bounded && /\b(?:hidden|clip)\b/i.test([style.overflow, style['overflow-y']].join(' '))) return true;
  }
  return false;
}
export function assertIrishIndependentPublicEligibility(document, {isHidden, styles} = {}) {
  if (!document?.querySelectorAll || typeof isHidden !== 'function' || typeof styles !== 'function') fail();
  const values = accessMetadata(document), flag = value => typeof value === 'boolean' ? value : typeof value === 'string' && /^(?:true|false)$/i.test(value.trim()) ? /^true$/i.test(value.trim()) : null;
  if (values.some(value => flag(value) === false) || !values.some(value => flag(value) === true)) fail();
  const roots = [...document.querySelectorAll(IRISH_INDEPENDENT_BODY)];
  if (roots.length !== 1 || isHidden(roots[0]) || clipped(roots[0], styles)) fail();
  for (const node of document.querySelectorAll('[id],[class],[data-testid]')) {
    const marker = `${node.id || ''} ${node.getAttribute('class') || ''} ${node.getAttribute('data-testid') || ''}`;
    if (/paywall|article[-_]?gate|subscription[-_](?:overlay|gate|wall)/i.test(marker) && !isHidden(node)) fail();
  }
  const root = roots[0], paragraphs = [...root.querySelectorAll('p')].filter(node => !isHidden(node));
  if (paragraphs.some(node => clipped(node, styles))) fail();
  const copy = root.cloneNode(true), originals = [...root.querySelectorAll('*')], clones = [...copy.querySelectorAll('*')];
  for (let i = 0; i < originals.length; i++) if (isHidden(originals[i]) || originals[i].matches('script,style,noscript,template,nav,footer,aside,form,button')) clones[i].remove();
  if (prompt.test(text(copy))) fail();
  const visible = paragraphs.map(text).filter(Boolean), words = visible.join(' ').split(/\s+/).filter(Boolean).length;
  if (visible.filter(value => value.length >= 30).length < 3 || words < 160) fail();
  return {bodySelector:IRISH_INDEPENDENT_BODY,paragraphCount:visible.length,wordCount:words,accessEvidence:'explicit-public-metadata-and-substantive-visible-body'};
}
export const IRELAND_PUBLIC_PROFILES = {
  'independent.ie': {
    name:'Irish Independent', color:'#174c42', serif:'Georgia, serif',
    body:IRISH_INDEPENDENT_BODY, strictBody:true,
    gatedSelector:'[data-testid*="paywall"]',
    publicEligibility:assertIrishIndependentPublicEligibility
  }
};
