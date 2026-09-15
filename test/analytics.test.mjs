import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import{createStore}from'../storage.mjs';import{createAnalytics,normalizeTouch,normalizeContext,attachAcquisition,stripeAttribution,safePage}from'../analytics.mjs';
const now=Date.parse('2026-09-16T12:00:00Z');
const google={referrer:'https://www.google.com/search?q=private@example.com',landingPage:'/dmarc-checker?email=private@example.com#token=secret',at:new Date(now).toISOString()};
test('source attribution distinguishes search, AI, direct, internal and payment returns without storing sensitive URL data',()=>{
 const touch=normalizeTouch(google,now);assert.equal(touch.source,'google.com');assert.equal(touch.medium,'organic_search');assert.equal(touch.landingPage,'/dmarc-checker');assert.equal(touch.referrerHost,'www.google.com');assert.ok(!JSON.stringify(touch).includes('private'));
 assert.equal(normalizeTouch({referrer:'https://chatgpt.com/c/secret'},now).medium,'ai_referral');
 assert.equal(normalizeTouch({referrer:'https://checkout.stripe.com/c/pay/secret'},now).medium,'payment_return');
 assert.equal(normalizeTouch({referrer:'https://inboxproof.email/blog/a'},now).medium,'internal');
 assert.equal(normalizeTouch({},now).source,'direct_or_unknown');
 assert.equal(normalizeTouch({source:'private@example.com'},now).source,'direct_or_unknown');
 assert.equal(normalizeTouch({source:'__proto__'},now).source,'direct_or_unknown');assert.equal(safePage('/r/secret-token?email=x'),'/r/:report');
});
test('first touch survives checkout and direct returns; pre-instrumentation customers remain unattributed',()=>{
 const lead={createdAt:now,id:'new'};attachAcquisition(lead,{consent:true,current:google,firstTouch:google,lastTouch:google},now);
 const later={source:'newsletter',medium:'email',campaign:'weekly',landingPage:'/',at:new Date(now+1000).toISOString()};
 attachAcquisition(lead,{consent:true,current:later,firstTouch:google,lastTouch:later},now+1000);
 attachAcquisition(lead,{consent:false,current:{landingPage:'/'}},now+2000);
 assert.equal(lead.acquisition.firstTouch.source,'google.com');assert.equal(lead.acquisition.lastTouch.source,'newsletter');
 assert.equal(stripeAttribution(lead.acquisition)['metadata[acquisition_source]'],'google.com');assert.equal(stripeAttribution(lead.acquisition)['metadata[conversion_source]'],'newsletter');
 const existing={createdAt:Date.parse('2026-09-10T00:00Z')};attachAcquisition(existing,{current:google},now);assert.equal(existing.acquisition.firstTouch,null);assert.equal(existing.acquisition.historyUnavailable,true);
 assert.equal(normalizeContext({consent:false,current:later,firstTouch:google},now).firstTouch.source,'newsletter');
});
test('dated analytics preserve concurrent events, deduplicate retries, reject client purchases, exclude QA and enforce retention',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ip-analytics-'));let clock=now;
 const store=createStore({directory,local:true,remote:false}),analytics=createAnalytics({store,now:()=>clock});
 try{
 await Promise.all(Array.from({length:24},(_,i)=>analytics.record({id:'page'+i,event:'page_view',origin:'client',context:{current:google}})));
 await Promise.all(Array.from({length:4},()=>analytics.record({id:'sub_once',event:'subscription_paid',context:{current:google}})));
 assert.equal(await analytics.record({id:'spoof',event:'subscription_paid',origin:'client'}),false);
 await analytics.record({id:'qa',event:'page_view',origin:'client',test:true});
  let report=await analytics.report(1);assert.equal(report.events.page_view,24);assert.equal(report.events.subscription_paid,1);assert.equal(report.bySource['google.com'].page_view,24);assert.equal((await analytics.report(1,{includeTest:true})).events.page_view,25);
  clock+=86400e3;await analytics.record({id:'sub_once',event:'subscription_paid',context:{current:google}});assert.equal((await analytics.report(2)).events.subscription_paid,1);
 const serialized=JSON.stringify(await Promise.all(Array.from({length:8},(_,i)=>store.get('analytics:2026-09-16:'+i))));assert.ok(!serialized.includes('private@example.com'));assert.ok(!serialized.includes('secret'));
 clock+=92*86400e3;await analytics.prune();assert.deepEqual(JSON.parse(await store.get('analytics:days')),[]);assert.equal(await store.get('analytics:2026-09-16:0'),null);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
