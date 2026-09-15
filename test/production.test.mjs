import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import {createStore} from '../storage.mjs';
import {createAuth} from '../auth.mjs';
import {inspectSpf,dkimKeyInfo,isPublicIPv4,smtpTls} from '../checks.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'inboxproof-test-'));
Object.assign(process.env,{NO_LISTEN:'1',DATA_DIR:temp,APP_URL:'http://localhost',STRIPE_SECRET:'test',STRIPE_PRICE_PRO:'price_pro',STRIPE_PRICE_AGENCY:'price_agency',STRIPE_WEBHOOK_SECRET:'test_webhook',RESEND_API_KEY:'test',STATS_SECRET:'test_stats',CRON_SECRET:'test_cron',AUDIT_FOLLOWUP_EMAIL:'0'});
delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_KEY;delete process.env.VERCEL;
const checkoutRequests=[];
const mail=[],subs=new Map(),customers=new Map(),sessions=new Map();
let mailFails=false,portalCount=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,opts={})=>{
 const url=String(input);
 if(url.startsWith('http://127.0.0.1:'))return originalFetch(input,opts);
 if(url==='https://api.resend.com/emails'){if(mailFails)return Response.json({message:'unavailable'},{status:503});mail.push(JSON.parse(opts.body));return Response.json({id:crypto.randomUUID()});}
 if(url.startsWith('https://api.stripe.com/v1')){
  const u=new URL(url),p=u.pathname.replace('/v1','');
  if(p.startsWith('/subscriptions/'))return Response.json(subs.get(p.split('/').pop())||{error:{message:'missing'}},{status:subs.has(p.split('/').pop())?200:404});
  if(p==='/subscriptions')return Response.json({data:[...subs.values()].filter(s=>s.customer===u.searchParams.get('customer'))});
  if(p==='/customers')return Response.json({data:[...customers.values()].filter(c=>c.email===u.searchParams.get('email'))});
  if(p.startsWith('/customers/'))return Response.json(customers.get(p.split('/').pop()));
  if(p.startsWith('/checkout/sessions/'))return Response.json(sessions.get(p.split('/').pop()));
  if(p==='/checkout/sessions'){const b=Object.fromEntries(new URLSearchParams(opts.body));assert.equal(b.success_url,'http://localhost/pro?session_id={CHECKOUT_SESSION_ID}');assert.ok(b['metadata[checkout_proof]']);checkoutRequests.push(b);return Response.json({id:'cs_qa',url:'https://checkout.stripe.com/qa'});}
  if(p==='/billing_portal/sessions'){portalCount++;return Response.json({url:'https://billing.stripe.com/qa'});}
 }
 throw Error('Unmocked external request: '+url);
};
const {default:handler,store,auth,monitorCycle,fulfillCheckout}=await import('../server.mjs');
const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const call=async(p,{method='GET',body,cookie,headers={}}={})=>{const r=await fetch(base+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});return {status:r.status,headers:r.headers,body:await r.json().catch(()=>null)};};
async function cookieFor(email){let cookie;await auth.session(email,{setHeader:(k,v)=>cookie=v.split(';')[0]});return cookie;}
const lead=(email,extra={})=>({id:crypto.randomUUID(),email,domain:'example.com',pro:true,plan:'pro',reportIds:[],...extra});
const audit=async domain=>({domain,at:new Date().toISOString(),score:95,grade:'A',checks:[{id:'spf',name:'SPF',status:'pass'}]});

test('account, billing, domain changes and deletion require a session; URL email cannot impersonate',async()=>{
 await store.set('leads',JSON.stringify({'alice@example.com':lead('alice@example.com',{stripeCustomerId:'cus_alice'}),'bob@example.com':lead('bob@example.com')}));
 for(const p of ['/api/history?email=alice@example.com','/api/brand?email=alice@example.com','/api/referrals?email=alice@example.com'])assert.equal((await call(p)).status,401);
 for(const p of ['/api/portal','/api/delete','/api/brand','/api/domains'])assert.equal((await call(p,{method:'POST',body:{email:'alice@example.com'}})).status,401);
 const cookie=await cookieFor('alice@example.com');assert.equal((await call('/api/history?email=bob@example.com',{cookie})).status,403);
 const history=await call('/api/history',{cookie});assert.equal(history.status,200);assert.equal(history.body.lead.email,'alice@example.com');assert.equal(history.headers.get('cache-control'),'no-store');
 const portal=await call('/api/portal',{method:'POST',body:{email:'bob@example.com'},cookie});assert.equal(portal.status,200);assert.equal(portalCount,1);
 assert.equal((await call('/api/delete',{method:'POST',body:{},cookie,headers:{Origin:'https://evil.example'}})).status,403);
});

test('email login uses a one-use link, HttpOnly cookie, and logout revocation',async()=>{
 const r=await call('/api/auth/request',{method:'POST',body:{email:'login@example.com'}});assert.equal(r.status,200);
 const message=mail.at(-1);assert.deepEqual(message.to,['login@example.com']);const token=message.html.match(/#token=([a-f0-9]+)/)[1];
 const results=await Promise.all([1,2].map(()=>call('/api/auth/verify',{method:'POST',body:{token}})));
 assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
 const success=results.find(x=>x.status===200),cookie=success.headers.get('set-cookie').split(';')[0];assert.match(success.headers.get('set-cookie'),/HttpOnly/);assert.match(success.headers.get('set-cookie'),/SameSite=Lax/);
 assert.equal((await call('/api/account',{cookie})).body.email,'login@example.com');
 assert.equal((await call('/api/auth/logout',{method:'POST',cookie})).status,200);assert.equal((await call('/api/account',{cookie})).status,401);
 assert.equal((await call('/api/auth/request',{method:'POST',body:{email:'login@example.com'}})).status,429);
});

test('expired, forged and failed-delivery login links do not authenticate',async()=>{
 const token='a'.repeat(64),hash=crypto.createHash('sha256').update(token).digest('hex');await store.set('login:'+hash,JSON.stringify({email:'alice@example.com',expires:Date.now()-1}));
 assert.equal((await call('/api/auth/verify',{method:'POST',body:{token}})).status,400);
 assert.equal((await call('/api/auth/verify',{method:'POST',body:{token:'fake'}})).status,400);
 mailFails=true;assert.equal((await call('/api/auth/request',{method:'POST',body:{email:'failure@example.com'}})).status,503);mailFails=false;
});

test('domain management enforces account boundaries and plan capacity under concurrent adds',async()=>{
 const cookie=await cookieFor('alice@example.com');
 const results=await Promise.all(Array.from({length:7},(_,i)=>call('/api/domains',{method:'POST',cookie,body:{action:'add',domain:'domain'+i+'.com',email:'bob@example.com'}})));
 assert.equal(results.filter(x=>x.status===200).length,4);assert.equal(results.filter(x=>x.status===409).length,3);
 const l=(await call('/api/history',{cookie})).body.lead;assert.equal(l.domains.length,5);
 assert.equal((await call('/api/domains',{method:'POST',cookie,body:{action:'add',domain:'<script>'}})).status,400);
 assert.equal((await call('/api/domains',{method:'POST',cookie,body:{action:'remove',domain:'domain0.com'}})).status,200);
});

test('payment reconciliation checks current subscription, remembers purchased domain, and sends welcome once',async()=>{
 customers.set('cus_paid',{id:'cus_paid',email:'paid@example.com'});subs.set('sub_paid',{id:'sub_paid',customer:'cus_paid',status:'active',items:{data:[{price:{id:'price_pro'}}]}});
 const session={id:'cs_paid',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_paid',customer:'cus_paid',metadata:{domain:'paid.example.com'}};
 const count=mail.length;await store.run(async()=>{await store.hydrate();await fulfillCheckout(session);});await store.run(async()=>{await store.hydrate();await fulfillCheckout(session);});
 assert.equal(mail.length,count+1);const l=JSON.parse(await store.get('leads'))['paid@example.com'];assert.equal(l.pro,true);assert.deepEqual(l.domains,['paid.example.com']);
 assert.equal((await call('/api/checkout',{method:'POST',body:{email:'paid@example.com',plan:'pro'}})).status,409);
 subs.get('sub_paid').status='canceled';await store.run(async()=>{await store.hydrate();assert.equal(await fulfillCheckout(session),null);});assert.equal(JSON.parse(await store.get('leads'))['paid@example.com'].pro,false);
});

test('checkout return binds browser login to the initiating checkout cookie',async()=>{
 const proof='browser-proof';customers.set('cus_callback',{id:'cus_callback',email:'callback@example.com'});subs.set('sub_callback',{id:'sub_callback',customer:'cus_callback',status:'active',items:{data:[{price:{id:'price_pro'}}]}});
 const session={id:'cs_callback',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_callback',metadata:{checkout_proof:crypto.createHash('sha256').update(proof).digest('hex')}};sessions.set(session.id,session);
 const wrong=await call('/pro?session_id=cs_callback',{cookie:'ip_checkout=wrong'});assert.equal(wrong.status,303);assert.equal(wrong.headers.get('set-cookie'),null);
 const right=await call('/pro?session_id=cs_callback',{cookie:'ip_checkout='+proof});assert.equal(right.status,303);assert.match(right.headers.get('set-cookie'),/HttpOnly/);assert.equal(right.headers.get('location'),'/pro');
 session.payment_status='unpaid';const unpaid=await call('/pro?session_id=cs_callback',{cookie:'ip_checkout='+proof});assert.equal(unpaid.headers.get('set-cookie'),null);
});

test('webhook signatures reject stale, missing, or tampered requests, and acknowledge duplicate events',async()=>{
 const event={id:'evt_qa',type:'unrelated.event',data:{object:{}}};
 const sign=(e,t)=>'t='+t+',v1='+crypto.createHmac('sha256','test_webhook').update(t+'.'+JSON.stringify(e)).digest('hex');
 assert.equal((await call('/api/webhook',{method:'POST',body:event})).status,400);
 const old=Math.floor(Date.now()/1000)-600;assert.equal((await call('/api/webhook',{method:'POST',body:event,headers:{'stripe-signature':sign(event,old)}})).status,400);
 const now=Math.floor(Date.now()/1000),headers={'stripe-signature':sign(event,now)};assert.equal((await call('/api/webhook',{method:'POST',body:{...event,id:'evt_tampered'},headers})).status,400);
 assert.equal((await call('/api/webhook',{method:'POST',body:event,headers})).status,200);assert.equal((await call('/api/webhook',{method:'POST',body:event,headers})).body.duplicate,true);
});

test('monitor scheduler accepts authenticated GET only; spoofed cron header fails',async()=>{
 assert.equal((await call('/api/monitor')).status,401);assert.equal((await call('/api/monitor',{headers:{'vercel-cron':'1'}})).status,401);
 assert.equal((await call('/api/monitor',{method:'POST',headers:{'vercel-cron':'1'},body:{notify:false}})).status,401);
 await store.set('leads','{}');const r=await call('/api/monitor',{headers:{Authorization:'Bearer test_cron'}});assert.equal(r.status,200);assert.equal(r.body.checked,0);
});

test('monitor covers more than 15 accounts and all 25 agency domains; second run skips recent work',async()=>{
 const all={};for(let i=0;i<17;i++)all['person'+i+'@example.com']=lead('person'+i+'@example.com',{domain:'site'+i+'.com'});
 all['agency@example.com']=lead('agency@example.com',{plan:'agency',domains:Array.from({length:25},(_,i)=>'agency'+i+'.com')});
 await store.set('leads',JSON.stringify(all));await store.set('audits','{}');const visited=[];
 const fn=async d=>{visited.push(d);return audit(d);};
 const result=await store.run(()=>monitorCycle({notify:false,auditFn:fn}));assert.equal(result.checked,42);assert.equal(result.pending,0);assert.equal(new Set(visited).size,42);
 assert.equal((await store.run(()=>monitorCycle({notify:false,auditFn:fn}))).checked,0);
 const saved=JSON.parse(await store.get('audits'));assert.equal(saved['agency@example.com'].length,25);assert.ok(saved['agency@example.com'].every(x=>x.reportId));
});

test('concurrent state persists preserve separate customer updates and fail closed',async()=>{
 await store.set('leads',JSON.stringify({first:{email:'first'},second:{email:'second'}}));
 let release;const gate=new Promise(r=>release=r);let hydrated=0;
 await Promise.all(['first','second'].map((key)=>store.run(async()=>{await store.hydrate();if(++hydrated===2)release();await gate;store.proxy('leads')[key].pro=true;await store.persist('leads');})));
 const saved=JSON.parse(await store.get('leads'));assert.equal(saved.first.pro,true);assert.equal(saved.second.pro,true);
 const bad=createStore({url:'https://invalid.example',key:'x',remote:true});await assert.rejects(()=>bad.set('leads','{}'));
});

test('SPF recursively expands includes and redirects without unsafe blanket policy changes',async()=>{
 const records={'ok.com':'v=spf1 a mx include:inc.com ~all','inc.com':'v=spf1 ip4:203.0.113.5 -all','dup.com':['v=spf1 -all','v=spf1 ~all'],'cycle.com':'v=spf1 include:cycle.com -all'};
 for(let i=0;i<12;i++)records['chain'+i+'.com']=i===11?'v=spf1 -all':'v=spf1 include:chain'+(i+1)+'.com -all';
 const resolver={resolveTxt:async d=>{if(!records[d])throw Object.assign(Error(),{code:'ENOTFOUND'});return (Array.isArray(records[d])?records[d]:[records[d]]).map(x=>[x]);}};
 const ok=await inspectSpf('ok.com',resolver);assert.equal(ok.status,'pass');assert.match(ok.detail,/3 DNS/);assert.doesNotMatch(ok.fix,/Change ~all|Append -all/);
 assert.equal((await inspectSpf('dup.com',resolver)).status,'fail');assert.match((await inspectSpf('cycle.com',resolver)).detail,/cycle/);assert.match((await inspectSpf('chain0.com',resolver)).detail,/10 DNS/);
});

test('DKIM parses real key material and SMTP probes exclude private destinations',async()=>{
 const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const p=publicKey.export({format:'der',type:'spki'}).toString('base64');assert.equal(dkimKeyInfo('v=DKIM1; k=rsa; p='+p).bits,2048);assert.equal(dkimKeyInfo('v=DKIM1; p=broken').valid,false);
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.20.0.1','100.64.0.1'])assert.equal(isPublicIPv4(ip),false);
 assert.equal(isPublicIPv4('8.8.8.8'),true);const result=await smtpTls('internal.example',{resolver:{resolve4:async()=>['127.0.0.1']}});assert.match(result.error,/no public/);
});

test('SMTP performs EHLO and STARTTLS, verifies certificates, and handles fragmented replies',async()=>{
 const key=fs.readFileSync(new URL('./fixtures/smtp-key.pem',import.meta.url));
 const validCert=fs.readFileSync(new URL('./fixtures/smtp-valid.pem',import.meta.url));
 const expiredCert=fs.readFileSync(new URL('./fixtures/smtp-expired.pem',import.meta.url));
 async function probe({cert=validCert,host='mail.fixture.test',trust=true,offers=true}={}){
  const commands=[];const sockets=new Set();
  const smtp=net.createServer(socket=>{
   sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.write('220 fixture ready\r\n');let buffer='';
   function data(chunk){buffer+=chunk;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);commands.push(line);
    if(line.startsWith('EHLO')){socket.write('250-fixture\r\n');setImmediate(()=>socket.write(offers?'250 STARTTLS\r\n':'250 OK\r\n'));}
    if(line==='STARTTLS'){socket.write('220 Ready\r\n');socket.removeListener('data',data);sockets.delete(socket);const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:tls.createSecureContext({key,cert})});secure.on('error',()=>{});sockets.add(secure);secure.on('close',()=>sockets.delete(secure));}
   }}socket.on('data',data);
  });
  await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
  const result=await smtpTls(host,{resolver:{resolve4:async()=>['127.0.0.1']},port:smtp.address().port,timeout:2000,allowPrivate:true,...(trust?{ca:cert}:{})});
  sockets.forEach(s=>s.destroy());await new Promise(r=>smtp.close(r));return {result,commands};
 }
 const ok=await probe();assert.equal(ok.result.verified,true);assert.deepEqual(ok.commands,['EHLO inboxproof.email','STARTTLS']);assert.ok(ok.result.cert.valid_to);
 assert.equal((await probe({host:'wrong.fixture.test'})).result.certificateError,true);
 assert.equal((await probe({trust:false})).result.certificateError,true);
 assert.equal((await probe({cert:expiredCert})).result.certificateError,true);
 const plain=await probe({offers:false});assert.equal(plain.result.starttls,false);assert.equal(plain.result.error,null);
});

test('failed monitoring email is saved for retry and accepted on the next scheduler run',async()=>{
 const email='alert@example.com';await store.set('leads',JSON.stringify({[email]:lead(email,{domainScores:{'example.com':{score:100,at:'2000-01-01T00:00:00.000Z',failures:[]}}})}));
 mailFails=true;const first=await store.run(()=>monitorCycle({auditFn:audit}));assert.equal(first.errors.length,1);assert.equal(Object.keys(JSON.parse(await store.get('leads'))[email].pendingAlerts).length,1);
 mailFails=false;const count=mail.length;const second=await store.run(()=>monitorCycle({auditFn:audit}));assert.equal(second.checked,0);assert.equal(mail.length,count+1);assert.equal(Object.keys(JSON.parse(await store.get('leads'))[email].pendingAlerts).length,0);
});

test('abandoned lock recovery preserves availability after the maximum function lifetime',async()=>{
 await store.create('lock:recovery-test',JSON.stringify({at:Date.now()-700000,owner:'dead'}));let called=false;await store.locked('recovery-test',async()=>called=true);assert.equal(called,true);
});


test('analytics HTTP flow joins landing source to checkout and verified payment while rejecting public access and forged conversions',async()=>{
 const touch={referrer:'https://www.google.com/search?q=private',landingPage:'/dmarc-checker?email=private',at:new Date().toISOString()};
 const context={consent:true,current:touch,firstTouch:touch,lastTouch:touch};
 assert.equal((await call('/api/analytics')).status,403);
 assert.equal((await call('/api/analytics/events',{method:'POST',body:{id:crypto.randomUUID(),event:'subscription_paid',context}})).status,400);
 const email='attribution@example.com';customers.set('cus_attr',{id:'cus_attr',email});
 assert.equal((await call('/api/lead',{method:'POST',body:{email,analytics:context}})).status,200);
 const later={source:'newsletter',medium:'email',landingPage:'/',at:new Date().toISOString()};
 assert.equal((await call('/api/checkout',{method:'POST',body:{email,plan:'pro',domain:'example.com',analytics:{...context,current:later,lastTouch:later}}})).status,200);
 const metadata=checkoutRequests.at(-1);assert.equal(metadata['metadata[acquisition_source]'],'google.com');assert.equal(metadata['metadata[acquisition_landing]'],'/dmarc-checker');assert.equal(metadata['metadata[conversion_source]'],'newsletter');
 const before=(await call('/api/analytics?days=1',{headers:{Authorization:'Bearer test_stats'}})).body.events.subscription_paid||0;
 subs.set('sub_attr',{id:'sub_attr',customer:'cus_attr',status:'active',items:{data:[{price:{id:'price_pro'}}]}});
 const session={id:'cs_attr',mode:'subscription',status:'complete',payment_status:'paid',subscription:'sub_attr',metadata:{domain:'example.com'}};
 for(let i=0;i<2;i++)await store.run(async()=>{await store.hydrate();await fulfillCheckout(session,{welcome:false});});
 const report=(await call('/api/analytics?days=1',{headers:{Authorization:'Bearer test_stats'}})).body;assert.equal(report.events.subscription_paid,before+1);assert.equal(report.bySource['google.com'].subscription_paid,1);
 const row=JSON.parse(await store.get('leads'))[email];assert.equal(row.acquisition.firstTouch.source,'google.com');assert.equal(row.acquisition.lastTouch.source,'newsletter');
 const source=await originalFetch(base+'/');assert.match(await source.text(),/<script src="\/analytics.js"><\/script>/);
 const sitemap=await originalFetch(base+'/sitemap.xml').then(r=>r.text());assert.ok(!sitemap.includes('#'));assert.ok(!sitemap.includes('/login'));assert.ok(!sitemap.includes('<lastmod>'));assert.ok(sitemap.includes('https://inboxproof.email/dmarc-checker'));
 for(const path of ['/sitemap.xml','/robots.txt','/','/dmarc-checker']){const response=await originalFetch(base+path,{method:'HEAD'});assert.equal(response.status,200,path);assert.equal(await response.text(),'');}
});

test.after(async()=>{globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});});
