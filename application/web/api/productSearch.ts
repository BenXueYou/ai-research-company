export type ProductRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;
export interface ProductCandidate { candidateId: string; name: string }
export interface ProductPage {
  pageId: string;
  state: 'quoted' | 'pending' | 'settled' | 'zero' | 'failed' | 'expired';
  productDesc: string;
  buyerCountryCode3: string;
  startDate: string;
  endDate: string;
  pageNo: number;
  pageSize: number;
  coefficient: string;
  maximumPoints: string;
  chargedPoints: string | null;
  total: number | null;
  content: ProductCandidate[];
}
export interface CompanyCandidate {
  candidateId: string;
  sourceId: string;
  name: string;
  country: string;
  verificationStatus: 'pending' | 'verified' | 'not_selected';
}
export interface Verification { query: { name: string }; content: CompanyCandidate[] }
export interface LocalProfile { id: string; name: string }
export interface DetailQuote {
  queryId: string;
  name: string;
  countryCode3: string;
  coefficient: string;
  maximumPoints: string;
  state?: string;
}
export interface DetailResult {
  queryId: string;
  state: string;
  chargedPoints: string | null;
  result: Record<string, unknown> | null;
}
export function quoteProductPage(request: ProductRequest, input: Record<string, unknown>) {
  return request('product-searches/quote', input) as Promise<ProductPage>;
}
export function executeProductPage(request: ProductRequest, pageId: string) {
  return request('product-searches/execute', { pageId }) as Promise<ProductPage>;
}
export function readProductPage(request: ProductRequest, pageId: string) {
  return request('product-searches/page', { pageId }) as Promise<ProductPage>;
}
export function checkProductCandidate(request: ProductRequest, candidateId: string) {
  return request('product-candidates/check', { candidateId }) as Promise<Verification>;
}
export function verifyProductCompany(request: ProductRequest, candidateId: string) {
  return request('company-candidates/verify', { candidateId }) as Promise<CompanyCandidate>;
}
export function quoteProductDetail(request: ProductRequest, candidateId: string) {
  return request('company-details/quote', { candidateId }) as Promise<DetailQuote | { localProfile: LocalProfile }>;
}
export function executeProductDetail(request: ProductRequest, queryId: string) {
  return request('company-details/execute', { queryId }) as Promise<DetailResult>;
}
export function readProductDetail(request: ProductRequest, queryId: string) {
  return request('company-details/status', { queryId }) as Promise<DetailResult>;
}
