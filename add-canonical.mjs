import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public';
const pages = [
  'blocklist-checker','cold-email-checker','deliverability-tools','dkim-checker',
  'dmarc-checker','dmarc-generator','dmarc-report-parser','glockapps-alternatives',
  'header-analyzer','lead-magnet','mail-tester-alternatives','mx-checker',
  'ptr-checker','spam-checker','spf-checker','spf-generator','tls-checker','warm-up-calculator'
];

let changed = 0;
for (const p of pages) {
  const f = join(dir, p + '.html');
  let c = readFileSync(f, 'utf8');
  if (c.includes('rel="canonical"')) { console.log('skip (has canonical):', p); continue; }
  const url = 'https://inboxproof.email/' + p;
  // insert canonical right after the meta description line
  const re = /(<meta name="description"[^>]*>)/;
  if (!re.test(c)) { console.log('NO meta description, skip:', p); continue; }
  c = c.replace(re, '$1\n<link rel="canonical" href="' + url + '">');
  writeFileSync(f, c, 'utf8');
  changed++;
  console.log('added canonical:', p);
}
console.log('--- changed', changed, 'of', pages.length);
