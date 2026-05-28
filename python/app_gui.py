import webview
import sys
import os
import signal
import time
from PySide6.QtWidgets import QApplication, QSystemTrayIcon, QMenu
from PySide6.QtGui import QIcon, QAction, QColor, QPixmap, QPainter

class ThermNexusApp:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self.app.setQuitOnLastWindowClosed(False)
        self.app.setStyle("Fusion")
        
        # 1. Create Tray Icon
        self.tray = QSystemTrayIcon(self.create_icon(), self.app)
        self.tray.setToolTip("ThermNexus Core - Monitoring")
        
        # 2. Create Tray Menu
        menu = QMenu()
        show_action = QAction("Open Dashboard", menu)
        show_action.triggered.connect(self.show_window)
        
        quit_action = QAction("Exit ThermNexus", menu)
        quit_action.triggered.connect(self.quit_all)
        
        menu.addAction(show_action)
        menu.addSeparator()
        menu.addAction(quit_action)
        self.tray.setContextMenu(menu)
        self.tray.show()

        # 3. Initialize WebView
        # This frameless window loads the React UI internally via embedded browser
        self.window = webview.create_window(
            'ThermNexus Native', 
            'http://localhost:5173',
            width=1100,
            height=750,
            background_color='#050506',
            frameless=True, 
            easy_drag=True
        )

    def create_icon(self):
        pixmap = QPixmap(64, 64)
        pixmap.fill(QColor(0, 0, 0, 0))
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QColor(59, 130, 246)) 
        painter.setPen(QColor(255, 255, 255, 100))
        painter.drawEllipse(8, 8, 48, 48)
        painter.end()
        return QIcon(pixmap)

    def show_window(self):
        self.window.show()

    def quit_all(self):
        print("Shutting down ThermNexus Cluster...")
        os.kill(os.getpid(), signal.SIGINT)
        sys.exit()

    def run(self):
        webview.start(debug=True)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == "--delayed":
        time.sleep(3)
    app = ThermNexusApp()
    app.run()
