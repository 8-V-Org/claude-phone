#!/bin/sh
set -eu
IP=$(cat /run/phone-secrets/media-ip)
SECRET=$(cat /run/phone-secrets/drachtio-secret)
[ -n "$IP" ] && [ -n "$SECRET" ]
exec drachtio --contact "sip:$IP:5060;transport=tcp,udp" --external-ip "$IP" --address 127.0.0.1 --port 9022 --secret "$SECRET" --loglevel info
