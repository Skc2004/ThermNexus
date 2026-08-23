import time
import struct
import mmap
import os
import json
import logging
from openrgb import OpenRGBClient
from openrgb.utils import RGBColor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [RGB-SYNC] %(message)s")
log = logging.getLogger("RGBSync")

GHOSTLINK_PATH = os.environ.get("THERMNEXUS_GHOSTLINK", "/tmp/thermal_ghostlink.shm")
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rgb_config.json")

def get_color_for_temp(cpu_temp, pwm):
    """Map CPU Temp and Fan Speed to RGB colors."""
    # Base breathing effect
    if cpu_temp > 85:
        # Critical: Fast pulsing Red
        return RGBColor(255, 0, 0)
    elif cpu_temp > 70:
        # Under Load: Orange/Amber
        return RGBColor(255, 100, 0)
    elif cpu_temp > 55:
        # Warm: Blue
        return RGBColor(0, 100, 255)
    else:
        # Cool/Idle: Cyan or Green
        return RGBColor(0, 255, 150)

def main():
    log.info("ThermNexus RGB Sync Daemon starting...")
    
    # Wait for GhostLink to be created by Predictor
    while not os.path.exists(GHOSTLINK_PATH):
        time.sleep(1)
        
    f = open(GHOSTLINK_PATH, "r+b")
    mm = mmap.mmap(f.fileno(), 320, access=mmap.ACCESS_READ)
    
    client = None
    try:
        client = OpenRGBClient()
        log.info(f"Connected to OpenRGB Server. Found {len(client.devices)} devices.")
    except Exception as e:
        log.error(f"Could not connect to OpenRGB: {e}. Retrying in 10s...")
    
    while True:
        try:
            # Check if enabled
            enabled = False
            if os.path.exists(CONFIG_PATH):
                with open(CONFIG_PATH, "r") as cf:
                    cfg = json.load(cf)
                    enabled = cfg.get("enabled", False)
                    
            if not enabled:
                time.sleep(2)
                continue
                
            if client is None:
                try:
                    client = OpenRGBClient()
                except:
                    time.sleep(5)
                    continue

            mm.seek(0)
            header = mm.read(32)
            if len(header) == 32:
                magic, target_pwm, ts, cpu_temp, gpu_temp, watts, pred_temp = struct.unpack('>4s I Q f f f f', header)
                if magic == b'GHLK':
                    color = get_color_for_temp(cpu_temp, target_pwm)
                    # Apply to all devices
                    for device in client.devices:
                        try:
                            device.set_color(color)
                        except: pass
            
        except Exception as e:
            log.error(f"RGB Sync error: {e}")
            client = None # Force reconnect
            
        time.sleep(0.5) # Update at 2Hz

if __name__ == "__main__":
    main()
