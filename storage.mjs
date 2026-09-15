import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// Storage writes fail closed. Immutable creates provide cross-instance exclusion.
export function createStore({ url, key, directory, remote, local }) {
  const context = new AsyncLocalStorage();
  const headers = { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' };
  const objectUrl = name => url + '/storage/v1/object/kv/' + encodeURIComponent(name);
  const file = name => path.join(directory, Buffer.from(name).toString('hex') + '.json');
  async function get(name) {
    if (!remote) { try { return fs.readFileSync(file(name), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
    const r = await fetch(objectUrl(name), { headers, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      if (b.statusCode === '404' || b.error === 'not_found') return null;
      throw new Error('Storage read failed (' + r.status + ')');
    }
    return r.text();
  }
  async function create(name, value) {
    if (!remote) { fs.mkdirSync(directory, {recursive:true}); try { fs.writeFileSync(file(name), value, { flag:'wx', mode:0o600 }); return true; } catch(e) { if(e.code==='EEXIST')return false;throw e; } }
    const r = await fetch(objectUrl(name), { method:'POST', headers, body:value, signal:AbortSignal.timeout(10000) });
    if (r.ok) return true;
    const b = await r.json().catch(() => ({}));
    if (r.status === 409 || b.statusCode === '409' || b.error === 'Duplicate') return false;
    throw new Error('Storage create failed (' + r.status + ')');
  }
  async function set(name, value) {
    if (!remote) { if(local){fs.mkdirSync(directory,{recursive:true});const tmp=file(name)+'.'+crypto.randomUUID();fs.writeFileSync(tmp,value,{mode:0o600});fs.renameSync(tmp,file(name));}return; }
    // PUT replaces in place: there is never a delete-before-write data loss window.
    const r = await fetch(objectUrl(name), {method:'PUT',headers,body:value,signal:AbortSignal.timeout(10000)});
    if (r.ok) return;
    const b = await r.json().catch(()=>({}));
    if (r.status===404 || b.statusCode==='404' || b.error==='not_found') {
      if (await create(name,value)) return;
      const retry=await fetch(objectUrl(name),{method:'PUT',headers,body:value,signal:AbortSignal.timeout(10000)});
      if(retry.ok)return;
    }
    throw new Error('Storage write failed ('+r.status+')');
  }
  async function del(name) {
    if(!remote){try{fs.unlinkSync(file(name));}catch(e){if(e.code!=='ENOENT')throw e;}return;}
    const r=await fetch(url+'/storage/v1/object/kv',{method:'DELETE',headers,body:JSON.stringify({prefixes:[name]}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('Storage delete failed ('+r.status+')');
  }
  async function locked(name, fn) {
    const lock='lock:'+name;
    const deadline=Date.now()+15000;
    const claim=JSON.stringify({at:Date.now(),owner:crypto.randomUUID()});
    while(!await create(lock,claim)){
      const abandoned=await get(lock);
      if(abandoned && Date.now()-(JSON.parse(abandoned).at||0)>600000){
        const recovery='recover:'+crypto.createHash('sha256').update(lock+abandoned).digest('hex');
        if(await create(recovery,'{}')){if(await get(lock)===abandoned)await del(lock);}
      }
      if(Date.now()>deadline)throw new Error('Storage is busy. Please retry shortly.');
      await new Promise(r=>setTimeout(r,80+Math.random()*120));
    }
    // Vercel functions are limited to 300 seconds. Recover abandoned locks after twice that limit.
    // A unique recovery claim prevents concurrent cleaners from deleting a successor lock.
    try{return await fn();}finally{await del(lock);}
  }
  const base={leads:{},audits:{},stats:{pageViews:0,byPage:{},byRef:{}}};
  const state=()=>context.getStore() || base;
  const proxy=kind=>new Proxy({}, {
    get:(_,k)=>state()[kind][k],set:(_,k,v)=>(state()[kind][k]=v,true),deleteProperty:(_,k)=>delete state()[kind][k],
    ownKeys:()=>Reflect.ownKeys(state()[kind]),getOwnPropertyDescriptor:(_,k)=>Object.getOwnPropertyDescriptor(state()[kind],k),
  });
  async function hydrate(force=false) {
    const s=state();if(s.hydrated&&!force)return;
    for(const kind of ['leads','audits','stats']){
      let text=await get(kind);
      if(text===null&&!remote){try{text=fs.readFileSync(path.join(directory,kind+'.json'),'utf8');}catch{}}
      s[kind]=text?JSON.parse(text):structuredClone(base[kind]);
    }
    s.baseline=structuredClone({leads:s.leads,audits:s.audits,stats:s.stats});s.hydrated=true;
  }
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function merge(old,next,current,kind) {
    if(same(old,next))return current;
    if(next===undefined)return undefined;
    if(Array.isArray(next)) {
      if(kind==='audits'&&Array.isArray(old)&&Array.isArray(current)){
        const additions=next.filter(x=>!old.some(o=>same(o,x)));
        return [...current,...additions.filter(x=>!current.some(c=>same(c,x)))].sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-200);
      }
      return next;
    }
    if(next&&typeof next==='object'){
      const out={...(current||{})};
      for(const k of new Set([...Object.keys(old||{}),...Object.keys(next)])){
        if(same(old?.[k],next[k]))continue;
        const v=merge(old?.[k],next[k],current?.[k],kind);
        if(v===undefined)delete out[k];else out[k]=v;
      }
      return out;
    }
    if(kind==='stats'&&typeof old==='number'&&typeof next==='number'&&typeof current==='number')return current+(next-old);
    return next;
  }
  async function persist(kind) {
    const s=state();
    if(!s.baseline)await hydrate();
    const before=structuredClone(s.baseline[kind]), after=structuredClone(s[kind]);
    await locked(kind,async()=>{
      const raw=await get(kind);const latest=raw?JSON.parse(raw):{};
      const merged=merge(before,after,latest,kind);
      await set(kind,JSON.stringify(merged));
    });
    s.baseline[kind]=after;
  }
  const run=fn=>context.run({leads:{},audits:{},stats:{},hydrated:false},fn);
  return {get,set,create,del,locked,hydrate,persist,proxy,run};
}
