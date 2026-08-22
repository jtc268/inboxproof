const base = 'https://inboxproof.email';
const pages = ['/', '/pricing', '/compare', '/developers', '/blog', '/lead-magnet', '/free-email-deliverability-audit', '/warm-up-calculator', '/header-analyzer'];
for (const p of pages) {
  try {
    const r = await fetch(base + p, { redirect: 'follow' });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || 'NO TITLE';
    const desc = (t.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || 'NO DESC';
    const og = /<meta[^>]*property=["']og:title["']/i.test(t) ? 'yes' : 'no';
    const canon = /<link[^>]*rel=["']canonical["']/i.test(t) ? 'yes' : 'no';
    const schema = /application\/ld\+json/i.test(t) ? 'yes' : 'no';
    const h1 = (t.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1] || 'NO H1';
    const imgs = (t.match(/<img /gi) || []).length;
    const altMissing = (t.match(/<img (?![^>]*alt=)[^>]*>/gi) || []).length;
    console.log(`${p} | ${r.status} | T:${title.slice(0, 50)} | D:${desc.slice(0, 35)} | og:${og} | canon:${canon} | schema:${schema} | H1:${h1.slice(0, 25)} | imgs:${imgs} altMiss:${altMissing}`);
  } catch (e) {
    console.log(`${p} ERR ${e.message}`);
  }
}
