// Pure discovery over supplied public evidence. Never fetches or extracts prose.
import {parseHTML} from 'linkedom/worker';
import {mediaURL, videoEmbed} from './capture-core.mjs';

const clean = (value, max = 1500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const headline = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const resolve = (value, base) => {
  const raw = clean(value, 4096);
  if (!raw) return '';
  try {
    const url = new URL(raw, base);
    // Check before mediaURL strips tracking keys: URLSearchParams iteration is
    // live, so removing one key must not skip a following credential key.
    if ([...url.searchParams.keys()].some(key => /token|auth|session|signature|password|secret|key|credential|expires|policy/i.test(key))) return '';
    return mediaURL(url.href);
  } catch { return ''; }
};
export function articleIdentity(value, base) {
  const safe = resolve(value, base);
  if (!safe) return '';
  const url = new URL(safe);
  return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
}
function sameHeadline(a, b, standfirst) {
  const x = headline(a), y = headline(b), suffix = headline(standfirst);
  if (!x || !y) return false;
  if (x === y) return true;
  // Library headlines may append the standfirst after a separator.
  for (const [short, long] of [[x, y], [y, x]]) {
    if (short.split(' ').length >= 4 && suffix && long === short + ' ' + suffix) return true;
  }
  return false;
}
function stableID(type, url) {
  let hash = 2166136261;
  for (const ch of type + ':' + url) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 'media-' + type + '-' + hash.toString(16).padStart(8, '0');
}
const attr = (node, name) => node?.getAttribute(name) || '';
const badStyle = style => /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|content-visibility\s*:\s*hidden|filter\s*:[^;]*blur\()/i.test(style);
function visibleTest(doc) {
  const hiddenSelectors = [];
  for (const style of doc.querySelectorAll('style')) {
    for (const match of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      if (badStyle(match[2])) hiddenSelectors.push(...match[1].split(',').map(x => x.trim()));
    }
  }
  return node => {
    for (let n = node; n?.getAttribute; n = n.parentElement) {
      if (n.hasAttribute('hidden') || attr(n, 'aria-hidden') === 'true' || badStyle(attr(n, 'style'))) return false;
      if (/^(?:SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return false;
      for (const selector of hiddenSelectors) { try { if (n.matches(selector)) return false; } catch { /* unsupported CSS is not executed */ } }
    }
    return true;
  };
}
const unrelated = node => node.closest('aside, nav, footer, [class*="related"], [class*="recommend"], [data-testid*="related"], [class*="paywall"], [class*="premium-content"], [data-access="paid"]');

/** Return only new media blocks and evidence; the supplied capture is untouched. */
export function discoverArticleMedia(capture, sources = []) {
  const target = articleIdentity(capture?.url);
  const blocks = [], receipts = [], seen = new Set();
  let images = 0, videos = 0;
  for (const block of capture?.blocks || []) {
    const url = block.type === 'video' ? videoEmbed(block.url) : mediaURL(block.url);
    if (url) seen.add(url);
  }
  if (!target) return {blocks, receipts};
  const add = (type, raw, source, basis, details = {}) => {
    const safe = resolve(raw, source.url), url = type === 'video' ? videoEmbed(safe) : safe;
    if (!url || seen.has(url) || (type === 'figure' ? images >= 6 : videos >= 3)) return;
    const id = stableID(type, url);
    const provenance = {sourceURL: resolve(source.url), basis, placement: 'approximate', originalPlacementVerified: false};
    const block = {id, type, url, caption: clean(details.caption), credit: clean(details.credit, 500),
      poster: resolve(details.poster, source.url), aspectRatio: 16 / 9,
      style: {}, rect: {x: 0, y: 0, width: 660, height: type === 'figure' ? 440 : 371},
      ...provenance};
    blocks.push(block);
    receipts.push({id, type, url, ...provenance});
    seen.add(url);
    if (type === 'figure') images++; else videos++;
  };
  const scan = (scope, source, basis, visible) => {
    for (const node of scope.querySelectorAll('img, video, iframe, a[href]')) {
      if (!visible(node) || unrelated(node)) continue;
      const figure = node.closest('figure');
      const captionNode = figure?.querySelector('figcaption');
      const creditNode = figure?.querySelector('[class*="credit"], [class*="copyright"], [itemprop="creditText"]');
      const details = {
        caption: captionNode && visible(captionNode) ? captionNode.textContent : attr(node, 'alt') || attr(node, 'title'),
        credit: creditNode && visible(creditNode) ? creditNode.textContent : attr(node, 'data-credit'),
        poster: attr(node, 'poster'),
      };
      if (node.tagName === 'IMG') {
        // Avoid logos, tracking pixels and tiny decorative assets.
        if (/logo|avatar|icon|tracking|pixel/i.test(attr(node, 'class') + ' ' + attr(node, 'alt'))) continue;
        if (['width', 'height'].some(key => /^\d+$/.test(attr(node, key)) && Number(attr(node, key)) < 80)) continue;
        add('figure', attr(node, 'src') || attr(node, 'data-src'), source, basis, details);
      } else if (node.tagName === 'VIDEO') {
        add('video', attr(node, 'src') || attr(node.querySelector('source'), 'src'), source, basis, details);
      } else add('video', attr(node, node.tagName === 'A' ? 'href' : 'src'), source, basis, details);
    }
  };
  for (const source of Array.isArray(sources) ? sources.slice(0, 20) : []) {
    if (!source || !resolve(source.url)) continue;
    const kind = source.kind || 'article';
    if (!['article', 'front-page', 'web'].includes(kind)) continue;
    const exact = articleIdentity(source.url) === target;
    if (kind !== 'front-page' && !exact) continue;
    const html = String(source.html || source.content || '').slice(0, 2_000_000);
    if (!html) continue;
    const {document: doc} = parseHTML(html);
    const visible = visibleTest(doc);
    if (kind === 'front-page') {
      if (!source.html && !/<(?:html|body|script|template)\b/i.test(html)) {
        const markdown = html.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '');
        // The outer link is the card boundary: never associate adjacent images
        // or a nearby headline link with each other.
        for (const match of markdown.matchAll(/\[!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
          if (articleIdentity(match[3], source.url) === target) {
            add('figure', match[2], source, 'exact-article-front-page-card', {caption: match[1]});
          }
        }
      }
      for (const link of doc.querySelectorAll('a[href]')) {
        if (!visible(link) || articleIdentity(attr(link, 'href'), source.url) !== target) continue;
        // Stop at the nearest self-contained card; never widen to the page body.
        for (let card = link, depth = 0; card && depth < 7; card = card.parentElement, depth++) {
          if (/^(?:BODY|HTML|MAIN|NAV|HEADER|FOOTER)$/.test(card.tagName)) break;
          if (!card.querySelector('img, video, iframe')) continue;
          const links = [...card.querySelectorAll('a[href]')];
          if (links.some(a => {const href = attr(a, 'href').trim();return href && !href.startsWith('#') && articleIdentity(href, source.url) !== target;})) break;
          if (card.querySelectorAll('img, video, iframe').length > 9) break;
          scan(card, source, 'exact-article-front-page-card', visible);
          break;
        }
      }
      continue;
    }
    const identities = [...doc.querySelectorAll('link[rel~="canonical"], meta[property="og:url"]')]
      .map(n => articleIdentity(attr(n, n.tagName === 'LINK' ? 'href' : 'content'), source.url)).filter(Boolean);
    if (identities.some(id => id !== target)) continue;
    const canonical = identities.includes(target);
    const h1 = [...doc.querySelectorAll('h1')].find(visible);
    const title = clean(h1?.textContent || source.title || attr(doc.querySelector('meta[property="og:title"]'), 'content'));
    if (!canonical && !sameHeadline(title, capture.title, capture.standfirst)) continue;
    const scope = h1?.closest('article') || doc.querySelector('[itemprop="articleBody"], [data-testid="article-body"], .article-body, .article__body')
      || (doc.querySelectorAll('article').length === 1 ? doc.querySelector('article') : null);
    if (scope) scan(scope, source, 'exact-article-visible-media', visible);
    for (const meta of doc.querySelectorAll('meta[property], meta[name]')) {
      const key = (attr(meta, 'property') || attr(meta, 'name')).toLowerCase();
      if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) {
        add('figure', attr(meta, 'content'), source, 'exact-article-public-metadata', {
          caption: attr(doc.querySelector('meta[property="og:image:alt"], meta[name="twitter:image:alt"]'), 'content'),
        });
      }
      if (['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player'].includes(key)) {
        add('video', attr(meta, 'content'), source, 'exact-article-public-metadata');
      }
    }
    if (!source.html && source.content && !/<(?:html|body|article|main)\b/i.test(html)) {
      // A public web result must supply content for this exact URL. Only explicit
      // media syntax is used; prose, related search results and social substitutions are ignored.
      for (const match of html.matchAll(/(!?)\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        add(match[1] ? 'figure' : 'video', match[3], source, 'exact-article-public-content-link', {caption: match[2]});
      }
      if (/<(?:figure|img|video|iframe)\b/i.test(html)) scan(doc, source, 'exact-article-public-content-link', visible);
    }
  }
  return {blocks, receipts};
}

// Counts only public media syntax, never article prose or hidden JSON state.
// Counts describe available evidence, not accepted media or verified playback.
export function mediaSourceSummary(source) {
  const content = String(source?.html || source?.content || '').slice(0, 2_000_000);
  const {document} = parseHTML(content);
  const markdown = source?.html ? '' : content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, '');
  const imageMetadata = [...document.querySelectorAll('meta[property],meta[name]')].filter(n => /^(?:og:image(?::url)?|twitter:image(?::src)?)$/i.test(attr(n,'property') || attr(n,'name'))).length;
  const videoMetadata = [...document.querySelectorAll('meta[property],meta[name]')].filter(n => /^(?:og:video(?::url|:secure_url)?|twitter:player)$/i.test(attr(n,'property') || attr(n,'name'))).length;
  return {contentCharacters: content.length, imageReferences: document.querySelectorAll('img').length + imageMetadata + [...markdown.matchAll(/!\[[^\]\n]*\]\(\s*<?[^\s)>]+/g)].length,
    videoReferences: document.querySelectorAll('video,iframe').length + videoMetadata};
}
