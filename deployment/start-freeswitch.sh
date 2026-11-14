#!/bin/sh
set -eu
IP=$(cat /run/phone-secrets/media-ip)
SECRET=$(cat /run/phone-secrets/freeswitch-secret)
[ -n "$IP" ] && [ -n "$SECRET" ]
exec /entrypoint.sh freeswitch --sip-port 5080 --rtp-range-start 30000 --rtp-range-end 30019 --ext-rtp-ip "$IP" --ext-sip-ip 127.0.0.1 --advertise-external-ip --password "$SECRET" --g711-only
