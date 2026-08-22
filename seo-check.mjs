const base = 'https://inboxproof.email';
const pages = ['/', '/compare', '/developers', '/blog', '/lead-magnet', '/warm-up-calculator', '/header-analyzer', '/blocklist-checker', '/spf-checker', '/dkim-checker', '/dmarc-checker', '/pro'];
for (const p of pages) {
  try {
    const r = await fetch(base + p, { redirect: 'follow' });
    const t = await r.text();
    const hasOg = t.includes('property="og:') || t.includes('name="og:') || t.includes('og:title');
    const hasH1 = /<h1[\s>]/i.test(t);
    const hasCanonical = t.includes('rel="canonical"');
    const hasSchema = t.includes('application/ld+json');
    console.log(`${p} | og:${hasOg} | h1:${hasH1} | canonical:${hasCanonical} | schema:${hasSchema}`);
  } catch (e) {
    console.log(`${p} ERR ${e.message}`);
  }
}
