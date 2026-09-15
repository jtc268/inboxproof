const form=document.querySelector('#login'),message=document.querySelector('#message'),verify=document.querySelector('#verify');
let token;
function readSignInLink(){
  const incoming=new URLSearchParams(location.hash.slice(1)).get('token');
  if(!incoming)return;
  token=incoming;history.replaceState(null,'',location.pathname);
  form.hidden=true;verify.hidden=false;verify.disabled=false;message.textContent='Click below to finish signing in. Your link can be used once.';
}
readSignInLink();
window.addEventListener('hashchange',readSignInLink);
form.addEventListener('submit',async e=>{
  e.preventDefault();const button=document.querySelector('#send');button.disabled=true;message.textContent='Sending your sign-in link…';
  try{const r=await fetch('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value})});const j=await r.json();if(!r.ok)throw Error(j.error||'Could not send the email');message.textContent='Check your inbox for “Sign in to Inboxproof”. The link expires in 20 minutes. Check spam if it doesn’t arrive.';}catch(e){message.textContent=e.message;}finally{button.disabled=false;}
});
verify.addEventListener('click',async()=>{
  verify.disabled=true;message.textContent='Signing in…';
  try{const r=await fetch('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const j=await r.json();if(!r.ok)throw Error(j.error);location.replace('/pro');}catch(e){message.textContent=e.message;form.hidden=false;verify.hidden=true;}
});
