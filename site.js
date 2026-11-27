'use strict';
const $=id=>document.getElementById(id);
const RECIPIENT=PAGE==='zehna'?'Zehna':'Faisal',AUTHOR=PAGE==='zehna'?'Faisal':'Zehna';
let user,allNotes=[],content={},activeColor='all',selectedColor=PALETTE[0].color,previousFocus,toastTimer;
function notify(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),6500);}
function ink(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.35?'#3e4439':'#fffdf6';}
function openDialog(d){previousFocus=document.activeElement;d.showModal();document.body.style.overflow='hidden';}
document.querySelectorAll('dialog').forEach(d=>{d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))d.close();});d.addEventListener('close',()=>{document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus();});});
function swatch(color,name,fn){const b=document.createElement('button');b.type='button';b.className='swatch';b.style.setProperty('--swatch',color);b.title=name;b.setAttribute('aria-label',name);b.setAttribute('aria-pressed','false');b.onclick=fn;return b;}
function renderFilters(){const bar=$('filters');bar.querySelectorAll('.swatch').forEach(b=>b.remove());[...new Set([...PALETTE.map(p=>p.color),...allNotes.map(n=>n.color)])].forEach(c=>{const b=swatch(c,PALETTE.find(p=>p.color===c)?.name||'Custom color '+c,()=>{activeColor=c;render();});b.dataset.filter=c;bar.append(b);});}
function render(){const query=$('search').value.trim().toLocaleLowerCase();const visible=allNotes.map((n,i)=>({...n,index:i})).filter(n=>(activeColor==='all'||n.color===activeColor)&&n.message.toLocaleLowerCase().includes(query));$('total').textContent=allNotes.length;$('result-count').textContent=`THE COLLECTION / ${visible.length} ${visible.length===1?'NOTE':'NOTES'}`;$('grid').replaceChildren();visible.forEach((n,i)=>{const b=document.createElement('button');b.type='button';b.className='card';b.style.setProperty('--card',n.color);b.style.setProperty('--floral-art',FLOWER_ART[n.index%FLOWER_ART.length]);b.style.color=ink(n.color);b.style.setProperty('--delay',`${Math.min(i,11)*35}ms`);b.setAttribute('aria-label',`Read note ${n.index+1} to ${RECIPIENT}: ${n.message}`);const to=document.createElement('span');to.className='to';to.textContent='To: '+RECIPIENT;const text=document.createElement('span');text.className='card-text';text.textContent=n.message;const bottom=document.createElement('span');bottom.className='card-bottom';const num=document.createElement('span');num.textContent=`UNSENT / ${String(n.index+1).padStart(3,'0')}`;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',n.index%3===1?'#heart':'#flower');svg.append(use);bottom.append(num,svg);b.append(to,text,bottom);b.onclick=()=>{$('read-text').textContent=n.message;$('read-dialog').style.setProperty('--floral-art',FLOWER_ART[n.index%FLOWER_ART.length]);$('read-dialog').style.setProperty('--note-color',n.color);$('read-dialog').style.color=ink(n.color);$('read-dialog').dataset.noteId=n.id;openDialog($('read-dialog'));document.dispatchEvent(new CustomEvent('garden-note-opened',{detail:{id:n.id}}));};$('grid').append(b);});$('empty').style.display=visible.length?'none':'block';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===activeColor)));}
function showSpecial(title,message,secret=false){$('special-eyebrow').textContent=secret?'A little secret, just for you':`To ${RECIPIENT} · for this moment`;$('special-title').textContent=title;$('special-body').textContent=message;openDialog($('special-dialog'));}
function renderContent(){ $('subtitle').textContent=content.subtitle||'';$('hero-signature').textContent=(content.signature||'').replace(/\s*♡$/, '');if((content.signature||'').endsWith('♡')){const heart=document.createElement('span');heart.setAttribute('aria-hidden','true');heart.textContent='♡';$('hero-signature').append(' ',heart);}$('closing-text').textContent=content.closing||'';$('dedication').replaceChildren();const quote=document.createTextNode('“'+(content.dedication||'')+'”');const cite=document.createElement('cite');cite.textContent='— '+AUTHOR;$('dedication').append(quote,cite);$('letters').replaceChildren();(content.open_when||[]).forEach(letter=>{const b=document.createElement('button');b.type='button';b.className='letter';const icon=document.createElement('span');icon.className='envelope';icon.textContent='✉';icon.setAttribute('aria-hidden','true');const label=document.createElement('small');label.textContent='Open when…';const title=document.createElement('strong');title.textContent=letter.title;const foot=document.createElement('span');foot.className='letter-foot';foot.textContent='A letter from '+AUTHOR+' ↗';b.append(icon,label,title,foot);b.onclick=()=>showSpecial('Open when '+letter.title,letter.message);$('letters').append(b);});}
async function load(){const [rows,gardens]=await Promise.all([GardenDB.rest('notes?select=*&page=eq.'+PAGE+'&order=created_at.desc,id.desc'),GardenDB.rest('gardens?select=content&page=eq.'+PAGE)]);if(!gardens.length)throw new Error('Garden content is missing. Run seed.sql in Supabase.');allNotes=rows;content=gardens[0].content;renderFilters();render();renderContent();}
$('open-form').onclick=()=>{if(user?.role!==AUTHOR.toLowerCase()){notify(`This garden contains ${AUTHOR}’s notes. Use the other garden to write your own.`);return;}openDialog($('form-dialog'));};
$('search').oninput=render;document.querySelector('.all').onclick=()=>{activeColor='all';render();};$('reset').onclick=()=>{activeColor='all';$('search').value='';render();};
function updateChoices(){document.querySelectorAll('#color-choice .swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===selectedColor)));$('custom-color').value=selectedColor;}
PALETTE.forEach(p=>{const b=swatch(p.color,p.name,()=>{selectedColor=p.color;updateChoices();});b.dataset.color=p.color;$('color-choice').append(b);});const picker=document.createElement('input');picker.type='color';picker.id='custom-color';picker.setAttribute('aria-label','Choose a custom note color');picker.oninput=()=>{selectedColor=picker.value;updateChoices();};$('color-choice').append(picker);updateChoices();
$('message').oninput=()=>{$('message').setCustomValidity('');$('char-count').textContent=$('message').value.length+' / 600';};
$('note-form').onsubmit=async e=>{e.preventDefault();const message=$('message').value.trim();if(!message){$('message').setCustomValidity('Write a few words first.');$('message').reportValidity();return;}const b=e.submitter||$('note-form').querySelector('[type=submit]');b.disabled=true;try{await GardenDB.rest('notes',{method:'POST',body:{page:PAGE,author_role:user.role,message,color:selectedColor},headers:{Prefer:'return=representation'}});$('form-dialog').close();$('note-form').reset();$('char-count').textContent='0 / 600';selectedColor=PALETTE[0].color;updateChoices();activeColor='all';$('search').value='';await load();notify('Your words are saved, just between us.');}catch(err){notify('Could not save: '+err.message);}finally{b.disabled=false;}};
document.querySelectorAll('[data-secret]').forEach(b=>b.onclick=()=>showSpecial('You found a little secret.',(content.secrets||[])[Number(b.dataset.secret)]||'A little quiet corner, just for you.',true));
function exportData(){return JSON.stringify(allNotes.map(n=>({message:n.message,color:n.color})),null,2);}
async function copy(){try{await navigator.clipboard.writeText(exportData());notify('Notes copied.');return true;}catch(e){return false;}}
$('export').onclick=async()=>{if(!await copy()){$('export-text').value=exportData();openDialog($('export-dialog'));$('export-text').select();}};$('copy-again').onclick=async()=>{if(!await copy()){$('export-text').select();notify('Copy the selected text or use Download JSON.');}};$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([exportData()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='for-'+PAGE+'-messages.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

// A quiet footer sign-out control on both private gardens.
function installGardenSignOut(){
 const footer=document.querySelector('.wrap > footer');
 if(!footer||document.getElementById('garden-signout'))return;
 const button=document.createElement('button');button.id='garden-signout';
 button.type='button';button.className='export';button.textContent='Sign out';
 button.style.cssText='color:#737e65;white-space:nowrap';
 button.addEventListener('click',async()=>{
  if(!confirm('Sign out of your garden on this tab?'))return;
  button.disabled=true;button.textContent='Signing out…';
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  $('private-content').hidden=true;
  try{await GardenDB.logout();}
  catch(e){/* The helper clears this tab’s stored session even if logout fails. */}
  finally{try{sessionStorage.removeItem('two-private-gardens-session-v1');}catch(e){}location.reload();}
 });
 footer.append(button);
}

// Personal header entrance. Authorization stays in the existing login/RLS.
function installMySpaceLink(){
 const header=document.querySelector('.wrap > header');
 if(!header||document.getElementById('my-space-link'))return;
 if(!user||!['faisal','zehna'].includes(user.role))return;
 const style=document.createElement('style');
 style.textContent=`
 .wrap>header .my-space-link,.wrap>header .my-space-link:visited{
  display:inline-flex;align-items:center;gap:8px;background:#edf0e3;
  border:1px solid #b9c7a9;border-radius:5px;color:#526647;
  padding:11px 15px;margin-right:12px;font:12px Arial,Helvetica,sans-serif;
  white-space:nowrap;text-decoration:none;transition:background .2s,transform .2s;
 }
 .wrap>header .my-space-link:hover{background:#e2e8d6;transform:translateY(-1px)}
 .wrap>header .my-space-link:focus-visible{outline:2px solid #81956c;outline-offset:4px}
 .wrap>header .my-space-link svg{width:15px;height:15px;flex-shrink:0}
 .wrap>header>a,.wrap>header>a:visited{color:#526647}
 @media(max-width:700px){
  .wrap>header{height:auto;min-height:80px;flex-wrap:wrap;gap:10px;padding:16px 0}
  .wrap>header .brand{flex:1 0 calc(100% - 120px)}
  .wrap>header .my-space-link{order:1;margin-right:0;padding:10px 13px;font-size:11px}
  .wrap>header>a:not(.my-space-link){order:2;margin-left:0!important;margin-right:0!important}
  .wrap>header .write{order:3}
 }
 @media(prefers-reduced-motion:reduce){.wrap>header .my-space-link{transition:none}}
 `;
 document.head.append(style);
 const link=document.createElement('a');link.id='my-space-link';link.className='my-space-link';
 link.href=user.role==='faisal'?'admin-faisal.html':'admin-zehna.html';
 link.setAttribute('aria-label','Open my personal space');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.4','aria-hidden':'true'}))svg.setAttribute(key,value);
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M20 21a8 8 0 0 0-16 0');
 const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','12');circle.setAttribute('cy','7');circle.setAttribute('r','4');svg.append(path,circle);
 const label=document.createElement('span');label.textContent='My space';
 const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');link.append(svg,label,arrow);
 header.insertBefore(link,document.getElementById('open-form'));
}

(async()=>{user=await GardenDB.begin();installMySpaceLink();installGardenSignOut();try{await load();}catch(err){notify('Unable to load: '+err.message);$('empty').textContent='Could not load your garden. Check your connection and setup, then reload.';$('empty').style.display='block';}})();
