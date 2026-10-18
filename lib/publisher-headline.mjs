// Remove only a known Telegraph search-index branding suffix. Keep ordinary
// headline wording intact; source URL identity remains a separate check.
const TELEGRAPH_INDEX_BRANDING = /\s+-\s+UK News Website of the Year 2024\s*$/i;

export function cleanPublisherHeadline(raw) {
  return typeof raw === 'string' ? raw.replace(TELEGRAPH_INDEX_BRANDING, '').trim() : '';
}
