import { NOTIFY_SCHEMA, type Message, type NotifyPayloadV1 } from './types.js';

export interface NotifyClientOptions {
  notifyUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function postMessageNotify(
  message: Message,
  options: NotifyClientOptions,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = options.notifyUrl;
  if (!url) {
    return { ok: true };
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const payload: NotifyPayloadV1 = {
    schema: NOTIFY_SCHEMA,
    message: {
      id: message.id,
      direction: message.direction,
      from: message.from,
      to: message.to,
      body: message.body,
      createdAt: message.createdAt,
      threadId: message.threadId,
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await safeText(res) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
