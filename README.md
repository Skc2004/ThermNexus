# ThermalNexus

**Pre-emptive thermal management for Linux — eBPF + PyTorch + Rust + React.**

Predicts heat 5 seconds into the future using kernel-level memory page-fault tracing and a neural network, then optimally adjusts fan speed via Model Predictive Control.

## Architecture

```
  Dashboard (Electron/React)  <-- WebSocket -->  Rust Daemon (100Hz)
                                                      |
                                                GhostLink mmap
                                                      |
                                                Python Brain
                                           (eBPF + PyTorch + MPC)
```

**Data Flow**: eBPF page faults + CPU/GPU temps -> PyTorch prediction -> MPC optimizer -> GhostLink shared memory -> Rust PWM writer -> sysfs hwmon

**Safety**: 2-second watchdog reverts to BIOS control if the Python brain dies.

## Quick Start

```bash
# 1. Python env
conda env create -f environment.yml && conda activate thermalnexus

# 2. Build Rust daemon
cd rust_core && cargo build --release

# 3. Dev mode (4 terminals)
python python/mock_hwmon.py         # Terminal 1: mock hardware
cd rust_core && cargo run           # Terminal 2: daemon
python python/predictor.py          # Terminal 3: ML brain
cd dashboard && npm run dev         # Terminal 4: UI at localhost:5173
```

## GhostLink IPC (32 bytes, big-endian)

| Offset | Type  | Field              |
|--------|-------|--------------------|
| 0      | 4B    | Magic GHLK         |
| 4      | i32   | Target PWM         |
| 8      | i64   | Heartbeat (ms)     |
| 16     | f32   | CPU Temp (C)       |
| 20     | f32   | GPU Temp (C)       |
| 24     | f32   | Power (W)          |
| 28     | f32   | Predicted Temp (C) |

## WebSocket API (ws://127.0.0.1:8888)

**Server broadcasts** (~10Hz): {"pwm":142,"failsafe":false,"ui_lock":false,"cpu_temp":67.3,...}

**Client commands**: {"type":"MANUAL_OVERRIDE","pwm":200} or {"type":"RELEASE_OVERRIDE"}

## Project Structure

```
ThermNexus/
├── rust_core/          # 100Hz native daemon (PWM, watchdog, WebSocket)
├── python/             # eBPF tracing, PyTorch prediction, MPC control
├── dashboard/          # Electron + React telemetry UI
├── bash_scripts/       # systemd service, startup orchestration
└── linux_system/       # udev rules, desktop entry
```

## License

MIT
