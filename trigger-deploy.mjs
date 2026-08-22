// Try to trigger a manual production deployment via the Vercel API.
const KEY = process.env.VERCEL_API_KEY;
const TEAM = process.env.VERCEL_TEAM_ID;
const PROJ = process.env.VERCEL_PROJECT_ID;
const H = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// Attempt 1: project-scoped create deployment
try {
  const r = await fetch('https://api.vercel.com/v10/projects/' + PROJ + '/deployments?teamId=' + TEAM, {
    method: 'POST', headers: H,
    body: JSON.stringify({ target: 'production', git: { type: 'github', repo: 'jtc268/inboxproof', ref: 'main' } }),
  });
  const t = await r.text();
  console.log('ATTEMPT1 project-scoped:', r.status, t.slice(0, 400));
} catch (e) { console.log('ATTEMPT1 err', e.message); }

// Attempt 2: team-scoped create deployment
try {
  const r = await fetch('https://api.vercel.com/v10/deployments?teamId=' + TEAM, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: 'inboxproof', target: 'production', repo: 'jtc268/inboxproof', ref: 'main' }),
  });
  const t = await r.text();
  console.log('ATTEMPT2 team-scoped:', r.status, t.slice(0, 400));
} catch (e) { console.log('ATTEMPT2 err', e.message); }
