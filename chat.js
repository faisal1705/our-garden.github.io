'use strict';
const $=id=>document.getElementById(id);
const BUCKET='garden-chat-photos',BATCH=60,MAX_PHOTO=10*1024*1024;
let voiceDraft=null,voiceRecording=false,voiceFinishing=false,micPending=false,voiceRecorder=null,voiceStream=null,voiceTick=null,voiceGeneration=0;
const voiceFiles=new Map(),voiceJobs=new Map();
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
let replying=null,draftBeforeEdit=null;
const extraRecords=new Map(),replyFetches=new Set();
const record=id=>messages.get(id)||extraRecords.get(id);
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
async function loadPhoto(wrapper){const m=record(wrapper.dataset.id);if(!m?.image_path)return;try{const {url}=await getPhoto(m.image_path);if(!wrapper.isConnected)return;const img=document.createElement('img');img.className='message-photo';img.src=url;img.alt='Photo shared by '+(m.author_id===me.id?'you':otherName());img.width=300;img.height=225;img.style.height='auto';img.onclick=()=>openPhoto(m.id);const b=document.createElement('button');b.type='button';b.className='photo-retry';b.textContent='Open photo';b.onclick=()=>openPhoto(m.id);wrapper.replaceChildren(img);wrapper.dataset.loaded='yes';}catch(e){wrapper.replaceChildren();const text=document.createElement('div');text.className='photo-placeholder';text.textContent='Photo could not load.';const retry=document.createElement('button');retry.type='button';retry.className='photo-retry';retry.textContent='Try again';retry.onclick=()=>{wrapper.dataset.loading='';hydrate(wrapper);};wrapper.append(text,retry);}finally{wrapper.dataset.loading='';}}
function otherName(){return me.role==='faisal'?'Zehna':'Faisal';}
function openMenu(id){const m=record(id);if(!m)return;menuID=id;$('menu-edit').hidden=m.author_id!==me.id||!!m.audio_path&&!m.body;$('menu-download-voice').hidden=!m.audio_path;$('menu-copy').hidden=!m.body;$('menu-download').hidden=!m.image_path;$('message-menu').showModal();}
function messageElement(m){
 const mine=m.author_id===me.id;
 const row=document.createElement('article');row.className='message-row'+(mine?' mine':'');row.dataset.id=m.id;
 const bubble=document.createElement('div');bubble.className='bubble';
 const sender=document.createElement('div');sender.className='sender';sender.textContent=mine?'You':otherName();bubble.append(sender);
 if(m.reply_to)bubble.append(replyQuote(m.reply_to));
 if(m.image_path){const photo=document.createElement('div');photo.className='photo-wrapper';photo.dataset.id=m.id;const placeholder=document.createElement('div');placeholder.className='photo-placeholder';placeholder.textContent='Shared photo';placeholder.style.cssText='width:240px;max-width:100%;min-height:170px;display:grid;place-items:center';photo.append(placeholder);bubble.append(photo);}
 if(m.audio_path)bubble.append(voiceMessageElement(m));
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
 const root=$('messages'),sorted=ordered(),desired=[];const dayLabels=new Map([...root.querySelectorAll('.day-label')].map(node=>[node.textContent,node]));let day='';
 for(const m of sorted){const date=new Date(m.created_at).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'});if(day!==date){day=date;const label=dayLabels.get(date)||document.createElement('div');label.className='day-label';label.textContent=date;desired.push(label);}const parent=m.reply_to?record(m.reply_to):null;const signature=JSON.stringify([m.body,m.edited_at,m.image_path,m.audio_path,m.audio_seconds,m.reply_to,parent?.body,parent?.edited_at,parent?.image_path,parent?.audio_path]);let saved=elements.get(m.id);if(!saved||saved.signature!==signature){if(saved)for(const p of saved.node.querySelectorAll('.photo-wrapper'))photoObserver?.unobserve(p);saved={signature,node:messageElement(m)};elements.set(m.id,saved);}desired.push(saved.node);}
 const wanted=new Set(desired);for(const child of [...root.childNodes])if(!wanted.has(child))child.remove();let cursor=root.firstChild;for(const node of desired){if(node===cursor)cursor=cursor.nextSibling;else root.insertBefore(node,cursor);}$('beginning').hidden=sorted.length>0;$('older').hidden=!hasOlder;
 for(const p of $('messages').querySelectorAll('.photo-wrapper')){if(p.dataset.loaded!=='yes'){if(photoObserver)photoObserver.observe(p);else hydrate(p);}}
 fetchReplyContexts();
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
$('message').addEventListener('input',()=>{resize();saveDraft();});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!window.matchMedia('(pointer: coarse)').matches){e.preventDefault();if(!sending)$('composer').requestSubmit();}});
function clearPhoto(){if(draftURL)URL.revokeObjectURL(draftURL);draftURL=null;file=null;$('photo').value='';$('draft-image').removeAttribute('src');$('photo-draft').hidden=true;}
$('attach').onclick=()=>{if(voiceRecording||voiceFinishing||micPending||voiceDraft){status('Send or discard your voice recording before attaching a photo.');return;}if(!editing&&!sending)$('photo').click();};$('remove-photo').onclick=()=>{if(!sending){clearPhoto();saveDraft();}};
$('photo').onchange=async()=>{if(voiceRecording||voiceFinishing||micPending||voiceDraft){$('photo').value='';return;}const selected=$('photo').files?.[0];if(!selected)return;if(!TYPES[selected.type]){status('Choose a JPG, PNG, WebP or GIF photo. HEIC/SVG files are not supported.');$('photo').value='';return;}if(selected.size>MAX_PHOTO){status('That photo is larger than 10 MB. Please choose a smaller photo.');$('photo').value='';return;}if(!selected.size){status('That file is empty.');return;}try{const url=URL.createObjectURL(selected);const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('This file could not be read as a photo.'));img.src=url;}).finally(()=>URL.revokeObjectURL(url));if(dimensions.width*dimensions.height>40000000)throw new Error('Please resize this photo to below 40 megapixels first.');if(voiceRecording||voiceFinishing||micPending||voiceDraft||sending)return;clearPhoto();file=selected;draftURL=URL.createObjectURL(file);$('draft-image').src=draftURL;$('draft-name').textContent=file.name;$('photo-draft').hidden=false;status('Photo ready. Add an optional caption, then Send.');saveDraft();}catch(e){$('photo').value='';status(e.message);}};
function cancelEdit(){editing=null;$('edit-banner').hidden=true;$('attach').disabled=false;const previousDraft=draftBeforeEdit;draftBeforeEdit=null;$('message').value=previousDraft?.body||'';replying=previousDraft?.reply_to||null;$('send').textContent='Send ↗';renderReplyBanner();resize();saveDraft();syncVoiceControls();}
$('cancel-edit').onclick=()=>{if(!sending)cancelEdit();};
function busy(value){sending=value;syncVoiceControls();$('message').disabled=value;$('remove-photo').disabled=value;$('cancel-edit').disabled=value;$('cancel-reply').disabled=value;}
async function cleanup(path){try{await storage('object/'+BUCKET,{method:'DELETE',body:JSON.stringify({prefixes:[path]}),contentType:'application/json'});}catch(e){/* Failed upload may remain private; owner can clean it from Storage. */}}
$('composer').onsubmit=async e=>{
 e.preventDefault();if(sending)return;if(voiceRecording||voiceFinishing||micPending){status('Stop the recording and listen before sending.');return;}
 const body=$('message').value.trim(),previous=editing?record(editing):null;
 if(!body&&!file&&!voiceDraft&&!previous?.image_path&&!previous?.audio_path){status('Write a message, attach a photo, or record your voice first.');return;}
 busy(true);status(editing?'Saving your edit…':voiceDraft?'Uploading your voice message…':file?'Uploading photo…':'Sending…');
 let uploaded=null,uploadBucket=BUCKET,id=null;
 function complete(result){for(const m of result)messages.set(m.id,m);$('message').value='';replying=null;clearPhoto();clearVoice();renderReplyBanner();resize();saveDraft();render({forceBottom:true});}
 try{
  if(editing){const result=await GardenDB.rest('chat_messages?id=eq.'+encodeURIComponent(editing),{method:'PATCH',body:{body},headers:{Prefer:'return=representation'}});if(!result?.length)throw new Error('Only your own message or caption can be edited.');for(const m of result){if(messages.has(m.id))messages.set(m.id,m);else extraRecords.set(m.id,m);}cancelEdit();render();status('Edit saved.');}
  else{
   id=crypto.randomUUID();let image_path=null,audio_path=null,audio_seconds=null;
   if(voiceDraft){uploadBucket=VOICE_BUCKET;uploaded=me.id+'/'+crypto.randomUUID()+'.'+voiceDraft.ext;await storage('object/'+VOICE_BUCKET+'/'+safeVoicePath(uploaded),{method:'POST',body:voiceDraft.blob,contentType:voiceDraft.type});audio_path=uploaded;audio_seconds=voiceDraft.seconds;}
   else if(file){uploaded=me.id+'/'+crypto.randomUUID()+'.'+TYPES[file.type];await storage('object/'+BUCKET+'/'+safePath(uploaded),{method:'POST',body:file,contentType:file.type});image_path=uploaded;}
   const result=await GardenDB.rest('chat_messages',{method:'POST',body:{id,body,image_path,audio_path,audio_seconds,reply_to:replying},headers:{Prefer:'return=representation'}});
   if(!result?.length)throw new Error('The server did not confirm your message.');complete(result);status('');
  }
 }catch(err){let confirmed=false,checked=false;
  if(id){try{const found=await GardenDB.rest('chat_messages?select=*&id=eq.'+encodeURIComponent(id));checked=true;if(found.length){confirmed=true;complete(found);status('Message sent.');}}catch(e){}}
  if(!confirmed){if(uploaded&&checked)await cleanupAttachment(uploaded,uploadBucket);status(id&&!checked?'Could not confirm delivery. Refresh the conversation before sending again to avoid a duplicate. Unsent audio will be lost if you reload.':'Could not save: '+err.message+' Your draft is still here.');}
 }finally{busy(false);$('message').focus();}
};
async function cleanupAttachment(path,bucket){try{await storage('object/'+bucket,{method:'DELETE',body:JSON.stringify({prefixes:[path]}),contentType:'application/json'});}catch(e){/* Private unreferenced upload can be cleaned up by the project owner. */}}

$('menu-close').onclick=()=>$('message-menu').close();
$('menu-edit').onclick=()=>{const m=record(menuID);$('message-menu').close();if(!m||m.author_id!==me.id)return;if(sending||voiceRecording||voiceFinishing||micPending){status('Finish sending or stop recording first.');return;}if((file||voiceDraft)&&!confirm('Editing removes your unsent attachment. Continue?'))return;if(!editing)draftBeforeEdit={body:$('message').value,reply_to:replying};for(const name of ['search-dialog','gallery-dialog'])if($(name).open)$(name).close();clearPhoto();clearVoice();replying=null;renderReplyBanner();editing=m.id;$('message').value=m.body;$('edit-banner').hidden=false;$('attach').disabled=true;syncVoiceControls();$('send').textContent='Save edit';resize();$('message').focus();status(m.image_path?'Editing the photo caption. Sent photos cannot be replaced.':'');};
$('menu-copy').onclick=async()=>{const m=record(menuID);$('message-menu').close();if(!m?.body)return;try{await navigator.clipboard.writeText(m.body);status('Message copied.');}catch(e){$('copy-text').value=m.body;$('copy-dialog').showModal();$('copy-text').select();}};$('copy-close').onclick=()=>$('copy-dialog').close();
async function downloadPhoto(id,button){const m=record(id);if(!m?.image_path)return;if(button)button.disabled=true;try{status('Preparing photo download…');const p=await getPhoto(m.image_path);const link=document.createElement('a');link.href=p.url;link.download='our-photo-'+m.image_path.split('/').pop();document.body.append(link);link.click();link.remove();status('Download requested. On some phones, use the browser’s Save Image or share menu if prompted.');}catch(e){status('Could not download: '+e.message);}finally{if(button)button.disabled=false;}}
$('menu-download').onclick=()=>{const id=menuID;$('message-menu').close();downloadPhoto(id);};
async function openPhoto(id){const m=record(id);if(!m?.image_path||$('message-menu').open)return;viewerID=id;try{const {url}=await getPhoto(m.image_path);$('full-photo').src=url;$('viewer-caption').textContent=m.body;$('photo-viewer').showModal();}catch(e){status('Could not open photo: '+e.message);}}
$('viewer-close').onclick=()=>$('photo-viewer').close();$('viewer-download').onclick=()=>downloadPhoto(viewerID,$('viewer-download'));
$('photo-viewer').addEventListener('close',()=>$('full-photo').removeAttribute('src'));
for(const id of ['message-menu','photo-viewer','copy-dialog']){$(id).addEventListener('click',e=>{const r=$(id).getBoundingClientRect();if(e.target===$(id)&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))$(id).close();});}
$('new-messages').onclick=bottom;area.addEventListener('scroll',()=>{if(nearBottom())$('new-messages').hidden=true;},{passive:true});
function stop(){saveDraft();stopped=true;discardVoice(false);socketGeneration++;clearInterval(pollTimer);clearTimeout(reconnectTimer);closeSocket();for(const p of photos.values())URL.revokeObjectURL(p.url);photos.clear();for(const v of voiceFiles.values())URL.revokeObjectURL(v.url);voiceFiles.clear();if(draftURL)URL.revokeObjectURL(draftURL);}
$('signout').onclick=async()=>{if(sending||voiceRecording||voiceFinishing||micPending){status('Stop recording and wait for sending to finish before signing out.');return;}stop();$('private-content').hidden=true;try{await GardenDB.logout();}finally{location.reload();}};
window.addEventListener('pagehide',stop);window.addEventListener('beforeunload',saveDraft);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
window.addEventListener('online',()=>{if(!me||stopped)return;latest().catch(e=>status(e.message));clearTimeout(reconnectTimer);connect();});window.addEventListener('offline',()=>connection('Offline · your draft is still here'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&me&&!stopped){latest().catch(e=>status(e.message));if(!ws||ws.readyState!==WebSocket.OPEN){clearTimeout(reconnectTimer);connect();}}});
// Replies, database-wide search, private gallery and account-scoped text drafts.
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missingReplies=new Set();
function excerpt(m){return m?(m.audio_path?'🎙 Voice message'+(m.body?' · ':''):(m.image_path?'📷 Photo'+(m.body?' · ':''):''))+(m.body||'').slice(0,170):'Original message unavailable';}
function replyQuote(id){const parent=record(id);const quote=document.createElement('blockquote');quote.className='reply-quote';const author=document.createElement('strong');author.textContent=parent?(parent.author_id===me.id?'You':otherName()):'Reply';const preview=document.createElement('span');preview.textContent=parent?excerpt(parent):(missingReplies.has(id)?'Original message unavailable':'Loading original message…');quote.append(author,preview);return quote;}
async function fetchContext(id){if(!uuidPattern.test(id)||record(id)||missingReplies.has(id)||replyFetches.has(id))return;replyFetches.add(id);try{const found=await GardenDB.rest('chat_messages?select=*&id=eq.'+encodeURIComponent(id));if(found.length&&shape(found[0]))extraRecords.set(id,found[0]);else missingReplies.add(id);render();renderReplyBanner();}catch(e){/* A reconnect/render can retry without interrupting typing. */}finally{replyFetches.delete(id);}}
function fetchReplyContexts(){for(const m of messages.values())if(m.reply_to)fetchContext(m.reply_to);if(replying)fetchContext(replying);}
function renderReplyBanner(){const parent=replying?record(replying):null;$('reply-banner').hidden=!replying;if(replying){$('reply-author').textContent='Replying to '+(parent?(parent.author_id===me.id?'yourself':otherName()):'a message');$('reply-preview').textContent=parent?excerpt(parent):'Original message unavailable';}}
function startReply(id){if(sending||voiceRecording||voiceFinishing||micPending){status('Wait for the current message to finish sending.');return;}const m=record(id);if(!m)return;for(const name of ['search-dialog','gallery-dialog'])if($(name).open)$(name).close();if(editing)cancelEdit();replying=id;renderReplyBanner();saveDraft();$('message').focus();}
$('clear-draft').onclick=()=>{if(sending||voiceRecording||voiceFinishing||micPending)return;if(editing){status('Cancel editing before clearing your unsent draft.');return;}if(($('message').value||file||voiceDraft||replying)&&!confirm('Clear your unsent draft on this device?'))return;$('message').value='';replying=null;clearPhoto();clearVoice();renderReplyBanner();resize();saveDraft();status('Your unsent draft was cleared.');};
$('menu-reply').onclick=()=>{const id=menuID;$('message-menu').close();startReply(id);};
$('cancel-reply').onclick=()=>{if(sending)return;replying=null;renderReplyBanner();saveDraft();};
function draftKey(){return me?'garden-chat-draft-v2:'+me.id+':'+location.pathname:null;}
function saveDraft(){const key=draftKey();if(!key)return;const current=editing?(draftBeforeEdit||{body:'',reply_to:null}):{body:$('message').value,reply_to:replying,hadPhoto:!!file,hadVoice:!!voiceDraft||voiceRecording||voiceFinishing};try{if(current.body||current.reply_to||current.hadPhoto||current.hadVoice){localStorage.setItem(key,JSON.stringify({body:current.body||'',reply_to:current.reply_to||null,hadPhoto:!!current.hadPhoto,hadVoice:!!current.hadVoice,saved_at:Date.now()}));$('draft-status').textContent='Draft saved · ';}else{localStorage.removeItem(key);$('draft-status').textContent='';}}catch(e){$('draft-status').textContent='Draft not saved · ';}}
function restoreDraft(){try{const raw=localStorage.getItem(draftKey());if(!raw)return;const draft=JSON.parse(raw);if(!draft||typeof draft.body!=='string'||draft.body.length>4000)return;$('message').value=draft.body;replying=typeof draft.reply_to==='string'&&uuidPattern.test(draft.reply_to)?draft.reply_to:null;resize();renderReplyBanner();if(replying)fetchContext(replying);$('draft-status').textContent='Draft restored · ';status(draft.hadVoice?'Your text draft was restored. Unsent audio is not saved; record your voice message again.':draft.hadPhoto?'Your text draft was restored. Please reattach the unsent photo.':'Your unsent text draft was restored from this device.');}catch(e){$('draft-status').textContent='Draft unavailable · ';}}

let searchSequence=0,searchTimer,searchItems=[],searchTerm='',searchHasMore=false,searchLoading=false;
function detailsHeader(m){const line=document.createElement('div');line.className='result-meta';line.textContent=(m.author_id===me.id?'You':otherName())+' · '+new Date(m.created_at).toLocaleString()+(m.edited_at?' · edited':'');return line;}
function resultActions(m){const bar=document.createElement('div');bar.className='result-actions';const reply=document.createElement('button');reply.type='button';reply.textContent='↩ Reply';reply.onclick=()=>{if($('search-dialog').open)$('search-dialog').close();startReply(m.id);};const options=document.createElement('button');options.type='button';options.textContent='Options ⋮';options.onclick=()=>openMenu(m.id);bar.append(reply,options);if(m.audio_path){const dl=document.createElement('button');dl.type='button';dl.textContent='↓ Download voice';dl.onclick=()=>downloadVoice(m.id,dl);bar.append(dl);}if(m.image_path){const view=document.createElement('button');view.type='button';view.textContent='View photo';view.onclick=()=>openPhoto(m.id);bar.append(view);}return bar;}
function renderSearch(){const root=$('search-results');root.replaceChildren();for(const m of searchItems){const item=document.createElement('article');item.className='search-result';const text=document.createElement('p');text.textContent=m.body;item.append(detailsHeader(m));if(m.audio_path)item.append(voiceMessageElement(m));item.append(text,resultActions(m));root.append(item);}$('search-more').hidden=!searchHasMore;$('search-status').textContent=searchItems.length?searchItems.length+' matches shown'+(searchHasMore?' · more available':''):'No matching words yet. Try another search.';}
async function searchMessages(more=false){const query=$('search-query').value.trim();if(!query){searchSequence++;searchItems=[];$('search-results').replaceChildren();$('search-more').hidden=true;$('search-status').textContent='Search all saved messages and photo captions.';return;}if(more&&(searchLoading||!searchHasMore))return;const seq=++searchSequence;searchLoading=true;$('search-more').disabled=true;$('search-status').textContent='Looking through your saved words…';if(!more){searchItems=[];searchTerm=query;$('search-results').replaceChildren();}const last=more?searchItems.at(-1):null;try{const rows=await GardenDB.rest('rpc/search_chat_messages',{method:'POST',body:{search_text:query,before_time:last?.created_at||null,before_id:last?.id||null}});if(seq!==searchSequence)return;if(!Array.isArray(rows))throw new Error('Unexpected search response.');searchHasMore=rows.length===40;for(const m of rows)if(shape(m)){extraRecords.set(m.id,m);if(!searchItems.some(x=>x.id===m.id))searchItems.push(m);}renderSearch();}catch(e){if(seq===searchSequence)$('search-status').textContent='Search could not load: '+e.message+' Check that chat-features.sql ran successfully.';}finally{if(seq===searchSequence){searchLoading=false;$('search-more').disabled=false;}}}
$('open-search').onclick=()=>{$('search-dialog').showModal();$('search-query').focus();if($('search-query').value.trim())searchMessages();};
$('search-form').onsubmit=e=>{e.preventDefault();clearTimeout(searchTimer);searchMessages();};
$('search-query').oninput=()=>{clearTimeout(searchTimer);searchSequence++;$('search-more').hidden=true;searchTimer=setTimeout(()=>searchMessages(),320);};
$('search-more').onclick=()=>searchMessages(true);

let galleryItems=[],galleryLoading=false,galleryHasMore=false;
const galleryObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){galleryObserver.unobserve(entry.target);hydrate(entry.target);}},{root:$('gallery-dialog'),rootMargin:'200px'}):null;
function renderGallery(){const root=$('gallery-grid');for(const m of galleryItems){if(root.querySelector('[data-gallery-id="'+m.id+'"]'))continue;const card=document.createElement('article');card.className='gallery-card';card.dataset.galleryId=m.id;const wrapper=document.createElement('div');wrapper.className='photo-wrapper gallery-photo';wrapper.dataset.id=m.id;const placeholder=document.createElement('div');placeholder.className='photo-placeholder';placeholder.textContent='Shared photo';wrapper.append(placeholder);const caption=document.createElement('p');caption.textContent=m.body||'A little moment.';const actions=document.createElement('div');actions.className='result-actions';const view=document.createElement('button');view.type='button';view.textContent='Open';view.onclick=()=>openPhoto(m.id);const down=document.createElement('button');down.type='button';down.textContent='↓ Download';down.onclick=()=>downloadPhoto(m.id,down);actions.append(view,down);card.append(wrapper,detailsHeader(m),caption,actions);root.append(card);if(galleryObserver)galleryObserver.observe(wrapper);else hydrate(wrapper);}$('gallery-more').hidden=!galleryHasMore;$('gallery-status').textContent=galleryItems.length?galleryItems.length+' photos shown'+(galleryHasMore?' · earlier photos available':'')+' · private to the two of you':'Your shared photos will appear here.';}
async function loadGallery(more=false){if(galleryLoading)return;galleryLoading=true;$('gallery-more').disabled=true;$('gallery-status').textContent='Opening your little album…';if(!more){galleryItems=[];galleryObserver?.disconnect();$('gallery-grid').replaceChildren();}const last=more?galleryItems.at(-1):null;let path='chat_messages?select=*&image_path=not.is.null&order=created_at.desc,id.desc&limit=24';if(last){const filter=`(created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id}))`;path+='&or='+encodeURIComponent(filter);}try{const rows=await GardenDB.rest(path);galleryHasMore=rows.length===24;for(const m of rows)if(shape(m)&&m.image_path){extraRecords.set(m.id,m);if(!galleryItems.some(x=>x.id===m.id))galleryItems.push(m);}renderGallery();}catch(e){$('gallery-status').textContent='Could not load photos: '+e.message;}finally{galleryLoading=false;$('gallery-more').disabled=false;}}
$('open-gallery').onclick=()=>{$('gallery-dialog').showModal();loadGallery();};$('gallery-more').onclick=()=>loadGallery(true);
for(const b of document.querySelectorAll('[data-close-feature]'))b.onclick=()=>$(b.dataset.closeFeature).close();
for(const id of ['search-dialog','gallery-dialog'])$(id).addEventListener('click',e=>{const rect=$(id).getBoundingClientRect();if(e.target===$(id)&&(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom))$(id).close();});

// Native microphone recording. No external audio library or public media URLs.
const VOICE_BUCKET='garden-chat-voice',MAX_VOICE=8*1024*1024,VOICE_LIMIT=120;
const VOICE_TYPES={'audio/mp4':'m4a','audio/x-m4a':'m4a','audio/webm':'webm','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav'};
let voiceSupported=false,recordStarted=0,recordedSeconds=0,recordDiscarded=false;
function voiceTime(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
function checkRecordingSupport(){voiceSupported=!!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);syncVoiceControls();if(!voiceSupported)$('microphone').title='Recording requires HTTPS and a browser with microphone recording support. You can still receive voice messages.';}
function syncVoiceControls(){
 $('send').disabled=sending||voiceRecording||voiceFinishing||micPending;
 $('attach').disabled=sending||!!editing||voiceRecording||voiceFinishing||micPending||!!voiceDraft;
 $('microphone').disabled=sending||!!editing||voiceFinishing||micPending||!voiceSupported;
 $('microphone').classList.toggle('is-recording',voiceRecording);
 $('microphone').setAttribute('aria-label',voiceRecording?'Stop recording':'Record a voice message');
 $('voice-stop').disabled=sending||micPending||!voiceRecording;
 $('voice-discard').disabled=sending;
}
function releaseMicrophone(){if(voiceStream){for(const track of voiceStream.getTracks())track.stop();voiceStream=null;}clearInterval(voiceTick);voiceTick=null;}
function clearVoice(){if(voiceDraft?.url)URL.revokeObjectURL(voiceDraft.url);voiceDraft=null;$('voice-preview').pause();$('voice-preview').removeAttribute('src');$('voice-preview').hidden=true;$('voice-draft').hidden=true;syncVoiceControls();}
function stopVoice(){if(!voiceRecording)return;recordedSeconds=Math.min(VOICE_LIMIT,Math.max(.1,(performance.now()-recordStarted)/1000));voiceRecording=false;voiceFinishing=true;clearInterval(voiceTick);voiceTick=null;$('voice-label').textContent='Preparing your recording…';try{if(voiceRecorder?.state!=='inactive')voiceRecorder.stop();}catch(e){voiceFinishing=false;status('Could not finish recording: '+e.message);}finally{releaseMicrophone();syncVoiceControls();}}
function discardVoice(announce=true){voiceGeneration++;recordDiscarded=true;micPending=false;if(voiceRecording)stopVoice();releaseMicrophone();voiceRecording=false;voiceFinishing=false;clearVoice();if(announce){saveDraft();status('Recording discarded. Nothing was sent.');}}
async function startVoice(){
 if(sending||editing||voiceFinishing||micPending)return;if(voiceRecording){stopVoice();return;}
 if(!voiceSupported){status('Your browser cannot record here. Use HTTPS in a recent Chrome, Edge, Firefox or Safari browser, and allow microphone access.');return;}
 if(file){status('Send or remove your selected photo before recording a voice message.');return;}
 if(voiceDraft&&!confirm('Discard this unsent recording and record a new one?'))return;
 clearVoice();const generation=++voiceGeneration;micPending=true;recordDiscarded=false;recordedSeconds=0;
 $('voice-draft').hidden=false;$('voice-label').textContent='Waiting for microphone permission…';$('voice-timer').textContent='0:00 / 2:00';$('voice-stop').hidden=false;$('voice-help').textContent='Allow microphone access. Nothing is uploaded until you press Send.';syncVoiceControls();
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(generation!==voiceGeneration||stopped){for(const t of stream.getTracks())t.stop();return;}if(document.visibilityState==='hidden'){for(const t of stream.getTracks())t.stop();throw new Error('Return to the visible chat before recording.');}voiceStream=stream;
  const choices=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm'];
  const type=choices.find(t=>MediaRecorder.isTypeSupported?.(t));
  let recorder;try{recorder=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:64000});}catch(e){recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);}
  voiceRecorder=recorder;const chunks=[];let totalBytes=0,tooLarge=false;
  recorder.ondataavailable=e=>{if(generation!==voiceGeneration)return;if(e.data?.size){totalBytes+=e.data.size;if(totalBytes<=MAX_VOICE)chunks.push(e.data);else tooLarge=true;}if(tooLarge&&voiceRecording){status('Recording reached the 8 MB size limit.');stopVoice();}};
  recorder.onerror=e=>{if(generation!==voiceGeneration)return;recordDiscarded=true;status('Microphone recording failed. Please try again.');if(voiceRecording)stopVoice();releaseMicrophone();clearVoice();};
  recorder.onstop=()=>{
   if(generation!==voiceGeneration){for(const track of stream.getTracks())track.stop();return;}
   releaseMicrophone();voiceRecording=false;voiceFinishing=false;voiceRecorder=null;
   if(generation!==voiceGeneration||recordDiscarded||stopped){syncVoiceControls();return;}
   const mime=(recorder.mimeType||chunks[0]?.type||'').split(';')[0].trim().toLowerCase();
   if(!VOICE_TYPES[mime]||tooLarge||!totalBytes||recordedSeconds<.25){clearVoice();status(tooLarge?'Recording was too large. Please try a shorter message.':!VOICE_TYPES[mime]?'This browser recorded an unsupported audio format. Try a recent Chrome or Safari.':'That recording was too short. Please try again.');return;}
   const blob=new Blob(chunks,{type:mime});voiceDraft={blob,type:mime,ext:VOICE_TYPES[mime],seconds:Math.round(recordedSeconds*100)/100,url:URL.createObjectURL(blob)};
   $('voice-draft').hidden=false;$('voice-label').textContent='Your voice, ready to send';$('voice-timer').textContent=voiceTime(voiceDraft.seconds);$('voice-stop').hidden=true;$('voice-preview').src=voiceDraft.url;$('voice-preview').hidden=false;$('voice-help').textContent='Listen first. Add an optional caption below, then Send — or Discard.';syncVoiceControls();saveDraft();status('Recording ready. It has not been sent yet.');
  };
  for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>{if(voiceRecording){status('Microphone stopped. Your recording will be prepared if available.');stopVoice();}},{once:true});
  micPending=false;voiceRecording=true;recordStarted=performance.now();recorder.start(1000);
  $('voice-label').textContent='Recording your voice…';$('voice-help').textContent='Maximum 2 minutes. Stop to preview; Discard to cancel.';syncVoiceControls();saveDraft();
  voiceTick=setInterval(()=>{const elapsed=(performance.now()-recordStarted)/1000;$('voice-timer').textContent=voiceTime(Math.min(VOICE_LIMIT,elapsed))+' / 2:00';if(elapsed>=VOICE_LIMIT)stopVoice();},200);
 }catch(e){if(generation!==voiceGeneration)return;micPending=false;voiceRecording=false;voiceFinishing=false;voiceRecorder=null;releaseMicrophone();clearVoice();const reason=e.name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser’s site permissions and try again.':e.name==='NotFoundError'?'No microphone was found on this device.':e.name==='NotReadableError'?'The microphone is unavailable or in use by another app.':'Could not start recording: '+e.message;status(reason);}
 finally{if(generation===voiceGeneration){micPending=false;syncVoiceControls();}}
}
$('microphone').onclick=startVoice;$('voice-stop').onclick=stopVoice;$('voice-discard').onclick=()=>discardVoice(true);
// Stop capture when the tab is hidden: avoids unnoticed background recording
// and mobile timer suspension extending a recording beyond the intended limit.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&voiceRecording){stopVoice();status('Recording stopped because the chat moved to the background. Preview it when you return.');}});
function safeVoicePath(path){if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webm|m4a|ogg|wav)$/.test(path))throw new Error('Invalid voice recording path.');return path.split('/').map(encodeURIComponent).join('/');}
async function getVoice(path){if(voiceFiles.has(path))return voiceFiles.get(path);if(voiceJobs.has(path))return voiceJobs.get(path);const job=(async()=>{const response=await storage('object/authenticated/'+VOICE_BUCKET+'/'+safeVoicePath(path));const blob=await response.blob();if(!VOICE_TYPES[blob.type.split(';')[0].toLowerCase()])throw new Error('Unsupported voice recording format.');const entry={blob,url:URL.createObjectURL(blob)};voiceFiles.set(path,entry);return entry;})();voiceJobs.set(path,job);try{return await job;}finally{voiceJobs.delete(path);}}
function voiceMessageElement(m){const wrap=document.createElement('div');wrap.className='voice-message';const title=document.createElement('div');title.className='voice-title';title.textContent='🎙 Voice message · '+voiceTime(m.audio_seconds);const load=document.createElement('button');load.type='button';load.className='voice-load';load.textContent='▶ Load & play';load.onclick=async()=>{load.disabled=true;load.textContent='Loading…';try{const v=await getVoice(m.audio_path);const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=v.url;player.setAttribute('aria-label','Voice message from '+(m.author_id===me.id?'you':otherName()));player.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==player)other.pause();});player.onerror=()=>status('This browser could not play that audio format. Try downloading it or using a recent browser.');load.replaceWith(player);try{await player.play();}catch(e){status('Voice message loaded. Tap its play button to listen.');}}catch(e){load.disabled=false;load.textContent='Retry loading';status('Could not load voice message: '+e.message);}};const down=document.createElement('button');down.type='button';down.className='voice-download';down.textContent='↓ Download';down.onclick=()=>downloadVoice(m.id,down);wrap.append(title,load,down);return wrap;}
async function downloadVoice(id,button){const m=record(id);if(!m?.audio_path)return;if(button)button.disabled=true;try{status('Preparing voice download…');const audio=await getVoice(m.audio_path);const a=document.createElement('a');a.href=audio.url;a.download='our-voice-'+m.audio_path.split('/').pop();document.body.append(a);a.click();a.remove();status('Download requested. Your phone may show a save/share prompt.');}catch(e){status('Could not download voice message: '+e.message);}finally{if(button)button.disabled=false;}}
$('menu-download-voice').onclick=()=>{const id=menuID;$('message-menu').close();downloadVoice(id);};

(async()=>{me=await GardenDB.begin();try{await access();checkRecordingSupport();restoreDraft();await latest({initial:true});await connect();pollTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!stopped)latest().catch(e=>{connection('Connection interrupted');status('Could not refresh: '+e.message);});},12000);}catch(e){status('Chat is not ready: '+e.message+' Run the chat.sql add-on in Supabase, then reload.');connection('Not connected');}})();
