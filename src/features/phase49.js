'use strict';
function plannerDate(key) {
  if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return null;
  const [y,m,d]=key.split('-').map(Number);
  if(y<2000||y>2099)return null;
  const date=new Date(y,m-1,d,0,0,0,0);
  return workspaceLocalDay(+date)===key?date:null;
}
function plannerShift(key,days) {
  const d=plannerDate(key);
  if(!d||!Number.isInteger(days))return null;
  d.setDate(d.getDate()+days);
  const next=workspaceLocalDay(+d);
  return plannerDate(next)?next:null;
}
function plannerBounds(key) {
  const d=plannerDate(key);if(!d)return null;
  const end=new Date(d);end.setDate(end.getDate()+1);
  return {key,start:+d,end:+end,next:workspaceLocalDay(+end)};
}
function plannerTaskOnDate(t,key) {
  const b=plannerBounds(key);
  return !!b&&Number.isFinite(t.due_at_ms)&&t.due_at_ms>=b.start&&t.due_at_ms<b.end;
}
function plannerEventOnDate(e,key) {
  const b=plannerBounds(key);if(!b)return false;
  if(e.all_day) {
    const s=e.all_day.start_date,x=e.all_day.end_date_exclusive;
    return !!plannerDate(s)&&!!plannerDate(x)&&s<x&&s<=key&&x>key;
  }
  const start=e.starts_at_ms,end=e.ends_at_ms??start+1;
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&start<b.end&&end>b.start;
}
// Conflict marking is O(n log n), with exclusive ends; point events have no invented duration.
function plannerMarkOverlaps(rows) {
  const timed=rows.filter(r=>r.kind==='event'&&!r.allDay&&r.end>r.start&&r.hasEnd)
    .sort((a,b)=>a.start-b.start||a.end-b.end);
  let maxEnd=-Infinity;
  for(let i=0;i<timed.length;i++){
    const r=timed[i],next=timed[i+1];
    r.overlap=r.start<maxEnd||!!next&&next.start<r.end;
    maxEnd=Math.max(maxEnd,r.end);
  }
}
function plannerDay(tasks,events,key) {
  const b=plannerBounds(key);if(!b)return {rows:[],tasks:0,events:0,conflicts:0};
  const rows=[];
  for(const t of tasks)if(!t.done&&plannerTaskOnDate(t,key))
    rows.push({kind:'task',title:String(t.title||'Untitled task'),start:t.due_at_ms,end:t.due_at_ms,allDay:false,priority:t.priority});
  for(const e of events)if(plannerEventOnDate(e,key)) {
    const allDay=!!e.all_day;
    rows.push({kind:'event',title:String(e.title||'Untitled event'),allDay,
      start:allDay?b.start:Math.max(b.start,e.starts_at_ms),
      end:allDay?b.end:Math.min(b.end,e.ends_at_ms??e.starts_at_ms+1),
      hasEnd:Number.isFinite(e.ends_at_ms),continued:!allDay&&e.starts_at_ms<b.start});
  }
  plannerMarkOverlaps(rows);
  rows.sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.start-b.start||a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title));
  return {rows,tasks:rows.filter(r=>r.kind==='task').length,events:rows.filter(r=>r.kind==='event').length,conflicts:rows.filter(r=>r.overlap).length};
}
function plannerWeek(tasks,events,key) {
  const date=plannerDate(key);if(!date)return [];
  const monday=plannerShift(key,-((date.getDay()+6)%7))||key;
  const days=[];
  for(let i=0;i<7;i++){
    const day=plannerShift(monday,i);
    if(day){const plan=plannerDay(tasks,events,day);days.push({key:day,...plan});}
  }
  return days;
}
function plannerActivityWindow(rows,mode,now) {
  if(!['24h','7d'].includes(mode))return rows;
  const period=(mode==='24h'?1:7)*86400000;
  return rows.filter(r=>Number.isFinite(r.at_ms)&&r.at_ms<=now&&r.at_ms>=now-period);
}
function plannerAudioSearch(groups,term) {
  const needle=String(term||'').trim().toLowerCase();
  return groups.map(g=>({...g,endpoints:g.endpoints.filter(e=>String(e.name||'').toLowerCase().includes(needle))}));
}
function plannerShelfCategories(rows) {
  const counts={image:0,document:0,media:0,other:0};
  for(const r of rows){const kind=phase48FileKind(r.name);counts[kind]++;}
  return counts;
}

let plannerSelected=null,plannerPage=0,plannerSignature='';
function plannerRender() {
  const host=$('#phase49-week');if(!host)return;
  const today=workspaceLocalDay(Date.now());
  if(!plannerSelected)plannerSelected=today;
  const date=$('#phase49-date'),status=$('#phase49-status'),list=$('#phase49-list');
  date.value=plannerSelected;
  if(appDataLoadStatus!=='ready'){
    plannerSignature='';host.replaceChildren();list.replaceChildren();
    status.textContent=appDataLoadStatus==='loading'?'Loading local planner…':'Planner unavailable: local state not loaded.';
    for(const id of ['phase49-open-tasks','phase49-open-events','phase49-more','phase49-prev','phase49-next'])$('#'+id).disabled=true;
    return;
  }
  const week=plannerWeek(data.todos||[],data.events||[],plannerSelected);
  const selected=week.find(d=>d.key===plannerSelected)||plannerDay(data.todos||[],data.events||[],plannerSelected);
  const sig=JSON.stringify([plannerSelected,plannerPage,week]);
  if(sig===plannerSignature)return;
  plannerSignature=sig;
  const active=document.activeElement?.dataset?.plannerDay;
  host.replaceChildren();
  for(const day of week){
    const button=node('button','planner-day');button.type='button';button.dataset.plannerDay=day.key;
    button.setAttribute('aria-pressed',String(day.key===plannerSelected));
    const d=plannerDate(day.key);
    button.setAttribute('aria-label',d.toLocaleDateString(undefined,{dateStyle:'full'})+', '+day.tasks+' tasks, '+day.events+' events');
    button.append(node('small','',d.toLocaleDateString(undefined,{weekday:'short'})),node('b','',String(d.getDate())),node('small','',day.tasks+'T · '+day.events+'E'));
    button.addEventListener('click',()=>plannerSelect(day.key,true));host.append(button);
  }
  status.textContent=selected.tasks+' open tasks · '+selected.events+' events · '+selected.conflicts+' timed events overlapping';
  list.replaceChildren();
  const count=Math.min(selected.rows.length,(plannerPage+1)*12);
  if(!count)list.append(node('p','empty','No open task deadlines or events for this date.'));
  for(const r of selected.rows.slice(0,count)){
    const line=node('div','planner-row');
    const time=r.allDay?'All day':r.continued?'Continues':new Date(r.start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    line.append(node('span','planner-time',time),node('b','',r.title),node('small','',r.kind==='task'?'Task · '+(['high','normal','low'].includes(r.priority)?r.priority:'normal'):r.overlap?'Event · overlap':'Event'));
    list.append(line);
  }
  $('#phase49-more').disabled=count>=selected.rows.length;
  $('#phase49-more').textContent=count<selected.rows.length?'Show 12 more ('+count+'/'+selected.rows.length+')':'All '+selected.rows.length+' shown';
  $('#phase49-open-tasks').disabled=false;$('#phase49-open-events').disabled=false;
  $('#phase49-prev').disabled=!plannerShift(plannerSelected,-7);$('#phase49-next').disabled=!plannerShift(plannerSelected,7);
  if(active)host.querySelector('[data-planner-day="'+active+'"]')?.focus({preventScroll:true});
}
function plannerSelect(key,focus=false) {
  if(!plannerDate(key))return false;
  plannerSelected=key;plannerPage=0;plannerSignature='';plannerRender();
  if(typeof wfs50RenderGaps==='function')wfs50RenderGaps();
  if(typeof wfs52RenderAgendaExport==='function')wfs52RenderAgendaExport();
  if(focus)$('#phase49-week').querySelector('[data-planner-day="'+key+'"]')?.focus({preventScroll:true});
  return true;
}
async function plannerOpen(route) {
  if(appDataLoadStatus!=='ready'||!plannerDate(plannerSelected)||!['todos','calendar'].includes(route))return;
  const day=plannerSelected;
  if(!await switchTab(route))return;
  const prefix=route==='todos'?'task':'event';
  $('#phase49-'+prefix+'-date').value=day;
  $('#workspace-'+prefix+'-filter').value=route==='todos'?'open':'all';
  $('#workspace-'+prefix+'-search').value='';
  if(route==='todos')renderTodos();else renderCalendar();
  $('#phase49-'+prefix+'-date').focus();
}
function plannerInit(){
  const date=$('#phase49-date');if(!date||date.dataset.ready==='true')return;
  date.dataset.ready='true';
  date.addEventListener('change',()=>{if(!plannerSelect(date.value)){date.value=plannerSelected;$('#phase49-status').textContent='Select a valid date from 2000 to 2099.';}});
  $('#phase49-prev').addEventListener('click',()=>plannerSelect(plannerShift(plannerSelected,-7)));
  $('#phase49-next').addEventListener('click',()=>plannerSelect(plannerShift(plannerSelected,7)));
  $('#phase49-today').addEventListener('click',()=>plannerSelect(workspaceLocalDay(Date.now())));
  $('#phase49-more').addEventListener('click',()=>{plannerPage++;plannerRender();});
  $('#phase49-open-tasks').addEventListener('click',()=>void plannerOpen('todos'));
  $('#phase49-open-events').addEventListener('click',()=>void plannerOpen('calendar'));
  for(const [prefix,render] of [['task',renderTodos],['event',renderCalendar]]){
    const field=$('#phase49-'+prefix+'-date');
    field.addEventListener('change',render);
    $('#phase49-'+prefix+'-reset').addEventListener('click',()=>{field.value='';render();field.focus();});
  }
  $('#phase49-activity-window').addEventListener('change',renderActivity);
  $('#phase49-audio-search').addEventListener('input',phase48RefreshAudioView);
  plannerRender();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',plannerInit,{once:true});else plannerInit();
