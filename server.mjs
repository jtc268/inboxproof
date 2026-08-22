// Inboxproof — zero-dependency Node server
// Real deliverability audit engine + email capture + Pro monitoring.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
if (!process.env.UPSTASH_REST_URL && !process.env.VERCEL) fs.mkdirSync(DATA, { recursive: true });

/* ---------------- env (.env) ---------------- */
try {
  const envLines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/);
  for (const l of envLines) {
    const i = l.indexOf('=');
    if (i > 0 && !l.startsWith('#')) {
      const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {}

/* ---------------- stripe ---------------- */
const STRIPE_KEY = process.env.STRIPE_SECRET || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PRICE = { pro: 'price_1U6dWBFzAAOxCQiQs2LmWAT9', agency: 'price_1U6dWBFzAAOxCQiQ1rKWK7nU' };
const stripe = async (m, p, body) => {
  const r = await fetch('https://api.stripe.com/v1' + p, {
    method: m,
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Stripe ' + p + ' ' + r.status + ': ' + (j.error?.message || ''));
  return j;
};
const activatePro = async (email, plan, stripeInfo = {}) => {
  const lead = await upsertLead(email, null);
  lead.pro = true;
  lead.plan = plan;
  lead.proSince = lead.proSince || new Date().toISOString();
  if (!lead.apiKey) lead.apiKey = 'ip_' + crypto.randomBytes(16).toString('hex');
  Object.assign(lead, stripeInfo);
  await persist('leads');
  return lead;
};
const findLeadByApiKey = key => {
  if (!key) return null;
  for (const email of Object.keys(leads)) if (leads[email].apiKey === key) return leads[email];
  return null;
};

/* ---------------- store (local files, or Supabase storage on Vercel) ---------------- */
const LEADS_F = path.join(DATA, 'leads.json');
const AUDITS_F = path.join(DATA, 'audits.json');
const REPORTS_F = path.join(DATA, 'reports.json');
const STATS_F = path.join(DATA, 'stats.json');
const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const saveJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_BUCKET = 'kv';
const REMOTE = !!(SB_URL && SB_KEY);
const LOCAL = !process.env.VERCEL && !REMOTE;
const SB_HEADERS = () => ({ Authorization: 'Bearer ' + SB_KEY, apikey: SB_KEY, 'Content-Type': 'application/json' });
async function upGet(key) {
  if (!REMOTE) return null;
  try {
    const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + key, { headers: SB_HEADERS() });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}
async function upSet(key, val) {
  if (!REMOTE) return;
  try {
    // reliable overwrite: delete then post (upsert=true is not honored in this storage version)
    await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET, {
      method: 'DELETE', headers: SB_HEADERS(), body: JSON.stringify({ prefixes: [key] }),
    });
    const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + key, {
      method: 'POST', headers: SB_HEADERS(), body: val,
    });
    if (!r.ok) console.error('upSet failed', key, r.status);
  } catch (e) { console.error('upSet error', key, e.message); }
}
let leads = loadJson(LEADS_F, {});  // email -> {id,email,domain,pro,proSince,createdAt,lastScore}
let audits = loadJson(AUDITS_F, {}); // email -> [{domain,at,score,grade,checks:[{id,name,status}]}]
let reports = loadJson(REPORTS_F, {}); // id -> {domain,at,score,grade,checks:[{id,name,status,detail,fix}]}
let stats = loadJson(STATS_F, { pageViews: 0, byPage: {}, byRef: {}, lastView: null }); // funnel counters
let hydrated = false;
async function hydrate() {
  if (!REMOTE || hydrated) return;
  const [l, a, s] = await Promise.all([upGet('leads'), upGet('audits'), upGet('stats')]);
  if (l) leads = JSON.parse(l);
  if (a) audits = JSON.parse(a);
  if (s) stats = { ...stats, ...JSON.parse(s) };
  hydrated = true;
}
async function persist(kind) {
  const obj = kind === 'leads' ? leads : kind === 'audits' ? audits : kind === 'stats' ? stats : null;
  if (obj === null) return;
  if (REMOTE) await upSet(kind, JSON.stringify(obj));
  else if (LOCAL) saveJson(kind === 'leads' ? LEADS_F : kind === 'audits' ? AUDITS_F : STATS_F, obj);
}
async function recordEvent(name, page) {
  stats.byEvent = stats.byEvent || {};
  stats.byEvent[name] = (stats.byEvent[name] || 0) + 1;
  stats.lastEvent = { event: name, page: page || null, at: new Date().toISOString() };
  await persist('stats');
}
async function saveReport(id, audit) {
  if (REMOTE) { await upSet('report:' + id, JSON.stringify(audit)); return; }
  reports[id] = audit;
  if (Object.keys(reports).length > 2000) { const oldest = Object.keys(reports).slice(0, Object.keys(reports).length - 2000); oldest.forEach(k => delete reports[k]); }
  if (LOCAL) saveJson(REPORTS_F, reports);
}
async function getReport(id) {
  if (REMOTE) { const v = await upGet('report:' + id); return v ? JSON.parse(v) : null; }
  return reports[id] || null;
}
async function upDel(key) {
  if (!REMOTE) return;
  try {
    await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET, {
      method: 'DELETE', headers: SB_HEADERS(), body: JSON.stringify({ prefixes: [key] }),
    });
  } catch {}
}
async function deleteReport(id) {
  if (REMOTE) { await upDel('report:' + id); }
  delete reports[id];
}

function genRefCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to keep codes readable
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[crypto.randomInt(abc.length)];
  return s;
}
async function findLeadByRefCode(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return null;
  if (REMOTE) {
    // In-memory leads is stale across Vercel instances (each hydrates once).
    // Read fresh from storage so a referring lead created on another instance is found.
    const v = await upGet('leads');
    if (v) {
      try {
        const fresh = JSON.parse(v);
        for (const l of Object.values(fresh)) if (l.refCode && l.refCode.toUpperCase() === c) return l;
      } catch {}
    }
  }
  for (const l of Object.values(leads)) if (l.refCode && l.refCode.toUpperCase() === c) return l;
  return null;
}
async function upsertLead(email, domain) {
  const k = String(email).toLowerCase().trim();
  if (!leads[k]) leads[k] = { id: crypto.randomUUID(), email: k, domain: domain || null, pro: false, proSince: null, createdAt: Date.now(), lastScore: null, refCode: genRefCode() };
  if (!leads[k].refCode) leads[k].refCode = genRefCode();
  if (domain) leads[k].domain = domain;
  await persist('leads');
  return leads[k];
}
async function pushAudit(email, a) {
  const k = String(email).toLowerCase().trim();
  if (!audits[k]) audits[k] = [];
  audits[k].push({ domain: a.domain, at: a.at, score: a.score, grade: a.grade, reportId: a.reportId, checks: a.checks.map(c => ({ id: c.id, name: c.name, status: c.status })) });
  if (audits[k].length > 200) audits[k] = audits[k].slice(-200);
  await persist('audits');
}

/* ---------------- email alerts (Resend) ---------------- */
// Resend: RESEND_API_KEY + ALERT_FROM come from the environment (set in Vercel production).
const RESEND_KEY = process.env.RESEND_API_KEY;
const ALERT_FROM = process.env.ALERT_FROM || 'InboxProof <onboarding@adorellc.pro>';
async function sendAlertEmail(to, subject, html) {
  if (!RESEND_KEY) { console.log('[alert] RESEND_API_KEY not set; skipping email to', to); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [to], subject, html }),
    });
    const j = await r.json();
    if (!r.ok) { console.log('[alert] resend error', r.status, JSON.stringify(j).slice(0, 200)); return false; }
    console.log('[alert] sent to', to, j.id || '');
    return true;
  } catch (e) { console.log('[alert] send failed', e.message); return false; }
}

// Nurture touch after a free audit: score + failing/warning checks with the exact fix,
// plus a Start Pro CTA. Free users only, 7-day cooldown, gated behind AUDIT_FOLLOWUP_EMAIL=1.
async function maybeSendAuditFollowup(email, domain, audit, reportId) {
  if (process.env.AUDIT_FOLLOWUP_EMAIL !== '1') return;
  const lead = leads[email];
  if (!lead || lead.pro) return;
  const now = Date.now();
  const last = lead.lastFollowupAt ? new Date(lead.lastFollowupAt).getTime() : 0;
  if (now - last < 7 * 24 * 3600 * 1000) return;
  const fails = audit.checks.filter(c => c.status === 'fail');
  const warns = audit.checks.filter(c => c.status === 'warn');
  if (!fails.length && !warns.length) return;
  const rows = [...fails, ...warns].slice(0, 8).map(c =>
    '<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a2e;font-weight:600">' + c.name + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:' + (c.status === 'fail' ? '#c0392b' : '#e67e22') + ';font-weight:600;white-space:nowrap">' + c.status + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">' + (c.fix || c.detail || '') + '</td></tr>'
  ).join('');
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
    '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">' + domain + ' email health: ' + audit.score + '/100 (' + audit.grade + ')</h2>' +
    '<p style="color:#444;line-height:1.6;margin:0 0 14px">We ran a free audit of <b>' + domain + '</b>. ' +
    (fails.length ? 'You have <b>' + fails.length + ' failing check' + (fails.length > 1 ? 's' : '') + '</b> that are likely keeping your email out of the inbox.' : '') +
    (warns.length ? ' There are also <b>' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') + '</b> worth fixing.' : '') + '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Check</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Status</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Exact fix</th></tr>' +
    rows + '</table>' +
    '<p style="color:#444;line-height:1.6;margin:0 0 14px">Want us to watch ' + domain + ' daily and email you the moment any of these breaks or a new issue appears?</p>' +
    '<a href="https://inboxproof.email/pro" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
    '<p style="color:#888;font-size:12px;line-height:1.5;margin-top:24px">InboxProof &middot; free email deliverability audit. You are receiving this because you ran a free audit on ' + domain + '. <a href="https://inboxproof.email/report/' + reportId + '" style="color:#888">View your full report</a>.</p>' +
    '</div>';
  const ok = await sendAlertEmail(email, domain + ' email health: ' + audit.score + '/100 (' + audit.grade + ')', html);
  if (ok) {
    lead.lastFollowupAt = new Date().toISOString();
    await persist('leads');
  }
}

/* ---------------- validation ---------------- */
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '');

/* ---------------- checks ---------------- */
async function checkMx(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch {
    return { id: 'mx', name: 'MX & mail routing', status: 'fail', detail: 'No MX records found for ' + domain + '. Mail for this domain cannot be routed at all.', fix: 'Add an MX record, e.g.\n10  mail.' + domain + '   (or your ESP, e.g. 1  mx1.hostingprovider.com)' };
  }
  mxs = mxs.filter(m => m.exchange && m.exchange !== '.');
  if (!mxs.length) return { id: 'mx', name: 'MX & mail routing', status: 'fail', detail: 'No usable MX records for ' + domain + ' (none, or a null MX that says the domain does not accept mail).', fix: 'Add an MX record for your mail provider, e.g.\n10  aspmx.l.google.com   (Google Workspace) or 1  mx1.hostingprovider.com' };
  const top = mxs[0].exchange.replace(/\.$/, '');
  let ip = null;
  try { ip = (await dns.resolve4(top))[0]; } catch { try { ip = (await dns.resolve6(top))[0]; } catch { ip = null; } }
  if (!ip) return { id: 'mx', name: 'MX & mail routing', status: 'warn', detail: 'MX host "' + top + '" does not resolve to an IP address.', fix: 'Point your MX at a hostname that has an A record.' };
  return { id: 'mx', name: 'MX & mail routing', status: 'pass', detail: mxs.length + ' MX record(s); top host ' + top + ' resolves to ' + ip + '.', fix: '' };
}

async function checkSpf(domain) {
  let txts;
  try { txts = await dns.resolveTxt(domain); } catch {
    return { id: 'spf', name: 'SPF', status: 'fail', detail: 'No SPF record found. Receivers cannot verify which servers may send as ' + domain + ' — the top spoofing vector.', fix: 'Add a TXT record at the domain root:\nv=spf1 include:_spf.google.com -all   (use your ESP\u2019s include)' };
  }
  let rec = (txts.map(t => t.join('')).find(s => /^v=spf1/i.test(s)) || '').trim();
  if (!rec) return { id: 'spf', name: 'SPF', status: 'fail', detail: 'No SPF record found on ' + domain + '.', fix: 'Add a TXT record at the domain root:\nv=spf1 include:_spf.google.com -all   (use your ESP\u2019s include)' };
  let redirectNote = '';
  const rm = rec.match(/redirect=([^\s]+)/i);
  if (rm) {
    try {
      const t2 = await dns.resolveTxt(rm[1]);
      const rec2 = (t2.map(t => t.join('')).find(s => /^v=spf1/i.test(s)) || '').trim();
      if (rec2) { rec = rec2; redirectNote = ' (via redirect to ' + rm[1] + ')'; }
    } catch { redirectNote = ' (redirect target ' + rm[1] + ' not resolvable)'; }
  }
  const tokens = rec.split(/\s+/).slice(1);
  const lookups = tokens.filter(t => /^(include|a|mx):/i.test(t)).length;
  const soft = /(^|\s)~all(\s|$)/.test(rec);
  const hard = /(^|\s)-all(\s|$)/.test(rec);
  let status = 'pass', detail = 'SPF found: ' + rec + redirectNote;
  const fixes = [];
  if (lookups > 10) { status = 'fail'; detail += ' — exceeds the 10 DNS-lookup limit, so receivers must reject it.'; fixes.push('Reduce includes to 10 or fewer (combine via a dedicated _spf subdomain).'); }
  else if (soft) { status = 'warn'; detail += ' — ends with ~all (softfail); spoofed mail is not firmly rejected.'; fixes.push('Change ~all to -all.'); }
  else if (!hard) { status = 'warn'; detail += ' — no -all qualifier, so unauthorized senders are not explicitly rejected.'; fixes.push('Append -all to the SPF record.'); }
  return { id: 'spf', name: 'SPF', status, detail, fix: fixes.join('\n') };
}

const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14', 's15', 's16', 'k1', 'k2', 'mx', 'mail', 'mailo', 'dkim', 'default', 'protonmail', 'mandrill', 'sendgrid', 'amazonses', 'pm', 'dkim1', 'dkim2', 's1024', 's2048', 's3072', 's512', 's768', 'krs', 'mailgun', 'postmark', 'smtp', 's', 's0', 's01', 's02', 's03', 's04', 's05'];

async function checkDkim(domain) {
  const found = [];
  await Promise.all(DKIM_SELECTORS.map(async sel => {
    try {
      const txts = await dns.resolveTxt(sel + '._domainkey.' + domain);
      const rec = txts.map(t => t.join('')).find(s => /^v=dkim1/i.test(s));
      if (rec) found.push({ sel, rec });
    } catch { /* selector not present */ }
  }));
  if (!found.length) return { id: 'dkim', name: 'DKIM', status: 'fail', detail: 'No DKIM key found across 50 common selectors. Messages from ' + domain + ' carry no cryptographic signature.', fix: 'Enable DKIM in your ESP (Google Workspace: Admin → Security → DKIM). Example record:\nselector1._domainkey.' + domain + '  TXT  "v=DKIM1; k=rsa; p=<your key>"' };
  const f = found[0];
  const p = (f.rec.match(/p=([A-Za-z0-9+/=]+)/) || [])[1] || '';
  if (!p) return { id: 'dkim', name: 'DKIM', status: 'warn', detail: 'DKIM record exists at ' + f.sel + '._domainkey but has no public key (p= empty).', fix: 'Publish the full key: v=DKIM1; k=rsa; p=<base64 key>' };
  const bits = Math.floor(p.length * 3 / 4) * 8;
  if (bits < 1024) return { id: 'dkim', name: 'DKIM', status: 'warn', detail: 'DKIM key at ' + f.sel + '._domainkey is ~' + bits + '-bit. 1024-bit minimum is expected; 2048 is recommended.', fix: 'Rotate to a 2048-bit key in your ESP and republish.' };
  return { id: 'dkim', name: 'DKIM', status: 'pass', detail: 'DKIM key found at ' + f.sel + '._domainkey (' + found.length + ' selector(s), ~' + bits + '-bit).', fix: '' };
}

async function checkDmarc(domain) {
  let txts;
  try { txts = await dns.resolveTxt('_dmarc.' + domain); } catch {
    return { id: 'dmarc', name: 'DMARC', status: 'fail', detail: 'No DMARC record at _dmarc.' + domain + '. In 2026, Gmail and Microsoft treat missing DMARC as a hard filter signal for bulk mail.', fix: 'Start safe (report-only), then escalate:\n_dmarc TXT "v=DMARC1; p=none; rua=mailto:postmaster@' + domain + '; pct=100"' };
  }
  const rec = (txts.map(t => t.join('')).find(s => /^v=dmarc1/i.test(s)) || '').trim();
  if (!rec) return { id: 'dmarc', name: 'DMARC', status: 'fail', detail: 'TXT at _dmarc.' + domain + ' is not a valid DMARC record.', fix: 'Publish: _dmarc TXT "v=DMARC1; p=none; rua=mailto:postmaster@' + domain + '"' };
  const p = (rec.match(/p=(none|quarantine|reject)/i) || [])[1];
  const rua = /rua=/i.test(rec);
  let status, detail, fix = '';
  if (!p) { status = 'fail'; detail = 'DMARC record has no policy (p=). Record: ' + rec; fix = 'Add p=none to start, then escalate to p=quarantine.'; }
  else if (p === 'none') { status = 'warn'; detail = 'DMARC present but p=none — monitoring only, no enforcement. Gmail\u2019s 2026 enforcement expects quarantine or reject for bulk senders.'; fix = 'Escalate: v=DMARC1; p=quarantine; rua=mailto:postmaster@' + domain + '; pct=100'; }
  else if (p === 'quarantine') { status = 'pass'; detail = 'DMARC p=quarantine — spoofed mail is held for review. Good posture for 2026.'; fix = 'Consider p=reject after 30 clean days of reports.'; }
  else { status = 'pass'; detail = 'DMARC p=reject — full enforcement. Best in class for 2026.'; }
  if (!rua && status !== 'fail') { status = 'warn'; detail += ' No rua= reporting address, so you will never receive abuse reports.'; fix = (fix ? fix + '\n' : '') + 'Add rua=mailto:postmaster@' + domain; }
  return { id: 'dmarc', name: 'DMARC', status, detail, fix };
}

function rawTls(host) {
  return new Promise(resolve => {
    const out = { starttls: false, cert: null, error: null };
    let done = false;
    let socket;
    const finish = err => { if (done) return; done = true; clearTimeout(timer); try { socket.destroy(); } catch {} out.error = out.error || err || null; resolve(out); };
    const timer = setTimeout(() => finish('timeout connecting to ' + host + ':25'), 9000);
    socket = net.connect(25, host, () => {});
    let buf = '', phase = 'greet';
    socket.on('data', d => {
      buf += d.toString('latin1');
      if (phase === 'greet' && /(^|\r\n)220 /.test(buf)) { phase = 'ehlo'; socket.write('EHLO audit.inboxproof.local\r\n'); }
      else if (phase === 'ehlo') {
        const lines = buf.split('\r\n');
        if (lines[lines.length - 1].startsWith('250 ')) {
          buf = '';
          out.starttls = lines.some(l => /(^|\s)STARTTLS/i.test(l));
          if (out.starttls) {
            phase = 'tls';
            socket.setSecure({ servername: host, rejectUnauthorized: false, checkServerIdentity: () => null });
            socket.on('secureConnect', () => {
              try {
                const c = socket.getPeerCertificate();
                out.cert = { subject: c.subject?.CN || c.subject?.O || '', issuer: c.issuer?.O || c.issuer?.CN || '', valid_to: c.valid_to, valid_from: c.valid_from };
              } catch (e) { out.error = 'TLS handshake failed: ' + e.message; }
              finish();
            });
          } else finish();
        }
      }
    });
    socket.on('error', e => finish(e.message));
    socket.on('close', () => finish());
  });
}

async function checkTls(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch { mxs = null; }
  if (!mxs || !mxs.length) return { id: 'tls', name: 'TLS & STARTTLS', status: 'warn', detail: 'No MX host available to test TLS against.', fix: '' };
  const host = mxs[0].exchange.replace(/\.$/, '');
  const r = await rawTls(host);
  if (r.error) return { id: 'tls', name: 'TLS & STARTTLS', status: 'warn', detail: 'Could not verify TLS on ' + host + ': ' + r.error, fix: '' };
  if (!r.starttls) return { id: 'tls', name: 'TLS & STARTTLS', status: 'fail', detail: 'Mail server ' + host + ' does not offer STARTTLS. Mail to/from this domain can travel in plaintext.', fix: 'Enable STARTTLS on your mail server (hosting panel: Security → TLS → Force TLS).' };
  const c = r.cert;
  const exp = c ? new Date(c.valid_to) : null;
  if (c && exp && exp < new Date()) return { id: 'tls', name: 'TLS & STARTTLS', status: 'fail', detail: 'STARTTLS offered, but the certificate expired on ' + c.valid_to + '.', fix: 'Renew the TLS certificate on ' + host + '.' };
  if (c && exp && exp - new Date() < 14 * 864e5) return { id: 'tls', name: 'TLS & STARTTLS', status: 'warn', detail: 'Certificate on ' + host + ' expires in ' + Math.ceil((exp - new Date()) / 864e5) + ' days (' + c.valid_to + ').', fix: 'Renew the certificate before ' + c.valid_to + '.' };
  return { id: 'tls', name: 'TLS & STARTTLS', status: 'pass', detail: 'STARTTLS offered on ' + host + '; certificate valid until ' + (c ? c.valid_to : 'unknown') + (c && c.issuer ? ' (issuer: ' + c.issuer + ')' : '') + '.', fix: '' };
}

async function checkTlsAll(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch { mxs = null; }
  if (!mxs || !mxs.length) {
    // fall back to the domain's own A record
    let ips;
    try { ips = await dns.resolve4(domain); } catch { ips = null; }
    if (!ips || !ips.length) return { domain, hosts: [], verdict: 'no-mx', detail: 'No MX records and no A record found for ' + domain + '.' };
    mxs = [{ exchange: domain + '.' }];
  }
  const hosts = mxs.slice(0, 3).map(m => m.exchange.replace(/\.$/, ''));
  const results = await Promise.all(hosts.map(async host => {
    const r = await rawTls(host);
    let status, detail;
    if (r.error) { status = 'warn'; detail = 'Could not verify TLS on ' + host + ': ' + r.error; }
    else if (!r.starttls) { status = 'fail'; detail = host + ' does not offer STARTTLS. Mail can travel in plaintext.'; }
    else {
      const c = r.cert; const exp = c ? new Date(c.valid_to) : null;
      if (c && exp && exp < new Date()) { status = 'fail'; detail = host + ' offers STARTTLS but the certificate expired on ' + c.valid_to + '.'; }
      else if (c && exp && exp - new Date() < 14 * 864e5) { status = 'warn'; detail = host + ' offers STARTTLS; certificate expires in ' + Math.ceil((exp - new Date()) / 864e5) + ' days (' + c.valid_to + ').'; }
      else { status = 'pass'; detail = host + ' offers STARTTLS; certificate valid until ' + (c ? c.valid_to : 'unknown') + (c && c.issuer ? ' (issuer: ' + c.issuer + ')' : '') + '.'; }
    }
    return { host, starttls: r.starttls, cert: r.cert, status, detail };
  }));
  const anyPass = results.some(r => r.status === 'pass');
  const anyFail = results.some(r => r.status === 'fail');
  let verdict = 'warn';
  if (anyPass && !anyFail) verdict = 'pass';
  else if (anyFail && !anyPass) verdict = 'fail';
  return { domain, hosts: results, verdict };
}

async function checkPtr(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch { return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'No MX to check PTR against.', fix: '' }; }
  const host = mxs[0].exchange.replace(/\.$/, '');
  let ip;
  try { ip = (await dns.resolve4(host))[0]; } catch { return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'MX host ' + host + ' does not resolve; cannot check PTR.', fix: '' }; }
  let ptr;
  try { ptr = (await dns.reverse(ip))[0]; } catch { ptr = null; }
  if (!ptr) return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'Sending IP ' + ip + ' has no PTR record. Some receivers reject mail from hosts without reverse DNS.', fix: 'Ask your mail host to set a PTR for ' + ip + ' (automatic on most managed mail).' };
  const p = ptr.replace(/\.$/, '');
  const match = host === p || host.endsWith('.' + p) || p.endsWith('.' + host);
  if (!match) return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'PTR for ' + ip + ' is ' + p + ', which does not match MX host ' + host + '.', fix: 'Align the PTR record with the MX hostname.' };
  return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'pass', detail: 'PTR for ' + ip + ' → ' + p + ' (matches MX host).', fix: '' };
}

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
async function checkPtrAll(target) {
  const t = String(target || '').trim();
  let ip, host = null;
  if (IP_RE.test(t)) { ip = t; }
  else {
    try { ip = (await dns.resolve4(t))[0]; } catch { return { target: t, verdict: 'no-ip', detail: 'No A record found for ' + t + '.' }; }
    host = t;
  }
  let ptr;
  try { ptr = (await dns.reverse(ip))[0]; } catch { ptr = null; }
  if (!ptr) return { target: t, ip, ptr: null, verdict: 'no-ptr', detail: 'IP ' + ip + ' has no PTR (reverse DNS) record. Many receivers reject mail from hosts without reverse DNS.', fix: 'Ask your mail host to set a PTR for ' + ip + ' (automatic on most managed mail).' };
  const p = ptr.replace(/\.$/, '');
  let fwd;
  try { fwd = await dns.resolve4(p); } catch { fwd = null; }
  const fcptr = fwd && fwd.includes(ip);
  if (host) {
    const match = host === p || host.endsWith('.' + p) || p.endsWith('.' + host);
    if (!match) return { target: t, ip, ptr: p, verdict: 'mismatch', detail: 'PTR for ' + ip + ' is ' + p + ', which does not match ' + host + '.', fix: 'Align the PTR record with the hostname.' };
    return { target: t, ip, ptr: p, verdict: 'pass', detail: 'PTR for ' + ip + ' → ' + p + ' (matches ' + host + ').', fix: '' };
  }
  if (!fcptr) return { target: t, ip, ptr: p, verdict: 'warn', detail: 'PTR for ' + ip + ' is ' + p + ', but ' + p + ' does not resolve back to ' + ip + ' (forward-confirmed PTR missing).', fix: 'Ensure ' + p + ' has an A record pointing to ' + ip + '.' };
  return { target: t, ip, ptr: p, verdict: 'pass', detail: 'PTR for ' + ip + ' → ' + p + ', and ' + p + ' resolves back to ' + ip + ' (forward-confirmed).', fix: '' };
}

const RBLS = [['zen.spamhaus.org', 'Spamhaus'], ['bl.spamcop.net', 'SpamCop'], ['b.barracudacentral.org', 'Barracuda']];
async function checkRbl(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch { return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'No MX to check sending IPs against blocklists.', fix: '' }; }
  const host = mxs[0].exchange.replace(/\.$/, '');
  let ip;
  try { ip = (await dns.resolve4(host))[0]; } catch { return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'Cannot resolve MX IP to check blocklists.', fix: '' }; }
  const rev = ip.split('.').reverse().join('.');
  const results = [];
  for (const [rbl, label] of RBLS) {
    try {
      const ans = await dns.resolveTxt(rev + '.' + rbl);
      results.push({ label, listed: ans.some(t => t.join('').includes('127.')), ok: true });
    } catch { results.push({ label, listed: false, ok: false }); }
  }
  const bad = results.filter(r => r.listed);
  if (bad.length) return { id: 'rbl', name: 'IP reputation (RBL)', status: 'fail', detail: 'Sending IP ' + ip + ' is listed on ' + bad.map(b => b.label).join(', ') + '. Mail from this IP will be blocked or marked spam.', fix: 'Request delisting (e.g. https://check.spamhaus.org) or move sending to a clean IP / ESP.' };
  const checked = results.filter(r => r.ok).length;
  if (!checked) return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'Blocklist lookups unavailable from this network; reputation unverified.', fix: '' };
  return { id: 'rbl', name: 'IP reputation (RBL)', status: 'pass', detail: 'Sending IP ' + ip + ' is clean on ' + checked + ' blocklist(s) checked.', fix: '' };
}

/* ---------------- scoring ---------------- */
const WEIGHTS = { mx: 20, spf: 15, dkim: 15, dmarc: 25, tls: 10, ptr: 5, rbl: 10 };
const gradeOf = s => s >= 90 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : 'D';
async function auditDomain(domain) {
  const checks = await Promise.all([
    checkMx(domain), checkSpf(domain), checkDkim(domain), checkDmarc(domain),
    checkTls(domain), checkPtr(domain), checkRbl(domain),
  ]);
  const score = Math.round(checks.reduce((s, c) => s + WEIGHTS[c.id] * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0));
  return { domain, at: new Date().toISOString(), score, grade: gradeOf(score), checks };
}

/* ---------------- http ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CANONICAL_BASE = 'https://inboxproof.email';
function canonicalTag(p) { return '<link rel="canonical" href="' + CANONICAL_BASE + p + '" />\n'; }
function ogMetaTags(base, pageUrl, extra) {
  let t = '<meta property="og:image" content="' + base + '/og.png" />\n'
    + '<meta property="og:image:width" content="1200" />\n'
    + '<meta property="og:image:height" content="630" />\n'
    + '<meta property="og:url" content="' + pageUrl + '" />\n';
  if (extra) t += extra;
  return t;
}
const rate = new Map(); // ip -> {n, reset}
function rateLimited(ip) {
  const now = Date.now();
  let e = rate.get(ip);
  if (!e || now > e.reset) { e = { n: 0, reset: now + 3600e3 }; rate.set(ip, e); }
  e.n++;
  return e.n > 20;
}
const apiRate = new Map(); // apiKey -> {n, reset}
function apiRateLimited(key) {
  const now = Date.now();
  let e = apiRate.get(key);
  if (!e || now > e.reset) { e = { n: 0, reset: now + 86400e3 }; apiRate.set(key, e); }
  e.n++;
  return e.n > 100;
}
function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100e3) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || 'unknown';
  try {
    await hydrate();
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('<head>', '<head>\n' + canonicalTag('/') + ogMetaTags(base, base + '/', ''));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (req.method === 'GET' && u.pathname === '/pro') {
      const sid = u.searchParams.get('session_id');
      if (sid && STRIPE_KEY) {
        try {
          const s = await stripe('GET', '/checkout/sessions/' + sid);
          if (s.payment_status === 'paid' && s.client_reference_id) {
            await activatePro(s.client_reference_id, s.metadata?.plan || 'pro', {
              stripeCustomerId: s.customer?.id || s.customer,
              stripeSubscriptionId: s.subscription,
              stripeLastPaidAt: new Date().toISOString(),
            });
          }
        } catch (e) { console.log('[checkout] session lookup failed:', e.message); }
      }
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'pro.html'), 'utf8').replace('<head>', '<head>\n' + canonicalTag('/pro')));
    }
    if ((req.method === 'GET' || u.pathname === '/api/track') && u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/v1/audit') {
        const key = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim() || (u.searchParams.get('key') || '').trim();
        const lead = findLeadByApiKey(key);
        if (!lead || !lead.pro) return sendJson(res, 401, { error: 'Invalid or non-Pro API key' });
        if (apiRateLimited(key)) return sendJson(res, 429, { error: 'API rate limit: 100 audits/day per key' });
        const domain = cleanDomain(u.searchParams.get('domain') || '');
        if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Valid ?domain=yourdomain.com required' });
        const audit = await auditDomain(domain);
        return sendJson(res, 200, { ok: true, ...audit });
      }
      if (u.pathname === '/api/health') {
        const totalAudits = Object.values(audits).reduce((n, a) => n + a.length, 0);
        return sendJson(res, 200, { ok: true, uptime_s: Math.round(process.uptime()), leads: Object.keys(leads).length, audits: totalAudits, pro: Object.values(leads).filter(l => l.pro).length });
      }
      if (u.pathname === '/api/track') {
        const page = String(u.searchParams.get('page') || req.headers['x-page'] || '/').slice(0, 200);
        const ref = String(u.searchParams.get('ref') || '').trim() || String(req.headers['referer'] || '').split('/')[2] || 'direct';
        const event = String(u.searchParams.get('event') || '').slice(0, 100);
        const team = String(u.searchParams.get('team') || '').trim().slice(0, 64);
        if (event) {
          stats.byEvent = stats.byEvent || {};
          stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;
          stats.lastEvent = { event, page, at: new Date().toISOString() };
        } else {
          stats.pageViews = (stats.pageViews || 0) + 1;
          stats.byPage[page] = (stats.byPage[page] || 0) + 1;
          if (ref) stats.byRef[ref] = (stats.byRef[ref] || 0) + 1;
          if (team) { stats.byTeam = stats.byTeam || {}; stats.byTeam[team] = (stats.byTeam[team] || 0) + 1; }
          stats.lastView = new Date().toISOString();
        }
        if (REMOTE) await upSet('stats', JSON.stringify(stats));
        else if (LOCAL) saveJson(STATS_F, stats);
        return sendJson(res, 200, { ok: true });
      }
      if (u.pathname === '/api/stats') {
        const secret = process.env.STATS_SECRET;
        if (!secret || u.searchParams.get('secret') !== secret) return sendJson(res, 403, { error: 'Forbidden' });
        const totalAudits = Object.values(audits).reduce((n, a) => n + a.length, 0);
        const pro = Object.values(leads).filter(l => l.pro);
        const referred = Object.values(leads).filter(l => l.referredBy).map(l => ({ email: l.email, referredBy: l.referredBy, at: l.referredAt || null }));
        const ev = stats.byEvent || {};
        // checkout_start was the event name in an earlier deploy; count both.
        const checkoutStarted = (ev.checkout_started || 0) + (ev.checkout_start || 0);
        const rate = (num, den) => (den ? Math.round(100 * num / den) : null);
        return sendJson(res, 200, {
          pageViews: stats.pageViews || 0,
          byPage: stats.byPage || {},
          byRef: stats.byRef || {},
          byTeam: stats.byTeam || {},
          byEvent: ev,
          funnel: {
            audit_start: ev.audit_start || 0,
            audit_complete: ev.audit_complete || 0,
            report_viewed: ev.report_viewed || 0,
            lead_captured: ev.lead_captured || 0,
            checkout_started: checkoutStarted,
            pro: pro.length,
            audit_to_checkout_pct: rate(checkoutStarted, ev.audit_complete || 0),
            checkout_to_pro_pct: rate(pro.length, checkoutStarted),
          },
          lastView: stats.lastView || null,
          lastEvent: stats.lastEvent || null,
          leads: Object.keys(leads).length,
          audits: totalAudits,
          pro: pro.length,
          proEmails: pro.map(l => l.email),
          proSince: pro.map(l => ({ email: l.email, plan: l.plan, since: l.proSince })),
          referrals: referred.length,
          referredLeads: referred,
        });
      }
      if (u.pathname === '/api/history') {
        const email = String(u.searchParams.get('email') || '').toLowerCase().trim();
        if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
        const lead = leads[email];
        if (!lead) return sendJson(res, 404, { error: 'No account for this email. Run a free audit first.' });
        return sendJson(res, 200, { lead, history: audits[email] || [] });
      }
      if (u.pathname === '/api/brand') {
        const email = String(u.searchParams.get('email') || '').toLowerCase().trim();
        if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
        const lead = leads[email];
        if (!lead) return sendJson(res, 404, { error: 'No account for this email. Run a free audit first.' });
        return sendJson(res, 200, { lead, brand: lead.brand || null });
      }
      if (u.pathname.startsWith('/api/report/')) {
        const id = u.pathname.slice('/api/report/'.length);
        const rep = await getReport(id);
        if (!rep) return sendJson(res, 404, { error: 'Report not found' });
        return sendJson(res, 200, rep);
      }
      if (u.pathname === '/api/dmarc-check') {
        const domain = cleanDomain(u.searchParams.get('domain'));
        if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
        if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP.' });
        const checks = await Promise.all([checkMx(domain), checkSpf(domain), checkDkim(domain), checkDmarc(domain)]);
        const W = { mx: 20, spf: 15, dkim: 15, dmarc: 25 };
        const total = Object.values(W).reduce((a, b) => a + b, 0);
        const raw = checks.reduce((s, c) => s + W[c.id] * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
        const score = Math.round(raw / total * 100);
        return sendJson(res, 200, { domain, at: new Date().toISOString(), score, grade: gradeOf(score), checks });
      }
      if (u.pathname === '/api/spam-check') {
        const domain = cleanDomain(u.searchParams.get('domain'));
        if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
        if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP.' });
        const checks = await Promise.all([checkMx(domain), checkSpf(domain), checkDkim(domain), checkDmarc(domain), checkTls(domain), checkPtr(domain), checkRbl(domain)]);
        const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
        const raw = checks.reduce((s, c) => s + WEIGHTS[c.id] * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
        const deliver = Math.round(raw / total * 100);
        const risk = 100 - deliver;
        const riskLabel = risk <= 15 ? 'Low' : risk <= 35 ? 'Moderate' : risk <= 60 ? 'High' : 'Severe';
        const verdict = risk <= 15 ? 'This domain looks like it will land in the inbox. Authentication, TLS and IP reputation are in good shape.'
          : risk <= 35 ? 'This domain will likely reach the inbox, but weak signals below give spam filters room to flag you.'
          : risk <= 60 ? 'This domain has real spam-filter risk. Fix the failing items before sending volume.'
          : 'This domain is at severe spam-filter risk. Mail from it is likely to be rejected or dumped to spam until the failing items are fixed.';
        const failing = checks.filter(c => c.status !== 'pass').map(c => ({ id: c.id, name: c.name, status: c.status, detail: c.detail, fix: c.fix }));
        return sendJson(res, 200, { domain, at: new Date().toISOString(), risk, riskLabel, deliver, grade: gradeOf(deliver), verdict, checks, failing });
      }
      if (u.pathname === '/api/blocklist-check') {
        let ip = String(u.searchParams.get('ip') || '').trim();
        const clientIp = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (!ip) ip = clientIp;
        const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (!m || m.slice(1).some(o => Number(o) > 255)) return sendJson(res, 400, { error: 'Enter a valid IPv4 address, e.g. 1.2.3.4' });
        if (rateLimited(clientIp)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP.' });
        const rev = ip.split('.').reverse().join('.');
        const BL = [
          ['sbl.spamhaus.org', 'Spamhaus SBL'],
          ['psbl.spamhaus.org', 'Spamhaus PBL'],
          ['xbl.spamhaus.org', 'Spamhaus XBL'],
          ['bl.spamcop.net', 'SpamCop'],
          ['b.barracudacentral.org', 'Barracuda'],
          ['cbl.abuseat.org', 'CBL'],
          ['dnsbl-1.uceprotect.net', 'UCEPROTECT L1'],
          ['dnsbl-2.uceprotect.net', 'UCEPROTECT L2'],
          ['dnsbl.sorbs.net', 'SORBS'],
        ];
        const isFalsePositive = c => !c || /^127\.255\.255\./.test(c) || /^127\.0\.0\.(0|1)$/.test(c);
        const results = await Promise.all(BL.map(async ([rbl, label]) => {
          const q = rev + '.' + rbl;
          let code = null;
          try { const a = await dns.resolve4(q); if (a.length) code = a[0]; } catch {}
          if (!code) { try { const t = await dns.resolveTxt(q); if (t.length) code = t[0].join(''); } catch {} }
          const listed = code !== null && !isFalsePositive(code);
          return { label, listed, code: listed ? code : null, fp: code !== null && !listed };
        }));
        const listed = results.filter(r => r.listed);
        return sendJson(res, 200, {
          ip, at: new Date().toISOString(), listedCount: listed.length, listed,
          clean: results.filter(r => !r.listed).map(r => r.label), results,
        });
      }
      if (u.pathname === '/api/mx-check') {
        const domain = cleanDomain(u.searchParams.get('domain'));
        if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
        if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP.' });
        let mxs = null;
        try { mxs = await dns.resolveMx(domain); } catch {}
        mxs = (mxs || []).filter(m => m.exchange && m.exchange !== '.');
        let hosts = [];
        if (mxs.length) hosts = mxs.map(m => m.exchange.toLowerCase());
        else {
          try { const a = await dns.resolve4(domain); if (a.length) hosts = [domain]; }
          catch { try { const a6 = await dns.resolve6(domain); if (a6.length) hosts = [domain]; } catch {} }
        }
        const noMx = !mxs.length;
        const top = hosts.slice(0, 5);
        const results = await Promise.all(top.map(async host => {
          let ip = null;
          try { ip = (await dns.resolve4(host))[0]; } catch {}
          if (!ip) { try { ip = (await dns.resolve6(host))[0]; } catch {} }
          let ptr = null;
          if (ip) { try { ptr = (await dns.reverse(ip))[0]; } catch {} }
          return { host, ip, ptr, resolves: !!ip };
        }));
        const allResolve = results.length > 0 && results.every(r => r.resolves);
        return sendJson(res, 200, {
          domain, at: new Date().toISOString(),
          hasMx: !noMx, mxCount: mxs ? mxs.length : 0,
          mx: mxs ? mxs.map(m => ({ exchange: m.exchange.toLowerCase(), priority: m.priority })) : null,
          fallbackA: noMx,
          results, allResolve,
        });
      }
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method === 'POST' && u.pathname === '/api/brand') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
      const lead = leads[email];
      if (!lead) return sendJson(res, 404, { error: 'No account for this email. Run a free audit first.' });
      if (!lead.pro || lead.plan !== 'agency') return sendJson(res, 403, { error: 'White-label reports are available on the Agency plan.' });
      const name = String(body.name || '').trim().slice(0, 60);
      const color = String(body.color || '').trim().slice(0, 9);
      const logoUrl = String(body.logoUrl || '').trim().slice(0, 300);
      if (!name) return sendJson(res, 400, { error: 'Enter your company name' });
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return sendJson(res, 400, { error: 'Color must be a hex value like #6366f1' });
      if (logoUrl && !/^https?:\/\/[^\s]+\.(png|jpe?g|svg|webp)$/i.test(logoUrl)) return sendJson(res, 400, { error: 'Logo must be a direct http(s) image URL (png, jpg, svg, webp)' });
      lead.brand = { name, color: color || '#6366f1', logoUrl };
      await persist('leads');
      return sendJson(res, 200, { ok: true, brand: lead.brand });
    }
    if (req.method === 'DELETE' && u.pathname === '/api/brand') {
      const email = String(u.searchParams.get('email') || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
      const lead = leads[email];
      if (!lead) return sendJson(res, 404, { error: 'No account for this email. Run a free audit first.' });
      if (!lead.pro || lead.plan !== 'agency') return sendJson(res, 403, { error: 'White-label reports are available on the Agency plan.' });
      delete lead.brand;
      await persist('leads');
      return sendJson(res, 200, { ok: true, brand: null });
    }
    if (req.method === 'POST' && u.pathname === '/api/lead') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
      const lead = await upsertLead(email, null);
      lead.source = String(body.source || 'lead-magnet-checklist').slice(0, 60);
      lead.sourceAt = new Date().toISOString();
      await persist('leads');
      return sendJson(res, 200, { ok: true, email: lead.email });
    }
    if (req.method === 'POST' && u.pathname === '/api/audit') {
      const body = await readBody(req);
      const domain = cleanDomain(body.domain);
      const email = String(body.email || '').toLowerCase().trim();
      if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
      if (email && !EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 audits/hour from this IP. Start a Pro trial for continuous monitoring.' });
      const audit = await auditDomain(domain);
      const reportId = crypto.randomUUID();
      audit.reportId = reportId;
      const refIn = String(body.ref || '').toUpperCase().trim().slice(0, 16);
      if (email) {
        await upsertLead(email, domain);
        const lead = leads[email];
        if (lead && lead.brand && lead.brand.name) audit.brand = lead.brand;
        if (refIn && refIn !== lead.refCode && await findLeadByRefCode(refIn)) {
          lead.referredBy = refIn;
          lead.referredAt = Date.now();
          await persist('leads');
        }
      }
      await saveReport(reportId, audit);
      if (email) {
        await pushAudit(email, audit);
        leads[email].lastScore = audit.score;
        leads[email].reportIds = leads[email].reportIds || [];
        leads[email].reportIds.push(reportId);
        if (leads[email].reportIds.length > 50) leads[email].reportIds = leads[email].reportIds.slice(-50);
        await persist('leads');
        await maybeSendAuditFollowup(email, domain, audit, reportId);
      }
      return sendJson(res, 200, { audit, reportId, refCode: email ? leads[email].refCode : null });
    }
    if (req.method === 'POST' && u.pathname === '/api/attach') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase().trim();
      const reportId = String(body.reportId || '').trim();
      const domain = cleanDomain(body.domain || '');
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
      if (!/^[a-f0-9-]{36}$/i.test(reportId)) return sendJson(res, 400, { error: 'Invalid report id' });
      const rep = await getReport(reportId);
      if (!rep) return sendJson(res, 404, { error: 'Report not found' });
      await upsertLead(email, domain || rep.domain || null);
      await pushAudit(email, rep);
      if (rep.score != null) leads[email].lastScore = rep.score;
      leads[email].reportIds = leads[email].reportIds || [];
      if (!leads[email].reportIds.includes(reportId)) leads[email].reportIds.push(reportId);
      if (leads[email].reportIds.length > 50) leads[email].reportIds = leads[email].reportIds.slice(-50);
      await persist('leads');
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/tls-check') {
      const body = await readBody(req);
      const domain = cleanDomain(body.domain);
      if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP. Start a Pro trial for continuous monitoring.' });
      const result = await checkTlsAll(domain);
      return sendJson(res, 200, { result });
    }
    if (req.method === 'POST' && u.pathname === '/api/ptr-check') {
      const body = await readBody(req);
      const target = String(body.target || '').trim();
      if (!target) return sendJson(res, 400, { error: 'Enter a valid IP address or domain' });
      if (IP_RE.test(target)) { if (target.split('.').some(o => Number(o) > 255)) return sendJson(res, 400, { error: 'Enter a valid IP address' }); }
      else if (!DOMAIN_RE.test(target)) return sendJson(res, 400, { error: 'Enter a valid IP address or domain' });
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP. Start a Pro trial for continuous monitoring.' });
      const result = await checkPtrAll(target);
      return sendJson(res, 200, { result });
    }
    if (req.method === 'POST' && u.pathname === '/api/pro') {
      // Dev backdoor removed: Pro access is only granted via Stripe checkout/webhook.
      return sendJson(res, 410, { error: 'Gone. Pro is activated by payment.' });
    }
    if (req.method === 'GET' && u.pathname === '/sitemap.xml') {
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      const skip = new Set(['404.html', 'pro.html', 'report.html']);
      const entries = [];
      const today = new Date().toISOString().slice(0, 10); // static site: content is current as of this deploy
      try {
        const top = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html') && !skip.has(f));
        const rest = [];
        for (const f of top) { if (f === 'index.html') entries.push({ path: '/', lastmod: today }); else rest.push({ path: '/' + f.replace(/\.html$/, ''), lastmod: today }); }
        entries.push({ path: '/#pricing', lastmod: '' }, { path: '/#faq', lastmod: '' });
        entries.push(...rest);
        const blogDir = path.join(PUBLIC, 'blog');
        if (fs.existsSync(blogDir)) { for (const f of fs.readdirSync(blogDir).filter(f => f.endsWith('.html'))) entries.push({ path: '/blog/' + f.replace(/\.html$/, ''), lastmod: today }); }
        entries.push({ path: '/rss.xml', lastmod: today });
      } catch { /* keep anchors only */ }
      const urls = entries.map(e => '  <url><loc>' + base + e.path + '</loc>' + (e.lastmod ? '<lastmod>' + e.lastmod + '</lastmod>' : '') + '<changefreq>weekly</changefreq></url>').join('\n');
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');
    }
    if (req.method === 'GET' && /^\/r\/[a-f0-9-]{36}$/.test(u.pathname)) {
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      const id = u.pathname.slice('/r/'.length);
      const rep = await getReport(id);
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      let extra;
      if (rep && rep.domain) {
        extra = '<meta property="og:title" content="' + esc('Deliverability report: ' + rep.domain + ' scored ' + rep.score + '/100') + '" />\n'
          + '<meta property="og:description" content="' + esc('Inboxproof audited ' + rep.domain + ' and scored it ' + rep.score + '/100 (' + rep.grade + '). See the exact records to fix and start daily monitoring.') + '" />\n'
          + '<meta property="og:type" content="website" />\n<meta name="twitter:card" content="summary_large_image" />\n';
      } else {
        extra = '<meta property="og:title" content="Inboxproof deliverability report" />\n'
          + '<meta property="og:description" content="Public deliverability audit report generated by Inboxproof." />\n'
          + '<meta property="og:type" content="website" />\n<meta name="twitter:card" content="summary_large_image" />\n';
      }
      const html = fs.readFileSync(path.join(PUBLIC, 'report.html'), 'utf8').replace('<head>', '<head>\n' + canonicalTag('/r/' + id) + ogMetaTags(base, base + '/r/' + id, extra));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    if (req.method === 'POST' && u.pathname === '/api/checkout') {
      const body = await readBody(req);
      if (!STRIPE_KEY || !PRICE[body.plan]) return sendJson(res, 503, { error: 'Payments not configured' });
      const email = String(body.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
      const plan = body.plan === 'agency' ? 'agency' : 'pro';
      let customer;
      try {
        const found = await stripe('GET', '/customers?email=' + encodeURIComponent(email));
        customer = found.data[0] || null;
      } catch {}
      if (!customer) customer = await stripe('POST', '/customers', { email });
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      const s = await stripe('POST', '/checkout/sessions', {
        mode: 'subscription',
        allow_promotion_codes: 'true',
        'line_items[0][price]': PRICE[plan],
        'line_items[0][quantity]': '1',
        customer: customer.id,
        client_reference_id: email,
        'metadata[plan]': plan,
        'metadata[domain]': String(body.domain || ''),
        success_url: base + '/pro?session_id={CHECKOUT_SESSION_ID}&email=' + encodeURIComponent(email),
        cancel_url: base + '/?cancelled=1',
      });
      await upsertLead(email, body.domain || null);
      await recordEvent('checkout_start', '/checkout');
      return sendJson(res, 200, { url: s.url, sessionId: s.id });
    }
    if (req.method === 'POST' && u.pathname === '/api/portal') {
      const body = await readBody(req);
      if (!STRIPE_KEY) return sendJson(res, 503, { error: 'Payments not configured' });
      const email = String(body.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
      const lead = leads[email];
      if (!lead || !lead.stripeCustomerId) return sendJson(res, 404, { error: 'No subscription found for this email' });
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      try {
        const s = await stripe('POST', '/billing_portal/sessions', { customer: lead.stripeCustomerId, return_url: base + '/pro' });
        return sendJson(res, 200, { url: s.url });
      } catch (e) { return sendJson(res, 502, { error: 'Could not open billing portal' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/webhook') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!STRIPE_WEBHOOK_SECRET) return sendJson(res, 501, { error: 'Webhooks not configured' });
      {
        const sig = req.headers['stripe-signature'] || '';
        const t = (sig.match(/t=(\d+)/) || [])[1];
        const v1 = (sig.match(/v1=([a-f0-9]+)/) || [])[1];
        if (!t || !v1) return sendJson(res, 400, { error: 'Missing Stripe-Signature' });
        const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update('' + t + '.' + raw).digest('hex');
        if (expected !== v1) return sendJson(res, 400, { error: 'Bad signature' });
      }
      const ev = JSON.parse(raw);
      const obj = ev.data?.object || {};
      if (ev.type === 'checkout.session.completed' && obj.payment_status === 'paid' && obj.client_reference_id) {
        await activatePro(obj.client_reference_id, obj.metadata?.plan || 'pro', {
          stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription, stripeLastPaidAt: new Date().toISOString(),
        });
        await recordEvent('checkout_success', '/pro');
        console.log('[webhook] paid:', obj.client_reference_id, obj.metadata?.plan);
      } else if (ev.type === 'customer.subscription.deleted' && obj.customer) {
        const c = await stripe('GET', '/customers/' + obj.customer);
        if (c.email && leads[c.email]) { leads[c.email].pro = false; await persist('leads'); console.log('[webhook] cancelled:', c.email); }
      }
      return sendJson(res, 200, { received: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/monitor') {
      const isCron = req.headers['vercel-cron'] === '1';
      const secret = process.env.MONITOR_SECRET || '';
      const authed = isCron || (secret && (req.headers['x-monitor-secret'] === secret || req.headers.authorization === 'Bearer ' + secret));
      if (!authed) return sendJson(res, 401, { error: 'Unauthorized' });
      const n = await monitorCycle();
      return sendJson(res, 200, { ok: true, checked: n });
    }
    if (req.method === 'POST' && u.pathname === '/api/delete') {
      const body = await readBody(req);
      const email = String(body.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
      const lead = leads[email];
      const ids = lead?.reportIds || [];
      for (const id of ids) await deleteReport(id);
      delete leads[email];
      delete audits[email];
      await persist('leads');
      await persist('audits');
      if (!REMOTE) saveJson(REPORTS_F, reports);
      return sendJson(res, 200, { ok: true, existed: !!lead, reportsDeleted: ids.length });
    }
    // static
    if (req.method === 'GET') {
      let rel = u.pathname === '/' ? 'index.html' : u.pathname;
      if (!path.extname(rel)) rel += '.html';
      const p = path.normalize(path.join(PUBLIC, rel));
      if (p.startsWith(PUBLIC) && fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.extname(p);
        if (ext === '.html') {
          const html = fs.readFileSync(p, 'utf8').replace('<head>', '<head>\n' + canonicalTag(u.pathname));
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          return res.end(html);
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        return res.end(fs.readFileSync(p));
      }
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    return sendJson(res, e.message === 'Rate limit: 20 audits/hour from this IP. Start a Pro trial for continuous monitoring.' ? 429 : 500, { error: e.message });
  }
}

/* ---------------- pro monitoring scheduler ---------------- */
let lastMonitorRun = 0; // in-memory gate (local mode)
async function monitorCycle() {
  await hydrate();
  const now = Date.now();
  let last = lastMonitorRun;
  if (REMOTE) { try { const v = await upGet('monitor:lastRun'); if (v) last = Number(v) || 0; } catch {} }
  if (now - last < (Number(process.env.MONITOR_GATE_MS) || 5 * 3600e3)) return 0; // gate: max one cycle per 5h (MONITOR_GATE_MS overrides for tests)
  const pro = Object.values(leads).filter(l => l.pro && l.domain).slice(0, 15);
  for (const lead of pro) {
    try {
      const prevScore = lead.lastScore;
      const prevFails = lead.lastFailIds || [];
      const a = await auditDomain(lead.domain);
      await pushAudit(lead.email, a);
      const newFails = a.checks.filter(c => c.status === 'fail').map(c => c.id);
      const newFailures = newFails.filter(id => !prevFails.includes(id));
      const dropped = prevScore != null && a.score < prevScore;
      const regressed = prevScore != null && (dropped || newFailures.length > 0);
      lead.lastScore = a.score;
      lead.lastFailIds = newFails;
      await persist('leads');
      console.log('[monitor]', lead.email, lead.domain, '→', a.score, a.grade);
      if (regressed) {
        const fails = a.checks.filter(c => c.status === 'fail');
        const rows = fails.map(c => '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' + c.name + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#c0392b;font-weight:600">' + c.status + '</td></tr>').join('');
        const html = '<div style="font-family:Arial,sans-serif;max-width:560px">' +
          '<h2 style="color:#1a1a2e;margin:0 0 8px">⚠️ ' + lead.domain + ' email health dropped</h2>' +
          '<p style="color:#444;line-height:1.6">Your daily InboxProof re-audit found a regression on <b>' + lead.domain + '</b>. ' +
          (dropped ? 'Score fell from <b>' + prevScore + '</b> to <b>' + a.score + '</b>.' : '') +
          (newFailures.length ? ' ' + newFailures.length + ' check(s) now failing.' : '') + '</p>' +
          (rows ? '<table style="width:100%;border-collapse:collapse;margin:14px 0">' + rows + '</table>' : '') +
          '<p style="color:#444;line-height:1.6">Open your dashboard to see the full audit and exact fix steps.</p>' +
          '<p style="color:#888;font-size:12px;margin-top:20px">InboxProof — daily email deliverability monitoring. You are receiving this because ' + lead.email + ' is on a Pro plan.</p>' +
          '</div>';
        await sendAlertEmail(lead.email, lead.domain + ' email health dropped to ' + a.score + '/100', html);
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.log('[monitor] error', lead.email, e.message); }
  }
  lastMonitorRun = now;
  if (REMOTE) { try { await upSet('monitor:lastRun', String(now)); } catch {} }
  return pro.length;
}

export default handler;
export { auditDomain };

const IS_VERCEL = !!process.env.VERCEL;
if (!IS_VERCEL && !process.env.NO_LISTEN) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log('Inboxproof listening on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + (REMOTE ? ' (remote store)' : ' (local files)'));
    setTimeout(monitorCycle, 45e3);
  });
  setInterval(monitorCycle, 6 * 3600e3);
}
