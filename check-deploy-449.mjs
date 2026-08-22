// Poll Vercel until a production deployment for our commit SHA reaches READY.
// Usage: node check-deploy-449.mjs <commit-sha-prefix> [max-minutes]
const sha = process.argv[2];
const maxMin = Number(process.argv[3] || 10);
const KEY = process.env.VERCEL_API_KEY;
const TEAM = process.env.VERCEL_TEAM_ID;
const PROJ = process.env.VERCEL_PROJECT_ID;
const H = { Authorization: 'Bearer ' + KEY };
const url = 'https://api.vercel.com/v10/projects/' + PROJ + '?teamId=' + TEAM;

const deadline = Date.now() + maxMin * 60e3;
let last = null;
while (Date.now() < deadline) {
  let deps = [];
  try {
    const r = await fetch(url, { headers: H });
    if (r.ok) { const j = await r.json(); deps = j.latestDeployments || []; }
  } catch (e) { console.log('poll err', e.message); }
  const target = deps.find(d => d.meta && d.meta.githubCommitSha && d.meta.githubCommitSha.startsWith(sha));
  if (target) {
    last = target;
    console.log('TARGET', target.meta.githubCommitSha.slice(0,12), target.readyState, target.url, new Date().toISOString());
    if (target.readyState === 'READY') { console.log('READY'); process.exit(0); }
  } else if (deps[0]) {
    last = deps[0];
    console.log('latest:', (deps[0].meta && deps[0].meta.githubCommitSha || '?').slice(0,12), deps[0].readyState, new Date().toISOString());
  }
  await new Promise(r => setTimeout(r, 25e3));
}
console.log('TIMEOUT last:', last ? ((last.meta && last.meta.githubCommitSha || '?').slice(0,12)) + ' ' + last.readyState : 'none');
process.exit(2);
