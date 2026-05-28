#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_BIN="${PYTHON_BIN:-/home/skc/anaconda3/envs/thermalnexus/bin/python}"

# 1. Hardware Path Discovery
CONFIG_FILE="$PROJECT_DIR/config.toml"
GHOSTLINK_PATH=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['paths']['ghostlink'])" 2>/dev/null || echo "/tmp/thermal_ghostlink.shm")
MODE=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['hardware']['mode'])" 2>/dev/null || echo "mock")

if [ "$MODE" = "auto" ] && [ "$THERMNEXUS_MOCK" != "1" ]; then
    echo "Discovery: Reading hardware config..."
    # Extract first available PWM using Python for portability
    DISCOVERED_PWM=$($PYTHON_BIN -c "
import json, sys, tomllib, os
try:
    c = tomllib.load(open('$CONFIG_FILE','rb'))
    json_path = os.path.join('$PROJECT_DIR', c['hardware']['config_json'])
    with open(json_path) as f:
        data = json.load(f)
    for hwmon in data.values():
        for pwm_id, pwm_info in hwmon.get('pwms', {}).items():
            print(f\"{pwm_info['pwm_file']}|{pwm_info['enable_file']}\")
            sys.exit(0)
except Exception:
    pass
")
    if [ ! -z "$DISCOVERED_PWM" ]; then
        PWM_PATH=$(echo $DISCOVERED_PWM | cut -d'|' -f1)
        ENABLE_PATH=$(echo $DISCOVERED_PWM | cut -d'|' -f2)
        echo "Discovery: Found hardware control at $PWM_PATH"
    else
        echo "Discovery: No hardware PWM found in config. Defaulting to Mock mode."
        PWM_PATH=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['hardware']['pwm_path'])")
        ENABLE_PATH=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['hardware']['enable_path'])")
    fi
else
    PWM_PATH=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['hardware']['pwm_path'])" 2>/dev/null)
    ENABLE_PATH=$($PYTHON_BIN -c "import tomllib; c=tomllib.load(open('$CONFIG_FILE','rb')); print(c['hardware']['enable_path'])" 2>/dev/null)
fi

# Override with environment variables if provided
PWM_PATH="${THERMNEXUS_PWM:-$PWM_PATH}"
ENABLE_PATH="${THERMNEXUS_ENABLE:-$ENABLE_PATH}"
GHOSTLINK_PATH="${THERMNEXUS_GHOSTLINK:-$GHOSTLINK_PATH}"

# 2. Service Orchestration
echo "Booting ThermalNexus Cluster..."

PIDS=()
PID_DIR="/tmp/thermalnexus"
mkdir -p "$PID_DIR"

cleanup() {
    echo "[SHUTDOWN] Cleaning up child processes..."
    for pid_file in "$PID_DIR"/*.pid; do
        [ -f "$pid_file" ] && kill "$(cat "$pid_file")" 2>/dev/null
    done
    rm -rf "$PID_DIR"
    # Safety: revert fan to BIOS mode
    if [ -f "$ENABLE_PATH" ]; then
        echo "2" > "$ENABLE_PATH" 2>/dev/null
    fi
    echo "[SHUTDOWN] Fan control returned to BIOS."
}
trap cleanup EXIT SIGTERM SIGINT

# Boot the Python DAQ Profiler in background
"$PYTHON_BIN" "$PROJECT_DIR/python/profiler.py" > /tmp/thermal_profiler.log 2>&1 &
echo $! > "$PID_DIR/profiler.pid"

# Boot the PyTorch Predictor AI in background
"$PYTHON_BIN" "$PROJECT_DIR/python/predictor.py" > /tmp/thermal_predictor.log 2>&1 &
echo $! > "$PID_DIR/predictor.pid"

# Boot the Local JSON REST API in background
"$PYTHON_BIN" "$PROJECT_DIR/python/api_server.py" > /tmp/thermal_api_server.log 2>&1 &
echo $! > "$PID_DIR/api_server.pid"

echo "Background AI logic booted successfully. Predictor PID: $(cat "$PID_DIR/predictor.pid")"
echo "Targeting Hardware: $PWM_PATH (Enable: $ENABLE_PATH)"

# Boot the Rust Core Daemon in background
"$PROJECT_DIR/rust_core/target/release/thermalnexus-core" \
    --pwm "$PWM_PATH" \
    --enable "$ENABLE_PATH" \
    --ghostlink "$GHOSTLINK_PATH" > /tmp/thermal_rustcore.log 2>&1 &
echo $! > "$PID_DIR/rustcore.pid"

echo "Rust daemon online. Booting Electron Application..."

# Ensure Node environment is configured for Vite/Electron
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

# Execute the Native Electron Dashboard in foreground
# This becomes the main blocking process
cd "$PROJECT_DIR/dashboard"
exec npm run start
