import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/blog';
const today = new Date().toISOString().slice(0, 10);
const files = readdirSync(dir).filter(f => f.endsWith('.html'));
let updated = 0, skipped = 0;

for (const f of files) {
  const p = join(dir, f);
  let html = readFileSync(p, 'utf8');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) { skipped++; continue; }
  let obj;
  try { obj = JSON.parse(m[1]); } catch (e) { skipped++; continue; }
  if (obj['@type'] !== 'Article') { skipped++; continue; }
  if (obj.datePublished && obj.dateModified) { skipped++; continue; }
  obj.datePublished = today;
  obj.dateModified = today;
  const next = html.replace(m[0], '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>');
  writeFileSync(p, next);
  updated++;
}
console.log(`today=${today} updated=${updated} skipped=${skipped} total=${files.length}`);
