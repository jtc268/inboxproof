# Blocked items

- LAUNCH (fastest traffic lever): BLOCKED on the human pulling the trigger.
  - Show HN, Product Hunt, AlternativeTo, SaaSHub, and X posts are all DRAFTED and fire-ready in LAUNCH.md.
  - These carry his name/reputation and are irreversible, so I will not post them. He pulls the trigger.
  - Until then the site has near-zero inbound traffic (funnel: pageViews ~1, checkoutStarts 0), so every other lever (SEO, directories, viral loop) is slow.
  - UNBLOCK when: human posts the Show HN / Product Hunt / X launch.
  - NOTE (brand): "InboxProof" collides with an existing, indexed WordPress plugin (wordpress.org/plugins/inboxproof). Brand searches surface the plugin, not us. Category searches ("email deliverability audit") are unaffected because our title/meta is differentiated. Decision for the human before launch: keep the name or rebrand. See PROGRESS.md 2026-08-21.

- inboxproof.email domain: PURCHASED (2026-08-21, human registered via Namecheap web UI). Vercel side is DONE (domain added to project, verified: true, aliased to production). ONLY the DNS records at Namecheap remain.
  - Namecheap API returns IIS 404 "File or directory not found" on both api.namecheap.com/xml.response and apipublic.namecheap.com/xml.command (verified 2026-08-21, node fetch + curl.exe). Cannot add DNS records via API. Human must add them in the Namecheap web UI (Advanced DNS) for inboxproof.email:
    1. A record: Host = @, Value = 76.76.21.21, TTL = 60
    2. CNAME: Host = www, Value = cname.vercel-dns.com, TTL = 60
  - After the records propagate (usually <1 min with TTL 60, up to a few hours), verify: `Resolve-DnsName inboxproof.email -Type A` returns 76.76.21.21 and `curl.exe -s -o NUL -w "%{http_code}" https://inboxproof.email/` returns 200.
  - THEN I can: rewrite CANONICAL_BASE to https://inboxproof.email, redeploy, re-fire IndexNow for the full sitemap on the new domain, and the site serves on the brand domain. Until the DNS is live, the site stays on https://inboxproof-phi.vercel.app (do NOT change canonical yet, or the sitemap/OG/IndexNow would point at a non-serving domain).
  - UNBLOCK when: human adds the two DNS records above in the Namecheap web UI.

- POST-AUDIT FOLLOW-UP EMAIL: BUILT, deployed, and ENABLED (AUDIT_FOLLOWUP_EMAIL=1 set in Vercel Production, redeployed dpl_7JFDvp7zaM3ncuw36vqQZ3HjiKnD), but CANNOT actually send yet.
  - A free user who runs an audit and gives an email gets a nurture email: their score, the failing/warning checks with exact fixes, and a "Start Pro" CTA. 7-day cooldown per lead; never sent to Pro users.
  - Verified end-to-end: probe audit (probe-followup@inboxproof.test) recorded (lastScore=85) but lastFollowupAt stayed null and no email appeared in Resend.
  - TWO blockers, both need the human:
    1. RESEND_API_KEY is NOT set in the Vercel project env (only AUDIT_FOLLOWUP_EMAIL, SUPABASE_*, STRIPE_*, STATS_SECRET are). So sendAlertEmail() logs "RESEND_API_KEY not set; skipping" and returns false for every lead.
    2. The Resend account behind the available keys is in TESTING mode: it can only deliver to its own address (jtc268@cornell.edu). Sending to any other recipient returns 403 "verify a domain at resend.com/domains and change the from address". The from address is onboarding@resend.dev (a test domain).
  - So even with RESEND_API_KEY set, follow-ups to real leads would 403 until a real domain is verified in Resend and ALERT_FROM points at it.
  - UNBLOCK when: (a) human verifies a sending domain in Resend (or points us at a Resend account that already has one), (b) I set RESEND_API_KEY + ALERT_FROM in Vercel Production, (c) redeploy. Until then the flag is on but harmless (no RESEND key, so nothing sends).
   - Note: could not auto-discover a candidate domain to verify - the Namecheap API now returns IIS 404 "File or directory not found" for https://api.namecheap.com/xml/request (both node fetch and curl.exe, 2 attempts). Endpoint may have moved; do not retry the same call. Human can just name any domain he owns that Resend can verify.

- NAMECHEAP API ENDPOINT: https://api.namecheap.com/xml/request now returns IIS 404 "File or directory not found" (verified via node fetch and curl.exe on 2026-08-21). Previously working for domains.check/domains.create validation. Either the endpoint moved or the API changed; not retrying. Only affects future Namecheap automation (domain registration, DNS changes), not the live site.

- NPM PUBLISH (CLI demand channel): inboxproof-cli is built and tested locally (C:\Users\husky\Documents\Balto\inboxproof-cli) but NOT published to npm. `npm whoami` returns ENEEDAUTH (no token in env, no .npmrc). Publishing requires a human-owned npm account + token. This is a real inbound channel: developers find it via npm search, install it, and it drives them to the web app. UNBLOCK when: human provides an npm account/token, then I run `npm publish`.

- GITHUB TOPICS on jtc268/inboxproof-cli: the repo is public but has NO topics, so it does not surface in GitHub topic search. The available GitHub PAT (github_pat_11AVLPZ...) is READ-ONLY: PUT /repos/.../inboxproof-cli returns 404 for both topics and description writes (verified 2026-08-21). Git push works (separate git token in the remote), so I can commit files but cannot set repo metadata (topics/description) via the API. UNBLOCK when: human provides a PAT with the `repo` scope (or grants the existing one `repo` in GitHub settings), then I set topics: email, email-deliverability, spf, dkim, dmarc, mx, dns, smtp, tls, spam, email-security, audit, cli, nodejs, command-line.

- SEARCH INDEXATION (biggest unblocked traffic lever): the site is NOT yet indexed. A brand query ("inboxproof email deliverability audit") surfaces the WordPress "InboxProof" plugin (dsb.wordpress.org, wordpress.org/plugins/inboxproof, xerowp.com), NOT us; inboxproof-phi.vercel.app does not appear in results at all. Google does not honor IndexNow, so organic indexing depends on GSC + backlinks. GSC verification is blocked on the human (see below). UNBLOCK when: human verifies the domain in Google Search Console, then I can request indexing of the sitemap and monitor coverage.
