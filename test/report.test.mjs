import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../public/report.html',import.meta.url),'utf8');
const at='2026-09-22T13:00:00Z';
const checks=[{id:'mx',name:'MX',status:'pass',detail:'MX found'},{id:'spf',name:'SPF',status:'pass',detail:'SPF found'},{id:'dkim',name:'DKIM',status:'warn',detail:'No key found among 49 common selectors. Message signing is unverified.'},{id:'dmarc',name:'DMARC',status:'warn',detail:'DMARC p=none monitors without requesting quarantine or rejection.'},{id:'tls',name:'TLS',status:'warn',detail:'Could not verify TLS: SMTP connection timed out; TLS is unverified'},{id:'ptr',name:'PTR',status:'pass',detail:'PTR found'},{id:'rbl',name:'Blocklists',status:'pass',detail:'No listing observed'}];
const fixture={domain:'example.com',score:75,at,checks};
const tick=()=>new Promise(r=>setTimeout(r,15));
async function render({paid=true,domains=['example.com'],history=[],report=fixture,recheck,accountDelay=0}={}){
 const calls=[];const dom=new JSDOM(html,{url:'https://inboxproof.email/r/report-test',runScripts:'dangerously',beforeParse(w){w.navigator.sendBeacon=()=>true;w.fetch=async(url,opts)=>{calls.push({url,body:opts?.body&&JSON.parse(opts.body)});if(url==='/api/history'){if(accountDelay)await new Promise(r=>setTimeout(r,accountDelay));return{ok:paid,status:paid?200:401,json:async()=>({lead:{pro:true,domains},history})};}if(url==='/api/recheck')return recheck||{ok:false,json:async()=>({error:'Check limit reached. Try again later.'})};return{ok:true,json:async()=>report};};}});await tick();return{dom,d:dom.window.document,calls};
}
for(const paid of [true,false])test((paid?'paid':'anonymous')+' report preserves account boundaries and shows next steps',async()=>{
 const {dom,d}=await render({paid});assert.equal(d.querySelector('#h1').textContent,'example.com');assert.equal(d.querySelector('#accountReport').hidden,!paid);assert.equal(d.documentElement.classList.contains('account-loading'),false);for(const id of ['wlProBottom','saveRow'])assert.equal(dom.window.getComputedStyle(d.getElementById(id)).display==='none',paid,id);assert.equal(d.querySelector('#reportRecheck').hidden,!paid);assert.equal(d.querySelector('#freshAudit').hidden,paid);assert.equal(d.querySelector('#nextSteps').children.length,3);assert.match(d.querySelector('#planSummary').textContent,/2 checks were inconclusive/);assert.doesNotMatch(d.body.textContent,/inbox-ready|instant a record|moment deliverability/i);dom.window.close();
});
test('DKIM and timed-out TLS remain unverified, while p=none is a policy review',async()=>{
 const {dom,d}=await render();assert.equal(d.querySelectorAll('.next-step.unverified').length,2);assert.equal(d.querySelectorAll('.next-step.review').length,1);assert.match(d.querySelector('.next-step.review').textContent,/p=none is a valid monitoring policy/);assert.match(d.querySelector('#nextSteps').textContent,/timeout does not prove encryption is disabled/);assert.match(d.querySelector('#nextSteps').textContent,/common-selector scan can miss/);assert.equal(d.querySelectorAll('.observation').length,7);dom.window.close();
});
test('unchanged score compares only earlier checks of the same domain',async()=>{
 const {dom,d}=await render({history:[{domain:'other.com',score:10,at:'2026-09-22T12:00:00Z'},{domain:'example.com',score:75,at:'2026-09-21T12:00:00Z'},{domain:'example.com',score:90,at:'2026-09-23T12:00:00Z'}]});assert.match(d.querySelector('#scoreComparison').textContent,/Score unchanged since Sep 21/);assert.doesNotMatch(d.querySelector('#scoreComparison').textContent,/settings unchanged|configuration unchanged/);assert.match(d.querySelector('#monitoringContext').textContent,/different findings/);dom.window.close();
});
test('changed and first-report scores avoid invented configuration comparisons',async()=>{
 for(const history of [[],[{domain:'example.com',score:60,at:'2026-09-21T12:00:00Z'}]]){const {dom,d}=await render({history});assert.match(d.querySelector('#scoreComparison').textContent,history.length?/increased by 15 points/:/No earlier score/);dom.window.close();}
});
test('an active plan does not imply the viewed domain is monitored',async()=>{
 const {dom,d}=await render({domains:['elsewhere.example']});assert.equal(d.querySelector('#reportRecheck').hidden,true);assert.equal(d.querySelector('#freshAudit').hidden,false);assert.match(d.querySelector('#monitoringTitle').textContent,/not monitored/);assert.equal(d.querySelector('#scoreComparison').hidden,true);assert.match(d.querySelector('#freshAudit').href,/\?domain=example.com#audit$/);dom.window.close();
});
test('an all-pass report explains the snapshot without promising delivery',async()=>{
 const {dom,d}=await render({report:{...fixture,score:100,checks:checks.map(c=>({...c,status:'pass'}))}});assert.equal(d.querySelector('#planTitle').textContent,'No issues flagged in these checks');assert.equal(d.querySelector('#nextSteps').children.length,0);assert.match(d.querySelector('#planSummary').textContent,/at the time of this report/);assert.match(d.querySelector('.score-limit').textContent,/does not measure inbox placement/);assert.doesNotMatch(dom.window.document.title,/deliverability/);dom.window.close();
});
test('flagged findings appear first and safe next steps do not invent DNS values',async()=>{
 const {dom,d}=await render({report:{...fixture,checks:[...checks,{id:'mx',name:'MX',status:'fail',detail:'No MX records found.',fix:'10 mail.example.com'}]}});assert.match(d.querySelector('.next-step').className,/flagged/);assert.match(d.querySelector('.next-step').textContent,/If this domain should receive mail/);assert.doesNotMatch(d.querySelector('#nextSteps').textContent,/10 mail.example.com/);dom.window.close();
});
test('recheck uses the viewed domain, restores failure state, and never asks to email',async()=>{
 const {dom,d,calls}=await render();d.querySelector('#reportRecheck').click();await tick();assert.deepEqual(calls.find(c=>c.url==='/api/recheck').body,{domain:'example.com'});assert.match(d.querySelector('#reportRecheckError').textContent,/Check limit reached/);assert.equal(d.querySelector('#reportRecheck').disabled,false);assert.equal(calls.some(c=>c.url==='/api/attach'||c.url==='/api/checkout'),false);dom.window.close();
});
test('late account loading still enables the monitored report controls',async()=>{
 const {dom,d}=await render({accountDelay:25});await new Promise(r=>setTimeout(r,30));assert.equal(d.querySelector('#reportRecheck').hidden,false);assert.equal(d.querySelector('#accountReport').hidden,false);dom.window.close();
});
test('report text is escaped and white-label reports keep promotions hidden',async()=>{
 const {dom,d}=await render({paid:false,report:{...fixture,domain:'<img src=x onerror=alert(1)>',brand:{name:'Client team'},checks:[{id:'unexpected',name:'<script>bad</script>',status:'warn',detail:'<img>',fix:'<b>text</b>'}]}});assert.equal(d.querySelector('#h1 img'),null);assert.equal(d.querySelector('#nextSteps script'),null);assert.equal(d.querySelector('#checks img'),null);for(const id of ['wlProBottom','saveRow'])assert.equal(d.getElementById(id).style.display,'none');dom.window.close();
});
test('missing DMARC and incomplete checks have safe next steps; legacy wording is scoped',async()=>{
 const {dom,d}=await render({report:{...fixture,checks:[{id:'dmarc',name:'DMARC',status:'fail',detail:'No DMARC record at _dmarc.example.com.'},{id:'spf',name:'SPF',status:'warn',detail:'This check could not be completed. Try again later.'},{id:'mx',name:'MX',status:'fail',detail:'No MX records found for example.com. Mail for this domain cannot be routed at all.'}]}});assert.match(d.querySelector('#nextSteps').textContent,/valid monitoring policy and a working report destination/);assert.match(d.querySelector('.next-step.unverified').textContent,/Retry it before changing settings/);assert.doesNotMatch(d.querySelector('#checks').textContent,/cannot be routed at all/);assert.match(d.querySelector('#checks').textContent,/does not establish how the domain sends mail/);const ld=JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent);assert.match(ld.description,/3 email configuration checks/);assert.doesNotMatch(ld.description,/deliverability/);dom.window.close();
});
