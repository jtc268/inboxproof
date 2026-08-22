const slugs = ['email-not-delivering', 'sales-email-deliverability'];
let ok = true;
for (let i = 0; i < 24; i++) {
  const results = await Promise.all(slugs.map(async (s) => {
    try {
      const r = await fetch(`https://inboxproof.email/blog/${s}`, { cache: 'no-store' });
      const t = await r.text();
      const h1 = (t.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1] || '';
      return { s, status: r.status, h1: h1.slice(0, 60) };
    } catch (e) { return { s, status: 'ERR', h1: String(e).slice(0, 60) }; }
  }));
  console.log(`try ${i + 1}:`, JSON.stringify(results));
  if (results.every((x) => x.status === 200 && x.h1)) { ok = true; break; }
  ok = false;
  await new Promise((r) => setTimeout(r, 15000));
}
// also verify blog index has the new cards and sitemap count
const blog = await (await fetch('https://inboxproof.email/blog', { cache: 'no-store' })).text();
const cards = (blog.match(/class="card" href="\/blog\//g) || []).length;
const sm = await (await fetch('https://inboxproof.email/sitemap.xml', { cache: 'no-store' })).text();
const urls = (sm.match(/<url>/g) || []).length;
console.log(`blog index cards: ${cards} (expect 120), sitemap URLs: ${urls} (expect 149)`);
console.log(ok ? 'DEPLOY OK' : 'DEPLOY NOT READY');
