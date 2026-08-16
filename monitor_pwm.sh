#!/bin/bash
rm -f pwm_changes.log
LAST_VAL=""
while true; do
  VAL=$(cat /tmp/hwmon_mock/hwmon0/pwm1 2>/dev/null)
  if [ "$VAL" != "$LAST_VAL" ] && [ ! -z "$VAL" ]; then
    echo "$(date +%H:%M:%S.%N) - Hardware PWM changed to: $VAL" >> pwm_changes.log
    LAST_VAL=$VAL
  fi
  sleep 0.05
done
