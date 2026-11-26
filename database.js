'use strict';
// Plain fetch client. All authorization is enforced by Postgres RLS, not this UI.
window.GardenDB = (() => {
 const cfg=window.GARDEN_CONFIG||{};
 const url=(cfg.url||'').replace(/\/$/,'');
 const key=cfg.publicKey||'';
 const storageKey='two-private-gardens-session-v1';
 // sessionStorage intentionally does not keep your login after this tab closes.
 let session=null,refreshing=null;
 try{session=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch(e){}
 function configured(){return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)&&!!key;}
 function save(data){session=data?{access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+data.expires_in*1000}:null;try{if(session)sessionStorage.setItem(storageKey,JSON.stringify(session));else sessionStorage.removeItem(storageKey);}catch(e){}}
 async function request(path,{method='GET',body,auth=true,headers={}}={}){
  if(!configured())throw new Error('Setup needed: add your Supabase project URL and public key to config.js. Follow GUIDE.md.');
  if(auth)await token();
  const response=await fetch(url+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(auth&&session?{Authorization:'Bearer '+session.access_token}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch(e){throw new Error('Unexpected server response. Check your Supabase project URL.');}
  if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||'Request failed ('+response.status+').');
  return data;
 }
 async function token(){if(!session)throw new Error('Please sign in.');if(session.expires_at>Date.now()+60000)return session.access_token;if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',auth:false,body:{refresh_token:session.refresh_token}}).then(save).catch(e=>{save(null);throw new Error('Your session expired. Sign in again.');}).finally(()=>refreshing=null);await refreshing;return session.access_token;}
 async function login(email,password){const data=await request('/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email,password}});save(data);return profile();}
 async function profile(){const user=await request('/auth/v1/user');const rows=await request('/rest/v1/profiles?select=role&id=eq.'+encodeURIComponent(user.id));if(rows?.length!==1)throw new Error('This account has no garden access. Complete the account setup SQL.');return {id:user.id,email:user.email,role:rows[0].role};}
 async function logout(){try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{save(null);}}
 function rest(path,options){return request('/rest/v1/'+path,options);}
 async function begin(expected){const gate=document.getElementById('auth-gate'),form=document.getElementById('auth-form'),status=document.getElementById('auth-status'),button=document.getElementById('auth-submit');
  const showError=e=>{status.textContent=e.message;};
  async function enter(){const p=await profile();if(expected&&p.role!==expected){await logout();throw new Error('This is '+expected+'’s admin page. Sign in with the matching account.');}gate.hidden=true;gate.style.display='none';document.getElementById('private-content').hidden=false;return p;}
  return new Promise(resolve=>{
   form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;status.textContent='Signing in…';try{await login(document.getElementById('auth-email').value.trim(),document.getElementById('auth-password').value);document.getElementById('auth-password').value='';resolve(await enter());}catch(err){showError(err);}finally{button.disabled=false;}});
   if(!configured()){status.textContent='Not connected yet. Follow GUIDE.md, then fill in config.js. Nothing is being sent or saved online.';button.disabled=true;return;}
   if(session)enter().then(resolve).catch(e=>{showError(e);});else status.textContent='Private access · Faisal and Zehna only.';
  });
 }
 async function changePassword(password){return request('/auth/v1/user',{method:'PUT',body:{password}});}
 return {configured,login,logout,profile,rest,begin,changePassword};
})();
