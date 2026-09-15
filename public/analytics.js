/* First-party measurement. Cross-page attribution is retained only after opt-in. */
(()=>{
 const rawFetch=window.fetch.bind(window),rawBeacon=navigator.sendBeacon?.bind(navigator),key='ip_analytics_choice',ctxKey='ip_acquisition_v1';
 const params=new URLSearchParams(location.search),blocked=navigator.globalPrivacyControl||navigator.doNotTrack==='1';
 const read=k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}};
 const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
 const remove=k=>{try{localStorage.removeItem(k);}catch{}};
 const tag=v=>v&&/^[a-zA-Z0-9 _./-]{1,80}$/.test(v)?v:null;
 const referrer=(()=>{try{return new URL(document.referrer).origin;}catch{return '';}})();
 const touch={source:tag(params.get('utm_source')||params.get('src')),medium:tag(params.get('utm_medium')),campaign:tag(params.get('utm_campaign')),landingPage:location.pathname.startsWith('/r/')?'/r/:report':location.pathname,referrer,at:new Date().toISOString()};
 let consent=!blocked&&read(key)==='allow',saved=consent?read(ctxKey):null;
 if(saved&&Date.now()-Date.parse(saved.firstTouch?.at)>30*86400e3)saved=null;
 let context={consent,current:touch,firstTouch:saved?.firstTouch||touch,lastTouch:saved?.lastTouch||touch,test:params.get('ip_qa')==='1'||saved?.test===true};
 const external=(()=>{try{const h=new URL(document.referrer).hostname;return h!==location.hostname&&!/(^|\.)(stripe\.com|paypal\.com)$/.test(h)&&h!=='accounts.google.com';}catch{return false;}})();
 if(touch.source||external)context.lastTouch=touch;
 if(consent)write(ctxKey,context);
 const event=(name)=>{if(blocked)return;const body=JSON.stringify({id:crypto.randomUUID(),event:name,page:location.pathname,context});rawFetch('/api/analytics/events',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});};
 const legacy=name=>{if(name==='audit_start')event('audit_started');if(name==='report_viewed')event('report_viewed');};
 if(rawBeacon)navigator.sendBeacon=(url,data)=>{try{const u=new URL(url,location.href);if(u.origin===location.origin&&u.pathname==='/api/track'){legacy(u.searchParams.get('event'));return true;}}catch{}return rawBeacon(url,data);};
 window.fetch=(input,init)=>{try{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.origin===location.origin&&['/api/audit','/api/attach','/api/lead','/api/checkout'].includes(u.pathname)&&init?.method?.toUpperCase()==='POST'&&typeof init.body==='string'){const body=JSON.parse(init.body);if(!blocked)body.analytics=context;return rawFetch(input,{...init,body:JSON.stringify(body)});}}catch{}return rawFetch(input,init);};
 const choose=value=>{write(key,value);consent=value==='allow'&&!blocked;context.consent=consent;if(consent){write(ctxKey,context);event('consent_granted');}else{remove(ctxKey);context={consent:false,current:touch,firstTouch:touch,lastTouch:touch,test:context.test};}document.getElementById('analytics-choice')?.remove();};
 window.inboxproofAnalytics={context:()=>structuredClone(context),choose,event};
 function showChoice(){
  if(blocked||document.getElementById('analytics-choice'))return;
  const aside=document.createElement('aside');aside.id='analytics-choice';aside.setAttribute('aria-label','Analytics preference');
  aside.innerHTML='<div><strong>Help us improve Inboxproof</strong><p>Allow us to remember which pages brought you here? <a href="/privacy">Privacy</a></p></div><div class="analytics-actions"><button type="button" data-choice="deny">No thanks</button><button type="button" data-choice="allow">Allow analytics</button></div>';
  aside.querySelectorAll('button').forEach(button=>button.onclick=()=>choose(button.dataset.choice));document.body.append(aside);
 }
 document.addEventListener('DOMContentLoaded',()=>{
  event('page_view');
  if(!blocked&&!read(key)&&!['/pro','/login'].includes(location.pathname)&&!location.pathname.startsWith('/r/'))showChoice();
  const settings=document.querySelector('[data-analytics-settings]');if(settings)settings.onclick=showChoice;
 });
})();
