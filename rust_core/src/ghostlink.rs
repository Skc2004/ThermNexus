use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;
use std::path::Path;

pub struct GhostLink {
    mmap: MmapMut,
}

impl GhostLink {
    pub fn new(path: &str) -> std::io::Result<Self> {
        let file_path = Path::new(path);
        
        // Expand to 320 bytes for Option D hardware telemetry
        if !file_path.exists() {
            let file = std::fs::File::create(file_path)?;
            file.set_len(320)?;
        }
        
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(file_path)?;

        let mmap = unsafe { MmapOptions::new().len(320).map_mut(&file)? };

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

    pub fn get_target_pwm_case(&self) -> i32 {
        self.volatile_read_i32(96)
    }

    pub fn get_target_pwm_pump(&self) -> i32 {
        self.volatile_read_i32(100)
    }

    pub fn get_target_pl1_uw(&self) -> i64 {
        self.volatile_read_i64(104)
    }

    pub fn get_target_cpu_freq_mhz(&self) -> i32 {
        self.volatile_read_i32(112)
    }

    pub fn get_target_gpu_watts(&self) -> i32 {
        self.volatile_read_i32(116)
    }

    pub fn get_target_voltage_offset_mv(&self) -> i32 {
        self.volatile_read_i32(120)
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

    /// Read 8 per-core frequency targets starting at offset 128 (in MHz)
    pub fn get_per_core_freqs(&self) -> Vec<i32> {
        let mut freqs = Vec::with_capacity(8);
        for i in 0..8 {
            let start = 128 + (i * 4);
            freqs.push(self.volatile_read_i32(start));
        }
        freqs
    }

    pub fn get_ssd_temp(&self) -> f32 {
        self.volatile_read_f32(160)
    }

    pub fn get_ram_temp(&self) -> f32 {
        self.volatile_read_f32(164)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::Path;

    fn write_be_bytes(path: &str, offset: u64, bytes: &[u8]) {
        use std::io::{Seek, SeekFrom};
        let mut file = OpenOptions::new().write(true).open(path).unwrap();
        file.seek(SeekFrom::Start(offset)).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn test_ghostlink_mmap_creation() {
        let path = "/tmp/test_ghostlink_create.shm";
        let _ = std::fs::remove_file(path);
        let _gl = GhostLink::new(path).unwrap();
        assert!(Path::new(path).exists());
        let meta = std::fs::metadata(path).unwrap();
        assert_eq!(meta.len(), 320);
    }

    #[test]
    fn test_ghostlink_reads() {
        let path = "/tmp/test_ghostlink_reads.shm";
        let _ = std::fs::remove_file(path);
        let gl = GhostLink::new(path).unwrap();

        write_be_bytes(path, 4, &150i32.to_be_bytes());
        write_be_bytes(path, 8, &1678886400000i64.to_be_bytes());
        write_be_bytes(path, 16, &45.5f32.to_be_bytes());
        write_be_bytes(path, 20, &60.2f32.to_be_bytes());
        write_be_bytes(path, 24, &120.0f32.to_be_bytes());
        write_be_bytes(path, 28, &55.5f32.to_be_bytes());

        let core_temps = [40.0f32, 41.0, 42.0, 43.0, 44.0, 45.0, 46.0, 47.0];
        for (i, &temp) in core_temps.iter().enumerate() {
            write_be_bytes(path, 32 + (i as u64 * 4), &temp.to_be_bytes());
        }

        assert_eq!(gl.get_target_pwm(), 150);
        assert_eq!(gl.get_last_heartbeat(), 1678886400000);
        assert_eq!(gl.get_cpu_temp(), 45.5);
        assert_eq!(gl.get_gpu_temp(), 60.2);
        assert_eq!(gl.get_watts(), 120.0);
        assert_eq!(gl.get_predicted_temp(), 55.5);

        let cores = gl.get_core_temps();
        assert_eq!(cores.len(), 8);
        for i in 0..8 {
            assert_eq!(cores[i], core_temps[i]);
        }
    }
}
