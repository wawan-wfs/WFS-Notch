'use strict';
function wfs51FocusMinutes(value){
  return Number.isInteger(value)&&value>=1&&value<=120;
}
function wfs51TimerEstimate(state,remaining,now){
  if(!state||!Number.isFinite(remaining)||remaining<0||!Number.isFinite(now))return null;
  if(!Number.isSafeInteger(state.ends_at_ms)||remaining===0||state.ends_at_ms<=now)return null;
  return {end:state.ends_at_ms,remaining};
}
function wfs51HealthTargets(value){
  const keys=['water','breaks','calm'],bounds=[[1,30],[1,24],[1,180]],out={};
  for(let i=0;i<keys.length;i++){
    const v=value?.[keys[i]],[lo,hi]=bounds[i];
    if(!Number.isInteger(v)||v<lo||v>hi)return null;
    out[keys[i]]=v;
  }
  return out;
}
function wfs51HealthProgress(actual,targets){
  return [['water','water_glasses'],['breaks','break_count'],['calm','calm_minutes']].map(([key,source])=>{
    const count=Number.isSafeInteger(actual?.[source])&&actual[source]>=0?actual[source]:0;
    return {key,count,target:targets[key],fraction:Math.min(1,count/targets[key])};
  });
}
// Counter snapshots must be finite safe integers, distinct timestamps and non-resetting per adapter.
function wfs51NetworkSnapshot(raw){
  if(!raw||!Number.isSafeInteger(raw.sampled_at_ms)||raw.sampled_at_ms<0||!Array.isArray(raw.networks))return null;
  const byName=new Map(),duplicates=new Set();
  for(const r of raw.networks.slice(0,32)){
    if(!r||typeof r.name!=='string'||!r.name||r.name.length>256)continue;
    if(byName.has(r.name)||duplicates.has(r.name)){byName.delete(r.name);duplicates.add(r.name);continue;}
    if(!Number.isSafeInteger(r.received_bytes)||!Number.isSafeInteger(r.transmitted_bytes)||r.received_bytes<0||r.transmitted_bytes<0)continue;
    byName.set(r.name,{name:r.name,rx:r.received_bytes,tx:r.transmitted_bytes});
  }
  return {at:raw.sampled_at_ms,byName};
}
function wfs51NetworkRates(before,after){
  if(!before||!after)return {status:'baseline',rows:[]};
  const elapsed=(after.at-before.at)/1000;
  if(elapsed<1||elapsed>60)return {status:'interval',rows:[]};
  const rows=[];
  for(const [name,r] of after.byName){
    const old=before.byName.get(name);
    if(!old||r.rx<old.rx||r.tx<old.tx)continue;
    rows.push({name,rx:(r.rx-old.rx)/elapsed,tx:(r.tx-old.tx)/elapsed});
  }
  return {status:rows.length?'ok':'unmatched',elapsed,rows:rows.sort((a,b)=>(b.rx+b.tx)-(a.rx+a.tx)||a.name.localeCompare(b.name))};
}
function wfs51LapStats(laps){
  const values=Array.isArray(laps)?laps.slice(-30):[];
  const splits=[];
  for(let i=1;i<values.length;i++){
    if(Number.isFinite(values[i])&&Number.isFinite(values[i-1])&&values[i]>=values[i-1]&&values[i-1]>=0)
      splits.push({index:i+1,ms:values[i]-values[i-1]});
  }
  if(!splits.length)return {splits,fastest:null,slowest:null,average:null};
  return {splits,fastest:Math.min(...splits.map(x=>x.ms)),slowest:Math.max(...splits.map(x=>x.ms)),average:splits.reduce((s,r)=>s+r.ms,0)/splits.length};
}
function wfs51RainWindow(forecast,threshold){
  const current=forecast?.current?.time,h=forecast?.hourly;
  const stamp=t=>typeof t==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
  if(!stamp(current)||!Array.isArray(h?.time)||!Array.isArray(h?.precipitation_probability)||!Number.isInteger(threshold)||threshold<0||threshold>100)return null;
  const rows=[];
  for(let i=0;i<Math.min(h.time.length,168);i++){
    const time=h.time[i],p=h.precipitation_probability[i];
    if(stamp(time)&&time>=current&&Number.isFinite(p)&&p>=0&&p<=100)rows.push({time,p});
  }
  rows.sort((a,b)=>a.time.localeCompare(b.time));
  const unique=rows.filter((r,i)=>i===0||r.time!==rows[i-1].time).slice(0,12);
  return {hours:unique.length,peak:unique.length?Math.max(...unique.map(r=>r.p)):null,above:unique.filter(r=>r.p>=threshold)};
}

let wfs51Targets={water:8,breaks:3,calm:5},wfs51TargetSignature='',wfs51LastNetwork=null,wfs51Weather=null,wfs51LapSignature='';
function wfs51RenderTimers(){
  const focus=$('#phase51-focus-end'),count=$('#phase51-countdown-end');if(!focus||!count)return;
  const now=Date.now(),fmt=x=>new Date(x).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  if(appDataLoadStatus!=='ready'){focus.textContent=count.textContent='Local timer state unavailable.';return;}
  const fv=focusView(data.focus,now),cv=countdownView();
  const a=wfs51TimerEstimate(data.focus,fv.remaining,now),b=wfs51TimerEstimate(data.countdown,cv.remaining,now);
  const fa=a?'Current phase ends '+fmt(a.end):'No active focus deadline';
  const ca=b?'Countdown ends '+fmt(b.end):'No active countdown deadline';
  if(focus.textContent!==fa)focus.textContent=fa;if(count.textContent!==ca)count.textContent=ca;
  $('#phase51-focus-apply').disabled=data.focus.phase!=='focus'||!wfs51FocusMinutes(Number($('#phase51-focus-minutes').value));
}
function wfs51RenderHealth(){
  const host=$('#phase51-health-progress');if(!host)return;
  host.replaceChildren();
  if(appDataLoadStatus!=='ready')return;
  const targets=wfs51HealthTargets(data.settings?.health_targets)||{water:8,breaks:3,calm:5};
  wfs51Targets=targets;
  const signature=JSON.stringify(targets);
  if(signature!==wfs51TargetSignature){wfs51TargetSignature=signature;for(const key of ['water','breaks','calm'])$('#phase51-'+key).value=String(targets[key]);}
  for(const r of wfs51HealthProgress(todayHealth(),wfs51Targets)){
    const row=node('div','phase51-goal'),label=node('span','',r.key+' · '+r.count+' / '+r.target);
    const meter=node('progress','');meter.max=1;meter.value=r.fraction;meter.setAttribute('aria-label',r.key+' personal target');
    row.append(label,meter);host.append(row);
  }
}
function wfs51ReadNetwork(raw){
  const host=$('#phase51-network-list'),status=$('#phase51-network-status');if(!host||!status)return;
  const next=wfs51NetworkSnapshot(raw),result=wfs51NetworkRates(wfs51LastNetwork,next);
  wfs51LastNetwork=next;host.replaceChildren();
  status.textContent=!next?'No valid native sample.':result.status==='ok'?'Average over '+result.elapsed.toFixed(1)+' s · matched adapter counters only.':result.status==='interval'?'Sampling interval outside 1–60 s. New baseline captured.':result.status==='unmatched'?'No matching non-reset counters. New baseline captured.':'First sample captured; refresh for a rate.';
  for(const r of result.rows.slice(0,12)){
    const line=node('div','phase51-network-row');line.append(node('b','',r.name),node('small','','↓ '+systemBytes(r.rx)+'/s · ↑ '+systemBytes(r.tx)+'/s'));host.append(line);
  }
}
function wfs51ClearNetwork(){
  wfs51LastNetwork=null;const host=$('#phase51-network-list'),status=$('#phase51-network-status');
  if(host)host.replaceChildren();if(status)status.textContent=nativeInvoke?'No rate baseline. Refresh System to sample.':'Requires native Windows counters.';
}
function wfs51RenderLaps(){
  const host=$('#phase51-lap-stats');if(!host)return;
  const signature=JSON.stringify(stopwatch.laps);if(signature===wfs51LapSignature)return;wfs51LapSignature=signature;
  const stats=wfs51LapStats(stopwatch.laps),fmt=n=>(n/1000).toFixed(2)+' s';
  host.textContent=stats.splits.length?stats.splits.length+' measured intervals · fastest '+fmt(stats.fastest)+' · slowest '+fmt(stats.slowest)+' · mean '+fmt(stats.average):'Record at least two laps for interval statistics.';
  $('#phase51-lap-copy').disabled=!stats.splits.length;
}
function wfs51CaptureWeather(place,forecast){
  wfs51Weather={place,forecast,at:Date.now()};wfs51RenderRain();
}
function wfs51ClearWeather(){
  wfs51Weather=null;const host=$('#phase51-rain-list'),status=$('#phase51-rain-status');if(host)host.replaceChildren();if(status)status.textContent='No forecast available.';
}
function wfs51RenderRain(){
  const host=$('#phase51-rain-list'),status=$('#phase51-rain-status');if(!host||!status)return;
  host.replaceChildren();
  if(!wfs51Weather){status.textContent='No forecast available.';return;}
  const threshold=Number($('#phase51-rain-threshold').value),r=wfs51RainWindow(wfs51Weather.forecast,threshold);
  if(!r||!r.hours){status.textContent='Precipitation probability unavailable.';return;}
  status.textContent=r.hours+' forecast hours · peak '+r.peak+'% · '+r.above.length+' at or above '+threshold+'% · retrieved '+new Date(wfs51Weather.at).toLocaleString();
  for(const x of r.above)host.append(node('p','phase51-rain-row',x.time.replace('T',' ')+' · '+x.p+'%'));
  if(!r.above.length)host.append(node('p','empty','No returned hours reach the threshold.'));
}
function wfs51Init(){
  const form=$('#phase51-focus-form');if(!form||form.dataset.ready==='true')return;form.dataset.ready='true';
  form.addEventListener('submit',async e=>{
    e.preventDefault();const minutes=Number($('#phase51-focus-minutes').value);
    if(appDataLoadStatus!=='ready'||!wfs51FocusMinutes(minutes)||data.focus.phase!=='focus')return;
    if((focusView(data.focus).running||data.focus.paused)&&!confirm('Replace the current focus session duration? The session will reset.'))return;
    $('#phase51-focus-apply').disabled=true;
    await mutation('set_focus_duration',{minutes});wfs51RenderTimers();
  });
  $('#phase51-focus-minutes').addEventListener('input',wfs51RenderTimers);
  $('#phase51-health-form').addEventListener('submit',async e=>{
    e.preventDefault();const value=wfs51HealthTargets({water:Number($('#phase51-water').value),breaks:Number($('#phase51-breaks').value),calm:Number($('#phase51-calm').value)});
    if(!value||appDataLoadStatus!=='ready')return;
    const button=$('#phase51-health-form button[type=submit]');if(button.disabled)return;button.disabled=true;
    try{const ok=await mutation('set_health_targets',{targets:value});$('#phase51-health-status').textContent=ok?'Personal targets updated and saved locally.':'Targets not saved; previous targets retained.';}finally{button.disabled=false;}
  });
  $('#phase51-network-clear').addEventListener('click',wfs51ClearNetwork);
  $('#phase51-rain-threshold').addEventListener('change',wfs51RenderRain);
  $('#phase51-lap-copy').addEventListener('click',async()=>{
    const stats=wfs51LapStats(stopwatch.laps);if(!stats.splits.length)return;
    try{await navigator.clipboard.writeText('retained_lap_index,interval_ms\n'+stats.splits.map(r=>r.index+','+Math.round(r.ms)).join('\n'));showInfo('Copied stopwatch intervals.');}catch{showError('Clipboard unavailable.');}
  });
  wfs51RenderTimers();wfs51RenderHealth();wfs51ClearNetwork();wfs51RenderLaps();wfs51ClearWeather();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wfs51Init,{once:true});else wfs51Init();
