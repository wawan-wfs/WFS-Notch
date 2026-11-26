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

function wfs52CivilDate(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  const d=new Date(day+'T00:00:00Z');
  return Number.isFinite(+d)&&d.toISOString().slice(0,10)===day;
}
function wfs52AgendaText(plan,key){
  if(!wfs52CivilDate(key))throw Error('Invalid agenda date');
  const safe=value=>String(value).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gu,' ').trim();
  const lines=['WFS Notch agenda · '+key,'Open tasks: '+plan.tasks+' · Events: '+plan.events,''];
  const fmt=ms=>new Date(ms).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  for(const r of plan.rows.slice(0,200)){
    const time=r.allDay?'All day':r.continued?'Continues':fmt(r.start);
    lines.push(time+' · '+(r.kind==='task'?'Task':'Event')+' · '+safe(r.title)+(r.overlap?' [overlap]':''));
  }
  if(plan.rows.length>200)lines.push('Only first 200 records included.');
  return lines.join('\n');
}
function wfs52ReviewNext(ratings,count,current,mode){
  if(!Number.isInteger(count)||count<1||count>200||!['again','unrated','all'].includes(mode))return null;
  const from=Number.isInteger(current)&&current>=0&&current<count?current:-1;
  for(let n=1;n<=count;n++){
    const i=(from+n)%count,r=ratings.get(i);
    if(mode==='all'||mode==='again'&&r==='again'||mode==='unrated'&&!ratings.has(i))return i;
  }
  return null;
}

function wfs52VolumeSnapshot(raw,now){
  if(!raw||typeof raw.token!=='string'||!raw.token||raw.token.length>128||
    !Number.isInteger(raw.percent)||raw.percent<0||raw.percent>100||typeof raw.muted!=='boolean'||!Number.isFinite(now))return null;
  const role=raw.role??'multimedia';if(!['multimedia','console','communications'].includes(role))return null;
  return {token:raw.token,percent:raw.percent,muted:raw.muted,role,at:now};
}
function wfs52VolumeAction(snapshot,percent,muted,now){
  if(!snapshot||!Number.isFinite(now)||now<snapshot.at||now-snapshot.at>=25000)return null;
  if(Number.isInteger(percent)&&percent>=0&&percent<=100&&muted===null)return {token:snapshot.token,percent,muted:null};
  if(percent===null&&typeof muted==='boolean')return {token:snapshot.token,percent:null,muted};
  return null;
}
function wfs52ShelfKey(record){return JSON.stringify([record.name,record.size,record.modified]);}
function wfs52PreviewKind(record){
  if(!record||!Number.isSafeInteger(record.size)||record.size<0)return null;
  const ext=String(record.name).toLowerCase().split('.').pop();
  if(['txt','md','csv','log','json','ini','yaml','yml'].includes(ext)&&record.size<=262144)return 'text';
  if(ext==='png'&&record.size<=2097152)return 'png';
  return null;
}
function wfs52PngBounds(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes.length>2097152)return null;
  const sig=[137,80,78,71,13,10,26,10];if(sig.some((v,i)=>bytes[i]!==v))return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(8)!==13||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return null;
  const width=view.getUint32(16),height=view.getUint32(20);
  return width>0&&height>0&&width<=4096&&height<=4096&&width*height<=8000000?{width,height}:null;
}
function wfs52SelectedHandles(records,files){
  const allowed=new Set(records.map(wfs52ShelfKey)),found=new Map(),ambiguous=new Set();
  for(const file of files){
    const r=shelfRecord(file);if(!r||!wfs52PreviewKind(r))continue;
    const key=wfs52ShelfKey(r);if(!allowed.has(key))continue;
    if(found.has(key)||ambiguous.has(key)){found.delete(key);ambiguous.add(key);continue;}
    found.set(key,file);
  }
  return found;
}

let wfs52Selection=new Map(),wfs52TaskPending=false,wfs52ShelfReview=null,wfs52SeekKey='',wfs52SeekEdited=false,wfs52SeekFeedback='';
function wfs52RenderTasks(){
  const host=$('#wfs52-task-list');if(!host)return;
  const status=$('#wfs52-task-status'),apply=$('#wfs52-task-apply');
  if(appDataLoadStatus!=='ready'){host.replaceChildren();apply.disabled=true;status.textContent='Local data unavailable.';if(typeof wfs53RenderDeadlines==='function')wfs53RenderDeadlines();return;}
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
  if(typeof wfs53RenderDeadlines==='function')wfs53RenderDeadlines();
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
  if(typeof wfs53RenderActivityDays==='function')wfs53RenderActivityDays(rows);
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

function wfs52RenderAgendaExport(){
  const button=$('#wfs52-agenda-copy');if(!button)return;
  button.disabled=appDataLoadStatus!=='ready'||!wfs52CivilDate(plannerSelected);
}
async function wfs52CopyAgenda(){
  if(appDataLoadStatus!=='ready'||!wfs52CivilDate(plannerSelected))return;
  const plan=plannerDay(data.todos||[],data.events||[],plannerSelected),key=plannerSelected;
  if(!confirm('Copy agenda for '+key+'? Includes task and event titles, up to 200 records.'))return;
  try{await navigator.clipboard.writeText(wfs52AgendaText(plan,key));showInfo('Copied selected-day agenda.');}
  catch{showError('Clipboard unavailable.');}
}
function wfs52RenderReviewQueue(cards){
  const mode=$('#wfs52-review-mode'),next=$('#wfs52-review-next');if(!mode||!next)return;
  next.disabled=!wfs50Review||wfs52ReviewNext(wfs50Review.ratings,cards.length,flashcardIndex,mode.value)===null;
}
function wfs52AdvanceReview(){
  const cards=cardsFromNote(flashcardNoteId);
  wfs50Review=wfs50ReviewState(wfs50Review,flashcardNoteId,cards);
  const index=wfs52ReviewNext(wfs50Review.ratings,cards.length,flashcardIndex,$('#wfs52-review-mode').value);
  if(index===null)return;
  flashcardIndex=index;flashcardShowingAnswer=false;renderFlashcards();
}
function wfs52ForgetWeather(){
  if(weatherInFlight)return;
  const status=$('#weather-current');
  try{localStorage.removeItem('wfs-notch-weather-city');}
  catch{status.textContent='Could not remove stored city. Retry.';return;}
  $('#weather-city').value='';$('#weather-forecast').hidden=true;$('#weather-locations').hidden=true;
  for(const id of ['weather-locations','weather-details','weather-hours','weather-days'])$('#'+id).replaceChildren();
  $('#weather-timezone').textContent='';wfs51ClearWeather();status.textContent='Stored city and current forecast cleared.';
}
function wfs52RenderDataSummary(){
  const host=$('#wfs52-data-summary');if(!host)return;
  if(appDataLoadStatus!=='ready'){host.textContent='Local state unavailable.';return;}
  host.textContent=(data.todos||[]).length+' tasks · '+(data.notes||[]).length+' notes · '+(data.events||[]).length+' events · '+(data.habits||[]).length+' habits · '+(data.quick_links||[]).length+' pinned links. Counts only; no content is exported.';
}

let wfs52Output=null,wfs52VolumeBusy=false,wfs52VolumeTicket=0,wfs52ShelfHandles=new Map(),wfs52FileTicket=0,wfs52PreviewKey='';
function wfs52RenderVolume(){
  const slider=$('#wfs52-volume'),apply=$('#wfs52-volume-apply'),mute=$('#wfs52-volume-mute'),read=$('#wfs52-volume-read'),role=$('#wfs53-output-role');if(!slider)return;
  const valid=!!nativeInvoke&&!wfs52VolumeBusy&&wfs52Output?.role===(role?.value||'multimedia')&&!!wfs52VolumeAction(wfs52Output,Number(slider.value),null,Date.now());
  if(role)role.disabled=wfs52VolumeBusy;
  slider.disabled=!valid;apply.disabled=!valid;mute.disabled=!valid;read.disabled=wfs52VolumeBusy;
  if(wfs52Output&&Date.now()-wfs52Output.at>=25000&&!wfs52VolumeBusy)$('#wfs52-volume-status').textContent='Snapshot expired. Read current default output again.';
  mute.textContent=wfs52Output?.muted?'Unmute output':'Mute output';
  $('#wfs52-volume-value').textContent=valid?slider.value+'%':'—';
}
async function wfs52ReadVolume(){
  if(!nativeInvoke){$('#wfs52-volume-status').textContent='Requires Windows desktop app.';return;}
  if(wfs52VolumeBusy)return;
  const ticket=++wfs52VolumeTicket;wfs52Output=null;wfs52VolumeBusy=true;wfs52RenderVolume();
  const role=$('#wfs53-output-role')?.value||'multimedia';
  $('#wfs52-volume-status').textContent='Reading default '+role+' output…';
  try{
    const raw=await deviceDeadline(()=>invoke('get_output_volume_for_role',{role}),10000);
    if(ticket!==wfs52VolumeTicket)return;
    wfs52Output=wfs52VolumeSnapshot(raw,Date.now());if(!wfs52Output||wfs52Output.role!==role)throw Error('Invalid output volume role');
    $('#wfs52-volume').value=String(wfs52Output.percent);
    $('#wfs52-volume-status').textContent='Windows reported '+wfs52Output.percent+'% · '+(wfs52Output.muted?'muted':'unmuted')+'. Snapshot valid for 25 seconds.';
  }catch(e){wfs52Output=null;$('#wfs52-volume-status').textContent='Output volume unavailable. Read again.';}
  finally{if(ticket===wfs52VolumeTicket){wfs52VolumeBusy=false;wfs52RenderVolume();}}
}
async function wfs52ApplyVolume(muteAction){
  if(!nativeInvoke||wfs52VolumeBusy||wfs52Output?.role!==($('#wfs53-output-role')?.value||'multimedia'))return;
  const role=wfs52Output.role;
  const args=wfs52VolumeAction(wfs52Output,muteAction?null:Number($('#wfs52-volume').value),muteAction?!wfs52Output?.muted:null,Date.now());
  if(!args){wfs52RenderVolume();return;}
  if(!muteAction&&args.percent>wfs52Output.percent&&!confirm('Increase default output volume to '+args.percent+'%?'))return;
  if(!muteAction&&args.percent===wfs52Output.percent)return;
  wfs52VolumeBusy=true;wfs52Output=null;wfs52RenderVolume();$('#wfs52-volume-status').textContent='Applying explicit Windows output action…';
  try{
    wfs52Output=wfs52VolumeSnapshot(await invoke('set_default_output_volume',args),Date.now());
    if(!wfs52Output||wfs52Output.role!==role)throw Error('Invalid readback role');
    $('#wfs52-volume').value=String(wfs52Output.percent);
    $('#wfs52-volume-status').textContent='Windows readback: '+wfs52Output.percent+'% · '+(wfs52Output.muted?'muted':'unmuted')+'.';
  }catch(e){wfs52Output=null;$('#wfs52-volume-status').textContent='Output changed, expired or unavailable; read Windows again before retrying.';showError(e);}
  finally{wfs52VolumeBusy=false;wfs52RenderVolume();}
}
function wfs52ClearFilePreview(){
  wfs52FileTicket++;wfs52PreviewKey='';const box=$('#wfs52-file-content');
  if(box)box.replaceChildren();
  if(typeof wfs53ShelfNoteState==='function')wfs53ShelfNoteState();
  const status=$('#wfs52-file-status');if(status)status.textContent='No content preview. Only explicitly selected session files can be read.';
}
function wfs52PruneHandles(records){
  const allowed=new Set(records.map(wfs52ShelfKey));
  for(const key of wfs52ShelfHandles.keys())if(!allowed.has(key))wfs52ShelfHandles.delete(key);
  if(wfs52PreviewKey&&!wfs52ShelfHandles.has(wfs52PreviewKey))wfs52ClearFilePreview();
}
function wfs52AttachFiles(records,files){
  const incoming=wfs52SelectedHandles(records,files);
  // Explicitly reselected files supersede old content for matching metadata.
  for(const file of files){const r=shelfRecord(file);if(r){const key=wfs52ShelfKey(r);if(wfs52ShelfHandles.has(key)){wfs52ShelfHandles.delete(key);if(wfs52PreviewKey===key)wfs52ClearFilePreview();}}}
  for(const [key,file] of incoming)wfs52ShelfHandles.set(key,file);
}
function wfs52RenderFileChoices(){
  const select=$('#wfs52-file-select');if(!select)return;
  const old=select.value,rows=shelfEntries.filter(r=>wfs52ShelfHandles.has(wfs52ShelfKey(r)));
  select.replaceChildren(new Option('Choose a selected session file',''),...rows.map(r=>new Option(r.name+' · '+r.size+' bytes',wfs52ShelfKey(r))));
  select.value=rows.some(r=>wfs52ShelfKey(r)===old)?old:'';
  $('#wfs52-file-open').disabled=!select.value;$('#wfs52-file-forget').disabled=!rows.length;
  if(wfs52PreviewKey&&wfs52PreviewKey!==select.value)wfs52ClearFilePreview();
}
async function wfs52OpenFile(){
  const key=$('#wfs52-file-select').value,file=wfs52ShelfHandles.get(key);
  const r=shelfEntries.find(item=>wfs52ShelfKey(item)===key),kind=wfs52PreviewKind(r);
  if(!file||!kind||file.size!==r.size)return;
  wfs52ClearFilePreview();const ticket=++wfs52FileTicket;
  $('#wfs52-file-status').textContent='Reading explicitly selected file…';wfs52PreviewKey=key;
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(ticket!==wfs52FileTicket||wfs52ShelfHandles.get(key)!==file||$('#wfs52-file-select').value!==key||activeTab!=='dock')return;
    const box=$('#wfs52-file-content');
    if(bytes.length!==r.size)throw Error('File changed; reselect');
    if(kind==='text'){
      const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(value.includes('\0'))throw Error('Binary content is not a text preview');
      box.append(node('pre','wfs52-file-text',value.slice(0,100000)));
      if(typeof wfs53ShelfNoteState==='function')wfs53ShelfNoteState();
      $('#wfs52-file-status').textContent=value.length>100000?'Text preview truncated to 100,000 characters.':'UTF-8 text shown literally; nothing was executed.';
    }else{
      const bounds=wfs52PngBounds(bytes);if(!bounds)throw Error('Unsupported or oversized PNG dimensions');
      let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
      const image=node('img','wfs52-file-image');image.alt='Selected PNG preview';image.src='data:image/png;base64,'+btoa(binary);
      image.addEventListener('error',()=>{if(ticket===wfs52FileTicket){box.replaceChildren();$('#wfs52-file-status').textContent='PNG could not be decoded.';}},{once:true});
      box.append(image);$('#wfs52-file-status').textContent=bounds.width+' × '+bounds.height+' PNG · local session preview';
    }
  }catch(e){if(ticket===wfs52FileTicket)$('#wfs52-file-status').textContent='Preview unavailable: '+e.message;}
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
  $('#wfs52-agenda-copy').addEventListener('click',()=>void wfs52CopyAgenda());
  $('#wfs52-review-mode').addEventListener('change',()=>wfs52RenderReviewQueue(cardsFromNote(flashcardNoteId)));
  $('#wfs52-review-next').addEventListener('click',wfs52AdvanceReview);
  $('#wfs52-weather-forget').addEventListener('click',wfs52ForgetWeather);
  $('#wfs52-volume-read').addEventListener('click',()=>void wfs52ReadVolume());
  const role=$('#wfs53-output-role');if(role)role.addEventListener('change',()=>{if(wfs52VolumeBusy)return;wfs52VolumeTicket++;wfs52Output=null;$('#wfs52-volume-status').textContent='Role changed. Read the chosen output before applying.';wfs52RenderVolume();});
  $('#wfs52-volume').addEventListener('input',wfs52RenderVolume);
  $('#wfs52-volume-apply').addEventListener('click',()=>void wfs52ApplyVolume(false));
  $('#wfs52-volume-mute').addEventListener('click',()=>void wfs52ApplyVolume(true));
  setInterval(wfs52RenderVolume,1000);
  $('#wfs52-file-select').addEventListener('change',()=>{wfs52ClearFilePreview();wfs52RenderFileChoices();});
  $('#wfs52-file-open').addEventListener('click',()=>void wfs52OpenFile());
  $('#wfs52-file-close').addEventListener('click',wfs52ClearFilePreview);
  $('#wfs52-file-forget').addEventListener('click',()=>{wfs52ShelfHandles.clear();wfs52ClearFilePreview();wfs52RenderFileChoices();});
  wfs52RenderTasks();wfs52RenderSeek();wfs52RenderEditors();wfs52RenderAgendaExport();wfs52RenderDataSummary();wfs52RenderVolume();wfs52RenderFileChoices();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs52Init,{once:true});else wfs52Init();
