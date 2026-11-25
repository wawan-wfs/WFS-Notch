'use strict';
// Local-only workspaces: navigation targets are existing controls, never synthetic actions.
const phase48Modules = {
  home:['Plan your day','AGENDA','phase47-agenda','Open tasks','todos'],
  todos:['Manage priorities','FIND TASKS','workspace-task-search','Calendar','calendar'],
  notes:['Capture and retrieve','FIND NOTES','note-search','Flashcards','flashcards'],
  calendar:['Schedule with context','FIND EVENTS','workspace-event-search','Tasks','todos'],
  system:['Inspect this PC','AUDIO INVENTORY','audio-read','Media','media'],
  timer:['Protect focus time','SESSION CONTROLS','timer-start','Countdown','countdown'],
  health:['Daily wellbeing','WATER TRACKING','health-water','Habits','habits'],
  day:['Review the timeline','EVENT TIMELINE','day-event-list','Calendar','calendar'],
  countdown:['Set your deadline','DURATION','countdown-minutes','Focus timer','timer'],
  weather:['Check a location','CITY SEARCH','weather-city','Day progress','day'],
  flashcards:['Practice from notes','NOTE SOURCE','flashcards-note','Notes','notes'],
  habits:['Build consistency','NEW HABIT','habit-title','Health','health'],
  dock:['Keep essentials nearby','FILE SHELF','shelf-input','Quick tools','tools'],
  media:['Control a player','PLAYER SELECTION','media-player-picker','Audio devices','system'],
  tools:['Use local utilities','CALCULATOR','math-input','Dock','dock'],
  settings:['Personalize and protect','NOTIFICATION HISTORY','activity-limit','System','system']
};
function phase48AudioFilter(groups, mode) {
  return groups.map(group=>({...group,endpoints:group.endpoints.filter(endpoint=>
    mode==='default'?endpoint.is_default===true:mode==='enabled'?endpoint.enabled===true:mode==='disabled'?endpoint.enabled===false:true)}));
}
function phase48ActivitySummary(rows) {
  const result={enqueue_accepted:0,retry_scheduled:0,retry_exhausted:0};
  for(const row of rows) if(Object.hasOwn(result,row.outcome)) result[row.outcome]++;
  return result;
}
function phase48FileKind(name) {
  const ext=String(name).toLowerCase().split('.');
  if(ext.length<2||!ext[0]&&ext.length===2)return 'other';
  const suffix=ext.at(-1);
  if(['png','jpg','jpeg','gif','webp','bmp','svg','heic','avif','tif','tiff'].includes(suffix))return 'image';
  if(['mp4','mov','mkv','webm','avi','mp3','wav','flac','m4a','ogg'].includes(suffix))return 'media';
  if(['pdf','txt','md','doc','docx','xls','xlsx','csv','ppt','pptx','rtf','odt'].includes(suffix))return 'document';
  return 'other';
}
function phase48ShelfFilter(rows, mode) {
  return rows.filter(row=>mode==='all'||phase48FileKind(row.item.name)===mode);
}
function phase48Focus(target, panel) {
  if(!target||!panel.contains(target))return false;
  for(let parent=target.parentElement;parent&&parent!==panel;parent=parent.parentElement){
    if(parent.hidden)return false;
    if(parent.tagName==='DETAILS')parent.open=true;
  }
  if(target.hidden)return false;
  // Disabled controls remain unavailable; scroll and focus their section instead.
  const destination=target.disabled?(target.closest('section,form,.workspace-card,.selected-player')||panel):target;
  if(destination.tabIndex<0)destination.tabIndex=-1;
  destination.focus({preventScroll:true});
  destination.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  return true;
}
function phase48Init(){
  for(const [name,[title,action,id,related,route]] of Object.entries(phase48Modules)){
    const panel=document.getElementById('panel-'+name), target=document.getElementById(id);
    if(!panel||!target||!panel.contains(target)||panel.querySelector('.phase48-context'))continue;
    const strip=node('div','phase48-context'), copy=node('div','phase48-context-copy');
    copy.append(node('small','','WORKSPACE'),node('b','',title));
    const actions=node('div','phase48-context-actions');
    const jump=node('button','phase48-action',action), link=node('button','phase48-action phase48-related',related+' →');
    jump.type=link.type='button';
    jump.addEventListener('click',()=>phase48Focus(target,panel));
    link.addEventListener('click',async()=>{if(await switchTab(route))document.querySelector('.tab[data-tab="'+route+'"]')?.focus();});
    actions.append(jump,link);strip.append(copy,actions);
    const heading=panel.querySelector(':scope > .section-heading, :scope > .welcome');
    if(heading)heading.after(strip);else panel.prepend(strip);
  }
  const audio=document.getElementById('phase48-audio-filter');
  if(audio&&audio.dataset.phase48Ready!=='true'){audio.dataset.phase48Ready='true';audio.addEventListener('change',()=>{if(typeof phase48RefreshAudioView==='function')phase48RefreshAudioView();});}
  const shelf=document.getElementById('phase48-shelf-kind');
  if(shelf&&shelf.dataset.phase48Ready!=='true'){shelf.dataset.phase48Ready='true';shelf.addEventListener('change',()=>{if(typeof renderShelf==='function')renderShelf();});}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',phase48Init,{once:true});else phase48Init();
