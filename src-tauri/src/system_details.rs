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
