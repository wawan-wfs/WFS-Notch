'use strict';
// Session-only models; never expose notification bodies or persist observed rows.
function wfs55OsRows(payload){
  if(!payload||!Array.isArray(payload.rows)||payload.rows.length>200||!Number.isSafeInteger(payload.total)||payload.total<0||payload.total>2000||payload.total<payload.rows.length||typeof payload.truncated!=='boolean')throw Error('Invalid Windows notification response');
  return payload.rows.map(r=>{
    if(!r||!Number.isSafeInteger(r.id)||r.id<0||r.id>4294967295||!Number.isSafeInteger(r.at_ms)||r.at_ms<0||r.at_ms>253402300799999||typeof r.app!=='string'||[...r.app].length>120||!r.app.trim()||/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(r.app))throw Error('Invalid notification metadata');
    return {id:r.id,at_ms:r.at_ms,app:r.app};
  });
}
function wfs55MergeHistory(previous,current){
  const seen=new Map();
  for(const r of [...previous,...current])seen.set(JSON.stringify([r.id,r.at_ms,r.app]),{id:r.id,at_ms:r.at_ms,app:r.app});
  return [...seen.values()].sort((a,b)=>b.at_ms-a.at_ms||a.id-b.id).slice(0,200);
}
function wfs55RoleMatrix(rows){
  const roles=['multimedia','console','communications'];
  if(!Array.isArray(rows)||rows.length!==3)throw Error('Invalid output role matrix');
  return roles.map(role=>{
    const matches=rows.filter(r=>r&&r.role===role);
    if(matches.length!==1)throw Error('Missing or duplicate output role');
    const r=matches[0];
    if(r.group===null&&r.percent===null&&r.muted===null)return {role,group:null,percent:null,muted:null};
    if(!Number.isInteger(r.group)||r.group<1||r.group>3||!Number.isInteger(r.percent)||r.percent<0||r.percent>100||typeof r.muted!=='boolean')throw Error('Invalid output role reading');
    return {role,group:r.group,percent:r.percent,muted:r.muted};
  });
}
function wfs55Utf8Size(value){
  let size=0;for(const ch of value){const cp=ch.codePointAt(0);size+=cp<=127?1:cp<=2047?2:cp<=65535?3:4;}return size;
}
function wfs55BundleText(items){
  if(!Array.isArray(items)||!items.length||items.length>10)throw Error('Choose 1–10 text files');
  let size=0;
  return items.map(item=>{
    if(!item||typeof item.name!=='string'||!item.name.trim()||typeof item.text!=='string'||item.text.includes(String.fromCharCode(0)))throw Error('Invalid text file');
    const name=item.name.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gu,' ');
    const section='=== '+name+' ===\n'+item.text;
    size+=wfs55Utf8Size(section)+2;
    if(size>131072)throw Error('Text bundle exceeds 128 KiB');
    return section;
  }).join('\n\n');
}
function wfs55MediaResult(receipt,sample,now){
  if(!receipt||!sample||receipt.source!==sample.source||!Number.isFinite(now)||now<receipt.at||now-receipt.at>15000)return 'unavailable';
  const expected=receipt.action==='play'?'Playing':receipt.action==='pause'?'Paused':null;
  return expected?(sample.playback_status===expected?'matched':'different'):'observed';
}
function wfs55Impact(review){
  if(!review)return null;
  return ['tasks','notes','events','habits','links'].reduce((a,k)=>({added:a.added+review[k].added,removed:a.removed+review[k].removed,changed:a.changed+review[k].changed}),{added:0,removed:0,changed:0});
}

function wfs56NotificationView(history,current,query,mode,now,age){
  const keys=new Set(current.map(r=>JSON.stringify([r.id,r.at_ms,r.app])));
  const term=String(query||'').trim().toLowerCase();
  if(!['all','current','previous'].includes(mode))throw Error('Invalid notification filter');
  if(!['all','hour','day'].includes(age)||!Number.isFinite(now))throw Error('Invalid notification time filter');
  const window=age==='hour'?3600000:age==='day'?86400000:Infinity;
  const rows=history.filter(r=>{
    const present=keys.has(JSON.stringify([r.id,r.at_ms,r.app]));
    return r.app.toLowerCase().includes(term)&&(mode==='all'||(mode==='current'?present:!present))&&(age==='all'||(r.at_ms<=now&&now-r.at_ms<=window));
  });
  const apps=new Map();
  for(const r of rows)apps.set(r.app,(apps.get(r.app)||0)+1);
  return {rows,apps:[...apps].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))};
}
function wfs56AudioGroups(rows){
  const groups=new Map();
  for(const r of rows){if(r.group===null)continue;const group=groups.get(r.group)||[];group.push(r.role);groups.set(r.group,group);}
  return [...groups.values()].map(roles=>roles.join(' / '));
}
function wfs56BundleSelection(records,handles,excluded){
  return records.filter(r=>wfs52PreviewKind(r)==='text'&&handles.has(wfs52ShelfKey(r))&&!excluded.has(wfs52ShelfKey(r))).map(r=>({key:wfs52ShelfKey(r),record:r,file:handles.get(wfs52ShelfKey(r))}));
}
function wfs56RestoreRisk(review){
  if(!review)return null;
  const rows=['tasks','notes','events','habits','links'].map(key=>({key,removed:review[key].removed,changed:review[key].changed,added:review[key].added}));
  return rows.filter(r=>r.removed||r.changed).sort((a,b)=>b.removed-a.removed||b.changed-a.changed);
}

let wfs55OsTicket=0,wfs55OsBusy=false,wfs55OsAllowed=false,wfs55History=[],wfs55Current=[];
const wfs55OsMessages={unpackaged:'Package identity unavailable (standard NSIS/portable). Optional MSIX required.',package_unavailable:'WFS package identity unavailable.',manifest_unavailable:'Installed package manifest could not be verified.',missing_capability:'Installed package does not declare userNotificationListener.',listener_unavailable:'Windows notification listener unavailable.',permission_request_unavailable:'Windows permission prompt unavailable.',denied:'Windows denied access. Change permissions in Windows Settings if desired.',unspecified:'Windows permission has not been granted.',allowed:'Windows permission allowed. Explicit session consent still required.',session_stopped:'Session stopped before permission completed.',unsupported:'Windows packaged listener required.'};
function wfs55OsButtons(){
  const check=$('#wfs55-os-check');if(!check)return;
  check.disabled=!nativeInvoke||wfs55OsBusy;
  $('#wfs55-os-consent').disabled=!nativeInvoke||wfs55OsBusy||wfs55OsAllowed;
  $('#wfs55-os-read').disabled=!nativeInvoke||wfs55OsBusy||!wfs55OsAllowed;
  $('#wfs55-os-stop').disabled=!nativeInvoke||(!wfs55OsBusy&&!wfs55OsAllowed&&!wfs55History.length);
}
function wfs55RenderOs(){
  const host=$('#wfs55-os-rows');if(!host)return;host.replaceChildren();
  const summary=$('#wfs56-os-summary');if(summary)summary.textContent='';
  if(!wfs55OsAllowed)return;
  const current=new Set(wfs55Current.map(r=>JSON.stringify([r.id,r.at_ms,r.app])));
  const view=wfs56NotificationView(wfs55History,wfs55Current,$('#wfs55-os-filter').value,$('#wfs56-os-mode').value,Date.now(),$('#wfs56-os-age').value);
  if(summary)summary.textContent=view.rows.length+' matching · '+view.apps.length+' apps'+(view.apps.length?' · '+view.apps.slice(0,3).map(([name,count])=>name+': '+count).join(' · '):'');
  for(const row of view.rows){
    const line=node('div','wfs55-notification-row');
    line.append(node('b','',row.app),node('span','',new Date(row.at_ms).toLocaleString()),node('small','',current.has(JSON.stringify([row.id,row.at_ms,row.app]))?'Present in latest returned rows':'Previously observed in this session'));
    host.append(line);
  }
  if(!host.children.length)host.append(node('p','event-hint','No matching observed notifications.'));
}
function wfs55StopOs(){
  const status=$('#wfs55-os-status');if(!status)return;
  const wasActive=wfs55OsBusy||wfs55OsAllowed||wfs55History.length;
  const ticket=++wfs55OsTicket;wfs55OsBusy=false;wfs55OsAllowed=false;wfs55History=[];wfs55Current=[];
  $('#wfs55-os-filter').value='';$('#wfs56-os-mode').value='all';$('#wfs56-os-age').value='all';wfs55RenderOs();wfs55OsButtons();
  if(wasActive){
    status.textContent='Session cleared. Windows system permission unchanged; revoke in Windows Settings if desired.';
    if(nativeInvoke)void invoke('stop_os_notification_session').catch(()=>{if(ticket===wfs55OsTicket)status.textContent='Local view cleared; Windows session stop not confirmed.';});
  }
}
async function wfs55OsAction(action){
  if(!nativeInvoke||wfs55OsBusy||activeTab!=='settings'||!isExpanded)return;
  if(action==='read'&&!wfs55OsAllowed)return;
  if(action==='consent'&&!confirm('Allow WFS Notch to read notification app names and times only when you request a snapshot in this session? No message contents or persistent history.'))return;
  const ticket=++wfs55OsTicket;wfs55OsBusy=true;wfs55OsButtons();
  const status=$('#wfs55-os-status');status.textContent='Waiting for Windows…';
  try{
    let result;
    if(action==='check')result=await deviceDeadline(()=>invoke('get_os_notification_access'),10000);
    else if(action==='consent')result=await invoke('request_os_notification_access');
    else result=await deviceDeadline(()=>invoke('read_os_notification_snapshot'),10000);
    if(ticket!==wfs55OsTicket||activeTab!=='settings'||!isExpanded)return;
    if(action==='read'){
      wfs55Current=wfs55OsRows(result);wfs55History=wfs55MergeHistory(wfs55History,wfs55Current);
      status.textContent=result.total+' Windows notification(s) reported · '+wfs55History.length+' observed in this session'+(result.truncated?' · partial snapshot':'')+'.';
      wfs55RenderOs();
    }else if(action==='consent'&&result==='allowed'){
      wfs55OsAllowed=true;status.textContent='Session allowed. Choose Read current notifications; no automatic collection.';
    }else{
      if(result!=='allowed'&&wfs55OsAllowed)wfs55StopOs();
      status.textContent=result==='allowed'&&wfs55OsAllowed?'Windows permission still allowed for this session. Read only on request.':wfs55OsMessages[result]||'Windows access could not be verified.';
    }
  }catch{
    if(ticket===wfs55OsTicket){wfs55StopOs();status.textContent='Windows access or read unavailable. Session cleared; explicitly allow again to retry.';}
  }finally{if(ticket===wfs55OsTicket){wfs55OsBusy=false;wfs55OsButtons();}}
}
let wfs55AudioTicket=0,wfs55AudioBusy=false;
function wfs55ClearAudio(){
  wfs55AudioTicket++;wfs55AudioBusy=false;
  const host=$('#wfs55-audio-rows');if(!host)return;host.replaceChildren();
  $('#wfs55-audio-status').textContent='Not requested.';
  $('#wfs55-audio-read').disabled=!nativeInvoke;$('#wfs55-audio-panel').disabled=!nativeInvoke;
}
async function wfs55ReadAudio(){
  if(!nativeInvoke||wfs55AudioBusy||activeTab!=='system')return;
  const ticket=++wfs55AudioTicket,host=$('#wfs55-audio-rows'),status=$('#wfs55-audio-status');
  wfs55AudioBusy=true;$('#wfs55-audio-read').disabled=true;host.replaceChildren();status.textContent='Reading Windows output roles…';
  try{
    const rows=wfs55RoleMatrix(await deviceDeadline(()=>invoke('get_output_role_matrix'),10000));
    if(ticket!==wfs55AudioTicket||activeTab!=='system'||!isExpanded)return;
    for(const row of rows){
      const card=node('div','wfs55-role-card');
      card.append(node('small','',row.role),node('b','',row.percent===null?'Unavailable':row.percent+'%'),node('span','',row.group===null?'No reading':'Group '+row.group+' · '+(row.muted?'Muted':'Unmuted')));
      host.append(card);
    }
    const groups=wfs56AudioGroups(rows);
    status.textContent='Read-only sequential Windows snapshot · '+groups.length+' available endpoint group(s) · '+(groups.join('; ')||'none')+'. Devices may change afterwards.';
  }catch{if(ticket===wfs55AudioTicket)status.textContent='Role matrix unavailable. Read again.';}
  finally{if(ticket===wfs55AudioTicket){wfs55AudioBusy=false;$('#wfs55-audio-read').disabled=false;}}
}
let wfs55BundleTicket=0,wfs55Bundle=null,wfs56BundleExcluded=new Set();
function wfs56RenderBundleChoices(){
  const host=$('#wfs56-bundle-choices');if(!host)return;
  const records=shelfEntries.filter(r=>wfs52PreviewKind(r)==='text'&&wfs52ShelfHandles.has(wfs52ShelfKey(r)));
  const signature=JSON.stringify(records.map(wfs52ShelfKey));if(host.dataset.signature===signature)return;
  host.dataset.signature=signature;host.replaceChildren();
  const keys=new Set(records.map(wfs52ShelfKey));for(const key of wfs56BundleExcluded)if(!keys.has(key))wfs56BundleExcluded.delete(key);
  for(const record of records){
    const key=wfs52ShelfKey(record),label=node('label','wfs56-bundle-choice'),box=node('input','');
    box.type='checkbox';box.checked=!wfs56BundleExcluded.has(key);
    box.addEventListener('change',()=>{if(box.checked)wfs56BundleExcluded.delete(key);else wfs56BundleExcluded.add(key);wfs55ClearBundle();});
    label.append(box,node('span','',record.name+' · '+record.size+' bytes'));host.append(label);
  }
  if(!records.length)host.append(node('p','event-hint','No eligible session text files.'));
}
function wfs55ClearBundle(){
  wfs55BundleTicket++;wfs55Bundle=null;
  const pre=$('#wfs55-bundle-text');if(!pre)return;pre.textContent='';pre.hidden=true;
  $('#wfs55-bundle-copy').disabled=true;$('#wfs55-bundle-review').disabled=false;$('#wfs55-bundle-status').textContent='No bundle reviewed.';
}
async function wfs55ReviewBundle(){
  if(activeTab!=='dock'||!isExpanded)return;
  wfs55ClearBundle();
  const ticket=wfs55BundleTicket,status=$('#wfs55-bundle-status'),pre=$('#wfs55-bundle-text');
  wfs56RenderBundleChoices();
  const selected=wfs56BundleSelection(shelfEntries,wfs52ShelfHandles,wfs56BundleExcluded);
  if(!selected.length||selected.length>10||selected.reduce((n,x)=>n+x.record.size,0)>131072){status.textContent='Choose 1–10 session text files totaling at most 128 KiB.';return;}
  $('#wfs55-bundle-review').disabled=true;status.textContent='Reading explicitly selected text files…';
  try{
    const items=[];
    for(const x of selected){
      const bytes=await x.file.arrayBuffer();
      if(ticket!==wfs55BundleTicket||activeTab!=='dock'||!isExpanded||wfs52ShelfHandles.get(x.key)!==x.file)return;
      if(bytes.byteLength!==x.record.size)throw Error('Selected file changed');
      items.push({name:x.record.name,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
    }
    const value=wfs55BundleText(items);
    if(ticket!==wfs55BundleTicket||selected.some(x=>wfs52ShelfHandles.get(x.key)!==x.file))return;
    wfs55Bundle={selected,value};pre.textContent=value;pre.hidden=false;
    $('#wfs55-bundle-copy').disabled=false;status.textContent=items.length+' text files reviewed. Nothing copied or persisted.';
  }catch(e){if(ticket===wfs55BundleTicket)status.textContent='Bundle unavailable: '+(e.message||String(e));}
  finally{if(ticket===wfs55BundleTicket)$('#wfs55-bundle-review').disabled=false;}
}
async function wfs55CopyBundle(){
  const review=wfs55Bundle;if(!review||activeTab!=='dock'||!isExpanded)return;
  if(review.selected.some(x=>wfs52ShelfHandles.get(x.key)!==x.file)){wfs55ClearBundle();return;}
  if(!confirm('Copy this reviewed text bundle to the system clipboard? Other apps may read it.'))return;
  try{await navigator.clipboard.writeText(review.value);if(wfs55Bundle===review)$('#wfs55-bundle-status').textContent='Reviewed bundle copied.';}
  catch{if(wfs55Bundle===review)$('#wfs55-bundle-status').textContent='Clipboard unavailable; no copy confirmed.';}
}
let wfs55MediaReceipt=null;
function wfs55ClearMedia(){
  wfs55MediaReceipt=null;const status=$('#wfs55-media-observation');if(status)status.textContent='No playback observation requested.';
}
function wfs55StartMediaObservation(source,action,accepted){
  wfs55ClearMedia();const status=$('#wfs55-media-observation');if(!status||activeTab!=='media'||!isExpanded)return;
  if(!accepted){status.textContent='Player declined command; no playback confirmation.';return;}
  wfs55MediaReceipt={source,action,at:Date.now(),minSequence:mediaReadSequence+1};
  status.textContent='Command accepted; waiting for a fresh Windows playback observation.';
}
function wfs55ObserveMedia(sample,readSequence){
  if(!wfs55MediaReceipt||activeTab!=='media'||!isExpanded||!Number.isSafeInteger(readSequence)||readSequence<wfs55MediaReceipt.minSequence)return;
  const result=wfs55MediaResult(wfs55MediaReceipt,sample,Date.now()),status=$('#wfs55-media-observation');
  if(result==='matched'){status.textContent='Observed matching Windows playback state: '+sample.playback_status+'. Readback, not proof of causation.';wfs55MediaReceipt=null;}
  else if(result==='different')status.textContent='Windows currently reports '+sample.playback_status+'; requested state not yet observed.';
  else if(result==='observed'){status.textContent='Fresh Windows state: '+sample.playback_status+'. Track skip/toggle outcome not independently proven.';wfs55MediaReceipt=null;}
  else if(!sample||Date.now()-wfs55MediaReceipt.at>15000){status.textContent='No matching fresh playback observation; refresh before retrying.';wfs55MediaReceipt=null;}
}
function wfs55RenderImpact(review){
  const host=$('#wfs55-restore-impact');if(!host)return;
  const result=wfs55Impact(review);
  host.textContent=result?'Impact across five record types: '+result.added+' added · '+result.removed+' removed · '+result.changed+' changed. Settings and reminder protections handled separately.':'No impact reviewed.';
  const risk=$('#wfs56-restore-risk');risk.replaceChildren();
  if(review)for(const row of wfs56RestoreRisk(review))risk.append(node('li','',row.key+': '+row.removed+' removed, '+row.changed+' changed'));
}
function wfs55Init(){
  const check=$('#wfs55-os-check');if(!check||check.dataset.ready==='true')return;check.dataset.ready='true';
  check.addEventListener('click',()=>void wfs55OsAction('check'));
  $('#wfs55-os-consent').addEventListener('click',()=>void wfs55OsAction('consent'));
  $('#wfs55-os-read').addEventListener('click',()=>void wfs55OsAction('read'));
  $('#wfs55-os-stop').addEventListener('click',wfs55StopOs);
  $('#wfs55-os-filter').addEventListener('input',wfs55RenderOs);
  $('#wfs56-os-mode').addEventListener('change',wfs55RenderOs);
  $('#wfs56-os-age').addEventListener('change',wfs55RenderOs);
  $('#wfs55-audio-read').addEventListener('click',()=>void wfs55ReadAudio());
  $('#wfs55-audio-panel').addEventListener('click',async()=>{if(!nativeInvoke)return;try{wfs55ClearAudio();await invoke('launch_builtin',{appName:'sound_control_panel'});$('#wfs55-audio-status').textContent='Windows Sound panel requested. Change the device there, then read again.';}catch{showError('Windows Sound control panel unavailable.');}});
  $('#wfs55-bundle-review').addEventListener('click',()=>void wfs55ReviewBundle());
  $('#wfs55-bundle-review').closest('details').addEventListener('toggle',wfs56RenderBundleChoices);
  $('#wfs55-bundle-copy').addEventListener('click',()=>void wfs55CopyBundle());
  $('#wfs55-bundle-clear').addEventListener('click',wfs55ClearBundle);
  window.addEventListener('focus',()=>{if(wfs55OsAllowed&&activeTab==='settings'&&!wfs55OsBusy)void wfs55OsAction('check');});
  wfs55OsButtons();wfs55ClearAudio();wfs55ClearBundle();wfs56RenderBundleChoices();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs55Init,{once:true});else wfs55Init();
