import socketio
import threading
import time
import json
import logging
import platform

log = logging.getLogger("CloudRelay")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [CLOUD] %(message)s")

sio = socketio.Client()
CLOUD_RELAY_URL = "http://127.0.0.1:3000" # Replace with hosted URL in production

@sio.event
def connect():
    log.info(f"Connected to Cloud Relay at {CLOUD_RELAY_URL}")

@sio.event
def disconnect():
    log.warning("Disconnected from Cloud Relay.")

def push_loop():
    while True:
        try:
            if not sio.connected:
                sio.connect(CLOUD_RELAY_URL, wait_timeout=3)
            
            # Fetch latest data from local API server
            import requests
            res = requests.get("http://127.0.0.1:8889/ai/metrics", timeout=2)
            if res.status_code == 200:
                data = res.json()
                if data.get("status") == "ok":
                    payload = data.get("data")
                    payload["hostname"] = platform.node()
                    sio.emit("push_telemetry", payload)
        except Exception as e:
            pass # Suppress connection errors if offline
            
        time.sleep(2) # Push every 2 seconds

def start_cloud_relay():
    threading.Thread(target=push_loop, daemon=True).start()
    log.info("Cloud Telemetry pusher active.")

if __name__ == "__main__":
    start_cloud_relay()
    while True:
        time.sleep(1)
