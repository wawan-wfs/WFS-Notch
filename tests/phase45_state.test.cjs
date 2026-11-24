const assert = require('node:assert/strict');
const fs = require('node:fs');
async function suite(check, shelfSource, deviceSource, telemetrySource) {
  function element(tag='', cls='', value='') {
    return {tag,className:cls,textContent:value,children:[],style:{},disabled:false,value:'',checked:false,files:[],events:{},
      replaceChildren(...nodes){this.children=nodes;},
      append(...nodes){this.children.push(...nodes);},
      setAttribute(k,v){this[k]=v;},
      addEventListener(k,fn){this.events[k]=fn;},
      querySelectorAll(k){return this.children.flatMap(x=>x.children.filter(y=>y.tag===k));},
      focus(){focused=this;},
      fire(k){this.events[k]?.({target:this});}
    };
  }
  let focused=null;
  const els=new Map(), $=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
  let saved=null, writeError=false, removeError=false;
  const storage={getItem:()=>saved,setItem:(_,v)=>{if(writeError)throw Error('quota');saved=v;},removeItem:()=>{if(removeError)throw Error('denied');saved=null;}};
  const makeShelf=()=>new Function('$','node','localStorage',shelfSource+
    '\nreturn {initShelf,shelfDecode,entries:()=>shelfEntries,remember:()=>shelfRemember};')($,element,storage);
  $('#shelf-sort').value='added';
  let shelf=makeShelf(); shelf.initShelf();
  check(!shelf.remember()&&saved===null,'initial consent off');
  $('#shelf-input').files=[{name:'alpha.txt',size:1,lastModified:1},{name:'beta.txt',size:5,lastModified:2}];
  $('#shelf-input').fire('change');
  check(shelf.entries().length===2&&saved===null,'session-only add');
  $('#shelf-remember').checked=true;$('#shelf-remember').fire('change');
  check(shelf.remember()&&shelf.shelfDecode(saved).entries.length===2,'enable persistence');
  shelf=makeShelf();shelf.initShelf();
  check(shelf.remember()&&shelf.entries().length===2,'restart restore');
  $('#shelf-sort').value='size';$('#shelf-sort').fire('change');
  check($('#shelf-list').children[0].children[0].children[0].textContent==='beta.txt','sorted rendering');
  $('#shelf-search').value='alpha';$('#shelf-search').fire('input');
  check($('#shelf-filter-count').textContent==='1 of 2 shown','filter count');
  writeError=true;$('#shelf-list').children[0].children[1].fire('click');
  check(shelf.entries().length===2&&shelf.shelfDecode(saved).entries.length===2,'failed delete rollback');
  writeError=false;$('#shelf-list').children[0].children[1].fire('click');
  check(shelf.entries()[0].name==='beta.txt'&&focused===$('#shelf-input'),'filtered delete correct index and focus');
  removeError=true;$('#shelf-forget').fire('click');
  check(shelf.remember()&&saved!==null&&$('#shelf-status').textContent.includes('may remain'),'forget failure visible');
  removeError=false;$('#shelf-forget').fire('click');
  check(!shelf.remember()&&saved===null,'forget success');
  shelf=makeShelf();shelf.initShelf();
  check(shelf.entries().length===0,'restart after forget');
  saved='{"version":1,"enabled":true,"entries":[],"path":"private"}';
  shelf=makeShelf();shelf.initShelf();
  check(shelf.entries().length===0&&!shelf.remember()&&!$('#shelf-forget').disabled,'corrupt restore fails closed');
  $('#shelf-forget').fire('click');check(saved===null,'corrupt storage can be cleared');
  // The timers are deterministic fixtures; native IPC and WebView are not exercised.
  let timers=new Map(),seq=0;
  const setTimer=fn=>{const id=++seq;timers.set(id,fn);return id;};
  const clearTimer=id=>timers.delete(id);
  const device=new Function('$','node','nativeInvoke','invoke','setTimeout','clearTimeout','systemBytes',deviceSource+
    '\nreturn {readDeviceInfo,clearDeviceInfo};')($,element,null,()=>{},setTimer,clearTimer,n=>n+' B');
  await device.readDeviceInfo();
  check($('#device-status').textContent.includes('requires the installed Windows app'),'preview honest');
  await device.readDeviceInfo(()=>Promise.resolve({os_name:'Fixture',architecture:'x64',logical_cpus:4,memory_total_bytes:1024,uptime_seconds:3601}));
  check($('#device-results').children.length===7,'seven device rows');
  check($('#device-results').children[1].children[0].children[1].textContent==='Unavailable','missing field');
  await device.readDeviceInfo(()=>Promise.reject(Error('denied')));
  check($('#device-status').textContent.includes('failed')&&!$('#device-read').disabled,'device failure recovered');
  let resolve;const pending=device.readDeviceInfo(()=>new Promise(r=>{resolve=r;}));await Promise.resolve();
  device.clearDeviceInfo();resolve({os_name:'stale'});await pending;
  check($('#device-results').children.length===0&&$('#device-status').textContent==='Device information cleared.','late response after clear rejected');
  const timeout=device.readDeviceInfo(()=>new Promise(()=>{}));await Promise.resolve();
  for(const fn of [...timers.values()])fn();await timeout;
  check($('#device-status').textContent.includes('timed out')&&!$('#device-read').disabled,'timeout recovers controls');
  let response;
  const telemetry=new Function('$','nativeInvoke','invoke', 'let telemetryPending=false,activeTab="system",telemetryLastAt=0;\n'+telemetrySource+'\nreturn refreshTelemetry;')($,true,async()=>{if(response instanceof Error)throw response;return response;});
  response={memory_total_bytes:100,memory_used_bytes:50,cpu_percent:20,sampled_at_ms:1};await telemetry();
  check($('#system-cpu').textContent==='20%'&&$('#system-memory').textContent==='50%','valid telemetry');
  response={...response,memory_used_bytes:200};await telemetry();
  check($('#system-cpu').textContent==='—'&&$('#memory-meter').style.width==='0%','invalid snapshot clears old numbers');
  response=new Error('offline');await telemetry();
  check($('#system-detail').textContent.includes('failed'),'telemetry error state');
  response=null;await telemetry();check($('#system-detail').textContent.includes('unavailable'),'native null distinguished from preview');
}
function part(path,start,end){const s=fs.readFileSync(path,'utf8');const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);}
let count=0;
suite((c,n)=>{assert.ok(c,n);count++;},part('src/features/modules.js','const SHELF_KEY =','function initExtras()'),part('src/features/system.js','function deviceDeadline','function initSystemDetails'),part('src/app.js','function resetTelemetry','function checkReminders')).then(()=>console.log('PASS: '+count+' state fixture assertions')).catch(e=>{console.error(e);process.exitCode=1;});
