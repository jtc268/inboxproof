import crypto from 'node:crypto';

export const ANALYTICS_STARTED_AT = '2026-09-15T15:32:00.000Z';
const DAY=86400e3, SHARDS=8;
export const CLIENT_EVENTS=new Set(['page_view','audit_started','report_viewed','consent_granted']);
export const SERVER_EVENTS=new Set(['lead_captured','audit_completed','checkout_created','subscription_paid']);
const tag=value=>typeof value==='string'&&/^[a-zA-Z0-9 _./-]{1,80}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value.toLowerCase())?value.trim().toLowerCase():null;
export function safePage(value){
 try {const p=new URL(String(value||'/'),'https://inboxproof.email').pathname;if(/^\/r\//.test(p))return '/r/:report';if(!/^\/[a-zA-Z0-9/_-]*$/.test(p)||p.length>160)return '/other';return p||'/';} catch{return '/other';}
}
export function normalizeTouch(input,now=Date.now()){
 if(!input||typeof input!=='object')return null;
 let host='';try{host=new URL(input.referrer||'').hostname.toLowerCase();}catch{if(typeof input.referrerHost==='string'&&/^[a-z0-9.-]{1,120}$/.test(input.referrerHost))host=input.referrerHost;}
 const internal=host==='inboxproof.email'||host.endsWith('.inboxproof.email')||host==='localhost'||host==='127.0.0.1';
 const processor=/(^|\.)(stripe\.com|paypal\.com)$/.test(host)||host==='accounts.google.com';
 const campaign=tag(input.campaign),given=tag(input.source),medium=tag(input.medium);
 let source='direct_or_unknown',channel='direct_or_unknown';
 if(given&&given!=='direct'&&given!=='unknown'&&given!=='direct_or_unknown'){source=given;channel=medium||'campaign';}
 else if(host&&!internal&&!processor){source=host.replace(/^www\./,'');channel=/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|qwant\.com|search\.yahoo\.com)$/.test(host)?'organic_search':/(^|\.)(chatgpt\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)$/.test(host)?'ai_referral':'referral';}
 else if(internal)channel='internal';else if(processor)channel='payment_return';
 const at=Number.isFinite(Date.parse(input.at))?Date.parse(input.at):now;
 return {source,medium:channel,campaign,landingPage:safePage(input.landingPage),referrerHost:internal||processor?null:host||null,at:new Date(Math.min(now,Math.max(now-30*DAY,at))).toISOString(),evidence:'browser_reported'};
}
export function normalizeContext(input,now=Date.now()){
 const current=normalizeTouch(input?.current||input?.lastTouch,now);
 if(!current)return null;
 const consent=input?.consent===true;
 return {consent,current,firstTouch:consent?normalizeTouch(input.firstTouch,now)||current:current,lastTouch:consent?normalizeTouch(input.lastTouch,now)||current:current};
}
export function attachAcquisition(lead,input,now=Date.now()){
 const context=normalizeContext(input,now);if(!context)return;
 if(!lead.acquisition){const historical=Number(lead.createdAt)<Date.parse(ANALYTICS_STARTED_AT);lead.acquisition={version:1,firstTouch:historical?null:context.firstTouch,firstObservedTouch:context.firstTouch,historyUnavailable:historical,observedAt:new Date(now).toISOString()};}
 const touch=context.lastTouch;
 if(!lead.acquisition.lastTouch||!['direct_or_unknown','internal','payment_return'].includes(touch.medium))lead.acquisition.lastTouch=touch;
 lead.acquisition.retainedWithConsent=context.consent;
}
export function stripeAttribution(acquisition){
 const first=acquisition?.firstTouch,last=acquisition?.lastTouch;
 const fields={'metadata[acquisition_source]':first?.source||'unknown','metadata[acquisition_landing]':first?.landingPage||'unknown','metadata[conversion_source]':last?.source||'unknown'};
 if(first?.campaign)fields['metadata[acquisition_campaign]']=first.campaign;
 return fields;
}
export function createAnalytics({store,now=()=>Date.now()}){
 const seenDays=new Set();
 async function registerDay(day){
  if(seenDays.has(day))return;
  await store.locked('analytics:days',async()=>{let dates=JSON.parse(await store.get('analytics:days')||'[]');if(!dates.includes(day)){dates.push(day);await store.set('analytics:days',JSON.stringify(dates.sort()));}});seenDays.add(day);
 }
 async function record({id=crypto.randomUUID(),event,page='/',context=null,attributionTouch=null,test=false,origin='server',at}){
  if(!(origin==='client'?CLIENT_EVENTS:SERVER_EVENTS).has(event))return false;
  let time=at&&Number.isFinite(Date.parse(at))?Math.min(now(),Date.parse(at)):now();
  if(time<now()-90*DAY||time<Date.parse(ANALYTICS_STARTED_AT))return false;
  const hash=crypto.createHash('sha256').update(String(id)).digest('hex');
  if(event==='subscription_paid'){
    const marker='analytics:paid:'+hash;
    await store.create(marker,String(time));
    time=Number(await store.get(marker));
    if(!Number.isFinite(time))throw Error('Invalid payment measurement timestamp');
  }
  const day=new Date(time).toISOString().slice(0,10),shard=parseInt(hash.slice(0,2),16)%SHARDS;
  const key='analytics:'+day+':'+shard;
  const c=normalizeContext(context,now()),touch=normalizeTouch(attributionTouch,now())||c?.firstTouch||null;
  const row={id:hash,event,at:new Date(time).toISOString(),page:safePage(page),source:touch?.source||'unknown',medium:touch?.medium||'unknown',landingPage:touch?.landingPage||'unknown',campaign:touch?.campaign||null,consent:!!c?.consent,test:!!test,origin};
  await registerDay(day);
  return store.locked(key,async()=>{const rows=JSON.parse(await store.get(key)||'[]');if(rows.some(r=>r.id===hash))return false;if(rows.length>=5000)throw Error('Analytics daily capacity reached');rows.push(row);await store.set(key,JSON.stringify(rows));return true;});
 }
 async function report(days=30,{includeTest=false}={}){
  days=Math.max(1,Math.min(90,Number(days)||30));const end=new Date(now()),start=new Date(now()-(days-1)*DAY);start.setUTCHours(0,0,0,0);
  const dates=JSON.parse(await store.get('analytics:days')||'[]').filter(d=>d>=start.toISOString().slice(0,10)&&d<=end.toISOString().slice(0,10));
  const keys=dates.flatMap(d=>Array.from({length:SHARDS},(_,i)=>'analytics:'+d+':'+i)),rows=[];
  for(let i=0;i<keys.length;i+=8){const values=await Promise.all(keys.slice(i,i+8).map(k=>store.get(k)));values.forEach(v=>rows.push(...JSON.parse(v||'[]')));}
  const result={measurementStartedAt:ANALYTICS_STARTED_AT,from:start.toISOString(),to:end.toISOString(),days,includesTest:includeTest,events:{},bySource:Object.create(null),byLandingPage:Object.create(null),byDay:Object.create(null),note:'Event counts, not unique visitors. Legacy traffic is excluded. Browser-reported sources are attribution evidence, not proof of causation.'};
  for(const r of rows){if(r.test&&!includeTest)continue;result.events[r.event]=(result.events[r.event]||0)+1;for(const [group,key]of[['bySource',r.source],['byLandingPage',r.landingPage],['byDay',r.at.slice(0,10)]]){const bucket=result[group][key]||=(Object.create(null));bucket[r.event]=(bucket[r.event]||0)+1;}}
  return result;
 }
 async function prune(){
  const cutoff=new Date(now()-90*DAY).toISOString().slice(0,10);
  await store.locked('analytics:days',async()=>{const dates=JSON.parse(await store.get('analytics:days')||'[]');for(const day of dates.filter(d=>d<cutoff)){for(let i=0;i<SHARDS;i++){const key='analytics:'+day+':'+i;for(const row of JSON.parse(await store.get(key)||'[]'))if(row.event==='subscription_paid')await store.del('analytics:paid:'+row.id);await store.del(key);}seenDays.delete(day);}await store.set('analytics:days',JSON.stringify(dates.filter(d=>d>=cutoff)));});
 }
 return {record,report,prune};
}
