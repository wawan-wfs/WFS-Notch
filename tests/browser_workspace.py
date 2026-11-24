"""Isolated Chromium regression of exact workspace.js; IPC and surrounding app are fixtures.
This is not a full-app screenshot or Windows/native acceptance test.
"""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<main><nav><button class="tab" data-tab="todos">Tasks</button><button class="tab" data-tab="calendar">Calendar</button></nav>
<button id="go-overdue" data-workspace-go="todos" data-workspace-filter="overdue">Overdue</button>
<button id="go-today" data-workspace-go="calendar" data-workspace-filter="today">Today</button>
<b id="workspace-overdue"></b><b id="workspace-today"></b><b id="workspace-events"></b><p id="workspace-summary"></p>
<input id="workspace-task-search"><select id="workspace-task-filter"><option value="all">All</option><option value="overdue">Overdue</option><option value="high">High</option></select><p id="workspace-task-count"></p><div id="task-fixture"></div>
<input id="workspace-event-search"><select id="workspace-event-filter"><option value="all">All</option><option value="today">Today</option><option value="upcoming">Upcoming</option><option value="past">Past</option></select><p id="workspace-event-count"></p><div id="event-fixture"></div>
<select id="activity-kind"><option value="all">All</option><option value="task">Task</option><option value="calendar">Calendar</option></select>
<select id="activity-outcome"><option value="all">All</option><option value="retry_exhausted">Exhausted</option></select>
<button id="activity-read">Read activity</button><button id="activity-clear" disabled>Clear history</button><p id="activity-status"></p><div id="activity-list"></div>
<button id="audio-read">Read audio devices</button><button id="audio-clear" disabled>Clear audio list</button><p id="audio-status"></p><div id="audio-list"></div></main>'''
BRIDGE = '''const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function node(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;if(value!=null)el.textContent=value;return el;}
const now=new Date(2026,10,24,12).getTime();Date.now=()=>now;
let appDataLoadStatus='loading';
let data={todos:[{title:'Pay bill',done:false,due_at_ms:now-1000,priority:'high'},{title:'Call team',done:false,due_at_ms:now+1000},{title:'Completed task',done:true,due_at_ms:now-1000}],events:[{title:'Today agenda',all_day:{start_date:'2026-11-24',end_date_exclusive:'2026-11-25'}},{title:'Tomorrow agenda',starts_at_ms:now+86400000}]};
let allowNav=true, lastTab='', failClear=false, failRead=false, audioPending=false;
const nativeInvoke=()=>{};
const audioResponse={output:{status:'ok',endpoints:[{name:'Fixture speaker',enabled:true,is_default:true,id:'private-id'}]},input:{status:'denied',endpoints:[{name:'Forbidden input'}]}};
let activities=[{at_ms:now,kind:'task',outcome:'enqueue_accepted',attempt:1,title:'PRIVATE TITLE'},{at_ms:now-1,kind:'calendar',outcome:'retry_exhausted',attempt:3}];
async function invoke(cmd){if(cmd==='get_notification_activity'){if(failRead)throw Error('unavailable');return activities;}if(cmd==='clear_notification_activity'){if(failClear)throw Error('write failure');activities=[];return true;}if(cmd==='get_audio_inventory'){if(audioPending)return new Promise(r=>window.releaseAudio=r);return audioResponse;}throw Error('unexpected '+cmd);}
function deviceDeadline(read,milliseconds){let timer;return Promise.race([Promise.resolve().then(read),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DEVICE_TIMEOUT')),milliseconds);})]).finally(()=>clearTimeout(timer));}
function renderTodos(){$('#task-fixture').replaceChildren(...workspaceTasks(data.todos).map(x=>node('p','',x.title)));}
function renderCalendar(){$('#event-fixture').replaceChildren(...workspaceEvents(data.events).map(x=>node('p','',x.title)));}
async function switchTab(tab){if(!allowNav)return false;lastTab=tab;return true;}
'''

with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True,
                                  args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 560, 'height': 420}, bypass_csp=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(HTML)
    page.add_script_tag(content=BRIDGE)
    page.add_script_tag(content=(ROOT / 'src/features/workspace.js').read_text(encoding='utf-8'))
    count = 0
    def check(condition, label):
        global count
        assert condition, label
        count += 1
    check(page.locator('#workspace-overdue').inner_text() == '—', 'loading does not fabricate zero')
    page.evaluate("() => {appDataLoadStatus='error';workspaceRender();}")
    check('could not be loaded' in page.locator('#workspace-summary').inner_text(), 'load error')
    page.evaluate("() => {appDataLoadStatus='ready';workspaceRender();}")
    check(page.locator('#workspace-overdue').inner_text() == '1', 'overdue total')
    check(page.locator('#workspace-today').inner_text() == '2', 'today tasks')
    check(page.locator('#workspace-events').inner_text() == '1', 'today all-day event')
    page.locator('#workspace-task-search').fill('call')
    check(page.locator('#task-fixture').inner_text() == 'Call team', 'title filter')
    page.locator('#go-overdue').click()
    expect(page.locator('#workspace-task-filter')).to_have_value('overdue')
    check(page.locator('#task-fixture').inner_text() == 'Pay bill', 'dashboard filtered route')
    check(page.locator('.tab[data-tab="todos"]').evaluate('(el)=>el===document.activeElement'), 'focus restored')
    page.evaluate('() => {allowNav=false;}')
    page.locator('#go-today').click()
    check(page.locator('#workspace-event-filter').input_value() == 'all', 'navigation guard')
    page.evaluate('() => {allowNav=true;}')
    page.locator('#go-today').click()
    expect(page.locator('#workspace-event-filter')).to_have_value('today')
    check(page.locator('#event-fixture').inner_text() == 'Today agenda', 'today event filter')
    page.locator('#workspace-event-filter').select_option('upcoming')
    check('Tomorrow agenda' in page.locator('#event-fixture').inner_text(), 'upcoming event')
    page.locator('#activity-read').click()
    expect(page.locator('#activity-status')).to_contain_text('2 local entries')
    check('PRIVATE TITLE' not in page.locator('#activity-list').inner_text(), 'no private history fields')
    check(page.locator('#activity-list .module-item').count() == 2, 'history entries')
    page.locator('#activity-kind').select_option('calendar')
    check(page.locator('#activity-list .module-item').count() == 1, 'history kind filter')
    page.locator('#activity-outcome').select_option('retry_exhausted')
    check('Retry exhausted' in page.locator('#activity-list').inner_text(), 'outcome filter')
    page.evaluate('() => {failClear=true;}')
    page.locator('#activity-clear').click()
    expect(page.locator('#activity-status')).to_contain_text('Clear failed')
    check(page.locator('#activity-clear').is_enabled(), 'clear failure allows retry')
    check(page.locator('#activity-list .module-item').count() == 1, 'failed clear preserves list')
    page.evaluate('() => {failClear=false;}')
    page.locator('#activity-clear').click()
    expect(page.locator('#activity-status')).to_contain_text('reservations unchanged')
    check('No matching activity' in page.locator('#activity-list').inner_text(), 'clear history')
    page.evaluate('() => {failRead=true;}')
    page.locator('#activity-read').click()
    expect(page.locator('#activity-status')).to_contain_text('unavailable')
    check(page.locator('#activity-read').is_enabled(), 'failed read allows retry')
    page.locator('#audio-read').click()
    expect(page.locator('#audio-status')).to_contain_text('Snapshot complete')
    check('Fixture speaker' in page.locator('#audio-list').inner_text(), 'audio rendered')
    check('Access denied by Windows' in page.locator('#audio-list').inner_text(), 'audio denial')
    check('Forbidden input' not in page.locator('#audio-list').inner_text(), 'denied group not leaked')
    check('private-id' not in page.locator('#audio-list').inner_text(), 'no endpoint identifier')
    page.evaluate('() => {audioPending=true;}')
    page.locator('#audio-read').click()
    page.wait_for_function("typeof window.releaseAudio === 'function'")
    check(page.locator('#audio-read').is_disabled(), 'pending audio')
    page.locator('#audio-clear').click()
    page.evaluate('async () => {window.releaseAudio(audioResponse);await Promise.resolve();await Promise.resolve();}')
    check(page.locator('#audio-list').inner_text() == '', 'stale response ignored')
    check(page.locator('#audio-read').is_enabled(), 'clear recovers button')
    check(page.locator('#audio-read').evaluate('(el)=>el===document.activeElement'), 'audio focus restored')
    page.evaluate('() => readAudio(() => Promise.reject(Error("fixture timeout")))')
    check('unavailable' in page.locator('#audio-status').inner_text(), 'audio failed state')
    page.evaluate('() => readActivity(null)')
    check('requires the installed windows app' in page.locator('#activity-status').inner_text().lower(), 'preview honesty')
    check(not errors, 'browser JavaScript errors: '+str(errors))
    print(f'PASS: {count} isolated Chromium workspace assertions (mock IPC, not native acceptance)')
    browser.close()
