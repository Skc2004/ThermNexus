#!/bin/bash
cd "/home/skc/hdd2/Dev Vault/ThermNexus"
pkill -f thermalnexus-core 2>/dev/null || true
pkill -f mock_hwmon.py 2>/dev/null || true
pkill -f predictor.py 2>/dev/null || true
pkill -f vite 2>/dev/null || true

source venv/bin/activate
python python/mock_hwmon.py > /dev/null 2>&1 &
sleep 1
python python/predictor.py > /dev/null 2>&1 &
sleep 1
./rust_core/target/release/thermalnexus-core --pwm /tmp/hwmon_mock/hwmon0/pwm1 --enable /tmp/hwmon_mock/hwmon0/pwm1_enable --ghostlink /tmp/thermal_ghostlink.shm > /dev/null 2>&1 &
sleep 2

cd dashboard
npm run dev > /dev/null 2>&1 &
sleep 3
echo "Demo backend is running!"
