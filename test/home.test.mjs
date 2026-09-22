import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(r=>setTimeout(r,0));
function page(name,fetch){
 const dom=new JSDOM(fs.readFileSync(new URL('../public/'+name+'.html',import.meta.url),'utf8'),{url:'https://inboxproof.email/'+(name==='index'?'':name),runScripts:'outside-only'});
 dom.window.fetch=fetch;dom.window.trackEvent=()=>{};dom.window.matchMedia=()=>({matches:true});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const scripts=[...dom.window.document.querySelectorAll('script:not([src]):not([type])')];dom.window.eval(scripts.at(-1).textContent);return dom;
}
const submit=async(dom,id)=>{dom.window.document.getElementById(id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
test('homepage anonymous audit normalizes domain and renders results before explanatory sections',async()=>{
 let request;
 const dom=page('index',async(url,options)=>{request={url,body:JSON.parse(options.body)};return Response.json({audit:{domain:'example.com',at:'2026-09-22T12:00:00Z',score:75,checks:[{name:'DMARC',status:'warn',detail:'Review <policy>',fix:'Review reports'}]},reportId:'fixture'});});
 const d=dom.window.document;d.querySelector('#inDomain').value='https://Example.com/path';await submit(dom,'auditForm');
 assert.equal(request.url,'/api/audit');assert.equal(request.body.domain,'example.com');assert.equal(request.body.email,'');assert.equal(d.querySelector('#scoreN').textContent,'75');assert.match(d.querySelector('#checks').textContent,/Review <policy>/);assert.equal(d.querySelector('#checks policy'),null);assert.ok(d.querySelector('#results').classList.contains('show'));assert.equal(d.querySelector('#unlockSaved').hidden,true);assert.ok(d.querySelector('#results').compareDocumentPosition(d.querySelector('#how'))&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);assert.equal(d.querySelector('#auditBtn').disabled,false);dom.window.close();
});
test('homepage audit failure displays server error and restores submit button',async()=>{
 const dom=page('index',async()=>Response.json({error:'DNS check unavailable'},{status:503}));const d=dom.window.document;d.querySelector('#inDomain').value='example.com';await submit(dom,'auditForm');assert.equal(d.querySelector('#auditErr').textContent,'DNS check unavailable');assert.equal(d.querySelector('#auditBtn').disabled,false);assert.equal(d.querySelector('#results').classList.contains('show'),false);dom.window.close();
});
test('pricing asks for a valid account email and cancellation makes no checkout request',async()=>{
 let calls=0;const dom=page('index',async()=>{calls++;return Response.json({})});const d=dom.window.document;
 d.querySelector('[data-buy="pro"]').click();await tick();assert.equal(d.querySelector('#emailModal').style.display,'flex');d.querySelector('#modalOk').click();assert.match(d.querySelector('#modalErr').textContent,/valid email/);assert.equal(calls,0);d.querySelector('#modalCancel').click();await tick();assert.equal(d.querySelector('#emailModal').style.display,'none');assert.equal(calls,0);dom.window.close();
});
for(const [detail,expected] of [['SPF found: v=spf1 include:spf.example.net ~all. Static expansion visits 2 DNS-triggering mechanism(s). Actual evaluation depends on the sending IP.','v=spf1 include:spf.example.net ~all'],['Multiple SPF records at example.com.','Multiple SPF records at example.com.']]){
 test('SPF tool displays the observed record or issue accurately: '+expected,async()=>{
  const dom=page('spf-checker',async()=>Response.json({domain:'example.com',at:'2026-09-22T12:00:00Z',checks:[{id:'spf',status:detail.startsWith('SPF found')?'pass':'fail',detail}]}));const d=dom.window.document;d.querySelector('#domain').value='example.com';await submit(dom,'check-form');assert.equal(d.querySelector('#spf-record').textContent,expected);assert.match(d.querySelector('#checked-at').textContent,/Checked/);assert.equal(d.querySelector('#result').style.display,'block');dom.window.close();
 });
}
test('DMARC checker describes scores without inbox placement claims',async()=>{
 const dom=page('dmarc-checker',async()=>Response.json({domain:'example.com',at:'2026-09-22T12:00:00Z',score:95,grade:'A',checks:[{id:'dmarc',name:'DMARC',status:'pass',detail:'Published policy'}]}));const d=dom.window.document;d.querySelector('#domain').value='example.com';await submit(dom,'check-form');assert.equal(d.querySelector('#score-num').textContent,'95');assert.match(d.querySelector('#score-note').textContent,/Configuration score/);assert.equal(d.querySelector('#result').style.display,'block');dom.window.close();
});
