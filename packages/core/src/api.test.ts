import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TextPortico } from './text-portico.js';
import { NOTIFY_SCHEMA } from './types.js';

describe('TextPortico HTTP API', () => {
  let dataDir: string;
  let portico: TextPortico;
  let baseUrl: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'textportico-test-'));
    portico = new TextPortico({ dataDir, port: 0, host: '127.0.0.1' });
    await portico.listen();
    baseUrl = `http://127.0.0.1:${portico.getPort()}`;
  });

  afterAll(async () => {
    await portico.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('creates outbound and lists messages', async () => {
    const res = await fetch(`${baseUrl}/api/messages/outbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: '+10000000001',
        to: '+10000000002',
        body: 'hello out',
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; threadId: string };
    expect(created.id).toBeTruthy();

    const list = await fetch(`${baseUrl}/api/messages`);
    expect(list.ok).toBe(true);
    const data = (await list.json()) as { messages: unknown[] };
    expect(data.messages).toHaveLength(1);
  });

  it('creates inbound with Twilio-like form body', async () => {
    const body = new URLSearchParams({
      From: '+10000000003',
      To: '+10000000004',
      Body: 'hello in',
    });
    const res = await fetch(`${baseUrl}/api/messages/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    expect(res.status).toBe(201);
  });

  it('filters by threadId', async () => {
    const list = await fetch(`${baseUrl}/api/messages`);
    const data = (await list.json()) as {
      messages: { threadId: string }[];
    };
    const tid = data.messages[0]!.threadId;
    const f = await fetch(`${baseUrl}/api/messages?threadId=${encodeURIComponent(tid)}`);
    const filtered = (await f.json()) as { messages: unknown[] };
    expect(filtered.messages.length).toBeGreaterThanOrEqual(1);
    for (const m of filtered.messages as { threadId: string }[]) {
      expect(m.threadId).toBe(tid);
    }
  });

  it('deletes one message and clears all', async () => {
    const list = await fetch(`${baseUrl}/api/messages`);
    const data = (await list.json()) as { messages: { id: string }[] };
    const id = data.messages[0]!.id;
    const del = await fetch(`${baseUrl}/api/messages/${id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);

    const clear = await fetch(`${baseUrl}/api/messages`, { method: 'DELETE' });
    expect(clear.ok).toBe(true);
    const after = await fetch(`${baseUrl}/api/messages`);
    const empty = (await after.json()) as { messages: unknown[] };
    expect(empty.messages).toHaveLength(0);
  });
});

describe('notify POST', () => {
  let dataDir: string;
  let portico: TextPortico;
  let baseUrl: string;
  let notifyUrl: string;
  let lastBody: string | null = null;
  let stub: ReturnType<typeof createServer>;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'textportico-notify-'));
    stub = createServer((req, res) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          lastBody = Buffer.concat(chunks).toString('utf8');
          res.writeHead(204).end();
        });
        return;
      }
      res.writeHead(405).end();
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    const a = stub.address();
    if (!a || typeof a === 'string') throw new Error('addr');
    notifyUrl = `http://127.0.0.1:${a.port}/hook`;

    portico = new TextPortico({
      dataDir,
      port: 0,
      host: '127.0.0.1',
      notifyUrl,
    });
    await portico.listen();
    baseUrl = `http://127.0.0.1:${portico.getPort()}`;
  });

  afterAll(async () => {
    await portico.close();
    await new Promise<void>((r, j) => stub.close((e) => (e ? j(e) : r())));
    await rm(dataDir, { recursive: true, force: true });
  });

  it('POSTs textportico.notify.v1 after persist', async () => {
    lastBody = null;
    const res = await fetch(`${baseUrl}/api/messages/outbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: '+19995550123',
        to: '+19995550987',
        body: 'notify me',
      }),
    });
    expect(res.status).toBe(201);
    expect(lastBody).toBeTruthy();
    const payload = JSON.parse(lastBody!) as { schema: string };
    expect(payload.schema).toBe(NOTIFY_SCHEMA);
  });
});

describe('reply webhook POST', () => {
  let dataDir: string;
  let portico: TextPortico;
  let baseUrl: string;
  let replyUrl: string;
  let lastContentType: string | null = null;
  let lastBody: string | null = null;
  let stub: ReturnType<typeof createServer>;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'textportico-reply-'));
    stub = createServer((req, res) => {
      if (req.method === 'POST') {
        lastContentType = req.headers['content-type'] ?? null;
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          lastBody = Buffer.concat(chunks).toString('utf8');
          res.writeHead(200).end('OK');
        });
        return;
      }
      res.writeHead(405).end();
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    const a = stub.address();
    if (!a || typeof a === 'string') throw new Error('addr');
    replyUrl = `http://127.0.0.1:${a.port}/twilio/inbound`;

    portico = new TextPortico({
      dataDir,
      port: 0,
      host: '127.0.0.1',
      replyWebhookUrl: replyUrl,
      replyWebhooksEnabled: true,
    });
    await portico.listen();
    baseUrl = `http://127.0.0.1:${portico.getPort()}`;
  });

  afterAll(async () => {
    await portico.close();
    await new Promise<void>((r, j) => stub.close((e) => (e ? j(e) : r())));
    await rm(dataDir, { recursive: true, force: true });
  });

  it('POSTs application/x-www-form-urlencoded on UI inbound', async () => {
    lastBody = null;
    lastContentType = null;
    await fetch(`${baseUrl}/api/messages/outbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: '+18885550100',
        to: '+17775550200',
        body: 'from app',
      }),
    });

    const res = await fetch(`${baseUrl}/api/messages/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: '+17775550200',
        to: '+18885550100',
        body: 'user reply',
        viaUiReply: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(lastContentType?.includes('application/x-www-form-urlencoded')).toBe(true);
    expect(lastBody).toContain('Body=user+reply');
    expect(lastBody).toContain('From=%2B17775550200');
  });
});
