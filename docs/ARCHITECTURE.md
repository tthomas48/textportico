# Text Portico architecture

## Packages

| Package                        | Role                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@textportico/core`            | HTTP dev server, **file-backed** `MessageStore`, REST API, WebSocket fan-out, **notify POST** (`textportico.notify.v1`), optional **reply webhook** POST (Twilio-shaped form body). |
| `@textportico/web`             | Vite + TypeScript SPA served from core’s `packages/web/dist` in integrated runs; Vite dev server proxies `/api` and `/ws` to core.                                                  |
| `@textportico/provider-twilio` | Optional **`SmsSender`** factory using the `twilio` npm package (peer / dynamic import).                                                                                            |

## Persistence

Messages are stored as **one JSON file per message** under `TEXTPORTICO_DATA_DIR` or a temp-rooted directory (see README). Writes use a temp file + rename. Listing uses directory scan and JSON parse (dev-scale).

## Integration boundaries

1. **Inbound to Text Portico**: `POST /api/messages/outbound` and `POST /api/messages/inbound` (JSON or Twilio-like form).
2. **Outbound from Text Portico to your stack**: `POST` to **`notifyUrl`** with `textportico.notify.v1` JSON after each successful persist (best-effort; failures logged).
3. **UI-driven reply simulation**: when `replyWebhooksEnabled` and `replyWebhookUrl` are set, `POST /api/messages/inbound` with `viaUiReply: true` persists inbound then **`POST`** `application/x-www-form-urlencoded` to `replyWebhookUrl`.

## Threading

`threadId` is the sorted pair of normalized `From` / `To` addresses (`computeThreadId`), so one conversation bucket is stable regardless of direction.

## Live UI

The browser loads `/api/messages` and subscribes to **`/ws`** for `message.created`, `message.deleted`, and `messages.cleared` events.
