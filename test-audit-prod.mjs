const r = await fetch('https://inboxproof.email/api/audit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain: 'example.com' }),
});
const j = await r.json();
if (!r.ok) { console.log('HTTP', r.status, JSON.stringify(j)); process.exit(0); }
const a = j.audit;
console.log('HTTP', r.status, '| domain:', a.domain, '| score:', a.score, '| checks:', a.checks.length);
console.log('reportId:', j.reportId ? 'present' : 'MISSING');
console.log('check names:', a.checks.map(c => c.name + '=' + c.status).join(', '));
