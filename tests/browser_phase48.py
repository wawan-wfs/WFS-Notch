"""Chromium fixture of the exact Phase 48 context module and CSS, not a full application."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [('home','phase47-agenda'),('todos','workspace-task-search'),('notes','note-search'),('calendar','workspace-event-search'),('system','audio-read'),('timer','timer-start'),('health','health-water'),('day','day-event-list'),('countdown','countdown-minutes'),('weather','weather-city'),('flashcards','flashcards-note'),('habits','habit-title'),('dock','shelf-input'),('media','media-player-picker'),('tools','math-input'),('settings','activity-limit')]
with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    count=0
    def check(condition,label):
        global count
        assert condition,label
        count+=1
    for width,height,dpr in [(760,470,1),(560,420,1.5)]:
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=dpr,bypass_csp=True)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        tabs=''.join(f'<button class="tab" data-tab="{name}">{name}</button>' for name,_ in TARGETS)
        panels=''.join(f'<section class="panel{" active" if name=="home" else ""}" id="panel-{name}"><div class="section-heading"><h2>{name.title()}</h2><p>Phase 48 fixture</p></div><div class="workspace-card"><label for="{target}">{target}</label><input id="{target}" value="Fixture data"><p>Existing content is retained.</p></div></section>' for name,target in TARGETS)
        page.set_content('<!doctype html><meta charset="utf-8"><h1>WFS Notch — Phase 48 fixture</h1><nav class="tabs">'+tabs+'</nav><main>'+panels+'</main><label>Audio filter<select id="phase48-audio-filter"><option value="all">All</option><option value="default">Default</option></select></label><label>Shelf filter<select id="phase48-shelf-kind"><option value="all">All</option><option value="image">Images</option></select></label>')
        page.add_style_tag(content=':root{--accent:#d6b77a;--line:#383d49;--panel:#181c24;--muted:#afb4c0;--text:#f5f5f7}*{box-sizing:border-box}body{margin:12px;background:#111319;color:var(--text);font:12px Segoe UI,Arial}h1{font-size:16px}h2{font-size:19px}.tabs{display:flex;gap:4px;overflow-x:auto}.tabs button{flex-shrink:0}button,select,input{color:inherit;background:#20242e;border:1px solid var(--line);border-radius:6px;padding:6px;font:inherit}.panel{display:none}.panel.active{display:block}.section-heading{display:flex;align-items:center;justify-content:space-between}.workspace-card{border:1px solid var(--line);padding:12px;border-radius:10px}label{display:block;margin:6px 0}input{max-width:100%}')
        page.add_style_tag(content=(ROOT/'src/styles/phase48.css').read_text())
        page.add_script_tag(content="""function node(tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!=null)e.textContent=value;return e;}let allowNav=true, calls=[], audioChanges=0,shelfChanges=0;async function switchTab(route){calls.push(route);if(!allowNav)return false;document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id==='panel-'+route));return true;}function phase48RefreshAudioView(){audioChanges++;}function renderShelf(){shelfChanges++;}""")
        page.add_script_tag(content=(ROOT/'src/features/phase48.js').read_text())
        check(page.locator('.phase48-context').count()==16,'all 16 contextual strips')
        page.evaluate('phase48Init()')
        check(page.locator('.phase48-context').count()==16,'idempotent strips')
        for name,target in TARGETS:
            page.evaluate('(route)=>switchTab(route)',name)
            panel=page.locator('#panel-'+name)
            check(panel.locator('.phase48-context').count()==1,'context '+name)
            panel.locator('.phase48-action').first.click()
            check(page.locator('#'+target).evaluate('(el)=>el===document.activeElement'),'focus '+name)
            check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'no fixture overflow '+name)
            page.evaluate('()=>{allowNav=false;}')
            panel.locator('.phase48-related').click()
            check(panel.is_visible(),'guarded navigation '+name)
            page.evaluate('()=>{allowNav=true;}')
            panel.locator('.phase48-related').click()
            check(not panel.is_visible(),'related module navigation '+name)
        page.locator('#phase48-audio-filter').select_option('default')
        check(page.evaluate('audioChanges===1'),'audio filter listener (reinit test)')
        page.locator('#phase48-shelf-kind').select_option('image')
        check(page.evaluate('shelfChanges===1'),'shelf filter listener (reinit test)')
        check(page.evaluate("phase48FileKind('IMG.JPG')==='image' && phase48FileKind('.profile')==='other' && phase48FileKind('report.pdf')==='document' && phase48FileKind('sound.mp3')==='media'"),'file kinds')
        check(page.evaluate("phase48ShelfFilter([{item:{name:'a.png'}},{item:{name:'b.pdf'}}],'document')[0].item.name==='b.pdf'"),'metadata facet')
        check(page.evaluate("phase48AudioFilter([{status:'partial',endpoints:[{is_default:true,enabled:true},{is_default:null,enabled:false}]}],'default')[0].endpoints.length===1"),'default audio filter')
        check(page.evaluate("phase48AudioFilter([{status:'denied',endpoints:[]}],'enabled')[0].status==='denied'"),'preserve denial')
        check(page.evaluate("phase48ActivitySummary([{outcome:'enqueue_accepted'},{outcome:'retry_exhausted'},{outcome:'__proto__'}]).retry_exhausted===1"),'activity summary')
        page.evaluate("switchTab('system')")
        page.locator('#audio-read').evaluate('(el)=>el.disabled=true')
        page.locator('#panel-system .phase48-action').first.click()
        check(page.locator('#panel-system').evaluate('(el)=>el===document.activeElement || el.contains(document.activeElement)'),'disabled target focuses container')
        page.evaluate("switchTab('home')")
        if dpr==1.5:
            out=ROOT/'test-results';out.mkdir(exist_ok=True)
            page.screenshot(path=str(out/'browser-phase48-fixture.png'),full_page=True)
        check(not errors,'no JavaScript errors '+str(errors))
        page.close()
    browser.close()
    print(f'PASS: {count} isolated Chromium assertions, 2 viewport profiles, 16 contexts each; mock app, not native acceptance')
