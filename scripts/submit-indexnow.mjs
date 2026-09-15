// Notify search engines about changed public pages after a verified production deploy.
// Default: preview only. Pass --submit to notify. No customer data is read.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=new URL('../',import.meta.url).pathname,base='https://inboxproof.email';
const stateFile=process.env.INDEXNOW_STATE_FILE||path.join(root,'.cache/indexnow.json');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Read failed: '+new URL(url).pathname+' ('+r.status+')');return r.text();};
const key=(await get(base+'/indexnow-key.txt')).trim();if(!/^[A-Za-z0-9-]{8,128}$/.test(key))throw Error('Invalid ownership file');
const sitemap=await get(base+'/sitemap.xml');const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
if(!urls.length||urls.length>10000)throw Error('Unexpected sitemap size');
let previous={};try{previous=JSON.parse(fs.readFileSync(stateFile,'utf8')).hashes||{};}catch(e){if(e.code!=='ENOENT')throw e;}
const shared=['seo.mjs','public/styles.css','public/analytics.js','public/monitor-page.css'].map(p=>fs.readFileSync(path.join(root,p))).map(sha).join(':');
const hashes={},changed=[];
for(const url of urls){const u=new URL(url);if(u.origin!==base||u.search||u.hash||/^\/(?:api|r|pro|login|referral)(?:\/|$)/.test(u.pathname))throw Error('Unexpected non-public URL in sitemap');const file=path.join(root,'public',u.pathname==='/'?'index.html':u.pathname+'.html');if(!fs.existsSync(file))throw Error('Local source and production sitemap differ');hashes[url]=sha(fs.readFileSync(file,'utf8')+shared);if(previous[url]!==hashes[url])changed.push(url);}
const report={at:new Date().toISOString(),publicPages:urls.length,changedPages:changed.length,submitted:false};
if(process.argv.includes('--submit')&&changed.length){
 // Confirm the latest local HTML is actually live, using the visible body verbatim.
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,changed.length)},async()=>{while(next<changed.length){const url=changed[next++],p=new URL(url).pathname,file=path.join(root,'public',p==='/'?'index.html':p+'.html'),source=fs.readFileSync(file,'utf8'),live=await get(url);if(live.split('<body')[1]!==source.split('<body')[1])throw Error('Production body differs from local source: '+p);if((live.match(/rel="canonical"/g)||[]).length!==1||!live.includes('rel="canonical" href="'+url+'"'))throw Error('Canonical validation failed: '+p);if(!live.includes('name="twitter:card" content="summary_large_image"')||!live.includes('property="og:image"'))throw Error('Social metadata incomplete: '+p);}}));
 report.verifiedPublicPages=changed.length;
 const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({host:'inboxproof.email',key,keyLocation:base+'/indexnow-key.txt',urlList:changed}),signal:AbortSignal.timeout(30000)});
 report.status=response.status;report.submitted=response.status===200||response.status===202;
 report.result=response.status===200?'URLs received; indexing is not guaranteed':response.status===202?'URLs received; ownership validation pending':'Submission failed';
 if(!report.submitted){console.log(JSON.stringify(report));process.exitCode=1;}else{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify({at:report.at,hashes,lastSubmission:report},null,2));}
}
console.log(JSON.stringify(report,null,2));
