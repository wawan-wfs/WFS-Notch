const fs=require('node:fs');const assert=require('node:assert/strict');
function suite(check,ctx,shelf,workspace,policy) {
  const elements=new Map();
  function $(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,replaceChildren(){}});return elements.get(id);}
  $('#shelf-search').value='';$('#shelf-sort').value='size';$('#phase48-shelf-kind').value='document';
  const entries=[{name:'photo.JPG',size:10,modified:1},{name:'report.pdf',size:5,modified:2},{name:'notes.txt',size:20,modified:3}];
  const view=new Function('$','entries',ctx+shelf+'\nlet shelfEntries=entries;return phase48VisibleShelf;')($,entries);
  check(view().map(r=>r.item.name).join(',')==='notes.txt,report.pdf','category and sort combine');
  check(view().map(r=>r.index).join(',')==='2,1','original indexes retained for removal');
  $('#shelf-search').value='report';
  check(view().length===1&&view()[0].index===1,'search and category combine');
  $('#phase48-shelf-kind').value='image';
  check(view().length===0,'empty filter');
  $('#shelf-search').value='';$('#phase48-shelf-kind').value='all';
  check(view().length===3,'clear category restores all metadata');
  let displayed=[];
  const audio=new Function('$','renderAudio',ctx+workspace+'\nreturn {set(groups){phase48AudioGroups=groups;},refresh:phase48RefreshAudioView};')($,groups=>{displayed=groups;});
  $('#phase48-audio-filter').value='default';
  audio.set([{kind:'output',status:'ok',endpoints:[{is_default:true},{is_default:false}]},{kind:'input',status:'denied',endpoints:[]}]);
  audio.refresh();
  check(displayed[0].endpoints.length===1&&displayed[1].status==='denied','audio filter retains denial status');
  check($('#phase48-audio-summary').textContent==='1 shown / 2 returned','audio counts');
  audio.set([]);audio.refresh();
  check($('#phase48-audio-summary').textContent==='No snapshot available.','audio clear summary');
  $('#phase48-activity-summary').textContent='Old private counts';
  const renderPolicy=new Function('$','data','nativeInvoke','appDataLoadStatus','let phase47LastPolicy=100,phase47PolicyPending=false,activityRequest=1,activityRows=[{}];function phase47Limit(n){return n;}'+policy+'\nreturn ()=>{phase47RenderPolicy();return {activityRequest,activityRows}};')($,{settings:{activity_history_limit:0}},true,'ready');
  const state=renderPolicy();
  check(state.activityRows.length===0&&state.activityRequest===2,'policy invalidates pending history');
  check($('#phase48-activity-summary').textContent==='No activity snapshot available.','policy clears outcome counts');
}
function cut(path,start,end){const s=fs.readFileSync(path,'utf8'),i=s.indexOf(start),j=s.indexOf(end,i);assert.ok(i>=0&&j>i,path);return s.slice(i,j);}
let count=0;
suite((c,n)=>{assert.ok(c,n);count++;},cut('src/features/phase48.js','function phase48AudioFilter','function phase48Focus'),cut('src/features/modules.js','function shelfView','let shelfEntries =')+cut('src/features/modules.js','function phase48VisibleShelf','function renderShelf'),cut('src/features/workspace.js','let phase48AudioGroups','function renderAudio'),cut('src/features/phase47.js','function phase47RenderPolicy','async function phase47ChangePolicy'));
console.log('PASS: '+count+' Phase 48 integration fixture assertions');
