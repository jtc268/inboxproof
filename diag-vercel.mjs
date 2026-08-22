// Diagnostic: show project git source + all latestDeployments with state/commit.
const KEY = process.env.VERCEL_API_KEY;
const TEAM = process.env.VERCEL_TEAM_ID;
const PROJ = process.env.VERCEL_PROJECT_ID;
const H = { Authorization: 'Bearer ' + KEY };
const r = await fetch('https://api.vercel.com/v10/projects/' + PROJ + '?teamId=' + TEAM, { headers: H });
if (!r.ok) { console.log('HTTP', r.status, await r.text()); process.exit(1); }
const j = await r.json();
console.log('project:', j.name, '| defaultBranch:', j.defaultBranch);
console.log('git source:', JSON.stringify(j.git || null));
console.log('--- latestDeployments (' + (j.latestDeployments || []).length + ') ---');
for (const d of (j.latestDeployments || []).slice(0, 8)) {
  const sha = d.meta && d.meta.githubCommitSha ? d.meta.githubCommitSha.slice(0, 10) : '?';
  const msg = d.meta && d.meta.githubCommitMessage ? d.meta.githubCommitMessage.slice(0, 40) : '';
  console.log(sha, '|', d.readyState, '|', d.target, '|', new Date(d.createdAt).toISOString(), '|', msg);
}
