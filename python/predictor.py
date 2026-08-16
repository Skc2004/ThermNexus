import time
import os
import mmap
import struct
import torch
import torch.nn as nn
import signal
import atexit
import json
import logging
import config_loader
import rl_agent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("thermalnexus.brain")

try:
    from bcc import BPF
except ImportError:
    BPF = None

try:
    import pynvml
    pynvml.nvmlInit()
    GPU_HANDLE = pynvml.nvmlDeviceGetHandleByIndex(0)
    HAS_GPU = True
except Exception:
    HAS_GPU = False

# 1. GhostLink Writer (MappedByteBuffer bridge to Native Core)
class GhostLinkWriter:
    def __init__(self, filename="/tmp/thermal_ghostlink.shm"):
        self.filename = filename
        # Expanded to 128 bytes for multi-core and circuit-level action telemetry
        # Create or resize the file — do NOT delete it (Rust may already have it mmap'd)
        if not os.path.exists(self.filename):
            with open(self.filename, "wb") as f:
                f.write(b'\x00' * 128)
        else:
            # Ensure correct size without destroying the inode
            with open(self.filename, "r+b") as f:
                f.seek(0, 2)  # seek to end
                size = f.tell()
                if size < 128:
                    f.write(b'\x00' * (128 - size))
                
        self.f = open(self.filename, "r+b")
        self.mm = mmap.mmap(self.f.fileno(), 128, access=mmap.ACCESS_WRITE)
        
    def write_target(self, target_pwm, cpu_t, gpu_t, watts, pred_t, core_temps=None, target_case=128, target_pump=200, target_pl1_uw=0, target_cpu_freq_mhz=0, target_gpu_watts=0):
        now_ms = int(time.time() * 1000)
        self.mm.seek(0)
        
        # Base frame (32 bytes)
        base_data = struct.pack(">4s i q f f f f", b"GHLK", int(target_pwm), now_ms, float(cpu_t), float(gpu_t), float(watts), float(pred_t))
        
        # Core data (32 bytes for 8 cores)
        if core_temps is None or len(core_temps) < 8:
            core_temps = [cpu_t] * 8 # Fallback
        
        core_data = struct.pack(">8f", *core_temps[:8])
        
        self.mm.write(base_data)
        self.mm.write(core_data)
        
        # Action space expansion (16 bytes starting at offset 96)
        self.mm.seek(96)
        action_data = struct.pack(">i i q", int(target_case), int(target_pump), int(target_pl1_uw))
        self.mm.write(action_data)
        
        # CPU Freq expansion (4 bytes starting at offset 112)
        self.mm.seek(112)
        self.mm.write(struct.pack(">i", int(target_cpu_freq_mhz)))
        
        # GPU Watts expansion (4 bytes starting at offset 116)
        self.mm.seek(116)
        self.mm.write(struct.pack(">i", int(target_gpu_watts)))
        
        self.mm.flush()  # Force visibility to Rust daemon's mmap
        
    def zero_heartbeat(self):
        """Zero out heartbeat so Rust watchdog reverts to BIOS."""
        self.mm.seek(8)
        self.mm.write(struct.pack(">q", 0))

    def close(self):
        self.mm.close()
        self.f.close()

# 2. Kernel eBPF Hook (Catch deep tracepoint memory faults natively)
bpf_text = """
#include <linux/mm.h>

BPF_HASH(page_faults, u32, u64);

// Hooking into cache-misses and page allocations to predict heat BEFORE it hits silicon
TRACEPOINT_PROBE(kmem, mm_page_alloc) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 *val, zero = 0;
    
    val = page_faults.lookup_or_try_init(&pid, &zero);
    if (val) {
        (*val)++;
    }
    return 0;
}
"""

# 3. Pre-Emptive Thermal Brain (PyTorch Model)
class ThermalPredictor(nn.Module):
    def __init__(self):
        super(ThermalPredictor, self).__init__()
        # Input features: [PageAlloc_Velocity, CPU_Temp, GPU_Temp, CurrentWatts]
        self.lstm = nn.LSTM(input_size=4, hidden_size=64, num_layers=2, batch_first=True)
        self.linear = nn.Linear(64, 1) # Output: Predicted Heat Saturation T_{t+5s}
        
    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        # We only want the prediction from the final timestep
        return self.linear(lstm_out[:, -1, :])

def get_real_core_temps(config_path=None):
    """Read real per-core temperatures from sysfs via discovered config."""
    if config_path is None:
        config_path = os.path.join(os.path.dirname(__file__), "thermal_config.json")
    
    try:
        with open(config_path) as f:
            config = json.load(f)
        
        # Find the coretemp driver
        for hwmon_id, info in config.items():
            if info.get("name") == "coretemp":
                temps = []
                for sensor_id, sensor in sorted(info["temperatures"].items()):
                    if "Core" in sensor.get("label", ""):
                        try:
                            with open(sensor["input_file"]) as tf:
                                temps.append(float(tf.read().strip()) / 1000.0)
                        except (IOError, ValueError):
                            pass
                if temps:
                    # Pad to 8 cores if fewer
                    while len(temps) < 8:
                        temps.append(temps[-1])
                    return temps[:8]
    except Exception:
        pass
    return None

def get_current_mock_temp():
    try:
        with open("/tmp/hwmon_mock/hwmon0/temp1_input", "r") as f:
            return float(f.read().strip()) / 1000.0
    except Exception:
        return 45.0

def get_power_consumption():
    """Attempt to read real power consumption via Intel RAPL or psutil."""
    # Source A: Intel RAPL Energy Counter (Absolute power since boot)
    rapl_path = "/sys/class/powercap/intel-rapl:0/energy_uj"
    if os.path.exists(rapl_path):
        try:
            with open(rapl_path, "r") as f:
                uj1 = int(f.read().strip())
            time.sleep(0.1) # Delta measurement
            with open(rapl_path, "r") as f:
                uj2 = int(f.read().strip())
            # Power (W) = ΔEnergy (J) / ΔTime (s)
            return (uj2 - uj1) / (1000000 * 0.1)
        except Exception:
            pass

    # Source B: psutil fallback (if psutil sensor_battery is available)
    try:
        import psutil
        if hasattr(psutil, "sensors_battery"):
            batt = psutil.sensors_battery()
            if batt and not batt.power_plugged:
                # Approximate power = V * I (rarely available)
                # We'll just return a heuristic based on CPU load if we can't get direct power
                return 5.0 + (psutil.cpu_percent() * 0.25)
    except Exception:
        pass

    return 15.0 # Global Default Fallback

def run():
    log.info("1. Booting DeepMind eBPF X-Ray Probe...")
    b = None
    if BPF is not None:
        try:
            b = BPF(text=bpf_text)
            log.info(" -> BPF Memory Fault Hooks Injected Successfully.")
        except Exception:
            log.warning(" -> [WARN] BPF compilation failed (sudo required). Running in simulation fallback.")
            
    log.info(f"2. Booting GhostLink Shared Memory Buffer... GPU NVML Injected: {HAS_GPU}")
    ghost_link = GhostLinkWriter()
    
    def shutdown(gl):
        log.info("[SHUTDOWN] Zeroing heartbeat to trigger Rust watchdog...")
        try:
            gl.zero_heartbeat()
            gl.close()
        except Exception:
            pass

    signal.signal(signal.SIGTERM, lambda *_: shutdown(ghost_link))
    atexit.register(lambda: shutdown(ghost_link))
    
    log.info("3. Initializing PyTorch Predictor Model...")
    model = ThermalPredictor()
    
    cfg = config_loader.load_config()
    try:
        with open("capabilities.json", "r") as f:
            caps = json.load(f)
    except Exception:
        caps = {"can_control_gpu": False, "gpu_type": None, "can_control_dvfs": False}
        
    MODEL_WEIGHTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), cfg["paths"]["model_weights"])
    
    if os.path.exists(MODEL_WEIGHTS):
        model.load_state_dict(torch.load(MODEL_WEIGHTS, weights_only=True))
        log.info(f"Loaded trained weights from {MODEL_WEIGHTS}")
    else:
        log.warning("[WARN] No trained weights found — running with untrained model!")
        
    model.eval() # inference mode
    
    log.info("4. Initializing RL Actor-Critic Agent...")
    rl = rl_agent.RLThermalAgent(cfg)
    
    log.info("==== Python Brain Online. Pre-empting hardware workloads ====")
    current_pwm_state = 128
    
    history = []
    optimizer = torch.optim.Adam(model.parameters(), lr=0.0001)
    ONLINE_LEARN_INTERVAL = 10
    SEQ_LENGTH = 5
    feature_queue = []
    
    try:
        while True:
            # Memory Fault velocity
            mem_velocity = 0.0
            if b is not None:
                idx_table = b.get_table("page_faults")
                mem_velocity = float(len(idx_table))
                idx_table.clear()
            else:
                mem_velocity = 20.0 
                
            cpu_temp = get_current_mock_temp()
            current_watts = get_power_consumption()
            
            real_cores = get_real_core_temps()
            if real_cores:
                core_temps = real_cores
                cpu_temp = sum(core_temps) / len(core_temps)
            else:
                import random
                core_temps = [cpu_temp + random.uniform(-1.5, 1.5) for _ in range(8)]
            
            gpu_temp = 40.0
            if HAS_GPU:
                try:
                    gpu_temp = pynvml.nvmlDeviceGetTemperature(GPU_HANDLE, pynvml.NVML_TEMPERATURE_GPU)
                except Exception:
                    pass
                    
            # Sliding Window Queue Management
            current_feature = [mem_velocity, cpu_temp, gpu_temp, current_watts]
            feature_queue.append(current_feature)
            if len(feature_queue) > SEQ_LENGTH:
                feature_queue.pop(0)
            
            # Predict overall System T_{t+5s} based on CPU + GPU + Memory Cache Page Miss loads
            with torch.no_grad():
                if len(feature_queue) == SEQ_LENGTH:
                    inputs = torch.tensor([feature_queue], dtype=torch.float32)
                    predicted_temp = model(inputs).item()
                else:
                    predicted_temp = cpu_temp
            
            # === CONTINUOUS RL ACTOR-CRITIC INFERENCE ===
            state_list = [mem_velocity, cpu_temp, gpu_temp, current_watts, predicted_temp]
            try:
                target_pwm, target_case, target_pump, target_pl1_watts, target_gpu_watts, target_cpu_freq_mhz = rl.select_action(state_list)
                target_pl1_uw = int(target_pl1_watts * 1_000_000)
                
                # Dynamic Hardware Execution (Python Side)
                if caps.get("can_control_gpu") and caps.get("gpu_type") == "nvidia":
                    try:
                        pynvml.nvmlDeviceSetPowerManagementLimit(GPU_HANDLE, int(target_gpu_watts * 1000))
                    except Exception as gpu_e:
                        log.debug(f"Failed to set NVML power limit: {gpu_e}")
                        
            except Exception as e:
                log.error(f"RL Agent failed: {e}")
                target_pwm, target_case, target_pump, target_pl1_uw, target_cpu_freq_mhz = 128, 128, 128, 0, 0

            current_pwm_state = target_pwm
            ghost_link.write_target(target_pwm, cpu_temp, gpu_temp, current_watts, predicted_temp, core_temps, target_case, target_pump, target_pl1_uw, target_cpu_freq_mhz, target_gpu_watts)
            
            # Online fine-tuning history stack
            history.append((feature_queue.copy(), cpu_temp))
            if len(history) >= ONLINE_LEARN_INTERVAL + SEQ_LENGTH:
                old_seq, _ = history[-ONLINE_LEARN_INTERVAL]
                if len(old_seq) == SEQ_LENGTH:
                    inputs_train = torch.tensor([old_seq], dtype=torch.float32)
                    actual_now = torch.tensor([[cpu_temp]], dtype=torch.float32)
                    
                    model.train()
                    pred = model(inputs_train)
                    loss = nn.MSELoss()(pred, actual_now)
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()
                    model.eval()
                    
                    if len(history) % 100 == 0:
                        os.makedirs(os.path.dirname(MODEL_WEIGHTS), exist_ok=True)
                        torch.save(model.state_dict(), MODEL_WEIGHTS)
                    if len(history) > 1000:
                        history = history[-500:]
            
            log.info(f"Brain Metric -> PageFaults: {mem_velocity} | CPU: {cpu_temp:.1f}C | Power: {current_watts:.1f}W | Pred: {predicted_temp:.1f}C -> PWM: {target_pwm}")
            time.sleep(0.5)
            
    except KeyboardInterrupt:
        log.info("Shutting down eBPF Brain.")
        ghost_link.close()

if __name__ == "__main__":
    run()
