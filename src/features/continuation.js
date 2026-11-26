'use strict';
function wfs53IdDelta(before,after){
  const ids=items=>new Map((Array.isArray(items)?items:[]).filter(x=>x&&typeof x.id==='string'&&x.id).map(x=>[x.id,x]));
  const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const b=ids(before),a=ids(after);
  let changed=0;for(const [id,value] of b){if(a.has(id)&&canonical(value)!==canonical(a.get(id)))changed++;}
  return {before:b.size,after:a.size,added:[...a.keys()].filter(id=>!b.has(id)).length,removed:[...b.keys()].filter(id=>!a.has(id)).length,changed};
}
function wfs53RestoreReview(before,after){
  const out={};for(const [key,field] of [['tasks','todos'],['notes','notes'],['events','events'],['habits','habits'],['links','quick_links']])out[key]=wfs53IdDelta(before[field],after[field]);return out;
}
function wfs53ValidateReview(raw){
  if(!raw||typeof raw.token!=='string'||!raw.token||raw.token.length>128)return null;
  const review={token:raw.token};
  for(const key of ['tasks','notes','events','habits','links']){
    const d=raw[key];if(!d||!['before','after','added','removed','changed'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||
      d.removed>d.before||d.added>d.after||d.before-d.removed+d.added!==d.after||d.changed>d.before-d.removed)return null;
    review[key]={before:d.before,after:d.after,added:d.added,removed:d.removed,changed:d.changed};
  }
  return review;
}
function wfs53ActivityDays(rows){
  const byDay=new Map();
  for(const r of rows){
    if(!r||!Number.isSafeInteger(r.at_ms)||r.at_ms<0||r.at_ms>253402300799999||
      !['calendar','task'].includes(r.kind)||!['enqueue_accepted','retry_scheduled','retry_exhausted'].includes(r.outcome))continue;
    const key=new Date(r.at_ms).toISOString().slice(0,10);
    if(!byDay.has(key))byDay.set(key,{day:key,accepted:0,retry:0,exhausted:0,tasks:0,calendar:0});
    const d=byDay.get(key);d[r.kind==='task'?'tasks':'calendar']++;
    d[r.outcome==='enqueue_accepted'?'accepted':r.outcome==='retry_scheduled'?'retry':'exhausted']++;
  }
  return [...byDay.values()].sort((a,b)=>b.day.localeCompare(a.day)).slice(0,31);
}
function wfs53NoteDraft(name,body){
  if(typeof name!=='string'||!name.trim()||typeof body!=='string'||!body.trim()||body.length>50000||body.includes('\0'))return null;
  const title=[...name.trim()].slice(0,200).join('');
  return {title,body,tags:['shelf']};
}
function wfs53LocalSummary(state,now){
  const todos=state.todos||[],notes=state.notes||[],events=state.events||[],habits=state.habits||[],links=state.quick_links||[];
  const key=workspaceLocalDay(now),open=todos.filter(t=>!t.done),today=events.filter(e=>plannerEventOnDate(e,key));
  return {open:open.length,overdue:open.filter(t=>Number.isFinite(t.due_at_ms)&&t.due_at_ms<now).length,
    notes:notes.length,today:today.length,habits:habits.length,checkins:habits.filter(h=>Array.isArray(h.completed_dates)&&h.completed_dates.includes(key)).length,
    links:links.length};
}

function wfs53DeadlinePlan(todos,changes,due){
  if(due!==null&&(!Number.isSafeInteger(due)||due<946684800000||due>4102444800000))throw Error('Invalid task due time');
  if(!Array.isArray(changes)||changes.length<1||changes.length>50)throw Error('Choose 1–50 open tasks');
  const ids=new Set(),byId=new Map(todos.map(t=>[t.id,t]));
  for(const c of changes){
    if(!c||typeof c.id!=='string'||ids.has(c.id))throw Error('Invalid or duplicate selection');
    ids.add(c.id);const t=byId.get(c.id);
    if(!t||t.done||(t.change_token??null)!==(c.expected_token??null)||(t.due_at_ms??null)!==(c.expected_due_at_ms??null))throw Error('Task selection changed; review it again');
    if(t.recurrence)throw Error('Edit repeating task schedules individually');
  }
  return todos.map(t=>ids.has(t.id)&&(t.due_at_ms??null)!==due?{...t,due_at_ms:due,snoozed_until_ms:null,recurrence_timezone:null}:t);
}

let wfs53PreviewLease=null,wfs53Review=null,wfs53ReviewTicket=0,wfs53RestoreBusy=false,wfs53NoteBusy=false;
function wfs53ClearReview(message='Choose Review & protect on a backup.'){
  wfs53ReviewTicket++;wfs53Review=null;wfs53PreviewLease=null;
  const host=$('#wfs53-restore-rows');if(!host)return;
  host.replaceChildren();if(typeof wfs55RenderImpact==='function')wfs55RenderImpact(null);$('#wfs53-restore-apply').disabled=true;$('#wfs53-restore-status').textContent=message;
}
async function wfs53ReviewBackup(id){
  if(wfs53RestoreBusy||appDataLoadStatus!=='ready')return;
  wfs53ClearReview('Reading backup without changing local state…');const ticket=wfs53ReviewTicket;
  await writeQueue.catch(()=>{});
  if(ticket!==wfs53ReviewTicket||activeTab!=='settings')return;
  try{
    const result=wfs53ValidateReview(await invoke('preview_backup_restore',{id}));
    if(ticket!==wfs53ReviewTicket||activeTab!=='settings'){if(wfs53PreviewLease?.token===result?.token)wfs53PreviewLease=null;return;}
    if(!result)throw Error('Invalid backup review');
    wfs53Review={id,result};if(typeof wfs55RenderImpact==='function')wfs55RenderImpact(result);const host=$('#wfs53-restore-rows');
    for(const key of ['tasks','notes','events','habits','links']){
      const d=result[key],row=node('div','wfs53-delta');
      row.append(node('b','',key),node('span','',d.before+' → '+d.after),node('small','',d.added+' added IDs · '+d.removed+' removed IDs · '+d.changed+' retained records changed'));host.append(row);
    }
    $('#wfs53-restore-status').textContent='Review ready. Counts include changed retained records, without exposing their contents. A separate safety backup will be saved before applying.';
    $('#wfs53-restore-apply').disabled=false;
    $('#wfs53-restore-status').scrollIntoView({block:'nearest'});
  }catch(e){if(ticket===wfs53ReviewTicket)wfs53ClearReview('Review unavailable: '+(e.message||String(e)));}
}
async function wfs53ApplyRestore(){
  const review=wfs53Review;if(!review||wfs53RestoreBusy||activeTab!=='settings')return;
  if(!confirm('Restore reviewed backup and save a separate protective snapshot first? Local tasks, notes, calendar and settings may change.'))return;
  wfs53RestoreBusy=true;$('#wfs53-restore-apply').disabled=true;
  try{
    if(!await flushNote())return;
    const task=writeQueue.catch(()=>{}).then(async()=>{
      const result=await invoke('restore_backup_reviewed',{id:review.id,token:review.result.token});
      if(!result?.data||!result?.safety_backup?.id)throw Error('Unexpected restore response; reload local state.');
      data=result.data;selectedNoteId=null;boundEditorId=null;pendingDraft=null;
      cancelEventEdit();cancelTodoEdit();render();
      wfs53ClearReview('Restored. Protective snapshot saved: '+result.safety_backup.id);
      await refreshBackups();showInfo('Reviewed restore complete; safety backup saved.');
    });
    writeQueue=task.catch(()=>{});await task;
  }catch(e){wfs53ClearReview('Restore not confirmed: '+(e.message||String(e))+'. Review again.');}
  finally{wfs53RestoreBusy=false;$('#wfs53-restore-apply').disabled=!wfs53Review;}
}
function wfs53RenderActivityDays(rows){
  const host=$('#wfs53-activity-days');if(!host)return;host.replaceChildren();
  if(!activitySnapshotAvailable||!phase47Limit(data.settings?.activity_history_limit)){host.append(node('p','event-hint','No consented snapshot.'));return;}
  const days=wfs53ActivityDays(rows);
  if(!days.length){host.append(node('p','event-hint','No matching attempts.'));return;}
  for(const d of days){
    const line=node('div','wfs53-delta');line.append(node('b','',d.day+' UTC'),node('span','',d.accepted+' accepted · '+d.retry+' retries'),node('small','',d.exhausted+' exhausted · '+d.tasks+' task / '+d.calendar+' calendar'));host.append(line);
  }
}
function wfs53ShelfNoteState(){
  const b=$('#wfs53-shelf-note');if(!b)return;
  const pre=$('#wfs52-file-content pre'),record=shelfEntries.find(r=>wfs52ShelfKey(r)===wfs52PreviewKey);
  b.disabled=wfs53NoteBusy||!record||!pre||!wfs53NoteDraft(record.name,pre.textContent);
  const copy=$('#wfs54-shelf-copy'),release=$('#wfs54-shelf-release');
  if(copy)copy.disabled=!record||!pre||!wfs54CopyableText(pre.textContent);
  if(release)release.disabled=!$('#wfs52-file-select')?.value||!wfs52ShelfHandles.has($('#wfs52-file-select').value);
}
function wfs54CopyableText(value){
  return typeof value==='string'&&value.length>0&&value.length<=100000&&!value.includes(String.fromCharCode(0));
}
async function wfs54CopyShelfText(){
  if(activeTab!=='dock'||!wfs52ShelfHandles.has(wfs52PreviewKey))return;
  const pre=$('#wfs52-file-content pre'),value=pre?.textContent;
  if(!wfs54CopyableText(value)||!confirm('Copy displayed file text to the system clipboard? Other apps may read clipboard contents.'))return;
  try{await navigator.clipboard.writeText(value);showInfo('Displayed file text copied.');}
  catch{showError('Clipboard unavailable; no copy confirmed.');}
}
function wfs54ReleaseShelfFile(){
  if(activeTab!=='dock')return;
  const key=$('#wfs52-file-select').value;
  if(!key||!wfs52ShelfHandles.has(key))return;
  if(typeof wfs55ClearBundle==='function')wfs55ClearBundle();
  wfs52ShelfHandles.delete(key);
  if(wfs52PreviewKey===key)wfs52ClearFilePreview();
  wfs52RenderFileChoices();wfs53ShelfNoteState();
  showInfo('Selected session file released. Remembered metadata and original file are unchanged.');
}
async function wfs53CreateShelfNote(){
  if(wfs53NoteBusy||activeTab!=='dock'||appDataLoadStatus!=='ready')return;
  const record=shelfEntries.find(r=>wfs52ShelfKey(r)===wfs52PreviewKey),pre=$('#wfs52-file-content pre');
  const draft=record&&pre?wfs53NoteDraft(record.name,pre.textContent):null;if(!draft)return;
  if(!confirm('Create a new local note from the complete displayed text? This copies the file content into persisted Notes. The original file remains unchanged.'))return;
  wfs53NoteBusy=true;wfs53ShelfNoteState();
  try{if(await mutation('create_note_from_draft',draft))showInfo('New local note created from Shelf.');}
  finally{wfs53NoteBusy=false;wfs53ShelfNoteState();}
}
const wfs53ModuleInfo={
  home:['PLAN','Your local command center','todos','Open tasks'],
  todos:['EXECUTE','Priorities, deadlines and completion','calendar','Calendar'],
  notes:['CAPTURE','Local drafts and knowledge','flashcards','Study cards'],
  calendar:['SCHEDULE','Appointments and time windows','day','Day timeline'],
  system:['MONITOR','Device snapshots and Windows controls','media','Media remote'],
  timer:['FOCUS','One session at a time','countdown','Countdown'],
  health:['WELLBEING','Personal check-ins and goals','habits','Habit history'],
  day:['TODAY','Review the day in context','home','Planner'],
  countdown:['TIMEBOX','Independent local countdown','timer','Focus timer'],
  weather:['OUTLOOK','Opt-in forecast, no automatic location','calendar','Calendar'],
  flashcards:['RECALL','Review notes without a cloud service','notes','Notes'],
  habits:['CONSISTENCY','Daily check-ins and history','health','Health'],
  dock:['WORKSPACE','Pinned links and selected local files','notes','Notes'],
  media:['PLAYBACK','Selected Windows player and transport','system','Audio output'],
  tools:['UTILITIES','Offline tools and time measurements','countdown','Countdown'],
  settings:['CONTROL','Privacy, appearance and recovery','system','System']
};
function wfs53RenderModuleContext(){
  if(appDataLoadStatus!=='ready')return;
  const s=wfs53LocalSummary(data,Date.now());
  const values={home:s.open+' open · '+s.today+' events today',todos:s.overdue+' overdue · '+s.open+' open',notes:s.notes+' saved notes',calendar:s.today+' events intersect today',health:'Targets stored locally',habits:s.checkins+' / '+s.habits+' checked in',dock:s.links+' pinned links · '+shelfEntries.length+' Shelf records',day:s.today+' events · '+s.overdue+' overdue tasks',timer:'Custom duration · local state',countdown:'Independent timer',system:nativeInvoke?'Windows · on-demand data':'Native data unavailable in preview',media:nativeInvoke?'Selected-session controls':'Native player unavailable in preview',weather:'Explicit request only',flashcards:'Session-based review',tools:'Offline utilities',settings:'Local state and privacy'};
  for(const [key,value] of Object.entries(values)){const el=document.querySelector('#panel-'+key+' .wfs53-context-value');if(el&&el.textContent!==value)el.textContent=value;}
}
function wfs53RenderDeadlines(){
  const set=$('#wfs53-deadline-set'),clear=$('#wfs53-deadline-clear');if(!set||!clear)return;
  const selected=[...wfs52Selection.keys()],rows=(data.todos||[]).filter(t=>wfs52Selection.has(t.id));
  const blocked=appDataLoadStatus!=='ready'||wfs52TaskPending||!selected.length||rows.length!==selected.length||rows.some(t=>t.done||t.recurrence);
  clear.disabled=blocked;set.disabled=blocked||!$('#wfs53-deadline').value;
  $('#wfs53-deadline-status').textContent=rows.some(t=>t.recurrence)?'Repeating tasks selected: edit their schedules individually.':selected.length+' selected for deadline change; priorities remain unchanged.';
}
async function wfs53ApplyDeadlines(clear){
  if(wfs52TaskPending||!wfs52Selection.size)return;
  let due;try{due=clear?null:parseTaskDue($('#wfs53-deadline').value);if(!clear&&due===null)return;wfs53DeadlinePlan(data.todos,[...wfs52Selection.values()],due);}
  catch(e){showError(e);return;}
  const changes=[...wfs52Selection.values()];
  if(!confirm((clear?'Clear deadlines for ':'Set a shared deadline for ')+changes.length+' selected open non-repeating tasks? Existing snooze times will be cleared for changed tasks.'))return;
  wfs52TaskPending=true;wfs52RenderTasks();
  try{if(await mutation('set_task_deadlines',{changes,dueAtMs:due})){wfs52Selection.clear();showInfo('Task deadlines updated in one transaction.');}}
  finally{wfs52TaskPending=false;wfs52RenderTasks();}
}

function wfs53Init(){
  for(const [key,[tag,title,target,action]] of Object.entries(wfs53ModuleInfo)){
    const panel=$('#panel-'+key);if(!panel||panel.querySelector('.wfs53-context'))continue;
    const section=node('div','wfs53-context'),label=node('div','wfs53-context-label');
    label.append(node('small','',tag),node('b','',title),node('span','wfs53-context-value','Local state loading…'));
    const button=node('button','secondary wfs53-context-action',action);button.type='button';button.addEventListener('click',()=>void openModuleFromContent(target));
    section.append(label,button);panel.insertBefore(section,panel.firstElementChild?.nextSibling||null);
  }
  const apply=$('#wfs53-restore-apply');if(!apply||apply.dataset.ready==='true')return;apply.dataset.ready='true';
  apply.addEventListener('click',()=>void wfs53ApplyRestore());
  $('#wfs53-restore-cancel').addEventListener('click',()=>wfs53ClearReview());
  $('#wfs53-shelf-note').addEventListener('click',()=>void wfs53CreateShelfNote());
  $('#wfs54-shelf-copy').addEventListener('click',()=>void wfs54CopyShelfText());
  $('#wfs54-shelf-release').addEventListener('click',wfs54ReleaseShelfFile);
  $('#wfs52-file-select').addEventListener('change',wfs53ShelfNoteState);
  $('#wfs53-deadline').addEventListener('input',wfs53RenderDeadlines);
  $('#wfs53-deadline-set').addEventListener('click',()=>void wfs53ApplyDeadlines(false));
  $('#wfs53-deadline-clear').addEventListener('click',()=>void wfs53ApplyDeadlines(true));
  wfs53RenderModuleContext();wfs53ShelfNoteState();wfs53RenderDeadlines();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs53Init,{once:true});else wfs53Init();
