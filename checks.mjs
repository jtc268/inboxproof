import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export function isPublicIPv4(ip){
  if(net.isIP(ip)!==4)return false;
  const [a,b,c]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
export async function smtpTls(host,{resolver,port=25,timeout=9000,allowPrivate=false,ca}={}){
  let addresses;
  try{addresses=await resolver.resolve4(host);}catch{return {starttls:false,cert:null,error:'Mail host could not be resolved',verified:false};}
  const ip=addresses.find(x=>allowPrivate||isPublicIPv4(x));
  if(!ip)return {starttls:false,cert:null,error:'Mail host has no public IPv4 address available for this probe',verified:false};
  return new Promise(resolve=>{
    const out={starttls:false,cert:null,error:null,verified:false};
    let socket,secure,done=false,phase='greet',buffer='',reply=[];
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(secure)secure.destroy();else socket?.destroy();out.error=error||null;resolve(out);};
    const timer=setTimeout(()=>finish('SMTP connection timed out; TLS is unverified'),timeout);
    socket=net.connect({host:ip,port});
    socket.on('error',e=>finish(e.code||'SMTP connection failed'));
    socket.on('close',()=>{if(phase!=='secure')finish('SMTP connection closed before verification');});
    function onData(chunk){
      buffer+=chunk.toString('latin1');if(buffer.length>65536)return finish('SMTP response too large');
      let end;
      while((end=buffer.indexOf('\r\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);reply.push(line);
        if(!/^\d{3} /.test(line))continue;
        const code=Number(line.slice(0,3)),lines=reply;reply=[];
        if(phase==='greet'){
          if(code!==220)return finish('SMTP greeting was not accepted');
          phase='ehlo';socket.write('EHLO inboxproof.email\r\n');
        }else if(phase==='ehlo'){
          if(code!==250)return finish('SMTP EHLO was not accepted');
          out.starttls=lines.some(l=>/^250[ -]STARTTLS(?:\s|$)/i.test(l));
          if(!out.starttls)return finish();
          phase='starttls';socket.write('STARTTLS\r\n');
        }else if(phase==='starttls'){
          if(code!==220)return finish('Server did not accept STARTTLS');
          phase='secure';socket.removeListener('data',onData);
          secure=tls.connect({socket,servername:host,rejectUnauthorized:true,...(ca?{ca}:{})});
          secure.once('error',e=>{out.certificateError=/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(e.code||'');finish(e.code||'TLS handshake failed');});
          secure.once('secureConnect',()=>{
            const cert=secure.getPeerCertificate();
            out.cert={subject:cert.subject?.CN||'',issuer:cert.issuer?.O||cert.issuer?.CN||'',valid_from:cert.valid_from,valid_to:cert.valid_to};
            out.verified=secure.authorized;finish(secure.authorized?null:'Certificate validation failed');
          });return;
        }
      }
    }
    socket.on('data',onData);
  });
}

export async function inspectSpf(domain,resolver){
  const result={id:'spf',name:'SPF',status:'pass',detail:'',fix:''};
  let count=0,macros=false;const issues=[];
  async function visit(name,path=[]){
    if(path.includes(name))throw Error('SPF include/redirect cycle detected');
    if(path.length>10||count>10)throw Error('SPF can exceed the 10 DNS-lookup budget');
    let txt;try{txt=await resolver.resolveTxt(name);}catch(e){throw Error(e.code==='ENODATA'||e.code==='ENOTFOUND'?'No SPF record at '+name:'SPF DNS lookup unavailable at '+name);}
    const records=txt.map(x=>x.join('')).filter(x=>/^v=spf1(?:\s|$)/i.test(x));
    if(records.length!==1)throw Error(records.length?'Multiple SPF records at '+name:'No SPF record at '+name);
    const record=records[0],tokens=record.trim().split(/\s+/).slice(1);let redirect=null,all=false;
    for(const token of tokens){
      const term=token.replace(/^[+?~-]/,'');
      if(/^redirect=/i.test(term)){redirect=term.slice(9);continue;}
      if(/^exp=/i.test(term))continue;
      if(/^[a-z][\w.-]*=/i.test(term))continue;
      const kind=(term.match(/^[a-z0-9]+/i)||[])[0]?.toLowerCase();
      if(!['all','include','a','mx','ptr','exists','ip4','ip6'].includes(kind)){issues.push('Unrecognized mechanism: '+token);continue;}
      if(kind==='all'){all=true;if(token==='+all'||token==='all')issues.push('The +all mechanism permits every sender');break;}
      if(['include','a','mx','ptr','exists'].includes(kind)){
        if(++count>10)throw Error('SPF can exceed the 10 DNS-lookup budget');
        if(kind==='ptr')issues.push('The deprecated ptr mechanism needs review');
        if(kind==='include'){
          const target=term.slice(8);if(!target)throw Error('Empty SPF include target');
          if(target.includes('%')){macros=true;continue;}
          await visit(target,[...path,name]);
        }
      }
    }
    if(redirect&&!all){if(++count>10)throw Error('SPF can exceed the 10 DNS-lookup budget');if(redirect.includes('%'))macros=true;else await visit(redirect,[...path,name]);}
    return record;
  }
  try{
    const record=await visit(domain);
    result.detail='SPF found: '+record+'. Static expansion visits '+count+' DNS-triggering mechanism(s). Actual evaluation depends on the sending IP.';
    if(issues.length||macros){result.status='warn';result.detail+=' '+issues.join('. ')+(macros?' Sender-dependent macros need a message-specific check.':'');}
    result.fix=issues.length?'Review these mechanisms with your sending provider. Keep all legitimate senders authorized before changing policy.':'';
  }catch(e){result.status=/unavailable|can exceed/.test(e.message)?'warn':'fail';result.detail=e.message+'.';result.fix='Review the complete SPF policy with your sending provider. Do not add a second SPF record or tighten enforcement before checking legitimate senders.';}
  return result;
}
export function dkimKeyInfo(record){
  const tags=Object.fromEntries(record.split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));
  if(!tags.p)return {valid:false,reason:'Key is empty or revoked'};
  try{
    if((tags.k||'rsa').toLowerCase()==='ed25519')return Buffer.from(tags.p,'base64').length===32?{valid:true,type:'Ed25519',bits:256}:{valid:false,reason:'Invalid Ed25519 key'};
    const key=crypto.createPublicKey({key:Buffer.from(tags.p,'base64'),format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='rsa')return {valid:false,reason:'Expected an RSA public key'};
    return {valid:true,type:'RSA',bits:key.asymmetricKeyDetails.modulusLength};
  }catch{return {valid:false,reason:'Public key could not be parsed'};}
}
