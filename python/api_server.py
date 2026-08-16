from flask import Flask, jsonify, request
import sqlite3
import os
import time
import config_loader
from diagnostic_runner import runner

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

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8889, debug=False)
