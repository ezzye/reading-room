// Additive profiles justified by one ordinary public article response per domain
// on 18 October 2026. Body boundaries are explicit; no generic article/main fallback.
// Names identify the observed website. Fonts and colours are readable display
// fallbacks, not a claim that external publisher CSS or print editions were copied.
export const UK_PRESS_PROFILES = Object.freeze({
  'walesonline.co.uk': Object.freeze({
    name: 'WalesOnline', color: '#c62828', serif: 'Arial, sans-serif',
    body: '#article-body[data-testid="body"]', strictBody: true, reachMedia: true,
  }),
  'dailypost.co.uk': Object.freeze({
    name: 'North Wales Live', color: '#c62828', serif: 'Arial, sans-serif',
    body: '#article-body[data-testid="body"]', strictBody: true, reachMedia: true,
  }),
  'manchestereveningnews.co.uk': Object.freeze({
    name: 'Manchester Evening News', color: '#c62828', serif: 'Arial, sans-serif',
    body: '#article-body[data-testid="body"]', strictBody: true, reachMedia: true,
  }),
  'liverpoolecho.co.uk': Object.freeze({
    name: 'Liverpool Echo', color: '#c62828', serif: 'Arial, sans-serif',
    body: '#article-body[data-testid="body"]', strictBody: true, reachMedia: true,
  }),
  'birminghammail.co.uk': Object.freeze({
    name: 'Birmingham Live', color: '#c62828', serif: 'Arial, sans-serif',
    body: '#article-body[data-testid="body"]', strictBody: true, reachMedia: true,
  }),
  'sundaypost.com': Object.freeze({
    name: 'The Sunday Post', color: '#b51d2b', serif: 'Georgia, serif',
    // The observed article's sibling subscription CTA and lead thumbnail are
    // outside this prose boundary. Neither is removed to unlock content.
    body: '.entry-content[itemprop="articleBody"] > .cms.clearfix', strictBody: true,
  }),
});
