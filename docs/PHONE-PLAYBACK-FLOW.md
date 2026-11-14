# Live playback-buffer failure — historical investigation, 2026-11-13

Follow-up: see PHONE-PLAYBACK-FLOW-20261114.md for the subsequent bounded-spill/terminal-tail candidate and current deployment/acceptance state. The image/test counts below describe this earlier investigation only.

## Status
No repair deployed. A native-handoff draft was rejected after independent review and withdrawn from application code/tests. Running services were not recreated. The existing custom outbound-message feature remains intact. Restored application source passed all 77 regression tests; the voice tag was rebuilt from that source as sha256:081a4e1dc49b6d9a16e3ef0964c5dceb0f875182709427ee6a0be7e260ccc472, preventing accidental deployment of the rejected draft. The running voice container remains on 7c4128cd16f4. GrokBot escalation was sent privately via Jinxo as message #204383. This is an investigation report, not a successful-repair claim.

## Observed incident
One owner-authorized outbound call at 18:04:47Z was answered at 18:05:12Z. At 18:05:22Z it failed with Live playback buffer limit. Call ID a9908873-79bd-45b9-b1d6-48b4e604fba7; job 7014066c-9fcb-4db2-9315-b5b362237639. Counters: modelPcmBytes=721440, outputPcmBytes=29760, inputPcmBytes=289280, mediaResets=2. These are cumulative across epochs, including discarded output; their difference is NOT instantaneous queue depth. Message receipt is unverified. No redial authorized.

The app drains mono PCM16/24kHz at 960 bytes per 20ms interval and caps pending output at 480000 bytes (ten seconds). SDK @google/genai 3.0.0 explicitly documents generation as quickly as possible, not realtime. A synthetic fast producer reproduced the old failure with 480000 generated, 6720 submitted and 473280 pending bytes. This proves sensitivity to burst/consumer mismatch; it does not establish whether resets, event-loop delay or ordinary generation dominated the real incident.

## Rejected draft and review
Draft: remove application pacing, serialize 16KiB WebSocket writes using callbacks, move playback timing/buffering to native FreeSWITCH, bound admitted audio with an estimated playback end before the hard call deadline. 84 tests passed on the draft, including byte-exact 960000-byte actual loopback-WebSocket transfer and stale-write/reset coverage. Those tests do not establish native memory or audible correctness.

Rejected because this changes playback memory bounds materially: a five-minute deadline admits up to 14.4MB input PCM per epoch plus native allocation/resampling overhead. The enqueue-based playback-end estimate is optimistic during reset/transport/prebuffer delay, not an actual playback acknowledgment. Preserving the old 480k application transport cap does not preserve end-to-end buffering bounds. It still tears down calls on over-budget output. No safe native tail flush was established.

## Native limitations needing host/source verification
Compatible reference: https://github.com/W1ck3dZA/mod_audio_fork/blob/main/lws_glue.cpp . This is NOT source-identity attestation of the pinned deployed binary.
- Native prebuffer/playout buffers grow dynamically; MOD_AUDIO_FORK_BUFFER_SECS controls microphone outbound buffering, not returned playback.
- No reliable playback-credit API in Gemini SDK/protocol. Async onmessage callbacks do not backpressure its socket; socket-internal pause would also delay interruption/control traffic.
- stop_play clears only playout using trylock; full default-audio_fork replacement remains necessary to discard all stale prebuffered audio.
- Native marks are inserted before the NEXT binary payload; terminal markers can stall. They use in-band 0xFFFF samples, pass through resampling, and permit only 30 pending marks. Do not assume reliable credit/consumed-sample semantics.
- A final short sub-threshold prebuffer tail may remain; fresh native acceptance testing is required.

## Recommended next work for GrokBot
Attest deployed module version/source and inspect native buffers/clock on host. Measure per-epoch generated/submitted/discarded bytes, actual timer elapsed, reset/paused durations, event-loop lag and socket backlog. Prefer native bounded queues plus out-of-band monotonically counted consumed-sample/epoch acknowledgments and atomic clear/flush if feasible. If provider remains unthrottlable, a bounded spill queue or explicit nonfatal overload/cancellation policy is needed; do not just increase RAM or move the queue into C++. Validate bursts, scheduler stalls, long turns, terminal tails, native memory, and barge-in before claiming fixed.

No credentials, caller-list changes, Gateway config changes, phone restarts or additional calls during repair investigation. Existing unrelated source edits preserved.
