# Page Lens connection review

This source feature requires review of the extension permission changes before loading or running the new extension. It has not been browser-tested or activated by these source changes.

An owner creates a one-use pairing handoff lasting ninety seconds. The connection page sends it only through a nonce-bound event to the extension's explicitly opened connection tab; it is absent from URLs. The enabled source-tab session lasts at most ten minutes. The capability is stored hashed server-side, sent in an Authorization header by the extension, and cannot create library sessions or obtain a card, cookie, prose, arbitrary JavaScript, navigation, scrolling, frame contents or direct stream URLs.

Owner controls require the authenticated owner identity in the same room. Another authorised device of that owner can request capture. Every extension operation rechecks the original pairing browser session, owner membership, expiry and the paired extension origin. Revoking that session, membership or connection closes the capability.

The extension executes only its bundled visible-media extractor after verifying the enabled tab is still active, the window focused and the exact source URL unchanged. Each fixed command is claimed once, expires after ninety seconds, and accepts one bounded result. There can be one pending command and at most twenty commands per connection. Results contain at most twenty safe image/player references and captions, never article paragraphs. Media references may be private room content: result retrieval requires the room owner, and import remains an explicit reviewed action through the existing room API. Nothing auto-imports.

Session and command records expire after ten minutes. Expired records are removed when a new connection is created; this is request-time cleanup, not a guaranteed background deletion job. No capability tokens or article content are logged by this API. Preserve the exact host allowlist and content-script nonce checks when configuring a new deployment origin. The existing site origin is the default; custom-domain TLS/provider status is a separate deployment check.

Before owner acceptance, verify permission text, pairing on the intended origin, active/focused-tab refusal, URL-change refusal, Stop/expiry/revocation, command replay, explicit result review, room isolation, provider embedding and the final physical phone view. Synthetic tests establish protocol behavior, not Chrome or phone acceptance.
