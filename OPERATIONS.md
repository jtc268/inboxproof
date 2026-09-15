# Inboxproof customer access and monitoring

## Runtime

Node 24. `npm test` runs isolated customer-flow and SMTP fixture tests. Tests never charge a card or send customer email. Production is Vercel project `inboxproof`, public domain `https://inboxproof.email`.

Required production variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ALERT_FROM`, `CRON_SECRET`, and `APP_URL`.

Price IDs must match the amounts shown on the site: Pro $14.50/month, Agency $49.50/month. The September incident found older price IDs still present in environment settings; these were corrected during release. Confirm the active Stripe price before changing either setting.

## Access

`/login` sends a one-use, 20-minute link to the account email. `/pro` loads the account from the session, not a caller-supplied email address. Sessions are 30-day opaque, server-stored tokens in Secure, HttpOnly, SameSite=Lax cookies. Logout revokes the session. Private responses are not cached. Session and login tokens are stored by SHA-256 digest. Sign-in attempts are throttled by email and IP using durable atomic records.

A paid checkout return creates a browser session only when its server-generated checkout cookie matches the hash stored in Stripe metadata. Missing-cookie returns use email sign-in. An old or canceled checkout cannot reactivate a canceled subscription.

## Payments

Stripe sends events directly to `https://inboxproof.email/api/webhook`. Do not use the retired Vercel alias; Stripe does not follow redirects. The endpoint validates the raw-body signature, accepts only a five-minute timestamp window, and records processed events. Subscription reconciliation fetches current state from Stripe, recognizes configured Inboxproof prices, and preserves the existing account identity. Welcome messages use the Stripe session ID as the provider idempotency key.

Verify both webhook delivery and the current Stripe subscription before granting a customer's paid entitlement. The authenticated billing portal supports cancellation. Account deletion blocks while an active paid subscription still exists.

## Monitoring

Vercel invokes GET `/api/monitor` hourly with `Authorization: Bearer <CRON_SECRET>`. Only eligible domains due for a check are processed (20-hour minimum interval). All saved domains are considered, oldest first. A run stops accepting new work after four minutes; the next hourly run picks up remaining work. Test accounts are excluded. Every successful check stores a report, history entry, and per-domain timestamp. Failed regression alerts remain in the account's outbox for retry; provider idempotency keys avoid duplicate sends.

`monitor:status` stores completion time, checked and pending counts, and errors. `/api/monitor` returns a failure status if work fails. Verify this state and actual saved reports after deployment. An authorized POST can run immediately with `{ "notify": false, "force": true }` to save real results without customer messages.

## Persistence and recovery

The existing private Supabase Storage bucket `kv` is retained. Writes use in-place replacement, fresh request state, merge-on-write, and atomic locks. Concurrent updates to separate accounts and fields are preserved; history appends are merged. Critical domain-capacity changes run under a per-account lock. Requests fail if persistence fails.

Vercel functions have a 300-second maximum. Abandoned locks become recoverable after 600 seconds, with a unique recovery claim to avoid deleting a successor's lock. Keep the function lifetime below that recovery interval. Backup the `leads`, `audits`, `stats`, and report objects before operational repair. Never restore a stale global snapshot over newer customer records.

## Release checks

1. Run `npm test` and verify all changed page scripts parse.
2. Stage using a production deployment with automatic domain assignment skipped.
3. Check `/api/health`, `/login`, session ownership, billing, signed webhook handling, and authenticated monitoring.
4. Send a sign-in to an operator-owned mailbox. Verify its Gmail folder and authentication headers, then click the real link and test dashboard, recheck, logout, and login again.
5. Promote the verified deployment and repeat public hostname checks. Keep the previous deployment ID as the rollback target.

## Scope limits

Configuration checks are not an inbox-placement test. SPF expansion is a bounded static review; actual sender evaluation and macros require message-specific validation. DKIM discovery checks common selectors and parses keys; it does not verify a message signature. SMTP probes can be blocked by the hosting network and report that as unverified. Storage remains an object-store architecture; a transactional database and token-record retention job are appropriate before high-volume or enterprise SLA commitments.
