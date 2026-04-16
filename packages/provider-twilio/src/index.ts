/**
 * Optional Twilio-backed {@link SmsSender}. Install `twilio` in your app or
 * `pnpm add twilio --filter @textportico/provider-twilio` when you want a
 * concrete implementation; this package stays small so core does not pull
 * Twilio transitively.
 */

export interface SendSmsInput {
  to: string;
  from: string;
  body: string;
}

export interface SendSmsResult {
  sid: string;
}

export interface SmsSender {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

export interface TwilioSenderOptions {
  accountSid: string;
  authToken: string;
  /** E.164 or Twilio number SID used as default `from` when input omits it. */
  defaultFrom: string;
}

/**
 * Create a Twilio {@link SmsSender}. Requires the `twilio` package at runtime.
 */
export async function createTwilioSender(opts: TwilioSenderOptions): Promise<SmsSender> {
  let createClient: typeof import('twilio');
  try {
    createClient = (await import('twilio')).default;
  } catch {
    throw new Error(
      'Twilio client not found. Install: pnpm add twilio (in your app or in @textportico/provider-twilio).',
    );
  }
  const client = createClient(opts.accountSid, opts.authToken);
  return {
    async send(input: SendSmsInput): Promise<SendSmsResult> {
      const msg = await client.messages.create({
        to: input.to,
        from: input.from || opts.defaultFrom,
        body: input.body,
      });
      return { sid: msg.sid };
    },
  };
}
