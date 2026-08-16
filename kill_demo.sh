#!/bin/bash
pkill -f thermalnexus-core || true
pkill -f mock_hwmon.py || true
pkill -f predictor.py || true
pkill -f vite || true
