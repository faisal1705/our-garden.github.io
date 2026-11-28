'use strict';
// Presence only. No email recipient, provider key, service key or message text here.
window.ChatEmailPresence=(()=>{
 let started=false,ended=false,timer=null,session=null,sequence=0,credentials=null;
 async function publish(active){if(!started||!session)return;const n=++sequence;try{
  // Keep a credential snapshot for a best-effort hide/close keepalive request.
  const a=active||!credentials?await GardenDB.chatAccess():credentials;credentials=a;
  await fetch(a.url+'/rest/v1/rpc/set_chat_email_presence',{method:'POST',keepalive:true,cache:'no-store',signal:AbortSignal.timeout(5000),headers:{apikey:a.publicKey,Authorization:'Bearer '+a.accessToken,'Content-Type':'application/json'},body:JSON.stringify({p_session:session,p_sequence:n,p_active:!!active})}).then(r=>{if(!r.ok)throw new Error('Presence unavailable')});
 }catch(e){console.warn('Chat email presence could not update; server timeout will apply.')}}
 function visible(){return !ended&&document.visibilityState==='visible'}
 async function start(user){if(started||user.role!=='faisal')return;started=true;ended=false;session=crypto.randomUUID();timer=setInterval(()=>publish(visible()),10000);await publish(visible())}
 function stop(){if(!started||ended)return;ended=true;clearInterval(timer);return publish(false)}
 document.addEventListener('visibilitychange',()=>{if(started&&!ended)publish(visible())});
 window.addEventListener('online',()=>{if(started&&!ended)publish(visible())});
 window.addEventListener('pagehide',stop);
 return {start,stop};
})();
