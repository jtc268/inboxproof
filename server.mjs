// Inboxproof — zero-dependency Node server
// Real deliverability audit engine + email capture + Pro monitoring.
// Free-lead follow-up sequence: re-audits captured domains at ~48h / ~96h.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { createStore } from './storage.mjs';
import { createAuth } from './auth.mjs';
import { publicMetadata } from './seo.mjs';
import { createAnalytics, CLIENT_EVENTS, ANALYTICS_STARTED_AT, attachAcquisition, stripeAttribution } from './analytics.mjs';
import dnsModule from 'node:dns/promises';
import { smtpTls, inspectSpf, dkimKeyInfo } from './checks.mjs';
const dns = new dnsModule.Resolver({timeout:2000,tries:1});
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
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
const PRICE = { pro: process.env.STRIPE_PRICE_PRO || 'price_1U6dWBFzAAOxCQiQs2LmWAT9', agency: process.env.STRIPE_PRICE_AGENCY || 'price_1U6dWBFzAAOxCQiQ1rKWK7nU' };
const APP_URL = process.env.APP_URL || 'https://inboxproof.email';
const stripe = async (m, p, body) => {
  const r = await fetch('https://api.stripe.com/v1' + p, {
    method: m,
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Stripe ' + p + ' ' + r.status + ': ' + (j.error?.message || ''));
  return j;
};
const activatePro = async (email, plan, stripeInfo = {}) => {
  const lead = await upsertLead(email, null);
  const wasPro = !!lead.pro;
  lead.pro = true;
  lead.plan = plan;
  lead.proSince = lead.proSince || new Date().toISOString();
  if (!lead.apiKey) lead.apiKey = 'ip_' + crypto.randomBytes(16).toString('hex');
  Object.assign(lead, stripeInfo);
  // Referral reward: when a referred lead first becomes Pro, the referrer earns a free month of Pro.
  if (!wasPro && lead.referredBy) {
    const fresh = await findLeadByRefCode(lead.referredBy);
    if (fresh && fresh.email !== lead.email) {
      const r = leads[fresh.email] || (leads[fresh.email] = Object.assign({}, fresh));
      r.referralCredits = (r.referralCredits || 0) + 1;
      r.referralProUntil = Math.max(r.referralProUntil || 0, Date.now() + 30 * 86400e3);
      if (!r.pro) { r.pro = true; r.plan = r.plan || 'pro'; r.proSince = r.proSince || new Date().toISOString(); }
      r.lastReferralRewardAt = new Date().toISOString();
      console.log('[referral] reward month:', r.email, 'for', lead.email);
    }
  }
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
const store = createStore({url:SB_URL,key:SB_KEY,directory:DATA,remote:REMOTE,local:LOCAL});
const upGet=store.get, upSet=store.set;
const leads=store.proxy('leads'), audits=store.proxy('audits'), stats=store.proxy('stats');
let reports=loadJson(REPORTS_F,{});
const hydrate=store.hydrate, persist=store.persist;
const auth=createAuth({store,sendEmail:sendAlertEmail,baseUrl:APP_URL,secure:!APP_URL.startsWith('http://localhost')});
const analytics=createAnalytics({store});
async function measure(event,details={}){try{return await analytics.record({event,...details});}catch(e){console.error('[analytics]',event,e.message);return false;}}
async function captureAcquisition(lead,context,page){
  const first=!lead.acquisition&&Number(lead.createdAt)>=Date.parse(ANALYTICS_STARTED_AT);
  attachAcquisition(lead,context);await persist('leads');
  if(first)await measure('lead_captured',{id:'lead:'+lead.id,page,context,test:lead.test||context?.test,at:new Date(lead.createdAt).toISOString()});
}
function measuredHtml(html){return html.replace(/<head>/i,'<head>\n<script src="/analytics.js"></script>');}
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
const upDel=store.del;
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
  if (domain) { if(!leads[k].pro)leads[k].domain = domain; leads[k].lastAuditAt = Date.now(); }
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
async function sendAlertEmail(to, subject, html, idempotencyKey) {
  if (!RESEND_KEY) { console.log('[alert] RESEND_API_KEY not set; skipping email to', to); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json', ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}) },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ from: ALERT_FROM, to: [to], reply_to: 'joec88@gmail.com', subject, html }),
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
    '<a href="https://inboxproof.email/?utm_source=inboxproof&amp;utm_medium=email&amp;utm_campaign=audit_followup#pricing" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
    (lead.refCode ? '<p style="color:#888;font-size:12px;line-height:1.6;margin-top:18px">Know someone else wrestling with deliverability? Send them the free audit with your link: <a href="https://inboxproof.email/?ref=' + lead.refCode + '" style="color:#6366f1;font-weight:600">inboxproof.email/?ref=' + lead.refCode + '</a>. When they upgrade to Pro, you get a free month of Pro.</p>' : '') +
    '<p style="color:#888;font-size:12px;line-height:1.5;margin-top:24px">InboxProof &middot; free email deliverability audit. You are receiving this because you ran a free audit on ' + domain + '. <a href="https://inboxproof.email/r/' + reportId + '" style="color:#888">View your full report</a>.</p>' +
    '</div>';
  const ok = await sendAlertEmail(email, domain + ' email health: ' + audit.score + '/100 (' + audit.grade + ')', html);
  if (ok) {
    lead.lastFollowupAt = new Date().toISOString();
    await persist('leads');
  }
}

// Delayed nurture sequence for free leads who ran an audit but have not upgraded.
// Runs inside monitorCycle (Vercel cron, ~every 5h). Two nudges after the last audit:
// ~48h (stage 0) and ~96h (stage 1, final). Each nudge re-audits the domain so the
// email reflects the current state, and only sends while checks are still failing or
// warning. Skips Pro and test leads. Self-contained: does not depend on AUDIT_FOLLOWUP_EMAIL.
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
async function leadFollowupCycle() {
  const now = Date.now();
  const DAY = 86400e3;
  const free = Object.values(leads).filter(l => !l.pro && l.domain && !l.test && l.lastAuditAt && (l.followupStage || 0) < 2);
  let sent = 0;
  for (const lead of free) {
    if (sent >= 10) break;
    const stage = lead.followupStage || 0;
    const days = (now - lead.lastAuditAt) / DAY;
    const due = (stage === 0 && days >= 2) || (stage === 1 && days >= 6);
    if (!due) continue;
    let a;
    try { a = await auditDomain(lead.domain); } catch { continue; }
    const fails = a.checks.filter(c => c.status === 'fail');
    const warns = a.checks.filter(c => c.status === 'warn');
    if (!fails.length && !warns.length) {
      lead.followupStage = 2; // healthy now; stop the sequence
      await persist('leads');
      continue;
    }
    const reportId = a.reportId || (lead.reportIds && lead.reportIds.length ? lead.reportIds[lead.reportIds.length - 1] : '');
    let subject, html;
    if (stage === 0) {
      subject = 'We re-checked ' + lead.domain + '. ' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + ' still failing';
      html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
        '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">' + lead.domain + ' still scored ' + a.score + '/100 (' + a.grade + ')</h2>' +
        '<p style="color:#444;line-height:1.6;margin:0 0 14px">We re-ran the free audit on <b>' + lead.domain + '</b> today. ' +
        '<b>' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + '</b> are still failing' +
        (warns.length ? ' and <b>' + warns.length + '</b> ' + (warns.length > 1 ? 'are' : 'is') + ' warning' : '') +
        '. These are the same issues keeping your email out of the inbox:</p>' +
        followupTable(fails, warns) +
        '<p style="color:#444;line-height:1.6;margin:0 0 14px">The fixes above are free to do yourself. If you would rather just know the moment any of them breaks or a new one appears, Pro re-checks ' + lead.domain + ' daily and emails you only when something changes.</p>' +
        '<a href="https://inboxproof.email/?utm_source=inboxproof&amp;utm_medium=email&amp;utm_campaign=audit_followup#pricing" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
        followupFooter(lead, reportId) +
        '</div>';
    } else {
      subject = 'Last check on ' + lead.domain + ' before we stop emailing';
      html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
        '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">Last check on ' + lead.domain + '</h2>' +
        '<p style="color:#444;line-height:1.6;margin:0 0 14px">This is the last email we will send about <b>' + lead.domain + '</b>. We re-checked it today and ' + fails.length + ' check' + (fails.length > 1 ? 's' : '') + ' are still failing.</p>' +
        followupTable(fails, warns) +
        '<p style="color:#444;line-height:1.6;margin:0 0 14px">If you have already fixed these, run a fresh free audit to confirm. If not, the steps above are the exact fixes. Pro monitors ' + lead.domain + ' daily so you do not have to keep checking by hand.</p>' +
        '<a href="https://inboxproof.email/?utm_source=inboxproof&amp;utm_medium=email&amp;utm_campaign=audit_followup#pricing" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
        followupFooter(lead, reportId) +
        '</div>';
    }
    const ok = await sendAlertEmail(lead.email, subject, html);
    if (ok) {
      lead.followupStage = stage + 1;
      lead.lastFollowupAt = new Date().toISOString();
      await persist('leads');
      await recordEvent('followup_stage' + (stage + 1), '/followup');
      sent++;
      console.log('[followup] stage ' + (stage + 1) + ' sent to', lead.email, lead.domain, a.score);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return sent;
}

// "Email me my report": deliver the full audit to the lead's inbox. Best-effort;
// lead capture (upsertLead) is the primary value and always happens first.
async function sendReportEmail(email, domain, audit, reportId) {
  const fails = audit.checks.filter(c => c.status === 'fail');
  const rows = audit.checks.map(c =>
    '<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a2e;font-weight:600">' + c.name + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:' + (c.status === 'fail' ? '#c0392b' : c.status === 'warn' ? '#e67e22' : '#27ae60') + ';font-weight:600;white-space:nowrap">' + c.status + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:#444">' + (c.fix || c.detail || '') + '</td></tr>'
  ).join('');
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">' +
    '<h2 style="color:#1a1a2e;margin:0 0 10px;font-size:20px">' + domain + ' deliverability report: ' + audit.score + '/100 (' + audit.grade + ')</h2>' +
    '<p style="color:#444;line-height:1.6;margin:0 0 14px">Here is the full audit of <b>' + domain + '</b> you just ran. ' +
    (fails.length ? 'You have <b>' + fails.length + ' failing check' + (fails.length > 1 ? 's' : '') + '</b> to fix first.' : 'No checks are failing. Review any warnings below.') + '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Check</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Status</th><th style="text-align:left;padding:8px 10px;border-bottom:2px solid #ddd;color:#1a1a2e;font-size:13px">Detail / fix</th></tr>' +
    rows + '</table>' +
    '<p style="color:#444;line-height:1.6;margin:0 0 14px">Records change. Want us to watch ' + domain + ' daily and email you the moment one breaks?</p>' +
    '<a href="https://inboxproof.email/?utm_source=inboxproof&amp;utm_medium=email&amp;utm_campaign=audit_report#pricing" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Start Pro monitoring</a>' +
    ((leads[email] && leads[email].refCode) ? '<p style="color:#888;font-size:12px;line-height:1.6;margin-top:18px">Know someone else wrestling with deliverability? Send them the free audit with your link: <a href="https://inboxproof.email/?ref=' + leads[email].refCode + '" style="color:#6366f1;font-weight:600">inboxproof.email/?ref=' + leads[email].refCode + '</a>. When they upgrade to Pro, you get a free month of Pro.</p>' : '') +
    '<p style="color:#888;font-size:12px;line-height:1.5;margin-top:24px">InboxProof &middot; free email deliverability audit. <a href="https://inboxproof.email/r/' + reportId + '?utm_source=inboxproof&amp;utm_medium=email&amp;utm_campaign=audit_report" style="color:#888">View your full report online</a>.</p>' +
    '</div>';
  return await sendAlertEmail(email, 'Your ' + domain + ' deliverability report', html);
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

const checkSpf=domain=>inspectSpf(domain,dns);

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
  if(!found.length)return {id:'dkim',name:'DKIM',status:'warn',detail:'No key found among '+DKIM_SELECTORS.length+' common selectors. A custom selector may exist. Message signing is unverified.',fix:'Check the selector in a sent message DKIM-Signature header and confirm it with your email provider.'};
  const parsed=found.map(f=>({...f,key:dkimKeyInfo(f.rec)}));
  const valid=parsed.find(f=>f.key.valid&&(f.key.type==='Ed25519'||f.key.bits>=1024));
  if(!valid)return {id:'dkim',name:'DKIM',status:'warn',detail:'Published keys need review: '+parsed.map(f=>f.sel+': '+(f.key.reason||f.key.bits+' bits')).join('; '),fix:'Confirm the active selector and publish the complete public key from your provider.'};
  return {id:'dkim',name:'DKIM',status:'pass',detail:'Published '+valid.key.type+' key at '+valid.sel+'._domainkey ('+valid.key.bits+' bits). This verifies the key format, not a sent message signature.',fix:''};
}

async function checkDmarc(domain) {
  let txts;
  try { txts = await dns.resolveTxt('_dmarc.' + domain); } catch {
    return { id: 'dmarc', name: 'DMARC', status: 'fail', detail: 'No DMARC record at _dmarc.' + domain + '. Bulk-sender requirements from Gmail and Microsoft include DMARC. Review the requirements that apply to your sending volume.', fix: 'Start safe (report-only), then escalate:\n_dmarc TXT "v=DMARC1; p=none; rua=mailto:postmaster@' + domain + '; pct=100"' };
  }
  const rec = (txts.map(t => t.join('')).find(s => /^v=dmarc1/i.test(s)) || '').trim();
  if (!rec) return { id: 'dmarc', name: 'DMARC', status: 'fail', detail: 'TXT at _dmarc.' + domain + ' is not a valid DMARC record.', fix: 'Publish: _dmarc TXT "v=DMARC1; p=none; rua=mailto:postmaster@' + domain + '"' };
  const p = (rec.match(/p=(none|quarantine|reject)/i) || [])[1];
  const rua = /rua=/i.test(rec);
  let status, detail, fix = '';
  if (!p) { status = 'fail'; detail = 'DMARC record has no policy (p=). Record: ' + rec; fix = 'Add p=none to start, then escalate to p=quarantine.'; }
  else if (p === 'none') { status = 'warn'; detail = 'DMARC p=none monitors without requesting quarantine or rejection. It can meet provider minimum DMARC requirements; review reports before increasing enforcement.'; fix = 'Review DMARC reports and confirm legitimate senders before choosing quarantine or reject. Reporting address: postmaster@' + domain; }
  else if (p === 'quarantine') { status = 'pass'; detail = 'DMARC p=quarantine requests quarantine for messages that fail DMARC; receiver handling can vary.'; fix = 'Review legitimate sender alignment and reports before choosing p=reject.'; }
  else { status = 'pass'; detail = 'DMARC p=reject requests rejection of messages that fail DMARC; receiver handling can vary.'; }
  if (!rua && status !== 'fail') { status = 'warn'; detail += ' No rua= reporting address, so you will never receive abuse reports.'; fix = (fix ? fix + '\n' : '') + 'Add rua=mailto:postmaster@' + domain; }
  return { id: 'dmarc', name: 'DMARC', status, detail, fix };
}

const rawTls=host=>smtpTls(host,{resolver:dns});

async function checkTls(domain) {
  let mxs;
  try { mxs = await dns.resolveMx(domain); } catch { mxs = null; }
  if (!mxs || !mxs.length) return { id: 'tls', name: 'TLS & STARTTLS', status: 'warn', detail: 'No MX host available to test TLS against.', fix: '' };
  const host = mxs.filter(x=>x.exchange&&x.exchange!=='.').sort((a,b)=>a.priority-b.priority)[0]?.exchange.replace(/\.$/, '');
  const r = await rawTls(host);
  if (r.error) return { id: 'tls', name: 'TLS & STARTTLS', status: r.certificateError?'fail':'warn', detail: 'Could not verify TLS on ' + host + ': ' + r.error, fix: '' };
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
    if (r.error) { status = r.certificateError?'fail':'warn'; detail = 'Could not verify TLS on ' + host + ': ' + r.error; }
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
  const host = mxs.filter(x=>x.exchange&&x.exchange!=='.').sort((a,b)=>a.priority-b.priority)[0]?.exchange.replace(/\.$/, '');
  let ip;
  try { ip = (await dns.resolve4(host))[0]; } catch { return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'MX host ' + host + ' does not resolve; cannot check PTR.', fix: '' }; }
  let ptr;
  try { ptr = (await dns.reverse(ip))[0]; } catch { ptr = null; }
  if (!ptr) return { id: 'ptr', name: 'Reverse DNS (PTR)', status: 'warn', detail: 'Observed MX IP ' + ip + ' has no PTR record. Some receivers reject mail from hosts without reverse DNS.', fix: 'Ask your mail host to set a PTR for ' + ip + ' (automatic on most managed mail).' };
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
  try { mxs = await dns.resolveMx(domain); } catch { return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'No MX address available for blocklist checks.', fix: '' }; }
  const host = mxs.filter(x=>x.exchange&&x.exchange!=='.').sort((a,b)=>a.priority-b.priority)[0]?.exchange.replace(/\.$/, '');
  let ip;
  try { ip = (await dns.resolve4(host))[0]; } catch { return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'Cannot resolve MX IP to check blocklists.', fix: '' }; }
  const rev = ip.split('.').reverse().join('.');
  const results = [];
  for (const [rbl, label] of RBLS) {
    try {
      const ans = await dns.resolve4(rev + '.' + rbl);
      const blocked=ans.some(x=>/^127\.255\.255\./.test(x));
      results.push({ label, listed: !blocked&&ans.some(x=>/^127\./.test(x)), ok: !blocked });
    } catch(e) { results.push({ label, listed:false, ok:['ENOTFOUND','ENODATA'].includes(e.code) }); }
  }
  const bad = results.filter(r => r.listed);
  if (bad.length) return { id: 'rbl', name: 'IP reputation (RBL)', status: 'fail', detail: 'Observed MX IP ' + ip + ' is listed on ' + bad.map(b => b.label).join(', ') + '. This is an inbound MX address and may differ from your outbound sending IP.', fix: 'Request delisting (e.g. https://check.spamhaus.org) or move sending to a clean IP / ESP.' };
  const checked = results.filter(r => r.ok).length;
  if (!checked) return { id: 'rbl', name: 'IP reputation (RBL)', status: 'warn', detail: 'Blocklist lookups unavailable from this network; reputation unverified.', fix: '' };
  return { id: 'rbl', name: 'IP reputation (RBL)', status: 'pass', detail: 'Observed MX IP ' + ip + ' is clean on ' + checked + ' blocklist(s) checked.', fix: '' };
}

/* ---------------- scoring ---------------- */
const WEIGHTS = { mx: 20, spf: 15, dkim: 15, dmarc: 25, tls: 10, ptr: 5, rbl: 10 };
const gradeOf = s => s >= 90 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : 'D';
async function auditDomain(domain) {
  const checks = await Promise.all([['mx','MX & mail routing',checkMx],['spf','SPF',checkSpf],['dkim','DKIM',checkDkim],['dmarc','DMARC',checkDmarc],['tls','TLS & STARTTLS',checkTls],['ptr','Reverse DNS',checkPtr],['rbl','IP reputation',checkRbl]].map(async([id,name,fn])=>{try{return await fn(domain);}catch{return {id,name,status:'warn',detail:'This check could not be completed. Try again later.',fix:''};}}));
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
function sendJson(res, code, obj) { res.setHeader('Cache-Control','no-store'); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100e3) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
async function requestHandler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const ip = process.env.VERCEL ? String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
  try {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    if (u.pathname.startsWith('/api/') || ['/pro','/login'].includes(u.pathname)) res.setHeader('Cache-Control','no-store');
    const origin=req.headers.origin;
    if (!['GET','HEAD'].includes(req.method) && u.pathname!='/api/webhook' && origin && origin!==APP_URL && origin!=='http://'+req.headers.host && origin!=='https://'+req.headers.host) return sendJson(res,403,{error:'Request origin is not allowed'});
    if (req.method === 'POST' && u.pathname === '/api/auth/request') {
      const body=await readBody(req);const email=String(body.email||'').trim().toLowerCase();
      if(!EMAIL_RE.test(email)||email.length>254)return sendJson(res,400,{error:'Enter a valid email address'});
      const result=await auth.request(email,ip);return sendJson(res,result.status,result);
    }
    if (req.method === 'POST' && u.pathname === '/api/auth/verify') {
      const body=await readBody(req);const email=await auth.verify(String(body.token||''),res);
      return sendJson(res,email?200:400,email?{ok:true}:{error:'This sign-in link has expired or was already used. Request a new link.'});
    }
    if(req.method==='POST' && u.pathname==='/api/auth/logout'){await auth.logout(req,res);return sendJson(res,200,{ok:true});}
    const protectedPaths=new Set(['/api/history','/api/brand','/api/referrals','/api/portal','/api/delete','/api/domains','/api/recheck','/api/account']);
    let accountEmail=null;
    if(protectedPaths.has(u.pathname)){
      accountEmail=await auth.identity(req);
      if(!accountEmail)return sendJson(res,401,{error:'Sign in to access your account',login:'/login'});
      const requested=u.searchParams.get('email');
      if(requested&&requested.toLowerCase().trim()!==accountEmail)return sendJson(res,403,{error:'This account belongs to a different signed-in user'});
      u.searchParams.set('email',accountEmail);
    }
    if(req.method==='POST'&&u.pathname==='/api/analytics/events'){
      if(req.headers['sec-gpc']==='1'||req.headers.dnt==='1')return sendJson(res,200,{ok:true,ignored:true});
      const body=await readBody(req);
      if(!CLIENT_EVENTS.has(body.event)||!/^[-a-zA-Z0-9]{16,80}$/.test(body.id||''))return sendJson(res,400,{error:'Invalid analytics event'});
      if(/bot|crawler|spider|headless|preview/i.test(req.headers['user-agent']||''))return sendJson(res,200,{ok:true,ignored:true});
      if(!await auth.allow('analytics:'+ip,180,60000))return sendJson(res,429,{error:'Event limit reached'});
      const accepted=await measure(body.event,{id:body.id,page:body.page,context:body.context,test:body.context?.test,origin:'client'});
      return sendJson(res,200,{ok:true,accepted});
    }
    if(req.method==='GET'&&u.pathname==='/api/analytics'){
      if(!process.env.STATS_SECRET||req.headers.authorization!=='Bearer '+process.env.STATS_SECRET)return sendJson(res,403,{error:'Forbidden'});
      return sendJson(res,200,await analytics.report(u.searchParams.get('days'),{includeTest:u.searchParams.get('include_test')==='1'}));
    }
    if(u.pathname==='/api/track')return sendJson(res,200,{ok:true,legacy:true});
    if(u.pathname.startsWith('/api/')||(u.pathname==='/pro'&&u.searchParams.has('session_id')))await hydrate();
    if((req.method==='GET'||req.method==='POST')&&u.pathname==='/api/monitor'){
      const secret=process.env.CRON_SECRET||process.env.MONITOR_SECRET;
      if(!secret||req.headers.authorization!=='Bearer '+secret)return sendJson(res,401,{error:'Unauthorized'});
      const options=req.method==='POST'?await readBody(req):{};
      const result=await monitorCycle({notify:options.notify!==false,force:options.force===true});return sendJson(res,result.errors.length?503:200,{ok:!result.errors.length,...result});
    }
    if(req.method==='GET'&&u.pathname==='/api/account')return sendJson(res,200,{email:accountEmail});
    if(req.method==='POST'&&u.pathname==='/api/domains'){
      const body=await readBody(req);return store.locked('domains:'+accountEmail,async()=>{await store.hydrate(true);const lead=leads[accountEmail];
      if(!lead?.pro)return sendJson(res,403,{error:'An active monitoring subscription is required'});
      const domain=cleanDomain(body.domain);if(!DOMAIN_RE.test(domain))return sendJson(res,400,{error:'Enter a valid domain'});
      const domains=lead.domains|| (lead.domain?[lead.domain]:[]);
      if(body.action==='remove')lead.domains=domains.filter(d=>d!==domain);
      else if(body.action==='add'){
        if(!domains.includes(domain)&&domains.length>=(lead.plan==='agency'?25:5))return sendJson(res,409,{error:'Your plan domain limit has been reached'});
        lead.domains=[...new Set([...domains,domain])];
      }else return sendJson(res,400,{error:'Choose add or remove'});
      lead.domain=lead.domains[0]||null;await persist('leads');return sendJson(res,200,{domains:lead.domains});});
    }
    if(req.method==='POST'&&u.pathname==='/api/recheck'){
      const body=await readBody(req);const lead=leads[accountEmail];const domain=cleanDomain(body.domain);
      if(!lead?.pro||!(lead.domains||(lead.domain?[lead.domain]:[])).includes(domain))return sendJson(res,403,{error:'Add this domain to your active monitoring plan first'});
      if(!await auth.allow('recheck:'+accountEmail,20,3600e3))return sendJson(res,429,{error:'Check limit reached. Try again later.'});
      const result=await monitorDomain(lead,domain,{notify:false});return sendJson(res,200,{ok:true,reportId:result.reportId});
    }
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = proto + '://' + host;
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('<head>', '<head>\n' + canonicalTag('/') + ogMetaTags(base, base + '/', ''));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(measuredHtml(html));
    }
    if (req.method === 'GET' && u.pathname === '/pro') {
      const sid = u.searchParams.get('session_id');
      if(sid&&/^cs_[A-Za-z0-9_]+$/.test(sid)&&STRIPE_KEY){
        try{
          const session=await stripe('GET','/checkout/sessions/'+sid);
          const lead=await fulfillCheckout(session,{welcome:true});
          const proof=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ip_checkout='))?.slice(12)||'';
          if(lead&&proof&&session.metadata?.checkout_proof===crypto.createHash('sha256').update(proof).digest('hex'))await auth.session(lead.email,res);
          res.writeHead(303,{Location:'/pro'});return res.end();
        }catch(e){console.error('[checkout] reconciliation failed',e.message);}
      }
      res.setHeader('X-Robots-Tag','noindex');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(measuredHtml(fs.readFileSync(path.join(PUBLIC, 'pro.html'), 'utf8').replace('<head>', '<head>\n' + canonicalTag('/pro'))));
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
        await persist('stats');
        return sendJson(res, 200, { ok: true });
      }
      if (u.pathname === '/api/stats') {
        const secret = process.env.STATS_SECRET;
        if (!secret || u.searchParams.get('secret') !== secret) return sendJson(res, 403, { error: 'Forbidden' });
        const totalAudits = Object.values(audits).reduce((n, a) => n + a.length, 0);
        const pro = Object.values(leads).filter(l => l.pro);
        const referred = Object.values(leads).filter(l => l.referredBy).map(l => ({ email: l.email, referredBy: l.referredBy, at: l.referredAt || null }));
        // Real (non-test) counts: test leads are tagged `test: true`; test audit emails are also
        // matched by pattern (some test audits predate the leads store or use throwaway addresses).
        const isTest = (email) => !!(leads[email] && leads[email].test) || email.endsWith('@inboxproof.test') || email === 'leadtest@example.com';
        const realLeads = Object.values(leads).filter(l => !l.test);
        const realPro = realLeads.filter(l => l.pro);
        const realAudits = Object.keys(audits).filter(email => !isTest(email)).reduce((n, email) => n + audits[email].length, 0);
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
          realLeads: realLeads.length,
          realAudits: realAudits,
          realPro: realPro.length,
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
      // Public API growth CTA: every free endpoint points back to the full audit.
      const API_CTA = { url: 'https://inboxproof.email?src=api', hint: 'Run the full audit with monitoring and white-label reports' };
      if (u.pathname === '/api/dmarc-check') {
        const domain = cleanDomain(u.searchParams.get('domain'));
        if (!DOMAIN_RE.test(domain)) return sendJson(res, 400, { error: 'Enter a valid domain, e.g. yourdomain.com' });
        if (rateLimited(ip)) return sendJson(res, 429, { error: 'Rate limit: 20 checks/hour from this IP.' });
        const checks = await Promise.all([checkMx(domain), checkSpf(domain), checkDkim(domain), checkDmarc(domain)]);
        const W = { mx: 20, spf: 15, dkim: 15, dmarc: 25 };
        const total = Object.values(W).reduce((a, b) => a + b, 0);
        const raw = checks.reduce((s, c) => s + W[c.id] * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
        const score = Math.round(raw / total * 100);
        return sendJson(res, 200, { domain, at: new Date().toISOString(), score, grade: gradeOf(score), checks, next: API_CTA });
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
        return sendJson(res, 200, { domain, at: new Date().toISOString(), risk, riskLabel, deliver, grade: gradeOf(deliver), verdict, checks, failing, next: API_CTA });
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
          clean: results.filter(r => !r.listed).map(r => r.label), results, next: API_CTA,
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
          results, allResolve, next: API_CTA,
        });
      }
      if (u.pathname === '/api/referrals') {
        const email = String(u.searchParams.get('email') || '').toLowerCase().trim();
        if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
        let all = leads;
        if (REMOTE) { try { const v = await upGet('leads'); if (v) all = JSON.parse(v); } catch {} }
        const lead = all[email];
        if (!lead) return sendJson(res, 404, { error: 'No account found for this email' });
        const code = lead.refCode || '';
        const referred = Object.values(all).filter(l => l.referredBy && l.referredBy.toUpperCase() === code);
        return sendJson(res, 200, {
          refCode: code,
          link: 'https://inboxproof.email/?ref=' + code,
          referred: referred.length,
          referredPro: referred.filter(l => l.pro).length,
          monthsEarned: lead.referralCredits || 0,
        });
      }
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method === 'POST' && u.pathname === '/api/brand') {
      const body = await readBody(req);
      const email = accountEmail;
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
      await captureAcquisition(lead,body.analytics,'/lead-magnet');
      return sendJson(res, 200, { ok: true, email: lead.email });
    }
    if (req.method === 'POST' && u.pathname === '/api/audit') {
      const body = await readBody(req);
      const domain = cleanDomain(body.domain);
      let email = String(body.email || '').toLowerCase().trim();
      if(email && leads[email] && await auth.identity(req)!==email) email='';
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
        await captureAcquisition(lead,body.analytics,body.analytics?.current?.landingPage||'/');
        if (lead && lead.brand && lead.brand.name) audit.brand = lead.brand;
        if (refIn && refIn !== lead.refCode && await findLeadByRefCode(refIn)) {
          lead.referredBy = refIn;
          lead.referredAt = Date.now();
          await persist('leads');
        }
      }
      await saveReport(reportId, audit);
      await measure('audit_completed',{id:'audit:'+reportId,page:body.analytics?.current?.landingPage||'/',context:body.analytics,test:body.analytics?.test});
      if (email) {
        await pushAudit(email, audit);
        leads[email].lastScore = audit.score;
        leads[email].reportIds = leads[email].reportIds || [];
        leads[email].reportIds.push(reportId);
        if (leads[email].reportIds.length > 50) leads[email].reportIds = leads[email].reportIds.slice(-50);
        await persist('leads');
        await maybeSendAuditFollowup(email, domain, audit, reportId);
      }
      return sendJson(res, 200, { audit, reportId, savedEmail:email||null, refCode: email ? leads[email].refCode : null });
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
      if(leads[email] && await auth.identity(req)!==email)return sendJson(res,401,{error:'Sign in to save reports to this account',login:'/login'});
      await upsertLead(email, rep.domain || null);
      await captureAcquisition(leads[email],body.analytics,'/r/:report');
      await pushAudit(email, rep);
      if (rep.score != null) leads[email].lastScore = rep.score;
      leads[email].reportIds = leads[email].reportIds || [];
      if (!leads[email].reportIds.includes(reportId)) leads[email].reportIds.push(reportId);
      if (leads[email].reportIds.length > 50) leads[email].reportIds = leads[email].reportIds.slice(-50);
      await persist('leads');
      await sendReportEmail(email, domain || rep.domain || '', rep, reportId);
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
    if (['GET','HEAD'].includes(req.method) && u.pathname === '/sitemap.xml') {
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = CANONICAL_BASE;
      const skip = new Set(['404.html', 'pro.html', 'report.html', 'login.html', 'referral.html']);
      const entries = [];
      const today = ''; // Omit lastmod until meaningful content modification dates are tracked.
      try {
        const top = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html') && !skip.has(f));
        const rest = [];
        for (const f of top) { if (f === 'index.html') entries.push({ path: '/', lastmod: today }); else rest.push({ path: '/' + f.replace(/\.html$/, ''), lastmod: today }); }
        entries.push(...rest);
        const blogDir = path.join(PUBLIC, 'blog');
        if (fs.existsSync(blogDir)) { for (const f of fs.readdirSync(blogDir).filter(f => f.endsWith('.html'))) entries.push({ path: '/blog/' + f.replace(/\.html$/, ''), lastmod: today }); }
      } catch { /* keep anchors only */ }
      const urls = entries.map(e => '  <url><loc>' + base + e.path + '</loc></url>').join('\n');
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control':'public, max-age=300, s-maxage=3600' });
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
      return res.end(measuredHtml(html));
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
      if(!await auth.allow('checkout:'+ip,10,3600e3))return sendJson(res,429,{error:'Too many checkout requests. Try again later.'});
      const subscriptions=await stripe('GET','/subscriptions?customer='+customer.id+'&status=all&limit=100');
      if(subscriptions.data.some(x=>['active','trialing','past_due','unpaid'].includes(x.status)&&x.items.data.some(i=>Object.values(PRICE).includes(i.price.id))))return sendJson(res,409,{error:'You already have a subscription. Sign in to your dashboard to manage it.',login:'/login'});
      const domain=cleanDomain(body.domain||'');if(domain&&!DOMAIN_RE.test(domain))return sendJson(res,400,{error:'Enter a valid domain'});
      const checkoutLead=await upsertLead(email,domain||null);
      await captureAcquisition(checkoutLead,body.analytics,body.analytics?.current?.landingPage||'/');
      const proof=crypto.randomBytes(32).toString('hex');
      res.setHeader('Set-Cookie','ip_checkout='+proof+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600'+(APP_URL.startsWith('https:')?'; Secure':''));
      const base=APP_URL;
      const s = await stripe('POST', '/checkout/sessions', {
        mode: 'subscription',
        allow_promotion_codes: 'true',
        'line_items[0][price]': PRICE[plan],
        'line_items[0][quantity]': '1',
        customer: customer.id,
        client_reference_id: email,
        'metadata[plan]': plan,
        'metadata[domain]': domain,
        'metadata[product]': 'inboxproof',
        'metadata[checkout_proof]': crypto.createHash('sha256').update(proof).digest('hex'),
        ...stripeAttribution(checkoutLead.acquisition),
        'subscription_data[metadata][product]': 'inboxproof',
        'subscription_data[metadata][email]': email,
        success_url: base + '/pro?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: base + '/?cancelled=1',
      });
      await upsertLead(email, body.domain || null);
      await recordEvent('checkout_start', '/checkout');
      await measure('checkout_created',{id:'checkout:'+s.id,page:body.analytics?.current?.landingPage||'/',context:body.analytics,test:checkoutLead.test||body.analytics?.test});
      return sendJson(res, 200, { url: s.url, sessionId: s.id });
    }
    if (req.method === 'POST' && u.pathname === '/api/portal') {
      const body = await readBody(req);
      if (!STRIPE_KEY) return sendJson(res, 503, { error: 'Payments not configured' });
      const email = accountEmail;
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
      const lead = leads[email];
      if (!lead || !lead.stripeCustomerId) return sendJson(res, 404, { error: 'No subscription found for this email' });
      const host = req.headers.host || 'localhost:4321';
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const base = APP_URL;
      try {
        const s = await stripe('POST', '/billing_portal/sessions', { customer: lead.stripeCustomerId, return_url: base + '/pro' });
        return sendJson(res, 200, { url: s.url });
      } catch (e) { return sendJson(res, 502, { error: 'Could not open billing portal' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/webhook') {
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>256000)return sendJson(res,413,{error:'Request too large'});}
      if(!STRIPE_WEBHOOK_SECRET)return sendJson(res,503,{error:'Webhooks unavailable'});
      const parts=String(req.headers['stripe-signature']||'').split(',');
      const timestamp=parts.find(x=>x.startsWith('t='))?.slice(2);
      const expected=crypto.createHmac('sha256',STRIPE_WEBHOOK_SECRET).update(timestamp+'.'+raw).digest('hex');
      const valid=timestamp&&Math.abs(Date.now()/1000-Number(timestamp))<=300&&parts.filter(x=>x.startsWith('v1=')).some(x=>{const sig=x.slice(3);return /^[a-f0-9]{64}$/.test(sig)&&crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(expected,'hex'));});
      if(!valid)return sendJson(res,400,{error:'Invalid webhook signature'});
      const event=JSON.parse(raw);if(!/^evt_[A-Za-z0-9]+$/.test(event.id||''))return sendJson(res,400,{error:'Invalid event'});
      if(await upGet('event:'+event.id))return sendJson(res,200,{received:true,duplicate:true});
      const obj=event.data?.object||{};
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))await fulfillCheckout(obj,{welcome:true,paidAt:event.created?new Date(event.created*1000).toISOString():undefined});
      else if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type))await syncSubscription(obj.id);
      else if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
        const sub=obj.subscription||obj.parent?.subscription_details?.subscription;if(sub)await syncSubscription(typeof sub==='string'?sub:sub.id);
      }
      await upSet('event:'+event.id,JSON.stringify({at:Date.now(),type:event.type}));
      return sendJson(res,200,{received:true});
    }
    if (req.method === 'POST' && u.pathname === '/api/delete') {
      const body = await readBody(req);
      const email = accountEmail;
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Valid email required' });
      const lead = leads[email];
      if(lead?.pro&&lead.stripeSubscriptionId)return sendJson(res,409,{error:'Cancel your subscription in Manage billing before deleting your account.'});
      const ids = lead?.reportIds || [];
      for (const id of ids) await deleteReport(id);
      delete leads[email];
      delete audits[email];
      await persist('leads');
      await persist('audits');
      if (!REMOTE) saveJson(REPORTS_F, reports);
      return sendJson(res, 200, { ok: true, existed: !!lead, reportsDeleted: ids.length });
    }
    if (req.method === 'GET' && u.pathname === '/pricing') {
      res.writeHead(301, { Location: '/#pricing' });
      return res.end();
    }
    // static
    if (['GET','HEAD'].includes(req.method)) {
      let rel = u.pathname === '/' ? 'index.html' : u.pathname;
      if (!path.extname(rel)) rel += '.html';
      const p = path.normalize(path.join(PUBLIC, rel));
      if (p.startsWith(PUBLIC) && fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.extname(p);
        if (ext === '.html') {
          if(['/login','/login.html','/pro','/pro.html','/referral'].includes(u.pathname))res.setHeader('X-Robots-Tag','noindex');
          const source = fs.readFileSync(p, 'utf8');
          const html = ['pro.html','login.html','report.html','referral.html','404.html'].includes(path.basename(p)) ? source : publicMetadata(source,u.pathname);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          return res.end(measuredHtml(html));
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        return res.end(fs.readFileSync(p));
      }
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[request]',u.pathname,e.message);
    return sendJson(res, e.message === 'Rate limit: 20 audits/hour from this IP. Start a Pro trial for continuous monitoring.' ? 429 : 503, { error: 'The service is temporarily unavailable. Please try again shortly.' });
  }
}

/* ---------------- monitoring: every eligible domain, oldest first ---------------- */
async function monitorDomain(lead,domain,{notify=true,auditFn=auditDomain}={}){
  const previous=lead.domainScores?.[domain];
  const audit=await auditFn(domain);audit.reportId=crypto.randomUUID();
  if(lead.brand) audit.brand=lead.brand;
  await saveReport(audit.reportId,audit);await pushAudit(lead.email,audit);
  const failures=audit.checks.filter(c=>c.status==='fail').map(c=>c.id);
  lead.domainScores=lead.domainScores||{};lead.domainScores[domain]={score:audit.score,at:audit.at,reportId:audit.reportId,failures};
  lead.lastScore=audit.score;lead.lastMonitorAt=audit.at;
  lead.reportIds=[...new Set([...(lead.reportIds||[]),audit.reportId])].slice(-50);
  await persist('leads');
  const regressed=previous&&(audit.score<previous.score||failures.some(id=>!previous.failures?.includes(id)));
  if(notify&&regressed){
    lead.pendingAlerts=lead.pendingAlerts||{};
    lead.pendingAlerts[audit.reportId]={domain,score:audit.score,reportId:audit.reportId,createdAt:audit.at};
    await persist('leads');await deliverPendingAlerts(lead);
  }
  return audit;
}
async function deliverPendingAlerts(lead){
  for(const [id,alert] of Object.entries(lead.pendingAlerts||{})){
    const sent=await sendAlertEmail(lead.email,alert.domain+' configuration changed','<p>Your scheduled check for <b>'+alert.domain+'</b> found a change. The configuration score is '+alert.score+'/100.</p><p><a href="'+APP_URL+'/r/'+id+'">View the findings and suggested next steps</a></p><p><a href="'+APP_URL+'/pro">Open your dashboard</a></p>','monitor:'+id);
    if(!sent)throw new Error('Monitoring email delivery failed; queued for retry');
    delete lead.pendingAlerts[id];lead.lastAlertAcceptedAt=new Date().toISOString();await persist('leads');
  }
}
async function monitorCycle({notify=true,force=false,auditFn=auditDomain}={}){
  await hydrate();
  return store.locked('monitor-cycle',async()=>{
    const started=Date.now(), tasks=[], errors=[];
    for(const lead of Object.values(leads)){
      if(!lead.pro||lead.test||/\.test$/.test(lead.email))continue;
      if(lead.stripeSubscriptionId){try{await syncSubscription(lead.stripeSubscriptionId);}catch(e){errors.push({domain:lead.domain,error:'Subscription status could not be verified'});continue;}}
      if(notify){try{await deliverPendingAlerts(lead);}catch(e){errors.push({domain:lead.domain,error:e.message});}}
      if(!lead.pro)continue;
      const domains=lead.domains||(lead.domain?[lead.domain]:[]);
      for(const domain of domains){const at=Date.parse(lead.domainScores?.[domain]?.at||0)||0;if(force||Date.now()-at>=20*3600e3)tasks.push({lead,domain,at});}
    }
    tasks.sort((a,b)=>a.at-b.at);let checked=0;
    for(const task of tasks){
      if(Date.now()-started>240000)break;
      try{await monitorDomain(task.lead,task.domain,{notify,auditFn});checked++;}catch(e){errors.push({domain:task.domain,error:e.message});}
    }
    const result={at:new Date().toISOString(),checked,pending:tasks.length-checked,errors};
    await upSet('monitor:status',JSON.stringify(result));await upSet('monitor:lastRun',String(Date.now()));
    try{await analytics.prune();}catch(e){console.error('[analytics] retention',e.message);}
    return result;
  });
}
async function syncSubscription(id){
  const sub=await stripe('GET','/subscriptions/'+id);
  const item=sub.items?.data?.find(x=>Object.values(PRICE).includes(x.price.id));if(!item)return null;
  const customer=await stripe('GET','/customers/'+(sub.customer.id||sub.customer));
  const existing=Object.values(leads).find(l=>l.stripeSubscriptionId===sub.id);
  const email=String(existing?.email||customer.email||'').toLowerCase().trim();if(!EMAIL_RE.test(email))return null;
  const plan=Object.keys(PRICE).find(p=>PRICE[p]===item.price.id);
  const active=['active','trialing'].includes(sub.status);
  const lead=active?await activatePro(email,plan,{stripeCustomerId:customer.id,stripeSubscriptionId:sub.id}):leads[email];
  if(!lead)return null;
  lead.pro=active;lead.subscriptionStatus=sub.status;lead.cancelAtPeriodEnd=sub.cancel_at_period_end;
  lead.currentPeriodEnd=sub.current_period_end||item.current_period_end;
  await persist('leads');return lead;
}
async function fulfillCheckout(session,{welcome=true,paidAt}={}){
  if(session.mode!=='subscription'||session.status!=='complete'||!['paid','no_payment_required'].includes(session.payment_status)||!session.subscription)return null;
  const lead=await syncSubscription(typeof session.subscription==='string'?session.subscription:session.subscription.id);
  if(!lead?.pro)return null;
  const domain=cleanDomain(session.metadata?.domain||'');
  if(DOMAIN_RE.test(domain)){
    const domains=lead.domains||(lead.domain?[lead.domain]:[]);
    if(domains.length<(lead.plan==='agency'?25:5)||domains.includes(domain))lead.domains=[...new Set([...domains,domain])];
    lead.domain=lead.domains?.[0]||lead.domain;
  }
  lead.stripeLastPaidAt=new Date().toISOString();await persist('leads');
  const acquisition=lead.acquisition;
  const paidContext=acquisition?.firstTouch?{consent:acquisition.retainedWithConsent,current:acquisition.lastTouch||acquisition.firstTouch,firstTouch:acquisition.firstTouch,lastTouch:acquisition.lastTouch||acquisition.firstTouch}:null;
  const historical=session.created&&session.created*1000<Date.parse(ANALYTICS_STARTED_AT);
  await measure('subscription_paid',{id:'subscription:'+lead.stripeSubscriptionId,page:'/checkout',context:paidContext,attributionTouch:acquisition?.firstTouch,test:lead.test,at:paidAt||(historical?new Date(session.created*1000).toISOString():undefined)});
  if(welcome&&!lead.welcomeEmailSentAt){
    const sent=await sendAlertEmail(lead.email,'Your Inboxproof monitoring is ready','<p>Thanks for subscribing to Inboxproof. Your '+(lead.plan==='agency'?'Agency':'Pro')+' plan is active.</p><p><a href="'+APP_URL+'/login">Open your dashboard</a> and enter the email you used at checkout. We will email you a one-time sign-in link. No password is needed.</p><p>Add your domains, review saved reports, and manage billing in your dashboard. Scheduled checks run daily, with email updates when a check finds a regression.</p>', 'welcome:'+session.id);
    if(!sent)throw new Error('Welcome email delivery failed');
    lead.welcomeEmailSentAt=new Date().toISOString();await persist('leads');
  }
  return lead;
}
function handler(req,res){return store.run(()=>requestHandler(req,res));}
export default handler;
export { auditDomain, leadFollowupCycle, monitorCycle, monitorDomain, fulfillCheckout, syncSubscription, store, auth };

const IS_VERCEL = !!process.env.VERCEL;
if (!IS_VERCEL && !process.env.NO_LISTEN) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log('Inboxproof listening on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + (REMOTE ? ' (remote store)' : ' (local files)'));
    if(process.env.ENABLE_LOCAL_MONITOR==='1')setTimeout(()=>store.run(()=>monitorCycle()),45e3);
  });
  if(process.env.ENABLE_LOCAL_MONITOR==='1')setInterval(()=>store.run(()=>monitorCycle()),6*3600e3);
}
