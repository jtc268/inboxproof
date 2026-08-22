// Fix broken internal links: point root-level hrefs to their real /blog/ pages (and the one /blog/ href to its root page).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pub = join(root, 'public');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

// brokenHref -> correctHref (exact match on the quoted href value)
const fixes = {
  '"/blog/warm-up-calculator"': '"/warm-up-calculator"',
  '"/cold-email-bounce-rate"': '"/blog/cold-email-bounce-rate"',
  '"/cold-email-warm-up"': '"/blog/cold-email-warm-up"',
  '"/dkim-not-signing"': '"/blog/dkim-not-signing"',
  '"/dmarc-record"': '"/blog/dmarc-record"',
  '"/email-deliverability-for-agencies"': '"/blog/email-deliverability-for-agencies"',
  '"/email-not-delivering-to-outlook"': '"/blog/email-not-delivering-to-outlook"',
  '"/gmail-postmaster-tools"': '"/blog/gmail-postmaster-tools"',
  '"/is-my-domain-blacklisted"': '"/blog/is-my-domain-blacklisted"',
  '"/is-my-ip-blacklisted"': '"/blog/is-my-ip-blacklisted"',
  '"/microsoft-365-spf-dkim-dmarc"': '"/blog/microsoft-365-spf-dkim-dmarc"',
  '"/spamhaus-delisting"': '"/blog/spamhaus-delisting"',
  '"/spf-dkim-dmarc"': '"/blog/spf-dkim-dmarc"',
  '"/spf-lookup-limit"': '"/blog/spf-lookup-limit"',
  '"/yahoo-email-in-spam"': '"/blog/yahoo-email-in-spam"',
};

const files = walk(pub);
let total = 0;
for (const f of files) {
  let c = readFileSync(f, 'utf8');
  let n = 0;
  for (const [bad, good] of Object.entries(fixes)) {
    // only replace when it is a full href attribute value (quoted), not a prefix of a longer path
    const re = new RegExp('href=' + bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const before = c;
    c = c.replace(re, 'href=' + good);
    if (c !== before) n += (before.match(re) || []).length;
  }
  if (n > 0) { writeFileSync(f, c); total += n; console.log(f.replace(pub + '\\', '') + ': ' + n + ' link(s) fixed'); }
}
console.log('TOTAL fixed: ' + total);
