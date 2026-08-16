import sqlite3
import time
import os
import logging
import json
import psutil
import config_loader
from predictor import get_power_consumption

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("thermalnexus.profiler")

cfg = config_loader.load_config()
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(PROJECT_DIR, cfg["paths"]["database"])
PROFILES_PATH = os.path.join(PROJECT_DIR, "python", "profiles.json")
ACTIVE_PROFILE_PATH = os.path.join(PROJECT_DIR, "active_profile.json")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS thermal_logs
                 (timestamp REAL, cpu_temp REAL, process_velocity REAL, fan_rpm INT, target_pwm INT, gpu_temp REAL, power_watts REAL)''')
    conn.commit()
    return conn

def get_current_mock_temp():
    try:
        with open("/tmp/hwmon_mock/hwmon0/temp1_input", "r") as f:
            return float(f.read().strip()) / 1000.0
    except Exception:
        return 45.0

def get_current_pwm():
    try:
        with open("/tmp/hwmon_mock/hwmon0/pwm1", "r") as f:
            return int(f.read().strip())
    except Exception:
        return 128

def load_profiles():
    try:
        with open(PROFILES_PATH, "r") as f:
            return json.load(f)
    except:
        return {}

def update_active_profile(profiles):
    top_proc_name = "idle"
    top_cpu = 0.0
    
    try:
        for proc in psutil.process_iter(['name', 'cpu_percent']):
            try:
                cpu = proc.info['cpu_percent'] or 0.0
                if cpu > top_cpu:
                    top_cpu = cpu
                    top_proc_name = proc.info['name']
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
    except Exception as e:
        log.error(f"Error scanning processes: {e}")
        
    mode = "default"
    if top_proc_name != "idle":
        for k, v in profiles.items():
            if k.lower() in top_proc_name.lower():
                mode = v
                break
                
    active_data = {
        "app": top_proc_name,
        "mode": mode,
        "cpu_usage": top_cpu
    }
    
    try:
        with open(ACTIVE_PROFILE_PATH, "w") as f:
            json.dump(active_data, f)
    except Exception as e:
        log.error(f"Failed to write active profile: {e}")
        
    return top_cpu

def record_data():
    log.info(f"Booting SQLite Profiler to {DB_PATH}")
    conn = init_db()
    c = conn.cursor()
    
    # Prune data older than 7 days
    c.execute("DELETE FROM thermal_logs WHERE timestamp < ?", (time.time() - 604800,))
    conn.commit()
    
    log.info("Beginning 1.0HZ Background Data Collection... Press Ctrl+C to stop.")
    
    # Initial psutil call to baseline cpu_percent
    psutil.cpu_percent()
    
    try:
        while True:
            timestamp = time.time()
            cpu_temp = get_current_mock_temp()
            target_pwm = get_current_pwm()
            fan_rpm = int(target_pwm / 255.0 * 2000.0)
            
            profiles = load_profiles()
            process_velocity = update_active_profile(profiles)
            
            gpu_temp = 40.0
            power_watts = get_power_consumption()
            
            c.execute("INSERT INTO thermal_logs VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (timestamp, cpu_temp, process_velocity, fan_rpm, target_pwm, gpu_temp, power_watts))
            conn.commit()
            
            time.sleep(1.0)
    except KeyboardInterrupt:
        log.info("Data collection smoothly terminated. Matrix saved to SQLite file.")
        conn.close()

if __name__ == "__main__":
    record_data()
