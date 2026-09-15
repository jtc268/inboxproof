import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../public/report.html',import.meta.url),'utf8');
for(const paid of [true,false])test((paid?'paid':'anonymous')+' report shows the appropriate account controls after report loading',async()=>{
 const dom=new JSDOM(html,{url:'https://inboxproof.email/r/report-test',runScripts:'dangerously',beforeParse(w){w.navigator.sendBeacon=()=>true;w.fetch=async url=>{if(url==='/api/history')return{ok:paid,status:paid?200:401,json:async()=>({lead:{pro:true}})};return{ok:true,json:async()=>({domain:'example.com',score:75,at:new Date().toISOString(),checks:[{id:'spf',name:'SPF',status:'warn',detail:'Test'}]})};};}});await new Promise(r=>setTimeout(r,15));const d=dom.window.document;
 assert.match(d.querySelector('#h1').textContent,/example.com scored 75/);assert.equal(d.querySelector('#accountReport').hidden,!paid);assert.equal(d.documentElement.classList.contains('account-loading'),false);
 for(const id of ['topCta','wlProBottom','saveRow','ownCta'])assert.equal(dom.window.getComputedStyle(d.getElementById(id)).display==='none',paid,id);
 assert.ok(d.querySelector('.nav-links a[href="/pro"]'));dom.window.close();
});
