import sys
import json
import asyncio
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                               QLabel, QProgressBar, QSystemTrayIcon, QMenu, QSlider, QPushButton, QGridLayout, QFrame)
from PySide6.QtCore import Qt, QTimer, QThread, Signal
from PySide6.QtGui import QIcon, QAction, QColor, QPixmap, QPainter, QFont, QPalette
import websockets

class WebSocketThread(QThread):
    data_received = Signal(dict)
    
    def __init__(self):
        super().__init__()
        self.running = True
        self.ws = None
        self.loop = None
        
    async def connect_to_server(self):
        while self.running:
            try:
                async with websockets.connect("ws://127.0.0.1:8888") as ws:
                    self.ws = ws
                    while self.running:
                        msg = await ws.recv()
                        self.data_received.emit(json.loads(msg))
            except Exception:
                await asyncio.sleep(2)

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self.connect_to_server())
        
    def send_data(self, data):
        if self.ws and self.loop:
            asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(data)), self.loop)

    def stop(self):
        self.running = False
        if self.loop:
            self.loop.stop()
        self.wait()

class EmbeddedUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ThermNexus Embedded Core")
        self.setFixedSize(900, 600)
        self.setStyleSheet("background-color: #0d1117; color: #c9d1d9;")
        
        # UI State Tracking
        self.is_overridden = False

        # Setup Layout
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        
        # Header
        header = QLabel("ThermNexus Active Telemetry")
        header.setFont(QFont("Arial", 24, QFont.Bold))
        header.setStyleSheet("color: #ffffff; padding: 10px;")
        layout.addWidget(header)
        
        # Main Dashboard Container
        dash_layout = QHBoxLayout()
        layout.addLayout(dash_layout)
        
        # Left Panel (Thermal Grid)
        left_panel = QFrame()
        left_panel.setStyleSheet("background-color: #161b22; border-radius: 10px; border: 1px solid #30363d;")
        left_layout = QVBoxLayout(left_panel)
        left_layout.addWidget(QLabel("<b>8-Core Thermal Grid</b>"))
        
        self.grid_layout = QGridLayout()
        self.core_labels = []
        for i in range(8):
            lbl = QLabel(f"Core {i}\n0.0°C")
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setFixedSize(100, 100)
            lbl.setStyleSheet("background-color: #050506; font-size: 16px; font-weight: bold; border-radius: 10px;")
            self.core_labels.append(lbl)
            self.grid_layout.addWidget(lbl, i // 4, i % 4)
            
        left_layout.addLayout(self.grid_layout)
        dash_layout.addWidget(left_panel)
        
        # Right Panel (Control & State)
        right_panel = QFrame()
        right_panel.setStyleSheet("background-color: #161b22; border-radius: 10px; border: 1px solid #30363d;")
        right_layout = QVBoxLayout(right_panel)
        
        self.status_label = QLabel("Status: Connecting...")
        self.status_label.setStyleSheet("color: #ff7b72;")
        right_layout.addWidget(self.status_label)
        
        self.p_label = QLabel("Predicted Global T: 0.0°C")
        self.w_label = QLabel("Power Consumption: 0.0W")
        right_layout.addWidget(self.p_label)
        right_layout.addWidget(self.w_label)
        
        right_layout.addSpacing(20)
        
        # Fan Data
        self.pwm_label = QLabel("Fan Duty Cycle: 0%")
        self.pwm_label.setFont(QFont("Arial", 20, QFont.Bold))
        right_layout.addWidget(self.pwm_label)
        
        self.pwm_bar = QProgressBar()
        self.pwm_bar.setMaximum(255)
        self.pwm_bar.setStyleSheet("""
            QProgressBar {border: 1px solid #30363d; border-radius: 5px; text-align: center; background-color: #0d1117;}
            QProgressBar::chunk {background-color: #3fb950; width: 10px; margin: 0.5px;}
        """)
        right_layout.addWidget(self.pwm_bar)
        
        # Manual Control
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 255)
        self.slider.sliderReleased.connect(self.manual_override)
        right_layout.addWidget(QLabel("Override Control:"))
        right_layout.addWidget(self.slider)
        
        self.btn_release = QPushButton("Release Hardware to AI")
        self.btn_release.setStyleSheet("background-color: #da3633; color: white; padding: 10px; border-radius: 5px;")
        self.btn_release.clicked.connect(self.release_override)
        right_layout.addWidget(self.btn_release)
        
        dash_layout.addWidget(right_panel)
        
        # Thread Start
        self.ws_thread = WebSocketThread()
        self.ws_thread.data_received.connect(self.update_ui)
        self.ws_thread.start()

    def get_color_for_temp(self, temp):
        if temp < 40: return "#238636" # Green
        if temp < 60: return "#1f6feb" # Blue
        if temp < 80: return "#d29922" # Orange
        return "#da3633" # Red

    def update_ui(self, data):
        self.status_label.setText("Status: Online")
        self.status_label.setStyleSheet("color: #3fb950; font-weight: bold;")
        
        if "predicted" in data:
            self.p_label.setText(f"Predicted Global T: {data['predicted']:.1f}°C")
        if "watts" in data:
            self.w_label.setText(f"Power Consumption: {data['watts']:.1f}W")
        if "pwm" in data:
            val = data["pwm"]
            pct = int((val / 255.0) * 100)
            self.pwm_label.setText(f"Fan Duty Cycle: {pct}%")
            self.pwm_bar.setValue(val)
            if not self.is_overridden:
                self.slider.blockSignals(True)
                self.slider.setValue(val)
                self.slider.blockSignals(False)
            
        if "ui_lock" in data:
            self.is_overridden = data["ui_lock"]
            if self.is_overridden:
                self.pwm_bar.setStyleSheet("""QProgressBar::chunk {background-color: #d29922;}""")
            else:
                self.pwm_bar.setStyleSheet("""QProgressBar::chunk {background-color: #3fb950;}""")
            
        if "core_temps" in data and len(data["core_temps"]) == 8:
            for i, temp in enumerate(data["core_temps"]):
                color = self.get_color_for_temp(temp)
                self.core_labels[i].setText(f"Core {i}\n{temp:.1f}°C")
                self.core_labels[i].setStyleSheet(f"background-color: {color}; color: white; font-size: 16px; font-weight: bold; border-radius: 10px;")

    def manual_override(self):
        val = self.slider.value()
        self.ws_thread.send_data({"type": "MANUAL_OVERRIDE", "pwm": val})
        
    def release_override(self):
        self.ws_thread.send_data({"type": "RELEASE_OVERRIDE"})

    def closeEvent(self, event):
        self.ws_thread.stop()
        event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # Apply minimal fusion style
    app.setStyle("Fusion")
    
    window = EmbeddedUI()
    window.show()
    sys.exit(app.exec())
