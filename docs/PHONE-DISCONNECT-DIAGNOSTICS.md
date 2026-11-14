# Determining unexpected call termination — Nov13 2026

## Established evidence, not a guessed fix
Two incidents are different. First acceptance call (3bf1ff8b-2d16-4aee-97d3-3e0fa6af3e7b) received Gemini WebSocket1011 before any record_message call. Focused retest (1d300983-d396-46bc-94a4-bcfe554cf4b0) saved its message, submitted the tool response, then received SIP BYE on its PBX-facing dialog. A normal SIP clearing event is NOT evidence of a satisfactory human call or a heard acknowledgement.

Exact retest evidence from Drachtio: at2026-11-14T03:06:34.944Z, tport_deliver reports an incoming UDP packet from the trusted PBX source, followed by nta received BYE (CSeq2). Its SIP Call-ID is21a8e56d-5a7b-1240-aa9c-00163c7467a5 and Reason is SIP;text="Call terminated". The app’s SIP-hangup event followed at03:06:34.948Z. Native media-leg cleanup BYE followed about03:06:35. The stored record was created03:06:23.248Z. Thus a remote PBX-facing BYE preceded app cleanup; the113-test diagnostics update does not claim to repair an unexplained handset/carrier/PBX termination.

The PBX source only identifies the immediate sender. A B2BUA can relay a handset/carrier request or choose its own termination. The generic Reason does not distinguish those cases. No existing app-side evidence establishes which upstream leg caused it. Hosted3CX/trunk-side trace (if accessible to owner/provider) is needed if the same first-BYE pattern recurs.

Separately, bounded Live playout overflow dropped audio on both tests. It is a confirmed quality defect, not proof of the disconnect cause. Increasing the buffer alone may merely trade word loss for latency; changing models/schemas/token limits or paid-retry policy is not justified by1011 timing alone. Current save-call success and submission counters do not certify provider acceptance, semantic acknowledgement text, native rendering, RTP delivery or human audibility.

## Diagnostic update
- Log opaque SIP Call-ID at session start, remaining local duration limit, peer/application/unknown BYE origin, validated source IP, bounded known Reason protocol/cause/text (never auth/From/To/header dumps).
- Explicit local-end-request events for actual duration cap versus final cleanup.
- Log message-ack-submitted with queued audio milliseconds; subsequent model audio and media-socket submission events/byte counters. These events deliberately say they do NOT prove audibility.
- Log generationComplete/turnComplete separately from queue drain. Generation/turn completion is not playback completion or hangup permission.
- Preserve playoutPendingAtEnd BEFORE close clears the queue. The previous final snapshot always showed pending0 after cleanup, hiding abandoned speech.
- Skip duplicate local dialog.destroy after a peer BYE has already marked it disconnected. Old Drachtio traces had an unable-to-find-dialog cleanup request just after the peer BYE; that was secondary, not the initiating failure.
- Give the Live lifecycle its own explicit duration-limit completion, because local dialog.destroy in pinned srf does not emit a remote destroy event. Deadlines remain unchanged.

113 local tests passed, including peer-BYE attribution, credential/header minimization, unknown-origin handling, pending-audio-at-end preservation, duplicate-BYE avoidance, hard deadline with no remote event, and nonfatal telemetry hooks. No paid provider probe, phone call, recording, host/tenant configuration or model change was made for this investigation. Voice only rebuilt/recreated to image5e61b6e1; REGISTER200 confirmed after recreate.

## Controlled post-save test — Nov13 23:42 EST
Owner authorized one call. Job787d5d25-9a89-45b3-9a7d-2bde2f0c6549, call1fc91deb-b762-4888-9e4e-5f385b7dba4f, SIP Call-ID8f2a39de-5a88-1240-aa9c-00163c7467a5. Answered04:42:04Z (23:42:04 EST). One record_message with affirmative consent arrived04:42:42.666Z; disk save succeeded42.673Z, tool-response submission42.674Z. Private operator readback independently verified the expected synthetic fields and mode600. No message payload included here.

First post-save model audio43.189Z, first media-socket submission43.194Z. All322562 post-save model PCM bytes were submitted to playout (~6.72s at24kHz mono16bit); turnComplete49.914Z with40ms queued. This is not proof of spoken content or human audibility. Peer/network BYE arrived04:43:31.184Z, 48.510s after acknowledgement submission, with generic SIP Call terminated; pending audio0. No provider1011, local deadline, media reset, save failure or tool-response submission failure was logged. The call therefore remained SIP-established beyond the requested15s post-save observation interval; do not label audible acknowledgement or overall human acceptance passed without owner feedback.

Nine playback overflows occurred BEFORE the save (04:42:06–26Z), discarding88320bytes (~1.84s). No further overflow was logged after the save. The playback-loss defect remains open independently of this non-reproduction of immediate post-save disconnect. No automatic redial, rebuild, configuration change or additional paid probe. Owner follow-up Nov14 00:40 EST: "I think it acknowledged." Treat audible acknowledgement as tentatively reported, not a definite acceptance pass. Whether the final hangup was deliberate remains unanswered.

## Original diagnostic protocol
1. One short message-save call with known synthetic fields; wait for clear affirmative consent.
2. After save, ask human to keep the call up for at least15 seconds and report whether Saved was heard and whether the handset UI actually disconnected or only audio vanished. Do not ask the human to hang up immediately after saving in this diagnostic variation.
3. Correlate record write, response submission, model audio, queued/submitted audio and first BYE/provider close/local-end event on one timeline.
4. If PBX sends first BYE while application/provider remain active, request the hosted PBX/trunk trace by exact SIP Call-ID and UTC time; cannot attribute it to the handset versus carrier from the app alone. Do not enable unsupported XAPI or invent console access.
5. If SIP stays established but acknowledgement is queued/discarded, fix playback/turn-flow and prioritize a short post-save acknowledgement; do not call it a storage failure. Verify with synthetic burst/latency tests and then one controlled human call.
6. If Google1011 recurs before tool dispatch, keep provider failure separate and capture only privacy-safe model/config/event metadata for an isolated owner-authorized provider test/support report. No automatic redial or silent provider switch.

Broader internal-vs-PSTN A/B calls or a no-provider static-media baseline can be useful only if the single instrumented test leaves ambiguity; they require separate authorized test calls and should not be mixed into a single long acceptance script.
