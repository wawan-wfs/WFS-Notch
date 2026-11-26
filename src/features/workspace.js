'use strict';
function workspaceLocalDay(at) {
  const d=new Date(at), pad=n=>String(n).padStart(2,'0');
  return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
}
function workspaceBounds(now) {
  const start=new Date(now); start.setHours(0,0,0,0);
  const end=new Date(start); end.setDate(end.getDate()+1);
  return {start:+start,end:+end,day:workspaceLocalDay(+start)};
}
function workspaceTaskMatch(task,filter,term,now) {
  if (!String(task.title||'').toLowerCase().includes(term.trim().toLowerCase())) return false;
  const due=task.due_at_ms, valid=Number.isFinite(due), bounds=workspaceBounds(now);
  if (filter==='open') return !task.done;
  if (filter==='done') return !!task.done;
  if (filter==='high') return !task.done && task.priority==='high';
  if (filter==='overdue') return !task.done && valid && due<now;
  if (filter==='today') return !task.done && valid && due>=bounds.start && due<bounds.end;
  return true;
}
function workspaceEventMatch(event,filter,term,now) {
  if (!String(event.title||'').toLowerCase().includes(term.trim().toLowerCase())) return false;
  const bounds=workspaceBounds(now);
  let today=false,past=false,valid=false;
  if (event.all_day) {
    const {start_date:start,end_date_exclusive:end}=event.all_day;
    valid=typeof start==='string'&&typeof end==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&end>start;
    today=valid&&start<=bounds.day&&end>bounds.day;
    past=valid&&end<=bounds.day;
  } else {
    const start=event.starts_at_ms, end=event.ends_at_ms??start+1;
    valid=Number.isFinite(start)&&Number.isFinite(end)&&end>start;
    today=valid&&start<bounds.end&&end>bounds.start;
    past=valid&&end<=now;
  }
  return filter==='today'?today:filter==='past'?past:filter==='upcoming'?valid&&!past:true;
}
const activityOutcomes={enqueue_accepted:'Enqueue accepted',retry_scheduled:'Retry scheduled',retry_exhausted:'Retry exhausted'};
function normalizeActivity(raw) {
  if (!Array.isArray(raw)) throw Error('Invalid activity response');
  return raw.slice(0,200).filter(row=>row&&['calendar','task'].includes(row.kind)&&
    Object.prototype.hasOwnProperty.call(activityOutcomes,row.outcome)&&Number.isSafeInteger(row.at_ms)&&
    row.at_ms>=0&&row.at_ms<=8640000000000000&&Number.isInteger(row.attempt)&&row.attempt>=1&&row.attempt<=3)
    .map(({at_ms,kind,outcome,attempt})=>({at_ms,kind,outcome,attempt})).sort((a,b)=>b.at_ms-a.at_ms);
}
function normalizeAudio(raw) {
  if (!raw||typeof raw!=='object') throw Error('Invalid audio response');
  return ['output','input'].map(kind=>{
    const group=raw[kind];
    if (!group||!['ok','partial','denied','unavailable'].includes(group.status)||!Array.isArray(group.endpoints)) throw Error('Invalid audio group');
    const visible=['ok','partial'].includes(group.status)?group.endpoints:[];
    return {kind,status:group.status,truncated:visible.length>0&&(group.truncated===true||visible.length>32),
      endpoints:visible.slice(0,32).filter(row=>row&&typeof row.name==='string'&&row.name.length<=200)
        .map(({name,enabled,is_default})=>({name,enabled:typeof enabled==='boolean'?enabled:null,is_default:typeof is_default==='boolean'?is_default:null}))};
  });
}

let workspaceReady=false, workspaceLastMinute=-1, activityRows=[], activityRequest=0, audioRequest=0;
let activitySnapshotAvailable=false;
function workspaceRender() {
  if (!workspaceReady) return;
  if (typeof phase47RenderAgenda === 'function') phase47RenderAgenda();
  if (typeof plannerRender === 'function') plannerRender();
  if (typeof appDataLoadStatus==='string'&&appDataLoadStatus!=='ready') {
    for (const id of ['workspace-overdue','workspace-today','workspace-events']) $('#'+id).textContent='—';
    $('#workspace-summary').textContent=appDataLoadStatus==='loading'?'Loading local planning state…':'Local data could not be loaded. Reopen the application or complete a successful update before relying on this summary.';
    return;
  }
  const now=Date.now(), tasks=data.todos||[], events=data.events||[];
  const overdue=tasks.filter(t=>workspaceTaskMatch(t,'overdue','',now)).length;
  const today=tasks.filter(t=>workspaceTaskMatch(t,'today','',now)).length;
  const count=events.filter(e=>workspaceEventMatch(e,'today','',now)).length;
  $('#workspace-overdue').textContent=String(overdue);
  $('#workspace-today').textContent=String(today);
  $('#workspace-events').textContent=String(count);
  $('#workspace-summary').textContent=overdue?'Review overdue tasks first.':'No overdue tasks. Review today’s plan.';
}
function workspaceTasks(items,now=Date.now()) {
  const date=$('#phase49-task-date')?.value;
  const result=items.filter(item=>workspaceTaskMatch(item,$('#workspace-task-filter').value,$('#workspace-task-search').value,now)&&(!date||typeof plannerTaskOnDate!=='function'||plannerTaskOnDate(item,date)));
  $('#workspace-task-count').textContent=result.length+' of '+items.length+' shown';
  return result;
}
function workspaceEvents(items,now=Date.now()) {
  const date=$('#phase49-event-date')?.value;
  const result=items.filter(item=>workspaceEventMatch(item,$('#workspace-event-filter').value,$('#workspace-event-search').value,now)&&(!date||typeof plannerEventOnDate!=='function'||plannerEventOnDate(item,date)));
  $('#workspace-event-count').textContent=result.length+' of '+items.length+' shown';
  return result;
}
function renderActivity() {
  if(!activitySnapshotAvailable)return;
  if(typeof wfs50RetainedActivity==='function')activityRows=wfs50RetainedActivity(activityRows,Date.now());
  const windowMode=$('#phase49-activity-window')?.value||'all';
  const source=typeof plannerActivityWindow==='function'?plannerActivityWindow(activityRows,windowMode,Date.now()):activityRows;
  const rows=source.filter(row=>($('#activity-kind').value==='all'||row.kind===$('#activity-kind').value)&&
    ($('#activity-outcome').value==='all'||row.outcome===$('#activity-outcome').value));
  if(typeof wfs52RenderActivityExport==='function')wfs52RenderActivityExport(rows);
  const list=$('#activity-list');list.replaceChildren();
  const summary=$('#phase48-activity-summary');
  if(summary&&typeof phase48ActivitySummary==='function') {const counts=phase48ActivitySummary(rows);summary.textContent=counts.enqueue_accepted+' accepted · '+counts.retry_scheduled+' retries · '+counts.retry_exhausted+' exhausted (shown entries)';}
  if (!rows.length) list.append(node('div','empty','No matching activity.'));
  for (const row of rows) {
    const line=node('div','module-item'), info=node('div','module-info');
    info.append(node('b','',activityOutcomes[row.outcome]),node('small','',
      (row.kind==='task'?'Task':'Calendar')+' · Attempt '+row.attempt+' · '+new Date(row.at_ms).toLocaleString()));
    line.append(info);list.append(line);
  }
}
async function readActivity(reader=nativeInvoke?()=>invoke('get_notification_activity'):null) {
  const ticket=++activityRequest, status=$('#activity-status');
  activityRows=[];activitySnapshotAvailable=false;$('#activity-list').replaceChildren();$('#activity-clear').disabled=true;
  if(typeof wfs52RenderActivityExport==='function')wfs52RenderActivityExport([]);
  const summary=$('#phase48-activity-summary');if(summary)summary.textContent='No activity snapshot available.';
  if (!reader) {status.textContent='Requires the installed Windows app.';return;}
  $('#activity-read').disabled=true; status.textContent='Reading local activity…';
  try {
    const rows=normalizeActivity(await deviceDeadline(reader,10000));
    if(ticket!==activityRequest)return;
    activityRows=rows;activitySnapshotAvailable=true;renderActivity();$('#activity-clear').disabled=false;
    status.textContent=rows.length+' local entries. Accepted means queued, not visibly delivered.';
  } catch {if(ticket===activityRequest)status.textContent='Activity unavailable or timed out. Retry.';}
  finally {if(ticket===activityRequest)$('#activity-read').disabled=false;}
}
async function clearActivity(clearer=nativeInvoke?()=>invoke('clear_notification_activity'):null) {
  if(!clearer)return;
  const ticket=++activityRequest;$('#activity-clear').disabled=true;$('#activity-read').disabled=true;
  $('#activity-status').textContent='Clearing local history…';
  try {
    // Do not apply a UI deadline to a mutation that may still commit later.
    if(await clearer()!==true)throw Error('Not cleared');
    if(ticket!==activityRequest)return;
    activityRows=[];activitySnapshotAvailable=true;renderActivity();$('#activity-status').textContent='History cleared. Reminder reservations unchanged.';
  } catch {if(ticket===activityRequest){$('#activity-status').textContent='Clear failed. Existing history may remain.';$('#activity-clear').disabled=false;}}
  finally {if(ticket===activityRequest)$('#activity-read').disabled=false;}
}
let phase48AudioGroups = [];
function phase48RefreshAudioView() {
  const control=$('#phase48-audio-filter'), summary=$('#phase48-audio-summary');
  if (!control || typeof phase48AudioFilter !== 'function') return;
  if (!phase48AudioGroups.length) { if(summary)summary.textContent='No snapshot available.'; return; }
  let filtered=phase48AudioFilter(phase48AudioGroups,control.value);
  if(typeof plannerAudioSearch==='function')filtered=plannerAudioSearch(filtered,$('#phase49-audio-search')?.value);
  if(summary)summary.textContent=filtered.reduce((n,g)=>n+g.endpoints.length,0)+' shown / '+phase48AudioGroups.reduce((n,g)=>n+g.endpoints.length,0)+' returned';
  renderAudio(filtered);
}
function renderAudio(groups) {
  const list=$('#audio-list');list.replaceChildren();
  for(const group of groups) {
    const section=node('div','audio-group'), title=node('b','',group.kind==='output'?'Output devices':'Input devices');
    section.append(title);
    if(group.status!=='ok') section.append(node('p','event-hint',group.status==='denied'?'Access denied by Windows.':group.status==='partial'?'Partial snapshot; some endpoints unavailable.':'Windows endpoint information unavailable.'));
    if(group.status==='ok'&&!group.endpoints.length)section.append(node('p','event-hint','No endpoints match this view.'));
    for(const endpoint of group.endpoints) {
      const info=node('div','module-item'), box=node('div','module-info');
      box.append(node('b','',endpoint.name||'Unnamed endpoint'),node('small','',
        (endpoint.enabled===true?'Enabled':endpoint.enabled===false?'Disabled':'State unavailable')+
        (endpoint.is_default===true?' · Default reported by Windows':'')));
      info.append(box);section.append(info);
    }
    if(group.truncated)section.append(node('p','event-hint','Showing at most 32 endpoints.'));
    list.append(section);
  }
}
async function readAudio(reader=nativeInvoke?()=>invoke('get_audio_inventory'):null) {
  const ticket=++audioRequest,status=$('#audio-status');
  $('#audio-list').replaceChildren();phase48AudioGroups=[];phase48RefreshAudioView();
  if(!reader){status.textContent='Requires the installed Windows app.';return;}
  $('#audio-read').disabled=true;$('#audio-clear').disabled=false;status.textContent='Reading local audio endpoints…';
  try {
    const groups=normalizeAudio(await deviceDeadline(reader,10000));
    if(ticket!==audioRequest)return;
    phase48AudioGroups=groups;
    if ($('#phase48-audio-filter') && typeof phase48AudioFilter === 'function') phase48RefreshAudioView(); else renderAudio(groups);
    status.textContent=typeof wfs50AudioStatus==='function'?wfs50AudioStatus(groups):'Snapshot complete. No device settings changed.';
  } catch {if(ticket===audioRequest)status.textContent='Audio inventory unavailable or timed out. Retry.';}
  finally {if(ticket===audioRequest)$('#audio-read').disabled=false;}
}
function clearAudio(){
  audioRequest++;$('#audio-list').replaceChildren();phase48AudioGroups=[];phase48RefreshAudioView();$('#audio-status').textContent='Audio list cleared.';
  $('#audio-read').disabled=false;$('#audio-clear').disabled=true;$('#audio-read').focus();
}
function initWorkspace(){
  if(workspaceReady)return;workspaceReady=true;
  $('#workspace-task-search').addEventListener('input',renderTodos);
  $('#workspace-task-filter').addEventListener('change',renderTodos);
  $('#workspace-event-search').addEventListener('input',renderCalendar);
  $('#workspace-event-filter').addEventListener('change',renderCalendar);
  for(const button of $$('[data-workspace-go]'))button.addEventListener('click',async()=>{
    const tab=button.dataset.workspaceGo;
    if(!await switchTab(tab))return;
    if(tab==='todos'&&button.dataset.workspaceFilter){$('#workspace-task-filter').value=button.dataset.workspaceFilter;$('#workspace-task-search').value='';if($('#phase49-task-date'))$('#phase49-task-date').value='';renderTodos();}
    if(tab==='calendar'&&button.dataset.workspaceFilter){$('#workspace-event-filter').value=button.dataset.workspaceFilter;$('#workspace-event-search').value='';if($('#phase49-event-date'))$('#phase49-event-date').value='';renderCalendar();}
    $$('.tab').find(b=>b.dataset.tab===tab)?.focus();
  });
  $('#activity-read').addEventListener('click',()=>void readActivity());
  $('#activity-clear').addEventListener('click',()=>{if(confirm('Clear WFS notification activity? Reminder reservations will not change.'))void clearActivity();});
  $('#activity-kind').addEventListener('change',renderActivity);$('#activity-outcome').addEventListener('change',renderActivity);
  $('#audio-read').addEventListener('click',()=>void readAudio());$('#audio-clear').addEventListener('click',clearAudio);
  workspaceRender();renderTodos();renderCalendar();
  setInterval(()=>{const minute=Math.floor(Date.now()/60000);if(minute!==workspaceLastMinute){workspaceLastMinute=minute;workspaceRender();}},1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initWorkspace,{once:true});else initWorkspace();
