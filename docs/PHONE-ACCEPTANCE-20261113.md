# Guided telephone acceptance test — 2026-11-13

Owner explicitly authorized one call to the supplied US number. Use E.164, the existing 3CX trunk with no added prefix, conversational dial and unique requestId acceptance-20261113-2106-001. No automatic redial on uncertain outcome. Current conversational call limit: 180 seconds after answer; ring limit: 30 seconds.

1. Identify AI, confirm recipient is ready. Wrong person/voicemail: generic notice only, no private information.
2. Two-way speech: blue seven/repeat and human clarity feedback.
3. Barge-in: interrupt a longer answer with stop, say green; require old audio to stop without returning. Native reset/PCM logs supplement, not replace, human feedback.
4. Read-only main-agent consultation: exact harmless acknowledgement request, no tools/actions. Caller checks cue audibility and delivery. Consult must run after this dashboard turn releases the sole main-agent slot.
5. Read phone_capabilities only; describe actual unavailable license features, no state changes.
6. Optional, explicitly consented synthetic message with Test Caller, confirmed callback and actual test feedback. Read back and require record_message success before saved claim. No fabricated consent.
7. Optional internal transfer only after caller requests and confirms exact target. Skip by default. No automatic park/pickup/profile/voicemail/BLF or further PSTN tests.
8. Summarize observed human feedback and tool outcomes. Ask human to hang up; no working remote hangup API is claimed.

Evidence to collect: operator job state/provisional/answer/completion, correlated voice call ID, Google/media setup, PCM byte counters, reset count/errors, consult cue/start/success or failure, message save attempts/success/failure and tool summary. Caller reports determine audible quality. SIP answer may be voicemail. Test must mark unknown/skipped honestly. No raw caller transcript or secrets need be printed in chat.

## Observed outcome

Single operator job 375152e3-7259-44e7-9683-9de817ebcbd2, call ID 3bf1ff8b-2d16-4aee-97d3-3e0fa6af3e7b. SIP provisional 180/183, answered. Live start 2026-11-14T02:09:18.562Z (Nov 13 21:09:18 EST); provider close 02:10:42.891Z, about 84 seconds into the answered session, before the 180-second call limit. Job failed CALL_FAILED because Gemini sent WebSocket code 1011, Internal error encountered; no clean SIP hangup preceded it. No automatic redial.

Verified transport evidence: Google setup and media connected; input PCM 2658560 bytes, model PCM 3290884 bytes, output PCM 2696164 bytes; four successful fork resets. Main consult started 02:10:11.143Z, cue started 11.900Z, cue stopped at15.057Z for caller-speech, and consult succeeded20.691Z (about9.55s). Cue submitted150720bytes. These counters/events do not independently establish audible clarity or complete barge-in behavior.

Four nonfatal playout-overflow events dropped13920+22080+23040+14400=73440bytes (about1.53s of24kHz mono16-bit audio). Overall playoutDiscarded314400 also includes intentional interruption discards, so it is not all overflow loss. Overflow occurred shortly before provider close; causation is NOT established by temporal correlation.

Owner correction at 21:53 EST: the spoken message-save consent question WAS reached, then the call dropped. Message attempts=0, messagesSaved=0 means the application never received/invoked record_message; it does not mean no consent question was spoken. No successful message saving claim. Human feedback for speech quality, old-audio cutoff and cue audibility is not captured by these diagnostic logs; capability-limit delivery is also unverified. Transfer/park/pickup/profile/voicemail/BLF actions were not requested as automatic tests. Provider1011 cause remains unresolved from available client evidence; do not claim permanent repair or automatically retry a billable call.

## Consent-stage investigation

The caller’s audible consent-prompt timing is recorded, but buffered playback means it does not conclusively identify the provider’s internal generation stage. The app received provider1011 before a record_message call; no storage-write error is evidenced for this incident.

A separate local, network-free reproducer found a genuine client fault: if a save succeeds but submitting its acknowledgement throws, the previous promise chain labelled the saved result as STORAGE_ERROR, tried a second send on the broken link, and produced an unhandled rejection. Reproducer observed savedCount=1, sends=2, unhandled=1. Hardened reply submission now reports a transport failure once, keeps the durable-save result distinct, and stops further sends. No evidence this fault caused the observed incident (there were zero save attempts).

Added privacy-preserving tool receipt/response counters and a receipt event with tool name and consent boolean shape only, no message body, callback or caller name. record_message is a blocking function; its acknowledgement now omits the nonblocking scheduling field. SDK documentation says this field is ignored for blocking calls, so its prior presence is not proof of the1011 cause. query_openclaw/nonblocking phone controls retain their existing scheduling.

103 local tests pass, including successful save plus closed-response-transport, failed validation plus unavailable transport, single-send/no-unhandled-rejection behavior, receipt counters, blocking consent schema and acknowledgement shape. No new phone call or paid provider probe was made. Provider1011 root cause remains unresolved pending independent contract review and any later owner-authorized controlled retest.

Handoff hardening deployed in voice image sha256:03c6487846000fd4e1f298a5c670db73989c5c6da119e7956270d3ee9b7099cb. Pre-deployment status showed activeCalls=0 and inboxAvailable=true, inboxCount=1 (the prior synthetic probe). Rebuilt/recreated voice only; post-deploy REGISTER200 confirmed at2026-11-14T02:59:02Z. No host configuration or caller-list changes, no redial. Dedicated independent review: Phone consent crash — Gemini1011.

Independent contract review completed: no demonstrated schema defect or invalid512-token setting. SDK3.0.0 confirms top-level FunctionResponse.scheduling is correct, applies only to NON_BLOCKING tools and is ignored for blocking tools; keep that placement for consult/phone controls. The save-acknowledgement send fault is real and fixed separately, not causal evidence for this zero-save-attempt incident. Provider1011 trigger remains unproven. Do not alter model/schema/token-budget/retry policy on temporal evidence alone. Future owner-authorized retest can distinguish pre-dispatch provider failure using new receipt/submission counters. No new calls or paid probes were made for this review.

## Focused owner-authorized consent-save retest

Second call explicitly authorized by owner at22:04 EST. Jobf652fc99-5c34-43e5-a0c1-1b8c1399d076, requestIdconsent-retest-20261113-2204-001, call1d300983-d396-46bc-94a4-bcfe554cf4b0. Answered03:05:56Z, normal SIP hangup03:06:34.948Z; completed=true, failure=false, no provider1011 event on this attempt.

At03:06:23.245Z the app received record_message with object arguments, consentBoolean=true and consentTrue=true. One save attempt succeeded03:06:23.253Z, alreadyRecorded=false. Final summary: messageAttempts1, messagesSaved1, toolCallsReceived1, toolResponsesSubmitted1, toolResponseFailures0. This verifies the save path and acknowledgement submission, not independent proof of what the human heard.

Audio issue remains:10 nonfatal playback overflows dropped145924bytes (about3.04s of24kHz16-bit mono output). Overall discarded557766bytes also includes intended interruption discards. Three media resets succeeded. Main consultation/cue and transfers were deliberately skipped during this focused retest (consultations0, consultCueSubmitted0). Original1011 root cause remains unproven; this successful retry does not establish a permanent provider fix. No automatic redial or further call.

Exact file readback completed at owner request after the caller disputed overall call success. Persisted recordbc4adeaa628cf9fe37b76fe4176a0196 exists, created2026-11-14T03:06:23.248Z, file mode0600,189 bytes, and its structured test fields were returned privately to the owner. Storage success is verified independently of audit counters; audible acknowledgement and call continuity are NOT verified by that fact. No new call was placed. Readback path is documented in PHONE-MESSAGE-READBACK.md.
