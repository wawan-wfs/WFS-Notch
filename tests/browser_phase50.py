"""Full browser-preview integration for Phase 50, deterministic local fixtures."""
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
    n=0
    def check(value,label):
        global n
        assert value,label
        n+=1
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
          const day='2026-11-25',b=plannerBounds(day),at=h=>{const d=new Date(b.start);d.setHours(h,0,0,0);return +d;};
          data.todos=[{id:'t1',title:'Alpha task',done:false,priority:'normal',created_ms:at(8),due_at_ms:at(10)}];
          data.events=[{id:'e1',title:'Alpha meeting',starts_at_ms:at(10),ends_at_ms:at(12),created_ms:at(8),description:'',remind_minutes:null}];
          data.notes=[{id:'n1',title:'Journal',body:'alpha secret',updated_ms:at(8),tags:[],revision:0}];
          plannerSelect(day);render();
        }""")
        page.locator('#phase50-search-form').evaluate("(e)=>e.closest('details').open=true")
        page.locator('#phase50-search').fill('alpha')
        page.locator('#phase50-search-form button[type=submit]').click()
        expect(page.locator('#phase50-search-results .phase50-result')).to_have_count(2)
        check('secret' not in page.locator('#phase50-search-results').inner_text(),'no private body')
        page.locator('#phase50-search-body').check()
        page.locator('#phase50-search-form button[type=submit]').click()
        expect(page.locator('#phase50-search-results .phase50-result')).to_have_count(3)
        check('secret' not in page.locator('#phase50-search-results').inner_text(),'body not rendered')
        page.locator('#phase50-search-results .phase50-result').filter(has_text='Alpha task').click()
        expect(page.locator('#panel-todos')).to_have_class(re.compile(r'\bactive\b'))
        check(page.locator('#workspace-task-search').input_value()=='Alpha task','route carries search')
        check(page.locator('#phase50-search').input_value()=='','query cleared on navigation')
        check(not page.locator('#phase50-search-body').is_checked(),'body consent reset')
        page.evaluate("() => switchTab('home')")
        page.locator('#phase50-gap-form').evaluate("(e)=>e.closest('details').open=true")
        page.locator('#phase50-gap-form button').click()
        expect(page.locator('#phase50-gaps .phase50-gap')).to_have_count(2)
        check('120 scheduled minutes of 480' in page.locator('#phase50-gap-status').inner_text(),'merged busy time')
        page.evaluate("() => plannerSelect('2026-11-26')")
        expect(page.locator('#phase50-gaps .phase50-gap')).to_have_count(1)
        check('0 scheduled minutes' in page.locator('#phase50-gap-status').inner_text(),'selected date refresh')
        check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'no viewport overflow')
        check(not errors,'no JS errors '+str(errors))
        out=ROOT/'test-results';out.mkdir(exist_ok=True)
        page.locator('#phase50-gap-status').scroll_into_view_if_needed()
        page.screenshot(path=str(out/f'browser-phase50-workbench-{width}-{dpr}.png'))
        page.close()
    browser.close()
    print(f'PASS: {n} Phase 50 full browser workbench assertions (local fixture state, not native acceptance)')
