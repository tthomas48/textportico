import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import express from 'express';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { FileMessageStore, type MessageStore } from './file-message-store.js';
import { computeThreadId, normalizeAddress } from './thread.js';
import { postMessageNotify } from './http-notify.js';
import { postReplyWebhookSimulation } from './reply-webhook-client.js';
import type { Message } from './types.js';

export interface TextPorticoOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  notifyUrl?: string;
  replyWebhookUrl?: string;
  replyWebhooksEnabled?: boolean;
  webDistDir?: string;
  fetchImpl?: typeof fetch;
}

function resolveDataDir(dir?: string): string {
  if (dir) return dir;
  const env = process.env.TEXTPORTICO_DATA_DIR;
  if (env) return env;
  return mkdtempSync(pathJoin(tmpdir(), 'textportico-'));
}

function defaultWebDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return pathJoin(here, '..', '..', 'web', 'dist');
}

function buildMessage(
  direction: Message['direction'],
  from: string,
  to: string,
  body: string,
  raw?: unknown,
  provider?: string,
): Message {
  const na = normalizeAddress(from);
  const nb = normalizeAddress(to);
  return {
    id: randomUUID(),
    direction,
    from: na,
    to: nb,
    body,
    createdAt: new Date().toISOString(),
    threadId: computeThreadId(na, nb),
    raw,
    provider,
  };
}

export class TextPortico {
  readonly store: MessageStore;
  private readonly dataDir: string;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly options: TextPorticoOptions = {}) {
    this.dataDir = resolveDataDir(options.dataDir);
    mkdirSync(this.dataDir, { recursive: true });
    this.store = new FileMessageStore(this.dataDir);
  }

  getDataDir(): string {
    return this.dataDir;
  }

  /** Bound port after `listen()` (use `0` for ephemeral). */
  getPort(): number {
    if (!this.server) {
      throw new Error('TextPortico is not listening');
    }
    const addr = this.server.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    throw new Error('Could not read bound port');
  }

  private broadcast(obj: object): void {
    const s = JSON.stringify(obj);
    for (const c of this.clients) {
      if (c.readyState === 1) c.send(s);
    }
  }

  private fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private async afterPersist(
    message: Message,
    opts?: { triggerReplyWebhook?: boolean },
  ): Promise<void> {
    const notifyResult = await postMessageNotify(message, {
      notifyUrl: this.options.notifyUrl ?? process.env.TEXTPORTICO_NOTIFY_URL,
      fetchImpl: this.fetchImpl(),
    });
    if (!notifyResult.ok && (this.options.notifyUrl || process.env.TEXTPORTICO_NOTIFY_URL)) {
      console.warn(
        `[textportico] notify POST failed for ${message.id}:`,
        notifyResult.error ?? notifyResult.status,
      );
    }

    if (
      opts?.triggerReplyWebhook &&
      this.options.replyWebhooksEnabled &&
      this.options.replyWebhookUrl
    ) {
      const r = await postReplyWebhookSimulation(
        { From: message.from, To: message.to, Body: message.body },
        {
          replyWebhookUrl: this.options.replyWebhookUrl,
          fetchImpl: this.fetchImpl(),
        },
      );
      if (!r.ok) {
        console.warn(
          `[textportico] reply webhook POST failed for ${message.id}:`,
          r.error ?? r.status,
        );
      }
    }

    this.broadcast({ type: 'message.created', id: message.id });
  }

  async persistOutbound(from: string, to: string, body: string, raw?: unknown): Promise<Message> {
    const message = buildMessage('outbound', from, to, body, raw);
    await this.store.save(message);
    await this.afterPersist(message);
    return message;
  }

  async persistInbound(
    from: string,
    to: string,
    body: string,
    raw?: unknown,
    provider?: string,
    triggerReplyWebhook?: boolean,
  ): Promise<Message> {
    const message = buildMessage('inbound', from, to, body, raw, provider);
    await this.store.save(message);
    await this.afterPersist(message, { triggerReplyWebhook: !!triggerReplyWebhook });
    return message;
  }

  async listen(): Promise<void> {
    if (this.server) {
      throw new Error('TextPortico is already listening');
    }

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: false }));

    app.get('/api/config', (_req, res) => {
      res.json({
        replyWebhooksEnabled: !!this.options.replyWebhooksEnabled,
        replyWebhookConfigured: !!this.options.replyWebhookUrl,
        notifyConfigured: !!(this.options.notifyUrl ?? process.env.TEXTPORTICO_NOTIFY_URL),
      });
    });

    app.post('/api/messages/outbound', async (req, res) => {
      const { from, to, body } = req.body ?? {};
      if (typeof from !== 'string' || typeof to !== 'string' || typeof body !== 'string') {
        res.status(400).json({ error: 'from, to, and body strings are required' });
        return;
      }
      const message = await this.persistOutbound(from, to, body, req.body);
      res.status(201).json(message);
    });

    app.post('/api/messages/inbound', async (req, res) => {
      const from =
        typeof req.body?.From === 'string'
          ? req.body.From
          : typeof req.body?.from === 'string'
            ? req.body.from
            : undefined;
      const to =
        typeof req.body?.To === 'string'
          ? req.body.To
          : typeof req.body?.to === 'string'
            ? req.body.to
            : undefined;
      const bodyText =
        typeof req.body?.Body === 'string'
          ? req.body.Body
          : typeof req.body?.body === 'string'
            ? req.body.body
            : undefined;
      if (!from || !to || bodyText === undefined) {
        res.status(400).json({ error: 'From/To/Body (or from/to/body) required' });
        return;
      }
      const viaUi =
        req.body?.viaUiReply === true ||
        req.body?.viaUiReply === 'true' ||
        req.query?.viaUiReply === '1';
      const message = await this.persistInbound(from, to, bodyText, req.body, 'simulated', viaUi);
      res.status(201).json(message);
    });

    app.get('/api/messages', async (req, res) => {
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
      const list = await this.store.list({ to, threadId });
      res.json({ messages: list });
    });

    app.get('/api/messages/:id', async (req, res) => {
      const message = await this.store.get(req.params.id);
      if (!message) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json(message);
    });

    app.delete('/api/messages/:id', async (req, res) => {
      const ok = await this.store.delete(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      this.broadcast({ type: 'message.deleted', id: req.params.id });
      res.status(204).send();
    });

    app.delete('/api/messages', async (_req, res) => {
      const count = await this.store.deleteAll();
      this.broadcast({ type: 'messages.cleared', count });
      res.json({ deleted: count });
    });

    const webDist = this.options.webDistDir ?? process.env.TEXTPORTICO_WEB_DIST ?? defaultWebDist();
    if (existsSync(webDist)) {
      app.use(express.static(webDist));
      app.use((req, res, next) => {
        if (req.method !== 'GET') return next();
        if (req.path.startsWith('/api') || req.path === '/ws') return next();
        res.sendFile(pathJoin(webDist, 'index.html'), (err) => {
          if (err) next();
        });
      });
    } else {
      app.get('/', (_req, res) => {
        res
          .type('html')
          .send(
            '<p>Text Portico API is running. Build the web UI: <code>pnpm --filter @textportico/web build</code></p>',
          );
      });
    }

    const httpServer = createServer(app);
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    });

    const port = this.options.port ?? (Number(process.env.TEXTPORTICO_PORT) || 3847);
    const host = this.options.host ?? process.env.TEXTPORTICO_HOST ?? '127.0.0.1';

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        this.server = httpServer;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
    this.wss = null;
    this.clients.clear();

    await new Promise<void>((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((e) => (e ? reject(e) : resolve()));
    });
    this.server = null;
  }
}
