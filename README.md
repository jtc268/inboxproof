# Inboxproof

Free, no-signup email deliverability tools. Type a domain and get a real
audit in seconds: MX, SPF, DKIM, DMARC, TLS/STARTTLS, reverse DNS (PTR), and
IP reputation, with a 0-100 score and the exact records to fix.

**Live:** https://inboxproof.email

## Why

Cold email and transactional mail die in the spam folder for a fixable reason:
the sending domain was not ready. A missing `-all` on SPF, a DKIM signature on
the wrong domain, a DMARC policy set to `reject` by mistake, or a blocklisted
IP. Inboxproof checks all of it against live DNS and tells you exactly what to
change.

## Tools (all free, no signup)

- [Email spam checker](https://inboxproof.email/spam-checker)
- [DMARC checker](https://inboxproof.email/dmarc-checker)
- [SPF checker](https://inboxproof.email/spf-checker)
- [DKIM checker](https://inboxproof.email/dkim-checker)
- [IP blocklist checker](https://inboxproof.email/blocklist-checker)
- [MX record checker](https://inboxproof.email/mx-checker)
- [Email header analyzer](https://inboxproof.email/header-analyzer)
- [DMARC report parser](https://inboxproof.email/dmarc-report-parser)
- [DMARC record generator](https://inboxproof.email/dmarc-generator)
- [SPF record generator](https://inboxproof.email/spf-generator)
- [Cold email deliverability checker](https://inboxproof.email/cold-email-checker)
- [Warm-up calculator](https://inboxproof.email/warm-up-calculator)
- [TLS / STARTTLS checker](https://inboxproof.email/tls-checker)
- [Reverse DNS (PTR) checker](https://inboxproof.email/ptr-checker)

## For teams

- [For agencies](https://inboxproof.email/agencies) - monitor up to 25 client domains, white-label reports, daily alerts
- [For developers](https://inboxproof.email/developers) - the deliverability API, one REST call, Bearer auth

## CLI

Run the same audit from your terminal or in CI, no account needed:

```
npx github:jtc268/inboxproof-cli example.com
```

Zero dependencies, reads live DNS only. [Source](https://github.com/jtc268/inboxproof-cli).

## Comparisons

- [Best email deliverability testing tools (2026)](https://inboxproof.email/deliverability-tools)
- [Mail-Tester alternatives](https://inboxproof.email/mail-tester-alternatives)
- [GlockApps alternatives](https://inboxproof.email/glockapps-alternatives)

Plus 117 short, practical [guides](https://inboxproof.email/blog) on
SPF, DKIM, DMARC, and deliverability.

## How it works

Inboxproof queries your live DNS read-only. No account, no DNS changes,
nothing to install. The audit runs server-side and returns a structured
result.

## API

```
POST /api/audit
Content-Type: application/json

{ "domain": "example.com" }
```

Returns a JSON score with per-record pass/fail and the exact fix records.
See the [developer docs](https://inboxproof.email/developers).

## Run locally

```
node server.mjs
```

Set `PORT` to choose the port (default 4321). No external dependencies beyond
Node 18+.

## License

MIT
