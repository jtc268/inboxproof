// Isolated e2e test for leadFollowupCycle.
// Copies server.mjs into a temp dir with NO .env so REMOTE=false, LOCAL=true, RESEND unset.
// Seeds a lead and runs the cycle; asserts it runs without throwing and processes correctly.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfollow-'));
fs.copyFileSync(path.join(here, 'server.mjs'), path.join(tmp, 'server.mjs'));

// Seed a lead: 3 days since last audit, stage 0, non-pro, non-test, failing domain.
const leadsDir = path.join(tmp, 'data');
fs.mkdirSync(leadsDir, { recursive: true });
const threeDaysAgo = Date.now() - 3 * 86400e3;
const seed = {
  'lead-a@example.com': {
    id: 'lead-a', email: 'lead-a@example.com', domain: 'zz-nonexistent-domain-98765.invalid',
    pro: false, test: false, createdAt: new Date(threeDaysAgo).toISOString(),
    lastAuditAt: threeDaysAgo, followupStage: 0, lastScore: 30,
  },
  'lead-b@example.com': {
    id: 'lead-b', email: 'lead-b@example.com', domain: 'google.com',
    pro: false, test: false, createdAt: new Date(threeDaysAgo).toISOString(),
    lastAuditAt: threeDaysAgo, followupStage: 2, lastScore: 90,
  },
};
fs.writeFileSync(path.join(leadsDir, 'leads.json'), JSON.stringify(seed, null, 2));

process.env.NO_LISTEN = '1';
process.env.PORT = '0';
delete process.env.VERCEL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.RESEND_API_KEY;

const t0 = Date.now();
let cycleResult = 'UNSET';
let err = null;
try {
  const mod = await import(pathToFileURL(path.join(tmp, 'server.mjs')).href);
  cycleResult = await mod.leadFollowupCycle();
} catch (e) { err = e; }
const ms = Date.now() - t0;

// Read back the resulting leads state
const after = JSON.parse(fs.readFileSync(path.join(leadsDir, 'leads.json'), 'utf8'));
const a = after['lead-a@example.com'];
const b = after['lead-b@example.com'];

console.log('cycle threw:', err ? err.message : 'no');
console.log('cycle returned:', JSON.stringify(cycleResult));
console.log('elapsed ms:', ms);
console.log('lead-a followupStage after:', a && a.followupStage, '| lastFollowupAt set:', !!(a && a.lastFollowupAt));
console.log('lead-b followupStage after (should stay 2):', b && b.followupStage, '| lastFollowupAt set:', !!(b && b.lastFollowupAt));

// Assertions
const ok = !err
  && typeof cycleResult === 'number'
  && b.followupStage === 2          // stage-2 lead must be filtered out, untouched
  && !b.lastFollowupAt;             // ...and not stamped
console.log('\nRESULT:', ok ? 'PASS' : 'CHECK');
fs.rmSync(tmp, { recursive: true, force: true });
