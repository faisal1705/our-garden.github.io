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
 // Used only by the private chat for authenticated Storage and Realtime.
 async function chatAccess(){await token();return {url,publicKey:key,accessToken:session.access_token};}
 return {configured,login,logout,profile,rest,begin,changePassword,chatAccess};
})();

// Visible chat shortcut on garden pages only. Hidden with the private garden
// until login succeeds. No changes to cards, garden layout, or admin navigation.
(function(){
 function link(){
  if(!document.getElementById('grid'))return;
  const host=document.getElementById('private-content');
  if(!host||host.querySelector('[data-garden-chat-link]'))return;
  const style=document.createElement('style');
  style.textContent=`
   .garden-chat-launcher,.garden-chat-launcher:link,.garden-chat-launcher:visited{
    position:fixed;right:max(22px,env(safe-area-inset-right));
    bottom:calc(22px + env(safe-area-inset-bottom));z-index:8;
    display:inline-flex;align-items:center;gap:10px;
    padding:15px 21px;border:1px solid #728565;border-radius:50px;
    background:#526647;color:#fffaf0;text-decoration:none;
    box-shadow:0 5px 24px #394b3330;font:13px/1.2 Arial,Helvetica,sans-serif;
    letter-spacing:.2px;white-space:nowrap;transition:transform .2s,background .2s,box-shadow .2s;
   }
   .garden-chat-launcher:hover{background:#43573a;color:#fffaf0;
    transform:translateY(-3px);box-shadow:0 8px 26px #394b3340}
   .garden-chat-launcher:focus-visible{outline:3px solid #a8b998;outline-offset:4px}
   .garden-chat-launcher svg{width:20px;height:20px;flex-shrink:0}
   @media(max-width:600px){.garden-chat-launcher,.garden-chat-launcher:link,.garden-chat-launcher:visited{
    right:max(16px,env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));padding:14px 18px;font-size:12px}}
   @media(prefers-reduced-motion:reduce){.garden-chat-launcher{transition:none!important}}
  `;
  document.head.append(style);
  const a=document.createElement('a');a.href='chat.html';a.className='garden-chat-launcher';
  a.dataset.gardenChatLink='true';a.setAttribute('aria-label','Open our private chat');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','M20 11a8 8 0 0 1-8 8H5l-4 3 1.6-6A8 8 0 1 1 20 11Z M7 10h7 M7 14h4');
  svg.append(path);const text=document.createElement('span');text.textContent='Our chat ♡';
  a.append(svg,text);host.append(a);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',link,{once:true});else link();
})();

// Inbox is loaded only on the two garden pages. Relative to this script's URL.
(function(){
 if(!document.getElementById('grid'))return;
 const current=document.currentScript;
 if(document.querySelector('script[data-garden-inbox]'))return;
 const s=document.createElement('script');
 s.src=new URL('inbox.js?v=reads-1',current.src).href;
 s.dataset.gardenInbox='true';document.head.append(s);
})();
