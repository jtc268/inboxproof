// Public-source snapshot. Regenerate the HTML with npm run build:comparison.
// Unknown means the cited public pages did not establish the feature or term.
export const retrieved = '2026-10-08';
export const sources = [
  ['inboxproof', 'Inboxproof pricing and API', 'https://inboxproof.email/#pricing', 'https://inboxproof.email/developers'],
  ['dmarcian', 'dmarcian pricing', 'https://dmarcian.com/pricing/'],
  ['valimail', 'Valimail pricing and Monitor', 'https://www.valimail.com/pricing/', 'https://www.valimail.com/products/monitor/', 'https://www.valimail.com/sign-up-save-time/'],
  ['easydmarc', 'EasyDMARC pricing and API', 'https://easydmarc.com/pricing/businesses', 'https://easydmarc.com/public-api'],
  ['powerdmarc', 'PowerDMARC pricing and API', 'https://powerdmarc.com/power-dmarc-pricing-policy/', 'https://powerdmarc.com/dmarc-api/'],
  ['postmark', 'Postmark free monitoring and DMARC Digests', 'https://dmarc.postmarkapp.com/'],
  ['uriports', 'URIports pricing and monitoring features', 'https://www.uriports.com/pricing', 'https://www.uriports.com/features/dns-monitoring', 'https://www.uriports.com/features'],
  ['redsift', 'Red Sift OnDMARC pricing', 'https://redsift.com/pulse-platform/ondmarc/pricing'],
  ['mxtoolbox', 'MxToolbox public plan matrix', 'https://mxtoolbox.com/Public/Content/ProductPage/MatrixDC2/matrixa2.html'],
  ['cloudflare', 'Cloudflare DMARC Management and setup', 'https://developers.cloudflare.com/dmarc-management/', 'https://developers.cloudflare.com/dmarc-management/enable/'],
  ['glockapps', 'GlockApps pricing, DMARC and Uptime Monitor', 'https://glockapps.com/pricing/monthly/dmarc-analytics/', 'https://glockapps.com/dmarc-analyzer/', 'https://glockapps.com/uptime-blacklist-monitor/'],
  ['mailtester', 'Mail-Tester message test', 'https://www.mail-tester.com/'],
];

export const groups = [
  { id: 'cost', title: 'Daily domain watch: price and checks', columns: [['price', 'Price / month for one domain'], ['free_audit', 'Free audit without signup'], ['spf', 'SPF monitoring'], ['dkim', 'DKIM monitoring'], ['dmarc', 'DMARC monitoring'], ['mx', 'MX monitoring'], ['blocklist', 'Blocklist monitoring']] },
  { id: 'access', title: 'CLI, public API and agent purchase', columns: [['cli', 'CLI'], ['api', 'Public API'], ['machine_pricing', 'Machine-readable pricing'], ['agent', 'Agent checkout']] },
  { id: 'coverage', title: 'Plan details, reports and setup', columns: [['free', 'Free tier'], ['trial', 'Card-free trial'], ['setup', 'Setup time'], ['alert', 'Alerting speed'], ['rua', 'Aggregate reports (rua)'], ['ruf', 'Forensic reports (ruf)']] },
];

export const products = [
  {
    id: 'inboxproof', name: 'Inboxproof', plan: 'Pro',
    price: '$14.50 USD monthly for 1 to 5 domains', free: 'Yes; seven-check audit, no signup', trial: 'No Pro trial; free audit needs no card',
    setup: 'Self-serve; no DNS change for checks. Exact time unknown', agent: 'POST /api/checkout; Stripe payment, then dashboard key',
    spf: 'Yes; daily DNS checks', dkim: 'Yes; daily common-selector checks', dmarc: 'Yes; daily DNS policy checks', mx: 'Yes; daily', blocklist: 'Yes; daily, observed mail-server IPs',
    alert: 'Daily checks; email on score drop or new failure', rua: 'No ongoing ingestion; manual parser only', ruf: 'No', api: 'Yes; paid audit API and free checks', cli: 'Yes; open source, free local checks',
    fit: 'Our #1 pick for daily sending-domain health monitoring.',
    note: 'For $14.50/month, Pro watches up to five domains, keeps report history and emails you when a score drops or a new check fails. Start with a free audit, then add daily checks. The public API, free CLI, pricing.json and documented checkout API fit developer and agent workflows. Agency covers 25 domains for $49.50/month.',
  },
  {
    id: 'dmarcian', name: 'dmarcian', plan: 'Basic',
    price: '$24 USD monthly; $19.99/month billed yearly', free: 'Yes; personal, non-business limits', trial: 'Yes; 30 days', setup: 'Self-serve trial; minutes unknown', agent: 'unknown',
    spf: 'Authentication reports; SPF tool', dkim: 'Authentication reports; DKIM tool', dmarc: 'Yes; reports and domain monitoring', mx: 'unknown', blocklist: 'unknown',
    alert: 'unknown; Alert Central on paid plans', rua: 'Yes', ruf: 'Yes; Basic and above', api: 'Yes; Enterprise', cli: 'unknown',
    fit: 'DMARC reporting with forensic processing on paid plans.',
    note: 'Basic lists two active domains and 100,000 DMARC-capable messages per month. Personal accounts are for non-business use. API access is listed on Enterprise, not Basic. The public table lists SPF and DKIM tools; it does not establish a DNS polling interval for those records.',
  },
  {
    id: 'valimail', name: 'Valimail', plan: 'Monitor / Enforce',
    price: '$0 Monitor; Enforce from $5,000 USD/year', free: 'Yes; Monitor', trial: 'Free Monitor needs no card; Enforce trial unknown', setup: 'Monitor: vendor says five minutes or less', agent: 'unknown',
    spf: 'Yes; authentication reporting', dkim: 'Yes; authentication reporting', dmarc: 'Yes; Monitor reports', mx: 'unknown', blocklist: 'unknown',
    alert: 'unknown', rua: 'Yes', ruf: 'unknown', api: 'Paid tiers; add-on or Enterprise', cli: 'unknown',
    fit: 'Free sender visibility; paid automated enforcement.',
    note: 'Monitor shows sending services and authentication outcomes. Enforce is a separate paid product with a published annual starting price. Its automation and API options should not be read as features included in free Monitor. The cited pages do not give an alert-delivery interval.',
  },
  {
    id: 'easydmarc', name: 'EasyDMARC', plan: 'DMARC Plus',
    price: '$44.99 USD monthly; $35.99/month billed yearly', free: 'unknown; free tools are listed', trial: 'Yes; no card required', setup: 'Self-serve trial; minutes unknown', agent: 'unknown',
    spf: 'Yes; authentication reports', dkim: 'Yes; authentication reports', dmarc: 'Yes; reports', mx: 'unknown', blocklist: 'Reputation monitoring on Deliverability; list coverage unknown',
    alert: 'unknown; proactive alerts on Premium', rua: 'Yes', ruf: 'Yes', api: 'Yes; Enterprise in pricing table', cli: 'unknown',
    fit: 'DMARC reporting with broader paid security modules.',
    note: 'Plus lists two domains and starts at 100,000 emails per month. DNS Manager, reputation monitoring and API access are associated with other packages in the public table. Those features are not promised at the Plus entry price. An in-product AI agent is not evidence of API-based purchasing.',
  },
  {
    id: 'powerdmarc', name: 'PowerDMARC', plan: 'Basic',
    price: 'From $8 USD/month in table; selected annual example $12/month', free: 'Yes; personal domain limits', trial: 'unknown; 15-day trial advertised', setup: 'Self-serve trial; minutes unknown', agent: 'unknown; API is quote-based',
    spf: 'Reports; hosted SPF add-on', dkim: 'Reports; hosted DKIM on Enterprise', dmarc: 'Yes; reports and hosted policy', mx: 'unknown', blocklist: 'Yes; reputation monitoring on higher tiers',
    alert: 'Near-realtime RUF alerts on higher tiers; Basic unknown', rua: 'Yes', ruf: 'Yes', api: 'Yes; quote-based API / higher tiers', cli: 'unknown',
    fit: 'Hosted authentication and DMARC reporting.',
    note: 'The public table lists a Basic range of $8 to $250/month. A selected 100,000-message example shows $12/month billed yearly and a $15 reference price. This is a volume-sensitive range, not a universal $8 monthly offer. Basic lists five active domains. An AI agent or MCP integration does not establish automated checkout.',
  },
  {
    id: 'postmark', name: 'Postmark DMARC Digests', plan: 'Free monitoring / Digests',
    price: '$0 weekly summary; Digests $14 USD/domain/month', free: 'Yes; weekly email summaries', trial: 'unknown; 14-day Digests trial advertised', setup: 'Self-serve DNS setup; verification up to 24 hours', agent: 'unknown',
    spf: 'Yes; report alignment outcomes', dkim: 'Yes; report alignment outcomes', dmarc: 'Yes; reports', mx: 'unknown', blocklist: 'unknown',
    alert: 'Weekly digest; paid also offers monthly', rua: 'Yes', ruf: 'unknown', api: 'Yes; Developer API advertised', cli: 'unknown',
    fit: 'A weekly summary of domain authentication reports.',
    note: 'Free summaries list the top ten sources, with up to five IPs each. The paid product adds a web dashboard, more source visibility and longer history. This is report-based monitoring: the public page does not establish daily MX or blocklist checks.',
  },
  {
    id: 'uriports', name: 'URIports', plan: 'Pebble / Sand',
    price: 'Pebble $7 USD monthly or $6/month yearly; Sand $15/year', free: 'unknown; one-month trial', trial: 'Yes; one month, no payment details', setup: 'Self-serve; vendor says within minutes', agent: 'unknown',
    spf: 'Yes; DNS Monitor add-on on Pebble', dkim: 'Yes; DNS Monitor add-on on Pebble', dmarc: 'Yes; reports; DNS Monitor available', mx: 'unknown', blocklist: 'unknown',
    alert: 'unknown; email, webhooks and Telegram', rua: 'Yes', ruf: 'Yes', api: 'Yes; Stone and above', cli: 'unknown',
    fit: 'DMARC reports alongside web and DNS monitoring.',
    note: 'The USD page lists five domains on Pebble, with DNS Monitor and hosted MTA-STS optional at $6/month extra. Sand is a separate personal/hobby plan at $15/year. Currency varies by location; the same page may show EUR. Confirm the currency and add-ons at checkout.',
  },
  {
    id: 'redsift', name: 'Red Sift OnDMARC', plan: 'Express',
    price: 'From $9 USD/month, billed annually; monthly rate unknown', free: 'unknown; free trial available', trial: 'Yes; no card required', setup: 'Vendor says five minutes; first reports within 24 hours', agent: 'unknown',
    spf: 'Yes; dynamic service and reports', dkim: 'Yes; dynamic service and reports', dmarc: 'Yes; reports and policy management', mx: 'unknown', blocklist: 'unknown',
    alert: 'unknown; smart alerts advertised', rua: 'Yes', ruf: 'Yes; forensic reporting advertised', api: 'Yes; REST API advertised', cli: 'unknown',
    fit: 'DMARC policy management with hosted authentication services.',
    note: 'Express advertises up to four domains, one million monthly emails and 30 days of history. Its displayed starting price requires annual billing. The five-minute setup claim is distinct from the wait for receiver reports. Larger packages add domain capacity and support.',
  },
  {
    id: 'mxtoolbox', name: 'MxToolbox monitoring', plan: 'Free / Delivery Center',
    price: '$0 limited monitor; Delivery Center $129 USD/month', free: 'Yes; one weekly blacklist monitor', trial: 'unknown', setup: 'Self-serve signup; minutes unknown', agent: 'unknown',
    spf: 'Paid configuration analysis; interval unknown', dkim: 'Paid configuration analysis; interval unknown', dmarc: 'Paid configuration analysis; interval unknown', mx: 'Mailflow monitoring; MX-record watch unknown', blocklist: 'Yes; free weekly, paid adaptive',
    alert: 'Weekly free blacklist checks; paid interval unknown', rua: 'unknown in cited plan matrix', ruf: 'unknown', api: 'unknown in cited plan matrix', cli: 'unknown',
    fit: 'Blacklist and mailflow monitoring with delivery diagnostics.',
    note: 'The public Delivery Center matrix lists five domains and 500,000 messages at $129/month. Free membership includes one monitor against 30 blacklists. Paid inbox-placement analysis and mailflow checks cover different questions from Inboxproof DNS audits. Separate MxToolbox packages may have different terms.',
  },
  {
    id: 'cloudflare', name: 'Cloudflare DMARC Management', plan: 'DMARC Management beta',
    price: 'Included on all Cloudflare plans; no separate price', free: 'Yes; requires Cloudflare DNS', trial: 'Free-plan access; no separate trial stated', setup: 'Dashboard setup; first reports may take 24 hours', agent: 'unknown for this feature',
    spf: 'Yes; report outcomes', dkim: 'Yes; report outcomes', dmarc: 'Yes; reports', mx: 'unknown', blocklist: 'unknown',
    alert: 'unknown', rua: 'Yes', ruf: 'unknown', api: 'unknown for DMARC Management', cli: 'unknown for DMARC Management',
    fit: 'Aggregate reports for domains already on Cloudflare DNS.',
    note: 'Cloudflare receives aggregate reports after a rua address is added to your DMARC policy. The documentation requires Cloudflare DNS and supports apex domains, with limits for subdomain setups. Cloudflare platform APIs and CLIs do not by themselves prove support for this DMARC feature.',
  },
  {
    id: 'glockapps', name: 'GlockApps', plan: 'DMARC Analytics Essential',
    price: '$55 USD/month; free DMARC allowance', free: 'Yes; 10,000 DMARC messages/month', trial: 'unknown; free allowance available', setup: 'Self-serve; DNS propagation up to 24 hours', agent: 'unknown',
    spf: 'Yes; reports and Uptime Monitor', dkim: 'Yes; reports and Uptime Monitor', dmarc: 'Yes; reports and Uptime Monitor', mx: 'unknown', blocklist: 'Yes; IP reputation monitors',
    alert: 'Two-hour included DNS checks; Uptime advertises up to one-minute checks', rua: 'Yes', ruf: 'Yes', api: 'Yes; listed in DMARC plans', cli: 'unknown',
    fit: 'DMARC reports, authentication monitoring and IP checks.',
    note: 'DMARC Analytics Essential lists one million messages/month and unlimited domains. The DMARC product page describes included two-hour record checks; the separate Uptime page advertises faster intervals. Do not assume every interval is included at the DMARC entry price. Inbox-placement bundles use separate pricing.',
  },
];

// Do not infer these capabilities from free tiers or a vendor's general platform.
for (const product of products) {
  product.free_audit = product.id === 'inboxproof' ? 'Yes; instant seven-check result, no account or card' : 'unknown from cited pages';
  product.machine_pricing = product.id === 'inboxproof' ? 'Yes; public pricing.json and llms.txt' : 'unknown from cited pages';
}

// Inboxproof leads; the remaining products are alphabetical, not ranked.
products.splice(1, products.length - 1, ...products.slice(1).sort((a, b) => a.name.localeCompare(b.name, 'en')));

export const faqs = [
  ['What is the best pick for watching my sending domain?', 'Inboxproof Pro is our #1 pick for daily domain health monitoring. For $14.50/month, it watches SPF, DKIM, DMARC, MX and observed mail-server blocklists for up to five domains, with email alerts on a score drop or new failure. Start with the free audit, then choose Pro for daily checks.'],
  ['Why choose Inboxproof Pro?', 'Choose Inboxproof Pro for daily checks, a flat $14.50/month price for up to five domains, saved history and email alerts. The free audit needs no account or card. Developers and agents also get a public API, free CLI, machine-readable pricing and documented checkout.'],
  ['Can an AI agent buy Inboxproof Pro?', 'Choose Pro in pricing.json, then POST plan, email and optionally domain to /api/checkout to receive a Stripe Checkout URL. Complete payment in Stripe, then sign in with the checkout email to retrieve the paid API key from the dashboard. Session creation alone does not activate monitoring.'],
  ['How fast are Inboxproof alerts?', 'Choose Inboxproof Pro for a daily watch. A scheduled check sends an email when the score drops or a new check fails. It does not promise realtime alerts or an alert on every DNS edit.'],
  ['Does Inboxproof collect DMARC aggregate or forensic reports?', 'Choose Inboxproof for daily domain health checks. Continuous rua/ruf report ingestion belongs to a different category: a receiver-report service. Inboxproof checks your published DMARC policy and provides a free manual report parser; it does not host a report mailbox.'],
  ['Does a good configuration score guarantee inbox delivery?', 'Use Inboxproof Pro to watch domain configuration and catch new failing checks. Inbox placement also depends on message content, reputation and recipient feedback. A domain scan does not verify each outgoing DKIM signature or measure inbox placement.'],
];
