// Verify the Stripe checkout step of the money path on prod.
// POST /api/checkout -> { url, sessionId }. Confirms STRIPE_KEY + PRICE are live.
const BASE = 'https://inboxproof.email';
const email = 'checkout-test@example.com';
const plan = process.argv[2] || 'pro';

console.log('POST /api/checkout plan=' + plan + ' email=' + email);
const r = await fetch(BASE + '/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan, email, domain: 'example.com' }),
});
const j = await r.json();
console.log('status:', r.status);
if (r.status !== 200) {
  console.log('ERROR:', j.error || JSON.stringify(j));
  process.exit(1);
}
console.log('sessionId:', j.sessionId);
console.log('url is stripe checkout:', /checkout/.test(j.url || '') && /stripe|checkout\.session/.test(j.url || ''), '| url:', (j.url || '').slice(0, 80) + '...');
console.log('OK: checkout session created on', BASE);
