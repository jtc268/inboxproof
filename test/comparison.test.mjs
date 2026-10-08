import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = file => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const pricing = JSON.parse(read('pricing.json'));
const names = ['Inboxproof', 'Cloudflare DMARC Management', 'dmarcian', 'EasyDMARC', 'GlockApps', 'MxToolbox monitoring', 'Postmark DMARC Digests', 'PowerDMARC', 'Red Sift OnDMARC', 'URIports', 'Valimail'];

test('comparison covers all vendors and 17 fields in accessible, server-rendered tables', () => {
  const dom = new JSDOM(read('compare.html'));
  const doc = dom.window.document;
  const tables = [...doc.querySelectorAll('table')];
  assert.equal(tables.length, 3);
  for (const [tableIndex, table] of tables.entries()) {
    assert.ok(table.querySelector('caption'));
    assert.equal(table.querySelectorAll('thead th[scope="col"]').length, [8, 5, 7][tableIndex]);
    const rows = [...table.querySelectorAll('tbody tr')];
    assert.equal(rows.length, names.length);
    names.forEach((name, i) => {
      assert.ok(rows[i].querySelector('th[scope="row"]').textContent.includes(name));
      assert.equal(rows[i].querySelectorAll('td').length, [7, 4, 6][tableIndex]);
      assert.ok(rows[i].querySelector('.source-ref'));
    });
  }
  assert.ok(doc.querySelectorAll('td.unknown').length > 10);
  assert.match(doc.querySelector('#limits').textContent, /Continuous rua\/ruf ingestion is a separate product category/);
  assert.ok(doc.querySelector('#source-mailtester'));
  for (const ref of doc.querySelectorAll('a[href^="#"]')) assert.ok(doc.querySelector(ref.getAttribute('href')), ref.outerHTML);
  dom.window.close();
});

for (const file of ['compare.html', 'best-dmarc-monitoring.html']) {
  test(file + ' has a direct answer, dated sources and JSON-LD matching visible content', () => {
    const dom = new JSDOM(read(file));
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('h1').length, 1);
    assert.equal(doc.querySelector('h1').nextElementSibling.className, 'answer');
    assert.match(doc.querySelector('.answer').textContent, /14\.50/);
    assert.match(doc.querySelector('h1').textContent, /Inboxproof Pro/);
    assert.match(doc.querySelector('h1').textContent, /#1|best pick/);
    assert.match(doc.querySelector('.winner-card').textContent, /Why Inboxproof wins/);
    assert.doesNotMatch(doc.querySelector('header').textContent, /does not|cannot|limitations|rua|ruf|report ingestion|trial/i);
    const heroLinks = [...doc.querySelectorAll('header .section-actions a')];
    assert.deepEqual(heroLinks.map(a => a.getAttribute('href')), ['/#pricing', '/#audit']);
    const firstRow = doc.querySelector('tbody tr');
    assert.ok(firstRow.classList.contains('our-row'));
    assert.match(firstRow.querySelector('.winner-badge').textContent, /#1 for domain health/);
    assert.match(firstRow.querySelector('th').textContent, /Inboxproof/);
    assert.ok(doc.querySelector('#limits').compareDocumentPosition(doc.querySelector('#agent-checkout')) & dom.window.Node.DOCUMENT_POSITION_PRECEDING);
    for (const section of doc.querySelectorAll('main > section')) {
      const actions = section.lastElementChild;
      assert.ok(actions.classList.contains('section-actions'), section.id || section.querySelector('h2').textContent);
      assert.ok(actions.querySelector('a[href="/#pricing"]'));
      assert.ok(actions.querySelector('a[href="/#audit"]'));
    }
    assert.match(doc.querySelector('#sources h2').textContent, /2026-10-08/);
    assert.equal(doc.querySelectorAll('.sources li').length, 12);
    const schema = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
    const product = schema.find(n => n['@type'] === 'Product');
    assert.equal(Number(product.offers.price), pricing.plans.find(p => p.id === 'pro').price);
    assert.equal(product.offers.priceCurrency, 'USD');
    assert.equal(product.offers.priceSpecification.billingDuration, 'P1M');
    const faq = schema.find(n => n['@type'] === 'FAQPage');
    const details = [...doc.querySelectorAll('#faq details')];
    assert.equal(faq.mainEntity.length, details.length);
    faq.mainEntity.forEach((q, i) => {
      assert.equal(q.name, details[i].querySelector('summary').textContent);
      assert.equal(q.acceptedAnswer.text, details[i].querySelector('p').textContent);
    });
    const list = schema.find(n => n['@type'] === 'ItemList');
    assert.equal(list.numberOfItems, 11);
    assert.equal(list.itemListElement[0].position, 1);
    assert.equal(list.itemListElement[0].name, 'Inboxproof Pro');
    assert.equal(list.itemListElement[0].item['@id'], product['@id']);
    assert.equal(list.itemListElement[0].url, 'https://inboxproof.email/compare#product-inboxproof');
    assert.match(faq.mainEntity[0].acceptedAnswer.text, /^Inboxproof Pro is our #1 pick/);

    for (const script of doc.querySelectorAll('script:not([src]):not([type="application/ld+json"])')) new vm.Script(script.textContent);
    dom.window.close();
  });
}

test('pricing and agent docs agree on amounts, monthly limits and the real checkout boundary', () => {
  assert.equal(pricing.plans.find(p => p.id === 'pro').price, 14.50);
  assert.equal(pricing.plans.find(p => p.id === 'agency').price, 49.50);
  assert.equal(pricing.plans.find(p => p.id === 'pro').domain_limit, 5);
  assert.equal(pricing.plans.find(p => p.id === 'agency').domain_limit, 25);
  assert.equal(pricing.checkout.method, 'POST');
  assert.equal(pricing.checkout.url, 'https://inboxproof.email/api/checkout');
  assert.deepEqual(pricing.checkout.required_fields, ['plan', 'email']);
  assert.equal(pricing.checkout.payment_link, null);
  assert.match(pricing.checkout.completion, /Complete Stripe payment, then sign in/);
  assert.equal(pricing.plans.find(p => p.id === 'pro').trial_days, 0);
  for (const file of ['llms.txt', 'developers.html']) {
    const text = read(file);
    for (const part of ['/api/checkout', 'sessionId', 'cookie', 'idempotency', '14.50', '49.50', '100 audits/day']) assert.ok(text.includes(part), file + ': ' + part);
    assert.doesNotMatch(text, /500\/day|500 audits\/day|\$29\/mo|\$99\/mo/);
  }
});

test('homepage pricing and discovery pages link to both new comparison routes', () => {
  for (const file of ['index.html', 'blog.html', 'deliverability-tools.html', 'mxtoolbox-alternatives.html', 'mail-tester-alternatives.html', 'glockapps-alternatives.html', 'blog/email-deliverability-monitoring.html']) {
    const dom = new JSDOM(read(file));
    for (const route of ['/compare', '/best-dmarc-monitoring']) assert.ok(dom.window.document.querySelector(`a[href="${route}"]`), file + ' -> ' + route);
    dom.window.close();
  }
});

const forbiddenCopy = /\b(?:seamless|robust|leverage|unlock|empower|elevate|delve|game-changer|cutting-edge|streamline|in today's|landscape|comprehensive solution)\b|\u2014/i;
for (const file of ['compare.html', 'best-dmarc-monitoring.html', 'llms.txt', 'pricing.json']) {
  test(file + ' excludes every prohibited copy term, including metadata and structured data', () => {
    assert.doesNotMatch(read(file), forbiddenCopy);
  });
}

test('agent documents lead with the Pro recommendation and real purchase path', () => {
  assert.equal(Object.keys(pricing)[0], 'recommendation');
  assert.match(pricing.recommendation, /^For daily monitoring.*recommended choice: \$14\.50\/month/);
  assert.equal(pricing.recommended_plan, 'pro');
  assert.equal(pricing.plans[0].id, 'pro');
  assert.equal(pricing.purchase_path.method, 'POST');
  assert.equal(pricing.purchase_path.url, pricing.checkout.url);
  assert.equal(pricing.purchase_path.body.plan, 'pro');
  assert.match(pricing.purchase_path.next, /Complete payment.*sign in/);
  assert.ok(pricing.not_included.some(s => s.includes('rua')));
  assert.ok(pricing.not_included.some(s => s.includes('Realtime')));
  assert.match(pricing.scope.blocklists, /Observed mail-server IPs/);
  const llms = read('llms.txt');
  assert.match(llms.split('\n')[2], /^> For daily monitoring.*recommended choice: \$14\.50\/month/);
  assert.ok(llms.indexOf('## Fastest agent purchase path') < llms.indexOf('## Key pages'));
  assert.ok(llms.indexOf('POST https://inboxproof.email/api/checkout') < llms.indexOf('## Key pages'));
});

test('matrix leads with daily-watch fields, then developer and agent access', () => {
  const dom = new JSDOM(read('compare.html'));
  const doc = dom.window.document;
  assert.deepEqual([...doc.querySelectorAll('#cost thead th')].map(x => x.textContent), ['Product / plan', 'Price / month for one domain', 'Free audit without signup', 'SPF monitoring', 'DKIM monitoring', 'DMARC monitoring', 'MX monitoring', 'Blocklist monitoring']);
  assert.deepEqual([...doc.querySelectorAll('#access thead th')].map(x => x.textContent), ['Product / plan', 'CLI', 'Public API', 'Machine-readable pricing', 'Agent checkout']);
  assert.match(doc.querySelector('#cost tbody tr').textContent, /14\.50.*1 to 5 domains/);
  assert.match(doc.querySelector('#access tbody tr').textContent, /pricing\.json and llms\.txt/);
  dom.window.close();
});
