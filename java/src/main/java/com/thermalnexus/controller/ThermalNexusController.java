package com.thermalnexus.controller;

import java.nio.file.Path;

/**
 * Main Controller running the PID/MPC Watchdog and high-speed write loop.
 */
public class ThermalNexusController {
    
    // We target the simulated hwmon created in Phase 1
    private static final String PWM_ENABLE_PATH = "/tmp/hwmon_mock/hwmon0/pwm1_enable";
    private static final String PWM_PATH = "/tmp/hwmon_mock/hwmon0/pwm1";
    private static final long WATCHDOG_TIMEOUT_MS = 2000;

    public static void main(String[] args) {
        System.out.println("Starting ThermalNexus Java Controller (GhostLink Watchdog)...");
        
        // Start WebSocket Server for Phase 4 UI
        TelemetryServer wss = new TelemetryServer(8888);
        wss.start();

        Path shmPath = Path.of("/tmp/thermal_ghostlink.shm");
        try {
            if (!shmPath.toFile().exists()) {
                shmPath.toFile().createNewFile();
                // Initialize block size (16 bytes)
                java.io.RandomAccessFile f = new java.io.RandomAccessFile(shmPath.toFile(), "rw");
                f.setLength(16);
                f.close();
            }
        } catch (Exception e) {}

        GhostLink ghostLink = new GhostLink(shmPath);
        
        System.out.println("Seizing PWM Control via FFM...");
        // Set to manual control mode
        HwmonWriter.writePwm(PWM_ENABLE_PATH, 1);
        
        boolean isFailsafeTriggered = false;

        System.out.println("Monitoring memory path " + shmPath + " for predictive Thermal Engine data!");

        int currentPwm = 0;
        long lastBroadcast = 0;

        // The high-speed loop
        while (true) {
            long lastHeartbeat = ghostLink.getLastHeartbeat();
            long now = System.currentTimeMillis();
            
            // Allow 5 initial seconds to connect before complaining
            if (lastHeartbeat != 0 && now - lastHeartbeat > WATCHDOG_TIMEOUT_MS) {
                if (!isFailsafeTriggered) {
                    System.out.println("[URGENT] GhostLink heartbeat lost (>2000ms delay)! Watchdog activated... Reverting to BIOS PWM control.");
                    // Reset pwm_enable to 2 (Bios mode) failsafe
                    HwmonWriter.writePwm(PWM_ENABLE_PATH, 2);
                    isFailsafeTriggered = true;
                }
            } else {
                if (isFailsafeTriggered && lastHeartbeat != 0) {
                    System.out.println("[INFO] GhostLink connection recovered. Resuming Manual PWM Override.");
                    HwmonWriter.writePwm(PWM_ENABLE_PATH, 1);
                    isFailsafeTriggered = false;
                }
                
                if (lastHeartbeat != 0) {
                    // Read desired PWM rate and write natively
                    int targetPwm = ghostLink.getTargetPwm();
                    targetPwm = Math.max(0, Math.min(255, targetPwm));
                    HwmonWriter.writePwm(PWM_PATH, targetPwm);
                    currentPwm = targetPwm;
                }
            }
            
            // Broadcast to Dashboard UI
            if (now - lastBroadcast > 100) {
                wss.broadcastTelemetry(currentPwm, lastHeartbeat, isFailsafeTriggered);
                lastBroadcast = now;
            }
            
            try {
                // Poll at 100Hz
                Thread.sleep(10);
            } catch (InterruptedException e) {
                break;
            }
        }
        
        try {
            wss.stop();
        } catch (Exception ignored) {}
    }
}
