export interface EmailBatch {
  id: string;
  profileId: string;
  channel: string;
  count: number;
  usageDay: string;
  accepted: number;
  delivered: number;
  uncertain: number;
  paused: number;
  replyTo: string;
}
export interface EmailRecipient {
  id: string;
  email: string;
  status: string;
  subject: string;
  content: string;
  detail: string | null;
  checkedAt: string | null;
  parentRecipientId: string | null;
  usageDay: string;
  reconfirmedUsageDay: string | null;
}
export type EmailRecordRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;
export function emailRecordsApi(request: EmailRecordRequest) {
  return {
    list: () => request('email-batches') as Promise<{ batches: EmailBatch[] }>,
    detail: (batchId: string) => request('email-batches/detail', { batchId }) as Promise<{ batch: EmailBatch; recipients: EmailRecipient[] }>,
    quota: () => request('email-quota') as Promise<{ day: string; remaining: number }>,
    operate: (action: string, body: Record<string, unknown>) => request(`email-recipients/${action}`, body)
  };
}
