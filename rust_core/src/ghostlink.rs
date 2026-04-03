use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;
use std::path::Path;

pub struct GhostLink {
    mmap: MmapMut,
}

impl GhostLink {
    pub fn new(path: &str) -> std::io::Result<Self> {
        let file_path = Path::new(path);
        
        // Ensure file exists and is 32 bytes (Expanded for Hardware Metrics).
        if !file_path.exists() {
            let file = std::fs::File::create(file_path)?;
            file.set_len(32)?;
        }
        
        // Open file with Read+Write privileges for Memory Map integration
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(file_path)?;

        let mmap = unsafe { MmapOptions::new().len(32).map_mut(&file)? };

        Ok(GhostLink { mmap })
    }

    /// Pull target PWM using exactly identical Byte Order from Python
    pub fn get_target_pwm(&self) -> i32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[4..8]);
        i32::from_be_bytes(buf)
    }

    /// Pull last Python heartbeat timestamp from offsets 8-15 bytes
    pub fn get_last_heartbeat(&self) -> i64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self.mmap[8..16]);
        i64::from_be_bytes(buf)
    }

    pub fn get_cpu_temp(&self) -> f32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[16..20]);
        f32::from_be_bytes(buf)
    }

    pub fn get_gpu_temp(&self) -> f32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[20..24]);
        f32::from_be_bytes(buf)
    }

    pub fn get_watts(&self) -> f32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[24..28]);
        f32::from_be_bytes(buf)
    }

    pub fn get_predicted_temp(&self) -> f32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[28..32]);
        f32::from_be_bytes(buf)
    }
}
