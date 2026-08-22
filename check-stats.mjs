import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
};
const secret = get('STATS_SECRET');
const r = await fetch(`https://inboxproof.email/api/stats?secret=${encodeURIComponent(secret)}`);
const j = await r.json();
console.log(JSON.stringify(j, null, 1).slice(0, 3000));
