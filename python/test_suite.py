import sys
import time
import json
import asyncio
import websockets
import os
import signal
import subprocess

def log_test(name, result, msg=""):
    status = "[PASS]" if result else "[FAIL]"
    print(f"{status} {name} {msg}")

async def test_suite():
    print("=== ThermNexus Integration Test Suite ===")

    # 1. Mock Hardware Verification
    hwmon_base = "/tmp/hwmon_mock/hwmon0"
    log_test("Mock Hardware Dir Exists", os.path.exists(hwmon_base))
    
    mock_ready = os.path.exists(f"{hwmon_base}/pwm1") and os.path.exists(f"{hwmon_base}/pwm1_enable")
    log_test("Mock Hardware Sensors Initialized", mock_ready)

    # 2. GhostLink IPC Verification
    shm_path = "/tmp/thermal_ghostlink.shm"
    if os.path.exists(shm_path):
        size = os.path.getsize(shm_path)
        log_test("GhostLink Mmap Size Verified", size == 96, f"({size} bytes)")
    else:
        log_test("GhostLink IPC Verified", False, "File missing")

    # 3. Rust Daemon WebSocket & 8-Core Data Output
    try:
        async with websockets.connect("ws://127.0.0.1:8888", ping_timeout=None) as ws:
            log_test("WebSocket Server Reachable", True)
            
            msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
            data = json.loads(msg)
            
            # Verify core contents
            has_8_cores = "core_temps" in data and len(data["core_temps"]) == 8
            log_test("Rust IPC -> WebSocket Array Stream (8 Cores)", has_8_cores)
            
            has_physics = "pwm" in data and "watts" in data
            log_test("WebSocket Physics Telemetry Valid", has_physics)
            
            # 4. Watchdog Test Setup
            print("\n- Initiating Watchdog Failsafe Test...")
            
            # Put hardware in manual override via WS first to prove 2-way comms
            await ws.send(json.dumps({"type": "MANUAL_OVERRIDE", "pwm": 210}))
            time.sleep(0.5)
            
            with open(f"{hwmon_base}/pwm1", "r") as f:
                pwm_val = int(f.read().strip())
                log_test("WebSocket UI -> Native Hardware Manual Override", pwm_val == 210)
                
            await ws.send(json.dumps({"type": "RELEASE_OVERRIDE"}))
            time.sleep(0.5)

    except Exception as e:
        log_test("WebSocket Interrogation", False, f"Error: {e}")

    # 5. Native Watchdog Drop Test
    print("\n- Terminating Python predictor to simulate kernel AI crash...")
    subprocess.run(["pkill", "-f", "predictor.py"])
    
    # Predictor is dead. Watchdog timeout is 2 seconds. Wait 3 to be safe.
    print("- Waiting waiting 3 seconds for Rust Daemon Watchdog tick...")
    for i in range(3, 0, -1):
        time.sleep(1)
        
    try:
        with open(f"{hwmon_base}/pwm1_enable", "r") as f:
            val = int(f.read().strip())
            # 2 = BIOS control (failsafe)
            log_test("Rust Daemon Safety Watchdog Triggered (Revert to BIOS)", val == 2)
    except Exception as e:
        log_test("Rust Daemon Safety Watchdog", False, "Could not read pwm1_enable")

    print("\n=== Test Suite Complete ===")

if __name__ == "__main__":
    asyncio.run(test_suite())
