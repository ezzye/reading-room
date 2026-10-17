# Security policy

Please report suspected vulnerabilities privately through this repository's **GitHub Security → Report a vulnerability** flow (a private advisory). Include a concise reproduction and affected code path, but do not attach real article text, credentials, card details, session cookies, private room links, or personal data. If private advisories are unavailable, open a public issue requesting a private reporting channel without disclosing the vulnerability details.

Operators should store server secrets outside Git, restrict D1 and optional AWS permissions, use HTTPS, apply migrations before accepting traffic, and review bootstrap and room-invitation settings. Rotate any credential that may have reached logs, source control, or a shared file. Public source inspection and automated tests cannot establish that a particular deployment is secure.
