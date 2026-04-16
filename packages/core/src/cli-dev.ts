import { TextPortico } from './text-portico.js';

function envBool(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

async function main(): Promise<void> {
  const portico = new TextPortico({
    replyWebhookUrl: process.env.TEXTPORTICO_REPLY_WEBHOOK_URL,
    replyWebhooksEnabled: envBool('TEXTPORTICO_REPLY_WEBHOOKS_ENABLED'),
    notifyUrl: process.env.TEXTPORTICO_NOTIFY_URL,
  });
  await portico.listen();
  const port = Number(process.env.TEXTPORTICO_PORT) || 3847;
  const host = process.env.TEXTPORTICO_HOST ?? '127.0.0.1';
  console.log(`[textportico] listening on http://${host}:${port}`);
  console.log(`[textportico] dataDir=${portico.getDataDir()}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
