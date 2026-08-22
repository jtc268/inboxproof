# Blocked items

- LAUNCH (fastest traffic lever): BLOCKED on the human pulling the trigger.
  - Show HN, Product Hunt, AlternativeTo, SaaSHub, and X posts are all DRAFTED and fire-ready in LAUNCH.md.
  - These carry his name/reputation and are irreversible, so I will not post them. He pulls the trigger.
  - Until then the site has near-zero inbound traffic (funnel: pageViews ~1, checkoutStarts 0), so every other lever (SEO, directories, viral loop) is slow.
  - UNBLOCK when: human posts the Show HN / Product Hunt / X launch.
  - NOTE (brand): "InboxProof" collides with an existing, indexed WordPress plugin (wordpress.org/plugins/inboxproof). Brand searches surface the plugin, not us. Category searches ("email deliverability audit") are unaffected because our title/meta is differentiated. Decision for the human before launch: keep the name or rebrand. See PROGRESS.md 2026-08-21.

- inboxproof.email domain: DONE (resolved 2026-08-22, round 144). Purchased, Vercel side done, DNS records set (A @ -> 76.76.21.21, CNAME www -> cname.vercel-dns.com, both TTL 60), canonical base rewritten to https://inboxproof.email, deployed and verified live. The old inboxproof-phi.vercel.app alias 301-redirects to inboxproof.email. No longer blocked.

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

- SEARCH INDEXATION (biggest unblocked traffic lever): the site is NOT yet indexed in Google. A brand query ("inboxproof email deliverability audit") surfaces the WordPress "InboxProof" plugin (dsb.wordpress.org, wordpress.org/plugins/inboxproof, xerowp.com), NOT us. Google does not honor IndexNow, so Google indexing depends on GSC + backlinks. GSC verification is blocked on the human. PARTIAL UNBLOCK: Yandex IndexNow now accepts the full 122-URL sitemap (HTTP 202, success:true, re-verified round 175), so Yandex is crawling and indexing the site on its own. api.indexnow.org and bing still 403 UserForbiddedToAccessSite (both require site verification, human-gated). UNBLOCK the rest when: human verifies the domain in Google Search Console + Bing Webmaster Tools, then I can request indexing of the sitemap and monitor coverage.
