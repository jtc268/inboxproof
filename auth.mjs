import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function createAuth({store,sendEmail,baseUrl,secure=true}) {
  const cookieName=secure?'__Host-ip_session':'ip_session';
  function cookie(value,age){return cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(secure?'; Secure':'');}
  function sessionToken(req){return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';}
  async function identity(req){const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const raw=await store.get('session:'+hash(token));if(!raw)return null;const s=JSON.parse(raw);return s.expires>Date.now()?s.email:null;}
  async function session(email,res){const token=crypto.randomBytes(32).toString('hex');await store.set('session:'+hash(token),JSON.stringify({email,expires:Date.now()+30*86400e3}));res.setHeader('Set-Cookie',cookie(token,30*86400));}
  async function logout(req,res){const t=sessionToken(req);if(t)await store.del('session:'+hash(t));res.setHeader('Set-Cookie',cookie('',0));}
  async function allow(value,limit,window){const bucket=Math.floor(Date.now()/window);for(let i=0;i<limit;i++){if(await store.create('limit:'+hash(value)+':'+bucket+':'+i,'{}'))return true;}return false;}
  async function request(email,ip){
    if(!await allow('login-ip:'+ip,20,3600e3))return {status:429,error:'Too many sign-in requests. Try again in an hour.'};
    if(!await allow('login-email:'+email,1,60e3)||!await allow('login-hour:'+email,5,3600e3))return {status:429,error:'Please wait a minute before requesting another link.'};
    const token=crypto.randomBytes(32).toString('hex');
    await store.set('login:'+hash(token),JSON.stringify({email,expires:Date.now()+20*60e3}));
    // Fragments are not sent to servers, referrers, analytics, or email-link scanners.
    const link=baseUrl+'/login#token='+token;
    const sent=await sendEmail(email,'Sign in to Inboxproof','<p>Open your Inboxproof dashboard:</p><p><a href="'+link+'">Sign in to Inboxproof</a></p><p>This link expires in 20 minutes and can be used once. If you did not request it, you can ignore this email.</p>');
    if(!sent){await store.del('login:'+hash(token));return {status:503,error:'We could not send your sign-in email. Please try again shortly or contact joec88@gmail.com.'};}
    return {status:200,ok:true};
  }
  async function verify(token,res){
    if(!/^[a-f0-9]{64}$/.test(token))return false;
    const raw=await store.get('login:'+hash(token));if(!raw)return false;
    const l=JSON.parse(raw);if(l.expires<=Date.now())return false;
    if(!await store.create('used-login:'+hash(token),'{}'))return false;
    await session(l.email,res);return l.email;
  }
  return {identity,session,logout,request,verify,allow};
}
