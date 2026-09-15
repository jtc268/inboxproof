import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
const code=fs.readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8');
function page({url='https://inboxproof.email/dmarc-checker',referrer='https://www.google.com/search?q=private',stored={},gpc=false}={}){
 const calls=[],dom=new JSDOM('<!doctype html><html><body><button data-analytics-settings>Analytics settings</button></body></html>',{url,referrer,runScripts:'outside-only'}),w=dom.window;
 w.fetch=async(u,o)=>{calls.push({url:String(u),...o});return{ok:true,json:async()=>({})};};w.navigator.sendBeacon=()=>true;w.structuredClone=structuredClone;
 Object.defineProperty(w.navigator,'globalPrivacyControl',{value:gpc});Object.entries(stored).forEach(([k,v])=>w.localStorage.setItem(k,JSON.stringify(v)));w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return{dom,w,calls};
}
test('no attribution storage before consent; opt-in preserves source across internal pages and checkout; declining removes it',async()=>{
 const a=page();assert.equal(a.w.localStorage.getItem('ip_acquisition_v1'),null);assert.ok(a.w.document.getElementById('analytics-choice'));
 assert.equal(JSON.parse(a.calls[0].body).context.current.referrer,'https://www.google.com');
 a.w.document.querySelector('[data-choice="allow"]').click();const saved=JSON.parse(a.w.localStorage.getItem('ip_acquisition_v1'));assert.equal(saved.firstTouch.landingPage,'/dmarc-checker');
 const b=page({url:'https://inboxproof.email/',referrer:'https://inboxproof.email/dmarc-checker',stored:{ip_analytics_choice:'allow',ip_acquisition_v1:saved}});
 await b.w.fetch('/api/checkout',{method:'POST',body:JSON.stringify({email:'buyer@example.com',plan:'pro'})});const request=JSON.parse(b.calls.find(c=>c.url==='/api/checkout').body);assert.equal(request.analytics.firstTouch.referrer,'https://www.google.com');assert.equal(request.plan,'pro');assert.equal(request.email,'buyer@example.com');
 b.w.inboxproofAnalytics.choose('deny');assert.equal(b.w.localStorage.getItem('ip_acquisition_v1'),null);assert.equal(b.w.inboxproofAnalytics.context().consent,false);a.dom.window.close();b.dom.window.close();
});
test('privacy signals disable browser analytics and legacy beacons cannot forge purchases or double-count views',async()=>{
 const a=page({gpc:true});assert.equal(a.calls.length,0);assert.equal(a.w.document.getElementById('analytics-choice'),null);await a.w.fetch('/api/checkout',{method:'POST',body:'{"plan":"pro"}'});assert.equal(JSON.parse(a.calls[0].body).analytics,undefined);a.dom.window.close();
 const b=page();const before=b.calls.length;b.w.navigator.sendBeacon('/api/track?page=/');b.w.navigator.sendBeacon('/api/track?event=checkout_started');assert.equal(b.calls.length,before);b.w.navigator.sendBeacon('/api/track?event=audit_start');assert.equal(JSON.parse(b.calls.at(-1).body).event,'audit_started');b.dom.window.close();
});
