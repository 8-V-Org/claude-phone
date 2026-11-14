# OpenClaw Phone — Gemini Live R2

Complete replacement handoff for the EXISTING same-host Linux Docker Compose deployment. This replaces the earlier batch-first handoff; do not mix R1 images/source with these R2 files.

## Architecture and exact scope

    Phone <-> 3CX <-> Drachtio/FreeSWITCH <-> voice-app <-> Gemini Live (WSS)
                                                |
                         optional nonblocking query_openclaw function
                                                |
                          private authenticated bridge -> OpenClaw phone agent

- Drachtio handles SIP signaling. FreeSWITCH handles RTP/codec conversion and bidirectional PCM playback/capture. They are sibling containers, not Docker-in-Docker.
- PRIMARY: Gemini Live API with a stateful bidirectional WSS session, continuous raw mono signed 16-bit 16kHz little-endian input and raw 24kHz little-endian output. Native activity detection and interruption handling are enabled.
- Gemini handles ordinary voice conversation directly. Only an explicit request to consult OpenClaw uses query_openclaw. The declared function is NON_BLOCKING and results are scheduled WHEN_IDLE; this is not a separate STT -> agent -> TTS round trip for every utterance.
- Gemini API CLI is a separate CLIENT interface for ordinary Gemini API tasks such as transcription/TTS, not the Live transport. It is retained only for explicitly selected BATCH mode. OpenAI speech is an explicit batch alternative. There is NO automatic paid reconnect, provider failover or silent batch downgrade.
- Default Live model: gemini-3.8-live; voice: Kore. Verify access and billing/quota on YOUR Google API project. A paid key does not by itself guarantee availability or unlimited Live quota. The Live API/model is preview and may change.
- Official @google/genai SDK is pinned to 3.0.0. The optional gemini-api CLI stays pinned to v0.4.5 with its release archive SHA256 verified. Node/Drachtio/FreeSWITCH base images are pinned by digest; the Gateway/Caddy use existing local images without an unsolicited update.
- No Claude Code or ElevenLabs is required. The optional OpenClaw consultation retains its existing OpenAI-backed runtime; native Codex is not newly enabled.

## Barge-in implementation — and what is NOT yet proven

The app keeps forwarding caller audio while the model speaks. On serverContent.interrupted it:
1. Immediately discards queued old model audio and pauses output pacing.
2. Requires an acknowledgement from FreeSWITCH stop_play.
3. Stops and recreates the media fork with a new unpredictable stream key, flushing the module's prebuffer AND playout buffer rather than assuming stop_play clears both.
4. Resumes only fresh audio on the new media connection. Cancelled OpenClaw function results are suppressed.

Media-fork recreation can introduce a brief caller-capture gap. Actual cutoff latency, echo behavior and native module buffer behavior require a real call test. The application protocol/control logic is tested; telephone barge-in has NOT been demonstrated on your host.
The app fails closed if the installed uuid_audio_fork help does not advertise streaming, bidirectional audio and stop_play. The pinned image still needs host verification: the SDK interface and a public module reference were inspected, but this environment cannot run the media image. Do NOT silently bypass this gate if the image lacks the interface.

## Security and permissions

- The existing phone agent has a separate workspace /opt/data/config/phone-workspace and tools.deny=["*"]. It cannot administer the host or read private main-agent memory. Neither a SIP source allowlist nor a spoken identity claim authenticates owner authority. Adding administrative actions requires a separately designed authentication/approval gate.
- SIP source IP, caller number/extension and dialed extension must all match explicit configuration. One call at a time; five-minute call cap. Outbound dialing and generic query HTTP APIs remain disabled.
- The bridge requires a separate random token. Only the bridge receives the Gateway token file; only the voice app receives speech keys and SIP credentials.
- Caddy denies /v1 and /v1/* before the existing reverse proxy. Existing public/WireGuard 8443 listeners, certificates, proxy address and Cloudflare trusted-proxy ranges are preserved. The raw Gateway 443 bind remains private/VPN and MUST NOT be published directly to the WAN.
- FreeSWITCH ESL and internal SIP, Drachtio control and media WebSocket are loopback-only. No public Google callback endpoint or public audio WebSocket is required.
- Credential entry uses masked terminal prompts and mode-0600 files, not chat. These are protected host files, not an encrypted secret vault.

## Resource bounds / memory

At R2 preparation the live cgroup limit was 1536 MiB RAM plus 1536 MiB allowed swap, not the earlier 1792 MiB. vps.env preserves the newly measured 1536M / 3072M RAM+swap total and 1.50 CPU quota. NODE_OPTIONS remains --max-old-space-size=768; this is not a total RSS cap or preallocated RAM.
The Gateway had already accumulated cgroup memory-limit pressure events; no OOM kills were recorded at the sample. This is still a constrained host, not a proven fit for telephony.
Phone service ceilings remain: Drachtio 96 MiB + FreeSWITCH 256 MiB + voice 192 MiB + bridge 96 MiB = 640 MiB. These are UNVERIFIED TRIAL CEILINGS, not measured usage, reserved memory, or a guarantee the host has that much spare RAM. The configure job runs separately with a 192 MiB ceiling.
New phone services have no swap allowance and restart=no to avoid masking overload with audio stalls or creating restart storms. Startup or calls may OOM if the ceilings are insufficient; inspect before changing them.
Application limits include at most 480,000 queued output bytes (~10 seconds at 24kHz), paced 960-byte frames every 20ms, a bounded media WebSocket payload, 64,000 input bytes/second, one in-flight OpenClaw consultation and at most eight consultations per call. The five-minute lifetime also bounds the lifetime of SDK transports. SDK/native allocations are not individually capped by the app; the container limit is the final protection.
General Live mode does not run STT/TTS CLI subprocesses, write response WAV files or start the batch audio HTTP server. Batch-only providers/modules are not loaded into the normal Live call path.

## Validation completed here

- 31 Node test entries pass, run serially: existing bridge/batch/security regressions plus continuous raw media exchange, explicit byte order, paced output bounds, interruption queue clearing/reset, tool de-duplication/cancellation and fail-closed unsupported-media behavior.
- The ACTUAL pinned Google SDK sent setup, PCM input and nonblocking tool-response messages to a LOCAL FAKE WSS server using valid TLS. No Google session, real API credential or paid request was used.
- Compose configuration and Caddy parsing/TLS/routing checks are run for the handoff. A temporary local HTTPS proxy must return 403 with the exact API denial body and 200 for ordinary Gateway health.
- Source syntax and git diff checks pass. Current production dependency audit reports 4 moderate findings and 0 high/critical; major-version media dependency fixes were not forced without regression tests. Gemini batch CLI offline dry-runs were checked in R1; that is not validation of a Google Live session.

NOT VERIFIED: Docker image builds, actual module capabilities in the pinned FreeSWITCH image, real Google model/account access, 3CX registration, RTP paths/codecs, end-to-end barge-in, latency and memory during a call. No Docker engine/socket is available inside this assistant environment. Do not equate parser/unit/fake-server tests with a working deployment.

## Files and existing locations

- compose.yaml: full replacement in your EXISTING Compose directory/project.
- vps.env: full environment replacement in that same directory. Restore your real existing Gateway token; the original attachment abbreviated it. Preserve ORACLE_MCP_PASS if used. Speech/SIP secrets do not go here.
- Caddyfile: full replacement for /opt/caddy-edge/Caddyfile.
- app/claude-phone/: complete updated build source and lockfile, including the new Live code, Dockerfiles and pinned optional CLI binary. Default build context is /opt/config/openclaw/workspace/claude-phone, corresponding to the existing workspace mount. The source is already updated there through that mount; the archive is a complete snapshot if you need to copy/restore it.

Use Compose v2.24+ or a current v5 release. Keep the SAME Compose directory/project name and network. Do NOT run docker compose down, delete volumes, or attach the unused EXTERNAL_NETWORK_NAME setting to a different network.
Before overwriting files, from the existing Compose directory:

    backup=$(mktemp -d ./before-live-r2.XXXXXX)
    cp -a compose.yaml vps.env "$backup/"
    sudo cp -a /opt/caddy-edge/Caddyfile "$backup/Caddyfile"
    printf 'Backup directory: %s\n' "$backup"

Replace the files at the locations above and restore the real Gateway token. In every command below, keep --env-file vps.env -f compose.yaml.

## 1. Validate and stop any R1 phone trial

    chmod 600 vps.env
    sudo install -d -m 700 -o 1002 -g 8000 /opt/config/openclaw/secrets/phone
    docker compose --env-file vps.env -f compose.yaml --profile phone config --quiet
    docker compose --env-file vps.env -f compose.yaml --profile phone stop phone-voice phone-bridge phone-freeswitch phone-drachtio

Check that /opt/config/openclaw/workspace/claude-phone/voice-app/lib/live-call.js and deployment/Dockerfile.voice exist before building. Copy app/claude-phone from the bundle to that build context if necessary. Do not combine the new Compose file with old application source.

## 2. Build the phone images SERIALly

    docker compose --env-file vps.env -f compose.yaml --profile phone build phone-voice
    docker compose --env-file vps.env -f compose.yaml --profile phone build phone-freeswitch
    docker compose --env-file vps.env -f compose.yaml --profile phone build phone-bridge
    docker compose --env-file vps.env -f compose.yaml --profile phone pull phone-drachtio

Only the NEW phone base images are pulled. Do not run a general pull that updates OpenClaw:latest.
If builds cannot fit host memory, stop Gateway/Caddy during a maintenance window and run the builds from your HOST terminal, then start them again. That causes downtime. Do not raise RAM limits beyond host capacity or try this through the assistant's own chat session.

## 3. Deploy and verify Gateway/Caddy

    docker compose --env-file vps.env -f compose.yaml up -d --no-build --pull never --force-recreate openclaw-gateway caddy-edge
    docker compose --env-file vps.env -f compose.yaml exec caddy-edge caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

A recreate is needed because Caddy admin is disabled and changing a bind-mounted file is not a reload. Verify normal WebChat still works, then test the Caddy listener (current WireGuard address):

    curl --resolve edge.8-v.org:8443:10.8.201.10 -i https://edge.8-v.org:8443/v1/models

Require HTTP 403 AND the exact body "Operator HTTP API is private." A generic Cloudflare 403 is not proof of this route. If certificate validation fails, use the correct CA chain/trust store; do NOT disable TLS verification.
Only host-loopback 127.0.0.1:3333 is newly published for the authenticated internal bridge. No public Caddy route points to it.

## 4. Enter credentials with masked prompts

    docker compose --env-file vps.env -f compose.yaml --profile phone run --rm --no-deps phone-configure

The interactive TTY job asks for the 3CX domain, actual supported registrar/SBC, extension/auth ID and masked SIP password; this server's media IPv4 reachable by 3CX; explicit trusted SIP SOURCE IPs (not hostnames/CIDRs); allowed calling extensions/numbers; a paid Gemini API key; and an optional paid OpenAI speech key.
The existing real Gateway token is copied internally from the configure job's environment; it is not printed. Random control/bridge secrets are generated once and reused on reconfiguration. Files are written under /opt/config/openclaw/secrets/phone with owner-only permissions.
For 3CX editions requiring an SBC/router-phone path, configure that supported topology. This bundle does not install a 3CX SBC or bypass PBX restrictions. Do not guess a VPN media address unless the PBX actually routes to it.

## 5. Host routing/firewall and media capability gate

No other telephony service is assumed, so these ports are used without a remapping workaround:
- 5060 TCP/UDP: Drachtio SIP on the configured media IP; allow only trusted PBX/SBC sources.
- 30000-30019 UDP: FreeSWITCH RTP; permit only the required PBX/media-peer sources for the actual topology.
- 9022 Drachtio control, 8021 FreeSWITCH ESL, 5080 FreeSWITCH internal SIP and 3001 media WebSocket: loopback-only. Do not expose them publicly.
- 3000 audio HTTP: batch mode only, loopback-only; absent in the normal Live path.
- 3333 authenticated OpenClaw bridge: host-loopback Docker publication.
- Outbound WSS/HTTPS 443 and DNS for Google Live, optional OpenAI/Google batch calls and the existing agent provider.

These media containers use Linux network_mode:host; Docker ports mappings do NOT firewall host-network services. Preserve/extend the existing host firewall rather than replacing it blindly. PBX media source addresses may differ from SIP signaling addresses. NAT forwarding and the advertised media IP must agree.

Start only media/control services and inspect the installed module before the first voice call:

    docker compose --env-file vps.env -f compose.yaml --profile phone up -d --no-build --pull never phone-drachtio phone-freeswitch phone-bridge
    docker compose --env-file vps.env -f compose.yaml --profile phone exec -T phone-freeswitch sh -c 'fs_cli -H 127.0.0.1 -P 8021 -p "$(cat /run/phone-secrets/freeswitch-secret)" -x "module_exists mod_audio_fork"'
    docker compose --env-file vps.env -f compose.yaml --profile phone exec -T phone-freeswitch sh -c 'fs_cli -H 127.0.0.1 -P 8021 -p "$(cat /run/phone-secrets/freeswitch-secret)" -x "uuid_audio_fork"'

Require the module to exist and its usage/interface to advertise bidirectional streaming and stop_play. Secrets are read internally, not printed. If the interface is missing, STOP and report the nonsecret help output; a compatible media image is required. Do not remove the app's capability gate or substitute a fork from an unrelated tutorial without review.

## 6. Start one controlled Live test

    docker compose --env-file vps.env -f compose.yaml --profile phone up -d --no-build --pull never phone-voice
    docker compose --env-file vps.env -f compose.yaml --profile phone logs --tail=100 phone-drachtio phone-freeswitch phone-bridge phone-voice
    docker stats --no-stream

Call the extension from an allowed caller. General Gemini Live conversation does not need the OpenClaw HTTP endpoint. Verify greeting, continuous listening while speaking back, intelligible speech both ways, multiple turns and hangup.
For barge-in, ask for a longer spoken answer, interrupt with a different question, and confirm the old audio stops AND does not resume after the new answer. Test repeatedly, not just once. Inspect OOM/pressure events and RAM/swap settling afterwards; keep only one call active.
LIVE_INPUT_ENDIAN=LE is explicit for the expected x86/native-PCM module path. If media testing proves the installed module supplies network-order PCM, set BE and recreate phone-voice. There is no automatic byte-order guess. Unsupported output formats/rates or excessive queued audio fail the call instead of silently converting/playing corrupt data.
If Google returns goAway or the Live transport fails, this version closes the call instead of silently opening another billable session. Five-minute calls are capped; seamless session resumption and model migration are not implemented.

## 7. Optional OpenClaw consultation activation

The dedicated phone agent is prepared with all tools disabled. The operator HTTP endpoint remains disabled until the new Caddy restriction is confirmed. After step 3 succeeds, report that the new Caddyfile is deployed; the assistant can verify and enable the private endpoint through its config tool without spawning another heavyweight Gateway CLI process.
Until activation, an explicit "ask OpenClaw ..." request receives an unavailable/error result; ordinary Gemini conversation still works. Do not treat the bridge /health endpoint as a model test.
Once activated, test one explicit consultation, then interrupt/cancel one while it is pending. Cancellation aborts the local HTTP wait and suppresses late speech; it does NOT prove the underlying Gateway run stopped. No owner-level actions are enabled.
LIVE_OPENCLAW_CONSULT=false removes the tool from the Live model's configuration. The provided Compose still starts the small bridge because it is in the dependency graph; this flag alone is not a claim of removing that container's memory use.

## Explicit batch alternative — not automatic failover

Set PHONE_VOICE_MODE=batch, then choose STT_PROVIDER and TTS_PROVIDER as gemini or openai. Re-run masked configuration if a required provider key is absent, and recreate phone-voice. Batch settings such as GEMINI_STT_MODEL, GEMINI_TTS_MODEL and OPENAI_TTS_MODEL do NOT control Live speech.
Batch Gemini uses API CLI v0.4.5 transcription/TTS requests; batch OpenAI uses its speech REST endpoints. Batch mode has the old utterance-based flow and does NOT provide Gemini Live native full-duplex/barge-in. No provider is switched automatically on an error.

## Privacy, operation and rollback

Live mode streams caller PCM to Google and model PCM back; it does not intentionally save WAV recordings locally. Provider retention/billing terms still apply. Explicit OpenClaw consultations may be retained in normal agent history. Batch mode writes temporary audio cleaned by its local server after ten minutes. SIP/call metadata and upstream batch transcripts may appear in private Docker logs. This is not a zero-retention guarantee.
If the Gateway is recreated later, stop and recreate phone-bridge and phone-voice too because the bridge shares its network namespace.
To stop the phone trial without deleting state:

    docker compose --env-file vps.env -f compose.yaml --profile phone stop phone-voice phone-bridge phone-freeswitch phone-drachtio

For full rollback, disable the optional operator HTTP endpoint BEFORE restoring a Caddyfile without the restriction, then restore the backed-up Compose/env/Caddy files and recreate Gateway/Caddy in the original project. Do not delete data volumes or secrets unless intentionally decommissioning them. Old R1 image labels are distinct from :live-r2 and are not overwritten by this build.

## Sources

https://aistudio.google.com/docs/live-api
https://aistudio.google.com/docs/live-api/tools
https://aistudio.google.com/docs/live-api/get-started-websocket
https://aistudio.google.com/docs/coding-agents
https://github.com/google-gemini/gemini-live-api-examples
https://aistudio.google.com/docs/cli
Installed drachtio-fsmrf endpoint interface and public mod_audio_fork protocol reference were also inspected; neither substitutes for verifying the pinned media image on your host.
