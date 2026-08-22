// Standalone render test for the follow-up nudge emails (copy + HTML structure).
// Mirrors followupTable/followupFooter/the two bodies from server.mjs with mock data.
function followupTable(fails, warns) {
  const rows = [...fails, ...warns].slice(0, 8).map(c =>
    '<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a2e;font-weight:600">' + c.name + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:' + (c.status === 'fail' ? '#c0392b' : '#e67e22') + ';font-weight:600;white-space:nowrap">' + c.status + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">' + (c.fix || c.detail || '') + '</td></tr>'
  ).join('');
  return '<table style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Check</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Status</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Exact fix</th></tr>' + rows + '</table>';
}
function followupFooter(lead, reportId) {
  let s = '';
  if (lead.refCode) s += '<p style="color:#888;font-size:12px;line-height:1.6;margin-top:18px">Know someone else wrestling with deliverability? Send them the free audit with your link: <a href="https://inboxproof.email/?ref=' + lead.refCode + '" style="color:#6366f1;font-weight:600">inboxproof.email/?ref=' + lead.refCode + '</a>. When they upgrade to Pro, you get a free month of Pro.</p>';
  const tail = reportId ? ' <a href="https://inboxproof.email/r/' + reportId + '" style="color:#888">View your full report</a>.' : '.';
  s += '<p style="color:#888;font-size:12px;line-height:1.5;margin-top:24px">InboxProof &middot; free email deliverability audit. You are receiving this because you ran a free audit on ' + lead.domain + '.' + tail + '</p>';
  return s;
}
const lead = { domain: 'acme.com', refCode: 'AB12CD' };
const a = { score: 42, grade: 'D', reportId: 'rep_123' };
const fails = [
  { name: 'SPF record', status: 'fail', fix: 'Add a TXT record: "v=spf1 include:_spf.google.com ~all"' },
  { name: 'DMARC record', status: 'fail', fix: 'Add a DMARC TXT record at _dmarc.acme.com' },
];
const warns = [
  { name: 'DKIM signature', status: 'warn', fix: 'Enable DKIM signing in your email provider' },
];

// stage 0
const s0 = 'We re-checked ' + lead.domain + '. ' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + ' still failing';
const h0 = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
  '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">' + lead.domain + ' still scored ' + a.score + '/100 (' + a.grade + ')</h2>' +
  '<p style="color:#444;line-height:1.6;margin:0 0 14px">We re-ran the free audit on <b>' + lead.domain + '</b> today. ' +
  '<b>' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + '</b> are still failing' +
  (warns.length ? ' and <b>' + warns.length + '</b> are warning' : '') +
  '. These are the same issues keeping your email out of the inbox:</p>' +
  followupTable(fails, warns) +
  '<p style="color:#444;line-height:1.6;margin:0 0 14px">The fixes above are free to do yourself. If you would rather just know the moment any of them breaks or a new one appears, Pro re-checks ' + lead.domain + ' daily and emails you only when something changes.</p>' +
  '<a href="https://inboxproof.email/pro" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
  followupFooter(lead, a.reportId) +
  '</div>';

// stage 1
const s1 = 'Last check on ' + lead.domain + ' before we stop emailing';
const h1 = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
  '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">Last check on ' + lead.domain + '</h2>' +
  '<p style="color:#444;line-height:1.6;margin:0 0 14px">This is the last email we will send about <b>' + lead.domain + '</b>. We re-checked it today and ' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + ' are still failing.</p>' +
  followupTable(fails, warns) +
  '<p style="color:#444;line-height:1.6;margin:0 0 14px">If you have already fixed these, run a fresh free audit to confirm. If not, the steps above are the exact fixes. Pro monitors ' + lead.domain + ' daily so you do not have to keep checking by hand.</p>' +
  '<a href="https://inboxproof.email/pro" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
  followupFooter(lead, a.reportId) +
  '</div>';

// strip tags to read the plain copy
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();
console.log('--- NUDGE 1 subject:', s0);
console.log(strip(h0));
console.log('\n--- NUDGE 2 subject:', s1);
console.log(strip(h1));
// assert no em dash anywhere
console.log('\nEM DASH PRESENT?', (s0 + h0 + s1 + h1).includes('\u2014'));
console.log('HTML balanced divs:', (h0.match(/<div/g)||[]).length === (h0.match(/<\/div>/g)||[]).length, (h1.match(/<div/g)||[]).length === (h1.match(/<\/div>/g)||[]).length);
