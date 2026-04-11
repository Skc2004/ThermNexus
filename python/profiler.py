import sqlite3
import time
import os
import logging
import config_loader
from predictor import get_power_consumption

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("thermalnexus.profiler")

cfg = config_loader.load_config()
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), cfg["paths"]["database"])

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS thermal_logs
                 (timestamp REAL, cpu_temp REAL, process_velocity REAL, fan_rpm INT, target_pwm INT, gpu_temp REAL, power_watts REAL)''')
    conn.commit()
    return conn

def get_current_mock_temp():
    try:
        # Standard hwmon path, defaulting to mock path if not updated yet
        with open("/tmp/hwmon_mock/hwmon0/temp1_input", "r") as f:
            return float(f.read().strip()) / 1000.0
    except:
        return 45.0

def get_current_pwm():
    try:
        with open("/tmp/hwmon_mock/hwmon0/pwm1", "r") as f:
            return int(f.read().strip())
    except:
        return 128

def record_data():
    log.info(f"Booting SQLite Profiler to {DB_PATH}")
    conn = init_db()
    c = conn.cursor()
    
    # Prune data older than 7 days
    c.execute("DELETE FROM thermal_logs WHERE timestamp < ?", (time.time() - 604800,))
    conn.commit()
    
    log.info("Beginning 1.0HZ Background Data Collection... Press Ctrl+C to stop.")
    try:
        while True:
            timestamp = time.time()
            cpu_temp = get_current_mock_temp()
            target_pwm = get_current_pwm()
            fan_rpm = int(target_pwm / 255.0 * 2000.0) # Mock rpm mapping algorithm
            process_velocity = 2.0 # Stub for active eBPF state
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
