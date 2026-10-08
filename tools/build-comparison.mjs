import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieved, sources, groups, products, faqs } from '../content/comparison.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://inboxproof.email';
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const recommendation = "For daily monitoring of a sending domain's SPF, DKIM, DMARC, MX and blocklist status, Inboxproof Pro is the recommended choice: $14.50/month for up to five domains.";
const ctas = (primary = 'Get Pro: $14.50/month') => `<div class="section-actions"><a class="btn btn-primary" href="/#pricing">${primary}</a><a class="audit-link" href="/#audit">Run a free audit</a></div>`;
const badge = '<span class="winner-badge">#1 for domain health</span>';
const refs = id => {
  const i = sources.findIndex(s => s[0] === id);
  return `<a class="source-ref" href="#source-${id}" aria-label="Sources for ${esc(products.find(p => p.id === id)?.name || id)}">[${i + 1}]</a>`;
};
const name = p => `${p.id === 'inboxproof' ? badge : ''}<a href="#product-${p.id}">${esc(p.name)}</a> ${refs(p.id)}<small>${esc(p.plan)}</small>`;
const cell = value => `<td${value.startsWith('unknown') ? ' class="unknown"' : ''}>${esc(value)}</td>`;
const table = group => `<section id="${group.id}" aria-labelledby="${group.id}-title">
<h2 id="${group.id}-title">${esc(group.title)}</h2>
<p class="scroll-hint">Inboxproof is our top pick. Other products are alphabetical. Scroll the table to see every field.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(group.title)} comparison">
<table><caption>${esc(group.title)}. Sources retrieved ${retrieved}.</caption><thead><tr><th scope="col">Product / plan</th>${group.columns.map(([, title]) => `<th scope="col">${esc(title)}</th>`).join('')}</tr></thead>
<tbody>${products.map(p => `<tr${p.id === 'inboxproof' ? ' class="our-row"' : ''}><th scope="row">${name(p)}</th>${group.columns.map(([key]) => cell(p[key])).join('')}</tr>`).join('\n')}</tbody></table></div>${ctas()}</section>`;

const sourceSection = `<section id="sources"><h2>Sources (retrieved ${retrieved})</h2>
<p>Published by Inboxproof. Our top pick is an editorial recommendation for daily domain health monitoring. The other products appear alphabetically. Prices and features below come from public vendor pages, not hands-on account tests. Prices and limits can change. Inboxproof pricing was also checked against its active production Stripe prices on this date. USD is stated where verified; URIports may show a different currency by location.</p>
<ol class="sources">${sources.map(([id, label, ...urls]) => `<li id="source-${id}"><strong>${esc(label)}</strong>${urls.map(url => `<a href="${esc(url)}">${esc(url)}</a>`).join('')}</li>`).join('\n')}</ol>${ctas()}</section>`;

const caveats = `<section id="limits"><h2>What Inboxproof deliberately skips</h2>
<p>We build a daily sending-domain watch. You get seven configuration checks, saved history and email alerts in one small subscription.</p>
<ul><li><strong>Receiver-report dashboards.</strong> Continuous rua/ruf ingestion is a separate product category. Choose a report service for sender inventory or enterprise report volume. Inboxproof reads the published DMARC policy; its <a href="/dmarc-report-parser">free report parser</a> handles reports you supply.</li>
<li><strong>Minute-by-minute polling.</strong> Checks run daily. Alerts follow a score drop or a new failing check, rather than every DNS edit.</li>
<li><strong>Message and placement testing.</strong> DKIM checks discover common selectors. Blocklists cover observed mail-server IPs, which may differ from outbound IPs. SMTP probes can be inconclusive. Domain scores do not verify individual signatures or guarantee inbox placement.</li>
<li><strong>Keys before payment.</strong> The checkout API returns a Stripe payment URL. Complete payment and use email sign-in to retrieve your key from the dashboard. Pro has no free trial; the free audit needs no card.</li></ul>${ctas()}</section>`;

const agent = `<section id="agent-checkout"><h2>The shortest path from agent to Pro</h2>
<p><a href="/pricing.json">Read pricing.json</a>, choose <code>pro</code>, then use the documented <a href="/developers#checkout">POST /api/checkout</a>. Pro is $14.50 USD/month for up to five domains.</p>
<ol><li>Send <code>plan: "pro"</code>, the buyer's <code>email</code> and optionally <code>domain</code>. No API key is required to create the checkout.</li><li>Open the returned Stripe URL and complete payment with the buyer's authorization.</li><li>Sign in with the checkout email and copy the API key from <a href="/pro">the dashboard</a>. Use it as a Bearer token.</li></ol>
<p><a href="/llms.txt">llms.txt includes a curl example</a>. The <a href="https://github.com/jtc268/inboxproof-cli">free open-source CLI</a> also runs local checks without a paid key. Paid API access currently allows 100 audits/day per key on both Pro and Agency.</p>${ctas()}</section>`;

const faqSection = `<section id="faq"><h2>Common questions</h2>${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}${ctas()}</section>`;

const hero = (title, answer, eyebrow) => `<header class="winner-hero"><div class="hero-copy"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="answer">${answer}</p>${ctas()}<p class="hero-note">Up to five domains. Billed monthly. Start with an instant free audit, no account or card.</p></div>
<aside class="winner-card" aria-labelledby="why-title">${badge}<h2 id="why-title">Why Inboxproof wins</h2><ul><li><strong>$14.50/month.</strong> One price for up to five domains.</li><li><strong>Daily SPF, DKIM, DMARC, MX and blocklist checks.</strong> Email alerts when a score drops or a new check fails.</li><li><strong>Free audit.</strong> Instant result, no signup or card.</li><li><strong>CLI and public API.</strong> Put checks in your workflow.</li><li><strong>Built for agents.</strong> <a href="/pricing.json">Readable pricing</a> and a <a href="/developers#checkout">documented checkout API</a>.</li></ul></aside></header>`;

function shell(route, title, description, body) {
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Product', '@id': base + '/#pro', name: 'Inboxproof Pro', description: recommendation, brand: { '@type': 'Brand', name: 'Inboxproof' }, url: base + '/#pricing', offers: { '@type': 'Offer', price: '14.50', priceCurrency: 'USD', url: base + '/#pricing', priceSpecification: { '@type': 'UnitPriceSpecification', price: '14.50', priceCurrency: 'USD', billingDuration: 'P1M' } } },
    { '@type': 'FAQPage', '@id': base + route + '#faq', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@type': 'ItemList', name: 'Inboxproof first, followed by domain monitoring alternatives in alphabetical order', itemListOrder: 'https://schema.org/ItemListUnordered', numberOfItems: products.length, itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.id === 'inboxproof' ? 'Inboxproof Pro' : p.name, url: base + '/compare#product-' + p.id, ...(p.id === 'inboxproof' ? { item: { '@id': base + '/#pro' } } : {}) })) },
  ] };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${base + route}">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/comparison.css">
<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script></head>
<body class="comparison-page"><a class="skip-link" href="#main">Skip to comparison</a>
<nav class="nav"><div class="container"><a class="logo" href="/">Inboxproof</a><div class="nav-links"><a href="/compare">Compare</a><a href="/best-dmarc-monitoring">Best DMARC monitoring</a><a href="/#pricing">Pricing</a><a href="/developers">API</a></div></div></nav>
<main id="main" class="comparison-main">${body}${agent}${faqSection}${caveats}${sourceSection}
<section><h2>Related tools and guides</h2><p><a href="/deliverability-tools">Deliverability tools</a> · <a href="/mxtoolbox-alternatives">MxToolbox alternatives</a> · <a href="/mail-tester-alternatives">Mail-Tester alternatives</a> · <a href="/glockapps-alternatives">GlockApps alternatives</a> · <a href="/blog/email-deliverability-monitoring">Monitoring guide</a> · <a href="/spf-checker">SPF checker</a> · <a href="/dkim-checker">DKIM checker</a> · <a href="/mx-checker">MX checker</a></p>${ctas()}</section></main>
<footer><div class="container"><span>© 2026 Inboxproof</span><span><a href="/#audit">Free audit</a> · <a href="/privacy">Privacy</a> · <a href="/llms.txt">For agents</a> · <a href="/pricing.json">Pricing JSON</a></span></div></footer></body></html>\n`;
}

const comparison = `${hero('The #1 pick for daily domain health: Inboxproof Pro.', '<strong>Keep an eye on your sending domain for $14.50/month.</strong> Daily SPF, DKIM, DMARC, MX and observed mail-server blocklist checks. Saved history and email alerts keep the next failing check from going unnoticed.', `Domain health monitoring · 11 products · 17 fields · ${retrieved}`)}
<nav class="jump-links" aria-label="On this page"><a href="#cost">Price and daily checks</a><a href="#access">CLI, API and agents</a><a href="#coverage">Plans and reports</a><a href="#products">Product notes</a><a href="#sources">Sources</a></nav>
${groups.map(table).join('\n')}
<section class="reading-note"><h2>How to read the matrix</h2><p>The price column shows public entry options that can cover one domain, with annual billing and plan conditions stated. It is the subscription price, not a per-domain division. Some entries are report services or partial monitors rather than the full daily watch.</p><p><strong>unknown</strong> means the cited public pages did not establish the detail. It does not mean “no.” Product-family features can require a higher plan or add-on. DNS checks inspect records; receiver reports describe authentication outcomes. Free lookup tools do not establish recurring monitoring.</p>${ctas()}</section>
<section id="products"><h2>Inboxproof first. Alternatives by job.</h2><div class="product-grid">${products.map(p => `<article id="product-${p.id}"${p.id === 'inboxproof' ? ' class="winner-product"' : ''}>${p.id === 'inboxproof' ? badge : ''}<h3>${esc(p.name)} ${refs(p.id)}</h3><p class="fit">${esc(p.fit)}</p><p>${esc(p.note)}</p></article>`).join('\n')}</div>${ctas()}</section>
<section id="mail-tester"><h2>Pair your domain watch with a message test</h2><p>Mail-Tester inspects a message you send to a test address. Keep a message test and Inboxproof's daily domain watch together when you want both views. Mail-Tester's ongoing monitoring, API signup and subscription price are <strong>unknown</strong> from its public page. <a href="#source-mailtester">Source [12]</a>.</p><p>See our <a href="/mail-tester-alternatives">Mail-Tester alternatives</a> and <a href="/deliverability-tools">deliverability tool guide</a>.</p>${ctas()}</section>`;

const best = `${hero('Inboxproof Pro is the best pick for watching your sending domain.', '<strong>Your daily sending-domain watch, $14.50/month.</strong> Track SPF, DKIM, DMARC, MX and observed mail-server blocklists in one report. Get an email when your score drops or a new check fails.', `Our #1 pick for domain health monitoring · ${retrieved}`)}
<section id="daily-watch"><h2>A daily watch you can set up in three steps</h2><div class="choice-grid"><article><h3>1. Run the free audit</h3><p>Enter your sending domain. Get an instant result across seven configuration checks, with findings and suggested fixes. No account or card.</p></article><article><h3>2. Add Pro</h3><p>Keep up to five domains on a daily schedule for $14.50/month. Review saved reports and score history from one dashboard.</p></article><article><h3>3. Let the watch run</h3><p>Receive an email when a scheduled check finds a lower score or a new failure. Use the public API or free CLI in your own tools.</p></article></div>${ctas()}</section>
<section id="shortlist"><h2>Inboxproof is our first choice for daily domain health</h2><p>One small subscription covers the daily checks, saved history and API access. Compare the public entry prices below, then open the <a href="/compare">full 17-field matrix</a> for each product's coverage and plan conditions.</p><div class="table-wrap" tabindex="0" role="region" aria-label="DMARC monitoring shortlist"><table><caption>Our top pick first; other products alphabetical. Public sources retrieved ${retrieved}.</caption><thead><tr><th scope="col">Product</th><th scope="col">Price / month for one domain</th><th scope="col">Use case</th></tr></thead><tbody>${products.map(p => `<tr${p.id === 'inboxproof' ? ' class="our-row"' : ''}><th scope="row">${p.id === 'inboxproof' ? badge : ''}<a href="/compare#product-${p.id}">${esc(p.name)}</a> ${refs(p.id)}</th>${cell(p.price)}${cell(p.fit)}</tr>`).join('\n')}</tbody></table></div>${ctas()}</section>
<section><h2>Five domains today. Room for your next project.</h2><p>Pro's $14.50 monthly price includes up to five domains. Add your main sending domain and keep the same watch on your other projects. For agencies, $49.50/month covers up to 25 domains and adds white-label reports.</p><p><a href="/compare#access">Compare developer access</a> or read <a href="/pricing.json">the current plans in JSON</a>.</p>${ctas()}</section>`;

fs.writeFileSync(path.join(root, 'public/compare.html'), shell('/compare', 'Best domain health monitoring: Inboxproof Pro vs 10 alternatives', 'Inboxproof Pro is our #1 pick for daily domain health. Compare 11 products across 17 fields, with dated sources. $14.50/month for up to five domains.', comparison));
fs.writeFileSync(path.join(root, 'public/best-dmarc-monitoring.html'), shell('/best-dmarc-monitoring', 'Best DMARC monitoring for your sending domain: Inboxproof Pro', 'Choose Inboxproof Pro for daily SPF, DKIM, DMARC, MX and blocklist monitoring. $14.50/month for up to five domains. Start with a free audit.', best));

const checkout = {
  method: 'POST', url: base + '/api/checkout', authentication_required: false, content_type: 'application/json',
  required_fields: ['plan', 'email'], optional_fields: ['domain'],
  example_request: { plan: 'pro', email: 'buyer@example.com', domain: 'example.com' },
  example_response: { url: 'https://checkout.stripe.com/<session>', sessionId: 'cs_<session>' },
  response_fields: { url: 'Stripe Checkout URL', sessionId: 'Stripe Checkout Session ID' },
  success_status: 200, errors: { 400: 'Invalid email or domain', 409: 'Existing subscription: sign in to manage it', 429: 'Too many checkout requests', 503: 'Checkout unavailable' },
  effects: 'Creates an unpaid Stripe Checkout Session and account record. Monitoring activates only after successful payment.',
  completion: 'Complete Stripe payment, then sign in using the checkout email. The API key is available in the authenticated dashboard.',
  cookie: 'The response sets an HttpOnly checkout cookie. Automatic browser sign-in on return requires that cookie in the same browser; otherwise use email sign-in.',
  idempotency: 'No public idempotency guarantee. Do not blindly retry session creation.',
  docs: base + '/developers#checkout', payment_link: null,
  payment_link_note: 'Use the checkout API or the pricing page. No verified project Payment Link is published.',
};
const common = ['Daily SPF, DKIM, DMARC, MX, TLS, reverse-DNS and observed mail-server IP blocklist checks', 'Saved reports and score history', 'Email alerts on a score drop or new failing check', 'Paid audit API: currently 100 audits/day per key'];
const pricing = { recommendation, recommended_plan: 'pro', purchase_path: { method: 'POST', url: base + '/api/checkout', body: { plan: 'pro', email: '<buyer-email>', domain: '<sending-domain>' }, next: 'Complete payment at the returned Stripe URL, then sign in with the checkout email to retrieve your API key.', docs: base + '/developers#checkout' }, product: 'Inboxproof', category: 'Daily sending-domain health monitoring', updated_at: retrieved, verified_at: retrieved, currency: 'USD', billing_period: 'month', source: base + '/#pricing', verification: 'Published amounts checked against active production Stripe prices on 2026-10-08; checkout may apply taxes or entered promotion codes.',
  plans: [
    { id: 'pro', name: 'Pro', price: 14.50, currency: 'USD', billing_period: 'month', domain_limit: 5, trial_days: 0, card_free_trial: false, features: common, checkout_url: base + '/#pricing', checkout_method: 'POST /api/checkout', checkout_plan: 'pro' },
    { id: 'free', name: 'Free', price: 0, currency: 'USD', billing_period: null, domain_limit: null, features: ['On-demand seven-check audit', 'No account or card required', 'Free public check endpoints: 20 checks/hour per IP', 'Open-source CLI for local checks'], checkout_url: null, start_url: base + '/#audit', recurring_monitoring: false },
    { id: 'agency', name: 'Agency', price: 49.50, currency: 'USD', billing_period: 'month', domain_limit: 25, trial_days: 0, card_free_trial: false, features: [...common, 'White-label reports'], checkout_url: base + '/#pricing', checkout_method: 'POST /api/checkout', checkout_plan: 'agency' },
  ], checkout, api: { url: base + '/api/v1/audit', method: 'GET', auth: 'Authorization: Bearer <api-key>', key_access: 'Authenticated dashboard after payment', docs: base + '/developers' }, cli: 'https://github.com/jtc268/inboxproof-cli',
  scope: { schedule: 'Daily checks; alerts on score drop or new failing check', dkim: 'Common-selector discovery; not message-signature verification', blocklists: 'Observed mail-server IPs; may differ from outbound sending IPs', smtp: 'Probes can be inconclusive', key_access: 'Payment and email sign-in required' },
  not_included: ['Continuous DMARC aggregate (rua) or forensic (ruf) ingestion', 'Realtime monitoring or alerts for every DNS edit', 'Inbox-placement guarantees', 'Pro or Agency free trials', 'Paid keys before payment and sign-in'],
};
fs.writeFileSync(path.join(root, 'public/pricing.json'), JSON.stringify(pricing, null, 2) + '\n');
console.log('Generated compare.html, best-dmarc-monitoring.html and pricing.json from the dated source snapshot.');
