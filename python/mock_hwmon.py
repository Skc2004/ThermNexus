import os
import time
import shutil

MOCK_DIR = "/tmp/hwmon_mock/hwmon0"

def setup_mock():
    print(f"Setting up mock hwmon in {MOCK_DIR}")
    base_dir = os.path.dirname(MOCK_DIR)
    
    if os.path.exists(base_dir):
        shutil.rmtree(base_dir)
        
    os.makedirs(MOCK_DIR)
    
    # Create driver name
    with open(os.path.join(MOCK_DIR, "name"), "w") as f:
        f.write("mock_thermal_nexus\n")
        
    # Create temp1_input
    with open(os.path.join(MOCK_DIR, "temp1_input"), "w") as f:
        f.write("45000\n")
    with open(os.path.join(MOCK_DIR, "temp1_label"), "w") as f:
        f.write("Mock CPU\n")
        
    # Create pwm1 and pwm1_enable
    with open(os.path.join(MOCK_DIR, "pwm1"), "w") as f:
        f.write("128\n")
    with open(os.path.join(MOCK_DIR, "pwm1_enable"), "w") as f:
        f.write("2\n") # BIOS controlled by default
        
    print("Mock directories running. Listening for changes to pwm1...")

def monitor_pwm():
    pwm_path = os.path.join(MOCK_DIR, "pwm1")
    enable_path = os.path.join(MOCK_DIR, "pwm1_enable")
    
    last_val = None
    last_enable = None
    
    try:
        while True:
            try:
                with open(pwm_path, "r") as f:
                    val = f.read().strip()
                with open(enable_path, "r") as f:
                    en_val = f.read().strip()
                    
                if val != last_val or en_val != last_enable:
                    last_val = val
                    last_enable = en_val
                    
                    mode = "BIOS" if en_val == "2" else "MANUAL"
                    try:
                        percent = (int(val)/255.0) * 100
                        print(f"[HW Simulation] -> Mode: {mode} ({en_val}) | Fan PWM set to: {val} ({percent:.1f}%)")
                    except ValueError:
                        print(f"[HW Simulation] -> Invalid PWM written: {val}")
                        
            except Exception as e:
                pass
                
            time.sleep(0.01) # Simulate high frequency poll
    except KeyboardInterrupt:
        print("\nShutting down HW simulation.")
        shutil.rmtree(os.path.dirname(MOCK_DIR))

if __name__ == "__main__":
    setup_mock()
    monitor_pwm()
