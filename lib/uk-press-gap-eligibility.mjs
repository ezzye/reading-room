// Proposed Express override, not registered by this module.
// A 2026-10-18 ordinary rendered comparison showed that p402_premium is also
// present around a fully visible .regular article. It is not an access grant.
// The caller must supply the importer's visibility and source-style functions.
export const EXPRESS_REGULAR_BODY = '#singleArticle.single-article.article-body.regular > article#article-body';
const failure = () => { throw Error('The source does not establish a substantive, visible public Express article. Use a reviewed capture of the readable original.'); };
const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
const subscriptionPrompt = /subscribe to (?:read|continue)|unlock (?:this|the) article|already a subscriber|this (?:article|content) is (?:only )?for subscribers|sign in to (?:read|continue)|(?:reached|used) (?:the |your )?free (?:article )?limit/i;

function subscriptionOnly(document) {
  const inspect = value => {
    if (Array.isArray(value)) return value.some(inspect);
    if (!value || typeof value !== 'object') return false;
    if (value.isAccessibleForFree === false || typeof value.isAccessibleForFree === 'string' && value.isAccessibleForFree.trim().toLowerCase() === 'false') return true;
    return Object.values(value).some(child => child && typeof child === 'object' && inspect(child));
  };
  for (const element of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { if (inspect(JSON.parse(element.textContent))) return true; }
    catch { /* Broken metadata does not become proof of free access. */ }
  }
  return false;
}

function constrained(element, styles) {
  for (let node = element; node?.getAttribute; node = node.parentElement) {
    const style = styles(node) || {};
    const clamp = style['-webkit-line-clamp'] || style['line-clamp'];
    if (clamp && !/^(?:none|unset|initial|0)$/i.test(String(clamp))) return true;
    if (/blur\(/i.test(style.filter || '') || /ellipsis/i.test(style['text-overflow'] || '')) return true;
    if (style['clip-path'] && style['clip-path'] !== 'none') return true;
    const overflow = [style.overflow, style['overflow-y']].filter(Boolean).join(' ');
    const bounded = [style.height, style['max-height']].some(value => value && !/^(?:none|auto|unset|initial)$/i.test(String(value)));
    if (/\b(?:hidden|clip)\b/i.test(overflow) && bounded) return true;
  }
  return false;
}

export function assertExpressPublicEligibility(document, {isHidden, styles} = {}) {
  // A structural class alone must never waive the current conservative guard.
  if (!document?.querySelectorAll || typeof isHidden !== 'function' || typeof styles !== 'function') failure();
  if (subscriptionOnly(document)) failure();
  const wrappers = [...document.querySelectorAll('#singleArticle')];
  if (wrappers.length !== 1) failure();
  const wrapper = wrappers[0];
  if (!wrapper.matches('.single-article.article-body.regular') || wrapper.matches('.premium,.is-premium,[data-premium="true"],[data-access-level="subscriber"]')) failure();
  const roots = [...document.querySelectorAll(EXPRESS_REGULAR_BODY)];
  if (roots.length !== 1 || isHidden(wrapper) || isHidden(roots[0]) || constrained(roots[0], styles)) failure();
  // Reject an actually visible gate, including one outside the article wrapper.
  for (const element of document.querySelectorAll('[id],[class]')) {
    const identity = `${element.id || ''} ${element.getAttribute('class') || ''}`;
    if (/(?:paywall|article[-_]?gate|subscription[-_](?:content|overlay|gate|wall)|subscribe[-_](?:overlay|gate|wall)|p402[-_]overlay)/i.test(identity) && !isHidden(element)) failure();
  }
  const root = roots[0], paragraphs = [...root.querySelectorAll('p')].filter(node => !isHidden(node));
  if (paragraphs.some(node => constrained(node, styles))) failure();
  const visibleText = paragraphs.map(text).filter(Boolean);
  const visibleRoot = root.cloneNode(true), originals = [...root.querySelectorAll('*')], copies = [...visibleRoot.querySelectorAll('*')];
  for (let index = 0; index < originals.length; index++) {
    if (isHidden(originals[index]) || originals[index].matches('script,style,noscript,template,nav,footer,aside,form,button')) copies[index].remove();
  }
  if (subscriptionPrompt.test(text(visibleRoot))) failure();
  const wordCount = visibleText.join(' ').split(/\s+/).filter(Boolean).length;
  if (visibleText.filter(value => value.length >= 30).length < 3 || wordCount < 160) failure();
  return {bodySelector: EXPRESS_REGULAR_BODY, paragraphCount: visibleText.length, wordCount, accessEvidence: 'explicit-regular-body-visible-without-subscription-metadata-or-gate'};
}

export const UK_PRESS_GAP_PROFILES = {
  'express.co.uk': {
    name: 'Daily Express', color: '#194c83', serif: 'Georgia, serif',
    body: EXPRESS_REGULAR_BODY, strictBody: true, excludeSelector: '.newsletter-pure', extractorRevision:3,
    // Keep old importers fail-closed. Integration must invoke publicEligibility
    // with visibility/style evidence before allowing this generic marker.
    gatedSelector: '.p402_premium',
    publicEligibility: assertExpressPublicEligibility
  }
};
