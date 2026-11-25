"""Real Chromium, isolated Phase 47 module with fixture IPC and app state. No native acceptance claim."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<!doctype html><html><head><meta charset="utf-8"></head><body><h1 style="font-size:15px;margin:0 0 8px">Phase 47 · Chromium fixture (mock IPC)</h1><div class="tabs"></div><div class="phase47-modulebar"><span id="phase47-module-label"></span><div><button id="phase47-jump-content">Content</button><button id="phase47-jump-nav">Modules</button></div></div><main><section class="panel active" id="panel-home"><div class="section-heading"><div><h2>Today</h2><p>Local agenda</p></div><span id="phase47-agenda-count" class="section-pill">—</span></div><section id="phase47-agenda" class="workspace-card"></section></section></main><label>Sort tasks<select id="phase47-task-sort"><option value="recent">Recent</option><option value="deadline">Deadline</option><option value="priority">Priority</option></select></label><label class="phase47-policy">Notification history<select id="activity-limit"><option value="0">Off</option><option value="25">25</option><option value="100">100</option><option value="200">200</option></select></label><p id="activity-policy-status"></p><button id="activity-read">Read</button><button id="activity-clear">Clear</button><p id="activity-status"></p><div id="activity-list"></div><p id="phase47-shelf-bytes"></p></body></html>'''
BRIDGE = '''const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function node(tag,cls,val){const e=document.createElement(tag);if(cls)e.className=cls;if(val!=null)e.textContent=val;return e;}
const names=['home','todos','notes','calendar','timer','system','health','day','countdown','weather','flashcards','habits','dock','media','tools','settings'];
for(const name of names){const b=node('button','tab'+(name==='home'?' active':''),name);b.dataset.tab=name;$('.tabs').append(b);}
let appDataLoadStatus='loading',nativeInvoke=()=>{},activityRequest=0,activityRows=[],failWrite=false,holdWrite=false,sortCalls=0,requests=[];
const now=new Date(2026,10,25,12).getTime();Date.now=()=>now;
let data={settings:{activity_history_limit:0},todos:[{title:'Undated',priority:'high'},{title:'Later task',due_at_ms:now+1000,priority:'low'},{title:'Earlier task',due_at_ms:now-1000,priority:'normal'},{title:'Completed',done:true,due_at_ms:now-2000}],events:[{title:'All day event',all_day:{start_date:'2026-11-25',end_date_exclusive:'2026-11-26'}},{title:'Afternoon event',starts_at_ms:now+2000}]};
function workspaceBounds(t){const start=new Date(t);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return {start:+start,end:+end,day:'2026-11-25'};}
function workspaceTaskMatch(item,filter,term,t){const b=workspaceBounds(t);return !item.done&&Number.isFinite(item.due_at_ms)&&item.due_at_ms>=b.start&&item.due_at_ms<b.end;}
function workspaceEventMatch(item,filter,term,t){const b=workspaceBounds(t);return item.all_day?item.all_day.start_date<=b.day&&item.all_day.end_date_exclusive>b.day:item.starts_at_ms<b.end&&(item.ends_at_ms??item.starts_at_ms+1)>b.start;}
function renderTodos(){sortCalls++;}
async function mutation(cmd,args){requests.push({cmd,args});if(holdWrite)await new Promise(r=>window.releaseWrite=r);if(failWrite)return false;data.settings.activity_history_limit=args.limit;phase47RenderPolicy();return true;}
'''
with sync_playwright() as pw:
    executable=which('chromium') or which('chromium-browser') or which('google-chrome')
    browser=pw.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':560,'height':420},device_scale_factor=1.5,bypass_csp=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.set_content(HTML)
    page.add_style_tag(content=':root{--accent:#d6b77a;--line:#555965;--panel:#15161b;--muted:#b4b8c4;--text:#f5f5f7}*{box-sizing:border-box}body{background:#111319;color:var(--text);font:12px Segoe UI,Arial;margin:12px}button,select{font:inherit;color:inherit;background:#22242b}.tabs{display:flex;overflow-x:auto;gap:4px}.tabs button{flex-shrink:0}.panel{padding:8px}.section-heading{display:flex;justify-content:space-between;align-items:center}.workspace-card{padding:10px;border:1px solid var(--line);border-radius:12px}.event-hint{font-size:11px}')
    page.add_style_tag(content=(ROOT/'src/styles/phase47.css').read_text())
    page.add_script_tag(content=BRIDGE)
    page.add_script_tag(content=(ROOT/'src/features/phase47.js').read_text())
    count=0
    def check(condition,label):
        global count
        assert condition,label
        count+=1
    check(page.locator('#activity-limit').is_disabled(),'load guard')
    check('Loading' in page.locator('#phase47-agenda').inner_text(),'loading agenda')
    check(page.locator('#phase47-module-label').inner_text()=='home · 1 / 16','module label')
    page.evaluate("() => {appDataLoadStatus='ready';phase47RenderPolicy();phase47RenderAgenda();}")
    check(page.locator('#activity-limit').input_value()=='0','default opt-out')
    check(page.locator('#phase47-agenda-count').inner_text()=='4 today','agenda total')
    check(page.locator('.phase47-agenda-row').first.get_by_text('All day event').is_visible(),'all-day first')
    check('Completed' not in page.locator('#phase47-agenda').inner_text(),'completed excluded')
    check(page.evaluate("phase47SortTasks(data.todos,'deadline').map(x=>x.title).join('|')")=='Earlier task|Later task|Undated|Completed','deadline order')
    check(page.evaluate("phase47SortTasks(data.todos,'priority').map(x=>x.title).join('|')")=='Undated|Earlier task|Later task|Completed','priority order')
    check(page.evaluate("phase47SortTasks(data.todos,'recent')[0].title")=='Completed','legacy recent order')
    page.locator('#phase47-task-sort').select_option('priority')
    check(page.evaluate('sortCalls')==1,'sort triggers render')
    check(page.evaluate("phase47Bytes([{item:{size:Number.MAX_SAFE_INTEGER}},{item:{size:Number.MAX_SAFE_INTEGER}}]).replace(/[^0-9]/g,'')")=='18014398509481982','exact large metadata size')
    page.evaluate("phase47ShelfSummary([{item:{size:123}}])")
    check('123 bytes' in page.locator('#phase47-shelf-bytes').inner_text(),'shelf summary')
    page.locator('#activity-limit').select_option('100')
    expect(page.locator('#activity-policy-status')).to_contain_text('100 entries')
    check(page.evaluate('requests[0].args.limit')==100,'native preference contract')
    check(page.evaluate('activityRequest')>=2,'stale read invalidated')
    page.evaluate('() => {window.confirm=()=>false;}')
    page.locator('#activity-limit').select_option('25')
    expect(page.locator('#activity-limit')).to_have_value('100')
    check(page.evaluate('requests.length')==1,'cancel reduction does not write')
    page.evaluate('() => {window.confirm=()=>true;}')
    check(page.evaluate('phase47Limit(99)')==0,'unknown limit fails closed')
    check(page.evaluate("phase47Agenda(Array.from({length:9},(_,i)=>({title:'Task '+i,due_at_ms:now+i})),[],now).rows.length") == 6,'agenda cap')
    evidence=ROOT/'test-results'
    evidence.mkdir(exist_ok=True)
    page.screenshot(path=str(evidence/'browser-phase47-fixture.png'),full_page=True)
    page.evaluate('() => {failWrite=true;}')
    page.locator('#activity-limit').select_option('200')
    expect(page.locator('#activity-limit')).to_have_value('100')
    check('could not be saved' in page.locator('#activity-status').inner_text(),'failed preference rollback')
    page.evaluate('() => {failWrite=false;holdWrite=true;}')
    page.locator('#activity-limit').select_option('0')
    page.wait_for_function("typeof window.releaseWrite === 'function'")
    check(page.locator('#activity-limit').is_disabled(),'pending mutation guard')
    page.evaluate('() => {holdWrite=false;window.releaseWrite();}')
    expect(page.locator('#activity-policy-status')).to_contain_text('Recording off')
    check(page.evaluate('data.settings.activity_history_limit')==0,'disable committed')
    page.locator('#phase47-jump-content').click()
    check(page.locator('#panel-home').evaluate('(el)=>el===document.activeElement'),'jump content focus')
    page.locator('#phase47-jump-nav').click()
    check(page.locator('.tab.active').evaluate('(el)=>el===document.activeElement'),'jump nav focus')
    page.evaluate("() => {$('.tab.active').classList.remove('active');$$('.tab')[15].classList.add('active');phase47SyncNav();}")
    check(page.locator('#phase47-module-label').inner_text()=='settings · 16 / 16','last module label')
    for index,name in enumerate(['home','todos','notes','calendar','timer','system','health','day','countdown','weather','flashcards','habits','dock','media','tools','settings']):
        page.evaluate('(i) => {$$(".tab").forEach((b,j)=>b.classList.toggle("active",i===j));phase47SyncNav();}',index)
        check(page.locator('#phase47-module-label').inner_text()==f'{name} · {index+1} / 16','module indicator '+name)
    page.evaluate("() => {appDataLoadStatus='error';phase47RenderAgenda();phase47RenderPolicy();}")
    check(page.locator('#phase47-agenda-count').inner_text()=='—','error clears stale count')
    check('unavailable' in page.locator('#phase47-agenda').inner_text(),'error message')
    check(page.locator('#activity-limit').is_disabled(),'error prevents mutation')
    page.evaluate("() => {appDataLoadStatus='ready';nativeInvoke=null;phase47RenderPolicy();}")
    check(page.locator('#activity-limit').is_disabled(),'preview prevents native mutation')
    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),'no horizontal overflow in fixture')
    check(not errors,'page errors: '+str(errors))
    print(f'PASS: {count} isolated Chromium Phase 47 assertions (fixture IPC)')
    browser.close()
