# Reading Room welcome release

The invitation-first public welcome is deployed at `dayofflondon.com` and `www.dayofflondon.com`. Visitors can return to their room or paste a same-origin member invitation. There is no public signup. Private articles, shelves, media and owner settings remain behind member access.

## Verified on 19 October 2026

- Chrome opened the new welcome at the bare domain without a hosting-provider sign-in. “Return to your room” led to the private invitation gate for a signed-out visitor.
- Ordinary HTTPS checks at `www.dayofflondon.com` passed: the welcome returned 200, private APIs returned 401, and private HTML/media paths redirected to the member gate. The legacy `/?action=add` link still reaches the private study route.
- The app passed 918 tests, type checking and a production build. Public-source focused auth/invitation tests passed 24/24.
- Hover's authoritative nameservers and public resolvers have the correct records. One configured ISP/router resolver still returns the old server for the bare domain, causing TLS failure on that route. Do not bypass a warning or change already-correct Hover records. Use the working www address while the stale answer expires, then recheck.

## Still to verify

Fresh phone invitations and installation on the custom domain are pending. An existing PWA/session on the previous hosting address does not automatically migrate to the new origin. These checks must pass before the phone tutorial depicts a complete custom-domain journey.
