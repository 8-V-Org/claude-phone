# Hermes phone acceptance regime

Scope: hosted 3CX v20 SMB Free, Hermes 30910, internal peer 30911. Only owner-approved sessions receive call controls. Automated test success is not live PBX/audio acceptance. Keep SMS/supervisor/logs/recordings unavailable. Never print PIN, SIP secrets or transcripts. Do not change protected host/PBX settings.

## Automated preflight
Run `node --test test/*.test.js lib/*.test.js` in voice-app, and `node --test *.test.cjs` in openclaw-adapter. Require zero failures; retain byte-framing, overflow, audio_fork and consent/caller-tier regressions. Verify per-dialog binding, teardown, media suppression/resumption around IVR sessions, late-result handling and REFER/NOTIFY correlation. Build voice with the pinned ARM64 gemini-api archive, recreate only once no calls are active, verify health and REGISTER 200 for extension30910 in private logs.

## Owner audio session
Call +16174449080 only as explicitly requested. Verify answered/active state, not merely API accepted. Ask owner to identify failed stages. Maximum existing call lifetime is eight minutes; no automatic redial or replay of actions.

1. Greeting: owner hears Hermes and AI disclosure. Verify two-way audio.
2. Barge-in: interrupt greeting or a long response three times. Pass: speech stops promptly, caller speech is understood and call stays connected, no stale audio replay.
3. Consult cue: ask a real agent question (for example current server RAM). Pass: soft waiting pulses during consultation, actual grounded answer; speak over pulse and confirm it stops without cancelling consultation. Bridge currently returns a final JSON response, not progress titles; cue is a waiting indicator only.
4. Long response: request a longer explanation and interrupt. Pass: overflow may discard oldest queued speech but must not hang up; review sanitized overflow/summary metrics after call.
5. Read-only controls: request internal30911 presence watch (30seconds), inspect operation status; observed BLF NOTIFY only, unknown if unavailable. Ask about SMS and confirm license-unavailable response with no send attempt.
6. Optional state-changing checks only after spoken owner agreement: presence away then restore available; pickup only a staged ringing call; park on an owner-selected free orbit then unpark from a separate endpoint. These need PBX-side observation, not just 2xx signaling.
7. Voicemail leave: only after owner agrees, target30911 using *430911; verify correct mailbox/audio manually. Mailbox check999 can connect IVR, but private PIN transmission remains disabled until logging-safe path is explicitly verified. Do not infer messages or authentication.
8. Transfer LAST because it may end this session: owner chooses blind or attended to30911, ensure peer ready. Confirm remote target rings and receives two-way audio. Record matching final REFER NOTIFY status separately from human audio result. Attended establishes a second leg and REFER Replaces but does not perform spoken consultation. Blind and attended need separate sessions if successful. No other PSTN test/transfer authorized.

## Phone-to-chat and long consultation acceptance

Use approved caller only. Ask for a short note in the bound main Hermes conversation; pass only when the note appears in that exact session and the phone tool returns delivered with read-back evidence. Repeat the same operation identity and verify no duplicate message. Unknown callers must not receive or execute the delivery tool. An invalid or unavailable target must fail without posting elsewhere. Ambiguous network timeouts must report unconfirmed, not replay the write. The destination is server-configured; spoken requests cannot redirect it.

For long consultation, automated mock-clock tests must advance beyond25seconds while keeping the consult and cue alive, then accept a result inside the120second bridge budget. Voice timeout must exceed bridge timeout, and server request budget must exceed both. Cancellation silences cue and suppresses late success; it does not assert upstream action cancellation. The separate call ceiling is eight minutes for inbound and outbound calls.

## Result recording
Record stage, signaling outcome, owner audio observation and remaining limitation separately, without transcripts or credentials. Pending REFER, absent NOTIFY, SIP unsupported and unknown BLF are not success. If a call fails, do not automatically redial; diagnose sanitized failure and ask owner before another chargeable call.
