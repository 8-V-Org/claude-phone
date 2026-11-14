# Current private operator outbound calls

Use the existing loopback bridge and authenticated operator CLI from the repository root:

    node bin/phone-op.cjs dial EXT_OR_E164 UNIQUE_REQUEST_ID --conversation --message-file /private/path/briefing.txt

The owner must explicitly authorize the call and destination. Message files contain a per-call briefing (1–2000 printable characters), not a global greeting change. Protect them with mode 0600 and delete or archive privately after use. The operator credential is derived internally; never print it. Custom messages require conversation mode, are bound to the idempotency request ID, and travel only to the authenticated voice worker. Status responses and audit logs omit message content. Caller policy, permissions and consent safeguards remain unchanged. Clearly identify as AI; do not present owner-supplied facts as sensor observations.

Check status with `node bin/phone-op.cjs job JOB_ID`. An answered/completed call indicates SIP/session completion, not proof that the recipient heard or understood the message. Never automatically redial an uncertain result. Approved-agent consultations require a free main-agent slot; release the dashboard turn while the call runs rather than changing concurrency.

Voice and bridge images both need rebuilding/recreation after transport changes. Test with `node --test --test-concurrency=1 openclaw-adapter/*.test.cjs voice-app/test/*.test.js`.

---

# Archived upstream API reference

**Not active in Gemini Live R2.** The deployment disables outbound/query HTTP APIs. Follow `../deployment/README.md`; this older API contract is retained only as an upstream reference.

---

# Outbound Calling API

API reference for initiating outbound calls from Claude Phone.

## Overview

The outbound calling API allows your server to call phone numbers and deliver messages. Use cases:

- Server alerts ("Your disk is 95% full")
- Automated notifications
- Two-way conversations triggered by events

## Endpoints

### POST /api/outbound-call

Initiate an outbound call.

**Request:**

```json
{
  "to": "+15551234567",
  "message": "Hello from your server",
  "mode": "announce",
  "device": "Morpheus",
  "callerId": "+15559876543",
  "timeoutSeconds": 30,
  "webhookUrl": "https://example.com/webhook"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | Yes | Extension, 10-digit, 11-digit, or +E.164 (normalized; no 9 prefix) |
| `message` | Yes | Text to speak (max 1000 chars) |
| `mode` | No | `announce` (default) or `conversation` |
| `device` | No | Device name for voice/personality |
| `callerId` | No | Caller ID to display |
| `timeoutSeconds` | No | Ring timeout 5-120 (default: 30) |
| `webhookUrl` | No | URL for status callbacks |

**Response:**

```json
{
  "success": true,
  "callId": "abc123-uuid",
  "status": "queued",
  "message": "Call initiated"
}
```

### GET /api/call/:callId

Get status of a specific call.

**Response:**

```json
{
  "success": true,
  "callId": "abc123-uuid",
  "to": "+15551234567",
  "state": "completed",
  "mode": "announce",
  "createdAt": "2025-01-01T12:00:00.000Z",
  "answeredAt": "2025-01-01T12:00:05.234Z",
  "endedAt": "2025-01-01T12:00:15.678Z",
  "duration": 10
}
```

### GET /api/calls

List all active calls.

**Response:**

```json
{
  "success": true,
  "count": 2,
  "calls": [
    { "callId": "...", "to": "...", "state": "playing" },
    { "callId": "...", "to": "...", "state": "dialing" }
  ]
}
```

### POST /api/call/:callId/hangup

Manually hang up an active call.

**Response:**

```json
{
  "success": true,
  "message": "Call hangup initiated",
  "callId": "abc123-uuid"
}
```

## Call States

| State | Description |
|-------|-------------|
| `queued` | Call created, not yet dialing |
| `dialing` | SIP INVITE sent, waiting for answer |
| `playing` | Call answered, playing message |
| `completed` | Call finished successfully |
| `failed` | Call failed (busy, no answer, error) |

## Call Modes

### Announce Mode (Default)

Plays the message and hangs up:

```bash
curl -X POST http://localhost:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Alert: Your server storage is at 95 percent."
  }'
```

### Conversation Mode

Plays the message, then allows back-and-forth conversation:

```bash
curl -X POST http://localhost:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Alert: Your server storage is at 95 percent. Would you like me to clean up old logs?",
    "mode": "conversation",
    "device": "Morpheus"
  }'
```

## Webhooks

If `webhookUrl` is provided, POST requests are sent on state changes:

```json
{
  "callId": "abc123-uuid",
  "state": "completed",
  "to": "+15551234567",
  "duration": 15,
  "timestamp": "2025-01-01T12:00:15.678Z"
}
```

## Error Responses

```json
{
  "success": false,
  "error": "Invalid phone number format"
}
```

| Error | Cause |
|-------|-------|
| `Invalid phone number format` | `to` not an extension, 10-digit, 11-digit, or +E.164 |
| `Message is required` | Missing `message` field |
| `Message too long` | Message exceeds 1000 chars |
| `Call not found` | Invalid `callId` |
| `service_unavailable` | SIP/media server not ready |

## Failure Reasons

When a call fails, the `reason` field indicates why:

| Reason | Description |
|--------|-------------|
| `busy` | Recipient busy (SIP 486) |
| `no_answer` | No answer within timeout (SIP 480/408) |
| `not_found` | Number not found (SIP 404) |
| `rejected` | Call rejected (SIP 603) |
| `service_unavailable` | Server error (SIP 503) |

## Examples

### Basic Alert

```bash
curl -X POST http://localhost:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Your backup job completed successfully."
  }'
```

### With Webhook

```bash
curl -X POST http://localhost:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Server alert: High CPU usage detected.",
    "webhookUrl": "https://n8n.example.com/webhook/call-status"
  }'
```

### Check Status

```bash
# Get call status
curl http://localhost:3000/api/call/abc123-uuid

# List all active calls
curl http://localhost:3000/api/calls
```

## Integration Examples

### Home Assistant

```yaml
rest_command:
  call_alert:
    url: "http://VOICE_SERVER:3000/api/outbound-call"
    method: POST
    content_type: "application/json"
    payload: '{"to": "+15551234567", "message": "{{ message }}"}'
```

### n8n Workflow: Automated Alert System

This example workflow queries a device for status, then calls you if there's a problem.

```
┌──────────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────────┐
│   Trigger    │ ──▶ │ Query Device │ ──▶ │ If Alert │ ──▶ │  Call User   │
│ (Schedule)   │     │ POST /query  │     │  Needed  │     │ POST /call   │
└──────────────┘     └──────────────┘     └──────────┘     └──────────────┘
```

**Node 1: Trigger**
- Use Schedule Trigger (e.g., every 5 minutes) or Manual Trigger for testing

**Node 2: HTTP Request - Query Device**
```
Method: POST
URL: http://YOUR_SERVER:3000/api/query
Body (JSON):
```
```json
{
  "query": "Check the system health. Alert me if anything needs attention.",
  "device": "Morpheus",
  "format": "json",
  "schema": {
    "queryType": "alert_check",
    "requiredFields": ["call_user", "reason"],
    "fieldGuidance": {
      "call_user": "Boolean - true if something needs attention",
      "reason": "One sentence explaining the situation, under 30 words"
    }
  },
  "timeout": 120
}
```

**Node 3: If - Check Alert Condition**
```
Condition: {{ $json.structured.call_user }} equals true
```

**Node 4: HTTP Request - Make Call (True branch only)**
```
Method: POST
URL: http://YOUR_SERVER:3000/api/outbound-call
Body (JSON):
```
```json
{
  "to": "YOUR_EXTENSION",
  "message": "Hey! {{ $json.structured.reason }}. Want details?",
  "mode": "conversation",
  "device": "Morpheus"
}
```

**How it works:**
1. Trigger fires (on schedule or manually)
2. Queries your device with a structured schema request
3. Device returns JSON with `call_user: true/false` and `reason`
4. If `call_user` is true, initiates outbound call in conversation mode
5. You answer and can ask follow-up questions

### Shell Script

```bash
#!/bin/bash
PHONE="+15551234567"
MESSAGE="Disk space critical on server1"

curl -s -X POST http://localhost:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d "{\"to\": \"$PHONE\", \"message\": \"$MESSAGE\"}"
```

## SMS

SMS is handled by the owner's custom SMS Cloudflare MCP server (portal server `sms` on ai-bot.8-v.org and ai-dev.8-v.org; Worker `sms.leland-cheung.workers.dev/mcp`; bearer auth). Do not say SMS is unavailable and do not embed secrets.
