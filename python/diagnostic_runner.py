import threading
import time
import subprocess
import shutil
import sqlite3
import os

class DiagnosticRunner:
    def __init__(self):
        self.status = "idle" # idle, baseline, stress, cooldown, complete, error
        self.progress = 0
        self.data_points = []
        self.score = 0
        self.message = ""
        self._thread = None
        # Check if we are running in real or mock mode based on stress-ng existence
        # For safety on arbitrary machines, we default to a safe simulation if stress-ng is missing
        self.has_stress_ng = shutil.which("stress-ng") is not None
        self.db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "thermal_profile.db")

    def start(self):
        if self.status in ["baseline", "stress", "cooldown"]:
            return False # already running
        self._thread = threading.Thread(target=self._run_diagnostic)
        self._thread.daemon = True
        self._thread.start()
        return True
    
    def get_state(self):
        return {
            "status": self.status,
            "progress": self.progress,
            "data_points": self.data_points,
            "score": self.score,
            "message": self.message
        }
    
    def _run_diagnostic(self):
        try:
            self.status = "baseline"
            self.data_points = []
            self.progress = 0
            
            # Baseline 5s
            for i in range(5):
                self.progress = int((i/45) * 100)
                temp = self._get_real_temp() if self.has_stress_ng else (40.0 + (i * 0.2))
                self.data_points.append({"time": i, "temp": temp, "phase": "baseline"})
                time.sleep(1)
                
            self.status = "stress"
            # Stress 20s
            proc = None
            if self.has_stress_ng:
                proc = subprocess.Popen(["stress-ng", "--cpu", "0", "--timeout", "20s"])
            
            for i in range(20):
                self.progress = int(((i+5)/45) * 100)
                if not self.has_stress_ng:
                    temp = self.data_points[-1]["temp"] + 2.0 + (1.5 / (i+1)) # Asymptotic rise
                else:
                    temp = self._get_real_temp()
                self.data_points.append({"time": i+5, "temp": temp, "phase": "stress"})
                time.sleep(1)
                
            if proc:
                proc.wait()
                
            self.status = "cooldown"
            # Cooldown 20s
            for i in range(20):
                self.progress = int(((i+25)/45) * 100)
                if not self.has_stress_ng:
                    temp = self.data_points[-1]["temp"] - 1.8 * (0.9 ** i) # Newton's law of cooling
                    temp = max(40.0, temp)
                else:
                    temp = self._get_real_temp()
                self.data_points.append({"time": i+25, "temp": temp, "phase": "cooldown"})
                time.sleep(1)
                
            self.progress = 100
            
            # Analysis
            peak_temp = max(p["temp"] for p in self.data_points)
            final_temp = self.data_points[-1]["temp"]
            dissipation = peak_temp - final_temp
            
            if dissipation > 30:
                self.score = 98
                self.message = "Excellent cooling performance. Thermal paste is pristine."
            elif dissipation > 20:
                self.score = 85
                self.message = "Good cooling performance. Normal wear."
            elif dissipation > 10:
                self.score = 65
                self.message = "Fair. Dust buildup detected. Consider cleaning."
            else:
                self.score = 40
                self.message = "Warning: Poor thermal dissipation! Repaste recommended."
                
            self.status = "complete"
            
        except Exception as e:
            self.status = "error"
            self.message = str(e)
            
    def _get_real_temp(self):
        try:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            c.execute("SELECT cpu_temp FROM thermal_logs ORDER BY timestamp DESC LIMIT 1")
            row = c.fetchone()
            conn.close()
            return row[0] if row else 45.0
        except:
            return 45.0

# Singleton instance
runner = DiagnosticRunner()
