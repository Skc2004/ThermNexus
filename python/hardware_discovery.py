import os
import glob
import json

def read_sysfs(path):
    try:
        with open(path, 'r') as f:
            return f.read().strip()
    except OSError:
        return None

def discover_sensors():
    hwmon_dirs = glob.glob('/sys/class/hwmon/hwmon*')
    discovery_map = {}

    for hwmon in hwmon_dirs:
        # Some drivers expose attributes directly, some within 'device'
        search_dirs = [hwmon, os.path.join(hwmon, 'device')]
        
        hwmon_id = os.path.basename(hwmon)
        name = read_sysfs(os.path.join(hwmon, 'name'))
        
        hwmon_info = {
            "name": name,
            "path": hwmon,
            "temperatures": {},
            "pwms": {}
        }
        
        found_sensors = False
        
        for sdir in search_dirs:
            if not os.path.exists(sdir):
                continue
                
            # Find temperature sensors
            temp_inputs = glob.glob(os.path.join(sdir, 'temp*_input'))
            for temp in temp_inputs:
                base_name = os.path.basename(temp).replace('_input', '')
                label = read_sysfs(os.path.join(sdir, f"{base_name}_label"))
                val = read_sysfs(temp)
                
                hwmon_info["temperatures"][base_name] = {
                    "label": label if label else "Unknown",
                    "input_file": temp,
                    "current_value": val
                }
                found_sensors = True
                
            # Find PWM controls
            pwm_controls = glob.glob(os.path.join(sdir, 'pwm*'))
            primary_pwms = [p for p in pwm_controls if os.path.basename(p).startswith('pwm') and '_' not in os.path.basename(p)[3:]]
            
            for pwm in primary_pwms:
                base_name = os.path.basename(pwm)
                enable_file = os.path.join(sdir, f"{base_name}_enable")
                enable_val = read_sysfs(enable_file)
                val = read_sysfs(pwm)
                
                hwmon_info["pwms"][base_name] = {
                    "pwm_file": pwm,
                    "enable_file": enable_file if os.path.exists(enable_file) else None,
                    "current_value": val,
                    "enable_mode": enable_val
                }
                found_sensors = True
                
        if found_sensors:
            discovery_map[hwmon_id] = hwmon_info
            
    return discovery_map

def discover_capabilities():
    caps = {
        "can_control_gpu": False,
        "gpu_type": None,
        "can_control_dvfs": False
    }
    
    # 1. Check NVIDIA NVML
    try:
        import pynvml
        pynvml.nvmlInit()
        caps["can_control_gpu"] = True
        caps["gpu_type"] = "nvidia"
    except Exception:
        pass
        
    # 2. Check AMD GPU if NVIDIA not found
    if not caps["can_control_gpu"]:
        amd_paths = glob.glob('/sys/class/drm/card*/device/hwmon/hwmon*/power1_cap')
        if len(amd_paths) > 0:
            caps["can_control_gpu"] = True
            caps["gpu_type"] = "amd"
            
    # 3. Check CPU DVFS (cpufreq)
    if os.path.exists('/sys/devices/system/cpu/cpufreq/'):
        policies = glob.glob('/sys/devices/system/cpu/cpufreq/policy*')
        if len(policies) > 0:
            # Check if we can write to scaling_max_freq
            test_file = os.path.join(policies[0], 'scaling_max_freq')
            if os.path.exists(test_file):
                caps["can_control_dvfs"] = True
                
    return caps

if __name__ == '__main__':
    print("Starting Hardware Discovery for ThermalNexus...")
    data = discover_sensors()
    caps = discover_capabilities()
    
    with open('thermal_config.json', 'w') as f:
        json.dump(data, f, indent=4)
        
    with open('capabilities.json', 'w') as f:
        json.dump(caps, f, indent=4)
        
    print(f"Discovered {len(data)} hwmon device(s) with sensors.")
    print(f"Map written to thermal_config.json in {os.getcwd()}")
    print(f"Capabilities written to capabilities.json: {caps}")
    print("\nSummary of discovered hardware:")
    for hw_id, info in data.items():
        print(f"- {hw_id} ({info['name']}): {len(info['temperatures'])} temp sensors, {len(info['pwms'])} PWM controllers")
