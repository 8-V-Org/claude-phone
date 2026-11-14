# 8-V-Org live source (Hermes)

This branch is the phone source the **CloudProxy Hermes** image builds from (`PHONE_SOURCE_DIR=/opt/config/hermes-phone/claude-phone`, extension 30910).

- Upstream: `theNetworkChuck/claude-phone` (remote name `upstream`). Do not push there.
- Sister branch: `openclaw` (edge OpenClaw, extension 30911). The two trees have diverged and are kept as separate branches.
- Includes t91 barge-in, t103/t104/t105 dialing policy (NANP +1 only, 20-minute cap, validate/dryRun, SMS MCP pointer).
