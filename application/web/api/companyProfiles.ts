export interface CompanyProfile {
  id: string;
  name: string;
  countryCode3: string | null;
  detail: Record<string, unknown> | null;
  fetchedAt: string | null;
  mainProducts: string;
  purchasingNeeds: string;
  cooperationIntent: string;
  nextFollowUpAt: string | null;
  customerStatus: string;
  starRating: number | null;
  tags: string[];
  deletedAt: string | null;
  identityState: 'pending' | 'verified' | 'conflict';
  detailState: 'absent' | 'ready';
  sourceVersion?: number;
  sources: Array<{
    sourceKind: 'company_candidate' | 'product_candidate' | 'legacy_detail';
    sourceRecordId: string;
    sourcePayload: Record<string, unknown>;
    searchConditions: Record<string, unknown>;
    pageNo: number;
    createdAt: string;
  }>;
}

export type CompanyRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

export function listCompanyProfiles(request: CompanyRequest, filters: Record<string, unknown>) {
  return request('company-profiles/list', filters) as Promise<CompanyProfile[]>;
}
