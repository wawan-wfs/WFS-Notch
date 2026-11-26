"""Full browser preview Phase 51 integration. Native counters are explicitly fixture data."""
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
    def check(c,label):
        global n
        assert c,label
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
        page.evaluate("() => switchTab('timer')")
        page.locator('#phase51-focus-minutes').fill('17')
        page.locator('#phase51-focus-apply').click()
        expect(page.locator('#timer-display')).to_have_text('17:00')
        check(page.evaluate("data.focus.duration_seconds===1020"),'custom duration committed')
        page.locator('#timer-start').click()
        expect(page.locator('#phase51-focus-end')).to_contain_text('Current phase ends')
        check(page.evaluate("data.focus.ends_at_ms!==null"),'focus running')
        page.locator('#timer-reset').click()
        expect(page.locator('#phase51-focus-end')).to_have_text('No active focus deadline')
        page.evaluate("() => switchTab('health')")
        page.locator('#phase51-health-form').evaluate("(e)=>e.closest('details').open=true")
        page.locator('#phase51-water').fill('10')
        page.locator('#phase51-health-form button').click()
        expect(page.locator('#phase51-health-status')).to_contain_text('updated')
        check('0 / 10' in page.locator('#phase51-health-progress').inner_text(),'personal target')
        page.locator('[data-health=water_plus]').click()
        expect(page.locator('#phase51-health-progress')).to_contain_text('1 / 10')
        check(page.locator('#health-water').inner_text()=='1 / 8','legacy health counter unchanged')
        page.evaluate("() => switchTab('system')")
        page.locator('#phase51-network-clear').evaluate("(e)=>e.closest('details').open=true")
        page.evaluate("""() => {wfs51ReadNetwork({sampled_at_ms:1000,networks:[{name:'Fixture adapter',received_bytes:100,transmitted_bytes:200}]});wfs51ReadNetwork({sampled_at_ms:3000,networks:[{name:'Fixture adapter',received_bytes:300,transmitted_bytes:300}]});}""")
        expect(page.locator('#phase51-network-list')).to_contain_text('100 B/s')
        expect(page.locator('#phase51-network-status')).to_contain_text('2.0 s')
        check(page.locator('#phase51-network-status').is_visible(),'rate interval visible in expanded panel')
        page.locator('#phase51-network-clear').click()
        expect(page.locator('#phase51-network-status')).to_contain_text('Requires native Windows counters')
        check(page.locator('#phase51-network-list .phase51-network-row').count()==0,'clear snapshot')
        page.evaluate("() => switchTab('weather')")
        page.evaluate("""() => {wfs51CaptureWeather({name:'Fixture'},{current:{time:'2026-11-26T10:00'},hourly:{time:['2026-11-26T11:00','2026-11-26T12:00'],precipitation_probability:[60,10]}});document.querySelector('#weather-forecast').hidden=false;document.querySelector('#phase51-rain-threshold').closest('details').open=true;}""")
        check('60%' in page.locator('#phase51-rain-list').inner_text(),'rain threshold list')
        page.locator('#phase51-rain-threshold').select_option('80')
        check('No returned hours' in page.locator('#phase51-rain-list').inner_text(),'threshold change')
        page.evaluate("() => switchTab('tools')")
        page.evaluate("() => {stopwatch.laps=[1000,2500,4500];renderStopwatch();}")
        check('1.50 s' in page.locator('#phase51-lap-stats').inner_text(),'lap interval summary')
        check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'viewport overflow')
        check(not errors,'page errors '+str(errors))
        out=ROOT/'test-results';out.mkdir(exist_ok=True)
        page.locator('#phase51-lap-stats').scroll_into_view_if_needed()
        page.screenshot(path=str(out/f'browser-phase51-tools-{width}-{dpr}.png'))
        page.close()
    browser.close()
    print(f'PASS: {n} Phase 51 full browser assertions (fixture counters and forecasts)')
