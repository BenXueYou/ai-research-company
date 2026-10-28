export type OverviewRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

export interface OrderOverview {
  inventory?: { balance: string; frozen: string; reserved: string };
  orders: Array<{ status: string }>;
}

export interface UpstreamSnapshot {
  configured: boolean;
  snapshot: { balance: string; expiresIn: string; fetchedAt: string } | null;
}

export interface QuerySummary {
  state: string;
}

export function readOrderOverview(request: OverviewRequest) {
  return request('point-orders') as Promise<OrderOverview>;
}

export function readUpstreamSnapshot(request: OverviewRequest) {
  return request('upstream-monitor') as Promise<UpstreamSnapshot>;
}

export function readQuerySummary(request: OverviewRequest, kind: 'details' | 'contacts' | 'products') {
  const paths = {
    details: 'company-details/reconciliations',
    contacts: 'company-contacts/reconciliations',
    products: 'product-searches/reconciliations'
  };
  return request(paths[kind]) as Promise<QuerySummary[]>;
}
