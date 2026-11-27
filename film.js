'use strict';
// No SDK. GardenDB supplies auth/REST; Storage uses fetch and Realtime native WebSocket.
const $=id=>document.getElementById(id),BUCKET='garden-film-photos';
let me,roll=null,rolls=[],votes=[],activity=[],busy=false,pending=null,galleryRoll=null,galleryEpoch=0,currentImage=null;
let ws,heartbeat,reconnect,refreshTimer,poll,credentialTimer,stopped=false,ref=0,attempt=0,refreshTask=null,refreshAgain=false;
const urls=new Map(),loading=new Map();let moreButton;
const real=role=>role==='faisal'?'Faisal':'Zehna';
function status(text,error=false){$('film-status').textContent=text;$('film-status').classList.toggle('error',error)}
let toastTimer;function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
function date(t){return new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}
function age(t){const seconds=Math.max(0,(Date.now()-new Date(t))/1000);return seconds<60?'just now':seconds<3600?Math.floor(seconds/60)+' minutes ago':seconds<86400?Math.floor(seconds/3600)+' hours ago':date(t)}
function rpc(name,body){return GardenDB.rest('rpc/'+name,{method:'POST',body})}
function headers(a){return {apikey:a.publicKey,Authorization:'Bearer '+a.accessToken}}
function lock(value){busy=value;document.querySelectorAll('#shot-form button,#shot-form input,#shot-form textarea,#new-form button,#new-form input,#new-form select,#approve-early').forEach(b=>b.disabled=value);$('shoot').disabled=value;$('seal-shot').textContent=pending?'Retry sealing this moment ♡':'Seal this moment ♡'}
function fail(e){status(e.message||'Something went wrong. Please try again.',true)}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(!busy)$(b.dataset.close).close()});
['shot-dialog','new-dialog','early-dialog'].forEach(id=>$(id).addEventListener('cancel',e=>{if(busy)e.preventDefault()}));
function render(){
 $('roll-title').textContent=roll?roll.title:'Our next little chapter';$('shooting').hidden=!roll;$('no-roll').hidden=!!roll;$('roll-badge').textContent=roll?'STILL SHOOTING':'READY FOR OUR NEXT ROLL';
 if(roll){$('count').textContent=roll.shot_count;$('limit').textContent=roll.max_shots;$('camera-counter').textContent=String(roll.shot_count).padStart(2,'0');$('progress').style.width=(roll.shot_count/roll.max_shots*100)+'%'}
 $('activity').replaceChildren();activity.forEach(s=>{const li=document.createElement('li'),n=document.createElement('span'),text=document.createElement('div'),who=document.createElement('span'),when=document.createElement('small');n.className='shot-dot';n.textContent=String(s.shot_number).padStart(2,'0');who.className='who';who.textContent=real(s.author_role)+' took a shot';when.className='when';when.textContent=age(s.created_at);when.title=date(s.created_at);text.append(who,when);li.append(n,text);$('activity').append(li)});
 if(!activity.length&&roll){const li=document.createElement('li');li.textContent='A fresh roll. Our first moment can be anything.';$('activity').append(li)}
 $('develop-early').disabled=busy||!roll||roll.shot_count===0;
 $('vote-status').hidden=!votes.length;$('vote-status').textContent=votes.map(v=>real(v.author_role)).join(' & ')+' is ready. Waiting for the other account.';
 const approved=votes.some(v=>v.author_id===me?.id);$('approve-early').disabled=busy||approved||!roll;$('approve-early').textContent=approved?'Your yes is recorded ✓':'Yes, I’m ready';renderShelf();
}
function renderShelf(){ $('rolls').replaceChildren();$('rolls-total').textContent=rolls.length?(rolls.length+' ROLLS LOADED'):'';
 rolls.forEach(r=>{const b=document.createElement('button');b.className='roll-card';b.innerHTML='<div class="roll-art"><div class="canister"></div></div><div class="roll-meta"><strong></strong><small></small></div>';b.querySelector('strong').textContent=r.title;b.querySelector('small').textContent=r.shot_count+' frames · '+date(r.developed_at);b.onclick=()=>openRoll(r);$('rolls').append(b)});
 if(!rolls.length){const p=document.createElement('p');p.className='shelf-note';p.textContent='Our first roll is still waiting to happen.';$('rolls').append(p)}
}
async function refresh(){
 if(stopped)return;if(refreshTask){refreshAgain=true;return refreshTask}
 refreshTask=(async()=>{const previous=roll?.id;const [active,developed]=await Promise.all([GardenDB.rest('film_rolls?status=eq.shooting&select=*&limit=1'),GardenDB.rest('film_rolls?status=eq.developed&select=*&order=developed_at.desc,id.desc&limit=30')]);
 if(stopped)return;roll=active[0]||null;const map=new Map(rolls.map(r=>[r.id,r]));developed.forEach(r=>map.set(r.id,r));rolls=Array.from(map.values()).sort((a,b)=>b.developed_at.localeCompare(a.developed_at)||b.id.localeCompare(a.id));
 if(roll){[activity,votes]=await Promise.all([rpc('film_progress',{p_roll:roll.id}),GardenDB.rest('film_develop_votes?roll_id=eq.'+roll.id+'&select=author_id,author_role')])}else{activity=[];votes=[]}
 render();moreButton.hidden=developed.length<30&&rolls.length<30;if(previous&&!active.some(r=>r.id===previous))toast('A roll has developed. Find it on our shelf. ♡');status('Just between us. '+(ws?.readyState===WebSocket.OPEN?'Live updates connected.':'Checking for updates periodically.'));
 })().catch(fail).finally(()=>{refreshTask=null;if(refreshAgain){refreshAgain=false;scheduleRefresh()}});return refreshTask;
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,200)}
async function fileInfo(file){if(!file||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size>10485760||file.size===0)throw new Error('Choose a JPEG, PNG, WebP or GIF up to 10 MiB.');
 const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>40000000)throw new Error('Choose an image of 40 megapixels or less.')}finally{URL.revokeObjectURL(url)}
 return {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[file.type];
}
$('shoot').onclick=()=>{if(roll)$('shot-dialog').showModal()};
$('shot-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;lock(true);try{
 if(!pending){if(!roll)throw new Error('No active roll.');const file=$('file').files[0],ext=await fileInfo(file);if(Array.from($('caption').value).length>200)throw new Error('Keep the caption to 200 characters.');pending={id:crypto.randomUUID(),roll:roll.id,path:me.id+'/'+crypto.randomUUID()+'.'+ext,file,caption:$('caption').value,uploaded:false}}
 // Retry the same object/shot IDs: no recompression, no replacement of originals.
 if(!pending.uploaded){const a=await GardenDB.chatAccess();const response=await fetch(a.url+'/storage/v1/object/'+BUCKET+'/'+pending.path,{method:'POST',headers:{...headers(a),'Content-Type':pending.file.type,'x-upsert':'false'},body:pending.file});if(!response.ok){const err=await response.json().catch(()=>({}));if(response.status!==409&&String(err.statusCode)!=='409'&&err.error!=='Duplicate')throw new Error(err.message||'Photo upload failed. Try again.')}pending.uploaded=true}
 await rpc('film_seal_shot',{p_id:pending.id,p_roll:pending.roll,p_path:pending.path,p_caption:pending.caption});pending=null;$('file').value='';$('caption').value='';$('shot-dialog').close();toast('Sealed until our roll develops. ♡');await refresh();
 }catch(e){fail(e);toast(pending?'Could not confirm this shot. Retry sealing the same moment; don’t re-upload it in another tab.':e.message)}finally{lock(false)}});
// A pending ambiguous request is kept in memory for idempotent retry. Never delete
// its object automatically: the server may already have committed the shot.
$('shot-dialog').addEventListener('close',()=>{if(pending)toast('Your pending shot is kept in this tab. Open Take a shot to retry sealing it.')});
$('load').onclick=()=>$('new-dialog').showModal();$('new-form').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);try{await rpc('film_load_roll',{p_title:$('new-title').value.trim(),p_max:Number($('new-limit').value)});$('new-dialog').close();await refresh()}catch(e){fail(e);toast('Could not load a roll. Another account may have just loaded one.');await refresh()}finally{lock(false)}};
$('develop-early').onclick=()=>{render();$('early-dialog').showModal()};$('approve-early').onclick=async()=>{if(busy||!roll)return;lock(true);try{const developed=await rpc('film_vote_develop',{p_roll:roll.id});if(developed){$('early-dialog').close();toast('Our roll is ready. ♡')}else toast('Your yes is recorded. The other account must also approve.');await refresh()}catch(e){fail(e)}finally{lock(false);render()}};
async function photo(path){if(urls.has(path))return urls.get(path);if(loading.has(path))return loading.get(path);const requestEpoch=galleryEpoch;const task=(async()=>{const a=await GardenDB.chatAccess();const r=await fetch(a.url+'/storage/v1/object/authenticated/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/'),{headers:headers(a),cache:'no-store'});if(!r.ok)throw new Error('Photo unavailable. Please retry.');const blob=await r.blob();if(stopped||requestEpoch!==galleryEpoch)throw new Error('Contact sheet closed.');const result=URL.createObjectURL(blob);urls.set(path,result);return result})();loading.set(path,task);try{return await task}finally{loading.delete(path)}}
function clearPhotos(){urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();$('large').removeAttribute('src');currentImage=null}
async function download(s){try{const url=await photo(s.image_path);const a=document.createElement('a');a.href=url;a.download='frame-'+String(s.shot_number).padStart(2,'0')+'-'+s.author_role+'.'+s.image_path.split('.').pop();document.body.append(a);a.click();a.remove()}catch(e){toast(e.message)}}
async function openRoll(r){const epoch=++galleryEpoch;clearPhotos();galleryRoll=r;$('home').hidden=true;$('gallery').hidden=false;$('gallery-title').textContent=r.title;$('gallery-meta').textContent=r.shot_count+' frames · Developed '+date(r.developed_at);$('frames').replaceChildren();status('Opening our contact sheet…');window.scrollTo({top:0,behavior:'smooth'});
 try{const shots=await GardenDB.rest('film_shots?roll_id=eq.'+r.id+'&select=*&order=shot_number.asc&limit=24');if(epoch!==galleryEpoch)return;
 const jobs=[];for(const s of shots){const frame=document.createElement('article');frame.className='frame';frame.innerHTML='<div class="frame-id"><span></span><span>35MM ♡</span></div><button class="photo-button" aria-label="Open full-size photo"><span class="image-status">Bringing this moment into the light…</span></button><p></p><small></small><button class="download">↓ Download original</button>';frame.querySelector('.frame-id span').textContent=String(s.shot_number).padStart(2,'0')+'A';frame.querySelector('p').textContent=s.caption||'A little moment.';frame.querySelector('small').textContent=real(s.author_role)+' · '+date(s.created_at);frame.querySelector('.download').onclick=()=>download(s);const button=frame.querySelector('.photo-button');
 const hydrate=async()=>{try{const src=await photo(s.image_path);if(epoch!==galleryEpoch)return;button.replaceChildren();const img=document.createElement('img');img.className='photo';img.src=src;img.alt=s.caption||'Frame '+s.shot_number;img.loading='lazy';button.append(img);button.onclick=()=>{$('large').src=src;$('large').alt=img.alt;$('large-caption').textContent=(s.caption||'A little moment.')+' — '+real(s.author_role)+' · '+date(s.created_at);currentImage=s;$('lightbox').showModal()}}catch(e){if(epoch!==galleryEpoch)return;button.textContent='Photo unavailable · tap to retry';button.onclick=hydrate}};jobs.push(hydrate);$('frames').append(frame)}
 // Limit simultaneous original downloads to keep mobile memory/network pressure modest.
 let cursor=0;await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{while(cursor<jobs.length&&epoch===galleryEpoch)await jobs[cursor++]()}));if(epoch===galleryEpoch)status('Our moments, kept at original quality.');
 }catch(e){fail(e)}}
$('download-large').onclick=()=>{if(currentImage)download(currentImage)};$('back').onclick=()=>{galleryEpoch++;galleryRoll=null;clearPhotos();$('gallery').hidden=true;$('home').hidden=false;status('Just between us.');refresh()};
function send(event,payload,topic='realtime:film'){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({topic,event,payload,ref:String(++ref)}))}
async function connect(){if(stopped)return;clearTimeout(reconnect);try{const a=await GardenDB.chatAccess();if(stopped)return;ws=new WebSocket(a.url.replace(/^http/,'ws')+'/realtime/v1/websocket?apikey='+encodeURIComponent(a.publicKey)+'&vsn=1.0.0');const socket=ws;
 socket.onopen=()=>{if(stopped){socket.close();return}attempt=0;send('phx_join',{config:{broadcast:{self:false},presence:{key:''},postgres_changes:['film_rolls','film_shots','film_shot_activity','film_develop_votes'].map(table=>({event:'*',schema:'public',table}))},access_token:a.accessToken});clearInterval(heartbeat);heartbeat=setInterval(()=>send('heartbeat',{},'phoenix'),25000)};
 socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.event==='postgres_changes')scheduleRefresh();if(m.event==='phx_reply'&&m.payload?.status==='ok')scheduleRefresh();if(m.event==='system'&&m.payload?.status==='error'){status('Live feed interrupted. Periodic updates remain active.');socket.close()}if(m.event==='phx_error')socket.close()};
 socket.onerror=()=>{};socket.onclose=()=>{if(ws!==socket)return;clearInterval(heartbeat);if(!stopped){status('Reconnecting live updates. Periodic checks remain active.');reconnect=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5)))}};
 }catch(e){fail(e);if(!stopped)reconnect=setTimeout(connect,15000)}}
function shutdown(){stopped=true;clearTimeout(reconnect);clearTimeout(refreshTimer);clearInterval(poll);clearInterval(credentialTimer);clearInterval(heartbeat);ws?.close();galleryEpoch++;clearPhotos()}
window.addEventListener('beforeunload',e=>{if(busy||pending){e.preventDefault();e.returnValue=''}});window.addEventListener('pagehide',shutdown);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stopped){refresh();if(!ws||ws.readyState>1)connect()}});
(async()=>{try{me=await GardenDB.begin();if(!['faisal','zehna'].includes(me.role))throw new Error('Garden membership required.');
 moreButton=document.createElement('button');moreButton.className='quiet';moreButton.textContent='Earlier rolls ↓';$('rolls').after(moreButton);moreButton.onclick=async()=>{moreButton.disabled=true;try{const last=rolls[rolls.length-1];const cursor=last?'&or='+encodeURIComponent('(developed_at.lt.'+last.developed_at+',and(developed_at.eq.'+last.developed_at+',id.lt.'+last.id+'))'):'';const rows=await GardenDB.rest('film_rolls?status=eq.developed&select=*&order=developed_at.desc,id.desc&limit=30'+cursor);rolls.push(...rows.filter(r=>!rolls.some(x=>x.id===r.id)));renderShelf();moreButton.hidden=rows.length<30}catch(e){fail(e)}finally{moreButton.disabled=false}};
 await refresh();connect();poll=setInterval(()=>{if(!document.hidden)refresh()},20000);credentialTimer=setInterval(async()=>{try{const a=await GardenDB.chatAccess();send('access_token',{access_token:a.accessToken})}catch(e){fail(e)}},45000);
 }catch(e){fail(e)}})();
