# OpenClaw Phone — Gemini Live R2

Adapted from theNetworkChuck/claude-phone for the existing same-host Docker deployment.

Primary: 3CX → Drachtio/FreeSWITCH ↔ Gemini Live bidirectional voice. OpenClaw is an optional, bounded nonblocking consultation tool with an isolated read-only phone agent.

The separate Gemini API CLI provides only the explicitly selected batch transcription/TTS alternative. Claude Code and ElevenLabs are not required.

Use **deployment/README.md** and the complete **live-r2** Compose/env/Caddy/source bundle. Do not mix the old batch-first handoff with this code.

Local tests and a fake WSS server verify application logic, not real SIP/RTP audio or telephone barge-in. Host image/model/account/media/memory tests remain required.
