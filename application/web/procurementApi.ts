export interface ProcurementSnapshot {
  currency: string;
  pricing: { coefficient: string; minimum_markup: string };
  inventory: { balance: string; frozen: string; reserved: string; available: string; average_cost: string; minimum_sale_price: string };
  totals: { recorded_upstream_credits: string; cash_outflow: string; expenses: string };
  prices: { interface_path: string; upstream_unit_price: string; maximum_billable_units: number; evidence: string; version: string }[];
  purchases: { id: string; purpose: string; receipt_reference: string; upstream_points: string; coefficient_snapshot: string; generated_internal_points: string; amount: string; expense_id: string | null }[];
  expenses: { id: string; purpose: string; source_reference: string; amount: string; evidence: string; purchase_id: string | null }[];
  ledger: { id: string; event: string; reference: string; internal_delta: string; upstream_delta: string; cash_outflow: string; expense_delta: string; balance_after: string; average_cost_after: string }[];
}
export type ProcurementRequest = (path: string, body?: Record<string, string>) => Promise<unknown>;

export function procurementApi(request: ProcurementRequest) {
  return {
    overview: async () => await request('procurement') as ProcurementSnapshot,
    purchase: (body: Record<string, string>) => request('procurement/purchases', body),
    expense: (body: Record<string, string>) => request('procurement/expenses', body),
    pricing: (body: Record<string, string>) => request('procurement/pricing', body)
  };
}
