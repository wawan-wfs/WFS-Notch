//! Optional packaged Windows listener. No message contents, persistence or background polling.
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

static EPOCH: AtomicU64 = AtomicU64::new(1);
#[cfg(windows)]
static CONSENT: std::sync::Mutex<Option<(u64, std::time::Instant)>> = std::sync::Mutex::new(None);

#[derive(Serialize)]
pub struct OsNotificationRow {
    id: u32,
    at_ms: u64,
    app: String,
}

#[derive(Serialize)]
pub struct OsNotificationSnapshot {
    rows: Vec<OsNotificationRow>,
    total: u32,
    truncated: bool,
}

#[tauri::command]
pub fn stop_os_notification_session() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    #[cfg(windows)]
    if let Ok(mut consent) = CONSENT.lock() {
        *consent = None;
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::io::Read;
    use std::sync::atomic::AtomicBool;
    use windows::core::HSTRING;
    use windows::ApplicationModel::Package;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{
        Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Access},
        NotificationKinds,
    };

    static BUSY: AtomicBool = AtomicBool::new(false);

    pub struct Guard;

    impl Guard {
        pub fn acquire() -> Result<Self, String> {
            BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .map(|_| Self)
                .map_err(|_| "Windows notification worker busy".into())
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::SeqCst);
        }
    }

    fn decode_manifest(bytes: &[u8]) -> Option<String> {
        let (data, little) = if let Some(data) = bytes.strip_prefix(&[0xff, 0xfe]) {
            (data, true)
        } else if let Some(data) = bytes.strip_prefix(&[0xfe, 0xff]) {
            (data, false)
        } else {
            return std::str::from_utf8(bytes).ok().map(str::to_owned);
        };
        if !data.chunks_exact(2).remainder().is_empty() {
            return None;
        }
        let units: Vec<u16> = data
            .chunks_exact(2)
            .map(|pair| {
                if little {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        String::from_utf16(&units).ok()
    }

    pub fn listener() -> Result<UserNotificationListener, &'static str> {
        let package = Package::Current().map_err(|_| "unpackaged")?;
        let name = package
            .Id()
            .and_then(|id| id.Name())
            .map_err(|_| "package_unavailable")?;
        if name != "WFSProject.WFSNotch" {
            return Err("package_unavailable");
        }
        let folder = package.InstalledPath().map_err(|_| "package_unavailable")?;
        let manifest = std::path::PathBuf::from(folder.to_string()).join("AppxManifest.xml");
        let file = std::fs::File::open(manifest).map_err(|_| "manifest_unavailable")?;
        let mut bytes = Vec::new();
        file.take(262_145)
            .read_to_end(&mut bytes)
            .map_err(|_| "manifest_unavailable")?;
        if bytes.len() > 262_144 {
            return Err("manifest_unavailable");
        }
        let xml = decode_manifest(&bytes).ok_or("manifest_unavailable")?;
        if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
            return Err("manifest_unavailable");
        }
        let document = XmlDocument::new().map_err(|_| "manifest_unavailable")?;
        document
            .LoadXml(&HSTRING::from(xml.trim_start_matches('\u{feff}')))
            .map_err(|_| "manifest_unavailable")?;
        let nodes = document
            .SelectNodes(&HSTRING::from(concat!(
                "/*[local-name()='Package']/*[local-name()='Capabilities']/",
                "*[local-name()='Capability' and ",
                "namespace-uri()='http://schemas.microsoft.com/appx/manifest/uap/windows10/3'",
                " and @Name='userNotificationListener']"
            )))
            .map_err(|_| "manifest_unavailable")?;
        if nodes.Length().map_err(|_| "manifest_unavailable")? != 1 {
            return Err("missing_capability");
        }
        UserNotificationListener::Current().map_err(|_| "listener_unavailable")
    }

    pub fn status(value: Access) -> &'static str {
        if value == Access::Allowed {
            "allowed"
        } else if value == Access::Denied {
            "denied"
        } else if value == Access::Unspecified {
            "unspecified"
        } else {
            "listener_unavailable"
        }
    }

    pub fn access() -> String {
        match listener() {
            Ok(listener) => listener
                .GetAccessStatus()
                .map(status)
                .unwrap_or("listener_unavailable")
                .into(),
            Err(reason) => reason.into(),
        }
    }

    fn lease_valid(
        lease: Option<(u64, std::time::Instant)>,
        epoch: u64,
        now: std::time::Instant,
    ) -> bool {
        lease.is_some_and(|(allowed, expires)| allowed == epoch && now < expires)
    }

    pub fn permitted(epoch: u64) -> bool {
        epoch != 0
            && CONSENT.lock().is_ok_and(|lease| {
                EPOCH.load(Ordering::SeqCst) == epoch
                    && lease_valid(*lease, epoch, std::time::Instant::now())
            })
    }

    pub fn grant(epoch: u64) -> bool {
        if let Ok(mut lease) = CONSENT.lock() {
            if EPOCH.load(Ordering::SeqCst) == epoch {
                *lease = Some((
                    epoch,
                    std::time::Instant::now() + std::time::Duration::from_secs(600),
                ));
                return true;
            }
        }
        false
    }

    fn clean_name(value: &str) -> String {
        let value: String = value
            .chars()
            .filter(|c| {
                !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            })
            .take(120)
            .collect();
        if value.trim().is_empty() {
            "Unknown app".into()
        } else {
            value
        }
    }

    fn unix_ms(ticks: i64) -> Option<u64> {
        let ticks = ticks.checked_sub(116_444_736_000_000_000)?;
        let value = u64::try_from(ticks / 10_000).ok()?;
        (ticks >= 0 && value <= 253_402_300_799_999).then_some(value)
    }

    pub fn read(epoch: u64) -> Result<OsNotificationSnapshot, String> {
        if !permitted(epoch) {
            return Err("Explicit notification session consent required".into());
        }
        let listener = listener().map_err(str::to_owned)?;
        if listener.GetAccessStatus().ok() != Some(Access::Allowed) {
            stop_os_notification_session();
            return Err("Windows notification access is no longer allowed".into());
        }
        let view = listener
            .GetNotificationsAsync(NotificationKinds::Toast)
            .and_then(|operation| operation.join())
            .map_err(|_| "Windows notification snapshot unavailable".to_owned())?;
        let total = view.Size().map_err(|_| "Cannot read notification count")?;
        if total > 2_000 {
            return Err("Notification snapshot exceeds safe processing limit".into());
        }
        let mut rows = Vec::new();
        for index in 0..total {
            if !permitted(epoch) {
                return Err("Notification session stopped".into());
            }
            let item = view
                .GetAt(index)
                .map_err(|_| "Cannot read notification metadata")?;
            let id = item.Id().map_err(|_| "Missing notification identity")?;
            let time = item
                .CreationTime()
                .map_err(|_| "Missing notification time")?;
            let Some(at_ms) = unix_ms(time.UniversalTime) else {
                continue;
            };
            let app = item
                .AppInfo()
                .and_then(|info| info.DisplayInfo())
                .and_then(|info| info.DisplayName())
                .map(|name| clean_name(&name.to_string()))
                .unwrap_or_else(|_| "Unknown app".into());
            rows.push(OsNotificationRow { id, at_ms, app });
        }
        if !permitted(epoch) || listener.GetAccessStatus().ok() != Some(Access::Allowed) {
            stop_os_notification_session();
            return Err("Notification permission or session changed".into());
        }
        rows.sort_by_key(|row| std::cmp::Reverse(row.at_ms));
        let truncated = rows.len() > 200 || rows.len() != total as usize;
        rows.truncate(200);
        Ok(OsNotificationSnapshot {
            rows,
            total,
            truncated,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn metadata_bounds_and_redaction() {
            assert_eq!(decode_manifest(b"<a/>").as_deref(), Some("<a/>"));
            assert_eq!(decode_manifest(&[0xff, 0xfe, 65, 0]).as_deref(), Some("A"));
            assert_eq!(decode_manifest(&[0xfe, 0xff, 0, 65]).as_deref(), Some("A"));
            assert!(decode_manifest(&[0xff, 0xfe, 0]).is_none());
            assert_eq!(unix_ms(116_444_736_000_000_000), Some(0));
            assert_eq!(unix_ms(116_444_735_999_999_999), None);
            assert_eq!(unix_ms(i64::MIN), None);
            assert_eq!(clean_name("a\u{202e}b\n"), "ab");
            assert_eq!(clean_name("\n"), "Unknown app");
            assert_eq!(clean_name(&"x".repeat(200)).len(), 120);
            assert_eq!(status(Access::Denied), "denied");
        }

        #[test]
        fn stopped_epoch_cannot_read_notifications() {
            stop_os_notification_session();
            let epoch = EPOCH.load(Ordering::SeqCst);
            assert!(!permitted(epoch));
            assert!(grant(epoch));
            assert!(permitted(epoch));
            stop_os_notification_session();
            assert!(!permitted(epoch));
            assert!(read(epoch).is_err());
            assert!(!grant(epoch));
        }

        #[test]
        fn lease_expiration_and_wrong_epoch() {
            let now = std::time::Instant::now();
            let expires = now + std::time::Duration::from_secs(1);
            assert!(lease_valid(Some((7, expires)), 7, now));
            assert!(!lease_valid(Some((7, expires)), 8, now));
            assert!(!lease_valid(Some((7, expires)), 7, expires));
            assert!(!lease_valid(None, 7, now));
        }
    }
}

#[tauri::command]
pub async fn get_os_notification_access() -> Result<String, String> {
    #[cfg(windows)]
    {
        let guard = platform::Guard::acquire()?;
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            let status = platform::access();
            if status != "allowed" {
                stop_os_notification_session();
            }
            status
        })
        .await
        .map_err(|_| "Notification access worker failed".into())
    }
    #[cfg(not(windows))]
    {
        Ok("unsupported".into())
    }
}

#[tauri::command]
pub async fn request_os_notification_access(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        let guard = platform::Guard::acquire()?;
        stop_os_notification_session();
        let epoch = EPOCH.load(Ordering::SeqCst);
        let (sender, receiver) = std::sync::mpsc::channel();
        // Initiate on the UI thread; wait for the asynchronous result on a worker.
        app.run_on_main_thread(move || {
            if EPOCH.load(Ordering::SeqCst) != epoch {
                let _ = sender.send(Err("session_stopped"));
                return;
            }
            let result = platform::listener().and_then(|listener| {
                listener
                    .RequestAccessAsync()
                    .map_err(|_| "permission_request_unavailable")
            });
            let _ = sender.send(result);
        })
        .map_err(|_| "Cannot schedule Windows permission prompt")?;
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            let operation = receiver
                .recv_timeout(std::time::Duration::from_secs(15))
                .map_err(|_| "Windows permission prompt could not start")?;
            let operation = match operation {
                Ok(operation) => operation,
                Err(reason) => return Ok(reason.into()),
            };
            let value = operation
                .join()
                .map_err(|_| "Windows permission prompt failed")?;
            let status = platform::status(value);
            if status == "allowed" && platform::grant(epoch) {
                Ok(status.into())
            } else if status == "allowed" {
                Ok("session_stopped".into())
            } else {
                Ok(status.into())
            }
        })
        .await
        .map_err(|_| "Notification permission worker failed".to_owned())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok("unsupported".into())
    }
}

#[tauri::command]
pub async fn read_os_notification_snapshot() -> Result<OsNotificationSnapshot, String> {
    #[cfg(windows)]
    {
        let guard = platform::Guard::acquire()?;
        let epoch = EPOCH.load(Ordering::SeqCst);
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            platform::read(epoch)
        })
        .await
        .map_err(|_| "Notification snapshot worker failed".to_owned())?
    }
    #[cfg(not(windows))]
    {
        Err("Windows packaged notification listener required".into())
    }
}
