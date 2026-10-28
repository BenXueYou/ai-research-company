import type { CompanyRequest } from './companyProfiles';

export interface Candidate {
  candidateId: string;
  sourceId: string;
  name: string;
  country: string;
  verificationStatus: 'pending' | 'verified';
}
export interface SearchInput {
  name: string;
  countryCodes: string;
  pageNo: number;
  pageSize: number;
}
export interface SearchResult {
  page: number;
  size: number;
  total: number;
  chargedInternalPoints: string;
  content: Candidate[];
}
export interface DetailQuote {
  queryId: string;
  name: string;
  countryCode3: string;
  coefficient: string;
  maximumPoints: string;
  state?: string;
}
export interface DetailOutcome {
  queryId: string;
  state: string;
  chargedPoints: string | null;
  result: Record<string, unknown> | null;
}
export interface SearchSnapshot {
  profiles: { id: string; name: string; detail: Record<string, unknown> }[];
  account: { balance: string; queryFrozen: string; available: string } | null;
  ledger: { queryId: string; event: string; name: string; amount: string; maximumPoints: string }[];
}
export function companySearchApi(request: CompanyRequest) {
  return {
    search: (input: SearchInput) => request('company-searches', { ...input }) as Promise<SearchResult>,
    verify: (candidateId: string) => request('company-candidates/verify', { candidateId }) as Promise<Candidate>,
    quote: (candidateId: string) => request('company-details/quote', { candidateId }) as Promise<DetailQuote | { localProfile: { id: string } }>,
    execute: (queryId: string) => request('company-details/execute', { queryId }) as Promise<DetailOutcome>,
    status: (queryId: string) => request('company-details/status', { queryId }) as Promise<DetailOutcome>,
    snapshot: () => request('company-profiles') as Promise<SearchSnapshot>
  };
}
