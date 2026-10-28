export interface CompanyProfile {
  id: string;
  name: string;
  countryCode3: string;
  detail: Record<string, unknown>;
  fetchedAt: string | null;
  mainProducts: string;
  purchasingNeeds: string;
  cooperationIntent: string;
  nextFollowUpAt: string | null;
  customerStatus: string;
  starRating: number | null;
  tags: string[];
  deletedAt: string | null;
}

export type CompanyRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

export function listCompanyProfiles(request: CompanyRequest, filters: Record<string, unknown>) {
  return request('company-profiles/list', filters) as Promise<CompanyProfile[]>;
}
