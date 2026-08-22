// Apply the 50% launch pricing: $29 -> $14.50, $99 -> $49.50.
// Updates all HTML copy and the server price IDs.
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(process.cwd(), 'public');
const SERVER = path.join(process.cwd(), 'server.mjs');

// Launch price IDs (50% off, already exist in Stripe).
const LAUNCH_PRO = 'price_1U6dWBFzAAOxCQiQs2LmWAT9';
const LAUNCH_AGENCY = 'price_1U6dWBFzAAOxCQiQ1rKWK7nU';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = walk(PUBLIC);
let changed = 0;
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const before = t;
  // Replace the full prices with launch prices. Only $29 and $99 are our prices;
  // other tools use $15 / ~$40 which we do not touch.
  t = t.replaceAll('$29', '$14.50').replaceAll('$99', '$49.50');
  if (t !== before) {
    fs.writeFileSync(f, t);
    changed++;
    console.log('updated', path.relative(process.cwd(), f));
  }
}

// Update server.mjs price IDs to the launch prices.
// The Vercel env vars point at the full prices and cannot be rewritten via API,
// so the launch price IDs are hardcoded as the source of truth. Reversible:
// swap these two IDs back to the full-price IDs to restore $29/$99.
let s = fs.readFileSync(SERVER, 'utf8');
const beforeS = s;
s = s.replace(
  "const PRICE = { pro: process.env.STRIPE_PRICE_PRO || '', agency: process.env.STRIPE_PRICE_AGENCY || '' };",
  "const PRICE = { pro: '" + LAUNCH_PRO + "', agency: '" + LAUNCH_AGENCY + "' };"
);
if (s !== beforeS) {
  fs.writeFileSync(SERVER, s);
  console.log('updated server.mjs PRICE to launch price IDs');
} else {
  console.log('server.mjs PRICE line not found (check manually)');
}

console.log('Total HTML files changed:', changed);
