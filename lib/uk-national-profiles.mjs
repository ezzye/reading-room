// Explicit public article containers observed on 18 October 2026.
// The importer must keep its visibility, subscription and minimum-length checks.
// These profiles provide no generic article/main fallback or hidden-state source.
export const UK_NATIONAL_PROFILES = {
  'inews.co.uk': {
    name: 'i paper',
    color: '#d71920',
    serif: 'Georgia, serif',
    body: 'article #content.inews__post-content.entry-content.article-content',
    strictBody: true
  },
  'cityam.com': {
    name: 'City A.M.',
    color: '#17394b',
    serif: 'Georgia, serif',
    body: 'article.content-container.content-container__single',
    strictBody: true
  },
  'express.co.uk': {
    name: 'Daily Express',
    color: '#194c83',
    serif: 'Georgia, serif',
    body: '#singleArticle.single-article.article-body > article#article-body',
    // Observed premium marker: refuse rather than presume paid markup is public.
    gatedSelector: '.p402_premium',
    strictBody: true
  }
};
