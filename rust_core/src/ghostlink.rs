use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;
use std::path::Path;

pub struct GhostLink {
    mmap: MmapMut,
}

impl GhostLink {
    pub fn new(path: &str) -> std::io::Result<Self> {
        let file_path = Path::new(path);
        
        // Expand to 96 bytes for multi-core thermal mapping
        if !file_path.exists() {
            let file = std::fs::File::create(file_path)?;
            file.set_len(96)?;
        }
        
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(file_path)?;

        let mmap = unsafe { MmapOptions::new().len(96).map_mut(&file)? };

        Ok(GhostLink { mmap })
    }

    pub fn get_target_pwm(&self) -> i32 {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.mmap[4..8]);
        i32::from_be_bytes(buf)
    }

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

    /// Read 8 core temperature slots starting at offset 32
    pub fn get_core_temps(&self) -> Vec<f32> {
        let mut cores = Vec::with_capacity(8);
        for i in 0..8 {
            let start = 32 + (i * 4);
            let mut buf = [0u8; 4];
            buf.copy_from_slice(&self.mmap[start..start+4]);
            cores.push(f32::from_be_bytes(buf));
        }
        cores
    }
}
