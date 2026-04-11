# ThermalNexus

**Pre-emptive thermal management for Linux — eBPF + PyTorch + Rust + React.**

Predicts heat 5 seconds into the future using kernel-level memory page-fault tracing and a neural network, then optimally adjusts fan speed via Model Predictive Control.

## Architecture

```
  Dashboard (Electron/React)  <-- WebSocket -->  Rust Daemon (100Hz)
                                                      |
- **Rust Core:** 100Hz tight control loop for fan PWM based on shared memory directives. Broadcasts real-time metrics via WebSockets.
- **Python ML Brain:** Analyzes telemetry via eBPF X-Ray probes and predicts thermal ramps using PyTorch offline-trained models with online fine-tuning.
- **React/Electron Dashboard:** A beautiful, responsive thermal monitor providing micro-animations and heatmaps.

## Installation

ThermNexus is built to be installed system-wide on Linux platforms using the provided `Makefile`.

```bash
# 1. Provide an isolated Conda environment
conda create -n thermalnexus python=3.12
conda activate thermalnexus
pip install -r requirements.txt

# 2. Build and Install via Makefile
make install
```

## Configuration

The system is centrally configured via `/opt/thermalnexus/config/config.toml` (or `config.toml` in the project root during dev).

### Hardware Discovery mode
By default, ThermNexus uses `hardware_discovery.py` to hunt for supported `hwmon` and `pwm` sysfs interfaces. If your hardware is not auto-discovered, update the configuration to `mode = "manual"` and provide complete paths.

## Running

If installed via the Makefile:
```bash
sudo systemctl enable --now thermalnexus.service
journalctl -u thermalnexus -f   # To tail logs
```

For development without installing:
```bash
make dev
```

## GhostLink IPC (96 bytes, big-endian)
Our zero-copy inter-process communication buffer layout:

| Offset | Type  | Field              |
|--------|-------|--------------------|
| 0      | 4B    | Magic GHLK         |
| 4      | i32   | Target PWM         |
| 8      | i64   | Heartbeat (ms)     |
| 16     | f32   | CPU Temp (C)       |
| 20     | f32   | GPU Temp (C)       |
| 24     | f32   | Power (W)          |
| 28     | f32   | Predicted Temp (C) |
| 32-63  | 8×f32 | Per-Core Temps (C) |
| 64-95  | —     | Reserved           |

ThermNexus/
├── rust_core/          # 100Hz native daemon (PWM, watchdog, WebSocket)
├── python/             # eBPF tracing, PyTorch prediction, MPC control
├── dashboard/          # Electron + React telemetry UI
├── bash_scripts/       # systemd service, startup orchestration
└── linux_system/       # udev rules, desktop entry
```

## License

MIT
