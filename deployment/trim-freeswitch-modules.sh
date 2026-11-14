#!/bin/sh
set -eu
MODDIR=${FS_MODULE_DIR:-/usr/local/freeswitch/mod}
CONF=${FS_MODULES_CONFIG:-/usr/local/freeswitch/conf/autoload_configs/modules.conf.xml}
# Mandatory for this MRF/Live application. PCMU/PCMA/L16 are built-in core codecs.
for module in mod_commands mod_dptools mod_sofia mod_event_socket mod_audio_fork mod_dialplan_xml; do
  test -f "$MODDIR/$module.so" || { echo "Required FreeSWITCH module missing: $module" >&2; exit 1; }
done
{
  printf '%s\n' '<configuration name="modules.conf" description="Phone-only module allowlist">' '  <modules>'
  for module in mod_console mod_commands mod_dptools mod_sofia mod_event_socket mod_audio_fork mod_dialplan_xml mod_sndfile mod_native_file mod_tone_stream mod_http_cache mod_shout; do
    if test -f "$MODDIR/$module.so"; then printf '    <load module="%s"/>\n' "$module"; fi
  done
  printf '%s\n' '  </modules>' '</configuration>'
} > "$CONF"
# Cloud STT/TTS, conferencing, video and unused codecs are not autoloaded.
