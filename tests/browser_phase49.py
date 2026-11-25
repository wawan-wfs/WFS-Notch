"""Full browser-preview app with deterministic local fixture data, never a native Windows test."""
from pathlib import Path
import base64
import re
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
UI=ROOT/'src'
html=(UI/'index.html').read_text(encoding='utf-8')
styles=re.findall(r'<link rel="stylesheet" href="([^"]+)">',html)
scripts=re.findall(r'<script src="([^"]+)" defer></script>',html)
html=re.sub(r'<script src="[^"]+" defer></script>','',html)
html=re.sub(r'<link rel="stylesheet" href="[^"]+">','',html)
logo=base64.b64encode((UI/'assets/wfs-notch-mark.svg').read_bytes()).decode()
html=html.replace('src="assets/wfs-notch-mark.svg"','src="data:image/svg+xml;base64,'+logo+'"')
with sync_playwright() as pw:
    exe=which('chromium') or which('chromium-browser') or which('google-chrome')
    browser=pw.chromium.launch(**({'executable_path':exe} if exe else {}),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    count=0
    def check(condition,label):
        global count
        assert condition,label
        count+=1
    for width,height,dpr in [(760,470,1),(560,420,1.5)]:
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=dpr,bypass_csp=True,reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html)
        page.evaluate("""() => {const cache={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>cache[k]??null,setItem:(k,v)=>{cache[k]=String(v);},removeItem:k=>{delete cache[k];}}});}""")
        for name in styles:page.add_style_tag(content=(UI/name).read_text(encoding='utf-8'))
        page.add_style_tag(content='body.preview{padding-top:0!important}body.preview .notch{width:min(760px,100vw)!important;height:min(470px,100vh)!important}')
        for name in scripts:page.add_script_tag(content=(UI/name).read_text(encoding='utf-8'))
        page.locator('#expanded').wait_for(state='visible')
        page.wait_for_function("() => appDataLoadStatus==='ready'")
        page.evaluate("""() => {
          const key='2026-11-25',start=plannerBounds(key).start;
          data.todos=[{id:'p-task',title:'Planner task',done:false,priority:'high',created_ms:start,due_at_ms:start+3600000},{id:'p-other',title:'Other day',done:false,priority:'normal',created_ms:start,due_at_ms:plannerBounds('2026-11-26').start+3600000}];
          data.events=[{id:'p-a',title:'Meeting A',starts_at_ms:start+7200000,ends_at_ms:start+10800000,created_ms:start,description:'',remind_minutes:null},{id:'p-b',title:'Meeting B',starts_at_ms:start+9000000,ends_at_ms:start+12600000,created_ms:start,description:'',remind_minutes:null}];
          plannerSelect(key);render();
        }""")
        expect(page.locator('#phase49-status')).to_have_text('1 open tasks · 2 events · 2 timed events overlapping')
        check(page.locator('#phase49-week .planner-day').count()==7,'seven dates')
        check(page.locator('#phase49-week [aria-pressed=true]').get_attribute('data-planner-day')=='2026-11-25','selected date')
        check(page.locator('#phase49-list .planner-row').count()==3,'merged agenda')
        check(page.locator('#phase49-list').inner_text().count('Event · overlap')==2,'overlap labels')
        page.evaluate("() => document.querySelector('#phase49-open-tasks').click()")
        expect(page.locator('#panel-todos')).to_have_class(re.compile(r'\bactive\b'))
        check(page.locator('#phase49-task-date').input_value()=='2026-11-25','date transferred to tasks')
        check('Planner task' in page.locator('#todo-list').inner_text() and 'Other day' not in page.locator('#todo-list').inner_text(),'filtered tasks')
        page.locator('#phase49-task-reset').click()
        check('Other day' in page.locator('#todo-list').inner_text(),'reset date')
        page.evaluate("() => switchTab('home')")
        page.evaluate("() => document.querySelector('#phase49-open-events').click()")
        expect(page.locator('#panel-calendar')).to_have_class(re.compile(r'\bactive\b'))
        check(page.locator('#phase49-event-date').input_value()=='2026-11-25','date transferred to calendar')
        check('Meeting A' in page.locator('#event-list').inner_text(),'filtered events')
        page.evaluate("() => switchTab('home')")
        page.evaluate("() => plannerSelect('2026-11-26')")
        expect(page.locator('#phase49-status')).to_have_text('1 open tasks · 0 events · 0 timed events overlapping')
        check('Other day' in page.locator('#phase49-list').inner_text(),'next day')
        page.evaluate("() => plannerSelect('2026-11-25')")
        page.locator('#phase49-heading').scroll_into_view_if_needed()
        check(page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),'viewport overflow')
        check(page.locator('#panel-home').evaluate('(el)=>el.scrollWidth<=el.clientWidth+2'),'panel overflow')
        check(not errors,'page errors '+str(errors))
        out=ROOT/'test-results';out.mkdir(exist_ok=True)
        page.screenshot(path=str(out/f'browser-phase49-planner-{width}-{dpr}.png'))
        page.close()
    browser.close()
    print(f'PASS: {count} full browser preview planner assertions (deterministic data, no native Windows)')
