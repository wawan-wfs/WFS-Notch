'use strict';
// No storage or network: derive local workbench data only on explicit request.
function wfs50Search(state,query,kind='all',includeBody=false) {
  const needle=String(query||'').trim().toLocaleLowerCase();
  if(!needle||needle.length>120)return {rows:[],total:0};
  const rows=[];
  const add=(type,id,title,extra,matched)=>{
    if(kind!=='all'&&kind!==type)return;
    if(typeof id!=='string'||!id||typeof title!=='string')return;
    if(!matched&&!title.toLocaleLowerCase().includes(needle))return;
    rows.push({type,id,title,extra});
  };
  for(const t of state.todos||[])add('task',t.id,t.title,t.done?'Completed':'Open',false);
  for(const e of state.events||[])add('event',e.id,e.title,'Calendar',false);
  for(const n of state.notes||[]){
    const tags=Array.isArray(n.tags)?n.tags.join(' '):'';
    const hit=tags.toLocaleLowerCase().includes(needle)||(includeBody&&typeof n.body==='string'&&n.body.toLocaleLowerCase().includes(needle));
    add('note',n.id,n.title||'Untitled note','Notes',hit);
  }
  for(const h of state.habits||[])add('habit',h.id,h.title,'Habit',false);
  for(const l of state.quick_links||[])add('link',l.id,l.label,'Pinned website',false);
  rows.sort((a,b)=>Number(!a.title.toLocaleLowerCase().startsWith(needle))-Number(!b.title.toLocaleLowerCase().startsWith(needle))||a.title.localeCompare(b.title)||a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
  return {rows:rows.slice(0,50),total:rows.length};
}
// Explicitly timed events only: no claim that a gap is genuinely free.
function wfs50Gaps(events,key,startHour,endHour,minMinutes) {
  const b=plannerBounds(key);
  if(!b||!Number.isInteger(startHour)||!Number.isInteger(endHour)||startHour<0||endHour>24||endHour<=startHour||!Number.isInteger(minMinutes)||minMinutes<5||minMinutes>180)return null;
  const first=new Date(b.start),last=new Date(b.start);
  first.setHours(startHour,0,0,0);last.setHours(endHour,0,0,0);
  const start=+first,end=+last;
  const occupied=[];
  let allDay=0,unknown=0;
  for(const e of events){
    if(!plannerEventOnDate(e,key))continue;
    if(e.all_day){allDay++;continue;}
    if(!Number.isFinite(e.ends_at_ms)){unknown++;continue;}
    const lo=Math.max(start,e.starts_at_ms),hi=Math.min(end,e.ends_at_ms);
    if(hi>lo)occupied.push([lo,hi]);
  }
  occupied.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let cursor=start,busy=0;const gaps=[];
  for(const [lo,hi] of occupied){
    if(lo>cursor&&lo-cursor>=minMinutes*60000)gaps.push({start:cursor,end:lo});
    if(hi>cursor){busy+=hi-Math.max(lo,cursor);cursor=hi;}
  }
  if(end>cursor&&end-cursor>=minMinutes*60000)gaps.push({start:cursor,end});
  return {gaps,busyMinutes:Math.round(busy/60000),windowMinutes:Math.round((end-start)/60000),allDay,unknown};
}
function wfs50AudioStatus(groups){
  const complete=groups.length===2&&groups.every(g=>g.status==='ok'&&!g.truncated);
  if(complete)return 'Snapshot complete. No device settings changed.';
  if(groups.every(g=>g.status==='denied'||g.status==='unavailable'))return 'No audio inventory available. Windows denied access or could not enumerate endpoints.';
  return 'Partial audio snapshot. Some endpoints may be missing; no device settings changed.';
}
function wfs50ShelfManifest(rows){
  return JSON.stringify({format:'wfs-notch-shelf-metadata',version:1,entries:rows.map(({item})=>({name:item.name,size:item.size,modified:item.modified}))},null,2);
}
function wfs50MediaSessions(raw){
  if(!Array.isArray(raw))return [];
  const bySource=new Map();
  for(const item of raw){
    if(!item||typeof item.source!=='string'||!item.source||item.source.length>1024)continue;
    const prev=bySource.get(item.source);
    if(prev)bySource.set(item.source,{...prev,ambiguous:true});
    else bySource.set(item.source,{...item});
  }
  return [...bySource.values()];
}

let wfs50SearchArmed=false,wfs50SearchVersion=0,wfs50GapArmed=false,wfs50SearchNavigating=false;
function wfs50RenderSearch(){
  const host=$('#phase50-search-results');if(!host||!wfs50SearchArmed)return;
  const ticket=++wfs50SearchVersion;
  host.replaceChildren();
  const status=$('#phase50-search-status');
  if(appDataLoadStatus!=='ready'){status.textContent='Local data is unavailable.';return;}
  const query=$('#phase50-search').value.trim();
  if(!query){status.textContent='Enter a search term.';return;}
  const result=wfs50Search(data,query,$('#phase50-search-kind').value,$('#phase50-search-body').checked);
  status.textContent=result.rows.length+' of '+result.total+' matching records. No data leaves this app.';
  for(const row of result.rows){
    const b=node('button','phase50-result');b.type='button';
    b.append(node('b','',row.title),node('small','',row.extra));
    b.addEventListener('click',async()=>{
      if(ticket!==wfs50SearchVersion)return;
      const route={task:'todos',event:'calendar',note:'notes',habit:'habits',link:'dock'}[row.type];
      if(wfs50SearchNavigating)return;
      wfs50SearchNavigating=true;
      let opened=false;try{opened=await switchTab(route);}finally{wfs50SearchNavigating=false;}
      if(!opened||ticket!==wfs50SearchVersion)return;
      if(row.type==='task'||row.type==='event'){
        const prefix=row.type==='task'?'task':'event';
        $('#workspace-'+prefix+'-search').value=row.title;
        $('#workspace-'+prefix+'-filter').value='all';
        $('#phase49-'+prefix+'-date').value='';
        if(prefix==='task')renderTodos();else renderCalendar();
        $('#workspace-'+prefix+'-search').focus();
      }else if(row.type==='note'){
        if(!data.notes.some(n=>n.id===row.id))return;
        $('#note-search').value='';$('#note-tag-filter').value='';
        selectedNoteId=row.id;renderNotes();$('#note-title').focus();
      }else{
        const list=$('#'+(row.type==='habit'?'habit-list':'quicklink-list'));
        list.tabIndex=-1;list.focus({preventScroll:true});list.scrollIntoView({block:'nearest'});
      }
      wfs50ClearSearch();
    });host.append(b);
  }
}
function wfs50ClearSearch(){
  wfs50SearchArmed=false;wfs50SearchVersion++;
  const field=$('#phase50-search');if(!field)return;
  field.value='';$('#phase50-search-body').checked=false;
  $('#phase50-search-results').replaceChildren();$('#phase50-search-status').textContent='Search on request; note bodies excluded by default.';
}
function wfs50RenderGaps(){
  const list=$('#phase50-gaps');if(!list||!wfs50GapArmed)return;
  list.replaceChildren();const status=$('#phase50-gap-status');
  if(appDataLoadStatus!=='ready'){status.textContent='Local data unavailable.';return;}
  const key=plannerSelected;
  const result=wfs50Gaps(data.events||[],key,Number($('#phase50-start').value),Number($('#phase50-end').value),Number($('#phase50-min').value));
  if(!result){status.textContent='Choose a valid date and time window.';return;}
  status.textContent=key+' · '+result.busyMinutes+' scheduled minutes of '+result.windowMinutes+' · '+result.allDay+' all-day and '+result.unknown+' unspecified-duration events excluded.';
  const fmt=t=>new Date(t).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  for(const r of result.gaps.slice(0,24))list.append(node('p','phase50-gap',fmt(r.start)+' – '+fmt(r.end)+' · '+Math.floor((r.end-r.start)/60000)+' min'));
  if(!result.gaps.length)list.append(node('p','empty','No gaps of the selected length.'));
  if(result.gaps.length>24)list.append(node('p','event-hint','Showing first 24 gaps.'));
}
function wfs50Init(){
  const form=$('#phase50-search-form');if(!form||form.dataset.ready==='true')return;
  form.dataset.ready='true';
  form.addEventListener('submit',e=>{e.preventDefault();wfs50SearchArmed=true;wfs50RenderSearch();});
  $('#phase50-search-clear').addEventListener('click',wfs50ClearSearch);
  for(const id of ['phase50-search','phase50-search-kind','phase50-search-body'])$('#'+id).addEventListener('input',()=>{wfs50SearchArmed=false;wfs50SearchVersion++;$('#phase50-search-results').replaceChildren();$('#phase50-search-status').textContent='Submit to search the current selection.';});
  $('#phase50-gap-form').addEventListener('submit',e=>{e.preventDefault();wfs50GapArmed=true;wfs50RenderGaps();});
  for(const id of ['phase50-start','phase50-end','phase50-min'])$('#'+id).addEventListener('input',()=>{wfs50GapArmed=false;$('#phase50-gaps').replaceChildren();$('#phase50-gap-status').textContent='Calculate to update the window.';});
  $('#phase50-shelf-copy').addEventListener('click',async()=>{
    const rows=phase48VisibleShelf();if(!rows.length)return;
    if(!confirm('Copy '+rows.length+' shown file metadata records to the clipboard? Names, sizes and modified timestamps only.'))return;
    try{await navigator.clipboard.writeText(wfs50ShelfManifest(rows));shelfStatus('Copied visible metadata JSON. Original files unchanged.');}
    catch{shelfStatus('Clipboard unavailable. Metadata was not copied.');}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs50Init,{once:true});else wfs50Init();
