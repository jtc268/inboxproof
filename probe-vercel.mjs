const KEY = process.env.VERCEL_API_KEY;
const TEAM = process.env.VERCEL_TEAM_ID;
const PROJ = process.env.VERCEL_PROJECT_ID;
const H = { Authorization: 'Bearer ' + KEY };
const r = await fetch('https://api.vercel.com/v10/projects/' + PROJ + '?teamId=' + TEAM, { headers: H });
const j = await r.json();
const deps = j.latestDeployments || [];
console.log('now:', new Date().toISOString());
for (const d of deps) {
  console.log('---');
  console.log('url:', d.url);
  console.log('readyState:', d.readyState, '| target:', d.target);
  console.log('createdAt:', d.createdAt ? new Date(d.createdAt).toISOString() : '?');
  console.log('meta:', JSON.stringify(d.meta));
}
