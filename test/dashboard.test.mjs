import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../public/pro.html',import.meta.url),'utf8');
for(const plan of ['pro','agency'])test(plan+' dashboard preserves working domain, recheck, API and billing controls after rendering',async()=>{
 const calls=[];
 const lead={email:'qa@example.com',pro:true,plan,domains:['example.com'],apiKey:'ip_test',brand:plan==='agency'?{name:'QA',color:'#123456',logoUrl:''}:undefined};
 const dom=new JSDOM(html,{url:'https://inboxproof.email/pro',runScripts:'dangerously',beforeParse(window){window.fetch=async(url,opts)=>{calls.push({url,body:opts?.body&&JSON.parse(opts.body)});return {ok:true,status:200,json:async()=>url.startsWith('/api/history')?{lead,history:[]}:{domains:['example.com','added.com'],ok:true}};};window.confirm=()=>true;window.alert=()=>{};}});
 await new Promise(r=>setTimeout(r,10));
 const d=dom.window.document;
 assert.equal(d.querySelector('#title').textContent,'qa@example.com');
 for(const selector of ['#domaddbtn','[data-check]','[data-rm]','#managebilling','#copykey',...(plan==='agency'?['#wl-save']:[])])assert.equal(typeof d.querySelector(selector)?.onclick,'function',selector+' lost its event listener');
 assert.doesNotMatch(d.querySelector('#status').textContent,/0\/100/);
 d.querySelector('#domadd').value='added.com';d.querySelector('#domaddbtn').click();await new Promise(r=>setTimeout(r,10));
 assert.ok(calls.some(c=>c.url==='/api/domains'&&c.body.domain==='added.com'&&c.body.action==='add'));
 d.querySelector('[data-check]').click();await new Promise(r=>setTimeout(r,10));assert.ok(calls.some(c=>c.url==='/api/recheck'));
 d.querySelector('[data-rm]').click();await new Promise(r=>setTimeout(r,10));assert.ok(calls.some(c=>c.url==='/api/domains'&&c.body.action==='remove'));
 dom.window.close();
});

test('scheduled cancellation shows its end date without hiding active monitoring controls',async()=>{
 const lead={email:'qa@example.com',pro:true,plan:'pro',domains:['example.com'],cancelAtPeriodEnd:true,currentPeriodEnd:1792069899};
 const history=[{domain:'example.com',at:'2026-10-10T22:00:00Z',score:75,reportId:'latest'}];
 const dom=new JSDOM(html,{url:'https://inboxproof.email/pro',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,status:200,json:async()=>({lead,history})});}});
 await new Promise(r=>setTimeout(r,10));const d=dom.window.document;
 assert.match(d.querySelector('.subscription-notice').textContent,/Renewal is canceled/);
 assert.match(d.querySelector('.subscription-notice').textContent,/2026/);
 assert.match(d.querySelector('#status').textContent,/Daily checks active/);
 assert.equal(typeof d.querySelector('#managebilling').onclick,'function');
 assert.equal(typeof d.querySelector('[data-check]').onclick,'function');
 assert.equal(d.querySelector('.monitoring-explainer a').getAttribute('href'),'/r/latest');
 assert.match(d.querySelector('.monitoring-explainer').textContent,/new failed check/);
 dom.window.close();
});

test('active renewal and inactive plans do not display a scheduled cancellation notice',async()=>{
 for(const lead of [{pro:true,cancelAtPeriodEnd:false},{pro:false,cancelAtPeriodEnd:true}]){
  const dom=new JSDOM(html,{url:'https://inboxproof.email/pro',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,status:200,json:async()=>({lead:{email:'qa@example.com',...lead,currentPeriodEnd:1792069899},history:[]})});}});
  await new Promise(r=>setTimeout(r,10));assert.equal(dom.window.document.querySelector('.subscription-notice'),null);dom.window.close();
 }
});
