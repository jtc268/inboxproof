const base = 'https://inboxproof.email';
const pages = ['/', '/compare', '/developers', '/blog', '/lead-magnet', '/warm-up-calculator', '/header-analyzer', '/blocklist-checker', '/spf-checker', '/dkim-checker', '/dmarc-checker'];
const internalPatterns = [/^\/(?!\/)/, /^https?:\/\/inboxproof\.email/];
for (const p of pages) {
  try {
    const r = await fetch(base + p, { redirect: 'follow' });
    const t = await r.text();
    const hrefs = [...t.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
    const internal = hrefs.filter(h => internalPatterns.some(re => re.test(h)));
    const unique = [...new Set(internal.map(h => h.replace(/^https?:\/\/inboxproof\.email/, '').split('#')[0]))].filter(h => h && h !== '/');
    console.log(`${p} | totalHrefs:${hrefs.length} | internal:${unique.length} | sample: ${unique.slice(0, 8).join(', ')}`);
  } catch (e) {
    console.log(`${p} ERR ${e.message}`);
  }
}
