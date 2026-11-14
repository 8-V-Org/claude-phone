# Receptionist application update — 2026-11-10

This supersedes conflicting R2 README statements about deny-all tools and one-call-only policy. Application source is updated in the existing mounted host build context /opt/config/openclaw/workspace/claude-phone. No host deployment, networking, firewall, Caddy, Vault, WireGuard, FQDN, public API or RAM-limit changes were made here. No private GitHub push was possible.

## Implemented
- Default exact caller allowlist retained. Optional PHONE_ALLOW_ANY_CALLER_FROM_TRUSTED_SOURCE=1 or phone.json callerPolicy=trusted-source-any skips ONLY From matching, never trusted source or exact Request-URI AND To extension matching. Environment 0 forces allowlist. This mode is NOT enabled by this change.
- Defaults: 1 concurrent call (configurable 1–4), 6 attempts per From/60 seconds, shared anonymous bucket, bounded bucket count, 486 on concurrency and 503/Retry-After on rate exhaustion. Caller identities can be spoofed: this is cost control, not owner authentication or a distributed limiter.
- Call duration default/hard ceiling 300000ms, configurable down to 30000ms. Live requests a polite close 10 seconds before forced hangup. Actual audible closing is unverified and may fail if provider/media fails.
- Generic AI receptionist with approved-public-FAQ-only instructions; no invented business facts. Approved FAQ is initially EMPTY. No transfer/REFER or outbound/query HTTP routes are mounted.
- MRF callback explicitly binds/advertises 127.0.0.1. Host must verify the actual listener after rebuild.
- Conservative FreeSWITCH module allowlist, retaining Sofia, event_socket, commands, dptools, audio_fork, XML dialplan and installed file/HTTP audio modules. G.711/L16 are core codecs. Build fails if mandatory modules are absent. No claim of 256MB usage: preserve the host's present 512MB limit until measured.
- Phone agent now has allow=[read], fs.workspaceOnly=true, codeMode=false; workspace /opt/data/config/phone-workspace. Only empty approved public FAQ and receptionist instructions supplied. Keep secrets and symlinks to private files OUT of this workspace. Consultation HTTP endpoint remains DISABLED and needs explicit owner approval plus verified Caddy restriction before activation. Workspace-only is filesystem tool confinement, not a claim of OS sandboxing.

## Host repository change to review/merge
Keep existing project, service names, mounts and environment; do not replace the deployed Compose from stale R2 copies. Inspect current compose.yaml and phone.env first. Add this persistent private bind to phone-voice's existing volumes (do not replace the list):

    /opt/config/openclaw/phone-messages:/app/messages

Create the host directory owner 1002:8000, mode 0700 before recreate. This inbox is private staff-readable JSON, NOT an email/CRM delivery system, not exposed by the audio HTTP server, maximum 1000 files. Message recording requires model-supplied explicit consent after caller readback; live behavior must be checked. One message per call, mode 0600. Set retention/access procedures before production; this update does not auto-delete personal data. Without a persistent mount, inbox contents are lost on container recreation: DO NOT deploy message-taking production use that way.

The bundled approved.json remains blank. Owner must supply public business name, approved question/answer entries (id, question, answer, approved:true), and optional humanContact before factual answers are available. Keep voice-app/receptionist/approved.json and the phone workspace APPROVED_FAQ.md synchronized. Caller assertions never approve content. Rebuild voice image after changing bundled content, or review a separate read-only content bind.

No new environment variables are required for safe defaults. Optional bounded settings in private phone.json: maxConcurrentCalls, rateLimitPerFrom, rateWindowMs, maxCallDurationMs (0 disables the call-length ceiling; this is the default). Corresponding environment overrides: PHONE_MAX_CONCURRENT_CALLS, PHONE_RATE_LIMIT_PER_FROM, PHONE_RATE_WINDOW_MS, PHONE_MAX_CALL_DURATION_MS=0. Opt-in caller-policy changes require the owner's explicit choice; don't set any-caller merely because code supports it.

## Ordered host-only rollout
These commands assume the existing recorded host paths; confirm them before use. Preserve/review the host repo's changes and merge the volume above there. Retain old image IDs/tags for rollback before build.

    sudo install -d -m 700 -o 1002 -g 8000 /opt/config/openclaw/phone-messages
    cd /root/openclaw-phone/repo
    docker compose --env-file /root/openclaw-phone/phone.env -f compose.yaml --profile phone config --quiet
    docker compose --env-file /root/openclaw-phone/phone.env -f compose.yaml --profile phone build phone-voice
    docker compose --env-file /root/openclaw-phone/phone.env -f compose.yaml --profile phone build phone-freeswitch
    docker compose --env-file /root/openclaw-phone/phone.env -f compose.yaml --profile phone up -d --no-deps --no-build --pull never --force-recreate phone-freeswitch
    docker compose --env-file /root/openclaw-phone/phone.env -f compose.yaml --profile phone up -d --no-deps --no-build --pull never --force-recreate phone-voice

No Gateway/Caddy rebuild or restart is required by this source update. If the stack/Gateway IS redeployed, follow your existing POSTDEPLOY §1 and recreate phone-bridge because it shares the Gateway netns. Do not run compose down or pull/update unrelated services.

## Required host acceptance gates
1. Validate rendered Compose preserving current memory limits and existing mounts. Build both images; inspect actual loaded FS modules/codecs and verify media-fork capability. Entrypoint may rewrite module config: inspect effective runtime config/list, not only image file.
2. Inspect listeners with ss: callback ephemeral port must be 127.0.0.1, not 0.0.0.0/public; ESL/internal SIP/media controls likewise remain private. Preserve PBX-only SIP/RTP firewall.
3. Real call from an allowed caller: generic greeting, collect details one at a time, unknown FAQ declines, read back and request consent, save exactly one private message, staff can read it. Confirm refusal creates no file; restart/recreate preserves approved saved file.
4. Controlled wrong-source/wrong-To/wrong-Request-URI rejection, default unknown-caller refusal; second simultaneous call 486 and configured rate limit 503. Test trusted-source-any ONLY if explicitly authorized. Caller ID never authenticates owner privileges.
5. Test two-way PCMU/PCMA audio, interruption/no stale audio, hangup/cleanup, configurable short duration and polite close. Confirm no dialing, transfer or arbitrary tool access.
6. Record idle and active-call docker stats/cgroup current, peak, memory.events and swap; do not reduce 512MB to 256MB without data. This environment cannot measure host FreeSWITCH RAM.
7. Optional consultation remains blocked pending explicit owner approval AND actual Caddy /v1 denial verified with TLS and exact expected denial body. Do not enable public /v1 or weaken the firewall. No FAQ means no consult tool is declared regardless of LIVE_OPENCLAW_CONSULT.

## Verification performed here
40 Node tests passed: bridge/batch/live fake media plus new caller-policy, source/URI/To, rate, concurrency, duration scheduling, FAQ, private inbox and callback-option tests. Syntax/diff checks are separate local gates. No Docker engine is available: image build, effective module list, listener binding, paid Google access, SIP/audio, memory, persistence after host recreate and caller behavior remain UNVERIFIED. Voice model FAQ compliance is instruction-based, not a deterministic fact filter.

## Rollback
Stop phone-voice, restore previous reviewed source/image tags and host Compose revision (preserve private inbox!), then recreate only affected phone services with the same env/project. Module trimming can be rolled back independently by rebuilding the previous FreeSWITCH Dockerfile. Do not delete secrets/messages. Endpoint remains disabled; don't restore a public proxy config if it is ever enabled later. The phone agent settings live in persisted Gateway config, not the source commit; rollback of that configuration must use the approved config tool, not replace the whole Gateway config.
