from flask import Flask, jsonify, request
import sqlite3
import os
import time
import config_loader

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

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8889, debug=False)
