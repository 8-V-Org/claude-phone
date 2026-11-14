# Setup tool-failure audit — 2026-11-13

## Verdict
Most historical failures recovered; no evidence establishes a persistent global tool outage. The caller-authority incident remains unresolved at root-cause level. Single-slot main-agent contention remains an operational constraint, not a fixed concurrency issue. Successful later calls do not prove either condition cannot recur.

This is a read-only investigation plus this report, not a deployment. No calls, paid API requests, configuration changes, restarts, or live media re-tests were performed. No credentials or caller numbers are reproduced.

## Classification and evidence

| Incident | Classification | Evidence / remaining boundary |
| --- | --- | --- |
| Git author identity unavailable | Recovered using scoped workaround; default identity not established as repaired | Handoff records initial failure. Retained parent tool result shows successful per-command `git -c user.name=OpenClaw -c user.email=openclaw@localhost commit`, producing `de1ec7d`. Do not assume an unqualified future commit has an identity. |
| JavaScript/shell quoting and non-unique edit matches | Recovered invocation errors | Handoff records corrected quoting and narrowed edits; subsequent source commit/deployment succeeded. Original individual failure payloads were not returned by bounded history/search, so exact count and every original command cannot be independently reconstructed here. No evidence of a persistent edit-service failure. |
| Repository lookup HTTP 404s | Recovered lookup path, not repaired missing URLs | Compatible public reference located at `W1ck3dZA/mod_audio_fork`, recorded in PHONE-AUDIO-FIX.md. Compatibility was checked against native deployed behavior; this is not host-image source identity attestation. |
| Main-agent bridge probe timed out with dashboard turn holding sole main slot | Recovered deferred probe; contention constraint persists | PHONE-BEHAVIOR.md records original 25-second timeout and observed maxConcurrent=1. Search retrieved completion message `2e6e9dbd-aa6b-4187-a2e1-6aa9b639888a`: event deferred-phone-consult-probe, HTTP 200, success=true, expectedReply=true, durationMs=5667, error=null. Release the dashboard main turn before expecting a main-agent consult. No concurrency setting changed. |
| Async-completion progress_card: Gateway caller authority is no longer active | Unresolved cause; not shown to be persistent | Handoff identifies the failed async-completion tool. Parent owner-turn summary explicitly preserves uncertainty. Later retained parent progress_card result succeeded, revision 25, 3/3 steps completed; later owner-turn reads/edits/session creation also worked. This disproves a continuous universal outage, not recurrence. Original failing stack/authority snapshot unavailable in returned history. |
| Phone media and misleading native probe errors | Fixed and previously verified; separate from tool availability | Commit de1ec7d exists locally. PHONE-AUDIO-FIX.md records 69 passing tests, deployed voice image, registration success, completed internal call with input/model/output PCM, two native resets, failure=false and clean SIP hangup. Empty capability probe replaced; default audio_fork used for stop_play/reset; UTF-8 byte-framing patch installed. No PSTN verification and no claim of human-audible quality. |

PHONE-BEHAVIOR.md also records later consultation deadline work and 73 passing regression tests. Those are distinct later observations, not evidence that the original single-slot constraint disappeared or that spoken follow-up acceptance is complete. Existing uncommitted source changes were inspected, not modified or certified by this audit.

## Authority-lifecycle investigation
Documentation first: /app/docs/concepts/agent-loop.md describes deferred lifecycle cleanup and explicitly recognizes revoked caller authority as a termination condition for retained work. It does not identify the trigger for this incident. Installed /app/package.json reports version 2026.11.3.

Available bundled runtime confirms the error is an authorization/lifetime guard, not specifically a phone-network error:

- /app/dist/operator-invocation-authority-DYw2pPtC.mjs:24,45,83 rejects a false hasCurrentClientAuthority check, and at one guard a replaced Gateway context.
- /app/dist/device-revocation-DpGQRUdo.mjs:84–85 combines owner-open/revocation/reference-lifetime state with the source/client authority callback. At line 153, retain rejects a non-current capture or zero retained references with this exact error.
- Other runtime guards emit the same text; the message alone cannot select a failing branch.

An expired/unretained async caller scope, revoked source grant, or replaced context is compatible with these guards. None is proven for the historical progress_card incident. Do not attribute it to a browser disconnect, restart, credential expiry, or OpenClaw bug without correlated evidence. Do not disable the guard or grant broader authority to suppress it.

**Real blocker to root-cause closure:** the original failing tool stack and correlated run/request authority acquisition, retention/release and invalidation events. A safe recurrence investigation should retain timestamp, run/tool IDs, originating async event, sanitized stack, and lifecycle/revocation evidence. Inspect whether the UI write occurred before retrying; use a fresh owner-authorized turn if needed. No production reproduction or restart is justified by this audit alone.

## New audit-tool failures (owner alerted in this conversation)

1. A broad read-only recursive grep across /app exceeded its 10-second exec deadline and was SIGTERM-terminated (process tidal-haven, overall-timeout). It changed no files/services. Process result was inspected before narrowing the search. Recovered by searching only bundled runtime files; exact guard locations then returned successfully.
2. `rg` is absent: shell reported `/usr/bin/sh: 1: rg: not found`. Pipelines ending in head returned exit code 0, and earlier stderr suppression hid this failure. All earlier empty rg searches are invalid negative evidence. Owner alerted immediately when observed; switched to available grep/sed, which successfully returned authority implementation and documentation. No package installation or configuration change made. The unavailable rg executable remains an environment limitation; the audit lookup recovered.

History retrieval was partial/truncated; targeted search found the deferred-probe completion but did not recover each old raw tool error. An anchored history lookup returned no messages. This is an evidence limitation, not proof the incidents did not happen. Handoff-only facts are labeled above. No new failure is hidden behind an all-clear claim.

## Preservation and validation
Before writing, git status showed existing edits across phone source/docs plus deployment/start-freeswitch.sh and its untracked backup. This audit touches only docs/TOOL-FAILURE-AUDIT.md; it stages/commits nothing. Baseline SHA-256 values for preservation verification:

- deployment/start-freeswitch.sh: 95b245dae338a6e5eecf31ed7a9c3c634e25dc574442cccd499e7e08274936a9
- deployment/start-freeswitch.sh.bak-20261111-131159: 7f6ddcb15082d5720568021ee71659676ff460b98b0cbe06c9dd5f5b61bef82c

Validation: read back this report, whitespace-check this artifact, and compare both preservation hashes. Do not rerun already verified live tests just to generate audit evidence.

## Setup failure procedure
Alert the owner to every setup tool failure, including recovered failures. Open a dedicated remediation conversation for a new setup incident; related failures encountered during this investigation stay here rather than recursively spawning conversations. Record uncertain side effects before retrying, classification, recovery evidence and remaining blockers. The standing owner directive is already saved in USER.md; this operational report does not modify user memory or claim all future failures are solved.

## Recurrence after successful consent-save retest

On the Nov13 22:06 EST async command completion turn, progress_card failed with Gateway caller authority is no longer active while attempting to mark retest1/1 complete. The call and durable message save had already completed successfully; no phone operation was retried. Private process-log retrieval and workspace report writes succeeded in the same turn. This establishes recurrence specifically on async UI-status mutation, not a general phone/tool outage. No permission bypass, Gateway restart or configuration change attempted. Keep this in the existing dedicated setup-tool remediation conversation; a fresh owner-authorized turn can reconcile the UI card. Do not repeatedly invoke owner-bound UI mutation tools from these expired-authority completion turns. Root lifecycle implementation remains for runtime/operator review if this operation is intended to be supported.
