// Point the live checkout at the launch prices so the charge matches the advertised button.
const TOKEN = 'iTXRQCs5keUu7Jhzjo6UApkM';
const TEAM = 'team_FbNOzdDiiWfFv5lgrSFyzJdr';
const PRJ = 'prj_BADdZkyBMP1i1xYmu2cLqP1coD14';
const BASE = 'https://api.vercel.com/v2/projects/' + PRJ + '/env?teamId=' + TEAM;

async function setEnv(key, value) {
  const r = await fetch(BASE + '/' + key, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, target: ['production', 'preview'] }),
  });
  const t = await r.text();
  console.log(key, '->', r.status, r.status === 200 ? 'OK' : t.slice(0, 200));
}

await setEnv('STRIPE_PRICE_PRO', 'price_1U6dWBFzAAOxCQiQs2LmWAT9');    // $14.50 launch
await setEnv('STRIPE_PRICE_AGENCY', 'price_1U6dWBFzAAOxCQiQ1rKWK7nU'); // $49.50 launch
console.log('done');
