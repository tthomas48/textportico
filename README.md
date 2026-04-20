# Text Portico

Text Portico is a **development tool** inspired by [MailDev](https://github.com/maildev/maildev): it **captures SMS-like traffic** in dev, shows it in a **phone-style web UI**, and exposes a **REST API** for tests. In production you use a **real provider** (for example Twilio via `@textportico/provider-twilio`) instead of the dev server.

| MailDev                    | Text Portico                    |
| -------------------------- | ------------------------------- |
| Catches mail over **SMTP** | Apps send/capture over **HTTP** |
| Web UI like a mail client  | Web UI like an **SMS thread**   |
| Optional relay / outgoing  | Optional **Twilio** send plugin |

## Prerequisites

- **Node.js** ≥ 22.12 (see `engines` in the root [package.json](package.json)). For local development, set **`NODE_ENV=development`** when running the core server (the `pnpm run dev` script does this for `@textportico/core`).
- **pnpm** (Corepack: `corepack enable` then use the repo’s `packageManager` field).
- **Vite+** local CLI: `pnpm exec vp …` from the repo root (the `vite-plus` package ships the `vp` binary). For global install, see [viteplus.dev](https://viteplus.dev/).

Contributors using **nvm** should run `nvm use` (or `nvm install`) before `pnpm` / `vp` so the Node version matches `engines`.

## Install

From the monorepo root:

```bash
pnpm install
```

### From npm (published releases)

Packages **`@textportico/core`** and **`@textportico/provider-twilio`** are published under the `@textportico` scope. Core includes the **built web UI** (Vite output copied into `dist/web` at publish time), so a running `TextPortico` server serves the SMS-style UI at `/` without building this repo locally. Override the static path with **`TEXTPORTICO_WEB_DIST`** if you need a custom UI.

```bash
npm install @textportico/core
npm install @textportico/provider-twilio # optional Twilio-backed sender
```

**Maintainers:** bump the same **`version`** in [packages/core/package.json](packages/core/package.json) and [packages/provider-twilio/package.json](packages/provider-twilio/package.json), tag, then create a **GitHub Release** to trigger [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml). Add an npm **Automation** access token as the repository secret **`NPM_TOKEN`** (used as `NODE_AUTH_TOKEN` for `actions/setup-node`).

## Quick start (programmatic)

Embed the dev server in tests or local tooling. Integration with your stack is **HTTP POST to your API** (`notifyUrl`), not in-process Node events—so downstream code can **enqueue to a message bus** the same way it would in staging.

```typescript
import { TextPortico } from '@textportico/core';

const portico = new TextPortico({
  port: 3847,
  notifyUrl: 'http://127.0.0.1:9999/telephony/messages', // your stub or bus ingress
});

await portico.listen();
// POST outbound SMS into Text Portico (REST or helpers); your notifyUrl receives JSON.
await portico.close();
```

## Common commands

| Command              | Purpose                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm exec vp check` | Format, lint, and typecheck (Vite+)                                                         |
| `pnpm exec vp test`  | Run tests                                                                                   |
| `pnpm run build`     | Build web UI, copy it into `packages/core/dist/web`, then compile core and provider         |
| `pnpm run dev`       | Run core dev server (serves API + UI when `packages/web/dist` or bundled `dist/web` exists) |

Build the UI once before `dev` if assets are missing: `pnpm --filter @textportico/web build` (or run `pnpm run build`, which also runs `pnpm --filter @textportico/core build` and copies the web build into core’s `dist/web`).

## Configuration

| Variable / option      | Description                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXTPORTICO_DATA_DIR` | Directory for **one JSON file per message** (MailDev-style flat files). Default: a subdirectory under the OS **temp** dir (may be cleared on reboot).       |
| `TEXTPORTICO_PORT`     | HTTP port (default `3847`).                                                                                                                                 |
| `TEXTPORTICO_HOST`     | Bind address (default `127.0.0.1`).                                                                                                                         |
| `notifyUrl`            | If set, Text Portico **POST**s `textportico.notify.v1` JSON after each persisted message (best-effort; failures are logged; the message file still exists). |
| `replyWebhookUrl`      | If set and reply webhooks are enabled, the UI can POST **Twilio-like** inbound payloads to this URL when you send a reply from the browser.                 |

## REST API (v1)

Base path: `/api`.

| Method   | Path                 | Description                                                                 |
| -------- | -------------------- | --------------------------------------------------------------------------- |
| `POST`   | `/messages/outbound` | JSON `{ "from", "to", "body" }` — capture outbound dev send.                |
| `POST`   | `/messages/inbound`  | JSON or `x-www-form-urlencoded` (`From`, `To`, `Body`) — simulated inbound. |
| `GET`    | `/messages`          | List messages. Query: `to`, `threadId`.                                     |
| `GET`    | `/messages/:id`      | Get one message.                                                            |
| `DELETE` | `/messages/:id`      | Delete one message file.                                                    |
| `DELETE` | `/messages`          | Delete all messages in `dataDir`.                                           |
| `GET`    | `/config`            | UI: flags for reply webhooks, `ws` URL hint.                                |

WebSocket: connect to `/ws` for `message.created` / `message.deleted` events (same-origin as the HTTP server).

## Notify payload (`textportico.notify.v1`)

After a successful disk write, if `notifyUrl` is configured, Text Portico POSTs `Content-Type: application/json` roughly like:

```json
{
  "schema": "textportico.notify.v1",
  "message": {
    "id": "…",
    "direction": "outbound",
    "from": "+15551234567",
    "to": "+15559876543",
    "body": "Hello",
    "createdAt": "2026-04-15T12:00:00.000Z",
    "threadId": "…"
  }
}
```

## Threading

Threads use a stable **`threadId`** derived from the normalized **`From`** and **`To`** pair (conversation key). The UI groups by that key so inbound and outbound between the same two numbers share one thread.

## Optional Twilio provider

Package **`@textportico/provider-twilio`** holds the Twilio-backed sender implementation and lists `twilio` as its own dependency so core stays provider-agnostic. Wire it in your production app (not required for the dev server).

## Security

Bind to **127.0.0.1** by default. The dev server and REST API have **no authentication** in v1—do not expose them to untrusted networks.

## CI

- [.github/workflows/ci.yml](.github/workflows/ci.yml): install, check, build, test on push and pull requests (uses [voidzero-dev/setup-vp](https://github.com/voidzero-dev/setup-vp)).
- [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml): on **published** GitHub Releases, check, build, test, then publish **`@textportico/core`** and **`@textportico/provider-twilio`** to the public npm registry (requires secret **`NPM_TOKEN`**).

## License

MIT — see [LICENSE](LICENSE).
