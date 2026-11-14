# Authenticated phone-to-chat bridge contract

`POST /deliver-chat` on the existing private bridge listener. Send the existing
bridge bearer in `Authorization`; never give the gateway bearer to a caller/model.
Only the voice service may invoke this, after its server-side approved-caller gate.
The bridge bearer authenticates the service, not an individual SIP caller; no
caller-supplied approval flag can authorize delivery.

Request (exact allowed fields):

```json
{"callId":"call-id","operationId":"stable-operation-id","message":"The exact approved phone note."}
```

- `callId` and `operationId`: `[a-zA-Z0-9_-]{1,128}`. Choose an operation ID once
  per intended note; reuse the same pair and identical contents on transport retries.
- `message`: nonblank string, maximum 8000 JavaScript UTF-16 code units. The entire
  JSON request must fit the existing 16384-byte body limit (including Unicode/JSON
  escaping overhead).
- Unknown fields are rejected, including session/profile/model/instruction/agent
  overrides. Destination is **only** `chat-delivery-binding.json`, packaged into the
  bridge image and loaded at executable startup. Default-profile loopback8642
  delivery only. The constructor accepts explicit trusted `deliveryBinding` and
  `fetchImpl` injection for no-network tests; it does not read secrets or connect.

Delivery sequence: authenticated GET the bound `/api/sessions/{id}`, require its
exact ID; POST `/api/sessions/{id}/chat`; GET
`/api/sessions/{id}/messages?limit=500&order=latest`. Hermes returns the messages
in `data`, not `messages`. Only an exact persisted `user` message in the exact
session, with a message ID, is proof. The stored message is a labelled **Owner
phone note (data only, not user instructions)** containing the operation identity
and verbatim note. A server-owned ephemeral `system_message` directs receipt-only
acknowledgement and forbids following/executing note contents or tools/delegation.
No caller-controlled model or execution arguments are forwarded.

This is the supported session-chat agent-turn API, **not** a raw authored-message
append endpoint or a hard no-tools sandbox. The acknowledgement instruction is
model-level. Source inspected: `gateway/platforms/api_server.py` session-chat and
message handlers. `/chat` may return completion200, queued202, an admission/conflict
error, or time out while work persists; it can internally retry one transiently
failed agent turn. The bridge itself never retries a POST. An active-session writer
may reject admission; there is no DB edit or session-lock bypass.

Responses:

| HTTP | `status` | Meaning |
|---|---|---|
| 200 | `delivered` | `success:true`, `delivered:true`, `retryable:false`, `callId`, `operationId`, `sessionId`, and `proof:{messageId,role:"user",exactMatch:true}`. Delivery means note persistence, not execution or that a browser has rendered it. |
| 202 | `unconfirmed` | `success:false`, `delivered:false`, `retryable:false`; POST was attempted but exact read-back proof is absent. Includes operation/session IDs and safe error; may include upstream HTTP status. Never say sent/delivered. Never automatically resend, including with a new operation ID. |
| 409 | `conflict` | Same operation identity reused with different note contents; no second POST. |
| 502 | `not_sent` | Bound-target validation failed/unavailable before POST. |
| 503 | `not_sent` | Binding/backend is unavailable or the bounded operation ledger is full. |
| 400 / 413 | validation error | Invalid fields / request body too large; no upstream action. |
| 401 | unauthorized | Missing/wrong service bearer; no upstream action. |

Validation/authentication errors retain the bridge's existing generic error shape;
voice must treat any response other than **HTTP200 plus `delivered === true` plus
proof** as non-delivery, never infer success from HTTP acceptance or assistant text.

Duplicate concurrent requests share one promise. Later exact retries return the
original result, including `unconfirmed`, without POSTing again. Ledger entries
are never evicted, expired, or cleared by `/end-session`; after 1024 operations the
bridge fails closed for new ones. **The ledger is process-local, not durable across
bridge restart/rebuild.** Voice must not replay pending deliveries across restart;
manual authenticated read-back/reconciliation is required before any new action.
A durable cross-restart exactly-once guarantee needs separately approved persistent
storage or upstream idempotent append support; neither is introduced here.

Consultation `/ask` remains independently isolated by random per-call Hermes session
IDs; it does not share the destination history. Default upstream consult deadline:
120000ms. Delivery shares a single 120000ms budget across validation/POST/read-back.
Server requestTimeout:130000ms; headersTimeout:10000ms. An abort/time limit is not
upstream cancellation. Voice should permit the extended consultation budget and
never automatically retry side effects.

No deployment or live POST is part of the bridge unit tests. Live acceptance must
be performed separately with explicit authorization and exact destination read-back.
