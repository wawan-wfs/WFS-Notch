//! Read-only disk and network inventory based on sysinfo 0.33.
use crate::now_ms;
use serde::Serialize;
use sysinfo::{Disks, Networks};

#[derive(Debug, Serialize)]
pub struct DiskSummary {
    label: String,
    mount: String,
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct NetworkSummary {
    name: String,
    received_bytes: u64,
    transmitted_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct SystemDetails {
    disks: Vec<DiskSummary>,
    networks: Vec<NetworkSummary>,
    sampled_at_ms: u128,
}

fn used_bytes(total: u64, available: u64) -> u64 {
    total.saturating_sub(available)
}

#[tauri::command]
pub fn get_system_details() -> SystemDetails {
    // No elevation, network requests, wifi scanning, or process history.
    let disks = Disks::new_with_refreshed_list();
    let mut disk_details: Vec<DiskSummary> = disks
        .list()
        .iter()
        .filter(|disk| disk.total_space() > 0)
        .take(24)
        .map(|disk| DiskSummary {
            label: disk.name().to_string_lossy().to_string(),
            mount: disk.mount_point().display().to_string(),
            total_bytes: disk.total_space(),
            used_bytes: used_bytes(disk.total_space(), disk.available_space()),
            available_bytes: disk.available_space(),
        })
        .collect();
    disk_details.sort_by(|a, b| a.mount.cmp(&b.mount));

    let networks = Networks::new_with_refreshed_list();
    let mut network_details: Vec<NetworkSummary> = networks
        .iter()
        .take(32)
        .map(|(name, network)| NetworkSummary {
            name: name.to_owned(),
            received_bytes: network.total_received(),
            transmitted_bytes: network.total_transmitted(),
        })
        .collect();
    network_details.sort_by(|a, b| a.name.cmp(&b.name));

    SystemDetails {
        disks: disk_details,
        networks: network_details,
        sampled_at_ms: now_ms(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn used_space_saturates_on_invalid_available_bytes() {
        assert_eq!(used_bytes(100, 40), 60);
        assert_eq!(used_bytes(100, 150), 0);
        assert_eq!(used_bytes(0, 0), 0);
    }
}

#[derive(Debug, Serialize)]
pub struct DeviceDiagnostics {
    os_name: Option<String>,
    os_version: Option<String>,
    kernel_version: Option<String>,
    architecture: &'static str,
    logical_cpus: Option<usize>,
    memory_total_bytes: Option<u64>,
    uptime_seconds: Option<u64>,
}

/// Explicitly requested, local-only snapshot. No host name, serial, user or IP.
#[tauri::command]
pub fn get_device_diagnostics() -> Result<DeviceDiagnostics, String> {
    if !cfg!(windows) {
        return Err("Device diagnostics are available on Windows only".into());
    }
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let memory = system.total_memory();
    Ok(DeviceDiagnostics {
        os_name: sysinfo::System::name(),
        os_version: sysinfo::System::os_version(),
        kernel_version: sysinfo::System::kernel_version(),
        architecture: std::env::consts::ARCH,
        logical_cpus: std::thread::available_parallelism()
            .ok()
            .map(std::num::NonZeroUsize::get),
        memory_total_bytes: (memory > 0).then_some(memory),
        uptime_seconds: Some(sysinfo::System::uptime()),
    })
}

#[derive(Debug, Serialize)]
pub struct AudioEndpoint {
    name: String,
    enabled: Option<bool>,
    is_default: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AudioGroup {
    status: &'static str,
    endpoints: Vec<AudioEndpoint>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct AudioInventory {
    output: AudioGroup,
    input: AudioGroup,
}

#[cfg(windows)]
fn read_audio_group(class: windows::Devices::Enumeration::DeviceClass) -> AudioGroup {
    use windows::Devices::Enumeration::DeviceInformation;
    let result = DeviceInformation::FindAllAsyncDeviceClass(class).and_then(|op| op.join());
    let failed = |status: &'static str| AudioGroup {
        status,
        endpoints: Vec::new(),
        truncated: false,
    };
    let devices = match result {
        Ok(devices) => devices,
        Err(error) => {
            return failed(if error.code().0 as u32 == 0x80070005 {
                "denied"
            } else {
                "unavailable"
            });
        }
    };
    let Ok(count) = devices.Size() else {
        return failed("unavailable");
    };
    let mut endpoints = Vec::new();
    let mut partial = false;
    for index in 0..count.min(32) {
        let Ok(device) = devices.GetAt(index) else {
            partial = true;
            continue;
        };
        let name = device
            .Name()
            .ok()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default()
            .chars()
            .filter(|character| !character.is_control())
            .take(200)
            .collect::<String>();
        let enabled = device.IsEnabled().ok();
        let is_default = device.IsDefault().ok();
        partial |= name.trim().is_empty() || enabled.is_none() || is_default.is_none();
        endpoints.push(AudioEndpoint {
            name: if name.trim().is_empty() {
                "Unnamed audio endpoint".into()
            } else {
                name
            },
            enabled,
            is_default,
        });
    }
    AudioGroup {
        status: if partial { "partial" } else { "ok" },
        endpoints,
        truncated: count > 32,
    }
}

#[cfg(windows)]
fn read_audio_inventory() -> AudioInventory {
    use windows::Devices::Enumeration::DeviceClass;
    AudioInventory {
        output: read_audio_group(DeviceClass::AudioRender),
        input: read_audio_group(DeviceClass::AudioCapture),
    }
}

#[cfg(windows)]
static AUDIO_INVENTORY_BUSY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
struct AudioInventoryGuard;

#[cfg(windows)]
impl Drop for AudioInventoryGuard {
    fn drop(&mut self) {
        AUDIO_INVENTORY_BUSY.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[tauri::command]
pub async fn get_audio_inventory() -> Result<AudioInventory, String> {
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        AUDIO_INVENTORY_BUSY
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Audio inventory already in progress".to_owned())?;
        let guard = AudioInventoryGuard;
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            read_audio_inventory()
        })
        .await
        .map_err(|_| "Audio inventory worker failed".to_owned())
    }
    #[cfg(not(windows))]
    {
        Err("Audio inventory is available on Windows only".into())
    }
}

#[derive(Debug, Serialize)]
pub struct OutputVolume {
    token: String,
    percent: u8,
    muted: bool,
}

fn volume_state_matches(old: f32, old_mute: bool, current: f32, current_mute: bool) -> bool {
    old.is_finite()
        && current.is_finite()
        && (0.0..=1.0).contains(&current)
        && (old - current).abs() <= 0.001
        && old_mute == current_mute
}

fn valid_volume_change(percent: Option<u8>, muted: Option<bool>) -> bool {
    match (percent, muted) {
        (Some(value), None) => value <= 100,
        (None, Some(_)) => true,
        _ => false,
    }
}

#[cfg(windows)]
struct VolumeLease {
    token: String,
    endpoint: String,
    scalar: f32,
    muted: bool,
    issued: std::time::Instant,
}

#[cfg(windows)]
static VOLUME_LEASE: std::sync::Mutex<Option<VolumeLease>> = std::sync::Mutex::new(None);

#[cfg(windows)]
struct VolumeComGuard;

#[cfg(windows)]
impl Drop for VolumeComGuard {
    fn drop(&mut self) {
        // Balance only the successful CoInitializeEx call in with_output_volume.
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
}

#[cfg(windows)]
fn with_output_volume<T>(
    operation: impl FnOnce(
        String,
        &windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume,
    ) -> Result<T, String>,
) -> Result<T, String> {
    use windows::Win32::{
        Media::Audio::{
            eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    };
    // No COM interfaces cross a thread boundary; the guard outlives all interfaces.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|_| "Windows audio COM initialization failed".to_owned())?;
    let _com = VolumeComGuard;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|_| "Windows audio enumerator unavailable".to_owned())?;
    let endpoint = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
        .map_err(|_| "Default multimedia output unavailable".to_owned())?;
    let raw = unsafe { endpoint.GetId() }
        .map_err(|_| "Cannot identify current output endpoint".to_owned())?;
    if raw.is_null() {
        return Err("Empty Windows output identity".into());
    }
    let endpoint_id = unsafe { raw.to_string() };
    unsafe { CoTaskMemFree(Some(raw.0.cast())) };
    let endpoint_id = endpoint_id.map_err(|_| "Invalid Windows output identity".to_owned())?;
    if endpoint_id.is_empty() {
        return Err("Empty Windows output identity".into());
    }
    let volume: IAudioEndpointVolume = unsafe { endpoint.Activate(CLSCTX_ALL, None) }
        .map_err(|_| "Windows endpoint volume unavailable".to_owned())?;
    operation(endpoint_id, &volume)
}

#[cfg(windows)]
fn volume_snapshot(
    endpoint: String,
    volume: &windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume,
    lease: &mut Option<VolumeLease>,
) -> Result<OutputVolume, String> {
    let scalar = unsafe { volume.GetMasterVolumeLevelScalar() }
        .map_err(|_| "Cannot read Windows output volume".to_owned())?;
    if !scalar.is_finite() || !(0.0..=1.0).contains(&scalar) {
        return Err("Invalid output volume from Windows".into());
    }
    let muted = unsafe { volume.GetMute() }
        .map_err(|_| "Cannot read Windows mute state".to_owned())?
        .as_bool();
    let token = crate::new_id();
    *lease = Some(VolumeLease {
        token: token.clone(),
        endpoint,
        scalar,
        muted,
        issued: std::time::Instant::now(),
    });
    Ok(OutputVolume {
        token,
        percent: (scalar * 100.0).round() as u8,
        muted,
    })
}

#[tauri::command]
pub async fn get_default_output_volume() -> Result<OutputVolume, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let mut lease = VOLUME_LEASE.lock().map_err(|_| "Audio state unavailable")?;
            *lease = None;
            with_output_volume(|endpoint, volume| volume_snapshot(endpoint, volume, &mut lease))
        })
        .await
        .map_err(|_| "Audio volume worker failed".to_owned())?
    }
    #[cfg(not(windows))]
    {
        Err("Output volume requires Windows".into())
    }
}

#[tauri::command]
pub async fn set_default_output_volume(
    token: String,
    percent: Option<u8>,
    muted: Option<bool>,
) -> Result<OutputVolume, String> {
    if token.is_empty() || token.len() > 128 || !valid_volume_change(percent, muted) {
        return Err("Invalid output volume request".into());
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut lease = VOLUME_LEASE.lock().map_err(|_| "Audio state unavailable")?;
            let selected = lease.take().ok_or("Read output volume again")?;
            if selected.token != token || selected.issued.elapsed().as_secs() >= 30 {
                return Err("Audio snapshot expired; read again".into());
            }
            with_output_volume(|endpoint, volume| {
                if endpoint != selected.endpoint {
                    return Err("Default output changed; read the new endpoint first".into());
                }
                let current = unsafe { volume.GetMasterVolumeLevelScalar() }
                    .map_err(|_| "Cannot revalidate current output volume".to_owned())?;
                let current_mute = unsafe { volume.GetMute() }
                    .map_err(|_| "Cannot revalidate current mute state".to_owned())?
                    .as_bool();
                if !volume_state_matches(selected.scalar, selected.muted, current, current_mute) {
                    return Err("Output state changed in Windows; read it again".into());
                }
                let result = match (percent, muted) {
                    (Some(value), None) => unsafe {
                        volume
                            .SetMasterVolumeLevelScalar(f32::from(value) / 100.0, std::ptr::null())
                    },
                    (None, Some(value)) => unsafe { volume.SetMute(value, std::ptr::null()) },
                    _ => return Err("Invalid output volume action".into()),
                };
                result.map_err(|_| "Windows rejected the output volume action".to_owned())?;
                volume_snapshot(endpoint, volume, &mut lease).map_err(|_| {
                    "Volume action may have changed Windows; read the output again".to_owned()
                })
            })
        })
        .await
        .map_err(|_| "Audio volume worker failed; read again".to_owned())?
    }
    #[cfg(not(windows))]
    {
        Err("Output volume requires Windows".into())
    }
}

#[cfg(test)]
mod output_volume_tests {
    use super::*;

    #[test]
    fn volume_change_is_single_action_and_bounded() {
        assert!(volume_state_matches(0.4, false, 0.4, false));
        assert!(!volume_state_matches(0.4, false, 0.5, false));
        assert!(!volume_state_matches(0.4, false, 0.4, true));
        assert!(!volume_state_matches(0.4, false, f32::NAN, false));
        assert!(valid_volume_change(Some(0), None));
        assert!(valid_volume_change(Some(100), None));
        assert!(valid_volume_change(None, Some(false)));
        assert!(!valid_volume_change(Some(101), None));
        assert!(!valid_volume_change(Some(30), Some(true)));
        assert!(!valid_volume_change(None, None));
    }
}
