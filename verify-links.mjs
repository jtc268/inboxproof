const base = 'https://inboxproof.email';
const pages = ['/developers', '/lead-magnet'];
for (const p of pages) {
  try {
    const r = await fetch(base + p, { redirect: 'follow' });
    const t = await r.text();
    const hrefs = [...t.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
    const internal = hrefs.filter(h => /^\/(?!\/)/.test(h) || /^https?:\/\/inboxproof\.email/.test(h));
    const unique = [...new Set(internal.map(h => h.replace(/^https?:\/\/inboxproof\.email/, '').split('#')[0]))].filter(h => h && h !== '/');
    console.log(`${p} | internal:${unique.length} | sample: ${unique.slice(0, 10).join(', ')}`);
  } catch (e) {
    console.log(`${p} ERR ${e.message}`);
  }
}
