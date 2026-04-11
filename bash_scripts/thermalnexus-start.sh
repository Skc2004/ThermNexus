#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_BIN="${PYTHON_BIN:-/home/skc/anaconda3/envs/thermalnexus/bin/python}"

# 1. Hardware Path Discovery
# Default to mock paths
PWM_PATH="/tmp/hwmon_mock/hwmon0/pwm1"
ENABLE_PATH="/tmp/hwmon_mock/hwmon0/pwm1_enable"
GHOSTLINK_PATH="/tmp/thermal_ghostlink.shm"

CONFIG_FILE="$PROJECT_DIR/python/thermal_config.json"
if [ -f "$CONFIG_FILE" ] && [ "$THERMNEXUS_MOCK" != "1" ]; then
    echo "Discovery: Reading $CONFIG_FILE..."
    # Extract first available PWM using Python for portability
    DISCOVERED_PWM=$($PYTHON_BIN -c "
import json, sys
try:
    with open('$CONFIG_FILE') as f:
        data = json.load(f)
    for hwmon in data.values():
        for pwm_id, pwm_info in hwmon.get('pwms', {}).items():
            print(f\"{pwm_info['pwm_file']}|{pwm_info['enable_file']}\")
            sys.exit(0)
except:
    pass
")
    if [ ! -z "$DISCOVERED_PWM" ]; then
        PWM_PATH=$(echo $DISCOVERED_PWM | cut -d'|' -f1)
        ENABLE_PATH=$(echo $DISCOVERED_PWM | cut -d'|' -f2)
        echo "Discovery: Found hardware control at $PWM_PATH"
    else
        echo "Discovery: No hardware PWM found in config. Defaulting to Mock mode."
    fi
fi

# Override with environment variables if provided
PWM_PATH="${THERMNEXUS_PWM:-$PWM_PATH}"
ENABLE_PATH="${THERMNEXUS_ENABLE:-$ENABLE_PATH}"
GHOSTLINK_PATH="${THERMNEXUS_GHOSTLINK:-$GHOSTLINK_PATH}"

# 2. Service Orchestration
echo "Booting ThermalNexus Cluster..."

# Boot the Python DAQ Profiler in background
nohup "$PYTHON_BIN" "$PROJECT_DIR/python/profiler.py" > /tmp/thermal_profiler.log 2>&1 &

# Boot the PyTorch Predictor AI in background
nohup "$PYTHON_BIN" "$PROJECT_DIR/python/predictor.py" > /tmp/thermal_predictor.log 2>&1 &

echo "Background AI logic booted successfully. PID: $!"
echo "Targeting Hardware: $PWM_PATH (Enable: $ENABLE_PATH)"

# Execute the Rust Core Daemon in foreground
# Pass the discovered/configured paths as arguments
exec "$PROJECT_DIR/rust_core/target/release/thermalnexus-core" \
    --pwm "$PWM_PATH" \
    --enable "$ENABLE_PATH" \
    --ghostlink "$GHOSTLINK_PATH"
