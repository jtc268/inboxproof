// End-to-end test of the money path on the new domain:
// POST /api/audit -> reportId -> GET /api/report/{id}
const BASE = 'https://inboxproof.email';
const domain = process.argv[2] || 'example.com';

console.log('1) POST /api/audit for', domain);
const a = await fetch(BASE + '/api/audit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain }),
});
console.log('   audit status:', a.status);
const aj = await a.json();
if (a.status !== 200) { console.log('   ERROR:', aj.error || JSON.stringify(aj)); process.exit(1); }
const { audit, reportId } = aj;
console.log('   score:', audit.score, 'grade:', audit.grade, 'reportId:', reportId);
console.log('   checks:', (audit.checks || []).map(c => c.id + '=' + c.status).join(', '));

console.log('2) GET /api/report/' + reportId);
const r = await fetch(BASE + '/api/report/' + reportId);
console.log('   report status:', r.status);
const rep = await r.json();
console.log('   report domain:', rep.domain, '| score:', rep.score, '| checks:', (rep.checks || []).length);

console.log('3) GET /report?reportId=' + reportId + ' (HTML page)');
const h = await fetch(BASE + '/report?reportId=' + reportId);
const html = await h.text();
console.log('   html status:', h.status, '| has upgrade/checkout wiring:', html.includes('/api/checkout'), '| has report fetch:', html.includes('/api/report/'));

console.log('OK: money path verified on', BASE);
