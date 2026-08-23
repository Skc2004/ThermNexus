from flask import Flask, jsonify, request
import sqlite3
import os
import time
import config_loader
from diagnostic_runner import runner

try:
    import swarm_discovery
    HAS_SWARM = True
except ImportError:
    HAS_SWARM = False

try:
    import cloud_telemetry
    HAS_CLOUD = True
except ImportError:
    HAS_CLOUD = False

app = Flask(__name__)
cfg = config_loader.load_config()
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), cfg["paths"]["database"])

# Allow Cross-Origin Requests from the React frontend running locally on 5173 or packed Electron
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route("/history", methods=["GET"])
def get_history():
    hours = request.args.get("hours", default=24, type=int)
    limit = request.args.get("limit", default=1000, type=int)
    
    cutoff = time.time() - (hours * 3600)
    
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT timestamp, cpu_temp, gpu_temp, power_watts, target_pwm FROM thermal_logs WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?", (cutoff, limit))
        rows = c.fetchall()
        conn.close()
        
        # Reverse to chronologically ascending for the frontend chart playback
        rows.reverse()
        
        payload = []
        for r in rows:
            payload.append({
                "time": int(r[0] * 1000),
                "cpu_temp": r[1],
                "gpu_temp": r[2],
                "power_watts": r[3],
                "pwm": r[4]
            })
        return jsonify({"status": "ok", "data": payload})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/capabilities", methods=["GET"])
def get_capabilities():
    try:
        caps_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "capabilities.json")
        with open(caps_path, "r") as f:
            import json
            caps = json.load(f)
        return jsonify({"status": "ok", "data": caps})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/diagnostics/start", methods=["POST"])
def start_diagnostic():
    success = runner.start()
    if success:
        return jsonify({"status": "ok", "message": "Diagnostic started"})
    else:
        return jsonify({"status": "error", "message": "Diagnostic already running or complete"}), 400

@app.route("/diagnostics/status", methods=["GET"])
def get_diagnostic_status():
    return jsonify({"status": "ok", "data": runner.get_state()})

@app.route("/diagnostics/history", methods=["GET"])
def get_diagnostic_history():
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "thermal_profile.db")
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT timestamp, score, peak_temp, final_temp, dissipation, message FROM diagnostic_history ORDER BY timestamp ASC")
        rows = c.fetchall()
        conn.close()
        
        history = []
        for r in rows:
            history.append({
                "timestamp": r[0] * 1000,
                "score": r[1],
                "peak_temp": r[2],
                "final_temp": r[3],
                "dissipation": r[4],
                "message": r[5]
            })
        return jsonify({"status": "ok", "data": history})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/profile/active", methods=["GET"])
def get_active_profile():
    try:
        active_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "active_profile.json")
        if os.path.exists(active_path):
            with open(active_path, "r") as f:
                import json
                data = json.load(f)
            return jsonify({"status": "ok", "data": data})
        else:
            return jsonify({"status": "ok", "data": {"app": "idle", "mode": "default", "cpu_usage": 0.0}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/action/cryoboost", methods=["POST"])
def activate_cryoboost():
    try:
        import json
        duration = request.json.get("duration", 30) if request.json else 30
        end_time = time.time() + duration
        with open("/tmp/thermal_cryo_boost.json", "w") as f:
            json.dump({"active_until": end_time}, f)
        return jsonify({"status": "ok", "message": f"Cryo-Boost engaged for {duration} seconds"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/config/acoustic", methods=["POST"])
def set_acoustic_mode():
    try:
        import json
        enabled = request.json.get("enabled", False) if request.json else False
        with open("/tmp/thermal_acoustic.json", "w") as f:
            json.dump({"enabled": enabled}, f)
        return jsonify({"status": "ok", "message": f"Acoustic mode set to {enabled}"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/config/fancurve", methods=["GET", "POST"])
def manage_fancurve():
    # Curve format: [{"temp": 30, "pwm": 40}, {"temp": 50, "pwm": 128}, {"temp": 80, "pwm": 255}]
    curve_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fancurve.json")
    try:
        if request.method == "POST":
            import json
            curve_data = request.json.get("curve", []) if request.json else []
            enabled = request.json.get("enabled", False) if request.json else False
            with open(curve_path, "w") as f:
                json.dump({"enabled": enabled, "curve": curve_data}, f)
            return jsonify({"status": "ok", "message": "Fan curve updated."})
        else:
            if os.path.exists(curve_path):
                import json
                with open(curve_path, "r") as f:
                    data = json.load(f)
                return jsonify({"status": "ok", "data": data})
            else:
                default_curve = [
                    {"temp": 30, "pwm": 40},
                    {"temp": 50, "pwm": 120},
                    {"temp": 70, "pwm": 180},
                    {"temp": 85, "pwm": 255}
                ]
                return jsonify({"status": "ok", "data": {"enabled": False, "curve": default_curve}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/config/profiles", methods=["GET", "POST"])
def manage_profiles():
    profile_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python", "profiles.json")
    try:
        import json
        if request.method == "POST":
            profiles = request.json if request.json else {}
            with open(profile_path, "w") as f:
                json.dump(profiles, f, indent=2)
            return jsonify({"status": "ok", "message": "Profiles updated."})
        else:
            if os.path.exists(profile_path):
                with open(profile_path, "r") as f:
                    data = json.load(f)
                return jsonify({"status": "ok", "data": data})
            return jsonify({"status": "ok", "data": {}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/system/processes", methods=["GET"])
def get_processes():
    try:
        import psutil
        procs = []
        for proc in psutil.process_iter(['name', 'cpu_percent', 'memory_percent']):
            try:
                if proc.info['cpu_percent'] > 0.1 or proc.info['memory_percent'] > 0.5:
                    procs.append({
                        "name": proc.info['name'],
                        "cpu": round(proc.info['cpu_percent'], 1),
                        "mem": round(proc.info['memory_percent'], 1)
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        
        # Sort by CPU usage and deduplicate by name
        procs = sorted(procs, key=lambda x: x['cpu'], reverse=True)
        unique_procs = []
        seen = set()
        for p in procs:
            if p["name"] not in seen:
                seen.add(p["name"])
                unique_procs.append(p)
                
        return jsonify({"status": "ok", "data": unique_procs[:20]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/config/rgb", methods=["GET", "POST"])
def manage_rgb():
    cfg_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rgb_config.json")
    try:
        import json
        if request.method == "POST":
            data = request.json if request.json else {}
            with open(cfg_path, "w") as f:
                json.dump(data, f)
            return jsonify({"status": "ok", "message": "RGB config updated."})
        else:
            if os.path.exists(cfg_path):
                with open(cfg_path, "r") as f:
                    data = json.load(f)
                return jsonify({"status": "ok", "data": data})
            return jsonify({"status": "ok", "data": {"enabled": False}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/cluster/nodes", methods=["GET"])
def get_cluster_nodes():
    if HAS_SWARM:
        return jsonify({"status": "ok", "data": swarm_discovery.discovered_nodes})
    return jsonify({"status": "ok", "data": {}})

@app.route("/doctor/prescription", methods=["GET"])
def get_prescription():
    try:
        import psutil
        import json
        
        # Check Battery
        on_battery = False
        if hasattr(psutil, "sensors_battery"):
            batt = psutil.sensors_battery()
            if batt and not batt.power_plugged:
                on_battery = True
                
        # Check active profile
        active_app = "idle"
        active_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "active_profile.json")
        if os.path.exists(active_path):
            try:
                with open(active_path, "r") as f:
                    data = json.load(f)
                    active_app = data.get("app", "idle")
            except: pass
            
        prescription = "System operating optimally."
        
        if on_battery:
            prescription = f"Diagnosis: Battery discharge detected. Prescription: Engaging Hyper-Efficiency mode. Slicing PL1 limits and maximizing undervolt to preserve power."
        elif active_app != "idle":
            prescription = f"Diagnosis: Heavy workload '{active_app}' detected. Prescription: Expanding thermal headroom, targeting moderate undervolt to sustain performance."
        else:
            prescription = "Diagnosis: System is at rest. Prescription: Focusing on acoustic comfort and zero-RPM fan modes where possible."
            
        # Check if cryoboost is active
        try:
            if os.path.exists("/tmp/thermal_cryo_boost.json"):
                with open("/tmp/thermal_cryo_boost.json", "r") as f:
                    cb = json.load(f)
                    if cb.get("active_until", 0) > time.time():
                        prescription = "Diagnosis: EMERGENCY PRE-COOL. Prescription: Bypassing AI limits. 100% duty cycle engaged to establish maximum thermal buffer."
        except: pass
        
        return jsonify({"status": "ok", "prescription": prescription, "on_battery": on_battery})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ══════════════════════════════════════════
# ██  OPTION A: AI Training Observatory
# ══════════════════════════════════════════

@app.route("/ai/metrics", methods=["GET"])
def get_ai_metrics():
    try:
        import json
        metrics_path = "/tmp/thermal_rl_metrics.json"
        if os.path.exists(metrics_path):
            with open(metrics_path, "r") as f:
                data = json.load(f)
            return jsonify({"status": "ok", "data": data})
        else:
            return jsonify({"status": "ok", "data": {"actor_loss": 0, "critic_loss": 0, "reward": 0, "entropy": 0, "steps": 0}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/ai/reset", methods=["POST"])
def reset_ai_brain():
    try:
        with open("/tmp/thermal_rl_reset.flag", "w") as f:
            f.write("reset")
        return jsonify({"status": "ok", "message": "Brain reset signal sent"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ══════════════════════════════════════════
# ██  OPTION D: Alert & Notification Engine
# ══════════════════════════════════════════

# In-memory alert history (persisted to /tmp)
ALERT_HISTORY_PATH = "/tmp/thermal_alerts.json"
ALERT_CONFIG_PATH = "/tmp/thermal_alert_config.json"

def load_alert_history():
    import json
    try:
        if os.path.exists(ALERT_HISTORY_PATH):
            with open(ALERT_HISTORY_PATH, "r") as f:
                return json.load(f)
    except: pass
    return []

def save_alert_history(alerts):
    import json
    try:
        with open(ALERT_HISTORY_PATH, "w") as f:
            json.dump(alerts[-200:], f)
    except: pass

def check_and_fire_alerts():
    """Called periodically to evaluate alert rules against current state."""
    import json, subprocess
    try:
        # Read current metrics from ghostlink/predictor state
        metrics_path = "/tmp/thermal_rl_metrics.json"
        if not os.path.exists(metrics_path):
            return
        
        # Load alert config
        config = {"temp_threshold": 85, "enabled": True}
        if os.path.exists(ALERT_CONFIG_PATH):
            with open(ALERT_CONFIG_PATH, "r") as f:
                config = json.load(f)
        
        if not config.get("enabled", True):
            return
            
        # Read current temp from the ghostlink shm
        try:
            import mmap, struct
            with open("/tmp/thermal_ghostlink.shm", "r+b") as f:
                mm = mmap.mmap(f.fileno(), 256)
                cpu_temp = struct.unpack_from('>f', mm, 16)[0]
                mm.close()
        except:
            return
        
        threshold = config.get("temp_threshold", 85)
        alerts = load_alert_history()
        
        # Don't fire duplicate alerts within 30 seconds
        if alerts and (time.time() - alerts[-1].get("timestamp", 0)) < 30:
            return
        
        if cpu_temp > threshold:
            alert = {
                "timestamp": time.time(),
                "severity": "critical" if cpu_temp > 90 else "warning",
                "message": f"CPU temperature {cpu_temp:.1f}°C exceeds threshold {threshold}°C",
                "value": cpu_temp
            }
            alerts.append(alert)
            save_alert_history(alerts)
            
            # Desktop notification via notify-send
            try:
                subprocess.Popen(["notify-send", "-u", "critical", "ThermNexus Alert", alert["message"]])
            except: pass
            
    except: pass

@app.route("/alerts/history", methods=["GET"])
def get_alert_history():
    return jsonify({"status": "ok", "data": load_alert_history()})

@app.route("/alerts/config", methods=["GET"])
def get_alert_config():
    import json
    config = {"temp_threshold": 85, "enabled": True}
    try:
        if os.path.exists(ALERT_CONFIG_PATH):
            with open(ALERT_CONFIG_PATH, "r") as f:
                config = json.load(f)
    except: pass
    return jsonify({"status": "ok", "data": config})

@app.route("/alerts/config", methods=["POST"])
def set_alert_config():
    import json
    try:
        config = request.json
        with open(ALERT_CONFIG_PATH, "w") as f:
            json.dump(config, f)
        return jsonify({"status": "ok", "message": "Alert config updated"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ══════════════════════════════════════════
# ██  OPTION B: Session Replay
# ══════════════════════════════════════════

SESSION_DIR = "/tmp/thermal_sessions"

@app.route("/replay/sessions", methods=["GET"])
def get_replay_sessions():
    import json
    sessions = []
    try:
        if os.path.exists(SESSION_DIR):
            for fname in sorted(os.listdir(SESSION_DIR)):
                if fname.endswith(".json"):
                    fpath = os.path.join(SESSION_DIR, fname)
                    stat = os.stat(fpath)
                    sessions.append({
                        "id": fname.replace(".json", ""),
                        "filename": fname,
                        "size_kb": round(stat.st_size / 1024, 1),
                        "created": stat.st_ctime
                    })
    except: pass
    return jsonify({"status": "ok", "data": sessions})

@app.route("/replay/data/<session_id>", methods=["GET"])
def get_replay_data(session_id):
    import json
    try:
        fpath = os.path.join(SESSION_DIR, f"{session_id}.json")
        if os.path.exists(fpath):
            with open(fpath, "r") as f:
                data = json.load(f)
            return jsonify({"status": "ok", "data": data})
        else:
            return jsonify({"status": "error", "message": "Session not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Background alert checker thread
import threading
def _alert_loop():
    while True:
        check_and_fire_alerts()
        time.sleep(10)

alert_thread = threading.Thread(target=_alert_loop, daemon=True)
alert_thread.start()

if __name__ == "__main__":
    if HAS_SWARM:
        swarm_discovery.start_swarm()
    if HAS_CLOUD:
        cloud_telemetry.start_cloud_relay()
    app.run(host="0.0.0.0", port=8889, debug=False)
