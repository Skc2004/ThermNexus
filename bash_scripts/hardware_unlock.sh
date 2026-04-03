#!/bin/bash

echo "==================================================="
echo "    ThermalNexus Hardware Discovery & Unlock     "
echo "==================================================="
echo ""
echo "[WARNING] This script will probe your motherboard's i2c bus natively."
echo "[WARNING] Running 'sensors-detect' heavily requires sudo permissions."
echo ""

# Scan system for all available hwmon sensors automatically
sudo sensors-detect --auto

echo ""
echo "Attempting to force-load common Embedded Controller / SuperIO PWM modules into the Linux Kernel..."

# Common modules that map Motherboard bios PWM controls into /sys/class/hwmon
sudo modprobe it87 2>/dev/null
sudo modprobe coretemp 2>/dev/null
sudo modprobe nct6775 2>/dev/null
sudo modprobe thinkpad_acpi 2>/dev/null
sudo modprobe dell_smm_hwmon 2>/dev/null
sudo modprobe asus_wmi 2>/dev/null

echo ""
echo "Hardware Unlock Routine complete."
echo "Please re-run 'python3 hardware_discovery.py' to determine the true hardware paths of your PWM controllers!"
