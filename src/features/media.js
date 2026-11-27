'use strict';
// Privacy-preserving Windows GSMTC snapshot. Never create fake music metadata for browser preview.
let mediaDetailsInitialized = false;
let mediaDetailsPending = false;
let mediaDetailsLastAt = 0;
let mediaLastSample = null;
let mediaLastSampleAt = 0;
let mediaSessionChoices = [];
let mediaControlPending = false;
let mediaRefreshRequested = false;
let mediaNeedsSelection = false;
let mediaReadSequence = 0;
let mediaViewEpoch = 0;
function mediaVisible(){
  return !!document.querySelector('#panel-media')?.classList.contains('active')&&!document.querySelector('#expanded')?.hidden&&!document.hidden;
}
function suspendMediaDetails(){
  mediaViewEpoch++;
  mediaDetailsLastAt=0;mediaRefreshRequested=false;
  const picker=document.querySelector('#media-player-picker');
  if(picker?.value)mediaNeedsSelection=true;
  if(typeof wfs55ClearMedia==='function')wfs55ClearMedia();
  renderSelectedPlayers([],null);
  renderMediaDetails(null);
}
function mediaTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const secs = Math.floor(ms / 1000);
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
}
function renderMediaDetails(snapshot, readSequence = 0) {
  const track = document.querySelector('#media-track-title');
  const artist = document.querySelector('#media-track-artist');
  const source = document.querySelector('#media-track-source');
  const pos = document.querySelector('#media-position');
  const duration = document.querySelector('#media-duration');
  const status = document.querySelector('#media-playback-state');
  const bar = document.querySelector('#media-progress-bar');
  const artwork = document.querySelector('#media-artwork');
  const card = document.querySelector('#now-playing');
  mediaLastSample = snapshot;
  mediaLastSampleAt = Date.now();
  if(typeof wfs55ObserveMedia==='function')wfs55ObserveMedia(snapshot,readSequence);
  if (!snapshot) {
    track.textContent = 'No active media session';
    artist.textContent = nativeInvoke ? 'Start music in a supported Windows player.' : 'Track metadata requires the installed Windows desktop application.';
    source.textContent = nativeInvoke ? 'Windows global media session' : 'Browser preview — no synthetic media';
    pos.textContent = '—'; duration.textContent = '—'; status.textContent = 'Unavailable';
    bar.style.width = '0%';
    artwork.hidden = true;
    artwork.removeAttribute('src');
    card.classList.remove('has-art');
    if(typeof wfs52RenderSeek==='function')wfs52RenderSeek();
    return;
  }
  const url = snapshot.artwork_data_url;
  const validArt = typeof url === 'string' && url.length <= 750000 && /^data:image\/(png|jpeg|gif);base64,[a-zA-Z0-9+/=]+$/.test(url);
  artwork.hidden = !validArt;
  if (validArt) artwork.src = url;
  else artwork.removeAttribute('src');
  card.classList.toggle('has-art', validArt);
  track.textContent = snapshot.title || 'Untitled track';
  artist.textContent = snapshot.artist || snapshot.album || 'Unknown artist';
  source.textContent = [snapshot.album, snapshot.source].filter(Boolean).join(' · ').slice(0, 250);
  pos.textContent = mediaTime(snapshot.position_ms);
  duration.textContent = mediaTime(snapshot.duration_ms);
  status.textContent = snapshot.playback_status || 'Unknown';
  const p = Number(snapshot.position_ms), d = Number(snapshot.duration_ms);
  bar.style.width = Number.isFinite(p) && Number.isFinite(d) && d > 0
    ? Math.min(100, Math.max(0, 100 * p / d)).toFixed(1) + '%' : '0%';
  if(typeof wfs52RenderSeek==='function')wfs52RenderSeek();
}
function readMediaWithDeadline(command,args={}) {
  return typeof deviceDeadline==='function'?deviceDeadline(()=>invoke(command,args),10000):invoke(command,args);
}
async function refreshMediaDetails(force = false) {
  if (!nativeInvoke) return;
  if(mediaControlPending&&!force)return;
  if (mediaDetailsPending) { if (force) mediaRefreshRequested = true; return; }
  if (!mediaVisible()) return;
  if (!force && Date.now() - mediaDetailsLastAt < 5000) return;
  mediaDetailsPending = true;
  const readSequence=++mediaReadSequence,epoch=mediaViewEpoch;
  const currentView=()=>epoch===mediaViewEpoch&&mediaVisible();
  try {
    const active = await readMediaWithDeadline('get_active_media_session');
    if(!currentView())return;
    const sessions = await readMediaWithDeadline('list_media_sessions');
    if(!currentView())return;
    renderSelectedPlayers(sessions, active?.source);
    const picker = document.querySelector('#media-player-picker');
    const selected = picker.value;
    if (mediaNeedsSelection && !selected) { renderMediaDetails(null); return; }
    const choice = mediaSessionChoices.find(item => item.source === selected);
    if (choice?.ambiguous) {
      renderMediaDetails(null);
      document.querySelector('#media-player-status').textContent =
        'Multiple tabs or players share this Windows app ID. Individual session selection is unavailable; playback controls are disabled to avoid acting on the wrong tab.';
      mediaDetailsLastAt = Date.now();
      return;
    }
    const snapshot = selected && selected !== active?.source
      ? await readMediaWithDeadline('get_media_session_by_source', { source: selected }) : active;
    if (!currentView() || picker.value !== selected) return;
    if (selected && (!snapshot || snapshot.source !== selected)) {
      mediaNeedsSelection = true;
      renderSelectedPlayers(sessions, active?.source);
      renderMediaDetails(null);
      document.querySelector('#media-player-status').textContent =
        'Selected session disconnected. Choose a player explicitly.';
      return;
    }
    renderMediaDetails(snapshot,readSequence);
    mediaDetailsLastAt = Date.now();
  } catch (error) {
    if(!currentView())return;
    renderMediaDetails(null);
    renderSelectedPlayers([], null);
    document.querySelector('#media-track-artist').textContent = 'Windows media sessions are unavailable. Refresh to retry.';
    document.querySelector('#media-player-status').textContent = 'Session list unavailable; selected controls disabled.';
  } finally {
    mediaDetailsLastAt = Date.now();
    mediaDetailsPending = false;
    if (mediaRefreshRequested) {
      mediaRefreshRequested = false;
      setTimeout(() => void refreshMediaDetails(true), 0);
    }
  }
}
function updateInterpolatedProgress() {
  const snapshot = mediaLastSample;
  if (!mediaVisible() || !snapshot || snapshot.playback_status !== 'Playing') return;
  const duration = Number(snapshot.duration_ms);
  const start = Number(snapshot.position_ms);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start)) return;
  const age = Date.now() - mediaLastSampleAt;
  // A paused/suspended WebView may resume long after the previous reading.
  // Never project beyond a short bounded sample interval: wait for a fresh
  // GSMTC snapshot instead of showing a fabricated progress value.
  if (age < 0 || age > 10_000) return;
  const position = Math.min(duration, start + age);
  document.querySelector('#media-position').textContent = mediaTime(position);
  document.querySelector('#media-progress-bar').style.width =
    Math.max(0, Math.min(100, 100 * position / duration)).toFixed(1) + '%';
}

function selectedMediaFlag(action) {
  return ['toggle','play','pause','next','previous'].includes(action) ? 'can_'+action : null;
}
function renderSelectedPlayers(sessions, systemCurrentSource) {
  const picker = document.querySelector('#media-player-picker');
  const status = document.querySelector('#media-player-status');
  const safe = typeof wfs50MediaSessions === 'function' ? wfs50MediaSessions(sessions) : Array.isArray(sessions) ? sessions.filter(item => item && typeof item.source === 'string' && item.source.length > 0) : [];
  const previous = picker.value;
  if (previous && !safe.some(item => item.source === previous)) mediaNeedsSelection = true;
  mediaSessionChoices = safe;
  picker.replaceChildren();
  if (!safe.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No controllable media players';
    picker.append(empty);
    picker.disabled = true;
    status.textContent = 'No Windows GSMTC sessions available right now.';
  } else {
    if (mediaNeedsSelection) {
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Choose a player';
      picker.append(placeholder);
    }
    for (const session of safe) {
      const option = document.createElement('option');
      option.value = session.source;
      option.textContent = ((session.title || session.source) + ' · ' + (session.artist || session.playback_status || 'Unknown') +
        (session.ambiguous === true ? ' · Multiple sessions: controls unavailable' : '')).slice(0, 190);
      picker.append(option);
    }
    const unambiguous = safe.filter(item => item.ambiguous !== true);
    const preferred = safe.some(item => item.source === previous) ? previous
      : unambiguous.some(item => item.source === systemCurrentSource) ? systemCurrentSource
      : unambiguous[0]?.source;
    picker.value = mediaNeedsSelection ? '' : preferred || safe[0].source;
    picker.disabled = false;
    status.textContent = mediaNeedsSelection
      ? 'Selected player disconnected. Choose another player explicitly.'
      : unambiguous.length
      ? 'Controls target only a uniquely identified Windows media app; options with multiple tabs are deliberately blocked.'
      : 'Multiple sessions share their app identity; controls are disabled to avoid changing the wrong tab.';
  }
  const chosen = safe.find(item => item.source === picker.value);
  for (const button of document.querySelectorAll('[data-selected-media]')) {
    const action = button.dataset.selectedMedia;
    const flag = selectedMediaFlag(action);
    button.disabled = mediaControlPending || picker.disabled || !chosen || chosen.ambiguous === true || chosen[flag] !== true;
  }
}
async function controlSelectedPlayer(action) {
  const picker = document.querySelector('#media-player-picker');
  const status = document.querySelector('#media-player-status');
  if (!nativeInvoke || !picker.value || mediaControlPending || !mediaVisible()) return;
  const source = picker.value,epoch=mediaViewEpoch;
  const selected = mediaSessionChoices.find(item => item.source === source);
  if (!selected || selected.ambiguous === true) {
    status.textContent = 'Control refused: choose a uniquely identifiable Windows media session.';
    return;
  }
  const flag = selectedMediaFlag(action);
  if (!flag || selected[flag] !== true) { status.textContent = 'This action is not supported by the selected player.'; return; }
  mediaControlPending = true;
  for (const button of document.querySelectorAll('[data-selected-media]')) button.disabled = true;
  try {
    const accepted = await invoke('control_media_session', {source, action});
    if(epoch!==mediaViewEpoch||!mediaVisible()||picker.value!==source)return;
    if(typeof wfs55StartMediaObservation==='function')wfs55StartMediaObservation(source,action,accepted===true);
    if (picker.value === source) status.textContent = accepted
      ? 'Command accepted by the selected media player. Refreshing playback state; acceptance is not proof of playback.'
      : 'The selected player did not accept that command.';
    await refreshMediaDetails(true);
  } catch (error) {
    if(epoch!==mediaViewEpoch||!mediaVisible())return;
    renderSelectedPlayers([], null);
    renderMediaDetails(null);
    status.textContent = 'Selected media session unavailable. Refresh the list and choose again.';
    showError(error);
  } finally {
    mediaControlPending = false;
    // Do not re-enable controls unsupported by the current player.
    const snapshot = mediaSessionChoices.find(item => item.source === picker.value);
    for (const button of document.querySelectorAll('[data-selected-media]')) {
      const flag = selectedMediaFlag(button.dataset.selectedMedia);
      button.disabled = !mediaVisible() || picker.disabled || !snapshot || snapshot.ambiguous === true || snapshot[flag] !== true;
    }
  }
}
function initMediaSessions() {
  if (mediaDetailsInitialized) return;
  mediaDetailsInitialized = true;
  renderMediaDetails(null);
  for (const button of document.querySelectorAll('[data-selected-media]')) {
    button.addEventListener('click', () => { void controlSelectedPlayer(button.dataset.selectedMedia); });
    button.disabled = !nativeInvoke;
  }
  document.querySelector('#media-player-picker').addEventListener('change', () => {
    const picker = document.querySelector('#media-player-picker');
    mediaNeedsSelection = !picker.value;
    if(typeof wfs55ClearMedia==='function')wfs55ClearMedia();
    for (const button of document.querySelectorAll('[data-selected-media]')) button.disabled = true;
    renderMediaDetails(null);
    void refreshMediaDetails(true);
  });
  document.querySelector('#media-refresh').addEventListener('click', () => {
    void refreshMediaDetails(true);
  });
  document.querySelector('[data-tab="media"]').addEventListener('click', () => {
    setTimeout(() => { void refreshMediaDetails(); }, 0);
  });
  for (const button of document.querySelectorAll('[data-media]')) {
    button.addEventListener('click', () => {
      setTimeout(() => { void refreshMediaDetails(true); }, 700);
    });
  }
  setInterval(() => { void refreshMediaDetails(); }, 2500);
  setInterval(updateInterpolatedProgress, 500);
  setInterval(()=>{if(typeof wfs52RenderSeek==='function')wfs52RenderSeek();},1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMediaSessions, {once:true});
else initMediaSessions();
