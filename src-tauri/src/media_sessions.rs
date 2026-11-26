//! Opt-in, read-only Windows Global System Media Transport Controls session snapshot.
//! No microphone access, audio capture, files, credentials, or network calls.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

static MEDIA_WORKER_BUSY: AtomicBool = AtomicBool::new(false);

struct MediaWorkerGuard;

impl MediaWorkerGuard {
    fn acquire() -> Result<Self, String> {
        MEDIA_WORKER_BUSY
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Windows media worker busy; retry after current request".to_owned())?;
        Ok(Self)
    }
}

impl Drop for MediaWorkerGuard {
    fn drop(&mut self) {
        MEDIA_WORKER_BUSY.store(false, Ordering::Release);
    }
}

async fn media_worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MediaWorkerGuard::acquire()?;
        operation()
    })
    .await
    .map_err(|error| format!("Media worker failed: {error}"))?
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveMediaSnapshot {
    source: String,
    title: String,
    artist: String,
    album: String,
    playback_status: String,
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
    artwork_data_url: Option<String>,
}

/// Media SourceAppUserModelId is an application ID, NOT a tab/instance ID.
/// Only select a player when exactly one currently visible session matches.
fn select_unique_source<T>(
    requested: &str,
    candidates: impl IntoIterator<Item = (String, T)>,
) -> Result<Option<T>, String> {
    let mut chosen = None;
    for (source, session) in candidates {
        if source == requested {
            if chosen.is_some() {
                return Err("Ambiguous Windows media app ID: multiple sessions match".into());
            }
            chosen = Some(session);
        }
    }
    Ok(chosen)
}

fn non_negative_ms(time_100ns: i64) -> u64 {
    (time_100ns.max(0) / 10_000) as u64
}

fn normalized_timeline(start: i64, position: i64, end: i64) -> (u64, u64) {
    // GSMTC timelines may start at a nonzero 100ns offset.
    let total = non_negative_ms(end.saturating_sub(start));
    let elapsed = non_negative_ms(position.saturating_sub(start)).min(total);
    (elapsed, total)
}

fn artwork_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

#[cfg(windows)]
fn artwork_data_url(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    use base64::Engine;
    use windows::Storage::Streams::DataReader;

    const MAX_ARTWORK_BYTES: u64 = 512 * 1024;
    let reference = properties.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return None;
    }
    let input = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
    if loaded == 0 || u64::from(loaded) > size {
        return None;
    }
    let mut image = vec![0_u8; loaded as usize];
    reader.ReadBytes(&mut image).ok()?;
    let mime = artwork_mime(&image)?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image)
    ))
}

#[cfg(windows)]
fn read_session_with_source(
    requested_source: Option<&str>,
) -> Result<Option<ActiveMediaSnapshot>, String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    // A blocking thread is used, never the Tauri UI thread. Repeated polling only happens
    // while the user explicitly opens the Media panel, not in the background.
    let manager = MediaManager::RequestAsync()
        .map_err(|error| format!("Windows media manager unavailable: {error}"))?
        .join()
        .map_err(|error| format!("Cannot access Windows media sessions: {error}"))?;
    let session = if let Some(requested) = requested_source {
        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().map_err(|e| e.to_string())?;
        if count > 64 {
            return Err("Too many Windows media sessions to select safely".into());
        }
        let mut candidates = Vec::new();
        for i in 0..count {
            let candidate = sessions
                .GetAt(i)
                .map_err(|_| "Cannot inspect all Windows media sessions")?;
            let source = candidate
                .SourceAppUserModelId()
                .map_err(|_| "Cannot verify Windows media app identity")?
                .to_string();
            candidates.push((source, candidate));
        }
        match select_unique_source(requested, candidates)? {
            Some(session) => session,
            None => return Ok(None), // Disconnected; never substitute another player.
        }
    } else {
        match manager.GetCurrentSession() {
            Ok(session) => session,
            Err(_) => return Ok(None),
        }
    };
    let properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(|error| format!("Media properties unavailable: {error}"))?
        .join()
        .map_err(|error| format!("Cannot read current track: {error}"))?;

    let status = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|value| {
            if value == Status::Playing {
                "Playing"
            } else if value == Status::Paused {
                "Paused"
            } else if value == Status::Stopped {
                "Stopped"
            } else {
                "Inactive"
            }
        })
        .unwrap_or("Unknown")
        .to_owned();

    let timeline = session.GetTimelineProperties().ok();
    let (position_ms, duration_ms) = timeline
        .as_ref()
        .and_then(|time| {
            let start = time.StartTime().ok()?.Duration;
            let position = time.Position().ok()?.Duration;
            let end = time.EndTime().ok()?.Duration;
            Some(normalized_timeline(start, position, end))
        })
        .map_or((None, None), |(pos, total)| (Some(pos), Some(total)));
    Ok(Some(ActiveMediaSnapshot {
        source: session
            .SourceAppUserModelId()
            .map(|x| x.to_string())
            .unwrap_or_default(),
        title: properties
            .Title()
            .map(|x| x.to_string())
            .unwrap_or_default(),
        artist: properties
            .Artist()
            .map(|x| x.to_string())
            .unwrap_or_default(),
        album: properties
            .AlbumTitle()
            .map(|x| x.to_string())
            .unwrap_or_default(),
        playback_status: status,
        position_ms,
        duration_ms,
        artwork_data_url: artwork_data_url(&properties),
    }))
}

#[cfg(windows)]
fn read_session() -> Result<Option<ActiveMediaSnapshot>, String> {
    read_session_with_source(None)
}

#[cfg(not(windows))]
fn read_session() -> Result<Option<ActiveMediaSnapshot>, String> {
    Err("Native media sessions are available only on Windows".into())
}

#[cfg(not(windows))]
fn read_session_with_source(_source: Option<&str>) -> Result<Option<ActiveMediaSnapshot>, String> {
    Err("Native media sessions are available only on Windows".into())
}

#[tauri::command]
pub async fn get_media_session_by_source(
    source: String,
) -> Result<Option<ActiveMediaSnapshot>, String> {
    if source.is_empty() || source.len() > 256 || source.chars().any(char::is_control) {
        return Err("Invalid media source".into());
    }
    media_worker(move || read_session_with_source(Some(&source))).await
}

#[tauri::command]
pub async fn get_active_media_session() -> Result<Option<ActiveMediaSnapshot>, String> {
    media_worker(read_session).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gsmct_source_identity_is_not_sufficient_for_multiple_tabs_or_players() {
        let candidates = vec![
            ("browser.id".to_owned(), "Tab one"),
            ("spotify.id".to_owned(), "Spotify"),
            ("browser.id".to_owned(), "Tab two"),
        ];
        assert!(select_unique_source("browser.id", candidates.clone()).is_err());
        assert_eq!(
            select_unique_source("spotify.id", candidates.clone()).unwrap(),
            Some("Spotify")
        );
        assert_eq!(
            select_unique_source("disconnected", candidates).unwrap(),
            None
        );
    }

    #[test]
    fn artwork_mime_strictly_limits_local_image_types() {
        assert_eq!(
            artwork_mime(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
            Some("image/png")
        );
        assert_eq!(artwork_mime(&[0xff, 0xd8, 0xff, 0x00]), Some("image/jpeg"));
        assert_eq!(artwork_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(artwork_mime(b"<svg onload=alert(1)>"), None);
        assert_eq!(artwork_mime(b"<html>"), None);
    }

    #[test]
    fn progress_is_clamped_to_track_and_handles_nonzero_start() {
        assert_eq!(normalized_timeline(100_000, 600_000, 1_100_000), (50, 100));
        assert_eq!(normalized_timeline(100_000, 0, 1_100_000), (0, 100));
        assert_eq!(
            normalized_timeline(100_000, 2_000_000, 1_100_000),
            (100, 100)
        );
        assert_eq!(normalized_timeline(100_000, 0, 50_000), (0, 0));
    }

    #[test]
    fn time_conversion_clamps_negative_and_100ns_units() {
        assert_eq!(non_negative_ms(1_234_560), 123);
        assert_eq!(non_negative_ms(-10), 0);
        assert_eq!(non_negative_ms(10_000), 1);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaSessionChoice {
    source: String,
    title: String,
    artist: String,
    playback_status: String,
    can_toggle: bool,
    can_play: bool,
    can_pause: bool,
    can_next: bool,
    can_previous: bool,
    can_seek: bool,
    // An AUMID can represent several tabs/instances. No action may guess
    // which instance should receive a command.
    ambiguous: bool,
}

fn valid_control(action: &str) -> bool {
    matches!(action, "toggle" | "play" | "pause" | "next" | "previous")
}

#[cfg(windows)]
fn read_media_choices() -> Result<Vec<MediaSessionChoice>, String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    let manager = MediaManager::RequestAsync()
        .map_err(|e| format!("Media manager unavailable: {e}"))?
        .join()
        .map_err(|e| format!("Cannot read Windows sessions: {e}"))?;
    let view = manager.GetSessions().map_err(|e| e.to_string())?;
    let count = view.Size().map_err(|e| e.to_string())?;
    if count > 64 {
        return Err("Too many Windows media sessions to enumerate safely".into());
    }
    let mut result: Vec<MediaSessionChoice> = Vec::new();
    for index in 0..count {
        let Ok(session) = view.GetAt(index) else {
            continue;
        };
        let source = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();
        if source.is_empty() || source.len() > 256 || source.chars().any(char::is_control) {
            continue;
        }
        if let Some(existing) = result.iter_mut().find(|item| item.source == source) {
            existing.ambiguous = true;
            existing.can_toggle = false;
            existing.can_play = false;
            existing.can_pause = false;
            existing.can_next = false;
            existing.can_previous = false;
            existing.can_seek = false;
            continue;
        }
        let properties = session
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|operation| operation.join().ok());
        let title = properties
            .as_ref()
            .and_then(|p| p.Title().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let artist = properties
            .as_ref()
            .and_then(|p| p.Artist().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let status = session
            .GetPlaybackInfo()
            .ok()
            .and_then(|information| information.PlaybackStatus().ok())
            .map(|status| {
                if status == Status::Playing {
                    "Playing"
                } else if status == Status::Paused {
                    "Paused"
                } else {
                    "Inactive"
                }
            })
            .unwrap_or("Unknown")
            .to_owned();
        let controls = session
            .GetPlaybackInfo()
            .ok()
            .and_then(|info| info.Controls().ok());
        result.push(MediaSessionChoice {
            source,
            title,
            artist,
            playback_status: status,
            can_toggle: controls
                .as_ref()
                .and_then(|c| c.IsPlayPauseToggleEnabled().ok())
                .unwrap_or(false),
            can_play: controls
                .as_ref()
                .and_then(|c| c.IsPlayEnabled().ok())
                .unwrap_or(false),
            can_pause: controls
                .as_ref()
                .and_then(|c| c.IsPauseEnabled().ok())
                .unwrap_or(false),
            can_next: controls
                .as_ref()
                .and_then(|c| c.IsNextEnabled().ok())
                .unwrap_or(false),
            can_previous: controls
                .as_ref()
                .and_then(|c| c.IsPreviousEnabled().ok())
                .unwrap_or(false),
            can_seek: controls
                .as_ref()
                .and_then(|c| c.IsPlaybackPositionEnabled().ok())
                .unwrap_or(false),
            ambiguous: false,
        });
    }
    Ok(result)
}

#[cfg(not(windows))]
fn read_media_choices() -> Result<Vec<MediaSessionChoice>, String> {
    Err("Windows media session selection is available only on Windows".into())
}

#[tauri::command]
pub async fn list_media_sessions() -> Result<Vec<MediaSessionChoice>, String> {
    media_worker(read_media_choices).await
}

#[cfg(windows)]
fn apply_media_control(source: &str, action: &str) -> Result<bool, String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as MediaManager;
    let manager = MediaManager::RequestAsync()
        .map_err(|e| format!("Media manager unavailable: {e}"))?
        .join()
        .map_err(|e| format!("Cannot read Windows sessions: {e}"))?;
    let view = manager.GetSessions().map_err(|e| e.to_string())?;
    let count = view.Size().map_err(|e| e.to_string())?;
    if count > 64 {
        return Err("Too many Windows media sessions to control safely".into());
    }
    let mut candidates = Vec::new();
    for index in 0..count {
        let session = view
            .GetAt(index)
            .map_err(|_| "Cannot inspect all Windows media sessions")?;
        let id = session
            .SourceAppUserModelId()
            .map_err(|_| "Cannot verify Windows media app identity")?
            .to_string();
        candidates.push((id, session));
    }
    let session = select_unique_source(source, candidates)?
        .ok_or("Selected Windows media session was disconnected")?;
    // Query controls again on the *current* session, not stale UI metadata.
    let controls = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.Controls().ok());
    let supported = match action {
        "toggle" => controls
            .as_ref()
            .and_then(|c| c.IsPlayPauseToggleEnabled().ok()),
        "play" => controls.as_ref().and_then(|c| c.IsPlayEnabled().ok()),
        "pause" => controls.as_ref().and_then(|c| c.IsPauseEnabled().ok()),
        "next" => controls.as_ref().and_then(|c| c.IsNextEnabled().ok()),
        "previous" => controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()),
        _ => None,
    };
    if supported != Some(true) {
        return Ok(false);
    }
    let operation = match action {
        "toggle" => session.TryTogglePlayPauseAsync(),
        "play" => session.TryPlayAsync(),
        "pause" => session.TryPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "previous" => session.TrySkipPreviousAsync(),
        _ => return Err("Unsupported media action".into()),
    }
    .map_err(|e| format!("Media player rejected control: {e}"))?;
    operation
        .join()
        .map_err(|e| format!("Media player did not respond: {e}"))
}

#[cfg(not(windows))]
fn apply_media_control(_source: &str, _action: &str) -> Result<bool, String> {
    Err("Media controls require Windows".into())
}

#[tauri::command]
pub async fn control_media_session(source: String, action: String) -> Result<bool, String> {
    if source.is_empty()
        || source.len() > 256
        || source.chars().any(char::is_control)
        || !valid_control(&action)
    {
        return Err("Invalid media player or playback action".into());
    }
    media_worker(move || apply_media_control(&source, &action)).await
}

#[cfg(test)]
mod phase10_tests {
    use super::*;
    #[test]
    fn media_worker_guard_releases_after_scope() {
        {
            let _guard = MediaWorkerGuard::acquire().unwrap();
            assert!(MediaWorkerGuard::acquire().is_err());
        }
        assert!(MediaWorkerGuard::acquire().is_ok());
    }

    #[test]
    fn media_actions_are_strictly_allowlisted() {
        assert!(valid_control("toggle"));
        assert!(valid_control("play"));
        assert!(valid_control("pause"));
        assert!(valid_control("next"));
        assert!(valid_control("previous"));
        assert!(!valid_control("record"));
        assert!(!valid_control("delete"));
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct SeekRequest {
    source: String,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    position_ms: u64,
}

// Convert a relative displayed position into the absolute Windows timeline ticks.
// Never guess a seekable range for live/unknown streams.
fn seek_ticks(start: i64, end: i64, min: i64, max: i64, request: &SeekRequest) -> Option<i64> {
    let duration = end.checked_sub(start)?;
    if duration <= 0
        || non_negative_ms(duration) != request.duration_ms
        || request.position_ms > request.duration_ms
        || min >= max
    {
        return None;
    }
    let relative = i64::try_from(request.position_ms)
        .ok()?
        .checked_mul(10_000)?;
    let target = start.checked_add(relative)?;
    (target >= start && target <= end && target >= min && target <= max).then_some(target)
}

fn valid_seek_request(r: &SeekRequest) -> bool {
    !r.source.is_empty()
        && r.source.len() <= 256
        && !r.source.chars().any(char::is_control)
        && !r.title.trim().is_empty()
        && r.title.len() <= 4096
        && r.artist.len() <= 4096
        && r.album.len() <= 4096
        && (1..=604_800_000).contains(&r.duration_ms)
        && r.position_ms <= r.duration_ms
}

#[cfg(windows)]
fn apply_media_seek(request: &SeekRequest) -> Result<bool, String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as MediaManager;
    let manager = MediaManager::RequestAsync()
        .and_then(|operation| operation.join())
        .map_err(|e| e.to_string())?;
    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    let count = sessions.Size().map_err(|e| e.to_string())?;
    if count > 64 {
        return Err("Too many Windows sessions to seek safely".into());
    }
    let mut candidates = Vec::new();
    for index in 0..count {
        let session = sessions.GetAt(index).map_err(|e| e.to_string())?;
        let source = session.SourceAppUserModelId().map_err(|e| e.to_string())?;
        candidates.push((source.to_string(), session));
    }
    let session = select_unique_source(&request.source, candidates)?
        .ok_or("Selected media session disconnected")?;
    let props = session
        .TryGetMediaPropertiesAsync()
        .and_then(|operation| operation.join())
        .map_err(|e| e.to_string())?;
    if props.Title().map_err(|e| e.to_string())? != request.title
        || props.Artist().map_err(|e| e.to_string())? != request.artist
        || props.AlbumTitle().map_err(|e| e.to_string())? != request.album
    {
        return Err("Media changed; refresh before seeking".into());
    }
    let controls = session
        .GetPlaybackInfo()
        .and_then(|info| info.Controls())
        .map_err(|e| e.to_string())?;
    if !controls
        .IsPlaybackPositionEnabled()
        .map_err(|e| e.to_string())?
    {
        return Ok(false);
    }
    let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
    let target = seek_ticks(
        timeline.StartTime().map_err(|e| e.to_string())?.Duration,
        timeline.EndTime().map_err(|e| e.to_string())?.Duration,
        timeline.MinSeekTime().map_err(|e| e.to_string())?.Duration,
        timeline.MaxSeekTime().map_err(|e| e.to_string())?.Duration,
        request,
    )
    .ok_or("Playback timeline changed or position is not seekable")?;
    session
        .TryChangePlaybackPositionAsync(target)
        .and_then(|operation| operation.join())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn apply_media_seek(_request: &SeekRequest) -> Result<bool, String> {
    Err("Media seeking requires Windows".into())
}

#[tauri::command]
pub async fn seek_media_session(request: SeekRequest) -> Result<bool, String> {
    if !valid_seek_request(&request) {
        return Err("Invalid media seek request".into());
    }
    media_worker(move || apply_media_seek(&request)).await
}

#[cfg(test)]
mod seek_tests {
    use super::*;

    #[test]
    fn seek_checks_offset_bounds_and_stale_duration() {
        let mut request = SeekRequest {
            source: "player".into(),
            title: "Track".into(),
            artist: "Artist".into(),
            album: String::new(),
            duration_ms: 100,
            position_ms: 50,
        };
        assert!(valid_seek_request(&request));
        assert_eq!(
            seek_ticks(100_000, 1_100_000, 100_000, 1_100_000, &request),
            Some(600_000)
        );
        assert_eq!(
            seek_ticks(100_000, 1_100_000, 700_000, 1_100_000, &request),
            None
        );
        assert_eq!(
            seek_ticks(100_000, 1_200_000, 100_000, 1_200_000, &request),
            None
        );
        request.position_ms = 101;
        assert!(!valid_seek_request(&request));
    }
}
