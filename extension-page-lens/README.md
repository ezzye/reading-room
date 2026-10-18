# Reading Room Page Lens 0.2.3

An unpacked Manifest V3 Chrome extension for explicit rendered-page capture and a short, owner-enabled connection to a private Reading Room. This version adds permissions. Review the permission changes before loading or reloading it. No installed extension has been changed by the automated checks.

## Direct connection without the ChatGPT extension

1. Keep the newspaper article open. Scroll until most of the wanted image or player is visible.
2. Open Page Lens and choose **Enable this tab**. This explicitly permits requests during the next ten minutes to send this tab’s visible media references into your private Reading Room for review.
3. Confirm the connection in the Reading Room tab opened by Page Lens, within ninety seconds. Confirmation returns to the enabled source tab automatically.
4. Request visible media from Reading Room, including an authorised phone. Keep the source article selected in its original, unminimized window. The rendered viewport is checked; OS app focus is not guaranteed. A desktop request requires returning to the source tab before the next check, which occurs about every thirty seconds.
5. Inspect the staged media in Reading Room and choose whether to import it. Nothing is appended automatically. Use **Stop connection** in Page Lens or Reading Room to end the session.

Remote commands never navigate, activate tabs, scroll, dismiss overlays, or accept JavaScript. The explicit local pairing confirmation alone selects the originally enabled source tab, without navigating or focusing its window. The only command is bundled `extractMedia`, executed in the isolated world of the enabled source tab. Closing that tab, changing its article URL, stopping, expiry, or server revocation ends its authority. Background tabs, moved source windows and minimized windows return a fixed status without capturing. OS window focus is not required. Commands expire after ninety seconds and are consumed once. The owner’s original Reading Room login remains a revocation dependency.

The default connection is `reader.example.org`. `dayofflondon.com` is an optional, explicitly selected origin. The connection capability is kept in Chrome session storage and sent only in a request header to the chosen fixed Reading Room API. It is never put in a URL or sent to the newspaper. API requests omit cookies. Pairing uses a nonce-bound connection-page handshake; no pairing code must be copied each capture.

## Permission changes requiring review

The existing `activeTab`, `scripting`, and `storage` permissions remain. The direct connection introduced in 0.2.0 adds `alarms` for thirty-second checks and the exact default Reading Room host permission. `https://dayofflondon.com/*` is optional and requested only when selected. The connection content script runs only at `/page-lens-connect` on those origins; the existing reviewed-capture handoff paths remain. There are no newspaper-wide host, cookies, debugger, network interception or remote-executor permissions. The source grant still comes from the user opening the popup on that tab.

## Manual capture and handoff

**Capture page** reads rendered article paragraphs and media under a scored article subtree. A displayed access overlay pauses full-article capture. CSS-hidden, clipped and blurred content is skipped. Completeness is never certified. **Capture visible media** independently captures only visible image/player references without article paragraphs. Review the counts, then download the JSON or choose **Open reviewed capture in RET**. This manual handoff uses a random one-use nonce and ten-minute expiry. Reading Room requires explicit review and Import before saving to the current private room.

## Visible media boundaries

`ret-media/v1` contains the public source URL, headline, capture time, viewport and at most twenty image/player references with plain captions, credits and measured rectangles. Media must intersect the viewport by at least 80×50 pixels and 40% of its area; at least six of nine hit-tested points must belong to its surface. Hidden, inert, blurred, overflow-clipped, dialog, unrelated, navigation and advertising regions are excluded. These conservative geometry checks do not certify placement or playback.

Only public HTTPS references are retained. Credentials, private hosts and signed/authenticated query parameters are rejected. YouTube, Vimeo, observed Brightcove identifiers, direct MP4/WebM URLs and the observed exact Telegraph player host are supported. Unknown visible player posters can be figures labeled “Visible poster; player unsupported”; URLs are never guessed. Cross-origin frame interiors, cookies, hidden application state, JSON-LD, scripts and protected streams are not read. Media files are not downloaded or embedded for offline use. Providers can restrict subsequent display or playback.

## Verification status

Local rendered-DOM tests cover visibility, partial viewport intersections, occlusion, safe URLs and player handling. Worker tests use the actual private-room API with an in-memory database to check pairing sizes, canonical source identity, one-use commands, review staging and stop races. They also check inactive sources, expiry and revocation. These are local simulated checks, not installed Chrome or phone verification. Browser-origin/CORS behavior, activeTab retention, alarm timing, real pairing and phone media display require an explicit permission review followed by manual end-to-end testing. No extension was loaded or run against Chrome during implementation.

## Polling repair (0.2.1)

Successful pairing checks the fixed endpoint immediately and ensures a thirty-second alarm exists. Worker startup and popup status recreate a missing alarm for an unexpired locally enabled session. **Check now** performs the same bounded check; it cannot activate or navigate the source. The popup retains only safe timestamps, fixed outcome labels and HTTP status codes after failure or expiry. It displays no bearer, source URL, query or backend error text. This repair addresses a lifecycle gap consistent with a paired connection that never polls; the later observed missing-Origin polling failure was separately confirmed and addressed in 0.2.2. Permissions are unchanged from 0.2.0.

While pairing or enabled, Enable is disabled. Repeated Enable messages for the same tab preserve the current nonce or capability and do not create another connection page. Use Stop before explicitly starting again or selecting another tab. A screenshot showing “Confirm the connection” identifies pending pairing, not a completed connection; the alarm repair is not a confirmed explanation of that observed state.

## Confirmed polling transport fix (0.2.2)

Live server evidence showed pairing POST succeeded with Chrome’s extension Origin, immediately followed by a polling GET rejected with HTTP403 because Origin was absent. Polling now uses a fixed POST `{action:"poll"}` with the same bearer header, cookie omission, approved destination and strict server Origin policy. No Origin header is forged and permissions are unchanged. That version showed **Build 0.2.2** so the installed version can be checked directly. Earlier alarm recovery and duplicate-Enable guards remain; they were not the confirmed cause of this failure. Actual Chrome and phone retesting is still required after the owner reloads and reconnects.

## Rendered enabled viewport (0.2.3)

Local pairing confirmation selects the original source tab once, after the matching nonce and API response are validated. Remote requests never select, focus, navigate or scroll. They require that exact article URL in its original window, the article tab selected, and the window unminimized. The bundled extractor still rejects a hidden document and checks viewport geometry, clipping and occlusion. Other Mac apps can be in front: the capture is identified as the **rendered enabled viewport**, with `viewportBasis:"rendered-enabled-tab"` and `osFocusVerified:false`; it is not proof that the source window is foremost on the desktop. Local diagnostics use only fixed reasons `tab-inactive`, `window-changed` or `window-minimized`, without URLs or tab/window IDs. Earlier instructions about requiring Chrome foreground are superseded by this section. Permissions are unchanged.
