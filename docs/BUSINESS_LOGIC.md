# Business logic notes

## Thread ID

Two party identifiers (phone numbers or any string labels) are **trimmed**, **inner spaces removed**, then **sorted lexicographically** and joined with `|`. Any message between the same two endpoints shares one `threadId`, whether the latest traffic was inbound or outbound.

## Notify vs reply webhook

- **Notify** runs for **every** persisted message when `notifyUrl` (or `TEXTPORTICO_NOTIFY_URL`) is set. Payload is always JSON schema `textportico.notify.v1`.
- **Reply webhook** runs **only** when the message was created with **`viaUiReply`** and reply webhooks are enabled. Payload mimics Twilio inbound webhooks (`application/x-www-form-urlencoded`).

## Persistence ordering

Disk write completes **before** notify and reply webhook HTTP calls. A failed downstream POST does **not** roll back the stored file.
