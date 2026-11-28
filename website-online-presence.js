'use strict';
// Signed-in visible-page visit detection only. No tracking outside this website.
// No recipient, provider secret or service key is sent to the browser.
window.GardenOnlineVisit=(()=>{
 let started=false,stopped=false,inFlight=false,timer=null;
 function visible(){const host=document.getElementById('private-content');return !stopped&&document.visibilityState==='visible'&&host&&!host.hidden&&host.style.display!=='none'}
 async function ping(){if(!visible()||inFlight)return;inFlight=true;try{
  const a=await GardenDB.chatAccess();if(!visible())return;
  await fetch(a.url+'/rest/v1/rpc/record_garden_online_visit',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{apikey:a.publicKey,Authorization:'Bearer '+a.accessToken,'Content-Type':'application/json'},body:'{}'});
 }catch{/* Optional notification failure must not interrupt gardens/chat/film. */}finally{inFlight=false}}
 function start(user){if(started||user.role!=='zehna')return;started=true;stopped=false;ping();timer=setInterval(ping,20000)}
 function stop(){stopped=true;clearInterval(timer)}
 document.addEventListener('visibilitychange',()=>{if(started)ping()});
 window.addEventListener('online',()=>{if(started)ping()});
 window.addEventListener('pagehide',stop);
 window.addEventListener('pageshow',e=>{if(e.persisted&&started){stopped=false;clearInterval(timer);timer=setInterval(ping,20000);ping()}});
 return {start,stop};
})();
