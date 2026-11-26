'use strict';
// Phase 4 modules. Uses shared app.js state, mutation queue and UI helpers.
let extrasInitialized = false;
const swKey = 'wfs-notch-stopwatch-v1';
const stopwatch = { elapsed: 0, since: null, laps: [] };
let generatedPassword = '';

function localDay(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
}
function dayStreak(dates) {
  const completed = new Set(dates);
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  if (!completed.has(localDay(day))) day.setDate(day.getDate() - 1);
  let count = 0;
  while (completed.has(localDay(day)) && count < 3660) {
    count += 1;
    day.setDate(day.getDate() - 1);
  }
  return count;
}
function renderHabits() {
  const today = localDay();
  const count = data.habits.filter(h => h.completed_dates.includes(today)).length;
  $('#habit-count').textContent = count + ' OF ' + data.habits.length + ' TODAY';
  $('#home-habit-progress').textContent = count + ' / ' + data.habits.length;
  if(typeof wfs50RenderHabitWeek==='function')wfs50RenderHabitWeek();
  const list = $('#habit-list');
  list.replaceChildren();
  if (!data.habits.length) {
    list.append(node('div', 'empty', 'Your first daily habit starts here.'));
    return;
  }
  for (const habit of [...data.habits].reverse()) {
    const done = habit.completed_dates.includes(today);
    const line = node('div', 'module-item' + (done ? ' done' : ''));
    const toggle = node('button', 'habit-check', done ? '✓' : '○');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Complete today: ' + habit.title);
    toggle.setAttribute('aria-pressed', String(done));
    toggle.addEventListener('click', () => void mutation('toggle_habit_day', { id: habit.id, day: localDay() }));
    const info = node('div', 'module-info');
    info.append(node('b', '', habit.title));
    info.append(node('small', '', dayStreak(habit.completed_dates) + ' day streak · ' + habit.completed_dates.length + ' check-ins'));
    const remove = node('button', 'remove-task', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Delete habit: ' + habit.title);
    remove.addEventListener('click', () => void mutation('remove_habit', { id: habit.id }));
    line.append(toggle, info, remove);
    list.append(line);
  }
}
function renderDock() {
  $('#home-link-count').textContent = String(data.quick_links.length);
  const list = $('#quicklink-list');
  list.replaceChildren();
  if (!data.quick_links.length) {
    list.append(node('div', 'empty', 'No websites pinned yet.'));
    return;
  }
  for (const link of data.quick_links) {
    const line = node('div', 'module-item');
    const open = node('button', 'link-open', link.label);
    open.type = 'button';
    open.title = link.url;
    open.setAttribute('aria-label', 'Open ' + link.label);
    open.addEventListener('click', async () => {
      try { await invoke('open_quick_link', { id: link.id }); }
      catch (error) { showError(error); }
    });
    const small = node('small', 'link-subtitle', link.url);
    const remove = node('button', 'remove-task', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Unpin ' + link.label);
    remove.addEventListener('click', () => void mutation('remove_quick_link', { id: link.id }));
    const box = node('div', 'module-info'); box.append(open, small);
    line.append(box, remove); list.append(line);
  }
}
function renderExtras() {
  if (!$('#habit-list')) return;
  renderHabits();
  renderDock();
}
function stopwatchElapsed() {
  return stopwatch.elapsed + (stopwatch.since == null ? 0 : Math.max(0, Date.now() - stopwatch.since));
}
function renderStopwatch() {
  if (!$('#stopwatch-display')) return;
  const ms = stopwatchElapsed();
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor(ms / 1000) % 60;
  const tenths = Math.floor(ms / 100) % 10;
  $('#stopwatch-display').textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + tenths;
  $('#stopwatch-toggle').textContent = stopwatch.since == null ? 'Start' : 'Pause';
  if(typeof wfs51RenderLaps==='function')wfs51RenderLaps();
  const laps = $('#stopwatch-laps');
  if (laps.dataset.count !== String(stopwatch.laps.length)) {
    laps.dataset.count = String(stopwatch.laps.length);
    laps.replaceChildren(...stopwatch.laps.slice(-5).reverse().map((ms, i) => node('small', '', 'Lap ' + (stopwatch.laps.length - i) + ' · ' + (ms / 1000).toFixed(1) + 's')));
  }
}
function saveStopwatch() {
  try { localStorage.setItem(swKey, JSON.stringify(stopwatch)); } catch (error) { console.warn('Stopwatch state not persisted', error); }
}
function randomPassword(length = 20) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random generator unavailable');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_';
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  const out = [];
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    for (const byte of bytes) {
      if (byte < max) out.push(alphabet[byte % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}
function calculateSimple(expression) {
  const pattern = /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([+\-*/])\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
  const m = expression.match(pattern);
  if (!m) throw new Error('Use one expression like 12.5 * 2');
  const left = Number(m[1]), right = Number(m[3]);
  const result = m[2] === '+' ? left + right : m[2] === '-' ? left - right : m[2] === '*' ? left * right : left / right;
  if (!Number.isFinite(result)) throw new Error('Invalid calculation (division by zero?)');
  return Number(result.toPrecision(12)).toString();
}
const moduleKeywords = {
  home: 'dashboard overview planning', todos: 'todo task reminders', notes: 'draft writing',
  calendar: 'events appointments ics', timer: 'pomodoro focus session',
  system: 'cpu ram disk network telemetry audio devices', health: 'water wellness break',
  day: 'schedule today', countdown: 'timer alarm', weather: 'temperature forecast',
  flashcards: 'study cards', habits: 'streak checklist', dock: 'bookmarks launcher links shelf files',
  media: 'music audio player volume', tools: 'stopwatch calculator password',
  settings: 'preferences appearance contrast density display backups notification activity history',
};
let paletteOpener = null;
let paletteSession = 0;
let paletteSelecting = false;

function paletteIsOpen() { return !$('#command-palette').hidden; }

function setPaletteModality(open) {
  const overlay = $('#command-palette');
  for (const sibling of overlay.parentElement.children) {
    if (sibling !== overlay) sibling.inert = open;
  }
}

function openPalette() {
  if (!isExpanded || paletteIsOpen()) return;
  paletteSession += 1;
  paletteOpener = document.activeElement;
  $('#command-palette').hidden = false;
  setPaletteModality(true);
  $('#palette-search').value = '';
  renderPalette();
  $('#palette-search').focus();
}
function closePalette(focusTarget = paletteOpener) {
  if (!paletteIsOpen()) return;
  paletteSession += 1;
  if (paletteSelecting) tabRequest += 1;
  paletteSelecting = false;
  $('#command-palette').hidden = true;
  setPaletteModality(false);
  const target = focusTarget?.closest('#expanded') && focusTarget.getClientRects().length
    ? focusTarget : $('#module-finder');
  target.focus();
  paletteOpener = null;
}

async function selectPaletteModule(tab) {
  if (paletteSelecting) return;
  const session = paletteSession;
  paletteSelecting = true;
  const opened = await switchTab(tab.dataset.tab);
  if (session !== paletteSession) return;
  paletteSelecting = false;
  if (opened) closePalette(tab);
  else $('#palette-status').textContent = 'Module not opened. Close the finder to resolve the unsaved note.';
}

function renderPalette() {
  const terms = $('#palette-search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const container = $('#palette-results');
  container.replaceChildren();
  const tabs = $$('.tab').filter(tab => {
    const searchable = `${tab.textContent.toLowerCase()} ${moduleKeywords[tab.dataset.tab] || ''}`;
    return terms.every(term => searchable.includes(term));
  });
  $('#palette-status').textContent = tabs.length
    ? `${tabs.length} ${tabs.length === 1 ? 'module' : 'modules'} available`
    : 'No matching module. Try another search.';
  for (const tab of tabs) {
    const button = node('button', 'palette-option', tab.textContent);
    button.type = 'button';
    if (tab.dataset.tab === activeTab) {
      button.setAttribute('aria-current', 'page');
      button.append(node('span', 'palette-current', 'Current'));
    }
    button.addEventListener('click', () => void selectPaletteModule(tab));
    container.append(button);
  }
  container.scrollTop = 0;
}

function handlePaletteKey(event) {
  if (event.isComposing) return;
  const input = $('#palette-search');
  const options = $$('#palette-results .palette-option');
  const index = options.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePalette();
  } else if (event.key === 'Tab') {
    const stops = [$('#palette-close'), input, ...options];
    const current = stops.indexOf(document.activeElement);
    if ((event.shiftKey && current === 0) || (!event.shiftKey && current === stops.length - 1)) {
      event.preventDefault();
      stops[event.shiftKey ? stops.length - 1 : 0].focus();
    }
  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      (document.activeElement === input || index !== -1) && options.length) {
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index === -1 ? options.length - 1 : index - 1;
    (options[next] || input).focus();
  } else if (event.key === 'Enter' && document.activeElement === input) {
    event.preventDefault();
    options[0]?.click();
  }
}

const SHELF_KEY = 'wfs-notch-shelf-metadata-v1';
const SHELF_LIMIT = 32;
function shelfRecord(file) {
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 512 ||
      /[\/\\:\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(file.name) ||
      !Number.isSafeInteger(file.size) || file.size < 0 ||
      !Number.isSafeInteger(file.lastModified) || file.lastModified < 0 ||
      file.lastModified > 8640000000000000) return null;
  return {name:file.name,size:file.size,modified:file.lastModified};
}
function shelfAdd(existing, selected) {
  const entries = existing.slice(0,SHELF_LIMIT);
  const keys = new Set(entries.map(item => JSON.stringify([item.name,item.size,item.modified])));
  let added = 0, skipped = 0;
  for (const file of selected) {
    const item = shelfRecord(file);
    if (!item || entries.length >= SHELF_LIMIT) { skipped++; continue; }
    const key = JSON.stringify([item.name,item.size,item.modified]);
    if (keys.has(key)) { skipped++; continue; }
    keys.add(key); entries.push(item); added++;
  }
  return {entries,added,skipped};
}
function shelfDecode(raw) {
  if (raw === null) return {enabled:false,entries:[]};
  if (typeof raw !== 'string' || raw.length > 120000) throw new Error('Invalid Shelf storage size');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'enabled,entries,version' ||
      value.version !== 1 || value.enabled !== true || !Array.isArray(value.entries) ||
      value.entries.length > SHELF_LIMIT) throw new Error('Invalid Shelf storage schema');
  const entries = value.entries.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'modified,name,size')
      throw new Error('Unexpected Shelf metadata fields');
    const record = shelfRecord({name:item.name,size:item.size,lastModified:item.modified});
    if (!record) throw new Error('Invalid Shelf metadata');
    return record;
  });
  const dedup = new Set(entries.map(item => JSON.stringify([item.name,item.size,item.modified])));
  if (dedup.size !== entries.length) throw new Error('Duplicate Shelf metadata');
  return {enabled:true,entries};
}
function shelfPersist(storage, enabled, entries) {
  if (!enabled) { storage.removeItem(SHELF_KEY); return; }
  const raw = JSON.stringify({version:1,enabled:true,entries});
  shelfDecode(raw);
  storage.setItem(SHELF_KEY,raw);
}
function shelfView(entries, search, sort) {
  const term = search.trim().toLowerCase();
  const visible = entries.map((item,index)=>({item,index})).filter(row=>row.item.name.toLowerCase().includes(term));
  if (sort === 'name') visible.sort((a,b)=>a.item.name.localeCompare(b.item.name) || a.index-b.index);
  if (sort === 'size') visible.sort((a,b)=>b.item.size-a.item.size || a.index-b.index);
  if (sort === 'modified') visible.sort((a,b)=>b.item.modified-a.item.modified || a.index-b.index);
  return visible;
}
let shelfEntries = [];
let shelfRemember = false;
let shelfStorageBlocked = false;
function shelfStatus(message) { $('#shelf-status').textContent = message; }
function shelfCommit(next) {
  try {
    if (shelfRemember) shelfPersist(localStorage,true,next);
    shelfEntries = next;
    if(typeof wfs52PruneHandles==='function')wfs52PruneHandles(next);
    return true;
  } catch {
    shelfStatus('Storage write failed. Shelf was not changed. Disable remembering to continue without persistence.');
    return false;
  }
}
function phase48VisibleShelf() {
  const rows = shelfView(shelfEntries,$('#shelf-search').value,$('#shelf-sort').value);
  return typeof phase48ShelfFilter === 'function'
    ? phase48ShelfFilter(rows,$('#phase48-shelf-kind')?.value || 'all') : rows;
}
function renderShelf(focusIndex = null) {
  const list = $('#shelf-list');
  list.replaceChildren();
  const visible = phase48VisibleShelf();
  $('#shelf-count').textContent = shelfEntries.length + ' / ' + SHELF_LIMIT;
  $('#shelf-clear').disabled = !shelfEntries.length;
  $('#shelf-remember').checked = shelfRemember;
  $('#shelf-forget').disabled = !shelfRemember && !shelfStorageBlocked;
  $('#shelf-filter-count').textContent = visible.length + ' of ' + shelfEntries.length + ' shown';
  if (typeof phase47ShelfSummary === 'function') phase47ShelfSummary(visible);
  const categories=$('#phase49-shelf-categories');
  if(categories&&typeof plannerShelfCategories==='function'){const counts=plannerShelfCategories(shelfEntries);categories.textContent=counts.image+' images · '+counts.document+' documents · '+counts.media+' media · '+counts.other+' other (all entries)';}
  $('#shelf-remove-shown').disabled = !visible.length;
  $('#shelf-copy-names').disabled = !visible.length;
  if($('#phase50-shelf-copy'))$('#phase50-shelf-copy').disabled=!visible.length;
  if(typeof wfs52InvalidateShelf==='function')wfs52InvalidateShelf();
  if(typeof wfs52RenderFileChoices==='function')wfs52RenderFileChoices();
  if (!visible.length) list.append(node('div','empty',shelfEntries.length ? 'No matching files.' : 'Shelf is empty.'));
  visible.forEach(({item,index},position) => {
    const line = node('div','module-item');
    const info = node('div','module-info');
    const date = item.modified ? new Date(item.modified).toLocaleDateString() : 'Date unavailable';
    info.append(node('b','',item.name),node('small','',item.size.toLocaleString() + ' bytes · ' + date));
    const remove = node('button','remove-task','×');
    remove.type = 'button';
    remove.setAttribute('aria-label','Remove from Shelf: ' + item.name);
    remove.addEventListener('click', () => {
      if (!shelfCommit(shelfEntries.filter((_,i)=>i!==index))) return;
      shelfStatus('Removed one entry.');
      renderShelf(position);
    });
    line.append(info,remove); list.append(line);
  });
  if(typeof wfs53RenderModuleContext==='function')wfs53RenderModuleContext();
  if (focusIndex !== null) {
    const buttons = list.querySelectorAll('button');
    (buttons[Math.min(focusIndex,buttons.length-1)] || $('#shelf-input')).focus();
  }
}
function setShelfRemember(enabled) {
  try {
    shelfPersist(localStorage,enabled,shelfEntries);
    shelfRemember = enabled; shelfStorageBlocked = false;
    shelfStatus(enabled ? 'Remembering names, sizes and modified dates on this device.' :
      'Saved Shelf metadata removed. Current entries are session-only.');
  } catch {
    shelfStorageBlocked = true;
    shelfStatus('Could not change saved Shelf preference. Existing saved data may remain; retry Forget saved Shelf.');
  }
  renderShelf();
}
function initShelf() {
  const input = $('#shelf-input');
  try {
    const saved = shelfDecode(localStorage.getItem(SHELF_KEY));
    shelfEntries = saved.entries; shelfRemember = saved.enabled;
    if (saved.enabled) shelfStatus('Restored local metadata only. Reselect files if needed.');
  } catch {
    shelfStorageBlocked = true;
    shelfStatus('Saved Shelf could not be read. Nothing restored. Use Forget saved Shelf to remove invalid data.');
  }
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    const result = shelfAdd(shelfEntries,files);
    input.value = '';
    if (!shelfCommit(result.entries)) return;
    if(typeof wfs52AttachFiles==='function')wfs52AttachFiles(result.entries,files);
    shelfStatus(result.added + ' added; ' + result.skipped + ' skipped (duplicate, invalid or capacity).');
    renderShelf();
  });
  $('#shelf-clear').addEventListener('click', () => {
    if (!shelfCommit([])) return;
    shelfStatus('Shelf cleared. Original files unchanged.');
    renderShelf(); input.focus();
  });
  $('#shelf-remove-shown').addEventListener('click', () => {
    const visible = phase48VisibleShelf();
    if (!visible.length || !confirm('Remove '+visible.length+' shown metadata entries? Original files stay unchanged.')) return;
    const indexes = new Set(visible.map(row=>row.index));
    if (!shelfCommit(shelfEntries.filter((_,index)=>!indexes.has(index)))) return;
    shelfStatus('Removed '+visible.length+' shown entries. Original files unchanged.');
    renderShelf(); $('#shelf-search').focus();
  });
  $('#shelf-copy-names').addEventListener('click', async () => {
    const names = phase48VisibleShelf().map(row=>row.item.name);
    if (!names.length) return;
    try { await navigator.clipboard.writeText(names.join('\n')); shelfStatus('Copied '+names.length+' file names only.'); }
    catch { shelfStatus('Clipboard unavailable. File names were not copied.'); }
  });
  $('#shelf-search').addEventListener('input',()=>renderShelf());
  $('#shelf-sort').addEventListener('change',()=>renderShelf());
  $('#shelf-remember').addEventListener('change',event=>setShelfRemember(event.target.checked));
  $('#shelf-forget').addEventListener('click',()=>{setShelfRemember(false); $('#shelf-remember').focus();});
  renderShelf();
}

function initExtras() {
  if (extrasInitialized) return;
  extrasInitialized = true;
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(swKey) || '{}'); } catch { return {}; }
  })();
  stopwatch.elapsed = Number.isFinite(stored.elapsed) && stored.elapsed >= 0 ? stored.elapsed : 0;
  stopwatch.since = Number.isFinite(stored.since) && stored.since > 0 && stored.since <= Date.now() ? stored.since : null;
  stopwatch.laps = Array.isArray(stored.laps) ? stored.laps.filter(v => Number.isFinite(v) && v >= 0).slice(-30) : [];

  $('#habit-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#habit-title');
    const title = input.value.trim();
    if (title && await mutation('add_habit', { title })) input.value = '';
  });
  $('#quicklink-form').addEventListener('submit', async event => {
    event.preventDefault();
    const label = $('#quicklink-label').value.trim();
    const url = $('#quicklink-url').value.trim();
    if (label && url && await mutation('add_quick_link', { label, url })) {
      $('#quicklink-label').value = ''; $('#quicklink-url').value = '';
    }
  });
  $$('[data-launch]').forEach(button => button.addEventListener('click', async () => {
    try { await invoke('launch_builtin', { appName: button.dataset.launch }); }
    catch (error) { showError(error); }
  }));
  $$('[data-media]').forEach(button => button.addEventListener('click', async () => {
    try { await invoke('media_key', { action: button.dataset.media }); }
    catch (error) { showError(error); }
  }));
  const autostart = $('#autostart-toggle');
  if (!nativeInvoke) {
    autostart.disabled = true;
    autostart.title = 'Windows-only control';
  } else {
    invoke('get_autostart').then(value => { autostart.checked = value; })
      .catch(error => { autostart.disabled = true; showError(error); });
  }
  autostart.addEventListener('change', async () => {
    const requested = autostart.checked;
    autostart.disabled = true;
    try { autostart.checked = await invoke('set_autostart', { enabled: requested }); }
    catch (error) { autostart.checked = !requested; showError(error); }
    finally { autostart.disabled = false; }
  });
  $('#stopwatch-toggle').addEventListener('click', () => {
    if (stopwatch.since == null) stopwatch.since = Date.now();
    else { stopwatch.elapsed = stopwatchElapsed(); stopwatch.since = null; }
    saveStopwatch(); renderStopwatch();
  });
  $('#stopwatch-reset').addEventListener('click', () => {
    stopwatch.elapsed = 0; stopwatch.since = null; stopwatch.laps = [];
    $('#stopwatch-laps').dataset.count = '';
    saveStopwatch(); renderStopwatch();
  });
  $('#stopwatch-lap').addEventListener('click', () => {
    if (stopwatch.since == null) return;
    stopwatch.laps.push(stopwatchElapsed());
    stopwatch.laps = stopwatch.laps.slice(-30);
    saveStopwatch(); renderStopwatch();
  });
  $('#password-generate').addEventListener('click', () => {
    try { generatedPassword = randomPassword(); $('#password-output').textContent = generatedPassword; }
    catch (error) { showError(error); }
  });
  $('#password-copy').addEventListener('click', async () => {
    if (!generatedPassword) { showInfo('Generate a password first.'); return; }
    try { await navigator.clipboard.writeText(generatedPassword); showInfo('Copied to clipboard.'); }
    catch { showError('Clipboard permission unavailable. Select the generated password manually.'); }
  });
  $('#math-form').addEventListener('submit', event => {
    event.preventDefault();
    try { $('#math-output').textContent = calculateSimple($('#math-input').value); }
    catch (error) { showError(error); }
  });
  $('#palette-open').addEventListener('click', openPalette);
  $('#module-finder').addEventListener('click', openPalette);
  $('#palette-close').addEventListener('click', () => closePalette());
  $('#palette-search').addEventListener('input', renderPalette);
  $('#command-palette').addEventListener('keydown', handlePaletteKey);
  $('#command-palette').addEventListener('click', event => {
    if (event.target === event.currentTarget) closePalette();
  });
  document.addEventListener('keydown', async event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat ||
        event.isComposing || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    if (!isExpanded) await setExpanded(true);
    openPalette();
  });
  setInterval(renderStopwatch, 100);
  renderStopwatch();
  renderExtras();
  initShelf();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initExtras, { once: true });
else initExtras();
