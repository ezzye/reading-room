# Reading Room

Source for a private, room-based reading and discussion app. Members can save articles they are authorised to read, open a source-first edition with separately labelled commentary, and discuss an article inside their room. This public package includes a fictional demonstration article. It contains no newspaper corpus, library account, live room data, or deployment credentials.

## Run locally

Requires Node.js 22.13+ and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the loopback address printed by the development server. The portable local profile provides simulated sign-in for development only. Database bindings use the template in `.openai/hosting.json`; the local runtime keeps its database and logs in ignored directories. Apply the SQL files in `drizzle/` in numeric order to a new D1 database before running the room features. Check a clean copy with `npm test`, `npx tsc --noEmit --incremental false`, and `npm run build`. The production host must supply its own authenticated identity layer, D1 database, HTTPS, and private secret storage. This package does not deploy a service.

## Using the room

An owner creates or selects a room and invites people individually. On an article, Invite creates a one-use invitation that opens that article after joining; Share copies the private article link for existing members. Any signed-in member can create a separate room from the room selector. New rooms start empty and need their own library connection. Invitations are one use. An article invitation also opens its article after the recipient joins; an existing member can use a normal room article link after selecting that room. A new person joins with a display name and signs in on that device. Invited readers do not need a ChatGPT account. From the menu, a room owner can open Camden Library to connect their own card. The owner can remove access, rename the room, and choose whether new comments appear immediately or wait for approval. A member may also create and own a separate room. Membership, articles, comments, and any connected library card are scoped to each room. The article list is not a public catalogue.

Open an article in the room to see the original source material first. AI commentary stays collapsed until selected. Each article has a separate threaded discussion below it; members can reply, edit or delete their own posts, and the owner can approve or hide posts. Approval-mode member edits return to the approval queue. The discussion allows at most 300 stored comments per room article, six reply levels, and 12 new posts per member per hour. Headline search allows 30 provider searches per room per UTC day; the older public-source generator allows ten research attempts per UTC day. Legacy page sharing, where enabled by the operator, allows 15 new links per page per UTC day, each lasting seven days. Each person can own up to 20 rooms. Each room article allows 15 new article-bound invitations per UTC day; copying its existing private article link does not create another invitation. At most 100 unused invitations can be active in a room; invitations expire after seven days and device sessions after 90 days. These limits reduce load but do not replace host-level abuse controls. A public-source search result is a lead, not evidence that the full article is readable or licensed for republication. Import or capture only material you are authorised to use.

On Android Chrome, open the deployed HTTPS address and use the browser's **Install app** or **Add to Home screen** command. On iPhone Safari, use **Share → Add to Home Screen**. Install controls and service-worker caching depend on the browser. A saved HTML export is a separate file: download it, then attach that file to share it privately. Native file sharing is used only when supported. Article creation, room posts and current shared links need network access; offline copies may omit remote media.

The optional browser-extension source in `extension-library/` uses `reader.example.org` as a placeholder host. Configure its allowed host for your own deployment and package it yourself before following an in-app extension download link; no ready-made ZIP is bundled here.

## Source presentation and matching

Public URL imports use conservative unit-aware typography. Existing saved public-URL captures are repaired at render time without changing their text, IDs, media or comments; measured Page Lens styling remains separate. The renderer does not execute publisher scripts or hidden application state. A shared Times article ID can identify a changed URL slug. Fuzzy saved-article results use word overlap and date/publication constraints but always require the reader to choose; they never silently substitute an article.

## Media, short links and browser capture

Private article sharing uses stable internal `/r/` links. These locate an article and still require membership; revocation and removal continue to apply. The app never sends a private link to an external shortener.

For a library text edition, Reading Room checks the exact publisher article, its matching front-page card and public web metadata for images and supported video players. It retains the library paragraphs and annotation IDs. Added media are credited with provenance; placement is approximate when the original layout was not observed. A check is cached for a day and limited to twenty per room per UTC day. The revised media resolver retries older cached misses once under its current revision. Negative checks emit bounded state/count diagnostics and the publisher name to existing host logs; article URLs, source text, room/member identifiers and library access details are excluded. Missing media are not generated or silently replaced with related footage. The automatic library connector can request The Times or London Daily/Sunday Telegraph through the normal NewsBank forms. It requires a verified publication, an unambiguous headline/date match and the room owner’s authorised account. Other titles appearing in search do not prove full text availability. A particular article’s live library availability is separate from adapter support. If direct public metadata is blocked, the resolver tries title-only metadata from the exact URL and at most two bounded searches. A selected search headline or the conditional original-headline field can supply a hint; NewsBank still verifies publication, headline and date before any article is accepted. A reader-supplied headline remains labelled as a hint in the saved source presentation and diagnostics: a headline/date match does not prove the pasted publisher URL identifies that library record.

`extension-page-lens/` contains the optional explicit-click capture tool. Configure its deployment origins before loading it unpacked. Version 0.1.3 opens `/capture-review`, where the reader checks the visible capture and chooses Import. It keeps active-tab, scripting and local-storage permissions; it does not copy browser cookies or device fingerprints. A capture cannot supply text hidden by a subscription gate.

## Dated audit evidence

The [public outlet audit](docs/outlet-audit.html) checked **25 article URLs across 13 outlets on 18 October 2026**: 16 passed public-markup extraction and nine were unavailable or rejected. Zero source articles were visually verified. Extraction does not establish complete text, matching appearance, media playback, room import, offline access or physical-phone acceptance. The run has one Telegraph URL and no New York Times candidate; it is not an exhaustive publication test. [Metadata results](docs/outlet-audit.json) contain public URLs and measurements, without article bodies.

The separate [UK newspaper supplement](docs/uk-newspaper-supplement.html) checked **five publishers and four actual article URLs**. Two new bounded public-HTML profiles passed extraction: Daily Mirror (1,417 words, 36 paragraphs, seven images and seven captions) and The Sun (565 words, 30 paragraphs, six image references). Three outlets remain unsupported: Financial Times returned HTTP 403 on its homepage; the selected Observer article declared a subscription gate; Daily Mail supplied a public article but has no adapter. No article URL was guessed for Financial Times. These results do not verify completeness, rendered media, source layout or phone reading. [Supplement metadata](docs/uk-supplement-audit.json) remains separate from the original dated 25-URL matrix.

The [Camden coverage report](docs/camden-news-coverage.html) inventories 12 newspapers and four magazines. Provider listings, Camden entitlement, adapter support and actual retrieval are recorded separately. Times and London Daily/Sunday Telegraph have library adapter paths; **one ordinary authenticated AWS-hosted library-service check returned a verified France-protests article from The Sunday Telegraph (London, UK), with 51 paragraphs**. A separate 18 October politics lookup with a headline hint returned `not_found`. An earlier phone app flow failed at headline metadata resolution. The later phone screenshot showed the new politics article not found, consistent with its service result. The v40 phone retest still showed no Times image; post-v41 phone retesting remains pending. The France service result does not prove phone import or image recovery. The owner separately confirmed that a BBC article is readable on the phone. Additional NewsBank titles require observed title entitlement and source mapping. Magazine evidence is catalogue/provider discovery only, with no magazine ingestion adapter or verified loan. [Coverage results](docs/camden-news-coverage.json) and the [audit summary](docs/audit-results.json) preserve these limits.

Both reports are standalone HTML files that work offline. Save or download the HTML and attach that file to share it; source links require internet. Native file sharing depends on the browser and device. Reports are dated evidence, not a live service-status promise.

## Private configuration

Before the first owner signs in, set `READER_OWNER_EMAIL` and explicitly set `RR_TRUST_SITES_BOOTSTRAP=1` in the server environment. The initial request must carry a matching, trusted platform identity. The app accepts that bootstrap only while no owner exists. Remove or disable the bootstrap flag once the first owner has a session; later access uses the room session or a one-use invite/recovery link. Review the host's authenticated-header contract before exposing the app to the internet; local mock sign-in is not production authentication.

Server configuration names used by this source (supply values privately):

| Name | Purpose |
| --- | --- |
| `READER_OWNER_EMAIL` | First-owner identity and owner compatibility flow. |
| `RR_TRUST_SITES_BOOTSTRAP` | Temporary `1` only for first-owner setup. Disable afterward. |
| `DEEPSEEK_API_KEY` | AI commentary, research, search and answers. `DEEPSEEK-API-KEY` is a compatibility alias. |
| `RR_LIBRARY_VAULT_KEY` | Encrypts an authorised library connection at rest. Required before connecting a card. |
| `RR_LIBRARY_AWS_FUNCTION`, `RR_LIBRARY_AWS_REGION` | Optional AWS library-handler invocation target. |
| `RR_LIBRARY_AWS_INVOKER_ENCRYPTED` | Optional encrypted AWS invoker credential bundle. |
| `RR_LIBRARY_AWS_ACCESS_KEY_ID`, `RR_LIBRARY_AWS_SECRET_ACCESS_KEY` | Alternative server-only AWS invoker credentials; prefer an encrypted bundle or host identity when available. |

`RR_ACTIVE_ROOM_ID` is set internally from the validated request and is not an operator secret. The optional AWS handler is source only; this package has no Lambda deployment recipe, account identifier, or IAM grant. Give any deployment only the permissions needed to invoke that handler. Do not put keys, card numbers, PINs, browser cookies, room databases or provider sessions in source, client code or committed environment files.

The app limits provider calls and source sizes, but an AI answer is an interpretation of supplied evidence, not a source fact or proof of completeness. Source typography and remote images can differ from the original. A downloaded HTML file or screenshot cannot be revoked after sharing. The demonstration edition is explicitly fictional. See [architecture](docs/ARCHITECTURE.md), [source notice](docs/PUBLIC-SOURCE-NOTICE.md), and [security policy](SECURITY.md).

## Licence

Application code is MIT licensed. Third-party code, fonts, article content, publisher marks, images, videos, and provider access each have separate rights and terms. See [third-party notices](THIRD_PARTY_NOTICES.md). The public source licence does not grant a licence to republish an imported article.
