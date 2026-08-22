import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const blogDir = join(process.cwd(), 'public', 'blog');
const base = 'https://inboxproof.email';
const files = readdirSync(blogDir).filter(f => f.endsWith('.html'));

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extract(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

const items = [];
for (const f of files) {
  const html = readFileSync(join(blogDir, f), 'utf8');
  const title = extract(html, /<title>([\s\S]*?)<\/title>/) || f.replace('.html', '').replace(/-/g, ' ');
  const desc = extract(html, /<meta name="description" content="([^"]*)"/) || '';
  const slug = f.replace('.html', '');
  const url = `${base}/blog/${slug}`;
  // Try to find a date from the HTML (look for a date pattern or pubDate)
  const dateMatch = html.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '2026-01-01';
  items.push({ title, desc, url, date, slug });
}

// Sort by date desc, then by slug for stable order
items.sort((a, b) => (b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)));

const now = new Date().toISOString();
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Inboxproof Blog</title>
  <link>${base}/blog</link>
  <description>Email deliverability, SPF, DKIM, DMARC, and cold email infrastructure guides for agencies and developers.</description>
  <language>en-us</language>
  <lastBuildDate>${now}</lastBuildDate>
  <atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
${items.map(it => `  <item>
    <title>${esc(it.title)}</title>
    <link>${it.url}</link>
    <guid>${it.url}</guid>
    <pubDate>${new Date(it.date).toUTCString()}</pubDate>
    <description>${esc(it.desc)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;

writeFileSync(join(process.cwd(), 'public', 'rss.xml'), rss);
console.log('Wrote public/rss.xml with', items.length, 'items');
