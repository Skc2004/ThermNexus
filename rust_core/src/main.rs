mod ghostlink;

use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use ghostlink::GhostLink;
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::time;
use tracing::{info, error, warn};
use tracing_subscriber::EnvFilter;

use std::fs::OpenOptions;
use std::io::Write;

const WATCHDOG_TIMEOUT_MS: i64 = 2000;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "/tmp/thermal_ghostlink.shm")]
    ghostlink: String,

    #[arg(short, long, default_value = "/tmp/hwmon_mock/hwmon0/pwm1")]
    pwm: String,

    #[arg(short, long, default_value = "/tmp/hwmon_mock/hwmon0/pwm1_enable")]
    enable: String,
}

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
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("thermalnexus=info".parse().unwrap()))
        .init();

    let args = Args::parse();
    info!("ThermalNexus Rust Native Daemon Booting (PID: {})", std::process::id());
    info!("Config: GhostLink: {} | PWM: {} | Enable: {}", args.ghostlink, args.pwm, args.enable);

    // 1. Thread Communication Channel
    let (tx, _rx) = broadcast::channel(32);
    let state = Arc::new(Mutex::new(AppState {
        manual_override_lock: false,
        manual_pwm: 128,
    }));

    // 2. Spawn the Core Control Loop Task
    let tx_clone = tx.clone();
    let state_clone = Arc::clone(&state);
    
    let pwm_path = args.pwm.clone();
    let enable_path = args.enable.clone();
    let ghostlink_path = args.ghostlink.clone();

    let enable_for_shutdown = Arc::new(args.enable.clone());
    let shutdown_path = Arc::clone(&enable_for_shutdown);

    tokio::spawn(async move {
        let mut sigterm = tokio::signal::unix::signal(
            tokio::signal::unix::SignalKind::terminate()
        ).unwrap();
        
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = sigterm.recv() => {},
        }
        
        info!("[SHUTDOWN] Reverting fan control to BIOS (pwm_enable=2)...");
        write_pwm(&shutdown_path, 2);
        std::process::exit(0);
    });

    tokio::spawn(async move {
        // Build Mapped Memory integration bridge
        let ghost_link = GhostLink::new(&ghostlink_path).expect("Mmap initialization failed!");
        let mut is_failsafe_triggered = false;

        // Seize HW control to custom mode natively 
        write_pwm(&enable_path, 1);
        info!("GhostLink Memory Pool established natively. Syscall loop firing at 100Hz.");
        
        let mut interval = time::interval(Duration::from_millis(10)); // 100Hz Main Loop
        let mut ticks: u64 = 0;

        loop {
            interval.tick().await;
            ticks = ticks.wrapping_add(1);

            let now = SystemTime::now().duration_since(UNIX_EPOCH).expect("Time went backwards").as_millis() as i64;
            let last_heartbeat = ghost_link.get_last_heartbeat();

            // Extract AppState to see if React Dashboard claimed absolute Override Lock
            let mut current_applied_pwm = 0;
            let (is_ui_locked, ui_pwm) = if let Ok(s) = state_clone.lock() {
                (s.manual_override_lock, s.manual_pwm)
            } else {
                (false, 0)
            };

            if is_ui_locked {
                // UI 2-WAY OVERRIDE MODE: Ignore Python/Ghostlink completely
                write_pwm(&enable_path, 1);
                write_pwm(&pwm_path, std::cmp::min(255, std::cmp::max(0, ui_pwm)));
                current_applied_pwm = ui_pwm;
                is_failsafe_triggered = false;
            } else {
                // MPC PYTHON BRAIN MODE
                if last_heartbeat != 0 && (now - last_heartbeat > WATCHDOG_TIMEOUT_MS) {
                    // Watchdog Triggered -> Revert to BIOS completely
                    if !is_failsafe_triggered {
                        error!("Watchdog: IPC heartbeat lost! Halting PyTorch ML processing and reverting to BIOS.");
                        write_pwm(&enable_path, 2);
                        is_failsafe_triggered = true;
                    }
                } else if last_heartbeat != 0 {
                    // Brain Recovered
                    if is_failsafe_triggered {
                        info!("Python daemon recovered! Retaking BIOS Control.");
                        write_pwm(&enable_path, 1);
                        is_failsafe_triggered = false;
                    }

                    // Native Native writing
                    let target_pwm = ghost_link.get_target_pwm();
                    let clamped = std::cmp::min(255, std::cmp::max(0, target_pwm));
                    write_pwm(&pwm_path, clamped);
                    current_applied_pwm = clamped;
                }
            }

            // Broadcast out over Websockets back to React UI
            let bcast_payload = serde_json::json!({
                "pwm": current_applied_pwm,
                "heartbeat": last_heartbeat,
                "failsafe": is_failsafe_triggered,
                "ui_lock": is_ui_locked,
                "cpu_temp": ghost_link.get_cpu_temp(),
                "gpu_temp": ghost_link.get_gpu_temp(),
                "watts": ghost_link.get_watts(),
                "predicted": ghost_link.get_predicted_temp(),
                "core_temps": ghost_link.get_core_temps()
            });
            
            // Throttle broadcast to 10Hz to save UI rendering overload
            if ticks % 10 == 0 {
                tx_clone.send(bcast_payload.to_string()).ok();
            }
        }
    });

    // 3. WebSocket Setup
    let listener = TcpListener::bind("127.0.0.1:8888").await?;
    info!("Asynchronous Two-Way API/React WebSocket live on 127.0.0.1:8888...");

    while let Ok((stream, addr)) = listener.accept().await {
        let tx_bcast = tx.clone();
        let state_bcast = Arc::clone(&state);
        
        tokio::spawn(async move {
            let ws_stream = tokio_tungstenite::accept_async(stream).await;
            if let Ok(ws) = ws_stream {
                info!("React Component Connected: {:?}", addr);
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
                                                    if let Ok(mut s) = state_bcast.lock() {
                                                        s.manual_override_lock = true;
                                                        s.manual_pwm = pwm as i32;
                                                        info!("Received React Override Command -> Locked PWM to: {}", pwm);
                                                    }
                                                }
                                            } else if parsed["type"].as_str() == Some("RELEASE_OVERRIDE") {
                                                if let Ok(mut s) = state_bcast.lock() {
                                                    s.manual_override_lock = false;
                                                    info!("Received React Release! Passing control back to PyTorch IPC Engine.");
                                                }
                                            }
                                        }
                                    }
                                }
                                _ => break, // Disconnect
                            }
                        }
                    }
                }
                info!("React Controller Disconnected: {:?}", addr);
            }
        });
    }

    Ok(())
}
