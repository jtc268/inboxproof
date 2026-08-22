const domain = process.argv[2] || 'example.com';
const email = process.argv[3] || 'tests@resend.dev';
const r = await fetch('https://inboxproof.email/api/audit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain, email }),
});
const j = await r.json().catch(() => ({}));
console.log('status', r.status);
console.log('score', j.audit && j.audit.score, 'grade', j.audit && j.audit.grade);
console.log('reportId', j.reportId);
for (const c of (j.audit && j.audit.checks) || []) console.log('  ', c.status, '-', c.name);
const fails = ((j.audit && j.audit.checks) || []).filter(c => c.status === 'fail').length;
const warns = ((j.audit && j.audit.checks) || []).filter(c => c.status === 'warn').length;
console.log('fails=' + fails, 'warns=' + warns, '-> followup', (fails || warns) ? 'SHOULD_SEND' : 'skip');
