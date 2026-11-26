'use strict';
// Phase 47: local planning, privacy preferences and cross-module keyboard access.
const phase47Limits = [0,25,100,200];
function phase47Limit(value) {
  return phase47Limits.includes(value) ? value : 0;
}
function phase47SortTasks(items, mode) {
  const rows = items.map((item,index)=>({item,index}));
  const priority = {high:0,normal:1,low:2};
  const due = item => Number.isFinite(item.due_at_ms) ? item.due_at_ms : Infinity;
  const compareDue = (a,b) => due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0;
  if (mode === 'deadline' || mode === 'priority') {
    rows.sort((a,b)=>Number(Boolean(a.item.done))-Number(Boolean(b.item.done)) ||
      (mode==='priority' ? (priority[a.item.priority]??1)-(priority[b.item.priority]??1) : 0) ||
      compareDue(a.item,b.item) || b.index-a.index);
  } else rows.reverse();
  return rows.map(row=>row.item);
}
function phase47Agenda(tasks,events,now) {
  const bounds=workspaceBounds(now), rows=[];
  for (const item of tasks) {
    if (!workspaceTaskMatch(item,'today','',now)) continue;
    rows.push({kind:'Task',title:String(item.title||'Untitled task'),at:item.due_at_ms,allDay:false});
  }
  for (const item of events) {
    if (!workspaceEventMatch(item,'today','',now)) continue;
    rows.push({kind:'Event',title:String(item.title||'Untitled event'),at:item.all_day?bounds.start:item.starts_at_ms,allDay:Boolean(item.all_day)});
  }
  rows.sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.at-b.at||a.title.localeCompare(b.title));
  return {total:rows.length,rows:rows.slice(0,6)};
}
function phase47Bytes(rows) {
  let total=0n;
  for (const row of rows) if (Number.isSafeInteger(row.item.size)&&row.item.size>=0) total+=BigInt(row.item.size);
  return total.toLocaleString()+' bytes';
}
let phase47PolicyPending=false;
let phase47LastPolicy=null;
function phase47RenderPolicy() {
  const control=$('#activity-limit');
  if (!control) return;
  const limit=phase47Limit(data.settings?.activity_history_limit);
  control.value=String(limit);
  control.disabled=phase47PolicyPending||!nativeInvoke||appDataLoadStatus!=='ready';
  const note=$('#activity-policy-status');
  note.textContent=!nativeInvoke?'History recording requires the Windows app.':limit===0?'Recording off. New enqueue attempts will not be recorded.':`Recording up to ${limit} entries for 30 days. Local only.`;
  if (phase47LastPolicy!==limit) {
    phase47LastPolicy=limit;
    // Invalidate previously requested reads; do not render old history after opt-out.
    if (typeof activityRequest!=='undefined') {
      activityRequest++; activityRows=[];
      if(typeof activitySnapshotAvailable!=='undefined')activitySnapshotAvailable=false;
      if(typeof wfs52RenderActivityExport==='function')wfs52RenderActivityExport([]);
      $('#activity-list').replaceChildren();
      const summary=$('#phase48-activity-summary');
      if(summary)summary.textContent='No activity snapshot available.';
      $('#activity-read').disabled=false;
      $('#activity-clear').disabled=true;
      $('#activity-status').textContent='Read activity to refresh the current journal.';
    }
  }
}
async function phase47ChangePolicy() {
  const control=$('#activity-limit');
  if (!nativeInvoke||phase47PolicyPending||appDataLoadStatus!=='ready') return;
  const before=phase47Limit(data.settings?.activity_history_limit), next=Number(control.value);
  if (!phase47Limits.includes(next)||next===before) { phase47RenderPolicy(); return; }
  if (next<before&&!confirm('Reduce or disable notification history? Removed journal entries cannot be restored through the app. Backup copies may retain older data.')) { phase47RenderPolicy(); return; }
  phase47PolicyPending=true;control.disabled=true;
  try {
    const ok=await mutation('set_notification_activity_limit',{limit:next});
    if (!ok) $('#activity-status').textContent='Preference could not be saved. Previous setting retained.';
    else $('#activity-status').textContent='History preference saved. Reminder delivery rules unchanged.';
  } finally { phase47PolicyPending=false;phase47RenderPolicy(); }
}
function phase47RenderAgenda(now=Date.now()) {
  const list=$('#phase47-agenda');
  if (!list) return;
  list.replaceChildren();
  if (appDataLoadStatus!=='ready') {
    $('#phase47-agenda-count').textContent='—';
    list.append(node('p','event-hint',appDataLoadStatus==='loading'?'Loading local agenda…':'Agenda unavailable. Local data was not loaded.'));
    return;
  }
  const agenda=phase47Agenda(data.todos||[],data.events||[],now);
  $('#phase47-agenda-count').textContent=agenda.total+' today';
  if (!agenda.rows.length) list.append(node('p','empty','Nothing due or scheduled today.'));
  for (const row of agenda.rows) {
    const item=node('div','phase47-agenda-row');
    const time=row.allDay?'All day':new Date(row.at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    item.append(node('span','phase47-agenda-time',time),node('b','',row.title),node('small','',row.kind));
    list.append(item);
  }
  if (agenda.total>agenda.rows.length) list.append(node('p','event-hint','Showing first six entries. Open Tasks or Calendar for the full list.'));
}
function phase47ShelfSummary(visible) {
  const summary=$('#phase47-shelf-bytes');
  if (summary) summary.textContent=phase47Bytes(visible)+' in shown metadata';
}
function phase47SyncNav() {
  const label=$('#phase47-module-label'), active=$('.tabs .tab.active');
  if (!label||!active) return;
  const tabs=$$('.tabs .tab');
  label.textContent=active.textContent.trim()+' · '+(tabs.indexOf(active)+1)+' / '+tabs.length;
}
function phase47Init() {
  const jump=$('#phase47-jump-content');
  if (!jump||jump.dataset.ready==='true') return;
  jump.dataset.ready='true';
  jump.addEventListener('click',()=>{
    const panel=$('.panel.active');
    if (panel) {panel.tabIndex=-1;panel.focus({preventScroll:true});}
  });
  $('#phase47-jump-nav').addEventListener('click',()=>$('.tabs .tab.active')?.focus());
  $('#phase47-task-sort').addEventListener('change',()=>renderTodos());
  $('#activity-limit').addEventListener('change',()=>void phase47ChangePolicy());
  phase47SyncNav();phase47RenderPolicy();phase47RenderAgenda();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',phase47Init,{once:true});else phase47Init();
