# 8-V-Org live source (OpenClaw)

This branch is the phone source the **edge OpenClaw** image builds from (`PHONE_SOURCE_DIR=/opt/config/openclaw/workspace/claude-phone`, extension 30911).

- Upstream: `theNetworkChuck/claude-phone` (remote name `upstream`). Do not push there.
- Sister branch: `hermes` (CloudProxy Hermes, extension 30910). The two trees have diverged and are kept as separate branches.
- Includes t91 barge-in, t103/t104/t105 dialing policy (NANP +1 only, 20-minute cap, validate/dryRun, SMS MCP pointer).
