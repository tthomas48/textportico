export interface ReplyWebhookOptions {
  replyWebhookUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Twilio-like inbound webhook (form body). */
export async function postReplyWebhookSimulation(
  fields: { From: string; To: string; Body: string; MessageSid?: string },
  options: ReplyWebhookOptions,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = options.replyWebhookUrl;
  if (!url) {
    return { ok: false, error: 'replyWebhookUrl not set' };
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    From: fields.From,
    To: fields.To,
    Body: fields.Body,
    MessageSid: fields.MessageSid ?? `SM${fakeSid()}`,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  } finally {
    clearTimeout(timeout);
  }
}

function fakeSid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
