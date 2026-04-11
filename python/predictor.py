import time
import os
import mmap
import struct
import torch
import torch.nn as nn

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
        # Expanded to 96 bytes for multi-core and action telemetry
        if os.path.exists(self.filename):
            os.remove(self.filename) 
        
        with open(self.filename, "wb") as f:
            f.write(b'\x00' * 96)
                
        self.f = open(self.filename, "r+b")
        self.mm = mmap.mmap(self.f.fileno(), 96, access=mmap.ACCESS_WRITE)
        
    def write_target(self, target_pwm, cpu_t, gpu_t, watts, pred_t, core_temps=None):
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
        # Inputs: [PageAlloc_Velocity, CPU_Temp, GPU_Temp, CurrentWatts]
        self.linear1 = nn.Linear(4, 32) 
        self.relu = nn.ReLU()
        self.linear2 = nn.Linear(32, 1) # Output: Predicted Heat Saturation T_{t+5s}
        
    def forward(self, x):
        x = self.linear1(x)
        x = self.relu(x)
        return self.linear2(x)

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
    print("1. Booting DeepMind eBPF X-Ray Probe...")
    b = None
    if BPF is not None:
        try:
            b = BPF(text=bpf_text)
            print(" -> BPF Memory Fault Hooks Injected Successfully.")
        except Exception as e:
            print(f" -> [WARN] BPF compilation failed (sudo required). Running in simulation fallback.")
            
    print(f"2. Booting GhostLink Shared Memory Buffer... GPU NVML Injected: {HAS_GPU}")
    ghost_link = GhostLinkWriter()
    
    print("3. Initializing PyTorch Predictor Model...")
    model = ThermalPredictor()
    model.eval() # inference mode
    
    print("==== Python Brain Online. Pre-empting hardware workloads ====")
    current_pwm_state = 128
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
            
            # Generate 8 Core Temps with jitter for the Thermal Map
            import random
            core_temps = [cpu_temp + random.uniform(-1.5, 1.5) for _ in range(8)]
            
            gpu_temp = 40.0
            if HAS_GPU:
                try:
                    gpu_temp = pynvml.nvmlDeviceGetTemperature(GPU_HANDLE, pynvml.NVML_TEMPERATURE_GPU)
                except:
                    pass
            
            # Predict overall System T_{t+5s} based on CPU + GPU + Memory Cache Page Miss loads
            with torch.no_grad():
                inputs = torch.tensor([[mem_velocity, cpu_temp, gpu_temp, current_watts]], dtype=torch.float32)
                predicted_temp = model(inputs).item()
            
            # === MODEL PREDICTIVE CONTROL (MPC) HORIZON ===
            try:
                from scipy.optimize import minimize
                
                T_target = 45.0
                
                def mpc_cost(pwm_action):
                    action = pwm_action[0]
                    delta_pwm = action - current_pwm_state
                    projected_t = predicted_temp - (action / 10.0)
                    
                    acoustic_penalty = 0.5 * (delta_pwm ** 2)
                    thermal_penalty = 20.0 * max(0, projected_t - T_target)**2
                    return acoustic_penalty + thermal_penalty

                res = minimize(mpc_cost, [current_pwm_state], bounds=[(40, 255)])
                target_pwm = int(res.x[0])
            except ImportError:
                target_pwm = 80 # Idle baseline
                if predicted_temp > 50.0:
                    target_pwm = int(min(255, (predicted_temp - 50) * 12 + 80))
            
            current_pwm_state = target_pwm
            ghost_link.write_target(target_pwm, cpu_temp, gpu_temp, current_watts, predicted_temp, core_temps)
            
            print(f"Brain Metric -> PageFaults: {mem_velocity} | CPU: {cpu_temp:.1f}C | Power: {current_watts:.1f}W | Pred: {predicted_temp:.1f}C -> PWM: {target_pwm}")
            time.sleep(0.5)
            
    except KeyboardInterrupt:
        print("Shutting down eBPF Brain.")
        ghost_link.close()

if __name__ == "__main__":
    run()
