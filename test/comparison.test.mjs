import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = file => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const pricing = JSON.parse(read('pricing.json'));
const names = ['Inboxproof', 'dmarcian', 'Valimail', 'EasyDMARC', 'PowerDMARC', 'Postmark DMARC Digests', 'URIports', 'Red Sift OnDMARC', 'MxToolbox monitoring', 'Cloudflare DMARC Management', 'GlockApps'];

test('comparison covers all vendors and 15 fields in accessible, server-rendered tables', () => {
  const dom = new JSDOM(read('compare.html'));
  const doc = dom.window.document;
  const tables = [...doc.querySelectorAll('table')];
  assert.equal(tables.length, 3);
  for (const table of tables) {
    assert.ok(table.querySelector('caption'));
    assert.equal(table.querySelectorAll('thead th[scope="col"]').length, 6);
    const rows = [...table.querySelectorAll('tbody tr')];
    assert.equal(rows.length, names.length);
    names.forEach((name, i) => {
      assert.ok(rows[i].querySelector('th[scope="row"]').textContent.includes(name));
      assert.equal(rows[i].querySelectorAll('td').length, 5);
      assert.ok(rows[i].querySelector('.source-ref'));
    });
  }
  assert.ok(doc.querySelectorAll('td.unknown').length > 10);
  assert.match(doc.querySelector('#limits').textContent, /No continuous rua or ruf ingestion/);
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
    assert.match(doc.querySelector('.answer').textContent, /does not/);
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
    assert.equal(schema.find(n => n['@type'] === 'ItemList').numberOfItems, 11);
    const words = doc.body.textContent;
    assert.doesNotMatch(words, /\b(seamless|robust|leverage|unlock|cutting-edge|empower|elevate|delve|tapestry|landscape)\b|\u2014/i);
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
