mod ghostlink;

use futures_util::{SinkExt, StreamExt};
use ghostlink::GhostLink;
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::time;

use std::fs::OpenOptions;
use std::io::Write;

const PWM_ENABLE_PATH: &str = "/tmp/hwmon_mock/hwmon0/pwm1_enable";
const PWM_PATH: &str = "/tmp/hwmon_mock/hwmon0/pwm1";
const WATCHDOG_TIMEOUT_MS: i64 = 2000;

fn write_pwm(path: &str, value: i32) {
    if let Ok(mut file) = OpenOptions::new().write(true).open(path) {
        let content = format!("{}\n", value);
        let _ = file.write_all(content.as_bytes());
    }
}

// Websocket shared state tracking 2-way UI input
struct AppState {
    manual_override_lock: bool,
    manual_pwm: i32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("ThermalNexus Rust Native Daemon Booting (PID: {})", std::process::id());

    // 1. Thread Communication Channel
    let (tx, _rx) = broadcast::channel(32);
    let state = Arc::new(Mutex::new(AppState {
        manual_override_lock: false,
        manual_pwm: 128,
    }));

    // 2. Spawn the Core Control Loop Task
    let tx_clone = tx.clone();
    let state_clone = Arc::clone(&state);
    
    tokio::spawn(async move {
        // Build Mapped Memory integration bridge
        let ghost_link = GhostLink::new("/tmp/thermal_ghostlink.shm").expect("Mmap initialization failed!");
        let mut is_failsafe_triggered = false;

        // Seize HW control to custom mode natively 
        write_pwm(PWM_ENABLE_PATH, 1);
        println!("GhostLink Memory Pool established natively. Syscall loop firing at 100Hz.");
        
        let mut interval = time::interval(Duration::from_millis(10)); // 100Hz Main Loop

        loop {
            interval.tick().await;

            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
            let last_heartbeat = ghost_link.get_last_heartbeat();

            // Extract AppState to see if React Dashboard claimed absolute Override Lock
            let mut current_applied_pwm = 0;
            let is_ui_locked;
            let ui_pwm;
            {
                let s = state_clone.lock().unwrap();
                is_ui_locked = s.manual_override_lock;
                ui_pwm = s.manual_pwm;
            }

            if is_ui_locked {
                // UI 2-WAY OVERRIDE MODE: Ignore Python/Ghostlink completely
                write_pwm(PWM_ENABLE_PATH, 1);
                write_pwm(PWM_PATH, std::cmp::min(255, std::cmp::max(0, ui_pwm)));
                current_applied_pwm = ui_pwm;
                is_failsafe_triggered = false;
            } else {
                // MPC PYTHON BRAIN MODE
                if last_heartbeat != 0 && (now - last_heartbeat > WATCHDOG_TIMEOUT_MS) {
                    // Watchdog Triggered -> Revert to BIOS completely
                    if !is_failsafe_triggered {
                        println!("[URGENT] Watchdog: IPC Heartbeat lost! Halting PyTorch ML processing and reverting to BIOS.");
                        write_pwm(PWM_ENABLE_PATH, 2);
                        is_failsafe_triggered = true;
                    }
                } else if last_heartbeat != 0 {
                    // Brain Recovered
                    if is_failsafe_triggered {
                        println!("[INFO] Python Daemon recovered! Retaking BIOS Control.");
                        write_pwm(PWM_ENABLE_PATH, 1);
                        is_failsafe_triggered = false;
                    }

                    // Native Native writing
                    let target_pwm = ghost_link.get_target_pwm();
                    let clamped = std::cmp::min(255, std::cmp::max(0, target_pwm));
                    write_pwm(PWM_PATH, clamped);
                    current_applied_pwm = clamped;
                }
            }

            // Broadcast out over Websockets back to React UI
            if now % 100 < 10 {
                let payload = json!({
                    "pwm": current_applied_pwm,
                    "heartbeat": last_heartbeat,
                    "failsafe": is_failsafe_triggered,
                    "ui_lock": is_ui_locked,
                    "cpu_temp": ghost_link.get_cpu_temp(),
                    "gpu_temp": ghost_link.get_gpu_temp(),
                    "watts": ghost_link.get_watts(),
                    "predicted": ghost_link.get_predicted_temp()
                });
                let _ = tx_clone.send(payload.to_string());
            }
        }
    });

    // 3. WebSocket Setup
    let listener = TcpListener::bind("127.0.0.1:8888").await?;
    println!("Asynchronous Two-Way API/React WebSocket live on 127.0.0.1:8888...");

    while let Ok((stream, addr)) = listener.accept().await {
        let tx_bcast = tx.clone();
        let state_bcast = Arc::clone(&state);
        
        tokio::spawn(async move {
            let ws_stream = tokio_tungstenite::accept_async(stream).await;
            if let Ok(ws) = ws_stream {
                println!("React Component Connected: {:?}", addr);
                let (mut ws_tx, mut ws_rx) = ws.split();
                let mut rx = tx_bcast.subscribe();

                loop {
                    tokio::select! {
                        msg = rx.recv() => {
                            if let Ok(text) = msg {
                                if ws_tx.send(tokio_tungstenite::tungstenite::Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        client_msg = ws_rx.next() => {
                            match client_msg {
                                Some(Ok(msg)) => {
                                    if msg.is_text() || msg.is_binary() {
                                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(msg.to_text().unwrap_or("{}")) {
                                            if parsed["type"].as_str() == Some("MANUAL_OVERRIDE") {
                                                if let Some(pwm) = parsed["pwm"].as_i64() {
                                                    let mut s = state_bcast.lock().unwrap();
                                                    s.manual_override_lock = true;
                                                    s.manual_pwm = pwm as i32;
                                                    println!("Received React Override Command -> Locked PWM to: {}", pwm);
                                                }
                                            } else if parsed["type"].as_str() == Some("RELEASE_OVERRIDE") {
                                                let mut s = state_bcast.lock().unwrap();
                                                s.manual_override_lock = false;
                                                println!("Received React Release! Passing control back to PyTorch IPC Engine.");
                                            }
                                        }
                                    }
                                }
                                _ => break, // Disconnect
                            }
                        }
                    }
                }
                println!("React Controller Disconnected: {:?}", addr);
            }
        });
    }

    Ok(())
}
