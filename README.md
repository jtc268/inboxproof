# Inboxproof

Free, no-signup email deliverability tools. Type a domain and get a real
audit in seconds: MX, SPF, DKIM, DMARC, TLS/STARTTLS, reverse DNS (PTR), and
IP reputation, with a 0-100 score and the exact records to fix.

**Live:** https://inboxproof-phi.vercel.app

## Why

Cold email and transactional mail die in the spam folder for a fixable reason:
the sending domain was not ready. A missing `-all` on SPF, a DKIM signature on
the wrong domain, a DMARC policy set to `reject` by mistake, or a blocklisted
IP. Inboxproof checks all of it against live DNS and tells you exactly what to
change.

## Tools (all free, no signup)

- [Email spam checker](https://inboxproof-phi.vercel.app/spam-checker)
- [DMARC checker](https://inboxproof-phi.vercel.app/dmarc-checker)
- [SPF checker](https://inboxproof-phi.vercel.app/spf-checker)
- [DKIM checker](https://inboxproof-phi.vercel.app/dkim-checker)
- [IP blocklist checker](https://inboxproof-phi.vercel.app/blocklist-checker)
- [MX record checker](https://inboxproof-phi.vercel.app/mx-checker)
- [Email header analyzer](https://inboxproof-phi.vercel.app/header-analyzer)
- [DMARC report parser](https://inboxproof-phi.vercel.app/dmarc-report-parser)
- [DMARC record generator](https://inboxproof-phi.vercel.app/dmarc-generator)
- [SPF record generator](https://inboxproof-phi.vercel.app/spf-generator)
- [Cold email deliverability checker](https://inboxproof-phi.vercel.app/cold-email-checker)
- [Warm-up calculator](https://inboxproof-phi.vercel.app/warm-up-calculator)
- [TLS / STARTTLS checker](https://inboxproof-phi.vercel.app/tls-checker)
- [Reverse DNS (PTR) checker](https://inboxproof-phi.vercel.app/ptr-checker)

Plus 42 short, practical [guides](https://inboxproof-phi.vercel.app/blog) on
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
See the [developer docs](https://inboxproof-phi.vercel.app/developers).

## Run locally

```
node server.mjs
```

Set `PORT` to choose the port (default 3000). No external dependencies beyond
Node 18+.

## License

MIT
