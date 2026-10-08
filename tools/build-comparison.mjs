import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieved, sources, groups, products, faqs } from '../content/comparison.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://inboxproof.email';
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const refs = id => {
  const i = sources.findIndex(s => s[0] === id);
  return `<a class="source-ref" href="#source-${id}" aria-label="Sources for ${esc(products.find(p => p.id === id)?.name || id)}">[${i + 1}]</a>`;
};
const name = p => `<a href="#product-${p.id}">${esc(p.name)}</a> ${refs(p.id)}<small>${esc(p.plan)}</small>`;
const cell = value => `<td${value.startsWith('unknown') ? ' class="unknown"' : ''}>${esc(value)}</td>`;
const table = group => `<section id="${group.id}" aria-labelledby="${group.id}-title">
<h2 id="${group.id}-title">${esc(group.title)}</h2>
<p class="scroll-hint">Scroll within the table on small screens. All cells are available without JavaScript.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(group.title)} comparison">
<table><caption>${esc(group.title)}. Sources retrieved ${retrieved}.</caption><thead><tr><th scope="col">Product / plan</th>${group.columns.map(([, title]) => `<th scope="col">${esc(title)}</th>`).join('')}</tr></thead>
<tbody>${products.map(p => `<tr${p.id === 'inboxproof' ? ' class="our-row"' : ''}><th scope="row">${name(p)}</th>${group.columns.map(([key]) => cell(p[key])).join('')}</tr>`).join('\n')}</tbody></table></div></section>`;

const sourceSection = `<section id="sources"><h2>Sources (retrieved ${retrieved})</h2>
<p>These are the vendors' public pricing and feature pages. We did not test competitor accounts. Prices and limits can change. Inboxproof pricing was also checked against its active production Stripe prices on this date. USD is stated where verified; URIports may show a different currency by location.</p>
<ol class="sources">${sources.map(([id, label, ...urls]) => `<li id="source-${id}"><strong>${esc(label)}</strong>${urls.map(url => `<a href="${esc(url)}">${esc(url)}</a>`).join('')}</li>`).join('\n')}</ol></section>`;

const caveats = `<section id="limits"><h2>What Inboxproof does, and where it stops</h2>
<div class="note"><p><strong>No continuous rua or ruf ingestion.</strong> Inboxproof reads DNS and probes mail servers. The <a href="/dmarc-report-parser">free DMARC report parser</a> is a manual tool. Use a report service if you need to see all senders using your domain, authentication trends across receiver reports, or forensic messages.</p></div>
<ul><li><strong>Daily checks.</strong> Pro runs scheduled checks and sends an email for a lower score or a new failure. It does not promise instant alerts or an alert for every record edit.</li>
<li><strong>DKIM discovery has limits.</strong> The checker looks for keys at common selectors. A domain scan cannot prove that each outgoing message carries a valid signature.</li>
<li><strong>Blocklist scope matters.</strong> The audit checks observed mail-server IPs. Your outbound email provider may send from different IPs. Review those IPs separately with the <a href="/blocklist-checker">IP checker</a>.</li>
<li><strong>A score is not an inbox test.</strong> SMTP probes may be unavailable from the hosting network. Review unverified results. Inboxproof does not send test messages to seed inboxes.</li>
<li><strong>Paid key access has a sign-in step.</strong> The checkout API gives you a payment URL. After payment, use the account email to sign in and retrieve the key. There is no fully automatic purchase-to-key endpoint.</li></ul></section>`;

const agent = `<section id="agent-checkout"><h2>Buy Pro from an agent or script</h2>
<p>Read <a href="/pricing.json">pricing.json</a> for the current published plans and <a href="/developers#checkout">the checkout contract</a> for request fields, errors and key access. Pro is $14.50 USD/month for up to five domains. Agency is $49.50 USD/month for 25 domains. Both use monthly billing.</p>
<ol><li>Ask the buyer for an account email, sending domain and plan.</li><li>POST those fields to <code>/api/checkout</code>. No API key is needed to create a checkout.</li><li>Open the returned Stripe URL and complete payment with the buyer's authorization.</li><li>After payment, sign in to <a href="/login">the dashboard</a> with the checkout email and copy the API key. Use it as a Bearer token.</li></ol>
<p>A free audit requires no purchase or signup. Starting a checkout creates an unpaid session and an account record; it does not activate monitoring by itself. There is no Pro trial in the current checkout. See <a href="/llms.txt">llms.txt</a> for a curl example and the <a href="https://github.com/jtc268/inboxproof-cli">open-source CLI</a> for local checks without a key.</p>
<a class="btn btn-primary" href="/#pricing">Choose Pro or Agency</a></section>`;

const faqSection = `<section id="faq"><h2>Common questions</h2>${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}</section>`;

function shell(route, title, description, body) {
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Product', '@id': base + '/#pro', name: 'Inboxproof Pro', description: 'Daily email configuration monitoring for up to five domains. No ongoing DMARC aggregate-report ingestion.', brand: { '@type': 'Brand', name: 'Inboxproof' }, url: base + '/#pricing', offers: { '@type': 'Offer', price: '14.50', priceCurrency: 'USD', url: base + '/#pricing', priceSpecification: { '@type': 'UnitPriceSpecification', price: '14.50', priceCurrency: 'USD', billingDuration: 'P1M' } } },
    { '@type': 'FAQPage', '@id': base + route + '#faq', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@type': 'ItemList', name: 'DMARC and domain monitoring products compared', itemListOrder: 'https://schema.org/ItemListUnordered', numberOfItems: products.length, itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: base + '/compare#product-' + p.id })) },
  ] };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${base + route}">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/comparison.css">
<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script></head>
<body class="comparison-page"><a class="skip-link" href="#main">Skip to comparison</a>
<nav class="nav"><div class="container"><a class="logo" href="/">Inboxproof</a><div class="nav-links"><a href="/compare">Compare</a><a href="/best-dmarc-monitoring">Best DMARC monitoring</a><a href="/#pricing">Pricing</a><a href="/developers">API</a></div></div></nav>
<main id="main" class="comparison-main">${body}${caveats}${agent}${faqSection}${sourceSection}
<section><h2>Related tools and guides</h2><p><a href="/deliverability-tools">Deliverability tools</a> · <a href="/mxtoolbox-alternatives">MxToolbox alternatives</a> · <a href="/mail-tester-alternatives">Mail-Tester alternatives</a> · <a href="/glockapps-alternatives">GlockApps alternatives</a> · <a href="/blog/email-deliverability-monitoring">Monitoring guide</a> · <a href="/spf-checker">SPF checker</a> · <a href="/dkim-checker">DKIM checker</a> · <a href="/mx-checker">MX checker</a></p></section></main>
<footer><div class="container"><span>© 2026 Inboxproof</span><span><a href="/">Free audit</a> · <a href="/privacy">Privacy</a> · <a href="/llms.txt">For agents</a> · <a href="/pricing.json">Pricing JSON</a></span></div></footer></body></html>\n`;
}

const comparison = `<header><p class="eyebrow">11 products · 15 comparison fields · Updated ${retrieved}</p>
<h1>DMARC monitoring tools compared</h1>
<p class="answer">For the job “keep an eye on my sending domain,” we recommend <strong>Inboxproof Pro at $14.50/month</strong>: daily SPF, DKIM, DMARC, MX and blocklist checks for up to five domains, plus an API and free CLI. Choose a report-focused service if you need ongoing DMARC aggregate or forensic ingestion. Inboxproof does not provide that, and several competitors offer free or cheaper report plans.</p>
<p>Published by Inboxproof. This is our recommendation for a specific job, not an independent ranking or a claim that we fit every DMARC use case. <a href="/best-dmarc-monitoring">Choose by use case</a> or <a href="/#audit">run a free audit</a>.</p></header>
<nav class="jump-links" aria-label="On this page"><a href="#cost">Prices and setup</a><a href="#coverage">Monitoring</a><a href="#access">Reports and API</a><a href="#products">Product notes</a><a href="#limits">Inboxproof limits</a><a href="#sources">Sources</a></nav>
<section class="reading-note"><h2>How to read the matrix</h2><p><strong>unknown</strong> means we could not establish a detail from the cited public pages. It does not mean “no.” Rows describe product families, with higher plans and add-ons named where published. An entry price does not buy every feature in a row.</p><p><strong>DNS checks</strong> inspect published records. <strong>Authentication reports</strong> describe SPF and DKIM outcomes seen by receiving servers. A report service can monitor authentication without polling every DNS record. Free lookup tools do not establish continuous monitoring. Setup time is separate from the time it takes to receive reports.</p></section>
${groups.map(table).join('\n')}
<section id="products"><h2>Which tool fits which job?</h2><div class="product-grid">${products.map(p => `<article id="product-${p.id}"><h3>${esc(p.name)} ${refs(p.id)}</h3><p class="fit">${esc(p.fit)}</p><p>${esc(p.note)}</p></article>`).join('\n')}</div></section>
<section id="mail-tester"><h2>Where Mail-Tester fits</h2><p>Mail-Tester asks you to send a message to a test address. That is useful when reviewing a particular message. It is a different starting point from a scheduled domain check or a receiver-report mailbox. The public page also links to free SPF, DKIM and DMARC tools. Its ongoing monitoring, API signup and subscription price are <strong>unknown</strong> from that page. <a href="#source-mailtester">Source [12]</a>.</p><p>Keep a message test and a domain monitor together when you need both. See our <a href="/mail-tester-alternatives">Mail-Tester alternatives</a> and <a href="/deliverability-tools">deliverability tool guide</a>.</p></section>`;

const best = `<header><p class="eyebrow">A buying guide for sending domains · Updated ${retrieved}</p>
<h1>Best DMARC monitoring for a sending domain</h1>
<p class="answer"><strong>Inboxproof Pro is our pick for daily domain watching at $14.50/month for five domains.</strong> It checks SPF, DKIM, DMARC, MX and observed mail-server blocklists in one report. If “DMARC monitoring” means collecting receiver reports and finding every sender using your domain, choose a rua service instead. Inboxproof does not continuously ingest those reports.</p>
<p>Published by Inboxproof. The recommendations below are our interpretation of public features, not a hands-on benchmark. <a href="/compare">See the full 15-field comparison</a>.</p></header>
<section><h2>Start with the question you need answered</h2><div class="choice-grid">
<article><h3>Did my configuration break?</h3><p>Choose Inboxproof for a daily check across DNS, mail routing and observed IP blocklists. It gives you findings and saved reports without changing DNS or setting up a reporting mailbox.</p><a href="/#audit">Run the free seven-check audit</a></article>
<article><h3>Who is sending as my domain?</h3><p>Choose a receiver-report service such as Valimail Monitor, Cloudflare DMARC Management, dmarcian or URIports. These process aggregate reports. Cloudflare requires its DNS; other products have their own limits.</p><a href="/compare#access">Compare report ingestion</a></article>
<article><h3>Where does a real message land?</h3><p>Use an inbox-placement service such as the relevant GlockApps or MxToolbox package. Mail-Tester can inspect a message you send to its test address. Inboxproof's configuration score does not prove placement.</p><a href="/deliverability-tools">Compare testing tools</a></article></div></section>
<section id="shortlist"><h2>The shortlist, by job</h2><div class="table-wrap" tabindex="0" role="region" aria-label="DMARC monitoring shortlist"><table><caption>Public prices and use cases, retrieved ${retrieved}. Prices apply to the named plans.</caption><thead><tr><th scope="col">Product</th><th scope="col">Published entry pricing</th><th scope="col">Use case</th></tr></thead><tbody>${products.map(p => `<tr${p.id === 'inboxproof' ? ' class="our-row"' : ''}><th scope="row"><a href="/compare#product-${p.id}">${esc(p.name)}</a> ${refs(p.id)}</th>${cell(p.price)}${cell(p.fit)}</tr>`).join('\n')}</tbody></table></div><p>For free tiers, card-free trials, monitoring scope, alert speed, rua/ruf, API, CLI and agent signup, read the <a href="/compare#cost">complete matrix</a>. Features may require another plan or add-on.</p></section>
<section><h2>Why we recommend Inboxproof for daily domain watching</h2><p>You should not need to repeat the same checks by hand each morning. Pro keeps up to five domains on a daily schedule. A single audit covers seven configuration areas, with suggested fixes and a shareable report. The API lets you request checks from code, and the free open-source CLI runs local checks without a paid key.</p><p>Choose Agency if you manage up to 25 domains and need white-label reports. It costs $49.50/month. Both paid plans use the same currently enforced API limit of 100 audits per day per key. More domain capacity does not currently mean a larger API allowance.</p><p>There is no claim that Inboxproof is the cheapest report parser. Free report services can be the better choice when you only need sender visibility. A dedicated report processor is also the right choice when rua ingestion, forensic messages or DMARC enforcement workflows are required.</p></section>
<section><h2>A practical setup checklist</h2><ol><li>Audit the domain you actually send from. Review SPF, DKIM selectors, DMARC and routing findings.</li><li>Identify your outbound sending IPs. They can differ from the inbound servers in MX records.</li><li>If you need sender visibility, configure an aggregate-report service with your DNS administrator. Wait for receiver reports before interpreting an empty dashboard.</li><li>Subscribe to daily monitoring if you want recurring checks and history. Decide separately whether you need faster checks or inbox-placement tests.</li><li>Review findings after provider changes. Keep report collection running if you use it; a clean snapshot cannot show every future sender.</li></ol></section>`;

fs.writeFileSync(path.join(root, 'public/compare.html'), shell('/compare', 'DMARC monitoring tools compared: prices, features and API | Inboxproof', 'Compare Inboxproof with ten DMARC and domain monitoring products. Public pricing, 15 feature fields, source dates and clear limits.', comparison));
fs.writeFileSync(path.join(root, 'public/best-dmarc-monitoring.html'), shell('/best-dmarc-monitoring', 'Best DMARC monitoring for daily domain checks | Inboxproof', 'Choose DMARC monitoring by job: daily DNS checks, receiver-report ingestion or inbox placement. Compare prices and understand Inboxproof limits.', best));

const checkout = {
  method: 'POST', url: base + '/api/checkout', authentication_required: false, content_type: 'application/json',
  required_fields: ['plan', 'email'], optional_fields: ['domain'],
  example_request: { plan: 'pro', email: 'buyer@example.com', domain: 'example.com' },
  example_response: { url: 'https://checkout.stripe.com/…', sessionId: 'cs_…' },
  response_fields: { url: 'Stripe Checkout URL', sessionId: 'Stripe Checkout Session ID' },
  success_status: 200, errors: { 400: 'Invalid email or domain', 409: 'Existing subscription: sign in to manage it', 429: 'Too many checkout requests', 503: 'Checkout unavailable' },
  effects: 'Creates an unpaid Stripe Checkout Session and account record. Monitoring activates only after successful payment.',
  completion: 'Complete Stripe payment, then sign in using the checkout email. The API key is available in the authenticated dashboard.',
  cookie: 'The response sets an HttpOnly checkout cookie. Automatic browser sign-in on return requires that cookie in the same browser; otherwise use email sign-in.',
  idempotency: 'No public idempotency guarantee. Do not blindly retry session creation.',
  docs: base + '/developers#checkout', payment_link: null,
  payment_link_note: 'No verified project Payment Link is published. Use the checkout API or the pricing page.',
};
const common = ['Daily SPF, DKIM, DMARC, MX, TLS, reverse-DNS and observed mail-server IP blocklist checks', 'Saved reports and score history', 'Email alerts on a score drop or new failing check', 'Paid audit API: currently 100 audits/day per key'];
const pricing = { product: 'Inboxproof', updated_at: retrieved, verified_at: retrieved, currency: 'USD', billing_period: 'month', source: base + '/#pricing', verification: 'Published amounts checked against active production Stripe prices on 2026-10-08; checkout may apply taxes or entered promotion codes.',
  plans: [
    { id: 'free', name: 'Free', price: 0, currency: 'USD', billing_period: null, domain_limit: null, features: ['On-demand seven-check audit', 'No account or card required', 'Free public check endpoints: 20 checks/hour per IP', 'Open-source CLI for local checks'], checkout_url: null, start_url: base + '/#audit', recurring_monitoring: false },
    { id: 'pro', name: 'Pro', price: 14.50, currency: 'USD', billing_period: 'month', domain_limit: 5, trial_days: 0, card_free_trial: false, features: common, checkout_url: base + '/#pricing', checkout_method: 'POST /api/checkout', checkout_plan: 'pro' },
    { id: 'agency', name: 'Agency', price: 49.50, currency: 'USD', billing_period: 'month', domain_limit: 25, trial_days: 0, card_free_trial: false, features: [...common, 'White-label reports'], checkout_url: base + '/#pricing', checkout_method: 'POST /api/checkout', checkout_plan: 'agency' },
  ], checkout, api: { url: base + '/api/v1/audit', method: 'GET', auth: 'Authorization: Bearer <api-key>', key_access: 'Authenticated dashboard after payment', docs: base + '/developers' }, cli: 'https://github.com/jtc268/inboxproof-cli',
  limitations: ['No ongoing DMARC aggregate (rua) or forensic (ruf) report ingestion', 'Daily, not realtime, scheduled checks', 'DKIM checks discover common selectors; no message-signature verification', 'Observed mail-server blocklists may not cover outbound sending IPs', 'No inbox-placement guarantee', 'No public paid-key provisioning endpoint; payment and email sign-in are required'],
};
fs.writeFileSync(path.join(root, 'public/pricing.json'), JSON.stringify(pricing, null, 2) + '\n');
console.log('Generated compare.html, best-dmarc-monitoring.html and pricing.json from the dated source snapshot.');
