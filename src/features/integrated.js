'use strict';
function wfs52TaskPlan(todos,changes,priority){
  if(!Array.isArray(changes)||changes.length<1||changes.length>50||!['low','normal','high'].includes(priority))throw Error('Choose 1–50 open tasks and a supported priority');
  const selected=new Set(), byId=new Map(todos.map(t=>[t.id,t]));
  for(const c of changes){
    if(!c||typeof c.id!=='string'||selected.has(c.id))throw Error('Invalid or duplicate task');
    selected.add(c.id);const t=byId.get(c.id);
    if(!t||t.done||(t.change_token??null)!==(c.expected_token??null)||(t.due_at_ms??null)!==(c.expected_due_at_ms??null))throw Error('Task selection changed; review it again');
  }
  return todos.map(t=>selected.has(t.id)&&t.priority!==priority?{...t,priority}:t);
}
function wfs52ShelfPreview(raw,existing){
  if(typeof raw!=='string'||raw.length>120000)throw Error('Shelf manifest exceeds size limit');
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='entries,format,version'||value.format!=='wfs-notch-shelf-metadata'||value.version!==1||!Array.isArray(value.entries)||value.entries.length>32)throw Error('Invalid Shelf manifest');
  const items=value.entries.map(item=>{
    if(!item||Object.keys(item).sort().join(',')!=='modified,name,size')throw Error('Unexpected metadata field');
    const record=shelfRecord({name:item.name,size:item.size,lastModified:item.modified});
    if(!record)throw Error('Invalid metadata');return {name:record.name,size:record.size,lastModified:record.modified};
  });
  return shelfAdd(existing,items);
}
function wfs52SeekRequest(snapshot,choice,position,age){
  if(!snapshot||!choice||choice.ambiguous||choice.can_seek!==true||choice.source!==snapshot.source||
    !Number.isFinite(age)||age<0||age>10000||typeof snapshot.title!=='string'||!snapshot.title.trim()||
    !Number.isSafeInteger(snapshot.duration_ms)||snapshot.duration_ms<1||snapshot.duration_ms>604800000||
    !Number.isSafeInteger(position)||position<0||position>snapshot.duration_ms)return null;
  const {source,title,duration_ms}=snapshot;
  return {source,title,artist:snapshot.artist||'',album:snapshot.album||'',duration_ms,position_ms:position};
}
function wfs52ActivityCsv(rows){
  const safe=rows.filter(r=>Number.isSafeInteger(r.at_ms)&&r.at_ms>=0&&r.at_ms<=8640000000000000&&['calendar','task'].includes(r.kind)&&['enqueue_accepted','retry_scheduled','retry_exhausted'].includes(r.outcome)&&Number.isInteger(r.attempt)&&r.attempt>=1&&r.attempt<=3);
  return 'timestamp_utc,kind,outcome,attempt\n'+safe.map(r=>[new Date(r.at_ms).toISOString(),r.kind,r.outcome,r.attempt].join(',')).join('\n');
}

function wfs52EditTitle(raw){
  if(typeof raw!=='string'||!raw.trim()||[...raw.trim()].length>120)throw Error('Title must contain 1–120 characters');
  return raw.trim();
}
function wfs52LinkFields(label,raw){
  label=wfs52EditTitle(label);
  if(typeof raw!=='string'||raw.trim().length>2048||/\s/u.test(raw.trim()))throw Error('Invalid URL');
  const url=new URL(raw.trim());
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('Only http(s) links without credentials are allowed');
  return {label,url:url.href};
}
function wfs52EditSignature(item,type){
  return item?JSON.stringify(type==='habit'?[item.id,item.title]:[item.id,item.label,item.url]):'';
}

let wfs52Selection=new Map(),wfs52TaskPending=false,wfs52ShelfReview=null,wfs52SeekKey='',wfs52SeekEdited=false,wfs52SeekFeedback='';
function wfs52RenderTasks(){
  const host=$('#wfs52-task-list');if(!host)return;
  const status=$('#wfs52-task-status'),apply=$('#wfs52-task-apply');
  if(appDataLoadStatus!=='ready'){host.replaceChildren();apply.disabled=true;status.textContent='Local data unavailable.';return;}
  const term=$('#wfs52-task-search').value.trim().toLowerCase(),visible=(data.todos||[]).filter(t=>!t.done&&String(t.title).toLowerCase().includes(term)).slice(0,50);
  let stale=0;
  for(const [id,c] of wfs52Selection){
    const t=data.todos.find(x=>x.id===id);
    if(!t||t.done||(t.change_token??null)!==c.expected_token||(t.due_at_ms??null)!==c.expected_due_at_ms){wfs52Selection.delete(id);stale++;}
  }
  const focus=document.activeElement?.dataset?.wfs52Task;
  host.replaceChildren();
  for(const t of visible){
    const line=node('label','wfs52-select-row'),cb=node('input','');cb.type='checkbox';cb.dataset.wfs52Task=t.id;cb.checked=wfs52Selection.has(t.id);cb.disabled=wfs52TaskPending||(!cb.checked&&wfs52Selection.size>=50);
    cb.addEventListener('change',()=>{
      if(cb.checked&&wfs52Selection.size<50)wfs52Selection.set(t.id,{id:t.id,expected_token:t.change_token??null,expected_due_at_ms:t.due_at_ms??null});
      else wfs52Selection.delete(t.id);
      wfs52RenderTasks();
    });
    line.append(cb,node('span','',t.title),node('small','',t.priority||'normal'));host.append(line);
    if(focus===t.id)cb.focus({preventScroll:true});
  }
  if(!visible.length)host.append(node('p','empty','No matching open tasks.'));
  status.textContent=(stale?stale+' stale selection(s) removed. ':'')+wfs52Selection.size+' selected (including hidden matches); showing up to 50 open tasks.';
  apply.disabled=wfs52TaskPending||!wfs52Selection.size;
}
function wfs52InvalidateShelf(){
  wfs52ShelfReview=null;const b=$('#wfs52-shelf-apply');if(b)b.disabled=true;
}
function wfs52ReviewShelf(){
  wfs52InvalidateShelf();const status=$('#wfs52-shelf-status');
  try{
    const raw=$('#wfs52-shelf-json').value,result=wfs52ShelfPreview(raw,shelfEntries);
    wfs52ShelfReview={raw,signature:JSON.stringify(shelfEntries),result};
    status.textContent=result.added+' new, '+result.skipped+' duplicate or capacity-limited. Metadata only; original files are not restored.';
    $('#wfs52-shelf-apply').disabled=!result.added;
  }catch(e){status.textContent='Import rejected: '+e.message;}
}
function wfs52RenderSeek(){
  const input=$('#wfs52-seek'),apply=$('#wfs52-seek-apply'),status=$('#wfs52-seek-status');if(!input||!apply||!status)return;
  const snapshot=mediaLastSample,choice=mediaSessionChoices.find(x=>x.source===$('#media-player-picker').value);
  const request=wfs52SeekRequest(snapshot,choice,0,Date.now()-mediaLastSampleAt);
  const key=request?JSON.stringify([request.source,request.title,request.artist,request.album,request.duration_ms]):'';
  if(key!==wfs52SeekKey){wfs52SeekKey=key;wfs52SeekEdited=false;wfs52SeekFeedback='';}
  const enabled=!!nativeInvoke&&!!request&&!mediaControlPending&&!mediaNeedsSelection;
  input.disabled=!enabled;apply.disabled=!enabled||!wfs52SeekEdited;
  if(!enabled){status.textContent=mediaControlPending?'Waiting for selected player…':'Seek unavailable: requires a fresh uniquely selected seekable Windows track.';return;}
  input.max=String(request.duration_ms);
  if(!wfs52SeekEdited){input.value=String(Math.min(request.duration_ms,Math.max(0,Math.round(snapshot.position_ms||0))));status.textContent=wfs52SeekFeedback||'Choose a position and apply.';}
  $('#wfs52-seek-value').textContent=mediaTime(Number(input.value))+' / '+mediaTime(request.duration_ms);
}
async function wfs52ApplySeek(){
  const input=$('#wfs52-seek'),status=$('#wfs52-seek-status');
  if(!nativeInvoke||mediaControlPending||mediaNeedsSelection||!wfs52SeekEdited)return;
  const choice=mediaSessionChoices.find(x=>x.source===$('#media-player-picker').value);
  const request=wfs52SeekRequest(mediaLastSample,choice,Number(input.value),Date.now()-mediaLastSampleAt);
  if(!request||JSON.stringify([request.source,request.title,request.artist,request.album,request.duration_ms])!==wfs52SeekKey){wfs52RenderSeek();return;}
  mediaControlPending=true;wfs52SeekEdited=false;wfs52RenderSeek();
  for(const b of $$('[data-selected-media]'))b.disabled=true;
  try{
    const accepted=await invoke('seek_media_session',{request});
    wfs52SeekFeedback=accepted?'Seek accepted by Windows player; inspect refreshed position.':'Player did not accept seek.';
  }catch(e){wfs52SeekFeedback='Seek refused or unavailable. Refresh the selected track.';showError(e);}
  finally{mediaControlPending=false;await refreshMediaDetails(true);wfs52RenderSeek();}
}
function wfs52RenderActivityExport(rows){
  const button=$('#wfs52-activity-export');if(!button)return;
  button.disabled=!rows.length||!activitySnapshotAvailable;
  button.onclick=null;
  if(button.disabled)return;
  button.onclick=async()=>{
    if(!activitySnapshotAvailable||!phase47Limit(data.settings?.activity_history_limit)||!confirm('Copy shown notification activity metadata? No titles or bodies.'))return;
    const current=plannerActivityWindow(wfs50RetainedActivity(activityRows,Date.now()),$('#phase49-activity-window').value,Date.now()).filter(row=>($('#activity-kind').value==='all'||row.kind===$('#activity-kind').value)&&($('#activity-outcome').value==='all'||row.outcome===$('#activity-outcome').value));
    if(!current.length)return;
    try{await navigator.clipboard.writeText(wfs52ActivityCsv(current));$('#activity-status').textContent='Copied shown activity metadata.';}catch{showError('Clipboard unavailable.');}
  };
}
const wfs52Editors={habit:{sig:'',original:null,pending:false,options:''},link:{sig:'',original:null,pending:false,options:''}};
function wfs52RenderEditors(){
  for(const type of ['habit','link']){
    const select=$('#wfs52-'+type+'-select');if(!select)continue;
    const editor=wfs52Editors[type],items=appDataLoadStatus==='ready'?(type==='habit'?data.habits:data.quick_links)||[]:[];
    const signature=JSON.stringify(items.map(x=>[x.id,type==='habit'?x.title:x.label]));
    if(signature!==editor.options){
      const old=select.value;select.replaceChildren(new Option('Choose an item',''),...items.map(x=>new Option(type==='habit'?x.title:x.label,x.id)));
      select.value=items.some(x=>x.id===old)?old:'';editor.options=signature;
    }
    const current=items.find(x=>x.id===select.value);
    const valid=!!current&&editor.sig===wfs52EditSignature(current,type)&&!editor.pending;
    $('#wfs52-'+type+'-apply').disabled=!valid;
    $('#wfs52-'+type+'-load').disabled=!current||editor.pending;
    if(editor.original&&!valid&&!editor.pending)$('#wfs52-'+type+'-status').textContent='Item changed or selection moved. Load it again before saving.';
  }
}
function wfs52LoadEditor(type){
  const items=type==='habit'?data.habits:data.quick_links,editor=wfs52Editors[type];
  const item=items.find(x=>x.id===$('#wfs52-'+type+'-select').value);
  if(!item||editor.pending)return;
  editor.original={...item};editor.sig=wfs52EditSignature(item,type);
  $('#wfs52-'+type+'-title').value=type==='habit'?item.title:item.label;
  if(type==='link')$('#wfs52-link-url').value=item.url;
  $('#wfs52-'+type+'-status').textContent='Editing selected item. History and ID will be retained.';
  wfs52RenderEditors();
}
async function wfs52SaveEditor(type){
  const editor=wfs52Editors[type],original=editor.original,status=$('#wfs52-'+type+'-status');
  if(!original||editor.pending||$('#wfs52-'+type+'-apply').disabled)return;
  let args,command;
  try{
    const title=$('#wfs52-'+type+'-title').value;
    if(type==='habit'){args={id:original.id,expectedTitle:original.title,title:wfs52EditTitle(title)};command='rename_habit';}
    else{args={id:original.id,expectedLabel:original.label,expectedUrl:original.url,...wfs52LinkFields(title,$('#wfs52-link-url').value)};command='edit_quick_link';}
  }catch(e){status.textContent=e.message;return;}
  editor.pending=true;wfs52RenderEditors();
  try{
    if(await mutation(command,args)){editor.original=null;editor.sig='';status.textContent='Saved. Existing item ID and history retained.';}
    else status.textContent='Save failed. Reload current item before retrying.';
  }finally{editor.pending=false;wfs52RenderEditors();}
}

function wfs52Init(){
  const form=$('#wfs52-task-form');if(!form||form.dataset.ready==='true')return;form.dataset.ready='true';
  $('#wfs52-task-search').addEventListener('input',wfs52RenderTasks);
  $('#wfs52-task-clear').addEventListener('click',()=>{wfs52Selection.clear();wfs52RenderTasks();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(wfs52TaskPending||!wfs52Selection.size||appDataLoadStatus!=='ready')return;
    const changes=[...wfs52Selection.values()],priority=$('#wfs52-task-priority').value;
    if(!confirm('Set priority '+priority+' for '+changes.length+' selected open tasks? Dates and recurrence stay unchanged.'))return;
    wfs52TaskPending=true;wfs52RenderTasks();
    try{if(await mutation('set_task_priorities',{changes,priority}))wfs52Selection.clear();}
    finally{wfs52TaskPending=false;wfs52RenderTasks();}
  });
  $('#wfs52-shelf-json').addEventListener('input',()=>{wfs52InvalidateShelf();$('#wfs52-shelf-status').textContent='Preview the changed manifest.';});
  $('#wfs52-shelf-preview').addEventListener('click',wfs52ReviewShelf);
  $('#wfs52-shelf-apply').addEventListener('click',()=>{
    const r=wfs52ShelfReview;
    if(!r||r.raw!==$('#wfs52-shelf-json').value||r.signature!==JSON.stringify(shelfEntries)){wfs52InvalidateShelf();$('#wfs52-shelf-status').textContent='Shelf changed. Preview again.';return;}
    if(!confirm('Add '+r.result.added+' metadata records to Shelf?'))return;
    if(shelfCommit(r.result.entries)){wfs52InvalidateShelf();$('#wfs52-shelf-json').value='';$('#wfs52-shelf-status').textContent='Metadata added; original files unchanged.';renderShelf();}
  });
  $('#wfs52-seek').addEventListener('input',()=>{wfs52SeekEdited=true;wfs52SeekFeedback='';wfs52RenderSeek();});
  $('#wfs52-seek-apply').addEventListener('click',()=>void wfs52ApplySeek());
  $('#wfs52-sound-settings').addEventListener('click',async()=>{if(!nativeInvoke){showInfo('Requires Windows desktop app.');return;}try{await invoke('launch_builtin',{appName:'sound_settings'});}catch(e){showError(e);}});
  $('#wfs52-notification-settings').addEventListener('click',async()=>{if(!nativeInvoke){showInfo('Requires Windows desktop app.');return;}try{await invoke('launch_builtin',{appName:'notification_settings'});}catch(e){showError(e);}});
  for(const type of ['habit','link']){
    $('#wfs52-'+type+'-select').addEventListener('change',wfs52RenderEditors);
    $('#wfs52-'+type+'-load').addEventListener('click',()=>wfs52LoadEditor(type));
    $('#wfs52-'+type+'-form').addEventListener('submit',e=>{e.preventDefault();void wfs52SaveEditor(type);});
  }
  wfs52RenderTasks();wfs52RenderSeek();wfs52RenderEditors();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs52Init,{once:true});else wfs52Init();
