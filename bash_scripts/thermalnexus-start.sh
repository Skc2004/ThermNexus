#!/bin/bash
# Boot the Python DAQ Profiler in background
nohup /home/skc/anaconda3/envs/thermalnexus/bin/python "/media/skc/New Volume/Dev Vault/ThermNexus/python/profiler.py" > /tmp/thermal_profiler.log 2>&1 &

# Boot the PyTorch Predictor AI in background
nohup /home/skc/anaconda3/envs/thermalnexus/bin/python "/media/skc/New Volume/Dev Vault/ThermNexus/python/predictor.py" > /tmp/thermal_predictor.log 2>&1 &

echo "Background AI logic booted successfully. Yielding execution mapping to Rust Native Daemon..."

# Execute the Rust Core Daemon in foreground so Systemd can track the PID properly
exec "/media/skc/New Volume/Dev Vault/ThermNexus/rust_core/target/release/thermalnexus-core"
