"""Exact media.js on Chromium with deterministic Windows session bridge doubles."""
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<button data-tab="media">Media</button><section id="panel-media" class="active"><div id="now-playing"><img id="media-artwork"><b id="media-track-title"></b><p id="media-track-artist"></p><small id="media-track-source"></small><div id="media-progress-bar"></div><span id="media-position"></span><span id="media-duration"></span><span id="media-playback-state"></span></div><button id="media-refresh">Refresh</button><select id="media-player-picker"><option value="">None</option></select><p id="media-player-status"></p><button data-selected-media="toggle">Play/pause</button><button data-selected-media="next">Next</button><button data-selected-media="previous">Previous</button></section>'''
BRIDGE = '''const nativeInvoke=()=>{};
const sessions=[{source:'duplicate',title:'Browser',ambiguous:true,can_toggle:true},{source:'a',title:'Player A',ambiguous:false,can_toggle:true,can_next:false,can_previous:false},{source:'b',title:'Player B',ambiguous:false,can_toggle:true,can_next:true,can_previous:false}];
let available=[...sessions], failList=false, missing='', holdControl=false, holdSnapshot=false, calls=[], errors=[];
const snapshot=source=>({source,title:'Track '+source,playback_status:'Paused',position_ms:5000,duration_ms:100000});
async function invoke(command,args){if(command==='get_active_media_session')return snapshot('duplicate');if(command==='list_media_sessions'){if(failList)throw Error('denied');return available;}if(command==='get_media_session_by_source'){if(args.source===missing)return null;if(holdSnapshot)return new Promise(r=>window.releaseSnapshot=r);return snapshot(args.source);}if(command==='control_media_session'){calls.push(args);if(holdControl)return new Promise(r=>window.releaseControl=r);return true;}throw Error('unexpected '+command);}
function showError(error){errors.push(String(error));}
window.setInterval=()=>0;
'''
with sync_playwright() as pw:
    executable = which('chromium') or which('chromium-browser') or which('google-chrome')
    browser = pw.chromium.launch(**({'executable_path':executable} if executable else {}), headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(bypass_csp=True)
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.set_content(HTML)
    page.add_script_tag(content=BRIDGE)
    page.add_script_tag(content=(ROOT/'src/features/media.js').read_text(encoding='utf-8'))
    count=0
    def check(condition,label):
        global count
        assert condition,label
        count+=1
    picker=page.locator('#media-player-picker')
    toggle=page.locator('[data-selected-media="toggle"]')
    page.evaluate('() => refreshMediaDetails(true)')
    check(picker.input_value()=='a','initial unique player')
    check(toggle.is_enabled(),'initial control')
    check(page.locator('[data-selected-media="next"]').is_disabled(),'capability control')
    page.evaluate("() => controlSelectedPlayer('next')")
    check(page.evaluate('calls.length')==0,'unsupported command not sent')
    picker.select_option('duplicate')
    expect(page.locator('#media-player-status')).to_contain_text('Multiple tabs or players')
    check(toggle.is_disabled(),'duplicate app blocked')
    picker.select_option('a')
    expect(page.locator('#media-track-title')).to_have_text('Track a')
    page.evaluate('() => {holdControl=true;}')
    toggle.click()
    page.wait_for_function("typeof window.releaseControl === 'function'")
    check(toggle.is_disabled(),'single flight control')
    page.evaluate("() => controlSelectedPlayer('toggle')")
    check(page.evaluate('calls.length')==1,'duplicate command suppressed')
    page.evaluate('() => refreshMediaDetails(true)')
    check(toggle.is_disabled(),'refresh cannot enable pending control')
    page.evaluate('() => {holdControl=false;window.releaseControl(true);}')
    page.wait_for_function('() => !mediaControlPending && !mediaDetailsPending')
    check(toggle.is_enabled(),'control finished')
    page.evaluate("() => {available=available.filter(x=>x.source!=='a');}")
    page.evaluate('() => refreshMediaDetails(true)')
    check(picker.input_value()=='','disconnected selection not replaced')
    check(toggle.is_disabled(),'no fallback control')
    check('Choose another player' in page.locator('#media-player-status').inner_text(),'explicit selection status')
    picker.select_option('b')
    expect(page.locator('#media-track-title')).to_have_text('Track b')
    check(toggle.is_enabled(),'explicit new selection')
    page.evaluate("() => {missing='b';}")
    page.evaluate('() => refreshMediaDetails(true)')
    check(toggle.is_disabled(),'missing selected snapshot disables control')
    check(picker.input_value()=='','missing selected snapshot requires choice')
    page.evaluate("() => {missing='';failList=true;}")
    page.evaluate('() => refreshMediaDetails(true)')
    check(toggle.is_disabled(),'failed list disables controls')
    check('unavailable' in page.locator('#media-player-status').inner_text(),'failed list status')
    page.evaluate('() => {failList=false;}')
    page.evaluate('() => refreshMediaDetails(true)')
    check(picker.input_value()=='','recovery does not auto-control another player')
    picker.select_option('b')
    expect(page.locator('#media-track-title')).to_have_text('Track b')
    page.evaluate("() => {renderMediaDetails({...snapshot('b'),playback_status:'Playing'});mediaLastSampleAt=Date.now()-30000;updateInterpolatedProgress();}")
    check(page.locator('#media-position').inner_text()=='00:05','bounded interpolation')
    check(not page_errors,'no page error: '+str(page_errors))
    print(f'PASS: {count} isolated Chromium media assertions (mock GSMTC, native not tested)')
    browser.close()
