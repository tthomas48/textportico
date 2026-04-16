export type MessageDirection = 'inbound' | 'outbound';

export const NOTIFY_SCHEMA = 'textportico.notify.v1' as const;

export interface Message {
  id: string;
  direction: MessageDirection;
  from: string;
  to: string;
  body: string;
  createdAt: string;
  threadId: string;
  raw?: unknown;
  provider?: string;
}

export interface NotifyPayloadV1 {
  schema: typeof NOTIFY_SCHEMA;
  message: Pick<Message, 'id' | 'direction' | 'from' | 'to' | 'body' | 'createdAt' | 'threadId'>;
}

export interface MessageListFilter {
  to?: string;
  threadId?: string;
}
