# RET Page Lens 0.1.3

An unpacked Manifest V3 Chrome extension prototype for explicit, local review of readable rendered article content. It does not upload captures. The user must click **Read this page**, inspect the counts/warnings, then choose **Download JSON** or **Open RET**. The latter stores one reviewed JSON payload with a random one-use nonce and ten-minute expiry in `chrome.storage.local`, then opens RET `/capture-review` with that nonce. A page button must dispatch `ret-request-capture`; only the matching fresh tab receives `ret-capture-ready`. Reading Room shows the supplied text and counts for review; the reader must confirm and choose Import to save it in the current private room with separate AI commentary.

## Install for development

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this folder.
3. Open a readable article and click the extension icon, then **Read this page**.
4. Review the warning and counts; download the JSON or open RET for the reviewed handoff.

Permissions are limited to `activeTab`, `scripting`, and `storage`. There are no cookie, network interception, or wildcard host permissions. The content script runs only on `/capture*` and `/capture-review*` at the configured RET, dayofflondon.com, and local development origins. Popup capture executes on click in Chrome's isolated world.

## Scope and privacy limits

Capture includes rendered DOM text and visible DOM image/video elements under a scored article subtree, including readable offscreen content. It skips CSS-hidden, clipped, blurred, or semantically nested duplicate blocks. A visible fixed/sticky sign-in, subscription, or access overlay that overlaps the article pauses capture; hidden paywall markers alone do not block it. The diagnostic span estimates captured content height against the selected root and viewport; it does not establish source completeness. `completeNotCertified` is always true.

The capture does not preserve the original page's exact layout or scripts. Remote images are linked and are not embedded for offline viewing; cross-origin frames are represented only as visible supported-provider links, not read or copied. Font names and computed styles are retained, but font files are not copied. Hidden state, JSON-LD, page application state, network interception, DRM, and media extraction are out of scope. Media URLs are restricted to HTTP(S), with credentials, fragments, and common tracking/signed-auth parameters stripped. This is best-effort sanitization, not a guarantee that every source URL is shareable.

The existing 15-share/day cap must remain enforced by RET's server-side owner flow; this extension does not implement or bypass that cap. AI comments and saved edition comparison are not part of this capture prototype.

## Verification status

JavaScript syntax, unchanged manifest permissions, a simulated one-use nonce handoff with no upload before explicit Import, and server tests for room isolation, same-origin writes and preview rejection passed locally. No installed extension was changed. Live Chrome handoff, Telegraph capture, deployment and phone reading still need verification. Subscription-only or missing text is never reconstructed. A paywall marker can be inactive, so compare captured text with the readable original; capture completeness is not certified.
