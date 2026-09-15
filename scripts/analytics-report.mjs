const secret=process.env.STATS_SECRET;
if(!secret)throw Error('Set STATS_SECRET in the environment to read private analytics.');
const base=process.env.APP_URL||'https://inboxproof.email';
const days=Math.max(1,Math.min(90,Number(process.argv[2])||30));
const response=await fetch(base+'/api/analytics?days='+days,{headers:{Authorization:'Bearer '+secret}});
if(!response.ok)throw Error('Analytics request failed ('+response.status+')');
console.log(JSON.stringify(await response.json(),null,2));
