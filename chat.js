'use strict';
const $=id=>document.getElementById(id);
const BUCKET='garden-chat-photos',BATCH=60,MAX_PHOTO=10*1024*1024;
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
let me,editing=null,file=null,draftURL=null,sending=false,hasOlder=false,menuID=null,viewerID=null;
let ws=null,reconnectTimer,heartbeat,tokenTimer,pollTimer,watchdog,reconnectAttempt=0,stopped=false,activeToken='';
let refreshing=false,refreshAgain=false,socketGeneration=0;
const messages=new Map(),elements=new Map(),photos=new Map(),photoJobs=new Map();
const area=$('messages-area');
const status=text=>$('status').textContent=text;
const ordered=()=>[...messages.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
const nearBottom=()=>area.scrollHeight-area.scrollTop-area.clientHeight<140;
function bottom(){area.scrollTop=area.scrollHeight;$('new-messages').hidden=true;}
function connection(text,live=false){$('connection').textContent=text;$('connection-dot').classList.toggle('live',live);}
function shape(m){return m&&typeof m.id==='string'&&typeof m.body==='string'&&typeof m.author_id==='string'&&typeof m.created_at==='string';}
async function access(){if(!GardenDB.chatAccess)throw new Error('Upload the updated database.js from the chat package. Keep your existing config.js.');return GardenDB.chatAccess();}
async function storage(path,{method='GET',body,contentType}={}){
 const a=await access();
 const headers={apikey:a.publicKey,Authorization:'Bearer '+a.accessToken};
 if(contentType)headers['Content-Type']=contentType;
 const response=await fetch(a.url+'/storage/v1/'+path,{method,headers,...(body!==undefined?{body}:{})});
 if(!response.ok){let error;try{error=await response.json();}catch(e){}throw new Error(error?.message||error?.error||'Photo request failed ('+response.status+').');}
 return response;
}
function safePath(path){if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(path))throw new Error('Invalid photo path.');return path.split('/').map(encodeURIComponent).join('/');}
async function getPhoto(path){
 if(photos.has(path))return photos.get(path);
 if(photoJobs.has(path))return photoJobs.get(path);
 const job=(async()=>{const response=await storage('object/authenticated/'+BUCKET+'/'+safePath(path));const blob=await response.blob();if(!TYPES[blob.type.split(';')[0]])throw new Error('Unsupported photo format.');const result={blob,url:URL.createObjectURL(blob)};photos.set(path,result);return result;})();
 photoJobs.set(path,job);try{return await job;}finally{photoJobs.delete(path);}
}
// Fetch only nearby photos, rather than downloading all conversation photos at once.
const photoObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){photoObserver.unobserve(entry.target);hydrate(entry.target);}}},{root:area,rootMargin:'250px'}):null;
let photoQueue=[],photoWorkers=0;
function hydrate(wrapper){if(wrapper.dataset.loaded==='yes'||wrapper.dataset.loading==='yes')return;wrapper.dataset.loading='yes';photoQueue.push(wrapper);drainPhotos();}
function drainPhotos(){while(photoWorkers<3&&photoQueue.length){const wrapper=photoQueue.shift();if(!wrapper.isConnected)continue;photoWorkers++;loadPhoto(wrapper).finally(()=>{photoWorkers--;drainPhotos();});}}
async function loadPhoto(wrapper){const m=messages.get(wrapper.dataset.id);if(!m?.image_path)return;try{const {url}=await getPhoto(m.image_path);if(!wrapper.isConnected)return;const img=document.createElement('img');img.className='message-photo';img.src=url;img.alt='Photo shared by '+(m.author_id===me.id?'you':otherName());img.width=300;img.height=225;img.style.height='auto';img.onclick=()=>openPhoto(m.id);const b=document.createElement('button');b.type='button';b.className='photo-retry';b.textContent='Open photo';b.onclick=()=>openPhoto(m.id);wrapper.replaceChildren(img);wrapper.dataset.loaded='yes';}catch(e){wrapper.replaceChildren();const text=document.createElement('div');text.className='photo-placeholder';text.textContent='Photo could not load.';const retry=document.createElement('button');retry.type='button';retry.className='photo-retry';retry.textContent='Try again';retry.onclick=()=>{wrapper.dataset.loading='';hydrate(wrapper);};wrapper.append(text,retry);}finally{wrapper.dataset.loading='';}}
function otherName(){return me.role==='faisal'?'Zehna':'Faisal';}
function openMenu(id){const m=messages.get(id);if(!m)return;menuID=id;$('menu-edit').hidden=m.author_id!==me.id;$('menu-copy').hidden=!m.body;$('menu-download').hidden=!m.image_path;$('message-menu').showModal();}
function messageElement(m){
 const mine=m.author_id===me.id;
 const row=document.createElement('article');row.className='message-row'+(mine?' mine':'');row.dataset.id=m.id;
 const bubble=document.createElement('div');bubble.className='bubble';
 const sender=document.createElement('div');sender.className='sender';sender.textContent=mine?'You':otherName();bubble.append(sender);
 if(m.image_path){const photo=document.createElement('div');photo.className='photo-wrapper';photo.dataset.id=m.id;const placeholder=document.createElement('div');placeholder.className='photo-placeholder';placeholder.textContent='Shared photo';placeholder.style.cssText='width:240px;max-width:100%;min-height:170px;display:grid;place-items:center';photo.append(placeholder);bubble.append(photo);}
 if(m.body){const text=document.createElement('p');text.className='body-text';text.textContent=m.body;bubble.append(text);}
 const meta=document.createElement('div');meta.className='message-meta';if(m.edited_at){const edited=document.createElement('span');edited.textContent='edited';meta.append(edited);}const time=document.createElement('time');time.dateTime=m.created_at;time.title=new Date(m.created_at).toLocaleString();time.textContent=new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(time);bubble.append(meta);
 if(m.image_path){const tools=document.createElement('div');tools.className='message-tools';const down=document.createElement('button');down.type='button';down.textContent='↓ Download';down.onclick=()=>downloadPhoto(m.id,down);tools.append(down);bubble.append(tools);}
 const more=document.createElement('button');more.type='button';more.className='more';more.textContent='⋮';more.title='Message options';more.setAttribute('aria-label','Options for '+(mine?'your message':'message from '+otherName()));more.onclick=()=>openMenu(m.id);
 row.append(bubble,more);
 bubble.addEventListener('contextmenu',e=>{if(window.getSelection()?.toString())return;e.preventDefault();openMenu(m.id);});
 let timer,startX,startY;
 bubble.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||e.target.closest('button'))return;startX=e.clientX;startY=e.clientY;timer=setTimeout(()=>{timer=null;if(!$('message-menu').open&&!$('photo-viewer').open)openMenu(m.id);},550);});
 const cancel=()=>{clearTimeout(timer);timer=null;};bubble.addEventListener('pointermove',e=>{if(Math.abs(e.clientX-startX)>12||Math.abs(e.clientY-startY)>12)cancel();});['pointerup','pointercancel','pointerleave'].forEach(t=>bubble.addEventListener(t,cancel));
 return row;
}
function render({forceBottom=false,preserve=false,notifyNew=false}={}){
 const stick=forceBottom||nearBottom(),oldHeight=area.scrollHeight,oldTop=area.scrollTop;
 // Reuse unchanged rows so photo loads, selection and native focus aren't reset.
 const sorted=ordered(),fragment=document.createDocumentFragment();let day='';
 for(const m of sorted){const date=new Date(m.created_at).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'});if(day!==date){day=date;const label=document.createElement('div');label.className='day-label';label.textContent=date;fragment.append(label);}const signature=JSON.stringify([m.body,m.edited_at,m.image_path]);let saved=elements.get(m.id);if(!saved||saved.signature!==signature){if(saved)for(const p of saved.node.querySelectorAll('.photo-wrapper'))photoObserver?.unobserve(p);saved={signature,node:messageElement(m)};elements.set(m.id,saved);}fragment.append(saved.node);}
 $('messages').replaceChildren(fragment);$('beginning').hidden=sorted.length>0;$('older').hidden=!hasOlder;
 for(const p of $('messages').querySelectorAll('.photo-wrapper')){if(p.dataset.loaded!=='yes'){if(photoObserver)photoObserver.observe(p);else hydrate(p);}}
 if(preserve)area.scrollTop=oldTop+(area.scrollHeight-oldHeight);else if(stick)bottom();else if(notifyNew) $('new-messages').hidden=false;
}
async function latest({initial=false}={}){
 if(refreshing){refreshAgain=true;return;}refreshing=true;
 try{const rows=await GardenDB.rest('chat_messages?select=*&order=created_at.desc,id.desc&limit='+BATCH);if(!Array.isArray(rows))throw new Error('Unexpected chat response.');let added=false;for(const m of rows)if(shape(m)){if(!messages.has(m.id))added=true;messages.set(m.id,m);}if(initial)hasOlder=rows.length===BATCH;render({forceBottom:initial,notifyNew:!initial&&added});}
 finally{refreshing=false;if(refreshAgain){refreshAgain=false;latest().catch(e=>status('Could not refresh: '+e.message));}}
}
$('older').onclick=async()=>{const first=ordered()[0];if(!first)return;const b=$('older');b.disabled=true;try{const filter=`(created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id}))`;const rows=await GardenDB.rest('chat_messages?select=*&order=created_at.desc,id.desc&limit='+BATCH+'&or='+encodeURIComponent(filter));hasOlder=rows.length===BATCH;for(const m of rows)if(shape(m))messages.set(m.id,m);render({preserve:true});}catch(e){status('Could not load older messages: '+e.message);}finally{b.disabled=false;}};
async function changed(payload){const data=payload?.data||payload;const record=data?.record||data?.new;if(record?.id){const rows=await GardenDB.rest('chat_messages?select=*&id=eq.'+encodeURIComponent(record.id));let added=false;for(const m of rows)if(shape(m)){if(!messages.has(m.id))added=true;messages.set(m.id,m);}render({notifyNew:added});}else await latest();}
function closeSocket(){clearInterval(heartbeat);clearInterval(tokenTimer);clearTimeout(watchdog);if(ws){const old=ws;ws=null;old.onclose=null;old.onerror=null;old.close();}}
function scheduleReconnect(){if(stopped)return;clearTimeout(reconnectTimer);const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5));connection('Reconnecting · periodic refresh active');reconnectTimer=setTimeout(connect,delay);}
async function connect(){if(stopped)return;const generation=++socketGeneration;closeSocket();connection('Connecting live updates…');try{const a=await access();if(stopped||generation!==socketGeneration)return;activeToken=a.accessToken;const socket=new WebSocket(a.url.replace(/^https:/,'wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(a.publicKey)+'&vsn=1.0.0');ws=socket;let ref=0,joined=false,lastPong=Date.now();const topic='realtime:private-garden-chat';
 const send=(event,payload,whichTopic=topic)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({topic:whichTopic,event,payload,ref:String(++ref)}));};
 watchdog=setTimeout(()=>{if(ws===socket&&!joined){socket.close();status('Live connection is taking too long. Periodic refresh is still active.');}},16000);
 socket.onopen=()=>{send('phx_join',{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'INSERT',schema:'public',table:'chat_messages'},{event:'UPDATE',schema:'public',table:'chat_messages'}]},access_token:a.accessToken});heartbeat=setInterval(()=>{if(Date.now()-lastPong>70000){socket.close();return;}send('heartbeat',{},'phoenix');},25000);tokenTimer=setInterval(async()=>{try{const next=await access();if(next.accessToken!==activeToken){activeToken=next.accessToken;send('access_token',{access_token:next.accessToken});}}catch(e){status(e.message);socket.close();}},45000);};
 socket.onmessage=e=>{if(ws!==socket)return;let msg;try{msg=JSON.parse(e.data);}catch(err){return;}if(msg.topic==='phoenix'&&msg.event==='phx_reply'){lastPong=Date.now();return;}if(msg.topic!==topic)return;if(msg.event==='phx_reply'&&!joined){if(msg.payload?.status==='ok'){const registrations=msg.payload?.response?.postgres_changes;const bad=Array.isArray(registrations)&&registrations.some(r=>r.error);if(bad){status('Realtime subscription was rejected. Check chat.sql and project Realtime settings.');socket.close();return;}joined=true;clearTimeout(watchdog);reconnectAttempt=0;connection('Live updates connected',true);latest().catch(err=>status(err.message));}else{status('Could not join live updates. Check Realtime settings; periodic refresh is active.');socket.close();}}else if(msg.event==='postgres_changes'){changed(msg.payload).catch(err=>status('Could not refresh message: '+err.message));}else if(msg.event==='system'&&msg.payload?.status==='error'){status('Live updates were interrupted. Check Realtime settings; periodic refresh is active.');socket.close();}else if(msg.event==='phx_error'||msg.event==='phx_close'){socket.close();}};
 socket.onerror=()=>{};socket.onclose=()=>{if(ws!==socket)return;closeSocket();scheduleReconnect();};
 }catch(e){status('Live connection unavailable: '+e.message);scheduleReconnect();}}
function resize(){const t=$('message');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,150)+'px';$('char-count').textContent=t.value.length+' / 4000';}
$('message').addEventListener('input',resize);
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!window.matchMedia('(pointer: coarse)').matches){e.preventDefault();if(!sending)$('composer').requestSubmit();}});
function clearPhoto(){if(draftURL)URL.revokeObjectURL(draftURL);draftURL=null;file=null;$('photo').value='';$('draft-image').removeAttribute('src');$('photo-draft').hidden=true;}
$('attach').onclick=()=>{if(!editing&&!sending)$('photo').click();};$('remove-photo').onclick=()=>{if(!sending)clearPhoto();};
$('photo').onchange=async()=>{const selected=$('photo').files?.[0];if(!selected)return;if(!TYPES[selected.type]){status('Choose a JPG, PNG, WebP or GIF photo. HEIC/SVG files are not supported.');$('photo').value='';return;}if(selected.size>MAX_PHOTO){status('That photo is larger than 10 MB. Please choose a smaller photo.');$('photo').value='';return;}if(!selected.size){status('That file is empty.');return;}try{const url=URL.createObjectURL(selected);const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('This file could not be read as a photo.'));img.src=url;}).finally(()=>URL.revokeObjectURL(url));if(dimensions.width*dimensions.height>40000000)throw new Error('Please resize this photo to below 40 megapixels first.');clearPhoto();file=selected;draftURL=URL.createObjectURL(file);$('draft-image').src=draftURL;$('draft-name').textContent=file.name;$('photo-draft').hidden=false;status('Photo ready. Add an optional caption, then Send.');}catch(e){$('photo').value='';status(e.message);}};
function cancelEdit(){editing=null;$('edit-banner').hidden=true;$('attach').disabled=false;$('message').value='';$('send').textContent='Send ↗';resize();}
$('cancel-edit').onclick=()=>{if(!sending)cancelEdit();};
function busy(value){sending=value;$('send').disabled=value;$('attach').disabled=value||!!editing;$('message').disabled=value;$('remove-photo').disabled=value;$('cancel-edit').disabled=value;}
async function cleanup(path){try{await storage('object/'+BUCKET,{method:'DELETE',body:JSON.stringify({prefixes:[path]}),contentType:'application/json'});}catch(e){/* Failed upload may remain private; owner can clean it from Storage. */}}
$('composer').onsubmit=async e=>{e.preventDefault();if(sending)return;const body=$('message').value.trim();const previous=editing?messages.get(editing):null;if(!body&&!file&&!previous?.image_path){status('Write a message or attach a photo first.');return;}busy(true);status(editing?'Saving your edit…':file?'Uploading photo…':'Sending…');let uploaded=null,id=null;
 try{if(editing){const result=await GardenDB.rest('chat_messages?id=eq.'+encodeURIComponent(editing),{method:'PATCH',body:{body},headers:{Prefer:'return=representation'}});if(!result?.length)throw new Error('This message could not be edited. You can edit only your own messages.');for(const m of result)messages.set(m.id,m);cancelEdit();render();status('Edit saved.');}
 else{id=crypto.randomUUID();if(file){uploaded=me.id+'/'+crypto.randomUUID()+'.'+TYPES[file.type];await storage('object/'+BUCKET+'/'+safePath(uploaded),{method:'POST',body:file,contentType:file.type});}
 const result=await GardenDB.rest('chat_messages',{method:'POST',body:{id,body,image_path:uploaded},headers:{Prefer:'return=representation'}});if(!result?.length)throw new Error('The server did not confirm the message.');for(const m of result)messages.set(m.id,m);$('message').value='';clearPhoto();resize();render({forceBottom:true});status('');}}
 catch(err){let confirmed=false,checked=false;if(id){try{const found=await GardenDB.rest('chat_messages?select=*&id=eq.'+encodeURIComponent(id));checked=true;if(found.length){confirmed=true;for(const m of found)messages.set(m.id,m);$('message').value='';clearPhoto();resize();render({forceBottom:true});status('Message sent.');}}catch(e){}}
 if(!confirmed){if(uploaded&&checked)await cleanup(uploaded);status(id&&!checked?'Could not confirm delivery. Refresh the conversation before sending again to avoid a duplicate.':'Could not save: '+err.message+' Your draft is still here.');}}
 finally{busy(false);$('message').focus();}
};
$('menu-close').onclick=()=>$('message-menu').close();
$('menu-edit').onclick=()=>{const m=messages.get(menuID);$('message-menu').close();if(!m||m.author_id!==me.id)return;if(sending){status('Wait for your current message to finish sending.');return;}if(($('message').value||file)&&!confirm('Replace your current unsent draft with this message to edit it?'))return;clearPhoto();editing=m.id;$('message').value=m.body;$('edit-banner').hidden=false;$('attach').disabled=true;$('send').textContent='Save edit';resize();$('message').focus();status(m.image_path?'Editing the photo caption. Sent photos cannot be replaced.':'');};
$('menu-copy').onclick=async()=>{const m=messages.get(menuID);$('message-menu').close();if(!m?.body)return;try{await navigator.clipboard.writeText(m.body);status('Message copied.');}catch(e){$('copy-text').value=m.body;$('copy-dialog').showModal();$('copy-text').select();}};$('copy-close').onclick=()=>$('copy-dialog').close();
async function downloadPhoto(id,button){const m=messages.get(id);if(!m?.image_path)return;if(button)button.disabled=true;try{status('Preparing photo download…');const p=await getPhoto(m.image_path);const link=document.createElement('a');link.href=p.url;link.download='our-photo-'+m.image_path.split('/').pop();document.body.append(link);link.click();link.remove();status('Download requested. On some phones, use the browser’s Save Image or share menu if prompted.');}catch(e){status('Could not download: '+e.message);}finally{if(button)button.disabled=false;}}
$('menu-download').onclick=()=>{const id=menuID;$('message-menu').close();downloadPhoto(id);};
async function openPhoto(id){const m=messages.get(id);if(!m?.image_path||$('message-menu').open)return;viewerID=id;try{const {url}=await getPhoto(m.image_path);$('full-photo').src=url;$('viewer-caption').textContent=m.body;$('photo-viewer').showModal();}catch(e){status('Could not open photo: '+e.message);}}
$('viewer-close').onclick=()=>$('photo-viewer').close();$('viewer-download').onclick=()=>downloadPhoto(viewerID,$('viewer-download'));
$('photo-viewer').addEventListener('close',()=>$('full-photo').removeAttribute('src'));
for(const id of ['message-menu','photo-viewer','copy-dialog']){$(id).addEventListener('click',e=>{const r=$(id).getBoundingClientRect();if(e.target===$(id)&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))$(id).close();});}
$('new-messages').onclick=bottom;area.addEventListener('scroll',()=>{if(nearBottom())$('new-messages').hidden=true;},{passive:true});
function stop(){stopped=true;socketGeneration++;clearInterval(pollTimer);clearTimeout(reconnectTimer);closeSocket();for(const p of photos.values())URL.revokeObjectURL(p.url);photos.clear();if(draftURL)URL.revokeObjectURL(draftURL);}
$('signout').onclick=async()=>{if(sending){status('Please wait until sending finishes before signing out.');return;}stop();$('private-content').hidden=true;try{await GardenDB.logout();}finally{location.reload();}};
window.addEventListener('pagehide',stop);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
window.addEventListener('online',()=>{if(!me||stopped)return;latest().catch(e=>status(e.message));clearTimeout(reconnectTimer);connect();});window.addEventListener('offline',()=>connection('Offline · your draft is still here'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&me&&!stopped){latest().catch(e=>status(e.message));if(!ws||ws.readyState!==WebSocket.OPEN){clearTimeout(reconnectTimer);connect();}}});
(async()=>{me=await GardenDB.begin();try{await access();await latest({initial:true});await connect();pollTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!stopped)latest().catch(e=>{connection('Connection interrupted');status('Could not refresh: '+e.message);});},12000);}catch(e){status('Chat is not ready: '+e.message+' Run the chat.sql add-on in Supabase, then reload.');connection('Not connected');}})();
