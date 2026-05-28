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

    /// Read an i32 from the mmap using volatile reads (safe for IPC shared memory)
    fn volatile_read_i32(&self, offset: usize) -> i32 {
        let ptr = self.mmap[offset..].as_ptr() as *const i32;
        let raw = unsafe { std::ptr::read_volatile(ptr) };
        i32::from_be_bytes(raw.to_ne_bytes())
    }

    /// Read an i64 from the mmap using volatile reads (safe for IPC shared memory)
    fn volatile_read_i64(&self, offset: usize) -> i64 {
        let ptr = self.mmap[offset..].as_ptr() as *const i64;
        let raw = unsafe { std::ptr::read_volatile(ptr) };
        i64::from_be_bytes(raw.to_ne_bytes())
    }

    /// Read an f32 from the mmap using volatile reads (safe for IPC shared memory)
    fn volatile_read_f32(&self, offset: usize) -> f32 {
        let ptr = self.mmap[offset..].as_ptr() as *const u32;
        let raw = unsafe { std::ptr::read_volatile(ptr) };
        f32::from_be_bytes(raw.to_ne_bytes())
    }

    pub fn get_target_pwm(&self) -> i32 {
        self.volatile_read_i32(4)
    }

    pub fn get_last_heartbeat(&self) -> i64 {
        self.volatile_read_i64(8)
    }

    pub fn get_cpu_temp(&self) -> f32 {
        self.volatile_read_f32(16)
    }

    pub fn get_gpu_temp(&self) -> f32 {
        self.volatile_read_f32(20)
    }

    pub fn get_watts(&self) -> f32 {
        self.volatile_read_f32(24)
    }

    pub fn get_predicted_temp(&self) -> f32 {
        self.volatile_read_f32(28)
    }

    /// Read 8 core temperature slots starting at offset 32
    pub fn get_core_temps(&self) -> Vec<f32> {
        let mut cores = Vec::with_capacity(8);
        for i in 0..8 {
            let start = 32 + (i * 4);
            cores.push(self.volatile_read_f32(start));
        }
        cores
    }
}
