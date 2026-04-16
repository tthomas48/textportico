import './style.css';

type MessageDirection = 'inbound' | 'outbound';

interface Message {
  id: string;
  direction: MessageDirection;
  from: string;
  to: string;
  body: string;
  createdAt: string;
  threadId: string;
}

interface Config {
  replyWebhooksEnabled: boolean;
  replyWebhookConfigured: boolean;
  notifyConfigured: boolean;
}

let messages: Message[] = [];
let config: Config | null = null;
let selectedThreadId: string | null = null;
let ws: WebSocket | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status}: ${t}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function loadConfig(): Promise<void> {
  config = await fetchJson<Config>('/api/config');
}

async function loadMessages(): Promise<void> {
  const data = await fetchJson<{ messages: Message[] }>('/api/messages');
  messages = data.messages;
}

function threads(): { threadId: string; preview: string; peerLabel: string }[] {
  const byThread = new Map<string, Message[]>();
  for (const m of messages) {
    const arr = byThread.get(m.threadId) ?? [];
    arr.push(m);
    byThread.set(m.threadId, arr);
  }
  const out: { threadId: string; preview: string; peerLabel: string }[] = [];
  for (const [threadId, arr] of byThread) {
    arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = arr[0]!;
    const parts = threadId.split('|');
    const peerLabel = parts.length === 2 ? parts.join(' ↔ ') : threadId;
    out.push({
      threadId,
      preview: latest.body.slice(0, 80),
      peerLabel,
    });
  }
  const latestTs = (tid: string) =>
    Math.max(
      0,
      ...messages.filter((m) => m.threadId === tid).map((m) => new Date(m.createdAt).getTime()),
    );
  out.sort((a, b) => latestTs(b.threadId) - latestTs(a.threadId));
  return out;
}

function replyEndpoints(last: Message): { from: string; to: string } {
  if (last.direction === 'inbound') {
    return { from: last.from, to: last.to };
  }
  return { from: last.to, to: last.from };
}

function connectWs(): void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  ws = new WebSocket(`${proto}//${host}/ws`);
  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as {
        type: string;
        id?: string;
      };
      if (data.type === 'message.created' || data.type === 'message.deleted') {
        void refresh();
      }
      if (data.type === 'messages.cleared') {
        void refresh();
      }
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', () => {
    ws = null;
    setTimeout(connectWs, 2000);
  });
}

async function refresh(): Promise<void> {
  await loadMessages();
  render();
}

async function sendReply(body: string): Promise<void> {
  if (!selectedThreadId) return;
  const threadMsgs = messages
    .filter((m) => m.threadId === selectedThreadId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const last = threadMsgs[0];
  if (!last) return;
  const { from, to } = replyEndpoints(last);
  await fetchJson('/api/messages/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, body, viaUiReply: true }),
  });
}

async function clearAll(): Promise<void> {
  if (!confirm('Delete all captured messages?')) return;
  await fetchJson('/api/messages', { method: 'DELETE' });
  await refresh();
}

function render(): void {
  app.innerHTML = '';
  const layout = el('div', 'layout');

  const sidebar = el('aside', 'sidebar');
  const h1 = el('h1', '', 'Text Portico');
  sidebar.append(h1);

  const threadList = threads();
  if (threadList.length === 0) {
    sidebar.append(el('div', 'thread-item', 'No messages yet'));
  }
  for (const t of threadList) {
    const item = el('div', `thread-item${t.threadId === selectedThreadId ? ' active' : ''}`);
    item.append(el('div', 'peer', t.peerLabel));
    item.append(el('div', 'preview', t.preview));
    item.addEventListener('click', () => {
      selectedThreadId = t.threadId;
      render();
    });
    sidebar.append(item);
  }

  const main = el('main', 'main');
  const toolbar = el('div', 'toolbar');
  toolbar.append(el('span', '', config?.notifyConfigured ? 'Notify URL on' : 'Notify URL off'));
  const actions = el('div', 'actions');
  const clearBtn = el('button', '', 'Clear all');
  clearBtn.addEventListener('click', () => void clearAll());
  actions.append(clearBtn);
  toolbar.append(actions);

  main.append(toolbar);

  if (!selectedThreadId && threadList[0]) {
    selectedThreadId = threadList[0].threadId;
  }

  const msgs = messages
    .filter((m) => m.threadId === selectedThreadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const box = el('div', 'messages');
  if (!selectedThreadId || msgs.length === 0) {
    box.append(
      el(
        'div',
        'empty',
        'Select a thread or POST to /api/messages/outbound or /api/messages/inbound.',
      ),
    );
  } else {
    for (const m of msgs) {
      const row = el('div', `row ${m.direction}`);
      const bubble = el('div', 'bubble', m.body);
      const meta = el('div', 'meta', `${m.direction} · ${m.from} → ${m.to}`);
      bubble.append(meta);
      row.append(bubble);
      box.append(row);
    }
  }
  main.append(box);

  const canReply =
    !!config?.replyWebhooksEnabled &&
    !!config?.replyWebhookConfigured &&
    !!selectedThreadId &&
    msgs.length > 0;

  const composer = el('div', 'composer');
  const ta = document.createElement('textarea');
  ta.placeholder = canReply
    ? 'Reply (fires reply webhook + stores inbound)…'
    : 'Enable reply webhooks + TEXTPORTICO_REPLY_WEBHOOK_URL to reply from UI';
  ta.disabled = !canReply;
  const send = el('button', '', 'Send');
  send.disabled = !canReply;
  send.addEventListener('click', async () => {
    const body = ta.value.trim();
    if (!body) return;
    send.disabled = true;
    try {
      await sendReply(body);
      ta.value = '';
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      send.disabled = false;
    }
  });
  composer.append(ta, send);
  main.append(composer);

  layout.append(sidebar, main);
  app.append(layout);
}

async function boot(): Promise<void> {
  try {
    await loadConfig();
    await loadMessages();
    connectWs();
    render();
  } catch (e) {
    app.append(
      el(
        'div',
        'empty',
        `Could not reach API (${e instanceof Error ? e.message : String(e)}). For Vite dev, run core on :3847 with proxy.`,
      ),
    );
  }
}

void boot();
