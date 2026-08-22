// Verify funnel event instrumentation on the local server (port 4322).
// Fires the same /api/track beacons the pages now send, then reads /api/stats.
const BASE = 'http://127.0.0.1:4322';
const SECRET = 'inboxproof-funnel-2026';

const track = (page, event) =>
  fetch(`${BASE}/api/track?page=${encodeURIComponent(page)}${event ? `&event=${encodeURIComponent(event)}` : ''}`, {
    method: 'POST',
  }).then(r => r.status);

// 1. baseline
let s = await (await fetch(`${BASE}/api/stats?secret=${SECRET}`)).json();
const before = s.byEvent || {};
console.log('baseline byEvent:', JSON.stringify(before));

// 2. fire the new client-side events
const statuses = {};
statuses.pageview = await track('/r/test-domain-abc');
statuses.report_viewed = await track('/r/test-domain-abc', 'report_viewed');
statuses.share_copy = await track('/r/test-domain-abc', 'share_copy');
statuses.share_card = await track('/r/test-domain-abc', 'share_card');
statuses.share_x = await track('/r/test-domain-abc', 'share_x');
statuses.share_team = await track('/r/test-domain-abc', 'share_team');
statuses.audit_start = await track('/', 'audit_start');
console.log('track statuses:', JSON.stringify(statuses));

// 3. read back
s = await (await fetch(`${BASE}/api/stats?secret=${SECRET}`)).json();
const after = s.byEvent || {};
console.log('after byEvent:', JSON.stringify(after));
console.log('lastEvent:', JSON.stringify(s.lastEvent));

const ok =
  statuses.pageview === 200 &&
  Object.values(statuses).every(x => x === 200) &&
  after.report_viewed === (before.report_viewed || 0) + 1 &&
  after.share_copy === (before.share_copy || 0) + 1 &&
  after.share_card === (before.share_card || 0) + 1 &&
  after.share_x === (before.share_x || 0) + 1 &&
  after.share_team === (before.share_team || 0) + 1 &&
  after.audit_start === (before.audit_start || 0) + 1;

console.log(ok ? 'PASS: all funnel events recorded' : 'FAIL');
process.exit(ok ? 0 : 1);
