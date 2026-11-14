# Phone behavior and operations — 2026-11-13

## Access policy
phone.json callerPolicy=tiered admits calls ONLY from configured exact trusted SIP source IPs with BOTH Request-URI user and To user equal to the configured extension. Existing callers[] and sources[] are preserved. No PHONE_ALLOW_ANY_CALLER_FROM_TRUSTED_SOURCE or blanket trusted-source-any opt-in is used.

Exact parsed From user membership in callers[] selects approved vs message-only. This is the owner's explicit caller-list access grant, not cryptographic identity proof; PBX-originated caller ID can be forged or misconfigured. Only grant callers[] membership to people permitted to access the owner's conversation agent. For stronger assurance add independent per-call authentication before granting privileged access; it is not implemented by this update.

Approved: conversational AI greeting and routine prompt-only query_openclaw calls; no empty-FAQ gate, no requirement to explicitly ask to consult, no FAQ restriction. Voice uses the derived approved-consult credential to /ask-approved, which fixes model to openclaw/main (the current dashboard agent) and ignores caller agent/session overrides. Existing main-agent permissions, approval requirements and privacy rules remain; a telephone call is a new isolated per-call session, NOT the same authenticated browser session or transcript. The limited /ask path remains fixed to the previous phone agent.

Unknown/anonymous: message-taking instructions and ONLY record_message in the Live function declarations. LiveToolRouter also rejects consult at runtime, even if the model fabricates a query. No gateway token, approved consult token or operator token is given to the model. Matching From alone cannot change the bridge agent; the trusted PBX/source and token boundary are part of the policy.

## Saving
Collect name, callback (digits/phone punctuation), reason one at a time; read back, ask permission, invoke record_message with consent:true. Explicit boolean true is required; a model's reported consent is not independently verified by this application. Confirm success only after tool success. No automatic email/CRM delivery. One private JSON per call, mode 0600, directory 0700, bounded at 1000 messages. Persistent /app/messages mount is supplied by the host.

Private logs now distinguish message-save-attempt, message-save-success, message-save-failed with validation or filesystem errno, message-store-unavailable, and call-tool-summary with attempt/save counts. They do not log message bodies or credentials. Useful validation codes allow the model to correct a specific missing field instead of falsely blaming the disk. A summary with messageAttempts=0 identifies a skipped tool call. A diagnostic probe creates a clearly synthetic consented record, not a real caller recording; do not count it as a successful spoken consent flow.

## Outbound / operator control
No new listening port, Caddy route, Compose/env change, phone-ctl command or generic old /api route is enabled. Existing private bridge port 3333 has an authenticated bounded command queue; the voice worker polls it over the existing private path. Operator and approved-consult credentials are purpose-separated HMAC derivations from the existing protected bridge-token, never printed. The base voice credential may claim/report jobs but cannot enqueue them. Unknown callers have no operation tool.

From this container, in claude-phone:

    node bin/phone-op.cjs status
    node bin/phone-op.cjs probe-save diagnostic-UNIQUE_ID
    node bin/phone-op.cjs dial 30910 internal-test-UNIQUE_ID
    node bin/phone-op.cjs job JOB_UUID

The client reads the existing secret file (or PHONE_BRIDGE_TOKEN_FILE), does not put credentials on the command line, and returns a job ID followed by a result. Use a fresh requestId for a deliberate new operation. Repeating the SAME requestId with the SAME parameters returns the existing job and DOES NOT redial. Never blindly reissue a dial after uncertain outcome; inspect the job. Queue is bounded, one operation at a time, in-memory: a bridge restart loses job history. It NEVER automatically requeues/redials a claimed/indeterminate call.

Wire API: operator-authenticated POST /phone/jobs {action:status|probe-save|dial,requestId,to?}; GET /phone/status; GET /phone/jobs/JOB_UUID. Voice-authenticated POST /phone/next {busy?:true} and /phone/result {id,success,result} are internal worker protocol. No arbitrary HTTP destination, webhook, command, body message, agent selector or credential override is accepted.

Dial accepts internal extensions, 10-digit, 11-digit with leading 1, or explicit +E.164, and normalizes punctuation/spaces (10-digit NANP becomes +1…). It uses the configured SIP registrar/domain/extension/auth credentials, NOT the historical 10.x trunk/default caller ID or assumed 9 prefix. There is no outbound destination allowlist. It does not create a 3CX trunk or change outbound rules. `validate` / dryRun reports wouldDial without placing a call or taking the live slot. Redirect following is disabled; ring timeout 30s; no policy call-length ceiling (`PHONE_MAX_CALL_DURATION_MS=0`); no automatic redial. Call capacity is shared with inbound. On answer the Live assistant identifies itself as AI and announces an authorized connectivity test; it does NOT grant the recipient main-agent access. Return fields distinguish provisional statuses, answered, completed and SIP failure code. Answered SIP does not prove a human answered rather than voicemail.

PSTN dial requires a configured/allowed 3CX outbound trunk/rule and explicit owner request. This rollout makes NO PSTN call. Internal extension test is separate from real two-way audio verification by a human.

## Deployment / verification
node --test openclaw-adapter/*.test.cjs
phone-ctl build bridge; phone-ctl build voice
phone-ctl recreate bridge; phone-ctl recreate voice

Keep current Gateway, Caddy, firewall, Compose and phone.env unchanged. Recreate bridge after Gateway/Portainer redeploy because of shared netns. Registration recovery from 61cea2d is retained. After rebuild check live REGISTER 200, worker status, synthetic probe and resulting file mode, and one internal dial result. A real inbound call from each tier must still verify audio, automatic consultation, consent and actual saved details. Unit tests and a synthetic probe are not that end-to-end proof.

## Initial rollout observations

55 local Node tests pass. Both images built and bridge/voice recreated. REGISTER 200 observed. Synthetic save probe persisted as a 204-byte JSON with mode 0600 at /app/messages/69ab520d80759847f351c505a561548d.json. It remains in the private inbox as a labelled synthetic diagnostic.

One internal extension test received provisional 180 and was answered at SIP level, then the Live session failed (CALL_FAILED). This does NOT establish spoken two-way audio or whether a human versus voicemail answered. No PSTN call and no automatic redial. Additional safe lifecycle-stage/transport classification diagnostics are deployed for the next real call.

The main-agent bridge probe timed out after 25 seconds while this dashboard main turn was active. Gateway maxConcurrent is 1; target health confirms TLS edge.8-v.org:18789 with loopback transport, selected main agent. A deferred probe is required after this main turn releases the sole agent slot. No Gateway concurrency/config changes made.

## Consultation reliability — 2026-11-13

The 02:44 approved inbound call reached main but the 25-second consultation budget expired: Gateway logged HTTP client disconnected at 02:44:40 and aborted session_status. This was not a caller-policy rejection.

Bridge upstream deadline is now 90 seconds; voice outer deadline 100 seconds; bridge requestTimeout 105 seconds. Hard call ending and cancellation remain authoritative. Timeouts report CONSULT_TIMEOUT (HTTP 504 from bridge), unavailable and busy states remain distinct, and safe consultation start/success/failure events contain no prompts, responses or credentials. No automatic retry of actions is introduced.

Approved calls introduce themselves as OpenClaw, your AI assistant. Instructions require fresh consultations for substantive follow-ups and actual host/context facts, clarification of RAM versus context, explicit failure disclosure, and asking the caller to repeat a follow-up if a consult is already busy. Approved tool results use INTERRUPT scheduling so results/failures are surfaced promptly rather than waiting indefinitely for idle. Per-call limits and unapproved-caller restrictions are unchanged. Prompt instructions improve model routing but are not deterministic end-to-end proof; a real inbound call must verify greeting, spoken timeout recovery and follow-up consultation.

Regression command: node --test openclaw-adapter/*.test.cjs voice-app/test/*.test.js (73 passed). Only bridge and voice are rebuilt/recreated; preserve the pre-existing FreeSWITCH script changes.

## Owner-requested conversational outbound tests

An operator-authenticated dial may now explicitly set conversation:true (CLI: dial E164 UNIQUE_ID --conversation). This grants approved conversational context to that outbound call, introduces OpenClaw, and permits questions through the existing main-agent consult boundary. Default outbound calls remain message-only connectivity tests. No recipient caller ID is used as authentication; the grant is the owner's explicit request through the private operator interface. Conversation mode participates in request-id conflict detection; worker credentials cannot enqueue it. Conversational tests cap answered duration at 180s; ordinary tests remain 60s. Observation deadline is 300s. No automatic redial. The sole main-agent slot must be released after enqueuing so spoken consultations can run.


SMS is not part of the 3CX SIP/voice path. Use the owner's custom SMS Cloudflare MCP server: portal server `sms` on ai-bot.8-v.org and ai-dev.8-v.org, Worker `sms.leland-cheung.workers.dev/mcp`, bearer auth via the existing MCP connection. Do not embed or request secrets, and do not say SMS is unavailable. Supervisor barge/listen/whisper and XAPI remain license-unavailable on this Free SMB PBX.

Outbound PSTN is NANP +1 only (10-digit, 11-digit, or +1). International country codes are rejected. Blocked Caribbean/premium NPAs: 242, 246, 264, 268, 284, 345, 441, 473, 649, 658, 664, 721, 758, 767, 784, 809, 829, 849, 868, 869, 876, 900, 976 (US territories 340/787/939 remain allowed). Policy call-length ceiling is 20 minutes (1200000 ms).
